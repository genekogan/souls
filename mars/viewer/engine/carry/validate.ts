// Plan-time validation for `carry` (spec §13 "validated"): crew/load checks,
// pickup and set-down geometry, the whole-formation SE(2) route, and each
// carrier's approach walk. Pure w.r.t. the world.
import { dcos, dist2, dsin, obbOverlap, pointInObb, type Vec2 } from '../core/math.ts';
import type { Diagnostic, PlanResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker, type GridSet, type LevelGrid } from '../spatial/grid.ts';
import { findRoute, type Route } from '../spatial/path.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { carrierSpots, CARRIER_RADIUS, checkCrew, entityFrame, formationFor, laidPose, REACH, shortName as shortNameOf, type Formation, type SE2 } from './formation.ts';
import { poseHit } from './sweep.ts';
import { planCarry, type PlanFail, type PlanInput, type PlanOk, type Trajectory } from './planner.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { PLAN_MARGIN } from './sweep.ts';
import { climbGeom, climbObstacles, climbPose, loadObstacleHit, stairClearance, STAIR_SIDE_MARGIN, type ClimbGeom } from './climb.ts';
import type { Link } from '../spatial/types.ts';
import { fragileFlightCheck } from './fragile.ts';

/** `via`: the stair link to use when the target is on another level (default: the one a person would take). */
export type CarryParams = { crew: string[]; item: string; to: { x: number; z: number; yaw: number; level?: number }; place?: 'lay'; via?: string };

/**
 * A carry between levels (single carrier): the ground leg (`traj`) ends at the climb start s0, the
 * flight is traversed s0 → s1 (climb.ts), then `deck` runs on the exit level to the set-down.
 */
export type ClimbPlan = ClimbGeom & { s0: number; s1: number; fromLevel: number; toLevel: number; toY: number; deck: Trajectory };

export type CarryProgram = {
  /** Only the fixture mover uses this ground profile; legacy component carry is unchanged. */
  fixture?: { restingPhase: Entity['phase']; binding: string };
  f: Formation;
  crew: string[];
  item: string;
  level: number;
  levelY: number;
  lying: Pose;
  pickup: SE2;
  approach: Vec2[];
  gather: (Route | null)[];
  traj: Trajectory;
  target: SE2;
  laid: Pose;
  setdown: Vec2[];
  stats: { expanded: number; keyposes: number };
  /** Present when the target is on another level; `level`/`levelY` then switch to the exit level after the climb. */
  climb?: ClimbPlan;
};

const STAND_TOL = 0.02;
const fmt = (x: number, z: number) => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
const bad = (d: Diagnostic): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: d });

export function labelOf(sp: Spatial, id: string) {
  return sp.scene.obstacles.find((o) => o.id === id)?.label ?? id;
}

/** Why a carrier cannot stand at p (or null). */
function standIssue(sp: Spatial, g: LevelGrid, p: Vec2): string | null {
  if (clearanceAt(g, p) >= CARRIER_RADIUS - STAND_TOL) return null;
  const b = nearestBlocker(g, p, 1.0);
  return b ? `blocked by '${labelOf(sp, b)}'` : 'off the walkable floor';
}

/** Why the load's formation cannot be at q (or null). */
function formationIssue(sp: Spatial, g: LevelGrid, f: Formation, q: SE2, crew: string[]): string | null {
  const out = { p: [0, 0] as Vec2 };
  const k = poseHit(g, f, q, 0, out);
  if (k < 0) return null;
  const d = f.discs[k];
  const part = d.part === 'load' ? `the load` : `carrier ${crew[d.carrier!]}`;
  const b = nearestBlocker(g, out.p, 1.0);
  return `${part} would intersect ${b ? `'${labelOf(sp, b)}'` : 'the edge of the floor'} at ${fmt(out.p[0], out.p[1])}`;
}

/**
 * Exact check that the load can be laid at q: its ground footprint overlaps no
 * obstacle or other component (at any height it occupies), lies on floor, and
 * every carrier has room to stand beside it. Returns a reason or null.
 */
