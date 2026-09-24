// The Memory Core API shared by every adapter (MCP server, browser capsule).
// Storage is injected: { location, load(), save(doc), appendAudit(ev), readAudit(n), writeExport(name, text) }.

import { parseEntry, extractWhen } from './extract.js';
import { analyzeQuery, planSlots } from './query.js';
import { buildView, lexIndex, bm25, tokenize } from './layers.js';
import { buildUnits } from './retrieve.js';
import { compile } from './compile.js';
import { dayNumber, dayKey, keyToDay, newId, clamp, safeQuote, agoCode, agoHuman, detectLang, systemTzOffset, estimateTokens } from './util.js';

export const FORMAT = 'personal-memory';
export const FORMAT_VERSION = 1;
export const CORE_VERSION = '0.1.0';
// Bump when extract/lexicon change how words become items, so old notes can be re-structured from `words` + `hints`.
export const PARSER_VERSION = 1;

const HARD_MAX_BUDGET = 800;
const SAVE_LIMIT = { count: 20, windowMs: 10 * 60000 };
const RECALL_LIMIT = { count: 30, windowMs: 60 * 60000 };
const CRISIS_ONLY = 'SAFETY: possible crisis. Safety first: encourage contacting local emergency services or a crisis line and trusted people. Stay with them; no diagnosis.';

export class MemoryError extends Error {}

function newDoc(now) {
  return { format: FORMAT, version: FORMAT_VERSION, created: now.toISOString(), rev: 0, entries: [] };
}

function checkDoc(doc) {
  if (!doc || doc.format !== FORMAT || !Array.isArray(doc.entries)) throw new MemoryError('The memory file is not a personal-memory file.');
  if (doc.version > FORMAT_VERSION) throw new MemoryError(`The memory file is from a newer version (${doc.version}); please update.`);
  return doc;
}

function parseWhenHint(when, today) {
  if (!when) return null;
  const s = String(when).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const back = today - keyToDay(s);
    return back >= 0 ? { back, span: 1 } : null;
  }
  return extractWhen(s);
}

/**
 * @param {object} o
 * @param o.storage   storage adapter (see top of file)
 * @param o.policy    { shareSensitive=false, budget=300, maxBudget=500 } - set by the user, never by the AI
 * @param o.via       'mcp' | 'capsule' | ...
 * @param o.clock     () => Date (tests inject a fake clock)
 * @param o.tz        minutes east of UTC
 */
