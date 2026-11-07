// Stage B (lane B-delta, from the L9 spike): the per-tick WorldDelta v1, built on the tick thread right after a tick
// (world.ts `splitTap`, fed the tick's own paths/changes: the same arrays the viewer Batch accumulates) and kept in a ring
// so a consumer (the read worker) that fell behind resumes from its seq, or is told to re-snapshot. Contract:
// docs/architecture/load.md §6. Types and the consumer side: split/read-model.ts. WorldInit: split/world-init.ts.
// Read-only over the engine and the ledger: it never writes world state, so the engine stays bit-for-bit the same.
// Nothing here scans the world per tick: bodies are the tracked set (Soul/native humans, carriers, and entities the tick
// reported), comms objects come from L8's table.changes(since), receipts from the ledger's receipt listener.
import {VerdictPump} from './verdict-pump.ts';
import {menuWorldOf, type LiveMenuWorld} from './menu-world.ts';
import {threadCpuUsage} from 'node:process';
import type {ChangeEvent, PathCommit, ProgramEvent} from '@souls/engine-contract';
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeReceipt} from '../edge/contract.ts';
import type {ObjectTable} from '../edge/comms/objects/table.ts';
import {isCampfire} from '../edge/ledger/fire.ts';
import {centroid} from '../edge/ledger/places.ts';
import type {BodyRow, Ent, HoldRow, ItemRow, MindRow, ObjectDeltaRow, ProgramRow, ReceiptRow, Resnapshot, StaticLayer, StreamPos, WorldDelta} from './read-model.ts';

type V2 = [number, number];
type Eng = {
  world: {tick: number; entities: Record<string, Ent>; regions: Record<string, {polygon: V2[]}>; env: Record<string, unknown>; navV1?: {solids?: unknown[]}};
  programOf(actor: string): string | null;
  programAction?(id: string): {step: number; action: {id: string; verb: string; status: string; phase?: string}} | null;
  nativeSeatHoldsV1?(actor: string): {action: string; slot: string}[];
  carriers?(): {id: string}[];
  staticEpochV1?(): number;
};
export type TickOut = {paths: readonly PathCommit[]; changes: readonly ChangeEvent[]; programs?: readonly ProgramEvent[]};
export type StreamMessage = WorldDelta | Resnapshot;
const cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
/** deltas kept for a consumer that fell behind (60 s at 20 ticks/s); further behind = re-snapshot */
export const DELTA_RING = 1200;
/** DELTA_PROFILE=1: wall ms per section of the tap, summed (harness only) */
export const PROFILE = process.env.DELTA_PROFILE === '1', PROF: Record<string, number> = {};
const SPATIALS = new WeakMap<object, number>(), SPOTS = new WeakMap<object, number>(); let spotsN = 0, spatialsN = 0;

export const receiptRow = (r: EdgeReceipt): ReceiptRow => ({id: r.id, soulId: r.soulId, capability: r.capability, phase: r.phase, acceptedTick: r.acceptedTick, startedTick: r.startedTick ?? null, endedTick: r.endedTick ?? null, code: r.code ?? null, programId: r.programId ?? null});
export const mindRow = (m: {soulId: string; entityId: string; name: string; owner: string; native: boolean}): MindRow => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner, native: !!m.native});
const mindKey = (m: MindRow) => `${m.entityId}|${m.name}|${m.owner}|${m.native ? 1 : 0}`;
/** an entity without its pose and its human.speed, as a comparable string (key order is the engine's own) */
export const restKey = (e: Ent) => {const {pose: _p, ...rest} = e; if (rest.human && 'speed' in rest.human) {const {speed: _s, ...h} = rest.human; rest.human = h;} return JSON.stringify(rest);};
/** a walking body's speed ramps every tick without an event: it rides in the pose row */
const speedOf = (e: Ent): number | undefined => {const v = e.human?.speed; return typeof v === 'number' ? v : undefined;};
const copy = <T>(v: T): T => v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;

