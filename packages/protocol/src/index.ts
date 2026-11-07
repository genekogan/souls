import {soulNameSchema,DEFAULT_SOUL_DESCRIPTION} from './soul-profile-v1.ts';
export * from './soul-profile-v1.ts';
export * from './purpose-context-v1.ts';
export * from './body-v1.ts';
import {intentArrivalFactV1} from './intent-arrival-v1.ts';
import {intentSleepStopV1Schema} from './intent-sleep-stop-v1.ts';
export * from './intent-sleep-stop-v1.ts';
// Wire protocol shared by server and clients: log events, WebSocket messages,
// REST payloads. Everything that crosses a process boundary is defined here.
export * from './mandate.ts';
export * from './columns-v1.ts';
export * from './presentation.ts';
export * from './owner-views.ts';
export * from './me-live.ts';
export * from './intent-v2.ts';
export * from './intent-history-page-v1.ts';
export * from './station-v1.ts';
export * from './station-era-v1.ts';
export * from './station-v2.ts';
export * from './station-era-page-v1.ts';
import { isStationFactV1, parseStationFactV1, type StationLiveV1 } from './station-v1.ts';
import { stationRulesEraV1Schema } from './station-era-v1.ts';
import { stationCueV2Schema,stationAnchorV2Schema,type StationLiveV2 } from './station-v2.ts';
import type { StationLiveContract } from './station-era-v1.ts';
import type {MeLiveDescriptorV1,MeLiveViewV1} from './me-live.ts';
import { z } from 'zod';
import type { ChangeEvent, Entity, Environment, PathCommit, PoseSample, Region } from '@souls/engine-contract';
import { hashOf, samplePath } from '@souls/engine-contract';
import type { Change, KState, LinkKind, MintedCard } from '@souls/kernel';
import { intentReceivedPayloadV2Schema, intentHistoryFactV2, intentAdmissionFactV2, intentControllerFactV2, publicIntentHistoryEventV2 } from './intent-v2.ts';

export const PROTO = 1;

// ---------------------------------------------------------------- intents
export const GOALS = ['wander', 'go', 'follow', 'attend', 'gather', 'converse', 'rest', 'perform'] as const;
/**
 * One step of an agenda: a card, optionally on a specific `target`, or on any target belonging
 * to `of` (something that thing hosts, made, holds, or the thing itself). `of` lets a plan name
 * a target that does not exist yet: "the gathering Rob hosts".
 */
export const agendaStepSchema = z.strictObject({ card: z.string().min(2).max(60), target: z.string().max(80).nullable().optional(), of: z.string().max(80).nullable().optional() });
/**
 * A standing intent. Either a legacy `goal` (compiled to a one-step agenda), or an
 * `agenda`: an ordered list of cards to favour, each optionally on a target. The Soul's
 * own mind still chooses every action; the agenda says which options serve the owner.
 * `note` and `text` are the owner's words: private to the owner and the Soul's mind.
 */
export const intentSchema = z.strictObject({
  goal: z.enum(GOALS).optional(),
  target: z.string().max(80).nullable().optional(),
  note: z.string().max(160).optional(),
  agenda: z.array(agendaStepSchema).min(1).max(8).optional(),
  text: z.string().max(280).optional(),
}).refine((i) => !!i.goal || !!i.agenda, { message: 'give a goal or an agenda' });
export type WireIntent = z.infer<typeof intentSchema>;
export type AgendaStep = z.infer<typeof agendaStepSchema>;
export const describeIntent = (i: WireIntent | null, nameOf: (id: string) => string = (x) => x): string => {
  if (!i) return 'no particular intent; live your life';
  let base: string;
  if (i.agenda?.length) base = i.agenda.map((a) => `${a.card}${a.target ? ` (${nameOf(a.target)})` : a.of ? ` (${nameOf(a.of)}’s)` : ''}`).join(', then ');
  else {
    const t = i.target ? nameOf(i.target) : null;
    base = { wander: 'wander around', go: `go to ${t ?? 'somewhere'}`, follow: `follow ${t ?? 'someone'}`, attend: `attend ${t ?? 'whatever is happening'}`,
      gather: `gather with others at ${t ?? 'a meeting place'}`, converse: `talk with ${t ?? 'someone'}`, rest: `rest${t ? ` at ${t}` : ''}`, perform: 'perform for others' }[i.goal!];
  }
  const own = i.text ?? i.note;
  return own ? `${base} (${own})` : base;
};
/** An intent with the owner's own words removed: what anyone may see. */
export const publicIntent = (i: WireIntent | null): WireIntent | null => { if (!i) return null; const { note: _n, text: _t, ...rest } = i; return rest; };

