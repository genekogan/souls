// The studio's animated people (Quaternius CC0 GLBs, clips Idle/Walk/Wave),
// loaded the same way as app/studio/campus-life.ts: clone per actor, scale to
// 1.75 m, feet on y=0. Minimal copy so studio behaviour is untouched.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeResources, loadGltf } from '../../lib/three-resources.ts';
import type { RetryOptions } from '../../lib/retry.ts';
import { BODY_MODEL } from './rig.ts';
import {collectTemplateAppearance,transferActorAppearance,type TemplateAppearance,type ActorAppearance} from './human-appearance.ts';
import {BASE} from '../../../../apps/web/src/base-path.ts';
import {CHARACTER_CLIPS,CHARACTER_WIRE} from './character-wire.ts';

import { PEOPLE } from './people-light.ts';
export { PEOPLE };
export const PERSON_HEIGHT = 1.75;

export type Template = {
  name: string;
  gltf: GLTF;
  /** Ground speed (m/s) the Walk clip implies at timeScale 1, measured from the stance foot. */
  walkSpeed: number;
  /** Model-space forward sign along Z (+1: faces +Z) inferred from stance-foot motion. */
  forward: number;
  /** Arm fit (fitArms): length factor applied to UpperArm / LowerArm, left then right, and the arm length before it. */
  arms: { k: number; before: number }[];
  /** Optional original-byte/loader provenance; never changes the model choice. */
  appearance?:TemplateAppearance;
  /** Ground speed (m/s) of the library locomotion clips at timeScale 1 (clip-library.ts), when present. */
  jogSpeed?: number;
  sprintSpeed?: number;
  runSpeed?: number;
  /** Uniform body scale of a composed core/humanoid@2 look (height / 1.75; engine bodies/humanoid.ts); absent = 1. */
  bodyScale?: number;
};

/** A composed look's body scale (its `height` / PERSON_HEIGHT); 1 for every other model. */
export function bodyScaleOf(gltf: Pick<GLTF, 'scene'>): number {
  const h = (gltf.scene.userData as { humanoid?: { look?: { height?: unknown } } }).humanoid?.look?.height;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h / PERSON_HEIGHT : 1;
}

export type Rig = {
  holder: THREE.Group; // engine pose goes here (position, rotation.y = -yaw)
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  /** Optional extra clips (present in the clips-1 GLBs): played only while an activity asks for them. */
  extra: Partial<Record<ExtraClip, THREE.AnimationAction>>;
  template: Template;
  appearance?:ActorAppearance;
  /** Library clip actions (clip-library.ts), created on first use: only clips someone plays cost anything. */
  lib: Map<string, THREE.AnimationAction | null>;
};
/** The rig's action for a library clip, or null when its GLB has no such clip. */
export function libAction(rig: Rig, name: string): THREE.AnimationAction | null {
  let a = rig.lib.get(name);
  if (a === undefined) {
    const c = THREE.AnimationClip.findByName(rig.template.gltf.animations, name);
    a = c ? rig.mixer.clipAction(c) : null;
    rig.lib.set(name, a);
  }
  return a;
}
export type ExtraClip='wave'|'run'|'interact'|'idleNeutral';
const EXTRA_CLIPS:Record<ExtraClip,string>={wave:'Wave',run:'Run',interact:'Interact',idleNeutral:'Idle_Neutral'};

/** The served character GLB (cache tag bumped whenever the GLBs change). Exactly one pinned URL expression: the
 *  PM build maps it to its own model directory. Under the app's prefix (BASE '/worlds' on a prefixed build, '' at the
 *  root) so a prefixed page never asks the other release on the origin for its art. */
const characterUrl = (name: string) => `${BASE}/modular/environment/animated-${name}.glb?v=ual-1`;
/** Directory the character GLBs are served from; other imported models (eden-imports) are served beside them. */
export const MODEL_DIR = characterUrl('').replace(/animated-\.glb.*$/, '');

/** Lane W3: what the viewer downloads per character (tools/blobs/character-wire.mjs): the mesh file (the source without
 *  its animations, same indices) and its rig's clips file, shared by casual and punk (bit-identical clips; woman has her
 *  own), each tagged with its own sha256 so a rebuilt file is a new URL. */
