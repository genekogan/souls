// PLACE-DATA-v1: typed places (Place/Occupier/Schedule/Role) and a Soul's place path.
// World authors the file; Core validates against the live world and indexes it.
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldAbout} from '@souls/world-compiler';
import type {MeaningPart} from '../../god/meaning.ts';
import type {PlaceRef} from '../contract.ts';

type V2 = [number, number];
export type Occupier = {id: string; fixture: string; slot: string; kind: string};
export type Place = {id: string; name: string; kind: string; parent: string | null; polygon: V2[]; level: number; enclosed: boolean; capacity: number | null; starting: boolean; description?: string; occupiers?: Occupier[]; schedule?: {id: string; cron: string; durationMinutes?: number; ticketed?: boolean; label?: string}[]; roles?: {id: string; relations?: {name: string; to: string}[]}[];
  /** Public semantic hierarchy is independent of physical membership and access. */
  ref?: string; worldAbout?: WorldAbout; aliases?: readonly string[]; genericAliases?: readonly string[]; semanticParent?: string | null; semanticKind?: string; semanticRole?: 'district' | 'quarter' | 'landmark' | 'part' | 'minor'; salience?: number; parts?: MeaningPart[];
  /** carrier/1: a place that moves with a native carrier entity (a balloon basket). Membership is by carriage, never geometry; `polygon` is in the entity's own frame. */
  carrier?: {entity: string; frame?: 'local'};
  /** knowledge/1: the world's creator keeps this place (and everything inside it) off maps and listings until a Soul has been there or found it. */
  secret?: boolean};
export type PlaceData = {contract: 'place-data/1'; world: string; places: Place[]};
const REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function inPoly(x: number, z: number, poly: V2[]) {let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;} return c;}
const area = (p: V2[]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;
export const centroid = (p: V2[]): V2 => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];

/** An outline's bounding box and area, kept per outline array (places are replaced, never edited in place). `box` is
 *  false when the outline is not plain finite numbers of a sane size: then every point goes to inPoly. */
type Outline = {poly: V2[]; box: boolean; minX: number; maxX: number; minZ: number; maxZ: number; eps: number; area: number};
const OUTLINES = new WeakMap<V2[], Outline>();
function outlineOf(poly: V2[]): Outline {
  let o = OUTLINES.get(poly); if (o) return o;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, box = poly.length > 0;
  for (const v of poly) {const x = v?.[0], z = v?.[1]; if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {box = false; break;} if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;}
  const big = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ)); if (!(big <= 1e12)) box = false;
  o = {poly, box, minX, maxX, minZ, maxZ, eps: 1e-9 * (1 + big), area: area(poly)}; OUTLINES.set(poly, o); return o;
}
/** inPoly(x, z, poly), the same answer, but a point outside the outline's bounding box is answered without the edge
 *  walk: above or below it no edge straddles z; left or right of it (by more than float rounding) every straddling
 *  edge, or none, is crossed, and a closed outline has an even number of them. */
export function inOutline(x: number, z: number, poly: V2[]): boolean {
  const o = outlineOf(poly);
  if (o.box && (z < o.minZ || z > o.maxZ || x < o.minX - o.eps || x > o.maxX + o.eps)) return false;
  return inPoly(x, z, poly);
}

