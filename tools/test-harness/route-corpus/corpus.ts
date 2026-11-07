// Issue #872 investigation corpus: "reachable places are often refused as route.unreachable".
// Boots a world from a walk-gate fixture copy (apps/server/src/god/walk-audit.ts bootForWalk: fake minds, engine bridge,
// edge ledger), takes one of the world's own Souls (or births one on a genesis world), and stands it at realistic points:
// where it stands in the copy, the engine's arrival point, each starting place, then the arrival point of a real walk
// (edge act + ticks until the receipt ends) to each of N sampled places, and (--upper K) of K real walks up a floor. From each
// start it asks about every offered `walk:<place>`: the ledger's runtime check (EdgeLedger.routeProblem), the engine's own
// canPerform for the plan (level walks and route.start-blocked, which routeProblem does not read) and the menu's own
// blocked offers. Every refusal is recorded with the engine's full diagnostic, the goal the engine chose, the static oracle
// (connectivityV1/navCheckV1: walkable both ways from the main area) for the destination and the start, direct experiments
// (one exact search over a larger window, without links, with a thinner body; a replay of the paged planner's hops; room,
// door and pocket probes) and, from ground starts, what the full act path (EdgeLedger.act -> launch) does with it.
// Diagnosis only: nothing here changes how the server plans. Labels and causes: report.mjs.
//
//   node tools/test-harness/route-corpus/corpus.ts --db <fixture.db.gz> --out .local/872/<world>.json [--starts N] [--upper K]
//        [--arrive walk|goal] [--walk-ticks T] [--name n] [--policy route-reach]
//   node tools/test-harness/route-corpus/corpus.ts --genesis worlds/templates/eden-2026.json --out ... (a probe Soul is born)
// Deterministic: places sorted by id, every k-th sampled; no Math.random.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { bootForWalk } from '../../../apps/server/src/god/walk-audit.ts';
import { findRoute } from '../../../mars/viewer/engine/spatial/path.ts';
import { HOP_M, WALK_COST, rectOf } from '../../../mars/viewer/engine/spatial/tiled.ts';
import { bodyProfile } from '../../../mars/viewer/engine/bodies/navigation.ts';
const route = findRoute as (...a: unknown[]) => any;

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(`--${k}`); return i < 0 ? undefined : a[i + 1]; };
const dbArg = arg('db'), genesis = arg('genesis'), out = arg('out');
const N = Number(arg('starts') ?? 30), ARRIVE = (arg('arrive') ?? 'walk') as 'walk' | 'goal', WALK_TICKS = Number(arg('walk-ticks') ?? 6000);
if (!out || (!dbArg === !genesis)) { console.error('usage: corpus.ts --db <fixture.db.gz> | --genesis <template.json>  --out <file.json> [--starts N] [--arrive walk|goal] [--walk-ticks T]'); process.exit(2); }

const T0 = performance.now(), ms = () => Math.round(performance.now() - T0);
const w = await bootForWalk({ db: dbArg && resolve(dbArg), genesis: genesis && resolve(ROOT, genesis), name: arg('name') });
// --policy route-reach: the same corpus with route-reach/1 (#872) accepted first (a logged prospective rules fact), for the after rate
if (arg('policy') === 'route-reach') { const p = w.host.enableRouteReachV1(); for (let i = 0; i < 50; i++) { await setImmediate(); w.host.drainInputs(); } await p; }
else if (arg('policy')) throw Error(`unknown --policy ${arg('policy')}`);
const { host, edge, engine: E, bridge } = w as any;
const sp = () => E.rt.services.spatial;
const r2 = (v: number) => Math.round(v * 100) / 100;
const settle = async (p: Promise<unknown>) => { let done = false, val: unknown, err: unknown; p.then(v => { done = true; val = v; }, e => { done = true; err = e; });
  for (let i = 0; !done && i < 400; i++) { await setImmediate(); host.drainInputs(); } if (err) throw err; return val as any; };
console.error(`[corpus] ${w.name}: booted at ${ms()} ms`);

