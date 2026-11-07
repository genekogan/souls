// HTTP for the entity world: public reads for viewers, god writes behind a god
// token, pairing, prayers. Mounted like the edge routes (plain app.get/post).
import { packColumnsV1, worldEntityOrderV1 } from '@souls/protocol';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { TILE_N } from '@souls/ground';
import { drawableEntities } from './look.ts'; // r2.1 (own line: keeps clear of the cloud y5 import hunk)
import { ApiError } from '../souls.ts';
import type { UserRow } from '../db.ts';
import type { GodMode } from './god.ts';
import { godSchema } from './schema.ts';
import { engineSettled, runQuery } from './query.ts';
import { mirrorCurrent, mirrorPayload, type MirrorWant } from './mirror.ts';
import { actWithRepair, parseRepair } from './repair.ts';
import { mountAssetRoutes } from './assets.ts';
import { godBodyLimit } from './ingestion.ts';
import { godVersions } from './versions.ts';
import { SnapshotCache, SNAPSHOT_FILTERED_HEADER } from './snapshot-cache.ts';
import { SnapshotParts, mountSnapshotParts } from './snapshot-wire.ts';
import { moderationFor } from '../moderation/store.ts';
import { withoutHidden } from '../moderation/routes.ts';
import { mountLandRoutes } from './land.ts';
import { mountLightningRoutes } from './lightning.ts';
import { mountLayerRoutes, type GodLayers } from './layers.ts';
import { mountGovernanceRoutes } from './governance.ts';
import { vocab } from '@souls/world-compiler';
import { schemaMarkdown } from '../../../../tools/god-skill/lib/schema-md.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {VerifyUse} from './verify-use.ts';
import { godTokenLimiter } from './rate-limit.ts';
import { RefusalLog } from '../flood.ts';
import { CREATION_LIMITS } from '@souls/generators';
import { siteReport } from './build-integrity.ts';
import { parseHolder } from '../../../../tools/god-skill/lib/locks.mjs';
import { serverDoctor } from './lock-doctor.ts';
import { ATTENTION, BUILD_LIMITS, buildFieldSchema, type Identity } from './builds.ts';
import { HELPER_LIMITS, helperRoute } from './helpers.ts';
import { cobuilderRoute } from './cobuilders.ts';
import { mountLookRoutes } from './look.ts'; // W2 remote looks
import { mountWorkbenchRoutes } from './workbench.ts';
import { mountDistrictRoutes, withDistrict } from './districts.ts'; // Y3 districts
import { hashToken } from '../auth.ts';
import { outcomeOf, TRACE_LIMITS, type TraceRow } from './trace.ts';

export type GodDeps = {
  god: GodMode;
  /** Human world name for the welcome text. */
  worldName: string;
  requireUser: (c: Context) => Promise<UserRow>;
  /** Resolve a Soul from a bearer token for `pray`; null when the token is not a Soul's. */
  soulFromBearer: (c: Context) => { id: string; name: string } | null;
  baseOf: (c: Context) => string;
  limitIp: (c: Context, key: string, max: number, windowMs: number) => void;
  verifyUse?: VerifyUse;
  lookWorldUrl?: string; // W2: configured loopback URL, never derived from request headers
  /** RL6 in-process replay only: false skips the per-token rate windows (authentication still runs). */
  rateLimit?: boolean;
};

const codeSchema = z.object({ code: z.string().min(4).max(12) });
const prayerSchema = z.object({ text: z.string().min(1).max(2000) });
const answerSchema = z.object({ prayer: z.string(), text: z.string().min(1).max(4000) });
const noStore = { 'cache-control': 'no-store' };

