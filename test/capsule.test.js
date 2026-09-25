// The capsule runs the same core, bundled into one offline HTML file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { bundleCore } from '../scripts/build.js';
import { memStorage, clock } from './helpers.js';

test('bundled core (as shipped in the capsule) runs the Day 1 -> Day 20 chain', async () => {
  const bundle = bundleCore();
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m);
  const PM = vm.runInNewContext(`${bundle}\nPM`, { structuredClone, crypto: globalThis.crypto, performance, TextEncoder });
  const c = clock('2026-09-05T10:00:00+08:00');
  const memory = PM.createMemory({ storage: memStorage(), clock: c, tz: 480, via: 'capsule' });
  await memory.remember({ words: '我最近睡眠很差，今天出去走路以后感觉舒服了一点。', consent: 'user_asked' });
  c.set('2026-09-25T21:00:00+08:00');
  const r = await memory.recall({ query: '我现在又觉得很麻木，不知道为什么。', headerLang: 'zh', withIds: false });
  assert.match(r.text, /^【我的记忆】/);
  assert.match(r.text, /sleep:poor/);
  assert.doesNotMatch(r.text, /ids:/);
});

test('capsule page cannot phone home', () => {
  const html = fs.readFileSync(new URL('../capsule/capsule.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'no external URLs in the page');
});