// ---------------------------------------------------------------- the probe Soul
let probe = [...host.minds.values()].sort((x: any, y: any) => (x.soulId < y.soulId ? -1 : 1))[0] as any;
if (!probe) {
  // a genesis world has no Souls: one is born near the engine's arrival point (birth-near/1), as a hosted birth is
  const id = 's_c872000001', entityId = 'h_c872000001', arrival = E.exportStaticScene().arrival as [number, number];
  host.db.createSoul({ id, worldId: host.worldId, owner: 'dev:corpus', entityId, name: 'Corpus Probe', description: 'route corpus probe', native: false });
  await settle(host.enqueue('birth', `corpus:${id}`, { soulId: id, entityId, name: 'Corpus Probe', description: 'route corpus probe', owner: 'dev:corpus', near: { at: arrival, first: true } }));
  probe = host.minds.get(id);
  if (!probe) { console.error('[corpus] no probe Soul could be born'); process.exit(1); }
}
const soul = { soulId: probe.soulId, entityId: probe.entityId, name: probe.name, owner: probe.owner ?? 'corpus' };
const body = () => E.world.entities[soul.entityId];
const pose = () => { const b = body(); return { x: r2(b.pose.p[0]), z: r2(b.pose.p[2]), level: b.human?.level ?? 0 }; };
const others = () => Object.values(E.world.entities as Record<string, any>).filter((e: any) => e.kind === 'human' && e.id !== soul.entityId).length;

// ---------------------------------------------------------------- static oracle
const tc = performance.now(); E.connectivityV1(); console.error(`[corpus] connectivity labels ${Math.round(performance.now() - tc)} ms`);
const oracle = (p: [number, number], level: number, tol = 0.35) => { const v = E.navCheckV1([{ id: 'q', p, level, tol }])[0]; return { ok: !!v?.ok, code: v?.code ?? null, area: v?.area ?? null, ...(v?.pocket !== undefined ? { pocket: Math.round(v.pocket) } : {}) }; };
const things = new Map<string, any>((bridge.nav.things() as any[]).map(t => [t.ref, t]));

// ---------------------------------------------------------------- the engine's own goal choice (mirrors canPerform)
type Goal = { x: number; z: number; level: number } | 'here' | { code: string; message: string };
function walkStep(steps: any[]) { return steps[0]?.verb === 'walk_to' ? steps[0] : null; }
function engineGoal(steps: any[]): Goal | null {
  const s = walkStep(steps); if (!s) return null; const p = s.params ?? {};
  const spread = (p.spread === 'pond/1' || p.spread === 'region/1' || p.spread === 'pond-lap/1') && typeof p.to === 'string' && E.rt.world.regions[p.to];
  return spread ? E.spreadGoalV1(soul.entityId, p.to, p.spread, E.sharedWaterStep(s), p.regionOutside) : E.goalNear(soul.entityId, p.to, typeof p.standoff === 'number' ? p.standoff : 0);
}
/** The point and level a walk step names (pointOf + goalNear's level rule). */
function targetOf(steps: any[]): { p: [number, number]; level: number; kind: string } | null {
  const m = steps[0]?.verb === 'mars:walk_to' ? steps[0] : null;   // up (or down) a floor: the level walk's own point
  if (m) return { p: [r2(Number(m.params.x)), r2(Number(m.params.z))], level: Number(m.params.level ?? 0), kind: 'level-point' };
  const s = walkStep(steps); if (!s) return null; const to = s.params?.to, t = E.pointOf(to); if (!t) return null;
  const level = typeof to === 'string' ? (E.rt.world.regions[to]?.level ?? E.ents[to]?.human?.level ?? (E.cfg.fixtureGroundGoalsV1 && E.ents[to]?.support?.kind === 'ground' ? 0 : body().human.level)) : body().human.level;
  return { p: [r2(t[0]), r2(t[1])], level, kind: Array.isArray(to) ? 'point' : E.rt.world.regions[to] ? (s.params.spread ? `region:${s.params.spread}` : 'region') : E.ents[to] ? 'entity' : 'other' };
}
/** The diagnostic's own start and goal: "no route from level L (x, z) to level L (x, z) for a r m-radius agent". */
function parseDiag(msg: string) {
  const m = /from level (-?\d+) \((-?[\d.]+), (-?[\d.]+)\) to level (-?\d+) \((-?[\d.]+), (-?[\d.]+)\) for a ([\d.]+) m-radius/.exec(msg);
  if (m) return { from: { level: +m[1], p: [+m[2], +m[3]] as [number, number] }, to: { level: +m[4], p: [+m[5], +m[6]] as [number, number] }, r: +m[7] };
  const g = /destination \((-?[\d.]+), (-?[\d.]+)\) on level (-?\d+)/.exec(msg);
  if (g) return { to: { level: +g[3], p: [+g[1], +g[2]] as [number, number] } };
  const s = /start \((-?[\d.]+), (-?[\d.]+)\) on level (-?\d+)/.exec(msg);
  if (s) return { from: { level: +s[3], p: [+s[1], +s[2]] as [number, number] } };
  return null;
}