// ---------------------------------------------------------------- log events
export type EventKind = 'birth' | 'intent' | 'mandate' | 'decision' | 'edge-stop' | 'edge-relocate' | 'edge-god-walkout' | 'edge-attention' | 'body-assignment-v1' | 'world-edit' | 'play' | 'mint' | 'deck' | 'scene' | 'rules' | 'admin' | 'retire' | 'intent-request-v2' | 'intent-v2' | 'intent-admission-v2' | 'intent-controller-v2' | 'intent-arrival-v1' | 'intent-sleep-stop-v1' | 'station-epoch-v1' | 'station-cue-v1' | 'station-anchor-v1' | 'station-rules-era-v1' | 'station-cue-v2' | 'station-anchor-v2';
export type LogEvent = { seq: number; tick: number; kind: EventKind; author: string; payload: any; at: number };

export type BirthPayload = { soulId: string; entityId: string; name: string; description: string; owner: string;
  /** birth-near/1 (verifier probes): land on the nearest clear standing ground when the arrival point is built over. */
  near?: { at: [number, number]; first?: boolean } };
export type IntentPayload = { soulId: string; intent: WireIntent; source: 'web' | 'api' | 'mcp' | 'system' };
export type DecisionPayload = {
  soulId: string; entityId: string; option: string; label: string;
  steps: { verb: string; params: Record<string, unknown> }[];
  continue?: boolean;
  mood?: string; reevalTicks: number; fallback: boolean; call?: number; trigger: string;
  /** Present when the choice is a card: its effects apply once `approachLen` depiction steps have run. */
  card?: string; target?: string | null; manner?: string; approachLen?: number;
};
/** A card's effects being applied to the kernel. Replays without the engine or any model. */
export type PlayPayload = { soulId: string; card: string; hash: string; target: string | null; manner?: string };
/** A new word enters the vocabulary: a card, and any link kinds it needs. */
export type MintPayload = { card: MintedCard; links?: Record<string, LinkKind>; kinds?: Record<string, { summary: string }>; forSoul?: string };
/** A Soul's deck changes: cards dealt or retired, manners set. */
export type DeckPayload = { soulId: string; add?: string[]; remove?: string[]; manners?: string[]; why: string };
export type ScenePayload = { region: string; narrative: number; beat: Beat };
export type Beat = { at_min: number; kind: 'scene' | 'group' | 'soul'; directive: string; targets: string[]; flavor: string };

