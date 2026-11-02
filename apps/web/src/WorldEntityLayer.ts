import {handActuatorFrame,knockContacts,opPoint,HAND_REACH_SECONDS,LOCK_TURN_SECONDS,type HandActuatorMotion} from '../../../mars/viewer/engine/social/hand-actuator.ts';
import {lockPose} from './gen-mesh/vocab-look.ts';
// The entity world's picture (spec <eden4>/28 §8): terrain baked from the
// same ground recipe the server uses, water, a horizon ring, and one mesh per
// placed entity drawn from its def. Diffs arrive over the hub as
// `{type:'edge', kind:'world-diff'}`; new or moved things ease in over ~2.5 s.
// Inactive (and invisible) on worlds that have no entity layer.
import { noteModeration, noteSnapshotVersion } from './moderation-hidden.ts';
import { godFeature, isFlagDef } from './god-ui/features.ts';
import { loadSnapshot, parsePieces } from './snapshot-wire.ts';
import { SnapshotDecoder, type SnapshotDelta } from './snapshot-delta.ts';
import * as THREE from 'three';
import { TILE_M, TILE_N, Terrain, groundForTile, heightAt, waterLevelAt, type Ground } from '@sim/ground';
import { WorldModel, stableStringify, CAN_OPENING, CAN_ROSE, CUP_RIM, KETTLE_OPENING, KETTLE_SPOUT, KETTLE_SPOUT_ANGLE, KETTLE_SWITCH, SPOUT_SPEED, cupSteam, spoutSpeed, isKettleDef, isTeaCupDef, kettleHeat, spoutRun, containerInside, type Def, type Entity, type StoredDef } from '@sim/world-compiler';
import { GENERATORS } from '@sim/generators';
import { meshFor, type MeshCtx } from './gen-mesh/index.ts';
import { clearBuildingPrefetch, prefetchBuilding } from './gen-mesh/building.mesh.ts';
import { MaterialLib } from './gen-mesh/materials.ts';
import { animate, glowKind, hasMotion, quantizeGlow, steadyGlowAt, syncLightGlow } from './gen-mesh/motion.ts';
import { hasFlames } from './fx/flames.ts';
import {lightDiffAhead} from './light-diff-clock.ts';
import {wateringDiffAhead} from './watering-diff-clock.ts';
import {defLights} from './WorldNightLights.ts';
import {pourJets, spoutJets, waterJets} from './fx/water-jets.ts';
import {setSteam, steam} from './fx/steam.ts';
import {isGrowingDef, plantGroup, plantLookOf, posePlants, type PlantGroup, type PlantLook} from './fx/plant-growth.ts';
import {itemDiffAhead} from './item-diff-clock.ts';
import {beginOpeningMotion,stepOpeningMotion,type OpeningMotion} from './opening-motion.ts';
import { EntityInstancer, instanceable } from './EntityInstancer.ts';
import { terrainColorFor, terrainColorDeferred, groundRealismFor } from './gen-mesh/ground-palette.ts';
import { mottleSector } from './gen-mesh/terrain-mottle.ts';
import { applyWorldRealism } from './WorldEdenRealism.ts';
import { stepSurfaceKit } from './WorldEdenSurfaceKit.ts';
import { waterMaterial, waterMesh } from './gen-mesh/water.ts';
import { assetUrl, loadAsset } from './gen-mesh/gltf-assets.ts';
import { assetBytes } from './asset-bytes.ts';
import { noteUploadSizes } from './cdn-assets.ts';
import { eagerShas, planEager } from './gen-mesh/lazy-assets.ts';
import { progressiveNearM } from './quality-tier.ts';
import { contextStamp } from './context-stamp.ts';
import { arrivalOver } from './arrival-marks.ts';
import { computeVertexNormals } from './gen-mesh/fast-geometry.ts';
import { entityArrivalPose } from './entity-arrival.ts';
import { keySeen, shapeWedgeDistance, viewFirst, viewWedge, type ViewWedge } from './arrival-view.ts';
import { WorldBuildSites, SITE_REFINEMENT, type PublicSite } from './WorldBuildSites.ts';
import { GroundCover, coverSetting } from './gen-mesh/ground-cover.ts';
import { isRideBalloonDef, rideMotionDef } from './gen-mesh/kits/ride-balloon.ts';
import { isRideCarrierDef, carrierIdOf } from './ride-carriers.ts';
import { holdRainbow, isRainbowDef } from './atmosphere/rainbow-things.ts';
import {WorldEntityStairs,pendingStairDiff} from './WorldEntityStairs.ts';
import { ScatterPools } from './ScatterPools.ts';
import { MotionInstancer } from './MotionInstancer.ts';

export type EntitySnapshot = { contract: string; worldId: string; seq: number; counter?: number; seed?: string; constants: WorldModel['constants']; state: WorldModel['state']; ground: Ground; defs: StoredDef[]; entities: Entity[]; tiles: Record<string, string>; assetBytes?: Record<string, number>; builds?: PublicSite[]; buildsRev?: number; now?: number };
type DiffMsg = { type: 'edge'; kind: 'world-diff'; seq: number; diff: { upserts: Entity[]; removes: string[]; defs: StoredDef[]; tiles: string[]; world?: Partial<WorldModel['state']> }; ground?: Ground; defs?: StoredDef[] };

const SECTOR_TILES = 4;              // 4×4 tiles (256 m) per terrain mesh
const TERRAIN_STEP = 2;              // metres between terrain vertices in the picture
const WATER_SINK_M = 0.03;          // still water drawn this far below its level (no z-fighting with a rim at the level)
const EASE_IN_S = 2.5, EASE_OUT_S = 0.6, DROP_M = 40;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
/** P1 phones: motion that only changes a light's glow (lamps: ~790 on Eden 2026); no part of the thing moves. */
const glowOnly = (def: StoredDef) => !!(def.components.light || def.components.lights) && !hasMotion({ ...def, components: { ...def.components, light: undefined, lights: undefined } } as StoredDef);
/** P1 phones: a frozen thing's subtree is skipped by scene.updateMatrixWorld (its matrices are current; see freeze). */
function frozenMatrixWorld(this: THREE.Object3D) { /* nothing: thawed before anything in it changes */ }
const _box = new THREE.Box3(), _projScreen = new THREE.Matrix4(), _sphere = new THREE.Sphere();

type Figure = { holder: THREE.Object3D; wrists: [THREE.Object3D, THREE.Object3D]; knuckles: [THREE.Object3D | null, THREE.Object3D | null] } | { missingAt: number };
/** PERF-EVENTLOOP: which building (if any) holds a thing and on which storey, resolved when it is first looked at and again
 *  when any ancestor it walked through (`on`) is drawn, redrawn or removed (`stale`), never per frame. */
type Interior = { host: Drawn | null; slot: string; floor: number; on: string[]; stale?: boolean };
type Drawn = { cut?: boolean; opening?: OpeningMotion; interior?: Interior; inst?: string;
  /** PERF-EVENTLOOP: its entity id and a stable phase for the frame-spread checks (set when the record is adopted, DrawnMap). */
  id?: string; k?: number;
  /** PERF-EVENTLOOP: a steady lamp whose glow was not re-synced at the last level step (hidden or off screen then): synced when seen. */
  glowStale?: boolean;
  /** PERF-PASSES: a motion thing's view sphere (offset from its position, radius; measured once it has settled) for the view test. */
  mo?: { ox: number; oy: number; oz: number; r: number }; settled?: boolean; frozen?: THREE.Object3D[]; thaw?: boolean; noFreeze?: boolean; sphere?: THREE.Sphere; offscreen?: boolean; shown?: boolean; obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; removing?: boolean; defHash: string; world?: boolean; motion?: { entity: Entity; def: StoredDef; yaw: number; glowOnly: boolean } };

export class WorldEntityLayer {
  readonly group = new THREE.Group();
  active = false;
  /** The first build is under way (start): nothing to draw or diff yet. */
  building = false;
  /** P1 phones: the first build drew what is near the arrival and start() returned; the rest is drawn now, nearest first,
   *  in small slices between frames. Edge diffs still wait for it (applyEdge). */
  filling = false;
  private model: WorldModel | null = null;
  private readonly stairContacts=new WorldEntityStairs();
  clearSupplementalStairs(){this.stairContacts.clearObservation();}
  supplementalStairs(messages:readonly {kind?:string;seq?:unknown}[]=[],nativeTick:number|null=null){
    if(!this.model||this.resyncing||pendingStairDiff(this.seq,messages,m=>this.stairContacts.affectsDiff(m))){this.clearSupplementalStairs();return [];}
    return this.stairContacts.contacts(this.model,this.drawn,this.groundAt,nativeTick);
  }
  stairDiagnostics(){return this.stairContacts.diagnostics();}
  private immutable=false;
  contextObjects(id:string):THREE.Object3D[]{const object=this.drawn.get(id)?.obj;return object?[object]:[];}
  /** Stable immutable render IDs derive from entity identity and mesh hierarchy, never Three UUIDs. */
  contextMeshes(): { id: string; entity: string; mesh: THREE.Mesh }[] {
    if (!this.immutable) throw new Error('context meshes require an immutable layer');
    const result: { id: string; entity: string; mesh: THREE.Mesh }[] = [];
    for (const [entity, drawn] of this.drawn) {
      const walk = (object: THREE.Object3D, path: string, visible: boolean) => {
        visible &&= object.visible;
        if (visible && object instanceof THREE.Mesh) result.push({ id: `${entity}:${path}`, entity, mesh: object });
        object.children.forEach((child, index) => walk(child, `${path}.${index}`, visible));
      };
      walk(drawn.obj, '0', true);
    }
    return result;
  }
  private seq = -1;
  private readonly terrainGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly thingsGroup = new THREE.Group();
  private sectors = new Map<string, THREE.Mesh>();
  /** PERF-EVENTLOOP: every record set here is adopted (its `settled` and `thaw` writes wake it, it joins `live` for one pass) and
   *  released when replaced or deleted (out of every per-frame set; the things whose host it was look for it again). */
  private readonly drawn: DrawnMap = new DrawnMap(this);
  /** PERF-EVENTLOOP: update() visits only these each frame (the rest cost nothing): things in flight (eased in, moving to a new pose,
   *  easing out), with motion (not a glow-only lamp on the freeze tiers), ridden by a native twin, held or carried, pouring or at a
   *  figure's lips, and every record once when it is drawn, thawed or woken (`settled = false`); a settled still thing leaves after
   *  its still pass (freeze, interior visibility, lamp classification). */
  private readonly live = new Set<string>();
  /** PERF-EVENTLOOP: settled things whose interior visibility must be read again this frame: their host's cut or far state moved
   *  (hostPass), an ancestor was (re)drawn or removed, the container they are kept in, or a steady lamp seen with a stale glow. */
  private readonly visDirty = new Set<string>();
  /** PERF-EVENTLOOP: things whose hand-operated part is still turning (opening-motion.ts), stepped each frame. */
  private readonly openings = new Set<string>();
  /** PERF-EVENTLOOP: ancestor entity id → the drawn things whose interior resolution walked through it (resolveInterior). */
  private readonly dependents = new Map<string, Set<string>>();
  /** PERF-EVENTLOOP: drawn things with an interior (buildings), for decideCuts. */
  private readonly interiors = new Set<Drawn>();
  /** PERF-EVENTLOOP: settled glow-only lamps by how their glow moves: with the shared steady level (synced only when its quantized
   *  value steps, and only those seen; the rest sync when seen), or by their own pattern (a blink, twinkle or flicker: every 4th
   *  frame, 16th off screen, as before). Switched-off lamps are in neither: nothing of them moves. */
  private readonly glowSteady = new Set<string>();
  private readonly glowAnim = new Set<string>();
  private glowLevel = -1;
  private serial = 0;
  /** PERF-EVENTLOOP: a record enters the per-frame sets (DrawnMap.set). Its `settled` and `thaw` become accessors so that any
   *  write that takes it out of rest (draw, undraw, a hand, a native twin, a child added to a frozen subtree, a test) wakes it. */
  adopt(id: string, d: Drawn) {
    let settled = d.settled, thaw = d.thaw;
    Object.defineProperty(d, 'settled', { get: () => settled, set: (v: boolean | undefined) => { settled = v; if (!v) this.live.add(id); }, enumerable: true, configurable: true });
    Object.defineProperty(d, 'thaw', { get: () => thaw, set: (v: boolean | undefined) => { thaw = v; if (v) this.live.add(id); }, enumerable: true, configurable: true });
    d.id = id; d.k = ++this.serial;
    if (d.obj.userData.interior) this.interiors.add(d);
    if (d.opening) this.openings.add(id);
    this.live.add(id);
    this.touchDependents(id);
  }
  /** PERF-EVENTLOOP: a record leaves (replaced or deleted): out of every set; what it hosted or was an ancestor of resolves again. */
  release(id: string, d: Drawn) {
    this.live.delete(id); this.visDirty.delete(id); this.openings.delete(id); this.glowSteady.delete(id); this.glowAnim.delete(id);
    this.interiors.delete(d); this.hostState.delete(d);
    if (d.interior) { for (const a of d.interior.on) { const set = this.dependents.get(a); if (set) { set.delete(id); if (!set.size) this.dependents.delete(a); } } }
    this.touchDependents(id);
  }
  /** The things whose interior resolution walked through entity `id`: they look again (it was drawn, redrawn or removed). */
  private touchDependents(id: string) {
    const deps = this.dependents.get(id); if (!deps) return;
    for (const dep of deps) { const x = this.drawn.get(dep); if (x?.interior) x.interior.stale = true; this.visDirty.add(dep); }
  }
  /** PERF-EVENTLOOP, for tests and probes: how many things update() visits per frame, and the dirty sets' sizes. */
  get loopStats() { return { live: this.live.size, visDirty: this.visDirty.size, openings: this.openings.size, hosts: this.hostState.size, glowSteady: this.glowSteady.size, glowAnim: this.glowAnim.size, drawn: this.drawn.size }; }
  private materials = new Map<string, THREE.Material>();
  readonly lib = new MaterialLib();
  readonly instancer = new EntityInstancer();
  /** PERF-BATCH round 2: frozen scatters' instances draw from one pool per species shared by every scatter (192 m cells on phones; ScatterPools.ts). */
  readonly scatterPools = new ScatterPools();
  scatterPooling = true;
  /** PERF-BATCH round 2: moving things (not lamps that only glow, not fires) draw as instances of their meshes (MotionInstancer.ts). */
  readonly motionInstancer = new MotionInstancer();
  motionInstancing = true;
  readonly sites: WorldBuildSites;
  /** W4: old Eden's tall grass, tufts and wildflowers, drawn around the camera from the ground recipe. */
  readonly cover = new GroundCover(() => (this.active ? this.model : null), coverSetting(), () => this.seq);
  /** Recorded contact drives the leaf on the same depicted tick as the body,
   * including reach, swing and release. No wall-clock tween during native operation. */
  private tugged=new Set<THREE.Object3D>();
  drawHandActuators(entities:Record<string,{state:Record<string,unknown>}>,tick:number,dt:number){
    // M01: no per-frame array; leaf parts found once per drawn object; an unchanged angle (the release and
    // idle hand-off) leaves the leaf and its matrices alone. The angle is still the depicted tick's.
    const peeled=new Set<THREE.Object3D>();
    this.movingBoxes.clear();this.movingAt=this.now;
    for(const rope of this.tugged)rope.rotation.x=0;this.tugged.clear();
    for(const id in entities){
      const m=entities[id].state.handActuator as HandActuatorMotion|undefined;
      // Soul Actions entry 38: a poster being taken down is drawn in the hands (humans.ts) from the moment the peel starts;
      // the wall's own copy of it is hidden until the wall redraws without it at the depicted commit
      if(m?.stroke?.kind==='unposter'&&m.abortedAt===undefined&&(tick-m.startTick)*dt>=HAND_REACH_SECONDS){const d=this.drawn.get(m.target);if(d){let best:THREE.Object3D|null=null,bd=.12;d.obj.traverse(o=>{if(!o.name.startsWith('poster-slot-'))return;const p=o.getWorldPosition(new THREE.Vector3()),dd=Math.hypot(p.x-m.at[0],p.y-m.at[1],p.z-m.at[2]);if(dd<bd){bd=dd;best=o;}});if(best){(best as THREE.Object3D).visible=false;peeled.add(best);this.thawOwner(best);}}continue;}
      // Entry 10: a bell pull's rope swings with the hand's tug, on the depicted tick
      if(m?.tug){const rope=this.drawn.get(m.target)?.obj.getObjectByName('role:rope');if(rope){rope.rotation.x=-handActuatorFrame(m,(tick-m.startTick)*dt).tug*m.tug.angle;this.tugged.add(rope);}continue;}
      if(!m?.opening&&!m?.slide)continue;
      this.movingBoxes.add(m.target);
      const d=this.drawn.get(m.target);if(!d)continue;
      const sec=(tick-m.startTick)*dt,f=handActuatorFrame(m,sec);
      // entry 42: what is kept in a drawer rides with it (its places are where the drawer is pulled out to), and it is
      // seen while the drawer or door moves; at rest a shut container hides it (interiorVisible).
      // Before M01's early `continue`s (a drawer's slide, an unchanged leaf angle), so every moving container is covered.
      for(const [id,box] of this.keptIn){
        if(box!==m.target)continue;const k=this.drawn.get(id);if(!k||k.removing)continue;
        if(k.frozen)this.thaw(k);
        if(m.slide){const off=f.pos-m.slide.travel;k.obj.position.set(k.to.p.x+m.slide.dir[0]*off,k.to.p.y,k.to.p.z+m.slide.dir[1]*off);k.settled=false;}
        this.showKept(id,k,true);
      }
      if(m.slide){
        // a drawer (entry 24) slides by the recorded travel, in its own units
        const target=this.model?.entities.get(m.target),scale=target?this.model!.worldPose(target).s||1:1;
        if(d.frozen)this.thaw(d);d.opening=undefined;
        d.obj.traverse(o=>{if(o.userData.role==='drawer'&&typeof o.userData.restZ==='number')o.position.z=o.userData.restZ+f.pos/scale;});d.obj.updateMatrixWorld(true);
        continue;
      }
      const angle=f.angle;
      // Soul Actions entry 32: the lock under the hand (bolt, thumb-turn, key) and its sounds, on the same depicted tick
      if(m.op||m.passage?.relock){this.drawLock(d,m,f);this.contactSounds(id,m,sec,f.commitAt);}
      let leaf=this.leaves.get(d.obj);
      if(leaf&&leaf.angle===angle&&!d.opening&&!d.motion)continue;
      if(!leaf){leaf={parts:[],angle};d.obj.traverse(o=>{if(o.userData.role==='door')leaf!.parts.push(o);});this.leaves.set(d.obj,leaf);}
      if(d.frozen)this.thaw(d);d.opening=undefined;leaf.angle=angle;
      for(const o of leaf.parts)o.rotation.y=angle;d.obj.updateMatrixWorld(true);
      this.stats.leafWrites++;
    }
    // entry 42: this runs after update(), which saw last frame's moving containers: a drawer whose hand just let go shows
    // what is in it where it is now (shut: hidden; open: at its place), never one frame back at the open place
    for(const [id,box] of this.keptIn){
      // a recorded item (take track) is drawn where its native twin is: a hand is taking it out or has just put it in
      if(this.movingBoxes.has(box)||this.overrides.has(id))continue;const k=this.drawn.get(id);if(!k||k.removing)continue;
      const open=this.model?.entities.get(box)?.state?.open===true;
      if(!open){if(k.inst?k.shown!==false:k.obj.visible)this.showKept(id,k,false);}
      else if(k.obj.position.distanceToSquared(k.to.p)>1e-8&&k.settled){k.obj.position.copy(k.to.p);this.showKept(id,k,true);}
    }
    for(const o of this.peeled)if(!peeled.has(o)){o.visible=true;this.thawOwner(o);}
    this.peeled=peeled;
  }
  private peeled=new Set<THREE.Object3D>();
  private readonly leaves=new WeakMap<THREE.Object3D,{parts:THREE.Object3D[];angle:number}>();
  private readonly lockParts=new WeakMap<THREE.Object3D,{o:THREE.Object3D;role:string}[]>();
  /** Entry 32: a lock turning under a hand. Until the turn's end the world still has the old state, so the drawn lock
   *  turns from it; at the end the state lands (the diff waits for the depicted tick) and the rebuilt door agrees. */
  private drawLock(d:Drawn,m:HandActuatorMotion,f:ReturnType<typeof handActuatorFrame>){
    let parts=this.lockParts.get(d.obj);
    if(!parts){const found:{o:THREE.Object3D;role:string}[]=[];d.obj.traverse(o=>{const r=o.userData.role;if(r==='bolt'||r==='thumb'||r==='key')found.push({o,role:r});});parts=found;this.lockParts.set(d.obj,parts);}
    if(!parts.length)return;
    const locked=this.model?.entities.get(m.target)?.state?.locked===true;let k:number|null=null,key=false;
    if(m.op==='lock'||m.op==='unlock'){
      // nothing to turn when the world already has it so (a walk's thumb-turn on a door somebody else unlocked)
      if(!f.contact&&(m.op==='unlock')!==locked)return;
      k=m.op==='lock'?f.turn:1-f.turn;key=m.opening?.side===1&&f.weight>.5;
    }else if(m.passage?.relock&&m.passage.mode==='close'&&f.contact)k=1;
    if(k===null)return;
    if(d.frozen)this.thaw(d);
    for(const p of parts)lockPose(p.o,p.role,k,key);
    d.obj.updateMatrixWorld(true);
  }
  private readonly soundClock=new Map<string,number>();
  /** Entry 32: the knock of each rap, the click of a lock and the latch, when the depicted time crosses that contact. */
  private contactSounds(id:string,m:HandActuatorMotion,sec:number,commitAt:number){
    const o=m.opening;if(!o||m.abortedAt!==undefined)return;
    const at=(op:'lock'|'unlock'|'knock')=>opPoint(o,op,0) as [number,number,number];
    const due:[ 'knock'|'click'|'latch',number,[number,number,number]][]=m.op==='knock'?knockContacts().map(t=>['knock',t,at('knock')]):m.op?[['click',HAND_REACH_SECONDS+LOCK_TURN_SECONDS*.85,at(m.op)]]:m.passage?.relock&&m.passage.mode==='close'?[['latch',commitAt,at('lock')]]:[];
    if(!due.length)return;
    const key=id+':'+(m.actionId??m.startTick),prev=this.soundClock.get(key);this.soundClock.set(key,sec);if(this.soundClock.size>64)this.soundClock.delete(this.soundClock.keys().next().value!);
    if(prev===undefined||sec<=prev)return;   // first sight of a motion never plays a backlog
    const sound=(window as unknown as {__edenSound?:{contact?:(k:string,a:[number,number,number])=>void}}).__edenSound;
    for(const [kind,t,p] of due)if(prev<t&&sec>=t&&sec-t<.3)sound?.contact?.(kind,p);
  }
  /** Entry 38: redraw every drawn thing whose def has this tag (posters age by the world day shown). */
  redrawTagged(tag:string){const m=this.model;if(!m)return;for(const id of [...this.drawn.keys()]){   // a copy: draw() deletes and re-adds the key (a live Map iterator would visit it again, forever)
    const e=m.entities.get(id),def=e&&m.resolvedDef(e.def);if(e&&def?.tags.includes(tag))this.draw(e,false,true);}}
  /** Does this placed thing publish a lamp pool or a lighthouse beam (world-env's scan)? */
  private lit(id:string){const e=this.model?.entities.get(id),def=e&&this.model!.resolvedDef(e.def);return !!def&&(defLights(def.components).length>0||!!def.tags?.includes('lighthouse'));}
  /** M01: bumped only by a diff that can change a lamp pool (world-env's immediate repaint); other diffs keep its 2 Hz gate. */
  lightSeq = 0;
  /** Entry 42: show or hide a stored thing where its drawn object is now (instanced or not). */
  private showKept(id:string,k:Drawn,shown:boolean){
    if(k.inst){this.instancer.set(k.inst,id,k.obj.position,k.obj.rotation.y,shown?k.obj.scale.x:0,[k.obj.rotation.x,k.obj.rotation.z]);k.shown=shown;}
    else{k.obj.visible=shown;k.obj.updateMatrixWorld(true);}
  }
  /** Entry 42: things kept inside a container (item id → container id), and the containers whose drawer or door a hand
   *  is moving this frame. Only stored things, never a scan of the world. */
  private keptIn=new Map<string,string>();
  private movingBoxes=new Set<string>();
  private movingAt=-Infinity;
  /** Entry 42, for proofs: whether a stored thing is drawn now and where. */
  keptView(id:string){const d=this.drawn.get(id);return d?{box:this.keptIn.get(id)??null,visible:d.inst?(d.shown??true):d.obj.visible,inst:!!d.inst,p:d.obj.position.toArray()}:null;}
  get entityCount() { return this.model?.entities.size ?? 0; }
  /** The placed entities once this layer's picture has reached edit `seq` (else null): GodPanel's flags read them here
   *  instead of downloading the public snapshot again on every edit (lane L3h). */
  entitiesAt(seq: number): Iterable<Entity> | null { return this.model && this.seq >= seq ? this.model.entities.values() : null; }
  private horizon: THREE.Mesh | null = null;
  /** MARSLAND-FAR: entities whose def is tagged `horizon` (core/far-land@1, core/panorama@1) replace the green ring. */
  private horizonBy = new Set<string>();
  private hiddenBase = new WeakSet<THREE.Object3D>();
  /** Viewer B7: things a body carries (entity parent = a body entity) by body id; they ride that figure's animated hand. */
  private held = new Map<string, string>();
  /** Entry 34: taps whose stream is drawn (a can held under one catches it short); growing planters, the look each was
   *  last drawn with and the eases in progress; the rose shower of each can being poured. */
  private tapJets = new Map<string, THREE.Points>();
  private growing = new Set<string>();
  private plantShown = new Map<string, PlantLook>();
  private plantTweens = new Map<string, { from: PlantLook; to: PlantLook; t0: number; dur: number }>();
  private pours = new Map<string, THREE.Points>();
  /** Entry 43: steam over kettles and cups of tea (world space, placed each frame); the depicted tick their heat is read at. */
  private steamers = new Map<string, { pts: THREE.Points; kind: 'kettle' | 'cup'; lamp?: THREE.Mesh }>();
  private depictedTick = Infinity;
  private figures = new Map<string, Figure>();
  private now = 0;
  private readonly api: (p: string) => string;
  constructor(api: (p: string) => string) {
    this.api = api;
    this.sites = new WorldBuildSites({ model: () => this.model, groundAt: this.groundAt, fetchBuilds: async () => {
      const r = await fetch(this.api('/v1/world/builds'), { signal: this.signal ?? undefined, cache: 'no-store' });
      if (!r.ok) throw Error(`Build snapshot: ${r.status}`);
      return r.json();
    } });
    this.group.name = 'entity-world';
    this.group.add(this.terrainGroup, this.waterGroup, this.thingsGroup, this.instancer.group, this.scatterPools.group, this.motionInstancer.group, this.sites.group, this.cover.group);
  }

