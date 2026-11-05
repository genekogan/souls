// W7 soundscape, the pure half (no WebAudio, testable under node): which sounds a world makes and where.
//
// Three kinds of source, all procedural (no audio files, nothing to license):
//   - objects: a def's `components.sound` — one spec, plus up to 3 more in `also` (a fountain can splash *and* hum). Each instance
//     gets a variant of its kind from its id (two birdbaths need not sing the same song); `params.sound`, `params.loudness`
//     and `params.soundVariant` override per instance.
//   - ambience: the world around the listener — a wind bed always, birds by day and crickets by night (spread over a fixed
//     40 m grid so walking changes who you hear), and water/waves near the world's lakes, rivers and sea.
//   - residents: distant chatter where residents stand together, footsteps where they walk, and the visitor's own
//     footsteps when the camera walks at eye height.
//   - implied (release 3.1): things whose def carries no sound still sound like what they are, from their tags — trees
//     rustle (clustered, so a wood is one voice), flags flap, flower beds hum with bees by day, reeds croak at night, ducks
//     and gulls call, fridges hum; and some sounding things gain a second sound (a fountain also drips and draws pigeons,
//     a watermill also runs, a windmill also catches the wind). Birds sing from the world's trees, wind rises on open and
//     high ground, frogs sing at ponds by night and gulls call over the sea by day.
// Everything is quiet by default (MASTER_DEFAULT) and ambient music is opt-in.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';

export type SoundKind =
  | 'water' | 'stream' | 'fire' | 'wind' | 'creak' | 'birds' | 'bell' | 'hum' | 'engine' | 'chime' | 'frogs' | 'music'
  | 'waves' | 'crickets' | 'chatter' | 'footsteps' | 'leaves' | 'flag' | 'waterfowl' | 'bees' | 'kettle';
export type SoundSpec = { kind: SoundKind; radius: number; volume: number; when?: string; mode?: 'loop' | 'change'; variant?: number };
export type Source = 'object' | 'ambient' | 'resident' | 'visitor';
/** `cloud`: pts is a set of separate points (a cluster of trees); the distance is to the nearest one. */
/** `follow`: an ambience that goes where the listener goes (the sea along a shore): heard at its level wherever the
 *  camera is, so a fast camera move never drops it out of range and restarts it (lane S3). */
export type Emitter = { id: string; spec: SoundSpec; pts: [number, number, number][]; area: boolean; cloud?: boolean; follow?: boolean; state: Record<string, unknown>; source: Source };

