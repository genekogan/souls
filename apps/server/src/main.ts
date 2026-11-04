import {closeContextViews} from './god/context-views.ts';
import { Attention, unwatchedPace } from './attention.ts';
import { ClockCatchUp } from './clock-catchup.ts';
import { bootPhase } from './load/boot-progress.ts';
import {edenSteeringModeV1,installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {TakeArchive,r2Store} from './take-archive.ts';
import { createServer } from 'node:http';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { recordedToyFactory } from './toy-takes.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config, KNOWN_WORLD_KEYS } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import { Hub } from './hub.ts';
import { handleMcp } from './mcp.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';
import { enableEdgeRuntimeRules } from './edge-runtime-rules.ts';
import { LivingWorld } from './living.ts';
import { CampCards } from './camp.ts';
import {FloaterCards} from './floaters.ts';
import { worldDefinition } from './world-config.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { installWorldEnv } from './god/world-env.ts';
import { installLightning } from './god/lightning.ts';
import { installGovernance } from './god/governance-edge.ts';
import { GroundHost, installGroundCapabilities, loadGroundRecipes, registerGroundRecipes } from './god/ground-host.ts';
import { stripWorldRequestPath } from './world-request-path.ts';
import {edenCoreRequested,edenHistoryFactory,installEdenCore,settleEmptyEden,drainEdenThought,installEdenLifeV1,installEdenExpansionV1} from './eden-bootstrap.ts';
import {IntentControlV2} from './intent-control.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {installPuntActivities} from './punt-install.ts';
import {readFileSync} from 'node:fs';
import {installBirthLooks} from './god/birth-look.ts';
import { setKitViewerContract } from '@sim/generators';
import { rehearseRestore, standby } from './standby.ts';
import { coreLibrary } from '@sim/world-compiler';
import { startWatchdog, writeLiveNow } from './load/watchdog.ts';
import { sharedLoad } from './load/shared.ts';
import { LoadMonitor } from './load/monitor.ts';
import { Admission } from './load/admission.ts';
import { WakingLimit } from './load/waking.ts';

// Lane P5: when the boot's phases end (ms since the process started; the first is this release's code load)
const bootAt: Record<string, number> = { code: performance.now() };
// Release pre-warm (SIM_STANDBY=1, launcher handover): all code is loaded here; the database and port open only after SIGUSR2.
// G9 (lane Z1): it also builds the engine factory and the god's core library, and rehearses the snapshot restore read-only
// (standby.ts rehearseRestore).
let warmFactory: Awaited<ReturnType<typeof plainFactory>> | undefined;
await standby(async () => {
  if (config.engine === 'mars') await import('@sim/engine-mars');
  await import('./edge/body/migrate-looks.ts');
  if (config.worldEngine) coreLibrary();   // the god's shared core library (built once per process, ~0.1 s)
  if (!edenCoreRequested(config, process.env)) { warmFactory = await plainFactory(); rehearseRestore(join(config.dataDir, 'sim.db'), config.worldId, warmFactory as never, (ro) => { if (config.worldEngine && ro.prepare("SELECT 1 FROM sqlite_master WHERE name='world_ground_recipes_v1'").get()) registerGroundRecipes(ro, config.worldId); }); }
});
bootAt.go = performance.now();
// srv-load (LOAD-CONTRACT §4): the watchdog thread first, before the database opens, so <DATA_DIR>/live.json reports the
// whole boot. Not during a standby wait (the serving process still owns the file then). SIM_HEALTH_PORT: its own /healthz.
if (process.env.SIM_WATCHDOG !== '0') startWatchdog({ dataDir: config.dataDir, port: Number(process.env.SIM_HEALTH_PORT) || undefined });
bootPhase('boot:restore');

// K1 / NT5: new kit fields are admitted only with the viewer that can draw them.
try { setKitViewerContract(JSON.parse(readFileSync(join(config.webDir, 'kit-contract.json'), 'utf8'))); }
catch { setKitViewerContract(null); }

/** Seeded only into a world with no live Souls, so it is never empty. */
const NATIVES: { name: string; description: string }[] = [
  { name: 'Oda', description: 'a patient gardener who knows every bench and likes quiet mornings' },
  { name: 'Pim', description: 'a restless young musician who sings to anyone who will listen' },
  { name: 'Rowan', description: 'a curious wanderer who maps the edges of the ground and rarely sits still' },
  { name: 'Tamsin', description: 'a warm storyteller who keeps the campfire company and draws others in' },
  { name: 'Juno', description: 'a shy newcomer who watches from a distance before joining anything' },
  { name: 'Basil', description: 'a talkative kiosk regular who loves gossip and hates being alone' },
];

const db = new Db(join(config.dataDir, 'sim.db'));
const definition = worldDefinition(config.worldKey);
bootAt.db = performance.now();
if (db.migrated.length) console.log(`[db] applied migrations ${db.migrated.join(', ')}`);
const edenCore=edenCoreRequested(config,process.env);
const edenLife=edenCore&&process.env.ENABLE_EDEN_LIFE==='1';
const steeringMode=edenSteeringModeV1(edenLife,process.env);
const newcomerResources=process.env.ENABLE_EDEN_NEWCOMER_READER==='1';
if(newcomerResources&&!edenLife)throw Error('eden-bootstrap.newcomer-reader-requires-opted-in-Eden-life');
const expansionGround=process.env.ENABLE_EDEN_EXPANSION_GROUND_READER==='1';
if(expansionGround&&!edenLife)throw Error('eden-bootstrap.ground-extension-reader-requires-opted-in-Eden-life');
const lecture=process.env.ENABLE_EDEN_LECTURE_READER==='1';
if(lecture&&!edenLife)throw Error('eden-bootstrap.lecture-reader-requires-opted-in-Eden-life');
const sleepSnapshot=process.env.ENABLE_NATIVE_SLEEP_SNAPSHOT_READER==='1';
if(sleepSnapshot&&!edenLife)throw Error('eden-bootstrap.sleep-snapshot-reader-requires-opted-in-Eden-life');
const applyExpansion=process.env.APPLY_EDEN_EXPANSION_CHECKPOINT==='1';
if(applyExpansion&&(!edenLife||!newcomerResources||!sleepSnapshot||!lecture||!expansionGround||process.env.EDEN_CORE_RETAIN_READER==='1'))throw Error('eden-bootstrap.expansion-requires-complete-explicit-readers-and-install-mode');
// Launcher (entity) worlds opt into native Soul arrivals and removal (SOUL_LIFECYCLE=1), so account approvals create Souls as live does. Lane P2.
const accountLifecycle=config.worldEngine&&!edenCore&&process.env.SOUL_LIFECYCLE==='1';
const factory=edenCore?await edenHistoryFactory(db,config.worldId,{lifeV1:edenLife,newcomerResourcesV1:newcomerResources,sleepSnapshotV1:sleepSnapshot,lectureV1:lecture,groundV1:expansionGround}):warmFactory??await plainFactory();
/** A world's engine factory when it is not Eden core (that one reads its history from the database). Each process owns
 *  one world and imports its engine from this release. */
async function plainFactory() {
  const mars = config.engine === 'mars' ? await import('@sim/engine-mars') : null;
  const accountLifecycle = config.worldEngine && !edenCoreRequested(config, process.env) && process.env.SOUL_LIFECYCLE === '1';
  return mars?await mars.marsFactory(config.worldKey==='littlemartians'?mars.LITTLE_MARTIANS_WORLD:config.worldKey==='eden'||!KNOWN_WORLD_KEYS.includes(config.worldKey as never)?(accountLifecycle?{...mars.GREEN_FIELD_WORLD,safeCrewRemoval:true}:mars.GREEN_FIELD_WORLD):undefined):recordedToyFactory;
}
// ground/1 (lane L8): every terrain recipe this entity world logged resolves by hash before the engine replays
if (config.worldEngine) loadGroundRecipes(db, config.worldId);
const host = new WorldHost(db, factory, config.worldSeed, config.snapshotEveryTicks, config.worldId,edenCore?{durableClockV1:true}:undefined);
{ const at = performance.now(); if (db.vacuumIfBloated()) console.log(`[db] vacuumed at boot in ${Math.round(performance.now() - at)} ms (free pages over 30 %)`); }
host.snapshotDebtMs = config.snapshotDebtMs; host.snapshotMinGapMs = config.snapshotMinGapMs; host.snapshotAfterReplayTicks = config.snapshotAfterReplayTicks;
bootAt.open = performance.now();
const boot = host.boot();
bootAt.engine = performance.now();
if(edenCore)await installEdenCore(host,{applyCrew:process.env.APPLY_EDEN_CREW_CHECKPOINT==='1',applyCommons:process.env.APPLY_EDEN_COMMONS_CHECKPOINT==='1',retainReader:process.env.EDEN_CORE_RETAIN_READER==='1'});
const edenCapabilities=edenCore&&host.engine.rulesVersion.includes('+crew-removal/1');
console.log(`[world] ${host.worldId} booted from ${boot.from}, tick ${host.engine.world.tick}, replayed ${boot.replayed} events, ${host.minds.size} souls, rules ${host.engine.rulesVersion}`);

const auth = new Auth(config, db);
await auth.init().catch((e) => {if(config.accountAuthRequired)throw e;console.error('[auth] init failed:', e.message);});
if(config.accountAuthRequired&&!auth.ready)throw Error('Account authentication verifier unavailable');

const living = config.worldKey !== 'toy' && config.livingWorld ? new LivingWorld(host) : null;
if(edenCore)await settleEmptyEden(host,living,definition.customs);
else if (living) { living.camp = config.worldKey === 'mars'; void living.install(definition.customs); }
const runtimePolicy = host.extra.runtimePolicy as { sleepBlockTicks: number; quietSeatCourtesy?: boolean } | undefined;
if (living && host.engine.configureRuntimePolicy && !runtimePolicy?.quietSeatCourtesy) {
  void host.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200,...host.extra.runtimePolicy as object,quietSeatCourtesy:true},why:'enable ordinary idle-bystander courtesy at quiet seat exits prospectively; retain historical replay before this event'});
}
const campCards = living?.camp ? new CampCards(host) : null;
if(config.worldKey==='littlemartians')new FloaterCards(host);
void campCards;
const oldCharacters = ['A patient gardener who enjoys preparing food and welcoming people.', 'A curious builder who learns by making useful things from the yard’s materials.', 'A thoughtful reader and teacher who likes sharing ideas and quiet company.', 'A lively musician and storyteller who brings people together around the fire.'];
if (living) for (const [i, n] of definition.cast.entries()) {
  const m = [...host.minds.values()].find(m => m.name === n.name);
  if (m && (m.description === oldCharacters[i] || (i === 1 && m.description === oldCharacters[i].replace('’', "'")))) void host.enqueue('rules','world',{soulId:m.soulId,character:n.description,why:'adopt the four characters from merge plan section 4.9'});
}

