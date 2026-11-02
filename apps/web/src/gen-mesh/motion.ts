// Client-side decorative motion: spin, sway, hover, route, creature gaits and behaviours, night
// glow — all pure functions of world time and the entity's seed, so every viewer sees the same
// thing with no sync. Owner: L4. Spec <eden4>/33 §3.2, 29 WP4b.
//
// The entity layer calls `animate` every frame for entities whose def `hasMotion`, after it has
// set the resting pose (position, uniform scale, yaw). Creatures carry a `rig` in userData (set by
// creatures/creature.mesh.ts or the animals/1 herd builder): role pivots plus the world model for
// terrain, water and solids. Gaits: quadruped-walk, biped-waddle, bird-fly, fish-swim, hover.
import type * as THREE from 'three';
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
// L1: the singular and plural light components share their pattern curves with pools and halos.
import {defLights,flickers,lightPatternLevel,lightPhase} from '../WorldNightLights.ts';
import { hasFlames } from '../fx/flames.ts';
import { variantOf } from './material-variants.ts';
import { pose, RouteCache, rand, seedOf, type BehaviorKind, type Plan, type Pose, type Surroundings, type V2 } from './creatures/behavior.ts';
import { clearFor, giveWay, giveWayState, lookFor, peopleNear, peopleNow, setPeopleSource, type GiveWayState } from './creatures/give-way.ts';

/** True if this entity needs per-frame motion (the layer only calls `animate` for these). */
export function hasMotion(def: StoredDef): boolean {
  const c = def.components;
  if (c.spin || c.swing || c.sway || c.hover || c.route || c.behavior || c.light || c.lights || hasFlames(def)) return true;
  if (def.tags.includes('creature') || def.tags.includes('moving') || isBoat(def)) return true;
  if (def.make.kind === 'gen' && def.make.gen === 'animals/1') return true;
  const gait = def.make.kind === 'gen' && def.make.gen === 'kit/2' ? (def.make.args as { gait?: string } | undefined)?.gait : undefined;
  return !!gait && gait !== 'none';
}

let boundModel: WorldModel | null = null;
const reducedLightMotion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
/** World time in seconds shared by every viewer: the layer passes page time (performance.now) —
 *  convert to wall-clock epoch seconds so two browsers agree; epoch values pass through. */
export function worldSeconds(t: number): number { return t > 1e8 ? t : (typeof performance !== 'undefined' ? performance.timeOrigin / 1000 : 0) + t; }
/** The layer (or any of our builders) binds the world model so motion can read terrain and water. */
export function bindMotionModel(m: WorldModel | null) { boundModel = m; }

/** Apply motion at world time `t` (seconds). `base` is the resting local transform the layer computed. */
export function animate(obj: THREE.Object3D, entity: Entity, def: StoredDef, tIn: number, base: { y: number; yaw: number }) {
  const t = worldSeconds(tIn);
  const ud = obj.userData as { tick?: (t: number) => void; fx?: (t: number) => void; rig?: Rig; model?: WorldModel };
  ud.fx?.(t); // W2: animated fire (fx/flames.ts)
  if (ud.tick) { ud.tick(t); return; }
  const c = def.components, phase = ((entity.seed ?? hash(entity.id)) % 1000) / 1000 * Math.PI * 2;
  const model = ud.rig?.model ?? ud.model ?? boundModel;
  const routed = !!c.route && !!model && routeStep(obj, entity, def, model, t, base);
  if (ud.rig) creatureStep(obj, ud.rig, entity, t, base);
  if (isBoat(def)) { boatStep(obj, entity, def, model, t, base, phase, routed); if (c.light || c.lights) syncLightGlow(obj, entity, def, model, t); return; }
  // VOCAB-MECH: a spinning part stops when its actuator is off (power on:false, play playing:false)
  if (c.spin && entity.state?.on !== false && entity.state?.playing !== false) {
    const ang = (t * (c.spin.rpm / 60)) * Math.PI * 2;
    const target = c.spin.role ? obj.getObjectByName(`role:${c.spin.role}`) : obj;
    if (target) { if (c.spin.axis === 'x') target.rotation.x = ang; else if (c.spin.axis === 'z') target.rotation.z = ang; else target.rotation.y = (target === obj ? base.yaw : 0) + ang; }
    if (target && target !== obj && c.spin.axis === 'z') hangFrom(obj, target, ang);
  }
  if (c.swing) swingStep(obj, entity, c.swing.parts, t);
  if (c.sway) { obj.rotation.z = Math.sin(t * (Math.PI * 2) / c.sway.period + phase) * c.sway.amount * 0.3; obj.rotation.x = Math.cos(t * (Math.PI * 2) / (c.sway.period * 1.3) + phase) * c.sway.amount * 0.2; }
  if (c.hover) obj.position.y = (c.route ? obj.position.y : base.y + c.hover.height) + Math.sin(t * (Math.PI * 2) / c.hover.period + phase) * c.hover.bob;
  if (c.light || c.lights) syncLightGlow(obj, entity, def, model, t);
}

/** E2: where a part hung from a turning wheel is: its hanger point (rest offset from the hub, in the wheel's plane) turned
 *  with the wheel; the part itself does not turn, so a gondola keeps hanging upright. */
export function hangPosition(rest: readonly [number, number], ang: number): [number, number] {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return [rest[0] * cs - rest[1] * sn, rest[0] * sn + rest[1] * cs];
}
/** E2: a ferris wheel's gondolas (kit role `gondola`, one group each, pivoted at its hanger point on the rim) ride round
 *  with the wheel while staying upright, as old Eden's did. */
