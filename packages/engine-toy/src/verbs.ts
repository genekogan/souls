// Toy verbs. Same ActionDef contract as Mars verbs; trivially simple bodies.
// Coarse kinematics only: straight timed paths, no avoidance (clients may polish).
import { z } from 'zod';
import {
  DT, nextFloat, samplePath, timedPath,
  type ActionDef, type Diagnostic, type Entity, type PathCommit, type PoseSample, type Runtime, type WorldState,
} from '@souls/engine-contract';
import { HALF, WALK_SPEED_MM_S } from './world.ts';

const TPS = Math.round(1 / DT);
export const secs = (s: number) => Math.round(s * TPS);

export type ToyServices = {
  emitPath(p: PathCommit): void;
  change(entity: string, field: string, value: unknown): void;
};
const svc = (rt: Runtime) => rt.services as ToyServices;

export const mmOf = (e: Entity): [number, number] => [Math.round(e.pose.p[0] * 1000), Math.round(e.pose.p[2] * 1000)];
export const distMm = (a: [number, number], b: [number, number]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
const clampMm = (v: number) => Math.max(-HALF * 1000, Math.min(HALF * 1000, v));
const diag = (code: string, message: string, subjects?: string[]): Diagnostic => ({ code, message, subjects });

function human(w: WorldState, id: string): Entity | null {
  const e = w.entities[id];
  return e && e.kind === 'human' && e.human ? e : null;
}
function setActivity(rt: Runtime, e: Entity, activity: string) {
  if (e.human!.activity === activity) return;
  e.human!.activity = activity;
  svc(rt).change(e.id, 'activity', activity);
}
function setOn(rt: Runtime, e: Entity, on: string | undefined) {
  if (e.human!.on === on) return;
  if (on === undefined) delete e.human!.on; else e.human!.on = on;
  svc(rt).change(e.id, 'on', on ?? null);
}
function setPose(e: Entity, s: PoseSample) {
  e.pose.p = [s[1] / 1000, 0, s[3] / 1000];
  e.pose.yaw = s[4] / 1000;
}
export const occupancy = (w: WorldState, fixture: string) => Object.values(w.entities).filter((e) => e.human?.on === fixture).length;
const actorRes = (actor: string) => [{ resource: `actor:${actor}`, mode: 'exclusive' as const }];

/** Emit a path that ends where the actor is now, so clients stop it. */
function emitStop(rt: Runtime, e: Entity, actionId: string) {
  const [x, z] = mmOf(e);
  svc(rt).emitPath({ entity: e.id, startTick: rt.tick, speed: 0, waypoints: [[rt.tick, x, 0, z, Math.round(e.pose.yaw * 1000)]], activity: e.human!.activity, actionId });
}

// ---------------------------------------------------------------- walk_to
const walkSchema = z.strictObject({
  actor: z.string(),
  to: z.union([z.string(), z.tuple([z.number(), z.number()])]),
  standoff: z.number().min(0).max(10).optional(),
});
type WalkParams = z.infer<typeof walkSchema>;
type WalkExec = { actor: string; samples: PoseSample[]; actionId: string };

function walkProgram(rt: Runtime, p: WalkParams): { ok: true; samples: PoseSample[] } | { ok: false; diagnostic: Diagnostic } {
  const a = human(rt.world, p.actor);
  if (!a) return { ok: false, diagnostic: diag('actor.unknown', `no human ${p.actor}`, [p.actor]) };
  let target: [number, number];
  let standoff = p.standoff ?? 0;
  if (typeof p.to === 'string') {
    const t = rt.world.entities[p.to];
    if (!t) return { ok: false, diagnostic: diag('target.unknown', `no entity ${p.to}`, [p.to]) };
    target = mmOf(t);
    standoff = p.standoff ?? 1.2;
  } else target = [Math.round(p.to[0] * 1000), Math.round(p.to[1] * 1000)];
  const from = mmOf(a);
  const d = distMm(from, target);
  const so = standoff * 1000;
  let end: [number, number] = target;
  if (so > 0) {
    if (d <= so) end = from;
    else { const f = (d - so) / d; end = [Math.round(from[0] + (target[0] - from[0]) * f), Math.round(from[1] + (target[1] - from[1]) * f)]; }
  }
  end = [clampMm(end[0]), clampMm(end[1])];
  return { ok: true, samples: timedPath([from, end], rt.tick, WALK_SPEED_MM_S, TPS) };
}

export const walkTo: ActionDef<WalkParams, PoseSample[], WalkExec> = {
  verb: 'walk_to',
  description: 'Walk an actor in a straight line to a point [x,z] (metres) or to an entity (stopping at a standoff distance).',
  schema: walkSchema,
  reservations: (_w, p) => actorRes(p.actor),
  plan(rt, p) { const r = walkProgram(rt, p); return r.ok ? { ok: true, program: r.samples } : r; },
  start(rt, p, samples, actionId) {
    const a = human(rt.world, p.actor)!;
    setOn(rt, a, undefined);
    setActivity(rt, a, 'walk');
    svc(rt).emitPath({ entity: p.actor, startTick: rt.tick, speed: WALK_SPEED_MM_S, waypoints: samples, activity: 'walk', actionId });
    return { actor: p.actor, samples, actionId };
  },
  step(rt, x) {
    const a = human(rt.world, x.actor);
    if (!a) return { status: 'failed', diagnostic: diag('actor.gone', `actor ${x.actor} removed`) };
    setPose(a, samplePath(x.samples, rt.tick));
    if (rt.tick >= x.samples[x.samples.length - 1][0]) { setActivity(rt, a, 'idle'); return { status: 'completed' }; }
    return { status: 'running', phase: 'walking' };
  },
  cancel(rt, x) { const a = human(rt.world, x.actor); if (a) { setActivity(rt, a, 'idle'); emitStop(rt, a, x.actionId); } return { ok: true }; },
  serializeExec: (x) => x,
  restoreExec: (_rt, _p, data) => data as WalkExec,
};

// ---------------------------------------------------------------- timed activities
type TimedExec = { actor: string; endTick: number; restore: string };
function timed<P extends { actor: string; seconds?: number }>(o: {
  verb: string; description: string; schema: z.ZodType<P>; activity: string; defaultSeconds: number;
  check?(rt: Runtime, p: P, a: Entity): Diagnostic | null;
  onStart?(rt: Runtime, p: P, a: Entity): void;
  restoreActivity?(a: Entity): string;
}): ActionDef<P, null, TimedExec> {
  return {
    verb: o.verb, description: o.description, schema: o.schema,
    reservations: (_w, p) => actorRes(p.actor),
    plan(rt, p) {
      const a = human(rt.world, p.actor);
      if (!a) return { ok: false, diagnostic: diag('actor.unknown', `no human ${p.actor}`, [p.actor]) };
      const d = o.check?.(rt, p, a);
      return d ? { ok: false, diagnostic: d } : { ok: true, program: null };
    },
    start(rt, p) {
      const a = human(rt.world, p.actor)!;
      o.onStart?.(rt, p, a);
      setActivity(rt, a, o.activity);
      return { actor: p.actor, endTick: rt.tick + secs(p.seconds ?? o.defaultSeconds), restore: o.restoreActivity?.(a) ?? (a.human!.on ? 'sit' : 'idle') };
    },
    step(rt, x) {
      const a = human(rt.world, x.actor);
      if (!a) return { status: 'failed', diagnostic: diag('actor.gone', `actor ${x.actor} removed`) };
      if (rt.tick >= x.endTick) { setActivity(rt, a, a.human!.on ? 'sit' : 'idle'); return { status: 'completed' }; }
      return { status: 'running' };
    },
    cancel(rt, x) { const a = human(rt.world, x.actor); if (a) setActivity(rt, a, a.human!.on ? 'sit' : 'idle'); return { ok: true }; },
    serializeExec: (x) => x,
    restoreExec: (_rt, _p, data) => data as TimedExec,
  };
}
const near = (rt: Runtime, a: Entity, otherId: string, metres: number): Diagnostic | null => {
  const t = rt.world.entities[otherId];
  if (!t) return diag('target.unknown', `no entity ${otherId}`, [otherId]);
  return distMm(mmOf(a), mmOf(t)) > metres * 1000 ? diag('target.too-far', `${a.id} is not within ${metres} m of ${otherId}`, [a.id, otherId]) : null;
};
const seconds = z.number().min(1).max(3600).optional();

export const sit = timed({
  verb: 'sit', description: 'Sit on a nearby fixture that has a free seat, for a number of seconds.',
  schema: z.strictObject({ actor: z.string(), on: z.string(), seconds }), activity: 'sit', defaultSeconds: 60,
  check(rt, p, a) {
    const f = rt.world.entities[p.on];
    if (!f || !f.seats) return diag('seat.none', `${p.on} has no seats`, [p.on]);
    if (a.human!.on !== p.on && occupancy(rt.world, p.on) >= f.seats) return diag('seat.full', `${p.on} is full`, [p.on]);
    return near(rt, a, p.on, 3.5);
  },
  onStart(rt, p, a) { setOn(rt, a, p.on); },
});
export const stand: ActionDef<{ actor: string }, null, { actor: string }> = {
  verb: 'stand', description: 'Stand up.', schema: z.strictObject({ actor: z.string() }),
  reservations: (_w, p) => actorRes(p.actor),
  plan(rt, p) { return human(rt.world, p.actor) ? { ok: true, program: null } : { ok: false, diagnostic: diag('actor.unknown', `no human ${p.actor}`) }; },
  start(rt, p) { const a = human(rt.world, p.actor)!; setOn(rt, a, undefined); setActivity(rt, a, 'idle'); return { actor: p.actor }; },
  step() { return { status: 'completed' }; },
  cancel() { return { ok: true }; },
  serializeExec: (x) => x, restoreExec: (_rt, _p, d) => d as { actor: string },
};
export const rest = timed({
  verb: 'rest', description: 'Rest in place (seated if already sitting) for a number of seconds.',
  schema: z.strictObject({ actor: z.string(), seconds }), activity: 'rest', defaultSeconds: 90,
});
export const converse = timed({
  verb: 'converse', description: 'Converse with a nearby human for a number of seconds.',
  schema: z.strictObject({ actor: z.string(), with: z.string(), seconds }), activity: 'converse', defaultSeconds: 45,
  check: (rt, p, a) => (human(rt.world, p.with) ? near(rt, a, p.with, 5) : diag('target.unknown', `no human ${p.with}`, [p.with])),
  onStart(rt, p) { rt.mark('converse', { a: p.actor, b: p.with }); },
});
export const gather = timed({
  verb: 'gather', description: 'Join a gathering at a fixture (for example the campfire) for a number of seconds.',
  schema: z.strictObject({ actor: z.string(), at: z.string(), seconds }), activity: 'gather', defaultSeconds: 120,
  check: (rt, p, a) => near(rt, a, p.at, 5),
  onStart(rt, p, a) { setOn(rt, a, p.at); },
});
export const wave = timed({
  verb: 'wave', description: 'Wave, optionally at someone.',
  schema: z.strictObject({ actor: z.string(), at: z.string().optional(), seconds }), activity: 'wave', defaultSeconds: 2,
  onStart(rt, p) { rt.mark('wave', { a: p.actor, at: p.at ?? null }); },
});
export const perform = timed({
  verb: 'perform', description: 'Perform (sing, dance, tell a story) where you stand for a number of seconds.',
  schema: z.strictObject({ actor: z.string(), what: z.enum(['sing', 'dance', 'story']).optional(), seconds }), activity: 'perform', defaultSeconds: 30,
  onStart(rt, p) { rt.mark('perform', { a: p.actor, what: p.what ?? 'sing' }); },
});

// ---------------------------------------------------------------- ambient_wander
const wanderSchema = z.strictObject({ actor: z.string(), seconds, radius: z.number().min(2).max(40).optional() });
type WanderExec = { actor: string; endTick: number; radius: number; samples: PoseSample[] | null; pauseUntil: number; actionId: string };
export const ambientWander: ActionDef<z.infer<typeof wanderSchema>, null, WanderExec> = {
  verb: 'ambient_wander', description: 'Drift around near the current position, pausing between short walks.',
  schema: wanderSchema,
  reservations: (_w, p) => actorRes(p.actor),
  plan(rt, p) { return human(rt.world, p.actor) ? { ok: true, program: null } : { ok: false, diagnostic: diag('actor.unknown', `no human ${p.actor}`) }; },
  start(rt, p, _prog, actionId) {
    const a = human(rt.world, p.actor)!; setOn(rt, a, undefined);
    return { actor: p.actor, endTick: rt.tick + secs(p.seconds ?? 60), radius: p.radius ?? 12, samples: null, pauseUntil: rt.tick, actionId };
  },
  step(rt, x) {
    const a = human(rt.world, x.actor);
    if (!a) return { status: 'failed', diagnostic: diag('actor.gone', `actor ${x.actor} removed`) };
    if (x.samples) {
      setPose(a, samplePath(x.samples, rt.tick));
      if (rt.tick >= x.samples[x.samples.length - 1][0]) {
        x.samples = null; setActivity(rt, a, 'idle');
        x.pauseUntil = rt.tick + secs(2 + nextFloat(rt.world.rng) * 5);
      }
      return { status: 'running', phase: 'walking' };
    }
    if (rt.tick >= x.endTick) return { status: 'completed' };
    if (rt.tick >= x.pauseUntil) {
      const from = mmOf(a);
      const r = x.radius * 1000;
      const to: [number, number] = [clampMm(Math.round(from[0] + (nextFloat(rt.world.rng) * 2 - 1) * r)), clampMm(Math.round(from[1] + (nextFloat(rt.world.rng) * 2 - 1) * r))];
      x.samples = timedPath([from, to], rt.tick, WALK_SPEED_MM_S * 0.7, TPS);
      setActivity(rt, a, 'walk');
      svc(rt).emitPath({ entity: x.actor, startTick: rt.tick, speed: WALK_SPEED_MM_S * 0.7, waypoints: x.samples, activity: 'walk', actionId: x.actionId });
    }
    return { status: 'running', phase: 'pausing' };
  },
  cancel(rt, x) { const a = human(rt.world, x.actor); if (a) { setActivity(rt, a, 'idle'); if (x.samples) emitStop(rt, a, x.actionId); } return { ok: true }; },
  serializeExec: (x) => x,
  restoreExec: (_rt, _p, d) => d as WanderExec,
};

export const PRIMITIVES: ActionDef[] = [walkTo, sit, stand, rest, converse, gather, wave, perform, ambientWander];

// ---------------------------------------------------------------- do_activity (a sequence of primitive steps)
const activitySchema = z.strictObject({
  actor: z.string(),
  label: z.string().max(200),
  option: z.string().max(100).optional(),
  steps: z.array(z.strictObject({ verb: z.string(), params: z.record(z.string(), z.unknown()) })).min(1).max(16),
});
type ActivityParams = z.infer<typeof activitySchema>;
type ActivityExec = { actor: string; i: number; child: unknown | null; started: boolean; actionId: string };

export function doActivity(prims: Map<string, ActionDef>): ActionDef<ActivityParams, null, ActivityExec> {
  const childOf = (p: ActivityParams, i: number) => prims.get(p.steps[i].verb)!;
  const startChild = (rt: Runtime, p: ActivityParams, x: ActivityExec): Diagnostic | null => {
    const def = childOf(p, x.i);
    const parsed = def.schema.safeParse({ ...p.steps[x.i].params, actor: p.actor });
    if (!parsed.success) return diag('params.invalid', `step ${x.i} (${def.verb}): ${parsed.error.message}`);
    const plan = def.plan(rt, parsed.data);
    if (!plan.ok) return plan.diagnostic;
    x.child = def.start(rt, parsed.data, plan.program, x.actionId);
    x.started = true;
    return null;
  };
  const setTask = (rt: Runtime, actor: string, task: string | undefined) => {
    const a = human(rt.world, actor); if (!a) return;
    if (task === undefined) delete a.human!.task; else a.human!.task = task;
    svc(rt).change(actor, 'task', task ?? null);
  };
  return {
    verb: 'do_activity',
    description: 'Run an activity: an ordered list of primitive steps for one actor. What the mid-brain submits.',
    schema: activitySchema,
    reservations: (_w, p) => actorRes(p.actor),
    plan(rt, p) {
      if (!human(rt.world, p.actor)) return { ok: false, diagnostic: diag('actor.unknown', `no human ${p.actor}`, [p.actor]) };
      for (const s of p.steps) if (!prims.has(s.verb)) return { ok: false, diagnostic: diag('action.unknown-verb', `unknown step verb ${s.verb}`) };
      return { ok: true, program: null };
    },
    start(rt, p, _prog, actionId) { setTask(rt, p.actor, actionId); svc(rt).change(p.actor, 'doing', p.label); return { actor: p.actor, i: 0, child: null, started: false, actionId }; },
    step(rt, x, dt) {
      const rec = rt.records.get(x.actionId)!;
      const p = rec.params as ActivityParams;
      for (let guard = 0; guard < 16; guard++) {
        if (!x.started) { const d = startChild(rt, p, x); if (d) { setTask(rt, x.actor, undefined); return { status: 'failed', diagnostic: d }; } }
        const r = childOf(p, x.i).step(rt, x.child, dt);
        if (r.status === 'running') return { status: 'running', phase: `${x.i}:${p.steps[x.i].verb}` };
        if (r.status !== 'completed') { setTask(rt, x.actor, undefined); return r; }
        x.i++; x.child = null; x.started = false;
        if (x.i >= p.steps.length) { setTask(rt, x.actor, undefined); return { status: 'completed' }; }
      }
      return { status: 'running' };
    },
    cancel(rt, x) {
      const rec = rt.records.get(x.actionId);
      if (rec && x.started) childOf(rec.params as ActivityParams, x.i).cancel(rt, x.child);
      setTask(rt, x.actor, undefined);
      return { ok: true };
    },
    serializeExec(x) {
      return x; // child execs are plain JSON in the toy engine
    },
    restoreExec: (_rt, _p, d) => d as ActivityExec,
  };
}
