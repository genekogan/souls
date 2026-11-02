// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): a body takes a generic activity pose where it is for a
// number of seconds — reading, painting, playing the piano, lying on the grass, napping — and then returns to its
// base posture. Pure body state (human.activity / baseActivity / prop / seatHeight); no items, needs or economy.
// Overlays keep a native seat that is already held (they are submitted after it, so their write wins each tick,
// the same convention as items/drink.ts).
// together/1 (core-next4): a pose with a `group` waits (up to waitSeconds) for the other bodies posing with the same group,
// then all start together and end at one shared tick; with `gap` the two step in to face each other at that distance
// (hug, handshake, high-five, dance together, give/take). `hold`/`release` set or clear the item carried in the hand
// (`human.holding`, drawn as `human.prop` whenever no activity prop is shown) when the pose completes.
// together/1 window policy `once-v1` (E2 #2, prospective; set by edge invitations from 2026-10-16, so older logs replay
// unchanged): a group opens its shared window once. A body whose window has passed (still settling after a courtesy step,
// its `until` stale) is no partner and never seeds a second "shared" window. A guest who arrives after the window visibly
// closed does the pose alone at once (no wait), marked `late` in its body state and its outputs.
import { z } from 'zod';
import {frisbeeLaneIssue,FRISBEE_CLEAR_WINDUP} from './frisbee-clearance.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import {DT, type Runtime} from '../runtime/runtime.ts';
import { dcos, dsin, heading, hypot, wrapAngle, angleDelta, clamp, type Vec2 } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { seatFitProblem } from '../bodies/humanoid.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { RPS, RPS_SHAPES, type RpsShape } from './rps.ts';
import { trackHandGame } from './hand-hold.ts';

/** Overlay activities (upper body; drawn on top of baseActivity). */
export const POSE_OVERLAYS = ['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter', 'wave', 'operate',
  // gestures (core-next4): solo, and the hand-over pair give/take; pick-up/put-down an item
  'bow', 'clap', 'nod', 'shake-head', 'point', 'cheer', 'give', 'take', 'pick-up', 'put-down',
  // CN5: at a desk computer, at a microphone, in an audience, with dumbbells
  'use-computer', 'sing', 'listen', 'lift-weights',
  // todo (leisure): fishing from a bank, tossing bread, tending garden beds; on a swing or a see-saw seat, picnicking
  'fish', 'feed', 'garden', 'swing', 'seesaw', 'picnic',
  // R5: telling a story to a circle (standing, talking with the hands)
  'tell-story'] as const;
/** Whole-body postures on open ground (the body point stays; the viewer lays the body out along pose.yaw). */
export const POSE_POSTURES = ['sit-ground', 'lie', 'nap', 'pushups', 'situps', 'yoga',
  // CN5: lying on a gym bench (seatHeight = the bench top)
  'bench-press',
  // todo (leisure): lying in a hammock (seatHeight = the cloth), lying back on the grass to watch the stars
  'hammock', 'stargaze'] as const;
/** Standing whole-body exercise/expression poses (cyclic; the viewer animates them from the tick). */
export const POSE_MOVES = ['dance', 'jump', 'stretch', 'jumping-jacks',
  // paired touch gestures (core-next4): both bodies face each other at `gap` and share one start and end
  'hug', 'high-five', 'handshake',
  // entry 35: rock-paper-scissors face to face (social/rps.ts; paired, ready-v1)
  'rps',
  // CN5: outdoor gym bars; choreographed games (grouped: the world keeps the turns, see `game`)
  'pull-ups', 'dips', 'play-frisbee', 'play-petanque', 'play-volleyball'] as const;
export const POSE_ACTIVITIES: readonly string[] = [...POSE_OVERLAYS, ...POSE_POSTURES, ...POSE_MOVES];
export const POSE_PROPS = ['book', 'brush', 'pen', 'letter', 'cup', 'plate', 'tool', 'cards', 'flower', 'food', 'frisbee', 'dumbbell', 'boule', 'rod', 'bread', 'spoon'] as const;
/** CN5: the instrument a `play-music` body plays (World draws it at the spot; the body state names it). */
export const POSE_INSTRUMENTS = ['drums', 'keyboard', 'guitar', 'bass', 'violin', 'viola', 'cello', 'piano', 'flute', 'ukulele'] as const;
/** CN5 choreographed games: no physics. The world keeps whose turn it is (a pure function of the tick and the players in
 *  the group, sorted), so every body and the viewer agree: turn k lasts `period` s, the throw leaves at `windup` and
 *  arrives `flight` s later. frisbee: thrower → next player (a held frisbee's owner starts); volleyball: the rally
 *  alternates over the net; petanque: each throws in turn towards the jack, two boules each per end, the nearest wins it. */
export const GAMES = { frisbee: { period: 3.2, windup: 0.7, flight: 1.5 }, volleyball: { period: 2.6, windup: 0.4, flight: 1.4 }, petanque: { period: 7, windup: 1.6, flight: 1.4 } } as const;
export type GameKind = keyof typeof GAMES;
/** Public game state on each player's body (human.game); the viewer draws the disc/ball/boules from it. */
export type GameState = { kind: GameKind; group: string; players: string[]; flightPolicy?: 'clear-v1'; releaseTick?: number; releaseFrameTick?: number; releaseFrom?: number; joinedAt?:number; waiting?: boolean; since?: number; turn?: number; from?: string; to?: string | null; throwTick?: number; landTick?: number;
  /** petanque: the jack, where this turn's boule lands, this end's landed boules, the last end's winner, and this body's ends won. */
  jack?: [number, number]; at?: [number, number]; boules?: { by: string; at: [number, number] }[]; end?: number; lastWinner?: string | null; wins?: number };
