// Hierarchical retrieval, token budget at scale, safety slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemory } from '../src/core/memory.js';
import { memStorage, clock, setup, saveOn } from './helpers.js';

async function history(env) {
  await saveOn(env, '2026-06-15', '这几天睡得很差');
  await saveOn(env, '2026-06-17', '今天整个人很麻木，感觉不真实');
  await saveOn(env, '2026-06-18', '跟小林打了电话，好受了一些');
  await saveOn(env, '2026-09-05', '我最近睡眠很差，今天出去走路以后感觉舒服了一点。');
}

test('similar past period: shows order (not cause) and what helped then', async () => {
  const env = setup();
  await history(env);
  env.clock.set('2026-09-25T21:00:00+08:00');
  const r = await env.memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
  assert.match(r.text, /SIMILAR: 06\/15\(\dd\): sleep:poor→numb↑/);
  assert.match(r.text, /a→b = came first, not cause/);
  assert.match(r.text, /HELPED: .*talk:\+/);
  assert.doesNotMatch(r.text, /NEW:/, 'numbness was recorded before');
  assert.ok(r.tokens <= 300);
});

test('grounding: a dissociation message brings the user\'s own anchor', async () => {
  const env = setup();
  await saveOn(env, '2026-08-01', '现实锚点：我叫林夏，我住在杭州，我是安全的，猫咪叫豆豆。');
  env.clock.set('2026-09-25T21:00:00+08:00');
  const r = await env.memory.recall({ query: '我感觉一切都不真实，像在做梦' });
  assert.match(r.text, /ANCHOR: .*我叫林夏/);
});

test('crisis: safety first and the user\'s own support plan, even with nothing else', async () => {
  const env = setup();
  await saveOn(env, '2026-08-01', '我的支持计划：撑不住的时候先给小林打电话 13812345678，再去楼下便利店坐一会。');
  env.clock.set('2026-09-25T23:00:00+08:00');
  const r = await env.memory.recall({ query: '我真的不想活了' });
  assert.match(r.text, /^MEMORY[\s\S]*SAFETY: possible crisis/);
  assert.match(r.text, /SUPPORT: .*小林/);
  assert.doesNotMatch(r.text, /13812345678/, 'phone numbers are masked for the AI');
  const empty = setup();
  const r2 = await empty.memory.recall({ query: '我真的不想活了' });
  assert.match(r2.text, /SAFETY/);
});

test('future-self message comes back when asked for', async () => {
  const env = setup();
  await saveOn(env, '2026-07-01', '给未来的我：你已经撑过很多次了，记得先喝水、出门走走。');
  env.clock.set('2026-09-25T21:00:00+08:00');
  const r = await env.memory.recall({ query: '我想看看过去的我给未来的我的留言' });
  assert.match(r.text, /FUTURE: from 07\/01 "给未来的我：你已经撑过很多次了/);
});

test('AI-written words stay labelled as AI-written', async () => {
  const env = setup();
  await env.memory.remember({ words: '散步对我有帮助', consent: 'user_confirmed', origin: 'ai_candidate' });
  env.clock.set('2026-09-06T10:00:00+08:00');
  const r = await env.memory.recall({ query: '我记得我说过什么有帮助吗', focus: 'search' });
  assert.match(r.text, /\(a\)/);
  assert.match(r.text, /a=AI summary/);
});

test('scale: 20,000 notes still lend at most the budget, fast', async () => {
  const storage = memStorage();
  const c = clock('2021-01-01T10:00:00+08:00');
  const memory = createMemory({ storage, clock: c, tz: 480 });
  const phrases = ['睡得很差', '很焦虑', '整个人很麻木', '心情低落', '今天去上班了', '和朋友吃了饭', '散步以后好一点', '听音乐有点用', '很累', '压力很大'];
  const entries = [];
  const start = Date.parse('2021-01-01T00:00:00Z') / 86400000;
  for (let i = 0; i < 20000; i++) {
    const day = new Date((start + Math.floor(i / 10)) * 86400000).toISOString().slice(0, 10);
    const words = `${phrases[i % 10]}，${phrases[(i * 7 + 3) % 10]}`;
    entries.push({ id: `x${i}`, savedAt: `${day}T04:00:00.000Z`, day, words, consent: 'user_asked', via: 'test', sensitivity: i % 50 === 0 ? 'restricted' : 'normal', important: false,
      items: (await import('../src/core/extract.js')).parseEntry(words).items, aiSummary: null });
  }
  await storage.save({ format: 'personal-memory', version: 1, rev: 1, entries });
  c.set('2026-06-20T10:00:00+08:00');
  const t0 = performance.now();
  const r = await memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
  const cold = performance.now() - t0;
  const t1 = performance.now();
  await memory.recall({ query: '以前什么对我有帮助？' });
  const warm = performance.now() - t1;
  assert.ok(r.tokens <= 300, `~${r.tokens} tokens`);
  assert.ok(r.units.length > 0);
  assert.ok(cold < 5000 && warm < 5000, `cold ${cold.toFixed(0)}ms warm ${warm.toFixed(0)}ms`);
});
