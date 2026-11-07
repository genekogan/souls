import {afterCommit, tx} from '../comms/store.ts';
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
import {bodyVerbProblem,isRigidBody} from '../body/actions.ts';
import type {Program} from '@souls/engine-contract';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldHost} from '../../world.ts';
import type {Db} from '../../db.ts';
import {EdgeError, type EdgeCapability, type EdgeReceipt, type EdgeSoul, type NearbyBody} from '../contract.ts';
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
  | {kind: 'hand-over'; guest: string; item: string; name: string; approach?: boolean; custodyPolicy?: 'same-tick-v1'}
  | {kind: 'accept'; invite: string}
  | {kind: 'decline'; invite: string}
  | {kind: 'withdraw'; invite: string}
  | {kind: 'let-go'}
  | {kind: 'follow'; target: string}
  | {kind: 'unfollow'; follower: string}
  | {kind: 'item'; op: 'pick-up' | 'put-down' | 'consume'; item?: string; source?: string; itemKind?: string}
  /** PC04 (#683): propose one shared physical operation; the first template carries a loose `shared-carry` load */
  | {kind: 'shared'; load: string; def: string; name: string; crew: [number, number]; mass?: {kg: number; each: number}; template?: 'raise-hold' | 'connect-beam' | DeckTemplate; bays?: BeamBayTag[]; choices?: SeatChoiceTag[]};
/** PC14 (#693): a seat pair a beam lying here can go into (engine-mars beamBays), with the two uprights' names. */
export type BeamBayTag = {a: string; b: string; seats: [string, string]; column: 'l' | 'r'; height: number; names: [string, string]};
/** PC15 (#694): the deck templates: a joist set across a bay onto its beams, a sheet laid across five joists. */
export type DeckTemplate = 'install-joist' | 'lay-sheet' | 'install-flight';
/** PC15 (#694): one place a joist or sheet lying here can go (engine-mars joistBays / sheetBays): the engine step's
 *  params, where along the bay (a joist, metres from its middle) and how the destination reads. */
export type SeatChoiceTag = {verb: 'install_joist_v1' | 'lay_sheet_v1' | 'install_flight_v1'; params: Record<string, unknown>; at?: number; name: string};
const DECK_WORDS: Record<DeckTemplate, {verb: string; ing: string; op: string; cap: string}> = {'install-joist': {verb: 'set', ing: 'setting', op: 'joist setting', cap: 'install-joist-with'}, 'lay-sheet': {verb: 'lay', ing: 'laying', op: 'sheet laying', cap: 'lay-sheet-with'}, 'install-flight': {verb: 'set', ing: 'setting', op: 'stair setting', cap: 'install-flight-with'}};
const deckOf = (s: {template: {id: string}}): DeckTemplate | undefined => s.template.id === 'install-joist' || s.template.id === 'lay-sheet' || s.template.id === 'install-flight' ? s.template.id : undefined;
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
/** PC11 (#690): names as a reader says them: "Bo", "Bo and Cy", "Ada, Bo and Cy". */
export const listed = (names: string[]): string => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
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
/** PC13 (#692): a session that raises its load and holds it, rather than carrying it to a place. */
const raises = (s: {template: {id: string}}): boolean => s.template.id === 'raise-hold';
/** PC14 (#693): a session that seats a beam between two uprights. */
const seats = (s: {template: {id: string}}): boolean => s.template.id === 'connect-beam' || !!deckOf(s);
const opWord = (inv: {shared?: {template: {id: string}}}): string => inv.shared && raises(inv.shared) ? 'raise' : inv.shared && deckOf(inv.shared) ? DECK_WORDS[deckOf(inv.shared)!].op : inv.shared && seats(inv.shared) ? 'beam seating' : 'carry';
/** What the crew does, as a verb phrase ("carry X to P", "raise X and hold it", "seat X between A and B, …"). */
const doing = (s: SharedSession): string => raises(s) ? `raise ${s.load.name} and hold it` : deckOf(s) ? `${DECK_WORDS[deckOf(s)!].verb} ${s.load.name} ${s.destination.name}` : seats(s) ? `seat ${s.load.name} ${s.destination.name}` : `carry ${s.load.name} to ${s.destination.name}`;
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** PC04 (#683): how long a shared proposal stays open (s). */
export const SHARED_LAPSE = 120;
/** PC05 (#684, PC02 §1): a member is ready only on level 0 within this distance of the load (m); the native gather walks the rest. */
export const SHARED_GATHER_RADIUS = 10;
/** PC06 (#685): native carry planner answers about the formation's route or where the load would be laid, which the
 *  proposal is refused with before anyone is asked (`sharedRoute` says what is left to the commit). */
const SHARED_VERBS = new Set(['carry', 'raise_hold_v1', 'connect_beam_v1', 'install_joist_v1', 'lay_sheet_v1', 'install_flight_v1']);
const SHARED_RAISE_REFUSED = new Set(['raise.arc-blocked', 'raise.station-blocked', 'raise.station-unreachable', 'raise.not-lying', 'raise.joined', 'raise.not-loose']);
/** PC14 (#693): what the native beam plan refuses before anyone is asked (not bodies: someone busy waits for the commit). */
const SHARED_BEAM_REFUSED = new Set(['beam.misaligned', 'beam.seat-taken', 'beam.no-seat', 'beam.not-staged', 'beam.not-beam', 'beam.not-upright', 'beam.upright-not-standing', 'beam.upright-unsupported', 'beam.station-unreachable', 'reach.too-high', 'lift.path-blocked']);
const SHARED_ROUTE_REFUSED = new Set(['carry.no-route', 'carry.clearance', 'carry.target-blocked', 'carry.pickup-blocked']);
/** PC07 (#686): a native hold-up shorter than this is part of ordinary motion; one that lasts this long is reported as
 *  `lasting` (the crew still holds the load: nobody lets go on a timeout, PC02 §3). Ticks at 20 Hz. */
const SHARED_BLOCK_TICKS = 10, SHARED_LASTING_TICKS = 600;
/** PC07: the closed hold-up intervals an operation keeps (the most recent; a long carry in a crowd stays bounded). */
const SHARED_BLOCKS_KEPT = 20;
/** An engine id (an entity, or its part as `<id>#<part>`) never reaches a Soul's words: a blocker without a label is unnamed. */
const RAW_ID = /#|^[a-z]{1,3}_[0-9a-z]{6,}$/i;
const named = (label: unknown): string | null => typeof label === 'string' && label && !RAW_ID.test(label) ? label : null;
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
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
  /** PC05: `committed` is a shared operation that started; the expiry sweep and `pending()` never see it. */
  createdTick: number; expiresTick: number; state: 'pending' | 'closed' | 'committed'; responses: Record<string, 'accepted' | 'declined' | 'expired' | 'cancelled' | 'left'>;
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
  thing?: {id: string; name: string}; custodyPolicy?: 'same-tick-v1';
  /** PC04 (#683): the shared operation this invitation proposes (kind 'shared'). */
  shared?: SharedSession};
/** PC04 (#683, docs/design/shared-execution.md §1): a shared physical operation, held in its together invitation's body.
 *  `revision` bumps on any material change (load, destination, crew); each member accepts their own role against it, and
 *  a bump clears every acceptance. `op` stays null until a commit (PC05). */
export type SharedSession = {template: {id: 'carry' | 'raise-hold' | 'connect-beam' | DeckTemplate; version: 1}; revision: number; load: {entity: string; def: string; name: string};
  destination: {place: string; name: string}; roles: {role: 'carrier'; slot: number; soulId: string | null}[]; crew: [number, number];
  cleanup: 'set-down-here' | 'lower-here'; op: SharedOp | null; changed?: string;
  /** PC14 (#693): the two uprights and their seats a `connect-beam` session seats its beam in. */
  beam?: {a: string; b: string; seats: [string, string]};
  /** PC15 (#694): the engine step a deck session commits (`install_joist_v1` / `lay_sheet_v1` and its params, crew added). */
  seat?: {verb: string; params: Record<string, unknown>; at?: number}};
/** PC05 (#684, PC02 §2): the running operation. Its id is a pure function of invitation and revision; `programId` is the
 *  host's engine programme and `eventSeq` the decision event that started it. Claims name what each member holds. */
export type SharedOp = {id: string; programId: string; eventSeq: number; committedTick: number; phase: 'started' | 'stopping' | 'blocked' | 'ended';
  claims: ({soulId: string; capabilities: ('hands' | 'locomotion')[]} | {entity: string; by: string})[];
  endedTick?: number; result?: SharedResult; code?: string;
  /** PC13 (#692): the tick a raised load first stood, held by the whole crew. */
  holding?: number;
  /** PC08 (#687, PC02 §3): a member asked to stop. `phase` is the native carry phase it was asked in; `unsafe` the native
   *  reason the spot under the load was not clear, while the crew carries on to the first clear spot. */
  stop?: SharedStop;
  /** PC07: the native hold-up while `phase` is `blocked`, the closed ones in `blocks`, and the replans to the same
   *  destination (`detours`); the load, crew and destination stay the committed revision. */
  blocked?: SharedBlock; blocks?: SharedBlock[]; detours?: number};
/** PC08 (#687, PC02 §2): how an operation ended. `stopped`: set down early after a stop (or nothing was lifted yet);
 *  `stopped-at-destination`: a stop was asked but the load was set down at the destination. */
export type SharedResult = 'arrived' | 'stopped' | 'stopped-at-destination' | 'ended';
/** `away` (PC09, #688): the stop is a member's fade, not an act of theirs (`receipt` is then empty). */
export type SharedStop = {by: string; name: string; tick: number; receipt: string; phase: string | null; unsafe?: string; away?: true};
/** PC07 (#686, PC02 §2): one interval in which the formation was held up, with the native code and the named blocker. */
export type SharedBlock = {code: string; fromTick: number; toTick?: number; blocker: string | null; lasting?: true};
/** What a shared receipt shows its own Soul (PC02 §5): the invitation, the revision it was made for, its role, the
 *  operation once committed, and the operation's phase. */
export type SharedReceiptV1 = {invite: string; revision: number; role: 'carrier'; slot: number | null; op?: string; holding?: true; phase: 'pending' | 'started' | 'stopping' | 'blocked' | 'ended'; result?: SharedResult;
  blocked?: SharedBlock; blocks?: SharedBlock[]; detours?: number; stop?: {by: string; name: string; tick: number; away?: true}};
/** PC06/PC07: a native carry diagnostic as the port gives it; `details` carries the planner's own numbers (`expanded`,
 *  `budget`, `exhausted`) and, for a route cut, the obstacle at the cut (`cutLabel` when it has a label). */
export type CarryIssue = {code: string; message?: string; subjects?: string[]; details?: Record<string, unknown>};
/** PC05: why a member (or the load) is not ready to commit yet. */
export type SharedBlocker = {soulId: string | null; name: string; why: string};
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
  /** The programme a body is running, read on the ledger's engine (this module never reaches the engine itself). */
  programOf(entityId: string): string | null;
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
  /** PC05 (#684): a member's receipt starts with the operation (the host's carries its programme). */
  start?(receiptId: string, programId: string | null): void;
  /** PC05: an open receipt's code and reason change (a commit blocker), its phase does not. */
  note?(receiptId: string, code: string | null, reason: string | null): void;
  /** PC05: every member is ready; try the atomic commit (the ledger's guarded decision). */
  commitShared?(inviteId: string): void;
  /** PC06 (#685): the native carry planner's answer for a crew carry, alone (no actor, programme or admission checks,
   *  nothing submitted): the refusal with its subjects, or null. Main only (the act path). */
  /** PC13 (#692): the native raise's own plan for this crew and load, nothing submitted. */
  previewRaise?(params: {crew: string[]; item: string}): {code: string; message?: string; subjects?: string[]} | null;
  /** PC14 (#693): the native beam plan for a crew and a seat pair, nothing submitted. */
  previewBeam?(params: {crew: string[]; beam: string; a: string; b: string; seats: [string, string]}): {code: string; message?: string; subjects?: string[]} | null;
  previewCarry?(params: {crew: string[]; item: string; to: {x: number; z: number; yaw: number}}): CarryIssue | null;
  /** PC15 (#694): the native deck plan (`install_joist_v1` / `lay_sheet_v1`) for a crew, nothing submitted. */
  previewSeat?(verb: string, params: Record<string, unknown>): {code: string; message?: string; subjects?: string[]} | null;
  /** PC07: the native action a programme is on (status, phase and the diagnostic of a hold-up), read on the ledger's engine. */
  carryState?(programId: string): ({status: string; verb?: string; phase?: string} & Partial<CarryIssue>) | null;
  /** PC10 (#689): stop exactly this programme safely (`edge-stop` naming it, `untilSafe`), logged; false when the clock
   *  is not running. Used only for a programme the restored world replays after its operation had ended. */
  stopOp?(hostEntity: string, programId: string, op: string, why: string): boolean;
  /** PC05: stop a Soul's running programme (best effort; the native carry sets its load down). */
  stopBody?(soul: EdgeSoul): void;
};

