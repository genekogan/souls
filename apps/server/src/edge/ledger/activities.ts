// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): generic, native body activities offered as capabilities.
// sit:here, sit-ground:here, lie:here, nap:here, read:here, read:<place>, <activity>:<spot>. Each plan is ordinary
// body steps (walk_to, sit, stand, mars:pose_v1) performed as one logged decision with a normal receipt. No model calls.
import type {Program} from '@sim/engine-contract';
import type {EdgeCapability} from '../contract.ts';
import type {Interior, Platform, Ring, Solid} from './nav.ts';
import {DANCE_CLEARANCE,POSE_INSTRUMENTS} from '../../../../../mars/viewer/engine/social/pose.ts';
import {FLIGHT_MARGIN} from '../../../../../mars/viewer/engine/social/frisbee-clearance.ts';
import {validInteriorShellBounds} from './nav.ts';
import {paintingParam} from '../../art/painting.ts';

type V2 = [number, number];
export type Spot = {id: string; place?: string; activity: string; base: 'sit' | 'idle' | 'lie'; at: V2; faceTo?: V2; seatHeight?: number; prop?: string; label?: string;
  /** CN5: the instrument at a play-music spot (drums, guitar, violin…); the raised deck it stands on (platforms[] id);
   *  further activities offered at the same spot (a desk with a computer: `also: ['use-computer']`). */
  instrument?: string; platform?: string; also?: string[];
  /** todo (leisure): a spot done together (a see-saw's two ends): the shared group, how many others it needs, how long it
   *  waits for them and what happens alone (fail: "nobody came" is the honest verdict). */
  together?: {group: string; need: number; wait: number; alone: 'fail' | 'start'};
  /** R5: another spot that must be in use first (a listener's seat needs someone telling the story). */
  requires?: string;
  /** E-life (god worlds): a native seat fixture to sit on first (a library armchair, a café chair, the piano's bench); the
   *  activity is then done on that seat. `level`: the engine level the spot stands on (a desk upstairs). */
  seat?: string; level?: number;
  /** E-life: the activity's own title at this spot when the default does not fit ("Feed the ducks and swans"). */
  title?: string;
  /** Bound only by the world adapter for a real painting easel. Never inferred from a label. */
  paintingTarget?: string;
  /** Entry 36: a mic stand's singer sings along with music within this many metres (the pose ends when it stops). */
  accompany?: number};
export type Shelf = {id: string; place?: string; at: V2; faceTo?: V2; level?: number};
/** todo (leisure): a bicycle dock: `bikes` bicycles stand in it; a ride takes one and brings it back. */
export type Dock = {id: string; place?: string; at: V2; faceTo?: V2; bikes: number; label?: string};
export type SpotsData = {contract: 'activity-spots/1'; spots: Spot[]; shelves: Shelf[]; interiors: Interior[]; solids: Solid[]; rings: Ring[]; platforms: Platform[]; docks?: Dock[];
  /** E-life (derived spots on big god worlds): offer only the nearest N free spots per activity and the nearest N places to
   *  read in (Eden 2026 has ~300 tables and ~100 bookcases; all of them within 200 m made a 470 kB list). Unset: all. */
  nearest?: number;
  /** ROUTE-RECHECK (on demand, one act): places named by the Soul's words ("read a book in the library") whose read:<place>
   *  is offered beyond the nearest-N cap and the 200 m listing limit (still only spots within reach). */
  readFor?: string[]};
export type Plan = {label: string; steps: Program['steps']; seconds?: boolean; paintingTarget?: string; paintingLevel?: number};