// ---------------------------------------------------------------- experiments for one refusal
/** One exact fine search over a big window holding start and goal (links kept), the planner's own cells: does any route
 *  exist at all? `margin` metres round both points (tiles of 64 m), `links` false drops stairs/ramps as level-0 hops do. */
function wholeWindow(from: { p: [number, number]; level: number }, to: { p: [number, number]; level: number }, margin = 48, links = true, radius?: number) {
  const S = sp(); S.sync(E.rt.world);
  const prof = { ...walkerProfile(), ...(radius !== undefined ? { radius } : {}) };
  if (!S.ground) { const r = route(S.grids, links ? S.scene : { ...S.scene, links: [] }, prof, from, to, {}); return r.ok ? { ok: true, length: r2(r.route.length) } : { ok: false, code: r.diagnostic.code, message: r.diagnostic.message }; }
  const rect = rectOf([from.p, to.p], margin), tiles = (rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1);
  if (tiles > 36) return { ok: false, code: 'corpus.window-too-big', message: `${tiles} tiles` };
  const grids = S.ground.gridsOver(rect, S.scene), x0 = rect[0] * 64, z0 = rect[1] * 64, x1 = (rect[2] + 1) * 64, z1 = (rect[3] + 1) * 64;
  const r = route(grids, { ...S.scene, bounds: [x0, z0, x1, z1], links: links ? S.scene.links : [] }, prof, from, to, {});
  return r.ok ? { ok: true, length: r2(r.route.length), tiles } : { ok: false, code: r.diagnostic.code, message: r.diagnostic.message, tiles };
}
const walkerProfile = () => bodyProfile(body());

/** Replay the ground planner's hops (tiled.ts groundRoute / pagedRoute) for a level-0 walk: the coarse path, the hop ends
 *  (HOP_M), each hop's fine search on its own tile window (rectOf(..., 12 m), links dropped). Reports the first hop that
 *  fails, and the same hop on that window grown by one tile each side (with and without links). */
function hopReplay(from: [number, number], to: [number, number]) {
  const S = sp(); S.sync(E.rt.world); const nav = S.ground; if (!nav) return null;
  const path = nav.coarsePath(from, to, WALK_COST) ?? nav.coarsePath(from, to, WALK_COST, 160, 2_000_000);
  if (!path) return { coarse: false };
  let coarseLen = 0; for (let i = 1; i < path.length; i++) coarseLen += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const ends: number[] = []; let acc = 0;
  for (let k = 1; k < path.length; k++) { acc += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); if (acc >= HOP_M && k < path.length - 4) { ends.push(k); acc = 0; } }
  ends.push(path.length);
  const prof = walkerProfile(), hops: Row[] = [];
  let at = from, prev = 0;
  const run = (r: number[], target: [number, number], last: boolean, links: boolean) => {
    const grids = { cell: nav.cell, levels: new Map([[0, nav.compose(r, S.scene.obstacles)]]) };
    return route(grids as any, { ...S.scene, bounds: [r[0] * 64, r[1] * 64, (r[2] + 1) * 64, (r[3] + 1) * 64], links: links ? S.scene.links : [] }, prof, { level: 0, p: at }, { level: 0, p: target }, last ? {} : { goalTolerance: 2.5 });
  };
  for (let h = 0; h < ends.length && h < (nav.paged ? 1 : ends.length); h++) {
    const k = ends[h], last = k >= path.length, target: [number, number] = last ? to : path[k];
    const r = rectOf([at, target, ...path.slice(prev + 1, Math.min(k, path.length - 1) + 1)]);
    const res = run(r, target, last, false);
    const hop: Row = { h, last, target: [r2(target[0]), r2(target[1])], rect: r, ok: res.ok, ...(res.ok ? {} : { code: res.diagnostic.code }) };
    hops.push(hop);
    if (!res.ok) {
      const g = [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1];
      const grown = run(g, target, last, false), grownLinks = run(g, target, last, true), links = run(r, target, last, true);
      hop.sameRectWithLinks = links.ok ? 'ok' : links.diagnostic.code; hop.grownRect = grown.ok ? `ok ${r2(grown.route.length)} m` : grown.diagnostic.code; hop.grownRectWithLinks = grownLinks.ok ? `ok ${r2(grownLinks.route.length)} m` : grownLinks.diagnostic.code;
      break;
    }
    prev = Math.min(k, path.length - 1);
    const end = (res.route.legs.at(-1) as any)?.points?.at(-1); at = end ?? target;
  }
  return { coarse: true, coarseLen: r2(coarseLen), hops: ends.length, paged: !!nav.paged, replay: hops };
}
/** A room/building the menu offered as unavailable (GodNav roomGoal: nothing inside it reached from its front door): which of
 *  its standing points are walkable both ways from the main area (oracle), what the front-door reach answers for them,
 *  and whether this Soul's walk to the nearest such point plans from where it stands. */
