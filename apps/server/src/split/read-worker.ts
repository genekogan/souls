// Stage B (lane B-port; seed: the L9 spike's worker): one read worker of a world's pool (split/read-pool.ts starts 1–4).
// It holds a ReadModel fed by WorldInit/WorldDelta from the tick thread over its parentPort and owns a loopback HTTP
// listener (workerData.port; 0 = the OS picks), so a Soul read never needs the tick thread to be free.
//
// What it answers itself (mode 1, until B-facade lands: the spike's subset, docs/architecture/split.md §3):
//   GET /v1/edge/here and GET /v1/edge/capabilities with no query, for a Soul it knows, answered `subset: true`;
//   GET /healthz and /healthz/read: this worker's own health (gen, lag, tick), O(1).
// Everything else (a C1 sent here by mistake, any other read, a query it does not serve, an unknown token) goes to the
// main thread as a job over its `intents` MessagePort (load/admission.ts admissionPort: the same Admission.request as
// the HTTP middleware, closed() through the port) and the answer (an act's receipt) comes back the same way.
// Tokens: the main thread says which Soul a token is (and its account tag); fresh 30 s, then re-asked in the background
// and still used up to 10 min (a revoked token can read its own Soul's subset that long while main is too busy to say).
import {parentPort, workerData, type MessagePort} from 'node:worker_threads';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {threadCpuUsage} from 'node:process';
import {ReadModel, type WorldDelta, type WorldInit} from './read-model.ts';
import {classify, worldBlock, type PortDone, type Refusal} from '../load/admission.ts';
import {LEVELS, S, type Level} from '../load/shared.ts';
import {stripWorldRequestPath} from '../world-request-path.ts';
import {readFileSync} from 'node:fs';
import type {ReplicaWorld as RWT} from './replica-world.ts';
import type {ReadOnlyHost as RHT, MainOnly as MOT} from './read-host.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeSoul} from '../edge/contract.ts';

/** mode 2 (B-facade item 6): the world this worker reads, to open its own read-only view of it. */
export type ReadWorld = {dbPath: string; worldId: string};
export type ReadWorkerData = {index: number; port: number; mode: number; worldPath: string; lag: SharedArrayBuffer; load?: SharedArrayBuffer; intents: MessagePort; authMs?: number; world?: ReadWorld};
export type ToWorker = {t: 'init'; gen: number; w: WorldInit} | {t: 'delta'; gen: number; d: WorldDelta} | {t: 'query'; id: number; kind: string; soulId: string} | {t: 'forget'};
export type AuthAnswer = {t: 'auth'; id: number; soulId: string | null; account?: string | null};
export type Forward = {method: string; url: string; headers: [string, string][]; body?: ArrayBuffer};
export type Forwarded = {status: number; headers: [string, string][]; body: ArrayBuffer};

const wd = workerData as ReadWorkerData, M = new ReadModel(), lag = new Float64Array(wd.lag), load = wd.load ? new Float64Array(wd.load) : null;
const AUTH_MS = wd.authMs ?? 30_000, AUTH_STALE_MS = 10 * 60_000, CONTRACT = 'eden-edge/1';
const cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
const cost = {deltas: 0, ingestCpuMs: 0, maxIngestCpuMs: 0, queries: 0, queryCpuMs: 0, maxQueryCpuMs: 0, initCpuMs: 0, served: 0, forwarded: 0};
let gen = 0;
const myGen = (g: number) => {gen = g; lag[1 + wd.index] = g;};