/** Rules 1–6 of PLACE-DATA-v1. With `world`, also checks occupiers against live native fixtures. */
export function validatePlaceData(raw: unknown, world?: NativeWorld): string[] {
  const errs: string[] = [], d = raw as PlaceData;
  if (!d || d.contract !== 'place-data/1' || !Array.isArray(d.places)) return ['contract must be place-data/1 with places[]'];
  const ids = new Map<string, Place>();
  for (const p of d.places) {
    if (typeof p.id !== 'string' || !REF.test(p.id)) errs.push(`bad id ${JSON.stringify(p.id)}`);
    else if (ids.has(p.id)) errs.push(`duplicate id ${p.id}`); else ids.set(p.id, p);
    if (typeof p.name !== 'string' || !p.name || p.name.length > 100) errs.push(`${p.id}: name`);
    if (typeof p.kind !== 'string' || !p.kind) errs.push(`${p.id}: kind`);
    if (!Array.isArray(p.polygon) || p.polygon.length < 3 || p.polygon.some(v => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))) errs.push(`${p.id}: polygon`);
    if (p.level !== undefined && !Number.isInteger(p.level)) errs.push(`${p.id}: level`);
    if (typeof p.enclosed !== 'boolean') errs.push(`${p.id}: enclosed must be boolean`);
    if (p.capacity !== null && !(Number.isInteger(p.capacity) && p.capacity >= 1)) errs.push(`${p.id}: capacity`);
    if (p.description !== undefined && (typeof p.description !== 'string' || p.description.length > 4000)) errs.push(`${p.id}: description`);
    if (p.secret !== undefined && typeof p.secret !== 'boolean') errs.push(`${p.id}: secret must be boolean`);
  }
  const roots = d.places.filter(p => p.parent === null);
  if (roots.length !== 1) errs.push(`exactly one root required (found ${roots.length})`);
  for (const p of d.places) {
    if (p.parent !== null && !ids.has(p.parent)) {errs.push(`${p.id}: parent ${p.parent} missing`); continue;}
    const seen = new Set<string>(); let q: Place | undefined = p;
    while (q && q.parent !== null) {if (seen.has(q.id)) {errs.push(`${p.id}: parent cycle`); break;} seen.add(q.id); q = ids.get(q.parent);}
    const parent = p.parent ? ids.get(p.parent) : undefined;
    if (p.carrier !== undefined) {
      if (!p.carrier || typeof p.carrier.entity !== 'string' || (p.carrier.frame !== undefined && p.carrier.frame !== 'local')) errs.push(`${p.id}: carrier must be {entity, frame?: 'local'}`);
      else if (world) {const e = world.entities[p.carrier.entity], seats = e ? CATALOG[e.def]?.capabilities?.carrier?.seats : undefined;
        if (!e || !seats) errs.push(`${p.id}: carrier ${p.carrier.entity} is not a native carrier in this world`);
        else for (const o of p.occupiers ?? []) if (o.fixture !== p.carrier.entity || !seats.some(s => s.id === o.slot)) errs.push(`${p.id}: occupier ${o.id} must name a seat of ${p.carrier.entity}`);}
    }
    if (p.carrier === undefined && parent && Array.isArray(p.polygon) && Array.isArray(parent.polygon)) {const [cx, cz] = centroid(p.polygon); if (!inPoly(cx, cz, parent.polygon)) errs.push(`${p.id}: centroid outside parent ${parent.id}`);}
    if (p.capacity && (p.occupiers?.length ?? 0) > p.capacity) errs.push(`${p.id}: capacity below its occupier count`);
    for (const o of p.occupiers ?? []) {
      if (!REF.test(o.id) || ids.has(o.id)) errs.push(`${p.id}: occupier id ${o.id}`);
      if (world && p.carrier === undefined) {const e = world.entities[o.fixture]; if (!e) errs.push(`${p.id}: occupier ${o.id} fixture ${o.fixture} not in world`); else if (!(CATALOG[e.def]?.slots ?? []).some(s => s.id === o.slot && s.kind === 'seat')) errs.push(`${p.id}: occupier ${o.id} slot ${o.slot} not a seat slot of ${o.fixture} (${e.def})`);}
    }
  }
  if (!d.places.some(p => p.starting)) errs.push('at least one starting place required');
  return errs;
}

