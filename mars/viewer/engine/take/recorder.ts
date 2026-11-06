// TakeRecorder: a RuntimeObserver that captures a compact Take.
// Pose tracks are quantised (1 mm / 1 mrad) and simplified online: a sample
// is dropped when linear interpolation (shortest-arc for angles, exactly as
// replay does it) between its neighbours reproduces every dropped sample within
// `tol` quanta. Static entities cost nothing after their first sample; a moving
// entity gets a forced keyframe at least every `keyframeEvery` ticks.
// mars-take/3: the `hands` / `speed` changes (INTERP_FIELDS) are thinned the same way when the take is finished
// (`thinChanges`): keyframes, linear in between, each recorded tick reproduced within the field's tolerance.
// mars-take/4: tracks at TRACK_TOL (4 mm / 8 mrad, position holds exact at both ends), `entities0` + `removed`, and
// `compactEvents` on finish.
import { hashOf, hashStable, hashStableResumable, sha256, stableStringify, type ResumeMark } from '../core/hash.ts';
import { DT, type Runtime, type RuntimeObserver } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { ANG_Q, INTERP_FIELDS, LIFECYCLE, POS_Q, SPEED_Q, TAKE_SCHEMA, TRACK_TOL, type ChangeEvent, type PoseSample, type Take, type TakeEntity0, type TakeEvent, type TakeHands } from './types.ts';
import { interpSample } from './replay.ts';
import { entityKeys, entityList, stableIndices } from '../world/entity-list.ts';

export type RecorderOptions = {
  renderSceneRef?: Take['renderSceneRef'];
  planHash?: string;
  baselineCheckpoint?: string;
  rulesVersion: string;
  keyframeEvery?: number;
  /** Pose-track simplification tolerance in quanta: a number for both (mm / mrad), or `{ pos, ang }` (default TRACK_TOL,
   *  4 mm / 8 mrad since mars-take/4). 0 keeps every changed sample. */
  tol?: number | { pos: number; ang: number };
  /** false keeps the raw runtime event stream (tests); default compacts it (`compactEvents`, mars-take/4). */
  compactEvents?: boolean;
  /** Tolerances of the thinned change fields (quanta; default INTERP_FIELDS: hands 5 mm, speed 1 cm/s). 0 = exact. */
  fieldTol?: Record<string, number>;
};

type TrackState = { committed: PoseSample; pending: PoseSample[]; out: PoseSample[] };

const q = (x: number, k: number) => Math.round(x * k) || 0;
const mm = (v: readonly number[]) => [q(v[0], POS_Q), q(v[1], POS_Q), q(v[2], POS_Q)];

/** Hand points quantised like pose tracks: integer millimetres, `{ left?: [x, y, z], right?: [x, y, z] }` (TakeHands). */
function takeHands(e: Entity): TakeHands | undefined {
  const h = e.human?.hands;
  if (!h || (!h.left && !h.right)) return undefined;
  return { ...(h.left ? { left: mm(h.left) } : {}), ...(h.right ? { right: mm(h.right) } : {}) } as TakeHands;
}

