import * as THREE from 'three';
import { PIANO_FADE, PIANO_STEP, drumHands, pianoHands, pianoLanes, voiceAt, type Accompanist } from './piano-score.ts';
import {gameContact,type RecordedGame} from './recorded-games.ts';
import {rowingStroke} from './rowing-motion.ts';
import {seesawAngle, swingAngle} from './play-motion.ts';
// Body activities (ACTIVITIES-v1, Core `mars:pose_v1`) as a cosmetic, random-access renderer layer: hand goals
// relative to each shoulder, whole-body layouts (sitting on the ground, lying on the back), procedural cycles for
// exercise/dance ids, and small hand props. Pure function of (activity, base, prop, seconds, id): canonical
// roots, contacts, seats and hands stay the engine's; engine hand points / grips always win over this layer.

/** Overlay ids drawn on top of their base posture (sit / idle / sit-ground). */
export const ACTIVITY_OVERLAYS: ReadonlySet<string> = new Set(['row', 'ride', 'read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter', 'wave', 'operate', 'use-computer', 'sing', 'listen', 'fish', 'feed', 'garden', 'chalk', 'swing', 'seesaw', 'picnic', 'tell-story', 'bow', 'clap', 'nod', 'shake-head', 'cheer', 'point', 'pick-up', 'put-down', 'hug', 'handshake', 'high-five', 'give', 'take']);
/** Whole-body ids: the body point stays put and the viewer lays the body out from it along pose.yaw. */
export const LYING: ReadonlySet<string> = new Set(['lie', 'nap', 'situps', 'bench-press', 'hammock', 'stargaze']);
export const FACE_DOWN: ReadonlySet<string> = new Set(['pushups']);
/** Standing procedural cycles (Core may publish these ids; unknown ids simply stand). */
export const CYCLES: ReadonlySet<string> = new Set(['dance', 'jumping-jacks', 'jump', 'stretch', 'yoga', 'pull-ups', 'dips', 'lift-weights', 'play-volleyball', 'play-frisbee', 'play-petanque']);
/** Seat height used for sitting on the ground (pelvis on the grass). */
export const GROUND_SEAT = 0.04;
export const PROPS = ['book', 'brush', 'pen', 'letter', 'cup', 'plate', 'tool', 'cards', 'flower', 'food', 'frisbee', 'boule', 'dumbbell', 'rod', 'bread', 'spoon', 'guitar', 'bass', 'violin', 'viola', 'cello', 'flute', 'drumsticks'] as const;
export type PropKind = (typeof PROPS)[number];
const DEFAULT_PROP: Record<string, PropKind> = { read: 'book', browse: 'book', write: 'pen', paint: 'brush', eat: 'plate', drink: 'cup', cook: 'tool', 'play-game': 'cards', craft: 'tool', 'post-letter': 'letter', fish: 'rod', feed: 'bread', garden: 'tool', picnic: 'food' };

/** The posture an activity sits on, given the engine's baseActivity. */
export function activityBase(activity: string, base?: string): string {
  if (activity === 'sit-ground') return 'sit-ground';
  if (ACTIVITY_OVERLAYS.has(activity)) return base ?? 'idle';
  return activity;
}
/** The prop in the hands: the engine's `human.prop` when it names a known prop, else the activity's default. */
export function propFor(activity: string, prop?: string, instrument?:string): PropKind | null {
  if (prop && (PROPS as readonly string[]).includes(prop)) return prop as PropKind;
  if(activity==='play-music'){
    if(instrument==='drums')return 'drumsticks';
    if(['guitar','bass','violin','viola','cello','flute'].includes(instrument??''))return instrument as PropKind;
  }
  return DEFAULT_PROP[activity] ?? null;
}
/** Extra inputs of a frame: seconds since the activity began (one-shot gestures; undefined = cycle on take time) and
 *  the distance to the partner of a paired gesture (body points; undefined = the contract gap). */
export type FrameOpts = { groundSeat?: boolean; since?: number; gap?: number;instrument?:string;game?:RecordedGame;gameTick?:number;gameDt?:number;actorId?:string;
  /** Entry 36: whom a singer sings along with (her voice and the head/breath motion follow its sung notes), and, after
   *  her singing ended, the seconds since (the hand lets go of the mic and the pose eases out). */
  accompanist?: Accompanist | null; released?: number; priorAge?:number };
const GAP: Record<string, number> = { hug: 0.52, handshake: 0.85, 'high-five': 0.75, give: 0.9, take: 0.9 };
/** Shoulder height and half width the hand goals below are written for (BODY_MODEL: shoulders at 1.34 m). */
const SH = 1.34, HALF = 0.19;
/** core/piano@1 highest keys: black centre .795 m + half thickness .01 m. */
export const PIANO_KEY_HEIGHT = .805;
/** Ease free piano arms in/out on recorded activity age; explicit engine hand targets still win. */
export { PIANO_FADE };

