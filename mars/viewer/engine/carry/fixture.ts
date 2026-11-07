import { z } from 'zod';
import type {
  ActionDef,
  ActionStatus,
  Diagnostic,
  Reservation,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { heldBy } from '../items/model.ts';
import { entityFrame, carrierSpots, laidPose } from './formation.ts';
import { fixtureSlots, occupantOf } from '../social/slots.ts';
import { carry, carryBystanderAt, type CarryExec } from './actions.ts';
import {
  laidIssue,
  planCarryAction,
  type CarryParams,
  type CarryProgram,
} from './validate.ts';
export interface MoveFixtureParams {
  actor: string;
  fixture: string;
  helpers?: string[];
  to: { x: number; z: number; yaw: number };
}
export interface FixtureMoveReadout {
  action: string;
  actor: string;
  crew: string[];
  fixture: string;
  status: ActionStatus;
  phase: string;
  destination: MoveFixtureParams['to'];
  held: boolean;
  stopping: boolean;
  waitingReason?: string;
  diagnostic?: Diagnostic;
}
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `move_fixture.${code}`, message, subjects });
const sourceBinding = (e: Entity) =>
  JSON.stringify({
    def: e.def,
    pose: e.pose,
    phase: e.phase,
    support: e.support,
    connections: e.connections ?? [],
    contents: e.contents,
  });
const crewFor = (p: MoveFixtureParams) => [p.actor, ...(p.helpers ?? [])];
const paramsFor = (p: MoveFixtureParams): CarryParams => ({
  crew: crewFor(p),
  item: p.fixture,
  to: p.to,
});
function fixtureIssue(
  rt: Runtime,
  fixture: string,
  except = new Set<string>(),
): Diagnostic | null {
  const e = rt.world.entities[fixture];
  if (!e)
    return diag('missing', `fixture ${fixture} does not exist`, [fixture]);
  if (e.kind !== 'fixture' || !CATALOG[e.def]?.capabilities?.fixtureCarry)
    return diag(
      'unsupported',
      `${fixture} (${e.def}) is not a supported upright movable fixture`,
      [fixture],
    );
  if (
    e.support?.kind !== 'ground' ||
    (e.phase && !['stored', 'staged', 'placed'].includes(e.phase)) ||
    Math.abs(e.pose.p[1]) > 0.01 ||
    e.pose.pitch ||
    e.pose.roll
  )
    return diag(
      'not-grounded',
      `${fixture} must rest upright on level-zero ground before moving`,
      [fixture],
    );
  if (
    e.connections?.length ||
    Object.values(rt.world.entities).some((other) =>
      other.connections?.some((c) => c.to === fixture),
    )
  )
    return diag('connected', `${fixture} is connected and cannot be moved`, [
      fixture,
    ]);
  if (e.contents && e.contents.fraction > 0)
    return diag(
      'contents',
      `${fixture} has stored contents that must be removed before moving`,
      [fixture],
    );
  const contents = Object.values(rt.world.entities).filter(
    (o) => o.support?.kind === 'resting-on' && o.support.on === fixture,
  );
  if (contents.length)
    return diag(
      'contents',
      `${fixture} supports ${contents.map((o) => o.id).join(', ')}; explicitly remove them first`,
      [fixture, ...contents.map((o) => o.id)],
    );
  for (const slot of fixtureSlots(rt, e)) {
    const occupant = occupantOf(rt.world, slot, except);
    if (occupant)
      return diag(
        'occupied',
        `${fixture} seat ${slot.id} is occupied or transitioning near ${occupant}`,
        [fixture, slot.id, occupant],
      );
  }
  return null;
}
/** Guard every lowering tick, including cancellation, without abandoning a held load on a timeout. */
function loweringIssue(
  rt: Runtime,
  ex: CarryExec,
  pose: Pose,
): Diagnostic | null {
  const fixture = rt.world.entities[ex.p.item],
    sp = rt.services.spatial;
  const frame = entityFrame({ ...fixture, pose }),
    q = frame.q;
  sp.sync(rt.world);
  const obstruction = laidIssue(
    sp,
    ex.p.f,
    q,
    ex.p.level,
    ex.p.levelY,
    ex.p.item,
    ex.p.crew,
  );
  if (obstruction)
    return diag(
      'lowering-blocked',
      `${ex.p.item} remains held: cannot lower onto current ground footprint because ${obstruction.reason}`,
      [ex.p.item, ...obstruction.subjects],
    );
  const person = carryBystanderAt(
    rt,
    ex,
    carrierSpots(ex.p.f, q, frame.halfW),
    frame,
  );
  return person
    ? diag(
        'lowering-occupied',
        `${ex.p.item} remains held: ${person} occupies its lowering footprint or carrier station`,
        [ex.p.item, person, ...ex.p.crew],
      )
    : null;
}
function claims(rt: Runtime, p: MoveFixtureParams): Reservation[] {
  const e = rt.world.entities[p.fixture];
  return [
    ...crewFor(p).flatMap((actor) => [
      { resource: `actor:${actor}`, mode: 'exclusive' as const },
      { resource: `hand:${actor}:left`, mode: 'exclusive' as const },
      { resource: `hand:${actor}:right`, mode: 'exclusive' as const },
    ]),
    { resource: `entity:${p.fixture}`, mode: 'exclusive' },
    ...(e
      ? (CATALOG[e.def]?.surfaceSlots ?? []).map((s) => ({
          resource: `surface-slot:${p.fixture}#${s.id}`,
          mode: 'exclusive' as const,
        }))
      : []),
    ...(e
      ? fixtureSlots(rt, e).map((s) => ({
          resource: `slot:${s.id}`,
          mode: 'exclusive' as const,
        }))
      : []),
  ];
}
export function readFixtureMove(
  rt: Runtime,
  action: string,
): FixtureMoveReadout | undefined {
  const record = rt.records.get(action);
  if (!record || record.verb !== 'move_fixture') return undefined;
  const p = record.params as MoveFixtureParams;
  if (!p?.actor || !p.fixture || !p.to) return undefined;
  const ex = (
      rt.services.carryExecs as Map<string, CarryExec> | undefined
    )?.get(action),
    terminal = !rt.isActive(action);
  return {
    action,
    actor: p.actor,
    crew: crewFor(p),
    fixture: p.fixture,
    status: record.status,
    phase: terminal
      ? record.status
      : (ex?.phase ?? record.phase ?? 'requested'),
    destination: { ...p.to },
    held: rt.world.entities[p.fixture]?.support?.kind === 'held',
    stopping: ex?.cancelling ?? false,
    waitingReason:
      record.diagnostic?.message ??
      (ex?.cancelling
        ? 'waiting for safe physical lowering and release'
        : record.status === 'blocked'
          ? 'waiting for clear pickup, route or set-down'
          : undefined),
    diagnostic: record.diagnostic,
  };
}
const id = z.string().min(1).max(80);
export const moveFixture: ActionDef<
  MoveFixtureParams,
  CarryProgram,
  CarryExec
