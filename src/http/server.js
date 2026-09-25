#!/usr/bin/env node
// Online connector: the same Memory Core behind one HTTPS address that
// ChatGPT (developer mode) and Claude (custom connectors) can add.
//
//   GET  /                     create a memory store (no account; you get a private link)
//   POST /u/<token>/mcp        MCP over Streamable HTTP (JSON responses)
//   GET  /u/<token>/           your private page: records, integrity, settings, export
//   GET  /u/<token>/export.json
//   POST /u/<token>/settings | /destroy
//
// Environment: PORT (8787), PERSONAL_MEMORY_DATA (./data), PUBLIC_URL (e.g. https://memory.example.org)

import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemory, FORMAT, FORMAT_VERSION, CORE_VERSION } from '../core/memory.js';
import { verifyChain } from '../core/chain.js';
import { localStamp } from '../core/util.js';
import { createHandler } from '../mcp/server.js';
import { secureStorage, newToken, TOKEN_RE } from './secure-store.js';

const MAX_MCP_BODY = 1024 * 1024;
const MAX_FORM_BODY = 16 * 1024;
const CREATE_LIMIT = { count: 20, windowMs: 60 * 60000 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, body, script = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>
:root{--bg:#f7f5f0;--card:#fffdf8;--ink:#27251f;--muted:#6b675c;--line:#e3ded2;--accent:#3f6f5a;--warn:#8a4b2a}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1a;--card:#242623;--ink:#ecebe6;--muted:#a6a398;--line:#3a3c37;--accent:#7fb89c;--warn:#e0a07a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:20px 16px 64px}h1{font-size:24px;margin:8px 0}h2{font-size:18px;margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0}.muted{color:var(--muted);font-size:15px}
code,.key{word-break:break-all;background:rgba(127,127,127,.12);padding:2px 6px;border-radius:6px;font-size:14px}.key{display:block;padding:12px;margin:8px 0;user-select:all}
button{font:inherit;border:0;border-radius:12px;padding:10px 18px;background:var(--accent);color:#fff;cursor:pointer;min-height:44px}
button.danger{background:var(--warn)}input[type=text]{font:inherit;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
label{display:flex;gap:10px;align-items:flex-start;margin:8px 0}input[type=checkbox]{width:20px;height:20px;margin-top:4px}
.rec{border-top:1px solid var(--line);padding:10px 0}.rec:first-child{border-top:0}.warn{color:var(--warn)}.ok{color:var(--accent)}
ol{padding-left:22px}li{margin:4px 0}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

const TZ_SCRIPT = "for (const el of document.querySelectorAll('input[name=tz]')) el.value = String(-new Date().getTimezoneOffset());";

function connectSteps(mcpUrl) {
  return `<div class="card"><h2>把它连到你的 AI · Connect it</h2>
<p class="muted">连接地址（和你的私人页面一样，是你唯一的钥匙，不要分享）：</p><span class="key">${esc(mcpUrl)}</span>
<p><b>Claude</b>（网页、手机、电脑都可以；免费版可以加 1 个）</p>
<ol><li>打开 Claude → 自定义（Customize）→ 连接器（Connectors）→ 点 <b>+</b></li><li>名称写「我的记忆」，网址粘贴上面的连接地址，保存</li><li>开一个新对话试试："我最近怎么样？"</li></ol>
<p><b>ChatGPT</b>（网页版；需要 Plus 或以上）</p>
<ol><li>设置 → 安全与登录（Security and login）→ 打开「开发者模式」（Developer mode）</li><li>设置 → 应用与连接器（Apps &amp; Connectors）→ 创建（Create）</li><li>名称写「我的记忆」，网址粘贴上面的连接地址，身份验证选「无」（No authentication），保存</li><li>在新对话里选用这个连接器，然后正常聊天</li></ol>
<p class="muted">菜单名称以各 App 实际为准。</p></div>`;
}

function landing() {
  return page('我的记忆 · My Memory', `<h1>🌱 我的记忆 · My Memory</h1>
<p>一个只属于你的记忆库。连到 Claude 或 ChatGPT 之后，你聊到自己时，它会把你的原话连同时间一起记下来。<b>原文永远不会被改动</b>。以后 AI 回答你之前，会先查到确切的记录，引用原话和时间，而不是去猜。</p>
<div class="card"><form method="post" action="/new">
<label><input type="checkbox" name="auto" checked> <span>聊天时自动记录我说的关于自己的话（推荐；随时可以说"暂停记录"）<br><span class="muted">Record what I share about myself automatically (you can pause any time).</span></span></label>
<input type="hidden" name="tz" value="0"><button type="submit">创建我的记忆库 · Create my memory</button></form></div>
<div class="card muted"><b>隐私 · Privacy</b><ul>
<li>不需要账号、邮箱或手机号。你会得到一个私人链接，它就是钥匙。</li>
<li>服务器上只保存加密后的数据；解密用的钥匙从你的链接里算出来，服务器不保存链接。</li>
<li>记录只能追加、不能修改。删除要经过 7 天冷静期，期间可以撤销。</li>
<li>AI 回答时读到的那几条记录，会发送给你正在用的 AI 公司（Anthropic 或 OpenAI）。</li>
<li>这不是医疗或心理治疗服务。如果你有危险，请联系当地急救电话。</li></ul></div>`, TZ_SCRIPT);
}

function created(base, token) {
  const home = `${base}/u/${token}/`;
  return page('已创建 · Created', `<h1>✅ 你的记忆库已创建</h1>
<div class="card"><p class="warn"><b>请现在就把下面的私人链接存好。</b>它是唯一的钥匙：任何拿到它的人都能看到你的记忆；弄丢了，我们也没有办法帮你找回。</p>
<p>你的私人页面（收藏它，用来查看记录、改设置、导出）：</p><span class="key">${esc(home)}</span></div>
${connectSteps(`${base}/u/${token}/mcp`)}
<p><a href="${esc(home)}">打开我的私人页面 →</a></p>`);
}

function ownerPage(base, token, doc, memory, tz, logText) {
  const s = doc.settings || {};
  const chain = verifyChain(doc.entries);
  const live = doc.entries.filter((e) => !e.tombstone && !e.annotates);
  const stamp = (iso) => localStamp(iso, tz);
  const recs = [...doc.entries].filter((e) => !e.annotates).sort((a, b) => b.seq - a.seq).slice(0, 200).map((e) => {
    if (e.tombstone) return `<div class="rec muted">#${e.seq} · ${esc(e.day)} · 已删除（${esc(e.deletedAt.slice(0, 10))}）</div>`;
    const adds = doc.entries.filter((x) => x.annotates === e.id && !x.tombstone)
      .map((a) => `<div class="muted">↳ 后来补充 ${esc(stamp(a.savedAt))}${a.state ? ` · ${esc(a.state)}` : ''}：${esc(a.words)}</div>`).join('');
    const marks = [
      e.state ? `状态：${esc(e.state)}` : '',
      e.sensitivity === 'restricted' ? '仅自己可见' : e.sensitivity === 'sensitive' ? '敏感' : '',
      e.hidden ? `<span class="warn">已隐藏，将于 ${esc(e.deleteAfter.slice(0, 10))} 删除</span>` : '',
      e.origin === 'ai_candidate' ? 'AI 整理' : '',
    ].filter(Boolean).join(' · ');
    return `<div class="rec"><div class="muted">#${e.seq} · ${esc(stamp(e.savedAt))} · <code>${esc(e.id)}</code>${marks ? ` · ${marks}` : ''}</div><div>${esc(e.words)}</div>${adds}</div>`;
  }).join('');
  const integrity = chain.ok
    ? `<span class="ok">✓ 全部 ${chain.count} 条记录校验通过：没有被改动，也没有被悄悄删除。</span>${chain.deleted ? `<span class="muted">（其中 ${chain.deleted} 条按你的要求在冷静期后删除，位置保留了删除标记）</span>` : ''}`
    : `<span class="warn">⚠ 发现 ${chain.problems.length} 处异常：${esc(chain.problems.slice(0, 5).map((p) => `#${p.seq} ${p.issue}`).join('，'))}</span>`;
  const autoLine = memory.policy.autoRecord ? (s.paused ? '已开启，但目前暂停中' : '已开启') : '已关闭（只在你要求时保存）';
  return page('我的记忆库 · My memory', `<h1>🌱 我的记忆库</h1>
<div class="card"><div>共 ${live.length} 条记录 · 自动记录：${autoLine}</div><div>${integrity}</div></div>
<div class="card"><h2>设置 · Settings</h2><form method="post" action="settings">
<label><input type="checkbox" name="auto" ${s.autoRecord ? 'checked' : ''}> <span>聊天时自动记录我说的关于自己的话</span></label>
<label><input type="checkbox" name="paused" ${s.paused ? 'checked' : ''}> <span>暂停记录</span></label>
<label><input type="checkbox" name="sens" ${s.shareSensitive ? 'checked' : ''}> <span>允许 AI 读到标为「敏感」的记录（「仅自己可见」的永远不会）</span></label>
<input type="hidden" name="tz" value="${esc(tz)}"><button type="submit">保存设置</button></form></div>
${connectSteps(`${base}/u/${token}/mcp`)}
<div class="card"><h2>我的记录 · Records</h2><p class="muted">最新的在上面。原文不能修改；想补充，可以在聊天里说"补充一下 9 月 5 日那条：……"。</p>${recs || '<p class="muted">还没有记录。</p>'}</div>
<div class="card"><h2>访问记录 · Access log</h2><p class="muted">AI 什么时候读过、存过哪些记录（只有编号和数量，不含内容）。</p><pre style="white-space:pre-wrap;font-size:14px">${esc(logText)}</pre></div>
<div class="card"><h2>导出 · Export</h2><p><a href="export.json" download>下载全部记录（JSON，含完整性校验链）</a></p></div>
<div class="card"><h2>销毁 · Destroy</h2><p class="muted">立即永久删除整个记忆库，无法恢复。只在你确实需要时使用（比如有人逼你交出链接）。</p>
<form method="post" action="destroy"><input type="text" name="confirm" placeholder="输入「删除」确认" autocomplete="off"> <button class="danger" type="submit">永久删除</button></form></div>`, TZ_SCRIPT);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const baseHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...baseHeaders, 'Content-Type': type, ...(type.startsWith('text/html') ? { 'Content-Security-Policy': HTML_CSP } : {}), ...extra });
  res.end(body);
}

/**
 * @param o.dataDir    where encrypted stores live
 * @param o.publicUrl  base URL shown to people (else derived from the request)
 * @param o.clock      () => Date, for tests
 */
export function createApp({ dataDir, publicUrl, clock = () => new Date() } = {}) {
  const memories = new Map(); // store id -> { key, memory }: keeps rate limits across requests
  const creations = new Map(); // ip -> timestamps

  function memoryFor(storage, doc) {
    const s = doc.settings || {};
    const key = JSON.stringify([s.autoRecord, s.shareSensitive, s.budget, s.tz]);
    const hit = memories.get(storage.id);
    if (hit && hit.key === key) return hit.memory;
    const memory = createMemory({
      storage,
      via: 'connector',
      clock,
      tz: Number.isFinite(s.tz) ? s.tz : 0,
      policy: { autoRecord: s.autoRecord === true, shareSensitive: s.shareSensitive === true, budget: s.budget || 300 },
    });
    memories.set(storage.id, { key, memory });
    return memory;
  }

  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/+$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers.host}`;
  }

  function allowCreate(ip) {
    const now = clock().getTime();
    const list = (creations.get(ip) || []).filter((t) => now - t < CREATE_LIMIT.windowMs);
    if (list.length >= CREATE_LIMIT.count) return false;
    list.push(now);
    creations.set(ip, list);
    return true;
  }

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/') return send(res, 200, landing());
      if (req.method === 'GET' && p === '/health') return send(res, 200, 'ok', 'text/plain');
      if (req.method === 'GET' && p === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain');

      if (req.method === 'POST' && p === '/new') {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (!allowCreate(ip)) return send(res, 429, page('稍后再试', '<p>创建得太频繁了，请稍后再试。</p>'));
        const form = new URLSearchParams(await readBody(req, MAX_FORM_BODY));
        const token = newToken();
        const storage = secureStorage(dataDir, token);
        const tz = Math.max(-720, Math.min(840, Number(form.get('tz')) || 0));
        await storage.save({
          format: FORMAT, version: FORMAT_VERSION, created: clock().toISOString(), rev: 1,
          settings: { autoRecord: form.get('auto') === 'on', shareSensitive: false, budget: 300, tz },
          entries: [],
        });
        return send(res, 200, created(baseUrl(req), token));
      }

      const m = p.match(/^\/u\/([^/]+)(\/.*)?$/);
      if (!m) return send(res, 404, page('Not found', '<p>Not found.</p>'));
      const token = m[1];
      const sub = m[2] || '/';
      if (!TOKEN_RE.test(token)) return send(res, 404, page('Not found', '<p>Not found.</p>'));
      const storage = secureStorage(dataDir, token);
      if (!storage.exists()) return send(res, 404, page('Not found', '<p>Not found.</p>'));

      if (sub === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, '', 'text/plain', { Allow: 'POST' });
        let body;
        try {
          body = JSON.parse(await readBody(req, MAX_MCP_BODY));
        } catch (e) {
          if (e.status === 413) return send(res, 413, '', 'text/plain');
          return send(res, 400, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), 'application/json');
        }
        const handle = createHandler(async () => memoryFor(storage, (await storage.load()) || {}), {
          exportNote: 'The user can download all records from their private memory page (the link they saved when they created their memory). Do not ask them to share that link.',
        });
        const msgs = Array.isArray(body) ? body : [body];
        const out = [];
        for (const msg of msgs) {
          const r = await handle(msg);
          if (r) out.push(r);
        }
        if (!out.length) return send(res, 202, '', 'text/plain');
        return send(res, 200, JSON.stringify(Array.isArray(body) ? out : out[0]), 'application/json');
      }

      const doc = await storage.load();
      const tz = Number.isFinite(doc.settings?.tz) ? doc.settings.tz : 0;
      const memory = memoryFor(storage, doc);

      if (sub === '/' && req.method === 'GET') {
        const fresh = { ...doc, entries: await memory.listForOwner() }; // applies due cooling-off deletions
        return send(res, 200, ownerPage(baseUrl(req), token, fresh, memory, tz, (await memory.accessLog(30)).text));
      }
      if (sub === '/export.json' && req.method === 'GET') {
        const all = await storage.load();
        return send(res, 200, JSON.stringify(all, null, 2), 'application/json; charset=utf-8', {
          'Content-Disposition': `attachment; filename="personal-memory-${clock().toISOString().slice(0, 10)}.json"`,
        });
      }
      if (sub === '/settings' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req, MAX_FORM_BODY));
        const cur = await storage.load();
        cur.settings = {
          ...cur.settings,
          autoRecord: form.get('auto') === 'on',
          paused: form.get('paused') === 'on',
          shareSensitive: form.get('sens') === 'on',
          tz: Math.max(-720, Math.min(840, Number(form.get('tz')) || 0)),
        };
        cur.rev = (cur.rev || 0) + 1;
        await storage.save(cur);
        await storage.appendAudit({ t: clock().toISOString(), via: 'owner_page', op: 'settings', autoRecord: cur.settings.autoRecord, paused: cur.settings.paused, shareSensitive: cur.settings.shareSensitive });
        return send(res, 303, '', 'text/plain', { Location: `${baseUrl(req)}/u/${token}/` });
      }
      if (sub === '/destroy' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req, MAX_FORM_BODY));
        if (!['删除', 'DELETE', 'delete'].includes((form.get('confirm') || '').trim())) {
          return send(res, 400, page('没有删除', '<p>需要输入「删除」才能确认。什么都没有被删除。</p><p><a href="./">返回</a></p>'));
        }
        storage.destroy();
        memories.delete(storage.id);
        return send(res, 200, page('已删除', '<p>你的记忆库已经永久删除。</p>'));
      }
      return send(res, 404, page('Not found', '<p>Not found.</p>'));
    } catch (e) {
      if (e.status === 413) return send(res, 413, '', 'text/plain');
      process.stderr.write(`[personal-memory] http error: ${e.stack || e}\n`);
      return send(res, 500, page('Error', '<p>Something went wrong.</p>'));
    }
  };
}

function main() {
  const port = Number(process.env.PORT) || 8787;
  const dataDir = process.env.PERSONAL_MEMORY_DATA || './data';
  const server = http.createServer(createApp({ dataDir, publicUrl: process.env.PUBLIC_URL }));
  server.listen(port, () => process.stderr.write(`[personal-memory] connector ${CORE_VERSION} on :${port}, data in ${dataDir}\n`));
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) main();
