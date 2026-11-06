// Crew accompanies lifted parts (spec §7/§8) — Mars assembly model v1, approximate
// (rule-based plausibility, not ergonomics). During a construction lift each holder
// walks beside the part: its grip slot names a hand point on the part, and the
// holder's ground target is that point pushed FOLLOW_OFFSET outward from the part
// footprint, on the holder's own level. Holders move ≤ FOLLOW_SPEED, never through
// static geometry or other people; the part waits for them (it never outruns its
// crew) and the lift fails `lift.crew-blocked` if a holder stays stuck > 2 s.
// Holders working from a level above the part (a deck worker receiving a joist from
// below) keep slot `lift-station` and stay put — hand-up is not modelled.
import { datan2, rot2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { clearanceAt, nearestBlocker, segmentClearance, type LevelGrid } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';

export const HAND_REACH = 1.0; // m: ground distance holder → hand point while held (invariant)
export const LIFT_APEX_MAX = 2.4; // m: hand point above the holder's floor (invariant; lift-over apex rule)
export const FOLLOW_OFFSET = 0.35; // m outward from the part footprint
export const FOLLOW_FAR = [0.6, 0.85]; // m: fallback offsets when there is no room at FOLLOW_OFFSET (all < FOLLOW_KEEP)
export const FOLLOW_SPEED = 0.9; // m/s
export const FOLLOW_CLEARANCE = HUMAN_PROFILE.radius; // 0.28 m standing room
export const FOLLOW_PERSONAL = 2 * HUMAN_PROFILE.radius; // 0.56 m to anyone else
export const CREW_BLOCK_TIMEOUT = 2.0; // s a holder may be stuck before the lift fails
export const FOLLOW_KEEP = 0.9; // m: the part waits rather than end a tick farther than this from a holder
export const STATION_SLOT = 'lift-station';

export type Hand = { p: Vec3; out: Vec2 };

/**
 * Hand point of grip `slot` on part `e` at pose `q`, with the outward direction:
 * `lift-end-0/1` = the ends (∓0.45·length on local x, out along x); `lift-edge-0/1` = the long-edge
 * midpoints (∓half-width on local z, out along z); `lift-corner-EK` = near corner K (∓0.4·width) of
 * end E (∓0.45·length), out along x. Height = the part's underside. null = not a follow slot.
 */
export function handPoint(e: Entity, q: Pose, slot: string): Hand | null {
  const m = /^lift-(end|edge|corner)-([01])([01])?$/.exec(slot);
  if (!m || (m[1] === 'corner') !== !!m[3]) return null;
  const sg = (c: string) => (c === '1' ? 1 : -1);
  const [lx, , lz] = def(e.def).size;
  const loc: Vec2 = m[1] === 'edge' ? [0, (sg(m[2]) * lz) / 2] : [sg(m[2]) * 0.45 * lx, m[3] ? sg(m[3]) * 0.4 * lz : 0];
  const o = rot2(loc, q.yaw);
  return { p: [q.p[0] + o[0], q.p[1], q.p[2] + o[1]], out: rot2(m[1] === 'edge' ? [0, sg(m[2])] : [sg(m[2]), 0], q.yaw) };
}

/** Standing context of one holder: its level grid and everyone else on that level. */
export type Room = { g: LevelGrid; others: { id: string; p: Vec2 }[] };

const d2 = (a: Vec2, b: Vec2) => hypot(a[0] - b[0], a[1] - b[1]);

function crowd(r: Room, p: Vec2) {
  return r.others.find((o) => d2(o.p, p) < FOLLOW_PERSONAL);
}

/** Room to stand at p (clearance and personal space); `from` = where the holder stands now (never made worse). */
export function standable(r: Room, p: Vec2, from?: Vec2): boolean {
  const c = clearanceAt(r.g, p);
  if (c < FOLLOW_CLEARANCE && !(from && c >= clearanceAt(r.g, from) && c > 0)) return false;
  const o = crowd(r, p);
  return !o || (!!from && d2(o.p, p) >= d2(o.p, from));
}

/** What keeps a holder from standing at p (for diagnostics). */
export function blockerAt(r: Room, p: Vec2): string {
  const o = crowd(r, p);
  if (o) return `${o.id} standing ${d2(o.p, p).toFixed(2)} m away`;
  return nearestBlocker(r.g, p) ?? (clearanceAt(r.g, p) > 0 ? 'an obstacle' : 'the floor edge');
}

/**
 * Ground target beside hand point h: FOLLOW_OFFSET straight out if there is room, else
 * the free spot nearest to `cur` among 0.35 m at ±45° / ±90° and FOLLOW_FAR at 0° / ±45° / ±90°
 * (someone standing by, a frame post); null if none.
 */
export function followTarget(r: Room, h: Hand, cur: Vec2): Vec2 | null {
  const at = (d: number, a: number): Vec2 => {
    const o = rot2(h.out, a);
    return [h.p[0] + o[0] * d, h.p[2] + o[1] * d];
  };
  const first = at(FOLLOW_OFFSET, 0);
  if (standable(r, first)) return first;
  const alts: Vec2[] = [];
  for (const d of [FOLLOW_OFFSET, ...FOLLOW_FAR]) for (const a of [0, 1, -1, 2, -2]) if (d !== FOLLOW_OFFSET || a) alts.push(at(d, (a * Math.PI) / 4));
  const free = alts.filter((p) => standable(r, p));
  if (!free.length) return null;
  return free.reduce((b, p) => (d2(p, cur) < d2(b, cur) - 1e-9 ? p : b));
}

/**
 * One tick of walking from cur toward T (≤ FOLLOW_SPEED·dt, capped 0.6 m): straight if
 * there is room, else sliding at ±30° / ±60° if that still closes in; null = stuck.
 */
export function stepToward(r: Room, cur: Vec2, T: Vec2, dt: number): Vec2 | null {
  const d = d2(cur, T);
  if (d < 1e-6) return cur;
  const s = Math.min(d, FOLLOW_SPEED * dt, 0.6);
  const u: Vec2 = [(T[0] - cur[0]) / d, (T[1] - cur[1]) / d];
  for (const a of [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]) {
    const v = rot2(u, a);
    const n: Vec2 = [cur[0] + v[0] * s, cur[1] + v[1] * s];
    if ((a === 0 || d2(n, T) < d - 1e-6) && standable(r, n, cur)) return n;
  }
  return null;
}

// ---- runtime: rooms, pickup (where the crew goes to take hold), per-tick follow ----

export function roomFor(rt: Runtime, id: string, skip: string[] = []): Room | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const h = rt.world.entities[id];
  const g = sp.level(h.human!.level);
  if (!g) return null;
  const others = Object.values(rt.world.entities)
    .filter((o) => o.kind === 'human' && o.human && o.id !== id && !skip.includes(o.id) && o.human.level === h.human!.level)
    .map((o) => ({ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }));
  return { g, others };
}