let hub!: Hub;
const brain = new Brain(host, db, config, {
  onCall: (c) => hub?.brainCall(c),
  onCamera: (line) => hub?.broadcast({ t: 'camera', line }),
  onTicker: (lines) => hub?.broadcast({ t: 'ticker', lines }),
  onNarrative: (view) => hub?.broadcast({ t: 'narrative', view }),
  onTalk: (lines) => hub?.broadcast({ t: 'talk', lines }),
  clients: () => hub?.clients.size ?? 0,
},edenCapabilities?{intentV2Choices:true}:undefined);
const souls = new Souls(host, db, brain, config);
if(edenCapabilities||accountLifecycle&&host.engine.rulesVersion.includes('+crew-removal/1'))souls.enableLifecycle();
if(applyExpansion)await installEdenExpansionV1(host);
const edenLifeHandles=edenLife?await installEdenLifeV1(host,brain,{retainReader:process.env.EDEN_CORE_RETAIN_READER==='1',foodDeliveryId:process.env.EDEN_FINITE_FOOD_DELIVERY_ID}):undefined;
await installEdenSteeringModeV1(host,steeringMode,process.env.EDEN_CORE_RETAIN_READER==='1');
const intentV2=edenCapabilities?new IntentControlV2(host,brain,souls,{historyV1:true,...steeringMode}):undefined;

