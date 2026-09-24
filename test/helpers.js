// Test helpers: in-memory storage and a controllable clock.
import { createMemory } from '../src/core/memory.js';

export function memStorage() {
  let doc = null;
  const audit = [];
  const exports = {};
  return {
    location: 'memory',
    load: async () => (doc ? structuredClone(doc) : null),
    save: async (d) => { doc = structuredClone(d); },
    appendAudit: async (e) => { audit.push(e); },
    readAudit: async (n) => audit.slice(-n),
    writeExport: async (name, text) => { exports[name] = text; return `/exports/${name}`; },
    audit,
    exports,
    raw: () => doc,
  };
}

export function clock(iso) {
  let now = new Date(iso);
  const c = () => now;
  c.set = (s) => { now = new Date(s); };
  return c;
}

/** Beijing time (UTC+8) memory with a fake clock. */
export function setup(policy = {}) {
  const storage = memStorage();
  const c = clock('2026-09-05T10:00:00+08:00');
  const memory = createMemory({ storage, policy, clock: c, tz: 480, via: 'test' });
  return { storage, clock: c, memory };
}

export async function saveOn(env, isoDay, words, extra = {}) {
  env.clock.set(`${isoDay}T12:00:00+08:00`);
  return env.memory.remember({ words, consent: 'user_asked', ...extra });
}
