import {afterCommit} from '../comms/store.ts';
// together/1 (core-next4, ACTION-COVERAGE-AUDIT §3/§5 P2; Gene: gestures are "absolutely. critical even"):
// Souls do things with each other, natively and visibly, with light consent. No model calls; deterministic plans.
// - Gestures: hug / high-five / handshake / dance-with <soul> ask first (the other accepts, declines or ignores; an
//   unanswered invitation lapses in 30 s); bow / clap / nod / shake-head / cheer / point are solo (optionally facing
//   someone or something). Paired gestures run as one grouped pose (social/pose.ts together/1): both bodies step in
//   to face each other and share one start and end tick.
// - Invitations to activities: any activity act takes params.with (Souls); invitees accept and join (a shared start
//   for timed activities; walks become walking together; the balloon keeps their places and waits for them).
// - Follow / walk with a Soul until stopped.
// - Items: one hand slot per Soul. Pick up small things where they are found (books at shelves, flowers in gardens, a
//   cup or food at cafés and kitchens, letters at desks, tools in workshops, frisbees in the park), carry them (the
//   body's prop), give them (the other accepts), put them down (a small lasting object others can pick up; capped per
//   place, cleared after a while), eat or drink consumables. Items live in this ledger's table; the body only carries
//   the visible prop (human.holding), changed when a pose completes, so both agree.
import {menuWorldOf} from '../../split/menu-world.ts';
import {randomUUID} from 'node:crypto';
import {isRigidBody} from '../body/actions.ts';
import type {Program} from '@sim/engine-contract';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldHost} from '../../world.ts';
import type {Db} from '../../db.ts';
import type {EdgeCapability, EdgeReceipt, EdgeSoul, NearbyBody} from '../contract.ts';
import {centroid, type PlaceIndex} from './places.ts';
import {tokens} from './vocabulary.ts';
import type {SpotsData} from './activities.ts';
import {menuStats, cpuNow} from './menu-stats.ts';
import {RPS, RPS_SHAPES, isRpsShape, rpsResult, type RpsShape} from '../../../../../mars/viewer/engine/social/rps.ts';
import {HAND_GAP} from '../../../../../mars/viewer/engine/social/hand-hold.ts';
import {HANDOVER_GAP} from '../../../../../mars/viewer/engine/items/handover.ts';

type V2 = [number, number];
type Steps = Program['steps'];
export type TogetherPlan = {label: string; steps: Steps; seconds?: boolean;
  /** what this capability does beyond its body steps (invitations, items, follows) */
  together?: Tag};
type Tag =
  | {kind: 'paired'; what: Paired; guest: string; approach?: boolean}
  | {kind: 'give'; guest: string; item: string; approach?: boolean}
  /** entry 41: hand a held world thing (an opted-in lantern, bowl) to a Soul, hand to hand, if they accept */
  | {kind: 'hand-over'; guest: string; item: string; name: string; approach?: boolean}
  | {kind: 'accept'; invite: string}
  | {kind: 'decline'; invite: string}
  | {kind: 'withdraw'; invite: string}
  | {kind: 'let-go'}
  | {kind: 'follow'; target: string}
  | {kind: 'unfollow'; follower: string}
  | {kind: 'item'; op: 'pick-up' | 'put-down' | 'consume'; item?: string; source?: string; itemKind?: string}
  /** PC04 (#683): propose one shared physical operation; the first template carries a loose `shared-carry` load */
  | {kind: 'shared'; load: string; def: string; name: string; crew: [number, number]};
export type Paired = 'hug' | 'high-five' | 'handshake' | 'dance-with' | 'rps' | 'hold-hands';
export type ItemKind = 'book' | 'flower' | 'cup' | 'food' | 'letter' | 'tool' | 'frisbee';

/** Paired gestures: pose id, distance between body points (m), seconds, invitation lapse (s). */
export const PAIRED: Record<Paired, {activity: string; gap: number; seconds: number; lapse: number; ask: string; label: (n: string) => string}> = {
  hug: {activity: 'hug', gap: 0.52, seconds: 5, lapse: 30, ask: 'a hug', label: n => `Hug ${n} (asks first; they can accept or decline)`},
  'high-five': {activity: 'high-five', gap: 0.75, seconds: 2.5, lapse: 30, ask: 'a high five', label: n => `High-five ${n} (asks first)`},
  handshake: {activity: 'handshake', gap: 0.85, seconds: 3.5, lapse: 30, ask: 'a handshake', label: n => `Shake hands with ${n} (asks first)`},
  'dance-with': {activity: 'dance', gap: 1.0, seconds: 60, lapse: 45, ask: 'a dance', label: n => `Dance with ${n}, facing each other (asks first)`},
  // entry 35 (packet 44): a game of rock-paper-scissors face to face at arm's length; each throw is chosen alone and kept by
  // the world until "shoot" (params.shape here, and with the acceptance); the world says who won
  rps: {activity: 'rps', gap: 1.0, seconds: RPS.SECONDS, lapse: 30, ask: 'a game of rock-paper-scissors', label: n => `Play rock-paper-scissors with ${n} (asks first; choose your throw in shape: rock, paper or scissors, kept hidden until "shoot")`},
  // entry 35: holding hands, side by side; walks together until either lets go (hand_hold_v1, not a pose)
  'hold-hands': {activity: 'hold-hands', gap: HAND_GAP, seconds: 0, lapse: 30, ask: 'a hand to hold', label: n => `Offer ${n} your hand to hold (asks first; then you walk together hand in hand until either of you lets go)`},
};
const SHAPE_PARAM = {shape: {type: 'string', enum: [...RPS_SHAPES], description: 'your throw: rock, paper or scissors (the world keeps it hidden until "shoot")'}};
const SHAPE_REFUSAL = {code: 'rps.choose', reason: 'Choose your throw first: {"shape": "rock"}, "paper" or "scissors". The world keeps it hidden until "shoot".'};
/** Solo gestures (overlay poses): seconds, whether it can be done seated. */
export const SOLO: Record<string, {seconds: number; seated: boolean; label: string}> = {
  bow: {seconds: 2.5, seated: false, label: 'Bow (params.to: someone to bow to)'},
  clap: {seconds: 4, seated: true, label: 'Clap / applaud (params.to: someone to applaud)'},
  nod: {seconds: 1.5, seated: true, label: 'Nod (params.to: someone)'},
  'shake-head': {seconds: 1.5, seated: true, label: 'Shake your head (params.to: someone)'},
  cheer: {seconds: 3, seated: true, label: 'Cheer (params.to: someone)'},
  point: {seconds: 3, seated: true, label: 'Point at someone, a place or a thing (params.at)'},
};
/** srv-act-words: every verb an offer of `Together.capabilities` can have. A focused build whose focus names none of them,
 *  no `…:here`/`…:held` id and no target skips the together listing (edge-bind-one-oracle checks the set). */
export const TOGETHER_VERBS: ReadonlySet<string> = new Set([...Object.keys(PAIRED), ...Object.keys(SOLO), 'accept', 'decline', 'follow', 'ask-to-stop', 'give', 'put-down', 'eat', 'drink', 'pick-up']);
/** srv-act-words: whether a focused build may want an offer of the together listing (always, without a focus). */
export function togetherMayOffer(f: {ids: ReadonlySet<string>; verbs: ReadonlySet<string>; targets: ReadonlySet<string>; here?: boolean} | null | undefined): boolean {
  if (!f || f.here || f.targets.size) return true;
  for (const v of f.verbs) if (TOGETHER_VERBS.has(v)) return true;
  for (const id of f.ids) if (TOGETHER_VERBS.has(id.slice(0, Math.max(0, id.indexOf(':'))))) return true;
  return false;
}
export const ITEM_NAMES: Record<ItemKind, string> = {book: 'a book', flower: 'a flower', cup: 'a cup of tea', food: 'something to eat', letter: 'a letter', tool: 'a tool', frisbee: 'a frisbee'};
const CONSUMABLE = new Set<ItemKind>(['cup', 'food']);
/** Where things are found: place words (id + name) per item kind. */
const SOURCE_WORDS: [ItemKind, RegExp][] = [
  ['flower', /garden|flower|meadow|orchard|lavender|botanic|allotment/], ['cup', /tea|caf[eé]|kitchen|dining|bakery/], ['food', /kitchen|dining|bakery|market|kiosk|caf[eé]|orchard|vegetable/],
  ['tool', /barn|workshop|woodshop|shed|maker|potting/], ['frisbee', /playground|park|lawn|meadow/], ['book', /library/], ['letter', /post|office|library/],
];
const ITEM_WORDS: [ItemKind, RegExp][] = [['book', /\b(?:book|books|novel)\b/], ['flower', /\b(?:flower|flowers|rose|daisy|posy|bouquet)\b/], ['cup', /\b(?:cup|tea|coffee|mug|drink)\b/],
  ['food', /\b(?:food|snack|bread|apple|fruit|cake|bun|sandwich|something to eat|to eat)\b/], ['letter', /\b(?:letter|card|note|paper|postcard)\b/], ['tool', /\b(?:tool|hammer|trowel|chisel|spade)\b/], ['frisbee', /\b(?:frisbee|disc|disk)\b/]];
/** Bounds (Gene: simple, deterministic, bounded). */
export const ITEM_LIMITS = {perPlace: 12, placedWorld: 150, pickReach: 120, consumableMinutes: 20, keepHours: 4, nearItems: 20};
/** PC04 (#683): how long a shared proposal stays open (s). */
export const SHARED_LAPSE = 120;
const INVITE_RADIUS = 60, GESTURE_RADIUS = 8, APPROACH_RADIUS = 400, APPROACH_SECONDS = 240, FOLLOW_RADIUS = 20, FOLLOW_LOST = 45, CATCH_UP = 3;
/** A shared walk is only "together" when the guest ends beside the host: follow standoff is 1.5 m, so 2.2 m leaves slack but not 2.8 m apart. */
export const TOGETHER_RADIUS = 2.2;
export const besideEachOther = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOGETHER_RADIUS;

// Library plans finish with a short shelf visit. Invite the actual activity, not its browse epilogue.
const invitedPose = (steps: Steps) => [...steps].reverse().find(s => s.verb === 'mars:pose_v1' && s.params.activity !== 'browse')
  ?? [...steps].reverse().find(s => s.verb === 'mars:pose_v1');

/** Activity verbs an invitation may carry (params.with). */
const INVITABLE = new Set(['walk', 'stroll', 'wander', 'hang-out', 'gather', 'warm-by-fire', 'sit', 'sit-ground', 'lie', 'nap', 'read', 'write', 'swim', 'rest',
  'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'object',
  // CN5
  'use-computer', 'sing', 'listen', 'lift-weights', 'bench-press', 'pull-ups', 'dips', 'play-frisbee', 'play-petanque', 'play-volleyball',
  // GEST-LIVE: the shared spots are what an invitation is for ("invite Ada to cook together")
  'cook-together', 'tell-story', 'hear-story', 'book-club', 'social-dance', 'yoga-class']);

export type Invite = {id: string; what: string; host: {soulId: string; name: string}; guests: {soulId: string; name: string}[]; capability: string; label: string;
  kind: 'paired' | 'give' | 'activity' | 'ride' | 'shared'; pairedPolicy?: 'ready-v1';
  /** E2 #2 (2026-10-16): activity invitations carry the group window policy their poses use (absent on older invitations). */
  windowPolicy?: 'once-v1'; activity?: string; seconds?: number; gap?: number; prop?: string; base?: string;
  createdTick: number; expiresTick: number; state: 'pending' | 'closed'; responses: Record<string, 'accepted' | 'declined' | 'expired' | 'cancelled' | 'left'>;
  hostReceipt: string | null; guestReceipts: Record<string, string>;
  /** F1 (2026-10-20): where the host will stand for a paired gesture or hand-over (its meet spot, or where it already
   *  stood), or the destination of an invited activity, so a guest who accepts while the host is still walking there
   *  plans against that spot, not the moving body. */
  meetAt?: V2; item?: {id: string; kind: ItemKind; name: string}; ride?: {object: string; carrier: string}; place?: string | null;
  /** entry 35: rock-paper-scissors throws, kept by the world (never shown to the other before "shoot"), and who was told. */
  rps?: {host?: RpsShape; guest?: RpsShape; told?: string[]};
  /** entry 35: the hand an offerer holds out (hold-hands). */
  hand?: 'left' | 'right';
  /** entry 41: the world thing a hand-over passes (what = 'hand-over'; custody is the engine's, never this table's). */
  thing?: {id: string; name: string};
  /** PC04 (#683): the shared operation this invitation proposes (kind 'shared'). */
  shared?: SharedSession};
/** PC04 (#683, docs/design/shared-execution.md §1): a shared physical operation, held in its together invitation's body.
 *  `revision` bumps on any material change (load, destination, crew); each member accepts their own role against it, and
 *  a bump clears every acceptance. `op` stays null until a commit (PC05). */
export type SharedSession = {template: {id: 'carry'; version: 1}; revision: number; load: {entity: string; def: string; name: string};
  destination: {place: string; name: string}; roles: {role: 'carrier'; slot: number; soulId: string | null}[]; crew: [number, number];
  cleanup: 'set-down-here'; op: null; changed?: string};
/** What a shared receipt shows its own Soul (PC02 §5): the invitation, the revision it was made for, its role and phase. */
export type SharedReceiptV1 = {invite: string; revision: number; role: 'carrier'; slot: number | null; phase: 'pending' | 'ended'};
type Prepared = {steps: Steps; label?: string; commit?: (receipt: string) => void; noBody?: boolean;
  /** PC04: a shared proposal opens a `waiting` receipt with no body steps; `existing` answers a repeat with its receipt. */
  wait?: boolean; existing?: string; detail?: Record<string, unknown>};
export type Item = {id: string; kind: ItemKind; name: string; holder: string | null; placeId: string | null; at: V2 | null; state: 'held' | 'placed' | 'gone'; claimedBy: string | null; by: string | null; createdAt: number; placedAt: number | null};
type ItemOp = {soulId: string; op: 'pick-up' | 'put-down' | 'consume' | 'give' | 'take'; item?: string; kind?: ItemKind; source?: string; to?: string; invite?: string};
/** SOCIAL-APPROACH: the act waiting at the end of a walk over to its partner (its pose steps, params, label). */
type Approach = {tag: Extract<Tag, {kind: 'paired' | 'give' | 'hand-over'}>; capability: string; label: string; act: Steps; params: Record<string, unknown>; untilTick: number};
type Follow = {receipt: string; soulId: string; target: string; untilTick: number; withHost?: string};

/** What the ledger lends this module (closures over its internals). */
export type TogetherPort = {
  host: WorldHost; db: Db; places: PlaceIndex; spots: () => SpotsData;
  /** The static world's version (places, spots, navigation epoch): caches of static reads key on it (L3). */
  staticVersion?: () => string;
  body(entityId: string): NativeWorld['entities'][string] | undefined;
  perceived(soulId: string, radius: number): NearbyBody[];
  receipt(soulId: string, id: string): EdgeReceipt | null;
  fail(receiptId: string, code: string, reason: string): void;
  complete(receiptId: string): void;
  /** The receipt's programme, if it is still running for that body. */
  running(soulId: string, receiptId: string): boolean;
  stop(soulId: string, entityId: string, receiptId: string): void;
  aboard(entityId: string): {id: string; phase: string; label: string} | null;
  faded(soulId: string): boolean;
  innermostPlace(soulId: string): string | null;
  deliver(soulId: string, kind: string, body: Record<string, unknown>): void;
  spectate(m: Record<string, unknown>): void;
  touch(soulId: string): void;
  decide(soul: EdgeSoul, receipt: string, capability: string, label: string, steps: Steps): Promise<unknown>;
  /** PC04 (#683): shared physical operations (carry-with) are offered; default off until PC05 can commit them. */
  sharedCarry?: boolean;
};