const server = createServer();
const stripWorldPath = (url: string | undefined) => stripWorldRequestPath(url, config.worldPath);
server.on('upgrade', req => { req.url = stripWorldPath(req.url); });
hub = new Hub(server, host, auth, db,edenCore?souls:undefined);
hub.brain = brain; hub.build = config.build; hub.persistTakes = config.takesPersist;
const takes=new TakeArchive(db,host.worldId,config.archiveTakes?r2Store(config):null,`${config.r2.prefix}/takes`,config.worldEngine?Number(process.env.TAKES_LOCAL_KEEP_TICKS??72000):0); if(host.engine.takeChunks&&config.takesPersist)takes.start(host);
// Edge worlds mount EDGE-CONTRACT-v1; PLACE_DATA names a PLACE-DATA-v1 file (else places derive from native regions).
const edge = config.mindDriver === 'edge' ? new EdgeLedger(host, db, process.env.PLACE_DATA ? JSON.parse(readFileSync(process.env.PLACE_DATA, 'utf8')) : undefined) : undefined;
if (edge && host.engine.configureRuntimePolicy) void enableEdgeRuntimeRules(host, config.worldKey);  // not the stair-traffic rules on the Little Martians worlds
// God mode + entity world (spec eden4/28): the owner's edge agent builds the world; viewers get diffs over the hub.
const genesis = process.env.GENESIS_FILE ? JSON.parse(readFileSync(process.env.GENESIS_FILE, 'utf8')) : undefined;
const god = config.worldEngine ? new GodMode(db, { genesis, worldId: host.worldId, ownerId: process.env.WORLD_OWNER_ID || null /* explicit only: on a fresh world the first person to claim it becomes its god */, tick: () => host.engine.world.tick, emit: (m) => hub.broadcast(m as never), cobuilders: process.env.SIM_COBUILDERS === '1' /* off: one god per world (Gene 2026-10-16) */ }) : undefined;
// Stage B (lane L8): the ground fact is queued before the entity bridge so boot installs the terrain first.
const groundHost = god && (host.engine as unknown as {installGroundV1?:unknown}).installGroundV1 ? new GroundHost(db, host, god) : undefined;
if (groundHost && edge) installGroundCapabilities(edge as never, god!, host);
// Stage B (lane L9): Souls live among god-built things — entity physics into the engine, fixtures usable, bodies as entities.
const engineBridge = god && config.engine === 'mars' && process.env.ENTITY_BRIDGE !== '0' ? installEngineBridge({ host, god, edge }) : undefined;
if (god && process.env.BIRTH_LOOKS !== '0') installBirthLooks(host, edge);  // lane LOOKS: new Souls in new worlds get a varied kit look
if (god) installWorldEnv(host, god, edge);  // R4-LIVE: Souls perceive the god's weather
if (god) installLightning(god, edge, () => host.engine.world.tick);  // GOD-ENV: Souls see the bolts and hear the thunder
if (god) installGovernance(god, { host, edge });  // GOVERN: versioned constitution, amendments, prayer states (god/governance.ts)
if (god) console.log(`[god] entity world ready: ${god.model.entities.size} entities, ${new Set(god.model.defs.values()).size} own defs + library ${god.model.library ? `${god.model.library.id}@${god.model.library.version} (${god.model.library.all().length})` : 'none'}, owner ${god.owner ?? '(unclaimed)'}`);
// Planned restart (LOAD-CONTRACT §1): a durable head first, through L5's host.requestSnapshot(reason, {now: true}) (lane
// srv-boot; feature-detected until it merges, then the existing synchronous saveSnapshot), before shutdown drains.
type SnapshotRequest = (reason: string, o?: { now?: boolean }) => { tick: number; pending: boolean } | null;
const plannedSnapshot = (reason: string) => { try { const req = (host as unknown as { requestSnapshot?: SnapshotRequest }).requestSnapshot; if (req) req.call(host, reason, { now: true }); else host.saveSnapshot(true); } catch (e) { console.error('[load] planned snapshot failed', e); } };
// srv-load: the load sensor (load/monitor.ts) and in-world admission (load/admission.ts; SIM_ADMISSION=0 turns it off).
// Black for 60 s → planned restart: snapshot, exit 75 (the launcher restarts at once, no backoff penalty).
const admission = process.env.SIM_ADMISSION === '0' ? undefined : new Admission();
const drill = process.env.SIM_LOAD_DRILL_LEVEL as 'amber' | 'red' | 'black' | undefined;   // drill: hold a level (L1 tests 'planned' restarts with black)
const monitor = new LoadMonitor({ host, drill: drill && ['amber', 'red', 'black'].includes(drill) ? drill : undefined, blackLimitMs: Number(process.env.SIM_LOAD_BLACK_MS) || 60_000, queue: () => admission?.queueStats() ?? { depth: 0, oldestMs: 0 }, shed: () => ({ reads: admission?.shed.reads ?? 0, acts: admission?.shed.acts ?? 0 }),
  requestMs: () => admission?.spentMs ?? 0, baselineMs: process.env.SIM_LOAD_BASELINE_MS !== undefined && process.env.SIM_LOAD_BASELINE_MS !== '' ? Number(process.env.SIM_LOAD_BASELINE_MS) : undefined,
  souls: () => { let awake = 0, connected = 0; for (const id of host.minds.keys()) { const st = host.publicBodyOf?.(id)?.state; if (st === 'awake') awake++; if (st && st !== 'asleep') connected++; } return { awake, waiting: waking?.waiting() ?? 0, connected }; },
  // CW3 (#737) S2: O(1) sizes read with presence every 2 s, and the hub's cumulative socket counters
  inventory: () => ({ souls: host.minds.size, entities: god?.model.entities.size ?? -1, viewers: hub.clients.size }), wire: () => hub.wire,
  onBlackTooLong: () => { console.log(`[load] black for ${Math.round((Number(process.env.SIM_LOAD_BLACK_MS) || 60_000) / 1000)} s: planned restart (snapshot, exit 75)`); plannedSnapshot('load:black: planned restart'); void shutdown('load:black', 75).catch(() => process.exit(75)); } });
