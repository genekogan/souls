// P7d (team/lanes/t4-p7.md "P7d design"): on a phone's new world the arrival is drawn by the page's first phase. When
// the early layer (early-layer.ts) has built the near world, this makes the renderer, scene, camera, daylight and
// atmosphere LiveWorld would make, links their programs in parallel, draws one frame and shows it as a still poster over
// the page: the arrival no longer waits for React, the Shell and the rest of the page (~340 KB on a phone's link, then
// ~1 s of 4x CPU). LiveWorld adopts these objects (takeEarlyRender) and removes the poster once it has drawn the world
// itself; people arrive after, as with lever D. If LiveWorld comes first (a fast link), this draws nothing.
import * as THREE from 'three';
import { Daylight } from './daylight.ts';
import { installNightLighting } from './WorldNightLights.ts';
import { createWorldAtmosphere } from './WorldAtmosphere.ts';
import { installLookToneCurve, installMaterialDetail, lookExposure, lookSettings, setMaterialDetail } from './rendering/WorldLook.ts';
import { browserQuality } from './quality-tier.ts';
import { worldArrivalPose } from './arrival-shot.ts';
import { calendarClock, entityWorldState, entryWorldClock, setWeatherOf, shotClockAt } from './world-env.ts';
import { visitorPreviewHour } from './visitor-hour.ts';
import { arrivalGate } from './gen-mesh/lazy-assets.ts';
import { compileSceneAsync } from './gen-mesh/texture-budget.ts';
import { arrivalMark } from './arrival-marks.ts';
import { earlyArrival } from './early-arrival.ts';
import { callPhase2, PHASE2_FILL } from './phased-entry.ts';
import { earlyRenderClaimed, offerEarlyRender, peekEarlyLayer, removeEarlyPoster, setEarlyPoster, type EarlyLayer, type EarlyRenderHandOver } from './early-layer.ts';

/** The one switch. `?earlyRender=0` turns it off for a page (the early layer and lever D stay). */
export const EARLY_RENDER = true;
export const earlyRenderWanted = (search = location.search): boolean => EARLY_RENDER && new URLSearchParams(search).get('earlyRender') !== '0';
/** A poster LiveWorld never replaced (it failed or never came) goes after this long. */
const POSTER_MAX_MS = 20_000;

/** Start once the early layer's near world is built (early-entry.ts calls this when the snapshot is in). `done` lets the
 *  page's second phase run: called once the poster is on screen, or at once when this draws nothing. */
export function startEarlyRender(done: () => void = () => {}): void {
  const early = peekEarlyLayer();
  if (!early || !earlyRenderWanted() || earlyRenderClaimed() || early.abort.signal.aborted) return done();
  let made: Made | null = null;
  try { made = setUp(early); } catch (e) { console.warn('early renderer', e); }
  if (!made) return done();
  const m = made; void early.started.then(() => { try { arrive(early, m, done); } catch (e) { console.warn('early renderer', e); done(); } }, done);
}

type Made = ReturnType<typeof setUp>;
/** At once (the near world is still building): the renderer, scene, lights and atmosphere, offered to LiveWorld, and the
 *  programs of what is built so far linked in parallel with the rest of the build. */
function setUp(early: EarlyLayer) {
  const layer = early.layer;
  arrivalMark('early-render-start');
  const quality = browserQuality(), look = lookSettings(location.search, quality.tier, true);
  // as LiveWorld, before any program: the night-light chunk declares the world-position varying the detail chunk reads
  // (without it every lit program failed to compile: no ground, trees or buildings in the poster or after the swap)
  installNightLighting(); installLookToneCurve(); installMaterialDetail(); setMaterialDetail(look.detail);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.maxPixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  if (look.enabled) renderer.toneMapping = THREE.CustomToneMapping;
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2400);
  const atmosphere = createWorldAtmosphere(scene);
  const light = new Daylight(scene, { bakedShadow: quality.bakedShadows }); if (quality.shadowMapSize !== light.sun.shadow.mapSize.x) light.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  scene.add(layer.group);
  // LiveWorld's lightning (WorldLightning) adds a sky-wide flash, a hemisphere light at 0; a scene's light counts are part
  // of every program, so without a stand-in here LiveWorld relinked all of them. LiveWorld removes it once its own is in
  const flashStandIn = new THREE.HemisphereLight(0xdfe7ff, 0x3a4060, 0); flashStandIn.name = 'early flash stand-in'; scene.add(flashStandIn);
  const hand: EarlyRenderHandOver = { renderer, scene, camera, light, atmosphere, standIns: [flashStandIn] };
  if (!offerEarlyRender(hand)) { scene.remove(layer.group); renderer.dispose(); return null; }
  void compileSceneAsync(renderer, scene, camera);
  return { renderer, scene, camera, light, atmosphere, look, quality, hand, w, h };
}

