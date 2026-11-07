// raise_upright: a crew raises a lying upright about its base line, then keeps
// holding it (support = held) until release_support succeeds (spec §7, §12).
//
// Choreography (Mars assembly model v1 — rule-based plausibility, not dynamics):
//   * footers stand beside the base columns (holdStations 0/1) and keep the base
//     from sliding; lifters start beside the top end of the lying frame;
//   * the lifters raise the top end to overhead height, then walk it up toward the
//     base, hands on the columns at ≤ LIFT_HAND above the ground: each lifter's
//     ground position follows the point of the frame at that height as the pitch
//     decreases. The raise rate is limited by the lifters' walking speed
//     (≤ LIFT_SPEED along the ground) and by RAISE_RATE;
//   * every lifter step is checked against static geometry; a blocked step leaves
//     the frame held where it is and the action `blocked` (raise.station-blocked);
//   * near vertical (~75°) lifters whose base station is behind a footer step
//     around them to it (holdStations 2/3); the frame ends held by the whole crew.
// A single person (8–9 ft frames) is the lifter and ends at the base as the footer.
import { z } from 'zod';
import { dcos, dsin, heading, obbOverlap, rot2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { holdingDiagnostic, holdStations, isUpright } from './rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { canonicalLying, isLying } from './lying.ts';
import { entityCorners } from '../spatial/service.ts';
import { makeWay } from '../locomotion/walk.ts';
import { CodecError } from '../runtime/codec.ts';
import { loweringIssue, putRaiseFrame, raiseFrame, recordRaise, type RaiseTrail } from './raise-lower.ts';

const RAISE_RATE = Math.PI / 2 / 5; // rad/s: upper bound (~5 s for a full raise)
export const LIFT_HAND = 1.9; // m above the ground: where lifters hold the frame (≤ 2.0 m overhead reach)
export const LIFT_SPEED = 0.6; // m/s: lifters' walking speed along the ground while raising
const SIDE = 0.42; // m beyond the column face line (as holdStations)
const STEP_OUT = 0.5; // m: stepping lifters swing out this far to pass a footer
const STEP_PITCH = Math.PI / 12; // 15° from vertical (~75° raised): lifters go to their base stations
const STEP_R = 0.6; // m: a lifter heading behind a footer leaves the frame line this far from the base

type P = { crew: string[]; item: string; stand_at?: { x: number; z: number } };
type Role = { actor: string; lifter: boolean; station: number; side: -1 | 1; steps: boolean };
type Geo = { base: Vec2; yaw: number; H: number; d: number; groundY: number; y0: number };
type Step = { paths: Map<string, Vec2[]>; d: number };
type Exec = {
  p: P; id: string; phase: 'approach' | 'grip' | 'raise' | 'step' | 'set' | 'lower'; children?: Children; t: number;
  trail?: RaiseTrail; lowerIndex?: number;
  groundY: number; y0: number; roles: Role[]; geo: Geo; thT: number; step?: Step;
};

const groundOf = (u: Entity) => Math.min(...entityCorners(u).map((c) => c[1]));

/**
 * Crew roles: crew[i] ends at holdStations[i]. Footers first (base columns), the rest lift:
 * 1 → one lifter (ends as footer); 2 → footer + lifter; 3 → footer + 2 lifters; 4 → 2 + 2.
 * A lifter whose station is behind the base (index ≥ 2) must step around a footer.
 */
export function raiseRoles(crew: string[]): Role[] {
  const n = crew.length;
  const nF = n - (n <= 2 ? 1 : 2);
  return crew.map((actor, i) => ({ actor, lifter: i >= nF, station: i, side: (i % 2 === 0 ? -1 : 1) as -1 | 1, steps: i >= nF && i >= 2 }));
}

function geoOf(u: Entity, groundY: number): Geo {
  const [d, H] = def(u.def).size;
  return { base: [u.pose.p[0], u.pose.p[2]], yaw: u.pose.yaw, H, d, groundY, y0: u.pose.p[1] };
}
const yoOf = (g: Geo, th: number) => (g.y0 - g.groundY) * (th / (Math.PI / 2));
/** Distance along the frame (from its base) where lifters hold it at pitch th. */
function handS(g: Geo, th: number): number {
  const c = dcos(th), room = LIFT_HAND - yoOf(g, th);
  return c * g.H <= room ? g.H : room / c;
}
/** Horizontal distance from the base line to the lifters' hands (monotone in th). */
const reachR = (g: Geo, th: number) => handS(g, th) * dsin(th);
const local = (g: Geo, x: number, zl: number): Vec2 => {
  const w = rot2([x, zl], g.yaw);
  return [g.base[0] + w[0], g.base[1] + w[1]];
};
const lat = (g: Geo) => g.d / 2 + SIDE;
const lifterAt = (g: Geo, side: number, th: number) => local(g, side * lat(g), reachR(g, th));
/** Face the column at the same distance along the frame. */
const faceCol = (g: Geo, p: Vec2, side: number, zl: number) => {
  const c = local(g, (side * g.d) / 2, zl);
  return heading([c[0] - p[0], c[1] - p[1]]);
};

/** World position (x, y, z) of a lifter's hands on its column at pitch th (tests / renderers). */
export function liftHandPoint(u: Entity, groundY: number, y0: number, side: -1 | 1): Vec3 {
  const g: Geo = { ...geoOf(u, groundY), y0 };
  const th = u.pose.pitch ?? 0;
  const s = handS(g, th);
  const q = local(g, (side * g.d) / 2, s * dsin(th));
  return [q[0], groundY + yoOf(g, th) + s * dcos(th), q[1]];
}

/** Pitch at which lifters leave the frame line for their base stations. */
function transitionPitch(g: Geo, roles: Role[]): number {
  if (!roles.some((r) => r.steps)) return STEP_PITCH;
  let lo = 0, hi = Math.PI / 2;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (reachR(g, m) < STEP_R) lo = m; else hi = m;
  }
  return Math.max(STEP_PITCH, hi);
}