/** Provisional hierarchy until World data is installed: native regions under one outdoor root. */
export function derivePlaceData(world: NativeWorld): PlaceData {
  const regions = Object.values(world.regions ?? {}) as {id: string; label?: string; kind?: string; level?: number; polygon: V2[]}[];
  const all = regions.flatMap(r => r.polygon), xs = all.map(v => v[0]), zs = all.map(v => v[1]);
  const pad = 5, root: Place = {id: 'world', name: 'World', kind: 'outdoor', parent: null, level: 0, enclosed: false, capacity: null, starting: true,
    polygon: all.length ? [[Math.min(...xs) - pad, Math.min(...zs) - pad], [Math.max(...xs) + pad, Math.min(...zs) - pad], [Math.max(...xs) + pad, Math.max(...zs) + pad], [Math.min(...xs) - pad, Math.max(...zs) + pad]] : [[-200, -200], [200, -200], [200, 200], [-200, 200]]};
  return {contract: 'place-data/1', world: 'derived', places: [root, ...regions.filter(r => r.id !== 'world').map(r => ({id: r.id, name: r.label ?? r.id, kind: r.kind === 'place' ? 'outdoor' : (r.kind ?? 'outdoor'), parent: 'world', polygon: r.polygon, level: r.level ?? 0, enclosed: false, capacity: null, starting: false}))]};
}

/** A Map that counts its writes (L3: the place index's version, so caches keyed on it see a moved or renamed place). */
class VersionedMap<K, V> extends Map<K, V> {
  version = 0;
  override set(k: K, v: V) {this.version++; return super.set(k, v);}
  override delete(k: K) {const had = super.delete(k); if (had) this.version++; return had;}
  override clear() {this.version++; super.clear();}
}

export class PlaceIndex {
  readonly byId: Map<string, Place> = new VersionedMap<string, Place>();
  /** Moves on every add, replace or removal of a place. */
  get version(): number {return (this.byId as VersionedMap<string, Place>).version;}
  readonly occupierOf = new Map<string, {occ: Occupier; place: Place}>();
  readonly data: PlaceData;
  /** carrier/1: carrier entity id → its place (declared in the data, or derived by the ledger). */
  readonly carrierPlaces = new Map<string, Place>();
  constructor(data: PlaceData) {
    this.data = data;
    for (const p of data.places) this.add(p);
  }
  add(p: Place) {this.byId.set(p.id, p); for (const o of p.occupiers ?? []) this.occupierOf.set(o.fixture + '#' + o.slot, {occ: o, place: p}); if (p.carrier) this.carrierPlaces.set(p.carrier.entity, p);}
  /** Places containing the point, innermost (smallest) first; occupier (if seated) prepended by caller. Carrier places never contain by geometry. */
  containing(x: number, z: number, level = 0): Place[] {
    // L3 (b): memoised per point while the index does not change (static geometry: a seat, a spot or a thing is asked
    // about on every menu build; 1 s of a 90 s live-copy profile). Callers get their own copy of the answer.
    const v = this.version; if (this.containMemo.v !== v || this.containMemo.m.size > 20000) this.containMemo = {v, m: new Map()};
    const key = `${level},${x},${z}`, hit = this.containMemo.m.get(key); if (hit) return hit.slice();
    const out = this.containingNow(x, z, level); this.containMemo.m.set(key, out); return out.slice();
  }
  private containMemo: {v: number; m: Map<string, Place[]>} = {v: -1, m: new Map()};
  private containingNow(x: number, z: number, level: number): Place[] {
    return [...this.byId.values()].filter(p => !p.carrier && ((p.level ?? 0) === level && inOutline(x, z, p.polygon) || p.parent === null)).sort((a, b) => (a.parent === null ? 1 : 0) - (b.parent === null ? 1 : 0) || outlineOf(a.polygon).area - outlineOf(b.polygon).area);
  }
  ref(p: Place): PlaceRef {return {id: p.id, name: p.name, kind: p.kind};}
  /** containing(x, z, level)[0] for many points while the index does not change (lane L1: Eden 2026's activity spots
   *  asked containing() once per spot, every place each time: 0.8 s of a new Soul's first listing). Built now, over the
   *  places as they are now; use it and drop it within one synchronous pass. Same answer: the candidates are every place
   *  whose outline box (as inOutline widens it) holds the point, plus every place without a usable box; the innermost is the
   *  smallest area, the earliest in the index on a tie (containing's stable sort), else the smallest root (earliest on a tie). Any non-finite
   *  point or area falls back to containing() itself. */
  locator(cell = 8): (x: number, z: number, level?: number) => Place | undefined {
    const order = new Map<Place, number>(), always: Place[] = [], grid = new Map<string, Place[]>();
    let root: Place | undefined, odd = false;
    const MAX_CELLS = 4096;
    for (const p of this.byId.values()) {
      order.set(p, order.size);
      if (p.carrier) continue;
      const o = outlineOf(p.polygon);
      if (!Number.isFinite(o.area)) odd = true;
      if (p.parent === null) { if (!root || o.area < outlineOf(root.polygon).area) root = p; continue; }   // roots: smallest, earliest on a tie
      if (!o.box) { always.push(p); continue; }
      const lv = p.level ?? 0;
      const x0 = Math.floor((o.minX - o.eps) / cell), x1 = Math.floor((o.maxX + o.eps) / cell), z0 = Math.floor(o.minZ / cell), z1 = Math.floor(o.maxZ / cell);
      if (!(Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(z0) && Number.isFinite(z1)) || (x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) { always.push(p); continue; }
      for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) { const key = `${lv}|${i}|${k}`; const l = grid.get(key); if (l) l.push(p); else grid.set(key, [p]); }
    }
    if (odd) return (x, z, level = 0) => this.containing(x, z, level)[0];
    return (x, z, level = 0) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return this.containing(x, z, level)[0];
      let best: Place | undefined, bestArea = Infinity, bestOrder = Infinity;
      const consider = (p: Place) => {
        if ((p.level ?? 0) !== level || !inOutline(x, z, p.polygon)) return;
        const a = outlineOf(p.polygon).area, n = order.get(p)!;
        if (a < bestArea || (a === bestArea && n < bestOrder)) { best = p; bestArea = a; bestOrder = n; }
      };
      for (const p of grid.get(`${level}|${Math.floor(x / cell)}|${Math.floor(z / cell)}`) ?? []) consider(p);
      for (const p of always) consider(p);
      return best ?? root;
    };
  }
}