export const KINDS: readonly SoundKind[] = ['water', 'stream', 'fire', 'wind', 'creak', 'birds', 'bell', 'hum', 'engine', 'chime', 'frogs', 'music', 'waves', 'crickets', 'chatter', 'footsteps', 'leaves', 'flag', 'waterfowl', 'bees', 'kettle'];
const KIND_SET = new Set<string>(KINDS);
/** How many distinct voicings each kind has (variant = index mod this). */
export const VARIANTS: Record<SoundKind, number> = { water: 3, stream: 2, fire: 2, wind: 2, creak: 2, birds: 4, bell: 3, hum: 2, engine: 3, chime: 3, frogs: 2, music: 4, waves: 2, crickets: 2, chatter: 3, footsteps: 2, leaves: 2, flag: 2, waterfowl: 2, bees: 2, kettle: 2 };
export const MASTER_DEFAULT = 0.32;
export const isKind = (k: unknown): k is SoundKind => typeof k === 'string' && KIND_SET.has(k);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** FNV-1a: a stable small hash for variant choice and grid scatter. */
export function hash(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
/** Voicings only a def can ask for by number (never hashed onto other things): hum 2 is a neon sign's transformer buzz
 *  (Soul Actions entry 33); water 3 is a can's rose on soil (entry 34). */
export const PINNED_ONLY: Partial<Record<SoundKind, number>> = { hum: 1, water: 1 };
export const variantOf = (kind: SoundKind, key: string, pinned?: unknown) => {
  const n = VARIANTS[kind], all = n + (PINNED_ONLY[kind] ?? 0);
  return typeof pinned === 'number' && Number.isInteger(pinned) ? ((pinned % all) + all) % all : hash(key) % n;
};

/** The condition `when` against an entity's state (with the def's state defaults): 'on', '!open'. `day` and `night`
 *  (when the entity has no state of that name) follow the world's clock: pass `night` (0 day … 1 night). */
export function condition(when: string | undefined, state: Record<string, unknown>, night?: number): boolean {
  if (!when) return true;
  const neg = when.startsWith('!'), k = neg ? when.slice(1) : when;
  let v = state[k];
  if (v === undefined && night !== undefined && (k === 'night' || k === 'day')) v = k === 'night' ? night > 0.5 : night <= 0.5;
  const truthy = typeof v === 'number' ? v > 0 : !!v;
  return neg ? !truthy : truthy;
}
/** Distance from (x, y, z) to an emitter: a point, a polyline, or a polygon (0-ish inside). */
export function distanceTo(e: Pick<Emitter, 'pts' | 'area'>, x: number, y: number, z: number): number {
  const P = e.pts;
  if (P.length === 1) return Math.hypot(P[0][0] - x, P[0][1] - y, P[0][2] - z);
  if ((e as Emitter).cloud) { let b = Infinity; for (const p of P) b = Math.min(b, Math.hypot(p[0] - x, p[1] - y, p[2] - z)); return b; }
  let best = Infinity, inside = false;
  const n = e.area ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
    const px = a[0] + dx * t, pz = a[2] + dz * t, py = a[1] + (b[1] - a[1]) * t;
    best = Math.min(best, Math.hypot(px - x, py - y, pz - z));
    if (e.area && ((a[2] > z) !== (b[2] > z)) && x < a[0] + ((z - a[2]) / (b[2] - a[2])) * (b[0] - a[0])) inside = !inside;
  }
  return inside ? Math.abs(y - P[0][1]) * 0.25 : best;
}
/** Loudness 0..1 heard from distance d (smooth quadratic fall-off to 0 at the radius). */
export const falloff = (d: number, radius: number, volume: number) => (d >= radius ? 0 : volume * (1 - d / radius) ** 2);

