// Gate + intent: decide whether this message needs long-term memory at all,
// and which few kinds of memory would help. Most messages need none.

import { QUERY, CRISIS, FEEL } from './lexicon.js';
import { extractSignals, extractStrategies, extractWhen } from './extract.js';
import { detectLang } from './util.js';

const GROUNDING_DIMS = new Set(['numb', 'unreal', 'memgap']);

export function analyzeQuery(query) {
  const text = String(query ?? '').slice(0, 2000);
  const has = (re) => re.test(text);
  const signals = extractSignals(text, { forQuery: true });
  // Chinese often drops the subject ("还是很麻木", "好累"): a state word counts as
  // the user's own unless the message is clearly about someone else.
  const self = !has(QUERY.other) && (has(QUERY.self) || signals.length > 0);
  const feelish = signals.length > 0 || FEEL.test(text);
  const crisis = CRISIS.test(text);
  const intents = new Set();

  if (crisis || has(QUERY.support)) intents.add('support');
  if (has(QUERY.anchors)) intents.add('anchors');
  if (has(QUERY.future)) intents.add('future');
  if (has(QUERY.search)) intents.add('search');
  if (self && has(QUERY.recent)) intents.add('recent');
  if (has(QUERY.helped) && (feelish || /对我|帮到我|for me|helps? me|helped me/i.test(text))) intents.add('helped');
  if (self && has(QUERY.similar) && (feelish || /上次我|我上次|last time i/i.test(text))) intents.add('similar');
  if (self && signals.some((s) => s.val === 'poor' || s.val === 'high')) intents.add('state');
  else if (self && FEEL.test(text) && has(QUERY.why)) intents.add('state');
  if (signals.some((s) => GROUNDING_DIMS.has(s.dim) && s.val === 'high')) intents.add('ground');

  return {
    text,
    lang: detectLang(text),
    need: intents.size > 0,
    intents,
    signals,
    strategies: extractStrategies(text),
    when: extractWhen(text),
    crisis,
  };
}

const FOCUS_SLOTS = {
  recent: ['RECENT'],
  similar: ['SIMILAR', 'REFLECT'],
  helped: ['HELPED'],
  anchors: ['ANCHOR'],
  future_self: ['FUTURE'],
  support: ['SUPPORT', 'ANCHOR', 'HELPED', 'FUTURE'],
  search: ['SEARCH'],
};

/** Ordered slot plan: earlier slots win when the token budget is tight. */
export function planSlots(a, focus = 'auto') {
  if (focus && focus !== 'auto' && Object.hasOwn(FOCUS_SLOTS, focus)) return FOCUS_SLOTS[focus];
  const i = a.intents;
  const slots = [];
  if (i.has('support')) slots.push('SUPPORT');
  if (i.has('anchors')) slots.push('ANCHOR');
  if (i.has('search')) slots.push('SEARCH');
  if (i.has('state') || i.has('recent')) slots.push('RECENT');
  if (i.has('state') || i.has('similar')) slots.push('SIMILAR', 'REFLECT');
  if (i.has('state') || i.has('helped') || i.has('support')) slots.push('HELPED');
  if (i.has('state')) slots.push('NEW');
  if (i.has('ground')) slots.push('ANCHOR');
  if (i.has('future') || i.has('support') || i.has('state')) slots.push('FUTURE');
  return [...new Set(slots)];
}