const wireUrl = (file: string, sha: string) => `${MODEL_DIR}${file}?v=${sha.slice(0, 12)}`;
type Wire = (typeof CHARACTER_WIRE)[keyof typeof CHARACTER_WIRE];
const wireOf = (name: string): Wire | undefined => (CHARACTER_WIRE as Record<string, Wire>)[name];
/** One clips download and parse per rig per load (casual and punk share theirs). */
const clipLoads = new WeakMap<AbortSignal, Map<string, Promise<THREE.AnimationClip[]>>>();
function loadClips(file: keyof typeof CHARACTER_CLIPS, signal: AbortSignal, resources: ThreeResources, retry: RetryOptions): Promise<THREE.AnimationClip[]> {
  const byFile = clipLoads.get(signal) ?? clipLoads.set(signal, new Map()).get(signal)!;
  let p = byFile.get(file);
  if (!p) { p = loadGltf(wireUrl(file, CHARACTER_CLIPS[file].sha256), signal, resources, undefined, retry).then((g) => g.animations); p.catch(() => byFile.delete(file)); byFile.set(file, p); }
  return p;
}

export async function loadTemplates(signal: AbortSignal, resources: ThreeResources,options?:{appearances?:boolean;onAsset?:(name:string,phase:'start'|'loaded'|'failed')=>void;names?:readonly string[];onTemplate?:(template:Template)=>void;retry?:RetryOptions}): Promise<Template[]> {
  // Lane B1: each file is retried after 2, 5 and 10 s on a network error or HTTP 408/429/5xx (lib/retry.ts) before the
  // mesh + clips give way to the old single-file GLB (itself retried the same way); a 404 falls back at once, as before.
  const retry=options?.retry??{};
  return Promise.all(
    PEOPLE.filter(name=>!options?.names||options.names.includes(name)).map(async (name) => {
      const report=(phase:'start'|'loaded'|'failed')=>{try{options?.onAsset?.(name,phase);}catch{/* Optional download reporting cannot prevent a model load. */}};
      report('start');
      try{
      let appearance:TemplateAppearance|undefined,gltf:GLTF|undefined;
      const wire=wireOf(name),observe=options?.appearances?async(bytes:ArrayBuffer,gltf:GLTF)=>{
        const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
        const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        // W3: the mesh file is pinned by its own hash and stands for its source GLB (same node/mesh/material indices)
        if(!signal.aborted)appearance=await collectTemplateAppearance(gltf,name,wire&&sha===wire.meshSHA256?wire.sourceSHA256:sha);
      }:undefined;
      if(wire)try{
        const clips=loadClips(wire.clips,signal,resources,retry);
        gltf=await loadGltf(wireUrl(wire.mesh,wire.meshSHA256),signal,resources,observe,retry);
        // own copies: templateFromGltf's fitArms scales this body's arm translation tracks in place
        gltf.animations=(await clips).map(c=>c.clone());
      }catch(error){
        // a server without the wire files (3.19 legacy: a sealed older copy of /modular) still draws people: the source GLB
        if(signal.aborted)throw error;
        console.warn(`character ${name}: wire files unavailable, loading the source GLB`,error);gltf=undefined;appearance=undefined;
      }
      gltf??=await loadGltf(characterUrl(name),signal,resources,observe,retry);
      const template=await templateFromGltfAsync(name,gltf,appearance,signal);options?.onTemplate?.(template);report('loaded');return template;
      }catch(error){report('failed');throw error;}
    }),
  );
}

/** Validated owner GLBs use the same canonical rig fitting and locomotion measurements. */
export function templateFromGltf(name:string,gltf:GLTF,appearance?:TemplateAppearance):Template{
 const work=prepareTemplate(name,gltf,appearance);for(;;){const step=work.next();if(step.done)return step.value;}
}

