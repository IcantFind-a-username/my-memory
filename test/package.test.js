// The Claude Desktop manifest must match the MCPB spec's required fields and the real tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOOLS } from '../src/mcp/tools.js';

test('MCPB manifest has the required fields and lists exactly the served tools', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../packaging/claude-desktop/manifest.json', import.meta.url), 'utf8'));
  for (const k of ['manifest_version', 'name', 'version', 'description', 'author', 'server']) assert.ok(m[k], k);
  assert.ok(['0.3', '0.4'].includes(m.manifest_version));
  assert.ok(m.author.name);
  assert.equal(m.server.type, 'node');
  assert.ok(fs.existsSync(new URL(`../${m.server.entry_point}`, import.meta.url)));
  assert.deepEqual(m.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(m.user_config.share_sensitive.default, false, 'sensitive sharing must default to off');
});