/** Next pitch: at most RAISE_RATE·dt lower, and no lifter walks more than LIFT_SPEED·dt. */
function nextPitch(g: Geo, th: number, lo: number, dt: number): number {
  const floor = Math.max(lo, th - RAISE_RATE * dt);
  const r0 = reachR(g, th), max = LIFT_SPEED * dt;
  if (r0 - reachR(g, floor) <= max) return floor;
  let a = floor, b = th; // r0 - r(a) > max, r0 - r(b) = 0
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2;
    if (r0 - reachR(g, m) > max) a = m; else b = m;
  }
  return b;
}

function stepPath(g: Geo, r: Role, thT: number): Vec2[] {
  const L = lat(g), s = r.side, back = -0.7; // holdStations 2/3 sit 0.7 m behind the base line
  return [local(g, s * L, reachR(g, thT)), local(g, s * (L + STEP_OUT), reachR(g, thT)), local(g, s * (L + STEP_OUT), back), local(g, s * L, back)];
}
const pathLen = (ps: Vec2[]) => ps.slice(1).reduce((a, q, i) => a + hypot(q[0] - ps[i][0], q[1] - ps[i][1]), 0);
function along(ps: Vec2[], d: number): Vec2 {
  for (let i = 1; i < ps.length; i++) {
    const l = hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]);
    if (d <= l) return [ps[i - 1][0] + ((ps[i][0] - ps[i - 1][0]) * d) / (l || 1), ps[i - 1][1] + ((ps[i][1] - ps[i - 1][1]) * d) / (l || 1)];
    d -= l;
  }
  return ps[ps.length - 1];
}

/** Static geometry at a lifter position (null = clear). */
function standBlocked(rt: Runtime, u: Entity, actor: string, p: Vec2, need: number): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const g = sp.level(rt.world.entities[actor].human!.level);
  if (!g) return null;
  const c = clearanceAt(g, p);
  if (c >= need) return null;
  const id = nearestBlocker(g, p) ?? 'the floor edge';
  const o = sp.scene.obstacles.find((x) => x.id === id);
  return {
    code: 'raise.station-blocked',
    message: `${actor} cannot walk ${u.id} up: their next position (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) beside the ${def(u.def).label} is blocked by ${o?.label ?? id} (clearance ${c.toFixed(2)} m)`,
    subjects: [u.id, actor, ...(o ? [o.id] : [])],
    at: [p[0], u.pose.p[1], p[1]],
  };
}

