// Social / inhabited-scene verbs (spec §17, milestone H). Each is a parent action that moves its
// people with child walk_to actions (arriving with `face`), then holds them in an activity
// ('sit', 'talk', 'warm', 'watch') until cancelled. People carry no loads here, so every social
// action cancels immediately and leaves its people idle where they stand — except a person seated
// on a fixture (or sitting down), whose cancel is deferred by a 0.6 s 'stand-up' back to the
// seat's approach point (seat fixtures are obstacles; see slots.ts seatApproach).
//
// Pre-emption (spec §17 "explicit director commands take precedence"; SOCIAL.md "Pre-emption"): a
// social action owns its people's `actor:<id>` reservations. Every social verb declares `yieldTo`
// (actions/types.ts), so a directed task submitted for one of them makes the runtime release the
// smallest social unit first — this person's seat / slot, their ambient walk, or the whole
// converse / face — cancelled with reason `pre-empted by <id>`; a seated person stands up (0.6 s)
// and the directive starts when they are off the seat. Social verbs never pre-empt each other
// (reservation.conflict), and `preempt: false` on the directive restores the plain refusal.
// `releaseForDirective` does the same release by hand.
import { z } from 'zod';
import { angleDelta, clamp, dist2, dsin, heading, rot2, sub2, add2, wrapAngle, type Vec2, hypot } from '../core/math.ts';
import type { ActionDef, ActionRecord, Diagnostic, Reservation, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { MAX_HUMAN_STEP_PER_TICK } from '../runtime/invariants.ts';
import type { Entity } from '../world/types.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { humanRadius } from '../bodies/humanoid.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker, STEP } from '../spatial/grid.ts';
import { PLAN_MARGIN } from '../spatial/path.ts';
import { planWalk } from '../locomotion/walk.ts';
import { bodyProfile } from '../bodies/navigation.ts';
import { HUMAN_PROFILE, type Obstacle } from '../spatial/types.ts';
import { checkStations, childrenState, walkCrew, type Children } from '../construction/children.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { assignNearest, isFree, needsApproach, seatApproach, slotById, whyTaken, slotResource, slotsOf, SLOT_CLEARANCE, type Slot, type SlotKind } from './slots.ts';
import { ambientWander } from './ambient.ts';

const id80 = z.string().min(1).max(80);
const xz = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]);
export const ACTIVITIES = ['sit', 'watch', 'warm', 'talk', 'listen', 'idle', 'lie', 'nap'] as const;
/** beds/1: the activities a berth is held in (lying awake, asleep); only a berth takes them. */
const BERTH_ACTIVITIES: ReadonlySet<string> = new Set(['lie', 'nap']);
const activity = z.enum(ACTIVITIES);
const DEFAULT_ACTIVITY: Record<SlotKind, (typeof ACTIVITIES)[number]> = { seat: 'sit', audience: 'watch', 'fire-circle': 'warm', stand: 'idle', berth: 'lie' };

// ---------- shared helpers ----------

