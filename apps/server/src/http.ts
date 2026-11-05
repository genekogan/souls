import {mountSoulRuntimePublication} from './soul-runtime-publication.ts';
import {mountContextViews} from './god/context-views.ts';
import {AutoPortraits} from './portrait/auto-portraits.ts';
import {SoulProfiles} from './soul-profile.ts';
import {WorldAccounts} from './accounts/service.ts';
import {mountAccountRoutes} from './accounts/routes.ts';
import {fillInstructions} from './accounts/instructions.ts';
import {mountWelcomeRoutes} from './welcome.ts';
import { bodyLimit } from 'hono/body-limit';
import {admissionMiddleware, type Admission} from './load/admission.ts';
import type {LoadMonitor} from './load/monitor.ts';
/** SEC2: the absolute request-body ceiling for a non-god route (uploads 17 MB, everything else 1 MB). */
export const bodyCeiling=(path:string)=>/\/v1\/(?:edge\/body\/uploads|art\/media)$/.test(path)?17*1024*1024:1024*1024;
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { decodeJwt } from 'jose';
import { serveStatic } from '@hono/node-server/serve-static';
import { adminSchema, commandSchema, inviteSchema, ownerLifecycleCapabilitySchema, pairApproveSchema, pairExchangeSchema, pairPollSchema, pairStartSchema, publicEvent, setIntentSchema,TAKE_BOUNDARY_WIRE_V1,stringifyTakeBoundaryWireV1 } from '@sim/protocol';
import { hashToken, newId, type Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import { publicWorldBase, type Config } from './config.ts';
import { requestWorldBase } from './world-base.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import { publicTakes, type Hub } from './hub.ts';
import { cardGrammar } from '@sim/brain';
import { skillMd } from './skill.ts';
import { edgeSkillStub } from './edge/skill-stub.ts';
import { agentReader } from './agent-reader.ts';
import { ApiError, type Souls } from './souls.ts';
import { mountMarsStatic } from './mars-static.ts';
import type {TakeArchive} from './take-archive.ts';
import { checkAcceptanceGuard,type AcceptanceGuard,type WorldHost } from './world.ts';
import {captureRenderScene} from '@sim/engine-contract';
import type {CandidateStationV1} from './station.ts';
import type {CandidateStationV2} from './station-v2.ts';
import {mountStationRoutesV2} from './station-routes-v2.ts';
import type {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {EdgeError} from './edge/contract.ts';
import {mountSecretPlaceRoutes} from './edge/perception/secret-routes.ts';
import { mountGodRoutes } from './god/routes.ts';
import { RefusalLog, floodGuard } from './flood.ts';
import { poolOf } from './god/builds.ts';
import {VerifyUse} from './god/verify-use.ts';
import { mountModeration } from './moderation/routes.ts';
import { mountEdgeSnapshot, safeKey, snapshotKey, withSnapshotKey, withWorldClock } from './edge-snapshot.ts';
import { withInlineConfig } from './inline-config.ts';
import { mountSharedLibraryRoutes } from './god/shared-library.ts';
import { mountArtRoutes } from './art/routes.ts';
import { createPaintingService } from './art/painting-completion.ts';
import { defaultAssetDir } from './god/assets.ts';
import { mountEnvRoutes } from './god/world-env.ts';
import { mountJoinRoutes, PUBLISHED_SOUL_CLI, safeWorldName } from './god/join.ts';
import type { GodMode } from './god/god.ts';
import {Travel,TravelError,launcherSite,TRAVEL_CONTRACT} from './travel/travel.ts';
import { bodyRefResolvers } from './edge/body/routes.ts';
import {mountTravelRoutes} from './travel/routes.ts';
import { intentArrivalReadError,intentHistoryReadError,intentTransportError, intentLookupError, type IntentControlV2, type IntentIdentityV2 } from './intent-control.ts';
import {mountAgentInbox, ownerCommandRoute} from './inbox-routes.ts';
import {mountSoulNow} from './soul-now-routes.ts';
import {soulLink} from './soul-link.ts';
import {mountOperatorSouls} from './op-souls.ts';
import { strandedMetrics } from '../../../mars/viewer/engine/spatial/path.ts';

/** The edge requests that build a Soul's menu (here, except its body view; observe; capabilities; around; resolve; and
 *  act/converse, which bind offers through the same caches) and so wait for a serving warm instead of building it cold
 *  on the tick thread. World-relative paths, as admission classifies them. */
export function servingRead(method: string, path: string, view?: string): boolean {
  if (method === 'GET') return (path === '/v1/edge/here' && view !== 'body') || path === '/v1/edge/observe' || path === '/v1/edge/capabilities' || path === '/v1/edge/around';
  return method === 'POST' && (path === '/v1/edge/resolve' || path === '/v1/edge/act' || path === '/v1/edge/converse');
}
/** Continuity (warm after listen): a listing read waits for a running serving warm (EdgeLedger.whenServing, which has a
 *  ceiling) before it goes on. Mounted BEFORE admission, so the wait is never a request in flight (no soul.busy for it)
 *  nor billed as the request's own time; nothing to wait for: no extra turn. */
export function servingWait(whenServing: () => Promise<void> | null): MiddlewareHandler {
  return async (c, next) => { const w = servingRead(c.req.method, c.req.path, c.req.query('view')) ? whenServing() : null; if (w) await w; return next(); };
}
type Deps = { cfg: Config; db: Db; host: WorldHost; auth: Auth; hub: Hub; brain: Brain; souls: Souls; takes?: TakeArchive; station?:CandidateStationV1; stationV2?:CandidateStationV2; intentV2?:IntentControlV2; edge?:EdgeLedger; god?: GodMode; contextReady?:()=>boolean; contextWait?:(signal:AbortSignal)=>Promise<void>; contextLevelAt?:(x:number,z:number,y:number)=>number; load?:{admission?:Admission;monitor:LoadMonitor;crowded?:(soulId:string)=>{position:number;eta_s:number}|null} };

export function buildApp(d: Deps) {
  if(d.station&&d.station.host!==d.host)throw new Error('station must belong to selected host');
  if(d.stationV2&&d.stationV2.host!==d.host)throw new Error('V2 station must belong to selected host');
  if(d.intentV2&&(d.intentV2.host!==d.host||d.intentV2.brain!==d.brain||d.intentV2.souls!==d.souls))throw new Error('intent transport must belong to selected host');
  const app = new Hono();
  if(d.cfg.accountAuthRequired)d.souls.accounts??=new WorldAccounts(d.host,d.souls);
  if(d.souls.accounts)d.auth.legacyOwnerAllowed=owner=>d.souls.ownedRows(owner).length>0;
  d.host.profileWorldPath=d.cfg.worldPath;
  const profiles=new SoulProfiles(d.host,d.souls);
  // resident looks v2: automatic portraits for humanoid looks (SIM_AUTO_PORTRAITS=0 turns them off)
  const portraits=new AutoPortraits(d.host);profiles.autoBytes=(id,hash)=>portraits.bytes(id,hash);
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  // P2 runaway-agent protection: overall buckets per god token and per visitor address, before anything else answers
  // (SIM_FLOOD=0 turns it off for a local experiment)
  const refusals = new RefusalLog();   // every 429/413 this world answers, in its log without flooding it
  if (process.env.SIM_FLOOD !== '0') app.use('*', floodGuard({ log: refusals, godPool: (t) => { const who = d.god?.godIdentity(t); return who ? poolOf(who) : hashToken(t); } }));
  // SEC2 2026-10-21: a ceiling on every request body before any route reads one. Routes mounted above the /v1/* 64 KB
  // limit below (edge, travel, art, moderation) otherwise read a chunked body (no content-length) without bound: one
  // anonymous 200 MB POST to /v1/edge/say grew a world by ~90-500 MB. Tighter route limits still apply; god routes keep
  // their own budget-sized limit. 1 MB is ~15x the largest normal JSON body; uploads (16 MB) get 16 MB + 1 MB.
  app.use('*',async(c,next)=>c.req.method==='GET'||c.req.method==='HEAD'||/\/v1\/god\//.test(c.req.path)?next():bodyLimit({maxSize:bodyCeiling(c.req.path),onError:(c)=>{refusals.note('size','too-large',`${c.req.method} ${c.req.path}`);return c.json({ok:false,code:'too-large',message:'request body is too large'},413);}})(c,next));
  // Continuity (warm after listen): right after a restart the menus' caches are built in slices (EdgeLedger.warmForServing);
  // a listing read waits for that (with a ceiling) instead of building them cold in its own turn. Keep it BEFORE admission.
  if (d.edge) { const edge = d.edge; app.use('/v1/edge/*', servingWait(() => edge.whenServing())); }
  // srv-load (LOAD-CONTRACT §2): heavy Soul/god requests queue for the admission dispatcher; edge answers carry X-Sim-Load
  if (d.load?.admission) { const load = d.load, admission = d.load.admission; app.use('*', admissionMiddleware(admission, () => load.monitor.level, bearer, t => d.souls.soulFromToken(t)?.owner,
    load.crowded ? t => { const id = d.souls.soulFromToken(t)?.id; return id ? load.crowded!(id) : null; } : undefined)); }
  // G8 moderation: first, so its veto checks run before the asset, body and world routes answer
  const moderation = mountModeration(app, { db: d.db.db, worldId: d.host.worldId, bearer, requireUser: (c) => requireUser(c), god: d.god, ownerId: d.cfg.ownerId });
  // lane O2: the first snapshot is edge-cacheable when the page asks for it by the current key (edge-snapshot.ts)
  const godForKey = d.god, currentSnapshotKey = godForKey ? () => snapshotKey({ editSeq: godForKey.model.editSeq, buildsRev: godForKey.store.buildsRev(), moderation: moderation.version() }) : null;
  if (currentSnapshotKey) mountEdgeSnapshot(app, currentSnapshotKey);
  mountSoulNow(app, {host: d.host, souls: d.souls, inbox: () => ownerInbox}); // LINK: the agent's public `now` line (before the routes it rides on)
  // POST /v1/souls/<id>/command (#982): this one decision picks its handler for the world's mode. An edge world's
  // inbox handler is mounted here, before the shared middleware below, as it always was; a central-mind world's
  // translator is mounted with the other owner routes further down. The other one is never registered.
  const commandRoute = ownerCommandRoute(!!d.edge);
  const ownerInbox = mountAgentInbox(app, {db: d.db, worldId: d.host.worldId, souls: d.souls, god: d.god, edge: !!d.edge, command: commandRoute, requireUser: c => requireUser(c), ownerSoul: async (c, id) => { const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, id); if (!d.souls.owns(u.id, s)) throw new ApiError(403, 'forbidden', 'not your soul'); return s; }}); // invite gate as on the central /v1/souls/:id/command
  (app as unknown as {agentInbox?: unknown}).agentInbox = ownerInbox;   // Stage B mode 2 (main.ts): a read worker's here carries main's inbox block
  // Travel (M3, travel/): a Soul whose body is in another world acts there; here only its travel calls answer.
  let travel: Travel | undefined;
  const travelGate = (resolve: ReturnType<typeof edgeSoulResolver>) => (c: Context) => { const s = resolve(c), t = travel?.inc(s.soulId); if (t && (t.state === 'away' || t.state === 'departing')) throw new EdgeError(409, t.state === 'away' ? 'travel.away' : 'travel.departing', `${s.name} is ${t.state === 'away' ? 'in' : 'on the way to'} ${t.at}: act there, or travel home (POST /v1/edge/travel {"to":"home"})`); return s; };
  if (d.edge) { if (d.edge.host !== d.host) throw new Error('edge ledger must belong to selected host'); const comms = mountEdgeRoutes(app, { host: d.host, db: d.db, souls: d.souls, build: d.cfg.build, soul: travelGate(edgeSoulResolver(d.host, d.souls, bearer)), ledger: d.edge, ownerInbox, ownerSoul: async (c, id) => { try { const {u} = await profileIdentity(c); const s = ownSoul(u, id); return {soulId: s.id, entityId: s.entity_id, name: s.name, owner: s.owner}; } catch (e) { if (e instanceof ApiError) throw new EdgeError(e.status, e.code, e.message); throw e; } } }, {evidenceCapture:process.env.SIM_CONTINUITY_EVIDENCE_CONFIG?{configPath:process.env.SIM_CONTINUITY_EVIDENCE_CONFIG,devAuth:d.auth.devAuth,bindHost:d.cfg.host}:undefined}); comms.onSpectator(m => d.hub?.broadcast?.(m as never)); d.load?.monitor.register('eyes', l => comms.eyes.setLoadLevel(l)); d.hub?.joinMessages?.push(() => comms.spectatorJoin()); d.hub?.upgradeHandlers?.push((req, socket, head) => comms.events.upgrade(req, socket, head)); }
  if (d.edge && d.god) {
    const comms = (d.edge as unknown as {comms?: {fading?: ConstructorParameters<typeof Travel>[0]['fading']}}).comms, god = d.god;
    travel = new Travel({ host: d.host, db: d.db, souls: d.souls, fading: comms?.fading ?? null, slug: d.cfg.worldKey, name: process.env.WORLD_NAME?.slice(0, 60) || d.cfg.worldKey,
      site: launcherSite(process.env.SIM_SITE_URL, process.env.SIM_SITE_KEY), invalidateBodies: () => d.edge?.invalidateBodies(),
      resolveBodyRef: (ref, owner) => bodyRefResolvers.get(d.host)?.(ref, owner) ?? {ok: false, code: 'body.ref-unsupported', reason: 'This world cannot resolve carried body references'} });
    mountTravelRoutes(app, { travel, siteKey: process.env.SIM_SITE_KEY, baseOf: (c) => baseOf(c),
      tokenSoul: (c) => { const s = d.souls.soulFromToken(bearer(c)); if (!s) { const r = d.souls.controlRefusal(bearer(c)); throw new TravelError(401, r.code, r.message, r.extra); } return s; },
      ownerSoul: async (c, id) => { const u = await requireUser(c); return ownSoul(u, id); },
      isGod: async (c) => { const t = bearer(c); if (t?.startsWith('god_')) { const w = god.godIdentity(t); return !!w && !w.child; } const u = t ? await d.auth.userFromToken(t) : null; return !!u && !!god.owner && u.id === god.owner; } });
    const t = travel; setTimeout(() => { void t.reconcile().then((r) => { if (r.length) console.log(`[travel] reconciled ${r.join(', ')}`); }, () => {}); }, 3000).unref?.();
  }
  // A world without travel (no Godmode: the original worlds and their forks, plain local worlds) still answers the public
  // visitors read every world page makes (SoulTravel.tsx): travel is not available here and nobody is visiting. Before
  // this it was a 404 in every visitor's console, again every 15 s (lane L2, live old worlds 2026-10-17).
  if (!travel) app.get('/v1/world/visitors', c => c.json({contract: TRAVEL_CONTRACT, world: d.cfg.worldKey, available: false, open: false, visitors: [], recent: []}, 200, {'cache-control': 'no-store'}));
  const ip = (c: Context) => (c.req.header('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const requireUser = async (c: Context): Promise<UserRow> => { const u = await d.auth.userFromToken(bearer(c)); if (!u) throw new ApiError(401, 'unauthorized', 'sign in first'); return u; };
  const requireAdmin = async (c: Context): Promise<UserRow> => { const u = await requireUser(c); if (u.role !== 'admin') throw new ApiError(403, 'forbidden', 'admin only'); return u; };
  // Authentication establishes identity across an await; it does not freeze
  // the role/invitation used to serialize a private candidate view.
  const privateUser=(authenticated:UserRow,requireInvitation=true):UserRow=>{
    if(!d.souls.lifecycle)return authenticated;
    const current=d.db.user(authenticated.id);if(!current)throw new ApiError(401,'unauthorized','sign in first');
    if(requireInvitation)d.souls.requireInvited(current);return current;
  };
  const ownSoul = (authenticated: UserRow, id: string): SoulRow => { const u=privateUser(authenticated),s = d.db.soul(id); if (!s || s.retired_at || s.world_id !== d.host.worldId) throw new ApiError(404, 'not-found', 'no such soul'); if (!d.souls.owns(u.id,s) && u.role !== 'admin') throw new ApiError(403, 'forbidden', 'not your soul'); d.souls.requireControlReady(s); return s; };
  const agentSoul = (c: Context): SoulRow => { const s = d.souls.soulFromToken(bearer(c)); if (!s) { const r = d.souls.controlRefusal(bearer(c)); throw new ApiError(401, r.code, r.message, r.extra); } return s; };
  const controlReply=async(c:Context,guard:AcceptanceGuard|undefined,run:()=>Promise<object>)=>{
    const result=await run();if(guard)checkAcceptanceGuard(guard);return c.json(result);
  };
  /** Public base URL as the caller reached us (works on any hostname pointing at the box). */
  const baseOf = (c: Context) => requestWorldBase(d.cfg.worldPath, (name) => c.req.header(name), () => publicWorldBase(d.cfg));
  /** A whole number from the query string, clamped at both ends (to SQLite, LIMIT -1 means no limit at all). */
  const intQ = (c: Context, name: string, def: number, min: number, max: number) => { const n = Math.floor(Number(c.req.query(name) ?? def)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const limitIp = (c: Context, key: string, max: number, windowMs: number) => { const l = d.souls.limits.allow(`${key}:${ip(c)}`, max, windowMs); if (!l.ok) throw new ApiError(429, 'rate-limited', 'too many requests', { retry_after: l.retryAfter }); };

  const worldName = process.env.WORLD_NAME?.slice(0, 60) || d.cfg.worldKey.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  /** The title a visitor sees (viewer arrival card, Explore, welcome-back), served in /v1/config so the first frame never shows a slug. */
  const displayWorldName = d.god ? safeWorldName(worldName) : d.cfg.worldKey === 'littlemartians' ? 'Little Martians' : d.cfg.worldKey[0].toUpperCase() + d.cfg.worldKey.slice(1);
  // the world's one skill (/SKILL.md) and who lives here (/v1/world/souls): lane P2
  if (d.god) { mountJoinRoutes(app, { worldName, baseOf, soulCliUrl: (c) => (d.cfg.cliFile ? baseOf(c) + '/eden-agent.mjs' : PUBLISHED_SOUL_CLI), souls: () => d.db.liveSouls(d.host.worldId).filter((s) => !travel?.isAway(s.id)), nowOf: (id) => d.host.nowOf(id), bodyOf: (id) => d.edge?.bodyRule?.view(id) ?? null, poseOf: (id) => { const p = (d.host.engine.world.entities as Record<string, { pose?: { p?: number[] } } | undefined>)[id]?.pose?.p; return p ? { x: p[0], y: p[1], z: p[2] } : null; } }); }
  const godRoutes = d.god ? mountGodRoutes(app, { god: d.god, worldName, requireUser, soulFromBearer: (c) => { const s = d.souls.soulFromToken(bearer(c)); return s ? { id: s.id, name: s.name } : null; }, baseOf, limitIp, verifyUse: new VerifyUse(d.host, d.souls, d.god, d.edge), lookWorldUrl: `http://127.0.0.1:${d.cfg.port}${d.cfg.worldPath}` /* W2 remote looks */ }) : null;
  if(d.god&&d.edge)mountContextViews(app,{god:d.god,edge:d.edge,build:d.cfg.build,artOriginals:{dir:join(defaultAssetDir(),'art'),basePath:d.cfg.worldPath},levelAt:d.contextLevelAt,contextReady:d.contextReady,waitForContext:d.contextWait,worldUrl:`http://127.0.0.1:${d.cfg.port}${d.cfg.worldPath}`,soul:c=>{const token=bearer(c);if(!token)return null;return travelGate(edgeSoulResolver(d.host,d.souls,bearer))(c).soulId;},limit:c=>limitIp(c,'context-views',120,60000)});
  if (d.god && d.edge) { const god = d.god; mountSecretPlaceRoutes(app, { ledger: d.edge, requireGod: (c) => { const who = god.godIdentity(bearer(c)); if (!who) throw new ApiError(401, 'unauthorized', 'missing or invalid god token'); if (who.child) throw new ApiError(403, 'helper.scope', 'helper tokens cannot change secret places'); } }); }  // knowledge/1; WD7: helpers refused
  if (d.god) { const god = d.god; mountSharedLibraryRoutes(app, { god, slug: d.cfg.worldKey, dir: process.env.SIM_LIBRARY_DIR, requireGod: (c) => { if (!god.godFromToken(bearer(c))) throw new ApiError(401, 'unauthorized', 'missing or invalid god token'); } }); }  // M4 shared library
  if (d.god) { const god = d.god; mountArtRoutes(app, { model: () => god.model, godAct: (ops, note) => god.act({ ops }, note), engineAct: (ops, note) => god.engineAct(ops, note), isGod: (c) => { const w = god.godIdentity(bearer(c)); return !!w && !w.child; }, soulFromBearer: (c) => { const s = d.souls.soulFromToken(bearer(c)); return s ? { id: s.id, name: s.name } : null; }, owner: () => god.owner, baseOf, limitIp, dir: join(defaultAssetDir(), 'art') }); }  // W6 art: frames, screens, gallery walls
  if (d.god && d.edge) {
    const god = d.god;
    d.edge.painting = createPaintingService({ model: () => god.model, dir: join(defaultAssetDir(), 'art'), basePath: d.cfg.worldPath, worldId: d.host.worldId, commit: (ops, note, complete, durable) => god.engineAct(ops, note, complete, durable) });
  }
  if (d.god) { const god = d.god; mountEnvRoutes(app, { host: d.host, god, requireGod: (c) => { const who = god.godIdentity(bearer(c)); if (!who) throw new ApiError(401, 'unauthorized', 'missing or invalid god token'); if (who.child) throw new ApiError(403, 'helper.scope', 'helper tokens cannot change the environment'); return who; } }); }  // R4-LIVE env setter; WD7: helpers refused, edits attributed

  app.onError((err, c) => {
    if (err instanceof ApiError) { if (err.status === 429 || err.status === 413) refusals.note(err.status === 429 ? 'rate' : 'size', err.code, `${c.req.method} ${c.req.path}: ${err.message}`); if (err.status === 429 && err.extra?.retry_after) c.header('Retry-After', String(err.extra.retry_after)); return c.json({ ok: false, code: err.code, message: err.message, ...err.extra, ...(err.code.startsWith('control.') ? {contract: 'eden-edge/1', error: {code: err.code, message: err.message, ...err.extra}} : {}) }, err.status as 400); }
    console.error('[http]', err);
    return c.json({ ok: false, code: 'internal', message: 'internal error' }, 500);
  });
  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('X-Frame-Options', 'DENY'); c.header('Content-Security-Policy', "frame-ancestors 'none'"); });
  // A halted durable clock cannot serve an unacknowledged body/head or accept
  // more control. Generic unavailable response carries no private row/error.
  app.use('*',async(c,next)=>{
    if(!d.host.clockAvailable)return c.json({ok:false,code:'world-unavailable',message:'World temporarily unavailable.'},503,{'Cache-Control':'no-store'});
    await next();
  });
  // Nothing a person or an agent sends is large: a command, an intent, a few cards.
  // Apply before parsing/auth/rate errors as well as successful secret responses.
  for (const path of ['/v1/agent/pair', '/v1/agent/pair/*', '/v1/pair/*', '/v1/souls/:id/pair'])
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  for(const path of ['/v1/souls/:id/intent-v2','/v1/souls/:id/intent-v2/*','/v1/agent/intent-v2','/v1/agent/intent-v2/*'])
    app.use(path,async(c,next)=>{c.header('Cache-Control','no-store');await next();});
  app.use('/v1/souls/:id',async(c,next)=>{if(d.intentV2)c.header('Cache-Control','no-store');await next();});
  for(const path of ['/v1/lifecycle','/v1/lifecycle/*','/v1/me','/v1/account/*','/v1/souls','/v1/souls/*','/v1/agent/*'])
    app.use(path,async(c,next)=>{if(d.souls.lifecycle)c.header('Cache-Control','no-store');await next();});
  app.use('/v1/brain',async(c,next)=>{if(d.souls.lifecycle)c.header('Cache-Control','no-store');await next();});
  app.use('/v1/*',async(c,next)=>bodyLimit({ maxSize: /^\/v1\/(?:souls\/[^/]+\/photo|agent\/photo)$/.test(c.req.path)?360*1024:64*1024, onError: (c) => { refusals.note('size', 'too-large', `${c.req.method} ${c.req.path}`); return c.json({ ok: false, code: 'too-large', message: 'request body is too large' }, 413); } })(c,next));

  // ---- public
  mountWelcomeRoutes(app,d);
  // lane OPS2: operator commands for TEST Souls (the launcher only, with the site key: op-souls.ts)
  mountOperatorSouls(app,{db:d.db,worldId:d.host.worldId,souls:d.souls,inbox:ownerInbox,god:d.god,siteKey:process.env.SIM_SITE_KEY,body:()=>d.edge?.bodyRule??null});
  if(d.souls.accounts)mountAccountRoutes(app,{accounts:d.souls.accounts,auth:d.auth,baseOf:d.cfg.authProvider==='clerk'?()=>publicWorldBase(d.cfg):baseOf,limit:limitIp});
  mountStationRoutesV2(app,d.stationV2);
  // lane DASH: tickMs = the last ~20 s of ticks (avg/max ms against the 50 ms budget); clockRate < 1 = the clock is dilated (behind)
  // srv-load: O(1) from the load monitor's last 250 ms sample (tick times + the `load` block); the watchdog thread's
  // live.json (and SIM_HEALTH_PORT) still answers when this thread is stuck.
  app.get('/healthz', (c) => { const mon = d.load?.monitor; let tickMs: {avg: number; max: number; n: number};
    if (mon) { const t = mon.tickStats; tickMs = {avg: t.avg, max: t.max, n: t.n}; }
    else { const ms = d.host.tickMs, n = ms.length; let sum = 0, max = 0; for (const x of ms) { sum += x; if (x > max) max = x; } tickMs = { avg: n ? Math.round(10 * sum / n) / 10 : 0, max: Math.round(10 * max) / 10, n }; }
    return c.json({ ok: true, tick: d.host.engine.world.tick, clients: d.hub.clients.size, paused: d.host.paused, build: d.cfg.build, worldId: d.host.worldId,
      tickMs, clockRate: d.host.clockRate, ...(mon ? {load: mon.health()} : {}) }, 200, mon ? {'X-Sim-Load': mon.level} : undefined); });
  // lane W1: the same config goes into the world page's <head> (inline-config.ts)
  const configOf = (c: Context) => ({ authProvider:d.cfg.authProvider, authenticationOrigin:d.cfg.authProvider==='clerk'&&d.auth.ready?new URL(d.cfg.publicUrl).origin:'', clerkPublishableKey:d.cfg.authProvider==='clerk'?d.cfg.clerkPublishableKey:'', clerkIssuer:d.cfg.authProvider==='clerk'?d.cfg.clerkIssuer:'', ...(d.cfg.authProvider==='clerk'&&d.cfg.clerkSatelliteDomain?{clerkSatellite:{domain:d.cfg.clerkSatelliteDomain,signInUrl:d.cfg.clerkSignInUrl}}:{}), privyAppId:d.cfg.authProvider==='privy'?d.cfg.privyAppId:'', publicUrl: baseOf(c), worldURL:baseOf(c), instructionsURL:baseOf(c)+'/instructions.md', accountAuthRequired:d.cfg.accountAuthRequired, accountApproval:d.souls.accounts?{contract:'account-soul-approval/1',start:'/v1/agent/approval/start',poll:'/v1/agent/approval/poll',cancel:'/v1/agent/approval/cancel'}:null, soulProfile:{contract:'soul-profile/1',auth:'owner',edit:'PATCH /v1/souls/:id/profile',photo:'POST /v1/souls/:id/photo',resetPhoto:'DELETE /v1/souls/:id/photo',autoPortrait:portraits.enabled,photoFormat:'PNG RGB/RGBA8',maxPhotoBytes:262144,maxPhotoDimension:512}, worldId: d.host.worldId, worldKey: d.cfg.worldSlug ?? d.cfg.worldKey, worldEngine: d.cfg.worldEngine, worldName: displayWorldName, worldPath: d.cfg.worldPath, authReady: d.auth.ready, devAuth: d.auth.devAuth, inviteRequired: d.cfg.inviteRequired, build: d.cfg.build });
  app.get('/v1/config', (c) => c.json(configOf(c)));
  const safeConfig = (c: Context) => { try { return configOf(c); } catch { return null; } };  // the page never fails because of it
  app.get('/v1/world', (c) => c.json(d.souls.worldSummary()));
  app.get('/v1/debug/world', (c) => c.json(d.host.engine.world));
  app.get('/v1/scene', c => {
    const scene=d.host.engine.renderScene?.()??{scene:null};
    return c.json({...scene,renderSceneRef:captureRenderScene(d.host.engine.rulesVersion,scene).ref},200,{'Cache-Control':'no-store'});
  });
  app.get('/v1/station',c=>d.station?c.json(d.station.view(),200,{'Cache-Control':'no-store'}):
    c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'}));
  app.get('/v1/station/history',c=>{
    if(!d.station)return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});
    const q=c.req.query(),at=Number(q.tick);
    if(Object.keys(q).some(k=>!['worldId','epoch','rulesVersion','tick'].includes(k))||q.worldId!==d.host.worldId||!q.epoch||!q.rulesVersion||q.tick===undefined||q.tick.trim()==='')
      return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});
    try{return c.json(d.station.history({worldId:q.worldId,epoch:q.epoch,rulesVersion:q.rulesVersion},at),200,{'Cache-Control':'no-store'});}
    catch{return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});}
  });
  app.get('/v1/scenes/:hash', c => {
    const hash=c.req.param('hash');
    const world=c.req.query('world');  // lane W1: the web names its world, so a capture it may keep is keyed by world too
    // L8: verified once by hash and kept serialized (db.renderSceneCaptureJson): a request never re-reads or re-parses the row
    const json=/^[a-f0-9]{64}$/.test(hash)&&(world===undefined||world===d.host.worldId)?d.db.renderSceneCaptureJson(d.host.worldId,hash):undefined;
    if(json===undefined)return c.json({ok:false,code:'not-found',message:'No recorded render scene for this world.'},404,{'Cache-Control':'no-store'});
    // A capture is content-addressed (hash verified on read, never rewritten), so a visitor's browser keeps it: a returning
    // arrival skips this round trip between its first take and its first frame (~0.12 s on live). The hash is its ETag.
    const etag=`"${hash}"`,headers={'Cache-Control':world===undefined?'no-store':'private, max-age=604800, immutable',ETag:etag};
    if((c.req.header('if-none-match')??'').split(',').some(t=>t.trim().replace(/^W\//,'')===etag))return c.body(null,304,headers);
    return c.body(json,200,{...headers,'Content-Type':'application/json'});
  });
  // The archive/live canonical Takes remain full; only the public response copy
  // uses a self-contained dictionary when this exact capability is requested.
  // P2 (E-life): viewers never read a take's static physics (entityPhysicsV1, ~3 MB per chunk on Eden 2026; the web drops
  // it on receipt), so the public reply leaves it out like the live stream; ?physics=1 keeps the canonical full chunks.
  const lean=(c:Context,value:unknown)=>publicTakes(value,c.req.query('physics')==='1');
  const takeReply=(c0:Context,value0:unknown)=>{const c=c0,value=lean(c0,value0);return c.req.query('takeTransport')===TAKE_BOUNDARY_WIRE_V1
    ?c.body(stringifyTakeBoundaryWireV1(value),200,{'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store'})
    :c.json(value as never,200,{'Cache-Control':'no-store'});};
  app.get('/v1/takes', async c => { const from=intQ(c,'from',0,0,Number.MAX_SAFE_INTEGER),to=intQ(c,'to',d.host.engine.world.tick,0,Number.MAX_SAFE_INTEGER),limit=intQ(c,'limit',120,1,120); // Recordings off (default): only the engine's in-memory live buffer exists; older moments answer empty.
    const takes=!d.cfg.takesPersist?{chunks:(d.host.engine.takeChunks?.(from)??[]).filter(k=>k.fromTick<to).slice(0,limit),next:null}:d.takes?await d.takes.read(from,to,limit):d.db.takes(d.host.worldId,from,to,limit); return takeReply(c,{serverTick:d.host.engine.world.tick,...takes}); });
  app.get('/v1/take', c => takeReply(c,{ serverTick: d.host.engine.world.tick, chunks: d.host.engine.takeChunks?.(intQ(c, 'after', -1, -1, Number.MAX_SAFE_INTEGER)) ?? [] }));
  app.get('/v1/kernel', (c) => c.json(d.host.kernelView()));
  app.get('/v1/plays', (c) => c.json({ plays: d.host.recentPlays.slice(-intQ(c, 'limit', 60, 1, 200)) }));
  app.get('/v1/talk', (c) => c.json({ lines: d.db.recentTalk(intQ(c, 'limit', 60, 1, 200)) }));
  app.get('/cards.md', (c) => c.text(cardGrammar(d.host.engine.describeVerbs().filter((v) => v.verb !== 'do_activity')), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' }));
  // N1 nav diagnostics, served only with SIM_NAV_DEBUG (the e2es set it): the failed-search memo's counts, and one probe
  // walk from (sx,sz) on level sl to (gx,gz) on gl for an r m-radius body (nothing moves).
  if (process.env.SIM_NAV_DEBUG) app.get('/v1/debug/nav', (c) => c.json({ stranded: strandedMetrics() }, 200, { 'Cache-Control': 'no-store' }));
  if (process.env.SIM_NAV_DEBUG) app.get('/v1/debug/route', (c) => {
    const n = (k: string, v = 0) => { const x = Number(c.req.query(k)); return Number.isFinite(x) ? x : v; };
    const rt = (d.host.engine as unknown as { rt?: { world: unknown; services: { spatial?: { route: Function } } } }).rt, sp = rt?.services.spatial;
    if (!rt || !sp) return c.json({ error: 'no spatial service' }, 404);
    const profile = { id: 'probe', radius: n('r', 0.35), height: 1.8, speed: 1.35, turnRate: 4, stepHeight: 0.22 };
    const res = sp.route(rt.world, profile, { level: n('sl'), p: [n('sx'), n('sz')] }, { level: n('gl'), p: [n('gx'), n('gz')] }, {});
    const levels = ((sp as { scene?: { levels?: { id: number; y: number; label?: string }[] } }).scene?.levels ?? []).map((l) => `${l.id}@${l.y}:${l.label ?? ''}`);
    return c.json(res.ok ? { ok: true, length: res.route.length, legs: res.route.legs.length, end: res.route.legs.at(-1)?.points?.at(-1), endLevel: res.route.legs.at(-1)?.level, levels } : { ok: false, diagnostic: res.diagnostic, levels }, 200, { 'Cache-Control': 'no-store' });
  });
  app.get('/v1/debug/verbs', (c) => c.json({ rulesVersion: d.host.engine.rulesVersion, dt: d.host.engine.dt, verbs: d.host.engine.describeVerbs() }));
  app.get('/v1/log', (c) => c.json({ events: d.db.events(d.host.worldId, intQ(c, 'after', 0, 0, Number.MAX_SAFE_INTEGER), intQ(c, 'limit', 200, 1, 1000), true).map(publicEvent) }));
  // App owns the skill text (EDGE_SKILL_FILE / descriptor skillFile, read per request so edits apply live).
  // The legacy approval-pairing skill applies only to central-mind worlds.
  const skillText = (base: string) => {
    if (d.cfg.skillFile) { try { return readFileSync(d.cfg.skillFile, 'utf8').replaceAll('{{BASE}}', base); } catch { /* fall through to built-in */ } }
    return d.cfg.mindDriver === 'edge' ? edgeSkillStub(base) : skillMd(base);
  };
  const skill = (c: Context) => c.text(skillText(baseOf(c)), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' });
  app.get('/skill.md', skill);
  app.get('/instructions.md',c=>{if(!d.cfg.instructionsFile)return c.json({ok:false,code:'instructions-unavailable'},503);
    // lane PUX: ?for=<window code> (the signed-in page's New Soul prompt) names the code in the guide; never cached shared
    try{const code=c.req.query('for')??null,text=fillInstructions(readFileSync(d.cfg.instructionsFile,'utf8'),baseOf(c),displayWorldName,code,publicWorldBase(d.cfg));return c.text(text,200,{'content-type':'text/markdown; charset=utf-8','cache-control':code?'no-store':'public, max-age=60'});}
    catch{return c.json({ok:false,code:'instructions-unavailable'},503);}
  });
  app.get('/eden-agent.mjs', c => { if (!d.cfg.cliFile) throw new ApiError(404, 'not-found', 'no agent CLI is published on this world'); let js: string; try { js = readFileSync(d.cfg.cliFile, 'utf8'); } catch { throw new ApiError(404, 'not-found', 'agent CLI unavailable'); } return c.body(js, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' }); });
  app.get('/eden.mjs', c => { if (!d.cfg.controllerCliFile) throw new ApiError(404, 'not-found', 'no controller CLI is published on this world'); let js: string; try { js = readFileSync(d.cfg.controllerCliFile, 'utf8'); } catch { throw new ApiError(404, 'not-found', 'controller CLI unavailable'); } return c.body(js, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=60' }); });
  mountSoulRuntimePublication(app,()=>d.cfg.controllerCliFile);
  app.get('/v1/skill.md', skill);
  // Selected-world text producer, before the SPA fallback. Origin/prefix come
  // from approved server configuration, never forwarded or caller headers.
  app.get('/llms.txt', c => {
    try { return c.text(agentReader(d.cfg), 200, { 'content-type':'text/plain; charset=utf-8', 'cache-control':'public, max-age=60' }); }
    catch { return c.text('World agent instructions are unavailable.', 503, { 'cache-control':'no-store' }); }
  });
  app.get('/w/:key/llms.txt', c => c.text('No agent reader for this world on this process.', 404));

  // Candidate versioned adapters are installed only by explicit dependency
  // injection. No default capability advertisement or legacy fallback.
  const intentService=()=>{if(!d.intentV2)throw new ApiError(404,'not-found','direction version unavailable');return d.intentV2;};
  const intentIdentity=async(c:Context):Promise<IntentIdentityV2>=>{
    const user=await requireUser(c),token=bearer(c)!;
    if(token.startsWith('dev:'))return {userId:user.id,expiresAt:Infinity};
    // userFromToken has verified this exact token. Bind its actual expiry to
    // synchronous effect/final-response guards without trusting a client claim.
    try {const exp=decodeJwt(token).exp;if(typeof exp!=='number'||!Number.isFinite(exp))throw new Error();
      return {userId:user.id,expiresAt:exp*1000};}
    catch {throw new ApiError(401,'unauthorized','sign in first');}
  };
  app.post('/v1/souls/:id/intent-v2',async c=>{
    try {const service=intentService(),scope=service.ownerScope(await intentIdentity(c),c.req.param('id'));
      const receipt=await service.submit(scope,await body(c));service.guard(scope);
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentTransportError(error);}
  });
  app.post('/v1/agent/intent-v2',async c=>{
    try {const service=intentService(),scope=service.agentScope(bearer(c));
      const receipt=await service.submit(scope,await body(c));service.guard(scope);
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentTransportError(error);}
  });
  app.get('/v1/souls/:id/intent-v2/requests/:requestId',async c=>{
    const service=intentService(),identity=await intentIdentity(c);
    try {const scope=service.ownerScope(identity,c.req.param('id')),receipt=service.lookup(scope,c.req.param('requestId'));
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentLookupError(error);}
  });
  app.get('/v1/souls/:id/intent-v2/requests/:requestId/diagnostics',async c=>{
    c.header('Cache-Control','no-store');const service=intentService(),identity=await intentIdentity(c);
    try {const scope=service.ownerScope(identity,c.req.param('id')),dto=service.diagnosticsV1(scope,c.req.param('requestId'),d.cfg.build);return c.json(dto);}
    catch(error){if(error instanceof ApiError&&error.status===429)throw error;throw intentLookupError(error);}
  });
  app.get('/v1/agent/intent-v2/requests/:requestId',c=>{
    const service=intentService();let scope;
    try {scope=service.agentScope(bearer(c));}catch(error){throw intentTransportError(error);}
    try {const receipt=service.lookup(scope,c.req.param('requestId'));return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentLookupError(error);}
  });

  app.get('/v1/souls/:id/intent-v2/capabilities',async c=>{c.header('Cache-Control','no-store');const service=intentService(),identity=await intentIdentity(c);const scope=service.ownerScope(identity,c.req.param('id')),view=service.humanCapabilities(scope);service.guard(scope);return c.json(view);});
  app.get('/v1/agent/intent-v2/capabilities',c=>{c.header('Cache-Control','no-store');const service=intentService(),scope=service.agentScope(bearer(c)),view=service.humanCapabilities(scope);service.guard(scope);return c.json(view);});

  const historyQuery=(c:Context)=>{if(Object.values(c.req.queries()).some(values=>values.length!==1))throw new ApiError(400,'invalid-history-query','invalid history query');return c.req.query();};
  app.get('/v1/souls/:id/intent-v2/history',async c=>{
    const service=intentService(),identity=await intentIdentity(c);
    try{const scope=service.ownerScope(identity,c.req.param('id')),page=service.historyPage(scope,historyQuery(c));
      service.guard(scope);return c.json(page);}catch(error){throw intentHistoryReadError(error);}
  });
  app.get('/v1/agent/intent-v2/history',c=>{
    const service=intentService();let scope;
    try{scope=service.agentScope(bearer(c));}catch(error){throw intentTransportError(error);}
    try{const page=service.historyPage(scope,historyQuery(c));service.guard(scope);return c.json(page);}
    catch(error){throw intentHistoryReadError(error);}
  });

  app.get('/v1/souls/:id/intent-v2/arrivals',async c=>{
    c.header('Cache-Control','no-store');const service=intentService(),identity=await intentIdentity(c);
    try{const scope=service.ownerScope(identity,c.req.param('id')),page=service.arrivalsPage(scope,historyQuery(c));service.guard(scope);return c.json(page);}catch(error){throw intentArrivalReadError(error);}
  });
  app.get('/v1/agent/intent-v2/arrivals',c=>{
    c.header('Cache-Control','no-store');const service=intentService();let scope;try{scope=service.agentScope(bearer(c));}catch(error){throw intentTransportError(error);}
    try{const page=service.arrivalsPage(scope,historyQuery(c));service.guard(scope);return c.json(page);}catch(error){throw intentArrivalReadError(error);}
  });

  // ---- signed-in users
  const mySouls = (u: UserRow) => d.souls.ownedRows(u.id).filter(s=>!d.souls.lifecycle||(s.world_id===d.host.worldId&&d.souls.invited(u)&&d.souls.controlReady(s))).map((s) => ({ id: s.id, name: s.name, description: s.description, ...(s.world_id===d.host.worldId?{profile:profiles.view(s.id)}:{}), entityId: s.entity_id, hasToken: d.souls.agentStatus(s).attached, tokenLabel: d.souls.agentStatus(s).label, tokenCreatedAt: d.souls.agentStatus(s).since, tokenLastUsed: d.souls.agentStatus(s).last_used }));
  const profileIdentity=async(c:Context)=>{const u=await requireUser(c);if(!d.cfg.accountAuthRequired)return {u,guard:undefined};const token=bearer(c)!;if(token.startsWith('dev:'))return {u,guard:undefined};const account=await d.auth.accountFromToken(token);if(!account)throw new ApiError(401,'account-signin-required','Sign in first.');return {u,guard:()=>{if(account.identity.expiresAt<=Date.now())throw new ApiError(401,'unauthorized','Sign in first.');return true as const;}};};
  app.patch('/v1/souls/:id/profile',async c=>{c.header('Cache-Control','no-store');const {u,guard}=await profileIdentity(c);const result=await profiles.update(u.id,c.req.param('id'),await body(c),guard);d.hub.refreshMe(u.id);return c.json({ok:true,profile:result});});
  app.post('/v1/souls/:id/photo',async c=>{c.header('Cache-Control','no-store');const {u,guard}=await profileIdentity(c);const result=await profiles.photo(u.id,c.req.param('id'),await body(c),guard);d.hub.refreshMe(u.id);return c.json({ok:true,profile:result});});
  app.delete('/v1/souls/:id/photo',async c=>{c.header('Cache-Control','no-store');const {u,guard}=await profileIdentity(c);const result=await profiles.clearPhoto(u.id,c.req.param('id'),guard);d.hub.refreshMe(u.id);return c.json({ok:true,profile:result});});
  app.get('/v1/souls/:id/profile-photo/:hash',c=>{const bytes=profiles.photoBytes(c.req.param('id'),c.req.param('hash'));return bytes?c.body(bytes as never,200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'}):c.json({ok:false,code:'not-found'},404);});
  app.get('/v1/account/session',async c=>{
    c.header('Cache-Control','no-store');
    const account=await d.auth.accountFromToken(bearer(c));if(!account)throw new ApiError(401,'account-signin-required','Sign in first.');
    return c.json({accountId:account.identity.id,issuer:account.identity.issuer,subject:account.identity.subject});
  });
  app.get('/v1/me', async (c) => { const u = privateUser(await requireUser(c),false),souls=mySouls(u); return c.json({ me: {...d.auth.me(u),...(d.souls.lifecycle?{souls:souls.map(s=>s.id)}:{})}, souls, maxSouls: d.cfg.maxSoulsPerUser,
    ...(d.souls.lifecycle?{lifecycleRequests:d.souls.invited(u)?d.souls.lifecycleHistory(u.id):{contract:'owner-lifecycle-list/1',worldId:d.host.worldId,requests:[],nextCursor:null},
      ...(d.souls.invited(u)?{lifecycleCapability:ownerLifecycleCapabilitySchema.parse({contract:'owner-lifecycle-capability/1',worldId:d.host.worldId,userId:u.id,
        receiptContract:'soul-lifecycle/1',historyContract:'owner-lifecycle-list/1',optIn:{header:'X-Sim-Lifecycle',value:'1'}})}:{})}:{}) }); });
  app.get('/v1/lifecycle',async c=>{c.header('Cache-Control','no-store');const u=await requireUser(c);return c.json(d.souls.lifecycleHistory(u.id,c.req.query('cursor')??null,c.req.query('owner')??u.id));});
  app.get('/v1/lifecycle/:requestId',async c=>{c.header('Cache-Control','no-store');const u=await requireUser(c);return c.json({lifecycle:d.souls.lifecycleReceipt(u.id,c.req.param('requestId'))});});
  const lifecycleOptIn=(c:Context)=>{
    const header=c.req.header('X-Sim-Lifecycle');
    if(header!==undefined&&(header!=='1'||!d.souls.lifecycle))throw new ApiError(400,'lifecycle-unavailable','this lifecycle opt-in is unavailable');
    return header==='1';
  };
  const lifecycleReply=async(c:Context,userId:string,requestId:string,optIn:boolean)=>{
    if(!optIn)await d.souls.waitLifecycle(userId,requestId);
    const user=await requireUser(c),lifecycle=d.souls.lifecycleReceipt(user.id,requestId);
    if(user.id!==userId)throw new ApiError(404,'not-found','no such lifecycle');
    c.header('Cache-Control','no-store');
    if(lifecycle.state==='refused')return c.json({ok:false,code:'arrival-unavailable',message:'There is no clear ground for the Soul to stand on in this world.',lifecycle},409);
    const terminal=(lifecycle.state==='admitted'&&lifecycle.ready)||lifecycle.state==='retired';
    if(optIn)return c.json({lifecycle},terminal?200:202);
    if(!terminal)return c.json({ok:false,code:'lifecycle-pending',message:'Completion is unconfirmed; refresh the private lifecycle receipt.',lifecycle},503);
    if(lifecycle.operation==='retire')return c.json({ok:true});
    const soul=d.db.soul(lifecycle.soulId)!;return c.json({ok:true,soul:{id:soul.id,name:soul.name,description:soul.description,entityId:soul.entity_id}});
  };
  app.post('/v1/invite', async (c) => {
    const u = await requireUser(c); const p = inviteSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'code is required');
    d.souls.redeemInvite(u, p.data.code); d.hub.refreshMe(u.id); return c.json({ ok: true });
  });
  app.post('/v1/souls', async (c) => {
    if(d.cfg.accountAuthRequired){if(!await d.auth.accountFromToken(bearer(c)))throw new ApiError(401,'account-signin-required','Sign in with Google or email.');throw new ApiError(403,'approval-required','Create an agent approval link and approve it while signed in.');}
    const u = await requireUser(c); d.souls.requireInvited(u);
    const optIn=lifecycleOptIn(c);
    const lim = d.souls.limits.allow(`create:${u.id}`, 5, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many new souls this hour', { retry_after: lim.retryAfter });
    if(d.souls.lifecycle){const op=d.souls.acceptLifecycleCreate(u.id,await body(c));d.hub.refreshMe(u.id);return lifecycleReply(c,u.id,op.requestId,optIn);}
    const s = await d.souls.create(u.id, await body(c)); d.hub.refreshMe(u.id);
    return c.json({ ok: true, soul: { id: s.id, name: s.name, description: s.description, ...(s.world_id===d.host.worldId?{profile:profiles.view(s.id)}:{}), entityId: s.entity_id } });
  });
  app.delete('/v1/souls/:id', async (c) => { const u = await requireUser(c),optIn=lifecycleOptIn(c),soul=ownSoul(u,c.req.param('id'));if(d.souls.lifecycle){const op=d.souls.acceptLifecycleRetire(u.id,soul);d.hub.refreshMe(soul.owner);return lifecycleReply(c,u.id,op.requestId,optIn);}await d.souls.retire(soul); d.hub.refreshMe(u.id); return c.json({ ok: true }); });
  app.get('/v1/souls/:id', async (c) => {
    // LINK: the owner's `agent` gains the one link state (COMMON-LINK §2) and the dashboard the agent's public `now` line.
    const linked=(dash:ReturnType<typeof d.souls.dashboard>,row:SoulRow,accountId:string)=>({...dash,agent:{...dash.agent,link:soulLink(d.souls,ownerInbox,row,accountId)},now:d.host.nowOf(row.id)});
    if(!d.intentV2){const u=await requireUser(c),row=ownSoul(u,c.req.param('id'));return c.json(linked(d.souls.dashboard(row),row,u.id));}
    // Explicit candidate only: the same trusted expiry/current authority and
    // body readiness used by submission select the genuine-owner human adapter.
    c.header('Cache-Control','no-store');
    try {
      const service=d.intentV2,identity=await intentIdentity(c),scope=service.ownerScope(identity,c.req.param('id'));
      const row=d.db.soul(scope.soulId)!,dashboard=linked(d.souls.dashboard(row),row,identity.userId),control=service.ownerControl(scope);
      service.guard(scope);return c.json({...dashboard,...(control?{control}:{})});
    }catch(error){throw intentTransportError(error);}
  });
  app.get('/v1/souls/:id/timeline', async (c) => { const u = await requireUser(c); return c.json({ events: d.souls.timeline(ownSoul(u, c.req.param('id')), intQ(c, 'limit', 80, 1, 200)) }); });
  app.get('/v1/souls/:id/deck', async (c) => { const u = await requireUser(c); return c.json(d.souls.deck(ownSoul(u, c.req.param('id')))); });
  app.get('/v1/souls/:id/talk', async (c) => { const u = await requireUser(c); return c.json({ lines: d.db.recentTalk(60, ownSoul(u, c.req.param('id')).id) }); });
  app.post('/v1/souls/:id/cards', async (c) => { const u = await requireUser(c); d.souls.requireInvited(u);const s=ownSoul(u,c.req.param('id')),input=await body(c),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.proposeCards(s,input,guard)); });
  app.get('/v1/souls/:id/perceive', async (c) => { const u = await requireUser(c),soul=ownSoul(u,c.req.param('id'));if(!d.host.extra.intentPurposeRecallV1)return c.json(d.souls.perceive(soul));c.header('Cache-Control','no-store');const guard=d.souls.ownerControlGuard(soul,u.id);if(guard)checkAcceptanceGuard(guard);const result=d.souls.perceive(soul);if(guard)checkAcceptanceGuard(guard);return c.json(result); });
  if (commandRoute === 'central-translator') app.post('/v1/souls/:id/command', async (c) => { // #982: an edge world's is the inbox's (above)
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    const guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.command(s,p.data.text,'web',guard));
  });
  app.get('/v1/souls/:id/mandate',async c=>{const u=await requireUser(c);return c.json({rules:d.souls.rules(ownSoul(u,c.req.param('id')))});});
  app.post('/v1/souls/:id/mandate',async c=>{const u=await requireUser(c);d.souls.requireInvited(u);const s=ownSoul(u,c.req.param('id')),input=await body(c),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.steer(s,input,'web',guard));});
  app.delete('/v1/souls/:id/mandate/:rule',async c=>{const u=await requireUser(c),s=ownSoul(u,c.req.param('id')),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.removeRule(s,c.req.param('rule'),guard));});
  app.post('/v1/souls/:id/intent', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,async()=>{const r=await d.souls.setIntent(s,p.data.intent,'web',guard);return {ok:true,intent:r.intent,text:r.text,tick:r.event.tick,seq:r.event.seq};});
  });
  app.post('/v1/souls/:id/pair', async (c) => { const account=d.cfg.accountAuthRequired?await d.auth.accountFromToken(bearer(c)):null;if(d.cfg.accountAuthRequired&&!account)throw new ApiError(401,'account-signin-required','Sign in to delegate a Soul.');if(account)d.souls.accounts!.verifySession(account.identity);const u = await requireUser(c); d.souls.requireInvited(u); return c.json({ ok: true, ...d.souls.pairCode(ownSoul(u, c.req.param('id')), baseOf(c), u) }); });
  app.post('/v1/souls/:id/revoke', async (c) => { const account=d.cfg.accountAuthRequired?await d.auth.accountFromToken(bearer(c)):null;if(d.cfg.accountAuthRequired&&!account)throw new ApiError(401,'account-signin-required','Sign in to revoke a Soul.');if(account)d.souls.accounts!.verifySession(account.identity);const u = await requireUser(c),s=ownSoul(u,c.req.param('id'));if(account)d.souls.accounts!.revoke(account.identity,s.id);else d.db.setSoulToken(s.id, null); return c.json({ ok: true }); });
  app.post('/v1/souls/:id/shot', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id')); const m = d.host.minds.get(s.id); if (!m) throw new ApiError(409, 'not-in-world', 'not in the world');
    const lim = d.souls.limits.allow(`shot:${s.owner}`, 12, 60_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'slow down', { retry_after: lim.retryAfter });
    const guard=d.souls.ownerControlGuard(s,u.id);if(guard)checkAcceptanceGuard(guard);
    return controlReply(c,guard,async()=>({ok:true,shot:await d.brain.shotFor(m)}));
  });
  // approving an agent that asked to be paired
  app.get('/v1/pair/:code', async (c) => { await requireUser(c); return c.json(d.souls.pairInfo(c.req.param('code'))); });
  app.post('/v1/pair/approve', async (c) => {
    if(d.cfg.accountAuthRequired){const account=await d.auth.accountFromToken(bearer(c));if(!account)throw new ApiError(401,'account-signin-required','Sign in to delegate a Soul.');d.souls.accounts!.verifySession(account.identity);}
    const u = await requireUser(c); d.souls.requireInvited(u); const p = pairApproveSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { code, soulId }');
    d.souls.pairApprove(u, p.data.code, ownSoul(u, p.data.soulId)); return c.json({ ok: true });
  });
  // model calls: admins see all; owners see calls about their own Souls
  app.get('/v1/brain', async (c) => {
    const u = privateUser(await requireUser(c));
    return c.json({ calls: d.db.brainCalls(intQ(c, 'limit', 100, 1, 500), { tier: c.req.query('tier') || undefined, ...(d.souls.lifecycle?{worldId:d.host.worldId}:{}), soulIds: u.role === 'admin' ? (c.req.query('soul') ? [c.req.query('soul')!] : null) : (d.souls.lifecycle?mySouls(u):d.db.soulsOf(u.id)).map((s) => s.id).filter((id) => !c.req.query('soul') || id === c.req.query('soul')) }) });
  });
  app.get('/v1/prompt/:hash', async (c) => {
    c.header('Cache-Control', 'no-store');
    const u = privateUser(await requireUser(c));
    const t = d.db.prompt(c.req.param('hash'), { worldId: d.host.worldId, userId: u.id, admin: u.role === 'admin',...(d.souls.lifecycle&&u.role!=='admin'?{soulIds:mySouls(u).map(s=>s.id)}:{}) });
    if (t === null) throw new ApiError(404, 'not-found', 'no such prompt');
    return c.text(t);
  });

  // ---- admin
  app.get('/v1/spend', async (c) => { await requireAdmin(c); return c.json(d.brain.spendReport()); });
  app.get('/v1/admin/clients', async (c) => { await requireAdmin(c); return c.json({ clients: d.hub.clientList(), users: d.db.countUsers() }); });
  app.get('/v1/admin/invites', async (c) => { await requireAdmin(c); return c.json({ invites: d.db.invites(), required: d.cfg.inviteRequired }); });
  app.post('/v1/admin', async (c) => {
    const u = await requireAdmin(c);
    const p = adminSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', p.error.message);
    const a = p.data, who = 'admin';
    switch (a.action) {
      case 'pause': d.host.setPaused(true, who); break;
      case 'resume': d.host.setPaused(false, who); break;
      case 'clock_rate': d.host.setClockRate(a.rate, who, 'admin'); break;
      case 'narrate': void d.brain.narrate(a.region, 'admin'); break;
      case 'brain_mode': d.brain.setMode(a.mode); void d.host.enqueue('admin', who, { action: 'brain_mode', mode: a.mode }); break;
      case 'budget': d.brain.budget = a.usdPerDay; void d.host.enqueue('admin', who, { action: 'budget', usdPerDay: d.brain.budget, requestedUsdPerDay:a.usdPerDay }); break;
      case 'snapshot': return c.json({ ok: true, snapshot: d.host.saveSnapshot() });
      case 'adopt_vocabulary': { const e = await d.host.adoptVocabulary(who); return c.json({ ok: true, tick: e.tick, seq: e.seq }); }
      case 'attune': { for (const m of d.host.minds.values()) void d.brain.attune(m); break; }
      case 'invite': { const code = newId('sim').replace('_', '-'); d.db.createInvite(code, a.uses, a.note ?? null, u.id); return c.json({ ok: true, code, uses: a.uses }); }
    }
    return c.json({ ok: true, clockRate: d.host.clockRate, paused: d.host.paused, brainMode: d.brain.mode, budget: d.brain.budget, budgetCeiling:d.brain.thinkingBudgetCeiling });
  });

  // ---- agents: pairing (no auth yet) and the per-Soul API (bearer = Soul token)
  app.post('/v1/agent/pair', async (c) => {
    limitIp(c, 'pair', 20, 60_000); const p = pairExchangeSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { "code": "XXXX-XXXX", "agent": "optional name" }');
    const r = d.souls.pairExchange(p.data.code, p.data.agent);
    return c.json({ ok: true, token: r.token, soul: r.soul, base: baseOf(c), next: 'Save the token (see skill.md), then call GET /v1/agent/perceive.' }, 200, { 'cache-control': 'no-store' });
  });
  app.post('/v1/agent/pair/start', async (c) => { limitIp(c, 'pairstart', 6, 60_000); const p = pairStartSchema.safeParse(await body(c).catch(() => ({}))); return c.json({ ok: true, ...d.souls.pairStart(p.success ? p.data.agent : undefined, baseOf(c)) }); });
  app.post('/v1/agent/pair/poll', async (c) => {
    limitIp(c, 'pairpoll', 60, 60_000);
    const p = pairPollSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { poll_token }');
    return c.json({ ok: true, ...d.souls.pairPoll(p.data.poll_token) });
  });
  // Legacy compatibility only; the audited launcher uses the POST body above.
  app.get('/v1/agent/pair/poll', (c) => { limitIp(c, 'pairpoll', 60, 60_000); return c.json({ ok: true, ...d.souls.pairPoll(c.req.query('poll_token') ?? '') }, 200, { 'cache-control': 'no-store' }); });
  app.get('/v1/agent/me', (c) => { const s = agentSoul(c), p = d.souls.agentPairing(bearer(c)); return c.json({ soul: { id: s.id, name: s.name, description: s.description }, paired_as: p?.label ?? null, since: p?.since ?? null, since_at: p?.since == null ? null : new Date(p.since).toISOString() }); });
  // Agent-local credentials expose only the selected Soul, never the browser
  // account's other memberships or a reusable human identity credential.
  app.get('/v1/agent/account-me',c=>{const s=agentSoul(c),credential=d.souls.agentCredential(bearer(c)!)!;return c.json({me:{id:credential.grant?.id??s.id,email:null,wallet:null,role:'user',invited:true,souls:[s.id]},souls:[{id:s.id,name:s.name,description:s.description,entityId:s.entity_id,profile:profiles.view(s.id)}]});});
  app.get('/v1/agent/soul',c=>{const s=agentSoul(c);if(!d.intentV2)return c.json(d.souls.dashboard(s));const service=d.intentV2,scope=service.agentScope(bearer(c)),result={status:d.souls.status(s),intentHistory:service.historyCapability(scope)};service.guard(scope);return c.json(result);});
  app.patch('/v1/agent/profile',async c=>{const s=agentSoul(c),principal=d.souls.agentCredential(bearer(c)!)!.grant?.accountId??s.owner,guard=d.souls.agentControlGuard(s,bearer(c)),profile=await profiles.update(principal,s.id,await body(c),guard);d.hub.refreshMe(principal);return c.json({ok:true,profile});});
  app.delete('/v1/agent/photo',async c=>{const s=agentSoul(c),principal=d.souls.agentCredential(bearer(c)!)!.grant?.accountId??s.owner,guard=d.souls.agentControlGuard(s,bearer(c)),profile=await profiles.clearPhoto(principal,s.id,guard);d.hub.refreshMe(principal);return c.json({ok:true,profile});});
  app.post('/v1/agent/photo',async c=>{const s=agentSoul(c),principal=d.souls.agentCredential(bearer(c)!)!.grant?.accountId??s.owner,guard=d.souls.agentControlGuard(s,bearer(c)),profile=await profiles.photo(principal,s.id,await body(c),guard);d.hub.refreshMe(principal);return c.json({ok:true,profile});});
  app.get('/v1/agent/status', (c) => c.json(d.souls.status(agentSoul(c))));
  app.get('/v1/agent/perceive',c=>{
    if(!d.intentV2?.historyEnabled){const soul=agentSoul(c);if(!d.host.extra.intentPurposeRecallV1)return c.json(d.souls.perceive(soul));c.header('Cache-Control','no-store');const guard=d.souls.agentControlGuard(soul,bearer(c));if(guard)checkAcceptanceGuard(guard);const result=d.souls.perceive(soul);if(guard)checkAcceptanceGuard(guard);return c.json(result);}
    c.header('Cache-Control','no-store');
    try{const scope=d.intentV2.agentScope(bearer(c)),perception=d.souls.perceive(agentSoul(c)),intentHistory=d.intentV2.historyCapability(scope);d.intentV2.guard(scope);
      return c.json({...perception,intentHistory});}catch(error){throw intentHistoryReadError(error);}
  });
  app.get('/v1/agent/world', (c) => { agentSoul(c); return c.json(d.souls.worldSummary()); });
  app.get('/v1/agent/log', (c) => c.json({ events: d.souls.soulLog(agentSoul(c)) }));
  app.get('/v1/agent/wait', async (c) => {const s=agentSoul(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.wait(s,intQ(c,'seconds',30,1,55)));});
  app.post('/v1/agent/intent', async (c) => {
    const s = agentSoul(c); const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,async()=>{const r=await d.souls.setIntent(s,p.data.intent,'api',guard);return {ok:true,accepted_at_tick:r.event.tick,seq:r.event.seq,intent:r.intent,text:r.text,status:d.souls.status(s)};});
  });
  app.post('/v1/agent/command', async (c) => {
    const s = agentSoul(c); const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    const guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.command(s,p.data.text,'api',guard));
  });
  app.get('/v1/agent/mandate',c=>c.json({rules:d.souls.rules(agentSoul(c))}));
  app.post('/v1/agent/mandate',async c=>{const s=agentSoul(c),input=await body(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.steer(s,input,'api',guard));});
  app.delete('/v1/agent/mandate/:rule',async c=>{const s=agentSoul(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.removeRule(s,c.req.param('rule'),guard));});
  app.get('/v1/agent/deck', (c) => c.json(d.souls.deck(agentSoul(c))));
  app.post('/v1/agent/cards', async (c) => {const s=agentSoul(c),input=await body(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.proposeCards(s,input,guard));});
  app.post('/v1/agent/release', (c) => { agentSoul(c); throw new ApiError(403, 'control.owner_required', 'Only your human can revoke control from the Soul card. Stop listening to go away; your pairing will remain valid.'); });

  // ---- static web app (SPA)
  const worldAssets = new URL('../../../worlds', import.meta.url).pathname;
  app.get('/world-assets/*', serveStatic({ root: worldAssets, rewriteRequestPath: p => p.replace(/^\/world-assets/, '') }));
  app.get('/buildings', c => c.html(`<main style="max-width:1100px;margin:auto;font:18px system-ui;padding:24px"><a href="/">Sim worlds</a><h1>Ceramic Tower and Minaret Temple</h1><p>First procedural versions, rebuilt after Vanessa Rosa's ceramics. Open rooms and shafts are sized for floating heads.</p><img style="width:100%" src="/world-assets/littlemartians/buildings/previews/both.jpg" alt="Ceramic Tower and Minaret Temple"/><h2>Inside the rooms</h2><img style="width:48%" src="/world-assets/littlemartians/buildings/previews/ceramic-tower-inside-L1.jpg" alt="Tower second room"/><img style="width:48%" src="/world-assets/littlemartians/buildings/previews/minaret-temple-inside-L1.jpg" alt="Temple domed room"/></main>`));
  if (existsSync(d.cfg.marsWebDir)) mountMarsStatic(app, d.cfg.marsWebDir);
  if (existsSync(d.cfg.webDir)) {
    // Re-read when the file changes so a frontend install needs no server restart (stat per request is cheap).
    const indexPath = join(d.cfg.webDir, 'index.html');
    let index = readFileSync(indexPath, 'utf8'), indexMtime = statSync(indexPath).mtimeMs;
    const worldClockNow = () => { try { return (d.host.engine.world as { env?: { datetime?: unknown } }).env?.datetime; } catch { return null; } };   // P7d: the early poster's sky (edge-snapshot.ts withWorldClock)
    const worldSoulsNow = () => { try { return d.host.minds.size; } catch { return null; } };   // P7d: the early poster's view (souls here: broadcast opens on a landmark)
    const currentIndex = () => { try { const m = statSync(indexPath).mtimeMs; if (m !== indexMtime) { index = readFileSync(indexPath, 'utf8'); indexMtime = m; } } catch { /* keep the last good index */ } return index; };
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('/assets/*', serveStatic({ root: d.cfg.webDir }));
    // lane P4: the installable-app manifest beside the page (apps/web/src/pwa-manifest.ts: its start_url "./" is this world)
    app.get('/manifest.webmanifest', async (c, next) => { const r = await serveStatic({ root: d.cfg.webDir, path: 'manifest.webmanifest' })(c, next); if (r?.ok) r.headers.set('Cache-Control', 'public, max-age=3600'); return r ?? c.notFound(); });
    app.get('*', (c) => (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/mcp') ? c.json({ ok: false, code: 'not-found', message: 'no such route' }, 404) : c.html(withInlineConfig(withSnapshotKey(withWorldClock(currentIndex(), worldClockNow(), worldSoulsNow()), safeKey(currentSnapshotKey), godRoutes?.partRefs()), safeConfig(c)), 200, { 'Cache-Control': 'no-cache' })));
  } else app.get('/', (c) => c.text('Sim server is running. The web app has not been built (pnpm build).'));
  return app;
}
