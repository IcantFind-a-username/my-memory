// The Memory File: send one file to any AI; save the AI's 【新记忆】 lines back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMemoryFile, memoryFile } from '../src/core/memfile.js';
import { starterText, STARTERS } from '../scripts/build.js';
import { setup, saveOn } from './helpers.js';

async function history(env) {
  await saveOn(env, '2026-06-17', '今天整个人很麻木，感觉不真实');
  await saveOn(env, '2026-08-01', '现实锚点：我叫林夏，我住在杭州，我是安全的。');
  await saveOn(env, '2026-09-01', '住院那几天很害怕');
  await saveOn(env, '2026-09-02', '只给我自己看：我和阿紫吵架了');
  await saveOn(env, '2026-09-05', '记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。');
  env.clock.set('2026-09-25T21:00:00+08:00');
}

test('the file carries instructions and notes, never private notes, sensitive only on request', async () => {
  const env = setup();
  await history(env);
  const f = await env.memory.exportForAI();
  assert.match(f.text, /## 给 AI 的说明/);
  assert.match(f.text, /【新记忆】日期｜类型｜内容/);
  assert.match(f.text, /2026-09-05｜感受、方法｜我最近睡眠很差，今天出去走路以后感觉舒服了一点。（有帮助）/);
  assert.match(f.text, /9月5日我记录/, 'summary uses absolute dates and the first person');
  assert.doesNotMatch(f.text, /阿紫|吵架/);
  assert.doesNotMatch(f.text, /住院/);
  assert.match((await env.memory.exportForAI({ includeSensitive: true })).text, /住院.*（敏感）/);
  assert.doesNotMatch((await env.memory.exportForAI({ includeSensitive: true })).text, /阿紫/);
});

test('a file round-trips into a fresh memory, and Day 20 recall works from it', async () => {
  const a = setup();
  await history(a);
  const text = (await a.memory.exportForAI()).text;
  const b = setup();
  b.clock.set('2026-09-25T21:00:00+08:00');
  const r = await b.memory.importMemoryFile(text);
  assert.equal(r.added, 3);
  const again = await b.memory.importMemoryFile(text);
  assert.equal(again.added, 0, 'importing twice adds nothing');
  const q = await b.memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
  assert.match(q.text, /sleep:poor/);
  assert.match(q.text, /walk:\+/);
});

test('AI reply lines are parsed; instruction examples and chatter are not', () => {
  const reply = [
    '听起来今天很不容易。',
    '【新记忆】2026-09-25｜方法｜出门走了十分钟，好受了一点（有帮助）',
    '[NEW MEMORY] 2026-09-24 | feeling | numb again after a bad night',
    '【新记忆】今天｜感受｜很累',
    '【新记忆】2099-01-01｜事件｜来自未来',
    '   【新记忆】日期｜类型｜内容',
    '2026-13-40｜感受｜不存在的日期',
  ].join('\n');
  const lines = parseMemoryFile(reply, '2026-09-25');
  assert.deepEqual(lines.map((l) => [l.day, l.kind, l.origin]), [
    ['2026-09-25', 'coping', 'ai_candidate'],
    ['2026-09-24', 'state', 'ai_candidate'],
    ['2026-09-25', 'state', 'ai_candidate'],
    ['2026-09-25', 'event', 'ai_candidate'],
  ]);
});

test('a long history is compressed by month so the file stays sendable', () => {
  const entries = [];
  for (let i = 0; i < 1000; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    entries.push({ id: `x${i}`, day: d, savedAt: `${d}T01:00:00Z`, words: `第${i}天睡得很差，散步后好一点`, sensitivity: 'normal', origin: 'user_words',
      items: [{ kind: 'state', text: '睡得很差', signals: [{ dim: 'sleep', val: 'poor' }], tags: ['sleep'], epistemic: 'self_report', back: 0, span: 1 },
        { kind: 'coping', text: '散步后好一点', strategy: 'walk', effect: 1, tags: ['walk'], epistemic: 'self_report', back: 0, span: 1 }] });
  }
  const today = Math.floor(Date.UTC(2026, 8, 25) / 86400000);
  const f = memoryFile(entries, { lang: 'zh', today, maxNotes: 200 });
  assert.equal(f.notes, 200);
  assert.equal(f.compressed, 800);
  assert.match(f.text, /2024-01（31 条已压缩）：睡得差 31 天、散步有帮助 31\/31 次/);
  assert.ok(f.tokens < 12000, `~${f.tokens} tokens`);
});

test('the committed starter files match the generator', () => {
  for (const [name, lang] of Object.entries(STARTERS)) {
    const committed = fs.readFileSync(new URL(`../start/${name}`, import.meta.url), 'utf8');
    assert.equal(committed, starterText(lang), `${name} is stale: run npm run build`);
  }
});