function roomProbe(th: any, me: [number, number]) {
  const room = th.kind === 'room' ? th : [...things.values()].find((x: any) => x.kind === 'room' && th.rooms?.includes(x.ref));
  if (!room?.poly) return { room: room?.ref ?? null, poly: false };
  const xs = room.poly.map((q: number[]) => q[0]), zs = room.poly.map((q: number[]) => q[1]), pts: [number, number][] = [];
  for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += 0.4) for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs); z += 0.4) if (inPoly(x, z, room.poly)) pts.push([r2(x), r2(z)]);
  const v = E.navCheckV1(pts.map((p, i) => ({ id: String(i), p, level: room.level, tol: 0.05 }))) as any[];
  const good = pts.filter((_, i) => v[i]?.ok), roomy = pts.filter((_, i) => v[i] && v[i].code !== 'nav.no-standing-room');
  const entry = room.entry ? { ...room.entry, oracle: oracle(room.entry.p, room.entry.level) } : null;
  const best = good.sort((a, b) => Math.hypot(a[0] - room.at[0], a[1] - room.at[1]) - Math.hypot(b[0] - room.at[0], b[1] - room.at[1]))[0];
  let fromEntry: unknown = null, fromHere: unknown = null, here48: unknown = null;
  if (best && room.entry) { const r = E.reachV1({ p: room.entry.p, level: room.entry.level }, { p: best, level: room.level }); fromEntry = r.ok ? 'ok' : `${r.code}: ${r.message}`; }
  if (best) {
    const d = E.canPerform({ actor: soul.entityId, label: 'corpus room point', steps: [room.level === 0 && body().human.level === 0 ? { verb: 'walk_to', params: { to: best, standoff: 0 } } : { verb: 'mars:walk_to', params: { x: best[0], z: best[1], level: room.level } }] });
    fromHere = d ? `${d.code}: ${d.message}` : 'ok';
    here48 = wholeWindow({ p: me, level: body().human.level }, { p: best, level: room.level }, 48, true);
  }
  // no connected point: the standable point nearest the room's centre, and whether a closed door walls it (door passage)
  const stand = roomy.sort((a, b) => Math.hypot(a[0] - room.at[0], a[1] - room.at[1]) - Math.hypot(b[0] - room.at[0], b[1] - room.at[1]))[0];
  const door = !best && stand && room.level === 0 ? doorProbe([{ verb: 'walk_to', params: { to: stand, standoff: 0 } }]) : null;
  return { room: room.ref, level: room.level, samples: pts.length, standable: roomy.length, connected: good.length, entry, best: best ?? null, entryReachBest: fromEntry, walkHereToBest: fromHere, window48HereToBest: here48, ...(door ? { bestStandable: stand, door } : {}) };
}
/** Does a closed door explain a plain walk no route reaches (engine closedDoorsOnWalkV1), and would the ledger's door passage
 *  (god/door-passage.ts, the act path's entry 31) walk through it from here: its legs plan (canPerform) or not. */
