#!/usr/bin/env node
// #898 (#890 M5): the reference pages, generated from code. docs/site/actions.md, api.md and mcp.md keep their prose by
// hand above one heading each (## Actions, ## Routes, ## Tools); from that heading down the page is written here, from
// what the server's own modules answer (reference/collect.mjs): the edge action schema and intents, the engine's verbs,
// the refusal codes the edge source names, every HTTP route a new world registers, and every MCP tool the SDK lists.
// The generated part is not in the tree, so a change to the code never has to touch these pages: the docs build (the docsSite
// plugin, apps/web/vite.config.ts) runs this and renders the full pages, and CI checks that it runs (generate.test.mjs).
//
//   node tools/docs/generate.mjs              say what would be generated, or exit 1 if the generator can't run
//   node tools/docs/generate.mjs --json       print { "actions.md": <full page>, ... }: what the docs build reads
//   node tools/docs/generate.mjs --out <dir>  write the full pages there, to read them locally
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_MARK, ROOT } from './lint.mjs';

/** Each generated page: its file in docs/site and the heading the generated part starts at. */
export const PAGES = Object.freeze([
  { file: 'actions.md', heading: '## Actions', render: (f) => actionsSection(f) },
  { file: 'api.md', heading: '## Routes', render: (f) => routesSection(f) },
  { file: 'mcp.md', heading: '## Tools', render: (f) => toolsSection(f) },
]);

/** The facts, from a child process with a clean environment (PATH and an isolated DATA_DIR under .local/ only). */
export function collect(root = ROOT) {
  const dataDir = join(root, '.local/docs-reference');
  mkdirSync(dataDir, { recursive: true });
  let out;
  try {
    out = execFileSync(process.execPath, [join(root, 'tools/docs/reference/collect.mjs')], {
      cwd: root, env: { PATH: process.env.PATH ?? '', DATA_DIR: dataDir }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,   // about 2 s normally; never let a stuck read hang a CI job
    });
  } catch (e) { throw Error(`generate: reading the server failed (dependencies installed?):\n${String(e.stderr ?? e.message).trim().split('\n').slice(-12).join('\n')}`); }
  return JSON.parse(out);
}

// served text names no repository path (WRITING.md); how to regenerate is in WRITING.md and this file's header
const note = (what) => `${GENERATED_MARK} ${what}. Everything from this heading down is rebuilt from the code whenever it changes.`;
/** A table cell: one line, no pipe (the renderer splits rows on every pipe). */
const cell = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim();
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const firstSentence = (s) => String(s).replace(/^\[[^\]]*\]\s*/, '').split(/(?<=\.)\s/)[0];