/** A def's sound specs: `components.sound` and its `also` list (at most 4 in all). Unknown kinds are dropped. */
export function specsOf(def: Pick<StoredDef, 'components'> | undefined): SoundSpec[] {
  const raw = (def?.components as { sound?: unknown } | undefined)?.sound;
  const list = Array.isArray(raw) ? raw.slice(0, 4) : raw ? [raw, ...(Array.isArray((raw as { also?: unknown }).also) ? ((raw as { also: unknown[] }).also).slice(0, 3) : [])] : [];
  const out: SoundSpec[] = [];
  for (const s of list as Partial<SoundSpec>[]) {
    if (!s || !isKind(s.kind)) continue;
    out.push({ kind: s.kind, radius: Math.max(1, Math.min(120, num(s.radius, 14))), volume: Math.max(0, Math.min(1, num(s.volume, 0.5))), when: typeof s.when === 'string' ? s.when : undefined, mode: s.mode === 'change' ? 'change' : 'loop', ...(typeof s.variant === 'number' ? { variant: s.variant } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------- implied sounds (from what a thing is)

type DefLike = Pick<StoredDef, 'components'> & { name?: string; tags?: readonly string[]; form?: string };
const S = (kind: SoundKind, radius: number, volume: number, extra: Partial<SoundSpec> = {}): SoundSpec => ({ kind, radius, volume, mode: 'loop', ...extra });
/** Kinds that many small things make together; one voice per cluster (CLUSTER m cell), not one per thing. */
export const CLUSTERED = new Set<SoundKind>(['leaves', 'bees']);
const CLUSTER = 24;
/** Sounds a def implies from its name and tags when it carries none of its own (or extra sounds for one that does).
 *  Kept to what a thing honestly sounds like on its own: no phantom people or machines working. */
export function impliedSpecs(def: DefLike | undefined): SoundSpec[] {
  if (!def) return [];
  const tags = new Set(def.tags ?? []), name = String(def.name ?? '').replace(/^core[-/]/, '').replace(/@\d+$/, '');
  const has = (...t: string[]) => t.some((x) => tags.has(x));
  const own = specsOf(def), kinds = new Set(own.map((s) => s.kind)), out: SoundSpec[] = [];
  if (own.length) {
    // a second sound for things that already make one
    if (has('fountain') || /fountain/.test(name)) { out.push(S('water', 6, 0.22, { variant: 2 }), S('birds', 14, 0.12, { variant: 1, when: 'day' })); }
    if (/watermill/.test(name)) out.push(S('stream', 18, 0.35));
    if (/windmill/.test(name)) out.push(S('wind', 20, 0.14, { variant: 1, when: 'on' }));
    if (has('boat') && kinds.has('engine')) out.push(S('waves', 12, 0.2, { variant: 1 }));
    if (/campfire/.test(name)) out.push(S('crickets', 14, 0.1, { when: 'night' }));
    return out;
  }
  if (has('tree', 'forest') && (has('tree') || def.form === 'area') && !has('stump', 'log', 'mushroom', 'treestump', 'woodlog')) out.push(S('leaves', 14, 0.16, { variant: has('pine', 'conifer', 'evergreen', 'palm') ? 1 : 0 }));
  if (has('flowers', 'flower', 'meadow') && !has('pond')) out.push(S('bees', 8, 0.1, { when: 'day' }));
  if (has('reeds') || (has('water') && has('cover') && has('plant'))) out.push(S('frogs', 16, 0.18, { when: 'night' }), S('leaves', 8, 0.08, { variant: 1 }));
  if (has('duck', 'goose')) out.push(S('waterfowl', 16, 0.2, { variant: 1, when: 'day' }));
  if (has('seagull', 'gull')) out.push(S('waterfowl', 30, 0.22, { variant: 0, when: 'day' }));
  if (has('flag') || /(^|-)flag(-|$)/.test(name)) out.push(S('flag', 10, 0.14));
  if (has('fridge', 'freezer')) out.push(S('hum', 4, 0.06));
  return out.slice(0, 4);
}

/** Every entity's sounds in the model, with position(s), current state (def defaults filled) and a chosen variant.
 *  Implied sounds of kinds in CLUSTERED are merged per cell into one `cloud` emitter (a wood rustles as one). */
export function emittersOf(model: WorldModel): Emitter[] {
  const out: Emitter[] = [], clusters = new Map<string, Emitter>();
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), own = specsOf(def), implied = impliedSpecs(def as DefLike | undefined);
    if (!def || (!own.length && !implied.length)) continue;
    // a fountain's own water is the splashing voicing (its drip and pigeons come as extra sounds)
    if (own[0] && own[0].variant === undefined && ((def as DefLike).tags ?? []).includes('fountain')) own[0] = { ...own[0], variant: 0 };
    const specs = own.length ? [...own, ...implied].slice(0, 4) : implied.filter((s) => !CLUSTERED.has(s.kind));
    if (!own.length) for (const spec of implied) {
      if (!CLUSTERED.has(spec.kind)) continue;
      const place = placeOf(model, e, def), pts = place.area ? areaSamples(place.pts) : place.pts;
      for (const p of pts) {
        const key = `cl:${spec.kind}:${spec.variant ?? 0}:${spec.when ?? ''}:${Math.floor(p[0] / CLUSTER)},${Math.floor(p[2] / CLUSTER)}`;
        let c = clusters.get(key);
        if (!c) { c = { id: key, source: 'object', state: {}, area: false, cloud: true, pts: [], spec: { ...spec, variant: spec.variant ?? variantOf(spec.kind, key) } }; clusters.set(key, c); }
        if (c.pts.length < 48) c.pts.push(p);
      }
    }
    if (!specs.length) continue;
    const state: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(def.state ?? {})) state[k] = (f as { default?: unknown }).default;
    Object.assign(state, e.state ?? {});
    const p = e.params ?? {}, place = placeOf(model, e, def);
    specs.forEach((spec, i) => {
      // the first spec may be re-voiced per instance (params `sound`, `loudness`, `soundVariant`)
      const kind = i === 0 && isKind(p.sound) ? p.sound : spec.kind;
      const volume = i === 0 && typeof p.loudness === 'number' ? Math.max(0, Math.min(1, p.loudness)) : spec.volume;
      const id = specs.length > 1 ? `${e.id}#${i}` : e.id;
      out.push({ id, source: 'object', state, ...place, spec: { ...spec, kind, volume, variant: variantOf(kind, id, i === 0 ? p.soundVariant ?? spec.variant : spec.variant) } });
    });
  }
  // a cluster of many things is a little louder and carries a little further than one
  for (const c of clusters.values()) { const n = c.pts.length; c.spec = { ...c.spec, volume: Math.min(0.3, c.spec.volume * (1 + 0.35 * Math.log2(n))), radius: c.spec.radius + Math.min(10, 2 * Math.log2(n)) }; out.push(c); }
  return out;
}
/** A few points inside/along an area's outline (the outline's vertices plus its centroid), for clustering. */
function areaSamples(pts: [number, number, number][]): [number, number, number][] {
  const n = pts.length, c = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]) as [number, number, number];
  const step = Math.max(1, Math.floor(n / 12));
  return [c, ...pts.filter((_, i) => i % step === 0).map((p) => [(p[0] + c[0]) / 2, (p[1] + c[1]) / 2, (p[2] + c[2]) / 2] as [number, number, number])];
}