export function humanOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no actor "${id}"`, subjects: [id] };
  if (e.kind !== 'human' || !e.human) return { code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] };
  return e;
}

/** Same wording as Runtime.reservationConflict, for plan-time checks of actions that hand claims to children. */
function busy(rt: Runtime, actor: string): Diagnostic | null {
  const h = rt.holder(`actor:${actor}`)[0];
  if (!h) return null;
  const rec = rt.records.get(h)!;
  return { code: 'reservation.conflict', message: `actor:${actor} is already reserved by action ${h} (${rec.verb}, ${rec.status})`, subjects: [actor], details: { resource: `actor:${actor}`, holder: h } };
}

/** Actor exists, is a person, and has free hands. */
function readyActor(rt: Runtime, id: string): Entity | Diagnostic {
  const a = humanOf(rt, id);
  if ('code' in a) return a;
  return holdingDiagnostic(rt.world, id) ?? a;
}

const pos2 = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];

function setActivity(rt: Runtime, actors: string[], task: string, act: string) {
  for (const a of actors) {
    const h = rt.world.entities[a]?.human;
    if (!h) continue;
    h.task = task;
    h.activity = act;
  }
}
function idle(rt: Runtime, actors: string[], task: string) {
  for (const a of actors) {
    const h = rt.world.entities[a]?.human;
    if (h && h.task === task) { h.task = undefined; h.activity = 'idle'; if (h.berth) { delete h.berth; delete h.seatHeight; } }
  }
}

const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + clamp(angleDelta(yaw, want), -max, max));
const FACE_DONE = 0.03;

// ---------- take_slot / sit / stand ----------

type SlotParams = { actor: string; slot?: string; owner?: string; activity?: (typeof ACTIVITIES)[number] };
/** A slot plus, for a fixture seat, the approach point chosen at claim time (slots.ts seatApproach). */
type SlotProgram = { slot: Slot; approach?: Vec2 };
type SlotPhase = 'approach' | 'turn' | 'sit-down' | 'occupied' | 'stand-up';
type SlotExec = {
  id: string; actor: string; slot: Slot; approach?: Vec2; activity: string; phase: SlotPhase; child?: Children; error?: Diagnostic;
  /** sit-down / stand-up transition: start point, elapsed and total time. */
  from?: Vec2; t: number; dur: number;
};

/** Seconds a sit-down or stand-up takes (approach point ↔ seat). */
export const SIT_TRANSITION = 0.6;
/** Activities of the seat transitions; the renderer maps them (SOCIAL.md). */
export const SEAT_TRANSITIONS = ['sit-down', 'stand-up'] as const;

/** Plan-time slot choice, read back by reservations() (same params object; Runtime.submit calls plan first). */
const resolved = new WeakMap<object, Slot>();

const lerp2 = (a: Vec2, b: Vec2, k: number): Vec2 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const smooth = (k: number) => k * k * (3 - 2 * k);
/** The largest per-tick move of a smoothstep transition over `span` metres lasting `dur` seconds (ticks of DT). */
function peakStep(span: number, dur: number): number {
  let max = 0;
  for (let t = 0; t < dur + DT; t += DT) { const a = Math.min(1, t / dur), b = Math.min(1, (t + DT) / dur); max = Math.max(max, span * (smooth(b) - smooth(a))); if (b >= 1) break; }
  return max;
}
/** How long sitting down over (or standing up from) `span` metres takes: SIT_TRANSITION, unless that would move the body
 *  further than the engine's per-tick limit (a seat whose approach point is far from it, e.g. a café chair tucked under a
 *  parasol table: 1.5 m faulted motion.teleport); then just long enough to stay inside it. Spans that fit are unchanged. */
/** #1083: how far the body's seated height moves from a standard seat's (0.45 m) onto this seat's top: part of the span a
 *  sit-down covers, so a high seat's lift, drawn with the blend, stays within a human's per-tick step too. */
export const SEAT_STANDARD_TOP = 0.45;
export const seatRise = (slot: { kind: string; height?: number }) => (slot.kind === 'seat' && typeof slot.height === 'number' ? Math.abs(slot.height - SEAT_STANDARD_TOP) : 0);
export function sitDuration(span: number): number {
  if (!(span > 0) || peakStep(span, SIT_TRANSITION) <= MAX_HUMAN_STEP_PER_TICK) return SIT_TRANSITION;
  let dur = SIT_TRANSITION;
  while (peakStep(span, dur) > MAX_HUMAN_STEP_PER_TICK * 0.9 && dur < 30) dur += DT;
  return dur;
}

/** Advance a sit-down / stand-up transition toward `to`; true when it has arrived. */
function transition(rt: Runtime, ex: SlotExec, to: Vec2, dt: number): boolean {
  const a = rt.world.entities[ex.actor];
  const nextT = ex.t + dt;
  const k = ex.dur > 0 ? Math.min(1, nextT / ex.dur) : 1;
  const q = k >= 1 - 1e-9 ? to : lerp2(ex.from!, to, smooth(k));
  // Standing up has no walk controller: check the next pose against moving neighbours too.
  // The reservation remains held while waiting, so a new sitter cannot claim this slot.
  if (ex.phase === 'stand-up') for (const other of Object.values(rt.world.entities)) {
    if (other.id === a.id || !other.human || other.human.level !== a.human!.level || other.human.activity === 'sit') continue;
    if (dist2(q,pos2(other)) < humanRadius(a) + humanRadius(other) + 0.02) return false;
  }
  ex.t = nextT;
  a.pose.p[0] = q[0];
  a.pose.p[2] = q[1];
  return k >= 1 - 1e-9;
}

function slotAction(verb: string, description: string, kinds: SlotKind[] | null, schema: z.ZodType<SlotParams>): ActionDef<SlotParams, SlotProgram, SlotExec> {
  return {
    verb,
    description,
    schema,
    // L4 audit: the step writes only its own actor's body (pose, human fields); the approach walk is a child walk_to
    navPure: true,
    reservations(_w, p) {
      const s = resolved.get(p)?.id ?? p.slot;
      const out: Reservation[] = [{ resource: `actor:${p.actor}`, mode: 'exclusive' }];
      if (s) out.push({ resource: slotResource(s), mode: 'exclusive' });
      return out;
    },
    plan(rt, p) {
      const a = readyActor(rt, p.actor);
      if ('code' in a) return { ok: false, diagnostic: a };
      let slot: Slot, others: Slot[] = [];
      if (p.slot) {
        // an explicit slot is not checked for claims here: the runtime's reservation step names the holder
        const s = slotById(rt, p.slot);
        if ('code' in s) return { ok: false, diagnostic: s };
        slot = s;
      } else {
        const owner = p.owner!;
        const all = slotsOf(rt, owner);
        if (!Array.isArray(all)) return { ok: false, diagnostic: all };
        const kindOk = all.filter((s) => !kinds || kinds.includes(s.kind));
        // beds/1: "lie on the caravan" takes one of its berths, "sit in the caravan" one of its seats (a mismatch is refused below)
        const fits = kindOk.filter((s) => !p.activity || (s.kind === 'berth') === BERTH_ACTIVITIES.has(p.activity));
        const ok = fits.length ? fits : kindOk;
        const free = ok.filter((s) => isFree(rt.world, s, new Set([p.actor])));
        if (!free.length) {
          return { ok: false, diagnostic: { code: 'slot.none-free', message: `${p.actor} has no free ${kinds ? `${kinds.join('/')} ` : ''}slot at ${owner}: all ${ok.length} are taken (${whyTaken(rt.world, ok, new Set([p.actor]))})`, subjects: [p.actor, owner] } };
        }
        const me = pos2(a);
        slot = free.reduce((b, s) => (dist2(me, s.p) < dist2(me, b.p) - 1e-9 ? s : b));
        // L3: the other free slots, nearest first, for when the nearest one's sit/stand approach is blocked (below)
        others = free.filter((s) => s !== slot).map((s, i) => ({ s, i, d: dist2(me, s.p) })).sort((x, y) => x.d - y.d || x.i - y.i).map((x) => x.s);
      }
      if (kinds && !kinds.includes(slot.kind))
        return { ok: false, diagnostic: { code: 'slot.wrong-kind', message: `${slot.id} is a ${slot.kind} slot; ${verb} needs ${kinds.join('/')}`, subjects: [p.actor, slot.id] } };
      // beds/1: a berth is lain on (awake or asleep), and only a berth is
      if (p.activity && (slot.kind === 'berth') !== BERTH_ACTIVITIES.has(p.activity))
        return { ok: false, diagnostic: { code: 'slot.wrong-activity', message: slot.kind === 'berth' ? `${slot.id} is a berth: lie or nap on it, not ${p.activity}` : `${p.activity} needs a berth (a bed); ${slot.id} is a ${slot.kind} slot`, subjects: [p.actor, slot.id] } };
      const approachFor = (slot: Slot): { approach?: Vec2; routeChecked: boolean } | Diagnostic => {
        const onSeat = dist2(pos2(a), slot.p) < 0.05 && a.human!.level === slot.level;
        let approach: Vec2 | undefined, routeChecked = false, routeIssue: Diagnostic | undefined;
        if (needsApproach(rt.world, slot)) {
          // Entity-world assets explicitly opt into the new policy in their logged definition. A historical asset or
          // active SlotProgram without it keeps the original selection. Test alternatives with the actual walker's
          // profile: the first clear point can be a raster pocket that the planner cannot enter at this rotation.
          const profile = bodyProfile(a);
          const q = seatApproach(rt, slot, slot.approachPolicy === 'reachable/1' && !onSeat ? {
            minClearance: profile.radius + PLAN_MARGIN, anyAngle: true,
            accept: (point) => {
              // Sit/stand moves directly between this point and the seat (slotTransitionIssue: never through a wall or table).
              const issue = slotTransitionIssue(rt, slot, point, profile);
              if (issue) { if (issue.code !== 'slot.no-floor') routeIssue ??= issue; return false; }
              // New movable seats need a genuinely clear exit, not just a raster
              // clearance sample (small adjacent props can fall between cells).
              if (rt.world.entities[slot.owner]?.tags?.includes('entity-world-transport')) {
                const spatial=rt.services.spatial as Spatial, floor=rt.world.entities[slot.owner].pose.p[1];
                for (const obstacle of spatial.scene.obstacles) {
                  if (obstacle.y1<=floor || obstacle.y0>=floor+profile.height) continue;
                  const local=rot2(sub2(point,obstacle.obb.c),-obstacle.obb.yaw);
                  if (hypot(Math.max(0,Math.abs(local[0])-obstacle.obb.half[0]),Math.max(0,Math.abs(local[1])-obstacle.obb.half[1]))<profile.radius+.01) {
                    routeIssue??={code:'slot.exit-blocked',message:'This seat has no clear standing exit beside the adjacent objects.',subjects:[slot.id,obstacle.id]};
                    return false;
                  }
                }
              }
              const route = planWalk(rt, a, { level: slot.level, p: point });
              if (!route.ok) { routeIssue ??= route.diagnostic; return false; }
              routeChecked = true; return true;
            },
          } : undefined);
          if (!Array.isArray(q)) { const issue = routeIssue ?? q; return { ...issue, subjects: [p.actor, ...(issue.subjects ?? [])] }; }
          approach = q;
        }
        return { approach, routeChecked };
      };
      // "sit in the canoe": the nearest free seat is chosen first, exactly as before. When its approach is blocked or
      // unreachable from here, a reachable/1 asset's other free seats are tried nearest first (the canoe's back seat when
      // the front one's slide from the jetty crosses the jetty); the first seat's refusal stands if none works.
      let found = approachFor(slot);
      if ('code' in found && slot.approachPolicy === 'reachable/1') {
        for (const s of others) {
          if (s.approachPolicy !== 'reachable/1') continue;
          const f = approachFor(s);
          if (!('code' in f)) { slot = s; found = f; break; }
        }
      }
      if ('code' in found) return { ok: false, diagnostic: found };
      const { approach, routeChecked } = found;
      const onSeat = dist2(pos2(a), slot.p) < 0.05 && a.human!.level === slot.level;
      if (!onSeat && !routeChecked) {
        const d = checkStations(rt, [{ actor: p.actor, p: approach ?? slot.p, level: slot.level }]);
        if (d) return { ok: false, diagnostic: d };
      }
      resolved.set(p, slot);
      return { ok: true, program: { slot, approach } };
    },
    start(rt, p, { slot, approach }, id) {
      const a = rt.world.entities[p.actor];
      // a fixture seat is always occupied sitting (and 'sit' is the seated invariant exemption); a berth lying or asleep
      const act = slot.kind === 'berth' ? (p.activity === 'nap' ? 'nap' : 'lie') : approach ? 'sit' : p.activity ?? DEFAULT_ACTIVITY[slot.kind];
      const ex: SlotExec = { id, actor: p.actor, slot, approach, activity: act, phase: 'approach', t: 0, dur: 0 };
      const here = pos2(a), level = a.human!.level === slot.level;
      if (level && dist2(here, slot.p) < 0.05) { ex.phase = 'turn'; ex.approach = undefined; } // already on the seat
      else if (level && dist2(here, approach ?? slot.p) < 0.05) ex.phase = 'turn';
      else {
        const ch = walkCrew(rt, id, [{ actor: p.actor, p: approach ?? slot.p, yaw: slot.yaw, level: slot.level }]);
        if ('code' in ch) ex.error = ch;
        else ex.child = ch;
      }
      a.human!.task ??= id;
      return ex;
    },
    step(rt, ex, dt): StepResult {
      if (ex.error) return { status: 'failed', diagnostic: ex.error };
      const a = rt.world.entities[ex.actor];
      if (ex.phase === 'stand-up') {
        a.human!.task = ex.id;
        a.human!.activity = 'stand-up';
        if (!transition(rt, ex, ex.approach!, dt)) return { status: 'running', phase: 'stand-up' };
        if (rt.world.entities[ex.slot.owner]?.tags?.includes('entity-world')) delete a.human!.seatHeight;
        idle(rt, [ex.actor], ex.id);
        return { status: 'completed', outputs: { stoodAt: ex.approach } };
      }
      if (ex.phase === 'approach') {
        const st = childrenState(ex.child!);
        if (st === 'running') return { status: 'running', phase: 'approach' };
        if (st !== 'done') return { status: 'failed', diagnostic: { ...st, message: `${ex.actor} could not reach ${ex.approach ? `the approach point of ${ex.slot.id}` : ex.slot.id}: ${st.message}` } };
        ex.phase = 'turn';
      }
      if (ex.phase === 'turn') {
        a.human!.task = ex.id;
        // #1090: a god-built seat (an entity-world fixture or transport) with a top height draws the body on it while seated
        if (ex.slot.kind==='seat' && ex.slot.height!==undefined && rt.world.entities[ex.slot.owner]?.tags?.includes('entity-world')) a.human!.seatHeight=ex.slot.height;
        if (Math.abs(angleDelta(a.pose.yaw, ex.slot.yaw)) > FACE_DONE) {
          a.pose.yaw = turnToward(a.pose.yaw, ex.slot.yaw, HUMAN_PROFILE.turnRate * dt);
          return { status: 'running', phase: 'turn' };
        }
        if (ex.approach) { ex.phase = 'sit-down'; ex.from = pos2(a); ex.t = 0; ex.dur = sitDuration(Math.hypot(dist2(ex.from, ex.slot.p), seatRise(ex.slot))); }
        else { ex.phase = 'occupied'; if (ex.slot.kind === 'berth') { a.human!.berth = ex.slot.id; a.human!.seatHeight = ex.slot.height ?? 0.5; } }
      }
      if (ex.phase === 'sit-down') {
        setActivity(rt, [ex.actor], ex.id, 'sit-down');
        // beds/1: the body is on the berth (its mattress height; invariants.ts exempts it while this task holds the berth)
        if (ex.slot.kind === 'berth') { a.human!.berth = ex.slot.id; a.human!.seatHeight = ex.slot.height ?? 0.5; }
        if (!transition(rt, ex, ex.slot.p, dt)) return { status: 'running', phase: 'sit-down' };
        ex.phase = 'occupied';
      }
      setActivity(rt, [ex.actor], ex.id, ex.activity);
      return { status: 'running', phase: 'occupied' };
    },
    cancel(rt, ex) {
      if (ex.phase === 'stand-up') return { ok: true, deferred: true };
      // seated (or sitting down): stand up back to the approach point first, over the share of
      // SIT_TRANSITION the body has left to cover; the seat claim is held until they are off it
      if (ex.approach && (ex.phase === 'sit-down' || ex.phase === 'occupied')) {
        const here = pos2(rt.world.entities[ex.actor]);
        const flat = dist2(ex.slot.p, ex.approach), span = Math.hypot(flat, seatRise(ex.slot));
        const left = dist2(here, ex.approach);
        if (left > 1e-6) {
          ex.phase = 'stand-up'; ex.from = here; ex.t = 0; ex.dur = span > 1e-9 ? sitDuration(span) * Math.min(1, flat > 1e-9 ? left / flat : 1) : 0;
          return { ok: true, deferred: true };
        }
      }
      if (rt.world.entities[ex.slot.owner]?.tags?.includes('entity-world')) delete rt.world.entities[ex.actor].human!.seatHeight;
      idle(rt, [ex.actor], ex.id);
      return { ok: true };
    },
    yieldTo: (_rt, self, _h, _a, by) => (directive(by) ? [self.id] : []), // pre-emption: this person's own seat / slot (a gather keeps its other members)
    resumeIntent: (_rt, ex, self) => !self.parent && ex.slot.kind === 'seat' && ex.phase === 'occupied'
      ? { actor: ex.actor, verb, params: verb === 'sit' ? { actor: ex.actor, slot: ex.slot.id } : { actor: ex.actor, slot: ex.slot.id, activity: ex.activity } }
      : null,
  };
}

const oneOf = <T extends Record<string, unknown>>(keys: (keyof T)[]) => (p: T) => keys.filter((k) => p[k] !== undefined).length === 1;

export const takeSlot = slotAction(
  'take_slot',
  'Walk a person to an interaction slot (explicit `slot` id "<owner>#<slot>", or the nearest free slot of fixture/region `owner`), face its heading and hold `activity` (default by slot kind: seat→sit, audience→watch, fire-circle→warm, berth→lie; a berth also takes nap) until cancelled or `stand`. Fails slot.none-free when every slot is taken.',
  null,
  z.strictObject({ actor: id80, slot: id80.optional(), owner: id80.optional(), activity: activity.optional() }).refine(oneOf(['slot', 'owner']), 'give exactly one of slot, owner'),
);

const sitSchema = z.strictObject({ actor: id80, slot: id80.optional(), fixture: id80.optional() }).refine(oneOf(['slot', 'fixture']), 'give exactly one of slot, fixture');
const sitBase = slotAction('sit', '', ['seat'], sitSchema as unknown as z.ZodType<SlotParams>);
type SitParams = z.infer<typeof sitSchema>;
const asSlot = (p: SitParams): SlotParams => {
  let q = resolvedSit.get(p);
  if (!q) { q = { actor: p.actor, slot: p.slot, owner: p.fixture, activity: 'sit' }; resolvedSit.set(p, q); }
  return q;
};
const resolvedSit = new WeakMap<object, SlotParams>();

export const sit: ActionDef<SitParams, SlotProgram, SlotExec> = {
  ...sitBase,
  verb: 'sit',
  description: 'Walk a person to a seat (explicit `slot` id, or the nearest free seat of `fixture`, e.g. a camp-chair or bench), turn to face the seat direction and sit until `stand { actor }` or cancel. Two people can never hold one seat (reservation.conflict / slot.none-free).',
  schema: sitSchema,
  reservations: (w, p) => sitBase.reservations(w, asSlot(p)),
  plan: (rt, p) => sitBase.plan(rt, asSlot(p)),
  start: (rt, p, prog, id) => sitBase.start(rt, asSlot(p), prog, id),
};

type StandExec = { released: string };
export const stand: ActionDef<{ actor: string }, string, StandExec> = {
  verb: 'stand',
  description: `End a person's sit / take_slot. A seated person first stands up (activity 'stand-up', ${SIT_TRANSITION} s) back to the seat's approach point, keeping the seat claimed until they are off it; then they are idle. Completes when the released action has ended. Refused (social.in-group) for a member of a converse — cancel that action instead.`,
  schema: z.strictObject({ actor: id80 }),
  reservations: () => [],
  plan(rt, p) {
    const a = humanOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const hs = rt.holder(`actor:${p.actor}`).map((h) => rt.records.get(h)!);
    const seat = hs.find((r) => r.verb === 'sit' || r.verb === 'take_slot');
    if (seat) return { ok: true, program: seat.id };
    const top = hs[0];
    if (top) return { ok: false, diagnostic: { code: 'social.in-group', message: `${p.actor} is held by ${top.verb} ${top.id}, not a seat; cancel ${top.id} to release them`, subjects: [p.actor, top.id] } };
    return { ok: false, diagnostic: { code: 'social.not-seated', message: `${p.actor} is not sitting or holding a slot`, subjects: [p.actor] } };
  },
  start(rt, _p, holder) {
    rt.cancel(holder);
    return { released: holder };
  },
  navPure: true, // L4 audit: the step only reads (the release is cancelled in start)
  step: (rt, ex) => (rt.isActive(ex.released) ? { status: 'running', phase: 'stand-up' } : { status: 'completed', outputs: { released: ex.released } }),
  cancel: () => ({ ok: true }),
  yieldTo: () => [], // social (never pre-empts); holds no one
};

// ---------- face ----------

type FaceParams = { actor: string; target: { entity: string } | { point: [number, number] } };
type FaceExec = { id: string; actor: string; target: FaceParams['target'] };

function targetYaw(rt: Runtime, actor: Entity, t: FaceParams['target']): number | Diagnostic {
  let q: Vec2;
  if ('entity' in t) {
    const e = rt.world.entities[t.entity];
    if (!e) return { code: 'entity.unknown', message: `no entity "${t.entity}" to face`, subjects: [t.entity] };
    q = pos2(e);
  } else q = t.point;
  const d = sub2(q, pos2(actor));
  if (hypot(d[0], d[1]) < 0.05) return { code: 'face.degenerate', message: `${actor.id} is standing on the point it was asked to face`, subjects: [actor.id] };
  return heading(d);
}

export const face: ActionDef<FaceParams, number, FaceExec> = {
  verb: 'face',
  description: 'Turn a person in place to face an entity ({ entity }) or a ground point ({ point: [x, z] }); activity idle.',
  navPure: true, // L4 audit: the step turns its own actor only
  schema: z.strictObject({ actor: id80, target: z.union([z.strictObject({ entity: id80 }), z.strictObject({ point: xz })]) }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = readyActor(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    const y = targetYaw(rt, a, p.target);
    return typeof y === 'number' ? { ok: true, program: y } : { ok: false, diagnostic: y };
  },
  start(rt, p, _y, id) {
    rt.world.entities[p.actor].human!.task = id;
    return { id, actor: p.actor, target: p.target };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.actor];
    const y = targetYaw(rt, a, ex.target);
    if (typeof y !== 'number') return { status: 'failed', diagnostic: y };
    a.human!.activity = 'idle';
    if (Math.abs(angleDelta(a.pose.yaw, y)) > FACE_DONE) {
      a.pose.yaw = turnToward(a.pose.yaw, y, HUMAN_PROFILE.turnRate * dt);
      return { status: 'running', phase: 'turn' };
    }
    idle(rt, [ex.actor], ex.id);
    return { status: 'completed', outputs: { yaw: a.pose.yaw } };
  },
  cancel(rt, ex) {
    idle(rt, [ex.actor], ex.id);
    return { ok: true };
  },
  yieldTo: (_rt, self, _h, _a, by) => (directive(by) ? [self.id] : []),
};

// ---------- converse ----------

type ConverseParams = { actors: string[]; at?: [number, number]; duration?: number };
type Circle = { centre: Vec2; r: number; moves: { actor: string; p: Vec2; yaw: number; level: number }[] };
type ConversationReturn = { actor: string; directive: string; station: Circle['moves'][number]; child?: string };
type ConverseExec = { retired?: string[]; departures?: ConversationReturn[]; id: string; actors: string[]; phase: 'gathering' | 'talking'; child?: Children; error?: Diagnostic; t: number; duration?: number; circle: Circle };

/** The sit/stand slide moves the torso only (arms and legs tuck in), so the sweep tests half the walking body radius; a bus seat 0.23 m from a table edge is legitimate. */
const TRANSITION_BODY = 0.5;
/**
 * Why a body standing at `point` cannot slide onto `slot` (and back off it), or null: the straight sit/stand move from the
 * point to the seat may cross no obstacle but the seat's own (an alternative on the other side of a wall or table must
 * never turn into a shortcut through it), and no floor under the point is no way on. The sit plan's reachable/1 test and
 * the use-check (BS1 useCheckV1) share it.
 */
/** The scene's obstacles bucketed by 4 m cell (each under every cell its bounding circle's box covers), for a caller that
 *  tests many slides against one scene (BS1 useCheckV1): `near` answers, in scene order, every obstacle whose bounding
 *  circle's box meets the box [x0, z0, x1, z1]. Built for one obstacle list; pass it only while that list is the scene's. */
export type ObstacleIndex = { obstacles: readonly Obstacle[]; near(x0: number, z0: number, x1: number, z1: number): Obstacle[] };
const OBSTACLE_CELL = 4;
export function obstacleIndex(obstacles: readonly Obstacle[]): ObstacleIndex {
  const cells = new Map<number, number[]>(), key = (i: number, j: number) => i * 1048576 + j;
  const span = (lo: number, hi: number): [number, number] => [Math.floor(lo / OBSTACLE_CELL), Math.floor(hi / OBSTACLE_CELL)];
  obstacles.forEach((o, k) => {
    const r = hypot(o.obb.half[0], o.obb.half[1]), [i0, i1] = span(o.obb.c[0] - r, o.obb.c[0] + r), [j0, j1] = span(o.obb.c[1] - r, o.obb.c[1] + r);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = cells.get(key(i, j)); if (c) c.push(k); else cells.set(key(i, j), [k]); }
  });
  return {
    obstacles,
    near(x0, z0, x1, z1) {
      const [i0, i1] = span(x0, x1), [j0, j1] = span(z0, z1), got = new Set<number>();
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of cells.get(key(i, j)) ?? []) got.add(k);
      return [...got].sort((a, b) => a - b).map((k) => obstacles[k]);
    },
  };
}
export function slotTransitionIssue(rt: Runtime, slot: Slot, point: Vec2, profile: { radius: number; height: number }, index?: ObstacleIndex): Diagnostic | null {
  const sp = rt.services.spatial as Spatial, n = Math.max(1, Math.ceil(dist2(point, slot.p) / 0.025));
  const pad = dist2(point, slot.p) / n / 2, floor = sp.levelAt(slot.level, point);
  if (!floor) return { code: 'slot.no-floor', message: `${slot.id}: no floor at its sit/stand approach`, subjects: [slot.id] };
  // Only obstacles whose bounding circle comes within reach of the slide can block it (the box is inside that circle, so
  // its distance from any sample is at least the centre's distance less the circle's radius): the same answer, in the
  // same order, without testing every sample against every obstacle of the world (BS1: the use-check calls this per try).
  const reach = profile.radius * TRANSITION_BODY + pad + 1e-6, near: Obstacle[] = [];
  const dx = slot.p[0] - point[0], dz = slot.p[1] - point[1], len2 = dx * dx + dz * dz;
  const pool = index && index.obstacles === sp.scene.obstacles
    ? index.near(Math.min(point[0], slot.p[0]) - reach, Math.min(point[1], slot.p[1]) - reach, Math.max(point[0], slot.p[0]) + reach, Math.max(point[1], slot.p[1]) + reach)
    : sp.scene.obstacles;
  for (const o of pool) {
    const cx = o.obb.c[0] - point[0], cz = o.obb.c[1] - point[1], t = len2 > 0 ? Math.min(1, Math.max(0, (cx * dx + cz * dz) / len2)) : 0;
    if (hypot(cx - t * dx, cz - t * dz) - hypot(o.obb.half[0], o.obb.half[1]) < reach) near.push(o);
  }
  for (let i = 0; i <= n; i++) {
    const k = i / n, p: Vec2 = [point[0] + (slot.p[0] - point[0]) * k, point[1] + (slot.p[1] - point[1]) * k];
    // The actor may still be downstairs. The transition happens after the walk, on the seat's floor.
    const y = slot.level === 0 && sp.ground ? sp.ground.standY(p[0], p[1]) : floor.y;
    for (const o of near) {
      if (o.id === slot.owner || o.y1 <= y + STEP || o.y0 >= y + profile.height) continue;
      // A seat tucked under a table (a bus seat 5 cm inside its table's footprint): that table is the seat's own
      // workspace, so the slide may end inside it. Thin walls never qualify.
      if (Math.min(...o.obb.half) >= 0.2) { const sl = rot2(sub2(slot.p, o.obb.c), -o.obb.yaw); if (Math.abs(sl[0]) <= o.obb.half[0] + 0.1 && Math.abs(sl[1]) <= o.obb.half[1] + 0.1) continue; }
      const l = rot2(sub2(p, o.obb.c), -o.obb.yaw);
      if (hypot(Math.max(0, Math.abs(l[0]) - o.obb.half[0]), Math.max(0, Math.abs(l[1]) - o.obb.half[1])) < profile.radius * TRANSITION_BODY + pad)
        return { code: 'slot.transition-blocked', message: `${slot.id} sit/stand approach crosses ${o.id}`, subjects: [slot.id, o.id] };
    }
  }
  return null;
}
/** Circle radius: at least 0.8 m between neighbours, within 0.6–1.0 m. */
export const circleRadius = (n: number) => clamp(0.4 / dsin(Math.PI / n), 0.6, 1.0);

/** Actors keep their angular order around the centre (no crossing paths); the phase minimises total walking. */
function circleFor(rt: Runtime, centre: Vec2, actors: Entity[]): Circle {
  const n = actors.length, r = circleRadius(n), step = (2 * Math.PI) / n;
  const order = actors
    .map((a, i) => ({ a, i, ang: dist2(pos2(a), centre) > 1e-6 ? heading(sub2(pos2(a), centre)) : (i * step) - Math.PI }))
    .sort((x, y) => x.ang - y.ang || x.i - y.i);
  let best: Circle['moves'] = [], bestCost = Infinity;
  for (let k = 0; k < 24; k++) {
    const t0 = order[0].ang + (k * step) / 24 - step / 2;
    const moves = order.map((o, j) => {
      const p = add2(centre, rot2([r, 0], t0 + j * step));
      return { actor: o.a.id, p, yaw: heading(sub2(centre, p)), level: o.a.human!.level };
    });
    const cost = moves.reduce((s, m, j) => s + dist2(m.p, pos2(order[j].a)) ** 2, 0);
    if (cost < bestCost - 1e-12) { bestCost = cost; best = moves; }
  }
  best.sort((x, y) => actors.findIndex((a) => a.id === x.actor) - actors.findIndex((a) => a.id === y.actor));
  return { centre, r, moves: best };
}

/** Why a circle does not fit on free ground, or null. */
function circleFit(rt: Runtime, c: Circle, members: Set<string>): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  for (const m of c.moves) {
    const g = sp.levelAt(m.level, m.p);
    const cl = g ? clearanceAt(g, m.p) : 0;
    if (cl < SLOT_CLEARANCE) {
      const what = (g && nearestBlocker(g, m.p)) ?? 'the edge of walkable ground';
      return { code: 'converse.clearance', message: `a ${c.moves.length}-person circle (r ${c.r.toFixed(2)} m) around (${c.centre[0].toFixed(2)}, ${c.centre[1].toFixed(2)}) does not fit: ${m.actor}'s place at (${m.p[0].toFixed(2)}, ${m.p[1].toFixed(2)}) is ${cl.toFixed(2)} m from ${what}`, subjects: [m.actor, what], at: [m.p[0], 0, m.p[1]] };
    }
    for (const o of Object.values(rt.world.entities))
      if (o.kind === 'human' && o.human && !members.has(o.id) && o.human.level === m.level && dist2(pos2(o), m.p) < 2 * HUMAN_RADIUS + 0.1)
        return { code: 'converse.clearance', message: `a ${c.moves.length}-person circle around (${c.centre[0].toFixed(2)}, ${c.centre[1].toFixed(2)}) does not fit: ${o.id} is standing at ${m.actor}'s place (${m.p[0].toFixed(2)}, ${m.p[1].toFixed(2)})`, subjects: [m.actor, o.id], at: [m.p[0], 0, m.p[1]] };
  }
  return null;
}

