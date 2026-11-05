// Places on a god's world (R4-INFO, Soul-information parity). On Eden a Soul's agent reads a map of named, walkable
// places with centres, kinds, capacities and descriptions; `here` names the place it stands in and the exits to the
// places around it; `observe` lists the things in its place. On a world the god builds, the same layer is derived from
// what the god built, and re-derived whenever the god edits (the agent's next `map`/`here`/`observe` shows the change):
//
//  - an area the god laid out (a plaza, a lawn, a garden, an orchard) is an outdoor place, its outline the area's;
//  - a pond or a lake is a water place;
//  - a building is a place (its rooms' outline, a little out for the walls) and each room a place inside it,
//    enclosed (privacy and earshot as Eden's rooms) unless the building is open-sided (a pavilion), its capacity the seats in it;
//  - a big named thing standing on its own (a fountain, a gazebo, a statue, an old oak) is a landmark place around it,
//    so "where" says "fountain" and not only "Green field";
//  - each has a short description of what is in it: "a plaza with a fountain, two benches, a lamp-post and a sign".
//
// Ids are `g-<path>` (`g-plaza`, `g-moss-cottage.living`); names are the god's names (`plaza`, `moss-cottage/living`), so
// the `walk:<path>` capabilities (nav.ts) carry them as their target place and every place answers to its walk.
// They join the ledger's own places layer (the PlaceIndex), so the ledger's map, place paths, arrivals, exits,
// "elsewhere" invitations and plain-words resolution work on them unchanged; the ledger's `placeWalkable` hook (unset on
// Eden/Mars/LM) says they are walkable although they are not native engine regions. Pure reads of the entity model.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { decorateMeaning, displayName, humanTitle, kindWords } from './meaning.ts';
import type { Place } from '../edge/ledger/places.ts';
import type { GodNav, Thing } from './nav.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
export type GodPlace = Place & { ref: string; of: 'area' | 'water' | 'shore' | 'building' | 'room' | 'thing' | 'landmark' | 'landform' | 'land'; entity: string };
type StructureStamp = { model: object | undefined; revision: number | string | undefined };
const sortPlaces = (list: GodPlace[]) => list.sort((a, b) => (a.id < b.id ? -1 : 1));
function placeIndex(list: GodPlace[]) {
  const byRef = new Map<string, GodPlace>(), byEntity = new Map<string, GodPlace>();
  // A water's walk targets its shore; preserve the full index's duplicate-ref precedence.
  for (const p of list) { if (p.of === 'water' && byRef.has(p.ref)) continue; byRef.set(p.ref, p); if (p.of !== 'room' && p.of !== 'shore') byEntity.set(p.entity, p); }
  return { list, byRef, byEntity };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const SHORE = 3;                   // m: a water's bank, round it
const LANDMARK_MIN = 1.5;          // a named point thing at least this wide (m) standing on its own is a landmark
const NOT_LANDMARKS = /^(sign|signpost|notice-board|lamp-post|lantern|flagpole|bollard|bin|wheelie-bin|mailbox|hydrant|crate|barrel|sack|flower-pot|poster|banner|picture-frame|screen|chalkboard|power-line|poster-wall|wanted-board)$/;   // entry 38: boards stay things, as notice-board does
const WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '').replace(/-pack$/, '');
// F8 (#958): a kind as a Soul reads it ("a long table", never "a long-table" or "a mars-tier-2")
const article = (w: string) => { const k = kindWords(w); return /^[aeiou]/.test(k) ? `an ${k}` : `a ${k}`; };
function plural(w: string) { return /(s|sh|ch|x|z)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`; }
function counted(kind: string, n: number) { return n === 1 ? article(kind) : `${WORDS[n] ?? n} ${plural(kindWords(kind))}`; }
function listed(parts: string[]) { return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`; }
export function inPoly(x: number, z: number, poly: Vec2[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
const areaOf = (p: Vec2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];
function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [], hi: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
/** The kind a def's `place` component gives (plaza, pitch, garden …). */
function placeKind(m: WorldModel, id: string): string | undefined { const e = m.entities.get(id), k = e ? (m.resolvedDef(e.def)?.components as Record<string, any> | undefined)?.place?.kind : undefined; return typeof k === 'string' && k ? k : undefined; }
/** Whether a building's rooms are enclosed (privacy, earshot, sight as Eden's rooms). Decided by geometry, not by the
 *  def's `place.enclosed` (the def schema defaults a missing value to false, so a walled cafe would read open): only a
 *  building/1 pavilion is open, as its plan is a roof on posts with no walls (building-plan.ts pavilionPlan), and only
 *  while no explicit `plan` param replaces that layout. Every other room is enclosed. */
function roomsEnclosed(m: WorldModel, id: string): boolean {
  const e = m.entities.get(id), def = e ? m.resolvedDef(e.def) : undefined; if (!e || !def) return true;
  const make = def.make as { kind?: string; gen?: string; args?: Record<string, unknown> } | undefined;
  if (make?.kind !== 'gen' || make.gen !== 'building/1') return true;
  const params = { ...Object.fromEntries(Object.entries((def.params ?? {}) as Record<string, { default?: unknown }>).map(([k, p]) => [k, p?.default])), ...(e.params ?? {}) } as Record<string, unknown>;
  const plan = params.plan as { floors?: unknown } | null | undefined;
  return (make.args?.style ?? params.style) !== 'pavilion' || (!!plan && typeof plan === 'object' && Array.isArray(plan.floors));
}
/** A polygon pushed out from its centroid by `d` metres (walls round a building's rooms). */
function grow(poly: Vec2[], d: number): Vec2[] { const [cx, cz] = centroid(poly); return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, n = Math.hypot(dx, dz) || 1; return [r2(x + (dx / n) * d), r2(z + (dz / n) * d)] as Vec2; }); }
function circle(c: Vec2, r: number, n = 12): Vec2[] { return Array.from({ length: n }, (_, i) => [r2(c[0] + Math.cos((i / n) * Math.PI * 2) * r), r2(c[1] + Math.sin((i / n) * Math.PI * 2) * r)] as Vec2); }
/** The outline of a band `half` metres either side of a polyline (a pier's deck). */
function band(path: Vec2[], half: number): Vec2[] {
  const L: Vec2[] = [], R: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1, nx = -dz / n, nz = dx / n;
    L.push([r2(path[i][0] + nx * half), r2(path[i][1] + nz * half)]); R.push([r2(path[i][0] - nx * half), r2(path[i][1] - nz * half)]);
  }
  return [...L, ...R.reverse()];
}
/** Per-derive facts about one entity, computed once and shared by every place's description and seat count
 *  (Eden 2026: ~1.5k places x 3.6k entities re-baked per place made one derive take seconds). */