/** Where the world's trees are (tops), for birds: tree entities and samples of woodland/orchard areas. */
export function treesOf(model: WorldModel): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def) as (DefLike & StoredDef) | undefined;
    if (!def) continue;
    const tags = new Set(def.tags ?? []);
    if (!(tags.has('tree') || (tags.has('forest') && def.form === 'area')) || tags.has('stump') || tags.has('log') || tags.has('mushroom')) continue;
    const place = placeOf(model, e, def);
    const pts = place.area ? areaSamples(place.pts) : place.pts;
    for (const p of pts) { out.push([p[0], p[1] + (place.area ? 6 : (def.size?.box?.[1] ?? 6) * 0.4), p[2]]); if (out.length >= 2000) return out; }
  }
  return out;
}
/** A simple measure of how open and high the listener's ground is, for wind (0 sheltered/low … 1 exposed/high). */
export function exposureAt(x: number, z: number, ground: number, typicalGround: number, obstacles: readonly [number, number, number][]): number {
  const high = Math.max(0, Math.min(1, (ground - typicalGround) / 12));
  let near = 0; for (const o of obstacles) { if (Math.abs(o[0] - x) < 12 && Math.abs(o[2] - z) < 12) near += o[1]; if (near > 6) break; }
  const open = 1 - Math.min(1, near / 6);
  return Math.max(0, Math.min(1, 0.55 * high + 0.45 * open * (0.4 + 0.6 * high) + 0.25 * open));
}
function placeOf(model: WorldModel, e: Entity, def: StoredDef): Pick<Emitter, 'pts' | 'area'> {
  const g = (x: number, z: number) => { try { return model.terrain.sample(x, z); } catch { return 0; } };
  if (def.form !== 'point' && e.in.parent === 'world' && e.shape) {
    const raw = 'path' in e.shape ? e.shape.path : e.shape.area;
    const step = Math.max(1, Math.floor(raw.length / 64));
    const pts = raw.filter((_, i) => i % step === 0).map(([x, z]) => [x, g(x, z), z] as [number, number, number]);
    return { pts, area: 'area' in e.shape };
  }
  const p = model.worldPose(e), h = (def.size?.box?.[1] ?? 1) * p.s * 0.5;
  return { pts: [[p.x, p.y + h, p.z]], area: false };
}

