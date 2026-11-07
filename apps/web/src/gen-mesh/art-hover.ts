// W6: hover a framed picture, video or gallery slot on a world-engine world to read its title and who made it.
// Self-contained like the sound layer: it waits for `window.__soulsEntity` (new worlds only), listens on the canvas,
// raycasts at most 20 times a second against faces carrying `userData.art` (sign.mesh.ts), within REACH_M.
// `window.__edenArt.state()` reports the art faces in view and the current hover (tests, proof).
import * as THREE from 'three';
import { hoverText, videoState, type ArtInfo } from './art-media.ts';

type Host = { layer: { group?: THREE.Object3D }; camera: THREE.PerspectiveCamera; renderer?: THREE.WebGLRenderer };
const REACH_M = 25;
let faces: THREE.Mesh[] = [], lastScan = 0, tip: HTMLDivElement | null = null, canvas: HTMLCanvasElement | null = null, pointer: { x: number; y: number } | null = null, lastPick = 0, current: (ArtInfo & { text: string }) | null = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

function scan(host: Host, now: number) {
  if (now - lastScan < 1000) return; lastScan = now; faces = [];
  host.layer.group?.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.art) faces.push(o as THREE.Mesh); });
}
function pick(host: Host): (ArtInfo & { text: string }) | null {
  if (!canvas || !pointer || !faces.length) return null;
  const r = canvas.getBoundingClientRect(); if (!r.width) return null;
  ndc.set(((pointer.x - r.left) / r.width) * 2 - 1, -((pointer.y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, host.camera); ray.far = REACH_M;
  const hit = ray.intersectObjects(faces, false).find((h) => { for (let p: THREE.Object3D | null = h.object; p; p = p.parent) if (!p.visible) return false; return true; });
  if (!hit) return null;
  const art = hit.object.userData.art as ArtInfo;
  return { ...art, text: hoverText(art) };
}
function show(a: (ArtInfo & { text: string }) | null) {
  current = a; if (!tip) return;
  if (!a || !pointer) { tip.hidden = true; return; }
  tip.textContent = a.text; tip.hidden = false;
  tip.style.left = `${Math.min(window.innerWidth - 16 - tip.offsetWidth, pointer.x + 14)}px`; tip.style.top = `${pointer.y + 16}px`;
}
function attach(host: Host) {
  const el = host.renderer?.domElement; if (!el || el === canvas) return;
  canvas = el;
  if (!tip) {
    tip = document.createElement('div'); tip.className = 'eden-art-tooltip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    tip.style.cssText = 'position:fixed;z-index:31;pointer-events:none;max-width:min(360px,calc(100vw - 32px));padding:6px 10px;border-radius:6px;background:rgba(24,22,20,.86);color:#f6f1e6;font:13px/1.35 Georgia,"Iowan Old Style",serif;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    document.body.append(tip);
  }
  el.addEventListener('pointermove', (e) => { pointer = e.buttons ? null : { x: e.clientX, y: e.clientY }; if (!pointer) show(null); });
  el.addEventListener('pointerleave', () => { pointer = null; show(null); });
}

export function startArtHover() {
  if (typeof window === 'undefined' || (window as unknown as { __edenArt?: unknown }).__edenArt) return;
  const w = window as unknown as { __soulsEntity?: Host; __edenArt?: unknown };
  w.__edenArt = {
    state: () => ({ faces: faces.map((f) => ({ ...(f.userData.art as ArtInfo) })), hover: current, videos: videoState() }),
    /** Hover a screen point programmatically (proof scripts drive the real pointer instead when they can). */
    pickAt: (x: number, y: number) => { pointer = { x, y }; const h = w.__soulsEntity; if (h) { scan(h, performance.now() + 1e9); show(pick(h)); } return current; },
  };
  setInterval(() => {
    const host = w.__soulsEntity; if (!host?.camera || !host.layer) return;
    const now = performance.now(); attach(host); scan(host, now);
    if (pointer && now - lastPick > 50) { lastPick = now; try { show(pick(host)); } catch { /* mid-reload */ } }
  }, 50);
}
startArtHover();
