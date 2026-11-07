// VOCAB-MECH: lazy GLB fetch for worlds with many imported types. Measured (tools/god-skill/scripts/vocab-payload.mjs):
// one of every core point def = 187 GLBs, 87 MB; before this, a viewer downloaded all of it before the world was
// usable. Now:
//   - the snapshot plans an EAGER set: the GLBs of things nearest the arrival (the world's centre), up to ~24 MB; the
//     loading bar expects only those;
//   - after arrival, nearby GLBs load in view-first, nearest-first order, two asset SHAs at a time through attachment;
//     after a short delay, far assets join the same queue so the complete world fills in;
//   - `?shot` pages (god `look`, thumbnails) and `?assets=eager` load everything at once, as before.
// Content-addressed URLs stay immutable (/assets/<sha>.glb): each GLB is fetched once per browser, whenever it is.
import * as THREE from 'three';
import type { Entity, StoredDef } from '@souls/world-compiler';
import { meshLodAsset, type LodMake } from './mesh-lod.ts';
import { browserQuality, progressiveNearM } from '../quality-tier.ts';

const qs = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const LAZY = !qs.has('shot') && qs.get('assets') !== 'eager';
// P1 phones: a phone (quality tier) holds the arrival card for at most ~0.2 MB of the nearest GLBs and 3 s; the rest fills
// in after the card. On a Slow 4G link (~180 KB/s) 24 MB / 30 s kept a phone on the card for the full 30 s. t4-phone-new:
// each 0.2 MB a phone's poster waits for is ~1 s on Slow 4G (wire4g ~200 KB/s, after the page's own scripts). With 1 MB,
// Mars College 2026 gated chiba (766 KB), which never arrived inside the gate, and every poster waited the full 3 s;
// 0.5 MB (no chiba) 5.8 s, 0.2 MB 4.95 s with the same poster as 1 MB (pinned-clock diff). ?eagerMB still wins.
const PHONE = browserQuality().tier === 'phone';
export const EAGER_BYTES = Math.max(0.1, Number(qs.get('eagerMB') ?? (PHONE ? 0.2 : 24))) * 1e6;
export const NEAR_M = 120;
const BACKGROUND_DELAY_MS = 6000, BACKGROUND_PARALLEL = 2;
const QUEUED = qs.get('loadqueue') !== '0'; // same-bundle A/B against the legacy near-camera burst

type LoadPriority = readonly [tier: number, distance: number];
type QueuedLoad = { start: () => unknown | Promise<unknown>; priority: () => LoadPriority | null };
/** One slot per asset SHA, held until every waiting copy has finished attaching (or failed). Priorities are read when
 * a slot becomes free, so walking/orbiting changes the next choice rather than freezing the original order. */
export class DeferredLoadQueue {
  private pending = new Map<string, Set<QueuedLoad>>();
  private active = new Map<string, object>();
  private scheduled = false;
  private parallel: number;
  constructor(parallel = BACKGROUND_PARALLEL) { this.parallel = parallel; }
  add(sha: string, load: QueuedLoad): () => void {
    let copies = this.pending.get(sha); if (!copies) this.pending.set(sha, (copies = new Set()));
    copies.add(load);
    return () => { const list = this.pending.get(sha); list?.delete(load); if (!list?.size) this.pending.delete(sha); };
  }
  stats() { return { pending: this.pending.size, active: this.active.size }; }
  /** A viewer remount abandons its old jobs even if a terminated decode worker never settles its promise. */
  reset() { this.pending.clear(); this.active.clear(); }
  pump() {
    if (this.scheduled) return;
    this.scheduled = true;
    // Collect this frame's hooks before ranking: traversal order is not distance order.
    queueMicrotask(() => {
      this.scheduled = false;
      while (this.active.size < this.parallel) {
        let best: string | null = null, rank: LoadPriority | null = null;
        for (const [sha, copies] of this.pending) for (const load of copies) {
          if (this.active.has(sha)) continue;
          const p = load.priority();
          if (p && (!rank || p[0] < rank[0] || p[0] === rank[0] && p[1] < rank[1])) { best = sha; rank = p; }
        }
        if (best === null) break;
        const sha = best, copies = this.pending.get(sha)!, token = {}; this.pending.delete(sha); this.active.set(sha, token);
        void Promise.allSettled([...copies].map((load) => Promise.resolve().then(load.start))).then(() => {
          // An abandoned generation may finish after a new job for the same SHA has already claimed this slot.
          if (this.active.get(sha) !== token) return;
          this.active.delete(sha); this.pump();
        });
      }
    });
  }
}
const loadQueue = new DeferredLoadQueue();
let backgroundReady = false;
const inFlight = new Set<Promise<unknown>>();