const answer = (kind: string, soulId: string) => {
  const c = cpuMs(), v = kind === 'here' ? M.here(soulId) : kind === 'caps' ? {tick: M.tick, ids: M.capabilities(soulId)} : {tick: M.tick, stats: M.stats(), cost};
  const ms = cpuMs() - c; if (kind !== 'stats') {cost.queries++; cost.queryCpuMs += ms; cost.maxQueryCpuMs = Math.max(cost.maxQueryCpuMs, ms);}
  return {...v, cpuMs: Math.round(ms * 1000) / 1000};
};
// ---- mode 2 (B-facade item 6): the read code itself over a ReplicaWorld + a read-only host (split/read-host.ts)
const R2 = wd.mode >= 2 && wd.world ? await (async () => {
  const [{ReplicaWorld}, {ReadOnlyHost, readLedger, MainOnly}, {readBridgeSync, readBridgeCost}] = await Promise.all([import('./replica-world.ts'), import('./read-host.ts'), import('./read-bridge.ts')]);
  return {ReplicaWorld, ReadOnlyHost, readLedger, MainOnly, readBridgeSync, readBridgeCost};
})() : null;
let RW: RWT | null = null, RH: RHT | null = null, RL: EdgeLedger | null = null, ready2 = false;
/** A static edit moved the scene: connectivity relabels in slices between messages; reads go to main meanwhile. */
let relabel: {since: number; rebuilds: number} | null = null;
const c2 = {warmMs: 0, relabels: 0, relabelMs: 0, maxRelabelMs: 0, served: 0, cpuMs: 0, maxCpuMs: 0, fallbacks: {} as Record<string, number>, asks: 0, syncMs: 0, slow: [] as {ms: number; soul: string; nth: number; tick: number; read: string}[]};
const servedBy = new Map<string, number>();
const fallback = (why: string) => {c2.fallbacks[why] = (c2.fallbacks[why] ?? 0) + 1;};
function relabelSlice() {
  if (!relabel || !RW?.spatial) {relabel = null; return;}
  const done = RW.spatial.warmSliceV1(25);
  if (done) {const ms = performance.now() - relabel.since; c2.relabels++; c2.relabelMs += ms; c2.maxRelabelMs = Math.max(c2.maxRelabelMs, ms); relabel = null; return;}
  setImmediate(relabelSlice);
}
function init2(w: WorldInit) {
  RW ??= new R2!.ReplicaWorld();
  RW.init(w as never);
  if (!RH) {
    RH = new R2!.ReadOnlyHost(RW, wd.world!.worldId, wd.world!.dbPath);
    RL = R2!.readLedger(RH, process.env.PLACE_DATA ? JSON.parse(readFileSync(process.env.PLACE_DATA, 'utf8')) : undefined);
  }
  RL!.replicaSync(RW.R.faded, RW.R.static?.places);
  relabel = null; warm2();
}
/** B-spatial: the first labelling takes seconds (8.7 s on the live copy): before 'ready', never inside a Soul's read.
 *  No spatial service yet (the static scene arrives with a later delta): not ready; warmed when it is built. */
function warm2() {
  if (!RW?.spatial) {ready2 = false; return;}
  c2.warmMs += RW.spatial.warmLabelsV1();
  if (!ready2) {ready2 = true; parentPort!.postMessage({t: 'ready', index: wd.index, gen, tick: tickNow(), warmMs: c2.warmMs});}
}
function apply2(d: WorldDelta): boolean {
  const before = RW!.cost.spatialBuilds + RW!.cost.spatialRebuilds;
  if (!RW!.apply(d as never)) return false;
  const t0 = performance.now(); RL!.replicaSync(RW!.R.faded, RW!.R.static?.places); c2.syncMs += performance.now() - t0;
  if (!ready2) warm2();
  else if (RW!.cost.spatialBuilds + RW!.cost.spatialRebuilds !== before && RW!.spatial) {if (!relabel) {relabel = {since: performance.now(), rebuilds: RW!.cost.spatialRebuilds}; setImmediate(relabelSlice);}}
  if (!bgQueued) {bgQueued = true; setImmediate(background);}
  return true;
}
/** B-facade (b): the warm-up a read would otherwise do, after each delta and outside any read: the god layer brought to
 *  main's last commit (its place index derives at god edits and at each 1,200-tick boundary), connectivity labels after
 *  main's windows move (a slice per delta; a read finishes what is left). Its thread CPU is counted apart (`bg`). */
let bgQueued = false;
const BG_SLICE_MS = 8;
const bg = {runs: 0, cpuMs: 0, maxCpuMs: 0};
function background() {
  bgQueued = false;
  if (!RW || !RL || !RH || !ready2 || relabel) return;
  const c = cpuMs();
  try {R2!.readBridgeSync(RH, RL); RW.spatial?.warmSliceV1(BG_SLICE_MS);}
  catch (e) {console.error('[read-worker] background', wd.index, e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 3).join(' | ') : e);}
  const ms = cpuMs() - c; bg.runs++; bg.cpuMs += ms; bg.maxCpuMs = Math.max(bg.maxCpuMs, ms);
}
/** After a read: the verdicts it missed, to main's pump (answered with the next delta). */
function askMisses() {
  const box = RL?.knowledge.outbox; if (box?.length) {parentPort!.postMessage({t: 'writes', index: wd.index, rows: box.splice(0)});}
  const m = RW?.verdicts.misses; if (!m?.size) return;
  parentPort!.postMessage({t: 'ask', index: wd.index, misses: [...m.values()]}); c2.asks += m.size; m.clear();
}
const tickNow = () => R2 ? (RW?.R.pos.tick ?? -1) : M.tick;
const ADMISSION = process.env.SIM_ADMISSION !== '0';   // main.ts: SIM_ADMISSION=0 turns in-world admission off
const LAG_GENS = 40;   // 2 s of ticks behind main: main answers instead
/** The Soul reads this worker computes (mode 2), by route: the body main's route answers (edge/routes.ts, edge/eyes/
 *  routes.ts), from the same read code over the read-only host. `world`: main's wrap adds the load block (view's route
 *  does not). A query the worker does not answer itself returns null with the reason (main answers, counted). */