function doorProbe(steps: any[]) {
  const found = E.closedDoorsOnWalkV1?.(soul.entityId, steps);
  if (!found) return { doors: [] };
  let passage: unknown = null;
  if (edge.doorPassage) {
    const p = edge.doorPassage(soul, steps, 'there');
    if (!p) passage = 'none';
    else if ('refuse' in p) passage = { refuse: p.code, reason: String(p.reason).slice(0, 200) };
    else { const a = E.canPerform({ actor: soul.entityId, label: 'corpus door', steps: p.steps }), b = E.canPerform({ actor: soul.entityId, label: 'corpus door', steps: p.direct });
      passage = { door: p.door, legs: a ? a.code : 'ok', direct: b ? b.code : 'ok' }; }
  }
  return { doors: found.doors, passage };
}
/** A goal in a pocket: the nearest main-area standing point to the target within 1.5 m, and whether a walk there plans. */
function nearMain(tgt: { p: [number, number]; level: number }) {
  if (tgt.level !== 0) return null;
  const q = E.navNearestMainV1?.(tgt.p, soul.entityId, 1.5);
  if (!q) return { within15: false };
  const d = E.canPerform({ actor: soul.entityId, label: 'corpus near', steps: [{ verb: 'walk_to', params: { to: q, standoff: 0 } }] });
  return { within15: true, at: [r2(q[0]), r2(q[1])], d: r2(Math.hypot(q[0] - tgt.p[0], q[1] - tgt.p[1])), walk: d ? d.code : 'ok' };
}
function inPoly(x: number, z: number, poly: number[][]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }

/** Direct experiments for one refusal, run standing at its start. */
async function experiments(r: Row, st: any) {
  const from = { p: [st.at.x, st.at.z] as [number, number], level: st.at.level };
  const tgt = r.target as any, dg = (r.diag as any)?.to, exp: Row = {};
  if (tgt) {
    exp.window48 = wholeWindow(from, { p: tgt.p, level: tgt.level }, 48, true);
    exp.window48NoLinks = wholeWindow(from, { p: tgt.p, level: tgt.level }, 48, false);
    exp.window12 = wholeWindow(from, { p: tgt.p, level: tgt.level }, 12, true);
    exp.radius20 = wholeWindow(from, { p: tgt.p, level: tgt.level }, 48, true, 0.2);
  }
  if (dg && tgt && Math.hypot(dg.p[0] - tgt.p[0], dg.p[1] - tgt.p[1]) > 0.5) { exp.diagGoalIsNotTarget = r2(Math.hypot(dg.p[0] - tgt.p[0], dg.p[1] - tgt.p[1])); exp.diagGoalOracle = oracle(dg.p, dg.level); }
  if (r.navGoal && tgt && Math.hypot((r.navGoal as any).p[0] - tgt.p[0], (r.navGoal as any).p[1] - tgt.p[1]) > 0.05) exp.navGoalWindow48 = wholeWindow(from, r.navGoal as any, 48, true);
  if (tgt && tgt.level === 0 && from.level === 0 && r.code === 'route.unreachable') exp.hopReplay = hopReplay(from.p, tgt.p);
  if (r.menuBlocked) { const th = things.get((r.cap as string).slice(5)); if (th) exp.room = roomProbe(th, from.p); }
  if (!r.menuBlocked && tgt && String(r.code).startsWith('route.')) { exp.near = nearMain(tgt); if (r.steps) exp.door = doorProbe(r.steps as any[]); }
  r.exp = exp;
  // the full act path (EdgeLedger.act -> launch: door passage, nav-connect rescue, goal-blocked nudge): accepted or refused?
  // An accepted walk is stopped and the probe put back (level 0 starts only: a relocate never lands upstairs).
  if (from.level === 0) {
    const res = await settle(edge.act(soul, { capability: r.cap }));
    const row = res.accepted ? host.db.db.prepare('SELECT reason, detail FROM edge_receipts_v1 WHERE receipt_id=?').get(res.receipt.id) as any : null;
    const detail = row?.detail ? JSON.parse(row.detail) : {};
    r.act = res.accepted ? { accepted: true, phase: res.receipt?.phase, reason: row?.reason ?? null, ...(detail.approach ? { approach: detail.approach } : {}), ...(detail.doorPassageV1 ? { door: detail.doorPassageV1.door } : {}) }
      : { accepted: false, code: res.code, reason: String(res.reason ?? '').slice(0, 300) };
    if (res.accepted) { await stopNow(); for (let j = 0; j < 40 && E.programOf(soul.entityId); j++) { host.tickOnce(); if (j % 10 === 0) { await setImmediate(); host.drainInputs(); } } }
    const now = pose();
    if (Math.hypot(now.x - from.p[0], now.z - from.p[1]) > 0.05 || now.level !== 0) { await relocate(from.p, 'corpus: back to the start'); const back = pose(); if (Math.hypot(back.x - from.p[0], back.z - from.p[1]) > 0.05) (r.act as any).drift = back; }
  }
}

