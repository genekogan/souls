// #898: the reference pages agree with the code. The first test is the drift check: it fails when a route, tool, verb,
// schema or refusal code changes and docs/site was not regenerated (run node tools/docs/generate.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, actionsSection, collect, pagesFor, routesSection, splice, toolsSection } from './generate.mjs';
import { GENERATED_MARK, lintPage } from './lint.mjs';

const facts = collect();
const clone = () => JSON.parse(JSON.stringify(facts));

test('the committed reference pages are what the code generates', () => {
  for (const p of pagesFor(facts)) assert.equal(p.have, p.want, `${p.file} differs from the code: run node tools/docs/generate.mjs`);
});

test('generation is deterministic: a second read of the server gives the same facts', () => {
  assert.deepEqual(collect(), facts);
});

test('a changed schema in a fixture makes the pages drift', () => {
  const f = clone(), tool = f.mcp.find((t) => t.name === 'soul_wait');
  tool.inputSchema.properties.seconds.maximum = 90;
  const drifted = pagesFor(f).filter((p) => p.want !== p.have).map((p) => p.file);
  assert.deepEqual(drifted, ['docs/site/mcp.md']);
  const g = clone(); g.routes.push({ method: 'POST', path: '/v1/edge/fixture-route' });
  assert.deepEqual(pagesFor(g).filter((p) => p.want !== p.have).map((p) => p.file), ['docs/site/api.md']);
  const h = clone(); h.verbs[0].inputSchema.properties = { ...h.verbs[0].inputSchema.properties, fixture: { type: 'string' } };
  assert.deepEqual(pagesFor(h).filter((p) => p.want !== p.have).map((p) => p.file), ['docs/site/actions.md']);
});

test('every route, tool, verb and refusal code appears exactly once', () => {
  const count = (text, needle) => text.split(needle).length - 1;
  const api = routesSection(facts), mcp = toolsSection(facts), actions = actionsSection(facts);
  assert.ok(facts.routes.length > 300 && facts.mcp.length >= 28 && facts.verbs.length > 50, 'the server answered in full');
  for (const r of facts.routes) assert.equal(count(api, `\n- \`${r.method} ${r.path}\``), 1, `${r.method} ${r.path}`);
  for (const t of facts.mcp) assert.equal(count(mcp, `\n### ${t.name}\n`), 1, t.name);
  // each table counted in its own section (sit is both an act verb and an engine verb)
  const section = (h) => { const from = actions.indexOf(`\n### ${h}\n`), to = actions.indexOf('\n### ', from + 1); return actions.slice(from, to < 0 ? undefined : to); };
  for (const v of facts.verbs) assert.equal(count(section('Engine verbs'), `\n| \`${v.verb}\` |`), 1, v.verb);
  for (const v of facts.edge.act.verbs) assert.equal(count(section('Act verbs'), `\n| \`${v}\` |`), 1, v);
  for (const c of facts.refusals.codes) assert.equal(count(section('Refusal codes'), `\n| \`${c.code}\` |`), 1, c.code);
  const intents = section('Intents');
  for (const v of facts.intentVerbs) assert.equal(count(intents, `\`${v}\``), 1, v);
  assert.ok(facts.refusals.codes.some((c) => c.code === 'conversation.not-member'), 'codes named through refuse()/fail() are collected');
  for (const e of [...facts.beside, ...facts.edge.endpoints]) assert.equal(count(api, `\n- \`${e.method} ${e.path}\``), 1, `${e.method} ${e.path}`);
  assert.ok(actions.includes('carries `alternatives`'), 'the alternatives rule is stated');
  // the tool set is the one the MCP card (server.json) advertises, and each eden_* tool names the route it calls
  assert.ok(facts.mcp.filter((t) => t.name.startsWith('eden_')).every((t) => t.routes?.length && t.routes.every((r) => facts.routes.some((x) => `${x.method} ${x.path}` === r))));
});

test('splice keeps the prose above the heading and refuses a page without it', () => {
  const page = '---\ntitle: X\n---\n\n# X\n\n## How\n\nProse.\n\n## Tools\n\nold\n';
  assert.equal(splice(page, '## Tools', '## Tools\n\nnew\n'), '---\ntitle: X\n---\n\n# X\n\n## How\n\nProse.\n\n## Tools\n\nnew\n');
  assert.throws(() => splice(page, '## Routes', '## Routes\n'), /no "## Routes" line/);
  assert.deepEqual(PAGES.map((p) => p.file), ['actions.md', 'api.md', 'mcp.md']);
});

test('lint: the prose style rules stop at the generated mark; links and private data are still checked', () => {
  const page = (body, generated = true) => `---\ntitle: T\ndescription: d\naudience: agents\nupdated: 2026-11-05\nsources:\n  - tools/docs/generate.mjs\ngenerated: ${generated}\n---\n\n# T\n\n${body}\n`;
  const codes = (t) => lintPage(t, { pages: new Set(['/docs']) }).map((p) => p.code);
  assert.deepEqual(codes(page(`## Tools\n\n${GENERATED_MARK} x.\n\nA quote from code — as written.`)), []);
  assert.deepEqual(codes(page(`Prose — here.\n\n## Tools\n\n${GENERATED_MARK} x.`)), ['style.em-dash']);
  assert.deepEqual(codes(page(`## Tools\n\n${GENERATED_MARK} x.\n\nA quote — here.`, false)), ['style.em-dash']);
  assert.deepEqual(codes(page(`${GENERATED_MARK} hand prose — not under a heading.\n\n## Tools\n\nx`)), ['style.em-dash'], 'the mark counts only directly under a ## heading');
  assert.deepEqual(codes(page(`## Tools\n\n${GENERATED_MARK} x.\n\nSee http://example.com/x`)), ['link.host']);
});
