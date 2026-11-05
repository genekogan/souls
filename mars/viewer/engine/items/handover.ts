// Entry 41 (packet 8): a consensual hand-over of a small held item from one person to another. Consent lives in the
// edge ledger (an offer, then an acceptance); this is the body side, one action on each body, joined by a group id:
//   offer    (the giver)    faces the receiver at HANDOVER_GAP, raises the item to the middle between them and holds it
//                           there; after the change of holder its empty hand comes back and the arm eases to the clip.
//                           Stopped (declined, withdrawn, lapsed, no answer) it lowers the item back to its carry point.
//   receive  (the receiver) faces the giver, waits for the raised item, reaches under it beside the giver's hand, holds it
//                           with the giver for CONTACT_SECONDS (both hands on it), then takes it: the item's holder
//                           changes on that one tick, and the receiver draws it in to its own carry point.
// Custody: the item's support is `in-hand` by the giver up to the change and by the receiver from it, never two holders
// and never none. The two palms sit side by side under the base, HANDOVER_SPLIT either side of its centre; after the change
// the item settles from beside the receiver's palm onto it over the draw-in, and keeps its world yaw (support.turn), so
// it neither jumps nor spins. The presentation reuses entry 29's item transfer clock (itemTransferV1): the giver's record
// is a put (raise = reach; the change ends its hold), the receiver's a pick-up (reach to the fixed contact point).
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { angleDelta, datan2, hypot, wrapAngle, type Vec3 } from '../core/math.ts';
import { bodyFrame, carryHand, lerp3, restHand, sideOf, smooth, at, type Hand } from './body.ts';
import { HANDOVER_IDLE_RETURN_SECONDS, HANDOVER_SETTLE_SECONDS, ITEM_REACH_SECONDS, ITEM_RECOVERY_SECONDS } from './presentation.ts';
import { graspPoint, heldBy, heldYaw, publishHeldItems, inHand, isItem, poseAtHand, putInHand } from './model.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';

/** Body points apart for a hand-over (m): each reaches ~0.45 m to the middle, elbows bent, nobody leans. */
export const HANDOVER_GAP = 0.9;
/** The giver raises the item (s), the receiver reaches (s): the item clock of entry 29. */
export const OFFER_RAISE_SECONDS = ITEM_REACH_SECONDS;
/** Both hands on the item before the giver lets go (s). */
export const CONTACT_SECONDS = 0.6;
/** Each palm this far to one side of the item's centre, side by side under its base (m). */
export const HANDOVER_SPLIT = 0.04;
/** Where the item is held out, in the giver's frame (m): halfway to the receiver, a little to the hand's side, a hand's
 *  height above the carry point (1.0 m), well below the shoulders (1.34 m). */
export const OFFER_UP = 1.04, OFFER_SIDE = 0.07;
/** Facing turn rate (rad/s), and the settling step's speed (m/s) for a giver not quite at the hand-over distance. */
const TURN_RATE = 2.4, STEP_SPEED = 0.45, WALK_MIN = 0.08;
/** Farther apart than this the receiver waits for the giver to come (m). */
const NEAR = 1.3;

const ticks = (s: number) => Math.max(1, Math.round(s / DT));
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'handover.' + code, message, subjects });
const id80 = z.string().min(1).max(80);
const schema = z.object({
  actor: id80,
  mode: z.enum(['offer', 'receive']),
  partner: id80,
  item: id80,
  group: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  /** receive: the hand to take it with (default: the one on the giver's hand's side). */
  hand: z.enum(['left', 'right']).optional(),
  /** offer: how long the raised item waits for its taker; receive: how long to wait for the raised item (s). */
  waitSeconds: z.number().min(1).max(120).optional(),
  /** Prospective same-tick presented-map publication; absent keeps recorded legacy behavior. */
  custodyPolicy: z.literal('same-tick-v1').optional(),
}).strict();
export type HandOverParams = z.infer<typeof schema>;
type Phase = 'face' | 'raise' | 'offering' | 'let-go' | 'lower' | 'recover' | 'wait' | 'reach' | 'contact' | 'withdraw' | 'cancel-withdraw' | 'cancel-recover' | 'done';
type Exec = {
  id: string; p: HandOverParams; hand: Hand; phase: Phase; t: number; waited: number;
  from?: Vec3; to?: Vec3;
  /** offer: item-from-palm offset reached by the raise (world); receive: item-from-palm offset at the change (world). */
  off?: Vec3; off0?: Vec3;
  /** receive: item yaw relative to the receiver at the change, and the yaw it eases to (support.turn). */
  turn0?: number; turn1?: number;
  /** offer: the receiver's receive record was seen (a receiver that stops before the change: the giver lowers). */
  seen?: boolean; outcome?: 'given' | 'kept';
  error?: Diagnostic;
};

