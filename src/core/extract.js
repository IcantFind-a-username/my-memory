// Rule-based structuring of the user's own words into typed memory items.
// Deterministic and auditable: the same words always give the same items.
// A host AI may add hints (kind, tags, when); those are labelled by:'ai'.

import {
  SIGNALS, NEG_BEFORE, NEG_AFTER, HEDGE_BEFORE, EXPECT, QUERY, DIMS, STRATEGIES, EFFECTS, WHEN, WHEN_N, KIND_CUES, EPISTEMIC,
  PEOPLE, FEEL, CRISIS, SENSITIVE, RESTRICT, IMPORTANT, COMMAND, DIAGNOSIS, DIM_ALIAS, STRATEGY_ALIAS, KINDS,
} from './lexicon.js';

const SENS_ORDER = ['normal', 'sensitive', 'restricted'];
const WHOLE_KINDS = new Set(['future_message', 'support_plan', 'anchor', 'relationship', 'reflection']);
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function flip(dim, val) {
  if (DIMS[dim].q) return val === 'poor' ? 'good' : 'poor';
  return val === 'high' ? 'low' : 'high';
}

/**
 * Self-reported state signals in text: [{dim, val}], latest mention wins per dim.
 * When recording, hedged or questioned states ("是不是麻木", "am I numb?") are not
 * reports and are skipped; a query keeps them, since the user is asking about them.
 */
export function extractSignals(text, { forQuery = false } = {}) {
  const byDim = new Map();
  for (const [re, dim, val] of SIGNALS) {
    const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const m of text.matchAll(g)) {
      const before = text.slice(Math.max(0, m.index - 14), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
      if (!forQuery && (HEDGE_BEFORE.test(before) || /^\s*(了)?\s*(吗|嘛|\?|？)/.test(after))) continue;
      const v = NEG_BEFORE.test(before) || NEG_AFTER.test(after) ? flip(dim, val) : val;
      const prev = byDim.get(dim);
      if (!prev || m.index >= prev.at) byDim.set(dim, { dim, val: v, at: m.index });
    }
  }
  return [...byDim.values()].sort((a, b) => a.at - b.at).map(({ dim, val }) => ({ dim, val }));
}

export function extractStrategies(text) {
  return Object.keys(STRATEGIES).filter((name) => STRATEGIES[name].re.test(text));
}

export function extractEffect(text) {
  if (EXPECT.test(text)) return null;
  for (const [value, re] of EFFECTS) if (re.test(text)) return value;
  return null;
}