  private signal: AbortSignal | null = null;
  private lastSeqCheck = 0;
  private bufferedSeq = -1; // received stream head, including native effects awaiting depiction
  private resyncing = false;
  /** Lane PERF-SNAPSHOT: the snapshot worker (snapshot-delta.ts); its baseline is the first load's bytes. `?snapshotWorker=0`
   *  parses on the main thread instead (A/B). Ids a socket diff changed since the last snapshot the worker saw, and whether
   *  one changed the ground: the next delta reports them whatever the worker's baseline says. */
  private readonly decoder = new SnapshotDecoder(typeof Worker === 'undefined' || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('snapshotWorker') === '0') ? null : () => new Worker(new URL('./snapshot-delta.worker.ts', import.meta.url), { type: 'module' }));
  private readonly touched = new Set<string>();
  private groundTouched = false;
  /** Resync: the snapshot again, as a delta against the last one the worker saw (snapshot-delta.ts), applied over short
   *  tasks (applyDelta): only what changed is replaced, re-posed or removed; an unchanged thing is never drawn again, so
   *  on the phone tier it stays frozen and nothing flashes. Used after a missed diff, a seq ahead of ours on the heartbeat,
   *  or a moderation change (G8: the server-filtered picture removes what was hidden). No easing for things already drawn. */
  async resync() {
    if (this.immutable || this.resyncing || !this.signal) return;
    this.clearSupplementalStairs();
    this.resyncing = true;
    try {
      const asked = [...this.touched], wantGround = this.groundTouched;
      const got = await loadSnapshot(this.api('/v1/world/snapshot'), this.signal, false, (pieces) => this.decoder.delta(pieces, asked, wantGround)); if (!got) return;
      const r = got.response; noteSnapshotVersion(r.headers.get('x-moderation-version'));
      const delta = got.snap; if (this.signal.aborted || delta.contract !== 'world/1' || !this.model) return;
      ageNow(delta, r);
      await this.applyDelta(delta, new Set(asked), this.signal);
      for (const id of asked) this.touched.delete(id);
      if (wantGround) this.groundTouched = false;
    } catch (e) { this.stats.lastError = `resync: ${String(e)}`; /* next check retries */ } finally { this.resyncing = false; }
  }
  /** The last resync's shape, for probes: how much of the snapshot was unchanged and how much was drawn. */
  lastResync: { seq: number; total: number; unchanged: number; upserts: number; removes: number; drawn: number; full: boolean; stale: boolean } | null = null;
  /** The resync's apply. The model first (cheap: a few records), then the draws in slices of RESYNC_SLICE_MS with the main
   *  thread free between them (nextTask), each from the model's record at draw time (a diff applied meanwhile wins). A
   *  record identical to ours (a diff already applied) is left alone. A snapshot behind what the socket gave us (a diff
   *  applied while it downloaded) only removes what it lacks and we did not touch (a moderation veto), never steps back. */
  private async applyDelta(delta: SnapshotDelta, asked: Set<string>, signal: AbortSignal): Promise<void> {
    const m = this.model!;
    const stale = delta.seq < this.seq;
    const last = this.lastResync = { seq: delta.seq, total: delta.total, unchanged: delta.unchanged, upserts: 0, removes: 0, drawn: 0, full: delta.full, stale };
    const next = delta.full ? new Set(delta.upserts.map((e) => e.id)) : null;
    const removes = next ? [...m.entities.keys()].filter((id) => !next.has(id)) : delta.removes;
    let lit = false, changed = false;
    for (const id of removes) {
      if ((stale && asked.has(id)) || (!m.entities.has(id) && !this.drawn.has(id))) continue;
      if (this.lit(id)) lit = true;
      m.delete(id); this.undraw(id); last.removes++; changed = true;
    }
    if (stale) { if (lit) this.lightSeq++; if (changed) this.onContextChanged?.(); return; }
    noteUploadSizes(delta.assetBytes);   // CDN4: god uploads may come from assets.eden.art (cdn-assets.ts)
    // defs: new revisions by hash, then every ref to the content the snapshot names (a ref moved back to an older revision too)
    // (a def we already hold keeps its object: content is named by hash, and a full delta repeats every def)
    for (const d of delta.defs) if (!m.defs.has('sha:' + d.hash)) m.defs.set('sha:' + d.hash, d as unknown as StoredDef);
    const retargeted = new Set<string>();
    for (const [ref, hash] of new Map(delta.refs)) { const d = m.defs.get('sha:' + hash); if (!d || m.defs.get(ref)?.hash === hash) continue; retargeted.add(ref); m.defs.set(ref, d); if (ref.startsWith('core-')) { retargeted.add('core/' + ref.slice(5)); m.defs.set('core/' + ref.slice(5), d); } }
    // the ground, the world state (its palette draws the terrain) and the constants
    const ground = delta.ground as Ground | null, groundChanged = !!ground && JSON.stringify(ground) !== JSON.stringify(m.ground());
    const palette = (x: unknown) => JSON.stringify((x as { ground?: unknown } | undefined)?.ground ?? null);
    const paletteChanged = palette(delta.state) !== palette(m.state), stateChanged = JSON.stringify(delta.state) !== JSON.stringify(m.state), constantsChanged = JSON.stringify(delta.constants) !== JSON.stringify(m.constants);
    if (stateChanged) m.state = delta.state as WorldModel['state'];
    if (constantsChanged) m.constants = delta.constants as WorldModel['constants'];
    if (groundChanged) m.terrain = new Terrain(ground!);
    if (typeof delta.counter === 'number') m.seq = delta.counter;
    this.seq = delta.seq;
    this.sites.reset((delta.builds ?? []) as PublicSite[], delta.buildsRev ?? 0, delta.now);
    // entities: a record that differs from ours is replaced and drawn again (eased only when it is new to the picture)
    const queue: { id: string; ease: boolean }[] = [], upserted = new Set<string>();
    for (const e of delta.upserts as unknown as Entity[]) {
      const cur = m.entities.get(e.id);
      if (cur && stableStringify(cur) === stableStringify(e)) continue;
      if (cur) m.delete(e.id);
      m.insert(e); upserted.add(e.id); last.upserts++; changed = true;
      if (m.hasIndex) { const def = m.resolvedDef(e.def); if (def?.layer === 'solid') { try { m.index(e.id, m.footprint(e, def)); } catch { /* best effort */ } } }
      if (this.lit(e.id)) lit = true;
      queue.push({ id: e.id, ease: !this.drawn.has(e.id) });
    }
    // children ride with a moved or replaced parent: the same records, other world poses (no easing, as applyDiff)
    for (const id of upserted) for (const cid of m.subtree(id).slice(1)) if (!upserted.has(cid)) queue.push({ id: cid, ease: false });
    // things whose def ref now names other content are drawn from it
    if (retargeted.size) for (const e of m.entities.values()) if (!upserted.has(e.id) && retargeted.has(e.def)) queue.push({ id: e.id, ease: false });
    if (lit) this.lightSeq++;
    if (delta.defs.some((d) => m.defs.get('sha:' + d.hash) === (d as unknown)) || retargeted.size || groundChanged || stateChanged || constantsChanged) changed = true;
    if (groundChanged) { this.rebuildTerrain(); this.rebuildWater(); this.buildHorizon(); this.sites.refreshAll(true); } else if (paletteChanged) this.rebuildTerrain();
    const seen = new Set<string>();
    for (let i = 0; i < queue.length;) {
      const until = performance.now() + RESYNC_SLICE_MS;
      m.readPass(() => { while (i < queue.length) { const { id, ease } = queue[i++]; if (seen.has(id)) continue; seen.add(id); const e = m.entities.get(id); if (e) { this.draw(e, ease); last.drawn++; } if (performance.now() >= until) break; } });
      if (i < queue.length) { await nextTask('user-visible'); if (signal.aborted || this.model !== m) return; }
    }
    this.stats.resyncs++;
    if (changed) this.onContextChanged?.();
  }

  /** `onSnapshot`: P7b, called once the snapshot (and its parts) are in, or the attempt failed (early-layer.ts lets the
   *  page's second loading phase start then). */
  async start(signal: AbortSignal, onSnapshot?: () => void, frozen?:EntitySnapshot) {
    this.clearSupplementalStairs();
    this.signal = signal;
    let snap: EntitySnapshot;
    // lane L3h: the first start takes the snapshot GET index.html sent at page entry (snapshot-prefetch.ts), one request
    // lane W1/O2: the page's edge-cacheable snapshot URL when the server named one (its `now` is then as old as the copy)
    // lane W3: in its wire form (snapshot-wire.ts: defs and ground as cached content-addressed parts)
    try { if(frozen){this.immutable=true;snap=structuredClone(frozen);onSnapshot?.();}else{ const got = await loadSnapshot(this.api('/v1/world/snapshot'), signal, true, (pieces) => { const snap = parsePieces(pieces); this.decoder.baselineFrom(pieces); return snap; }); onSnapshot?.(); if (!got || signal.aborted) return; const r = got.response; noteSnapshotVersion(r.headers.get('x-moderation-version')); snap = got.snap as unknown as EntitySnapshot;
      ageNow(snap, r); }} catch { onSnapshot?.(); return; }
    if (signal.aborted || snap.contract !== 'world/1') return;
    noteUploadSizes(snap.assetBytes);   // CDN4
    this.model = WorldModel.fromSnapshot({ constants: snap.constants, state: snap.state, seed: snap.seed ?? 'viewer', seq: snap.counter ?? 0, editSeq: snap.seq, defs: snap.defs, entities: snap.entities, ground: snap.ground }, undefined, undefined, { lazyIndex: true });
    // lane PERF-SNAPSHOT: the snapshot's arrival used to be one main-thread task of ~0.4 s on Eden 2026 (parse, model, the
    // eager plan, the building prefetch and the whole terrain bake); it is now a few, with the main thread free between
    // them like the build slices below, and the terrain bake takes the same slices. `building` from here (LiveWorld draws
    // nothing while it is set; edge diffs wait).
    this.building = true;
    try {
    await nextTask(); if (signal.aborted) return;
    // the loading bar's total: VOCAB-MECH lazy GLBs (gen-mesh/lazy-assets.ts) — only the eager set, nearest the arrival
    // lane PERF: nearest the arrival target (entity-arrival.ts frames the centre of what was built; ?at= for shots), not the origin
    const m0 = this.model, q = new URLSearchParams(location.search), at = q.get('at')?.split(',').map(Number), eyeQ = q.get('eye')?.split(',').map(Number);
    const pose = at?.length === 3 && eyeQ?.length === 3 && [...at, ...eyeQ].every(Number.isFinite) ? { target: at, eye: eyeQ } : entityArrivalPose(this.viewBounds(), this.entityCount, this.groundAt, 45, innerWidth / Math.max(1, innerHeight), 1, this.arrivalAt());
    // t4-phone-new: on a phone, what the arrival camera sees (arrival-view.ts): the poster waits only for the GLBs in view
    const view = progressiveNearM() === null ? null : arrivalViewWedge(pose), byId0 = view ? new Map(snap.entities.flatMap((e) => e.name ? [[e.name, e], [e.id, e]] as [string, Entity][] : [[e.id, e]] as [string, Entity][])) : null;
    // the poster waits for the models whose bodies it shows; the first build also draws what casts a shadow into view
    const keyOf0 = byId0 && nearKeyOf(byId0), seen = view && keyOf0 && byId0 ? arrivalSeen(m0, view, keyOf0, byId0, false) : undefined;
    const eagerSizes = m0.readPass(() => planEager(snap, (r) => m0.resolvedDef(r), (e) => { try { const p = m0.worldPose(e); return [p.x, p.z]; } catch { return null; } }, [pose.target[0], pose.target[2]], [pose.eye[0], pose.eye[2]], seen));   // t4-phone: slots remembered per parent
    assetBytes.expect(Object.fromEntries(Object.entries(eagerSizes).map(([sha, n]) => [assetUrl(sha), n])));
    // Phone arrival (lane d3): start the eager GLBs now, nearest first, so they download while the terrain and every
    // thing's holder are built (~2 s of main thread on a 4x phone) instead of after; each thing's own loadAsset(sha)
    // then joins the same cached promise. The arrival card still waits for them to be drawn.
    for (const sha of eagerShas()) void loadAsset(sha).catch(() => {});
    await nextTask(); if (signal.aborted || this.model !== m0) return;
    this.seq = snap.seq;
    this.sites.reset(snap.builds ?? [], snap.buildsRev ?? 0, snap.now);
    // lane W1: the first build runs in slices of ~50 ms with the main thread free in between, so the socket's join set,
    // the first takes and the initial downloads proceed while it builds (the arrival card covers it; LiveWorld draws
    // nothing while `building`). Same draws in the same order; edge diffs wait until it is done (applyEdge).
    {
      const m = this.model;
      // lane W1: every building's geometry starts in the building workers now; the slices below wait for one only when
      // they reach it before it is done (building.mesh.ts prefetchBuilding)
      // P7b (phones): not before the card. The worker's own script (~128 KB br, fetched once per worker) would cross the
      // phone's link before the card; the near ring's buildings are built in place instead, and the fill hands the rest
      // to the workers (fillRest)
      const pending = new Map<string, Promise<void>>();
      const workersLater = progressiveNearM() !== null && new URLSearchParams(location.search).get('nearWorkers') !== '1';
      if (!workersLater) { this.prefetchBuildings(m, snap.entities, pending); await nextTask(); if (signal.aborted || this.model !== m) return; }
      // P7 (phone): only the sectors near the arrival are baked at full detail before the card; the rest are drawn from a
      // coarse direct sample (no tile bakes, ~1/16 of the height samples) and refined during the fill
      // lane L3: the first build's playa mottling runs in a worker (terrain-mottle.ts); PERF-SNAPSHOT: a sector per step, in slices
      let until = performance.now() + BUILD_SLICE_MS;
      for (const _ of this.terrainSteps(undefined, true, progressiveNearM() === null ? undefined : { at: [[pose.target[0], pose.target[2]], [pose.eye[0], pose.eye[2]]], r: COARSE_BEYOND_M, view })) {
        if (performance.now() < until) continue;
        await nextTask(); if (signal.aborted || this.model !== m) return; until = performance.now() + BUILD_SLICE_MS;
      }
      await nextTask(); if (signal.aborted || this.model !== m) return;
      this.rebuildWater();
      this.buildHorizon();
      // P1 phones: nearest the arrival first; start() returns once everything within `near` metres of its eye or target is
      // drawn (the card then goes), and the rest follows between frames (fill). Elsewhere: everything, in snapshot order.
      const near = progressiveNearM();
      const byId = near === null ? null : byId0 ?? new Map(snap.entities.flatMap((e) => e.name ? [[e.name, e], [e.id, e]] as [string, Entity][] : [[e.id, e]] as [string, Entity][])), keyOf = byId && (keyOf0 ?? nearKeyOf(byId));
      const sorted: readonly Entity[] & { dist?: number[] } = !keyOf ? snap.entities : byDistance(snap.entities, keyOf, [pose.target[0], pose.target[2]], [pose.eye[0], pose.eye[2]]);  // P7: shapes by their nearest point; furniture with its building
      const far = near === null ? -1 : sorted.dist!.findIndex((d) => d > near);
      // t4-phone-new: of the near things, those the arrival camera can see (or whose shadow can reach its view) are drawn
      // before the poster; the fill then draws the next things in view, then the near ones behind or beside it (arrival-view.ts)
      const { list: all, first: nearCount } = view && keyOf && byId ? viewFirst(sorted, far < 0 ? sorted.length : far, arrivalSeen(m, view, keyOf, byId, true), FILL_AHEAD) : { list: sorted, first: far < 0 ? sorted.length : far };
      (window as unknown as { __simViewFirst?: unknown }).__simViewFirst = { near: far < 0 ? sorted.length : far, seen: nearCount, wedge: view, eager: eagerShas().length, eagerKB: Math.round(Object.values(eagerSizes).reduce((a, b) => a + b, 0) / 1e3) };   // probes
      for (let i = 0; i < all.length;) {
        if (i >= nearCount && !this.filling) { this.active = true; this.building = false; this.filling = true; this.fill = this.fillRest(m, all, i, pending, signal, workersLater); return; }
        const until = performance.now() + BUILD_SLICE_MS;
        m.readPass(() => { while (i < all.length && !pending.has(all[i].id)) { this.draw(all[i++], false); if (performance.now() >= until) break; } });
        const wait = i < all.length ? pending.get(all[i].id) : undefined;
        if (wait) await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]).then(() => pending.delete(all[i].id));
        else if (i < all.length) await nextTask();
        if (signal.aborted || this.model !== m) return;
      }
      this.active = true;
      if (this.coarse.size && !this.filling) { this.filling = true; this.fill = this.fillRest(m, all, all.length, pending, signal, false); }   // P7: refine the coarse terrain
    }
    } finally { this.building = false; if (!this.filling) clearBuildingPrefetch(); }
  }
  private prefetchBuildings(m: WorldModel, entities: readonly Entity[], pending: Map<string, Promise<void>>) {
    for (const e of entities) {
      const def = m.resolvedDef(e.def); if (!def || def.make.kind !== 'gen' || meshFor(def)?.gen !== 'building/1') continue;
      try { const p = prefetchBuilding({ def, entity: e, params: paramsOf(e, def), args: (def.make.args ?? {}) as Record<string, unknown> }); if (p) { pending.set(e.id, p); void p.then(() => pending.delete(e.id)); } } catch { /* built in place */ }
    }
  }
  /** The fill after a progressive first build (resolves when it is done or given up). */
  fill: Promise<void> = Promise.resolve();
  private async fillRest(m: WorldModel, all: readonly Entity[], from: number, pending: Map<string, Promise<void>>, signal: AbortSignal, workersNow: boolean) {
    try {
      // the arrival's own last steps (first frame, shaders, the card) go first: the fill starts once it is over
      while (!arrivalOver()) { await new Promise((r) => setTimeout(r, 100)); if (signal.aborted || this.model !== m) return; }
      if (workersNow) this.prefetchBuildings(m, all.slice(from), pending);   // P7b: phones start the building workers now
      const arrival = this.coarse.size ? this.arrivalAt() : null;
      for (let i = from; i < all.length || this.coarse.size;) {
        await nextTask('user-visible'); if (signal.aborted || this.model !== m) return;  // background tasks starve between busy phone frames
        // P7: one coarse terrain sector at full detail, then a slice of things
        if (this.refineCoarseSector(arrival)) { await nextTask('user-visible'); if (signal.aborted || this.model !== m) return; }
        if (i >= all.length) continue;
        const until = performance.now() + FILL_SLICE_MS;
        m.readPass(() => { while (i < all.length && !pending.has(all[i].id)) { this.draw(all[i++], false); if (performance.now() >= until) break; } });
        const wait = i < all.length ? pending.get(all[i].id) : undefined;
        if (wait) await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]).then(() => pending.delete(all[i].id));
      }
    } finally { this.filling = false; clearBuildingPrefetch(); try { performance.mark('sim:entity-filled'); } catch { /* no User Timing */ } }
  }

  /** Consume hub messages (the viewer keeps the last 300 edge messages; we only act on newer diffs). */
  readonly stats = { edgeSeen: 0, applied: 0, resyncs: 0, leafWrites: 0, lastError: null as string | null };
  applyEdge(msgs: readonly { type: string; kind?: string; seq?: unknown; rev?: unknown }[], depictedTick=Infinity) {
    this.depictedTick = depictedTick;
    if (this.immutable || !this.model || this.building || this.filling) return;
    for(const m of msgs)if(m.kind==='world-diff'&&typeof m.seq==='number')this.bufferedSeq=Math.max(this.bufferedSeq,m.seq);
    for (const m of msgs) {
      // CE8: attention hints keep the current rev; the sites layer parses each message once.
      if (m.kind === 'world-build') { if ((m as { event?: unknown }).event === 'attention' || (typeof m.rev === 'number' && m.rev > this.sites.maxRev)) this.sites.apply(m); continue; }
      if (m.kind !== 'world-diff' || typeof m.seq !== 'number' || m.seq <= this.seq) continue;
      if (lightDiffAhead(this.model,m,depictedTick)||wateringDiffAhead(this.model,m,depictedTick)||itemDiffAhead(this.model,m,depictedTick)) return;
      this.stats.edgeSeen++;
      if (m.seq > this.seq + 1) { void this.resync(); return; }  // a gap: something was missed; take the whole picture again
      try { this.applyDiff(m as unknown as DiffMsg); this.stats.applied++; } catch (e) { this.stats.lastError = String(e); this.seq = m.seq; }
    }
  }
  onContextChanged?:()=>void;
  private applyDiff(d: DiffMsg) {
    if (!this.model) return;
    // Edits may arrive while no native frame/people renderer is available.
    // Invalidate the observed fixture/old ancestry even for equal reinsertion.
    this.stairContacts.invalidateDiff(d);
    {
      const contextChanged=!!d.ground||!!d.diff.world||d.diff.defs.length>0||d.diff.removes.some(id=>contextStamp(this.model!.entities.get(id)))||d.diff.upserts.some(e=>contextStamp(e)!==contextStamp(this.model!.entities.get(e.id)));
      let lit=!!d.ground||!!d.diff.world||d.diff.defs.length>0||!!d.defs?.length||d.diff.removes.some(id=>this.lit(id))||d.diff.upserts.some(e=>this.lit(e.id));
      this.seq = d.seq;
      const held = this.sites.heldRemovals(d, this.model);
      this.sites.apply(d);
      if(contextChanged&&(d as DiffMsg&{by?:string}).by!=='engine')this.onContextChanged?.();
      for (const def of [...(d.defs ?? []), ...d.diff.defs]) { this.model.defs.set('sha:' + def.hash, def); this.model.defs.set(def.ref, def); if (def.ref.startsWith('core-')) this.model.defs.set('core/' + def.ref.slice(5), def); }
      for (const id of d.diff.removes) { this.touched.add(id); this.model.delete(id); this.undraw(id, held.has(id) ? SITE_REFINEMENT.removalDelaySeconds : 0); }
      for (const e of d.diff.upserts) this.touched.add(e.id);
      if (d.ground || d.diff.world) this.groundTouched = true;
      for (const e of d.diff.upserts) { if (this.model.entities.has(e.id)) this.model.delete(e.id); this.model.insert(e); }
      for (const e of d.diff.upserts) { const def = this.model.resolvedDef(e.def); if (def?.layer === 'solid') { try { this.model.index(e.id, this.model.footprint(e, def)); } catch { /* best effort */ } } }
      // a moved parent carries its lamps (their pools move with it)
      if (!lit) lit = d.diff.upserts.some(e => this.model!.subtree(e.id).some(id => this.lit(id)));
      if (lit) this.lightSeq++;
      if ((d.diff as { constants?: WorldModel['constants'] }).constants) this.model.constants = (d.diff as { constants?: WorldModel['constants'] }).constants!;   // GOD-ENV: the world grew
      if (d.ground) { const grew = JSON.stringify(d.ground.extent) !== JSON.stringify(this.model.ground().extent); this.model.terrain = sameBase(this.model.ground(), d.ground) ? this.model.terrain.retile(d.ground, d.diff.tiles) : new Terrain(d.ground); this.rebuildTerrain(new Set(d.diff.tiles)); this.rebuildWater(); if (grew) this.buildHorizon(); }
      if (d.diff.world) { const before = JSON.stringify((this.model.state as { ground?: unknown }).ground ?? null); this.model.state = { ...this.model.state, ...d.diff.world } as WorldModel['state']; if (JSON.stringify((this.model.state as { ground?: unknown }).ground ?? null) !== before) this.rebuildTerrain(); }
      if (d.ground) this.sites.refreshAll(true); else this.sites.refitDiff(d);
      for (const e of d.diff.upserts) this.draw(e, true);
      // children ride with a moved parent: refresh their targets without easing
      const upserted = new Set(d.diff.upserts.map(e => e.id));
      for (const e of d.diff.upserts) for (const cid of this.model.subtree(e.id).slice(1)) { const c = this.model.entities.get(cid); if (c && !upserted.has(cid)) this.draw(c, false); }
      // a deck's rail opens where another thing's stair lands on it (gen-mesh deck/1): redraw decks when such a thing came or went
      const links = (e: Entity) => { const def = this.model!.resolvedDef(e.def); try { return !!def && !!this.model!.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).links?.length; } catch { return false; } };
      if (d.diff.removes.length || d.diff.upserts.some(links)) for (const e of this.model.entities.values()) { const def = this.model.resolvedDef(e.def); if (!upserted.has(e.id) && def?.make.kind === 'gen' && def.make.gen === 'deck/1') this.draw(e, false, true); }
    }
  }

  /** E-life B7: god things that follow a native engine entity of the same name (a god balloon flying as its native ride,
   *  server god/rides.ts): world position from the recording, or none (back at its own pose). */
  private overrides = new Map<string, THREE.Vector3>();
  /** BALLOON-BODY: the native twin's yaw (Core convention: rotation.y = -yaw), so the drawn cabin's door is Core's door. */
  private overrideYaw = new Map<string, number>();
  private recordedItems = new Set<string>();
  private missingItemAt = new Map<string,number>();
  private lightMoves = new Set<string>();
  /** Only active/settling portable emitters, never a per-frame search of the world. */
  *movingLights() {
    for (const id of this.lightMoves) {
      const d=this.drawn.get(id);
      if(!d) { this.lightMoves.delete(id); continue; }
      if(d.settled&&!this.held.has(id)&&!this.recordedItems.has(id))this.lightMoves.delete(id);
      yield id; // one last final-position update when settling finishes
    }
  }
  lightObject(id:string) { return this.drawn.get(id)?.obj; }
  /** Authoritative small-item poses share the figure's take clock, including
   * approach/grasp/release. Live world diffs may arrive ahead of that clock. */
  itemPoses(entities:Record<string,{p:readonly number[];yaw:number}>) {
    const seen=new Set<string>();
    for(const [id,pose]of Object.entries(entities)) {
      const e=this.model?.entities.get(id);
      if(!e||!this.model?.resolvedDef(e.def)?.tags.includes('recorded-item'))continue;
      seen.add(id);this.recordedItems.add(id);
      this.missingItemAt.delete(id);
      const p=this.overrides.get(id)??new THREE.Vector3();p.set(pose.p[0],pose.p[1],pose.p[2]);this.overrides.set(id,p);this.overrideYaw.set(id,pose.yaw);this.live.add(id);
      if(this.model.resolvedDef(e.def)?.components.light||this.model.resolvedDef(e.def)?.components.lights)this.lightMoves.add(id);
    }
    for(const id of this.recordedItems)if(!seen.has(id)) {
      const d=this.drawn.get(id),last=this.overrides.get(id);
      if(d&&last&&d.to.p.distanceToSquared(last)>.0001){
        const since=this.missingItemAt.get(id)??this.now;this.missingItemAt.set(id,since);
        if(this.now-since<1000)continue; // short write-back grace; a later owner move must never freeze the old pose forever
      }
      this.recordedItems.delete(id);this.missingItemAt.delete(id);this.overrides.delete(id);this.overrideYaw.delete(id);if(d)d.settled=false;
    }
  }
  /** Names of world-level god things with a native ride twin: the god's balloons (def carrier + tag balloon). */
  rideNames(): string[] {
    if (!this.model) return [];
    const out: string[] = [];
    for (const e of this.model.entities.values()) { if (!e.name || e.in.parent !== 'world') continue; const def = this.model.resolvedDef(e.def) as (StoredDef & { components: Record<string, unknown> }) | undefined; if (def && isRideBalloonDef(def)) out.push(e.name); }
    return out;
  }
  /** D1: native carrier ids of world-level god rides that are not balloons (a ferris wheel, a carousel): the thing stays
   *  where the god put it; World draws a car at its twin (WorldRideCars). */
  rideCars(): string[] {
    if (!this.model) return [];
    const out: string[] = [], m = this.model;
    for (const e of m.entities.values()) { if (e.in.parent !== 'world') continue; const def = m.resolvedDef(e.def) as (StoredDef & { components: Record<string, unknown> }) | undefined; if (def && isRideCarrierDef(def) && !isRideBalloonDef(def)) out.push(carrierIdOf(e, id => m.entities.has(id))); }
    return out;
  }
  /** Draw the god thing named `name` where its native twin is (`p`: the recorded engine position), or at its own pose (null).
   *  A thing moored aloft keeps its own height above the ground (drawn y = recorded y + its lift); one standing on the ground
   *  (lift < 0.5 m) draws at the recorded y, so the cabin floor is where Core stands the riders. */
  poseOverride(name: string, p: readonly [number, number, number] | null, yaw?: number) {
    const e = this.model ? [...this.model.entities.values()].find((x) => x.name === name && x.in.parent === 'world') : undefined;
    if (!e) return;
    if (!p) { this.overrideYaw.delete(e.id); if (this.overrides.delete(e.id)) { const d = this.drawn.get(e.id); if (d) d.settled = false; } return; }
    const d = this.drawn.get(e.id); if (!d) return;
    const g = this.groundAt(d.to.p.x, d.to.p.z) ?? 0;
    const v = this.overrides.get(e.id) ?? new THREE.Vector3(); const lift = d.to.p.y - g; v.set(p[0], (lift < 0.5 ? 0 : lift) + p[1], p[2]); this.overrides.set(e.id, v); this.live.add(e.id);  // BALLOON-BODY: a basket standing on the ground draws its floor at the twin's floor (its riders' feet)
    if (yaw === undefined) this.overrideYaw.delete(e.id); else this.overrideYaw.set(e.id, yaw);
  }

  private transported = new Set<string>();
  /** The recorded native load owns its airborne pose, not the slower world-edit
   * stream. Only active human grips and their settling loads are visited. */
  transportPoses(entities: Record<string, {p: readonly number[]; yaw: number; state: Record<string, unknown>}>, bodies: readonly string[]) {
    const held = new Set<string>();
    for (const body of bodies) {
      const grip = entities[body]?.state.grip as {entity?: string} | undefined;
      const contact = entities[body]?.state.carryContactV1 as {item?: string} | undefined;
      const id = grip?.entity ?? contact?.item, e = id && this.model?.entities.get(id);
      if (e && this.model?.resolvedDef(e.def)?.tags.includes('upright-carry')) { held.add(e.id); this.transported.add(e.id); }
    }
    for (const id of this.transported) {
      const e = entities[id], d = this.drawn.get(id);
      if (!e || !d) { this.transported.delete(id); this.overrides.delete(id); this.overrideYaw.delete(id); continue; }
      const p = e.p;
      if (!held.has(id) && d.to.p.distanceToSquared(new THREE.Vector3(p[0], p[1], p[2])) < .0001) {
        this.transported.delete(id); this.overrides.delete(id); this.overrideYaw.delete(id); d.settled = false; continue;
      }
      const pose = this.overrides.get(id) ?? new THREE.Vector3();
      pose.set(p[0], p[1], p[2]); this.overrides.set(id, pose); this.overrideYaw.set(id, e.yaw); this.live.add(id);
    }
  }

  update(dt: number, nowMs: number, baseGround?: THREE.Object3D) {
    this.now = nowMs;
    if (!this.active) return;
    this.sites.update(nowMs);
    const moving = !this.immutable && arrivalOver();
    // W2b: fill old Eden's generated surface patterns (brick, ashlar, clapboard, tile, slate, turf blades) a few rows a
    // frame; until now only old Eden's own layer did, so entity worlds drew the flat placeholders. No-op once complete.
    stepSurfaceKit(2);
    if (this.horizon) this.horizon.visible = this.horizonBy.size === 0;
    if (!this.immutable && nowMs - this.lastSeqCheck > 20_000 && this.signal) {  // cheap heartbeat: did we miss anything while the socket was down?
      this.lastSeqCheck = nowMs;
      // G8: a changed moderation veto also takes the whole (server-filtered) picture again
      void fetch(this.api('/v1/world/seq'), { signal: this.signal }).then((r) => (r.ok ? r.json() : null)).then((j: { seq: number; builds?: number; moderation?: { version?: unknown; hidden?: unknown } } | null) => { if (!this.signal?.aborted && j) { if (noteModeration(j.moderation) || j.seq > Math.max(this.seq,this.bufferedSeq)) void this.resync(); else this.sites.checkRevision(j.builds); } }).catch(() => {});
    }
    const frame = ++this.frame;
    // the entity terrain is the only ground: hide the native backdrop and the native floor planes (a flat
    // plane at y ≈ 0 would cover every pond, river and cut below it)
    // PERF-PASSES: the walk over the native group (~1 ms a frame on Eden 2026, a no-op after the first) runs when the group
    // or its children change and every 30th frame (a plane added deeper is hidden within half a second)
    if (baseGround && (baseGround !== this.baseGround || baseGround.children.length !== this.baseChildren || frame % 30 === 0)) {
      this.baseGround = baseGround; this.baseChildren = baseGround.children.length;
      baseGround.traverse((o) => { if ((o.name === 'outside-ground' || o.name === 'commons-ground' || (o.parent === baseGround && (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'PlaneGeometry')) && !this.hiddenBase.has(o)) { o.visible = false; this.hiddenBase.add(o); } });
    }
    this.instancer.updateBounds(); this.scatterPools.updateBounds();
    const view = this.viewer;
    // P1 phones: frozen things skip the matrix walk on the promise that what they hang from does not move; if it ever does, thaw all
    if (this.freezeSettled && !this.thingsGroup.matrixWorld.equals(this.frozenUnder)) { this.frozenUnder.copy(this.thingsGroup.matrixWorld); for (const [id, d] of this.drawn) if (d.frozen) { this.thaw(d); this.live.add(id); } }
    // Entry 34: taps run to their basin unless a held can catches the stream this frame (below); growth and wilt ease
    for (const jets of this.tapJets.values()) (jets.material as THREE.ShaderMaterial).uniforms.uDrop.value = jets.userData.dropDefault;
    this.stepSteam();
    for (const [id, tw] of this.plantTweens) {
      const d = this.drawn.get(id), grp = d?.obj.getObjectByName('plant growth') as PlantGroup | undefined;
      if (!d || !grp) { this.plantTweens.delete(id); continue; }
      if (d.frozen) { this.thaw(d); this.live.add(id); }
      const k = easeInOut((nowMs - tw.t0) / tw.dur), look = { g: tw.from.g + (tw.to.g - tw.from.g) * k, w: tw.from.w + (tw.to.w - tw.from.w) * k, m: tw.from.m + (tw.to.m - tw.from.m) * k };
      posePlants(grp, look); setPatch(d.obj, look.m); d.obj.updateMatrixWorld(true); this.plantShown.set(id, look);
      if (k >= 1) this.plantTweens.delete(id);
    }
    // PERF-EVENTLOOP: no pass over the drawn things. Settled still things (Eden 2026: ~4,600 of 4,877; a 50,000-thing world: nearly
    // all) cost nothing per frame: what can change about them arrives as an event (a diff redraws, a host's cut moves, a lamp
    // level steps, a hand or a twin wakes) and lands in a small set. The passes below each walk one such set.
    for (const id of this.openings) { const d = this.drawn.get(id); if (!d?.opening) this.openings.delete(id); else if (!stepOpeningMotion(d.opening, nowMs)) { d.opening = undefined; this.openings.delete(id); } }
    this.hostPass();
    for (const id of this.keptIn.keys()) this.visDirty.add(id);   // entry 42: a kept thing follows its box's lid and the hand on it (a 200 ms window: read every frame; a handful)
    if (this.visDirty.size) { for (const id of this.visDirty) { const d = this.drawn.get(id); if (d && !this.live.has(id)) this.refreshVisibility(id, d, nowMs); } this.visDirty.clear(); }
    this.glowPass(nowMs, frame);
    for (const id of this.live) {
      const d = this.drawn.get(id); if (!d) { this.live.delete(id); continue; }
      if (d.thaw) this.thaw(d);
      // PERF-PASSES: a settled instanced thing (3,263 of Eden 2026's 4,877) keeps its slot, pose and scale; only its interior
      // visibility (its building's cut, far furniture on a phone) can change.
      // P1: a settled, still thing (eased in, no motion, not ridden or held) keeps its pose: only its interior visibility can
      // change. On the freeze tiers a lamp whose only motion is its glow counts as still too (glowPass keeps its level).
      // PERF-EVENTLOOP: either leaves `live` after this still pass and is not visited again until an event wakes it.
      const stillInst = !!d.inst && !!d.settled && !d.motion && !d.removing && d.obj.userData.cupShown === undefined && !this.overrides.has(id) && !this.held.has(id) && !this.pours.has(id);
      if (stillInst || (d.settled && !d.inst && (!d.motion || (this.freezeSettled && d.motion.glowOnly)) && !d.removing && !this.overrides.has(id) && !this.held.has(id))) { this.stillPass(id, d, nowMs); this.live.delete(id); continue; }
      if (d.frozen) this.thaw(d);
      const t = easeOut((nowMs - d.t0) / 1000 / d.dur);
      d.obj.position.lerpVectors(d.from.p, d.to.p, t);
      // entry 44: a mug being drunk from or rinsed follows the drawn hand (its figure's cup pose), not the recorded item pose:
      // the engine's mug is the same timeline resolved on a 1.75 m body, the drawn one on this rig's own lips
      const cupHand = !d.removing && this.held.has(id) && !d.obj.userData.handleGrip && this.cupHeld(id, d);
      const ride = cupHand ? undefined : this.overrides.get(id); if (ride) { d.obj.position.copy(ride); const yaw = this.overrideYaw.get(id); if (yaw !== undefined) d.obj.rotation.y = -yaw; }
      const s = d.from.s + (d.to.s - d.from.s) * t;
      d.obj.scale.setScalar(s);
      const shown = this.interiorVisible(id, d);
      const inHand = cupHand || (!ride && !d.removing && this.held.has(id) && (d.obj.userData.handleGrip ? this.handleHeld(id, d) : this.handPoint(this.held.get(id)!, d.obj.position)));
      if (!inHand || !d.obj.userData.cupShown) this.cupWater(id, null);
      if (!inHand && this.pours.has(id)) this.pours.get(id)!.visible = false;
      if (d.inst) {
        if (d.removing && t >= 1) { this.instancer.remove(d.inst, id); this.drawn.delete(id); continue; }
        if (inHand || ride || !d.settled || shown !== (d.shown ?? true) || d.obj.userData.cupShown !== undefined) { if (d.obj.userData.cupShown === false) d.obj.userData.cupShown = undefined; this.instancer.set(d.inst, id, d.obj.position, d.obj.rotation.y, shown ? d.obj.scale.x : 0, [d.obj.rotation.x, d.obj.rotation.z]); d.shown = shown; if (t >= 1) d.settled = true; }
        continue;
      }
      d.obj.visible = shown;
      if (d.removing && t >= 1) { this.thingsGroup.remove(d.obj); disposeObject(d.obj); this.drawn.delete(id); continue; }
      if (t >= 1 && (!d.motion || (this.freezeSettled && d.motion.glowOnly)) && !d.removing && !ride && !inHand) d.settled = true;
      // P1: a hidden thing (a storey its building hides, or far furniture on a phone) is not animated: nobody sees it
      // P7b: things stay at their stored pose under the arrival card (the creatures' first route search was ~0.09 s of a 4x
      // phone's card); nobody sees motion before the card is gone
      // PERF-PASSES: a motion thing wholly outside the view (a conservative sphere measured once it settled) is animated every
      // 2nd frame when it moves about (a route, a creature's rig), every 4th otherwise: motion is a function of world time,
      // so it is exactly where it would be when it comes into view. In view, held or ridden: every frame, as before.
      if (d.motion && t >= 1 && !inHand && shown && moving && (!view || ride || this.motionInView(d, view, d.k! + frame))) animate(d.obj, d.motion.entity, d.motion.def, nowMs / 1000, { y: ride ? ride.y : d.to.p.y, yaw: ride && this.overrideYaw.has(id) ? -this.overrideYaw.get(id)! : d.motion.yaw });
      if (ride) { d.obj.position.x = ride.x; d.obj.position.z = ride.z; }
    }
    void dt;
  }

  /** PERF-EVENTLOOP: a settled thing's one still pass: its interior visibility, a glow-only lamp's classification (glowPass), and on
   *  the freeze tiers its freeze. It then leaves `live` until an event wakes it. */
  private stillPass(id: string, d: Drawn, nowMs: number) {
    this.refreshVisibility(id, d, nowMs);
    if (d.inst) return;
    if (d.motion?.glowOnly) {
      const kind = glowKind(d.obj, d.motion.entity, d.motion.def);
      this.glowSteady.delete(id); this.glowAnim.delete(id);
      if (kind === 'steady') { this.glowSteady.add(id); if (d.obj.visible && !d.offscreen) this.syncGlow(d, nowMs); else d.glowStale = true; }
      else if (kind === 'patterned') this.glowAnim.add(id);
    }
    if (this.freezeSettled && !d.frozen && !d.noFreeze) this.freeze(d);
  }
  /** PERF-EVENTLOOP: a settled thing reads its interior visibility again (visDirty): an instanced thing rewrites its slot only when
   *  that changed; a drawn one shows or hides (its batch re-prepares); a steady lamp seen with a stale glow syncs. */
  private refreshVisibility(id: string, d: Drawn, nowMs: number) {
    const shown = this.interiorVisible(id, d);
    if (d.inst) { if (shown !== (d.shown ?? true)) { this.instancer.set(d.inst, id, d.obj.position, d.obj.rotation.y, shown ? d.obj.scale.x : 0, [d.obj.rotation.x, d.obj.rotation.z]); d.shown = shown; } return; }
    if (shown !== d.obj.visible) { d.obj.visible = shown; if (d.frozen) this.staticRevision++; }
    if (shown && d.glowStale && this.glowSteady.has(id) && !this.immutable) this.syncGlow(d, nowMs);
  }
  /** PERF-EVENTLOOP: each interior host's cut and far state, once per host per frame (Eden 2026: 239 buildings hold 3,400 things);
   *  the things of a host whose state moved are read again this frame (visDirty), the rest are not touched. */
  private hostPass() {
    for (const [host, hs] of this.hostState) {
      const o = host.obj; if (!o.parent) continue;   // gone: its things re-resolve (release marked them)
      const it = o.userData.interior as { cut(): number } | undefined;
      const far = !!it && !!this.interiorFrom && o.parent === this.thingsGroup && o.position.distanceToSquared(this.interiorFrom) > this.interiorRange * this.interiorRange, cut = it ? it.cut() : Infinity;
      if (hs ? (!!it && hs.far === far && hs.cut === cut) : !it) continue;
      this.hostState.set(host, it ? { far, cut } : null);
      const deps = this.dependents.get(host.id!); if (deps) for (const id of deps) this.visDirty.add(id);
    }
  }
  /** PERF-EVENTLOOP: glow-only lamps (Eden 2026: ~790). Steady ones share one level (motion.ts steadyGlowAt): when its quantized
   *  value steps, every seen one is synced and the hidden or off-screen ones are marked stale (synced when seen: refreshVisibility,
   *  cull). Patterned ones animate every 4th frame, 16th off screen, as before. Nothing is visited on the other frames. */
  private glowPass(nowMs: number, frame: number) {
    if (!this.freezeSettled) { if (this.glowSteady.size || this.glowAnim.size) { for (const id of this.glowSteady) this.live.add(id); for (const id of this.glowAnim) this.live.add(id); this.glowSteady.clear(); this.glowAnim.clear(); } return; }   // the lamps are motion things again (as before)
    if (this.immutable) return;
    if (this.glowSteady.size) {
      const q = quantizeGlow(steadyGlowAt(nowMs / 1000));
      if (q !== this.glowLevel) { this.glowLevel = q; for (const id of this.glowSteady) { const d = this.drawn.get(id)!; if (d.obj.visible && !d.offscreen) this.syncGlow(d, nowMs); else d.glowStale = true; } }
    }
    for (const id of this.glowAnim) { const d = this.drawn.get(id)!; if (d.obj.visible && ((d.k! + frame) & (d.offscreen ? 15 : 3)) === 0) this.syncGlow(d, nowMs); }
  }
  private syncGlow(d: Drawn, nowMs: number) { animate(d.obj, d.motion!.entity, d.motion!.def, nowMs / 1000, { y: d.to.p.y, yaw: d.motion!.yaw }); d.glowStale = false; }
  /** Viewer B7: where a body's figure holds a carried thing — the palm of its raised hand (the carrying arm is posed to
   *  the engine's hand point; the free one hangs lower), or between both palms when they are level (two-handed / seated).
   *  The figure is the native people view's rig, found in the scene by its name (= the body's engine id). False when the
   *  body has no figure here (no takes yet, or a stand-in): then the thing stays at the body entity's carry slot. */
  private handPoint(body: string, out: THREE.Vector3): boolean {
    const f = this.figureOf(body); if (!f) return false;
    f.holder.updateWorldMatrix(true, true);
    const palm = (k: 0 | 1, v: THREE.Vector3) => { f.wrists[k].getWorldPosition(v); const kn = f.knuckles[k]; if (kn) v.lerp(kn.getWorldPosition(_v3), 0.5); return v; };
    palm(0, _pl); palm(1, _pr);
    if (Math.abs(_pl.y - _pr.y) < 0.06) out.copy(_pl).lerp(_pr, 0.5); else out.copy(_pl.y > _pr.y ? _pl : _pr);
    return true;  // its base at the palm centre (a seated figure's palms rest on the thighs: lower would sink into them)
  }
  /** Entry 44: a mug being drunk from or rinsed is drawn where its holder's figure says (humans.ts `cupPose`: the cup
   *  timeline's pose moved with the drawn palm), tilted; the tap's stream ends in it, rinse water shows in it and runs out
   *  of its rim into the basin. What is drawn is published on the mug (`cupDebug`) for proofs. */
  private cupHeld(id: string, d: Drawn): boolean {
    const f = this.figureOf(this.held.get(id)!), cp = f?.holder.userData.cupPose as { item: string; base: THREE.Vector3; q: THREE.Quaternion; water: number; outflow: number; tilt: number; atLips: boolean; lips: number[]; rimNear: number[]; palm: number[]; target: number[]; grip: number } | undefined;
    if (!f || !cp || cp.item !== id) { if (d.obj.userData.cupShown) { d.obj.userData.cupShown = false; d.obj.quaternion.setFromAxisAngle(_yAxis, d.obj.rotation.y); } return false; }
    d.obj.userData.cupShown = true;
    d.obj.position.copy(cp.base); d.obj.quaternion.copy(cp.q);
    const s = d.obj.scale.x, up = _vs.set(0, 1, 0).applyQuaternion(cp.q);
    // the water's surface in the mug (horizontal, at its level up the axis), and the opening a tap's stream falls into
    const level = CUP_RIM.floor + (CUP_RIM.full - CUP_RIM.floor) * cp.water, surface = _v3.copy(cp.base).addScaledVector(up, level * s);
    for (const jets of this.tapJets.values()) {
      const n = jets.getWorldPosition(_vn);
      if (Math.hypot(surface.x - n.x, surface.z - n.z) < 0.08 && surface.y < n.y - 0.01) (jets.material as THREE.ShaderMaterial).uniforms.uDrop.value = (n.y - surface.y) / Math.max(0.01, jets.parent?.getWorldScale(_vr).y ?? 1);
    }
    this.cupWater(id, cp.water > 0.02 && cp.tilt > -0.6 ? { at: surface, r: (CUP_RIM.r - 0.002) * s * Math.max(0.5, up.y) } : null);
    // the rinse water leaving the lowest point of the rim, falling into the basin under it
    let pour = this.pours.get(id), rim: number[] | null = null, drop = 0;
    if (cp.outflow > 0.003) {
      let low = Infinity; const p = new THREE.Vector3();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; p.set(Math.cos(a) * CUP_RIM.r * s, CUP_RIM.h * s, Math.sin(a) * CUP_RIM.r * s).applyQuaternion(cp.q).add(cp.base); if (p.y < low) { low = p.y; rim = p.toArray(); } }
      let floor = rim![1] - 0.3; for (const jets of this.tapJets.values()) { const n = jets.getWorldPosition(_vn); if (Math.hypot(rim![0] - n.x, rim![2] - n.z) < 0.4) floor = n.y - Number(jets.userData.dropDefault ?? 0.3) * (jets.parent?.getWorldScale(_vr).y ?? 1); }
      drop = Math.max(0.03, rim![1] - floor);
      const dir = _vo.set(up.x, 0, up.z); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
      if (!pour) { pour = spoutJets(SPOUT_SPEED); this.thingsGroup.add(pour); this.pours.set(id, pour); }
      const u = (pour.material as THREE.ShaderMaterial).uniforms;
      pour.position.set(rim![0], rim![1], rim![2]); pour.rotation.set(0, Math.atan2(-dir.z, dir.x), 0); pour.visible = true;
      u.uFlow.value = cp.outflow; u.uDir.value = -0.9; u.uDrop.value = drop;
    } else if (pour) pour.visible = false;
    d.obj.userData.cupDebug = { base: cp.base.toArray().map((v) => +v.toFixed(4)), up: up.toArray().map((v) => +v.toFixed(4)), tilt: +cp.tilt.toFixed(4), atLips: cp.atLips, lips: cp.lips.map((v) => +v.toFixed(4)), rimNear: cp.rimNear.map((v) => +v.toFixed(4)), palm: cp.palm.map((v) => +v.toFixed(4)), target: cp.target.map((v) => +v.toFixed(4)), grip: +cp.grip.toFixed(3), water: +cp.water.toFixed(3), surface: surface.toArray().map((v) => +v.toFixed(4)), outflow: +cp.outflow.toFixed(3), rim: rim?.map((v) => +v.toFixed(4)) ?? null, drop: +drop.toFixed(3) };
    return true;
  }
  private cupWaters = new Map<string, THREE.Mesh>();
  private cupWater(id: string, w: { at: THREE.Vector3; r: number } | null) {
    let m = this.cupWaters.get(id);
    if (!w) { if (m) m.visible = false; return; }
    if (!m) { m = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#bfe3f2', transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0 })); m.name = 'rinse water'; m.renderOrder = 2; this.thingsGroup.add(m); this.cupWaters.set(id, m); }
    m.position.copy(w.at); m.scale.setScalar(w.r); m.visible = true;
  }
  /** Entry 34: a thing held by its handle (a watering can) hangs from the right palm by its grip, turned with the body and
   *  tipped by the recorded pour (the figure's `wateringTilt`); its rose showers while the figure says the water flows. */
  private handleHeld(id: string, d: Drawn): boolean {
    const f = this.figureOf(this.held.get(id)!); if (!f) return false;
    f.holder.updateWorldMatrix(true, true);
    const s = d.obj.scale.x, grip = d.obj.userData.handleGrip as number[], tilt = Number(f.holder.userData.wateringTilt ?? 0), flow = Number(f.holder.userData.wateringFlow ?? 0);
    f.wrists[1].getWorldPosition(_pr); const kn = f.knuckles[1]; if (kn) _pr.lerp(kn.getWorldPosition(_v3), 0.5);
    // entry 43: a kettle also turns about the grip toward the cup it pours into (engine yaw: + is to the body's right)
    const turn = Number(f.holder.userData.wateringYaw ?? 0), vessel = d.obj.userData.vessel as { opening: number[]; outlet: number[]; angle: number; pour: 'spout' } | undefined;
    f.holder.getWorldQuaternion(_qh); if (turn) _qh.multiply(_qy.setFromAxisAngle(_yAxis, -turn)); _qh.multiply(_qt.setFromAxisAngle(_zAxis, -tilt));
    d.obj.quaternion.copy(_qh);
    d.obj.position.copy(_pr).sub(_v3.set(grip[0], grip[1], grip[2]).multiplyScalar(s).applyQuaternion(_qh));
    // a tap's stream ends in the can's filler opening when the opening is under the nozzle
    const op = vessel?.opening ?? CAN_OPENING, opening = _vo.set(op[0], op[1] + 0.008, op[2]).multiplyScalar(s).applyQuaternion(_qh).add(d.obj.position);
    for (const jets of this.tapJets.values()) {
      const n = jets.getWorldPosition(_vn);
      if (Math.hypot(opening.x - n.x, opening.z - n.z) < 0.16 && opening.y < n.y - 0.02) (jets.material as THREE.ShaderMaterial).uniforms.uDrop.value = (n.y - opening.y) / Math.max(0.01, jets.parent?.getWorldScale(_v3).y ?? 1);
    }
    let pour = this.pours.get(id);
    if (vessel) { this.spoutPour(id, d, vessel, flow, tilt, s); return true; }
    if (flow > 0.003) {
      if (!pour) { pour = pourJets(); this.thingsGroup.add(pour); this.pours.set(id, pour); }
      const rose = _vr.set(CAN_ROSE[0], CAN_ROSE[1], CAN_ROSE[2]).multiplyScalar(s).applyQuaternion(_qh).add(d.obj.position);
      const u = (pour.material as THREE.ShaderMaterial).uniforms, yaw = _eu.setFromQuaternion(f.holder.getWorldQuaternion(_qy), 'YXZ').y;
      // the spout leaves the can 43° above its base line; tipped by `tilt`; the shower falls to the soil under the rose
      pour.position.copy(this.thingsGroup.worldToLocal(rose.clone())); pour.rotation.set(0, yaw, 0); pour.visible = true;
      u.uFlow.value = flow; u.uDir.value = 0.75 - tilt; u.uDrop.value = Math.max(0.05, rose.y - this.soilUnder(rose));
    } else if (pour) pour.visible = false;
    return true;
  }
  /** Entry 43: a kettle's pour. The stream leaves the drawn spout tip along the spout (tipped by the recorded tilt) at
   *  SPOUT_SPEED and falls to the tea's surface in the cup under it (rising as the cup fills); what the stream does is
   *  published on the kettle (`pourDebug`) for proofs: tip, landing, the cup and its rim distance. */
  private spoutPour(id: string, d: Drawn, vessel: { outlet: number[]; angle: number }, flow: number, tilt: number, s: number) {
    const q = d.obj.quaternion, o = vessel.outlet, tip = _vr.set(o[0], o[1], o[2]).multiplyScalar(s).applyQuaternion(q).add(d.obj.position);
    const fwd = _vn.set(1, 0, 0).applyQuaternion(q); fwd.y = 0; if (fwd.lengthSq() < 1e-9) fwd.set(1, 0, 0); fwd.normalize();
    const el = vessel.angle - tilt;
    // the cup under the stream: the nearest drawn cup of tea within 0.15 m of where a 7 cm fall would land
    const guess = spoutRun(el, 0.07);
    let cup: string | null = null, best = 0.15, surface = tip.y - 0.5;
    for (const [cid, st] of this.steamers) { if (st.kind !== 'cup') continue; const c = this.drawn.get(cid); if (!c) continue; const p = c.obj.position, r = Math.hypot(p.x - (tip.x + fwd.x * guess), p.z - (tip.z + fwd.z * guess)); if (r < best && p.y < tip.y) { best = r; cup = cid; const tea = Number(this.model?.entities.get(cid)?.state?.tea ?? 0); surface = p.y + (0.014 + (CUP_RIM.full - 0.014) * Math.max(0, Math.min(1, tea))) * c.obj.scale.x; } }
    const drop = Math.max(0.02, tip.y - surface), run = spoutRun(el, drop, spoutSpeed(flow)), land = [tip.x + fwd.x * run, surface, tip.z + fwd.z * run];
    const c = cup ? this.drawn.get(cup)!.obj.position : null;
    d.obj.userData.pourDebug = { flow: +flow.toFixed(3), tilt: +tilt.toFixed(4), tip: tip.toArray().map((v) => +v.toFixed(4)), land: land.map((v) => +v.toFixed(4)), cup, rim: c ? +Math.hypot(land[0] - c.x, land[2] - c.z).toFixed(4) : null, drop: +drop.toFixed(3) };
    let pour = this.pours.get(id);
    if (flow > 0.003) {
      if (!pour) { pour = spoutJets(SPOUT_SPEED); this.thingsGroup.add(pour); this.pours.set(id, pour); }
      const u = (pour.material as THREE.ShaderMaterial).uniforms;
      pour.position.copy(tip); pour.rotation.set(0, Math.atan2(-fwd.z, fwd.x), 0); pour.visible = true;
      u.uFlow.value = flow; u.uDir.value = el; u.uDrop.value = drop;
    } else if (pour) pour.visible = false;
  }
  /** Entry 43: each kettle's and cup's steam from its state at the depicted tick (one uniform each); hidden when cold. */
  private stepSteam() {
    if (!this.steamers.size || !this.model) return;
    for (const [id, st] of this.steamers) {
      const d = this.drawn.get(id), e = this.model.entities.get(id);
      if (!d || !e || d.removing || !d.obj.visible) { setSteam(st.pts, 0); if (st.lamp) st.lamp.visible = false; continue; }
      const s = d.obj.scale.x, q = d.obj.quaternion;
      if (st.kind === 'kettle') {
        const k = kettleHeat(e.state, this.depictedTick), o = KETTLE_SPOUT;
        st.pts.position.set(o[0], o[1], o[2]).multiplyScalar(s).applyQuaternion(q).add(d.obj.position);
        const jet = _vs.set(Math.cos(KETTLE_SPOUT_ANGLE), Math.sin(KETTLE_SPOUT_ANGLE), 0).applyQuaternion(q).multiplyScalar(0.3 + 0.5 * k.steam);
        setSteam(st.pts, k.steam, jet);
        if (st.lamp) { st.lamp.visible = k.on; if (k.on) st.lamp.position.set(KETTLE_SWITCH[0] - 0.01, KETTLE_SWITCH[1] + 0.008, KETTLE_SWITCH[2]).multiplyScalar(s).applyQuaternion(q).add(d.obj.position); }
        d.obj.userData.kettleHeat = { phase: k.phase, steam: +k.steam.toFixed(3), tick: this.depictedTick };
      } else {
        const v = cupSteam(e.state, this.depictedTick);
        st.pts.position.set(0, CUP_RIM.h * s, 0).add(d.obj.position);
        setSteam(st.pts, v, _vs.set(0, 0.02, 0));
      }
    }
  }
  /** The top of the soil under a point: a growing planter's within reach, else the ground under the drawn body. */
  private soilUnder(p: THREE.Vector3): number {
    let best = Infinity, y = p.y - 0.6;
    for (const id of this.growing) { const d = this.drawn.get(id); if (!d) continue; const q = d.obj.position, r = Math.hypot(q.x - p.x, q.z - p.z); if (r < 0.75 && r < best) { best = r; y = q.y + 0.372 * d.obj.scale.x; } }
    return y;
  }
  private figureOf(body: string): { holder: THREE.Object3D; wrists: [THREE.Object3D, THREE.Object3D]; knuckles: (THREE.Object3D | null)[] } | null {
    let f = this.figures.get(body);
    if (f && 'holder' in f && !attached(f.holder)) f = undefined;
    if (!f || ('missingAt' in f && this.now - f.missingAt > 1000)) {
      let root: THREE.Object3D = this.group; while (root.parent) root = root.parent;
      let found: Figure = { missingAt: this.now };
      root.traverse((o) => {
        if ('holder' in found || o.name !== body) return;
        const bone = (n: string) => { let b: THREE.Object3D | null = null; o.traverse((c) => { if (!b && (c as THREE.Bone).isBone && c.name === n) b = c; }); return b as THREE.Object3D | null; };
        const wl = bone('WristL'), wr = bone('WristR');
        if (wl && wr) found = { holder: o, wrists: [wl, wr], knuckles: [bone('Middle2L'), bone('Middle2R')] };
      });
      this.figures.set(body, found); f = found;
    }
    return 'holder' in f ? f as never : null;
  }

  private frame = 0;
  private frozenUnder = new THREE.Matrix4();
  /** P1 phones: a settled still thing's matrices are brought up to date once and its subtree leaves scene.updateMatrixWorld
   *  altogether (Eden 2026: ~8,500 of the scene's ~8,900 objects were walked, recomposed and re-multiplied every frame,
   *  ~10% of a phone frame). Anything that moves it first takes it out of `settled` (then `thaw`); a child added anywhere in
   *  it (a lazy GLB arriving, a clip hook) thaws it for one frame. Things with skinned or clip-animated parts never freeze. */
  private freeze(d: Drawn) {
    let live = false;
    d.obj.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh || o.userData.animates) live = true; });
    if (live) { d.noFreeze = true; return; }
    const list: THREE.Object3D[] = [];
    d.obj.traverse((o) => { if (o.matrixAutoUpdate) { o.updateMatrix(); o.matrixAutoUpdate = false; list.push(o); } o.addEventListener('childadded', this.onFrozenChild); });
    d.obj.updateMatrixWorld(true);
    d.obj.userData.frozenDrawn = d;
    d.obj.updateMatrixWorld = frozenMatrixWorld;
    _box.setFromObject(d.obj);
    // Z2: no extent yet (only frame hooks, whose geometry is one point: a mesh with a distant version picks and loads its
    // model from its hook, mesh-lod.ts) = nothing to cull by. A zero-radius sphere was always "under cullPx", so the hook
    // never ran and the thing never appeared on phones.
    d.sphere = _box.isEmpty() || _box.min.equals(_box.max) ? undefined : _box.getBoundingSphere(new THREE.Sphere());
    d.frozen = list;
    if (this.scatterPooling && d.world) this.scatterPools.add(d.obj.uuid, d.obj);   // PERF-BATCH round 2: its instances draw from the shared pools
    if (!d.cut) delete d.obj.userData.renderDynamic; this.staticRevision++;
  }
  private thaw(d: Drawn) {
    if (d.id !== undefined) this.live.add(d.id);   // a hand or a child changed it outside update(): freeze it again after its next still pass
    if (d.frozen) {
      for (const o of d.frozen) o.matrixAutoUpdate = true;
      d.obj.traverse((o) => o.removeEventListener('childadded', this.onFrozenChild));
      delete (d.obj as { updateMatrixWorld?: unknown }).updateMatrixWorld;  // the prototype's again
      delete d.obj.userData.frozenDrawn;
      // PERF-BATCH: a thawed thing's batch falls back to its originals until it is frozen (and batched) again
      d.obj.userData.renderDynamic = true; this.staticRevision++;
      this.scatterPools.remove(d.obj.uuid);
    }
    d.frozen = undefined; d.thaw = false; d.sphere = undefined;
  }
  private readonly onFrozenChild = (ev: { target: THREE.Object3D }) => {
    for (let o: THREE.Object3D | null = ev.target; o; o = o.parent) { const d = o.userData.frozenDrawn as Drawn | undefined; if (d) { d.thaw = true; return; } }
  };
  /** P1 phones: render time only (like WorldDistanceDetail): a frozen thing wholly outside the view, or smaller than `cullPx`
   *  pixels of radius, is not drawn, so three.js neither walks nor projects its subtree. Frames that redraw the shadow map keep
   *  off-screen things (they may cast shadows into view). Call `uncull` right after rendering. */
  cull(camera: THREE.PerspectiveCamera, viewHeight: number, shadowPass: boolean, shadowCamera: THREE.Camera | null = null) {
    if (!this.freezeSettled || !this.active) return;
    camera.updateMatrixWorld();
    const frustum = this.frustum.setFromProjectionMatrix(_projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // PERF-EDEN: on a frame that redraws the shadow map, an off-screen thing is kept only when the sun's shadow box (the
    // follow box around what the camera looks at, ~100 m) can see it: a thing outside that box casts nothing into view.
    // The shadow camera's matrices are those of the last shadow pass (the sun and its box move slowly).
    const sunFrustum = shadowPass && shadowCamera ? this.sunFrustum.setFromProjectionMatrix(_projScreen.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse)) : null;
    const cam = camera.position, ppu = viewHeight / (2 * Math.tan(camera.fov * Math.PI / 360)) * (camera.zoom || 1);
    for (const d of this.drawn.values()) {
      const o = d.obj;
      if (!d.sphere || !o.visible || !d.frozen) { d.offscreen = false; continue; }
      const s = d.sphere, dist = s.center.distanceTo(cam) - s.radius;
      const off = !frustum.intersectsSphere(s);
      d.offscreen = off;
      if ((dist > 0 && s.radius * ppu / dist < this.cullPx) || (off && (!shadowPass || (sunFrustum !== null && !sunFrustum.intersectsSphere(s))))) { o.visible = false; this.culled.push(o); }
      else if (d.glowStale && !off) this.visDirty.add(d.id!);   // PERF-EVENTLOOP: a steady lamp drawn with a stale glow syncs at the next update
    }
    this.cullStats.culled = this.culled.length;
  }
  uncull() { for (const o of this.culled) o.visible = true; this.culled.length = 0; }
  cullPx = 1.25;
  private readonly sunFrustum = new THREE.Frustum();
  readonly cullStats = { culled: 0 };
  /** PERF-PASSES: the viewer's eye and view frustum (LiveWorld sets it from the camera before `update`; null for a Soul's
   *  eyes and shots). Motion things wholly outside it are animated less often (see update). */
  viewer: { eye: THREE.Vector3; frustum: THREE.Frustum } | null = null;
  /** Last update(): motion things animated this frame / skipped as out of view (diagnostics, tests). */
  readonly motionStats = { animated: 0, skipped: 0 };
  private motionInView(d: Drawn, view: { frustum: THREE.Frustum }, phase: number): boolean {
    let mo = d.mo;
    if (!mo) {
      _box.setFromObject(d.obj);
      const e = d.obj.matrixWorld.elements;
      if (_box.isEmpty()) mo = { ox: 0, oy: 0, oz: 0, r: 2 };
      else { const s = _box.getBoundingSphere(_sphere); mo = { ox: s.center.x - e[12], oy: s.center.y - e[13], oz: s.center.z - e[14], r: Math.max(1.5, s.radius * 1.5 + 1) }; }
      d.mo = mo;
    }
    const e = d.obj.matrixWorld.elements;
    _sphere.center.set(e[12] + mo.ox, e[13] + mo.oy, e[14] + mo.oz); _sphere.radius = mo.r;
    if (view.frustum.intersectsSphere(_sphere)) { this.motionStats.animated++; return true; }
    const c = d.motion!.def.components, due = (phase & (c.route || d.obj.userData.rig ? 1 : 3)) === 0;
    if (due) this.motionStats.animated++; else this.motionStats.skipped++;
    return due;
  }
  /** PERF-PASSES: for an upward ray at (x, z) (the atmosphere's and the sound's cover probe, world-env.ts): the layer's
   *  groups except the things, and the top-level things that can be above the point: frozen things whose bounding circle
   *  covers it, and every thing without a sphere (not frozen). The probe raycast the whole layer (~9,000 objects) on every
   *  frame the camera had moved. */
  readonly coverCandidates = (x: number, z: number): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    for (const g of this.group.children) if (g !== this.thingsGroup) out.push(g);
    for (const d of this.drawn.values()) {
      const o = d.obj; if (o.parent !== this.thingsGroup) continue;
      const s = d.frozen ? d.sphere : undefined;
      if (s) { const dx = s.center.x - x, dz = s.center.z - z; if (dx * dx + dz * dz > s.radius * s.radius) continue; }
      out.push(o);
    }
    return out;
  };
  private baseGround: THREE.Object3D | null = null; private baseChildren = -1;
  /** Each interior host's cut and far state (null: no interior data), kept across frames and refreshed once per host per frame
   *  (hostPass), never once per thing in it. A host enters when a thing resolves to it and leaves when its record is released. */
  private hostState = new Map<Drawn, { far: boolean; cut: number } | null>();
  private culled: THREE.Object3D[] = [];
  private frustum = new THREE.Frustum();
  /** P1 phones: when set (the phone tier), things inside a building further than `interiorRange` metres from this point
   *  are not drawn (a phone shows a building's furniture through its windows as a few pixels; ~1,300 meshes on Eden 2026). */
  interiorFrom: THREE.Vector3 | null = null;
  /** P1 phones: a settled still thing's subtree leaves scene.updateMatrixWorld (Eden 2026: ~8,700 objects re-multiplied
   *  every frame, ~13% of a phone frame). Anything that moves it first takes it out of `settled`. */
  private freezeStill = false;
  get freezeSettled() { return this.freezeStill; }
  set freezeSettled(value: boolean) {
    if (value === this.freezeStill) return;
    this.freezeStill = value;
    // The desktop early renderer settles before LiveWorld enables freezing; those things need their still pass again.
    for (const id of this.drawn.keys()) this.live.add(id);
  }
  /** PERF-BATCH: changes whenever a thing freezes, thaws, is shown or hidden, replaced or removed: what the static batcher
   *  (rendering/StaticBatchOwner.ts) trusts between validations, and what tells LiveWorld to re-prepare its batches. */
  staticRevision = 0;
  /** PERF-BATCH: the frozen, still, non-instanced things the static batcher may merge: whole objects under `thingsGroup`
   *  that nothing animates (a glowing lamp's emissive changes; a thing kept in a container shows and hides with its lid). */
  staticBatchRoots(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const [id, d] of this.drawn) if (d.frozen && !d.inst && (!d.motion || d.motion.glowOnly) && !d.removing && !d.cut && d.obj.visible && d.obj.parent === this.thingsGroup && !this.keptIn.has(id) && !this.held.has(id)) roots.push(d.obj);
    return roots;
  }
  /** PERF-BAKED-SHADOWS: what casts into the sun's cached shadow (rendering/SunShadowCache.ts): every frozen thing, the
   *  entity instance pools and the scatter pools. Moving things, bodies, sites and ground cover stay in the per-frame map.
   *  `shadowRevision` changes whenever any of them appears, goes, moves, shows or hides. */
  shadowStatics(out: THREE.Object3D[]): THREE.Object3D[] {
    if (!this.active) return out;
    out.push(this.instancer.group, this.scatterPools.group);
    for (const d of this.drawn.values()) if (d.frozen && !d.inst && d.obj.parent === this.thingsGroup) out.push(d.obj);
    return out;
  }
  get shadowRevision() { return this.staticRevision + this.instancer.revision; }
  /** PERF-BATCH: before each draw, every frozen building decides its storey cut for this camera (building.mesh.ts does it
   *  in the meshes' render hooks, which a merged batch never runs). A building that hides a storey leaves the batches
   *  (renderDynamic: its batch falls back this frame; the next preparation merges without it) until it is whole again. */
  decideCuts(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    for (const d of this.interiors) {   // PERF-EVENTLOOP: the buildings, not every drawn thing
      const interior = d.obj.userData.interior as { decide?: (camera: THREE.Camera) => boolean } | undefined;
      if (!interior?.decide || !d.frozen) continue;
      const cut = interior.decide(camera);
      if (cut === !!d.cut) continue;
      d.cut = cut; this.staticRevision++;
      if (cut) d.obj.userData.renderDynamic = true; else delete d.obj.userData.renderDynamic;
    }
  }
  /** The frozen thing an object belongs to (if any) thaws at the next update: something under it was shown or hidden. */
  private thawOwner(o: THREE.Object3D) { for (let p: THREE.Object3D | null = o; p; p = p.parent) { const d = p.userData.frozenDrawn as Drawn | undefined; if (d) { d.thaw = true; return; } } }
  interiorRange = 30;
  /** Interior view (building/1's mesh sets `userData.interior`): a thing on a storey its building hides is hidden too. */
  private interiorVisible(id: string, d: Drawn): boolean {
    if (!this.model) return true;
    // entry 42: a thing kept in a shut drawer or locker is not seen, unless a hand is opening or closing it right now
    const box = this.keptIn.get(id); if (box && !(this.movingBoxes.has(box) && this.now - this.movingAt < 200) && this.model.entities.get(box)?.state?.open !== true) return false;
    // PERF-EVENTLOOP: which building (if any) holds a thing, and on which slot, is resolved once and again only when an ancestor
    // it walked through is drawn, redrawn or removed (touchDependents), or its host's object left the scene (redrawn since)
    let c = d.interior;
    if (!c || c.stale || (c.host && !c.host.obj.parent)) c = this.resolveInterior(id, d);
    if (c.host === null) return true;
    // the host's cut and far state: kept per host (hostPass refreshes it once per frame), read here only when first asked
    let hs = this.hostState.get(c.host);
    if (hs === undefined) {
      const hostObj = c.host.obj, host = hostObj.userData.interior as { cut(): number; floorOf: Record<string, number> } | undefined;
      hs = host ? { far: !!this.interiorFrom && hostObj.parent === this.thingsGroup && hostObj.position.distanceToSquared(this.interiorFrom) > this.interiorRange * this.interiorRange, cut: host.cut() } : null;
      this.hostState.set(c.host, hs);
    }
    if (hs === null) return true;
    return !hs.far && c.floor <= hs.cut;
  }
  /** PERF-EVENTLOOP: walk a thing's parent chain (up to 6) to the nearest drawn ancestor with an interior; every ancestor id walked
   *  through is remembered (dependents), so the walk repeats only when one of them changes. */
  private resolveInterior(id: string, d: Drawn): Interior {
    const prev = d.interior; if (prev) for (const a of prev.on) { const set = this.dependents.get(a); if (set) { set.delete(id); if (!set.size) this.dependents.delete(a); } }
    const c: Interior = { host: null, slot: '', floor: 0, on: [] };
    let e = this.model!.entities.get(id), slot = e?.in.slot;
    for (let depth = 0; e && e.in.parent !== 'world' && depth < 6; depth++) {
      const pid = e.in.parent; c.on.push(pid);
      let set = this.dependents.get(pid); if (!set) { set = new Set(); this.dependents.set(pid, set); } set.add(id);
      const h = this.drawn.get(pid);
      if (h?.obj.userData.interior) { c.host = h; c.slot = slot ?? ''; c.floor = (h.obj.userData.interior as { floorOf: Record<string, number> }).floorOf[c.slot] ?? 0; break; }
      e = this.model!.entities.get(pid); slot = e?.in.slot;
    }
    d.interior = c;
    return c;
  }

  /** A box worth looking at first: the placed things if any, else the middle of the world. */
  viewBounds(): [number, number, number, number] {
    if (!this.model) return [-60, -60, 60, 60];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const e of this.model.entities.values()) {
      if (e.in.parent !== 'world') continue;
      const d = this.model.resolvedDef(e.def); if (!d || d.components.landform || d.make.kind === 'gen' && (d.make.gen === 'landform/1' || d.make.gen === 'lake/1')) continue;
      if (e.shape && 'area' in e.shape) { for (const [x, z] of e.shape.area) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } continue; }
      const wp = this.model.worldPose(e); x0 = Math.min(x0, wp.x - 10); z0 = Math.min(z0, wp.z - 10); x1 = Math.max(x1, wp.x + 10); z1 = Math.max(z1, wp.z + 10);
    }
    if (!Number.isFinite(x0)) { const h = Math.min(120, this.model.constants.extent / 4); return [-h, -h, h, h]; }
    return [x0, z0, x1, z1];
  }

  /** The world's own arrival spot: a top-level thing named `arrival` (Little Martians' flag at the Ceramic Commons), or null. */
  arrivalAt(): [number, number] | null {
    if (!this.model) return null;
    for (const e of this.model.entities.values()) if (e.name === 'arrival' && e.in.parent === 'world') { const wp = this.model.worldPose(e); return [wp.x, wp.z]; }
    return null;
  }

  /** Terrain meshes, for picking a ground point with a ray (flags). */
  terrainMeshes(): THREE.Object3D[] { return [...this.sectors.values()]; }

  /** C1: the world's ground rectangle [x0, z0, x1, z1] (camera zoom limit and bounds), or null before the model. */
  groundExtent(): readonly [number, number, number, number] | null { return this.model ? this.model.ground().extent : null; }

  /** Raw immutable height field for architectural cameras; water is not solid ground. */
  contextGroundAt = (x: number, z: number): number | null => {
    if (!this.immutable || !this.model) return null;
    const [x0, z0, x1, z1] = this.model.ground().extent;
    return x < x0 || x > x1 || z < z0 || z > z1 ? null : this.model.terrain.sample(x, z);
  };

  /** Height for the camera clamp and anything else that asks; null outside the extent. */
  groundAt = (x: number, z: number): number | null => {
    if (!this.model) return null;
    const [bx0, bz0, bx1, bz1] = this.model.ground().extent;   // GOD-ENV: the world's bounds
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return null;
    const y = this.model.terrain.sample(x, z);
    const w = waterLevel(this.model.ground(), x, z);
    return w !== null && w > y ? w : y;
  };
  /** groundAt's exact height without baking a terrain tile that is not baked yet (Terrain.peek): for scans of far points
   *  (world-env's lamp pools), which otherwise bake the whole world's terrain in one frame before a phone's card. */
  groundPeek = (x: number, z: number): number | null => {
    if (!this.model) return null;
    const [bx0, bz0, bx1, bz1] = this.model.ground().extent;
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return null;
    const y = this.model.terrain.peek(x, z);
    const w = waterLevel(this.model.ground(), x, z);
    return w !== null && w > y ? w : y;
  };

  dispose() {
    this.sites.dispose();
    this.instancer.dispose(); this.scatterPools.dispose(); this.motionInstancer.dispose();
    this.cover.dispose();
    for (const m of this.sectors.values()) { m.geometry.dispose(); }
    this.sectors.clear();
    for (const d of this.drawn.values()) disposeObject(d.obj);
    this.drawn.clear();this.tugged.clear();this.live.clear();this.visDirty.clear();this.openings.clear();this.dependents.clear();this.interiors.clear();this.hostState.clear();this.glowSteady.clear();this.glowAnim.clear();
    this.recordedItems.clear();this.missingItemAt.clear();this.lightMoves.clear();this.keptIn.clear();this.movingBoxes.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.waterGroup.clear(); this.terrainGroup.clear(); this.thingsGroup.clear();
    if (this.horizon) { this.horizon.geometry.dispose(); (this.horizon.material as THREE.Material).dispose(); this.horizon = null; }
    this.active = false; this.model = null;
  }

  // ---------- terrain ----------

  /** P7: sectors drawn coarse at the arrival, still to be refined (keys `sx,sz`). */
  private coarse = new Set<string>();
  private rebuildTerrain(onlyTiles?: Set<string>, deferMottle = false, fineNear?: { at: [number, number][]; r: number; view?: ViewWedge | null }) {
    for (const _ of this.terrainSteps(onlyTiles, deferMottle, fineNear)) { /* every sector now */ }
  }
  /** The terrain rebuild one sector per step (lane PERF-SNAPSHOT: the first build takes them in slices, start()); the
   *  steps after the last sector (dropping sectors outside the extent, re-settling things on re-baked tiles) run when the
   *  generator finishes, so always run it to the end. */
  private *terrainSteps(onlyTiles?: Set<string>, deferMottle = false, fineNear?: { at: [number, number][]; r: number; view?: ViewWedge | null }): Generator<void> {
    const m = this.model!; const [bx0, bz0, bx1, bz1] = m.ground().extent;   // GOD-ENV: bounds, a rectangle once extended
    const tx0 = Math.floor(bx0 / TILE_M), tx1 = Math.ceil(bx1 / TILE_M) - 1, tz0 = Math.floor(bz0 / TILE_M), tz1 = Math.ceil(bz1 / TILE_M) - 1;
    const sx0 = Math.floor(tx0 / SECTOR_TILES), sx1 = Math.floor(tx1 / SECTOR_TILES), sz0 = Math.floor(tz0 / SECTOR_TILES), sz1 = Math.floor(tz1 / SECTOR_TILES);
    const wanted = new Set<string>();
    for (let sz = sz0; sz <= sz1; sz++) for (let sx = sx0; sx <= sx1; sx++) {
      const key = `${sx},${sz}`; wanted.add(key);
      if (onlyTiles && this.sectors.has(key)) {
        let touched = false;
        for (const tk of onlyTiles) { const [tx, tz] = tk.split(',').map(Number); if (Math.floor(tx / SECTOR_TILES) === sx && Math.floor(tz / SECTOR_TILES) === sz) { touched = true; break; } }
        if (!touched) continue;
      }
      const coarse = !!fineNear && !fineNear.at.some(([x, z]) => rectDistance(x, z, sx * SECTOR_TILES * TILE_M, sz * SECTOR_TILES * TILE_M, (sx + 1) * SECTOR_TILES * TILE_M, (sz + 1) * SECTOR_TILES * TILE_M) <= fineNear.r);
      // t4-phone: the near sectors too from the recipe directly, at full step: the same heights at every vertex (a tile holds
      // the same recipe's heights on its 1 m grid) for a quarter of the samples and no tile bakes (Eden 2026: ~0.3 s of 4x
      // CPU before the poster); their slope colour by 2 m differences until the fill refines them from the tiles
      // t4-phone-new: a sector the arrival camera cannot see is not drawn before the poster at all; the fill draws it with
      // the coarse ones (refineCoarseSector), nearest first (Eden 2026: most of a portrait phone's ground lies behind it)
      const X0 = sx * SECTOR_TILES * TILE_M, Z0 = sz * SECTOR_TILES * TILE_M, X1 = X0 + SECTOR_TILES * TILE_M, Z1 = Z0 + SECTOR_TILES * TILE_M;
      if (fineNear?.view && !onlyTiles && shapeWedgeDistance(fineNear.view, [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], true) > 0) { const old = this.sectors.get(key); if (old) { this.terrainGroup.remove(old); old.geometry.dispose(); this.sectors.delete(key); } this.coarse.add(key); continue; }
      this.placeSector(key, this.sectorMesh(sx, sz, [tx0, tz0, tx1, tz1], deferMottle, coarse ? COARSE_STEP : TERRAIN_STEP, !!fineNear));
      if (coarse || fineNear) this.coarse.add(key); else this.coarse.delete(key);
      yield;
    }
    for (const [key, mesh] of this.sectors) if (!wanted.has(key)) { this.terrainGroup.remove(mesh); mesh.geometry.dispose(); this.sectors.delete(key); this.coarse.delete(key); }
    // things settle on the new ground: refresh poses of root entities (no easing)
    // lane PERF2: world builders (roads, areas, scatters that drape on the ground) are rebuilt only when their shape reaches a
    // re-baked tile; a hill raised in one corner no longer rebuilds every forest and road in the world
    if (onlyTiles) for (const e of m.entities.values()) if (e.in.parent === 'world') { const world = !!this.drawn.get(e.id)?.world; this.draw(e, false, world && reachesTiles(e, onlyTiles)); }
  }
  /** A sector inside the ground's extent (t4-phone-new: the fill draws the ones the arrival skipped). */
  private wantedSector(sx: number, sz: number): boolean {
    const [bx0, bz0, bx1, bz1] = this.model!.ground().extent, s = SECTOR_TILES;
    return sx >= Math.floor(Math.floor(bx0 / TILE_M) / s) && sx <= Math.floor((Math.ceil(bx1 / TILE_M) - 1) / s) && sz >= Math.floor(Math.floor(bz0 / TILE_M) / s) && sz <= Math.floor((Math.ceil(bz1 / TILE_M) - 1) / s);
  }
  private placeSector(key: string, mesh: THREE.Mesh) {
    const old = this.sectors.get(key); if (old) { this.terrainGroup.remove(old); old.geometry.dispose(); }
    this.sectors.set(key, mesh); this.terrainGroup.add(mesh);
  }
  /** P7: refine one coarse sector (the nearest to `at` first) at full detail; false when none is left. */
  refineCoarseSector(at: [number, number] | null): boolean {
    const m = this.model; if (!m || !this.coarse.size) return false;
    let best = '', bd = Infinity;
    for (const key of this.coarse) { const [sx, sz] = key.split(',').map(Number), d = at ? rectDistance(at[0], at[1], sx * SECTOR_TILES * TILE_M, sz * SECTOR_TILES * TILE_M, (sx + 1) * SECTOR_TILES * TILE_M, (sz + 1) * SECTOR_TILES * TILE_M) : 0; if (d < bd) { bd = d; best = key; } }
    this.coarse.delete(best);
    const [bx0, bz0, bx1, bz1] = m.ground().extent, [sx, sz] = best.split(',').map(Number);
    const t: [number, number, number, number] = [Math.floor(bx0 / TILE_M), Math.floor(bz0 / TILE_M), Math.ceil(bx1 / TILE_M) - 1, Math.ceil(bz1 / TILE_M) - 1];
    if (this.sectors.has(best) || this.wantedSector(sx, sz)) this.placeSector(best, this.sectorMesh(sx, sz, t, true));   // t4-phone-new: or one not drawn yet
    return true;
  }
  private sectorMesh(sx: number, sz: number, t: [number, number, number, number], deferMottle = false, step = TERRAIN_STEP, direct = false): THREE.Mesh {
    const m = this.model!;
    const tx0 = Math.max(t[0], sx * SECTOR_TILES), tz0 = Math.max(t[1], sz * SECTOR_TILES);
    const tx1 = Math.min(t[2], sx * SECTOR_TILES + SECTOR_TILES - 1), tz1 = Math.min(t[3], sz * SECTOR_TILES + SECTOR_TILES - 1);
    const x0 = tx0 * TILE_M, z0 = tz0 * TILE_M, w = (tx1 - tx0 + 1) * TILE_M, d = (tz1 - tz0 + 1) * TILE_M;
    const nx = w / step, nz = d / step;
    // P7 coarse (phone arrival, far sectors): heights straight from the ground recipe at `step` m, no tile bakes
    const coarse = step !== TERRAIN_STEP || direct ? coarseHeights(m.terrain.ground, x0, z0, nx, nz, step) : null;
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const c = new THREE.Color();
    const palette = (m.state as { ground?: { palette?: string } }).ground?.palette;
    const terrainColor = terrainColorFor(palette), deferred = deferMottle ? terrainColorDeferred(palette) : null;
    const nv = (nx + 1) * (nz + 1), rgb = deferred ? new Float64Array(nv * 3) : null, xz = deferred ? new Float64Array(nv * 2) : null, mottled: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const y = coarse ? coarse.h[j * (nx + 1) + i] : m.terrain.sample(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const slope = coarse ? coarse.slope(i, j) : m.terrain.slope(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      if (deferred) {   // the colour before the mottling now; the mottling (playa-mottle.ts) after, in a worker
        if (deferred(c, y, slope, m.constants.base)) mottled.push(k / 3);
        rgb![k] = c.r; rgb![k + 1] = c.g; rgb![k + 2] = c.b; xz![k / 3 * 2] = x; xz![k / 3 * 2 + 1] = z;
      } else terrainColor(c, y, slope, m.constants.base, x, z);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, dd = cc + 1; idx.push(a, cc, b, b, cc, dd); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); if (!computeVertexNormals(g)) g.computeVertexNormals();   // fast-geometry: same normals
    // Eden's meadow turf also takes the Eden realism ground shader (its own material, so a palette change never leaves it patched)
    const realism = groundRealismFor((m.state as { ground?: { palette?: string } }).ground?.palette);
    const mesh = new THREE.Mesh(g, this.material(realism ? 'terrain-meadow' : 'terrain', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: realism ? 1 : 0.95, metalness: 0 })));
    mesh.name = `entity-terrain ${sx},${sz}`; mesh.receiveShadow = true;
    if (deferred && mottled.length) {
      const key = `${sx},${sz}`, colour = g.attributes.color as THREE.BufferAttribute;
      mottleSector(rgb!, xz!, Uint32Array.from(mottled), col, (out) => {
        if (this.sectors.get(key) !== mesh && this.sectors.has(key)) return;   // replaced meanwhile: the new sector has its own
        if (out !== colour.array) (colour.array as Float32Array).set(out);
        colour.needsUpdate = true;
      });
    }
    if (realism) applyWorldRealism(mesh, { classify: () => 'ground' });
    return mesh;
  }
  private rebuildWater() {
    this.waterGroup.clear();
    const g = this.model!.ground();
    for (const w of g.waters) {
      // path water (rivers) is drawn by the river's own mesh half (per-point levels, flow, trimmed at lakes)
      if (w.path) continue;
      if (!w.area) continue;
      const shape = new THREE.Shape(w.area.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2); // Shape (x, y) → world (x, z); +y up handled by rotation
      // a hair below the level: where the ground around a pond is exactly at its level (a carve's rim) the water plane
      // was coplanar with the terrain and z-fought into a jagged edge near the camera; now the ground wins there
      geo.translate(0, w.level - WATER_SINK_M, 0);
      const mesh = waterMesh(geo, waterMaterial(), 'entity-water');
      this.waterGroup.add(mesh);
    }
    if (g.seaLevel !== undefined) {
      const [bx0, bz0, bx1, bz1] = g.extent, half = Math.max(bx1 - bx0, bz1 - bz0) / 2;
      const seaGeo = new THREE.PlaneGeometry(half * 8, half * 8); seaGeo.rotateX(-Math.PI / 2); seaGeo.translate((bx0 + bx1) / 2, g.seaLevel - WATER_SINK_M, (bz0 + bz1) / 2);
      const sea = waterMesh(seaGeo, waterMaterial(), 'entity-sea');
      this.waterGroup.add(sea);
    }
  }
  /** A ring of low hills beyond the extent so the edge of the world is a horizon, not a cliff. */
  private buildHorizon() {
    if (this.horizon) { this.group.remove(this.horizon); this.horizon.geometry.dispose(); }
    // GOD-ENV: round the world's bounds (a rectangle once extended): each spoke starts at the bounds' edge in its direction
    const m = this.model!; const [bx0, bz0, bx1, bz1] = m.ground().extent, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, hx = (bx1 - bx0) / 2, hz = (bz1 - bz0) / 2, half = Math.max(hx, hz);
    const edge = (a: number) => Math.min(Math.abs(Math.cos(a)) > 1e-6 ? hx / Math.abs(Math.cos(a)) : Infinity, Math.abs(Math.sin(a)) > 1e-6 ? hz / Math.abs(Math.sin(a)) : Infinity);
    const segs = 96, rings = 6;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const seed = hashSeed(m.seed);
    // t4-phone: the inner ring's heights from the ground recipe at each point (no bake of every tile along the world's edge:
    // ~0.1 s of 4x CPU before a phone's poster); the same heights as the tiles' within their 1 m interpolation
    const edgeHeight = (x: number, z: number) => heightAt(groundForTile(m.terrain.ground, Math.floor(x / TILE_M), Math.floor(z / TILE_M)), x, z);
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, d = edge(a), inner = d + half * 0.02, outer = d + half * 2.2, radius = inner + (outer - inner) * (r / rings);
      const f = r / rings, bump = Math.sin(a * 7 + seed) * 0.5 + Math.sin(a * 13 + seed * 1.7) * 0.3 + Math.sin(a * 29 + seed * 0.3) * 0.2;
      const h = r === 0 ? edgeHeight(cx + Math.cos(a) * (d - 1), cz + Math.sin(a) * (d - 1)) : m.constants.base + Math.max(0, bump) * half * 0.25 * Math.sin(Math.PI * f) + f * 8;
      pos.push(cx + Math.cos(a) * radius, h, cz + Math.sin(a) * radius);
      c.set(0x6f8f6a).lerp(new THREE.Color(0x9fb3c8), f * 0.9); col.push(c.r, c.g, c.b);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * (segs + 1) + s, b = a + 1, cc = a + segs + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.horizon = new THREE.Mesh(g, this.material('horizon', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: true })));
    this.horizon.name = 'entity-horizon'; this.horizon.userData.cameraTransparent = true;
    this.group.add(this.horizon);
  }

  // ---------- things ----------

  private draw(e: Entity, ease: boolean, force = false) {
    const m = this.model!; const def = m.resolvedDef(e.def);
    if (!def) return;
    if(def.components.carryable&&(def.components.light||def.components.lights))this.lightMoves.add(e.id);
    if (def.tags.includes('horizon')) this.horizonBy.add(e.id); else this.horizonBy.delete(e.id);
    const parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
    if (parent && m.resolvedDef(parent.def)?.components.body) this.held.set(e.id, parent.id); else this.held.delete(e.id);
    if (parent && containerInside(m.resolvedDef(parent.def))?.slots.some((s) => s.id === e.in.slot)) this.keptIn.set(e.id, parent.id); else this.keptIn.delete(e.id);
    const existing = this.drawn.get(e.id);
    const defHash = def.hash + ':' + JSON.stringify(e.params ?? {}) + ':' + JSON.stringify(e.state ?? {}) + ':' + JSON.stringify(e.shape ?? null) + ':' + JSON.stringify(e.r ?? 0);
    const builder = meshFor(def);
    const isWorld = !!builder?.world;
    const wp = m.worldPose(e);
    const target = isWorld ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(wp.x, wp.y, wp.z);
    // Soul Actions entry 33: a fire or neon sign lit by hand in place is redrawn at once (no 2.5 s edit ease, during which
    // nothing animates), so its catch or strike plays from the contact
    const inPlace = !!existing && !existing.removing && existing.to.p.distanceTo(target) < 1e-6 && existing.to.s === wp.s && def.tags.includes('hand-operated') && (def.tags.includes('neon') || hasFlames(def));
    if (inPlace) ease = false;
    const refinement = ease && !isWorld ? this.sites.refinement(e, m) : null;
    if (existing && existing.defHash === defHash && !existing.removing && !force) {
      if (isWorld) return;
      // The parent or slot can change without changing the world pose. Resolve its host again even when no easing is needed.
      if (existing.interior) existing.interior.stale = true;
      this.live.add(e.id); this.touchDependents(e.id);
      // lane PERF-SNAPSHOT: a settled thing asked to stay where it is (a resync, a parent's children re-posed) is left
      // alone: its pose is not re-eased, so it stays settled (frozen on the phone tier) and nothing flashes
      if (!ease && existing.settled && existing.to.p.equals(target) && existing.to.s === wp.s && existing.obj.rotation.y === wp.yaw && (!Array.isArray(e.r) || (existing.obj.rotation.x === e.r[1] && existing.obj.rotation.z === e.r[2]))) return;
      existing.obj.rotation.set(0, wp.yaw, 0); applyTilt(existing.obj, e);
      existing.from = refinement ? { p: target.clone(), s: wp.s * refinement.scale } : { p: ease ? existing.obj.position.clone() : target.clone(), s: ease ? existing.obj.scale.x : wp.s };
      existing.to = { p: target, s: wp.s }; existing.t0 = this.now; existing.dur = ease ? refinement?.seconds ?? EASE_IN_S : 0.001; existing.settled = false;
      return;
    }
    let built = this.build(e, def);
    if (!built) { if (existing) this.undraw(e.id); return; }
    // Soul Actions: moving water (sprinkler fan, tap stream, shower) while the thing is on; GPU points, never instanced
    { const jets = waterJets(def as never, e.state, e.params ?? {}); if (jets) { built.add(jets); delete built.userData.instanceKey; }
      if (jets?.userData.waterJet === 'stream') this.tapJets.set(e.id, jets as THREE.Points); else this.tapJets.delete(e.id); }
    // Entry 34: a growing planter's plants, eased from how they were last drawn to what the state now asks for; a can
    // carried by its handle (a `carry` slot) is posed from the hand every frame, so never instanced
    if (isGrowingDef(def as never)) {
      const look = plantLookOf(e.state, def as never), shown = this.plantShown.get(e.id) ?? look;
      built.add(plantGroup(seedOf(e.id), shown)); delete built.userData.instanceKey; setPatch(built, shown.m); this.growing.add(e.id);
      if (!sameLook(shown, look)) this.plantTweens.set(e.id, { from: shown, to: look, t0: this.now, dur: lookSeconds(shown, look) * 1000 }); else this.plantTweens.delete(e.id);
      this.plantShown.set(e.id, shown);
    }
    { const grip = (def as unknown as { slots?: { kind: string; p: number[] }[] }).slots?.find((x) => x.kind === 'carry'); if (grip) { built.userData.handleGrip = [...grip.p]; delete built.userData.instanceKey; } }
    // Entry 43: a kettle is filled through its lid and pours from its spout (a can: its filler and its rose); kettles and
    // cups of tea steam (a plume placed each frame from their state and the depicted tick)
    if (isKettleDef(def as never)) built.userData.vessel = { opening: KETTLE_OPENING, outlet: KETTLE_SPOUT, angle: KETTLE_SPOUT_ANGLE, pour: 'spout' };
    if (isKettleDef(def as never) || isTeaCupDef(def as never)) {
      delete built.userData.instanceKey;
      if (!this.steamers.has(e.id)) { const kind = isKettleDef(def as never) ? 'kettle' : 'cup', pts = steam(kind); this.thingsGroup.add(pts);
        let lamp: THREE.Mesh | undefined; if (kind === 'kettle') { lamp = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); lamp.name = 'kettle switch lamp'; lamp.visible = false; this.thingsGroup.add(lamp); }
        this.steamers.set(e.id, { pts, kind, lamp }); }
    }
    // State is visible on this frame, including during the generic edit easing.
    // Waiting for animate()'s settled transform left an OFF bulb glowing for 2.5 s.
    if (def.components.light || def.components.lights) syncLightGlow(built,e,def,m,this.now/1000);
    const opening=existing&&def.tags.includes('hand-operated')?beginOpeningMotion(built,existing.obj,this.now):undefined;
    if (existing) { if (existing.inst) this.instancer.remove(existing.inst, e.id); else { if (existing.frozen) this.thaw(existing); this.thingsGroup.remove(existing.obj); disposeObject(existing.obj); } this.drawn.delete(e.id); }
    // a rainbow thing is weather: hidden until the atmosphere shows it after rain (its own meshes, never instanced)
    const rainbow = isRainbowDef(def); if (rainbow) holdRainbow(built);
    // static things with an instance key share one InstancedMesh per part (a few draws for hundreds of props)
    const instKey = !this.immutable && !isWorld && !rainbow && !hasMotion(def) && typeof built.userData.instanceKey === 'string' && instanceable(built) ? built.userData.instanceKey as string : undefined;
    if (instKey) { this.instancer.ensure(instKey, built); built = new THREE.Object3D(); }
    if (!isWorld) { built.rotation.set(0, wp.yaw, 0); applyTilt(built, e); }
    const fresh = !existing;
    const from = refinement ? { p: target.clone(), s: wp.s * refinement.scale } : fresh && ease ? { p: target.clone().add(new THREE.Vector3(0, DROP_M, 0)), s: wp.s * 0.2 } : { p: target.clone(), s: wp.s };
    built.position.copy(from.p); built.scale.setScalar(from.s);
    if (!instKey) this.thingsGroup.add(built);
    const to = { p: target, s: isWorld ? 1 : wp.s };
    if (isWorld) { from.s = fresh && ease ? 1 : 1; }
    const mdef = rideMotionDef(def);  // BALLOON-BODY: a ride balloon does not hover; Core's vehicle owns its motion
    this.drawn.set(e.id, { ...(opening ? {opening} : {}), ...(instKey ? { inst: instKey, settled: false } : {}), obj: built, from, to, t0: this.now, dur: ease ? refinement?.seconds ?? EASE_IN_S : 0.001, defHash, world: isWorld, ...(hasMotion(mdef) ? { motion: { entity: e, def: mdef, yaw: wp.yaw, glowOnly: glowOnly(mdef) } } : {}) });
    if (this.motionInstancing && !instKey && hasMotion(mdef) && !glowOnly(mdef) && !hasFlames(mdef) && !rainbow) this.motionInstancer.track(built);   // PERF-BATCH round 2
    // entry 42: a thing kept in a shut container is hidden from its first frame (a resync can draw before the next update)
    if (this.keptIn.has(e.id)) { const k = this.drawn.get(e.id)!, v = this.interiorVisible(e.id, k); if (k.inst) k.shown = v; else k.obj.visible = v; }
  }
  private undraw(id: string, delaySeconds = 0) {
    this.held.delete(id); this.horizonBy.delete(id);
    this.tapJets.delete(id); this.growing.delete(id); this.plantShown.delete(id); this.plantTweens.delete(id);
    { const pour = this.pours.get(id); if (pour) { pour.removeFromParent(); (pour.material as THREE.Material).dispose(); this.pours.delete(id); } }
    { const st = this.steamers.get(id); if (st) { st.pts.removeFromParent(); (st.pts.material as THREE.Material).dispose(); st.lamp?.removeFromParent(); this.steamers.delete(id); } } this.keptIn.delete(id);
    const d = this.drawn.get(id); if (!d || d.removing) return;
    d.removing = true; d.settled = false; d.from = { p: d.obj.position.clone(), s: d.obj.scale.x }; d.to = { p: d.obj.position.clone().add(new THREE.Vector3(0, 2, 0)), s: 0.01 }; d.t0 = this.now + delaySeconds * 1000; d.dur = EASE_OUT_S;
  }
  /** One Object3D for an entity, from its def's mesh half (gen-mesh registry). Null when it has no picture (landforms, prefab roots, bodies). */
  private build(e: Entity, def: StoredDef): THREE.Object3D | null {
    const m = this.model!;
    if (def.make.kind === 'none' || def.make.kind === 'parts') return null;
    if (!godFeature('flags') && isFlagDef((def as { ref?: string }).ref ?? e.def)) return null;   // G5: flags are switched off; their poles are not drawn
    const builder = meshFor(def);
    if (!builder) return null;
    const params = paramsOf(e, def);
    const ctx: MeshCtx = {
      canonicalContext: this.immutable, def, entity: e, params, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {},
      baked: m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: m, materials: this.lib,
      tint: (key, fallback) => { if (!key) return fallback; const v = params[key]; return typeof v === 'string' && /^#/.test(v) ? v : def.palette?.[key] ?? fallback; },
    };
    try { const obj = builder.build(ctx); if (obj) { obj.name ||= `entity ${e.name ?? e.id}`; const k = builder.instanceKey?.(ctx); if (k) obj.userData.instanceKey = `${def.make.kind === 'gen' ? def.make.gen : def.make.kind}|${k}`; } return obj; } catch (err) { this.stats.lastError = `${def.ref}: ${String(err)}`; return null; }
  }

  private material(key: string, make: () => THREE.Material) { let m = this.materials.get(key); if (!m) { m = make(); this.materials.set(key, m); } return m; }
}

