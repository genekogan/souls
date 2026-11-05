// #897: the MCP discovery document and the root llms.txt Worlds section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MCP_SCHEMA, MCP_TOOLS, mcpServerJson, siteLlmsTxt } from './mcp-card.mjs';

test('server.json meets the registry schema (2025-12-11) constraints', () => {
  const d = mcpServerJson({ origin: 'https://soul.game', version: '4.14.0' });
  assert.equal(d.$schema, MCP_SCHEMA);
  for (const k of ['name', 'description', 'version']) assert.ok(typeof d[k] === 'string' && d[k].length, k);
  assert.match(d.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/); assert.ok(d.name.length >= 3 && d.name.length <= 200);
  assert.ok(d.description.length >= 1 && d.description.length <= 100, `description is ${d.description.length} characters`);
  assert.ok(d.version.length <= 255 && !/[\^~><=*x]/.test(d.version), 'an exact version, not a range');
  assert.equal(mcpServerJson({ origin: 'https://soul.game', version: 'dev' }).version, '0.0.0', 'a dev build still has a valid version');
  assert.equal(d.remotes.length, 1);
  const [r] = d.remotes;
  assert.equal(r.type, 'streamable-http'); assert.match(r.url, /^https?:\/\/[^\s]+$/); assert.equal(r.url, 'https://soul.game/w/{world}/mcp');
  for (const v of r.url.match(/\{([^}]+)\}/g).map((m) => m.slice(1, -1))) assert.ok(r.variables[v]?.isRequired, `variable ${v} declared`);
  assert.deepEqual(r.headers.map((h) => [h.name, h.isRequired, h.isSecret]), [['Authorization', true, true]]);
  assert.deepEqual(Object.keys(d._meta), ['io.modelcontextprotocol.registry/publisher-provided']);
  assert.equal(mcpServerJson({ origin: 'https://x.test', base: '/worlds' }).remotes[0].url, 'https://x.test/worlds/w/{world}/mcp');
});

test('the tool list is exactly what apps/server/src/mcp.ts registers', () => {
  const src = readFileSync(new URL('../../apps/server/src/mcp.ts', import.meta.url), 'utf8');
  const registered = [...src.matchAll(/registerTool\('([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...MCP_TOOLS].sort(), [...new Set(registered)].sort());
  assert.deepEqual(mcpServerJson({ origin: 'https://soul.game' })._meta['io.modelcontextprotocol.registry/publisher-provided'].tools, [...MCP_TOOLS]);
});

test('root llms.txt: the docs index plus one reader line per listed world; nothing added without worlds', () => {
  const idx = '# Souls\n\n> x\n';
  assert.equal(siteLlmsTxt(idx, { origin: 'https://soul.game', worlds: [] }), idx);
  const out = siteLlmsTxt(idx, { origin: 'https://soul.game', worlds: [{ slug: 'eden-2026', name: 'Eden 2026' }, { slug: 'odd', name: 'A [weird]\nname' }] });
  assert.match(out, /\n## Worlds\n\n- \[Eden 2026\]\(https:\/\/soul\.game\/w\/eden-2026\/llms\.txt\): a world in Souls/);
  assert.ok(out.includes('- [A  weird  name](https://soul.game/w/odd/llms.txt)'), 'a name cannot break the link');
});
