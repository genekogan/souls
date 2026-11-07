// Action contract (spec §13). Every verb is typed, validated against a specific
// world state, reserves resources, then advances on the fixed-step runtime.
// Natural language never reaches this layer.
import type { z } from 'zod';
import type { WorldState } from '../world/types.ts';
import type { Runtime } from '../runtime/runtime.ts';

export type ActionStatus =
  | 'requested'
  | 'validated'
  | 'reserved'
  | 'executing'
  | 'completed'
  | 'blocked' // cannot presently continue; state remains valid; will retry
  | 'paused'
  | 'failed'
  | 'cancelled';

export const TERMINAL: ReadonlySet<ActionStatus> = new Set(['completed', 'failed', 'cancelled']);

/** Machine-readable failure. `message` must name the concrete objects/geometry involved. */
export type Diagnostic = {
  code: string; // e.g. 'route.blocked', 'carry.clearance', 'support.release-premature'
  message: string;
  subjects?: string[]; // entity/actor ids involved
  at?: [number, number, number]; // world location of the conflict
  details?: Record<string, unknown>;
};

export type Reservation = { resource: string; mode: 'exclusive' | 'shared' };

export type StepResult =
  | { status: 'running'; phase?: string }
  | { status: 'completed'; outputs?: Record<string, unknown> }
  | { status: 'blocked'; diagnostic: Diagnostic }
  | { status: 'failed'; diagnostic: Diagnostic };

export type PlanResult<Program> = { ok: true; program: Program; notes?: string[] } | { ok: false; diagnostic: Diagnostic };

/**
 * `deferred`: the action accepted the cancel but needs more ticks to reach a
 * safe stop (e.g. a controlled set-down); it keeps stepping and its eventual
 * `completed` is recorded as `cancelled`.
 */
export type CancelResult = { ok: true; deferred?: boolean } | { ok: false; diagnostic: Diagnostic };

/** A bounded recovery attempt; unavailable is explicit and is never counted as a planner retry. */
export type WaitRecoveryResult = { status: 'attempted' | 'unavailable' | 'deferred'; diagnostic: Diagnostic };

export interface ActionDef<Params = unknown, Program = unknown, Exec = unknown> {
  verb: string;
  description: string;
  schema: z.ZodType<Params>;
  /** Whether reserved hand resources drive hand poses. Defaults true; composites may reserve only, and transfers may drive only selected published phases. */
  drivesReservedHands?: boolean | ((record: ActionRecord) => boolean);
  /** Its `step` moves only its own actor's body and never changes a static entity (an obstacle, a construction phase, a
   *  support or connection): the runtime lets the walk planner skip its static-world scan meanwhile (spatial/nav-trust.ts). */
  navPure?: boolean;
  /** Resources required (actors, entities, interaction slots, work zones). */
  reservations(world: WorldState, params: Params): Reservation[];
  /** Validate + plan against the current world. Pure w.r.t. world. */
  plan(rt: Runtime, params: Params): PlanResult<Program>;
  /** Initialise execution state. Called once after reservations succeed. */
  start(rt: Runtime, params: Params, program: Program, actionId: string): Exec;
  /** Advance one fixed tick. May mutate rt.world only through the action's reserved entities. */
  step(rt: Runtime, exec: Exec, dt: number): StepResult;
  /**
   * Bring the action to an allowed stop state. Must refuse (not silently drop)
   * when stopping would leave an unsupported load (spec §13 `cancelled`).
   */
  cancel(rt: Runtime, exec: Exec): CancelResult;
  /** The world refused this tick's move (#1150): its entities are back where the tick found them, and `cancel` follows.
   *  An action that keeps its own position rewinds it here, so its cleanup starts from the pose the world kept. */
  refused?(rt: Runtime, exec: Exec): void;
  /** Retry this specific mover through the action's existing validated planner; never force release or teleport. */
  recoverWait?(rt: Runtime, exec: Exec, mover: string): WaitRecoveryResult;
  /** Certify that every internal mover is quiescent; unknown actions cannot end a sequence early. */
  waitQuiescent?(rt: Runtime, exec: Exec, exhaustedMovers: ReadonlySet<string>): boolean;
  /**
   * Pre-emptible hold (spec §17, SOCIAL.md "Pre-emption"); set by the social verbs. A *directed*
   * submission (neither its verb nor any ancestor has this hook, and `preempt` is not false) that
   * needs `actor:<actor>` held by `holder` — this action (`self`, the nearest ancestor of `holder`
   * with the hook) or a descendant of it — asks here which action ids to cancel to free the actor;
   * the runtime cancels them with reason `pre-empted by <id>` and starts the directive once they
   * have ended. `by` is the directive's record. Return [] to refuse (the directive then fails
   * reservation.conflict as before).
   */
  yieldTo?(rt: Runtime, self: ActionRecord, holder: ActionRecord, actor: string, by: ActionRecord): string[];
  /** Pure preview and commit for releasing members while retaining a social group. */
  canYieldMembers?(rt: Runtime, exec: Exec, actors: string[], by: ActionRecord): boolean;
  releaseMembers?(rt: Runtime, exec: Exec, actors: string[], by: ActionRecord): void;
  /** New explicit instructions supersede voluntary group returns; ancestors identify original child work. */
  onDirective?(rt: Runtime, exec: Exec, by: ActionRecord, claims: Reservation[], ancestors: string[]): void;
  /** Validate optional action-owned snapshot queues without changing the default graph format. */
  validateSnapshot?(rt: Runtime, exec: Exec, self: ActionRecord): Diagnostic | null;
  /** Plain-data voluntary return after a successful directive. Normal admission may refuse it. */
  resumeIntent?(rt: Runtime, exec: Exec, self: ActionRecord): { actor: string; verb: string; params: unknown } | null;
  /**
   * Resumable snapshots (runtime/snapshot.ts, spec §22). `true`: the exec is plain data (Maps, Sets,
   * aliasing and ActionRecord references are fine; closures and class instances are not) and resumes
   * tick-exact with the default graph codec. A string: why this action refuses to be snapshotted.
   * Unset: runtime/snapshot.ts RESUMABLE_VERBS / NON_RESUMABLE decide.
   */
  resumable?: true | string;
  /** Custom exec serialisation (e.g. an exec holding a class instance); must return codec-encodable data. */
  serializeExec?(rt: Runtime, exec: Exec): unknown;
  /** Inverse of serializeExec, called on the restored runtime after world, records and services are loaded. */
  restoreExec?(rt: Runtime, data: unknown): Exec;
}

export type ActionRecord = {
  /** An automatic locomotion accommodation, never an independent owner directive. */
  internalCause?: 'traffic.make-way';
  id: string;
  verb: string;
  params: unknown;
  status: ActionStatus;
  phase?: string;
  diagnostic?: Diagnostic;
  history: { tick: number; status: ActionStatus; phase?: string; code?: string }[];
  requestedTick: number;
  endedTick?: number;
  /** Parent action for hierarchical tasks (children may use the parent's reservations). */
  parent?: string;
  outputs?: Record<string, unknown>;
};