type Fact = { e: Entity; def: StoredDef | undefined; x: number; z: number; s: number; seatSkip: boolean; describeSkip: boolean; building: string | null; seats?: number; w?: number };
type Box = [number, number, number, number];
const boxOf = (poly: Vec2[]): Box => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, z0, x1, z1]; };
const inBoxPoly = (x: number, z: number, b: Box, poly: Vec2[]) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inPoly(x, z, poly);
/** Facts by a 16 m grid of their positions, so a place reads only the facts near it; candidates come back in fact (= the
 *  model's entity) order, so every count, first-seen size and seat sum is the same as scanning all of them. */
const CELL = 16, factGrids = new WeakMap<Fact[], Map<number, number[]>>();
const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
function factsNear(facts: Fact[], b: Box): Fact[] {
  if (!(Number.isFinite(b[0]) && Number.isFinite(b[1]) && Number.isFinite(b[2]) && Number.isFinite(b[3]))) return [];
  const cx0 = Math.floor(b[0] / CELL), cz0 = Math.floor(b[1] / CELL), cx1 = Math.floor(b[2] / CELL), cz1 = Math.floor(b[3] / CELL);
  if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > facts.length / 4 || Math.max(-cx0, -cz0, cx1, cz1) >= 32768) return facts;
  let grid = factGrids.get(facts);
  if (!grid) {
    factGrids.set(facts, grid = new Map());
    facts.forEach((f, i) => { if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) return; const k = cellKey(Math.floor(f.x / CELL), Math.floor(f.z / CELL)), a = grid!.get(k); if (a) a.push(i); else grid!.set(k, [i]); });
  }
  const idx: number[] = []; let lists = 0;
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) { const a = grid.get(cellKey(cx, cz)); if (a) { for (const i of a) idx.push(i); lists++; } }
  if (lists > 1) idx.sort((x, y) => x - y);
  return idx.map((i) => facts[i]);
}
function across(poly: Vec2[]) { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]; }

export type PlacesHost = {
  model: WorldModel;
  nav: GodNav;
  edge?: EdgeLedger;
  version?: () => number | string;
  /** Authored meaning/geometry revision only; excludes transient engine writebacks and the clock. */
  publicationVersion?: () => number | string;
  /** Includes every model/terrain/state edit and navigation level change, without the description clock. Unset: no membership memo reuse. */
  structuralVersion?: () => number | string;
  /** G1: true while the host is catching up with god edits (reads may take the places as they were). */
  deferred?: () => boolean;
  engineOwned(e: Entity): boolean;
  levelAt(x: number, z: number, y: number): number;
  log(m: string): void;
  /** B-facade: a read worker derives the places (ofEntity / placeAt) but never installs them: its ledger's index is main's,
   *  shipped whole with the delta (a worker that installed its own would run ahead of main while main catches up). */
  readOnly?: boolean;
  /** LAYERS: schedules (today's slots), ownership and who works/lives there, in each place (layers.ts). */
  layers?: { active(): boolean; dayKey(): string; slotsFor(e: Entity, label: string): NonNullable<Place['schedule']>; tag(e: Entity): string; peopleAt(id: string): string; onNow?(e: Entity): string };
};

