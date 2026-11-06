// A Take is what actually happened during one execution (spec §21–23):
// resolved motion + discrete state changes + runtime events + the final state.
// Replay reads only this — never the planner, registry or a Runtime.
// Camera tracks are separate objects that point at a take; they are not part
// of the take body, so attaching/editing them can never change the take hash.
import type { Entity, WorldState } from '../world/types.ts';

/**
 * /2 (2026-09-28, W10): changes also carry hands (integer mm), baseActivity, on, speed (integer cm/s), contents.
 * /3 (2026-09-28, W20): `hands` and `speed` changes are thinned keyframes (INTERP_FIELDS), linearly interpolated
 * between consecutive keyframes of the same entity (TAKES_AND_PLANS.md "Thinned fields"); every other field is
 * still a step (last value ≤ t). A /2 reader sees the same shapes, but holds each keyframe instead of interpolating.
 * /4 (2026-09-28, W22): `entities0` (every tracked entity as first recorded: def, kind, pose, phase / support, contents …
 * minus provenance / label / tags) and `removed` ([{ id, t }]), so an entity removed before the end (an emptied pile) is
 * drawable; pose tracks simplified at TRACK_TOL (4 mm / 8 mrad instead of 1 / 1; holds exact at both ends); `events` compacted (`compactEvents`):
 * a same-tick requested → validated → reserved → … lifecycle run is one event with `from: 'requested'` (lossless,
 * `expandEvents`), and a repeated blocked wait (same action, code, message) is one event at its first tick with `n` and
 * `until` (its last tick; the resumes in between are dropped). TAKES_AND_PLANS.md "Compact tracks, events and entities0".
 */
export const TAKE_SCHEMA = 'mars-take/4';

/** Quantised pose sample: [tick, x mm, y mm, z mm, yaw mrad] or + [pitch mrad, roll mrad] when non-zero. */
export type PoseSample = number[];

/** A `hands` change value: the engine's human.hands in integer millimetres (a missing hand is free / at rest). A keyframe
 *  since mars-take/3 (INTERP_FIELDS). */
export type TakeHands = { left?: [number, number, number]; right?: [number, number, number] };

/**
 * Discrete state change: [tick, entityId, field, value]. Fields: present, activity, level, task, grip, phase,
 * support, reservedBy, connections, equipment, paint; since mars-take/2 also hands (TakeHands, mm), baseActivity,
 * on, speed (cm/s), contents; since W32 (still mars-take/4, additive: absent unless a prone receiver lies down) proneYaw
 * (integer mrad, the lying body's world heading) and phaseK (integer %, progress within the prone hand-up phase).
 * Since core-next4 (still mars-take/4, additive: absent unless set) prop (activities/1: book, cup, flower…), seatHeight (m)
 * and partner (together/1: the other body of a paired gesture). Since core-next5 (still additive): together (group, phase,
 * until), instrument (play-music) and game (choreographed games: turn, thrower, catcher, throw/land ticks, petanque jack/boules).
 * Since attention/1 (still mars-take/4, additive) gaze:
 * {kind: look|turn|auto|face, target?: entity id, at?: [x, z], until?: tick}, a Soul's own head direction (`attention`
 * carries the point the head turns to).
 * Additive sleepPose carries {mat, standingFraction}: exact semantic lie/wake state,
 * without rig coordinates. It is absent in older takes and remains discrete per tick.
 * A null value = the field was cleared.
 * attention/1 (still mars-take/4, additive): gaze {kind: look|turn|auto|face, target?: entity id, at?: [x, z], until?: tick},
 * a Soul's own head direction; `attention` carries the point the head turns to.
 */
export type ChangeEvent = [number, string, string, unknown];

/** Runtime event with tick relative to the take start (action lifecycle, violation, mark). */
export type TakeEvent =
  | {
      t: number; type: 'action'; id: string; verb: string; status: string; phase?: string; code?: string; message?: string;
      /** mars-take/4: this event stands for the same-tick lifecycle run from `from` up to `status` (LIFECYCLE order). */
      from?: string;
      /** mars-take/4, `blocked` only: the number of identical waits merged into this event (≥ 2) and the last one's tick. */
      n?: number;
      until?: number;
    }
  | { t: number; type: 'violation'; code: string; message: string; subjects?: string[] }
  | { t: number; type: 'mark'; name: string; data?: unknown };