type Read2 = 'here' | 'observe' | 'capabilities' | 'view';
const READ2: Record<string, Read2> = {'/v1/edge/here': 'here', '/v1/edge/observe': 'observe', '/v1/edge/capabilities': 'capabilities', '/v1/edge/view': 'view'};
const byRead: Record<Read2, {served: number; cpuMs: number; maxCpuMs: number}> = {here: {served: 0, cpuMs: 0, maxCpuMs: 0}, observe: {served: 0, cpuMs: 0, maxCpuMs: 0}, capabilities: {served: 0, cpuMs: 0, maxCpuMs: 0}, view: {served: 0, cpuMs: 0, maxCpuMs: 0}};
function body2(kind: Read2, soul: EdgeSoul, q: URLSearchParams): {body: object; world: boolean} | string {
  const L = RL!, M2 = read2.mods!;
  if (kind === 'here') {
    // ?view= (body, or a bad value main refuses with 400) is main's route (edge/routes.ts: hereBodyFrame)
    if (q.has('view')) return 'here-view';
    const modern = (q.get('include') ?? '').split(',').includes('doHere');
    return {body: {tick: RW!.mw.world.tick, here: M2.hereFrame(L, soul, {doHere: modern}), ...(modern ? {apiContract: 'eden-edge/1.1'} : {}), ...(read2.debug ? {_debug: read2.debug.fireFacts(L, soul)} : {})}, world: true};
  }
  if (kind === 'observe') return {body: L.observe(soul, new Set((q.get('include') ?? '').split(',').filter(Boolean))) as object, world: true};
  if (kind === 'capabilities') return {body: {tick: RW!.mw.world.tick, ...L.capabilitiesPage(soul, {all: q.get('all') === '1'})}, world: true};
  // view: the caption (?alt=only) only; a picture is drawn by main's one render worker and served from main's memory,
  // and a gaze is an attention write (intents.attend): both main's
  const v = M2.parseViewQuery(k => q.get(k) ?? undefined);
  if (!v.altOnly) return 'view-picture';
  if (v.gaze !== undefined) return 'view-gaze';
  return {body: {...M2.viewSummary(M2.planView(L, soul, v)), url: null, image: 'not requested (alt=only)'}, world: false};
}
/** A read computed here; null = main should answer (counted by reason). */
function read2(kind: Read2, soulId: string, query: string): {body: object; world: boolean; cpuMs: number} | null {
  if (!RW || !RL || !RH || !ready2) {fallback('not-ready'); return null;}
  if (relabel) {fallback('relabel'); return null;}
  if (lag[0] - gen > LAG_GENS) {fallback('lag'); return null;}
  const m = RH.minds.get(soulId); if (!m || !RW.R.entities.has(m.entityId)) {fallback('unknown-soul'); return null;}
  const soul: EdgeSoul = {soulId, entityId: m.entityId, name: m.name, owner: m.owner};
  const c = cpuMs();
  try {
    // the god layer's reads (split/read-bridge.ts), current to main's last god commit, at main's load level (its
    // perception dial: main's monitor sets it on main's bridge; the level is the shared one main publishes)
    R2!.readBridgeSync(RH, RL)?.setLoadLevel(level());
    const out = body2(kind, soul, new URLSearchParams(query));
    if (typeof out === 'string') {fallback(out); return null;}
    const ms = cpuMs() - c; c2.served++; c2.cpuMs += ms; c2.maxCpuMs = Math.max(c2.maxCpuMs, ms);
    const r = byRead[kind]; r.served++; r.cpuMs += ms; r.maxCpuMs = Math.max(r.maxCpuMs, ms);
    // the slowest reads (diagnosis): which Soul, its how-many-th read here, the tick
    const nth = (servedBy.get(soulId) ?? 0) + 1; servedBy.set(soulId, nth);
    if (c2.slow.length < 5 || ms > c2.slow[c2.slow.length - 1].ms) {c2.slow.push({ms: Math.round(ms), soul: soulId.slice(-6), nth, tick: RW.R.pos.tick, read: kind}); c2.slow.sort((a, b) => b.ms - a.ms); c2.slow.length = Math.min(5, c2.slow.length);}
    askMisses();
    return {...out, cpuMs: ms};
  } catch (e) {
    // MainOnly: a reach into main-only state; any other error (an EdgeError's 4xx included) is main's to answer as well
    fallback(e instanceof (R2!.MainOnly as typeof MOT) ? (e as Error).message.replace(/^read worker: | is main-only$/g, '') : `${kind}-error`);
    if (!(e instanceof (R2!.MainOnly as typeof MOT)) && !(e instanceof Error && 'status' in e && 'code' in e)) console.error('[read-worker]', kind, wd.index, e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 4).join(' | ') : e);
    return null;
  }
}
read2.mods = R2 ? await (async () => {
  const [{hereFrame}, {planView}, {parseViewQuery, viewSummary}] = await Promise.all([import('../edge/perception/here.ts'), import('../edge/eyes/view.ts'), import('../edge/eyes/routes.ts')]);
  return {hereFrame, planView, parseViewQuery, viewSummary};
})() : null;
read2.debug = null as null | typeof import('./read-debug.ts');
if (R2 && process.env.SIM_READ_DEBUG === '1') read2.debug = await import('./read-debug.ts');

