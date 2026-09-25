// Tamper-evident record chain. Every saved note carries seq, prev (the hash
// of the note before it) and hash (SHA-256 over its immutable fields). The
// user's words can never be edited: a changed word breaks its hash, a removed
// note breaks the next note's `prev`. Deletion leaves a tombstone that keeps
// seq/prev/hash, so the chain still verifies and the gap stays visible.
// Derived structure (items, tags) is outside the hash: it can be rebuilt from
// the words at any time.

export const GENESIS = '0'.repeat(64);

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string (UTF-8), hex. Pure JS and synchronous, so it runs the same in Node and any browser. */
export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** The fields that make up a note's identity. Anything else is derived or a mutable flag. */
function sealedFields(e) {
  return [2, e.id, e.seq, e.prev, e.savedAt, e.day, e.words, e.consent, e.origin || 'user_words', e.via, e.state || null, e.annotates || null];
}

export function entryHash(e) {
  return sha256Hex(JSON.stringify(sealedFields(e)));
}

/** Append-only: give a new note its place in the chain. */
export function sealEntry(entries, e) {
  const last = entries.reduce((m, x) => (!m || x.seq > m.seq ? x : m), null);
  e.seq = last ? last.seq + 1 : 1;
  e.prev = last ? last.hash : GENESIS;
  e.hash = entryHash(e);
  return e;
}

/** Replace a note by a tombstone that keeps its place (and hash) in the chain. */
export function toTombstone(e, deletedAt) {
  return { id: e.id, seq: e.seq, prev: e.prev, hash: e.hash, day: e.day, savedAt: e.savedAt, tombstone: true, deletedAt };
}

/**
 * Check the whole chain. Returns { ok, count, deleted, problems: [{ seq, id, issue }] }.
 * issue: 'edited' (words or sealed fields changed), 'missing' (a note was removed
 * without a tombstone), 'reordered'.
 */
export function verifyChain(entries) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const problems = [];
  let prevHash = GENESIS;
  let expectSeq = 1;
  let deleted = 0;
  for (const e of sorted) {
    if (e.seq !== expectSeq) problems.push({ seq: expectSeq, id: null, issue: 'missing' });
    if (e.prev !== prevHash) problems.push({ seq: e.seq, id: e.id, issue: e.seq !== expectSeq ? 'missing' : 'reordered' });
    if (e.tombstone) deleted++;
    else if (entryHash(e) !== e.hash) problems.push({ seq: e.seq, id: e.id, issue: 'edited' });
    prevHash = e.hash;
    expectSeq = e.seq + 1;
  }
  return { ok: problems.length === 0, count: sorted.length, deleted, problems };
}