// ---------------------------------------------------------------- ambience

export type Water = { area?: [number, number][]; path?: [number, number][]; w?: number; level: number };
/** `trees` (tops, from treesOf) puts birds in the world's trees; without them birds scatter on the grid. `exposure`
 *  (exposureAt) used to raise a wind bed; since lane S3 there is none and it is only reported in state. */
export type Listener = { x: number; y: number; z: number; ground: number | null; night: number; covered: boolean; waters: readonly Water[]; seaLevel?: number; trees?: TreeIndex; exposure?: number };
const CELL = 40;
/** Trees bucketed by 40 m cell, built once per scan. */
export type TreeIndex = { count: number; cells: Map<string, [number, number, number][]> };
export function treeIndex(trees: readonly [number, number, number][]): TreeIndex {
  const cells = new Map<string, [number, number, number][]>();
  for (const t of trees) { const k = `${Math.floor(t[0] / CELL)},${Math.floor(t[2] / CELL)}`; let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(t); }
  return { count: trees.length, cells };
}

/** The world around the listener: wind always (more on open, high ground and up in the air), birds by day in the
 *  trees (or scattered on a fixed grid where the world has none), crickets by night, water near water, frogs at ponds
 *  by night, gulls over the sea by day. Indoors (under a roof) the ambience drops to a murmur. Deterministic in position
 *  and time of day. */
export function ambienceAt(L: Listener): Emitter[] {
  const out: Emitter[] = [], indoor = L.covered ? 0.25 : 1, hy = L.ground ?? L.y;
  const at = (x: number, z: number, y = hy) => [[x, y, z]] as [number, number, number][];
  // lane S3 (2026-10-20, Gene: "the whooshing wind sound is kind of annoying. turn it off. sounds should just be
  // incidental ones"): no wind bed or gusts around the listener any more; what sounds is tied to what is there
  // creatures on a 40 m grid: each cell may hold one singer; day birds and night crickets crossfade at dusk
  const day = 1 - L.night, cx = Math.floor(L.x / CELL), cz = Math.floor(L.z / CELL), wooded = !!L.trees && L.trees.count > 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const key = `${cx + i},${cz + j}`, h = hash(key);
    const x = (cx + i + ((h >>> 4) % 97) / 97) * CELL, z = (cz + j + ((h >>> 12) % 89) / 89) * CELL;
    if (day > 0.15) {
      const inTrees = L.trees?.cells.get(key);
      if (inTrees?.length) {
        // birds live in the trees: one or two singers per wooded cell, up in a tree, more trees more song
        const t = inTrees[h % inTrees.length], vol = 0.22 * Math.min(1.3, 0.75 + 0.08 * inTrees.length);
        out.push({ id: `amb:birds:${key}`, source: 'ambient', state: { trees: inTrees.length }, area: false, pts: [[t[0], t[1], t[2]]], spec: { kind: 'birds', radius: 38, volume: vol * day * indoor, variant: variantOf('birds', key) } });
        if (inTrees.length >= 4) { const u = inTrees[(h >>> 8) % inTrees.length]; out.push({ id: `amb:birds2:${key}`, source: 'ambient', state: { trees: inTrees.length }, area: false, pts: [[u[0], u[1], u[2]]], spec: { kind: 'birds', radius: 30, volume: 0.16 * day * indoor, variant: variantOf('birds', `${key}#2`) } }); }
      } else if (!wooded ? h % 3 !== 0 : h % 5 === 0) {
        // no trees here: an open-ground bird now and then (all over a treeless world, rarely beside a wooded one)
        out.push({ id: `amb:birds:${key}`, source: 'ambient', state: {}, area: false, pts: at(x, z, hy + 5), spec: { kind: 'birds', radius: 38, volume: (wooded ? 0.1 : 0.22) * day * indoor, variant: variantOf('birds', key) } });
      }
    }
    if (L.night > 0.3 && h % 3 !== 0) out.push({ id: `amb:crickets:${key}`, source: 'ambient', state: {}, area: false, pts: at(x, z), spec: { kind: 'crickets', radius: 42, volume: 0.18 * L.night * indoor, variant: variantOf('crickets', key) } });
  }
  // the nearest water shore (lakes, rivers) and the sea; frogs at ponds by night
  for (const [k, w] of L.waters.entries()) {
    if (w.area && w.area.length > 2) {
      const pts = w.area.map(([x, z]) => [x, w.level, z] as [number, number, number]);
      out.push({ id: `amb:water:${k}`, source: 'ambient', state: {}, area: true, pts, spec: { kind: 'waves', radius: 26, volume: 0.2 * indoor, variant: 1 } });
      if (L.night > 0.4) out.push({ id: `amb:frogs:${k}`, source: 'ambient', state: {}, area: true, pts, spec: { kind: 'frogs', radius: 24, volume: 0.16 * L.night * indoor, variant: variantOf('frogs', `amb:frogs:${k}`) } });
    }
    else if (w.path && w.path.length > 1) out.push({ id: `amb:water:${k}`, source: 'ambient', state: {}, area: false, pts: w.path.map(([x, z]) => [x, w.level, z] as [number, number, number]), spec: { kind: 'stream', radius: 18 + (w.w ?? 2), volume: 0.2 * indoor, variant: variantOf('stream', `amb:water:${k}`) } });
  }
  if (L.seaLevel !== undefined && hy - L.seaLevel < 3) {
    const near = Math.max(0, 1 - (hy - L.seaLevel) / 3);
    out.push({ id: 'amb:sea', source: 'ambient', state: {}, area: false, follow: true, pts: at(L.x, L.z, L.seaLevel), spec: { kind: 'waves', radius: 10, volume: 0.22 * indoor * near, variant: 0 } });
    if (day > 0.3) out.push({ id: 'amb:gulls', source: 'ambient', state: {}, area: false, follow: true, pts: at(L.x + 14, L.z + 14, L.seaLevel + 10), spec: { kind: 'waterfowl', radius: 40, volume: 0.12 * day * indoor * near, variant: 0 } });
  }
  return out;
}