export class DeltaTap {
  readonly host: WorldHost; readonly L: EdgeLedger;
  gen = 0; seq = 0;
  private eng!: Eng; private table: ObjectTable | null = null;
  // the baseline the next delta is a difference from (the producer's memory; a WorldInit is a fresh read)
  private tracked = new Set<string>(); private poses = new Map<string, [number, number, number, number, number | undefined]>(); private rests = new Map<string, string>();
  private mindKeys = new Map<string, string>(); private fadedSeen = new Set<string>();
  private programKeys = new Map<string, string>(); private holdKeys = new Map<string, string>();
  private objectGen = 0; private togetherVersion = -1; private itemsKey = '';
  private envKey = ''; private livingKey = ''; private pagesKey = ''; private navReady = false; private sceneKey = '';
  private epoch = ''; private cheapKey = ''; private warm = false; private staticCache: StaticLayer | null = null; private menuKey = '';
  private receiptBuf: ReceiptRow[] = [];
  /** receipts seen since boot (part of the WorldInit cache key) */
  receiptCount = 0;
  private ring: WorldDelta[] = [];
  private subs = new Set<(m: StreamMessage) => void>();
  private faultLogged = false;
  /** tick-thread cost: CPU ms of building each delta (and its JSON bytes when `measureBytes`) */
  readonly cost = {ticks: 0, cpuMs: 0, maxCpuMs: 0, bytes: 0, maxBytes: 0, resnapshots: 0, staticSends: 0, sceneSends: 0, epochReads: 0, itemReads: 0, objectDeltas: 0, receipts: 0, ents: 0, bodyRows: 0, unsettled: 0};
  readonly samples: [number, number][] = [];
  measureBytes = false;
  /** B-facade (split/verdict-pump.ts): the `menu` section of every delta / WorldInit (action rows, verdicts, menu statics). */
  extend: {delta(staticMoved: boolean): unknown; init(): unknown} | null = null;

  constructor(host: WorldHost, L: EdgeLedger) {
    this.host = host; this.L = L;
    L.onReceipt(r => {this.receiptBuf.push(receiptRow(r)); this.receiptCount++;});
    this.restart('boot');
  }
  get pos(): StreamPos {return {v: 1, gen: this.gen, seq: this.seq, tick: this.eng.world.tick, logSeq: this.host.seq};}
  private engine(): Eng {return this.host.engine as unknown as Eng;}
  objectTable(): ObjectTable | null {return (this.L.comms?.objects as {objectTable?(): ObjectTable} | undefined)?.objectTable?.() ?? null;}
  subscribe(f: (m: StreamMessage) => void): () => void {this.subs.add(f); return () => this.subs.delete(f);}
  /** The deltas after `seq` in `gen`, oldest first, or null: load a new WorldInit (another gen, or older than the ring). */
  since(gen: number, seq: number): WorldDelta[] | null {
    if (gen !== this.gen || seq > this.seq) return null;
    if (seq === this.seq) return [];
    const first = this.ring.length ? this.ring[0].seq : this.seq + 1;
    return seq + 1 < first ? null : this.ring.slice(seq + 1 - first);
  }

  /** Start a new gen from what main holds now: consumers must load a new WorldInit. */
  restart(reason: string) {
    this.gen++; this.seq = 0; this.ring = []; this.receiptBuf = [];
    const eng = this.eng = this.engine(), w = eng.world;
    this.tracked.clear(); this.poses.clear(); this.rests.clear();
    for (const e of Object.values(w.entities)) if (e.kind === 'human' || (e as {carrier?: unknown}).carrier) this.track(e);
    this.mindKeys.clear(); for (const m of this.host.minds.values()) this.mindKeys.set(m.soulId, mindKey(mindRow(m)));
    this.fadedSeen = new Set(this.L.faded);
    this.programKeys.clear(); this.holdKeys.clear(); for (const m of this.host.minds.values()) {this.programRow(m.entityId, true); this.holdRow(m.entityId, true);}
    this.table = this.objectTable(); this.objectGen = this.table?.generation ?? 0;
    this.togetherVersion = this.L.together.version; this.itemsKey = JSON.stringify(this.itemsNow());
    this.pagesKey = JSON.stringify(this.pagesNow()); this.navReady = this.navReadyNow(); this.sceneKey = this.sceneKeyNow();
    this.envKey = JSON.stringify(w.env); this.livingKey = JSON.stringify(this.livingNow());
    this.epoch = this.epochNow(); this.cheapKey = this.staticCheapKey(); this.warm = this.epoch.endsWith('w'); this.staticCache = null; this.menuKey = JSON.stringify(this.menuInputsNow());
    if (reason !== 'boot') {this.cost.resnapshots++; const m: Resnapshot = {t: 'resnapshot', gen: this.gen, reason}; for (const f of this.subs) try {f(m);} catch { /* a consumer fault never breaks the tick */ }}
  }
  private track(e: Ent) {this.tracked.add(e.id); this.poses.set(e.id, [e.pose.p[0], e.pose.p[1], e.pose.p[2], e.pose.yaw, speedOf(e)]); this.rests.set(e.id, restKey(e));}