function setHand(a: Entity, h: Hand, q: Vec3 | undefined) {
  const hs = a.human!.hands ?? {};
  if (q) hs[h] = [q[0], q[1], q[2]]; else delete hs[h];
  if (hs.left || hs.right) a.human!.hands = hs; else delete a.human!.hands;
}
const handNow = (a: Entity, h: Hand): Vec3 => a.human!.hands?.[h] ?? restHand(bodyFrame(a), h);
const add3 = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** The item at palm `q` with the item's base centre `off` from the palm (world), yaw `yaw`. */
function itemAt(item: Entity, q: Vec3, off: Vec3, yaw: number) { item.pose = { p: poseAtHand(item, add3(q, off), yaw), yaw }; }
const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + Math.max(-max, Math.min(max, angleDelta(yaw, want))));
const headingTo = (a: Entity, b: Entity) => datan2(b.pose.p[2] - a.pose.p[2], b.pose.p[0] - a.pose.p[0]);
const apart = (a: Entity, b: Entity) => hypot(b.pose.p[0] - a.pose.p[0], b.pose.p[2] - a.pose.p[2]);
function publish(e: Entity, moved: number) {
  const h = e.human!, v = Math.round(moved / DT * 1000) / 1000;
  if (v >= WALK_MIN) { h.activity = 'walk'; h.speed = v; } else { if (h.activity === 'walk') h.activity = 'idle'; delete h.speed; }
}
function clearAt(rt: Runtime, e: Entity, x: number, z: number) {
  const sp = rt.services.spatial as Spatial | undefined, g = sp?.level(e.human?.level ?? 0);
  if (!sp || !g) return true; sp.sync(rt.world); return clearanceAt(g, [x, z]) >= HUMAN_RADIUS - 0.03;
}
/** The giver's palm while the item is held out (fixed once the raise starts): halfway to the receiver, OFFER_UP high. */
function offerPalm(a: Entity, hand: Hand): Vec3 { return at(bodyFrame(a), HANDOVER_GAP / 2, sideOf(hand) * OFFER_SIDE, OFFER_UP); }
/** Lateral unit (world) from the item's centre toward the giver's palm: the giver's hand side. */
function lateral(a: Entity, hand: Hand): Vec3 { const b = bodyFrame(a), s = sideOf(hand); return [b.r[0] * s, 0, b.r[1] * s]; }
/** The live record of the partner's half of this hand-over (same group, other mode). */
function partnerRecord(rt: Runtime, ex: Exec) {
  for (const id of rt.holder('actor:' + ex.p.partner)) {
    const r = rt.records.get(id), q = r?.params as HandOverParams | undefined;
    if (r?.verb === 'hand_over_v1' && q?.group === ex.p.group && q.mode !== ex.p.mode) return r;
  }
  return undefined;
}
/** The giver's raised offer for this group: its palm and the item's centre, once the raise is over and it waits. */
function raisedOffer(rt: Runtime, ex: Exec, giver: Entity, item: Entity): { palm: Vec3; centre: Vec3; hand: Hand } | null {
  const t = giver.human?.itemTransferV1, r = partnerRecord(rt, ex);
  if (!r || !t || t.action !== r.id || t.item !== item.id || t.reachTick === undefined || t.holdTick !== undefined || !t.target) return null;
  if (rt.tick < t.reachTick + ticks(OFFER_RAISE_SECONDS) + 1) return null;
  const s = item.support; if (s?.kind !== 'in-hand' || s.by !== giver.id) return null;
  return { palm: [...t.target] as Vec3, centre: [...item.pose.p] as Vec3, hand: s.hand };
}

/** The receiver's hand: the one on the side the giver holds it (facing each other, the giver's right is the receiver's
 *  left), else the other; null when both are full. Reservations and plan agree on it. */
function receiveHand(w: Runtime['world'], p: HandOverParams): Hand | null {
  const s = w.entities[p.item]?.support as { hand?: Hand } | undefined;
  const want: Hand = p.hand ?? (s?.hand === 'left' ? 'right' : 'left'), other: Hand = want === 'left' ? 'right' : 'left';
  return !inHand(w, p.actor, want) ? want : !inHand(w, p.actor, other) ? other : null;
}

