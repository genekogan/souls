// E2C: old Eden's lit windows for building/1. At night a lit window shows a room behind the glass ("interior mapping": a
// ray from the eye through the pane is traced into a box room; eden-window-interiors.ts paints its walls, floor, lamp,
// a picture or shelf, now and then a person, and curtains). Rooms switch on through the evening by the viewer's
// windowsLitAt curve (uEdenWindows.x = fraction lit; each window keeps its own threshold), so streets are never
// uniformly lit. Only the outdoor side of an outside window shows a room (from inside a house the glass is plain glass),
// and by day nothing changes (every term is scaled by the night strength). Presentation only.
import * as THREE from 'three';
import { EDEN_ROOM_GLSL } from '../../../../mars/viewer/app/engine-view/content/assets/eden-window-interiors.ts';

const ROOM = /* glsl */ `
if (abs(vEdenPane.z) > .01 && uEdenNight.x > .001) {
 vec3 wp = vEdenNightWorld, vW = normalize(wp - cameraPosition), nF = normalize(vEdenPaneN), N = nF * sign(vEdenPane.z);
 if (dot(N, vW) < 0.0) {
  vec3 T = normalize(vec3(nF.z, 0.0, -nF.x) + vec3(1e-5, 0.0, 0.0));
  float W = abs(vEdenPane.z);
  vec3 R = vec3(max(W + 1.6, 3.0), 2.8, 3.4);
  vec3 c = wp - T * (vEdenPane.x - W * .5) - vec3(0.0, vEdenPane.y, 0.0);
  float seed = edenRh(floor(c * 2.0 + .5) + vec3(17.0, 3.0, 5.0));
  vec3 o = vec3((R.x - W) * .5 + vEdenPane.x, vEdenPane.w + vEdenPane.y, 0.0), d = vec3(dot(vW, T), vW.y, dot(vW, -N));
  float k = uEdenNight.x * step(seed, uEdenWindows.x);
  vec3 room = edenRoom(o, d, R, seed, uEdenWindows.y); float cover; room = edenCurtain(vEdenPane.x / W, 0.0, seed, room, cover);
  totalEmissiveRadiance = mix(totalEmissiveRadiance, room * .7, k);
  diffuseColor.rgb *= 1.0 - k;
  diffuseColor.a = mix(diffuseColor.a, 1.0, k);
 }
}`;

const done = new WeakSet<THREE.Material>();
/** Patch building/1's window glass (once): rooms behind lit windows at night. Needs the viewer's night lighting
 *  (uEdenNight, uEdenWindows, vEdenNightWorld; WorldNightLights.ts); without it the glass is unchanged. */
export function nightWindows(m: THREE.Material): THREE.Material {
  if (done.has(m)) return m;
  done.add(m); m.name ||= 'building window glass (night rooms)';
  m.onBeforeCompile = (sh) => {
    if (!sh.uniforms.uEdenNight || !sh.uniforms.uEdenWindows) return;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute vec4 edenPane;\nvarying vec4 vEdenPane;\nvarying vec3 vEdenPaneN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdenPane = edenPane;\nvEdenPaneN = mat3(modelMatrix) * objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform vec4 uEdenWindows;\nvarying vec4 vEdenPane;\nvarying vec3 vEdenPaneN;\n${EDEN_ROOM_GLSL}\nvoid main() {`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ROOM}`);
  };
  m.customProgramCacheKey = () => 'eden-building-night-windows-v1';
  // PERF-BATCH: the patch reads only per-vertex pane data and world-space inputs, so storey glass merges per cell in the
  // static batcher (StaticBatchOwner); same-coloured panes blend the same in any order (lit rooms at night excepted).
  m.userData.batchSafePatch = true; m.userData.batchTransparent = true;
  return m;
}
