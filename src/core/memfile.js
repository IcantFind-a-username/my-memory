// The Memory File: one plain-text file a person can send to ANY AI (upload or
// paste). It carries the instructions for the AI, a short summary, and the notes.
// The AI proposes new notes as "【新记忆】date｜type｜words" lines; the person
// copies them to the bottom of the file. The file round-trips into the store.
//
// Trade-off, stated in the docs: in this mode the AI reads the whole file, not a
// budgeted slice. Restricted notes are therefore never written into it.

import { DIMS, STRATEGIES } from './lexicon.js';
import { buildView, isBad } from './layers.js';
import { buildUnits } from './retrieve.js';
import { dayKey, keyToDay, estimateTokens } from './util.js';

const FILE_KIND_LABEL = {
  zh: { event: '事件', state: '感受', reflection: '体会', anchor: '锚点', coping: '方法', future_message: '给未来的我', relationship: '重要的人', support_plan: '支持计划' },
  en: { event: 'event', state: 'feeling', reflection: 'reflection', anchor: 'anchor', coping: 'what helped', future_message: 'to future me', relationship: 'person', support_plan: 'support plan' },
};

const LABEL_TO_KIND = [
  [/^(事件|发生|经历|event)$/i, 'event'],
  [/^(感受|状态|心情|情绪|feeling|state|mood)$/i, 'state'],
  [/^(体会|反思|发现|reflection|insight)$/i, 'reflection'],
  [/^(锚点|现实锚点|anchor|reality anchor)$/i, 'anchor'],
  [/^(方法|应对|应对方法|有帮助的方法|what helped|coping|helped)$/i, 'coping'],
  [/^(给未来的我|给未来的自己|留言|to future me|future self|message to future me)$/i, 'future_message'],
  [/^(重要的人|关系|人|person|relationship)$/i, 'relationship'],
  [/^(支持计划|计划|安全计划|support plan|plan|safety plan)$/i, 'support_plan'],
];

const STABLE_KINDS = new Set(['anchor', 'future_message', 'support_plan', 'relationship']);