> = {
  verb: 'move_fixture',
  description:
    'One or two free standing people physically move an empty unreserved capability-supported upright chair or table to explicit ground coordinates; no access links or implicit activity interruption.',
  schema: z.strictObject({
    actor: id,
    fixture: id,
    helpers: z.array(id).max(1).optional(),
    to: z.strictObject({
      x: z.number().min(-500).max(500),
      z: z.number().min(-500).max(500),
      yaw: z.number().min(-7).max(7),
    }),
  }),
  yieldTo: () => [],
  reservations: (world, p) => [
    ...crewFor(p).flatMap((actor) => [
      { resource: `actor:${actor}`, mode: 'exclusive' as const },
      { resource: `hand:${actor}:left`, mode: 'exclusive' as const },
      { resource: `hand:${actor}:right`, mode: 'exclusive' as const },
    ]),
    { resource: `entity:${p.fixture}`, mode: 'exclusive' },
    ...(CATALOG[world.entities[p.fixture]?.def]?.surfaceSlots ?? []).map(
      (s) => ({
        resource: `surface-slot:${p.fixture}#${s.id}`,
        mode: 'exclusive' as const,
      }),
    ),
    ...(CATALOG[world.entities[p.fixture]?.def]?.slots ?? []).map((s) => ({
      resource: `slot:${p.fixture}#${s.id}`,
      mode: 'exclusive' as const,
    })),
  ],
  plan(rt, p) {
    const crew = crewFor(p);
    if (new Set(crew).size !== crew.length)
      return {
        ok: false,
        diagnostic: diag(
          'duplicate-crew',
          'fixture carriers must be distinct people',
          crew,
        ),
      };
    for (const actor of crew) {
      const a = rt.world.entities[actor];
      if (!a?.human || a.kind !== 'human')
        return {
          ok: false,
          diagnostic: diag(
            'actor-invalid',
            `${actor} is missing or not a person`,
            [actor],
          ),
        };
      const grip = holdingDiagnostic(rt.world, actor);
      if (grip) return { ok: false, diagnostic: grip };
      const held = heldBy(rt.world, actor);
      if (held.length)
        return {
          ok: false,
          diagnostic: diag(
            'hands-full',
            `${actor} must explicitly stow ${held.map((h) => h.item.id).join(', ')} before moving ${p.fixture}`,
            [actor, p.fixture, ...held.map((h) => h.item.id)],
          ),
        };
      if (
        a.human.level !== 0 ||
        a.human.on ||
        Math.abs(a.pose.p[1]) > 0.01 ||
        !rt.services.spatial ||
        rt.services.spatial.base.links.some(
          (l: { usable: boolean }) => l.usable,
        )
      )
        return {
          ok: false,
          diagnostic: diag(
            'ground-scope',
            `${actor}/${p.fixture} movement supports level-zero rooms without usable access links`,
            [actor, p.fixture],
          ),
        };
      if (a.human.activity !== 'idle')
        return {
          ok: false,
          diagnostic: diag(
            'actor-busy',
            `${actor} must finish ${a.human.activity} before moving ${p.fixture}`,
            [actor, p.fixture],
          ),
        };
    }
    const issue = fixtureIssue(rt, p.fixture);
    if (issue) return { ok: false, diagnostic: issue };
    for (const r of claims(rt, p)) {
      const holders = rt.holder(r.resource);
      if (holders.length)
        return {
          ok: false,
          diagnostic: diag(
            'reserved',
            `${p.fixture} cannot move: ${r.resource} is held by ${holders.join(', ')}`,
            [p.actor, p.fixture, r.resource, ...holders],
          ),
        };
    }
    const planned = planCarryAction(rt, paramsFor(p), true);
    if (!planned.ok) return planned;
    planned.program.fixture = {
      restingPhase: rt.world.entities[p.fixture].phase,
      binding: sourceBinding(rt.world.entities[p.fixture]),
    };
    return planned;
  },
  start: (rt, p, program, action) =>
    carry.start(rt, paramsFor(p), program, action),
  step(rt, ex, dt) {
    if (ex.phase === 'gather') {
      const e = rt.world.entities[ex.p.item],
        issue = fixtureIssue(rt, ex.p.item, new Set(ex.p.crew));
      if (issue || !e || sourceBinding(e) !== ex.p.fixture!.binding) {
        carry.cancel(rt, ex);
        return {
          status: 'failed',
          diagnostic:
            issue ??
            diag(
              'source-changed',
              `${ex.p.item} changed while its carrier approached`,
              [ex.p.item, ...ex.p.crew],
            ),
        };
      }
    }
    if (ex.phase === 'set-down') {
      const issue = loweringIssue(rt, ex, ex.tr!.to);
      if (issue) return { status: 'blocked', diagnostic: issue };
    }
    const result = carry.step(rt, ex, dt);
    if (result.status === 'failed' && ex.phase === 'gather')
      carry.cancel(rt, ex);
    return result;
  },
  cancel(rt, ex) {
    const target =
      ex.phase === 'lift'
        ? ex.p.lying
        : ex.phase === 'move'
          ? laidPose(ex.p.f, ex.q, ex.p.levelY)
          : ex.phase === 'set-down'
            ? ex.tr!.to
            : undefined;
    if (target && ex.retreatTo === undefined) {   // #1150: a refused crew sets down where its backing ends, not here
      const issue = loweringIssue(rt, ex, target);
      if (issue) return { ok: false, diagnostic: issue };
    }
    return carry.cancel(rt, ex);
  },
  refused: (rt, ex) => carry.refused!(rt, ex),
  recoverWait: (rt, ex, mover) => carry.recoverWait!(rt, ex, mover),
  waitQuiescent: (rt, ex, movers) => carry.waitQuiescent!(rt, ex, movers),
  resumable:
    'active fixture movement holds a physical load and shared carry sub-walks; resumable fixture checkpoints are not yet verified',
};
export const FIXTURE_ACTIONS: ActionDef[] = [moveFixture];
