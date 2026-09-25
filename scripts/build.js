#!/usr/bin/env node
// Builds the three distribution packages from one Memory Core:
//   dist/personal-memory-capsule.html   Universal Memory Capsule (single offline file)
//   dist/personal-memory.mcpb           Claude Desktop extension (local MCP server)
//   dist/personal-memory-skill.zip      Agent Skill (behaviour guide for skill-capable AIs)
// and the blank Memory Files anyone can download and send to an AI:
//   start/我的记忆.txt, start/my-memory.txt  (committed, so they can be linked directly)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.js';
import { memoryFile } from '../src/core/memfile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Dependency order of the core modules (each only imports from earlier ones).
export const CORE_ORDER = ['util', 'chain', 'lexicon', 'extract', 'query', 'layers', 'retrieve', 'compile', 'memfile', 'memory'];
const PUBLIC_API = ['createMemory', 'analyzeQuery', 'parseEntry', 'estimateTokens', 'memoryFile', 'parseMemoryFile', 'CORE_VERSION', 'MemoryError'];

/** Concatenate the ES modules into one classic script defining `PM`, each module in its own scope. */
export function bundleCore() {
  const exported = new Set();
  const parts = ['// Personal Memory core, bundled from src/core (MIT). Readable on purpose: audit it here.', '"use strict";'];
  for (const name of CORE_ORDER) {
    let src = fs.readFileSync(path.join(root, 'src/core', `${name}.js`), 'utf8');
    const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    for (const n of names) {
      if (exported.has(n)) throw new Error(`Duplicate export "${n}" in ${name}.js`);
      exported.add(n);
    }
    src = src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '');
    src = src.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\s)/gm, '');
    if (/^\s*(import|export)\s/m.test(src)) throw new Error(`Unbundleable import/export left in ${name}.js`);
    parts.push(`// ---- src/core/${name}.js ----`, `const { ${names.join(', ')} } = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();`);
  }
  parts.push(`const PM = Object.freeze({ ${PUBLIC_API.join(', ')} });`);
  return parts.join('\n');
}

function buildCapsule() {
  const html = fs.readFileSync(path.join(root, 'capsule/capsule.html'), 'utf8');
  const bundle = bundleCore();
  new Function(bundle); // syntax check
  const out = html.replace('/*__CORE__*/', () => bundle.replace(/<\/script/gi, '<\\/script'));
  const file = path.join(dist, 'personal-memory-capsule.html');
  fs.writeFileSync(file, out);
  return file;
}

export const STARTERS = { '我的记忆.txt': 'zh', 'my-memory.txt': 'en' };

export function starterText(lang) {
  return memoryFile([], { lang, today: 0 }).text;
}

function buildStarters() {
  fs.mkdirSync(path.join(root, 'start'), { recursive: true });
  return Object.entries(STARTERS).map(([name, lang]) => {
    const file = path.join(root, 'start', name);
    fs.writeFileSync(file, starterText(lang));
    return file;
  });
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

function buildMcpb() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packaging/claude-desktop/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  const files = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'package.json', data: Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license }, null, 2)) },
    { name: 'LICENSE', data: fs.readFileSync(path.join(root, 'LICENSE')) },
    { name: 'PRIVACY.md', data: fs.readFileSync(path.join(root, 'docs/PRIVACY.md')) },
  ];
  for (const sub of ['core', 'node', 'mcp']) {
    for (const f of listFiles(path.join(root, 'src', sub))) {
      files.push({ name: `src/${sub}/${f}`, data: fs.readFileSync(path.join(root, 'src', sub, f)) });
    }
  }
  const icon = path.join(root, 'packaging/claude-desktop/icon.png');
  if (fs.existsSync(icon)) files.push({ name: 'icon.png', data: fs.readFileSync(icon) });
  const file = path.join(dist, 'personal-memory.mcpb');
  fs.writeFileSync(file, zip(files));
  return file;
}

function buildSkill() {
  const dir = path.join(root, 'skill/personal-memory');
  const files = listFiles(dir).map((f) => ({ name: `personal-memory/${f}`, data: fs.readFileSync(path.join(dir, f)) }));
  const file = path.join(dist, 'personal-memory-skill.zip');
  fs.writeFileSync(file, zip(files));
  return file;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  fs.mkdirSync(dist, { recursive: true });
  for (const f of [buildCapsule(), buildMcpb(), buildSkill(), ...buildStarters()]) {
    console.log(`${path.relative(root, f)}  ${(fs.statSync(f).size / 1024).toFixed(1)} KB`);
  }
}