  // ---- fresh reads (also used by WorldInit)
  programNow(entityId: string): ProgramRow {
    const eng = this.engine(), p = eng.programOf(entityId), a = p ? eng.programAction?.(p) : null;
    // not the action's status/phase: they move inside a step without a programme event (B-facade reads them on main)
    return [entityId, p, a?.step ?? 0, a?.action.id ?? '', a?.action.verb ?? ''];
  }
  holdsNow(entityId: string): {action: string; slot: string}[] {return (this.engine().nativeSeatHoldsV1?.(entityId) ?? []).map(x => ({action: x.action, slot: x.slot}));}
  private programRow(entityId: string, baseline = false): ProgramRow | null {
    const row = this.programNow(entityId), k = row.join('|');
    if (this.programKeys.get(entityId) === k) return null; this.programKeys.set(entityId, k);
    return baseline ? null : row;
  }
  private holdRow(entityId: string, baseline = false): HoldRow | null {
    const h = this.holdsNow(entityId), k = h.map(x => `${x.action}>${x.slot}`).join(',');
    if (this.holdKeys.has(entityId) && this.holdKeys.get(entityId) === k) return null;
    const first = !this.holdKeys.has(entityId); this.holdKeys.set(entityId, k);
    return baseline || (first && !h.length) ? null : [entityId, h];
  }
  livingNow(): {origin: number; dayTicks: number} | null {const l = this.host.living; return l ? {origin: l.origin, dayTicks: l.dayTicks} : null;}
  itemsNow(): ItemRow[] {return this.L.together.publicItems().filter(i => i.state === 'placed' && Array.isArray(i.at)).map(i => ({id: i.id, name: i.name, at: [...(i.at as V2)] as V2}));}
  menuInputsNow(): string[] {
    const fns = (this.L as unknown as {menuInputFns?: (() => string)[]}).menuInputFns ?? [];
    return fns.map(f => {try {return f();} catch {return '?';}});
  }
  /** engine static epoch | ledger static version: the static layer depends on nothing else. Costs two spatial syncs
   *  (~0.5 ms each on Eden 2026 outside the engine's own pass), so the tick reads it only when staticCheapKey moved. */
  epochNow(): string {return `${this.engine().staticEpochV1?.() ?? 0}|${this.L.staticVersion()}`;}
  /** B-spatial seam: the spatial service and the engine's connectivity, read without a sync (the step left them current) */
  private spatial() {return (this.engine() as unknown as {rt?: {services?: {spatial?: {epoch?: number; pageRectsV1?(): unknown}}}}).rt?.services?.spatial;}
  /** the static scene's rebuild key (B-spatial): spatial epoch | entity physics hash */
  sceneKeyNow(): string {return `${this.spatial()?.epoch ?? '-'}|${(this.engine().world as {entityPhysicsV1?: {hash?: string}}).entityPhysicsV1?.hash ?? ''}`;}
  /** engine.exportStaticScene() (B-spatial; structured-clone data, not JSON: heights may be Infinity), or null on an engine without it */
  sceneNow(): unknown {return (this.engine() as unknown as {exportStaticScene?(): unknown}).exportStaticScene?.() ?? null;}
  pagesNow(): unknown {return this.spatial()?.pageRectsV1?.() ?? null;}
  navReadyNow(): boolean {return !!(this.engine() as unknown as {conn?: {ready?: boolean}}).conn?.ready;}
  /** What epochNow is made of, read without a spatial sync: the spatial service's own epoch as the engine's step left it
   *  (the step syncs inside its pass; an edit between ticks shows on the next tick, as the ledger's staticVersion sees it),
   *  the place index's writes, the spots object, the ledger's bumpStatic count. Until navigation is warm,
   *  the full epoch is read every 200 ticks as well (warmth is part of the ledger's static version and flips once). */
  staticCheapKey(): string {
    const sp = (this.engine() as unknown as {rt?: {services?: {spatial?: {epoch?: number}}}}).rt?.services?.spatial, L = this.L as unknown as {places: {version: number}; spots: unknown; staticSeq?: number};
    let id = 0; if (sp) {id = SPATIALS.get(sp) ?? 0; if (!id) SPATIALS.set(sp, id = ++spatialsN);}
    let spots = SPOTS.get(L.spots as object) ?? 0; if (!spots) SPOTS.set(L.spots as object, spots = ++spotsN);
    return `${id}:${sp?.epoch ?? '-'}|${L.places.version}|${spots}|${L.staticSeq ?? 0}`;
  }
  /** The static layer at the current epoch (built once per epoch; shared by every WorldInit and the delta that sends it). */
  staticLayer(): StaticLayer {
    const epoch = this.epochNow(); if (this.staticCache?.epoch === epoch) return this.staticCache;
    const w = this.engine().world, L = this.L;
    const solids = (((w.navV1?.solids ?? []) as {id: string; label?: string; obb?: {c: V2; half: V2; yaw: number}; c?: V2; half?: V2; yaw?: number; y1?: number; height?: number}[])
      .flatMap(x => {const o = x.obb ?? (x.c && x.half ? {c: x.c, half: x.half, yaw: x.yaw ?? 0} : null); return o ? [{id: x.id, ...(x.label ? {label: x.label} : {}), c: o.c, half: o.half, yaw: o.yaw, height: x.y1 ?? x.height}] : [];}));
    const shells: Record<string, V2[]> = {}; for (const p of L.enclosurePlaces()) if (p.enclosed) shells[p.id] = p.polygon as V2[];
    const fires = Object.values(w.entities).filter(e => isCampfire(e as never)).map(e => ({id: e.id, name: e.label ?? 'campfire', at: [e.pose.p[0], e.pose.p[2]] as V2}));
    const regions = Object.entries(w.regions ?? {}).filter(([id]) => L.places.byId.has(id)).map(([id, r]) => ({id, name: L.places.byId.get(id)!.name, c: centroid(r.polygon)}));
    const spots = L.spots.spots.map(s => ({id: s.id, label: s.label ?? s.activity, activity: s.activity, at: s.at as V2}));
    const pw = (L as {placeWalkable?: (id: string) => boolean}).placeWalkable, walkable = pw ? [...L.places.byId.keys()].filter(id => pw(id)) : undefined;
    return this.staticCache = copy({epoch, places: [...L.places.byId.values()], shells, solids, fires, regions, spots, ...(walkable ? {walkable} : {})});
  }