const BUILD_SLICE_MS = 50;
/** A resync's draws run during play: short slices, the main thread free between them (applyDelta). */
const RESYNC_SLICE_MS = 6;
/** P7: a phone's arrival bakes the terrain sectors within this distance of its eye or target; the rest start coarse. */
const COARSE_BEYOND_M = 96;
const COARSE_STEP = 4;
/** Distance from (x, z) to the rectangle [x0, x1] x [z0, z1] (0 inside). */
function rectDistance(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}
/** P7: a coarse grid of heights from the ground recipe itself (each tile's own landforms), with its slope by differences. */
function coarseHeights(g: Ground, x0: number, z0: number, nx: number, nz: number, step: number): { h: Float32Array; slope: (i: number, j: number) => number } {
  const h = new Float32Array((nx + 1) * (nz + 1)); const locals = new Map<string, Ground>();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, tx = Math.floor(Math.min(x, x0 + nx * step - 1e-3) / TILE_M), tz = Math.floor(Math.min(z, z0 + nz * step - 1e-3) / TILE_M), k = tx + ',' + tz;
    let local = locals.get(k); if (!local) { local = groundForTile(g, tx, tz); locals.set(k, local); }
    h[j * (nx + 1) + i] = heightAt(local, x, z);
  }
  const at = (i: number, j: number) => h[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
  return { h, slope: (i, j) => Math.hypot((at(i + 1, j) - at(i - 1, j)) / (2 * step), (at(i, j + 1) - at(i, j - 1)) / (2 * step)) };
}
/** P1 phones: the fill's slices run between frames, so they are short. */
const FILL_SLICE_MS = 25;
/** Entities sorted by distance (xz) from the nearer of two points; things without a pose (world-wide: terrain kits, ...) first.
 *  `at` gives a point, or (P7) a shape's points: a path (polyline) or an area (polygon, distance 0 inside), measured to its
 *  nearest point, so a long footpath or a woodland that crosses the arrival is near even when its pose is far away.
 *  The result carries the sorted distances in `dist`. */
