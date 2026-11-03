import {WAVE_BLEND_SECONDS,type WaveSample} from './wave-blend.ts';
// Recorded take → three.js overlay (spec §21–23, §18). Reads only the take file:
// `sampleTake` for poses/discrete state, `sampleTrack` for the planned camera.
// Everything is random access in take time, so scrubbing, pausing, the speed
// and whether the engine camera is on can never change what is shown at a
// given t (spec §18: the take plays identically with any camera).
import {recordedBody,admittedBodyUrl} from './recorded-body.ts';
import {recordedGame} from './recorded-games.ts';
import {projectPlatformFrame} from './recorded-platforms.ts';
import type {PlatformFloor} from '../../lib/platform-floor.ts';
import * as THREE from 'three';
import { hashOf } from '../../engine/core/hash.ts';
import { ANG_Q, POS_Q, type CameraTrack, type PoseSample, type Take } from '../../engine/take/types.ts';
import { interpSample, replayFinalState, sampleTake, takeDuration, type TakeFrame } from '../../engine/take/replay.ts';
import type { HandHoldState } from '../../engine/social/hand-hold.ts';
import type { RpsState } from '../../engine/social/rps.ts';
import { fileCamera, fileCameras, sampleTrack, trackData, withFileCamera, type CameraTrackData, type TakeFileCameras } from '../../engine/camera/track.ts';
import type { CameraPose } from '../../engine/camera/shots.ts';
import type { Vec3 } from '../../engine/core/math.ts';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import {carryContactWeight, type CarryContact} from '../../engine/carry/contact.ts';
import { def } from '../../engine/world/catalog.ts';
import { progressiveContributor } from '../../engine/construction/contributor.ts';
import {waterTransitions,type WaterTransition} from './water-transition.ts';
import { isPlywood } from '../../engine/construction/deck.ts';
import { ComponentViews } from './components.ts';
import {recordedSleepPose} from './recorded-sleep-pose.ts';
import {itemPoseOf} from '../../engine/items/presentation.ts';
import { FixtureViews } from './fixtures.ts';
import { GAIT_ACTS, GESTURE_FADE, HumanViews, REST_ACTS, type Hands, type SampledHuman , type HumanViewer, type RigCreationBudget } from './humans.ts';
import { takeLog, type LogLine, type TakeStep } from './take-log.ts';
import type { Template } from './people.ts';
import { walkCum } from './take-walk.ts';
import { WALK_EASE, easedOut, gaitSegments, lastFullStride, walkWeightAt, type GaitSegments } from './walk-ease.ts';
import type { DepictionBeat } from './station-depiction.ts';
import {shoreDepiction} from './recorded-shore.ts';
import {matchedStairFlights,type SupplementalStair} from './stair-frame.ts';
import {NativeBoatViews} from './native-boat.ts';
import type {NativeBoatLayoutV1} from '../../../../packages/engine-contract/src/boat.ts';
import type {ShoreDesign} from './shore-preview.ts';

export { takeLog, type LogLine, type TakeStep } from './take-log.ts';
export type TakeManifestEntry = {
  id: string;
  file: string;
  label: string;
  year: number;
  hypothetical: boolean;
  duration: number;
  entities: number;
  finalStateHash: string;
  cameraTrack: string;
  moments: Record<string, number>;
  violations: number;
  blockedWaits: number;
  bytes: number;
  /** Optional in older manifests. */
  ticks?: number;
  rulesVersion?: string;
  takeSchema?: string;
  /** 'year-build' marks a "Watch it being built" take; absent → inferred from `rulesVersion` (STUDIO_REPLAY.md). */
  kind?: string;
  /** One chapter of a chapter set (`kind: 'year-build-chapter'`, W31; STUDIO_REPLAY.md "Chapter sets"). */
  chapter?: ChapterRef;
};
/** A chapter take's place in its set: the set id, 0-based position, section id, the previous chapter's take id (null for
 *  the first) and this take's start state hash (= the previous chapter's `finalStateHash`). */
export type ChapterRef = { of: string; index: number; id: string; startsFrom: string | null; startHash: string };
/** One chapter of a set, in play order: its take / file (= the chapter's manifest entry), its tick range within the run
 *  (`from` of chapter k = `to` of k − 1) and its plan step range [fromStep, toStep). */
export type SetChapter = { id: string; label: string; take: string; file: string; from: number; to: number; ticks: number; fromStep: number; toStep: number };
/** A long build recorded as one run cut into consecutive chapter takes (manifest `chapterSets`, W31). */
export type ChapterSetEntry = {
  id: string;
  label: string;
  year: number;
  hypothetical: boolean;
  kind: string;
  duration: number;
  ticks: number;
  startStateHash: string;
  finalStateHash: string;
  planHash?: string;
  rulesVersion?: string;
  bytes?: number;
  gzipBytes?: number;
  chapters: SetChapter[];
};
/** `takes`: recorded on the 2026 scene; `otherYears`: recorded in another year's frame. The studio lists both, filtered by `year`. */
export type TakeManifest = { schema: 'mars-take-manifest/1'; takes: TakeManifestEntry[]; otherYears?: TakeManifestEntry[]; chapterSets?: ChapterSetEntry[] };
/** Build site of a take; `groundY` is the take's ground datum (the year-build fork: the Kit datum 0). */
export type TakeSite = { origin: [number, number]; yaw: number; groundY: number };
export type TakeReplayFile = {
  schema: 'mars-take-replay/1';
  label: string;
  hypothetical: boolean;
  note: string;
  /** Campus id of the year the take was recorded in (`mars-2026`, `mars-2022`, …). */
  campus?: string;
  site?: TakeSite;
  steps: TakeStep[];
  moments: Record<string, number>;
  take: Take;
  camera: CameraTrack;
  /** Extra camera tracks of this take (CAMERA_DIRECT.md §8.2: directed ones), keyed by id; absent when none. */
  cameras?: TakeFileCameras;
};
/** A year-build ("Watch it being built") manifest entry: explicit `kind`, else the year-build rules version. */
export const isYearBuild = (e: Pick<TakeManifestEntry, 'kind' | 'rulesVersion'>) => (e.kind ? e.kind === 'year-build' : /year-build/.test(e.rulesVersion ?? ''));
/** One chapter of a chapter set: played as part of its set ("Watch it being built"), never offered on its own. */
export const isChapter = (e: Pick<TakeManifestEntry, 'kind' | 'chapter'>) => e.kind === 'year-build-chapter' || !!e.chapter;
export const TAKE_MANIFEST_URL = '/engine/takes/manifest.json';