const FIELDS: [string, (e: Entity) => unknown][] = [
  ['bodyMotionV1', e => e.human?.bodyMotionV1],
  ['body', e => e.body], // BODY-v1: discrete admitted model/family swaps, never interpolated
  ['shore', e => e.human?.shore], // opt-in shore/1: discrete actual support/depth
  ['boat', e => e.boat],
  ['boatPassenger', e => e.human?.boatPassenger],
  ['boatTransit', e => e.human?.boatTransit],
  ['attention', e => e.human?.attention],
  ['activity', (e) => e.human?.activity],
  ['level', (e) => e.human?.level],
  ['task', (e) => e.human?.task],
  ['grip', (e) => e.human?.grip],
  ['carryContactV1', e => e.human?.carryContactV1],
  ['phase', (e) => e.phase],
  ['support', (e) => e.support],
  ['reservedBy', (e) => e.reservedBy],
  ['connections', (e) => e.connections],
  ['equipment', (e) => e.equipment], // construction/solar.ts place_equipment (kind + config)
  ['paint', (e) => e.paint], // work/paint.ts: colour / texture, coverage (0.01 steps), per band
  // mars-take/2 (BODY_MODEL.md "take fields"): what a replay needs to pose people exactly as the engine did
  ['handActuator', e=>e.human?.handActuator], // one finite native contact timeline; never controller context
  ['wateringV1', e=>e.human?.wateringV1],
  ['letGoV1', e=>e.human?.letGoV1], // Soul Actions 43: a let-go before a reach
  ['kiteV1', e=>e.human?.kiteV1], // #441: a kite flight; the kite and the hand are pure functions of it and the tick
  ['juggleV1', e=>e.human?.juggleV1], // #441: a juggling run; balls and hands are pure functions of it and the tick
  ['cupV1', e=>e.human?.cupV1], // Soul Actions 44: a mug drunk from or rinsed
  ['handTransferV1', e=>e.human?.handTransferV1], // Soul Actions 34: a handle-held item's reach / release timeline // Soul Actions 34: one finite watering-can stage; never controller context
  ['hands', takeHands], // human.hands, integer mm (hand-up, items, eating, paint)
  ['heldItemsV1', e => e.human?.heldItemsV1],
  ['itemTransferV1', e => e.human?.itemTransferV1],
  ['baseActivity', (e) => e.human?.baseActivity], // the activity an overlay (eat) is layered on: 'sit' = seated
  ['prop', (e) => e.human?.prop], // activities/1: the small object in the hands (book, cup, flower…; ACTIVITIES-v1)
  ['seatHeight', (e) => e.human?.seatHeight], // activities/1: seat top (m) at a scenery seat with no native fixture
  ['partner', (e) => e.human?.partner], // together/1: the other body of a paired gesture (hug, handshake, high-five, give/take, dance together)
  ['together', (e) => e.human?.together], // together/1: a grouped pose's shared group and end tick (animate cyclic poses in step)
  ['instrument', (e) => e.human?.instrument], // CN5: the instrument a play-music body plays (drums, guitar, violin…)
  ['game', (e) => e.human?.game], // CN5: a choreographed game's turn (who throws to whom, when; petanque jack and boules)
  ['handHold', (e) => e.human?.handHold], // entry 35: holding hands (partner, hand, offered/since/release ticks); never controller context
  ['rps', (e) => e.human?.rps], // entry 35: rock-paper-scissors shared start and shoot ticks; the shape only from the shoot
  ['gaze', (e) => e.human?.gaze], // attention/1: a Soul's own look/turn (head target and why); `attention` is the point
  ['on', (e) => e.human?.on], // the rack link (beam:… / climb:…) someone stands on
  ['speed', (e) => (e.human?.speed === undefined ? undefined : q(e.human.speed, SPEED_Q))], // integer cm/s (walk_to)
  ['sleepPose', (e) => e.human?.sleepPose], // additive semantic lie/wake state; renderer owns rig coordinates
  ['planting', e => e.planting],
  ['gardenCare', e => e.gardenCare],
  ['foodPreparation', e => e.foodPreparation],
  ['contents', (e) => e.contents], // bowl / pot / cup fill (items)
  ['proneYaw', (e) => (e.human?.proneYaw === undefined ? undefined : q(e.human.proneYaw, ANG_Q))], ['phaseK', (e) => (e.human?.phaseK === undefined ? undefined : q(e.human.phaseK, 100))], // prone receiver: lying heading (mrad), phase progress (%)
];

export function quantize(e: Entity, t: number): PoseSample {
  const s = [t, q(e.pose.p[0], POS_Q), q(e.pose.p[1], POS_Q), q(e.pose.p[2], POS_Q), q(e.pose.yaw, ANG_Q)];
  const pitch = q(e.pose.pitch ?? 0, ANG_Q), roll = q(e.pose.roll ?? 0, ANG_Q);
  if (pitch || roll) s.push(pitch, roll);
  return s;
}