/** What is where on a god's world, as the ledger's places. */
export class GodPlaces {
  private h: PlacesHost;
  private cache: { key: string; publicationVersion?: number | string; list: GodPlace[]; byRef: Map<string, GodPlace>; byEntity: Map<string, GodPlace> } | null = null;
  private facts: Fact[] | null = null;
  /** Ids of the places this layer put in the ledger's index (and only those: a boot place keeps its own). */
  private installed = new Set<string>();
  private published = false;
  constructor(h: PlacesHost) { this.h = h; }

  /** A non-deriving readiness read; the provisional ledger index has no god-built rooms. */
  hasPublished(): boolean { return this.published; }
  private publishedVersion: number | string | undefined;
  /** Nonderiving: the ledger, not just an intermediate cache, published the current authored revision. */
  hasCurrentPublication(): boolean {
    return this.published && (!this.h.publicationVersion || this.publishedVersion === this.h.publicationVersion());
  }

  publicationState() {
    return { published: this.published, current: this.hasCurrentPublication(), revision: this.h.publicationVersion?.(),
      publishedRevision: this.publishedVersion, deriving: !!this.gen, derivingRevision: this.gen?.publicationVersion };
  }

  static idOf(ref: string) { return `g-${ref.toLowerCase().replace(/\//g, '.').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '')}`.slice(0, 100); }
  /** The place a nav thing is (its walk targets it), if it is one. */
  forRef(ref: string): GodPlace | undefined { return this.index().byRef.get(ref); }
  list(fresh = false): GodPlace[] { return this.index(fresh).list; }
  /** The place a god thing itself is (a plaza, a house, a gazebo, a lone fountain): its objects stand in it. */
  ofEntity(id: string): GodPlace | undefined { return this.index().byEntity.get(id); }
  private calendarIdentityCache?: { model: object; revision: number; structuralVersion: number | string | undefined; index: object | null; meaning: Map<string, Entity['about']>; own: Map<string, { id: string; name: string } | null> };
  /** Undecorated, privately owned geometry. Neither public places nor navigation Things alias this memo. */
  private membership?: { stamp: StructureStamp; list: GodPlace[] };
  /** Calendar creation needs stable own-place identities, not minute-dependent descriptions. Prime every scheduled
   *  source together so a later event entering the horizon does not trigger another full description derive. The
   *  bridge revision covers terrain/state commits; the index identity also invalidates after a deferred install.
   *  Misses are explicit: callers must resolve containment and native ledger names live. Ordinary reads stay fresh. */
  calendarIdentities(sources: readonly Entity[], revision: number): ReadonlyMap<string, { id: string; name: string } | null> {
    const model = this.h.model.safetyCacheKey(), structuralVersion = this.h.structuralVersion?.(), cached = this.calendarIdentityCache;
    if (cached?.model === model && cached.revision === revision && cached.structuralVersion === structuralVersion && cached.index === this.cache && sources.length === cached.own.size && sources.every(e => cached.own.has(e.id) && cached.meaning.get(e.id) === e.about)) return cached.own;
    // Preserve installed/deferred reads. A cold lookup only needs membership, not descriptions or today's slots.
    const index = this.cache && (this.h.deferred?.() || this.cache.key === this.key()) ? this.cache
      : placeIndex(sortPlaces([...drain(this.membershipGen())]));
    const own = new Map<string, { id: string; name: string } | null>();
    for (const e of sources) { const p = index.byEntity.get(e.id); own.set(e.id, p ? { id: p.id, name: e.about?.title ?? humanTitle(p.ref) } : null); }
    this.calendarIdentityCache = { model, revision, structuralVersion, index: this.cache, meaning: new Map(sources.map(e => [e.id,e.about])), own };
    return own;
  }
  /** Walkable (the ledger's hook): every place this layer made. */
  walkable(id: string): boolean { return this.installed.has(id); }

