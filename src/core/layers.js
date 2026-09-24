// Memory layers above the stored entries (all derived, never stored, so a
// deleted entry cannot linger in a summary):
//   view      : permission-filtered, flattened structured items
//   episodes  : episodic summaries - runs of self-reported states
//   strategies: stable memory - what the user did and how it went, over time
//   index     : lexical/concept index for drill-down search

import { keyToDay } from './util.js';

const EPISODE_GAP_DAYS = 3;

/** Only entries whose sensitivity passes `allow` ever enter the view: permission is a hard gate, applied first. */
export function buildView(entries, allow) {
  const items = [];
  for (const e of entries) {
    if (!allow(e.sensitivity)) continue;
    const base = keyToDay(e.day);
    e.items.forEach((it, i) => {
      items.push({
        ...it,
        // Words an AI proposed (then the user accepted) stay marked as AI-written.
        epistemic: e.origin === 'ai_candidate' ? 'ai_summary' : it.epistemic,
        id: `${e.id}.${i}`,
        entryId: e.id,
        day: base - (it.back || 0),
        sens: e.sensitivity,
        important: !!e.important,
        summary: e.aiSummary ? e.aiSummary.text : null,
      });
    });
  }
  items.sort((a, b) => a.day - b.day);
  const view = { items, _cache: {} };
  return view;
}

function cached(view, name, build) {
  if (!(name in view._cache)) view._cache[name] = build();
  return view._cache[name];
}

export function isBad(s) {
  return s.val === 'poor' || s.val === 'high';
}

/** Runs of state reports with gaps <= 3 days, plus the coping reports around them. */
export function episodes(view) {
  return cached(view, 'episodes', () => {
    const eps = [];
    let cur = null;
    for (const it of view.items) {
      if (it.kind !== 'state' || !it.signals || it.signals.length === 0) continue;
      if (!cur || it.day - cur.to > EPISODE_GAP_DAYS) {
        cur = { from: it.day, to: it.day, states: [], copings: [], dims: new Map() };
        eps.push(cur);
      }
      cur.to = Math.max(cur.to, it.day);
      cur.states.push(it);
      for (const s of it.signals) {
        const key = `${s.dim}:${s.val}`;
        const d = cur.dims.get(key);
        if (d) {
          d.days.add(it.day);
          d.first = Math.min(d.first, it.day);
        } else {
          cur.dims.set(key, { dim: s.dim, val: s.val, first: it.day, days: new Set([it.day]) });
        }
      }
    }
    let j = 0;
    for (const it of view.items) {
      if (it.kind !== 'coping') continue;
      while (j < eps.length && eps[j].to + EPISODE_GAP_DAYS < it.day) j++;
      if (j < eps.length && it.day >= eps[j].from - 1) eps[j].copings.push(it);
    }
    return eps;
  });
}

/** Stable memory: per strategy, how often it was tried and how it went. */
export function strategyStats(view) {
  return cached(view, 'strategies', () => {
    const stats = new Map();
    for (const it of view.items) {
      if (it.kind !== 'coping' || it.effect == null) continue;
      let s = stats.get(it.strategy);
      if (!s) stats.set(it.strategy, (s = { name: it.strategy, n: 0, helped: 0, sum: 0, last: it, items: [] }));
      s.n++;
      s.sum += it.effect;
      if (it.effect > 0) s.helped++;
      if (it.day >= s.last.day) s.last = it;
      s.items.push(it);
    }
    return stats;
  });
}

const STOP = new Set(['the', 'and', 'was', 'for', 'that', 'with', 'this', 'have', 'been', 'but', 'not', 'are', 'you', 'what', 'when', 'did']);

/** Latin words + CJK character bigrams; `#concept` tokens bridge the two languages. */
export function tokenize(text) {
  const t = String(text).toLowerCase();
  const out = [];
  for (const w of t.match(/[a-z0-9]+/g) || []) if (w.length > 2 && !STOP.has(w)) out.push(w);
  for (const run of t.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

export function lexIndex(view) {
  return cached(view, 'index', () => {
    const postings = new Map();
    const lens = new Array(view.items.length);
    view.items.forEach((it, i) => {
      const toks = [...tokenize(it.text), ...(it.tags || []).map((x) => `#${x}`)];
      if (it.summary) toks.push(...tokenize(it.summary));
      lens[i] = toks.length || 1;
      const tf = new Map();
      for (const x of toks) tf.set(x, (tf.get(x) || 0) + 1);
      for (const [x, c] of tf) {
        let p = postings.get(x);
        if (!p) postings.set(x, (p = []));
        p.push(i, c);
      }
    });
    const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
    return { postings, lens, avg, n: view.items.length };
  });
}

/** BM25 over the lexical index. Returns Map(itemIndex -> score). */
export function bm25(index, queryTokens, k1 = 1.2, b = 0.75) {
  const scores = new Map();
  for (const q of new Set(queryTokens)) {
    const p = index.postings.get(q);
    if (!p) continue;
    const df = p.length / 2;
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
    const w = q.startsWith('#') ? 2 : 1; // concept matches count double
    for (let k = 0; k < p.length; k += 2) {
      const i = p[k];
      const tf = p[k + 1];
      const s = (w * idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * index.lens[i]) / index.avg));
      scores.set(i, (scores.get(i) || 0) + s);
    }
  }
  return scores;
}