export const handOver: ActionDef<HandOverParams, { hand: Hand }, Exec> = {
  verb: 'hand_over_v1',
  description: 'Hand a held small item to someone who agreed (offer: face them and hold it out; receive: take it from their hand, both hands on it, then they let go).',
  schema,
  reservations: (w, p) => {
    const it = w.entities[p.item], h = p.mode === 'offer' ? ((it?.support as { hand?: Hand } | undefined)?.hand ?? 'right') : receiveHand(w, p);
    return [{ resource: 'actor:' + p.actor, mode: 'exclusive' }, ...(h ? [{ resource: `hand:${p.actor}:${h}`, mode: 'exclusive' as const }] : []), { resource: 'entity:' + p.item, mode: 'shared' }];
  },
  drivesReservedHands: true,
  plan(rt, p) {
    const a = rt.world.entities[p.actor], h = a?.human, b = rt.world.entities[p.partner], it = rt.world.entities[p.item];
    if (!h || a.kind !== 'human' || a.body?.family === 'floater') return { ok: false, diagnostic: issue('no-hands', 'This body has no humanoid hands.', [p.actor]) };
    if (!b?.human || b.id === a.id) return { ok: false, diagnostic: issue('partner-gone', 'They are not here any more.', [p.actor, p.partner]) };
    if (!it || !isItem(it)) return { ok: false, diagnostic: issue('not-an-item', `${p.item} is not a small hand-held item.`, [p.item]) };
    if (h.grip || h.on || h.riding || h.carrier || h.sleepPose || h.activity === 'sit' || h.baseActivity === 'sit' || h.handHold) return { ok: false, diagnostic: issue('body-busy', 'Stand with a free hand first.', [p.actor]) };
    const s = it.support;
    if (p.mode === 'offer') {
      if (s?.kind !== 'in-hand' || s.by !== p.actor) return { ok: false, diagnostic: issue('not-held', `${p.actor} is not holding ${p.item}.`, [p.actor, p.item]) };
      return { ok: true, program: { hand: s.hand } };
    }
    if (s?.kind !== 'in-hand' || s.by !== p.partner) return { ok: false, diagnostic: issue('not-offered', `${p.partner} is not holding ${p.item} out.`, [p.actor, p.item]) };
    const hand = receiveHand(rt.world, p);
    if (!hand) return { ok: false, diagnostic: issue('hands-full', 'Both your hands are full.', [p.actor]) };
    return { ok: true, program: { hand } };
  },
  start(rt, p, prog, id) {
    const a = rt.world.entities[p.actor];
    a.human!.task = id;
    // a receiver lets an idle gesture go from the moment it agrees (fadeTick), before its hand moves at all
    if (p.mode === 'receive') a.human!.itemTransferV1 = { item: p.item, hand: prog.hand, action: id, mode: 'take', startTick: rt.tick, hold: true, fadeTick: rt.tick };
    return { id, p: structuredClone(p), hand: prog.hand, phase: 'face', t: 0, waited: 0 };
  },
  step(rt, ex): StepResult {
    const a = rt.world.entities[ex.p.actor], b = rt.world.entities[ex.p.partner], it = rt.world.entities[ex.p.item];
    if (!a?.human) return { status: 'failed', diagnostic: issue('body-gone', 'The body is gone.', [ex.p.actor]) };
    const r = ex.p.mode === 'offer' ? stepOffer(rt, ex, a, b, it) : stepReceive(rt, ex, a, b, it);
    if (r.status !== 'running') {
      if (a.human.itemTransferV1?.action === ex.id) delete a.human.itemTransferV1;
      if (a.human.task === ex.id) { delete a.human.task; if (a.human.activity === 'reach' || a.human.activity === 'walk') a.human.activity = 'idle'; delete a.human.speed; }
      // whatever this hand holds now is the person's hold_items' again (at its carry point, where every phase ends)
      if (!inHand(rt.world, ex.p.actor, ex.hand)) setHand(a, ex.hand, undefined);
    }
    return r;
  },
  cancel(rt, ex) {
    const a = rt.world.entities[ex.p.actor], it = rt.world.entities[ex.p.item];
    if (!a?.human) return { ok: true };
    // an offer still holding the item lowers it back to the carry point; a receiver mid-reach draws the empty hand back;
    // the moments after the change (let go, draw in, recover) finish as they are
    if (ex.p.mode === 'offer' && (ex.phase === 'raise' || ex.phase === 'offering')) { beginLower(rt, ex, a); return { ok: true, deferred: true }; }
    if (ex.p.mode === 'receive' && (ex.phase === 'reach' || ex.phase === 'contact') && it?.support?.kind === 'in-hand' && (it.support as { by: string }).by !== ex.p.actor) { beginCancelWithdraw(rt, ex, a); return { ok: true, deferred: true }; }
    if (ex.p.mode === 'receive' && (ex.phase === 'face' || ex.phase === 'wait')) { beginCancelRecover(rt, ex, a); return { ok: true, deferred: true }; }
    if (['lower', 'let-go', 'recover', 'withdraw', 'cancel-withdraw', 'cancel-recover'].includes(ex.phase)) return { ok: true, deferred: true };
    if (a.human.itemTransferV1?.action === ex.id) delete a.human.itemTransferV1;
    if (a.human.task === ex.id) { delete a.human.task; if (a.human.activity === 'walk') a.human.activity = 'idle'; delete a.human.speed; }
    if (!inHand(rt.world, ex.p.actor, ex.hand)) setHand(a, ex.hand, undefined);
    else if (ex.p.mode === 'offer') { const q = carryHand(bodyFrame(a), ex.hand); setHand(a, ex.hand, q); if (it) itemAt(it, q, [0, 0, 0], heldYaw(it, a)); }
    return { ok: true };
  },
  resumable: true,
};

