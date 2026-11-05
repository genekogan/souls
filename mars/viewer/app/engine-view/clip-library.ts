// Library clips (Quaternius Universal Animation Library 1 Pro + 2, CC0; retargeted onto the three visitors by
// mars/scripts/retarget_ual_clips.py and appended to their GLBs by merge_clip_glb.py): which clip a body plays for
// an activity, and at which clip time. Pure function of (activity, base, seconds in the activity, take time, id):
// random access, like the rest of the renderer. Roots, seats, contacts and hands stay the engine's; humans.ts
// layers seat height, water surface, lying layout, hand IK, props, breathing and head look on top.

/** How the clip time follows the activity: a loop on take time (per-id phase), a one-shot from the activity's
 *  start (`since`), the first frame held, or a phase in [0, 1] given by the engine (sleepPose.standingFraction). */
export type ClipMode = 'loop' | 'once' | 'hold' | 'phase';
export type LibraryPick = {
  clip: string;
  mode: ClipMode;
  /** Playback rate (once / loop); `fit`: a one-shot stretched to end after this many seconds. */
  rate?: number; fit?: number;
  /** Play backwards (lie down = get-up reversed; put-down = pick-up reversed). */
  reverse?: boolean;
  /** Whole body: the clip replaces the procedural activity frame (lying layout, cycles). */
  body?: 'seat' | 'ground-seat' | 'lie' | 'swim' | 'tread' | 'stand';
  /** Alternatives, picked per person (hash of the id). */
  alt?: string[];
};

/** Context of one body at one frame. */
export type PickContext = {
  activity: string;
  /** Posture under an overlay (engine baseActivity), already normalised: 'sit' | 'sit-ground' | 'idle' | … */
  base: string;
  /** The body is on a seat (sit / sit-down / stand-up or an overlay on sit). */
  seated: boolean;
  /** Sitting on the grass (sit-ground or an overlay on it). */
  ground: boolean;
  speaking: boolean;
  /** Engine sleep / wake on a mat (sleepPose): standingFraction 0 = lying, 1 = standing. */
  sleep?: number;
  /** Surface swimming (buoyant) vs treading / bed-supported. */
  water?: 'swim' | 'tread';
  /** Ground speed m/s. */
  speed: number;
  partner?: boolean;
};

/** Activities whose whole-body procedural frame (activity-poses.ts) the library clip replaces. Others keep theirs. */
export const CLIP_BODY = new Set(['rest','lie', 'nap', 'listen', 'dance', 'sit-ground', 'cheer', 'nod', 'shake-head', 'pick-up', 'put-down', 'eat', 'drink']);