/** Downloads already yield; fitting must also give input and paint a turn between its independent measurements. */
export async function templateFromGltfAsync(name:string,gltf:GLTF,appearance?:TemplateAppearance,signal?:AbortSignal):Promise<Template>{
 const work=prepareTemplate(name,gltf,appearance);for(;;){await yieldTemplate();if(signal?.aborted)throw new DOMException('Body preparation cancelled','AbortError');const step=work.next();if(step.done)return step.value;}
}
const yieldTemplate=()=>new Promise<void>(resolve=>{if(typeof MessageChannel==='undefined'){setTimeout(resolve,0);return;}const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(0);});

function* prepareTemplate(name:string,gltf:GLTF,appearance?:TemplateAppearance):Generator<void,Template>{
 // Phone arrival (lane L3): the four locomotion measurements share one fitted clone (a fit clones the whole skinned
 // model; four of them per character were ~0.1 s of a 4x-throttled phone). Each measurement plays only its own clip
 // and stops every action after, so a later one starts from the same pose a fresh clone would (people-template-golden).
 const arms=fitArms(gltf);yield;const f=fit(gltf);yield;
 const jog=measureWalk(gltf,'Jog_Fwd_Loop',f);yield;const sprint=measureWalk(gltf,'Sprint_Loop',f);yield;const run=measureWalk(gltf,'Run',f);yield;const bodyScale=bodyScaleOf(gltf);
 return {name,gltf,arms,...measureWalk(gltf,'Walk',f),...(appearance?{appearance}:{}),...(jog.found?{jogSpeed:jog.walkSpeed}:{}),...(sprint.found?{sprintSpeed:sprint.walkSpeed}:{}),...(run.found?{runSpeed:run.walkSpeed}:{}),...(bodyScale!==1?{bodyScale}:{})};
}

/** A composed body (humanoid@2 kit: one shared rig + parts) as a template: same fit/fitArms/measureWalk. */
export function templateFromParts(name:string,scene:THREE.Group,animations:THREE.AnimationClip[]):Template{
 return templateFromGltf(name,{scene,scenes:[scene],animations,cameras:[],asset:{version:'2.0'},parser:null,userData:{}} as unknown as GLTF);
}
export function templateFromPartsAsync(name:string,scene:THREE.Group,animations:THREE.AnimationClip[]):Promise<Template>{
 return templateFromGltfAsync(name,{scene,scenes:[scene],animations,cameras:[],asset:{version:'2.0'},parser:null,userData:{}} as unknown as GLTF);
}

function clip(gltf: GLTF, name: string) {
  const c = THREE.AnimationClip.findByName(gltf.animations, name);
  if (!c) throw Error(`Missing ${name} animation`);
  return c;
}

/**
 * Clone, centre on x/z, feet at y=0 (campus-life.ts 139–177), scaled uniformly so the shoulder joints
 * stand at BODY_MODEL.shoulderHeight (the body model; POSES.md). The bounding box alone (1.75 m to the
 * top) would make the punk rig's body 7 % smaller than the others (its hair spikes count as height):
 * fitted by shoulders, the crowns are at ≈ 1.75 (woman), 1.77 (casual) and 1.88 m (punk, hair tips).
 * A composed look with a `height` stands bodyScaleOf × that tall (shoulders and everything else scale with it).
 */
