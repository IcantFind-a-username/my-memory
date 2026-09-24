// Hierarchical retrieval: summaries first (recent window, episodes, strategy
// stats), raw items only when a slot needs a concrete example or quote.
// Produces candidate "units"; compile.js decides which fit the token budget.

import { DIMS, STRATEGIES } from './lexicon.js';
import { episodes, strategyStats, lexIndex, bm25, tokenize, isBad } from './layers.js';
import { agoCode, agoHuman, safeQuote, shortHash } from './util.js';

const RECENT_DAYS = 14;
const LAST_LOOKBACK_DAYS = 90;
const MARK = { self_report: 's', user_record: 'r', ai_summary: 'a' };

const sigCode = (s) => DIMS[s.dim].code[s.val];
const sigHuman = (s, lang) => DIMS[s.dim][lang][s.val];
const effCode = (avg) => (avg >= 1.5 ? '++' : avg > 0 ? '+' : avg === 0 ? '0' : '-');
const stratName = (name, lang) => STRATEGIES[name]?.[lang] ?? name;
const join = (parts, lang) => parts.join(lang === 'zh' ? '、' : ', ');
const recency = (day, today, halfLife) => Math.pow(0.5, (today - day) / halfLife);

function effHuman(avg, lang) {
  if (lang === 'zh') return avg >= 1.5 ? '很有帮助' : avg > 0 ? '有一点帮助' : avg === 0 ? '没什么变化' : '反而更难受';
  return avg >= 1.5 ? 'helped a lot' : avg > 0 ? 'helped a bit' : avg === 0 ? 'made no difference' : 'made things worse';
}

function quoteOf(it, max) {
  // Prefer the user's own words; fall back to the labelled AI summary for long notes.
  if ([...it.text].length > max * 2 && it.summary) return `"${safeQuote(it.summary, max)}"(a)`;
  return `"${safeQuote(it.text, max)}"`;
}

function unit(slot, key, body, human, extra = {}) {
  return { slot, key, body, human, rich: null, covers: [], ...extra };
}

/** Target states: what the user reports now, else what dominated the last two weeks. */
function targetSignals(view, a, today) {
  const now = a.signals.filter(isBad);
  if (now.length) return now;
  const counts = new Map();
  for (const it of view.items) {
    if (it.day < today - RECENT_DAYS + 1 || it.kind !== 'state' || !it.signals) continue;
    for (const s of it.signals.filter(isBad)) {
      const k = `${s.dim}:${s.val}`;
      counts.set(k, { s, n: (counts.get(k)?.n || 0) + 1 });
    }
  }
  return [...counts.values()].sort((x, y) => y.n - x.n).slice(0, 2).map((c) => c.s);
}

function recentUnits(view, a, today, lang) {
  const from = today - RECENT_DAYS + 1;
  const win = view.items.filter((it) => it.day >= from && it.day <= today);
  if (win.length === 0) return lastUnits(view, today, lang);
  const units = [];

  const dims = new Map();
  for (const it of win) {
    if (it.kind !== 'state' || !it.signals) continue;
    for (const s of it.signals) {
      const k = `${s.dim}:${s.val}`;
      if (!dims.has(k)) dims.set(k, { s, days: new Set() });
      dims.get(k).days.add(it.day);
    }
  }
  const parts = [...dims.values()]
    .sort((x, y) => y.days.size - x.days.size || Number(isBad(y.s)) - Number(isBad(x.s)))
    .slice(0, 6);
  const strat = new Map();
  for (const it of win) {
    if (it.kind !== 'coping' || it.effect == null) continue;
    const s = strat.get(it.strategy) || { sum: 0, n: 0 };
    strat.set(it.strategy, { sum: s.sum + it.effect, n: s.n + 1 });
  }
  const sParts = [...strat.entries()].slice(0, 3);
  if (parts.length || sParts.length) {
    const code = [
      parts.map((p) => sigCode(p.s) + (p.days.size > 1 ? `×${p.days.size}d` : '')).join(', '),
      sParts.map(([n, s]) => `${n}:${effCode(s.sum / s.n)}`).join(', '),
    ].filter(Boolean).join('; ');
    const h = lang === 'zh'
      ? `最近两周：${join(parts.map((p) => (p.days.size > 1 ? `${p.days.size} 天${sigHuman(p.s, lang)}` : sigHuman(p.s, lang))), lang)}${sParts.length ? `；${join(sParts.map(([n, s]) => `${stratName(n, lang)}${effHuman(s.sum / s.n, lang)}`), lang)}` : ''}`
      : `Last two weeks: ${join(parts.map((p) => (p.days.size > 1 ? `${sigHuman(p.s, lang)} on ${p.days.size} days` : sigHuman(p.s, lang))), lang)}${sParts.length ? `; ${join(sParts.map(([n, s]) => `${stratName(n, lang)} ${effHuman(s.sum / s.n, lang)}`), lang)}` : ''}`;
    units.push(unit('RECENT', `~${shortHash(`R${code}`)}`, `${code} (s)`, h, { covers: sParts.map(([n]) => `str:${n}`) }));
  }

  const events = win.filter((it) => it.kind === 'event').sort((x, y) => Number(y.important) - Number(x.important) || y.day - x.day).slice(0, 3);
  for (const it of events) {
    units.push(unit('EVENTS', it.id, `${agoCode(it.day, today)} ${quoteOf(it, 18)}(r)`, `${agoHuman(it.day, today, lang)}：${safeQuote(it.text, 40)}`.replace('：', lang === 'zh' ? '：' : ': '), {
      rich: `${agoCode(it.day, today)} ${quoteOf(it, 50)}(r)`,
      low: !a.intents.has('recent'),
    }));
  }
  return units;
}