/** A JSON Schema property, briefly: its type with bounds and choices. */
export function typeOf(s) {
  if (!s || typeof s !== 'object') return 'any';
  if ('const' in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(' or ');
  const alts = s.anyOf ?? s.oneOf;
  if (Array.isArray(alts)) return alts.map(typeOf).join(' or ');
  const t = Array.isArray(s.type) ? s.type.join(' or ') : s.type ?? 'any';
  const lo = s.minimum ?? s.minLength ?? s.minItems, hi = s.maximum ?? s.maxLength ?? s.maxItems;
  const range = lo !== undefined || hi !== undefined ? ` ${lo ?? ''}..${hi ?? ''}` : '';
  return t === 'array' && s.items ? `array of ${typeOf(s.items)}${range}` : `${t}${range}`;
}
const params = (schema, skip = []) => {
  const props = schema?.properties ?? {}, req = new Set(schema?.required ?? []);
  const p = Object.entries(props).filter(([k]) => !skip.includes(k));
  return p.length ? p.map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${typeOf(v)}`).join(', ') : 'none';
};

export function actionsSection(f) {
  const act = f.edge.act, seconds = act.params.seconds ?? {}, outcomes = act.verbOutcomes ?? {};
  const secs = (v) => { const s = seconds[v]; return s ? `${s.min}..${s.max} s${s.default !== undefined ? `, default ${s.default}` : ''}` : ''; };
  const otherParams = Object.entries(act.params).filter(([k]) => k !== 'seconds');
  const body = f.verbs.filter((v) => !v.scope), world = f.verbs.filter((v) => v.scope === 'world');
  const prefixes = f.refusals.alternativesRule.replace(/^\/\^\(\?:|\)\/$/g, '').split('|').map((p) => p.replace(/\\\./g, '.'));
  return [
    '## Actions', '', note(`the world's code: edge schema ${f.edge.schema}`), '',
    '### Act verbs', '',
    `A Soul acts with \`POST /v1/edge/act\` (MCP \`eden_act\`): \`{capability, params?, clientRef?}\`, where \`capability\` is an id from \`GET /v1/edge/capabilities\` or plain words. Ids: ${code(act.ids)}.`, '',
    table(['Verb', 'Outcome', 'Seconds'], act.verbs.map((v) => [code(v), outcomes[v]?.summary ?? '', secs(v)])), '',
    ...(seconds.activities ? [`Activities without their own row above take \`seconds\` ${seconds.activities.min}..${seconds.activities.max}.`, ''] : []),
    '### Act parameters', '',
    ...otherParams.map(([k, v]) => `- ${code(k)}: ${cell(v)}`),
    ...Object.entries(act.contentParams ?? {}).map(([k, v]) => `- ${code(k)} content: ${Object.entries(v).map(([p, d]) => `${code(p)} ${cell(d)}`).join(', ')}`), '',
    '### Intents', '',
    `Instead of a capability id, \`POST /v1/edge/act\` and \`POST /v1/edge/resolve\` (a dry run) take an intent \`{verb, target}\` the world resolves. Intent verbs: ${f.intentVerbs.map(code).join(', ')}.`, '',
    '### Receipts', '',
    `Every act returns a receipt. Phases: ${act.receipts.phases.map(code).join(', ')}. ${cell(act.receipts.note)}.`, '',
    `A failed body act whose code starts with ${prefixes.map(code).join(', ')} carries \`alternatives\`: a fresh dry run of the same intent, on the receipt and in its event.`, '',
    '### Refusal codes', '',
    `The codes the edge layer names (${f.refusals.codes.length}). Status is the HTTP status when the request itself is refused; a code without one ends a receipt or answers a dry run. Body acts also end with the engine's own codes (routes, seats, slots, poses), which are not listed here; the rule above says which of them carry \`alternatives\`.`, '',
    table(['Code', 'Status', 'Alternatives'], f.refusals.codes.map((c) => [code(c.code), c.status ?? '', c.alternatives ? 'yes' : ''])), '',
    '### Plans', '',
    `\`POST /v1/edge/plan\`: ${cell(f.edge.plan.body.steps)}; \`onRefusal\` ${f.edge.plan.body.onRefusal.map(code).join(', ')}.`, '',
    ...Object.entries(f.edge.plan.step).map(([k, v]) => `- ${code(k)}: ${cell(v)}`), '',
    ...f.edge.plan.rules.map((r) => `- ${cell(r)}`), '',
    `Plan events: ${f.edge.plan.events.map(code).join(', ')}.`, '',
    '### Events', '',
    `What a Soul hears on \`GET /v1/edge/events\` and \`GET /v1/edge/wait\` (MCP \`eden_wait\`). Salience: ${Object.entries(f.edge.events.salience).map(([k, v]) => `${k} ${cell(v)}`).join('; ')}.`, '',
    table(['Kind', 'Salience', 'What'], Object.entries(f.edge.events.kinds).map(([k, v]) => [code(k), v.salience, v.what])), '',
    '### Engine verbs', '',
    `The body verbs a card's \`approach\` and \`during\` steps use (cards: \`/w/<slug>/cards.md\`; a world's own list with full schemas: \`/v1/debug/verbs\`). Parameters marked ? are optional; \`actor\` is always the Soul itself.`, '',
    table(['Verb', 'Parameters', 'What it does'], body.map((v) => [code(v.verb), params(v.inputSchema, ['actor']), v.description])), '',
    `This world's engine also has ${world.length} verbs of its own, for cards that belong to the world:`, '',
    table(['Verb', 'What it does'], world.map((v) => [code(v.verb), firstSentence(v.description)])), '',
  ].join('\n');
}

/** Code-point order, the same on every machine and locale. */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const GROUP_ORDER = ['/v1/edge', '/v1/agent', '/v1/pair', '/v1/souls', '/v1/world', '/v1/god'];
const groupOf = (p) => (/^\/v1\/[^/]+/.exec(p)?.[0] ?? 'Files and pages').replace(/:.*$/, '');