parentPort!.on('message', (m: ToWorker) => {
  if (m.t === 'init') {
    const c = cpuMs(); myGen(m.gen); if (R2) init2(m.w); else M.init(m.w); cost.initCpuMs = cpuMs() - c;
    if (!R2) parentPort!.postMessage({t: 'ready', index: wd.index, gen: m.gen, tick: tickNow(), stats: M.stats(), initCpuMs: cost.initCpuMs});
  }
  else if (m.t === 'delta') {const c = cpuMs(); if (R2 ? !RW || !apply2(m.d) : !M.apply(m.d)) {parentPort!.postMessage({t: 'resync', index: wd.index}); return;} const ms = cpuMs() - c; cost.deltas++; cost.ingestCpuMs += ms; cost.maxIngestCpuMs = Math.max(cost.maxIngestCpuMs, ms); myGen(m.gen);}
  else if (m.t === 'query') parentPort!.postMessage({t: 'answer', id: m.id, v: answer(m.kind, m.soulId)});
  else if (m.t === 'forget') tokens.clear();
});

// ---- the main thread, over the intents port: token lookups and forwarded jobs
const port = wd.intents;
let seq = 0;
const waiting = new Map<number, (m: PortDone | AuthAnswer) => void>();
/** mode 2: main's inbox block for this Soul (touch + view, as main's middleware does), within INBOX_MS; else the
 *  worker's own view of the database (lastSeenAt = now; an open listen main holds in memory reads as its last open). */
const INBOX_MS = 250;
let ownInbox: {view(s: object): Record<string, unknown>} | null = null;
async function inboxOf(soulId: string, owner: string): Promise<unknown> {
  const id = ++seq;
  const main = new Promise<unknown>(res => waiting.set(id, m => res((m as unknown as {inbox: unknown}).inbox)));
  port.postMessage({t: 'inbox', id, soulId});
  const t = new Promise<undefined>(res => setTimeout(() => res(undefined), INBOX_MS).unref());
  const got = await Promise.race([main, t]);
  if (got !== undefined) return got;   // null: main has no inbox (no block, as main's own answer)
  waiting.delete(id); fallback('inbox-timeout');
  if (!ownInbox && RH) {const {AgentInbox} = await import('../inbox.ts'); ownInbox = new AgentInbox(RH.db, RH.worldId) as never;}
  try {return ownInbox ? {...ownInbox.view({scope: `soul:${soulId}`, owner}), lastSeenAt: Date.now()} : null;} catch {return null;}
}
port.on('message', (m: PortDone | AuthAnswer) => {const f = waiting.get(m.id); if (f) {waiting.delete(m.id); f(m);}});
const tokens = new Map<string, {soulId: string | null; account?: string | null; at: number}>(), checking = new Map<string, Promise<{soulId: string | null; account?: string | null}>>();
/** Ask main who a token is (one question per token at a time); a token main no longer knows is forgotten. */
function check(token: string) {
  let p = checking.get(token);
  if (!p) {
    p = new Promise(res => {
      const id = ++seq; waiting.set(id, (m) => {
        const a = m as AuthAnswer; checking.delete(token);
        if (a.soulId) {tokens.set(token, {soulId: a.soulId, account: a.account, at: Date.now()}); if (tokens.size > 50_000) tokens.clear();} else tokens.delete(token);
        res(a);
      });
      port.postMessage({t: 'auth', id, token});
    });
    checking.set(token, p);
  }
  return p;
}
/** Fresh for AUTH_MS; then still used for up to AUTH_STALE_MS while main is asked again in the background (so a busy
 *  main does not stall a Soul's reads), after which the Soul waits for main's answer. */
