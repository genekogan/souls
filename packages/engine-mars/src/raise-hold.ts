// PC13 (#692): a crew raises a loose upright about its base edge and keeps holding it until someone stops, and a stop
// lowers it along the same arc. The native raise's geometry and choreography (construction/raise.ts: footers at the
// base, lifters walk it up, near vertical they step to their stations), for a part whose frame is the library's: its long
// axis is x and it lies at roll 0, so the rotation is a roll about its base edge and ends in the pose a joined upright has
// (`r = [yaw, 0, ±π/2]`, PC12). The native verb stays for native frames. One programme from walk-in to release: the
// shared operation's receipts stay open while it is held, and everything is plain data, so a long hold can be saved.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../../../mars/viewer/engine/actions/types.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { Entity, Pose } from '../../../mars/viewer/engine/world/types.ts';
import { def, HUMAN_RADIUS, type AssetDef } from '../../../mars/viewer/engine/world/catalog.ts';
import { dcos, dsin, heading, hypot, obbCorners, obbOverlap, pointInObb, rot2, type Vec2 } from '../../../mars/viewer/engine/core/math.ts';
import { entityFootprint, type Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { makeWay } from '../../../mars/viewer/engine/locomotion/walk.ts';
import { holdingDiagnostic } from '../../../mars/viewer/engine/construction/rules.ts';
import { checkStations, childrenState, walkCrew, type Children } from '../../../mars/viewer/engine/construction/children.ts';
import { LIFT_SPEED, RAISE_BYSTANDER_GAP, RAISE_RATE, raiseAlong, raiseBystander, raiseChoreoBlocked, raiseFaceCol, raiseLifterAt, raiseNextPitch, raisePathLen, raiseReach, raiseRoles, raiseStandBlocked, raiseStepPath, raiseTransitionPitch, type RaiseGeo, type RaiseRole } from '../../../mars/viewer/engine/construction/raise.ts';

type P = { crew: string[]; item: string };
type Plan = { sign: 1 | -1 };
/** approach → grip → raise → step (a crew of 3 or 4) → set → hold; `lowering` runs set, step and raise backwards. `th` is the
 *  native pitch: π/2 lying, 0 standing. */
type Phase = 'approach' | 'grip' | 'raise' | 'step' | 'set' | 'hold';
export type RaiseHoldExec = {
  p: P; id: string; phase: Phase; t: number; th: number; thT: number; sign: 1 | -1; start: Pose; geo: RaiseGeo; roles: RaiseRole[]; stepD: number;
  children?: Children; lowering?: true; lowered?: true;
};

const PI2 = Math.PI / 2;
const STATION_SIDE = 0.42, STATION_BACK = -0.7, STATION_ROOM = 0.06;   // as construction/rules.ts holdStations
const size = (u: Entity) => { const [L, T, W] = def(u.def).size; return { L, T, W }; };
// + 0: a yaw of -0 (it does not survive a snapshot) must not turn the heading from π to -π, or a replay stands the crew a bit elsewhere
const toward = (u: Pose, sign: number): Vec2 => [sign * dcos(u.yaw) + 0, sign * dsin(u.yaw) + 0];

/** A loose long part this verb can raise: the adapted material's handling, on the ground, flat and joined to nothing. */
export function raiseable(a: Pick<AssetDef, 'category' | 'handling'> | undefined): boolean { return a?.category === 'item' && !!a.handling && !a.handling.small; }

function geoOf(start: Pose, L: number, W: number, sign: 1 | -1): RaiseGeo {
  const t = toward(start, sign), phi = heading(t);
  // the lifters walk a little wider than the native 0.42 m: the walk raster's own error (≈ 0.15 m at a turned part) must not read as the part itself in their way
  return { base: [start.p[0] - t[0] * L / 2, start.p[2] - t[1] * L / 2], yaw: phi - PI2, H: L, d: W + 2 * STATION_ROOM, groundY: start.p[1], y0: start.p[1] };
}
/** The part's pose at native pitch th: the rotation is about its base edge, which never moves. */
export function poseAt(start: Pose, L: number, sign: 1 | -1, th: number): Pose {
  if (th >= PI2) return structuredClone(start);
  const a = PI2 - th, t = toward(start, sign), g = [start.p[0] - t[0] * L / 2, start.p[2] - t[1] * L / 2];
  return { p: [g[0] + t[0] * (L / 2) * dcos(a), start.p[1] + (L / 2) * dsin(a), g[1] + t[1] * (L / 2) * dcos(a)], yaw: start.yaw, roll: sign * a };
}
const local = (g: RaiseGeo, x: number, zl: number): Vec2 => { const w = rot2([x, zl], g.yaw); return [g.base[0] + w[0], g.base[1] + w[1]]; };
function stationOf(g: RaiseGeo, r: RaiseRole): { p: Vec2; yaw: number } {
  const p = local(g, r.side * (g.d / 2 + STATION_SIDE), r.station >= 2 ? STATION_BACK : 0);
  return { p, yaw: raiseFaceCol(g, p, r.side, 0) };
}
function startMoves(g: RaiseGeo, roles: RaiseRole[]) {
  return roles.map((r) => {
    if (!r.lifter) { const s = stationOf(g, r); return { actor: r.actor, p: s.p, yaw: s.yaw }; }
    const p = raiseLifterAt(g, r.side, PI2);
    return { actor: r.actor, p, yaw: raiseFaceCol(g, p, r.side, g.H) };
  });
}
/** Next pitch going down: at most RAISE_RATE·dt higher, and no lifter walks more than LIFT_SPEED·dt (raise.ts, backwards). */
function backPitch(g: RaiseGeo, th: number, hi: number, dt: number): number {
  const top = Math.min(hi, th + RAISE_RATE * dt), r0 = raiseReach(g, th), max = LIFT_SPEED * dt;
  if (raiseReach(g, top) - r0 <= max) return top;
  let a = th, b = top;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (raiseReach(g, m) - r0 > max) b = m; else a = m; }
  return a;
}

