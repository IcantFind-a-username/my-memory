// Encrypted per-person storage for the online connector.
//
// Each person holds a secret link token (32 random bytes). From it we derive,
// with HKDF, a directory name and an AES-256-GCM key. The server never stores
// the token or the key: the disk holds only ciphertext under an opaque id, so
// a copy of the disk (or an operator browsing it) cannot read anyone's memory.
// While a request is being served the process does see plaintext; that limit
// is stated plainly in docs/CONNECTOR.md.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function deriveKeys(token) {
  const ikm = Buffer.from(token, 'utf8');
  const id = Buffer.from(crypto.hkdfSync('sha256', ikm, 'personal-memory/v1', 'store-id', 16)).toString('hex');
  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, 'personal-memory/v1', 'store-key', 32));
  return { id, key };
}

function seal(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function open(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function secureStorage(root, token) {
  if (!TOKEN_RE.test(token)) throw new Error('Invalid link.');
  const { id, key } = deriveKeys(token);
  const dir = path.join(root, id);
  const file = path.join(dir, 'memory.enc');
  const auditFile = path.join(dir, 'access-log.enc');
  let cache = null;
  const ensure = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  return {
    id,
    location: 'your encrypted online memory store (readable only with your private link)',
    exists: () => fs.existsSync(file),

    async load() {
      let st;
      try {
        st = fs.statSync(file);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
      if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.doc;
      const wrapper = JSON.parse(fs.readFileSync(file, 'utf8'));
      const doc = JSON.parse(open(key, wrapper.data));
      cache = { mtimeMs: st.mtimeMs, size: st.size, doc };
      return doc;
    },

    async save(doc) {
      ensure();
      writeAtomic(file, JSON.stringify({ v: 1, alg: 'aes-256-gcm', data: seal(key, JSON.stringify(doc)) }));
      const st = fs.statSync(file);
      cache = { mtimeMs: st.mtimeMs, size: st.size, doc };
    },

    async appendAudit(event) {
      ensure();
      fs.appendFileSync(auditFile, `${seal(key, JSON.stringify(event))}\n`, { mode: 0o600 });
    },

    async readAudit(n) {
      try {
        const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-n).map((l) => JSON.parse(open(key, l)));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },

    async writeExport() {
      throw new Error('Exports are downloaded from the private memory page.');
    },

    destroy() {
      fs.rmSync(dir, { recursive: true, force: true });
      cache = null;
    },
  };
}
