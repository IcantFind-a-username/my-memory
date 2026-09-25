// Shared helpers: token estimate, local-day arithmetic, ids, hashing, safe quoting.
// Environment-neutral: runs unchanged in Node and in the browser capsule.

const DAY_MS = 86400000;
const B32 = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * Conservative token estimate without a tokenizer: any non-ASCII char (CJK,
 * arrows, ×) counts as one token, ASCII as one token per three chars.
 */
export function estimateTokens(text) {
  let ascii = 0;
  let wide = 0;
  for (const ch of String(text)) (ch.codePointAt(0) < 128 ? ascii++ : wide++);
  return Math.ceil(wide + ascii / 3);
}

/** Minutes east of UTC for the running system (e.g. +480 for Beijing). */
export function systemTzOffset() {
  return -new Date().getTimezoneOffset();
}

/** Calendar day number (days since 1970-01-01) in the user's local zone. */
export function dayNumber(date, tzOffsetMin) {
  return Math.floor((date.getTime() + tzOffsetMin * 60000) / DAY_MS);
}

export function dayKey(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function keyToDay(key) {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

/** Compact machine form: "today", "1d ago", "20d ago", "06/17", "2025-06-17". */
export function agoCode(day, today) {
  const diff = today - day;
  if (diff <= 0) return 'today';
  if (diff < 61) return `${diff}d ago`;
  const key = dayKey(day);
  return key.slice(0, 4) === dayKey(today).slice(0, 4) ? key.slice(5).replace('-', '/') : key;
}

/** Human form in the user's language. */
export function agoHuman(day, today, lang) {
  const diff = today - day;
  const [y, m, d] = dayKey(day).split('-').map(Number);
  const sameYear = y === Number(dayKey(today).slice(0, 4));
  if (lang === 'zh') {
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 61) return `${diff} 天前`;
    return sameYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  }
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 61) return `${diff} days ago`;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return sameYear ? `${mon} ${d}` : `${mon} ${d}, ${y}`;
}

function defaultRandomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** Short, token-cheap id not already in `taken` (a Set). */
export function newId(taken, randomBytes = defaultRandomBytes) {
  for (;;) {
    let id = '';
    for (const b of randomBytes(4)) id += B32[b & 31];
    if (!taken.has(id)) return id;
  }
}

/** FNV-1a folded to 4 base32 chars: stable ids for aggregate lines. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += B32[h & 31];
    h >>>= 5;
  }
  return out;
}

/**
 * Render user text for an AI context line: one line, no markup or header-like
 * brackets, long digit runs (phones, ids) masked, truncated to `max` chars.
 * Memory text is data, never instructions; this keeps it looking like data.
 */
export function safeQuote(text, max) {
  let t = String(text)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/[[\]{}<>`|]/g, ' ')
    .replace(/\d[\d\s-]{5,}\d/g, '###')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...t];
  if (chars.length > max) t = `${chars.slice(0, max - 1).join('')}…`;
  return t;
}

/** "2026-09-05 21:14" in the user's local time. */
export function localStamp(iso, tzOffsetMin) {
  return new Date(Date.parse(iso) + tzOffsetMin * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function detectLang(text) {
  return /[\u4e00-\u9fff]/.test(String(text)) ? 'zh' : 'en';
}