/** together/1: speed of the short step-in to the paired distance (m/s). */
const STEP_IN_SPEED = 0.6;
/** together/1: partners further apart than this never pair (m). */
const PAIR_REACH = 4;
const OVERLAY = new Set<string>(POSE_OVERLAYS), POSTURE = new Set<string>([...POSE_POSTURES, ...POSE_MOVES]), LYING = new Set(['lie', 'nap', 'pushups', 'situps', 'yoga', 'bench-press', 'hammock', 'stargaze']);
/** CN5: players of a game are found within this distance (a frisbee lawn's ends are 14 m apart). */
const GAME_REACH = 30;
/** Open ground a lying body needs around its point (m). */
export const LIE_CLEARANCE = 0.9;
/** An in-place dance keeps the standing body's root and ordinary standing footprint. */
export const DANCE_CLEARANCE = HUMAN_RADIUS;

type Params = { actor: string; activity: string; seconds: number; prop?: string; base?: 'sit' | 'idle'; seatHeight?: number; face?: Vec2;
  group?: string; pairedPolicy?: 'ready-v1'; windowPolicy?: 'once-v1'; waitSeconds?: number; alone?: 'start' | 'fail'; gap?: number; need?: number; hold?: string; release?: boolean;
  /** hotfix: stepping in or back for a paired gesture never brings this body closer to anyone else than it already is
   *  (once within arm's reach of them); prospective, set by edge plans, so earlier logs replay unchanged. */
  clear?: boolean;
  /** CN5: the instrument played (play-music) and a choreographed game (grouped). */
  instrument?: string; game?: { kind: GameKind; flightPolicy?: 'clear-v1'; jack?: Vec2; net?: [number, number, number, number] };
  /** CN5: keep the scenery seat height when the pose is done together (grouped). */
  seatTogether?: boolean;
  /** Entry 36 (prospective, set by edge plans for a mic stand): singing along. The pose lasts only while someone plays
   *  within `radius` m (the piano, or the drums), checked twice a second; it fails after `grace` s with no music at all,
   *  and ends (completed) 1.5 s after the music it sang along with stops. */
  accompany?: { radius: number; grace: number };
  /** entry 35: this body's rock-paper-scissors choice (published only from the shoot beat). */
  throw?: RpsShape };
type Exec = { id: string; p: Params; base: string; at: number[]; t: number; yaw: number | null;
  /** together/1: 'waiting' for partners, then 'active' until the shared end tick. */
  phase?: 'waiting' | 'active'; readyAt?: number; waited?: number; until?: number; mobile?: boolean; close?: boolean;
  /** CN5 games: ticks with nobody to play with, the last petanque end seen and the ends this body won. */
  lonely?: number; end?: number; wins?: number; since?: number; joinedAt?:number;
  /** once-v1: this body arrived after its group's window had closed and does the pose alone. */
  late?: boolean;
  /** Entry 36 accompany: seconds since the last check found music (undefined: none heard yet), and whether any was. */
  quiet?: number; heard?: boolean; gameRelease?: {at:number; frame:number; from:number; diagnostic?:Diagnostic} };
/** together/1 public body state while a grouped pose runs (the viewer may draw open arms while waiting). */
export type TogetherState = { group: string; phase: 'waiting' | 'active'; until?: number; mobile: boolean; pairedPolicy?: 'ready-v1'; readyAt?: number; windowPolicy?: 'once-v1'; late?: true };
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'pose.' + code, message, subjects });