const sameValues = (a: PoseSample, b: PoseSample) => a.length === b.length && a.every((v, i) => i === 0 || v === b[i]);
const samePos = (a: PoseSample, b: PoseSample) => a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// ---- S1 V7b (tranche 2026-10-19): idle cost of a big world's takes -------------------------------------------------
// Each tick samples only the entities the engine moves, sorted by id; the final state's copy of an entity (or of a world field) and that copy's stable text are kept per world and reused while the live value
// still equals the copy exactly. Takes stay byte-identical (test/take-golden.test.ts pins ids recorded before this).
// Shared copies are never mutated: a take's final state is read-only by contract (wire encoders, archives, replay).

/** True when `copy` is what structuredClone(live) would make of `live` now: plain objects with the same own enumerable keys
 *  in the same order, arrays of the same length and holes, primitives Object.is-equal (-0 and 0 differ). Anything else
 *  (Map, Date, typed arrays, class instances) answers false, so it is copied afresh. */
function sameCopy(live: unknown, copy: unknown): boolean {
  if (live === null || typeof live !== 'object') return Object.is(live, copy);
  if (copy === null || typeof copy !== 'object') return false;
  if (Array.isArray(live)) {
    if (!Array.isArray(copy) || live.length !== copy.length) return false;
    for (let i = 0; i < live.length; i++) {
      const has = i in live;
      if (has !== i in copy || (has && !sameCopy(live[i], copy[i]))) return false;
    }
    return Object.keys(live).length === live.length || sameKeys(live as unknown as Record<string, unknown>, copy as unknown as Record<string, unknown>);
  }
  const proto = Object.getPrototypeOf(live);
  if ((proto !== Object.prototype && proto !== null) || Object.getPrototypeOf(copy) !== Object.prototype) return false;
  return sameKeys(live as Record<string, unknown>, copy as Record<string, unknown>);
}
function sameKeys(live: Record<string, unknown>, copy: Record<string, unknown>): boolean {
  const a = Object.keys(live), b = Object.keys(copy);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] || !sameCopy(live[a[i]], copy[a[i]])) return false;
  return true;
}

type Kept = { copy: object; text: string };
/** Per world: the kept copies, the last entity table copy (reused whole while every entity is), the hash resume mark. */
type WorldCopies = { fields: Map<string, Kept>; entities: Map<string, Kept>; table?: { ids: string[]; out: object; text: string }; mark?: ResumeMark };
const COPIES = new WeakMap<object, WorldCopies>();
const flat = (text: string) => { text.charCodeAt(0); return text; };   // flatten the rope once (G1: re-walking cached ropes per hash)
const keep = (live: object, prev: Kept | undefined): Kept => {
  if (prev && sameCopy(live, prev.copy)) return prev;
  const copy = structuredClone(live);
  return { copy, text: flat(stableStringify(copy)) };
};

/** The take's final state: what `{ ...structuredClone(world without entityPhysicsV1), entityPhysicsV1 }` (or a plain
 *  structuredClone(world) without physics) was, same keys in the same order, with each unchanged entity and world field
 *  (and the whole entity table when every entity is unchanged) shared from the copy made for an earlier take; `known`
 *  holds every shared copy's stable text, and `hash` is the final state hash (the digest resumes after the leading
 *  unchanged fields: base, entities, entityPhysicsV1 on an idle god world). */
export function finalStateOf(world: Runtime['world']): { state: Runtime['world']; known: Map<object, string>; hash: string } {
  const w = world as unknown as Record<string, unknown>;
  const physics = w.entityPhysicsV1;
  const prev = COPIES.get(world), next: WorldCopies = { fields: new Map(), entities: new Map() };
  const known = new Map<object, string>(), state: Record<string, unknown> = {};
  for (const k of Object.keys(w)) {
    if (k === 'entityPhysicsV1' && physics !== undefined) continue;
    const v = w[k];
    if (k === 'entities' && v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const ents = v as Record<string, object>, ids = Object.keys(ents), was = prev?.table;
      let out: Record<string, unknown> = {}, same = !!was && was.ids.length === ids.length;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], e = ents[id];
        if (e === null || typeof e !== 'object') { out[id] = e; same = false; continue; }
        const before = prev?.entities.get(id), kept = keep(e, before);
        if (kept !== before || !was || was.ids[i] !== id) same = false;
        next.entities.set(id, kept); known.set(kept.copy, kept.text); out[id] = kept.copy;
      }
      if (same) next.table = was;
      else { const text = flat(stableStringify(out, known)); next.table = { ids, out, text }; }
      out = next.table!.out as Record<string, unknown>;
      known.set(out, next.table!.text);
      state[k] = out;
      continue;
    }
    if (v === null || typeof v !== 'object') { state[k] = v; continue; }
    const kept = keep(v, prev?.fields.get(k));
    next.fields.set(k, kept); known.set(kept.copy, kept.text); state[k] = kept.copy;
  }
  if (physics !== undefined) state.entityPhysicsV1 = physics;
  const { hash, mark } = hashStableResumable(state, known, prev?.mark);
  next.mark = mark;
  COPIES.set(world, next);
  return { state: state as unknown as Runtime['world'], known, hash };
}

