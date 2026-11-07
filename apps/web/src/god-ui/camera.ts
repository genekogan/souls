// Fly the world camera somewhere (flags, preview ghosts). Uses the handles the
// world page exposes as window.__soulsEntity; keeps the current viewing direction.
import * as THREE from 'three';

type Souls = { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update?: () => void } };
let flight = 0;

export function canFly(): boolean { return !!(window as unknown as { __soulsEntity?: Souls }).__soulsEntity?.camera; }

/** Ease the camera over `ms` to look at (x, y, z) from `distance` metres, same heading as now. */
/** `aside` (0–0.5): put the point that far left of centre, e.g. to keep it clear of the god panel on the right. */
export function flyTo(x: number, y: number, z: number, { distance = 45, ms = 900, aside = 0 }: { distance?: number; ms?: number; aside?: number } = {}) {
  const sim = (window as unknown as { __soulsEntity?: Souls }).__soulsEntity; if (!sim?.camera) return false;
  const { camera, controls } = sim;
  const fromT = controls.target.clone(), fromP = camera.position.clone();
  const dir = fromP.clone().sub(fromT); if (dir.lengthSq() < 1e-6) dir.set(-0.6, 0.5, 0.7);
  dir.normalize();
  if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }   // never skim the ground
  const toT = new THREE.Vector3(x, y, z);
  if (aside) { const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize(); toT.addScaledVector(right, distance * aside * Math.tan(((camera.fov ?? 50) * Math.PI) / 360) * camera.aspect); }
  const toP = toT.clone().addScaledVector(dir, distance);
  const t0 = performance.now(), id = ++flight;
  const step = (now: number) => {
    if (id !== flight) return;
    const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(fromT, toT, e); camera.position.lerpVectors(fromP, toP, e); camera.lookAt(controls.target); controls.update?.();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
}
