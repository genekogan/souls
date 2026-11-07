// Stage B (lane B-facade, item 6): the read worker's world. Fed the same WorldInit / WorldDelta stream as B-delta's
// Replica (plus this lane's `menu` section, split/verdict-pump.ts), it holds (a) the replicated plain state, (b) B-spatial's
// SpatialReplica built from the engine's static scene export and the replicated bodies, (c) the verdict table, and
// answers the Soul read code as a `ReplicaMenuWorld` (split/menu-world.ts). Never touches an engine.
import type {ProgramAction, RuntimeView} from '@souls/engine-contract';
import type {WorldState as NativeWorld} from '../../../../mars/viewer/engine/world/types.ts';
import type {StaticExportV1} from '../../../../mars/viewer/engine/spatial/service.ts';
import type {TileRect} from '../../../../mars/viewer/engine/spatial/tiled.ts';
import {Replica, type Ent, type WorldDelta, type WorldInit} from './read-model.ts';
import {SpatialReplica, type FixtureRow, type ReplicaBody} from './spatial-replica.ts';
import {ReplicaMenuWorld, VerdictTable, type ActionRow, type Aboard, type ClaimRow, type MenuDelta, type MenuInit, type MenuStatics, type RecordRow} from './menu-world.ts';
import {CATALOG} from '../../../../mars/viewer/engine/world/catalog.ts';
import {registerAssets} from '../../../../packages/engine-mars/src/catalog-adapter.ts';
import {placeLevelOf} from '../../../../packages/engine-mars/src/upper-floors.ts';
import {inShoreDomain} from '../../../../mars/viewer/engine/locomotion/connected-shore.ts';
import {inDeepWater, destinationInDeepWater} from '../../../../mars/viewer/engine/locomotion/swim.ts';

type MenuWire = {menu?: MenuInit};
type MenuDeltaWire = {menu?: MenuDelta};
const bodyOf = (e: Ent): ReplicaBody => ({id: e.id, x: e.pose.p[0], y: e.pose.p[1], z: e.pose.p[2], level: (e.human?.level as number | undefined) ?? 0, human: true});

export class ReplicaWorld {
  readonly R = new Replica();
  readonly verdicts = new VerdictTable((from, to) => this.spatial?.reachV1(from, to));
  /** claimed fixture slots: slot id (`fixture#slot`) -> the claiming body */
  private claims = new Map<string, string>();
  spatial: SpatialReplica | null = null;
  readonly mw: ReplicaMenuWorld;
  private ents: Record<string, Ent> = {};
  private actions = new Map<string, ActionRow>();
  private records = new Map<string, RecordRow & {params: Record<string, unknown>; history?: {tick: number; status: string}[]}>();
  private statics: MenuStatics = {regions: {}, navV1: null, rulesVersion: '', verbs: [], anchors: []};
  kernel: unknown = null;
  /** the ledger's god-fed reads (weather, lightning strikes, god activity spots): split/read-host.ts */
  readonly ledgerEnv: {weather?: unknown; strikes?: unknown; spots?: unknown} = {};
  /** the host's name facts (profiles, old-name claims): split/read-host.ts */
  names: unknown = null;
  /** a pump's menu section has been seen (main runs a VerdictPump) */
  private pumped = false;
  private sceneKey = '';
  private worldView: NativeWorld;
  private runtimeView: RuntimeView;
  /** One per init/apply: the time and what changed (cost in the worker). */
  readonly cost = {inits: 0, applies: 0, refused: 0, spatialBuilds: 0, spatialRebuilds: 0, spatialKept: 0};