export type NearKey = [number, number] | { path: readonly (readonly number[])[] } | { area: readonly (readonly number[])[] } | null;
export function byDistance<T>(list: readonly T[], at: (e: T) => NearKey, a: readonly [number, number], b: readonly [number, number]): T[] & { dist?: number[] } {
  const d = list.map((e, k) => { const p = at(e); return [p === null ? 0 : Array.isArray(p) ? Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1])) : Math.min(shapeDistance(p, a), shapeDistance(p, b)), k] as [number, number]; });
  d.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = d.map(([, k]) => list[k]) as T[] & { dist?: number[] }; out.dist = d.map(([x]) => x); return out;
}
function shapeDistance(s: { path: readonly (readonly number[])[] } | { area: readonly (readonly number[])[] }, q: readonly [number, number]): number {
  const pts = 'path' in s ? s.path : s.area, closed = !('path' in s);
  if (!pts.length) return Infinity;
  let best = Infinity, inside = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = pts[i + 1] ?? (closed ? pts[0] : null);
    if (!n) { best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1])); continue; }
    const dx = n[0] - p[0], dz = n[1] - p[1], L = dx * dx + dz * dz, t = L > 0 ? Math.max(0, Math.min(1, ((q[0] - p[0]) * dx + (q[1] - p[1]) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(q[0] - p[0] - t * dx, q[1] - p[1] - t * dz));
    if (closed && (p[1] > q[1]) !== (n[1] > q[1]) && q[0] < p[0] + ((q[1] - p[1]) / (n[1] - p[1])) * dx) inside = !inside;
  }
  return inside ? 0 : best;
}
/** P7: the near-first sort key of a snapshot's things: a shaped thing's own shape, else its root ancestor's stored pose
 *  (no slot bakes: a building's furniture sorts with its building); things with neither come first. */
