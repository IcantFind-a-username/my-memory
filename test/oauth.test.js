// Sign-in as ChatGPT (published app) and Claude (connector) do it: MCP authorization with DCR + PKCE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/http/server.js';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-oauth-'));
  const server = http.createServer(createApp({ dataDir, secret: crypto.randomBytes(32), verify: { path: '/.well-known/openai-apps-challenge', token: 'verify-123' } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, dataDir, stop: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

const form = (o) => new URLSearchParams(o);
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function signIn(base, { clientName = 'Claude', key } = {}) {
  const reg = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) })).json();
  const { verifier, challenge } = pkce();
  const params = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${base}/mcp` };
  const pageRes = await fetch(`${base}/authorize?${form(params)}`);
  assert.equal(pageRes.status, 200);
  assert.match(pageRes.headers.get('content-security-policy'), /form-action 'self' https:\/\/claude\.ai/);
  const page = await pageRes.text();
  assert.match(page, new RegExp(`<b>${clientName}</b> 想连接你的记忆库`));
  let storeKey = key;
  if (!storeKey) {
    const created = await (await fetch(`${base}/authorize`, { method: 'POST', body: form({ ...params, action: 'create', auto: 'on', tz: '480' }) })).text();
    storeKey = created.match(/\/u\/([A-Za-z0-9_-]{43})\//)[1];
  }
  const back = await fetch(`${base}/authorize`, { method: 'POST', body: form({ ...params, action: 'existing', key: `${base}/u/${storeKey}/` }), redirect: 'manual' });
  assert.equal(back.status, 302);
  const loc = new URL(back.headers.get('location'));
  assert.equal(`${loc.origin}${loc.pathname}`, REDIRECT);
  assert.equal(loc.searchParams.get('state'), 'xyz');
  const code = loc.searchParams.get('code');
  const tok = await fetch(`${base}/token`, { method: 'POST', body: form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }) });
  assert.equal(tok.status, 200);
  return { ...(await tok.json()), clientId: reg.client_id, storeKey, code, verifier };
}

function mcp(base, accessToken) {
  return async (method, params) => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };
}

test('discovery: unauthenticated MCP gets 401 pointing to metadata; metadata and verification are served', async () => {
  const s = await start();
  try {
    const r = await mcp(s.base)('initialize', {});
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
    const pr = await (await fetch(`${s.base}/.well-known/oauth-protected-resource`)).json();
    assert.equal(pr.resource, `${s.base}/mcp`);
    const as = await (await fetch(`${s.base}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.equal(as.registration_endpoint, `${s.base}/register`);
    assert.equal(await (await fetch(`${s.base}/.well-known/openai-apps-challenge`)).text(), 'verify-123');
    assert.equal((await fetch(`${s.base}/privacy`)).status, 200);
    assert.equal((await fetch(`${s.base}/terms`)).status, 200);
  } finally {
    s.stop();
  }
});

test('sign in by creating a store, then use memory tools with the access token', async () => {
  const s = await start();
  try {
    const t = await signIn(s.base);
    assert.equal(t.token_type, 'Bearer');
    const call = mcp(s.base, t.access_token);
    assert.equal((await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } })).status, 200);
    const saved = await call('tools/call', { name: 'remember', arguments: { words: '我现在又觉得很麻木', consent: 'standing' } });
    assert.match(saved.json.result.content[0].text, /Recorded/);
    const found = await call('tools/call', { name: 'lookup', arguments: { text: '麻木' } });
    assert.match(found.json.result.content[0].text, /"我现在又觉得很麻木"/);
    assert.doesNotMatch(JSON.stringify(fs.readdirSync(s.dataDir, { recursive: true })), new RegExp(t.storeKey), 'no key on disk');
  } finally {
    s.stop();
  }
});

test('ChatGPT and Claude can both sign in to the same existing store', async () => {
  const s = await start();
  try {
    const claude = await signIn(s.base, { clientName: 'Claude' });
    await mcp(s.base, claude.access_token)('tools/call', { name: 'remember', arguments: { words: '出门走了十分钟，好受了一点', consent: 'standing' } });
    const gpt = await signIn(s.base, { clientName: 'ChatGPT', key: claude.storeKey });
    const r = await mcp(s.base, gpt.access_token)('tools/call', { name: 'lookup', arguments: { text: '走了十分钟' } });
    assert.match(r.json.result.content[0].text, /出门走了十分钟/);
  } finally {
    s.stop();
  }
});

test('codes are single-use and PKCE-bound; refresh works; revoking disconnects every app', async () => {
  const s = await start();
  try {
    const t = await signIn(s.base);
    const reuse = await fetch(`${s.base}/token`, { method: 'POST', body: form({ grant_type: 'authorization_code', code: t.code, redirect_uri: REDIRECT, client_id: t.clientId, code_verifier: t.verifier }) });
    assert.equal((await reuse.json()).error, 'invalid_grant');

    const refreshed = await (await fetch(`${s.base}/token`, { method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }) })).json();
    assert.ok(refreshed.access_token);
    assert.equal((await mcp(s.base, refreshed.access_token)('ping', {})).status, 200);
    assert.equal((await mcp(s.base, 'pm1.forged')('ping', {})).status, 401);

    const revoke = await fetch(`${s.base}/u/${t.storeKey}/revoke`, { method: 'POST', redirect: 'manual' });
    assert.equal(revoke.status, 303);
    assert.equal((await mcp(s.base, refreshed.access_token)('ping', {})).status, 401);
    const again = await (await fetch(`${s.base}/token`, { method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }) })).json();
    assert.equal(again.error, 'invalid_grant');
  } finally {
    s.stop();
  }
});

test('bad requests: unknown client, foreign redirect, missing PKCE, wrong key', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`)).status, 400);
    const reg = await (await fetch(`${s.base}/register`, { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json();
    assert.equal((await fetch(`${s.base}/authorize?${form({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'S256' })}`)).status, 400);
    const noPkce = await fetch(`${s.base}/authorize?${form({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT })}`, { redirect: 'manual' });
    assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
    const { challenge } = pkce();
    const wrong = await fetch(`${s.base}/authorize`, { method: 'POST', body: form({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', action: 'existing', key: 'A'.repeat(43) }) });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /没有找到这个记忆库/);
    assert.equal((await fetch(`${s.base}/register`, { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) })).status, 400);
  } finally {
    s.stop();
  }
});
