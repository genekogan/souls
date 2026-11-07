// G8 moderation: the veto, the log, and the places a hidden upload stops appearing.
//
//   GET  /v1/moderation              public: { version, hidden: [sha] } (viewers drop these)
//   GET  /v1/moderation/uploads      creator/admin: this world's uploads (Godmode assets, Soul bodies) with their state
//   GET  /v1/moderation/log?sha=     creator/admin: the append-only log, newest first
//   POST /v1/moderation/hide         { target, reason? }  creator: this world; admin: every world on the box
//   POST /v1/moderation/unhide       { target, reason? }  undo: the same role lifts its own veto
//   POST /v1/moderation/release      { target, reason? }  admin: lift a classifier quarantine
// `target` is a sha, a body asset id (`body_<sha>`) or the asset's URL.
// The creator is the world's god (a paired god token, or its signed-in owner); the admin is a user with
// role admin (ADMIN_EMAILS; `dev:admin` under DEV_AUTH).
//
// Enforcement (middleware registered before the stores' own routes, so it runs first):
// - `GET /assets/<sha>.<ext>` (Godmode files): 404 while hidden.
// - `GET /v1/edge/body/assets/<id>.glb` (Soul bodies): a neutral stand-in body while hidden (never a
//   404: a Soul wearing it must still render), and revalidation instead of a year of immutable caching,
//   so a veto reaches browsers that already loaded the file.
// - `PUT /v1/edge/body` with a hidden assetId: refused.
// - `GET /v1/souls/<id>/profile-photo/<sha>`: 404 while hidden.
// - `GET /v1/world/snapshot`: entities whose definitions use a hidden file are left out (with their
//   children); `x-moderation-version` tells the viewer which veto state it saw.
// - `GET /v1/world/seq`: carries `moderation: {version, hidden}`, so open viewers redraw within one heartbeat.
import type { Context, Hono } from 'hono';
import { definitionRefs } from '@souls/world-compiler';
import { moderationFor, targetSha, type ModerationStore, type RawDb } from './store.ts';

export type ModerationDeps = {
  db: RawDb; worldId: string;
  bearer: (c: Context) => string | undefined;
  /** The signed-in user (throws 401 when nobody is). */
  requireUser: (c: Context) => Promise<{ id: string; role: string }>;
  /** Godmode worlds: god tokens and the owner. */
  god?: { owner: string | null; godFromToken(token: string | undefined): boolean };
  /** Old-engine worlds: the configured owner (WORLD_OWNER_ID). */
  ownerId?: string;
  siteLog?: string;
};
type Who = { actor: string; role: 'creator' | 'admin' };
class ModError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const noStore = { 'cache-control': 'no-store' };
const fail = (c: Context, e: unknown) => {
  if (e instanceof ModError) return c.json({ ok: false, code: e.code, message: e.message }, e.status as 400);
  const s = (e as { status?: number })?.status, code = (e as { code?: string })?.code;
  if (typeof s === 'number' && typeof code === 'string') return c.json({ ok: false, code, message: (e as Error).message }, s as 400);
  throw e;
};

