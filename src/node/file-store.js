// Local, user-owned storage: one readable JSON file in a folder the user can
// see, back up, or delete. Owner-only permissions; atomic, fsync'd writes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultDir() {
  return process.env.PERSONAL_MEMORY_DIR || path.join(os.homedir(), 'PersonalMemory');
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function fileStorage(dir = defaultDir()) {
  const file = path.join(dir, 'memory.json');
  const auditFile = path.join(dir, 'access-log.jsonl');
  const exportsDir = path.join(dir, 'exports');
  let cache = null; // { mtimeMs, size, doc }

  const ensureDir = (d) => fs.mkdirSync(d, { recursive: true, mode: 0o700 });

  return {
    location: file,

    async load() {
      let st;
      try {
        st = fs.statSync(file);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
      if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.doc;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        // Never overwrite a file we cannot read: that would destroy the user's memory.
        throw new Error(`Cannot read ${file} (${e.message}). Nothing was changed; restore it from an export or fix the file.`);
      }
      cache = { mtimeMs: st.mtimeMs, size: st.size, doc };
      return doc;
    },

    async save(doc) {
      ensureDir(dir);
      writeAtomic(file, JSON.stringify(doc, null, 1));
      const st = fs.statSync(file);
      cache = { mtimeMs: st.mtimeMs, size: st.size, doc };
    },

    async appendAudit(event) {
      ensureDir(dir);
      fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    },

    async readAudit(n) {
      try {
        const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-n).map((l) => JSON.parse(l));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },

    async writeExport(name, text) {
      ensureDir(exportsDir);
      const p = path.join(exportsDir, path.basename(name));
      writeAtomic(p, text);
      return p;
    },
  };
}