/** Recording needs state and events, not the engine scheduler or its services. */
export type TakeSource = Pick<Runtime, 'world' | 'tick' | 'stateHash' | 'events' | 'observers'>;
export class TakeRecorder implements RuntimeObserver {
  readonly rt: TakeSource;
  readonly opts: Required<Pick<RecorderOptions, 'keyframeEvery'>> & RecorderOptions;
  private tol: { pos: number; ang: number };
  readonly startTick: number;
  readonly baselineStateHash: string;
  private tracks = new Map<string, TrackState>();
  private last = new Map<string, Map<string, string>>();
  private changes: ChangeEvent[] = [];
  private first = new Map<string, TakeEntity0>();
  private events: TakeEvent[] = [];
  private cursor: number;
  private finished = false;

  /** `stateHashNow`: the caller's rt.stateHash() at this tick when it has it already — the final state hash of the take it
   *  finished at this same tick, with nothing stepped or edited in between (lane L1: one world serialisation per take
   *  boundary instead of two). Omitted: computed here, as before. */
  constructor(rt: TakeSource, opts: RecorderOptions, stateHashNow?: string) {
    const ref=opts.renderSceneRef;
    if(ref && (ref.contract!=='render-scene-ref/1'||ref.rulesVersion!==opts.rulesVersion||!/^[a-f0-9]{64}$/.test(ref.hash)))
      throw new TypeError('invalid recorder render scene reference');
    this.rt = rt;
    this.opts = { ...opts, ...(ref?{renderSceneRef:structuredClone(ref)}:{}),keyframeEvery: opts.keyframeEvery ?? 20 };
    const tol = opts.tol ?? TRACK_TOL;
    this.tol = typeof tol === 'number' ? { pos: tol, ang: tol } : { pos: tol.pos, ang: tol.ang };
    this.startTick = rt.tick;
    this.baselineStateHash = stateHashNow ?? rt.stateHash();
    this.cursor = rt.events.length;
    this.sample();
    rt.observers.push(this);
  }

  onTick() {
    this.sample();
  }

  private readonly itemTracks = new Set<string>(); // finite recording chunk, never an accumulating world history

  private readonly transportTracks = new Set<string>();