/** What anyone may see of a log event: an owner's own words (the intent note) are private to the owner. */
export function publicEvent(e: LogEvent): LogEvent {
  if(e.kind==='body-assignment-v1')return {...e,author:'world:body',payload:{contract:e.payload.contract,worldId:e.payload.worldId,soulId:e.payload.soulId,entityId:e.payload.entityId,body:e.payload.body}};
  if(e.kind==='intent-sleep-stop-v1'){const p=intentSleepStopV1Schema.parse(e.payload);return {...e,payload:{worldId:p.worldId,soulId:p.soulId,privateUpdate:true}};}
  if(e.kind==='station-rules-era-v1')return {...e,author:'world:station',payload:stationRulesEraV1Schema.parse(e.payload)};
  if(e.kind==='station-cue-v2')return {...e,author:'world:station',payload:stationCueV2Schema.parse(e.payload)};
  if(e.kind==='station-anchor-v2')return {...e,author:'world:station',payload:stationAnchorV2Schema.parse(e.payload)};
  if(isStationFactV1(e.kind))return {...e,author:'world:station',payload:parseStationFactV1(e.kind,e.payload)};
  if (e.kind === 'intent-request-v2') {
    const p = intentReceivedPayloadV2Schema.parse(e.payload);
    return { ...e, payload: { worldId: p.worldId, soulId: p.soulId, privateUpdate: true } };
  }
  if (e.kind === 'intent-v2') return { ...e, payload: publicIntentHistoryEventV2(intentHistoryFactV2(e)) };
  if (e.kind === 'intent-admission-v2') return { ...e, payload: publicIntentHistoryEventV2(intentAdmissionFactV2(e)) };
  if(e.kind==='intent-arrival-v1'){const p=intentArrivalFactV1(e);return {...e,payload:{worldId:p.worldId,soulId:p.soulId,privateUpdate:true}};}
  if (e.kind === 'intent-controller-v2') return { ...e, payload: publicIntentHistoryEventV2(intentControllerFactV2(e)) };
  if(e.kind==='mandate')return {...e,payload:{soulId:e.payload?.soulId,op:e.payload?.op,ruleId:e.payload?.ruleId??e.payload?.rule?.id,status:e.payload?.patch?.status??e.payload?.rule?.status}};
  if(e.kind==='rules'&&e.payload?.soulProfileV1){const p=e.payload.soulProfileV1;return {...e,payload:{soulProfileV1:{...p,owner:p.owner==='system'?'system':'someone'}}};}
  if (e.kind === 'rules' && e.payload?.recovery) { const r=e.payload.recovery; return {...e,payload:{recovery:{excluded:r.excluded,faults:r.faults,restored:true}}}; }
  if (e.kind === 'rules' && e.payload?.reflection) return { ...e, payload: { soulId: e.payload.soulId, reflection: { day: e.payload.reflection.day, written: true } } };
  if (e.kind === 'intent' && (e.payload?.intent?.note || e.payload?.intent?.text)) return { ...e, payload: { ...e.payload, intent: publicIntent(e.payload.intent) } };
  // who owns a Soul is an account id: the public sees only whether it is the world's or a person's
  if (e.kind === 'birth' && e.payload?.owner && e.payload.owner !== 'system') return { ...e, payload: { ...e.payload, owner: 'someone' } };
  // budgets and brain mode are the operator's business
  if (e.kind === 'admin') return { ...e, payload: { action: e.payload?.action } };
  return e;
}

// ---------------------------------------------------------------- public views
export type PublicSoul = {
  id: string; entityId: string; name: string; description: string; owner: string; // owner is an opaque short id
  nameAmbiguous?: true;
  profilePhoto?: {hash:string;url:string;mime:'image/png';width:number;height:number;bytes:number};
  intent: WireIntent | null; intentText: string; mood: string; energy: string; doing: string; native: boolean;
  /** LINK: the agent's self-authored public status line (≤140 chars, untrusted text), or null. */
  now?: {text: string; at: number} | null;
  /** LINK (COMMON-LINK §2): the body follows the agent's presence. awake = connected and directed; idle = connected, the
   *  idle reflex runs; zombie = disconnected, shuffling; asleep = disconnected, still. `doing` is the posture word (null when
   *  directed); `since` (ms) when the state began. Edge worlds only. */
  body?: {state: 'awake' | 'idle' | 'zombie' | 'asleep'; doing: 'standing' | 'sitting' | 'dozing' | 'drifting' | 'floating' | null; since: number};
};
export type BrainCall = {
  id: number; tick: number; at: number; tier: 'mid' | 'translate' | 'director' | 'narrator' | 'shot' | 'compile' | 'talk' | 'attune' | 'reflection';
  subject: string;
  /** Absent for world-level calls (narrator, director), which only admins see. */
  soulId?: string | null;
  model: string; request: unknown; response: unknown; applied: unknown;
  ms: number; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; mode: 'live' | 'fake'; error?: string;
};
/** A play as it resolved: what was attempted and what changed (or why nothing did). */
export type PlayView = { seq: number; tick: number; soulId: string; soul: string; card: string; target: string | null; targetName: string | null; manner?: string; ok: boolean; reason?: string; changes: Change[] };
/** Words rendered for something that was said. Depiction, not state: the act is in the kernel. */
export type TalkLine = { id: number; tick: number; at: number; from: string; to: string; fromName: string; toName: string; act: string; manner?: string; text: string; place: string | null };
/** The kernel as anyone may see it. */
export type KernelView = Pick<KState, 'tick' | 'things' | 'links' | 'decks'> & { vocab: KState['vocab']; hash: string; plays: Record<string, number> };
export type CameraLine = { tick: number; shot: unknown; text: string; heldSec: number };
export type TickerLine = { tick: number; text: string };
export type NarrativeView = { id: number; region: string; tick: number; summary: string; beats: (Beat & { fired: boolean; fireTick: number })[]; nextRunTick: number };