/** The entity record the replay draws `id` from: the final state, else (mars-take/4) as first recorded (removed before the end). */
const recordOf = (take: Take, id: string) => take.finalState.entities[id] ?? take.entities0?.[id];

export async function loadTakeFile(url: string, signal?: AbortSignal): Promise<TakeReplayFile> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`take ${url}: HTTP ${r.status}`);
  const f = (await r.json()) as TakeReplayFile;
  if (f.schema !== 'mars-take-replay/1') throw new Error(`take ${url}: unexpected schema ${String(f.schema)}`);
  if (f.camera.takeId !== f.take.id) throw new Error(`camera track ${f.camera.id} belongs to take ${f.camera.takeId}, not ${f.take.id}`);
  fileCameras(f); // throws on a malformed track or one of another take (the planned `camera` and every `cameras` entry)
  replayFinalState(f.take); // throws if the recorded final state no longer hashes to finalStateHash
  return f;
}

/**
 * A render copy of a take shifted by `dy` metres in y (tracks, recorded hand points, final poses). Only for drawing:
 * its hashes no longer match, so hashing, sampling for the camera and the canonical check use the original.
 */
export function shiftTake(take: Take, dy: number): Take {
  if (!dy) return take;
  const q = Math.round(dy * POS_Q);
  const up = (p: number[] | undefined) => (p ? [p[0], p[1] + q, p[2]] : p); // recorded hand points are integer mm
  const tracks = Object.fromEntries(Object.entries(take.tracks).map(([id, s]) => [id, s.map((x) => { const y = [...x] as PoseSample; y[2] += q; return y; })]));
  const changes = take.changes.map((c) => {
    if (c[2] !== 'hands' || !c[3]) return c;
    const h = c[3] as { left?: number[]; right?: number[] };
    return [c[0], c[1], c[2], { ...(h.left ? { left: up(h.left) } : {}), ...(h.right ? { right: up(h.right) } : {}) }] as typeof c;
  });
  const entities = Object.fromEntries(Object.entries(take.finalState.entities).map(([id, e]) => [id, { ...e, pose: { ...e.pose, p: [e.pose.p[0], e.pose.p[1] + dy, e.pose.p[2]] as Vec3 } }]));
  return { ...take, tracks, changes, finalState: { ...take.finalState, entities } };
}

type Walk = { ticks: number[]; cum: number[]; track: PoseSample[] };
/** Exact adjacent live take windows (RecordedGaitContinuity's rule): b continues a with no gap. */
const adjacentTakes = (a: Take, b: Take) => a.startTick + a.ticks === b.startTick && a.dt === b.dt && a.finalStateHash === b.baselineStateHash;
const EMPTY_SCENE: SpatialScene = { bounds: [0, 0, 0, 0], levels: [], surfaces: [], obstacles: [], links: [] };

/**
 * People and components of a take at any time t — the random-access half of the replay, shared by the
 * studio (TakeReplay) and the lab's replay check. The same pose path as the live lab (humans.ts
 * setFrame → render, components attachHeld): when the take carries the engine's `hands`,
 * `baseActivity` and `on` fields (HumanState; TakeRecorder FIELDS), arms go to the recorded hand points
 * (`sampleTake`: metres, interpolated between mars-take/3 keyframes; a /2 take holds each tick's value), eat / serve sit on their base, postures are solved from the
 * hands, items `in-hand` (support from the frame, not the final state) ride the rendered palms; people
 * on a usable stairs link walk it tread by tread — links from the base scene (optional) plus the
 * construction contributor over the frame's components (installed flights with all treads).
 */
export class TakePeople {
  private platformFloors:readonly PlatformFloor[]=[];
  private platformBaseY=0;
  setPlatformFloors(platforms:readonly PlatformFloor[],baseY=0){this.platformFloors=platforms;this.platformBaseY=baseY;}
  readonly group = new THREE.Group();
  take: Take;
  private comps = new ComponentViews();
  private fixtures:FixtureViews;
  private humans:HumanViews;
  private walks = new Map<string, Walk>();
  /** Per person: walking-share steps over this take and its adjacent takes (walk-ease.ts); null: no track. */
  private gaits = new Map<string, GaitSegments | null>();
  /** Per person: rest-clock answers that do not depend on the frame (a finished walk run's last full stride). */
  private strides = new Map<string, number | null>();
  /** Retained adjacent takes (live take windows) the walk ease reads across: before and after this one. */
  private neighbours: { prev: Take | null; next: Take | null } = { prev: null, next: null };
  private history: readonly Take[] = [];
  /** Per person: the ticks at which `activity` / `baseActivity` changed in this take, and the values (library clip
   *  crossfades and one-shots need how long the current activity has run and what came before). */
  private waveOwners = new Map<string,number[]>();
  private waveActs = new Map<string,{t:number[];v:string[]}>();
  private waveTakes = new WeakMap<Take,boolean>();
  private acts = new Map<string, { t: number[]; v: string[]; bt: number[]; bv: (string | null)[] }>();
  private base: SpatialScene;
  private stairKey = '';
  private supplementalStairs:readonly SupplementalStair[]=[];
  private supplementalLiveTakeId:string|null=null;
  setSupplementalStairs(contacts:readonly SupplementalStair[],selection?:{liveTakeId:string}){this.supplementalStairs=contacts;this.supplementalLiveTakeId=selection?.liveTakeId??null;}
  /** Metres each walker had already walked before this take began (a chapter set: Σ over the earlier chapters). */
  private walkOffsets: Record<string, number> = {};
  /** Per person at the last show(): metres walked (offset included) and the Walk weight. */
  private lastGait = new Map<string, { dist: number; walk: number }>();
  private templates: Template[] = [];
  private fixtureDrawReplacement:THREE.Group|null=null;
  private excludedFixtureObjects=new Map<THREE.Object3D,boolean>();
  private waterTransition:(id:string,seconds:number)=>WaterTransition=()=>({weight:1,from:null,origins:[]});
  private waterHistoryKey='';
  private nativeBoat?:NativeBoatViews;
  frame: TakeFrame | null = null;
  /** Wall ms of the last show()'s `sampleTake` (the rest of show() is posing the three.js views). */
  sampleMs = 0;
  appearancesSettled(ids?:ReadonlySet<string>){return this.humans.appearancesSettled(ids);}
  /** PERF-EDEN: the eye and view for the bodies' pose-rate throttle (null = every body every frame). */
  setViewer(v:HumanViewer|null){this.humans.viewer=v;}
  poseStats(){return this.humans.poseStats;}
  contactDiagnostics(){return this.humans.bones();}
  instrumentOf(id:string){return this.humans.instrumentOf(id);}
  appearanceStatus(){return this.humans.appearanceStatus();}