/** Activities a spot may offer, with their default prop and seconds. */
/** `pose`: the body pose an activity is done in, when it is not its own name (a book club reads, a yoga class does yoga). */
export const SPOT_ACTIVITIES: Record<string, {prop?: string; seconds: number; label: string; pose?: string}> = {
  read: {prop: 'book', seconds: 180, label: 'Read a book'}, write: {prop: 'pen', seconds: 120, label: 'Write'},
  'play-piano': {seconds: 120, label: 'Play the piano'}, 'play-music': {seconds: 120, label: 'Play music'}, paint: {prop: 'brush', seconds: 180, label: 'Paint at the easel'},
  eat: {prop: 'plate', seconds: 120, label: 'Eat something'}, drink: {prop: 'cup', seconds: 90, label: 'Have a drink'}, cook: {prop: 'tool', seconds: 150, label: 'Cook'},
  'play-game': {prop: 'cards', seconds: 180, label: 'Play a game'}, craft: {prop: 'tool', seconds: 180, label: 'Make something by hand'}, 'post-letter': {prop: 'letter', seconds: 4, label: 'Post a letter'},
  lie: {seconds: 120, label: 'Lie down'}, nap: {seconds: 300, label: 'Take a nap'},
  // CN5: computers at desks, the stages and the audience, the outdoor gym, park games
  'use-computer': {seconds: 300, label: 'Use the computer'}, sing: {seconds: 120, label: 'Sing at the microphone'}, listen: {seconds: 300, label: 'Sit in the audience and listen'},
  'lift-weights': {prop: 'dumbbell', seconds: 60, label: 'Lift weights (dumbbell curls)'}, 'bench-press': {seconds: 60, label: 'Do a bench press'}, 'pull-ups': {seconds: 30, label: 'Do pull-ups'},
  dips: {seconds: 30, label: 'Do dips on the bars'}, situps: {seconds: 30, label: 'Do sit-ups'}, pushups: {seconds: 30, label: 'Do push-ups'}, yoga: {seconds: 120, label: 'Do yoga'},
  // leisure: nature activities at World's bank, pond and bed spots
  fish: {prop: 'rod', seconds: 180, label: 'Fish from the bank'}, feed: {prop: 'bread', seconds: 90, label: 'Feed the koi'}, garden: {prop: 'tool', seconds: 150, label: 'Tend the garden beds'},
  // leisure: the playground, the hammocks and the picnic blanket (World's scenery), and lying back to watch the night sky
  swing: {seconds: 120, label: 'Swing on a swing'}, seesaw: {seconds: 120, label: 'Ride the see-saw (with someone on the other end)'},
  hammock: {seconds: 300, label: 'Rest in a hammock'}, picnic: {prop: 'food', seconds: 300, label: 'Have a picnic on the blanket'},
  // R5 group life: done together at shared places (see Spot.together); the verdict says when nobody came
  'tell-story': {seconds: 240, label: 'Tell a story to the circle'}, 'hear-story': {pose: 'listen', seconds: 240, label: 'Listen to the storyteller'},
  'book-club': {pose: 'read', prop: 'book', seconds: 600, label: 'Book club: read and talk it over together'},
  'cook-together': {pose: 'cook', prop: 'spoon', seconds: 300, label: 'Cook together at a preparation table'},
  'social-dance': {pose: 'dance', seconds: 180, label: 'Dance on the bandstand'}, 'yoga-class': {pose: 'yoga', seconds: 600, label: 'Join the yoga class'},
  // E-life B9 (god worlds): a talk or lesson from a podium, a lectern or a classroom's teacher desk, and attending it from
  // a seat in the room (offered once someone is giving it: the attend spot `requires` the lecture spot)
  lecture: {pose: 'tell-story', seconds: 600, label: 'Give a talk or a lesson'}, attend: {pose: 'listen', seconds: 600, label: 'Attend the talk or class'},
  'play-frisbee': {seconds: 300, label: 'Throw a frisbee'}, 'play-petanque': {seconds: 600, label: 'Play pétanque'}, 'play-volleyball': {seconds: 300, label: 'Play beach volleyball'},
};
/** CN5 choreographed games at spots: 2–6 players; the world keeps the turns (social/pose.ts GAMES). */
export const GAME_ACTIVITIES: Record<string, 'frisbee' | 'petanque' | 'volleyball'> = {'play-frisbee': 'frisbee', 'play-petanque': 'petanque', 'play-volleyball': 'volleyball'};
export const GAME_MAX_PLAYERS = 6;
/** srv-act-words: every verb an offer of `activityCapabilities` can have (spot and court activities, the fixed sit / lie /
 *  read / stargaze offers, the on-the-spot moves; their ids are `<verb>:…`). A focused build whose focus names none of
 *  them, not `here` and no target, skips the activity listing (edge-bind-one-oracle checks the set against the whole menu). */
export const ACTIVITY_VERBS: ReadonlySet<string> = new Set([...Object.keys(SPOT_ACTIVITIES), ...Object.keys(GAME_ACTIVITIES),
  'sit', 'sit-ground', 'stand', 'stargaze', 'read', 'lie', 'nap', 'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps']);
/** srv-act-words: whether a focused build may want an offer of the activity listing (always, without a focus). */
export function activityMayOffer(f: {ids: ReadonlySet<string>; verbs: ReadonlySet<string>; targets: ReadonlySet<string>; here?: boolean} | null | undefined): boolean {
  if (!f || f.here || f.targets.size) return true;
  for (const v of f.verbs) if (ACTIVITY_VERBS.has(v)) return true;
  for (const id of f.ids) if (ACTIVITY_VERBS.has(id.slice(0, Math.max(0, id.indexOf(':'))))) return true;
  return false;
}
/** Postures done lying on a spot's furniture or mat (the rest of a `lie` spot is lying down or a nap). */
const LYING_SPOT = new Set(['lie', 'nap', 'situps', 'pushups', 'bench-press', 'yoga', 'hammock']);
const INSTRUMENTS = new Set<string>(POSE_INSTRUMENTS);
const REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** Clear ground a body needs to stand or sit at a spot (m): the walk planner's body radius. */
const STAND_CLEAR = 0.28;
/** Spots within this distance are offered (CN5: 200 m, so the piano is still offered from the pond and the shore). */
export const SPOT_REACH = 200;
const pt = (v: unknown): v is V2 => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

const validTogether = (t: Spot['together']) => !!t && typeof t.group === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(t.group) && Number.isInteger(t.need) && t.need >= 1 && t.need <= 8
  && Number.isFinite(t.wait) && t.wait >= 0 && t.wait <= 180 && (t.alone === 'fail' || t.alone === 'start');