function admission(rt: Runtime, p: Params): Diagnostic | null {
  const a = rt.world.entities[p.actor], h = a?.human;
  if (!h || a.kind !== 'human') return issue('not-human', `${p.actor} is not a person`, [p.actor]);
  if (h.grip || h.riding || h.on || h.shore || h.carrier || h.sleepPose || (h as { boatPassenger?: unknown }).boatPassenger) return issue('occupied-support', 'Leave the climb, load, water, ride or mat first.', [p.actor]);
  // seat fit (bodies/humanoid.ts): a scenery seat's top must suit the body's height (today's body: 0.2–1.2 m, the schema's range)
  // a picnic sits on the blanket, i.e. on the ground: any body fits (SPOTS 2026-10-22: a tall Soul was refused seat-too-low)
  if (p.seatHeight !== undefined && !LYING.has(p.activity) && p.activity !== 'picnic') { const fit = seatFitProblem(a.body, p.seatHeight); if (fit) return issue(fit.code.replace('.', '-'), `This seat does not fit your body: ${fit.message}.`, [p.actor]); }
  // together/1: a grouped pose may start while someone's make-way nudge steps this body aside (it settles first)
  if (rt.holder('actor:' + p.actor).some((id) => rt.records.get(id)?.verb === 'walk_to' && !(p.group && nudge(id)))) return issue('not-still', 'Finish walking first.', [p.actor]);
  const seated = h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity));
  if (POSTURE.has(p.activity)) {
    if (seated) return issue('seated', 'Stand up before lying or sitting on the ground.', [p.actor]);
    const sp = rt.services.spatial as Spatial | undefined;
    // together/1: a standing gesture done with someone (hug, dance together…) needs only the ground the body already stands on
    const standingTogether = !!p.group && !LYING.has(p.activity);
    // CN5: lying on furniture (a gym bench: seatHeight) needs the bench, not open ground
    const onFurniture = LYING.has(p.activity) && p.seatHeight !== undefined;
    if (sp && !standingTogether && !onFurniture) {
      sp.sync(rt.world);
      // Admission previews do not focus Runtime's actor window. Read this position explicitly;
      // an unrelated Soul's last query must not turn open ground into an out-of-grid zero.
      const at: Vec2 = [a.pose.p[0], a.pose.p[2]], read = sp.clearanceReader(h.level, at);
      const need = LYING.has(p.activity) ? LIE_CLEARANCE : p.activity === 'dance' ? DANCE_CLEARANCE : HUMAN_RADIUS + 0.1;
      if ((read && read(at) < need) || (!read && p.activity === 'dance')) return issue('no-room', p.activity === 'dance'
        ? 'There is not enough supported standing room here to dance without intersecting an obstacle.'
        : 'There is not enough open ground here to lie down; step onto open grass first.', [p.actor]);
    }
  }
  return null;
}
/** walk.ts makeWay: a transient courtesy step aside, not a new owner of the body. */
const nudge = (id: string) => /:make-way:\d+$/.test(id) || id.includes(':make-way:');
/** together/1: a courtesy step aside is moving this body right now (the grouped pose waits, writing nothing). */
const nudged = (rt: Runtime, actor: string) => rt.holder('actor:' + actor).some((id) => rt.records.get(id)?.verb === 'walk_to' && nudge(id));
const restore = (rt: Runtime, ex: Exec) => {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  if (h.activity === ex.p.activity || (ex.phase && h.activity === 'walk')) h.activity = ex.base === 'sit' && !held(rt, ex.p.actor) ? 'idle' : ex.base;
  delete h.baseActivity; delete h.seatHeight; delete h.partner; delete h.together; delete h.instrument; delete h.game; if (ex.phase) delete h.speed;
  // entry 35: a count's state stays a moment after it ends (`end`), cleared by social/hand-hold.ts stepHandHolds
  if (h.rps && h.rps.end === undefined) { h.rps = { ...h.rps, end: rt.tick }; trackHandGame(rt, ex.p.actor); }
  // together/1: a carried item stays in the hand between activities
  if (h.holding) h.prop = h.holding; else delete h.prop;
};
/** Versioned cleanup releases the gesture without erasing an actual courtesy walk. */
const restorePaired=(rt:Runtime,ex:Exec)=>{const h=rt.world.entities[ex.p.actor]?.human,moving=!!h&&nudged(rt,ex.p.actor),activity=h?.activity,speed=h?.speed;restore(rt,ex);if(h&&moving){h.activity=activity!;if(speed!==undefined)h.speed=speed;}};
/** together/1: the other bodies posing with this group (sorted by id: deterministic), nearest first for the paired one. */
const partnersOf = (rt: Runtime, ex: Exec) => {
  const me = rt.world.entities[ex.p.actor];
  return Object.values(rt.world.entities).filter((e) => e.id !== ex.p.actor && e.kind === 'human' && e.human?.together?.group === ex.p.group && (e.human?.level ?? 0) === (me.human!.level ?? 0)
    && hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) <= (ex.p.game ? GAME_REACH : PAIR_REACH * (ex.p.gap ? 1 : 3)))
    .sort((a, b) => hypot(a.pose.p[0] - me.pose.p[0], a.pose.p[2] - me.pose.p[2]) - hypot(b.pose.p[0] - me.pose.p[0], b.pose.p[2] - me.pose.p[2]) || (a.id < b.id ? -1 : 1));
};
/** A native seat (sit / take_slot) this actor still holds. */
const held = (rt: Runtime, actor: string) => rt.holder('actor:' + actor).some((id) => ['sit', 'take_slot'].includes(rt.records.get(id)?.verb ?? ''));