// W38 (PROVISIONAL, as W27's set-part rule and the carry verb's): the raise crew never walks through a bystander.
const BYSTANDER_GAP = 2 * HUMAN_RADIUS + 0.08;
const d2 = (a: Vec2, b: Vec2) => hypot(a[0] - b[0], a[1] - b[1]);
/** A person outside the crew whom a lifter's next position comes within BYSTANDER_GAP of (and closer than now); same level, ≤ 1 m in height. */
function raiseBystander(rt: Runtime, ex: Exec, moves: [string, Vec2, number][]): { who: string; at: Vec2 } | null {
  const w = rt.world;
  const crew = new Set(ex.p.crew);
  const others = Object.values(w.entities).filter((o) => o.kind === 'human' && o.human && !crew.has(o.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [a, q] of moves) {
    const h = w.entities[a];
    const now: Vec2 = [h.pose.p[0], h.pose.p[2]];
    for (const o of others) {
      if (o.human!.level !== h.human!.level || Math.abs(o.pose.p[1] - h.pose.p[1]) > 1.0) continue;
      const op: Vec2 = [o.pose.p[0], o.pose.p[2]];
      const d = d2(q, op);
      if (d < BYSTANDER_GAP && d < d2(now, op) - 1e-9) return { who: o.id, at: q };
    }
  }
  return null;
}
/** True when a person standing at q is clear of every lifter's remaining path (makeWay's clearOf test). */
function clearOfRaise(rt: Runtime, ex: Exec, q: Vec2): boolean {
  if (!rt.isActive(ex.id)) return true;
  const th = rt.world.entities[ex.p.item].pose.pitch ?? 0;
  for (const r of ex.roles) {
    if (!r.lifter) continue;
    const pts: Vec2[] = [];
    for (let k = 0; k <= 16; k++) pts.push(lifterAt(ex.geo, r.side, th * (1 - k / 16)));
    if (r.steps) { const ps = stepPath(ex.geo, r, ex.thT), L = pathLen(ps); for (let d = 0; d <= L; d += 0.1) pts.push(along(ps, d)); }
    if (pts.some((p) => d2(p, q) < BYSTANDER_GAP + 0.1)) return false;
  }
  return true;
}
/** Hold the frame and ask the bystander to step aside (null = nobody in the way). */
function raiseWait(rt: Runtime, ex: Exec, u: Entity, moves: [string, Vec2, number][]): { status: 'blocked'; diagnostic: Diagnostic } | null {
  const by = raiseBystander(rt, ex, moves);
  if (!by) return null;
  makeWay(rt, by.who, by.at, { by: `the crew raising ${u.id}`, subjects: [u.id, ...ex.p.crew], test: (q) => clearOfRaise(rt, ex, q) });
  return { status: 'blocked', diagnostic: { code: 'raise.path-occupied', message: `the crew raising ${u.id} holds it and waits for ${by.who} to move out of its way (${ex.phase})`, subjects: [u.id, by.who, ...ex.p.crew], at: [by.at[0], u.pose.p[1], by.at[1]] } };
}

/** Plan-time: sample every lifter position of the choreography against static geometry. */
function choreoBlocked(rt: Runtime, u: Entity, g: Geo, roles: Role[], thT: number): Diagnostic | null {
  const n = 64;
  for (const r of roles) {
    if (!r.lifter) continue;
    const pts: Vec2[] = [];
    for (let k = 0; k <= n; k++) pts.push(lifterAt(g, r.side, Math.PI / 2 - ((Math.PI / 2 - thT) * k) / n));
    if (r.steps) {
      const ps = stepPath(g, r, thT), L = pathLen(ps);
      for (let d = 0; d <= L; d += 0.05) pts.push(along(ps, d));
      pts.push(ps[ps.length - 1]);
    } else for (let k = 0; k <= 16; k++) pts.push(lifterAt(g, r.side, thT * (1 - k / 16)));
    for (const p of pts) {
      const b = standBlocked(rt, u, r.actor, p, HUMAN_RADIUS);
      if (b) return b;
    }
  }
  return null;
}

/** Sample the raising arc and report the first static obstacle it would hit. */
export function raiseSweep(rt: Runtime, u: Entity, from: number, to: number): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const pitch = from + ((to - from) * k) / steps;
    const f = entityFootprint({ ...u, pose: { ...u.pose, pitch } });
    for (const o of sp.scene.obstacles) {
      if (o.id === u.id || o.y1 <= f.y0 + 0.02 || o.y0 >= f.y1) continue;
      if (obbOverlap(f.obb, o.obb, -0.01))
        return {
          code: 'raise.arc-blocked',
          message: `${def(u.def).label} ${u.id} cannot rotate through its raising arc: at ${Math.round((1 - pitch / (Math.PI / 2)) * 90)}° it intersects ${o.label ?? o.id}`,
          subjects: [u.id, o.id],
          at: [o.obb.c[0], (f.y0 + f.y1) / 2, o.obb.c[1]],
        };
    }
  }
  return null;
}