/** The near world is built: the arrival pose, the nearest models, the remaining programs, one frame, the poster. */
function arrive(early: EarlyLayer, made: NonNullable<Made>, done: () => void) {
  const layer = early.layer, { renderer, scene, camera, light, atmosphere, look, quality, hand, h } = made;
  if (!layer.active) return done();
  // P7f: the world's arrival camera (arrival-shot.ts): with Souls, the broadcast's opening view, which the broadcast's first
  // shot then starts from (hand.opening); LiveWorld frames the same view, whoever draws first
  const pose = worldArrivalPose(layer, camera.aspect);
  hand.target = [...pose.target]; hand.eye = [...pose.eye]; hand.opening = pose.opening;
  if (earlyRenderClaimed() || early.abort.signal.aborted) return done();
  arrivalMark('early-render-built');
  const target = new THREE.Vector3().fromArray(pose.target);
  camera.position.fromArray(pose.eye); camera.lookAt(target);
  // the world's clock as the page's HTML gave it (the server writes it; apps/server/src/edge-snapshot.ts withWorldClock): the
  // sky, sun and night fill as LiveWorld's first take will set them, instead of the no-clock midday it then jumped from
  let clock = calendarClock(entryWorldClock(), entityWorldState(layer));
  if (clock) { light.setNightLighting(true); light.update(shotClockAt(clock, visitorPreviewHour()));
    if (!Number.isFinite(light.daylight)) { clock = null; light.setNightLighting(false); light.update(null); } }   // a clock the sun cannot place: midday, never a black poster
  hand.clock = clock;
  // a frame as LiveWorld's first on this path: things at their stored pose, the world's clock, the god's weather
  const prepare = () => {
    layer.interiorFrom = camera.position; layer.freezeSettled = quality.tier === 'phone';
    layer.update(0, performance.now());
    atmosphere.update({ seconds: 0, dt: 0, daylight: light.daylight, camera, eden: true, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      clock: shotClockAt(clock, visitorPreviewHour()), profile: 'world', weather: setWeatherOf(entityWorldState(layer)), indoors: () => false });
    if (look.enabled) { if (look.follow) light.follow(target, camera.position); renderer.toneMappingExposure = lookExposure(light.daylight, look.nightExposure); }
  };
  const draw = () => {
    if (earlyRenderClaimed() || early.abort.signal.aborted) return done();   // LiveWorld has it now
    prepare();
    layer.cull(camera, h, true);
    try { renderer.render(scene, camera); } finally { layer.uncull(); }
    arrivalMark('early-render-drawn');
    // the poster: this frame copied in the same task (the GL canvas keeps no drawing buffer), over the page
    const gl = renderer.domElement, still = document.createElement('canvas');
    still.width = gl.width; still.height = gl.height; still.className = 'early-world-poster'; still.setAttribute('aria-hidden', 'true');
    Object.assign(still.style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', zIndex: '2147480000', pointerEvents: 'none', display: 'block' });
    still.getContext('2d')?.drawImage(gl, 0, 0);
    document.body.appendChild(still); setEarlyPoster(still);
    requestAnimationFrame(() => { arrivalMark('early-poster'); earlyArrival.mark(); done(); });
    setTimeout(removeEarlyPoster, POSTER_MAX_MS);
  };
  const safeDraw = () => { try { draw(); } catch (e) { console.warn('early renderer', e); done(); } };
  // the nearest models first (the card waited for them too), then the programs linked in parallel, then one frame
  const gate = new Promise<void>((resolve) => { if (!arrivalGate.pending()) return resolve(); const off = arrivalGate.subscribe(() => { if (!arrivalGate.pending()) { off(); resolve(); } }); setTimeout(resolve, 3_000); });
  // t4-phone: the poster's bytes are all in: phase two's entry downloads and the socket opens while this links and draws
  // (the entry still runs only once the poster is up)
  void gate.then(() => { if (earlyRenderClaimed()) return; arrivalMark('early-render-gate'); callPhase2(PHASE2_FILL); prepare(); return compileSceneAsync(renderer, scene, camera).then(() => arrivalMark('early-render-linked')); }).then(() => requestAnimationFrame(safeDraw), () => requestAnimationFrame(safeDraw));
}
