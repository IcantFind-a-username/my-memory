// The real server process over stdio, as an AI app would run it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mcp-'));
  const proc = spawn(process.execPath, ['src/mcp/server.js'], { env: { ...process.env, PERSONAL_MEMORY_DIR: dir, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiters = new Map();
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiters.get(msg.id)?.(msg);
    }
  });
  let next = 1;
  const request = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiters.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { proc, dir, request, notify, stop: () => { proc.stdin.end(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('MCP handshake, tools, save and recall through the real server', async () => {
  const s = startServer();
  try {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /never on your own/);
    s.notify('notifications/initialized');

    const list = await s.request('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['remember', 'recall', 'lookup', 'forget', 'memory_info']);
    const schemaTokens = JSON.stringify(list.result.tools).length / 3;
    assert.ok(schemaTokens < 1300, `tool definitions cost ~${schemaTokens.toFixed(0)} tokens per conversation`);

    const noConsent = await s.request('tools/call', { name: 'remember', arguments: { words: '我很难过' } });
    assert.equal(noConsent.result.isError, true);

    const saved = await s.request('tools/call', { name: 'remember', arguments: { words: '记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。', consent: 'user_asked' } });
    assert.match(saved.result.content[0].text, /Saved \(id \w+\)/);
    const file = JSON.parse(fs.readFileSync(path.join(s.dir, 'memory.json'), 'utf8'));
    assert.equal(file.entries.length, 1);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.dir, 'memory.json')).mode & 0o777, 0o600);

    const recall = await s.request('tools/call', { name: 'recall', arguments: { query: '我最近发生了什么？' } });
    const [machine, human] = recall.result.content;
    assert.deepEqual(machine.annotations.audience, ['assistant']);
    assert.deepEqual(human.annotations.audience, ['user']);
    assert.match(machine.text, /sleep:poor/);

    const status = await s.request('tools/call', { name: 'memory_info', arguments: { action: 'status' } });
    assert.match(status.result.content[0].text, /Notes: 1/);
    assert.doesNotMatch(status.result.content[0].text, /睡眠/, 'status reveals counts, not content');

    const unknown = await s.request('no/such/method', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    s.stop();
  }
});

test('a corrupt memory file is never overwritten', async () => {
  const s = startServer();
  try {
    fs.writeFileSync(path.join(s.dir, 'memory.json'), '{ this is not json');
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    const r = await s.request('tools/call', { name: 'remember', arguments: { words: '今天散步了', consent: 'user_asked' } });
    assert.equal(r.result.isError, true);
    assert.equal(fs.readFileSync(path.join(s.dir, 'memory.json'), 'utf8'), '{ this is not json');
  } finally {
    s.stop();
  }
});