function hangFrom(obj: THREE.Object3D, wheel: THREE.Object3D, ang: number) {
  const ud = wheel.userData as { hangs?: { o: THREE.Object3D; rest: [number, number] }[] };
  if (!ud.hangs) { const hangs: { o: THREE.Object3D; rest: [number, number] }[] = []; obj.traverse((o) => { if (o.name === 'role:gondola') hangs.push({ o, rest: [o.position.x - wheel.position.x, o.position.y - wheel.position.y] }); }); ud.hangs = hangs; }
  for (const h of ud.hangs) { const [x, y] = hangPosition(h.rest, ang); h.o.position.x = wheel.position.x + x; h.o.position.y = wheel.position.y + y; }
}

type Swing = NonNullable<StoredDef['components']['swing']>['parts'][number];
/** E2 #4: is a `when` gate (`field` or `!field`) open for this entity's state? */
export function swingOpen(when: string | undefined, state: Record<string, unknown> | undefined): boolean {
  if (!when) return true;
  const neg = when.startsWith('!'), v = state?.[neg ? when.slice(1) : when];
  return neg ? !v : !!v;
}
/** E2 #4: 0…1 along a working stroke at world time `t` (eased at both ends, like a hydraulic ram). */
export function swingStroke(t: number, period: number, phase: number): number { return 0.5 - 0.5 * Math.cos(((t / period) + phase) * Math.PI * 2); }
/** Pose each working role from its rest pose; a gated role eases back to rest when its gate closes (engine off). */
function swingStep(obj: THREE.Object3D, entity: Entity, swings: Swing[], t: number) {
  for (const w of swings) {
    const target = obj.getObjectByName(`role:${w.role}`); if (!target) continue;
    const ud = target.userData as { swingRest?: { p: [number, number, number]; r: [number, number, number] }; swingK?: number; swingAt?: number };
    ud.swingRest ??= { p: [target.position.x, target.position.y, target.position.z], r: [target.rotation.x, target.rotation.y, target.rotation.z] };
    const open = swingOpen(w.when, entity.state as Record<string, unknown> | undefined), dt = ud.swingAt === undefined ? 0 : Math.max(0, Math.min(0.25, t - ud.swingAt));
    ud.swingAt = t; ud.swingK = open ? 1 : Math.max(0, (ud.swingK ?? 0) - dt / 1.5);   // settle back over 1.5 s
    const k = open ? swingStroke(t, w.period, w.phase) : Math.min(ud.swingK, swingStroke(t, w.period, w.phase)), i = w.axis === 'x' ? 0 : w.axis === 'y' ? 1 : 2;
    const r = ud.swingRest;
    if (w.kind === 'slide') target.position.setComponent(i, r.p[i] + w.amount * k);
    else target.rotation.set(r.r[0] + (i === 0 ? w.amount * k : 0), r.r[1] + (i === 1 ? w.amount * k : 0), r.r[2] + (i === 2 ? w.amount * k : 0));
  }
}

// ---------------------------------------------------------------- world reading

export function waterAt(model: WorldModel, x: number, z: number): number | null {
  const g = model.ground(); let level: number | null = null;
  for (const w of g.waters) {
    if (w.area && pointInPoly(x, z, w.area)) level = w.level;
    else if (w.path && w.w && distToPath(x, z, w.path) < w.w / 2) level = w.level;
  }
  return level ?? (g.seaLevel !== undefined ? g.seaLevel : null);
}
function distToPath(x: number, z: number, path: [number, number][]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) { const [ax, az] = path[i - 1], [bx, bz] = path[i]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
  return best;
}
/** R4-LIVE: how dark the viewer's world clock makes it (0 day … 1 night), set every frame by the live view; null before
 *  any clock. Lamps then light at dusk and go out at dawn on their own, whatever the sky palette says. */
let clockNight: number | null = null;
export function setClockNight(n: number | null) { clockNight = n === null || !Number.isFinite(n) ? null : Math.max(0, Math.min(1, n)); }
export function nightOf(model: WorldModel | null): number {
  // r2.1: a world of kits and buildings binds no motion model (only meshes and animals do); its lamps still follow the clock
  if (!model) return clockNight ?? 0;
  if (clockNight !== null) return Math.max(clockNight, paletteNight(model));
  return paletteNight(model);
}
function paletteNight(model: WorldModel): number {
  const sky = model.state.sky as { palette?: string; sun?: number };
  if (/night|midnight/.test(sky.palette ?? '')) return 1;
  if (/dusk|dawn|twilight|sunset/.test(sky.palette ?? '')) return 0.6;
  return Math.min(1, Math.max(0, (0.3 - (sky.sun ?? 0.6)) / 0.2));
}

type Box = { c: [number, number]; half: [number, number]; yaw: number; y0: number; y1: number };
/** Solid footprints near a point, cached per model change (entity count) and refreshed every 8 s. */
class Obstacles {
  private boxes: Box[] = []; private key = ''; private at = -1e9;
  private model: WorldModel; private cx: number; private cz: number; private reach: number; private skip: Set<string>;
  constructor(model: WorldModel, cx: number, cz: number, reach: number, skip: Set<string>) { this.model = model; this.cx = cx; this.cz = cz; this.reach = reach; this.skip = skip; }
  list(t: number): Box[] {
    const k = `${this.model.entities.size}`;
    if (k === this.key && t - this.at < 8) return this.boxes;
    this.key = k; this.at = t; this.boxes = [];
    for (const { id, fp } of solidFootprints(this.model)) {
      if (this.skip.has(id)) continue;
      for (const b of fp) if (Math.hypot(b.c[0] - this.cx, b.c[1] - this.cz) < this.reach + Math.hypot(b.half[0], b.half[1]) && b.y1 - b.y0 > 0.12) this.boxes.push(b);
    }
    return this.boxes;
  }
}
/** Every solid's world footprint in entity order, scanned once per synchronous task and shared by all the creatures that
 *  refresh in it (lane L3e: at arrival every creature refreshes in the same frame, which was creatures x entities
 *  footprint calls, ~2.8 s of a 4x phone's arrival in Eden 2026). Nothing in one task changes the model between two
 *  creatures, and the cache also drops on any entity/def/terrain change, so each creature gets exactly the boxes its own
 *  scan would have built. The boxes are read-only.
 *  PERF-PASSES: the scan is kept across tasks for up to 2 s while the entity and def map revisions (ModelMap: a fresh
 *  object on every set / delete), the entity count and the terrain are the same. Creatures refresh their obstacles every
 *  8 s, staggered, so dropping it after each task re-scanned all ~5,000 entities on most frames of a quiet world. The
 *  2 s bound covers what the revisions do not see (a terrain edited in place); Obstacles already holds boxes for 8 s. */
