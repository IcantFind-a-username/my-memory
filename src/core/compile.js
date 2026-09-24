// Memory compiler: pack the highest-value units into a hard token budget and
// render the same selection twice - a terse Machine Context for the AI and a
// plain-language Human Preview so the user knows exactly what is lent.

import { estimateTokens } from './util.js';

const SLOT_ORDER = ['SAFETY', 'SUPPORT', 'ANCHOR', 'FOUND', 'RECENT', 'LAST', 'EVENTS', 'SIMILAR', 'YOU_NOTED', 'HELPED', 'NEW', 'FUTURE'];
const HEADER_RESERVE = 45;

const SAFETY_LINE = 'SAFETY: possible crisis. Safety first: encourage contacting local emergency services or a crisis line and people in their support plan. Stay with them; no diagnosis.';

function legend(units, lang) {
  const all = units.map((u) => (u.useRich ? u.rich : u.body)).join(' ');
  const parts = [];
  if (lang === 'zh') {
    parts.push('以下是我自己记下的笔记，只借给这次对话参考，不是事实判断');
    if (all.includes('(s)')) parts.push('(s)=我当时的主观感受');
    if (all.includes('(r)')) parts.push('(r)=我的记录');
    if (all.includes('(a)')) parts.push('(a)=AI 写的摘要');
    if (all.includes('→')) parts.push('a→b 只表示先后，不代表因果');
    parts.push('请不要诊断我');
    return `【我的记忆】${parts.join('；')}。`;
  }
  parts.push("MEMORY (user's own notes, lent for this reply; not facts");
  if (all.includes('(s)')) parts.push('s=self-report');
  if (all.includes('(r)')) parts.push('r=user record');
  if (all.includes('(a)')) parts.push('a=AI summary');
  if (all.includes('→')) parts.push('a→b = came first, not cause');
  parts.push('no diagnosis)');
  return `${parts.join('; ')}:`;
}

function render(accepted, { crisis, headerLang, skippedSeen, withIds }) {
  const lines = [legend(accepted, headerLang)];
  if (crisis) lines.push(SAFETY_LINE);
  const bySlot = new Map();
  for (const u of accepted) {
    if (!bySlot.has(u.slot)) bySlot.set(u.slot, []);
    bySlot.get(u.slot).push(u.useRich ? u.rich : u.body);
  }
  for (const slot of SLOT_ORDER) if (bySlot.has(slot)) lines.push(`${slot}: ${bySlot.get(slot).join(' | ')}`);
  if (skippedSeen) lines.push(`(${skippedSeen} item(s) already shared earlier in this chat)`);
  if (withIds && accepted.length) lines.push(`ids: ${accepted.map((u) => u.key).join(' ')}`);
  return lines.join('\n');
}

function preview(accepted, lang, tokens, skippedSeen) {
  if (lang === 'zh') {
    if (!accepted.length) return skippedSeen ? '相关的记忆这次对话里已经给过 AI 了，没有再发送。' : '没有找到相关的记忆，这次不借给 AI 任何记忆。';
    return [`这次借给 AI 的记忆（约 ${tokens} token）：`, ...accepted.map((u) => `· ${u.human}`), '想少分享一点，或这次不用记忆，直接告诉我就好。'].join('\n');
  }
  if (!accepted.length) return skippedSeen ? 'The relevant notes were already shared in this chat; nothing new was sent.' : 'No relevant notes found; nothing from your memory is shared this time.';
  return [`What the AI sees from your memory this time (~${tokens} tokens):`, ...accepted.map((u) => `· ${u.human}`), 'Say so if you want to share less, or none at all.'].join('\n');
}

/**
 * @param units   candidates from retrieve.buildUnits, with .prio
 * @param opts    { budget, seen:Set, exclude:Set, allow(sens), lang, headerLang, crisis, withIds }
 */
export function compile(units, opts) {
  const { budget, seen = new Set(), exclude = new Set(), allow, lang, crisis = false, withIds = true } = opts;
  const headerLang = opts.headerLang || 'en';
  const ordered = [...units].sort((a, b) => a.prio - b.prio);
  const accepted = [];
  const covered = new Set();
  const slotsUsed = new Set();
  let skippedSeen = 0;
  let used = HEADER_RESERVE + (crisis ? estimateTokens(SAFETY_LINE) : 0);

  for (const u of ordered) {
    if (!allow(u.sens)) continue; // defense in depth: the view is already filtered
    if (exclude.has(u.key)) continue;
    if (seen.has(u.key)) {
      skippedSeen++;
      continue;
    }
    if (u.covers.length && u.covers.every((c) => covered.has(c))) continue;
    const cost = estimateTokens(u.body) + 2 + (slotsUsed.has(u.slot) ? 0 : estimateTokens(u.slot) + 2) + (withIds ? estimateTokens(u.key) + 1 : 0);
    if (used + cost > budget) continue;
    accepted.push(u);
    slotsUsed.add(u.slot);
    u.covers.forEach((c) => covered.add(c));
    used += cost;
  }

  // Second pass: spend any leftover budget on the user's own words.
  for (const u of accepted) {
    if (!u.rich) continue;
    const extra = estimateTokens(u.rich) - estimateTokens(u.body);
    if (used + extra <= budget) {
      u.useRich = true;
      used += extra;
    }
  }

  // Measure the real text and trim from the lowest priority until it fits.
  const renderOpts = { crisis, headerLang, skippedSeen, withIds };
  let text = render(accepted, renderOpts);
  while (accepted.length && estimateTokens(text) > budget) {
    const last = accepted.pop();
    last.useRich = false;
    text = render(accepted, renderOpts);
  }
  const tokens = estimateTokens(text);
  const sorted = [...accepted].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  return {
    text,
    preview: preview(sorted, lang, tokens, skippedSeen),
    tokens,
    ids: accepted.map((u) => u.key),
    units: sorted,
    skippedSeen,
  };
}
