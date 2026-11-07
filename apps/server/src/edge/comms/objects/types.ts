// OBJECT-CONTRACT-v1 types: how an object kind enters the world without core changes.
// A kind declares a typed state schema (with per-field visibility), Roles, and actions
// scoped to Roles with parameter schemas and validators. The framework stores state,
// validates and logs actions, filters state by entitlement and lists actions in
// capabilities.
import type {EdgeSoul} from '../../contract.ts';

export type SoulRef = {soulId: string; name: string};
export type FieldType = 'string' | 'integer' | 'boolean' | 'string[]' | 'soul' | 'soul?' | 'soul[]' | 'json';
/** `public`: anyone who can see the object; a role list: only holders of one of those roles. */
export type Visibility = 'public' | string[];
export type FieldSpec = {type: FieldType; visibility: Visibility; description?: string};
export type ParamSpec =
  | {type: 'string'; pattern?: string; enum?: string[]; maxLength?: number; optional?: boolean; description?: string}
  | {type: 'integer'; min?: number; max?: number; optional?: boolean; description?: string}
  | {type: 'boolean'; optional?: boolean; description?: string};

export type Refusal = {code: string; reason: string};
export type ObjectEvent = {to: string[]; kind?: 'object' | 'schedule'; text: string; data?: Record<string, unknown>; untrusted?: boolean};
/** carrier/1: the native ride an object may read (rides only; Ledger supplies it). */
export type CarrierView = NonNullable<ReturnType<import('../../ledger/ledger.ts').EdgeLedger['carrierView']>>;
export type ActionCtx = {soul: EdgeSoul; roles: string[]; tick: number; now: number; nameOf(soulId: string): string; inPlace: boolean; carrier?(entityId: string): CarrierView | null;
  /** VEHICLE-STEER: resolve a ride's steer destination for this Soul (a known place, or a direction + distance). */
  steerTarget?(entityId: string, spec: {to?: string; direction?: string; distance?: number}): {ok: true; x: number; z: number; label: string} | {ok: false; code: string; reason: string; did_you_mean?: unknown};
  /** VEHICLE-STEER: the engine's own refusal for this steer step now (null = it would be taken). */
  steerCheck?(carrier: string, step: {x?: number; z?: number; land?: boolean; stop?: boolean}): {code: string; reason: string} | null};
export type TimeCtx = {tick: number; now: number; nameOf(soulId: string): string; carrier?(entityId: string): CarrierView | null};
/** Body steps for the acting Soul (OBJECT-CONTRACT §7): the Ledger performs them as a logged decision with a normal receipt. */
export type BodyRequest = {label: string; steps: {verb: string; params: Record<string, unknown>}[]};
export type ActionOutcome<S> = {state: S; result?: Record<string, unknown>; events?: ObjectEvent[]; bodies?: BodyRequest[]};

export type ActionDef<S> = {
  label: string;
  /** Optional state-aware label (e.g. a ride's commitment: lifts off in ~N s, travels ~M min, returns); `label` stays the default. */
  labelFor?(state: S, ctx?: ActionCtx): string;
  /** Explicit admission boundary for actions that request a native body plan. */
  movesBody?:true;
  /** Roles allowed to take the action; 'anyone' includes Souls with no role. */
  roles: string[] | 'anyone';
  /** 'place': the Soul must be inside the object's place; 'anywhere': listed objects only. */
  reach: 'place' | 'anywhere';
  params: Record<string, ParamSpec>;
  /** Cheap precheck for capabilities (no params). Return a refusal to list it blocked. */
  available?(state: S, ctx: ActionCtx): Refusal | null;
  /** Full validation with params; null means legal. */
  validate(state: S, params: Record<string, unknown>, ctx: ActionCtx): Refusal | null;
  apply(state: S, params: Record<string, unknown>, ctx: ActionCtx): ActionOutcome<S>;
};

export type ObjectKind<S = any> = {
  kind: string;
  description: string;
  /** Readable (public fields) from anywhere, not only inside its place. */
  listed: boolean;
  roles: {id: string; relations?: {name: string; to: string}[]}[];
  schema: Record<string, FieldSpec>;
  initial(params: Record<string, unknown>, ctx: TimeCtx): S;
  rolesOf(state: S, soulId: string): string[];
  actions: Record<string, ActionDef<S>>;
  /** Time-driven transitions (doors open, curtain). Must be idempotent. */
  advance?(state: S, ctx: TimeCtx): {state: S; events?: ObjectEvent[]} | null;
  /** Per-viewer derived fields (e.g. my standby position); never other Souls' secrets. */
  personal?(state: S, soulId: string, roles: string[]): Record<string, unknown>;
  /** Souls whose public speech this Soul's `say` also reaches (Role relation `addresses`). */
  addressees?(state: S, soulId: string): string[];
};

export type ObjectRecord = {id: string; kind: string; name: string; description: string; placeId: string; version: number; state: unknown; createdAt: number};