  constructor(take: Take, opts: { scene?: SpatialScene; commonsContrast?:boolean; humanPresets?:boolean; nativeBoat?:{layout:NativeBoatLayoutV1;proposal:ShoreDesign['boat']} } = {}) {
    this.take = take;
    this.humans=new HumanViews(opts.humanPresets??false);
    this.fixtures=new FixtureViews(opts.commonsContrast??false);
    this.base = opts.scene ?? EMPTY_SCENE;
    this.group.add(this.comps.group, this.fixtures.group, this.humans.group);
    if(opts.nativeBoat){this.nativeBoat=new NativeBoatViews(opts.nativeBoat.layout,opts.nativeBoat.proposal);this.group.add(this.nativeBoat.group);}
    this.indexWalks();
    this.humans.setStairs(this.base.links);
  }

  private indexWalks() {
    this.walks.clear();
    this.acts.clear();
    this.gaits.clear();
    this.strides.clear();
    this.neighbours = this.adjacent(this.history);
    const physics = this.take.finalState.entityPhysicsV1 as {assets?: Record<string, import('../../engine/world/catalog.ts').AssetDef>} | undefined;
    const handling = Object.fromEntries(Object.entries(physics?.assets ?? {}).flatMap(([id, asset]) => asset.capabilities?.fixtureCarry ? [[id, asset.capabilities.fixtureCarry.handling]] : []));
    this.humans.setFixtureHandling({...handling, ...this.take.fixtureCarryHandlingV1});
    this.indexActs();
    this.waterTransition=waterTransitions(this.take);
    this.waterHistoryKey='';
    for (const [id, s] of Object.entries(this.take.tracks)) {
      if (recordOf(this.take,id)?.kind!=='human')continue;
      this.walks.set(id, { ticks: s.map((x) => x[0]), cum: walkCum(s), track: s });
    }
  }

  /**
   * Continue with another take on the same views (a chapter set, STUDIO_REPLAY.md "Chapter sets": chapter k + 1's first
   * frame is chapter k's final state, same ids). People, parts and piles keep their three.js objects, so the swap costs
   * no rig or mesh rebuild. The next show() poses the new take.
   */
  setTake(take: Take, walkOffsets: Record<string, number> = {}) {
    this.walkOffsets = walkOffsets;
    if (take === this.take) return;
    this.setSupplementalStairs([]);
    this.take = take;
    this.indexWalks();
    this.stairKey = '';
    this.frame = null;
  }

  /** Optional retained exact recording history; gaps/foreign physics never fill a transition. */
  setWaterHistory(takes:readonly Take[]){
    // the walk ease reads across the adjacent take windows of the same history (a stop just past a window's edge)
    this.history=takes;const nb=this.adjacent(takes);
    const changed=nb.prev!==this.neighbours.prev||nb.next!==this.neighbours.next;
    if(changed){this.neighbours=nb;this.gaits.clear();this.strides.clear();this.indexActs();}
    const key=this.take.id+'|'+takes.map(t=>t.id).join('|');if(key===this.waterHistoryKey)return;
    if(!changed)this.indexActs();
    this.waterTransition=waterTransitions(this.take,takes);this.waterHistoryKey=key;
  }

  setBodyTemplates(templates:ReadonlyMap<string,Template>){this.humans.setBodyTemplates(templates);}
  bodyObject(id:string){return this.humans.bodyObject(id);}

  setTemplates(ts: Template[]) {
    this.templates = ts;
    this.humans.setTemplates(ts);
  }

  /**
   * Gait readout of the last show() (tests): per person the metres walked (the chapter offset included), the Walk
   * weight, and the leg phase 0–1 the renderer derives from them (humans.ts: clip s = metres / walkSpeed, mod the clip
   * length), with the person's template stride (walkSpeed × Walk clip length). `phase` is null before templates load.
   */
  gait(): Record<string, { dist: number; walk: number; stride: number | null; phase: number | null }> {
    const bones = this.humans.bones();
    const out: Record<string, { dist: number; walk: number; stride: number | null; phase: number | null }> = {};
    for (const [id, g] of this.lastGait) {
      const tpl = this.templates.find((x) => x.name === bones[id]?.template);
      const dur = tpl ? THREE.AnimationClip.findByName(tpl.gltf.animations, 'Walk')?.duration : undefined;
      const stride = tpl && dur ? tpl.walkSpeed * dur : null;
      out[id] = { dist: g.dist, walk: g.walk, stride, phase: stride ? (((g.dist / tpl!.walkSpeed) % dur! + dur!) % dur!) / dur! : null };
    }
    return out;
  }

  /** How long `id`'s current activity has run at `tick` and what it did before (absent when it began before the take). */
  private activityHistory(id: string, tick: number, act: string, walk: number): Pick<SampledHuman, 'activityAge' | 'prevActivity' | 'prevBaseActivity' | 'restAge' | 'walkAge' | 'restAgeAtWalk' | 'prevWaveDuration' | 'waveRestAge' | 'waveSamples' | 'waveClock'> {
    const a = this.acts.get(id);
    const k = this.runAt(a, tick);
    const rest = { ...this.restAge(id, a, k, tick, act), ...(walk > 0.02 ? this.walkStart(id, tick) : {}) };
    const wave:Pick<SampledHuman,'waveSamples'|'waveRestAge'|'waveClock'>={};
    const wa=this.waveActs.get(id),wk=this.runAt(wa,tick);
    if(wa){
      const samples:WaveSample[]=[];
      for(let j=0;j<=wk;j++)if(wa.v[j]==='wave'){
        if(this.waveOwners.get(id)?.some(t=>t>=wa.t[j]&&t<=tick))continue;
        if(wa.v.slice(j+1,wk+1).some(v=>v!=='idle'&&v!=='wave'&&!GAIT_ACTS.has(v)))continue;
        const next=wa.t[j+1],end=next!==undefined&&next<=tick?next:undefined,released=end===undefined?undefined:(tick-end)*this.take.dt;
        if(released!==undefined&&released>=WAVE_BLEND_SECONDS)continue;
        samples.push(end===undefined?{...(j>0?{age:(tick-wa.t[j])*this.take.dt}:{})}:{released,...(j>0?{duration:(end-wa.t[j])*this.take.dt}:{})});
      }
      if(samples.length){
        wave.waveSamples=samples;wave.waveClock=(this.take.startTick+tick)*this.take.dt;
        const idleActs={t:wa.t,v:wa.v.map(v=>v==='wave'?'idle':v)};
        const hypothetical=this.restAge(id,idleActs,wk,tick,act==='wave'?'idle':act).restAge;
        if(hypothetical!==undefined)wave.waveRestAge=hypothetical;
      }else if(a&&k>0&&a.v[k-1]==='wave')wave.waveSamples=[];
    }else if(a&&k>0&&a.v[k-1]==='wave')wave.waveSamples=[];
    if(!a||k<1)return {...rest,...wave};
    let b:string|null=null;for(let i=a.bt.length-1;i>=0;i--)if(a.bt[i]<a.t[k]){b=a.bv[i];break;}
    const age=(tick-a.t[k])*this.take.dt;
    return { ...wave, activityAge: age, prevActivity: a.v[k - 1], ...(b ? { prevBaseActivity: b } : {}), ...rest };
  }

