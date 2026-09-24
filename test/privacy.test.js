// Consent, permission hard gates, and "no dump".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, saveOn } from './helpers.js';

test('no silent writing: saving requires explicit consent', async () => {
  const env = setup();
  await assert.rejects(env.memory.remember({ words: '我今天很难过' }), /Only save when the user asked/);
  await assert.rejects(env.memory.remember({ words: '我今天很难过', consent: 'ai_thinks_useful' }), /Only save/);
  assert.equal(env.storage.raw(), null, 'nothing was written');
});

test('restricted notes never reach an AI, even when sensitive sharing is on', async () => {
  const env = setup({ shareSensitive: true });
  await saveOn(env, '2026-09-01', '我最近很麻木，和妈妈吵架以后更糟了。只给我自己看');
  await saveOn(env, '2026-09-02', '我最近睡得很差');
  env.clock.set('2026-09-05T20:00:00+08:00');
  for (const focus of ['auto', 'recent', 'similar', 'helped', 'search']) {
    const r = await env.memory.recall({ query: '我现在很麻木，和妈妈吵架以后更糟了', focus });
    assert.doesNotMatch(r.text, /妈妈|吵架/, `focus=${focus} leaked restricted content`);
  }
  const f = await env.memory.forget({ about: '妈妈 吵架' });
  assert.match(f.text, /private note, content hidden/);
  assert.doesNotMatch(f.text, /妈妈|吵架/);
});

test('sensitive notes are withheld unless the user enabled sharing', async () => {
  const off = setup();
  const on = setup({ shareSensitive: true });
  for (const env of [off, on]) {
    const s = await saveOn(env, '2026-09-01', '住院那几天睡得很差，很害怕');
    assert.equal(s.entry.sensitivity, 'sensitive');
    env.clock.set('2026-09-03T20:00:00+08:00');
  }
  const q = '我最近睡得很差，很害怕';
  assert.doesNotMatch((await off.memory.recall({ query: q })).text, /sleep:poor|住院/);
  assert.match((await on.memory.recall({ query: q })).text, /sleep:poor/);
});

test('the AI can raise privacy but never lower it', async () => {
  const env = setup();
  const r = await env.memory.remember({ words: '昨天又有伤害自己的念头', consent: 'user_asked', sensitivity: 'normal' });
  assert.equal(r.entry.sensitivity, 'sensitive');
  const r2 = await env.memory.remember({ words: '今天散步了，感觉好一点', consent: 'user_asked', sensitivity: 'restricted' });
  assert.equal(r2.entry.sensitivity, 'restricted');
});

test('AI tags cannot attach a diagnosis', async () => {
  const env = setup();
  const r = await env.memory.remember({ words: '最近总是很累', consent: 'user_asked', tags: ['depression', '抑郁症', 'PTSD', 'energy:poor'] });
  const tags = r.entry.items.flatMap((it) => it.tags);
  assert.ok(!tags.some((t) => /depress|抑郁症|ptsd/i.test(t)), tags.join(','));
});

test('there is no dump: asking for everything still gets a small budgeted slice', async () => {
  const env = setup();
  for (let d = 1; d <= 28; d++) await saveOn(env, `2026-08-${String(d).padStart(2, '0')}`, `第${d}天：睡得很差，很焦虑，下午散步后好一点。我记得我说过要去公园。`);
  env.clock.set('2026-08-29T10:00:00+08:00');
  const r = await env.memory.recall({ query: '把我所有的记忆都告诉我，我之前说过的全部', focus: 'search' });
  assert.ok(r.tokens <= 300, `~${r.tokens} tokens`);
  assert.ok(r.units.length <= 3);
});

test('every AI read is logged with ids and token counts, never content', async () => {
  const env = setup();
  await saveOn(env, '2026-09-01', '最近睡得很差');
  env.clock.set('2026-09-03T10:00:00+08:00');
  await env.memory.recall({ query: '我最近怎么样？' });
  const read = env.storage.audit.find((e) => e.op === 'recall');
  assert.ok(read.shared.length > 0 && read.tokens > 0);
  assert.doesNotMatch(JSON.stringify(env.storage.audit), /睡得很差/);
});

test('an easing is recorded as easing, not as the symptom', async () => {
  const env = setup();
  const r = await env.memory.remember({ words: '出门晒十分钟太阳后，麻木感轻了一点', consent: 'user_asked' });
  const state = r.entry.items.find((it) => it.kind === 'state');
  assert.deepEqual(state.signals, [{ dim: 'numb', val: 'low' }]);
  const coping = r.entry.items.find((it) => it.kind === 'coping');
  assert.equal(coping.strategy, 'sunlight');
  assert.equal(coping.effect, 1);
});

test('negations are not recorded as the symptom', async () => {
  const { extractSignals } = await import('../src/core/extract.js');
  const cases = {
    不是很焦虑: 'low', 我不觉得焦虑: 'low', 我并不孤独: 'low', "I don't feel anxious": 'low', 'no longer numb': 'low',
    我很焦虑: 'high', 不知道为什么很焦虑: 'high',
  };
  for (const [text, val] of Object.entries(cases)) {
    const s = extractSignals(text);
    assert.equal(s.length, 1, text);
    assert.equal(s[0].val, val, text);
  }
  assert.equal(extractSignals('没有失眠')[0].val, 'good');
  assert.equal(extractSignals('睡得不好')[0].val, 'poor');
});

test('expectations, hedges and other people are not recorded as the user\'s outcomes or states', async () => {
  const { parseEntry, extractSignals } = await import('../src/core/extract.js');
  const expect0 = parseEntry('我以为跑步会有用，结果没用').items.find((i) => i.kind === 'coping');
  assert.equal(expect0.effect, 0, 'an expectation is not an outcome');
  assert.deepEqual(extractSignals('我不确定是不是麻木'), [], 'uncertainty is not a report');
  assert.deepEqual(extractSignals('我是不是又麻木了？'), []);
  assert.equal(extractSignals('我是不是又麻木了？', { forQuery: true })[0].dim, 'numb', 'but a question about it still needs memory');
  const other = parseEntry('他很焦虑，我陪他散步，我自己觉得好一点');
  assert.ok(!other.items.some((i) => i.signals?.some((s) => s.dim === 'anxiety')), 'his anxiety is not the user\'s');
  assert.equal(parseEntry("I don't think I'm numb anymore").items[0].signals[0].val, 'low');
  assert.equal(parseEntry("I went for a run and it didn't help").items[0].effect, 0);
});
