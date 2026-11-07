// Soul Actions #442: repair with a tool in hand. `repair_v1` drives the hand holding the tool through a few strokes at the
// thing, on the world tick: a pure function of the params and the ticks since the start, so live play and history agree.
// The tool stays in that hand throughout. The action changes nothing in the world: the server applies the result when the
// receipt completes. Stopping lets the hand come back from where it is, with the tool still in it.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { dcos, dsin, hypot, type Vec3 } from '../core/math.ts';
import { bodyFrame, lerp3, smooth, type Hand } from './body.ts';
import { carryPoint, followHand, heldBy, isItem } from './model.ts';

/** In ticks of the fixed 20 Hz clock: the hand comes in, each stroke, the hand goes back. */
export const REPAIR = Object.freeze({ IN: 14, STROKE: { strike: 14, pump: 20 }, OUT: 12 });
/** How far from the body the working hand may be (m, along the ground). */
const REACH = 1.1;
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const repairParams = z.object({
  actor: z.string().min(1).max(80), item: z.string().min(1).max(80), target: z.string().min(1).max(80),
  /** Engine heading the body faces while it works. */
  face: z.number().finite(),
  /** World point the hand reaches at the end of each stroke. */
  hand: vec3,
  strokes: z.number().int().min(1).max(20),
  lift: z.number().positive().max(0.5),
  motion: z.enum(['strike', 'pump']),
}).strict();
export type RepairParams = z.infer<typeof repairParams>;
type Exec = { p: RepairParams; start: number; hand: Hand; at: Vec3; level: number; yaw0: number; target: string; from?: Vec3; stopAt?: number; stopHand?: Vec3 };