/** Mount before the asset, body and world routes. Returns the world's moderation store. */
export function mountModeration(app: Hono, d: ModerationDeps): ModerationStore {
  const store = moderationFor(d.db, d.worldId, d.siteLog);

  async function who(c: Context): Promise<Who> {
    const token = d.bearer(c);
    if (d.god && token?.startsWith('god_') && d.god.godFromToken(token)) return { actor: 'god-token', role: 'creator' };
    const u = await d.requireUser(c);
    if (u.role === 'admin') return { actor: u.id, role: 'admin' };
    if ((d.god?.owner && d.god.owner === u.id) || (!d.god && d.ownerId && d.ownerId === u.id)) return { actor: u.id, role: 'creator' };
    throw new ModError(403, 'forbidden', "only this world's creator or the site admin moderates uploads");
  }
  const target = async (c: Context) => {
    let b: Record<string, unknown>;
    try { b = await c.req.json(); } catch { throw new ModError(400, 'bad-json', 'body must be JSON: { target, reason? }'); }
    const sha = targetSha(b?.target ?? b?.sha ?? b?.assetId ?? b?.url);
    if (!sha) throw new ModError(400, 'invalid', 'target must be a sha256, body_<sha> or an asset URL');
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) || null : null;
    return { sha, reason, scope: b.scope === 'world' ? 'world' as const : undefined };
  };
  const view = (sha: string) => { const s = store.state(sha); return { sha, hidden: s.hidden, creatorVeto: s.creatorVeto, adminVeto: s.adminVeto, quarantined: s.quarantined }; };

  // ---- enforcement

  app.use('/assets/:file', async (c, next) => {
    const sha = c.req.param('file')?.split('.')[0];
    if (sha && store.isHidden(sha)) return c.json({ ok: false, code: 'not-found', message: 'no such asset' }, 404, { ...noStore, 'x-moderation': 'hidden' });
    return next();
  });
  app.use('/v1/edge/body/assets/:file', async (c, next) => {
    const file = c.req.param('file') ?? '';
    if (!/^body_[a-f0-9]{64}\.glb$/.test(file)) return next();
    const id = file.slice(0, -4), sha = id.slice(5);
    if (store.isHidden(sha)) {
      const row = (() => { try { return d.db.prepare('SELECT descriptor FROM edge_body_assets_v1 WHERE world_id=? AND asset_id=?').get(d.worldId, id) as { descriptor: string } | undefined; } catch { return undefined; } })();
      if (!row) return c.notFound();
      const type = (JSON.parse(row.descriptor) as { type?: string }).type;
      const bytes = await standIn(type === 'humanoid');
      return c.body(new Uint8Array(bytes), 200, { 'Content-Type': 'model/gltf-binary', ...noStore, 'X-Content-Type-Options': 'nosniff', 'x-moderation': 'hidden' });
    }
    const etag = `"${id}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { etag, 'cache-control': 'public, no-cache' });
    await next();
    if (c.res.status === 200) { c.res.headers.set('cache-control', 'public, no-cache'); c.res.headers.set('etag', etag); }
  });
  // Soul profile photos (already validated and metadata-free at upload): addressed by their sha, so a veto applies
  app.use('/v1/souls/:id/profile-photo/:hash', async (c, next) => {
    const sha = c.req.param('hash');
    if (sha && store.isHidden(sha)) return c.json({ ok: false, code: 'not-found', message: 'no such photo' }, 404, { ...noStore, 'x-moderation': 'hidden' });
    return next();
  });
  app.use('/v1/edge/body', async (c, next) => {
    if (c.req.method !== 'PUT') return next();
    const raw = await c.req.raw.clone().json().catch(() => null) as { assetId?: unknown; ref?: unknown } | null;
    const asset = typeof raw?.assetId === 'string' ? raw.assetId : typeof raw?.ref === 'string' ? raw.ref : null;   // #717: a public reference too
    const sha = asset ? targetSha(asset) : null;
    if (sha && store.isHidden(sha)) return c.json({ contract: 'edge/1', error: { code: 'body.moderated', message: 'This upload is hidden by moderation and cannot be worn' } }, 409, noStore);
    return next();
  });
  app.use('/v1/world/snapshot', async (c, next) => {
    await next();
    c.res.headers.set('x-moderation-version', store.version());
    const hidden = store.hidden();
    if (!hidden.length || c.res.status !== 200 || c.res.headers.has('x-snapshot-filtered')) return;  // lane W1: the snapshot cache filtered it
    // the catalog's compress() sits between this middleware and the route: decode, filter, encode again
    const enc = c.res.headers.get('content-encoding');
    if (enc && enc !== 'gzip' && enc !== 'deflate') return;
    const body = c.res.clone().body;
    const snap = body ? await new Response(enc ? body.pipeThrough(new DecompressionStream(enc as 'gzip')) : body).json().catch(() => null) : null;
    if (!snap || snap.contract !== 'world/1') return;
    const filtered = JSON.stringify(withoutHidden(snap, new Set(hidden)));
    const headers = new Headers(c.res.headers); headers.delete('content-length');
    c.res = new Response(enc ? new Response(filtered).body!.pipeThrough(new CompressionStream(enc as 'gzip')) : filtered, { status: 200, headers });
  });
  app.use('/v1/world/seq', async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const j = await c.res.clone().json().catch(() => null);
    if (!j || typeof j !== 'object') return;
    const headers = new Headers(c.res.headers); headers.delete('content-length');
    c.res = new Response(JSON.stringify({ ...j, moderation: { version: store.version(), hidden: store.hidden() } }), { status: 200, headers });
  });

  // ---- the veto and the log

  app.get('/v1/moderation', (c) => c.json({ contract: 'moderation/1', version: store.version(), hidden: store.hidden() }, 200, noStore));
  app.get('/v1/moderation/uploads', async (c) => {
    try {
      await who(c);
      const rows: { sha: string; kind: string; url: string; name: string | null; by: string | null; at: number | null }[] = [];
      try {
        for (const r of d.db.prepare('SELECT sha, kind, ext, name, by, at FROM world_assets_v1 WHERE world_id=? ORDER BY at DESC LIMIT 200').all(d.worldId) as { sha: string; kind: string; ext: string; name: string | null; by: string | null; at: number }[])
          rows.push({ sha: r.sha, kind: r.kind, url: `/assets/${r.sha}.${r.ext}`, name: r.name, by: r.by, at: r.at });
      } catch { /* not a Godmode world */ }
      try {
        for (const r of d.db.prepare('SELECT o.owner, o.asset_id, o.descriptor FROM edge_body_owners_v1 o WHERE o.world_id=? ORDER BY o.asset_id LIMIT 200').all(d.worldId) as { owner: string; asset_id: string; descriptor: string }[]) {
          const desc = JSON.parse(r.descriptor) as { type?: string; modelUrl?: string };
          rows.push({ sha: r.asset_id.slice(5), kind: `body:${desc.type ?? 'unknown'}`, url: desc.modelUrl ?? `/v1/edge/body/assets/${r.asset_id}.glb`, name: null, by: r.owner, at: null });
        }
      } catch { /* no Soul body uploads here */ }
      try {
        for (const r of d.db.prepare('SELECT soul_id, hash FROM soul_profile_photos_v1 WHERE world_id=? LIMIT 200').all(d.worldId) as { soul_id: string; hash: string }[])
          rows.push({ sha: r.hash, kind: 'profile-photo', url: `/v1/souls/${r.soul_id}/profile-photo/${r.hash}`, name: null, by: r.soul_id, at: null });
      } catch { /* no profile photos here */ }
      return c.json({ uploads: rows.map((r) => ({ ...r, ...view(r.sha) })), version: store.version() }, 200, noStore);
    } catch (e) { return fail(c, e); }
  });
  app.get('/v1/moderation/log', async (c) => {
    try {
      const w = await who(c), sha = targetSha(c.req.query('sha') ?? '') ?? undefined;
      const limit = Math.floor(Number(c.req.query('limit') ?? 100)) || 100;
      // a creator sees the site admin's actions on files this world holds; the admin sees all
      const mine = new Set<string>();
      if (w.role !== 'admin') {
        try { for (const r of d.db.prepare('SELECT sha FROM world_assets_v1 WHERE world_id=?').all(d.worldId) as { sha: string }[]) mine.add(r.sha); } catch { /* none */ }
        try { for (const r of d.db.prepare('SELECT asset_id FROM edge_body_assets_v1 WHERE world_id=?').all(d.worldId) as { asset_id: string }[]) mine.add(r.asset_id.slice(5)); } catch { /* none */ }
      }
      return c.json({ log: store.log({ sha, limit, site: w.role === 'admin' ? 'all' : mine }), version: store.version() }, 200, noStore);
    } catch (e) { return fail(c, e); }
  });
  const act = (action: 'hide' | 'unhide' | 'release') => async (c: Context) => {
    try {
      const w = await who(c), t = await target(c);
      if (action === 'release' && w.role !== 'admin') throw new ModError(403, 'forbidden', 'only the site admin releases a quarantined upload');
      const before = store.state(t.sha);
      const site = w.role === 'admin' && action !== 'release' && t.scope !== 'world';
      const already = action === 'hide' ? (w.role === 'admin' ? before.adminVeto : before.creatorVeto) : action === 'unhide' ? !(w.role === 'admin' ? before.adminVeto : before.creatorVeto) : !before.quarantined;
      const entry = already ? null : store.append({ sha: t.sha, action, actor: w.actor, role: w.role, reason: t.reason, scope: site ? 'site' : 'world' });
      return c.json({ ok: true, changed: !already, entry, state: view(t.sha), version: store.version() }, 200, noStore);
    } catch (e) { return fail(c, e); }
  };
  app.post('/v1/moderation/hide', act('hide'));
  app.post('/v1/moderation/unhide', act('unhide'));
  app.post('/v1/moderation/release', act('release'));
  return store;
}

/** A world/1 snapshot without the entities (and their children) whose definitions use a hidden file. */
export function withoutHidden<S extends { defs: { ref?: string; hash?: string; name?: string; version?: number }[]; entities: { id: string; def: string; params?: unknown; in?: { parent?: string } }[]; assetBytes?: Record<string, number> }>(snap: S, hidden: Set<string>): S {
  const keys = (def: S['defs'][number]) => [def.ref, def.hash && `sha:${def.hash}`, def.name && def.version !== undefined && `${def.name}@${def.version}`].filter((k): k is string => !!k);
  const alias = (r: string) => [r, r.replace(/^core\//, 'core-'), r.replace(/^core-/, 'core/')];
  const tainted = new Set<string>();
  const mentionsHidden = (v: unknown) => (JSON.stringify(v ?? null).match(/[0-9a-f]{64}/g) ?? []).some((s) => hidden.has(s));
  for (const def of snap.defs) if (mentionsHidden({ ...def, hash: undefined })) keys(def).forEach((k) => tainted.add(k));
  for (let changed = true; changed;) {
    changed = false;
    for (const def of snap.defs) {
      if (keys(def).some((k) => tainted.has(k))) continue;
      if (definitionRefs(def).some((r) => alias(r).some((a) => tainted.has(a)))) { keys(def).forEach((k) => tainted.add(k)); changed = true; }
    }
  }
  const drop = new Set<string>();
  for (const e of snap.entities) if (alias(e.def).some((a) => tainted.has(a)) || definitionRefs(e.params ?? null).some((r) => alias(r).some((a) => tainted.has(a)))) drop.add(e.id);
  for (let changed = drop.size > 0; changed;) {
    changed = false;
    for (const e of snap.entities) if (!drop.has(e.id) && e.in?.parent && drop.has(e.in.parent)) { drop.add(e.id); changed = true; }
  }
  const assetBytes = snap.assetBytes ? Object.fromEntries(Object.entries(snap.assetBytes).filter(([s]) => !hidden.has(s))) : undefined;
  return { ...snap, defs: snap.defs.filter((def) => !keys(def).some((k) => tainted.has(k))), entities: snap.entities.filter((e) => !drop.has(e.id)), ...(assetBytes ? { assetBytes } : {}) };
}

// ---- the stand-in body served for a hidden Soul body

let humanoid: Promise<Uint8Array> | null = null, rigid: Uint8Array | null = null;
async function standIn(isHumanoid: boolean): Promise<Uint8Array> {
  if (isHumanoid) {
    humanoid ??= import('../edge/body/testing.ts').then((m) => new Uint8Array(m.canonicalHumanoidGLB())).catch(() => { humanoid = null; return rigidStandIn(); });
    return humanoid;
  }
  return rigidStandIn();
}
/** A one-triangle, centimetre-sized rigid body: valid, and effectively invisible. */
function rigidStandIn(): Uint8Array {
  if (rigid) return rigid;
  const bin = Buffer.alloc(36);
  [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const json = { asset: { version: '2.0', generator: 'sim moderation stand-in' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.01, 0.01, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const raw = Buffer.from(JSON.stringify(json)), jlen = Math.ceil(raw.length / 4) * 4, total = 12 + 8 + jlen + 8 + 36, o = Buffer.alloc(total);
  o.writeUInt32LE(0x46546c67, 0); o.writeUInt32LE(2, 4); o.writeUInt32LE(total, 8); o.writeUInt32LE(jlen, 12); o.writeUInt32LE(0x4e4f534a, 16); o.fill(0x20, 20, 20 + jlen); raw.copy(o, 20);
  o.writeUInt32LE(36, 20 + jlen); o.writeUInt32LE(0x004e4942, 24 + jlen); bin.copy(o, 28 + jlen);
  return (rigid = new Uint8Array(o));
}
