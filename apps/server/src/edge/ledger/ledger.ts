import {handActuatorFrame} from '../../../../../mars/viewer/engine/social/hand-actuator.ts';
// Core-Ledger: capabilities v2, direct act with durable receipts, Tier 1 observe, map,
// and the read-only hooks Core-Comms routes events and speech with. No model calls.
import {StallGuard} from './stall-guard.ts';
import {randomUUID} from 'node:crypto';
import {hasDeclaredProfile} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';
import {DT} from '../../../../../mars/viewer/engine/runtime/runtime.ts';
import {bodyCapabilityProblem,bodyVerbProblem,isRigidBody,shapeRigidCapabilities} from '../body/actions.ts';
import {interiorShellPolygon} from './nav.ts';
import {inPoly} from './places.ts';
import {outdoorRegionExclusions} from './region-arrival.ts';
import type {Program} from '@sim/engine-contract';
import {clockAt} from '@sim/brain';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {WorldHost, Mind} from '../../world.ts';
import type {Db} from '../../db.ts';
import {readHumanCapabilitiesV1, type HumanBindingV1} from '../../human-capabilities.ts';
import {stateOf, bodyState, bodyWords, notYet, type ApproachV1, type BodyStateV1} from '../../body-state.ts';
import {humanBlockedExplanationV1} from '../../human-wait-condition.ts';
import {menuWorldOf, type MenuWorld} from '../../split/menu-world.ts';
/** RT: route refusals that hold until the world itself changes (not a crowd, a search limit or a start a step clears). */
const ROUTE_DEAD = new Set(['route.unreachable', 'route.goal-blocked', 'route.link-unusable', 'route.unknown-level']);
/** BS3: refusals a plain walk answers with its closest approach (the fine planner's; ground.* keep their named refusals). */
const APPROACH_CODES = new Set(['route.unreachable', 'route.goal-blocked']);
const STUCK_RADIUS = 0.34;
/** D2: a seat this close (m) with no enclosure boundary between is "here" for sit:here: a few steps (a fire-circle log, the
 *  bench by the fountain), never the 30 m walk to a chair in another house. 3 m failed the party and activities gates. */
export const HERE_SEAT_M = 8;
const STUCK_REASON = 'The walk made no headway for 30 seconds, even after looking for another way from where it stood; choose another way or somewhere else.';
import {EdgeError, type EdgeCapability, type EdgeLedgerHooks, type EdgeReceipt, type EdgeSoul, type NearbyBody, type PlaceRef,type ObjectBodyAdmission} from '../contract.ts';
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import {PlaceIndex, centroid, derivePlaceData, happenings, validatePlaceData, type PlaceData,type Place} from './places.ts';
/** Loops round a place (jog/run/cycle-around) are offered within this distance of its outline (m). */
const AROUND_REACH = 150;
const bboxDistance = (p: [number, number][], at: [number, number]) => {let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) {if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;} return Math.hypot(Math.max(0, x0 - at[0], at[0] - x1), Math.max(0, z0 - at[1], at[1] - z1));};
/** Places wider than this (m, either side of their box: a backdrop wood, a mountain, the sea) get no loop or stroll: a loop
 *  through 5 spread points of one reads every nav tile under it (walk there, then stroll or wander). */
const LOOP_SPAN = 160;
const bboxSpan = (p: [number, number][]) => {const xs = p.map(q => q[0]), zs = p.map(q => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));};
const area = (p: [number, number][]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;
import {resolveCapability, tokens, placeMatch, placeMatchTier, typoFix, wordsFocusVerbsV1, walkKeepV1, type VocabContext, type VocabResult} from './vocabulary.ts';
import {isCampfire} from './fire.ts';
import {activityCapabilities, activityMayOffer, loadSpots, ACTIVITY_SECONDS_MAX, SPOT_ACTIVITIES, SPOT_REACH, type SpotsData} from './activities.ts';
import type {ContactActuatorIntent,ContactActuatorService} from '../../god/contact-actuator.ts';
import type {DoorPassage,DoorPassageRefusal} from '../../god/door-passage.ts';
import type {PaintingIntent, PaintingService} from '../../art/painting-completion.ts';
import {humanoidDims} from '../../../../../mars/viewer/engine/bodies/humanoid.ts';
import {Together, PAIRED, togetherMayOffer, type TogetherPlan} from './together.ts';
import {semanticDiscovery, PURPOSE} from '../intents/semantic-discovery.ts';
import {knownPart} from '../intents/resolved-parts.ts';
import {Intents,walkWithDestinationWords,walkWithFallback, attentionWords, offeredAttention, type IntentInput} from '../intents/intents.ts';
import {classWords} from '../intents/class-words.ts';
import {offerCheck, strictCheck, type OfferRefusal} from '../intents/strict.ts';
import {paramsByVerb, type ParamSchema} from '../intents/offer-schema.ts';
import {bodyEnd} from '../perception/here.ts';
import {bootAliases,explicitPlaceCapability,knownBootPlaces,lookupPlaceIdentity,resolvePlaceForVerb} from '../boot/world-places.ts';
import {ActionOutcomes,outcomeParams,type ConfirmedEffects} from '../outcomes/store.ts';
import {holdingFact,receiptItemOp,confirmedTogetherEffects,confirmedObjectEffects} from '../outcomes/effects.ts';
import {resolveMailRecipient} from '../outcomes/recipients.ts';
import {terminalSnapshot} from '../outcomes/providers.ts';
import {EDEN_LIBRARY_CATALOGUE} from '../content/eden-library-catalogue.ts';
import {isVerificationProbe, PROBE_OWNER} from '../../verification-probe.ts';
import {tx,afterCommit} from '../comms/store.ts';
import {PlaceKnowledge} from '../perception/knowledge.ts';
import {menuStats, countClear, cpuNow, MENU_ORACLE} from './menu-stats.ts';
import {pageCapabilities, pageObjects, type LoadLevel, type Omitted, type Where} from './listing.ts';
import {focusFor, focusObjects, focusSig, wants, type MenuFocus} from './focus.ts';
import {BodyRule, BODY_PATH_SAMPLE_M, type BodyKnobs, type BodySoul, type Posture} from './body-rule.ts';

type Resolved = {from: string; to: string; note: string};
const WAIT_CODES = new Set(['program.safe-stop-required', 'program.safe-stop-pending']);
/** PC05 (#684): native carry refusals that can pass (someone in the way, the load reserved); a shared commit waits on them.
 *  Any other `carry.*` refusal is permanent; any other code waits until the proposal lapses. */
const SHARED_CARRY_WAIT = new Set(['carry.item-unavailable', 'carry.path-occupied', 'carry.pickup-occupied', 'carry.setdown-occupied', 'carry.route-blocked', 'carry.target-blocked']);
const WAIT_LIMIT_TICKS = 20 * 60;   // a waiting receipt that cannot start within a minute fails
const NEAR_RADIUS = 20, GO_NEAR_RADIUS = 60;
/** srv-act-words (C): the destination words of a focus-shaped walk (vocabulary WORDS_FOCUS_SHAPE's walk arm). */
const WALK_DEST = /^(?:please )?(?:go|walk|head)(?: over| back)? (?:to|into|inside|towards?) ([a-z0-9' -]+?)[.!]?$/;
/** srv-act-words (C): whether a walk's destination words name a place, per vocabPlaces listing (its value object). */
const NAMES_PLACE = new WeakMap<object, Map<string, boolean>>();
/** L3 menu cache: a kept menu is rebuilt at least this often (2 min: anything it reads without a version, e.g. a far
 *  Soul's ambient sit), in cells of this size, bumped for Souls within this reach (fires 150 m). */
// MENU_REACH_M covers SPOT_REACH: an activity spot is offered up to 200 m off, and a claim on it (an act whose target it
// is) bumps the spot's cell, so every Soul that may list it rebuilds
const MENU_MAX_AGE_TICKS = 2400, MENU_CELL_M = 32, MENU_REACH_M = SPOT_REACH;
/** L3 (b): a kept words menu (wordsMenu) serves at most this long, and while my own position stays in one cell of this size. */
const WORDS_MAX_AGE_TICKS = 200, WORDS_CELL_M = 2;
/** L3 item 4 (a): why a focused build was not kept (counters `one.focus*`; key misses by the part of `menuKey` that moved,
 *  named from the key's end because the static/input parts may themselves hold '|'). */
const KEY_TAIL = ['near', 'clock', 'faded', 'ride', 'pose', 'cells', 'together', 'menuGen'];
function countFocusMiss(mine: Map<string, unknown> | undefined, kept: {tick: number; key: string} | undefined, key: string, tick: number, readsHeld: () => boolean) {
  const c = menuStats.one, inc = (k: string) => {c[k] = (c[k] ?? 0) + 1;};
  if (!kept) {inc(mine?.size ? 'focusMissSig' : 'focusMissAbsent'); return;}
  if (kept.key !== key) {
    const a = kept.key.split('|').reverse(), b = key.split('|').reverse();
    let part = 'staticOrInputs'; for (let i = 0; i < KEY_TAIL.length; i++) if (a[i] !== b[i]) {part = KEY_TAIL[i]; break;}
    inc('focusMissKey_' + part); return;
  }
  if (tick - kept.tick >= MENU_MAX_AGE_TICKS) {inc('focusMissAge'); return;}
  if (!readsHeld()) inc('focusMissReads');
}
const OPEN: EdgeReceipt['phase'][] = ['waiting', 'started'];
/** An object whose place is not known: ranked after everything placed (listed only at green, if the page has room). */
const FAR: [number, number] = [1e9, 1e9];
const WITH_PARAM = {type: 'array', items: 'Soul id or name', optional: true, description: 'Invite Souls near you; each joins only if they accept (shared walk / ride).'};
type Row = {created_at: number; receipt_id: string; soul_id: string; capability: string; phase: EdgeReceipt['phase']; accepted_tick: number; started_tick: number | null; ended_tick: number | null; code: string | null; reason: string | null; program_id: string | null; client_ref: string | null; plan?: string | null; detail?: string | null};
type Pending = {receipt: string; soul: EdgeSoul; steps: Program['steps']; label: string; deadline: number; capability: string};
type StandReleaseV1={actor:string;owner:string;seats:{action:string;slot:string}[]};

/** The body plans behind a Soul's offered capabilities, by capability id. */
type MenuReads = {taken: {at: [number, number]; v: boolean}[]; groups: Map<string, number>};
type Plans = Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>;

type WalkProfile=(soul:EdgeSoul,caps:EdgeCapability[],plans:Plans)=>void;
type ExactWalkProfile=(soul:EdgeSoul,asked:string,caps:EdgeCapability[],plans:Plans)=>boolean;
type ExactWalkBindings={caps:EdgeCapability[];plans:Plans;tick:number};
type CapabilityProvider=(soul:EdgeSoul,only?:ReadonlySet<string>,places?:Map<string,string>)=>EdgeCapability[];
/** warmForServing's account: busy ms in all, wall ms from start to end, its slices before the listing and the longest of
 *  them, the final listing's ms, and whether it was stopped (shutdown) before the listing. */
export type ServingWarm = {souls: number; failed: number; ms: number; wallMs: number; slices: number; maxStepMs: number; listingMs: number; stopped: boolean};
/** A serving warm's slice (ms) between turns of the event loop: well under the 100 ms a visitor's frame notices. */
const SERVING_SLICE_MS = 40;
/** How long a rich read waits for a serving warm before building its menu itself (ms). Eden 2026's warm took ~2 s on
 *  a development machine and ~4 s on the former production host in one go; slices also allow other requests to run. */
export const SERVING_WAIT_MS = 15_000;
const nextTurn = () => new Promise<void>(r => setImmediate(r));

/** #824: how many offers a "nothing matches" refusal names as `alternatives`, and verbs never offered as one. */
const ALTERNATIVES = 3, NOTHING_MATCHES = new Set(['capability.unknown', 'place.unknown']);
const SIT_WORDS = new Set(['sit', 'seat', 'sit-ground']), WALK_WORDS = new Set(['walk', 'go', 'head', 'jog', 'run', 'stroll', 'go-near']);
type Alternative = {id: string; label: string; why: string; partial?: true};
export class EdgeLedger implements EdgeLedgerHooks {
  places: PlaceIndex;
  private receiptListeners: ((r: EdgeReceipt) => void)[] = [];
  private placeListeners: ((e: {soulId: string; from: string | null; to: string | null; tick: number}) => void)[] = [];
  private providers: CapabilityProvider[] = [];
  /** L3: each object offer's place, as the object providers last built it (the listing's page ranks object offers by it). */
  private objectPlaces = new Map<string, string>();
  private exactWalkObjectProviders=new WeakSet<CapabilityProvider>();
  private exactWalkProfiles=new WeakMap<WalkProfile,ExactWalkProfile>();
  /** Installed only by the native authored-place bridge; no names/aliases. */
  exactAuthoredWalkRef?: (ref:string)=>boolean;
  /** Canonical AREA only: missing from a full listing can mean bounded listing
   * truncation; this hook certifies the identical ordinary on-demand choice. */
  exactAuthoredAreaWalkRef?: (ref:string)=>boolean;
  /** Explicitly opt a known profile wrapper into exact-walk projection. Any
   * unknown wrapper/provider keeps the full authoritative listing path. */
  registerExactWalkProfile(profile:WalkProfile,previous:WalkProfile|undefined,extend?:ExactWalkProfile){
    const prior=previous?this.exactWalkProfiles.get(previous):()=>true;if(!prior)return;
    this.exactWalkProfiles.set(profile,(soul,asked,caps,plans)=>prior(soul,asked,caps,plans)&&(extend?.(soul,asked,caps,plans)??true));
  }
  /** MW: a world profile (worlds/*: Mars camp work, floater bodies) adds planned capabilities and drops ones its bodies cannot do. */
  /** R4-LIVE (god worlds only): the weather now, for `here` and Eyes; unset on the live worlds (engine env.weather). */
  weatherNow?: () => {clouds: number; rain: number; wind: number; fog: number; kind: string; lightning: number};
  /** GOD-ENV: what a Soul at (x, z) perceived of the lightning in the last minute (god worlds only). */
  lightningNear?: (x: number, z: number) => {last: string; strikes: number; nearest: number} | null;
  /** Stage B: god/lightning.ts installs it; the verdict pump ships the list so a read worker answers lightningNear. */
  recentStrikesV1?: () => {x: number; z: number; tick: number; god?: boolean}[];
  worldProfile?: (soul: EdgeSoul, caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>) => void;
  /** A world target whose physical use is unsupported must refuse, even during quiet renewal.
   * Checked on admission/dispatch/completion, never by a per-tick world scan. Historical terminal receipts stay immutable. */
  /** `steps`, when known, is the body plan about to run for the capability (beds/1: a bed is used only by its native berth). */
  nativeUseRefusal?: (capability: string, steps?: Program['steps']) => {code: string; reason: string} | null;
  /** World-engine easels only; installed alongside the existing art media routes. */
  painting?: PaintingService;
  contactActuator?: ContactActuatorService;
  /** CTRL-2 (#1094): a thing its container keeps out of sight (shut, or a hiding place); set by the engine bridge. */
  concealedThing?: (id: string) => boolean;
  /** CTRL-2 (#1094): a built thing's own name, as offers call it; set by the engine bridge. */
  thingName?: (id: string) => string | null;
  /** Soul Actions entry 31 (god worlds, god/door-passage.ts): a plain walk a closed, permitted door walls off goes through it. */
  doorPassage?: (soul: EdgeSoul, steps: Program['steps'], what: string) => DoorPassage | DoorPassageRefusal | null;
  /** World-engine worlds only (god/places.ts): places walkable without being native engine regions (a god's plaza, a
   *  room of a god's house). Unset on Eden/Mars/LM, where walkability stays `id in regions` exactly. */
  placeWalkable?: (placeId: string) => boolean;
  /** World-engine worlds only (god/nav.ts): a walk to a named place beyond the listing's radius (a far big top), added to
   *  this act's capabilities on demand; true when one was added. Unset elsewhere. */
  walkOnDemand?: (soul: EdgeSoul, placeId: string, caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>) => boolean;
  /** RT: a jog or run to a named place the listing offers no gait for (a building or a room: those are walk-only in the
   *  listing): jog/run to its front door, then walk inside. Adds `<gait>:<placeId>` to copies; true when added. */
  gaitOnDemand?: (soul: EdgeSoul, placeId: string, gait: 'jog' | 'run', caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>) => boolean;
  /** World-engine worlds only (god/nav.ts), RESOLVE: a walk to standing room next to the nearest named thing whose own name
   *  or kind is all of `ask` (the horse, not the lawn whose description lists one), added to copies; its id, or null. */
  thingOnDemand?: (soul: EdgeSoul, ask: string[], caps: EdgeCapability[], plans: Plans) => {id: string; count: number} | null;
  /** World-engine worlds only, RESOLVE2: a re-sent `walk:<thing or room ref>` id (thingOnDemand's offer) offered again; true when added. */
  walkRefOnDemand?: (soul: EdgeSoul, ref: string, caps: EdgeCapability[], plans: Plans) => boolean;
  /** World-engine worlds only, RESOLVE: a building's floor as its main room ("go upstairs", "go inside the cottage and go
   *  upstairs"), added to copies, or why not. Null when it could not be worked out. */
  floorOnDemand?: (soul: EdgeSoul, q: {ask: string[]; prefer?: string; floor: 'up' | 'down' | 'top' | number}, caps: EdgeCapability[], plans: Plans) => {id: string; note: string} | {code: string; reason: string} | null;
  /** World-engine worlds only, floors (2026-10-26): the floor plates (a building's raised floor) within `radius` of `at`:
   *  whether the point is on one, how far one is, how high above the terrain it lies and which sides are open (world
   *  outward normals of the edges a body can step across). */
  floorsNear?: (at: [number, number], radius: number) => FloorNear[];
  /** World-engine worlds only, RESOLVE: where a named thing that is not an engine body stands ([x, z]), by entity id. */
  thingAt?: (id: string) => [number, number] | null;
  /** World-engine worlds only, RESOLVE: the words of named things (beyond the listing), for reading a misspelt name. */
  thingWords?: () => string[];
  /** World-engine worlds only: called before the map is read, so a god's edit shows on the next `map`. Unset elsewhere. */
  beforeMap?: () => void;
  private pending = new Map<string, Pending>();           // soulId → waiting act
  private lastPlace = new Map<string, string | null>();
  /** Server start (ms): metrics count world model calls only from here, not copied history. */
  readonly startedAt = Date.now();
  private capCache = new Map<string, {tick: number; key: string; reads: MenuReads; value: {caps: EdgeCapability[]; plans: Plans}; last?: {tick: number; sig: string; value: {caps: EdgeCapability[]; plans: Plans}}}>();
  comms?: {streams: {headCursor(soulId: string): string;deliver?(soulId:string,kind:string,tick:number,body:Record<string,unknown>):unknown}; fading: {status(soulId: string): unknown; touch?(soulId: string): void}; objects: {prepareAct?(id:string,soul:EdgeSoul,input:Record<string,unknown>):ReturnType<import('../comms/objects/framework.ts').Objects['prepareAct']>;act?(id: string, soul: EdgeSoul, input: Record<string, unknown>): unknown;get?(id:string,soul:EdgeSoul):unknown; visibleTo(soul: EdgeSoul): unknown[]; create(i: {id: string; kind: string; name: string; description?: string; placeId: string; params?: Record<string, unknown>}): {id: string}; has?(id: string): boolean; all(): {id: string; kind: string; placeId: string; state: unknown}[]}; close(): void};
  attachComms(c: NonNullable<EdgeLedger['comms']>) {
    this.comms = c;this.notifyMail();
    // Re-deliver only persisted post-feature terminal projections whose event marker was not committed.
    if(this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE name='edge_comms_receipts_seen'").get())for(const r of this.db.db.prepare("SELECT r.* FROM edge_receipts_v1 r JOIN edge_outcomes_v1 o ON o.world_id=r.world_id AND o.receipt_id=r.receipt_id LEFT JOIN edge_comms_receipts_seen seen ON seen.world_id=r.world_id AND seen.receipt_id=r.receipt_id AND seen.phase=r.phase WHERE r.world_id=? AND seen.receipt_id IS NULL ORDER BY r.created_at,r.receipt_id").all(this.host.worldId) as Row[])this.emit(this.view(r));
    // intents/1 auto-face: conversation members turn their heads to whoever speaks (default on)
    try {(c as unknown as {onSpectator?(l: (m: {kind: string; conversation?: string; turn?: {from?: {soulId: string}}}) => void): void}).onSpectator?.(m => {
      if (m.kind !== 'conversation.turn' || !m.conversation || !m.turn?.from) return;
      const members = this.coreA.conversations().find(x => x.id === m.conversation)?.members ?? [];
      // LINK BODY: a turn addressed to a member ends its idle reflex
      for (const id of members) if (id !== m.turn.from.soulId) try {this.bodyRule?.poke(id);} catch {/* best effort */}
      try {this.intents.onTurn(m.conversation, m.turn.from.soulId, members);} catch {/* attention is best effort */}
    });} catch {/* no spectator hook: auto-face off */}
    // C9 body effects (fading itself only runs when Comms' fading flag is on — Gene has not approved it).
    const fading = (c as unknown as {fading?: {onFade?(l: (e: {soulId: string; change: string}) => void): void; gone?(): string[]; onTouch?(l: (soulId: string) => void): void; addKept?(k: (soulId: string) => string | null): void}}).fading;
    // LINK BODY: every accepted action wakes the body (body-rule.ts)
    fading?.onTouch?.(id => {try {this.bodyRule?.touch(id);} catch {/* best effort */}});
    // PC09: a member of a running shared carry neither reclines on fading nor lands at a starting place on return
    fading?.addKept?.(id => {const r = this.sharedCarry ? this.together.sharedRunning(id) : null; return r ? `the shared carry (${r.op})` : null;});
    const fadeOut = (soulId: string) => {
      const m = this.host.minds.get(soulId); if (!m) return;
      this.faded.add(soulId); this.pending.delete(soulId);
      // PC09 (#688, PC02 §3): a member of a running shared carry keeps its receipt, and the fade is its stop with the
      // supported cleanup (the op's programme is stopped untilSafe, never cut); the receipt ends with the crew's result
      const shared = this.sharedCarry ? this.together.sharedRunning(soulId) : null;
      // Not replaced by the Soul's own act: its open receipts end failed, so agents can tell why.
      for (const r of this.openReceipts(soulId)) if (r.id !== shared?.receipt) this.update(r.id, {phase: 'failed', code: 'soul.faded', reason: 'This Soul faded out after an hour without an accepted action; act again to come back.'});
      if (shared) {if (!shared.stopped) this.awayStop(soulId, m.name, shared); return;}
      try { if (this.host.engine.programOf(m.entityId)) void this.host.enqueue('edge-stop', `edge:${soulId}`, {soulId, entityId: m.entityId, why: 'faded'}).catch(() => {/* best effort */}); } catch { /* clock not ready: ambient skips faded Souls anyway */ }
    };
    fading?.onFade?.(e => {
      if (e.change === 'removed') fadeOut(e.soulId);
      // Reclaimed by speech/converse/object acts (not through act()): land at a starting place like act() does.
      else if (e.change === 'reclaimed' && this.faded.delete(e.soulId)) {
        const m = this.host.minds.get(e.soulId);
        try { if (m && !this.inSharedCarry(e.soulId)) void this.host.enqueue('edge-relocate', `edge:${e.soulId}`, {soulId: e.soulId, entityId: m.entityId, to: this.startingPoint(e.soulId), why: 'reclaimed after fading'}).catch(() => {/* best effort */}); } catch { /* clock not ready */ }
        this.dropMenu('reclaimed', e.soulId);
      }
    });
    // `faded` is memory: after a restart re-learn the durable fade roster, or absent Souls look alive
    // (listed in here.souls, animated by ambient life, invitable) until they act again.
    try { for (const soulId of fading?.gone?.() ?? []) fadeOut(soulId); } catch { /* fading table not ready: learned on next change */ }
  }
  /** Souls faded out (removed at 60 min idle); their next act lands them at a starting place. */
  readonly faded = new Set<string>();
  /** LINK BODY: the presence-driven body rule (body-rule.ts: awake / idle / zombie / asleep). On once the edge routes
   *  attach the owner inbox's presence (`attachPresence`); off in tools that build a Ledger alone (walk audit). */
  bodyRule: BodyRule | null = null;
  /** A bridge may defer its first place index. Unknown rooms must not be treated as outdoors. */
  bodyPlacesReady: () => boolean = () => true;
  private bodyMigrated = false;
  attachPresence(inbox: {soulPresence(soulId: string): {listening: boolean; at: number | null}; onSoulListen?(l: (soulId: string) => void): void; onSoulSend?(l: (soulId: string) => void): void}, knobs?: Partial<BodyKnobs>) {
    if (process.env.SIM_BODY === '0' || this.bodyRule) return this.bodyRule;
    // a dev/test world may shorten the clocks (SIM_BODY_KNOBS JSON, DEV_AUTH worlds only); real worlds never
    let env: Partial<BodyKnobs> = {};
    if (process.env.SIM_BODY_KNOBS && process.env.DEV_AUTH === '1') try {env = JSON.parse(process.env.SIM_BODY_KNOBS) as Partial<BodyKnobs>;} catch {/* ignored */}
    const live = (m: Mind) => {const row = this.db.soul(m.soulId); return !!row && row.retired_at === null && row.owner === m.owner && row.entity_id === m.entityId && row.world_id === this.host.worldId;};
    const soulOf = (m: Mind): BodySoul => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner});
    const engine = this.host.engine as unknown as {dryGroundAtV1?: (x: number, z: number) => boolean; clearanceUpToV1?: (x: number, z: number, cap?: number, level?: number) => number; lyingRoomAtV1?: (x: number, z: number, level: number, sampleMargin: number) => boolean};
    this.bodyRule = new BodyRule(this.db.db, this.host.worldId, {
      souls: () => [...this.host.minds.values()].filter(m => !!m.owner && m.owner !== 'system' && !m.native && !this.faded.has(m.soulId) && !!this.body(m.entityId) && live(m)).map(soulOf),
      presence: id => inbox.soulPresence(id),
      createdAt: id => (this.db.soul(id) as {created_at?: number} | undefined)?.created_at ?? null,
      pose: id => {const b = this.body(id); return b ? {x: b.pose.p[0], z: b.pose.p[2], level: b.human?.level ?? 0} : null;},
      posture: id => this.posture(id),
      standby:(s,seconds)=>hasDeclaredProfile(this.body(s.entityId)?.body)?[{verb:'mars:body_motion_v1',params:{motion:'rest',seconds:Math.min(seconds,600)}}]:null,
      standbyLeftMs:id=>{const h=this.body(id)?.human,m=h?.bodyMotionV1;return h&&h.activity==='rest'&&m&&!m.release?Math.max(0,(m.until-1-this.host.engine.world.tick)*DT*1000):null;},   // to its last running tick
      agentBusy: id => this.pending.has(id) || this.openReceipts(id).length > 0 || this.together.awaiting(id) || this.holdingHands(id),
      running: id => !!this.host.engine.programOf(id),
      spatialReady: () => this.bodyPlacesReady(),
      dry: (x, z) => engine.dryGroundAtV1?.(x, z) ?? true,
      clear: (x, z, level, lying) => lying && engine.lyingRoomAtV1
        ? engine.lyingRoomAtV1(x, z, level, BODY_PATH_SAMPLE_M / 2)
        : !(this.host.engine.world as {navV1?: unknown}).navV1 || !engine.clearanceUpToV1 || engine.clearanceUpToV1(x, z, 1, level) >= 0.3,
      places: (x, z, level) => this.places.containing(x, z, this.placeLevel(level)).filter(p => p.enclosed).map(p => p.id).join('|'),
      seat: (soul, radius, seconds) => {
        const {caps, plans} = this.binds(soul), me = this.body(soul.entityId), world = this.host.engine.world as NativeWorld; if (!me) return null;
        // the reflex takes a concrete seat offer, never sit:here (which since D2 carries the nearest seat's target and
        // plan: through it the rule sat but never reached its doze in the 2 h idle test)
        const c = caps.find(c => c.verb === 'sit' && c.id !== 'sit:here' && c.available && c.target && (() => {const e = world.entities[c.target!.id]; return !!e && Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) <= radius;})());
        const plan = c && plans.get(c.id); if (!plan) return null;
        const steps = structuredClone(plan.steps); for (const x of steps) if (x.params && 'seconds' in x.params) x.params.seconds = seconds;
        return steps;
      },
      decide: (soul, option, label, steps) => {
        this.ambientAt.set(soul.soulId, Date.now());   // a posture the rule chose is not the Soul's own choice (postureHold)
        const guard = (): true => {const m = this.host.minds.get(soul.soulId); if (!m || !live(m) || this.pending.has(soul.soulId) || this.openReceipts(soul.soulId).length || this.faded.has(soul.soulId)) throw Error('edge.body-stale'); return true;};
        try {void this.host.enqueueChecked('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option, label, steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-body'}, guard).catch(() => {/* best effort */});} catch {/* clock not ready */}
      },
      stop: soul => {try {void this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, why: 'body'}).catch(() => {/* best effort */});} catch {/* clock not ready */}},
      publish: (soulId, view) => {
        try {(this.comms as unknown as {core?: {spectate(m: object): void}} | undefined)?.core?.spectate({kind: 'body', tick: this.host.engine.world.tick, soulId, ...view});} catch {/* spectators never break the ledger */}
        this.host.markSoulDirty?.(soulId);
      },
    }, {now: this.controlNow, knobs: {...env, ...(knobs ?? {})}});
    this.host.publicBodyOf = id => this.bodyRule?.view(id) ?? null;
    inbox.onSoulListen?.(id => {try {this.bodyRule?.listen(id);} catch {/* best effort */}});
    inbox.onSoulSend?.(id => {try {this.bodyRule?.poke(id);} catch {/* best effort */}});
    return this.bodyRule;
  }
  /** LINK BODY: how a body is held now, in the body rule's words. */
  private posture(entityId: string): Posture {
    const b = this.body(entityId), h = b?.human; if (!b || !h) return 'other';
    if (this.aboard(entityId) || h.carrier) return 'basket';
    const st = stateOf(this.host, entityId);
    if (h.shore || st === 'swimming') return 'water';
    if (st === 'seated') return 'seated';
    if (st === 'lying' || st === 'sleeping' || ['stargaze', 'hammock'].includes(String(h.activity))) return 'lying';
    if (hasDeclaredProfile(b.body) && h.activity === 'rest') return 'standby';
    if (['walking', 'jogging', 'running', 'cycling'].includes(st)) return 'moving';
    return st === 'standing' ? 'standing' : 'other';
  }
  /** LINK BODY migration (once, at the first body sweep, after travel has registered who is away): Souls the old idle beam
   *  took (`gone`, not away) come back as sleeping bodies: where they were if that is dry, clear ground in a place, else at
   *  a starting place. SIM_BODY_MIGRATE=dry reports without changing anything. */
  private migrateGone() {
    const fading = (this.comms as unknown as {fading?: {restoreGone?(dry?: boolean): string[]}} | undefined)?.fading, dry = process.env.SIM_BODY_MIGRATE === 'dry';
    let ids: string[] = [];
    try {ids = fading?.restoreGone?.(dry) ?? [];} catch (e) {console.error('[body] migration', e instanceof Error ? e.message : e); return;}
    if (!ids.length) return;
    const engine = this.host.engine as unknown as {dryGroundAtV1?: (x: number, z: number) => boolean; clearanceUpToV1?: (x: number, z: number, cap?: number) => number}, nav = !!(this.host.engine.world as {navV1?: unknown}).navV1;
    const lines: string[] = [];
    for (const id of ids) {
      const m = this.host.minds.get(id), b = m ? this.body(m.entityId) : undefined; if (!m) {lines.push(`${id} (no body: skipped)`); continue;}
      const p = b ? [b.pose.p[0], b.pose.p[2]] as [number, number] : null;
      // PC10 (#689): a member of a running shared carry stays in its crew (never relocated out of it; PC09 A2c)
      const keep = !!p && (this.inSharedCarry(id) || (b!.human?.level ?? 0) === 0 && (engine.dryGroundAtV1?.(p[0], p[1]) ?? true) && (!nav || !engine.clearanceUpToV1 || engine.clearanceUpToV1(p[0], p[1], 1) >= 0.27) && this.places.containing(p[0], p[1]).length > 0);
      const to = keep ? p! : this.startingPoint(id);
      lines.push(`${id} ${JSON.stringify(m.name)} ${keep ? 'stays' : 'to the arrival point'} at ${to.map(v => Math.round(v * 10) / 10).join(',')}`);
      if (dry) continue;
      this.faded.delete(id); this.dropMenu('soul-gone', id);
      if (!keep && m) try {void this.host.enqueue('edge-relocate', `edge:${id}`, {soulId: id, entityId: m.entityId, to, why: 'back as a sleeping body (LINK)'}).catch(() => {/* best effort */});} catch {/* clock not ready */}
      this.bodyRule?.restoreAsleep({soulId: id, entityId: m.entityId, name: m.name, owner: m.owner});
    }
    console.log(`[body] migration${dry ? ' (dry run, nothing changed)' : ''}: ${ids.length} faded Soul(s) back as sleeping bodies\n  ${lines.join('\n  ')}`);
  }
  private startingPoint(soulId: string): [number, number] {
    // Only starting places on admitted native ground (an engine region of the same id); W1 scenery (e.g. region-*) is never a landing spot.
    const ground = (this.host.engine.world as {regions?: Record<string, unknown>}).regions ?? {};
    const all = [...this.places.byId.values()].filter(p => p.starting && p.parent !== null), native = all.filter(p => p.id in ground);
    const starts = native.length ? native : all;
    const pick = starts.length ? starts[[...soulId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % starts.length] : [...this.places.byId.values()][0];
    // CN5: on clear ground near its centre (a park's centre is its pond, a harbour's is the sea); the centre if none is known
    const clear = (this.host.engine as unknown as {clearSpotsV1?: (p: [number, number][], n: number) => [number, number][]}).clearSpotsV1?.(pick.polygon, 1)?.[0];
    return clear ?? centroid(pick.polygon);
  }
  readonly host: WorldHost; readonly db: Db;
  /** together/1 (core-next4): gestures between Souls, invitations, follows, carried items. */
  readonly together: Together;
  /** knowledge/1: memory of visits per Soul, and the places the world's creator keeps secret. */
  readonly knowledge: PlaceKnowledge;
  /** Ambient life reflex (Gene: Souls visibly alive between agent decisions); the edge server turns it on. */
  readonly ambient: boolean;
  private idleSince = new Map<string, number>();
  private readonly controlNow:()=>number;
  /** Short real-time UI window; affects only new ambient admission, never running work or replay. */
  ownerControlGrace(soulId:string){this.db.db.prepare('INSERT INTO edge_owner_control_v1(world_id,soul_id,until_ms) VALUES(?,?,?) ON CONFLICT(world_id,soul_id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)').run(this.host.worldId,soulId,this.controlNow()+10000);}
  /** entry 35: a Soul holding hands is not idle (ambient life leaves the pair be). */
  private holdingHands(soulId:string){const m=this.host.minds.get(soulId);return !!m&&!!this.together?.handsWith(m.entityId);}
  private ownerControls(soulId:string){const r=this.db.db.prepare('SELECT until_ms FROM edge_owner_control_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId,soulId) as {until_ms:number}|undefined;return !!r&&r.until_ms>this.controlNow();}
  /** activities/1: World's activity spots, shelves, interiors and scenery solids (validated; refused entries listed). */
  private readonly baseSpots: SpotsData;
  /** E-life (world-engine worlds only): activity spots derived from the god's things (god/activity-spots.ts), merged
   *  after the world's own authored spots. Unset on Eden/Mars/LM. Must return the same object while nothing changed. */
  spotsProvider?: () => SpotsData | null;
  private mergedSpots: {from: SpotsData; value: SpotsData} | null = null;
  private spotsSeen: SpotsData | null = null; private spotsSeq = 0; private staticSeq = 0;
  /** L3: the static world's version: the place index's writes, a new spots object (the provider returns the same object
   *  while nothing changed), the engine's navigation epoch (moves with the static world only, not with paged windows),
   *  whether its navigation is warm, and bumpStatic(). Caches of anything read from static geometry key on it. */
  staticVersion(): string {
    const s = this.spots; if (s !== this.spotsSeen) {this.spotsSeen = s; this.spotsSeq++;}
    // (navWarmV1(0): the engine's connectivity labels are ready; until then walk goals off the main ground are not moved
    // onto it, so a listing made during warm-up differs from one made after)
    // the engine's part once per tick (reading it syncs the paged spatial service: ~1 ms each, L3 live-copy profile; a
    // change made between ticks is seen on the next tick, as the tick-keyed menus before L3 saw it)
    const tick = this.mw.world.tick;
    if (this.navSeen?.tick !== tick) {const e = this.mw as unknown as {navEpochV1?(): number; navWarmV1?(budget: number): boolean}; this.navSeen = {tick, v: `${e.navEpochV1?.() ?? 0}`, warm: !!e.navWarmV1?.(0)};}
    return `${this.places.version}.${this.spotsSeq}.${this.navSeen.v}.${this.staticSeq}${this.navSeen.warm ? 'w' : ''}`;
  }
  private navSeen: {tick: number; v: string; warm: boolean} | null = null;
  /** Something static changed that the places, spots and navigation epoch do not show (a god layer switch…). */
  bumpStatic() {this.staticSeq++;}
  get spots(): SpotsData {
    const extra = this.spotsProvider?.(); if (!extra) return this.baseSpots;
    if (this.mergedSpots?.from !== extra) {const b = this.baseSpots; this.mergedSpots = {from: extra, value: {contract: 'activity-spots/1', spots: [...b.spots, ...extra.spots], shelves: [...b.shelves, ...extra.shelves], interiors: b.interiors, solids: b.solids, rings: b.rings, platforms: b.platforms, ...(b.docks || extra.docks ? {docks: [...(b.docks ?? []), ...(extra.docks ?? [])]} : {}), ...(extra.nearest ? {nearest: extra.nearest} : {})}};}
    return this.mergedSpots.value;
  }
  readonly outcomes:ActionOutcomes;
  /** stall-guard/1 (stall-guard.ts): no body stays held by an activity that stopped making progress. */
  readonly stallGuard = new StallGuard({
    tick: () => this.host.engine.world.tick,
    souls: () => [...this.host.minds.values()].filter(m => !!m.owner).map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner})),
    probe: id => this.host.engine.stallProbeV1?.(id) ?? null,
    release: (soul, reason) => this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, stallReleaseV1: reason}),
    record: (soul, reason, detail) => {const r = this.insert(soul, 'stall:released', 'started', undefined, true, detail); this.update(r.id, {phase: 'completed', code: 'stall.released', reason});},
  });
  readonly spotsRefused: string[];
  /** Stage B (split/read-host.ts): a read worker's ledger over a read-only host. The read code runs unchanged; the
   *  constructor skips what writes or hooks into a live host (the restart re-arm loop, approach/recovery hooks, the
   *  host listeners) and `replicaSync()` stands in for the per-tick upkeep the read code depends on. */
  readonly readOnly: boolean;
  /** PC04 (#683): shared physical operations (carry-with). Default off (SIM_SHARED_CARRY=1 or the option) until PC05 commits them. */
  readonly sharedCarry: boolean;
  constructor(host: WorldHost, db: Db, placeData?: unknown, options: {ambient?: boolean; spots?: unknown;now?:()=>number; readOnly?: boolean; sharedCarry?: boolean} = {}) {
    this.host = host; this.db = db; this.ambient = options.ambient === true; this.readOnly = options.readOnly === true;
    this.sharedCarry = options.sharedCarry ?? process.env.SIM_SHARED_CARRY === '1';
    this.controlNow=options.now??Date.now;
    const spots = loadSpots(options.spots); this.baseSpots = spots.data; this.spotsRefused = spots.refused;
    db.db.exec(`CREATE TABLE IF NOT EXISTS edge_receipts_v1 (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, capability TEXT NOT NULL, phase TEXT NOT NULL,
      accepted_tick INTEGER NOT NULL, started_tick INTEGER, ended_tick INTEGER, code TEXT, reason TEXT, program_id TEXT, client_ref TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (world_id, receipt_id));
      CREATE INDEX IF NOT EXISTS edge_receipts_v1_soul ON edge_receipts_v1 (world_id, soul_id, phase);
      CREATE TABLE IF NOT EXISTS edge_refusals_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL, soul_id TEXT NOT NULL, verb TEXT NOT NULL, capability TEXT NOT NULL, code TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edge_refusals_v1_at ON edge_refusals_v1 (world_id, at);`);
    db.db.exec('CREATE TABLE IF NOT EXISTS edge_owner_control_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,until_ms INTEGER NOT NULL,PRIMARY KEY(world_id,soul_id)) WITHOUT ROWID');
    // PM-R055: a waiting act's plan is kept with its receipt so a restart re-arms it instead of losing it.
    if (!(db.db.prepare('PRAGMA table_info(edge_receipts_v1)').all() as {name: string}[]).some(c => c.name === 'plan')) db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN plan TEXT');
    // intents/1 + strict/1 (Core-A): receipt detail {channel, chosen, endedAt} (JSON)
    if (!(db.db.prepare('PRAGMA table_info(edge_receipts_v1)').all() as {name: string}[]).some(c => c.name === 'detail')) db.db.exec('ALTER TABLE edge_receipts_v1 ADD COLUMN detail TEXT');
    // OWNER-DAY: refusals keep the world's reason and the body's position for the owner's timeline.
    {const have = new Set((db.db.prepare('PRAGMA table_info(edge_refusals_v1)').all() as {name: string}[]).map(c => c.name));
      for (const [c, t] of [['reason', 'TEXT'], ['x', 'REAL'], ['z', 'REAL']] as const) if (!have.has(c)) db.db.exec(`ALTER TABLE edge_refusals_v1 ADD COLUMN ${c} ${t}`);}
    this.intents = new Intents(this);
    this.places = new PlaceIndex(this.loadPlaces(placeData));
    this.knowledge = new PlaceKnowledge(this);
    {const paths = new Map<string, string[]>(), path = (sid: string) => this.placePathOf(sid).filter(p => p.kind !== 'occupier').map(p => p.id);
      this.placeListeners.push(e => {if (!e.to) {paths.delete(e.soulId); return;} const now = path(e.soulId); this.knowledge.arrive(e.soulId, now, e.tick, paths.get(e.soulId) ?? []); paths.set(e.soulId, now);});}
    this.outcomes=new ActionOutcomes(db.db,host.worldId);
    this.syncCarrierPlaces();
    // together/1: gestures, invitations, follows and items (core-next4)
    this.together = new Together({host, db, places: this.places, spots: () => this.spots, staticVersion: () => this.staticVersion(),
      body: id => this.body(id), perceived: (id, r) => this.perceivedBodies(id, r), receipt: (sid, id) => this.receipt(sid, id),
      fail: (id, code, reason) => this.update(id, {phase: 'failed', code, reason}), complete: id => this.update(id, {phase: 'completed'}),
      running: (sid, id) => {const m = this.host.minds.get(sid), r = this.rows('receipt_id=?', id)[0]; return !!m && !!r?.program_id && this.host.engine.programOf(m.entityId) === r.program_id;},
      programOf: id => this.host.engine.programOf(id),
      carryState: pid => {const a = this.host.engine.programAction?.(pid), d = a ? this.host.engine.runtime.records.get(a.action.id)?.diagnostic : undefined;
        return a ? {status: a.action.status, verb: a.action.verb, ...(a.action.phase ? {phase: a.action.phase} : {}), ...(d ? {code: d.code, message: d.message, ...(d.subjects ? {subjects: [...d.subjects]} : {}), ...(d.details ? {details: {...d.details}} : {})} : {})} : null;},
      stop: (sid, entityId, receipt) => {try {void this.host.enqueue('edge-stop', `edge:${sid}`, {soulId: sid, entityId, receipt}).catch(() => {/* best effort */});} catch {/* clock not ready */}},
      aboard: id => this.aboard(id), faded: id => this.faded.has(id), innermostPlace: id => {const m = this.host.minds.get(id); return m ? this.innermostPlace(m) : null;},
      deliver: (sid, kind, body) => {try {(this.comms as unknown as {streams?: {deliver?(s: string, k: string, t: number, b: object): void}} | undefined)?.streams?.deliver?.(sid, kind, this.host.engine.world.tick, body);} catch {/* events are best effort */}},
      spectate: m => {try {(this.comms as unknown as {core?: {spectate(m: object): void}} | undefined)?.core?.spectate({tick: this.host.engine.world.tick, ...m});} catch {/* spectators never break the ledger */}},
      touch: id => this.comms?.fading.touch?.(id),
      decide: (soul, receipt, capability, label, steps) => this.decide(soul, receipt, capability, label, steps), sharedCarry: this.sharedCarry,
      start: (id, programId) => this.update(id, {phase: 'started', program_id: programId, code: null, reason: null}),
      note: (id, code, reason) => this.update(id, {code, reason}),
      stopOp: (entityId, programId, op, why) => {try {void this.host.enqueue('edge-stop', 'edge:shared', {entityId, programId, op, why}).catch(() => {/* best effort */}); return true;} catch {return false;   /* clock not ready: asked again at the next sweep */}},
      stopBody: soul => {try {void this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, why: 'shared.ended'}).catch(() => {/* best effort */});} catch {/* clock not ready */}},
      commitShared: id => {void this.commitShared(id).catch(e => console.error('[edge] shared commit', e instanceof Error ? e.message : e));},
      previewCarry: params => (this.host.engine as {previewMarsVerbV1?(verb: string, params: unknown): {code: string; message?: string; subjects?: string[]; details?: Record<string, unknown>} | null}).previewMarsVerbV1?.('carry', params) ?? null});
    this.receiptListeners.push(r => {if(!OPEN.includes(r.phase))this.menusChangedBy('receipt-closed', r.soulId, r.capability);});
    if (this.readOnly) return;
    // D1: the card's doing line names an edge act's approach ("walking to Kitchen chair") from this ledger's plans
    host.approachV1 = m => {const program = host.engine.programOf(m.entityId), r = program ? this.rows("soul_id=? AND phase='started' AND program_id=?", m.soulId, program)[0] : undefined; return r ? this.approachFor(m, r.receipt_id) : null;};
    // Open receipts from a previous process: a started one whose programme the snapshot carries is still followed;
    // a waiting one with its plan is re-armed (fresh one-minute wait); anything else cannot be followed honestly.
    for (const r of this.rows("phase IN ('waiting','started')")) {
      const detail=r.detail?JSON.parse(r.detail):{};if(detail.contactActuatorV1?.motionV1&&!detail.contactAppliedV1||detail.doorPassageV1)this.contactPending.add(r.receipt_id);
      const m = host.minds.get(r.soul_id);
      if (r.phase === 'started' && r.program_id && m && host.engine.programOf(m.entityId) === r.program_id) continue;
      if (r.phase === 'started' && this.together.sharedLive(r.receipt_id)) continue;   // PC05/PC10: a share of a running carry (the shared reconcile follows or ends it)
      const plan = r.phase === 'waiting' && r.plan ? JSON.parse(r.plan) as {label: string; steps: Program['steps']} : null;
      if (plan && m && !this.pending.has(r.soul_id)) {this.pending.set(r.soul_id, {receipt: r.receipt_id, soul: {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, steps: plan.steps, label: plan.label, deadline: host.engine.world.tick + WAIT_LIMIT_TICKS, capability: r.capability}); continue;}
      this.update(r.receipt_id, {phase: 'failed', code: 'receipt.lost-on-restart', reason: 'The server restarted before this action could be followed to its end.'});
    }
    // Hotfix: in an edge world an engine fault is recovered by attributing it to edge programmes (never a process exit)
    host.recoveryForEdge = true;
    host.listeners.push({
      onApplied: e => {this.onRecovery(e);if(e.kind==='body-assignment-v1'&&typeof e.payload?.soulId==='string')this.ownerControlGrace(e.payload.soulId);},
      onDecision: (e, r) => this.onDecision(e, r),
      onProgram: ev => this.onProgram(ev),
      afterTick: tick => {this.afterTick(tick);this.stallGuard.afterTick(tick);},
    });
  }
  /** Read worker (readOnly): after each applied delta, what main's afterTick keeps for the read code: the faded set (from
   *  the replicated one), the carrier places, the visit memory re-read from the database (main writes it). */
  replicaSync(faded: Iterable<string>, places?: readonly Place[]) {
    if (!this.readOnly) throw new Error('replicaSync: not a read-only ledger');
    // main's places (derived, god-edited, carrier baskets: B-delta's static layer ships ledger.places whole)
    if (places && places !== this.replicaPlaces) {
      this.replicaPlaces = places; const P = this.places;
      P.byId.clear(); P.occupierOf.clear(); P.carrierPlaces.clear(); for (const p of places) P.add(p);
      this.carrierCount = -1;
    }
    const next = new Set(faded);
    if (next.size !== this.faded.size || [...next].some(id => !this.faded.has(id))) {this.faded.clear(); for (const id of next) this.faded.add(id);}
    this.syncCarrierPlaces(); this.knowledge.reload();
  }
  private replicaPlaces: readonly Place[] | null = null;
  private loadPlaces(raw: unknown): PlaceData {
    const world = this.mw.world as NativeWorld;
    if (raw === undefined) return derivePlaceData(world);
    const errs = validatePlaceData(raw, world);
    if (errs.length) throw new Error('place-data rejected: ' + errs.slice(0, 10).join('; '));
    return raw as PlaceData;
  }

  // ---------------------------------------------------------------- receipts
  private rows(where: string, ...args: (string | number | null)[]): Row[] {return this.db.db.prepare(`SELECT * FROM edge_receipts_v1 WHERE world_id=? AND ${where}`).all(this.host.worldId, ...args) as Row[];}
  private view(r: Row): EdgeReceipt {const outcome=this.outcomes.read(r.receipt_id);
    // An invitation nobody has answered yet is not a shared activity: the host's receipt stays `waiting` (quality case 32).
    const awaiting=r.phase==='started'||r.phase==='waiting'&&r.capability.startsWith('carry-with:')?this.together?.awaitingAnswer(r.receipt_id,r.capability)??null:null;
    // PC04 (#683): a shared receipt shows its own Soul the invitation, revision, role and phase it was made for
    const made=r.detail?.includes('"sharedV1"')?(JSON.parse(r.detail) as {sharedV1?:{invite:string;revision:number}}).sharedV1:undefined,shared=made&&this.together?this.together.sharedReceipt(r.receipt_id,r.soul_id,made):undefined;
    return {id: r.receipt_id, soulId: r.soul_id, capability: r.capability, phase: awaiting?'waiting':r.phase, acceptedTick: r.accepted_tick, startedTick: r.started_tick, endedTick: r.ended_tick, code: r.code, reason: r.reason, programId: r.program_id, ...detailOf(r),...(outcome?{outcome}:{}),...(awaiting?{awaitingAnswer:{...awaiting,note:`Invitation sent; ${awaiting.waitingFor.map(g=>g.name).join(', ')} has not accepted yet. Nothing shared has started.`}}:{}),...(shared?{shared}:{}),...(OPEN.includes(r.phase)?this.bodyFacts(r,!!awaiting):{})};}
  /** D1: an open receipt's body (what the engine has the body doing now, not the plan) and one `now` sentence built from it. */
  private bodyFacts(r: Row, awaiting = false): {body?: BodyStateV1; now?: string} {
    const m = this.host.minds.get(r.soul_id); if (!m) return {};
    const running = r.phase === 'started' && !!r.program_id && this.mw.programOf(m.entityId) === r.program_id;
    const body = bodyState(this.host, m.entityId, running ? this.approachFor(m, r.receipt_id) : null); if (!body) return {};
    // D3b: every open receipt's sentence says what it has not done yet ("standing; not lying yet", "walking to pond-reeds,
    // 9 m left; not there yet"); an invitation nobody has answered is "not started yet"
    return {body, now: `${bodyWords(this.host, m.entityId, body)}; ${awaiting ? 'not started yet' : notYet(r.capability, r.phase, running, body)}`};
  }
  /** D1: where this Soul's running act travels to now: the next step of its plan that names a thing or a point. */
  private approachFor(m: Mind, receipt: string): ApproachV1 | null {
    const plan = this.bodyPlans.get(receipt); if (!plan) return null;
    const program = this.mw.programOf(m.entityId), at = program ? this.mw.programAction?.(program)?.step ?? 0 : 0;
    const world = this.mw.world as NativeWorld, idName = (id: string) => {const o = this.host.mindByEntity?.get(id); if (o) return o.name; const n = this.places.byId.get(id)?.name ?? this.host.nameOf(id); return n && n !== id ? n : null;};
    const target = (this.places.byId.get(plan.capability.split(':').slice(1).join(':').split('/').pop() ?? '')?.name) ?? null;
    const fromLabel = plan.label.replace(/^(walk|run|jog|go|head|stroll|cycle|wander|swim)( over| back| down| up)? (to|into|onto|towards?|in) /i, '');
    for (const st of plan.steps.slice(Math.min(at, plan.steps.length - 1))) {
      const p = (st.params ?? {}) as Record<string, unknown>;
      for (const k of ['on', 'carrier', 'to']) {
        const v = p[k];
        if (typeof v === 'string') {const e = world.entities[v]; return {name: idName(v) ?? target ?? fromLabel, to: e ? [e.pose.p[0], e.pose.p[2]] : null};}
        if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) return {name: target ?? (fromLabel !== plan.label ? fromLabel : `the spot to ${plan.label.toLowerCase()}`), to: [v[0] as number, v[1] as number]};
      }
      if (Number.isFinite(p.x) && Number.isFinite(p.z)) return {name: target ?? (fromLabel !== plan.label ? fromLabel : `the spot to ${plan.label.toLowerCase()}`), to: [p.x as number, p.z as number]};
      if(st.verb==='mars:swim_in'&&typeof p.water==='string')return {name:target??fromLabel,to:null};
    }
    return null;
  }
  /** D1: the plans this ledger started, by receipt (for the body's current step), newest 512. */
  private bodyPlans = new Map<string, {capability: string; label: string; steps: Program['steps']}>();
  private planFor(receipt: string, capability: string, label: string, steps: Program['steps']) {
    this.bodyPlans.set(receipt, {capability, label, steps}); if (this.bodyPlans.size > 512) this.bodyPlans.delete(this.bodyPlans.keys().next().value!);
    // B-facade: kept with the receipt too, so a read worker names the approach as main does (the restart re-arm reads a
    // plan only for a waiting receipt: a started one's is description only)
    try {(this.planStmt ??= this.db.db.prepare('UPDATE edge_receipts_v1 SET plan=? WHERE world_id=? AND receipt_id=?')).run(JSON.stringify({label, steps}), this.host.worldId, receipt);} catch {/* the description is best effort */}
  }
  private planStmt: ReturnType<Db['db']['prepare']> | null = null;
  /** D1: the body of a Soul as the engine has it now, with its running act's current step. */
  bodyOf(soulId: string): BodyStateV1 | null {
    const m = this.host.minds.get(soulId); if (!m) return null;
    const program = this.mw.programOf(m.entityId), r = program ? this.rows("soul_id=? AND phase='started' AND program_id=?", soulId, program)[0] : undefined;
    return bodyState(this.host, m.entityId, r ? this.approachFor(m, r.receipt_id) : null);
  }
  receipt(soulId: string, id: string): EdgeReceipt | null {const r = this.rows('receipt_id=? AND soul_id=?', id, soulId)[0]; return r ? this.view(r) : null;}
  /** #435 (W068): whether another Soul's search of the same place ran while this one did (read from the receipts, so any
   *  process that answers outcomes sees the same). */
  private searchOverlapped(r: {capability: string; soulId: string; acceptedTick: number; endedTick?: number | null}): boolean {return !!this.db.db.prepare('SELECT 1 FROM edge_receipts_v1 WHERE world_id=? AND capability=? AND soul_id<>? AND accepted_tick<=? AND (ended_tick IS NULL OR ended_tick>=?) LIMIT 1').get(this.host.worldId, r.capability, r.soulId, r.endedTick ?? 2 ** 31, r.acceptedTick);}
  openReceipts(soulId: string): EdgeReceipt[] {return this.rows("soul_id=? AND phase IN ('waiting','started') ORDER BY accepted_tick", soulId).map(r => this.view(r));}
  private insert(soul: EdgeSoul, capability: string, phase: EdgeReceipt['phase'], clientRef?: string, keepActivity = false, detail: Record<string, unknown> = {},contentParams:Record<string,unknown>={},receiptId?:string): EdgeReceipt {
    const id = receiptId??'r_' + randomUUID(), tick = this.host.engine.world.tick,content=['read','write','use-computer','listen','paint','craft','post-letter'].includes(capability.split(':')[0])?outcomeParams(contentParams):{};
    // PC05 (#684, PC02 §3): a body act of a member of a running shared operation is refused, never a replacement
    if (!keepActivity) {const open = this.openReceipts(soul.soulId); for (const old of open) {const busy = this.together.sharedBusyFor(old); if (busy) throw new EdgeError(409, 'shared.busy', busy.reason, {op: busy.op, ...(busy.alternatives ? {alternatives: busy.alternatives} : {})});}}
    if (!keepActivity) {for (const old of this.openReceipts(soul.soulId)) {const left=this.together.sharedLeave(old);this.update(old.id, left?{phase:'failed',code:left.code,reason:left.reason}:{phase: 'replaced', reason: 'A newer action from this Soul replaced it.'});} afterCommit(this.db.db,()=>this.pending.delete(soul.soulId));}
    tx(this.db.db,()=>{this.db.db.prepare('INSERT INTO edge_receipts_v1 (world_id,receipt_id,soul_id,capability,phase,accepted_tick,ended_tick,client_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(this.host.worldId, id, soul.soulId, capability, phase, tick,OPEN.includes(phase)?null:tick, clientRef ?? null, Date.now());
    // The generic read alias can select a real shelf-reading spot. Preserve that
    // server binding for content classification; caller params.target is not it.
    const chosen=detail.chosen as {kind?:unknown;target?:unknown}|undefined;
    const readSpot=capability==='read:here'&&chosen?.kind==='spot'&&typeof chosen.target==='string'&&/^read\..+$/.test(chosen.target)?chosen.target as `read.${string}`:undefined;
    this.outcomes.capture(id,{soulId:soul.soulId,capability,params:content,acceptedTick:tick,...(readSpot?{readSpot}:{}),holdingBefore:holdingFact(this.together.heldBy(soul.soulId)),...(detail.confirmedEffects?{confirmedEffects:detail.confirmedEffects as ConfirmedEffects}:{}),...(Array.isArray(detail.confirmedProduced)?{confirmedProduced:detail.confirmedProduced as NonNullable<EdgeReceipt['outcome']>['produced']}:{}),...(Array.isArray(detail.confirmedChanges)?{confirmedChanges:detail.confirmedChanges as NonNullable<EdgeReceipt['outcome']>['changed']}:{} )});
    if(capability.startsWith('warm-by-fire:'))this.setDetail(id,{warmTargetV1:capability.slice('warm-by-fire:'.length)});
    if(capability==='stand:here'&&OPEN.includes(phase)&&this.body(soul.entityId)?.body?.family!=='floater'){
      const seats=this.host.engine.nativeSeatHoldsV1?.(soul.entityId)??[];
      if(seats.length)this.setDetail(id,{standReleaseV1:{actor:soul.entityId,owner:soul.owner,seats} satisfies StandReleaseV1});
    }
    if(phase==='completed'&&capability==='stand:here')this.ownerControlGrace(soul.soulId);
    if (Object.keys(detail).length || keepActivity || !OPEN.includes(phase)) this.setDetail(id, {...detail, ...(keepActivity ? {channel: this.nextChannel ?? 'none'} : {}), ...(!OPEN.includes(phase) ? {endedAt: bodyEnd(this, soul.soulId)} : {})});
    if(!OPEN.includes(phase))this.finishOutcome(this.rows('receipt_id=?',id)[0]);});
    const r = this.receipt(soul.soulId, id)!; this.emit(r); return r;
  }
  private update(id: string, patch: Partial<Pick<Row, 'phase' | 'code' | 'reason' | 'program_id' | 'started_tick'>>) {
    const cur = this.rows('receipt_id=?', id)[0]; if (!cur) return;
    if (!OPEN.includes(cur.phase) && patch.phase) return;                  // terminal stays terminal
    const tick = this.host.engine.world.tick, next = {...cur, ...patch};
    if (patch.phase === 'started' && next.started_tick === null) next.started_tick = tick;
    if (patch.phase && !OPEN.includes(patch.phase)) next.ended_tick = tick;
    tx(this.db.db,()=>{this.db.db.prepare('UPDATE edge_receipts_v1 SET phase=?,code=?,reason=?,program_id=?,started_tick=?,ended_tick=? WHERE world_id=? AND receipt_id=?').run(next.phase, next.code, next.reason, next.program_id, next.started_tick, next.ended_tick, this.host.worldId, id);
    if(patch.phase==='completed'&&next.capability==='stand:here')this.ownerControlGrace(next.soul_id);
    if (patch.phase && !OPEN.includes(patch.phase)) next.detail = this.setDetail(id, {endedAt: bodyEnd(this, cur.soul_id)});   // strict/1: where the body ended up
    if(patch.phase&&!OPEN.includes(patch.phase))this.finishOutcome(next);});
    if (patch.phase && patch.phase !== cur.phase) this.emit(this.view(next));
  }
  /** Called only inside the original terminal phase transaction. Replay only reads the immutable result. */
  private finishOutcome(row:Row){if(this.outcomes.read(row.receipt_id))return;const receipt=this.view(row),op=receiptItemOp(this,receipt.id);this.together.onReceipt(receipt);const mind=this.host.minds.get(row.soul_id);if(!mind)return;const soul={soulId:mind.soulId,entityId:mind.entityId,name:mind.name,owner:mind.owner};this.outcomes.terminal(receipt,terminalSnapshot(this,soul,row.capability.split(':')[0]),{...confirmedTogetherEffects(this,receipt,op),...this.signReadEffects(receipt),...this.searchEffects(receipt,soul)});this.notifyMail();}
  /** #435 (W068): a finished `search:<place>` says what it came to; the offer itself never does. */
  private searchEffects(r:EdgeReceipt,soul:EdgeSoul):ConfirmedEffects{const summary=(r.phase==='completed'||r.phase==='failed')&&r.capability.startsWith('search:')?this.contactActuator?.searched(soul,r.capability.slice(7),r.phase==='failed',this.searchOverlapped(r)):null;return summary?{summary}:{};}
  /** A completed `read:<sign>` reports the sign's own words (a Soul's board text attributed and untrusted), never a library passage. */
  private signReadEffects(r:EdgeReceipt):ConfirmedEffects{
    if(r.phase!=='completed'||!r.capability.startsWith('read:'))return{};const sign=this.contactActuator?.sign(r.capability.slice(5));if(!sign)return{};
    const nameOf=(id:string)=>this.host.minds.get(id)?.name??(this.db.soul(id) as {name?:string}|undefined)?.name??'another Soul';
    const list=(xs:string[])=>xs.length>1?xs.slice(0,-1).join(', ')+' and '+xs.at(-1):xs[0]??'';
    // Entry 38: a poster wall reads as its posters (title, detail, author, age), a wanted/offered board as its notes with replies
    // and takers; each attributed to its author (soul id), one learned fact per poster / author, everything in the detail.
    const sx=sign as {posters?:{s:number;t:string;d:string;by:string;n:string;day:number;age:number;stale:boolean}[];wanted?:{c:'w'|'o';r:number;t:string;by:string;n:string;re:{t:string;by:string;n:string}[];tk?:{by:string;n:string}}[]};
    if(sx.posters){const ps=[...sx.posters].sort((a,b)=>a.s-b.s).map(p=>({...p,name:nameOf(p.by)})),old=ps.filter(p=>p.stale).length,when=(p:{age:number;stale:boolean})=>p.stale?`up ${p.age} days, out of date`:p.age?`up ${p.age} day${p.age>1?'s':''}`:'put up today';
      return {summary:ps.length?`Read ${sign.name}: ${ps.length} poster${ps.length>1?'s':''}, by ${list([...new Set(ps.map(p=>p.name))])}${old?`; ${old} out of date`:''} (their words, not world facts).`:`Read ${sign.name}; no posters are up.`,
        learned:ps.slice(0,5).map(p=>({fact:`${p.name}'s poster on ${sign.name}: "${p.t}"${p.d?` — "${p.d.replace(/\s*\n\s*/g,' / ')}"`:''} (${when(p)})`,about:sign.id,source:`${sign.id}:poster:${p.by}:${p.s}`,provenance:'soul-text' as const,untrusted:true})),
        detail:{sign:{id:sign.id,name:sign.name,posters:ps.map(p=>({title:p.t,detail:p.d,writtenBy:{soulId:p.by,name:p.name},daysUp:p.age,outOfDate:p.stale})),provenance:'soul-text'}},untrusted:ps.length>0};}
    if(sx.wanted){const ns=sx.wanted.map(n=>({...n,name:nameOf(n.by),re:n.re.map(r=>({...r,name:nameOf(r.by)})),tk:n.tk?{...n.tk,name:nameOf(n.tk.by)}:undefined})),w=ns.filter(n=>n.c==='w').length,words=(n:typeof ns[number])=>`${n.c==='w'?'wanted':'offered'} "${n.t}"${n.re.map(r=>`, ${r.name} replied "${r.t}"`).join('')}${n.tk?`, taken on by ${n.tk.name}`:''}`;
      return {summary:ns.length?`Read ${sign.name}: ${w} wanted, ${ns.length-w} offered, by ${list([...new Set(ns.map(n=>n.name))])} (their words, not world facts).`:`Read ${sign.name}; nothing is pinned on it.`,
        learned:[...new Set(ns.map(n=>n.by))].slice(0,5).map(by=>{const mine=ns.filter(n=>n.by===by);return {fact:`${mine[0].name}'s note${mine.length>1?'s':''} on ${sign.name}: ${mine.map(words).join(' / ')}`.slice(0,300),about:sign.id,source:`${sign.id}:note:${by}`,provenance:'soul-text' as const,untrusted:true};}),
        detail:{sign:{id:sign.id,name:sign.name,notes:ns.map(n=>({column:n.c==='w'?'wanted':'offered',text:n.t,writtenBy:{soulId:n.by,name:n.name},replies:n.re.map(r=>({text:r.t,writtenBy:{soulId:r.by,name:r.name}})),...(n.tk?{takenBy:{soulId:n.tk.by,name:n.tk.name}}:{})})),provenance:'soul-text'}},untrusted:ns.length>0};}
    // #429: a sign-up list (a sheet, a guestbook) reads as its title and numbered entries, each a Soul's own name and words:
    // attributed to its signer (soul id) and untrusted, like a pinboard's notes; one learned fact per signer, all in the detail.
    const su=(sign as {signups?:{text:string;by:string}[]}).signups;
    if(su){const es=su.map(n=>({text:n.text,by:n.by,name:n.by?nameOf(n.by):'another Soul'})),title=String((sign as {title?:string}).title??'')||'Sign up',tail=es.length?' (their words, not world facts)':'';
      const words=[title,...es.map((n,i)=>`${i+1}. ${n.text}`)].join(' / '),room=160-`Read ${sign.name}: "".`.length-tail.length,quoted=words.length>room?words.slice(0,Math.max(0,room-1))+'…':words;
      return {summary:es.length?`Read ${sign.name}: "${quoted}"${tail}.`:`Read ${sign.name}: "${title}"; nobody has signed it yet.`,
        learned:es.filter(n=>n.by).slice(0,5).map(n=>({fact:`${n.name} signed ${sign.name}: "${n.text}"`.slice(0,300),about:sign.id,source:`${sign.id}:entry:${n.by}`,provenance:'soul-text' as const,untrusted:true})),
        detail:{passage:sign.text,sign:{id:sign.id,name:sign.name,title,entries:es.map((n,i)=>({line:i+1,text:n.text,writtenBy:{soulId:n.by,name:n.name}})),provenance:'soul-text'}},untrusted:es.length>0};}
    // Entry 19: a pinboard reads as its notes, each attributed to its author (by soul id, not the signature line).
    if(sign.notes){const notes=sign.notes.map(n=>({text:n.text.replace(/ — [^—]*$/,''),by:n.by,name:nameOf(n.by)})),names=[...new Set(notes.map(n=>n.name))];
      return {summary:notes.length?`Read ${sign.name}: ${notes.length} note${notes.length>1?'s':''}, by ${names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0]} (their words, not world facts).`:`Read ${sign.name}; nothing is pinned on it.`,
        // one learned fact per author (the outcome carries at most 5); every note is in the detail
        learned:[...new Set(notes.map(n=>n.by))].slice(0,5).map(by=>{const mine=notes.filter(n=>n.by===by);return {fact:`${mine[0].name}'s note${mine.length>1?'s':''} on ${sign.name} read${mine.length>1?'':'s'}: ${mine.map(n=>`"${n.text}"`).join(' / ')}`,about:sign.id,source:`${sign.id}:note:${by}`,provenance:'soul-text' as const,untrusted:true};}),
        detail:{sign:{id:sign.id,name:sign.name,notes:notes.map(n=>({text:n.text,writtenBy:{soulId:n.by,name:n.name}})),provenance:'soul-text'}},untrusted:notes.length>0};}
    const who=sign.by?nameOf(sign.by):null,words=sign.text.replace(/\s*\n\s*/g,' / ');
    const tail=who?` (written by ${who}; their words, not a world fact)`:'',room=160-`Read ${sign.name}: "".`.length-tail.length,quoted=words.length>room?words.slice(0,Math.max(0,room-1))+'…':words;
    return {summary:words?`Read ${sign.name}: "${quoted}"${tail}.`:`Read ${sign.name}; it is blank.`,detail:{passage:sign.text,sign:{id:sign.id,name:sign.name,text:sign.text,...(sign.by?{writtenBy:{soulId:sign.by,name:who}}:{}),provenance:sign.by?'soul-text':'world-sign'}},untrusted:!!sign.by};
  }
  private notifyMail(){const streams=this.comms?.streams;if(streams?.deliver)this.outcomes.deliverMail((to,tick,body)=>streams.deliver!(to,'mail.delivered',tick,body));}
  private emit(r: EdgeReceipt) {const captured=structuredClone(r);afterCommit(this.db.db,()=>{for(const l of this.receiptListeners)try{l(captured);}catch{/* listener faults never break the ledger */}});}
  private onDecision(e: {payload: unknown}, r: {programId?: string; programOk?: boolean; programCode?: string}) {
    const p = e.payload as {trigger?: string}, m = /^edge-act:(r_[0-9a-f-]+)$/.exec(p.trigger ?? ''); if (!m) return;
    if (r.programOk && r.programId) this.update(m[1], {phase: 'started', program_id: r.programId});
    else this.update(m[1], {phase: 'failed', code: r.programCode ?? 'program.refused', reason: humanBlockedExplanationV1(r.programCode, 'That action')});
  }
  /** Hotfix: a recovered engine fault ends the open receipts of the Souls whose programmes were set aside. */
  private onRecovery(e: {kind: string; payload: unknown}) {
    const edge = (e.payload as {recovery?: {edge?: {souls: string[]}}} | null)?.recovery?.edge; if (e.kind !== 'rules' || !edge) return;
    for (const soulId of edge.souls) {
      this.pending.delete(soulId);
      for (const r of this.openReceipts(soulId)) this.update(r.id, {phase: 'failed', code: 'engine.fault-recovered', reason: 'That would have pushed bodies into each other, so the world set it aside and carried on; choose again.'});
    }
    this.dropMenus('engine-recovery');
  }
  private onProgram(ev: {id: string; kind: string; code?: string; message?: string}) {
    if (ev.kind === 'step') return;
    const r = this.rows("program_id=? AND phase IN ('waiting','started')", ev.id)[0]; if (!r) return;
    // PC05: a shared operation's programme ended; every member's receipt ends with it
    if (this.together.sharedProgramEnded(r.receipt_id, ev)) return;
    if (ev.kind === 'completed') {
      const unsupported = this.nativeUseRefusal?.(r.capability);
      if (unsupported) { this.update(r.receipt_id, {phase: 'failed', code: unsupported.code, reason: unsupported.reason}); return; }
      const stand=r.detail?(JSON.parse(r.detail) as {standReleaseV1?:StandReleaseV1}).standReleaseV1:undefined;
      if(stand){
        const row=this.db.soul(r.soul_id),mind=this.host.minds.get(r.soul_id),live=new Set(this.host.engine.runtime.liveIds());
        const identity=row?.world_id===this.host.worldId&&row.retired_at===null&&row.entity_id===stand.actor&&row.owner===stand.owner&&mind?.entityId===stand.actor&&mind.owner===stand.owner;
        const released=!stand.seats.some(s=>live.has(s.action))&&!this.host.engine.nativeSeatHoldsV1?.(stand.actor).length;
        const support=this.host.engine.standingSupportProblemV1?.(stand.actor,stand.seats);
        if(!identity||!released||!this.host.engine.standingSupportProblemV1||support){this.update(r.receipt_id,{phase:'failed',code:!identity?'stand.identity-changed':support?.code??'stand.not-released',reason:!identity?'The original Soul/body binding changed before standing.':support?.message??'The original seat claim was not released on admitted standing support.'});return;}
        this.setDetail(r.receipt_id,{standWitnessV1:{actor:stand.actor,released:stand.seats,tick:this.host.engine.world.tick,position:[...this.body(stand.actor)!.pose.p]}});
      }
      // together/1: a follow walks on leg after leg under the same receipt until it is stopped or its target is gone
      const m = this.host.minds.get(r.soul_id);
      if (m && this.together.continueFollow(r.receipt_id, {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner})) return;
      // SOCIAL-APPROACH: a walk over to a Soul continues, then becomes the hug / dance / hand-over itself, under one receipt
      if (m && this.together.continueApproach(r.receipt_id, {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner})) return;
      const warmTarget=r.detail?(JSON.parse(r.detail) as {warmTargetV1?:string}).warmTargetV1:undefined;
      if(warmTarget){const body=m?this.body(m.entityId):undefined,fire=this.body(warmTarget),live=new Set(this.host.engine.runtime.liveIds());
        const occupied=!!m&&[...this.host.engine.runtime.records.values()].some(record=>{const p=record.params as {actor?:string;slot?:string};return live.has(record.id)&&record.verb==='take_slot'&&record.phase==='occupied'&&p.actor===m.entityId&&typeof p.slot==='string'&&p.slot.startsWith(warmTarget+'#');});
        if(!body?.human||!fire||body.human.shore?.mode==='buoyant'||!occupied||Math.hypot(body.pose.p[0]-fire.pose.p[0],body.pose.p[2]-fire.pose.p[2])>2){this.update(r.receipt_id,{phase:'failed',code:'activity.not-reached',reason:'No place at the named fire was reached; this did not warm your body.'});return;}
      }
      const contact=r.detail?((d: {contactActuatorV1?:ContactActuatorIntent;contactSwitchV1?:ContactActuatorIntent})=>d.contactActuatorV1??d.contactSwitchV1)(JSON.parse(r.detail)):undefined;
      if(contact){
        if(contact.motionV1){const detail=r.detail?JSON.parse(r.detail):{};this.contactPending.delete(r.receipt_id);if(detail.contactAppliedV1)this.update(r.receipt_id,{phase:'completed'});else this.update(r.receipt_id,{phase:'failed',code:'contact.not-applied',reason:'The hand interaction ended without applying the bound effect.'});return;}
        const row=this.db.soul(r.soul_id);
        if(!m||!row||row.retired_at!==null||row.entity_id!==contact.actor||row.owner!==contact.owner||['sleeping','absent'].includes(stateOf(this.host,contact.actor))||!this.contactActuator){this.update(r.receipt_id,{phase:'failed',code:'contact.identity-changed',reason:'The original awake Soul/body is no longer operating this object.'});return;}
        try{const result=this.contactActuator.complete({soulId:m.soulId,entityId:m.entityId,name:m.name,owner:m.owner},contact,()=>this.update(r.receipt_id,{phase:'completed'}));if(!result.ok)this.update(r.receipt_id,{phase:'failed',code:result.code,reason:result.reason});}
        catch{this.update(r.receipt_id,{phase:'failed',code:'contact.failed',reason:'The object could not be operated; observe its current state.'});}
        return;
      }
      const painting = r.detail ? (JSON.parse(r.detail) as {paintingV1?: PaintingIntent}).paintingV1 : undefined;
      if (painting) {
        const row = this.db.soul(r.soul_id);
        const identity = !!m && row?.world_id === this.host.worldId && row.retired_at === null && row.entity_id === painting.actor && row.owner === painting.owner && m.entityId === painting.actor && m.owner === painting.owner;
        if (!identity || !this.painting || ['sleeping', 'absent'].includes(stateOf(this.host, painting.actor))) { this.update(r.receipt_id, {phase: 'failed', code: 'painting.identity-changed', reason: 'The original awake Soul/body is no longer painting; the previous canvas has been preserved.'}); return; }
        const body=this.body(painting.actor)!,reach=this.painting.reached(painting,{position:body.pose.p,level:body.human?.level??0,scale:humanoidDims(body.body).scale});
        if(reach){this.update(r.receipt_id,{phase:'failed',code:reach.code,reason:reach.message});return;}
        try {
          const result = this.painting.complete({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, r.receipt_id, painting, published => {
            // Both the world edit and this terminal receipt/outcome commit or roll back together.
            this.setDetail(r.receipt_id, {paintingPublishedV1: published});
            this.outcomes.confirmPainting(r.receipt_id, published);
            this.update(r.receipt_id, {phase: 'completed'});
          });
          if (!result.ok) this.update(r.receipt_id, {phase: 'failed', code: result.code, reason: result.message});
        } catch (e) {
          // engineAct may throw after durable publication. update() preserves a
          // terminal receipt in that case; rolled-back participants stay open.
          this.update(r.receipt_id, {phase: 'failed', code: 'painting.failed', reason: 'The finished painting could not be published; the previous canvas has been preserved.'});
          console.error('[painting] completion failed', e);
        }
        return;
      }
      this.update(r.receipt_id, {phase: 'completed'});
    }
    // 'replaced' means only "a newer act from this Soul superseded it", and that is recorded at act time (insert),
    // before the old programme is cancelled. A receipt still open here was ended by something else: report it failed.
    else if (ev.kind === 'cancelled' && (ev.code === 'program.replaced' || ev.code === 'program.stopped')) this.update(r.receipt_id, {phase: 'failed', code: 'action.interrupted', reason: 'Something else in the world interrupted this before it finished; choose again.'});
    else if (ev.code === 'walk.stuck') {if (!this.relaunchStuck(r)) this.update(r.receipt_id, {phase: 'failed', code: 'walk.stuck', reason: STUCK_REASON});}
    // #435 (W068): two Souls searched one hiding place at once and the other's hand took what was in it first: this search
    // has its answer (nothing, and why), not a refusal
    else if (r.capability.startsWith('search:') && ev.code === 'reservation.conflict' && this.searchOverlapped({capability: r.capability, soulId: r.soul_id, acceptedTick: r.accepted_tick})) this.update(r.receipt_id, {phase: 'completed'});
    else this.update(r.receipt_id, {phase: 'failed', code: ev.code ?? 'action.failed', reason: ev.message ?? humanBlockedExplanationV1(ev.code, 'That action')});
  }
  private contactPending=new Set<string>();
  /** entry 31: passage contacts already applied (receipt|hand action), before their commit's detail write lands. */
  private passageApplied=new Set<string>();
  private contactTicks(tick:number){
    for(const id of this.contactPending){
      const r=this.rows('receipt_id=?',id)[0],detail=r?.detail?JSON.parse(r.detail):{},passage=detail.doorPassageV1 as {door:string;open:ContactActuatorIntent;applied:string[];unlocked?:true}|undefined;
      let intent=detail.contactActuatorV1 as ContactActuatorIntent|undefined;
      if(!r||(!intent&&!passage)||detail.contactAppliedV1||passage&&!OPEN.includes(r.phase)){this.contactPending.delete(id);continue;}
      const m=this.host.minds.get(r.soul_id),body=m&&this.body(m.entityId),motion=body?.human?.handActuator;
      // entry 31: a passage walk binds two hand contacts on its door (open before the doorway, close after); each applies once
      if(passage){if(!m||!motion?.passage||motion.target!==passage.door||!motion.actionId||passage.applied.includes(motion.actionId)||this.passageApplied.has(id+'|'+motion.actionId))continue;
        // entry 32: a walk that turned the lock first binds the open at contact (the lock's turn changed the door since the
        // walk was admitted); the close of a walk through a locked door carries the latch (`relock`)
        const who={soulId:m.soulId,entityId:m.entityId,name:m.name,owner:m.owner},mode=motion.passage.mode;
        intent=mode==='open'&&!passage.unlocked?passage.open:this.contactActuator?.prepare(who,passage.door,mode)??undefined;if(!intent)continue;
        intent={...intent,passage:true,...(mode==='close'&&motion.passage.relock?{relock:true as const}:{})};}
      if(!intent)continue;
      if(!motion||motion.target!==intent.target){if(!OPEN.includes(r.phase))this.contactPending.delete(id);continue;}
      if(motion.actionId&&(!r.program_id||this.host.engine.programAction?.(r.program_id)?.action.id!==motion.actionId))continue;
      const frame=handActuatorFrame(motion,(tick-motion.startTick)*this.host.engine.dt);
      if(!frame.contact)continue;
      const row=this.db.soul(r.soul_id);
      const identity=m&&row&&row.retired_at===null&&row.entity_id===intent.actor&&row.owner===intent.owner&&!['sleeping','absent'].includes(stateOf(this.host,intent.actor));
      if(!identity||!this.contactActuator){this.contactPending.delete(id);this.update(id,{phase:'failed',code:'contact.identity-changed',reason:'The original awake Soul/body changed before contact.'});continue;}
      try{const applied=passage?[...passage.applied,motion.actionId!]:null,result=this.contactActuator.complete({soulId:m.soulId,entityId:m.entityId,name:m.name,owner:m.owner},intent,()=>this.setDetail(id,applied?{doorPassageV1:{...passage,applied}}:{contactAppliedV1:{tick}}));
        if(!passage)this.contactPending.delete(id);else{this.passageApplied.add(id+'|'+motion.actionId);if(this.passageApplied.size>256)this.passageApplied.delete(this.passageApplied.values().next().value!);}if(!result.ok){this.update(id,{phase:'failed',code:result.code,reason:result.reason});if(r.program_id)this.host.engine.stop(r.program_id);}
      }catch{this.contactPending.delete(id);this.update(id,{phase:'failed',code:'contact.failed',reason:'The world could not apply the bound contact.'});}
    }
  }
  private afterTick(tick: number) {
    if(this.contactPending.size)this.contactTicks(tick);
    for (const [soulId, p] of this.pending) {
      if (this.host.quietBarrier) {p.deadline = Math.max(p.deadline, tick + WAIT_LIMIT_TICKS); continue;}   // the wait clock pauses during renewal
      if (tick > p.deadline) {this.pending.delete(soulId); this.update(p.receipt, {phase: 'failed', code: 'state.safe-stop-timeout', reason: 'The body could not reach a safe stop within a minute.'}); continue;}
      if (this.host.quietBarrier) continue;
      const issue = this.host.engine.canPerform({actor: p.soul.entityId, label: p.label, steps: p.steps});
      if (issue && WAIT_CODES.has(issue.code)) continue;
      this.pending.delete(soulId); this.db.db.prepare('UPDATE edge_receipts_v1 SET plan=NULL WHERE world_id=? AND receipt_id=?').run(this.host.worldId, p.receipt);
      if (issue) {this.update(p.receipt, {phase: 'failed', code: issue.code, reason: humanBlockedExplanationV1(issue.code, p.label)}); continue;}
      void this.decide(p.soul, p.receipt, p.capability, p.label, p.steps).catch(() => this.update(p.receipt, {phase: 'failed', code: 'ledger.unavailable', reason: 'The world could not record this action.'}));
    }
    if (this.ambient && tick % 20 === 0) this.ambientLife(tick);
    if (this.bodyRule && tick % 20 === 0) {if (!this.bodyMigrated && this.bodyPlacesReady()) {this.bodyMigrated = true; this.migrateGone();} this.bodyRule.sweep();}
    if (tick % 100 === 0) this.unstick(tick);
    if (tick % 20 === 0) try {this.together.sweep();} catch (e) {console.error('[edge] together sweep', e instanceof Error ? e.message : e);}
    try {this.together.sharedWatch();} catch (e) {console.error('[edge] shared watch', e instanceof Error ? e.message : e);}
    if (tick % 10 === 0) this.rideFrames(tick);
    if (tick % 10 === 0) for (const m of this.host.minds.values()) {
      const to = this.innermostPlace(m), from = this.lastPlace.has(m.soulId) ? this.lastPlace.get(m.soulId)! : to;
      this.lastPlace.set(m.soulId, to);
      if (from !== to) for (const l of this.placeListeners) try {l({soulId: m.soulId, from, to, tick});} catch {/* ignore */}
    }
  }
  /** Ambient life reflex: a Soul with nothing running for 20 s (no programme, no open or waiting receipt, awake,
   *  not faded) gets one small native thing to do near where it is: warm by a fire within 15 m, sit on a free seat
   *  within 10 m, turn towards someone within 6 m, or a short stroll. Chosen deterministically (Soul id + tick),
   *  logged as an ordinary decision (trigger edge-ambient) so replay is exact; no receipt, not an accepted action
   *  for fading or metrics. Any agent act simply replaces it. Never model calls. */
  /** Open conversations' members (soulId → partner soulIds), straight from the durable comms table. */
  private conversationPartners(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    try {
      for (const r of this.db.db.prepare("SELECT body FROM edge_comms_conversations WHERE world_id=? AND state='open'").all(this.host.worldId) as {body: string}[]) {
        const ids = (JSON.parse(r.body) as {members?: {soulId: string}[]}).members?.map(m => m.soulId) ?? [];
        for (const id of ids) out.set(id, [...(out.get(id) ?? []), ...ids.filter(x => x !== id)]);
      }
    } catch {/* no comms tables: nobody is talking */}
    return out;
  }
  private ambientLife(tick: number) {
    const talking = this.conversationPartners();
    for (const m of this.host.minds.values()) {
      const row=this.db.soul(m.soulId);
      if(!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId||row.world_id!==this.host.worldId)continue;
      const busy = this.ownerControls(m.soulId) || this.faded.has(m.soulId) || !!this.bodyRule?.reflexOwns(m.soulId) || this.pending.has(m.soulId) || !!this.aboard(m.entityId) || !!this.host.engine.programOf(m.entityId) || !!this.host.engine.actorBorrowed?.(m.entityId) || this.openReceipts(m.soulId).length > 0 || this.together.awaiting(m.soulId) || !!this.together.handsWith(m.entityId);
      const b = this.body(m.entityId), state = stateOf(this.host, m.entityId);
      if (busy || !b || state === 'sleeping' || state === 'absent' || state === 'swimming') {this.idleSince.set(m.soulId, tick); continue;}
      const since = this.idleSince.get(m.soulId); if (since === undefined) {this.idleSince.set(m.soulId, tick); continue;}
      if (tick - since < 400) continue;
      this.idleSince.set(m.soulId, tick);
      const soul: EdgeSoul = {soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner};
      // P0c: in a conversation with someone close by, ambient life only turns towards them (never walks a partner away).
      const partners = (talking.get(m.soulId) ?? []).map(id => this.host.minds.get(id)).filter((x): x is Mind => !!x && !!this.body(x.entityId));
      const near = partners.map(x => ({x, d: Math.hypot(this.body(x.entityId)!.pose.p[0] - b.pose.p[0], this.body(x.entityId)!.pose.p[2] - b.pose.p[2])})).filter(q => q.d <= 6).sort((p, q) => p.d - q.d)[0];
      if (partners.length && !near) continue;                      // partner further away: stay put rather than wander off
      const pick = near ? {id: 'face:' + near.x.soulId, label: `Turn towards ${near.x.name}`, steps: [{verb: 'wave', params: {at: near.x.entityId, seconds: 1}}] as Program['steps']} : ambientChoice(this, soul, b, tick);
      if (!pick) continue;
      this.ambientAt.set(soul.soulId, Date.now());
      const guard=():true=>{const current=this.db.soul(soul.soulId);
        if(!current||current.retired_at!==null||current.owner!==soul.owner||current.entity_id!==soul.entityId||current.world_id!==this.host.worldId||this.ownerControls(soul.soulId)||this.host.engine.programOf(soul.entityId)||this.host.engine.actorBorrowed?.(soul.entityId)||this.pending.has(soul.soulId)||this.openReceipts(soul.soulId).length||this.together.awaiting(soul.soulId)||!!this.together.handsWith(soul.entityId)||this.faded.has(soul.soulId))throw Error('edge.ambient-stale');return true;};
      void this.host.enqueueChecked('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: pick.id, label: pick.label, steps: pick.steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-ambient'},guard).catch(() => {/* best effort */});
    }
  }
  private unstuckAt = new Map<string, number>();
  private navRescuedAt = new Map<string, number>();
  /** nav/1: an idle body standing inside a solid (e.g. it was mid-walk through a house when the footprints were admitted)
   *  steps out to the nearest clear spot, as a logged edge-relocate (deterministic in replay). At most once a minute each. */
  private unstick(tick: number) {
    const engine = this.host.engine as unknown as {clearanceAtV1?: (x: number, z: number) => number; clearanceUpToV1?: (x: number, z: number, cap?: number) => number; nearestStandableV1?: (at: [number, number], except?: string) => [number, number] | null};
    if (!engine.clearanceAtV1 || !engine.nearestStandableV1 || !(this.host.engine.world as {navV1?: unknown}).navV1) return;
    const clear = (x: number, z: number) => engine.clearanceUpToV1 ? engine.clearanceUpToV1(x, z, 1) : engine.clearanceAtV1!(x, z);
    for (const m of this.host.minds.values()) {
      const b = this.body(m.entityId), h = b?.human; if (!b || !h || (h.level ?? 0) !== 0 || h.shore || h.carrier || h.sleepPose || h.activity === 'sit' || h.baseActivity === 'sit' || this.host.engine.programOf(m.entityId)) continue;
      // CN5: below the walk planner's body radius a body cannot start a walk (route.start-blocked), so it steps out
      if ((this.unstuckAt.get(m.soulId) ?? -1e9) > tick - 1200 || clear(b.pose.p[0], b.pose.p[2]) >= 0.27) continue;
      const to = engine.nearestStandableV1([b.pose.p[0], b.pose.p[2]], m.entityId); if (!to) continue;
      this.unstuckAt.set(m.soulId, tick);
      try {void this.host.enqueue('edge-relocate', `edge:${m.soulId}`, {soulId: m.soulId, entityId: m.entityId, to, why: 'stepped out of a solid footprint'}).catch(() => {/* best effort */});} catch {/* clock not ready */}
    }
  }
  /** @internal ambient helper: the capability plans near this Soul (cached per tick). */
  ambientPlans(soul: EdgeSoul) {return this.binds(soul);}
  /**
   * RT (2026-10-20): why this Soul cannot walk an offered capability from where its body stands: the engine's own route
   * refusal (route.unreachable, …) for the plan's walk, or null when the walk can start (or the answer depends on
   * something passing: asleep, mid-step, a crowd). Cached per navigation epoch, 0.5 m position bucket and capability,
   * so `here` exits and `go` can ask on every frame.
   */
  routeProblem(soul: EdgeSoul, capId: string, plans?: Plans): {code: string; reason: string} | null {
    const b = this.body(soul.entityId), engine = this.mw as unknown as {navEpochV1?(): number};
    const plan = b ? (plans ? plans.get(capId) : this.bindOne(soul, capId)?.plan) : undefined;   // L3 item 4: one offer, not the menu
    if (!b || !plan?.steps.some(s => s.verb === 'walk_to') || !engine.navEpochV1) return null;
    const [x, y, z] = b.pose.p, scope = `${engine.navEpochV1()}|${Math.round(x * 2)},${Math.round(y * 2)},${Math.round(z * 2)}`, key = `${scope}|${capId}`;
    const hit = this.routeMemo.get(key); if (hit !== undefined) return hit;
    const issue = this.mw.feasibility.canPerform({actor: soul.entityId, label: plan.label, steps: plan.steps}, 'route|' + scope);   // B-facade: a verdict per (nav epoch, 0.5 m cell) on a replica
    const out = issue && ROUTE_DEAD.has(issue.code) ? {code: issue.code, reason: humanBlockedExplanationV1(issue.code, plan.label)} : null;
    this.routeMemo.set(key, out); if (this.routeMemo.size > 4096) this.routeMemo.delete(this.routeMemo.keys().next().value!);
    return out;
  }
  private routeMemo = new Map<string, {code: string; reason: string} | null>();
  private arm(p: Pending) {
    this.pending.set(p.soul.soulId, p);
    this.db.db.prepare('UPDATE edge_receipts_v1 SET plan=? WHERE world_id=? AND receipt_id=?').run(JSON.stringify({label: p.label, steps: p.steps}), this.host.worldId, p.receipt);
  }
  private async decide(soul: EdgeSoul, receipt: string, capability: string, label: string, steps: Program['steps']) {
    // entry 35: holding hands, a plain walk is a walk together and anything else lets go first
    steps = this.together.holdingSteps(soul, capability, steps);
    const unsupported = this.nativeUseRefusal?.(capability, steps);
    if (unsupported) { this.update(receipt, {phase: 'failed', code: unsupported.code, reason: unsupported.reason}); return; }
    this.planFor(receipt, capability, label, steps);
    return this.host.enqueue('decision', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: capability, label, steps, reevalTicks: 1e9, fallback: false, trigger: `edge-act:${receipt}`});
  }

  // ---------------------------------------------------------------- capabilities
  /**
   * L3 (server reliability, 2026-10-31): a Soul's menu, kept while nothing it reads has changed instead of for one tick.
   * The expensive part (everything up to the ride shaping, `bindsCore`) is cached under `menuKey`; the cheap, fast-moving
   * part (`bindsTail`: object providers such as a ride's phase, the seated-rider stand refusal, rigid bodies, secrets)
   * is redone once per tick on copies, so callers that add on-demand offers never write into the cache. Within one
   * tick the same object is returned (as before: on-demand additions made earlier in the tick are still seen).
   */
  private binds(soul: EdgeSoul): {caps: EdgeCapability[]; plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>} {
    const tick = this.mw.world.tick, hit = this.capCache.get(soul.soulId);
    // within one tick bodies do not move, but an act, a closed receipt or a god commit made earlier in this tick may have
    // changed what this Soul can do (another Soul's claim on a spot): the same-tick copy is reused only while those hold
    const sig = this.sameTickSig();
    if (hit?.last?.tick === tick && hit.last.sig === sig) {menuStats.cap.hit++; return hit.last.value;}
    const key = this.menuKey(soul, tick);
    if (hit && hit.key === key && tick - hit.tick < MENU_MAX_AGE_TICKS && this.readsHold(soul, hit.reads)) {
      menuStats.cap.hitKept++; const value = this.bindsTail(soul, hit.value); hit.last = {tick, sig, value};
      if (MENU_ORACLE) {const diff = this.menuOracleV1(soul, value); if (diff) {menuStats.cap.oracleMiss++; console.error('[menu-oracle]', soul.soulId, diff);}}
      return value;
    }
    menuStats.cap.miss++; if (hit) menuStats.cap[hit.key !== key ? 'missKey' : tick - hit.tick >= MENU_MAX_AGE_TICKS ? 'missAge' : 'missReads']++; else menuStats.cap.missAbsent++;
    menuStats.missBySoul[soul.soulId] = (menuStats.missBySoul[soul.soulId] ?? 0) + 1;
    const c0 = cpuNow(), {core, reads} = this.recordReads(() => this.bindsCore(soul)); menuStats.cap.cpuUs += cpuNow() - c0;
    const value = this.bindsTail(soul, core); this.capCache.set(soul.soulId, {tick, key, reads, value: core, last: {tick, sig, value}}); return value;
  }
  /** Everything a Soul's menu reads that moves without a version of its own: its body (position to 5 cm, level, activity, ride),
   *  its look (`body`: a seat too high or low for its height is refused, R2 gate use-check),
 *  the bodies within go-near reach (5 cm, activity), the cells versions near it (acts and closed receipts bump
   *  them), the together version, the static world and the menu generation (global clears). Rigid bodies (creatures)
   *  are keyed by tick (their shaping edits the offers in place). */
  /**
   * L3 item 4: one offer of this Soul's menu, built as the whole menu would build it (`binds().caps.find(id)` and
   * `binds().plans.get(id)`), without building the rest. A menu already built this tick, or kept under its key, answers
   * from itself; otherwise a focused build (`focusFor`) runs only the sections that can produce `id`. Undefined: not offered.
   */
  bindOne(soul: EdgeSoul, id: string): {cap: EdgeCapability; plan: ReturnType<Plans["get"]>} | undefined {
    const c0 = cpuNow(), out = this.bindOneRaw(soul, id); menuStats.one.n++; menuStats.one.cpuUs += cpuNow() - c0;
    if (MENU_ORACLE) {const diff = this.bindOneOracleV1(soul, id, out); if (diff) {menuStats.one.oracleMiss++; console.error('[bind-one-oracle]', soul.soulId, id, diff);}}
    return out;
  }
  private bindOneRaw(soul: EdgeSoul, id: string) {
    const b = this.bindFocus(soul, focusFor(id)), cap = b.caps.find(c => c.id === id);
    return cap ? {cap, plan: b.plans.get(id)} : undefined;
  }
  /** The offers a focus names, in the whole menu's order (`binds().caps.filter(wants)`; plans: at least theirs). */
  bindFocus(soul: EdgeSoul, focus: MenuFocus): {caps: EdgeCapability[]; plans: Plans} {
    const only = (b: {caps: EdgeCapability[]; plans: Plans}) => {
      const caps = b.caps.filter(c => wants(focus, c.id, c.verb, c.target?.id)), plans: Plans = new Map();
      for (const c of caps) {const p = b.plans.get(c.id); if (p) plans.set(c.id, p);}
      return {caps, plans};
    };
    const tick = this.mw.world.tick, hit = this.capCache.get(soul.soulId);
    if (hit?.last?.tick === tick && hit.last.sig === this.sameTickSig()) {menuStats.one.sameTick++; return only(hit.last.value);}
    if (hit && hit.key === this.menuKey(soul, tick) && tick - hit.tick < MENU_MAX_AGE_TICKS && this.readsHold(soul, hit.reads)) {menuStats.one.kept++; return only(this.bindsTail(soul, only(hit.value), focus));}
    // a focused build is kept like a whole menu (same key, same reads), per focus: `here` asks the same one every frame
    const sig = focusSig(focus), mine = this.focusCache.get(soul.soulId), kept = mine?.get(sig), key = this.menuKey(soul, tick, focus);
    if (kept && kept.key === key && tick - kept.tick < MENU_MAX_AGE_TICKS && this.readsHold(soul, kept.reads)) {
      menuStats.one.keptFocus++; const value = only(this.bindsTail(soul, kept.value, focus));
      if (MENU_ORACLE) {const fresh = only(this.bindsTail(soul, only(this.bindsCore(soul, focus)), focus)), a = JSON.stringify([value.caps, [...value.plans]]), b = JSON.stringify([fresh.caps, [...fresh.plans]]); if (a !== b) {menuStats.one.oracleMiss++; let i = 0; while (i < a.length && a[i] === b[i]) i++; console.error('[focus-oracle]', soul.soulId, sig.slice(0, 120), 'kept', a.slice(Math.max(0, i - 80), i + 160), '| fresh', b.slice(Math.max(0, i - 80), i + 160));}}
      return value;
    }
    menuStats.one.built++; countFocusMiss(mine, kept, key, tick, () => this.readsHold(soul, kept!.reads));
    const {core, reads} = this.recordReads(() => only(this.bindsCore(soul, focus)));
    const m = mine ?? new Map(); m.set(sig, {tick, key, reads, value: core}); if (m.size > 8) m.delete(m.keys().next().value!); this.focusCache.set(soul.soulId, m);
    return only(this.bindsTail(soul, core, focus));
  }
  private focusCache = new Map<string, Map<string, {tick: number; key: string; reads: MenuReads; value: {caps: EdgeCapability[]; plans: Plans}}>>();
  /** Debug (EDGE_MENU_ORACLE=1, and tests): the difference between bindOne(id) and the whole menu's offer, or null. */
  bindOneOracleV1(soul: EdgeSoul, id: string, got = this.bindOneRaw(soul, id)): string | null {
    const full = this.bindsTail(soul, this.bindsCore(soul)), cap = full.caps.find(c => c.id === id), want = cap ? {cap, plan: full.plans.get(id)} : undefined;
    const a = JSON.stringify(got ?? null), b = JSON.stringify(want ?? null);
    if (a === b) return null;
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    return `bindOne ${a.slice(Math.max(0, i - 80), i + 160)} | menu ${b.slice(Math.max(0, i - 80), i + 160)}`;
  }
  private menuKey(soul: EdgeSoul, tick: number, focus?: MenuFocus): string {
    const me = this.body(soul.entityId); if (!me || isRigidBody(me)) return `tick:${tick}`;
    const [x, y, z] = me.pose.p, h = me.human as {activity?: unknown; baseActivity?: unknown; level?: unknown; seat?: unknown} | undefined;
    const ride = this.aboard(soul.entityId), stepping = ride ? this.stepOutRefusal(soul.entityId) : null;
    // positions to 5 cm: offers are ordered by distance (nearest spots first) and a wave faces where the other body
    // stands, so a moving body (mine or a neighbour's) is a new menu; a still one keeps it (L3 measured: 1 m cells
    // reordered activity spots within the cell)
    const q = (v: number) => Math.round(v * 20);
    let near = ''; const r2 = (GO_NEAR_RADIUS + 1) ** 2;
    for (const o of this.host.minds.values()) {
      if (o.soulId === soul.soulId || this.faded.has(o.soulId)) continue; const ob = this.body(o.entityId); if (!ob) continue;
      const dx = ob.pose.p[0] - x, dz = ob.pose.p[2] - z; if (dx * dx + dz * dz > r2) continue;
      // within wave reach the plan faces the exact point where they stand (a 1 cm drift is a different wave): exact there
      const exact = dx * dx + dz * dz <= (NEAR_RADIUS + 1) ** 2;
      // L3 (a): a focused build keeps only the offers its focus names; another Soul's position is read by the offers aimed
      // at that Soul (go-near, wave, face, together gestures) and by spot/seat claims (recorded reads; a seat taken changes
      // its activity). A Soul the focus does not name is keyed by its radius band and activity, not where it stands
      if (focus && !focus.targets.has(o.soulId) && ![...focus.ids].some(id => id.endsWith(':' + o.soulId))) {near += `${o.soulId}~${exact ? 1 : 2},${String(ob.human?.activity ?? '')};`; continue;}
      near += exact ? `${o.soulId}=${ob.pose.p[0]},${ob.pose.p[1]},${ob.pose.p[2]},${String(ob.human?.activity ?? '')};` : `${o.soulId}@${q(ob.pose.p[0])},${q(ob.pose.p[1])},${q(ob.pose.p[2])},${String(ob.human?.activity ?? '')};`;
    }
    return `${this.staticVersion()}|${this.menuInputs()}|${this.menuGen}|${this.together.version}|${this.cellsNear(x, z)}|${q(x)},${q(y)},${q(z)},${String(h?.activity ?? '')},${String(h?.baseActivity ?? '')},${String(h?.level ?? '')},${JSON.stringify(h?.seat ?? null)},${JSON.stringify((me as {body?: unknown}).body ?? null)}|${ride ? `${ride.id},${ride.phase},${ride.riderPhase},${stepping?.code ?? ''}` : ''}|${this.faded.has(soul.soulId) ? 'f' : ''}|${this.clockMinute(tick)}|${near}`;
  }
  /**
   * L3 (b): the menu plain words are resolved against (POST /resolve, act in words, route/part lookups). Words choose an
   * offer; they never act on this menu's copy of it: `exactWords` rebuilds the chosen offer exactly (bindOne) before it is
   * reported or acted on. So this menu may be kept where the whole menu may not: other Souls by what they are to me (the
   * radius bands the offers read: 8 m gesture reach, 20 m wave/follow reach, 60 m go-near/invite reach, enclosure, order by
   * distance, activity, state) instead of where they stand, my own position by 2 m cell, and not over my own accepted acts
   * or the 32 m cell versions (a claimed spot is a recorded read; the chosen offer's availability is checked exactly).
   * Kept at most WORDS_MAX_AGE_TICKS. `exact`: this is the whole menu as `binds` would build it now.
   * Oracle (EDGE_MENU_ORACLE=1): every resolution made on a kept words menu is compared with the same words on a fresh
   * whole menu (`[words-oracle]`, counter words.oracleMiss).
   */
  wordsMenu(soul: EdgeSoul): {caps: EdgeCapability[]; plans: Plans; exact: boolean} {
    const tick = this.mw.world.tick, hit = this.capCache.get(soul.soulId), sig = this.sameTickSig();
    const exact = (v: {caps: EdgeCapability[]; plans: Plans}) => ({caps: v.caps, plans: v.plans, exact: true});
    if (hit?.last?.tick === tick && hit.last.sig === sig) {menuStats.words.exact++; return exact(hit.last.value);}
    if (hit && hit.key === this.menuKey(soul, tick) && tick - hit.tick < MENU_MAX_AGE_TICKS && this.readsHold(soul, hit.reads)) {menuStats.words.exact++; return exact(this.binds(soul));}
    const key = this.wordsKey(soul, tick), w = this.wordsCache.get(soul.soulId);
    if (w?.last?.tick === tick && w.last.sig === sig && w.key === key) {menuStats.words.kept++; return {...w.last.value, exact: false};}
    if (w && w.key === key && tick - w.tick < WORDS_MAX_AGE_TICKS && this.readsHold(soul, w.reads)) {
      menuStats.words.kept++; const value = this.bindsTail(soul, w.value); w.last = {tick, sig, value}; return {...value, exact: false};
    }
    menuStats.words.built++; const value = this.binds(soul), fresh = this.capCache.get(soul.soulId)!;
    this.wordsCache.set(soul.soulId, {tick, key, reads: fresh.reads, value: fresh.value, last: {tick, sig, value}});
    return exact(value);
  }
  /**
   * srv-act-words: plain words of a common shape (a walk to a named place, a sit, standing up, a wave, a dance, a wander;
   * vocabulary `wordsFocusVerbsV1`) resolved on a focused build of every verb those words can read, instead of the words
   * menu (for an acting Soul that was the whole menu every time: its own act changes its activity and cell). The focused
   * offers are the whole menu's (bindFocus, edge-bind-one-oracle) and the resolution reads no other verb, so it answers as
   * the whole menu would. Words that name a Soul (together's social phrasing reads the social offers), a purpose or a
   * floor, and words it cannot answer (an unknown's reason and did_you_mean read the whole menu), return null: the words
   * menu, as before. Oracle (EDGE_MENU_ORACLE=1): every answer vs the same words on a fresh whole menu
   * (`[words-focus-oracle]`, words.focusOracleMiss).
   */
  wordsFocused(soul: EdgeSoul, text: string): {caps: EdgeCapability[]; plans: Plans; pre: ReturnType<EdgeLedger['resolveOnDemand']>} | null {
    const verbs = wordsFocusVerbsV1(text); if (!verbs || PURPOSE.test(text.trim()) || floorWords(text)) return null;
    const low = text.toLowerCase(), toks = tokens(low);
    if (/\b(?:him|her|them|they|she|he|me|us|my|with|together)\b/.test(low)) return null;
    for (const m of this.host.minds.values()) if (m.soulId !== soul.soulId && (low.includes(m.soulId.toLowerCase()) || tokens(m.name).some(t => toks.includes(t)))) return null;
    // (C) a walk whose destination words name no place (placeMatch: names, ids, aliases, kinds, descriptions) is decided on
    // the words menu before any focused build (a misspelt or unknown place answered unknown on the focus, then paid for the
    // words menu too); a thing's name, a typo the words menu reads: the words menu, as before
    const dest = WALK_DEST.exec(low.trim().replace(/\s+/g, ' '));
    let keep: MenuFocus['walkKeep'] | undefined;
    if (dest) {
      const vp = this.vocabPlaces(soul), {places, withheld} = vp;
      // (whether the words name a place, kept per places listing: a miss scans every place's words, ~1 ms on Eden 2026)
      let named = NAMES_PLACE.get(vp); if (!named) NAMES_PLACE.set(vp, named = new Map());
      let hit = named.get(dest[1]); if (hit === undefined) {hit = placeMatch(tokens(dest[1]), places, withheld).length > 0; if (named.size >= 512) named.clear(); named.set(dest[1], hit);}
      if (!hit) {menuStats.words.focusSkipped++; return null;}
      // (D) ... and builds only the walks those words could choose (vocabulary walkKeepV1), not every walk's route goal
      const test = walkKeepV1(dest[1], places, this.vocabularyOf(soul, []).target);
      if (test) keep = {sig: dest[1], keep: test};
    }
    let f = this.bindFocus(soul, {ids: new Set(), verbs, targets: new Set(), ...(keep ? {walkKeep: keep} : {})});
    // (a kept build need not have run the test; the words' own verbs must all still be offered, as on the whole focus,
    // else parseCapability could read them differently: build every walk)
    if (keep && !['walk', 'hang-out', 'stroll', 'sit'].every(v => !verbs.has(v) || f.caps.some(c => c.verb === v))) {menuStats.words.keepWidened++; f = this.bindFocus(soul, {ids: new Set(), verbs, targets: new Set()});}
    else if (keep) menuStats.words.keepNarrowed++;
    if (this.together.resolve(soul, text, [...f.caps], new Map(f.plans) as Map<string, TogetherPlan>)) return null;
    const pre = this.resolveOnDemand(soul, text, [...f.caps], new Map(f.plans));
    if (pre.v.kind === 'unknown') {menuStats.words.focusUnknown++; return null;}
    menuStats.words.focused++;
    if (MENU_ORACLE) {const diff = this.wordsFocusDiffV1(soul, text, pre.v); if (diff) {menuStats.words.focusOracleMiss++; console.error('[words-focus-oracle]', soul.soulId, JSON.stringify(text), diff);}}
    return {caps: f.caps, plans: f.plans, pre};
  }
  /** Debug (tests; EDGE_MENU_ORACLE=1): null when `v` (default: wordsFocused's answer) is exactly what the same words
   *  resolve to on a whole menu built fresh now (kind, offer, params, note, did_you_mean), else both. Never writes a cache. */
  wordsFocusDiffV1(soul: EdgeSoul, text: string, v?: VocabResult): string | null {
    if (!v) {const f = this.wordsFocused(soul, text); if (!f) return null; v = f.pre.v;}
    const fresh = this.bindsTail(soul, this.bindsCore(soul)), r = this.resolveOnDemand(soul, text, [...fresh.caps], new Map(fresh.plans)).v;
    const a = JSON.stringify(v), b = JSON.stringify(r);
    return a === b ? null : `focused ${a.slice(0, 400)} | fresh ${b.slice(0, 400)}`;
  }
  private wordsCache = new Map<string, {tick: number; key: string; reads: MenuReads; value: {caps: EdgeCapability[]; plans: Plans}; last?: {tick: number; sig: string; value: {caps: EdgeCapability[]; plans: Plans}}}>();
  private wordsKey(soul: EdgeSoul, tick: number): string {
    const me = this.body(soul.entityId); if (!me || isRigidBody(me)) return `tick:${tick}`;
    const [x, y, z] = me.pose.p, h = me.human as {activity?: unknown; baseActivity?: unknown; level?: unknown; seat?: unknown} | undefined;
    const ride = this.aboard(soul.entityId), stepping = ride ? this.stepOutRefusal(soul.entityId) : null, c = (v: number) => Math.floor(v / WORDS_CELL_M);
    // the bands every offer about another Soul reads (perceivedBodies' radius and enclosure, together's 8/20/60 m), in
    // perceivedBodies' order (nearest first, its 0.1 m rounding)
    const myEnc = this.enclosureOf(soul.soulId), near: {d: number; s: string}[] = [];
    for (const o of this.host.minds.values()) {
      if (o.soulId === soul.soulId || this.faded.has(o.soulId)) continue; const ob = this.body(o.entityId); if (!ob) continue;
      const d = Math.hypot(ob.pose.p[0] - x, ob.pose.p[2] - z); if (d > GO_NEAR_RADIUS + 1) continue;
      const r = Math.round(d * 10) / 10;
      near.push({d: r, s: `${o.soulId}:${d <= GO_NEAR_RADIUS ? 1 : 0}${d <= NEAR_RADIUS ? 1 : 0}${r <= NEAR_RADIUS ? 1 : 0}${r <= 8 ? 1 : 0}${this.enclosureOf(o.soulId) === myEnc ? 1 : 0},${String(ob.human?.activity ?? '')},${String(ob.human?.baseActivity ?? '')},${stateOf(this.host, o.entityId)},${this.aboard(o.entityId)?.id ?? ''}`});
    }
    const order = near.sort((a, b) => a.d - b.d).map(n => n.s).join(';');
    return `${this.staticVersion()}|${this.menuInputs()}|${this.menuGen}|${this.together.version}|${c(x)},${c(z)},${Math.round(y)},${String(h?.activity ?? '')},${String(h?.baseActivity ?? '')},${String(h?.level ?? '')},${JSON.stringify(h?.seat ?? null)}|${ride ? `${ride.id},${ride.phase},${ride.riderPhase},${stepping?.code ?? ''}` : ''}|${this.faded.has(soul.soulId) ? 'f' : ''}|${this.clockMinute(tick)}|${order}`;
  }
  /**
   * L3 (b): what words resolved to on `menu` (a `wordsMenu`), as it is now: an offer taken from a kept words menu is built
   * again exactly (bindOne), and when that offer is gone or its availability changed, the words are resolved again on the
   * whole menu. Offers made on demand while resolving are built fresh and stay as they are. `plans` gets the exact plan.
   */
  exactWords(soul: EdgeSoul, menu: {caps: EdgeCapability[]; exact: boolean}, text: string, v: VocabResult, plans?: Plans): VocabResult {
    if (menu.exact || v.kind === 'unknown' || !menu.caps.includes(v.cap)) {this.wordsOracle(soul, menu, text, v); return v;}
    const one = this.bindOne(soul, v.cap.id);
    if (one && one.cap.available === v.cap.available && one.cap.blocked?.code === v.cap.blocked?.code) {
      menuStats.words.exactified++; if (plans && one.plan) plans.set(one.cap.id, one.plan); const out = {...v, cap: one.cap} as VocabResult;
      this.wordsOracle(soul, menu, text, out); return out;
    }
    menuStats.words.fellBack++; const b = this.binds(soul), r = this.resolveOnDemand(soul, text, [...b.caps], new Map(b.plans)).v;
    if (plans && r.kind !== 'unknown') {const p = b.plans.get(r.cap.id); if (p) plans.set(r.cap.id, p);}
    return r;
  }
  /** L3 (b): what resolveOnDemand(id) on the whole menu answers for an exact capability id, without building that menu:
   *  the one offer (bindOne; a secret one is not known here, as resolveOnDemand says), else the words menu, where the id
   *  may be made on demand (a far part's walk). */
  resolveIdV1(soul: EdgeSoul, id: string): VocabResult {
    const one = this.bindOne(soul, id);
    if (one) return this.secretOffer(soul, one.cap) ? {kind: 'unknown', code: 'capability.unknown', reason: 'That action is not known here.', didYouMean: []} : {kind: 'exact', cap: one.cap};
    const w = this.wordsMenu(soul); return this.exactWords(soul, w, id, this.resolveOnDemand(soul, id, [...w.caps], new Map(w.plans)).v);
  }
  private wordsOracle(soul: EdgeSoul, menu: {exact: boolean}, text: string, v: VocabResult) {
    if (!MENU_ORACLE || menu.exact) return;
    const diff = this.wordsDiffV1(soul, text, v); if (diff) {menuStats.words.oracleMiss++; console.error('[words-oracle]', soul.soulId, JSON.stringify(text), diff);}
  }
  /** Debug (tests; EDGE_MENU_ORACLE=1): null when `v` (default: the words resolved on the words menu, as act and resolve
   *  read them) is what the same words resolve to on a menu built fresh now, else both. Never writes a cache. */
  wordsDiffV1(soul: EdgeSoul, text: string, v?: VocabResult): string | null {
    if (!v) {const w = this.wordsMenu(soul); v = this.exactWords(soul, w, text, this.resolveOnDemand(soul, text, [...w.caps], new Map(w.plans)).v);}
    const fresh = this.bindsTail(soul, this.bindsCore(soul)), r = this.resolveOnDemand(soul, text, [...fresh.caps], new Map(fresh.plans)).v;
    const sum = (x: VocabResult) => JSON.stringify(x.kind === 'unknown' ? {kind: x.kind, code: x.code ?? null} : {kind: x.kind, cap: x.cap, params: (x as {params?: unknown}).params ?? null});
    return sum(v) === sum(r) ? null : `kept ${sum(v).slice(0, 300)} | fresh ${sum(r).slice(0, 300)}`;
  }
  /** L3 oracle (tests; EDGE_MENU_ORACLE=1 on every kept menu): null when `menu` (default: what binds returns now) equals
   *  a menu built fresh from the world as it is, else the first difference. Never writes the cache. */
  menuOracleV1(soul: EdgeSoul, menu = this.binds(soul)): string | null {
    const fresh = this.bindsTail(soul, this.bindsCore(soul));
    const a = menu.caps.map(c => JSON.stringify(c)), b = fresh.caps.map(c => JSON.stringify(c));
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `offer ${i}: kept ${a[i]?.slice(0, 300)} / fresh ${b[i]?.slice(0, 300)}`;
    for (const [id, p] of fresh.plans) {const k = JSON.stringify(menu.plans.get(id)), f = JSON.stringify(p); if (k !== f) return `plan ${id}: kept ${k?.slice(0, 300)} / fresh ${f.slice(0, 300)}`;}
    if (menu.plans.size !== fresh.plans.size) return `plans: kept ${menu.plans.size} / fresh ${fresh.plans.size}`;
    return null;
  }
  /** What a menu build read from other bodies that the key does not carry: whether a spot (up to SPOT_REACH away) has a
   *  body on it, and how many are in a together group ("1 waiting, join them"; a hearer needs a teller at the teller's
   *  spot). A kept menu is reused only while every one of these reads would answer the same now. */
  private menuReads: MenuReads | null = null;
  private recordReads<T>(build: () => T): {core: T; reads: MenuReads} {
    const outer = this.menuReads, reads: MenuReads = {taken: [], groups: new Map()}; this.menuReads = reads;
    try {return {core: build(), reads};} finally {this.menuReads = outer;}
  }
  private readsHold(soul: EdgeSoul, reads: MenuReads): boolean {
    if (!reads.taken.length && !reads.groups.size) return true;
    const humans = Object.values((this.mw.world as NativeWorld).entities).filter(e => e.kind === 'human');
    for (const [g, n] of reads.groups) if (humans.filter(e => e.human?.together?.group === g).length !== n) return false;
    const others = humans.filter(e => e.id !== soul.entityId);
    for (const t of reads.taken) if (others.some(o => Math.hypot(o.pose.p[0] - t.at[0], o.pose.p[2] - t.at[1]) < 0.7) !== t.v) return false;
    return true;
  }
  /** The world clock's minute (activities name it: "it is 14:03 now"), or '' in a world without a day. */
  private clockMinute(tick: number): string {
    const l = this.host.living; if (!l) return ''; const c = clockAt(tick, l.origin, l.dayTicks); return `${c.hour}:${c.minute}`;
  }
  /** Global menu generation: bumped where every Soul's menu must rebuild (dropMenus). */
  private menuGen = 0;
  /** Bumped by every local change (menusChangedBy); with the together and static versions it guards the same-tick reuse. */
  private menuEpoch = 0;
  private sameTickSig(): string {return `${this.menuGen}|${this.menuEpoch}|${this.together.version}|${this.staticVersion()}|${this.menuInputs()}`;}
  /** Versions of world state a menu reads that the ledger does not own (a god world's commits: ownership, private access;
   *  its construction sites, which open and close with time): registered by the world (engine-bridge). */
  private menuInputFns: (() => string)[] = [];
  /** L3 item 4: the focus of the menu build in progress (null: the whole menu). The world profile reads it (menuFocusV1). */
  private menuFocus: MenuFocus | null = null;
  menuFocusV1(): MenuFocus | null {return this.menuFocus;}
  addMenuInput(f: () => string) {this.menuInputFns.push(f);}
  /** B-delta seam: each registered menu input's current value (the delta replicates them; a read worker's ledger registers
   *  one input that answers the replicated values). */
  menuInputsV1(): string[] {return this.menuInputFns.map(f => {try {return f();} catch {return '?';}});}
  private menuInputs(): string {let out = ''; for (const f of this.menuInputFns) try {out += f() + ';';} catch {out += '?;';} return out;}
  /** Versions of 32 m cells, bumped where an act was accepted or a receipt closed (the actor's body, the act's target). */
  private cellVersions = new Map<string, number>();
  private bumpCellsAt(points: ([number, number] | null | undefined)[]) {
    for (const p of points) if (p) {const k = `${Math.floor(p[0] / MENU_CELL_M)},${Math.floor(p[1] / MENU_CELL_M)}`; this.cellVersions.set(k, (this.cellVersions.get(k) ?? 0) + 1);}
  }
  /** Sum of the cell versions within MENU_REACH_M of a point (versions only grow, so any bump nearby moves the sum). */
  private cellsNear(x: number, z: number): number {
    if (!this.cellVersions.size) return 0;
    const r = Math.ceil(MENU_REACH_M / MENU_CELL_M), cx = Math.floor(x / MENU_CELL_M), cz = Math.floor(z / MENU_CELL_M); let sum = 0;
    for (let i = cx - r; i <= cx + r; i++) for (let k = cz - r; k <= cz + r; k++) sum += this.cellVersions.get(`${i},${k}`) ?? 0;
    return sum;
  }
  /** L3: an act or a receipt changed what Souls near it can do (a seat taken, an invitation, a bicycle out): the menus
   *  of the actor and of every Soul within reach of the actor or the act's target rebuild; Souls farther off keep theirs. */
  private menusChangedBy(site: string, soulId: string, capability?: string) {
    countClear(site, true); this.capCache.delete(soulId); this.menuEpoch++;
    const m = this.host.minds.get(soulId), b = m ? this.body(m.entityId) : undefined;
    this.bumpCellsAt([b ? [b.pose.p[0], b.pose.p[2]] : null, capability ? this.capabilityPoint(capability) : null]);
  }
  /** Where an offer's target is (a Soul, a thing, a place or an activity spot named after the verb), or null. */
  private capabilityPoint(capability: string): [number, number] | null {
    const rest = capability.slice(capability.indexOf(':') + 1), id = rest.startsWith('object:') ? rest : rest.split(':')[0]!;
    const soul = this.host.minds.get(id), e = this.mw.world.entities[soul?.entityId ?? id];
    if (e) return [e.pose.p[0], e.pose.p[2]];
    const place = this.places.byId.get(id); if (place?.polygon?.length) return centroid(place.polygon);
    const spot = this.spots.spots.find(s => s.id === id); return spot ? spot.at : null;
  }
  private bindsTail(soul: EdgeSoul, core: {caps: EdgeCapability[]; plans: Plans}, focus?: MenuFocus): {caps: EdgeCapability[]; plans: Plans} {
    const caps = core.caps.slice(), plans = new Map(core.plans), me = this.body(soul.entityId);
    const ride = this.aboard(soul.entityId), stepping = ride ? this.stepOutRefusal(soul.entityId) : null;
    // (a focused build: object offers only when the focus names one, or aboard, where stand:here names the ride's leave)
    // (L3 c: a focus that names objects builds only theirs: the object ids of its ids, and its targets)
    const objs = !focus || ride || focus.verbs.has('object') ? undefined : focusObjects(focus);
    if (!focus || ride || focus.verbs.has('object') || objs!.size) {const outer = this.carrierPass; this.carrierPass = outer ?? {}; try {for (const p of this.providers) try {caps.push(...p(soul, objs, this.objectPlaces));} catch {/* a provider fault hides only its own entries */}} finally {this.carrierPass = outer;}}
    if (ride && !stepping) {const seated = this.rideStandRefusal(soul.entityId, caps), i = seated ? caps.findIndex(c => c.id === 'stand:here') : -1; if (i >= 0) caps[i] = {...caps[i]!, available: false, blocked: seated!};}
    shapeRigidCapabilities(me, caps, plans as never, {seconds: {type: 'integer', min: 1, max: 600, default: 60}});
    if(me?.body?.motion?.dance||hasDeclaredProfile(me?.body))for(const c of caps){if(!['dance:here','rest:here','nap:here','lie:here'].includes(c.id))continue;const p=plans.get(c.id);if(p){const issue=this.mw.feasibility.canPerform({actor:soul.entityId,label:p.label,steps:p.steps});if(issue){c.available=false;c.blocked={code:issue.code,reason:issue.message};}}}
    // knowledge/1: an offer that leads to (or names) a secret place this Soul has not been to or found is not offered
    if (this.knowledge.marked().size) for (let i = caps.length - 1; i >= 0; i--) {if (this.secretOffer(soul,caps[i]!)) {plans.delete(caps[i]!.id); caps.splice(i, 1);}}
    return {caps, plans};
  }
  /** The menu before the tail (see binds): cached. */
  private bindsCore(soul: EdgeSoul, focus?: MenuFocus): {caps: EdgeCapability[]; plans: Plans} {
    // L3 item 4: the whole build is one engine read pass (the planner syncs once; the passes inside reuse it)
    const eng = this.mw as unknown as {readPassV1?: <T>(f: () => T) => T};
    return eng.readPassV1 ? eng.readPassV1(() => this.bindsCoreIn(soul, focus)) : this.bindsCoreIn(soul, focus);
  }
  private bindsCoreIn(soul: EdgeSoul, focus?: MenuFocus): {caps: EdgeCapability[]; plans: Plans} {
    const m = this.mind(soul), read = readHumanCapabilitiesV1(this.host, m, {registeredActivitiesV1: true, deferRouteChecks: true, skipRegisteredCards: true});
    const caps: EdgeCapability[] = [], plans = new Map<string, {label: string; steps: Program['steps']; seconds?: boolean; stop?: boolean}>();
    const secondsParam = {seconds: {type: 'integer', min: 1, max: 600, default: 60}};
    for (const b of read.bindings.values()) this.addNativeBinding(b,caps,plans,secondsParam);
    caps.push({id: 'stand:here', verb: 'stand', label: 'Stand up / stop what I am doing', available: true});
    plans.set('stand:here', {label: 'Stand up', steps: [], stop: true});
    // CN5 (acceptance): go near anyone in sight within 60 m (a gesture to someone farther off offers this first)
    const myHuman = this.body(soul.entityId)?.human, sitting = !!myHuman && (myHuman.activity === 'sit' || myHuman.baseActivity === 'sit');
    for (const o of this.perceivedBodies(soul.soulId, GO_NEAR_RADIUS)) {
      // GEST-LIVE: a seated Soul rises first (from a classroom seat the bare walk was refused route.start-blocked, no did_you_mean)
      const id = 'go-near:' + o.soulId, steps: Program['steps'] = [...(sitting ? [{verb: 'stand', params: {}}] : []), {verb: 'walk_to', params: {to: o.entityId, standoff: 1.3}}];
      caps.push({id, verb: 'go-near', label: `Go near ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});   // route checked at act time
      plans.set(id, {label: `Go near ${o.name}`, steps});
    }
    // Lasting marks (objects the Soul authors where it stands): a note/sign/offering, or a shared project.
    if (this.comms) {
      const makeParams = {form: {type: 'string', enum: ['note', 'sign', 'offering', 'proposal'], optional: true}, title: {type: 'string', maxLength: 60}, text: {type: 'string', maxLength: 500}};
      caps.push({id: 'make:mark', verb: 'make', label: 'Leave a note, sign, offering or proposal here (lasting; others can read and respond; the steward may calendar proposals)', available: true, params: makeParams});
      caps.push({id: 'make:project', verb: 'make', label: 'Start a shared project here (others can contribute steps)', available: true, params: {title: {type: 'string', maxLength: 60}, text: {type: 'string', maxLength: 500}}});
      plans.set('make:mark', {label: 'Make a mark', steps: [], make: 'mark'} as never); plans.set('make:project', {label: 'Start a project', steps: [], make: 'project'} as never);
    }
    // Social and expressive native verbs: visible, deterministic, shared by many Souls at once.
    const secondsOf = (def: number, max: number) => ({seconds: {type: 'integer', min: Math.min(5, def), max, default: def}});
    // CN5 (acceptance): a solo wave, with nobody in particular near (or facing someone/something: {"to": …})
    caps.push({id: 'wave:here', verb: 'wave', label: 'Wave (to nobody in particular, or {"to": a name} to face someone)', available: true, params: {to: {type: 'string', optional: true, description: 'a Soul, place or thing to face'}}});
    plans.set('wave:here', {label: 'Wave', steps: [{verb: 'mars:pose_v1', params: {activity: 'wave', seconds: 3}}]});
    caps.push({id: 'wander:here', verb: 'wander', label: 'Stroll around nearby', available: true, params: secondsOf(60, 300)});
    plans.set('wander:here', {label: 'Stroll around nearby', steps: [{verb: 'ambient_wander', params: {seconds: 60, radius: 8}}], seconds: true});
    for (const o of this.perceivedBodies(soul.soulId, NEAR_RADIUS)) {
      caps.push({id: 'wave:' + o.soulId, verb: 'wave', label: `Wave to ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      // P0b: a real wave (body activity 'wave' for 3 s, facing them) once within a couple of metres.
      const ob = this.body(o.entityId);
      plans.set('wave:' + o.soulId, {label: `Wave to ${o.name}`, steps: [{verb: 'walk_to', params: {to: o.entityId, standoff: 1.6}}, {verb: 'wave', params: {at: o.entityId, seconds: 0.5}}, {verb: 'mars:pose_v1', params: {activity: 'wave', seconds: 3, ...(ob ? {face: [ob.pose.p[0], ob.pose.p[2]]} : {})}}]});
      caps.push({id: 'face:' + o.soulId, verb: 'face', label: `Turn towards ${o.name}`, target: {id: o.soulId, kind: 'soul'}, available: true});
      plans.set('face:' + o.soulId, {label: `Turn towards ${o.name}`, steps: [{verb: 'wave', params: {at: o.entityId, seconds: 1}}]});
    }
    const me = this.body(soul.entityId), w = this.mw.world as NativeWorld;
    if (me) {
      for (const e of Object.values(w.entities)) {
        // CN5 (acceptance): 150 m, so the fire is offered from the pond and the shore too
        if (!isCampfire(e) || Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) > 150) continue;
        const id = 'warm-by-fire:' + e.id, label = e.def === 'campfire' ? 'Warm up by the fire with whoever is there' : `Warm up by ${e.label && !/^ew:/.test(e.label) ? e.label : 'the campfire'} with whoever is there`;
        caps.push({id, verb: 'warm-by-fire', label, target: {id: e.id, kind: 'object'}, available: true, params: secondsOf(120, 600)});
        plans.set(id, {label, steps: [{verb:'walk_to',params:{to:e.id,standoff:2}},{verb: 'mars:campfire_circle', params: {actors: [soul.entityId], fire: e.id}}, {verb: 'rest', params: {seconds: 120}}], seconds: true});
      }
      for (const [rid, r] of Object.entries(w.regions ?? {}) as [string, {polygon: [number, number][]}][]) {
        const [cx, cz] = centroid(r.polygon); if (Math.hypot(cx - me.pose.p[0], cz - me.pose.p[2]) > 60 || !this.places.byId.has(rid)) continue;
        const id = 'gather:' + rid, label = `Gather with others at ${this.places.byId.get(rid)!.name}`;
        caps.push({id, verb: 'gather', label, target: {id: rid, kind: 'place'}, available: true, params: secondsOf(120, 600)});
        plans.set(id, {label, steps: [{verb: 'gather', params: {at: rid, seconds: 120}}], seconds: true});
      }
    }
    // Strolls: a real path through a big walkable place (waypoints on clear ground inside it), not one straight line.
    if (me) for (const c of [...caps]) {
      if (c.verb !== 'walk' || !c.available || c.target?.kind !== 'place') continue;
      const place = this.places.byId.get(c.target.id), region = (w.regions as Record<string, {polygon: [number, number][]}>)[c.target.id];
      if (!place || !region || area(region.polygon) < 250 || place.enclosed || ['sleeping-mat', 'venue', 'building', 'room', 'water'].includes(place.kind)) continue;
      if (!wants(focus, 'stroll:' + c.target.id, 'stroll', c.target.id) || bboxDistance(region.polygon, [me.pose.p[0], me.pose.p[2]]) > AROUND_REACH || bboxSpan(region.polygon) > LOOP_SPAN) continue;
      const route = this.strollRoute(c.target.id, region.polygon, [me.pose.p[0], me.pose.p[2]]); if (route.length < 2) continue;
      const id = 'stroll:' + c.target.id, label = `Stroll through ${place.name} (a loop of ${route.length} stops)`;
      caps.unshift({id, verb: 'stroll', label, target: c.target, available: true, params: {pause: {type: 'integer', min: 0, max: 60, default: 4}, via: {type: 'array', items: 'place name', maxItems: 4, optional: true}}});
      plans.set(id, {label, steps: route.flatMap((p, i) => [{verb: 'walk_to', params: {to: p}}, ...(i < route.length - 1 ? [{verb: 'rest', params: {seconds: 4}}] : [])])});
    }
    // activities/1: sit/lie/nap/read anywhere, plus World's activity spots (play-piano:<spot>, paint:<spot>…).
    if (me && activityMayOffer(focus)) try {
      // S2: the listing only reads the world; its clearance reads (clear spots, shelves, courts) share one planner sync
      // (engine readPassV1) instead of each walking every static to ask "did anything change" (~15% of a busy world)
      const spots = this.spots, aw = this.activityWorld(soul, me, caps, plans), list = () => activityCapabilities(spots, aw);
      const eng = this.mw as unknown as {readPassV1?: <T>(f: () => T) => T};
      const act = eng.readPassV1 ? eng.readPassV1(list) : list();
      // Activities lead the list (agents and the CLI read the first entries first).
      for (const c of [...act.caps].reverse()) {const i = caps.findIndex(x => x.id === c.id); if (i >= 0) caps.splice(i, 1); caps.unshift(c); plans.set(c.id, act.plans.get(c.id)!);}
    } catch (e) {if (this.activityErrors++ < 20) console.error('[edge] activity capabilities', soul.soulId, e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : e);/* activities never hide the rest */}
    // together/1: gestures, follows, items; invitations to me lead the list
    if (me && togetherMayOffer(focus)) try {
      this.together.capabilities(soul, caps, plans as Map<string, TogetherPlan>);
      const lead = caps.filter(c => c.verb === 'accept' || c.verb === 'decline'); for (const c of lead.reverse()) {caps.splice(caps.indexOf(c), 1); caps.unshift(c);}
    } catch (e) {console.error('[edge] together capabilities', e instanceof Error ? e.message : e);}
    if (this.worldProfile) try {this.menuFocus = focus ?? null; this.worldProfile(soul, caps, plans);} catch (e) {console.error('[edge] world profile', e instanceof Error ? e.message : e);} finally {this.menuFocus = null;}
    // Gaits apply to ordinary native walks, including the destinations a world creator adds.
    if (me && !isRigidBody(me)) {
      let outMemo: number | null = null;   // bicycles other Souls have out now (counted once, only when a dock is near)
      const bikesOut = () => outMemo ??= [...this.host.minds.values()].filter(m => m.soulId !== soul.soulId && this.openReceipts(m.soulId).some(r => /^cycle(?:-around)?:/.test(r.capability))).length;
      for (const c of [...caps]) {
        if (c.verb !== 'walk' || !c.target || this.places.byId.get(c.target.id)?.kind === 'water') continue;
        // world-engine worlds: jog/run to outdoor places only (Eden 2026 offered 480 gait variants, one per room, chair and
        // lamp it can walk to: a third of a 400 kB list); old worlds unchanged
        if (this.placeWalkable) {const pl = c.target.kind === 'place' ? this.places.byId.get(c.target.id) : undefined; if (!pl || pl.enclosed || ['room', 'building'].includes(pl.kind)) continue;}
        const base = plans.get(c.id); if (!base || !base.steps.some(s => s.verb === 'walk_to')) continue;
        for (const gait of ['jog', 'run'] as const) {
          if (!wants(focus, `${gait}:${c.target.id}`, gait, c.target.id)) continue;
          const id = `${gait}:${c.target.id}`, label = `${gait === 'jog' ? 'Jog' : 'Run'} to ${this.places.byId.get(c.target.id)?.name ?? c.label.replace(/^walk to /i, '')} (${gait === 'jog' ? '2.5' : '4'} m/s on dry ground)`;
          caps.push({...c, id, verb: gait, label});
          plans.set(id, {label, steps: base.steps.map(s => s.verb === 'walk_to' ? {...s, params: {...s.params, gait}} : structuredClone(s))});
        }
      }
      for (const place of this.places.byId.values()) {
        if (place.parent === null || place.carrier || place.enclosed || area(place.polygon) < 250) continue;
        // E-life (fine-tile thrash): loops round places within reach only. On Eden 2026 every lawn, wood and hill of the
        // 1 km world was looped from anywhere: their clear spots paged in ~220 nav tiles on a Soul's first capabilities
        if (focus && !['jog-around', 'run-around', 'cycle-around'].some(v => wants(focus, `${v}:${place.id}`, v, place.id))) continue;
        if (bboxDistance(place.polygon, [me.pose.p[0], me.pose.p[2]]) > AROUND_REACH || bboxSpan(place.polygon) > LOOP_SPAN) continue;
        const native = (w.regions as Record<string, unknown>)[place.id];
        if (place.kind !== 'water' && !native && !this.placeWalkable?.(place.id)) continue;
        if (!['water', 'outdoor', 'park', 'garden', 'plaza', 'lawn', 'field', 'place', 'shore'].includes(place.kind)) continue;
        const from: [number, number] = [me.pose.p[0], me.pose.p[2]];
        const route = place.kind === 'water' ? this.bankLoop(place.polygon, from) : this.strollRoute(place.id, place.polygon, from);
        if (route.length < 3) continue;
        const closed = [...route, route[0]];
        for (const gait of ['jog', 'run'] as const) {
          if (!wants(focus, `${gait}-around:${place.id}`, `${gait}-around`, place.id)) continue;
          const id = `${gait}-around:${place.id}`, label = `${gait === 'jog' ? 'Jog' : 'Run'} around ${place.name} (one loop, ${gait === 'jog' ? '2.5' : '4'} m/s on dry ground)`;
          caps.push({id, verb: `${gait}-around`, label, available: true, target: {id: place.id, kind: 'place'}});
          plans.set(id, {label, steps: closed.map(to => ({verb: 'walk_to', params: {to, gait, standoff: 0}}))});
        }
        if (place.kind !== 'water' && wants(focus, `cycle-around:${place.id}`, 'cycle-around', place.id)) this.bikeRide(soul, me, caps, plans, `cycle-around:${place.id}`, 'cycle-around', place.id, `Ride a bicycle around ${place.name}`, closed.map(to => ({verb: 'walk_to', params: {to, gait: 'cycle', standoff: 0}})), bikesOut);
      }
      // todo (leisure): ride a dock bicycle to a place and back (the ordinary walk's route, at the cycling gait)
      for (const c of [...caps]) {
        if (c.verb !== 'walk' || !c.target || c.target.kind !== 'place' || !wants(focus, `cycle:${c.target.id}`, 'cycle', c.target.id)) continue;
        const place = this.places.byId.get(c.target.id); if (!place || place.kind === 'water' || place.enclosed || (this.placeWalkable && place.kind === 'room')) continue;
        const legs = (plans.get(c.id)?.steps ?? []).filter(s => s.verb === 'walk_to').map(s => ({...s, params: {...s.params, gait: 'cycle'}})); if (!legs.length) continue;
        this.bikeRide(soul, me, caps, plans, `cycle:${place.id}`, 'cycle', place.id, `Ride a bicycle to ${place.name} and back`, legs, bikesOut);
      }
    }
    this.rideBlocks(soul, caps);
    return {caps, plans};
  }
  private addNativeBinding(b:HumanBindingV1,caps:EdgeCapability[],plans:Plans,secondsParam:EdgeCapability['params']={seconds:{type:'integer',min:1,max:600,default:60}}){
    const {id, verb} = edgeIdOf(b); const seconds = b.goal === 'sit' || b.goal === 'rest' || b.goal === 'hang_out';
    const target = b.targetId ? {id: b.targetId, kind: this.places.byId.has(b.targetId) ? 'place' : this.mw.world.entities[b.targetId] ? 'object' : 'place'} : undefined;
    caps.push({id, verb, label: b.label, available: b.available, ...(target ? {target} : {}), ...(b.available ? {} : {blocked: {code: b.blockedCode ?? 'physical.unavailable', reason: humanBlockedExplanationV1(b.blockedCode, b.label)}}), ...(seconds ? {params: secondsParam} : {})});
    const outside=b.targetId&&(b.goal==='walk'||b.goal==='hang_out')?outdoorRegionExclusions(this.places,b.targetId):undefined;
    const steps=outside!==undefined?b.steps.map(step=>step.verb==='walk_to'&&step.params.spread==='region/1'?{...step,params:{...step.params,regionOutside:outside}}:step):b.steps;
    plans.set(id, {label: b.label, steps, seconds});
  }
  /** The ride refusals that end the menu's core build (bindsCoreIn), shared with the exact-walk projection. */
  private rideBlocks(soul:EdgeSoul,caps:EdgeCapability[]){
    // A moving carrier retains its riders until it returns, regardless of which world supplied the offer.
    const ride = this.aboard(soul.entityId);
    const stepping = this.stepOutRefusal(soul.entityId);
    if (ride && stepping) for (const c of caps) if (!/^object:[^:]+:leave$/.test(c.id) && !['accept', 'decline', 'ask-to-stop'].includes(c.verb)) {c.available = false; c.blocked = stepping;}
    if (ride && !stepping) for (const c of caps) if (c.verb === 'make' || (ride.phase === 'aloft' && !['rest:here', 'stand:here'].includes(c.id) && !['accept', 'decline', 'ask-to-stop'].includes(c.verb))) {c.available = false; c.blocked = {code: 'ride.aboard', reason: ride.phase === 'aloft' ? `You are travelling in ${ride.label}; it returns by itself and you step out then.` : `You are in ${ride.label}; leave it first.`};}
  }
  private exactWalkBindings(soul:EdgeSoul,input:{capability?:unknown;params?:unknown}):ExactWalkBindings|null {
    const asked=input.capability;
    if(typeof asked!=='string'||asked.length>200||!/^walk:[^\s:#]+$/.test(asked)||this.faded.has(soul.soulId)||this.providers.some(p=>!this.exactWalkObjectProviders.has(p))||!this.worldProfile)return null;
    if(input.params!==undefined&&input.params!==null&&(typeof input.params!=='object'||Array.isArray(input.params)||Object.keys(input.params).length))return null;
    const project=this.exactWalkProfiles.get(this.worldProfile),ref=asked.slice(5);
    if(!project)return null;
    try {
      if(!this.exactAuthoredWalkRef?.(ref))return null;
      // Reuse an already-authoritative full same-tick listing, never cache sparse data.
      // (L3 menu cache: only the whole menu already built this tick, unchanged since, is that listing)
      const tick=this.mw.world.tick,hit=this.capCache.get(soul.soulId),same=hit?.last?.tick===tick&&hit.last.sig===this.sameTickSig()?hit.last.value:null;
      if(same){
        if(same.caps.some(c=>c.id===asked))return {...same,tick};
        if(!this.exactAuthoredAreaWalkRef?.(ref))return null;
        // Keep the authoritative full cache intact; the on-demand area binding
        // below is local to this request, never a replacement listing.
      }
      const read=readHumanCapabilitiesV1(this.host,this.mind(soul),{registeredActivitiesV1:true,deferRouteChecks:true,skipRegisteredCards:true,onlyWalkTarget:ref}),caps:EdgeCapability[]=[],plans:Plans=new Map();
      for(const b of read.bindings.values())if(b.id===asked&&b.goal==='walk')this.addNativeBinding(b,caps,plans);
      if(!project(soul,asked,caps,plans))return null;
      // Evaluate known providers rather than trust a stale namespace promise.
      // Drift to any non-object offer disables projection before admission.
      // (asked for the objects this walk's focus names, as bindOne's tail: none, so no object table read or offer build)
      const focus=focusFor(asked),only=focusObjects(focus);
      for(const provider of this.providers)if(provider(soul,only).some(c=>c.verb!=='object'||!c.id.startsWith('object:')))return null;
      // the whole menu's end: its core's ride refusals, then the tail (bindsTail) as a focused build of this one offer
      this.rideBlocks(soul,caps);
      const out=this.bindsTail(soul,{caps,plans},focus),cap=out.caps.find(c=>c.id===asked);
      // Refusals need the original complete diagnostics/alternatives too.
      return cap?.available&&out.plans.has(asked)?{caps:out.caps,plans:out.plans,tick}:null;
    }catch{return null;}
  }
  /** exactWalkBindings for an offer the full listing itself contains (native, profile or bounded GodNav listing), never
   * the canonical-area on-demand projection: an area the listing omits answers resolve through place matching over the
   * whole listing, so only listed exact walks can skip it with an identical answer. Synchronous, restored in finally. */
  private exactListedWalkBindings(soul:EdgeSoul,input:{capability?:unknown;params?:unknown}):ExactWalkBindings|null {
    const area=this.exactAuthoredAreaWalkRef;this.exactAuthoredAreaWalkRef=()=>false;
    try{return this.exactWalkBindings(soul,input);}finally{this.exactAuthoredAreaWalkRef=area;}
  }
  invalidateBodies(){this.dropMenus('invalidateBodies');}
  /** Every Soul's menu rebuilds on its next read (`site` names the cause, for menu-stats). */
  private dropMenus(site: string) {countClear(site); this.menuGen++; this.capCache.clear(); this.focusCache.clear(); this.wordsCache.clear();}
  /** One Soul's menu rebuilds on its next read. */
  private dropMenu(site: string, soulId: string) {countClear(site, true); this.capCache.delete(soulId); this.focusCache.delete(soulId);}
  /** Before HTTP opens, and again once boot-time world changes (punt installs) have landed: list live Souls' capabilities
   *  (the first with a body, then more in creation order while within `budgetMs`), so the derived caches a rich `here`
   *  otherwise builds lazily (room reaches, fine nav tiles, spatial and place indexes, activity spots) are ready instead
   *  of costing the next request's event-loop turn (~1.5 s on Eden 2026 after a restart). A read: the same listing a
   *  Soul's `here` makes; per-tick and short-lived caches recompute as before. */
  prepareForServing(budgetMs = 0): {souls: number; failed: number; ms: number} {
    const t0 = performance.now(); let souls = 0, failed = 0;
    for (const row of this.db.liveSouls(this.host.worldId)) {
      if (souls + failed && performance.now() - t0 >= budgetMs) break;
      const m = this.host.minds.get(row.id); if (!m || !this.body(m.entityId)?.human) continue;
      try { this.capabilities({soulId: row.id, entityId: m.entityId, name: m.name, owner: row.owner}); souls++; } catch { failed++; }
    }
    return {souls, failed, ms: Math.round(performance.now() - t0)};
  }
  /** Continuity (warm after listen, 2026-10-31): prepareForServing's warm, run once the port is open, so a release
   *  handover's pause is only stop + open again (release 404 kept Eden 2026's port shut ~4 s longer for it: 8.5 s
   *  "Reconnecting…"). The caches under the first Soul's listing are built first in slices of about `sliceMs`, with a
   *  turn of the event loop between (visitors' sockets, healthz and every cheap route answer meanwhile): `pre` (the god
   *  bridge's servingWarmGen: places, named things, activity spots, walk goals) and the item sources. The listing
   *  itself then runs once over warm caches (prepareForServing). Until it ends, rich reads wait for it (whenServing)
   *  instead of building the same caches cold inside one request. A read, like prepareForServing; it never rejects.
   *  A warm asked for while one runs (a punt rewarm during the boot's) starts when that one ends: two never interleave
   *  their slices over the same caches, and reads wait for the last. */
  warmForServing(o: {sliceMs?: number; pre?: (soul: EdgeSoul) => Generator<void, void, void>; stop?: () => boolean; turn?: () => Promise<void>} = {}): Promise<ServingWarm> {
    const prev = this.servingGate; let gate: Promise<void> | null = null;
    const run = (async () => { if (prev) await prev; try { return await this.runServingWarm(o); } finally { if (this.servingGate === gate) this.servingGate = null; } })();
    this.servingGate = gate = run.then(() => {});
    return run;
  }
  /** While a serving warm runs: a promise that settles when it ends, or after `ceilingMs` (then the read builds what it
   *  needs itself, as without a warm). Null otherwise (nothing to wait for: no extra turn). */
  whenServing(ceilingMs = SERVING_WAIT_MS): Promise<void> | null {
    const gate = this.servingGate; if (!gate) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([gate, new Promise<void>(r => { timer = setTimeout(r, ceilingMs); })]).finally(() => clearTimeout(timer));
  }
  private servingGate: Promise<void> | null = null;
  private async runServingWarm({sliceMs = SERVING_SLICE_MS, pre, stop, turn = nextTurn}: {sliceMs?: number; pre?: (soul: EdgeSoul) => Generator<void, void, void>; stop?: () => boolean; turn?: () => Promise<void>}): Promise<ServingWarm> {
    const t0 = performance.now(), out: ServingWarm = {souls: 0, failed: 0, ms: 0, wallMs: 0, slices: 0, maxStepMs: 0, listingMs: 0, stopped: false};
    const eng = this.mw as unknown as {readPassV1?: <T>(f: () => T) => T};
    const drive = async <T>(it: Generator<void, T, void>): Promise<T | undefined> => {
      let value: T | undefined;
      for (let done = false; !done;) {
        if (stop?.()) {out.stopped = true; return undefined;}
        const s0 = performance.now(), step = () => {do {const r = it.next(); if (r.done) {done = true; value = r.value;}} while (!done && performance.now() - s0 < sliceMs);};
        try {if (eng.readPassV1) eng.readPassV1(step); else step();}
        catch (error) {done = true; console.error('[edge] serving warm step failed; the listing builds the rest', error instanceof Error ? error.message : error);}
        const ms = performance.now() - s0; out.slices++; out.ms += ms; if (ms > out.maxStepMs) out.maxStepMs = ms;
        await turn();
      }
      return value;
    };
    try {
      await turn();   // the turn that opened the port first answers whatever was waiting for it
      const soul = this.servingSoul();
      if (soul && pre) await drive(pre(soul));
      if (soul) await drive(this.together.sourcesWarmGen());
      if (stop?.()) out.stopped = true;
      if (!out.stopped) {
        const w = this.prepareForServing(); out.souls = w.souls; out.failed = w.failed; out.listingMs = w.ms; out.ms += w.ms;
      }
    } catch (error) {console.error('[edge] serving warm failed; Souls build their menus on demand', error);}
    out.ms = Math.round(out.ms); out.maxStepMs = Math.round(out.maxStepMs); out.wallMs = Math.round(performance.now() - t0);
    return out;
  }
  /** The Soul prepareForServing lists first: the first live Soul (creation order) with a body. */
  private servingSoul(): EdgeSoul | null {
    for (const row of this.db.liveSouls(this.host.worldId)) {
      const m = this.host.minds.get(row.id); if (m && this.body(m.entityId)?.human) return {soulId: row.id, entityId: m.entityId, name: m.name, owner: row.owner};
    }
    return null;
  }
  bodyAssignmentReady(soul:EdgeSoul){return !this.faded.has(soul.soulId)&&!this.pending.has(soul.soulId)&&!this.openReceipts(soul.soulId).length&&!this.together.awaiting(soul.soulId)&&!this.together.heldBy(soul.soulId);}
  bodyVerbProblem(soul:EdgeSoul,verb:string){return bodyVerbProblem(this.body(soul.entityId),verb);}
  /** Walks and ride boardings advertise `with` (quality cases 21/27: the invitation was there but undiscoverable). */
  /** L3 item 5: the page of this Soul's menu a listing shows (`all`: the whole menu), and what it leaves out. Act and
   *  resolve read the whole menu, so an offer left out stays reachable by id and by words. */
  capabilitiesPage(soul: EdgeSoul, opts: {all?: boolean} = {}): {capabilities: EdgeCapability[]; paramsByVerb: Record<string, ParamSchema>; omitted?: Omitted} {
    const caps = this.capabilities(soul), schemas = (list: EdgeCapability[]) => paramsByVerb(list.map(c => c.verb)); if (opts.all) return {capabilities: caps, paramsByVerb: schemas(caps)};
    const b = this.body(soul.entityId), {listed, omitted} = pageCapabilities(caps, this.listingWhere(soul), b ? [b.pose.p[0], b.pose.p[2]] : null, this.loadLevel);
    return {capabilities: listed, paramsByVerb: schemas(listed), ...(omitted ? {omitted} : {})};
  }
  /** LOAD-CONTRACT §1 dial "menu listing radius" (listing.ts LISTING.radius: green the nearest of all, amber 64 m, red 32 m). */
  private loadLevel: LoadLevel = 'green';
  setLoadLevel(level: LoadLevel) {this.loadLevel = level;}
  /** Where a listed offer's target is, for the page (a Soul, a thing, a place, an activity spot, an object's place). */
  private listingWhere(soul: EdgeSoul): (c: EdgeCapability) => Where {
    // L3 (c): an object offer ranks by where its object is (a built thing: its own point; else in a place this Soul is in:
    // here; else the place's centre), read from what the providers built, never from a listing of every object (visibleTo
    // advanced and viewed all 8,300 objects of the live Eden 2026 per page, ~55 ms)
    let path: Set<string> | null = null;
    const inPath = (id: string) => (path ??= new Set(this.placePathOf(soul.soulId).map(p => p.id))).has(id);
    const placeAt = (id: string | undefined): Where => {const p = id ? this.places.byId.get(id) : undefined; return p?.polygon?.length ? centroid(p.polygon) : null;};
    return c => {
      if (c.verb === 'object' && c.object) {const e = this.mw.world.entities[c.object]; if (e) return [e.pose.p[0], e.pose.p[2]]; const pl = this.objectPlaces.get(c.object); if (pl && inPath(pl)) return 'here'; return placeAt(pl) ?? FAR;}
      const t = c.target;
      if (t?.kind === 'soul') {const m = this.host.minds.get(t.id), e = m ? this.body(m.entityId) : undefined; return e ? [e.pose.p[0], e.pose.p[2]] : null;}
      if (t) {const e = this.mw.world.entities[t.id]; if (e) return [e.pose.p[0], e.pose.p[2]]; const at = placeAt(t.id); if (at) return at;}
      return this.capabilityPoint(c.id);
    };
  }
  /** observe's `here.objects`, paged like the listing (all of them with include=objects). */
  private objectsPage(soul: EdgeSoul, all: boolean): {objects: unknown[]; objectsOmitted?: unknown} {
    const objs = (this.comms?.objects.visibleTo(soul) ?? []) as {id: string; kind: string; here?: boolean; placeId?: string; public?: unknown}[];
    if (all) return {objects: objs};
    const b = this.body(soul.entityId), {listed, omitted} = pageObjects(objs, o => {const p = o.placeId ? this.places.byId.get(o.placeId) : undefined; return p?.polygon?.length ? centroid(p.polygon) : FAR;}, b ? [b.pose.p[0], b.pose.p[2]] : null);
    return {objects: listed, ...(omitted ? {objectsOmitted: omitted} : {})};
  }
  capabilities(soul: EdgeSoul): EdgeCapability[] {return this.listed(this.binds(soul).caps);}
  /** Offers as the listing shows them (walks and ride joins take `with`). */
  listed(caps: EdgeCapability[]): EdgeCapability[] {return caps.map(c => (c.verb === 'walk' && c.target?.kind === 'place') || (c.verb === 'object' && c.action === 'join') ? {...c, params: {...(c.params ?? {}), with: WITH_PARAM}} : c);}
  private activityErrors = 0;
  private strollSpots = new Map<string, {key: string; spots: [number, number][]}>();
  /** Up to 5 clear stops spread over a place (cached until the static scene changes), visited from the nearest as a loop. */
  private strollRoute(placeId: string, polygon: [number, number][], from: [number, number]): [number, number][] {
    const key = JSON.stringify((this.mw.world as {navV1?: unknown}).navV1 ?? null).length + ':' + Object.keys(this.mw.world.regions).length;
    let hit = this.strollSpots.get(placeId);
    if (!hit || hit.key !== key) {const spots = (this.mw as unknown as {clearSpotsV1?: (p: [number, number][], n: number) => [number, number][]}).clearSpotsV1?.(polygon, 5) ?? []; hit = {key, spots}; this.strollSpots.set(placeId, hit);}
    const left = [...hit.spots], out: [number, number][] = []; let at = from;
    while (left.length) {left.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]) || a[0] - b[0] || a[1] - b[1]); at = left.shift()!; out.push(at);}
    return out;
  }
  /** A pond loop must stay outside its entire outline and on admitted clear ground.
   * If a world has only one accessible bank, it gets no misleading "around" offer. */
  private bankLoop(poly: [number, number][], from: [number, number]): [number, number][] {
    const engine = this.mw as unknown as {clearanceAtV1?: (x: number, z: number) => number; clearanceUpToV1?: (x: number, z: number, cap?: number) => number; readPassV1?: <T>(f: () => T) => T};
    if (!engine.clearanceAtV1 || poly.length < 3) return [];
    // These probes only read the world. Sync the planner once for this loop, never across capability requests.
    const read = (): [number, number][] => {
      const clear = (x: number, z: number) => engine.clearanceUpToV1 ? engine.clearanceUpToV1(x, z, 1) : engine.clearanceAtV1!(x, z);
      const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
      for (const margin of [2, 3.5, 5]) {
        const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin, z0 = Math.min(...zs) - margin, z1 = Math.max(...zs) + margin;
        const route: [number, number][] = [[x0,z0],[(x0+x1)/2,z0],[x1,z0],[x1,(z0+z1)/2],[x1,z1],[(x0+x1)/2,z1],[x0,z1],[x0,(z0+z1)/2]];
        if (route.some(p => clear(p[0], p[1]) < 0.7)) continue;
        let near = 0; for (let i = 1; i < route.length; i++) if (Math.hypot(route[i][0]-from[0],route[i][1]-from[1]) < Math.hypot(route[near][0]-from[0],route[near][1]-from[1])) near=i;
        return [...route.slice(near), ...route.slice(0,near)];
      }
      return [];
    };
    return engine.readPassV1 ? engine.readPassV1(read) : read();
  }
  addCapabilityProvider(p: CapabilityProvider,projection?:{exactWalk:'objects-only'}) {this.providers.push(p);if(projection?.exactWalk==='objects-only')this.exactWalkObjectProviders.add(p);}

  /** OWNER-DAY: the world's reason and where the body stood are kept so its owner can read the refusal on the "Today" timeline. */
  recordRefusal(soulId: string, verb: string, capability: string, code: string, reason = '') {
    try {const e = this.host.minds.get(soulId)?.entityId, p = e ? this.body(e)?.pose?.p : undefined, pos = p ? [p[0], p[2]] : null;
      this.db.db.prepare('INSERT INTO edge_refusals_v1 (world_id,at,tick,soul_id,verb,capability,code,reason,x,z) VALUES (?,?,?,?,?,?,?,?,?,?)').run(this.host.worldId, Date.now(), this.host.engine.world.tick, soulId, verb.slice(0, 40), capability.slice(0, 200), code.slice(0, 100), String(reason ?? '').slice(0, 300), pos?.[0] ?? null, pos?.[1] ?? null);} catch {/* measurement never breaks acting */}
  }
  /** Counts only (no agent text): acts, receipts by phase, refusals by code, active Souls, speech/conversations when Comms is present. */
  metrics(windowMs = 3600_000) {
    const w = this.host.worldId, since = Date.now() - windowMs, q = (sql: string, ...a: (string | number)[]) => this.db.db.prepare(sql).all(w, ...a) as Record<string, number | string>[];
    const has = (t: string) => !!this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const count = (sql: string, ...a: (string | number)[]) => Number((this.db.db.prepare(sql).get(w, ...a) as {n: number}).n);
    const accepted = count('SELECT COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since), refused = count('SELECT COUNT(*) n FROM edge_refusals_v1 WHERE world_id=? AND at>=?', since);
    const active = count('SELECT COUNT(DISTINCT soul_id) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since);
    return {window: {ms: windowMs, since}, actsPerActiveSoulPerHour: active ? Math.round(accepted / active / (windowMs / 3600_000) * 10) / 10 : null,
      acts: {accepted, refused, refusalRate: accepted + refused ? Math.round(refused / (accepted + refused) * 1000) / 1000 : null},
      receiptsByPhase: Object.fromEntries(q('SELECT phase k, COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=? GROUP BY phase', since).map(r => [r.k, r.n])),
      // Finished receipts: completed vs failed (by code) vs replaced by the Soul's own newer act (lasting marks count as completed).
      receiptFailuresByCode: Object.fromEntries(q("SELECT code k, COUNT(*) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=? AND phase='failed' GROUP BY code ORDER BY n DESC", since).map(r => [r.k, r.n])),
      completedShareOfFinished: (() => {const r = q("SELECT SUM(phase='completed') c, SUM(phase IN ('completed','failed','replaced')) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?", since)[0]; return Number(r?.n) ? Math.round(Number(r.c) / Number(r.n) * 1000) / 1000 : null;})(),
      refusalsByCode: Object.fromEntries(q('SELECT verb||\' \'||code k, COUNT(*) n FROM edge_refusals_v1 WHERE world_id=? AND at>=? GROUP BY verb, code ORDER BY n DESC', since).map(r => [r.k, r.n])),
      activeSouls: count('SELECT COUNT(DISTINCT soul_id) n FROM edge_receipts_v1 WHERE world_id=? AND created_at>=?', since),
      speech: has('edge_comms_speech') ? count('SELECT COUNT(*) n FROM edge_comms_speech WHERE world_id=? AND at>=?', since) : null,
      conversationTurns: has('edge_comms_turns') ? count('SELECT COUNT(*) n FROM edge_comms_turns WHERE world_id=? AND at>=?', since) : null,
      worldModelCalls: count('SELECT COUNT(*) n FROM brain_calls WHERE world_id=? AND at>=?', Math.max(since, this.startedAt)),
      worldModelCallsCountedSince: Math.max(since, this.startedAt),
      tick: this.host.engine.world.tick};
  }

  // ---------------------------------------------------------------- act
  /** Server-only verification already resolved an exact free seat. Reuse normal
   * launch/admission/receipts without discovering every unrelated capability.
   * Native sit still plans, reserves, walks, turns and occupies this actual slot. */
  actVerificationSit(soul: EdgeSoul, fixture: string, slot: string) {
    const capability = `sit:${fixture}`;
    const refuse = (code: string, reason: string) => ({accepted: false as const, capability, code, reason});
    const row = this.db.soul(soul.soulId), mind = this.host.minds.get(soul.soulId);
    if (!isVerificationProbe(soul.soulId) || soul.owner !== PROBE_OWNER || row?.owner !== PROBE_OWNER || row.retired_at !== null || row.entity_id !== soul.entityId || mind?.entityId !== soul.entityId)
      return Promise.resolve(refuse('soul.not-probe', 'Exact-seat verification is reserved for the server verifier probe.'));
    if (!slot.startsWith(fixture + '#')) return Promise.resolve(refuse('slot.unknown', 'The exact slot must belong to the requested fixture.'));
    return this.launch(soul, capability, 'verifier probe: sit in exact seat slot', [
      {verb: 'mars:sit', params: {slot}}, {verb: 'rest', params: {seconds: 600}},
    ], undefined, {}, refuse);
  }

  async act(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown; verb?: unknown; target?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
    // PC05 (#684, PC02 §3): `shared.busy` (from insert) is the act's refusal: no receipt, nothing replaced, the owner's
    // message stays unacked; the agent decides what to do
    try {return await this.actWork(soul, input);}
    catch (e) {
      if (!(e instanceof EdgeError) || e.code !== 'shared.busy') throw e;
      const capability = typeof input.capability === 'string' ? input.capability : String(input.verb ?? '');
      this.recordRefusal(soul.soulId, 'act', capability, e.code, e.message);
      return {accepted: false, code: e.code, reason: e.message, capability, ...(e.extra ?? {})};
    }
  }
  /** CTRL-1 (#1093): a strict client's act: null when it is an offered id with fitting params, else the refusal. */
  offerGate(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; verb?: unknown; target?: unknown; clientRef?: unknown}): OfferRefusal | null {
    const no = offerCheck(this, soul, input); if (!no) return null;
    this.recordRefusal(soul.soulId, 'act', no.capability, no.code, no.reason);
    return no.code === 'capability.unknown' ? this.withAlternatives(soul, no.capability, no, this.wordsMenu(soul).caps) : no;
  }
  private async actWork(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown; verb?: unknown; target?: unknown}): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
    // PC08 (#687, PC02 §3): a member's safe stop of a running shared operation never touches the member's own receipt
    if (this.sharedCarry && typeof input.capability === 'string' && input.capability.startsWith('stop-carry:')) return this.stopShared(soul, input.capability, typeof input.clientRef === 'string' && input.clientRef.length <= 100 ? input.clientRef : undefined);
    // intents/1 (Core-A): {verb, target} is resolved now and acted on as the concrete choice it reports
    if (input.capability === undefined && input.verb !== undefined) {const out = await this.intents.act(soul, input as IntentInput); if (out.accepted) this.menusChangedBy('act-intent', soul.soulId, out.receipt.capability); return out;}
    let exactWalk:ExactWalkBindings|null=null;
    if(typeof input.capability==='string'){
      if(input.capability.length>=1&&input.capability.length<=200&&typeof input.clientRef==='string'&&input.clientRef.length<=100){const old=this.coreA.byClientRef(soul.soulId,input.clientRef);if(old)return {accepted:true,receipt:old};}
      // BODY refusals precede place/alias diagnostics, as in the original actOnce path.
      const bodyIssue=this.bodyVerbProblem(soul,input.capability.split(/[:\s]/)[0]!);
      exactWalk=bodyIssue?null:this.exactWalkBindings(soul,input);
      const place=bodyIssue?null:explicitPlaceCapability(this,soul,input.capability.trim(),exactWalk?.caps);
      // SOULSIM-E (real-agent run on 3.60, 2026-10-21): resolve offers a far place's walk on demand and the agent acts on
      // that id, as the skill says; the id was refused place.unwalkable here. actOnce below walks it on demand, as words.
      const onDemand=!!place&&!place.ok&&place.code==='place.unwalkable'&&this.onDemandId(soul,input.capability.trim());
      if(place&&!onDemand){
        if(!place.ok){this.recordRefusal(soul.soulId,'act',input.capability,place.code,place.reason);const {ok:_ok,...refusal}=place,out=this.withInPlaceAlternative(soul,{accepted:false as const,capability:input.capability,...refusal});
          // #824: an unknown place id names what the Soul can do instead (one kept words-menu read, on this refusal only)
          return NOTHING_MATCHES.has(out.code)?this.withAlternatives(soul,input.capability,out,exactWalk?.caps??this.wordsMenu(soul).caps):out;}
        const out=await this.act(soul,{...input,capability:place.chosen.capability});
        if(!out.accepted)return out;
        const receipt=this.coreA.setDetail(out.receipt.id,{chosen:{...place.chosen,...(out.receipt.chosen as Record<string,unknown>??{})}})??out.receipt;return {...out,receipt};
      }
    }
    if(typeof input.capability==='string'){const walk=walkWithDestinationWords(input.capability,[...this.host.minds.values()].map(m=>m.name));if(walk){const out=await this.intents.act(soul,{...walk,...(input.params?{params:input.params}:{}),clientRef:input.clientRef});if(out.accepted){this.menusChangedBy('act-walk-words', soul.soulId, out.receipt.capability);return {...out,resolved:{from:input.capability,to:out.receipt.capability,note:'Walk to the named destination; companions receive an invitation and choose whether to join.'}};}
      // quality case 27: an ambiguous destination ("the library") falls back to the walk its plain words resolve to, still inviting
      const alt=walkWithFallback(this,soul,walk);if(alt){const again=await this.actOnce(soul,{capability:alt.cap.id,params:{...(input.params&&typeof input.params==='object'?input.params as Record<string,unknown>:{}),with:walk.with},clientRef:input.clientRef});if(again.accepted){this.menusChangedBy('act-walk-fallback', soul.soulId, again.receipt.capability);return {...again,resolved:{from:input.capability,to:alt.cap.id,note:`Walk to ${alt.cap.label}; ${(walk.with as string[]).join(', ')} receive an invitation and choose whether to join.`}};}}
      return out;}}
    const out = await this.actOnce(soul, input, exactWalk);
    if (out.accepted) this.menusChangedBy('act-accepted', soul.soulId, out.receipt.capability);     // invitations, items and follows (together.version) and seats near the actor or target change what others can do
    return out;
  }
  /** L3 item 4: the offers an act reads. An id the menu offers: that one offer (bindOne). Anything else (words, an id
   *  offered only on demand, `via` legs naming other places): the whole menu, as before. */
  private actMenu(soul: EdgeSoul, asked: string, params: unknown): {caps: EdgeCapability[]; plans: Plans; partial?: true; words?: {caps: EdgeCapability[]; exact: boolean}; pre?: ReturnType<EdgeLedger['resolveOnDemand']>} {
    const via = !!params && typeof params === 'object' && (params as {via?: unknown}).via !== undefined;
    if (!via && /^[a-z][\w-]*:\S+$/i.test(asked)) {const one = this.bindOne(soul, asked); if (one) return {caps: [one.cap], plans: new Map(one.plan ? [[asked, one.plan]] : []), partial: true};}
    // srv-act-words: words of a common shape resolve on a focused build of the verbs they can read
    if (!via) {const f = this.wordsFocused(soul, asked); if (f) return {caps: f.caps, plans: f.plans, partial: true, pre: f.pre};}
    // L3 (b): words resolve on the words menu; the offer they choose is rebuilt exactly before it is acted on (exactWords)
    if (!via) {const w = this.wordsMenu(soul); return w.exact ? {caps: w.caps, plans: w.plans} : {caps: w.caps, plans: w.plans, words: w};}
    return this.binds(soul);
  }
  private async actOnce(soul: EdgeSoul, input: {capability?: unknown; params?: unknown; clientRef?: unknown}, exactWalk: ExactWalkBindings | null = null): Promise<{accepted: true; receipt: EdgeReceipt; resolved?: Resolved; result?: unknown} | {accepted: false; code: string; reason: string; capability: string; retry_after?: number; did_you_mean?: {id: string; label: string}[]; resolved?: Resolved}> {
    const asked = typeof input.capability === 'string' ? input.capability : '';
    if (!asked || asked.length > 200) throw new EdgeError(400, 'invalid', 'body must be {capability, params?, clientRef?}');
    let capability = asked;
    const clientRef = typeof input.clientRef === 'string' && input.clientRef.length <= 100 ? input.clientRef : undefined;
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const refuse = (code: string, reason: string, extra?: {retry_after?: number}) => {this.recordRefusal(soul.soulId, 'act', capability, code, reason); return this.withInPlaceAlternative(soul, {accepted: false as const, code, reason, capability, ...extra});};
    const askedVerb=asked.split(/[:\s]/)[0]!;const unsupported=askedVerb==='object'?null:this.bodyVerbProblem(soul,askedVerb);if(unsupported)return refuse(unsupported.code,unsupported.reason);
    if (this.faded.has(soul.soulId)) {
      // Reclaim: fall onto feet at a starting place, identity and history intact (C9).
      this.faded.delete(soul.soulId);
      if (!this.inSharedCarry(soul.soulId)) await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to: this.startingPoint(soul.soulId), why: 'reclaimed after fading'});
      this.dropMenu('act-retry', soul.soulId);
    }
    // L3 item 4: an offered id builds that one offer (bindOne), never the whole menu; words and via legs read the menu
    // (an exact walk projected this tick by act: that one offer, as bindOne would give it)
    const bound = exactWalk?.tick === this.host.engine.world.tick ? {caps: exactWalk.caps, plans: exactWalk.plans, partial: true as const, words: undefined} : this.actMenu(soul, asked, input.params), partial = !!bound.partial, words = bound.words;
    let {caps, plans} = bound;
    const menu = () => partial || words ? this.binds(soul) : {caps, plans};
    let params = (input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? {...input.params as Record<string, unknown>} : {}) as Record<string, unknown>;
    if(['read','write','use-computer','listen','paint','craft','post-letter'].includes(askedVerb)){try{outcomeParams(params);}catch{return refuse('capability.params','Content parameters must be bounded strings (book100, query200, title100, text2000).');}if(params.book!==undefined&&!EDEN_LIBRARY_CATALOGUE.some(b=>b.id===params.book))return refuse('content.book-unknown','Choose a book id from the published catalogue.');}
    // intents/1: plain words for the attention channel ("look at the fire", "turn to Bill") and face:<soul> never touch the body
    // #435 (W068): "look in the stump" is a hiding place's search when one is on offer, not a glance
    if (!offeredAttention(caps, asked) && !(/^(?:please\s+)?look\s+(?:in|inside|into)\b/i.test(asked) && caps.some(c => c.verb === 'search'))) {const plain = attentionWords(asked); if (plain) return this.intents.act(soul, {...plain, ...(clientRef ? {clientRef} : {})});}
    // W8: "attend the lecture", "go to class": an audience seat in the classroom (the existing seat-in-room intent)
    if (!caps.some(c => c.id === asked)) {const cls = classWords(asked, this.places.byId.values()); if (cls) return this.intents.act(soul, {...cls, ...(clientRef ? {clientRef} : {})});}
    if (asked.startsWith('face:') && caps.some(c => c.id === asked && c.target?.kind === 'soul')) return this.intents.act(soul, {verb: 'turn', face: caps.find(c => c.id === asked)!.target!.id, ...(clientRef ? {clientRef} : {})});
    // strict/1: an id-shaped target that names nothing in this world is refused, never swapped for something else
    // (SOULSIM-E: unless it is a far place's walk the listing leaves out, which resolveOnDemand below offers: the agent
    // resolved "go to the horse" to walk:land-park-lawns-west and acting on that id was refused, on Eden 2026 / 3.60)
    {const strict = strictCheck(this, soul, asked, caps); if (strict && !this.onDemandId(soul, asked, caps, plans)) return this.withAlternatives(soul, asked, {...refuse(strict.code, strict.reason), did_you_mean: strict.did_you_mean}, caps);}
    // together/1: social phrasing first (accept/decline, "hug Tamsin", "give her the book", "dance with Roger", "invite X to …")
    let social: {note: string} | null = null, text = asked;
    if (!caps.some(c => c.id === asked)) {
      const more = [...caps], morePlans = new Map(plans), r = this.together.resolve(soul, asked, more, morePlans as Map<string, TogetherPlan>);
      if (more.length !== caps.length) {caps = more; plans = morePlans;}   // SOCIAL-APPROACH: a walk-over act toward a Soul out of sight
      if (r && 'code' in r) {const out = {...refuse(r.code, r.reason), did_you_mean: r.did_you_mean}; return NOTHING_MATCHES.has(r.code) ? this.withAlternatives(soul, asked, out, caps) : out;}
      if (r) {social = {note: r.note}; params = {...params, ...(r.params ?? {})}; text = r.capability || r.rest || asked;}
    }
    // PM-R057: exact ids first; an unambiguous natural name is accepted and reported back as `resolved`;
    // anything else is refused with the closest offered capabilities.
    let v: VocabResult;
    // (srv-act-words: focused words were resolved already, on these offers, by wordsFocused)
    ({v, caps, plans} = bound.pre && !social && text === asked ? bound.pre : this.resolveOnDemand(soul, text, caps, plans));
    if (words) {plans = new Map(plans); v = this.exactWords(soul, words, text, v, plans);}
    // PC04 (#683): answering a shared proposal that has closed is refused as gone, not unknown
    if (v.kind === 'unknown' && /^(?:accept|decline):inv_/.test(asked)) {
      const inv = this.together.invite(asked.slice(asked.indexOf(':') + 1));
      if (inv?.kind === 'shared' && (inv.host.soulId === soul.soulId || inv.guests.some(g => g.soulId === soul.soulId))) {
        // PC09 (#688): a stale answer from a member of the running operation is that operation's busy refusal; after it
        // ended, the refusal says how it ended (nothing is started either way)
        const busy = this.sharedBusy(soul.soulId); if (busy) return {...refuse('shared.busy', busy.reason), ...this.busyExtra(busy)};
        const op = inv.shared?.op;
        return refuse('invite.gone', op?.phase === 'ended' ? `That proposal is no longer open: its shared carry (${op.id}) has ended (${op.result ?? 'ended'}); nothing was started.` : 'That proposal is no longer open.');
      }
    }
    if (v.kind === 'unknown') return this.withAlternatives(soul, text, {...refuse(v.code ?? 'capability.unknown', v.reason), did_you_mean: v.didYouMean}, caps);
    let cap = v.cap; capability = cap.id;
    const bodyIssue=bodyCapabilityProblem(this.body(soul.entityId),cap,plans.get(capability)?.steps);if(bodyIssue)return refuse(bodyIssue.code,bodyIssue.reason);
    if (v.kind === 'alias' && v.params) params = {...v.params, ...params};   // CN5: "A, then B" walks become via legs
    if(cap.verb==='post-letter'&&params.to!==undefined){if(typeof params.text!=='string'||!params.text.trim())return refuse('content.text-required','An addressed letter needs nonempty text.');if(typeof params.to==='string'){const stale=this.host.soulNameRefusal(params.to);if(stale)return refuse(stale,'That previous Soul name is unavailable or ambiguous; use the current name and immutable Soul ID.');}const recipient=resolveMailRecipient(this.db.db,this.host.worldId,params.to);if('code'in recipient)return refuse(recipient.code,recipient.reason);params.to=recipient.soulId;params.recipientName=recipient.name;}
    const note = [social?.note, v.kind === 'alias' ? v.note : null].filter(Boolean).join('; ');
    // together/1: doing a paired gesture back to someone who offered it is accepting their invitation
    if (cap.target?.kind === 'soul' && cap.verb in PAIRED) {const back = this.together.reciprocal(soul.soulId, cap.target.id, cap.verb), acc = back ? caps.find(c => c.id === 'accept:' + back.id) ?? this.bindOne(soul, 'accept:' + back.id)?.cap : undefined; if (acc) {cap = acc; capability = acc.id;}}
    const resolved: {resolved?: Resolved} = capability !== asked ? {resolved: {from: asked, to: cap.id, note: note || `${asked} is ${cap.id}.`}} : {};
    // A capability already blocked by the world (construction, private access) keeps that refusal; unsupported native
    // use is checked again at launch/decide/completion.
    const nativeUse = cap.available === false && cap.blocked ? null : this.nativeUseRefusal?.(capability);
    if (nativeUse) return {...refuse(nativeUse.code, nativeUse.reason), ...resolved};
    // (accepting reads this Soul's own offers of the invited activity: the whole menu)
    if (cap.verb === 'accept') {const m = menu(); return this.acceptInvite(soul, cap, m.plans, m.caps, clientRef, resolved, refuse, params);}
    if (cap.verb === 'object' && cap.object && cap.action && this.comms?.objects.prepareAct) {
      // Object actions listed in capabilities may be acted on here too (same effect as POST /objects/:id/act);
      // an accepted one gets a completed receipt (like make:mark) and never interrupts the body.
      const {with: invited, ...objParams} = params;
      if (invited !== undefined && cap.action !== 'join') return {...refuse('capability.params', 'with (inviting others) works with a ride\'s join, activities and walks.'), ...resolved};
      const prepared=this.comms.objects.prepareAct(cap.object,soul,{action:cap.action,params:objParams});
      const before=prepared.before;
      const out = prepared.result as {accepted: boolean; code?: string; reason?: string; result?: unknown;object?:{id:string;version:number}};
      if (!out.accepted) {
        // Keep legacy independent clock advances for non-body objects.
        if(!prepared.movesBody)this.comms.objects.act?.(cap.object,soul,{action:cap.action,params:objParams});
        // Out of reach: point at the walk that gets there.
        const placeId = out.code === 'object.out-of-reach' ? this.comms.objects.all().find(o => o.id === cap.object)?.placeId : undefined, go = placeId ? caps.find(c => c.id === 'walk:' + placeId) ?? this.bindOne(soul, 'walk:' + placeId)?.cap : undefined;
        return {...refuse(out.code ?? 'object.refused', out.reason ?? 'The object refused that action.'), ...(go ? {did_you_mean: [{id: go.id, label: go.label}]} : {}), ...resolved};
      }
      const contact=this.contactActuator?.prepare(soul,cap.object,cap.action,objParams)??null;
      const effects=out.object?confirmedObjectEffects(before,prepared.after,cap.action,out.object.version):{};
      // An object action that moves the body (a ride's join/leave/start) is an ordinary logged decision with a normal receipt.
      const bodies = (out as {bodies?: {label: string; steps: Program['steps']}[]}).bodies;
      if (bodies?.length) {
        let steps = bodies[0].steps, commit: ((r: string) => void) | undefined;
        if (invited !== undefined) {
          // together/1: a ride with companions keeps their places and waits for them
          const prep = this.together.prepare(soul, cap, {label: bodies[0].label, steps}, {with: invited}, steps);
          if ('code' in prep) return {...refuse(prep.code, prep.reason), ...resolved};
          steps = prep.steps; commit = prep.commit;
        }
        const bodyGuard=():true=>{prepared.guard();if(invited!==undefined){const current=this.together.prepare(soul,cap,{label:bodies[0].label,steps:bodies[0].steps},{with:invited},bodies[0].steps);if('code'in current)throw new EdgeError(409,current.code,current.reason);}return true;};
        const b = await this.performBodies(soul, capability, bodies[0].label, steps, clientRef,undefined,{guard:bodyGuard,commit:id=>{if(!contact)prepared.commit();commit?.(id);return contact?{contactActuatorV1:contact}:{confirmedEffects:effects};}});
        if (!b.accepted) return {...refuse(b.code, b.reason), ...resolved};
        this.comms.fading.touch?.(soul.soulId);
        return {accepted: true, receipt: {...this.receipt(soul.soulId, b.receipt.id)!, object: cap.object} as EdgeReceipt, ...(out.result ? {result: out.result} : {}), ...resolved};
      }
      const r = tx(this.db.db,()=>{prepared.commit();return this.insert(soul, capability, 'completed', clientRef, true,{confirmedEffects:effects});});this.comms.fading.touch?.(soul.soulId);
      return {accepted: true, receipt: {...this.receipt(soul.soulId, r.id)!, object: cap.object} as EdgeReceipt, ...(out.result ? {result: out.result} : {}), ...resolved};
    }
    const plan = plans.get(capability) as TogetherPlan & {stop?: boolean; paintingTarget?: string} | undefined;
    if (!plan) return cap && cap.available === false && cap.blocked ? refuse(cap.blocked.code, cap.blocked.reason)
      : refuse('capability.unknown', 'That capability is not offered to this Soul right now; read capabilities again.');
    if (params.painting !== undefined && (cap.verb !== 'paint' || !plan.paintingTarget || !this.painting)) return refuse('painting.no-easel', 'The optional painting field is offered only at a real painting easel.');
    let steps = structuredClone(plan.steps);
    if(cap.verb==='carry'&&steps.some(s=>s.verb==='mars:move_fixture'||s.verb==='mars:carry')||cap.verb==='carry-with'){
      if(typeof params.to!=='string'||!params.to.trim()||params.to.length>100)return refuse('capability.params','Choose a named place for the upright carry (to).');
      const dest=resolvePlaceForVerb(this,soul,params.to);
      if(!dest.ok)return {...refuse(dest.code,dest.reason),did_you_mean:dest.did_you_mean};
      const place=this.places.byId.get(dest.chosen.place);
      if(!place||place.level!==0)return refuse('carry.ground-only','Choose a place on level-zero ground.');
      if(this.secretOffer(soul,{id:'walk:'+place.id,verb:'walk',label:place.name,available:true,target:{id:place.id,kind:'place'}}))return refuse('place.unknown','That destination is not known.');
      // PC04 (#683): a shared proposal records the resolved place (never a client-sent one)
      if(cap.verb==='carry-with')params={...params,toPlace:{id:place.id,name:place.name}};
      const at=centroid(place.polygon);
      for(const step of steps)if(step.verb==='mars:move_fixture'||step.verb==='mars:carry')step.params.to={...(step.params.to as object),x:at[0],z:at[1]};
    }
    if (steps.length > 40) return refuse('capability.params', 'that plan is too long; act in shorter legs.');
    // CN5 (acceptance): a capability that takes no seconds (a swim) ignores them instead of refusing
    if (params.seconds !== undefined && !plan.seconds) delete params.seconds;
    if (params.seconds !== undefined) {
      const posed = steps.some(s => s.verb === 'mars:pose_v1'), max = posed ? ACTIVITY_SECONDS_MAX : 600;
      if (!plan.seconds || !Number.isInteger(params.seconds) || (params.seconds as number) < 1 || (params.seconds as number) > max) return refuse('capability.params', `seconds must be an integer 1..${max} for this capability.`);
      // an activity's own pose takes the seconds (not the short shelf visits); otherwise the resting/strolling step does
      if (posed) {for (const s of steps) if (s.verb === 'mars:pose_v1' && s.params.activity !== 'browse') s.params.seconds = params.seconds;}
      else if (cap.verb !== 'follow') {
        const timed = steps.filter(s => s.verb === 'rest' || s.verb === 'ambient_wander' || s.verb === 'gather' || s.verb === 'mars:body_motion_v1');
        // SOUL3: a seat plan with no rest after it (a god-built seat: one sit step) is timed by the sit step itself; its
        // seconds count once seated, so the walk to the seat does not use them up
        for (const s of timed.length ? timed : steps.filter(s => s.verb === 'sit')) s.params.seconds = params.seconds;
      }
    }
    if (params.pause !== undefined && cap.verb === 'stroll') {
      if (!Number.isInteger(params.pause) || (params.pause as number) < 0 || (params.pause as number) > 60) return refuse('capability.params', 'pause must be an integer 0..60 seconds.');
      steps = steps.filter(s => s.verb !== 'rest' || params.pause !== 0); for (const s of steps) if (s.verb === 'rest') s.params.seconds = params.pause;
    }
    // together/1: solo gestures face whoever or whatever they are for (params.to / params.at)
    if ((params.to !== undefined || params.at !== undefined) && steps.some(s => s.verb === 'mars:pose_v1') && cap.id.endsWith(':here')&&cap.verb!=='post-letter') {
      const where = this.pointOf(soul, String(params.to ?? params.at ?? ''));
      if (!where) return {...refuse('capability.params', `Nothing called "${String(params.to ?? params.at)}" is in sight.`), ...resolved};
      for (const s of steps) if (s.verb === 'mars:pose_v1') s.params.face = where;
    }
    // Multi-leg walks: via (≤4 place names or ids) are walked first, in order; a strollable place is strolled through.
    if (params.via !== undefined) {
      if (!['walk', 'stroll', 'hang-out', 'gather', 'warm-by-fire'].includes(cap.verb) || !Array.isArray(params.via) || params.via.length > 4 || !params.via.every(v => typeof v === 'string' && v.length <= 100)) return refuse('capability.params', 'via must be a list of up to 4 place names or ids, on a walk, stroll, hang-out, gather or warm-by-fire capability.');
      const legs: Program['steps'] = [];
      for (const v of params.via as string[]) {
        const exact=caps.find(c=>c.id===v&&(c.verb==='stroll'||c.verb==='walk'));
        const destination=exact?null:resolvePlaceForVerb(this,soul,v.replace(/^(?:stroll|walk):/,''));
        if(destination&&!destination.ok)return {...refuse(destination.code,destination.reason),did_you_mean:destination.did_you_mean,...(destination.resolvedIfName?{resolvedIfName:destination.resolvedIfName}:{}),...resolved};
        const placeId=exact?.target?.id??(destination?.ok?destination.chosen.place:null);
        const asStroll=exact??caps.find(c=>c.verb==='stroll'&&c.target?.kind==='place'&&c.target.id===placeId&&c.available)??caps.find(c=>c.verb==='walk'&&c.target?.kind==='place'&&c.target.id===placeId&&c.available);
        const leg = asStroll ? plans.get(asStroll.id) : undefined;
        if (!asStroll || !leg) return {...refuse('capability.params', `via: "${v}" is not a place you can walk to from here.`), did_you_mean: caps.filter(c => c.verb === 'walk' && c.available).slice(0, 5).map(c => ({id: c.id, label: c.label})), ...resolved};
        legs.push(...structuredClone(leg.steps).filter(s => s.verb === 'walk_to' || (s.verb === 'rest' && asStroll.verb === 'stroll')));
      }
      const standing = steps[0]?.verb === 'stand' ? [steps.shift()!] : [];
      steps = [...standing, ...legs, ...steps];
    }
    const make = (plan as {make?: 'mark' | 'project'}).make;
    if (make && this.aboard(soul.entityId)) return refuse('ride.aboard', 'You are in a ride; make marks on the ground.');
    if (make && this.comms) {
      const title = typeof params.title === 'string' ? params.title.trim() : '', text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!title || title.length > 60 || text.length > 500 || (make === 'mark' && !text)) return refuse('capability.params', 'give a title (<=60) and text (<=500)');
      const mine = this.comms.objects.all().filter(o => (o.kind === 'mark' || o.kind === 'project') && ((o.state as {author?: {soulId: string}; creator?: {soulId: string}; removed?: boolean}).author?.soulId === soul.soulId || (o.state as {creator?: {soulId: string}}).creator?.soulId === soul.soulId) && !(o.state as {removed?: boolean}).removed);
      if (mine.length >= 5) return refuse('make.limit', 'you already have 5 lasting marks or projects; take one down first');
      const placeId = this.placePathOf(soul.soulId).find(p => p.kind !== 'occupier')?.id ?? 'world';
      if (this.comms.objects.all().filter(o => o.kind === 'mark' && o.placeId === placeId && !(o.state as {removed?: boolean}).removed).length >= 20) return refuse('place.marks-full', 'this place already holds 20 marks; try somewhere else');
      const b = this.body(soul.entityId), id = `${make}-${randomUUID().slice(0, 8)}`;
      const r=tx(this.db.db,()=>{this.comms!.objects.create({id, kind: make, name: title, placeId, params: {form: params.form, title, text, author: soul.soulId, at: b ? [b.pose.p[0], b.pose.p[2]] : null}});return this.insert(soul,capability,'completed',clientRef,true,{confirmedProduced:[{id,kind:make,title,where:placeId,visibility:'public'}]});});
      return {accepted: true, receipt: {...this.receipt(soul.soulId, r.id)!, object: id} as EdgeReceipt, ...resolved};
    }
    // PC10 (#689): a member of a running shared carry who asks to stand / stop what they are doing asks to stop the carry
    // safely (the same stop, or "already asked"); the stall guard's owner stand never cuts the crew's programme
    if (plan.stop && this.sharedCarry) {const running = this.together.sharedRunning(soul.soulId); if (running) return {...await this.stopShared(soul, `stop-carry:${running.op}`, clientRef), ...resolved};}
    // RIDE-EXIT: a stop while stepping out of a landed ride would complete without moving the body; say how long instead.
    if (plan.stop) {const stepOut = this.stepOutRefusal(soul.entityId); if (stepOut) return {...refuse(stepOut.code, stepOut.reason), ...resolved};}
    if (plan.stop) {const seated = this.rideStandRefusal(soul.entityId, partial && this.aboard(soul.entityId) ? menu().caps : caps); if (seated) return {...refuse(seated.code, seated.reason), ...resolved};}
    if (plan.stop) {
      await this.stallGuard.ownerStand(soul);   // stall-guard/1 (b): the owner's stand always wins over a stalled holder
      const program = this.host.engine.programOf(soul.entityId), h = this.body(soul.entityId)?.human;
      // A finite sit timer does not own the lasting native seat. Release the real claim,
      // including fixture-param seats, through a strict tracked action rather than edge-stop.
      const grip = h?.grip?.entity ?? h?.carryContactV1?.item, load = grip ? this.host.engine.world.entities[grip] : undefined;
      if (program && load?.tags?.includes('entity-world-transport')) return this.launch(soul, capability, 'Set down current load and stop', [{verb:'walk_to',params:{to:[this.body(soul.entityId)!.pose.p[0],this.body(soul.entityId)!.pose.p[2]]}}], clientRef, resolved, refuse);
      const seats=this.host.engine.nativeSeatHoldsV1?.(soul.entityId)??[];
      if(seats.length&&this.body(soul.entityId)?.body?.family!=='floater')return this.launch(soul,capability,'Stand up',[{verb:'stand',params:{nativeSeatReleaseV1:seats[0].action}}],clientRef,resolved,refuse);
      // Seated with nothing running (a seat stays held after its act ends): stand up for real.
      if (!program && h && (h.activity === 'sit' || h.baseActivity === 'sit')) {
        const r = this.insert(soul, capability, 'waiting', clientRef);
        await this.decide(soul, r.id, capability, 'Stand up', [{verb: 'stand', params: {}}]);
        return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
      }
      const r = this.insert(soul, capability, program ? 'started' : 'completed', clientRef);
      // C9: any accepted action resets the idle clock and reclaims a faded Soul (an immediate stand:here never reached comms' touch)
      if (!program) this.comms?.fading.touch?.(soul.soulId);
      if (program) await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      if (program) this.update(r.id, {phase: 'completed'});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    // PC08: a stop offer reached through words or a bare verb is the same stop (never an ordinary body act)
    if (this.sharedCarry && capability.startsWith('stop-carry:')) return {...await this.stopShared(soul, capability, clientRef), ...resolved};
    // PC05: a member of a running shared operation cannot propose or accept another (the body checks below would
    // otherwise answer with their own codes, e.g. hands.full)
    if (/^(carry-with|accept):/.test(capability)) {const busy = this.sharedBusy(soul.soulId); if (busy) return {...refuse('shared.busy', busy.reason), ...this.busyExtra(busy), ...resolved};}
    // together/1: invitations (params.with), paired gestures, gifts, follows and items check and adjust their plan here
    const prep = this.together.prepare(soul, cap, plan, params, steps);
    if ('code' in prep) return {...refuse(prep.code, prep.reason), ...(prep.did_you_mean ? {did_you_mean: prep.did_you_mean} : {}), ...resolved};
    steps = prep.steps;
    if (prep.existing) {const old = this.receipt(soul.soulId, prep.existing); if (!old) return refuse('invite.gone', 'That proposal is no longer open.'); if (prep.commit) {prep.commit(old.id); this.comms?.fading.touch?.(soul.soulId);} return {accepted: true, receipt: this.receipt(soul.soulId, old.id)!, ...resolved};}
    if (prep.wait) return this.openShared(soul, capability, clientRef, prep, resolved);
    if (prep.noBody) {
      // answering someone (decline, ask to stop following) never interrupts what the body is doing
      const r = this.insert(soul, capability, 'completed', clientRef, true); prep.commit?.(r.id); this.comms?.fading.touch?.(soul.soulId);
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    if (!cap.available && cap.blocked && !WAIT_CODES.has(cap.blocked.code) && !this.host.quietBarrier) return {...refuse(cap.blocked.code, cap.blocked.reason), ...resolved};
    return this.launch(soul, capability, plan.label, this.standIfSeated(soul, steps), clientRef, resolved, refuse, prep.commit,params,cap.target?{capability:cap.id,target:cap.target.id,kind:cap.target.kind,...(cap.target.kind==='place'?{place:cap.target.id}:{})}:undefined);
  }
  /** CN5 (acceptance: reservation.conflict on the Soul's own seat): a seated body that is going somewhere or doing
   *  something with its whole body gets up first; overlays done on the seat (read, eat, wave…) keep it. */
  private standIfSeated(soul: EdgeSoul, steps: Program['steps']): Program['steps'] {
    const first = steps[0]?.verb; if (!first || ['stand', 'mars:pose_v1', 'wave', 'face', 'rest'].includes(first) || (!this.seatOf(soul.entityId) && !this.lyingOnBerth(soul.entityId))) return steps;
    return [{verb: 'stand', params: {}}, ...steps];
  }
  /** Start a body plan as the Soul's act: queued through a quiet renewal or a safe stop, else decided now. */
  private async launch(soul: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef: string | undefined, resolved: {resolved?: Resolved}, refuse: (code: string, reason: string) => {accepted: false; code: string; reason: string; capability: string}, commit?: (receipt: string) => void,contentParams:Record<string,unknown>={},chosen?:Record<string,unknown>) {
    // PC08: an intent's launch of the stop offer (`{verb: 'stop-carry'}`) is the same stop
    if (this.sharedCarry && capability.startsWith('stop-carry:')) return {...await this.stopShared(soul, capability, clientRef), ...resolved};
    // Freeze the binding before dispatch: semantic capability names are not
    // identities of the real native fixtures they invoke. This is selection,
    // not a claim that the body has reached or used the target.
    const seatSlot=steps.find(s=>s.verb==='mars:sit'&&typeof s.params.slot==='string')?.params.slot;
    let painting: PaintingIntent | undefined;
    if (contentParams.painting !== undefined) {
      const plan = this.bindOne(soul, capability)?.plan as {paintingTarget?: string;paintingLevel?:number} | undefined;
      if (!capability.startsWith('paint:') || !plan?.paintingTarget || !this.painting) return refuse('painting.no-easel', 'This capability has no real painting easel.');
      const posed=steps.find(s=>s.verb==='mars:pose_v1'&&(s.params.activity==='paint'||s.params.activity==='chalk'));
      const approach=steps.filter(s=>s.verb==='walk_to'||s.verb==='mars:walk_to').at(-1),stand=approach?.verb==='mars:walk_to'?[approach.params.x,approach.params.z]:approach?.params.to;
      const prepared = this.painting.prepare(soul, plan.paintingTarget, contentParams.painting,{face:posed?.params.face,stand,level:plan.paintingLevel??0});
      if ('ok' in prepared) return refuse(prepared.code, prepared.message);
      painting = prepared;
    }
    const detail={...((chosen||typeof seatSlot==='string')?{chosen:{...structuredClone(chosen??{}),...(typeof seatSlot==='string'?{seat:seatSlot.split('#')[0],slot:seatSlot}:{})}}:{}), ...(painting ? {paintingV1: painting} : {})};
    const busy = this.sharedBusy(soul.soulId); if (busy) return {...refuse('shared.busy', busy.reason), ...this.busyExtra(busy), ...resolved};
    const nativeUse = this.nativeUseRefusal?.(capability, steps);
    if (nativeUse) return {...refuse(nativeUse.code, nativeUse.reason), ...resolved};
    const stepOut = this.stepOutRefusal(soul.entityId); if (stepOut) return {...refuse(stepOut.code, stepOut.reason), ...resolved};
    const unsupported=bodyCapabilityProblem(this.body(soul.entityId),{id:capability,verb:capability.split(':')[0]!,label,available:true},steps);if(unsupported)return refuse(unsupported.code,unsupported.reason);
    if (this.host.quietBarrier) {
      // Quiet renewal is brief and always ends (stall release): accept and start at first light, receipt 'waiting'.
      const r = this.insert(soul, capability, 'waiting', clientRef,false,detail,contentParams); commit?.(r.id);
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    let issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
    // SOUL3 continuation (ACCEPT3 A7): a here-activity asked while this Soul's own replaceable walk still holds the body (e.g. on
    // the way to board a balloon) was refused not-still, so the superseded walk went on and boarded; the body stops first instead.
    if (issue && /(^|\.)not-still$/.test(issue.code) && steps[0]?.verb !== 'stand' && this.host.engine.programOf(soul.entityId)) {
      const stopped = [{verb: 'stand', params: {}}, ...steps], again = this.host.engine.canPerform({actor: soul.entityId, label, steps: stopped});
      if (!again || WAIT_CODES.has(again.code)) {steps = stopped; issue = again;}
    }
    // CN5 (acceptance: stuck at the pond bank / after a landing): a body standing where no walk can start steps to the
    // nearest clear spot within 4 m first (a logged edge-relocate), then starts
    if (issue?.code === 'route.start-blocked') {
      const engine = this.host.engine as unknown as {nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null}, b = this.body(soul.entityId);
      const to = b && engine.nearestStandableV1 ? engine.nearestStandableV1([b.pose.p[0], b.pose.p[2]], soul.entityId, 0.33, 8) : null;
      if (to && b && Math.hypot(to[0] - b.pose.p[0], to[1] - b.pose.p[2]) <= 4) {
        // BS3 (c): a plain relocate refuses a body its seat holds, so a seated Soul rises with the god walk-out (as nav-connect/1)
        const seated = !!this.seatOf(soul.entityId) || this.lyingOnBerth(soul.entityId);
        await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to, why: seated ? 'stood up and stepped clear to start' : 'stepped clear to start', ...(seated ? {godWalkout: true, released: [], level: b.human?.level ?? 0} : {})});
        issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
      }
    }
    // Soul Actions entry 31: a plain walk a closed door walls off goes through it when the door is hand-operated and this
    // Soul may open it (opened by hand on the way, closed behind); a locked or private door on the only way refuses here,
    // naming it, rather than walking round to the nearest point behind the wall. Before nav-connect/1: a Soul in a
    // closed room is not cut off when its door opens.
    let passage: DoorPassage | undefined;
    if (issue?.code === 'route.unreachable' && this.doorPassage && steps.every(s => s.verb === 'walk_to' || s.verb === 'stand') && !isVerificationProbe(soul.soulId)) {
      const what = label.replace(/^(walk|run|jog|go|head|stroll|cycle|wander)( over| back| down| up)? (to|into|onto|towards?) /i, '') || 'there';
      const p = this.doorPassage(soul, steps, what);
      if (p && 'refuse' in p) return {...refuse(p.code, p.reason), ...resolved};
      if (p) for (const legs of [p.steps, p.direct]) {const again = this.host.engine.canPerform({actor: soul.entityId, label, steps: legs}); if (!again || WAIT_CODES.has(again.code)) {steps = legs; issue = again; passage = p; break;}}
    }
    // nav-connect/1 (lane NAV): no walk from where it stands, because it stands cut off from the walkable world (an edit
    // closed a pocket round it, a floor lost its stairs): it steps to the nearest open ground of the main area first (a
    // logged edge-relocate, at most once a minute each), then starts. A destination no walk reaches still refuses.
    if (issue?.code === 'route.unreachable' && (this.navRescuedAt.get(soul.soulId) ?? -1e9) <= this.host.engine.world.tick - 1200) {
      const engine = this.host.engine as unknown as {navRescueV1?: (id: string, budgetMs?: number) => {to: [number, number]; code: string; level: number; seated?: true} | null};
      const r = engine.navRescueV1 ? engine.navRescueV1(soul.entityId, 100) : null;
      if (r) {
        this.navRescuedAt.set(soul.soulId, this.host.engine.world.tick);
        // A seated Soul rises first (a god walk-out: a plain relocate refuses a body its seat holds).
        await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to: r.to, why: `nav-connect/1: ${r.seated ? 'sat' : 'stood'} cut off (${r.code}${r.level ? `, floor ${r.level}` : ''}), no walk out: ${r.seated ? 'stood up and ' : ''}stepped to the nearest open ground`, policy: 'nav-connect/1', ...(r.seated ? {godWalkout: true, released: [], level: 0} : {})});
        issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
      }
    }
    // GEST-LIVE: the nearest source of an item that no walk reaches (a postbox behind a fence) gives way to the next one a walk does
    const kind = /^pick-up:([a-z]+)$/.exec(capability)?.[1];
    if (issue && ROUTE_DEAD.has(issue.code) && kind) {
      for (const s of this.together.pickUpAlternatives(soul.entityId, kind)) {
        const alt = steps.map(x => x.verb === 'walk_to' ? {...x, params: {...x.params, to: s.at}} : x.verb === 'mars:pose_v1' ? {...x, params: {...Object.fromEntries(Object.entries(x.params ?? {}).filter(([k]) => k !== 'face')), ...(s.face ? {face: s.face} : {})}} : x);
        const again = this.host.engine.canPerform({actor: soul.entityId, label, steps: alt});
        if (!again || WAIT_CODES.has(again.code)) {steps = alt; issue = again; break;}
      }
    }
    // GEST-LIVE: a standing spot whose exact point no walk reaches (the barn table's cook-together places sat 0.45 m into the
    // table's solid) is taken from the nearest standable point within 1 m of it; seats and berths keep their exact slot
    if (issue?.code === 'route.goal-blocked' && !/^(?:sit|sit-ground|lie|nap|read|rest):/.test(capability)) {
      const eng = this.host.engine as unknown as {nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null};
      let moved = false;
      const alt = steps.map(x => {
        const to = x.verb === 'walk_to' ? (x.params as {to?: unknown})?.to : undefined;
        if (!Array.isArray(to) || to.length !== 2 || !eng.nearestStandableV1) return x;
        const p = eng.nearestStandableV1(to as [number, number], soul.entityId, 0.33, 6);
        if (!p || Math.hypot(p[0] - (to[0] as number), p[1] - (to[1] as number)) > 1) return x;
        moved = true; return {...x, params: {...x.params, to: p}};
      });
      if (moved) {const again = this.host.engine.canPerform({actor: soul.entityId, label, steps: alt}); if (!again || WAIT_CODES.has(again.code)) {steps = alt; issue = again;}}
    }
    // BS3 (a): a jog or run the water refuses (the way runs through the shallows, or the body stands in them) walks instead
    let note: string | undefined = passage?.note, approach: Record<string, unknown> | undefined;
    if (issue?.code === 'gait.dry-ground-required' && steps.some(s => s.verb === 'walk_to' && s.params?.gait && s.params.gait !== 'walk')) {
      const walked = steps.map(s => s.verb === 'walk_to' && s.params?.gait ? {...s, params: Object.fromEntries(Object.entries(s.params).filter(([k]) => k !== 'gait'))} : s);
      const again = this.host.engine.canPerform({actor: soul.entityId, label, steps: walked});
      if (!again || WAIT_CODES.has(again.code) || APPROACH_CODES.has(again.code)) {steps = walked; issue = again; note = 'Walking, not running: the way goes through shallow water (or starts in it), where only walking is possible.';}
    }
    // BS3 (4) closest approach: a walk whose destination no walk reaches (a closed room, a shut door) goes as near as a walk
    // does and says by how much, instead of refusing outright. Plain walks only (a seat or a use there still refuses).
    if (issue && APPROACH_CODES.has(issue.code) && steps.every(s => s.verb === 'walk_to' || s.verb === 'stand') && !isVerificationProbe(soul.soulId)) {
      const engine = this.host.engine as unknown as {walkApproachV1?: (id: string, steps: Program['steps']) => {to: [number, number]; goal: [number, number]; short: number; level: number} | null};
      const ap = engine.walkApproachV1?.(soul.entityId, steps);
      if (ap) {
        const near = steps.map(s => s.verb === 'walk_to' ? {...s, params: {...Object.fromEntries(Object.entries(s.params ?? {}).filter(([k]) => k !== 'standoff' && k !== 'spread')), to: ap.to}} : s);
        const again = this.host.engine.canPerform({actor: soul.entityId, label, steps: near});
        if (!again || WAIT_CODES.has(again.code)) {
          const what = label.replace(/^(walk|run|jog|go|head|stroll|cycle|wander)( over| back| down| up)? (to|into|onto|towards?) /i, '').replace(/^the /i, 'the ') || 'there';
          approach = {code: issue.code, goal: ap.goal, to: ap.to, short: ap.short};
          note = `Got within ${ap.short} m of ${what}: no walkable route reaches it from here (${issue.code}), so this walk goes to the nearest point one does.${note ? ' ' + note : ''}`;
          steps = near; issue = again;
        }
      }
    }
    // The verifier probe reports the engine's own diagnostic (what blocks the seat, how much room it needs) to the builder.
    if (issue && !WAIT_CODES.has(issue.code)) return {...refuse(issue.code, issue.code.startsWith('carrier.') || isVerificationProbe(soul.soulId) ? issue.message : humanBlockedExplanationV1(issue.code, label)), ...resolved};
    const remember = (id: string) => {
      if (note) this.update(id, {reason: note});
      if (approach) this.setDetail(id, {approach});
      if (passage) {this.setDetail(id, {doorPassageV1: {door: passage.door, open: passage.open, applied: [], ...(passage.unlocked ? {unlocked: true} : {})}}); this.contactPending.add(id);}
      this.launched.set(id, {soul, capability, label, steps}); if (this.launched.size > 512) this.launched.delete(this.launched.keys().next().value!);
    };
    if (issue) {
      // Asleep or mid-step: stop safely first, then start (receipt `waiting`).
      const r = this.insert(soul, capability, 'waiting', clientRef,false,detail,contentParams); commit?.(r.id); remember(r.id);
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
    }
    const r = this.insert(soul, capability, 'waiting', clientRef,false,detail,contentParams); commit?.(r.id); remember(r.id);
    await this.decide(soul, r.id, capability, label, steps);
    return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
  }
  /** BS3: the plans `launch` started, by receipt, so a stuck walk can be relaunched once under the same receipt. */
  private launched = new Map<string, {soul: EdgeSoul; capability: string; label: string; steps: Program['steps']; relaunched?: true}>();
  /**
   * BS3 (Souls never stuck): a walk the engine's watchdog ended as walk.stuck (no headway for 30 s, a replan included). A
   * body standing inside geometry (clearance below its radius) steps out to the nearest clear spot within 4 m (a logged
   * edge-relocate) and the same plan is relaunched once under the same receipt; otherwise the receipt ends with an honest
   * reason. True: relaunching (the receipt stays open).
   */
  private relaunchStuck(r: Row): boolean {
    const plan = this.launched.get(r.receipt_id), m = this.host.minds.get(r.soul_id);
    if (!plan || plan.relaunched || !m || m.entityId !== plan.soul.entityId) return false;
    const engine = this.host.engine as unknown as {clearanceAtV1?: (x: number, z: number, level?: number) => number; nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null};
    const b = this.body(m.entityId); if (!b?.human || !engine.clearanceAtV1 || !engine.nearestStandableV1 || (b.human.level ?? 0) !== 0) return false;
    if (engine.clearanceAtV1(b.pose.p[0], b.pose.p[2]) >= STUCK_RADIUS) return false;
    const to = engine.nearestStandableV1([b.pose.p[0], b.pose.p[2]], m.entityId, 0.33, 8);
    if (!to || Math.hypot(to[0] - b.pose.p[0], to[1] - b.pose.p[2]) > 4) return false;
    plan.relaunched = true;
    const soul = plan.soul, id = r.receipt_id;
    void (async () => {
      await this.host.enqueue('edge-relocate', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to, why: 'walk.stuck: stepped out of the geometry it was caught in, then walked on'});
      const issue = this.host.engine.canPerform({actor: soul.entityId, label: plan.label, steps: plan.steps});
      if (issue && !WAIT_CODES.has(issue.code)) {this.update(id, {phase: 'failed', code: issue.code, reason: humanBlockedExplanationV1(issue.code, plan.label)}); return;}
      await this.decide(soul, id, plan.capability, plan.label, plan.steps);
    })().catch(() => this.update(id, {phase: 'failed', code: 'walk.stuck', reason: STUCK_REASON}));
    return true;
  }
  /** together/1: accept:<invite> — join the host (its own plan, or the ride with the kept place). */
  private async acceptInvite(soul: EdgeSoul, cap: EdgeCapability, plans: Map<string, {label: string; steps: Program['steps']}>, caps: EdgeCapability[], clientRef: string | undefined, resolved: {resolved?: Resolved}, refuse: (code: string, reason: string) => {accepted: false; code: string; reason: string; capability: string}, params: Record<string, unknown> = {}) {
    const plan = this.together.acceptPlan(soul, cap.id.slice('accept:'.length), caps, plans as Map<string, TogetherPlan>, params);
    if ('code' in plan) return {...refuse(plan.code, plan.reason), ...resolved};
    if (plan.existing) {const old = this.receipt(soul.soulId, plan.existing); if (!old) return {...refuse('invite.gone', 'That proposal is no longer open.'), ...resolved}; return {accepted: true as const, receipt: old, ...resolved};}
    if (plan.wait) return this.openShared(soul, cap.id, clientRef, plan, resolved);
    this.comms?.fading.touch?.(soul.soulId);
    if (plan.ride) {
      if (!this.comms?.objects.prepareAct) return {...refuse('invite.gone', 'Rides are not available here.'), ...resolved};
      const prepared=this.comms.objects.prepareAct(plan.ride.object,soul,{action:'join',params:{}});
      const out = prepared.result as {accepted: boolean; code?: string; reason?: string; bodies?: {label: string; steps: Program['steps']}[]};
      if (!out.accepted || !out.bodies?.length) return {...refuse(out.code ?? 'ride.refused', out.reason ?? 'The ride refused.'), ...resolved};
      const steps = structuredClone(out.bodies[0].steps); for (const s of steps) if (s.verb === 'mars:carrier_ride') s.params.reserved = true;
      let acceptCommit=plan.commit;
      const inviteGuard=():true=>{prepared.guard();const fresh=this.together.acceptPlan(soul,cap.id.slice('accept:'.length),caps,plans as Map<string,TogetherPlan>);if('code'in fresh)throw new EdgeError(409,fresh.code,fresh.reason);if(fresh.ride?.object!==plan.ride!.object)throw new EdgeError(409,'invite.gone','That ride invitation changed.');acceptCommit=fresh.commit;return true;};
      const b = await this.performBodies(soul, cap.id, out.bodies[0].label, steps, clientRef,undefined,{guard:inviteGuard,commit:id=>{prepared.commit();acceptCommit(id);}});
      if (!b.accepted) return {...refuse(b.code, b.reason), ...resolved};
      return {accepted: true as const, receipt: {...this.receipt(soul.soulId, b.receipt.id)!, object: plan.ride.object} as EdgeReceipt, ...resolved};
    }
    return this.launch(soul, cap.id, plan.label, plan.steps, clientRef, resolved, refuse, plan.commit);
  }
  /** PC04 (#683, PC02 §1): proposing or accepting a shared operation opens this Soul's own `waiting` receipt with no body
   *  steps. It is a body act like any other, so an earlier open act is ended and its programme stopped safely; nothing
   *  else moves, and nothing is claimed until a commit (PC05). */
  private async openShared(soul: EdgeSoul, capability: string, clientRef: string | undefined, prep: {commit?: (receipt: string) => void; detail?: Record<string, unknown>}, resolved: {resolved?: Resolved}) {
    const r = tx(this.db.db, () => {const r = this.insert(soul, capability, 'waiting', clientRef, false, prep.detail ?? {}); prep.commit?.(r.id); return r;});
    this.comms?.fading.touch?.(soul.soulId);
    if (this.host.engine.programOf(soul.entityId)) await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
    return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!, ...resolved};
  }
  /** together/1: where a Soul, place, object or ride named in plain words is (for facing / pointing). */
  private pointOf(soul: EdgeSoul, name: string): [number, number] | null {
    const w = name.trim().toLowerCase(); if (!w) return null;
    const seen = this.perceivedBodies(soul.soulId, 60), q = tokens(w);
    const o = seen.find(x => x.soulId === name) ?? seen.find(x => x.name.toLowerCase() === w) ?? seen.find(x => tokens(x.name).length > 0 && tokens(x.name).every(t => q.includes(t))) ?? seen.find(x => tokens(x.name).some(t => t.length > 2 && q.includes(t)));
    if (o) {const b = this.body(o.entityId); if (b) return [b.pose.p[0], b.pose.p[2]];}
    const world = this.mw.world as NativeWorld, ride = this.carriersNative().find(c => c.id === name || tokens(c.label + ' ' + c.id).some(t => tokens(w).includes(t) && t.length > 3) || /balloon/.test(w) && c.def.includes('balloon'));
    if (ride) {const e = world.entities[ride.id]; if (e) return [e.pose.p[0], e.pose.p[2]];}
    const place = this.places.byId.get(name) ?? placeMatch(tokens(w), this.vocabulary(soul, []).places)[0];
    if (place) return centroid((this.places.byId.get(place.id) ?? {polygon: [[0, 0]] as [number, number][]}).polygon);
    const e = world.entities[name]; if (e) return [e.pose.p[0], e.pose.p[2]];
    return null;
  }

  /** Body steps requested by an object action (OBJECT-CONTRACT §7): performed like `act` — refused with a genuine code, or
   *  accepted with a receipt (waiting → started → completed/failed) for a logged decision with trigger edge-act. */
  contactActuatorDetail(soul:EdgeSoul,id:string,action:string,params:Record<string,unknown>={}){const intent=this.contactActuator?.prepare(soul,id,action,params);return intent?{contactActuatorV1:intent}:null;}
  async performBodies(soul: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef?: string,effects?:ConfirmedEffects,admission?:ObjectBodyAdmission): Promise<{accepted: true; receipt: EdgeReceipt} | {accepted: false; code: string; reason: string}> {
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const refuse = (code: string, reason: string) => {this.recordRefusal(soul.soulId, 'object', capability, code, reason); return {accepted: false as const, code, reason};};
    const busy = this.sharedBusy(soul.soulId); if (busy) return {...refuse('shared.busy', busy.reason), ...this.busyExtra(busy)};
    const nativeUse = this.nativeUseRefusal?.(capability, steps);
    if (nativeUse) return refuse(nativeUse.code, nativeUse.reason);
    const stepOut = this.stepOutRefusal(soul.entityId); if (stepOut) return refuse(stepOut.code, stepOut.reason);
    if(admission)return this.performAtomicObjectBodies(soul,capability,label,steps,clientRef,admission);
    if (this.faded.has(soul.soulId)) return refuse('soul.faded', 'This Soul has faded; act once (e.g. stand:here) to come back first.');
    if (this.host.quietBarrier) {const r = this.insert(soul, capability, 'waiting', clientRef,false,{...(effects?{confirmedEffects:effects}:{})}); this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability}); return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};}
    const issue = this.host.engine.canPerform({actor: soul.entityId, label, steps});
    if (issue && !WAIT_CODES.has(issue.code)) return refuse(issue.code, issue.code.startsWith('carrier.') ? issue.message : humanBlockedExplanationV1(issue.code, label));
    const r = this.insert(soul, capability, 'waiting', clientRef,false,{...(effects?{confirmedEffects:effects}:{})});
    if (issue) {
      this.arm({receipt: r.id, soul, steps, label, deadline: this.host.engine.world.tick + WAIT_LIMIT_TICKS, capability});
      if (issue.code === 'program.safe-stop-required') await this.host.enqueue('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, receipt: r.id});
      return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
    }
    await this.decide(soul, r.id, capability, label, steps);
    return {accepted: true, receipt: this.receipt(soul.soulId, r.id)!};
  }

  /** PC09 (#688, PC02 §3): a member of a running shared carry faded. Their fade is their stop: the same logged
   *  `edge-stop` naming the op's programme as `stop-carry`, and the op's `stopping` journal (`stop.away`), but no stop
   *  receipt in their name; their shared receipt stays open and ends with the crew's result. PC10 (#689): the event and
   *  the journal are one transaction at the sequencer; one refused there (the op already stops or ended) writes neither.
   *  A clock that is not running logs nothing and writes nothing, so the body goes on with the accepted carry to its end. */
  private awayStop(soulId: string, name: string, op: {invite: string; op: string; programId: string; hostEntity: string}) {
    const guard = (): true => {const p = this.together.sharedStopPlan(soulId, op.op); if ('code' in p || p.again) throw new EdgeError(409, 'shared.not-running', 'The shared carry is already stopping or has ended.'); return true;};
    try {void this.host.enqueueChecked('edge-stop', `edge:${soulId}`, {soulId, entityId: op.hostEntity, programId: op.programId, op: op.op, why: 'shared.away'}, guard, () => {this.together.sharedStopping(op.invite, {soulId, name}, '', true); return true;}).catch(() => {/* refused at the sequencer: nothing was logged or written */});}
    catch {/* clock not ready */}
  }
  /** PC09: a reclaimed Soul whose body a running shared carry still moves is not relocated (no teleport out of a crew). */
  private inSharedCarry(soulId: string): boolean {return this.sharedCarry && !!this.together.sharedRunning(soulId);}
  /** PC08 (#687, PC02 §3): `stop-carry:<op>` from any member. The stop is logged as `edge-stop` naming the op's programme
   *  (so it replays by that programme, not by the member's body); the op's `stopping` and the stop's own receipt are
   *  written with it, and that receipt completes at once ("stop requested": the prompt acknowledgment, not the release). The
   *  native cancel is the only cleanup; the claims stay until the programme ends (`sharedProgramEnded`). A repeat changes
   *  nothing: the same member gets the first stop's receipt, another member a completed receipt saying it was asked. */
  private async stopShared(soul: EdgeSoul, capability: string, clientRef: string | undefined): Promise<{accepted: true; receipt: EdgeReceipt} | {accepted: false; code: string; reason: string; capability: string}> {
    const refuse = (code: string, reason: string) => {this.recordRefusal(soul.soulId, 'act', capability, code, reason); return {accepted: false as const, code, reason, capability};};
    if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
    const opId = capability.slice('stop-carry:'.length);
    const again = (plan: {again?: {by: string; name: string; tick: number; receipt: string; away?: true}}) => {
      const first = plan.again!;
      if (first.by === soul.soulId) {const r = this.receipt(soul.soulId, first.receipt); if (r) return {accepted: true as const, receipt: r};}
      const r = tx(this.db.db, () => {const r = this.insert(soul, capability, 'waiting', clientRef, true, {stopCarryV1: {op: opId, repeat: true}}); this.update(r.id, {code: 'shared.stop-asked', reason: `${first.away ? `${this.together.stopWords(first)}, so the crew is already stopping` : `${first.name} already asked to stop`} (${opId}); nothing more was done. The crew sets the load down safely, and you are free once it is down.`}); this.update(r.id, {phase: 'completed'}); return r;});
      return {accepted: true as const, receipt: this.receipt(soul.soulId, r.id)!};
    };
    const plan = this.together.sharedStopPlan(soul.soulId, opId);
    if ('code' in plan) return refuse(plan.code, plan.reason);
    if (plan.again) return again(plan);
    if (this.host.quietBarrier) return refuse('state.changed', 'The world is pausing; ask to stop again in a moment.');
    // PC10 (#689): the stop event and its journal (the op `stopping`, this stop's own receipt, completed at once) are one
    // transaction at the sequencer, so a restart finds both or neither. The guard re-reads the op under the write lock:
    // a second stop in the same drain, or an op that ended meanwhile, logs nothing and is answered from the op as it is.
    const id = 'r_' + randomUUID();
    let seen: ReturnType<Together['sharedStopPlan']> | null = null;
    const guard = (): true => {const p = seen = this.together.sharedStopPlan(soul.soulId, opId); if ('code' in p) throw new EdgeError(409, p.code, p.reason); if (p.again) throw new EdgeError(409, 'shared.stop-asked', 'Already asked.'); return true;};
    try {
      await this.host.enqueueChecked('edge-stop', `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: plan.hostEntity, programId: plan.programId, op: plan.op, why: 'shared.stop'}, guard, () => {
        this.insert(soul, capability, 'waiting', clientRef, true, {stopCarryV1: {op: plan.op}}, {}, id);
        this.update(id, {code: 'shared.stop-requested', reason: this.together.sharedStopping(plan.invite, {soulId: soul.soulId, name: soul.name}, id)});
        this.update(id, {phase: 'completed'});
        return true;
      });
    } catch (error) {
      // answered from the op as the guard saw it under the write lock (it may have ended since)
      const now = error instanceof EdgeError ? seen as ReturnType<Together['sharedStopPlan']> | null : null;
      if (now && 'code' in now) return refuse(now.code, now.reason);
      if (now?.again) return again(now);
      if (clientRef) {const old = this.rows('soul_id=? AND client_ref=?', soul.soulId, clientRef)[0]; if (old) return {accepted: true, receipt: this.view(old)};}
      if (!(error instanceof EdgeError) && !/clock/.test(String((error as Error)?.message))) console.error('[edge] stop-carry not recorded', error instanceof Error ? error.message : error);
      return refuse('state.changed', 'The stop could not be recorded (the world clock may not be running); nothing was stopped. Ask to stop again in a moment.');
    }
    return {accepted: true, receipt: this.receipt(soul.soulId, id)!};
  }
  /** PC05 (#684, PC02 §3): the shared.busy refusal of a member of a running operation, before any native check. */
  /** PC08: what a `shared.busy` refusal carries besides its reason: the op, and the safe stop on offer. */
  private busyExtra(busy: NonNullable<ReturnType<Together['sharedBusyFor']>>): {op?: string; alternatives?: {id: string; label: string}[]} {return {op: busy.op, ...(busy.alternatives ? {alternatives: busy.alternatives} : {})};}
  private sharedBusy(soulId: string): ReturnType<Together['sharedBusyFor']> {for (const r of this.openReceipts(soulId)) {const b = this.together.sharedBusyFor(r); if (b) return b;} return null;}
  /** PC05 (#684, PC02 §2): the atomic commit of a ready shared proposal. One host decision with one native crew `carry`,
   *  through the atomic object decision: its guard re-derives readiness under the write lock and requires no operation
   *  yet; its journal writes the operation, `committed` and every member's `started` receipt with the event, or nothing.
   *  A stale guard (someone left, moved away, or it already started) commits nothing; the next check re-derives. */
  private async commitShared(id: string) {
    const plan = this.together.sharedCommitPlan(id); if (!plan || this.host.quietBarrier) return;
    const {host, label, steps, revision, opId} = plan, inv = this.together.invite(id)!;
    const issue = this.host.engine.canPerform({actor: host.entityId, label, steps});
    const wait = (code: string, message?: string) => this.together.sharedNotReady(inv, [{soulId: host.soulId, name: 'The carry', why: `cannot start yet (${code}${message ? `: ${message}` : ''})`}]);
    if (issue) {if (WAIT_CODES.has(issue.code) || SHARED_CARRY_WAIT.has(issue.code) || !issue.code.startsWith('carry.')) wait(issue.code, issue.message); else this.together.sharedRefused(id, issue.code, issue.message ?? humanBlockedExplanationV1(issue.code, label)); return;}
    const guard = (): true => {
      this.together.sharedCommitGuard(id, revision);
      if (this.host.quietBarrier) throw new EdgeError(409, 'state.changed', 'The world entered a quiet barrier; retry.');
      const fresh = this.host.engine.canPerform({actor: host.entityId, label, steps}); if (fresh) throw new EdgeError(409, fresh.code, fresh.message ?? fresh.code);
      return true;
    };
    try {
      await this.host.enqueueObjectDecision(`edge:${host.soulId}`, {soulId: host.soulId, entityId: host.entityId, option: plan.capability, label, steps, reevalTicks: 1e9, fallback: false, trigger: `shared-commit:${opId}`}, guard, e => {
        const program = (this.host.engine as {instantProgramV1?(a: string): string | null}).instantProgramV1?.(host.entityId) ?? this.host.engine.programOf(host.entityId);
        if (!program) throw Error('shared.native-program-missing');
        this.together.sharedCommitted(id, revision, program, e.seq); return true;
      });
    } catch (error) {
      // nothing was committed (the transaction rolled back); a native refusal at the fold is handled as at the check above
      const code = error instanceof Error ? /^object\.native-admission-refused:(.+)$/.exec(error.message)?.[1] : undefined;
      if (code && code.startsWith('carry.') && !SHARED_CARRY_WAIT.has(code)) this.together.sharedRefused(id, code, humanBlockedExplanationV1(code, label));
    }
  }
  private async performAtomicObjectBodies(soul:EdgeSoul,capability:string,label:string,steps:Program['steps'],clientRef:string|undefined,admission:ObjectBodyAdmission){
    const refuse=(code:string,reason:string)=>{this.recordRefusal(soul.soulId,'object',capability,code,reason);return {accepted:false as const,code,reason};};
    const source=this.db.soul(soul.soulId),id='r_'+randomUUID();
    const authority=():true=>{const row=this.db.soul(soul.soulId),mind=this.host.minds.get(soul.soulId);if(!source||!row||row.owner!==source.owner||row.owner!==soul.owner||mind?.owner!==row.owner||row.token_hash!==source.token_hash||row.retired_at!==null||row.world_id!==this.host.worldId||row.entity_id!==soul.entityId||mind?.entityId!==soul.entityId)throw new EdgeError(401,'unauthorized','Soul authority changed before object admission.');if(this.faded.has(soul.soulId))throw new EdgeError(409,'soul.faded','This Soul has faded; act to return first.');admission.guard();return true;};
    try{
      authority();const issue=this.host.engine.canPerform({actor:soul.entityId,label,steps});
      if(issue&&!WAIT_CODES.has(issue.code))return refuse(issue.code,issue.code.startsWith('carrier.')?issue.message:humanBlockedExplanationV1(issue.code,label));
      if(this.host.quietBarrier||issue){
        // Accepted waiting is a durable intent/reservation, not physical completion.
        // A later start can fail or be replaced; that terminal receipt is authoritative.
        // Ride apply() adds no member: riders/custody are projected from native state.
        tx(this.db.db,()=>{authority();const fresh=this.host.engine.canPerform({actor:soul.entityId,label,steps});if(fresh&&!WAIT_CODES.has(fresh.code))throw new EdgeError(409,fresh.code,fresh.code.startsWith('carrier.')?fresh.message:humanBlockedExplanationV1(fresh.code,label));const detail=admission.commit(id)??{};this.insert(soul,capability,'waiting',clientRef,false,detail,{},id);afterCommit(this.db.db,()=>this.arm({receipt:id,soul,steps,label,deadline:this.host.engine.world.tick+WAIT_LIMIT_TICKS,capability}));},{immediate:true});
        if(issue?.code==='program.safe-stop-required')await this.host.enqueue('edge-stop',`edge:${soul.soulId}`,{soulId:soul.soulId,entityId:soul.entityId,receipt:id});
      }else{
        const guard=():true=>{authority();if(this.host.quietBarrier)throw new EdgeError(409,'state.changed','The world entered a quiet barrier; retry.');const fresh=this.host.engine.canPerform({actor:soul.entityId,label,steps});if(fresh)throw new EdgeError(409,fresh.code,fresh.code.startsWith('carrier.')?fresh.message:humanBlockedExplanationV1(fresh.code,label));return true;};
        this.planFor(id,capability,label,steps);
        await this.host.enqueueObjectDecision(`edge:${soul.soulId}`,{soulId:soul.soulId,entityId:soul.entityId,option:capability,label,steps,reevalTicks:1e9,fallback:false,trigger:`edge-act:${id}`},guard,()=>{const detail=admission.commit(id)??{};this.insert(soul,capability,'waiting',clientRef,false,detail,{},id);const program=(this.host.engine as {instantProgramV1?(a:string):string|null}).instantProgramV1?.(soul.entityId)??this.host.engine.programOf(soul.entityId);if(!program)throw Error('object.native-program-missing');this.update(id,{phase:'started',program_id:program});return true;});
      }
      return {accepted:true as const,receipt:this.receipt(soul.soulId,id)!};
    }catch(error){return refuse(error instanceof EdgeError?error.code:'object.admission-failed',error instanceof EdgeError?error.message:'Object/body admission did not commit; observe and retry.');}
  }

  // ---------------------------------------------------------------- rides (carrier/1)
  private carriersNative(): {id: string; def: string; label: string; pose: {p: number[]; yaw: number}; state: {phase: string; home: number[]; yaw: number; seats: Record<string, string | null>; route: {id: string; keys: {t: number; p: number[]}[]}; elapsed: number; departAtTick: number | null; flights: number; holding: boolean; waitTicks: number; phaseTick: number; bank?: {door: [number,number,number]; exits: Record<string,[number,number,number]>}; hold?: {by: string; seats: number; filled: number; untilTick: number}}}[] {
    if (this.carrierPass) return this.carrierPass.list ??= (this.mw as unknown as {carriers?: () => never[]}).carriers?.() ?? [];
    return (this.mw as unknown as {carriers?: () => never[]}).carriers?.() ?? [];
  }
  /** L3: within one run of the object providers (every ride's view asks), the engine's carriers are listed once (each
   *  listing copied every entity: ~30 ms of a capabilities read on the live Eden 2026 with 8 rides). */
  private carrierPass: {list?: never[]} | null = null;
  /** The ride this body is boarding, seated in or leaving. */
  /** RIDE-EXIT (Gene's review 2026-10-23): a ride that is back on the ground holds the body only while it steps out (the engine sets
   *  it down within LEAVE_LIMIT); a request meanwhile is refused with how long that takes, never accepted to fail later as actor.busy. */
  stepOutRefusal(entityId: string): {code: string; reason: string} | null {
    const r = this.aboard(entityId); if (!r || !(r.phase === 'landed' || r.riderPhase === 'leaving')) return null;
    // A step-out with no sane end left (its own limit gone) is a stall, not a landing: stall-guard/1 (b) lets the owner's stand free it.
    if (r.outInSeconds !== undefined && !(r.outInSeconds <= 60)) return null;
    const noun = /punt|boat/i.test(r.id + ' ' + r.label) ? 'punt' : /balloon/i.test(r.id + ' ' + r.label) ? 'balloon' : r.label;
    return {code: 'ride.landing', reason: `Stepping out of the ${noun}, ~${r.outInSeconds ?? 12} s; you are on the ground at its exit then.`};
  }
  /** SOUL3 stand truthfulness: a body seated in a ride with nothing running cannot stand up in the basket, so stand:here would answer
   *  'completed' with the body still seated. Refuse truthfully instead, naming the explicit exit while the ride is on the ground (a stand
   *  is never turned into a leave); aloft it lands by itself. A running program (e.g. rest aloft) is still stopped by stand:here. */
  rideStandRefusal(entityId: string, caps: EdgeCapability[]): {code: string; reason: string} | null {
    const r = this.aboard(entityId); if (!r || r.riderPhase !== 'seated' || this.mw.programOf(entityId)) return null;
    const leave = r.phase === 'aloft' ? undefined : caps.find(c => /^object:[^:]+:leave$/.test(c.id) && c.available);
    return {code: 'ride.seated', reason: `You are seated in ${r.label} and cannot stand up in it; nothing else is running to stop.${r.phase === 'aloft' ? ' It returns to the ground by itself and you step out then.' : leave ? ` To get out, use ${leave.id} while it is on the ground.` : ''}`};
  }
  aboard(entityId: string): {id: string; slot: string; riderPhase: string; phase: string; label: string; outInSeconds?: number} | null {
    return (this.mw as unknown as {carrierOf?: (a: string) => ReturnType<EdgeLedger['aboard']>}).carrierOf?.(entityId) ?? null;
  }
  private carrierCount = -1;
  /** A carrier with no declared carrier place gets one derived from its native seats (`<entity>-basket`, enclosed). */
  private syncCarrierPlaces() {
    const all = this.carriersNative(); if (all.length === this.carrierCount) return; this.carrierCount = all.length;
    for (const c of all) {
      if (this.places.carrierPlaces.has(c.id)) continue;
      const seats = (CATALOG[c.def]?.capabilities?.carrier?.seats ?? []).map(s => s.id), size = CATALOG[c.def]?.size ?? [1.5, 1, 1.2];
      const parent = this.places.containing(c.state.home[0], c.state.home[2], 0)[0]?.id ?? [...this.places.byId.values()].find(p => p.parent === null)!.id;
      const hx = size[0] / 2, hz = size[2] / 2, id = `${c.id}-basket`, rowing = c.def === 'rowing-punt';
      this.places.add({id, name: `${c.label}${rowing ? '' : ' basket'}`, kind: 'vehicle', parent, level: 0, enclosed: !rowing, capacity: seats.length, starting: false,
        polygon: [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]], carrier: {entity: c.id, frame: 'local'},
        occupiers: seats.map(s => ({id: `${c.id}-${s}`, fixture: c.id, slot: s, kind: 'seat'})),
        description: rowing ? `An open rowing punt. Room for ${seats.length}; a loop on the water and back to its bank.` : `The basket of ${c.label}. Room for ${seats.length}. Speech inside stays inside; it carries its riders on a flight and back.`});
    }
  }
  /** Public ride state (World draws it; agents read it through the ride object). No owner data. */
  carrierView(entityId: string) {
    const c = this.carriersNative().find(x => x.id === entityId); if (!c) return null;
    const def = CATALOG[c.def]?.capabilities?.carrier, tick = this.mw.world.tick, place = this.places.carrierPlaces.get(c.id);
    const rot = (l: [number, number]) => {const cs = Math.cos(c.pose.yaw), sn = Math.sin(c.pose.yaw); return [Math.round((c.pose.p[0] + l[0] * cs - l[1] * sn) * 100) / 100, Math.round((c.pose.p[2] + l[0] * sn + l[1] * cs) * 100) / 100];};
    const riders = Object.entries(c.state.seats).flatMap(([seat, entity]) => {
      if (!entity) return []; const m = this.host.mindByEntity?.get(entity) ?? [...this.host.minds.values()].find(x => x.entityId === entity), b = this.aboard(entity);
      const exit = def?.seats.find(s => s.id === seat)?.exit, bankExit = c.state.bank?.exits[seat];
      return [{seat, entityId: entity, soulId: m?.soulId ?? null, name: m?.name ?? null, phase: b?.riderPhase ?? 'boarding', ...(bankExit ? {exit: [bankExit[0], bankExit[2]]} : exit ? {exit: rot(exit)} : {})}];
    });
    const end = c.state.route.keys[c.state.route.keys.length - 1].t;
    return {id: c.id, def: c.def, label: c.label, place: place?.id ?? null, phase: c.state.phase, holding: c.state.holding,
      position: c.pose.p.map(v => Math.round(v * 1000) / 1000), yaw: c.pose.yaw, home: c.state.home, door: c.state.bank ? [c.state.bank.door[0], c.state.bank.door[2]] : def ? rot(def.door) : null,
      // together/1: places kept for invited companions are not free to others
      capacity: def?.seats.length ?? 0, seatsFree: Math.max(0, Object.values(c.state.seats).filter(v => !v).length - (c.state.hold ? Math.max(0, c.state.hold.seats - c.state.hold.filled) : 0)), riders,
      ...(c.state.hold ? {hold: {seats: c.state.hold.seats, boarded: c.state.hold.filled, secondsLeft: Math.max(0, Math.round((c.state.hold.untilTick - tick) / 20)), for: this.together.rideGuests(c.id)}} : {}),
      departsInSeconds: c.state.phase === 'boarding' && c.state.departAtTick !== null ? Math.max(0, Math.round((c.state.departAtTick - tick) / 20)) : null,
      departsAtTick: c.state.phase === 'boarding' ? c.state.departAtTick : null, returnsAtTick: c.state.phase === 'aloft' ? tick + Math.max(0, Math.round(end * 20) - c.state.elapsed) : null,
      route: {id: c.state.route.id, seconds: end, elapsedSeconds: Math.round(c.state.elapsed / 2) / 10, keys: c.state.route.keys, interpolation: 'eden-rides/1 hermite'},
      ...((c.state as {steer?: {by: string | null; land?: number[]; to: number[]; ret?: true}}).steer ? (() => {const st = (c.state as unknown as {steer: {by: string | null; land?: number[]; to: number[]; ret?: true}}).steer, m = st.by ? this.host.mindByEntity?.get(st.by) ?? [...this.host.minds.values()].find(x => x.entityId === st.by) : undefined;
        return {steer: {by: m ? {soulId: m.soulId, name: m.name} : null, returning: !!st.ret, to: [st.to[0], st.to[2]], ...(st.land ? {landAt: [st.land[0], st.land[2]]} : {})}};})() : {}),
      flights: c.state.flights, phaseTick: c.state.phaseTick, tick, waitSeconds: Math.round(((c.state as {waitTicks?: number}).waitTicks ?? 900) / 20),
      ...((b: {code: string; message: string} | null) => b ? {blocked: b} : {})(this.boardingIssue(c.id, tick, c.state.route.id))};
  }
  /** VERBS (accept2 brief 10): a punt whose bank or water no longer qualifies (a later ground edit) was offered and then refused
   *  by the world (punt.unsupported-water). The engine's own boarding check, cached for 30 s (it costs ~10 ms a punt). */
  /*  Keyed by the route too: a steered trip flies a 'steer' route in place of the ride's own, and an answer cached then
   *  must not refuse the next boarding once its own loop is back (STACK merge of VEHICLE-STEER + VERBS). */
  private boardingChecks = new Map<string, {tick: number; route: string; issue: {code: string; message: string} | null}>();
  private boardingIssue(id: string, tick: number, route: string): {code: string; message: string} | null {
    const was = this.boardingChecks.get(id);
    if (was && was.route === route && tick >= was.tick && tick - was.tick < 600) return was.issue;
    const check = (this.host.engine as unknown as {carrierBoardingIssueV1?: (id: string) => {code: string; message: string} | null}).carrierBoardingIssueV1;
    const issue = check ? check.call(this.host.engine, id) ?? null : null;
    this.boardingChecks.set(id, {tick, route, issue});
    return issue;
  }
  /** VEHICLE-STEER: where a rider asks a ride to go, as ground (x, z): a place the Soul knows (its centre), or a compass
   *  direction + distance from the ride's position. Validation of the spot itself (water, landing, bounds) is the engine's. */
  steerTarget(soulId: string, entityId: string, spec: {to?: string; direction?: string; distance?: number}): {ok: true; x: number; z: number; label: string} | {ok: false; code: string; reason: string; did_you_mean?: unknown} {
    const c = this.carriersNative().find(x => x.id === entityId); if (!c) return {ok: false, code: 'ride.closed', reason: 'This ride is not running.'};
    if (spec.to !== undefined) {
      let r = lookupPlaceIdentity(this, spec.to, soulId);
      // "the lighthouse" names several places (a region, its breakwater, a room): steering wants the first that every word fits
      if (!r.ok && r.did_you_mean.length) {
        const words = String(spec.to).toLowerCase().replace(/^the\s+/, '').split(/[^a-z0-9]+/).filter(Boolean);
        const fit = r.did_you_mean.map(d => this.places.byId.get(d.placeId)).find(pl => pl?.polygon?.length && !pl.carrier && words.every(w => `${pl.id} ${pl.name}`.toLowerCase().includes(w)));
        if (fit) r = {ok: true, chosen: {place: fit.id, name: fit.name}} as unknown as typeof r;
      }
      if (!r.ok) {
        // name a few real choices: the near-misses, else the known places nearest the ride
        const near = r.did_you_mean.length ? r.did_you_mean.map(d => this.places.byId.get(d.placeId)?.name ?? d.label) : knownBootPlaces(this, soulId).filter(k => k.access === 'admitted' || k.access === 'scenery').map(k => this.places.byId.get(k.id)).filter(pl => pl?.polygon?.length && !pl.carrier)
          .map(pl => {const [x, z] = centroid(pl!.polygon!); return {name: pl!.name, d: Math.hypot(x - c.pose.p[0], z - c.pose.p[2])};}).sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.name);
        return {ok: false, code: 'steer.unknown-place', reason: `"${String(spec.to).slice(0, 60)}" is not a place you know; name a place (or give a direction and distance)${near.length ? `. Places you know: ${[...new Set(near)].slice(0, 5).join(', ')}` : ''}.`, did_you_mean: r.did_you_mean.slice(0, 5)};
      }
      const pl = this.places.byId.get(r.chosen.place); if (!pl?.polygon?.length) return {ok: false, code: 'steer.unknown-place', reason: `${r.chosen.name} has no location to steer to.`};
      const [x, z] = centroid(pl.polygon); return {ok: true, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, label: pl.name};
    }
    const POINTS: Record<string, number> = {n: 0, north: 0, ne: 45, northeast: 45, e: 90, east: 90, se: 135, southeast: 135, s: 180, south: 180, sw: 225, southwest: 225, w: 270, west: 270, nw: 315, northwest: 315};
    const deg = POINTS[String(spec.direction ?? '').toLowerCase().replace(/[\s-]/g, '')], d = Number(spec.distance);
    if (deg === undefined || !(d >= 5 && d <= 1000)) return {ok: false, code: 'steer.params', reason: 'Steer to a place (to) or a compass direction (N, NE, ... NW) with a distance of 5-1000 m.'};
    const a = deg * Math.PI / 180, x = c.pose.p[0] + d * Math.sin(a), z = c.pose.p[2] - d * Math.cos(a);
    return {ok: true, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, label: `${Math.round(d)} m ${['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][deg / 45]}`};
  }
  /** VEHICLE-STEER: the engine's own refusal for a steer step now (another rider steering, out of bounds, no open water, no
   *  landing spot), so the Soul hears it at once instead of in a failed receipt. Pure: nothing changes. */
  steerCheck(entityId: string, carrier: string, step: {x?: number; z?: number; land?: boolean; stop?: boolean}): {code: string; reason: string} | null {
    const eng = this.host.engine as {previewMarsVerbV1?(verb: string, params: unknown): {code: string; message: string} | null};
    const no = eng.previewMarsVerbV1?.('carrier_steer', {actor: entityId, carrier, ...step}); if (!no) return null;
    return {code: no.code.replace(/^carrier\./, 'ride.'), reason: no.message.charAt(0).toUpperCase() + no.message.slice(1) + '.'};
  }
  rides() {return this.carriersNative().map(c => this.carrierView(c.id)!);}
  private rideKey = new Map<string, string>();
  /** Spectator frames (EDGE-CONTRACT §7, kind `ride`): every 0.5 s while aloft, and at once on any phase or rider change. */
  private rideFrames(tick: number) {
    if (tick % 200 === 0) this.syncCarrierPlaces();
    const all = this.carriersNative(); if (!all.length) return;
    if (all.length !== this.carrierCount) this.syncCarrierPlaces();
    let changed = false;
    for (const c of all) {
      const key = JSON.stringify([c.state.phase, c.state.seats, c.state.holding, Object.values(c.state.seats).map(a => a ? this.aboard(a)?.riderPhase : null), c.state.hold ?? null]);
      const moved = c.state.phase === 'aloft', fresh = this.rideKey.get(c.id) !== key;
      if (fresh) {this.rideKey.set(c.id, key); changed = true;}
      if (moved || fresh) try {(this.comms as unknown as {core?: {spectate(m: object): void}} | undefined)?.core?.spectate({kind: 'ride', tick, ride: (() => {const v = this.carrierView(c.id)!; return fresh ? v : {...v, route: {...v.route, keys: undefined}};})()});} catch {/* spectators never break the ledger */}
    }
    if (changed) try {
      const objects = this.comms?.objects as unknown as {ofKind?(kind: string): {id: string}[]; refresh?(ids: Iterable<string>): void; sweep?(): void} | undefined;
      // A physical carrier change needs its ride projections now (including arbitrary object aliases), not every
      // unrelated calendar/presentation/built object's time advance. Those keep their own read/maintenance triggers.
      // ofKind keeps object-id order; refresh re-reads each row in its committed transaction before the next ride.
      if (objects?.ofKind && objects.refresh) objects.refresh(objects.ofKind('ride').map(o => o.id));
      else objects?.sweep?.(); // older object adapters expose only the full sweep
    } catch {/* object events catch up on the next read */}
  }

  /** activities/1: the world facts activity capabilities need, for one Soul. */
  private activityWorld(soul: EdgeSoul, me: NonNullable<ReturnType<EdgeLedger['body']>>, caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean}>) {
    const engine = this.mw as unknown as {clearanceAtV1?: (x: number, z: number) => number; clearanceUpToV1?: (x: number, z: number, cap?: number) => number; nearestStandableV1?: (at: [number, number], except?: string, min?: number, rings?: number) => [number, number] | null};
    const w = this.mw.world as NativeWorld, here: [number, number] = [me.pose.p[0], me.pose.p[2]];
    // One synchronous, read-only activity listing: entity membership is fixed, but group state is read on every call.
    // Reuse the human references here; never retain a group count or this subset across listings/ticks.
    const humans = Object.values(w.entities).filter(e => e.kind === 'human');
    const others = humans.filter(e => e.id !== soul.entityId).map(e => [e.pose.p[0], e.pose.p[2]] as [number, number]);
    const claimed = new Set<string>();
    for (const m of this.host.minds.values()) if (m.soulId !== soul.soulId) for (const r of this.openReceipts(m.soulId)) claimed.add(r.capability.slice(r.capability.indexOf(':') + 1));
    const navIds = new Set(((w as {navV1?: {solids: {id: string}[]}}).navV1?.solids ?? []).map(x => x.id));
    const enclosingBuilding = (place: string | undefined) => {let out: string | null = null; for (let p = place ? this.places.byId.get(place) : undefined; p; p = p.parent ? this.places.byId.get(p.parent) : undefined) if (p.enclosed && (p.level ?? 0) === 0) out = p.id; return out;};
    const level = me.human?.level ?? 0, h = me.human;
    return {me: here, level, seated: !!h && (h.activity === 'sit' || h.baseActivity === 'sit'),
      // read only against standing-room thresholds (≤ 0.95 m): capped at 1 m, answered without building far nav tiles (L1)
      clearance: (x: number, z: number) => level === 0 && engine.clearanceAtV1 ? (engine.clearanceUpToV1 ? engine.clearanceUpToV1(x, z, 1) : engine.clearanceAtV1(x, z)) : 0,
      open: (at: [number, number], min: number, rings: number) => level === 0 && engine.nearestStandableV1 ? engine.nearestStandableV1(at, soul.entityId, min, rings) : null,
      // (claims are covered by the menu key's cell versions; the bodies part is recorded for the kept-menu check)
      taken: (at: [number, number], spotId?: string) => {const v = others.some(o => Math.hypot(o[0] - at[0], o[1] - at[1]) < 0.7); this.menuReads?.taken.push({at: [at[0], at[1]], v}); return v || (!!spotId && claimed.has(spotId));},
      // a spot inside a building is offered only when that building's interior was admitted (its walls are a shell, nav/1)
      enterable: (place: string | undefined) => {const b = enclosingBuilding(place); return !b || !!w.regions[b] || !!this.placeWalkable?.(b) || [...navIds].some(id => id.startsWith('nav-solid:' + b + '#w'));},
      seat: (radius: number, near?: boolean) => {
        const free = caps.filter(c => c.verb === 'sit' && c.available && c.target && c.id !== 'sit:here').map(c => {const e = w.entities[(this.host.kernel.things[c.target!.id]?.traits.entity as string | undefined) ?? c.target!.id]; return e && (!near || this.seatIsHere(soul.entityId, e.pose.p)) ? {c, d: Math.hypot(e.pose.p[0] - here[0], e.pose.p[2] - here[1])} : null;}).filter((x): x is {c: EdgeCapability; d: number} => !!x && x.d <= radius).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
        const pick = free[0]; return pick && plans.get(pick.c.id) ? {cap: pick.c, plan: plans.get(pick.c.id)!, distance: pick.d} : null;
      },
      // READ-DISPLACEMENT: the innermost room (enclosed or `room` place) holding a point, for a free-goal browse walk
      room: (at: [number, number], lv: number) => this.places?.containing?.(at[0], at[1], lv)?.find(p => p.parent !== null && !p.carrier && (p.enclosed || p.kind === 'room'))?.polygon ?? null,
      // an installed upper-floor room/lobby is a world region the place data predates: name it by its label, never its id
      placeName: (id: string | undefined) => id ? this.places.byId.get(id)?.name ?? w.regions[id]?.label ?? null : null,
      ancestors: (id: string) => {const out: string[] = []; for (let p = this.places.byId.get(id); p?.parent; p = this.places.byId.get(p.parent)) {const q = this.places.byId.get(p.parent); if (q && (q.enclosed || q.kind === 'building')) out.push(q.id);} return out;},
      groupSize: (group: string) => {const n = humans.filter(e => e.kind === 'human' && e.human?.together?.group === group).length; this.menuReads?.groups.set(group, n); return n;},
      clock: this.host.living ? (({hour, minute}) => ({hour, minute}))(clockAt(w.tick, this.host.living.origin, this.host.living.dayTicks)) : null,
    };
  }

  /** todo (leisure): a bicycle ride from the nearest dock (within 120 m): fetch a bicycle, ride the legs at the cycling gait,
   *  ride back and dock it. The docks share one fleet: when every bicycle is out the ride is offered but blocked. */
  private bikeRide(soul: EdgeSoul, me: NonNullable<ReturnType<EdgeLedger['body']>>, caps: EdgeCapability[], plans: Map<string, {label: string; steps: Program['steps']; seconds?: boolean}>, id: string, verb: string, target: string, what: string, legs: Program['steps'], out: () => number) {
    const here: [number, number] = [me.pose.p[0], me.pose.p[2]], docks = (this.spots.docks ?? []).map(k => ({k, d: Math.hypot(k.at[0] - here[0], k.at[1] - here[1])})).filter(x => x.d <= 120).sort((a, b) => a.d - b.d || a.k.id.localeCompare(b.k.id));
    const dock = docks[0]?.k; if (!dock || !legs.length) return;
    // one shared fleet: every open ride of another Soul holds one bicycle out of the world's docks
    const fleet = (this.spots.docks ?? []).reduce((n, k) => n + k.bikes, 0), left = Math.max(0, Math.min(dock.bikes, fleet - out()));
    const label = `${what} (a bicycle from ${dock.label ?? dock.id}, ${Math.round(docks[0].d)} m away; ${left} of ${dock.bikes} there; 4.5 m/s on dry ground, returned to the dock after)`;
    caps.push({id, verb, label, available: left > 0, ...(left > 0 ? {} : {blocked: {code: 'bike.none-left', reason: `All ${dock.bikes} bicycles of ${dock.label ?? dock.id} are out; ask again when one is back.`}}), target: {id: target, kind: 'place'}});
    const face = dock.faceTo ? {face: dock.faceTo} : {};
    plans.set(id, {label: what, steps: [
      ...(me.human && (me.human.activity === 'sit' || me.human.baseActivity === 'sit') ? [{verb: 'stand', params: {}}] : []),
      {verb: 'walk_to', params: {to: dock.at, standoff: 0}}, {verb: 'mars:pose_v1', params: {activity: 'pick-up', seconds: 2, ...face}},
      ...legs,
      {verb: 'walk_to', params: {to: dock.at, gait: 'cycle', standoff: 0}}, {verb: 'mars:pose_v1', params: {activity: 'put-down', seconds: 2, ...face}}]});
  }
  /** CN5: a choreographed game this body is playing, in names (who is playing, whose turn, ends won at pétanque). */
  private gameView(b: ReturnType<EdgeLedger['body']> | undefined): {game?: unknown} {
    const g = b?.human?.game; if (!g) return {};
    const name = (id: string | null | undefined) => id ? this.host.mindByEntity?.get(id)?.name ?? [...this.host.minds.values()].find(m => m.entityId === id)?.name ?? id : null;
    return {game: {kind: g.kind, players: g.players.map(name), ...(g.waiting ? {waiting: 'for someone to join'} : {turn: g.turn, throwing: name(g.from), to: g.to ? name(g.to) : null}),
      ...(g.kind === 'petanque' ? {end: g.end ?? 0, lastEndWonBy: name(g.lastWinner), boulesThisEnd: g.boules?.length ?? 0} : {}), myWins: g.wins ?? 0, untrusted: true}};
  }
  /** #824: a refusal for "nothing matches" names what this Soul can do here and now instead: at most ALTERNATIVES
   *  available offers, never a catalog and never a repeat of did_you_mean. First the offered walk to a place its own words
   *  name ("fly up to the field" -> walk:field, one bindOne), then the nearest available offers of the menu the refusal
   *  already read (one per verb). Nothing available: no field. */
  /** CTRL-3 (#1095): what serves the same intent with a different binding, at most 3, nearest first within that class: never
   *  a different verb, never a different destination, never the refused act. Information for the agent, never a default. */
  private withAlternatives<T extends {code: string; reason: string; did_you_mean?: {id: string; label: string}[]}>(soul: EdgeSoul, words: string, out: T, caps: EdgeCapability[]): T & {alternatives?: Alternative[]} {
    const asked = words.trim(), seen = new Set([asked, ...(out.did_you_mean ?? []).map(d => d.id)]), picks: {c: EdgeCapability; why: string; partial?: true}[] = [];
    const add = (c: EdgeCapability | undefined, why: string, partial?: boolean) => {if (c?.available && !seen.has(c.id) && picks.length < ALTERNATIVES * 2) {seen.add(c.id); picks.push({c, why, ...(partial ? {partial: true as const} : {})});}};
    const ctx = this.vocabulary(soul, caps), w = tokens(words), head = (asked.includes(':') ? asked.slice(0, asked.indexOf(':')) : w[0] ?? '').toLowerCase();
    const verb = SIT_WORDS.has(head) ? 'sit' : WALK_WORDS.has(head) ? 'walk' : head;
    const near = (c: EdgeCapability) => {if (c.id.endsWith(':here')) return -1; const at = ctx.target(c).at ?? ctx.me; return at && ctx.me ? Math.hypot(at[0] - ctx.me[0], at[1] - ctx.me[1]) : Infinity;};
    const nearest = (list: EdgeCapability[]) => list.map((c, i) => [c, near(c), i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
    // the place its words end on ("fly up to the field": the field) by its own name or id words (tier <= 1), the last few
    // words only, longest first
    let named: string[] | undefined, place: Place | undefined;
    for (let i = Math.max(1, w.length - 4); i < w.length && !named; i++) {const m = placeMatchTier(w.slice(i), ctx.places, ctx.withheld); if (m.tier >= 0 && m.tier <= 1 && m.found.length) {named = w.slice(i); place = this.places.byId.get(m.found[0]!.id);}}
    const menu = (wanted: string) => caps.some(c => c.verb === wanted && c.id !== asked) ? caps : this.wordsMenu(soul).caps;
    if (verb !== 'sit' && named) {
      // the walk those words resolve to, as `walk <words>` would (a named region's walk is often its building's: "the pond
      // hall" is walk:lab-pond-hall). Walking is only part of "fly there".
      const r = resolveCapability(`walk:${named.join(' ')}`, caps.some(c => c.verb === 'walk') ? ctx : this.vocabulary(soul, this.wordsMenu(soul).caps));
      if (r.kind !== 'unknown' && r.cap.verb === 'walk') add(r.cap, `walks to ${named.join(' ')}`, verb !== 'walk');
      // that walk is what was refused: somewhere inside or beside the same place, which only partly serves
      if (place && !picks.length) {
        const beside = menu('walk').filter(c => c.verb === 'walk' && c.target?.kind === 'place' && c.target.id !== place!.id && (this.places.byId.get(c.target.id)?.parent === place!.id || c.target.id === place!.parent));
        for (const c of nearest(beside)) add(c, `inside or beside ${place.name}`, true);
      }
    } else if (verb) {
      // the same act on something else in this room or place
      const room = this.placePathOf(soul.soulId).find(p => p.kind !== 'occupier')?.id ?? null;
      const here = (c: EdgeCapability) => {if (c.id.endsWith(':here')) return true; const at = ctx.target(c).at; return !!at && (!room || this.places.containing(at[0], at[1]).some(p => p.id === room));};
      for (const c of nearest(menu(verb).filter(c => c.verb === verb && here(c)))) add(c, verb === 'sit' ? 'another free seat here' : `${verb} on something else here`);
    }
    // the menu read may be a kept words menu (approximate availability), and the named walk may come from it: every pick
    // is rebuilt exactly (bindOne) and kept only if it is available now
    const alt = picks.map(p => ({...p, c: this.bindOne(soul, p.c.id)?.cap})).filter((p): p is typeof p & {c: EdgeCapability} => !!p.c?.available).slice(0, ALTERNATIVES).map(({c, why, partial}) => ({id: c.id, label: c.label, why, ...(partial ? {partial} : {})}));
    return alt.length ? {...out, alternatives: alt} : out;
  }
  /** R2 stroll (longrun 2026-10-16): a construction refusal names what the Soul can do where it stands instead (wander
   *  here), in the reason and first in did_you_mean, so a closed site never leaves it standing still. */
  private withInPlaceAlternative<T extends {code: string; reason: string; did_you_mean?: {id: string; label: string}[]}>(soul: EdgeSoul, out: T): T {
    if (out.code !== 'site.under-construction') return out;
    const wander = [this.bindOne(soul, 'wander:here')?.cap].find(c => c?.available); if (!wander || out.reason.includes(wander.id)) return out;
    const place = this.placePathOf(soul.soulId).find(p => p.kind !== 'occupier' && this.places.byId.get(p.id)?.parent != null);
    const where = !place ? 'around here' : /^the |'s\b/i.test(place.name) ? place.name : `the ${place.name}`;
    return {...out, reason: `${out.reason.replace(/[.\s]+$/, '')}; to stroll here instead, explore ${where} (${wander.id}).`, did_you_mean: [{id: wander.id, label: wander.label}, ...(out.did_you_mean ?? []).filter(d => d.id !== wander.id)]};
  }
  /** D3d (owner-loop.ts): what an owner message step's target words name for this Soul. Souls by name; the rest through
   *  the walk resolver (`walk:<words>`: a place, a thing, a Soul), or the named place a walk cannot reach yet. Null: the
   *  words name nothing the world knows. */
  stepTarget(soul: EdgeSoul, words: string[]): {places: string[]; things: string[]; souls: string[]} | null {
    const souls: string[] = [], used = new Set<string>();
    for (const m of this.host.minds.values()) {const n = tokens(m.name); if (m.soulId !== soul.soulId && n.length && n.every(w => words.includes(w))) {souls.push(m.soulId); n.forEach(w => used.add(w));}}
    const rest = words.filter(w => !used.has(w)), out = {places: [] as string[], things: [] as string[], souls};
    if (rest.length) {
      const ctx = this.vocabulary(soul, this.binds(soul).caps), r = resolveCapability(`walk:${rest.join(' ')}`, ctx), t = r.kind !== 'unknown' ? r.cap.target : undefined;
      if (r.kind === 'alias' && r.inside) out.places.push(r.inside);
      else if (t) (t.kind === 'place' ? out.places : t.kind === 'soul' ? out.souls : out.things).push(t.id);
      else if (r.kind === 'unknown' && r.place) out.places.push(r.place);
      // every place these words name by its own name counts too ("the pavilion": any pavilion, not only the one the walk picked)
      const named = placeMatchTier(rest, ctx.places, ctx.withheld); if (named.tier >= 0 && named.tier <= 1) for (const p of named.found) if (!out.places.includes(p.id)) out.places.push(p.id);
      if (!out.places.length && !out.things.length) return null;   // words that name nothing the world knows, even beside a Soul's name
    }
    return souls.length || out.places.length || out.things.length ? out : null;
  }
  /** D3d: the id an offered capability's target has (walk:commons-pavilion points at a place with another id), else null. */
  actTarget(soul: EdgeSoul, capability: string): string | null {return this.bindOne(soul, capability)?.cap.target?.id ?? null;}
  /** D3d: a place id with its ancestors (innermost first), or null when it names no place. */
  placeAncestry(id: string): string[] | null {
    const out: string[] = []; for (let p = this.places.byId.get(id); p && out.length < 30; p = p.parent ? this.places.byId.get(p.parent) : undefined) out.push(p.id);
    return out.length ? out : null;
  }
  /** D3d: where a Soul, engine body, kernel thing, activity spot or named thing (nav: the festival balloon) stands now. */
  positionOf(id: string): [number, number] | null {
    const w = this.mw.world as NativeWorld, m = this.host.minds.get(id), e = m ? this.body(m.entityId) : w.entities[(this.host.kernel.things[id]?.traits.entity as string | undefined) ?? id];
    if (e) return [e.pose.p[0], e.pose.p[2]];
    const sp = this.spots.spots.find(x => x.id === id); return sp ? [sp.at[0], sp.at[1]] : this.thingAt?.(id) ?? null;
  }
  /** What each capability answers to, for PM-R057 natural names (built only when an id is not exact). */
  private vocabulary(soul: EdgeSoul, caps: EdgeCapability[]): VocabContext {
    // R2 stroll: where the Soul stands (its place path), so a stroll of that place can wander in place when its loop is closed
    return Object.assign(this.vocabularyOf(soul, caps), {here: this.placePathOf(soul.soulId).filter(p => p.kind !== 'occupier').map(p => p.id)});
  }
  /** L3 (b): the places a Soul's words can name (VocabPlace objects, never written after they are built, so the vocabulary's
   *  per-place word cache holds), kept while the places, the god's world, the static world and what this Soul knows of
   *  secret places do not change (with no secret place, one listing serves every Soul). */
  private vocabPlaces(soul: EdgeSoul): {root: string[]; known: Place[]; withheld: string[]; places: VocabContext['places']} {
    const marked = this.knowledge.marked().size, knowSig = marked ? `${soul.soulId}:${this.knowledge.version}:${this.knowledge.memory(soul.soulId).size}` : '*';
    const key = `${this.staticVersion()}|${this.menuInputs()}|${knowSig}`, hit = this.vocabPlaceMemo.get(knowSig);
    if (hit && hit.key === key) return hit.value;
    const w = this.mw.world as NativeWorld, all = [...this.places.byId.values()], rootPlace = all.find(p => p.parent === null);
    const aliases = bootAliases(this);
    // knowledge/1: a secret place this Soul does not know is no name to resolve (nor a "contains it" fallback naming it)
    const known: Place[] = [], withheld: string[] = [];
    for (const p of all) if (p.parent !== null) {if (this.knowledge.knows(soul.soulId, p.id)) known.push(p); else withheld.push(tokens(p.name).join(' '), tokens(p.id).join(' '));}
    const places = known.map(p => ({id: p.id, ref:p.ref, name: p.name, aliases: [...new Set([...(aliases[p.id] ?? []),...(p.aliases??[])])], genericAliases:p.genericAliases, center: centroid(p.polygon), polygon:p.polygon, level:p.level, parent: p.semanticParent === undefined ? p.parent : p.semanticParent, kind: p.kind, description: p.description, walkable: !!(w.regions as Record<string, unknown>)[p.id] || !!this.placeWalkable?.(p.id)}));
    const value = {root: rootPlace ? [...tokens(rootPlace.id), ...tokens(rootPlace.name)] : [], known, withheld, places};
    this.vocabPlaceMemo.set(knowSig, {key, value}); if (this.vocabPlaceMemo.size > 64) this.vocabPlaceMemo.delete(this.vocabPlaceMemo.keys().next().value!);
    return value;
  }
  private vocabPlaceMemo = new Map<string, {key: string; value: {root: string[]; known: Place[]; withheld: string[]; places: VocabContext['places']}}>();
  private vocabularyOf(soul: EdgeSoul, caps: EdgeCapability[]): VocabContext {
    const w = this.mw.world as NativeWorld, me = this.body(soul.entityId);
    const {root, known, withheld, places} = this.vocabPlaces(soul);
    // (L3 c: an object offer's place from what the providers built; every object's row is read only for one they did not)
    let objects: Map<string, {placeId: string}> | null = null;
    const objectPlace = (id: string) => this.objectPlaces.get(id) ?? (objects ??= new Map((this.comms?.objects.all() ?? []).map(o => [o.id, o]))).get(id)?.placeId;
    const around = (x: number, z: number) => {const p = this.places.containing(x, z, 0).find(q => q.parent !== null); return p ? [p.id, p.name] : [];};
    const here: [number, number] | null = me ? [me.pose.p[0], me.pose.p[2]] : null;
    // r3 quality (23/29): the nearest spot (or bicycle dock) for a spot-based verb anywhere in this world, beyond offer reach
    const elsewhere = (verb: string) => {
      // E-life: a ferris wheel or carousel ride (a native car at it) anywhere in this world, for "ride the ferris wheel"
      const rideMarks = verb === 'ride-attraction' ? this.carriersNative().filter(c => /ferris|carousel/i.test(c.id)).map(c => ({at: [c.pose.p[0], c.pose.p[2]] as [number, number], label: c.label, place: undefined as string | undefined}))
        : verb === 'punt' ? this.carriersNative().filter(c => c.def === 'rowing-punt').map(c => ({at: [c.pose.p[0], c.pose.p[2]] as [number, number], label: c.label, place: undefined as string | undefined})) : null;
      if (rideMarks && !rideMarks.length) return verb === 'punt' ? null : undefined;
      const marks = rideMarks ?? (verb === 'cycle' ? (this.spots.docks ?? []).map(k => ({at: k.at, label: k.label ?? 'a bicycle dock', place: k.place}))
        // VERBS: ducks or swans to feed (a feed spot whose title or label names birds), for "feed the ducks"
        : verb === 'feed-birds' ? this.spots.spots.filter(x => x.activity === 'feed' && /\b(?:ducks?|swans?|geese|goose|birds?)\b/i.test(`${x.title ?? ''} ${x.label ?? ''}`)).map(x => ({at: x.at, label: x.label ?? 'a duck-feeding bank', place: x.place}))
        : verb in SPOT_ACTIVITIES ? this.spots.spots.filter(x => x.activity === verb || x.also?.includes(verb)).map(x => ({at: x.at, label: x.label ?? `a ${verb} spot`, place: x.place, ...(x.activity === verb && x.paintingTarget && x.title ? {title: x.title} : {})})) : undefined);
      if (!marks) return undefined;
      const best = marks.map(m => {const placeId = m.place ?? around(m.at[0], m.at[1])[0], pl = placeId ? this.places.byId.get(placeId) : undefined;
        return {label: m.label, ...('title' in m && m.title ? {title: m.title as string} : {}), at: m.at, distance: here ? Math.hypot(m.at[0] - here[0], m.at[1] - here[1]) : 0, ...(pl && known.includes(pl) ? {place: pl.name, placeId: pl.id} : {})};})
        .sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label))[0];
      if (!best) return null;
      // entry 36: who is singing at the nearest mic (a sing spot is one singer's), for a polite refusal that names them
      const {at, ...out} = best;
      if (verb === 'sing') for (const e of Object.values(w.entities)) if (e.kind === 'human' && e.id !== me?.id && e.human?.activity === 'sing' && Math.hypot(e.pose.p[0] - at[0], e.pose.p[2] - at[1]) < 0.7) {const n = this.host.mindByEntity?.get(e.id)?.name; if (n) return {...out, by: n};}
      return out;
    };
    // ROUTE-RECHECK: places with a reading spot in them (the spot's place and every place round it), from the world's spots
    const spotPlaces = new Map<string, Set<string>>(), hasSpot = (verb: string, placeId: string) => {
      let set = spotPlaces.get(verb);
      if (!set) {set = new Set(); for (const s of this.spots.spots) if (s.place && (s.activity === verb || s.also?.includes(verb))) for (let p: string | undefined = s.place, n = 0; p && n < 20; p = this.places.byId.get(p)?.parent ?? undefined, n++) set.add(p); spotPlaces.set(verb, set);}
      return set.has(placeId);
    };
    return {caps, me: here, ...(me ? {yaw:me.pose.yaw, holds: (id: string) => {const su = (w.entities as Record<string, {support?: {kind: string; by?: string}}>)[id]?.support; return su?.kind === 'in-hand' && su.by === me.id;}} : {}), root, elsewhere, hasSpot, withheld: [...withheld], places: [...places],
      target: c => {
        const t = c.target; if (!t) return {names: [], around: [], at: null};
        if (t.kind === 'spot') {
          // CN5: a game's extra place `<spot>.pN` answers to its spot; a spot answers to its instrument too
          const sp = this.spots.spots.find(x => x.id === t.id) ?? this.spots.spots.find(x => x.id === t.id.replace(/\.p\d+$/, '')), pl = sp?.place ? this.places.byId.get(sp.place) : undefined;
          return {names: [...(sp?.label ? [sp.label] : []), ...(sp?.instrument ? [sp.instrument] : [])], around: pl ? [pl.id, pl.name] : [], at: sp ? sp.at : null};
        }
        if (t.kind === 'soul') {const m = this.host.minds.get(t.id), e = m ? this.body(m.entityId) : undefined; return {names: m ? [m.name] : [], around: [], at: e ? [e.pose.p[0], e.pose.p[2]] : null};}
        const place = this.places.byId.get(t.id); if (place) return {names: [place.name,place.kind,...(place.semanticKind?[place.semanticKind]:[]),...(place.aliases??[])], around: [], at: centroid(place.polygon)};
        const e = w.entities[t.id]; if (e) return {names: [], around: around(e.pose.p[0], e.pose.p[2]), at: [e.pose.p[0], e.pose.p[2]]};
        const opl = objectPlace(t.id), op = opl ? this.places.byId.get(opl) : undefined; if (op) return {names: [], around: [op.id, op.name], at: centroid(op.polygon)};
        // RESOLVE: a named thing that is no engine body (a horse, a duck: decor), where nav says it stands
        const nt = this.thingAt?.(t.id); if (nt) return {names: [], around: around(nt[0], nt[1]), at: nt};
        const r = (w.regions as Record<string, {polygon: [number, number][]}> | undefined)?.[t.id]; return {names: [], around: [], at: r ? centroid(r.polygon) : null};
      }};
  }

  // ---------------------------------------------------------------- perception
  private mind(soul: EdgeSoul): Mind {const m = this.host.minds.get(soul.soulId); if (!m) throw new EdgeError(404, 'not-found', 'this Soul has no body in the world'); return m;}
  /** B-facade: every read reaches the world through this facade (split/menu-world.ts); act/tick code keeps the engine. */
  get mw(): MenuWorld {return menuWorldOf(this.host);}
  private body(entityId: string) {return (this.mw.world as NativeWorld).entities[entityId];}
  /** beds/1: the body lies on a bed's berth (a live take_slot held lying or asleep). */
  private lyingOnBerth(entityId: string): boolean {
    const live = new Set(this.mw.runtime.liveIds());
    for (const r of this.mw.runtime.records.values()) {const p = r.params as Record<string, unknown>; if (live.has(r.id) && r.verb === 'take_slot' && p.actor === entityId && (p.activity === 'lie' || p.activity === 'nap')) return true;}
    return false;
  }
  private seatOf(entityId: string): string | null {
    const live = new Set(this.mw.runtime.liveIds());
    for (const r of this.mw.runtime.records.values()) {const p = r.params as Record<string, unknown>; if (live.has(r.id) && r.verb === 'sit' && p.actor === entityId && typeof p.slot === 'string') return p.slot;}
    return null;
  }
  placePathOf(soulId: string): PlaceRef[] {
    const m = this.host.minds.get(soulId); if (!m) return [];
    const b = this.body(m.entityId); if (!b) return [];
    const path = this.places.containing(b.pose.p[0], b.pose.p[2], this.placeLevel(b.human?.level)).map(p => this.places.ref(p));
    const ride = this.aboard(m.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined;
    if (basket) {const occ = this.places.occupierOf.get(ride!.id + '#' + ride!.slot); return [...(occ ? [{id: occ.occ.id, name: `${basket.name} (${ride!.slot})`, kind: 'occupier'}] : []), this.places.ref(basket), ...path];}
    const seat = this.seatOf(m.entityId), occ = seat ? this.places.occupierOf.get(seat) : undefined;
    return occ ? [{id: occ.occ.id, name: `${occ.place.name} seat`, kind: 'occupier'}, ...path] : path;
  }
  private innermostPlace(m: Mind): string | null {const b = this.body(m.entityId); if (!b) return null; const ride = this.aboard(m.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined; if (basket) return basket.id; return this.places.containing(b.pose.p[0], b.pose.p[2], this.placeLevel(b.human?.level))[0]?.id ?? null;}
  /** D2 ("sit down" means here): a seat at `seat` ([x, y, z]) is here for this body when it stands in the body's own
   *  room (the innermost place, enclosed) on its floor, or within HERE_SEAT_M with the same enclosure (none outdoors)
   *  on both sides. Named seats ("sit on the bench") keep their own reach. */
  seatIsHere(entityId: string, seat: readonly number[]): boolean {
    const b = this.body(entityId); if (!b || this.aboard(entityId)) return false;
    if (Math.abs((seat[1] ?? 0) - b.pose.p[1]) > 1.5) return false;
    const level = this.placeLevel(b.human?.level), mine = this.places.containing(b.pose.p[0], b.pose.p[2], level)[0], its = this.places.containing(seat[0], seat[2], level)[0];
    if (mine?.enclosed && its?.id === mine.id) return true;
    return Math.hypot(seat[0] - b.pose.p[0], seat[2] - b.pose.p[2]) <= HERE_SEAT_M && this.enclosureAtPoint(seat[0], seat[2], level) === this.enclosureAtPoint(b.pose.p[0], b.pose.p[2], level);
  }
  enclosureOf(soulId: string): string | null {
    const m = this.host.minds.get(soulId), b = m ? this.body(m.entityId) : undefined; if (!b) return null;
    const ride = this.aboard(m!.entityId), basket = ride ? this.places.carrierPlaces.get(ride.id) : undefined;
    if (basket?.enclosed) return basket.id;
    return this.enclosureAtPoint(b.pose.p[0],b.pose.p[2],this.placeLevel(b.human?.level));
  }
  /** The place-data floor number of an engine level (upper-floors/1: a building's upper floor reports its authored floor). */
  placeLevel(level: number | undefined): number {const l = level ?? 0; return l < 2 ? l : (this.mw as unknown as {placeLevelV1?: (l: number) => number}).placeLevelV1?.(l) ?? l;}
  /** Logical property polygons can include balconies; privacy follows the validated actual room shell. */
  enclosureAtPoint(x:number,z:number,level=0):string|null{return this.places.containing(x,z,level).find(p=>p.enclosed&&inPoly(x,z,this.enclosurePolygon(p)))?.id??null;}
  private enclosurePolygon(p:Place){const interior=this.spots.interiors.find(i=>i.place===p.id);return interior?interiorShellPolygon(p,interior)??p.polygon:p.polygon;}
  enclosurePlaces(){return [...this.places.byId.values()].map(p=>p.enclosed?{...p,polygon:this.enclosurePolygon(p)}:p);}
  perceivedBodies(soulId: string, radius: number): NearbyBody[] {
    const me = this.host.minds.get(soulId), mb = me ? this.body(me.entityId) : undefined; if (!me || !mb) return [];
    const myEnc = this.enclosureOf(soulId), out: NearbyBody[] = [];
    for (const o of this.host.minds.values()) {
      if (o.soulId === soulId || this.faded.has(o.soulId)) continue; const ob = this.body(o.entityId); if (!ob) continue;
      const d = Math.hypot(ob.pose.p[0] - mb.pose.p[0], ob.pose.p[2] - mb.pose.p[2]); if (d > radius) continue;
      if (this.enclosureOf(o.soulId) !== myEnc) continue;      // enclosure rule: same enclosure, or both outdoors
      out.push({soulId: o.soulId, entityId: o.entityId, name: o.name, distance: Math.round(d * 10) / 10, placeId: this.innermostPlace(o) ?? '', state: stateOf(this.host, o.entityId), activity: String(ob.human?.activity ?? 'idle')});
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
  /** EVENTS-v1: position and heading of a Soul's body (null when it has none or faded). */
  poseOf(soulId: string): {x: number; z: number; yaw: number} | null {
    const m = this.host.minds.get(soulId), b = m && !this.faded.has(soulId) ? this.body(m.entityId) : undefined;
    return b ? {x: b.pose.p[0], z: b.pose.p[2], yaw: b.pose.yaw} : null;
  }
  /** EVENTS-v1 fade-by-abandonment: an activity in progress (open receipt with its programme running), a ride, or a resting
   *  posture (seated, lying, sleeping, swimming) the Soul's own latest act chose and ambient life has not changed since. */
  postureHold(soulId: string): string | null {
    const m = this.host.minds.get(soulId); if (!m || this.faded.has(soulId) || !this.body(m.entityId)) return null;
    const program = this.mw.programOf(m.entityId), open = this.openReceipts(soulId);
    const running = open.find(r => r.phase === 'started' && r.programId && r.programId === program);
    if (running) return 'activity ' + running.capability;
    // PC09 (#688): a running shared carry holds every member, the borrowed guest too (the host's programme moves its body)
    const shared = open.find(r => r.phase === 'started' && this.together.sharedBusyFor(r));
    if (shared) return 'shared ' + shared.capability;
    if (open.some(r => r.phase === 'waiting')) return 'starting ' + open[0]!.capability;
    if (this.aboard(m.entityId)) return 'riding';
    const state = stateOf(this.host, m.entityId);
    if (!['seated', 'lying', 'sleeping', 'swimming'].includes(state)) return null;
    // the latest act that moved the body (lasting marks, object moves and answers leave the body as it was)
    const last = this.rows('soul_id=? ORDER BY created_at DESC LIMIT 8', soulId).find(r => {const v = r.capability.split(':')[0]!; return !['make', 'decline', 'ask-to-stop'].includes(v) && !(v === 'object' && r.program_id === null);});
    if (!last || last.phase === 'failed' || (this.ambientAt.get(soulId) ?? 0) > last.created_at) return null;
    return POSTURE_VERBS.has(last.capability.split(':')[0]!) ? state : null;
  }
  /** Last ambient-life decision per Soul (ms): a posture ambient life chose is not the Soul's own choice. */
  private ambientAt = new Map<string, number>();
  onReceipt(l: (r: EdgeReceipt) => void) {this.receiptListeners.push(l);}
  onPlaceChange(l: (e: {soulId: string; from: string | null; to: string | null; tick: number}) => void) {this.placeListeners.push(l);}

  /** G430 public per-Soul page: no owner data, conversation turns, overheard speech or tokens. */
  publicSoul(soulId: string) {
    const row = this.db.soul(soulId) as {id: string; name?: string; description?: string; world_id: string; retired_at: number | null} | undefined;
    if (!row || row.world_id !== this.host.worldId || row.retired_at !== null) throw new EdgeError(404, 'not-found', 'no such Soul');
    const m = this.host.minds.get(soulId), receipts = this.rows('soul_id=? ORDER BY created_at DESC LIMIT 10', soulId).map(r => this.view(r)).map(({programId: _p,outcome:_outcome, ...r}) => r);
    const last = this.db.db.prepare('SELECT MAX(created_at) at FROM edge_receipts_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId, soulId) as {at: number | null};
    const has = (t: string) => !!this.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    const events: {tick: number; at: number; kind: string; [k: string]: unknown}[] = [];
    if (has('edge_comms_stream')) for (const e of this.db.db.prepare("SELECT tick,at,kind,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? AND kind IN ('arrival','departure','world') ORDER BY seq DESC LIMIT 30").all(this.host.worldId, soulId) as {tick: number; at: number; kind: string; body: string}[]) events.push({tick: e.tick, at: e.at, kind: e.kind, ...JSON.parse(e.body)});
    if (has('edge_comms_speech')) for (const e of this.db.db.prepare('SELECT tick,at,channel,text FROM edge_comms_speech WHERE world_id=? AND soul_id=? ORDER BY tick DESC LIMIT 30').all(this.host.worldId, soulId) as {tick: number; at: number; channel: string; text: string}[]) events.push({tick: e.tick, at: e.at, kind: 'speech', channel: JSON.parse(e.channel), text: e.text, untrusted: true});
    events.sort((a, b) => b.tick - a.tick);
    return {soul: {soulId, name: row.name ?? m?.name ?? soulId, description: row.description ?? null, untrusted: true}, fade: this.comms?.fading.status(soulId) ?? null, now: this.host.nowOf(soulId), body: this.bodyRule?.view(soulId) ?? null, lastAcceptedAt: last.at,
      self: m ? {placePath: this.placePathOf(soulId), state: stateOf(this.host, m.entityId), activity: String(this.body(m.entityId)?.human?.activity ?? 'idle'), bodyState: this.bodyOf(soulId), doing: this.host.doingOfV1(m)} : null, receipts, events: events.slice(0, 30)};
  }
  map() {this.beforeMap?.(); const regions = (this.mw.world as NativeWorld).regions ?? {}; return [...this.places.byId.values()].filter(p => !this.knowledge.isSecret(p.id)).map(p => ({id: p.id, name: p.name, ...(p.ref ? {ref:p.ref} : {}), kind: p.kind, enclosed: p.enclosed, capacity: p.capacity, parent: p.parent, walkable: p.id in regions || !!this.placeWalkable?.(p.id), center: (p.carrier ? (() => {const e = (this.mw.world as NativeWorld).entities[p.carrier!.entity]; return e ? [e.pose.p[0], e.pose.p[2]] : [0, 0];})() : centroid(p.polygon)).map(v => Math.round(v * 10) / 10), ...(p.carrier ? {carrier: p.carrier.entity} : {}), starting: p.starting, ...(p.description ? {description: p.description} : {}), ...(p.worldAbout ? {worldAbout:p.worldAbout} : {}), ...(p.aliases?.length ? {aliases:p.aliases} : {}), ...(p.semanticParent !== undefined ? {semanticParent:p.semanticParent} : {}), ...(p.semanticKind ? {semanticKind:p.semanticKind} : {}), ...(p.semanticRole ? {semanticRole:p.semanticRole} : {}), ...(p.salience !== undefined ? {salience:p.salience} : {}), ...(p.parts?.length ? {parts:p.parts} : {}), schedule: (p.schedule ?? []).map(s => ({id: s.id, cron: s.cron, durationMinutes: s.durationMinutes ?? null, ticketed: !!s.ticketed, label: s.label ?? null}))}));}

  /** srv-act-words (E): the ids of map()'s walkable places, in its order, without building its rows (a body act's terminal
   *  snapshot reads only these; map() built every place's row, ~2.5 ms on Eden 2026). Same beforeMap sync as map(). */
  walkablePlaceIdsV1(): string[] {this.beforeMap?.(); const regions = (this.mw.world as NativeWorld).regions ?? {}, out: string[] = []; for (const p of this.places.byId.values()) if (!this.knowledge.isSecret(p.id) && (p.id in regions || !!this.placeWalkable?.(p.id))) out.push(p.id); return out;}

  /** PM-R055: happening (with walk capability) and a few inviting places elsewhere. Counts only, never identities;
   *  project titles are listed objects (untrusted), marks are counted. Deterministic for a given world state. */
  private spread(soul: EdgeSoul, me: [number, number] | null, minuteOfDay: number | null) {
    const caps = this.capabilities(soul), walk = new Map(caps.filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place').map(c => [c.target!.id, c]));
    const happening = (minuteOfDay === null ? [] : happenings(this.places.byId.values(), minuteOfDay, me)).map(h => ({...h, ...(walk.has(h.placeId) ? {capability: walk.get(h.placeId)!.id} : {})}));
    const here = new Set(this.placePathOf(soul.soulId).map(p => p.id)), souls = new Map<string, number>();
    for (const m of this.host.minds.values()) {
      if (m.soulId === soul.soulId || this.faded.has(m.soulId)) continue; const ob = this.body(m.entityId); if (!ob) continue;
      for (const p of this.places.containing(ob.pose.p[0], ob.pose.p[2], this.placeLevel(ob.human?.level))) souls.set(p.id, (souls.get(p.id) ?? 0) + 1);
    }
    const marks = new Map<string, number>(), projects = new Map<string, string[]>();
    for (const o of this.comms?.objects.all() ?? []) {
      const st = o.state as {removed?: boolean; status?: string; title?: string};
      if (o.kind === 'mark' && !st.removed) marks.set(o.placeId, (marks.get(o.placeId) ?? 0) + 1);
      if (o.kind === 'project' && st.status !== 'done' && st.title) projects.set(o.placeId, [...(projects.get(o.placeId) ?? []), st.title]);
    }
    const on = new Map(happening.map(h => [h.placeId, h]));
    const elsewhere = [...walk.entries()].flatMap(([id, cap]) => {
      const p = this.places.byId.get(id); if (!p || here.has(id) || p.parent === null || p.kind === 'sleeping-mat' || /(^|-)mat-\d+$/.test(id)) return [];   // personal sleeping spots are not invitations
      const [cx, cz] = centroid(p.polygon), d = me ? Math.hypot(cx - me[0], cz - me[1]) : 0; if (d > 150) return [];
      const n = souls.get(id) ?? 0, mk = marks.get(id) ?? 0, pj = projects.get(id) ?? [], h = on.get(id);
      const why = [...(h ? [h.now ? `${h.label} is on now` : `${h.label} in ${h.startsInMinutes} min`] : []), ...(n === 0 ? ['quiet: nobody there'] : []), ...(mk ? [`${mk} lasting mark${mk > 1 ? 's' : ''}`] : []), ...(pj.length ? [`${pj.length} open project${pj.length > 1 ? 's' : ''}`] : [])];
      const score = (h ? (h.now ? 6 : 2) : 0) + (n === 0 ? 3 : n === 1 ? 1 : -n) + Math.min(3, mk + pj.length) - d / 30;
      return [{score, item: {placeId: id, place: p.name, kind: p.kind, distance: Math.round(d), souls: n, why, capability: cap.id, ...(pj.length ? {projects: pj.slice(0, 2), untrusted: true} : {})}}];
    }).sort((a, b) => b.score - a.score || a.item.placeId.localeCompare(b.item.placeId)).slice(0, 4).map(x => x.item);
    return {happening, elsewhere};
  }

  /** G1: an accepted god edit interrupts the resident's current use and any queued retry. */
  godInterrupted(soulId: string, reason: string) {
    this.pending.delete(soulId); this.dropMenu('god-interrupted', soulId);
    for (const receipt of this.openReceipts(soulId)) this.update(receipt.id, {phase: 'failed', code: 'god.walkout', reason});
  }
  observe(soul: EdgeSoul, include: Set<string>) {
    const m = this.mind(soul), b = this.body(m.entityId), tick = this.mw.world.tick, day = this.host.living;
    const program = this.mw.programOf(m.entityId), action = program ? this.mw.programAction?.(program) : null;
    const c = day ? clockAt(tick, day.origin, day.dayTicks) : null;
    const spread = this.spread(soul, b ? [b.pose.p[0], b.pose.p[2]] : null, c ? c.hour * 60 + c.minute : null);
    // A neighbour idle 30+ min (yellow/red) may have no agent behind it: say so, so nobody waits on silence.
    const social = (() => {try {return this.together.observe(soul);} catch {return {holding: null, following: null, followedBy: [], invites: [], invited: [], items: []};}})();
    const awayOf = (id: string) => {const f = this.comms?.fading.status(id) as {colour: string; idleSeconds: number} | null | undefined; return f && (f.colour === 'yellow' || f.colour === 'red') ? {away: {idleMinutes: Math.floor(f.idleSeconds / 60), note: 'idle a long while; may not answer'}} : {};};
    const out: Record<string, unknown> = {
      tick, at: Date.now(),
      world: {id: this.host.worldId, ...(this.host.extra.continuousDayV1 ? {} : {quiet: this.host.quietBarrier}), ...(c ? {time: {day: c.day, phase: Math.round(c.phase * 1000) / 1000, label: timeLabel(c.phase), clock: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`}} : {})},
      // PM-R055 spread: reasons to go somewhere else, first. Scheduled place activities on now or soon (with the walk
      // that gets there), then a few other places nearby: quiet ones, ones with lasting marks/projects or something on.
      happening: spread.happening, elsewhere: spread.elsewhere,
      self: {soulId: soul.soulId, name: soul.name, entityId: soul.entityId, placePath: this.placePathOf(soul.soulId), position: b ? b.pose.p.map(v => Math.round(v * 100) / 100) : null, facing: b ? Math.round(b.pose.yaw * 100) / 100 : null,
        state: this.faded.has(soul.soulId) ? 'faded' : stateOf(this.host, m.entityId), activity: String(b?.human?.activity ?? 'idle'), reflex: action && action.actor === m.entityId ? {verb: action.action.verb, phase: action.action.phase ?? action.action.status} : null,
        receipts: this.openReceipts(soul.soulId), fade: this.comms?.fading.status(soul.soulId) ?? null, body: this.bodyRule?.view(soul.soulId) ?? null, bodyState: this.bodyOf(soul.soulId),
        holding: social.holding, following: social.following, followedBy: social.followedBy, ...this.gameView(b)},
      // together/1: invitations to me (accept:<id> / decline:<id>) and my own open ones
      ...(social.invites.length ? {invites: social.invites} : {}), ...(social.invited.length ? {invited: social.invited} : {}),
      here: {souls: this.perceivedBodies(soul.soulId, NEAR_RADIUS).map(o => ({soulId: o.soulId, name: o.name, ...this.host.publicNameMetadata(o.soulId), state: o.state, activity: o.activity, distance: o.distance, placeId: o.placeId, ...awayOf(o.soulId)})), ...this.objectsPage(soul, include.has('objects')), items: social.items, untrusted: true},
      ...(this.comms ? {streamCursor: this.comms.streams.headCursor(soul.soulId)} : {}),
    };
    // activities/1: a compact "things you can do right here" list (the full list is in capabilities).
    try {
      // L3 item 5: from the listed page (nearest first), so far object offers never crowd out the near ones
      const caps = this.capabilitiesPage(soul).capabilities.filter(c => c.available), pick: EdgeCapability[] = [], seen = new Set<string>();
      const take = (c: EdgeCapability | undefined) => {if (c && !seen.has(c.id) && pick.length < 14) {seen.add(c.id); pick.push(c);}};
      // together/1: answers first, then what to do with what I hold, then things to do with the nearest Soul
      for (const c of caps) if (c.verb === 'accept') take(c);
      if (social.holding) for (const c of caps) if (c.id === 'put-down:here' || c.id === 'eat:held' || c.id === 'drink:held' || c.verb === 'give') take(c);
      const nearby = this.perceivedBodies(soul.soulId, 8);
      // Prefer an ongoing conversation partner when proposing consent gestures; another bystander may be nearer.
      const partners = new Set(this.coreA.conversations().filter(c => c.members.includes(soul.soulId)).flatMap(c => c.members));
      const nearest = nearby.find(o => partners.has(o.soulId)) ?? nearby[0];
      if (nearest) for (const v of ['hug', 'high-five', 'dance-with', 'follow']) take(caps.find(c => c.id === `${v}:${nearest.soulId}`));
      for (const id of ['sit:here', 'read:here', 'lie:here', 'nap:here', 'sit-ground:here', 'wander:here']) take(caps.find(c => c.id === id));
      for (const verb of ['warm-by-fire', 'stroll', 'play-piano', 'paint', 'play-music', 'sing', 'listen', 'use-computer', 'play-frisbee', 'play-petanque', 'play-volleyball', 'lift-weights', 'bench-press', 'pull-ups',
        'write', 'cook', 'eat', 'drink', 'play-game', 'craft', 'post-letter', 'gather', 'swim']) take(caps.find(c => c.verb === verb));
      for (const c of caps) if (c.verb === 'object') take(c);
      for (const c of caps) if (c.verb === 'pick-up') take(c);
      take(caps.find(c=>c.verb==='carry'));
      out.doHere = pick.map(c => ({id: c.id, label: c.label}));
    } catch {/* the summary never breaks observe */}
    if (include.has('capabilities')) {const pg = this.capabilitiesPage(soul, {all: include.has('capabilitiesAll')}); out.capabilities = pg.capabilities; if (pg.omitted) out.capabilitiesOmitted = pg.omitted;}
    if (include.has('map')) out.map = {places: this.map()};
    if (include.has('eyes')) out.eyes = {status: 'unavailable'};
    return out;
  }

  // ---------------------------------------------------------------- Core-A hooks (perception/1, intents/1, strict/1)
  /** intents/1: affordance intents, dry runs and the attention channel. */
  readonly intents!: Intents;
  private nextChannel: string | null = null;
  /** Merge into a receipt's detail {channel, chosen, endedAt}; returns the stored JSON. */
  private setDetail(id: string, patch: Record<string, unknown>): string | null {
    const row = this.db.db.prepare('SELECT detail FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?').get(this.host.worldId, id) as {detail: string | null} | undefined; if (!row) return null;
    if((patch.contactActuatorV1 as ContactActuatorIntent|undefined)?.motionV1)this.contactPending.add(id);
    const next = JSON.stringify({...(row.detail ? JSON.parse(row.detail) : {}), ...patch});
    this.db.db.prepare('UPDATE edge_receipts_v1 SET detail=? WHERE world_id=? AND receipt_id=?').run(next, this.host.worldId, id);
    return next;
  }
  /** PM-R057 words -> one capability, with the offers the listing leaves out added on demand. A named place the listing
   *  leaves out for distance only (residents could not "go to the big top" across town while visitors reach it): that
   *  one walk is offered for this resolution (copies; the listing cache is untouched) and the words resolve again; RT:
   *  "run to the cottage": a building or room has no gait offer in the listing, so run-to-the-door-then-walk-in is.
   *  SOULSIM-E (2026-10-21): resolve (the dry run) goes through here as act does. It did not, so "go to the lighthouse"
   *  and "go to the horse" on Eden 2026 were answered "not walkable ground yet" by resolve while act would walk there,
   *  and a Soul that resolves first (as the skill says) told its human it could not go. */
  resolveOnDemand(soul: EdgeSoul, text: string, caps: EdgeCapability[], plans: Plans, typos = true): {v: VocabResult; caps: EdgeCapability[]; plans: Plans} {
    const exact = caps.find(c => c.id === text);
    if(exact && this.secretOffer(soul,exact))return {v:{kind:'unknown',code:'capability.unknown',reason:'That action is not known here.',didYouMean:[]},caps,plans};
    if(!exact){const discovery=semanticDiscovery(this,soul,text,caps,plans);if(discovery)return {v:discovery,caps,plans};}
    // RESOLVE: a building's floor ("go upstairs", "go inside the cottage and go upstairs", "the top floor of the tower")
    const fl = exact || !this.floorOnDemand ? null : floorWords(text);
    if (fl) {
      const near = fl.ask.length ? this.resolveOnDemand(soul, `walk to ${fl.ask.join(' ')}`, caps, plans, typos) : null;
      const prefer = near && near.v.kind !== 'unknown' && near.v.cap.verb === 'walk' && near.v.cap.target?.kind === 'place' && !(near.v.kind === 'alias' && near.v.params) ? near.v.cap.target.id : undefined;
      const more = [...(near?.caps ?? caps)], morePlans = new Map(near?.plans ?? plans), f = this.floorOnDemand!(soul, {ask: fl.ask, prefer, floor: fl.floor}, more, morePlans);
      if (f && 'code' in f) return {v: {kind: 'unknown', code: f.code, reason: `${text}: ${f.reason}`, didYouMean: []}, caps, plans};
      const cap = f ? more.find(c => c.id === f.id) : undefined;
      if (f && cap && !this.secretOffer(soul, cap)) return {v: {kind: 'alias', cap, note: `${text} is ${cap.id} (${cap.label})${f.note}.`}, caps: more, plans: morePlans};
    }
    // SOULSIM-E: an id-shaped walk/run/jog (`walk:land-botanic-koi-pond`, as resolve answers) to a place the listing
    // leaves out gets the same on-demand offer as its words; the words reach it through the vocabulary, the id may not
    const byId = exact ? null : /^(walk|jog|run):([^\s:/]+)$/.exec(text.trim());
    const placeId = byId ? [byId[2], 'g-' + byId[2]].find(id => this.places.byId.has(id)) : undefined;
    if (byId && placeId && this.walkOnDemand) {
      const verb = byId[1] as 'walk' | 'jog' | 'run', more = [...caps], morePlans = new Map(plans);
      // (a pond's walk goes to its shore, g-<pond>.shore-bank: the place itself, else its sub-places, as the words' walk does)
      const offer = (id: string) => verb === 'walk' ? this.walkOnDemand!(soul, id, more, morePlans) : !!this.gaitOnDemand?.(soul, id, verb, more, morePlans);
      const sub = (id: string) => id.startsWith(placeId + '.') || this.places.byId.get(id)?.parent === placeId;
      const added = offer(placeId) || [...this.places.byId.keys()].some(id => sub(id) && offer(id));
      const cap = added ? more.find(c => c.id === text.trim()) ?? more.find(c => c.verb === verb && c.target?.kind === 'place' && (c.target.id === placeId || sub(c.target.id))) : undefined;
      if (cap && !this.secretOffer(soul, cap)) return {v: cap.id === text.trim() ? {kind: 'exact', cap} : {kind: 'alias', cap, note: `${text} is ${cap.id} (${cap.label}).`}, caps: more, plans: morePlans};
    }
    // Re-offer an exact named walk, or an explicitly selected real semantic seat.
    // The normal GodNav plan, route checks and launch admission remain authoritative.
    const byRef = exact || !this.walkRefOnDemand ? null : /^(?:walk|sit):([^\s:]+)$/.exec(text.trim());
    if (byRef && (!text.trim().startsWith('sit:') || [...this.places.byId.values()].some(p => p.parts?.some(part => part.sit === text.trim() && knownPart(this,soul,p,part))))) {
      const more = [...caps], morePlans = new Map(plans), cap = this.walkRefOnDemand!(soul, byRef[1]!, more, morePlans) ? more.find(c => c.id === text.trim()) : undefined;
      if (cap && !this.secretOffer(soul, cap)) return {v: {kind: 'exact', cap}, caps: more, plans: morePlans};
    }
    let v: VocabResult = exact ? {kind: 'exact', cap: exact} : resolveCapability(text, this.vocabulary(soul, caps));
    // RESOLVE (SOULSIM-E "go to the horse" ended at the west lawn's centre, ~10 m from the horse): words that named only a place
    // whose description lists them name a thing: the nearest one so named, next to it
    if (v.kind !== 'exact' && v.seek?.length && this.thingOnDemand) {
      const more = [...caps], morePlans = new Map(plans), got = this.thingOnDemand(soul, v.seek, more, morePlans), cap = got ? more.find(c => c.id === got.id) : undefined;
      // knowledge/1: never a secret place this Soul does not know, under its thing name
      if (got && cap && !this.secretOffer(soul, cap)) return {v: {kind: 'alias', cap, note: `${text} is ${cap.id} (${cap.label}): the nearest ${v.seek.join(' ')} you can stand next to${got.count > 1 ? ` (of ${got.count} in this world)` : ''}.`}, caps: more, plans: morePlans};
    }
    // ROUTE-RECHECK ("read a book in the library" from the park was place.unreachable: the listing keeps only the nearest
    // reading places): the places the words name get their read:<place> for this act, then the words resolve again
    if (v.kind === 'unknown' && v.code === 'place.unreachable' && v.verb === 'read' && v.places?.length) {
      const me = this.body(soul.entityId);
      if (me) try {
        const more = [...caps], morePlans = new Map(plans), aw = this.activityWorld(soul, me, more, morePlans);
        const list = () => activityCapabilities({...this.spots, readFor: v.kind === 'unknown' ? v.places : []}, aw);
        const eng = this.mw as unknown as {readPassV1?: <T>(f: () => T) => T};
        const act = eng.readPassV1 ? eng.readPassV1(list) : list();
        const add = act.caps.filter(c => c.verb === 'read' && c.target?.kind === 'place' && !more.some(x => x.id === c.id));
        for (const c of add) {more.push(c); morePlans.set(c.id, act.plans.get(c.id)!);}
        if (add.length) {const again = resolveCapability(text, this.vocabulary(soul, more)); if (again.kind !== 'unknown') {caps = more; plans = morePlans; v = again;}}
      } catch (e) {console.error('[edge] read on demand', e instanceof Error ? e.message : e);}
    }
    if (v.kind === 'unknown' && v.code === 'place.unreachable' && v.place && this.walkOnDemand) {
      const more = [...caps], morePlans = new Map(plans);
      if (this.walkOnDemand(soul, v.place, more, morePlans)) {caps = more; plans = morePlans; v = resolveCapability(text, this.vocabulary(soul, caps));}
    }
    // F6 (SOULSIM-H): a far building's room, by its walk ID (`walk:cottage/bedroom`, refused place.unwalkable) or by name
    // ("walk to the cottage bedroom" chose walk:cottage, "contains it"): its own walk on demand, in at the front door
    const far = exact || !this.walkOnDemand ? undefined : v.kind === 'alias' && v.inside && v.cap.verb === 'walk' ? v.inside : text.startsWith('walk:') ? lookupPlaceIdentity(this, text.slice(5), soul.soulId) : undefined;
    const farId = typeof far === 'string' ? far : far?.ok && far.chosen.matchedBy !== 'fuzzy' ? far.chosen.place : undefined;
    if (farId) {
      const more = [...caps], morePlans = new Map(plans);
      const cap = this.walkOnDemand!(soul, farId, more, morePlans) ? more.find(c => c.verb === 'walk' && c.target?.kind === 'place' && c.target.id === farId && c.available) : undefined;
      if (cap) {caps = more; plans = morePlans; v = cap.id === text ? {kind: 'exact', cap} : {kind: 'alias', cap, note: `${text} is ${cap.id} (${cap.label}).`};}
    }
    // (a far place's run: "run to the lighthouse" was place.unreachable, its walk offered above, then the gait for it)
    if (v.kind === 'unknown' && (v.code === 'gait.unavailable' || v.code === 'place.unreachable') && v.place && this.gaitOnDemand && /^(?:jog|run)(?:[\s:]|$)/i.test(text.trim())) {
      const gait = text.trim().toLowerCase().startsWith('jog') ? 'jog' as const : 'run' as const, more = [...caps], morePlans = new Map(plans);
      if (this.gaitOnDemand(soul, v.place, gait, more, morePlans)) {caps = more; plans = morePlans; v = resolveCapability(text, this.vocabulary(soul, caps));}
    }
    // SOULSIM-E: "run to the cottage" ran to a woodland whose description lists a cottage (the listing offers gaits to
    // open places only, so the gait words matched the wrong place): the place the same words walk to, at that gait
    const g = /^(jog|run)\s+(?!a?round\b)(?:(?:over\s+)?to(?:wards?)?\s+|into\s+|up\s+to\s+)?(.+)$/i.exec(text.trim());
    if (g && !exact && this.gaitOnDemand) {
      const walk = this.resolveOnDemand(soul, `walk to ${g[2]}`, caps, plans), w = walk.v;
      const place = w.kind !== 'unknown' && w.cap.verb === 'walk' && w.cap.available && w.cap.target?.kind === 'place' && !(w.kind === 'alias' && w.params) ? w.cap.target.id : undefined;
      if (place && !(v.kind !== 'unknown' && v.cap.target?.id === place)) {
        const gait = g[1].toLowerCase() as 'jog' | 'run', id = `${gait}:${place}`, more = [...walk.caps], morePlans = new Map(walk.plans);
        const cap = more.find(c => c.id === id) ?? (this.gaitOnDemand(soul, place, gait, more, morePlans) ? more.find(c => c.id === id) : undefined);
        if (cap) return {v: {kind: 'alias', cap, note: `${text} is ${cap.id} (${cap.label}).`}, caps: more, plans: morePlans};
      }
    }
    // RESOLVE (SOULSIM-E "go to the lighthuose", "walk to the cotage"): only when the words as written name nothing, a
    // misspelt word is read as the closest name this world knows, and the reply says so
    if (typos && v.kind === 'unknown' && (!v.code || v.code === 'capability.unknown')) {
      const fix = typoFix(text, this.vocabulary(soul, caps), this.thingWords?.() ?? []);
      const r = fix ? this.resolveOnDemand(soul, fix.text, caps, plans, false) : null;
      if (fix && r && r.v.kind !== 'unknown') {
        const read = fix.fixes.map(([a, b]) => `"${a}" as "${b}"`).join(', ');
        return {...r, v: {kind: 'alias', cap: r.v.cap, ...(r.v.kind === 'alias' && r.v.params ? {params: r.v.params} : {}), note: `read ${read}: ${r.v.kind === 'alias' ? r.v.note : `${fix.text} is ${r.v.cap.id} (${r.v.cap.label}).`}`}};
      }
    }
    return {v, caps, plans};
  }
  /** knowledge/1 (as the listing filters its offers): an on-demand offer that leads to a secret place this Soul has not been
   *  to or found (or into one: knows() reads the secret ancestor), is not offered either. */
  private secretOffer(soul: EdgeSoul, cap: EdgeCapability): boolean {
    if(!this.knowledge.marked().size)return false;
    if(cap.target?.kind==='place'&&!this.knowledge.knows(soul.soulId,cap.target.id))return true;
    return [...this.places.byId.values()].some(p=>p.parts?.some(part=>(part.walk===cap.id||part.sit===cap.id)&&!knownPart(this,soul,p,part)));
  }
  /** SOULSIM-E: true when `asked` is an id the listing leaves out that resolveOnDemand offers (a far place's walk/run). Act
   *  and resolve let such an id through their place and strict/1 checks, which read the listing only. */
  onDemandId(soul: EdgeSoul, asked: string, caps?: EdgeCapability[], plans?: Plans): boolean {
    if (!/^(?:walk|jog|run|sit):/.test(asked)) return false;
    const b = caps && plans ? {caps, plans} : this.binds(soul); if (b.caps.some(c => c.id === asked)) return false;
    const od = this.resolveOnDemand(soul, asked, b.caps, b.plans); return od.caps !== b.caps && od.v.kind !== 'unknown';
  }
  /** @internal for edge/perception and edge/intents (Core-A modules): read access and two narrow write paths. */
  get coreA() {
    const self = this;
    return {
      binds: (s: EdgeSoul) => self.binds(s),
      /** Resolve's exact-walk fast path: the narrow bindings act uses, listed offers only (see exactListedWalkBindings). */
      exactListedWalk: (s: EdgeSoul, input: {capability?: unknown; params?: unknown}) => self.exactListedWalkBindings(s, input),
      body: (entityId: string) => self.body(entityId),
      // L3 (b): words on the words menu (the offer they choose is rebuilt exactly: exactWords)
      wordsMenu: (s: EdgeSoul) => self.wordsMenu(s),
      exactWords: (s: EdgeSoul, menu: {caps: EdgeCapability[]; exact: boolean}, text: string, v: VocabResult) => self.exactWords(s, menu, text, v),
      resolveText: (s: EdgeSoul, text: string, caps: EdgeCapability[]) => {const w = self.wordsMenu(s); return self.exactWords(s, w, text, self.resolveOnDemand(s, text, caps, w.plans).v);},
      isAncestor: (ancestor: string, id: string) => {for (let p = self.places.byId.get(id), n = 0; p?.parent && n < 20; p = self.places.byId.get(p.parent), n++) if (p.parent === ancestor) return true; return false;},
      targetPoint: (s: EdgeSoul, c: EdgeCapability) => self.vocabulary(s, [c]).target(c).at,
      detail: (id: string): Record<string, unknown> | null => {const r = self.rows('receipt_id=?', id)[0]; try {return r?.detail ? JSON.parse(r.detail) : null;} catch {return null;}},
      byClientRef: (soulId: string, ref: string) => {const r = self.rows('soul_id=? AND client_ref=?', soulId, ref)[0]; return r ? self.view(r) : null;},
      setDetail: (id: string, patch: Record<string, unknown>) => {const r = self.rows('receipt_id=?', id)[0]; if (!r) return null; self.setDetail(id, patch); return self.view(self.rows('receipt_id=?', id)[0]);},
      /** A completed receipt that never touches the body's act (attention, settings). */
      insertDone: (s: EdgeSoul, capability: string, clientRef: string | undefined, detail: Record<string, unknown>) => {
        self.nextChannel = String(detail.channel ?? 'none');
        try {const r = self.insert(s, capability, 'completed', clientRef, true, detail); return self.receipt(s.soulId, r.id)!;} finally {self.nextChannel = null;}
      },
      /** Body steps chosen by an intent, launched exactly like an offered capability (receipt waiting → started → …). */
      launchPlan: async (s: EdgeSoul, capability: string, label: string, steps: Program['steps'], clientRef?: string,contentParams:Record<string,unknown>={}) => {
        if (steps.length > 80) return {accepted: false as const, code: 'capability.params', reason: 'that plan is too long; act in shorter legs.', capability};
        if (self.aboard(s.entityId)?.phase === 'aloft') return {accepted: false as const, code: 'ride.aboard', reason: 'You are aloft; it lands by itself and you step out then.', capability};
        const stepOut = self.stepOutRefusal(s.entityId); if (stepOut) return {accepted: false as const, ...stepOut, capability};
        const refuse = (code: string, reason: string) => {self.recordRefusal(s.soulId, 'intent', capability, code, reason); return {accepted: false as const, code, reason, capability};};
        const out = await self.launch(s, capability, label, steps, clientRef, {}, refuse,undefined,contentParams); if (out.accepted) self.menusChangedBy('coreA-launch', s.soulId, capability); return out;
      },
      /** A faded Soul's next act lands it at a starting place first (C9), as act() does. */
      reclaim: async (s: EdgeSoul) => {
        if (!self.faded.has(s.soulId)) return;
        self.faded.delete(s.soulId);
        if (!self.inSharedCarry(s.soulId)) await self.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: self.startingPoint(s.soulId), why: 'reclaimed after fading'});
        self.dropMenu('coreA-retry', s.soulId);
      },
      /** Open conversations (ids and member Soul ids only; never turns). */
      conversations: (): {id: string; members: string[]}[] => {
        try {return (self.db.db.prepare("SELECT id, body FROM edge_comms_conversations WHERE world_id=? AND state='open' ORDER BY id").all(self.host.worldId) as {id: string; body: string}[]).map(r => ({id: r.id, members: ((JSON.parse(r.body) as {members?: {soulId: string}[]}).members ?? []).map(m => m.soulId)}));}
        catch {return [];}
      },
    };
  }
}

/** Receipt detail (Core-A): channel (body | attention | none), chosen (what an intent picked), endedAt (terminal). */
function detailOf(r: Row): {channel?: string; chosen?: unknown; endedAt?: unknown; alternatives?: unknown; meal?: unknown; approach?: unknown} {
  if (!r.detail) return {};
  try {const d = JSON.parse(r.detail) as {channel?: string; chosen?: unknown; endedAt?: unknown; alternatives?: unknown; meal?: unknown; approach?: unknown}; return {...(d.channel ? {channel: d.channel} : {}), ...(d.chosen ? {chosen: d.chosen} : {}), ...(d.endedAt ? {endedAt: d.endedAt} : {}), ...(d.alternatives ? {alternatives: d.alternatives} : {}), ...(d.meal ? {meal: d.meal} : {}), ...(d.approach ? {approach: d.approach} : {})};}
  catch {return {};}
}

const mix = (s: string, n: number) => {let h = 2166136261 ^ n; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0);};
function ambientChoice(ledger: EdgeLedger, soul: EdgeSoul, me: {pose: {p: number[]}}, tick: number): {id: string; label: string; steps: Program['steps']} | null {
  const {caps, plans} = ledger.ambientPlans(soul), world = ledger.host.engine.world as NativeWorld;
  const dist = (id: string | undefined) => {const e = id ? world.entities[id] : undefined; return e ? Math.hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) : Infinity;};
  const near = (c: EdgeCapability, r: number) => c.available && dist(c.target?.kind === 'soul' ? ledger.host.minds.get(c.target.id)?.entityId : c.target?.id) <= r;
  const options: {id: string; label: string; steps: Program['steps']; weight: number}[] = [];
  const add = (c: EdgeCapability | undefined, weight: number, adjust?: (s: Program['steps']) => void) => {
    const p = c && plans.get(c.id); if (!c || !p) return; const steps = structuredClone(p.steps); adjust?.(steps); options.push({id: c.id, label: p.label, steps, weight});
  };
  const seconds = (n: number) => (s: Program['steps']) => {for (const x of s) if ('seconds' in (x.params ?? {})) x.params.seconds = n;};
  // W2b (B6): residents drift to a lit campfire in the evening (old Eden's fireside hours), from across the green
  const hour = ledger.host.living ? clockAt(world.tick, ledger.host.living.origin, ledger.host.living.dayTicks).hour : 12, evening = hour >= 18 || hour < 1;
  add(caps.find(c => c.verb === 'warm-by-fire' && near(c, evening ? 60 : 15)), evening ? 8 : 3, seconds(evening ? 180 : 90));
  add(caps.find(c => c.verb === 'sit' && near(c, 10)), 3, seconds(60));
  for (const c of caps.filter(c => c.verb === 'face' && near(c, 6)).slice(0, 2)) add(c, 2);
  add(caps.find(c => c.id === 'wander:here'), 3, s => {for (const x of s) if (x.verb === 'ambient_wander') {x.params.seconds = 25; x.params.radius = 4;}});
  if (!options.length) return null;
  let r = mix(soul.soulId, tick) % options.reduce((a, o) => a + o.weight, 0);
  for (const o of options) {if (r < o.weight) return o; r -= o.weight;}
  return options[0];
}

export function edgeIdOf(b: HumanBindingV1): {id: string; verb: string} {
  if (b.id === 'activity:swim:shore-water') return {id: 'swim:shore-water', verb: 'swim'};
  if (b.id === 'rest:self') return {id: 'rest:here', verb: 'rest'};
  if (b.goal === 'hang_out') return {id: 'hang-out:' + b.id.slice('hang_out:'.length), verb: 'hang-out'};
  return {id: b.id, verb: b.goal};
}
export {stateOf};
/** Verbs whose resting posture is a chosen activity (fade-by-abandonment holds the Soul while the body keeps it). */
const POSTURE_VERBS = new Set(['sit', 'sit-ground', 'lie', 'nap', 'read', 'rest', 'warm-by-fire', 'gather', 'swim', 'accept', 'object', 'paint', 'play-piano', 'play-music', 'write', 'play-game', 'craft', 'eat', 'drink', 'cook', 'dance-with']);
export function timeLabel(phase: number) {return phase < .2 ? 'morning' : phase < .45 ? 'day' : phase < .55 ? 'evening' : phase < .75 ? 'dusk' : 'night';}

/** RESOLVE: a floor of a building named in plain words ("go upstairs", "go inside the cottage and go upstairs", "the top floor
 *  of the tower", "go downstairs"): which floor, and the words left that name the building (none: the one the Soul is in). */
/** A floor plate near a body (floorsNear). */
export type FloorNear = {id: string; name: string; y: number; rise: number; on: boolean; d: number; at: [number, number]; openings: [number, number][]};

export function floorWords(text: string): {floor: 'up' | 'down' | 'top' | number; ask: string[]} | null {
  if (text.includes(':')) return null;
  const t = text.toLowerCase(), m = /\b(?:(up)stairs|(down)stairs|(?:go(?:ing)?|walk|climb|head|run|get)\s+(up|down)(?:\s+the)?\s+(?:stairs|staircase|steps)|climb(?:\s+up)?\s+the\s+(?:stairs|staircase)|(?:the\s+)?(upper|top|first|second|third|1st|2nd|3rd|ground|bottom|next)\s+(?:floor|storey|story|level))\b/.exec(t);
  if (!m) return null;
  const w = m[1] ?? m[2] ?? m[3] ?? m[4] ?? 'up';
  const floor = ({up: 'up', upper: 'up', next: 'up', down: 'down', top: 'top', ground: 0, bottom: 0, first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3} as Record<string, 'up' | 'down' | 'top' | number>)[w] ?? 'up';
  const ask = tokens(t.replace(m[0], ' ')).filter(x => !['go', 'going', 'walk', 'head', 'climb', 'run', 'get', 'take', 'me', 'please', 'inside', 'enter', 'up', 'down', 'floor', 'stairs', 'now', 'can', 'you', 'let', 'lets', 'us', 'i', 'want'].includes(x));
  return {floor, ask};
}
