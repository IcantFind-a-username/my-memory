// MCP tool surface, shared by the local server (Claude Desktop) and the online
// connector (ChatGPT, Claude web/mobile). Five small tools: every description
// costs tokens in every conversation. Descriptions depend on the user's own
// setting for automatic recording, because some hosts ignore `instructions`.

import { KINDS } from '../core/lexicon.js';
import { MemoryError } from '../core/memory.js';

export function instructionsFor(policy = {}) {
  return [
    'Personal Memory: the user\'s own archive of their words, kept verbatim with date and time and never edited.',
    policy.autoRecord
      ? 'The user turned on automatic recording: when they tell you about themselves, save their message with remember (consent "standing") without announcing it; never save unrelated tasks; stop if they say "暂停记录"/"pause recording".'
      : 'Save only when the user asks ("remember this", "记住") or says yes to your offer; never on your own.',
    'Use recall when their own past, state, or what helped matters, not every turn; use lookup to quote exact records with date and time.',
    'Never guess about their past: if the archive has nothing, say so. Their feelings are self-reports, not facts; a→b means a came first, not a cause.',
    'Do not diagnose. Encourage real-world support; in a crisis, point to local emergency or crisis lines and the user\'s support plan.',
  ].join(' ');
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function toolsFor(policy = {}) {
  const auto = policy.autoRecord === true;
  return [
    {
      name: 'remember',
      title: 'Save to my memory',
      description: auto
        ? 'Save what the user tells you about themselves (feelings, events, what helped, people, plans), word for word. Automatic recording is ON by the user\'s choice: call it for each such message with consent "standing", without announcing it. Skip unrelated tasks.'
        : 'Save to the user\'s own memory. ONLY if they asked, or said yes to your offer. Never silently.',
      inputSchema: {
        type: 'object',
        properties: {
          words: { type: 'string', description: 'The user\'s own message, verbatim' },
          consent: { type: 'string', enum: auto ? ['standing', 'user_asked', 'user_confirmed'] : ['user_asked', 'user_confirmed'] },
          kind: { type: 'string', enum: KINDS },
          tags: { type: 'array', items: { type: 'string' }, description: 'e.g. sleep:poor, numbness, walk:helped; never a diagnosis' },
          when: { type: 'string', description: 'if not now: yesterday, 3 days ago, YYYY-MM-DD' },
          state: { type: 'string', description: 'Only if the user names the state or part they are in; never guess' },
          annotates: { type: 'string', description: 'id of an earlier record this adds to (the original is never changed)' },
          sensitivity: { type: 'string', enum: ['normal', 'sensitive', 'restricted'], description: 'Can only raise privacy' },
        },
        required: ['words', 'consent'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'recall',
      title: 'Look at my memory',
      description: 'Compact, privacy-filtered overview of the user\'s records for this message (recent state, similar past periods, what helped, anchors, future-self messages), with ids. Not for unrelated tasks.',
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
      name: 'lookup',
      title: 'Find exact records',
      description: 'Exact original records: the user\'s words verbatim, local date and time, integrity check, later additions. By ids (from recall), a date, a range, or words. Quote from here instead of guessing.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          text: { type: 'string', description: 'words to search for' },
        },
      },
      annotations: readOnly,
    },
    {
      name: 'forget',
      title: 'Delete from my memory',
      description: 'When the user asks: hide a record now, permanently deleted after a 7-day cooling-off; undo:true restores it. about = words to list matches.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, about: { type: 'string' }, undo: { type: 'boolean' } } },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'memory_info',
      title: 'My memory info',
      description: 'For the user: status (counts, integrity), access_log (what AI read), export, pause_recording / resume_recording.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['status', 'access_log', 'export', 'pause_recording', 'resume_recording'] } },
        required: ['action'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

const text = (t) => ({ type: 'text', text: t });

/**
 * Returns an MCP CallToolResult. Tool errors are results with isError, not protocol errors.
 * ctx.exportNote: where the user downloads exports (online connector has no local files).
 */
export async function callTool(memory, name, args = {}, ctx = {}) {
  const a = args && typeof args === 'object' ? args : {};
  try {
    switch (name) {
      case 'remember': {
        const r = await memory.remember(a);
        return { content: [text(r.text)] };
      }
      case 'recall': {
        const r = await memory.recall({ query: a.query, focus: a.focus || 'auto', seen: Array.isArray(a.seen) ? a.seen.slice(0, 200) : [] });
        const content = [{ ...text(r.text), annotations: { audience: ['assistant'] } }];
        if (r.preview) content.push({ ...text(r.preview), annotations: { audience: ['user'] } });
        return { content };
      }
      case 'lookup': {
        const r = await memory.lookup({ ids: a.ids, date: a.date, from: a.from, to: a.to, text: a.text });
        return { content: [text(r.text)] };
      }
      case 'forget': {
        const r = await memory.forget({ id: a.id, about: a.about, undo: a.undo === true });
        return { content: [text(r.text)] };
      }
      case 'memory_info': {
        if (a.action === 'status') return { content: [text((await memory.status()).text)] };
        if (a.action === 'access_log') return { content: [text((await memory.accessLog(15)).text)] };
        if (a.action === 'export') {
          if (ctx.exportNote) return { content: [text(ctx.exportNote)] };
          return { content: [text((await memory.exportAll()).text)] };
        }
        if (a.action === 'pause_recording') return { content: [text((await memory.setPaused(true)).text)] };
        if (a.action === 'resume_recording') return { content: [text((await memory.setPaused(false)).text)] };
        return { content: [text('Unknown action. Use status, access_log, export, pause_recording or resume_recording.')], isError: true };
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
