// Work access for progressive construction — Mars assembly model v1, approximate
// (rule-based plausibility, not ergonomics). Where may a crew member stand to set
// a component whose top is at height y?
//   * on the ground or on any walkable deck level in the Spatial scene — decks
//     only appear there once installed AND supported (contributor.ts) — whose
//     floor is at most STANDING_REACH below y and not above y ("work from deck");
//   * within ARM_REACH horizontally of the component's footprint;
//   * with standing room (clearance ≥ radius + 0.03), not inside the component's
//     own footprint when it would be a body-height obstacle on that level, not
//     next to another person, and with a walking route from where they are now.
// Ladders / scaffold are not modelled: work more than 2.1 m above every
// accessible floor is refused (`reach.too-high`).
import { angleDelta, datan2, dcos, dsin, obbOverlap, rot2, sub2, type OBB2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import type { Obstacle } from '../spatial/types.ts';
import { def } from '../world/catalog.ts';
import { cellOf, clearanceAt, type LevelGrid } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { holdingDiagnostic, isKitUpright, STANDING_REACH } from './rules.ts';
import { NOTCH } from '../world/catalog-phase-b.ts';
import { childrenState, walkCrew, type Children } from './children.ts';
import { BODY_MODEL } from '../body/model.ts';
import { CREW_BLOCK_TIMEOUT, FOLLOW_SPEED, followCrew, handPoint, LIFT_APEX_MAX, pickupPlan, STATION_SLOT, type Hand } from './liftcrew.ts';

export const ARM_REACH = BODY_MODEL.maxHorizontalFromFeet; // m, horizontal: station → nearest point of the component (0.8)
export const STAGE_RADIUS = 3.0; // m: components must be delivered (carried) this close before installing
export const LEVEL_STEP = 0.5; // m: deck level ids are round(y / LEVEL_STEP) — stable, height-derived
export const levelFor = (y: number) => Math.round(y / LEVEL_STEP);

export type Station = { actor: string; level: number; p: Vec2; yaw: number };
export type Fail = { ok: false; diagnostic: Diagnostic };
export const fail = (code: string, message: string, subjects: string[], at?: Vec3): Fail => ({ ok: false, diagnostic: { code, message, subjects, at } });
export const f2 = (x: number) => x.toFixed(2);

/** A component about to be installed: footprint, top (work height) and bottom. */
export type WorkTarget = { label: string; obb: OBB2; y: number; y0: number;
  /** PC17 (#696): a body standing idle does not take a station from the crew: the crew's walk there asks it to step aside (walk.ts makeWay). */
  yieldIdle?: true };

export function spatialOf(rt: Runtime): Spatial {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  return sp;
}

export function distToObb(p: Vec2, o: OBB2): number {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return hypot(Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0));
}

