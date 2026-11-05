// Floater heads for the engine view (eden4 Little Martians): static scanned GLBs (no rig, no skins, no
// morph targets) posed from sampled take frames. Bob, tilt and yaw come from engine/bodies/pose.ts as
// pure functions of the entity id and the *sampled tick*, never wall time, so replaying a take — or
// scrubbing it — draws the same head at the same tick.
//
//   const floaters = new FloaterView(scene, { baseUrl: '/worlds/littlemartians/characters/', dracoDecoderPath: '/draco/' });
//   for (const [id, body] of floaterBodiesOfTake(take)) floaters.add(id, body);
//   // each redraw, with the frame TakePeople/sampleTake produced:
//   floaters.update(frame.entities, take.startTick + frame.tick, take.dt);
//
// Hierarchy per floater: holder (hover position, travel yaw) → tilt (nose dip, sideways lean) →
// turn (+π/2: the archive's face-forward +Z onto the engine's yaw-0 direction +X) → orient (the
// model's ORIENT facing offset) → the glTF scene, centred and scaled so its largest extent = 2 × radius.
// Until a model has loaded (or when a body names no known model) a glazed sphere of the same radius
// stands in, so placement and selection work from the first frame.
import * as THREE from 'three';
import {admittedBodyUrl} from './recorded-body.ts';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
// direct modules, not the bodies index (its float.ts movement brings the spatial service onto a page's first frame)
import { creatureOf } from '../../engine/bodies/creatures.ts';
import { floaterBody, type FloaterBody } from '../../engine/bodies/body.ts';
import { floaterModel } from '../../engine/bodies/models.ts';
import { floaterPose, idPhase } from '../../engine/bodies/pose.ts';
import { buildCreature, creatureMode, type CreatureRig } from './creatures.ts';
import type { SampledEntity } from '../../engine/take/replay.ts';
import type { Body } from '../../engine/world/types.ts';

export type FloaterViewOpts = {
  /** URL of worlds/littlemartians/characters/ as served (trailing slash optional). */
  baseUrl: string;
  /** A configured loader (it must decode KHR_draco_mesh_compression and EXT_texture_webp). */
  loader?: GLTFLoader;
  /** Prepare each cached model once, before clones become ready (e.g. fit textures to the client budget). */
  prepareModel?: (g: GLTF) => Promise<void>;
  /** Where three's draco decoder files (three/examples/jsm/libs/draco/gltf/) are served; used when no loader is given. */
  dracoDecoderPath?: string;
  /** Tick length (s) when update() is not given one. Mars engine DT is 0.05. */
  dt?: number;
};

type Floater = { id: string; body: FloaterBody; holder: THREE.Group; tilt: THREE.Group; orient: THREE.Group; stand: THREE.Mesh | null; model: THREE.Object3D | null;
  /** A creature body (duck, snail, dog): built and animated procedurally (creatures.ts) instead of a loaded head. */
  creature?: { rig: CreatureRig; tick: number | null } };

const TURN = Math.PI / 2;

/** Centre a loaded scene on the origin and scale its largest extent to `size`. Returns a wrapper. */
function normalized(scene: THREE.Object3D, size: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const dim = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = size / (Math.max(dim.x, dim.y, dim.z) || 1);
  const wrap = new THREE.Group();
  scene.position.sub(centre);
  wrap.add(scene);
  wrap.scale.setScalar(s);
  return wrap;
}

export class FloaterView {
  readonly root = new THREE.Group();
  private readonly loader: GLTFLoader;
  private readonly base: string;
  private readonly dt: number;
  private readonly prepareModel: FloaterViewOpts['prepareModel'];
  private readonly templates = new Map<string, Promise<THREE.Object3D>>();
  private readonly floaters = new Map<string, Floater>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly byId = new Map<string,Promise<unknown>>();
  private readonly standIn = new THREE.MeshStandardMaterial({ color: 0x6fae9a, roughness: 0.35, metalness: 0.1 });
  private draco: DRACOLoader | null = null;
  private disposed = false;

  constructor(parent: THREE.Object3D, opts: FloaterViewOpts) {
    this.root.name = 'floaters';
    parent.add(this.root);
    this.base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
    this.dt = opts.dt ?? 0.05;
    this.prepareModel = opts.prepareModel;
    if (opts.loader) this.loader = opts.loader;
    else {
      this.draco = new DRACOLoader().setDecoderPath(opts.dracoDecoderPath ?? '/draco/');
      this.loader = new GLTFLoader().setDRACOLoader(this.draco);
    }
  }

  has(id: string) {
    return this.floaters.has(id);
  }

  ids() {
    return [...this.floaters.keys()];
  }

  /** The holder group of a floater (for selection rays and follow cameras). */
  object(id: string): THREE.Object3D | undefined {
    return this.floaters.get(id)?.holder;
  }

