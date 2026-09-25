// The online connector, served for real over HTTP as ChatGPT / Claude would call it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/http/server.js';

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-conn-'));
  const server = http.createServer(createApp({ dataDir }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, dataDir, stop: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

async function createStore(base, { auto = true, tz = 480 } = {}) {
  const body = new URLSearchParams({ tz: String(tz), ...(auto ? { auto: 'on' } : {}) });
  const res = await fetch(`${base}/new`, { method: 'POST', body });
  assert.equal(res.status, 200);
  const html = await res.text();
  const token = html.match(/\/u\/([A-Za-z0-9_-]{43})\/mcp/)[1];
  return { token, mcp: `${base}/u/${token}/mcp`, home: `${base}/u/${token}/` };
}

function client(url) {
  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    return { status: res.status, json: res.status === 200 ? await res.json() : null };
  };
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).json.result;
  return { rpc, call };
}

test('create a store, connect, record automatically, recall and look up exact records', async () => {
  const s = await start();
  try {
    const store = await createStore(s.base);
    const c = client(store.mcp);
    const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chatgpt-like', version: '1' } });
    assert.equal(init.json.result.protocolVersion, '2025-06-18');
    assert.match(init.json.result.instructions, /turned on automatic recording/);
    const note = await fetch(store.mcp, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(note.status, 202);

    const tools = (await c.rpc('tools/list', {})).json.result.tools;
    assert.deepEqual(tools.map((t) => t.name), ['remember', 'recall', 'lookup', 'forget', 'memory_info']);
    assert.ok(tools[0].inputSchema.properties.consent.enum.includes('standing'));

    const saved = await c.call('remember', { words: '我最近睡眠很差，今天出去走路以后感觉舒服了一点。', consent: 'standing' });
    assert.match(saved.content[0].text, /Recorded \(id \w+\)[\s\S]*first automatic save/);
    const recall = await c.call('recall', { query: '我最近发生了什么？' });
    assert.match(recall.content[0].text, /sleep:poor/);
    const lookup = await c.call('lookup', { text: '睡眠很差' });
    assert.match(lookup.content[0].text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2} · .* · verbatim, unchanged since saved\n"我最近睡眠很差，今天出去走路以后感觉舒服了一点。"/);
    const status = await c.call('memory_info', { action: 'status' });
    assert.match(status.content[0].text, /Integrity: all 1 records verified/);
    assert.doesNotMatch(status.content[0].text, new RegExp(store.token), 'the secret link never goes to the AI');
    const exp = await c.call('memory_info', { action: 'export' });
    assert.doesNotMatch(exp.content[0].text, new RegExp(store.token));

    // Nothing readable on the server's disk.
    const files = fs.readdirSync(s.dataDir, { recursive: true }).map((f) => path.join(s.dataDir, f)).filter((f) => fs.statSync(f).isFile());
    assert.ok(files.length >= 2);
    for (const f of files) {
      const raw = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(raw, /睡眠|走路|standing|sleep/, `${path.basename(f)} holds plaintext`);
      assert.doesNotMatch(raw, new RegExp(store.token));
    }
    assert.ok(!fs.readdirSync(s.dataDir).some((d) => d.includes(store.token)), 'the directory name is not the token');

    // The owner's page shows the record and the integrity check.
    const home = await (await fetch(store.home)).text();
    assert.match(home, /全部 1 条记录校验通过/);
    assert.match(home, /我最近睡眠很差/);
    assert.match(home, /looked up exact records \(connector\)/, 'the owner sees when the AI read what');
    const dl = await (await fetch(`${store.home}export.json`)).json();
    assert.equal(dl.entries[0].words, '我最近睡眠很差，今天出去走路以后感觉舒服了一点。');
  } finally {
    s.stop();
  }
});

test('stores are isolated, unknown links are 404, and GET on the MCP endpoint is not allowed', async () => {
  const s = await start();
  try {
    const a = await createStore(s.base);
    const b = await createStore(s.base);
    await client(a.mcp).call('remember', { words: '只属于 A 的记录：今天很焦虑', consent: 'standing' });
    const inB = await client(b.mcp).call('lookup', { text: '焦虑' });
    assert.match(inB.content[0].text, /^NO_RECORD/);
    assert.equal((await fetch(`${s.base}/u/${'x'.repeat(43)}/mcp`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${s.base}/u/short/`)).status, 404);
    assert.equal((await fetch(a.mcp)).status, 405);
  } finally {
    s.stop();
  }
});

test('with automatic recording off, standing saves are refused; settings and destroy work from the owner page', async () => {
  const s = await start();
  try {
    const st = await createStore(s.base, { auto: false });
    const c = client(st.mcp);
    const r = await c.call('remember', { words: '今天很难过', consent: 'standing' });
    assert.equal(r.isError, true);
    const set = await fetch(`${st.home}settings`, { method: 'POST', body: new URLSearchParams({ auto: 'on', tz: '480' }), redirect: 'manual' });
    assert.equal(set.status, 303);
    assert.equal((await c.call('remember', { words: '今天很难过', consent: 'standing' })).isError, undefined);

    const refused = await fetch(`${st.home}destroy`, { method: 'POST', body: new URLSearchParams({ confirm: 'yes' }) });
    assert.equal(refused.status, 400);
    const gone = await fetch(`${st.home}destroy`, { method: 'POST', body: new URLSearchParams({ confirm: '删除' }) });
    assert.equal(gone.status, 200);
    assert.equal((await fetch(st.home)).status, 404);
  } finally {
    s.stop();
  }
});