let eager: Set<string> | null = null;            // null: no plan, everything is eager
const waiting = new Map<string, { start: () => void; at: THREE.Vector3 }[]>();
const started = new Set<string>();
const camera = new THREE.Vector3(0, 30, 60);
let background: ReturnType<typeof setTimeout> | null = null, running = 0;

// only the GLB the mesh half loads (make.asset): a mesh def also names its server-side `footprint` sha, which the viewer
// never fetches; counting it held the arrival card for nothing and put phantom MB on the loading bar (lane PERF)
// Z2: a def with a distant version (make.lod1) counts the one GLB the renderer will draw at that distance (mesh-lod.ts)
const shasOf = (d: StoredDef | undefined, distance = 0, scale = 1) => { const a = d && d.make.kind === 'mesh' ? meshLodAsset(d.make as LodMake, d.size.box, distance, scale) : null; return typeof a === 'string' && /^[0-9a-f]{64}$/.test(a) ? [a] : []; };

/** Choose the eager GLBs for a snapshot: nearest-first to `centre` until EAGER_BYTES. Returns the loading bar's sizes. */
export function planEager(snap: { entities: Entity[]; assetBytes?: Record<string, number> }, defOf: (ref: string) => StoredDef | undefined, posOf: (e: Entity) => [number, number] | null, centre: [number, number] = [0, 0], eye?: [number, number], seen?: (e: Entity) => boolean): Record<string, number> {
  // Called once by a new entity layer, before its holders are built. Old loader/worker promises do not own its slots.
  loadQueue.reset(); waiting.clear(); inFlight.clear(); started.clear(); backgroundReady = false;
  if (background) { clearTimeout(background); background = null; }
  // lane PERF: with the arrival eye known, rank by how big a thing looks from it: distance from the eye over the thing's
  // size, for things in front (a 60° half-cone towards the centre); things behind the camera come last. Measured on
  // littlemartians-two at 60 Mbit/s: nearest-the-centre left the foreground bare, nearest-the-eye the plaza's towers.
  const fx = centre[0] - (eye?.[0] ?? 0), fz = centre[1] - (eye?.[1] ?? 0), fl = Math.hypot(fx, fz) || 1;
  const score = (x: number, z: number) => {
    if (!eye) return Math.hypot(x - centre[0], z - centre[1]);
    const dx = x - eye[0], dz = z - eye[1], d = Math.hypot(dx, dz);
    return d < 15 || (dx * fx + dz * fz) / (d * fl) > 0.5 ? d : d + 1000;
  };
  const sizes = snap.assetBytes ?? {};
  // the alternate GLB of a two-model def is in the bar only when it is the one drawn from here
  const lodOnly = new Set(snap.entities.flatMap((e) => { const m = defOf(e.def)?.make as LodMake & { kind?: string } | undefined; return m?.kind === 'mesh' && m.lod1 ? [m.asset, m.lod1] : []; }));
  // t4-phone: only mesh defs carry GLBs, so nothing else is posed (a world pose walks the parent chain and slots; on Eden
  // 2026 posing all ~4,900 things twice was ~0.3 s of a 4x phone's arrival)
  const from = eye ?? centre, shaFor = (e: Entity, p: [number, number] | null | undefined = undefined) => { const d = defOf(e.def); if (!d || d.make.kind !== 'mesh') return []; if (p === undefined) p = posOf(e); return shasOf(d, p ? Math.hypot(p[0] - from[0], p[1] - from[1]) : Infinity, e.s ?? 1); };
  if (!LAZY) { eager = null; const used = new Set(snap.entities.flatMap((e) => shaFor(e))); return Object.fromEntries(Object.entries(sizes).filter(([sha]) => used.has(sha) || !lodOnly.has(sha))); }
  // P1 phones: the first build draws only what is within `near` of the eye or centre before the card (WorldEntityLayer),
  // so the eager set (whose things the card waits to see drawn) stays inside that radius too
  const near = progressiveNearM(), ndist = new Map<string, number>();
  const dist = new Map<string, number>(), rank = new Map<string, number>();
  for (const e of snap.entities) {
    const def = defOf(e.def); if (!def || def.make.kind !== 'mesh') continue;
    if (seen && !seen(e)) continue;   // t4-phone-new: out of the arrival camera's view (WorldEntityLayer, arrival-view.ts)
    const p = posOf(e), shas = shaFor(e, p); if (!shas.length) continue;
    const d = p ? score(p[0], p[1]) : 1e9, size = Math.max(1, ...((def?.size?.box as number[] | undefined) ?? [1]).map((v) => v * (e.s ?? 1)));
    const nd = p ? Math.min(Math.hypot(p[0] - centre[0], p[1] - centre[1]), eye ? Math.hypot(p[0] - eye[0], p[1] - eye[1]) : Infinity) : 0;
    for (const sha of shas) { ndist.set(sha, Math.min(ndist.get(sha) ?? Infinity, nd)); dist.set(sha, Math.min(dist.get(sha) ?? Infinity, d)); rank.set(sha, Math.min(rank.get(sha) ?? Infinity, eye ? d / size : d)); }
  }
  const order = [...rank.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!);
  // a desktop always takes its first model; on a phone a model bigger than the budget left never holds the gate (t4-phone-new)
  const pick = new Set<string>(); let bytes = 0;
  for (const sha of order) { const n = sizes[sha] ?? 0; if (near !== null && ndist.get(sha)! > near) continue; if ((pick.size || PHONE) && (bytes + n > EAGER_BYTES || dist.get(sha)! > NEAR_M * 2)) continue; pick.add(sha); bytes += n; }
  eager = pick; plannedEye = eye ?? centre;
  // lane PERF: the arrival card waits for these (or GATE_MS), so a new world opens with what is in front of you drawn
  eagerLeft.clear(); for (const sha of pick) eagerLeft.add(sha);
  gateUntil = performance.now() + GATE_MS; setTimeout(notifyGate, GATE_MS + 50); notifyGate();
  scheduleBackground();
  return Object.fromEntries(Object.entries(sizes).filter(([sha]) => pick.has(sha)));
}
/** The arrival gate (lane PERF): true while the eager GLBs (nearest the arrival) are not yet drawn, for at most GATE_MS.
 *  ViewerFrame keeps the arrival card (and its byte bar) up meanwhile. Old worlds never plan, so it is always false. */