export const poseV1: ActionDef<Params, true, Exec> = {
  verb: 'pose_v1',
  navPure: true, // L4 audit: the step writes only its own actor's body (pose, human fields); it submits and cancels nothing
  description: 'activities/1: take a generic activity pose where you are (read, browse, write, play-piano, play-music, paint, eat, drink, cook, play-game, craft, post-letter, wave, use-computer, sing, listen, lift-weights over a seat or standing; sit-ground, lie, nap, pushups, situps, yoga on open ground, bench-press on a bench; dance, jump, stretch, jumping-jacks, pull-ups, dips standing; play-frisbee, play-petanque, play-volleyball as choreographed group games) for a number of seconds, optionally holding a prop and facing a point, then return to the base posture.',
  schema: z.object({ actor: z.string().min(1).max(80), activity: z.enum(POSE_ACTIVITIES as [string, ...string[]]), seconds: z.number().min(0.5).max(3600), prop: z.enum(POSE_PROPS).optional(), base: z.enum(['sit', 'idle']).optional(), seatHeight: z.number().min(0.2).max(1.2).optional(), face: z.tuple([z.number(), z.number()]).optional(),
    group: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(), pairedPolicy: z.literal('ready-v1').optional(), windowPolicy: z.literal('once-v1').optional(), waitSeconds: z.number().min(0).max(180).optional(), alone: z.enum(['start', 'fail']).optional(),
    gap: z.number().min(0.5).max(2.5).optional(), need: z.number().int().min(1).max(8).optional(), hold: z.enum(POSE_PROPS).optional(), release: z.boolean().optional(), clear: z.boolean().optional(),
    instrument: z.enum(POSE_INSTRUMENTS).optional(), seatTogether: z.boolean().optional(), throw: z.enum(RPS_SHAPES).optional(),
    accompany: z.object({ radius: z.number().min(1).max(40), grace: z.number().min(0).max(30) }).strict().optional(),
    game: z.object({ kind: z.enum(Object.keys(GAMES) as [GameKind, ...GameKind[]]), flightPolicy:z.literal('clear-v1').optional(), jack: z.tuple([z.number(), z.number()]).optional(), net: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }).strict().optional() }).strict()
    .refine(p => !p.pairedPolicy || (!!p.group && p.gap !== undefined && ['hug','high-five','handshake','dance','rps'].includes(p.activity) && !p.game && !p.hold && !p.release), {message:'ready-v1 requires a paired limb gesture with group and gap'})
    .refine(p=>!p.game?.flightPolicy||p.game.kind==='frisbee',{message:'clear-v1 is only a frisbee policy'})
    .refine((p) => !p.game || (!!p.group && p.activity === 'play-' + p.game.kind), { message: 'a game needs a group and its own play-<game> activity' })
    .refine((p) => (p.activity === 'rps') === (p.throw !== undefined) && (p.activity !== 'rps' || p.pairedPolicy === 'ready-v1'), { message: 'rps needs a throw and the ready-v1 paired policy (and only rps has a throw)' })
    .refine((p) => !p.windowPolicy || (!!p.group && !p.pairedPolicy && !p.game), { message: 'once-v1 is a group activity window (not a paired gesture or a game)' }),
  reservations: (_w, p) => [{ resource: 'hand:' + p.actor + ':left', mode: 'exclusive' }, { resource: 'hand:' + p.actor + ':right', mode: 'exclusive' }, { resource: 'pose:' + p.actor, mode: 'exclusive' }],
  plan(rt, p) { const d = admission(rt, p); return d ? { ok: false, diagnostic: d } : { ok: true, program: true }; },
  start(rt, p, _plan, id) {
    const a = rt.world.entities[p.actor], h = a.human!;
    const base = POSTURE.has(p.activity) ? 'idle' : h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity)) || p.base === 'sit' ? 'sit' : 'idle';
    const yaw = p.face && hypot(p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]) > 0.05 ? heading([p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]]) : null;
    return { id, p: structuredClone(p), base, at: [...a.pose.p], t: 0, yaw, ...(p.group ? { phase: 'waiting' as const, waited: 0, mobile: !held(rt, p.actor) } : {}) };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor], h = a?.human;
    if (!h) return { status: 'failed', diagnostic: issue('not-human', 'the body is gone', [ex.p.actor]) };
    if(ex.gameRelease)return releaseGameStep(rt,ex,dt);
    if (ex.phase && nudged(rt, ex.p.actor)) {
      if(ex.p.pairedPolicy){if(ex.phase==='active')ex.phase='waiting';delete ex.readyAt;h.together={group:ex.p.group!,phase:ex.phase,mobile:!!ex.mobile,pairedPolicy:ex.p.pairedPolicy,...(ex.until===undefined?{}:{until:ex.until})};if(ex.phase==='waiting'&&ex.until===undefined&&(ex.waited=(ex.waited??0)+1)>Math.round((ex.p.waitSeconds??30)/dt)){restorePaired(rt,ex);return {status:'failed',diagnostic:issue('pair-not-ready','The paired gesture could not settle in time.',[ex.p.actor])};}}
      ex.at = [...a.pose.p]; return { status: 'running', phase: 'settling' }; }
    if (ex.phase) ex.at = [...a.pose.p];   // a grouped pose carries on from wherever a courtesy step left the body
    if (a.pose.p.some((n, i) => Math.abs(n - ex.at[i]) > 1e-6)) { restore(rt, ex); return { status: 'failed', diagnostic: issue('moved', 'The body moved; the activity ended.', [ex.p.actor]) }; }
    if(ex.p.game?.flightPolicy==='clear-v1'&&ex.p.group){const blocked=frisbeeLaneIssue(rt,ex.p.group,ex.p.actor);if(blocked){if(beginGameRelease(rt,ex,dt,blocked))return releaseGameStep(rt,ex,dt);restore(rt,ex);return {status:'failed',diagnostic:blocked};}}
    if (ex.phase) return together(rt, ex, a, h, dt);
    if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;  // a body on a native seat keeps the seat's facing
    h.activity = ex.p.activity;
    if (OVERLAY.has(ex.p.activity)) h.baseActivity = ex.base; else delete h.baseActivity;
    if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; else delete h.prop;
    if ((ex.base === 'sit' || LYING.has(ex.p.activity)) && ex.p.seatHeight !== undefined && !held(rt, ex.p.actor)) h.seatHeight = ex.p.seatHeight; else delete h.seatHeight;
    if (ex.p.instrument) h.instrument = ex.p.instrument;
    ex.t += dt;
    if (ex.p.accompany) { const ended = accompanied(rt, ex, a, dt); if (ended) return ended; }
    if (ex.t + 1e-9 < ex.p.seconds) return { status: 'running', phase: 'posing' };
    return finish(rt, ex);
  },
  cancel(rt, ex) { if(ex.gameRelease||beginGameRelease(rt,ex,DT))return {ok:true,deferred:true}; if(ex.p.pairedPolicy)restorePaired(rt,ex);else restore(rt, ex); return { ok: true }; },
  resumable: true,
};

/** Entry 36: someone plays music a singer can sing along with (the viewer voices the piano's melody, or the drummer's
 *  piece on the same grid). Only these are heard in the viewer, so only these count. Read from `human.instrument`, which
 *  a playing pose sets and its end clears (its `activity` reads `sit` mid-tick, before the seated pose writes it again). */