function conversationReturnSkip(rt: Runtime, ex: ConverseExec, intent: ConversationReturn, reason: string) {
  ex.departures!.splice(ex.departures!.indexOf(intent), 1);
  (ex.retired ??= []).push(intent.actor);
  rt.mark('converse.return-refused', { group: ex.id, actor: intent.actor, directive: intent.directive, reason });
  if (!ex.departures!.length) delete ex.departures;
}

function stepConversationReturns(rt: Runtime, ex: ConverseExec) {
  for (const intent of ex.departures?.slice() ?? []) {
    if (rt.isActive(intent.directive)) continue;
    if (rt.records.get(intent.directive)?.status !== 'completed') {
      conversationReturnSkip(rt, ex, intent, rt.records.get(intent.directive)?.status ?? 'directive-missing'); continue;
    }
    if (intent.child && rt.isActive(intent.child)) continue;
    const child = intent.child ? rt.records.get(intent.child) : undefined;
    if (intent.child && child?.status !== 'completed') {
      conversationReturnSkip(rt, ex, intent, child?.diagnostic?.code ?? child?.status ?? 'return-missing'); continue;
    }
    // Small hand items use support provenance rather than the construction grip field.
    if (Object.values(rt.world.entities).some((e) => e.support?.kind === 'in-hand' && e.support.by === intent.actor)) {
      conversationReturnSkip(rt, ex, intent, 'actor.holding'); continue;
    }
    const actor = readyActor(rt, intent.actor);
    if ('code' in actor) { conversationReturnSkip(rt, ex, intent, actor.code); continue; }
    const fit = circleFit(rt, { ...ex.circle, moves: [intent.station] }, new Set([...ex.actors, intent.actor]));
    if (fit) { conversationReturnSkip(rt, ex, intent, fit.code); continue; }
    if (!child) {
      const station = intent.station;
      const walk = rt.submit('walk_to', { actor: intent.actor, x: station.p[0], z: station.p[1], level: station.level, face: station.yaw }, { parent: ex.id, preempt: false });
      intent.child = walk.id;
      rt.mark('converse.return-started', { group: ex.id, actor: intent.actor, action: walk.id });
      continue;
    }
    const conflict = rt.reclaimSocialActor(ex.id, intent.actor);
    if (conflict) { conversationReturnSkip(rt, ex, intent, conflict.code); continue; }
    ex.actors = [...ex.actors, intent.actor];
    ex.departures!.splice(ex.departures!.indexOf(intent), 1);
    if (!ex.departures!.length) delete ex.departures;
    rt.mark('converse.rejoined', { group: ex.id, actor: intent.actor });
  }
}

