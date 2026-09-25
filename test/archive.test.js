// The archive: verbatim, timed, append-only, tamper-evident, exactly retrievable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemory } from '../src/core/memory.js';
import { verifyChain } from '../src/core/chain.js';
import { memStorage, clock, setup, saveOn } from './helpers.js';

function autoSetup(policy = {}) {
  const storage = memStorage();
  const c = clock('2026-09-05T21:14:00+08:00');
  return { storage, clock: c, memory: createMemory({ storage, clock: c, tz: 480, via: 'test', policy: { autoRecord: true, ...policy } }) };
}

test('every record is chained; editing words or removing a record is detected', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差');
  await saveOn(env, '2026-09-02', '今天散步以后好一点');
  await saveOn(env, '2026-09-03', '今天整个人很麻木');
  const doc = env.storage.raw();
  assert.deepEqual(doc.entries.map((e) => e.seq), [1, 2, 3]);
  assert.equal(verifyChain(doc.entries).ok, true);

  const edited = structuredClone(doc.entries);
  edited[1].words = '今天散步以后好多了';
  assert.deepEqual(verifyChain(edited).problems.map((p) => [p.seq, p.issue]), [[2, 'edited']]);

  const removed = structuredClone(doc.entries).filter((e) => e.seq !== 2);
  assert.ok(verifyChain(removed).problems.some((p) => p.issue === 'missing'));

  await env.storage.save({ ...doc, entries: edited });
  assert.match((await env.memory.status()).text, /WARNING: 1 problem\(s\): record #2 edited/);
});

test('automatic recording saves without being asked, tells the user once, and can be paused', async () => {
  const env = autoSetup();
  const first = await env.memory.remember({ words: '我现在又觉得很麻木', consent: 'standing' });
  assert.match(first.text, /first automatic save: tell the user once/);
  env.clock.set('2026-09-05T21:20:00+08:00');
  const second = await env.memory.remember({ words: '刚才出去走了一圈，好受了一点', consent: 'standing' });
  assert.match(second.text, /Do not announce routine saves/);
  assert.doesNotMatch(second.text, /first automatic save/);

  await env.memory.setPaused(true);
  const paused = await env.memory.remember({ words: '又睡不着了', consent: 'standing' });
  assert.equal(paused.saved, false);
  await env.memory.setPaused(false);
  assert.equal((await env.memory.remember({ words: '又睡不着了', consent: 'standing' })).saved, true);

  const off = setup();
  await assert.rejects(off.memory.remember({ words: '我很难过', consent: 'standing' }), /Automatic recording is off/);
});

test('small talk is not recorded even when recording is on', async () => {
  const env = autoSetup();
  const r = await env.memory.remember({ words: '嗯嗯', consent: 'standing' });
  assert.equal(r.saved, false);
  assert.equal(env.storage.raw(), null);
});

test('later understanding is added next to the original, never over it', async () => {
  const env = autoSetup();
  const orig = await env.memory.remember({ words: '我不记得昨天下午去过哪里，手机里有一张公园的照片', consent: 'standing', state: '很远的我' });
  env.clock.set('2026-09-12T10:00:00+08:00');
  await env.memory.remember({ words: '后来想起来了，那天是和小林一起去的公园', consent: 'user_asked', annotates: orig.id });
  const r = await env.memory.lookup({ ids: [orig.id] });
  assert.match(r.text, /\[\w+\] 2026-09-05 21:14 · .* · state: 很远的我 · verbatim, unchanged since saved/);
  assert.match(r.text, /"我不记得昨天下午去过哪里，手机里有一张公园的照片"/);
  assert.match(r.text, /added later 2026-09-12 10:00: "后来想起来了，那天是和小林一起去的公园"/);
  assert.equal(env.storage.raw().entries.find((e) => e.id === orig.id).words, '我不记得昨天下午去过哪里，手机里有一张公园的照片');
});

test('lookup finds exact records by id, date or words, never private ones, and says when there is nothing', async () => {
  const env = autoSetup();
  await env.memory.remember({ words: '今天睡得很差', consent: 'standing' });
  env.clock.set('2026-09-06T08:00:00+08:00');
  await env.memory.remember({ words: '和妈妈吵架了，只给我自己看', consent: 'standing' });
  env.clock.set('2026-09-07T09:30:00+08:00');
  await env.memory.remember({ words: '出门走了十分钟，好受了一点', consent: 'standing' });

  assert.match((await env.memory.lookup({ date: '2026-09-05' })).text, /2026-09-05 21:14[\s\S]*"今天睡得很差"/);
  assert.match((await env.memory.lookup({ text: '走了十分钟' })).text, /2026-09-07 09:30/);
  const all = await env.memory.lookup({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(all.found, 2);
  assert.doesNotMatch(all.text, /妈妈|吵架/);
  assert.match((await env.memory.lookup({ date: '2026-08-01' })).text, /^NO_RECORD/);
  await assert.rejects(env.memory.lookup({}), /Say which records/);
});

test('an older unchained file is sealed on first load, and keeps verifying afterwards', async () => {
  const storage = memStorage();
  await storage.save({ format: 'personal-memory', version: 1, rev: 3, entries: [
    { id: 'aaaa', savedAt: '2026-08-01T01:00:00.000Z', day: '2026-08-01', words: '睡得很差', consent: 'user_asked', via: 'mcp', sensitivity: 'normal', important: false, items: [{ kind: 'state', text: '睡得很差', signals: [{ dim: 'sleep', val: 'poor' }], tags: ['sleep'], epistemic: 'self_report', back: 0, span: 1 }] },
    { id: 'bbbb', savedAt: '2026-08-02T01:00:00.000Z', day: '2026-08-02', words: '散步后好一点', consent: 'user_asked', via: 'mcp', sensitivity: 'normal', important: false, items: [{ kind: 'coping', text: '散步后好一点', strategy: 'walk', effect: 1, tags: ['walk'], epistemic: 'self_report', back: 0, span: 1 }] },
  ] });
  const memory = createMemory({ storage, clock: clock('2026-09-01T10:00:00+08:00'), tz: 480 });
  const st = await memory.status();
  assert.equal(st.chain.ok, true);
  assert.equal(storage.raw().version, 2);
  assert.deepEqual(storage.raw().entries.map((e) => e.seq), [1, 2]);
});