const rootOf = (byId: ReadonlyMap<string, Entity>, e: Entity): Entity => { let r = e; for (let depth = 0; r.in.parent !== 'world' && depth < 8; depth++) { const up = byId.get(r.in.parent); if (!up) break; r = up; } return r; };
export function nearKeyOf(byId: ReadonlyMap<string, Entity>): (e: Entity) => NearKey {
  return (e) => {
    const r = rootOf(byId, e), shape = (r as { shape?: { path?: unknown; area?: unknown } }).shape;
    if (shape && Array.isArray(shape.path) && shape.path.length) return { path: shape.path as number[][] };
    if (shape && Array.isArray(shape.area) && shape.area.length) return { area: shape.area as number[][] };
    const p = (r as { p?: unknown }).p;
    return Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[2]) ? [p[0] as number, p[2] as number] : null;
  };
}
/** t4-phone-new: the arrival camera's ground wedge (arrival-view.ts), when the poster frames this pose: a world with Souls
 *  opens on its tour's first view instead (arrival-shot.ts worldArrivalPose), so there every near thing still counts. */
function arrivalViewWedge(pose: { target: readonly number[]; eye: readonly number[] }): ViewWedge | null {
  const souls = (window as unknown as { __simWorldSouls?: unknown }).__simWorldSouls;
  if (typeof souls === 'number' && souls > 0) return null;
  return viewWedge(pose.eye, pose.target, 45, innerWidth / Math.max(1, innerHeight));
}
/** t4-phone-new: does the arrival camera see a thing (by its root: a building's furniture goes with it)? Its body: its
 *  footprint rectangle, turned with it (its declared size, a building's plan), and up to 4 m of a building's porch, steps
 *  and awnings; a shaped thing (a road, a wood) is its shape plus 4 m. With `shadow`, also the shadow it may cast into
 *  view: ARRIVAL_SHADOW_PER_M of its height every way (the sun's direction is not known before the poster's lights are
 *  set; the sun code stays out of a phone's first scripts). Unknown sizes: 40 m around it, a 20 m high shadow. */