  private sample() {
    const t = this.rt.tick - this.startTick;
    const ents = this.rt.world.entities;
    // entity-world fixtures/items (world-edit/1, lane L9) are drawn by the viewer's entity layer from the entity
    // world's own diffs. Explicitly opted-in transport loads need recorded poses too,
    // so the entity mesh and the gripping hands follow the same native clock.
    // S1 V7b: only those are sorted (by id, as the sorted id list was), from the tick's shared entity list.
    // S1 r2: found again from the last scan while the table holds the same objects under the same keys (stableIndices:
    // an entity's tags never change), so an idle world does not read ~4,500 entities' tags every tick (shared: read-only)
    const list = entityList(this.rt.world), keys = entityKeys(this.rt.world);
    const base = stableIndices(ents, 'take sample', list, keys, (e) => !e.tags?.includes('entity-world'), (idx) => idx.map((i) => keys[i]).sort()).derived;
    const eligible = stableIndices(ents, 'take presented items', list, keys, e => !!e.tags?.includes('entity-world-item-pose'), idx => new Set(idx.map(i => keys[i]))).derived;
    if (eligible.size) for (const id of base) {
      for (const item of Object.values(ents[id].human?.heldItemsV1 ?? {})) if (eligible.has(item)) this.itemTracks.add(item);
      // State-only projection starts before grasp; the recorder does not inspect
      // the scheduler and a live reparent cannot move the mesh early.
      const item=ents[id].human?.itemTransferV1?.item;
      if(item&&eligible.has(item))this.itemTracks.add(item);
    }
    const transports = stableIndices(ents, 'take transports', list, keys, e => !!e.tags?.includes('entity-world-transport'), idx => new Set(idx.map(i => keys[i]))).derived;
    if (transports.size) for (const id of base) {
      // Only bodies' active contacts select load tracks. A hundred unused chairs
      // add no per-tick pose/field samples or repeated live grip payloads.
      const h=ents[id].human;
      for (const load of [h?.grip?.entity,h?.carryContactV1?.item]) if (load && transports.has(load)) this.transportTracks.add(load);
    }
    const extra = [...this.itemTracks, ...this.transportTracks].filter(id => !!ents[id]);
    const dynamic = extra.length ? [...new Set([...base, ...extra])].sort() : base;
    for (const id of dynamic) {
      const e = ents[id];
      const s = quantize(e, t);
      const tr = this.tracks.get(id);
      if (!tr) this.tracks.set(id, { committed: s, pending: [], out: [s] });
      else this.push(tr, s);
      let prev = this.last.get(id);
      if (!prev) {
        prev = new Map();
        this.last.set(id, prev);
        this.changes.push([t, id, 'present', true]);
        const { provenance: _p, label: _l, tags: _t, ...e0 } = e;
        this.first.set(id, structuredClone({...e0,...(e.tags?.includes('entity-world-item-pose')?{tags:['entity-world','entity-world-item-pose']}: {})}));
      }
      for (const [f, get] of FIELDS) {
        const v = get(e);
        const k = v === undefined ? '' : stableStringify(v);
        if (prev.get(f) === k || (k === '' && !prev.has(f))) continue;
        prev.set(f, k);
        this.changes.push([t, id, f, v === undefined ? null : structuredClone(v)]);
      }
    }
    for (const id of [...this.last.keys()].sort())
      if (!ents[id]) {
        this.last.delete(id);
        const tr = this.tracks.get(id)!;
        this.flushTrack(tr);
        this.changes.push([t, id, 'present', false]);
      }
    for (; this.cursor < this.rt.events.length; this.cursor++) {
      const e = this.rt.events[this.cursor];
      const { tick, ...rest } = e;
      const ev = { t: tick - this.startTick, ...rest } as TakeEvent;
      if (ev.type === 'action' && ev.status !== 'failed' && ev.status !== 'blocked') delete ev.message;
      this.events.push(JSON.parse(JSON.stringify(ev)));
    }
  }

  private push(tr: TrackState, s: PoseSample) {
    // a re-sample within the same tick (finish() after cancellations) replaces that tick's sample
    if (tr.pending.length && tr.pending[tr.pending.length - 1][0] === s[0]) tr.pending.pop();
    else if (!tr.pending.length && tr.committed[0] === s[0]) {
      tr.out[tr.out.length - 1] = s;
      tr.committed = s;
      return;
    }
    const A = tr.committed;
    // static hold: nothing changed since the committed sample → remember only the latest hold point
    if (sameValues(s, A) && tr.pending.every((p) => sameValues(p, A))) {
      tr.pending = [s];
      return;
    }
    // mars-take/4: position holds are exact at both ends (a 4 mm line would otherwise smear a stop / a start into a slow
    // crawl over the neighbouring ticks, which the take stall metric counts; the angles may still turn during the hold).
    // Commit the arrival (the first still sample, when s stays where it is) and the departure (the last still sample,
    // when s moves off a hold that began at the committed sample). The line A → L was checked when L was pushed.
    const L = tr.pending[tr.pending.length - 1];
    if (L && (samePos(s, L) ? !samePos(L, A) : tr.pending.every((p) => samePos(p, A)))) {
      tr.out.push(L);
      tr.committed = L;
      tr.pending = [s];
      return;
    }
    const span = s[0] - A[0];
    const fits = span <= this.opts.keyframeEvery && tr.pending.every((p) => withinTol(interpSample(A, s, p[0]), p, this.tol));
    if (fits) {
      tr.pending.push(s);
      return;
    }
    const B = tr.pending[tr.pending.length - 1];
    if (B) {
      tr.out.push(B);
      tr.committed = B;
      tr.pending = [s];
    } else {
      tr.out.push(s);
      tr.committed = s;
      tr.pending = [];
    }
  }

