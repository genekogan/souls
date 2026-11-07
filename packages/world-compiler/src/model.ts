// The in-memory world model the compiler mutates: defs, entities, indices,
// terrain. Pure data + lookups; no I/O. The server persists it; the god skill
// mirrors it from snapshot + stream.
import { meshFloors, meshFloorLinks } from './mesh-floors.ts';
import { Terrain, emptyGround, type Ground, type Landform, type Water } from '@souls/ground';
import { CREATION_LIMITS, GENERATORS, mergeKitSlots, type Baked, type LocalOBB } from '@souls/generators';
import { cacheKeyOfText, hashOf, stableStringify } from './hash.ts';
import { stretchBaked, stretchOf } from './vocab/index.ts';
import { defSchema, fieldSchema, type Def, type DefInput, type Entity, type StoredDef, type Value, type WorldConstants, type WorldState, worldConstantsSchema, worldStateSchema } from './schemas.ts';

export type OBB = { c: [number, number]; half: [number, number]; yaw: number; y0: number; y1: number };
/** Structural edits, including direct fixture/import Map writes, invalidate derived safety caches.
 * Entity/definition records themselves follow the model's existing immutable-record convention. */
class ModelMap<K, V> extends Map<K, V> {
  revision: object = {};
  private valuesUsed?: Map<V, number>;
  constructor(entries?: Iterable<readonly [K, V]>, countValues = false) {
    super();
    // Native Map construction preserves the cheap structural fork; per-entry JS hooks run only for edits.
    const map = Object.setPrototypeOf(new Map(entries), new.target.prototype) as ModelMap<K, V>;
    map.revision = {};
    if (countValues) { map.valuesUsed = new Map(); for (const v of map.values()) map.valuesUsed.set(v, (map.valuesUsed.get(v) ?? 0) + 1); }
    return map;
  }
  get uniqueSize() { return this.valuesUsed?.size ?? new Set(this.values()).size; }
  override set(k: K, v: V): this {
    if (this.has(k) && this.get(k) === v) return this;
    if (this.valuesUsed) { if (this.has(k)) this.drop(this.get(k)!); this.valuesUsed.set(v, (this.valuesUsed.get(v) ?? 0) + 1); }
    this.revision = {}; return super.set(k, v);
  }
  private drop(v: V) { const n = this.valuesUsed!.get(v)!; if (n === 1) this.valuesUsed!.delete(v); else this.valuesUsed!.set(v, n - 1); }
  override delete(k: K): boolean { if (!this.has(k)) return false; if (this.valuesUsed) this.drop(this.get(k)!); this.revision = {}; return super.delete(k); }
  override clear() { this.valuesUsed?.clear(); this.revision = {}; super.clear(); }
}
/** Preserve which def failed even when a parent, prefab child or dependent is being baked. */
export class BakeError extends Error {
  readonly def: StoredDef;
  constructor(def: StoredDef, cause: unknown) {
    super(`cannot bake ${def.ref}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'BakeError'; this.def = def;
  }
}
/** `baked`: physics of a footprint sidecar (asset store, L5), already in the def's metres. */
export type AssetInfo = { tris: number; bytes: number; textures: number; box: [number, number, number]; /** An image available to this world for same-origin sign media. */ image?: { ext: 'png' | 'jpg' }; baked?: Pick<Baked, 'colliders' | 'slots'> & Partial<Pick<Baked, 'surfaces' | 'openings' | 'links' | 'rooms' | 'notes'>> };
export type AssetLookup = (hash: string) => AssetInfo | undefined;
/** CATRUN: a process-wide, read-only, content-addressed def library (the core kit). A world resolves refs it does not
 *  store itself through it, and a def enters the world's own store (pinned by hash) the first time it is used
 *  (`adopt`). Keys: "name@v", "core/<x>@v", "sha:<hash>". Built once per process (library.ts). */
export type DefLibrary = { readonly id: string; readonly version: string; get(key: string): StoredDef | undefined; all(): readonly StoredDef[];
  /** Current catalogue revision for a new placement. Null refuses an unavailable managed name; undefined keeps local refs. */
  placementRef?(key: string): string | null | undefined;
};
/** Catalogue ids (CATALOG-PROGRAM P0) are aliases of the core refs worlds already use: `eden/<x>@v` → `core/<x>@v`,
 *  `lm/<x>@v` → `core/lm-<x>@v`, `mars/<x>@v` → `core/mars-<x>@v`. Other refs pass through. */
export const aliasRef = (ref: string) => { const m = /^(eden|lm|mars)\/(.+)$/.exec(ref); return m ? `core/${m[1] === 'eden' ? '' : m[1] + '-'}${m[2]}` : ref; };

/** Definition references in structural data, including nested palettes and reference-valued defaults. */
export function definitionRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && /^(?:sha:[0-9a-f]{64}|(?:(?:core|eden|lm|mars)\/)?[a-z0-9][a-z0-9._-]*@\d+)$/.test(v)) refs.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value); return [...refs];
}

/** G1 (tranche 2026-10-19): the stable text of a bake input (params, shape, an extending def) by identity. The model
 *  never mutates these in place (an edit gives the entity new params/shape objects), so each is stringified once, not on
 *  every bake lookup: a bake key re-stringified a building's ~0.5 KB params per call, the largest share of a layout
 *  query, a nav or places re-derive at 4,900 entities. The key is unchanged (cacheKeyOf of the same text). */
const BAKE_TEXT = new WeakMap<object, string>();
const textOf = (v: unknown): string => { if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? ''; let t = BAKE_TEXT.get(v); if (t === undefined) { t = stableStringify(v); t.charCodeAt(0); BAKE_TEXT.set(v, t); } return t; };   // charCodeAt flattens the rope once
function bakeKey(def: unknown, params: unknown, seed: number, shape: unknown): string { return cacheKeyOfText(`[${textOf(def)},${textOf(params)},${textOf(seed)},${textOf(shape)}]`); }

/** Z2: the hash a mesh def had before its distant version (make.lod1) was attached, else undefined. The near model,
 *  and so the def's thumbnail, is the same under both hashes (defineDef hashes the parsed def without its budget). */
export function nearHash(d: Omit<StoredDef, 'by'> & { by?: string }): string | undefined {
  if (d.make.kind !== 'mesh' || !d.make.lod1) return undefined;
  const { budget: _b, hash: _h, ref: _r, by: _by, born: _born, ...rest } = d;
  const { lod1: _l, ...make } = d.make;
  return hashOf({ ...rest, make });
}

export class WorldModel {
  constants: WorldConstants;
  state: WorldState;
  seed: string;
  seq = 0;            // entity counter (ids)
  editSeq = 0;        // committed batches
  defs: Map<string, StoredDef> = new ModelMap(undefined, true);      // by ref ("name@v") and by "sha:<hash>": the defs this world stores
  /** The shared library behind `defs` (null = the world stores everything it can resolve, as before CATRUN). */
  library: DefLibrary | null = null;
  entities: Map<string, Entity> = new ModelMap();
  children = new Map<string, Set<string>>();
  names = new Map<string, string>();        // `${parent}/${name}` → id
  terrain: Terrain;
  assets: AssetLookup;
  private bakes = new Map<string, Baked>();
  private cells = new Map<string, Set<string>>(); // spatial hash of solid footprints
  private footprints = new Map<string, OBB[]>();
  /** fromSnapshot(..., {lazyIndex}): the solid-footprint index is built on first use (lane W1: a viewer's arrival never
   *  asks for it, ~0.1 s of its first build). Every index read and write builds it first, from the entities as they are then. */
  private pendingIndex: (() => void) | null = null;
  private ensureIndex() { const f = this.pendingIndex; if (f) { this.pendingIndex = null; f(); } }
  /** Whether the solid-footprint index exists yet (a lazy one is built from the entities as they are when first read, so an
   *  insert before that needs no index call; lane PERF-SNAPSHOT: a resync's few upserts never force the whole index). */
  get hasIndex(): boolean { return this.pendingIndex === null; }
  private safetyKey?: { parts: unknown[]; key: object };
  /** slotsOf per entity object, kept only inside readPass (lane L3g); any model mutation through its methods drops it. */
  private slotMemo?: Map<Entity, Baked['slots']> | null;

  private safetyParts(): unknown[] | undefined {
    if (this.entities instanceof ModelMap && this.defs instanceof ModelMap)
      return [this.entities, this.entities.revision, this.defs, this.defs.revision, this.library, this.assets];
    return undefined;
  }
  /** Identical structural forks may share derived data until either copy changes its own maps.
   * Untracked replacement Maps deliberately disable caching rather than risk stale admission. */
  safetyCacheKey(): object {
    const parts = this.safetyParts(); if (!parts) return {};
    if (!this.safetyKey || parts.some((p, i) => p !== this.safetyKey!.parts[i])) this.safetyKey = {parts, key: {}};
    return this.safetyKey.key;
  }
  retainedDefCount(): number { return this.defs instanceof ModelMap ? this.defs.uniqueSize : new Set(this.defs.values()).size; }
  /** Transfer only when committing these exact scratch maps; independent worlds never inherit a total. */
  adoptSafetyCache(scratch: WorldModel) {
    if (this.entities === scratch.entities && this.defs === scratch.defs) this.safetyKey = scratch.safetyKey;
  }

  constructor(opts: { constants: Partial<WorldConstants> & { ground: WorldConstants['ground'] }; seed: string; state?: Partial<WorldState>; assets?: AssetLookup }) {
    this.constants = worldConstantsSchema.parse({ extent: 1000, ...opts.constants });
    this.state = worldStateSchema.parse(opts.state ?? {});
    this.seed = opts.seed;
    this.assets = opts.assets ?? (() => undefined);
    const g = emptyGround(this.constants.extent, this.constants.base);
    if (this.constants.ground === 'ocean') g.seaLevel = this.constants.seaLevel ?? 0;
    this.terrain = new Terrain(g);
  }

  // ---------- defs ----------

  /** Normalise, hash and store a def. Idempotent by hash. Returns the stored record. */
  defineDef(input: DefInput, by: string, born: number): StoredDef {
    this.slotMemo?.clear();
    const def: Def = defSchema.parse(input);
    const { budget: _b, ...hashable } = def;
    const hash = hashOf(hashable);
    const existing = this.defs.get('sha:' + hash);
    if (existing) return this.store(existing, true);
    const shared = this.library?.get('sha:' + hash);
    if (shared) return this.store(shared, true);
    const ref = `${def.name}@${def.version}`;
    const stored: StoredDef = { ...def, budget: def.budget ?? { tris: 0, bytes: 0, textures: 0 }, hash, ref, by, born };
    this.defs.set('sha:' + hash, stored);
    this.defs.set(ref, stored);
    if (ref.startsWith('core-')) this.defs.set('core/' + ref.slice(5), stored);
    return stored;
  }
  /** The world's own def for a ref, else the shared library's (the world's pinned hash always wins). */
  def(ref: string): StoredDef | undefined { const k = aliasRef(ref); return this.defs.get(k) ?? this.library?.get(k); }
  /** True when the world itself stores this ref (not only the shared library). */
  owns(ref: string): boolean { return this.defs.has(aliasRef(ref)); }
  /** Active named defs, plus the library's unshadowed refs. Historical revisions remain addressable by hash. */
  allDefs(): StoredDef[] {
    const own = [...new Set([...this.defs.keys()].filter(ref => !ref.startsWith('sha:')).map(ref => this.defs.get(ref)!))];
    if (!this.library) return own;
    const refs = new Set(own.map((d) => d.ref));
    return [...own, ...this.library.all().filter((d) => !refs.has(d.ref))];
  }
  /** Copy a library def into the world's own store (pinned by hash). Returns it when it was newly adopted. */
  adopt(ref: string): StoredDef | undefined {
    this.slotMemo?.clear();
    const k = aliasRef(ref);
    if (this.defs.has(k)) return undefined;
    const d = this.library?.get(k); if (!d) return undefined;
    this.store(d); return d;
  }
  private store(d: StoredDef, takeRef = false): StoredDef {
    this.defs.set('sha:' + d.hash, d);
    if (takeRef || !this.defs.has(d.ref)) { this.defs.set(d.ref, d); if (d.ref.startsWith('core-')) this.defs.set('core/' + d.ref.slice(5), d); }
    return d;
  }
  /** Rebind a ref to content already retained by hash (trusted definition undo/redo). */
  restoreDef(ref: string, hash: string): StoredDef | undefined {
    this.slotMemo?.clear();
    const d = this.def('sha:' + hash);
    if (!d || d.ref !== ref) return undefined;
    return this.store(d, true);
  }
  /** Active bindings are separate from retained content: SQL/hash iteration order cannot choose a revision. */
  defRefs(): Record<string, string> { return Object.fromEntries([...this.defs].filter(([ref]) => !ref.startsWith('sha:')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([ref, d]) => [ref, d.hash])); }
  /** Follow `extends` to merge params defaults/components/slots. Child overrides parent field-by-field. */
  resolvedDef(ref: string, depth = 0): StoredDef | undefined {
    const d = this.def(ref);
    if (!d) return d;
    const base = d.extends && depth <= 8 ? this.resolvedDef(d.extends, depth + 1) : undefined;
    const r = base ? { ...base, ...d, params: { ...base.params, ...d.params }, state: { ...base.state, ...d.state }, components: { ...base.components, ...d.components }, slots: d.slots.length ? d.slots : base.slots, actions: d.actions.length ? d.actions : base.actions, make: d.make.kind === 'none' && base.make.kind !== 'none' ? base.make : d.make } : d;
    // a gen-made def exposes its generator's params; the def's own params override them
    if (depth === 0 && r.make.kind === 'gen') {
      const hit = r === d ? withGenParams.get(d) : undefined; if (hit) return hit;
      const gp = genParams(r.make.gen); if (!gp) return r;
      const out = { ...r, params: { ...gp, ...r.params } }; if (r === d) withGenParams.set(d, out); return out;
    }
    return r;
  }

  /** Cheap effective-content identity, memoized by ref for one unchanged definition binding set.
   * Match resolvedDef's inheritance depth and include the generator fields it adds at the root.
   * Callers discard the memo after define/restore; forks never carry a stale binding identity. */
  effectiveDefIdentity(ref: string, memo: Map<string, string>): string {
    const hit = memo.get(ref); if (hit !== undefined) return hit;
    const hashes: string[] = [];
    let d = this.def(ref), make: StoredDef['make'] | undefined;
    for (let depth = 0; d && depth <= 9; depth++) {
      hashes.push(d.hash);
      if (!make && d.make.kind !== 'none') make = d.make;
      d = d.extends ? this.def(d.extends) : undefined;
    }
    const gp = make?.kind === 'gen' ? genParams(make.gen) : undefined;
    let fields = gp && genParamIdentities.get(gp);
    if (gp && fields === undefined) { fields = hashOf(gp); genParamIdentities.set(gp, fields); }
    const identity = `${hashes.join(':')}|${fields ?? ''}`;
    memo.set(ref, identity); return identity;
  }

  // ---------- baking ----------

  bake(def: StoredDef, params: Record<string, Value>, seed: number, shape?: Entity['shape']): Baked {
    try {
    // Inherited make/slots/components can change while the child's own content hash stays fixed.
    const key = bakeKey(def.extends ? def : def.hash, params, seed, shape ?? null);
    const hit = this.bakes.get(key);
    if (hit) return hit;
    let baked: Baked;
    const m = def.make;
    if (m.kind === 'gen') {
      const g = GENERATORS[m.gen];
      if (!g) throw new Error(`generator ${m.gen} unknown`);
      // kit/2 shapes may depend on the def's own params (VOCAB-MECH `when`: variants, options): fill the def's defaults too
      baked = g.physics({ params: { ...defaultsOf(g.params), ...(m.gen === 'kit/2' ? defaultsOf(def.params as never) : {}), ...params }, args: (m.args ?? {}) as Record<string, unknown>, seed, shape: shape as never });
    } else if (m.kind === 'mesh') {
      // the def states the size (the viewer fits the model to it); a footprint sidecar gives walls, rooms, openings, links
      const info = this.assets(m.asset), fp = m.footprint ? this.assets(m.footprint)?.baked : undefined;
      const box = def.size.box;
      const colliders: LocalOBB[] = m.collide === 'none' ? [] : fp?.colliders.length ? fp.colliders : [{ c: [0, 0], half: [box[0] / 2, box[2] / 2], yaw: 0, y0: 0, y1: box[1] }];
      baked = { box, colliders, slots: fp?.slots ?? [], tris: info?.tris ?? 0, ...(fp ? { surfaces: fp.surfaces, openings: fp.openings, links: fp.links, rooms: fp.rooms, notes: fp.notes } : {}) };
      const extracted = meshFloors(m.asset, box, fp?.surfaces);
      if (extracted.length) baked.surfaces = [...(baked.surfaces ?? []), ...extracted];
      const links = meshFloorLinks(m.asset, box, fp?.links);
      if (links.length) baked.links = [...(baked.links ?? []), ...links];
    } else if (m.kind === 'parts') {
      // Physics of a prefab = union of its parts' boxes (parts are placed as their own entities at expansion time).
      baked = { box: def.size.box, colliders: [], slots: [], tris: 0 };
    } else {
      baked = { box: def.size.box, colliders: [], slots: [], tris: 0 };
    }
    // Def-declared slots and components win over generator output.
    if (def.slots.length) baked = { ...baked, slots: m.kind === 'gen' && m.gen === 'kit/2' && m.args?.footprint ? mergeKitSlots(baked.slots, def.slots) : def.slots }; // XP5: retain room frames beside authored seats.
    if (def.components.landform) baked = { ...baked, landform: def.components.landform };
    if (def.components.water) baked = { ...baked, water: def.components.water };
    // VOCAB-MECH: the stretch convention (params sx/sy/sz, when the def declares them) scales the physics with the picture
    if (def.params.sx || def.params.sy || def.params.sz) baked = stretchBaked(baked, stretchOf(def.params, params));
    this.bakes.set(key, baked);
    return baked;
    } catch (error) {
      throw error instanceof BakeError ? error : new BakeError(def, error);
    }
  }

  // ---------- entities ----------

  nextId(): string { this.seq++; return 'e_' + hashOf(`${this.seed}:${this.seq}`).slice(0, 8); }
  get(idOrPath: string): Entity | undefined {
    if (this.entities.has(idOrPath)) return this.entities.get(idOrPath);
    // path: names from the world root
    let parent = 'world';
    for (const part of idOrPath.split('/')) {
      const id = this.names.get(`${parent}/${part}`);
      if (!id) return undefined;
      parent = id;
    }
    return this.entities.get(parent);
  }
  pathOf(id: string): string {
    const parts: string[] = [];
    let cur = this.entities.get(id);
    while (cur) { parts.unshift(cur.name ?? cur.id); cur = cur.in.parent === 'world' ? undefined : this.entities.get(cur.in.parent); }
    return parts.join('/');
  }
  insert(e: Entity) {
    this.slotMemo?.clear();
    this.entities.set(e.id, e);
    const set = this.children.get(e.in.parent) ?? new Set();
    set.add(e.id); this.children.set(e.in.parent, set);
    if (e.name) this.names.set(`${e.in.parent}/${e.name}`, e.id);
  }
  /** Replace public meaning only, preserving all geometry/name/slot caches. */
  replaceAbout(e: Entity) {
    const prev = this.entities.get(e.id);
    if (!prev) throw new Error('meaning target missing');
    const { about: _old, v: _v, ...before } = prev, { about: _new, v: _nv, ...after } = e;
    if (stableStringify(before) !== stableStringify(after)) throw new Error('replaceAbout cannot change structure');
    const key = this.safetyCacheKey();
    this.entities.set(e.id, e);
    const parts = this.safetyParts(); if (parts) this.safetyKey = { parts, key };
  }
  /** PC12 (#691): replace a part's joint halves only, preserving every geometry, name, slot and safety index (joints never
   *  move anything: `connect` only joins connectors that already meet). */
  replaceJoins(e: Entity) {
    const prev = this.entities.get(e.id);
    if (!prev) throw new Error('joint target missing');
    const { joins: _old, v: _v, ...before } = prev, { joins: _new, v: _nv, ...after } = e;
    if (stableStringify(before) !== stableStringify(after)) throw new Error('replaceJoins cannot change structure');
    const key = this.safetyCacheKey();
    this.entities.set(e.id, e);
    const parts = this.safetyParts(); if (parts) this.safetyKey = { parts, key };
  }
  delete(id: string) {
    this.slotMemo?.clear();
    const e = this.entities.get(id); if (!e) return;
    this.entities.delete(id);
    this.children.get(e.in.parent)?.delete(id);
    if (e.name) this.names.delete(`${e.in.parent}/${e.name}`);
    this.unindex(id);
  }
  subtree(id: string): string[] {
    const out: string[] = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.children.get(out[i]) ?? []) out.push(c);
    return out;
  }
  ancestors(id: string): Set<string> {
    const out = new Set<string>();
    let cur = this.entities.get(id);
    while (cur && cur.in.parent !== 'world') { out.add(cur.in.parent); cur = this.entities.get(cur.in.parent); }
    return out;
  }

  /** World-frame pose of an entity: walks up the parent chain, composing yaw and translation (slots add their frame). */
  worldPose(e: Entity): { x: number; y: number; z: number; yaw: number; s: number } {
    const local = this.localPose(e);
    if (e.in.parent === 'world') return local;
    const parent = this.entities.get(e.in.parent);
    if (!parent) return local;
    const pp = this.worldPose(parent);
    let sx = 0, sy = 0, sz = 0, syaw = 0;
    if (e.in.slot) {
      const slot = this.slotsOf(parent).find((s) => s.id === e.in.slot);
      if (slot) { sx = slot.p[0]; sy = slot.p[1]; sz = slot.p[2]; syaw = slot.yaw; }
    }
    const c = Math.cos(pp.yaw), s = Math.sin(pp.yaw);
    const lx = (sx + local.x) * pp.s, lz = (sz + local.z) * pp.s;
    return { x: pp.x + lx * c + lz * s, y: pp.y + (sy + local.y) * pp.s, z: pp.z - lx * s + lz * c, yaw: pp.yaw + syaw + local.yaw, s: pp.s * local.s };
  }
  localPose(e: Entity) {
    const p = e.p ?? [0, 0];
    const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
    return { x: p[0], y: p.length === 3 ? p[1] : 0, z: p.length === 3 ? p[2] : p[1], yaw, s: e.s ?? 1 };
  }
  slotsOf(e: Entity): Baked['slots'] {
    const memo = this.slotMemo, hit = memo?.get(e); if (hit) return hit;
    const def = this.resolvedDef(e.def);
    const slots = def ? this.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).slots : [];
    memo?.set(e, slots);
    return slots;
  }
  /** Runs `fn` with slotsOf remembered per entity object (a slotted child's pose otherwise re-keys its parent's whole bake,
   *  ~456 chars of params, once per child). For passes that only read the model: a bake is a pure function of the def,
   *  params, seed and shape, so the answer is the same; insert/delete/def changes drop the memo. Nested passes share it. */
  readPass<T>(fn: () => T): T {
    if (this.slotMemo) return fn();
    this.slotMemo = new Map();
    try { return fn(); } finally { this.slotMemo = null; }
  }
  /** World-frame footprint boxes of an entity (its def's colliders transformed by its world pose). */
  footprint(e: Entity, def = this.resolvedDef(e.def)): OBB[] {
    if (!def) return [];
    const baked = this.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
    if (def.form !== 'point' && e.in.parent === 'world') {
      // world-frame shapes (L3): collider heights are ground-relative at their centre unless `abs`
      return baked.colliders.map((o) => { const y = (o as typeof o & { abs?: boolean }).abs ? 0 : this.terrain.sample(o.c[0], o.c[1]); return { c: [o.c[0], o.c[1]] as [number, number], half: [o.half[0], o.half[1]] as [number, number], yaw: o.yaw, y0: y + o.y0, y1: y + o.y1 }; });
    }
    const wp = this.worldPose(e);
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    return baked.colliders.map((o) => ({
      c: [wp.x + (o.c[0] * c + o.c[1] * s) * wp.s, wp.z + (-o.c[0] * s + o.c[1] * c) * wp.s],
      half: [o.half[0] * wp.s, o.half[1] * wp.s], yaw: wp.yaw + o.yaw, y0: wp.y + o.y0 * wp.s, y1: wp.y + o.y1 * wp.s,
    }));
  }

  // ---------- spatial index (solid footprints) ----------

  private cellKeys(o: OBB): string[] {
    const r = Math.sqrt(o.half[0] ** 2 + o.half[1] ** 2);
    const size = CREATION_LIMITS.regionSizeM;
    const x0 = Math.floor((o.c[0] - r) / size), x1 = Math.floor((o.c[0] + r) / size), z0 = Math.floor((o.c[1] - r) / size), z1 = Math.floor((o.c[1] + r) / size);
    const out: string[] = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(`${x},${z}`);
    return out;
  }
  index(id: string, boxes: OBB[]) {
    this.ensureIndex();
    this.unindex(id);
    this.footprints.set(id, boxes);
    for (const b of boxes) for (const k of this.cellKeys(b)) { const s = this.cells.get(k) ?? new Set(); s.add(id); this.cells.set(k, s); }
  }
  unindex(id: string) {
    this.ensureIndex();
    const boxes = this.footprints.get(id); if (!boxes) return;
    for (const b of boxes) for (const k of this.cellKeys(b)) this.cells.get(k)?.delete(id);
    this.footprints.delete(id);
  }
  /** Ids whose indexed footprints might touch any of `boxes`. */
  near(boxes: OBB[]): Set<string> {
    this.ensureIndex();
    const out = new Set<string>();
    for (const b of boxes) for (const k of this.cellKeys(b)) for (const id of this.cells.get(k) ?? []) out.add(id);
    return out;
  }
  footprintsOf(id: string): OBB[] { this.ensureIndex(); return this.footprints.get(id) ?? []; }
  /** Same conservative cells as collision lookup; count each solid entity once per cell. */
  solidRegionCounts(): Map<string, number> { this.ensureIndex(); return new Map([...this.cells].filter(([, ids]) => ids.size).map(([cell, ids]) => [cell, ids.size])); }
  solidRegionCount(cell: string): number { this.ensureIndex(); return this.cells.get(cell)?.size ?? 0; }
  /** Only cells touched by a diff's old/new indexed footprints need density checks. */
  solidRegionsOf(ids: Iterable<string>): Set<string> {
    const cells = new Set<string>();
    for (const id of ids) for (const box of this.footprintsOf(id)) for (const cell of this.cellKeys(box)) cells.add(cell);
    return cells;
  }

  // ---------- ground ----------

  ground(): Ground { return this.terrain.ground; }
  setLandform(l: Landform | null, id: string): Landform[] {
    const g = this.terrain.ground;
    const prev = g.landforms.find((x) => x.id === id);
    const landforms = g.landforms.filter((x) => x.id !== id);
    if (l) landforms.push(l);
    const changed = [prev, l].filter((x): x is Landform => !!x);
    this.terrain.update({ ...g, landforms }, changed);
    return changed;
  }
  setWater(w: Water | null, id: string) {
    const g = this.terrain.ground;
    const waters = g.waters.filter((x) => x.id !== id);
    if (w) waters.push(w);
    this.terrain.update({ ...g, waters }, []);
  }

  /** Cheap scratch copy for planning: structural maps copied, immutable caches (bakes, tiles) shared. */
  fork(): WorldModel {
    this.ensureIndex();
    const w = Object.create(WorldModel.prototype) as WorldModel;
    const self = this as unknown as Record<string, unknown>, out = w as unknown as Record<string, unknown>;
    w.constants = this.constants; w.state = this.state; w.seed = this.seed; w.seq = this.seq; w.editSeq = this.editSeq; w.assets = this.assets; w.library = this.library;
    w.defs = new ModelMap(this.defs, true); w.entities = new ModelMap(this.entities); w.names = new Map(this.names);
    w.children = new Map([...this.children].map(([k, v]) => [k, new Set(v)]));
    out.bakes = self.bakes;  // keyed by content hash: safe to share
    out.cells = new Map([...(self.cells as Map<string, Set<string>>)].map(([k, v]) => [k, new Set(v)]));
    out.footprints = new Map(self.footprints as Map<string, unknown>);
    w.terrain = this.terrain.clone();
    // GodMode forks before calling plan (which forks again). Preserve the exact copied state's
    // warm totals/entrance index; each fork's own Map revisions invalidate it independently.
    if (this.safetyParts()) w.safetyKey = {parts: w.safetyParts()!, key: this.safetyCacheKey()};
    return w;
  }

  snapshot() {
    return {
      constants: this.constants, state: this.state, seed: this.seed, seq: this.seq, editSeq: this.editSeq,
      // Active content last for older snapshot consumers that reconstruct ref bindings from this array.
      defs: [...new Set(this.defs.values())].sort((a, b) => a.ref === b.ref
        ? Number(this.def(a.ref) === a) - Number(this.def(b.ref) === b) || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
        : a.ref < b.ref ? -1 : 1),
      defRefs: this.defRefs(), entities: [...this.entities.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), ground: this.terrain.ground,
    };
  }
  static fromSnapshot(s: Omit<ReturnType<WorldModel['snapshot']>, 'defRefs'> & { defRefs?: Record<string, string> }, assets?: AssetLookup, library?: DefLibrary | null, opts?: { lazyIndex?: boolean }): WorldModel {
    const w = new WorldModel({ constants: s.constants, seed: s.seed, state: s.state, assets });
    w.library = library ?? null;
    w.seq = s.seq; w.editSeq = s.editSeq;
    // W1: an explicit ref map is authoritative, including retired refs absent from it.
    for (const d of s.defs) { w.defs.set('sha:' + d.hash, d); if (s.defRefs === undefined) { w.defs.set(d.ref, d); if (d.ref.startsWith('core-')) w.defs.set('core/' + d.ref.slice(5), d); } }
    for (const [ref, hash] of Object.entries(s.defRefs ?? {})) { const d = w.def('sha:' + hash); if (d) w.defs.set(ref, d); }
    w.terrain = new Terrain(s.ground);
    for (const e of s.entities) w.insert(e);
    const indexAll = (list: Iterable<Entity>) => w.readPass(() => { for (const e of list) { const def = w.resolvedDef(e.def); if (def && def.layer === 'solid') w.index(e.id, w.footprint(e, def)); } });
    if (opts?.lazyIndex) w.pendingIndex = () => indexAll([...w.entities.values()]); else indexAll(s.entities);
    return w;
  }
}

/** 2-D separating-axis test for two yawed rectangles plus a vertical-interval test. */
export function obbOverlap(a: OBB, b: OBB): boolean {
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return false;
  // Keep the original four-corner SAT arithmetic and read order. Flat local arrays avoid
  // the temporary pairs/map/destructuring allocations without caching mutable OBB inputs.
  const axes = [Math.cos(a.yaw), -Math.sin(a.yaw), Math.sin(a.yaw), Math.cos(a.yaw), Math.cos(b.yaw), -Math.sin(b.yaw), Math.sin(b.yaw), Math.cos(b.yaw)];
  const corners = (o: OBB) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return [
      o.c[0] + -1 * o.half[0] * c + -1 * o.half[1] * s, o.c[1] - -1 * o.half[0] * s + -1 * o.half[1] * c,
      o.c[0] + 1 * o.half[0] * c + -1 * o.half[1] * s, o.c[1] - 1 * o.half[0] * s + -1 * o.half[1] * c,
      o.c[0] + 1 * o.half[0] * c + 1 * o.half[1] * s, o.c[1] - 1 * o.half[0] * s + 1 * o.half[1] * c,
      o.c[0] + -1 * o.half[0] * c + 1 * o.half[1] * s, o.c[1] - -1 * o.half[0] * s + 1 * o.half[1] * c,
    ];
  };
  const ca = corners(a), cb = corners(b);
  for (let k = 0; k < axes.length; k += 2) {
    const ax = axes[k], az = axes[k + 1];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < ca.length; i += 2) { const p = ca[i] * ax + ca[i + 1] * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (let i = 0; i < cb.length; i += 2) { const p = cb[i] * ax + cb[i + 1] * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}

/** Generator param defaults (a def's own params already merged into the instance by the compiler). */
function defaultsOf(fields: Record<string, { default?: unknown }>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, f] of Object.entries(fields)) if (f.default !== undefined) out[k] = f.default as Value;
  return out;
}

const withGenParams = new WeakMap<StoredDef, StoredDef>();
const genParamsCache = new Map<string, StoredDef['params'] | null>();
const genParamIdentities = new WeakMap<StoredDef['params'], string>();
/** A generator's params parsed as def fields (defaults filled), cached per generator id. */
function genParams(gen: string): StoredDef['params'] | undefined {
  if (!genParamsCache.has(gen)) {
    const g = GENERATORS[gen]; let out: StoredDef['params'] | null = null;
    if (g?.params && Object.keys(g.params).length) { out = {}; for (const [k, f] of Object.entries(g.params)) { const parsed = fieldSchema.safeParse(f); if (parsed.success) out[k] = parsed.data as StoredDef['params'][string]; } }
    genParamsCache.set(gen, out);
  }
  return genParamsCache.get(gen) ?? undefined;
}