  private key() { const m = this.h.model; return `${this.h.version?.() ?? m.editSeq}:${m.entities.size}${this.h.layers?.active() ? `:${this.h.layers.dayKey()}` : ''}`; }
  /** G1 (tranche 2026-10-19): while the host is catching up with god edits (`deferred`), a read takes the places as they
   *  were (≤ ~2 s old) and the host re-derives them in slices (`syncStep`); `fresh` (or no host deferral) derives now. */
  private index(fresh = false) {
    if (this.cache && !fresh && this.h.deferred?.()) return this.cache;
    const key = this.key();
    if (this.cache?.key === key) return this.cache;
    this.gen = null;
    const publicationVersion = this.h.publicationVersion?.();
    return this.install(key, this.derive(), publicationVersion);
  }
  /** Derives done (all at once or sliced): tests check edits re-derive and engine writebacks do not. */
  readonly stats = { derives: 0, memberships: 0 };
  private derive(): GodPlace[] { this.stats.derives++; return drain(this.deriveGen()); }
  private install(key: string, list: GodPlace[], publicationVersion?: number | string) {
    this.cache = { key, publicationVersion, ...placeIndex(list) };
    return this.cache;
  }
  private gen: { key: string; publicationVersion?: number | string; it: Generator<void, GodPlace[], void> } | null = null;
  private structure(): StructureStamp {
    const model = this.h.model.safetyCacheKey();
    // Untracked replacement Maps deliberately return a new key on every read: never memoize those inputs.
    return { model: model === this.h.model.safetyCacheKey() ? model : undefined, revision: this.h.structuralVersion?.() };
  }
  private sameStructure(a: StructureStamp, b: StructureStamp) { return a.model === b.model && a.revision === b.revision; }
  /** The index key last put in the ledger (an engine-only edit leaves it: nothing to install again). */
  private installedKey: string | undefined;
  /** Re-derive the places in slices of about `budgetMs`, then put them in the ledger's index. True when done. An edit
   *  landing mid-way is picked up by the next call (the host notes every edit). */
  syncStep(budgetMs: number): boolean {
    if (!this.h.edge?.places) return true;
    if (this.gen && this.gen.publicationVersion !== this.h.publicationVersion?.()) this.gen = null;
    if (!this.gen) { const key = this.key(); if (this.cache?.key === key) { if (this.installedKey !== key) this.sync(); return true; } this.gen = { key, publicationVersion: this.h.publicationVersion?.(), it: this.deriveGen() }; this.stats.derives++; }
    const t0 = performance.now();
    try {
      for (;;) {
        const r = this.gen.it.next();
        if (r.done) {
          if (this.gen.publicationVersion !== this.h.publicationVersion?.()) { this.gen = null; return false; }
          this.install(this.gen.key, r.value, this.gen.publicationVersion); this.gen = null; this.sync(); return true;
        }
        if (performance.now() - t0 >= budgetMs) return false;
      }
    } catch (error) {
      // A throwing generator is closed. Retrying it would return undefined instead
      // of a complete place list; retain the installed index and start anew later.
      this.gen = null;
      throw error;
    }
  }

  private *membershipGen(things?: Thing[], stamp = this.structure()): Generator<void, GodPlace[], void> {
    const memo = this.membership;
    // A full derive may already have yielded while acquiring Things: include that entire range in provenance.
    if (stamp.model && stamp.revision !== undefined && memo && this.sameStructure(memo.stamp, stamp) && this.sameStructure(stamp, this.structure())) return memo.list;
    this.membership = undefined;
    this.stats.memberships++;
    const list = yield* this.buildMembershipGen(things);
    if (stamp.model && stamp.revision !== undefined && this.sameStructure(stamp, this.structure())) this.membership = { stamp, list };
    return list;
  }