const faceYaw = (p: Vec2, h: Hand) => datan2(h.p[2] - p[1], h.p[0] - p[0]);

type Move = { actor: string; p: Vec2; yaw: number; level: number };

/**
 * Where the crew takes hold: holders standing on the part's floor (or below) get a follow slot and
 * walk to the ground target beside its hand point; others keep their station (`lift-station`).
 * Options, in order of preference (the first group with a feasible choice wins, least walking within
 * it): both followers at a pair of hand points — sheets: long-edge midpoints, else the two corners
 * of one short end; linear parts: the ends — then one follower at an end while the other waits at
 * their station for the part to come to them. Feasible = every follower can stand beside its hand
 * point at pickup and at the seat, with a straight walkable line between (so nobody would have to
 * cross an enclosed bay). At most two holders follow.
 */
export function pickupPlan(rt: Runtime, crew: string[], item: Entity, to: Pose, stations: { level: number; p: Vec2; yaw: number }[]): { moves: Move[]; slots: string[] } | Diagnostic {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const floorOf = (lv: number) => sp.scene.levels.find((l) => l.id === lv)?.y ?? 0;
  const moves: Move[] = crew.map((actor, i) => ({ actor, p: stations[i].p, yaw: stations[i].yaw, level: stations[i].level }));
  const slots = crew.map(() => STATION_SLOT);
  const idx = crew.map((_, i) => i).filter((i) => floorOf(stations[i].level) <= item.pose.p[1] + 0.3).slice(0, 2);
  if (!idx.length) return { moves, slots };
  const ends = ['lift-end-0', 'lift-end-1'];
  const pairs = (a: string, b: string) => [[a, b], [b, a]];
  const groups: string[][][] = [];
  if (idx.length === 2) {
    if (def(item.def).category === 'plywood') groups.push([...pairs('lift-edge-0', 'lift-edge-1'), ...pairs('lift-corner-00', 'lift-corner-01'), ...pairs('lift-corner-10', 'lift-corner-11')]);
    else groups.push(pairs(ends[0], ends[1]));
  }
  // one follower (slot per idx position; '' = stays at station)
  groups.push(idx.flatMap((_, k) => ends.map((s) => idx.map((__, m) => (m === k ? s : '')))));
  type Pick = { ok: boolean; cost: number; sel: { i: number; slot: string; a: Vec2; h: Hand }[] };
  const evaluate = (opt: string[]): Pick => {
    const pick: Pick = { ok: true, cost: 0, sel: [] };
    for (const [k, i] of idx.entries()) {
      const slot = opt[k];
      if (!slot) continue;
      const room = roomFor(rt, crew[i], crew);
      const e = rt.world.entities[crew[i]];
      const cur: Vec2 = [e.pose.p[0], e.pose.p[2]];
      const h = handPoint(item, item.pose, slot)!;
      const a = room && followTarget(room, h, cur);
      if (!room || !a) return { ok: false, cost: Infinity, sel: [] };
      const b = followTarget(room, handPoint(item, to, slot)!, a);
      if (!b || segmentClearance(room.g, a, b) < FOLLOW_CLEARANCE) pick.ok = false;
      pick.cost += d2(cur, a);
      pick.sel.push({ i, slot, a, h });
    }
    return pick;
  };
  let best: Pick | null = null;
  for (const group of groups) {
    for (const pick of group.map(evaluate))
      if (pick.cost < Infinity && (!best || (pick.ok && !best.ok) || (pick.ok === best.ok && pick.cost < best.cost - 1e-9))) best = pick;
    if (best?.ok) break;
  }
  if (!best)
    return { code: 'lift.crew-blocked', message: `no room to stand beside ${item.id} to take hold of it where it lies (${item.pose.p[0].toFixed(2)}, ${item.pose.p[2].toFixed(2)})`, subjects: [item.id, ...idx.map((i) => crew[i])], at: item.pose.p };
  for (const s of best.sel) {
    slots[s.i] = s.slot;
    moves[s.i] = { actor: crew[s.i], p: s.a, yaw: faceYaw(s.a, s.h), level: rt.world.entities[crew[s.i]].human!.level };
  }
  return { moves, slots };
}