  /**
   * Idle-variety onset clock: seconds since the body last walked at a full stride or did something other than stand
   * (absent: unknown). A walk that has not reached a full stride (its start, a short nudge) does not restart it, so a
   * gesture fades out with the walk's own ease instead of being cut on the first walking frame. After a stop it starts
   * when the stride's ease has finished (walk-ease.ts easedOut): started at the last full stride, inside the ease, the
   * folded arms came in at the ease's rate on top of the arm swing settling (entry 39, take 3: 0.094 m per 50 ms).
   */
  private restAge(id: string, a: { t: number[]; v: string[] } | undefined, k: number, tick: number, act: string): Pick<SampledHuman, 'restAge'> {
    const cur = a && k >= 0 ? a.v[k] : act, dt = this.take.dt;
    if (!REST_ACTS.has(cur) && !GAIT_ACTS.has(cur)) return {};
    const seg = this.gaitSteps(id), age = (from: number) => ({ restAge: Math.max(0, tick - from) * dt });
    // from a full stride: the clock starts once the stride has eased out (now, while it is still easing)
    const settled = (key: string, f: number) => { const e = this.strides.get(key) ?? easedOut(seg!, f, tick, dt); if (e !== null && e !== undefined) this.strides.set(key, e); return age(e ?? tick); };
    for (let j = k; a && j >= 0; j--) {
      const v = a.v[j];
      if (GAIT_ACTS.has(v)) {
        const f = !seg ? null : j === k ? lastFullStride(seg, a.t[j], tick, dt) : this.stride(`${id}#${j}`, () => lastFullStride(seg, a.t[j], a.t[j + 1], dt));
        if (f !== null) return settled(`${id}#${j}@${f}`, f);
        continue;
      }
      if (!REST_ACTS.has(v)) return age(j === k ? tick : a.t[j + 1]);
    }
    // before the first change this take records (or none at all): a full stride on the track still restarts it
    const t1 = a && k >= 0 ? a.t[0] : tick, f = seg && seg.t.length ? (a && k >= 0 ? this.stride(`${id}#pre`, () => lastFullStride(seg, seg.t[0], t1, dt, 60, false)) : lastFullStride(seg, seg.t[0], t1, dt, 60, false)) : null;
    return f !== null ? settled(`${id}#pre@${f}`, f) : {};
  }
  /** Each body's activity changes on this take's tick axis, the previous adjacent take window's first (entry 36: an
   *  activity that began in the previous live window, or as this window's first change, has its age and what came before
   *  it; the singer's hand eased onto the mic, then jumped when the next window arrived with no age). */
  private indexActs() {
    this.acts.clear();
    const prev = this.neighbours.prev, windows: [Take, number][] = [...(prev ? [[prev, prev.startTick - this.take.startTick] as [Take, number]] : []), [this.take, 0]];
    const add=(take:Take,offset:number)=>{
      let found=false;
      for(const [tick,id,field,value]of take.changes){
        if(field!=='activity'&&field!=='baseActivity')continue;
        let a=this.acts.get(id);if(!a)this.acts.set(id,(a={t:[],v:[],bt:[],bv:[]}));
        if(field==='activity'){
          if(value==='wave')found=true;
          if(typeof value==='string'&&a.v[a.v.length-1]!==value){a.t.push(tick+offset);a.v.push(value);}
        }else{a.bt.push(tick+offset);a.bv.push(typeof value==='string'?value:null);}
      }
      this.waveTakes.set(take,found);
    };
    for(const [take,offset]of windows)add(take,offset);
    this.waveActs.clear();this.waveOwners.clear();
    // Cached discovery scans each immutable take once. Ordinary forward idle
    // chunks are already inspected by the existing activity-index pass above.
    const hasWave=(take:Take)=>{let found=this.waveTakes.get(take);if(found===undefined){found=take.changes.some(([, ,f,v])=>f==='activity'&&v==='wave');this.waveTakes.set(take,found);}return found;};
    if(!this.history.some(hasWave)&&!hasWave(this.take))return;
    const chain:Take[]=[this.take];let first=this.take;
    while((this.take.startTick-first.startTick)*this.take.dt<2*WAVE_BLEND_SECONDS){
      const matches=this.history.filter(t=>t!==first&&t.ticks>0&&adjacentTakes(t,first)&&t.rulesVersion===first.rulesVersion);
      if(matches.length!==1)break;first=matches[0];chain.unshift(first);
    }
    const waveIds=new Set<string>();for(const take of chain)if(hasWave(take))for(const [,id,f,v]of take.changes)if(f==='activity'&&v==='wave')waveIds.add(id);
    if(!waveIds.size)return;
    const owners=new Set(['hands','grip','handHold','rps','heldItemsV1','on']);
    for(const take of chain)for(const [tick,id,f,v]of take.changes){
      if(!waveIds.has(id))continue;
      if(owners.has(f)&&v&&(typeof v!=='object'||Object.keys(v).length)){let t=this.waveOwners.get(id);if(!t)this.waveOwners.set(id,(t=[]));t.push(tick+take.startTick-this.take.startTick);}
      if(f!=='activity'||typeof v!=='string')continue;
      let a=this.waveActs.get(id);if(!a)this.waveActs.set(id,(a={t:[],v:[]}));
      if(a.v.at(-1)!==v){a.t.push(tick+take.startTick-this.take.startTick);a.v.push(v);}
    }
  }
  private runAt(a: { t: number[] } | undefined, tick: number) {
    if (a) for (let i = a.t.length - 1; i >= 0; i--) if (a.t[i] <= tick) return i;
    return -1;
  }
  /** Walk weight above 0: seconds since it last left 0 (≤ one gesture fade back) and the rest clock at that moment, so an
   *  idle gesture fades on the arms from the walk start (humans.ts armsAction). Absent when longer ago. */
  private walkStart(id: string, tick: number): Pick<SampledHuman, 'walkAge' | 'restAgeAtWalk'> {
    const seg = this.gaitSteps(id), dt = this.take.dt;
    if (!seg || !seg.t.length) return {};
    const back = Math.ceil(GESTURE_FADE / dt);
    for (let k = Math.floor(tick); k >= Math.floor(tick) - back; k--) {
      if (walkWeightAt(seg, k, dt) > 0.02) continue;
      const a = this.acts.get(id), r = this.restAge(id, a, this.runAt(a, k), k, 'idle').restAge;
      return { walkAge: (tick - k) * dt, ...(r !== undefined ? { restAgeAtWalk: r } : {}) };
    }
    return {};
  }
  private stride(key: string, f: () => number | null) { if (!this.strides.has(key)) this.strides.set(key, f()); return this.strides.get(key)!; }

