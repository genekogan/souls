// Preview ghosts (spec <eden4>/33 §2 row 10): the god's dry run, drawn
// translucent over the world without committing it. `?preview=<id>` (or the
// god panel's preview list) fetches `/v1/god/preview/:id` — the would-be diff —
// and draws new things in green, changed/moved things in amber at their new
// pose, removed things in red where they stand, and changed terrain tiles as a
// lifted translucent sheet. Nothing here talks to the god API's write side.
import * as THREE from 'three';
import { TILE_M, Terrain, type Ground } from '@souls/ground';
import { WorldModel, plan, type Entity, type StoredDef } from '@souls/world-compiler';
import { GENERATORS } from '@souls/generators';
import { meshFor, type MeshCtx } from './gen-mesh/index.ts';
import { MaterialLib } from './gen-mesh/materials.ts';

type Diff = { upserts: Entity[]; removes: string[]; defs: StoredDef[]; tiles: string[]; world?: Record<string, unknown> };
type Snapshot = { contract: string; seq: number; counter?: number; seed?: string; constants: WorldModel['constants']; state: WorldModel['state']; ground: Ground; defs: StoredDef[]; entities: Entity[] };
export type GhostSummary = { id: string; ok: boolean; added: number; changed: number; removed: number; tiles: number; drawn: number; failures?: { code: string; detail: string }[] | null; message?: string; bounds?: [number, number, number, number] };
export type PreviewData = { diff: Diff; failures: GhostSummary['failures']; ground?: Ground; ops?: unknown };
export type PreviewAccess = { token?: string | null; viewKey?: string | null };
export type PreviewLoader = (path: string) => Promise<PreviewData>;

const COLORS = { added: 0x2fd27a, changed: 0xf0a92e, removed: 0xe2483d, terrain: 0x6fc3ff };