export function mountGodRoutes(app: Hono, d: GodDeps): { partRefs: () => { defs: string; ground: string } | null } {
  // RL7 trace (trace.ts): metadata of every god request, recorded after the route answered — never payload text.
  const trace = d.god.trace, traced = new WeakMap<Context, { build?: string; step?: number }>();
  app.use('/v1/god/*', async (c, next) => {
    if (!trace.enabled) return next();
    // CE8 attention hints are not authoring calls: the god never sees them, so they stay out of rows and loop hints.
    if (c.req.path === '/v1/god/stream' || c.req.path === '/v1/god/trace' || /^\/v1\/god\/builds\/[^/]+\/attention$/.test(c.req.path)) { await next(); if (bearer(c)?.startsWith('god_')) trace.skip(); return; }
    const t0 = performance.now(), json = c.json; let result: unknown;
    c.json = ((o: unknown, ...rest: unknown[]) => { result = o; return (json as (...a: unknown[]) => Response)(o, ...rest); }) as typeof c.json;
    await next();
    const token = bearer(c), identity = identities.get(c) ?? (token?.startsWith('god_') ? d.god.godIdentity(token) : undefined);
    if (identity === undefined) return;
    const status = c.res.status, { code, field } = outcomeOf(result, c.error, status), via = traced.get(c);
    const echo = (result as { build?: { id?: unknown; step?: { n?: unknown } } } | null | undefined)?.build;
    const build = via?.build ?? (c.req.path.startsWith('/v1/god/builds/') ? c.req.param('id') : undefined) ?? (typeof echo?.id === 'string' ? echo.id : undefined);
    const step = via?.step ?? (typeof echo?.step?.n === 'number' ? echo.step.n : undefined);
    const row: TraceRow = { at: d.god.now(), method: c.req.method, route: c.req.routePath, status, ms: Math.round((performance.now() - t0) * 10) / 10, tok: (identity?.hash ?? hashToken(token!)).slice(0, 8), code };
    if (build) row.build = build; if (step !== undefined) row.step = step; if (field) row.field = field;
    trace.record(row);
  });
  for (const path of ['/v1/god/builds', '/v1/god/builds/*']) app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.use('/v1/god/*', godBodyLimit(() => d.god.model.constants.limits.budget));
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const identities = new WeakMap<Context, Identity>(), resolved = new WeakMap<Context, Identity | null>();
  const identityOf = (c: Context) => { if (!resolved.has(c)) resolved.set(c, d.god.godIdentity(bearer(c))); return resolved.get(c)!; };
  // WD7 slice 3: helper tokens are authorised per route (deny by default) before any handler runs.
  app.use('/v1/god/*', async (c, next) => {
    const token = bearer(c);
    if (token?.startsWith('god_')) {
      const identity = identityOf(c);
      if (identity?.child) { const denied = helperRoute(c.req.method, c.req.path, identity.child); if (denied) throw new ApiError(403, 'helper.scope', denied, { build: identity.child.build, claim: identity.child.claim }); }
      else if (!identity) {
        const off = d.god.cobuilderRefusal(token); if (off) throw new ApiError(403, 'cobuilder.disabled', off);
        const ended = d.god.helperRefusal(token); if (ended) throw new ApiError(401, 'helper.expired', ended);
      }
      // Y4b: co-builder tokens (and their helpers) never reach env, weather or lightning, and never mint.
      if (identity?.cobuilder !== undefined) { const denied = cobuilderRoute(c.req.method, c.req.path); if (denied) throw new ApiError(403, 'cobuilder.scope', denied); }
    }
    await next();
  });
  // Y4b: a co-builder pauses, resumes, finishes and abandons only builds its account leads, and takes or releases only its
  // account's claims. Refused like any other build action ({ok:false, failures}); owner tokens pass untouched.
  const lifecycle = { pause: 'pause', resume: 'resume', done: 'finish', abandon: 'abandon' } as const;
  app.use('/v1/god/builds/:id/:action{pause|resume|done|abandon|claims}', async (c, next) => {
    const who = c.req.method === 'POST' ? identityOf(c) : null;
    if (who?.cobuilder !== undefined) {
      const id = c.req.param('id'), action = c.req.param('action') as keyof typeof lifecycle | 'claims';
      const take = action === 'claims' ? (await c.req.json().catch(() => null) as { take?: unknown } | null)?.take : undefined;
      const refused = action === 'claims' ? (typeof take === 'string' ? d.god.builds.foreignTo(who, id, take, 'take') : null) : d.god.builds.foreignTo(who, id, undefined, lifecycle[action]);
      if (refused) return c.json({ ok: false, failures: [refused] }, 200, noStore);
    }
    await next();
  });
  app.use('/v1/god/builds/:id/claims/:cid/release', async (c, next) => {
    const who = c.req.method === 'POST' ? identityOf(c) : null;
    const refused = who?.cobuilder !== undefined ? d.god.builds.foreignTo(who, c.req.param('id'), c.req.param('cid'), 'release') : null;
    if (refused) return c.json({ ok: false, failures: [refused] }, 200, noStore);
    await next();
  });
  const capRefusals = new RefusalLog();
  const requireGod = (c: Context) => {
    const cached = identities.get(c); if (cached) return cached;
    const identity = identityOf(c);
    if (!identity) throw new ApiError(401, 'unauthorized', 'missing or invalid god token; pair with POST /v1/god/pair/start');
    identity.holder = parseHolder(c.req.header('x-eden-god-holder'));
    identities.set(c, identity); d.god.builds.touch(identity.hash, d.god.now()); return identity;
  };
  const tokenLimit: ReturnType<typeof godTokenLimiter> = d.rateLimit === false ? c => { requireGod(c); } : godTokenLimiter(requireGod);
  const limitGod: typeof tokenLimit = (c, bucket, max) => { try { tokenLimit(c, bucket, max); } catch (e) { if (e instanceof ApiError && e.status === 429) { e.extra = { ...e.extra, retryAfterMs: Number(e.extra?.retry_after ?? 1) * 1000 }; } throw e; } };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const optionalBody = async (c: Context) => { const text = await c.req.text(); if (!text.trim()) return {}; try { return JSON.parse(text); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const asGod = <T>(c: Context, b: { build?: unknown } | null, fn: () => T) => {
    const identity = requireGod(c), parsed = buildFieldSchema.optional().safeParse(b?.build);
    if (!parsed.success) return { accepted: false as const, failures: parsed.error.issues.map(i => ({ op: -1, code: 'schema', field: `build.${i.path.join('.')}`, detail: i.message })) };
    if (parsed.data) traced.set(c, { build: parsed.data.id, step: parsed.data.step });
    return d.god.as({ identity, build: parsed.data }, fn);
  };
  // assets (GET /assets/<sha>.<ext>, POST /v1/god/assets) and the catalog (GET /v1/god/defs?q=, /v1/god/defs/<ref>[/thumb.png]): L5
  // W1: mount exact /defs/unused before the catalog's wildcard def route.
  mountWorkbenchRoutes(app, { god: d.god, requireGod, limitGod, asGod: (c, fn) => d.god.as({ identity: requireGod(c) }, fn) });
  mountAssetRoutes(app, { god: d.god, requireGod, store: d.god.assets, asGod: (c, fn) => d.god.as({ identity: requireGod(c) }, fn) });
  mountLandRoutes(app, { god: d.god, requireGod });
  mountDistrictRoutes(app, { districts: () => d.god.districts, requireGod, limitGod }); // Y3: POST/GET /v1/god/districts[/:id]
  mountLookRoutes(app, { requireGod, worldUrl: d.lookWorldUrl, entities: () => drawableEntities(d.god.model) }); // W2 remote looks; r2.1: bodies are never drawn
  mountLightningRoutes(app, { god: d.god, requireGod, tick: () => d.god.opts.tick() });
  // LAYERS: GET /v1/world/layers, /v1/world/layers/me (Soul), /v1/god/layers, /v1/god/layers/zone-suggest?use=
  mountLayerRoutes(app, { god: d.god, layers: () => (d.god as unknown as { layers?: GodLayers }).layers, requireGod, soulFromBearer: d.soulFromBearer, categoryOf: (x) => vocab.categoryOf(x as never) });   // GOD-ENV: POST /v1/god/strike   // GOD-ENV: POST /v1/god/land (raise, mountain, valley, move, water, extend …)

  mountGovernanceRoutes(app, { god: d.god, requireGod, soulFromBearer: d.soulFromBearer });   // GOVERN: constitution versions, amendments, prayer states

  // ---- public reads (the renderer's view of the world; Gene: topology and placements are public)
  // lane W1: built once per state of the world and served precompressed (snapshot-cache.ts), hidden entities already out
  const moderation = moderationFor(d.god.db.db, d.god.opts.worldId);
  const snapshots = new SnapshotCache({ build: () => d.god.publicSnapshot(),
    key: () => `${d.god.model.editSeq}.${d.god.model.seq}.${d.god.store.buildsRev()}.${moderation.version()}`,
    filter: (snap) => { const hidden = moderation.hidden(); return hidden.length ? withoutHidden(snap as Parameters<typeof withoutHidden>[0], new Set(hidden)) : snap; } });
  // lane W3: `?defs=ref`, the wire form (snapshot-wire.ts): the same picture without defs/ground/default params, which
  // come as immutable content-addressed parts; built and cached per state exactly like the plain one
  const parts = new SnapshotParts();
  const wireSnapshots = new SnapshotCache({ key: () => `${d.god.model.editSeq}.${d.god.model.seq}.${d.god.store.buildsRev()}.${moderation.version()}`,
    build: () => { const snap = d.god.publicSnapshot(), hidden = moderation.hidden(); return parts.cut((hidden.length ? withoutHidden(snap as Parameters<typeof withoutHidden>[0], new Set(hidden)) : snap) as Record<string, unknown>, moderation.version()); } });
  // lane JOINSET: `?defs=ref&cols=1`, the wire form with its entities in the column form (columns/1, packages/protocol)
  const colsSnapshots = new SnapshotCache({ key: () => `${d.god.model.editSeq}.${d.god.model.seq}.${d.god.store.buildsRev()}.${moderation.version()}`,
    build: () => { const snap = d.god.publicSnapshot(), hidden = moderation.hidden(), body = parts.cut((hidden.length ? withoutHidden(snap as Parameters<typeof withoutHidden>[0], new Set(hidden)) : snap) as Record<string, unknown>, moderation.version());
      return { ...body, entities: packColumnsV1(body.entities, worldEntityOrderV1) ?? body.entities }; } });
  mountSnapshotParts(app, parts, () => wireSnapshots.respond(undefined));
  app.get('/v1/world/snapshot', async (c) => {
    const wire = c.req.query('defs') === 'ref', cols = wire && c.req.query('cols') === '1', r = await (cols ? colsSnapshots : wire ? wireSnapshots : snapshots).respond(c.req.header('accept-encoding'));
    return c.body(new Uint8Array(r.body), 200, { 'content-type': 'application/json; charset=UTF-8', ...noStore, vary: 'Accept-Encoding', [SNAPSHOT_FILTERED_HEADER]: '1',
      ...(wire && parts.current ? { 'x-defs-ref': parts.current.defs, 'x-ground-ref': parts.current.ground } : {}),
      ...(r.encoding ? { 'content-encoding': r.encoding } : {}), ...(r.ageSeconds > 0 ? { age: String(r.ageSeconds) } : {}) });
  });
  app.get('/v1/world/seq', (c) => { const b = d.god.builds.publicList(); return c.json({ seq: d.god.model.editSeq, entities: d.god.model.entities.size, builds: b.rev }, 200, noStore); });
  app.get('/v1/world/builds', (c) => c.json(d.god.builds.publicList(), 200, noStore));
  app.get('/v1/world/ground', (c) => c.json({ contract: 'ground/1', ground: d.god.model.ground(), tiles: d.god.tileHashes() }, 200, noStore));
  app.get('/v1/world/tiles/:tx/:tz', (c) => {
    const tx = Number(c.req.param('tx')), tz = Number(c.req.param('tz'));
    if (!Number.isInteger(tx) || !Number.isInteger(tz)) throw new ApiError(400, 'invalid', 'tile indices must be integers');
    const t = d.god.tile(tx, tz);
    if (!t) throw new ApiError(404, 'not-found', 'tile outside the world');
    const hash = d.god.model.terrain.hash(tx, tz);
    if (c.req.header('if-none-match') === `"${hash}"`) return c.body(null, 304);
    return c.body(new Uint8Array(t.buffer, t.byteOffset, t.byteLength) as never, 200, { 'content-type': 'application/octet-stream', 'x-tile-n': String(TILE_N), etag: `"${hash}"`, 'cache-control': 'public, max-age=60' });
  });
  app.get('/v1/world/entities/:id{.+}', (c) => { const e = d.god.model.get(c.req.param('id')); if (!e) throw new ApiError(404, 'not-found', 'no such entity'); return c.json({ entity: e, path: d.god.model.pathOf(e.id), pose: d.god.model.worldPose(e) }, 200, noStore); });

  // ---- onboarding: who am I here, the welcome text, the skill and CLI files
  const skillDir = resolve(new URL('../../../../tools/god-skill/', import.meta.url).pathname);
  const serveFile = (name: string, type: string) => (c: Context) => { try { return c.body(readFileSync(resolve(skillDir, name), 'utf8'), 200, { 'content-type': type, 'cache-control': 'no-cache' }); } catch { throw new ApiError(404, 'not-found', `${name} is not available on this server`); } };
  app.get('/god/SKILL.md', serveFile('SKILL.md', 'text/markdown; charset=utf-8'));
  app.get('/god/skill.md', serveFile('SKILL.md', 'text/markdown; charset=utf-8'));
  app.get('/god/eden-god.mjs', serveFile('eden-god.mjs', 'text/javascript; charset=utf-8'));
  app.get('/god/kit-primitives.png', (c) => {
    try { return c.body(new Uint8Array(readFileSync(resolve(skillDir, 'reference/kit-primitives.png'))), 200, { 'content-type': 'image/png', 'cache-control': 'no-cache' }); }
    catch { throw new ApiError(404, 'not-found', 'kit-primitives.png is not available on this server'); }
  });
  app.get('/god/SCHEMA.md', (c) => c.body(schemaMarkdown(godSchema(d.god.model.constants.limits)), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' }));
  app.get('/god/examples/:file{[a-z0-9-]+\\.(mjs|log)}', (c) => { const f = c.req.param('file'); return serveFile(`examples/${f.endsWith('.mjs') ? '' : 'shots/'}${f}`, f.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8')(c); });
  app.get('/v1/god/status', async (c) => {
    let user: UserRow | null = null; try { user = await d.requireUser(c); } catch { /* visitor */ }
    const god = identityOf(c); if (god) d.god.builds.touch(god.hash);
    const you = god?.child ? 'helper' : god?.cobuilder !== undefined ? 'cobuilder' : god ? 'god' : user && d.god.owner === user.id ? 'owner' : user && !d.god.owner ? 'claimant' : user ? 'visitor' : 'anonymous';
    const owner = you === 'owner' || you === 'god';
    return c.json({ versions: godVersions, worldId: d.god.opts.worldId, name: d.worldName, hasOwner: !!d.god.owner, you, pending: owner ? d.god.pendingPairings() : [], entities: d.god.model.entities.size, seq: d.god.model.editSeq, base: d.baseOf(c), template: d.god.template, ...(owner ? { agents: d.god.store.tokens().filter((t) => t.label !== 'browser').length, builds: d.god.builds.summaries() } : {}) }, 200, noStore);
  });
  app.get('/v1/god/welcome', async (c) => { const u = await d.requireUser(c); if (!d.god.canApprove(u)) throw new ApiError(403, 'forbidden', 'only this world\'s owner'); return c.text(d.god.welcome(d.baseOf(c), d.worldName), 200, { 'content-type': 'text/markdown; charset=utf-8', ...noStore }); });
  app.get('/v1/god/pairings', async (c) => { const u = await d.requireUser(c); if (!d.god.canApprove(u)) throw new ApiError(403, 'forbidden', 'only this world\'s owner'); return c.json({ pending: d.god.pendingPairings() }, 200, noStore); });

  // ---- pairing (agent-initiated, approved by the world's owner in the browser)
  app.post('/v1/god/pair/start', async (c) => { d.limitIp(c, 'godpairstart', 6, 60_000); const b = await body(c).catch(() => ({})); return c.json({ ok: true, ...d.god.pairStart(typeof b?.agent === 'string' ? b.agent : undefined, d.baseOf(c)) }, 200, noStore); });
  app.get('/v1/god/pair/:code', async (c) => { await d.requireUser(c); return c.json(d.god.pairInfo(c.req.param('code')), 200, noStore); });
  app.post('/v1/god/pair/approve', async (c) => { const u = await d.requireUser(c); const p = codeSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { code }'); d.god.pairApprove(u, p.data.code); return c.json({ ok: true }, 200, noStore); });
  app.post('/v1/god/pair/poll', async (c) => { d.limitIp(c, 'godpairpoll', 60, 60_000); const b = await body(c); if (typeof b?.poll_token !== 'string') throw new ApiError(400, 'invalid', 'body must be { poll_token }'); return c.json({ ok: true, ...d.god.pairPoll(b.poll_token) }, 200, noStore); });
  /** Claim an unowned world for the signed-in user (the launcher does this for the creator at birth). Idempotent for the owner. */
  app.post('/v1/god/claim', async (c) => {
    const u = await d.requireUser(c);
    if (d.god.owner && d.god.owner !== u.id) throw new ApiError(403, 'forbidden', 'this world already has a god');
    d.god.claim(u);
    return c.json({ ok: true, worldId: d.god.opts.worldId, owner: u.id }, 200, noStore);
  });
  /** The owner's browser (or a local agent) mints a god token with the owner's own signed-in identity; claims an unowned world. */
  app.post('/v1/god/mint', async (c) => { const u = await d.requireUser(c); const b = await body(c).catch(() => ({})); return c.json({ ok: true, token: d.god.mintFor(u, typeof b?.label === 'string' ? b.label : 'owner'), world: d.god.opts.worldId }, 200, noStore); });

  // ---- god
  app.get('/v1/god/parts', (c) => { limitGod(c, 'parts', CREATION_LIMITS.godQueriesPerMinute); return c.json({ parts: d.god.parts.list(c.req.query('q') ?? '', Number(c.req.query('limit') ?? 50)) }, 200, noStore); });
  const doctorIdentity = (c: Context) => { const identity = d.god.godIdentity(bearer(c)); if (!identity) throw new ApiError(401, 'unauthorized', 'missing or invalid god token'); return identity; };
  // #1198: what a rewind could not repair and has set aside; empty when nothing is, and gone from here once it stops firing
  app.get('/v1/god/contained', (c) => { requireGod(c); if (!d.god.contained) throw new ApiError(503, 'contained.unavailable', 'This world has no engine bridge, so it cannot say what is contained.'); return c.json({ contained: d.god.contained() }, 200, noStore); });
  app.get('/v1/god/doctor', c => c.json(serverDoctor(d.god.builds, d.verifyUse, doctorIdentity(c)), 200, noStore));
  app.post('/v1/god/doctor', async c => { const who = doctorIdentity(c); const input = z.object({ fix: z.literal(true) }).strict().parse(await body(c)); return c.json(serverDoctor(d.god.builds, d.verifyUse, who, input.fix), 200, noStore); });
  app.post('/v1/god/builds', async (c) => { limitGod(c, 'build-start', BUILD_LIMITS.startPerMinute); const r = d.god.builds.start(await body(c), requireGod(c)); const district = r.ok ? d.god.districts.report(r.build) : undefined; return c.json(r.ok ? { ...r, report: { ...siteReport(d.god.model.fork(), { ...r.build, roots: r.build.roots.map(root => root.id) }, r.inventory, d.god.builds.inventoryContext?.()), ...(district ? { district } : {}) }, parts: d.god.parts.suggest(r.build), build: { ...r.build, reuse: d.god.parts.reuseOf(r.build.id) } } : r, 200, noStore); });
  // RL7: loop hints (the same refusal code + field 3+ times in 2 min) ride on build show
  app.get('/v1/god/builds', (c) => { requireGod(c); const loops = trace.loops(); return c.json({ ...d.god.builds.list(), ...(loops.length ? { loops } : {}) }, 200, noStore); });
  app.get('/v1/god/builds/:id', (c) => { requireGod(c); const result = d.god.builds.status(c.req.param('id')); if (!result) throw new ApiError(404, 'not-found', 'unknown build'); const reuse = d.god.parts.reuseOf(result.build.id), loops = trace.loops({ build: result.build.id }); return c.json(withDistrict(d.god.districts, { ...result, reuse, build: { ...result.build, reuse }, ...(loops.length ? { loops } : {}) }), 200, noStore); });
  app.get('/v1/god/trace', (c) => {
    const who = requireGod(c), build = c.req.query('build'), limit = Number(c.req.query('limit') ?? 50);
    if (build !== undefined && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(build)) throw new ApiError(400, 'invalid', 'build must be a build id');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new ApiError(400, 'invalid', 'limit must be 1..1024');
    return c.json({ now: d.god.now(), you: who.hash.slice(0, 8), enabled: trace.enabled, window: { loopMs: TRACE_LIMITS.loopWindowMs, loopMin: TRACE_LIMITS.loopMin }, stats: trace.summary(), loops: trace.loops({ build }), rows: trace.rows({ build, limit }) }, 200, noStore);
  });
  app.post('/v1/god/builds/:id/check', async c => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); requireGod(c); const r = d.god.checkBuild(c.req.param('id')); if (!r) throw new ApiError(404, 'not-found', 'unknown build'); return c.json(r, 200, noStore); });
  app.post('/v1/god/builds/:id/step', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); return c.json(d.god.builds.step(c.req.param('id'), await body(c), requireGod(c)), 200, noStore); });
  app.post('/v1/god/builds/:id/pause', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); return c.json(d.god.builds.pause(c.req.param('id'), await optionalBody(c), requireGod(c)), 200, noStore); });
  app.post('/v1/god/builds/:id/resume', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); return c.json(withDistrict(d.god.districts, d.god.builds.resume(c.req.param('id'), await optionalBody(c), requireGod(c))), 200, noStore); });
  app.post('/v1/god/builds/:id/done', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); const r = d.god.builds.done(c.req.param('id'), await optionalBody(c), requireGod(c)); const reuse = r.ok ? d.god.parts.reuseOf(r.build.id) : undefined; return c.json(r.ok ? withDistrict(d.god.districts, { ...r, receipt: r.build.done?.receipt, reuse, build: { ...r.build, reuse } }) : r, 200, noStore); });
  app.post('/v1/god/builds/:id/abandon', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); const id = c.req.param('id'); const b = await optionalBody(c); return c.json(d.god.as({ identity: requireGod(c) }, () => d.god.builds.abandon(id, b, () => d.god.undoGroupUnder(id, b.force === true))), 200, noStore); });
  // Y5: atomic rewind to after step k ({to, dry?, force?}); any god token, like done/abandon (the owner card).
  app.post('/v1/god/builds/:id/rewind', async (c) => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); const id = c.req.param('id'); const b = await body(c); return c.json(d.god.as({ identity: requireGod(c) }, () => d.god.rewind(id, b)), 200, noStore); });
  // CE8: fire-and-forget look hint from the lead; memory only, published on the public site.
  app.post('/v1/god/builds/:id/attention', async c => { limitGod(c, 'attention', ATTENTION.perMinute); return c.json(d.god.builds.attend(c.req.param('id'), await body(c), requireGod(c)), 200, noStore); });
  app.post('/v1/god/builds/:id/claims', async c => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); return c.json(d.god.builds.claim(c.req.param('id'), await body(c), requireGod(c)), 200, noStore); });
  // WD7 slice 3: the claim's holder mints a scoped helper token; the response carries only the new token.
  app.post('/v1/god/builds/:id/claims/:cid/helper', async c => { limitGod(c, 'helper-mint', HELPER_LIMITS.mintPerMinute); return c.json(d.god.mintHelper(c.req.param('id'), c.req.param('cid'), await optionalBody(c), requireGod(c)), 200, noStore); });
  app.post('/v1/god/builds/:id/claims/:cid/release', async c => { limitGod(c, 'builds', BUILD_LIMITS.editsPerMinute); return c.json(d.god.builds.release(c.req.param('id'), c.req.param('cid'), await optionalBody(c)), 200, noStore); });
  app.get('/v1/god/schema', (c) => c.json(godSchema(d.god.model.constants.limits), 200, { 'cache-control': 'public, max-age=60' }));
  app.post('/v1/god/verify-use', async (c) => {
    limitGod(c, 'verify-use', CREATION_LIMITS.verifyPerMinute);
    const who = requireGod(c);
    if (who.child && !d.god.helpers.spendVerify(who.hash)) throw new ApiError(403, 'helper.budget', `helper token ${who.label} has used its ${who.child.verify.budget} verify-use calls; ask the lead to verify`, { budget: who.child.verify.budget });
    const raw = await c.req.json().catch(() => null);
    const receipt = d.verifyUse ? await d.verifyUse.run(raw) : {ok: false, target: typeof raw?.target === 'string' ? raw.target : '', uses: [], probe: {created: false, removed: true, removal: 'done' as const}, timings: {birth: 0, start: 0, enter: 0, sit: 0, retire: 0}, ms: 0, notes: [], reason: {code: 'verify.refused' as const, engineCode: 'unavailable', message: 'Resident verification is unavailable in this world.'}};
    d.god.parts.recordVerify(receipt, requireGod(c));
    return c.json(receipt, 200, noStore);
  });
  app.post('/v1/god/query', async (c) => { if (d.god.godFromToken(bearer(c))) limitGod(c, 'query', CREATION_LIMITS.godQueriesPerMinute); else d.limitIp(c, 'godquery', CREATION_LIMITS.queriesPerMinute, CREATION_LIMITS.rateWindowMs); const q = await body(c); if (q && typeof q === 'object' && ((q as { reach?: unknown }).reach || (q as { describe?: unknown }).describe)) await engineSettled(d.god.model); return c.json(runQuery(d.god.model, q), 200, noStore); });
  app.post('/v1/god/preview', async (c) => { limitGod(c, 'preview', CREATION_LIMITS.previewsPerMinute); const b = await body(c); return c.json(asGod(c, b, () => d.god.preview(b)), 200, noStore); });
  app.get('/v1/god/preview/:id', (c) => { if (!d.god.canViewPreview(c.req.param('id'), c.req.header('x-preview-key'))) requireGod(c); const v = d.god.getPreview(c.req.param('id')); if (!v) throw new ApiError(404, 'not-found', 'preview expired or unknown'); return c.json({ id: c.req.param('id'), baseEditSeq: v.baseEditSeq, expect: v.expect, subtrees: v.subtrees, diff: v.diff, failures: v.failures ?? null, ops: v.ops }, 200, noStore); });
  app.get('/v1/god/previews', (c) => { requireGod(c); return c.json({ previews: d.god.listPreviews() }, 200, noStore); });
  app.get('/v1/god/snapshot', (c) => { const who = requireGod(c), snapshot = d.god.godSnapshot(); return c.json(who.child ? { ...snapshot, prayers: [] } : snapshot, 200, noStore); });
  app.post('/v1/god/dryrun', async (c) => { limitGod(c, 'dryrun', CREATION_LIMITS.dryrunsPerMinute); const b = await body(c); return c.json(asGod(c, b, () => d.god.dryrun(b)), 200, noStore); });
  // G2: `mirror` (the CLI's mirror state) is not part of the batch: stripped here, answered after the commit with the delta
  // G2: `repair` (place/move candidates, see repair.ts) is not part of the batch either: the server walks them, then commits
  app.post('/v1/god/act', async (c) => {
    limitGod(c, 'act', CREATION_LIMITS.actsPerMinute);
    const raw = await body(c), want = mirrorWant(raw), obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const rep = obj && Object.hasOwn(obj, 'repair') ? parseRepair(obj.repair) : null;
    if (obj && Object.hasOwn(obj, 'repair') && !rep) throw new ApiError(400, 'invalid', 'repair must be { candidates, taken, kind, dry, ifSeq }');
    const b = want || rep ? (({ mirror: _m, repair: _r, ...rest }) => rest)(obj!) : raw;
    const note = typeof b?.note === 'string' ? b.note : undefined, ref = typeof b?.clientRef === 'string' ? b.clientRef : undefined;
    const saved = rep && ref !== undefined ? d.god.store.receipt(ref) : null; // a retry of a repaired edit: its receipt, never a second walk
    const r = saved ? { ...saved.result, replayed: true } : asGod(c, b, () => rep ? actWithRepair(d.god, b as Record<string, unknown>, rep, note) : d.god.act(b, note));
    const caps = !r.accepted && Array.isArray((r as { failures?: unknown }).failures) ? ((r as { failures: { code?: unknown; detail?: unknown }[] }).failures).filter(f => typeof f?.code === 'string' && (f.code.startsWith('budget.') || (f.code === 'schema' && (f as { field?: unknown }).field === 'ops' && /too big/i.test(String(f.detail))))) : [];
    if (caps.length) capRefusals.note('cap', String(caps[0].code), `POST /v1/god/act: ${String(caps[0].detail ?? '')}`);   // P2: caps refused politely, and logged
    return c.json(want && r.accepted ? { ...r, mirror: mirrorPayload(d.god, want, { child: !!requireGod(c).child }) } : r, 200, noStore);
  });
  app.get('/v1/god/mirror', (c) => { const who = requireGod(c), q = c.req.query(), want: MirrorWant = { since: q.since === undefined ? undefined : Number(q.since), builds: q.builds === undefined ? undefined : Number(q.builds), have: q.have, lib: q.lib, ground: q.ground }; return c.json(mirrorCurrent(d.god, want) ? { contract: 'mirror/1', same: true, seq: d.god.model.editSeq } : mirrorPayload(d.god, want, { child: !!who.child }), 200, noStore); });
  app.get('/v1/god/requests/:clientRef', (c) => { requireGod(c); const receipt = d.god.store.receipt(c.req.param('clientRef')); if (!receipt) throw new ApiError(404, 'not-found', 'no committed receipt for this clientRef (only the last 1000 accepted requests are retained)'); return c.json(receipt, 200, noStore); });
  app.get('/v1/god/requests/', (c) => { requireGod(c); const receipt = d.god.store.receipt(''); if (!receipt) throw new ApiError(404, 'not-found', 'no committed receipt for the empty clientRef'); return c.json(receipt, 200, noStore); });
  app.post('/v1/god/undo', async (c) => { limitGod(c, 'undo', BUILD_LIMITS.editsPerMinute); const b = await optionalBody(c), g = c.req.query('group'); return c.json(asGod(c, b, () => g ? d.god.undoGroup(g) : d.god.undo()), 200, noStore); });
  app.post('/v1/god/redo', async (c) => { limitGod(c, 'redo', BUILD_LIMITS.editsPerMinute); const b = await optionalBody(c); return c.json(asGod(c, b, () => d.god.redo()), 200, noStore); });
  app.get('/v1/god/edits', (c) => { requireGod(c); return c.json({ edits: d.god.store.edits(Math.min(200, Number(c.req.query('limit') ?? 50) || 50)) }, 200, noStore); });
  app.get('/v1/god/prayers', (c) => { requireGod(c); return c.json({ prayers: d.god.store.prayers({ unanswered: c.req.query('all') !== '1', limit: 100 }) }, 200, noStore); });
  app.post('/v1/god/answer', async (c) => { requireGod(c); const p = answerSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { prayer, text }'); const row = d.god.answer(p.data.prayer, p.data.text); if (!row) throw new ApiError(404, 'not-found', 'no such prayer'); return c.json({ ok: true, prayer: row }, 200, noStore); });
  app.get('/v1/god/stream', (c) => {
    requireGod(c);
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    c.header('Cache-Control', 'no-cache, no-transform'); c.header('X-Accel-Buffering', 'no');
    const response = streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      c.req.raw.signal?.addEventListener('abort', () => ac.abort(), { once: true });
      await stream.write(`: ${' '.repeat(2048)}\n\n`);
      await stream.writeSSE({ event: 'hello', retry: 3000, data: JSON.stringify({ contract: 'god/1', world: d.god.opts.worldId, head: d.god.head, seq: d.god.model.editSeq }) });
      const queue: Promise<void>[] = [];
      const unsub = d.god.subscribe(after, (e) => { queue.push(stream.writeSSE({ id: String(e.id), event: e.event, data: JSON.stringify(e.data) }).catch(() => ac.abort())); });
      try { while (!ac.signal.aborted) { await new Promise((r) => setTimeout(r, 15_000)); if (!ac.signal.aborted) await stream.write(`: keepalive ${Date.now()}\n\n`); } }
      catch { /* client gone */ }
      finally { unsub(); }
    });
    response.headers.set('Cache-Control', 'no-cache, no-transform');
    return response;
  });

  // ---- Souls: pray (Soul token), read my prayers and any answers
  app.post('/v1/god/pray', async (c) => { const s = d.soulFromBearer(c); if (!s) throw new ApiError(401, 'unauthorized', 'a Soul token is required to pray'); const p = prayerSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { text }'); return c.json({ ok: true, prayer: d.god.pray(s, p.data.text), note: 'The god reads prayers when it is present; an answer, if any, appears under GET /v1/god/prayers/mine.' }, 200, noStore); });
  app.get('/v1/god/prayers/mine', (c) => { const s = d.soulFromBearer(c); if (!s) throw new ApiError(401, 'unauthorized', 'a Soul token is required'); return c.json({ prayers: d.god.prayersFor(s.id) }, 200, noStore); });
  app.get('/v1/world/constitution', (c) => c.text(d.god.model.state.constitution || '(this world has no constitution yet)', 200, { 'content-type': 'text/markdown; charset=utf-8', ...noStore }));

  // P7: the parts the last wire snapshot named, for the world page's HTML (its entry script fetches them at once)
  // (none cut yet, after a restart: start the cut so the next page has them)
  return { partRefs: () => { if (!parts.current) void Promise.resolve().then(() => wireSnapshots.respond(undefined)).catch(() => {}); return parts.current; } };
}

/** G2: the act body's optional `mirror` field ({ since, builds, have, lib }), or null. */
function mirrorWant(raw: unknown): MirrorWant | null {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { mirror?: unknown }).mirror : undefined;
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>, num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined), str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : undefined);
  return { since: num(o.since), builds: num(o.builds), have: str(o.have), lib: str(o.lib), ground: str(o.ground) };
}