/** One hand goal relative to that arm's shoulder: [forward, outward (+ away from the body midline), up] metres. */
export type HandGoal = readonly [number, number, number];
export type ActivityFrame = {
  /** [left, right]; null = that arm is left to the base posture (dangling / hand on thigh). */
  handWeights?:[number,number];
  /** Piano contact plane and per-hand lift above it, from the shared audible score. */
  piano?:{height:number;lift:[number,number];weight:number};
  hands: [HandGoal | null, HandGoal | null] | null;
  /** Feet apart (metres each side) and pelvis lift (metres, a hop) for standing cycles. */
  feetOut: number; hop: number;
  /** Torso lean (rad, + forward) and side lean (rad, + to the right). */
  lean: number; side: number;
  /** Whole-body layout: 'back' = lying face up, 'front' = face down (plank); `raise` lifts the upper body (rad). */
  lying: null | { face: 'back' | 'front'; raise: number };
  /** Head pitch (rad, + down: looking at a book or the keys). */
  look: number;
  /** leisure: riding a playground seat (play-motion.ts): the swing's or the see-saw plank's angle now (rad). */
  ride?: { kind: 'swing' | 'seesaw'; angle: number };
  /** Entry 36: hand goals relative to the body root instead of the shoulder: [forward, outward, height above the floor]
   *  (a hand on a fixed thing at a set height: the mic stand's grip), and each arm's blend weight toward its goal (the
   *  arm eases from the base posture to the goal and back) and how far its fingers close. */
  rootHands?: [HandGoal | null, HandGoal | null]; handW?: [number, number]; curl?: [number, number];
};
const S = (x: number) => x * x * (3 - 2 * x);
const tri = (x: number) => 1 - Math.abs(((x % 2) + 2) % 2 - 1); // 0..1..0 over 2
/** Stable per-person phase in [0,1). */
export function idPhase(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return ((h >>> 0) % 10007) / 10007; }

/** Entry 36: where the right hand holds the mic, from the body root: the mic stand's grip (core/mic-stand MIC_GRIP, out
 *  on the boom 0.252 m ahead of the pole, 1.41 m up) seen from the singer's place 0.55 m in front of the pole; the palm
 *  sits a little to the right of, behind and below the handle's axis (the fingers close round it). */
export const MIC_HAND: HandGoal = [0.55 - 0.252 - 0.014, 0.024, 1.402];
const SING_REACH = 1.1;
export const SING_LET_GO = 1.0;
/** Singing at a mic stand: the right hand eases onto the mic and holds it there; the left hangs easy and moves a little
 *  with the beat; she sways with the beat (one sway over two beats, eased in), leans a little toward the mic, her head
 *  lifts a touch on each sung note and her chest rises on the in-breath where a phrase ends (the rigs have no jaw). On
 *  `released` (her singing ended) the same frame eases out: the hand lets go and returns to the base posture. */
function singFrame(f: ActivityFrame, seconds: number, opts: FrameOpts): ActivityFrame {
  const since = opts.since ?? 9, k = opts.released === undefined ? S(Math.min(1, since / SING_REACH)) : 1 - S(Math.min(1, opts.released / SING_LET_GO));
  const swayK = opts.released === undefined ? S(Math.min(1, Math.max(0, since - 0.4) / 1.6)) : k, beat = (2 * Math.PI * seconds) / (4 * PIANO_STEP);
  const { open, breath } = voiceAt(opts.accompanist ?? null, seconds), sing = open * swayK;
  f.hands = [[0.06 + 0.012 * Math.cos(beat), 0.07, -0.56 + 0.01 * Math.sin(beat)], [0.06, 0.08, -0.56]];
  f.rootHands = [null, MIC_HAND]; f.handW = [k, k]; f.curl = [0.45 * k, 0.74 * k];
  f.side = 0.045 * swayK * Math.cos(beat);
  f.lean = (0.05 - 0.035 * breath) * k;
  f.look = (0.1 - 0.05 * sing - 0.03 * breath) * k;
  return f;
}

export function gameArmBlend(g:RecordedGame,tick:number,dt:number):number{const unit=(v:number)=>S(Math.max(0,Math.min(1,v)));return g.releaseTick===undefined?unit((tick-(g.joinedAt??g.since??tick))*dt/1.2):(g.releaseFrom??1)*(1-unit((tick-g.releaseTick)*dt/1.2));}