export const converse: ActionDef<ConverseParams, Circle, ConverseExec> = {
  verb: 'converse',
  description: 'Gather 2–6 people into a conversation circle (radius 0.6–1.0 m) around `at` or, if omitted, the nearest free ground to their centroid; each faces the centre and talks until cancelled (or for `duration` s). Refused if someone is holding something (actor.holding) or the circle does not fit (converse.clearance).',
  schema: z.strictObject({ actors: z.array(id80).min(2).max(6), at: xz.optional(), duration: z.number().positive().max(3600).optional() }),
  reservations: (_w, p) => p.actors.map((a) => ({ resource: `actor:${a}`, mode: 'exclusive' as const })),
  plan(rt, p) {
    if (new Set(p.actors).size !== p.actors.length) return { ok: false, diagnostic: { code: 'action.invalid-params', message: `converse lists an actor twice: ${p.actors.join(', ')}`, subjects: p.actors } };
    const es: Entity[] = [];
    for (const id of p.actors) {
      const a = readyActor(rt, id);
      if ('code' in a) return { ok: false, diagnostic: a };
      if (es.length && a.human!.level !== es[0].human!.level)
        return { ok: false, diagnostic: { code: 'converse.levels', message: `${id} is on level ${a.human!.level} but ${es[0].id} is on level ${es[0].human!.level}`, subjects: [id, es[0].id] } };
      es.push(a);
    }
    const members = new Set(p.actors);
    const c0: Vec2 = p.at ?? [es.reduce((s, e) => s + e.pose.p[0], 0) / es.length, es.reduce((s, e) => s + e.pose.p[2], 0) / es.length];
    // explicit `at`: exactly there. Otherwise the centroid, then rings of candidates out to 3 m.
    const cands: Vec2[] = [c0];
    if (!p.at) for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) for (let k = 0; k < 8; k++) cands.push(add2(c0, rot2([d, 0], (k * Math.PI) / 4)));
    let first: Diagnostic | null = null;
    for (const c of cands) {
      const circle = circleFor(rt, c, es);
      const bad = circleFit(rt, circle, members);
      if (bad) { first ??= bad; continue; }
      const d = checkStations(rt, circle.moves);
      if (d) { first ??= d; continue; }
      return { ok: true, program: circle };
    }
    return { ok: false, diagnostic: first! };
  },
  start(rt, p, circle, id) {
    const ex: ConverseExec = { id, actors: p.actors, phase: 'gathering', t: 0, duration: p.duration, circle };
    const ch = walkCrew(rt, id, circle.moves);
    if ('code' in ch) ex.error = ch;
    else ex.child = ch;
    return ex;
  },
  step(rt, ex, dt) {
    if (ex.error) return { status: 'failed', diagnostic: ex.error };
    if (ex.phase === 'gathering') {
      const st = childrenState(ex.child!);
      if (st === 'running') return { status: 'running', phase: 'gathering' };
      if (st !== 'done') return { status: 'failed', diagnostic: { ...st, message: `the conversation circle could not form: ${st.message}` } };
      ex.phase = 'talking';
    }
    stepConversationReturns(rt, ex);
    const missing = ex.actors.find((id) => !rt.world.entities[id]?.human);
    if (missing) return { status: 'failed', diagnostic: { code: 'entity.unknown', message: `conversation member ${missing} disappeared`, subjects: [missing] } };
    setActivity(rt, ex.actors, ex.id, 'talk');
    ex.t += dt;
    if (ex.duration !== undefined && ex.t >= ex.duration - 1e-9) {
      for (const q of ex.departures ?? []) if (q.child && rt.isActive(q.child)) rt.cancel(q.child);
      delete ex.departures;
      idle(rt, ex.actors, ex.id);
      return { status: 'completed', outputs: { centre: ex.circle.centre, r: ex.circle.r, talked: ex.t } };
    }
    return { status: 'running', phase: 'talking' };
  },
  cancel(rt, ex) {
    idle(rt, ex.actors, ex.id);
    return { ok: true };
  },
  canYieldMembers: (_rt, ex, actors, by) => directive(by) && ex.phase === 'talking' && actors.every((a) => ex.actors.includes(a)) && ex.actors.length - actors.length >= 2,
  releaseMembers(rt, ex, actors, by) {
    let outer = by.id;
    for (let parent = by.parent; parent; parent = rt.records.get(parent)?.parent) outer = parent;
    for (const actor of actors) {
      (ex.departures ??= []).push({ actor, directive: outer, station: ex.circle.moves.find((m) => m.actor === actor)! });
      idle(rt, [actor], ex.id);
      rt.mark('converse.member-left', { group: ex.id, actor, directive: outer });
    }
    ex.actors = ex.actors.filter((a) => !actors.includes(a));
  },
  onDirective(rt, ex, by, claims, ancestors) {
    for (const intent of ex.departures?.slice() ?? []) {
      if (ancestors.includes(intent.directive) || !claims.some((r) => r.resource === `actor:${intent.actor}`)) continue;
      if (intent.child && rt.isActive(intent.child)) rt.cancel(intent.child, { code: 'social.pre-empted', message: `return superseded by ${by.id}`, subjects: [by.id] });
      conversationReturnSkip(rt, ex, intent, 'newer-directive');
    }
  },
  validateSnapshot(rt, ex, self) {
    const bad = (): Diagnostic => ({ code: 'snapshot.converse-return-invalid', message: `conversation ${self.id} has invalid member return provenance`, subjects: [self.id] });
    if (!Array.isArray(ex.actors) || !Array.isArray(ex.circle?.moves) || (ex.departures !== undefined && !Array.isArray(ex.departures)) || (ex.retired !== undefined && !Array.isArray(ex.retired))) return bad();
    const originals = (self.params as ConverseParams).actors, seen = new Set<string>();
    const partition = [...ex.actors, ...(ex.retired ?? []), ...(ex.departures ?? []).map((q) => q?.actor)];
    if (partition.length !== originals.length || new Set(partition).size !== partition.length || partition.some((a) => !originals.includes(a))) return bad();
    for (const q of ex.departures ?? []) {
      if (!q || typeof q !== 'object' || seen.has(q.actor) || !originals.includes(q.actor) || ex.actors.includes(q.actor)) return bad();
      const station = ex.circle.moves.find((m) => m.actor === q.actor), directive = rt.records.get(q.directive);
      if (!station || !q.station || JSON.stringify(station) !== JSON.stringify(q.station) || !directive || directive.parent || q.directive === ex.id) return bad();
      if (q.child) {
        const child = rt.records.get(q.child), p = child?.params as { actor?: string; x?: number; z?: number; level?: number; face?: number } | undefined;
        if (!child || child.parent !== ex.id || child.verb !== 'walk_to' || p?.actor !== q.actor || p.x !== station.p[0] || p.z !== station.p[1] || p.level !== station.level || p.face !== station.yaw) return bad();
      }
      seen.add(q.actor);
    }
    return null;
  },
  // Two-person or not-yet-formed conversations still cancel as a unit.
  yieldTo: (_rt, self, holder, _a, by) => (directive(by) ? [self.phase === 'talking' && holder.id !== self.id ? holder.id : self.id] : []),
};