  private *buildMembershipGen(things?: Thing[]): Generator<void, GodPlace[], void> {
    const m = this.h.model;
    things ??= this.h.nav.thingsGen ? yield* this.h.nav.thingsGen() : this.h.nav.things();
    things = things.filter(t => !t.semanticPart);
    let n = 0;
    const out: GodPlace[] = [];
    const base = { parent: null as string | null, enclosed: false, capacity: null as number | null, starting: false };
    const firstByRef = new Map<string, GodPlace>(), push = (p: GodPlace) => { out.push(p); if (!firstByRef.has(p.ref)) firstByRef.set(p.ref, p); };
    for (const t of things) {
      if (++n % 48 === 0) yield;
      if (t.kind === 'area' && t.area && t.area.length >= 3) push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'area', entity: t.id, name: t.ref, kind: placeKind(m, t.id) ?? 'outdoor', polygon: t.area.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 });
      else if (t.kind === 'water' && t.area && t.area.length >= 3) push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'water', entity: t.id, name: t.ref, kind: 'water', polygon: t.area.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 });
      else if (t.kind === 'room' && t.poly && t.poly.length >= 3) push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'room', entity: t.id, name: t.ref, kind: 'room', enclosed: roomsEnclosed(m, t.id), polygon: t.poly.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: t.level });
    }
    // GOD-ENV: the god's landforms are places Souls can name and climb: a mountain or hill (round its top), a range, a
    // valley, a ditch or a cliff (a band along it), a plateau or a terrace (its area: already an area place, renamed)
    for (const t of things) {
      if (++n % 48 === 0) yield;
      const e = m.entities.get(t.id); if (!e || e.in.parent !== 'world') continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      let lf: any; try { lf = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).landform; } catch { continue; }
      if (!lf || lf.kind === 'brush') continue;
      const kind = shortDef(def), have = firstByRef.get(t.ref);
      if (have) { if (have.of === 'area') { have.of = 'landform'; have.kind = kind; } continue; }
      let poly: Vec2[] | null = null;
      if (lf.kind === 'bump') poly = circle(t.at, Math.max(6, Number(lf.r ?? 20) * m.worldPose(e).s * 0.5));
      else if (t.path?.length) poly = band(t.path, Math.max(2, (lf.kind === 'channel' ? Number(lf.w ?? 2) + Number(lf.edge ?? 2) / 2 : lf.kind === 'cliff' ? Number(lf.face ?? 3) + 2 : Number(lf.w ?? t.width ?? 10) / 2)));
      if (!poly || poly.length < 3) continue;
      push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'landform', entity: t.id, name: t.ref, kind, polygon: poly, level: 0 });
    }
    // GOD-ENV: land the god added beyond the world's first square (extend east/west/north/south): a place per side
    { const half = m.constants.extent / 2, [x0, z0, x1, z1] = m.ground().extent, sides: [string, Vec2[]][] = [];
      if (x1 > half + 1) sides.push(['east', [[half, z0], [x1, z0], [x1, z1], [half, z1]]]);
      if (x0 < -half - 1) sides.push(['west', [[x0, z0], [-half, z0], [-half, z1], [x0, z1]]]);
      if (z0 < -half - 1) sides.push(['north', [[Math.max(x0, -half), z0], [Math.min(x1, half), z0], [Math.min(x1, half), -half], [Math.max(x0, -half), -half]]]);
      if (z1 > half + 1) sides.push(['south', [[Math.max(x0, -half), half], [Math.min(x1, half), half], [Math.min(x1, half), z1], [Math.max(x0, -half), z1]]]);
      for (const [side, polygon] of sides) push({ ...base, id: `g-new-land-${side}`, ref: `new-land-${side}`, of: 'land', entity: `world:${side}`, name: `new land to the ${side}`, kind: 'land', polygon: polygon.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 }); }
    // a water's shore: a band round it (where its walk ends, and where a swim starts), as Eden's bank by its pond
    for (const w of out.filter((p) => p.of === 'water')) push({ ...base, id: `${w.id}.shore-bank`.slice(0, 100), ref: w.ref, of: 'shore', entity: w.entity, name: `${w.ref} shore`, kind: 'shore', polygon: grow(w.polygon, SHORE), level: 0 });
    // buildings: round their ground-floor rooms (a little out, for the walls)
    for (const t of things) {
      if (++n % 48 === 0) yield;
      if (t.kind !== 'building') continue;
      const rooms = out.filter((p) => p.of === 'room' && p.entity === t.id && p.level === t.level);
      const pts = rooms.flatMap((p) => p.polygon); if (pts.length < 3) continue;
      const poly = grow(hull(pts), 0.4); if (poly.length < 3) continue;
      push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'building', entity: t.id, name: t.ref, kind: 'building', polygon: poly, level: t.level });
    }
    // things whose def says they are a place (a gazebo, a pergola, a pavilion, a dome; a pier's deck): their footprint
    for (const t of things) {
      if (++n % 48 === 0) yield;
      if ((t.kind !== 'thing' && t.kind !== 'seat' && t.kind !== 'path') || firstByRef.has(t.ref)) continue;
      const e = m.entities.get(t.id), def = e ? m.resolvedDef(e.def) : undefined, pc = (def?.components as Record<string, any> | undefined)?.place;
      if (!e || !def || !pc) continue;
      let poly: Vec2[] | null = null;
      try {
        if (t.kind === 'path' && t.path?.length) poly = band(t.path, (t.width ?? 2) / 2 + 0.3);
        else { const b = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box, wp = m.worldPose(e), c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw), hw = b[0] / 2 + 0.8, hd = b[2] / 2 + 0.8;
          poly = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([x, z]) => [r2(wp.x + (x * c + z * sn) * wp.s), r2(wp.z + (-x * sn + z * c) * wp.s)] as Vec2); }
      } catch { continue; }
      if (!poly || poly.length < 3) continue;
      push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'thing', entity: t.id, name: t.ref, kind: String(pc.kind ?? 'outdoor'), enclosed: pc.enclosed === true, capacity: Number.isInteger(pc.capacity) ? pc.capacity : null, polygon: poly, level: t.level });
    }
    // landmarks: big named things standing on their own (not in an area, a building, a water or another place)
    const outer = out.filter((p) => p.of !== 'room' && p.of !== 'landmark').map((p) => ({ p, box: boxOf(p.polygon) }));
    for (const t of things) {
      if (++n % 48 === 0) yield;
      if (t.kind !== 'thing' || t.level !== 0 || firstByRef.has(t.ref)) continue;
      const e = m.entities.get(t.id); if (!e || e.in.parent !== 'world') continue;
      const def = m.resolvedDef(e.def); if (!def || def.tags.includes('local-fixture') || NOT_LANDMARKS.test(shortDef(def))) continue;
      const c = def.components as Record<string, unknown>; if (c.carryable || c.seat || c.item) continue;
      let w = 0; try { const b = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box, s = m.worldPose(e).s; w = Math.max(b[0], b[2]) * s; } catch { continue; }
      if (w < LANDMARK_MIN || outer.some((o) => inBoxPoly(t.at[0], t.at[1], o.box, o.p.polygon))) continue;
      push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'landmark', entity: t.id, name: t.ref, kind: 'landmark', polygon: circle(t.at, Math.max(4, w / 2 + 3)), level: 0 });
    }
    return out;
  }

  private *deriveGen(): Generator<void, GodPlace[], void> {
    // Things carry current descriptions/door state: read them afresh, never retain them in the geometry memo.
    const stamp = this.structure();
    const things = this.h.nav.thingsGen ? yield* this.h.nav.thingsGen() : this.h.nav.things();
    const out = structuredClone(yield* this.membershipGen(things, stamp));
    let n = 0;
    // Parents and decoration read live ledger/clock facts. Full places own even their nested polygon arrays.
    // parents: the smallest bigger place (god-built or the world's own) that holds its centre; else the root
    const boot = [...(this.h.edge?.places.byId.values() ?? [])].filter((p) => !this.installed.has(p.id) && !p.carrier);
    const root = boot.find((p) => p.parent === null)?.id ?? null;
    const geo = new Map<object, { area: number; box: Box }>(), g = (q: { polygon: Vec2[] }) => { let v = geo.get(q); if (!v) geo.set(q, v = { area: areaOf(q.polygon), box: boxOf(q.polygon) }); return v; };
    const candidates = [...out.filter((q) => q.of !== 'room'), ...boot.filter((q) => q.parent !== null)].filter((q) => (q.level ?? 0) === 0);
    // the smallest holder, the first of equals in candidate order (what a stable sort by area puts first)
    const held = candidates.map((q) => ({ q, ...g(q) }));
    for (const p of out) {
      if (++n % 48 === 0) yield;
      const c = centroid(p.polygon), a = g(p).area; let best: (typeof held)[number] | null = null;
      for (const k of held) if (k.q !== p && k.area > a && (best === null || k.area < best.area) && inBoxPoly(c[0], c[1], k.box, k.q.polygon)) best = k;
      p.parent = p.of === 'room' ? (out.find((q) => q.of === 'building' && q.entity === p.entity)?.id ?? best?.q.id ?? root) : best?.q.id ?? root;
    }
    const facts = yield* this.entityFactsGen(out);
    for (const p of out) {
      this.facts = facts;
      try { p.description = this.describe(p, out, things); if (p.of === 'room') { const k = this.seatsIn(p); p.capacity = k || null; } } finally { this.facts = null; }
      if (++n % 16 === 0) yield;
    }
    decorateMeaning(this.h.model, out, root);
    if (this.h.layers?.active()) this.layer(out);
    return sortPlaces(out);
  }

  /** LAYERS: a zone's kind is its use ("commercial zone"); a place's own thing adds its owner, hours and people to the
   *  description; a scheduled thing's slots for today join its place's schedule (its own place, else the one holding it). */
  private layer(out: GodPlace[]) {
    const m = this.h.model, L = this.h.layers!;
    for (const p of out) {
      const e = m.entities.get(p.entity); if (!e) continue;
      if (!e.about?.what && /^core[-/]zone@/.test(m.def(e.def)?.ref ?? e.def)) { p.kind = `${String(e.params?.use ?? 'residential')} zone`; const rest = p.description?.includes(' with ') ? p.description.split(' with ').slice(1).join(' with ') : ''; p.description = `a ${p.kind} the god drew${rest ? `, with ${rest}` : ''}`; }
      const extra = [L.tag(e), L.peopleAt(e.id)].filter(Boolean).join('; ');
      if (extra && p.of !== 'shore') p.description = `${p.description ?? ''}; ${extra}`.slice(0, 600);
    }
    for (const e of m.entities.values()) {
      if (!e.schedule) continue;
      const own = out.find((p) => p.entity === e.id && p.of !== 'shore' && p.of !== 'room');
      let p = own;
      if (!p) { const wp = m.worldPose(e); p = out.filter((q) => q.of !== 'shore' && inPoly(wp.x, wp.z, q.polygon)).sort((a, b) => areaOf(a.polygon) - areaOf(b.polygon))[0]; }
      if (!p) continue;
      // a place's own opening hours are its slots; a thing inside (a door that follows the café's hours) adds only its events
      const label = (e.name ? displayName(e) : undefined) ?? p.name, slots = L.slotsFor(e, label).filter((s) => own || !s.id.startsWith('open-')).map((s) => ({ ...s, id: own ? s.id : `${e.id}-${s.id}`.slice(0, 60) }));
      if (slots.length) p.schedule = [...(p.schedule ?? []), ...slots];
      // EVENTS: an event on now with its set up leads the description (whatson shows its first words)
      const on = L.onNow?.(e); if (on) p.description = `${on}; ${p.description ?? ''}`.replace(/; $/, '').slice(0, 600);
    }
  }

  /** Seats (seat slots of things) whose position is inside a place. */
  private seatsIn(p: GodPlace): number {
    const m = this.h.model, facts = this.facts ?? this.entityFacts([]), box = boxOf(p.polygon); let n = 0;
    for (const f of factsNear(facts, box)) {
      if (f.seatSkip || !inBoxPoly(f.x, f.z, box, p.polygon)) continue;
      if (f.seats === undefined) { try { f.seats = m.bake(f.def!, f.e.params ?? {}, f.e.seed ?? 0, f.e.shape).slots.filter((s) => s.kind === 'seat').length; } catch { f.seats = 0; /* odd def */ } }
      n += f.seats;
    }
    return n;
  }

  /** What derive's descriptions and seat counts need from each entity, once (same order as the model's entities). */
  private entityFacts(all: GodPlace[]): Fact[] { return drain(this.entityFactsGen(all)); }
  private *entityFactsGen(all: GodPlace[]): Generator<void, Fact[], void> {
    let n = 0;
    const m = this.h.model, buildings = new Set(all.filter((q) => q.of === 'building').map((q) => q.entity)), out: Fact[] = [];
    const inBuilding = (e: Entity) => { for (let cur: Entity | undefined = e; cur && cur.in.parent !== 'world'; ) { cur = m.entities.get(cur.in.parent); if (cur && buildings.has(cur.id)) return cur.id; } return null; };
    for (const e of m.entities.values()) {
      if (++n % 256 === 0) yield;
      const def = m.resolvedDef(e.def), owned = this.h.engineOwned(e), wp = m.worldPose(e);
      const c = def?.components as Record<string, unknown> | undefined, sh = e.shape as { area?: Vec2[]; path?: Vec2[] } | undefined;
      out.push({ e, def, x: wp.x, z: wp.z, s: wp.s, seatSkip: !def || !!def.components.body || owned,
        describeSkip: !def || !!c!.body || /^core[-/]flag@/.test(def.ref) || owned || (def.form !== 'point' && e.in.parent === 'world' && !!sh), building: inBuilding(e) });
    }
    return out;
  }

  /** "a plaza with a fountain, two benches, a lamp-post and a sign" (what stands in it, by kind). */
  private describe(p: GodPlace, all: GodPlace[], things: Thing[]): string {
    const m = this.h.model, own = m.entities.get(p.entity), ownDef = own ? m.resolvedDef(own.def) : undefined, kind = ownDef ? shortDef(ownDef) : p.of;
    const counts = new Map<string, number>(), sizes = new Map<string, number>(), facts = this.facts ?? this.entityFacts(all), box = boxOf(p.polygon);
    // areas, roads, waters are places or ground; bodies, flags and engine-owned things are not described (entityFacts)
    for (const f of factsNear(facts, box)) {
      const e = f.e, def = f.def!;
      if (e.id === p.entity || f.describeSkip || !inBoxPoly(f.x, f.z, box, p.polygon)) continue;
      const b = f.building;
      if (p.of === 'room' || p.of === 'building' ? b !== p.entity : b !== null) continue;  // a house's furniture is in its rooms
      const k = shortDef(def); counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!sizes.has(k)) { if (f.w === undefined) { f.w = 0; try { const bx = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box; f.w = Math.max(bx[0], bx[2]) * f.s; } catch { /* odd def */ } } sizes.set(k, f.w); }
    }
    // the biggest things first ("a fountain, two benches, a lamp-post and a sign")
    const parts = [...counts.entries()].sort((a, b) => (sizes.get(b[0]) ?? 0) - (sizes.get(a[0]) ?? 0) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => counted(k, n));
    const items = parts.length > 7 ? [...parts.slice(0, 6), `${parts.length - 6} more kinds of thing`] : parts;
    const [w, d] = across(p.polygon);
    if (p.of === 'room') {
      const t = things.find((x) => x.ref === p.ref), n = this.seatsIn(p);
      return `${t?.what ?? p.ref} (${article(kind)})${items.length ? `, with ${listed(items)}` : ', empty'}${n ? `; seats ${n}` : ''}; ${p.enclosed ? 'indoors' : 'open-sided'}, about ${Math.round(w)} by ${Math.round(d)} m`;
    }
    if (p.of === 'building') {
      const t = things.find((x) => x.ref === p.ref), rooms = all.filter((q) => q.of === 'room' && q.entity === p.entity).map((q) => humanTitle(q.ref.split('/').at(-1)!));   // F8 (#958): its rooms by name, never their paths
      const entrance = t?.doorOpen === undefined ? 'open-sided, with no front door' : `its front door is ${t.doorOpen ? 'open' : 'closed'}`;
      return `${article(kind)} with ${counted('room', rooms.length)} (${rooms.join(', ')}); ${entrance}`;
    }
    if (p.of === 'landform') {
      const e = m.entities.get(p.entity), [cx, cz] = centroid(p.polygon), top = Math.round(m.terrain.sample(cx, cz));
      const lf: any = (() => { try { const d = e && m.resolvedDef(e.def); return d ? m.bake(d, e!.params ?? {}, e!.seed ?? 0, e!.shape).landform : null; } catch { return null; } })();
      if (lf?.kind === 'bump') return `${article(kind)} about ${Math.round(Math.abs(lf.h * (e ? m.worldPose(e).s : 1)))} m high and ${Math.round(2 * lf.r * (e ? m.worldPose(e).s : 1))} m across; its top is ${top} m up (walk:${p.ref} climbs to it)`;
      if (lf?.kind === 'channel') {
        // how deep: the ground just beyond its banks, less its floor, averaged along it
        const path = lf.path as Vec2[], off = Number(lf.w) + Number(lf.edge) + 2; let sum = 0;
        path.forEach(([x, z], i) => { const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)], dx = c[0] - a[0], dz = c[1] - a[1], n = Math.hypot(dx, dz) || 1; sum += (m.terrain.sample(x - (dz / n) * off, z + (dx / n) * off) + m.terrain.sample(x + (dz / n) * off, z - (dx / n) * off)) / 2 - lf.levels[i]; });
        return `${article(kind)} cut about ${Math.round(sum / path.length)} m into the ground, ${Math.round(2 * lf.w)} m wide at the bottom and ${Math.round(Math.max(w, d))} m long`; }
      if (lf?.kind === 'cliff') return `${article(kind)} ${Math.round(Math.abs(lf.h))} m high and ${Math.round(Math.max(w, d))} m long; the high side is to its ${lf.side > 0 ? 'left' : 'right'} walking along it`;
      if (lf?.kind === 'ridge') return `${article(kind)} ${Math.round(Math.abs(lf.h))} m high, ${Math.round(Math.max(w, d))} m long`;
      return `${article(kind)} about ${Math.round(w)} by ${Math.round(d)} m, ${top} m up${items.length ? `, with ${listed(items)}` : ''}`;
    }
    if (p.of === 'land') return `land the god added to the world, about ${Math.round(w)} by ${Math.round(d)} m${items.length ? `, with ${listed(items)}` : ', still empty'}`;
    if (p.of === 'shore') return `the bank round ${this.h.nav.displayOf?.(p.ref) ?? humanTitle(p.ref)}: walk:${p.ref} ends here, and a swim starts from here`;
    if (p.of === 'water') return `${article(kind)} you can swim in, about ${Math.round(Math.max(w, d))} m across${items.length ? `, with ${listed(items)}` : ''}`;
    if (p.of === 'thing') return `${article(kind)}${p.capacity ? ` for ${p.capacity}` : ''}${items.length ? `, with ${listed(items)}` : ''}${p.enclosed ? '; indoors' : ''}`;
    if (p.of === 'landmark') { const t = things.find((x) => x.ref === p.ref), by = t ? this.h.nav.namesNear(t.at, p.entity, 2, 15).map((r) => this.h.nav.displayOf?.(r) ?? r) : [];
      return `${article(kind)} standing on its own${by.length ? ` by ${listed(by)}` : ''}${items.length ? `, with ${listed(items)} round it` : ''}; a landmark`; }
    return `${article(kind)}${items.length ? ` with ${listed(items)}` : ''}, about ${Math.round(w)} by ${Math.round(d)} m`;
  }

  /** Put the places in the ledger's index; take out the ones the god removed. */
  sync(fresh = false) {
    const places = this.h.edge?.places; if (!places) return;
    const want = new Map(this.list(fresh).map((p) => [p.id, p])); this.installedKey = this.cache?.key;
    if (this.h.readOnly) { this.publishedVersion = this.cache?.publicationVersion; this.published = true; return; }
    for (const id of [...this.installed]) if (!want.has(id)) { places.byId.delete(id); this.installed.delete(id); }
    for (const [id, p] of want) {
      const cur = places.byId.get(id); if (cur && !this.installed.has(id)) continue;   // a boot place keeps its own
      const { of: _o, entity: _e, ...place } = p;
      if (!cur || JSON.stringify(cur) !== JSON.stringify(place)) places.add(place);
      this.installed.add(id);
    }
    const root = [...places.byId.values()].find(p => p.parent === null);
    if (root) {
      const { worldAbout: _previous, ...base } = root, about = this.h.model.state.about;
      const next = { ...base, ...(about ? { worldAbout: about } : {}) };
      if (JSON.stringify(root) !== JSON.stringify(next)) places.add(next);
    }
    this.publishedVersion = this.cache?.publicationVersion;
    this.published = true;
  }

  /** The innermost place (any: god-built or the world's own, not a carrier) holding a point at a standing level. */
  placeAt(at: Vec2, level = 0): string | null {
    const places = this.h.edge?.places; if (!places) return null;
    return places.containing(at[0], at[1], level)[0]?.id ?? null;
  }
  /** placeAt for many points over the places as they are now (one synchronous pass; PlaceIndex.locator). */
  placeLocator(): (at: Vec2, level?: number) => string | null {
    const places = this.h.edge?.places; if (!places) return () => null;
    const find = places.locator();
    return (at, level = 0) => find(at[0], at[1], level)?.id ?? null;
  }
}

/** Run a generator to its end (a sliced derive, all at once). */
function drain<T>(it: Generator<void, T, void>): T { for (;;) { const r = it.next(); if (r.done) return r.value; } }
