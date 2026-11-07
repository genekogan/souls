import {tx} from './edge/comms/store.ts';
import { SoulNow, type SoulNowLine } from './soul-now.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {soulProfileFactV1Schema,type SoulProfileFactV1} from '@souls/protocol';
import {authoredBoundariesDeclarationV1Schema,type AuthoredBoundariesDeclarationV1} from '@souls/engine-contract';
import {REWOUND,type EngineRefusalV1} from '@souls/engine-contract';
import {edenLectureV1} from '@souls/engine-mars';
import {renderPlatformRowsV1Schema,type RenderPlatformV1} from '@souls/engine-contract';
import {officeStairGuardsDeclarationV1Schema,type OfficeStairGuardsDeclarationV1} from '@souls/engine-contract';
import type {EdenLecturePlacementV1} from '@souls/engine-contract';
import {latestPurposeDirectionV1} from './latest-purpose-direction.ts';
import {episodesFromHistoryV1} from './purpose-episodes.ts';
import {commonsNewcomerResourcesV1} from '@souls/engine-mars';
import type {NewcomerResourcePlacementV1} from '@souls/engine-contract';
import {existingGreenLandmarkV1} from '@souls/engine-mars';
import {socialEdenV1} from '@souls/engine-mars';
import {captureIntentArrivalV1,journalIntentArrivalV1,verifyIntentArrivalV1} from './intent-arrivals.ts';
import {previewHumanSleepStopV1} from './human-sleep-transition.ts';
import {bodyState,cardDoing,type ApproachV1,type BodyStateV1} from './body-state.ts';
import {intentSleepStopV1Schema,type IntentSleepStopV1} from '@souls/protocol';
// WorldHost: the sequencer. Owns the engine, the event log, the tick loop,
// snapshots, and the per-batch broadcast. The fold (doc 11):
//   events logged with tick T are applied when world.tick == T, then the engine steps to T+1.
import type { Engine, EngineFactory, PathCommit, ChangeEvent, ProgramEvent, EngineSnapshot, EngineCheckpoint, RuntimeEvent } from '@souls/engine-contract';
import { hashOf } from '@souls/engine-contract';
import { kernelHash, sweep, type KState } from '@souls/kernel';
import { ClockFrontiers,type ClockFrontierV1 } from './clock-frontier.ts';
import {
  describeIntent, publicIntent, viewHashOf, viewRow,
  isStationFactV1,
  stationSourceFromRulesV1,stationPhysicalTransitionV1,stationRulesEraV1Schema,foldStationRulesEraV1,initialStationPhysicalHeadV1,acceptStationPhysicalHeadV1,
  type StationEraFoldStateV1,type StationPhysicalHeadV1,
  INTENT_V2, intentHistoryFactV2, intentReceivedPayloadV2Schema, intentReferenceV2Schema, intentAdmissionFactV2, intentControllerFactV2,
  type IntentAdmissionPayloadV2, type IntentControllerPayloadV2,
  type AgendaStep, type Batch, type BirthPayload, type DecisionPayload, type EventKind, type Heartbeat, type IntentPayload, type KernelView, type LogEvent,
  type PlayPayload, type PlayView, type PublicSoul, type ScenePayload, type Snapshot, type WireIntent,
} from '@souls/protocol';
import type { Db } from './db.ts';
import { advanceNeeds, newLife, type Life } from '@souls/brain';
import { arrivalPlace, baseVocabulary, codeVocabulary, foldEvent, initKernel, pinnedVocabulary, soulThing, type Vocabulary, type FoldResult } from './fold.ts';
import { frontier, stepIndex, belongsTo } from './deck.ts';
import {mandateOf,MANDATE_STATE} from './mandate.ts';
import { emptyIntentHistoryV2, foldIntentHistoryV2, type IntentHistoryV2 } from './intent-history.ts';
import { IntentObservations } from './intent-observations.ts';
import { foldStationFactV1, stationGenesisIdV1, type StationHistoryV1 } from './station-history.ts';
import { initialStationHistoryV2,foldStationFactV2,type StationHistoryV2 } from './station-history-v2.ts';
import { bootPhase, bootTick } from './load/boot-progress.ts';
import { countGlitch, faultFacts, glitchLine, type GlitchCountsV1, type GlitchRecordV1, type GlitchRung } from './glitch.ts';
export { replayFromGenesis, replayKernel } from './fold.ts';


/** A Soul's mind: everything about it that is not the engine's body state. */
export type Mind = {
  soulId: string; entityId: string; name: string; description: string; owner: string; native: boolean;
  life?: Life;
  intent: WireIntent | null; intentVersion: number;
  activeRule?: string;
  mood: string; energy: number; wantsCompany: number;
  recent: string[]; doing: string;
  nextEvalTick: number; evalTrigger: string; lastEnergyTick: number; lastFingerprint: string;
  nudge: { text: string; untilTick: number } | null;
  /** The intent's agenda (cards to favour, in order) and how far along it is. */
  agenda: AgendaStep[]; agendaPos: number;
  /** Something that was just tried and could not be done: not offered again for a minute, so a Soul never retries the impossible in a loop. */
  avoid?: { id: string; untilTick: number };
  /** Tick since which the plan has had no playable step (to give up eventually). */
  planBlockedSince?: number;
  /** The card whose depiction is running and whose effects have not applied yet. */
  pending: { program: string; card: string; hash: string; target: string | null; option?: string; manner?: string; approachLen: number; applied: boolean } | null;
};
export type RecoveryRecipe = { baseline: SnapshotBody; events: LogEvent[]; untilTick: number; faults: Record<string,number>; excluded: string[]; reason: string;
  /** Hotfix (edge worlds, no mind card to blame): the bodies whose programmes are stopped at the baseline, the edge decision
   *  events left out of the replay, and the edge Souls whose open receipts end `engine.fault-recovered`. */
  edge?: { stopActors: string[]; excludedSeqs: number[]; souls: string[];
    /** The rewound bodies' last valid poses (taken before the faulting tick): after the replay each lands back there, or at
     *  the nearest free standing point, instead of where the rewind left it (its arrival point). Absent in older recipes. */
    poses?: Record<string, RecoveryPose> };
  /** #1150 rung 3: `events` are re-applied to the baseline without stepping, every programme stops and the clock moves to
   *  `untilTick`. What still breaks a rule is contained. */
  lastRung?: { contained?: {code:string;subjects:string[]}[]; relocated?: string[]; skipped?: number[] } };
/** #1150: a minute of world time. A fault within it of a rung 3 doesn't rewind again. */
const REWIND_COOLDOWN_TICKS = 1200;
/** #1150: half the ticks of ten seconds of world time faulted. The step itself is broken, and the world says so. */
const STEP_FAILING_WINDOW_TICKS = 200, STEP_FAILING_FAULTS = 100;
/** What rung 3 leaves out: decisions, and the facts that only mean something for a programme a decision started. */
const DROPPED_ON_REWIND = new Set(['decision', 'play', 'edge-stop', 'intent-admission-v2', 'intent-arrival-v1', 'intent-sleep-stop-v1']);
export type RecoveryPose = { p: [number, number, number]; yaw: number; level: number };
/** A synchronous, read-only acceptance check. Throw to refuse before logging. */
export type AcceptanceGuard = () => true;
export function checkAcceptanceGuard(guard: AcceptanceGuard): void {
  if (guard() !== true) throw new TypeError('acceptance guard must synchronously return true');
}
/** Synchronous writes to this host's Db, in the event acceptance transaction. */
export type AcceptanceJournal = (event: LogEvent) => true;
/** G1/R8: a native mind perceives what the god did around it (a line in its recent memory) and re-thinks next tick;
 *  `interrupted`: its act ended (walked out or stopped), so it stands where it was put. Deterministic (folded). */
function godNoticed(m: Mind, text: string, tick: number, interrupted: boolean) {
  m.recent = [...m.recent.slice(-3), text];
  if (interrupted) { m.doing = 'standing around'; m.pending = null; }
  m.nextEvalTick = Math.min(m.nextEvalTick, tick + 1); m.evalTrigger = 'god-change'; m.lastFingerprint = '';
}
type PurposeRef = { intentId: string; version: number };
type ActivityBinding = { admissionSeq:number; payload:Extract<IntentAdmissionPayloadV2,{phase:'accepted'}> };
export class StaleIntentAttempt extends Error { constructor() { super('purpose attempt became stale'); } }
export class IntentAdmissionDeferred extends Error { constructor() { super('purpose admission needs a resumable checkpoint'); } }
export class PersistedIntentAdmissionFault extends Error {
  readonly decisionSeq: number;
  constructor(decisionSeq:number) { super('decision and admission persisted; physical application requires reconciliation'); this.decisionSeq=decisionSeq; }
}
type Pending = { kind: EventKind; author: string; payload: any; resolve?: (e: LogEvent) => void; guard?: AcceptanceGuard; journal?: AcceptanceJournal; reject?: (error: unknown) => void; purpose?: PurposeRef; stationEra?:boolean; atomicObjectDecision?:boolean };
export type BootStats = { from: 'genesis' | 'snapshot'; restoreMs: number; readMs: number; replayMs: number; baselineMs: number; replayTicks: number; replayEvents: number; fromTick: number; toTick: number; minds: number };
export type SnapshotBody = { runtime: EngineSnapshot; minds: Mind[]; seq: number; extra: Record<string, unknown>; kernel?: KState; counts?: Record<string, number>; faultedHeadV1?: true };
export type HostListener = {
  onBatch?(b: Batch): void;
  onHeartbeat?(h: Heartbeat): void;
  onApplied?(e: LogEvent): void;
  onRuntimeEvent?(e: RuntimeEvent): void;
  onProgram?(e: ProgramEvent, m: Mind): void;
  /** A logged decision was folded: its native programme admission result (live only). */
  onDecision?(e: LogEvent, r: { programId?: string; programOk?: boolean; programCode?: string }): void;
  /** A card's effects were applied (or refused). Not called during replay. */
  onPlay?(p: PlayView, m: Mind | undefined): void;
  onKernel?(v: KernelView): void;
  /** Advisory wall-time context; authoritative tick work remains synchronous and ordered. */
  afterTick?(tick: number, context?: Readonly<{ startedAtMs: number }>): void;
  /** Notification only: the whole tick, including broadcasts/checkpoint scheduling, completed. */
  afterTickComplete?(tick: number): void;
  /** Notification only: the clock was stopped; no queued work is drained. */
  onStop?(): void;
  onClockUnavailable?():void;
};

const TICK_MS = 50;
const BATCH_TICKS = 10;      // 500 ms at rate 1
const HEARTBEAT_TICKS = 100; // 5 s at rate 1
const RING_BATCHES = 600;

export class WorldHost {
  engine!: Engine;
  /** Meaning: things, links, vocabulary, decks. Replays from the log without the engine. */
  kernel!: KState;
  counts: Record<string, number> = {};       // successful plays per card
  recentPlays: PlayView[] = [];
  private kernelDirty = true;
  minds = new Map<string, Mind>();          // by soulId
  /** The provisional next-think tick the brain set when it queued a Soul's decision (in memory, not snapshotted). A wake that
   *  lands before the decision applies (someone answered, the plan moved on) pulls nextEvalTick below it, and applying the
   *  decision keeps that wake instead of overwriting it: the decision was made without knowing (the DJ story: Wren's "wait"
   *  applied a tick after Rob's yes and slept 200 ticks, and Rob ended the gathering first). */
  readonly provisionalEval = new Map<string, number>();
  mindByEntity = new Map<string, Mind>();
  seq = 0;
  clockRate = 1;
  paused = false;
  listeners: HostListener[] = [];
  /** Stage B (split/delta.ts, SIM_READ_WORKER=1 only): the WorldDelta tap, given each completed tick's own paths/changes. */
  splitTap?: (tick: number, out: { paths: PathCommit[]; changes: ChangeEvent[]; programs: ProgramEvent[] }) => void;
  ring: Batch[] = [];
  lastSnapshotTick = 0;
  /** Adaptive snapshot cadence (lane L5): a periodic snapshot is also due once the ticks since the last one cost
   *  `snapshotDebtMs` of engine time to replay (0 = off; main.ts sets SNAPSHOT_DEBT_MS), at most one per
   *  `snapshotMinGapMs` of wall time, and never more often than 20× the last capture's main-thread cost (capture ≤ 5 %
   *  of its interval). `snapshotEvery` ticks stays the ceiling. A boot that replayed more than `snapshotAfterReplayTicks`
   *  (0 = off; main.ts sets SNAPSHOT_AFTER_REPLAY_TICKS) snapshots on its first tick, so a second crash does not replay the gap again. */
  snapshotDebtMs = 0; snapshotMinGapMs = 20_000; snapshotAfterReplayTicks = 0;
  /** Engine-step time of the live ticks since the last snapshot: what a boot after a kill would replay. */
  replayDebtMs = 0;
  private lastSnapshotWall = performance.now();
  private snapshotSoon: string | null = null;
  /** Main-thread ms of the last completed snapshot (capture + finish + serialize + persist). */
  lastSnapshotCostMs = 0;
  extra: Record<string, unknown> = {};       // module state persisted with snapshots (narrator schedule etc.)
  tickMs: number[] = [];
  /** The last boot's phases (lane L5): restore = snapshot read + decode + engine restore; replay = stepping logged history to its head. */
  bootStats: BootStats | null = null;
  private queue: Pending[] = [];
  private intentControllerFaults = new Set<string>();
  private intentObservations: IntentObservations;
  private acc = { paths: [] as PathCommit[], changes: [] as ChangeEvent[], log: [] as LogEvent[], dirty: new Set<string>(), removed: [] as string[], plays: [] as PlayView[], fromTick: 0 };
  private batchSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private clockGeneration = 0;
  private frameBatch: { remaining: number; generation: number } | null = null;
  private frameImmediate: NodeJS.Immediate | null = null;
  private recoveryBaseline: SnapshotBody | null = null;
  /** Owned checkpoint captured at the latest periodic boundary, before deferred encoding finishes. */
  private recoveryCapture: (() => SnapshotBody) | null = null;
  private periodicSnapshot: { engine: Engine; previousTick: number; previousDebt: { ms: number; wall: number; soon: string | null }; immediate: NodeJS.Immediate | null } | null = null;
  private snapshotGeneration = 0;
  /** Edge worlds: the Souls' bodies' poses at the start of the latest tick (valid: the previous tick passed the invariants). */
  private validPoses: { tick: number; poses: Map<string, RecoveryPose> } | null = null;
  private last = 0;
  private carry = 0;
  private overruns = 0;
  private calm = 0;
  /** The rate an admin set (persisted). `clockRate` is the effective rate, lower while dilated. */
  baseRate = 1;
  private kfCursor = 0;
  db: Db; factory: EngineFactory; seed: string; snapshotEvery: number;
  readonly worldId: string;
  private clockFrontiers:ClockFrontiers;
  private durableClockV1:boolean;
  private clockFailure:unknown;
  get clockAvailable(){return !this.clockFailure;}
  assertClockReady():void {if(this.clockFailure)throw new Error('clock-frontier.unavailable', { cause: this.clockFailure });}

  constructor(db: Db, factory: EngineFactory, seed: string, snapshotEvery: number, worldId = 'toy-1',options?:{durableClockV1?:boolean}) {
    this.worldId = worldId;
    this.db = db; this.factory = factory; this.seed = seed; this.snapshotEvery = snapshotEvery;
    this.clockFrontiers=new ClockFrontiers(db);this.durableClockV1=options?.durableClockV1===true;
    this.intentObservations = new IntentObservations(db, worldId);
  }

  // ------------------------------------------------------------ boot
  /** Load the latest snapshot and fast-forward through later log events, or start from genesis. */
  boot(): { from: 'genesis' | 'snapshot'; replayed: number } {
    const tBoot = performance.now(); bootPhase('boot:restore');
    this.cancelPeriodicSnapshot(); this.recoveryCapture = null; this.recoveryBaseline = null;
    let w = this.db.world(this.worldId);
    if (!w) {
      this.db.createWorld({ id: this.worldId, schema: 'pending', rules_version: this.factory.rulesVersion, dt: 1 / 20, seed: this.seed });
      w = this.db.world(this.worldId)!;
    }
    this.clockRate = this.baseRate = w.clock_rate;
    const clock=this.clockFrontiers.read(this.worldId);
    if(clock&&!this.durableClockV1)throw new Error('clock-frontier.reader-required');
    if(clock&&this.factory.canReplayHistory?.(clock.rulesVersion)===false)throw new Error('clock-frontier.rules-incompatible');
    const tRead = performance.now();
    const snapRow = this.db.latestSnapshotText(this.worldId);
    const snap = snapRow ? { ...snapRow, body: JSON.parse(snapRow.text) as unknown } : null;
    const readMs = performance.now() - tRead;
    // Snapshot rejection is not permission to reinterpret history from genesis.
    // Check both durable identities before constructing or stepping any engine.
    for(const version of [w.rules_version,...(snap?[snap.rulesVersion]:[])])
      if(this.factory.canReplayHistory?.(version)===false)throw new Error(`history rules are incompatible with the configured engine: ${version} -> ${this.factory.rulesVersion}`);
    let from: 'genesis' | 'snapshot' = 'genesis';
    if (snap && (snap.rulesVersion === this.factory.rulesVersion || this.factory.canRestoreSnapshot?.(snap.rulesVersion))) {
      const body = snap.body as SnapshotBody;
      this.engine = this.factory.restore(body.runtime);
      for (const m of body.minds) this.addMind({ ...m, agenda: m.agenda ?? [], agendaPos: m.agendaPos ?? 0, pending: m.pending ?? null });
      this.extra = body.extra ?? {};
      this.counts = body.counts ?? {};
      // A snapshot from before the kernel existed: build the kernel from the Souls that are there.
      this.kernel = body.kernel ?? this.bootstrapKernel();
      // (a kernel bootstrapped by an earlier build recorded every Soul as born at tick 0; a replay says otherwise)
      if (body.kernel) { const born = this.db.birthTicks(this.worldId); for (const t of Object.values(this.kernel.things)) if (t.kind === 'soul' && t.born === 0 && born[t.id]) t.born = born[t.id]; }
      this.seq = body.seq;
      this.lastSnapshotTick = snap.tick;
      from = 'snapshot';
    } else {
      this.engine = this.factory.create(this.factory.genesis(w.seed));
      this.kernel = initKernel(this.engine, pinnedVocabulary(this.db.rulesEvents(this.worldId)));
    }
    // fast-forward: replay events logged after the snapshot, stepping the engine to their ticks
    // Only the last logged recovery and what follows it replay (it supersedes its prefix, below), so the prefix is
    // never read: its own recovery recipes each carry a whole world body.
    const lastRepair = this.db.lastRecoverySeq(this.worldId, this.seq);
    let later = this.db.events(this.worldId, lastRepair === null ? this.seq : lastRepair - 1);
    let checkedClock=false;
    const restoredAt = performance.now(), fromTick = this.engine.world.tick;
    let replayTicks = 0;
    if(clock&&this.seq>clock.throughSeq){
      if(this.engine.world.tick<clock.tick)throw new Error('clock-frontier.snapshot-prefix-differs');
      checkedClock=true; // A later exact durable snapshot supersedes this prefix.
    }
    let replayedRefusals=0,replayThrew=false;
    const stepReplay=()=>{
      const before=this.engine.runtime.violations.length;
      let out:ReturnType<Engine['step']>;
      try{out=this.stepEngine();}catch(error){if(!this.repairRules)throw error;if(!replayThrew)console.warn('[world] a replayed step threw; the repair in the log follows it:',String(error).slice(0,200));replayThrew=true;if(this.durableClockV1){this.kernel.tick=this.engine.world.tick;sweep(this.kernel);}return;}   // #1150: as the live tick did
      this.advanceLives();replayTicks++;bootTick(this.engine.world.tick);
      replayedRefusals+=out.refusals?.length??0;
      if(this.durableClockV1){
        if(this.engine.runtime.violations.length>before&&!this.repairRules)throw new Error('clock-frontier.replay-violates');   // #1150: a repair in the log follows it
        this.kernel.tick=this.engine.world.tick;sweep(this.kernel);
      }
      this.afterPrograms(out.programs,true);
    };
    const verifyClock=()=>{
      if(!clock||checkedClock)return;
      if(this.seq!==clock.throughSeq||this.engine.world.tick>clock.tick)throw new Error('clock-frontier.prefix-differs');
      while(this.engine.world.tick<clock.tick)stepReplay();
      this.kernel.tick=this.engine.world.tick;sweep(this.kernel);
      if(this.engine.rulesVersion!==clock.rulesVersion||this.engine.dt!==clock.dtSeconds
        ||this.engine.stateHash()!==clock.engineHash||kernelHash(this.kernel)!==clock.kernelHash)
        throw new Error('clock-frontier.replay-differs');
      checkedClock=true;
    };
    let repaired = -1; for (let i=0;i<later.length;i++) if (later[i].kind === 'rules' && later[i].payload?.recovery) repaired=i;
    if (repaired >= 0) {
      const repair=later[repaired];this.apply(repair,true);this.seq=repair.seq;
      if(clock&&repair.seq>clock.throughSeq){
        if(this.engine.world.tick<clock.tick)throw new Error('clock-frontier.recovery-regression');
        checkedClock=true; // Explicit logged recovery supersedes its old prefix.
      }
      later=later.slice(repaired+1);
    }
    const target = Math.max(this.engine.world.tick, later.length ? later[later.length - 1].tick : 0, clock && !checkedClock ? clock.tick : 0);
    bootPhase('boot:replay', this.engine.world.tick, target);
    for (const e of later) {
      if(clock&&!checkedClock&&e.seq>clock.throughSeq)verifyClock();
      while (this.engine.world.tick < e.tick) stepReplay();
      try { this.apply(e, true); } catch (error) { if (!this.repairRules) throw error; console.warn(`[world] replayed event ${e.seq} threw, as it did live:`, String(error).slice(0, 200)); }
      this.seq = e.seq;
    }
    verifyClock();
    if(this.repairRules)this.lastRewindTick=this.db.lastRewindTick(this.worldId,this.engine.world.tick-REWIND_COOLDOWN_TICKS)??-Infinity;
    this.factory.validateHistoryHead?.(this.engine,this.db.world(this.worldId)!.rules_version);
    if(this.extra.stationV1)this.stationPhysicalHeadV1();
    const replayedAt = performance.now();
    this.acc.fromTick = this.engine.world.tick;
    this.resetAcc();
    // After a logged recovery the baseline is the replayed head, so the next fault neither rereads nor nests its recipe.
    const canCapture = !this.engine.canSnapshot || this.engine.canSnapshot();
    this.replayDebtMs = 0; this.lastSnapshotWall = performance.now();
    if (this.snapshotAfterReplayTicks > 0 && replayTicks > this.snapshotAfterReplayTicks) this.snapshotSoon = `replayed ${replayTicks} ticks`;
    // The snapshot's own text is the baseline (decoded only if a fault needs it): no second decoded copy of the world is
    // held, and no copy is taken after restore and replay have run over the decoded body's shared parts.
    if (snapRow && (lastRepair === null || !canCapture)) { const text = snapRow.text; if ((snap?.body as SnapshotBody | undefined)?.faultedHeadV1) this.bootedFaulted = true; else this.recoveryCapture = () => JSON.parse(text) as SnapshotBody; }   // #1150: a faulted head is no baseline
    else if (canCapture) this.recoveryBaseline = this.captureBody();
    // Write this world's starting vocabulary into its log once, so its history never depends on what the code's set becomes.
    if (!this.db.hasVocabulary(this.worldId)) void this.enqueue('rules', 'system', { vocabulary: structuredClone(baseVocabulary(this.kernel)), why: 'the vocabulary this world began with' });
    if (this.pendingBootstrap) { void this.enqueue('rules', 'system', { kernelBootstrap: this.pendingBootstrap, why: 'the kernel begins here for a world that predates it' }); this.pendingBootstrap = null; }
    const end = performance.now();
    const stats: BootStats = { from, restoreMs: Math.round(restoredAt - tBoot), readMs: Math.round(readMs), replayMs: Math.round(replayedAt - restoredAt), baselineMs: Math.round(end - replayedAt),
      replayTicks, replayEvents: later.length, fromTick, toTick: this.engine.world.tick, minds: this.minds.size };
    this.bootStats = stats;
    console.log(`[boot] restore ${stats.restoreMs} ms from ${from} tick ${fromTick} (snapshot read+decode ${stats.readMs} ms, ${stats.minds} minds)`);
    // #1150: refusals are recomputed, so the log's count is evidence only: a difference is reported and the boot goes on
    const loggedRefusals=later.filter(e=>e.kind==='rules'&&e.author==='world:refusal').length;
    if(loggedRefusals!==replayedRefusals)console.warn(`[world] refusal count differs on replay: logged ${loggedRefusals}, replayed ${replayedRefusals}`);
    console.log(`[boot] replay ${stats.replayMs} ms ${replayTicks} ticks ${later.length} events to tick ${stats.toTick} (${replayTicks ? (stats.replayMs / replayTicks).toFixed(2) : '0'} ms/tick; recovery baseline ${stats.baselineMs} ms)`);
    return { from, replayed: later.length };
  }