  /** Start drawing entity `id` as a floater. Re-adding with a different body rebuilds it. */
  add(id: string, body: Body): void {
    const modelUrl=admittedBodyUrl((body as {modelUrl?:string}).modelUrl);
    const fb = {...floaterBody(body),...(modelUrl?{modelUrl}: {})};
    const prev = this.floaters.get(id);
    if (prev && JSON.stringify(prev.body) === JSON.stringify(fb)) return;
    if (prev) this.remove(id);
    const holder = new THREE.Group();
    holder.name = `floater:${id}`;
    holder.userData.entity = id;
    holder.userData.bodyModel='stand-in';
    holder.visible = false; // until its first update
    const tilt = new THREE.Group();
    const turn = new THREE.Group();
    turn.rotation.y = TURN;
    const orient = new THREE.Group();
    orient.rotation.y = floaterModel(fb.model)?.facingYaw ?? 0;
    holder.add(tilt);
    tilt.add(turn);
    turn.add(orient);
    const species = creatureOf(fb);
    if (species) {
      // creatures stand on the ground with +X forward: no hover, no archive turn, nothing to load
      const rig = buildCreature(species.id);
      rig.root.traverse((o) => (o.userData.entity = id));
      tilt.add(rig.root);
      holder.userData.bodyModel = `creature:${species.id}`;
      const f: Floater = { id, body: fb, holder, tilt, orient, stand: null, model: rig.root, creature: { rig, tick: null } };
      this.floaters.set(id, f);
      this.root.add(holder);
      return;
    }
    const stand = new THREE.Mesh(new THREE.SphereGeometry(fb.radius, 24, 16), this.standIn);
    tilt.add(stand);
    const f: Floater = { id, body: fb, holder, tilt, orient, stand, model: null };
    this.floaters.set(id, f);
    this.root.add(holder);
    const m = floaterModel(fb.model);
    if (!m&&!modelUrl) return; // unknown or absent model: the stand-in stays
    const p = this.template(modelUrl??m!.file).then(
      (tpl) => {
        if (this.disposed || this.floaters.get(id) !== f) return;
        const model = normalized(tpl.clone(true), 2 * fb.radius);
        model.traverse((o) => (o.userData.entity = id));
        orient.add(model);
        f.model = model;
        holder.userData.bodyModel=fb.model??'uploaded';
        if (f.stand) {
          tilt.remove(f.stand);
          f.stand.geometry.dispose();
          f.stand = null;
        }
      },
      (err) => console.warn(`floater ${id}: model ${modelUrl??m?.file} failed to load; keeping the stand-in`, err),
    );
    this.pending.add(p);this.byId.set(id,p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Stop drawing `id`. Shared templates stay cached. */
  remove(id: string): void {
    const f = this.floaters.get(id);
    if (!f) return;
    this.root.remove(f.holder);
    f.stand?.geometry.dispose();
    f.creature?.rig.dispose();
    this.floaters.delete(id);this.byId.delete(id);
  }

  /** Make the drawn set equal `bodies` (e.g. floaterBodiesOfTake(take)). */
  sync(bodies: ReadonlyMap<string, Body>): void {
    for (const id of this.ids()) if (!bodies.has(id)) this.remove(id);
    for (const [id, b] of bodies) if (b.family === 'floater') this.add(id, b);
  }

  /**
   * Pose every added floater from a sampled frame at absolute tick `tick` (fractional allowed:
   * take.startTick + frame.tick). Floaters absent from the frame are hidden; extra entities ignored.
   */
  update(entities: Readonly<Record<string, SampledEntity>>, tick: number, dt = this.dt): void {
    for (const f of this.floaters.values()) {
      const e = entities[f.id];
      if (!e) {
        f.holder.visible = false;
        continue;
      }
      this.pose(f, e, tick, dt);
    }
  }

  /** Pose one floater (same rules as update()). */
  setPose(id: string, e: Pick<SampledEntity, 'p' | 'yaw' | 'pitch' | 'roll' | 'speed' | 'activity' | 'state'>, tick: number, dt = this.dt): void {
    const f = this.floaters.get(id);
    if (f) this.pose(f, e, tick, dt);
  }

  private pose(f: Floater, e: Pick<SampledEntity, 'p' | 'yaw' | 'pitch' | 'roll' | 'speed' | 'activity' | 'state'>, tick: number, dt: number) {
    if (f.creature) {
      // a creature: drawn on its ground pose (at the waterline while swimming), its gait from the sampled speed
      const c = f.creature, mode = creatureMode(e.activity, e.speed), step = c.tick === null || tick < c.tick ? 0 : (tick - c.tick) * dt;
      c.tick = tick;
      f.holder.visible = true;
      f.holder.position.set(e.p[0], e.p[1] + c.rig.lift(mode), e.p[2]);
      f.holder.rotation.set(0, -e.yaw, 0);
      c.rig.animate({ mode, speed: e.speed ?? 0, t: tick * dt, dt: step });
      return;
    }
    const body = settled(f.body, e);
    const q = floaterPose(f.id, e, body, tick, dt, e.speed ?? 0);
    f.holder.visible = true;
    f.holder.position.set(q.p[0], q.p[1], q.p[2]);
    f.holder.rotation.set(0, -q.yaw, 0); // engine yaw 0 faces +x; rotation.y = -yaw (as humans.ts)
    // nose dips toward +X (forward) for +pitch: rotate about local Z by −pitch; lean = roll about X
    f.tilt.rotation.set(q.roll, 0, -q.pitch);
  }

  /** Resolves when every model requested so far has loaded (or failed to). */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.allSettled(this.pending);
  }

  /** Frozen initial IDs only; later bodies never extend this barrier. */
  async readyInitial(ids:readonly string[]):Promise<void>{
    const tasks=ids.map(id=>this.byId.get(id));await Promise.all(tasks);
    for(const id of ids)if(!this.floaters.get(id)?.model)throw Error('Required body '+id+' could not be prepared.');
  }
  retryInitial(ids:readonly string[]){for(const id of ids){const f=this.floaters.get(id);if(!f||f.model||this.pending.has(this.byId.get(id)!))continue;const body=f.body,file=admittedBodyUrl((body as {modelUrl?:string}).modelUrl)??floaterModel(body.model)?.file;if(file)this.templates.delete(file);this.remove(id);this.add(id,body);}}

  dispose(): void {
    this.disposed = true;
    for (const id of this.ids()) this.remove(id);
    this.root.removeFromParent();
    this.standIn.dispose();
    for (const t of this.templates.values())
      void t.then(disposeModel, () => {});
    this.templates.clear();
    this.draco?.dispose();
  }

  private template(file: string): Promise<THREE.Object3D> {
    let t = this.templates.get(file);
    if (!t) {
      t = this.loader.loadAsync(file.startsWith('/')?file:this.base+file).then(async (g) => {
        try { await this.prepareModel?.(g); }
        catch (error) { disposeModel(g.scene); throw error; }
        return g.scene;
      });
      this.templates.set(file, t);
    }
    return t;
  }
}

/** Cached clones share resources; release each resource once, including a preparation failure before attachment. */
function disposeModel(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of [o.material].flat()) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

/**
 * Lower the hover while the engine says the floater is resting (sleep_on_mat: human.sleepPose
 * standingFraction 0 = settled; 'sit' / seated slots hover a little lower). Pure in its inputs.
 */
function settled(body: FloaterBody, e: Pick<SampledEntity, 'activity' | 'state'>): FloaterBody {
  const sleep = (e.state?.sleepPose as { standingFraction?: number } | undefined)?.standingFraction;
  if (typeof sleep === 'number') return { ...body, hoverHeight: body.radius + 0.15 + (body.hoverHeight - body.radius - 0.15) * Math.min(Math.max(sleep, 0), 1) };
  if (e.activity === 'sit') return { ...body, hoverHeight: Math.max(body.radius + 0.6, body.hoverHeight - 0.35) };
  return body;
}

/** A placement of a background kin head (scenery: not an entity, never in the engine). */
export type KinPlacement = { model: string; p: [number, number, number]; yaw?: number; radius?: number };

/**
 * Background kin as static scenery: the ceramic-head subset, hovering and bobbing in place. Bob is
 * keyed on the placement index and the tick, like the floaters, so it is replay-stable too.
 */
export class KinScenery {
  readonly view: FloaterView;
  private readonly placements: KinPlacement[] = [];