  private flushTrack(tr: TrackState) {
    const B = tr.pending[tr.pending.length - 1];
    if (B && !sameValues(B, tr.committed)) {
      tr.out.push(B);
      tr.committed = B;
    }
    tr.pending = [];
  }

  /** Stop observing and produce the Take (content-addressed). */
  finish(): Take {
    if (this.finished) throw new Error('TakeRecorder.finish() called twice');
    this.finished = true;
    this.sample(); // catch events emitted after the last tick (e.g. cancellations)
    this.rt.observers = this.rt.observers.filter((o) => o !== this);
    const tracks: Record<string, PoseSample[]> = {};
    for (const id of [...this.tracks.keys()].sort()) {
      const tr = this.tracks.get(id)!;
      this.flushTrack(tr);
      tracks[id] = dedupeTicks(tr.out);
    }
    // E-life P1: the static entity physics (entity-physics/1, ~3 MB on Eden 2026) is replaced, never mutated, when it
    // changes, so the take shares it instead of deep-copying it every take; everything else is copied as before
    // S1 V7b: the copy and its text come from finalStateOf, which shares every entity / world field that still equals its
    // copy in the take before (an idle Eden 2026 re-copied and re-serialised ~4,900 unchanged entities every second)
    const { state: finalState, known, hash: finalStateHash } = finalStateOf(this.rt.world);
    const changes = thinChanges(dedupeChanges(this.changes), { ...INTERP_FIELDS, ...this.opts.fieldTol });
    const entities0: Record<string, TakeEntity0> = {};
    for (const id of [...this.first.keys()].sort()) entities0[id] = this.first.get(id)!;
    const body: Omit<Take, 'id'> = {
      schema: TAKE_SCHEMA,
      planHash: this.opts.planHash,
      baselineCheckpoint: this.opts.baselineCheckpoint,
      baselineStateHash: this.baselineStateHash,
      rulesVersion: this.opts.rulesVersion,
      renderSceneRef: this.opts.renderSceneRef ? structuredClone(this.opts.renderSceneRef) : undefined,
      dt: DT,
      startTick: this.startTick,
      ticks: this.rt.tick - this.startTick,
      keyframeEvery: this.opts.keyframeEvery,
      tracks,
      changes,
      events: this.opts.compactEvents === false ? this.events : compactEvents(this.events),
      finalStateHash,
      finalState,
      entities0,
      removed: changes.filter((c) => c[2] === 'present' && c[3] === false).map((c) => ({ id: c[1], t: c[0] })),
    };
    return { ...stripUndefined(body), id: takeIdOf(body, known) } as Take;
  }
}

/** The take's content address (every field except `id`). */
export function takeIdOf(take: Omit<Take, 'id'> | Take, known?: ReadonlyMap<object, string>): string {
  const { id: _id, ...body } = take as Take;
  return hashStable(body, known).slice(0, 24);   // streamed: the final state's text is hashed in place, not joined into the body's
}

function withinTol(pred: PoseSample, actual: PoseSample, tol: { pos: number; ang: number }) {
  const n = Math.max(pred.length, actual.length);
  for (let i = 1; i < n; i++) {
    const a = actual[i] ?? 0, p = pred[i] ?? 0;
    if (i >= 4 ? Math.abs(angDiffQ(a, p)) > tol.ang : Math.abs(a - p) > tol.pos) return false;
  }
  return true;
}
function angDiffQ(a: number, b: number) {
  const full = Math.round(2 * Math.PI * ANG_Q);
  let d = (a - b) % full;
  if (d > full / 2) d -= full;
  if (d < -full / 2) d += full;
  return d;
}