function beginLower(rt: Runtime, ex: Exec, a: Entity) {
  ex.from = handNow(a, ex.hand); ex.to = carryHand(bodyFrame(a), ex.hand); ex.off0 = ex.off ?? [0, 0, 0];
  ex.phase = 'lower'; ex.t = 0; ex.outcome = 'kept';
  const tr = a.human!.itemTransferV1; if (tr?.action === ex.id && tr.holdTick === undefined) tr.holdTick = rt.tick;
}
/** A receiver ending before the change: idle gestures come back over the recovery, never all at once (the record's
 *  fade would otherwise jump from 0 to full when it clears). */
function beginCancelRecover(rt: Runtime, ex: Exec, a: Entity, error?: Diagnostic) {
  if (error) ex.error = error;
  ex.phase = 'cancel-recover'; ex.t = 0; a.human!.activity = 'idle'; setHand(a, ex.hand, undefined);
  const tr = a.human!.itemTransferV1; if (tr?.action === ex.id) { if (tr.cancelTick === undefined) tr.cancelTick = rt.tick; tr.releaseTick = rt.tick; }
}
function beginCancelWithdraw(rt: Runtime, ex: Exec, a: Entity) {
  ex.from = handNow(a, ex.hand); ex.to = restHand(bodyFrame(a), ex.hand); ex.phase = 'cancel-withdraw'; ex.t = 0;
  const tr = a.human!.itemTransferV1; if (tr?.action === ex.id && tr.cancelTick === undefined) tr.cancelTick = rt.tick;
}