if (admission) monitor.register('admission', (l) => admission.setLoadLevel(l));
monitor.register('hub', (l) => hub.setLoadLevel(l));
// L4's perception dial (lane srv-spatial, god/engine-bridge.ts PERCEIVE_DIAL); guarded until that lane merges
{ const b = engineBridge as unknown as { setLoadLevel?: (l: 'green' | 'amber' | 'red' | 'black') => void } | undefined; if (b?.setLoadLevel) monitor.register('perception', (l) => b.setLoadLevel!(l)); }
// Waking limit: DARK unless SIM_WAKING_LIMIT=1 (tranche §5.1); bound below, once the edge body rule exists.
let waking: WakingLimit | undefined;
const app = buildApp({ load: { admission, monitor, crowded: (soulId) => waking?.position(soulId) ?? null }, cfg: config, db, host, auth, hub, brain, souls, takes, intentV2, edge, god, contextReady: engineBridge ? ()=>engineBridge.contextReady() : undefined, contextWait: engineBridge ? signal=>engineBridge.waitForContext({signal}) : undefined, contextLevelAt: engineBridge ? (x,z,y)=>engineBridge.levelAt(x,z,y) : undefined });
if (process.env.SIM_WAKING_LIMIT === '1' && edge?.bodyRule) {
  const rule = edge.bodyRule;
  waking = new WakingLimit({ maxAwake: Number(process.env.SIM_MAX_AWAKE) || 12, owner: () => god?.owner ?? config.ownerId ?? null,
    view: { awake: (id) => rule.view(id)?.state === 'awake', souls: () => [...host.minds.values()].filter((m) => !m.native).map((m) => ({ soulId: m.soulId, owner: m.owner })) } });
  rule.mayWake = (id) => waking!.mayWake(id);
  monitor.register('waking', (l) => waking!.setLoadLevel(l));
  console.log(`[load] waking limit ON: ${Number(process.env.SIM_MAX_AWAKE) || 12} awake`);
}
// `closing` is declared before servingWarm: a slow boot hook below must not let the punt timer reach it uninitialized (TDZ).
let closing = false;
/** A serving warm's god-side step budget (ms; within the ledger's ~40 ms slice). */
const SERVING_STEP_MS = 20;
// Continuity (warm after listen, 2026-10-31): the caches a Soul's first rich `here` builds after a restart (on Eden 2026
// ~1.5-4 s in one go, with 503/429 under it) are built right after the port opens, in ~40 ms slices between whatever else
// is served (EdgeLedger.warmForServing); rich edge reads wait for it. Before listening, release 404 held Eden 2026's
// handover ~4 s longer (8.5 s "Reconnecting…"). An optimisation only: a failure is logged and Souls build them on demand.
const servingWarm=(why:'boot'|'activities')=>{if(closing||!edge||!engineBridge)return;const tick=host.engine.world.tick;
  void edge.warmForServing({pre:s=>engineBridge.servingWarmGen(s,SERVING_STEP_MS),stop:()=>closing}).then(w=>console.log(`[${why}] edge capability caches ${w.stopped?'stopped':'warm'} after listen: ${w.ms} ms: ${w.slices} slices (longest ${w.maxStepMs} ms) and the listing ${w.listingMs} ms, over ${w.wallMs} ms for ${w.souls} Souls${w.failed?` (${w.failed} failed)`:''} from tick ${tick}`));};