// ---------- gather / campfire_circle ----------

type GatherParams = { actors: string[]; region?: string; fixture?: string; activity?: (typeof ACTIVITIES)[number] };
type GatherProgram = { owner: string; pairs: { actor: string; slot: string }[]; left: string[]; activity?: string };
type GatherExec = { id: string; owner: string; kids: ActionRecord[] };

function planGather(rt: Runtime, p: GatherParams, kinds: SlotKind[] | null): { ok: true; program: GatherProgram } | { ok: false; diagnostic: Diagnostic } {
  const owner = (p.fixture ?? p.region)!;
  if (new Set(p.actors).size !== p.actors.length) return { ok: false, diagnostic: { code: 'action.invalid-params', message: `the actor list names someone twice: ${p.actors.join(', ')}`, subjects: p.actors } };
  for (const id of p.actors) {
    const a = readyActor(rt, id);
    if ('code' in a) return { ok: false, diagnostic: a };
    const b = busy(rt, id);
    if (b) return { ok: false, diagnostic: b };
  }
  const all = slotsOf(rt, owner);
  if (!Array.isArray(all)) return { ok: false, diagnostic: all };
  const members = new Set(p.actors);
  const free = all.filter((s) => (!kinds || kinds.includes(s.kind)) && isFree(rt.world, s, members));
  const { pairs, left } = assignNearest(rt.world, p.actors, free);
  if (!pairs.length) return { ok: false, diagnostic: { code: 'slot.none-free', message: `no free slot at ${owner} for ${p.actors.join(', ')} (all ${all.length} taken)`, subjects: [owner, ...p.actors] } };
  return { ok: true, program: { owner, pairs: pairs.map((q) => ({ actor: q.actor, slot: q.slot.id })), left, activity: p.activity } };
}