export function createMemory({ storage, policy = {}, via = 'mcp', clock = () => new Date(), tz = systemTzOffset(), randomBytes } = {}) {
  const pol = { shareSensitive: false, budget: 300, maxBudget: 500, ...policy };
  pol.maxBudget = clamp(pol.maxBudget, 60, HARD_MAX_BUDGET);
  pol.budget = clamp(pol.budget, 60, pol.maxBudget);
  const allow = (sens) => sens === 'normal' || (sens === 'sensitive' && pol.shareSensitive === true);
  const views = new WeakMap();
  const events = { save: [], recall: [] };

  const today = () => dayNumber(clock(), tz);

  async function load() {
    const doc = await storage.load();
    return doc ? checkDoc(doc) : newDoc(clock());
  }

  async function commit(doc) {
    doc.rev = (doc.rev || 0) + 1;
    doc.updated = clock().toISOString();
    await storage.save(doc);
  }

  function view(doc) {
    const key = `${doc.rev}|${today()}`;
    const hit = views.get(doc);
    if (hit && hit.key === key) return hit.view;
    const v = buildView(doc.entries, allow);
    views.set(doc, { key, view: v });
    return v;
  }

  function limit(kind, spec) {
    const now = clock().getTime();
    const list = events[kind].filter((t) => now - t < spec.windowMs);
    if (list.length >= spec.count) throw new MemoryError(`Too many ${kind} requests in a short time; paused as a safety measure.`);
    list.push(now);
    events[kind] = list;
  }

  async function audit(ev) {
    await storage.appendAudit({ t: clock().toISOString(), via, ...ev });
  }

  function describe(entry, lang) {
    const parts = entry.items.map((it) => {
      if (it.kind === 'coping') return `${it.kind} ${it.strategy}:${it.effect > 0 ? '+' : it.effect === 0 ? '0' : '-'}`;
      if (it.signals?.length) return `${it.kind} ${it.signals.map((s) => `${s.dim}:${s.val}`).join(',')}`;
      return it.kind;
    });
    const where = entry.sensitivity === 'restricted'
      ? (lang === 'zh' ? '仅你自己可见，任何 AI 都看不到内容' : 'private: no AI will ever see its content')
      : entry.sensitivity === 'sensitive'
        ? (lang === 'zh' ? '敏感：默认不分享给 AI' : 'sensitive: not shared with AI by default')
        : (lang === 'zh' ? '需要时会只分享相关的一小部分' : 'only small relevant parts are shared when needed');
    return { parts, where };
  }

  return {
    policy: { ...pol },

    /** Save only on explicit consent; the unit of consent is also the unit of deletion. */
    async remember(input = {}) {
      const words = typeof input.words === 'string' ? input.words.trim() : '';
      if (!words) throw new MemoryError('Nothing to save: pass the user\'s own words.');
      if (words.length > 4000) throw new MemoryError('Too long to save as one note (max 4000 characters). Save the key part.');
      if (input.consent !== 'user_asked' && input.consent !== 'user_confirmed') {
        throw new MemoryError('Not saved. Only save when the user asked you to, or said yes to your offer to save.');
      }
      limit('save', SAVE_LIMIT);
      const doc = await load();
      const now = clock();
      const hints = {
        kind: typeof input.kind === 'string' ? input.kind : undefined,
        tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string').slice(0, 12) : undefined,
        when: parseWhenHint(input.when, today()),
        sensitivity: input.sensitivity,
        important: input.important === true,
      };
      const parsed = parseEntry(words, hints);
      const recentDup = doc.entries.find((e) => e.words === parsed.words && now - new Date(e.savedAt) < 10 * 60000);
      if (recentDup) {
        return { id: recentDup.id, duplicate: true, text: `Already saved a moment ago (id ${recentDup.id}); not saved twice.` };
      }
      if (!parsed.items.length) throw new MemoryError('Nothing meaningful to save in those words.');
      const entry = {
        id: newId(new Set(doc.entries.map((e) => e.id)), randomBytes),
        savedAt: now.toISOString(),
        day: dayKey(today()),
        words: parsed.words,
        consent: input.consent,
        origin: input.origin === 'ai_candidate' ? 'ai_candidate' : 'user_words',
        via,
        sensitivity: parsed.sensitivity,
        important: parsed.important,
        items: parsed.items,
        parser: PARSER_VERSION,
        hints: Object.fromEntries(Object.entries(hints).filter(([, v]) => v !== undefined && v !== null && v !== false)),
        aiSummary: typeof input.summary === 'string' && input.summary.trim() ? { text: input.summary.trim().slice(0, 200), by: 'ai' } : null,
      };
      doc.entries.push(entry);
      await commit(doc);
      await audit({ op: 'remember', id: entry.id, items: entry.items.length, consent: entry.consent, sensitivity: entry.sensitivity });
      const lang = detectLang(words);
      const { parts, where } = describe(entry, lang);
      const text = entry.sensitivity === 'restricted'
        ? `Saved privately (id ${entry.id}). No AI will see its content. Tell the user it is saved and only they can see it.`
        : `Saved (id ${entry.id}): ${parts.join(' · ')}. Sensitivity: ${entry.sensitivity}. Tell the user in one short line what was saved; they can say "forget that".`;
      return { id: entry.id, entry, text, human: lang === 'zh' ? `已记下（${where}）。说“忘掉这条”可以删除。` : `Saved (${where}). Say "forget that" to delete it.` };
    },

    /** Minimal, permission-filtered context for the current message. */
    async recall({ query = '', focus = 'auto', seen = [], exclude = [], budget, headerLang = 'en', force = false, withIds = true } = {}) {
      const a = analyzeQuery(query);
      const explicit = focus && focus !== 'auto';
      if (!a.need && !explicit && !force) {
        return { need: false, text: 'NO_MEMORY_NEEDED: this message is not about the user\'s own past or state.', preview: '', tokens: 0, ids: [], units: [] };
      }
      limit('recall', RECALL_LIMIT);
      const doc = await load();
      const v = view(doc);
      const slots = force && !explicit && !a.need ? ['SEARCH', 'RECENT'] : planSlots(a, focus);
      const units = buildUnits(v, a, slots, today());
      const B = clamp(Number(budget) || pol.budget, 60, pol.maxBudget);
      const out = compile(units, {
        budget: B,
        seen: new Set(seen),
        exclude: new Set(exclude),
        allow,
        lang: a.lang,
        headerLang,
        crisis: a.crisis,
        withIds,
      });
      let text = out.text;
      if (!out.units.length) {
        text = out.skippedSeen
          ? `MEMORY: nothing new (${out.skippedSeen} already shared in this chat).`
          : 'MEMORY: no relevant notes.';
        if (a.crisis) text = `${CRISIS_ONLY}\n${text}`;
      }
      const tokens = estimateTokens(text);
      await audit({ op: 'recall', focus, intents: [...a.intents], shared: out.ids, tokens });
      return { need: true, text, preview: out.preview.replace(/约 \d+ token|~\d+ tokens/, (m) => m.replace(/\d+/, String(tokens))), tokens, ids: out.ids, units: out.units, crisis: a.crisis };
    },

    /** Delete a whole saved note by id ('last' = most recent), or list candidates for `about`. */
    async forget({ id, about } = {}) {
      const doc = await load();
      const lang = detectLang(about || '');
      if (id) {
        const entryId = String(id) === 'last'
          ? doc.entries.reduce((a, e) => (!a || e.savedAt > a.savedAt ? e : a), null)?.id
          : String(id).replace(/^~/, '').split('.')[0];
        const idx = doc.entries.findIndex((e) => e.id === entryId);
        if (idx < 0) return { deleted: false, text: `No saved note with id ${id}.` };
        const [gone] = doc.entries.splice(idx, 1);
        await commit(doc);
        await audit({ op: 'forget', id: gone.id });
        const ago = agoCode(keyToDay(gone.day), today());
        return { deleted: true, id: gone.id, text: `Deleted note ${gone.id} (saved ${ago}, ${gone.items.length} item(s)). It is gone from memory; export files the user saved earlier are not changed.` };
      }
      if (!about) throw new MemoryError('Say which note to forget: an id, or a few words about it.');
      // Search every note so private ones can be deleted too, but never reveal their content.
      const all = buildView(doc.entries, () => true);
      const scores = bm25(lexIndex(all), tokenize(about));
      const hits = [...scores.entries()].sort((x, y) => y[1] - x[1]);
      const seenEntries = new Set();
      const lines = [];
      for (const [i] of hits) {
        const it = all.items[i];
        if (seenEntries.has(it.entryId)) continue;
        seenEntries.add(it.entryId);
        const e = doc.entries.find((x) => x.id === it.entryId);
        const when = agoHuman(keyToDay(e.day), today(), lang);
        lines.push(allow(e.sensitivity) ? `${e.id} (${when}): "${safeQuote(e.words, 40)}"` : `${e.id} (${when}): [private note, content hidden]`);
        if (lines.length >= 5) break;
      }
      await audit({ op: 'forget_search', matches: lines.length });
      if (!lines.length) return { deleted: false, candidates: [], text: 'No matching notes.' };
      return { deleted: false, candidates: lines, text: `Matching notes (ask the user which to delete, then call forget with its id):\n${lines.join('\n')}` };
    },

    /** Counts only - never content. */
    async status() {
      const doc = await load();
      const kinds = {};
      const sens = { normal: 0, sensitive: 0, restricted: 0 };
      for (const e of doc.entries) {
        sens[e.sensitivity]++;
        for (const it of e.items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
      }
      const days = doc.entries.map((e) => e.day).sort();
      const log = await storage.readAudit(50);
      const lastRead = [...log].reverse().find((ev) => ev.op === 'recall');
      return {
        notes: doc.entries.length,
        kinds,
        sensitivity: sens,
        range: days.length ? [days[0], days[days.length - 1]] : null,
        location: storage.location,
        policy: { ...pol },
        lastRecall: lastRead ? lastRead.t : null,
        text: [
          `Notes: ${doc.entries.length} (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`,
          `Private: ${sens.restricted} never shared, ${sens.sensitive} sensitive (${pol.shareSensitive ? 'shared when relevant' : 'not shared'})`,
          `Stored on this device at: ${storage.location}`,
          `Each reply may borrow at most ~${pol.budget} tokens of memory.`,
          `Last time an AI read memory: ${lastRead ? lastRead.t : 'never'}`,
        ].join('\n'),
      };
    },

    /** What was read or changed, when, and how much - ids and counts only. */
    async accessLog(n = 10) {
      const log = await storage.readAudit(clamp(n, 1, 100));
      const lines = log.map((ev) => {
        const t = new Date(Date.parse(ev.t) + tz * 60000).toISOString().slice(0, 16).replace('T', ' ');
        if (ev.op === 'recall') return `${t} read (${ev.via}): ${ev.shared?.length || 0} item(s), ~${ev.tokens} tokens${ev.shared?.length ? ` [${ev.shared.join(' ')}]` : ''}`;
        if (ev.op === 'remember') return `${t} saved note ${ev.id} (${ev.consent}, ${ev.sensitivity})`;
        if (ev.op === 'forget') return `${t} deleted note ${ev.id}`;
        if (ev.op === 'export') return `${t} exported ${ev.notes} note(s)`;
        return `${t} ${ev.op}`;
      });
      return { events: log, text: lines.length ? lines.join('\n') : 'No access yet.' };
    },

    /** Write everything to files on the user's device; the AI only learns the path. */
    async exportAll() {
      const doc = await load();
      const stamp = dayKey(today());
      const json = JSON.stringify(doc, null, 2);
      const md = toMarkdown(doc, today());
      const jsonPath = await storage.writeExport(`personal-memory-${stamp}.json`, json);
      const mdPath = await storage.writeExport(`personal-memory-${stamp}.md`, md);
      await audit({ op: 'export', notes: doc.entries.length });
      return { paths: [jsonPath, mdPath], text: `Exported ${doc.entries.length} note(s) to the user's device:\n${jsonPath}\n${mdPath}` };
    },

    /** Merge a previously exported file (e.g. moving between the capsule and the desktop app). */
    async importDoc(incoming) {
      checkDoc(incoming);
      const doc = await load();
      const ids = new Set(doc.entries.map((e) => e.id));
      const words = new Set(doc.entries.map((e) => `${e.day}|${e.words}`));
      let added = 0;
      for (const e of incoming.entries) {
        if (words.has(`${e.day}|${e.words}`)) continue;
        const copy = structuredClone(e);
        if (ids.has(copy.id)) copy.id = newId(ids, randomBytes);
        ids.add(copy.id);
        copy.via = copy.via || 'import';
        doc.entries.push(copy);
        added++;
      }
      doc.entries.sort((x, y) => (x.savedAt < y.savedAt ? -1 : 1));
      if (added) await commit(doc);
      await audit({ op: 'import', notes: added });
      return { added };
    },

    /** For the user's own local views (capsule "My memory"): full list, never sent to an AI by this core. */
    async listForOwner() {
      return (await load()).entries;
    },

    async setSensitivity(id, level) {
      if (!['normal', 'sensitive', 'restricted'].includes(level)) throw new MemoryError('Unknown sensitivity level.');
      const doc = await load();
      const e = doc.entries.find((x) => x.id === id);
      if (!e) throw new MemoryError(`No saved note with id ${id}.`);
      e.sensitivity = level;
      await commit(doc);
      await audit({ op: 'set_sensitivity', id, level });
    },
  };
}

const KIND_LABEL = {
  event: '事件 Event', state: '状态/感受 State', reflection: '体会 Reflection', anchor: '现实锚点 Anchor',
  coping: '应对方法 Coping', future_message: '给未来的自己 Future-self', relationship: '关系 Relationship', support_plan: '支持计划 Support plan',
};
const EPI_LABEL = { self_report: '我的感受 self-report', user_record: '我的记录 my record' };

function toMarkdown(doc, today) {
  const lines = ['# Personal Memory export', '', `Exported ${dayKey(today)} · ${doc.entries.length} notes · format ${doc.format} v${doc.version}`, ''];
  const sorted = [...doc.entries].sort((a, b) => (a.day < b.day ? 1 : -1));
  for (const e of sorted) {
    lines.push(`## ${e.day} · ${e.id}${e.sensitivity !== 'normal' ? ` · ${e.sensitivity}` : ''}`, '', `> ${e.words.replace(/\n/g, '\n> ')}`, '');
    for (const it of e.items) {
      const extra = it.kind === 'coping' ? ` — ${it.strategy} ${it.effect > 0 ? '+' : it.effect === 0 ? '0' : '-'}` : it.signals?.length ? ` — ${it.signals.map((s) => `${s.dim}:${s.val}`).join(', ')}` : '';
      lines.push(`- ${KIND_LABEL[it.kind]} (${EPI_LABEL[it.epistemic]}, structured by ${it.by})${extra}`);
    }
    if (e.aiSummary) lines.push(`- AI summary (not my words): ${e.aiSummary.text}`);
    lines.push(`- saved ${e.savedAt} via ${e.via}, consent: ${e.consent}`, '');
  }
  return lines.join('\n');
}