// ---------------------------------------------------------------- residents and the visitor

/** `speaking`: the resident is saying something right now (a speech line shown in the last few seconds). */
export type Resident = { id: string; p: readonly [number, number, number]; speaking?: boolean; body?: string; activity?: string; instrument?: string;
  /** Seconds the depicted activity has run (absent: began before the known history). */
  activityAge?: number };
type Track = { p: readonly [number, number, number]; t: number; speed: number };

/** Footsteps where residents walk, a resident's murmur while they speak, and chatter where two or more stand within 4 m of each other; the visitor's own
 *  footsteps when the camera moves at walking speed within 2.6 m of the ground. Keeps a short motion memory. */
export class Movement {
  private tracks = new Map<string, Track>();
  private cam: Track | null = null;
  emitters(residents: readonly Resident[], cam: { x: number; y: number; z: number; ground: number | null }, t: number): Emitter[] {
    const out: Emitter[] = [], seen = new Set<string>();
    for (const r of residents) {
      seen.add(r.id);
      const prev = this.tracks.get(r.id), dt = prev ? t - prev.t : 0;
      const speed = prev && dt > 0.05 ? Math.hypot(r.p[0] - prev.p[0], r.p[2] - prev.p[2]) / dt : prev?.speed ?? 0;
      this.tracks.set(r.id, { p: r.p, t: prev && dt <= 0.05 ? prev.t : t, speed: prev && dt <= 0.05 ? prev.speed : speed });
      // a resident who is talking right now: a murmur of their voice where they stand (the words are on screen)
      if (r.speaking) out.push({ id: `res:talk:${r.id}`, source: 'resident', state: { size: 1 }, area: false, pts: [[r.p[0], r.p[1] + 1.6, r.p[2]]], spec: { kind: 'chatter', radius: 16, volume: 0.2, variant: variantOf('chatter', r.id) } });
      if (speed > 0.4 && speed < 6) out.push({ id: `res:steps:${r.id}`, source: 'resident', state: { speed }, area: false, pts: [[r.p[0], r.p[1], r.p[2]]], spec: { kind: 'footsteps', radius: 12, volume: 0.22, variant: variantOf('footsteps', r.id) } });
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
    // groups: residents standing still within 4 m of another make a murmur at their centre
    const still = residents.filter((r) => (this.tracks.get(r.id)?.speed ?? 0) < 0.4), used = new Set<string>();
    for (const a of still) {
      if (used.has(a.id)) continue;
      const group = still.filter((b) => !used.has(b.id) && Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) < 4);
      if (group.length < 2) continue;
      for (const g of group) used.add(g.id);
      const c = group.reduce((s, g) => [s[0] + g.p[0] / group.length, s[1] + g.p[1] / group.length, s[2] + g.p[2] / group.length], [0, 0, 0]);
      const key = group.map((g) => g.id).sort().join('+');
      out.push({ id: `res:chatter:${key}`, source: 'resident', state: { size: group.length }, area: false, pts: [[c[0], c[1] + 1.5, c[2]]], spec: { kind: 'chatter', radius: 22, volume: Math.min(0.3, 0.12 + 0.05 * group.length), variant: variantOf('chatter', key) } });
    }
    // the visitor's own feet: eye height above ground and moving at a walk
    const prev = this.cam, dt = prev ? t - prev.t : 0, cp = [cam.x, cam.y, cam.z] as const;
    const speed = prev && dt > 0.05 ? Math.hypot(cam.x - prev.p[0], cam.z - prev.p[2]) / dt : prev?.speed ?? 0;
    if (!prev || dt > 0.05) this.cam = { p: cp, t, speed };
    const low = cam.ground !== null && cam.y - cam.ground < 2.6;
    if (low && speed > 0.6 && speed < 7) out.push({ id: 'me:steps', source: 'visitor', state: { speed }, area: false, pts: [[cam.x, cam.ground!, cam.z]], spec: { kind: 'footsteps', radius: 6, volume: 0.18, variant: 1 } });
    return out;
  }
}