let solidScan: { model: WorldModel; entities: object | undefined; defs: object | undefined; size: number; terrain: unknown; solids: { id: string; fp: Box[] }[]; at: number } | null = null;
const SOLID_SCAN_MS = 2000;
const revisionOf = (m: Map<string, unknown>) => (m as Map<string, unknown> & { revision?: object }).revision;
export function solidFootprints(model: WorldModel): readonly { id: string; fp: readonly Box[] }[] {
  const c = solidScan;
  const now = performance.now(), entities = revisionOf(model.entities), defs = revisionOf(model.defs);
  if (c && c.model === model && c.size === model.entities.size && c.entities === entities && c.defs === defs && c.terrain === model.terrain && (now - c.at < SOLID_SCAN_MS || (entities === undefined && defs === undefined))) return c.solids;
  const solids: { id: string; fp: Box[] }[] = [];
  model.readPass(() => { for (const e of model.entities.values()) {
    const d = model.resolvedDef(e.def); if (!d || d.layer !== 'solid' || d.make.kind === 'none') continue;
    let fp: Box[]; try { fp = model.footprint(e, d); } catch { continue; }
    solids.push({ id: e.id, fp });
  } });
  solidScan = { model, entities, defs, size: model.entities.size, terrain: model.terrain, solids, at: now };
  // a model without revisions (a plain Map in tests or fixtures) keeps the old rule: one scan per synchronous task
  if (entities === undefined || defs === undefined) queueMicrotask(() => { if (solidScan?.solids === solids) solidScan = null; });
  return solids;
}
export function surroundings(model: WorldModel, home: V2, reach: number, medium: 'land' | 'water', skip: Set<string>, area?: V2[]): Surroundings & { obstacles: Obstacles; t: number } {
  const obstacles = new Obstacles(model, home[0], home[1], reach + 4, skip);
  const half = model.constants.extent / 2 - 1;
  const s = {
    obstacles, t: 0, area,
    free(x: number, z: number, r: number) {
      if (Math.abs(x) > half || Math.abs(z) > half) return false;
      const g = model.terrain.sample(x, z), wl = waterAt(model, x, z), depth = wl === null ? -1 : wl - g;
      if (medium === 'water' ? depth < 0.25 : depth > 0.05) return false;
      if (medium === 'land' && model.terrain.slope(x, z) > 0.85) return false;
      for (const b of obstacles.list(s.t)) {
        if (b.y0 > g + 1.2 || b.y1 < g + 0.08) continue;   // overhead (table tops are fine to walk under) or flat
        const dx = x - b.c[0], dz = z - b.c[1], c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
        const lu = dx * c - dz * sn, lw = dx * sn + dz * c;
        if (Math.abs(lu) < b.half[0] + r && Math.abs(lw) < b.half[1] + r) return false;
      }
      return true;
    },
  };
  return s;
}

// ---------------------------------------------------------------- creatures

export type Gait = 'quadruped-walk' | 'biped-waddle' | 'bird-fly' | 'fish-swim' | 'hover' | 'none';
export type Rig = {
  gait: Gait; kind: BehaviorKind; speed: number; radius: number; seed: number; follow?: string;
  /** E2 #3: run from people closer than this (m); 0/undefined = unbothered */
  flee?: number; fleeState?: FleeState;
  /** ANI: the drawn offset while giving way to a Soul */
  giveWay?: GiveWayState;
  model: WorldModel | null; species?: string;
  roles: Record<string, THREE.Object3D | undefined>;
  /** hip height, body length (m, at scale 1) */
  hip: number; length: number; height: number;
  /** scale of this creature (herds scale their members; single entities take the layer's scale) */
  scale?: number;
  area?: V2[];
  // state (deterministic caches only; follow keeps a little smoothing state)
  plan?: Plan; world?: ReturnType<typeof surroundings>; cache?: RouteCache; homeKey?: string;
  followState?: { x: number; z: number; yaw: number; dist: number; t: number };
};

export function makeRig(obj: THREE.Object3D, o: Omit<Rig, 'roles' | 'hip' | 'length' | 'height'> & { box: [number, number, number] }): Rig {
  const roles: Rig['roles'] = {};
  obj.traverse((c) => { if (c.name.startsWith('role:')) roles[c.name.slice(5)] = c; });
  const hipRole = roles['leg.fl'] ?? roles['leg.l'];
  const hip = hipRole ? hipRole.position.y : o.box[1] * 0.4;
  const { box, ...rest } = o;
  return { ...rest, roles, hip, length: Math.max(box[0], box[2]), height: box[1] };
}

const WATER_KINDS = new Set<BehaviorKind>(['swim']);
const nocturnal = new Set(['fox', 'cat']);