export function libraryPick(c: PickContext): LibraryPick | null {
  if (c.sleep !== undefined) return { clip: 'LayToIdle', mode: 'phase', body: 'lie' };
  if (c.water === 'swim') return { clip: 'Swim_Fwd_Loop', mode: 'loop', body: 'swim', rate: 0.85 };
  if (c.water === 'tread') return { clip: 'Swim_Idle_Loop', mode: 'loop', body: 'tread' };
  const a = c.activity;
  if(a==='rest')return {clip:'Standby_Loop',mode:'loop',body:'stand'};
  if (a === 'lie' || a === 'nap') return { clip: 'LayToIdle', mode: 'hold', body: 'lie' };
  if (c.ground) {
    if (a === 'sit-ground' || a === 'idle' || a === 'sit') return { clip: 'GroundSit_Idle_Loop', mode: 'loop', body: 'ground-seat' };
    return { clip: 'GroundSit_Idle_Loop', mode: 'loop', body: 'ground-seat' }; // overlays: hands on top
  }
  if (c.seated) {
    if (a === 'sit-down') return { clip: 'Sitting_Enter', mode: 'once', fit: 0.9, body: 'seat' };
    if (a === 'stand-up') return { clip: 'Sitting_Exit', mode: 'once', fit: 0.8, body: 'seat' };
    if (c.speaking || a === 'talk' || a === 'converse') return { clip: 'Sitting_Talking_Loop', mode: 'loop', body: 'seat' };
    if (a === 'listen' || a === 'nod') return { clip: 'Sitting_Nodding_Loop', mode: 'loop', body: 'seat' };
    return { clip: 'Sitting_Idle_Loop', mode: 'loop', body: 'seat', alt: ['Sitting_Idle_Loop', 'Sitting_Idle02_Loop', 'Sitting_Idle_Loop'] };
  }
  switch (a) {
    case 'dance': return { clip: 'Dance_Loop', mode: 'loop', body: 'stand' };
    case 'cheer': return { clip: 'Celebration', mode: 'once', fit: 3, body: 'stand' };
    case 'nod': return { clip: 'Yes', mode: 'loop', body: 'stand', rate: 1.6 };
    case 'shake-head': return { clip: 'Idle_No_Loop', mode: 'loop', body: 'stand', rate: 1.6 };
    case 'pick-up': return { clip: 'PickUp_Kneeling', mode: 'once', fit: 1.5, body: 'stand' };
    case 'put-down': return { clip: 'PickUp_Kneeling', mode: 'once', fit: 1.5, reverse: true, body: 'stand' };
    case 'eat': return { clip: 'Consume', mode: 'loop', rate: 0.6, body: 'stand' };
    case 'drink': return { clip: 'Drink', mode: 'loop', body: 'stand' };
    case 'talk': case 'converse': return { clip: 'Idle_Talking_Loop', mode: 'loop', body: 'stand' };
    case 'listen': case 'watch': return { clip: 'Idle_FoldArms_Loop', mode: 'loop', body: 'stand', alt: ['Idle_FoldArms_Loop', 'Idle_LookAround_Loop'] };
    case 'phone': return { clip: 'Idle_TalkingPhone_Loop', mode: 'loop', body: 'stand' };
    case 'lean': case 'rail': return { clip: 'Idle_Rail_Loop', mode: 'loop', body: 'stand' };
    case 'plant': case 'sow': case 'seed': return { clip: 'Farm_PlantSeed', mode: 'loop', body: 'stand' };
    case 'water': return { clip: 'Farm_Watering', mode: 'loop', body: 'stand' };
    case 'harvest': case 'weed': case 'pick': return { clip: 'Farm_Harvest', mode: 'loop', body: 'stand' };
    case 'chop': return { clip: 'TreeChopping_Loop', mode: 'loop', body: 'stand' };
    case 'fix': case 'repair': case 'fixing': return { clip: 'Fixing_Kneeling', mode: 'loop', body: 'stand' };
    case 'push': return { clip: 'Push_Loop', mode: 'loop', body: 'stand' };
    case 'throw': return { clip: 'OverhandThrow', mode: 'loop', body: 'stand' };
    case 'open': return { clip: 'Chest_Open', mode: 'once', body: 'stand' };
    case 'tired': return { clip: 'Idle_Tired_Loop', mode: 'loop', body: 'stand' };
  }
  if (c.speaking && (a === 'idle' || a === 'wait')) return { clip: 'Idle_Talking_Loop', mode: 'loop', body: 'stand' };
  return null;
}

/** Locomotion clips (replace Walk while moving fast): jog from RUN_SPEED, sprint above SPRINT_SPEED. */
export const SPRINT_SPEED = 4.6;

/** Idle variety: now and then (per person) a library idle blends in instead of standing still. */
export const IDLE_VARIANTS = ['Idle_LookAround_Loop', 'Idle_FoldArms_Loop'] as const;

/** Seconds a library clip takes to blend in after its activity starts (and the previous one out). */
export const CLIP_FADE = 0.35;

const hash = (id: string, salt: number) => { let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

/** Which clip of a pick a person plays (alternatives per id). */
export function pickClip(p: LibraryPick, id: string): string {
  return p.alt?.length ? p.alt[Math.floor(hash(id, 11) * p.alt.length)] : p.clip;
}

/**
 * Clip time (s) for a pick. `seconds`: take time (loops; phase per id, or per pair `phaseId` so partners move in step);
 * `since`: seconds since the activity began (one-shots; undefined = long ago: the end pose); `phase`: 0–1.
 */
export function clipTime(p: LibraryPick, duration: number, seconds: number, phaseId: string, since: number | undefined, phase?: number): number {
  const d = Math.max(1e-3, duration);
  let t: number;
  if (p.mode === 'hold') t = 0;
  else if (p.mode === 'phase') t = Math.max(0, Math.min(1, phase ?? 0)) * d;
  else if (p.mode === 'once') {
    const rate = p.fit ? d / p.fit : (p.rate ?? 1);
    t = since === undefined ? d : Math.min(d, Math.max(0, since * rate));
  } else t = ((seconds * (p.rate ?? 1) + hash(phaseId, 3) * d) % d + d) % d;
  return p.reverse ? d - t : t;
}
