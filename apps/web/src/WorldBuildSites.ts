// Construction overlays own all of their GPU resources. Never pass these through disposeObject.
import * as THREE from 'three';
import type { Entity, OBB, WorldModel } from '@souls/world-compiler';
import { clockMs } from './atmosphere/weather.ts';
import { worldTimeText } from './world-clock.ts';

export type Mass = { name?: string; at: [number, number]; size: [number, number]; h: number; yaw?: number; roof?: 'flat' | 'gable' | 'pyramid' };
export type PublicSite = {
  id: string; title: string; status: 'active' | 'paused' | 'done' | 'abandoned'; rev: number; lastAt: number; pauseAfterMs: number; closed: boolean;
  step: { n: number; label: string; of: number }; site: { at: [number, number]; size: [number, number]; yaw: number };
  massing: Mass[]; roots: string[]; claims: { part: string; status: 'held' | 'stale' | 'released' | 'done' | 'taken'; root?: string }[];
  say?: { text: string; at: number }; designing?: string[]; note?: { text: string; at: number }; reopensAt?: number;
  /** CE8: the lead's latest look target (server time t); shown as a reticle for ~20 s. */
  attention?: Attention;
};
export type Attention = { at: [number, number, number]; eye?: [number, number, number]; t: number };
export type SiteDelta = Pick<PublicSite, 'id' | 'rev' | 'status' | 'lastAt'> & Partial<Pick<PublicSite, 'say' | 'designing' | 'note' | 'reopensAt' | 'attention'>> & {
  closed?: boolean; step?: PublicSite['step']; claim?: PublicSite['claims'][number]; rootsAdded?: string[]; rootsRemoved?: string[];
};
type SiteRecord = PublicSite | SiteDelta;
/** `attention` feeds carry the site's current rev and are applied outside the rev sequence. */
type Feed = { reset: boolean; records: SiteRecord[]; rev: number; now?: number; attention?: boolean };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const revision = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const timedText = (v: unknown) => record(v) && typeof v.text === 'string' && finite(v.at);
const point3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(finite);
const isAttention = (v: unknown): v is Attention => record(v) && point3(v.at) && (v.eye === undefined || point3(v.eye)) && finite(v.t);
const isSiteRecord = (v: unknown): v is SiteRecord => record(v) && typeof v.id === 'string' && revision(v.rev) && finite(v.lastAt) && ['active', 'paused', 'done', 'abandoned'].includes(String(v.status))
  && (v.say === undefined || timedText(v.say)) && (v.note === undefined || timedText(v.note))
  && (v.designing === undefined || (Array.isArray(v.designing) && v.designing.length <= 8 && v.designing.every(n => typeof n === 'string')))
  && (v.reopensAt === undefined || finite(v.reopensAt)) && (v.attention === undefined || isAttention(v.attention));
const fullSite = (v: SiteRecord): v is PublicSite => 'site' in v && 'massing' in v && 'roots' in v;

/** The only wire-shape adapter. Revision 2 uses builds[] on diffs, site/delta on world-build,
 * buildsRev on snapshots, and rev on GET /v1/world/builds. Singular build is the V1-brief alias. */
export function parseBuildFeed(input: unknown, now?: number): Feed | null {
  if (Array.isArray(input)) return { reset: false, records: input.filter(isSiteRecord), rev: 0, now };
  if (!record(input)) return null;
  const clock = finite(input.now) ? input.now : finite(input.at) ? input.at : now;
  if (input.kind === 'world-build') {
    const site = input.site ?? input.delta;
    if (!isSiteRecord(site) || !revision(input.rev) || site.rev !== input.rev) return null;
    if (input.event === 'attention') return site.attention ? { reset: false, records: [site], rev: input.rev, now: clock, attention: true } : null;
    return { reset: false, records: [site], rev: input.rev, now: clock };
  }
  if (input.kind === 'world-diff') {
    const entries = input.builds ?? (input.build ? [input.build] : []);
    return Array.isArray(entries) ? { reset: false, records: entries.filter(isSiteRecord), rev: 0, now: clock } : null;
  }
  if (Array.isArray(input.builds)) {
    const rev = input.buildsRev ?? input.rev;
    if (!revision(rev) || !input.builds.every(v => isSiteRecord(v) && fullSite(v))) return null;
    return { reset: true, records: input.builds, rev, now: clock };
  }
  return null;
}

export type SiteModel = Pick<WorldModel, 'entities' | 'subtree' | 'worldPose' | 'footprintsOf'>;
type Options = {
  model: () => SiteModel | null; groundAt: (x: number, z: number) => number | null;
  fetchBuilds?: () => Promise<unknown>; now?: () => number; createCanvas?: () => HTMLCanvasElement; search?: string;
  /** Default: the viewer's prefers-reduced-motion media query (live). */
  reducedMotion?: () => boolean;
};
type VertexRange = { start: number; count: number };
type Member = { root: string; mask: number; boxes: OBB[] };
type View = {
  data: PublicSite; roots: Set<string>; group: THREE.Group;
  marker: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** The site's ground outline: depth-tested, so a building in front of it hides it (G2). */
  ground: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  faces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; ranges: VertexRange[]; edgeRanges: VertexRange[];
  parts: number[]; coverage: number[]; members: Map<string, Member>; reindex: boolean;
  label: THREE.Sprite | null; canvas: HTMLCanvasElement | null; text: string; labelY: number;
  wheel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  sheen: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  deadline: number; receivedAt: number; silence: number; pausedAt: number; paused: boolean; nextLabelAt: number;
  sayUntil: number; noteUntil: number; reopenDeadline: number; designingActive: boolean;
  captionAlpha: { value: number }; captionTop: { value: number };
  /** G2 build-chip gear: canvas-pixel centre x, y and radius (0 = none) and the canvas size, for the rotating sample. */
  gear: boolean; chipGear: { value: THREE.Vector3 }; chipSize: { value: THREE.Vector2 };
  /** CE8 reticle: one sprite, created on the first hint; gazeUntil is the local-clock end of the fade. */
  gaze: THREE.Sprite | null; gazeT: number; gazeUntil: number; gazePulse: number;
};
const ACTIVE = new THREE.Color('#ffc05c'), PAUSED = new THREE.Color('#999fa8');
const MARKER_ALPHA = 0.95, FAINT_EDGE_ALPHA = 0.06, COVERAGE_GRID = 8; // 64 sampled columns per mass
const MINUTE = 60_000, QUIET_MS = 3 * MINUTE, SAY_MS = 8 * MINUTE, NOTE_MS = 6000;
const LABEL_FONT_PX = 28, LABEL_HEIGHT_PX = 44, LABEL_MIN_TEXT_PX = 14, LABEL_WORLD_HEIGHT = 1.2;
export const SITE_REFINEMENT = { scale: 0.9, seconds: 1.2, removalDelaySeconds: 2.5 * 0.6 } as const;
/** CE8: a small mark where the builder last looked (its `look`/`where` target): full for 14 s, faded out by 20 s.
 * G2 (Gene, 2026-10-17): always a fixed `px` across on screen. It used to ring the whole framed area (up to 60 m),
 * which read as a giant crosshair over the build. */
export const GAZE = { ttlMs: 20_000, fadeMs: 6000, alpha: 0.7, px: 22, pulse: 0.06 } as const;
const STYLES = ['ring', 'label', 'outline', 'sheen', 'wheel'] as const;
type Style = typeof STYLES[number];