// ---------------------------------------------------------------- the listener's settings

export type SoundSettings = { muted: boolean; volume: number; music: boolean };
export const SETTINGS_KEY = 'sim.sound.v1';
// lane S3: music on by default: the world plays its playlist (gen-mesh/music.ts) once the visitor's first gesture allows sound
export const DEFAULT_SETTINGS: SoundSettings = Object.freeze({ muted: false, volume: MASTER_DEFAULT, music: true });
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;
export function loadSettings(store: Store): SoundSettings {
  try {
    const raw = store?.getItem(SETTINGS_KEY); if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<SoundSettings>;
    return { muted: s.muted === true, volume: Math.max(0, Math.min(1, num(s.volume, MASTER_DEFAULT))), music: s.music === true };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(store: Store, s: SoundSettings) { try { store?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private window */ } }

/** Notes scheduled ahead of the audio clock, per player (#422): once the player has stopped, a note that has not begun is
 *  returned by `settle` to be silenced; a note that has begun keeps its natural decay. */
export class QueuedNotes<N> {
  private q: { player: string; at: number; nodes: N[] }[] = [];
  add(player: string, at: number, nodes: N[]) { this.q.push({ player, at, nodes }); }
  /** Forget begun notes and return the not-yet-begun nodes of players no longer playing. */
  settle(now: number, playing: ReadonlySet<string>): N[] {
    const cancel: N[] = [];
    this.q = this.q.filter(n => { if (n.at <= now) return false; if (playing.has(n.player)) return true; cancel.push(...n.nodes); return false; });
    return cancel;
  }
  get size() { return this.q.length; }
}