/** One creature frame: behaviour → pose → gait. `base` gives the home (the entity's resting place). */
export function creatureStep(obj: THREE.Object3D, rig: Rig, entity: Entity | null, t: number, base: { y: number; yaw: number }, home?: V2) {
  const model = rig.model ?? boundModel;
  const s = rig.scale ?? obj.scale.x;
  const hx = home ? home[0] : obj.position.x, hz = home ? home[1] : obj.position.z;
  if (!model) { gait(obj, rig, idlePose(hx, hz, base.yaw), t, s, 0); return; }
  const key = `${hx.toFixed(2)},${hz.toFixed(2)},${rig.kind},${rig.radius},${rig.speed}`;
  if (rig.homeKey !== key || !rig.plan) {
    rig.homeKey = key;
    const medium = WATER_KINDS.has(rig.kind) ? 'water' : 'land';
    const skip = new Set<string>(entity ? [entity.id] : []);
    rig.plan = { kind: rig.kind, speed: rig.speed, radius: rig.radius, size: Math.max(0.12, rig.length * s * 0.35), seed: rig.seed, home: [hx, hz] };
    rig.world = surroundings(model, [hx, hz], rig.radius, medium, skip, rig.area);
    rig.cache = new RouteCache();
  }
  rig.world!.t = t;
  // night: diurnal animals sleep at home; fish and flyers keep going
  const night = nightOf(model);
  let kind = rig.kind;
  if (night > 0.6 && rig.gait !== 'fish-swim' && rig.gait !== 'bird-fly' && !nocturnal.has(rig.species ?? '') && kind !== 'swim') kind = 'sleep';
  let P: Pose;
  if (kind === 'follow' && rig.follow) P = followPose(rig, model, t, hx, hz);
  else if (kind !== rig.plan.kind) P = pose({ ...rig.plan, kind }, t, rig.world!, rig.cache!);
  else P = pose(rig.plan, t, rig.world!, rig.cache!);
  // E2 #3: shy animals bolt from people who come close, then wander back to their routine
  if (rig.flee && rig.gait !== 'fish-swim' && kind !== 'follow') P = fleeStep(rig.fleeState ??= { ox: 0, oz: 0, dist: 0, t }, P, fleeSources(t), rig.flee, rig.speed * s, t, (x, z) => rig.world!.free(x, z, rig.plan!.size));
  // ANI: everything on foot gives way to Souls instead of walking through them (drawn offset only; see give-way.ts)
  else if (rig.gait !== 'fish-swim' && P.alt < 0.3) P = yieldTo(rig.giveWay ??= giveWayState(), P, clearFor(rig.length * s), t, (x, z) => rig.world!.free(x, z, rig.plan!.size));
  // vertical: ground, water surface, or flight altitude
  const g = model.terrain.sample(P.x, P.z), wl = waterAt(model, P.x, P.z);
  const homeG = model.terrain.sample(hx, hz);
  const lift = home ? 0 : base.y - Math.max(homeG, (rig.kind === 'swim' && wl !== null) ? wl : -Infinity);  // keep a placed-on-a-deck offset
  let y = g + Math.max(0, Number.isFinite(lift) ? lift : 0), floating = false;
  if (wl !== null && wl > g + 0.05) {
    floating = true;
    y = rig.gait === 'fish-swim' ? wl - rig.height * s * 0.95 : wl - rig.hip * s * 1.05;
  }
  if (rig.gait === 'bird-fly') y += P.alt;
  obj.position.set(P.x, y, P.z);
  // pitch the body along the slope it walks on (small)
  const ahead = 0.5 * rig.length * s, gx = model.terrain.sample(P.x + Math.sin(P.yaw) * ahead, P.z + Math.cos(P.yaw) * ahead);
  const pitch = floating || P.alt > 0.2 ? 0 : Math.max(-0.35, Math.min(0.35, -Math.atan2(gx - g, ahead)));
  obj.rotation.set(pitch, P.yaw, 0, 'YXZ');
  gait(obj, rig, P, t, s, floating ? 1 : 0);
}
// ---------------------------------------------------------------- E2 #3: flee
export type FleeState = { ox: number; oz: number; dist: number; t: number };
/** The live view tells motion where people are (Souls' figures, x/z); null = nobody to run from or give way to. */
export const setFleeSources = setPeopleSource;
const fleeSources = peopleNow;
/** Offset the routine pose away from anyone within `reach`: a bolt at a run (3x walking, at least 1.5 m/s) for up to
 *  twice `reach` from the routine spot, stopping at anything solid; once nobody is near, walk back to the routine.
 *  `st` keeps the offset (the routine itself stays a pure function of time). */
export function fleeStep(st: FleeState, P: Pose, people: readonly (readonly [number, number])[], reach: number, speed: number, t: number, free: (x: number, z: number) => boolean): Pose {
  const dt = Math.min(0.25, Math.max(0, t - st.t)); st.t = t;
  const x = P.x + st.ox, z = P.z + st.oz;
  let near: readonly [number, number] | null = null, nd = reach;
  for (const q of people) { const d = Math.hypot(x - q[0], z - q[1]); if (d < nd) { nd = d; near = q; } }
  if (near) {
    const run = Math.max(1.5, speed * 3), d = Math.max(1e-3, nd), ux = (x - near[0]) / d, uz = (z - near[1]) / d, step = run * dt;
    const nx = st.ox + ux * step, nz = st.oz + uz * step;
    if (Math.hypot(nx, nz) <= reach * 2 && free(P.x + nx, P.z + nz)) { st.ox = nx; st.oz = nz; st.dist += step; }
    return { ...P, x: P.x + st.ox, z: P.z + st.oz, yaw: Math.atan2(ux, uz), speed: run, dist: st.dist, rest: 0, activity: 'walk', alt: 0 };
  }
  const off = Math.hypot(st.ox, st.oz);
  if (off < 0.05) { st.ox = 0; st.oz = 0; return P; }
  const back = Math.max(0.3, speed), step = Math.min(off, back * dt);
  st.ox -= (st.ox / off) * step; st.oz -= (st.oz / off) * step; st.dist += step;
  return { ...P, x: P.x + st.ox, z: P.z + st.oz, yaw: Math.atan2(-st.ox, -st.oz), speed: back, dist: st.dist, rest: 0, activity: 'walk', alt: 0 };
}
/** The routine pose `P`, moved out of the way of the people about (give-way.ts). */
export function yieldTo(st: GiveWayState, P: Pose, clear: number, t: number, free?: (x: number, z: number) => boolean): Pose {
  const g = giveWay(st, P.x, P.z, P.yaw, P.speed > 0.05, peopleNear(t, P.x, P.z, lookFor(st, clear)), clear, t, free);
  if (!g.active) return g.extra ? { ...P, dist: P.dist + g.extra } : P;
  const stepping = g.speed > 0.15;
  return { ...P, x: g.x, z: g.z, yaw: g.yaw, speed: stepping ? Math.max(P.speed, g.speed) : P.speed, dist: P.dist + g.extra,
    rest: stepping ? 0 : P.rest, activity: stepping && P.activity !== 'walk' ? 'walk' : P.activity };
}
function idlePose(x: number, z: number, yaw: number): Pose { return { x, z, yaw, speed: 0, dist: 0, rest: 1, activity: 'look', alt: 0, u: 0 }; }