// ---------------------------------------------------------------- one start
type Row = Record<string, unknown>;
const rows: Row[] = [], starts: Row[] = [], upOffers = new Map<string, [number, number, number]>();
async function checkFrom(how: string, extra: Row = {}) {
  const at = pose(), sv = oracle([at.x, at.z], at.level, 0.5), si = starts.length;
  const caps = edge.capabilities(soul) as any[], walks = caps.filter(c => c.id.startsWith('walk:')).sort((x, y) => (x.id < y.id ? -1 : 1));
  const plans = edge.ambientPlans(soul).plans as Map<string, { label: string; steps: any[] }>;
  const t = performance.now(); let refused = 0;
  starts.push({ i: si, how, ...extra, at, startOracle: sv, others: others(), offeredWalks: walks.length, unavailableWalks: walks.filter(c => !c.available).length });
  for (const c of walks) {
    const plan = plans.get(c.id) ?? edge.bindOne(soul, c.id)?.plan;
    const rp = edge.routeProblem(soul, c.id, plans);
    const menuBlocked = !c.available && c.blocked ? c.blocked.code : null;
    // the engine's own verdict for the plan (what launch asks first): routeProblem only reads plain walk_to plans and only
    // reports ROUTE_DEAD codes, so a level walk (mars:walk_to, up or down a floor) and route.start-blocked are read here
    const walky = plan?.steps?.[0] && (plan.steps[0].verb === 'walk_to' || plan.steps[0].verb === 'mars:walk_to');
    const issue = walky ? E.canPerform({ actor: soul.entityId, label: plan.label, steps: plan.steps }) : null;
    const hard = issue && /^(route|ground)\./.test(issue.code) ? issue : null;
    if (plan && walky && c.available && plan.steps[0].verb === 'mars:walk_to' && Number(plan.steps[0].params?.level) > 0 && !upOffers.has(c.id)) upOffers.set(c.id, [at.x, at.z, at.level]);
    if (!rp && !menuBlocked && !hard) { rows.push({ s: si, cap: c.id, ok: true }); continue; }
    refused++;
    const tgt = plan ? targetOf(plan.steps) : null, th = things.get(c.id.slice(5));
    const navGoal = th ? bridge.nav.goal(th, [at.x, at.z], soul.entityId) : null;
    const g = plan ? engineGoal(plan.steps) : null;
    const d = hard;
    const row: Row = { s: si, cap: c.id, ok: false, code: rp?.code ?? menuBlocked ?? d?.code, ...(rp ? { routeProblem: rp.code } : {}), message: d?.message ?? null, ...(menuBlocked ? { menuBlocked } : {}),
      steps: plan?.steps?.map((x: any) => ({ verb: x.verb, params: x.params })), target: tgt, engineGoal: g,
      navGoal, thingKind: th?.kind ?? null, diag: d?.message ? parseDiag(d.message) : null,
      oracle: { target: tgt ? oracle(tgt.p, tgt.level) : null, navGoal: navGoal ? oracle(navGoal.p, navGoal.level) : null } };
    rows.push(row);
  }
  for (const r of rows) if (r.s === si && !r.ok) await experiments(r, starts[si]);
  console.error(`[corpus] start ${si} (${how}) at ${at.x},${at.z} L${at.level}: ${walks.length} walks, ${refused} refused, ${Math.round(performance.now() - t)} ms (t=${ms()} ms)`);
  return walks;
}

