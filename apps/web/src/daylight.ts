// P7d: the world's daylight (sky colour, sun, fill) in its own module, so a phone's early renderer (early-render.ts) can
// light the first frame without WorldGeometry's code. WorldGeometry re-exports it.
import * as THREE from 'three';
import { solarPosition } from '../../../mars/viewer/engine/env/sun.ts';
import { siteNorthOffset } from './site-north.ts';
import {createEdenDaylight} from './atmosphere/visual-transitions.ts';
import {shadowFollowBox,installStableShadowFilter,installBakedSunShadow} from './rendering/WorldLook.ts';
import { daylightFactors } from '../../../mars/viewer/engine/env/daylight.ts';
import { fitNearPlane } from '../../../mars/viewer/lib/depth-fit.ts';
const DAY_SKY = new THREE.Color('#a6bed0'), NIGHT_SKY = new THREE.Color('#121a2b'), DUSK_SKY = new THREE.Color('#d99a6c');
const SUN_WHITE = new THREE.Color('#fff2dc'), SUN_WARM = new THREE.Color('#ffb36b');

/** Sky colour, sun and fill light for the world clock (Bombay Beach sun, the engine's own solar model). */
export class Daylight {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x5b5040, 1.6);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  /** Soft observer fill keeps bodies legible at night; it is not a second sun or a physical light source. */
  readonly fill = new THREE.DirectionalLight(0xb9cbea, 0.65);
  /** PERF-BAKED-SHADOWS: the sun's cached shadow of still things (rendering/SunShadowCache.ts aims and draws it): a
   *  shadow source only (no light; the lights chunk shadows the sun with it), right after the sun among the scene's
   *  shadow-casting lights. null on the phone tier, with `?bakedShadows=0`, or if the chunk could not be patched. */
  readonly baked: THREE.DirectionalLight | null = null;
  private key = '';
  private commonsReadability=false;
  private nightLighting=false;
  private readonly edenDaylight=createEdenDaylight();
  private daylightFactor:number|null=null;
  /** 0 at night .. 1 in full day; null before the first clock. */
  get daylight(){return this.daylightFactor;}
  /** With lamp/window light pools active, night drops to dim moonlight away from lights. */
  setNightLighting(enabled:boolean){
    if(this.nightLighting===enabled)return;
    this.nightLighting=enabled;this.key='';this.observerFill();
  }
  /** Presentation fill only: astronomical sun/time and physical light truth stay unchanged. */
  setCommonsReadability(enabled:boolean){
    if(this.commonsReadability===enabled)return;
    this.commonsReadability=enabled;this.observerFill();
  }
  private observerFill(){
    if(this.daylightFactor===null)return;
    const d=this.daylightFactor;
    if(this.nightLighting){
      // Same daytime fill; at night a dim blue moon instead of a bright observer fill.
      this.hemi.intensity=.3+((this.commonsReadability?1.70:1.70)-.3)*d;
      this.fill.intensity=.18*(1-d)+.2*d;
      return;
    }
    this.hemi.intensity=(this.commonsReadability?1.20:.75)+(this.commonsReadability ? .50 : .95)*d;
    this.fill.intensity=.2+(this.commonsReadability ? .7 : .45)*(1-d);
  }
  /** Sun elevation in degrees at the last update (null before the first). */
  elevation: number | null = null;

  private readonly scene: THREE.Scene;
  private readonly beforeRender: THREE.Object3D['onBeforeRender'];
  private readonly previousBeforeRender: THREE.Object3D['onBeforeRender'];

  constructor(scene: THREE.Scene, { bakedShadow = false }: { bakedShadow?: boolean } = {}) {
    installStableShadowFilter();
    this.scene = scene;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.05;
    this.fill.position.set(-12, 18, 12);
    scene.add(this.hemi, this.sun, this.sun.target);
    if (bakedShadow && installBakedSunShadow()) {
      const baked = this.baked = new THREE.DirectionalLight(0x000000, 0);
      baked.name = 'sun (cached shadow)'; baked.castShadow = true;
      // drawn once by whichever shadow pass comes first (so it is never unwritten), then only by SunShadowCache
      baked.shadow.autoUpdate = false; baked.shadow.needsUpdate = true;
      scene.add(baked, baked.target);
    }
    scene.add(this.fill, this.fill.target);
    scene.background = DAY_SKY.clone();
    // Depth precision (flickering layered surfaces): fit every perspective camera's near plane to its height
    // above the ground just before the scene is drawn (lib/depth-fit.ts). Chained with any existing hook.
    const previous = this.previousBeforeRender = scene.onBeforeRender;
    this.beforeRender = function (this: THREE.Object3D, renderer, s, camera, geometry, material, group) { fitNearPlane(camera); previous.call(this, renderer, s, camera, geometry, material, group); };
    scene.onBeforeRender = this.beforeRender;
    this.fit([-20, -20, 20, 20]);
  }

  /** Aim the sun's shadows at the ground rectangle being shown. */
  fit([x0, z0, x1, z1]: readonly [number, number, number, number]) {
    this.followKey = '';
    const half = Math.max(20, Math.max(x1 - x0, z1 - z0) * 0.75);
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 300 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.fill.target.position.copy(this.sun.target.position);
    this.fill.position.copy(this.fill.target.position).add(new THREE.Vector3(-12, 18, 12));
    // Shadow acne on tilted panels and roofs: normal offset of about one shadow-map texel (never under 5 cm).
    this.sun.shadow.normalBias = Math.max(0.05, (2 * half) / this.sun.shadow.mapSize.x);
    const key = this.key;
    this.key = '';
    this.update(key === 'none' || !key ? null : key);
  }

  private followKey = '';
  /** Entity worlds (viewer look pass): keep the sun's shadow box on what the camera is looking at. A god builds
   *  anywhere in a kilometre-wide world, but fit() is called once with the origin's rectangle, so builds more than
   *  ~45 m from the origin had no shadows at all. Centre = the orbit target, half-size from the eye distance (rounded
   *  to 8 m steps), centre snapped to whole shadow texels: a still camera gives the same shadow every frame, so shots
   *  stay deterministic. Soft edges: the PCF disk radius is about 18 cm of ground (1.25..3.5 texels). */
  follow(target: THREE.Vector3, eye: THREE.Vector3) {
    const box = shadowFollowBox(target, eye, this.sun.shadow.mapSize.x);
    if (!box || box.key === this.followKey) return;
    this.followKey = box.key;
    Object.assign(this.sun.shadow.camera, { left: -box.half, right: box.half, top: box.half, bottom: -box.half, near: 1, far: 400 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const delta = new THREE.Vector3(box.cx, box.cy, box.cz).sub(this.sun.target.position);
    this.sun.target.position.add(delta); this.sun.position.add(delta);
    this.fill.target.position.add(delta); this.fill.position.add(delta);
    this.sun.shadow.normalBias = box.normalBias;
    this.sun.shadow.radius = box.radius;
  }

  /** Preserve renderer-derived millisecond precision; second bins freeze sunlight between samples. */
  private datetime: string | null = null;
  /** Explore place shots (Gene #13): the light at another clock for one offscreen render; returns the undo. */
  get clock() { return this.datetime; }
  photo(datetime: string) { const live = this.datetime; this.update(datetime); return () => this.update(live); }
  update(datetime: string | null) {
    const key = datetime ? `${datetime}|${siteNorthOffset()}` : 'none';
    if (key === this.key) return;
    this.key = key;this.datetime=datetime;
    if (!datetime) { // no clock yet: a soft midday so the camp reads
      this.daylightFactor=null;
      this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(20, 35, 15));
      this.sun.intensity = 2; this.hemi.intensity = 1.6; this.sun.color.copy(SUN_WHITE);
      this.fill.intensity = 0.2;
      (this.scene.background as THREE.Color).copy(DAY_SKY);
      this.elevation = null;
      return;
    }
    let pos;
    try { pos = solarPosition(datetime, undefined, undefined, siteNorthOffset()); } catch { return; }
    const original = daylightFactors(pos.elevationDeg);
    const f=this.nightLighting?this.edenDaylight(datetime,original):original;
    this.daylightFactor=f.daylight;
    const dir = new THREE.Vector3(...pos.direction);
    if (dir.y < 0.05) dir.y = 0.05; // below the horizon: keep the shadow camera sane; intensity goes to ~0 anyway
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir.normalize(), 80);
    this.sun.intensity = 2.6 * f.daylight;
    this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, f.warmth * 0.7);
    // night stays readable: a moonlit fill rather than black
    this.observerFill();
    this.hemi.color.set(0x9fb3d9).lerp(SUN_WHITE,f.daylight);

    (this.scene.background as THREE.Color).copy(NIGHT_SKY).lerp(DUSK_SKY, Math.max(f.warmth * f.daylight, f.blueHour * 0.4)).lerp(DAY_SKY, f.daylight * (1 - f.warmth * 0.6));
    this.elevation = pos.elevationDeg;
  }

  dispose() {
    this.sun.shadow.dispose();
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    if (this.baked) { this.baked.shadow.dispose(); this.scene.remove(this.baked, this.baked.target); }
    if (this.scene.onBeforeRender === this.beforeRender) this.scene.onBeforeRender = this.previousBeforeRender;
  }
}