function followPose(rig: Rig, model: WorldModel, t: number, hx: number, hz: number): Pose {
  const ref = model.get(rig.follow!);
  const st = rig.followState ??= { x: hx, z: hz, yaw: 0, dist: 0, t };
  const dt = Math.min(0.2, Math.max(0, t - st.t)); st.t = t;
  if (!ref) return idlePose(st.x, st.z, st.yaw);
  const wp = model.worldPose(ref), side = rand(rig.seed, 5) < 0.5 ? -1 : 1;
  const tx = wp.x + Math.sin(wp.yaw) * -1.4 + Math.cos(wp.yaw) * side * 0.9, tz = wp.z + Math.cos(wp.yaw) * -1.4 - Math.sin(wp.yaw) * side * 0.9;
  const dx = tx - st.x, dz = tz - st.z, d = Math.hypot(dx, dz);
  let sp = 0;
  if (d > 0.4) { sp = Math.min(rig.speed * (d > 4 ? 2.2 : 1), d / Math.max(dt, 1e-3)); const step = sp * dt; st.x += (dx / d) * step; st.z += (dz / d) * step; st.dist += step; const want = Math.atan2(dx, dz); st.yaw += (((want - st.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6); }
  return { x: st.x, z: st.z, yaw: st.yaw, speed: sp, dist: st.dist, rest: sp > 0.05 ? 0 : 1, activity: sp > 0.05 ? 'walk' : 'look', alt: 0, u: 0 };
}

const R = (rig: Rig, name: string) => rig.roles[name];
function setX(o: THREE.Object3D | undefined, v: number) { if (o) o.rotation.x = v; }

/** Pose the role pivots for the gait. `floating`: on water (paddle, no roll). Exported for the gallery studio. */
export function gait(obj: THREE.Object3D, rig: Rig, P: Pose, t: number, s: number, floating: number) {
  const sd = (rig.seed % 997) / 997 * Math.PI * 2;
  const nominal = Math.max(0.2, rig.speed);
  const m = Math.min(1, P.speed / (nominal * 0.6));                         // stride amplitude factor
  // swing amplitude by leg length (long legs swing less), and a stride (body travel per cycle) that
  // matches it — 4·hip·sin(amp) — so planted feet do not slide
  const legAmp = rig.gait === 'quadruped-walk' ? (rig.hip > 0.6 ? 0.34 : 0.42) : 0.5;
  const stride = Math.max(0.1, 4 * rig.hip * Math.sin(legAmp)) * s;
  const ph = (P.dist / stride) * Math.PI * 2 + sd;
  const breathe = Math.sin(t * (P.activity === 'sleep' ? 1.4 : 2.6) + sd);
  obj.scale.y = obj.scale.x * (1 + 0.012 * breathe);
  const head = R(rig, 'head'), tail = R(rig, 'tail');
  const turning = P.activity === 'turn' ? 1 : 0;
  switch (rig.gait) {
    case 'quadruped-walk': {
      const amp = legAmp * m + 0.12 * turning, tph = turning ? t * 9 : ph;
      // diagonal pairs: fore-left with hind-right, fore-right with hind-left
      setX(R(rig, 'leg.fl'), amp * Math.sin(tph)); setX(R(rig, 'leg.br'), amp * Math.sin(tph));
      setX(R(rig, 'leg.fr'), amp * Math.sin(tph + Math.PI)); setX(R(rig, 'leg.bl'), amp * Math.sin(tph + Math.PI));
      obj.position.y += (0.035 * rig.hip * s) * m * Math.cos(2 * ph);
      if (P.activity === 'sleep') {
        obj.position.y -= rig.hip * s * 0.72;
        setX(R(rig, 'leg.fl'), -1.35); setX(R(rig, 'leg.fr'), -1.35); setX(R(rig, 'leg.bl'), 1.35); setX(R(rig, 'leg.br'), 1.35);
      }
      if (head) {
        const graze = P.activity === 'graze' ? P.rest * (0.85 + 0.12 * Math.sin(t * 0.7 + sd)) : 0;
        const look = (P.activity === 'look' ? P.rest : 0) * 0.45 * Math.sin(t * 0.35 + sd);
        head.rotation.set(0.07 * m * Math.sin(2 * ph) + graze + (P.activity === 'sleep' ? 0.35 : 0) + 0.04 * (1 - m) * Math.sin(t * 1.3 + sd), look, 0, 'YXZ');
      }
      if (tail) { const wagF = rig.species === 'dog' || rig.species === 'pug' ? (m > 0.2 ? 7 : 11) : 1.6, wagA = rig.species === 'dog' || rig.species === 'pug' ? 0.45 : 0.2; tail.rotation.y = P.activity === 'sleep' ? 0 : wagA * Math.sin(t * wagF + sd); }
      break;
    }
    case 'biped-waddle': case 'bird-fly': {
      const flying = P.activity === 'fly';
      const amp = (floating ? 0.6 : 0.55) * m + 0.2 * turning, tph = floating ? t * 6 + sd : turning ? t * 10 : ph;
      setX(R(rig, 'leg.l'), flying ? -1.1 : amp * Math.sin(tph)); setX(R(rig, 'leg.r'), flying ? -1.1 : amp * Math.sin(tph + Math.PI));
      obj.rotation.z = floating || flying ? 0.03 * Math.sin(t * 1.1 + sd) : 0.09 * (m + turning * 0.5) * Math.sin(tph);
      if (!floating && !flying) obj.position.y += 0.02 * rig.hip * s * m * Math.abs(Math.sin(tph));
      if (floating) obj.position.y += 0.008 * s * Math.sin(t * 1.7 + sd);
      const wl = R(rig, 'wing.l'), wr = R(rig, 'wing.r');
      let flap = 0;
      if (flying) { const fast = (rig.species === 'seagull' ? 0.5 : 1) * (P.u < 0.25 || P.u > 0.8 ? 1 : 0.6); flap = 0.55 + 0.75 * Math.sin(t * (rig.species === 'seagull' ? 6 : 17) * fast + sd) * (rig.species === 'seagull' && P.u > 0.3 && P.u < 0.75 ? 0.25 : 1); }
      else if (P.activity === 'perch' || P.activity === 'look') flap = Math.max(0, Math.sin(t * 0.5 + sd)) ** 30 * 0.9 * Math.abs(Math.sin(t * 14));  // a stretch now and then
      if (wl) wl.rotation.z = flap; if (wr) wr.rotation.z = -flap;
      if (flying) obj.rotation.x = -0.12 * Math.cos(Math.PI * P.u);
      if (head) {
        const peck = (P.activity === 'graze' || (P.activity === 'perch' && !floating) ? P.rest : 0) * Math.max(0, Math.sin(t * 2.3 + sd)) ** 6 * 1.0;
        const look = (P.activity === 'look' ? P.rest : 0) * 0.6 * Math.sin(t * 0.6 + sd);
        head.rotation.set(peck + 0.12 * m * Math.sin(2 * tph) + (floating ? 0.04 * Math.sin(t * 2 + sd) : 0), look, 0, 'YXZ');
      }
      break;
    }
    case 'fish-swim': {
      const f = 2.5 + 6 * m;
      if (tail) tail.rotation.y = 0.45 * Math.sin(t * f + sd);
      obj.rotation.y += 0.06 * Math.sin(t * f + sd + Math.PI / 2);
      obj.position.y += 0.02 * s * Math.sin(t * 0.8 + sd);
      break;
    }
    case 'hover': obj.position.y += 0.1 * Math.sin(t * 1.5 + sd); break;
    default: break;
  }
}

// ---------------------------------------------------------------- routes and lights

/** Follow the entity's own path shape, or a ref entity's path (a road, a river), at `speed` m/s. */
function routeStep(obj: THREE.Object3D, e: Entity, def: StoredDef, model: WorldModel, t: number, base: { y: number; yaw: number }): boolean {
  const r = def.components.route!;
  const refE = r.ref ? model.get(r.ref) : null;
  const shape = (refE?.shape ?? e.shape) as { path?: V2[] } | undefined;
  const path = shape?.path; if (!path || path.length < 2) return false;
  const segs: number[] = []; let len = 0;
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); segs.push(l); len += l; }
  if (len < 1e-3) return false;
  const closed = Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) < 0.5;
  const off = rand(e.seed ?? seedOf(e.id), 1) * len;
  let d = t * r.speed + off;
  if (r.loop && closed) d = ((d % len) + len) % len;
  else { const q = ((d % (2 * len)) + 2 * len) % (2 * len); d = q > len ? 2 * len - q : q; }
  const pt = (dd: number): V2 => { let s = dd; for (let i = 0; i < segs.length; i++) { if (s <= segs[i] || i === segs.length - 1) { const k = segs[i] ? Math.min(1, Math.max(0, s / segs[i])) : 0; return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]; } s -= segs[i]; } return path[path.length - 1]; };
  const p = pt(d), ahead = pt(Math.min(len, d + 2)), behind = pt(Math.max(0, d - 2));
  const g = model.terrain.sample(p[0], p[1]), wl = waterAt(model, p[0], p[1]);
  const floats = def.anchor === 'float' || def.tags.includes('boat');
  const y = (floats && wl !== null ? wl : g) + r.altitude;
  obj.position.set(p[0], y, p[1]);
  obj.rotation.y = Math.atan2(ahead[0] - behind[0], ahead[1] - behind[1]);
  void base;
  return true;
}