function itemLine(it, today, short, long) {
  const ago = agoCode(it.day, today);
  const mark = MARK[it.epistemic] || 's';
  if (it.signals?.length) {
    const codes = it.signals.map(sigCode).join(', ');
    return { body: `${ago} ${codes}(${mark})`, rich: `${ago} ${codes}(${mark}) ${quoteOf(it, long)}` };
  }
  return { body: `${ago} ${quoteOf(it, short)}(${mark})`, rich: `${ago} ${quoteOf(it, long)}(${mark})` };
}

/** Nothing in the last two weeks: show the latest note (within 90 days) instead. */
function lastUnits(view, today, lang) {
  const cands = view.items.filter((it) => (it.kind === 'state' || it.kind === 'event') && it.day >= today - LAST_LOOKBACK_DAYS && it.day <= today);
  if (!cands.length) return [];
  const lastDay = cands[cands.length - 1].day;
  return cands
    .filter((it) => it.day === lastDay)
    .sort((x, y) => Number(y.kind === 'state') - Number(x.kind === 'state'))
    .slice(0, 2)
    .map((it) => {
      const { body, rich } = itemLine(it, today, 16, 40);
      const h = lang === 'zh' ? `${agoHuman(it.day, today, lang)}你记录：“${safeQuote(it.text, 40)}”` : `${agoHuman(it.day, today, lang)} you noted: "${safeQuote(it.text, 60)}"`;
      return unit('LAST', it.id, body, h, { rich });
    });
}

