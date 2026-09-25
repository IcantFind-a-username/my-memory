#!/usr/bin/env node
// Online connector: the same Memory Core behind one HTTPS address that
// Claude (web, desktop, and the phone apps) and ChatGPT can add.
//
// Two ways in:
//   POST /mcp                  public address with OAuth 2.1 sign-in (needed for a
//                              published ChatGPT app and nice in Claude)
//   POST /u/<key>/mcp          private-link address (no sign-in step)
// Pages:
//   GET  /                     create a memory store (no account; you get a private link)
//   GET  /authorize            sign-in page an AI app opens: create a store or connect yours
//   GET  /u/<key>/             your private page: records, integrity, log, settings, export
//   GET  /privacy, /terms
//
// Environment: PORT (8787), PERSONAL_MEMORY_DATA (./data), PUBLIC_URL,
// PERSONAL_MEMORY_SECRET (server secret for sign-in tokens; else data/server.key),
// VERIFY_PATH + VERIFY_TOKEN (serve a platform's domain-verification token).

import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemory, FORMAT, FORMAT_VERSION, CORE_VERSION } from '../core/memory.js';
import { verifyChain } from '../core/chain.js';
import { localStamp } from '../core/util.js';
import { createHandler } from '../mcp/server.js';
import { secureStorage, newToken, TOKEN_RE } from './secure-store.js';
import { createOAuth, loadServerSecret } from './oauth.js';