function soulOf(token: string): Promise<{soulId: string | null; account?: string | null}> {
  const hit = tokens.get(token), age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < AUTH_MS) return Promise.resolve(hit);
  if (hit && age < AUTH_STALE_MS) {void check(token); return Promise.resolve(hit);}
  return check(token);
}

const level = (): Level => (load ? LEVELS[load[S.level]] : undefined) ?? 'green';
const bearer = (req: IncomingMessage) => req.headers.authorization?.replace(/^Bearer\s+/i, '');
/** #371 H-b: the worker's own wall time for each request (a forwarded answer: including main's), as x-handler-ms. */
const started = new WeakMap<ServerResponse, number>();
const handlerMs = (res: ServerResponse) => {const t0 = started.get(res); return t0 === undefined ? {} : {'x-handler-ms': (performance.now() - t0).toFixed(1)};};
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-sim-load': level(), 'x-sim-read': 'worker', ...headers, ...handlerMs(res)}).end(JSON.stringify(body));
}
function health(res: ServerResponse) {
  const mainGen = lag[0];
  const tick = tickNow();
  send(res, tick >= 0 ? 200 : 503, {ok: tick >= 0, worker: wd.index, gen, lagGens: Math.max(0, mainGen - gen), tick, subset: wd.mode === 1, mode: wd.mode, served: cost.served, forwarded: cost.forwarded,
    ...(R2 ? {read: {ready: ready2, relabeling: !!relabel, db: dbFacts(), ...c2, byRead: Object.fromEntries(Object.entries(byRead).map(([k, v]) => [k, {...v, cpuMs: Math.round(v.cpuMs * 10) / 10, maxCpuMs: Math.round(v.maxCpuMs)}])), cpuMs: Math.round(c2.cpuMs), threadCpuMs: Math.round(cpuMs()), bg: {...bg, cpuMs: Math.round(bg.cpuMs)}, ingest: {deltas: cost.deltas, cpuMs: Math.round(cost.ingestCpuMs), maxCpuMs: Math.round(cost.maxIngestCpuMs)}, verdicts: RW ? {hits: RW.verdicts.hits, misses: RW.verdicts.missCount} : null, replica: RW?.cost ?? null, god: RL ? R2.readBridgeCost(RL) : null}} : {})});
}
/** The worker's read-only view of the database: in a read transaction (a pinned WAL snapshot: it would read old rows
 *  forever) and the newest receipt row it sees (diagnosis: compare with main's). */
function dbFacts() {
  const d = RH?.db.db as unknown as {isTransaction?: boolean; prepare(q: string): {get(): unknown}} | undefined; if (!d) return null;
  try {return {inTx: d.isTransaction ?? null, receiptsMaxRowid: (d.prepare('SELECT max(rowid) AS n FROM edge_receipts_v1').get() as {n: number | null}).n};} catch (e) {return {error: String(e).slice(0, 120)};}
}
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade', 'expect']);
/** Ask the main thread (through Admission) and relay its answer. */
async function forward(req: IncomingMessage, res: ServerResponse, url: string, path: string, token: string | undefined) {
  const chunks: Buffer[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const route = token ? classify(req.method ?? 'GET', path) : null, id = ++seq, hint = Number(req.headers['x-sim-timeout-ms']);
  const headers = Object.entries(req.headers).flatMap(([k, v]) => v === undefined || HOP.has(k) ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]]);
  const payload: Forward = {method: req.method ?? 'GET', url, headers, ...(body ? {body: body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer} : {})};
  cost.forwarded++;
  const done = new Promise<PortDone>(r => waiting.set(id, m => r(m as PortDone)));
  const gone = () => {if (waiting.has(id)) port.postMessage({t: 'closed', id});};
  res.once('close', gone);
  port.postMessage({t: 'job', id, key: route?.god ? 'god' : 'soul:' + token, god: route?.god ?? false, route: route && (route.cls === 'C1' || route.cls === 'C2') ? route : null, hintMs: Number.isFinite(hint) ? hint : undefined, payload}, payload.body ? [payload.body] : []);
  const d = await done; res.off('close', gone);
  if (res.destroyed) return;
  if (d.dropped) {res.destroy(); return;}
  if (d.refusal) {const x: Refusal = d.refusal; send(res, x.status, {contract: CONTRACT, error: {code: x.code, message: x.message}, world: worldBlock(level(), x.retryAfterS)}, {'retry-after': String(x.retryAfterS)}); return;}
  if (d.error || !d.result) {send(res, 502, {ok: false, code: 'world.unavailable', message: 'the read worker could not reach the world'}); return;}
  const r = d.result as Forwarded, h: Record<string, string> = {};
  for (const [k, v] of r.headers) if (k !== 'content-length' && k !== 'transfer-encoding' && k !== 'connection') h[k] = v;
  res.writeHead(r.status, {...h, ...handlerMs(res)}).end(Buffer.from(r.body));
}