  constructor(parent: THREE.Object3D, opts: FloaterViewOpts) {
    this.view = new FloaterView(parent, opts);
    this.view.root.name = 'kin';
  }

  place(list: readonly KinPlacement[]): void {
    for (const id of this.view.ids()) this.view.remove(id);
    this.placements.length = 0;
    list.forEach((k, i) => {
      this.placements.push(structuredClone(k));
      // hover set so p is the head's resting height; bob phase from the index-derived id
      this.view.add(`kin:${i}:${k.model}`, { family: 'floater', model: k.model, radius: k.radius ?? 0.28, hoverHeight: 0.4 });
    });
  }

  update(tick: number, dt?: number): void {
    const frame: Record<string, SampledEntity> = {};
    this.placements.forEach((k, i) => {
      const id = `kin:${i}:${k.model}`;
      frame[id] = { p: [k.p[0], k.p[1] - 0.4, k.p[2]], yaw: k.yaw ?? 2 * Math.PI * idPhase(id, 7), pitch: 0, roll: 0, state: {} };
    });
    this.view.update(frame, tick, dt);
  }

  ready() {
    return this.view.ready();
  }
  async readyInitial(){const ids=this.placements.map((k,i)=>`kin:${i}:${k.model}`);this.view.retryInitial(ids);await this.view.readyInitial(ids);}

  dispose() {
    this.view.dispose();
  }
}