// ---------------------------------------------------------------- moving the probe
const relocate = async (to: [number, number], why: string) => { await settle(host.enqueue('edge-relocate', `test:${soul.soulId}`, { soulId: soul.soulId, entityId: soul.entityId, to, why })); };
const stopNow = async () => { if (E.programOf(soul.entityId)) await settle(host.enqueue('edge-stop', `test:${soul.soulId}`, { soulId: soul.soulId, entityId: soul.entityId, why: 'corpus' })).catch(() => {}); };
async function walkTo(cap: string): Promise<{ how: string; phase?: string; code?: string; ticks?: number }> {
  const r = await settle(edge.act(soul, { capability: cap }));
  if (!r.accepted) return { how: 'refused', code: r.code };
  let i = 0;
  for (; i < WALK_TICKS; i++) {
    const ph = edge.receipt(soul.soulId, r.receipt.id)?.phase;
    if (!['waiting', 'started'].includes(ph)) break;
    host.tickOnce(); if (i % 20 === 0) { await setImmediate(); host.drainInputs(); }
  }
  const rec = edge.receipt(soul.soulId, r.receipt.id);
  if (['waiting', 'started'].includes(rec?.phase)) { await stopNow(); for (let j = 0; j < 40; j++) host.tickOnce(); host.drainInputs(); }
  return { how: 'walked', phase: rec?.phase, code: rec?.code ?? undefined, ticks: i };
}

// starts 0..: where the probe stands in the copy, then each starting place's landing spot (startingPoint's own rule)
await checkFrom('fixture-pose');
// the engine's own arrival point (where a newcomer lands; the main area is the component holding it)
const ARRIVAL = E.exportStaticScene().arrival as [number, number];
await relocate(ARRIVAL, 'corpus: arrival point');
await checkFrom('arrival-point');
const startPlaces = [...edge.places.byId.values()].filter((p: any) => p.starting && p.parent !== null).sort((x: any, y: any) => (x.id < y.id ? -1 : 1));
for (const p of startPlaces) {
  const spot = E.clearSpotsV1?.(p.polygon, 1)?.[0];
  if (!spot) continue;
  await relocate(spot, 'corpus: starting place');
  await checkFrom('starting-place', { place: p.id });
}
// the sampled places, from the first starting place's menu (sorted ids, every k-th)
if (startPlaces.length) { const s0 = E.clearSpotsV1?.(startPlaces[0].polygon, 1)?.[0]; if (s0) await relocate(s0, 'corpus: starting place'); }
const menu = (edge.capabilities(soul) as any[]).filter(c => c.id.startsWith('walk:')).map(c => c.id).sort();
// one destination per place (the top segment of its path), every k-th place; inside a place, member (j mod size), so the
// sample mixes the place itself with its rooms, seats and things
const groups = new Map<string, string[]>();
for (const id of menu) { const top = id.slice(5).split('/')[0]; const l = groups.get(top) ?? []; l.push(id); groups.set(top, l); }
const gk = [...groups.keys()].sort(), k = Math.max(1, Math.ceil(gk.length / Math.max(1, N)));
const sample = gk.filter((_, i) => i % k === 0).slice(0, N).map((g, j) => { const l = groups.get(g)!; return l[j % l.length]; });
console.error(`[corpus] sampling ${sample.length} of ${gk.length} places (${menu.length} walk offers, every ${k}th place), arrive=${ARRIVE}`);
for (const cap of sample) {
  let how = 'arrival-walk', note: Row = {};
  if (ARRIVE === 'walk') {
    const r = await walkTo(cap); note = { walk: r };
    if (r.how === 'refused' || r.phase !== 'completed') {
      // no arrival: land at the walk's own goal instead (level 0 only: a relocate never lands upstairs)
      const plan = edge.bindOne(soul, cap)?.plan, g = plan ? engineGoal(plan.steps) : null;
      if (r.how === 'refused' && g && g !== 'here' && !('code' in g) && g.level === 0) { await relocate([g.x, g.z], 'corpus: goal of a refused walk'); how = 'goal-relocate'; }
      else if (r.how === 'refused') { continue; }
      else how = `arrival-walk-${r.phase}`;
    }
  } else {
    const plan = edge.bindOne(soul, cap)?.plan, g = plan ? engineGoal(plan.steps) : null;
    if (!g || g === 'here' || 'code' in g || g.level !== 0) continue;
    await relocate([g.x, g.z], 'corpus: walk goal'); how = 'goal-relocate';
  }
  await checkFrom(how, { via: cap, ...note });
}