/** Validate an activity-spots/1 file; bad entries are dropped and reported (never faked). */
export function loadSpots(raw: unknown): {data: SpotsData; refused: string[]} {
  const d = (raw ?? {}) as Partial<SpotsData>, refused: string[] = [], ids = new Set<string>();
  const ok = (id: unknown) => typeof id === 'string' && REF.test(id) && !ids.has(id) && !!ids.add(id);
  const spots = (d.spots ?? []).filter(s => {const good = ok(s?.id) && pt(s.at) && s.activity in SPOT_ACTIVITIES && ['sit', 'idle', 'lie'].includes(s.base) && (s.faceTo === undefined || pt(s.faceTo))
    && (s.instrument === undefined || INSTRUMENTS.has(s.instrument)) && (s.together === undefined || validTogether(s.together)) && (s.requires === undefined || (typeof s.requires === 'string' && REF.test(s.requires))) && (s.also === undefined || (Array.isArray(s.also) && s.also.every(a => a in SPOT_ACTIVITIES && !(a in GAME_ACTIVITIES)))); if (!good) refused.push('spot ' + String(s?.id)); return good;});
  const shelves = (d.shelves ?? []).filter(s => {const good = ok(s?.id) && pt(s.at); if (!good) refused.push('shelf ' + String(s?.id)); return good;});
  const interiors = (d.interiors ?? []).filter(i => {const good = typeof i?.place === 'string' && Array.isArray(i.doors) && i.doors.length > 0 && i.doors.every(x => Array.isArray(x) && x.length === 4 && x.every(Number.isFinite)) && (i.shell===undefined||validInteriorShellBounds(i.shell)); if (!good) refused.push('interior ' + String(i?.place)); return good;});
  const solids = (d.solids ?? []).filter(s => {const good = ok(s?.id) && pt(s.c) && pt(s.half) && Number.isFinite(s.yaw); if (!good) refused.push('solid ' + String(s?.id)); return good;});
  const rings = (d.rings ?? []).filter(g => {const good = ok(g?.id) && pt(g.c) && Number.isFinite(g.r) && g.r > 0.3 && g.r < 50 && (g.gaps === undefined || (Array.isArray(g.gaps) && g.gaps.every(Number.isFinite))); if (!good) refused.push('ring ' + String(g?.id)); return good;});
  // CN5: walkable raised decks (OBSTACLES-v1 platforms[]): a box {c, half, yaw} or a round deck {c, r}, top height, optional step/ramp
  const platforms = (d.platforms ?? []).filter(q => {const good = ok(q?.id) && pt(q.c) && Number.isFinite(q.top) && q.top > 0 && q.top < 3 && ((pt(q.half) && Number.isFinite(q.yaw ?? 0)) || (Number.isFinite(q.r) && q.r! > 0.3 && q.r! < 50))
    && [q.step, q.ramp].every(a => a === undefined || (pt(a.c) && pt(a.half))); if (!good) refused.push('platform ' + String(q?.id)); return good;});
  const docks = (d.docks ?? []).filter(k => {const good = ok(k?.id) && pt(k.at) && (k.faceTo === undefined || pt(k.faceTo)) && Number.isInteger(k.bikes) && k.bikes >= 1 && k.bikes <= 12; if (!good) refused.push('dock ' + String(k?.id)); return good;});
  if (raw !== undefined && d.contract !== 'activity-spots/1') return {data: {contract: 'activity-spots/1', spots: [], shelves: [], interiors: [], solids: [], rings: [], platforms: []}, refused: ['contract must be activity-spots/1']};
  return {data: {contract: 'activity-spots/1', spots, shelves, interiors, solids, rings, platforms, ...(docks.length ? {docks} : {})}, refused};
}

export type ActivityWorld = {
  me: V2; seated: boolean;
  /** The engine level the body stands on (0 = the ground; absent = 0). */
  level?: number;
  /** Clear standing ground at a point (m), 0 inside solids / off ground; may be capped at 1 m (only read against standing-room thresholds ≤ 0.95 m). */
  clearance(x: number, z: number): number;
  /** Nearest open spot with at least `min` m clearance within `rings`×0.5 m. */
  open(at: V2, min: number, rings: number): V2 | null;
  /** Someone else stands within 0.7 m of the point, or another Soul's open act targets this spot id. */
  taken(at: V2, spotId?: string): boolean;
  /** Admitted interiors (spots in a closed building are not offered). */
  enterable(place: string | undefined): boolean;
  /** Nearest free native seat within `radius` m: its sit capability id and plan. */
  /** The nearest free seat within `radius` m; `here` (D2, "sit down" means here): only a seat in the Soul's own room or
   *  within HERE_SEAT_M with no enclosure boundary between (EdgeLedger.seatIsHere). */
  seat(radius: number, here?: boolean): {cap: EdgeCapability; plan: Plan; distance: number} | null;
  placeName(id: string | undefined): string | null;
  /** Place ids containing a spot's place (for read:<place> on the building as well as the room). */
  ancestors(id: string): string[];
  /** READ-DISPLACEMENT: the outline of the innermost room (an enclosed or `room` place) holding a point on a level, if any. */
  room?(at: V2, level: number): V2[] | null;
  /** CN5: how many bodies are playing (or waiting to play) in this game group now. */
  groupSize(group: string): number;
  /** leisure: the world clock now (null/absent: this world keeps no day), for stargazing after dark. */
  clock?: {hour: number; minute: number} | null;
};
/** leisure: the stars are out from 20:00 until 05:00 world time. */
export const STARS_FROM = 20, STARS_UNTIL = 5;

const d2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pose = (activity: string, seconds: number, extra: Record<string, unknown> = {}) => ({verb: 'mars:pose_v1', params: {activity, seconds, ...extra}});
// upper-floors/1: a spot on level 0 inside a building (a hotel lobby sofa) reached from upstairs needs the level-aware walk;
// plain walk_to keeps the body's current level and would seat it on the floor above the spot
const walk = (to: V2, level?: number, from = 0) => level || (level === 0 && from) ? {verb: 'mars:walk_to', params: {x: to[0], z: to[1], level}} : {verb: 'walk_to', params: {to: [to[0], to[1]]}};
const standFirst = (w: ActivityWorld): Program['steps'] => w.seated ? [{verb: 'stand', params: {}}] : [];
const secondsParam = (def: number, max = 1800) => ({seconds: {type: 'integer', min: 5, max, default: def}});
/** A seat's sit (no pose): the ledger times its rest or sit step, 1..600 s, 60 by default, like every sit:<seat>. */
const seatSeconds = () => ({seconds: {type: 'integer', min: 1, max: 600, default: 60}});
export const ACTIVITY_SECONDS_MAX = 1800;

