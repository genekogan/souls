// EDGE-CONTRACT-v1 shared surface (team/CONTRACTS/EDGE-CONTRACT-v1.md).
// Owned by Core-Ledger; Core-Comms reads it and proposes changes via INBOX-core.
import type {Context} from 'hono';
import type {WorldHost} from '../world.ts';
import type {Db} from '../db.ts';
import type {Souls} from '../souls.ts';
import type {EdgeOutcomeV1} from '@souls/protocol';

export const EDGE_CONTRACT = 'eden-edge/1' as const;
export type ObjectBodyAdmission={guard:()=>true;commit:(receiptId:string)=>Record<string,unknown>|void};
export type PlaceRef = {id: string; name: string; kind: string};
export type EdgeSoul = {soulId: string; entityId: string; name: string; owner: string};
export type ReceiptPhase = 'waiting' | 'started' | 'completed' | 'failed' | 'replaced';
export type EdgeReceipt = {id: string; soulId: string; capability: string; phase: ReceiptPhase; acceptedTick: number; startedTick: number | null; endedTick: number | null; code: string | null; reason: string | null; programId: string | null;
  /** Core-A (EDGE-CONTRACT-v1 §8): body | attention | none; what an intent chose; where the body ended (terminal receipts). */
  channel?: string; chosen?: unknown; endedAt?: unknown;outcome?:EdgeOutcomeV1;
  /** An open paired gesture/give nobody has accepted yet: the receipt reads `waiting` until a guest accepts. */
  awaitingAnswer?: {invite: string; what: string; waitingFor: {soulId: string; name: string}[]; expiresInSeconds: number; note: string}};
export type NearbyBody = {soulId: string; entityId: string; name: string; distance: number; placeId: string; state: string; activity: string};

/** Read-only ledger facts Comms may use to route events and speech. */
export interface EdgeLedgerHooks {
  placePathOf(soulId: string): PlaceRef[];
  /** Innermost enclosed place containing the Soul's body, or null when outdoors. */
  enclosureOf(soulId: string): string | null;
  /** Bodies of other Souls the given Soul can perceive (enclosure rule applied), within `radius` metres. */
  perceivedBodies(soulId: string, radius: number): NearbyBody[];
  /** Receipt phase changes (live and after boot). */
  onReceipt(listener: (r: EdgeReceipt) => void): void;
  /** A Soul's innermost place changed. */
  onPlaceChange(listener: (e: {soulId: string; from: string | null; to: string | null; tick: number}) => void): void;
  /** Opaque capability providers (Comms objects) are merged into capabilities. */
  /** `only`: the object ids a focused menu build names (L3); absent: every object. `places`: filled with each offered
   *  object's place id (the listing's page ranks object offers by it). `projection.exactWalk`: 'objects-only' = its
   *  offers are read-only object offers that can never replace a walk (continuity exact walk). */
  addCapabilityProvider(p: (soul: EdgeSoul, only?: ReadonlySet<string>, places?: Map<string, string>) => EdgeCapability[], projection?: {exactWalk:'objects-only'}): void;
  /** Persist a refusal for measurement (no text from agents). */
  recordRefusal?(soulId: string, verb: string, capability: string, code: string, reason?: string): void;
  /** carrier/1: a native ride's public state, for ride objects (null when there is no such carrier). */
  carrierView?(entityId: string): unknown;
  /** VEHICLE-STEER: a steer destination (a known place or compass direction + distance) as ground (x, z). */
  steerTarget?(soulId: string, entityId: string, spec: {to?: string; direction?: string; distance?: number}): {ok: true; x: number; z: number; label: string} | {ok: false; code: string; reason: string; did_you_mean?: unknown};
  /** VEHICLE-STEER: the engine's refusal for a steer step now, or null. */
  steerCheck?(entityId: string, carrier: string, step: {x?: number; z?: number; land?: boolean; stop?: boolean}): {code: string; reason: string} | null;
  /** OBJECT-CONTRACT §7: perform an object action's body steps as a logged decision with a normal receipt. */
  /** EVENTS-v1: a Soul's body position and heading yaw (facing = (cos yaw, sin yaw)), for bearings in event envelopes. */
  poseOf?(soulId: string): {x: number; z: number; yaw: number} | null;
  /** EVENTS-v1 fade-by-abandonment: what the body holds that its own agent chose (an activity in progress, seated, lying, riding…), or null. */
  postureHold?(soulId: string): string | null;
  contactActuatorDetail?(soul:EdgeSoul,id:string,action:string,params?:Record<string,unknown>):Record<string,unknown>|null;
  performBodies?(soul: EdgeSoul, capability: string, label: string, steps: {verb: string; params: Record<string, unknown>}[], clientRef?: string,effects?:unknown,admission?:ObjectBodyAdmission): Promise<{accepted: true; receipt: EdgeReceipt} | {accepted: false; code: string; reason: string}>;
}
export type EdgeCapability = {id: string; verb: string; label: string; aliases?: readonly string[]; available: boolean; target?: {id: string; kind: string}; blocked?: {code: string; reason: string}; params?: Record<string, unknown>; object?: string; action?: string};
export type EdgeDeps = {host: WorldHost; db: Db; souls: Souls; build?: string; soul(c: Context): EdgeSoul; ledger: EdgeLedgerHooks;
  /** The signed-in owner's Soul `id` (owner routes such as PUT /v1/souls/:id/look); throws when not theirs. */
  ownerSoul?(c: Context, id: string): Promise<EdgeSoul>;
  /** SOULSIM-H F1: the owner inbox, so a Soul's `wait` returns as soon as its owner writes (the agent sees it mid-action). */
  ownerInbox?: {onSoulSend(listener: (soulId: string) => void): void; ownerWrote(s: {scope: string; owner: string}, since: number): {waiting: number; newestAt: number} | null;
    /** LINK BODY: the agent's listen presence per Soul, and a wake when a listen opens (edge/ledger/body-rule.ts). */
    soulPresence?(soulId: string): {listening: boolean; at: number | null}; onSoulListen?(listener: (soulId: string) => void): void}};
export class EdgeError extends Error {readonly status: number; readonly code: string; readonly extra?: Record<string, unknown>; constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {super(message); this.status = status; this.code = code; if (extra) this.extra = extra;}}
/** The `error` object of an eden-edge/1 refusal: code, message and any structured detail (e.g. `control.revoked`). */
export const edgeErrorOf = (e: EdgeError) => ({code: e.code, message: e.message, ...e.extra});
export const edgeBody = <T extends object>(body: T) => ({contract: EDGE_CONTRACT, ...body});
