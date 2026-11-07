// Stage B (lane B-facade, item 3): what main ships besides B-delta's WorldDelta so a ReplicaMenuWorld answers every read
// the Soul read code makes: the action rows (each program's current action; the live sit/take_slot holds; the record
// fields here.ts reads for "ends in"), the engine's admission verdicts (`canPerform` per program key), and the menu
// statics (regions, nav solids, anchors, verbs, the kernel) whenever they move. Riding on the DeltaTap (delta.ts `extend`):
// one `menu` section per delta, emitted only when something in it changed; a WorldInit carries the whole set.
//
// Verdicts: main's own reads ask `LiveFeasibility` (menu-world.ts) and every fresh answer is shipped with the next delta;
// a replica's misses come back with `ask()` and are answered at the next tick boundary (the agent-visible trade-off:
// one delta). Shipped verdicts are re-asked when their actor's action changes (route keys) or any action changes
// (scope-'' keys, e.g. a seat taken), under a CPU budget per tick, so a verdict is never older than its inputs for long.
import type {Program, RuntimeView} from '@souls/engine-contract';
import {CATALOG} from '../../../../mars/viewer/engine/world/catalog.ts';
import {livePlatforms} from '../edge/eyes/platforms.ts';
import {LiveFeasibility, planKey, type ActionRow, type ClaimRow, type LedgerEnv, type MenuDelta, type MenuInit, type MenuStatics, type RecordRow, type VerdictRow, type MenuWorld} from './menu-world.ts';

/** The record verbs the read code reads from `runtime.records` (held seats, berths, slots). */
/** A test engine may lack a read: the statics then carry the empty value. */
const tryOr = <T>(f: () => T, d: T): T => {try {return f();} catch {return d;}};
const HELD = new Set(['sit', 'take_slot']);
const PARAMS = ['actor', 'fixture', 'on', 'slot', 'activity', 'seconds'] as const;

type LedgerLike = {weatherNow?: () => unknown; recentStrikesV1?: () => unknown; spotsProvider?: () => unknown; godPhysicsV1?: {hash(): string; read(): unknown}; groundEnvV1?: () => unknown};
type Host = {minds: Map<string, {soulId: string; entityId: string}>; mindByEntity?: Map<string, {soulId: string}>; kernel?: unknown; extra?: Record<string, unknown>};

export class VerdictPump {
  private mwOf: () => MenuWorld & {feasibility: LiveFeasibility}; private mwNow: (MenuWorld & {feasibility: LiveFeasibility}) | null = null; private host: Host;
  /** main's MenuWorld for its CURRENT engine (menuWorldOf is one per engine): a host whose engine is replaced (a quiet
   *  renewal, a restore) must be read through the new one, or every action row, record, static and verdict shipped from
   *  then on is the old engine's (lane B-serve: the replica diverged after the tap's 'engine replaced' restart). */
  private get mw() {
    const m = this.mwOf();
    if (m !== this.mwNow) {this.mwNow = m; m.feasibility.fresh ??= [];}
    return m;
  }
  private actionKeys = new Map<string, string>(); private recordKeys = new Map<string, string>();
  private shipped = new Map<string, {actor: string; program: Program; scope: string; v: string}>();
  private asks = new Map<string, {program: Program; scope: string}>();
  private dirty: string[] = []; private dirtyAll = false;
  private staticsRef: unknown[] = []; private staticsKey = ''; private kernelKey = ''; private namesKey = ''; private claimsKey = '';
  /** CPU budget (ms) per tick for re-asking shipped verdicts. */
  budgetMs = 2;
  readonly cost = {ticks: 0, cpuMs: 0, maxCpuMs: 0, verdicts: 0, reasks: 0, asks: 0, actions: 0, records: 0, statics: 0, kernels: 0};

  private L?: LedgerLike; private envKeys: Record<string, string> = {}; private spotsRef: unknown = undefined;
  constructor(mw: (MenuWorld & {feasibility: LiveFeasibility}) | (() => MenuWorld & {feasibility: LiveFeasibility}), host: Host, L?: LedgerLike) {
    this.mwOf = typeof mw === 'function' ? mw : () => mw; this.host = host; this.L = L;
    this.mw.feasibility.fresh = [];
    for (const a of this.actionRows()) this.actionKeys.set(a.actor, JSON.stringify(a));
    for (const r of this.recordRows()) this.recordKeys.set(r.id, JSON.stringify(r));
    const s = this.statics(); this.staticsRef = this.refs(); this.staticsKey = JSON.stringify([s.anchors, s.newcomer ?? null, s.deliveries ?? null, s.groundV1, s.physical, s.upperFloors]); this.kernelKey = JSON.stringify(s.kernel); this.namesKey = JSON.stringify(s.names);
  }
  /** A replica's misses (VerdictTable.misses): answered with the next delta. */
  ask(misses: Iterable<{program: Program; scope: string}>) {for (const m of misses) if (this.asks.size < 4096) this.asks.set(m.scope + '\u0002' + planKey(m.program), m);}