export function laidIssue(sp: Spatial, f: Formation, q: SE2, level: number, levelY: number, exclude: string, crew: string[]): { reason: string; subjects: string[] } | null {
  const pose = laidPose(f, q, levelY);
  const fake = { id: '_laid', def: f.defId, kind: 'component', pose } as Entity;
  const fp = entityFootprint(fake);
  for (const o of sp.scene.obstacles) {
    if (o.id === exclude || o.y1 <= levelY + 1e-3 || o.y0 >= fp.y1 - 1e-3) continue;
    if (obbOverlap(fp.obb, o.obb)) return { reason: `laying it there would overlap '${o.label ?? o.id}'`, subjects: [o.id] };
  }
  const floors = sp.scene.surfaces.filter((s) => s.level === level);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => {
    const c = dcos(fp.obb.yaw), s = dsin(fp.obb.yaw);
    const lx = a * fp.obb.half[0], lz = b * fp.obb.half[1];
    return [fp.obb.c[0] + lx * c - lz * s, fp.obb.c[1] + lx * s + lz * c] as Vec2;
  });
  for (const p of corners)
    if (!floors.some((s) => pointInObb(p, s.obb, 1e-6))) return { reason: `its footprint would leave the floor at ${fmt(p[0], p[1])}`, subjects: [] };
  const g = sp.level(level)!;
  const spots = carrierSpots(f, q, entityFrame(fake).halfW);
  for (let i = 0; i < spots.length; i++) {
    const why = standIssue(sp, g, spots[i]);
    if (why) return { reason: `carrier ${crew[i]} would have no room to stand at ${fmt(spots[i][0], spots[i][1])} (${why})`, subjects: [crew[i]] };
  }
  return null;
}

/** Approach walks to the grip spots around the lying item (the item is an obstacle for the approach). */
function gatherRoutes(sp: Spatial, item: Entity, people: Entity[], f: Formation, pickup: SE2, halfW: number, level: number, levelY: number): { ok: true; approach: Vec2[]; gather: (Route | null)[] } | { ok: false; diagnostic: Diagnostic } {
  const approach = carrierSpots(f, pickup, halfW);
  const gather: (Route | null)[] = [];
  let aug: GridSet | null = null;
  for (let i = 0; i < people.length; i++) {
    const e = people[i];
    const at: Vec2 = [e.pose.p[0], e.pose.p[2]];
    if (dist2(at, approach[i]) < 0.05) { gather.push(null); continue; }
    const fp = entityFootprint(item);
    const scene = { ...sp.scene, levels: sp.scene.levels.filter((l) => l.id === level), links: [], obstacles: [...sp.scene.obstacles.filter((o) => o.id !== item.id), { id: item.id, obb: fp.obb, y0: levelY, y1: levelY + 1, kind: 'component' as const }] };
    aug ??= sp.gridsFor(scene); // the synced grids with the item's footprint patched in (bit-identical to buildGrids)
    const rr = findRoute(aug, scene, HUMAN_PROFILE, { level, p: at }, { level, p: approach[i] }, { goalTolerance: 0.5 });
    if (!rr.ok) return bad({ ...rr.diagnostic, code: 'carry.gather-unreachable', message: `${e.id} cannot reach grip ${f.carriers[i].slot} of ${item.id} at ${fmt(approach[i][0], approach[i][1])}: ${rr.diagnostic.message}`, subjects: [e.id, item.id] });
    gather.push(rr.route);
  }
  return { ok: true, approach, gather };
}

/**
 * #1015: a formation search that found no way is kept, so the same refused request from the same spot does not
 * search again (a refusal spends the whole pose budget, about 1.4 s on the act path). The key is the level grid it
 * searched, by identity (grids are copy-on-write: an unchanged level stays the same object, a changed one is new),
 * plus the navigation epoch, the grid variant, the load, the crew, the exact start and goal poses and the budget.
 * The planner is a pure function of those, so a kept refusal is the verdict a fresh search would give, returned as a
 * copy. Only failures are kept, a few per grid, on the spatial service (Spatial.carryRefusals, dropped with its other
 * caches). Derived data only: nothing in the world changes. A request that differs at all (another target, another
 * spot, a re-clustered paged window) is its own search.
 */
export const KEPT_REFUSALS_PER_GRID = 8;
function searchOrKept(sp: Spatial, base: LevelGrid, variant: string, def: string, inp: PlanInput): PlanOk | PlanFail {
  // exact numbers: JSON keeps every double except the sign of zero, which atan2 can see, so -0 is spelled out
  const key = JSON.stringify([sp.epoch, variant, def, inp.carrierNames ?? [], inp.starts, inp.goals, inp.maxExpand ?? 'default'], (_k, v) => (Object.is(v, -0) ? '-0' : v));
  const kept = sp.carryRefusals.get(base)?.get(key) as PlanFail | undefined;
  if (kept) { sp.stats.carryRefusalsKept++; return structuredClone(kept); }
  const r = planCarry(inp);
  sp.stats.carrySearches++; sp.stats.carryExpanded += r.expanded;
  if (!r.ok) {
    let m = sp.carryRefusals.get(base);
    if (!m) sp.carryRefusals.set(base, (m = new Map()));
    if (m.size >= KEPT_REFUSALS_PER_GRID) m.delete(m.keys().next().value!);
    m.set(key, structuredClone(r));
  }
  return r;
}

