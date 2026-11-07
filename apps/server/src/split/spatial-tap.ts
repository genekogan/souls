// Stage B (lane B-spatial): the spatial query tap and its oracle. HARNESS, loaded only as a preload with SIM_SPATIAL_TAP=1:
//   SIM_SPATIAL_TAP=1 node --import ./apps/server/src/split/spatial-tap.ts apps/server/src/main.ts
// Without the flag the import does nothing. With it, every spatial read the engine answers (the read path's, and the
// step's own) is recorded with its arguments, its answer, the static scene it was answered on (a new export whenever the
// navigation epoch or the entity-physics hash moved) and the dynamic inputs it read (human bodies for the people-avoiding
// reads, the fixture row for seat levels). Batches go to a worker thread holding a SpatialReplica built from those exports
// only (no engine object), which replays each query and compares the answer field by field. A loopback control server
// (SIM_SPATIAL_TAP_PORT, default 5222) drives walkers and reads and reports the oracle.
import { Worker, isMainThread } from 'node:worker_threads';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hereFrame, Perception } from '../edge/perception/here.ts';
import { GodMode } from '../god/god.ts';
import { coreRef } from '@souls/world-compiler';
import type { StaticExportV1 } from '../../../../mars/viewer/engine/spatial/service.ts';
import type { ReplicaBody, FixtureRow } from './spatial-replica.ts';

/** The engine's spatial reads the tap records (the replica answers each with the same signature). */
export const TAPPED = ['staticEpochV1', 'navEpochV1', 'levelsV1', 'clearanceAtV1', 'clearanceUpToV1', 'lyingRoomAtV1', 'standYAtV1', 'dryGroundAtV1',
  'nearestStandableV1', 'standableNearV1', 'clearSpotsV1', 'navWarmV1', 'navCheckV1', 'navNearestMainV1', 'nativeSeatLevelsV1'] as const;
/** Reads whose answer depends on where the other human bodies are. */
export const PEOPLE = new Set<string>(['nearestStandableV1', 'standableNearV1', 'navNearestMainV1']);
/** One recorded query: method, args, answer, scene key, in-tick flag, and its dynamic inputs. */
export type TapRecord = { m: string; a: unknown[]; v: unknown; k: string; t: boolean; tick: number; pg: string; rd?: boolean; bodies?: ReplicaBody[]; fixture?: FixtureRow | null };

const ON = process.env.SIM_SPATIAL_TAP === '1';
if (ON && isMainThread) install();