  /** The retained takes that continue straight into and out of this one (live take windows). */
  private adjacent(takes: readonly Take[]) {
    return { prev: takes.find((t) => t !== this.take && adjacentTakes(t, this.take)) ?? null, next: takes.find((t) => t !== this.take && adjacentTakes(this.take, t)) ?? null };
  }
  /** `id`'s walking-share steps on this take's tick axis, its adjacent takes included. */
  private gaitSteps(id: string): GaitSegments | null {
    if (this.gaits.has(id)) return this.gaits.get(id)!;
    const own = this.take.tracks[id], parts: { track: PoseSample[]; offset: number; end: number }[] = [];
    const { prev, next } = this.neighbours;
    // each window's track holds its last pose to the window's end (`end`): a stop is standing, not unknown, after arrival
    if (prev?.tracks[id]) parts.push({ track: prev.tracks[id], offset: prev.startTick - this.take.startTick, end: prev.ticks });
    if (own) parts.push({ track: own, offset: 0, end: this.take.ticks });
    if (next?.tracks[id]) parts.push({ track: next.tracks[id], offset: next.startTick - this.take.startTick, end: next.ticks });
    const g = own ? gaitSegments(parts, this.take.dt) : null;
    this.gaits.set(id, g);
    return g;
  }

  /** Metres walked by `id` up to `tick` along its recorded track (horizontal). */
  private walked(w: Walk, tick: number) {
    const s = w.track;
    if (tick <= s[0][0]) return 0;
    let lo = 0, hi = s.length - 1;
    if (tick >= s[hi][0]) return w.cum[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid][0] <= tick) lo = mid;
      else hi = mid;
    }
    const p = interpSample(s[lo], s[hi], tick);
    return w.cum[lo] + Math.hypot(p[1] - s[lo][1], p[3] - s[lo][3]) / POS_Q;
  }

  /** The take's records (entities0 overlaid by the final state), merged once per take, not every frame: P1 phones -
   *  Eden 2026's ~4,500 records were re-spread on every frame (~3 ms of a 4x-throttled phone frame). */
  private recordsMemo: { e0: unknown; fin: unknown; all: Record<string, Entity> } | null = null;
  private allRecords(): Record<string, Entity> {
    const e0 = this.take.entities0, fin = this.take.finalState.entities, m = this.recordsMemo;
    if (m && m.e0 === e0 && m.fin === fin) return m.all;
    const all = { ...e0, ...fin } as Record<string, Entity>;
    this.recordsMemo = { e0, fin, all };
    return all;
  }

  /** Stair links for this frame's components (only when stair-relevant state changed). */
  private stairs(comps: Record<string, Entity>) {
    const rel = Object.values(comps).filter((e) => e.def === 'stair-tread' || def(e.def).category === 'stair' || isPlywood(e));
    const key = rel.map((e) => `${e.id}:${e.phase}:${e.pose.p.join(',')}`).join('|');
    if (key === this.stairKey) return;
    this.stairKey = key;
    const links = rel.length ? (progressiveContributor({ entities: comps } as unknown as WorldState, this.base).links ?? []) : [];
    this.humans.setStairs([...this.base.links, ...links]);
  }

  /**
   * Pose everything at take time t (seconds). `clock`: the time the views animate on (idle loops, fire flicker); a
   * chapter set passes its set time so it runs on across a chapter boundary. Poses depend only on t. `ahead`: a live
   * client's depicted time when it has run past this take's end while the next window is still on its way (t is then
   * the end); the Walk ease runs on to it, so a body that stopped at a window's end finishes its stop instead of
   * holding mid-stride until the next window arrives.
   */
  show(t: number, clock = t,stationBeat:DepictionBeat|null=null,ahead=t,rigBudget?:RigCreationBudget) {
    const s0 = performance.now();
    const nativeFrame=sampleTake(this.take,t);
    this.humans.setSupplementalStairs(matchedStairFlights(this.supplementalStairs,nativeFrame,this.allRecords(),this.take.entities0??{},this.supplementalLiveTakeId?{liveTakeId:this.supplementalLiveTakeId,take:this.take}:undefined));
    const boatAppearance=this.nativeBoat?.show(nativeFrame);
    const frame=(this.frame=this.platformFloors.length?projectPlatformFrame(nativeFrame,this.allRecords(),this.platformFloors,this.platformBaseY):nativeFrame);
    this.sampleMs = performance.now() - s0;
    const comps: Record<string, Entity> = {};
    const fixtures: Record<string, Entity> = {};
    const people: SampledHuman[] = [];
    this.lastGait.clear();
    const dt = this.take.dt, span = 0.15 / dt; // ±0.15 s speed window
    for (const [id, e] of Object.entries(frame.entities)) {
      const src = recordOf(this.take, id) as Entity | undefined; // pose / phase / contents below come from the frame
      if (!src) continue;
      const st = e.state as { grip?: { entity?: string; slot?: string }; support?: Entity['support']; connections?: Entity['connections']; contents?: Entity['contents']; hands?: Hands; baseActivity?: string; prop?: string; seatHeight?: number; on?: string; proneYaw?: number; phaseK?: number; sleepPose?: NonNullable<Entity['human']>['sleepPose'] };
      if (src.kind === 'component') {
        if (src.tags?.includes('entity-world-item-pose')) continue; // the real authored mesh draws this same recorded pose
        // discrete state as of t (the final state's phase / support would put every item in its last place)
        comps[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll }, ...(e.phase ? { phase: e.phase as Entity['phase'] } : {}), ...('support' in st ? { support: st.support ?? undefined } : {}), ...('connections' in st ? { connections: st.connections ?? undefined } : {}), ...Object.fromEntries(['contents', 'gardenCare', 'planting', 'foodPreparation'].map(field => [field, e.state[field] ?? undefined])) };
        continue;
      }
      if (src.kind === 'fixture') {
        // Replace the unknown fixture cube only while its recorded counterpart is valid.
        if(boatAppearance?.dockDepicted&&this.nativeBoat?.group.getObjectByName(id))continue;
        // piles / bundles, the cutting station, benches, campfires: pose + contents as of t (a pile shrinks)
        fixtures[id] = { ...src, pose: { p: e.p, yaw: e.yaw, pitch: e.pitch, roll: e.roll }, ...Object.fromEntries(['contents', 'gardenCare', 'planting', 'foodPreparation'].map(field => [field, e.state[field] ?? undefined])) };
        continue;
      }
      const body=recordedBody(src.body,e.state);
      if (src.kind !== 'human' || body?.family === 'floater') continue;
      const w = this.walks.get(id);
      const dist = (w ? this.walked(w, frame.tick) : 0) + (this.walkOffsets[id] ?? 0);
      // a body carried in a vehicle seat (balloon 'ride', punt 'row') moves with the vehicle, not on its feet: no walk, no run
      const carriedRide = e.activity === 'ride' || e.activity === 'row';
      const speed = w && !carriedRide ? (this.walked(w, frame.tick + span) - this.walked(w, frame.tick - span)) / (2 * span * dt) : 0;
      const climbing = !!e.activity?.startsWith('climb');
      const contact = e.state.carryContactV1 as CarryContact | undefined;
      const g = st.grip ?? (contact ? {entity:contact.item,slot:contact.slot} : undefined);
      const carryWeight = contact ? carryContactWeight(contact, this.take.startTick + frame.tick, dt) : undefined;
      // eased over WALK_EASE (walk-ease.ts): the per-sample speed map snapped stride → stand in one 65 ms sample
      const gs = w && !carriedRide ? this.gaitSteps(id) : null;
      const walk = climbing ? 1 : gs ? walkWeightAt(gs, frame.tick + Math.min(WALK_EASE / dt, Math.max(0, (ahead - t) / dt)), dt) : 0;
      this.lastGait.set(id, { dist, walk });
      // prone receiver (mars-take/4, W32): the lying heading in integer mrad and the phase progress in integer % → rad, 0–1
      const proneYaw = typeof st.proneYaw === 'number' ? st.proneYaw / ANG_Q : undefined;
      const phaseK = typeof st.phaseK === 'number' ? st.phaseK / 100 : undefined;
      const shore=shoreDepiction(e);
      // a scenery seat (armchair, piano bench) carries its seat top in the body state (ACTIVITIES-v1 human.seatHeight)
      const seatHeight=this.nativeBoat?.seatHeightFor(frame,id)??(typeof st.seatHeight==='number'&&Number.isFinite(st.seatHeight)?st.seatHeight:undefined);
      const publicSoulKey=(src.human as {soul?:unknown}|undefined)?.soul;
      const game=recordedGame(e.state.game);
      people.push({itemPose:itemPoseOf(e.state.itemTransferV1 as NonNullable<Entity['human']>['itemTransferV1'],e.state.heldItemsV1 as NonNullable<Entity['human']>['heldItemsV1'],this.take.startTick+frame.tick,this.take.dt),...(e.state.handActuator?{handActuator:e.state.handActuator as NonNullable<Entity['human']>['handActuator'],handActuatorTime:(this.take.startTick+frame.tick)*this.take.dt}:{}),...(e.state.handTransferV1?{transfer:e.state.handTransferV1 as NonNullable<Entity['human']>['handTransferV1'],transferTime:(this.take.startTick+frame.tick)*this.take.dt}:{}),...(e.state.wateringV1?{watering:e.state.wateringV1 as NonNullable<Entity['human']>['wateringV1'],wateringTime:(this.take.startTick+frame.tick)*this.take.dt}:{}),...(e.state.letGoV1?{letGo:e.state.letGoV1 as NonNullable<Entity['human']>['letGoV1'],letGoTime:(this.take.startTick+frame.tick)*this.take.dt}:{}),...(e.state.cupV1?{cup:e.state.cupV1 as NonNullable<Entity['human']>['cupV1'],cupTime:(this.take.startTick+frame.tick)*this.take.dt}:{}), ...(body?.modelUrl?{bodyModel:admittedBodyUrl(body.modelUrl)??body.modelUrl}:body?.params&&typeof body.model==='string'?{bodyModel:body.model}:{}),...(typeof publicSoulKey==='string'?{publicSoulKey}:{}), ...(seatHeight!==undefined?{seatHeight}:{}), ...(shore.status==='recorded'?{shore:shore.contact}:{}), shoreTime:(this.take.startTick+t/this.take.dt)*this.take.dt,waterTransition:this.waterTransition(id,t), id, p: e.p, yaw: e.yaw, walk, walkDist: dist, activity: e.activity, grip: g?.entity, gripSlot: g?.slot, carryWeight, hands: e.hands, baseActivity: st.baseActivity ?? undefined, ...this.activityHistory(id, frame.tick, e.activity ?? 'idle', climbing ? 0 : walk), ...(typeof (st as {partner?: unknown}).partner==='string'?{partner:(st as {partner:string}).partner}:{}), ...(e.state.handHold||e.state.rps?{...(e.state.handHold?{handHold:e.state.handHold as HandHoldState}:{}),...(e.state.rps?{rps:e.state.rps as RpsState}:{}),handGameTick:this.take.startTick+frame.tick,handGameDt:this.take.dt}:{}), ...(typeof st.prop==='string'?{prop:st.prop}:{}), ...(typeof e.state.instrument==='string'?{instrument:e.state.instrument}:{}),...(game?{game,gameTick:this.take.startTick+frame.tick,gameDt:this.take.dt}:{}),...(Number.isFinite(speed)?{speed:Math.abs(speed)}:{}), on: st.on ?? undefined, ...(proneYaw !== undefined ? { proneYaw } : {}), ...(phaseK !== undefined ? { phaseK } : {}), ...(st.sleepPose ? { sleepPose: recordedSleepPose(this.take,id,frame.tick,st.sleepPose) } : {}) });
    }
    this.stairs(comps);
    this.comps.onTick({ entities: comps });
    this.comps.render(1);
    this.fixtures.onTick({ entities: Object.fromEntries(Object.entries(fixtures).filter(([, e]) => !e.tags?.includes('entity-world'))) });
    this.fixtures.render(clock);
    this.humans.setStationBeat(stationBeat);
    this.humans.setFrame(people, clock, { ...comps, ...fixtures },this.humans.viewer?rigBudget:undefined); // seats / fires come from the fixtures; shots/eyes keep immediate random-access creation
    this.humans.setAttention(Object.fromEntries(Object.entries(frame.entities).filter(([,e]) => Array.isArray(e.state.attention)).map(([id,e]) => [id, e.state.attention as [number,number]])));
    this.humans.render(1, (id, from, out) => this.comps.nearestPoint(id, from, out));
    this.comps.attachHeld(this.humans);
    return frame;
  }

  /** Bodies (entity ids) speaking now in the viewer: they talk with their hands (library talking clips). */
  setSpeaking(ids: ReadonlySet<string>) { this.humans.setSpeaking(ids); }

  /** Pose readout (lab hook / tests): as HumanViews.bones for the last show(). */
  bones(id?: string) {
    return this.humans.bones(id);
  }

  /** Rendered palm of a person's hand and an item's rendered origin (tests: items ride the palm). */
  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3) {
    return this.humans.palmOf(id, hand, out);
  }
  positionOf(id: string) {
    return this.comps.positionOf(id);
  }
  /** Stair flights in use (readout). */
  flights() {
    return this.humans.stairs();
  }
  humanCount() {
    return this.humans.group.children.length;
  }
  /** Caller owns replacement resources. Retain ALL native records for bodies and seats. */
  setFixtureDrawReplacement(group:THREE.Group|null,ids:readonly string[]=[]){
    if(this.fixtureDrawReplacement!==group){this.fixtureDrawReplacement?.removeFromParent();this.fixtureDrawReplacement=group;if(group)this.group.add(group);}
    for(const [object,visible]of this.excludedFixtureObjects)object.visible=visible;
    this.excludedFixtureObjects.clear();
    if(group)for(const id of ids){const object=this.fixtures.group.getObjectByName(id);if(object&&!this.excludedFixtureObjects.has(object)){this.excludedFixtureObjects.set(object,object.visible);object.visible=false;}}
  }
  /** Original identity-bearing geometry remains the sole picking source. */
  pickingRoots():readonly THREE.Object3D[]{return [this.comps.group,this.fixtures.group,this.humans.group,...(this.nativeBoat?[this.nativeBoat.group]:[])];}

  /** Render-only camera blockers; selected human bodies are deliberately excluded. */
  obstructionRoots():readonly THREE.Object3D[]{return [this.comps.group,this.fixtures.group,...(this.fixtureDrawReplacement?[this.fixtureDrawReplacement]:[]),...(this.nativeBoat?[this.nativeBoat.group]:[])];}
  /** Components and fixtures drawn. */
  componentCount() {
    return this.comps.group.children.length + this.fixtures.group.children.length;
  }
  /** Bundles / stacks drawn with their piece counts (readout). */
  stacks() {
    return this.fixtures.stacks();
  }

  dispose() {
    const errors:unknown[]=[],attempt=(release:()=>void)=>{try{release();}catch(error){errors.push(error);}};
    // A nested native owner can report callback errors after cleanup; still release its siblings.
    attempt(()=>this.setFixtureDrawReplacement(null));
    attempt(()=>this.nativeBoat?.dispose());attempt(()=>this.humans.clear());
    attempt(()=>this.comps.dispose());attempt(()=>this.fixtures.dispose());attempt(()=>this.group.removeFromParent());
    if(errors.length)throw new AggregateError(errors,'Take people cleanup failed');
  }
}