/** The giver: face, raise, hold out, then let go (given) or lower (kept). */
function stepOffer(rt: Runtime, ex: Exec, a: Entity, b: Entity | undefined, it: Entity | undefined): StepResult {
  const h = a.human!, R = ticks(OFFER_RAISE_SECONDS);
  // only the settling step of 'face' moves the body (it publishes its own speed)
  if (ex.phase !== 'face') delete h.speed;
  const mine = !!it && it.support?.kind === 'in-hand' && (it.support as { by: string }).by === a.id;
  if (ex.phase === 'recover') {
    h.activity = 'idle'; ex.t++; setHand(a, ex.hand, restHand(bodyFrame(a), ex.hand));
    // the arm eases to the clip (ITEM_RECOVERY_SECONDS), then idle gestures fade in (HANDOVER_IDLE_RETURN_SECONDS)
    return ex.t < ticks(ITEM_RECOVERY_SECONDS + HANDOVER_IDLE_RETURN_SECONDS) ? { status: 'running', phase: 'recover' } : { status: 'completed', outputs: { given: true } };
  }
  if (ex.phase === 'let-go') {
    // the receiver holds it now: the empty hand comes back to the side; the arm then eases to the clip (recover)
    ex.t++; h.activity = 'reach'; setHand(a, ex.hand, lerp3(ex.from!, ex.to!, smooth(ex.t / R)));
    if (ex.t < R) return { status: 'running', phase: 'let-go' };
    ex.phase = 'recover'; ex.t = 0; h.activity = 'idle'; if (h.itemTransferV1?.action === ex.id) h.itemTransferV1.releaseTick = rt.tick;
    return { status: 'running', phase: 'recover' };
  }
  if (ex.phase === 'lower') {
    ex.t++; h.activity = 'reach'; const k = smooth(ex.t / R), q = lerp3(ex.from!, ex.to!, k); setHand(a, ex.hand, q);
    if (it && mine) itemAt(it, q, lerp3(ex.off0!, [0, 0, 0], k), heldYaw(it, a));
    if (ex.t < R) return { status: 'running', phase: 'lower' };
    h.activity = 'idle';
    return ex.error ? { status: 'failed', diagnostic: ex.error } : { status: 'failed', diagnostic: issue('not-taken', 'Nobody took it; it is back in your hand.', [a.id, ex.p.item]) };
  }
  // the receiver took it (the change of holder happens in its step): the empty hand comes back on this tick
  if (it && !mine && (ex.phase === 'raise' || ex.phase === 'offering') && it.support?.kind === 'in-hand' && (it.support as { by: string }).by === ex.p.partner) {
    ex.from = handNow(a, ex.hand); ex.to = restHand(bodyFrame(a), ex.hand); ex.phase = 'let-go'; ex.t = 0; ex.outcome = 'given';
    if (h.itemTransferV1?.action === ex.id) h.itemTransferV1.holdTick = rt.tick;
    return stepOffer(rt, ex, a, b, it);
  }
  if (!it || !mine) return { status: 'failed', diagnostic: issue('not-held', `${a.id} is no longer holding ${ex.p.item}.`, [a.id, ex.p.item]) };
  if (!b?.human) { ex.error = issue('partner-gone', 'They are not here any more.', [a.id, ex.p.partner]); if (ex.phase === 'face') return { status: 'failed', diagnostic: ex.error }; beginLower(rt, ex, a); return { status: 'running', phase: 'lower' }; }
  if (ex.phase === 'face') {
    // turn to face them; a giver not quite at the hand-over distance settles there with a short step
    const want = headingTo(a, b), d = apart(a, b), miss = d - HANDOVER_GAP;
    let moved = 0;
    if (Math.abs(miss) > 0.03 && Math.abs(miss) < 0.6) {
      const u = [(b.pose.p[0] - a.pose.p[0]) / d, (b.pose.p[2] - a.pose.p[2]) / d], s = Math.sign(miss) * Math.min(Math.abs(miss), STEP_SPEED * DT);
      const x = a.pose.p[0] + u[0] * s, z = a.pose.p[2] + u[1] * s;
      if (clearAt(rt, a, x, z)) { a.pose.p = [x, a.pose.p[1], z]; moved = Math.abs(s); }
    }
    a.pose.yaw = turnToward(a.pose.yaw, want, TURN_RATE * DT); publish(a, moved);
    const q = carryHand(bodyFrame(a), ex.hand); setHand(a, ex.hand, q); itemAt(it, q, [0, 0, 0], heldYaw(it, a));
    if (moved > 0 || Math.abs(angleDelta(a.pose.yaw, want)) > 0.02) return { status: 'running', phase: 'face' };
    if (Math.abs(miss) >= 0.6) return { status: 'failed', diagnostic: issue('too-far', 'Stand in front of them first.', [a.id, b.id]) };
    publish(a, 0);
    ex.phase = 'raise'; ex.t = 0; ex.from = q; ex.to = offerPalm(a, ex.hand); ex.off = lateral(a, ex.hand).map((v) => -v * HANDOVER_SPLIT) as Vec3;
    h.itemTransferV1 = { item: it.id, hand: ex.hand, action: ex.id, mode: 'put', startTick: rt.tick, reachTick: rt.tick - 1, target: ex.to.map((x) => Math.round(x * 1000) / 1000) as Vec3, hold: true };
    ex.to = [...h.itemTransferV1.target!] as Vec3;
  }
  if (ex.phase === 'raise') {
    ex.t++; h.activity = 'reach'; const k = smooth(ex.t / R), q = lerp3(ex.from!, ex.to!, k);
    setHand(a, ex.hand, q); itemAt(it, q, ex.off!.map((v) => v * k) as Vec3, heldYaw(it, a));
    if (ex.t < R) return { status: 'running', phase: 'raise' };
    ex.phase = 'offering'; ex.t = 0;
  }
  // offering: held out, still; the receiver's half takes it (the change of holder happens in its step)
  h.activity = 'reach'; setHand(a, ex.hand, ex.to!); itemAt(it, ex.to!, ex.off!, heldYaw(it, a)); ex.waited++;
  const rec = partnerRecord(rt, ex);
  if (rec) ex.seen = true;
  else if (ex.seen) { ex.error = issue('not-taken', `${ex.p.partner} stopped before taking it; it is still in your hand.`, [a.id, ex.p.partner]); beginLower(rt, ex, a); return { status: 'running', phase: 'lower' }; }
  if (!rec && ex.waited * DT > (ex.p.waitSeconds ?? 35)) { ex.error = issue('no-answer', 'Nobody took it in time; it is back in your hand.', [a.id]); beginLower(rt, ex, a); return { status: 'running', phase: 'lower' }; }
  return { status: 'running', phase: rec ? 'handing' : 'offering' };
}