const ACCOMPANIES = (h: { instrument?: string }) => h.instrument === 'piano' || h.instrument === 'drums' || h.instrument === 'keyboard';
const MUSIC_CHECK = 0.5, MUSIC_ENDED = 1.5;
/** A singing-along pose: every MUSIC_CHECK s, is a musician within the radius? Work only while a body sings. */
function accompanied(rt: Runtime, ex: Exec, a: NonNullable<Runtime['world']['entities'][string]>, dt: number) {
  const every = Math.max(1, Math.round(MUSIC_CHECK / dt)), k = Math.round(ex.t / dt);
  ex.quiet = (ex.quiet ?? 0) + dt;
  if (k % every === 0) {
    const { radius } = ex.p.accompany!, lv = a.human?.level ?? 0;
    for (const o of Object.values(rt.world.entities)) if (o.kind === 'human' && o.id !== a.id && o.human && (o.human.level ?? 0) === lv && ACCOMPANIES(o.human) && hypot(o.pose.p[0] - a.pose.p[0], o.pose.p[2] - a.pose.p[2]) <= radius) { ex.heard = true; ex.quiet = 0; break; }
  }
  if (ex.heard && (ex.quiet ?? 0) >= MUSIC_ENDED - 1e-9) { const out = finish(rt, ex); return { ...out, outputs: { ...out.outputs, ended: 'music-stopped' } }; }
  if (!ex.heard && ex.t + 1e-9 >= ex.p.accompany!.grace) { restore(rt, ex); return { status: 'failed' as const, diagnostic: issue('no-music', 'Nothing is playing near the microphone to sing along with (a piano or drums), so the singing did not start.', [ex.p.actor]) }; }
  return null;
}

/** New frisbee policy: stop the flight immediately, lower the frozen arms before releasing reservations. */
function beginGameRelease(rt:Runtime,ex:Exec,dt:number,diagnostic?:Diagnostic):boolean{
 const h=rt.world.entities[ex.p.actor]?.human,g=h?.game;
 if(ex.p.game?.flightPolicy!=='clear-v1'||!h||!g||g.waiting||g.throwTick===undefined)return false;
 const frame=rt.tick-1,age=Math.max(0,(frame-(g.joinedAt??g.since??frame))*dt)/1.2,x=Math.min(1,age),from=x*x*(3-2*x);
 ex.gameRelease={at:rt.tick,frame,from,...(diagnostic?{diagnostic}:{})};
 h.game={...g,waiting:true,releaseTick:rt.tick,releaseFrameTick:frame,releaseFrom:from};delete h.together;
 return true;
}
function releaseGameStep(rt:Runtime,ex:Exec,dt:number){
 const r=ex.gameRelease!;if((rt.tick-r.at)*dt<1.2)return {status:'running' as const,phase:'lowering-hands'};
 restore(rt,ex);return r.diagnostic?{status:'failed' as const,diagnostic:r.diagnostic}:{status:'completed' as const,outputs:{seconds:ex.p.seconds,group:ex.p.group}};
}

/** Completed: the hand item changes (hold/release), then the base posture returns. */
function finish(rt: Runtime, ex: Exec) {
  const h = rt.world.entities[ex.p.actor]?.human;
  if (h && ex.p.release) delete h.holding;
  if (h && ex.p.hold) h.holding = ex.p.hold;
  restore(rt, ex);
  return { status: 'completed' as const, outputs: { seconds: ex.p.seconds, ...(ex.p.group ? { group: ex.p.group } : {}), ...(ex.late ? { late: true } : {}) } };
}