export type Take = {
  schema: typeof TAKE_SCHEMA;
  /** Optional public render-base content address, bound before recording.
   * Not a physical topology/asset-availability or installation guarantee. */
  renderSceneRef?: {contract:'render-scene-ref/1';rulesVersion:string;hash:string};
  /** Content address: hash of every other field. */
  id: string;
  planHash?: string;
  baselineCheckpoint?: string;
  baselineStateHash: string;
  rulesVersion: string;
  dt: number;
  /** Absolute world tick at which the take starts; all t / sample ticks are relative to it. */
  startTick: number;
  ticks: number;
  keyframeEvery: number;
  /** Per-entity pose samples, stored only on change, simplified within 1 quantum. */
  tracks: Record<string, PoseSample[]>;
  changes: ChangeEvent[];
  events: TakeEvent[];
  finalStateHash: string;
  finalState: WorldState;
  /** mars-take/4: every tracked entity as first recorded (tick of its first `present: true`), minus provenance / label /
   *  tags. The replay draws an entity from it when the final state no longer has it. Absent in older takes. */
  entities0?: Record<string, TakeEntity0>;
  /** Display-only metadata on slim live chunks: grip geometry for recorded
   * world transports, never the omitted multi-megabyte static physics. */
  fixtureCarryHandlingV1?: Record<string, import('../world/catalog.ts').Handling>;
  /** PC03 (#682), additive: the adapted asset of each recorded loose-material transport (a library def the viewer's
   *  native catalog does not know), so the live view can pose its carriers. Live chunks only; absent otherwise. */
  transportAssetsV1?: Record<string, import('../world/catalog.ts').AssetDef>;
  /** mars-take/4: entities removed during the take and the tick (the `present: false` change), in tick order. */
  removed?: { id: string; t: number }[];
};

/** An entity as the take first saw it (`Take.entities0`). */
export type TakeEntity0 = Omit<Entity, 'provenance' | 'label' | 'tags'>;

/** The action lifecycle up to `executing` (runtime/runtime.ts); `compactEvents` folds a same-tick run of it. */
export const LIFECYCLE = ['requested', 'validated', 'reserved', 'executing'] as const;

/** Minimal attachment type; the camera module (engine/camera) owns `data`'s shape. */
export type CameraTrack = { id: string; takeId: string; kind: string; data: unknown };

export const POS_Q = 1000; // samples are integer millimetres
export const ANG_Q = 1000; // and integer milliradians
export const SPEED_Q = 100; // a `speed` change is integer cm/s (mm/s changed almost every walking tick: +128 KB on v3)
/**
 * mars-take/4 pose-track tolerance (quanta): position 4 mm per axis, angles 8 mrad, so the replay error (tol + ½ quantum)
 * is ≤ 4.5 mm / 8.5 mrad — inside 5 mm / 0.5°. (5 mm also fits the bound in spirit but flips a marginal start-heading
 * search of a directed orbit in camera-direct.test.ts; 1–4 mm keep it. TAKES_AND_PLANS.md.)
 */
export const TRACK_TOL = { pos: 4, ang: 8 } as const;

/**
 * mars-take/3 thinned change fields and their recording tolerance (quanta: mm per hand point, Euclidean; cm/s).
 * Their changes are keyframes: between two consecutive keyframes of one entity that are both non-null and of the
 * same shape (the same hands present) the value is linear in the tick; otherwise it holds until the next keyframe.
 * null (hands free / not walking) and shape changes are exact at their tick. TakeRecorder keeps a keyframe only
 * where that interpolation would miss a recorded tick by more than the tolerance (`thinChanges`).
 */
export const INTERP_FIELDS: Record<string, number> = { hands: 5, speed: 1 };