/** A camera track the replay can drive the view with: the take's own planned track or a directed one. */
export type ActiveTrack = { id: string; kind: string; data: CameraTrackData };
/** One entry of the replay bar's camera picker. `own`: the take's planned track; `saved`: carried by the take file. */
export type CameraOption = { id: string; kind: string; label: string; own: boolean; saved: boolean };
/** Picker text for a track: its kind (the planned shot list reads "planned"), id and shot count. */
export function cameraLabel(t: ActiveTrack): string {
  const shots = (t.data as CameraTrackData & { shots?: unknown[] }).shots?.length ?? 0;
  const kind = t.kind === 'planned-shot-list' ? 'planned' : t.kind;
  return `${kind} · ${t.id}${shots ? ` · ${shots} shot${shots === 1 ? '' : 's'}` : ''}`;
}

export class TakeReplay {
  readonly group = new THREE.Group();
  readonly file: TakeReplayFile;
  readonly take: Take;
  readonly duration: number;
  /**
   * Render datum: take coordinates + (0, offsetY, 0) = scene coordinates. The drawn people / parts (a shifted render
   * copy of the take) and the engine camera are both shifted, so the take stays self-consistent (STUDIO_REPLAY.md: year-build takes are at the Kit datum y = 0, the
   * studio draws the ground at the year file's `groundY`).
   */
  readonly offsetY: number;
  private own: ActiveTrack;
  private active: ActiveTrack;
  t = 0;
  playing = false;
  speed = 1;
  engineCamera = true;
  private people: TakePeople;
  private log: LogLine[];
  private frame: TakeFrame | null = null;
  private dirty = true;