// A punt install moves the static world (new carriers and rides): its caches are rebuilt the same way shortly after.
if(edge)installPuntActivities(host,edge,m=>console.log(`[activities] ${m}`),engineBridge?()=>{setTimeout(()=>servingWarm('activities'),1000).unref();}:undefined);
// Stage B (lane B-port): the read-worker pool, DARK unless SIM_READ_WORKER=1 (split/read-pool.ts; nothing is imported
// otherwise). SIM_READ_WORKERS = pool size (registry `readWorkers`, 1–4, default 1); SIM_READ_PORTS = the launcher's ports.
if (process.env.SIM_READ_WORKER === '1' && edge) {
  const { ReadPool, readPorts, deltaSource } = await import('./split/read-pool.ts');
  const { accountTag } = await import('./load/admission.ts');
  const source = await deltaSource(host, edge);
  // SIM_READ_MODE=2 (B-facade): the worker runs the read code itself over a replica + a read-only view of the database
  const readMode = process.env.SIM_READ_MODE === '2' ? 2 : 1;
  const pool = new ReadPool({ workers: Number(process.env.SIM_READ_WORKERS) || 1, ports: readPorts(process.env.SIM_READ_PORTS), mode: readMode, worldPath: config.worldPath,
    ...(readMode === 2 ? { world: { dbPath: db.path, worldId: host.worldId } } : {}), shared: sharedLoad, admission, init: source.init, ask: source.ask, writes: source.writes,
    inbox: (soulId) => { const ib = (app as unknown as { agentInbox?: { touch(s: object): void; view(s: object): unknown } }).agentInbox, m = host.minds.get(soulId); if (!ib || !m) return null; const scope = { scope: `soul:${soulId}`, owner: m.owner }; ib.touch(scope); return ib.view(scope); },
    auth: (token) => { const s = souls.soulFromToken(token); return s && !s.retired_at && s.world_id === host.worldId ? { soulId: s.id, account: accountTag(s.owner) } : { soulId: null }; },
    run: async (f) => { const r = await app.fetch(new Request('http://127.0.0.1' + f.url, { method: f.method, headers: f.headers, ...(f.body && f.method !== 'GET' && f.method !== 'HEAD' ? { body: f.body } : {}) }), { simAdmitted: true });
      return { status: r.status, headers: [...r.headers], body: await r.arrayBuffer() }; } }).start();
  source.onDelta((d) => pool.delta(d), () => pool.reinit());
  (globalThis as { __simReadPool?: unknown }).__simReadPool = pool;   // tests and the harness read pool.status()
  // SIM_READ_ORACLE=1 (B-facade item 5, lane only): the five reads answered by main and by a replica ledger, compared
  if (process.env.SIM_READ_ORACLE === '1') { const { installReadOracle } = await import('./split/read-oracle.ts'); await installReadOracle(host, edge, source as never, db.path); console.log('[read-oracle] on'); }
  console.log(`[read] ${pool.size} read worker(s), mode ${readMode === 2 ? 'read code (here)' : 'subset (here, capabilities)'}`);
}
const listener = getRequestListener(app.fetch);
// G9 (lane Z1): a write in flight when the world is told to stop (a release hands it over, the launcher puts it to sleep)
// is answered before the snapshot is saved and the process exits, instead of dying with its connection (the god's CLI
// saw a 502 and could not tell whether its edit landed). Reads are not waited for: a GET cut here is asked again by
// the launcher, and long-polls would hold the stop. Bounded by WRITE_DRAIN_MS; still one writer, as the next process
// opens the database only after this one has exited.
const writesInFlight = new Set<Promise<void>>();
const WRITE_DRAIN_MS = Number(process.env.WRITE_DRAIN_MS ?? 2000);
server.on('request', (req, res) => {
  if(edenCore&&closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('Server restarting.');return;}
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') { const done = new Promise<void>((r) => res.once('close', r)); writesInFlight.add(done); void done.then(() => writesInFlight.delete(done)); }
  req.url = stripWorldPath(req.url);
  if (req.url?.startsWith('/mcp')) { handleMcp(req, res, souls, intentV2, edge ? (method: 'GET'|'POST', path: string, token: string, body?: unknown)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json()) : undefined).catch((e) => { console.error('[mcp]', e); if (!res.headersSent) res.writeHead(500).end(); }); return; }
  void listener(req, res);
});

