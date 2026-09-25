// The Anchor Card: one short "about me" that goes into each AI's personalisation settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../start/${name}`, import.meta.url), 'utf8');

function parts(text, headA, headB) {
  const a = text.indexOf(headA);
  const b = text.indexOf(headB);
  assert.ok(a >= 0 && b > a, 'both parts present');
  return [text.slice(a, b).trim(), text.slice(b).trim()];
}

test('example cards fit ChatGPT free-tier custom instruction boxes (1,500 characters each)', () => {
  for (const [file, a, b] of [
    ['锚点卡示例.txt', '【我的锚点卡 · 关于我】', '【我的锚点卡 · 怎么陪我】'],
    ['anchor-card-example.txt', '[MY ANCHOR CARD · ABOUT ME]', '[MY ANCHOR CARD · HOW TO BE WITH ME]'],
  ]) {
    for (const part of parts(read(file), a, b)) assert.ok([...part].length <= 1400, `${file}: ${[...part].length} chars`);
  }
});

test('builders carry the safety and honesty rules the card depends on', () => {
  const zh = read('锚点卡生成器.txt');
  for (const rule of ['只用我说过的内容', '不要诊断我', '不是因果', '不要写全名、电话号码', '每段不超过 1400 个字', '安全第一', '更新锚点卡'])
    assert.ok(zh.includes(rule), rule);
  const en = read('anchor-card-builder.txt');
  for (const rule of ['Use only what I told you', "Don't diagnose", 'not cause', 'No full names, phone numbers', 'at most 1,400 characters', 'safety first', 'update my anchor card'])
    assert.ok(en.includes(rule), rule);
});

test('the example card contains no phone numbers', () => {
  for (const f of ['锚点卡示例.txt', 'anchor-card-example.txt']) assert.doesNotMatch(read(f), /\d{7,}/);
});
