// W6: art on world-engine worlds — what a frame shows (image or looping video) and who made it.
// Frames, screens and gallery walls (defs tagged `sign-text` with `media` faces) read entity state:
//   media  one URL per line (a face with `slot: n` shows line n; a plain media face shows line 0)
//   title  one title per line, maker one maker per line (written by the server's art routes, never by the viewer)
// Videos (.mp4/.webm/.mov/.m4v) loop muted. One <video> per URL is shared by every face that shows it; a video plays
// only while one of its faces is in the scene, within PLAY_M of the camera, facing it, and the page is visible; at most
// MAX_PLAYING play at once (nearest first); a video no face has used for RELEASE_MS is unloaded and its texture freed.
import * as THREE from 'three';
import { frameMediaKind } from '@souls/world-compiler';

export type MediaKind = 'image' | 'video';
export type ArtInfo = { frame: string; slot: number; url: string; kind: MediaKind; title: string; maker: string; broken?: boolean };

/** Accepted media references: http(s) URLs and same-site paths (the shared frame-media rule); never data: or //. */
export const mediaKind = (url: string): MediaKind | null => frameMediaKind(url);
const lineOf = (v: unknown, i: number) => (typeof v === 'string' ? (v.split('\n')[i] ?? '').trim() : '');
/** What one media face of an entity shows. */
export function artOf(frame: string, state: Record<string, unknown>, slot: number | undefined): ArtInfo | null {
  const i = slot ?? 0, url = lineOf(state.media, i), kind = mediaKind(url);
  return kind ? { frame, slot: i, url, kind, title: lineOf(state.title, i), maker: lineOf(state.maker, i) } : null;
}
/** How a maker record reads on hover: `soul:<id>:<name>` (a resident's agent), `creator:<…>` (the world's creator). */
export function makerText(maker: string): string {
  if (!maker) return '';
  const soul = /^soul:[^:]*:(.+)$/.exec(maker); if (soul) return `by ${soul[1]} (a resident)`;
  if (/^creator(:|$)/.test(maker)) { const n = maker.split(':')[2]; return n ? `by ${n} (world creator)` : 'by the world\'s creator'; }
  return `by ${maker}`;
}
export function hoverText(a: Pick<ArtInfo, 'title' | 'maker' | 'kind'>): string {
  const t = a.title || (a.kind === 'video' ? 'Untitled video' : 'Untitled');
  const m = makerText(a.maker);
  return m ? `${t} — ${m}` : t;
}

/** UVs (u0, v0, u1, v1) that show a `media`-shaped picture on a `face`-shaped plane without stretching: the middle
 *  is kept and the overflow cropped (CSS object-fit: cover). */
export function coverUv(media: number, face: number): [number, number, number, number] {
  if (!(media > 0) || !(face > 0) || Math.abs(media - face) < 1e-3) return [0, 0, 1, 1];
  if (media > face) { const w = face / media; return [(1 - w) / 2, 0, (1 + w) / 2, 1]; }
  const h = media / face; return [0, (1 - h) / 2, 1, (1 + h) / 2];
}
/** Crop the plane's UVs to cover once the picture's size is known (an image's load, a video's metadata). Per face, so
 *  one shared texture can fill faces of different shapes. */
export function coverWhenReady(texture: THREE.Texture, geometry: THREE.PlaneGeometry, faceAspect: number) {
  const apply = () => {
    const src = texture.image as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
    const w = src?.videoWidth || src?.naturalWidth || src?.width || 0, h = src?.videoHeight || src?.naturalHeight || src?.height || 0;
    if (!w || !h) return false;
    const [u0, v0, u1, v1] = coverUv(w / h, faceAspect), uv = geometry.attributes.uv as THREE.BufferAttribute;
    // PlaneGeometry order: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); uv.needsUpdate = true;
    return true;
  };
  if (apply()) return;
  const el = texture.image as HTMLElement | undefined;
  if (el && typeof (el as HTMLElement).addEventListener === 'function') { el.addEventListener('loadedmetadata', apply, { once: true }); el.addEventListener('load', apply, { once: true }); }
  else { let tries = 0; const t = setInterval(() => { if (apply() || ++tries > 120) clearInterval(t); }, 250); }   // TextureLoader sets .image only on load
}

// ------------------------------------------------------------------ shared videos

const PLAY_M = 30, MAX_PLAYING = 4, RELEASE_MS = 20_000;
type Entry = { url: string; video: HTMLVideoElement; texture: THREE.VideoTexture; meshes: Map<THREE.Mesh, number>; lastUsed: number; requesting: boolean; retryAt: number; why: string; error: string; failed: boolean; onFail: Set<() => void> };
const videos = new Map<string, Entry>();
let ticking = false;

/** A looping, muted video texture for `url`, shared by every face that shows it. `onFail` runs (once) if the video
 *  cannot be loaded — most often a web host that sends no CORS header, which WebGL needs — so the face can say so
 *  instead of staying black. */
export function videoTexture(url: string, mesh: THREE.Mesh, onFail?: () => void): THREE.Texture {
  let e = videos.get(url);
  if (!e) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'metadata';
    const texture = new THREE.VideoTexture(video); texture.colorSpace = THREE.SRGBColorSpace;
    const entry: Entry = { url, video, texture, meshes: new Map(), lastUsed: performance.now(), requesting: false, retryAt: 0, why: 'new', error: '', failed: false, onFail: new Set() };
    video.addEventListener('error', () => { entry.failed = true; entry.error = entry.error || 'load failed'; for (const f of entry.onFail) f(); entry.onFail.clear(); });
    e = entry; videos.set(url, e);
  }
  if (onFail) { if (e.failed) queueMicrotask(onFail); else e.onFail.add(onFail); }
  e.meshes.set(mesh, performance.now()); e.lastUsed = performance.now();
  startTicker();
  return e.texture;
}