  /** `scene`: the take's base SpatialScene when the host has it (its stairs links get the stair gait). */
  constructor(file: TakeReplayFile, opts: { scene?: SpatialScene; offsetY?: number } = {}) {
    this.file = file;
    this.take = file.take;
    this.own = this.active = { id: file.camera.id, kind: file.camera.kind, data: trackData(file.camera) };
    this.duration = takeDuration(file.take);
    this.offsetY = opts.offsetY ?? 0;
    this.group.name = 'Take replay · HYPOTHETICAL build scenario (not historical)';
    // the render copy is shifted in data (not by moving the group): the arm / leg solvers mix bone world positions with
    // the engine's target points, so the people must be posed in scene coordinates
    this.people = new TakePeople(shiftTake(file.take, this.offsetY), opts);
    this.group.add(this.people.group);
    this.log = takeLog(file.take, file.steps);
  }

  setTemplates(ts: Template[]) {
    this.people.setTemplates(ts);
    this.dirty = true;
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.dirty = true;
  }

  /** Advance the take clock (only while playing) and redraw if anything changed. */
  update(dt: number) {
    if (this.playing) {
      this.seek(this.t + dt * this.speed);
      if (this.t >= this.duration) this.playing = false;
    }
    if (this.dirty) this.apply();
  }