  /** world.ts splitTap: after a completed tick, with that tick's own paths/changes. Never throws into the tick. */
  onTick(_tick: number, out: TickOut) {
    try {this.step(out);}
    catch (error) {
      if (!this.faultLogged) {this.faultLogged = true; console.error(`[split] delta tap fault; re-snapshotting: ${(error as Error).stack}`);}
      try {this.restart('tap fault');} catch { /* the next tick tries again */ }
    }
  }
  private step(out: TickOut) {
    const c0 = cpuMs(), eng = this.engine();
    if (eng !== this.eng) {this.restart('engine replaced'); return;}
    const table = this.objectTable();
    if (table !== this.table) {this.restart('object table replaced'); return;}
    const w = eng.world, ents = w.entities, d: WorldDelta = {v: 1, gen: this.gen, seq: this.seq + 1, tick: w.tick, logSeq: this.host.seq};
    const P = PROFILE ? PROF : null; let pt = P ? performance.now() : 0; const mark = (k: string) => {if (P) {const t = performance.now(); P[k] = (P[k] ?? 0) + t - pt; pt = t;}};
    // objects first: a reload of the table voids its deltas, and the stream restarts before anything is emitted
    let objects: ObjectDeltaRow[] | null = null, objectGen = this.objectGen;
    if (table) {
      const ch = table.changes(this.objectGen);
      if (!ch) {this.restart('object table reloaded'); return;}
      if (!ch.settled) this.cost.unsettled++;
      else if (ch.deltas.length) {objects = ch.deltas as ObjectDeltaRow[]; objectGen = ch.gen;}
    }
    const changed = new Set<string>();
    for (const p of out.paths) changed.add(p.entity);
    for (const c of out.changes) if (c[1] !== '$env') changed.add(c[1]);
    mark('objects');
    // receipts (phase changes since the last delta, in order), programmes and seat holds of Soul bodies
    if (this.receiptBuf.length) {d.receipts = this.receiptBuf; this.receiptBuf = [];}
    // a body whose receipt or programme moved is re-read whole (its task/seat fields change without a pose change)
    for (const r of d.receipts ?? []) {const m = this.host.minds.get(r.soulId); if (m) changed.add(m.entityId);}
    for (const p of out.programs ?? []) changed.add(p.actor);
    // a Soul's programme row and seat holds are re-read only when the tick named its body (a programme event, a change,
    // a path, a receipt), or it has none on record yet
    const programs: ProgramRow[] = [], holds: HoldRow[] = [];
    for (const m of this.host.minds.values()) {
      const id = m.entityId; if (!changed.has(id) && this.programKeys.has(id) && this.holdKeys.has(id)) continue;
      const p = this.programRow(id); if (p) programs.push(p); const h = this.holdRow(id); if (h) holds.push(h);
    }
    if (programs.length) d.programs = programs; if (holds.length) d.holds = holds;
    mark('receipts+programs');
    // bodies: the tracked set, plus whatever the tick reported (births, god edits, a carried item)
    const bodies: BodyRow[] = [], full: Ent[] = [], gone: string[] = [];
    for (const id of changed) if (!this.tracked.has(id)) {
      const e = ents[id]; if (!e) {gone.push(id); continue;}
      this.track(e); full.push(copy(e));
    }
    for (const id of this.tracked) {
      const e = ents[id];
      if (!e) {gone.push(id); this.tracked.delete(id); this.poses.delete(id); this.rests.delete(id); continue;}
      const was = this.poses.get(id)!, p = e.pose.p, sp = speedOf(e), moved = was[0] !== p[0] || was[1] !== p[1] || was[2] !== p[2] || was[3] !== e.pose.yaw || was[4] !== sp;
      if (!moved && !changed.has(id)) continue;
      if (moved) {was[0] = p[0]; was[1] = p[1]; was[2] = p[2]; was[3] = e.pose.yaw; was[4] = sp;}
      // the rest of the entity is compared only when the tick named it (paths, changes, programme/hold/receipt): a body
      // that only moved sends its pose (stringifying every walking body each tick was most of the tap's cost)
      const rest = changed.has(id) ? restKey(e) : undefined;
      if (rest !== undefined && rest !== this.rests.get(id)) {this.rests.set(id, rest); if (!full.some(f => f.id === id)) full.push(copy(e));}
      else if (moved) bodies.push(sp === undefined ? [id, p[0], p[1], p[2], e.pose.yaw] : [id, p[0], p[1], p[2], e.pose.yaw, sp]);
    }
    if (bodies.length) d.bodies = bodies; if (full.length) d.ents = full; if (gone.length) d.gone = gone;
    mark('bodies');
    // env (the clock's datetime moves every tick) and the day clock, whole when changed
    const env = JSON.stringify(w.env); if (env !== this.envKey) {this.envKey = env; d.env = JSON.parse(env);}
    const lv = this.livingNow(), lk = JSON.stringify(lv); if (lk !== this.livingKey) {this.livingKey = lk; d.living = lv;}
    mark('env');
    // minds, faded
    const minds: MindRow[] = [];
    for (const m of this.host.minds.values()) {const r = mindRow(m), k = mindKey(r); if (this.mindKeys.get(m.soulId) !== k) {this.mindKeys.set(m.soulId, k); minds.push(r);}}
    if (minds.length) d.minds = minds;
    if (this.mindKeys.size > this.host.minds.size) {const g = [...this.mindKeys.keys()].filter(id => !this.host.minds.has(id)); for (const id of g) this.mindKeys.delete(id); d.mindsGone = g;}
    const faded = this.L.faded;
    if (faded.size !== this.fadedSeen.size || [...faded].some(id => !this.fadedSeen.has(id))) {this.fadedSeen = new Set(faded); d.faded = [...faded].sort();}
    mark('minds');
    // carriers are entities (their `carrier` state rides in `ents`): the replica derives them; no per-tick read of their state
    if (objects) {d.objects = {gen: objectGen, deltas: objects}; this.objectGen = objectGen;}
    // placed items (the together version moves with every together write), static epoch, menu inputs
    const tv = this.L.together.version;
    if (tv !== this.togetherVersion) {
      this.togetherVersion = tv; d.togetherVersion = tv; this.cost.itemReads++;
      const items = this.itemsNow(), k = JSON.stringify(items); if (k !== this.itemsKey) {this.itemsKey = k; d.items = items;}
    }
    const ready = this.navReadyNow(), flipped = ready !== this.navReady; if (flipped) {this.navReady = ready; d.navReady = ready;}
    const cheap = this.staticCheapKey();
    if (cheap !== this.cheapKey || flipped || (!this.warm && w.tick % 200 === 0)) {
      this.cheapKey = cheap; const epoch = this.epochNow(); this.cost.epochReads++; this.warm = this.epoch.endsWith('w') || epoch.endsWith('w');
      if (epoch !== this.epoch) {this.epoch = epoch; d.static = this.staticLayer(); this.cost.staticSends++;}
    }
    // B-spatial: paged windows, connectivity readiness, the static scene when its rebuild key moved
    const pages = this.pagesNow(), pk = JSON.stringify(pages); if (pk !== this.pagesKey) {this.pagesKey = pk; d.pages = JSON.parse(pk);}
    const sk = this.sceneKeyNow(); if (sk !== this.sceneKey) {this.sceneKey = sk; d.sceneKey = sk; d.scene = this.sceneNow(); this.cost.sceneSends++;}
    mark('items+static');
    const menu = this.menuInputsNow(), mk = JSON.stringify(menu); if (mk !== this.menuKey) {this.menuKey = mk; d.menuInputs = menu;}
    if (this.extend) {const m = this.extend.delta(!!d.static); if (m) (d as WorldDelta & {menu?: unknown}).menu = m;}
    this.seq = d.seq;
    this.ring.push(d); if (this.ring.length > 2 * DELTA_RING) this.ring = this.ring.slice(-DELTA_RING);
    mark('spatial+menu');
    const ms = cpuMs() - c0, C = this.cost;
    C.ticks++; C.cpuMs += ms; C.maxCpuMs = Math.max(C.maxCpuMs, ms); C.bodyRows += bodies.length; C.ents += full.length; C.receipts += d.receipts?.length ?? 0; C.objectDeltas += objects?.length ?? 0;
    let bytes = 0;
    if (this.measureBytes) {bytes = JSON.stringify(d.scene ? {...d, scene: 'scene'} : d).length; C.bytes += bytes; C.maxBytes = Math.max(C.maxBytes, bytes);}
    if (this.samples.length < 50000) this.samples.push([ms, bytes]);
    for (const f of this.subs) try {f(d);} catch { /* a consumer fault never breaks the tick */ }
  }
}

/** Behind SIM_READ_WORKER=1 (default off: nothing is installed, the tick is unchanged). main.ts (B-port) calls this once
 *  the host has booted and the ledger has its comms; the tap then runs after every tick. */
export function installDeltaStream(host: WorldHost, L: EdgeLedger, env: NodeJS.ProcessEnv = process.env): DeltaTap | null {
  if (env.SIM_READ_WORKER !== '1') return null;
  const tap = new DeltaTap(host, L);
  tap.extend = new VerdictPump(() => menuWorldOf(host) as LiveMenuWorld, host as never, L);   // per call: the host's engine may be replaced
  host.splitTap = (tick, out) => tap.onTick(tick, out);
  return tap;
}
