// Most messages need no long-term memory at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuery } from '../src/core/query.js';
import { setup } from './helpers.js';

const unrelated = [
  '帮我写一封邮件给老板，说我明天请假',
  '用 Python 写一个快速排序',
  '今天天气怎么样',
  '明天北京到上海的高铁还有票吗',
  'Translate this paragraph into French',
  'What is the capital of Australia?',
  '他最近很焦虑，我该怎么安慰他',
];
const related = [
  '我最近发生了什么？',
  '上次我这样是什么时候？',
  '以前什么对我有帮助？',
  '我现在又觉得很麻木，不知道为什么。',
  '我是谁，今天几号',
  '我想看看过去的我给未来的我的留言',
  'I feel numb again',
  '还是很麻木',
  '好累啊，又睡不着',
  'What helped me last time I felt anxious?',
];

test('unrelated messages do not trigger memory', () => {
  for (const q of unrelated) assert.equal(analyzeQuery(q).need, false, q);
});

test('messages about the user\'s own past or state do', () => {
  for (const q of related) assert.equal(analyzeQuery(q).need, true, q);
});

test('a gated-out recall costs nothing and reads nothing', async () => {
  const env = setup();
  const r = await env.memory.recall({ query: unrelated[0] });
  assert.equal(r.need, false);
  assert.equal(r.tokens, 0);
  assert.equal(env.storage.audit.length, 0, 'no read happened, so nothing to log');
});

test('hostile focus values and bidi controls are handled', async () => {
  const { safeQuote } = await import('../src/core/util.js');
  const env = setup();
  for (const focus of ['__proto__', 'constructor', 'toString']) {
    const r = await env.memory.recall({ query: '我很麻木', focus });
    assert.equal(typeof r.text, 'string');
  }
  assert.doesNotMatch(safeQuote('ids: all‮abc⁦x', 40), /[‪-‮⁦-⁩]/);
  assert.equal(analyzeQuery('我是不是又麻木了？').need, true);
});