/** The receiver: face, wait for the raised item, reach under it, hold it with the giver, take it, draw it in. */
function stepReceive(rt: Runtime, ex: Exec, a: Entity, b: Entity | undefined, it: Entity | undefined): StepResult {
  const h = a.human!, R = ticks(ITEM_REACH_SECONDS);
  // the receiver never walks here: no ground speed (a walk just ended may have left one)
  delete h.speed;
  if (ex.phase === 'recover') {
    ex.t++; h.activity = 'idle'; const q = carryHand(bodyFrame(a), ex.hand); setHand(a, ex.hand, q); if (it) itemAt(it, q, [0, 0, 0], heldYaw(it, a));
    return ex.t < ticks(ITEM_RECOVERY_SECONDS) ? { status: 'running', phase: 'recover' } : { status: 'completed', outputs: { item: ex.p.item, hand: ex.hand } };
  }
  if (ex.phase === 'withdraw') {
    // drawing it in: the palm to the carry point, the item settling from beside the palm onto it, its yaw unchanged in
    // the world at the start and the receiver's own carry yaw (plus the turn it was handed over with) at the end
    ex.t++; h.activity = 'reach'; const k = smooth(ex.t / R), q = lerp3(ex.from!, carryHand(bodyFrame(a), ex.hand), k);
    setHand(a, ex.hand, q);
    const s = it!.support as { turn?: number }; s.turn = wrapAngle(ex.turn0! + angleDelta(ex.turn0!, ex.turn1!) * k);
    itemAt(it!, q, lerp3(ex.off0!, [0, 0, 0], k), heldYaw(it!, a));
    if (ex.t < R) return { status: 'running', phase: 'withdraw' };
    ex.phase = 'recover'; ex.t = 0; h.activity = 'idle'; if (h.itemTransferV1?.action === ex.id) h.itemTransferV1.releaseTick = rt.tick;
    return { status: 'running', phase: 'recover' };
  }
  if (ex.phase === 'cancel-withdraw') {
    ex.t++; h.activity = 'reach'; setHand(a, ex.hand, lerp3(ex.from!, ex.to!, smooth(ex.t / R)));
    if (ex.t < R) return { status: 'running', phase: 'cancel-withdraw' };
    beginCancelRecover(rt, ex, a); return { status: 'running', phase: 'cancel-recover' };
  }
  if (ex.phase === 'cancel-recover') {
    ex.t++; h.activity = 'idle'; setHand(a, ex.hand, undefined);
    if (ex.t < ticks(ITEM_RECOVERY_SECONDS)) return { status: 'running', phase: 'cancel-recover' };
    return { status: 'failed', diagnostic: ex.error ?? issue('withdrawn', 'The hand-over stopped before you took it.', [a.id, ex.p.item]) };
  }
  const offered = !!b?.human && !!it && it.support?.kind === 'in-hand' && (it.support as { by: string }).by === b.id;
  if (!offered) {
    if (ex.phase === 'reach' || ex.phase === 'contact') { ex.error = issue('withdrawn', `${ex.p.partner} is no longer holding it out.`, [a.id, ex.p.partner]); beginCancelWithdraw(rt, ex, a); return { status: 'running', phase: 'cancel-withdraw' }; }
    beginCancelRecover(rt, ex, a, issue('not-offered', `${ex.p.partner} is not holding ${ex.p.item} out.`, [a.id, ex.p.partner])); return { status: 'running', phase: 'cancel-recover' };
  }
  if (ex.phase === 'face' || ex.phase === 'wait') {
    // turn to face the giver (never step: the giver came to stand here); wait for the item to be held out
    setHand(a, ex.hand, undefined);
    const want = headingTo(a, b!), near = apart(a, b!) <= NEAR;
    if (near) a.pose.yaw = turnToward(a.pose.yaw, want, TURN_RATE * DT);
    // the hand moves only once an idle gesture has gone (HANDOVER_SETTLE_SECONDS from the acceptance)
    const settled = rt.tick >= (h.itemTransferV1?.fadeTick ?? -Infinity) + ticks(HANDOVER_SETTLE_SECONDS);
    const offer = near && settled && Math.abs(angleDelta(a.pose.yaw, want)) <= 0.02 ? raisedOffer(rt, ex, b!, it!) : null;
    ex.waited++;
    if (!offer) {
      if (ex.waited * DT > (ex.p.waitSeconds ?? 30)) { beginCancelRecover(rt, ex, a, issue('no-offer', `${ex.p.partner} did not hold it out.`, [a.id, ex.p.partner])); return { status: 'running', phase: 'cancel-recover' }; }
      ex.phase = near ? 'face' : 'wait'; return { status: 'running', phase: ex.phase };
    }
    // the contact point: beside the giver's palm, the same distance the other side of the item's centre
    const target: Vec3 = [2 * offer.centre[0] - offer.palm[0], offer.palm[1], 2 * offer.centre[2] - offer.palm[2]].map((x) => Math.round(x * 1000) / 1000) as Vec3;
    ex.phase = 'reach'; ex.t = 0; ex.from = handNow(a, ex.hand); ex.to = target;
    const fadeTick = h.itemTransferV1?.action === ex.id ? h.itemTransferV1.fadeTick : undefined;
    h.itemTransferV1 = { item: it!.id, hand: ex.hand, action: ex.id, mode: 'take', startTick: rt.tick, reachTick: rt.tick - 1, target, hold: true, ...(fadeTick !== undefined ? { fadeTick } : {}) };
  }
  if (ex.phase === 'reach') {
    ex.t++; h.activity = 'reach'; setHand(a, ex.hand, lerp3(ex.from!, ex.to!, smooth(ex.t / R)));
    if (ex.t < R) return { status: 'running', phase: 'reach' };
    ex.phase = 'contact'; ex.t = 0;
  }
  // contact: both hands on it for CONTACT_SECONDS, then the change of holder on one tick
  h.activity = 'reach'; setHand(a, ex.hand, ex.to!); ex.t++;
  if (ex.t < ticks(CONTACT_SECONDS)) return { status: 'running', phase: 'contact' };
  const item = it!, yaw = item.pose.yaw, q = ex.to!;
  putInHand(item, a.id, ex.hand);
  ex.turn0 = wrapAngle(yaw - a.pose.yaw); ex.turn1 = Math.abs(angleDelta(0, ex.turn0)) > Math.PI / 2 ? wrapAngle(Math.round(ex.turn0 / Math.PI) * Math.PI) : 0;
  (item.support as { turn?: number }).turn = ex.turn0;
  if (ex.p.custodyPolicy === 'same-tick-v1') {
    // One existing support commit, then its metadata projection. Never step holder actions here.
    publishHeldItems(a, heldBy(rt.world, a.id));
    if (b?.human) publishHeldItems(b, heldBy(rt.world, b.id));
  }
  // the item's base centre stays where it is: beside this palm, settling onto it as it is drawn in
  const g = graspPoint(item); ex.off0 = [g[0] - q[0], g[1] - q[1], g[2] - q[2]];
  itemAt(item, q, ex.off0, yaw);
  if (h.itemTransferV1?.action === ex.id) h.itemTransferV1.holdTick = rt.tick;
  const holder = rt.holder(`holds:${a.id}`).length ? null : rt.submit('hold_items', { actor: a.id });
  if (holder && holder.status === 'failed') return { status: 'failed', diagnostic: holder.diagnostic ?? issue('hold', 'Could not hold it.', [a.id]) };
  ex.phase = 'withdraw'; ex.t = 0; ex.from = q;
  return { status: 'running', phase: 'withdraw' };
}