/** Crew sanity shared by the construction verbs. */
export function crewCheck(rt: Runtime, crew: string[], min: number, max: number, what: string): Fail | null {
  if (new Set(crew).size !== crew.length) return fail('crew.duplicate', `crew for ${what} lists someone twice`, crew);
  if (crew.length < min || crew.length > max)
    return fail('crew.size', `${what} needs ${min === max ? min : `${min}–${max}`} ${max === 1 ? 'person' : 'people'}; ${crew.length} assigned`, crew);
  for (const c of crew) {
    if (rt.world.entities[c]?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const d = holdingDiagnostic(rt.world, c);
    if (d) return { ok: false, diagnostic: d };
  }
  return null;
}

/** Component lying at the work area (delivered by `carry`), within STAGE_RADIUS of where it goes. */
export function stagedCheck(e: Entity, target: Vec2, code: string): Fail | null {
  if (!(e.phase === 'staged' || e.phase === 'stored') || e.support?.kind !== 'ground')
    return fail(code, `${e.id} must be lying on the ground at the work area (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
  const d = hypot(e.pose.p[0] - target[0], e.pose.p[2] - target[1]);
  if (d > STAGE_RADIUS)
    return fail(code, `${e.id} lies ${f2(d)} m from where it goes (${f2(target[0])}, ${f2(target[1])}); carry it within ${STAGE_RADIUS} m first`, [e.id]);
  return null;
}

/**
 * Pick one station per crew member (anchors[i] = the spot crew member i should
 * be near, e.g. one end of a joist). Deterministic: candidates are generated in
 * a fixed lattice order and sorted by (floor height, distance to anchor, index).
 */
export function findStations(rt: Runtime, crew: string[], anchors: Vec2[], t: WorkTarget, avoid: OBB2[] = []): { ok: true; stations: Station[] } | Fail {
  const sp = spatialOf(rt);
  const w = rt.world;
  const r = HUMAN_PROFILE.radius;
  const levels = [...sp.scene.levels].sort((a, b) => a.y - b.y || a.id - b.id);
  const eligible = levels.filter((lv) => lv.y <= t.y + 0.05 && t.y - lv.y <= STANDING_REACH);
  if (!eligible.length) {
    const below = levels.filter((lv) => lv.y <= t.y);
    const top = below[below.length - 1];
    return fail(
      'reach.too-high',
      `${t.label} at ${f2(t.y)} m is out of reach: the highest walkable floor below it (${top ? `level ${top.id} at ${f2(top.y)} m` : 'none'}) is ${top ? f2(t.y - top.y) : '?'} m down (standing reach ${STANDING_REACH} m) and no supported deck lies within reach; ladders/scaffold are not modelled`,
      crew,
    );
  }
  type Cand = { level: number; y: number; p: Vec2; k: number };
  const cands: Cand[] = [];
  const others = Object.values(w.entities).filter((e) => e.kind === 'human' && e.human && !crew.includes(e.id) && !(t.yieldIdle && e.human.activity === 'idle' && !e.human.task && !e.human.grip));
  const R = ARM_REACH, STEP = 0.2;
  for (const lv of eligible) {
    const g = sp.level(lv.id);
    if (!g) continue;
    const bodyBand = t.y0 < lv.y + HUMAN_PROFILE.height && t.y > lv.y + HUMAN_PROFILE.stepHeight;
    const nu = Math.floor((t.obb.half[0] + R) / STEP), nv = Math.floor((t.obb.half[1] + R) / STEP);
    for (let i = -nu; i <= nu; i++)
      for (let j = -nv; j <= nv; j++) {
        const o = rot2([i * STEP, j * STEP], t.obb.yaw);
        const p: Vec2 = [t.obb.c[0] + o[0], t.obb.c[1] + o[1]];
        const d = distToObb(p, t.obb);
        if (d > R) continue;
        if (bodyBand && d < r + 0.05) continue;
        if (clearanceAt(g, p) < r + 0.03) continue;
        if (avoid.some((a) => distToObb(p, a) < r + 0.05)) continue;
        if (others.some((h) => h.human!.level === lv.id && hypot(h.pose.p[0] - p[0], h.pose.p[2] - p[1]) < 2 * r + 0.1)) continue;
        cands.push({ level: lv.id, y: lv.y, p, k: cands.length });
      }
  }
  const chosen: Station[] = [];
  for (const [i, actor] of crew.entries()) {
    const a = w.entities[actor];
    const anchor = anchors[Math.min(i, anchors.length - 1)];
    const order = cands
      .filter((c) => !chosen.some((s) => s.level === c.level && hypot(s.p[0] - c.p[0], s.p[1] - c.p[1]) < 2 * r + 0.15))
      .sort((x, y) => x.y - y.y || hypot(x.p[0] - anchor[0], x.p[1] - anchor[1]) - hypot(y.p[0] - anchor[0], y.p[1] - anchor[1]) || x.k - y.k);
    let pick: Station | null = null;
    let lastWhy = '';
    // a failed route marks the candidate's whole connected standing region as unreachable
    // (e.g. the enclosed floor inside a rack bay), so it costs one search, not one per cell
    const bad = new Map<number, Uint8Array>();
    let tries = 0;
    for (const c of order) {
      const g = sp.level(c.level)!;
      const cell = cellOf(g, c.p);
      if (bad.get(c.level)?.[cell]) continue;
      if (++tries > 24) break;
      const rr = sp.route(w, HUMAN_PROFILE, { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] }, { level: c.level, p: c.p });
      if (!rr.ok) {
        lastWhy = rr.diagnostic.message;
        if (!bad.has(c.level)) bad.set(c.level, new Uint8Array(g.nx * g.nz));
        floodMark(g, cell, r, bad.get(c.level)!);
        continue;
      }
      pick = { actor, level: c.level, p: c.p, yaw: datan2(anchor[1] - c.p[1], anchor[0] - c.p[0]) };
      break;
    }
    if (!pick)
      return fail(
        'reach.no-station',
        `${actor} has no reachable place to stand within ${ARM_REACH} m of ${t.label} (${f2(t.y)} m up; floors within reach: ${eligible.map((l) => `level ${l.id} at ${f2(l.y)} m`).join(', ')})${lastWhy ? `: ${lastWhy}` : order.length ? '' : ': no standing room there'}`,
        [actor],
        [anchor[0], t.y, anchor[1]],
      );
    chosen.push(pick);
  }
  return { ok: true, stations: chosen };
}

function floodMark(g: LevelGrid, start: number, r: number, mark: Uint8Array) {
  const q = [start];
  mark[start] = 1;
  while (q.length) {
    const k = q.pop()!;
    const i = k % g.nx, j = (k - i) / g.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const m = nj * g.nx + ni;
      if (!mark[m] && g.clearance[m] >= r) { mark[m] = 1; q.push(m); }
    }
  }
}

// ---- shared execution: walk the crew to stations, then lift the part into place ----

/** slots: grip slot per crew member (liftcrew.ts); stall: seconds the part has waited for its crew. */
export type LiftExec = { id: string; crew: string[]; item: string; phase: 'approach' | 'place'; children?: Children; t: number; from: Pose; to: Pose; duration: number; path?: Pose[]; slots?: string[]; stall?: number };

export function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function lerpPose(a: Pose, b: Pose, s: number): Pose {
  const dy = datan2(dsin(b.yaw - a.yaw), dcos(b.yaw - a.yaw));
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * s, a.p[1] + (b.p[1] - a.p[1]) * s, a.p[2] + (b.p[2] - a.p[2]) * s],
    yaw: a.yaw + dy * s,
    pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * s,
    roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * s,
  };
}

/**
 * 'arrived' when every crew member stands where they take hold (liftcrew pickupPlan: beside the part's
 * hand points, or at their station when `follow` is off / they work from a level above the part).
 */
export function approach(rt: Runtime, ex: LiftExec, stations: Station[], code: string, follow = true): 'running' | 'arrived' | Diagnostic {
  if (!ex.children) {
    let moves = stations.map((s) => ({ actor: s.actor, p: s.p, yaw: s.yaw, level: s.level }));
    if (follow) {
      const pk = pickupPlan(rt, ex.crew, rt.world.entities[ex.item], ex.to, stations);
      if ('code' in pk) return pk;
      ex.slots = pk.slots;
      moves = pk.moves;
    }
    const r = walkCrew(rt, ex.id, moves);
    if ('code' in r) return { ...r, code };
    ex.children = r;
  }
  const s = childrenState(ex.children);
  if (s === 'running') return 'running';
  if (s !== 'done') return s;
  return 'arrived';
}

export function beginLift(rt: Runtime, ex: LiftExec) {
  const item = rt.world.entities[ex.item];
  item.phase = 'carried';
  item.support = { kind: 'held', by: [...ex.crew] };
  ex.from = { ...item.pose, p: [...item.pose.p] };
  for (const [i, c] of ex.crew.entries())
    Object.assign(rt.world.entities[c].human!, { activity: 'lift', grip: { entity: item.id, slot: ex.slots?.[i] ?? STATION_SLOT }, task: ex.id });
}

/**
 * Advance the lift one tick: true when the part is seated, false while it moves (or waits for its
 * crew), a `lift.crew-blocked` diagnostic once a holder has been stuck > CREW_BLOCK_TIMEOUT. With
 * `follow`, the part is paced so no hand point outruns FOLLOW_SPEED and holders walk beside it.
 */
export function liftStep(rt: Runtime, ex: Pick<LiftExec, 'crew' | 'item' | 't' | 'from' | 'to' | 'duration' | 'path' | 'stall'>, dt: number, follow = true): boolean | Diagnostic {
  const item = rt.world.entities[ex.item];
  const path = ex.path ?? [ex.from, ex.to];
  let t = Math.min(1, ex.t + dt / ex.duration);
  let q = pathPose(path, t);
  const slots = follow ? ex.crew.map((c) => rt.world.entities[c].human?.grip?.slot ?? '') : [];
  const hands = (p: Pose) => slots.map((s) => handPoint(item, p, s)).filter((h): h is Hand => !!h);
  const h0 = hands(item.pose);
  if (h0.length) {
    for (let k = 0; k < 6; k++) {
      const dh = Math.max(0, ...hands(q).map((h, i) => hypot(h.p[0] - h0[i].p[0], h.p[2] - h0[i].p[2])));
      if (dh <= FOLLOW_SPEED * dt) break;
      t = ex.t + (t - ex.t) * ((FOLLOW_SPEED * dt) / dh) * 0.95;
      q = pathPose(path, t);
    }
    const f = followCrew(rt, item, ex.crew, q, dt);
    if (!f.ok) {
      ex.stall = (ex.stall ?? 0) + dt;
      if (!f.stuck || ex.stall <= CREW_BLOCK_TIMEOUT) return false;
      return {
        code: 'lift.crew-blocked',
        message: `${f.stuck.who} cannot keep hold of ${item.id} on its way into place: blocked by ${f.stuck.why} for over ${CREW_BLOCK_TIMEOUT} s; the crew holds it and waits`,
        subjects: [item.id, f.stuck.who],
        at: item.pose.p,
      };
    }
    ex.stall = 0;
  }
  ex.t = t;
  item.pose = q;
  return ex.t >= 1;
}

// ---- swept lifts: the part's box along its path must not pass through anything ----
// A lift moves a part from where it lies to its seat. Plan time (and again at the
// moment of lifting) samples the path and tests the part's box (entityCorners →
// entityFootprint prism) against every scene obstacle — static geometry and
// components — except the part itself, the parts it will rest on / seat into
// (`ignore`), and anything it already touches where it lies. If the straight path
// is blocked, try the standard "lift over": straight up until its underside is
// LIFT_OVER above its seated top, across (turning on the way), then straight down.

export const LIFT_SAMPLES = 24; // minimum samples per path segment
const LIFT_SAMPLE_STEP = 0.03; // m: max displacement of any point of the part between samples
export const LIFT_OVER = 0.3; // m of clearance above the seated part's top for a lift-over
export const LIFT_PACE = 1.0; // m/s: pace of a multi-segment lift (the straight lift keeps its verb's duration)

/** floor: height of the floor the lifting crew stands on (lift-over apex rule; default: where the part lies). */
export type SweepOpts = { ignore: string[]; liftOver?: boolean; what?: string; floor?: number };
export type LiftPath = { poses: Pose[]; via: 'straight' | 'lift-over' };
export type Hit = { o: Obstacle; q: Pose };

const partExtent = (e: Entity) => hypot(...def(e.def).size) / 2;

/**
 * Seated yaw for an end-for-end symmetric part (2x4, sheet, tread): of `yaw` and `yaw + π`, the one
 * nearest the yaw it lies at, so it is not spun half a turn in the air.
 */
export function symmetricYaw(from: number, yaw: number): number {
  return Math.abs(angleDelta(from, yaw)) > Math.PI / 2 ? yaw + Math.PI : yaw;
}

/** Pose at time fraction t along a waypoint path: segment times ∝ length, eased within each segment. */
export function pathPose(ps: Pose[], t: number): Pose {
  if (ps.length === 2) return lerpPose(ps[0], ps[1], smooth(t));
  const lens = ps.slice(1).map((q, i) => hypot(q.p[0] - ps[i].p[0], q.p[1] - ps[i].p[1], q.p[2] - ps[i].p[2]) + 1e-9);
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const f = lens[i] / total;
    if (t <= acc + f || i === lens.length - 1) return lerpPose(ps[i], ps[i + 1], smooth(Math.min(1, Math.max(0, (t - acc) / f))));
    acc += f;
  }
  return ps[ps.length - 1];
}

export const pathLength = (ps: Pose[]) => ps.slice(1).reduce((a, q, i) => a + hypot(q.p[0] - ps[i].p[0], q.p[1] - ps[i].p[1], q.p[2] - ps[i].p[2]), 0);

/** Duration of a lift along `path`: the verb's own duration for a straight lift, paced for a lift-over. */
export const liftDuration = (path: LiftPath, base: number) => (path.via === 'straight' ? base : Math.max(base, pathLength(path.poses) / LIFT_PACE));

/**
 * Notched parts (year builds phase B, catalog-phase-b.ts NOTCH — PROVISIONAL): a deck sheet / board / handrail
 * notched at the cutting station around a reconstruction frame's columns and bracing may share up to its notch
 * depth of its edges with that frame (the Kit draws deck sheets through the frame planes). `soft` = the Kit
 * upright obstacles such a part is tested against with its footprint shrunk by the notch depth; everything
 * else — and every part without a notch — is tested as before.
 */
export function notchSoft(rt: Runtime, e: Entity): { ids: Set<string>; depth: number } | undefined {
  const depth = NOTCH[e.def];
  if (!depth) return undefined;
  return { ids: new Set(Object.values(rt.world.entities).filter((u) => isKitUpright(u)).map((u) => u.id)), depth };
}

function segmentHit(sp: Spatial, e: Entity, a: Pose, b: Pose, skip: Set<string>, soft?: { ids: Set<string>; depth: number }): Hit | null {
  const ext = partExtent(e);
  const disp = hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2])
    + ext * (Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0)));
  const n = Math.max(LIFT_SAMPLES, Math.ceil(disp / LIFT_SAMPLE_STEP));
  // broad phase: obstacles near the segment's bounding box
  const lo = [Math.min(a.p[0], b.p[0]) - ext, Math.min(a.p[1], b.p[1]) - ext, Math.min(a.p[2], b.p[2]) - ext];
  const hi = [Math.max(a.p[0], b.p[0]) + ext, Math.max(a.p[1], b.p[1]) + ext, Math.max(a.p[2], b.p[2]) + ext];
  const near = sp.scene.obstacles.filter((o) => {
    if (o.id === e.id || skip.has(o.id) || o.y1 <= lo[1] || o.y0 >= hi[1]) return false;
    const r = hypot(o.obb.half[0], o.obb.half[1]);
    return o.obb.c[0] + r >= lo[0] && o.obb.c[0] - r <= hi[0] && o.obb.c[1] + r >= lo[2] && o.obb.c[1] - r <= hi[2];
  });
  if (!near.length) return null;
  for (let k = 1; k <= n; k++) {
    const q = lerpPose(a, b, k / n);
    const f = entityFootprint({ ...e, pose: q });
    for (const o of near) {
      if (o.y1 <= f.y0 + 0.005 || o.y0 >= f.y1 - 0.005) continue;
      const fo = soft?.ids.has(o.id) ? { ...f.obb, half: [Math.max(0.001, f.obb.half[0] - soft.depth), Math.max(0.001, f.obb.half[1] - soft.depth)] as Vec2 } : f.obb;
      if (obbOverlap(fo, o.obb, -0.01)) return { o, q };
    }
  }
  return null;
}

function pathHit(sp: Spatial, e: Entity, ps: Pose[], skip: Set<string>, soft?: { ids: Set<string>; depth: number }): Hit | null {
  for (let i = 1; i < ps.length; i++) {
    const h = segmentHit(sp, e, ps[i - 1], ps[i], skip, soft);
    if (h) return h;
  }
  return null;
}

/** First obstacle the part's box meets along the pose polyline `ps` (except itself and `ignore`), or null. */
export function sweepPoses(rt: Runtime, e: Entity, ps: Pose[], ignore: string[]): Hit | null {
  return pathHit(spatialOf(rt), e, ps, new Set(ignore), notchSoft(rt, e));
}

/**
 * Plan a collision-free lift of `e` from `from` to `to`: the straight path if clear, else a
 * lift-over (when allowed). Fails with `lift.path-blocked` naming the obstacle.
 */
export function sweptLiftPath(rt: Runtime, e: Entity, from: Pose, to: Pose, o: SweepOpts): { ok: true; path: LiftPath } | Fail {
  const sp = spatialOf(rt);
  const skip = new Set(o.ignore);
  // anything the part already touches where it lies (a pile, the floor slab) is not in its way
  const f0 = entityFootprint({ ...e, pose: from });
  for (const ob of sp.scene.obstacles)
    if (ob.id !== e.id && !(ob.y1 <= f0.y0 + 0.005 || ob.y0 >= f0.y1 - 0.005) && obbOverlap(f0.obb, ob.obb, -0.01)) skip.add(ob.id);
  const straight = [from, to];
  const soft = notchSoft(rt, e);
  const h1 = pathHit(sp, e, straight, skip, soft);
  if (!h1) return { ok: true, path: { poses: straight, via: 'straight' } };
  const what = o.what ?? `${def(e.def).label} ${e.id}`;
  const name = (h: Hit) => h.o.label && h.o.label !== h.o.id ? `${h.o.label} (${h.o.id})` : h.o.id;
  const at = (h: Hit) => `(${f2(h.q.p[0])}, ${f2(h.q.p[1])}, ${f2(h.q.p[2])})`;
  let tail = '; a lift-over is not possible for this part';
  if (o.liftOver !== false) {
    const yL = Math.max(from.p[1], to.p[1] + def(e.def).size[1] + LIFT_OVER);
    // hands carry the underside: its apex may be at most LIFT_APEX_MAX above the crew's floor
    const floor = o.floor ?? from.p[1];
    if (yL - floor > LIFT_APEX_MAX + 1e-9)
      return fail('reach.too-high', `${what} would have to be lifted over at ${f2(yL)} m, ${f2(yL - floor)} m above the crew's floor (hand reach ${LIFT_APEX_MAX} m); ladders/scaffold are not modelled`, [e.id, h1.o.id], h1.q.p);
    const over: Pose[] = [from, { ...from, p: [from.p[0], yL, from.p[2]] }, { ...to, p: [to.p[0], yL, to.p[2]] }, to];
    const h2 = pathHit(sp, e, over, skip, soft);
    if (!h2) return { ok: true, path: { poses: over, via: 'lift-over' } };
    tail = `; lifting it over at ${f2(yL)} m is blocked too, by ${name(h2)} at ${at(h2)}`;
  }
  return fail('lift.path-blocked', `${what} cannot be lifted into place: its straight path would pass through ${name(h1)} at ${at(h1)}${tail}`, [e.id, h1.o.id], h1.q.p);
}

/** At the moment of lifting: re-plan the swept path against the current world and begin the lift along it. */
export function beginSweptLift(rt: Runtime, ex: LiftExec, o: SweepOpts, base: number): Diagnostic | null {
  const item = rt.world.entities[ex.item];
  const r = sweptLiftPath(rt, item, item.pose, ex.to, o);
  if (!r.ok) return r.diagnostic;
  beginLift(rt, ex);
  ex.path = r.path.poses;
  ex.duration = liftDuration(r.path, base);
  return null;
}

/** Lowest floor any of the stations stands on (the lift-over apex must be within everyone's reach). */
export function stationFloor(rt: Runtime, st: Station[]): number {
  const lv = spatialOf(rt).scene.levels;
  return Math.min(...st.map((s) => lv.find((l) => l.id === s.level)?.y ?? 0));
}

export function releaseCrew(rt: Runtime, crew: string[]) {
  for (const c of crew) Object.assign(rt.world.entities[c].human!, { activity: 'idle', grip: undefined, task: undefined });
}

export function cancelLift(rt: Runtime, ex: LiftExec, code: string) {
  if (ex.phase === 'place')
    return { ok: false as const, diagnostic: { code, message: `${ex.item} is being lifted into place; it cannot be abandoned mid-air`, subjects: [ex.item] } };
  for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
  return { ok: true as const };
}