/** Anything the part would meet between two pitches: what is built or lying there, and people not in the crew. */
function arcHit(rt: Runtime, u: Entity, start: Pose, sign: 1 | -1, crew: string[], a: number, b: number, n: number): Diagnostic | null {
  const sp = rt.services.spatial as Spatial, { L } = size(u); sp.sync(rt.world);
  const staticIds = new Set(sp.scene.obstacles.map((o) => o.id)), inCrew = new Set(crew);
  const others = Object.values(rt.world.entities).filter((e) => e.id !== u.id && e.kind !== 'human' && e.kind !== 'marker' && !staticIds.has(e.id) && e.support?.kind !== 'in-hand');
  const bodies = [...sp.scene.obstacles.filter((o) => o.id !== u.id), ...others.map((e) => ({ id: e.id, label: def(e.def).label, ...entityFootprint(e) }))];
  const people = Object.values(rt.world.entities).filter((e) => e.human && !inCrew.has(e.id)).sort((x, y) => (x.id < y.id ? -1 : 1));
  for (let k = 0; k <= n; k++) {
    const th = a + ((b - a) * k) / n, f = entityFootprint({ ...u, pose: poseAt(start, L, sign, th) });
    for (const o of bodies) {
      if (o.y1 <= f.y0 + 0.02 || o.y0 >= f.y1) continue;
      if (obbOverlap(f.obb, o.obb, -0.01)) return { code: 'raise.arc-blocked', message: `${def(u.def).label} ${u.id} cannot turn through its arc: at ${Math.round((1 - th / PI2) * 90)}° it meets ${o.label ?? o.id}`, subjects: [u.id, o.id] };
    }
    for (const o of people) if (o.pose.p[1] + 1.9 > f.y0 && o.pose.p[1] < f.y1 && pointInObb([o.pose.p[0], o.pose.p[2]], f.obb, HUMAN_RADIUS)) return { code: 'raise.arc-blocked', message: `${def(u.def).label} ${u.id} would come down on ${o.id}`, subjects: [u.id, o.id] };
  }
  return null;
}
/** Can it come down from here? The arc, the crew's way back and the ground it will lie on. */
function loweringIssue(rt: Runtime, ex: RaiseHoldExec, u: Entity): Diagnostic | null {
  const hit = arcHit(rt, u, ex.start, ex.sign, ex.p.crew, ex.th, PI2, 24);
  if (hit) return { ...hit, code: 'raise.cancel-unsafe' };
  const sp = rt.services.spatial as Spatial, c = obbCorners(entityFootprint({ ...u, pose: ex.start }).obb);
  if (!sp.scene.surfaces.some((s) => Math.abs(s.y - ex.start.p[1]) < 0.05 && c.every((q) => pointInObb(q, s.obb, 1e-6)))) return { code: 'raise.cancel-unsafe', message: `${u.id} cannot be lowered: the ground it lay on is gone`, subjects: [u.id] };
  for (const r of ex.roles) {
    if (!r.lifter) continue;
    for (let k = 0; k <= 16; k++) {
      const b = raiseStandBlocked(rt, u, r.actor, raiseLifterAt(ex.geo, r.side, ex.th + ((PI2 - ex.th) * k) / 16), HUMAN_RADIUS - 0.01);
      if (b) return { ...b, code: 'raise.cancel-unsafe' };
    }
  }
  return null;
}
/** Nearer of the part's two long edges, as an authored grip id (catalog-adapter.ts): where this body's hands go. */
function columnOf(u: Entity, g: RaiseGeo, r: RaiseRole): string {
  const across = rot2([1, 0], g.yaw), z = rot2([0, 1], u.pose.yaw), plus = across[0] * z[0] + across[1] * z[1] > 0;
  return (r.side > 0) === plus ? 'column-pos' : 'column-neg';
}
function release(rt: Runtime, ex: RaiseHoldExec, u: Entity) {
  for (const c of ex.p.crew) Object.assign(rt.world.entities[c].human!, { grip: undefined, task: undefined, activity: 'idle' });
  u.pose = structuredClone(ex.start); u.support = { kind: 'ground' }; u.phase = 'staged'; u.reservedBy = undefined;
}
/** Hold where it is, and ask a person in a lifter's way to step aside. */
function bystanderWait(rt: Runtime, ex: RaiseHoldExec, u: Entity, moves: [string, Vec2, number][]): Diagnostic | null {
  const by = raiseBystander(rt, ex as never, moves);
  if (!by) return null;
  const clear = (q: Vec2) => !rt.isActive(ex.id) || moves.every(([, m]) => hypot(m[0] - q[0], m[1] - q[1]) >= RAISE_BYSTANDER_GAP + 0.1);
  makeWay(rt, by.who, by.at, { by: `the crew with ${u.id}`, subjects: [u.id, ...ex.p.crew], test: clear });
  return { code: 'raise.path-occupied', message: `the crew holds ${u.id} and waits for ${by.who} to move out of its way`, subjects: [u.id, by.who, ...ex.p.crew] };
}