// ---------------------------------------------------------------- websocket
export * from './take-boundary-wire.ts';
export * from './take-entities-wire.ts';
export * from './take-chunk-wire.ts';
export type ClientMsg =
  | { t: 'hello'; proto: number; token?: string; since?: number; epoch?: string; stationContracts?:StationLiveContract[];takeTransport?:'take-boundary-facts/1';takeEntities?:'take-entities-ref/1';takeChunks?:'take-chunk-ref/1';takeEntitiesJoin?:'take-entities-join/1';snapshotColumns?:'columns/1' }
  | { t: 'resync'; reason: string }
  | { t: 'ping'; n: number };

export type Snapshot = {
  tick: number; seq: number; viewHash: string;
  entities: Record<string, Entity>; regions: Record<string, Region>; env: Environment;
  paths: PathCommit[]; souls: PublicSoul[];
};
export type Batch = {
  seq: number; fromTick: number; toTick: number;
  paths: PathCommit[]; changes: ChangeEvent[]; souls: PublicSoul[]; removedSouls: string[];
  log: LogEvent[];
};
export type Heartbeat = { tick: number; seq: number; viewHash: string; keyframes: Record<string, PoseSample>; clients: number; clockRate: number; paused: boolean };

export type TakeChunk = { fromTick: number; toTick: number; take: unknown };
export type TakeStream = { serverTick: number; chunks: TakeChunk[] };

export type ServerMsg =
  | {t:'me';view:MeLiveViewV1}
  | { t:'station-v2';view:StationLiveV2 }
  | { t:'station';view:StationLiveV1 }
  | { t: 'welcome'; build: string; proto: number; worldId: string; rulesVersion: string; schema: string; dt: number; clockRate: number; serverTick: number; you: Me | null; serverTime: number; /** identifies this server process: batch numbers are only comparable within one */ epoch?: string; paused?: boolean; stationContract?:StationLiveContract|null;privateMe?:MeLiveDescriptorV1;takeTransport?:'take-boundary-facts/1';takeEntities?:'take-entities-ref/1';takeChunks?:'take-chunk-ref/1';takeEntitiesJoin?:'take-entities-join/1' }
  | ({ t: 'snapshot'; reason: string; /** take-entities-join/1 only: this snapshot's entity table id */ entitiesTable?: number } & Snapshot)
  | ({ t: 'batch' } & Batch)
  | ({ t: 'heartbeat' } & Heartbeat)
  | ({ t: 'takes' } & TakeStream)
  | { t: 'log'; events: LogEvent[] }
  | { t: 'brain'; calls: BrainCall[] }
  | { t: 'kernel'; view: KernelView }
  | { t: 'plays'; plays: PlayView[] }
  | { t: 'talk'; lines: TalkLine[] }
  | { t: 'camera'; line: CameraLine }
  | { t: 'ticker'; lines: TickerLine[] }
  | { t: 'narrative'; view: NarrativeView }
  | { t: 'stats'; stats: ServerStats }
  | { t: 'pong'; n: number; serverTime: number }
  | { t: 'error'; code: string; message: string };