// upper floors (--upper K): K offered walks whose goal is up a floor (a mars:walk_to with level > 0), every k-th by id, each
// walked from the ground for real, then checked from where the walk ended
const UPPER = Number(arg('upper') ?? 0);
if (UPPER > 0) {
  const up = [...upOffers.keys()].filter(id => upOffers.get(id)![2] === 0).sort();
  const ku = Math.max(1, Math.ceil(up.length / UPPER)), pick = up.filter((_, i) => i % ku === 0).slice(0, UPPER);
  console.error(`[corpus] upper floors: ${pick.length} of ${up.length} upstairs offers`);
  for (const cap of pick) {
    const from = upOffers.get(cap)!; await relocate([from[0], from[1]], 'corpus: where the upstairs walk was offered');
    const r = await walkTo(cap);
    if (r.how === 'refused' || pose().level === 0) { console.error(`[corpus] upper ${cap}: ${JSON.stringify(r)}, ended on level ${pose().level}`); continue; }
    await checkFrom('arrival-walk-upstairs', { via: cap, walk: r });
    await relocate(ARRIVAL, 'corpus: back to the arrival point');
  }
}

// ---------------------------------------------------------------- labels
// FALSE: the static oracle walks the destination both ways from the main area and the start stands in the main area, or the
// same destination is walked from another start in this corpus whose oracle verdict is the same area; GENUINE: the oracle
// also refuses the destination, or the start is cut off; UNCLEAR: anything else (no target to check).
const okFrom = new Map<string, number[]>();
for (const r of rows) if (r.ok) { const l = okFrom.get(r.cap as string) ?? []; l.push(r.s as number); okFrom.set(r.cap as string, l); }
for (const r of rows) {
  if (r.ok) continue;
  const st = starts[r.s as number] as any, o = (r.oracle as any), dest = o.target ?? o.navGoal;
  r.okFromOtherStarts = (okFrom.get(r.cap as string) ?? []).length;
  const room = (r.exp as any)?.room;
  if (r.code === 'route.start-blocked') r.label = st.startOracle.ok ? 'FALSE' : 'GENUINE';
  else if (r.menuBlocked && room && room.samples) r.label = !st.startOracle.ok ? 'GENUINE' : room.door?.passage?.legs === 'ok' || room.door?.passage?.direct === 'ok' ? 'FALSE' : room.connected === 0 ? 'GENUINE' : room.walkHereToBest === 'ok' ? 'FALSE' : 'UNCLEAR';
  else if (!st.startOracle.ok) r.label = 'GENUINE';
  else if (dest?.ok || o.navGoal?.ok) r.label = 'FALSE';
  else if ((r.exp as any)?.door?.passage?.legs === 'ok' || (r.exp as any)?.door?.passage?.direct === 'ok' || room?.door?.passage?.legs === 'ok' || room?.door?.passage?.direct === 'ok') r.label = 'FALSE';
  else if (dest && !dest.ok) r.label = 'GENUINE';
  else r.label = (r.okFromOtherStarts as number) > 0 ? 'FALSE' : 'UNCLEAR';
}

// ---------------------------------------------------------------- summary
const ROUTE = /^route\./, refusals = rows.filter(r => !r.ok), count = (f: (r: Row) => string) => refusals.reduce((m: Record<string, number>, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const summary = { world: w.name, worldId: w.worldId, probe: soul.soulId, arrive: ARRIVE, starts: starts.length, checks: rows.length, refusals: refusals.length,
  byCode: count(r => String(r.code)), byLabel: count(r => String(r.label)), byCodeLabel: count(r => `${r.code} ${r.label}`),
  routeRefusals: refusals.filter(r => ROUTE.test(String(r.code))).length,
  routeByLabel: refusals.filter(r => ROUTE.test(String(r.code))).reduce((m: Record<string, number>, r) => { m[String(r.label)] = (m[String(r.label)] ?? 0) + 1; return m; }, {}),
  routeFalseRate: rows.length ? r2(1e5 * refusals.filter(r => r.label === 'FALSE' && ROUTE.test(String(r.code))).length / rows.length) / 1e5 : 0,
  paged: !!sp().ground?.paged, ground: !!sp().ground,
  falseRate: rows.length ? r2(1000 * refusals.filter(r => r.label === 'FALSE').length / rows.length) / 1000 : 0, ms: ms() };
if (!existsSync(dirname(resolve(out)))) mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify({ summary, starts, refusals, ok: rows.filter(r => r.ok).map(r => [r.s, r.cap]) }, null, 1) + '\n');
console.error(`[corpus] ${JSON.stringify(summary)}`);
w.stop(); process.exit(0);