/** together/1: wait for the group, start together, step in to `gap` facing the partner, end at the shared tick. */
function together(rt: Runtime, ex: Exec, a: NonNullable<Runtime['world']['entities'][string]>, h: NonNullable<typeof a.human>, dt: number) {
  if(ex.p.pairedPolicy)return pairedReadyV1(rt,ex,a,h,dt);
  const tick = rt.tick, ticks = (s: number) => Math.round(s / dt), once = ex.p.windowPolicy === 'once-v1';
  // once-v1: a body whose window has passed is no partner (it may still be settling with its stale `until`)
  const near = partnersOf(rt, ex), others = once ? near.filter((o) => (o.human!.together!.until ?? Infinity) > tick) : near, partner = others[0];
  const closed = once && !others.length && near.length > 0;
  const faceTo = (q: number[]) => { if (!held(rt, ex.p.actor) && hypot(q[0] - a.pose.p[0], q[2] - a.pose.p[2]) > 0.05) a.pose.yaw = heading([q[0] - a.pose.p[0], q[2] - a.pose.p[2]]); };
  if (h.prop === undefined || ex.p.prop) { if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; }
  if (ex.phase === 'waiting') {
    const going = others.find((o) => o.human!.together!.phase === 'active' && (o.human!.together!.until ?? 0) > tick);
    if (going) { ex.phase = 'active'; ex.until = going.human!.together!.until!; }
    else if (others.length >= (ex.p.need ?? 1)) { ex.phase = 'active'; ex.until = tick + ticks(ex.p.seconds); }
    else if (closed) {
      // once-v1: the group's window already closed before this body arrived: alone at once (or refused, alone:'fail')
      if (ex.p.alone !== 'start') { restore(rt, ex); return { status: 'failed' as const, diagnostic: issue('window-closed', 'They had already finished before you got there.', [ex.p.actor]) }; }
      ex.phase = 'active'; ex.until = tick + ticks(ex.p.seconds); ex.late = true;
    }
    else if ((ex.waited = (ex.waited ?? 0) + 1) > ticks(ex.p.waitSeconds ?? 30)) {
      // a game: say why plainly (a late joiner finds the court empty when the last player's 30 s lonely wait ran out first)
      if (ex.p.alone !== 'start') { restore(rt, ex); return { status: 'failed' as const, diagnostic: issue('partner-absent', ex.p.game ? 'Nobody was playing here when you arrived and nobody came to play in time (a game ends 30 s after its last partner leaves).' : 'Nobody came to do it with you in time.', [ex.p.actor]) }; }
      ex.phase = 'active'; ex.until = tick + ticks(ex.p.seconds);
    } else {
      h.together = { group: ex.p.group!, phase: 'waiting', mobile: !!ex.mobile, ...(once ? { windowPolicy: 'once-v1' as const } : {}) };
      if (partner) faceTo(partner.pose.p); else if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;
      if (h.activity !== ex.base) h.activity = ex.base === 'sit' && !held(rt, ex.p.actor) ? 'idle' : ex.base;
      return { status: 'running' as const, phase: 'waiting-for-partner' };
    }
  }
  h.together = { group: ex.p.group!, phase: 'active', until: ex.until, mobile: !!ex.mobile, ...(once ? { windowPolicy: 'once-v1' as const } : {}), ...(ex.late ? { late: true as const } : {}) };
  if (ex.p.game) return playGame(rt, ex, a, h, others, dt);
  if (ex.p.gap) {
    // a paired gesture ends when its partner has gone (no hugging the air)
    if (!partner) { if (ex.close) return finish(rt, ex); }
    else {
      h.partner = partner.id; faceTo(partner.pose.p);
      const d = hypot(partner.pose.p[0] - a.pose.p[0], partner.pose.p[2] - a.pose.p[2]), left = d - ex.p.gap;
      if (Math.abs(left) > 0.03 && ex.mobile && !ex.close) {
        // step in (or back, when already closer than the gesture needs): share the distance with a mobile partner; stay on clear ground
        const share = partner.human!.together?.mobile ? 2 : 1, move = Math.sign(left) * Math.min(STEP_IN_SPEED * dt, Math.abs(left) / share), ux = (partner.pose.p[0] - a.pose.p[0]) / d, uz = (partner.pose.p[2] - a.pose.p[2]) / d;
        const nx = a.pose.p[0] + ux * move, nz = a.pose.p[2] + uz * move, sp = rt.services.spatial as Spatial | undefined, g = sp?.level(h.level);
        // never closer to a wall or bench than the body already is (people may stand near furniture)
        const clear = (x: number, z: number) => g ? clearanceAt(g, [x, z]) : Infinity, next = clear(nx, nz);
        // hotfix (`clear`): nor into a bystander — never nearer than two bodies plus a hand's width to anyone but the partner,
        // unless already that near and not getting nearer
        const people = ex.p.clear ? Object.values(rt.world.entities).filter((o) => o.id !== a.id && o.id !== partner.id && o.kind === 'human' && (o.human?.level ?? 0) === (h.level ?? 0)) : [];
        const nearest = (x: number, z: number) => people.reduce((m, o) => Math.min(m, hypot(o.pose.p[0] - x, o.pose.p[2] - z)), Infinity), apart = 2 * HUMAN_RADIUS + 0.04;
        const roomy = !people.length || nearest(nx, nz) >= apart || nearest(nx, nz) >= nearest(a.pose.p[0], a.pose.p[2]);
        if (roomy && (next >= HUMAN_RADIUS - 0.02 || next >= clear(a.pose.p[0], a.pose.p[2]))) {
          a.pose.p = [nx, a.pose.p[1], nz]; ex.at = [...a.pose.p]; h.activity = 'walk'; h.speed = Math.round(Math.abs(move) / dt * 1000) / 1000;
          return tick >= ex.until! ? finish(rt, ex) : { status: 'running' as const, phase: 'stepping-in' };
        }
      }
      ex.close = true;
    }
    delete h.speed;
  } else if (partner && !held(rt, ex.p.actor) && ex.yaw === null && !POSTURE.has(ex.p.activity)) faceTo(partner.pose.p);
  else if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;
  h.activity = ex.p.activity;
  if (OVERLAY.has(ex.p.activity)) h.baseActivity = ex.base; else delete h.baseActivity;
  if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; else delete h.prop;
  // CN5: done together at a scenery seat or bench, or at an instrument: the same seat height and instrument as alone
  // (prospective: only poses that ask for it with `seatTogether`, so earlier grouped poses replay unchanged)
  if (ex.p.seatTogether && (ex.base === 'sit' || LYING.has(ex.p.activity)) && ex.p.seatHeight !== undefined && !held(rt, ex.p.actor)) h.seatHeight = ex.p.seatHeight;
  if (ex.p.instrument) h.instrument = ex.p.instrument;
  if (tick >= ex.until!) return finish(rt, ex);
  return { status: 'running' as const, phase: 'together' };
}

/** Prospective paired-ready/1: contact/settling precedes the shared expression window.
 * No-policy executions continue through together/1 unchanged, including snapshot restores. */