const MAX_MCP_BODY = 1024 * 1024;
const MAX_FORM_BODY = 16 * 1024;
const CREATE_LIMIT = { count: 20, windowMs: 60 * 60000 };
const REPO = 'https://github.com/IcantFind-a-username/my-memory';

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
button.danger{background:var(--warn)}input[type=text]{font:inherit;width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
label{display:flex;gap:10px;align-items:flex-start;margin:8px 0}input[type=checkbox]{width:20px;height:20px;margin-top:4px;flex:none}
.rec{border-top:1px solid var(--line);padding:10px 0}.rec:first-child{border-top:0}.warn{color:var(--warn)}.ok{color:var(--accent)}
ol,ul{padding-left:22px}li{margin:4px 0}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

const TZ_SCRIPT = "for (const el of document.querySelectorAll('input[name=tz]')) el.value = String(-new Date().getTimezoneOffset());";

function connectSteps(base, privateMcp) {
  return `<div class="card"><h2>把它连到你的 AI · Connect it</h2>
<p><b>Claude</b>（网页、电脑、iPhone、安卓都能用）</p>
<ol><li>在电脑或手机浏览器打开 claude.ai → 自定义（Customize）→ 连接器（Connectors）→ 点 <b>+</b></li>
<li>名称写「我的记忆」，网址填 <code>${esc(base)}/mcp</code>，保存后点「连接」</li>
<li>弹出的页面里选「连接我已有的记忆库」，粘贴你的私人页面链接</li>
<li>在网页上添加一次，Claude 手机 App 会自动同步。开一个新对话试试："我最近怎么样？"</li></ol>
<p><b>ChatGPT</b></p>
<ul><li>正式上架后：在 ChatGPT（手机或网页）的应用目录里找到「我的记忆」→ 连接 → 同样选「连接我已有的记忆库」。</li>
<li>上架之前（仅网页版，Plus 及以上）：设置 → 安全与登录 → 打开开发者模式；设置 → 应用与连接器 → 创建，网址填 <code>${esc(base)}/mcp</code>，身份验证选 OAuth。</li></ul>
${privateMcp ? `<details><summary class="muted">不想走登录？也可以直接用私人连接地址（Claude 里网址填这个，身份验证留空）</summary><span class="key">${esc(privateMcp)}</span><p class="muted">这个地址和私人页面一样是钥匙，不要分享。</p></details>` : ''}
<p class="muted">菜单名称以各 App 实际为准。</p></div>`;
}

function landing(base) {
  return page('我的记忆 · My Memory', `<h1>🌱 我的记忆 · My Memory</h1>
<p>一个只属于你的记忆库。连到 Claude 或 ChatGPT 之后，你聊到自己时，它会把你的原话连同时间一起记下来。<b>原文永远不会被改动</b>。以后 AI 回答你之前，会先查到确切的记录，引用原话和时间，而不是去猜。</p>
<div class="card"><form method="post" action="/new">
<label><input type="checkbox" name="auto" checked> <span>聊天时自动记录我说的关于自己的话（推荐；随时可以说"暂停记录"）<br><span class="muted">Record what I share about myself automatically (you can pause any time).</span></span></label>
<input type="hidden" name="tz" value="0"><button type="submit">创建我的记忆库 · Create my memory</button></form>
<p class="muted">也可以直接在 Claude 或 ChatGPT 里添加连接器 <code>${esc(base)}/mcp</code>，在弹出的登录页里新建。</p></div>
${privacySummary()}`, TZ_SCRIPT);
}

function privacySummary() {
  return `<div class="card muted"><b>隐私 · Privacy</b><ul>
<li>不需要账号、邮箱或手机号。你会得到一个私人链接，它就是钥匙。</li>
<li>服务器上只保存加密后的数据；解密用的钥匙从你的私人链接算出来，服务器不保存它。</li>
<li>记录只能追加、不能修改。删除要经过 7 天冷静期，期间可以撤销。</li>
<li>AI 回答时读到的那几条记录，会发送给你正在用的 AI 公司（Anthropic 或 OpenAI）。</li>
<li>这不是医疗或心理治疗服务。如果你有危险，请联系当地急救电话。</li></ul>
<p><a href="/privacy">隐私政策</a> · <a href="/terms">服务条款</a> · <a href="${REPO}">源代码</a></p></div>`;
}

function saveKeyBox(home) {
  return `<div class="card"><p class="warn"><b>请现在就把下面的私人链接存好。</b>它是唯一的钥匙：任何拿到它的人都能看到你的记忆；弄丢了，我们也没有办法帮你找回。建议存进密码管理器，或者抄在纸上放好。</p>
<p>你的私人页面（收藏它，用来查看记录、改设置、导出，也用来把记忆库连到别的 AI）：</p><span class="key">${esc(home)}</span></div>`;
}

function created(base, token) {
  const home = `${base}/u/${token}/`;
  return page('已创建 · Created', `<h1>✅ 你的记忆库已创建</h1>${saveKeyBox(home)}
${connectSteps(base, `${base}/u/${token}/mcp`)}
<p><a href="${esc(home)}">打开我的私人页面 →</a></p>`);
}

function hiddenParams(params) {
  return Object.entries(params).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
}

function authorizePage(clientName, params, error = '') {
  return page('连接我的记忆 · Connect', `<h1>🌱 连接你的记忆库</h1>
<p><b>${esc(clientName)}</b> 想连接你的记忆库：读取和你当前对话有关的记录，并按你的设置保存你聊到自己的话。原文永远不会被改动。</p>
${error ? `<p class="warn">${esc(error)}</p>` : ''}
<div class="card"><h2>连接我已有的记忆库</h2><form method="post" action="/authorize">${hiddenParams(params)}
<input type="hidden" name="action" value="existing"><input type="text" name="key" placeholder="粘贴你的私人页面链接" autocomplete="off">
<p><button type="submit">连接</button></p></form></div>
<div class="card"><h2>新建一个记忆库</h2><form method="post" action="/authorize">${hiddenParams(params)}
<input type="hidden" name="action" value="create"><input type="hidden" name="tz" value="0">
<label><input type="checkbox" name="auto" checked> <span>聊天时自动记录我说的关于自己的话（随时可以说"暂停记录"）</span></label>
<button type="submit">新建并连接</button></form></div>
${privacySummary()}`, TZ_SCRIPT);
}

function createdInFlow(base, token, clientName, params) {
  return page('已创建 · Created', `<h1>✅ 记忆库已创建</h1>${saveKeyBox(`${base}/u/${token}/`)}
<form method="post" action="/authorize">${hiddenParams(params)}<input type="hidden" name="action" value="existing"><input type="hidden" name="key" value="${esc(token)}">
<label><input type="checkbox" required> <span>我已经把私人链接存好了</span></label>
<button type="submit">继续连接到 ${esc(clientName)}</button></form>`);
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
${connectSteps(base, `${base}/u/${token}/mcp`)}
<div class="card"><h2>我的记录 · Records</h2><p class="muted">最新的在上面。原文不能修改；想补充，可以在聊天里说"补充一下 9 月 5 日那条：……"。</p>${recs || '<p class="muted">还没有记录。</p>'}</div>
<div class="card"><h2>访问记录 · Access log</h2><p class="muted">AI 什么时候读过、存过哪些记录（只有编号和数量，不含内容）。</p><pre style="white-space:pre-wrap;font-size:14px">${esc(logText)}</pre></div>
<div class="card"><h2>已连接的 AI · Connected apps</h2><p class="muted">通过登录连接的 Claude / ChatGPT 会一直有效，直到你在这里断开。断开后需要重新登录才能再用。</p>
<form method="post" action="revoke"><button class="danger" type="submit">断开所有通过登录连接的 AI</button></form></div>
<div class="card"><h2>导出 · Export</h2><p><a href="export.json" download>下载全部记录（JSON，含完整性校验链）</a></p></div>
<div class="card"><h2>销毁 · Destroy</h2><p class="muted">立即永久删除整个记忆库，无法恢复。只在你确实需要时使用（比如有人逼你交出链接）。</p>
<form method="post" action="destroy"><input type="text" name="confirm" placeholder="输入「删除」确认" autocomplete="off"> <p><button class="danger" type="submit">永久删除</button></p></form></div>`, TZ_SCRIPT);
}

function privacyPage() {
  return page('隐私政策 · Privacy Policy', `<h1>隐私政策 · Privacy Policy</h1>
<p class="muted">「我的记忆 · My Memory」是一个免费、开源、非商业的项目。本政策说明这个在线服务如何处理你的数据。</p>
<h2>我们保存什么</h2><ul>
<li>你（通过你连接的 AI）保存的记录：原话、保存时间、你给的状态标签、后来的补充，以及从原话里提取的结构（比如"睡眠：差"）。</li>
<li>访问记录：AI 在什么时间读取或保存了哪些记录的编号和数量，不含内容。</li>
<li>你的设置：是否自动记录、时区等。</li>
<li>已连接应用的登记信息（应用名称和回调地址），不含你的任何内容。</li></ul>
<h2>怎么保存</h2><ul>
<li>每个记忆库都用 AES-256-GCM 加密后存放。加密钥匙从你的私人链接推导出来，服务器不保存私人链接，也不保存钥匙。</li>
<li>服务器在处理请求的那一刻会在内存里解密你的数据，处理完不留存明文。</li>
<li>记录只能追加，不能修改；每条记录都有完整性校验。</li></ul>
<h2>谁能看到</h2><ul>
<li>拿到你私人链接的人，以及你授权连接的 AI 应用。</li>
<li>当 AI 回答你时，相关的几条记录会作为对话内容发送给该 AI 的提供方（例如 Anthropic、OpenAI），并受其隐私政策约束。</li>
<li>我们不出售、不出租、不用于广告，也不用你的数据训练任何模型。</li></ul>
<h2>你的权利</h2><ul>
<li>随时在私人页面查看全部记录、导出全部数据、暂停或关闭自动记录、断开已连接的 AI。</li>
<li>删除单条记录：先隐藏，7 天后永久删除（冷静期内可撤销）。立即删除整个记忆库：在私人页面选择"永久删除"。</li></ul>
<h2>其他</h2><ul>
<li>这不是医疗或心理治疗服务，不提供诊断。</li>
<li>服务器日志不记录你的私人链接或记录内容。</li>
<li>问题与反馈：<a href="${REPO}/issues">${REPO}/issues</a></li></ul>
<p class="muted">English summary: records are stored encrypted with a key derived from your private link, which the server does not keep. Only you, holders of your link, and AI apps you connect can access them; records needed for an answer are sent to that AI provider. No ads, no selling, no training. You can view, export, pause, disconnect, and delete (single records after a 7-day cooling-off, or everything at once) at any time. Not a medical service.</p>`);
}

function termsPage() {
  return page('服务条款 · Terms', `<h1>服务条款 · Terms of Use</h1><ul>
<li>本服务免费、开源，按"现状"提供，不作任何担保，可能中断或变更。</li>
<li>它是个人记录和陪伴辅助工具，<b>不是医疗、心理咨询或危机干预服务</b>，不提供诊断或治疗建议。如果你有危险，请立即联系当地急救电话（例如中国大陆 120 / 110，美国 988 / 911，英国 116 123）。</li>
<li>请保管好你的私人链接。任何拿到它的人都能访问你的记忆库；丢失后无法找回。</li>
<li>请只保存你自己的内容，不要用它存放他人的敏感个人信息，也不要用于违法用途。</li>
<li>你需要满足你所使用的 AI 平台对年龄和使用的要求。</li>
<li>源代码：<a href="${REPO}">${REPO}</a>（MIT 许可）。</li></ul>
<p class="muted">English: free and open source, provided as is without warranty. A personal record and support aid, not a medical, therapy or crisis service. Keep your private link safe; it cannot be recovered. Store only your own content.</p>`);
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
const csp = (formAction = "'self'") => `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`;

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...baseHeaders, 'Content-Type': type, ...(type.startsWith('text/html') ? { 'Content-Security-Policy': csp() } : {}), ...extra });
  res.end(body);
}
const sendJson = (res, status, obj, extra = {}) => send(res, status, JSON.stringify(obj), 'application/json', extra);

/**
 * @param o.dataDir    where encrypted stores live
 * @param o.publicUrl  base URL shown to people and used as the OAuth issuer (else derived from the request)
 * @param o.secret     32-byte server secret for sign-in tokens (else from env / data/server.key)
 * @param o.clock      () => Date, for tests
 */
export function createApp({ dataDir, publicUrl, secret, clock = () => new Date(), verify = {} } = {}) {
  const memories = new Map(); // store id -> { key, memory }: keeps rate limits across requests
  const creations = new Map(); // ip -> timestamps
  const oauth = createOAuth({ dataDir, clock, secret: secret || loadServerSecret(dataDir, process.env.PERSONAL_MEMORY_SECRET) });

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

  async function generationOf(storeToken) {
    if (!TOKEN_RE.test(storeToken)) return null;
    const storage = secureStorage(dataDir, storeToken);
    if (!storage.exists()) return null;
    return (await storage.load())?.settings?.gen || 0;
  }

  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/+$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers.host}`;
  }

  function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  }

  function allowCreate(ip) {
    const now = clock().getTime();
    const list = (creations.get(ip) || []).filter((t) => now - t < CREATE_LIMIT.windowMs);
    if (list.length >= CREATE_LIMIT.count) return false;
    list.push(now);
    creations.set(ip, list);
    return true;
  }

  async function createStore(form) {
    const token = newToken();
    const storage = secureStorage(dataDir, token);
    const tz = Math.max(-720, Math.min(840, Number(form.get('tz')) || 0));
    await storage.save({
      format: FORMAT, version: FORMAT_VERSION, created: clock().toISOString(), rev: 1,
      settings: { autoRecord: form.get('auto') === 'on', shareSensitive: false, budget: 300, tz, gen: 0 },
      entries: [],
    });
    return token;
  }

  async function serveMcp(req, res, storage) {
    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_MCP_BODY));
    } catch (e) {
      if (e.status === 413) return send(res, 413, '', 'text/plain');
      return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
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
    return sendJson(res, 200, Array.isArray(body) ? out : out[0]);
  }

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      const p = url.pathname;
      const base = baseUrl(req);

      if (req.method === 'GET' && p === '/') return send(res, 200, landing(base));
      if (req.method === 'GET' && p === '/health') return send(res, 200, 'ok', 'text/plain');
      if (req.method === 'GET' && p === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain');
      if (req.method === 'GET' && p === '/privacy') return send(res, 200, privacyPage());
      if (req.method === 'GET' && p === '/terms') return send(res, 200, termsPage());
      const verifyPath = verify.path || process.env.VERIFY_PATH;
      const verifyToken = verify.token || process.env.VERIFY_TOKEN;
      if (req.method === 'GET' && verifyPath && verifyToken && p === verifyPath) return send(res, 200, verifyToken, 'text/plain');

      // ---- OAuth 2.1 (MCP authorization) ----
      if (req.method === 'GET' && (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')) {
        return sendJson(res, 200, oauth.metadata(base).resource);
      }
      if (req.method === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')) {
        return sendJson(res, 200, oauth.metadata(base).server);
      }
      if (req.method === 'POST' && p === '/register') {
        let body;
        try {
          body = JSON.parse(await readBody(req, MAX_FORM_BODY));
        } catch {
          return sendJson(res, 400, { error: 'invalid_client_metadata' });
        }
        const r = oauth.register(body);
        return sendJson(res, r.status, r.json);
      }
      if (p === '/authorize') {
        const q = req.method === 'POST' ? new URLSearchParams(await readBody(req, MAX_FORM_BODY)) : url.searchParams;
        const check = oauth.checkAuthorize(q);
        if (!check.ok && !check.redirect) return send(res, 400, page('无法连接', `<p>${esc(check.error)}</p>`));
        if (!check.ok) return send(res, 302, '', 'text/plain', { Location: oauth.errorRedirect(check.params, check.error) });
        const { client, params } = check;
        const formAction = `'self' ${new URL(params.redirect_uri).origin}`;
        const html = (status, body) => {
          res.writeHead(status, { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp(formAction) });
          res.end(body);
        };
        if (req.method === 'GET') return html(200, authorizePage(client.client_name, params));
        const action = q.get('action');
        if (action === 'create') {
          if (!allowCreate(clientIp(req))) return html(429, page('稍后再试', '<p>创建得太频繁了，请稍后再试。</p>'));
          const token = await createStore(q);
          return html(200, createdInFlow(base, token, client.client_name, params));
        }
        if (action === 'existing') {
          const key = (String(q.get('key') || '').match(/[A-Za-z0-9_-]{43}/) || [])[0];
          if (!key || !secureStorage(dataDir, key).exists()) {
            return html(400, authorizePage(client.client_name, params, '没有找到这个记忆库。请粘贴完整的私人页面链接。'));
          }
          return send(res, 302, '', 'text/plain', { Location: oauth.issueCode(params, key) });
        }
        if (action === 'deny') return send(res, 302, '', 'text/plain', { Location: oauth.errorRedirect(params, 'access_denied') });
        return html(200, authorizePage(client.client_name, params));
      }
      if (req.method === 'POST' && p === '/token') {
        const form = new URLSearchParams(await readBody(req, MAX_FORM_BODY));
        const r = await oauth.token(form, req.headers.authorization, generationOf);
        return sendJson(res, r.status, r.json);
      }
      if (p === '/mcp') {
        const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` };
        if (req.method !== 'POST') return send(res, 405, '', 'text/plain', { Allow: 'POST' });
        const storeToken = await oauth.verifyAccess(req.headers.authorization, generationOf);
        if (!storeToken) return sendJson(res, 401, { error: 'invalid_token', error_description: 'Sign in to connect your memory.' }, challenge);
        return serveMcp(req, res, secureStorage(dataDir, storeToken));
      }

      if (req.method === 'POST' && p === '/new') {
        if (!allowCreate(clientIp(req))) return send(res, 429, page('稍后再试', '<p>创建得太频繁了，请稍后再试。</p>'));
        const token = await createStore(new URLSearchParams(await readBody(req, MAX_FORM_BODY)));
        return send(res, 200, created(base, token));
      }

      // ---- Private-link routes ----
      const m = p.match(/^\/u\/([^/]+)(\/.*)?$/);
      if (!m) return send(res, 404, page('Not found', '<p>Not found.</p>'));
      const token = m[1];
      const sub = m[2] || '/';
      if (!TOKEN_RE.test(token)) return send(res, 404, page('Not found', '<p>Not found.</p>'));
      const storage = secureStorage(dataDir, token);
      if (!storage.exists()) return send(res, 404, page('Not found', '<p>Not found.</p>'));

      if (sub === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, '', 'text/plain', { Allow: 'POST' });
        return serveMcp(req, res, storage);
      }

      const doc = await storage.load();
      const tz = Number.isFinite(doc.settings?.tz) ? doc.settings.tz : 0;
      const memory = memoryFor(storage, doc);

      if (sub === '/' && req.method === 'GET') {
        const fresh = { ...doc, entries: await memory.listForOwner() }; // applies due cooling-off deletions
        return send(res, 200, ownerPage(base, token, fresh, memory, tz, (await memory.accessLog(30)).text));
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
        return send(res, 303, '', 'text/plain', { Location: `${base}/u/${token}/` });
      }
      if (sub === '/revoke' && req.method === 'POST') {
        const cur = await storage.load();
        cur.settings = { ...cur.settings, gen: (cur.settings?.gen || 0) + 1 };
        cur.rev = (cur.rev || 0) + 1;
        await storage.save(cur);
        await storage.appendAudit({ t: clock().toISOString(), via: 'owner_page', op: 'revoke_all_apps' });
        return send(res, 303, '', 'text/plain', { Location: `${base}/u/${token}/` });
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
  // PUBLIC_URL wins; common hosts also tell us their public address.
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : undefined);
  const server = http.createServer(createApp({ dataDir, publicUrl }));
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