function install() {
  const PORT = Number(process.env.SIM_SPATIAL_TAP_PORT ?? 5222), OUT = process.env.SIM_SPATIAL_TAP_OUT;
  const log = (m: string) => console.log(`[spatial-tap] ${m}`);
  let host: WorldHost | undefined, L: EdgeLedger | undefined, tapped: object | undefined, inTick = false, sceneKey = '', recording = true;
  let batch: TapRecord[] = [];
  const counts = new Map<string, number>(), exportsInfo: { key: string; epoch: number; navEpoch: number; ms: number; bytes: number; obstacles: number; surfaces: number; links: number }[] = [];
  const worker = new Worker(new URL('./spatial-oracle.ts', import.meta.url), { execArgv: [] });
  const pending = new Map<number, (v: unknown) => void>(); let qid = 0;
  worker.on('message', (m: { id: number; v: unknown }) => pending.get(m.id)?.(m.v));
  worker.on('error', (e) => log(`worker error ${e.stack}`));
  const ask = (t: string, extra: Record<string, unknown> = {}) => new Promise<unknown>((r) => { const id = ++qid; pending.set(id, r); worker.postMessage({ t, id, ...extra }); });

  type Eng = Record<string, (...a: unknown[]) => unknown> & { world: { tick: number; entities: Record<string, { kind: string; def: string; pose: { p: number[] }; human?: { level?: number }; level?: number; support?: { kind?: string } }> }; exportStaticScene(): StaticExportV1 };
  const humans = (e: Eng): ReplicaBody[] => {
    const out: ReplicaBody[] = [], ents = e.world.entities;
    for (const id in ents) { const o = ents[id]; if (o.kind === 'human') out.push({ id, x: o.pose.p[0], y: o.pose.p[1], z: o.pose.p[2], level: o.human?.level ?? 0, human: true }); }
    return out;
  };
  const fixtureRow = (e: Eng, id: string): FixtureRow | null => { const o = e.world.entities[id]; return o ? { id, def: o.def, kind: o.kind, ...(o.support?.kind ? { support: o.support.kind } : {}), ...(typeof o.level === 'number' ? { level: o.level } : {}), y: o.pose.p[1] } : null; };
  // the scene key the answer was given on: the service's navigation epoch (read without a sync) + the entity-physics hash
  const keyOf = (e: Eng) => { const sp = (e as unknown as { rt: { services: { spatial: { epoch: number } }; world: { entityPhysicsV1?: { hash?: string } } } }).rt; return `${sp.services.spatial.epoch}|${sp.world.entityPhysicsV1?.hash ?? ''}`; };
  let exporting = false;
  const ensureExport = (e: Eng) => {
    const k = keyOf(e); if (k === sceneKey || exporting) return;
    exporting = true;
    try {
      const t0 = performance.now(), s = e.exportStaticScene(), ms = performance.now() - t0, k2 = keyOf(e), bytes = serialize(s).length;
      sceneKey = k2; flush();
      exportsInfo.push({ key: k2, epoch: s.epoch, navEpoch: s.navEpoch, ms: +ms.toFixed(1), bytes, obstacles: s.obstacles.length, surfaces: s.surfaces.length, links: s.links.length });
      log(`export ${k2} epoch ${s.epoch} in ${ms.toFixed(1)} ms, ${(bytes / 1e6).toFixed(2)} MB`);
      worker.postMessage({ t: 'scene', key: k2, scene: s });
    } finally { exporting = false; }
  };
  const flush = () => { if (!batch.length) return; worker.postMessage({ t: 'batch', recs: batch }); batch = []; };
  const wrap = (e: Eng) => {
    if (tapped === e) return; tapped = e;
    for (const m of TAPPED) {
      const f = e[m]; if (typeof f !== 'function') { log(`engine has no ${m}`); continue; }
      e[m] = function (this: unknown, ...a: unknown[]) {
        if (!recording || exporting) return f.apply(e, a);
        const v = f.apply(e, a);
        ensureExport(e);
        counts.set(m, (counts.get(m) ?? 0) + 1);
        const sp = (e as unknown as { rt: { services: { spatial: { pageRectsV1(): number[][] | null } } }; conn?: { ready: boolean } });
        const rects = sp.rt.services.spatial.pageRectsV1(), rd = sp.conn?.ready;
        const rec: TapRecord = { m, a: structuredClone(a), v: structuredClone(v), k: sceneKey, t: inTick, tick: e.world.tick, pg: rects ? rects.map((r) => r.join(',')).join(';') : '', ...(rd !== undefined ? { rd } : {}) };
        if (PEOPLE.has(m)) rec.bodies = humans(e);
        if (m === 'nativeSeatLevelsV1') rec.fixture = fixtureRow(e, String(a[0]));
        batch.push(rec); if (batch.length >= 2000) flush();
        return v;
      };
    }
    ensureExport(e);
  };

  const boot = WorldHost.prototype.boot;
  WorldHost.prototype.boot = function (this: WorldHost, ...a: unknown[]) {
    const out = (boot as (...x: unknown[]) => unknown).apply(this, a); host = this;
    wrap(this.engine as unknown as Eng);
    const tickOnce = this.tickOnce.bind(this);
    this.tickOnce = () => { if (host!.engine !== tapped) wrap(host!.engine as unknown as Eng); inTick = true; try { tickOnce(); } finally { inTick = false; } };
    return out as ReturnType<WorldHost['boot']>;
  };
  // the world's god (entity worlds): edits go through god.act, the bridge and the world-edit fold, as a god's commit does
  let god: GodMode | undefined, edits = 0;
  const onCommit = GodMode.prototype.onCommit;
  GodMode.prototype.onCommit = function (this: GodMode, fn) { god = this; return onCommit.call(this, fn); };
  function edit(): unknown {
    if (!god) return { error: 'no god' };
    const mine = [...(god.model.entities.values() as Iterable<{ id: string; name?: string }>)].filter((e) => e.name?.startsWith('spatial-tap-bench'));
    if (mine.length && edits % 2 === 1) { edits++; return god.act({ ops: [{ op: 'remove', id: mine[0].id }] }, 'spatial-tap'); }
    const s = souls().find((x) => host!.engine.world.entities[x.entityId]), b = s && host!.engine.world.entities[s.entityId];
    if (!b) return { error: 'no body' };
    edits++;
    const r = god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: `spatial-tap-bench-${edits}`, p: [b.pose.p[0] + 3, b.pose.p[2] + 1] }] }, 'spatial-tap') as { accepted?: boolean; failures?: unknown };
    return { accepted: r.accepted, failures: r.failures, near: s!.name };
  }
  const attach = EdgeLedger.prototype.attachComms;
  EdgeLedger.prototype.attachComms = function (this: EdgeLedger, c) { attach.call(this, c); L = this; };
  setInterval(flush, 200).unref();

  // ---- drive: walkers act every 10 s; every Soul with a body reads here / things / capabilities every 3 s ----
  type Soul = { soulId: string; entityId: string; name: string };
  const souls = (): Soul[] => [...host!.minds.values()].map((m) => ({ soulId: m.soulId, entityId: m.entityId, name: m.name, owner: (m as { owner?: string }).owner ?? '' }));
  let walkers: string[] = [], reading = false, k = 0;
  const reads = { n: 0, ms: 0, errors: 0 };
  async function walk() {
    for (const s of souls().filter((x) => walkers.includes(x.soulId))) {
      if (L!.openReceipts(s.soulId).length) continue;
      const caps = L!.capabilities(s as never).filter((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place');
      if (!caps.length) continue;
      try { await L!.act(s as never, { capability: caps[(k++ * 7) % caps.length].id } as never); } catch (e) { log(`walk ${s.name}: ${(e as Error).message}`); }
    }
  }
  function readAll() {
    for (const s of souls()) {
      if (!host!.engine.world.entities[s.entityId] || L!.faded.has(s.soulId)) continue;
      const t0 = performance.now();
      try { hereFrame(L!, s as never); new Perception(L!, s as never).things(); L!.capabilities(s as never); reads.n++; } catch (e) { reads.errors++; log(`read ${s.name}: ${(e as Error).message}`); }
      reads.ms += performance.now() - t0;
    }
  }
  setInterval(() => { if (walkers.length) void walk(); }, 10000).unref();
  setInterval(() => { if (reading && host && L) readAll(); }, 3000).unref();

  createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); res.setHeader('content-type', 'application/json');
    try {
      if (!host || !L) { res.end(JSON.stringify({ ready: false })); return; }
      let v: unknown;
      if (u.pathname === '/start') {
        const n = Number(u.searchParams.get('n') ?? 6);
        walkers = souls().filter((s) => host!.engine.world.entities[s.entityId] && !L!.faded.has(s.soulId)).slice(0, n).map((s) => s.soulId);
        reading = true; await walk(); v = { walkers, souls: souls().length };
      } else if (u.pathname === '/stop') { walkers = []; reading = false; v = { ok: true }; }
      else if (u.pathname === '/status') { flush(); v = { tick: host.engine.world.tick, walkers: walkers.length, reads, counts: Object.fromEntries(counts), exports: exportsInfo, oracle: await ask('status') }; }
      else if (u.pathname === '/save') { flush(); v = await ask('status'); if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), tick: host.engine.world.tick, reads, counts: Object.fromEntries(counts), exports: exportsInfo, oracle: v }, null, 1)); }
      else if (u.pathname === '/edit') v = edit();
      else if (u.pathname === '/pause') { recording = u.searchParams.get('on') !== '1'; v = { recording }; }
      else { res.statusCode = 404; v = { error: 'unknown' }; }
      res.end(JSON.stringify(v));
    } catch (e) { res.statusCode = 500; log(`control: ${(e as Error).stack}`); res.end(JSON.stringify({ error: (e as Error).message })); }   // the stack goes to the log, not the socket
  }).listen(PORT, '127.0.0.1', () => log(`control on ${PORT}`));
}