/**
 * Each assigned person gets a child take_slot (which holds their actor + slot claims). People left
 * over also get one, against the owner: it fails `slot.none-free` naming the fixture/region, so
 * the director sees exactly who found no place. The gather ends when all its children have.
 */
function startGather(rt: Runtime, prog: GatherProgram, id: string): GatherExec {
  const kids: ActionRecord[] = [];
  for (const q of prog.pairs) kids.push(rt.submit('take_slot', { actor: q.actor, slot: q.slot, activity: prog.activity }, { parent: id }));
  for (const a of prog.left) kids.push(rt.submit('take_slot', { actor: a, owner: prog.owner, activity: prog.activity }, { parent: id }));
  return { id, owner: prog.owner, kids };
}

function stepGather(_rt: Runtime, ex: GatherExec): StepResult {
  const live = ex.kids.filter((k) => k.status !== 'completed' && k.status !== 'failed' && k.status !== 'cancelled');
  if (!live.length)
    return {
      status: 'completed',
      outputs: {
        seated: ex.kids.filter((k) => k.history.some((h) => h.phase === 'occupied')).map((k) => (k.params as SlotParams).actor),
        unseated: ex.kids.filter((k) => k.status === 'failed').map((k) => ({ actor: (k.params as SlotParams).actor, code: k.diagnostic?.code, message: k.diagnostic?.message })),
      },
    };
  return { status: 'running', phase: live.some((k) => k.phase !== 'occupied') ? 'gathering' : 'gathered' };
}

