import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, saveOn } from './helpers.js';

test('forget "last" removes the note from storage and from recall', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差，散步以后好一点');
  const r = await env.memory.forget({ id: 'last' });
  assert.equal(r.deleted, true);
  assert.equal(env.storage.raw().entries.length, 0);
  env.clock.set('2026-09-02T10:00:00+08:00');
  const q = await env.memory.recall({ query: '我最近怎么样？以前什么对我有帮助？' });
  assert.doesNotMatch(q.text, /walk|sleep/);
});

test('forget by an item id from a recall result deletes the whole note', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差');
  env.clock.set('2026-09-02T10:00:00+08:00');
  const q = await env.memory.recall({ query: '我最近怎么样？', focus: 'recent' });
  const id = q.units.find((u) => !u.key.startsWith('~'))?.key ?? env.storage.raw().entries[0].id;
  assert.equal((await env.memory.forget({ id })).deleted, true);
  assert.equal(env.storage.raw().entries.length, 0);
});

test('forget "about" lists candidates, deletes nothing', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '和小林打电话以后好受一些');
  const r = await env.memory.forget({ about: '小林 打电话' });
  assert.equal(r.deleted, false);
  assert.equal(r.candidates.length, 1);
  assert.equal(env.storage.raw().entries.length, 1);
});
