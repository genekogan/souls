// stall-guard/1, engine side (Gene's review 2026-10-23, #19: a Soul stayed "riding" after the balloon landed and every
// request failed actor.busy; "this needs to be prevented"). Read-only probe of what holds a body, and the world's own
// release of a body whose hold has stopped making progress. The decision (when, how long) is the edge's
// (apps/server/src/edge/ledger/stall-guard.ts); the release is folded from the log ('edge-stop' {stallReleaseV1}), so
// replay is exact. Never used on a body in a carrier that is aloft, nor on construction work (its own safety owns it).
import { carrierDef } from '../../../mars/viewer/engine/vehicles/carrier.ts';
import { rot2 } from '../../../mars/viewer/engine/core/math.ts';
import { acknowledgeRelocation } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { clearanceAt } from '../../../mars/viewer/engine/spatial/grid.ts';
import { listEntities } from '../../../mars/viewer/engine/world/entity-list.ts';

/** Phases that move a body from one hold to another (on, off, up, down). They last seconds when they work. */
export const TRANSFER_PHASES = new Set(['boarding', 'boarding-wait', 'leaving', 'leaving-wait', 'stand-up', 'step-off',
  'transferring', 'releasing', 'safe-release', 'stopping', 'stopping-walk', 'cleanup', 'climb-down', 'cancel-climb', 'departure-release',
  // not 'settle' or 'step-aside': those are walk's own running phases (closing on the goal, queued or stepped aside for another
  // body on a shared route), served by the traffic and deadlock resolvers; a queued walker or swimmer is not a stall
  'sit-down', 'settling', 'changing-floor', 'ending', 'safe-end', 'waking', 'performer-leaving-chair', 'gather-cancel']);
/** Body markers that say "something holds me"; with no live holder they are left over (the stall that bricked Mickey). */
const MARKERS = ['carrier', 'task', 'berth', 'seatHeight'] as const;
const CONSTRUCTION = /build|unbuild|lookout|beam|frame|deck|stair|solar|raise|passup|handup|setpart|cut|bundle|disassembl/;

export type StallHolderV1 = { id: string; verb: string; phase: string; state: 'orphan' | 'cancelling' | 'transfer' | 'steady' };
export type StallProbeV1 = {
  /** Something holds the body (a live action claim, or a leftover hold marker). */
  held: boolean;
  holders: StallHolderV1[];
  markers: string[];
  /** The hold is of a kind that should end by itself (orphan claim or marker, a deferred stop, a transfer phase). */
  candidate: boolean;
  /** Never released by the guard: in a carrier aloft, or construction work. */
  exempt: string | null;
  /** Changes whenever the body or its holders make progress (pose, phase, holder set). */
  signature: string;
  verbs: string[];
  pos: [number, number, number];
};

type Rt = any;
const r2 = (n: number) => Math.round(n * 20) / 20;

export function probeBody(rt: Rt, actor: string): StallProbeV1 | null {
  const a = rt.world.entities[actor]; if (!a?.human) return null;
  const h = a.human as Record<string, unknown> & { activity?: string; carrier?: { id: string; phase: string } };
  const holders: StallHolderV1[] = [];
  for (const id of rt.holder(`actor:${actor}`) as string[]) {
    const rec = rt.records.get(id), live = rt.isActive(id), phase = String(rec?.phase ?? '');
    const state = !live ? 'orphan' : rt.isCancelling?.(id) ? 'cancelling' : TRANSFER_PHASES.has(phase) ? 'transfer' : 'steady';
    holders.push({ id, verb: String(rec?.verb ?? '?'), phase, state });
  }
  const markers = MARKERS.filter(k => h[k] !== undefined && h[k] !== null);
  const carrier = h.carrier ? rt.world.entities[h.carrier.id] : undefined, cs = (carrier as { carrier?: { phase?: string } } | undefined)?.carrier;
  const verbs = [...new Set(holders.map(x => x.verb))];
  const exempt = cs?.phase === 'aloft' ? 'carrier.aloft' : verbs.some(v => CONSTRUCTION.test(v)) ? 'construction' : null;
  const live = holders.filter(x => x.state !== 'orphan');
  // a carried body whose carrier no longer lists it in a seat is left over even while its ride step still runs
  const dropped = !!h.carrier && !!cs && !Object.values((cs as { seats?: Record<string, string | null> }).seats ?? {}).includes(actor);
  // a live activity pose (social/pose.ts pose_v1 claims pose:<actor>, never actor:) owns the seat markers it set (seatHeight)
  const posing = (rt.holder(`pose:${actor}`) as string[]).some(id => rt.isActive(id));
  const candidate = holders.some(x => x.state !== 'steady') || dropped || (!live.length && !posing && markers.length > 0) ||
    (!!h.carrier && (h.carrier.phase === 'leaving' || cs?.phase === 'landed' || cs?.phase === 'parked'));
  const pos: [number, number, number] = [a.pose.p[0], a.pose.p[1], a.pose.p[2]];
  const signature = JSON.stringify([pos.map(r2), holders.map(x => [x.id, x.phase, x.state]), h.activity ?? '', h.carrier?.phase ?? '', cs?.phase ?? '']);
  return { held: holders.length > 0 || markers.length > 0, holders, markers, candidate, exempt, signature, verbs, pos };
}