/** The activity capabilities and plans for one Soul right now. */
export function activityCapabilities(data: SpotsData, w: ActivityWorld): {caps: EdgeCapability[]; plans: Map<string, Plan>} {
  const caps: EdgeCapability[] = [], plans = new Map<string, Plan>();
  const add = (cap: EdgeCapability, plan: Plan) => {caps.push(cap); plans.set(cap.id, plan);};
  // CN5 (acceptance): a spot World placed inside an obstacle (the picnic seats inside their table's box) is used from the
  // first clear point straight back from what it faces (≤ 0.9 m); one with no clear point near it is not offered
  const standAt = new Map<string, V2 | null>(), clearAt = (s: Spot): V2 | null => {
    if (s.seat || s.level) return s.at;   // a seat fixture is approached by the engine's own sit; upstairs ground is not ours to probe
    if (!standAt.has(s.id)) {
      let at: V2 | null = s.at;
      // a standing spot with less than standing room (inside an obstacle, or wedged between a table and the wall: the walk's goal then has
      // no room within its 0.35 m snap, route.goal-blocked) steps straight back to clear ground; seats are as World placed them.
      // SPOTS 2026-10-23: was `< 0.05` only, and skipped when the Soul itself stood on 0-clearance ground (an easel in a corner)
      const here = s.activity in GAME_ACTIVITIES ? 1 : w.clearance(s.at[0], s.at[1]);
      if (here < (s.base === 'idle' ? STAND_CLEAR : 0.05)) {   // lying or sitting on furniture (a gym bench): only from inside an obstacle
        const f = s.faceTo ?? s.at, L = Math.hypot(s.at[0] - f[0], s.at[1] - f[1]), back: V2 = L > 1e-6 ? [(s.at[0] - f[0]) / L, (s.at[1] - f[1]) / L] : [0, 0];
        at = null; let seen = here > 0 || w.clearance(w.me[0], w.me[1]) > 0;
        for (let t = 0.1; t <= 0.9 + 1e-9 && L > 1e-6; t += 0.1) {const p: V2 = [Math.round((s.at[0] + back[0] * t) * 100) / 100, Math.round((s.at[1] + back[1] * t) * 100) / 100], c = w.clearance(p[0], p[1]); if (c > 0) seen = true; if (c >= STAND_CLEAR) {at = p; break;}}
        if (!at && (here >= 0.05 || !seen)) at = s.at;   // nothing clearer behind it: as before (ground with room enough, or no ground data)
      }
      standAt.set(s.id, at);
    }
    return standAt.get(s.id)!;
  };
  // only spots within reach are probed for clear ground (a far spot's probe paged in its nav tile for nothing)
  // E-life (big derived worlds, `nearest`): a spot is probed for clear ground only when it is about to be offered (the
  // nearest few per activity), not every spot within reach (1.5 s of a 4 s first sweep on Eden 2026); old worlds unchanged
  const reach0 = data.spots.filter(s => d2(s.at, w.me) <= SPOT_REACH && w.enterable(s.place)), ok = (s: Spot) => !!clearAt(s);
  const live = data.nearest ? reach0 : reach0.filter(ok);
  const spotSteps = (s: Spot, seconds?: number, activity = s.activity, fromLevel = w.level): Program['steps'] => {
    const def = SPOT_ACTIVITIES[activity], body = def.pose ?? activity, lying = s.base === 'lie', act = lying && !LYING_SPOT.has(body) ? 'lie' : body, prop = s.prop ?? def.prop;
    const reach = s.seat ? {verb: 'sit', params: {on: s.seat, seconds: 1}} : walk(clearAt(s) ?? s.at, s.level, fromLevel);
    // entry 36: at a mic stand the singer turns to the mic on arrival (the pose's own facing is a one-tick snap)
    const turn = act === 'sing' && s.accompany && s.faceTo && !s.seat ? [{verb: 'mars:face', params: {target: {point: s.faceTo}}}] : [];
    return [...standFirst(w), reach, ...turn, pose(act, seconds ?? def.seconds, {...(prop && !lying ? {prop} : {}), ...(s.base === 'sit' ? {base: 'sit', ...(s.seatHeight ? {seatHeight: s.seatHeight, seatTogether: true} : {})} : {}),
      // CN5: lying on furniture (a gym bench) at its top; the instrument played at a music spot
      ...(lying && s.seatHeight ? {seatHeight: s.seatHeight, seatTogether: true} : {}), ...(s.instrument && (act === 'play-music' || act === 'play-piano') ? {instrument: s.instrument} : {}), ...(s.faceTo ? {face: s.faceTo} : {}),
      // entry 36: singing along at a mic stand lasts only while the music plays (refused after 4 s with none)
      ...(act === 'sing' && s.accompany ? {accompany: {radius: s.accompany, grace: 4}} : {}),
      // leisure: done together (a see-saw): wait for the other end, then the same shared stretch for both
      ...(s.together ? {group: s.together.group, need: s.together.need, waitSeconds: s.together.wait, alone: s.together.alone, seatTogether: true} : {})})];
  };
  // E-life: a derived shelf's browse point may lie against furniture: step it straight back from the shelf to clear ground
  // (≤ 0.9 m), as spots do; one with no clear point is not browsed (reading still takes the book you have)
  const shelfAt = new Map<string, V2 | null>(), shelfStand = (s: Shelf): V2 | null => {
    if (s.level || !s.faceTo || !(w.clearance(w.me[0], w.me[1]) > 0)) return s.at;
    if (!shelfAt.has(s.id)) {
      let at: V2 | null = s.at;
      if (w.clearance(s.at[0], s.at[1]) < STAND_CLEAR) {
        const L = d2(s.at, s.faceTo), back: V2 = L > 1e-6 ? [(s.at[0] - s.faceTo[0]) / L, (s.at[1] - s.faceTo[1]) / L] : [0, 0]; at = null;
        for (let t = 0.1; t <= 0.9 + 1e-9 && L > 1e-6; t += 0.1) {const p: V2 = [Math.round((s.at[0] + back[0] * t) * 100) / 100, Math.round((s.at[1] + back[1] * t) * 100) / 100]; if (w.clearance(p[0], p[1]) >= STAND_CLEAR) {at = p; break;}}
      }
      shelfAt.set(s.id, at);
    }
    return shelfAt.get(s.id)!;
  };
  const shelfNear = (at: V2) => data.shelves.filter(s => w.enterable(s.place) && d2(s.at, at) <= 15 && !!shelfStand(s)).sort((a, b) => d2(a.at, at) - d2(b.at, at) || a.id.localeCompare(b.id))[0];
  /** Reading at a spot: take a book from the nearest shelf, read, put it back. */
  const readAt = (s: Spot): Program['steps'] => {
    // Omitted shelf levels mean ground. Fetch starts on the body's current floor; return starts on the reading spot's
    // floor, which may differ. A plain walk_to would otherwise retain that upper floor when targeting a ground shelf.
    // READ-DISPLACEMENT (continuity C13): each browse walk is `free: 'goal/1'` (engine freeGoalV1): when it begins with
    // another body on the shelf point it ends at a free point within 1.5 m in the shelf's own room (`freeWithin`), or the
    // browse happens where the reader stands; a bystander is never moved
    const shelf = shelfNear(s.at), browseWalk = (from: number) => {
      const to = shelfStand(shelf!)!, st = walk(to, shelf!.level ?? 0, from), room = w.room?.(to, shelf!.level ?? 0);
      return {...st, params: {...st.params, free: 'goal/1', ...(room ? {freeWithin: room.map(v => [v[0], v[1]])} : {})}};
    };
    const browse = (sec: number, from: number) => shelf ? [browseWalk(from), pose('browse', sec, {prop: 'book', ...(shelf.faceTo ? {face: shelf.faceTo} : {})})] : [];
    const reading = spotSteps({...s, level: s.level ?? 0}, undefined, s.activity, shelf ? shelf.level ?? 0 : w.level);
    return [...standFirst(w), ...browse(4, w.level ?? 0), ...reading.filter(x => x.verb !== 'stand'), ...(s.seat && shelf ? [{verb: 'stand', params: {}}] : []), ...browse(3, s.level ?? 0)];
  };
  // ---- sitting and lying, anywhere
  // D2 (playtest 2026-10-25: "sit down" walked 30 m to a kitchen chair in another house, 3 of 3 batteries): sit:here sits
  // on a seat only in the Soul's own room or within a few metres with no wall between, else on the ground here; reading
  // keeps the nearest free seat within 30 m
  const seat = w.seat(30), seatHere = w.seat(30, true), groundHere = w.clearance(w.me[0], w.me[1]), sitGround = (sec: number): Program['steps'] => {
    const spot = groundHere >= 0.45 ? null : w.open(w.me, 0.45, 20);
    return [...standFirst(w), ...(spot ? [walk(spot)] : []), pose('sit-ground', sec)];
  };
  add({id: 'sit-ground:here', verb: 'sit-ground', label: 'Sit down on the ground here', available: true, params: secondsParam(120)}, {label: 'Sit on the ground', steps: sitGround(120), seconds: true});
  if (seatHere) add({id: 'sit:here', verb: 'sit', label: `Sit down on the free seat here (${seatHere.cap.label}, ${Math.round(seatHere.distance)} m)`, available: true, target: seatHere.cap.target, params: seatSeconds()}, {label: 'Sit down', steps: seatHere.plan.steps, seconds: true});
  else add({id: 'sit:here', verb: 'sit', label: 'Sit down on the ground here (no free seat right here)', available: true, params: secondsParam(120)}, {label: 'Sit on the ground', steps: sitGround(120), seconds: true});
  for (const [act, sec] of [['lie', 120], ['nap', 300]] as const) {
    const beds = live.filter(s => s.base === 'lie' && s.activity === act && !w.taken(s.at, s.id) && d2(s.at, w.me) <= 12 && (!data.nearest || ok(s))).sort((a, b) => d2(a.at, w.me) - d2(b.at, w.me));
    const spot = groundHere >= 0.95 ? null : w.open(w.me, 0.95, 30), canHere = groundHere >= 0.95 || !!spot;
    const plan: Plan = beds[0] ? {label: SPOT_ACTIVITIES[act].label, steps: spotSteps(beds[0], sec), seconds: true} : {label: SPOT_ACTIVITIES[act].label, steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose(act, sec)], seconds: true};
    add({id: `${act}:here`, verb: act, label: act === 'lie' ? (beds[0] ? `Lie down (${beds[0].label ?? beds[0].id})` : 'Lie down on the grass here') : (beds[0] ? `Take a nap (${beds[0].label ?? beds[0].id})` : 'Take a nap on the grass here'), available: !!beds[0] || canHere,
      ...(beds[0] || canHere ? {} : {blocked: {code: 'pose.no-room', reason: 'No open ground within 15 m to lie on; walk to a lawn or garden first.'}}), params: secondsParam(sec)}, plan);
  }
  // ---- leisure: lie back on open grass and watch the stars, after dark only (the verdict says when, never a lie in daylight)
  {
    const spot = groundHere >= 0.95 ? null : w.open(w.me, 0.95, 30), room = groundHere >= 0.95 || !!spot, c = w.clock;
    const dark = !!c && (c.hour >= STARS_FROM || c.hour < STARS_UNTIL), at = c ? `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` : null;
    const blocked = !c ? {code: 'sky.no-clock', reason: 'This world keeps no day and night, so there are no stars to watch.'}
      : !dark ? {code: 'sky.daylight', reason: `The stars come out from ${STARS_FROM}:00 to 0${STARS_UNTIL}:00 world time; it is ${at} now. Lie down on the grass instead, or ask again after dark.`}
      : !room ? {code: 'pose.no-room', reason: 'No open ground within 15 m to lie on; walk to a lawn first.'} : null;
    add({id: 'stargaze:here', verb: 'stargaze', label: 'Lie back on the grass and watch the stars', available: !blocked, ...(blocked ? {blocked} : {}), params: secondsParam(300)},
      {label: 'Watch the stars', steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose('stargaze', 300)], seconds: true});
  }
  // ---- moving on the spot (P1): standing or on the ground, wherever there is room
  for (const [act, label, sec, lying] of [['dance', 'Dance here', 60, false], ['jump', 'Jump on the spot', 5, false], ['stretch', 'Stretch', 30, false], ['jumping-jacks', 'Do jumping jacks', 30, false],
    ['yoga', 'Do yoga on the ground', 120, true], ['pushups', 'Do push-ups', 30, true], ['situps', 'Do sit-ups', 30, true]] as const) {
    const need = lying ? 0.95 : act === 'dance' ? DANCE_CLEARANCE : 0.45;
    // "Dance here" never adds a walk: use the same standing footprint as native admission.
    const spot = act === 'dance' || groundHere >= need ? null : w.open(w.me, need, 30), can = groundHere >= need || !!spot;
    add({id: `${act}:here`, verb: act, label, available: can, ...(can ? {} : {blocked: {code: 'pose.no-room', reason: act === 'dance' ? 'There is not enough supported standing room here to dance without intersecting an obstacle.' : 'No open ground within 15 m; walk to a lawn or garden first.'}}), params: secondsParam(sec, 600)},
      {label, steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose(act, sec)], seconds: true});
  }
  // ---- reading here: keep the current seat, else a reading spot (with a shelf) nearby, else a free seat, else standing
  const readers = live.filter(s => s.activity === 'read' && !w.taken(s.at, s.id)).sort((a, b) => d2(a.at, w.me) - d2(b.at, w.me) || a.id.localeCompare(b.id));
  const near = readers.find(s => d2(s.at, w.me) <= 40 && (!data.nearest || ok(s)));
  // An occupied native seat is absent from the free-seat capabilities. The read overlay already preserves its
  // lasting claim and facing. "Here" honors it before unrelated shelves; explicit spot/place reads still fetch/return.
  if (w.seated) add({id: 'read:here', verb: 'read', label: 'Read the book you carry on your current seat', available: true, params: secondsParam(180)}, {label: 'Read a book', steps: [pose('read', 180, {prop: 'book'})], seconds: true});
  else if (near) add({id: 'read:here', verb: 'read', label: `Read a book (${near.label ?? near.id}, ${Math.round(d2(near.at, w.me))} m; takes a book from the shelf and puts it back)`, available: true, target: {id: near.id, kind: 'spot'}, params: secondsParam(180)}, {label: 'Read a book', steps: readAt(near), seconds: true});
  else if (seat) add({id: 'read:here', verb: 'read', label: `Read a book on the nearest free seat (${seat.cap.label})`, available: true, params: secondsParam(180)}, {label: 'Read a book', steps: [...seat.plan.steps.filter(s => s.verb !== 'rest'), pose('read', 180, {prop: 'book'})], seconds: true});
  else add({id: 'read:here', verb: 'read', label: 'Read the book you carry, standing here', available: true, params: secondsParam(180)}, {label: 'Read a book', steps: [...standFirst(w), pose('read', 180, {prop: 'book'})], seconds: true});
  // read:<place>: every place that has reading spots (the room and its building), nearest free spot in it
  const byPlace = new Map<string, Spot[]>();
  const asked = new Set(data.readFor ?? []), named = (p: string) => asked.has(p) || w.ancestors(p).some(a => asked.has(a));
  for (const s of readers) {
    const ps = s.place ? [s.place, ...w.ancestors(s.place)] : [];
    const want = asked.size > 0 && ps.some(named);
    if (data.nearest && !want && (ps.every(p => byPlace.has(p)) || byPlace.size >= data.nearest * 4 || !ok(s))) continue;   // readers are nearest first
    if (want && !ok(s)) continue;
    for (const p of ps) byPlace.set(p, [...(byPlace.get(p) ?? []), s]);
  }
  const placesToRead = [...byPlace].sort((a, b) => a[0].localeCompare(b[0]));
  if (data.nearest) {
    const dropped = placesToRead.sort((a, b) => d2(a[1][0].at, w.me) - d2(b[1][0].at, w.me) || a[0].localeCompare(b[0])).splice(data.nearest * 2);
    if (asked.size) placesToRead.push(...dropped.filter(([p]) => named(p)));
  }
  for (const [place, list] of placesToRead) {
    const s = list[0], name = w.placeName(place) ?? place;
    if (d2(s.at, w.me) > 200 && !named(place)) continue;
    add({id: 'read:' + place, verb: 'read', label: `Read a book in ${name}`, available: true, target: {id: place, kind: 'place'}, params: secondsParam(180)}, {label: `Read a book in ${name}`, steps: readAt(s), seconds: true});
  }
  // ---- every other free spot within reach: play-piano:<spot>, paint:<spot>, use-computer:<spot>, sing:<spot>, listen:<seat>…
  const labelOf = (s: Spot, activity: string) => {const def = SPOT_ACTIVITIES[activity], inst = s.instrument && activity === 'play-music' ? `Play the ${s.instrument}` : (activity === s.activity && s.title) || def.label; return `${inst}${s.label ? ` (${s.label})` : ''}`;};
  const offered = new Map<string, number>(), ordered = data.nearest ? [...live].sort((a, b) => d2(a.at, w.me) - d2(b.at, w.me) || a.id.localeCompare(b.id)) : live;
  for (const s of ordered) {
    if (s.base === 'lie' && !LYING_SPOT.has(s.activity)) continue;
    if ((s.base === 'lie' && (s.activity === 'lie' || s.activity === 'nap')) || s.activity in GAME_ACTIVITIES || w.taken(s.at, s.id) || d2(s.at, w.me) > SPOT_REACH) continue;
    for (const activity of [s.activity, ...(s.also ?? [])]) {
      const def = SPOT_ACTIVITIES[activity], id = `${activity}:${s.id}`; if (plans.has(id)) continue;
      // a seat at a group someone is already waiting in ("join them") is always offered, past the nearest-N cap
      const joinable = !!s.together && w.groupSize(s.together.group) > 0;
      if (data.nearest) {const n = offered.get(activity) ?? 0; if ((n >= data.nearest && !joinable) || !ok(s)) continue; if (!joinable) offered.set(activity, n + 1);}
      // R5: a listener's seat is offered once someone is telling the story (its required spot is in use)
      const needs = s.requires ? data.spots.find(x => x.id === s.requires) : undefined, missing = !!needs && !w.taken(needs.at, needs.id);
      const waiting = s.together ? w.groupSize(s.together.group) : 0, withWho = s.together ? (waiting ? `; ${waiting} waiting on the other end, join them` : (s.together.alone === 'start' ? `; starts after ${s.together.wait} s, others may join` : `; waits up to ${s.together.wait} s for someone to join`)) : '';
      const painting = activity === 'paint' && s.paintingTarget ? {paintingTarget: s.paintingTarget,paintingLevel:s.level??0} : {};
      add({id, verb: activity, label: labelOf(s, activity) + withWho, available: !missing, ...(missing ? {blocked: {code: 'together.nobody-leading', reason: `Nobody is at ${needs!.label ?? needs!.id} yet; nothing to join. Start it yourself, or ask again later.`}} : {}), target: {id: s.id, kind: 'spot'}, params: {...secondsParam(def.seconds), ...('paintingTarget' in painting ? {painting: paintingParam()} : {})}}, {label: def.label, steps: activity === 'read' ? readAt(s) : spotSteps(s, undefined, activity), seconds: true, ...painting});
    }
  }
  // ---- CN5 choreographed games: each court's free places (its spots, then extra places beside them up to 6 players)
  for (const court of gameCourts(data.nearest ? live.filter(s => !(s.activity in GAME_ACTIVITIES) || ok(s)) : live, w)) {
    const playing = w.groupSize(court.group), full = playing >= (court.maxPlayers??GAME_MAX_PLAYERS);
    // a new player goes to the end/side with fewer players (a frisbee pair at the two ends, volleyball across the net)
    const used = (side: number) => court.slots.filter(x => x.side === side && w.taken(x.at, x.id)).length, sides = [...new Set(court.slots.map(x => x.side))], least = Math.min(...sides.map(used));
    for (const slot of court.slots) {
      if (w.taken(slot.at, slot.id) || d2(slot.at, w.me) > SPOT_REACH || used(slot.side) > least) continue;
      const def = SPOT_ACTIVITIES[court.activity], id = `${court.activity}:${slot.id}`; if (plans.has(id)) continue;
      add({id, verb: court.activity, label: `${def.label} (${slot.label}${playing ? `; ${playing} playing, join them` : '; a partner joins by taking another place here'})`, available: !full,
        ...(full ? {blocked: {code: 'game.full', reason: `${court.maxPlayers??GAME_MAX_PLAYERS} are already playing.`}} : {}), target: {id: slot.id, kind: 'spot'}, params: secondsParam(def.seconds)},
      {label: def.label, seconds: true, steps: [...standFirst(w), walk(slot.at), pose(court.activity, def.seconds, {group: court.group, waitSeconds: 120, alone: 'fail', need: 1, ...(slot.faceTo ? {face: slot.faceTo} : {}), game: court.game})]});
    }
  }
  return {caps, plans};
}