  /** Adopt the code's current starting vocabulary in this world (base cards, kinds, link kinds, manners), as a logged change of rules. */
  adoptVocabulary(author: string) { return this.enqueue('rules', author, { vocabulary: codeVocabulary(), why: 'adopted the current base vocabulary' } satisfies { vocabulary: Vocabulary; why: string }); }
  /** Trusted internal checkpoint only. No REST/MCP permission is introduced.
   * Carry is explicitly isolated; existing callers retain the station refusal. */
  adoptCommons(author:string,options?:{stationEraV1?:boolean}):Promise<LogEvent> {
    if(this.stationHistoryV1()&&!options?.stationEraV1)return Promise.reject(new Error('commons-transition.station-carry-forward-required'));
    const preview=this.engine.previewCommonsTransition?.();
    if(!preview?.ok)return Promise.reject(new Error(preview?`${preview.diagnostic.code}: ${preview.diagnostic.message}`:'commons-transition.reader-unavailable'));
    const previous=new Set(this.engine.anchors().map(a=>a.id));
    const collision=preview.anchors.find(a=>!previous.has(a.id)&&this.kernel.things[a.id]);
    if(collision)return Promise.reject(new Error(`commons-transition.kernel-collision:${collision.id}`));
    const expected=preview.transition;
    const guard:AcceptanceGuard=()=>{
      if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('commons-transition.header-dt-moved');
      if(this.stationHistoryV1()&&!options?.stationEraV1)throw new Error('commons-transition.station-carry-forward-required');
      const current=this.engine.previewCommonsTransition?.();
      if(!current?.ok||JSON.stringify(current.transition)!==JSON.stringify(expected))throw new Error('commons-transition.source-moved');
      const oldAnchors=new Set(this.engine.anchors().map(a=>a.id));
      for(const a of current.anchors)if(!oldAnchors.has(a.id)&&this.kernel.things[a.id])throw new Error(`commons-transition.kernel-collision:${a.id}`);
      if(this.factory.canReplayHistory?.(expected.toRulesVersion)!==true)throw new Error('commons-transition.reader-unavailable');
      return true;
    };
    const journal:AcceptanceJournal=()=>{
      const result=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?')
        .run(expected.toRulesVersion,this.worldId,expected.fromRulesVersion);
      if(result.changes!==1)throw new Error('commons-transition.header-moved');return true;
    };
    return new Promise((resolve,reject)=>this.queue.push({kind:'rules',author,payload:{commonsTransition:expected},guard,journal,
      stationEra:options?.stationEraV1===true,resolve,reject}));
  }
  /** Prospective controller policy; neither a DB-header edit nor a new world.
   * Station binding needs its own agreed carry, so this first reader refuses it. */
  adoptCrewRemovalPolicyV1(author:string):Promise<LogEvent>{
    if(this.stationHistoryV1())return Promise.reject(Error('crew-removal-transition.station-carry-required'));
    const preview=this.engine.previewCrewRemovalTransitionV1?.();
    if(!preview?.ok)return Promise.reject(Error(preview?preview.diagnostic.code+': '+preview.diagnostic.message:'crew-removal-transition.reader-unavailable'));
    const expected=preview.transition;
    const guard:AcceptanceGuard=()=>{
      if(this.stationHistoryV1())throw Error('crew-removal-transition.station-carry-required');
      const row=this.db.world(this.worldId);
      if(row?.dt!==this.engine.dt||row.rules_version!==expected.fromRulesVersion)throw Error('crew-removal-transition.header-moved');
      const current=this.engine.previewCrewRemovalTransitionV1?.();
      if(!current?.ok||hashOf(current.transition)!==hashOf(expected))throw Error('crew-removal-transition.source-moved');
      if(this.factory.canReplayHistory?.(expected.toRulesVersion)!==true||this.factory.canRestoreSnapshot?.(expected.toRulesVersion)!==true)throw Error('crew-removal-transition.reader-unavailable');
      return true;
    };
    const journal:AcceptanceJournal=()=>{
      const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(expected.toRulesVersion,this.worldId,expected.fromRulesVersion);
      if(r.changes!==1)throw Error('crew-removal-transition.header-moved');return true;
    };
    return new Promise((resolve,reject)=>this.queue.push({kind:'rules',author,payload:{crewRemovalTransition:expected},guard,journal,resolve,reject}));
  }
  private stationEraEvent(source:LogEvent):LogEvent|undefined {
    const old=this.stationHistoryV1();if(!old)return undefined;
    const physical=stationSourceFromRulesV1(this.worldId,source);
    const previous=this.stationPhysicalHeadV1()!;
    const payload=stationRulesEraV1Schema.parse({contract:'station-rules-era/1',worldId:this.worldId,epoch:old.station.epoch,
      revision:previous.revision+1,previousRevision:previous.revision,fromRulesVersion:previous.rulesVersion,
      toRulesVersion:stationPhysicalTransitionV1(physical).toRulesVersion,dtSeconds:this.engine.dt,effectiveTick:source.tick,
      source:{seq:source.seq,tick:source.tick,transitionHash:hashOf(stationPhysicalTransitionV1(physical))}});
    const fact={seq:source.seq+1,tick:source.tick,payload};
    foldStationRulesEraV1(this.extra.stationEraV1 as StationEraFoldStateV1|undefined,fact,physical,old.station);
    return {...fact,kind:'station-rules-era-v1',author:'world:station',at:source.at};
  }
  /** Trusted internal physical infrastructure edit. Existing station histories
   * explicitly refuse until a corresponding atomic era producer is qualified. */
  adoptCampExpansion(author:string,options?:{stationEraV1?:boolean}):Promise<LogEvent>{
    if(this.stationHistoryV1()&&!options?.stationEraV1)return Promise.reject(new Error('camp-expansion.station-era-reader-required'));
    const row=this.db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.campExpansion.contract')='camp-ground-expansion/1' ORDER BY seq DESC LIMIT 1").get(this.worldId) as {seq:number}|undefined;
    if(row){const old=this.db.events(this.worldId,row.seq-1,1)[0],t=old?.payload?.campExpansion;
      if(t?.toRulesVersion===this.engine.rulesVersion&&hashOf(t.toBase)===hashOf(this.engine.world.base))return Promise.resolve(old);
    }
    const preview=this.engine.previewCampExpansionV1?.();
    if(!preview?.ok)return Promise.reject(new Error(preview?preview.diagnostic.code+': '+preview.diagnostic.message:'camp-expansion.reader-unavailable'));
    const previous=new Set(this.engine.anchors().map(a=>a.id));
    const collision=preview.anchors.find(a=>!previous.has(a.id)&&this.kernel.things[a.id]);
    if(collision)return Promise.reject(new Error('camp-expansion.kernel-collision:'+collision.id));
    const expected=preview.transition;
    const guard:AcceptanceGuard=()=>{
      if(this.stationHistoryV1()&&!options?.stationEraV1)throw new Error('camp-expansion.station-era-reader-required');
      if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('camp-expansion.header-dt');
      const current=this.engine.previewCampExpansionV1?.();
      if(!current?.ok||hashOf(current.transition)!==hashOf(expected))throw new Error('camp-expansion.source-moved');
      const known=new Set(this.engine.anchors().map(a=>a.id));
      for(const a of current.anchors)if(!known.has(a.id)&&this.kernel.things[a.id])throw new Error('camp-expansion.kernel-collision:'+a.id);
      if(this.factory.canReplayHistory?.(expected.toRulesVersion)!==true)throw new Error('camp-expansion.reader-unavailable');
      return true;
    };
    const journal:AcceptanceJournal=()=>{
      const result=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(expected.toRulesVersion,this.worldId,expected.fromRulesVersion);
      if(result.changes!==1)throw new Error('camp-expansion.header-moved');return true;
    };
    return new Promise((resolve,reject)=>this.queue.push({kind:'rules',author,payload:{campExpansion:expected},guard,journal,stationEra:options?.stationEraV1===true,resolve,reject}));
  }
  private pendingBootstrap: { at: Record<string, string | null> } | null = null;
  /** For worlds snapshotted before the kernel existed: places from the engine, a Soul thing and deck per mind. */
  private bootstrapKernel(): KState {
    const k = initKernel(this.engine), at: Record<string, string | null> = {}, born = this.db.birthTicks(this.worldId);
    for (const m of this.minds.values()) {
      // as a replay from genesis would have it (arrived, never moved); the logged bootstrap event then places each Soul where it stands
      soulThing(k, { soulId: m.soulId, entityId: m.entityId, name: m.name, description: m.description, owner: m.owner }, arrivalPlace(k));
      k.things[m.soulId].born = born[m.soulId] ?? 0;
      at[m.soulId] = this.engine.world.entities[m.entityId] ? this.nearestPlace(k, m.entityId) : arrivalPlace(k);
    }
    this.pendingBootstrap = { at };
    return k;
  }
  /** The place Thing an entity is physically at: a place within 5 m, else its region. */
  nearestPlace(k: KState, entityId: string): string | null {
    const e = this.engine.world.entities[entityId]; if (!e) return null;
    let best: string | null = null, bd = 5;
    for (const t of Object.values(k.things)) { if (t.kind !== 'place') continue; const pe = this.engine.world.entities[t.traits.entity as string]; if (!pe) continue; const d = Math.hypot(pe.pose.p[0] - e.pose.p[0], pe.pose.p[2] - e.pose.p[2]); if (d < bd) { bd = d; best = t.id; } }
    return best ?? this.engine.regionAt(e.pose.p);
  }

  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.clockGeneration++;
    this.startFrameTimer();
  }
  private startFrameTimer() {
    const generation = this.clockGeneration;
    const timer = setInterval(() => { if (generation === this.clockGeneration && this.timer === timer) this.frame(); }, TICK_MS / this.pace);
    this.timer = timer;
  }
  /** Stop/pause discard the pending tick batch, never queued inputs or accepted events; existing carry is retained. */
  private cancelFrameBatch() {
    if (this.frameImmediate) clearImmediate(this.frameImmediate);
    this.frameImmediate = null; this.frameBatch = null;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.clockGeneration++; this.cancelFrameBatch(); this.cancelPeriodicSnapshot(); for (const l of this.listeners) { try { l.onStop?.(); } catch { /* observers cannot prevent stopping */ } } }
  /** The world's own clock loop is running (start(); a served world). False while stepped by hand (tests, tools): lane P5
   *  defers some boot-time derived work only in a served world, so a stepped one sees it at the same tick as before. */
  get running(): boolean { return this.timer !== null; }
  /** Wall pace of the clock (attention.ts): 1 while anyone watches or acts here, lower while nobody does (an unwatched
   *  world advances fewer ticks per wall second, and wakes its loop less often). The same ticks run in the same order with
   *  the same inputs, so schedules (in world time) and takes (cut every 20 ticks) are unchanged; only how fast world time
   *  passes against the wall clock changes, as while asleep. Not logged, not persisted, not part of `clockRate`. */
  pace = 1;
  setPace(pace: number) {
    if (!(pace > 0 && pace <= 1) || pace === this.pace) return;
    const now = performance.now();
    if (this.timer && !this.paused) this.carry += (Math.min(1000, now - this.last) * this.clockRate * this.pace) / TICK_MS;  // the time so far, at the old pace
    this.last = now; this.pace = pace;
    if (this.timer) { clearInterval(this.timer); this.startFrameTimer(); }
  }

  // ------------------------------------------------------------ the loop
  /** When it answers true the frame is skipped and its wall time carried to the next one (the hub, while a visitor's join set
   *  is still going out: lane P5). Holds stay well under the 1 s elapsed cap, so the same ticks run, only later. */
  holdClock?: () => boolean;
  private frame() {
    if (!this.timer) return;
    if (this.paused || !this.clockAvailable) { this.cancelFrameBatch(); this.last = performance.now(); return; }
    // A catch-up batch owns its original elapsed/carry/dilation decision. A held batch resumes from the timer;
    // otherwise its single immediate continues it. Account wall time again only when starting the next batch.
    if (this.frameBatch) { if (!this.frameImmediate) this.pumpFrame(this.frameBatch); return; }
    const now = performance.now();
    if (this.holdClock?.()) return;
    const elapsed = Math.min(1000, now - this.last);
    this.last = now;
    this.carry += (elapsed * this.clockRate * this.pace) / TICK_MS;
    let due = Math.floor(this.carry);
    this.carry -= due;
    if (due > 40) {
      due = 40; this.carry = 0; this.calm = 0;
      // EVE-style time dilation: if we cannot keep up, slow the world clock instead of dropping inputs.
      // Dilation is temporary: it is not persisted, and the clock recovers once the loop keeps up again.
      if (++this.overruns >= 3 && this.clockRate > this.baseRate / 4) { this.overruns = 0; this.clockRate = Math.max(this.baseRate / 4, this.clockRate / 2); void this.enqueue('rules', 'system', { clockRate: this.clockRate, why: 'dilation' }); }
    } else {
      this.overruns = 0;
      if (this.clockRate < this.baseRate && ++this.calm >= 200) { this.calm = 0; this.clockRate = Math.min(this.baseRate, this.clockRate * 2); void this.enqueue('rules', 'system', { clockRate: this.clockRate, why: 'recovered' }); }
    }
    if (due > 0) {
      this.frameBatch = { remaining: due, generation: this.clockGeneration };
      this.pumpFrame(this.frameBatch);
    }
  }
  /** Yield only after a complete tick, including input logging, durable frontier, listeners and broadcasts. */
  private pumpFrame(batch: { remaining: number; generation: number }) {
    if (this.frameBatch !== batch || batch.generation !== this.clockGeneration || !this.timer) return;
    if (this.paused || !this.clockAvailable) { this.cancelFrameBatch(); return; }
    if (this.holdClock?.()) return; // park; the interval polls the hold without an immediate spin
    batch.remaining--;
    try { this.tickOnce(); }
    catch (error) { this.cancelFrameBatch(); throw error; }
    if (this.frameBatch !== batch) return; // a listener may have stopped/restarted or paused the host
    if (this.paused || !this.clockAvailable) { this.cancelFrameBatch(); return; }
    if (!batch.remaining) { this.frameBatch = null; return; }
    this.frameImmediate = setImmediate(() => {
      if (this.frameBatch !== batch || batch.generation !== this.clockGeneration) return;
      this.frameImmediate = null;
      this.pumpFrame(batch);
    });
  }

  tickOnce() {
    this.assertClockReady();
    const t0 = performance.now();
    const tick = this.engine.world.tick;
    if (this.recoveryForEdge) this.validPoses = { tick, poses: this.soulPoses() };
    // 1. apply queued inputs at this tick, logging them
    this.drainInputs();
    if (this.repairRules && !this.clockAvailable) return;   // a repair in that drain couldn't be written: a named halt, not a throw
    // 2. step the engine
    let out: ReturnType<Engine['step']>;
    const previousViolations = this.engine.runtime.violations.length;
    const tStep = performance.now();
    try { out = this.stepEngine(); if (this.engine.runtime.violations.length > previousViolations) throw new Error(JSON.stringify(this.engine.runtime.violations.slice(previousViolations))); }
    catch (error) { for (const r of out!?.refusals ?? []) this.countRefusal(r); if (this.repairRules) { this.kernel.tick = this.engine.world.tick; sweep(this.kernel); this.faultedPrograms = out!?.programs ?? null; } this.noteFaultedTick(error); this.recoverFault(error); this.faultedPrograms = null; if (this.stepFailing && this.clockAvailable && this.snapshotDue()) this.snapshotFaultedHead(); return; }
    this.noteCleanTick();
    this.advanceLives();
    this.kernel.tick = this.engine.world.tick;
    sweep(this.kernel);
    this.acc.paths.push(...out.paths);
    this.acc.changes.push(...out.changes);
    for (const c of out.changes) { const m = this.mindByEntity.get(c[1]); if (m) this.acc.dirty.add(m.soulId); }
    this.reconcileIntentObservations();
    this.observeIntentActions();
    this.afterPrograms(out.programs, false);
    if (out.refusals) this.noteRefusals(out.refusals);
    if (this.repairRules && !this.clockAvailable) return;
    this.replayDebtMs += performance.now() - tStep;
    if(this.durableClockV1){
      // Derived effects become durable before this elapsed body tick is sent.
      // Listener-generated next inputs retain their ordinary queue semantics.
      this.drainInputs();
      if(this.repairRules&&!this.clockAvailable)return;
      this.persistClockFrontier();
    }
    for (const ev of out.events) for (const l of this.listeners) l.onRuntimeEvent?.(ev);
    const now = this.engine.world.tick;
    const tickContext = Object.freeze({ startedAtMs: t0 });
    for (const l of this.listeners) l.afterTick?.(now, tickContext);
    // 3. broadcast
    if (now % BATCH_TICKS === 0) this.flush();
    if (now % HEARTBEAT_TICKS === 0) this.heartbeat();
    if (this.snapshotDue(now)) this.schedulePeriodicSnapshot();
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 400) this.tickMs.splice(0, 200);
    if (this.splitTap) this.splitTap(now, out); // never throws (DeltaTap.onTick); reads only
    for (const l of this.listeners) { try { l.afterTickComplete?.(now); } catch { /* observers cannot undo a completed tick */ } }
  }

  /** Accept queued inputs without advancing the engine or starting new mind work. */
  drainInputs() {
    this.assertClockReady();
    const tick = this.engine.world.tick;
    const pending = this.queue.splice(0);
    for (const p of pending) {
      // Live request authority is checked immediately before the acceptance
      // point. Refusals are not simulation faults and consume no log sequence.
      // Accepted events replay as facts, without consulting these closures.
      if (p.guard && !p.journal) {
        try { checkAcceptanceGuard(p.guard); }
        catch (error) { p.reject!(error); continue; }
      }
      const e: LogEvent = { seq: this.seq + 1, tick, kind: p.kind, author: p.author, payload: p.payload, at: Date.now() };
      if(e.kind==='station-rules-era-v1'){
        p.reject?.(new Error('station era must be committed with its physical checkpoint'));continue;
      }
      if(isStationFactV1(e.kind)){
        try {
          if(this.extra.stationEraV1||this.extra.stationV2)throw new Error('V1 station producer is unavailable after a versioned station checkpoint');
          foldStationFactV1(this.stationHistoryV1(),e,this.stationBindingV1()); }
        catch(error){p.reject?.(error);continue;}
      }
      if(e.kind==='station-cue-v2'||e.kind==='station-anchor-v2'){
        try{foldStationFactV2(this.stationHistoryV2()!,this.stationHistoryV1()!,e,this.stationPhysicalHeadV1()!);}
        catch(error){p.reject?.(error);continue;}
      }
      const arrival=this.extra.intentArrivalV1&&e.kind==='play'?captureIntentArrivalV1(this,e):undefined;
      let admission: LogEvent | undefined;
      let stationEra:LogEvent|undefined;
      let preview: FoldResult | undefined;
      if(p.atomicObjectDecision){
        // Only the new object/body producer selects this boundary. Legacy facts
        // and replay retain their original fold. No transaction crosses await.
        let baseline:SnapshotBody|undefined;const acc=structuredClone(this.acc),kernelDirty=this.kernelDirty;
        let notify=()=>{};const decisionNotices:(()=>void)[]=[];
        try{
          checkAcceptanceGuard(p.guard!);baseline=this.captureBody();
          tx(this.db.db,()=>{
            checkAcceptanceGuard(p.guard!);this.db.appendEvent(this.worldId,e);
            const folded=this.apply(e,false,notice=>decisionNotices.push(notice));
            if(!folded?.programOk||!folded.programId)throw new Error('object.native-admission-refused:'+String(folded?.programCode??'unknown'));
            if(p.journal!(e)!==true)throw new TypeError('acceptance journal must synchronously return true');
          },{immediate:true,deferNotifications:n=>{notify=n;}});
        }catch(error){if(baseline)this.restoreBody(baseline);this.acc=acc;this.kernelDirty=kernelDirty;p.reject!(error);continue;}
        this.seq=e.seq;this.acc.log.push(e);
        notify();for(const notice of decisionNotices)notice();
        for(const l of this.listeners)try{l.onApplied?.(e);}catch{/* advisory faults cannot strand a committed object request */}
        p.resolve?.(e);continue;
      }
      if (p.journal) {
        // Accepted log fact and its private request reference either both exist
        // or neither does. Check current DB authority under the same write lock.
        // A tracked transaction, so a journal's after-commit notices (edge receipts, streams) run once it commits.
        try {
          tx(this.db.db, () => {
            checkAcceptanceGuard(p.guard!);
            if(p.stationEra)stationEra=this.stationEraEvent(e);
            if (p.purpose) {
              preview = this.previewIntentAdmission(e);
              admission = this.intentAdmissionEvent(e, p.purpose, preview);
            }
            this.db.appendEvent(this.worldId, e);
            if (admission) this.db.appendEvent(this.worldId, admission);
            if(stationEra)this.db.appendEvent(this.worldId,stationEra);
            if(arrival){this.db.appendEvent(this.worldId,arrival);journalIntentArrivalV1(this,arrival);}
            if (p.journal!(e) !== true) throw new TypeError('acceptance journal must synchronously return true');
          }, {immediate: true});
        } catch (error) { p.reject!(error); continue; }
      } else if(arrival){this.db.db.exec('BEGIN IMMEDIATE');try{this.db.appendEvent(this.worldId,e);this.db.appendEvent(this.worldId,arrival);journalIntentArrivalV1(this,arrival);this.db.db.exec('COMMIT');}catch(error){this.db.db.exec('ROLLBACK');this.clockFailure=error;this.paused=true;this.stop();this.recordGlitch('halt',error,{rule:'durability.arrival'});for(const listener of this.listeners)try{listener.onClockUnavailable?.();}catch{}throw error;}}else this.db.appendEvent(this.worldId, e);
      this.seq = arrival?.seq ?? stationEra?.seq ?? admission?.seq ?? e.seq;
      let recovered = false;
      let result: FoldResult | undefined;
      try {
        result = this.apply(e, false);
        if (preview && (!result || result.programId !== preview.programId || result.programOk !== preview.programOk || result.programCode !== preview.programCode))
          throw new Error('purpose admission preview differs from live fold');
        if (admission) this.apply(admission, false);
        if(stationEra)this.apply(stationEra,false);
        if(arrival)this.apply(arrival,false);
      } catch (error) {
        if(arrival||stationEra||e.payload?.soulProfileV1||e.payload?.crewRemovalTransition||e.payload?.nativeSleepSnapshotPolicy||e.payload?.commonsNewcomerResources||e.payload?.commonsProvisions||e.payload?.commonsKitchen||e.payload?.retainedCommonsShore||e.payload?.commonsFoodDelivery||e.payload?.socialEden||e.payload?.edenLecture||e.payload?.edenGround||e.payload?.existingGreenLandmark){
          // A committed structural pair cannot be attributed to an unrelated
          // card or filtered out by card-fault recovery. Restore exact history.
          try{
            this.minds.clear();this.mindByEntity.clear();this.seq=0;this.extra={};this.counts={};
            this.boot();this.ring=[];recovered=true;
          }catch(restartError){this.stop();p.reject?.(restartError);throw restartError;}
        }else {this.recoverFault(error, e.kind === 'decision' ? e.payload.card : undefined, e.kind === 'decision' && !e.payload?.card ? {seq: e.seq, entityId: e.payload?.entityId} : undefined); recovered = true;}
      }
      if (this.repairRules && !this.clockAvailable) { for (const q of pending.slice(pending.indexOf(p))) q.reject?.(this.clockFailure); return; }   // nothing more may be written from this head
      const accepted=[e,...(admission?[admission]:[]),...(stationEra?[stationEra]:[]),...(arrival?[arrival]:[])];
      if (!recovered||arrival||stationEra||e.payload?.soulProfileV1||e.payload?.crewRemovalTransition||e.payload?.nativeSleepSnapshotPolicy||e.payload?.commonsNewcomerResources||e.payload?.commonsProvisions||e.payload?.commonsKitchen||e.payload?.retainedCommonsShore||e.payload?.commonsFoodDelivery||e.payload?.socialEden||e.payload?.edenLecture||e.payload?.edenGround||e.payload?.existingGreenLandmark) this.acc.log.push(...accepted);
      // No listener can observe a physical event before its committed era fold.
      for (const fact of accepted) for (const l of this.listeners) l.onApplied?.(fact);
      if (admission && recovered) { p.reject?.(new PersistedIntentAdmissionFault(e.seq)); continue; }
      p.resolve?.(e);
    }
  }

  /** React to the engine's progress on depiction programs: apply a card's effects when its approach is done. */
  private afterPrograms(events: ProgramEvent[], replay: boolean) {
    for (const ev of events) {
      const completedSequenceBinding=ev.kind==='completed'&&this.extra.intentNativeSequenceCompletionV1?Object.values(this.intentBindings()).find(b=>b.payload.activityId===ev.id&&b.payload.decision.entityId===ev.actor):undefined;
      if(!replay)this.observeIntentTerminal(ev);
      const m = this.mindByEntity.get(ev.actor); if (!m) continue;
      const transition=(this.extra.intentHumanSleepTransitionsV1 as Record<string,IntentSleepStopV1>|undefined)?.[m.soulId];
      if(ev.kind!=='step'&&transition?.programId===ev.id){delete (this.extra.intentHumanSleepTransitionsV1 as Record<string,IntentSleepStopV1>)[m.soulId];m.nextEvalTick=Math.min(m.nextEvalTick,ev.tick+1);m.evalTrigger='new-intent-v2';m.lastFingerprint='';}
      const mine = m.pending && m.pending.program === ev.id ? m.pending : null;
      const playNow = () => {
        if (!mine || mine.applied) return;
        mine.applied = true;
        // during replay the play is already in the log
        if (!replay) void this.enqueue('play', `soul:${m.soulId}`, { soulId: m.soulId, card: mine.card, hash: mine.hash, target: mine.target, ...(mine.manner ? { manner: mine.manner } : {}) } satisfies PlayPayload);
      };
      if(ev.kind==='completed'&&this.extra.intentNativeSequenceCompletionV1&&mine){const binding=completedSequenceBinding;const entry=binding?this.intentHistoryOf(m.soulId).intents[binding.payload.intent.intentId]:undefined;if(binding&&entry?.status==='active'&&entry.revision.version===binding.payload.intent.version&&entry.revision.interpretation.humanGoalPlan?.kind==='planned'){const index=this.intentSequenceStepV1(m.soulId,binding.payload.intent),step=entry.revision.interpretation.agenda[index];if(step?.card===mine.card&&(step.target??null)===mine.target){const progress=(this.extra.intentSequenceProgressV1??={}) as Record<string,number>;progress[JSON.stringify([m.soulId,binding.payload.intent.intentId,binding.payload.intent.version])]=index+1;}}}
      if (ev.kind === 'step') { if (mine && ev.step >= mine.approachLen) playNow(); }
      else {
        if (ev.kind === 'completed') playNow();
        const outcome = ev.kind === 'completed' ? 'done' : ev.kind === 'failed' ? `could not: ${ev.code}` : 'interrupted';
        // a program replaced by a newer decision, or stopped because its card was refused, is not news
        if (ev.kind === 'failed' || (ev.kind === 'completed' && !mine) || (ev.kind === 'cancelled' && mine && ev.code !== 'program.stopped')) m.recent = [...m.recent.slice(-3), `${shorten(m.doing)} (${outcome})`];
        if (mine) m.pending = null;
        if (mine && ev.kind === 'failed') m.avoid = { id: mine.option ?? (mine.target ? `${mine.card}@${mine.target}` : mine.card), untilTick: ev.tick + 1200 };
        if (mine && ev.kind === 'failed' && m.agendaPos < m.agenda.length) m.planBlockedSince ??= ev.tick;
        // D1: a program stopped with nothing after it (stand:here ended a lie-down) no longer names the old plan; one replaced
        // by a newer decision keeps the new label, which that decision already wrote
        if (ev.kind === 'cancelled' && !this.engine.programOf(ev.actor)) m.doing = 'standing around';
        if (ev.kind !== 'cancelled') {
          m.doing = 'standing around';
          // re-evaluate shortly after an activity ends; jitter by soul so they do not all think on the same tick
          m.nextEvalTick = Math.min(m.nextEvalTick, ev.tick + 10 + (hash32(m.soulId) % 30));
          m.evalTrigger = ev.kind === 'completed' ? 'activity-ended' : 'activity-failed';
        }
        this.acc.dirty.add(m.soulId);
      }
      if (!replay) for (const l of this.listeners) l.onProgram?.(ev, m);
    }
  }

  // ------------------------------------------------------------ inputs
  /** Queue an input; it is logged and applied at the next tick. Resolves with the logged event. */
  enqueue(kind: EventKind, author: string, payload: unknown): Promise<LogEvent> {
    this.assertClockReady();
    return new Promise((resolve) => this.queue.push({ kind, author, payload, resolve }));
  }

  /** Opt-in live request check at the sequencer, before any durable event/effect.
   * The guard is never serialized or replayed. It must not enqueue or mutate.
   * An optional journal writes to this Db atomically with the accepted event.
   * Queued requests remain ephemeral; this does not provide durable retries. */
  enqueueChecked(kind: EventKind, author: string, payload: unknown, guard: AcceptanceGuard, journal?: AcceptanceJournal): Promise<LogEvent> {
    this.assertClockReady();
    const current:AcceptanceGuard=()=>{checkAcceptanceGuard(guard);if(kind==='decision'){const p=payload as DecisionPayload;if(!this.ownLectureRosterV1(p.soulId,p.steps))throw new StaleIntentAttempt();}return true;};
    return new Promise((resolve, reject) => this.queue.push({ kind, author, payload, guard:current, journal, resolve, reject }));
  }

  /** Atomic object/body producer: commit its side effects only after the real
   * decision fold succeeds; restore the exact captured native/kernel head on failure. */
  enqueueObjectDecision(author:string,payload:unknown,guard:AcceptanceGuard,journal:AcceptanceJournal):Promise<LogEvent>{
    this.assertClockReady();const current:AcceptanceGuard=()=>{checkAcceptanceGuard(guard);const p=payload as DecisionPayload;if(!this.ownLectureRosterV1(p.soulId,p.steps))throw new StaleIntentAttempt();return true;};
    return new Promise((resolve,reject)=>this.queue.push({kind:'decision',author,payload,guard:current,journal,atomicObjectDecision:true,resolve,reject}));
  }

  /** Internal opt-in choice producer. No wire operation accepts a purpose ref
   * or activity claim. The original caller fence still owns final authority. */
  ownLectureRosterV1(soulId:string,steps:import('@souls/engine-contract').Program['steps']){const leader=this.minds.get(soulId);if(!leader)return false;for(const step of steps){if(step.verb==='control_classroom_v1'){const ids=typeof step.params.session==='string'?this.engine.ownedClassroomControlRosterV1?.(leader.entityId,step.params.session):null;if(!ids)return false;for(const id of ids){const m=this.mindByEntity.get(id),row=m?this.db.soul(m.soulId):undefined;if(!m||!row||row.retired_at!==null||row.world_id!==this.worldId||row.owner!==leader.owner||row.entity_id!==id||this.kernel.things[m.soulId]?.traits.body!==id)return false;}continue;}if(step.verb!=='mars:classroom_session')continue;const p=step.params as {host?:string;presenters?:string[];audience?:string[]};if(p.host!==leader.entityId||!Array.isArray(p.presenters)||!Array.isArray(p.audience))return false;const ids=[p.host,...p.presenters,...p.audience];if(new Set(ids).size!==ids.length)return false;for(const id of ids){const m=this.mindByEntity.get(id),row=m?this.db.soul(m.soulId):undefined;if(!m||!row||row.retired_at!==null||row.world_id!==this.worldId||row.owner!==leader.owner||m.owner!==leader.owner||row.entity_id!==id||this.kernel.things[m.soulId]?.traits.body!==id||!this.engine.world.entities[id])return false;}}return true;}
  enqueueIntentDecision(author: string, payload: DecisionPayload, raw: PurposeRef, guard: AcceptanceGuard): Promise<LogEvent> {
    this.assertClockReady();
    const purpose = intentReferenceV2Schema.parse(raw), mind = this.minds.get(payload.soulId);
    if (!mind || payload.entityId !== mind.entityId || payload.continue || !payload.steps.length)
      return Promise.reject(new Error('purpose attempt requires its current body and an actual program'));
    const decision = structuredClone(payload);
    const legacyVersion = mind.intentVersion;
    const current = () => {
      checkAcceptanceGuard(guard);
      if(!this.ownLectureRosterV1(decision.soulId,decision.steps))throw new StaleIntentAttempt();
      const row = this.db.soul(decision.soulId), entry = this.intentHistoryOf(decision.soulId).intents[purpose.intentId];
      if (this.minds.get(decision.soulId) !== mind || mind.intentVersion !== legacyVersion || this.quietBarrier
        || !row || row.retired_at !== null || row.world_id !== this.worldId
        || row.owner !== mind.owner || row.entity_id !== decision.entityId
        || this.kernel.things[decision.soulId]?.traits.body !== decision.entityId || !this.engine.world.entities[decision.entityId]
        || !entry || entry.status !== 'active' || entry.revision.version !== purpose.version || entry.revision.source.ownerId !== row.owner)
        throw new StaleIntentAttempt();
      return true as const;
    };
    // Under the writer lock, use the engine's read-only admission calculation
    // (or a detached exact checkpoint for adapters without that capability).
    // The ordinary decision and named private fact commit before live effects.
    return new Promise((resolve, reject) => this.queue.push({ kind:'decision', author, payload:decision,
      guard:current, journal:()=>true, purpose, resolve, reject }));
  }

  private previewIntentAdmission(decision: LogEvent): FoldResult {
    const p = decision.payload as DecisionPayload;
    const program = structuredClone({ actor:p.entityId, label:p.label, steps:p.steps });
    let result;
    if (this.engine.previewAdmission) result = this.engine.previewAdmission(program);
    else {
      if (this.engine.canSnapshot?.() === false) throw new IntentAdmissionDeferred();
      const snapshot = this.engine.snapshot(), trial = this.factory.restore(structuredClone(snapshot));
      if (trial === this.engine || trial.world === this.engine.world || trial.world.tick !== decision.tick
        || trial.stateHash() !== snapshot.stateHash || this.engine.stateHash() !== snapshot.stateHash)
        throw new IntentAdmissionDeferred();
      result = trial.perform(program);
    }
    return { programId:result.id, programOk:result.ok, programCode:result.diagnostic?.code };
  }

  private intentAdmissionEvent(decision: LogEvent, intent: PurposeRef, result: FoldResult): LogEvent {
    if (decision.kind !== 'decision' || !result.programId || result.programOk === undefined)
      throw new Error('purpose attempt lacks an admission result');
    const p = decision.payload as DecisionPayload;
    const body = { contract:INTENT_V2, worldId:this.worldId, soulId:p.soulId, intent,
      attemptId:`a_${decision.seq}`, activityId:result.programId,
      decision:{ seq:decision.seq, tick:decision.tick, entityId:p.entityId } };
    const payload: IntentAdmissionPayloadV2 = result.programOk ? { ...body, phase:'accepted' }
      : { ...body, phase:'blocked', reason:result.programCode ?? 'program refused' };
    const e: LogEvent = { seq:decision.seq+1, tick:decision.tick, kind:'intent-admission-v2',
      author:'world:intent-admission', payload, at:Date.now() };
    // Validate before committing either fact. Live fold must match this exact
    // result; replay uses the durable pair without models or current authority.
    const fact = intentAdmissionFactV2(e);
    foldIntentHistoryV2(this.intentHistoryOf(p.soulId), fact);
    return e;
  }

  private intentBindings():Record<string,ActivityBinding> {
    return this.extra.intentActivityBindingsV2 as Record<string,ActivityBinding> ?? {};
  }
  unfinishedHumanGoalExecutionV1(soulId:string){
    if(!this.extra.intentExecutionRetentionV1||this.quietBarrier)return null;const m=this.minds.get(soulId),row=this.db.soul(soulId);if(!m?.pending||m.activeRule||!row||row.world_id!==this.worldId||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId||this.kernel.things[soulId]?.traits.body!==m.entityId||!this.engine.world.entities[m.entityId]||this.engine.programOf(m.entityId)!==m.pending.program)return null;
    const binding=Object.values(this.intentBindings()).find(b=>b.payload.soulId===soulId&&b.payload.decision.entityId===m.entityId&&b.payload.activityId===m.pending!.program);if(!binding)return null;const history=this.intentHistoryOf(soulId),entry=history.intents[binding.payload.intent.intentId];if(entry?.status!=='active'||entry.revision.version!==binding.payload.intent.version||entry.revision.source.ownerId!==m.owner||entry.revision.interpretation.trigger.kind!=='now'||entry.revision.interpretation.humanGoalPlan?.kind!=='planned')return null;
    const latest=latestPurposeDirectionV1(history,m.owner,this.extra.intentRetainedChoiceV1===true);if(latest?.revision.intentId!==entry.revision.intentId||latest.revision.version!==entry.revision.version){const source=this.db.events(this.worldId,binding.payload.decision.seq-1,1)[0];if(!this.extra.intentRetainedChoiceV1||source?.kind!=='decision'||source.payload.trigger!=='retained-choice/1'||source.payload.soulId!==soulId||source.payload.entityId!==m.entityId||this.intentWillSeqOf(soulId)>source.seq)return null;}const action=this.engine.programAction?.(m.pending.program)?.action;if(action?.status==='blocked')return null;return {intent:{intentId:entry.revision.intentId,version:entry.revision.version},activityId:m.pending.program};
  }
  unfinishedIntentApproachV1(soulId:string){
    if(!this.extra.intentApproachRetentionV1||this.quietBarrier)return null;const m=this.minds.get(soulId),row=this.db.soul(soulId);if(!m?.pending||m.activeRule||!row||row.world_id!==this.worldId||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId||this.kernel.things[soulId]?.traits.body!==m.entityId||!this.engine.world.entities[m.entityId]||this.engine.programOf(m.entityId)!==m.pending.program)return null;
    const binding=Object.values(this.intentBindings()).find(b=>b.payload.soulId===soulId&&b.payload.decision.entityId===m.entityId&&b.payload.activityId===m.pending!.program);if(!binding)return null;
    const history=this.intentHistoryOf(soulId),entry=history.intents[binding.payload.intent.intentId];if(entry?.status!=='active'||entry.revision.version!==binding.payload.intent.version||entry.revision.source.ownerId!==m.owner||entry.revision.interpretation.trigger.kind!=='now')return null;
    const latest=latestPurposeDirectionV1(history,m.owner,this.extra.intentRetainedChoiceV1===true);if(latest?.revision.intentId!==entry.revision.intentId||latest.revision.version!==entry.revision.version)return null;
    const action=this.engine.programAction?.(m.pending.program)?.action;if(action?.status==='blocked')return null;
    const incomplete=!m.pending.applied||!!action&&['walk_to','commons_shore_travel'].includes(action.verb)||!!action&&action.verb==='sit'&&action.phase!=='occupied';
    return incomplete?{intent:{intentId:entry.revision.intentId,version:entry.revision.version},activityId:m.pending.program}:null;
  }
  private controllerScope(binding:ActivityBinding) {
    const p=binding.payload;
    return {contract:INTENT_V2,worldId:this.worldId,soulId:p.soulId,intent:p.intent,attemptId:p.attemptId,
      activityId:p.activityId,admissionSeq:binding.admissionSeq};
  }
  private observeIntentActions() {
    if(!this.engine.programAction)return;
    for(const binding of Object.values(this.intentBindings())) {
      const p=binding.payload,history=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[p.soulId];
      const out=history?.attempts[p.attemptId],entry=history?.intents[p.intent.intentId];
      if(out?.phase!=='accepted' || entry?.status!=='active' || entry.revision.version!==p.intent.version)continue;
      const observed=this.engine.programAction(p.activityId);
      if(!observed || observed.programId!==p.activityId || observed.actor!==p.decision.entityId || observed.action.status!=='executing')continue;
      this.recordIntentController({...this.controllerScope(binding),phase:'started',
        observation:{tick:observed.tick,actor:observed.actor,action:{...observed.action,status:'executing'}}});
    }
  }
  private observeIntentTerminal(ev:ProgramEvent) {
    if(ev.kind==='step')return;
    for(const binding of Object.values(this.intentBindings())) {
      const p=binding.payload;
      if(p.activityId!==ev.id || p.decision.entityId!==ev.actor)continue;
      const previous=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[p.soulId]?.attempts[p.attemptId];
      if(previous?.phase!=='accepted' && previous?.phase!=='started')continue;
      const scope=this.controllerScope(binding),observation={tick:ev.tick,actor:ev.actor};
      if(ev.kind==='completed') {
        // Wait-only/no-op programs have no executing-action observation. Do not
        // manufacture a start to make their completion fit the ledger.
        let capturedStart=previous.phase==='started';
        try { capturedStart ||= this.intentObservations.hasCapturedStart(p.attemptId); }
        catch { this.intentControllerNotice(p.attemptId); }
        if(capturedStart)this.recordIntentController({...scope,phase:'completed',observation:{...observation,programKind:'completed'}});
      }else if(ev.kind==='failed')this.recordIntentController({...scope,phase:'blocked',reason:ev.code??'program failed',
        observation:{...observation,programKind:'failed',...(ev.code?{code:ev.code}:{})}});
      else this.recordIntentController({...scope,phase:'interrupted',reason:ev.code??'program cancelled',
        observation:{...observation,programKind:'cancelled',...(ev.code?{code:ev.code}:{})}});
    }
  }
  private recordIntentController(payload:IntentControllerPayloadV2) {
    try {
      this.intentObservations.capture(payload);
      this.reconcileIntentObservations();
    }catch {
      this.intentControllerNotice(payload.attemptId);
    }
  }
  private intentControllerNotice(attemptId:string) {
    // Persistence failure is not a physical controller fault. Report once per
    // process; keep captured evidence, without reissuing or guessing progress.
    if(this.intentControllerFaults.has(attemptId))return;
    this.intentControllerFaults.add(attemptId);
    console.error('[world] controller history requires reconciliation');
  }
  /** Publish at most 20 captured observations at or before current world time.
   * Explicitly callable while paused; boot itself remains read-only for these
   * facts. Earlier capture tick is retained in the observation, not rewritten. */
  reconcileIntentObservations():number {
    if(Object.keys(this.intentBindings()).length===0)return 0;
    let pending:IntentControllerPayloadV2[];
    try {pending=this.intentObservations.pending(this.engine.world.tick);}
    catch {this.intentControllerNotice('journal');return 0;}
    let published=0;
    for(const payload of pending) {
      try {
        const e:LogEvent={seq:this.seq+1,tick:this.engine.world.tick,kind:'intent-controller-v2',author:'world:intent-controller',payload,at:Date.now()};
        const fact=intentControllerFactV2(e);
        this.intentObservations.publish(payload,e,()=>{foldIntentHistoryV2(this.intentHistoryOf(payload.soulId),fact);});
        this.seq=e.seq;this.apply(e,false);this.acc.log.push(e);published++;
        for(const l of this.listeners)l.onApplied?.(e);
      }catch {this.intentControllerNotice(payload.attemptId);break;}
    }
    return published;
  }

  /** Apply a logged event: the fold moves the engine and the kernel; this adds the minds' bookkeeping. */
  apply(e: LogEvent, replay: boolean,deferDecisionNotice?:(notify:()=>void)=>void) {
    const tick = e.tick;
    if(e.kind==='rules'&&e.payload?.lastRungInPlace)for(const m of this.minds.values())m.pending=null;
    if(e.kind==='rules'&&e.payload?.reflection?.episodeMemory){
      const p=e.payload,record=p.reflection.episodeMemory,m=this.minds.get(p.soulId);
      if(!this.extra.intentEpisodeMemoryV1||!m||record.contract!=='private-purpose-episodes/1'||record.proseKind!=='interpretation'||!Number.isSafeInteger(record.throughSeq)||record.throughSeq<0||record.throughSeq>=e.seq||Object.keys(record).sort().join(',')!=='contract,episodes,proseKind,throughSeq'||JSON.stringify(record.episodes)!==JSON.stringify(episodesFromHistoryV1(this.intentHistoryOf(p.soulId),m.owner,record.throughSeq)))throw Error('purpose-episodes.invalid-source');
    }
    if(e.kind==='intent-sleep-stop-v1'){
      const p=intentSleepStopV1Schema.parse(e.payload),history=this.intentHistoryOf(p.soulId);
      const entry=history.intents[p.intent.intentId],m=this.minds.get(p.soulId);
      const latest=Object.values(history.intents)
        .filter(v=>v.revision.source.ownerId===m?.owner&&v.revision.interpretation.trigger.kind==='now')
        .sort((a,b)=>b.revision.submitted.seq-a.revision.submitted.seq)[0];
      if(!this.extra.intentHumanSleepTransitionV1||p.worldId!==this.worldId||!m||m.entityId!==p.entityId
        ||entry?.status!=='active'||entry.revision.version!==p.intent.version
        ||latest?.revision.intentId!==p.intent.intentId||latest.revision.version!==p.intent.version
        ||entry.revision.interpretation.humanGoalPlan?.kind!=='planned')throw Error('human-sleep-transition.invalid-purpose');
    }
    // where the actor's plan stood just before this play (a play further down the plan must not skip a step that was possible)
    const pm = e.kind === 'play' ? this.minds.get((e.payload as PlayPayload).soulId) : undefined;
    const reach = pm && pm.agendaPos < pm.agenda.length ? frontier(this, pm) : -1;
    const matchedStep = pm ? stepIndex(this, pm, (e.payload as PlayPayload).card, (e.payload as PlayPayload).target) : -1;
    if (e.kind === 'rules' && e.payload?.recovery) { this.restoreRecovery(e.payload.recovery as RecoveryRecipe); this.seq = e.seq; return; }
    if(e.kind==='rules'&&e.payload?.crewRemovalTransition&&this.stationHistoryV1())throw Error('crew-removal-transition.station-carry-required');
    if(e.kind==='rules'&&e.payload?.existingGreenLandmark&&this.stationHistoryV1())throw Error('green-landmark.station-carry-required');
    if(e.kind==='rules'&&e.payload?.edenGround&&this.stationHistoryV1())throw Error('eden-ground.station-carry-required');
    if(e.kind==='rules'&&e.payload?.edenLecture&&this.stationHistoryV1())throw Error('eden-lecture.station-carry-required');
    if(e.kind==='rules'&&e.payload?.socialEden&&this.stationHistoryV1())throw Error('social-eden.station-carry-required');
    if(e.kind==='rules'&&e.payload?.nativeSleepSnapshotPolicy&&this.stationHistoryV1())throw Error('sleep-snapshot.station-carry-required');
    if(e.kind==='rules'&&e.payload?.commonsNewcomerResources&&this.stationHistoryV1())throw Error('newcomer-resources.station-carry-required');
    if(e.kind==='rules'&&e.payload?.commonsFoodDelivery&&this.stationHistoryV1())throw Error('food-delivery.station-carry-required');
    if(e.kind==='rules'&&e.payload?.retainedCommonsShore&&this.stationHistoryV1())throw Error('retained-shore.station-carry-required');
    if(e.kind==='rules'&&e.payload?.commonsKitchen&&this.stationHistoryV1())throw Error('commons-kitchen.station-carry-required');
    if(e.kind==='rules'&&e.payload?.commonsProvisions&&this.stationHistoryV1())throw Error('commons-provisions.station-carry-required');
    const r = foldEvent(this.engine, this.kernel, e, this.counts);
    if(e.kind==='decision'&&!replay){const notify=()=>{for(const l of this.listeners)l.onDecision?.(e,r);};if(deferDecisionNotice)deferDecisionNotice(()=>{for(const l of this.listeners)try{l.onDecision?.(e,r);}catch{/* committed advisory faults cannot skip later observers */}});else notify();}
    if(isStationFactV1(e.kind))this.extra.stationV1=foldStationFactV1(this.stationHistoryV1(),e,this.stationBindingV1());
    if(e.kind==='station-rules-era-v1'){
      const old=this.extra.stationV1 as StationHistoryV1|undefined;
      if(!old)throw new Error('station era has no original station');
      const source=this.db.events(this.worldId,e.payload.source.seq-1,1)[0];
      if(!source||source.kind!=='rules'||source.seq!==e.payload.source.seq||Object.keys(source.payload).length!==1||(!source.payload.commonsTransition&&!source.payload.campExpansion))
        throw new Error('station era lacks exact canonical physical source');
      const physical=stationSourceFromRulesV1(this.worldId,source);
      const folded=foldStationRulesEraV1(this.extra.stationEraV1 as StationEraFoldStateV1|undefined,
        {seq:e.seq,tick:e.tick,payload:e.payload},physical,old.station);
      acceptStationPhysicalHeadV1(folded.head,old.station,this.stationBindingV1());
      this.extra.stationEraV1=folded;
      this.extra.stationV2={...(this.extra.stationV2 as StationHistoryV2|undefined??initialStationHistoryV2(old)),lastFactSeq:e.seq};
    }
    if(e.kind==='station-cue-v2'||e.kind==='station-anchor-v2')
      this.extra.stationV2=foldStationFactV2(this.stationHistoryV2()!,this.stationHistoryV1()!,e,this.stationPhysicalHeadV1()!);
    switch (e.kind) {
      case 'intent-sleep-stop-v1': {
        const p=intentSleepStopV1Schema.parse(e.payload);this.extra.intentHumanSleepTransitionsV1??={};
        (this.extra.intentHumanSleepTransitionsV1 as Record<string,IntentSleepStopV1>)[p.soulId]=p;
        const m=this.minds.get(p.soulId)!;m.nextEvalTick=tick+1;m.evalTrigger='new-intent-v2';m.lastFingerprint='';this.acc.dirty.add(m.soulId);break;
      }
      case 'intent-request-v2': {
        const p = intentReceivedPayloadV2Schema.parse(e.payload);
        if (p.worldId !== this.worldId) throw new Error('private request belongs to another world');
        break;
      }
      case 'intent-v2': {
        const fact = intentHistoryFactV2(e);
        if (fact.worldId !== this.worldId) throw new Error('private purpose belongs to another world');
        const histories = (this.extra.intentHistoriesV2 ??= {}) as Record<string, IntentHistoryV2>;
        histories[fact.soulId] = foldIntentHistoryV2(this.intentHistoryOf(fact.soulId), fact);
        // Publication records understanding, not an admitted physical activity.
        // Choice/preemption integration remains behind the behavioral checkpoint.
        break;
      }
      case 'intent-admission-v2': {
        const fact = intentAdmissionFactV2(e), payload = e.payload as IntentAdmissionPayloadV2;
        if (fact.worldId !== this.worldId) throw new Error('private admission belongs to another world');
        const source = this.db.events(this.worldId, payload.decision.seq - 1, 1)[0];
        if (!source || source.seq !== payload.decision.seq || source.tick !== payload.decision.tick || source.kind !== 'decision'
          || source.payload.soulId !== fact.soulId || source.payload.entityId !== payload.decision.entityId || source.payload.continue)
          throw new Error('private admission lacks its canonical decision');
        const histories = (this.extra.intentHistoriesV2 ??= {}) as Record<string, IntentHistoryV2>;
        histories[fact.soulId] = foldIntentHistoryV2(this.intentHistoryOf(fact.soulId), fact);
        if(payload.phase==='accepted') {
          const bindings=(this.extra.intentActivityBindingsV2??={}) as Record<string,ActivityBinding>;
          bindings[payload.attemptId]={admissionSeq:e.seq,payload:structuredClone(payload)};
        }
        break;
      }
      case 'intent-arrival-v1': {const p=verifyIntentArrivalV1(this,e);const arrivals=(this.extra.intentArrivalsV1??={}) as Record<string,unknown>;if(arrivals[p.attemptId])throw Error('arrival attempt already recorded');arrivals[p.attemptId]=p;break;}
      case 'intent-controller-v2': {
        const fact=intentControllerFactV2(e),payload=e.payload as IntentControllerPayloadV2;
        if(fact.worldId!==this.worldId)throw new Error('private controller fact belongs to another world');
        const source=this.db.events(this.worldId,payload.admissionSeq-1,1)[0];
        if(!source || source.seq!==payload.admissionSeq || source.kind!=='intent-admission-v2')throw new Error('controller fact lacks canonical admission');
        const admitted=source.payload as IntentAdmissionPayloadV2;
        if(admitted.phase!=='accepted' || admitted.worldId!==this.worldId || admitted.soulId!==payload.soulId
          || admitted.activityId!==payload.activityId || admitted.attemptId!==payload.attemptId
          || admitted.intent.intentId!==payload.intent.intentId || admitted.intent.version!==payload.intent.version
          || admitted.decision.entityId!==payload.observation.actor)throw new Error('controller fact admission association changed');
        const histories=(this.extra.intentHistoriesV2??={}) as Record<string,IntentHistoryV2>;
        histories[fact.soulId]=foldIntentHistoryV2(this.intentHistoryOf(fact.soulId),fact);
        if(payload.phase!=='started')delete this.intentBindings()[payload.attemptId];
        break;
      }
      case 'edge-god-walkout':
      case 'edge-relocate':
      case 'edge-stop': {
        // G1: the reason is a durable part of a resident's next native observation too, and the resident re-thinks at
        // once (a walked-out or stopped native mind must not wait out its old timer standing where it was put).
        if (e.author === 'god:walkout') {
          const p = e.payload as { soulId: string; why: string }, m = this.minds.get(p.soulId);
          if (m) godNoticed(m, p.why, tick, true);
          if (m) this.acc.dirty.add(m.soulId);
        }
        break;
      }
      case 'birth': {
        const p = e.payload as BirthPayload;
        if (!this.minds.has(p.soulId)) this.addMind({
          soulId: p.soulId, entityId: p.entityId, name: p.name, description: p.description, owner: p.owner, native: p.owner === 'system',
          intent: null, intentVersion: 0, mood: 'curious', energy: 80, wantsCompany: 0.5, recent: ['arrived (done)'], doing: 'standing around',
          nextEvalTick: tick + 20 + (hash32(p.soulId) % 40), evalTrigger: 'birth', lastEnergyTick: tick, lastFingerprint: '', nudge: null,
          agenda: [], agendaPos: 0, pending: null,
          ...(this.extra.living ? { life: newLife(tick) } : {}),
        });
        this.acc.dirty.add(p.soulId); this.kernelDirty = true;
        break;
      }
      case 'mandate': {
        const p=e.payload,m=this.minds.get(p.soulId);if(!m)break;
        const rule=mandateOf(this.kernel,m.soulId).find(r=>r.id===(p.ruleId??p.rule?.id));
        if(p.op==='upsert'&&rule?.trigger.kind==='now'){
          m.activeRule=rule.id;m.intent={agenda:rule.agenda,text:rule.words};m.agenda=rule.agenda;m.agendaPos=0;m.planBlockedSince=undefined;
        }else if(m.activeRule===(p.ruleId??p.rule?.id)&&(p.op==='remove'||rule?.status!=='active'||p.op==='upsert')){
          m.activeRule=undefined;m.intent=null;m.agenda=[];m.agendaPos=0;m.planBlockedSince=undefined;
        }
        m.intentVersion++;m.nextEvalTick=tick+1;m.evalTrigger=p.op==='upsert'&&rule?.trigger.kind==='now'?'mandate-now':p.op==='wake'?'mandate-trigger':'mandate-changed';m.lastFingerprint='';
        this.acc.dirty.add(m.soulId);this.kernelDirty=true;break;
      }
      case 'intent': {
        const p = e.payload as IntentPayload; const m = this.minds.get(p.soulId);
        if (m) { m.intent = p.intent; m.agenda = p.intent.agenda ?? []; m.agendaPos = 0; m.planBlockedSince = undefined; m.intentVersion++; m.nextEvalTick = tick + 1; m.evalTrigger = 'new-intent'; m.lastFingerprint = ''; this.acc.dirty.add(m.soulId); }
        break;
      }
      case 'decision': {
        const p = e.payload as DecisionPayload; const m = this.minds.get(p.soulId);
        if (!m) break;
        const provisional = this.provisionalEval.get(p.soulId); this.provisionalEval.delete(p.soulId);
        const woken = provisional !== undefined && m.nextEvalTick < provisional;
        const thinkAt = (at: number, trigger: string) => { if (woken) m.nextEvalTick = Math.min(m.nextEvalTick, at); else { m.nextEvalTick = at; m.evalTrigger = trigger; } };
        if (p.continue) { if (p.mood) m.mood = p.mood; thinkAt(tick + p.reevalTicks, 'timer'); this.acc.dirty.add(m.soulId); break; }
        if (r.programId === undefined) break;
        if (p.mood) m.mood = p.mood;
        m.doing = r.programOk ? p.label : 'standing around';
        thinkAt(tick + (r.programOk ? p.reevalTicks : 40), r.programOk ? 'timer' : 'activity-failed');
        if (!r.programOk) { m.recent = [...m.recent.slice(-3), `${shorten(p.label)} (could not: ${r.programCode})`]; m.pending = null; m.avoid = { id: p.option, untilTick: tick + 1200 }; if (m.agendaPos < m.agenda.length) m.planBlockedSince ??= tick; }
        else if (p.card) {
          const card = this.kernel.vocab.cards[p.card];
          m.pending = { program: r.programId, card: p.card, hash: card?.hash ?? '', target: p.target ?? null, option: p.option, ...(p.manner ? { manner: p.manner } : {}), approachLen: p.approachLen ?? 0, applied: false };
        } else m.pending = null;
        this.acc.dirty.add(m.soulId);
        break;
      }
      case 'play': {
        const view = r.play!; const m = this.minds.get(view.soulId);
        this.kernelDirty = true;
        this.recentPlays.push(view); if (this.recentPlays.length > 200) this.recentPlays.shift();
        if (m) {
          const what = `${view.card}${view.targetName ? ` → ${view.targetName}` : ''}`;
          if (view.ok) {
            if(this.extra.intentSequencesV1){
              const latest=this.db.db.prepare("SELECT seq,payload FROM events WHERE world_id=? AND kind='decision' AND soul_id=? AND seq<? ORDER BY seq DESC LIMIT 1").get(this.worldId,m.soulId,e.seq) as {seq:number;payload:string}|undefined;
              const choice=latest?JSON.parse(latest.payload) as DecisionPayload:undefined;
              const binding=choice?.card===view.card&&choice.target===view.target
                ?Object.values(this.intentBindings()).find(b=>b.payload.decision.seq===latest!.seq&&b.payload.soulId===m.soulId&&b.payload.decision.entityId===m.entityId):undefined;
              const entry=binding?this.intentHistoryOf(m.soulId).intents[binding.payload.intent.intentId]:undefined;
              if(binding&&entry?.status==='active'&&entry.revision.version===binding.payload.intent.version&&!(this.extra.intentNativeSequenceCompletionV1&&entry.revision.interpretation.humanGoalPlan?.kind==='planned')){
                const index=this.intentSequenceStepV1(m.soulId,binding.payload.intent),step=entry.revision.interpretation.agenda[index];
                if(step&&step.card===view.card&&(!step.target||step.target===view.target)&&(!step.of||belongsTo(this,view.target,step.of))){
                  const progress=(this.extra.intentSequenceProgressV1??={}) as Record<string,number>;progress[JSON.stringify([m.soulId,binding.payload.intent.intentId,binding.payload.intent.version])]=index+1;
                  m.nextEvalTick=Math.min(m.nextEvalTick,tick+1);m.evalTrigger='plan-advanced';m.lastFingerprint='';
                }
              }
            }

            m.recent = [...m.recent.slice(-3), `${what} (done)`];
            if (m.life) { m.life.acts.push(what); if (m.life.acts.length > 100) m.life.acts.shift(); }
            const idx = matchedStep;
            if (idx >= 0 && idx <= Math.max(reach, m.agendaPos)) {
              m.agendaPos = idx + 1; m.planBlockedSince = undefined;
              if(m.activeRule&&m.agendaPos>=m.agenda.length&&!replay)void this.enqueue('mandate','world',{soulId:m.soulId,ruleId:m.activeRule,op:'status',patch:{status:'done',report:'The cards played and their objective changes are logged.'}});
              // the plan moved on: think again now, rather than sitting out the rest of this activity
              if (m.agendaPos < m.agenda.length) { m.nextEvalTick = Math.min(m.nextEvalTick, tick + 15); m.evalTrigger = 'plan-advanced'; m.lastFingerprint = ''; }
            }
            // anyone spoken to re-thinks soon: this is how asking and answering chain together
            // (small talk does not: the exchange has already happened, and waking the listener would only provoke a reply to the reply)
            for (const c of view.changes) if (c.op === 'say' && c.act !== 'chat' && c.act !== 'tell') { const o = this.minds.get(c.to); if (o) { o.nextEvalTick = Math.min(o.nextEvalTick, tick + 8 + (hash32(o.soulId) % 20)); o.evalTrigger = 'spoken-to'; o.lastFingerprint = ''; } }
          } else {
            m.recent = [...m.recent.slice(-3), `${what} (did not happen: ${view.reason})`];
            m.pending = null; m.doing = 'standing around'; m.avoid = { id: view.target ? `${view.card}@${view.target}` : view.card, untilTick: tick + (/^shore\.occupied-route\b/.test(String(view.reason)) ? 100 : 1200) }; // another body in the way clears quickly
            if (m.agendaPos < m.agenda.length) m.planBlockedSince ??= tick;
            m.nextEvalTick = Math.min(m.nextEvalTick, tick + 20); m.evalTrigger = 'activity-failed';
          }
          this.acc.dirty.add(m.soulId);
        }
        this.acc.plays.push(view);
        if (!replay) for (const l of this.listeners) l.onPlay?.(view, m);
        break;
      }
      case 'mint': case 'deck': this.kernelDirty = true; break;
      case 'scene': {
        const p = e.payload as ScenePayload; const b = p.beat;
        const until = tick + 20 * 120;
        const text = `${b.directive}${b.targets.length ? ` (${b.targets.join(', ')})` : ''}: ${b.flavor}`;
        for (const m of this.minds.values()) {
          const ent = this.engine.world.entities[m.entityId]; if (!ent) continue;
          const inRegion = this.engine.regionAt(ent.pose.p) === p.region;
          const named = b.kind !== 'scene' && b.targets.includes(m.name);
          if ((b.kind === 'scene' && inRegion && b.directive !== 'quiet') || named) {
            m.nudge = { text, untilTick: until };
            m.nextEvalTick = Math.min(m.nextEvalTick, tick + 5 + (hash32(m.soulId) % 60)); m.evalTrigger = 'narrator-beat';
          }
        }
        break;
      }
      case 'retire': {
        const p = e.payload as { soulId: string; entityId: string }; const m = this.minds.get(p.soulId);
        if (m) { this.minds.delete(m.soulId); this.mindByEntity.delete(m.entityId); this.acc.removed.push(m.soulId); }
        this.kernelDirty = true;
        break;
      }
      case 'rules': {
        if(e.payload?.intentArrivalV1)this.extra.intentArrivalV1=true;
        const p = e.payload;
        if(p?.soulProfileV1){
          const profile=soulProfileFactV1Schema.parse(p.soulProfileV1),m=this.minds.get(profile.soulId),previous=this.profileFact(profile.soulId);
          if(profile.worldId!==this.worldId||!m||m.owner!==profile.owner||m.entityId!==profile.entityId||m.name!==profile.fromName
            ||(previous?.revision??0)!==profile.fromRevision||(previous?.birthName??profile.birthName)!==profile.birthName)throw Error('soul-profile.identity');
          if(profile.fromName!==profile.name){const claims=(this.extra.soulNameClaimsV1??={}) as Record<string,string[]>;const key=profile.fromName.trim().normalize('NFKC').toLowerCase();claims[key]=[...new Set([...(claims[key]??[]),profile.soulId])];}
          m.name=profile.name;m.description=profile.description;
          ((this.extra.soulProfilesV1??={}) as Record<string,SoulProfileFactV1>)[profile.soulId]=structuredClone(profile);
          this.acc.dirty.add(m.soulId);this.kernelDirty=true;
        }
        // G1/R8: "the god changed something near you" for a native mind (GodNotices.notify with native: true).
        if(p?.godNoticeV1){const n=p.godNoticeV1 as {soulId?:unknown;text?:unknown},m=typeof n.soulId==='string'?this.minds.get(n.soulId):undefined;if(m&&typeof n.text==='string'&&n.text){godNoticed(m,n.text.slice(0,300),tick,false);this.acc.dirty.add(m.soulId);}}
        if(p?.intentNativeSequenceCompletionV1===true)this.extra.intentNativeSequenceCompletionV1=true;
        if(p?.intentExecutionRetentionV1===true)this.extra.intentExecutionRetentionV1=true;
        if(p?.intentApproachRetentionV1===true)this.extra.intentApproachRetentionV1=true;
        if(p?.intentHumanSleepTransitionV1===true)this.extra.intentHumanSleepTransitionV1=true;
        if(p?.intentRetainedChoiceV1===true)this.extra.intentRetainedChoiceV1=true;
        if(p?.intentEpisodeMemoryV1===true)this.extra.intentEpisodeMemoryV1=true;
        if(p?.intentPurposeEvidenceV1===true)this.extra.intentPurposeEvidenceV1=true;
        if(p?.intentPurposeRecallV1===true){if(!this.extra.intentPurposeEvidenceV1)throw Error('purpose-recall.evidence-policy-required');this.extra.intentPurposeRecallV1=true;}
        if(p?.intentSequencesV1===true&&!this.extra.intentSequencesV1){this.extra.intentSequencesV1=true;this.extra.intentSequencesSinceV1=e.seq;}
        if (p?.kernelBootstrap || p?.vocabulary || p?.adoptCamp || p?.commonsTransition || p?.campExpansion) this.kernelDirty = true;
        if(p?.commonsTransition||p?.campExpansion)for(const m of this.minds.values()){
          m.nextEvalTick=Math.min(m.nextEvalTick,tick+1+hash32(m.soulId)%20);
          m.evalTrigger='world-event';m.lastFingerprint='';
        }
        if (p?.dayConfig) { this.extra.living = { ...p.dayConfig, lastDay: -1, event: 'a new place', quiet: false }; for (const m of this.minds.values()) m.life ??= newLife(tick); }
        if(p?.runtimePolicy)this.extra.runtimePolicy=structuredClone(p.runtimePolicy);
        const day = this.living;
        if (p?.quiet && day) { day.quiet = true; day.quietDay = p.day; }
        if (p?.compact && day) { day.quiet = false; day.lastDay = p.day; if (p.firstLight) day.event = 'first light'; }
        if (p?.continuousDayV1 === true) this.extra.continuousDayV1 = true;
        // continuousDayV1: a legacy quiet ends without compaction; the day turns without pausing anyone.
        if (p?.quietEnded && day) day.quiet = false;
        if (p?.dayTurn && day) day.lastDay = p.day;
        if (p?.worldEvent && day) {
          day.event = p.worldEvent.text;
          if (p.worldEvent.day !== undefined) ((this.extra.moments ??= {}) as Record<string, number>)[p.worldEvent.id] = p.worldEvent.day;
          for (const m of this.minds.values()) { m.nextEvalTick = Math.min(m.nextEvalTick, tick + 1 + hash32(m.soulId) % 20); m.evalTrigger = 'world-event'; m.lastFingerprint = ''; }
        }
        if(p?.reflection?.episodeMemory){if(!this.extra.intentEpisodeMemoryV1)throw Error('purpose-episodes.policy-required');const memories=(this.extra.intentEpisodeMemoriesV1??={}) as Record<string,unknown>;memories[p.soulId]=structuredClone(p.reflection.episodeMemory);}
        if (p?.reflection) { const m = this.minds.get(p.soulId); if (m?.life) { m.life.journal = String(p.reflection.journal).slice(0, 1200); m.life.reflectedDay = p.reflection.day; m.life.acts = []; this.acc.dirty.add(m.soulId); } }
        if (p?.character) { const m = this.minds.get(p.soulId); if (m) { m.description = p.character; this.kernel.things[m.soulId].traits.about = p.character; if (!replay) this.db.db.prepare('UPDATE souls SET description = ? WHERE id = ?').run(p.character, m.soulId); this.kernelDirty = true; } }
        break;
      }
      case 'admin': break;
    }
    return r;
  }

  addMind(m: Mind) { this.minds.set(m.soulId, m); this.mindByEntity.set(m.entityId, m); }

  get living(): { origin: number; dayTicks: number; customs: string[]; lastDay: number; event: string; quiet: boolean; quietDay?: number } | undefined { return this.extra.living as any; }
  get quietBarrier() { return !!this.living?.quiet; }
  enableQuietLandingCourtesyV1(){if((this.extra.runtimePolicy as {quietLandingCourtesyV1?:boolean}|undefined)?.quietLandingCourtesyV1===true){const fact=this.db.rulesEvents(this.worldId).find(e=>e.payload?.runtimePolicy?.quietLandingCourtesyV1===true);if(!fact)throw Error('runtime-policy.accepted-fact-missing:quietLandingCourtesyV1');return Promise.resolve(fact);}return this.enqueue('rules','operator:quiet-landing-courtesy',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,quietLandingCourtesyV1:true},why:'allow ordinary native traffic step for a free idle landing blocker while existing natural quiet drains'});}
  enableIntentArrivalsV1(){if(this.extra.intentArrivalV1)return Promise.resolve();return this.enqueue('rules','operator:intent-arrival',{intentArrivalV1:true,runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,nativeArrivalWitnessV1:true},why:'prospective private native navigation arrival witnesses; retain old history grammar'});}
  enableIntentNativeSequenceCompletionV1(){if(this.extra.intentNativeSequenceCompletionV1)return Promise.resolve();return this.enqueue('rules','operator:intent-native-sequence-completion',{intentNativeSequenceCompletionV1:true,why:'prospectively advance typed owner sequence only after matching accepted native programme completion; retain failed/interrupted steps and historical semantic sequence behaviour'});}
  enableIntentHumanSleepTransitionV1(){if(this.extra.intentHumanSleepTransitionV1)return Promise.resolve();return this.enqueue('rules','operator:human-sleep-transition',{intentHumanSleepTransitionV1:true,why:'prospective owner-scoped native sleep stop; actual safe rise before fresh admission'});}
  enableIntentPurposeEvidenceV1(){if(this.extra.intentPurposeEvidenceV1)return Promise.resolve();return this.enqueue('rules','operator:purpose-evidence',{intentPurposeEvidenceV1:true,why:'private mind context keeps current owner revision origins and recorded attempt/contribution progress; no new execution priority or fulfilment'});}
  enableIntentPurposeRecallV1(){if(this.extra.intentPurposeRecallV1)return Promise.resolve();if(!this.extra.intentPurposeEvidenceV1)return Promise.reject(Error('purpose-recall.evidence-policy-required'));return this.enqueue('rules','operator:purpose-recall',{intentPurposeRecallV1:true,why:'bound private own-purpose context; preserve strict/current commitments in full or report capacity without new choice; retain original history'});}
  enableIntentRetainedChoiceV1(){if(this.extra.intentRetainedChoiceV1)return Promise.resolve();if(!this.extra.intentPurposeRecallV1||!this.extra.intentNativeSequenceCompletionV1)return Promise.reject(Error('retained-choice.qualified-context-required'));return this.enqueue('rules','operator:retained-choice',{intentRetainedChoiceV1:true,why:'recalled owned typed unfinished steps are ordinary feasible alternatives; actual chosen contributions retain private intent provenance without FIFO priority'});}
  enableIntentEpisodeMemoryV1(){if(this.extra.intentEpisodeMemoryV1)return Promise.resolve();return this.enqueue('rules','operator:purpose-episodes',{intentEpisodeMemoryV1:true,why:'private reflection keeps bounded canonical owned outcomes separately from interpretive prose; current owner will fences delayed reflection'});}
  pendingHumanSleepTransitionV1(soulId:string){const p=(this.extra.intentHumanSleepTransitionsV1 as Record<string,IntentSleepStopV1>|undefined)?.[soulId];return !!p&&this.engine.programOf(p.entityId)===p.programId;}
  enqueueHumanSleepStopV1(soulId:string,intent:PurposeRef,program:import('@souls/engine-contract').Program,guard:AcceptanceGuard){
    const m=this.minds.get(soulId),programId=m?previewHumanSleepStopV1(this,m,program):null;if(!m||!programId)return Promise.reject(new StaleIntentAttempt());
    const p=intentSleepStopV1Schema.parse({contract:'private-intent-sleep-stop/1',worldId:this.worldId,soulId,entityId:m.entityId,intent,programId});
    const current:AcceptanceGuard=()=>{
      checkAcceptanceGuard(guard);
      const row=this.db.soul(soulId),history=this.intentHistoryOf(soulId),entry=history.intents[intent.intentId];
      const latest=latestPurposeDirectionV1(history,m.owner,this.extra.intentRetainedChoiceV1===true);
      if(this.pendingHumanSleepTransitionV1(soulId)||this.minds.get(soulId)!==m||!row
        ||row.world_id!==this.worldId||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId
        ||this.kernel.things[soulId]?.traits.body!==m.entityId||m.activeRule||m.agendaPos<m.agenda.length
        ||entry?.status!=='active'||entry.revision.version!==intent.version||entry.revision.source.ownerId!==m.owner
        ||entry.revision.interpretation.humanGoalPlan?.kind!=='planned'
        ||latest?.revision.intentId!==intent.intentId||latest.revision.version!==intent.version
        ||previewHumanSleepStopV1(this,m,program)!==programId)throw new StaleIntentAttempt();
      const step=entry.revision.interpretation.agenda[this.intentSequenceStepV1(soulId,intent)];
      const card=step?this.kernel.vocab.cards[step.card]:undefined;
      if(!card||step.target!==null||program.label!==card.name
        ||hashOf(program.steps)!==hashOf([...card.approach,...card.during]))throw new StaleIntentAttempt();
      return true;
    };
    return this.enqueueChecked('intent-sleep-stop-v1','world:human-sleep-stop',p,current);
  }
  enableIntentExecutionRetentionV1(){if(this.extra.intentExecutionRetentionV1)return Promise.resolve();return this.enqueue('rules','operator:intent-execution-retention',{intentExecutionRetentionV1:true,why:'prospectively retain the latest admitted owner typed goal until native programme completion or explicit authority/intent/physical interruption'});}
  enableIntentApproachRetentionV1(){if(this.extra.intentApproachRetentionV1)return Promise.resolve();return this.enqueue('rules','operator:intent-approach-retention',{intentApproachRetentionV1:true,why:'retain the latest admitted owner purpose through unfinished native locomotion/seating before autonomous redirection; preserve prior replay'});}
  enableIntentSequencesV1(){if(this.extra.intentSequencesV1)return Promise.resolve();return this.enqueue('rules','operator:intent-sequences',{intentSequencesV1:true,worldEvent:{id:'intent-sequences-enabled',text:'Residents can follow the steps of their current directions.'},why:'enable purpose-bound card progress while preserving earlier intentions'});}
  intentSequenceStepV1(soulId:string,intent:PurposeRef){return (this.extra.intentSequenceProgressV1 as Record<string,number>|undefined)?.[JSON.stringify([soulId,intent.intentId,intent.version])]??0;}

  enableSpreadV2(){if((this.extra.runtimePolicy as {spreadV2?:boolean}|undefined)?.spreadV2)return Promise.resolve();return this.enqueue('rules','operator:spread-v2',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,spreadV2:true},why:'shared places take arrivals by real area: proportional inset, 1 m spots, centre kept, arrivals stand just outside a full place instead of being refused; retain historical replay before this event'});}
  enableOccupiedLinkRoutingV1(){if((this.extra.runtimePolicy as {occupiedLinkRoutingV1?:boolean}|undefined)?.occupiedLinkRoutingV1)return Promise.resolve();return this.enqueue('rules','operator:occupied-link-routing',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,occupiedLinkRoutingV1:true},why:'before entering a stair flight, boundedly reroute around a stationary occupied landing when another supported route exists; preserve seated occupants, clearance and historical replay before this event'});}
  enableStairLandingClearanceV1(){if((this.extra.runtimePolicy as {stairLandingClearanceV1?:boolean}|undefined)?.stairLandingClearanceV1)return Promise.resolve();return this.enqueue('rules','operator:stair-landing-clearance',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,stairLandingClearanceV1:true},why:'a climber waits on the flight rather than step onto a landing another body occupies on the destination level (#509); retain historical replay before this event'});}
  enableConcurrentLinkEgressV1(){if((this.extra.runtimePolicy as {concurrentLinkEgressV1?:boolean}|undefined)?.concurrentLinkEgressV1)return Promise.resolve();return this.enqueue('rules','operator:concurrent-link-egress',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,concurrentLinkEgressV1:true},why:'resolve mutual stair-entry traffic waits with supported collision-checked landing courtesy; retain goals, seat occupants and historical replay before this event'});}
  enableShoreDepartV1(){if((this.extra.runtimePolicy as {shoreDepartV1?:boolean}|undefined)?.shoreDepartV1)return Promise.resolve();return this.enqueue('rules','operator:shore-depart',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,shoreDepartV1:true},why:'shore travel may step away from a body already touching the mover; only a step toward it is occupied (two swimmers stopped against a third at the dry gate held each other for good); retain historical replay before this event'});}
  enableContinuousDayV1(){if(this.extra.continuousDayV1)return Promise.resolve();return this.enqueue('rules','operator:continuous-day',{continuousDayV1:true,why:'Gene: no nightly quiet hours. The day turns as a plain event; no quiet renewal, overdue-checkpoint pause or held intent; snapshots carry in-flight work. A quiet already under way ends at once without compaction. Retain historical quiet/compact replay before this event'});}
  enableSpreadClearV1(){if((this.extra.runtimePolicy as {spreadClearV1?:boolean}|undefined)?.spreadClearV1)return Promise.resolve();return this.enqueue('rules','operator:spread-clear',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,spreadClearV1:true},why:'walking to a place picks a free spot on clear ground inside it (a plaza round a fountain, a park round its pond), not a spot inside an obstacle, so arrivals stand in the place; retain historical replay before this event'});}
  enableReflexTimeoutV1(){if((this.extra.runtimePolicy as {reflexTimeoutV1?:boolean}|undefined)?.reflexTimeoutV1)return Promise.resolve();return this.enqueue('rules','operator:reflex-timeout',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,reflexTimeoutV1:true},why:'every reflex the runtime reports stalled on other people for 60 s (walk, seat, stair, swim, courtesy step, yield) is natively cancelled in every state, so no single body can hold another or the world; retain historical replay before this event'});}
  /** placeRegionsV1: admit W1 places (id, label, polygon) as native destination regions in one logged prospective rules fact.
   *  Only new, admissible places are written; returns what was admitted and why the rest were not. */
  installPlaceRegionsV1(list:{id:string;label:string;polygon:[number,number][]}[]){
    const engine=this.engine as unknown as {previewPlaceRegionV1?:(r:unknown)=>{code:string;message:string}|null;world:{regions:Record<string,unknown>}};
    if(!engine.previewPlaceRegionV1)return Promise.reject(Error('place-regions.reader-required'));
    const admit:typeof list=[],refused:{id:string;code:string;message:string}[]=[];
    for(const r of list){if(engine.world.regions[r.id])continue;const issue=engine.previewPlaceRegionV1(r);if(issue)refused.push({id:r.id,...issue});else admit.push({id:r.id,label:r.label,polygon:r.polygon});}
    if(!admit.length)return Promise.resolve({admitted:[] as string[],refused});
    return this.enqueue('rules','operator:place-regions',{placeRegionsV1:admit,why:'W1 places on admitted native ground become destination regions (walk, hang-out, gather) so Souls can spread beyond the commons; prospective, earlier history replays unchanged'}).then(()=>({admitted:admit.map(r=>r.id),refused}));
  }
  /** nav/1: extra walking ground and solid footprints (buildings, water) as one logged prospective rules fact; a spec equal
   *  to the installed one is a no-op. Resolves {installed:false} without logging when nothing would change. */
  installNavV1(spec:{version:'nav/1';ground:{id:string;boundsXZ:[number,number,number,number]}[];solids:{id:string;label?:string;c:[number,number];half:[number,number];yaw:number;height?:number}[];platforms?:RenderPlatformV1[]}){
    const engine=this.engine as unknown as {previewNavV1?:(s:unknown)=>{code:string;message:string}|null;navFromSpecV1:(s:unknown)=>unknown;world:{navV1?:unknown}};
    if(!engine.previewNavV1)return Promise.reject(Error('nav.reader-required'));
    const issue=engine.previewNavV1(spec);if(issue)return Promise.reject(Error(`${issue.code}: ${issue.message}`));
    const platforms=spec.platforms===undefined?undefined:renderPlatformRowsV1Schema.parse(spec.platforms);
    const installProjection=()=>platforms===undefined?Promise.resolve():this.installRenderPlatformsV1(platforms).then(()=>undefined);
    if(hashOf(engine.world.navV1??null)===hashOf(engine.navFromSpecV1(spec)))return installProjection().then(()=>({installed:false}));
    const {platforms:_renderOnly,...geometry}=spec;
    return this.enqueue('rules','operator:nav',{navV1:structuredClone(geometry),why:'nav/1: buildings and water are solid to walking (doors closed until interiors are admitted) and admitted ground widens to the park; prospective, earlier history replays unchanged'}).then(async()=>{await installProjection();return {installed:true};});
  }
  /** Prospective presentation only: bind new capture metadata to the accepted nav/base at this tick. */
  installRenderPlatformsV1(raw:RenderPlatformV1[]){
    if(!this.engine.configureRenderPlatformsV1)return Promise.reject(Error('render-platforms.reader-required'));
    const platforms=renderPlatformRowsV1Schema.parse(raw).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),navHash=hashOf((this.engine.world as any).navV1??null),baseStaticHash=this.engine.world.base.staticHash;
    const old=this.engine.renderPlatformsV1?.();if(old&&old.navHash===navHash&&old.baseStaticHash===baseStaticHash&&hashOf(old.platforms)===hashOf(platforms))return Promise.resolve({installed:false});
    const guard:AcceptanceGuard=()=>{if(hashOf((this.engine.world as any).navV1??null)!==navHash||this.engine.world.base.staticHash!==baseStaticHash)throw Error('render-platforms.source-moved');return true;};
    return this.enqueueChecked('rules','operator:render-platforms',{renderPlatformsV1:{contract:'render-platforms/1',navHash,baseStaticHash,platforms}},guard).then(()=>({installed:true}));
  }
  /** Source-pinned authored bands, explicit prospective installation only.
   * Default-solid metadata adds neither support nor an advertised destination. */
  installAuthoredBoundariesV1(raw:AuthoredBoundariesDeclarationV1){
    if(!this.engine.configureAuthoredBoundariesV1||!this.engine.previewAuthoredBoundariesV1)return Promise.reject(Error('authored-boundaries.reader-required'));
    const declaration=authoredBoundariesDeclarationV1Schema.parse(raw),old=this.engine.authoredBoundariesV1?.();
    if(old?.sourceHash===declaration.sourceHash)return Promise.resolve({installed:false});
    const guard:AcceptanceGuard=()=>{const issue=this.engine.previewAuthoredBoundariesV1!(declaration);if(issue)throw Error(issue.code+': '+issue.message);return true;};
    guard();return this.enqueueChecked('rules','operator:authored-boundaries',{authoredBoundariesV1:declaration},guard).then(()=>({installed:true}));
  }
  /** Explicit prospective height bands only; does not activate office floors or stairs. */
  installOfficeStairGuardsV1(raw:OfficeStairGuardsDeclarationV1){
    if(!this.engine.configureOfficeStairGuardsV1)return Promise.reject(Error('office-guards.reader-required'));
    const declaration=officeStairGuardsDeclarationV1Schema.parse(raw),existing=this.engine.officeStairGuardsV1?.();
    if(existing)return Promise.resolve({installed:false});
    const guard:AcceptanceGuard=()=>{if(this.engine.officeStairGuardsV1?.())throw Error('office-guards.already-installed');return true;};
    return this.enqueueChecked('rules','operator:office-stair-guards',{officeStairGuardsV1:declaration},guard).then(()=>({installed:true}));
  }
  /** upper-floors/1: a building's upper floors (or their removal) as one logged prospective rules fact, previewed first and
   *  again at acceptance. Resolves {installed:false} without logging when the same building is already installed. */
  installUpperFloorsV1(fact:{version:'upper-floors/1';building:{id:string}}|{version:'upper-floors/1';remove:string}){
    const engine=this.engine as unknown as {previewUpperFloorsV1?:(f:unknown)=>{code:string;message:string}|null;world:{upperFloorsV1?:{buildings:Record<string,unknown>}}};
    if(!engine.previewUpperFloorsV1)return Promise.reject(Error('upper-floors.reader-required'));
    const guard:AcceptanceGuard=()=>{const issue=engine.previewUpperFloorsV1!(fact);if(issue)throw Error(`${issue.code}: ${issue.message}`);return true;};
    guard();
    if('building' in fact&&engine.world.upperFloorsV1?.buildings[fact.building.id])return Promise.resolve({installed:false});
    const why='remove' in fact?'upper-floors/1: the building\'s upper floors are taken out again (operator rollback); its rooms leave the map; prospective, earlier history replays unchanged'
      :'upper-floors/1: the building\'s upper floors become walkable (floors, stairs, rooms as places) so residents can go upstairs; prospective, earlier history replays unchanged';
    return this.enqueueChecked('rules','operator:upper-floors',{upperFloorsV1:structuredClone(fact),why},guard).then(()=>({installed:true}));
  }
  /** carrier/1: install a ride (e.g. a hot-air balloon) at its home as a logged prospective rules fact; idempotent by id. */
  setCarrierRouteV1(spec:{id:string;route:string}){
    return this.enqueue('rules','operator:carrier-route',{carrierRouteV1:structuredClone(spec),why:'a ride flies another named route from its next flight (only while parked and empty); prospective, earlier history replays unchanged'});
  }
  /** E2: a god's ride whose attraction changed size or place moves to its new home and route (only while parked and empty). */
  rerouteCarrierV1(spec:CarrierInstallSpec){
    const engine=this.engine as unknown as {previewCarrierRerouteV1?:(s:unknown)=>{code:string;message:string}|null};
    if(!engine.previewCarrierRerouteV1)return Promise.reject(Error('carrier.reader-required'));
    const issue=engine.previewCarrierRerouteV1(spec);if(issue)return Promise.reject(Error(`${issue.code}: ${issue.message}`));
    return this.enqueue('rules','operator:carrier-reroute',{carrierRerouteV1:structuredClone(spec),why:'a ride whose attraction was resized or moved boards at its new home and follows its new route from its next trip (only while parked and empty); prospective, earlier history replays unchanged'});
  }
  installCarrierV1(spec:CarrierInstallSpec){
    const engine=this.engine as unknown as {previewCarrierV1?:(s:unknown)=>{code:string;message:string}|null;world:{entities:Record<string,{carrier?:unknown}>}};
    if(!engine.previewCarrierV1)return Promise.reject(Error('carrier.reader-required'));
    if(engine.world.entities[spec.id]?.carrier)return Promise.resolve();
    const issue=engine.previewCarrierV1(spec);if(issue)return Promise.reject(Error(`${issue.code}: ${issue.message}`));
    return this.enqueue('rules','operator:carrier',{carrierV1:structuredClone(spec),why:'a ride (carrier/1): bodies seated in it are carried along its deterministic route; prospective, earlier history replays unchanged'});
  }
  enableEdgeMotionV1(){if((this.extra.runtimePolicy as {edgeMotionV1?:boolean}|undefined)?.edgeMotionV1)return Promise.resolve();return this.enqueue('rules','operator:edge-motion',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,edgeMotionV1:true},why:'a walk held in a people jam (traffic yield/person gridlock the runtime does not report as deadlock) steps back after 10 s with a per-body stagger and re-tries, and a stroll is built only from checked native walks, so Souls visibly move instead of freezing; retain historical replay before this event'});}
  enableStairMakeWayV1(){if((this.extra.runtimePolicy as {stairMakeWayV1?:boolean}|undefined)?.stairMakeWayV1)return Promise.resolve();return this.enqueue('rules','operator:stair-make-way',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,stairMakeWayV1:true},why:'a climber held on a stair by an idle person at the landing asks them to step aside through native make-way every 10 s, so an idle body at a stair head cannot hold the climber or the quiet barrier; retain historical replay before this event'});}
  enableWalkSettleWaitV1(){
    const base=this.extra.runtimePolicy as {sleepBlockTicks:number;walkSettleWaitV1?:boolean}|undefined;
    if(!base||!Number.isInteger(base.sleepBlockTicks)||base.sleepBlockTicks<20||base.sleepBlockTicks>72000)throw Error('runtime-policy.walk-settle-base-required');
    const facts=this.db.rulesEvents(this.worldId);
    if(!facts.some(e=>e.payload?.runtimePolicy&&hashOf(e.payload.runtimePolicy)===hashOf(base)))throw Error('runtime-policy.accepted-base-fact-missing:walkSettleWaitV1');
    if(base.walkSettleWaitV1===true)return Promise.resolve(facts.find(e=>e.payload?.runtimePolicy?.walkSettleWaitV1===true)!);
    return this.enqueue('rules','operator:walk-settle-wait',{runtimePolicy:{...base,walkSettleWaitV1:true},why:'prospectively report an actually obstructed final walk sidestep through existing native wait/recovery; preserve the accepted base policy and all prior movement replay'});
  }
  enableYieldTimeoutV1(){if((this.extra.runtimePolicy as {yieldTimeoutV1?:boolean}|undefined)?.yieldTimeoutV1)return Promise.resolve();return this.enqueue('rules','operator:yield-timeout',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,yieldTimeoutV1:true},why:'edge reflex floor: a walk or seat approach held waiting on other people for 60 s is released with route.blocked in every state; retain historical replay before this event'});}
  enableQuietStallReleaseV1(){if((this.extra.runtimePolicy as {quietStallReleaseV1?:boolean}|undefined)?.quietStallReleaseV1)return Promise.resolve();return this.enqueue('rules','operator:quiet-stall-release',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,quietStallReleaseV1:true},why:'prospectively release a walk or seat approach held waiting on other people for 30 s during a quiet checkpoint, so mutual yielding cannot hold the daily barrier; retain historical replay before this event'});}
  enableGroundFixtureGoalsV1(){if((this.extra.runtimePolicy as {fixtureGroundGoalsV1?:boolean}|undefined)?.fixtureGroundGoalsV1===true){const fact=this.db.rulesEvents(this.worldId).find(e=>e.payload?.runtimePolicy?.fixtureGroundGoalsV1===true);if(!fact)throw Error('runtime-policy.accepted-fact-missing:fixtureGroundGoalsV1');return Promise.resolve(fact);}return this.enqueue('rules','operator:fixture-goal-levels',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,fixtureGroundGoalsV1:true},why:'resolve ground-supported fixture destinations prospectively; retain old navigation replay'});}
  enableHumanRestNeedsV1(){
    if((this.extra.runtimePolicy as {humanRestNeedsV1?:boolean}|undefined)?.humanRestNeedsV1===true){const fact=this.db.rulesEvents(this.worldId).find(e=>e.payload?.runtimePolicy?.humanRestNeedsV1===true);if(!fact)throw Error('runtime-policy.accepted-fact-missing:humanRestNeedsV1');return Promise.resolve(fact);}
    return this.enqueue('rules','operator:human-rest-needs',{runtimePolicy:{sleepBlockTicks:1200,...this.extra.runtimePolicy as object,humanRestNeedsV1:true},why:'recognize enacted humanoid rest prospectively; retain prior needs replay'});
  }
  installExistingGreenLandmarkV1(){
    if(this.stationHistoryV1())return Promise.reject(Error('green-landmark.station-carry-required'));
    const p=this.engine.previewExistingGreenLandmarkV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'green-landmark.reader-required'));const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('green-landmark.station-carry-required');const q=this.engine.previewExistingGreenLandmarkV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('green-landmark.source-moved');for(const id of Object.keys(existingGreenLandmarkV1().regions))if(this.kernel.things[id])throw Error('green-landmark.kernel-identity-collision');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('green-landmark.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('green-landmark.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:existing-green-landmark',payload:{existingGreenLandmark:t},guard,journal,resolve,reject}));
  }
  installEdenGroundV1(){if(this.stationHistoryV1())return Promise.reject(Error('eden-ground.station-carry-required'));const p=this.engine.previewEdenGroundV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'eden-ground.reader-required'));const t=p.transition;const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('eden-ground.station-carry-required');const q=this.engine.previewEdenGroundV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('eden-ground.source-moved');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('eden-ground.reader-required');return true;};const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('eden-ground.header-moved');return true;};return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:eden-ground',payload:{edenGround:t},guard,journal,resolve,reject}));}
  installEdenLectureV1(placement:EdenLecturePlacementV1){
    if(this.stationHistoryV1())return Promise.reject(Error('eden-lecture.station-carry-required'));
    const p=this.engine.previewEdenLectureV1?.(placement);if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'eden-lecture.reader-required'));const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('eden-lecture.station-carry-required');const q=this.engine.previewEdenLectureV1?.(placement);if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('eden-lecture.source-moved');const add=edenLectureV1(placement);for(const id of [...Object.keys(add.entities),...Object.keys(add.regions)])if(this.kernel.things[id])throw Error('eden-lecture.kernel-identity-collision');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('eden-lecture.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('eden-lecture.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:eden-lecture',payload:{edenLecture:t},guard,journal,resolve,reject}));
  }
  installSocialEdenV1(){
    if(this.stationHistoryV1())return Promise.reject(Error('social-eden.station-carry-required'));
    const p=this.engine.previewSocialEdenV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'social-eden.reader-required'));const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('social-eden.station-carry-required');const q=this.engine.previewSocialEdenV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('social-eden.source-moved');for(const id of [...Object.keys(socialEdenV1().entities),...Object.keys(socialEdenV1().regions)])if(this.kernel.things[id])throw Error('social-eden.kernel-identity-collision');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('social-eden.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('social-eden.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:social-eden',payload:{socialEden:t},guard,journal,resolve,reject}));
  }
  installNativeSleepSnapshotV1(){if(this.stationHistoryV1())return Promise.reject(Error('sleep-snapshot.station-carry-required'));const p=this.engine.previewNativeSleepSnapshotV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'sleep-snapshot.reader-required'));const t=p.transition;const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('sleep-snapshot.station-carry-required');const q=this.engine.previewNativeSleepSnapshotV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('sleep-snapshot.source-moved');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true||this.factory.canRestoreSnapshot?.(t.toRulesVersion)!==true)throw Error('sleep-snapshot.reader-required');return true;};const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('sleep-snapshot.header-moved');return true;};return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:native-sleep-snapshot',payload:{nativeSleepSnapshotPolicy:t},guard,journal,resolve,reject}));}
  installCommonsNewcomerResourcesV1(placements:readonly NewcomerResourcePlacementV1[]){
    if(this.stationHistoryV1())return Promise.reject(Error('newcomer-resources.station-carry-required'));
    const p=this.engine.previewCommonsNewcomerResourcesV1?.(placements);if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'newcomer-resources.reader-required'));const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('newcomer-resources.station-carry-required');const q=this.engine.previewCommonsNewcomerResourcesV1?.(placements);if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('newcomer-resources.source-moved');const add=commonsNewcomerResourcesV1(t.firstSlot,t.placements);for(const id of [...Object.keys(add.entities),...Object.keys(add.regions)])if(this.kernel.things[id])throw Error('newcomer-resources.kernel-identity-collision');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true||this.factory.canRestoreSnapshot?.(t.toRulesVersion)!==true)throw Error('newcomer-resources.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('newcomer-resources.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:finite-newcomer-resources',payload:{commonsNewcomerResources:t},guard,journal,resolve,reject}));
  }
  installCommonsFoodDeliveryV1(deliveryId:string){
    if(this.stationHistoryV1())return Promise.reject(Error('food-delivery.station-carry-required'));
    const p=this.engine.previewCommonsFoodDeliveryV1?.(deliveryId);if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'food-delivery.reader-required'));const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('food-delivery.station-carry-required');const q=this.engine.previewCommonsFoodDeliveryV1?.(deliveryId);if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('food-delivery.source-moved');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('food-delivery.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('food-delivery.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:finite-food-delivery',payload:{commonsFoodDelivery:t},guard,journal,resolve,reject}));
  }
  installRetainedCommonsShoreV1(){
    if(this.stationHistoryV1())return Promise.reject(Error('retained-shore.station-carry-required'));
    const p=this.engine.previewRetainedCommonsShoreV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'retained-shore.reader-required'));
    const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('retained-shore.station-carry-required');const q=this.engine.previewRetainedCommonsShoreV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('retained-shore.source-moved');for(const id of ['shore-bank','shore-water'])if(this.kernel.things[id])throw Error('retained-shore.kernel-identity-collision');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('retained-shore.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('retained-shore.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:retained-shore',payload:{retainedCommonsShore:t},guard,journal,resolve,reject}));
  }
  installCommonsKitchenV1(){
    if(this.stationHistoryV1())return Promise.reject(Error('commons-kitchen.station-carry-required'));
    const p=this.engine.previewCommonsKitchenV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'commons-kitchen.reader-required'));
    const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('commons-kitchen.station-carry-required');const q=this.engine.previewCommonsKitchenV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('commons-kitchen.source-moved');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('commons-kitchen.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('commons-kitchen.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:commons-kitchen',payload:{commonsKitchen:t},guard,journal,resolve,reject}));
  }
  installCommonsProvisionsV1(){
    if(this.stationHistoryV1())return Promise.reject(Error('commons-provisions.station-carry-required'));
    const p=this.engine.previewCommonsProvisionsV1?.();if(!p?.ok)return Promise.reject(Error(p?p.diagnostic.code:'commons-provisions.reader-required'));
    const t=p.transition;
    const guard:AcceptanceGuard=()=>{if(this.stationHistoryV1())throw Error('commons-provisions.station-carry-required');const q=this.engine.previewCommonsProvisionsV1?.();if(!q?.ok||hashOf(q.transition)!==hashOf(t))throw Error('commons-provisions.source-moved');if(this.factory.canReplayHistory?.(t.toRulesVersion)!==true)throw Error('commons-provisions.reader-required');return true;};
    const journal:AcceptanceJournal=()=>{const r=this.db.db.prepare('UPDATE worlds SET rules_version=? WHERE id=? AND rules_version=?').run(t.toRulesVersion,this.worldId,t.fromRulesVersion);if(r.changes!==1)throw Error('commons-provisions.header-moved');return true;};
    return new Promise<LogEvent>((resolve,reject)=>this.queue.push({kind:'rules',author:'operator:commons-provisions',payload:{commonsProvisions:t},guard,journal,resolve,reject}));
  }
  private advanceLives() {
    const tick = this.engine.world.tick;
    for (const m of this.minds.values()) {
      if (!m.life) continue;
      const e = this.engine.world.entities[m.entityId]; if (!e?.human) continue;
      const floater=(e as unknown as {body?:{family:string}}).body?.family==='floater';
      const nearby = [...this.mindByEntity.values()].some(other => { const b = this.engine.world.entities[other.entityId]; return other !== m && b && (!floater || Math.abs(e.pose.p[1]-b.pose.p[1])<2) && Math.hypot(e.pose.p[0] - b.pose.p[0], e.pose.p[2] - b.pose.p[2]) < 4; });
      const humanRest=(this.extra.runtimePolicy as {humanRestNeedsV1?:boolean}|undefined)?.humanRestNeedsV1===true;
      const resting=(floater||humanRest)&&!!this.engine.bodyResting?.(m.entityId),recharging=floater&&resting&&/bask|recharge/.test(m.doing);
      advanceNeeds(m.life, tick, resting?'rest':e.human.activity, nearby, recharging, floater); m.energy = m.life.needs.energy;
    }
  }

  private captureHostState(): Omit<SnapshotBody, 'runtime'> {
    return { minds: structuredClone([...this.minds.values()]), seq: this.seq, extra: structuredClone(this.extra), kernel: structuredClone(this.kernel), counts: {...this.counts} };
  }
  private captureBody(runtime = this.engine.snapshot()): SnapshotBody {
    return { runtime, ...this.captureHostState() };
  }
  /** BODY-v1 world body-type policy: live admission config, never snapshot or replay state, so the host re-applies it
   *  to every engine it installs (a rolled-back transaction or recovery restores a fresh engine). */
  private bodyTypesV1: string[] | null = null;
  configureBodyTypesV1(types: readonly string[]) { this.bodyTypesV1 = [...types]; this.applyBodyTypesV1(); }
  private applyBodyTypesV1() { if (this.bodyTypesV1) this.engine.configureBodyTypesV1?.(this.bodyTypesV1); }
  private restoreBody(body: SnapshotBody) {
    // Transaction rollback replaces the engine but must keep the latest owned
    // recovery boundary even if its deferred encoding had not finished yet.
    let recovery = this.recoveryBaseline, failed = false, failure: unknown;
    try { if (this.recoveryCapture) recovery = this.recoveryCapture(); }
    catch (error) { failed = true; failure = error; }
    this.cancelPeriodicSnapshot(); this.recoveryCapture = null; this.recoveryBaseline = recovery;
    try {
      this.engine = this.factory.restore(structuredClone(body.runtime)); this.applyBodyTypesV1(); this.minds.clear(); this.mindByEntity.clear();
      for (const m of structuredClone(body.minds)) this.addMind(m);
      this.kernel = structuredClone(body.kernel!); this.extra = structuredClone(body.extra); this.counts = {...body.counts};
      this.seq = body.seq;
    } finally {
      // A digest/provider fault must not prevent attempting the supplied rollback
      // body. Stop even if its independent restore also fails; do not replace that error.
      if (failed) this.failCheckpoint(failure);
    }
  }
  private restoreRecovery(recipe: RecoveryRecipe) {
    // A recipe logged before recipes stopped nesting carries the earlier recipes among its events. The last one restores
    // a whole body, so what precedes it is overwritten: start from it (else each level replays its chain again, 2^depth).
    let nested = -1; for (let i=0;i<recipe.events.length;i++) if (recipe.events[i].kind === 'rules' && recipe.events[i].payload?.recovery) nested=i;
    // Keep the outer recipe's original violation ceiling even when its replay prefix is superseded.
    this.restoreBody(recipe.baseline);
    if (recipe.lastRung) return this.applyLastRung(recipe);
    const historicViolations=this.engine.runtime.violations.length;
    if (nested >= 0) { this.apply(recipe.events[nested],true); this.seq=recipe.events[nested].seq; }
    else {
      // The baseline may contain a resumable program whose later tick proved faulty.
      for (const m of this.minds.values()) if (m.pending && recipe.excluded.includes(m.pending.card)) { this.engine.stop(m.pending.program); m.pending=null; }
      for (const actor of recipe.edge?.stopActors ?? []) { const program=this.engine.programOf(actor); if (program) this.engine.stop(program); }
    }
    for (const e of recipe.events.slice(nested+1)) {
      while (this.engine.world.tick < e.tick) { const out=this.engine.step(); this.advanceLives(); this.afterPrograms(out.programs,true); }
      this.apply(e,true); this.seq=e.seq;
    }
    while (this.engine.world.tick < recipe.untilTick) { const out=this.engine.step(); this.advanceLives(); this.afterPrograms(out.programs,true); }
    this.restorePoses(recipe.edge?.poses);
    if (this.engine.runtime.violations.length > historicViolations) {
      // Name both faults (#509): CI logs and a paused world's engineFault keep only this message.
      const fresh=this.engine.runtime.violations.slice(historicViolations,historicViolations+3).map(v=>{const d=v as {code?:string;subjects?:string[];tick?:number;message?:string};return `${d.code ?? 'violation'} [${(d.subjects??[]).join(', ')}] at tick ${d.tick ?? this.engine.world.tick}: ${d.message ?? ''}`;});
      throw new Error(`recovery replay still violates the engine: ${fresh.join('; ')}; original fault: ${String(recipe.reason ?? 'unrecorded').slice(0,400)}`, {cause: recipe.reason});
    }
    this.extra.cardFaults = {...recipe.faults};
    this.extra.cardCooldown = {...this.extra.cardCooldown as Record<string,number>, ...Object.fromEntries(recipe.excluded.map(card=>[card,recipe.untilTick+1200]))};
    for (const m of this.minds.values()) { m.nextEvalTick=this.engine.world.tick+1; m.evalTrigger='activity-failed'; m.lastFingerprint=''; if (m.pending && recipe.excluded.includes(m.pending.card)) m.pending=null; }
    this.kernel.tick=this.engine.world.tick; sweep(this.kernel); this.kernelDirty=true;
  }
  private recoverFault(error: unknown, cardHint?: string, edgeHint?: {seq: number; entityId?: string}) {
    // A pending checkpoint already owns this boundary. Materialize that same
    // capture before recovery replaces the engine; never fall back to an older head.
    let baseline: SnapshotBody | null;
    try { baseline=this.recoveryCapture ? this.recoveryCapture() : this.recoveryBaseline; }
    catch (failure) { this.failCheckpoint(failure); return; }
    this.cancelPeriodicSnapshot(); this.recoveryCapture = null; this.recoveryBaseline = baseline;
    // #1150: nothing clean to go back to, or this just happened: the head stays and everything on it stops
    if (this.repairRules && (!baseline || this.stepFailing || this.engine.world.tick - this.lastRewindTick < REWIND_COOLDOWN_TICKS)) return this.containInPlace(error);
    if (!baseline) { if (this.edgeRecovery()) return this.haltOnFault(error, 'no resumable recovery baseline'); throw new Error(`No resumable recovery baseline: ${String(error)}`); }
    const untilTick=this.engine.world.tick, originalSeq=this.seq, all=this.db.events(this.worldId,baseline.seq);
    const pending=[...this.minds.values()].filter(m=>m.pending).map(m=>m.pending!.card);
    const latest=[...all].reverse().find(e=>e.kind==='decision' && pending.includes(e.payload.card));
    const excluded=cardHint ? [cardHint] : latest?.payload.card ? [latest.payload.card as string] : [...new Set(pending)];
    // Hotfix (edge worlds): a fault no mind card explains is put down to the edge programmes of the bodies it names (a
    // collision's two people), widening once to every edge decision since the baseline; never a process exit.
    const plans = excluded.length ? [{excluded, edge: undefined as RecoveryRecipe['edge']}, {excluded, edge: undefined as RecoveryRecipe['edge']}]
      : this.edgeRecovery() ? this.edgePlans(error, all, edgeHint).map(edge => ({excluded: [] as string[], edge})) : [];
    if (!plans.length) { if (this.repairRules) return this.lastRung(error, baseline, all, untilTick, originalSeq); throw new Error(`Engine fault has no attributable card: ${String(error)}`); }
    const faults={...this.extra.cardFaults as Record<string,number>};
    for (let attempt=0;attempt<plans.length;attempt++) {
      const plan=plans[attempt];
      if (plan.edge === undefined && attempt>0) for (const card of pending) if (!excluded.includes(card)) excluded.push(card);
      for (const card of plan.excluded) faults[card]=(faults[card]??0)+1;
      const skip=new Set(plan.edge?.excludedSeqs ?? []);
      const events=all.filter(e=>!(['decision','play'].includes(e.kind) && plan.excluded.includes(e.payload?.card)) && !skip.has(e.seq));
      const edge=plan.edge?{...plan.edge,...this.rewoundPoses(plan.edge, all)}:undefined;
      const recipe: RecoveryRecipe={baseline:structuredClone(baseline),events,untilTick,faults:{...faults},excluded:[...plan.excluded],reason:String(error).slice(0,800),...(edge?{edge}:{})};
      try { this.restoreRecovery(recipe); }
      catch (replayError) { if (attempt===plans.length-1) { if (this.repairRules) return this.lastRung(error, baseline, all, untilTick, originalSeq); if (this.edgeRecovery()) return this.haltOnFault(replayError, 'recovery replay still faults', error, untilTick); throw replayError; } continue; }
      this.seq=originalSeq;
      const e: LogEvent={seq:++this.seq,tick:untilTick,kind:'rules',author:'world:recovery',payload:{recovery:recipe},at:Date.now()};
      if (!this.writeRepair(e)) return;
      this.resetAcc(); this.acc.log.push(e); this.ring=[];
      this.recordGlitch('recovery', error, {tick:untilTick, bodies:[...(edgeHint?.entityId?[edgeHint.entityId]:[]),...(plan.edge?.stopActors??[])], evidence:{seq:e.seq, plan:attempt+1, plans:plans.length, excluded:plan.excluded, ...(plan.edge?{stopActors:plan.edge.stopActors, excludedSeqs:plan.edge.excludedSeqs, souls:plan.edge.souls}:{})}});
      if(this.durableClockV1)this.persistClockFrontier();
      for (const m of this.minds.values()) this.acc.dirty.add(m.soulId);
      for (const l of this.listeners) l.onApplied?.(e);
      // Rebaseline at the repaired head, so the next recipe never nests this one (each carries a whole body: nested,
      // they double per fault), and snapshot it so a boot starts after it too.
      if (!this.snapshotRepair()) return;
      this.flush(); this.heartbeat(); return;
    }
  }
  /** Rung 3s this world has had, for the launcher's ALERT (#1150). */
  get rewinds(): number { return Object.values(this.glitches.byRule).reduce((n, r) => n + (r.rewind ?? 0), 0); }
  /** #1150: this world repairs instead of halting for a broken rule. */
  private get repairRules(): boolean { return this.engine.rulesVersion.includes('+souls-repair/'); }
  /** The tick of the last rung 3. A fault soon after stays on the head, so a fault that keeps firing can't rewind every tick. */
  private lastRewindTick = -Infinity;
  /** When each in-place fault was last reported: one that keeps firing is written once per cooldown. */
  private inPlaceAt = new Map<string, number>();
  /** What the step that just faulted finished, when it returned at all. */
  private faultedPrograms: ProgramEvent[] | null = null;
  /** The ticks that ended in a fault, within the last window. */
  private faultTicks: number[] = [];
  /** #1150: why steps are failing, while they are. The clock runs but bodies can't get anywhere, so acts are refused and the
   *  world counts as halted for the launcher's alert. Live only: it ends when faults fall away, and a restart finds it again. */
  stepFailing: string | null = null;
  private pruneFaultTicks() { const since = this.engine.world.tick - STEP_FAILING_WINDOW_TICKS; while (this.faultTicks.length && this.faultTicks[0] <= since) this.faultTicks.shift(); }
  private noteFaultedTick(error: unknown) {
    if (!this.repairRules) return;
    this.faultTicks.push(this.engine.world.tick); this.pruneFaultTicks();
    if (this.stepFailing || this.faultTicks.length < STEP_FAILING_FAULTS) return;
    this.stepFailing = String(error).slice(0, 800);
    console.error(`[world] ${this.faultTicks.length} of the last ${STEP_FAILING_WINDOW_TICKS} ticks faulted; acts are refused until that falls away:`, this.stepFailing);
    this.recordGlitch('halt', error, {rule: 'engine.step-failing', tick: this.engine.world.tick, evidence: {ticks: this.faultTicks.length}});
  }
  /** Booted from a marked snapshot, with no clean tick since. */
  private bootedFaulted = false;
  private noteCleanTick() {
    if (this.bootedFaulted) { this.bootedFaulted = false; this.snapshotSoon ??= 'first clean tick since a faulted head'; }
    if (!this.faultTicks.length) return;
    this.pruneFaultTicks();
    if (this.stepFailing && this.faultTicks.length < STEP_FAILING_FAULTS / 4) { this.stepFailing = null; this.snapshotSoon ??= 'steps are clean again'; }   // the first clean baseline since
  }
  /** #1150: a step that throws before its tick moves still moves the clock, live and in a replay alike, so a cooldown never
   *  waits on a tick that isn't coming and a replay can't spin on one. */
  private stepEngine(): ReturnType<Engine['step']> {
    const tick = this.engine.world.tick;
    try { return this.engine.step(); }
    catch (error) {
      if (this.repairRules && this.engine.world.tick === tick) { try { this.engine.setClockV1!(tick + 1); } catch { this.engine.world.tick = tick + 1; } }
      throw error;
    }
  }
  /** #1150: a repair that can't be written is a durability failure, the one halt left, and says so. */
  private writeRepair(e: LogEvent): boolean {
    try { this.db.appendEvent(this.worldId, e); return true; }
    catch (failure) { if (!this.repairRules) throw failure; this.failCheckpoint(failure, 'durability.repair'); return false; }
  }
  /** #1150: while steps are failing, a due snapshot is taken now: a sliced one would be cancelled by the next fault. It writes
   *  the frontier first, as every snapshot must, or a crash could leave a snapshot past the frontier that no boot accepts. A
   *  broken head may not capture: that is no durability failure, so it waits until one is next due. Only a failed write halts.
   *  It isn't clean, so it serves a boot and never a rewind, here or after a restart. */
  private snapshotFaultedHead() {
    let head: ReturnType<WorldHost['captureHead']>;
    const skip = () => { this.lastSnapshotTick = this.engine.world.tick; this.snapshotTaken(); };
    try { if (this.engine.canSnapshot && !this.engine.canSnapshot()) return skip(); head = this.captureHead(); }
    catch (failure) { console.warn('[world] a faulted head would not snapshot; trying again when one is due:', String(failure).slice(0, 200)); return skip(); }
    if (this.durableClockV1) { try { this.persistClockFrontier(); } catch { return; } }   // already a named halt
    try { this.commitHead(head, true); }
    catch (failure) { this.failCheckpoint(failure, 'durability.repair'); }
  }
  private snapshotRepair(): boolean {
    if (this.engine.canSnapshot && !this.engine.canSnapshot()) return true;
    try { this.snapshotHead(true); return true; }
    catch (failure) { if (!this.repairRules) throw failure; this.failCheckpoint(failure, 'durability.repair'); return false; }
  }
  /** #1150 rung 3: rung 2 failed. Back to the last clean state, keeping everything but decisions, and on from there.
   *  If those events won't re-apply, the baseline alone: that takes no step and no input, so it can't fail on a rule. */
  private lastRung(error: unknown, baseline: SnapshotBody, all: LogEvent[], untilTick: number, originalSeq: number) {   // both from before rung 2's replays moved them
    const kept = all.filter(e => !DROPPED_ON_REWIND.has(e.kind) && e.author !== 'world:refusal' && !e.payload?.recovery);
    for (const events of [kept, []]) {
      const recipe: RecoveryRecipe = { baseline: structuredClone(baseline), events, untilTick, faults: {...this.extra.cardFaults as Record<string, number>}, excluded: [], reason: String(error).slice(0, 800), lastRung: {} };
      try { this.restoreRecovery(recipe); }
      catch (failure) { console.error(`[world] last rung: ${events.length} kept events would not re-apply:`, String(failure).slice(0, 300)); continue; }
      this.seq = originalSeq;
      const e: LogEvent = {seq: ++this.seq, tick: untilTick, kind: 'rules', author: 'world:recovery', payload: {recovery: recipe}, at: Date.now()};
      if (!this.writeRepair(e)) return;
      this.resetAcc(); this.acc.log.push(e); this.ring = [];
      this.recordGlitch('rewind', error, {tick: untilTick, evidence: {seq: e.seq, kept: events.length, dropped: all.length - events.length, contained: recipe.lastRung!.contained, relocated: recipe.lastRung!.relocated, skipped: recipe.lastRung!.skipped}});
      if (this.durableClockV1) this.persistClockFrontier();
      for (const m of this.minds.values()) this.acc.dirty.add(m.soulId);
      for (const l of this.listeners) try { l.onApplied?.(e); } catch (failure) { console.error('[world] a listener failed on a rewind:', String(failure).slice(0, 200)); }
      if (!this.snapshotRepair()) return;
      this.flush(); this.heartbeat(); return;
    }
    this.failCheckpoint(new Error(`recovery.baseline-unusable: ${String(error).slice(0, 300)}`));   // the store's own copy won't restore: durability, not a rule
  }
  /** The replayable half of rung 3: no engine step, so no rule can fire during it. */
  private applyLastRung(recipe: RecoveryRecipe) {
    this.engine.stopAllV1!(REWOUND);
    const skipped: number[] = [];   // one event that won't re-apply costs only itself. It fails the same way on every replay.
    for (const e of recipe.events) { try { this.apply(e, true); } catch { skipped.push(e.seq); } this.seq = e.seq; }
    if (skipped.length) recipe.lastRung!.skipped = skipped;
    this.lastRewindTick = recipe.untilTick;
    this.engine.setClockV1!(recipe.untilTick);
    Object.assign(recipe.lastRung!, this.engine.containV1!());
    this.extra.cardFaults = {...recipe.faults};
    for (const m of this.minds.values()) { m.pending = null; m.nextEvalTick = this.engine.world.tick + 1; m.evalTrigger = 'activity-failed'; m.lastFingerprint = ''; }
    this.kernel.tick = this.engine.world.tick; sweep(this.kernel); this.kernelDirty = true;
  }
  /** #1150 rung 3 with no restore: stop what runs, contain what fires. Only a list and some stops, so it can't fail. A replay
   *  makes the same stops from the event, so a stop is never left unwritten; a fault that only repeats is written once per
   *  cooldown. The fold does this on a replay; live it runs here, so the event can carry what it found. */
  private containInPlace(error: unknown) {
    const tick = this.engine.world.tick, facts = faultFacts(error), key = `${facts.rule}|${facts.bodies.join()}`, seen = this.inPlaceAt.get(key);
    // what ended in a step that faulted on a violation ended all the same, and a replay runs this too
    if (this.faultedPrograms) try { this.afterPrograms(this.faultedPrograms, false); } catch (failure) { console.error('[world] a finished programme failed its effects on a faulted tick:', String(failure).slice(0, 200)); }
    const stopped = this.engine.stopAllV1!(REWOUND), repeat = !!this.stepFailing || (seen !== undefined && tick - seen < REWIND_COOLDOWN_TICKS);
    if (repeat && !stopped) { this.tellQuietly(false); return; }
    if (!repeat) this.inPlaceAt.set(key, tick);
    const inPlace = {...this.engine.containV1!(), reason: String(error).slice(0, 800)};
    const e: LogEvent = {seq: this.seq + 1, tick, kind: 'rules', author: 'world:rewind', payload: {lastRungInPlace: inPlace}, at: Date.now()};
    if (!this.writeRepair(e)) return;
    this.seq = e.seq; this.acc.log.push(e);
    if (!repeat) this.recordGlitch('rewind', error, {tick, evidence: {seq: e.seq, inPlace: true, contained: inPlace.contained, relocated: inPlace.relocated}});
    for (const m of this.minds.values()) { m.pending = null; this.acc.dirty.add(m.soulId); }
    for (const l of this.listeners) try { l.onApplied?.(e); } catch (failure) { console.error('[world] a listener failed on a stop in place:', String(failure).slice(0, 200)); }
    this.tellQuietly(true);
  }
  /** What goes out to clients after a stop in place. A broken head can break that too, and this rung can't fail. */
  private tellQuietly(batch: boolean) {
    try { if (batch) this.flush(); this.heartbeat(); }
    catch (failure) { console.error('[world] could not tell clients about a stop in place:', String(failure).slice(0, 200)); }
  }
  /** Where each Soul's body is now (sorted by entity id). */
  private soulPoses(): Map<string, RecoveryPose> {
    const out = new Map<string, RecoveryPose>(), ents = this.engine.world.entities as Record<string, { pose: { p: number[]; yaw?: number }; human?: { level?: number } }>;
    for (const id of [...this.mindByEntity.keys()].sort()) { const e = ents[id]; if (!e?.human || e.pose.p.length !== 3) continue; out.set(id, { p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]], yaw: e.pose.yaw ?? 0, level: e.human.level ?? 0 }); }
    return out;
  }
  /** The last valid poses of the bodies an edge plan rewinds (its stopped actors and the authors of its left-out decisions):
   *  taken at the start of the faulting tick, or now when the fault came between ticks. */
  private rewoundPoses(edge: NonNullable<RecoveryRecipe['edge']>, all: LogEvent[]): { poses?: Record<string, RecoveryPose> } {
    const seqs = new Set(edge.excludedSeqs), ids = new Set(edge.stopActors);
    for (const e of all) if (seqs.has(e.seq) && typeof e.payload?.entityId === 'string') ids.add(e.payload.entityId);
    const valid = this.validPoses && this.engine.world.tick - this.validPoses.tick <= 1 ? this.validPoses.poses : this.soulPoses();
    const poses = Object.fromEntries([...ids].sort().flatMap(id => valid.has(id) ? [[id, valid.get(id)!]] : []));
    return Object.keys(poses).length ? { poses } : {};
  }
  /** After a recovery replay: each rewound body lands back at its last valid pose (or the nearest free standing point).
   *  Bodies the rewind left where they were, or that are busy, stay. Deterministic: the poses are in the logged recipe. */
  private restorePoses(poses: Record<string, RecoveryPose> | undefined) {
    const engine = this.engine as unknown as { restoreHumanPoseV1?: (id: string, pose: RecoveryPose) => boolean };
    if (!poses || !engine.restoreHumanPoseV1) return;
    const ents = this.engine.world.entities as Record<string, { pose: { p: number[] }; human?: { level?: number } }>;
    for (const id of Object.keys(poses).sort()) {
      const e = ents[id], to = poses[id]; if (!e?.human) continue;
      if ((e.human.level ?? 0) === to.level && Math.hypot(e.pose.p[0] - to.p[0], e.pose.p[2] - to.p[2]) < 0.05) continue;
      engine.restoreHumanPoseV1.call(this.engine, id, to);
    }
  }
  /** Edge worlds (mindDriver edge): Souls act through edge decisions, not mind cards. */
  private edgeRecovery(): boolean { return this.recoveryForEdge; }
  /** Set by the edge server: faults are recovered by edge attribution (never a process exit). */
  recoveryForEdge = false;
  /** Edge fault attribution, narrowest first: the faulting bodies' running edge programmes and only the decisions
   *  that started them; then all their decisions since the baseline; then every edge decision since the baseline (all
   *  running programmes stopped). Each plan is tried in a replay and kept only if that replay is clean. */
  private edgePlans(error: unknown, all: LogEvent[], hint?: {seq: number; entityId?: string}): NonNullable<RecoveryRecipe['edge']>[] {
    let subjects: string[] = [];
    try { const v = JSON.parse(String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, '')) as {subjects?: string[]}[]; subjects = [...new Set(v.flatMap(d => d.subjects ?? []))]; } catch { /* not a violation list */ }
    if (hint?.entityId) subjects = [...new Set([hint.entityId, ...subjects])];
    const humans = Object.values(this.engine.world.entities).filter(e => e.kind === 'human').map(e => e.id).sort();
    const named = subjects.filter(id => humans.includes(id)), running = (ids: string[]) => ids.filter(id => !!this.engine.programOf(id));
    const edgeDecision = (e: LogEvent) => e.kind === 'decision' && typeof e.payload?.trigger === 'string' && /^edge-/.test(e.payload.trigger) && !e.payload?.card;
    const soulOf = (id: string) => this.mindByEntity.get(id)?.soulId;
    const plan = (actors: string[], all_: boolean) => {
      const seqs = all.filter(e => edgeDecision(e) && (all_ || actors.includes(e.payload.entityId))).map(e => e.seq), stop = [...new Set(actors)].sort();
      if (hint && !seqs.includes(hint.seq)) seqs.push(hint.seq);
      const souls = [...new Set([...stop, ...all.filter(e => seqs.includes(e.seq)).map(e => e.payload.entityId as string)].map(soulOf).filter((x): x is string => !!x))].sort();
      return {stopActors: stop, excludedSeqs: seqs.sort((a, b) => a - b), souls};
    };
    // Narrowest first: only the decision each faulting body is running now (its latest edge decision since the
    // baseline), so its earlier walks and sits replay as they were and no unrelated history is set aside.
    // (A body whose running programme began before the baseline has no such decision: that programme is stopped there.)
    const current = (actors: string[]) => {
      const ids = [...new Set(actors)].sort(), seqs: number[] = [], stop: string[] = [];
      for (const id of ids) { const last = [...all].reverse().find(e => edgeDecision(e) && e.payload.entityId === id); if (last) seqs.push(last.seq); else stop.push(id); }
      if (hint && !seqs.includes(hint.seq)) seqs.push(hint.seq);
      const souls = [...new Set([...ids, ...all.filter(e => seqs.includes(e.seq)).map(e => e.payload.entityId as string)].map(soulOf).filter((x): x is string => !!x))].sort();
      return {stopActors: stop, excludedSeqs: seqs.sort((a, b) => a - b), souls};
    };
    const out = [...(named.length ? [current(running(named))] : []), plan(running(named.length ? named : humans), false), plan(named.length ? named : humans, false), plan(running(humans), true)];
    return out.filter((p, i) => p.stopActors.length + p.excludedSeqs.length > 0 && out.findIndex(q => JSON.stringify(q) === JSON.stringify(p)) === i);
  }
  /** Last resort for edge worlds: keep the process up, the world paused and the fault reported (never a crash loop). */
  private haltOnFault(error: unknown, why: string, fault: unknown = error, tick?: number) {
    console.error(`[world] engine fault could not be recovered (${why}); the world is paused, the process stays up:`, String(error).slice(0, 800));
    this.paused = true; this.engineFault = String(error).slice(0, 800);
    this.recordGlitch('halt', fault, {tick, evidence:{why, ...(error===fault?{}:{last:String(error).slice(0,800)})}});
    // A failed recovery leaves the host half-replayed: its seq can sit behind the log (a plan skipped the newest decisions) and its
    // state need not match any logged prefix (#1120). Nothing durable may be written from it, so every later tick, drain and
    // snapshot refuses, naming this fault; a restart boots from the log. The process stays up, as before.
    if (this.clockFailure) return;
    this.clockFailure = new Error(`engine.halted: ${why}: ${this.engineFault}`, { cause: error });
    // as for the other clock failures: viewers are told the world is unavailable (hub: close 1013), not left asking a host
    // that refuses snapshots
    for (const listener of this.listeners) try { listener.onClockUnavailable?.(); } catch { /* the engine fault remains the cause */ }
  }
  /** #1150 rung 1: the engine already undid these moves. The log keeps each as evidence, in this tick; a replay recomputes
   *  them from state, so it reads these only to compare the count. */
  private noteRefusals(refusals: EngineRefusalV1[]) {
    for (const r of refusals) { void this.enqueue('rules', 'world:refusal', { refusal: r }); this.countRefusal(r); }
    this.drainInputs();
  }
  private countRefusal(r: EngineRefusalV1) { this.recordGlitch('refusal', JSON.stringify([{ code: r.rule, subjects: r.bodies }]), { tick: r.tick, evidence: { programs: r.programs, poses: r.poses } }); }
  /** The fault that paused this world (edge worlds), if any. */
  engineFault: string | null = null;
  private glitchCounts: GlitchCountsV1 | null = null;
  /** Every recovery and halt this world has had, by rule and rung (#1150). Public on /healthz: see GlitchCountsV1. */
  get glitches(): GlitchCountsV1 {
    if (this.glitchCounts) return this.glitchCounts;
    try { return this.glitchCounts = this.db.glitchCounts(this.worldId); }
    catch { return this.glitchCounts = {total: 0, byRule: {}}; }   // the store's own failure is reported where it happens
  }
  /** One record per recovery and per halt. Never throws and writes nothing to the log: whatever called it goes on as before. */
  private recordGlitch(rung: GlitchRung, fault: unknown, o: {rule?: string; tick?: number; bodies?: string[]; evidence?: Record<string, unknown>}) {
    try {
      const facts = faultFacts(fault), rule = o.rule ?? facts.rule, counts = this.glitches;
      const g: GlitchRecordV1 = {rung, rule, bodies: facts.bodies.length ? facts.bodies : [...new Set(o.bodies ?? [])].sort(), tick: o.tick ?? this.engine.world.tick, at: Date.now(),
        evidence: {...o.evidence, reason: String(fault).slice(0, 800), ...(facts.rules.length > 1 ? {rules: facts.rules} : {})}};
      countGlitch(counts, rule, rung);
      console.warn(glitchLine(g));
      this.db.appendGlitch(this.worldId, g);
    } catch (failure) { console.error('[world] glitch record not written:', String(failure).slice(0, 200)); }
  }

  setClockRate(rate: number, author: string, why: string) {
    this.clockRate = this.baseRate = rate; this.db.setClockRate(this.worldId, rate);
    void this.enqueue('rules', author, { clockRate: rate, why });
  }
  setPaused(p: boolean, author: string) {
    this.assertClockReady();   // a halted or clock-failed host stays as it is (#1120)
    this.cancelFrameBatch();
    if (p) { void this.enqueue('admin', author, { action: 'pause' }); this.tickOnceForQueue(); this.paused = true; this.flush(); this.heartbeat(); }   // tell clients now: no tick will
    else { this.paused = false; this.last = performance.now(); this.carry = 0; void this.enqueue('admin', author, { action: 'resume' }); }
  }
  private tickOnceForQueue() { if (!this.paused) this.tickOnce(); }

  // ------------------------------------------------------------ views
  profileFact(id:string):SoulProfileFactV1|undefined{return (this.extra.soulProfilesV1 as Record<string,SoulProfileFactV1>|undefined)?.[id];}
  /** Current accepted metadata may differ from the immutable birth label. */
  currentProfileName(id:string,birthName:string){const p=this.profileFact(id);return p?.birthName===birthName?p.name:birthName;}
  /** Previous accepted labels are not aliases: a fresh ambiguous old-name request must choose an ID. */
  soulNameRefusal(ref:string):'soul.name-stale'|'soul.name-ambiguous'|null{
    if(this.minds.has(ref))return null;const key=ref.trim().normalize('NFKC').toLowerCase(),old=(this.extra.soulNameClaimsV1 as Record<string,string[]>|undefined)?.[key];
    if(!old?.length)return null;const current=[...this.minds.values()].filter(m=>m.name.trim().normalize('NFKC').toLowerCase()===key);
    return current.length===1&&old.every(id=>id===current[0].soulId)?null:current.length?'soul.name-ambiguous':'soul.name-stale';
  }
  publicNameMetadata(id:string){const name=this.minds.get(id)?.name;return name&&this.soulNameRefusal(name)==='soul.name-ambiguous'?{nameAmbiguous:true as const}:{};}
  profileWorldPath='';
  /** Set by AutoPortraits: the stored automatic portrait of a Soul wearing a humanoid look (null when there is none). */
  autoProfilePhoto?:(id:string)=>{hash:string;mime:'image/png';width:number;height:number;bytes:number}|null;
  /** The owner's uploaded photo; otherwise the automatic portrait. */
  profilePhoto(id:string){const p=this.profileFact(id)?.photo??this.autoProfilePhoto?.(id)??null;return p?{...p,url:`${this.profileWorldPath}/v1/souls/${encodeURIComponent(id)}/profile-photo/${p.hash}`}:null;}
  profilePhotoSource(id:string):'custom'|'auto'|null{return this.profileFact(id)?.photo?'custom':this.autoProfilePhoto?.(id)?'auto':null;}
  /** Re-send this Soul's public card with the next batch (e.g. a new automatic portrait). */
  markSoulDirty(id:string){if(this.minds.has(id))this.acc.dirty.add(id);}
  /** D1: where a Soul's running act travels to (set by the edge ledger for edge acts); native cards use their target. */
  approachV1?:(m:Mind)=>ApproachV1|null;
  private approachOfV1(m:Mind):ApproachV1|null{
    if(this.approachV1){const a=this.approachV1(m);if(a)return a;}
    const t=m.pending&&this.engine.programOf(m.entityId)===m.pending.program?m.pending.target:null;if(!t)return null;
    const id=(this.kernel.things[t]?.traits.entity as string|undefined)??t,e=this.engine.world.entities[id];
    return {name:this.nameOf(t),to:e?[e.pose.p[0],e.pose.p[2]]:null};
  }
  /** D1: the body as the engine has it now (posture, activity, carrier, in water, current step); never stored. */
  bodyOfV1(m:Mind):BodyStateV1|null{return bodyState(this,m.entityId,this.approachOfV1(m));}
  /** D1: the card's doing line: the plan's label only while the body is in it; its approach, carrier or water otherwise. */
  doingOfV1(m:Mind):string{return cardDoing(this,m,this.approachOfV1(m));}
  private soulNowStore?: SoulNow;
  /** LINK: the agents' public `now` lines (soul-now.ts); a change re-sends that Soul's public card. */
  get soulNow(): SoulNow { if (!this.soulNowStore) { const store = new SoulNow(this.db.db, this.worldId); store.onChange = id => this.markSoulDirty(id); this.soulNowStore = store; } return this.soulNowStore; }
  nowOf(soulId: string): SoulNowLine | null { try { return this.soulNow.get(soulId); } catch { return null; } }
  /** Present only when set, so the cards of Souls without a line keep their exact earlier shape (absent = null). */
  private publicNow(soulId: string): {now?: SoulNowLine} { const now = this.nowOf(soulId); return now ? {now} : {}; }
  publicSoul(m: Mind): PublicSoul {
    const nameOf = (id: string) => this.nameOf(id);
    return {
      id: m.soulId, entityId: m.entityId, name: m.name, description: m.description, owner: ownerShort(m.owner), native: m.native,
      ...this.publicNameMetadata(m.soulId),
      ...(this.profilePhoto(m.soulId)?{profilePhoto:this.profilePhoto(m.soulId)!}:{}),
      intent: publicIntent(m.intent), intentText: describeIntent(publicIntent(m.intent), nameOf), mood: m.mood, energy: energyWord(m.energy), doing: this.doingOfV1(m),
      ...this.publicNow(m.soulId),
      ...(this.publicBodyOf?.(m.soulId) ? {body: this.publicBodyOf(m.soulId)!} : {}),
    };
  }
  /** LINK BODY: the body rule's public state for a Soul (edge worlds; the Ledger sets it). Re-sent via markSoulDirty. */
  publicBodyOf?:(soulId:string)=>NonNullable<PublicSoul['body']>|null;
  /** A human-readable name for a kernel thing id, an engine entity id or a region id. */
  nameOf(id: string): string { return this.kernel.things[id]?.name ?? this.engine.world.entities[id]?.label ?? this.engine.world.regions[id]?.label ?? id; }
  private stationGenesisV1?:string;
  stationBindingV1(){
    this.assertClockReady();
    this.stationGenesisV1??=stationGenesisIdV1(this.worldId,this.seed,this.factory.genesis(this.seed));
    return {worldId:this.worldId,genesisId:this.stationGenesisV1,rulesVersion:this.engine.rulesVersion,dtSeconds:this.engine.dt};
  }
  stationHistoryV1():StationHistoryV1|undefined {
    const state=this.extra.stationV1 as StationHistoryV1|undefined;
    if(state){const binding=this.stationBindingV1();
      if(state.station.worldId!==binding.worldId||state.station.genesisId!==binding.genesisId||state.station.dtSeconds!==binding.dtSeconds)
        throw new Error('station snapshot belongs to another world or history');}
    if(state)this.stationPhysicalHeadV1();
    return state?structuredClone(state):undefined;
  }
  stationPhysicalHeadV1():StationPhysicalHeadV1|undefined {
    const old=this.extra.stationV1 as StationHistoryV1|undefined;if(!old)return undefined;
    if(this.db.world(this.worldId)?.dt!==this.engine.dt)throw new Error('station world header dt differs from native history');
    const era=this.extra.stationEraV1 as StationEraFoldStateV1|undefined;
    if(era&&hashOf(era.station)!==hashOf(old.station))throw new Error('station era original snapshot differs');
    const head=acceptStationPhysicalHeadV1(era?.head??initialStationPhysicalHeadV1(old.station),old.station,this.stationBindingV1());
    if(head.era){
      const source=this.db.events(this.worldId,head.source!.seq-1,1)[0],fact=this.db.events(this.worldId,head.era.seq-1,1)[0];
      if(!source||source.kind!=='rules'||Object.keys(source.payload).length!==1||!fact||fact.kind!=='station-rules-era-v1'
        ||hashOf(stationSourceFromRulesV1(this.worldId,source))!==hashOf(head.source)
        ||hashOf({seq:fact.seq,tick:fact.tick,payload:fact.payload})!==hashOf(head.era))throw new Error('station head lacks canonical physical/era pair');
    }
    return head;
  }
  stationHistoryV2():StationHistoryV2|undefined {
    const old=this.stationHistoryV1();if(!old)return undefined;
    return structuredClone(this.extra.stationV2 as StationHistoryV2|undefined??initialStationHistoryV2(old));
  }
  /** Trusted internal projection; authorization belongs to its caller. Detached
   * copies prevent card look-ahead and consumers from mutating private truth. */
  intentHistoryOf(soulId: string): IntentHistoryV2 {
    const histories = this.extra.intentHistoriesV2 as Record<string, IntentHistoryV2> | undefined;
    return histories && Object.hasOwn(histories, soulId)
      ? structuredClone(histories[soulId]) : emptyIntentHistoryV2(this.worldId, soulId);
  }
  /** Owner-will changes, excluding observations of work already admitted. */
  intentWillSeqOf(soulId:string):number {
    const history=(this.extra.intentHistoriesV2 as Record<string,IntentHistoryV2>|undefined)?.[soulId];
    return history?Object.values(history.intents).reduce((seq,entry)=>Math.max(seq,entry.statusSeq),0):0;
  }
  kernelView(): KernelView {
    const k = this.kernel; k.tick = this.engine.world.tick;
    const links = Object.fromEntries(Object.entries(k.links).filter(([, l]) => l.until === undefined || l.until >= k.tick));
    const things=Object.fromEntries(Object.entries(k.things).map(([id,t])=>[id,{...t,states:Object.fromEntries(Object.entries(t.states).filter(([key])=>key!==MANDATE_STATE))}]));
    return { tick: k.tick, things, links, decks: k.decks, vocab: k.vocab, hash: kernelHash({...k,things}).slice(0, 16), plays: this.counts };
  }
  viewHash(): string {
    const w = this.engine.world;
    return viewHashOf(Object.keys(w.entities).filter((id) => w.entities[id].kind === 'human').map((id) => viewRow(w.entities[id], this.engine.poseSampleOf(id))));
  }
  snapshotView(): Snapshot {
    this.assertClockReady();
    const w = this.engine.world;
    // Lane L5: a reconnect storm after a stall asks for this many times within one tick. The entity copy and the paths
    // are the same until the engine steps or accepts input (tick, log seq), so they are built once per state. Callers
    // only read the copy (the hub packs it); it is still a copy, never the live table.
    let c = this.viewCache;
    if (!c || c.engine !== this.engine || c.tick !== w.tick || c.seq !== this.seq) {
      const paths: PathCommit[] = [];
      for (const id of Object.keys(w.entities)) { const p = this.engine.currentPath(id); if (p) paths.push(p); }
      c = this.viewCache = { engine: this.engine, tick: w.tick, seq: this.seq, entities: structuredClone(w.entities), paths };
    }
    return {
      tick: w.tick, seq: this.batchSeq, viewHash: this.viewHash(),
      entities: c.entities, regions: w.regions, env: w.env, paths: c.paths,
      souls: [...this.minds.values()].map((m) => this.publicSoul(m)),
    };
  }
  private viewCache: { engine: Engine; tick: number; seq: number; entities: Snapshot['entities']; paths: PathCommit[] } | null = null;

  private kernelSentTick = -1000;
  private resetAcc() { this.acc = { paths: [], changes: [], log: [], dirty: new Set(), removed: [], plays: [], fromTick: this.engine.world.tick }; }
  private flush() {
    const b: Batch = {
      seq: ++this.batchSeq, fromTick: this.acc.fromTick, toTick: this.engine.world.tick,
      paths: this.acc.paths, changes: this.acc.changes, log: this.acc.log, removedSouls: this.acc.removed,
      souls: [...this.acc.dirty].map((id) => this.minds.get(id)).filter((m): m is Mind => !!m).map((m) => this.publicSoul(m)),
    };
    const plays = this.acc.plays;
    this.resetAcc();
    this.ring.push(b); if (this.ring.length > RING_BATCHES) this.ring.shift();
    for (const l of this.listeners) l.onBatch?.(b);
    // links such as "just said" lapse with time, so the view also refreshes periodically
    // the whole kernel is large; what changed is already in the plays, so the full view goes out at most every two seconds
    if (plays.length) this.kernelDirty = true;
    if ((this.kernelDirty && this.engine.world.tick - this.kernelSentTick >= 40) || this.engine.world.tick % 200 === 0) { this.kernelDirty = false; this.kernelSentTick = this.engine.world.tick; const v = this.kernelView(); for (const l of this.listeners) l.onKernel?.(v); }
  }
  markDirty(soulId: string) { this.acc.dirty.add(soulId); }
  get currentBatchSeq() { return this.batchSeq; }

  private heartbeat() {
    // A rotating handful of authoritative pose keyframes lets clients check individual entities.
    const humans = Object.keys(this.engine.world.entities).filter((id) => this.engine.world.entities[id].kind === 'human').sort();
    const keyframes: Heartbeat['keyframes'] = {};
    for (let i = 0; i < Math.min(8, humans.length); i++) { const id = humans[(this.kfCursor + i) % humans.length]; keyframes[id] = this.engine.poseSampleOf(id); }
    this.kfCursor += 8;
    const h: Heartbeat = { tick: this.engine.world.tick, seq: this.batchSeq, viewHash: this.viewHash(), keyframes, clients: 0, clockRate: this.clockRate, paused: this.paused };
    for (const l of this.listeners) l.onHeartbeat?.(h);
  }

  // ------------------------------------------------------------ snapshots
  snapshotMs = { capture: 0, persist: 0, finish: 0, serialize: 0 };
  /** The periodic snapshot is due: the tick ceiling, a requested one, or enough replay debt (see `snapshotDebtMs`). */
  snapshotDue(now = this.engine.world.tick): boolean {
    if (now - this.lastSnapshotTick >= this.snapshotEvery) return true;
    if (this.snapshotSoon) return true;
    if (!(this.snapshotDebtMs > 0) || this.replayDebtMs < this.snapshotDebtMs) return false;
    return performance.now() - this.lastSnapshotWall >= Math.max(this.snapshotMinGapMs, 20 * this.lastSnapshotCostMs);
  }
  /** Wall ms since the last capture of the head (a boot counts as one: it starts from what is durable). */
  snapshotAgeMs(): number { return performance.now() - this.lastSnapshotWall; }
  /** Snapshot on demand (lane L5; LOAD-CONTRACT planned restart, the stop path, entering red). `now: true` captures and
   *  persists the head synchronously before returning (a planned restart or a stop); otherwise the snapshot is taken at
   *  the end of the next tick through the sliced periodic path, so the caller's tick is not lengthened. Returns null
   *  when the clock is unavailable (a failed world snapshots nothing). */
  requestSnapshot(reason: string, options?: { now?: boolean }): { tick: number; pending: boolean } | null {
    if (!this.clockAvailable) return null;
    if (!options?.now) { this.snapshotSoon ??= reason; return { tick: this.engine.world.tick, pending: true }; }
    const t0 = performance.now(), r = this.saveSnapshot(true);
    console.log(`[snapshot] ${reason}: tick ${r.tick}${r.pending ? ' (head not serializable: checkpoint logged)' : ''} in ${Math.round(performance.now() - t0)} ms`);
    return { tick: r.tick, pending: !!r.pending };
  }
  /** A capture took the head: the replay debt starts again from here. */
  private snapshotTaken() { this.replayDebtMs = 0; this.lastSnapshotWall = performance.now(); this.snapshotSoon = null; }
  /** Capture is synchronous (it must see one consistent tick); the database write is deferred past the current tick. */
  saveSnapshot(sync = true): { tick: number; stateHash: string; pending?: undefined } | { pending: boolean; tick: number; stateHash?: undefined } {
    this.assertClockReady();
    this.cancelPeriodicSnapshot();
    this.drainInputs();
    if (this.repairRules && !this.clockAvailable) return { pending: false, tick: this.engine.world.tick };   // nothing more from this head
    if(this.durableClockV1)this.persistClockFrontier();
    if (this.engine.canSnapshot && !this.engine.canSnapshot()) {
      // A graceful close still needs a durable replay destination when the
      // controller cannot serialize. Periodic retries must not log every tick.
      if (sync) {
        void this.enqueue('rules', 'world', { checkpoint: 'unsnappable-head' });
        this.drainInputs();
      }
      return { pending: true, tick: this.lastSnapshotTick };
    }
    return this.snapshotHead(sync);
  }
  /** Capture and persist the head as the snapshot and recovery baseline (the caller has checked it can snapshot). */
  private snapshotHead(sync: boolean): { tick: number; stateHash: string } {
    this.cancelPeriodicSnapshot();
    return this.commitHead(this.captureHead(), sync);
  }
  private captureHead() {
    const t0 = performance.now();
    const runtime = this.engine.snapshot();
    return { t0, runtime, body: this.captureBody(runtime), physicalHash: this.engine.physicalHash() };
  }
  private commitHead({ t0, runtime, body, physicalHash }: ReturnType<WorldHost['captureHead']>, sync: boolean): { tick: number; stateHash: string } {
    // captureBody owns every field; persistence only reads it, and restoration/
    // recovery recipes clone before mutation. Keep one immutable captured body.
    // #1150: a head captured here during a failing stretch is marked and serves a boot, never a rewind. A sliced capture
    // only starts on a tick that stepped clean, so it stays unmarked, as the first clean tick after a stretch would.
    if (this.stepFailing || this.bootedFaulted) body.faultedHeadV1 = true; else this.recoveryBaseline = body;
    this.recoveryCapture = null;
    const meta = { tick: runtime.tick, seq: this.seq, stateHash: runtime.stateHash, physicalHash, rulesVersion: this.engine.rulesVersion, body };
    this.snapshotMs.capture = performance.now() - t0;
    this.lastSnapshotTick = runtime.tick; this.snapshotTaken();
    const generation = this.snapshotGeneration;
    const persist = () => { if (generation !== this.snapshotGeneration) return; const t1 = performance.now(); this.db.saveSnapshot(this.worldId, meta); this.snapshotMs.persist = performance.now() - t1;
      this.lastSnapshotCostMs = this.snapshotMs.capture + this.snapshotMs.persist; };
    if (sync) persist(); else setImmediate(persist);
    return { tick: runtime.tick, stateHash: runtime.stateHash };
  }
  /** Periodic checkpoints own a complete boundary before yielding. Only emission
   * and persistence use continuations; ordinary/manual snapshots keep their API. */
  private schedulePeriodicSnapshot(): void {
    if (this.periodicSnapshot) return;
    if (!this.engine.captureCheckpoint && !this.engine.captureSnapshot) { this.saveSnapshot(false); return; }
    this.assertClockReady(); this.drainInputs();
    if (this.repairRules && !this.clockAvailable) return;
    if (this.durableClockV1) this.persistClockFrontier();
    if (this.engine.canSnapshot && !this.engine.canSnapshot()) return;
    this.snapshotGeneration++;
    const t0 = performance.now(), engine = this.engine;
    const captured = engine.captureCheckpoint?.();
    const checkpoint = captured && !('stateHash' in captured) ? captured : undefined;
    const legacy = captured && 'stateHash' in captured ? captured : checkpoint ? undefined : engine.captureSnapshot!();
    const fields = this.captureHostState();
    const physicalHash = checkpoint ? undefined : engine.physicalHash();
    const tick = checkpoint?.tick ?? legacy!.tick;
    const frontier = { tick, seq: fields.seq, rulesVersion: engine.rulesVersion };
    const materialize = (): SnapshotBody => ({ runtime: checkpoint ? checkpoint.finish().snapshot : legacy!.finish(), ...fields });
    const legacySteps = legacy?.steps(); // Preserve synchronous iterator-setup errors before publishing ownership.
    const steps = checkpoint ? checkpoint.steps() : (function* (): Generator<void, EngineCheckpoint, void> {
      return { snapshot: yield* legacySteps!, physicalHash: physicalHash! };
    })();
    const job = { engine, previousTick: this.lastSnapshotTick, previousDebt: { ms: this.replayDebtMs, wall: this.lastSnapshotWall, soon: this.snapshotSoon }, immediate: null as NodeJS.Immediate | null };
    this.periodicSnapshot = job;
    // Keep at most the preceding completed body while hashes are pending. It is
    // never substituted for this ticket during normal recovery; failed tickets
    // stop the clock instead of publishing a recovery from an older frontier.
    this.recoveryCapture = materialize;
    this.lastSnapshotTick = tick; this.snapshotTaken();
    this.snapshotMs.capture = performance.now() - t0;
    this.snapshotMs.finish = 0; this.snapshotMs.serialize = 0;
    const current = () => this.periodicSnapshot === job && this.engine === engine;
    const fail = (error: unknown) => {
      if (!current()) return;
      // A failed checkpoint never claims durability. Fail closed through the
      // existing unavailable-clock path instead of losing an async exception.
      this.failCheckpoint(error);
    };
    const later = (work: () => void) => {
      job.immediate = setImmediate(() => {
        job.immediate = null;
        if (!current()) { if (this.periodicSnapshot === job) this.cancelPeriodicSnapshot(); return; }
        try { work(); } catch (error) { fail(error); }
      });
    };
    const finish = () => {
      const start = performance.now();
      let result: IteratorResult<void, EngineCheckpoint>;
      do { result = steps.next(); } while (!result.done && performance.now() - start < 4);
      this.snapshotMs.finish += performance.now() - start;
      if (!result.done) { later(finish); return; }
      const body: SnapshotBody = { runtime: result.value.snapshot, ...fields };
      const meta = { ...frontier, stateHash: result.value.snapshot.stateHash, physicalHash: result.value.physicalHash };
      if (this.recoveryCapture === materialize) { this.recoveryBaseline = body; this.recoveryCapture = null; }
      // JSON and SQLite each take tens of milliseconds on a large world. Give
      // queued HTTP/ticks a turn between them without changing stored bytes.
      later(() => {
        const at = performance.now(), json = JSON.stringify(body);
        this.snapshotMs.serialize = performance.now() - at;
        later(() => {
          const at = performance.now(); this.db.saveSnapshotSerialized(this.worldId, meta, json);
          this.snapshotMs.persist = performance.now() - at;
          this.lastSnapshotCostMs = this.snapshotMs.capture + this.snapshotMs.finish + this.snapshotMs.serialize + this.snapshotMs.persist;
          this.periodicSnapshot = null;
        });
      });
    };
    later(finish);
  }
  private failCheckpoint(error: unknown, rule = 'durability.checkpoint'): void {
    console.error('[snapshot] periodic checkpoint failed', error);
    this.recoveryCapture = null;
    this.clockFailure = error instanceof Error ? error : new Error('periodic checkpoint failed', { cause: error }); this.paused = true; this.stop();
    this.recordGlitch('halt', error, {rule});
    for (const listener of this.listeners) try { listener.onClockUnavailable?.(); } catch { /* preserve checkpoint fault */ }
  }
  /** Superseding snapshots, recovery and stop must not leave a writer scheduled
   * against an old engine or a database the owner may close next. */
  private cancelPeriodicSnapshot(): void {
    this.snapshotGeneration++;
    const job = this.periodicSnapshot;
    if (!job) return;
    if (job.immediate) clearImmediate(job.immediate);
    this.periodicSnapshot = null;
    this.lastSnapshotTick = job.previousTick;
    // the debt the cancelled capture would have cleared is still owed (a superseding snapshot clears it again)
    this.replayDebtMs += job.previousDebt.ms; this.lastSnapshotWall = job.previousDebt.wall; this.snapshotSoon ??= job.previousDebt.soon;
  }
  private persistClockFrontier():void {
    try{
      const frontier:ClockFrontierV1={contract:'durable-clock-frontier/1',worldId:this.worldId,
        seedHash:hashOf(this.db.world(this.worldId)!.seed),rulesVersion:this.engine.rulesVersion,dtSeconds:this.engine.dt,
        tick:this.engine.world.tick,throughSeq:this.seq,headEventHash:this.clockFrontiers.headHash(this.worldId,this.seq),
        engineHash:this.engine.stateHash(),kernelHash:kernelHash(this.kernel)};
      this.clockFrontiers.write(frontier);
    }catch(error){
      this.clockFailure=error;this.paused=true;this.stop();
      this.recordGlitch('halt',error,{rule:'durability.clock-frontier'});
      for(const listener of this.listeners)try{listener.onClockUnavailable?.();}catch{/* The durable fault remains the cause. */}
      throw error;
    }
  }
}

export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const ownerShort = (owner: string) => (owner === 'system' ? 'world' : `u${hash32(owner).toString(36)}`);
export const energyWord = (e: number) => (e > 75 ? 'energetic' : e > 45 ? 'fine' : e > 20 ? 'tired' : 'exhausted');
const shorten = (s: string) => (s.length > 70 ? s.slice(0, 67) + '...' : s);