export type Happening = {placeId: string; place: string; id: string; label: string; now: boolean; startsInMinutes: number; endsInMinutes: number; distance: number | null};
/** What is on now, or next within `horizon` world minutes, from place schedules (daily `M H * * *` slots on the
 *  world clock; other cron forms are skipped in v1). Nearest-first among those on now, then soonest. A reason to go somewhere. */
export function happenings(places: Iterable<Place>, minuteOfDay: number, from: V2 | null, limit = 4, horizon = 120): Happening[] {
  const out: Happening[] = [];
  for (const p of places) for (const s of p.schedule ?? []) {
    const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(s.cron.trim()); if (!m) continue;
    const start = Number(m[2]) * 60 + Number(m[1]), dur = s.durationMinutes ?? 60;
    const since = (minuteOfDay - start + 1440) % 1440, now = since < dur, until = now ? 0 : (start - minuteOfDay + 1440) % 1440;
    if (!now && until > horizon) continue;
    const [cx, cz] = centroid(p.polygon);
    out.push({placeId: p.id, place: p.name, id: s.id, label: s.label ?? s.id, now, startsInMinutes: until, endsInMinutes: now ? dur - since : until + dur, distance: from ? Math.round(Math.hypot(cx - from[0], cz - from[1])) : null});
  }
  return out.sort((a, b) => Number(b.now) - Number(a.now) || (a.now ? (a.distance ?? 0) - (b.distance ?? 0) : a.startsInMinutes - b.startsInMinutes)).slice(0, limit);
}