function similarUnits(view, a, today, lang, target) {
  if (!target.length) return [];
  const cutoff = today - RECENT_DAYS;
  const scored = [];
  for (const e of episodes(view)) {
    if (e.to > cutoff) continue; // the current stretch is RECENT, not "similar"
    let m = 0;
    const matched = [];
    for (const t of target) {
      const hit = e.dims.get(`${t.dim}:${t.val}`);
      if (hit) {
        m += 1;
        matched.push(hit);
      } else if ([...e.dims.values()].some((d) => d.dim === t.dim)) m += 0.25;
    }
    const score = m / target.length;
    if (score >= 0.5 && matched.length) scored.push({ e, matched, score: score + 0.1 * recency(e.to, today, 180) });
  }
  scored.sort((x, y) => y.score - x.score);

  const out = [];
  const sigs = [];
  for (const { e, matched } of scored) {
    const sig = [...e.dims.keys()].sort().join('|');
    const dup = sigs.findIndex((s) => jaccard(s.split('|'), sig.split('|')) >= 0.8);
    if (dup >= 0) {
      out[dup].repeats++;
      continue;
    }
    if (out.length >= 2) continue;
    sigs.push(sig);
    const firstHit = Math.min(...matched.map((d) => d.first));
    const others = [...e.dims.values()].filter((d) => isBad(d) && !matched.includes(d));
    const pre = others.filter((d) => d.first < firstHit).slice(0, 2);
    const co = others.filter((d) => d.first >= firstHit).slice(0, 2);
    const len = e.to - e.from + 1;
    const code = `${pre.length ? `${pre.map(sigCode).join(',')}→` : ''}${matched.map(sigCode).join(',')}${co.length ? ` +${co.map(sigCode).join(',')}` : ''}`;
    const when = agoCode(e.from, today);
    const hWhen = agoHuman(e.from, today, lang);
    const human = lang === 'zh'
      ? `${hWhen}起约 ${len} 天：${pre.length ? `先记录了${join(pre.map((d) => sigHuman(d, lang)), lang)}，之后` : ''}${join(matched.map((d) => sigHuman(d, lang)), lang)}${co.length ? `（也有${join(co.map((d) => sigHuman(d, lang)), lang)}）` : ''}`
      : `Around ${hWhen} for ~${len} days: ${pre.length ? `${join(pre.map((d) => sigHuman(d, lang)), lang)} first, then ` : ''}${join(matched.map((d) => sigHuman(d, lang)), lang)}${co.length ? ` (also ${join(co.map((d) => sigHuman(d, lang)), lang)})` : ''}`;
    out.push({ e, code, when, len, human, repeats: 0 });
  }
  return out.map((o) => {
    const again = o.repeats ? ` ×${o.repeats + 1} periods` : '';
    const hAgain = o.repeats ? (lang === 'zh' ? `（类似时期共 ${o.repeats + 1} 次）` : ` (${o.repeats + 1} similar periods)`) : '';
    return unit('SIMILAR', `~${shortHash(`S${o.when}${o.code}`)}`, `${o.when}(${o.len}d): ${o.code}${again} (s)`, o.human + hAgain, { episode: o.e });
  });
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function reflectUnits(view, today, lang, targetDims, queryTokens) {
  const refl = view.items.filter((it) => it.kind === 'reflection');
  const scored = refl
    .map((it) => {
      const overlap = (it.tags || []).filter((t) => targetDims.has(t)).length;
      const lex = tokenize(it.text).filter((t) => queryTokens.has(t)).length;
      return { it, s: overlap * 2 + lex * 0.2 + recency(it.day, today, 365) * 0.1 };
    })
    .filter((x) => x.s >= 1)
    .sort((x, y) => y.s - x.s)
    .slice(0, 1);
  return scored.map(({ it }) => {
    const { body, rich } = itemLine(it, today, 30, 70);
    const h = lang === 'zh' ? `你曾经写下的体会（${agoHuman(it.day, today, lang)}）：“${safeQuote(it.text, 60)}”` : `Something you noticed (${agoHuman(it.day, today, lang)}): "${safeQuote(it.text, 80)}"`;
    return unit('YOU_NOTED', it.id, body, h, { rich });
  });
}

function helpedUnits(view, today, lang, targetDims, similarEpisodes) {
  const stats = [...strategyStats(view).values()];
  if (!stats.length) return [];
  const inSimilar = new Set(similarEpisodes.flatMap((e) => e.copings.map((c) => c.id)));
  const ranked = stats
    .map((s) => {
      const rel = s.items.filter((it) => inSimilar.has(it.id) || (it.tags || []).some((t) => targetDims.has(t))).length;
      return { ...s, avg: s.sum / s.n, rel, score: s.helped + 0.8 * rel + 0.5 * recency(s.last.day, today, 60) };
    })
    .filter((s) => s.avg > 0 || s.rel > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  if (!ranked.length) return [];
  const one = ranked.length === 1 && ranked[0].n === 1;
  const part = (s) => `${s.name}:${effCode(s.avg)}${s.n > 1 ? ` ${s.helped}/${s.n}` : ''}`;
  const top = ranked[0];
  const body = `${ranked.map(part).join(', ')}${one ? ` (${agoCode(top.last.day, today)})` : ''} (s)`;
  const rich = one
    ? `${part(top)} ${agoCode(top.last.day, today)} ${quoteOf(top.last, 40)} (s)`
    : `${ranked.map(part).join(', ')}; latest ${top.name} ${agoCode(top.last.day, today)} ${quoteOf(top.last, 40)} (s)`;
  const human = lang === 'zh'
    ? `你记录过的方法：${join(ranked.map((s) => `${stratName(s.name, lang)}${effHuman(s.avg, lang)}${s.n > 1 ? `（${s.n} 次里 ${s.helped} 次有帮助）` : `（${agoHuman(s.last.day, today, lang)}）`}`), lang)}`
    : `What you recorded trying: ${join(ranked.map((s) => `${stratName(s.name, lang)} ${effHuman(s.avg, lang)}${s.n > 1 ? ` (${s.helped} of ${s.n} times)` : ` (${agoHuman(s.last.day, today, lang)})`}`), lang)}`;
  return [unit('HELPED', `~${shortHash(`H${body}`)}`, body, human, { rich, covers: ranked.map((s) => `str:${s.name}`) })];
}

function newUnits(view, a, lang) {
  if (!view.items.length) return [];
  const seenDims = new Set(view.items.flatMap((it) => it.tags || []));
  return a.signals
    .filter((s) => isBad(s) && !seenDims.has(s.dim))
    .slice(0, 2)
    .map((s) => unit('NEW', `~${shortHash(`N${s.dim}`)}`, `${sigCode(s)} not in any earlier shared note`, lang === 'zh' ? `之前的记录里没有提到${DIMS[s.dim].zh.name}` : `Your earlier notes don't mention ${DIMS[s.dim].en.name}`));
}

function kindUnits(view, kind, slot, today, lang, { max, short, long, match }) {
  let items = view.items.filter((it) => it.kind === kind);
  if (match) items = items.filter(match);
  items = items.sort((x, y) => Number(y.important) - Number(x.important) || y.day - x.day).slice(0, max);
  const label = {
    ANCHOR: { zh: '你的现实锚点', en: 'Your reality anchor' },
    FUTURE: { zh: '过去的你留给现在的你', en: 'Your past self wrote to you' },
    SUPPORT: { zh: '你的支持计划', en: 'Your support plan' },
  }[slot];
  return items.map((it) => {
    const from = slot === 'FUTURE' ? `from ${agoCode(it.day, today)} ` : '';
    return unit(slot, it.id, `${from}${quoteOf(it, short)}(${MARK[it.epistemic]})`, `${label[lang]}${slot === 'FUTURE' ? `（${agoHuman(it.day, today, lang)}）` : ''}：“${safeQuote(it.text, 80)}”`, {
      rich: `${from}${quoteOf(it, long)}(${MARK[it.epistemic]})`,
    });
  });
}

function searchUnits(view, a, today, lang) {
  const index = lexIndex(view);
  const q = [...tokenize(a.text), ...a.signals.map((s) => `#${s.dim}`), ...a.strategies.map((s) => `#${s}`)];
  const scores = bm25(index, q);
  const ranked = [...scores.entries()]
    .map(([i, s]) => {
      const it = view.items[i];
      let t = 0;
      if (a.when) {
        const center = today - a.when.back;
        if (it.day <= center && it.day >= center - a.when.span - 1) t = 1;
      }
      return { it, s: s + 0.5 * t + 0.3 * recency(it.day, today, 120) + (it.important ? 0.3 : 0) };
    })
    .sort((x, y) => y.s - x.s);
  if (!ranked.length || ranked[0].s < 0.25) return [];
  const floor = ranked[0].s * 0.35;
  const picked = [];
  for (const r of ranked) {
    if (r.s < floor || picked.length >= 3) break;
    const toks = tokenize(r.it.text);
    if (picked.some((p) => jaccard(p.toks, toks) >= 0.6)) continue;
    picked.push({ ...r, toks });
  }
  return picked.map(({ it }) => {
    const { body, rich } = itemLine(it, today, 24, 70);
    return unit('FOUND', it.id, `${it.kind} ${body}`, `${agoHuman(it.day, today, lang)}：“${safeQuote(it.text, 60)}”`, { rich: `${it.kind} ${rich}` });
  });
}

/** Build candidate units for the planned slots, in priority order. */
export function buildUnits(view, a, slots, today) {
  const lang = a.lang;
  const target = targetSignals(view, a, today);
  const targetDims = new Set([...target.map((s) => s.dim), ...a.strategies]);
  const queryTokens = new Set(tokenize(a.text));
  const units = [];
  let similarEpisodes = [];
  slots.forEach((slot, rank) => {
    let got = [];
    if (slot === 'RECENT') got = recentUnits(view, a, today, lang);
    else if (slot === 'SIMILAR') {
      got = similarUnits(view, a, today, lang, target);
      similarEpisodes = got.map((u) => u.episode);
    } else if (slot === 'REFLECT') got = reflectUnits(view, today, lang, targetDims, queryTokens);
    else if (slot === 'HELPED') got = helpedUnits(view, today, lang, targetDims, similarEpisodes);
    else if (slot === 'NEW') got = newUnits(view, a, lang);
    else if (slot === 'ANCHOR') got = kindUnits(view, 'anchor', 'ANCHOR', today, lang, { max: a.intents.has('anchors') ? 3 : 1, short: 30, long: 80 });
    else if (slot === 'SUPPORT') got = kindUnits(view, 'support_plan', 'SUPPORT', today, lang, { max: 1, short: 60, long: 200 });
    else if (slot === 'FUTURE') {
      const explicit = a.intents.has('future') || a.intents.has('support');
      got = kindUnits(view, 'future_message', 'FUTURE', today, lang, {
        max: explicit ? 2 : 1,
        short: 40,
        long: 160,
        match: explicit ? null : (it) => (it.tags || []).some((t) => targetDims.has(t)),
      });
    } else if (slot === 'SEARCH') got = searchUnits(view, a, today, lang);
    got.forEach((u, k) => {
      u.prio = (u.low ? 100 : 0) + rank * 10 + k;
      u.sens = view.items.find((it) => it.id === u.key)?.sens ?? 'normal';
      units.push(u);
    });
  });
  return units;
}
