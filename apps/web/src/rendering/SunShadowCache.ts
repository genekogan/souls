import * as THREE from 'three';
/** Lane PERF-BAKED-SHADOWS (2026-11-02): the sun's shadow of still things, cached.
 *
 *  Still things (frozen things, their static batches, the scatter and entity instance pools) are drawn into a second
 *  shadow map (Daylight.baked) only when the sun turns more than half a degree, the sun's shadow box steps outside the
 *  cached box, the box changes size, or a still thing changes (the entity layer's static revision). Every other shadow
 *  frame the sun's own map draws only what moves (bodies, moving things, anything not listed as still); the lights chunk
 *  shadows the sun with the darker of the two maps (WorldLook.bakedSunShadowChunk), through the same PCF.
 *
 *  The cached box is the sun's box widened by BAKE_MARGIN_TEXELS on every side at the same texel size (a larger map), on
 *  the same centre when drawn: same texel grid, same bias, normal bias and PCF radius, so edges match the per-frame map
 *  exactly at a still camera, and a walking camera moves inside the margin before the cache is redrawn.
 *
 *  It works by wrapping `renderer.shadowMap.render` (as RenderShadowMeter does): on a shadow frame of the scene it is
 *  given, the cached map is drawn first when due (still things only), then the still things are hidden around the
 *  sun's own pass. Nothing changes outside that call. */
export const BAKE_MARGIN_TEXELS = 128;
/** The cached map is redrawn once the sun has turned this far since it was drawn. */
export const BAKE_SUN_DEGREES = 0.5;
/** Still things changed: redrawn at most this often (a thing eased into place changes the revision every frame). */
export const BAKE_REVISION_MS = 200;
/** Room kept inside the margin for the PCF disk (3.5 texels at most) and the sun's half-degree of turn. */
const BAKE_PAD_TEXELS = 16;

export type BakeKey = { half: number; mapSize: number; cx: number; cy: number; cz: number; dir: readonly [number, number, number]; revision: number };
export type BakeState = BakeKey & { at: number };

/** The light camera's right and up axes for a sun direction (three's lookAt with +y up, as the shadow camera aims). */
export function lightAxes([dx, dy, dz]: readonly [number, number, number]): [number, number, number, number, number, number] {
  let zx = dx, zy = dy, zz = dz;
  if (Math.abs(zx) < 1e-9 && Math.abs(zz) < 1e-9) zz += 1e-4;   // straight down: three nudges the same way
  const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let rx = zz, rz = -zx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;   // cross((0,1,0), z)
  return [rx, 0, rz, zy * rz, zz * rx - zx * rz, -zy * rx];                  // right, up = cross(z, right)
}

/** Why the cached map must be drawn again for the sun's box now, or null when the cache still covers it. */
export function bakeReason(last: BakeState | null, now: BakeKey, at: number): 'first' | 'box' | 'sun' | 'step' | 'statics' | null {
  if (!last) return 'first';
  if (last.half !== now.half || last.mapSize !== now.mapSize) return 'box';
  const [ax, ay, az] = last.dir, [bx, by, bz] = now.dir;
  const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
  if (!(cos >= Math.cos(BAKE_SUN_DEGREES * Math.PI / 180))) return 'sun';
  const room = (BAKE_MARGIN_TEXELS - BAKE_PAD_TEXELS) * (2 * now.half / now.mapSize);
  const [rx, ry, rz, ux, uy, uz] = lightAxes(last.dir), dx = now.cx - last.cx, dy = now.cy - last.cy, dz = now.cz - last.cz;
  if (Math.abs(dx * rx + dy * ry + dz * rz) > room || Math.abs(dx * ux + dy * uy + dz * uz) > room) return 'step';
  if (now.revision !== last.revision && at - last.at >= BAKE_REVISION_MS) return 'statics';
  return null;
}

type ShadowRender = THREE.WebGLRenderer['shadowMap']['render'];
export type SunShadowSource = {
  /** False: the cached map is cleared (casts nothing) and the sun's map draws everything, as without the cache. */
  enabled: () => boolean;
  /** The still things' roots (their whole subtrees cast into the cached map); asked once per shadow frame, at render. */
  statics: () => readonly THREE.Object3D[];
  /** Changes whenever a still thing appears, goes, moves, shows or hides. */
  revision: () => number;
};