const pose = (activity: string, seconds: number, extra: Record<string, unknown> = {}) => ({verb: 'mars:pose_v1', params: {activity, seconds, ...extra}});
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A deterministic item source (sources()): a shelf, a writing desk or a walkable place by kind. */
type ItemSource = {id: string; kind: ItemKind; label: string; at: V2; face?: V2; place: string | null};
export class Together {
  private p: TogetherPort;
  private follows = new Map<string, Follow>();          // receipt id → follow
  private approaches = new Map<string, Approach>();     // receipt id → a walk over to a Soul before a paired act or hand-over
  constructor(port: TogetherPort) {
    this.p = port;
    port.db.db.exec(`CREATE TABLE IF NOT EXISTS edge_invites_v1 (world_id TEXT NOT NULL, invite_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, invite_id));
      CREATE INDEX IF NOT EXISTS edge_invites_v1_state ON edge_invites_v1 (world_id, state);
      CREATE TABLE IF NOT EXISTS edge_invite_receipts_v1(world_id TEXT NOT NULL,receipt_id TEXT NOT NULL,invite_id TEXT NOT NULL,PRIMARY KEY(world_id,receipt_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS edge_items_v1 (world_id TEXT NOT NULL, item_id TEXT NOT NULL, state TEXT NOT NULL, holder TEXT, place_id TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, item_id));
      CREATE INDEX IF NOT EXISTS edge_items_v1_holder ON edge_items_v1 (world_id, holder);
      CREATE INDEX IF NOT EXISTS edge_items_v1_state ON edge_items_v1 (world_id, state);
      CREATE TABLE IF NOT EXISTS edge_item_ops_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE TABLE IF NOT EXISTS edge_follows_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id));`);
    // follows survive a restart only while their receipt is still followed (otherwise the receipt itself ended)
    for (const r of port.db.db.prepare('SELECT receipt_id, body FROM edge_follows_v1 WHERE world_id=?').all(port.host.worldId) as {receipt_id: string; body: string}[]) {
      const f = JSON.parse(r.body) as Follow, rec = port.receipt(f.soulId, f.receipt);
      if (rec && (rec.phase === 'started' || rec.phase === 'waiting')) this.follows.set(f.receipt, f); else this.dropFollow(f.receipt);
    }
  }
  private get w() {return menuWorldOf(this.p.host).world as NativeWorld;}
  private get tick() {return menuWorldOf(this.p.host).world.tick;}
  private mindOf(soulId: string) {return this.p.host.minds.get(soulId);}
  private posOf(soulId: string): V2 | null {const m = this.mindOf(soulId), b = m ? this.p.body(m.entityId) : undefined; return b ? [b.pose.p[0], b.pose.p[2]] : null;}
  private seated(entityId: string) {const h = this.p.body(entityId)?.human; return !!h && (h.activity === 'sit' || h.baseActivity === 'sit');}
  private standFirst(entityId: string): Steps {return this.seated(entityId) ? [{verb: 'stand', params: {}}] : [];}
  /** A clear straight line between two standing points (nothing solid between two people about to touch). */
  private lineClear(a: V2, b: V2): boolean {
    const e = menuWorldOf(this.p.host) as unknown as {clearanceAtV1?: (x: number, z: number) => number}; if (!e.clearanceAtV1) return true;
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
    for (let i = 1; i < n; i++) if (e.clearanceAtV1(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) < 0.24) return false;
    return true;
  }
  /** Where to stand to meet someone face to face: within 1.1 m of them with a clear line between (nearest to `from`),
   *  so a hug or a hand-over never reaches across a fire, a bench or a wall. Null when they are already in reach.
   *  `otherAt`: where the other body is going to stand (a host still walking to its meet spot), instead of where it is. */
  /** A hand-over needs no clear gesture ring (GEST-LIVE 2026-10-22: a give to a Soul on a bench or beside a bystander was
   *  refused gesture.no-room with no way forward): the strict meet spot when there is one, else arm's length on my side. */
  handSteps(me: string, other: string, otherAt?: V2): Steps | null {
    const strict = this.meetSteps(me, other, 1.1, 0.8, otherAt); if (strict) return strict;
    const mb = this.p.body(me), ob = this.p.body(other); if (!mb || !ob) return null;
    const at: V2 = otherAt ?? [ob.pose.p[0], ob.pose.p[2]], L = Math.hypot(mb.pose.p[0] - at[0], mb.pose.p[2] - at[1]) || 1;
    const p: V2 = [r2(at[0] + (mb.pose.p[0] - at[0]) / L * 1.1), r2(at[1] + (mb.pose.p[2] - at[1]) / L * 1.1)];
    return [{verb: 'walk_to', params: {to: p, standoff: 0}}, {verb: 'wave', params: {at: other, seconds: 0.2}}];
  }
  meetSteps(me: string, other: string, standoff = 1.1, gap = 0.8, otherAt?: V2): Steps | null {
    const mb = this.p.body(me), ob = this.p.body(other); if (!mb || !ob) return [{verb: 'walk_to', params: {to: other, standoff}}];
    const from: V2 = [mb.pose.p[0], mb.pose.p[2]], at: V2 = otherAt ?? [ob.pose.p[0], ob.pose.p[2]], d = Math.hypot(at[0] - from[0], at[1] - from[1]);
    const e = menuWorldOf(this.p.host) as unknown as {clearanceAtV1?: (x: number, z: number) => number};
    const people = Object.values(this.w.entities).filter(x => x.kind === 'human' && x.id !== me && x.id !== other).map(x => [x.pose.p[0], x.pose.p[2]] as V2);
    // hotfix: where both will stand for the gesture (`gap` apart, meeting between) and the way there stay clear of bystanders
    const roomFor = (p: V2) => {
      const L = Math.hypot(at[0] - p[0], at[1] - p[1]) || 1, u: V2 = [(at[0] - p[0]) / L, (at[1] - p[1]) / L], m: V2 = [(p[0] + at[0]) / 2, (p[1] + at[1]) / 2];
      const marks: V2[] = [[m[0] - u[0] * gap / 2, m[1] - u[1] * gap / 2], [m[0] + u[0] * gap / 2, m[1] + u[1] * gap / 2]];
      for (let i = 0; i <= 4; i++) marks.push([p[0] + (marks[0][0] - p[0]) * i / 4, p[1] + (marks[0][1] - p[1]) * i / 4], [at[0] + (marks[1][0] - at[0]) * i / 4, at[1] + (marks[1][1] - at[1]) * i / 4]);
      return marks.every(q => people.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) >= 0.62));
    };
    if (d <= standoff + 0.8 && this.lineClear(from, at) && roomFor(from)) return [{verb: 'wave', params: {at: other, seconds: 0.2}}];
    const spots: {p: V2; d: number}[] = [];
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8, p: V2 = [r2(at[0] + Math.cos(ang) * standoff), r2(at[1] + Math.sin(ang) * standoff)];
      if ((e.clearanceAtV1?.(p[0], p[1]) ?? 1) < 0.34 || people.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8) || !this.lineClear(p, at) || !roomFor(p)) continue;
      spots.push({p, d: Math.hypot(p[0] - from[0], p[1] - from[1])});
    }
    spots.sort((a, b) => a.d - b.d || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
    return spots.length ? [{verb: 'walk_to', params: {to: spots[0].p, standoff: 0}}, {verb: 'wave', params: {at: other, seconds: 0.2}}] : null;
  }
  private asleep(entityId: string) {const h = this.p.body(entityId)?.human; return !h || !!h.sleepPose || h.activity === 'nap';}

  // ---------------------------------------------------------------- storage
  invite(id: string): Invite | null {const r = this.p.db.db.prepare('SELECT body FROM edge_invites_v1 WHERE world_id=? AND invite_id=?').get(this.p.host.worldId, id) as {body: string} | undefined; return r ? JSON.parse(r.body) as Invite : null;}
  private pending(): Invite[] {return (this.p.db.db.prepare("SELECT body FROM edge_invites_v1 WHERE world_id=? AND state='pending' ORDER BY created_at").all(this.p.host.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as Invite);}
  /** L3: moves on every invitation, item, item-op or follow write (and again when its in-memory copy updates after the
   *  commit), so a menu cached on it never keeps an answered invitation or a handed-over item. */
  version = 0;
  private bump() {this.version++; try {afterCommit(this.p.db.db, () => this.version++);} catch {/* an untracked outer transaction: the first bump stands */}}
  private saveInvite(i: Invite) {this.bump(); this.p.db.db.prepare('INSERT INTO edge_invites_v1 (world_id,invite_id,state,body,created_at) VALUES (?,?,?,?,?) ON CONFLICT (world_id,invite_id) DO UPDATE SET state=excluded.state, body=excluded.body').run(this.p.host.worldId, i.id, i.state, JSON.stringify(i), Date.now());for(const receipt of [i.hostReceipt,...Object.values(i.guestReceipts)].filter((r):r is string=>!!r))this.p.db.db.prepare('INSERT OR IGNORE INTO edge_invite_receipts_v1(world_id,receipt_id,invite_id) VALUES(?,?,?)').run(this.p.host.worldId,receipt,i.id);}
  inviteForReceipt(receipt:string):Invite|null{const r=this.p.db.db.prepare('SELECT invite_id FROM edge_invite_receipts_v1 WHERE world_id=? AND receipt_id=?').get(this.p.host.worldId,receipt) as {invite_id:string}|undefined;return r?this.invite(r.invite_id):null;}
  /** A paired gesture or a give whose host receipt is open while nobody has answered yet (quality case 32): the host is
   *  only walking over / holding out a hand, so the receipt reads `waiting` and `here` reads `inviting` until a guest
   *  accepts. Cheap for every other receipt: only paired/give capabilities ever look at the invitation table. */
  awaitingAnswer(receiptId: string, capability: string): {invite: string; what: string; waitingFor: {soulId: string; name: string}[]; expiresInSeconds: number} | null {
    const verb = capability.split(':')[0]!;
    if (verb !== 'give' && verb !== 'carry-with' && !Object.hasOwn(PAIRED, verb)) return null;
    const inv = this.pending().find(i => i.hostReceipt === receiptId && (i.kind === 'paired' || i.kind === 'give' || i.kind === 'shared'));
    // PC04: a shared proposal names whoever is still undecided, whether or not others have accepted
    if (!inv || inv.kind !== 'shared' && Object.values(inv.responses).includes('accepted')) return null;
    const open = inv.guests.filter(g => !inv.responses[g.soulId]);
    if (!open.length) return null;
    return {invite: inv.id, what: inv.what, waitingFor: open.map(g => ({soulId: g.soulId, name: this.p.host.minds.get(g.soulId)?.name ?? g.name})), expiresInSeconds: Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))};
  }
  /** Pending invitations addressed to this Soul that it has not answered. */
  invitesFor(soulId: string): Invite[] {return this.pending().filter(i => i.guests.some(g => g.soulId === soulId) && !i.responses[soulId]).map(i=>({...i,host:{...i.host,name:this.p.host.minds.get(i.host.soulId)?.name??i.host.name},guests:i.guests.map(g=>({...g,name:this.p.host.minds.get(g.soulId)?.name??g.name}))}));}
  item(id: string): Item | null {const r = this.p.db.db.prepare('SELECT body FROM edge_items_v1 WHERE world_id=? AND item_id=?').get(this.p.host.worldId, id) as {body: string} | undefined; return r ? JSON.parse(r.body) as Item : null;}
  heldBy(soulId: string): Item | null {const r = this.p.db.db.prepare("SELECT body FROM edge_items_v1 WHERE world_id=? AND holder=? AND state='held' LIMIT 1").get(this.p.host.worldId, soulId) as {body: string} | undefined; return r ? JSON.parse(r.body) as Item : null;}
  placed(): Item[] {return (this.p.db.db.prepare("SELECT body FROM edge_items_v1 WHERE world_id=? AND state='placed' ORDER BY updated_at").all(this.p.host.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as Item);}
  private saveItem(i: Item) {
    this.bump();
    if (i.state === 'gone') {this.p.db.db.prepare('DELETE FROM edge_items_v1 WHERE world_id=? AND item_id=?').run(this.p.host.worldId, i.id); this.p.spectate({kind: 'item', item: this.publicItem(i)}); return;}
    this.p.db.db.prepare('INSERT INTO edge_items_v1 (world_id,item_id,state,holder,place_id,body,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (world_id,item_id) DO UPDATE SET state=excluded.state, holder=excluded.holder, place_id=excluded.place_id, body=excluded.body, updated_at=excluded.updated_at')
      .run(this.p.host.worldId, i.id, i.state, i.holder, i.placeId, JSON.stringify(i), Date.now());
    this.p.spectate({kind: 'item', item: this.publicItem(i)});
  }
  publicItem(i: Item) {return {id: i.id, kind: i.kind, name: i.name, state: i.state, holder: i.holder ? {soulId: i.holder, name: this.mindOf(i.holder)?.name ?? 'someone'} : null, placeId: i.placeId, at: i.at, untrusted: true};}
  private saveOp(receipt: string, op: ItemOp) {this.bump(); this.p.db.db.prepare('INSERT OR REPLACE INTO edge_item_ops_v1 (world_id,receipt_id,body) VALUES (?,?,?)').run(this.p.host.worldId, receipt, JSON.stringify(op));}
  private takeOp(receipt: string): ItemOp | null {
    const r = this.p.db.db.prepare('SELECT body FROM edge_item_ops_v1 WHERE world_id=? AND receipt_id=?').get(this.p.host.worldId, receipt) as {body: string} | undefined;
    if (!r) return null; this.bump(); this.p.db.db.prepare('DELETE FROM edge_item_ops_v1 WHERE world_id=? AND receipt_id=?').run(this.p.host.worldId, receipt); return JSON.parse(r.body) as ItemOp;
  }
  private saveFollow(f: Follow) {this.bump(); this.p.db.db.prepare('INSERT OR REPLACE INTO edge_follows_v1 (world_id,receipt_id,body) VALUES (?,?,?)').run(this.p.host.worldId, f.receipt, JSON.stringify(f));afterCommit(this.p.db.db,()=>this.follows.set(f.receipt,f));}
  private dropFollow(receipt: string) {this.bump(); this.p.db.db.prepare('DELETE FROM edge_follows_v1 WHERE world_id=? AND receipt_id=?').run(this.p.host.worldId, receipt);afterCommit(this.p.db.db,()=>this.follows.delete(receipt));}
  followingOf(soulId: string) {return [...this.follows.values()].find(f => f.soulId === soulId) ?? null;}
  followersOf(soulId: string) {return [...this.follows.values()].filter(f => f.target === soulId);}
  /** A guest with an unanswered invitation is not idle (ambient life leaves it be while its agent decides). */
  awaiting(soulId: string) {return this.invitesFor(soulId).length > 0 || this.sharedFor(soulId).length > 0;}
  /** PC04: pending shared proposals this Soul has accepted (its role is held until commit, expiry or it leaves). */
  sharedFor(soulId: string): Invite[] {return this.pending().filter(i => i.kind === 'shared' && i.responses[soulId] === 'accepted');}

  // ---------------------------------------------------------------- item sources
  private sourceCache: {key: string; list: ItemSource[]} | null = null;
  /** Deterministic item sources: shelves (books), writing desks (letters) and walkable places by kind (gardens → flowers…). */
  sources() {
    const key = this.sourceKey();
    if (this.sourceCache?.key === key) {menuStats.src.hit++; return this.sourceCache.list;}
    menuStats.src.miss++;
    const it = this.sourcesGen(key); for (;;) {const r = it.next(); if (r.done) return r.value;}
  }
  /** Continuity (warm after listen): derive the item sources now (unless current), one place per step, so a sliced caller
   *  (EdgeLedger.warmForServing) builds them between requests instead of inside a Soul's first listing (~0.2 s). */
  *sourcesWarmGen(): Generator<void, void, void> {
    const key = this.sourceKey(); if (this.sourceCache?.key === key) return;
    yield* this.sourcesGen(key, true);
  }
  private sourceKey() {
    const nav = (this.w as {navV1?: {solids?: unknown[]; ground?: unknown[]}}).navV1;
    return (this.p.staticVersion?.() ?? '') + '|' + Object.keys(this.w.regions).length + ':' + this.p.places.version + ':' + (nav?.solids?.length ?? -1) + ':' + (nav?.ground?.length ?? -1);
  }
  /** The derive behind sources() (`sliced`: a step after each place's standing point; the result is the same). A key that
   *  moves between steps (a god edit landed) is not cached: the next read derives again. */
  private *sourcesGen(key: string, sliced = false): Generator<void, ItemSource[], void> {
    let c = cpuNow();
    const out: ItemSource[] = [];
    const nameOf = (id?: string) => (id ? this.p.places.byId.get(id)?.name : undefined) ?? 'the shelf';
    for (const s of this.p.spots().shelves) out.push({id: 'shelf:' + s.id, kind: 'book', label: `a shelf in ${nameOf(s.place)}`, at: s.at, ...(s.faceTo ? {face: s.faceTo} : {}), place: s.place ?? null});
    for (const s of this.p.spots().spots) if (s.activity === 'write' || s.activity === 'post-letter') out.push({id: 'spot:' + s.id, kind: 'letter', label: s.label ?? 'a writing desk', at: s.at, ...(s.faceTo ? {face: s.faceTo} : {}), place: s.place ?? null});
    // a place source's spot ignores people (withPeople false): people are not in the cache key, so a person-avoiding spot
    // depended on who stood on the centroid when the cache was built (main's own answers flipped; main vs read worker ~1 m)
    const engine = menuWorldOf(this.p.host) as unknown as {nearestStandableV1?: (at: V2, except?: string, min?: number, rings?: number, withPeople?: boolean) => V2 | null};
    for (const place of [...this.p.places.byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      // places come from the place registry (a mars-engine world keeps its places there, not in world.regions)
      if (!place.polygon?.length || place.kind === 'water' || place.carrier) continue;
      const text = (place.id + ' ' + place.name).toLowerCase(), kinds = SOURCE_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
      if (!kinds.length) continue;
      if (sliced) {menuStats.src.cpuUs += cpuNow() - c; yield; c = cpuNow();}
      const at = engine.nearestStandableV1?.(centroid(place.polygon), undefined, 0.6, 24, false) ?? null; if (!at) continue;
      for (const kind of [...new Set(kinds)]) out.push({id: 'place:' + place.id, kind, label: place.name, at, place: place.id});
    }
    menuStats.src.cpuUs += cpuNow() - c;
    if (!sliced || this.sourceKey() === key) this.sourceCache = {key, list: out};
    return out;
  }

  /** GEST-LIVE: the other sources of an item kind within reach, nearest first (the nearest one may have no walkable route). */
  pickUpAlternatives(entityId: string, kind: string): {id: string; at: V2; face?: V2}[] {
    const b = this.p.body(entityId); if (!b) return [];
    const here: V2 = [b.pose.p[0], b.pose.p[2]];
    return this.sources().filter(s => s.kind === kind).map(s => ({s, d: Math.hypot(s.at[0] - here[0], s.at[1] - here[1])}))
      .filter(x => x.d <= ITEM_LIMITS.pickReach).sort((a, b) => a.d - b.d).slice(0, 6).map(({s}) => ({id: s.id, at: s.at, ...(s.face ? {face: s.face} : {})}));
  }

  // ---------------------------------------------------------------- capabilities
  /** Gestures, invitations, follows and items for one Soul (added to the ledger's capability list and plans). */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, TogetherPlan>) {
    const me = this.p.body(soul.entityId); if (!me) return;
    const here: V2 = [me.pose.p[0], me.pose.p[2]], add = (c: EdgeCapability, plan: TogetherPlan) => {caps.push(c); plans.set(c.id, plan);};
    const seated = this.seated(soul.entityId), aloft = this.p.aboard(soul.entityId);
    // invitations to me lead (accept / decline)
    for (const inv of [...this.invitesFor(soul.soulId), ...this.sharedFor(soul.soulId)]) {
      if (inv.shared) {this.sharedOffers(soul, inv, add); continue;}
      add({id: 'accept:' + inv.id, verb: 'accept', label: `Accept: ${inv.host.name} ${inv.label} (${Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))} s left)${inv.what === 'rps' ? '; choose your throw in shape' : ''}`, target: {id: inv.host.soulId, kind: 'soul'}, available: true, ...(inv.what === 'rps' ? {params: SHAPE_PARAM} : {})}, {label: 'Accept the invitation', steps: [], together: {kind: 'accept', invite: inv.id}});
      add({id: 'decline:' + inv.id, verb: 'decline', label: `Decline ${inv.host.name}'s invitation (${inv.what})`, target: {id: inv.host.soulId, kind: 'soul'}, available: true}, {label: 'Decline the invitation', steps: [], together: {kind: 'decline', invite: inv.id}});
    }
    // entry 35: my own open offers of a hand or a game can be withdrawn; joined hands can be let go
    for (const inv of this.pending()) if (inv.host.soulId === soul.soulId && (inv.kind === 'shared' || (inv.what === 'rps' || inv.what === 'hold-hands' || inv.what === 'hand-over') && !Object.values(inv.responses).includes('accepted'))) {
      const to = inv.guests.map(g => this.mindOf(g.soulId)?.name ?? g.name).join(', ');
      add({id: 'withdraw:' + inv.id, verb: 'withdraw', label: `Withdraw your offer to ${to} (${this.offerWords(inv)})`, target: {id: inv.guests[0].soulId, kind: 'soul'}, available: true}, {label: 'Withdraw the offer', steps: [], together: {kind: 'withdraw', invite: inv.id}});
    }
    const hands = this.handsWith(soul.entityId);
    if (hands) add({id: 'let-go:here', verb: 'let-go', label: `Let go of ${hands.name}'s hand`, target: {id: hands.soulId, kind: 'soul'}, available: true}, {label: `Let go of ${hands.name}'s hand`, steps: [{verb: 'mars:hand_hold_v1', params: {mode: 'release'}}], together: {kind: 'let-go'}});
    const held = this.heldBy(soul.soulId), mine = this.followingOf(soul.soulId);
    for (const o of this.p.perceived(soul.soulId, INVITE_RADIUS)) {
      if (this.p.faded(o.soulId)) continue;
      const om = this.mindOf(o.soulId); if (!om) continue;
      const busy = this.asleep(o.entityId) ? 'asleep' : this.p.aboard(o.entityId) ? 'riding' : null;
      // SOCIAL-APPROACH: a Soul in sight but out of reach is offered the same acts; the world walks over first, then asks
      this.socialCaps(soul, o, busy, aloft, held, add);
      if (o.distance <= FOLLOW_RADIUS && mine?.target !== o.soulId) add({id: 'follow:' + o.soulId, verb: 'follow', label: `Walk with ${o.name}: follow them wherever they go until you do something else`, target: {id: o.soulId, kind: 'soul'}, available: !busy && !aloft, ...(busy || aloft ? {blocked: {code: 'follow.unavailable', reason: busy ? `${o.name} is ${busy}.` : 'Not while riding.'}} : {}), params: {seconds: {type: 'integer', min: 10, max: 3600, default: 600}}},
        {label: `Walk with ${o.name}`, seconds: true, steps: this.followSteps(soul.entityId, o.entityId), together: {kind: 'follow', target: o.soulId}});
    }
    for (const f of this.followersOf(soul.soulId)) {const n = this.mindOf(f.soulId)?.name ?? 'someone'; add({id: 'ask-to-stop:' + f.soulId, verb: 'ask-to-stop', label: `Ask ${n} to stop following you`, target: {id: f.soulId, kind: 'soul'}, available: true}, {label: `Ask ${n} to stop following`, steps: [], together: {kind: 'unfollow', follower: f.soulId}});}
    // solo gestures right here
    for (const [g, def] of Object.entries(SOLO)) {
      add({id: g + ':here', verb: g, label: def.label, available: !aloft || def.seated, params: g === 'point' ? {at: {type: 'string', optional: true, description: 'a Soul, place or thing (name or id)'}} : {to: {type: 'string', optional: true, description: 'a Soul (name or id) to face'}, ...(g === 'clap' ? {seconds: {type: 'integer', min: 1, max: 30, default: 4}} : {})}},
        {label: def.label.replace(/ \(.*\)$/, ''), seconds: g === 'clap', steps: [...(def.seated ? [] : this.standFirst(soul.entityId)), pose(g, def.seconds)]});
    }
    // items: what is in my hand, or what I can pick up
    if (held) {
      add({id: 'put-down:here', verb: 'put-down', label: `Put ${held.name} down here (it stays for others to pick up)`, available: !aloft, ...(aloft ? {blocked: {code: 'ride.aboard', reason: 'Not while riding.'}} : {})},
        {label: `Put down ${held.name}`, steps: [pose('put-down', 1.5, {prop: held.kind, release: true})], together: {kind: 'item', op: 'put-down', item: held.id}});
      if (held.kind === 'food' || held.kind === 'cup') {
        const verb = held.kind === 'food' ? 'eat' : 'drink';
        add({id: verb + ':held', verb, label: held.kind === 'food' ? `Eat ${held.name} you are holding` : `Drink ${held.name} you are holding`, available: true, params: {seconds: {type: 'integer', min: 5, max: 300, default: 30}}},
          {label: verb === 'eat' ? 'Eat' : 'Drink', seconds: true, steps: [pose(verb, 30, {prop: held.kind === 'food' ? 'food' : 'cup', release: true})], together: {kind: 'item', op: 'consume', item: held.id}});
      }
    } else if (!aloft) {
      const best = new Map<ItemKind, {s: ReturnType<Together['sources']>[number]; d: number}>();
      for (const s of this.sources()) {const d = Math.hypot(s.at[0] - here[0], s.at[1] - here[1]); if (d <= ITEM_LIMITS.pickReach && (!best.has(s.kind) || d < best.get(s.kind)!.d)) best.set(s.kind, {s, d});}
      for (const [kind, {s, d}] of [...best].sort((a, b) => a[1].d - b[1].d)) {
        add({id: 'pick-up:' + kind, verb: 'pick-up', label: `Pick up ${ITEM_NAMES[kind]} (${s.label}, ${Math.round(d)} m)`, target: {id: s.id, kind: 'source'}, available: true},
          {label: `Pick up ${ITEM_NAMES[kind]}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: s.at, standoff: 0}}, pose('pick-up', 1.5, {prop: kind, hold: kind, ...(s.face ? {face: s.face} : {})})], together: {kind: 'item', op: 'pick-up', source: s.id, itemKind: kind}});
      }
      for (const it of this.placed()) {
        if (!it.at || it.claimedBy) continue; const d = Math.hypot(it.at[0] - here[0], it.at[1] - here[1]); if (d > ITEM_LIMITS.nearItems) continue;
        add({id: 'pick-up:' + it.id, verb: 'pick-up', label: `Pick up ${it.name} lying here (${Math.round(d)} m)`, target: {id: it.id, kind: 'item'}, available: true},
          {label: `Pick up ${it.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: it.at, standoff: 0.45}}, pose('pick-up', 1.5, {prop: it.kind, hold: it.kind, face: it.at})], together: {kind: 'item', op: 'pick-up', item: it.id, itemKind: it.kind}});
      }
    }
  }
  /** One follow leg programme: walk up behind them and pause, repeated; the ledger re-issues it while the follow lasts.
   *  Each leg walks to where they were when it began, so a follower at the same pace falls further behind every leg
   *  by its standoff and pause (GEST-LIVE r11: 13 m after 15 s, follow.lost at 45 m on a 240 m walk). So the programme is
   *  three legs, re-issued with the current gap, and a follower more than CATCH_UP metres behind jogs them (humanoids
   *  only; floaters glide at one pace). */
  /** Paired gestures and a hand-over offered toward one Soul. Within GESTURE_RADIUS the plan steps in and asks; farther
   *  off (SOCIAL-APPROACH, ACCEPT2 brief 6) the same id is offered with `approach`: the world walks the Soul over to them
   *  first (follow-style legs that track a moving partner) and asks once it is there, never "not nearby". */
  private socialCaps(soul: EdgeSoul, o: {soulId: string; name: string; entityId: string; distance: number}, busy: string | null, aloft: unknown, held: Item | null | undefined, add: (c: EdgeCapability, plan: TogetherPlan) => void) {
    const far = o.distance > GESTURE_RADIUS, then = far ? ' (walks over to them first, then asks)' : '';
    const mineHands = this.handsWith(soul.entityId);
    for (const g of Object.keys(PAIRED) as Paired[]) {
      const def = PAIRED[g];
      // entry 35: holding hands needs free hands on both sides (an item in the hand, or someone else's hand, comes first)
      const handsBusy = g === 'hold-hands' ? (mineHands ? {code: 'hands.holding', reason: mineHands.soulId === o.soulId ? `You are already holding ${o.name}'s hand.` : `You are holding ${mineHands.name}'s hand; let go first.`} : held ? {code: 'hands.full', reason: `You are holding ${held.name}; put it down first.`} : this.heldBy(o.soulId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : this.handsWith(o.entityId) ? {code: 'gesture.partner-unavailable', reason: `${o.name} is holding someone's hand.`} : null) : null;
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : aloft ? {code: 'ride.aboard', reason: 'Not while riding.'} : handsBusy;
      const steps: Steps = g === 'hold-hands'
        ? [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, {verb: 'mars:hand_hold_v1', params: {mode: 'join', partner: o.entityId, offer: true, waitSeconds: def.lapse + 5}}]
        : [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, pose(def.activity, def.seconds, {gap: def.gap, waitSeconds: 45, alone: 'fail', clear: true})];
      add({id: `${g}:${o.soulId}`, verb: g, label: far ? def.label(o.name).replace(/ \(.*\)$/, '') + then : def.label(o.name), target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {}), ...(g === 'dance-with' ? {params: {seconds: {type: 'integer', min: 5, max: 600, default: 60}}} : g === 'rps' ? {params: SHAPE_PARAM} : {})},
        {label: def.label(o.name).replace(/ \(.*\)$/, ''), seconds: g === 'dance-with', steps, together: {kind: 'paired', what: g, guest: o.soulId, ...(far ? {approach: true} : {})}});
    }
    // entry 41: a held world thing that opted in to hand-to-hand transfer (the lantern, the bowl) is handed over, not dropped
    const thing = held ? null : this.thingIn(soul.entityId);
    if (thing) {
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : aloft ? {code: 'ride.aboard', reason: 'Not while riding.'} : this.handsFull(o.soulId, o.entityId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : null;
      add({id: 'give:' + o.soulId, verb: 'give', label: `Give ${o.name} the ${thing.name} you are holding: ${far ? 'walks over to them first, then ' : ''}hold it out for them to take (they accept or decline)`, target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {})},
        {label: `Give ${o.name} the ${thing.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: HANDOVER_GAP}}, {verb: 'mars:hand_over_v1', params: {mode: 'offer', partner: o.entityId, item: thing.id, waitSeconds: 40}}], together: {kind: 'hand-over', guest: o.soulId, item: thing.id, name: thing.name, ...(far ? {approach: true} : {})}});
    }
    if (held) {
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : this.heldBy(o.soulId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : null;
      add({id: 'give:' + o.soulId, verb: 'give', label: `Give ${o.name} ${held.name} you are holding (${far ? 'walks over to them first; ' : ''}they accept or decline)`, target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {})},
        {label: `Give ${o.name} ${held.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, pose('give', 2.5, {prop: held.kind, gap: 0.8, waitSeconds: 45, alone: 'fail', release: true, clear: true})], together: {kind: 'give', guest: o.soulId, item: held.id, ...(far ? {approach: true} : {})}});
    }
  }
  /** SOCIAL-APPROACH: a Soul named by id or name who is out of sight (indoors, or beyond INVITE_RADIUS) but awake in this
   *  world within APPROACH_RADIUS: the world can walk over to them, and they can be invited from afar. */
  farSoul(soul: EdgeSoul, words: string): NearbyBody | null {
    const w = words.trim().toLowerCase().replace(/^(?:to|with|at|the)\s+/, ''); if (!w || this.p.host.soulNameRefusal(w)) return null;
    const me = this.p.body(soul.entityId); if (!me) return null;
    if (this.farTwins(soul, words)) return null; // SOUL3: two awake Souls answer to this name; never choose one
    for (const m of this.p.host.minds.values()) {
      if (m.soulId === soul.soulId || !(m.soulId === words.trim() || m.name.toLowerCase() === w || (tokens(m.name).length > 0 && tokens(m.name).every(t => tokens(w).includes(t))))) continue;
      const b = this.p.body(m.entityId); if (!b || this.p.faded(m.soulId)) return null;
      const distance = Math.round(Math.hypot(b.pose.p[0] - me.pose.p[0], b.pose.p[2] - me.pose.p[2]));
      return distance <= APPROACH_RADIUS ? {soulId: m.soulId, name: m.name, entityId: m.entityId, distance} as NearbyBody : null;
    }
    return null;
  }
  /** SOUL3: an exact display name (not an id) held by more than one other awake Soul in this world. */
  farTwins(soul: EdgeSoul, words: string): boolean {
    const w = words.trim().toLowerCase().replace(/^(?:to|with|at|the)\s+/, '');
    return [...this.p.host.minds.values()].filter(m => m.soulId !== soul.soulId && m.name.toLowerCase() === w && !this.p.faded(m.soulId)).length > 1;
  }
  /** SOCIAL-APPROACH: the same acts toward a Soul out of sight (inside a building, or beyond INVITE_RADIUS) but awake in
   *  this world, offered on demand when the owner names them ("hug Wren" while Wren is on the far lawn). */
  approachCaps(soul: EdgeSoul, targetSoulId: string, caps: EdgeCapability[], plans: Map<string, TogetherPlan>): boolean {
    const m = this.mindOf(targetSoulId), tb = m ? this.p.body(m.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!m || !tb || !me || m.soulId === soul.soulId || this.p.faded(m.soulId)) return false;
    const distance = Math.round(Math.hypot(tb.pose.p[0] - me.pose.p[0], tb.pose.p[2] - me.pose.p[2])); if (distance > APPROACH_RADIUS) return false;
    const busy = this.asleep(m.entityId) ? 'asleep' : this.p.aboard(m.entityId) ? 'riding' : null;
    const add = (c: EdgeCapability, plan: TogetherPlan) => {if (!caps.some(x => x.id === c.id)) {caps.push(c); plans.set(c.id, plan);}};
    this.socialCaps(soul, {soulId: m.soulId, name: m.name, entityId: m.entityId, distance: Math.max(distance, GESTURE_RADIUS + 1)}, busy, this.p.aboard(soul.entityId), this.heldBy(soul.soulId), add);
    return true;
  }
  /** onProgram hook: an approach leg finished — walk on, or (once within reach) start the act itself under the same receipt. */
  continueApproach(receiptId: string, soul: EdgeSoul): boolean {
    const a = this.approaches.get(receiptId); if (!a) return false;
    const g = this.mindOf(a.tag.guest), gb = g ? this.p.body(g.entityId) : undefined, me = this.p.body(soul.entityId);
    const end = (code: string, reason: string) => {this.approaches.delete(receiptId); this.p.fail(receiptId, code, reason); return false;};
    if (!g || !gb || !me || this.p.faded(a.tag.guest)) return end('gesture.partner-unavailable', 'They are not here any more.');
    if (this.asleep(g.entityId) || this.p.aboard(g.entityId)) return end('gesture.partner-unavailable', `${g.name} is ${this.asleep(g.entityId) ? 'asleep' : 'riding'}.`);
    const d = Math.hypot(gb.pose.p[0] - me.pose.p[0], gb.pose.p[2] - me.pose.p[2]);
    if (d > GESTURE_RADIUS) {
      if (this.tick >= a.untilTick) return end('gesture.too-far', `Walked toward ${g.name} but could not reach them in time (still ${Math.round(d)} m away).`);
      void this.p.decide(soul, receiptId, a.capability, `Walk over to ${g.name}`, this.followSteps(soul.entityId, g.entityId, d).filter(s => s.verb !== 'stand')).catch(() => this.p.fail(receiptId, 'ledger.unavailable', 'The world could not continue the walk.'));
      return true;
    }
    this.approaches.delete(receiptId);
    const tag = {...a.tag, approach: false} as Tag, steps: Steps = [{verb: 'walk_to', params: {to: g.entityId, standoff: 1.1}}, ...a.act];
    const prep = this.prepare(soul, {id: a.capability, verb: a.capability.split(':')[0]!, label: a.label, available: true}, {label: a.label, steps, together: tag}, a.params, steps);
    if ('code' in prep) {this.p.fail(receiptId, prep.code, prep.reason); return false;}
    prep.commit?.(receiptId);
    void this.p.decide(soul, receiptId, a.capability, a.label, prep.steps).catch(() => this.p.fail(receiptId, 'ledger.unavailable', 'The world could not continue.'));
    return true;
  }
  private followSteps(me: string, target: string, gap = 0): Steps {
    const tb = this.p.body(target), engine = menuWorldOf(this.p.host) as unknown as {movementVerb?: (actor: string, x: number, z: number) => string};
    // jogging is dry-ground only: a shore or water leg with a gait would fail the follow
    const dry = !tb || (engine.movementVerb?.(me, tb.pose.p[0], tb.pose.p[2]) ?? 'walk_to') === 'walk_to';
    const legs: Steps = [], jog = gap > CATCH_UP && dry && this.p.body(me)?.body?.family !== 'floater';
    for (let i = 0; i < 3; i++) legs.push({verb: 'walk_to', params: {to: target, standoff: 1.5, ...(jog ? {gait: 'jog'} : {})}}, {verb: 'rest', params: {seconds: 0.5}});
    return [...this.standFirst(me), ...legs];
  }

  // ---------------------------------------------------------------- acting
  /** Resolve souls named in params.with (ids or names), live and within reach. */
  private withSouls(soul: EdgeSoul, raw: unknown): {ok: true; souls: {soulId: string; name: string; entityId: string}[]} | {ok: false; code: string; reason: string} {
    const list = typeof raw === 'string' ? raw.split(',') : raw;
    if (!Array.isArray(list) || !list.length || list.length > 6 || !list.every(x => typeof x === 'string' && x.trim() && x.length <= 100)) return {ok: false, code: 'capability.params', reason: 'with must be up to 6 Soul ids or names.'};
    const near = this.p.perceived(soul.soulId, INVITE_RADIUS), out: {soulId: string; name: string; entityId: string}[] = [];
    for (const want of list as string[]) {
      const stale=this.p.host.soulNameRefusal(want);if(stale)return {ok:false,code:stale,reason:'That previous Soul name is unavailable or ambiguous; use the current name and immutable Soul ID.'};
      const w = want.trim().toLowerCase(), hit = near.find(o => o.soulId === want.trim()) ?? near.find(o => o.name.toLowerCase() === w) ?? near.find(o => tokens(o.name).includes(w)) ?? this.farSoul(soul, want);
      if (!hit) return {ok: false, code: 'invite.not-near', reason: `${want} is not in this world close enough to invite (within ${APPROACH_RADIUS} m).`};
      if (this.p.faded(hit.soulId)) return {ok: false, code: 'invite.absent', reason: `${hit.name} is away.`};
      if (!out.some(x => x.soulId === hit.soulId)) out.push({soulId: hit.soulId, name: hit.name, entityId: hit.entityId});
    }
    return {ok: true, souls: out};
  }

  /** Before an act is accepted: validate what it adds, adjust its steps, and say what to record once its receipt exists.
   *  No side effects here (a refusal later in act leaves nothing behind). */
  prepare(soul: EdgeSoul, cap: EdgeCapability, plan: TogetherPlan, params: Record<string, unknown>, steps: Steps): {code: string; reason: string; did_you_mean?: {id: string; label: string}[]} | Prepared {
    const tag = plan.together;
    if (tag?.kind === 'shared') return this.prepareShared(soul, cap, tag, params);
    // entry 41: a hand-over of a held world thing: walk to stand facing them, hold it out, wait for their answer
    if (tag?.kind === 'hand-over') return this.prepareHandOver(soul, cap, plan, params, steps, tag);
    // an earlier invitation of mine that this act replaces is withdrawn when its receipt ends (onReceipt)
    if (tag?.kind === 'paired' || tag?.kind === 'give') {
      const g = this.mindOf(tag.guest), gb = g ? this.p.body(g.entityId) : undefined, me = this.p.body(soul.entityId);
      if (!g || !gb || !me || this.p.faded(tag.guest)) return {code: 'gesture.partner-unavailable', reason: 'They are not here any more.'};
      if(isRigidBody(me)||isRigidBody(gb))return {code:'body.unsupported',reason:'Paired limb gestures and hand transfers require humanoid bodies; try looking or talking instead.'};
      // SOCIAL-APPROACH: out of reach, walk over first (legs that track them); the act and its invitation start on arrival
      const apart = Math.hypot(gb.pose.p[0] - me.pose.p[0], gb.pose.p[2] - me.pose.p[2]);
      if (tag.approach && apart > GESTURE_RADIUS) {
        if (tag.kind === 'give' && this.heldBy(tag.guest)) return {code: 'hands.full', reason: `${g.name}'s hands are full.`};
        if (tag.kind === 'give' && this.heldBy(soul.soulId)?.id !== tag.item) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
        const act = steps.filter(s => s.verb !== 'stand' && !(s.verb === 'walk_to' && s.params.to === g.entityId)), label = plan.label;
        return {steps: this.followSteps(soul.entityId, g.entityId, apart), label: `Walk over to ${g.name} (${label.toLowerCase()} on arrival)`, commit: receipt => {
          this.approaches.set(receipt, {tag, capability: cap.id, label, act, params, untilTick: this.tick + APPROACH_SECONDS * 20});
          this.p.deliver(soul.soulId, 'world', {text: `${g.name} is ${Math.round(apart)} m away; walking over to them first.`});
        }};
      }
      if (Math.hypot(gb.pose.p[0] - me.pose.p[0], gb.pose.p[2] - me.pose.p[2]) > GESTURE_RADIUS + 2) return {code: 'gesture.too-far', reason: `${g.name} is too far away; go near them first.`};
      if (tag.kind === 'give' && this.heldBy(tag.guest)) return {code: 'hands.full', reason: `${g.name}'s hands are full.`};
      const held = tag.kind === 'give' ? this.heldBy(soul.soulId) : null;
      if (tag.kind === 'give' && (!held || held.id !== tag.item)) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
      const id = 'inv_' + randomUUID().slice(0, 12), def = tag.kind === 'paired' ? PAIRED[tag.what] : null;
      const seconds = tag.kind === 'paired' && tag.what === 'dance-with' && Number.isInteger(params.seconds) ? params.seconds as number : def?.seconds ?? 2.5;
      // entry 35: a game needs my throw now (kept by the world); a hand needs both hands free
      const shape = tag.kind === 'paired' && tag.what === 'rps' ? params.shape : undefined;
      if (tag.kind === 'paired' && tag.what === 'rps' && !isRpsShape(shape)) return SHAPE_REFUSAL;
      const holding = tag.kind === 'paired' && tag.what === 'hold-hands';
      if (holding && this.handsWith(soul.entityId)) return {code: 'hands.holding', reason: `You are holding ${this.handsWith(soul.entityId)!.name}'s hand; let go first.`};
      if (holding && this.heldBy(soul.soulId)) return {code: 'hands.full', reason: `You are holding ${this.heldBy(soul.soulId)!.name}; put it down first.`};
      // walk to a spot facing them with nothing between (never across a fire or a bench); a hand: a spot beside them
      const beside = holding ? this.besideSteps(soul.entityId, g.entityId) : null;
      if (holding && !beside) return {code: 'gesture.no-room', reason: `There is no clear spot beside ${g.name} right now; try again somewhere roomier.`, did_you_mean: [{id: 'go-near:' + g.soulId, label: `Go near ${g.name}`}]};
      const meet = beside ? beside.steps : tag.kind === 'give' ? this.handSteps(soul.entityId, g.entityId) : this.meetSteps(soul.entityId, g.entityId, 1.1, def?.gap ?? 0.8);
      if (!meet) return {code: 'gesture.no-room', reason: `There is no clear spot beside ${g.name} right now (someone else is standing too close); try again in a moment or somewhere roomier.`, did_you_mean: [{id: 'go-near:' + g.soulId, label: `Go near ${g.name}`}]};
      const out = structuredClone(steps).flatMap(s => s.verb === 'walk_to' && s.params.to === g.entityId ? meet : [s]);
      const meetAt: V2 = meet[0]?.verb === 'walk_to' ? meet[0].params.to as V2 : [r2(me.pose.p[0]), r2(me.pose.p[2])];
      for (const s of out) if (s.verb === 'mars:pose_v1') {s.params.group = id; s.params.seconds = seconds;if(tag.kind==='paired')s.params.pairedPolicy='ready-v1';if(shape)s.params.throw=shape;}
      for (const s of out) if (s.verb === 'mars:hand_hold_v1') {s.params.group = id; s.params.hand = beside!.hand;}
      return {steps: out, commit: receipt => {
        const inv: Invite = {id, what: tag.kind === 'paired' ? tag.what : 'give', kind: tag.kind, host: {soulId: soul.soulId, name: soul.name}, guests: [{soulId: g.soulId, name: g.name}], capability: cap.id,
          ...(tag.kind==='paired'?{pairedPolicy:'ready-v1' as const}:{}), meetAt, label: tag.kind === 'paired' ? `offers you ${def!.ask}` : `wants to give you ${held!.name}`, activity: def?.activity ?? 'take', seconds, gap: def?.gap ?? 0.8, ...(held ? {item: {id: held.id, kind: held.kind, name: held.name}, prop: held.kind} : {}),
          createdTick: this.tick, expiresTick: this.tick + (def?.lapse ?? 30) * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {},
          ...(isRpsShape(shape) ? {rps: {host: shape}} : {}), ...(beside ? {hand: beside.hand} : {})};
        this.saveInvite(inv); this.announce(inv);
        if (held) this.saveOp(receipt, {soulId: soul.soulId, op: 'give', item: held.id, to: g.soulId, invite: id});
      }};
    }
    if (tag?.kind === 'follow') {
      const t = this.mindOf(tag.target); if (!t || this.p.faded(tag.target)) return {code: 'follow.unavailable', reason: 'They are not here any more.'};
      const seconds = Number.isInteger(params.seconds) ? Math.min(3600, Math.max(10, params.seconds as number)) : 600;
      return {steps, commit: receipt => {
        this.saveFollow({receipt, soulId: soul.soulId, target: tag.target, untilTick: this.tick + seconds * 20});
        this.p.deliver(tag.target, 'follow', {from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} is walking with you. (To ask them to stop: ask-to-stop:${soul.soulId})`, untrusted: true});
      }};
    }
    if (tag?.kind === 'unfollow') {
      const f = this.followingOf(tag.follower); if (!f || f.target !== soul.soulId) return {code: 'follow.none', reason: 'They are not following you.'};
      return {steps: [], noBody: true, commit: () => {this.endFollow(f, 'failed', 'follow.asked-to-stop', `${soul.name} asked you to stop following.`);}};
    }
    if (tag?.kind === 'withdraw') {
      const inv = this.invite(tag.invite); if (!inv || inv.state !== 'pending' || inv.host.soulId !== soul.soulId || inv.kind !== 'shared' && Object.values(inv.responses).includes('accepted')) return {code: 'invite.gone', reason: 'That offer is no longer open.'};
      return {steps: [], noBody: true, commit: () => {
        for (const g of inv.guests) if (!inv.responses[g.soulId]) {inv.responses[g.soulId] = 'cancelled'; this.p.deliver(g.soulId, 'invite.withdrawn', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${soul.name} withdrew the offer (${this.offerWords(inv, true)}).`, untrusted: true});}
        inv.state = 'closed'; this.saveInvite(inv);
        // PC04: members who had accepted a shared proposal are told by their own receipt (closed first, so it stays closed)
        this.failShared(inv, 'invite.withdrawn', `${soul.name} withdrew the proposal; nothing was lifted.`);
        this.hostAlone(inv, 'invite.withdrawn', 'You withdrew your offer.');
      }};
    }
    if (tag?.kind === 'let-go') {
      const w = this.handsWith(soul.entityId); if (!w) return {code: 'hands.not-holding', reason: 'You are not holding anyone\'s hand.'};
      return {steps, commit: () => this.p.deliver(w.soulId, 'hands.released', {from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} let go of your hand.`, untrusted: true})};
    }
    if (tag?.kind === 'decline') {
      const inv = this.invite(tag.invite);
      // PC04 (PC02 §1): leaving before commit is free; the role is freed when the receipt ends (onReceipt)
      if (inv?.kind === 'shared' && inv.state === 'pending' && inv.responses[soul.soulId] === 'accepted') {
        const r = inv.guestReceipts[soul.soulId];
        return {steps: [], noBody: true, commit: () => {if (r) this.p.fail(r, 'shared.left', 'You left the shared carry before it started; nothing was lifted.');}};
      }
      if (!inv || inv.state !== 'pending' || inv.responses[soul.soulId]) return {code: 'invite.gone', reason: 'That invitation is no longer open.'};
      return {steps: [], noBody: true, commit: () => this.respond(inv.id, soul, 'declined')};
    }
    if (tag?.kind === 'item') {
      const held = this.heldBy(soul.soulId);
      if (tag.op === 'pick-up') {
        if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down or give it away first.`};
        if (tag.item) {const it = this.item(tag.item); if (!it || it.state !== 'placed' || it.claimedBy) return {code: 'item.gone', reason: 'Someone has already taken it.'};}
        return {steps, commit: receipt => {
          if (tag.item) {const it = this.item(tag.item)!; it.claimedBy = soul.soulId; this.saveItem(it);}
          this.saveOp(receipt, {soulId: soul.soulId, op: 'pick-up', ...(tag.item ? {item: tag.item} : {}), kind: tag.itemKind as ItemKind, ...(tag.source ? {source: tag.source} : {})});
        }};
      }
      if (!held || held.id !== tag.item) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
      if (tag.op === 'put-down') {
        const place = this.dropPlace(soul.soulId), placed = this.placed();
        if (placed.filter(i => i.placeId === place).length >= ITEM_LIMITS.perPlace) return {code: 'place.items-full', reason: `${ITEM_LIMITS.perPlace} things are already lying here; put it down somewhere else or give it to someone.`};
        return {steps, commit: receipt => this.saveOp(receipt, {soulId: soul.soulId, op: 'put-down', item: held.id})};
      }
      const out = structuredClone(steps); if (Number.isInteger(params.seconds)) for (const s of out) if (s.verb === 'mars:pose_v1') s.params.seconds = params.seconds;
      return {steps: out, commit: receipt => this.saveOp(receipt, {soulId: soul.soulId, op: 'consume', item: held.id})};
    }
    // invitations to an activity: params.with
    if (params.with !== undefined) {
      if (!INVITABLE.has(cap.verb) || (cap.verb === 'object' && cap.action !== 'join')) return {code: 'capability.params', reason: `with (inviting others) works with activities, walks and rides, not ${cap.verb}.`};
      const w = this.withSouls(soul, params.with); if (!w.ok) return {code: w.code, reason: w.reason};
      const id = 'inv_' + randomUUID().slice(0, 12), out = structuredClone(steps), last = invitedPose(out);
      // Keep the activity's destination when the host has not arrived yet. Planning a guest against the
      // host's departure pose otherwise starts two "shared" activities in different buildings.
      const lastMove = last ? out.slice(0, out.indexOf(last)).reverse().find(s => s.verb === 'walk_to' || s.verb === 'mars:walk_to') : undefined;
      // Level-aware routes keep their existing spot plan; never mistake an earlier ground leg for their destination.
      const destination = lastMove?.verb === 'walk_to' ? lastMove.params.to : undefined;
      const meetAt: V2 | undefined = Array.isArray(destination) && destination.length === 2 && destination.every(Number.isFinite) ? [destination[0], destination[1]] : undefined;
      // CN5: a game keeps its court's group (the guest takes a free place at the same court)
      if (last && !last.params.game) {last.params.group = id; last.params.waitSeconds = 20; last.params.alone = 'start'; last.params.need = 1; last.params.windowPolicy = 'once-v1';}  // E2 #2: one shared window
      const ride = cap.verb === 'object' ? out.find(s => s.verb === 'mars:carrier_ride') : undefined;
      if (ride) {ride.params.holdSeats = w.souls.length; ride.params.holdSeconds = 90;}
      const what = ride ? 'ride' : cap.verb, label = ride ? `invites you on ${cap.label.replace(/^.*\(/, '').replace(/\)$/, '') || 'the ride'}` : `invites you to join: ${cap.label}`;
      return {steps: out, commit: receipt => {
        const inv: Invite = {id, what, kind: ride ? 'ride' : 'activity', host: {soulId: soul.soulId, name: soul.name}, guests: w.souls.map(s => ({soulId: s.soulId, name: s.name})), capability: cap.id, label,
          ...(meetAt ? {meetAt} : {}), ...(last?.params.windowPolicy ? {windowPolicy: 'once-v1' as const} : {}), ...(last ? {activity: String(last.params.activity), seconds: Number(last.params.seconds), ...(last.params.prop ? {prop: String(last.params.prop)} : {}), ...(last.params.base ? {base: String(last.params.base)} : {})} : {}),
          ...(ride && cap.object ? {ride: {object: cap.object, carrier: String(ride.params.carrier)}} : {}), place: cap.target?.kind === 'place' ? cap.target.id : null,
          createdTick: this.tick, expiresTick: this.tick + (ride ? 90 : 90) * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {}};
        this.saveInvite(inv); this.announce(inv);
      }};
    }
    return {steps};
  }
  private announce(inv: Invite) {
    const secs = Math.round((inv.expiresTick - this.tick) / 20);
    for (const g of inv.guests) this.p.deliver(g.soulId, 'invite', {invite: {id: inv.id, what: inv.what, from: inv.host, label: `${inv.host.name} ${inv.label}`, expiresInSeconds: secs, accept: 'accept:' + inv.id, decline: 'decline:' + inv.id, ...(inv.shared ? {revision: inv.shared.revision, acceptParams: {revision: inv.shared.revision}} : {})}, untrusted: true});
    this.p.spectate({kind: 'invite', invite: {id: inv.id, what: inv.what, from: inv.host, to: inv.guests, state: 'pending'}, untrusted: true});
  }
  private respond(id: string, soul: EdgeSoul, answer: 'accepted' | 'declined', guestReceipt?: string) {
    const inv = this.invite(id); if (!inv || inv.state !== 'pending') return;
    inv.responses[soul.soulId] = answer; if (guestReceipt) inv.guestReceipts[soul.soulId] = guestReceipt;
    if (inv.shared && answer === 'accepted') {const free = inv.shared.roles.find(x => !x.soulId); if (free) free.soulId = soul.soulId;}
    this.p.deliver(inv.host.soulId, 'invite.' + answer, {invite: {id: inv.id, what: inv.what}, from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} ${answer === 'accepted' ? 'accepted' : 'declined'} (${inv.what}).`, untrusted: true});
    this.p.spectate({kind: 'invite', invite: {id: inv.id, what: inv.what, from: inv.host, to: inv.guests, state: answer, by: {soulId: soul.soulId, name: soul.name}}, untrusted: true});
    const open = inv.guests.filter(g => !inv.responses[g.soulId]);
    if (inv.kind !== 'shared' && (!open.length || answer === 'accepted' && (inv.kind === 'paired' || inv.kind === 'give'))) inv.state = 'closed';
    this.saveInvite(inv);
    if (inv.kind === 'shared' && answer === 'declined') this.sharedViable(inv, 'invite.declined', `${soul.name} declined.`);
    // nobody will come: a paired gesture or a gift ends for the host (an activity simply goes on alone)
    if (inv.state === 'closed' && !Object.values(inv.responses).includes('accepted') && (inv.kind === 'paired' || inv.kind === 'give')) this.hostAlone(inv, answer === 'declined' ? 'invite.declined' : 'invite.expired', `${soul.name} declined.`);
  }
  private hostAlone(inv: Invite, code: string, reason: string) {
    const r = inv.hostReceipt, m = this.mindOf(inv.host.soulId); if (!r || !m) return;
    const rec = this.p.receipt(inv.host.soulId, r); if (!rec || (rec.phase !== 'started' && rec.phase !== 'waiting')) return;
    const running = this.p.running(inv.host.soulId, r);
    this.p.fail(r, code, reason);
    if (running) this.p.stop(inv.host.soulId, m.entityId, r);
  }

  // ---------------------------------------------------------------- PC04 (#683): shared physical operations
  /** What an offer is, in the words of a withdraw label (`withdrew` for the guest's notice). */
  private offerWords(inv: Invite, withdrew = false): string {
    if (inv.shared) return `carrying ${inv.shared.load.name} to ${inv.shared.destination.name} together`;
    return inv.what === 'rps' ? 'rock-paper-scissors' : inv.what === 'hand-over' ? `the ${inv.thing?.name ?? 'thing'}` : withdrew ? 'a hand to hold' : 'your hand';
  }
  /** PC02 §4: a shared carry needs a humanoid body with two free hands, standing on its own feet. */
  private sharedBodyProblem(soul: EdgeSoul): {code: string; reason: string} | null {
    const me = this.p.body(soul.entityId);
    if (!me?.human || isRigidBody(me)) return {code: 'body.unsupported', reason: 'Carrying something together needs a humanoid body with two free hands; try talking or looking instead.'};
    const held = this.heldBy(soul.soulId); if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down first.`};
    const thing = Object.values(this.w.entities).find(x => x.support?.kind === 'in-hand' && x.support.by === soul.entityId);
    if (me.human.grip) return {code: 'carry.hands-full', reason: 'Your hands are on a load already; set it down first.'};
    if (thing) return {code: 'hands.full', reason: `Your hands are full (${this.thingName?.(thing.id) ?? String(thing.label ?? thing.id)}); put it down first.`};
    const hands = this.handsWith(soul.entityId); if (hands) return {code: 'hands.holding', reason: `You are holding ${hands.name}'s hand; let go first.`};
    if (this.p.aboard(soul.entityId)) return {code: 'ride.aboard', reason: 'Not while riding.'};
    return null;
  }
  /** PC02 §1 propose / amend: `carry-with:<load> {to, with}` asks Souls to carry it together (revision 1, a `waiting`
   *  receipt, no body steps); with `invite` from its host it amends that proposal, bumping its revision when anything
   *  material changed. Nothing moves and nothing is claimed here. `params.toPlace` is the ledger's resolved `to`. */
  private prepareShared(soul: EdgeSoul, cap: EdgeCapability, tag: Extract<Tag, {kind: 'shared'}>, params: Record<string, unknown>): {code: string; reason: string} | Prepared {
    if (!this.p.sharedCarry) return {code: 'capability.unknown', reason: 'Carrying things together is not available in this world yet.'};
    const body = this.sharedBodyProblem(soul); if (body) return body;
    const to = params.toPlace as {id: string; name: string} | undefined;
    if (!to) return {code: 'capability.params', reason: 'Choose a named place to carry it to (to).'};
    if (params.with === undefined) return {code: 'capability.params', reason: `Name who carries ${tag.name} with you (with: Soul names or ids).`};
    const w = this.withSouls(soul, params.with); if (!w.ok) return {code: w.code, reason: w.reason};
    const guests = w.souls.filter(g => g.soulId !== soul.soulId).map(g => ({soulId: g.soulId, name: g.name}));
    const crew = 1 + guests.length, [lo, hi] = tag.crew, names = guests.map(g => g.name).join(', ');
    if (!guests.length || crew < lo) return {code: 'carry.crew-too-small', reason: `${tag.name} needs at least ${lo} carriers; ask ${Math.max(1, lo - 1)} Soul${lo - 1 > 1 ? 's' : ''} to carry it with you.`};
    if (crew > hi) return {code: 'carry.crew-too-large', reason: `${tag.name} takes at most ${hi} carriers; ask fewer Souls.`};
    const label = `Ask ${names} to carry ${tag.name} to ${to.name} together`;
    if (params.invite !== undefined) {
      const inv = typeof params.invite === 'string' ? this.invite(params.invite) : null;
      if (!inv?.shared || inv.state !== 'pending' || inv.host.soulId !== soul.soulId) return {code: 'invite.gone', reason: 'That proposal is no longer open.'};
      const s = inv.shared, changes: string[] = [];
      if (s.load.entity !== tag.load) changes.push(`the load is now ${tag.name}`);
      if (s.destination.place !== to.id) changes.push(`the destination is now ${to.name}`);
      if (inv.guests.map(g => g.soulId).sort().join() !== guests.map(g => g.soulId).sort().join()) changes.push(`the crew is now ${soul.name} with ${names}`);
      // the same proposal again changes nothing: its host's receipt answers
      if (!changes.length) return {steps: [], existing: inv.hostReceipt ?? undefined};
      // the amend answers with the host's one shared receipt, never a new "carry-with completed" one (PC02 §2)
      return {steps: [], existing: inv.hostReceipt ?? undefined, label, commit: () => this.amendShared(inv.id, soul, cap.id, tag, to, guests, changes)};
    }
    const id = 'inv_' + randomUUID().slice(0, 12);
    return {steps: [], wait: true, label, detail: {sharedV1: {invite: id, revision: 1}}, commit: receipt => {
      const inv: Invite = {id, what: 'carry', kind: 'shared', host: {soulId: soul.soulId, name: soul.name}, guests, capability: cap.id, label: `asks you to carry ${tag.name} to ${to.name} together`,
        createdTick: this.tick, expiresTick: this.tick + SHARED_LAPSE * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {},
        shared: {template: {id: 'carry', version: 1}, revision: 1, load: {entity: tag.load, def: tag.def, name: tag.name}, destination: {place: to.id, name: to.name},
          roles: [{role: 'carrier', slot: 0, soulId: soul.soulId}, ...guests.map((_, i) => ({role: 'carrier' as const, slot: i + 1, soulId: null}))], crew: tag.crew, cleanup: 'set-down-here', op: null}};
      this.saveInvite(inv); this.announce(inv);
    }};
  }
  /** PC02 §1 amend: a new revision clears every acceptance; whoever had accepted is told by their own receipt. */
  private amendShared(id: string, soul: EdgeSoul, capability: string, tag: Extract<Tag, {kind: 'shared'}>, to: {id: string; name: string}, guests: {soulId: string; name: string}[], changes: string[]) {
    const inv = this.invite(id); if (!inv?.shared || inv.state !== 'pending') return;
    const s = inv.shared, accepted = Object.entries(inv.guestReceipts).filter(([g]) => inv.responses[g] === 'accepted');
    const dropped = inv.guests.filter(g => !guests.some(x => x.soulId === g.soulId));
    s.revision++; s.changed = changes.join('; '); s.load = {entity: tag.load, def: tag.def, name: tag.name}; s.destination = {place: to.id, name: to.name}; s.crew = tag.crew;
    s.roles = [{role: 'carrier', slot: 0, soulId: soul.soulId}, ...guests.map((_, i) => ({role: 'carrier' as const, slot: i + 1, soulId: null}))];
    Object.assign(inv, {guests, responses: {}, guestReceipts: {}, capability, label: `asks you to carry ${tag.name} to ${to.name} together`, expiresTick: this.tick + SHARED_LAPSE * 20});
    this.saveInvite(inv);
    for (const [, r] of accepted) this.p.fail(r, 'shared.revision-changed', `${inv.host.name} changed the proposal to revision ${s.revision} (${s.changed}); accept the new revision if you still agree.`);
    for (const g of dropped) this.p.deliver(g.soulId, 'invite.closed', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s proposal changed and no longer includes you.`, untrusted: true});
    this.announce(inv);
  }
  /** PC02 §1 accept: each guest accepts their own role against the current revision. Accepting moves nobody: it opens
   *  the guest's own `waiting` receipt (commit is PC05); a repeat of the same revision answers with that receipt. */
  private acceptShared(soul: EdgeSoul, inv: Invite, params: Record<string, unknown>): {code: string; reason: string} | {label: string; steps: Steps; capability: string; commit: (receipt: string) => void; wait?: boolean; existing?: string; detail?: Record<string, unknown>} {
    const s = inv.shared, gone = {code: 'invite.gone', reason: 'That proposal is no longer open.'};
    if (!this.p.sharedCarry || !s || inv.state !== 'pending' || !inv.guests.some(g => g.soulId === soul.soulId)) return gone;
    const answer = inv.responses[soul.soulId], capability = 'accept:' + inv.id;
    if (answer === 'accepted') {const mine = inv.guestReceipts[soul.soulId]; if (!mine) return gone; if (params.revision === undefined || params.revision === s.revision) return {label: 'Accepted', steps: [], capability, existing: mine, commit: () => {}};}
    else if (answer) return {code: 'invite.gone', reason: 'You already answered that proposal.'};
    if (!Number.isInteger(params.revision)) return {code: 'capability.params', reason: `Say which revision you agree to: {"revision": ${s.revision}}.`};
    if (params.revision !== s.revision) return {code: 'shared.revision-changed', reason: `The proposal changed: it is now revision ${s.revision}${s.changed ? ` (${s.changed})` : ''}. Accept {"revision": ${s.revision}} if you still agree.`};
    const body = this.sharedBodyProblem(soul); if (body) return body;
    if (!this.mindOf(inv.host.soulId) || this.p.faded(inv.host.soulId)) return {code: 'invite.gone', reason: `${inv.host.name} is not here any more.`};
    if (!s.roles.some(r => !r.soulId)) return {code: 'shared.full', reason: 'Every role in that carry is taken.'};
    return {label: `Carry ${s.load.name} to ${s.destination.name} with ${inv.host.name}`, steps: [], capability, wait: true, detail: {sharedV1: {invite: inv.id, revision: s.revision}},
      commit: receipt => this.respond(inv.id, soul, 'accepted', receipt)};
  }
  /** Accept / decline (or leave) offers of a shared proposal to one of its guests; no distant clutter (only its guests). */
  private sharedOffers(soul: EdgeSoul, inv: Invite, add: (c: EdgeCapability, plan: TogetherPlan) => void) {
    const s = inv.shared!, secs = Math.max(0, Math.round((inv.expiresTick - this.tick) / 20)), mine = inv.responses[soul.soulId] === 'accepted';
    const what = `carry ${s.load.name} to ${s.destination.name} with ${inv.host.name}`, target = {id: inv.host.soulId, kind: 'soul'};
    add({id: 'accept:' + inv.id, verb: 'accept', label: mine ? `You accepted: ${what} (revision ${s.revision}); accepting again changes nothing` : `Accept: ${inv.host.name} asks you to ${what} (revision ${s.revision}, ${secs} s left; accepting moves nobody yet)`,
      target, available: true, params: {revision: {type: 'integer', min: 1, description: `the proposal revision you agree to (now ${s.revision})`}}}, {label: 'Accept the shared carry', steps: [], together: {kind: 'accept', invite: inv.id}});
    add({id: 'decline:' + inv.id, verb: 'decline', label: mine ? `Leave: ${what} (before it starts)` : `Decline ${inv.host.name}'s proposal to ${what}`, target, available: true}, {label: mine ? 'Leave the shared carry' : 'Decline the proposal', steps: [], together: {kind: 'decline', invite: inv.id}});
  }
  /** End the open receipts of every guest who had accepted (the invitation is closed or superseded first). */
  private failShared(inv: Invite, code: string, reason: string) {
    if (inv.kind !== 'shared') return;
    for (const [g, r] of Object.entries(inv.guestReceipts)) if (inv.responses[g] === 'accepted') this.p.fail(r, code, reason);
  }
  /** A proposal that can no longer reach its crew minimum closes: its host's receipt ends with why (not at the lapse). */
  private sharedViable(inv: Invite, code: string, reason: string) {
    const can = inv.guests.filter(g => !inv.responses[g.soulId] || inv.responses[g.soulId] === 'accepted').length;
    if (inv.state !== 'pending' || !inv.shared || can > 0 && 1 + can >= inv.shared.crew[0]) return;
    inv.state = 'closed'; this.saveInvite(inv); this.hostAlone(inv, code, reason);
  }
  /** PC04: a shared receipt as its own Soul sees it (PC02 §5): live role and phase while it is the member's current one. */
  sharedReceipt(receiptId: string, soulId: string, made: {invite: string; revision: number}): SharedReceiptV1 {
    const inv = this.invite(made.invite), s = inv?.shared;
    const host = !!s && inv!.hostReceipt === receiptId, current = host || !!s && s.revision === made.revision && inv!.guestReceipts[soulId] === receiptId && inv!.responses[soulId] === 'accepted';
    return {invite: made.invite, revision: host ? s!.revision : made.revision, role: 'carrier', slot: current ? s!.roles.find(r => r.soulId === soulId)?.slot ?? null : null, phase: current && inv!.state === 'pending' ? 'pending' : 'ended'};
  }
  /** PC02 §1: an open shared receipt that a newer body act of its Soul ends is `failed` / `shared.left`, never `replaced`. */
  sharedLeave(r: EdgeReceipt): {code: string; reason: string} | null {
    if (!r.capability.startsWith('carry-with:') && !r.capability.startsWith('accept:')) return null;
    const inv = this.inviteForReceipt(r.id); if (inv?.kind !== 'shared' || inv.state !== 'pending') return null;
    if (inv.hostReceipt === r.id) return {code: 'shared.left', reason: 'You did something else, so the shared carry you proposed is off; nothing was lifted.'};
    return inv.guestReceipts[r.soulId] === r.id ? {code: 'shared.left', reason: 'You did something else, so you left the shared carry before it started; nothing was lifted.'} : null;
  }

  /** BROWSE-COURTESY: a guest joining a place-bound activity (read in the library) takes its own free spot of that activity
   *  beside the host's destination: same innermost room, 0.5-4 m away (never the host's own spot), when that is nearer
   *  than the spot its place plan would pick (its own nearest, possibly across the room). The guest's native plan, unchanged.
   *  Scope: ground level only (host and guest on level 0, candidate plans of plain level-less walk_to only, which keep the
   *  body's level 0); a level-aware plan, an upper floor or an unknown room fails closed (undefined: the place plan as before). */
  private spotBeside(at: V2, hostLevel: number, guestLevel: number, verb: string, hostCap: string, ownCaps: EdgeCapability[], ownPlans: Map<string, TogetherPlan>): TogetherPlan | undefined {
    if (hostLevel !== 0 || guestLevel !== 0) return undefined;
    const ground = (plan: TogetherPlan | undefined) => !!plan && plan.steps.every(s => s.verb !== 'mars:walk_to' && !(s.verb === 'walk_to' && s.params.level !== undefined));
    const dest = (plan: TogetherPlan | undefined) => {if (!ground(plan)) return undefined; const st = plan!.steps, last = invitedPose(st), mv = last ? st.slice(0, st.indexOf(last)).reverse().find(s => s.verb === 'walk_to') : undefined, to = mv?.params.to;
      return Array.isArray(to) && to.length === 2 && to.every(Number.isFinite) ? to as V2 : undefined;};
    const gap = (q: V2 | undefined) => q ? Math.hypot(q[0] - at[0], q[1] - at[1]) : Infinity, room = (q: V2): string | undefined => {const r = this.p.places.containing(q[0], q[1], 0)[0]; return r && r.parent !== null ? r.id : undefined;};   // never the world root
    const hostRoom = room(at), mine = gap(dest(ownPlans.get(hostCap)));
    if (!hostRoom || !ground(ownPlans.get(hostCap))) return undefined;
    const near = ownCaps.filter(c => c.verb === verb && c.available && c.target?.kind === 'spot' && ownPlans.has(c.id)).map(c => ({c, to: dest(ownPlans.get(c.id))}))
      .filter((x): x is {c: EdgeCapability; to: V2} => !!x.to && gap(x.to) > 0.5 && gap(x.to) <= 4 && gap(x.to) < mine && room(x.to) === hostRoom)
      .sort((a, b) => gap(a.to) - gap(b.to) || a.c.id.localeCompare(b.c.id))[0];
    return near && ownPlans.get(near.c.id);
  }
  /** accept:<invite> → the guest's own plan to join (computed now, from where everyone is). */
  acceptPlan(soul: EdgeSoul, inviteId: string, ownCaps: EdgeCapability[], ownPlans: Map<string, TogetherPlan>, params: Record<string, unknown> = {}): {code: string; reason: string} | {label: string; steps: Steps; capability: string; ride?: {object: string}; commit: (receipt: string) => void; wait?: boolean; existing?: string; detail?: Record<string, unknown>} {
    const inv = this.invite(inviteId);
    if (inv?.kind === 'shared') return this.acceptShared(soul, inv, params);
    if (!inv || inv.state !== 'pending' || !inv.guests.some(g => g.soulId === soul.soulId) || inv.responses[soul.soulId]) return {code: 'invite.gone', reason: 'That invitation is no longer open.'};
    if(inv.pairedPolicy!==undefined&&inv.pairedPolicy!=='ready-v1')return {code:'gesture.policy-unsupported',reason:'That invitation names an unsupported paired policy.'};
    const host = this.mindOf(inv.host.soulId), hb = host ? this.p.body(host.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!host || !hb || !me || this.p.faded(inv.host.soulId)) return {code: 'invite.gone', reason: `${inv.host.name} is not here any more.`};
    const commit = (receipt: string) => this.respond(inv.id, soul, 'accepted', receipt);
    const activityAt: V2 = inv.kind === 'activity' && inv.meetAt ? inv.meetAt : [hb.pose.p[0], hb.pose.p[2]];
    const d = Math.hypot(activityAt[0] - me.pose.p[0], activityAt[1] - me.pose.p[2]), go = (standoff: number): Steps => d > standoff + 0.6 ? [{verb: 'walk_to', params: {to: inv.kind === 'activity' && inv.meetAt ? inv.meetAt : host.entityId, standoff}}] : [{verb: 'wave', params: {at: host.entityId, seconds: 0.2}}];
    if (inv.what === 'hand-over') return this.acceptHandOver(soul, inv, hb, me, commit);
    if (inv.kind === 'paired' || inv.kind === 'give') {
      if (inv.kind === 'give' && this.heldBy(soul.soulId)) return {code: 'hands.full', reason: `Your hands are full; put down ${this.heldBy(soul.soulId)!.name} first.`};
      if (this.asleep(soul.entityId)) return {code: 'state.asleep', reason: 'Wake up first.'};
      // entry 35: my own throw, chosen now without seeing theirs; a hand needs free hands
      if (inv.what === 'rps' && !isRpsShape(params.shape)) return SHAPE_REFUSAL;
      if (inv.what === 'hold-hands') {
        if (this.heldBy(soul.soulId)) return {code: 'hands.full', reason: `Your hands are full; put down ${this.heldBy(soul.soulId)!.name} first.`};
        const other = this.handsWith(soul.entityId); if (other) return {code: 'hands.holding', reason: `You are holding ${other.name}'s hand; let go first.`};
        // they are still walking over to stand beside me: I wait here for them (walking to meet them as well would cross
        // their path); beside me already: take the hand; standing apart (I moved): walk to their free side first
        const coming = hb.human?.handHold?.offered === undefined, near = Math.hypot(hb.pose.p[0] - me.pose.p[0], hb.pose.p[2] - me.pose.p[2]);
        const side = coming || near <= 1.2 ? null : this.besideSteps(soul.entityId, host.entityId);
        if (!coming && near > 1.2 && !side) return {code: 'gesture.no-room', reason: `There is no clear spot beside ${inv.host.name} right now; try again in a moment.`};
        return {label: `Take ${inv.host.name}'s hand`, capability: 'accept:' + inv.id, commit,
          steps: [...this.standFirst(soul.entityId), ...(side?.steps ?? []), {verb: 'mars:hand_hold_v1', params: {mode: 'join', partner: host.entityId, group: inv.id, waitSeconds: 30}}]};
      }
      const seatedTake = inv.kind === 'give' && this.seated(soul.entityId);
      // F1: until the host has reached its own meet spot (its grouped pose not yet begun), meet it there; planning against
      // the still-walking body sent the guest across the host's path and could leave a bystander standing between them
      const hostAt = inv.meetAt && hb.human?.together?.group !== inv.id ? inv.meetAt : undefined;
      const meet = seatedTake ? [] : inv.kind === 'give' ? this.handSteps(soul.entityId, host.entityId, hostAt) : this.meetSteps(soul.entityId, host.entityId, 1.1, inv.gap ?? 0.8, hostAt);
      if (!meet) return {code: 'gesture.no-room', reason: `There is no clear spot beside ${inv.host.name} right now (someone else is standing too close); try again in a moment.`};
      const steps: Steps = [...(seatedTake ? [] : [...this.standFirst(soul.entityId), ...meet]),
        pose(inv.activity!, inv.seconds!, {group: inv.id, gap: inv.gap, ...(inv.pairedPolicy?{pairedPolicy:inv.pairedPolicy}:{}), waitSeconds: 30, alone: 'fail', clear: true, ...(inv.kind === 'give' ? {prop: inv.item!.kind, hold: inv.item!.kind} : {}), ...(inv.what === 'rps' ? {throw: params.shape} : {})})];
      return {label: inv.kind === 'give' ? `Take ${inv.item!.name} from ${inv.host.name}` : inv.what === 'rps' ? `Play rock-paper-scissors with ${inv.host.name}` : `${inv.what} with ${inv.host.name}`, steps, capability: 'accept:' + inv.id, commit: receipt => {
        // the guest's throw joins the host's in the world's keeping (neither is shown before "shoot")
        if (inv.what === 'rps' && isRpsShape(params.shape)) {const fresh = this.invite(inv.id); if (fresh) {fresh.rps = {...fresh.rps, guest: params.shape}; this.saveInvite(fresh);}}
        commit(receipt); if (inv.kind === 'give') this.saveOp(receipt, {soulId: soul.soulId, op: 'take', item: inv.item!.id, invite: inv.id});
      }};
    }
    if (inv.kind === 'ride') return {label: 'Join the ride', steps: [], capability: 'accept:' + inv.id, ride: {object: inv.ride!.object}, commit};
    // activity: the same place-bound capability if I have it; walks become walking with the host; poses happen beside them
    const hostCap = inv.capability, verb = hostCap.slice(0, hostCap.indexOf(':'));
    if (['walk', 'stroll', 'wander', 'hang-out'].includes(verb)) return {label: `Walk with ${inv.host.name}`, steps: this.followSteps(soul.entityId, host.entityId), capability: 'accept:' + inv.id, commit: receipt => {
      commit(receipt); this.saveFollow({receipt, soulId: soul.soulId, target: inv.host.soulId, untilTick: this.tick + 3600 * 20, withHost: inv.hostReceipt ?? undefined});
    }};
    // CN5: a game: my own free place at the same court (same verb, same group)
    if (verb.startsWith('play-') && ['play-frisbee', 'play-petanque', 'play-volleyball'].includes(verb)) {
      const group = (id: string) => (ownPlans.get(id)?.steps ?? []).find(s => s.verb === 'mars:pose_v1')?.params.group;
      const hostGroup = hb.human?.together?.group ?? (ownPlans.has(hostCap) ? group(hostCap) : undefined) ?? `game-${verb.slice(5)}-`;
      const to = (id: string) => {const t = (ownPlans.get(id)?.steps ?? []).find(s => s.verb === 'walk_to')?.params.to as [number, number] | undefined; return t ? Math.hypot(t[0] - hb.pose.p[0], t[1] - hb.pose.p[2]) : Infinity;};
      const mine = ownCaps.filter(c => c.verb === verb && c.available && ownPlans.has(c.id) && String(group(c.id) ?? '').startsWith(String(hostGroup))).map(c => ({c, d: to(c.id)})).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id))[0];
      if (!mine) return {code: 'game.full', reason: 'There is no free place left at that game.'};
      return {label: ownPlans.get(mine.c.id)!.label, steps: ownPlans.get(mine.c.id)!.steps, capability: 'accept:' + inv.id, commit};
    }
    // CN5: a spot activity (listen in the audience, play in the band, use a computer): my nearest free spot of it by the host
    if (!ownCaps.some(c => c.id === hostCap && c.available)) {
      const to = (id: string) => {const t = (ownPlans.get(id)?.steps ?? []).find(s => s.verb === 'walk_to')?.params.to; return Array.isArray(t) ? Math.hypot(Number(t[0]) - activityAt[0], Number(t[1]) - activityAt[1]) : Infinity;};
      const near = ownCaps.filter(c => c.verb === verb && c.available && c.target?.kind === 'spot' && ownPlans.has(c.id)).map(c => ({c, d: to(c.id)})).filter(x => x.d <= 12).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id))[0];
      if (near) {
        const steps = structuredClone(ownPlans.get(near.c.id)!.steps), last = invitedPose(steps);
        if (last) {if (Number.isFinite(inv.seconds) && inv.seconds! > 0) last.params.seconds = inv.seconds; last.params.group = inv.id; last.params.waitSeconds = 20; last.params.alone = 'start'; if (inv.windowPolicy) last.params.windowPolicy = inv.windowPolicy;}
        return {label: ownPlans.get(near.c.id)!.label, steps, capability: 'accept:' + inv.id, commit};
      }
    }
    if (!hostCap.endsWith(':here') && ownPlans.has(hostCap) && ownCaps.find(c => c.id === hostCap)?.available) {
      const own = (inv.meetAt && this.spotBeside(inv.meetAt, hb.human?.level ?? 0, me.human?.level ?? 0, verb, hostCap, ownCaps, ownPlans)) || ownPlans.get(hostCap)!, steps = structuredClone(own.steps), last = invitedPose(steps);
      if (last) {if (Number.isFinite(inv.seconds) && inv.seconds! > 0) last.params.seconds = inv.seconds; last.params.group = inv.id; last.params.waitSeconds = 20; last.params.alone = 'start'; if (inv.windowPolicy) last.params.windowPolicy = inv.windowPolicy;}
      return {label: own.label, steps, capability: 'accept:' + inv.id, commit};
    }
    if (verb === 'sit') {
      // a free seat near them, else the ground beside them
      const seat = ownCaps.filter(c => c.verb === 'sit' && c.available && c.target && c.id !== 'sit:here' && ownPlans.has(c.id)).map(c => {const e = this.w.entities[(this.p.host.kernel.things[c.target!.id]?.traits.entity as string | undefined) ?? c.target!.id]; return e ? {c, d: Math.hypot(e.pose.p[0] - hb.pose.p[0], e.pose.p[2] - hb.pose.p[2])} : null;})
        .filter((x): x is {c: EdgeCapability; d: number} => !!x && x.d <= 5 && x.d > 0.3).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id))[0];
      if (seat) return {label: `Sit with ${inv.host.name}`, steps: ownPlans.get(seat.c.id)!.steps, capability: 'accept:' + inv.id, commit};
      return {label: `Sit with ${inv.host.name}`, steps: [...this.standFirst(soul.entityId), ...go(1.2), pose('sit-ground', inv.seconds ?? 120)], capability: 'accept:' + inv.id, commit};
    }
    if (inv.activity) {
      const lying = ['lie', 'nap', 'yoga', 'pushups', 'situps'].includes(inv.activity);
      return {label: `${inv.activity} with ${inv.host.name}`, capability: 'accept:' + inv.id, commit,
        steps: [...this.standFirst(soul.entityId), ...go(lying ? 1.8 : 1.4), pose(inv.activity, inv.seconds ?? 60, {group: inv.id, waitSeconds: 20, alone: 'start', ...(inv.windowPolicy ? {windowPolicy: inv.windowPolicy} : {}), ...(inv.prop ? {prop: inv.prop} : {})})]};
    }
    return {label: `Join ${inv.host.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: host.entityId, standoff: 1.4}}], capability: 'accept:' + inv.id, commit};
  }
  /** Souls a ride keeps places for (open ride invitations not declined). */
  rideGuests(carrier: string): {soulId: string; name: string}[] {
    return this.pending().filter(i => i.kind === 'ride' && i.ride?.carrier === carrier).flatMap(i => i.guests.filter(g => !i.responses[g.soulId] || i.responses[g.soulId] === 'accepted'));
  }
  /** A pending invitation from `other` to `me` of this paired gesture (doing it back is accepting). */
  reciprocal(me: string, other: string, what: string): Invite | null {return this.invitesFor(me).find(i => i.host.soulId === other && i.what === what) ?? null;}

  // ---------------------------------------------------------------- entry 41: hand-overs of held world things
  /** How a world names its things (god/held.ts sets it: the thing's own name); else the engine label. */
  thingName?: (id: string) => string;
  private thingMemo: {tick: number; map: Map<string, {id: string; name: string} | null>} | null = null;
  /** The opted-in world thing this body holds (in-hand, recorded item pose: the lantern, the bowl), or null. One scan per
   *  body per tick (capability listings only; never per tick on their own). */
  thingIn(entityId: string): {id: string; name: string} | null {
    if (this.thingMemo?.tick !== this.tick) this.thingMemo = {tick: this.tick, map: new Map()};
    const memo = this.thingMemo.map; if (memo.has(entityId)) return memo.get(entityId)!;
    let out: {id: string; name: string} | null = null;
    for (const x of Object.values(this.w.entities)) if (x.support?.kind === 'in-hand' && x.support.by === entityId && x.tags?.includes('entity-world-item-pose')) {out = {id: x.id, name: this.thingName?.(x.id) ?? String(x.label ?? x.id)}; break;}
    memo.set(entityId, out); return out;
  }
  /** Anything in this body's hands (a ledger item, or any world thing): a hand-over is to free hands only. */
  private handsFull(soulId: string, entityId: string): boolean {
    if (this.heldBy(soulId) || this.handsWith(entityId)) return true;
    for (const x of Object.values(this.w.entities)) if (x.support?.kind === 'in-hand' && x.support.by === entityId) return true;
    return false;
  }
  /** Where the giver stands to hand something over: HANDOVER_GAP in front of the receiver (the way they face, then up to
   *  45° either side, nearest to the giver), else beside or behind them, with a clear line and room for both; [] when the
   *  giver already stands about there (the engine settles the last few centimetres and turns). Never at their back while
   *  a front spot is free (take 1: Ada held the lantern out to Ben's back and he turned half round to take it). */
  private handOverSteps(me: string, other: string): Steps | null {
    const mb = this.p.body(me), ob = this.p.body(other); if (!mb || !ob) return null;
    const from: V2 = [mb.pose.p[0], mb.pose.p[2]], at: V2 = [ob.pose.p[0], ob.pose.p[2]], d = Math.hypot(at[0] - from[0], at[1] - from[1]);
    const e = menuWorldOf(this.p.host);
    const people = Object.values(this.w.entities).filter(x => x.kind === 'human' && x.id !== me && x.id !== other).map(x => [x.pose.p[0], x.pose.p[2]] as V2);
    const free = (p: V2) => (e.clearanceAtV1?.(p[0], p[1]) ?? 1) >= 0.34 && people.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= 0.8) && this.lineClear(p, at);
    const off = (p: V2) => Math.abs(Math.atan2(Math.sin(Math.atan2(p[1] - at[1], p[0] - at[0]) - ob.pose.yaw), Math.cos(Math.atan2(p[1] - at[1], p[0] - at[0]) - ob.pose.yaw)));
    if (Math.abs(d - HANDOVER_GAP) <= 0.15 && off(from) <= Math.PI / 4 + 1e-6 && free(from)) return [];
    const spots: {p: V2; front: boolean; d: number}[] = [];
    for (let k = -7; k <= 8; k++) {
      const ang = ob.pose.yaw + k * Math.PI / 8, p: V2 = [r2(at[0] + Math.cos(ang) * HANDOVER_GAP), r2(at[1] + Math.sin(ang) * HANDOVER_GAP)];
      if (free(p)) spots.push({p, front: Math.abs(k) <= 2, d: Math.hypot(p[0] - from[0], p[1] - from[1])});
    }
    spots.sort((a, b) => Number(b.front) - Number(a.front) || a.d - b.d || a.p[0] - b.p[0] || a.p[1] - b.p[1]);
    return spots.length ? [{verb: 'walk_to', params: {to: spots[0].p, standoff: 0}}] : null;
  }
  private prepareHandOver(soul: EdgeSoul, cap: EdgeCapability, plan: TogetherPlan, params: Record<string, unknown>, steps: Steps, tag: Extract<Tag, {kind: 'hand-over'}>): {code: string; reason: string; did_you_mean?: {id: string; label: string}[]} | {steps: Steps; label?: string; commit?: (receipt: string) => void} {
    const g = this.mindOf(tag.guest), gb = g ? this.p.body(g.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!g || !gb || !me || this.p.faded(tag.guest)) return {code: 'gesture.partner-unavailable', reason: 'They are not here any more.'};
    if (isRigidBody(me) || isRigidBody(gb)) return {code: 'body.unsupported', reason: 'A hand-over needs two humanoid bodies with hands.'};
    if (this.thingIn(soul.entityId)?.id !== tag.item) return {code: 'hands.empty', reason: 'You are not holding that any more.'};
    if (this.handsFull(tag.guest, g.entityId)) return {code: 'hands.full', reason: `${g.name}'s hands are full.`};
    const apart = Math.hypot(gb.pose.p[0] - me.pose.p[0], gb.pose.p[2] - me.pose.p[2]);
    if (tag.approach && apart > GESTURE_RADIUS) {
      const act = steps.filter(s => s.verb !== 'stand' && !(s.verb === 'walk_to' && s.params.to === g.entityId)), label = plan.label;
      return {steps: this.followSteps(soul.entityId, g.entityId, apart), label: `Walk over to ${g.name} (${label.toLowerCase()} on arrival)`, commit: receipt => {
        this.approaches.set(receipt, {tag, capability: cap.id, label, act, params, untilTick: this.tick + APPROACH_SECONDS * 20});
        this.p.deliver(soul.soulId, 'world', {text: `${g.name} is ${Math.round(apart)} m away; walking over to them first.`});
      }};
    }
    if (apart > GESTURE_RADIUS + 2) return {code: 'gesture.too-far', reason: `${g.name} is too far away; go near them first.`};
    const meet = this.handOverSteps(soul.entityId, g.entityId);
    if (!meet) return {code: 'gesture.no-room', reason: `There is no clear spot in front of ${g.name} right now; try again in a moment or somewhere roomier.`, did_you_mean: [{id: 'go-near:' + g.soulId, label: `Go near ${g.name}`}]};
    const id = 'inv_' + randomUUID().slice(0, 12), out = structuredClone(steps).flatMap(s => s.verb === 'walk_to' && s.params.to === g.entityId ? meet : [s]);
    for (const s of out) if (s.verb === 'mars:hand_over_v1') s.params.group = id;
    const meetAt: V2 = meet[0]?.verb === 'walk_to' ? meet[0].params.to as V2 : [r2(me.pose.p[0]), r2(me.pose.p[2])];
    return {steps: out, commit: receipt => {
      const inv: Invite = {id, what: 'hand-over', kind: 'give', host: {soulId: soul.soulId, name: soul.name}, guests: [{soulId: g.soulId, name: g.name}], capability: cap.id, meetAt,
        label: `wants to give you the ${tag.name}`, thing: {id: tag.item, name: tag.name}, createdTick: this.tick, expiresTick: this.tick + 30 * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {}};
      this.saveInvite(inv); this.announce(inv);
    }};
  }
  private acceptHandOver(soul: EdgeSoul, inv: Invite, hb: NonNullable<ReturnType<TogetherPort['body']>>, me: NonNullable<ReturnType<TogetherPort['body']>>, commit: (receipt: string) => void): {code: string; reason: string} | {label: string; steps: Steps; capability: string; commit: (receipt: string) => void} {
    const host = this.mindOf(inv.host.soulId)!, thing = inv.thing!;
    if (this.asleep(soul.entityId)) return {code: 'state.asleep', reason: 'Wake up first.'};
    if (this.handsFull(soul.soulId, soul.entityId)) return {code: 'hands.full', reason: 'Your hands are full; put down what you are holding first.'};
    const x = this.w.entities[thing.id];
    if (x?.support?.kind !== 'in-hand' || x.support.by !== host.entityId) return {code: 'invite.gone', reason: `${inv.host.name} is not holding the ${thing.name} any more.`};
    // the giver comes to stand in front of me; if I have walked off, I go back to them first
    const d = Math.hypot(hb.pose.p[0] - me.pose.p[0], hb.pose.p[2] - me.pose.p[2]), coming = !hb.human?.itemTransferV1;
    const go: Steps = !coming && d > HANDOVER_GAP + 0.5 ? [{verb: 'walk_to', params: {to: host.entityId, standoff: HANDOVER_GAP}}] : [];
    return {label: `Take the ${thing.name} from ${inv.host.name}`, capability: 'accept:' + inv.id, commit,
      steps: [...this.standFirst(soul.entityId), ...go, {verb: 'mars:hand_over_v1', params: {mode: 'receive', partner: host.entityId, item: thing.id, group: inv.id, waitSeconds: 40}}]};
  }

  // ---------------------------------------------------------------- receipts, follows, time
  /** Receipt phase changes (live): items change hands, invitations close with their host's act, follows end. */
  onReceipt(r: EdgeReceipt) {
    if (r.phase === 'started' || r.phase === 'waiting') return;
    if (r.phase === 'completed') this.tellRps(r);
    const op = this.takeOp(r.id);
    if (op) this.applyOp(op, r);
    if (this.follows.has(r.id)) this.dropFollow(r.id);
    this.approaches.delete(r.id);
    // the host's act ended: a still-open invitation closes (a ride's stays open while its host sits in the basket)
    for (const inv of this.pending()) if (inv.hostReceipt === r.id && !(inv.kind === 'ride' && r.phase === 'completed')) {
      const open = inv.guests.filter(g => !inv.responses[g.soulId]);
      for (const g of open) {inv.responses[g.soulId] = 'cancelled'; this.p.deliver(g.soulId, 'invite.closed', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s invitation (${inv.what}) is no longer open.`, untrusted: true});}
      inv.state = 'closed'; this.saveInvite(inv);
      // PC04 (PC02 §1): the host did something else, so the proposal is off for everyone who had accepted
      this.failShared(inv, 'shared.left', `${inv.host.name} did something else, so the shared carry is off; nothing was lifted.`);
    }
    // PC04: a guest's shared receipt ended before commit (left, or another act of theirs): free the role
    const shared = r.capability.startsWith('accept:') ? this.inviteForReceipt(r.id) : null;
    const guest = shared?.kind === 'shared' && shared.state === 'pending' ? Object.keys(shared.guestReceipts).find(g => shared.guestReceipts[g] === r.id && shared.responses[g] === 'accepted') : undefined;
    if (shared?.shared && guest) {
      const name = this.mindOf(guest)?.name ?? shared.guests.find(g => g.soulId === guest)?.name ?? 'someone';
      shared.responses[guest] = 'left'; for (const role of shared.shared.roles) if (role.soulId === guest) role.soulId = null;
      this.saveInvite(shared);
      this.p.deliver(shared.host.soulId, 'invite.left', {invite: {id: shared.id, what: shared.what, revision: shared.shared.revision}, from: {soulId: guest, name}, text: `${name} left the shared carry before it started.`, untrusted: true});
      this.sharedViable(shared, 'shared.left', `${name} left the shared carry.`);
    }
  }
  private dropPlace(soulId: string) {return this.p.innermostPlace(soulId) ?? 'world';}

  // ---------------------------------------------------------------- entry 35: rock-paper-scissors and holding hands
  /** The world's verdict on a finished game, from this Soul's side (null until both throws are in). */
  rpsVerdict(inv: Invite, soulId: string): {mine: RpsShape; theirs: RpsShape; other: string; result: 'win' | 'lose' | 'draw'; text: string} | null {
    if (inv.what !== 'rps' || !inv.rps?.host || !inv.rps.guest) return null;
    const host = inv.host.soulId === soulId, mine = host ? inv.rps.host : inv.rps.guest, theirs = host ? inv.rps.guest : inv.rps.host;
    const other = host ? (this.mindOf(inv.guests[0].soulId)?.name ?? inv.guests[0].name) : (this.mindOf(inv.host.soulId)?.name ?? inv.host.name), result = rpsResult(mine, theirs);
    return {mine, theirs, other, result, text: `Rock, paper, scissors, shoot! You threw ${mine}; ${other} threw ${theirs}. ${result === 'win' ? 'You win.' : result === 'lose' ? `${other} wins.` : 'A draw.'}`};
  }
  /** Each player hears the result when their own game ends (after the throw has been seen). */
  private tellRps(r: EdgeReceipt) {
    const inv = this.inviteForReceipt(r.id); if (!inv || inv.what !== 'rps') return;
    const v = this.rpsVerdict(inv, r.soulId); if (!v || inv.rps?.told?.includes(r.soulId)) return;
    inv.rps = {...inv.rps, told: [...(inv.rps?.told ?? []), r.soulId]}; this.saveInvite(inv);
    this.p.deliver(r.soulId, 'rps.result', {text: v.text, you: v.mine, them: v.theirs, result: v.result});
  }
  /** The Soul whose hand this body holds (joined, not letting go), or null. */
  handsWith(entityId: string): {soulId: string; name: string; entityId: string} | null {
    const h = this.p.body(entityId)?.human?.handHold; if (!h || h.since === undefined || h.release !== undefined) return null;
    const m = this.p.host.mindByEntity?.get(h.with) as {soulId: string; name: string} | undefined;
    return m ? {soulId: m.soulId, name: m.name, entityId: h.with} : null;
  }
  /** A spot beside a Soul (side by side, facing the way they face) for holding hands, nearest to me, clear of things and
   *  people; the hand I hold out is the inner one. Null when no side is free. */
  besideSteps(me: string, other: string): {steps: Steps; hand: 'left' | 'right'} | null {
    const mb = this.p.body(me), ob = this.p.body(other); if (!mb || !ob) return null;
    const e = menuWorldOf(this.p.host);
    const people = Object.values(this.w.entities).filter(x => x.kind === 'human' && x.id !== me && x.id !== other).map(x => [x.pose.p[0], x.pose.p[2]] as V2);
    const y = ob.pose.yaw, r: V2 = [-Math.sin(y), Math.cos(y)], from: V2 = [mb.pose.p[0], mb.pose.p[2]];
    const spots = [1, -1].map(s => ({s, p: [r2(ob.pose.p[0] + r[0] * s * HAND_GAP), r2(ob.pose.p[2] + r[1] * s * HAND_GAP)] as V2}))
      .filter(({p}) => (e.clearanceAtV1?.(p[0], p[1]) ?? 1) >= 0.34 && people.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= 0.8) && this.lineClear(p, [ob.pose.p[0], ob.pose.p[2]]))
      .sort((a, b) => Math.hypot(a.p[0] - from[0], a.p[1] - from[1]) - Math.hypot(b.p[0] - from[0], b.p[1] - from[1]) || b.s - a.s);
    const best = spots[0]; if (!best) return null;
    // on their right (s = +1) I hold out my left hand; on their left, my right
    const hand = best.s > 0 ? 'left' : 'right', d = Math.hypot(best.p[0] - from[0], best.p[1] - from[1]);
    return {hand, steps: d > 0.05 ? [{verb: 'walk_to', params: {to: best.p, standoff: 0}}] : []};
  }
  /**
   * Before any act of a Soul holding hands (ledger.decide): a plain walk becomes a walk together (the pair turns
   * together toward the goal, then walks at a stroll with the other beside); anything else (or any act of the one being
   * led) lets go first. Returns the steps to perform and whom to tell.
   */
  holdingSteps(soul: EdgeSoul, capability: string, steps: Steps): Steps {
    const w = this.handsWith(soul.entityId); if (!w) return steps;
    if (capability === 'let-go:here' || /^(?:accept|decline|withdraw):/.test(capability) && !steps.length || steps.some(s => s.verb === 'mars:hand_hold_v1')) return steps;
    const partner = this.p.body(w.entityId), led = !!partner?.human?.task && menuWorldOf(this.p.host).runtime.records.get(partner.human.task)?.verb === 'walk_to';
    const travel = steps.length > 0 && steps.every(s => ['stand', 'walk_to', 'wave', 'face', 'rest'].includes(s.verb)) && steps.some(s => s.verb === 'walk_to') && steps.every(s => s.verb !== 'walk_to' || !s.params.gait || s.params.gait === 'walk');
    if (travel && !led) {
      const firstWalk = steps.find(s => s.verb === 'walk_to')!, to = firstWalk.params.to, toward = this.pointOfTo(to);
      this.p.deliver(w.soulId, 'hands.walk', {from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} walks on with you, hand in hand. (Let go any time: let-go:here.)`, untrusted: true});
      return [...(toward ? [{verb: 'mars:hand_hold_v1', params: {mode: 'turn', toward}}] : []), ...steps.filter(s => s.verb === 'walk_to' || s.verb === 'rest').map(s => s.verb === 'walk_to' ? {...s, params: {...s.params, pace: 'together'}} : s)];
    }
    this.p.deliver(w.soulId, 'hands.released', {from: {soulId: soul.soulId, name: soul.name}, text: `${soul.name} let go of your hand to do something else.`, untrusted: true});
    return [{verb: 'mars:hand_hold_v1', params: {mode: 'release'}}, ...steps];
  }
  private pointOfTo(to: unknown): V2 | null {
    if (Array.isArray(to) && to.length === 2 && to.every(Number.isFinite)) return [to[0], to[1]];
    if (typeof to !== 'string') return null;
    const e = this.w.entities[to]; if (e) return [e.pose.p[0], e.pose.p[2]];
    const place = this.p.places.byId.get(to); return place?.polygon?.length ? centroid(place.polygon) : null;
  }
  /** The one line an offeree sees for a pending offer of a game or a hand, and the line a held hand shows. */
  handLines(soul: EdgeSoul): {offer?: string; hands?: string} {
    const out: {offer?: string; hands?: string} = {};
    const inv = this.invitesFor(soul.soulId).filter(i => i.what === 'rps' || i.what === 'hold-hands' || i.what === 'hand-over').at(-1);
    if (inv) out.offer = inv.what === 'hand-over' ? `${inv.host.name} holds out the ${inv.thing?.name ?? 'thing'} for you: accept or decline (${Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))} s)`
      : `${inv.host.name} offers you ${PAIRED[inv.what as Paired].ask}: accept${inv.what === 'rps' ? ' with your throw' : ''} or decline (${Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))} s)`;
    const w = this.handsWith(soul.entityId); if (w) out.hands = `holding hands with ${w.name}`;
    return out;
  }
  private applyOp(op: ItemOp, r: EdgeReceipt) {
    const done = r.phase === 'completed', m = this.mindOf(op.soulId), b = m ? this.p.body(m.entityId) : undefined;
    const it = op.item ? this.item(op.item) : null;
    if (op.op === 'pick-up') {
      if (it && it.claimedBy === op.soulId && it.state === 'placed') {it.claimedBy = null; if (done) {it.state = 'held'; it.holder = op.soulId; it.placeId = null; it.at = null;} this.saveItem(it);}
      else if (!op.item && done && op.kind) this.saveItem({id: 'it_' + randomUUID().slice(0, 12), kind: op.kind, name: ITEM_NAMES[op.kind], holder: op.soulId, placeId: null, at: null, state: 'held', claimedBy: null, by: op.soulId, createdAt: Date.now(), placedAt: null});
      return;
    }
    if (!it || !done) {
      // a hand-over that did not happen: the gift stays with the giver; a take that failed after the giver let go drops it here
      if (op.op === 'take' && it && it.holder === op.soulId && it.state === 'held' && b && !b.human?.holding) this.place(it, op.soulId, b);
      return;
    }
    if (op.op === 'put-down' && it.holder === op.soulId && b) {
      // a book put down by a shelf goes back on the shelf; a cup or plate by its café/kitchen is cleared away
      const at: V2 = [b.pose.p[0], b.pose.p[2]], home = this.sources().find(s => s.kind === it.kind && Math.hypot(s.at[0] - at[0], s.at[1] - at[1]) < (s.id.startsWith('shelf:') ? 3 : 2));
      if (home && (it.kind === 'book' || CONSUMABLE.has(it.kind))) {it.state = 'gone'; it.holder = null; this.saveItem(it); this.p.deliver(op.soulId, 'world', {text: it.kind === 'book' ? 'You put the book back on the shelf.' : `You put ${it.name} back.`}); return;}
      this.place(it, op.soulId, b);
    } else if (op.op === 'consume' && it.holder === op.soulId) {it.state = 'gone'; it.holder = null; this.saveItem(it);}
    else if (op.op === 'give' && it.holder === op.soulId && op.to) {
      const inv = op.invite ? this.invite(op.invite) : null;
      if (inv?.responses[op.to] === 'accepted') {it.holder = op.to; this.saveItem(it); this.p.deliver(op.to, 'world', {text: `${m?.name ?? 'Someone'} gave you ${it.name}.`, untrusted: true});}
    }
  }
  private place(it: Item, soulId: string, b: {pose: {p: number[]; yaw: number}}) {
    const x = b.pose.p[0] + Math.cos(b.pose.yaw) * 0.35, z = b.pose.p[2] + Math.sin(b.pose.yaw) * 0.35;
    it.state = 'placed'; it.holder = null; it.placeId = this.dropPlace(soulId); it.at = [r2(x), r2(z)]; it.placedAt = Date.now(); it.claimedBy = null; it.by = soulId; this.saveItem(it);
  }
  /** onProgram hook: a follow leg finished — walk on (true) or let the receipt end. */
  continueFollow(receiptId: string, soul: EdgeSoul): boolean {
    const f = this.follows.get(receiptId); if (!f) return false;
    const t = this.mindOf(f.target), tb = t ? this.p.body(t.entityId) : undefined, me = this.p.body(soul.entityId);
    if (!t || !tb || !me || this.p.faded(f.target)) {this.endFollow(f, 'completed'); return false;}
    if (this.p.aboard(t.entityId)) {this.endFollow(f, 'completed'); this.p.deliver(f.soulId, 'world', {text: `${t.name} boarded a ride; you stop following.`, untrusted: true}); return false;}
    if (this.arrivedTogether(f)) {this.endFollow(f, 'completed'); return false;}
    if (this.tick >= f.untilTick) {this.endFollow(f, 'completed'); return false;}
    if (Math.hypot(tb.pose.p[0] - me.pose.p[0], tb.pose.p[2] - me.pose.p[2]) > FOLLOW_LOST) {this.endFollow(f, 'failed', 'follow.lost', `You lost sight of ${t.name}.`); return false;}
    void this.p.decide(soul, receiptId, 'follow:' + f.target, `Walk with ${t.name}`, this.followSteps(soul.entityId, t.entityId, Math.hypot(tb.pose.p[0] - me.pose.p[0], tb.pose.p[2] - me.pose.p[2])).filter(s => s.verb !== 'stand')).catch(() => this.p.fail(receiptId, 'ledger.unavailable', 'The world could not record this action.'));
    return true;
  }
  /** Walking together (an accepted walk invitation): the host's walk is over and the guest is beside them. */
  private arrivedTogether(f: Follow) {
    if (!f.withHost || ['started', 'waiting'].includes(this.p.receipt(f.target, f.withHost)?.phase ?? 'gone')) return false;
    const a = this.posOf(f.soulId), b = this.posOf(f.target);
    if (a && b && !besideEachOther(a, b)) {f.untilTick = Math.min(f.untilTick, this.tick + 60 * 20); return false;}
    return true;
  }
  private endFollow(f: Follow, phase: 'completed' | 'failed', code?: string, reason?: string) {
    this.dropFollow(f.receipt);
    const running = this.p.running(f.soulId, f.receipt), m = this.mindOf(f.soulId);
    if (phase === 'failed') this.p.fail(f.receipt, code ?? 'follow.ended', reason ?? 'The walk together ended.'); else this.p.complete(f.receipt);
    if (running && m) this.p.stop(f.soulId, m.entityId, f.receipt);
  }
  /** Every second: invitations lapse; follows whose target faded end; placed items are cleared after a while. */
  sweep() {
    const tick = this.tick, carriers = (menuWorldOf(this.p.host) as unknown as {carriers?: () => {id: string; state: {phase: string; hold?: unknown}}[]}).carriers?.() ?? [];
    for (const inv of this.pending()) {
      // a ride invitation closes once the basket has gone (or stopped keeping the place)
      const gone = inv.kind === 'ride' && (() => {
        const c = carriers.find(x => x.id === inv.ride?.carrier), boarding = inv.hostReceipt ? ['started', 'waiting'].includes(this.p.receipt(inv.host.soulId, inv.hostReceipt)?.phase ?? '') : false;
        return !c || c.state.phase === 'aloft' || c.state.phase === 'landed' || (!boarding && !c.state.hold);
      })();
      if (tick <= inv.expiresTick && !gone) continue;
      const open = inv.guests.filter(g => !inv.responses[g.soulId]);
      for (const g of open) {inv.responses[g.soulId] = 'expired'; this.p.deliver(g.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s invitation (${inv.what}) lapsed.`, untrusted: true});}
      inv.state = 'closed'; this.saveInvite(inv);
      if (open.length) this.p.deliver(inv.host.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, text: `No answer from ${open.map(g => g.name).join(', ')} (${inv.what}).`, untrusted: true});
      if (!Object.values(inv.responses).includes('accepted') && (inv.kind === 'paired' || inv.kind === 'give')) this.hostAlone(inv, 'invite.expired', `No answer from ${open.map(g => g.name).join(', ')}.`);
      // PC04: a shared proposal that never started lapses for every member (expiry never applies after a commit, PC05)
      if (inv.kind === 'shared') {
        const why = open.length ? `No answer from ${open.map(g => g.name).join(', ')}; the shared carry lapsed and nothing was lifted.` : 'The shared carry did not start before the proposal lapsed; nothing was lifted.';
        this.failShared(inv, 'invite.expired', why); this.hostAlone(inv, 'invite.expired', why);
      }
    }
    for (const f of [...this.follows.values()]) {
      const r = this.p.receipt(f.soulId, f.receipt); if (!r || !['started', 'waiting'].includes(r.phase)) {this.dropFollow(f.receipt); continue;}
      if (this.p.faded(f.target) || !this.mindOf(f.target)) {this.endFollow(f, 'failed', 'follow.lost', 'They are not here any more.'); continue;}
      // walking together ends once the host's walk has ended and the guest has caught up; a follow ends when its time is up
      if (this.arrivedTogether(f) || tick >= f.untilTick) this.endFollow(f, 'completed');
    }
    if (tick % 600 === 0) {
      // closed invitations are kept an hour for the record, then dropped
      this.p.db.db.prepare("DELETE FROM edge_invites_v1 WHERE world_id=? AND state='closed' AND created_at<?").run(this.p.host.worldId, Date.now() - 3600_000);
      const now = Date.now(), placed = this.placed();
      for (const [i, it] of placed.entries()) {
        const age = (now - (it.placedAt ?? now)) / 60_000;
        if (age > (CONSUMABLE.has(it.kind) ? ITEM_LIMITS.consumableMinutes : ITEM_LIMITS.keepHours * 60) || placed.length - i > ITEM_LIMITS.placedWorld) {it.state = 'gone'; this.saveItem(it);}
      }
    }
  }

  // ---------------------------------------------------------------- perception
  observe(soul: EdgeSoul) {
    const held = this.heldBy(soul.soulId), f = this.followingOf(soul.soulId), here = this.posOf(soul.soulId);
    const items = here ? this.placed().filter(i => i.at && Math.hypot(i.at[0] - here[0], i.at[1] - here[1]) <= ITEM_LIMITS.nearItems).map(i => ({id: i.id, kind: i.kind, name: i.name, distance: Math.round(Math.hypot(i.at![0] - here[0], i.at![1] - here[1]) * 10) / 10, capability: 'pick-up:' + i.id})) : [];
    return {
      holding: held ? {id: held.id, kind: held.kind, name: held.name} : null,
      following: f ? {soulId: f.target, name: this.mindOf(f.target)?.name ?? 'someone', untrusted: true} : null,
      followedBy: this.followersOf(soul.soulId).map(x => ({soulId: x.soulId, name: this.mindOf(x.soulId)?.name ?? 'someone'})),
      invites: this.invitesFor(soul.soulId).map(i => ({id: i.id, what: i.what, from: i.host, label: `${i.host.name} ${i.label}`, expiresInSeconds: Math.max(0, Math.round((i.expiresTick - this.tick) / 20)), accept: 'accept:' + i.id, decline: 'decline:' + i.id, ...(i.shared ? {revision: i.shared.revision} : {}), untrusted: true})),
      invited: this.pending().filter(i => i.host.soulId === soul.soulId).map(i => ({id: i.id, what: i.what, guests: i.guests.map(g => ({...g, answer: i.responses[g.soulId] ?? 'pending'})), expiresInSeconds: Math.max(0, Math.round((i.expiresTick - this.tick) / 20))})),
      items,
    };
  }
  /** Public: things lying in the world (viewers draw them). */
  publicItems() {return this.placed().map(i => this.publicItem(i));}

  // ---------------------------------------------------------------- plain words
  /** Social phrasing resolved before the generic vocabulary: accept/decline, gestures with a name or pronoun, follow,
   *  give, pick up / put down / eat / drink, and "<activity> with <names>" / "invite <names> to <activity>". */
  resolve(soul: EdgeSoul, text: string, caps: EdgeCapability[], plans?: Map<string, TogetherPlan>): {capability: string; params?: Record<string, unknown>; rest?: string; note: string} | {code: string; reason: string; did_you_mean: {id: string; label: string}[]} | null {
    const raw = text.trim(), t = raw.toLowerCase().replace(/[!?.]+$/, '').replace(/^(?:please|ok|okay|sure|yes,?|let'?s|lets|i'?d like to|i want to|go and|go)\s+/, '').trim();
    if (raw.includes(':') && caps.some(c => c.id === raw)) return null;
    const near = this.p.perceived(soul.soulId, INVITE_RADIUS);
    const who = (words: string): NearbyBody | null => {
      const w = words.trim().replace(/^(?:to|with|at|the|my friend)\s+/, '').replace(/['’]s\b.*$/, '').trim(); if (!w) return null;
      if (/^(?:him|her|them|they|she|he|my partner|my friend|back)$/.test(w)) {
        // the nearest Soul I am talking with, else the only one close by
        const talking = this.conversationPartners(soul.soulId), mineNear = near.filter(o => talking.includes(o.soulId));
        return mineNear[0] ?? (near.filter(o => o.distance <= GESTURE_RADIUS).length === 1 ? near[0] : null);
      }
      if(this.p.host.soulNameRefusal(w))return null;
      return near.find(o => o.soulId === w) ?? near.find(o => o.name.toLowerCase() === w) ?? near.find(o => tokens(o.name).length && tokens(o.name).every(x => tokens(w).includes(x))) ?? near.find(o => tokens(w).some(x => x.length > 2 && tokens(o.name).includes(x))) ?? null;
    };
    const capFor = (verb: string, o: NearbyBody) => caps.find(c => c.id === `${verb}:${o.soulId}`);
    /** A Soul named but not in sight (inside a building, or far): say where they are and offer the walk there. */
    const notHere = (verb: string, name: string) => {
      const w = name.trim().toLowerCase().replace(/^(?:to|with|at|the)\s+/, '');const stale=this.p.host.soulNameRefusal(w);if(stale)return {code:stale,reason:'That previous Soul name is unavailable or ambiguous; use the current name and immutable Soul ID.',did_you_mean:[]};const m = [...this.p.host.minds.values()].find(x => x.soulId !== soul.soulId && (x.name.toLowerCase() === w || (tokens(x.name).length > 0 && tokens(x.name).every(t => tokens(w).includes(t)))));
      if (!m || this.p.faded(m.soulId)) return {code: 'capability.unknown', reason: `Nobody called "${name}" is near you.`, did_you_mean: caps.filter(c => c.verb === verb).slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const place = this.p.innermostPlace(m.soulId), pname = place ? this.p.places.byId.get(place)?.name ?? place : null, here = this.posOf(soul.soulId), there = this.posOf(m.soulId);
      const d = here && there ? Math.round(Math.hypot(here[0] - there[0], here[1] - there[1])) : null;
      const walk = caps.filter(c => c.verb === 'walk' && c.target && place && (c.target.id === place || this.p.places.byId.get(place)?.parent === c.target.id))[0];
      return {code: 'soul.not-in-sight', reason: `${m.name} is not in sight from here${pname ? ` (in ${pname}` + (d !== null ? `, ${d} m away)` : ')') : ''}; go to them first, then ${verb}.`, did_you_mean: walk ? [{id: walk.id, label: walk.label}] : []};
    };
    /** SOCIAL-APPROACH: a named Soul out of sight but awake in this world: offer the act with a walk over first. */
    const walkOver = (verb: string, name: string) => {
      if (!plans) return null; const m = this.farSoul(soul, name);
      if (!m || !this.approachCaps(soul, m.soulId, caps, plans)) return null;
      const c = caps.find(c => c.id === `${verb}:${m.soulId}`); return c ? {capability: c.id, note: `${text.trim()} is ${c.id} (walks over to ${m.name} first)`} : null;
    };
    // PERSON-GO: the same named, awake target allowed by social approach can be walked to directly.
    // Keep this on demand: perception does not list hidden bodies. Native walk_to still checks every route.
    const goToBody = (name: string) => {
      if (!plans) return null; const m = this.farSoul(soul, name); if (!m) return null;
      const id = 'go-near:' + m.soulId, label = `Go near ${m.name}`;
      if (!caps.some(c => c.id === id)) {
        caps.push({id, verb: 'go-near', label, target: {id: m.soulId, kind: 'soul'}, available: true});
        plans.set(id, {label, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: m.entityId, standoff: 1.3}}]});
      }
      return {capability: id, note: `${text.trim()} is ${id} (walks to ${m.name})`};
    };
    const exactGo = /^go-near:(s_[0-9a-f]+)$/.exec(text.trim());
    if (exactGo) return goToBody(exactGo[1]);
    const tooFar = (verb: string, o: NearbyBody) => {const g = caps.find(c => c.id === 'go-near:' + o.soulId); return {code: 'gesture.too-far', reason: `${o.name} is ${o.distance} m away; ${verb} needs you within ${GESTURE_RADIUS} m. Go near them first (go-near:${o.soulId}), then ask again.`, did_you_mean: [{id: 'go-near:' + o.soulId, label: g?.label ?? `Go near ${o.name}`}]};};
    // invitations to me
    const mine = this.invitesFor(soul.soulId);
    if (/^(?:accept|yes|sure|ok|okay|i accept|accept (?:the |their |his |her )?(?:invitation|invite|offer)|join (?:in|them|him|her)|with pleasure|gladly)$/.test(t) && mine.length) {const i = mine.at(-1)!; return {capability: 'accept:' + i.id, note: `accepting ${i.host.name}'s invitation (${i.what})`};}
    if (/^(?:decline|no|no thanks|no thank you|not now|decline (?:the |their )?(?:invitation|invite|offer)|refuse)$/.test(t) && mine.length) {const i = mine.at(-1)!; return {capability: 'decline:' + i.id, note: `declining ${i.host.name}'s invitation (${i.what})`};}
    if (!mine.length && /^(?:accept|decline|yes|no thanks|no thank you|accept (?:the |their )?(?:invitation|invite|offer)|decline (?:the |their )?(?:invitation|invite|offer))$/.test(t)) return {code: 'invite.none', reason: 'Nobody has invited you to anything right now (observe → invites).', did_you_mean: []};
    const acc = /^(?:accept|join)\s+(.+?)(?:['’]s)?(?:\s+(?:invitation|invite|offer|hug|dance))?$/.exec(t);
    if (acc && mine.length) {
      const name = acc[1].trim(), stale = this.p.host.soulNameRefusal(name);
      if (stale) return {code: stale, reason: 'That previous Soul name is unavailable or ambiguous; use the current name and immutable Soul ID.', did_you_mean: []};
      // A personal pending invitation identifies its sender even after they leave sight. Use current metadata,
      // not an old invitation label, and never choose between two senders with the same exact name.
      const named = mine.filter(i => i.host.soulId === name || this.mindOf(i.host.soulId)?.name.toLowerCase() === name);
      if (new Set(named.map(i => i.host.soulId)).size > 1) return {code: 'soul.name-ambiguous', reason: 'More than one inviter has that name; accept the exact invitation ID.', did_you_mean: []};
      const o = named.length ? null : who(acc[1]), i = named.at(-1) ?? (o ? mine.filter(x => x.host.soulId === o.soulId).at(-1) : undefined);
      if (i) return {capability: 'accept:' + i.id, note: `accepting ${i.host.name}'s invitation (${i.what})`};
    }
    // entry 35: hands and games in plain words. "take her hand" / "hold Ada's hand" answers an offered hand; with none
    // offered, "hold hands with Bea" / "offer Bea my hand" offers mine; "let go (of her hand)"; "withdraw my offer";
    // "play rock-paper-scissors with Bea" (the throw in params.shape)
    const handOffer = (from?: string) => {const o = from ? who(from) : null; return mine.filter(x => x.what === 'hold-hands' && (!o || x.host.soulId === o.soulId)).at(-1);};
    const take = /^(?:take|hold|grab|accept|clasp)\s+(?:(?:her|his|their|the)\s+hand|(.+?)['’]s\s+hand|hands?\s+with\s+(.+)|(.+?)\s+by\s+the\s+hand)$/.exec(t);
    if (take) {const from = take[1] ?? take[2] ?? take[3], i = handOffer(from); if (i) return {capability: 'accept:' + i.id, note: `taking ${i.host.name}'s hand`};}
    const offerHand = /^(?:offer|give|hold\s+out)\s+(?:my\s+hand\s+to\s+(.+)|(.+?)\s+(?:my|a)\s+hand(?:\s+to\s+hold)?)$/.exec(t) ?? /^(?:hold|take|grab)\s+(?:hands\s+with\s+(.+)|(.+?)['’]s\s+hand)$/.exec(t) ?? /^(?:ask\s+(.+?)\s+to\s+hold\s+hands|hold\s+hands\s+with\s+(.+))$/.exec(t);
    if (offerHand) {
      const name = (offerHand[1] ?? offerHand[2] ?? '').trim();
      const o = name ? who(name) : null; if (!o) return name ? walkOver('hold-hands', name) ?? notHere('hold hands', name) : null;
      const back = this.reciprocal(soul.soulId, o.soulId, 'hold-hands'); if (back) return {capability: 'accept:' + back.id, note: `${o.name} already offered a hand; taking it`};
      const c = capFor('hold-hands', o); if (!c) return tooFar('hold hands', o);
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    if (/^(?:let\s+go|release|drop|let\s+go\s+of\s+(?:(?:her|his|their|the|my)\s+)?hands?|let\s+go\s+of\s+.+?(?:['’]s\s+hand)?|let\s+(?:her|his|their|.+?['’]s)\s+hand\s+go|stop\s+holding\s+hands(?:\s+with\s+.+)?|release\s+(?:her|his|their|.+?['’]s)\s+hand|drop\s+(?:her|his|their|.+?['’]s)\s+hand)$/.test(t) && caps.some(c => c.id === 'let-go:here'))
      return {capability: 'let-go:here', note: `${raw} is let-go:here`};
    if (/^(?:withdraw|take\s+back|cancel|retract)\s+(?:my|the)\s+(?:offer|invitation|hand)(?:\s+to\s+.+)?$/.test(t)) {
      const c = caps.filter(c => c.verb === 'withdraw').at(-1); if (c) return {capability: c.id, note: `${raw} is ${c.id}`};
      return {code: 'invite.none', reason: 'You have no open offer to withdraw.', did_you_mean: []};
    }
    const rps = /^(?:play\s+)?(?:a\s+(?:game|round)\s+of\s+)?(?:rock[-\s,]*paper[-\s,]*scissors?|rps|roshambo)\s+(?:with|against)\s+(.+)$/.exec(t) ?? /^(?:challenge|ask)\s+(.+?)\s+(?:to\s+)?(?:a\s+game\s+of\s+)?(?:play\s+)?(?:rock[-\s,]*paper[-\s,]*scissors?|rps)$/.exec(t);
    if (rps) {
      const name = rps[1].trim(), o = who(name); if (!o) return walkOver('rps', name) ?? notHere('play rock-paper-scissors', name);
      const back = this.reciprocal(soul.soulId, o.soulId, 'rps'); if (back) return {capability: 'accept:' + back.id, note: `${o.name} already offered a game; accepting`};
      const c = capFor('rps', o); if (!c) return tooFar('play rock-paper-scissors', o);
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    // "take the book" / "take it" / "take X's flower" while someone offers me an item: accept that hand-over (never a pick-up elsewhere)
    const tk = /^(?:take|accept|receive|grab|get)\s+(?:it|that|this|(?:(.+?)['’]s\s+|the\s+|their\s+|his\s+|her\s+|an?\s+)?(.+?))(?:\s+from\s+(.+))?$/.exec(t);
    if (tk && mine.some(x => x.kind === 'give')) {
      const from = tk[1] ?? tk[3], o = from ? who(from) : undefined, what = tk[2]?.replace(/^(?:the|a|an)\s+/, '');
      const i = mine.filter(x => x.kind === 'give' && (!o || x.host.soulId === o.soulId) && (!what || x.item?.kind === what || x.item?.name.toLowerCase().includes(what) || !!x.thing && x.thing.name.toLowerCase().includes(what) || what === 'gift' || what === 'offer')).at(-1);
      if (i) return {capability: 'accept:' + i.id, note: `taking ${i.item?.name ?? (i.thing ? 'the ' + i.thing.name : 'the item')} ${i.host.name} offers you`};
      const askedKind = what ? ITEM_WORDS.find(([, re]) => re.test(' ' + what + ' '))?.[0] : undefined, offered = mine.filter(x => x.kind === 'give' && (!o || x.host.soulId === o.soulId)).at(-1);
      if (!i && offered && askedKind && !caps.some(c => c.verb === 'pick-up' && (c.id === 'pick-up:' + askedKind || this.item(c.target?.id ?? '')?.kind === askedKind)))
        return {code: 'give.other-item', reason: `${offered.host.name} offers you ${offered.item?.name ?? (offered.thing ? 'the ' + offered.thing.name : 'something')}, not ${ITEM_NAMES[askedKind]}.`, did_you_mean: [{id: 'accept:' + offered.id, label: `Accept: take ${offered.item?.name ?? 'it'} from ${offered.host.name}`}, {id: 'decline:' + offered.id, label: 'Decline'}]};
    }
    // gestures
    // SOUL3 SOCIAL: "wave to/at <Soul>" keeps its target — wave:<id> walks up and waves facing them (on demand when they
    // are beyond the listed caps, like go-near), never a solo wave:here from afar; any other name stays the facing target.
    const wv = /^(?:wave|say\s+(?:hi|hello))\s+(?:to|at)\s+(.+)$/.exec(t);
    if (wv && plans) {
      if (this.farTwins(soul, wv[1])) return {code: 'soul.name-ambiguous', reason: `More than one Soul is called ${wv[1].trim()}; use the exact Soul ID.`, did_you_mean: []};
      const o = who(wv[1]) ?? this.farSoul(soul, wv[1]), ob = o ? this.p.body(o.entityId) : undefined;
      if (o && ob) {
        const id = 'wave:' + o.soulId, label = `Wave to ${o.name}`;
        if (!caps.some(c => c.id === id)) {
          caps.push({id, verb: 'wave', label, target: {id: o.soulId, kind: 'soul'}, available: true});
          plans.set(id, {label, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.6}}, {verb: 'wave', params: {at: o.entityId, seconds: 0.5}}, {verb: 'mars:pose_v1', params: {activity: 'wave', seconds: 3}}]});
        }
        return {capability: id, note: `${raw} is ${id} (walks over to ${o.name} first)`};
      }
      // no awake Soul by that name: keep the target so act faces a real thing or refuses, never a bare wave:here
      const stale = this.p.host.soulNameRefusal(wv[1].trim().toLowerCase().replace(/^(?:to|with|at|the)\s+/, ''));
      if (stale) return {code: stale, reason: 'That previous Soul name is unavailable or ambiguous; use the current name and immutable Soul ID.', did_you_mean: []};
      return {capability: 'wave:here', params: {to: wv[1].trim()}, note: `${raw} is wave:here (to ${wv[1].trim()})`};
    }
    const G: [RegExp, string][] = [[/^(?:give\s+(.+?)\s+a\s+hug|hug|embrace|cuddle)\s*(.*)$/, 'hug'], [/^(?:give\s+(.+?)\s+a\s+high[- ]?five|high[- ]?five|hi[- ]?five)\s*(.*)$/, 'high-five'],
      [/^(?:shake\s+hands\s+with|shake\s+(.+?)['’]s\s+hand|handshake(?:\s+with)?|shake\s+hands)\s*(.*)$/, 'handshake'], [/^(?:dance\s+with|ask\s+(.+?)\s+to\s+dance|have\s+a\s+dance\s+with)\s*(.*)$/, 'dance-with']];
    for (const [re, verb] of G) {
      const m = re.exec(t); if (!m) continue;
      const name = (m[1] ?? m[2] ?? '').trim();
      if (name && this.farTwins(soul, name)) return {code: 'soul.name-ambiguous', reason: `More than one Soul is called ${name}; use the exact Soul ID.`, did_you_mean: []};
      const o = name ? who(name) : near.filter(x => x.distance <= GESTURE_RADIUS).length === 1 ? near[0] : null;
      if (!o) return name ? walkOver(verb, name) ?? notHere(verb, name) : {code: 'capability.unknown', reason: `Say who: "${verb} <name>".`, did_you_mean: caps.filter(c => c.verb === verb).slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const back = this.reciprocal(soul.soulId, o.soulId, verb); if (back) return {capability: 'accept:' + back.id, note: `${o.name} already offered ${verb}; accepting`};
      const c = capFor(verb, o); if (!c) return tooFar(verb, o);
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    const solo = /^(bow|clap|applaud|nod|shake\s+(?:my|your)\s+head|shake[- ]head|cheer|point)(?:\s+(?:to|at|for|towards|toward)\s+(.+))?$/.exec(t);
    if (solo) {
      const verb = solo[1] === 'applaud' ? 'clap' : /shake/.test(solo[1]) ? 'shake-head' : solo[1], target = solo[2]?.trim();
      if (!target) return {capability: verb + ':here', note: `${raw} is ${verb}:here`};
      return {capability: verb + ':here', params: verb === 'point' ? {at: target} : {to: target}, note: `${raw} is ${verb}:here (${verb === 'point' ? 'at' : 'to'} ${target})`};
    }
    // stop / unfollow: stand:here ends whatever the body is doing, a follow or walk-with included
    if (/^(?:stop|halt|stand still|unfollow(?:\s+.+)?|stop\s+(?:that|it|everything|moving|walking|what\s+(?:i\s+am|i'm|you\s+are|you're)\s+doing)|(?:stop|quit)\s+(?:following|walking\s+with|tagging\s+along\s+with|going\s+with|accompanying)(?:\s+.+)?)$/.test(t) && caps.some(c => c.id === 'stand:here'))
      return {capability: 'stand:here', note: `${raw} is stand:here (stops what you are doing, a follow included)`};
    // "go to <Soul>", "find <Soul>": walk over to a Soul by name (a place of the same words is left to the place resolver)
    const goto = /^(?:(?:(?:go|walk|run|head|come|get|wander)\s+)?(?:over\s+|back\s+)?(?:to|near|towards?|up\s+to|next\s+to)|find|approach|meet|join|catch\s+up\s+with)\s+(.+)$/.exec(t);
    if (goto) {
      const w = goto[1].trim().replace(/^the\s+/, ''), named = (n: string) => n.toLowerCase() === w || (tokens(n).length > 0 && tokens(n).every(x => tokens(w).includes(x)));
      const o = near.find(o => o.soulId === w || named(o.name));
      if (o) {const c = caps.find(c => c.id === 'go-near:' + o.soulId); if (c) return {capability: c.id, note: `${raw} is ${c.id}`};}
      else if ([...this.p.host.minds.values()].some(x => x.soulId !== soul.soulId && (x.soulId === w || named(x.name)))) return goToBody(goto[1]) ?? notHere('meet them', goto[1]);
    }
    // follow / walk with
    const fol = /^(?:follow|walk\s+with|go\s+with|accompany|tag\s+along\s+with|come\s+with)\s+(.+)$/.exec(t);
    if (fol && !/^(?:me|us)$/.test(fol[1].trim())) {
      if(/\s+to\s+\S/.test(fol[1])&&!near.some(o=>o.name.toLowerCase()===fol[1].trim()))return {code:'follow.destination',reason:'Following only tracks the named Soul. To reach a place, walk with them to that place and invite them.',did_you_mean:[]};
      const o = who(fol[1]); if (!o) return /^(?:him|her|them|they|she|he)$/.test(fol[1].trim()) ? null : notHere('follow', fol[1]);
      const back = this.invitesFor(soul.soulId).find(i => i.host.soulId === o.soulId && i.kind !== 'paired' && i.kind !== 'give' && i.kind !== 'shared'); if (back) return {capability: 'accept:' + back.id, note: `joining ${o.name}'s ${back.what}`};
      if (this.followingOf(soul.soulId)?.target === o.soulId) return {code: 'follow.already', reason: `You are already walking with ${o.name}.`, did_you_mean: []};
      const c = capFor('follow', o); if (!c) return {code: 'follow.unavailable', reason: `${o.name} is too far away to walk with (${o.distance} m); go near them first.`, did_you_mean: caps.filter(c => c.id === 'go-near:' + o.soulId).map(c => ({id: c.id, label: c.label}))};
      return {capability: c.id, note: `${raw} is ${c.id}`};
    }
    // items
    const held = this.heldBy(soul.soulId);
    const give = /^(?:give|hand|pass|offer)\s+(.+?)\s+(?:the\s+|my\s+|this\s+|a\s+|an\s+)?(?:book|flower|flowers|cup|tea|coffee|food|snack|letter|tool|frisbee|it|this|that|thing)$/.exec(t) ?? /^(?:give|hand|pass|offer)\s+(?:the\s+|my\s+|this\s+|a\s+|an\s+)?(?:\w+\s+)?(?:to)\s+(.+)$/.exec(t) ?? /^(?:give|hand|pass)\s+(?:it|this|that)\s+to\s+(.+)$/.exec(t);
    if (give) {
      // a world may offer its own give for what is in the hand (a god-built thing: god/held.ts)
      if (!held && !caps.some(c => c.verb === 'give')) return {code: 'hands.empty', reason: 'You are not holding anything to give; pick something up first.', did_you_mean: caps.filter(c => c.verb === 'pick-up').slice(0, 5).map(c => ({id: c.id, label: c.label}))};
      const o = who(give[1]); if (!o) return walkOver('give', give[1]) ?? notHere('give', give[1]);
      const said = ITEM_WORDS.find(([, re]) => re.test(' ' + t + ' '))?.[0];
      if (held && said && said !== held.kind) {const g = capFor('give', o); return {code: 'item.not-held', reason: `You are holding ${held.name}, not ${ITEM_NAMES[said]}; you can give ${held.name}, or put it down and pick up ${ITEM_NAMES[said]} first.`, did_you_mean: [...(g ? [g] : []), ...caps.filter(c => c.id === 'put-down:here')].map(c => ({id: c.id, label: c.label}))};}
      const c = capFor('give', o); if (!c) return tooFar('give', o);
      return {capability: c.id, note: `${raw} is ${c.id}${held ? ` (${held.name})` : ''}`};
    }
    if (/^(?:put\s+(?:it|this|that|the\s+\w+|my\s+\w+)\s+down|put\s+down(?:\s+.*)?|drop(?:\s+.*)?|set\s+(?:it|.+)\s+down|leave\s+(?:it|the\s+\w+)\s+here|put\s+(?:it|the\s+\w+)\s+back)$/.test(t)) {
      if (!held) return {code: 'hands.empty', reason: 'You are not holding anything.', did_you_mean: []};
      return {capability: 'put-down:here', note: `${raw} is put-down:here (${held.name})`};
    }
    if (held && ((held.kind === 'food' && /^(?:eat|have|finish)\b/.test(t) && (/\b(?:it|this|that|food|snack|bread|apple|cake)\b/.test(t) || t === 'eat')) || (held.kind === 'cup' && /^(?:drink|sip|have|finish)\b/.test(t) && (/\b(?:it|this|that|tea|coffee|cup|drink)\b/.test(t) || t === 'drink'))))
      return {capability: (held.kind === 'food' ? 'eat' : 'drink') + ':held', note: `${raw}: ${held.name} you are holding`};
    const pick = /^(?:pick\s+up|take|grab|get|fetch|collect|pluck|borrow)\s+(?:me\s+)?(?:(?:a|an|some|the|one)\s+)?(.+)$/.exec(t);
    if (pick && !/^(?:a\s+)?(?:walk|stroll|nap|seat|rest|break|swim|ride|look|dip|turn|picture|down\s|on\s)/.test(pick[1]) && !/\b(?:read|reading|write|writing)\b/.test(pick[1])) {
      const what = pick[1], kind = ITEM_WORDS.find(([, re]) => re.test(' ' + what + ' '))?.[0];
      if (kind) {
        if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down or give it away first.`, did_you_mean: caps.filter(c => c.id === 'put-down:here' || c.verb === 'give').slice(0, 4).map(c => ({id: c.id, label: c.label}))};
        const lying = caps.filter(c => c.verb === 'pick-up' && c.target?.kind === 'item' && this.item(c.target.id)?.kind === kind)[0];
        const c = lying ?? caps.find(c => c.id === 'pick-up:' + kind);
        // entry 43: a world thing of that word lying near (a god-built mug) when no prop of the kind is: the one called
        // exactly that first, then one whose name has the word, nearest first (labels end "(N m)")
        const named = !c ? caps.filter(c => c.verb === 'pick-up' && c.target?.kind === 'item' && /^e_/.test(c.target.id)).map(c => {const n = (c.label.replace(/^Pick up\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').split('/').pop() ?? '').toLowerCase(), d = Number(/\(([\d.]+) m/.exec(c.label)?.[1] ?? 99);
          const w = what.replace(/^(?:the|a|an|my|that|this)\s+/, '').trim(); return {c, rank: n === w ? 0 : new RegExp(`(^|[^a-z])${w.replace(/[^a-z ]/g, '')}([^a-z]|$)`).test(n) ? 1 : 9, d};}).filter(x => x.rank < 9).sort((a, b) => a.rank - b.rank || a.d - b.d)[0]?.c : undefined;
        if (!c && named) return {capability: named.id, note: `${raw} is ${named.id} (${named.label})`};
        if (!c) {
          const me = this.posOf(soul.soulId), far = me ? this.sources().filter(s => s.kind === kind && s.place).map(s => ({s, d: Math.hypot(s.at[0] - me[0], s.at[1] - me[1])})).sort((a, b) => a.d - b.d) : [];
          const hit = far.map(f => ({f, w: caps.find(c => c.verb === 'walk' && c.target && (c.target.id === f.s.place || this.p.places.byId.get(f.s.place!)?.parent === c.target.id))})).find(x => x.w), walk = hit?.w;
          return {code: 'item.none-near', reason: `There is no ${kind} to pick up within ${ITEM_LIMITS.pickReach} m${hit ? `; the nearest is ${hit.f.s.label}, ${Math.round(hit.f.d)} m away: walk there first` : ''}.`, did_you_mean: [...(walk ? [walk] : []), ...caps.filter(c => c.verb === 'pick-up').slice(0, walk ? 3 : 5)].map(c => ({id: c.id, label: c.label}))};
        }
        return {capability: c.id, note: `${raw} is ${c.id} (${c.label})`};
      }
    }
    // "<activity> with <names>", "invite <names> to <activity>", "go for a balloon ride with X", "join me ..." is said by the host
    const t0 = raw.toLowerCase().replace(/[!?.]+$/, '').replace(/^(?:please|ok|okay|sure)\s+/, '').trim();
    const inv = /^invite\s+(.+?)\s+(?:to|for|on)\s+(.+)$/.exec(t0);
    const withm = inv ? null : /^(.+?)\s+(?:together with|along with|with)\s+(?!me\b)(.+)$/.exec(t0);
    const names = inv ? inv[1] : withm?.[2], activity = inv ? inv[2] : withm?.[1];
    if (names && activity && !/^(?:walk|go|stroll|come)$/.test(activity.trim())) {
      const list = names.split(/\s*(?:,|\band\b|&)\s*/).map(x => x.trim()).filter(Boolean), souls = list.map(n => who(n) ?? this.farSoul(soul, n));
      if (souls.length && souls.every(Boolean)) return {capability: '', rest: activity.replace(/^(?:me\s+)?(?:to\s+)?/, '').replace(/^(?:let'?s|lets)\s+/, '').trim(), params: {with: [...new Set(souls.map(o => o!.soulId))]}, note: `inviting ${souls.map(o => o!.name).join(', ')}`};
    }
    // "come read with me", "let's dance", "join me on the balloon": whoever I am talking with, close by
    const us = /^(?:join me|let'?s|lets|shall we)\s+(.+?)(?:\s+with me)?$/.exec(t0) ?? /^(?:come\s+(?:and\s+)?)?(.+?)\s+with me$/.exec(t0);
    if (us) {
      const partners = this.conversationPartners(soul.soulId).map(id => near.find(o => o.soulId === id)).filter((o): o is NearbyBody => !!o && o.distance <= FOLLOW_RADIUS);
      if (partners.length) return {capability: '', rest: us[1].replace(/^(?:on|to|for|in)\s+/, '').trim(), params: {with: partners.map(o => o.soulId)}, note: `inviting ${partners.map(o => o.name).join(', ')} (you are talking with them)`};
    }
    return null;
  }
  private conversationPartners(soulId: string): string[] {
    try {
      const out: string[] = [];
      for (const r of this.p.db.db.prepare("SELECT body FROM edge_comms_conversations WHERE world_id=? AND state='open'").all(this.p.host.worldId) as {body: string}[]) {
        const ids = (JSON.parse(r.body) as {members?: {soulId: string}[]}).members?.map(m => m.soulId) ?? [];
        if (ids.includes(soulId)) out.push(...ids.filter(x => x !== soulId));
      }
      return out;
    } catch {return [];}
  }
}