export const raiseHold: ActionDef<P, Plan, RaiseHoldExec> = {
  verb: 'raise_hold_v1',
  description: 'A crew raises a loose upright lying on the ground about its base edge and keeps holding it, hands on its columns, until the action is stopped; stopping lowers it along the same arc back where it lay.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), item: z.string().max(80) }),
  resumable: true,
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' as const }],
  plan(rt, p) {
    const u = rt.world.entities[p.item], no = (code: string, message: string, subjects: string[] = [p.item]) => ({ ok: false as const, diagnostic: { code, message, subjects } });
    if (!u) return no('entity.unknown', `no thing "${p.item}"`);
    const asset = def(u.def);
    if (!raiseable(asset)) return no('raise.not-loose', `${u.id} is not a loose part a crew can raise`);
    const [least, most] = asset.handling!.carryCrew!;
    if (p.crew.length < least) return no('raise.crew-too-small', `raising ${asset.label} ${u.id} needs at least ${least} people; ${p.crew.length} assigned`, [u.id, ...p.crew]);
    if (p.crew.length > most) return no('raise.crew-too-large', `${asset.label} ${u.id} has room for at most ${most} people; ${p.crew.length} assigned`, [u.id, ...p.crew]);
    if (new Set(p.crew).size !== p.crew.length) return no('crew.duplicate', `crew for raising ${u.id} lists someone twice`, p.crew);
    if (u.connections?.length || u.phase === 'installed') return no('raise.joined', `${u.id} is joined into a frame`);
    if (u.support?.kind !== 'ground' || u.phase !== 'staged' || u.reservedBy || Math.abs(u.pose.roll ?? 0) > 0.01 || Math.abs(u.pose.pitch ?? 0) > 0.01) return no('raise.not-lying', `${u.id} must be lying flat on the ground before it can be raised`);
    for (const c of p.crew) {
      if (rt.world.entities[c]?.kind !== 'human') return no('entity.unknown', `no person "${c}"`, [c]);
      const d = holdingDiagnostic(rt.world, c); if (d) return { ok: false, diagnostic: d };
    }
    // the base is the end nearer the first of the crew, else the other end if only that one has room
    const { L, W } = size(u), lead = rt.world.entities[p.crew[0]!]!, t = toward(u.pose, 1);
    const near: 1 | -1 = (lead.pose.p[0] - u.pose.p[0]) * t[0] + (lead.pose.p[2] - u.pose.p[2]) * t[1] > 0 ? -1 : 1;
    let first: Diagnostic | null = null;
    for (const sign of [near, -near as 1 | -1]) {
      const g = geoOf(u.pose, L, W, sign), roles = raiseRoles(p.crew);
      const issue = arcHit(rt, u, u.pose, sign, p.crew, PI2, 0, 24)
        ?? (() => { const d = checkStations(rt, [...startMoves(g, roles), ...roles.map((r) => ({ actor: r.actor, p: stationOf(g, r).p }))]); return d ? { ...d, code: 'raise.station-unreachable' } : null; })()
        ?? raiseChoreoBlocked(rt, u, g, roles, raiseTransitionPitch(g, roles));
      if (!issue) return { ok: true, program: { sign } };
      first ??= issue;
    }
    return { ok: false, diagnostic: first! };
  },
  start(rt, p, program, id) {
    const u = rt.world.entities[p.item]!, { L, W } = size(u), start = structuredClone(u.pose), g = geoOf(start, L, W, program.sign), roles = raiseRoles(p.crew);
    u.phase = 'reserved'; u.reservedBy = id;
    return { p, id, phase: 'approach', t: 0, th: PI2, thT: raiseTransitionPitch(g, roles), sign: program.sign, start, geo: g, roles, stepD: 0 };
  },
  step(rt, ex, dt) {
    const w = rt.world, u = w.entities[ex.p.item]!, g = ex.geo, { L } = size(u);
    const put = (actor: string, q: Vec2, yaw: number) => { const h = w.entities[actor]!; h.pose = { ...h.pose, p: [q[0], h.pose.p[1], q[1]], yaw }; };
    const held = (d: Diagnostic) => ({ status: 'blocked' as const, diagnostic: d });
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const r = walkCrew(rt, ex.id, startMoves(g, ex.roles));
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'raise.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      ex.children = undefined; ex.phase = 'grip'; ex.t = 0;
    }
    if (ex.phase === 'grip') {
      ex.t += dt;
      for (const r of ex.roles) Object.assign(w.entities[r.actor]!.human!, { activity: 'support', grip: { entity: u.id, slot: columnOf(u, g, r) }, task: ex.id });
      if (ex.t < 1) return { status: 'running', phase: 'grip' };
      u.support = { kind: 'held', by: [...ex.p.crew] }; u.phase = 'raising'; ex.phase = 'raise';
    }
    if (ex.phase === 'hold') {
      if (!ex.lowering) return { status: 'running', phase: 'hold' };
      ex.phase = 'set'; u.phase = 'raising';
    }
    if (ex.phase === 'set' && ex.lowering && ex.th >= ex.thT - 1e-12 && ex.roles.some((r) => r.steps)) { ex.phase = 'step'; ex.stepD = raisePathLenOf(ex); }
    if (ex.phase === 'step') {
      const nd = ex.stepD + (ex.lowering ? -LIFT_SPEED * dt : LIFT_SPEED * dt), moves: [string, Vec2, number][] = [];
      let done = true;
      for (const r of ex.roles) {
        if (!r.steps) continue;
        const ps = raiseStepPath(g, r, ex.thT), len = raisePathLen(ps), q = raiseAlong(ps, Math.max(0, Math.min(nd, len)));
        if (ex.lowering ? nd > 0 : nd < len) done = false;
        const b = raiseStandBlocked(rt, u, r.actor, q, HUMAN_RADIUS - 0.01); if (b) return held(b);
        moves.push([r.actor, q, raiseFaceCol(g, q, r.side, 0)]);
      }
      const wait = bystanderWait(rt, ex, u, moves); if (wait) return held(wait);
      for (const [a, q, yaw] of moves) put(a, q, yaw);
      ex.stepD = nd;
      if (!done) return { status: 'running', phase: 'step' };
      ex.phase = ex.lowering ? 'raise' : 'set';
    }
    // raise / set: the part turns about its base edge, paced by the lifters; backwards when lowering
    const lo = ex.phase === 'raise' ? ex.thT : 0, hi = ex.phase === 'set' && ex.roles.some((r) => r.steps) ? ex.thT : PI2;
    const followers = ex.roles.filter((r) => r.lifter && (ex.phase === 'raise' || !r.steps));
    const next = ex.lowering ? (followers.length ? backPitch(g, ex.th, hi, dt) : Math.min(hi, ex.th + RAISE_RATE * dt)) : (followers.length ? raiseNextPitch(g, ex.th, lo, dt) : Math.max(lo, ex.th - RAISE_RATE * dt));
    const moves: [string, Vec2, number][] = [];
    for (const r of followers) {
      const q = raiseLifterAt(g, r.side, next), b = raiseStandBlocked(rt, u, r.actor, q, HUMAN_RADIUS - 0.01); if (b) return held(b);
      moves.push([r.actor, q, raiseFaceCol(g, q, r.side, raiseReach(g, next))]);
    }
    const wait = bystanderWait(rt, ex, u, moves); if (wait) return held(wait);
    if (ex.lowering) { const hit = arcHit(rt, u, ex.start, ex.sign, ex.p.crew, ex.th, next, 2); if (hit) return held({ ...hit, code: 'raise.cancel-unsafe' }); }
    for (const [a, q, yaw] of moves) put(a, q, yaw);
    ex.th = next; u.pose = poseAt(ex.start, L, ex.sign, next);
    if (ex.lowering) {
      if (ex.th < PI2 - 1e-12) return { status: 'running', phase: ex.phase };
      release(rt, ex, u);
      return { status: 'completed', outputs: { lowered: u.id } };
    }
    if (ex.phase === 'raise') {
      if (next > ex.thT + 1e-12) return { status: 'running', phase: 'raise' };
      if (ex.roles.some((r) => r.steps)) { ex.phase = 'step'; ex.stepD = 0; return { status: 'running', phase: 'step' }; }
      ex.phase = 'set';
    }
    if (next > 0) return { status: 'running', phase: 'set' };
    for (const r of ex.roles) if (r.lifter) { const s = stationOf(g, r); put(r.actor, s.p, s.yaw); }
    u.phase = 'placed'; ex.phase = 'hold';
    return { status: 'running', phase: 'hold' };
  },
  cancel(rt, ex) {
    const u = rt.world.entities[ex.p.item]!;
    if (ex.lowering) return { ok: true, deferred: true };
    if (ex.phase === 'approach' || ex.phase === 'grip') {
      for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
      release(rt, ex, u);
      return { ok: true };
    }
    const issue = loweringIssue(rt, ex, u);
    if (issue) return { ok: false, diagnostic: issue };
    ex.lowering = true;
    return { ok: true, deferred: true };
  },
};
const raisePathLenOf = (ex: RaiseHoldExec) => Math.max(...ex.roles.filter((r) => r.steps).map((r) => raisePathLen(raiseStepPath(ex.geo, r, ex.thT))));

/** R5: a part this action turned is never left without its crew: while its phase says so it is held, and by bodies whose hands
 *  are on it. (A god may stand a part on end by placing it; that one is staged or joined, and is not this.) */
export function looseFramesHeld(rt: Runtime): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities)) {
    if (e.kind === 'human' || (e.phase !== 'raising' && e.phase !== 'placed') || !e.pose.roll || !raiseable(tryDef(e.def))) continue;
    const by = e.support?.kind === 'held' ? e.support.by : [];
    if (!by.length || by.some((id) => rt.world.entities[id]?.human?.grip?.entity !== e.id)) out.push({ code: 'raise.frame-unheld', message: `${e.id} stands tilted ${e.pose.roll.toFixed(2)} rad and is not held by its crew (${by.join(', ') || 'nobody'})`, subjects: [e.id, ...by] });
  }
  return out;
}
const tryDef = (id: string): AssetDef | undefined => { try { return def(id); } catch { return undefined; } };