function arrivalSeen(m: WorldModel, view: ViewWedge, keyOf: (e: Entity) => NearKey, byId: ReadonlyMap<string, Entity>, shadow: boolean): (e: Entity) => boolean {
  const memo = new Map<string, boolean>();
  return (e) => {
    const r = rootOf(byId, e); let v = memo.get(r.id);
    if (v === undefined) {
      const { reach, height, half } = viewSize(m, r);
      let key = keyOf(r);
      if (half && Array.isArray(key)) { let yaw = 0; try { yaw = m.worldPose(r).yaw; } catch { /* unturned */ } const [x, z] = key, c = Math.cos(yaw), sn = Math.sin(yaw), [a, b] = half;
        key = { area: [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, w]) => [x + u * c + w * sn, z - u * sn + w * c]) }; }
      v = keySeen(view, key, reach + (shadow ? Math.min(ARRIVAL_SHADOW_MAX_M, ARRIVAL_SHADOW_PER_M * height) : 0)); memo.set(r.id, v);
    }
    return v;
  };
}
/** The shadow reach per metre of height: a sun at 27 degrees or higher (mid-morning to mid-afternoon; a lower sun's long
 *  shadow is faint at its tip), at most 40 m. */
const ARRIVAL_SHADOW_PER_M = 2, ARRIVAL_SHADOW_MAX_M = 40;
/** How many things past the near ones the fill orders view-first too (the poster may come while the fill runs). */
const FILL_AHEAD = 400;
function viewSize(m: WorldModel, r: Entity): { reach: number; height: number; half: [number, number] | null } {
  const d = m.resolvedDef(r.def), box = (d as { size?: { box?: unknown } } | undefined)?.size?.box, shaped = !!(r as { shape?: unknown }).shape;
  if (!Array.isArray(box) || box.length !== 3 || !box.every((v) => typeof v === 'number' && Number.isFinite(v))) return { reach: shaped ? 4 : 40, height: 20, half: null };
  const pr = (r.params ?? {}) as Record<string, unknown>, n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0);
  const s = Math.max(1, n((r as { s?: unknown }).s));
  let w = box[0] as number, dd = box[2] as number, h = box[1] as number;
  if (shaped) return { reach: 4 * s, height: h * s, half: null };
  const building = !!d && d.make.kind === 'gen' && d.make.gen === 'building/1';
  if (building) {
    w = Math.max(w, n(pr.w)); dd = Math.max(dd, n(pr.d)); h = Math.max(h, n(pr.h));
    const plan = pr.plan as { floors?: { rooms?: { rect?: unknown }[] }[] } | undefined;
    if (plan?.floors?.length) h = Math.max(h, 3.5 * plan.floors.length + 4);
    for (const f of plan?.floors ?? []) for (const room of f?.rooms ?? []) { const rc = room?.rect; if (Array.isArray(rc) && rc.length === 4) { w = Math.max(w, 2 * n(rc[0]), 2 * n(rc[2])); dd = Math.max(dd, 2 * n(rc[1]), 2 * n(rc[3])); } }
  }
  // the rectangle of its declared size; a building's porch, steps and awnings, and a generated thing's parts, up to 4 m
  // beyond it (a model is drawn inside its box: 1 m)
  return { reach: d && d.make.kind === 'mesh' ? 1 : 4 * s, height: h * s * Math.max(1, n(pr.sy)), half: [0.5 * w * s * Math.max(1, n(pr.sx)), 0.5 * dd * s * Math.max(1, n(pr.sz))] as [number, number] };
}
/** An entity's mesh params: its generator's and def's defaults under its own params. */
function paramsOf(e: Entity, def: StoredDef): MeshCtx['params'] {
  const gen = def.make.kind === 'gen' ? GENERATORS[def.make.gen] : undefined;
  const defaults: Record<string, unknown> = {};
  for (const [k, f] of Object.entries({ ...(gen?.params ?? {}), ...def.params })) if ((f as { default?: unknown }).default !== undefined) defaults[k] = (f as { default?: unknown }).default;
  return { ...defaults, ...(e.params ?? {}) } as MeshCtx['params'];
}
/** Continue after every other queued task: at background priority where the browser has a task scheduler (Chrome: the
 *  socket's large join messages are read in many small tasks, each needing a turn), else after one message task. */