export function routesSection(f) {
  const endpoints = new Map(f.edge.endpoints.map((e) => [`${e.method} ${e.path}`, e]));
  const publicEdge = new Set(f.edge.auth.public);
  const viaMcp = new Map(f.mcp.flatMap((t) => (t.routes ?? []).map((r) => [r, t.name])));
  const count = new Map();
  for (const r of f.routes) count.set(groupOf(r.path), (count.get(groupOf(r.path)) ?? 0) + 1);
  // a prefix with fewer than three routes joins "Other /v1 routes", so the page is not a list of one-line sections
  const groups = new Map();
  for (const r of f.routes) { let g = groupOf(r.path); if (g.startsWith('/v1/') && count.get(g) < 3) g = 'Other /v1 routes'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const order = [...groups.keys()].sort((a, b) => {
    const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : g === 'Files and pages' ? 1e6 : g === 'Other /v1 routes' ? 1e5 : 100);
    return rank(a) - rank(b) || cmp(a, b);
  });
  const line = (r) => {
    const k = `${r.method} ${r.path}`, e = endpoints.get(k), bits = [];
    if (r.what) bits.push(cell(r.what));
    if (publicEdge.has(k)) bits.push('public');
    if (e?.body) bits.push(`body ${code(e.body)}`);
    if (e?.query) bits.push(`query ${Object.entries(e.query).map(([q, d]) => `${code(q)} (${cell(d)})`).join(', ')}`);
    if (e?.produces) bits.push(`produces ${code(e.produces)}`);
    if (e?.protocol) bits.push(e.protocol);
    if (e?.idempotent) bits.push('idempotent with `clientRef`');
    if (e?.limit) bits.push(`limit ${e.limit}`);
    if (e?.auth) bits.push(`auth ${code(e.auth)}`);
    if (e?.note) bits.push(cell(e.note));
    if (viaMcp.has(k)) bits.push(`MCP ${code(viaMcp.get(k))}`);
    return `- ${code(`${r.method} ${r.path}`)}${bits.length ? `: ${bits.join('; ')}` : ''}`;
  };
  const inTable = new Set(f.routes.map((r) => `${r.method} ${r.path}`));
  const outside = [...f.beside, ...f.edge.endpoints.filter((e) => !inTable.has(`${e.method} ${e.path}`))];
  const out = ['## Routes', '', note(`the server's code: the ${f.routes.length} routes a new world registers, and the ${outside.length} endpoints served beside them`), '',
    `Paths are relative to the world, \`https://soul.game/w/<slug>\`. Edge routes take \`Authorization: Bearer <Soul token>\` unless marked public (${cell(f.edge.auth.pairing)}); the other groups' tokens are described under Base URL and auth. Where an MCP tool calls a route, its input schema is on the MCP page; edge routes show the body and query the edge schema gives.`, '',
    '### Served beside the route table', '', ...outside.map(line), ''];
  for (const g of order) {
    const rs = groups.get(g).sort((a, b) => cmp(a.path, b.path) || METHODS.indexOf(a.method) - METHODS.indexOf(b.method));
    out.push(`### ${g}`, '', ...rs.map(line), '');
  }
  return out.join('\n');
}

/** A tool's input schema without its `$schema` line (every one is the same draft, named once in the intro). */
const withoutDraft = (s) => { const { $schema, ...rest } = s ?? {}; return rest; };
const draftOf = (f) => [...new Set(f.mcp.map((t) => /draft-0?(\d+)/.exec(t.inputSchema?.$schema ?? '')?.[1]).filter(Boolean))];

export function toolsSection(f) {
  const out = ['## Tools', '', note(`the server's code: the ${f.mcp.length} tools its MCP endpoint lists`), '',
    `Tool descriptions name your Soul where the server fills in its name (shown here as \`{name}\`). Each input schema is the JSON Schema the server publishes in \`tools/list\` (draft ${draftOf(f).join(', ') || 'unstated'}).`, ''];
  for (const t of f.mcp) {
    const a = t.annotations ?? {}, facts = [`On ${t.where}.`];
    if (t.routes?.length) facts.push(`Calls ${t.routes.map(code).join(' and ')}.`);
    if (a.readOnlyHint !== undefined) facts.push(a.readOnlyHint ? 'Read-only.' : 'Changes the world.');
    if (a.idempotentHint) facts.push('Idempotent.');
    out.push(`### ${t.name}`, '', facts.join(' '), '', cell(t.description), '', `Parameters: ${params(t.inputSchema)}.`, '', '```json', JSON.stringify(withoutDraft(t.inputSchema), null, 1), '```', '');
  }
  return out.join('\n');
}

/** The page with everything from `heading` down replaced by `section`; throws if the heading is missing. */
export function splice(text, heading, section) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), i = lines.findIndex((l) => l.trimEnd() === heading);
  if (i < 0) throw Error(`generate: the page has no "${heading}" line to generate from`);
  return `${lines.slice(0, i).join('\n')}\n${section.trimEnd()}\n`.replace(/^\n/, '');
}

/** Every generated page in full: the committed prose above its heading, then the section from the code. [{ file, text }] */
export function fullPages(facts, root = ROOT) {
  return PAGES.map((p) => ({ file: p.file, text: splice(readFileSync(join(root, 'docs/site', p.file), 'utf8'), p.heading, p.render(facts)) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = fullPages(collect()), i = process.argv.indexOf('--out');
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(Object.fromEntries(pages.map((p) => [p.file, p.text]))));
  else {
    if (i > 0) {
      if (!process.argv[i + 1]) { console.error('usage: node tools/docs/generate.mjs [--json | --out <dir>]'); process.exit(2); }
      mkdirSync(resolve(process.argv[i + 1]), { recursive: true });
      for (const p of pages) writeFileSync(join(resolve(process.argv[i + 1]), p.file), p.text);
    }
    console.log(`docs reference: ${pages.map((p) => `${p.file} ${p.text.length} bytes`).join(', ')}`);
  }
}