const standingBoxes = new WeakMap<GLTF, Map<TemplateAppearance | undefined, THREE.Box3>>();
function fit(gltf: GLTF,appearance?:TemplateAppearance) {
  const model = clone(gltf.scene);
  const actorAppearance=transferActorAppearance(gltf.scene,model,appearance);
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(clip(gltf, 'Idle'));
  const walk = mixer.clipAction(clip(gltf, 'Walk'));
  const extra:Partial<Record<ExtraClip,THREE.AnimationAction>>={};
  for(const [k,name] of Object.entries(EXTRA_CLIPS) as [ExtraClip,string][]){const c=THREE.AnimationClip.findByName(gltf.animations,name);if(c)extra[k]=mixer.clipAction(c);}
  idle.play();
  mixer.update(0.01);
  // The standing box of a fresh clone in the Idle pose depends only on the source and the look: skinned bounds walk
  // every vertex through its bones, ~40 ms a call on a 4x-throttled phone, and every template asks five times.
  const looks = standingBoxes.get(gltf) ?? standingBoxes.set(gltf, new Map()).get(gltf)!;
  let b = looks.get(appearance)?.clone();
  if (!b) { b = new THREE.Box3().setFromObject(model); looks.set(appearance, b.clone()); }
  if(b.isEmpty()||![...b.min.toArray(),...b.max.toArray()].every(Number.isFinite)||b.max.y-b.min.y<1e-5)throw Error('Body model has no finite standing height');
  let scale = PERSON_HEIGHT / (b.max.y - b.min.y);
  const place = () => {
    model.scale.setScalar(scale);
    model.position.set(-(b.min.x + b.max.x) * 0.5 * scale, -b.min.y * scale, -(b.min.z + b.max.z) * 0.5 * scale);
    model.updateMatrixWorld(true);
  };
  place();
  const sh = ['UpperArmL', 'UpperArmR'].map((n) => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3()).y);
  if (sh[0] !== undefined && sh[1] !== undefined) {
    const shoulder=(sh[0]+sh[1])/2;
    if(!Number.isFinite(shoulder)||shoulder<1e-5)throw Error('Body shoulders must stand above its feet');
    scale *= BODY_MODEL.shoulderHeight * bodyScaleOf(gltf) / shoulder;
    place();
  }
  return { model, mixer, idle, walk, extra, scale,...(actorAppearance?{appearance:actorAppearance}:{}) };
}

/**
 * The body model's arm (BODY_MODEL.armLength, shoulder joint → elbow → palm centre), once per loaded
 * template, before any clone: the upper arm and forearm are lengthened by one factor k per side,
 * solved exactly from the Idle pose (palm = midway wrist → middle-finger base, as rig.ts `palm`):
 *   k·|shoulder→elbow| + |k·(wrist − elbow) + (palm − wrist)| = armLength.
 * - the LowerArm / Wrist rest offsets and every clip's translation track for them are scaled by k (the
 *   clips key them each frame), so the elbow and the wrist move out along the bones;
 * - the skin of UpperArm / LowerArm is stretched along the bone axis only (their bind inverses get a
 *   one-axis scale in bone space, direction = the child joint), so girth is unchanged and nothing
 *   shears; hands and fingers keep their size (their bones only move with the wrist).
 * Bone lengths never change after this: poses still never stretch an arm.
 */
function fitArms(gltf: GLTF) {
  const { model, mixer } = fit(gltf);
  const armLength = BODY_MODEL.armLength * bodyScaleOf(gltf); // a composed look's arm scales with its height
  model.updateMatrixWorld(true);
  const w = (n: string) => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
  const out: { k: number; before: number }[] = [];
  const scale = new Map<string, number>();
  for (const side of ['L', 'R']) {
    const [s, e, wr, m] = [`UpperArm${side}`, `LowerArm${side}`, `Wrist${side}`, `Middle2${side}`].map(w);
    if (!s || !e || !wr || !m) continue;
    const a = s.distanceTo(e), fw = wr.clone().sub(e), h = m.clone().sub(wr).multiplyScalar(0.5);
    if(![a,fw.length(),h.length()].every(v=>Number.isFinite(v)&&v>1e-5))throw Error('Body arm chain is collapsed');
    const len = (k: number) => k * a + fw.clone().multiplyScalar(k).add(h).length();
    if(len(.5)>armLength||len(3)<armLength)throw Error('Body arm proportions cannot fit the canonical reach');
    let lo = 0.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (len(mid) < armLength) lo = mid;
      else hi = mid;
    }
    const k = (lo + hi) / 2;
    out.push({ k: +k.toFixed(4), before: +len(1).toFixed(4) });
    scale.set(`LowerArm${side}`, k).set(`Wrist${side}`, k);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  standingBoxes.delete(gltf);   // the arms are about to change: later fits measure the fitted body afresh
  // bone rest offsets (and the skin stretch axis: the child joint, in the parent bone's frame)
  const axis = new Map<string, [THREE.Vector3, number]>();
  gltf.scene.traverse((o) => {
    const k = scale.get(o.name);
    if (!k || !o.parent) return;
    axis.set(o.parent.name, [o.position.clone().normalize(), k]);
    o.position.multiplyScalar(k);
  });
  const scaled = new Set<ArrayLike<number>>(); // clips may share one accessor (constant tracks): scale each buffer once
  for (const clip of gltf.animations)
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const k = scale.get(t.name.slice(0, dot));
      if (!k || t.name.slice(dot + 1) !== 'position' || scaled.has(t.values)) continue;
      scaled.add(t.values);
      for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
    }
  const done = new Set<THREE.Matrix4>();
  gltf.scene.traverse((o) => {
    const sk = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : undefined;
    sk?.bones.forEach((b, i) => {
      const ax = axis.get(b.name), inv = sk.boneInverses[i];
      if (!ax || done.has(inv)) return;
      done.add(inv);
      const [d, k] = ax, x = k - 1;
      // I + (k − 1) d dᵀ: stretch along d about the joint, in the bone's own frame
      const st = new THREE.Matrix4().set(1 + x * d.x * d.x, x * d.x * d.y, x * d.x * d.z, 0, x * d.y * d.x, 1 + x * d.y * d.y, x * d.y * d.z, 0, x * d.z * d.x, x * d.z * d.y, 1 + x * d.z * d.z, 0, 0, 0, 0, 1);
      inv.premultiply(st);
    });
  });
  return out;
}

