#!/usr/bin/env node
// Zero-dependency MCP server over stdio (newline-delimited JSON-RPC 2.0).
// Small enough to audit in one sitting; no network access, no telemetry.
//
// Configuration (set by the user in their AI app's extension settings):
//   PERSONAL_MEMORY_DIR              folder holding memory.json (default ~/PersonalMemory)
//   PERSONAL_MEMORY_SHARE_SENSITIVE  "true" to let AI see notes marked sensitive (default false)
//   PERSONAL_MEMORY_BUDGET           max memory tokens lent per reply (default 300, 60..800)

import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createMemory, CORE_VERSION } from '../core/memory.js';
import { fileStorage, defaultDir } from '../node/file-store.js';
import { TOOLS, INSTRUCTIONS, callTool } from './tools.js';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export function createServer(memory, write) {
  const send = (msg) => write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && msg.id !== undefined && msg.method === undefined) return; // a response to us; we send no requests
      return fail(msg?.id ?? null, -32600, 'Invalid Request');
    }
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    const isNotification = id === undefined;
    try {
      switch (method) {
        case 'initialize': {
          const asked = params.protocolVersion;
          return reply(id, {
            protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'personal-memory', title: 'Personal Memory', version: CORE_VERSION },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping':
          return isNotification ? undefined : reply(id, {});
        case 'tools/list':
          return reply(id, { tools: TOOLS });
        case 'tools/call': {
          if (!TOOLS.some((t) => t.name === params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
          return reply(id, await callTool(memory, params.name, params.arguments || {}));
        }
        default:
          if (isNotification) return undefined; // notifications/initialized, cancelled, etc.
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      process.stderr.write(`[personal-memory] ${method} failed: ${e.stack || e}\n`);
      if (!isNotification) fail(id, -32603, 'Internal error');
    }
  }

  return {
    async onLine(line) {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return fail(null, -32700, 'Parse error');
      }
      if (Array.isArray(msg)) {
        for (const m of msg) await handle(m);
      } else {
        await handle(msg);
      }
    },
  };
}

function policyFromEnv(env) {
  const budget = Number(env.PERSONAL_MEMORY_BUDGET);
  return {
    shareSensitive: /^(true|1|yes)$/i.test(String(env.PERSONAL_MEMORY_SHARE_SENSITIVE ?? '')),
    budget: Number.isFinite(budget) && budget > 0 ? budget : 300,
    maxBudget: Number.isFinite(budget) && budget > 500 ? budget : 500,
  };
}

async function main() {
  const dir = process.env.PERSONAL_MEMORY_DIR || defaultDir();
  const memory = createMemory({ storage: fileStorage(dir), policy: policyFromEnv(process.env), via: 'mcp' });
  const server = createServer(memory, (s) => process.stdout.write(s));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve(); // one request at a time: keeps file writes ordered
  rl.on('line', (line) => {
    queue = queue.then(() => server.onLine(line));
  });
  rl.on('close', () => queue.then(() => process.exit(0)));
  process.stderr.write(`[personal-memory] ready, memory at ${dir}\n`);
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) main();