function nextTask(priority: 'background' | 'user-visible' = 'background'): Promise<void> {
  const sched = (globalThis as { scheduler?: { postTask?: (f: () => void, o: { priority: string }) => Promise<void> } }).scheduler;
  if (sched?.postTask) return sched.postTask(() => {}, { priority });
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
}
/** A cached snapshot (the server's snapshot cache or an edge copy, lanes W1/O2) says how old it is: its `now` is moved on by that. */
function ageNow(snap: { now?: number }, r: Response) { const age = Number(r.headers.get('age')) || 0; if (age > 0 && typeof snap.now === 'number') snap.now += age * 1000; }
const _pl = new THREE.Vector3(), _pr = new THREE.Vector3(), _v3 = new THREE.Vector3();
// Entry 34 scratch: held-by-handle pose, tap catch, rose shower
const _qh = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1), _yAxis = new THREE.Vector3(0, 1, 0), _vs = new THREE.Vector3(), _vo = new THREE.Vector3(), _vn = new THREE.Vector3(), _vr = new THREE.Vector3(), _eu = new THREE.Euler();
const easeInOut = (k: number) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
/** A planter's seed for its plants' layout (stable per entity). */
const seedOf = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h; };
const sameLook = (a: PlantLook, b: PlantLook) => Math.abs(a.g - b.g) < 1e-3 && Math.abs(a.w - b.w) < 1e-3 && Math.abs(a.m - b.m) < 1e-3;
/** A stage or a wilt change eases over 2.4 s; the soil darkening while water is poured over 0.9 s. */
const lookSeconds = (a: PlantLook, b: PlantLook) => (Math.abs(a.g - b.g) > 1e-3 || Math.abs(a.w - b.w) > 1e-3 ? 2.4 : 0.9);
/** The damp patch (role fill) of a planter spread for moisture `m`. */
function setPatch(root: THREE.Object3D, m: number) {
  root.traverse((o) => { if (o.userData.role === 'fill') { const k = Math.max(0.001, Math.min(1, m)); o.scale.set(k, 1, k); o.visible = m > 0.02; } });
}
/** Still in a scene graph (a re-created figure leaves its old holder detached). */
function attached(o: THREE.Object3D): boolean { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if (p.type === 'Scene') return true; p = p.parent; } return false; }
/** Lane PERF2: two grounds differ only in landforms, waters or extent (what a world diff's tile list covers), so baked
 *  tiles outside that list stay valid. A change to anything else (base, noise) re-bakes everything. */