export function activityFrame(activity: string, base: string, seconds: number, id: string, opts: FrameOpts = {}): ActivityFrame | null {
  const ph = idPhase(id), t = seconds + ph * 7, seated = base === 'sit' || base === 'sit-ground';
  const gap = Math.max(0.3, Math.min(1.6, opts.gap ?? GAP[activity] ?? 0.9)), mid = gap / 2;
  const since = opts.since ?? ((seconds + ph * 7) % 5), env = (a: number, b: number) => S(Math.min(1, since / a)) * (1 - S(Math.max(0, since - b) / 0.5));
  const f: ActivityFrame = { hands: null, feetOut: 0, hop: 0, lean: 0, side: 0, lying: null, look: 0 };
  const down = seated ? -0.36 : -0.34;
  if(opts.game&&['play-frisbee','play-petanque','play-volleyball'].includes(activity)){
    const g=opts.game,shownTick=opts.gameTick??0,tick=g.releaseFrameTick??shownTick,dt=opts.gameDt??.05;
    f.feetOut=g.flightPolicy==='clear-v1'?.12*gameArmBlend(g,shownTick,dt):.12;
    if(g.flightPolicy==='clear-v1'&&g.kind==='frisbee'&&g.throwTick!==undefined&&g.landTick!==undefined&&(!g.waiting||g.releaseTick!==undefined)){
      const unit=(v:number)=>S(Math.max(0,Math.min(1,v))),blend=gameArmBlend(g,shownTick,dt),{forward,height}=gameContact(g.kind),goal=(f:number):HandGoal=>[f,-HALF,height-SH];
      f.feetOut=.12*blend;f.handWeights=[0,0];
      if(opts.actorId===g.from){const k=unit(1+(tick-g.throwTick)*dt/.7),after=unit((tick-g.throwTick)*dt/.65),start=g.turn===0?unit((tick-(g.joinedAt??g.since??tick))*dt/.5):1;f.hands=[null,goal(.12+(forward-.12)*k)];f.handWeights=[0,blend*start*(1-after)];}
      else if(opts.actorId===g.to){const anticipation=unit(1-(g.landTick-tick)*dt/1.4),settle=unit((tick-g.landTick)*dt/.5);f.hands=[goal(.12+(forward-.12)*anticipation),goal(.12+(forward-.12)*anticipation-(forward-.12)*settle)];f.handWeights=[blend*anticipation*(1-settle),blend*anticipation];}
      return f;
    }
    if(g.waiting||g.throwTick===undefined||g.landTick===undefined)return f;
    if(opts.actorId===g.from){
      const windup=g.kind==='petanque' ? 1.6 : g.kind==='frisbee' ? .7 : .4;
      const k=S(Math.max(0,Math.min(1,1+(tick-g.throwTick)*dt/windup)));
      const after=Math.max(0,Math.min(1,(tick-g.throwTick)*dt/.6));
      const {forward,height}=gameContact(g.kind);
      f.hands=[null,[.12+(forward-.12)*k,-HALF,height-SH-.1*(1-k)]];f.lean=g.kind==='petanque' ? .12*(1-after) : 0;
      if(g.kind==='volleyball')f.hands=[[forward,-HALF,height-SH],[forward,-HALF,height-SH]];
      if(after>=1)f.hands=null;
    }else if(opts.actorId===g.to){
      const anticipation=1-Math.max(0,Math.min(1,(g.landTick-tick)*dt/1.4));
      const {forward,height}=gameContact(g.kind);
      f.hands=[[.12+(forward-.12)*anticipation,-HALF,height-SH],[.12+(forward-.12)*anticipation,-HALF,height-SH]];
    }
    return f;
  }
  switch (activity) {
    // standing in a balloon basket (carrier 'ride'): both hands on the rim in front, a slow lean and look over the side
    case 'ride': { const sway = Math.sin(t * 0.21);
      f.hands = [[0.36, 0.06, -0.38], [0.36, 0.06, -0.38]]; f.lean = 0.1 + 0.03 * sway; f.side = 0.03 * sway; f.look = 0.18 + 0.06 * Math.sin(t * 0.13); return f; }
    case 'row': { const {pull,lift}=rowingStroke(seconds);f.hands=[[.3+.16*pull,.06,-.3+.06*lift],[.3+.16*pull,.06,-.3+.06*lift]];f.lean=.06+.12*pull;f.look=.12;return f; }
    // leisure: cast and wait, with now and then a small lift of the rod; toss bread by the handful; work the soil with a trowel
    case 'fish': { const cyc = t % 14, cast = cyc < 1.6 ? S(cyc / 1.6) : 0, bite = Math.max(0, Math.sin(t * 0.43) - 0.93) * 9;
      f.hands = [[0.3, -0.12, -0.12 + 0.06 * bite], [0.34 + 0.22 * cast, 0.1, -0.02 + 0.26 * cast - 0.16 * bite]]; f.lean = 0.08 + 0.1 * cast; f.look = 0.2; return f; }
    case 'feed': { const k = (t * 0.55) % 1, scoop = k < 0.4 ? S(k / 0.4) : 0, toss = k >= 0.4 && k < 0.7 ? S((k - 0.4) / 0.3) : 0, rest = k >= 0.7 ? S((k - 0.7) / 0.3) : 0;
      f.hands = [[0.28, -0.12, -0.3 + 0.1 * scoop], [0.3 - 0.1 * scoop + 0.34 * toss - 0.2 * rest, 0.04 + 0.12 * toss, -0.38 + 0.26 * scoop + 0.1 * toss - 0.2 * rest]]; f.lean = 0.12 + 0.12 * toss; f.look = 0.3; return f; }
    // #430: stooped low over the pavement in front, the chalk hand drawing small loops near the ground, the other on a knee
    case 'chalk': { const a = t * 2.4, k = tri(t * 0.17);
      f.hands = [[0.2, -0.16, -0.62], [0.5 + 0.07 * Math.cos(a) + 0.05 * k, 0.04 + 0.07 * Math.sin(a), -1.08]]; f.lean = 0.88; f.feetOut = 0.17; f.look = 0.55; return f; }
    case 'garden': { const dig = Math.sin(t * 3.2), k = tri(t * 0.2);
      f.hands = [[0.42, -0.06, -0.62 + 0.02 * k], [0.46 + 0.08 * dig, 0.05, -0.64 + 0.06 * Math.abs(dig)]]; f.lean = 0.62 + 0.06 * dig; f.feetOut = 0.17; f.look = 0.2; return f; }
    // leisure: holding the swing's chains at shoulder height, leaning back as it goes forward; the see-saw's handle in
    // front, the same rhythm for both ends (world seconds); a picnic is eating sat low on the blanket; lying in a hammock
    // with the head propped, or flat on the grass with the hands behind the head, looking up
    // cycling (engine gait 'cycle'): hands on the bars, leaning forward a little; humans.ts puts the feet on the pedals
    case 'cycle': f.hands = [[0.34, 0.06, -0.36], [0.34, 0.06, -0.36]]; f.lean = 0.32; f.look = -0.12; return f;
    // R5: a storyteller talks with the hands — now one hand opens out, now both shape something, now a pause; turning to the circle
    case 'tell-story': { const k = (t * 0.23) % 3, a = S(tri(t * 0.9)), b = S(tri(t * 0.7 + 0.5));
      f.hands = k < 1 ? [[0.12, -0.06, -0.62], [0.3 + 0.12 * a, 0.12 + 0.18 * a, -0.28 + 0.12 * a]] : k < 2 ? [[0.32 + 0.06 * b, 0.02 + 0.1 * b, -0.22 + 0.06 * a], [0.32 + 0.06 * a, 0.02 + 0.1 * a, -0.22 + 0.06 * b]] : [[0.18, -0.04, -0.4], [0.18, -0.04, -0.4]];
      f.side = 0.12 * Math.sin(t * 0.17); f.look = -0.08; return f; }
    case 'swing': { const angle = swingAngle(t), v = Math.cos((t * 2 * Math.PI) / 2.7);
      f.hands = [[0.02, 0.03, 0.14], [0.02, 0.03, 0.14]]; f.lean = -0.1 * v; f.look = -0.05 - 0.08 * v; f.ride = { kind: 'swing', angle }; return f; }
    case 'seesaw': { const angle = seesawAngle(seconds);
      f.hands = [[0.26, -0.1, -0.3], [0.26, -0.1, -0.3]]; f.lean = 0.08; f.look = -0.05; f.ride = { kind: 'seesaw', angle }; return f; }
    case 'picnic': { const k = S(Math.max(0, Math.sin(t * 0.7)));
      f.hands = [[0.3, -0.1, down - 0.04], [0.32 - 0.14 * k, -0.08 - 0.08 * k, down + 0.48 * k]]; f.look = 0.25 * (1 - k); return f; }
    case 'hammock': f.lying = { face: 'back', raise: 0.22 }; f.hands = [[0.28, -0.1, 0.04], [0.3, -0.06, 0.04]]; f.look = 0.1; return f;
    case 'stargaze': f.lying = { face: 'back', raise: 0 }; f.hands = [[-0.04, 0.02, 0.3], [-0.04, 0.02, 0.3]]; f.look = -0.2; return f;
    case 'read': { const turn = Math.max(0, Math.sin(t * 0.21) - 0.96) * 6; // now and then a page turns
      // The open pages extend below the palms. Lift seated hands together so the whole book clears the lap,
      // including the shorter woman's shoulders; its prop still follows the actual palms after reach-honest IK.
      const bookUp = down + (opts.groundSeat || base === 'sit-ground' ? 0.46 : seated ? 0.26 : 0.04);
      f.hands = [[0.33, -0.13, bookUp], [0.33 + 0.04 * turn, -0.13 + 0.1 * turn, bookUp + 0.03 * turn]]; f.look = 0.38; f.lean = seated ? 0.06 : 0.03; return f; }
    case 'browse': { const k = S(tri(t * 0.45));
      f.hands = [null, [0.42 + 0.06 * k, 0.04, -0.02 - 0.2 * k]]; f.look = 0.1; return f; }
    case 'write': { const s = Math.sin(t * 7) * 0.02, r = tri(t * 0.25) * 0.08;
      f.hands = [[0.36, -0.16, -0.44], [0.4 + s, -0.05 + r, -0.42]]; f.lean = 0.16; f.look = 0.45; return f; }
    // Entry 14: the hands strike the keys at the score's own onsets (the same notes the visitor hears), moving along the
    // keys with pitch; between notes they lift a little. Clocked by world seconds, not the per-person phase.
    case 'play-piano': { const [l, r] = pianoHands(opts.actorId ?? id, seconds);
      // Standing keyboards retain their shoulder-relative layout; this contact plane belongs to the piano bench.
      if(!seated){f.hands=[[.42,-.02+l.along,-.36+.028*(1-l.press)],[.42,-.02-r.along,-.36+.028*(1-r.press)]];f.lean=.1;f.look=.3;return f;}
      const lift:[number,number]=[.028*(1-l.press),.028*(1-r.press)],[laneL,laneR]=pianoLanes(opts.actorId??id,seconds);
      f.hands = [[.42,0,0],[.42,0,0]];f.rootHands=[[.42,.17+laneL,PIANO_KEY_HEIGHT+.04],[.42,.17-laneR,PIANO_KEY_HEIGHT+.04]];
      f.curl=[0,0];const age=opts.released??opts.since??PIANO_FADE,k=Math.max(0,Math.min(1,age/PIANO_FADE));
      f.piano={height:PIANO_KEY_HEIGHT,lift,weight:opts.released===undefined?S(k):S(Math.max(0,Math.min(1,(opts.priorAge??PIANO_FADE)/PIANO_FADE)))*(1-S(k))};f.lean=.1;f.look=.3;return f; }
    case 'play-music': { const s = Math.sin(t * 6) * 0.06;
      // Entry 26: the sticks meet the drums at the drum part's own hits (the sound the visitor hears), lifting between them
      if(opts.instrument==='drums'){const [l,r]=drumHands(opts.actorId ?? id,seconds);f.hands=[[.38,.05,-.26+l.lift*.16],[.38+r.reach*.06,.05+r.reach*.1,-.26+r.lift*.16+r.reach*.04]];f.look=.18;}
      else if(opts.instrument==='keyboard'||opts.instrument==='piano')return activityFrame('play-piano',base,seconds,id,opts);
      else if(['violin','viola'].includes(opts.instrument??'')){f.hands=[[.24,.1,.12],[.25,.2+s*2,-.05]];f.look=.14;}
      else if(opts.instrument==='cello'){f.hands=[[.3,-.02,-.14],[.38,.12+s*2,-.4]];f.look=.2;}
      else if(opts.instrument==='flute'){f.hands=[[.18,-.08,.15],[.15,.26,.13]];f.look=.03;}
      else {f.hands=[[.3,-.02,-.18],[.22,-.16,-.36+s]];f.look=.2;}return f; }
    case 'paint': { const k = tri(t * 0.7), s = Math.sin(t * 3.1) * 0.06;
      f.hands = [[0.22, 0.06, -0.42], [0.5, 0.06 + s, -0.08 + 0.12 * k]]; f.look = 0.05; return f; }
    case 'eat': { const k = S(Math.max(0, Math.sin(t * 0.9)));
      f.hands = [[0.3, -0.1, down - 0.08], [0.32 - 0.14 * k, -0.08 - 0.08 * k, down - 0.04 + 0.48 * k]]; f.look = 0.3 * (1 - k); return f; }
    case 'drink': { const k = S(Math.max(0, Math.sin(t * 0.6) * 1.3 - 0.3));
      f.hands = [null, [0.3 - 0.13 * k, -0.06 - 0.1 * k, down + 0.06 + 0.42 * k]]; f.look = -0.15 * k; return f; }
    case 'cook': { const a = t * 2.4;
      f.hands = [[0.42, -0.06, -0.4], [0.44 + Math.cos(a) * 0.06, -0.02 + Math.sin(a) * 0.06, -0.36]]; f.lean = 0.12; f.look = 0.4; return f; }
    case 'play-game': { const k = Math.max(0, Math.sin(t * 0.5) - 0.8) * 5;
      f.hands = [[0.3, -0.1, down + 0.02], [0.3 + 0.12 * k, -0.08, down + 0.02 - 0.06 * k]]; f.look = 0.35; return f; }
    case 'craft': { const s = Math.abs(Math.sin(t * 3)) * 0.08;
      f.hands = [[0.44, -0.08, -0.44], [0.46, 0.02, -0.36 + s]]; f.lean = 0.18; f.look = 0.45; return f; }
    case 'post-letter': { const k = S(tri(t * 0.5));
      f.hands = [null, [0.32 + 0.2 * k, 0.02, -0.25 + 0.05 * k]]; f.look = 0.1; return f; }
    case 'use-computer': { const ty = Math.sin(t * 11) * 0.012, mouse = S(Math.max(0, Math.sin(t * 0.37) - 0.55) * 2.2);
      f.hands = [[0.4, -0.12, -0.42 + ty], [0.4 - 0.02 * mouse, -0.1 + 0.2 * mouse, -0.42 - ty]]; f.lean = 0.07; f.look = 0.12; return f; }
    case 'sing': return singFrame(f, seconds, opts);
    case 'listen': { const nod = Math.max(0, Math.sin(t * 0.5) - 0.9) * 4;
      f.hands = [[0.24, -0.1, down + 0.02], [0.26, -0.08, down + 0.02]]; f.look = 0.05 + 0.15 * nod; return f; }
    // together/1 paired gestures: the meeting points are on the line between the two bodies (mid = half the gap)
    case 'handshake': { const pump = Math.sin(since * 9) * 0.035 * S(Math.min(1, since / 0.6)), k = env(0.6, 2.9);
      f.hands = [null, [0.06 + (mid - 0.06) * k, 0.02 - (HALF + 0.02) * k, -0.62 + (1.0 - SH + 0.62) * k + pump]]; f.lean = 0.05 * k; f.look = 0.12; return f; }
    case 'high-five': { const k = since < 0.83 ? S(since / 0.83) : 1 - S((since - 0.9) / 0.9);
      f.hands = [null, [0.06 + (mid - 0.1 - 0.06) * k, 0.08 - (HALF + 0.03) * k, -0.55 + (1.95 - SH + 0.55) * k]]; f.look = -0.25 * k; return f; }
    case 'hug': { const k = env(0.9, 4.4), sway = Math.sin(since * 1.6) * 0.05 * k;
      // both arms around the other's upper back: one over the shoulder, one under the arm; a little forward lean and sway
      // the hands reach past the partner's flanks to the middle of their back (gap + a torso's depth ahead)
      f.hands = [[0.08 + (mid * 2 + 0.02 - 0.08) * k, 0.1 - (HALF + 0.02) * k, -0.55 + (-0.1 + 0.55) * k], [0.08 + (mid * 2 - 0.04 - 0.08) * k, 0.1 - (HALF + 0.05) * k, -0.55 + (-0.36 + 0.55) * k]];
      f.lean = 0.1 * k; f.side = sway; f.look = -0.05; return f; }
    case 'give': case 'take': { const k = env(0.7, 2.0), right = activity === 'give' ? 0.06 : -0.06;
      f.hands = [null, [0.1 + (mid - 0.1) * k, 0.04 - (HALF + right) * k, -0.6 + (1.05 - SH + 0.6) * k]]; f.look = 0.3 * k; return f; }
    case 'clap': { const c = Math.abs(Math.sin(t * Math.PI * 2.2)), k = S(Math.min(1, since / 0.4));
      f.hands = [[0.32 * k + 0.02, (-HALF + 0.02 + 0.07 * c) * k + 0.08 * (1 - k), -0.18 * k - 0.5 * (1 - k)], [0.32 * k + 0.02, (-HALF + 0.02 + 0.07 * c) * k + 0.08 * (1 - k), -0.2 * k - 0.5 * (1 - k)]];
      f.look = 0.05; return f; }
    case 'bow': { const k = Math.sin(Math.PI * Math.min(1, since / 2.5));
      f.lean = 0.55 * S(k); f.look = 0.2 * k; f.hands = [[0.05, 0.02, -0.6], [0.05, 0.02, -0.6]]; return f; }
    case 'point': { const k = env(0.5, 2.6);
      f.hands = [null, [0.06 + 0.52 * k, 0.06 + 0.06 * k, -0.6 + 0.62 * k]]; f.look = -0.05 * k; return f; }
    case 'cheer': { const k = env(0.4, 2.6), s = Math.sin(t * 6) * 0.06 * k;
      f.hands = [[0.08, 0.1 + 0.12 * k, -0.6 + 1.2 * k + s], [0.08, 0.1 + 0.12 * k, -0.6 + 1.2 * k - s]]; f.hop = 0.04 * Math.abs(Math.sin(t * 6)) * k; return f; }
    case 'pick-up': case 'put-down': { const k = Math.sin(Math.PI * Math.min(1, since / 1.5));
      f.lean = 0.9 * S(k); f.hands = [null, [0.25 + 0.25 * k, 0.04, -0.6 - 0.55 * k]]; f.look = 0.5 * k; return f; }
    case 'operate': { const k = S(Math.min(1, since / .55)); f.hands = [null, [.6 * k, -.18, -.3 * k]]; f.lean = .12 * k; f.look = .08; return f; }
    case 'wave': { const s = Math.sin(t * 7) * 0.12;
      f.hands = [null, [0.12, 0.28 + s, 0.42]]; return f; }
    // together/1 gestures (ACTIVITIES-v1 §6a): Core faces the body to the partner/target; the arms do the rest
    case 'nod': f.hands = null; f.look = 0.28 * Math.max(0, Math.sin(t * 6)); return f;
    case 'shake-head': f.hands = null; f.side = 0.05 * Math.sin(t * 9); f.look = 0.05; return f;
    case 'lie': f.lying = { face: 'back', raise: 0 }; f.hands = [[0.42, 0.1, -0.3], [0.42, 0.1, -0.3]]; return f;
    case 'nap': f.lying = { face: 'back', raise: 0 }; f.hands = [[0.3, -0.12, 0.06], [0.34, -0.08, 0.06]]; return f;
    case 'situps': { const k = S(tri(t * 0.55)); f.lying = { face: 'back', raise: 1.1 * k }; f.hands = [[0.1, -0.12, 0.15], [0.1, -0.12, 0.15]]; return f; }
    case 'bench-press': { const k = S(tri(t * 0.45)); f.lying = { face: 'back', raise: 0 }; f.hands = [[0.22 + 0.38 * k, 0.16, -0.02], [0.22 + 0.38 * k, 0.16, -0.02]]; return f; }
    case 'pull-ups': { const k = S(tri(t * 0.4)); f.hands = [[0.06, 0.16, 0.66 - 0.42 * k], [0.06, 0.16, 0.66 - 0.42 * k]]; f.hop = 0.12 + 0.42 * k; f.look = -0.15; return f; }
    case 'dips': { const k = S(tri(t * 0.5)); f.hands = [[0.0, 0.14, -0.32 - 0.14 * (1 - k)], [0.0, 0.14, -0.32 - 0.14 * (1 - k)]]; f.hop = 0.18 + 0.14 * k; f.lean = 0.12; return f; }
    case 'lift-weights': { const a = S(tri(t * 0.5)), b = S(tri(t * 0.5 + 1)); f.hands = [[0.18 + 0.12 * a, -0.04, -0.5 + 0.38 * a], [0.18 + 0.12 * b, -0.04, -0.5 + 0.38 * b]]; f.feetOut = 0.1; return f; }
    case 'play-volleyball': { const k = S(Math.max(0, Math.sin(t * 0.9) - 0.4) * 1.6), j = Math.max(0, Math.sin(t * 0.45) - 0.85) * 6;
      f.hands = j > 0 ? [[0.2, 0.18, 0.5 + 0.1 * j], [0.2, 0.18, 0.5 + 0.1 * j]] : [[0.32, -0.12, -0.42 + 0.12 * k], [0.32, -0.12, -0.42 + 0.12 * k]]; f.hop = 0.3 * j * j / 4; f.lean = 0.18 * (1 - j); f.feetOut = 0.16; return f; }
    case 'play-frisbee': { const k = tri(t * 0.35), throwing = S(Math.max(0, k * 2 - 1)); f.hands = [[0.14, 0.12, -0.38], [0.34 * throwing, -0.18 + 0.62 * throwing, -0.18 + 0.12 * throwing]]; f.side = -0.12 * throwing; f.feetOut = 0.12; return f; }
    case 'play-petanque': { const k = S(Math.max(0, Math.sin(t * 0.5))); f.hands = [[0.1, 0.08, -0.44], [0.12 + 0.32 * k, 0.02, -0.5 + 0.22 * k]]; f.lean = 0.12 + 0.2 * k; f.feetOut = 0.12; return f; }
    case 'pushups': { const k = S(tri(t * 0.6)); f.lying = { face: 'front', raise: 0.08 + 0.32 * k }; f.hands = [[0.05, 0.08, -0.6], [0.05, 0.08, -0.6]]; return f; }
    case 'jumping-jacks': { const k = S(tri(t * 1.15)), up = Math.abs(Math.sin(t * Math.PI * 1.15));
      f.hands = [[0.02, 0.18 + 0.32 * Math.sin(k * Math.PI * 0.5), -0.55 + 1.15 * k], [0.02, 0.18 + 0.32 * Math.sin(k * Math.PI * 0.5), -0.55 + 1.15 * k]];
      f.feetOut = 0.06 + 0.26 * k; f.hop = 0.1 * up; return f; }
    case 'jump': { const up = Math.max(0, Math.sin(t * Math.PI * 0.9));
      f.hands = [[0.15, 0.2, -0.2 + 0.7 * up], [0.15, 0.2, -0.2 + 0.7 * up]]; f.hop = 0.32 * up * up; return f; }
    case 'stretch': { const k = S(tri(t * 0.2)) * 2 - 1;
      f.hands = [[0.02, 0.05, 0.62], [0.02, 0.05, 0.62]]; f.side = 0.28 * k; return f; }
    case 'yoga': { const k = S(Math.min(1, tri(t * 0.12) * 1.6));
      f.hands = [[0.12, -0.12, -0.3 + 0.9 * k], [0.12, -0.12, -0.3 + 0.9 * k]]; f.feetOut = 0.18 * (1 - k) + 0.02; return f; }
    case 'dance': { const b = Math.sin(t * Math.PI * 2 * 0.95), c = Math.cos(t * Math.PI * 0.95), style = Math.floor(ph * 3);
      const hi = style === 0 ? 0.35 : style === 1 ? 0.05 : 0.2;
      f.hands = [[0.2, 0.2 + 0.1 * c, hi * 0.6 + 0.25 * b], [0.2, 0.2 - 0.1 * c, hi * 0.6 - 0.25 * b]];
      f.hop = 0.035 * Math.abs(b); f.side = 0.12 * c; f.feetOut = 0.12; return f; }
    default: return null;
  }
}