// ------------------------------------------------------------------ images that cannot be shown
const brokenImages = new Set<string>(), loadedImages = new Set<string>();
const imageWaiters = new Map<string, Set<() => void>>();
const imageFallbackListeners = new Set<(url: string) => void>();
/** Observe completed visible replacements, once per failed image request. */
export function onRenderedImageFallback(listener: (url: string) => void): () => void {
  imageFallbackListeners.add(listener);
  return () => { imageFallbackListeners.delete(listener); };
}
/** Whether an image link already failed to load in this page (no CORS header, gone, not an image). */
export const imageBroken = (url: string) => brokenImages.has(url);
/** Call `onFail` once if the image at `url` fails to load (now or later). */
export function whenImageFails(url: string, onFail: () => void) {
  if (brokenImages.has(url)) { queueMicrotask(onFail); return; }
  if (loadedImages.has(url)) return;
  let w = imageWaiters.get(url); if (!w) imageWaiters.set(url, (w = new Set())); w.add(onFail);
}
/** The image loader's error callback for `url`: remember it and tell every face waiting on it. */
export function imageFailed(url: string) {
  brokenImages.add(url);
  const w = imageWaiters.get(url); imageWaiters.delete(url);
  for (const f of w ?? []) f();
  // A failed URL alone is not recovery: every registered face must have
  // installed its replacement successfully before capture can accept it.
  if (w?.size) for (const listener of imageFallbackListeners) listener(url);
}
/** The image loader's success callback: nothing waits on `url` any more. */
export function imageLoaded(url: string) { loadedImages.add(url); imageWaiters.delete(url); }
/** What a face shows instead of a link it cannot load: two short lines naming the host. */
export function brokenLinkLines(url: string): string[] {
  let host = ''; try { host = new URL(url, 'http://same-site.invalid').hostname; } catch { /* keep empty */ }
  return ['Can\'t show this link here', host && host !== 'same-site.invalid' ? host : 'not found'];
}
function inScene(o: THREE.Object3D): boolean { let p: THREE.Object3D | null = o; while (p) { if (!p.visible) return false; if ((p as THREE.Scene).isScene) return true; p = p.parent; } return false; }
const _cam = new THREE.Vector3(), _pos = new THREE.Vector3(), _n = new THREE.Vector3();
/** Play what the camera can see up close; pause the rest; unload what nothing shows. */
export function updateVideos(camera: THREE.Camera | null, now = performance.now()) {
  const page = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  if (camera) camera.getWorldPosition(_cam);
  const want: { e: Entry; d: number }[] = [];
  for (const e of videos.values()) {
    if (e.failed) { if (!e.meshes.size) release(e); else for (const [m, seen] of e.meshes) if (!inScene(m) && now - seen > RELEASE_MS) e.meshes.delete(m); continue; }
    let best = Infinity; e.why = camera ? (page ? 'no face in the scene' : 'page hidden') : 'no camera';
    for (const [m, seen] of e.meshes) {
      if (!inScene(m)) { if (now - seen > RELEASE_MS) e.meshes.delete(m); continue; }
      e.meshes.set(m, now); e.lastUsed = now;
      if (!camera || !page) continue;
      m.getWorldPosition(_pos); const d = _pos.distanceTo(_cam);
      _n.set(0, 0, 1).transformDirection(m.matrixWorld);
      const facing = _n.dot(_cam.clone().sub(_pos)) > 0;
      if (d < PLAY_M && facing) best = Math.min(best, d); else e.why = `${d.toFixed(1)} m${facing ? '' : ', behind'}`;
    }
    if (best < Infinity) want.push({ e, d: best });
    else if (!e.meshes.size && now - e.lastUsed > RELEASE_MS) release(e);
  }
  want.sort((a, b) => a.d - b.d);
  const play = new Set(want.slice(0, MAX_PLAYING).map((w) => w.e));
  for (const e of videos.values()) {
    if (!play.has(e) || e.failed) { if (!e.video.paused) e.video.pause(); continue; }
    e.why = 'near';
    if (e.video.paused && !e.requesting && now >= e.retryAt) { e.requesting = true; void e.video.play().then(() => { e.error = ''; }, (err) => { e.error = String(err?.name ?? err); e.retryAt = performance.now() + 2000; }).finally(() => { e.requesting = false; }); }
  }
}
function release(e: Entry) { e.onFail.clear(); e.failed = true; e.video.pause(); e.video.removeAttribute('src'); e.video.load(); e.texture.dispose(); videos.delete(e.url); }
function startTicker() {
  if (ticking || typeof window === 'undefined') return; ticking = true;
  setInterval(() => { const cam = (window as unknown as { __soulsEntity?: { camera?: THREE.Camera } }).__soulsEntity?.camera ?? null; try { updateVideos(cam); } catch { /* mid-reload */ } }, 250);
}
/** For tests and proof: every shared video and whether it is playing. */
export function videoState() { return [...videos.values()].map((e) => ({ url: e.url, faces: e.meshes.size, playing: !e.video.paused, readyState: e.video.readyState, time: +e.video.currentTime.toFixed(2), why: e.why, error: e.error, failed: e.failed })); }
/** For proof: image links that failed to load in this page. */
export const brokenImageState = () => [...brokenImages];