// Unwatched worlds run their clock at a slower wall pace (attention.ts; on when SIM_UNWATCHED_PACE is set: the launcher sets it)
// ...and when somebody comes back, the world's time of day jumps to now (clock-catchup.ts; lane SLEEP): also after the
// launcher let the world exit while asleep, so this boot may itself be the return. Not in LivingWorld worlds (their
// dayConfig also restarts the day's events), which the launcher never runs.
const catchUp = process.env.SIM_UNWATCHED_PACE && !living ? new ClockCatchUp(host, config.dataDir, { log: (m) => console.log(m) }) : null;
if (process.env.SIM_UNWATCHED_PACE) new Attention((watched) => { host.setPace(watched ? 1 : unwatchedPace()); if (watched) void catchUp?.watched()?.catch(() => {}); else catchUp?.unwatched(); }).watch(server);
// SIM_BOOT_HASH=1 (measurement only): the engine state this boot restored, to compare with the one its last stop saved
if (process.env.SIM_BOOT_HASH === '1') console.log(`[boot] state at tick ${host.engine.world.tick}: ${host.engine.stateHash()}`);
host.start();
void catchUp?.watched()?.catch(() => {});
if (config.seedNatives && db.liveSouls(host.worldId).length === 0) {
  if (config.worldKey === 'toy') {
    for (const n of NATIVES) await souls.create('system', n, true);
  } else {
    if (!config.ownerId) throw new Error('WORLD_OWNER_ID is required before seeding a new world');
    db.upsertUser({ id: config.ownerId, email: config.adminEmails[0] ?? null, wallet: null, role: 'admin' });
    for (const n of definition.cast) {
      if(edenCapabilities){const op=souls.acceptLifecycleCreate(config.ownerId,n);
        for(let i=0;i<100&&!souls.controlReady(db.soul(op.scope.soulId)!);i++){host.drainInputs();await new Promise(r=>setTimeout(r,10));}
        if(!souls.controlReady(db.soul(op.scope.soulId)!))throw Error('eden-bootstrap.seed-admission-not-ready');
      }else await souls.create(config.ownerId, n);
    }
  }
  console.log(`[world] seeded ${host.minds.size} souls`);
}