// ---------------------------------------------------------------- boats

/** W2b: a boat — any def tagged boat that floats (rowing boats, canoes, sailboats, god-made boats; not a boat-shaped
 *  building on land). */
export function isBoat(def: Pick<StoredDef, 'tags' | 'anchor'>): boolean { return def.anchor === 'float' && def.tags.includes('boat'); }
const MOOR_WORDS = /pier|dock|jetty|pontoon|quay|wharf|marina|boardwalk|breakwater|landing|mooring/;
type BoatRest = { x: number; z: number; drift: number; moored: boolean; size: number; beached?: boolean };
/** Where a boat rests and how far it may drift: a boat within a few metres of land, a pier or a solid is moored
 *  (it sways on its lines, no drift); one on open water drifts on a slow loop, at most 40% of its clear water (≤ 6 m). */
export function boatRest(model: WorldModel | null, e: Entity, def: StoredDef, x: number, z: number, scale = 1): BoatRest {
  const box = def.size?.box ?? [2, 1, 3], size = Math.max(box[0], box[2]) * scale, half = Math.min(box[0], box[2]) * scale / 2;
  if (!model) return { x, z, drift: 0, moored: true, size };
  const boxes: Box[] = [];
  for (const { id, fp } of boatSolids(model)) if (id !== e.id) for (const b of fp) if (Math.hypot(b.c[0] - x, b.c[1] - z) < 20 + Math.hypot(b.half[0], b.half[1])) boxes.push(b);
  const half2 = model.constants.extent / 2 - 1;
  const s = { free(px: number, pz: number, r: number) {
    if (Math.abs(px) > half2 || Math.abs(pz) > half2) return false;
    const g = model.terrain.sample(px, pz), wl = waterAt(model, px, pz); if (wl === null || wl - g < 0.25) return false;
    for (const b of boxes) { if (b.y1 < wl + 0.05) continue; const dx = px - b.c[0], dz = pz - b.c[1], c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      if (Math.abs(dx * c - dz * sn) < b.half[0] + r && Math.abs(dx * sn + dz * c) < b.half[1] + r) return false; }
    return true;
  } };
  { const wl = waterAt(model, x, z); if (wl === null || wl - model.terrain.sample(x, z) < 0.15) return { x, z, drift: 0, moored: true, size, beached: true }; } // drawn up on the shore: still
  let clear = 16;
  rings: for (const r of [size / 2 + 0.8, size / 2 + 2, size / 2 + 3.5, 6, 9, 12, 16]) {
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; if (!s.free(x + Math.cos(a) * r, z + Math.sin(a) * r, half)) { clear = r - size / 2; break rings; } }
  }
  // piers and pontoons are walkable surfaces (not solids): a boat alongside one is moored to it
  let pier = Infinity;
  for (const m of moorings(model)) pier = Math.min(pier, distToPath(x, z, m.path) - m.w / 2 - size / 2);
  const moored = clear < 2.6 || pier < 2.5;
  return { x, z, moored, size, drift: moored ? 0 : Math.max(0, Math.min(6, clear * 0.4, (pier - 1) * 0.4)) };
}
let boatSolidScan: { model: WorldModel; key: string; at: number; list: readonly { id: string; fp: readonly Box[] }[] } | null = null;
/** The solids' footprints for boats' water surveys, kept between frames (refreshed on any model change, or after 30 s). */
function boatSolids(model: WorldModel) {
  const key = `${model.entities.size}`, now = performance.now(), c = boatSolidScan;
  if (c && c.model === model && c.key === key && c.list.length && now - c.at < 30000) return c.list;
  const list = solidFootprints(model); boatSolidScan = { model, key, at: now, list };
  return list;
}
let mooringScan: { model: WorldModel; size: number; list: { path: [number, number][]; w: number }[] } | null = null;
/** Every pier, jetty or pontoon path in the world (scanned once per model change, shared by all boats). */
function moorings(model: WorldModel) {
  if (mooringScan?.model === model && mooringScan.size === model.entities.size) return mooringScan.list;
  const list: { path: [number, number][]; w: number }[] = [];
  model.readPass(() => { for (const p of model.entities.values()) {
    const path = (p.shape as { path?: [number, number][] } | undefined)?.path; if (!path || path.length < 2) continue;
    const pd = model.resolvedDef(p.def); if (!pd || !MOOR_WORDS.test(`${pd.name} ${pd.tags.join(' ')} ${(p as { name?: string }).name ?? ''}`)) continue;
    list.push({ path, w: Number((p.params as Record<string, unknown> | undefined)?.width ?? pd.size?.box?.[2] ?? 2) });
  } });
  mooringScan = { model, size: model.entities.size, list };
  return list;
}
/** Boats drawn afloat (not beached), for the water's ring ripples and wakes (WorldWaterDetail reads their drawn
 *  positions; render-time only). Left on removal from their parent; the reader also drops any no longer in its scene. */