function pairedReadyV1(rt:Runtime,ex:Exec,a:NonNullable<Runtime['world']['entities'][string]>,h:NonNullable<typeof a.human>,dt:number){
 const tick=rt.tick,partner=partnersOf(rt,ex)[0],ticks=(s:number)=>Math.round(s/dt);
 const publish=()=>{h.together={group:ex.p.group!,phase:ex.phase!,mobile:!!ex.mobile,pairedPolicy:'ready-v1',...(ex.until===undefined?{}:{until:ex.until}),...(ex.readyAt===undefined?{}:{readyAt:ex.readyAt})};};
 const fail=(code:string,message:string)=>{restorePaired(rt,ex);return {status:'failed' as const,diagnostic:issue(code,message,[ex.p.actor,...(partner?[partner.id]:[])])};};
 if(ex.phase==='active'&&partner&&(nudged(rt,partner.id)||partner.human!.together?.readyAt===undefined||Math.abs(hypot(partner.pose.p[0]-a.pose.p[0],partner.pose.p[2]-a.pose.p[2])-ex.p.gap!)>.03)){ex.phase='waiting';delete ex.readyAt;}
 if(ex.phase==='waiting'){
  if(ex.until!==undefined&&tick>=ex.until)return finish(rt,ex);
  if(ex.until===undefined&&(ex.waited=(ex.waited??0)+1)>ticks(ex.p.waitSeconds??30))return fail('pair-not-ready','Both partners could not meet and settle in time.');
  if(!partner){delete ex.readyAt;publish();h.activity=ex.base;return {status:'running' as const,phase:'waiting-for-partner'};}
  if(partner.human!.together?.pairedPolicy!=='ready-v1')return fail('pair-policy-mismatch','Partners must use the same explicit paired policy.');
  const d=hypot(partner.pose.p[0]-a.pose.p[0],partner.pose.p[2]-a.pose.p[2]),left=d-ex.p.gap!;
  if(d<1e-9)return fail('pair-overlap','Partners cannot step in from overlapping body centres.');
  if(nudged(rt,partner.id)){delete ex.readyAt;publish();h.activity=ex.base;return {status:'running' as const,phase:'waiting-for-settling'};}
  if(Math.abs(left)>.03){
   delete ex.readyAt;const share=partner.human!.together?.mobile?2:1,move=Math.sign(left)*Math.min(STEP_IN_SPEED*dt,Math.abs(left)/share),ux=(partner.pose.p[0]-a.pose.p[0])/d,uz=(partner.pose.p[2]-a.pose.p[2])/d;
   const nx=a.pose.p[0]+ux*move,nz=a.pose.p[2]+uz*move,sp=rt.services.spatial as Spatial|undefined,g=sp?.level(h.level),clear=(x:number,z:number)=>g?clearanceAt(g,[x,z]):Infinity,next=clear(nx,nz);
   const people=ex.p.clear?Object.values(rt.world.entities).filter(o=>o.id!==a.id&&o.id!==partner.id&&o.kind==='human'&&(o.human?.level??0)===(h.level??0)):[];
   const nearest=(x:number,z:number)=>people.reduce((m,o)=>Math.min(m,hypot(o.pose.p[0]-x,o.pose.p[2]-z)),Infinity),apart=2*HUMAN_RADIUS+.04;
   const roomy=!people.length||nearest(nx,nz)>=apart||nearest(nx,nz)>=nearest(a.pose.p[0],a.pose.p[2]);
   if(roomy&&(next>=HUMAN_RADIUS-.02||next>=clear(a.pose.p[0],a.pose.p[2]))){a.pose.p=[nx,a.pose.p[1],nz];ex.at=[...a.pose.p];h.activity='walk';h.speed=Math.round(Math.abs(move)/dt*1000)/1000;publish();return {status:'running' as const,phase:'stepping-in'};}
   publish();h.activity=ex.base;delete h.speed;return {status:'running' as const,phase:'waiting-for-clearance'};
  }
  ex.readyAt??=tick;publish();h.activity=ex.base;delete h.speed;
  const peer=partner.human!.together!;
  // Both bodies must already have been ready before this tick. An actor ordered
  // first cannot start while the later actor still needs to move or settle.
  if(ex.readyAt>=tick||peer.readyAt===undefined||peer.readyAt>=tick)return {status:'running' as const,phase:'waiting-for-readiness'};
  ex.phase='active';ex.until??=peer.until??tick+ticks(ex.p.seconds);ex.close=true;
 }
 publish();
 if(!partner)return finish(rt,ex);
 if(nudged(rt,partner.id)){h.activity=ex.base;return tick>=ex.until!?finish(rt,ex):{status:'running' as const,phase:'settling-with-partner'};}
 if(!held(rt,ex.p.actor)&&hypot(partner.pose.p[0]-a.pose.p[0],partner.pose.p[2]-a.pose.p[2])>.05)a.pose.yaw=heading([partner.pose.p[0]-a.pose.p[0],partner.pose.p[2]-a.pose.p[2]]);
 h.partner=partner.id;h.activity=ex.p.activity;delete h.speed;
 // entry 35: one count for both (the shared start), the shape shown from the shoot beat only
 if(ex.p.activity==='rps'&&ex.p.throw){const start=ex.until!-ticks(ex.p.seconds),shoot=start+ticks(RPS.SHOOT);h.rps={start,shoot,...(tick>=shoot?{shape:ex.p.throw}:{})};}
 if(ex.p.prop)h.prop=ex.p.prop;else if(h.holding)h.prop=h.holding;
 if(tick>=ex.until!)return finish(rt,ex);
 return {status:'running' as const,phase:'together'};
}