/** Where each crew member starts: footers at their base station, lifters beside the top end. */
function startStations(u: Entity, g: Geo, roles: Role[]) {
  const st = holdStations(u, roles.length);
  return roles.map((r) => {
    if (!r.lifter) return { actor: r.actor, p: st[r.station].p, yaw: st[r.station].yaw };
    const p = lifterAt(g, r.side, Math.PI / 2);
    return { actor: r.actor, p, yaw: faceCol(g, p, r.side, g.H) };
  });
}

export const raiseUpright: ActionDef<P, null, Exec> = {
  verb: 'raise_upright',
  description:
    'A crew raises a lying upright about its base to standing and keeps holding it: footers brace the base columns while lifters start at the top end and walk it up (hands ≤ 2 m, ≤ 0.6 m/s), then step to the base. Mid-raise cancellation safely retraces the lift to lying, or refuses if its reverse path is obstructed. The standing crew stays committed until release_support succeeds.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(4),
    item: z.string().max(80),
    /** Which end becomes the footing: the end nearest this point (frames are raised base-down at either end). */
    stand_at: z.strictObject({ x: z.number(), z: z.number() }).optional(),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan(rt, p) {
    const u = rt.world.entities[p.item];
    if (!isUpright(u)) return { ok: false, diagnostic: { code: 'raise.not-upright', message: `${p.item} is not a pallet-rack upright`, subjects: [p.item] } };
    const need = def(u.def).handling?.raiseCrew ?? 2;
    if (p.crew.length < need)
      return { ok: false, diagnostic: { code: 'raise.crew-too-small', message: `raising the ${def(u.def).label} ${u.id} needs at least ${need} people; ${p.crew.length} assigned`, subjects: [u.id, ...p.crew] } };
    if (!isLying(u) || u.support?.kind !== 'ground')
      return { ok: false, diagnostic: { code: 'raise.not-lying', message: `${u.id} must be lying flat on the ground (base at its pivot) before it can be raised`, subjects: [u.id] } };
    if (new Set(p.crew).size !== p.crew.length) return { ok: false, diagnostic: { code: 'crew.duplicate', message: `crew for raising ${u.id} lists someone twice`, subjects: p.crew } };
    for (const c of p.crew) {
      const d = holdingDiagnostic(rt.world, c);
      if (d) return { ok: false, diagnostic: d };
      if (rt.world.entities[c]?.kind !== 'human') return { ok: false, diagnostic: { code: 'entity.unknown', message: `no person "${c}"`, subjects: [c] } };
    }
    const groundY = groundOf(u);
    const lying = { ...u, pose: canonicalLying(u, groundY, p.stand_at && [p.stand_at.x, p.stand_at.z]) };
    const sweep = raiseSweep(rt, lying, Math.PI / 2, 0);
    if (sweep) return { ok: false, diagnostic: sweep };
    const roles = raiseRoles(p.crew), g = geoOf(lying, groundY);
    // everyone must be able to reach where they start and the hold station they end at
    const hold = holdStations(lying, roles.length);
    const unreachable = checkStations(rt, [...startStations(lying, g, roles), ...roles.map((r) => ({ actor: r.actor, p: hold[r.station].p }))]);
    if (unreachable) return { ok: false, diagnostic: { ...unreachable, code: 'raise.station-unreachable' } };
    const blocked = choreoBlocked(rt, lying, g, roles, transitionPitch(g, roles));
    if (blocked) return { ok: false, diagnostic: blocked };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) {
    const u = rt.world.entities[p.item];
    const groundY = groundOf(u);
    u.pose = canonicalLying(u, groundY, p.stand_at && [p.stand_at.x, p.stand_at.z]); // same physical placement, canonical encoding
    u.phase = 'reserved';
    u.reservedBy = id;
    const roles = raiseRoles(p.crew), geo = geoOf(u, groundY);
    return { p, id, phase: 'approach', t: 0, groundY, y0: u.pose.p[1], roles, geo, thT: transitionPitch(geo, roles) };
  },
  serializeExec(_rt, ex) {
    if (ex.phase !== 'lower') throw new CodecError(`raise action ${ex.id}`, 'an unverified non-lowering construction phase');
    return ex;
  },
  restoreExec(_rt, data) { return data as Exec; },
  step(rt, ex, dt) {
    const w = rt.world;
    const u = w.entities[ex.p.item];
    const g = ex.geo;
    if (ex.phase === 'lower') {
      const target = ex.trail!.frames[ex.lowerIndex!];
      const issue = loweringIssue(rt, u.id, raiseFrame(rt, u.id, ex.p.crew), target, ex.groundY);
      if (issue) return { status: 'blocked', diagnostic: issue };
      putRaiseFrame(rt, u.id, target);
      ex.lowerIndex = ex.lowerIndex! - 1;
      if (ex.lowerIndex! >= 0) return { status: 'running', phase: 'lower' };
      u.support = { kind: 'ground' };
      u.phase = 'staged';
      u.reservedBy = undefined;
      for (const actor of ex.p.crew) Object.assign(w.entities[actor].human!, { grip: undefined, task: undefined, activity: 'idle' });
      return { status: 'completed', outputs: { lowered: u.id } };
    }
    try {
      if (ex.phase === 'approach') {
        if (!ex.children) {
          const r = walkCrew(rt, ex.id, startStations(u, g, ex.roles));
          if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'raise.station-unreachable' } };
          ex.children = r;
        }
        const s = childrenState(ex.children);
        if (s === 'running') return { status: 'running', phase: 'approach' };
        if (s !== 'done') return { status: 'failed', diagnostic: s };
        ex.phase = 'grip';
        ex.t = 0;
      }
      if (ex.phase === 'grip') {
        ex.t += dt;
        for (const r of ex.roles) {
          const h = w.entities[r.actor].human!;
          h.activity = 'support';
          h.grip = { entity: u.id, slot: r.lifter ? 'lift-far' : r.side < 0 ? 'foot-l' : 'foot-r' };
          h.task = ex.id;
        }
        if (ex.t < 1.0) return { status: 'running', phase: 'grip' };
        u.support = { kind: 'held', by: [...ex.p.crew] };
        u.phase = 'raising';
        ex.phase = 'raise';
        ex.trail = { frames: [raiseFrame(rt, u.id, ex.p.crew)], overflow: false };
      }
      const put = (actor: string, p: Vec2, yaw: number) => {
        const h = w.entities[actor];
        h.pose = { ...h.pose, p: [p[0], h.pose.p[1], p[1]], yaw };
      };
      if (ex.phase === 'step') {
        const st = ex.step!;
        const nd = st.d + LIFT_SPEED * dt;
        let done = true;
        const moves: [string, Vec2, number][] = [];
        for (const r of ex.roles) {
          const ps = st.paths.get(r.actor);
          if (!ps) continue;
          const L = pathLen(ps);
          const q = along(ps, Math.min(nd, L));
          if (nd < L) done = false;
          const b = standBlocked(rt, u, r.actor, q, HUMAN_RADIUS - 0.01);
          if (b) return { status: 'blocked', diagnostic: b };
          moves.push([r.actor, q, faceCol(g, q, r.side, 0)]);
        }
        const wait = raiseWait(rt, ex, u, moves);
        if (wait) return wait;
        for (const [a, q, yaw] of moves) put(a, q, yaw);
        st.d = nd;
        if (!done) return { status: 'running', phase: 'step' };
        ex.phase = 'set';
      }
      // raise / set: rotate pitch toward 0 about the base line (origin at base centre), paced by the lifters
      const th = u.pose.pitch ?? 0;
      const lo = ex.phase === 'raise' ? ex.thT : 0;
      const followers = ex.roles.filter((r) => r.lifter && (ex.phase === 'raise' || !r.steps));
      const next = followers.length ? nextPitch(g, th, lo, dt) : Math.max(lo, th - RAISE_RATE * dt);
      const moves: [string, Vec2, number][] = [];
      for (const r of followers) {
        const q = lifterAt(g, r.side, next);
        const b = standBlocked(rt, u, r.actor, q, HUMAN_RADIUS - 0.01);
        if (b) return { status: 'blocked', diagnostic: b };
        moves.push([r.actor, q, faceCol(g, q, r.side, reachR(g, next))]);
      }
      const wait = raiseWait(rt, ex, u, moves);
      if (wait) return wait;
      for (const [a, q, yaw] of moves) put(a, q, yaw);
      u.pose.pitch = next;
      // the base settles from resting-on-its-face height to standing on the ground
      u.pose.p[1] = ex.groundY + (ex.y0 - ex.groundY) * (next / (Math.PI / 2));
      if (ex.phase === 'raise') {
        if (next > ex.thT + 1e-12) return { status: 'running', phase: 'raise' };
        // ~75°: everyone takes their holding station
        for (const r of ex.roles) w.entities[r.actor].human!.grip = { entity: u.id, slot: `hold-${r.station}` };
        const steppers = ex.roles.filter((r) => r.steps);
        if (steppers.length) {
          ex.step = { paths: new Map(steppers.map((r) => [r.actor, stepPath(g, r, ex.thT)])), d: 0 };
          ex.phase = 'step';
          return { status: 'running', phase: 'step' };
        }
        ex.phase = 'set';
      }
      if (next > 0) return { status: 'running', phase: 'set' };
      // exact final stations (the followers' path ends there; this only removes rounding)
      const st = holdStations(u, ex.roles.length);
      for (const r of ex.roles) if (r.lifter) put(r.actor, st[r.station].p, st[r.station].yaw);
      u.phase = 'placed';
      u.reservedBy = undefined;
      return { status: 'completed', outputs: { holding: ex.p.crew } };
    } finally {
      // Capture any partial physical progress even when a future implementation returns blocked.
      if (ex.trail) recordRaise(ex.trail, raiseFrame(rt, u.id, ex.p.crew));
    }
  },
  cancel(rt, ex) {
    const u = rt.world.entities[ex.p.item];
    if (ex.phase === 'lower') return { ok: true, deferred: true };
    if (ex.phase !== 'approach' && ex.phase !== 'grip' && (u.pose.pitch ?? 0) < Math.PI / 2 - 1e-6) {
      if (!ex.trail || ex.trail.overflow)
        return { ok: false, diagnostic: { code: 'raise.cancel-unsafe', message: `${u.id}'s reverse choreography exceeded its deterministic trail bound; keep holding it`, subjects: [u.id] } };
      let from = raiseFrame(rt, u.id, ex.p.crew);
      for (let i = ex.trail.frames.length - 2; i >= 0; i--) {
        const target = ex.trail.frames[i];
        const issue = loweringIssue(rt, u.id, from, target, ex.groundY);
        if (issue) return { ok: false, diagnostic: issue };
        from = target;
      }
      ex.lowerIndex = ex.trail.frames.length - 2;
      ex.phase = 'lower';
      return { ok: true, deferred: true };
    }
    for (const c of ex.p.crew) {
      const h = rt.world.entities[c].human!;
      h.grip = undefined;
      h.activity = 'idle';
      h.task = undefined;
    }
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    u.phase = 'staged';
    u.reservedBy = undefined;
    u.support = { kind: 'ground' };
    return { ok: true };
  },
};

// The same raise geometry, read by the reverse verb (disassembly.ts lower_upright).
// Exported only; nothing above changes behaviour.
export type RaiseGeo = Geo;
export type RaiseRole = Role;
export { nextPitch as raiseNextPitch, stepPath as raiseStepPath, pathLen as raisePathLen, along as raiseAlong, raiseBystander, BYSTANDER_GAP as RAISE_BYSTANDER_GAP };
export { RAISE_RATE, STEP_PITCH, geoOf as raiseGeo, reachR as raiseReach, lifterAt as raiseLifterAt, faceCol as raiseFaceCol, standBlocked as raiseStandBlocked, choreoBlocked as raiseChoreoBlocked, transitionPitch as raiseTransitionPitch };