export function planCarryAction(rt: Runtime, p: CarryParams, fixture = false): PlanResult<CarryProgram> {
  const w = rt.world;
  const sp = rt.services.spatial as Spatial;
  const item = w.entities[p.item];
  if (!item) return bad({ code: 'entity.unknown', message: `no item "${p.item}"`, subjects: [p.item] });
  if (!fixture && item.kind !== 'component') return bad({ code: 'carry.not-carriable', message: `"${p.item}" is a ${item.kind}, not a component`, subjects: [p.item] });
  const people: Entity[] = [];
  for (const id of p.crew) {
    const e = w.entities[id];
    if (!e) return bad({ code: 'entity.unknown', message: `no crew member "${id}"`, subjects: [id] });
    if (e.kind !== 'human' || !e.human) return bad({ code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] });
    const hd = holdingDiagnostic(w, id); // someone holding up a frame cannot walk off to carry (review C2)
    if (hd) return bad(hd);
    people.push(e);
  }
  const crewDiag = checkCrew(item.def, p.crew.length, item.id);
  if (crewDiag) return bad({ ...crewDiag, subjects: [item.id, ...p.crew] });
  if ((!fixture && item.phase !== 'stored' && item.phase !== 'staged') || item.support?.kind !== 'ground')
    return bad({ code: 'carry.item-unavailable', message: `${item.id} is ${item.phase ?? 'in use'} (support ${item.support?.kind ?? 'none'}); only items lying on the ground can be picked up`, subjects: [item.id] });
  const level = people[0].human!.level;
  const split = people.find((e) => e.human!.level !== level);
  if (split) return bad({ code: 'carry.crew-split', message: `${split.id} is on level ${split.human!.level} but ${people[0].id} is on level ${level}; the crew must start on one level`, subjects: [split.id] });
  const toLevel = p.to.level ?? level;
  const fragile = fragileFlightCheck(rt, item, people[0], level, p.to, p.via); // a fragile load never follows a steep flight (carry/fragile.ts)
  if (fragile) return bad({ ...fragile, subjects: [...(fragile.subjects ?? []), ...p.crew] });
  if (toLevel !== level && p.crew.length !== 1)
    return bad({ code: 'carry.level-change', message: `carrying the ${shortNameOf(item.def)} from level ${level} to level ${toLevel} with ${p.crew.length} carriers would need a crew on a stair flight; only a single carrier can carry between levels so far`, subjects: [item.id, ...p.crew] });
  sp.sync(w);
  let g = sp.level(level);
  if (!g) return bad({ code: 'route.unknown-level', message: `level ${level} does not exist` });
  const synced = g;
  const levelY = g.y;
  // a tall-lying item would block its own pickup in the grid: plan on a grid without it
  const own = sp.scene.obstacles.find((o) => o.id === item.id);
  if (own && own.y1 > levelY + 0.22) g = sp.gridsFor({ ...sp.scene, levels: sp.scene.levels.filter((l) => l.id === level), obstacles: sp.scene.obstacles.filter((o) => o.id !== item.id) }).levels.get(level)!;
  const f = formationFor(item.def, p.crew.length);
  const lie = entityFrame(item);
  // pickup: the crew may lift facing either way along the load
  const startCands: SE2[] = fixture ? [lie.q] : [lie.q, { ...lie.q, th: lie.q.th + Math.PI }];
  const startWhy: string[] = [];
  const starts = startCands.filter((q) => {
    const spots = carrierSpots(f, q, lie.halfW);
    for (let i = 0; i < spots.length; i++) {
      const why = standIssue(sp, g!, spots[i]);
      if (why) { startWhy.push(`${p.crew[i]} has no room to stand at ${fmt(spots[i][0], spots[i][1])} (${why})`); return false; }
    }
    const why = formationIssue(sp, g!, f, q, p.crew);
    if (why) { startWhy.push(`once lifted, ${why}`); return false; }
    return true;
  });
  if (!starts.length)
    return bad({ code: 'carry.pickup-blocked', message: `the crew cannot pick up the ${f.name} ${item.id} at ${fmt(lie.q.x, lie.q.z)}: ${startWhy[0]}`, subjects: [item.id, ...p.crew], at: [lie.q.x, levelY, lie.q.z] });
  if (toLevel !== level) return planStairCarry(rt, p, item, people, f, g, level, levelY, lie, starts, toLevel);
  // set-down target (yaw = long-axis direction; the crew may arrive facing either way)
  const tq: SE2 = { x: p.to.x, z: p.to.z, th: p.to.yaw };
  const cands = fixture ? [tq] : [tq, { ...tq, th: tq.th + Math.PI }];
  const lays = cands.map((q) => laidIssue(sp, f, q, level, levelY, item.id, p.crew));
  if (lays.every((l) => l)) {
    const lay = lays[0]!;
    return bad({ code: 'carry.target-blocked', message: `the ${f.name} ${item.id} cannot be set down at ${fmt(tq.x, tq.z)}: ${lay.reason}`, subjects: [item.id, ...lay.subjects], at: [tq.x, levelY, tq.z] });
  }
  const goalWhy: string[] = [];
  const goals = cands.filter((q, i) => {
    if (lays[i]) return false;
    const why = formationIssue(sp, g!, f, q, p.crew);
    if (why) goalWhy.push(why);
    return !why;
  });
  const humansFit = () =>
    people.every((e) => sp.route(w, HUMAN_PROFILE, { level, p: [e.pose.p[0], e.pose.p[2]] }, { level, p: [tq.x, tq.z] }, { goalTolerance: 1.0 }).ok);
  const routeFail = (why: string, extra: Partial<Diagnostic> = {}) => {
    const fit = humansFit();
    return bad({
      code: fit ? 'carry.clearance' : 'carry.no-route',
      message: fit ? `every crew member could walk to ${fmt(tq.x, tq.z)} alone, but the carrying formation cannot: ${why}` : why,
      subjects: [item.id, ...p.crew, ...(extra.subjects ?? [])],
      at: extra.at ?? [tq.x, levelY, tq.z],
      details: extra.details,
    });
  };
  if (!goals.length) return routeFail(`the ${f.name} formation does not fit at the target ${fmt(tq.x, tq.z)}: ${goalWhy[0]}`);
  const r = searchOrKept(sp, synced, g === synced ? '' : `without:${item.id}`, item.def, { g, f, starts, goals, labelOf: (id) => labelOf(sp, id), carrierNames: p.crew });
  if (!r.ok) return routeFail(r.diagnostic.message, r.diagnostic);
  const pickup = starts[r.start], target = goals[r.goal];
  const gr = gatherRoutes(sp, item, people, f, pickup, lie.halfW, level, levelY);
  if (!gr.ok) return gr;
  const { approach, gather } = gr;
  const laid = laidPose(f, target, levelY);
  const setdown = carrierSpots(f, target, entityFrame({ ...item, pose: laid }).halfW);
  return {
    ok: true,
    program: { f, crew: [...p.crew], item: item.id, level, levelY, lying: item.pose, pickup, approach, gather, traj: r.traj, target, laid, setdown, stats: { expanded: r.expanded, keyposes: r.keyposes } },
  };
}

