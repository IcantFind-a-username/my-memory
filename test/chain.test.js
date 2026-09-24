// The MVP's one job: Day 1 save, Day 20 a tiny relevant context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, saveOn } from './helpers.js';

test('Day 1 remember -> Day 20 recall gives a tiny, faithful context (zh)', async () => {
  const env = setup();
  const saved = await saveOn(env, '2026-09-05', '记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。');
  assert.match(saved.text, /state sleep:poor · coping walk:\+/);

  env.clock.set('2026-09-25T21:00:00+08:00');
  const r = await env.memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
  assert.equal(r.need, true);
  assert.match(r.text, /LAST: 20d ago sleep:poor\(s\)/);
  assert.match(r.text, /HELPED: walk:\+/);
  assert.match(r.text, /NEW: numb↑ not in any earlier shared note/, 'must not invent an earlier numbness record');
  assert.doesNotMatch(r.text, /→/, 'one note cannot show a before/after pattern');
  assert.ok(r.tokens <= 150, `expected a tiny context, got ~${r.tokens} tokens`);
  assert.match(r.preview, /20 天前/);
  assert.match(r.preview, /散步/);
});

test('same chain in English', async () => {
  const env = setup();
  await saveOn(env, '2026-09-05', "Remember: I've been sleeping badly lately, but today I went for a walk and felt a bit better.");
  env.clock.set('2026-09-25T09:00:00+08:00');
  const r = await env.memory.recall({ query: 'I feel numb again and I don\'t know why.' });
  assert.match(r.text, /sleep:poor/);
  assert.match(r.text, /walk:\+/);
  assert.match(r.preview, /20 days ago/);
});

test('delta context: ids already in the chat are not resent', async () => {
  const env = setup();
  await saveOn(env, '2026-09-05', '我最近睡眠很差，今天出去走路以后感觉舒服了一点。');
  env.clock.set('2026-09-25T21:00:00+08:00');
  const first = await env.memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
  const again = await env.memory.recall({ query: '我现在又觉得很麻木，不知道为什么。', seen: first.ids });
  assert.equal(again.units.length, 0);
  assert.match(again.text, /nothing new/);
  assert.ok(again.tokens < 20);
});