export type GameSlot = {id: string; spot: Spot; at: V2; faceTo?: V2; label: string;
  /** frisbee ends / volleyball sides (by facing); pétanque has one side. New players go to the side with fewer. */
  side: number};
export type GameCourt = {activity: string; group: string; game: {kind: 'frisbee' | 'petanque' | 'volleyball'; flightPolicy?:'clear-v1'; jack?: V2; net?: [number, number, number, number]}; slots: GameSlot[];maxPlayers?:number};
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Soul Actions entry 7: a frisbee place (an end or the triangle corner) stands clear of every solid by the flight margin the
 *  clear-v1 lane check pads upright obstacles with, plus slack for the clearance raster, so a court this builds can play:
 *  World's north park end sits inside the pond's rim and moves out past it. The capped clearance read tops out at 1 m. */
const FRISBEE_SLOT_CLEAR = r2(FLIGHT_MARGIN + 0.2);
/** CN5: game courts from World's game spots (one court per game and place): the shared group, the jack (pétanque: 7 m out
 *  along the players' facing) or net (volleyball: between the two sides), and up to six places — the spots, then extra places
 *  beside or behind them on clear ground at least a metre from every other place. Deterministic.
 *  Soul Actions entry 7: a frisbee court with two authored ends plays under `clear-v1` (no flight through a body or an upright
 *  solid) and gets one broad triangle corner instead of the padded places: pair + corner = 3 places, `maxPlayers` 3 (or 2 when
 *  neither corner is clear). Its places stand clear by `FRISBEE_SLOT_CLEAR`. Other courts keep the six places. */