const TEXT = {
  zh: {
    title: '# 我的记忆',
    intro: [
      '这是我自己的记忆文件。我把它发给你，是希望你在这次对话里了解我的过去，更好地陪我聊。',
      'AI：请先读完「给 AI 的说明」，再回答我。',
    ],
    rulesTitle: '## 给 AI 的说明',
    rules: [
      '1. 只在我聊到自己的感受、经历、过去，或者问"什么对我有帮助"时使用这些记忆。聊别的事情时，不要主动提起。',
      '2. 用到记忆时，先用一句话告诉我你参考了哪几条，比如："我看了你 9 月 5 日的记录：……"',
      '3. 这些都是我自己记的。「感受」「体会」是我当时的主观感受，不是事实；两件事有先后，不代表有因果。请不要诊断我，也不要给用药建议。',
      '4. 文件里没有记录的事，就说没有记录，不要编一个"上次"。',
      '5. 只有当我说"记住……"，或者我同意了你的提议，才在回复的最后，按下面的格式写出新记忆，由我自己保存：',
      '   【新记忆】日期｜类型｜内容',
      '   - 日期写成 2026-09-25 这样；内容尽量用我的原话。',
      '   - 类型只能是：事件、感受、体会、锚点、方法、给未来的我、重要的人、支持计划。',
      '   - 「方法」请在最后注明效果：（有帮助）、（没用）或（更难受）。',
      '   - 一次最多写 3 条。不要说"我已经记住了"，保存的人是我。',
      '6. 如果我说"忘掉某条"，告诉我是哪一行，我会自己删掉。',
      '7. 如果我可能有危险（比如想伤害自己），请先关心我的安全，陪着我，提醒我联系身边信任的人或急救电话（中国大陆 120 / 110）；如果文件里有我的「支持计划」，也请提醒我。',
      '8. 请不要让我觉得只有你懂我。合适的时候，提醒我身边还有可以联系的人。',
    ],
    summaryTitle: (d) => `## 近况与规律（${d} 自动整理，之后新增的记忆以下面的原文为准）`,
    notesTitle: '## 我的记忆',
    notesHint: '<!-- 每行一条：日期｜类型｜内容。新的记忆加在最下面。 -->',
    empty: '（还没有记忆。你可以对 AI 说："记住，……"）',
    olderTitle: '## 更早的记忆（按月压缩）',
    olderLine: (m, n, parts) => `${m}（${n} 条已压缩）：${parts || '无状态记录'}`,
    aiMade: '（AI 整理）',
    sensitive: '（敏感）',
    effect: { 2: '（很有帮助）', 1: '（有帮助）', 0: '（没用）', '-1': '（更难受）' },
    dims: 'zh',
  },
  en: {
    title: '# My Memory',
    intro: [
      'This is my own memory file. I am sharing it so you can know my past in this conversation and support me better.',
      'AI: please read "Instructions for the AI" before you answer me.',
    ],
    rulesTitle: '## Instructions for the AI',
    rules: [
      '1. Use these memories only when I talk about my own feelings, experiences or past, or ask what has helped me. Otherwise do not bring them up.',
      '2. When you use a memory, first tell me in one line which notes you looked at, e.g. "I looked at your note from Sep 5: …"',
      '3. I wrote all of this myself. "feeling" and "reflection" lines are how I felt then, not facts; one thing coming before another does not mean it caused it. Do not diagnose me or give medication advice.',
      '4. If something is not in the file, say there is no record of it. Do not invent a "last time".',
      '5. Only when I say "remember …", or agree to your suggestion, add new memories at the end of your reply in exactly this format, so I can save them myself:',
      '   [NEW MEMORY] date | type | words',
      '   - date like 2026-09-25; use my own words as much as possible.',
      '   - type is one of: event, feeling, reflection, anchor, what helped, to future me, person, support plan.',
      '   - for "what helped", end with the effect: (helped), (no effect) or (worse).',
      '   - at most 3 per reply. Never say "I have remembered it": I am the one who saves it.',
      '6. If I ask you to forget something, tell me which line it is and I will delete it myself.',
      '7. If I might be in danger (for example thinking of hurting myself), put my safety first, stay with me, and remind me to contact someone I trust or emergency services (988 or 911 in the US, Samaritans 116 123 in the UK); mention my support plan if the file has one.',
      '8. Do not make me feel that only you understand me. When it fits, remind me of people in my life I can reach out to.',
    ],
    summaryTitle: (d) => `## Recent state and patterns (auto-summarised ${d}; newer notes below take precedence)`,
    notesTitle: '## My notes',
    notesHint: '<!-- One per line: date | type | words. Add new ones at the bottom. -->',
    empty: '(No memories yet. You can say to the AI: "Remember, …")',
    olderTitle: '## Older notes (compressed by month)',
    olderLine: (m, n, parts) => `${m} (${n} notes compressed): ${parts || 'no state notes'}`,
    aiMade: ' (AI-written)',
    sensitive: ' (sensitive)',
    effect: { 2: ' (helped a lot)', 1: ' (helped)', 0: ' (no effect)', '-1': ' (worse)' },
    dims: 'en',
  },
};

function absDate(day, today, lang) {
  const [y, m, d] = dayKey(day).split('-').map(Number);
  const sameYear = y === Number(dayKey(today).slice(0, 4));
  if (lang === 'zh') return sameYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return sameYear ? `${mon} ${d}` : `${mon} ${d}, ${y}`;
}

/**
 * Summaries are written for the user ("20 天前你记录"). A file is read later and
 * speaks in the first person, so: absolute dates, and 你 -> 我 outside quotes.
 */