  constructor() {
    const self = this;
    this.worldView = {get tick() {return self.R.pos.tick;}, get entities() {return self.ents;}, get regions() {return self.statics.regions;},
      get navV1() {return self.statics.navV1;}, get env() {return self.R.env;}} as unknown as NativeWorld;
    const records = this.records as unknown as RuntimeView['records'];
    this.runtimeView = {get tick() {return self.R.pos.tick;}, records, violations: [], liveIds: () => [...this.records.values()].filter(r => r.live).map(r => r.id)};
    // the spatial reads are bound late (the replica is rebuilt when the static scene moves): forward through `this.spatial`
    const sp = new Proxy({}, {get: (_t, k) => {const s = this.spatial as unknown as Record<string | symbol, unknown> | null; const f = s?.[k]; return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(s) : undefined;}});
    const spatialNames = ['readPassV1', 'staticEpochV1', 'navEpochV1', 'navWarmV1', 'navCheckV1', 'navNearestMainV1', 'clearanceAtV1', 'clearanceUpToV1', 'nearestStandableV1',
      'standableNearV1', 'clearSpotsV1', 'dryGroundAtV1', 'lyingRoomAtV1', 'standYAtV1', 'nativeSeatLevelsV1'] as const;
    const spatial: Record<string, unknown> = {};
    for (const k of spatialNames) spatial[k] = (...a: unknown[]) => {const f = (sp as Record<string, unknown>)[k]; if (typeof f !== 'function') throw new Error(`replica: no spatial service yet (${k})`); return (f as (...x: unknown[]) => unknown)(...a);};
    this.mw = new ReplicaMenuWorld({
      world: () => this.worldView, runtime: () => this.runtimeView,
      // the pump's action rows are complete every tick (B-delta's ProgramRow is re-read only when a tick names the body)
      programOf: actor => this.pumped ? this.actions.get(actor)?.programId ?? null : this.R.programs.get(actor)?.[1] ?? null,
      programAction: pid => this.programAction(pid),
      statics: {get rulesVersion() {return self.statics.rulesVersion;}, get verbs() {return self.statics.verbs;}, anchors: () => structuredClone(this.statics.anchors),
        get newcomer() {return self.statics.newcomer;}, get deliveries() {return self.statics.deliveries;}},
      carriers: () => this.R.carrierRows().map(c => {const e = this.ents[c.id]; return {...c, pose: {p: [...e.pose.p], yaw: e.pose.yaw}};}),
      spatial: spatial as never, verdicts: this.verdicts,
      carrierOf: actor => this.carrierOf(actor),
      placeLevelV1: level => placeLevelOf({upperFloorsV1: this.statics.upperFloors ?? undefined} as never, level),
      bodyUsesV1: id => this.bodyUsesV1(id),
      seatOccupantsV1: (id, kind) => this.seatOccupantsV1(id, kind),
      // B-delta's HoldRow (re-read when a tick names the body): the exact native seat slot here.ts seat() reports
      nativeSeatHoldsV1: actor => (this.R.holds.get(actor)?.[1] ?? []).map(h => ({action: h.action, slot: h.slot})),
      movementVerb: (actor, x, z) => this.movementVerb(actor, x, z),
      bodyWaterDepthV1: actor => this.bodyWaterDepthV1(actor),
      routeEstimateV1: (actor, to, level) => this.routeEstimateV1(actor, to, level),
    });
  }
  private programAction(pid: string): ProgramAction | null {
    for (const a of this.actions.values()) if (a.programId === pid && a.action) return {tick: a.tick, programId: a.programId, actor: a.actor, step: a.step, action: {...a.action} as ProgramAction['action']};
    return null;
  }
  // ---- engine reads over the replicated entities (packages/engine-mars/src/engine.ts, same code)
  private carrierOf(actor: string): Aboard | null {
    const b = this.ents[actor]?.human?.carrier as {id: string; slot: string; phase: string; outBy?: number} | undefined, e = b ? this.ents[b.id] as Ent & {carrier?: {phase: string}; label?: string} : undefined;
    if (!b || !e?.carrier) return null;
    const tick = this.R.pos.tick, out = b.phase === 'leaving' || e.carrier.phase === 'landed' ? Math.max(1, Math.ceil(((b.phase === 'leaving' && b.outBy !== undefined ? b.outBy : tick + 240) - tick) / 20)) : undefined;
    return {id: e.id, slot: b.slot, riderPhase: b.phase, phase: e.carrier.phase, label: e.label ?? e.id, ...(out !== undefined ? {outInSeconds: out} : {})};
  }
  private slotsOf(e: Ent) {return ((CATALOG as Record<string, {slots?: {id: string; kind: string}[]}>)[String(e.def)]?.slots ?? []).map(d => ({id: `${e.id}#${d.id}`, local: d.id, kind: d.kind}));}
  private bodyUsesV1(id: string): {body: string; how: 'occupied' | 'held'} | null {
    const e = this.ents[id] as (Ent & {support?: {kind?: string; by?: string | string[]}}) | undefined; if (!e) return null;
    const s = e.support; if (s?.kind === 'in-hand') return {body: s.by as string, how: 'held'}; if (s?.kind === 'held' && s.by?.[0]) return {body: (s.by as string[])[0], how: 'held'};
    for (const slot of this.slotsOf(e)) {const actor = this.claims.get(slot.id); if (actor && this.ents[actor]?.human) return {body: actor, how: 'occupied'};}
    return null;
  }
  private seatOccupantsV1(id: string, kind = 'seat'): {slot: string; body: string}[] {
    const e = this.ents[id]; if (!e) return [];
    const out: {slot: string; body: string}[] = [];
    for (const slot of this.slotsOf(e)) {if (slot.kind !== kind) continue; const actor = this.claims.get(slot.id); if (actor && this.ents[actor]?.human) out.push({slot: slot.local, body: actor});}
    return out;
  }
  /** The engine's helpers read `rt.world` and `rt.services.spatial` only. */
  // (the service is synced against the replica's own world, which holds no entities: the static scene comes whole with
  //  the export. Handing the helpers the service itself let swim.ts destinationInDeepWater `sync(rt.world)` it against this
  //  view, which has every entity: a whole solids rebuild, and another on the replica's next read: ~5 s of a 2-min probe,
  //  and a held read pass let go. The helpers read `ground` (field, base) and call `sync` only.)
  private rt() {const sp = this.spatial?.service(); return {world: this.worldView, services: {spatial: sp ? {ground: sp.ground, sync: () => false} : undefined}} as never;}
  private movementVerb(actor: string, x: number, z: number): string {
    const a = this.ents[actor], w = {navV1: this.statics.navV1} as never;
    if (this.statics.groundV1 && this.spatial && (inDeepWater(this.rt(), actor) || destinationInDeepWater(this.rt(), x, z))) return 'ground_travel';
    return this.statics.physical && (inShoreDomain(w, x, z) || !!a && inShoreDomain(w, a.pose.p[0], a.pose.p[2])) ? 'commons_shore_travel' : 'walk_to';
  }
  private bodyWaterDepthV1(actor: string): number {
    const e = this.ents[actor], h = e?.human as {level?: number; carrier?: unknown; riding?: unknown} | undefined;
    if (!h || (h.level ?? 0) !== 0 || h.carrier || h.riding || !this.statics.groundV1 || !this.spatial) return 0;
    const g = this.spatial.service().ground as unknown as {base: {waterLevel(x: number, z: number): number | null; height(x: number, z: number): number}; field: {height(x: number, z: number): number}} | undefined;
    if (!g) return 0;
    const x = e.pose.p[0], z = e.pose.p[2], lvl = g.base.waterLevel(x, z); if (lvl === null) return 0;
    if ((g.field as unknown) !== g.base && e.pose.p[1] >= g.field.height(x, z) - 0.5 && g.field.height(x, z) >= lvl) return 0;
    return Math.max(0, lvl - g.base.height(x, z));
  }
  /** engine.routeEstimateV1 = walk_to's plan length from the body. Here: the planner's route from the body's pose on its
   *  level (walk_to adds the sleeper and grip refusals and its start snapping; the oracle measures the difference). */
  private routeEstimateV1(actor: string, to: [number, number], level?: number): {ok: true; metres: number} | {ok: false; code: string; message: string} {
    const a = this.ents[actor], h = a?.human as {level?: number} | undefined;
    if (!a || !h) return {ok: false, code: 'actor.unknown', message: 'no such body'};
    if (!this.spatial) return {ok: false, code: 'replica.no-spatial', message: 'no spatial service yet'};
    const r = this.spatial.routeV1({p: [a.pose.p[0], a.pose.p[2]], level: h.level ?? 0}, {p: to, level: level ?? h.level ?? 0});
    return r.ok ? {ok: true, metres: Math.round(r.route.length * 10) / 10} : {ok: false, code: r.diagnostic.code, message: r.diagnostic.message};
  }
  private fixture = (id: string): FixtureRow | undefined => {const o = this.ents[id] as (Ent & {support?: {kind?: string}; level?: number}) | undefined; return o ? {id, def: String(o.def), kind: String(o.kind), ...(o.support?.kind ? {support: o.support.kind} : {}), ...(typeof o.level === 'number' ? {level: o.level} : {}), y: o.pose.p[1]} : undefined;};
  private humans(): ReplicaBody[] {const out: ReplicaBody[] = []; for (const e of Object.values(this.ents)) if (e.kind === 'human') out.push(bodyOf(e)); return out;}
  private syncSpatial() {
    const R = this.R;
    if (R.sceneKey !== this.sceneKey && R.scene) {
      this.sceneKey = R.sceneKey;
      if (!this.spatial) {this.spatial = SpatialReplica.fromStaticScene(R.scene as StaticExportV1, this.humans(), {fixture: this.fixture}); this.cost.spatialBuilds++;}
      else {this.spatial.rebuild(R.scene as StaticExportV1); this.cost.spatialRebuilds++;}
    }
    if (this.spatial) {this.spatial.applyPages((R.pages as TileRect[] | null) ?? null); this.spatial.applyNavReady(R.navReady);}
  }
  private setRecord(r: RecordRow) {const history = r.runningTick !== undefined ? [{tick: r.runningTick, status: 'running'}] : []; this.records.set(r.id, {...r, history});}
  private applyMenu(m: MenuDelta | MenuInit | undefined, whole: boolean) {
    if (!m) return;
    this.pumped = true;
    if (m.assets) registerAssets(m.assets);   // main's runtime catalogue entries (a worker's CATALOG has only the built-in ones)
    if (whole) {this.actions.clear(); this.records.clear(); this.verdicts.clear();}
    for (const a of m.actions ?? []) this.actions.set(a.actor, a);
    for (const id of (m as MenuDelta).actionsGone ?? []) this.actions.delete(id);
    for (const r of m.records ?? []) this.setRecord(r);
    for (const id of (m as MenuDelta).recordsGone ?? []) this.records.delete(id);
    if (m.verdicts?.length) this.verdicts.apply(m.verdicts);
    if (m.claims) this.claims = new Map(m.claims as ClaimRow[]);
    if (whole) for (const k of Object.keys(this.ledgerEnv)) delete (this.ledgerEnv as Record<string, unknown>)[k];
    if (m.env) Object.assign(this.ledgerEnv, m.env);
    if (m.statics) {const {kernel: _k, names: _n, ...rest} = m.statics as MenuStatics; this.statics = {...this.statics, ...rest};}
    const k = whole ? (m as MenuInit).statics.kernel : (m as MenuDelta).kernel;
    if (k !== undefined) this.kernel = k;
    const n = whole ? (m as MenuInit).statics.names : (m as MenuDelta).names;
    if (n !== undefined) this.names = n;
  }
  init(w: WorldInit & MenuWire) {
    this.R.init(w); this.ents = Object.fromEntries(this.R.entities); this.cost.inits++;
    this.applyMenu(w.menu, true);
    // a re-init on the same static scene (a resnapshot: a relocate, a resync) keeps the spatial service and its labels
    // (the first labelling of a live world takes seconds): only the bodies are replaced
    if (this.spatial && this.R.sceneKey === this.sceneKey) {
      const now = this.humans(), ids = new Set(now.map(b => b.id)), gone = this.spatialBodies.filter(id => !ids.has(id));
      this.spatial.applyBodies({bodies: now, gone}); this.cost.spatialKept++;
    } else {this.sceneKey = ''; this.spatial = null;}
    this.syncSpatial();
    this.spatialBodies = this.humans().map(b => b.id);
  }
  private spatialBodies: string[] = [];
  /** False (nothing applied): not the next delta; re-init. */
  apply(d: WorldDelta & MenuDeltaWire): boolean {
    if (!this.R.apply(d)) {this.cost.refused++; return false;}
    this.cost.applies++;
    for (const e of d.ents ?? []) this.ents[e.id] = this.R.entities.get(e.id)!;
    for (const id of d.gone ?? []) delete this.ents[id];
    this.applyMenu(d.menu, false);
    if (this.spatial) {
      const changed: ReplicaBody[] = [];
      for (const b of d.bodies ?? []) {const e = this.ents[b[0]]; if (e?.kind === 'human') changed.push(bodyOf(e));}
      for (const e of d.ents ?? []) if (e.kind === 'human') changed.push(bodyOf(e));
      this.spatial.applyBodies({bodies: changed, gone: d.gone});
    }
    this.syncSpatial();
    return true;
  }
}