/**
 * Walk the following holders one tick toward their targets beside the part at pose q. ok = every
 * holder ends within FOLLOW_KEEP of its hand point (else the part should wait); `stuck` names a holder
 * that is out of reach because its way is blocked, and what blocks it.
 */
export function followCrew(rt: Runtime, item: Entity, crew: string[], q: Pose, dt: number): { ok: boolean; stuck?: { who: string; why: string } } {
  let ok = true;
  let stuck: { who: string; why: string } | undefined;
  for (const id of crew) {
    const e = rt.world.entities[id];
    const hand = handPoint(item, q, e.human?.grip?.slot ?? '');
    const room = hand && roomFor(rt, id);
    if (!hand || !room) continue;
    const cur: Vec2 = [e.pose.p[0], e.pose.p[2]];
    const T = followTarget(room, hand, cur);
    const n = T ? stepToward(room, cur, T, dt) : null;
    const p = n ?? cur;
    e.pose = { ...e.pose, p: [p[0], e.pose.p[1], p[1]], yaw: faceYaw(p, hand) };
    if (d2(p, [hand.p[0], hand.p[2]]) <= FOLLOW_KEEP) continue;
    ok = false;
    if (n) continue;
    const aim = T ?? [hand.p[0] + hand.out[0] * FOLLOW_OFFSET, hand.p[2] + hand.out[1] * FOLLOW_OFFSET];
    const k = Math.min(1, 0.3 / Math.max(d2(cur, aim), 1e-6));
    stuck ??= { who: id, why: blockerAt(room, T ? [cur[0] + (aim[0] - cur[0]) * k, cur[1] + (aim[1] - cur[1]) * k] : aim) };
  }
  return { ok, stuck };
}