const GATE_MS = PHONE ? 3_000 : 30_000;
const eagerLeft = new Set<string>(); let gateUntil = 0;
const gateListeners = new Set<() => void>();
function notifyGate() { for (const f of gateListeners) f(); }
export const arrivalGate = {
  pending: (): boolean => LAZY && eagerLeft.size > 0 && performance.now() < gateUntil,
  subscribe(fn: () => void) { gateListeners.add(fn); return () => { gateListeners.delete(fn); }; },
  left: () => [...eagerLeft],
};
if (typeof window !== 'undefined') (window as unknown as { __arrivalGate?: unknown }).__arrivalGate = arrivalGate;   // probes
/** A model is in the scene (or its placeholder, when it failed): it no longer holds the arrival card. */
export function assetShown(sha: string) { if (eagerLeft.delete(sha) && !eagerLeft.size) notifyGate(); }
export const isEager = (sha: string) => !LAZY || !eager || eager.has(sha) || started.has(sha);
let plannedEye: [number, number] | null = null;
/** t4-phone-new: where the eager plan measured distances from (the arrival eye), or null without a plan. A two-model def
 *  (make.lod1) starts the model the plan chose from there at once (mesh.mesh.ts): it used to wait for the first drawn frame,
 *  which a phone's early poster only draws after the gate, so its eager GLB held the poster for the whole GATE_MS. */
export const plannedArrivalEye = (): [number, number] | null => (LAZY && eager ? plannedEye : null);
/** The planned eager GLBs, nearest the arrival first (empty without a plan: then every load starts as its thing draws). */
export const eagerShas = (): string[] => (LAZY && eager ? [...eager] : []);

