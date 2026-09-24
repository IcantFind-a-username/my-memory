// MCP tool surface. Four small tools on purpose: every tool description costs
// tokens in every conversation, so behaviour guidance lives in INSTRUCTIONS
// (sent once) and in the Agent Skill, not in long descriptions.

import { KINDS } from '../core/lexicon.js';
import { MemoryError } from '../core/memory.js';

export const INSTRUCTIONS = [
  'Personal Memory: the user\'s own notes, stored on their device.',
  'Save only when the user asks ("remember this", "记住") or says yes to your offer; never on your own.',
  'Call recall only when their own past, state, or what helped matters - not every turn; pass ids you already got as `seen`.',
  'Say in one short line which notes you used. (s) items are self-reports, not facts; a→b means a came first, not a cause.',
  'Do not diagnose. Encourage real-world support; in a crisis, point to local emergency or crisis lines and the user\'s support plan.',
].join(' ');

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: 'remember',
    title: 'Save to my memory',
    description: 'Save to the user\'s own memory. ONLY if they asked, or said yes to your offer. Never silently.',
    inputSchema: {
      type: 'object',
      properties: {
        words: { type: 'string', description: 'User\'s own words, verbatim' },
        consent: { type: 'string', enum: ['user_asked', 'user_confirmed'] },
        kind: { type: 'string', enum: KINDS },
        tags: { type: 'array', items: { type: 'string' }, description: 'e.g. sleep:poor, numbness, walk:helped; never a diagnosis' },
        when: { type: 'string', description: 'today, yesterday, 3 days ago, YYYY-MM-DD' },
        summary: { type: 'string', description: 'Optional; stored as AI-written' },
        sensitivity: { type: 'string', enum: ['normal', 'sensitive', 'restricted'], description: 'Can only raise privacy' },
      },
      required: ['words', 'consent'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'recall',
    title: 'Look at my memory',
    description: 'Tiny, privacy-filtered slice of the user\'s notes for this message: recent state, similar past periods, what helped, anchors, future-self messages. Not for unrelated tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User\'s message, plus what "this" refers to' },
        focus: { type: 'string', enum: ['auto', 'recent', 'similar', 'helped', 'anchors', 'future_self', 'support', 'search'] },
        seen: { type: 'array', items: { type: 'string' }, description: 'ids already received in this chat' },
      },
      required: ['query'],
    },
    annotations: readOnly,
  },
  {
    name: 'forget',
    title: 'Delete from my memory',
    description: 'Delete a note when the user asks: id ("last" = latest), or about = words to list matches.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, about: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'memory_info',
    title: 'My memory info',
    description: 'For the user: status (counts, location), access_log (what AI read), export (file on their device).',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'access_log', 'export'] } }, required: ['action'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const text = (t) => ({ type: 'text', text: t });

/** Returns an MCP CallToolResult. Tool errors are results with isError, not protocol errors. */
export async function callTool(memory, name, args = {}) {
  try {
    switch (name) {
      case 'remember': {
        const r = await memory.remember(args);
        return { content: [text(r.text)] };
      }
      case 'recall': {
        const r = await memory.recall({ query: args.query, focus: args.focus || 'auto', seen: Array.isArray(args.seen) ? args.seen.slice(0, 200) : [] });
        const content = [{ ...text(r.text), annotations: { audience: ['assistant'] } }];
        if (r.preview) content.push({ ...text(r.preview), annotations: { audience: ['user'] } });
        return { content };
      }
      case 'forget': {
        const r = await memory.forget({ id: args.id, about: args.about });
        return { content: [text(r.text)] };
      }
      case 'memory_info': {
        if (args.action === 'status') return { content: [text((await memory.status()).text)] };
        if (args.action === 'access_log') return { content: [text((await memory.accessLog(15)).text)] };
        if (args.action === 'export') return { content: [text((await memory.exportAll()).text)] };
        return { content: [text('Unknown action. Use status, access_log or export.')], isError: true };
      }
      default:
        return { content: [text(`Unknown tool: ${name}`)], isError: true };
    }
  } catch (e) {
    if (e instanceof MemoryError) return { content: [text(e.message)], isError: true };
    process.stderr.write(`[personal-memory] ${name} failed: ${e.stack || e}\n`);
    return { content: [text(`Memory error: ${e.message}`)], isError: true };
  }
}