// One-shot operator maintenance only; ordinary boots never rewrite existing looks.
// Set per boot by LEGACY_LOOKS_MODE, or per world by a one-shot <DATA_DIR>/legacy-looks.env (launcher children).
{const {legacyLookBootHook}=await import('./edge/body/migrate-looks.ts');await legacyLookBootHook(host,db,edge,config.dataDir,process.env);}
// One-shot operator maintenance: <DATA_DIR>/retire-residents.env retires Souls with no signed-in owner (retire-residents.ts).
{const {retireResidentsBootHook}=await import('./retire-residents.ts');await retireResidentsBootHook(souls,db,host.worldId,config.dataDir,process.env);}
// A full model is not ready for HTTP until its ordinary queued projection has folded into the engine.
// Keep start, maintenance and input ordering above unchanged; this is a readiness boundary, not a CPU saving.
if (engineBridge) {
  const waitAt = performance.now(), abort = new AbortController();
  bootPhase('boot:projection', host.engine.world.tick);
  const stopped = (signal: string) => abort.abort(new Error(`boot interrupted: ${signal}`));
  const term = () => stopped('SIGTERM'), interrupt = () => stopped('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', interrupt);
  try {
    // Recheck in this continuation: a pre-listen model commit can follow the bridge's notification microtask.
    do {
      const remaining = 60_000 - (performance.now() - waitAt);
      if (remaining <= 0) throw new Error('bridge.readiness.timeout');
      await engineBridge.waitForInitialProjection({ signal: abort.signal, timeoutMs: remaining });
    }
    while (!engineBridge.initialProjectionReady());
    console.log(`[boot] projection ${Math.round(performance.now() - waitAt)} ms initial physics coherent at tick ${host.engine.world.tick}`);
    const prepareAt = performance.now();
    bootPhase('boot:prepare', host.engine.world.tick);
    host.engine.prepareForServing?.();
    console.log(`[boot] prepare ${Math.round(performance.now() - prepareAt)} ms serving caches at tick ${host.engine.world.tick}`);
    // The edge capability caches (the first rich `here`'s ~1.5-4 s on Eden 2026) are warmed right after listen, sliced:
    // see servingWarm below.
  } catch (error) {
    closing = true; console.error('[boot] initial physics unavailable; HTTP was not opened', error);
    try {
      for (const close of [() => host.stop(), () => takes.stop(), () => edge?.comms?.close(), () => auth.close(), () => db.close()]) {
        try { close(); } catch (cleanupError) { console.error('[boot] cleanup failed', cleanupError); }
      }
    } finally {
      process.off('SIGTERM', term); process.off('SIGINT', interrupt);
      process.exit(abort.signal.aborted ? 0 : 1);
    }
  } finally {
    process.off('SIGTERM', term); process.off('SIGINT', interrupt);
  }
}
server.listen(config.port, config.host, () => {
  bootPhase('serving', host.engine.world.tick); monitor.start(); servingWarm('boot');
  console.log(`[http] listening on http://${config.host}:${config.port} (public ${config.publicUrl}), build ${config.build}, brain ${brain.mode}, budget $${brain.budget}/day, invites ${config.inviteRequired ? 'required' : 'open'}`);
  const s = (ms: number) => (ms / 1000).toFixed(2);
  console.log(`[boot] listening ${s(performance.now())} s after start: code ${s(bootAt.code)}, engine ${s(bootAt.engine - bootAt.open)}, the rest ${s(performance.now() - bootAt.engine)}`);
  // Issue #395: without the Mars web assets (the people's character set under /modular) every world draws no people.
  if (!existsSync(join(config.marsWebDir, 'modular/humanoid/kit.json'))) console.warn(`[http] no character set in ${config.marsWebDir} (MARS_WEB_DIR): people will not render. Run pnpm build:viewer, then restart`);
  if (process.env.SIM_STANDBY === '1') console.log(`[boot] listening ${s(performance.now() - bootAt.go)} s after the standby go: database ${s(bootAt.db - bootAt.go)}, factory ${s(bootAt.open - bootAt.db)}, engine ${s(bootAt.engine - bootAt.open)}, the rest ${s(performance.now() - bootAt.engine)}`);
});

