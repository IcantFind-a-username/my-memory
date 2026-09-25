// Deleting is deliberate: hide now, delete after a cooling-off period, undo in between.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, saveOn } from './helpers.js';

test('forget hides at once, can be undone, and deletes for good after 7 days', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差，散步以后好一点');
  const hidden = await env.memory.forget({ id: 'last' });
  assert.equal(hidden.hidden, true);
  env.clock.set('2026-09-02T10:00:00+08:00');
  const q = await env.memory.recall({ query: '我最近怎么样？以前什么对我有帮助？' });
  assert.doesNotMatch(q.text, /walk|sleep/, 'no AI sees a hidden note');

  const undone = await env.memory.forget({ id: hidden.id, undo: true });
  assert.equal(undone.restored, true);
  assert.match((await env.memory.recall({ query: '我最近怎么样？' })).text, /sleep:poor/);

  await env.memory.forget({ id: hidden.id });
  env.clock.set('2026-09-09T10:00:00+08:00');
  const st = await env.memory.status();
  const [tomb] = env.storage.raw().entries;
  assert.equal(tomb.tombstone, true);
  assert.equal(tomb.words, undefined, 'the words are gone');
  assert.equal(st.chain.ok, true, 'the chain still verifies around the deletion');
  assert.equal(st.chain.deleted, 1);
  assert.equal((await env.memory.forget({ id: hidden.id, undo: true })).restored, undefined);
});

test('forget by an item id from a recall result hides the whole note', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差');
  env.clock.set('2026-09-02T10:00:00+08:00');
  const q = await env.memory.recall({ query: '我最近怎么样？', focus: 'recent' });
  const id = q.units.find((u) => !u.key.startsWith('~'))?.key ?? env.storage.raw().entries[0].id;
  assert.equal((await env.memory.forget({ id })).hidden, true);
  assert.equal(env.storage.raw().entries[0].hidden, true);
});

test('forget "about" lists candidates, hides nothing', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '和小林打电话以后好受一些');
  const r = await env.memory.forget({ about: '小林 打电话' });
  assert.equal(r.deleted, false);
  assert.equal(r.candidates.length, 1);
  assert.equal(env.storage.raw().entries[0].hidden, undefined);
});