export const AFLOAT = new Set<THREE.Object3D>();
/** At most one boat surveys its water per frame (none during the first seconds of arrival); drift then eases in. */
/** Phones: boats sway in place, no water survey. */
let surveyFrame = -1;
const onPhone = () => (globalThis as { __simQuality?: { tier?: string } }).__simQuality?.tier === 'phone';
/** Bob on the swell, roll and pitch; moored boats swing a little on their lines; free boats drift on a slow loop and
 *  turn with it. A pure function of world time and the entity's seed, like every motion here. */
function boatStep(obj: THREE.Object3D, e: Entity, def: StoredDef, model: WorldModel | null, t: number, base: { y: number; yaw: number }, phase: number, routed: boolean) {
  const ud = obj.userData as { boat?: BoatRest & { at?: number; born?: number; ms?: number } };
  const x0 = obj.position.x, z0 = obj.position.z;
  // a boat under way (rowed, towed, moved by a god) holds still on its lines; its water is surveyed once it has rested 1 s
  if (!ud.boat || Math.abs(ud.boat.x - x0) > 0.05 || Math.abs(ud.boat.z - z0) > 0.05) ud.boat = { x: x0, z: z0, drift: 0, moored: true, size: ud.boat?.size ?? 3, at: t };
  else if (ud.boat.at !== undefined && t - ud.boat.at > 1 && surveyFrame !== Math.floor(t * 60) && !onPhone()) { surveyFrame = Math.floor(t * 60); const a = performance.now(); ud.boat = { ...boatRest(model, e, def, x0, z0, obj.scale.x), born: t, ms: performance.now() - a }; }
  const b = ud.boat; if (b.beached) { AFLOAT.delete(obj); obj.rotation.set(0, base.yaw, 0); return; }
  if (!AFLOAT.has(obj)) { AFLOAT.add(obj); const off = () => { AFLOAT.delete(obj); obj.removeEventListener('removed', off); }; obj.addEventListener('removed', off); }
  const c = def.components, k = Math.max(0.5, Math.min(2, 3 / Math.max(1, b.size)));   // small boats move more
  const T = Math.PI * 2, bob = c.hover?.bob ?? 0.05, period = c.hover?.period ?? 3.4;
  const swell = Math.sin((t * T) / period + phase) + 0.35 * Math.sin((t * T) / (period * 2.3) + phase * 1.7);
  obj.position.y = (routed ? obj.position.y : base.y + (c.hover?.height ?? 0)) + bob * swell;
  obj.rotation.order = 'YXZ';
  const roll = (b.moored ? 0.05 : 0.035) * k, pitch = 0.018 * k;
  obj.rotation.z = roll * Math.sin((t * T) / (period * 1.27) + phase * 2.3) + (c.sway ? c.sway.amount * 0.3 * Math.sin((t * T) / c.sway.period + phase) : 0);
  obj.rotation.x = pitch * Math.sin((t * T) / (period * 0.93) + phase * 0.7);
  if (routed) return;
  if (b.moored) {                       // on its lines: a short surge fore and aft and a slow swing of the bow
    const surge = 0.12 * Math.sin((t * T) / 11 + phase), cy = Math.cos(base.yaw), sy = Math.sin(base.yaw);
    obj.position.x = x0 + surge * sy; obj.position.z = z0 + surge * cy;
    obj.rotation.y = base.yaw + 0.05 * Math.sin((t * T) / 17 + phase * 1.3);
    return;
  }
  const ease = Math.min(1, (t - (b.born ?? t)) / 10), P = 180 + (phase / T) * 120, R = b.drift * ease * ease * (3 - 2 * ease);  // one slow loop every 3-5 minutes
  obj.position.x = x0 + R * Math.sin((t * T) / P + phase);
  obj.position.z = z0 + R * Math.sin((t * T) / (P * 1.37) + phase * 2);
  obj.rotation.y = base.yaw + 0.35 * (R / Math.max(1e-6, b.drift)) * Math.sin((t * T) / (P * 0.9) + phase * 0.5);
}