// ---------------------------------------------------------------- props (shared geometry/materials, one small mesh group per person)
let kit: { box: THREE.BoxGeometry; cyl: THREE.CylinderGeometry; sphere:THREE.SphereGeometry; mats: Record<string, THREE.MeshStandardMaterial> } | null = null;
function getKit() {
  if (kit) return kit;
  const m = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  kit = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10),sphere:new THREE.SphereGeometry(1,16,12), mats: { page: m('#f4eedc', 0.9), cover: m('#7a2f2a'), cover2: m('#2f4f7c'), wood: m('#8a5a36'), metal: m('#9aa0a6', 0.4), cup: m('#e9e2d0', 0.5), tea: m('#6b3f1f', 0.3), plate: m('#f2efe6', 0.5), food: m('#d9a24a'), paint: m('#c8402f'), card: m('#fbfaf5', 0.6), red: m('#c0392b'), stem: m('#4f7a32'), petal: m('#e86a8e', 0.7), bloom: m('#f2c84b'), frisbee: m('#e9712e', 0.5), frisbee2: m('#f39a5c', 0.5) } };
  return kit;
}
const part = (geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, rz = 0, ry = 0) => {
  const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.rotation.set(0, ry, rz); o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; return o;
};
/** A prop in its own frame: x = away from the holder, y = up, z = the holder's right. Origin = where the hands are. */
export function makeProp(kind: PropKind): THREE.Group {
  const k = getKit(), g = new THREE.Group(), M = k.mats;
  g.name = 'activity prop: ' + kind;
  switch (kind) {
    case 'book': { // open book tilted toward the reader, chunky enough to read at Broadcast distance
      const tilt = new THREE.Group(); tilt.rotation.z = -0.85; g.add(tilt); // top edge tipped away: the open pages face the reader's eyes
      for (const s of [-1, 1]) { const leaf = new THREE.Group(); leaf.rotation.y = s * 0.18; leaf.add(part(k.box, M.page, 0.014, 0.29, 0.2, 0, 0, s * 0.102)); leaf.add(part(k.box, M.cover, 0.01, 0.3, 0.208, 0.01, 0, s * 0.106)); tilt.add(leaf); }
      break; }
    case 'cup': g.add(part(k.cyl, M.cup, 0.04, 0.1, 0.04, 0, 0.03, 0)); g.add(part(k.cyl, M.tea, 0.034, 0.005, 0.034, 0, 0.08, 0)); break;
    case 'plate': g.add(part(k.cyl, M.plate, 0.12, 0.015, 0.12, 0.04, -0.02, 0)); g.add(part(k.box, M.food, 0.09, 0.03, 0.07, 0.04, 0.0, 0)); break;
    case 'brush': g.add(part(k.cyl, M.wood, 0.008, 0.26, 0.008, 0.06, 0.06, 0, -0.9)); g.add(part(k.cyl, M.paint, 0.012, 0.04, 0.012, 0.16, 0.13, 0, -0.9)); break;
    case 'pen': g.add(part(k.cyl, M.metal, 0.006, 0.15, 0.006, 0.02, 0.03, 0, -0.6)); break;
    case 'letter': g.add(part(k.box, M.card, 0.005, 0.12, 0.22, 0.06, 0.02, 0)); g.add(part(k.box, M.red, 0.007, 0.02, 0.02, 0.063, 0.02, 0)); break;
    case 'spoon': // a long wooden stirring spoon, bowl down
      g.add(part(k.cyl, M.wood, 0.01, 0.34, 0.01, 0.12, -0.02, 0, -1.2)); g.add(part(k.sphere, M.wood, 0.035, 0.012, 0.025, 0.27, -0.08, 0)); break;
    case 'tool': g.add(part(k.cyl, M.wood, 0.014, 0.24, 0.014, 0.05, 0.04, 0, -0.7)); g.add(part(k.box, M.metal, 0.05, 0.05, 0.1, 0.13, 0.12, 0)); break;
    case 'cards': for (let i = -1; i <= 1; i++) g.add(part(k.box, M.card, 0.004, 0.11, 0.075, 0, 0.02, i * 0.03, 0, i * 0.25)); break;
    case 'flower': // a stem with leaves and a bloom of petals, held upright
      g.add(part(k.cyl, M.stem, 0.006, 0.3, 0.006, 0.02, 0.12, 0)); g.add(part(k.box, M.stem, 0.004, 0.03, 0.05, 0.02, 0.08, 0.02, 0, 0.6));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(part(k.box, M.petal, 0.03, 0.012, 0.045, 0.02 + Math.cos(a) * 0.022, 0.28, Math.sin(a) * 0.022, 0, -a)); }
      g.add(part(k.cyl, M.bloom, 0.016, 0.02, 0.016, 0.02, 0.285, 0)); break;
    case 'food': // a bread roll on a napkin
      g.add(part(k.box, M.card, 0.004, 0.13, 0.13, 0.03, -0.01, 0)); g.add(part(k.cyl, M.food, 0.05, 0.05, 0.05, 0.05, 0.02, 0)); break;
    case 'frisbee': g.add(part(k.cyl, M.frisbee, 0.12, 0.018, 0.12, 0.09, 0, 0)); g.add(part(k.cyl, M.frisbee2, 0.08, 0.02, 0.08, 0.09, 0.002, 0)); break;
    case 'rod': // a 2.4 m cane held out over the water, a line from its tip down to a red float on the surface
      g.add(part(k.cyl, M.wood, 0.009, 2.4, 0.009, 1.0, 0.49, 0, -1.15)); g.add(part(k.cyl, M.stem, 0.002, 2.3, 0.002, 2.09, -0.17, 0)); g.add(part(k.sphere, M.red, 0.025, 0.025, 0.025, 2.09, -1.32, 0)); break;
    case 'bread': // a few torn pieces of bread in the open hand
      for (let i = 0; i < 3; i++) g.add(part(k.box, M.food, 0.035, 0.02, 0.03, 0.04 + i * 0.015, 0.0 + i * 0.006, (i - 1) * 0.03, 0, i)); break;
    case 'boule': g.add(part(k.sphere,M.metal,.045,.045,.045)); break;
    case 'dumbbell': g.add(part(k.cyl,M.metal,.015,.22,.015,0,0,0,Math.PI/2));for(const side of [-1,1])g.add(part(k.cyl,M.metal,.06,.045,.06,side*.1,0,0,Math.PI/2));break;
    case 'guitar': case 'bass': {
      g.add(part(k.sphere,M.wood,.055,.2,.16,0,-.035));
      g.add(part(k.sphere,M.wood,.05,.13,.12,0,.17));
      const neck=kind==='bass'?.58:.43;
      g.add(part(k.box,M.cover,.028,neck,.05,0,.24+neck/2));
      g.add(part(k.box,M.wood,.035,.11,.075,0,.3+neck));
      g.add(part(k.box,M.metal,.006,.62,.012,.058,.24));
      g.add(part(k.sphere,M.cover,.008,.045,.045,.058,.03));break;
    }
    case 'violin': case 'viola': case 'cello': {
      const scale=kind==='cello'?2.2:kind==='viola'?1.15:1;
      g.add(part(k.sphere,M.wood,.035*scale,.13*scale,.085*scale,0,-.04*scale));
      g.add(part(k.sphere,M.wood,.03*scale,.09*scale,.07*scale,0,.12*scale));
      g.add(part(k.box,M.cover,.025,.28*scale,.03,0,.24*scale));
      g.add(part(k.sphere,M.wood,.024,.04,.025,0,.4*scale));
      g.add(part(k.cyl,M.wood,.005,.55*scale,.005,.055,0,0,Math.PI/2));
      if(kind==='cello')g.add(part(k.cyl,M.metal,.005,.18,.005,0,-.47));break;
    }
    case 'flute': g.add(part(k.cyl,M.metal,.012,.58,.012,0,0,0,Math.PI/2));for(let i=0;i<7;i++)g.add(part(k.sphere,M.cover,.014,.005,.014,i*.055-.16,.012));break;
    case 'drumsticks': for(const side of ['left','right']){const stick=part(k.cyl,M.wood,.006,.3,.006);stick.name=side+' stick';g.add(stick);}break;
  }
  return g;
}
const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _rgt = new THREE.Vector3();
/** Put a prop at the hands: two-handed props (book, cards) between the palms, a plate in the left, others in the right. */
export function placeProp(obj: THREE.Object3D, kind: PropKind, left: THREE.Vector3 | null, right: THREE.Vector3 | null, fwd: THREE.Vector3) {
  if(kind==='drumsticks'){
    obj.matrixAutoUpdate=false;obj.matrix.identity();obj.matrixWorldNeedsUpdate=true;
    for(const [i,at]of[left,right].entries()){const stick=obj.children[i];stick.visible=!!at;if(at){stick.position.copy(at).addScaledVector(fwd,.12);stick.quaternion.setFromUnitVectors(_up,_a.copy(fwd).addScaledVector(_up,-.15).normalize());stick.updateMatrix();}}
    obj.visible=!!left||!!right;return;
  }
  const two = kind === 'book' || kind === 'cards', at = two && left && right ? _a.copy(left).add(right).multiplyScalar(0.5) : kind === 'plate' ? (left ?? right) : (right ?? left);
  if (!at) { obj.visible = false; return; }
  if(['guitar','bass','violin','viola','cello'].includes(kind)&&left&&right){
    const neck=new THREE.Vector3().subVectors(left,right).normalize();
    const face=fwd.clone().addScaledVector(neck,-fwd.dot(neck)).normalize();
    if(neck.lengthSq()>.9&&face.lengthSq()>.9){_rgt.crossVectors(face,neck).normalize();_m.makeBasis(face,neck,_rgt).setPosition(right);obj.matrixAutoUpdate=false;obj.matrix.copy(_m);obj.matrixWorldNeedsUpdate=true;obj.visible=true;return;}
  }
  _rgt.crossVectors(fwd, _up).normalize();
  _m.makeBasis(fwd, _up, _rgt).setPosition(at);
  if (two) _m.setPosition(at.x + fwd.x * 0.03, at.y + 0.05, at.z + fwd.z * 0.03);
  obj.matrixAutoUpdate = false; obj.matrix.copy(_m); obj.matrixWorldNeedsUpdate = true; obj.visible = true;
}