/**
 * Speed-match data: sample the Walk clip, take the lower foot each sample
 * (the stance foot) and measure how fast it slides backwards relative to the
 * body. That velocity is the ground speed at which feet would not slide.
 */
function measureWalk(gltf: GLTF, name = 'Walk', fitted: ReturnType<typeof fit> = fit(gltf)): { walkSpeed: number; forward: number; found?: boolean } {
  const { model, mixer, idle, walk: base } = fitted;
  const c = name === 'Walk' ? base.getClip() : THREE.AnimationClip.findByName(gltf.animations, name);
  if (!c) { mixer.stopAllAction(); return { walkSpeed: 1, forward: 1 }; }
  const walk = name === 'Walk' ? base : mixer.clipAction(c);
  idle.stop();
  walk.play();
  const feet = ['FootL', 'FootR'].map((n) => model.getObjectByName(n));
  if (feet.some((f) => !f)) return { walkSpeed: 1, forward: 1 };
  const dur = walk.getClip().duration, N = 120, dt = dur / N;
  const v: number[] = [];
  let prev: { foot: number; z: number } | null = null;
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    walk.time = i * dt;
    mixer.update(0);
    // getWorldPosition updates the foot's own ancestor chain (updateWorldMatrix(true, false)): the same matrices
    // a whole-model updateMatrixWorld(true) computes for it, without every other bone and mesh
    const a = feet[0]!.getWorldPosition(p), b = feet[1]!.getWorldPosition(q);   // (each foot's chain once per sample)
    const foot = a.y < b.y ? 0 : 1;
    const z = foot === 0 ? a.z : b.z;
    if (prev && prev.foot === foot) v.push((z - prev.z) / dt);
    prev = { foot, z };
  }
  v.sort((a, b) => a - b);
  const med = v[Math.floor(v.length / 2)] ?? 0;
  const speed = Math.abs(med);
  mixer.stopAllAction();
  // Stance foot moves opposite to facing.
  return speed > 0.2 ? { walkSpeed: speed, forward: med < 0 ? 1 : -1, found: true } : { walkSpeed: 1, forward: 1 };
}

export function createRig(t: Template): Rig {
  const { model, mixer, idle, walk, extra,appearance } = fit(t.gltf,t.appearance);
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  // Engine yaw 0 faces +x; the model faces ±Z. Turn it so its front is local +x.
  const inner = new THREE.Group();
  inner.rotation.y = t.forward > 0 ? Math.PI / 2 : -Math.PI / 2;
  inner.add(model);
  const holder = new THREE.Group();
  holder.userData.avatarIdleClip=idle.getClip().toJSON();
  holder.userData.bodyModel=t.name;
  holder.add(inner);
  idle.play();
  walk.play();
  walk.setEffectiveWeight(0);
  return { holder, model, mixer, idle, walk, extra, template: t, lib: new Map(),...(appearance?{appearance}:{}) };
}