function reachesTiles(e: Entity, tiles: Set<string>): boolean {
  const sh = e.shape as { path?: [number, number][]; area?: [number, number][] } | undefined;
  const pts = sh?.area ?? sh?.path; if (!pts?.length) return true;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; }
  const pad = 16;   // road and river widths, verges and scatter jitter reach past the centre line
  for (const k of tiles) { const [tx, tz] = k.split(',').map(Number); if (tx * TILE_M <= x1 + pad && (tx + 1) * TILE_M >= x0 - pad && tz * TILE_M <= z1 + pad && (tz + 1) * TILE_M >= z0 - pad) return true; }
  return false;
}
function sameBase(a: Ground, b: Ground): boolean {
  const rest = (g: Ground) => JSON.stringify({ ...g, landforms: undefined, waters: undefined, extent: undefined, _ordered: undefined });
  return rest(a) === rest(b);
}
function applyTilt(obj: THREE.Object3D, e: Entity) { if (Array.isArray(e.r)) { obj.rotation.x = e.r[1]; obj.rotation.z = e.r[2]; } }
function disposeObject(o: THREE.Object3D) { o.traverse((c) => { const m = c as THREE.Mesh; if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose(); }); }
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const frac = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
function waterLevel(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) if (w.area && pointInPoly(x, z, w.area)) level = w.level; else if (w.path && w.w) { const lv = waterLevelAt(g, x, z); if (lv !== null) level = lv; }
  return level ?? g.seaLevel ?? null;
}
// indexed reads, not array destructuring: the same arithmetic as @sim/ground's pointInPoly (L3e)
function pointInPoly(px: number, pz: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j], zi = a[1], zj = b[1];
    if ((zi > pz) !== (zj > pz)) { const xi = a[0]; if (px < ((b[0] - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; }
  }
  return inside;
}
/** PERF-EVENTLOOP: the drawn records, adopted on set and released on replace, delete or clear (WorldEntityLayer.adopt/release). */
class DrawnMap extends Map<string, Drawn> {
  private readonly layer: { adopt(id: string, d: Drawn): void; release(id: string, d: Drawn): void };
  constructor(layer: { adopt(id: string, d: Drawn): void; release(id: string, d: Drawn): void }) { super(); this.layer = layer; }
  override set(id: string, d: Drawn): this { const prev = super.get(id); if (prev === d) return this; if (prev) this.layer.release(id, prev); super.set(id, d); this.layer.adopt(id, d); return this; }
  override delete(id: string): boolean { const prev = super.get(id); if (prev) this.layer.release(id, prev); return super.delete(id); }
  override clear(): void { for (const [id, d] of this) this.layer.release(id, d); super.clear(); }
}
export type { Def };
export { TILE_N };
