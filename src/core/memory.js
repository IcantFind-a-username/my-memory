// The Memory Core API shared by every adapter (MCP server, online connector, browser capsule).
// Storage is injected: { location, load(), save(doc), appendAudit(ev), readAudit(n), writeExport(name, text) }.
//
// The record is an append-only archive: every note keeps the user's words
// verbatim with its time, sealed into a hash chain (chain.js). Notes are never
// edited. Later understanding is added as annotations next to the original.
// Deletion is a hide now, a tombstone after a cooling-off period.

import { parseEntry, extractWhen } from './extract.js';
import { analyzeQuery, planSlots } from './query.js';
import { buildView, lexIndex, bm25, tokenize } from './layers.js';
import { buildUnits } from './retrieve.js';
import { compile } from './compile.js';
import { memoryFile, parseMemoryFile } from './memfile.js';
import { sealEntry, toTombstone, verifyChain, entryHash } from './chain.js';
import { dayNumber, dayKey, keyToDay, newId, clamp, safeQuote, agoCode, agoHuman, detectLang, systemTzOffset, estimateTokens, localStamp } from './util.js';

export const FORMAT = 'personal-memory';
export const FORMAT_VERSION = 2;
export const CORE_VERSION = '0.2.0';
// Bump when extract/lexicon change how words become items, so old notes can be re-structured from `words` + `hints`.
export const PARSER_VERSION = 1;
export const COOLING_OFF_DAYS = 7;

const HARD_MAX_BUDGET = 800;
const SAVE_LIMIT = { count: 30, windowMs: 10 * 60000 };
const RECALL_LIMIT = { count: 30, windowMs: 60 * 60000 };
const LOOKUP_LIMIT = { count: 60, windowMs: 60 * 60000 };
const DAY_MS = 86400000;
const CRISIS_ONLY = 'SAFETY: possible crisis. Safety first: encourage contacting local emergency services or a crisis line and trusted people. Stay with them; no diagnosis.';

export class MemoryError extends Error {}

const live = (e) => !e.tombstone && !e.hidden;