export class WorldBuildSites {
  readonly group = new THREE.Group();
  maxRev = 0;
  readonly stats = { applied: 0, refetches: 0, labelRedraws: 0, lastError: null as string | null };
  private views = new Map<string, View>();
  private styles = new Set<Style>();
  private options: Options;
  private clock: () => number;
  private initialized = false;
  private disposed = false;
  private generation = 0;
  private pending = new Map<number, { item: SiteRecord; now?: number; receivedAt: number }>();
  private fetching: Promise<void> | null = null;
  private retryAt = 0;
  private time = { value: 0 };
  private pulse = { value: 1 };
  /** G2: the build-chip gear angle, shared by every chip; frozen under reduced motion. */
  private spin = { value: 0 };
  private worldMs = NaN;
  private worldAt = 0;
  private worldRate = 1;
  private activeSheen: THREE.ShaderMaterial | null = null;
  private pausedSheen: THREE.ShaderMaterial | null = null;
  private viewport = new THREE.Vector2();
  private gazing = new Set<View>();
  private gazeTexture: THREE.CanvasTexture | null = null;
  private seenAttention = new WeakSet<object>();
  private reducedMotion: () => boolean;

  constructor(options: Options) {
    this.options = options; this.clock = options.now ?? (() => performance.now());
    const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = options.reducedMotion ?? (() => motion?.matches ?? false);
    this.group.name = 'build-sites'; this.group.userData.cameraTransparent = true;
    this.siteStyle(new URLSearchParams(options.search ?? (typeof location === 'undefined' ? '' : location.search)).get('sites') ?? 'ring,label');
  }

  /** Runtime screenshot/perf switch. `off` suppresses all effects, including refinement. */
  siteStyle(style: string) {
    this.styles.clear();
    for (const s of style.split(',')) if ((STYLES as readonly string[]).includes(s.trim())) this.styles.add(s.trim() as Style);
    this.group.visible = this.styles.size > 0;
    for (const v of this.views.values()) { this.refit(v); this.refresh(v, this.clock()); }
    return [...this.styles].join(',') || 'off';
  }

  reset(builds: PublicSite[], buildsRev = 0, now?: number) {
    if (this.disposed || !revision(buildsRev) || buildsRev < this.maxRev || (this.initialized && buildsRev === this.maxRev)) return;
    this.initialized = true; this.generation++; this.maxRev = buildsRev;
    const keep = new Set(builds.filter(b => b.status === 'active' || b.status === 'paused').map(b => b.id));
    for (const [id, v] of this.views) if (!keep.has(id)) { this.release(v); this.views.delete(id); }
    for (const b of builds) if (keep.has(b.id)) this.put(structuredClone(b), now);
    for (const rev of this.pending.keys()) if (rev <= buildsRev) this.pending.delete(rev);
    this.drain();
    // Buffered diff geometry may already be installed when its roots delta is replayed.
    for (const v of this.views.values()) if (v.reindex) { this.countParts(v); this.refit(v); }
  }

  apply(input: unknown, now?: number) {
    if (this.disposed) return;
    // The layer replays its whole edge buffer every frame; an attention message is parsed once.
    if (record(input) && input.event === 'attention') { if (this.seenAttention.has(input)) return; this.seenAttention.add(input); }
    const feed = parseBuildFeed(input, now); if (!feed) return;
    if (feed.attention) { for (const item of feed.records) { const v = this.views.get(item.id); if (v && item.attention) this.attend(v, item.attention, feed.now); } return; }
    if (feed.reset) { this.reset(feed.records as PublicSite[], feed.rev, feed.now); return; }
    for (const item of feed.records) {
      if (item.rev <= this.maxRev) continue;
      if (item.rev !== this.maxRev + 1 || (!fullSite(item) && !this.views.has(item.id) && item.status !== 'done' && item.status !== 'abandoned')) {
        if (!this.pending.has(item.rev)) this.pending.set(item.rev, { item, now: feed.now, receivedAt: this.clock() });
        void this.resync(); continue;
      }
      this.commit(item, feed.now); this.drain();
    }
  }

  /** Also used by the existing 20-second seq poll to catch a lost final message. */
  checkRevision(rev: unknown) { if (revision(rev) && rev > this.maxRev) void this.resync(); }
  resync(): Promise<void> {
    if (this.disposed || this.fetching || !this.options.fetchBuilds || this.clock() < this.retryAt) return this.fetching ?? Promise.resolve();
    const generation = this.generation;
    this.stats.refetches++;
    this.fetching = Promise.resolve().then(() => this.options.fetchBuilds!()).then(input => {
      if (this.disposed || generation !== this.generation) return;
      const feed = parseBuildFeed(input);
      if (!feed?.reset || feed.rev < this.maxRev) throw Error('Invalid or stale build snapshot');
      this.reset(feed.records as PublicSite[], feed.rev, feed.now);
      // A response can predate the newest buffered delta. Do not refetch every frame.
      if (this.pending.size) this.retryAt = this.clock() + 20_000;
      this.stats.lastError = null;
    }).catch(e => { if (!this.disposed) { this.stats.lastError = String(e); this.retryAt = this.clock() + 20_000; } }).finally(() => { this.fetching = null; });
    return this.fetching;
  }

  private drain() {
    for (;;) {
      const next = this.pending.get(this.maxRev + 1); if (!next) break;
      if (!fullSite(next.item) && !this.views.has(next.item.id) && next.item.status !== 'done' && next.item.status !== 'abandoned') break;
      this.pending.delete(next.item.rev);
      this.commit(next.item, next.now === undefined ? undefined : next.now + this.clock() - next.receivedAt);
    }
  }
  private commit(item: SiteRecord, now?: number) {
    this.maxRev = item.rev; this.initialized = true; this.stats.applied++;
    const old = this.views.get(item.id);
    if (item.status === 'done' || item.status === 'abandoned') { if (old) { this.release(old); this.views.delete(item.id); } return; }
    if (fullSite(item)) { this.put(structuredClone(item), now); return; }
    if (!old) return;
    const b = old.data;
    b.rev = item.rev; b.status = item.status; b.lastAt = item.lastAt;
    if (item.closed !== undefined) b.closed = item.closed;
    if (item.say !== undefined) b.say = { ...item.say };
    if (item.note !== undefined) b.note = { ...item.note };
    if (item.designing !== undefined) b.designing = [...item.designing];
    if (item.reopensAt !== undefined) b.reopensAt = item.reopensAt;
    if (item.step) b.step = { ...item.step };
    if (item.claim) { const i = b.claims.findIndex(c => c.part === item.claim!.part); if (i < 0) b.claims.push({ ...item.claim }); else b.claims[i] = { ...item.claim }; }
    if (item.rootsAdded?.length || item.rootsRemoved?.length) {
      for (const id of item.rootsRemoved ?? []) old.roots.delete(id);
      for (const id of item.rootsAdded ?? []) old.roots.add(id);
      b.roots = [...old.roots]; old.reindex = true;
    }
    if (item.attention) this.attend(old, item.attention, now);
    this.setClock(old, now); this.tint(old); this.refresh(old, this.clock());
    if (old.wheel && this.styles.has('wheel')) this.wheel(old);
  }