const actorsSchema = z.array(id80).min(1).max(40);

export const gather: ActionDef<GatherParams, GatherProgram, GatherExec> = {
  verb: 'gather',
  description: 'Send people to free slots of a fixture (bench, campfire) or a place region with an audience layout; deterministic nearest-first assignment. Each person holds their slot (child take_slot) until cancelled or `stand`; people left without a slot fail slot.none-free naming the fixture/region.',
  schema: z.strictObject({ actors: actorsSchema, region: id80.optional(), fixture: id80.optional(), activity: activity.optional() }).refine(oneOf(['region', 'fixture']), 'give exactly one of region, fixture'),
  reservations: () => [], // claims are held by the child take_slot actions
  plan: (rt, p) => planGather(rt, p, null),
  start: (rt, _p, prog, id) => startGather(rt, prog, id),
  step: stepGather,
  cancel: () => ({ ok: true }), // the runtime cancels live children (take_slot → people idle in place)
  yieldTo: (_rt, _self, holder, _a, by) => (directive(by) ? [holder.id] : []), // (members' take_slot children answer first: only that member leaves)
};

export const campfireCircle: ActionDef<{ actors: string[]; fire: string }, GatherProgram, GatherExec> = {
  verb: 'campfire_circle',
  description: 'Gather people around a campfire fixture: each takes a free fire-circle place (1.6 m from the fire, facing it) and warms themselves until cancelled; extra people fail slot.none-free naming the fire.',
  schema: z.strictObject({ actors: actorsSchema, fire: id80 }),
  reservations: () => [],
  plan(rt, p) {
    const f = rt.world.entities[p.fire];
    const all = f ? slotsOf(rt, p.fire) : null;
    if (!f || !Array.isArray(all) || !all.some((s) => s.kind === 'fire-circle'))
      return { ok: false, diagnostic: { code: 'campfire.not-a-fire', message: f ? `${p.fire} (${f.def}) has no fire-circle places` : `no campfire "${p.fire}"`, subjects: [p.fire] } };
    return planGather(rt, { actors: p.actors, fixture: p.fire, activity: 'warm' }, ['fire-circle']);
  },
  start: (rt, _p, prog, id) => startGather(rt, prog, id),
  step: stepGather,
  cancel: () => ({ ok: true }),
  yieldTo: (_rt, _self, holder, _a, by) => (directive(by) ? [holder.id] : []),
};