/**
 * Carry to another level over one stair flight (single carrier; CARRY.md "Between levels"): pick the
 * flight (`via`, else the one a person would take), check it is usable and wide enough, line the
 * formation up level before the first step and after the last, sample the whole traversal (step
 * profile + other obstacles), then plan the SE(2) legs on both levels.
 */
function planStairCarry(
  rt: Runtime, p: CarryParams, item: Entity, people: Entity[], f: Formation, g: LevelGrid, level: number, levelY: number,
  lie: ReturnType<typeof entityFrame>, starts: SE2[], toLevel: number,
): PlanResult<CarryProgram> {
  const sp = rt.services.spatial as Spatial;
  const carrier = people[0];
  const gx = sp.level(toLevel);
  if (!gx) return bad({ code: 'route.unknown-level', message: `level ${toLevel} does not exist`, subjects: [item.id] });
  const toY = gx.y;
  const what = `the ${f.name} ${item.id}`;
  const subj = [item.id, ...p.crew];
  // 1. the flight
  let link: Link | undefined;
  let ascending = true;
  if (p.via) {
    link = sp.scene.links.find((l) => l.id === p.via);
    if (!link) return bad({ code: 'carry.via-unknown', message: `there is no stair or ladder "${p.via}"`, subjects: [p.via] });
    ascending = link.from.level === level && link.to.level === toLevel;
    if (!ascending && !(link.to.level === level && link.from.level === toLevel))
      return bad({ code: 'carry.via-mismatch', message: `${link.kind} ${link.id} connects levels ${link.from.level} and ${link.to.level}, not ${level} and ${toLevel}`, subjects: [item.id, link.id] });
    if (!link.usable)
      return bad({ code: 'route.link-unusable', message: `${what} cannot be carried to level ${toLevel} via ${link.kind} ${link.id}: it is not usable (${link.reason ?? 'not usable'})`, subjects: [item.id, link.id] });
  } else {
    const rr = sp.route(rt.world, HUMAN_PROFILE, { level, p: [carrier.pose.p[0], carrier.pose.p[2]] }, { level: toLevel, p: [p.to.x, p.to.z] }, { goalTolerance: 1.0 });
    if (!rr.ok) return bad({ ...rr.diagnostic, message: `${what} cannot be carried to level ${toLevel}: ${rr.diagnostic.message}`, subjects: [...subj, ...(rr.diagnostic.subjects ?? [])] });
    const flights = rr.route.legs.filter((l) => l.kind === 'link');
    if (flights.length !== 1)
      return bad({ code: 'carry.multi-flight', message: `${what} would have to go over ${flights.length} flights to reach level ${toLevel}; carrying over more than one flight is not supported yet`, subjects: subj });
    link = flights[0].link;
    ascending = flights[0].ascending;
  }
  // 2. the load and its carrier must fit the flight
  const cross = Math.max(f.width, f.height);
  const need = cross + 2 * STAIR_SIDE_MARGIN;
  if (link.width < need - 1e-9)
    return bad({
      code: 'carry.stairs-too-narrow',
      message: `${what} (carried cross-section ${f.width.toFixed(2)} × ${f.height.toFixed(2)} m) needs a flight at least ${need.toFixed(2)} m wide (${STAIR_SIDE_MARGIN} m clear each side of ${cross.toFixed(2)} m); ${link.kind} ${link.id} is ${link.width.toFixed(2)} m wide`,
      subjects: [item.id, link.id],
      details: { need, width: link.width },
    });
  const span = f.width + REACH + CARRIER_RADIUS;
  if (link.width < span - 1e-9)
    return bad({ code: 'carry.stairs-too-narrow', message: `${what} and ${carrier.id} beside it need ${span.toFixed(2)} m side by side; ${link.kind} ${link.id} is ${link.width.toFixed(2)} m wide`, subjects: [item.id, link.id], details: { need: span, width: link.width } });
  if (Math.abs(f.carry.pitch) > 1e-9)
    return bad({ code: 'carry.stairs-pose', message: `${what} is carried in a pose that cannot be tilted along a flight yet; it cannot be carried on ${link.id}`, subjects: [item.id, link.id] });
  const geo = climbGeom(link, ascending, f);
  const foot = ascending ? 'foot' : 'top';
  // 3. level formation poses before the first step and after the last, clear on their levels
  const lineUp = (grid: LevelGrid, base: number, sign: 1 | -1): { s: number } | { why: string } => {
    let why = '';
    for (const d of [0.3, 0.5, 0.8, 1.2, 1.6]) {
      const s = base + sign * (f.length / 2 + d);
      const q = climbPose(f, geo, s).q;
      if (poseHit(grid, f, q, PLAN_MARGIN) < 0) return { s };
      why ||= formationIssue(sp, grid, f, q, p.crew) ?? 'too close to an obstacle';
    }
    return { why };
  };
  const a = lineUp(g, geo.sFirst, -1);
  if ('why' in a) return bad({ code: 'carry.stairs-blocked', message: `${what} cannot line up with the ${foot} of ${link.id}: ${a.why}`, subjects: [item.id, link.id] });
  const b = lineUp(gx, geo.sLast, 1);
  if ('why' in b) return bad({ code: 'carry.stairs-blocked', message: `${what} cannot be carried clear of ${link.id} on level ${toLevel}: ${b.why}`, subjects: [item.id, link.id] });
  const s0 = a.s, s1 = b.s;
  // 4. the traversal: load above the step profile and clear of other geometry; carrier standable off the flight
  const others = climbObstacles(sp.scene.obstacles, link, [item.id]);
  for (let s = s0; ; s = Math.min(s1, s + 0.05)) {
    const cp = climbPose(f, geo, s);
    const at = (v: number[]) => `(${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)})`;
    const iss = stairClearance(link, item.def, cp.load);
    if (iss)
      return bad({ code: 'carry.stairs-clearance', message: `${what} would cut into the steps of ${link.id} at ${at(iss.at)} (${iss.deficit.toFixed(2)} m below the ${iss.surface.toFixed(2)} m step surface)`, subjects: [item.id, link.id], at: iss.at });
    const hit = loadObstacleHit(item.def, cp.load, others);
    if (hit)
      return bad({ code: 'carry.stairs-clearance', message: `${what} would hit '${hit.o.label ?? hit.o.id}' at ${at(hit.at)} while being carried on ${link.id}`, subjects: [item.id, link.id, hit.o.id], at: hit.at });
    const sc = s + geo.along;
    const cg = sc < geo.sFirst - 0.45 ? g : sc > geo.sLast + 0.45 ? gx : null;
    const why = cg ? standIssue(sp, cg, [cp.carrier[0], cp.carrier[2]]) : null;
    if (why)
      return bad({ code: 'carry.stairs-blocked', message: `${carrier.id} carrying ${what} cannot walk ${sc < geo.sFirst ? 'up to' : 'off'} ${link.id} at ${fmt(cp.carrier[0], cp.carrier[2])} (${why})`, subjects: [item.id, carrier.id, link.id] });
    if (s >= s1) break;
  }
  // 5. the set-down target on the exit level
  const tq: SE2 = { x: p.to.x, z: p.to.z, th: p.to.yaw };
  const cands = [tq, { ...tq, th: tq.th + Math.PI }];
  const lays = cands.map((q) => laidIssue(sp, f, q, toLevel, toY, item.id, p.crew));
  if (lays.every((l) => l)) return bad({ code: 'carry.target-blocked', message: `${what} cannot be set down at ${fmt(tq.x, tq.z)} on level ${toLevel}: ${lays[0]!.reason}`, subjects: [item.id, ...lays[0]!.subjects], at: [tq.x, toY, tq.z] });
  const goals = cands.filter((q, i) => !lays[i] && !formationIssue(sp, gx, f, q, p.crew));
  if (!goals.length) return bad({ code: 'carry.no-route', message: `the ${f.name} formation does not fit at the target ${fmt(tq.x, tq.z)} on level ${toLevel}: ${formationIssue(sp, gx, f, tq, p.crew)}`, subjects: subj, at: [tq.x, toY, tq.z] });
  // 6. the SE(2) legs: pickup → level line-up at the flight, and top line-up → set-down
  const q0 = climbPose(f, geo, s0).q, q1 = climbPose(f, geo, s1).q;
  const labelOfSp = (id: string) => labelOf(sp, id);
  const r0 = planCarry({ g, f, starts, goals: [q0], labelOf: labelOfSp, carrierNames: p.crew });
  if (!r0.ok) return bad({ ...r0.diagnostic, message: `${what} cannot be carried to the ${foot} of ${link.id}: ${r0.diagnostic.message}`, subjects: [...subj, ...(r0.diagnostic.subjects ?? [])] });
  const r1 = planCarry({ g: gx, f, starts: [q1], goals, labelOf: labelOfSp, carrierNames: p.crew });
  if (!r1.ok) return bad({ ...r1.diagnostic, message: `${what} cannot be carried from ${link.id} to ${fmt(tq.x, tq.z)} on level ${toLevel}: ${r1.diagnostic.message}`, subjects: [...subj, ...(r1.diagnostic.subjects ?? [])] });
  const pickup = starts[r0.start], target = goals[r1.goal];
  const gr = gatherRoutes(sp, item, people, f, pickup, lie.halfW, level, levelY);
  if (!gr.ok) return gr;
  const laid = laidPose(f, target, toY);
  const setdown = carrierSpots(f, target, entityFrame({ ...item, pose: laid }).halfW);
  return {
    ok: true,
    program: {
      f, crew: [...p.crew], item: item.id, level, levelY, lying: item.pose, pickup, approach: gr.approach, gather: gr.gather, traj: r0.traj, target, laid, setdown,
      stats: { expanded: r0.expanded + r1.expanded, keyposes: r0.keyposes + r1.keyposes },
      climb: { ...geo, s0, s1, fromLevel: level, toLevel, toY, deck: r1.traj },
    },
  };
}