export type Me = { userId: string; short: string; email: string | null; wallet: string | null; role: 'user' | 'admin'; souls: string[]; invited: boolean };
export type ServerStats = {
  tick: number; tickMsAvg: number; tickMsMax: number; clients: number; entities: number; souls: number; liveActions: number;
  seq: number; logEvents: number; lastSnapshotTick: number; snapshotMs: { capture: number; persist: number }; dbBytes: number; uptimeSec: number; build: string;
  /** `costToday` and `budget` are sent to admins only. */
  brain: { mode: string; callsToday: number; costToday?: number; budget?: number; inflight: number; jevMsAvg: number };
};

// ---------------------------------------------------------------- view hash (the gradual-sync check)
/** Hash of what every client should agree on at a tick: each human's activity, seat and position. */
export function viewHashOf(rows: [string, string, string | null, number, number][]): string {
  return hashOf(rows.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1))).slice(0, 16);
}
export function viewRow(e: Entity, pose: PoseSample): [string, string, string | null, number, number] {
  return [e.id, e.human?.activity ?? '', e.human?.on ?? null, pose[1], pose[3]];
}
export { samplePath };
export * from './lifecycle.ts';
export * from './lifecycle-capability.ts';

// ---------------------------------------------------------------- REST
export const createSoulSchema = z.strictObject({
  name: soulNameSchema,
  description: z.string().trim().min(3).max(1200).default(DEFAULT_SOUL_DESCRIPTION),
});
export const commandSchema = z.strictObject({ text: z.string().trim().min(1).max(280) });
export const setIntentSchema = z.object({ intent: intentSchema });
export const adminSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('pause') }),
  z.strictObject({ action: z.literal('resume') }),
  z.strictObject({ action: z.literal('clock_rate'), rate: z.number().min(0.1).max(20) }),
  z.strictObject({ action: z.literal('narrate'), region: z.string() }),
  z.strictObject({ action: z.literal('brain_mode'), mode: z.enum(['live', 'fake']) }),
  z.strictObject({ action: z.literal('snapshot') }),
  z.strictObject({ action: z.literal('budget'), usdPerDay: z.number().min(0).max(100) }),
  z.strictObject({ action: z.literal('attune') }),
  z.strictObject({ action: z.literal('adopt_vocabulary') }),
  z.strictObject({ action: z.literal('invite'), uses: z.number().int().min(1).max(500), note: z.string().max(80).optional() }),
]);
export type AdminAction = z.infer<typeof adminSchema>;

export const pairExchangeSchema = z.strictObject({ code: z.string().trim().min(4).max(40), agent: z.string().trim().max(60).optional() });
export const pairStartSchema = z.strictObject({ agent: z.string().trim().max(60).optional() });
export const pairPollSchema = z.strictObject({ poll_token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });
export const pairApproveSchema = z.strictObject({ code: z.string().trim().min(4).max(40), soulId: z.string() });
export const inviteSchema = z.strictObject({ code: z.string().trim().min(3).max(40) });

export const proposeCardsSchema = z.strictObject({
  cards: z.array(z.any()).min(1).max(4),
  links: z.record(z.string().max(40), z.strictObject({ summary: z.string().max(120), control: z.boolean().optional() })).optional(),
  kinds: z.record(z.string().max(40), z.strictObject({ summary: z.string().max(120) })).optional(),
});

export * from './intent-arrival-v1.ts';
export {EDGE_OUTCOME_CONTRACT,edgeLearnedV1Schema,edgeProducedV1Schema,edgeOutcomeV1Schema,type EdgeOutcomeV1} from './edge-outcome-v1.ts';