/** Lamps glow at dusk and night; `state.on: false` darkens this one. Lane PERF-MATERIALS: a glow level is a shared
 *  variant of the part's library material (material-variants.ts), one per (material, level in ~1% steps), not a clone
 *  per lamp: Eden 2026 had 813 lamp materials for 16 distinct looks. A flame part's variant is also its dimmed albedo. */
type GlowPart = { mesh: THREE.Mesh; base: THREE.MeshStandardMaterial; flame: boolean; gain: number };
/** Glow levels per e-fold of intensity: steps of ~1% (relative, so a dim day glow keeps its ratios like a bright night one). */
export const GLOW_STEPS = 96;
export function quantizeGlow(v: number): number { return v <= 1e-4 ? 0 : Math.exp(Math.round(Math.log(v) * GLOW_STEPS) / GLOW_STEPS); }
function setGlow(p: GlowPart, v: number) {
  const q = quantizeGlow(v), cur = p.mesh.material as THREE.MeshStandardMaterial;
  if (cur !== p.base && cur.emissiveIntensity === q) return;
  p.mesh.material = variantOf(p.base, (p.flame ? 'flame-glow:' : 'glow:') + q, (m) => {
    // W2: a flame part glows by itself; its lit albedo plus a night-boosted emissive clipped it to white ("an orange cone")
    if (p.flame) { m.userData.flameCap = FLAME_GLOW_CAP; m.color.multiplyScalar(0.15); }
    m.emissiveIntensity = q;
  });
}
export function syncLightGlow(obj: THREE.Object3D, e: Entity, def: StoredDef, model: WorldModel | null, t: number) {
  const ud = obj.userData as { glow?: GlowPart[] };
  if (!ud.glow) {
    const parts: GlowPart[] = [];
    obj.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && (m as { emissive?: THREE.Color }).emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0 && !c.userData.shadowProxy) { parts.push({ mesh: c as THREE.Mesh, base: m, flame: isFlamePart(c), gain: m.userData.kitGlowIntensity ?? 1 }); c.userData.renderDynamic = true; } });  // PERF-BATCH: its glow level changes over time: never merged
    ud.glow = parts;
  }
  const lights=defLights(def.components),off = e.state?.on === false || lights.every(l=>l.on===false);
  if (off) { for (const p of ud.glow) setGlow(p, 0); return; }
  const reduced=!!reducedLightMotion?.matches;
  const patterned=lights.some(l=>l.pattern&&l.pattern!=='steady'),flame=!patterned&&flickers(e.def); // W2: a flame's own glow flickers with its pool
  const pattern=flame?lightPatternLevel('flicker',t,lightPhase(e.id,0,1,'flicker'),reduced):patterned?lights.reduce((v,l,i)=>v+(l.on===false?0:lightPatternLevel(l.pattern,t,lightPhase(e.id,i,lights.length,l.pattern),reduced)),0)/lights.length:1;
  const night = nightOf(model), level = (0.25 + 1.4 * night + (patterned||flame?0:0.03 * Math.sin(t * 3)))*pattern;
  // K1 / XP1: retain v2's per-shape glow level through the day/night and pattern multiplier.
  for (const p of ud.glow) { const v = level * p.gain; setGlow(p, p.flame ? Math.max(FLAME_GLOW_MIN, Math.min(v, FLAME_GLOW_CAP)) : v); }
}
/** W2: the brightest a flame part's emissive gets (×its tint): saturated orange, never clipped white by the night boost. */
const FLAME_GLOW_CAP = 0.85, FLAME_GLOW_MIN = 0.55;
/** W2: a mesh that draws a flame — a kit part with `role: flame`, or one tinted flame/ember/fire. */
export function isFlamePart(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) { if (p.name === 'role:flame') return true; if (p.userData?.role) return false; }
  return false;
}

function pointInPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
