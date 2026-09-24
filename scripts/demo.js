#!/usr/bin/env node
// The MVP's proof: Day 1 "remember", Day 20 a tiny, faithful context.
// Uses a throwaway folder and a fake clock; touches nothing of yours.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../src/core/memory.js';
import { fileStorage } from '../src/node/file-store.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-memory-demo-'));
let now = new Date('2026-09-05T10:00:00+08:00');
const memory = createMemory({ storage: fileStorage(dir), clock: () => now, tz: 480, via: 'demo' });
const rule = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);

rule('Day 1 · 用户');
const day1 = '记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。';
console.log(day1);
const saved = await memory.remember({ words: day1, consent: 'user_asked' });
rule('Day 1 · remember → 返回给 AI');
console.log(saved.text);
console.log(`(给用户看) ${saved.human}`);

now = new Date('2026-09-25T21:00:00+08:00');
for (const [label, q] of [['Day 20 · 用户', '我现在又觉得很麻木，不知道为什么。'], ['Day 20 · 无关问题', '帮我写一封邮件给老板，说我明天请假']]) {
  rule(label);
  console.log(q);
  const r = await memory.recall({ query: q });
  rule(`recall → Machine Context (≈${r.tokens} tokens)`);
  console.log(r.text);
  if (r.preview) {
    rule('Human Preview');
    console.log(r.preview);
  }
}

rule('同一对话里再问一次（delta：已发过的不重发）');
const first = await memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
const again = await memory.recall({ query: '我现在又觉得很麻木，不知道为什么。', seen: first.ids });
console.log(again.text);

rule('更长的历史：6 月曾有一段类似时期');
now = new Date('2026-06-15T12:00:00+08:00');
await memory.remember({ words: '这几天睡得很差', consent: 'user_asked' });
now = new Date('2026-06-17T12:00:00+08:00');
await memory.remember({ words: '今天整个人很麻木，感觉不真实', consent: 'user_asked' });
now = new Date('2026-06-18T12:00:00+08:00');
await memory.remember({ words: '跟小林打了电话，好受了一些', consent: 'user_asked' });
now = new Date('2026-08-01T12:00:00+08:00');
await memory.remember({ words: '现实锚点：我叫林夏，我住在杭州，我是安全的。', consent: 'user_asked' });
now = new Date('2026-09-25T21:00:00+08:00');
const rich = await memory.recall({ query: '我现在又觉得很麻木，不知道为什么。' });
console.log(`(≈${rich.tokens} tokens)\n${rich.text}`);
rule('Human Preview');
console.log(rich.preview);

rule('访问记录（只有编号和数量，没有内容）');
console.log((await memory.accessLog(5)).text);

fs.rmSync(dir, { recursive: true, force: true });