/** CN5: a choreographed game turn for this body (state is a pure function of the tick and the active players). */
function playGame(rt: Runtime, ex: Exec, a: NonNullable<Runtime['world']['entities'][string]>, h: NonNullable<NonNullable<Runtime['world']['entities'][string]>['human']>, others: NonNullable<Runtime['world']['entities'][string]>[], dt: number) {
  const g = ex.p.game!, spec = GAMES[g.kind], tick = rt.tick, ticks = (s: number) => Math.max(1, Math.round(s / dt));
  const clearFrisbee=g.kind==='frisbee'&&g.flightPolicy==='clear-v1';
  if(clearFrisbee&&tick>=ex.until!&&beginGameRelease(rt,ex,dt))return releaseGameStep(rt,ex,dt);
  if (!clearFrisbee && ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;
  h.activity = ex.p.activity; delete h.baseActivity;
  const playing = [a, ...others.filter((o) => o.human!.together?.phase === 'active' && o.human!.together.group === ex.p.group)];
  const roster = playing.map((e) => e.id).sort();
  let players = roster;   // the throwing order (roster below is what the body state lists)
  if (g.kind === 'frisbee') { const owner = players.find((id) => rt.world.entities[id].human?.holding === 'frisbee'); if (owner) players = [owner, ...players.filter((id) => id !== owner)]; }
  if (g.kind === 'volleyball' && g.net) {
    // the rally alternates over the net: one side, the other, … (each side in id order, cycling the shorter side)
    const [x0, z0, x1, z1] = g.net, side = (id: string) => { const p = rt.world.entities[id].pose.p; return (x1 - x0) * (p[2] - z0) - (z1 - z0) * (p[0] - x0) < 0 ? 0 : 1; };
    const sides = [players.filter((id) => side(id) === 0), players.filter((id) => side(id) === 1)];
    // everyone on one side (a joiner took a place beside a player, then the other side left): they pass among themselves
    if (sides[0].length && sides[1].length) players = Array.from({ length: 2 * Math.max(sides[0].length, sides[1].length) }, (_, i) => sides[i % 2][Math.floor(i / 2) % sides[i % 2].length]);
  }
  const done = () => tick >= ex.until! ? finish(rt, ex) : { status: 'running' as const, phase: 'together' };
  if (new Set(players).size < 2) {
    if(clearFrisbee&&beginGameRelease(rt,ex,dt))return releaseGameStep(rt,ex,dt);
    // nobody (left) to play with: wait up to 30 s for someone to join, then the game ends
    h.game = { kind: g.kind, group: ex.p.group!, players: roster, ...(clearFrisbee?{flightPolicy:'clear-v1' as const}:{}), waiting: true, ...(g.jack ? { jack: g.jack } : {}), ...(ex.wins ? { wins: ex.wins } : {}) };
    if (h.holding) h.prop = h.holding; else delete h.prop;
    if ((ex.lonely = (ex.lonely ?? 0) + 1) > ticks(30)) return finish(rt, ex);
    return done();
  }
  ex.lonely = 0;
  if(clearFrisbee)ex.joinedAt??=tick;
  // turns count from the game's start: the earliest start any player shows (a joiner takes the running game's)
  const since = Math.min(ex.since ?? tick, ...playing.map((o) => o.human!.game?.since ?? Infinity)); ex.since = since;
  const P = ticks(spec.period), k = Math.floor((tick - since) / P), n = players.length, from = players[k % n], throwTick = since + k * P + ticks(clearFrisbee?FRISBEE_CLEAR_WINDUP:spec.windup), landTick = throwTick + ticks(spec.flight);
  const state: GameState = { kind: g.kind, group: ex.p.group!, players: roster, ...(clearFrisbee?{flightPolicy:'clear-v1' as const,joinedAt:ex.joinedAt}:{}), since, turn: k, from, throwTick, landTick };
  delete h.prop;
  if (g.kind === 'petanque' && g.jack) {
    // two boules each per end; each end's jack lies a little differently; the nearest boule wins the end
    const L = 2 * n, end = Math.floor(k / L), seed = ex.p.group!;
    const jack = (e: number): Vec2 => [r3(g.jack![0] + (unit(seed + ':jx:' + e) - 0.5) * 1.2), r3(g.jack![1] + (unit(seed + ':jz:' + e) - 0.5) * 1.6)];
    const land = (turn: number): Vec2 => { const j = jack(Math.floor(turn / L)), ang = unit(seed + ':a:' + turn) * Math.PI * 2, u = unit(seed + ':r:' + turn), rad = 0.12 + 1.7 * u * Math.sqrt(u); return [r3(j[0] + dcos(ang) * rad), r3(j[1] + dsin(ang) * rad)]; };
    const boulesOf = (e: number, upTo: number) => { const out: { by: string; at: Vec2 }[] = []; for (let t = e * L; t <= Math.min(upTo, (e + 1) * L - 1); t++) out.push({ by: players[t % n], at: land(t) }); return out; };
    const winner = (e: number) => { const j = jack(e); let best: { by: string; d: number } | null = null; for (const b of boulesOf(e, (e + 1) * L - 1)) { const d = hypot(b.at[0] - j[0], b.at[1] - j[1]); if (!best || d < best.d) best = { by: b.by, d }; } return best?.by ?? null; };
    if (ex.end !== undefined && end > ex.end && winner(end - 1) === ex.p.actor) ex.wins = (ex.wins ?? 0) + 1;
    ex.end = end;
    Object.assign(state, { to: null, jack: jack(end), at: land(k), end, boules: boulesOf(end, tick >= landTick ? k : k - 1), lastWinner: end > 0 ? winner(end - 1) : null });
    if (from === ex.p.actor && tick < throwTick) h.prop = 'boule';
  } else {
    const to = players[(k + 1) % n];
    state.to = to;
    if(clearFrisbee){const target=rt.world.entities[ex.p.actor===from?to:ex.p.actor===to&&tick>=landTick?players[(k+2)%n]:from];if(target&&target.id!==ex.p.actor){const want=heading([target.pose.p[0]-a.pose.p[0],target.pose.p[2]-a.pose.p[2]]);a.pose.yaw=wrapAngle(a.pose.yaw+clamp(angleDelta(a.pose.yaw,want),-Math.PI*dt,Math.PI*dt));}}
    // the frisbee is in the thrower's hand until it flies, then in the catcher's
    if (g.kind === 'frisbee' && ((tick < throwTick && from === ex.p.actor) || (tick >= landTick && to === ex.p.actor))) h.prop = 'frisbee';
  }
  if (ex.wins) state.wins = ex.wins;
  h.game = state;
  return done();
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Deterministic unit value in [0,1) from a string (FNV-1a). */
function unit(s: string): number {
  let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;   // murmur3 finaliser: every bit counts
  return (x >>> 0) / 4294967296;
}