function forFile(text, lang, today) {
  return text
    .split(/(“[^”]*”|"[^"]*")/)
    .map((part, i) => {
      if (i % 2 === 1) return part; // quoted user words stay untouched
      if (lang === 'zh') {
        return part
          .replace(/(\d+) 天前/g, (_, n) => absDate(today - Number(n), today, lang))
          .replace(/昨天/g, absDate(today - 1, today, lang))
          .replace(/今天/g, absDate(today, today, lang))
          .replace(/你/g, '我');
      }
      return part
        .replace(/(\d+) days ago/g, (_, n) => absDate(today - Number(n), today, lang))
        .replace(/\byesterday\b/g, absDate(today - 1, today, lang))
        .replace(/\btoday\b/g, absDate(today, today, lang))
        .replace(/ wrote to you/g, ' wrote to me')
        .replace(/\bYou\b/g, 'I')
        .replace(/\byou\b/g, 'I')
        .replace(/\bYour\b/g, 'My')
        .replace(/\byour\b/g, 'my');
    })
    .join('');
}

function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, ' / ').replace(/[｜|]/g, '/').trim();
}

function entryLine(e, t, lang) {
  const kinds = [...new Set(e.items.map((it) => it.kind))];
  const label = kinds.map((k) => FILE_KIND_LABEL[lang][k]).join(lang === 'zh' ? '、' : ', ');
  const sep = lang === 'zh' ? '｜' : ' | ';
  let words = oneLine(e.words);
  const coping = e.items.find((it) => it.kind === 'coping' && it.effect != null);
  if (coping && !/（(很)?有帮助|没用|更难受）|\((helped|no effect|worse)/.test(words)) words += t.effect[String(coping.effect)];
  if (e.origin === 'ai_candidate') words += t.aiMade;
  if (e.sensitivity === 'sensitive') words += t.sensitive;
  return `${e.day}${sep}${label}${sep}${words}`;
}

/**
 * Render the Memory File.
 * @param entries          stored entries
 * @param o.lang           'zh' | 'en'
 * @param o.today          local day number
 * @param o.includeSensitive  include notes marked sensitive (restricted never are)
 * @param o.maxNotes       most recent notes kept verbatim; older ones compressed by month
 */
export function memoryFile(entries, { lang = 'zh', today, includeSensitive = false, maxNotes = 400 } = {}) {
  const t = TEXT[lang] || TEXT.zh;
  const allow = (s) => s === 'normal' || (s === 'sensitive' && includeSensitive);
  const shared = entries.filter((e) => allow(e.sensitivity)).sort((a, b) => (a.day === b.day ? (a.savedAt < b.savedAt ? -1 : 1) : a.day < b.day ? -1 : 1));
  const lines = [t.title, '', ...t.intro, '', t.rulesTitle, '', ...t.rules, ''];

  if (shared.length) {
    const view = buildView(shared, () => true);
    const a = { lang, text: '', signals: [], strategies: [], when: null, crisis: false, intents: new Set(['recent', 'anchors', 'future', 'support', 'helped', 'similar']) };
    const units = buildUnits(view, a, ['SUPPORT', 'ANCHOR', 'RECENT', 'SIMILAR', 'HELPED', 'FUTURE'], today).filter((u) => u.slot !== 'EVENTS');
    if (units.length) {
      lines.push(t.summaryTitle(dayKey(today)), '');
      for (const u of units) lines.push(`- ${forFile(u.human, lang, today)}`);
      lines.push('');
    }
  }

  const stable = shared.filter((e) => e.items.some((it) => STABLE_KINDS.has(it.kind)));
  const rest = shared.filter((e) => !stable.includes(e));
  const keep = new Set([...stable, ...rest.slice(-maxNotes)]);
  const older = rest.filter((e) => !keep.has(e));
  if (older.length) {
    lines.push(t.olderTitle, '');
    const byMonth = new Map();
    for (const e of older) {
      const m = e.day.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(e);
    }
    for (const [m, es] of byMonth) lines.push(t.olderLine(m, es.length, monthSummary(es, lang)));
    lines.push('');
  }

  lines.push(t.notesTitle, t.notesHint, '');
  const kept = shared.filter((e) => keep.has(e));
  if (kept.length) for (const e of kept) lines.push(entryLine(e, t, lang));
  else lines.push(t.empty);
  lines.push('');
  const text = lines.join('\n');
  return { text, notes: kept.length, compressed: older.length, tokens: estimateTokens(text) };
}

/** One month in a line: state days per dimension, and what helped. */
function monthSummary(entries, lang) {
  const days = new Map();
  const strat = new Map();
  for (const e of entries) {
    for (const it of e.items) {
      if (it.kind === 'state') {
        for (const sig of (it.signals || []).filter(isBad)) {
          const k = `${sig.dim}:${sig.val}`;
          if (!days.has(k)) days.set(k, { sig, days: new Set() });
          days.get(k).days.add(e.day);
        }
      } else if (it.kind === 'coping' && it.effect != null) {
        const s = strat.get(it.strategy) || { n: 0, helped: 0 };
        strat.set(it.strategy, { n: s.n + 1, helped: s.helped + (it.effect > 0 ? 1 : 0) });
      }
    }
  }
  const states = [...days.values()].sort((a, b) => b.days.size - a.days.size).slice(0, 4)
    .map(({ sig, days: d }) => (lang === 'zh' ? `${DIMS[sig.dim].zh[sig.val]} ${d.size} 天` : `${DIMS[sig.dim].en[sig.val]} on ${d.size} days`));
  const helped = [...strat.entries()].filter(([, v]) => v.helped > 0).sort((a, b) => b[1].helped - a[1].helped).slice(0, 3)
    .map(([name, v]) => (lang === 'zh' ? `${STRATEGIES[name]?.zh ?? name}有帮助 ${v.helped}/${v.n} 次` : `${STRATEGIES[name]?.en ?? name} helped ${v.helped}/${v.n}`));
  return [...states, ...helped].join(lang === 'zh' ? '、' : ', ');
}

function kindFromLabel(label) {
  const parts = label.split(/[、,，/+]/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) for (const [re, kind] of LABEL_TO_KIND) if (re.test(p)) return kind;
  return undefined;
}

/**
 * Read note lines back from a Memory File or an AI reply:
 *   2026-09-05｜感受｜我最近睡眠很差
 *   【新记忆】2026-09-25｜方法｜出门走了十分钟（有帮助）
 *   [NEW MEMORY] 2026-09-25 | feeling | numb again
 * Returns [{ day, kind, words, origin, sensitivity }]. Summary and instruction lines are ignored.
 */
export function parseMemoryFile(text, todayKey) {
  const out = [];
  const re = /^\s*(【\s*新记忆\s*】|\[\s*NEW MEMORY\s*\])?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|今天|today)\s*[｜|]\s*([^｜|\n]{1,24}?)\s*[｜|]\s*(.+?)\s*$/i;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(re);
    if (!m) continue;
    let day = /^(今天|today)$/i.test(m[2]) ? todayKey : m[2].replace(/[/.]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(keyToDay(day))) continue;
    let words = m[4].replace(/【\s*\/\s*新记忆\s*】|\[\s*\/\s*NEW MEMORY\s*\]/gi, '').trim();
    let origin = m[1] ? 'ai_candidate' : 'user_words';
    if (/（AI 整理）|\(AI-written\)/.test(words)) origin = 'ai_candidate';
    const sensitivity = /（敏感）|\(sensitive\)/.test(words) ? 'sensitive' : 'normal';
    words = words.replace(/\s*(（AI 整理）|\(AI-written\)|（敏感）|\(sensitive\))/g, '').trim();
    if (!words || words.length > 4000) continue;
    day = day > todayKey ? todayKey : day;
    out.push({ day, kind: kindFromLabel(m[3]), words, origin, sensitivity });
  }
  return out;
}