  private soulOf(actor: string) {return this.host.mindByEntity?.get(actor)?.soulId ?? actor;}
  private row(key: string, program: Program, scope: string, verdict: VerdictRow['verdict'], tick: number): VerdictRow {
    this.shipped.set(key, {actor: program.actor, program, scope, v: JSON.stringify(verdict)});
    return {soulId: this.soulOf(program.actor), actor: program.actor, key, verdict, tick};
  }
  actionRows(): ActionRow[] {
    const out: ActionRow[] = [], tick = this.mw.world.tick;
    for (const m of this.host.minds.values()) {
      const pid = this.mw.programOf?.(m.entityId), pa = pid ? this.mw.programAction?.(pid) : null;
      if (pid) out.push({programId: pid, actor: m.entityId, step: pa?.step ?? 0, action: pa ? {...pa.action} : null, tick: pa?.tick ?? tick});
    }
    return out;
  }
  recordRows(): RecordRow[] {
    const rt = this.mw.runtime as RuntimeView | undefined, live = new Set(rt?.liveIds?.() ?? []), mine = new Set<string>();
    if (!rt?.records) return [];
    for (const m of this.host.minds.values()) {const pid = this.mw.programOf?.(m.entityId), a = pid ? this.mw.programAction?.(pid)?.action.id : undefined; if (a) mine.add(a);}
    const out: RecordRow[] = [];
    for (const id of new Set([...live, ...mine])) {
      const r = rt.records.get(id) as (undefined | {id: string; verb: string; status: string; phase?: string; params?: Record<string, unknown>; requestedTick?: number; history?: {tick: number; status: string}[]});
      if (!r || (!mine.has(id) && !HELD.has(r.verb))) continue;
      const params: Record<string, unknown> = {}; for (const k of PARAMS) if (r.params && r.params[k] !== undefined) params[k] = r.params[k];
      const running = r.history?.find(h => h.status === 'running');
      out.push({id, verb: r.verb, status: r.status, ...(r.phase !== undefined ? {phase: r.phase} : {}), live: live.has(id), params,
        ...(r.requestedTick !== undefined ? {requestedTick: r.requestedTick} : {}), ...(running ? {runningTick: running.tick} : {})});
    }
    return out;
  }
  statics(): MenuStatics {
    const w = this.mw.world as unknown as {regions?: unknown; navV1?: unknown};
    return {regions: structuredClone(w.regions ?? {}), navV1: structuredClone(w.navV1 ?? null), rulesVersion: this.mw.rulesVersion, verbs: structuredClone(tryOr(() => this.mw.describeVerbs(), [])),
      anchors: structuredClone(tryOr(() => this.mw.anchors(), [])), newcomer: this.mw.commonsNewcomerResourcesV1?.(), deliveries: this.mw.commonsFoodDeliveriesV1?.(),
      kernel: structuredClone(this.host.kernel ?? null), names: this.names(), ...this.movement()};
  }
  /** The ledger's god-fed reads, changed keys only (`all`: every key a provider exists for). Spots by reference (the
   *  provider returns the same object until the god's spots move). */
  private ledgerEnv(all: boolean): LedgerEnv | undefined {
    const L = this.L; if (!L) return undefined;
    const out: LedgerEnv = {};
    const put = (k: 'weather' | 'strikes', f: (() => unknown) | undefined) => {if (!f) return; const v = tryOr(f, null) ?? null, j = JSON.stringify(v); if (all || j !== this.envKeys[k]) {this.envKeys[k] = j; out[k] = JSON.parse(j);}};
    put('weather', L.weatherNow?.bind(L)); put('strikes', L.recentStrikesV1?.bind(L));
    if (L.spotsProvider) {const v = tryOr(() => L.spotsProvider!(), null) ?? null; if (all || v !== this.spotsRef) {this.spotsRef = v; out.spots = structuredClone(v);}}
    // the god bridge's physics facts (seat/bed/item/surface assets, levels): by hash, sent whole when it moved
    if (L.godPhysicsV1) {const h = tryOr(() => L.godPhysicsV1!.hash(), ''); if (all || h !== this.envKeys.physics) {this.envKeys.physics = h; out.physics = tryOr(() => L.godPhysicsV1!.read(), null);}}
    // the rides' boarding checks (engine-private: a punt's bank and water today), as main's ledger last made them
    const bc = (L as {boardingChecks?: Map<string, unknown>}).boardingChecks;
    if (bc) {const j = JSON.stringify([...bc]); if (all || j !== this.envKeys.boarding) {this.envKeys.boarding = j; out.boarding = Object.fromEntries(JSON.parse(j));}}
    // the ground swim offers' recipe and deep-middle answers (main's engine answers each once per water)
    if (L.groundEnvV1) {const v = tryOr(() => L.groundEnvV1!(), null), j = JSON.stringify(v); if (all || j !== this.envKeys.ground) {this.envKeys.ground = j; out.ground = JSON.parse(j);}}
    // Eyes (lane B-serve): the render platforms' answer (edge/eyes/platforms.ts livePlatforms), recomputed only when
    // its inputs move (the engine's accepted render fact, the nav, the base scene); null = no render fact (the worker
    // derives the current-live-activities answer from the shipped spots, as main does)
    {const e = (this.mw as {engine?: {renderPlatformMetadata?: unknown; renderPlatformsV1?: () => unknown; world?: {navV1?: unknown; base?: {staticHash?: string}}}}).engine;
      if (e && typeof e.renderPlatformsV1 === 'function') {
        // (a MarsEngine keeps the fact by reference; any other engine is keyed by its answer's JSON)
        const fact = 'renderPlatformMetadata' in e ? e.renderPlatformMetadata : JSON.stringify(tryOr(() => e.renderPlatformsV1!(), null) ?? null);
        const refs = [fact, e.world?.navV1, e.world?.base?.staticHash];
        if (all || refs.some((r, i) => r !== this.platformRefs[i])) {
          this.platformRefs = refs;
          const v = this.L ? tryOr(() => livePlatforms(this.L as never), null) : null;
          out.platforms = v && (v as {source?: string}).source === 'accepted-render-fact' ? structuredClone(v) : null;
        }
      }}
    return Object.keys(out).length ? out : undefined;
  }
  private platformRefs: unknown[] = [];
  /** What the engine's movementVerb / placeLevelV1 read besides the shipped world: groundV1, the physical-shore mode, upper floors. */
  private movement() {
    const e = (this.mw as {engine?: {physical?: unknown}}).engine, w = this.mw.world as unknown as {groundV1?: unknown; upperFloorsV1?: unknown};
    return {groundV1: !!w.groundV1, physical: !!e?.physical, upperFloors: structuredClone(w.upperFloorsV1 ?? null)};
  }
  /** Every claimed fixture slot (the runtime's `slot:` owners) and its claiming record's actor: bodyUsesV1/seatOccupantsV1. */
  claimRows(): ClaimRow[] {
    const rt = (this.mw as {engine?: {rt?: {owners?: Map<string, {action: string}[]>}}}).engine?.rt, owners = rt?.owners;
    if (!owners) return [];
    const out: ClaimRow[] = [], records = this.mw.runtime?.records;
    for (const [k, list] of owners) {
      if (!k.startsWith('slot:') || !list.length) continue;
      const actor = (records?.get(list[0].action) as {params?: {actor?: unknown}} | undefined)?.params?.actor;
      if (typeof actor === 'string') out.push([k.slice(5), actor]);
    }
    return out.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  }
  /** The host's name facts the read code reads (world.ts profileFact / soulNameRefusal): accepted profiles, old-name claims. */
  private names() {const x = this.host.extra ?? {}; return structuredClone({profiles: x.soulProfilesV1 ?? {}, claims: x.soulNameClaimsV1 ?? {}});}
  private refs() {const w = this.mw.world as unknown as {regions?: unknown; navV1?: unknown}; return [w.regions, w.navV1, this.mw.rulesVersion];}
  /** The whole menu section for a WorldInit. Pure: the deltas keep their own baseline (a row in both is an idempotent
   *  upsert), so consumers following the stream from an older init miss nothing. */
  init(): MenuInit {
    const actions = this.actionRows(), records = this.recordRows(), statics = this.statics();
    const tick = this.mw.world.tick, verdicts = [...this.shipped].map(([key, s]) => ({soulId: this.soulOf(s.actor), actor: s.actor, key, verdict: JSON.parse(s.v), tick}));
    const assets = this.runtimeAssets(true);
    return {actions, records, verdicts, statics, claims: this.claimRows(), env: this.ledgerEnv(true), ...(assets ? {assets} : {})};
  }
  /** The CATALOG entries main's engine registered at runtime (`ew:` ids: registerAssets from the world's entity physics;
   *  never replaced: an id names its content): all of them (an init), or those not shipped yet (a delta, when the
   *  catalogue grew). */
  private assetsShipped = new Set<string>();
  private assetsCount = -1;
  private runtimeAssets(all: boolean): Record<string, unknown> | undefined {
    const keys = Object.keys(CATALOG);
    if (!all && keys.length === this.assetsCount) return undefined;
    if (!all) this.assetsCount = keys.length;
    let out: Record<string, unknown> | undefined;
    for (const id of keys) if (id.startsWith('ew:') && (all || !this.assetsShipped.has(id))) {(out ??= {})[id] = CATALOG[id]; if (!all) this.assetsShipped.add(id);}
    return out;
  }
  /** After each tick (from the tap): the changed rows, or undefined when nothing in the menu section moved. */
  delta(staticMoved: boolean): MenuDelta | undefined {
    const t0 = performance.now(), d: MenuDelta = {}, tick = this.mw.world.tick, F = this.mw.feasibility;
    // action rows: one per actor with a program; gone when the program ends
    const seen = new Set<string>(), changedActors: string[] = [];
    for (const a of this.actionRows()) {seen.add(a.actor); const k = JSON.stringify(a); if (this.actionKeys.get(a.actor) !== k) {this.actionKeys.set(a.actor, k); (d.actions ??= []).push(a); changedActors.push(a.actor);}}
    for (const actor of this.actionKeys.keys()) if (!seen.has(actor)) {this.actionKeys.delete(actor); (d.actionsGone ??= []).push(actor); changedActors.push(actor);}
    const rseen = new Set<string>();
    for (const r of this.recordRows()) {rseen.add(r.id); const k = JSON.stringify(r); if (this.recordKeys.get(r.id) !== k) {this.recordKeys.set(r.id, k); (d.records ??= []).push(r);}}
    for (const id of this.recordKeys.keys()) if (!rseen.has(id)) {this.recordKeys.delete(id); (d.recordsGone ??= []).push(id);}
    {const c = this.claimRows(), k = JSON.stringify(c); if (k !== this.claimsKey) {this.claimsKey = k; d.claims = c;}}
    {const e = this.ledgerEnv(false); if (e) d.env = e;}
    {const a = this.runtimeAssets(false); if (a) d.assets = a;}
    // statics: by reference (the engine replaces regions/navV1 on a static change) and on the tap's static epoch
    const refs = this.refs();
    if (staticMoved || refs.some((x, i) => x !== this.staticsRef[i]) || tick % 200 === 0) {
      const s = this.statics(), k = JSON.stringify([s.anchors, s.newcomer ?? null, s.deliveries ?? null, s.groundV1, s.physical, s.upperFloors]);
      if (staticMoved || refs.some((x, i) => x !== this.staticsRef[i]) || k !== this.staticsKey) {this.staticsRef = refs; this.staticsKey = k; const {kernel: _k, ...rest} = s; d.statics = rest; this.cost.statics++;}
    }
    // the kernel (things, vocab, decks): resent whole when it changed (checked every 20 ticks; it changes on births and rules)
    if (tick % 20 === 0) {const k = JSON.stringify(this.host.kernel ?? null); if (k !== this.kernelKey) {this.kernelKey = k; d.kernel = JSON.parse(k); this.cost.kernels++;}
      const n = this.names(), nk = JSON.stringify(n); if (nk !== this.namesKey) {this.namesKey = nk; d.names = n;}}
    // verdicts: main's own fresh answers, the replicas' asks, then re-asks of shipped ones within the budget
    const out: VerdictRow[] = [];
    for (const f of F.fresh ?? []) {const prev = this.shipped.get(f.key); if (!prev || prev.v !== JSON.stringify(f.verdict)) out.push(this.row(f.key, f.program, f.scope, f.verdict, tick)); else this.shipped.set(f.key, {...prev, program: f.program});}
    if (F.fresh) F.fresh.length = 0;
    for (const [key, a] of this.asks) {if (this.shipped.has(key)) continue; out.push(this.row(key, a.program, a.scope, F.canPerform(a.program, a.scope), tick)); this.cost.asks++;}
    this.asks.clear();
    if (F.fresh) F.fresh.length = 0;
    if (changedActors.length) {this.dirty.push(...changedActors); this.dirtyAll = true;}
    if (this.dirty.length || this.dirtyAll) {
      const own = new Set(this.dirty);
      for (const [key, s] of this.shipped) {
        if (performance.now() - t0 > this.budgetMs) break;
        if (!own.has(s.actor) && !(this.dirtyAll && s.scope === '')) continue;
        const v = F.canPerform(s.program, s.scope), j = JSON.stringify(v); this.cost.reasks++;
        if (j !== s.v) out.push(this.row(key, s.program, s.scope, v, tick));
      }
      this.dirty = []; this.dirtyAll = false;
      if (F.fresh) F.fresh.length = 0;
    }
    if (out.length) {d.verdicts = out; this.cost.verdicts += out.length;}
    if (this.shipped.size > 20000) this.shipped.clear();
    const ms = performance.now() - t0, C = this.cost; C.ticks++; C.cpuMs += ms; C.maxCpuMs = Math.max(C.maxCpuMs, ms);
    C.actions += d.actions?.length ?? 0; C.records += d.records?.length ?? 0;
    return Object.keys(d).length ? d : undefined;
  }
}