export function gameCourts(spots: Spot[], w: Pick<ActivityWorld, 'clearance'>): GameCourt[] {
  const by = new Map<string, Spot[]>();
  for (const s of spots) if (s.activity in GAME_ACTIVITIES) {const k = s.activity + '|' + (s.place ?? ''); by.set(k, [...(by.get(k) ?? []), s]);}
  const out: GameCourt[] = [];
  for (const [, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sp = [...list].sort((a, b) => a.id.localeCompare(b.id)), activity = sp[0].activity, kind = GAME_ACTIVITIES[activity];
    const dir = (s: Spot): V2 => {const f = s.faceTo ?? [s.at[0], s.at[1] + 1], d = Math.hypot(f[0] - s.at[0], f[1] - s.at[1]) || 1; return [(f[0] - s.at[0]) / d, (f[1] - s.at[1]) / d];};
    const mean = (ps: V2[]): V2 => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    let game: GameCourt['game'] = kind==='frisbee'?{kind,flightPolicy:'clear-v1'}:{kind};
    if (kind === 'petanque') {const c = mean(sp.map(s => s.at)), d = mean(sp.map(dir)), n = Math.hypot(...d) || 1; game = {kind, jack: [r2(c[0] + d[0] / n * 7), r2(c[1] + d[1] / n * 7)]};}
    if (kind === 'volleyball') {
      // two sides by facing; the net halfway between them, across the line joining them
      const a = sp.filter(s => {const d = dir(s); return d[0] + d[1] * 1e-3 > 0;}), b = sp.filter(s => !a.includes(s));
      if (a.length && b.length) {const ca = mean(a.map(s => s.at)), cb = mean(b.map(s => s.at)), m: V2 = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2], L = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1, u: V2 = [-(cb[1] - ca[1]) / L, (cb[0] - ca[0]) / L];
        game = {kind, net: [r2(m[0] - u[0] * 5), r2(m[1] - u[1] * 5), r2(m[0] + u[0] * 5), r2(m[1] + u[1] * 5)]};}
    }
    const sideOf = (s: Spot) => {if (kind === 'petanque') return 0; const d = dir(s); return d[0] + d[1] * 1e-3 > 0 ? 0 : 1;};
    // a spot not on clear ground (World's north frisbee end lies inside the pond's rim) moves forward along its facing to the
    // first clear point within 6 m; one with none is left out. A frisbee end needs the flight margin (entry 7), not just room to stand.
    const minClear = kind === 'frisbee' ? FRISBEE_SLOT_CLEAR : 0.35;
    const clearAt = (s: Spot): V2 | null => {const d = dir(s); for (let t = 0; t <= 6; t += 0.25) {const p: V2 = [r2(s.at[0] + d[0] * t), r2(s.at[1] + d[1] * t)]; if (w.clearance(p[0], p[1]) >= minClear) return p;} return null;};
    const slots: GameSlot[] = sp.flatMap(s => {const at = clearAt(s); return at ? [{id: s.id, spot: s, at, ...(s.faceTo ? {faceTo: s.faceTo} : {}), label: s.label ?? s.id, side: sideOf(s)}] : [];});
    if(kind==='frisbee'&&slots.length===2){
      const [a,b]=slots,dx=b.at[0]-a.at[0],dz=b.at[1]-a.at[1],d=Math.hypot(dx,dz),centre:V2=[(a.at[0]+b.at[0])/2,(a.at[1]+b.at[1])/2];
      if(d>=3)for(const sign of [1,-1]){const at:V2=[r2(centre[0]-dz*Math.sqrt(3)/2*sign),r2(centre[1]+dx*Math.sqrt(3)/2*sign)];if(w.clearance(at[0],at[1])<FRISBEE_SLOT_CLEAR)continue;slots.push({id:a.id+'.triangle',spot:a.spot,at,faceTo:centre,label:'triangle corner',side:2});break;}
      out.push({activity,group:`game-${kind}-${sp[0].id}`.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,80),game,slots,maxPlayers:slots.length});continue;
    }
    for (let k = 0; slots.length < GAME_MAX_PLAYERS && k < 40; k++) {
      const base = slots.filter(x => !x.id.includes('.p'))[k % Math.max(1, slots.filter(x => !x.id.includes('.p')).length)]; if (!base) break;
      const s = base.spot, d = dir(s), perp: V2 = [-d[1], d[0]], j = Math.floor(k / Math.max(1, slots.filter(x => !x.id.includes('.p')).length));
      // beside it (±1.4 m, ±2.8 m), then a step behind and beside
      const off = [[1.4, 0], [-1.4, 0], [2.8, 0], [-2.8, 0], [0, -1.3], [1.4, -1.3], [-1.4, -1.3]][j]; if (!off) break;
      const at: V2 = [r2(base.at[0] + perp[0] * off[0] + d[0] * off[1]), r2(base.at[1] + perp[1] * off[0] + d[1] * off[1])];
      if (slots.some(o => d2(o.at, at) < 1.0) || w.clearance(at[0], at[1]) < 0.35) continue;
      const faceTo: V2 | undefined = s.faceTo ? [r2(s.faceTo[0] + perp[0] * off[0]), r2(s.faceTo[1] + perp[1] * off[0])] : undefined;
      slots.push({id: `${s.id}.p${slots.length + 1}`, spot: s, at, ...(faceTo ? {faceTo} : {}), label: `${s.label ?? s.id}, beside`, side: sideOf(s)});
    }
    out.push({activity, group: `game-${kind}-${sp[0].id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80), game, slots});
  }
  return out;
}