/** Where a released body stands: a carried body at its seat exit (or the carrier's door), any other where it is. */
export function setDownFrom(rt: Rt, actor: string): { at: [number, number]; y?: number } {
  const a = rt.world.entities[actor], c = a.human?.carrier as { id: string; slot: string } | undefined, e = c ? rt.world.entities[c.id] : undefined;
  const cs = (e as { carrier?: { bank?: { door: number[]; exits: Record<string, number[]> }; home: number[] } } | undefined)?.carrier, d = carrierDef(e);
  if (e && cs) {
    const bank = cs.bank?.exits[c!.slot] ?? cs.bank?.door; if (bank) return { at: [bank[0], bank[2]], y: bank[1] };
    const seat = d?.seats.find(s => s.id === c!.slot), local = seat?.exit ?? d?.door;
    if (local) { const v = rot2(local, e.pose.yaw); return { at: [e.pose.p[0] + v[0], e.pose.p[2] + v[1]], y: cs.home[1] }; }
  }
  return { at: [a.pose.p[0], a.pose.p[2]] };
}

/** stall-release-support/1 (#447): where a stall release stands a body on an upper level, or null when nowhere is
 *  supported. Where it is (`from`), when its level has a clear standing disc there; otherwise the nearer free landing of
 *  the stair link its walk is on: a clear disc on that landing's level and nobody within two radii in plan and 1.5 m in
 *  height, on any level. `yAt` gives the standing height on a level (the ground's own on level 0). Read-only. */
export function supportedSetDownV1(rt: Rt, actor: string, from: { at: [number, number]; y?: number }, radius: number,
  yAt: (level: number, p: [number, number], y: number) => number): { at: [number, number]; y: number; level: number } | null {
  const a = rt.world.entities[actor], level = a?.human?.level ?? 0;
  if (!a?.human || level === 0) return null;
  const spatial = rt.services.spatial; spatial.sync(rt.world);
  const standing = (lv: number, p: [number, number]) => { const g = spatial.levelAt(lv, p); return !!g && clearanceAt(g, p) >= radius; };
  if (standing(level, from.at)) return { at: from.at, y: from.y ?? a.pose.p[1], level };
  const clear = (p: [number, number], y: number) => !(listEntities(rt.world.entities) as any[]).some((o) => o.id !== actor && o.human && Math.hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * radius && Math.abs(o.pose.p[1] - y) < 1.5);
  for (const holder of rt.holder(`actor:${actor}`) as string[]) {
    const ex = rt.live.get(holder)?.exec, leg = ex?.route?.legs?.[ex.leg];
    if (leg?.kind !== 'link') continue;
    const ends = [leg.link.from, leg.link.to].map((e: any) => ({ at: [e.p[0], e.p[1]] as [number, number], level: e.level as number, y: yAt(e.level, [e.p[0], e.p[1]], e.y) }));
    const d = (u: { at: [number, number] }) => Math.hypot(u.at[0] - from.at[0], u.at[1] - from.at[1]);
    ends.sort((u, v) => d(u) - d(v) || u.level - v.level);
    for (const end of ends) if (standing(end.level, end.at) && clear(end.at, end.y)) return end;
  }
  return null;
}

/** The world ends whatever holds the body (no def asked: a refused or deferred stop is what stalled it), clears the body's
 *  hold markers and frees its carrier seat and door, then stands it at `spot`. Returns what was released. */
export function releaseBody(rt: Rt, actor: string, spot: [number, number, number] | null, reason: { code: string; message: string }): { released: string[]; markers: string[]; at: [number, number, number] } | null {
  const before = probeBody(rt, actor); if (!before || before.exempt) return null;
  for (const x of before.holders) rt.forceCancel(x.id, reason);
  const a = rt.world.entities[actor], h = a.human as Record<string, unknown> & { carrier?: { id: string } };
  const ce = h.carrier ? rt.world.entities[h.carrier.id] : undefined, cs = (ce as { carrier?: { seats: Record<string, string | null>; doorBy: string | null } } | undefined)?.carrier;
  if (cs) { for (const k of Object.keys(cs.seats)) if (cs.seats[k] === actor) cs.seats[k] = null; if (cs.doorBy === actor) cs.doorBy = null; }
  for (const k of ['carrier', 'task', 'berth', 'seatHeight', 'baseActivity', 'speed']) delete h[k];
  h.activity = 'idle';
  if (spot) { a.pose.p = [spot[0], spot[1], spot[2]]; a.pose.pitch = 0; a.pose.roll = 0; acknowledgeRelocation(rt, actor); }
  return { released: before.verbs, markers: before.markers, at: [a.pose.p[0], a.pose.p[1], a.pose.p[2]] };
}