/** The replica has this Soul and its body (else main answers: a Soul born since the last delta, a body asleep). The
 *  minds map is private to read-model.ts (lane B-delta's file); read through a cast until its API grows one. */
const knows = (soulId: string) => {const m = M.R.minds.get(soulId); return !!m && M.R.entities.has(m.entityId);};
const SUBSET = new Set(['/v1/edge/here', '/v1/edge/capabilities']);
async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = stripWorldRequestPath(req.url, wd.worldPath) ?? '/', q = url.indexOf('?'), path = q < 0 ? url : url.slice(0, q);
  if (req.method === 'GET' && (path === '/healthz' || path === '/healthz/read')) return health(res);
  const token = bearer(req);
  const kind = R2 && req.method === 'GET' ? READ2[path] : undefined;
  if (kind && token?.startsWith('sim_')) {
    const who = await soulOf(token);
    if (who.soulId) {
      const r = read2(kind, who.soulId, q < 0 ? '' : url.slice(q + 1));
      if (r) {
        const lv = level(), acct: Record<string, string> = who.account ? {'x-sim-account': who.account} : {};
        const inbox = await inboxOf(who.soulId, RH!.minds.get(who.soulId)?.owner ?? '');
        cost.served++;
        // as main's wrap: the load block at amber and above unless the frame has its own `world` (observe does); main
        // adds it at the level its admission admitted the read at, so a world without admission (SIM_ADMISSION=0) never
        const world = r.world && ADMISSION && lv !== 'green' && !('world' in r.body) ? {world: worldBlock(lv)} : {};
        return send(res, 200, {contract: CONTRACT, ...r.body, ...world, ...(inbox ? {inbox} : {})}, {...acct, 'x-sim-read-cpu-ms': r.cpuMs.toFixed(3), 'x-sim-read-kind': kind});
      }
    }
    return forward(req, res, url, path, token);
  }
  if (wd.mode === 1 && req.method === 'GET' && q < 0 && SUBSET.has(path) && token?.startsWith('sim_') && M.tick >= 0) {
    const who = await soulOf(token);
    if (who.soulId && knows(who.soulId)) {
      const lv = level(), world = lv !== 'green' ? {world: worldBlock(lv)} : {}, acct: Record<string, string> = who.account ? {'x-sim-account': who.account} : {};
      cost.served++;
      if (path === '/v1/edge/here') {const h = answer('here', who.soulId) as ReturnType<ReadModel['here']>; return send(res, 200, {contract: CONTRACT, tick: h.tick, here: {me: h.me, near: h.near, things: h.things}, subset: true, ...world}, acct);}
      const c = answer('caps', who.soulId) as {tick: number; ids: string[]};
      return send(res, 200, {contract: CONTRACT, tick: c.tick, capabilities: c.ids.map(id => ({id})), subset: true, ...world}, acct);
    }
  }
  return forward(req, res, url, path, token);
}
const server = createServer((req, res) => {started.set(res, performance.now()); handle(req, res).catch(e => {console.error('[read-worker]', wd.index, e); send(res, 500, {ok: false, code: 'read.failed'});});});
server.keepAliveTimeout = 5000;
server.listen(wd.port, '127.0.0.1', () => parentPort!.postMessage({t: 'listening', index: wd.index, port: (server.address() as {port: number}).port}))
  .on('error', e => parentPort!.postMessage({t: 'error', index: wd.index, error: `read port ${wd.port}: ${e.message}`}));