  /** Uses the PRE-batch roots/model. Must run before apply and before model.delete. */
  heldRemovals(input: unknown, model: SiteModel): Set<string> {
    const held = new Set<string>(); if (!this.styles.size || !record(input) || !record(input.diff) || !Array.isArray(input.diff.removes)) return held;
    const touched = new Set(parseBuildFeed(input)?.records.map(b => b.id));
    for (const id of input.diff.removes) {
      if (typeof id !== 'string') continue;
      const e = model.entities.get(id), site = e && this.memberOf(e, model);
      if (site && touched.has(site.id)) held.add(id);
    }
    return held;
  }
  memberOf(entity: Entity, model: SiteModel = this.options.model()!): PublicSite | null {
    if (!model) return null;
    for (const v of this.views.values()) if (!v.paused && v.data.status === 'active' && this.rootOf(entity, v, model)) return v.data;
    return null;
  }
  refinement(entity: Entity, model: SiteModel) { return this.styles.size && this.memberOf(entity, model) ? SITE_REFINEMENT : null; }
  private rootOf(entity: Entity, v: View, model: SiteModel): string | null {
    let e: Entity | undefined = entity;
    for (let depth = 0; e && depth <= model.entities.size; depth++) {
      if (v.roots.has(e.id)) return e.id;
      if (e.in.parent === 'world') break;
      e = model.entities.get(e.in.parent);
    }
    return null;
  }

  /** Called after the model has installed ALL upserts. Only sites carrying a delta are recounted. */
  refitDiff(input: unknown) {
    if (!record(input) || !record(input.diff)) return;
    const diff = input.diff as { upserts?: Entity[]; removes?: string[] };
    for (const b of parseBuildFeed(input)?.records ?? []) {
      const v = this.views.get(b.id); if (!v) continue;
      this.countParts(v, diff); this.refit(v);
    }
  }
  refreshAll(groundChanged = false) {
    for (const v of this.views.values()) {
      if (groundChanged) { const mass = massGeometry(v.data, this.options.groundAt); v.faces.geometry.dispose(); v.faces.geometry = mass.geometry; v.ranges = mass.ranges; }
      v.reindex = true; this.countParts(v); this.refit(v);
    }
  }

  update(nowMs: number) {
    // No geometries, canvases, vectors or strings are allocated on ordinary frames.
    if (!this.styles.size) return;
    this.pulse.value = 0.8 + 0.2 * Math.sin(nowMs / 450);
    this.spin.value = this.reducedMotion() ? 0 : (nowMs / 1000 * GEAR_TURNS_PER_SECOND % 1) * Math.PI * 2;
    if (this.styles.has('sheen')) this.time.value = nowMs / 1000;
    for (const v of this.views.values()) {
      v.captionAlpha.value = Math.max(0, Math.min(1, (v.noteUntil - nowMs) / 2000));
      if (nowMs >= v.nextLabelAt) this.refresh(v, nowMs);
    }
    // Only sites with a fresh look are visited; an expired reticle stops drawing and leaves the set.
    if (this.gazing.size) { const still = this.reducedMotion(); for (const v of this.gazing) this.gazeFrame(v, nowMs, still); }
  }