/** Defer one thing's GLB load: returns an invisible hook to add to the thing's group. `start` runs once when the queue
 * reaches it (near and in-view first), and its promise holds the slot through attachment. `owner` cancels on removal. */
export function deferLoad(sha: string, start: () => unknown | Promise<unknown>, makeHook: (fn: (cam: THREE.Camera) => void) => THREE.Object3D, owner?: THREE.Object3D): THREE.Object3D {
  let done = false;
  const at = new THREE.Vector3(), projected = new THREE.Vector3();
  let sampled = false, near = false, visible = false, distance = Infinity;
  // once started the hook has done its job: leave the scene (lane PERF: one no-op draw fewer per thing, every frame)
  const go = () => {
    if (done) return;
    done = true; started.add(sha);
    const work = Promise.resolve().then(start); inFlight.add(work);
    void work.then(() => inFlight.delete(work), () => inFlight.delete(work));
    queueMicrotask(() => hook.removeFromParent());
    return work;
  };
  const entry = { start: go, at };
  const list = waiting.get(sha) ?? []; list.push(entry); waiting.set(sha, list);
  const cancel = QUEUED ? loadQueue.add(sha, { start: go, priority: () => {
    if (done || arrivalGate.pending()) return null;
    if (!sampled) {
      // Hidden interiors never draw their hooks. They still join the background corpus, using their current anchor.
      if (!backgroundReady) return null;
      if (owner) owner.getWorldPosition(at);
      return [2, owner ? at.distanceTo(camera) : Infinity];
    }
    return near ? [visible ? 0 : 1, distance] : backgroundReady ? [2, distance] : null;
  } }) : null;
  const hook = makeHook((cam) => {
    if (done) return;
    hook.getWorldPosition(at); camera.copy(cam.position);
    // while the arrival card waits on the eager set, the rest waits too: the eager GLBs get the whole link (lane PERF)
    if (QUEUED) {
      sampled = true; distance = at.distanceTo(cam.position); near = distance < NEAR_M;
      projected.copy(at).project(cam);
      visible = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
      loadQueue.pump();
    } else if (started.has(sha) || (at.distanceTo(cam.position) < NEAR_M && !arrivalGate.pending())) void go();
  });
  const remove = () => {
    done = true; cancel?.();
    const l = waiting.get(sha); if (l) { const i = l.indexOf(entry); if (i >= 0) l.splice(i, 1); if (!l.length) waiting.delete(sha); }
    hook.removeEventListener('removed', remove); owner?.removeEventListener('removed', remove);
  };
  hook.addEventListener('removed', remove); owner?.addEventListener('removed', remove);
  return hook;
}

/** After the eager set, fetch the rest a few at a time, nearest to the camera first. */
function scheduleBackground() {
  if (QUEUED && backgroundReady) { loadQueue.pump(); return; }
  if (background) clearTimeout(background);
  background = setTimeout(function tick() {
    background = null;
    if (arrivalGate.pending()) { background = setTimeout(tick, 500); return; }
    if (QUEUED) { backgroundReady = true; loadQueue.pump(); return; }
    while (running < BACKGROUND_PARALLEL && waiting.size) {
      let best: string | null = null, bd = Infinity;
      for (const [sha, list] of waiting) for (const w of list) { const d = w.at.lengthSq() ? w.at.distanceTo(camera) : 1e9; if (d < bd) { bd = d; best = sha; } }
      if (!best) break;
      const list = waiting.get(best)!; waiting.delete(best); running++;
      for (const w of list) w.start();
      setTimeout(() => { running--; }, 1500);   // the loadAsset promise is per sha; pace by time, not by completion
    }
    if (waiting.size) background = setTimeout(tick, 1500);
  }, BACKGROUND_DELAY_MS);
}
/** New things after arrival (a god's edit) follow the same rule; a deferred thing re-arms the background loader. */
export function noteDeferred() { if (LAZY && !background) scheduleBackground(); }

/** Probe settling must include the complete deferred corpus, not a temporary plateau in triangle count. */
if (typeof window !== 'undefined') (window as unknown as { __soulsLoadQueueStats?: unknown }).__soulsLoadQueueStats = () => ({ enabled: QUEUED, pending: waiting.size, activeCopies: inFlight.size, active: loadQueue.stats().active });