export const repairTicks = (p: Pick<RepairParams, 'strokes' | 'motion'>) => ({ work: REPAIR.IN + p.strokes * REPAIR.STROKE[p.motion], end: REPAIR.IN + p.strokes * REPAIR.STROKE[p.motion] + REPAIR.OUT });
/** The hand's offset from its working point at `t` ticks into the work: raised (or drawn back), then down onto it fast. */
function strokeHand(p: RepairParams, t: number): Vec3 {
  const period = REPAIR.STROKE[p.motion], u = (t % period) / period;
  // a strike takes its time rising and falls in the last quarter; a pump draws back and pushes home evenly
  const k = p.motion === 'strike' ? (u < 0.75 ? smooth(u / 0.75) : 1 - smooth((u - 0.75) / 0.25)) : dsin(Math.PI * u);
  if (p.motion === 'strike') return [p.hand[0], p.hand[1] + p.lift * k, p.hand[2]];
  return [p.hand[0] - dcos(p.face) * p.lift * k, p.hand[1], p.hand[2] - dsin(p.face) * p.lift * k];
}
/** The hand at `t` ticks from the start, on a finished run: in from `from`, the strokes, back to `carry`. */
export function repairHand(p: RepairParams, t: number, from: Vec3, carry: Vec3): Vec3 {
  const T = repairTicks(p);
  if (t < REPAIR.IN) return lerp3(from, strokeHand(p, 0), smooth(t / REPAIR.IN));
  if (t < T.work) return strokeHand(p, t - REPAIR.IN);
  return lerp3(strokeHand(p, 0), carry, smooth((t - T.work) / REPAIR.OUT));
}
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'repair.' + code, message, subjects });
function admission(rt: Runtime, p: RepairParams): { actor: Entity; item: Entity; hand: Hand } | Diagnostic {
  const actor = rt.world.entities[p.actor], item = rt.world.entities[p.item], h = actor?.human;
  if (!h || actor.kind !== 'human' || (actor.body && actor.body.family !== 'humanoid')) return issue('body-family', 'Repairing needs humanoid hands.', [p.actor]);
  if (!item || !isItem(item) || item.support?.kind !== 'in-hand' || item.support.by !== p.actor) return issue('not-held', `${p.actor} must hold ${p.item} to repair with it.`, [p.actor, p.item]);
  if (!rt.world.entities[p.target]) return issue('target', `${p.target} is gone.`, [p.target]);
  return { actor, item, hand: item.support.hand };
}
function finish(rt: Runtime, ex: Exec) {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  if (h.activity === 'reach') h.activity = 'idle';
  if (h.hands) { delete h.hands[ex.hand]; if (!Object.keys(h.hands).length) delete h.hands; }
}
const targetKey = (e: Entity) => `${e.pose.p[0].toFixed(3)},${e.pose.p[1].toFixed(3)},${e.pose.p[2].toFixed(3)},${e.pose.yaw.toFixed(3)}`;
export const repair: ActionDef<RepairParams, true, Exec> = {
  verb: 'repair_v1',
  description: 'With a tool in hand, work a few strokes at a thing: a strike falls on it, a pump works back and forth. The body stands still; a cancel brings the hand back with the tool in it. The action itself changes nothing: the server applies the result when the receipt completes.',
  schema: repairParams,
  // actor: the body holds its place while it works (nobody's make-way moves it); entity: one pair of hands at a thing
  reservations: (_w, p) => [`actor:${p.actor}`, `hand:${p.actor}:left`, `hand:${p.actor}:right`, `entity:${p.item}`, `entity:${p.target}`].map((resource) => ({ resource, mode: 'exclusive' as const })),
  plan(rt, p) {
    const a = admission(rt, p); if ('code' in a) return { ok: false, diagnostic: a };
    if (heldBy(rt.world, p.actor).length !== 1) return { ok: false, diagnostic: issue('hand-full', 'Repairing needs the other hand free.', [p.actor]) };
    if (hypot(p.hand[0] - a.actor.pose.p[0], p.hand[2] - a.actor.pose.p[2]) > REACH) return { ok: false, diagnostic: issue('too-far', `${p.actor} is not standing at ${p.target}.`, [p.actor, p.target]) };
    return { ok: true, program: true };
  },
  start(rt, p, _plan, _id) {
    const a = rt.world.entities[p.actor], item = rt.world.entities[p.item], support = item.support as { hand: Hand };
    return { p: structuredClone(p), start: rt.tick, hand: support.hand, at: [...a.pose.p] as Vec3, level: a.human!.level, yaw0: a.pose.yaw, target: targetKey(rt.world.entities[p.target]) };
  },
  step(rt, ex): StepResult {
    const a = admission(rt, ex.p);
    if ('code' in a) { finish(rt, ex); return { status: 'failed', diagnostic: a }; }
    const actor = a.actor, h = actor.human!, t = rt.tick - ex.start;
    if (h.level !== ex.level || actor.pose.p.some((n, i) => Math.abs(n - ex.at[i]) > 1e-6)) { finish(rt, ex); return { status: 'failed', diagnostic: issue('moved', 'The body was moved; the repair stopped with the tool in hand.', [ex.p.actor]) }; }
    if (targetKey(rt.world.entities[ex.p.target]) !== ex.target) { finish(rt, ex); return { status: 'failed', diagnostic: issue('target-moved', `${ex.p.target} moved; the repair stopped with the tool in hand.`, [ex.p.target]) }; }
    // face the work over the first 0.4 s (the walk usually arrives facing it already)
    const turn = ((ex.p.face - ex.yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    actor.pose.yaw = ex.yaw0 + turn * smooth(t / 8);
    const carry = carryPoint(a.item, bodyFrame(actor), ex.hand);
    ex.from ??= h.hands?.[ex.hand] ? [...h.hands[ex.hand]!] as Vec3 : carry;
    const hands = h.hands ??= {};
    h.activity = 'reach';
    if (ex.stopAt !== undefined) {
      // stopping: from where the hand is, straight back to the carry point, with the tool in it
      const k = (rt.tick - ex.stopAt) / REPAIR.OUT;
      hands[ex.hand] = lerp3(ex.stopHand!, carry, smooth(k));
      followHand(a.item, hands[ex.hand]!, actor.pose.yaw);
      if (k >= 1) { finish(rt, ex); return { status: 'completed', outputs: { stopped: true } }; }
      return { status: 'running', phase: 'stopping' };
    }
    hands[ex.hand] = repairHand(ex.p, t, ex.from, carry);
    followHand(a.item, hands[ex.hand]!, actor.pose.yaw);
    if (t >= repairTicks(ex.p).end) { finish(rt, ex); return { status: 'completed', outputs: { strokes: ex.p.strokes } }; }
    return { status: 'running', phase: 'working' };
  },
  cancel(rt, ex) {
    const h = rt.world.entities[ex.p.actor]?.human; if (!h?.hands?.[ex.hand]) { finish(rt, ex); return { ok: true }; }
    if (ex.stopAt === undefined) { ex.stopAt = rt.tick; ex.stopHand = [...h.hands[ex.hand]!] as Vec3; }
    return { ok: true, deferred: true };
  },
  resumable: true,
};