  /** CE8: show where the lead is looking. Older hints (by server time) never replace newer ones. */
  private attend(v: View, attention: Attention, now?: number) {
    if (attention.t <= v.gazeT) return;
    v.gazeT = attention.t; v.data.attention = { at: [...attention.at], ...(attention.eye ? { eye: [...attention.eye] } : {}), t: attention.t };
    const receivedAt = this.clock(); v.gazeUntil = receivedAt + attention.t + GAZE.ttlMs - (now ?? Date.now());
    if (v.gazeUntil <= receivedAt) { if (v.gaze) v.gaze.visible = false; this.gazing.delete(v); return; }
    const sprite = v.gaze ?? this.gazeSprite(v);
    sprite.position.set(attention.at[0], attention.at[1] + 0.05, attention.at[2]);
    this.gazing.add(v); this.gazeFrame(v, receivedAt, this.reducedMotion());
  }
  private gazeFrame(v: View, nowMs: number, still: boolean) {
    const sprite = v.gaze!, left = v.gazeUntil - nowMs;
    if (left <= 0) { sprite.visible = false; this.gazing.delete(v); return; }
    sprite.visible = true; sprite.material.opacity = GAZE.alpha * Math.min(1, left / GAZE.fadeMs);
    v.gazePulse = still ? 1 : 1 + GAZE.pulse * Math.sin(nowMs / 700);
  }
  private gazeSprite(v: View) {
    if (!this.gazeTexture) {
      const canvas = this.options.createCanvas?.() ?? document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const stroke = (style: string, width: number, path: () => void) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); path(); ctx.stroke(); };
        const shape = () => { ctx.arc(64, 64, 42, 0, Math.PI * 2); for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { ctx.moveTo(64 + dx * 26, 64 + dz * 26); ctx.lineTo(64 + dx * 36, 64 + dz * 36); } };
        // A dark halo keeps the soft white ring legible on snow, sand and sky.
        stroke('rgba(20,20,20,0.35)', 11, shape); stroke('rgba(255,248,232,0.95)', 5, shape);
        ctx.fillStyle = 'rgba(255,248,232,0.95)'; ctx.beginPath(); ctx.arc(64, 64, 4, 0, Math.PI * 2); ctx.fill();
      }
      this.gazeTexture = new THREE.CanvasTexture(canvas); this.gazeTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.gazeTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 }));
    sprite.name = 'build-gaze'; sprite.renderOrder = 999; sprite.frustumCulled = false; sprite.visible = false;
    sprite.onBeforeRender = (renderer, _scene, camera) => {
      const m = sprite.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
      const depth = Math.max(0.01, -(view[2] * m[12] + view[6] * m[13] + view[10] * m[14] + view[14]));
      const height = renderer.getSize(this.viewport).y;
      const unitsPerPixel = 2 * (camera instanceof THREE.PerspectiveCamera ? depth : 1) / (Math.max(1, height) * camera.projectionMatrix.elements[5]);
      const size = GAZE.px * unitsPerPixel * v.gazePulse;
      sprite.scale.set(size, size, 1); sprite.updateMatrixWorld();
    };
    v.gaze = sprite; v.group.add(sprite); this.tag(v);
    return sprite;
  }

  /** The real depicted world clock and its world-ms/real-ms rate; never the shot-hour clock. */
  setWorldClock(iso: string | null, rate = 1) {
    const now = this.clock();
    const nextRate = finite(rate) && rate >= 0 ? rate : 1;
    // The projection runs between clock samples. Ordinary frames do not parse dates or allocate strings.
    if (iso && Number.isFinite(this.worldMs) && nextRate === this.worldRate && now - this.worldAt < 1000) return;
    const ms = clockMs(iso);
    const changed = (ms === null) !== !Number.isFinite(this.worldMs) || nextRate !== this.worldRate
      || (ms !== null && Math.abs(ms - (this.worldMs + (now - this.worldAt) * this.worldRate)) > 1000);
    this.worldMs = ms ?? NaN; this.worldAt = now; this.worldRate = nextRate;
    if (changed) for (const v of this.views.values()) if (v.data.reopensAt !== undefined) v.nextLabelAt = 0;
  }

  hoverTarget(id: string) {
    if (!id.startsWith('build-site:')) return null;
    const v = this.views.get(id.slice(11)); if (!v || !this.group.visible) return null;
    const b = v.data, [x, z] = b.site.at;
    return { kind: 'place' as const, id, name: `Under construction: ${b.title}`, detail: `${b.step.label} ${b.step.n}/${b.step.of}`, point: new THREE.Vector3(x, this.options.groundAt(x, z) ?? 0, z) };
  }
  inspect() {
    return { maxRev: this.maxRev, style: [...this.styles].join(',') || 'off', ...this.stats, sites: [...this.views.values()].map(v => ({ id: v.data.id, paused: v.paused, text: v.text, parts: [...v.parts], coverage: [...v.coverage], draws: v.group.children.filter(o => o.visible && (!(o instanceof THREE.LineSegments) || o.geometry.getAttribute('position').count > 0)).length,
      gaze: v.gaze?.visible ? { at: v.gaze.position.toArray(), px: GAZE.px, opacity: v.gaze.material.opacity, t: v.gazeT } : null })) };
  }

  private put(data: PublicSite, now?: number) {
    const previous = this.views.get(data.id);
    // Preserve canvas/texture and geometry for identical start/resume shapes.
    if (previous && JSON.stringify([previous.data.site, previous.data.massing]) === JSON.stringify([data.site, data.massing])) {
      previous.data = data; previous.roots = new Set(data.roots); previous.reindex = true;
      if (data.attention) this.attend(previous, data.attention, now);
      this.setClock(previous, now); this.countParts(previous); this.refit(previous); this.refresh(previous, this.clock()); return;
    }
    if (previous) this.release(previous);
    const group = new THREE.Group(); group.name = `build-site:${data.id}`;
    const marker = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    installDesignPulse(marker.material, this.pulse);
    marker.renderOrder = 997;
    const mass = massGeometry(data, this.options.groundAt);
    const faces = new THREE.Mesh(mass.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false }));
    installDesignPulse(faces.material, this.pulse);
    faces.renderOrder = 995;
    const ground = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    installGroundLift(ground.material); ground.renderOrder = 994;
    group.add(marker, faces, ground);
    const v: View = { data, roots: new Set(data.roots), group, marker, ground, faces, ranges: mass.ranges, edgeRanges: [], parts: data.massing.map(() => 0), coverage: data.massing.map(() => 0), members: new Map(), reindex: true, label: null, canvas: null, text: '', labelY: 0, wheel: null, sheen: null, deadline: 0, receivedAt: 0, silence: 0, pausedAt: 0, paused: false, nextLabelAt: 0, sayUntil: 0, noteUntil: 0, reopenDeadline: Infinity, designingActive: false, captionAlpha: { value: 0 }, captionTop: { value: 0 }, gear: false, chipGear: { value: new THREE.Vector3() }, chipSize: { value: new THREE.Vector2(1, 1) }, gaze: null, gazeT: -Infinity, gazeUntil: 0, gazePulse: 1 };
    this.views.set(data.id, v); this.group.add(group);
    this.setClock(v, now); this.countParts(v); this.refit(v); this.refresh(v, this.clock());
    if (data.attention) this.attend(v, data.attention, now);
    this.tag(v);
  }
  private tag(v: View) { v.group.traverse(o => { o.userData.buildSite = v.data.id; o.userData.entity = `build-site:${v.data.id}`; o.userData.cameraTransparent = true; }); }
  private setClock(v: View, now?: number) {
    const serverNow = now ?? Date.now();
    v.receivedAt = this.clock(); v.silence = Math.max(0, serverNow - v.data.lastAt);
    v.sayUntil = v.data.say ? v.receivedAt + v.data.say.at + SAY_MS - serverNow : -Infinity;
    v.noteUntil = v.data.note ? v.receivedAt + v.data.note.at + NOTE_MS - serverNow : -Infinity;
    v.reopenDeadline = v.data.reopensAt === undefined ? Infinity : v.receivedAt + v.data.reopensAt - serverNow;
    v.captionAlpha.value = Math.max(0, Math.min(1, (v.noteUntil - v.receivedAt) / 2000));
    v.deadline = v.receivedAt + v.data.pauseAfterMs - v.silence;
    v.paused = v.data.status === 'paused' || v.receivedAt >= v.deadline;
    v.pausedAt = v.data.status === 'paused' ? Math.min(v.receivedAt, v.deadline) : v.deadline;
    v.nextLabelAt = v.receivedAt;
  }
  private refresh(v: View, now: number) {
    const paused = v.data.status === 'paused' || now >= v.deadline, changed = v.paused !== paused;
    v.paused = paused;
    const silence = v.silence + now - v.receivedAt;
    const b = v.data, saying = !!b.say && now < v.sayUntil, caption = !!b.note?.text && now < v.noteUntil;
    const closed = b.closed && now < v.reopenDeadline;
    const reopening = paused && closed && Number.isFinite(v.reopenDeadline) && Number.isFinite(this.worldMs)
      ? worldTimeText(new Date(this.worldMs + (v.reopenDeadline - this.worldAt) * this.worldRate).toISOString()) : '';
    const tail = paused ? (closed ? `paused ${Math.max(0, Math.floor((now - v.pausedAt) / MINUTE))} min${reopening ? ` · open again ${reopening}` : ''}` : 'paused · open') : !saying && silence >= QUIET_MS ? `quiet ${Math.floor(silence / MINUTE)} min` : '';
    const text = `${b.title} · ${b.step.label} ${b.step.n}/${b.step.of}${tail ? ` · ${tail}` : ''}${saying ? `\ndesigning: ${b.say!.text.replace(/[\u0000-\u001f\u007f]/g, ' ')}` : ''}${caption ? `\n${b.note!.text.replace(/[\u0000-\u001f\u007f]/g, ' ')}` : ''}`;
    const designingActive = !paused && (!b.say || now < v.sayUntil), pulseChanged = v.designingActive !== designingActive;
    v.designingActive = designingActive;
    // G2: a turning gear in the chip while the build is open and working; none once it pauses or closes.
    const gear = !paused && b.status === 'active';
    if (this.styles.has('label') && (text !== v.text || gear !== v.gear)) this.label(v, text, gear);
    v.captionTop.value = caption && v.canvas ? LABEL_HEIGHT_PX / v.canvas.height : 0;
    if (v.label) v.label.visible = this.styles.has('label');
    // Wake only at a deadline or a visible minute boundary, never once per animation frame.
    v.nextLabelAt = paused ? (closed ? v.pausedAt + (Math.floor((now - v.pausedAt) / MINUTE) + 1) * MINUTE : Infinity) : Math.min(v.deadline, v.receivedAt + (silence < QUIET_MS ? QUIET_MS - v.silence : (Math.floor(silence / MINUTE) + 1) * MINUTE - v.silence));
    // A fresh narration suppresses quiet text until its exact expiry; captions and closure have independent clocks.
    if (saying) v.nextLabelAt = Math.min(v.deadline > now ? v.deadline : Infinity, v.sayUntil, paused && closed ? v.nextLabelAt : Infinity);
    if (caption) v.nextLabelAt = Math.min(v.nextLabelAt, v.noteUntil);
    if (closed) v.nextLabelAt = Math.min(v.nextLabelAt, v.reopenDeadline);
    if (changed || pulseChanged) this.tint(v);
    if (changed && v.wheel && this.styles.has('wheel')) this.wheel(v);
    if (v.sheen) v.sheen.material = paused ? this.sheenMaterial(false) : this.sheenMaterial(true);
  }
  private label(v: View, text: string, gear: boolean) {
    const canvas = v.canvas ?? this.options.createCanvas?.() ?? document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const lines = text.split('\n');
    // The gear sits left of the first two lines and is as tall as they are (less a margin).
    const gearRadius = gear ? (Math.min(2, lines.length) * LABEL_HEIGHT_PX - 24) / 2 : 0, inset = gear ? gearRadius * 2 + 12 : 0;
    ctx.font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`; const width = Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + 28 + inset;
    const resized = canvas.width !== width || canvas.height !== LABEL_HEIGHT_PX * lines.length;
    canvas.width = width; canvas.height = LABEL_HEIGHT_PX * lines.length;
    ctx.font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(20,20,20,0.8)'; ctx.beginPath(); ctx.roundRect(0, 0, width, canvas.height, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; lines.forEach((line, i) => ctx.fillText(line, 14 + inset, 23 + i * LABEL_HEIGHT_PX));
    const gx = 14 + gearRadius, gy = Math.min(2, lines.length) * LABEL_HEIGHT_PX / 2;
    if (gear) { ctx.fillStyle = GEAR_COLOR; ctx.beginPath(); gearPath(ctx, gx, gy, gearRadius); ctx.fill('evenodd'); }
    // The shader turns only the disc around the gear; the chip background there is flat, so nothing else moves.
    v.chipGear.value.set(gx, gy, gear ? gearRadius + 1.5 : 0); v.chipSize.value.set(canvas.width, canvas.height); v.gear = gear;
    if (!v.label) {
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      v.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
      v.label.material.onBeforeCompile = shader => {
        shader.uniforms.uBuildCaptionAlpha = v.captionAlpha; shader.uniforms.uBuildCaptionTop = v.captionTop;
        shader.uniforms.uBuildGear = v.chipGear; shader.uniforms.uBuildChip = v.chipSize; shader.uniforms.uBuildSpin = this.spin;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBuildCaptionAlpha;\nuniform float uBuildCaptionTop;\nuniform vec3 uBuildGear;\nuniform vec2 uBuildChip;\nuniform float uBuildSpin;')
          .replace('#include <map_fragment>', CHIP_MAP_FRAGMENT + '\n#ifdef USE_MAP\n diffuseColor.a *= vMapUv.y < uBuildCaptionTop ? uBuildCaptionAlpha : 1.0;\n#endif');
      };
      v.label.material.customProgramCacheKey = () => 'build-caption-v2';
      // The bottom edge clears the tallest roof/root even when the screen-size floor enlarges the sprite.
      v.label.center.set(0.5, 0); v.label.frustumCulled = false;
      v.label.onBeforeRender = (renderer, _scene, camera) => {
        const sprite = v.label!, m = sprite.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
        const depth = Math.max(0.01, -(view[2] * m[12] + view[6] * m[13] + view[10] * m[14] + view[14]));
        const height = renderer.getSize(this.viewport).y;
        const unitsPerPixel = 2 * (camera instanceof THREE.PerspectiveCamera ? depth : 1) / (Math.max(1, height) * camera.projectionMatrix.elements[5]);
        const scale = Math.max(LABEL_WORLD_HEIGHT * canvas.height / LABEL_HEIGHT_PX, LABEL_MIN_TEXT_PX * canvas.height / LABEL_FONT_PX * unitsPerPixel);
        sprite.scale.set(canvas.width / canvas.height * scale, scale, 1);
        sprite.updateMatrixWorld();
      };
      v.label.renderOrder = 998; v.group.add(v.label);
    } else if (resized) {
      // A WebGL2 texture keeps the size of its first upload: a taller/wider canvas copied into it overflows
      // (glCopySubTextureCHROMIUM: Offset overflow) and the old, stretched label stays on screen. New size, new texture.
      const old = v.label.material.map, texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      v.label.material.map = texture; old?.dispose();
    }
    v.canvas = canvas; v.text = text; v.label.material.map!.needsUpdate = true;
    v.label.scale.set(width / LABEL_HEIGHT_PX * LABEL_WORLD_HEIGHT, canvas.height / LABEL_HEIGHT_PX * LABEL_WORLD_HEIGHT, 1);
    const [x, z] = v.data.site.at;
    v.label.position.set(x, v.labelY, z);
    this.stats.labelRedraws++; this.tag(v);
  }

  private countParts(v: View, diff?: { upserts?: Entity[]; removes?: string[] }) {
    const model = this.options.model(); if (!model) return;
    const ids = new Set<string>();
    if (v.reindex || !diff) {
      v.members.clear(); v.parts.fill(0);
      for (const root of v.roots) for (const id of model.subtree(root)) ids.add(id);
    } else {
      for (const id of diff.removes ?? []) ids.add(id);
      for (const e of diff.upserts ?? []) for (const id of model.subtree(e.id)) ids.add(id);
    }
    for (const id of ids) {
      const old = v.members.get(id);
      if (old) { for (let k = 0; k < v.parts.length; k++) if (old.mask & (1 << k)) v.parts[k]--; v.members.delete(id); }
      const e = model.entities.get(id), root = e && this.rootOf(e, v, model); if (!e || !root) continue;
      const physical = model.footprintsOf(id); if (!physical.length) continue; // empty prefab containers are not physical parts
      const boxes = thingEnvelope(physical); // r2.1: a placed thing fills its own footprint (walls enclose their rooms)
      const x = boxes.reduce((n, box) => n + box.c[0], 0) / boxes.length, z = boxes.reduce((n, box) => n + box.c[1], 0) / boxes.length;
      const [sx, sz] = localPoint(x, z, v.data.site.at, v.data.site.yaw);
      let mask = 0;
      for (let k = 0; k < v.data.massing.length; k++) { const m = v.data.massing[k], [mx, mz] = localPoint(sx, sz, m.at, m.yaw ?? 0); if (Math.abs(mx) <= m.size[0] / 2 && Math.abs(mz) <= m.size[1] / 2) { mask |= 1 << k; v.parts[k]++; } }
      v.members.set(id, { root, mask, boxes });
    }
    // Count remains diagnostic only. Union the cached physical OBBs, including members
    // whose centres are outside a mass but whose footprints overlap it.
    const boxes = [...v.members.values()].flatMap(member => member.boxes);
    for (let k = 0; k < v.coverage.length; k++) v.coverage[k] = massCoverage(v.data, v.data.massing[k], boxes, this.options.groundAt);
    v.reindex = false; this.tint(v);
  }
  private tint(v: View) {
    const c = v.paused ? PAUSED : ACTIVE;
    const ground = v.ground.geometry.getAttribute('color');
    if (ground) { for (let k = 0; k < ground.count; k++) ground.setXYZW(k, c.r, c.g, c.b, MARKER_ALPHA); ground.needsUpdate = true; }
    const lines = v.marker.geometry.getAttribute('color');
    if (lines) {
      for (let k = 0; k < lines.count; k++) lines.setXYZW(k, c.r, c.g, c.b, MARKER_ALPHA);
      for (let i = 0; i < v.edgeRanges.length; i++) {
        const range = v.edgeRanges[i], remaining = Math.max(0, 1 - v.coverage[i] / 0.8);
        const alpha = FAINT_EDGE_ALPHA + (MARKER_ALPHA - FAINT_EDGE_ALPHA) * remaining * remaining;
        for (let k = range.start; k < range.start + range.count; k++) lines.setW(k, alpha);
      }
      lines.needsUpdate = true;
    }
    const colors = v.faces.geometry.getAttribute('color');
    v.faces.visible = false;
    for (let i = 0; i < v.ranges.length; i++) {
      const range = v.ranges[i], alpha = 0.35 * Math.max(0, 1 - v.coverage[i] / 0.6);
      for (let k = range.start; k < range.start + range.count; k++) colors.setXYZW(k, c.r, c.g, c.b, alpha);
      if (this.styles.size && alpha > 0 && range.count) v.faces.visible = true;
    }
    colors.needsUpdate = true;
    // Selection attributes change only with site state/geometry. Each frame changes one shared alpha uniform.
    designAttribute(v.marker.geometry, v.edgeRanges, v.data, v.designingActive);
    designAttribute(v.faces.geometry, v.ranges, v.data, v.designingActive);
  }

  private refit(v: View) {
    const b = v.data, lines: number[] = [], ring: number[] = [];
    if (this.styles.has('ring')) {
      // Samples about every 1.5 m follow the terrain closely enough for the depth-tested outline to stay above it.
      for (let side = 0; side < 4; side++) {
        const n = Math.max(8, Math.min(48, Math.ceil(b.site.size[side % 2] / 1.5)));
        const corner = (t: number) => { const u = side === 0 ? -0.5 + t : side === 1 ? 0.5 : side === 2 ? 0.5 - t : -0.5; const w = side === 0 ? -0.5 : side === 1 ? -0.5 + t : side === 2 ? 0.5 : 0.5 - t; const [x, z] = worldPoint(u * b.site.size[0], w * b.site.size[1], b.site.at, b.site.yaw); return [x, (this.options.groundAt(x, z) ?? 0) + 0.09, z]; };
        for (let i = 0; i < n; i++) ring.push(...corner(i / n), ...corner((i + 1) / n));
      }
    }
    replaceGeometry(v.ground, lineGeometry(ring)); v.ground.visible = ring.length > 0;
    const masses = massVolumes(b, this.options.groundAt);
    v.edgeRanges = [];
    if (this.styles.size) for (const mass of masses) {
      const start = lines.length / 3;
      for (const id of mass.edges) lines.push(...mass.vertices[id]);
      v.edgeRanges.push({ start, count: lines.length / 3 - start });
    }
    const boxes: OBB[] = [];
    const model = this.options.model();
    if (model) {
      const seen = new Set<string>();
      for (const root of v.roots) for (const id of model.subtree(root)) if (!seen.has(id)) { seen.add(id); boxes.push(...model.footprintsOf(id)); }
      if (this.styles.has('outline')) for (const box of boxes) lines.push(...obbEdges(box));
    }
    // Prefer actual parts once they exist; an empty prefab root falls back to the massing.
    let top = this.options.groundAt(...b.site.at) ?? 0;
    if (boxes.length) for (const box of boxes) top = Math.max(top, box.y1);
    else for (const volume of masses) for (const vertex of volume.vertices) top = Math.max(top, vertex[1]);
    v.labelY = top + 0.75;
    replaceGeometry(v.marker, lineGeometry(lines)); v.marker.visible = lines.length > 0 && this.styles.size > 0;
    this.tint(v);
    if (this.styles.has('wheel')) this.wheel(v); else if (v.wheel) v.wheel.visible = false;
    if (this.styles.has('sheen')) {
      // Merged padded volumes follow the rooflines; a tall tower must not make a giant
      // rectangular band across the empty air over a low nave. Positions stay in world space.
      const padded = boxes.length ? boxes.map(box => obbVolume(box, 0.35)) : massVolumes(b, this.options.groundAt, 0.35);
      const geometry = sheenGeometry(padded);
      if (!v.sheen) { v.sheen = new THREE.Mesh(geometry, this.sheenMaterial(!v.paused)); v.sheen.renderOrder = 996; v.group.add(v.sheen); }
      else { v.sheen.geometry.dispose(); v.sheen.geometry = geometry; }
      v.sheen.visible = padded.length > 0;
    } else if (v.sheen) v.sheen.visible = false;
    if (v.label) { v.label.visible = this.styles.has('label'); const [x, z] = b.site.at; v.label.position.set(x, v.labelY, z); }
    this.tag(v);
  }
  private wheel(v: View) {
    const positions: number[] = [], colors: number[] = [], b = v.data, radius = Math.max(1.5, Math.min(...b.site.size) * 0.24), fraction = Math.max(0, Math.min(1, b.step.n / Math.max(1, b.step.of)));
    const width = Math.max(0.18, radius * 0.09);
    const c = v.paused ? PAUSED : ACTIVE;
    const point = (a: number, r: number): [number, number] => [Math.sin(a) * r, -Math.cos(a) * r];
    const quad = (a: number[], d: number[], e: number[], f: number[], alpha: number) => {
      for (const [dx, dz] of [a, d, e, a, e, f]) {
        const x = b.site.at[0] + dx, z = b.site.at[1] + dz;
        positions.push(x, (this.options.groundAt(x, z) ?? 0) + 0.14, z); colors.push(c.r, c.g, c.b, alpha);
      }
    };
    const arc = (from: number, to: number, alpha: number) => {
      if (to <= from) return;
      quad(point(from * Math.PI * 2, radius - width / 2), point(from * Math.PI * 2, radius + width / 2), point(to * Math.PI * 2, radius + width / 2), point(to * Math.PI * 2, radius - width / 2), alpha);
    };
    // A world-width ribbon stays visible in WebGL, where LineBasicMaterial is only one pixel.
    // Split the boundary segment so the bright arc is exactly n/of, including 0 and complete.
    for (let i = 0; i < 96; i++) {
      arc(i / 96, Math.min((i + 1) / 96, fraction), 0.95);
      arc(Math.max(i / 96, fraction), (i + 1) / 96, 0.24);
    }
    // Thick stroke digits share the progress-ring draw and ground-level label anchor.
    const text = `${b.step.n}/${b.step.of}`, scale = radius * 1.25 / (text.length * 0.75);
    for (let i = 0; i < text.length; i++) for (const [ax, az, bx, bz] of digitLines(text[i])) {
      const x0 = (i * 0.75 + ax - (text.length * 0.75 - 0.25) / 2) * scale, z0 = (az - 0.5) * scale;
      const x1 = (i * 0.75 + bx - (text.length * 0.75 - 0.25) / 2) * scale, z1 = (bz - 0.5) * scale;
      const length = Math.hypot(x1 - x0, z1 - z0), dx = -(z1 - z0) / length * width * 0.22, dz = (x1 - x0) / length * width * 0.22;
      quad([x0 + dx, z0 + dz], [x0 - dx, z0 - dz], [x1 - dx, z1 - dz], [x1 + dx, z1 + dz], 0.95);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    if (!v.wheel) { v.wheel = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, forceSinglePass: true, depthTest: false, depthWrite: false, toneMapped: false })); v.wheel.renderOrder = 997; v.group.add(v.wheel); }
    else { v.wheel.geometry.dispose(); v.wheel.geometry = geometry; }
    v.wheel.visible = true;
  }
  private sheenMaterial(active: boolean) {
    const old = active ? this.activeSheen : this.pausedSheen; if (old) return old;
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uActive: { value: active ? 1 : 0 }, uColor: { value: active ? ACTIVE : PAUSED } },
      vertexShader: 'attribute float aHeight; varying float vHeight; void main(){vHeight=aHeight;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uTime; uniform float uActive; uniform vec3 uColor; varying float vHeight; void main(){float band=1.0-smoothstep(0.025,0.075,abs(vHeight-fract(uTime*0.125)));gl_FragColor=vec4(uColor,0.006+uActive*band*0.055);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
    });
    if (active) this.activeSheen = material; else this.pausedSheen = material;
    return material;
  }
  private release(v: View) {
    v.group.removeFromParent();
    v.marker.geometry.dispose(); v.marker.material.dispose(); v.ground.geometry.dispose(); v.ground.material.dispose(); v.faces.geometry.dispose(); v.faces.material.dispose();
    if (v.label) { v.label.material.map?.dispose(); v.label.material.dispose(); }
    if (v.wheel) { v.wheel.geometry.dispose(); v.wheel.material.dispose(); }
    v.sheen?.geometry.dispose(); // sheen materials are layer-owned and shared among all sites
    v.gaze?.material.dispose(); this.gazing.delete(v); // the reticle texture is layer-owned
    v.group.clear(); v.members.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    for (const v of this.views.values()) this.release(v);
    this.views.clear(); this.pending.clear(); this.group.clear(); this.group.removeFromParent();
    this.activeSheen?.dispose(); this.pausedSheen?.dispose(); this.gazeTexture?.dispose(); this.gazing.clear();
  }
}

function worldPoint(x: number, z: number, at: [number, number], yaw: number): [number, number] { const c = Math.cos(yaw), s = Math.sin(yaw); return [at[0] + x * c + z * s, at[1] - x * s + z * c]; }
function localPoint(x: number, z: number, at: [number, number], yaw: number): [number, number] { return worldPoint(x - at[0], z - at[1], [0, 0], -yaw); }
function lineGeometry(points: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(points.length / 3 * 4), 4)); return g; }
function replaceGeometry(obj: THREE.LineSegments, geometry: THREE.BufferGeometry) { obj.geometry.dispose(); obj.geometry = geometry; }
/** r2.1 (release 2 walk): coverage was the volume of the thin wall colliders themselves (0.03–0.05 of a mass), so the
 * ghost never faded over a finished building. A placed thing now fills the plan hull of its own colliders, taken in the
 * frame of its largest box (exact for walls at 0°/90°; a lone box is itself), one box per merged vertical interval, so
 * vertical gaps (a floating storey) stay unfilled. Per entity: separate entities are never bridged. */
export function thingEnvelope(boxes: OBB[]): OBB[] {
  if (boxes.length < 2) return boxes;
  const frame = boxes.reduce((a, b) => (b.half[0] * b.half[1] > a.half[0] * a.half[1] ? b : a));
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const b of boxes) {
    const [u, v] = localPoint(b.c[0], b.c[1], [0, 0], frame.yaw), c = Math.abs(Math.cos(b.yaw - frame.yaw)), s = Math.abs(Math.sin(b.yaw - frame.yaw));
    const eu = c * b.half[0] + s * b.half[1], ev = s * b.half[0] + c * b.half[1];
    u0 = Math.min(u0, u - eu); u1 = Math.max(u1, u + eu); v0 = Math.min(v0, v - ev); v1 = Math.max(v1, v + ev);
  }
  const centre = worldPoint((u0 + u1) / 2, (v0 + v1) / 2, [0, 0], frame.yaw), half: [number, number] = [(u1 - u0) / 2, (v1 - v0) / 2];
  const spans: [number, number][] = [];
  for (const b of [...boxes].sort((a, b) => a.y0 - b.y0)) { const last = spans.at(-1); if (last && b.y0 <= last[1] + 0.05) last[1] = Math.max(last[1], b.y1); else spans.push([b.y0, b.y1]); }
  return spans.map(([y0, y1]) => ({ c: centre, half, yaw: frame.yaw, y0, y1 }));
}
/** 8×8 footprint samples, with exact vertical interval unions at each sample. The
 * column tops follow the declared roof; overlapping/nested OBBs never count twice.
 * Called on snapshots/shape or terrain refreshes and the site's diffs, never frames. */
function massCoverage(site: PublicSite, mass: Mass, boxes: OBB[], groundAt: Options['groundAt']): number {
  const centre = worldPoint(...mass.at, site.site.at, site.site.yaw), yaw = site.site.yaw + (mass.yaw ?? 0);
  // Coverage uses physical ground, excluding the ghost geometry's 8 cm z-fight lift.
  const base = groundAt(...centre) ?? 0, [w, d] = mass.size, rise = Math.min(w, d) * 0.5;
  const candidates = boxes.flatMap(box => {
    const [x, z] = localPoint(...box.c, centre, yaw), c = Math.cos(box.yaw - yaw), s = Math.sin(box.yaw - yaw);
    const y0 = Math.max(0, box.y0 - base), y1 = Math.min(mass.h + (mass.roof === 'gable' || mass.roof === 'pyramid' ? rise : 0), box.y1 - base);
    const dx = Math.abs(c) * box.half[0] + Math.abs(s) * box.half[1], dz = Math.abs(s) * box.half[0] + Math.abs(c) * box.half[1];
    return y1 <= y0 || Math.abs(x) - dx >= w / 2 || Math.abs(z) - dz >= d / 2 ? [] : [{ x, z, c, s, half: box.half, y0, y1 }];
  }).sort((a, b) => a.y0 - b.y0);
  if (!candidates.length) return 0;
  let filled = 0, total = 0;
  for (let iz = 0; iz < COVERAGE_GRID; iz++) for (let ix = 0; ix < COVERAGE_GRID; ix++) {
    const x = ((ix + 0.5) / COVERAGE_GRID - 0.5) * w, z = ((iz + 0.5) / COVERAGE_GRID - 0.5) * d;
    const roof = mass.roof === 'gable' ? 1 - (w >= d ? Math.abs(z) * 2 / d : Math.abs(x) * 2 / w) : mass.roof === 'pyramid' ? 1 - Math.max(Math.abs(x) * 2 / w, Math.abs(z) * 2 / d) : 0;
    const top = mass.h + roof * rise; total += top;
    let high = 0;
    for (const box of candidates) {
      if (box.y0 >= top) break;
      const dx = x - box.x, dz = z - box.z;
      if (Math.abs(dx * box.c - dz * box.s) > box.half[0] || Math.abs(dx * box.s + dz * box.c) > box.half[1]) continue;
      const end = Math.min(top, box.y1);
      filled += Math.max(0, end - Math.max(high, box.y0)); high = Math.max(high, end);
    }
  }
  return Math.min(1, filled / total);
}
type Volume = { vertices: number[][]; triangles: number[]; edges: number[] };
function volume(w: number, d: number, h: number, roof: Mass['roof']): Volume {
  const x = w / 2, z = d / 2;
  const vertices = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]];
  const triangles = [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 0, 4, 1, 5, 2, 6, 3, 7, 4, 5, 5, 6, 6, 7, 7, 4];
  const rise = Math.min(w, d) * 0.5;
  if (roof === 'pyramid') { vertices.push([0, h + rise, 0]); triangles.push(4, 8, 5, 5, 8, 6, 6, 8, 7, 7, 8, 4); edges.push(4, 8, 5, 8, 6, 8, 7, 8); }
  else if (roof === 'gable') {
    if (w >= d) { vertices.push([-x, h + rise, 0], [x, h + rise, 0]); triangles.push(4, 8, 9, 4, 9, 5, 7, 6, 9, 7, 9, 8, 4, 7, 8, 5, 9, 6); edges.push(4, 8, 7, 8, 8, 9, 5, 9, 6, 9); }
    else { vertices.push([0, h + rise, -z], [0, h + rise, z]); triangles.push(4, 7, 9, 4, 9, 8, 5, 8, 9, 5, 9, 6, 4, 8, 5, 7, 6, 9); edges.push(4, 8, 5, 8, 8, 9, 7, 9, 6, 9); }
  } else triangles.push(4, 7, 6, 4, 6, 5);
  return { vertices, triangles, edges };
}
function massVolumes(site: PublicSite, groundAt: Options['groundAt'], pad = 0) {
  return site.massing.slice(0, 8).map(m => {
    const v = volume(m.size[0], m.size[1], m.h, m.roof), [cx, cz] = worldPoint(m.at[0], m.at[1], site.site.at, site.site.yaw), base = (groundAt(cx, cz) ?? 0) + 0.08;
    const height = Math.max(...v.vertices.map(vertex => vertex[1]));
    v.vertices = v.vertices.map(([x, y, z]) => {
      const [sx, sz] = worldPoint(x * (1 + 2 * pad / m.size[0]), z * (1 + 2 * pad / m.size[1]), m.at, m.yaw ?? 0), [wx, wz] = worldPoint(sx, sz, site.site.at, site.site.yaw);
      return [wx, base + y * (1 + 2 * pad / height) - pad, wz];
    });
    return v;
  });
}
/** Patch existing face/edge materials; selected masses share the layer's one oscillating uniform. */
const GEAR_TURNS_PER_SECOND = 0.2, GEAR_COLOR = '#ffc05c', GEAR_TEETH = 8;
/** A cog outline with a hub hole (fill with 'evenodd'). */
function gearPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const inner = r * 0.74, pitch = Math.PI * 2 / GEAR_TEETH, at = (rr: number, a: number) => [x + Math.cos(a) * rr, y + Math.sin(a) * rr] as const;
  ctx.moveTo(...at(inner, 0));
  for (let t = 0; t < GEAR_TEETH; t++) {
    // A tapered tooth over half the pitch, then the root circle to the next tooth.
    const a = t * pitch;
    ctx.lineTo(...at(r, a + 0.1 * pitch)); ctx.lineTo(...at(r, a + 0.4 * pitch)); ctx.lineTo(...at(inner, a + 0.5 * pitch));
    ctx.arc(x, y, inner, a + 0.5 * pitch, a + pitch);
  }
  ctx.closePath(); ctx.moveTo(x + r * 0.34, y); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.closePath();
}
/** The chip's map lookup: inside the gear disc the sample turns by uBuildSpin; gradients from the unturned uv keep the mip level. */
const CHIP_MAP_FRAGMENT = `#ifdef USE_MAP
  vec2 buildUv = vMapUv;
  vec2 buildPx = vec2(vMapUv.x * uBuildChip.x, (1.0 - vMapUv.y) * uBuildChip.y) - uBuildGear.xy;
  if (uBuildGear.z > 0.0 && dot(buildPx, buildPx) < uBuildGear.z * uBuildGear.z) {
    float c = cos(uBuildSpin), s = sin(uBuildSpin);
    vec2 turned = vec2(c * buildPx.x - s * buildPx.y, s * buildPx.x + c * buildPx.y) + uBuildGear.xy;
    buildUv = vec2(turned.x / uBuildChip.x, 1.0 - turned.y / uBuildChip.y);
  }
  diffuseColor *= textureGrad(map, buildUv, dFdx(vMapUv), dFdy(vMapUv));
#endif`;
/** Draw a ground line slightly toward the camera (along the view ray, so it does not move on screen): it stays above
 * the terrain it follows, yet any building in front of it still hides it. */
function installGroundLift(material: THREE.Material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n{ float d = length(mvPosition.xyz); mvPosition.xyz *= max(0.0, d - (0.2 + 0.006 * d)) / max(d, 1e-4); gl_Position = projectionMatrix * mvPosition; }');
  };
  material.customProgramCacheKey = () => 'build-ground-lift-v1';
}
function installDesignPulse(material: THREE.Material, pulse: { value: number }) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uBuildPulse = pulse;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float buildDesigning;\nvarying float vBuildDesigning;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBuildDesigning = buildDesigning;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBuildPulse;\nvarying float vBuildDesigning;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= mix(1.0, uBuildPulse, vBuildDesigning);');
  };
  material.customProgramCacheKey = () => 'build-design-pulse-v1';
}
function designAttribute(geometry: THREE.BufferGeometry, ranges: VertexRange[], site: PublicSite, active: boolean) {
  const position = geometry.getAttribute('position'); if (!position) return; // marker is empty until its first refit
  const count = position.count;
  let selected = geometry.getAttribute('buildDesigning') as THREE.BufferAttribute | undefined;
  if (!selected || selected.count !== count) { selected = new THREE.Float32BufferAttribute(new Float32Array(count), 1); geometry.setAttribute('buildDesigning', selected); }
  (selected.array as Float32Array).fill(0);
  if (active) for (let i = 0; i < ranges.length; i++) {
    const name = site.massing[i]?.name;
    if (name && site.designing?.includes(name)) (selected.array as Float32Array).fill(1, ranges[i].start, ranges[i].start + ranges[i].count);
  }
  selected.needsUpdate = true;
}
function massGeometry(site: PublicSite, groundAt: Options['groundAt']) {
  const points: number[] = [], colors: number[] = [], ranges: View['ranges'] = [];
  for (const v of massVolumes(site, groundAt)) {
    const start = points.length / 3;
    for (const id of v.triangles) { points.push(...v.vertices[id]); colors.push(ACTIVE.r, ACTIVE.g, ACTIVE.b, 0.35); }
    ranges.push({ start, count: points.length / 3 - start });
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return { geometry, ranges };
}
function obbVolume(box: OBB, pad = 0) {
  const v = volume(box.half[0] * 2 + pad * 2, box.half[1] * 2 + pad * 2, box.y1 - box.y0 + pad * 2, 'flat');
  v.vertices = v.vertices.map(([x, y, z]) => { const [wx, wz] = worldPoint(x, z, box.c, box.yaw); return [wx, box.y0 - pad + y, wz]; });
  return v;
}
function obbEdges(box: OBB) { const v = obbVolume(box); return v.edges.flatMap(id => v.vertices[id]); }
function sheenGeometry(volumes: Volume[]) {
  const points: number[] = [], heights: number[] = [];
  let low = Infinity, high = -Infinity;
  for (const volume of volumes) for (const vertex of volume.vertices) { low = Math.min(low, vertex[1]); high = Math.max(high, vertex[1]); }
  for (const volume of volumes) for (const id of volume.triangles) {
    const vertex = volume.vertices[id]; points.push(...vertex); heights.push((vertex[1] - low) / Math.max(0.001, high - low));
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  return geometry;
}
const DIGIT_SEGMENTS = [[0, 0, 0.5, 0], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 1], [0, 1, 0.5, 1], [0, 0.5, 0, 1], [0, 0, 0, 0.5], [0, 0.5, 0.5, 0.5]];
const DIGITS: Record<string, string> = { '0': '012345', '1': '12', '2': '01643', '3': '01236', '4': '1256', '5': '02563', '6': '023456', '7': '012', '8': '0123456', '9': '012356' };
function digitLines(char: string): number[][] { return char === '/' ? [[0.05, 1, 0.45, 0]] : [...(DIGITS[char] ?? '')].map(i => DIGIT_SEGMENTS[Number(i)]); }