  private apply() {
    this.dirty = false;
    const t0 = performance.now();
    this.frame = this.people.show(this.t);
    this.timing.push([performance.now() - t0, this.people.sampleMs]);
    if (this.timing.length > 4000) this.timing.splice(0, 2000);
  }
  private timing: [number, number][] = [];

  /**
   * Wall ms per redraw since the last reset (at most the last 2000–4000): `pose` = the whole show() (sampleTake + posing
   * people, parts and piles), `sample` = sampleTake alone. Rendering is not included (the studio's frame loop).
   */
  perf(reset = false) {
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b), r = (x: number) => Math.round(x * 100) / 100;
      return s.length ? { mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(s[s.length >> 1]), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) } : null;
    };
    const out = { redraws: this.timing.length, pose: stat(this.timing.map((x) => x[0])), sample: stat(this.timing.map((x) => x[1])) };
    if (reset) this.timing = [];
    return out;
  }

  /** Pose readout of the people on screen (HumanViews.bones). */
  bones(id?: string) {
    return this.people.bones(id);
  }

  /** Track driving the engine camera (take coordinates). */
  get track(): CameraTrackData {
    return this.active.data;
  }
  /** Id / kind of the active track (the take's own `planned-shot-list`, or a `directed` one). */
  trackInfo(): { id: string; kind: string; own: boolean } {
    return { id: this.active.id, kind: this.active.kind, own: this.active === this.own };
  }
  /** Drive the engine camera with another track of this take (a directed one), or back to the take's own (null). */
  setTrack(track: ActiveTrack | null) {
    this.active = track ?? this.own;
  }

  /** Every camera track the take file carries: the planned one first, then `cameras` in id order (`fileCameras`). */
  fileTracks(): CameraOption[] {
    return fileCameras(this.file).map((c) => {
      const own = c.id === this.own.id;
      return { id: c.id, kind: c.kind, label: cameraLabel(own ? this.own : { id: c.id, kind: c.kind, data: trackData(c) }), own, saved: true };
    });
  }
  /** Drive the engine camera with one of the file's tracks by id (the planned one restores the take's own). */
  useFileTrack(id: string): ActiveTrack {
    if (id === this.own.id) return (this.active = this.own);
    const c = fileCamera(this.file, id);
    if (!c) throw new Error(`take ${this.take.id} has no camera track ${id}`);
    return (this.active = { id: c.id, kind: c.kind, data: trackData(c) });
  }
  /**
   * The take file with `track` added to its `cameras` map (`withFileCamera`: checked, the take and the planned camera
   * untouched). The replay's own file carries it from now on, so the picker lists it as saved.
   */
  withTrack(track: ActiveTrack): TakeReplayFile {
    const f = withFileCamera(this.file, { id: track.id, takeId: this.take.id, kind: track.kind, data: track.data });
    this.file.cameras = f.cameras;
    return f;
  }

  /** Engine camera at the current take time, in scene coordinates (the datum offset applied). */
  cameraPose(): CameraPose {
    const p = sampleTrack(this.track, this.t);
    if (!this.offsetY) return p;
    return { ...p, position: [p.position[0], p.position[1] + this.offsetY, p.position[2]], target: [p.target[0], p.target[1] + this.offsetY, p.target[2]] };
  }

  /** Rendered palm of a person's hand in scene coordinates (posed on the last update). */
  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3) {
    return this.people.palmOf(id, hand, out);
  }
  /** The recorded `hands` of a person at the current time (take coordinates: add offsetY for the scene). */
  recordedHands(id: string): Hands | null {
    return sampleTake(this.take, this.t).entities[id]?.hands ?? null;
  }

  /** Current shot label from the planned shot list (if the track carries one). */
  shotLabel(): string {
    const shots = (this.track as CameraTrackData & { shots?: { label: string; t0: number; t1: number }[] }).shots ?? [];
    return shots.find((s) => this.t >= s.t0 && this.t < s.t1)?.label ?? shots.at(-1)?.label ?? '';
  }

  /** Steps executing at the current time. */
  activeSteps(): TakeStep[] {
    return this.file.steps.filter((s) => s.start !== null && s.start <= this.t && (s.end === null || this.t < s.end));
  }

  /** Diagnostics log up to the current time (newest last) plus totals over the whole take. */
  diagnostics() {
    const upTo = this.log.filter((l) => l.t <= this.t);
    return {
      lines: upTo,
      violations: this.log.filter((l) => l.kind === 'violation').length,
      failed: this.log.filter((l) => l.kind === 'failed').length,
      blocked: this.log.reduce((k, l) => k + (l.kind === 'blocked' ? (l.n ?? 1) : 0), 0),
    };
  }

  /** Test / readout view: what is on screen right now, independent of the camera. */
  info() {
    const f = !this.offsetY && this.frame ? this.frame : sampleTake(this.take, this.t); // take coordinates
    const poses = Object.fromEntries(Object.entries(f.entities).map(([id, e]) => [id, [Math.round(e.p[0] * 1000), Math.round(e.p[1] * 1000), Math.round(e.p[2] * 1000), Math.round(e.yaw * ANG_Q)]]));
    return {
      id: this.take.id,
      t: this.t,
      duration: this.duration,
      playing: this.playing,
      speed: this.speed,
      engineCamera: this.engineCamera,
      entities: Object.keys(f.entities).length,
      rendered: { components: this.people.componentCount(), humans: this.people.humanCount() },
      finalStateHash: hashOf(this.take.finalState),
      recordedFinalStateHash: this.take.finalStateHash,
      poseHash: hashOf(poses),
      shot: this.shotLabel(),
      track: this.trackInfo(),
      /** Sampled now but not drawable: no final-state record and no `entities0` (a pre-mars-take/4 take's emptied pile). */
      undrawable: Object.keys(f.entities).filter((id) => !recordOf(this.take, id)),
      offsetY: this.offsetY,
    };
  }

  dispose() {
    this.people.dispose();
    this.group.removeFromParent();
  }
}