/** The final sample at the take end may repeat a tick when an entity is removed on the last tick. */
function dedupeTicks(s: PoseSample[]) {
  return s.filter((x, i) => i === s.length - 1 || x[0] !== s[i + 1][0]);
}
/** Several changes of one field within a tick (e.g. from the final re-sample) collapse to the last. */
function dedupeChanges(cs: ChangeEvent[]) {
  const seen = new Set<string>();
  const out: ChangeEvent[] = [];
  for (let i = cs.length - 1; i >= 0; i--) {
    const k = `${cs[i][0]}|${cs[i][1]}|${cs[i][2]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cs[i]);
  }
  return out.reverse();
}
function stripUndefined<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

/** Longest run of recorded points one keyframe pair may cover (bounds the simplifier's work per point). */
const THIN_MAX_PENDING = 256;

type Pt = { t: number; v: number[]; value: unknown };
const vecOf = (field: string, v: unknown): { shape: string; v: number[] } | null => {
  if (v === null || v === undefined) return null;
  if (field === 'speed') return typeof v === 'number' ? { shape: 's', v: [v] } : null;
  const h = v as { left?: number[]; right?: number[] };
  if (!h.left && !h.right) return null;
  return { shape: (h.left ? 'L' : '') + (h.right ? 'R' : ''), v: [...(h.left ?? []), ...(h.right ?? [])] };
};
/** Does the line A→B reproduce the recorded point p within eps? Per 3-vector (a hand point) Euclidean, a scalar
 *  absolute. Same arithmetic as `interpChange` (x + (y − x)·u), so the check is what sampleTake will return. */
function fits(A: Pt, B: Pt, p: Pt, eps: number): boolean {
  const u = (p.t - A.t) / (B.t - A.t);
  const n = p.v.length;
  if (n < 3) return Math.abs(A.v[0] + (B.v[0] - A.v[0]) * u - p.v[0]) <= eps;
  for (let i = 0; i + 2 < n; i += 3) {
    const dx = A.v[i] + (B.v[i] - A.v[i]) * u - p.v[i];
    const dy = A.v[i + 1] + (B.v[i + 1] - A.v[i + 1]) * u - p.v[i + 1];
    const dz = A.v[i + 2] + (B.v[i + 2] - A.v[i + 2]) * u - p.v[i + 2];
    if (dx * dx + dy * dy + dz * dz > eps * eps) return false;
  }
  return true;
}

/**
 * mars-take/3 thinning of the INTERP_FIELDS changes (`tol`: field → quanta). Per entity and field the recorded changes
 * are a step signal (a value holds until the next change); it is split into runs of one shape (the same hands present)
 * and each run is simplified like a pose track: a point is dropped when linear interpolation between the kept
 * neighbours (`interpChange`, exactly as sampleTake does it) reproduces it within `tol`. A hold contributes its first
 * and last tick (the error of a line against a constant is largest at the ends, so every tick of it is covered).
 * Clearing (null) and shape changes are kept at their exact tick. Other fields pass through unchanged, in order;
 * added keyframes (a hold's last tick) are placed after the other changes of their tick.
 */
export function thinChanges(changes: ChangeEvent[], tol: Record<string, number>): ChangeEvent[] {
  const series = new Map<string, ChangeEvent[]>();
  const rest: ChangeEvent[] = [];
  for (const c of changes) {
    if (!(c[2] in tol)) { rest.push(c); continue; }
    const k = `${c[1]}\u0000${c[2]}`;
    const l = series.get(k);
    if (l) l.push(c); else series.set(k, [c]);
  }
  const kept: ChangeEvent[] = [];
  for (const l of series.values()) {
    const [, id, field] = l[0];
    const eps = tol[field];
    let run: Pt[] = [];
    let shape = '';
    const flush = () => {
      if (!run.length) return;
      let A = run[0];
      kept.push([A.t, id, field, A.value]);
      let pending: Pt[] = [];
      for (let i = 1; i < run.length; i++) {
        const s = run[i];
        if (pending.length < THIN_MAX_PENDING && pending.every((p) => fits(A, s, p, eps))) { pending.push(s); continue; }
        const B = pending[pending.length - 1];
        if (B) {
          kept.push([B.t, id, field, B.value]);
          A = B;
          pending = [s];
        } else {
          kept.push([s.t, id, field, s.value]);
          A = s;
        }
      }
      const B = pending[pending.length - 1];
      if (B) kept.push([B.t, id, field, B.value]);
      run = [];
    };
    for (let i = 0; i < l.length; i++) {
      const [t, , , value] = l[i];
      const v = vecOf(field, value);
      if (!v || v.shape !== shape) flush();
      if (!v) { kept.push(l[i]); shape = ''; continue; }
      shape = v.shape;
      run.push({ t, v: v.v, value });
      // the hold's last tick, when the next change continues this run later (a line must not smear the hold; at a
      // run's end sampleTake holds the last keyframe anyway)
      const n = l[i + 1];
      if (n && n[0] - 1 > t && vecOf(field, n[3])?.shape === shape) run.push({ t: n[0] - 1, v: v.v, value: structuredClone(value) });
    }
    flush();
  }
  // stable by tick: the other fields keep their order, thinned keyframes follow them within a tick
  const out: ChangeEvent[] = [];
  kept.sort((a, b) => a[0] - b[0]);
  let j = 0;
  for (let i = 0; i < rest.length; i++) {
    while (j < kept.length && kept[j][0] < rest[i][0]) out.push(kept[j++]);
    out.push(rest[i]);
  }
  while (j < kept.length) out.push(kept[j++]);
  return out;
}

type ActionEv = Extract<TakeEvent, { type: 'action' }>;
const EXTRA = ['phase', 'code', 'message', 'from', 'n', 'until'] as const;
const bare = (e: ActionEv) => EXTRA.every((k) => e[k] === undefined);

/**
 * mars-take/4 event compaction (the take's `events`; `expandEvents` in take/replay.ts is the inverse of step 2).
 * 1. Repeated blocked waits: per action, a `blocked` event with the same code, message and phase as that action's
 *    previous blocked event — with at most one `executing` resume of the same phase in between — is merged into it:
 *    the first keeps its tick, gains `n` (waits merged) and `until` (the last one's tick); the resumes in between are
 *    dropped, the one after the last wait is kept. Lossy only in the dropped wait / resume ticks.
 * 2. Lifecycle runs: an action's `requested` event immediately followed (adjacent in the stream, same tick) by
 *    `validated`, `reserved`, `executing` (a prefix of LIFECYCLE, ≥ 2 events, all but the last without phase / code /
 *    message) becomes the last event with `from: 'requested'`. Lossless.
 */
export function compactEvents(events: TakeEvent[]): TakeEvent[] {
  const out: TakeEvent[] = events.map((e) => ({ ...e }) as TakeEvent);
  const drop = new Set<TakeEvent>();
  const wait = new Map<string, { b: ActionEv; resume: ActionEv | null }>();
  for (const e of out) {
    if (e.type !== 'action') continue;
    const w = wait.get(e.id);
    if (e.status === 'blocked') {
      if (w && w.b.code === e.code && w.b.message === e.message && w.b.phase === e.phase) {
        w.b.n = (w.b.n ?? 1) + 1;
        w.b.until = e.t;
        if (w.resume) drop.add(w.resume);
        drop.add(e);
        w.resume = null;
      } else wait.set(e.id, { b: e, resume: null });
    } else if (w && !w.resume && e.status === 'executing' && e.phase === w.b.phase && e.code === undefined) w.resume = e;
    else wait.delete(e.id);
  }
  const kept = out.filter((e) => !drop.has(e));
  const res: TakeEvent[] = [];
  for (let i = 0; i < kept.length; i++) {
    const e = kept[i];
    if (e.type === 'action' && e.status === LIFECYCLE[0] && bare(e)) {
      let k = 0;
      while (k + 1 < LIFECYCLE.length) {
        const n = kept[i + k + 1];
        if (!n || n.type !== 'action' || n.id !== e.id || n.t !== e.t || n.verb !== e.verb || n.status !== LIFECYCLE[k + 1] || n.from !== undefined || n.n !== undefined) break;
        k++;
        if (!bare(n)) break; // extra fields only on the last of the run
      }
      if (k > 0) {
        res.push({ ...(kept[i + k] as ActionEv), from: LIFECYCLE[0] });
        i += k;
        continue;
      }
    }
    res.push(e);
  }
  return res;
}
