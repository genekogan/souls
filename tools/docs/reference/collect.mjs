// #898: what the reference pages are generated from, read from the server's own code: a fresh launcher-style world (edge
// Souls, god mode, fake minds, an in-memory database) is built with the same modules a world process loads, then asked.
// Prints one JSON object: { world, routes, beside, mcp, edge, intentVerbs, verbs, refusals }. generate.mjs runs this in a
// child process with a clean environment, so the output never depends on the caller's shell. The database is in memory
// and nothing is written outside DATA_DIR (config.ts creates it when imported). The MCP handler is asked over a loopback
// server on an ephemeral port that only this process uses, closed before it exits.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The server's own log lines go to stderr; stdout carries only the JSON.
console.log = console.info = console.error;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { config } = await load('apps/server/src/config.ts');
const { Db } = await load('apps/server/src/db.ts');
const { WorldHost } = await load('apps/server/src/world.ts');
const { Auth } = await load('apps/server/src/auth.ts');
const { Brain } = await load('apps/server/src/brain.ts');
const { Souls } = await load('apps/server/src/souls.ts');
const { buildApp } = await load('apps/server/src/http.ts');
const { handleMcp } = await load('apps/server/src/mcp.ts');
const { EdgeLedger } = await load('apps/server/src/edge/ledger/ledger.ts');
const { GodMode } = await load('apps/server/src/god/god.ts');
const { edgeSchema } = await load('apps/server/src/edge/events/schema.ts');
const { INTENT_VERBS } = await load('apps/server/src/edge/intents/intents.ts');
const { marsFactory, GREEN_FIELD_WORLD } = await load('packages/engine-mars/src/index.ts');

// The world a launcher starts for a new slug (main.ts plainFactory: green field, safe crew removal, edge minds, god mode).
const worldId = 'docs-reference', slug = 'garden';
const factory = await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true });
const db = new Db(':memory:'), host = new WorldHost(db, factory, 'docs-reference', 1e9, worldId);
host.boot(); host.drainInputs();
// A deployed world serves both web builds; which static routes exist depends only on whether the directories exist, so
// stand-ins under DATA_DIR keep the list the same whether or not this checkout has built them.
const webDir = join(config.dataDir, 'web'), marsWebDir = join(config.dataDir, 'mars-web');
mkdirSync(marsWebDir, { recursive: true }); mkdirSync(webDir, { recursive: true }); writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Souls</title>');
const cfg = { ...config, webDir, marsWebDir, worldId, worldKey: slug, worldPath: `/w/${slug}`, publicUrl: `https://soul.game/w/${slug}`, worldEngine: true, mindDriver: 'edge',
  authProvider: 'none', accountAuthRequired: false, inviteRequired: false, brainMode: 'fake', budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined,
  privyAppId: '', privyAppSecret: '', archiveTakes: false, build: 'docs' };
const auth = new Auth(cfg, db);
const brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, onTalk() {} });
brain.quiesce();
const souls = new Souls(host, db, brain, cfg);
const edge = new EdgeLedger(host, db);
const god = new GodMode(db, { worldId, ownerId: null, tick: () => host.engine.world.tick, emit() {}, assetDir: join(cfg.dataDir, 'assets') });
const app = buildApp({ cfg, db, host, auth, brain, souls, edge, god, hub: { clients: new Map(), refreshMe() {} } });

// HTTP: every route the app registered (app.use middleware is method ALL and is not a route), once per method and path.
const seen = new Set(), routes = [];
for (const r of app.routes) {
  if (r.method === 'ALL') continue;
  const k = `${r.method} ${r.path}`;
  if (!seen.has(k)) { seen.add(k); routes.push({ method: r.method, path: r.path }); }
}

// Served beside the route table: main.ts hands /mcp to handleMcp before Hono, and the Hub takes WebSocket upgrades (/ws for
// the viewer; any other path, such as /v1/edge/events/ws, goes to the edge's own handler). Each is checked against the
// source that serves it, so a moved endpoint fails here instead of vanishing from the page.
const beside = [
  { method: 'POST', path: '/mcp', what: 'MCP (Streamable HTTP, stateless): Authorization: Bearer <Soul token>, or /mcp/<Soul token> for clients that only take a URL', file: 'apps/server/src/main.ts', needle: "req.url?.startsWith('/mcp')" },
  { method: 'GET', path: '/ws', what: 'WebSocket: the world viewer\'s live stream', file: 'apps/server/src/hub.ts', needle: "req.url?.startsWith('/ws')" },
];
for (const b of beside) if (!readFileSync(join(ROOT, b.file), 'utf8').includes(b.needle)) throw Error(`collect: ${b.file} no longer serves ${b.path} the way collect.mjs expects; update it`);