export class SunShadowCache {
  readonly stats = { bakes: 0, reason: '' as string, statics: 0, hidden: 0, lastBakeAt: 0 };
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly sun: THREE.DirectionalLight;
  private readonly baked: THREE.DirectionalLight;
  private readonly source: SunShadowSource;
  private readonly original: ShadowRender;
  private readonly wrapped: ShadowRender;
  private readonly root = new THREE.Object3D();
  private last: BakeState | null = null;
  private due: BakeKey | null = null;
  private armed = false;
  private cleared = false;
  private now = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sun: THREE.DirectionalLight, baked: THREE.DirectionalLight, source: SunShadowSource) {
    this.renderer = renderer; this.scene = scene; this.sun = sun; this.baked = baked; this.source = source;
    const map = renderer.shadowMap, owner = this;
    this.original = map.render;
    this.wrapped = function (lights, s, camera) { return owner.render(lights, s, camera); } as ShadowRender;
    map.render = this.wrapped;
  }

  /** The camera to cull still things against on a shadow frame: the cached box (a superset of the sun's). */
  get cullCamera(): THREE.Camera { return (this.due || this.last) && !this.cleared ? this.baked.shadow.camera : this.sun.shadow.camera; }

  /** Before each draw (before culling), with whether this frame redraws shadows: aims the cached map when it is due. */
  prepare(shadowFrame: boolean, now = performance.now()) {
    this.now = now; this.armed = false; this.due = null;
    if (!this.source.enabled()) { if (!this.cleared) this.clear(); return; }
    if (!shadowFrame) return;
    this.cleared = false; this.armed = true;
    const key = this.key(), reason = key && bakeReason(this.last, key, now);
    if (!key || !reason) return;
    this.due = key; this.stats.reason = reason; this.aim(key);
  }

  private key(): BakeKey | null {
    const cam = this.sun.shadow.camera, t = this.sun.target.position, p = this.sun.position;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z, l = Math.hypot(dx, dy, dz);
    if (!(l > 0) || !(cam.right > 0)) return null;
    return { half: cam.right, mapSize: this.sun.shadow.mapSize.x, cx: t.x, cy: t.y, cz: t.z, dir: [dx / l, dy / l, dz / l], revision: this.source.revision() };
  }

  /** The cached light on the sun's box centre and direction, the box widened by the margin at the same texel size. */
  private aim(k: BakeKey) {
    const sun = this.sun, b = this.baked, texel = 2 * k.half / k.mapSize, half = k.half + BAKE_MARGIN_TEXELS * texel;
    const dist = sun.position.distanceTo(sun.target.position), cam = b.shadow.camera;
    b.shadow.mapSize.set(k.mapSize + 2 * BAKE_MARGIN_TEXELS, k.mapSize + 2 * BAKE_MARGIN_TEXELS);
    Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: sun.shadow.camera.near, far: sun.shadow.camera.far });
    cam.updateProjectionMatrix();
    b.shadow.bias = sun.shadow.bias; b.shadow.normalBias = sun.shadow.normalBias; b.shadow.radius = sun.shadow.radius;
    b.target.position.set(k.cx, k.cy, k.cz); b.position.set(k.cx + k.dir[0] * dist, k.cy + k.dir[1] * dist, k.cz + k.dir[2] * dist);
    b.updateMatrixWorld(); b.target.updateMatrixWorld(); b.shadow.updateMatrices(b);
  }

  private render(lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) {
    const map = this.renderer.shadowMap;
    if (!this.armed || scene !== this.scene || (!map.autoUpdate && !map.needsUpdate)) return this.original.call(map, lights, scene, camera);
    this.armed = false;
    const statics = this.source.statics(), hidden: THREE.Object3D[] = [];
    if (this.due) this.bake(statics, camera, this.due);
    for (const o of statics) if (o.visible) { o.visible = false; hidden.push(o); }
    this.stats.statics = statics.length; this.stats.hidden = hidden.length;
    try { return this.original.call(map, lights, scene, camera); } finally { for (const o of hidden) o.visible = true; }
  }

  /** Still things (whose ancestors are all shown) into the cached map; the proxy hook first, as in the scene. */
  private bake(statics: readonly THREE.Object3D[], camera: THREE.Camera, key: BakeKey) {
    const children: THREE.Object3D[] = [], hook = this.scene.getObjectByName('shadow-proxy hook');
    if (hook && hook.parent === this.scene) children.push(hook);
    for (const o of statics) if (shown(o, this.scene)) children.push(o);
    this.draw(children, camera);
    this.last = { ...key, at: this.now }; this.due = null; this.stats.bakes++; this.stats.lastBakeAt = this.now;
  }

  /** The cached map holds nothing: every point is lit by it (the sun's own map then draws everything). */
  private clear() { this.draw([], this.sun.shadow.camera); this.last = null; this.cleared = true; this.stats.reason = 'off'; }

  private draw(children: THREE.Object3D[], camera: THREE.Camera) {
    const map = this.renderer.shadowMap, auto = map.autoUpdate, needs = map.needsUpdate;
    // a parentless stand-in root lists the children without re-parenting them (the shadow pass only walks `children`)
    this.root.children = children;
    try { map.autoUpdate = false; map.needsUpdate = true; this.baked.shadow.needsUpdate = true; this.original.call(map, [this.baked], this.root as unknown as THREE.Scene, camera); }
    finally { this.root.children = []; map.autoUpdate = auto; map.needsUpdate = needs; this.baked.shadow.needsUpdate = false; }
  }

  dispose() { if (this.renderer.shadowMap.render === this.wrapped) this.renderer.shadowMap.render = this.original; }
}

function shown(o: THREE.Object3D, scene: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) { if (!p.visible) return false; if (p === scene) return true; }
  return false;
}