function parseCount(s) {
  if (/^[0-9]+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  const [tens, ones] = s.split('十');
  if (s.includes('十')) return (tens ? CN_NUM[tens] : 1) * 10 + (ones ? CN_NUM[ones] : 0);
  return CN_NUM[s] ?? NaN;
}

/** When the words say something happened: {back: days before saving, span: days covered}. */
export function extractWhen(text) {
  const m = text.match(WHEN_N);
  if (m) {
    const n = parseCount(m[1] || m[2]);
    if (n >= 0 && n < 3650) return { back: n, span: 1 };
  }
  for (const [re, back, span] of WHEN) if (re.test(text)) return { back, span };
  return null;
}

export function splitClauses(text) {
  return text
    .split(/[。！？!?；;\n]+|[，,、]|\s*(?:但是|可是|不过|\bbut\b)\s*/i)
    .map((c) => (c || '').trim())
    .filter((c) => c.length > 0);
}

const META = /^(我)?(也|真的|就是)?不知道(是)?(为什么|为啥|怎么回事|怎么了)|^i (really )?don'?t know why/i;

function meaningful(clause) {
  const stripped = clause.replace(new RegExp(RESTRICT.source, 'gi'), '').replace(new RegExp(IMPORTANT.source, 'gi'), '');
  const core = stripped.replace(/[\s\p{P}\p{S}]/gu, '');
  if (/^(嗯|好的?|ok|okay|是的?|对|哦|啊|这很|这个很|谢谢(你)?|thanks?|thank you)$/i.test(core) || META.test(core)) return false;
  return /[\u4e00-\u9fff]/.test(core) ? core.length >= 2 : core.length >= 3;
}

function people(text) {
  return [...new Set((text.match(PEOPLE) || []).map((p) => p.toLowerCase()))];
}

function conceptTags(text) {
  return [...new Set([...extractSignals(text).map((s) => s.dim), ...extractStrategies(text), ...people(text)])];
}

/** Remove a leading "记住，" / "remember that" so we keep the user's content, not the command. */
export function cleanWords(raw) {
  return String(raw).replace(COMMAND, '').replace(/\s+/g, ' ').trim();
}

function detectWholeKind(words) {
  for (const [kind, re] of KIND_CUES) if (re.test(words)) return kind;
  return null;
}

function clauseItems(words) {
  const clauses = splitClauses(words);
  const items = [];
  let when = null;
  for (let i = 0; i < clauses.length; i++) {
    let text = clauses[i];
    const w = extractWhen(text);
    if (w) when = w; // a clause without its own time inherits the previous one
    // "他很焦虑" is about someone else: keep the words, but not as the user's own state.
    const aboutOther = QUERY.other.test(text);
    const signals = aboutOther ? [] : extractSignals(text);
    const strategies = extractStrategies(text);
    let effect = extractEffect(text);
    if (strategies.length && effect === null && i + 1 < clauses.length) {
      const next = clauses[i + 1];
      const nextEffect = extractEffect(next);
      const nextSignals = extractSignals(next);
      const eased = nextSignals.some((x) => x.val === 'low' || x.val === 'good');
      if ((nextEffect !== null || eased) && extractStrategies(next).length === 0) {
        effect = nextEffect ?? 1; // "晒太阳后，麻木感轻了一点": the easing they reported follows what they did
        signals.push(...nextSignals);
        text = `${text}，${next}`;
        i++;
      }
    }
    if (strategies.length && effect === null && signals.some((x) => x.val === 'low' || x.val === 'good')) {
      effect = 1; // "散步后没那么焦虑了": the thing they did came with an easing they reported
    }
    if (!meaningful(text)) continue;
    const base = { text, back: when ? when.back : 0, span: when ? when.span : 1, timed: !!when, by: 'rules' };
    const who = people(text);
    if (strategies.length && effect !== null) {
      for (const s of strategies) {
        items.push({ ...base, kind: 'coping', strategy: s, effect, tags: [s, ...signals.map((x) => x.dim), ...who] });
      }
      if (signals.length) items.push({ ...base, kind: 'state', signals, tags: signals.map((x) => x.dim) });
    } else if (signals.length) {
      items.push({ ...base, kind: 'state', signals, tags: [...signals.map((x) => x.dim), ...strategies, ...who] });
    } else if (strategies.length) {
      items.push({ ...base, kind: 'event', tags: [...strategies, ...who] });
    } else if (meaningful(text)) {
      items.push({ ...base, kind: FEEL.test(text) ? 'state' : 'event', tags: who });
    }
  }
  return items;
}

function parseAiTag(tag) {
  const t = String(tag).trim().slice(0, 40);
  if (!t || DIAGNOSIS.test(t)) return null; // no diagnostic labels from the AI
  const m = t.toLowerCase().match(/^([a-z_]+)\s*[:=]\s*([a-z_+\-↑↓]+)$/);
  if (m && DIM_ALIAS[m[1]]) {
    const dim = DIM_ALIAS[m[1]];
    const up = /^(good|high|up|\+|↑|yes|more)$/.test(m[2]);
    const val = DIMS[dim].q ? (up ? 'good' : 'poor') : (up || !/^(low|down|-|↓|less|no)$/.test(m[2]) ? 'high' : 'low');
    return { signal: { dim, val } };
  }
  if (m && STRATEGY_ALIAS[m[1]]) {
    const v = m[2];
    const effect = /^(\+\+|helped_a_lot|a_lot|very)$/.test(v) ? 2 : /^(0|none|no|no_effect|didnt_help)$/.test(v) ? 0 : /^(-|worse|bad)$/.test(v) ? -1 : 1;
    return { strategy: STRATEGY_ALIAS[m[1]], effect };
  }
  const alias = t.toLowerCase();
  if (DIM_ALIAS[alias]) {
    const dim = DIM_ALIAS[alias];
    return DIMS[dim].q ? { tag: dim } : { signal: { dim, val: 'high' } };
  }
  if (STRATEGY_ALIAS[alias]) return { tag: STRATEGY_ALIAS[alias] };
  const signals = extractSignals(t);
  if (signals.length) return { signal: signals[0] };
  const strategies = extractStrategies(t);
  if (strategies.length) return { tag: strategies[0] };
  return { tag: t.toLowerCase() };
}

function maxSens(a, b) {
  return SENS_ORDER[Math.max(SENS_ORDER.indexOf(a), SENS_ORDER.indexOf(b ?? 'normal'))];
}

/**
 * Structure one save request. `hint` comes from the host AI and may add
 * detail or raise privacy, never lower it:
 *   { kind, tags, when: {back, span} | null, sensitivity, important }
 */
export function parseEntry(raw, hint = {}) {
  const words = cleanWords(raw);
  const hintKind = KINDS.includes(hint.kind) ? hint.kind : null;
  const wholeKind = hintKind && WHOLE_KINDS.has(hintKind) ? hintKind : detectWholeKind(words);
  let items;
  if (wholeKind) {
    const w = extractWhen(words);
    items = [{ text: words, back: w ? w.back : 0, span: w ? w.span : 1, timed: !!w, by: hintKind === wholeKind ? 'ai' : 'rules', kind: wholeKind, tags: conceptTags(words) }];
  } else {
    items = clauseItems(words);
    if (items.length === 0 && meaningful(words)) {
      items = [{ text: words, back: 0, span: 1, timed: false, by: 'rules', kind: hintKind || 'event', tags: conceptTags(words) }];
    }
  }

  // AI hints: extra structure the rules missed, always labelled by:'ai'.
  const freeTags = [];
  for (const tag of (Array.isArray(hint.tags) ? hint.tags : []).slice(0, 12)) {
    const p = parseAiTag(tag);
    if (!p) continue;
    if (p.signal) {
      let state = items.find((it) => it.kind === 'state');
      if (!state && !wholeKind) {
        state = { text: words, back: 0, span: 1, timed: false, by: 'ai', kind: 'state', signals: [], tags: [] };
        items.push(state);
      }
      const target = state || items[0];
      if (!target) continue;
      if (target.kind === 'state' && !target.signals.some((s) => s.dim === p.signal.dim)) {
        target.signals.push({ ...p.signal, by: 'ai' });
      }
      if (!target.tags.includes(p.signal.dim)) target.tags.push(p.signal.dim);
    } else if (p.strategy) {
      if (!wholeKind && !items.some((it) => it.kind === 'coping' && it.strategy === p.strategy)) {
        items.push({ text: words, back: 0, span: 1, timed: false, by: 'ai', kind: 'coping', strategy: p.strategy, effect: p.effect, tags: [p.strategy] });
      }
    } else if (p.tag) {
      freeTags.push(p.tag);
    }
  }
  if (items.length && freeTags.length) items[0].tags = [...new Set([...items[0].tags, ...freeTags])];

  if (hint.when) {
    for (const it of items) {
      if (!it.timed) Object.assign(it, { back: hint.when.back, span: hint.when.span ?? 1 });
    }
  }

  const crisis = CRISIS.test(words);
  const ruleSens = RESTRICT.test(raw)
    ? 'restricted'
    : crisis || SENSITIVE.test(words) || items.some((it) => it.strategy && STRATEGIES[it.strategy].sensitive)
      ? 'sensitive'
      : 'normal';

  return {
    words,
    items: items.map(({ timed, ...it }) => ({
      ...it,
      epistemic: EPISTEMIC[it.kind],
      tags: [...new Set(it.tags)],
      ...(it.signals ? { signals: it.signals.map((s) => ({ dim: s.dim, val: s.val, ...(s.by ? { by: s.by } : {}) })) } : {}),
    })),
    sensitivity: maxSens(ruleSens, SENS_ORDER.includes(hint.sensitivity) ? hint.sensitivity : 'normal'),
    important: IMPORTANT.test(raw) || hint.important === true || ['anchor', 'future_message', 'support_plan'].includes(wholeKind),
    crisis,
  };
}