const shutdown = async (sig: string, exitCode = 0) => {
  if (closing) return; closing = true; bootPhase('stopping', host.engine.world.tick); writeLiveNow(config.dataDir);
  // Lane L5: a durable head first, before any draining that could outlast the launcher's stop grace (then SIGKILL).
  if (host.snapshotAgeMs() > 10_000) { try { host.requestSnapshot(`${sig}: before draining`, { now: true }); } catch (e) { console.error('[world] early snapshot failed', e); } }
  if (writesInFlight.size) {
    const n = writesInFlight.size, t = performance.now();
    await Promise.race([Promise.all(writesInFlight), new Promise((r) => setTimeout(r, WRITE_DRAIN_MS))]);
    console.log(`[world] ${sig}: ${n - writesInFlight.size} of ${n} write request(s) in flight answered in ${Math.round(performance.now() - t)} ms`);
  }
  // Edge worlds have no thought to drain: freeze the clock before the port is released so no successor
  // process can boot while this one still advances the durable clock frontier.
  if (config.mindDriver === 'edge') { host.stop(); edge?.comms?.close(); }
  if(edenCore){
    brain.quiesce();takes.stop();clearTimeout(firstBackup);clearInterval(backupTimer);
    void hub.closeClients('server restarting');
    const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
    await drainEdenThought(host,brain,intentV2,closed,[()=>edenLifeHandles?.settled()??Promise.resolve(),()=>takes.settled(),()=>Promise.all(backupWork)]);
    edenLifeHandles?.close();
  }
  console.log(`[world] ${sig}: saving snapshot at tick ${host.engine.world.tick}`);
  host.stop(); takes.stop();
  const saveAt = performance.now();
  try { host.saveSnapshot(true); } catch (e) { console.error('[world] snapshot failed', e); }
  if (process.env.SIM_BOOT_HASH === '1') console.log(`[world] ${sig}: state at tick ${host.engine.world.tick}: ${host.engine.stateHash()}`);
  console.log(`[world] ${sig}: snapshot saved in ${Math.round(performance.now() - saveAt)} ms (capture ${Math.round(host.snapshotMs.capture)}, write ${Math.round(host.snapshotMs.persist)})`);
  server.close(); void hub.closeClients('server restarting');
  await closeContextViews();
  auth.close();db.close(); process.exit(exitCode);
};
// The launcher's wedge path sends SIGUSR2 before SIGTERM (LOAD-CONTRACT §4): a diagnostic report, if this thread can still run.
process.on('SIGUSR2', () => { try { console.log(`[load] SIGUSR2: diagnostic report ${process.report?.writeReport(join(config.dataDir, `report-${Date.now()}.json`))}`); } catch (e) { console.error('[load] report failed', e); } });
process.on('SIGTERM', () => void shutdown('SIGTERM').catch(()=>console.error('[world] shutdown is incomplete; retain database and inspect')));
process.on('SIGINT', () => void shutdown('SIGINT').catch(()=>console.error('[world] shutdown is incomplete; retain database and inspect')));

// Hourly on-box backup with retention: the last 6 hourly files plus one per day (the 00:00 UTC file) for 7 days.
function pruneBackups() {
  const files = readdirSync(config.dataDir).filter((f) => /^backup-\d{10}\.db$/.test(f)).sort().reverse();
  const keep = new Set(files.slice(0, 6));
  const now = Date.now();
  for (const f of files) {
    const day = Date.UTC(Number(f.slice(7, 11)), Number(f.slice(11, 13)) - 1, Number(f.slice(13, 15)));
    if (f.slice(15, 17) === '00' && now - day <= 8 * 86400_000) keep.add(f); // real date difference, correct across month boundaries
  }
  for (const f of files) if (!keep.has(f)) { try { unlinkSync(join(config.dataDir, f)); } catch { /* already gone */ } }
}
async function backupNow() {
  db.pruneBrainCalls(); db.pruneTalk();
  // (lane L5) no VACUUM here: it rewrote the whole file on the tick thread, stalling a serving world for seconds.
  // SQLite reuses free pages; a bloated file is compacted once at the next boot, before the world serves.
  await db.backupTo(join(config.dataDir, `backup-${new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '')}.db`));
  pruneBackups();
}
const backupWork=new Set<Promise<void>>();
function trackedBackup(){const work=backupNow();backupWork.add(work);void work.finally(()=>backupWork.delete(work)).catch(()=>{});return work;}
pruneBackups();
const firstBackup=setTimeout(() => void trackedBackup().catch((e) => console.error('[backup]', e)), 60_000);firstBackup.unref();
const backupTimer=setInterval(() => void trackedBackup().catch((e) => console.error('[backup]', e)), 3600_000);backupTimer.unref();