// MCP: the tools the SDK lists, asked over the real handler (handleMcp) with stand-ins for the Soul and its token. Three
// configurations: a world without edge Souls or soul-intent/2, an edge world, and an edge world with soul-intent/2 and
// its history; each tool is labelled with the first one that has it. An eden_* tool call is recorded, not answered:
// that is how each one's HTTP route is known.
const soul = { id: 's_docs', name: '{name}', owner: 'dev:docs' };
const calls = [];
const stubSouls = { host: {}, lifecycle: false, soulFromToken: () => soul, agentControlGuard: () => undefined };
const intent = { souls: stubSouls, host: stubSouls.host, historyEnabled: true, agentScope: () => ({}), guard: () => true };
const edgeCall = async (method, path) => { calls.push({ method, path }); return {}; };
let mode = { intent: false, edge: false };
const server = createServer((req, res) => { void handleMcp(req, res, stubSouls, mode.intent ? intent : undefined, mode.edge ? edgeCall : undefined); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
async function rpc(body, withIntent, withEdge) {
  mode = { intent: withIntent, edge: withEdge };
  const r = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', body: JSON.stringify(body),
    headers: { authorization: 'Bearer sim_docs', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } });
  return r.json();
}
const list = async (i, e) => (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, i, e)).result.tools;
const configs = [['every world', false, false], ['edge worlds', false, true], ['worlds with soul-intent/2', true, true]];
const mcp = [];
for (const [where, i, e] of configs) for (const t of await list(i, e)) if (!mcp.some((m) => m.name === t.name)) mcp.push({ ...t, where });
// A placeholder value for each property: required ones only, then every one, so a tool that takes another route with an
// optional field (eden_object with an action) shows both.
const sample = (s) => s?.enum ? s.enum[0] : s?.type === 'string' ? 'x' : s?.type === 'number' || s?.type === 'integer' ? Math.max(1, s.minimum ?? 1) : s?.type === 'boolean' ? true : s?.type === 'array' ? [] : s?.type === 'object' ? {} : 'x';
for (const t of mcp.filter((m) => m.name.startsWith('eden_'))) {
  const props = t.inputSchema?.properties ?? {}, req = t.inputSchema?.required ?? [];
  t.routes = [];
  for (const keys of [req, Object.keys(props)]) {
    calls.length = 0;
    await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: t.name, arguments: Object.fromEntries(keys.map((k) => [k, sample(props[k])])) } }, false, true);
    for (const c of calls) {
      const path = c.path.replace(/\?.*$/, ''), route = routes.find((r) => r.method === c.method && new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`).test(path));
      const k = `${c.method} ${route?.path ?? path}`;
      if (!t.routes.includes(k)) t.routes.push(k);
    }
  }
}

// Refusal codes the edge source names (EdgeError(status, 'code', ...) and { code: 'family.reason' } literals), and the rule
// that gives a failed body act `alternatives` (a fresh dry run of the same intent), read from intents.ts as written.
// tracked files only, so an untracked scratch file on a laptop cannot change the page
const files = execFileSync('git', ['ls-files', 'apps/server/src/edge'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.ts$/.test(f) && !/\.test\.ts$|fixture/.test(f)).sort();
const codes = new Map();
const CODE = "'([a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)+)'";
// EdgeError(status, 'code', ...), { code: 'code' } literals, and the ledger's refuse('code', ...) / fail('code') helpers
const CODES = new RegExp(`new EdgeError\\(\\s*(\\d{3})\\s*,\\s*${CODE}|\\bcode:\\s*${CODE}|\\b(?:refuse|fail)\\(\\s*${CODE}`, 'g');
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(CODES)) {
    const code = m[2] ?? m[3] ?? m[4], e = codes.get(code) ?? { code, status: null, files: [] };
    if (m[1]) e.status = Number(m[1]);
    if (!e.files.includes(rel)) e.files.push(rel);
    codes.set(code, e);
  }
}
const intentsSrc = readFileSync(join(ROOT, 'apps/server/src/edge/intents/intents.ts'), 'utf8');
const alt = /if \(r\.phase === 'failed' && r\.code && (\/\^\(\?:[^/]+\/)\.test\(r\.code\)\)/.exec(intentsSrc);
if (!alt) throw Error('collect: the alternatives rule in apps/server/src/edge/intents/intents.ts changed shape; update tools/docs/reference/collect.mjs');
const altRe = new RegExp(alt[1].slice(1, -1));
const refusals = { alternativesRule: alt[1], codes: [...codes.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)).map((c) => ({ ...c, alternatives: altRe.test(c.code) })) };

const verbs = host.engine.describeVerbs();
server.close();
process.stdout.write(JSON.stringify({ world: { slug }, routes, beside: beside.map(({ method, path, what }) => ({ method, path, what })), mcp, edge: edgeSchema(), intentVerbs: [...INTENT_VERBS], verbs, refusals }), () => process.exit(0));   // exit once the pipe has it all (open handles would keep the process up)