function newDoc(now) {
  return { format: FORMAT, version: FORMAT_VERSION, created: now.toISOString(), rev: 0, settings: {}, entries: [] };
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

function cleanLabel(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? [...t].slice(0, max).join('') : null;
}

const SENS_ORDER = ['normal', 'sensitive', 'restricted'];
const maxSens = (a, b) => SENS_ORDER[Math.max(SENS_ORDER.indexOf(a), SENS_ORDER.indexOf(b))];

/**
 * @param {object} o
 * @param o.storage   storage adapter (see top of file)
 * @param o.policy    { shareSensitive=false, budget=300, maxBudget=500, autoRecord=false } - set by the user, never by the AI
 * @param o.via       'mcp' | 'connector' | 'capsule' | ...
 * @param o.clock     () => Date (tests inject a fake clock)
 * @param o.tz        minutes east of UTC
 */
export function createMemory({ storage, policy = {}, via = 'mcp', clock = () => new Date(), tz = systemTzOffset(), randomBytes } = {}) {
  const pol = { shareSensitive: false, budget: 300, maxBudget: 500, autoRecord: false, ...policy };
  pol.maxBudget = clamp(pol.maxBudget, 60, HARD_MAX_BUDGET);
  pol.budget = clamp(pol.budget, 60, pol.maxBudget);
  pol.autoRecord = pol.autoRecord === true;
  const allow = (sens) => sens === 'normal' || (sens === 'sensitive' && pol.shareSensitive === true);
  const views = new WeakMap();
  const events = { save: [], recall: [], lookup: [] };

  const today = () => dayNumber(clock(), tz);
  const stamp = (iso) => localStamp(iso, tz);

  async function commit(doc) {
    doc.rev = (doc.rev || 0) + 1;
    doc.updated = clock().toISOString();
    await storage.save(doc);
  }

  async function audit(ev) {
    await storage.appendAudit({ t: clock().toISOString(), via, ...ev });
  }

  /** Load, upgrade v1 files into a sealed chain, and finish cooling-off deletions that are due. */
  async function load() {
    const raw = await storage.load();
    const doc = raw ? checkDoc(raw) : newDoc(clock());
    doc.settings = doc.settings || {};
    let changed = false;
    if (doc.entries.some((e) => !e.hash)) {
      const unsealed = doc.entries.filter((e) => !e.hash).sort((a, b) => (a.savedAt < b.savedAt ? -1 : 1));
      const sealed = doc.entries.filter((e) => e.hash);
      for (const e of unsealed) sealed.push(sealEntry(sealed, e));
      doc.entries = sealed;
      doc.version = FORMAT_VERSION;
      doc.sealedAt = doc.sealedAt || clock().toISOString();
      changed = true;
    }
    const now = clock().toISOString();
    const due = doc.entries.filter((e) => e.hidden && !e.tombstone && e.deleteAfter && e.deleteAfter <= now);
    for (const e of due) {
      doc.entries[doc.entries.indexOf(e)] = toTombstone(e, now);
      // Annotations of a deleted note go with it.
      for (const a of doc.entries.filter((x) => x.annotates === e.id && !x.tombstone)) doc.entries[doc.entries.indexOf(a)] = toTombstone(a, now);
    }
    if (due.length) await audit({ op: 'deleted_after_cooling_off', ids: due.map((e) => e.id) });
    if (changed || due.length) await commit(doc);
    return doc;
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

  function resolveId(doc, id) {
    if (String(id) === 'last') {
      return doc.entries.filter((e) => !e.tombstone && !e.annotates).reduce((a, e) => (!a || e.seq > a.seq ? e : a), null);
    }
    const entryId = String(id).trim().replace(/^\[|\]$/g, '').split('.')[0];
    return doc.entries.find((e) => e.id === entryId) || null;
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

  function recordLines(doc, e, maxChars) {
    const kinds = [...new Set((e.items || []).map((it) => it.kind))].join('/') || 'note';
    const intact = entryHash(e) === e.hash ? 'verbatim, unchanged since saved' : 'WARNING: changed after saving';
    const head = `[${e.id}] ${stamp(e.savedAt)} · ${kinds}${e.state ? ` · state: ${e.state}` : ''}${e.origin === 'ai_candidate' ? ' · AI-written, user accepted' : ''} · ${intact}`;
    const lines = [head, `"${safeQuote(e.words, maxChars)}"`];
    for (const a of doc.entries.filter((x) => x.annotates === e.id && live(x) && allow(x.sensitivity))) {
      lines.push(`  added later ${stamp(a.savedAt)}${a.state ? ` (state: ${a.state})` : ''}: "${safeQuote(a.words, maxChars)}"`);
    }
    return lines.join('\n');
  }

  return {
    policy: { ...pol },

    /**
     * Save the user's own words. consent: 'user_asked' | 'user_confirmed', or
     * 'standing' when the user turned on automatic recording. `annotates` adds
     * to an earlier note without touching it. `state` is a label the user gave.
     */
    async remember(input = {}) {
      const words = typeof input.words === 'string' ? input.words.trim() : '';
      if (!words) throw new MemoryError('Nothing to save: pass the user\'s own words.');
      if (words.length > 4000) throw new MemoryError('Too long to save as one note (max 4000 characters). Save the key part.');
      const consent = input.consent;
      if (consent === 'standing') {
        if (!pol.autoRecord) throw new MemoryError('Automatic recording is off. Only save when the user asks, or says yes to your offer.');
      } else if (consent !== 'user_asked' && consent !== 'user_confirmed') {
        throw new MemoryError('Not saved. Only save when the user asked you to, or said yes to your offer to save.');
      }
      limit('save', SAVE_LIMIT);
      const doc = await load();
      if (consent === 'standing' && doc.settings.paused) {
        return { saved: false, text: 'Not saved: the user paused automatic recording. Do not save until they turn it back on.' };
      }
      const now = clock();
      const target = input.annotates ? resolveId(doc, input.annotates) : null;
      if (input.annotates && (!target || target.tombstone || target.annotates)) throw new MemoryError(`No saved note ${input.annotates} to add to.`);
      const hints = {
        kind: typeof input.kind === 'string' ? input.kind : undefined,
        tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string').slice(0, 12) : undefined,
        when: parseWhenHint(input.when, today()),
        sensitivity: input.sensitivity,
        important: input.important === true,
      };
      const parsed = parseEntry(words, hints);
      const recentDup = doc.entries.find((e) => live(e) && e.words === parsed.words && now - new Date(e.savedAt) < 10 * 60000);
      if (recentDup) {
        return { id: recentDup.id, duplicate: true, text: `Already saved a moment ago (id ${recentDup.id}); not saved twice.` };
      }
      // Small talk ("嗯嗯", "谢谢") has no items; everything else the user chose to share is kept.
      if (!target && !parsed.items.length) {
        if (consent === 'standing') return { saved: false, text: 'Not saved: nothing about the user in these words.' };
        throw new MemoryError('Nothing meaningful to save in those words.');
      }
      const entry = {
        id: newId(new Set(doc.entries.map((e) => e.id)), randomBytes),
        savedAt: now.toISOString(),
        day: dayKey(today()),
        words: parsed.words,
        consent,
        origin: input.origin === 'ai_candidate' ? 'ai_candidate' : 'user_words',
        via,
        ...(cleanLabel(input.state, 24) ? { state: cleanLabel(input.state, 24) } : {}),
        ...(target ? { annotates: target.id } : {}),
        sensitivity: target ? maxSens(parsed.sensitivity, target.sensitivity) : parsed.sensitivity,
        important: parsed.important,
        items: target ? [] : parsed.items,
        parser: PARSER_VERSION,
        hints: Object.fromEntries(Object.entries(hints).filter(([, v]) => v !== undefined && v !== null && v !== false)),
        aiSummary: typeof input.summary === 'string' && input.summary.trim() ? { text: input.summary.trim().slice(0, 200), by: 'ai' } : null,
      };
      sealEntry(doc.entries, entry);
      doc.entries.push(entry);
      const firstAuto = consent === 'standing' && !doc.settings.autoNoticeShown;
      if (firstAuto) doc.settings.autoNoticeShown = now.toISOString();
      await commit(doc);
      await audit({ op: 'remember', id: entry.id, seq: entry.seq, items: entry.items.length, consent, sensitivity: entry.sensitivity, annotates: entry.annotates || null });
      const lang = detectLang(words);
      const { parts, where } = describe(entry, lang);
      let text;
      if (target) text = `Added to note ${target.id} (id ${entry.id}); the original stays exactly as it was.`;
      else if (entry.sensitivity === 'restricted') text = `Saved privately (id ${entry.id}). No AI will see its content. Tell the user it is saved and only they can see it.`;
      else if (consent === 'standing') text = `Recorded (id ${entry.id}). Do not announce routine saves.`;
      else text = `Saved (id ${entry.id}): ${parts.join(' · ')}. Sensitivity: ${entry.sensitivity}. Tell the user in one short line what was saved; they can say "forget that".`;
      if (firstAuto) {
        text += ' This is the first automatic save: tell the user once, briefly, that what they share about themselves is now kept word for word in their own memory, never changed, and that they can say "暂停记录" / "pause recording" at any time.';
      }
      return { id: entry.id, entry, saved: true, text, human: lang === 'zh' ? `已记下（${where}）。说“忘掉这条”可以删除。` : `Saved (${where}). Say "forget that" to delete it.` };
    },

    /** Minimal, permission-filtered context for the current message: an index with ids, not quotes to rely on. */
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

    /**
     * The exact archive: original words, local date and time, integrity, and
     * anything added later. By ids, a day (YYYY-MM-DD), a range, or words.
     */
    async lookup({ ids, date, from, to, text, limit: max = 5 } = {}) {
      limit('lookup', LOOKUP_LIMIT);
      const doc = await load();
      const pool = doc.entries.filter((e) => live(e) && !e.annotates && allow(e.sensitivity));
      let found = [];
      const want = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && !x.startsWith('~')).slice(0, 20) : [];
      if (want.length) {
        for (const id of want) {
          const e = resolveId(doc, id);
          if (e && pool.includes(e) && !found.includes(e)) found.push(e);
        }
      } else if (date || from || to) {
        const lo = String(date || from || '0000-00-00');
        const hi = String(date || to || '9999-99-99');
        found = pool.filter((e) => e.day >= lo && e.day <= hi);
      } else if (typeof text === 'string' && text.trim()) {
        const v = buildView(pool, () => true);
        const scores = bm25(lexIndex(v), tokenize(text));
        const order = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([i]) => v.items[i].entryId);
        found = [...new Set(order)].map((id) => pool.find((e) => e.id === id)).filter(Boolean);
      } else {
        throw new MemoryError('Say which records to look up: ids, a date (YYYY-MM-DD), a range, or a few words.');
      }
      const n = clamp(Number(max) || 5, 1, 10);
      const total = found.length;
      found = found.slice(0, n);
      const blocks = [];
      let budget = 1500;
      for (const e of found) {
        const block = recordLines(doc, e, 500);
        const cost = estimateTokens(block);
        if (cost > budget && blocks.length) break;
        blocks.push(block);
        budget -= cost;
      }
      await audit({ op: 'lookup', shared: found.slice(0, blocks.length).map((e) => e.id), tokens: 1500 - budget });
      if (!blocks.length) return { found: 0, text: 'NO_RECORD: nothing in the archive matches. Say so; do not guess.' };
      const more = total > blocks.length ? `\n(${total - blocks.length} more match; narrow the search to see them)` : '';
      return {
        found: blocks.length,
        text: `ARCHIVE (the user's exact words with local time; quote them with date and time, do not paraphrase them as fact):\n${blocks.join('\n\n')}${more}`,
      };
    },

    /**
     * Hide a note now (no AI sees it) and delete it after the cooling-off period;
     * `undo` restores it within that period. `about` lists candidates.
     */
    async forget({ id, about, undo = false } = {}) {
      const doc = await load();
      const lang = detectLang(about || '');
      if (id) {
        const e = resolveId(doc, id);
        if (!e || e.tombstone) return { deleted: false, text: `No saved note with id ${id}.` };
        if (undo) {
          if (!e.hidden) return { deleted: false, text: `Note ${e.id} is not hidden; nothing to undo.` };
          delete e.hidden;
          delete e.deleteAfter;
          await commit(doc);
          await audit({ op: 'restore', id: e.id });
          return { deleted: false, restored: true, text: `Restored note ${e.id}.` };
        }
        if (e.hidden) return { deleted: false, text: `Note ${e.id} is already hidden and will be deleted on ${e.deleteAfter.slice(0, 10)}.` };
        e.hidden = true;
        e.deleteAfter = new Date(clock().getTime() + COOLING_OFF_DAYS * DAY_MS).toISOString();
        await commit(doc);
        await audit({ op: 'hide', id: e.id });
        const when = localStamp(e.deleteAfter, tz).slice(0, 10);
        return {
          deleted: false,
          hidden: true,
          id: e.id,
          text: `Hidden note ${e.id} (saved ${agoCode(keyToDay(e.day), today())}): no AI will see it now. It will be permanently deleted on ${when}; until then the user can undo (call forget with this id and undo: true). A marker that a note existed stays in the record.`,
        };
      }
      if (!about) throw new MemoryError('Say which note to forget: an id, or a few words about it.');
      // Search every live note so private ones can be deleted too, but never reveal their content.
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
      return { deleted: false, candidates: lines, text: `Matching notes (ask the user which one, then call forget with its id):\n${lines.join('\n')}` };
    },

    /** Counts and integrity only - never content. */
    async status() {
      const doc = await load();
      const kinds = {};
      const sens = { normal: 0, sensitive: 0, restricted: 0 };
      const liveEntries = doc.entries.filter(live);
      for (const e of liveEntries) {
        sens[e.sensitivity]++;
        for (const it of e.items) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
      }
      const hidden = doc.entries.filter((e) => e.hidden && !e.tombstone).length;
      const chain = verifyChain(doc.entries);
      const days = liveEntries.map((e) => e.day).sort();
      const log = await storage.readAudit(50);
      const lastRead = [...log].reverse().find((ev) => ev.op === 'recall' || ev.op === 'lookup');
      const integrity = chain.ok
        ? `all ${chain.count} records verified: none edited, none removed${chain.deleted ? ` (${chain.deleted} deleted by the user after the cooling-off period, marked in place)` : ''}`
        : `WARNING: ${chain.problems.length} problem(s): ${chain.problems.slice(0, 5).map((p) => `record #${p.seq} ${p.issue}`).join(', ')}`;
      return {
        notes: liveEntries.length,
        kinds,
        sensitivity: sens,
        hidden,
        chain,
        range: days.length ? [days[0], days[days.length - 1]] : null,
        location: storage.location,
        policy: { ...pol },
        paused: !!doc.settings.paused,
        lastRecall: lastRead ? lastRead.t : null,
        text: [
          `Notes: ${liveEntries.length} (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})${hidden ? `; ${hidden} hidden, waiting for deletion` : ''}`,
          `Integrity: ${integrity}`,
          `Automatic recording: ${pol.autoRecord ? (doc.settings.paused ? 'on, but paused by the user' : 'on') : 'off (saves only when asked)'}`,
          `Private: ${sens.restricted} never shared, ${sens.sensitive} sensitive (${pol.shareSensitive ? 'shared when relevant' : 'not shared'})`,
          `Stored at: ${storage.location}`,
          `Last time an AI read memory: ${lastRead ? stamp(lastRead.t) : 'never'}`,
        ].join('\n'),
      };
    },

    /** Stop or restart automatic recording. Only the user's own choice turns it on in the first place. */
    async setPaused(paused) {
      const doc = await load();
      doc.settings.paused = !!paused;
      await commit(doc);
      await audit({ op: paused ? 'pause_recording' : 'resume_recording' });
      return {
        text: paused
          ? 'Automatic recording paused. Nothing new is saved until the user turns it back on.'
          : pol.autoRecord ? 'Automatic recording is on again.' : 'Automatic recording is off in the user\'s settings; saving only when asked.',
      };
    },

    /** Check the whole record chain (used by status and the owner's page). */
    async verify() {
      return verifyChain((await load()).entries);
    },

    /** What was read or changed, when, and how much - ids and counts only. */
    async accessLog(n = 10) {
      const log = await storage.readAudit(clamp(n, 1, 100));
      const lines = log.map((ev) => {
        const t = stamp(ev.t);
        if (ev.op === 'recall') return `${t} read (${ev.via}): ${ev.shared?.length || 0} item(s), ~${ev.tokens} tokens${ev.shared?.length ? ` [${ev.shared.join(' ')}]` : ''}`;
        if (ev.op === 'lookup') return `${t} looked up exact records (${ev.via}): [${(ev.shared || []).join(' ')}]`;
        if (ev.op === 'remember') return `${t} saved ${ev.annotates ? `an addition to ${ev.annotates}` : `note ${ev.id}`} (${ev.consent}, ${ev.sensitivity})`;
        if (ev.op === 'hide') return `${t} hid note ${ev.id} (cooling-off before deletion)`;
        if (ev.op === 'restore') return `${t} restored note ${ev.id}`;
        if (ev.op === 'deleted_after_cooling_off') return `${t} permanently deleted ${ev.ids.join(' ')}`;
        if (ev.op === 'export') return `${t} exported ${ev.notes} note(s)`;
        return `${t} ${ev.op}`;
      });
      return { events: log, text: lines.length ? lines.join('\n') : 'No access yet.' };
    },

    /** Write everything to files on the user's device; the AI only learns the path. */
    async exportAll() {
      const doc = await load();
      const day = dayKey(today());
      const json = JSON.stringify(doc, null, 2);
      const md = toMarkdown(doc, today(), stamp);
      const jsonPath = await storage.writeExport(`personal-memory-${day}.json`, json);
      const mdPath = await storage.writeExport(`personal-memory-${day}.md`, md);
      const lang = fileLang(doc);
      const aiPath = await storage.writeExport(lang === 'zh' ? `我的记忆-${day}.txt` : `my-memory-${day}.txt`, memoryFile(doc.entries, { lang, today: today() }).text);
      await audit({ op: 'export', notes: doc.entries.length });
      return {
        paths: [jsonPath, mdPath, aiPath],
        text: `Exported ${doc.entries.length} record(s) to the user's device:\n${jsonPath} (full backup, with the integrity chain)\n${mdPath} (readable)\n${aiPath} (memory file to send to any AI; private notes left out)`,
      };
    },

    /** The Memory File to send to any AI: instructions + summary + notes. Restricted notes never included. */
    async exportForAI({ lang, includeSensitive = false, maxNotes = 400 } = {}) {
      const doc = await load();
      const out = memoryFile(doc.entries, { lang: lang || fileLang(doc), today: today(), includeSensitive, maxNotes });
      await audit({ op: 'export_ai', notes: out.notes, compressed: out.compressed, tokens: out.tokens, includeSensitive });
      return out;
    },

    /** Read note lines from a Memory File or from pasted AI replies ("【新记忆】…"). */
    async importMemoryFile(text) {
      return this.importNotes(parseMemoryFile(text, dayKey(today())));
    },

    /** Save notes the user chose to keep: [{ day, kind, words, origin, sensitivity }]. */
    async importNotes(lines) {
      const doc = await load();
      const existing = new Set(doc.entries.filter(live).map((e) => `${e.day}|${e.words}`));
      const ids = new Set(doc.entries.map((e) => e.id));
      const added = [];
      for (const line of lines) {
        if (!line || typeof line.words !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(line.day || '')) continue;
        const parsed = parseEntry(line.words.slice(0, 4000), { kind: line.kind, sensitivity: line.sensitivity });
        if (!parsed.items.length || existing.has(`${line.day}|${parsed.words}`)) continue;
        const entry = {
          id: newId(ids, randomBytes),
          savedAt: clock().toISOString(),
          day: line.day,
          words: parsed.words,
          consent: 'user_confirmed',
          origin: line.origin === 'ai_candidate' ? 'ai_candidate' : 'user_words',
          via: 'file',
          sensitivity: parsed.sensitivity,
          important: parsed.important,
          items: parsed.items,
          parser: PARSER_VERSION,
          hints: line.kind ? { kind: line.kind } : {},
          aiSummary: null,
        };
        ids.add(entry.id);
        existing.add(`${line.day}|${parsed.words}`);
        sealEntry(doc.entries, entry);
        doc.entries.push(entry);
        added.push(entry);
      }
      if (added.length) await commit(doc);
      await audit({ op: 'import_notes', found: lines.length, added: added.length });
      return { found: lines.length, added: added.length, entries: added };
    },

    /** Merge a previously exported file; imported notes are appended (and sealed) as new records. */
    async importDoc(incoming) {
      checkDoc(incoming);
      const doc = await load();
      const ids = new Set(doc.entries.map((e) => e.id));
      const words = new Set(doc.entries.filter(live).map((e) => `${e.day}|${e.words}`));
      let added = 0;
      const order = [...incoming.entries].filter((e) => !e.tombstone && !e.annotates && typeof e.words === 'string').sort((a, b) => (a.savedAt < b.savedAt ? -1 : 1));
      for (const e of order) {
        if (words.has(`${e.day}|${e.words}`)) continue;
        const { seq, prev, hash, hidden, deleteAfter, ...copy } = structuredClone(e);
        if (ids.has(copy.id)) copy.id = newId(ids, randomBytes);
        ids.add(copy.id);
        copy.via = copy.via || 'import';
        sealEntry(doc.entries, copy);
        doc.entries.push(copy);
        added++;
      }
      if (added) await commit(doc);
      await audit({ op: 'import', notes: added });
      return { added };
    },

    /** For the user's own views (capsule, online page): full list, never sent to an AI by this core. */
    async listForOwner() {
      return (await load()).entries;
    },

    async setSensitivity(id, level) {
      if (!['normal', 'sensitive', 'restricted'].includes(level)) throw new MemoryError('Unknown sensitivity level.');
      const doc = await load();
      const e = doc.entries.find((x) => x.id === id && !x.tombstone);
      if (!e) throw new MemoryError(`No saved note with id ${id}.`);
      e.sensitivity = level;
      await commit(doc);
      await audit({ op: 'set_sensitivity', id, level });
    },
  };
}

function fileLang(doc) {
  const sample = doc.entries.filter((e) => typeof e.words === 'string').slice(-50).map((e) => e.words).join(' ');
  return !sample || detectLang(sample) === 'zh' ? 'zh' : 'en';
}

const KIND_LABEL = {
  event: '事件 Event', state: '状态/感受 State', reflection: '体会 Reflection', anchor: '现实锚点 Anchor',
  coping: '应对方法 Coping', future_message: '给未来的自己 Future-self', relationship: '关系 Relationship', support_plan: '支持计划 Support plan',
};
const EPI_LABEL = { self_report: '我的感受 self-report', user_record: '我的记录 my record' };

function toMarkdown(doc, today, stamp) {
  const chain = verifyChain(doc.entries);
  const lines = [
    '# Personal Memory export',
    '',
    `Exported ${dayKey(today)} · ${doc.entries.length} records · format ${doc.format} v${doc.version}`,
    `Integrity: ${chain.ok ? 'all records verified unchanged' : `${chain.problems.length} problem(s) found`}`,
    '',
  ];
  const sorted = [...doc.entries].sort((a, b) => b.seq - a.seq);
  for (const e of sorted) {
    if (e.tombstone) {
      lines.push(`## #${e.seq} · deleted by the user on ${e.deletedAt.slice(0, 10)}`, '');
      continue;
    }
    const title = e.annotates ? `added later to ${e.annotates}` : e.id;
    lines.push(`## #${e.seq} · ${stamp(e.savedAt)} · ${title}${e.state ? ` · state: ${e.state}` : ''}${e.sensitivity !== 'normal' ? ` · ${e.sensitivity}` : ''}${e.hidden ? ' · hidden, waiting for deletion' : ''}`, '', `> ${e.words.replace(/\n/g, '\n> ')}`, '');
    for (const it of e.items) {
      const extra = it.kind === 'coping' ? ` — ${it.strategy} ${it.effect > 0 ? '+' : it.effect === 0 ? '0' : '-'}` : it.signals?.length ? ` — ${it.signals.map((s) => `${s.dim}:${s.val}`).join(', ')}` : '';
      lines.push(`- ${KIND_LABEL[it.kind]} (${EPI_LABEL[it.epistemic]}, structured by ${it.by})${extra}`);
    }
    if (e.aiSummary) lines.push(`- AI summary (not my words): ${e.aiSummary.text}`);
    lines.push(`- saved via ${e.via}, consent: ${e.consent}, hash ${e.hash.slice(0, 12)}…`, '');
  }
  return lines.join('\n');
}