const pose = (activity: string, seconds: number, extra: Record<string, unknown> = {}) => ({verb: 'mars:pose_v1', params: {activity, seconds, ...extra}});
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A deterministic item source (sources()): a shelf, a writing desk or a walkable place by kind. */
type ItemSource = {id: string; kind: ItemKind; label: string; at: V2; face?: V2; place: string | null};
/** #435: how near (m) a real thing must be to come before a place's prop of the kind: the reach of a storage offer. */
const REAL_THING_NEAR = 8;
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
  /** PC05: the running shared operations (their load claims exclude a second commit for the same load). */
  private committed(): Invite[] {return (this.p.db.db.prepare("SELECT body FROM edge_invites_v1 WHERE world_id=? AND state='committed' ORDER BY created_at").all(this.p.host.worldId) as {body: string}[]).map(r => JSON.parse(r.body) as Invite);}
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
    if (verb !== 'give' && verb !== 'carry-with' && verb !== 'raise-with' && verb !== 'connect-beam-with' && verb !== 'install-joist-with' && verb !== 'lay-sheet-with' && verb !== 'install-flight-with' && !Object.hasOwn(PAIRED, verb)) return null;
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
      const to = listed(inv.guests.map(g => this.mindOf(g.soulId)?.name ?? g.name));
      add({id: 'withdraw:' + inv.id, verb: 'withdraw', label: `Withdraw your offer to ${to} (${this.offerWords(inv)})`, target: {id: inv.guests[0].soulId, kind: 'soul'}, available: true}, {label: 'Withdraw the offer', steps: [], together: {kind: 'withdraw', invite: inv.id}});
    }
    // PC08 (#687): a member of a running shared operation can ask to stop it (watching is empty while none runs)
    if (this.watching.size) for (const inv of this.committed()) {
      const op = inv.shared?.op; if (!op || op.phase === 'ended' || op.stop || !this.sharedMembers(inv).some(m => m.soulId === soul.soulId && m.receipt)) continue;
      add({id: `stop-carry:${op.id}`, verb: 'stop-carry', label: this.stopLabel(inv), target: {id: inv.shared!.load.entity, kind: 'object'}, available: true}, {label: this.stopLabel(inv), steps: []});
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
  /** The partner's body profile applies to a paired act as the actor's does: a declared-profile partner (Pip, the centaur) has no admitted
   *  paired-gesture, hand-hold or hand-over adapter, so these are offered blocked and refused before acceptance, the
   *  same answer native admission gives (mars/viewer/engine/bodies/policy.ts). */
  private partnerBodyProblem(o: {name: string; entityId: string}, verb: string): {code: string; reason: string} | null {
    const issue = bodyVerbProblem(this.p.body(o.entityId), verb);
    return issue && !isRigidBody(this.p.body(o.entityId)) ? {code: issue.code, reason: `${o.name}'s body cannot ${verb}: ${issue.reason}`} : null;
  }
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
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : aloft ? {code: 'ride.aboard', reason: 'Not while riding.'} : this.partnerBodyProblem(o, g) ?? handsBusy;
      const steps: Steps = g === 'hold-hands'
        ? [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, {verb: 'mars:hand_hold_v1', params: {mode: 'join', partner: o.entityId, offer: true, waitSeconds: def.lapse + 5}}]
        : [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.1}}, pose(def.activity, def.seconds, {gap: def.gap, waitSeconds: 45, alone: 'fail', clear: true})];
      add({id: `${g}:${o.soulId}`, verb: g, label: far ? def.label(o.name).replace(/ \(.*\)$/, '') + then : def.label(o.name), target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {}), ...(g === 'dance-with' ? {params: {seconds: {type: 'integer', min: 5, max: 600, default: 60}}} : g === 'rps' ? {params: SHAPE_PARAM} : {})},
        {label: def.label(o.name).replace(/ \(.*\)$/, ''), seconds: g === 'dance-with', steps, together: {kind: 'paired', what: g, guest: o.soulId, ...(far ? {approach: true} : {})}});
    }
    // entry 41: a held world thing that opted in to hand-to-hand transfer (the lantern, the bowl) is handed over, not dropped
    const thing = held ? null : this.thingIn(soul.entityId);
    if (thing) {
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : aloft ? {code: 'ride.aboard', reason: 'Not while riding.'} : this.partnerBodyProblem(o, 'give') ?? (this.handsFull(o.soulId, o.entityId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : null);
      add({id: 'give:' + o.soulId, verb: 'give', label: `Give ${o.name} the ${thing.name} you are holding: ${far ? 'walks over to them first, then ' : ''}hold it out for them to take (they accept or decline)`, target: {id: o.soulId, kind: 'soul'}, available: !blocked, ...(blocked ? {blocked} : {})},
        {label: `Give ${o.name} the ${thing.name}`, steps: [...this.standFirst(soul.entityId), {verb: 'walk_to', params: {to: o.entityId, standoff: HANDOVER_GAP}}, {verb: 'mars:hand_over_v1', params: {mode: 'offer', partner: o.entityId, item: thing.id, waitSeconds: 40}}], together: {kind: 'hand-over', guest: o.soulId, item: thing.id, name: thing.name, custodyPolicy: 'same-tick-v1', ...(far ? {approach: true} : {})}});
    }
    if (held) {
      const blocked = busy ? {code: 'gesture.partner-unavailable', reason: `${o.name} is ${busy}.`} : this.partnerBodyProblem(o, 'give') ?? (this.heldBy(o.soulId) ? {code: 'hands.full', reason: `${o.name}'s hands are full.`} : null);
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
    const near = this.p.perceived(soul.soulId, INVITE_RADIUS), out: {soulId: string; name: string; entityId: string}[] = [];
    // PC11 (#690): a crew in ordinary words ("Bo and Cy", "Bo, Cy and Dee", "Bo & Cy") names each of them. A Soul whose
    // own name is the whole phrase is that one Soul: one nearby first, then the parts when every part is someone nearby,
    // then one farther away
    const said = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const parts = typeof raw === 'string' ? raw.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i).filter(x => x.trim()) : [];
    const nearPart = (x: string) => {const w = x.trim().toLowerCase(); return near.some(o => o.soulId === x.trim() || o.name.toLowerCase() === w);};
    const whole = !!said && (near.some(o => o.name.toLowerCase() === said)
      || !(parts.length > 1 && parts.every(nearPart)) && [...this.p.host.minds.values()].some(m => m.soulId !== soul.soulId && m.name.toLowerCase() === said));
    const list = typeof raw === 'string' ? (whole ? [raw] : parts) : raw;
    if (!Array.isArray(list) || !list.length || list.length > 6 || !list.every(x => typeof x === 'string' && x.trim() && x.length <= 100)) return {ok: false, code: 'capability.params', reason: 'with must be up to 6 Soul ids or names.'};
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
      const partner = this.partnerBodyProblem({name: g.name, entityId: g.entityId}, tag.kind === 'paired' ? tag.what : 'give'); if (partner) return partner;
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
    if (inv.shared) return raises(inv.shared) ? `raising ${inv.shared.load.name} together` : deckOf(inv.shared) ? `${DECK_WORDS[deckOf(inv.shared)!].ing} ${inv.shared.load.name} ${inv.shared.destination.name} together` : seats(inv.shared) ? `seating ${inv.shared.load.name} ${inv.shared.destination.name} together` : `carrying ${inv.shared.load.name} to ${inv.shared.destination.name} together`;
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
    const body = this.sharedBodyProblem(soul) ?? this.sharedTooFar(soul, tag.load, tag.name); if (body) return body;
    // PC13 (#692): raising has no destination: it stands where it lies, and comes down there
    const raising = tag.template === 'raise-hold', beaming = tag.template === 'connect-beam', deck = tag.template === 'install-joist' || tag.template === 'lay-sheet' || tag.template === 'install-flight' ? tag.template : undefined, along = deck === 'install-joist' || deck === 'install-flight';
    // PC15 (#694): a joist goes to the free position along the bay nearest the one asked, within 10 cm; a sheet onto its row of joists
    const choices = tag.choices ?? [], at = Number(params.at);
    const choice = along ? (Number.isFinite(at) ? choices.filter(c => Math.abs((c.at ?? 0) - at) <= 0.1).sort((x, y) => Math.abs((x.at ?? 0) - at) - Math.abs((y.at ?? 0) - at))[0] : undefined) : deck ? choices[0] : undefined;
    if (along && !choice) return {code: 'capability.params', reason: `Choose where along the ${deck === 'install-flight' ? 'beam' : 'bay'} ${tag.name} goes (at: metres from the ${deck === 'install-flight' ? 'beam' : 'bay'}'s middle): ${choices.map(c => (c.at ?? 0).toFixed(2)).join(', ')}.`};
    if (deck && !choice) return {code: 'capability.params', reason: `${tag.name} has no row of joists to be laid across here.`};
    // PC14 (#693): a beam goes into the seat pair its column and height name, between the two uprights there
    const bays = tag.bays ?? [], h = Number(params.height);
    // the free seat in that column nearest the height asked, within 8 cm (the native snapSeat's hole tolerance)
    const bay = beaming && Number.isFinite(h) ? bays.filter(b => b.column === params.column && Math.abs(b.height - h) <= 0.08).sort((x, y) => Math.abs(x.height - h) - Math.abs(y.height - h))[0] : undefined;
    if (beaming && !bay) return {code: 'capability.params', reason: `Choose a column and a seat height for ${tag.name}: ${[...new Set(bays.map(b => b.column))].map(c => `column ${c} at ${bays.filter(b => b.column === c).map(b => b.height.toFixed(2)).join(', ')} m`).join('; ')} (column, height).`};
    const to = raising ? {id: '', name: 'where it lies'} : choice ? {id: '', name: choice.name} : bay ? {id: '', name: `between ${bay.names[0]} and ${bay.names[1]}, in column ${bay.column} at ${bay.height.toFixed(2)} m`} : params.toPlace as {id: string; name: string} | undefined;
    if (!to) return {code: 'capability.params', reason: 'Choose a named place to carry it to (to).'};
    if (params.with === undefined) return {code: 'capability.params', reason: `Name who ${raising ? 'raises' : deck ? (deck === 'lay-sheet' ? 'lays' : 'sets') : beaming ? 'seats' : 'carries'} ${tag.name} with you (with: Soul names or ids).`};
    const w = this.withSouls(soul, params.with); if (!w.ok) return {code: w.code, reason: w.reason};
    const guests = w.souls.filter(g => g.soulId !== soul.soulId).map(g => ({soulId: g.soulId, name: g.name}));
    const crew = 1 + guests.length, [lo, hi] = tag.crew, names = listed(guests.map(g => g.name));
    // PC11 (#690): a load that needs more carriers by mass says the arithmetic (PC02 §4)
    const kg = tag.mass && lo > 1 && Math.ceil(tag.mass.kg / tag.mass.each) >= lo ? ` (${tag.mass.kg} kg; one person carries at most ${tag.mass.each} kg)` : '';
    if (raising && (!guests.length || crew < lo)) return {code: 'raise.crew-too-small', reason: `${tag.name} needs at least ${lo} people to raise it${kg}; ask ${Math.max(1, lo - 1)} Soul${lo - 1 > 1 ? 's' : ''} to raise it with you.`};
    if (raising && crew > hi) return {code: 'raise.crew-too-large', reason: `${tag.name} has room for at most ${hi} people to raise it; ask fewer Souls.`};
    if (deck && crew !== 2) return {code: deck === 'install-joist' ? 'joist.crew' : deck === 'install-flight' ? 'stair.crew' : 'plywood.crew', reason: `${cap1(DECK_WORDS[deck].ing)} ${tag.name} takes exactly two people, one at each end; ask ${crew < 2 ? 'one Soul' : 'only one Soul'} to ${DECK_WORDS[deck].verb} it with you.`};
    if (beaming && crew !== 2) return {code: 'beam.crew', reason: `Seating ${tag.name} takes exactly two people, one at each end; ask ${crew < 2 ? 'one Soul' : 'only one Soul'} to seat it with you.`};
    if (!guests.length || crew < lo) return {code: 'carry.crew-too-small', reason: `${tag.name} needs at least ${lo} carrier${lo > 1 ? 's' : ''}${kg}; ask ${Math.max(1, lo - 1)} Soul${lo - 1 > 1 ? 's' : ''} to carry it with you.`};
    if (crew > hi) return {code: 'carry.crew-too-large', reason: `${tag.name} takes at most ${hi} carriers; ask fewer Souls.`};
    const label = raising ? `Ask ${names} to raise ${tag.name} together and hold it` : deck ? `Ask ${names} to ${DECK_WORDS[deck].verb} ${tag.name} ${to.name} together` : beaming ? `Ask ${names} to seat ${tag.name} ${to.name} together` : `Ask ${names} to carry ${tag.name} to ${to.name} together`;
    if (params.invite !== undefined) {
      const inv = typeof params.invite === 'string' ? this.invite(params.invite) : null;
      if (!inv?.shared || inv.state !== 'pending' || inv.host.soulId !== soul.soulId) return {code: 'invite.gone', reason: 'That proposal is no longer open.'};
      const s = inv.shared, changes: string[] = [];
      if (s.load.entity !== tag.load) changes.push(`the load is now ${tag.name}`);
      if (s.destination.place !== to.id || s.destination.name !== to.name) changes.push(`the destination is now ${to.name}`);
      if (inv.guests.map(g => g.soulId).sort().join() !== guests.map(g => g.soulId).sort().join()) changes.push(`the crew is now ${soul.name} with ${names}`);
      // the same proposal again changes nothing: its host's receipt answers
      if (!changes.length) return {steps: [], existing: inv.hostReceipt ?? undefined};
      const route = raising ? this.sharedRaisePreview(soul, guests, tag) : choice ? this.sharedSeatPreview(soul, guests, tag, choice) : bay ? this.sharedBeamPreview(soul, guests, tag, bay) : this.sharedRoute(soul, guests, tag, to); if (route) return route;
      // the amend answers with the host's one shared receipt, never a new "carry-with completed" one (PC02 §2)
      return {steps: [], existing: inv.hostReceipt ?? undefined, label, commit: () => this.amendShared(inv.id, soul, cap.id, tag, to, guests, changes, bay, choice)};
    }
    const route = raising ? this.sharedRaisePreview(soul, guests, tag) : choice ? this.sharedSeatPreview(soul, guests, tag, choice) : bay ? this.sharedBeamPreview(soul, guests, tag, bay) : this.sharedRoute(soul, guests, tag, to); if (route) return route;
    const id = 'inv_' + randomUUID().slice(0, 12);
    return {steps: [], wait: true, label, detail: {sharedV1: {invite: id, revision: 1}}, commit: receipt => {
      const inv: Invite = {id, what: 'carry', kind: 'shared', host: {soulId: soul.soulId, name: soul.name}, guests, capability: cap.id, label: raising ? `asks you to raise ${tag.name} together and hold it` : deck ? `asks you to ${DECK_WORDS[deck].verb} ${tag.name} ${to.name} together` : beaming ? `asks you to seat ${tag.name} ${to.name} together` : `asks you to carry ${tag.name} to ${to.name} together`,
        createdTick: this.tick, expiresTick: this.tick + SHARED_LAPSE * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {},
        shared: {template: {id: raising ? 'raise-hold' : deck ?? (beaming ? 'connect-beam' : 'carry'), version: 1}, ...(bay ? {beam: {a: bay.a, b: bay.b, seats: bay.seats}} : {}), ...(choice ? {seat: {verb: choice.verb, params: choice.params, ...(choice.at !== undefined ? {at: choice.at} : {})}} : {}), revision: 1, load: {entity: tag.load, def: tag.def, name: tag.name}, destination: {place: to.id, name: to.name},
          roles: [{role: 'carrier', slot: 0, soulId: soul.soulId}, ...guests.map((_, i) => ({role: 'carrier' as const, slot: i + 1, soulId: null}))], crew: tag.crew, cleanup: raising ? 'lower-here' : 'set-down-here', op: null}};
      this.saveInvite(inv); this.announce(inv);
    }};
  }
  /** PC13 (#692): before anyone is asked, the native raise's own plan for this crew: an arc or stations with no room, a part
   *  that is not lying free. What is about bodies (someone busy) is left to the commit, which waits on it. */
  private sharedRaisePreview(soul: EdgeSoul, guests: {soulId: string; name: string}[], tag: Extract<Tag, {kind: 'shared'}>): {code: string; reason: string} | null {
    if (!this.p.previewRaise) return null;
    const crew = [soul.entityId, ...guests.map(g => this.mindOf(g.soulId)?.entityId)]; if (!crew.every((e): e is string => !!e)) return null;
    let issue: ReturnType<NonNullable<typeof this.p.previewRaise>>;
    try {issue = this.p.previewRaise({crew, item: tag.load});} catch {return null;}
    if (!issue || !SHARED_RAISE_REFUSED.has(issue.code)) return null;
    return {code: issue.code, reason: `${tag.name} cannot be raised here: ${this.raiseWhy(issue)}. Nobody was asked.`};
  }
  /** PC14 (#693): before anyone is asked, the native beam plan for this crew and seat pair: frames out of line, a seat taken
   *  or out of reach, the beam not under the bay, an upright nobody holds. A body that is busy is left to the commit. */
  private sharedBeamPreview(soul: EdgeSoul, guests: {soulId: string; name: string}[], tag: Extract<Tag, {kind: 'shared'}>, bay: BeamBayTag): {code: string; reason: string} | null {
    if (!this.p.previewBeam) return null;
    const crew = [soul.entityId, ...guests.map(g => this.mindOf(g.soulId)?.entityId)]; if (!crew.every((e): e is string => !!e)) return null;
    let issue: ReturnType<NonNullable<typeof this.p.previewBeam>>;
    try {issue = this.p.previewBeam({crew, beam: tag.load, a: bay.a, b: bay.b, seats: bay.seats});} catch {return null;}
    if (!issue || !SHARED_BEAM_REFUSED.has(issue.code)) return null;
    return {code: issue.code, reason: `${tag.name} cannot be seated there: ${this.beamWhy(issue, bay)}. Nobody was asked.`};
  }
  /** PC15 (#694): before anyone is asked, the native deck plan for this crew: a beam or joist that cannot carry it, a seat
   *  taken, the part not lying by the bay, no room to lift it. A body that is busy is left to the commit. */
  private sharedSeatPreview(soul: EdgeSoul, guests: {soulId: string; name: string}[], tag: Extract<Tag, {kind: 'shared'}>, choice: SeatChoiceTag): {code: string; reason: string} | null {
    if (!this.p.previewSeat) return null;
    const crew = [soul.entityId, ...guests.map(g => this.mindOf(g.soulId)?.entityId)]; if (!crew.every((e): e is string => !!e)) return null;
    let issue: ReturnType<NonNullable<typeof this.p.previewSeat>>;
    try {issue = this.p.previewSeat(choice.verb, {crew, ...choice.params});} catch {return null;}
    if (!issue || !/^(?:joist|plywood|stair|tread|reach|lift)\./.test(issue.code) || issue.code.endsWith('.crew')) return null;
    return {code: issue.code, reason: `${tag.name} cannot go there: ${this.beamWhy(issue)}. Nobody was asked.`};
  }
  /** What the native beam plan says, in words: it names parts by id, so the uprights are named as the Souls see them. */
  private beamWhy(st: {code: string; message?: string; subjects?: string[]}, bay?: {a: string; b: string; names?: [string, string]}): string {
    const who = (st.subjects ?? []).map(id => [...this.p.host.minds.values()].find(m => m.entityId === id)?.name).find(Boolean);
    if (who && st.code !== 'actor.holding') return `${who} is in the way`;
    let m = st.message ?? st.code;
    if (bay?.names) m = m.split(bay.a).join(bay.names[0]).split(bay.b).join(bay.names[1]);
    return this.namesIn(m);
  }
  /** A native message with the world's entity ids in it, with each thing's name in their place. */
  private namesIn(text: string): string {return text.replace(/\b[a-z]_[0-9a-f]{6,}\b/g, id => this.w.entities[id] ? this.thingName?.(id) ?? String((this.w.entities[id] as {label?: string}).label ?? id) : id);}
  /** What the native raise says is in the way, in words (it names a Soul's body by entity id). */
  private raiseWhy(st: {code: string; message?: string; subjects?: string[]}): string {
    // PC14 (#693): a joined upright is let go only once its frame stands on its own; the native rule names the missing beams
    if (st.code === 'support.release-premature') return `beams join it into a frame that does not stand on its own yet (${this.namesIn(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(st.message ?? '')?.[1] ?? 'more beams are needed')})`;
    const who = (st.subjects ?? []).map(id => [...this.p.host.minds.values()].find(m => m.entityId === id)?.name).find(Boolean);
    if (who) return `${who} is in the way`;
    const meets = /(?:it meets|blocked by) ([^(]+?)(?: \(|$)/.exec(st.message ?? '')?.[1];
    return meets ? `${meets} is in the way` : st.code === 'raise.station-unreachable' ? 'there is no way to the places the crew must stand' : st.code === 'raise.not-lying' ? 'it is not lying flat on the ground' : st.code === 'raise.joined' ? 'it is joined into a frame' : (st.message ?? st.code);
  }
  /** PC06 (#685, PC02 §4) route preflight, before anyone is asked: the native carry planner alone (the same `mars:carry`
   *  the commit submits, without its actor and programme checks, so a guest busy with something else does not hide the
   *  answer) plans the whole crew's carry of the load to the place. A refusal about the route or the set-down (no route
   *  for the formation, `carry.no-route` / `carry.clearance`; the load cannot be laid down there, `carry.target-blocked`)
   *  refuses the proposal with the planner's code and named blocker. Not here: people (they are not obstacles to the
   *  planner) and a loose thing lying on the ground where the load would go (it can be moved; the commit waits on it,
   *  PC05). The planner names only its first overlap, so a loose thing reported before a wall leaves both to the commit. The crew's
   *  positions only choose between `clearance` and `no-route`. Nothing is submitted and nothing moves. */
  private sharedRoute(soul: EdgeSoul, guests: {soulId: string; name: string}[], tag: Extract<Tag, {kind: 'shared'}>, to: {id: string; name: string}): {code: string; reason: string} | null {
    const members = [{entityId: soul.entityId, name: soul.name}, ...guests.map(g => ({entityId: this.mindOf(g.soulId)?.entityId, name: g.name}))];
    if (!members.every((m): m is {entityId: string; name: string} => !!m.entityId) || !this.p.previewCarry) return null;
    const step = this.sharedCarryStep(members.map(m => m.entityId), tag.load, to.id); if (!step) return null;
    let issue: ReturnType<NonNullable<typeof this.p.previewCarry>>;
    try {issue = this.p.previewCarry(step.params as {crew: string[]; item: string; to: {x: number; z: number; yaw: number}});} catch {return null;}   // the commit's own check stays the authority
    if (!issue || !SHARED_ROUTE_REFUSED.has(issue.code)) return null;
    // PC07: a planner search that stopped at its pose budget did not prove there is no way (its closest try is still named)
    const searched = num(issue.details?.expanded), budget = num(issue.details?.budget);
    const exhausted = (issue.code === 'carry.no-route' || issue.code === 'carry.clearance') && searched !== null && budget !== null && searched > budget;
    // the planner names the load itself first, and a thing's part as `<id>#<part>`
    if (issue.code === 'carry.target-blocked' && (issue.subjects ?? []).some(id => {const e = id.split('#')[0], x = this.w.entities[e] as {kind?: string; support?: {kind: string}} | undefined; return e !== tag.load && x?.kind === 'component' && x.support?.kind === 'ground';})) return null;
    // the planner's named blocker (its own message names the def by its description and bodies by entity id)
    const blk = named(/(?:intersect|overlap|blocked by) '([^']+)'/.exec(issue.message ?? '')?.[1]), n = members.length;
    const why = issue.code === 'carry.target-blocked' ? `${tag.name} cannot be laid down in ${to.name}${blk ? ` (it would overlap ${blk})` : ''}`
      : issue.code === 'carry.pickup-blocked' ? `${n} people cannot take hold of ${tag.name} where it lies: there is no room to stand at its grips${blk ? ` (${blk} is in the way)` : ''}`
      : `${n} people carrying ${tag.name} cannot get it to ${to.name}${blk ? ` (the carrying formation would hit ${blk})` : ''}${issue.code === 'carry.clearance' ? '; each could walk there alone' : ''}`;
    if (exhausted) return {code: 'carry.search-exhausted', reason: `The carry planner searched ${searched} poses without finding a way, so as far as it got: ${why}. That does not prove there is no way, but nobody was asked; choose a nearer or more open place.`};
    return {code: issue.code, reason: `${why}. Nobody was asked; ${issue.code === 'carry.pickup-blocked' ? 'choose another load' : 'choose another place'}.`};
  }
  /** The native crew `carry` of a shared operation: the crew in slot order lay the load down at the place's centre. */
  private sharedCarryStep(crew: string[], load: string, placeId: string): Steps[number] | null {
    const place = this.p.places.byId.get(placeId), x = this.w.entities[load]; if (!place?.polygon?.length || !x) return null;
    const at = centroid(place.polygon);
    // PC11 (#690): the load lies down along its own axis, either way round (a loose box turned half a turn has the same
    // footprint), whichever is nearer the way it travels, so the crew never turns it half a turn while setting it down; the
    // yaw is wrapped (the native carry takes one within ±7 rad) for a load placed at any turn
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)), yaw = wrap(x.pose.yaw ?? 0), way = Math.atan2(at[1] - x.pose.p[2], at[0] - x.pose.p[0]);
    const flip = wrap(yaw + Math.PI), near = Math.abs(wrap(flip - way)) < Math.abs(wrap(yaw - way)) ? flip : yaw;
    // PC07 (#686): a shared carry opts in to the held, named route cut (actions.ts holdCutV1)
    return {verb: 'mars:carry', params: {crew, item: load, to: {x: at[0], z: at[1], yaw: near}, holdCutV1: true}};
  }
  /** PC02 §1 amend: a new revision clears every acceptance; whoever had accepted is told by their own receipt. */
  private amendShared(id: string, soul: EdgeSoul, capability: string, tag: Extract<Tag, {kind: 'shared'}>, to: {id: string; name: string}, guests: {soulId: string; name: string}[], changes: string[], bay?: BeamBayTag, choice?: SeatChoiceTag) {
    const inv = this.invite(id); if (!inv?.shared || inv.state !== 'pending') return;
    const s = inv.shared, raising = raises(s), accepted = Object.entries(inv.guestReceipts).filter(([g]) => inv.responses[g] === 'accepted');
    const dropped = inv.guests.filter(g => !guests.some(x => x.soulId === g.soulId));
    s.revision++; s.changed = changes.join('; '); s.load = {entity: tag.load, def: tag.def, name: tag.name}; s.destination = {place: to.id, name: to.name}; s.crew = tag.crew; if (bay) s.beam = {a: bay.a, b: bay.b, seats: bay.seats}; if (choice) s.seat = {verb: choice.verb, params: choice.params, ...(choice.at !== undefined ? {at: choice.at} : {})};
    s.roles = [{role: 'carrier', slot: 0, soulId: soul.soulId}, ...guests.map((_, i) => ({role: 'carrier' as const, slot: i + 1, soulId: null}))];
    Object.assign(inv, {guests, responses: {}, guestReceipts: {}, capability, label: `asks you to ${doing(s)} together`, expiresTick: this.tick + SHARED_LAPSE * 20});
    this.saveInvite(inv);
    // PC11 (#690): what the old revision waited for (who declined, who was not ready) is not this revision's
    const hr = inv.hostReceipt ? this.p.receipt(soul.soulId, inv.hostReceipt) : null; if (hr?.phase === 'waiting' && hr.code === 'shared.not-ready') this.p.note?.(hr.id, null, null);
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
    const body = this.sharedBodyProblem(soul) ?? this.sharedTooFar(soul, s.load.entity, s.load.name); if (body) return body;
    if (!this.mindOf(inv.host.soulId) || this.p.faded(inv.host.soulId)) return {code: 'invite.gone', reason: `${inv.host.name} is not here any more.`};
    if (!s.roles.some(r => !r.soulId)) return {code: 'shared.full', reason: 'Every role in that carry is taken.'};
    const rest = listed([inv.host.name, ...inv.guests.filter(g => g.soulId !== soul.soulId && (!inv.responses[g.soulId] || inv.responses[g.soulId] === 'accepted')).map(g => this.mindOf(g.soulId)?.name ?? g.name)]);
    return {label: `${cap1(doing(s))} with ${rest}`, steps: [], capability, wait: true, detail: {sharedV1: {invite: inv.id, revision: s.revision}},
      commit: receipt => this.respond(inv.id, soul, 'accepted', receipt)};
  }
  /** Accept / decline (or leave) offers of a shared proposal to one of its guests; no distant clutter (only its guests). */
  private sharedOffers(soul: EdgeSoul, inv: Invite, add: (c: EdgeCapability, plan: TogetherPlan) => void) {
    const s = inv.shared!, secs = Math.max(0, Math.round((inv.expiresTick - this.tick) / 20)), mine = inv.responses[soul.soulId] === 'accepted';
    // PC11 (#690): with a crew of three or four, the offer names everyone else asked (not who declined or left)
    const rest = listed([inv.host.name, ...inv.guests.filter(g => g.soulId !== soul.soulId && (!inv.responses[g.soulId] || inv.responses[g.soulId] === 'accepted')).map(g => this.mindOf(g.soulId)?.name ?? g.name)]);
    const what = `${doing(s)} with ${rest}`, target = {id: inv.host.soulId, kind: 'soul'};
    add({id: 'accept:' + inv.id, verb: 'accept', label: mine ? `You accepted: ${what} (revision ${s.revision}); accepting again changes nothing` : `Accept: ${inv.host.name} asks you to ${what} (revision ${s.revision}, ${secs} s left; accepting moves nobody yet)`,
      target, available: true, params: {revision: {type: 'integer', min: 1, description: `the proposal revision you agree to (now ${s.revision})`}}}, {label: 'Accept the shared carry', steps: [], together: {kind: 'accept', invite: inv.id}});
    add({id: 'decline:' + inv.id, verb: 'decline', label: mine ? `Leave: ${what} (before it starts)` : `Decline ${inv.host.name}'s proposal to ${what}`, target, available: true}, {label: mine ? 'Leave the shared carry' : 'Decline the proposal', steps: [], together: {kind: 'decline', invite: inv.id}});
  }
  /** CTRL-2 (#1094 A1, #681 A7): one shared operation as a member of it sees it, by its invitation or operation id; null
   *  for anyone else, so a proposal stays between the Souls it names. Readiness is the same check the commit makes. */
  sharedView(id: string, soulId: string) {
    const inv = this.invite(id) ?? this.committed().find(i => i.shared?.op?.id === id) ?? null, s = inv?.shared;
    if (!inv || !s || (inv.host.soulId !== soulId && !inv.guests.some(g => g.soulId === soulId))) return null;
    const op = s.op, blockers = inv.state === 'pending' ? this.sharedBlockers(inv) : [];
    const slotOf = (who: string) => s.roles.find(r => r.soulId === who)?.slot ?? null;
    const members = [inv.host, ...inv.guests].map(m => {
      const accepted = m.soulId === inv.host.soulId || inv.responses[m.soulId] === 'accepted', why = blockers.find(b => b.soulId === m.soulId)?.why;
      return {soulId: m.soulId, name: this.mindOf(m.soulId)?.name ?? m.name, role: 'carrier', slot: slotOf(m.soulId), accepted, ...(inv.responses[m.soulId] && !accepted ? {answer: inv.responses[m.soulId]} : {}), ...(op ? {} : {ready: accepted && !why, ...(why ? {why} : {})})};
    });
    const waitingFor = blockers.filter(b => !b.soulId).map(b => `${b.name} ${b.why}`);
    return {id: inv.id, op: op?.id ?? null, load: s.load.entity, name: `${s.template.id} ${s.load.name} to ${s.destination.name}`, members, state: {
      template: s.template, revision: s.revision, load: {id: s.load.entity, name: s.load.name, def: s.load.def}, destination: {id: s.destination.place, name: s.destination.name}, crew: s.crew,
      phase: op?.phase ?? (inv.state === 'pending' ? 'proposed' : 'closed'), ...(op?.id ? {op: op.id} : {}), ...(op?.result ? {result: op.result} : {}), ...(op?.blocked ? {blocked: op.blocked} : {}),
      ...(op?.stop ? {stop: {by: op.stop.name, tick: op.stop.tick}} : {}), ...(waitingFor.length ? {waitingFor} : {}), ...(inv.state === 'pending' ? {expiresInSec: Math.max(0, Math.round((inv.expiresTick - this.tick) / 20))} : {})}};
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
    const op = current ? s!.op : null;
    return {invite: made.invite, revision: host ? s!.revision : made.revision, role: 'carrier', slot: current ? s!.roles.find(r => r.soulId === soulId)?.slot ?? null : null,
      ...(op ? {op: op.id, ...(op.holding !== undefined && op.phase !== 'ended' && !op.stop ? {holding: true as const} : {}), phase: op.phase, ...(op.result ? {result: op.result} : {}), ...(op.blocked ? {blocked: op.blocked} : {}), ...(op.blocks?.length ? {blocks: op.blocks} : {}), ...(op.detours ? {detours: op.detours} : {}), ...(op.stop ? {stop: {by: op.stop.by, name: op.stop.name, tick: op.stop.tick, ...(op.stop.away ? {away: true as const} : {})}} : {})}
        : {phase: current && inv!.state === 'pending' ? 'pending' as const : 'ended' as const})};
  }
  /** PC02 §1: an open shared receipt that a newer body act of its Soul ends is `failed` / `shared.left`, never `replaced`. */
  sharedLeave(r: EdgeReceipt): {code: string; reason: string} | null {
    if (!/^(?:carry-with|raise-with|connect-beam-with|install-joist-with|lay-sheet-with|install-flight-with|accept):/.test(r.capability)) return null;
    const inv = this.inviteForReceipt(r.id); if (inv?.kind !== 'shared' || inv.state !== 'pending') return null;
    if (inv.hostReceipt === r.id) return {code: 'shared.left', reason: `You did something else, so the shared ${opWord(inv)} you proposed is off; nothing was lifted.`};
    return inv.guestReceipts[r.soulId] === r.id ? {code: 'shared.left', reason: `You did something else, so you left the shared ${opWord(inv)} before it started; nothing was lifted.`} : null;
  }

  // ---------------------------------------------------------------- PC05 (#684): readiness, atomic commit, busy, release
  /** A proposal's members in slot order, each with their own receipt for it (the host's from the proposal). */
  private sharedMembers(inv: Invite): {soulId: string; name: string; slot: number; receipt: string | null}[] {
    const s = inv.shared; if (!s) return [];
    return [...s.roles].sort((a, b) => a.slot - b.slot).filter(r => r.soulId).map(r => ({soulId: r.soulId!, slot: r.slot, name: this.mindOf(r.soulId!)?.name ?? (r.soulId === inv.host.soulId ? inv.host.name : inv.guests.find(g => g.soulId === r.soulId)?.name ?? 'someone'),
      receipt: r.soulId === inv.host.soulId ? inv.hostReceipt : inv.responses[r.soulId!] === 'accepted' ? inv.guestReceipts[r.soulId!] ?? null : null}));
  }
  /** PC02 §1: a proposal or acceptance from beyond the gather radius would wait forever (walking closer is another body
   *  act, which leaves), so it is refused before any receipt. */
  private sharedTooFar(soul: EdgeSoul, load: string, name: string): {code: string; reason: string} | null {
    const me = this.p.body(soul.entityId), x = this.w.entities[load]; if (!me || !x) return null;
    const d = Math.hypot(me.pose.p[0] - x.pose.p[0], me.pose.p[2] - x.pose.p[2]);
    return d > SHARED_GATHER_RADIUS ? {code: 'shared.too-far', reason: `You are ${Math.round(d)} m from ${name}; walk within ${SHARED_GATHER_RADIUS} m of it first, then ask again.`} : null;
  }
  /** PC02 §1 readiness, derived and never stored: why this proposal cannot commit now (empty when every member is ready).
   *  A member's own open receipt for it is their latest body act (any other would have ended it), so it is the only one. */
  sharedBlockers(inv: Invite): SharedBlocker[] {
    const s = inv.shared; if (!s || inv.state !== 'pending') return [{soulId: null, name: 'The proposal', why: 'is no longer open'}];
    const out: SharedBlocker[] = [], x = this.w.entities[s.load.entity] as (NativeWorld['entities'][string] & {support?: {kind: string}; phase?: string}) | undefined;
    if (s.roles.some(r => !r.soulId)) out.push({soulId: null, name: 'The crew', why: `still needs ${s.roles.filter(r => !r.soulId).length} more to accept`});
    if (!x) return [...out, {soulId: null, name: s.load.name, why: 'is no longer here'}];
    const def = this.thingDef?.(s.load.entity);
    if (def !== undefined && def !== s.load.def) out.push({soulId: null, name: s.load.name, why: `changed (it is ${def ?? 'gone'} now, not ${s.load.def})`});
    // the load claim of a running operation: the native reservation starts only on the programme's first tick, so two
    // commits for one load in the same tick are excluded here, under the same write lock as the journal that claims it
    const claimed = this.committed().find(o => o.id !== inv.id && o.shared?.op && o.shared.op.phase !== 'ended' && o.shared.load.entity === s.load.entity);
    if (claimed || x.reservedBy || x.phase === 'carried') out.push({soulId: null, name: s.load.name, why: 'is being carried by someone else'});
    else if (x.support?.kind !== 'ground') out.push({soulId: null, name: s.load.name, why: 'is not lying on the ground'});
    for (const m of this.sharedMembers(inv)) {
      const mind = this.mindOf(m.soulId), row = this.p.db.soul(m.soulId), b = mind ? this.p.body(mind.entityId) : undefined, h = b?.human;
      const why = (() => {
        if (!mind || !b || !h || !row || row.retired_at !== null || row.world_id !== this.p.host.worldId || row.entity_id !== mind.entityId || row.owner !== mind.owner) return 'is not here';
        if (this.p.faded(m.soulId)) return 'has faded';
        if (!m.receipt || this.p.receipt(m.soulId, m.receipt)?.phase !== 'waiting') return 'has not accepted this revision';
        const body = this.sharedBodyProblem({soulId: m.soulId, entityId: mind.entityId, name: mind.name, owner: mind.owner}); if (body) return `cannot carry (${body.reason})`;
        if (this.asleep(mind.entityId)) return 'is asleep';
        if (this.seated(mind.entityId) || h.activity === 'lie' || h.baseActivity === 'lie') return 'is not standing';
        if ((h.level ?? 0) !== 0) return 'is not on level-zero ground';
        const d = Math.hypot(b.pose.p[0] - x.pose.p[0], b.pose.p[2] - x.pose.p[2]); if (d > SHARED_GATHER_RADIUS) return `is ${Math.round(d)} m from ${s.load.name} (within ${SHARED_GATHER_RADIUS} m to start)`;
        if (this.p.programOf(mind.entityId)) return 'is still finishing what they were doing';
        return null;
      })();
      if (why) out.push({soulId: m.soulId, name: m.name, why});
    }
    return out;
  }
  /** Every second (sweep): a proposal with every role filled commits when all are ready; else each member's receipt says why. */
  private sharedCheck(inv: Invite) {
    if (!inv.shared || inv.shared.op) return;
    if (inv.shared.roles.some(r => !r.soulId)) {this.sharedShort(inv); return;}
    const blockers = this.sharedBlockers(inv);
    if (!blockers.length) {this.p.commitShared?.(inv.id); return;}
    this.sharedNotReady(inv, blockers);
  }
  /** PC11 (#690): a guest of a crew of three or four declined or left while the rest still meet the crew minimum
   *  (`sharedViable` closes it otherwise). This revision can never start, since its every role must be filled and a
   *  role is never filled for someone without asking them, so each member's open receipt says who is out and how to go on:
   *  the host amends (a new revision the rest accept again) or asks someone else. Nothing is shrunk without consent. */
  private sharedShort(inv: Invite) {
    const s = inv.shared!, out = inv.guests.filter(g => inv.responses[g.soulId] && inv.responses[g.soulId] !== 'accepted');
    if (!out.length) return;
    const name = (g: {soulId: string; name: string}) => this.mindOf(g.soulId)?.name ?? g.name;
    const gone = listed(out.map(g => `${name(g)} ${inv.responses[g.soulId] === 'declined' ? 'declined' : inv.responses[g.soulId] === 'left' ? 'left' : 'is out'}`));
    const rest = inv.guests.filter(g => !out.includes(g)), restNames = listed(rest.map(name));
    for (const m of this.sharedMembers(inv)) {
      const r = m.receipt ? this.p.receipt(m.soulId, m.receipt) : null;
      if (r?.phase !== 'waiting') continue;
      const how = m.soulId === inv.host.soulId
        ? raises(s) || seats(s) ? `To ${raises(s) ? 'raise' : deckOf(s) ? DECK_WORDS[deckOf(s)!].verb : 'seat'} it with ${restNames}, amend this proposal: act ${inv.capability.split(':')[0]}:${s.load.entity} with ${JSON.stringify({...(s.seat?.at !== undefined ? {at: s.seat.at} : {}), with: restNames, invite: inv.id})} (a new revision they accept again); or ask someone else in their place the same way.`
        : `To carry it with ${restNames}, amend this proposal: act carry-with:${s.load.entity} with ${JSON.stringify({to: s.destination.name, with: restNames, invite: inv.id})} (a new revision they accept again); or ask someone else in their place the same way.`
        : `${inv.host.name} can ask again without them (a new revision you would accept again); until then nothing moves.`;
      const why = `Not started: ${gone}, so this revision of the ${opWord(inv)} of ${s.load.name} cannot start as asked. ${how}`;
      if (r.code !== 'shared.not-ready' || r.reason !== why) this.p.note?.(r.id, 'shared.not-ready', why);
    }
  }
  /** Each member's open receipt names what the commit waits for (`shared.not-ready`), written only when it changes. */
  sharedNotReady(inv: Invite, blockers: SharedBlocker[]) {
    const why = `Not started yet: ${blockers.map(b => `${b.name} ${b.why}`).join('; ')}.`;
    for (const m of this.sharedMembers(inv)) {
      const r = m.receipt ? this.p.receipt(m.soulId, m.receipt) : null;
      if (r?.phase === 'waiting' && (r.code !== 'shared.not-ready' || r.reason !== why)) this.p.note?.(r.id, 'shared.not-ready', why);
    }
  }
  /** What the commit submits: the host's decision with one native crew `carry` (crew in slot order) to the destination. */
  sharedCommitPlan(id: string): {host: EdgeSoul; capability: string; label: string; steps: Steps; revision: number; opId: string} | null {
    const inv = this.invite(id), s = inv?.shared, m = inv ? this.mindOf(inv.host.soulId) : undefined;
    if (!inv || !s || s.op || inv.state !== 'pending' || !m) return null;
    const crew = this.sharedMembers(inv).map(x => this.mindOf(x.soulId)?.entityId).filter((e): e is string => !!e), step = raises(s) ? {verb: 'mars:raise_hold_v1', params: {crew, item: s.load.entity}} : deckOf(s) && s.seat ? {verb: `mars:${s.seat.verb}`, params: {crew, ...s.seat.params}} : seats(s) && s.beam ? {verb: 'mars:connect_beam_v1', params: {crew, beam: s.load.entity, a: s.beam.a, b: s.beam.b, seats: s.beam.seats}} : this.sharedCarryStep(crew, s.load.entity, s.destination.place);
    if (!step) return null;
    const others = listed(this.sharedMembers(inv).filter(x => x.soulId !== inv.host.soulId).map(x => x.name));
    return {host: {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, capability: inv.capability, revision: s.revision, opId: `op_${inv.id}_r${s.revision}`,
      label: `${cap1(doing(s))} with ${others}`, steps: [step]};
  }
  /** The commit guard (under the write lock): the same revision, still pending, no operation yet, everyone ready. */
  sharedCommitGuard(id: string, revision: number): true {
    const inv = this.invite(id), s = inv?.shared;
    if (!inv || !s || inv.state !== 'pending' || s.revision !== revision || s.op) throw new EdgeError(409, 'shared.not-ready', 'The proposal changed or already started.');
    if (this.tick > inv.expiresTick) throw new EdgeError(409, 'shared.not-ready', 'The proposal lapsed before it could start.');
    const blockers = this.sharedBlockers(inv); if (blockers.length) throw new EdgeError(409, 'shared.not-ready', blockers.map(b => `${b.name} ${b.why}`).join('; '));
    return true;
  }
  /** The commit journal (the decision's transaction): the operation, `committed`, and every member's receipt `started`. */
  sharedCommitted(id: string, revision: number, programId: string, eventSeq: number) {
    const inv = this.invite(id), s = inv?.shared; if (!inv || !s || s.revision !== revision || s.op) throw new EdgeError(409, 'shared.not-ready', 'The proposal changed before it started.');
    const members = this.sharedMembers(inv), opId = `op_${inv.id}_r${s.revision}`;
    s.op = {id: opId, programId, eventSeq, committedTick: this.tick, phase: 'started',
      claims: [...members.map(m => ({soulId: m.soulId, capabilities: ['hands', 'locomotion'] as ('hands' | 'locomotion')[]})), {entity: s.load.entity, by: opId}]};
    inv.state = 'committed'; this.saveInvite(inv);
    for (const m of members) {
      if (!m.receipt) throw new EdgeError(409, 'shared.not-ready', `${m.name} has no receipt for this revision.`);
      this.p.start?.(m.receipt, m.soulId === inv.host.soulId ? programId : null);
    }
    // told only once the commit is final (the journal runs inside the decision's transaction)
    afterCommit(this.p.db.db, () => {
      this.watching.set(inv.id, {programId, held: 0, clear: 0});
      for (const m of members) this.p.deliver(m.soulId, 'shared.started', {invite: {id: inv.id, revision: s.revision}, op: opId, text: raises(s) ? `The shared raise started: ${listed(members.map(x => x.name))} raise ${s.load.name} and hold it until someone stops.` : seats(s) ? `The shared ${opWord(inv)} started: ${listed(members.map(x => x.name))} ${doing(s)}.` : `The shared carry started: ${listed(members.map(x => x.name))} carry ${s.load.name} to ${s.destination.name}.`, untrusted: true});
      this.p.spectate({kind: 'shared', op: {id: opId, invite: inv.id, load: s.load.entity, crew: members.map(m => ({soulId: m.soulId, name: m.name})), phase: 'started'}, untrusted: true});
    });
  }
  /** A permanent refusal (the native plan refused the route or the crew): every member's receipt ends with it; nothing moved. */
  sharedRefused(id: string, code: string, reason: string) {
    const inv = this.invite(id); if (!inv?.shared || inv.state !== 'pending' || inv.shared.op) return;
    inv.state = 'closed'; this.saveInvite(inv);
    for (const m of this.sharedMembers(inv)) if (m.receipt) this.p.fail(m.receipt, code, `${reason} The shared ${opWord(inv)} did not start; nothing was lifted.`);
  }
  /** PC02 §3: while an operation runs, a member's body act is refused `shared.busy` (never replaces their receipt). */
  sharedBusyFor(r: EdgeReceipt): {op: string; reason: string; alternatives?: {id: string; label: string}[]} | null {
    if (!/^(?:carry-with|raise-with|connect-beam-with|install-joist-with|lay-sheet-with|install-flight-with|accept):/.test(r.capability)) return null;
    const inv = this.inviteForReceipt(r.id), s = inv?.shared, op = s?.op;
    if (!inv || !s || !op || inv.state !== 'committed' || op.phase === 'ended' || inv.hostReceipt !== r.id && inv.guestReceipts[r.soulId] !== r.id) return null;
    const others = listed(this.sharedMembers(inv).filter(m => m.soulId !== r.soulId).map(m => m.name));
    // PC08 (#687): the claims stay until the load is set down, so a stopping operation is still busy; the safe stop is offered
    if (op.stop) return {op: op.id, reason: `Your hands and walking are committed to ${raises(s) ? 'lowering or letting go of' : seats(s) ? 'putting down' : 'setting'} ${s.load.name} ${raises(s) || seats(s) ? '' : 'down '}safely with ${others} (${this.stopWords(op.stop)}; ${op.id}); nothing else was started. You can still talk and look around, and you are free again once it is set down.`,
      alternatives: [{id: `stop-carry:${op.id}`, label: `${this.stopLabel(inv)}: ${op.stop.away ? `${this.stopWords(op.stop)}, so the crew is already stopping` : `already asked by ${op.stop.name}`}; asking again changes nothing`}]};
    if (seats(s)) return {op: op.id, reason: `Your hands and walking are committed to ${deckOf(s) ? DECK_WORDS[deckOf(s)!].ing : 'seating'} ${s.load.name} ${s.destination.name} with ${others} (${op.id}); nothing else was started. You can still talk and look around, and you are free again once it is seated. To stop safely, act stop-carry:${op.id}.`,
      alternatives: [{id: `stop-carry:${op.id}`, label: this.stopLabel(inv)}]};
    if (raises(s)) return {op: op.id, reason: `Your hands and walking are committed to ${op.holding !== undefined ? 'holding' : 'raising'} ${s.load.name} with ${others} (${op.id}); nothing else was started. You can still talk and look around, and you are free again once it is lowered. To lower it safely, act stop-carry:${op.id}.`,
      alternatives: [{id: `stop-carry:${op.id}`, label: this.stopLabel(inv)}]};
    return {op: op.id, reason: `Your hands and walking are committed to carrying ${s.load.name} to ${s.destination.name} with ${others} (${op.id}); nothing else was started. You can still talk and look around, and you are free again once it is set down. To stop safely, act stop-carry:${op.id}.`,
      alternatives: [{id: `stop-carry:${op.id}`, label: this.stopLabel(inv)}]};
  }
  private stopLabel(inv: Invite): string {return raises(inv.shared!) ? this.holdStopLabel(inv) : seats(inv.shared!) ? `Stop ${deckOf(inv.shared!) ? DECK_WORDS[deckOf(inv.shared!)!].ing : 'seating'} ${inv.shared!.load.name} (the crew lets go where it lies, or lowers it back where it lay if it is up)` : `Stop carrying ${inv.shared!.load.name} (the crew sets it down safely first)`;}
  /** PC14 (#693): a raised upright joined by beams is never lowered; its crew lets go once its frame stands on its own. */
  private holdStopLabel(inv: Invite): string {
    const s = inv.shared!, x = this.w.entities[s.load.entity] as {connections?: unknown[]} | undefined;
    return x?.connections?.length ? `Stop holding ${s.load.name} (beams join it into a frame: the crew lets go once the frame stands on its own, and until then keeps holding)` : `Stop holding ${s.load.name} (the crew lowers it safely first, back where it lay)`;
  }
  /** Who stopped the operation, in words: a member's own stop, or (PC09) a member who went away. */
  stopWords(st: {name: string; away?: true}): string {return st.away ? `${st.name} went away (their mind left the world)` : `${st.name} asked to stop`;}
  /** PC09 (#688, PC02 §3): the running operation `soulId` is a member of (their receipt in it, and its stop plan), or null. */
  sharedRunning(soulId: string): {receipt: string; invite: string; op: string; programId: string; hostEntity: string; stopped: boolean} | null {
    for (const inv of this.committed()) {
      const op = inv.shared?.op, me = op && op.phase !== 'ended' ? this.sharedMembers(inv).find(m => m.soulId === soulId && m.receipt) : undefined;
      const r = me ? this.p.receipt(soulId, me.receipt!) : null, host = this.mindOf(inv.host.soulId);
      if (!op || !r || !host || r.phase !== 'started') continue;
      return {receipt: r.id, invite: inv.id, op: op.id, programId: op.programId, hostEntity: host.entityId, stopped: !!op.stop};
    }
    return null;
  }
  // ---------------------------------------------------------------- PC08 (#687, PC02 §3): stop-carry and supported cleanup
  /** A member's `stop-carry:<op>`: the operation it names and its host's body, or why it cannot be stopped. `again` is the
   *  stop already asked (a repeat changes nothing). */
  sharedStopPlan(soulId: string, opId: string): {invite: string; op: string; programId: string; hostEntity: string; again?: SharedStop} | {code: string; reason: string} {
    const id = /^op_(.+)_r\d+$/.exec(opId)?.[1], inv = id ? this.invite(id) : null, s = inv?.shared, op = s?.op;
    if (!inv || !s || !op || op.id !== opId) return {code: 'shared.unknown-op', reason: 'There is no shared operation by that id; your own shared receipt names its op.'};
    if (!this.sharedMembers(inv).some(m => m.soulId === soulId && m.receipt)) return {code: 'shared.not-member', reason: `You are not ${raises(s) ? 'holding' : seats(s) ? 'seating' : 'carrying'} ${s.load.name}; only its crew can stop it.`};
    const host = this.mindOf(inv.host.soulId);
    if (inv.state !== 'committed' || op.phase === 'ended' || !host) return {code: 'shared.not-running', reason: `The shared ${opWord(inv)} of ${s.load.name} has already ended (${op.result ?? 'ended'}); there is nothing to stop.`};
    return {invite: inv.id, op: op.id, programId: op.programId, hostEntity: host.entityId, ...(op.stop ? {again: op.stop} : {})};
  }
  /** The stop's journal (written with the queued `edge-stop` of the op's programme): the op is `stopping`, its
   *  claims stay until the load is set down, and every member's started receipt says what the crew does now. Returns
   *  that reason (the stop receipt's own). */
  sharedStopping(invite: string, by: {soulId: string; name: string}, receipt: string, away = false): string {
    const inv = this.invite(invite)!, s = inv.shared!, op = s.op!, phase = this.p.carryState?.(op.programId)?.phase ?? null;
    this.closeBlock(op);
    op.stop = {by: by.soulId, name: by.name, tick: this.tick, receipt, phase, ...(away ? {away: true as const} : {})}; op.phase = 'stopping';
    this.saveInvite(inv);
    const reason = this.stoppingReason(inv);
    this.noteStarted(inv, 'shared.stopping', reason);
    afterCommit(this.p.db.db, () => {
      // a hold-up open when the stop was asked is closed above; the watch re-opens one if the crew is still held up
      const w = this.watching.get(inv.id); if (w) {delete w.since; delete w.code; delete w.lasting; w.held = 0; w.clear = 0; w.stopping = true;}
      for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.stopping', {op: op.id, by, ...(away ? {away: true} : {}), text: reason, untrusted: true});
      this.p.spectate({kind: 'shared', op: {id: op.id, invite: inv.id, load: s.load.entity, phase: 'stopping'}, untrusted: true});
    });
    return reason;
  }
  /** What the crew does after a stop, from the native phase it was asked in (the native cancel decides; this only says it). */
  private stoppingReason(inv: Invite): string {
    const s = inv.shared!, op = s.op!, st = op.stop!, crew = listed(this.sharedMembers(inv).map(m => m.name)), load = s.load.name;
    // PC14 (#693): before the lift the crew lets go; in the air it comes back down along the way it went up
    if (seats(s)) return `${this.stopWords(st)} (${op.id}): ${!st.phase || st.phase === 'approach' ? `${load} has not been lifted, so ${crew} let go of it where it lies` : `${crew} lower ${load} back where it lay, along the way it went up`}. Your hands and walking stay committed until it is down; you can still talk and look around.`;
    if (raises(s)) {
      const before = !st.phase || st.phase === 'approach' || st.phase === 'grip';
      const joined = !!(this.w.entities[s.load.entity] as {connections?: unknown[]} | undefined)?.connections?.length;
      const how = st.unsafe !== undefined && joined ? `${crew} keep holding ${load}: ${st.unsafe}; they let go as soon as it does, and it is never lowered`
        : joined ? `beams join ${load} into a frame that stands on its own, so ${crew} let go and it stands there`
        : st.unsafe !== undefined ? `${load} cannot come down yet (${st.unsafe}), so ${crew} keep holding it and lower it as soon as it is clear` : before ? `${load} has not been lifted, so ${crew} let go of it where it lies` : `${crew} lower ${load} back where it lay, along the way it came up`;
      return `${this.stopWords(st)} (${op.id}): ${how}. Your hands and walking stay committed until ${joined ? 'it stands on its own' : 'it is down'}; you can still talk and look around.`;
    }
    const what = st.unsafe !== undefined ? `${load} cannot be set down here (${st.unsafe}), so ${crew} carry on along the agreed way to ${s.destination.name} and set it down at the first clear spot`
      : st.phase === 'gather' || st.phase === 'reach' || st.phase === 'gather-cancel' ? `${load} has not been lifted, so ${crew} let go of it where it lies`
      : st.phase === 'lift' ? `${crew} lower ${load} back where it lay`
      : st.phase === 'set-down' || st.phase === 'release' ? `${load} is already being set down; ${crew} finish setting it down`
      : st.phase === 'climb' ? `${crew} carry ${load} off the stairs first, then set it down at the first clear spot`
      : `${crew} set ${load} down where they are if the ground there is clear, else carry on along the agreed way to the first clear spot`;
    return `${this.stopWords(st)} (${op.id}): ${what}. Your hands and walking stay committed until it is set down; you can still talk and look around.`;
  }
  /** The native cancel refused (`carry.cancel-unsafe`: the ground under the load is not clear): said once, the op stays
   *  `stopping`, and the native carry keeps retrying along its validated route. */
  private sharedUnsafe(id: string, st: CarryIssue) {
    const raiseInv = this.invite(id), over = /overlap '([^']+)'/.exec(st.message ?? '')?.[1], why = raiseInv?.shared && raises(raiseInv.shared) ? this.raiseWhy(st) : over && named(over) ? `it would overlap ${over}` : /footprint would leave the floor/.test(st.message ?? '') ? 'it would not lie on the floor' : 'the ground under it is not clear';
    let text = '';
    const inv = this.sharedOpChange(id, op => {if (op.stop) op.stop.unsafe = why;}, inv => {text = this.stoppingReason(inv); this.noteStarted(inv, 'shared.stopping', text);});
    if (!inv) return;
    for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.stopping', {op: inv.shared!.op!.id, by: {soulId: inv.shared!.op!.stop!.by, name: inv.shared!.op!.stop!.name}, deferred: true, text, untrusted: true});
  }
  /** The load rests on its support again (the ground, or what it lay on before a stop before the lift), carried and
   *  reserved by nobody. */
  private laidFree(entity: string): boolean {
    const x = this.w.entities[entity] as (NativeWorld['entities'][string] & {support?: {kind: string}; phase?: string}) | undefined;
    return !!x && !!x.support && x.phase !== 'carried' && !x.reservedBy;
  }
  /** A stopped operation ended: where the native cleanup left the load decides `stopped` or `stopped-at-destination`. */
  private sharedStopped(inv: Invite) {
    const s = inv.shared!, op = s.op!, st = op.stop!, x = this.w.entities[s.load.entity], crew = listed(this.sharedMembers(inv).map(m => m.name));
    if (raises(s)) {
      const installed = (x as {phase?: string} | undefined)?.phase === 'installed';
      const where = installed ? `${s.load.name} stands on its own in the frame its beams join it into; nobody holds it` : !st.phase || st.phase === 'approach' || st.phase === 'grip' ? `${s.load.name} was never lifted; it lies where it was` : `${s.load.name} was lowered back where it lay`;
      this.sharedEnd(inv, 'stopped', 'shared.stopped', `${st.away ? `Stopped because ${st.name} went away` : `Stopped at ${st.name}'s request`} (${op.id}): ${where}. ${crew} have let go and are free again; nothing is resumed on its own.`);
      return;
    }
    if (seats(s)) {
      const where = !st.phase || st.phase === 'approach' ? `${s.load.name} was never lifted; it lies where it was` : `${s.load.name} was lowered back where it lay`;
      this.sharedEnd(inv, 'stopped', 'shared.stopped', `${st.away ? `Stopped because ${st.name} went away` : `Stopped at ${st.name}'s request`} (${op.id}): ${where}. ${crew} have let go and are free again; nothing is resumed on its own.`);
      return;
    }
    const atDestination = !!x && this.p.places.containing(x.pose.p[0], x.pose.p[2], (x as {level?: number}).level ?? 0).some(p => p.id === s.destination.place);
    const lifted = !(st.phase === 'gather' || st.phase === 'reach' || st.phase === 'gather-cancel');
    const where = !lifted ? `${s.load.name} was never lifted; it lies where it was`
      : st.phase === 'lift' ? `${s.load.name} was lowered back where it lay`
      : atDestination ? `${s.load.name} is set down at ${s.destination.name}${st.unsafe !== undefined ? ', the first clear spot on the way' : ''}`
      : `${s.load.name} is set down on clear ground short of ${s.destination.name}${st.unsafe !== undefined ? ', at the first clear spot on the way' : ''}`;
    const result: SharedResult = atDestination && lifted && st.phase !== 'lift' ? 'stopped-at-destination' : 'stopped';
    this.sharedEnd(inv, result, 'shared.stopped', `${st.away ? `Stopped because ${st.name} went away` : `Stopped at ${st.name}'s request`} (${op.id}): ${where}. ${crew} have let go and are free again; nothing is resumed on its own.`);
  }
  /** PC02 §3 release: the operation's programme ended, so every member's receipt ends together and the claims go. */
  sharedProgramEnded(receiptId: string, ev: {id: string; kind: string; code?: string; message?: string}): boolean {
    const inv = this.inviteForReceipt(receiptId), s = inv?.shared, op = s?.op;
    if (!inv || !s || !op || inv.state !== 'committed' || op.programId !== ev.id || inv.hostReceipt !== receiptId) return false;
    // PC08: after a stop, the native cleanup's end is the stop's outcome, once the load really lies free on the ground
    // (anything else, e.g. a programme ended another way while the load is still held, is reported as it is: `ended`)
    if (op.stop && ev.kind !== 'failed' && this.laidFree(s.load.entity)) {this.sharedStopped(inv); return true;}
    const arrived = ev.kind === 'completed';
    // PC14 (#693): a seated beam says where it is and what that means for the uprights' crews
    if (arrived && deckOf(s)) {this.sharedEnd(inv, 'arrived', 'shared.seated', deckOf(s) === 'install-joist' ? `${cap1(s.load.name)} is set ${s.destination.name}: both its ends rest on the beams' ledges.` : deckOf(s) === 'install-flight' ? `${cap1(s.load.name)} is set ${s.destination.name}: its header hangs on the beam's ledge and its foot stands on the ground. Its treads go in one by one; it is walked once every tread is in.` : `${cap1(s.load.name)} is laid ${s.destination.name}: it bears on every joist under it, and its top is a floor now.`); return true;}
    if (arrived && seats(s)) {this.sharedEnd(inv, 'arrived', 'shared.seated', `${cap1(s.load.name)} is seated ${s.destination.name}: both its ends are joined. Whoever holds the uprights lets go once the frame stands on its own.`); return true;}
    this.sharedEnd(inv, arrived ? 'arrived' : 'ended', ev.code ?? 'action.failed', raises(s) ? `The shared raise of ${s.load.name} ended${ev.message ? ` (${ev.message})` : ''}.` : deckOf(s) ? `The shared ${DECK_WORDS[deckOf(s)!].op} of ${s.load.name} ended before it was in place${ev.message ? ` (${this.beamWhy({code: ev.code ?? '', message: ev.message})})` : ''}; it lies where it was.` : seats(s) ? `The shared beam seating of ${s.load.name} ended before it was seated${ev.message ? ` (${this.beamWhy({code: ev.code ?? '', message: ev.message})})` : ''}; it lies where it was.` : `The shared carry of ${s.load.name} ended before ${s.destination.name}${ev.message ? ` (${ev.message})` : ''}.`);
    return true;
  }
  /** PC02 §3 release, in one transaction: the operation ends, the claims go and every member's still-open receipt ends
   *  (`completed` on arrival; `completed` with `shared.stopped` and its reason after a stop's cleanup, PC02 §2; else
   *  `failed` with the code). */
  private sharedEnd(inv: Invite, result: SharedResult, code: string, reason: string) {
    const s = inv.shared!, op = s.op!, stopped = result === 'stopped' || result === 'stopped-at-destination';
    this.closeBlock(op);
    Object.assign(op, {phase: 'ended', endedTick: this.tick, result, ...(result === 'arrived' ? {} : {code})});
    inv.state = 'closed';
    tx(this.p.db.db, () => {
      this.saveInvite(inv);
      for (const m of this.sharedMembers(inv)) {
        const r = m.receipt ? this.p.receipt(m.soulId, m.receipt) : null; if (!r || (r.phase !== 'waiting' && r.phase !== 'started')) continue;
        if (result === 'arrived') {if (code === 'shared.seated') this.p.note?.(r.id, code, reason); this.p.complete(r.id);}
        else if (stopped) {this.p.note?.(r.id, code, reason); this.p.complete(r.id);}
        else this.p.fail(r.id, code, reason);
      }
    });
    this.staleOps.delete(inv.id); this.watching.delete(inv.id);
    if (stopped) for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.stopped', {op: op.id, result, by: {soulId: op.stop!.by, name: op.stop!.name}, text: reason, untrusted: true});
    this.p.spectate({kind: 'shared', op: {id: op.id, invite: inv.id, load: s.load.entity, phase: 'ended', result: op.result}, untrusted: true});
  }
  /** A member's receipt of a running operation ended another way (an engine-fault recovery, a god walkout, a restart;
   *  a fade is the member's stop instead, PC09): the operation ends for every member, and the host's programme is stopped. */
  private sharedMemberEnded(r: EdgeReceipt) {
    if (!/^(?:carry-with|raise-with|connect-beam-with|install-joist-with|lay-sheet-with|install-flight-with|accept):/.test(r.capability)) return;
    const inv = this.inviteForReceipt(r.id), op = inv?.shared?.op;
    if (!inv || !op || inv.state !== 'committed' || op.phase === 'ended' || inv.hostReceipt !== r.id && inv.guestReceipts[r.soulId] !== r.id) return;
    const host = this.mindOf(inv.host.soulId), live = !!host && this.p.programOf(host.entityId) === op.programId, who = this.mindOf(r.soulId)?.name ?? 'A member';
    this.sharedEnd(inv, 'ended', 'shared.ended', `${who} stopped (${r.code ?? r.phase}), so the shared ${opWord(inv)} of ${inv.shared!.load.name} ended for everyone.`);
    if (live && host) afterCommit(this.p.db.db, () => this.p.stopBody?.({soulId: host.soulId, entityId: host.entityId, name: host.name, owner: host.owner}));
  }
  /** Each sweep: a running operation whose programme is gone on two checks in a row (its end was never seen, e.g. across
   *  a restart) is ended for every member. PC10 (#689): the stop's event and its journal are one transaction, so a
   *  restarted world that runs a stopping operation's programme has already replayed its stop; nothing is asked again. */
  private staleOps = new Map<string, number>();
  private sharedReconcile() {
    this.sharedRewound();
    for (const inv of this.committed()) {
      const op = inv.shared?.op; if (!op || op.phase === 'ended') continue;
      const host = this.mindOf(inv.host.soulId);
      // a restored world older than the commit never has this op's programme, whatever programme now has its id
      if (host && this.tick >= op.committedTick && this.isOpCarry(host.entityId, op.programId)) {
        this.staleOps.delete(inv.id);
        // a world restored to before the stop (an older backup than the journal) is asked to stop again; an exact
        // resume has already replayed the stop, so this never logs a second one there
        if (op.stop && !this.watching.has(inv.id) && op.stop.tick > this.tick && this.p.stopOp?.(host.entityId, op.programId, op.id, 'shared.stop') === false) continue;
        if (!this.watching.has(inv.id)) this.watching.set(inv.id, {programId: op.programId, held: 0, clear: 0, ...(op.holding !== undefined ? {holding: true as const} : {}), ...(op.stop ? {stopping: true as const, ...(op.stop.unsafe !== undefined ? {unsafe: true as const} : {})} : {}), ...(op.blocked ? {since: op.blocked.fromTick, code: op.blocked.code, ...(op.blocked.lasting ? {lasting: true as const} : {})} : {})}); continue;}
      if (!this.staleOps.has(inv.id)) {this.staleOps.set(inv.id, this.tick); continue;}
      const load = inv.shared!.load.name;
      this.sharedEnd(inv, 'ended', 'shared.ended', this.tick < op.committedTick
        ? `The world was restored to a moment before the shared ${opWord(inv)} of ${load} started (${op.id}), so it is not running; nothing is ${raises(inv.shared!) ? 'held' : seats(inv.shared!) ? 'lifted' : 'carried'}.`
        : `The shared ${opWord(inv)} of ${load} is no longer running.`);
    }
  }
  /** PC10 (#689, A3b): once after a boot. An operation that ended later than the restored clock (a world without the
   *  durable clock, restored to a moment before that end) has its programme replayed by the engine, which would carry
   *  the load again although nobody agreed to it. That programme is stopped safely (a logged `edge-stop` naming it), the
   *  members are told and an operator line says so; their ended receipts keep how it ended. Bounded to the latest ops. */
  private rewoundChecked = false;
  /** The host runs this op's programme: the same id, and that programme is a native carry (ids are counters). No
   *  reading of the action (between steps) counts as the carry on purpose: the commit tick check carries the weight. */
  private isOpCarry(hostEntity: string, programId: string): boolean {return this.p.programOf(hostEntity) === programId && SHARED_VERBS.has(this.p.carryState?.(programId)?.verb ?? 'carry');}
  private sharedRewound() {
    if (this.rewoundChecked) return; this.rewoundChecked = true;
    const rows = this.p.db.db.prepare(`SELECT body FROM edge_invites_v1 WHERE world_id=? AND state='closed' AND body LIKE '%"endedTick":%' ORDER BY created_at DESC LIMIT 50`).all(this.p.host.worldId) as {body: string}[];
    for (const {body} of rows) {
      const inv = JSON.parse(body) as Invite, s = inv.shared, op = s?.op, host = this.mindOf(inv.host.soulId);
      if (!s || !op || op.phase !== 'ended' || (op.endedTick ?? 0) <= this.tick || op.committedTick > this.tick || !host || !this.isOpCarry(host.entityId, op.programId)) continue;
      if (this.p.stopOp?.(host.entityId, op.programId, op.id, 'shared.restored') === false) {this.rewoundChecked = false; continue;}
      console.error(`[edge] shared ${op.id}: the world was restored to tick ${this.tick}, before this carry ended (tick ${op.endedTick}, ${op.result}); its replayed programme is stopped safely. Operator: check where ${s.load.entity} lies.`);
      const text = `The world was restored to a moment before the shared carry of ${s.load.name} ended (${op.result}; ${op.id}). Nobody asked to carry it again, so the crew sets it down safely where it is now; your receipt keeps how it ended.`;
      for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.restored', {op: op.id, text, untrusted: true});
      this.p.spectate({kind: 'shared', op: {id: op.id, invite: inv.id, load: s.load.entity, phase: 'restored'}, untrusted: true});
    }
  }
  /** PC07 (#686): the running operations the main tick watches (in memory: nothing to do while none runs). `held` and
   *  `clear` count consecutive ticks with and without a native hold-up; `since`/`code` mark the open `blocked` interval. */
  private watching = new Map<string, {programId: string; held: number; clear: number; since?: number; code?: string; lasting?: true; phase?: string; stopping?: true; unsafe?: true; holding?: true}>();
  /** PC07 (#686, PC02 §2): each main tick, every running operation reads its native carry. A hold-up of at least
   *  `SHARED_BLOCK_TICKS` (people in the way, the set-down or grip spot occupied, a route construction cut with no other
   *  way) makes the op `blocked`: every member's receipt names the native code and the blocker, and their streams are told.
   *  Motion again for as long closes the interval (`blocks`) and clears the reasons. A native replan to the same
   *  destination is a detour. A hold-up of `SHARED_LASTING_TICKS` is `lasting`; the crew still holds the load and nobody
   *  lets go on a timeout. Reads only; the native carry owns every movement. */
  sharedWatch() {
    this.sharedRewound();   // PC10: at the first tick after a boot, before a replayed ended op carries on
    if (!this.watching.size || !this.p.carryState) return;
    for (const [id, w] of this.watching) {
      const st = this.p.carryState(w.programId); if (!st) continue;
      if (st.phase === 'replan' && w.phase !== 'replan') this.sharedOpChange(id, op => {op.detours = (op.detours ?? 0) + 1;});
      w.phase = st.phase;
      // PC13 (#692): the raised load stands, held by the whole crew; said once, and it stays so until someone stops
      if (st.phase === 'hold' && !w.stopping && !w.holding) {w.holding = true; this.sharedHolding(id);}
      // PC08: after a stop, a native cancel refused because the ground under the load is not clear is said once
      if (w.stopping && !w.unsafe && (st.code === 'carry.cancel-unsafe' || st.code === 'raise.cancel-unsafe' || st.code === 'support.release-premature') && st.status !== 'blocked') {w.unsafe = true; this.sharedUnsafe(id, st as CarryIssue);}
      if (st.status === 'blocked' && st.code) {
        const issue = st as CarryIssue;
        w.clear = 0; w.held++;
        if (w.since === undefined ? w.held >= SHARED_BLOCK_TICKS : w.code !== st.code) this.sharedHeldUp(id, w, issue, false);
        else if (w.since !== undefined && !w.lasting && this.tick - w.since >= SHARED_LASTING_TICKS) this.sharedHeldUp(id, w, issue, true);
      } else {
        w.held = 0;
        if (w.since !== undefined && ++w.clear >= SHARED_BLOCK_TICKS) this.sharedGoesOn(id, w);
      }
    }
  }
  /** PC13 (#692): once, when the raised load first stands: every member's receipt and stream say it is held and how to end that. */
  private sharedHolding(id: string) {
    let text = '';
    const inv = this.sharedOpChange(id, op => {op.holding ??= this.tick;}, inv => {
      const s = inv.shared!;
      text = `${s.load.name} stands, held by ${listed(this.sharedMembers(inv).map(m => m.name))} (${s.op!.id}). It stays held until one of you stops: stop-carry:${s.op!.id} lowers it back where it lay.`;
      this.noteStarted(inv, 'shared.holding', text);
    });
    if (!inv) return;
    const s = inv.shared!;
    for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.holding', {op: s.op!.id, text, untrusted: true});
    this.p.spectate({kind: 'shared', op: {id: s.op!.id, invite: inv.id, load: s.load.entity, phase: 'holding'}, untrusted: true});
  }
  /** Change a running operation in its invitation row (one transaction with any receipt notes in `also`). */
  private sharedOpChange(id: string, change: (op: SharedOp, inv: Invite) => void, also?: (inv: Invite) => void): Invite | null {
    const inv = this.invite(id), op = inv?.shared?.op; if (!inv || !op || inv.state !== 'committed' || op.phase === 'ended') return null;
    tx(this.p.db.db, () => {change(op, inv); this.saveInvite(inv); also?.(inv);});
    return inv;
  }
  /** The open hold-up, if any, joins the operation's closed intervals (the most recent `SHARED_BLOCKS_KEPT`). */
  private closeBlock(op: SharedOp) {
    if (!op.blocked) return;
    const all = op.blocks ??= []; all.push({...op.blocked, toTick: this.tick}); if (all.length > SHARED_BLOCKS_KEPT) all.splice(0, all.length - SHARED_BLOCKS_KEPT);
    delete op.blocked;
  }
  /** A hold-up's code and reason go only on member receipts still `started`: one that has ended keeps its own words. */
  private noteStarted(inv: Invite, code: string | null, reason: string | null) {
    for (const m of this.sharedMembers(inv)) if (m.receipt && this.p.receipt(m.soulId, m.receipt)?.phase === 'started') this.p.note?.(m.receipt, code, reason);
  }
  /** Who or what holds the formation up, in words: a Soul by name, else the labelled obstacle that cut the route. */
  private blockerOf(st: CarryIssue): string | null {
    for (const id of st.subjects ?? []) for (const m of this.p.host.minds.values()) if (m.entityId === id) return m.name;
    return named(st.details?.cutLabel);
  }
  private sharedHeldUp(id: string, w: {since?: number; code?: string; lasting?: true; held: number}, st: CarryIssue, lasting: boolean) {
    const blocker = this.blockerOf(st), from = lasting ? w.since! : w.since !== undefined ? this.tick : this.tick - w.held + 1;   // a new code mid-block opens its own interval
    let text = '';
    const inv = this.sharedOpChange(id, op => {
      if (!lasting) this.closeBlock(op);
      op.phase = 'blocked'; op.blocked = {code: st.code, fromTick: from, blocker, ...(lasting ? {lasting: true as const} : {})};
    }, inv => {text = this.heldUpReason(inv, st, blocker, lasting); this.noteStarted(inv, st.code, text);});
    if (!inv) return;
    w.since = from; w.code = st.code; if (lasting) w.lasting = true; else delete w.lasting;
    const s = inv.shared!;
    for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.blocked', {op: s.op!.id, code: st.code, ...(blocker ? {blocker} : {}), ...(lasting ? {lasting: true} : {}), text, untrusted: true});
    this.p.spectate({kind: 'shared', op: {id: s.op!.id, invite: inv.id, load: s.load.entity, phase: 'blocked', code: st.code, ...(lasting ? {lasting: true} : {})}, untrusted: true});
  }
  private sharedGoesOn(id: string, w: {since?: number; code?: string; lasting?: true; clear: number}) {
    delete w.since; delete w.code; delete w.lasting; w.clear = 0;
    // PC08: a stopping crew that was held up goes back to `stopping` (its stop reason), never to `started`
    const inv = this.sharedOpChange(id, op => {this.closeBlock(op); op.phase = op.stop ? 'stopping' : 'started';}, inv => inv.shared!.op!.stop ? this.noteStarted(inv, 'shared.stopping', this.stoppingReason(inv)) : this.noteStarted(inv, inv.shared!.op!.holding !== undefined ? 'shared.holding' : null, inv.shared!.op!.holding !== undefined ? `${inv.shared!.load.name} stands, held by the crew (${inv.shared!.op!.id}); stop-carry:${inv.shared!.op!.id} lowers it back where it lay.` : null));
    if (!inv) return;
    const s = inv.shared!, text = raises(s) ? `The way is clear again: the crew goes on ${s.op!.stop ? 'lowering' : 'raising'} ${s.load.name}.` : seats(s) ? `The way is clear again: the crew goes on ${s.op!.stop ? 'lowering' : 'lifting'} ${s.load.name}.` : s.op!.stop ? `The way is clear again: the crew goes on setting ${s.load.name} down safely.` : `The way is clear again: the crew carries ${s.load.name} on to ${s.destination.name}.`;
    for (const m of this.sharedMembers(inv)) this.p.deliver(m.soulId, 'shared.resumed', {op: s.op!.id, text, untrusted: true});
    this.p.spectate({kind: 'shared', op: {id: s.op!.id, invite: inv.id, load: s.load.entity, phase: s.op!.phase}, untrusted: true});
  }
  /** A member's receipt reason while the formation is held up: what holds it, that the load stays held, what frees it. A
   *  route cut is searched from where the crew stands to the destination only; a search stopped at its pose budget is
   *  said as such, never as proof that there is no other way. */
  private heldUpReason(inv: Invite, st: CarryIssue, blocker: string | null, lasting: boolean): string {
    const s = inv.shared!, crew = listed(this.sharedMembers(inv).map(m => m.name)), who = blocker ?? 'someone', code = st.code;
    if (seats(s)) return `${crew} hold ${s.load.name} where it is (${this.beamWhy(st)}; ${code}); it stays held, nobody lets go, and it goes on once that clears.`;
    if (raises(s)) return `${crew} hold ${s.load.name} where it is (${this.raiseWhy(st)}; ${code}); it stays held, nobody lets go, and it goes on once that clears.${s.op?.stop ? ` ${this.stopWords(s.op.stop)}; it is lowered as soon as it can be.` : ''}`;
    const searched = st.details?.exhausted === true ? num(st.details.expanded) : null;
    const what = code === 'carry.path-occupied' ? `${crew} hold ${s.load.name} and wait for ${who} to move out of the way to ${s.destination.name}`
      : code === 'carry.pickup-occupied' ? `${crew} wait for ${who} to move off a grip position before lifting ${s.load.name}`
      : code === 'carry.setdown-occupied' ? `${crew} hold ${s.load.name} at ${s.destination.name} and wait for ${who} to move off where it must be set down`
      : code === 'carry.route-blocked' ? `The way to ${s.destination.name} is now blocked${blocker ? ` by ${blocker}` : ''}${searched !== null
        ? `; a search of ${searched} poses found no other way from here, which does not prove there is none` : ' and there is no other way from here'}; ${crew} hold ${s.load.name} where they are (it stays supported)`
      : `${crew} carrying ${s.load.name} are held up (${code})`;
    const frees = code === 'carry.route-blocked' ? `clearing ${blocker ?? 'the obstacle'} lets the carry go on` : `the carry goes on once ${who} moves`;
    const stop = s.op?.stop ? ` ${this.stopWords(s.op.stop)}; the load is set down once the crew can move to a clear spot.` : '';
    return (lasting ? `${what}. It has lasted ${Math.round(SHARED_LASTING_TICKS / 20)} s; nobody lets go on a timeout, and ${frees}.` : `${what}; ${frees}.`) + stop;
  }
  /** Restart: a member's started receipt of an operation the journal still runs is left to the shared reconcile, which
   *  follows it while the restored world runs its programme and otherwise ends it for every member with the reason
   *  (PC10, #689), never as a lone receipt lost on restart. */
  sharedLive(receiptId: string): boolean {
    const inv = this.inviteForReceipt(receiptId), op = inv?.shared?.op;
    return !!inv && !!op && inv.state === 'committed' && op.phase !== 'ended';
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
  /** PC05: the placed def ref with its revision of a world thing (god/held.ts sets it), for the load's identity. */
  thingDef?: (id: string) => string | null;
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
    const partner = this.partnerBodyProblem({name: g.name, entityId: g.entityId}, 'give'); if (partner) return partner;
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
    for (const s of out) if (s.verb === 'mars:hand_over_v1') {s.params.group = id;if(tag.custodyPolicy)s.params.custodyPolicy=tag.custodyPolicy;}
    const meetAt: V2 = meet[0]?.verb === 'walk_to' ? meet[0].params.to as V2 : [r2(me.pose.p[0]), r2(me.pose.p[2])];
    return {steps: out, commit: receipt => {
      const inv: Invite = {id, what: 'hand-over', kind: 'give', host: {soulId: soul.soulId, name: soul.name}, guests: [{soulId: g.soulId, name: g.name}], capability: cap.id, meetAt,
        label: `wants to give you the ${tag.name}`, thing: {id: tag.item, name: tag.name}, ...(tag.custodyPolicy?{custodyPolicy:tag.custodyPolicy}:{}), createdTick: this.tick, expiresTick: this.tick + 30 * 20, state: 'pending', responses: {}, hostReceipt: receipt, guestReceipts: {}};
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
      steps: [...this.standFirst(soul.entityId), ...go, {verb: 'mars:hand_over_v1', params: {mode: 'receive', partner: host.entityId, item: thing.id, group: inv.id, waitSeconds: 40, ...(inv.custodyPolicy?{custodyPolicy:inv.custodyPolicy}:{})}}]};
  }

  // ---------------------------------------------------------------- receipts, follows, time
  /** Receipt phase changes (live): items change hands, invitations close with their host's act, follows end. */
  onReceipt(r: EdgeReceipt) {
    if (r.phase === 'started' || r.phase === 'waiting') return;
    this.sharedMemberEnded(r);
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
      this.failShared(inv, 'shared.left', `${inv.host.name} did something else, so the shared ${opWord(inv)} is off; nothing was lifted.`);
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
    this.sharedReconcile();
    const tick = this.tick, carriers = (menuWorldOf(this.p.host) as unknown as {carriers?: () => {id: string; state: {phase: string; hold?: unknown}}[]}).carriers?.() ?? [];
    for (const inv of this.pending()) {
      // a ride invitation closes once the basket has gone (or stopped keeping the place)
      const gone = inv.kind === 'ride' && (() => {
        const c = carriers.find(x => x.id === inv.ride?.carrier), boarding = inv.hostReceipt ? ['started', 'waiting'].includes(this.p.receipt(inv.host.soulId, inv.hostReceipt)?.phase ?? '') : false;
        return !c || c.state.phase === 'aloft' || c.state.phase === 'landed' || (!boarding && !c.state.hold);
      })();
      if (tick <= inv.expiresTick && !gone) {if (inv.kind === 'shared') this.sharedCheck(inv); continue;}
      const open = inv.guests.filter(g => !inv.responses[g.soulId]);
      for (const g of open) {inv.responses[g.soulId] = 'expired'; this.p.deliver(g.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, from: inv.host, text: `${inv.host.name}'s invitation (${inv.what}) lapsed.`, untrusted: true});}
      inv.state = 'closed'; this.saveInvite(inv);
      if (open.length) this.p.deliver(inv.host.soulId, 'invite.expired', {invite: {id: inv.id, what: inv.what}, text: `No answer from ${listed(open.map(g => g.name))} (${inv.what}).`, untrusted: true});
      if (!Object.values(inv.responses).includes('accepted') && (inv.kind === 'paired' || inv.kind === 'give')) this.hostAlone(inv, 'invite.expired', `No answer from ${listed(open.map(g => g.name))}.`);
      // PC04: a shared proposal that never started lapses for every member (expiry never applies after a commit, PC05)
      if (inv.kind === 'shared') {
        const why = open.length ? `No answer from ${listed(open.map(g => g.name))}; the shared ${opWord(inv)} lapsed and nothing was lifted.` : `The shared ${opWord(inv)} did not start before the proposal lapsed; nothing was lifted.`;
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
    // PC08: "stop carrying", "put it down", "stop the carry" by a member of a running shared carry is its safe stop
    if (/^(?:stop|quit|halt)\s+(?:the\s+)?(?:carry(?:ing)?|hold(?:ing)?|rais(?:e|ing))\b|^(?:put|set|lower) (?:it|the \S+|\S+)(?: down)?\b|^let'?s? (?:put|set|lower) it(?: down)?\b/.test(t)) {const stop = caps.find(c => c.verb === 'stop-carry'); if (stop) return {capability: stop.id, note: 'Stop the shared carry: the crew sets the load down safely first.'};}
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
    // #435: "take a bite of the bun" is a bite, not a take
    const pick = /^(?!take\s+(?:a\s+)?bite\b)(?:pick\s+up|take|grab|get|fetch|collect|pluck|borrow)\s+(?:me\s+)?(?:(?:a|an|some|the|one)\s+)?(.+)$/.exec(t);
    // #435: "take the book from the swap shelf" names the container it is kept in; when a take out of that container is on
    // offer, the storage words (vocabulary storeWords) resolve it, not the item-kind words below
    const from = pick && /^.+?\s+(?:out\s+of|out\s+from|from|off\s+of|off)\s+(.+)$/.exec(pick[1]), boxWords = from ? from[1].split(/\s+/).filter(w => !['the', 'a', 'an', 'my', 'your'].includes(w)) : [];
    if (from && boxWords.length && caps.some(c => c.verb === 'pick-up' && / out of /.test(c.label) && boxWords.every(w => c.label.toLowerCase().split(' out of ').slice(1).join(' ').split(/[^a-z0-9]+/).includes(w)))) return null;
    // #435 (W068): the same for a hiding place named by those words: what is in it is found by its search
    if (from && boxWords.length && caps.some(c => c.verb === 'search' && boxWords.every(w => c.label.toLowerCase().split(/[^a-z0-9]+/).includes(w)))) return null;
    if (pick && !/^(?:a\s+)?(?:walk|stroll|nap|seat|rest|break|swim|ride|look|dip|turn|picture|down\s|on\s)/.test(pick[1]) && !/\b(?:read|reading|write|writing)\b/.test(pick[1])) {
      const what = pick[1], kind = ITEM_WORDS.find(([, re]) => re.test(' ' + what + ' '))?.[0];
      if (kind) {
        if (held) return {code: 'hands.full', reason: `You are holding ${held.name}; put it down or give it away first.`, did_you_mean: caps.filter(c => c.id === 'put-down:here' || c.verb === 'give').slice(0, 4).map(c => ({id: c.id, label: c.label}))};
        const lying = caps.filter(c => c.verb === 'pick-up' && c.target?.kind === 'item' && this.item(c.target.id)?.kind === kind)[0];
        // entry 43: a world thing of that word lying near (a god-built mug): the one called exactly that first, then one whose
        // name has the words, nearest first (labels end "(N m)"); a space in the words matches a name's hyphen or underscore.
        // With a place's prop of the kind on offer, a real thing must be free to take, and then: #435: one word wins within
        // REAL_THING_NEAR ("pick up the apple" is the apple on the table; one further off does not take a Soul away from the prop
        // beside her). #437: a name of more than one word wins wherever it is ("the coffee mug" by a tea room is the god-built
        // coffee-mug). A lying prop still comes first.
        const source = caps.find(c => c.id === 'pick-up:' + kind);
        const w = what.replace(/^(?:the|a|an|my|that|this)\s+/, '').trim(), wre = w.replace(/[-_]+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).join('[^a-z0-9]+'), wordEnd = /\d$/.test(wre) ? '[^a-z0-9]' : '[^a-z]';
        const named = !lying ? caps.filter(c => c.verb === 'pick-up' && c.target?.kind === 'item' && /^e_/.test(c.target.id)).map(c => {const n = (c.label.replace(/^(?:Pick up|Take)\s+/, '').replace(/(?:\s+\([^)]*\))?\s+out of\s.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').split('/').pop() ?? '').toLowerCase(), d = Number(/\(([\d.]+) m/.exec(c.label)?.[1] ?? 99);
          return {c, rank: n === w || n.replace(/[-_]+/g, ' ') === w ? 0 : wre && new RegExp(`(^|[^a-z])${wre}(${wordEnd}|$)`).test(n) ? 1 : 9, d};}).filter(x => x.rank < 9 && (!source || (x.c.available && (/[\s_-]/.test(w) || x.d <= REAL_THING_NEAR)))).sort((a, b) => a.rank - b.rank || a.d - b.d)[0]?.c : undefined;
        if (named) return {capability: named.id, note: `${raw} is ${named.id} (${named.label})`};
        const c = lying ?? source;
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