// ---------- pre-emption helpers (director side) ----------

/**
 * Autonomous nudges are not directives: a walk.ts make-way walk (`<person>:make-way:<tick>`, the
 * sequence runner's MAKE_WAY) never pre-empts a social hold — it is refused as before.
 */
const AUTONOMOUS = /:make-way:\d+$/;
const directive = (by: ActionRecord) => !AUTONOMOUS.test(by.id);

export const SOCIAL_VERBS: ReadonlySet<string> = new Set(['sit', 'take_slot', 'stand', 'face', 'converse', 'gather', 'campfire_circle', 'ambient_wander']);

/** The social action that currently owns `actor` (nearest social ancestor of an `actor:` holder), if any. */
export function socialHolder(rt: Runtime, actor: string): ActionRecord | undefined {
  for (const h of rt.holder(`actor:${actor}`)) {
    for (let r = rt.records.get(h); r; r = r.parent ? rt.records.get(r.parent) : undefined) if (SOCIAL_VERBS.has(r.verb)) return r;
  }
  return undefined;
}

/**
 * Free `actor` for a directed task (spec §17). Cancels the smallest social unit holding them: their
 * own sit/take_slot (other gather members stay), their current ambient walk (ambient_wander then
 * releases them for good), or the whole converse / face. Never touches non-social holders (a carry
 * or raise must be finished or cancelled by the director on its own terms). Returns cancelled ids.
 */
export function releaseForDirective(rt: Runtime, actor: string, reason?: Diagnostic): string[] {
  const out: string[] = [];
  for (const h of rt.holder(`actor:${actor}`)) {
    const rec = rt.records.get(h)!;
    const parent = rec.parent ? rt.records.get(rec.parent) : undefined;
    const target = rec.verb === 'walk_to' && parent?.verb === 'ambient_wander' ? rec : socialHolder(rt, actor);
    if (!target || !rt.isActive(target.id) || out.includes(target.id)) continue;
    rt.cancel(target.id, reason);
    out.push(target.id);
  }
  return out;
}

export const SOCIAL_ACTIONS: ActionDef[] = [sit, takeSlot, stand, face, converse, gather, campfireCircle, ambientWander];