/** `#previewKey=<key>` from a CLI preview link: a read capability for one preview (never put in a query or path). */
export function previewKeyFrom(hash: string): string | null {
  try { const key = new URLSearchParams(hash.replace(/^#/, '')).get('previewKey'); return key && /^[\w-]{16,128}$/.test(key) ? key : null; } catch { return null; }
}

type UrlPort = { location: Pick<Location, 'pathname' | 'search' | 'hash'>; history: Pick<History, 'replaceState'> };
/** Read the landing view key, then drop `previewKey` from the address bar and this history entry: it is a 10-minute
 * read capability and must not linger in history. The rest of the URL stays as it was; an emptied fragment becomes
 * #watch, which Shell writes anyway (an empty one would turn a world served at the root into the world list). */
export function takePreviewKey(port: UrlPort): string | null {
  const { pathname, search, hash } = port.location, key = previewKeyFrom(hash);
  const parts = hash.replace(/^#/, '').split('&'), rest = parts.filter(p => !/^previewKey(=|$)/.test(p));
  if (rest.length !== parts.length) port.history.replaceState(null, '', `${pathname}${search}#${rest.join('&') || 'watch'}`);
  return key;
}

export class WorldPreviewGhost {
  readonly group = new THREE.Group();
  private readonly lib = new MaterialLib();
  private readonly mats = new Map<string, THREE.Material>();
  private api: (p: string) => string;
  private raf = 0;
  private request = 0;
  current: GhostSummary | null = null;
  constructor(api: (p: string) => string) {
    this.api = api;
    this.group.name = 'preview-ghost';
    this.group.renderOrder = 5;
  }

  private loader(access: PreviewAccess): PreviewLoader {
    return async (path) => {
      const pr = await fetch(this.api(path), { cache: 'no-store', headers: { ...(access.token ? { authorization: `Bearer ${access.token}` } : {}), ...(access.viewKey ? { 'x-preview-key': access.viewKey } : {}) } });
      if (!pr.ok) throw new Error(pr.status === 404 ? 'This preview has expired (previews last 10 minutes) or never existed.' : pr.status === 401 ? "This preview is private, or its 10 minutes are up: open the full link your agent printed (it carries a view key), or sign in as this world's god." : `The server answered ${pr.status}.`);
      return await pr.json() as PreviewData;
    };
  }

  /** Fetch a preview and draw it; replaces whatever was shown. */
  async show(id: string, access: PreviewAccess | PreviewLoader = {}): Promise<GhostSummary> {
    this.clear();
    const request = this.request;
    const closed: GhostSummary = { id, ok: false, added: 0, changed: 0, removed: 0, tiles: 0, drawn: 0, message: 'This preview was closed before it finished loading.' };
    // Release 2 access (god token or the link's view key) or a caller's authenticated loader; a load that finishes
    // after clear() (ownership changed, panel closed) never repaints.
    const loadPreview = typeof access === 'function' ? access : this.loader(access);
    let pv: PreviewData;
    try { pv = await loadPreview(`/v1/god/preview/${encodeURIComponent(id)}`); }
    catch (error) {
      if (request !== this.request) return closed;
      return (this.current = { id, ok: false, added: 0, changed: 0, removed: 0, tiles: 0, drawn: 0, message: error instanceof Error ? error.message : 'This private preview could not be loaded. Sign in as this world’s owner.' });
    }
    if (request !== this.request) return closed;
    if (pv.failures?.length) return (this.current = { id, ok: false, added: 0, changed: 0, removed: 0, tiles: 0, drawn: 0, failures: pv.failures, message: 'The world would refuse this batch; nothing to show.' });
    const sr = await fetch(this.api('/v1/world/snapshot'));
    if (!sr.ok) return (this.current = { id, ok: false, added: 0, changed: 0, removed: 0, tiles: 0, drawn: 0, message: 'Could not read the world.' });
    const snap = await sr.json() as Snapshot;
    if (request !== this.request) return closed;
    const load = () => WorldModel.fromSnapshot({ constants: snap.constants, state: snap.state, seed: snap.seed ?? 'ghost', seq: snap.counter ?? 0, editSeq: snap.seq, defs: snap.defs, entities: snap.entities, ground: snap.ground });
    const before = load(), after = load();
    for (const def of pv.diff.defs) for (const m of [before, after]) { m.defs.set('sha:' + def.hash, def); m.defs.set(def.ref, def); if (def.ref.startsWith('core-')) m.defs.set('core/' + def.ref.slice(5), def); }
    for (const rid of pv.diff.removes) after.delete(rid);
    const existed = new Set<string>();
    for (const e of pv.diff.upserts) { if (after.entities.has(e.id)) { existed.add(e.id); after.delete(e.id); } }
    for (const e of pv.diff.upserts) after.insert(e);
    let exactGround = false;
    if (pv.ground) { after.terrain = new Terrain(pv.ground); exactGround = true; }
    else if (pv.ops && pv.diff.tiles.length) {
      // The server kept the batch: re-plan it here on the same snapshot for the would-be ground (the compiler is shared code).
      const replay = load();
      try { const p = plan(replay, pv.ops, 'god', 0); if (p.ok) { p.apply(); after.terrain = replay.terrain; exactGround = true; } } catch { /* fall back to marking tiles */ }
    }

    let drawn = 0;
    const box = new THREE.Box3();
    const add = (obj: THREE.Object3D | null) => { if (!obj) return; this.group.add(obj); box.expandByObject(obj); drawn++; };
    const changedIds = pv.diff.upserts.filter((e) => existed.has(e.id));
    // removed things: only the roots of removed subtrees (children ride with them)
    const removed = new Set(pv.diff.removes);
    for (const rid of pv.diff.removes) { const e = before.entities.get(rid); if (!e || removed.has(e.in.parent)) continue; add(this.ghostOf(before, e, 'removed', true)); }
    for (const e of pv.diff.upserts) add(this.ghostOf(after, e, existed.has(e.id) ? 'changed' : 'added', false));
    if (pv.diff.tiles.length) add(this.terrainSheet(exactGround ? after : before, pv.diff.tiles, exactGround));
    this.group.updateMatrixWorld(true);
    const bounds: GhostSummary['bounds'] = box.isEmpty() ? undefined : [box.min.x, box.min.z, box.max.x, box.max.z];
    this.current = { id, ok: true, added: pv.diff.upserts.length - changedIds.length, changed: changedIds.length, removed: pv.diff.removes.length, tiles: new Set(pv.diff.tiles).size, drawn, bounds };
    this.pulse();
    return this.current;
  }

  clear() {
    this.request++;
    cancelAnimationFrame(this.raf); this.raf = 0;
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); }
    this.current = null;
  }
  dispose() { this.clear(); for (const m of this.mats.values()) m.dispose(); this.mats.clear(); }

  /** A slow breathe so the ghost reads as "not real yet" against the committed world. */
  private pulse() {
    const tick = (t: number) => {
      const a = 0.38 + 0.14 * Math.sin(t / 420);
      for (const [k, m] of this.mats) if (!k.startsWith('edge')) (m as THREE.MeshStandardMaterial).opacity = k.startsWith('terrain') ? a * 0.6 : a;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private mat(kind: keyof typeof COLORS) {
    let m = this.mats.get(kind);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: COLORS[kind], emissive: COLORS[kind], emissiveIntensity: 0.35, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.6, side: THREE.DoubleSide }); this.mats.set(kind, m); }
    return m;
  }
  private edgeMat(kind: keyof typeof COLORS) {
    let m = this.mats.get('edge-' + kind);
    if (!m) { m = new THREE.LineBasicMaterial({ color: COLORS[kind], transparent: true, opacity: 0.9, depthTest: false }); this.mats.set('edge-' + kind, m); }
    return m;
  }

  /** The entity's own picture (its mesh half), recoloured as a ghost, posed from the given model, with an outline box. */
  private ghostOf(model: WorldModel, e: Entity, kind: 'added' | 'changed' | 'removed', withChildren: boolean): THREE.Object3D | null {
    const def = model.resolvedDef(e.def); if (!def) return null;
    const builder = meshFor(def);
    const holder = new THREE.Group(); holder.name = `ghost ${kind} ${e.name ?? e.id}`;
    const obj = builder ? this.build(model, e, def) : null;
    const wp = model.worldPose(e);
    if (obj) {
      if (!builder?.world) { obj.position.set(wp.x, wp.y, wp.z); obj.rotation.set(0, wp.yaw, 0); if (Array.isArray(e.r)) { obj.rotation.x = e.r[1]; obj.rotation.z = e.r[2]; } obj.scale.setScalar(wp.s); }
      obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.mat(kind); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 5; } else if ((o as THREE.Line).isLine) (o as THREE.Line).material = this.edgeMat(kind); else if ((o as THREE.Sprite).isSprite) o.visible = false; });
      holder.add(obj);
    }
    if (withChildren) for (const cid of model.subtree(e.id).slice(1)) { const c = model.entities.get(cid); if (c) { const g = this.ghostOf(model, c, kind, false); if (g) holder.add(g); } }
    if (!holder.children.length) return null;
    // an outline makes small or buried things findable
    holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder);
    if (!b.isEmpty() && e.in.parent === 'world') { const helper = new THREE.Box3Helper(b, COLORS[kind]); helper.material = this.edgeMat(kind); helper.renderOrder = 6; holder.add(helper); }
    return holder;
  }

  private build(m: WorldModel, e: Entity, def: StoredDef): THREE.Object3D | null {
    if (def.make.kind === 'none' || def.make.kind === 'parts') return null;
    const builder = meshFor(def); if (!builder) return null;
    const gen = def.make.kind === 'gen' ? GENERATORS[def.make.gen] : undefined;
    const defaults: Record<string, unknown> = {};
    for (const [k, f] of Object.entries({ ...(gen?.params ?? {}), ...def.params })) if ((f as { default?: unknown }).default !== undefined) defaults[k] = (f as { default?: unknown }).default;
    const params = { ...defaults, ...(e.params ?? {}) } as MeshCtx['params'];
    const ctx: MeshCtx = {
      def, entity: e, params, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {},
      baked: m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: m, materials: this.lib,
      tint: (key, fallback) => { if (!key) return fallback; const v = params[key]; return typeof v === 'string' && /^#/.test(v) ? v : def.palette?.[key] ?? fallback; },
    };
    try { return builder.build(ctx); } catch { return null; }
  }

  /** Changed tiles: the would-be ground when the server sent it, else the current ground lifted, marking where it changes. */
  private terrainSheet(m: WorldModel, tiles: string[], exact: boolean): THREE.Object3D {
    const step = 4, lift = exact ? 0.15 : 0.6;
    const group = new THREE.Group(); group.name = 'ghost terrain';
    const pos: number[] = [], idx: number[] = [], edge: number[] = [];
    for (const key of new Set(tiles)) {
      const [tx, tz] = key.split(',').map(Number); if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
      const x0 = tx * TILE_M, z0 = tz * TILE_M, n = Math.round(TILE_M / step), base = pos.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = x0 + i * step, z = z0 + j * step; pos.push(x, m.terrain.sample(Math.min(x, x0 + TILE_M - 1e-3), Math.min(z, z0 + TILE_M - 1e-3)) + lift, z); }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const corner = (i: number, j: number) => { const k = (base + j * (n + 1) + i) * 3; return [pos[k], pos[k + 1] + 0.05, pos[k + 2]]; };
      for (let i = 0; i < n; i++) edge.push(...corner(i, 0), ...corner(i + 1, 0), ...corner(i, n), ...corner(i + 1, n));
      for (let j = 0; j < n; j++) edge.push(...corner(0, j), ...corner(0, j + 1), ...corner(n, j), ...corner(n, j + 1));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const sheet = new THREE.Mesh(g, this.mat('terrain')); sheet.renderOrder = 4; group.add(sheet);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    group.add(new THREE.LineSegments(eg, this.edgeMat('terrain')));
    return group;
  }
}

type SoulsEntity = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update?: () => void } };
/**
 * The page's ghost layer: mounted once into the entity world's scene (LiveWorld
 * exposes it as window.__soulsEntity). Returns null until that scene exists.
 */
export function previewGhost(api: (p: string) => string): WorldPreviewGhost | null {
  const w = window as unknown as { __soulsEntity?: SoulsEntity; __soulsGhost?: WorldPreviewGhost };
  const sim = w.__soulsEntity;
  const ghost = w.__soulsGhost ?? (sim?.scene ? (w.__soulsGhost = new WorldPreviewGhost(api)) : null);
  if (!ghost) return null;
  // the world page may rebuild its scene (and re-publish __soulsEntity): follow it
  if (sim?.scene && ghost.group.parent !== sim.scene) sim.scene.add(ghost.group);
  return ghost;
}
