// WebSocket hub: many clients, one world. On join: welcome + snapshot (or a
// replay of missed batches). Then batches every 500 ms and a heartbeat every
// 5 s carrying the view hash so each client can verify its replica.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {randomUUID} from 'node:crypto';
import { COLUMNS_V1,packColumnsV1,joinTableOrderV1, PROTO, publicEvent,TAKE_BOUNDARY_WIRE_V1,stringifyTakeBoundaryWireV1,TAKE_ENTITIES_WIRE_V1,TAKE_ENTITIES_JOIN_V1,TakeEntitiesEncoderV1,TAKE_CHUNKS_WIRE_V1,TakeChunksEncoderV1,kernelRestV1,stationHelloCapabilitiesV1Schema,negotiateStationContractV1,meLiveDescriptorV1Schema,meLiveViewV1Schema,
  type StationLiveContract,type BrainCall, type ClientMsg, type Me, type ServerMsg, type ServerStats } from '@sim/protocol';
import type { Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Db } from './db.ts';
import { type WorldHost } from './world.ts';
import type { Souls } from './souls.ts';
import type {CandidateStationV1} from './station.ts';
import type {CandidateStationV2} from './station-v2.ts';

const clientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), proto: z.number(), token: z.string().max(4000).optional(), since: z.number().optional(), epoch: z.string().max(40).optional(),
    stationContracts:stationHelloCapabilitiesV1Schema.shape.stationContracts,takeTransport:z.literal(TAKE_BOUNDARY_WIRE_V1).optional(),
    // an unknown later contract is not an error: the peer simply gets the full table
    takeEntities:z.string().max(40).optional(),takeChunks:z.string().max(40).optional(),takeEntitiesJoin:z.string().max(40).optional(),snapshotColumns:z.string().max(40).optional() }),
  z.object({ t: z.literal('resync'), reason: z.string().max(200) }),
  z.object({ t: z.literal('ping'), n: z.number() }),
]);
const MAX_PER_IP = 30, MAX_CLIENTS = 2000;
type Client = { heldSince?: number; ws: WebSocket; me: Me | null; ready: boolean; alive: boolean; joinedAt: number; resyncs: number; sent: number; ip: string; msgs: number; windowStart: number; lastHello: number; lastSnapshot: number; stationContract:StationLiveContract|null;
  authUserId?:string|null;helloGeneration?:number;meScope?:{contract:'me-live/1';connectionId:string;userId:string|null;revision:number;worldId:string;epoch:string};publishedMe?:string;takeTransport?:typeof TAKE_BOUNDARY_WIRE_V1;
  /** take-entities-ref/1 peers: the id of the last entity table this socket was sent (null: none yet); `join`:
   *  take-entities-join/1 was negotiated too (each snapshot names its table, which becomes `last`). */
  takeEntities?:{last:number|null;join?:true};
  /** take-chunk-ref/1 peers: the id of the last take this socket was sent (null: none yet) and the last kernel view sent
   *  without its tick (kernelRestV1). */
  takeChunks?:{last:number|null;kernel?:string};
  /** columns/1 (lane JOINSET): this peer takes its snapshots' entity tables in the column form. */
  snapshotColumns?:boolean;
  /** Set by a join until the first takes message with a chunk is written: that one is never dropped for backpressure. */
  awaitingTakes?:boolean;joinSend?:boolean;joinPending?:number };
/** What anyone may see of the server's numbers: spend is for admins. */
const publicStats = (st: ServerStats): ServerStats => ({ ...st, brain: { mode: st.brain.mode, callsToday: st.brain.callsToday, inflight: st.brain.inflight, jevMsAvg: st.brain.jevMsAvg } });
const MAX_BUFFERED = 1_000_000;
/** Longest the world clock waits for a join set (lane P5); under the frame loop's 1 s elapsed cap, so no world time is lost. */
const JOIN_HOLD_MS = 750, JOIN_HOLD_REST_MS = 2_000;
/** A world's stop waits this long for its sockets to finish the close handshake, then cuts the rest (Hub.closeClients). */
export const CLOSE_GRACE_MS = 500;

/** Live viewers never read a take's static physics (entityPhysicsV1: every building's floors, walls and stairs; they
 *  draw geometry from /v1/scene). On a built world it is ~3 MB of JSON per one-second chunk (Eden 2026), so the live
 *  stream leaves it out; recorded takes (TAKES_PERSIST) and HTTP history keep the full chunk. */
export function viewerChunk<T>(chunk: T): T {
  const c = chunk as { take?: { finalState?: Record<string, unknown>; tracks?: Record<string, unknown>; entities0?: Record<string, {def:string}> } };
  const state = c?.take?.finalState; if (!state || state.entityPhysicsV1 === undefined) return chunk;
  const { entityPhysicsV1: _omit, ...rest } = state;
  const physics = _omit as {assets?: Record<string, import('../../../mars/viewer/engine/world/catalog.ts').AssetDef>};
  const records = state.entities as Record<string, {def:string}> | undefined;
  const handling: Record<string, import('../../../mars/viewer/engine/world/catalog.ts').Handling> = {};
  for (const id of Object.keys(c.take?.tracks ?? {})) {
    const e = records?.[id] ?? c.take?.entities0?.[id];
    const h = e && physics.assets?.[e.def]?.capabilities?.fixtureCarry?.handling;
    if (h) handling[e.def] = h;
  }
  return { ...c, take: { ...c.take, finalState: rest, ...(Object.keys(handling).length ? {fixtureCarryHandlingV1: handling} : {}) } } as T;
}
/** P2 (E-life): an HTTP take history reply (/v1/takes, /v1/take) as the live stream sends it, without each chunk's static
 *  physics; `full` (the `?physics=1` query) keeps the canonical chunks for tools that replay from them. */
/** The join's display log (the `log` message; clients only show it, the replica comes from the snapshot or batches): a
 *  world-edit event's payload is the commit's derived physics and assets (the Eden 2026 genesis batch: 4.1 MB). Its result
 *  is already in the world the client receives; the row keeps its seq, tick, author and identity, GET /v1/log the rest. */
export function joinLogEvent<T extends {kind:string;payload?:unknown}>(e:T):T{
  if(e.kind!=='world-edit'||!e.payload||typeof e.payload!=='object')return e;
  const p=e.payload as {contract?:unknown;seq?:unknown;hash?:unknown};
  return {...e,payload:{contract:p.contract,seq:p.seq,hash:p.hash,omitted:'physics and assets (in the world state; GET /v1/log for the full event)'}};
}
export function publicTakes<T>(value: T, full = false): T {
  const v = value as { chunks?: unknown[] };
  return !full && Array.isArray(v?.chunks) ? { ...v, chunks: v.chunks.map((k) => viewerChunk(k)) } as T : value;
}
const SWEEP_MS = 15_000;
export class Hub {
  wss: WebSocketServer;
  /** Other WebSocket endpoints on this server (EVENTS-v1 /v1/edge/events/ws); each returns true when it took the upgrade. */
  upgradeHandlers: ((req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => boolean)[] = [];
  clients = new Set<Client>();
  /** CW3 (#737) S2: cumulative viewer-socket counters for the load monitor (live.json `ws`); bytes as the hub already counts them per client. */
  readonly wire = { opened: 0, closed: 0, sent: 0, received: 0 };
  /** Every upgraded socket on this server (viewers and other WebSocket endpoints) until it is closed. */
  private upgraded = new Set<import('node:stream').Duplex>();
  brain!: Brain;
  startedAt = Date.now();
  /** Changes with every start of the process: a client may resume only from batches this process sent. */
  epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  build = 'dev';
  private lastTakeTick = -1;
  /** take-entities-ref/1: one table registry for every peer that announced it (see packages/protocol take-entities-wire). */
  readonly takeEntities = new TakeEntitiesEncoderV1();
  readonly takeChunks = new TakeChunksEncoderV1();
  /** Take recordings (take_chunks) are a pose-keyframe cache, off by default (TAKES_PERSIST=1 turns them on).
   * The engine's in-memory live buffer still feeds new viewers; the event log rebuilds a world. */
  persistTakes = process.env.TAKES_PERSIST === '1';
  host: WorldHost; auth: Auth; db: Db;
  private lifecycleSouls?:Souls;
  private station?:CandidateStationV1;
  private stationV2?:CandidateStationV2;

  constructor(server: Server, host: WorldHost, auth: Auth, db: Db,lifecycleSouls?:Souls,station?:CandidateStationV1,stationV2?:CandidateStationV2) {
    this.host = host; this.auth = auth; this.db = db;
    if(station){if(station.host!==host)throw new Error('station must belong to selected Hub host');this.station=station;}
    if(stationV2){if(stationV2.host!==host)throw new Error('V2 station must belong to selected Hub host');this.stationV2=stationV2;}
    // Internal opt-in only; production bootstrap does not supply this adapter.
    if(lifecycleSouls){
      if(!lifecycleSouls.lifecycle||lifecycleSouls.host!==host||lifecycleSouls.db!==db)throw new Error('Lifecycle WS views require the installed candidate on this host/DB');
      this.lifecycleSouls=lifecycleSouls;
    }
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: {threshold: 1024, clientNoContextTakeover: true, serverNoContextTakeover: true, concurrencyLimit: 4} });
    server.on('upgrade', (req, socket, head) => {
      this.upgraded.add(socket); socket.once('close', () => this.upgraded.delete(socket));
      if (!req.url?.startsWith('/ws')) { for (const h of this.upgradeHandlers) { try { if (h(req, socket, head)) return; } catch { /* a handler fault falls through */ } } socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws, req));
    });
    // Lane P5: a join set is written in order, each larger message after its compression finishes (one or two event-loop
    // turns each). The world's clock waits for it (at most JOIN_HOLD_MS after the hello), so a cold world's first heavy ticks
    // do not stand between a visitor and their join set; the held time is caught up by the next frame.
    host.holdClock = () => this.joinInFlight();
    host.listeners.push({
      onClockUnavailable:()=>{for(const c of this.clients){c.ready=false;c.ws.close(1013,'world unavailable');}},
      onApplied: e => { if (e.kind === 'rules' && e.payload?.recovery) { this.lastTakeTick=host.engine.world.tick; this.epoch=`${Date.now().toString(36)}-repair`; for (const c of this.clients) c.ws.close(1012, 'world restored; reconnect'); }
        if(e.kind==='station-rules-era-v1'){
          for(const c of this.clients){if(!c.ready)continue;
            if(c.stationContract==='station-live/1')this.welcomeClient(c);
            this.send(c,{t:'snapshot',reason:'recorded physical checkpoint',...host.snapshotView()});
          }
        }
        if(['station-epoch-v1','station-cue-v1','station-anchor-v1','station-rules-era-v1','station-cue-v2','station-anchor-v2'].includes(e.kind))
          for(const c of this.clients)if(c.ready)this.sendStation(c); },
      afterTick: tick => {
        const chunks = host.engine.takeChunks?.(this.lastTakeTick) ?? [];
        if (!chunks.length) return;
        for (const chunk of chunks) {
          const ref=(chunk.take as {renderSceneRef?:{hash:string}}).renderSceneRef;
          const scene=ref&&!db.hasRenderSceneCapture(host.worldId,ref.hash)?host.engine.takeScene?.(ref.hash):undefined;
          if(this.persistTakes)db.saveTake(host.worldId,chunk,scene);
          else if(scene)db.saveRenderSceneCapture(host.worldId,scene);
        }
        this.lastTakeTick = chunks.at(-1)!.toTick;
        if (chunks.length) this.broadcast({t: 'takes', serverTick: tick, chunks: chunks.map(viewerChunk)});
      },
      onBatch: (b) => this.broadcast({ t: 'batch', ...b, log: b.log.map(publicEvent) }),
      onHeartbeat: (h) => this.broadcast({ t: 'heartbeat', ...h, clients: this.clients.size }),
      onKernel: (view) => this.broadcast({ t: 'kernel', view }),
      onPlay: (p) => this.broadcast({ t: 'plays', plays: [p] }),
    });
    setInterval(() => this.sweep(), SWEEP_MS).unref();
    // load dial: viewer stats every 2 s at green, 4 s at amber, 8 s at red/black
    let statsN = 0;
    setInterval(() => { if (++statsN % ({green: 1, amber: 2, red: 4, black: 4} as const)[this.loadLevel] !== 0) return; const full = this.stats(); this.broadcast({ t: 'stats', stats: full }, (c) => c.me?.role === 'admin'); this.broadcast({ t: 'stats', stats: publicStats(full) }, (c) => c.me?.role !== 'admin'); }, 2_000).unref();
    // a socket that never introduces itself is not a viewer
    // judged after the poll phase (setImmediate), so a hello that arrived during a stall is read first
    setInterval(() => setImmediate(() => { const now = Date.now(); for (const c of this.clients) if (!c.ready && now - c.joinedAt > 15_000 + this.stallMs) { c.ws.close(1008, 'no hello'); this.clients.delete(c); } }), 5_000).unref();
  }

  private onConnect(ws: WebSocket, req: IncomingMessage) {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    let sameIp = 0; for (const x of this.clients) if (x.ip === ip) sameIp++;
    if (this.clients.size >= MAX_CLIENTS || sameIp >= MAX_PER_IP) { ws.close(1013, 'too many connections'); return; }
    const c: Client = { ws, me: null, ready: false, alive: true, joinedAt: Date.now(), resyncs: 0, sent: 0, ip, msgs: 0, windowStart: Date.now(), lastHello: 0, lastSnapshot: 0,stationContract:null,authUserId:null,helloGeneration:0 };
    this.clients.add(c); this.wire.opened++;
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => { this.clients.delete(c); this.wire.closed++; });
    ws.on('error', () => this.clients.delete(c));
    const inbound = (data: unknown, fromUrl = false) => {
      // inbound messages are validated and rate limited (20 per 10 s is far more than a well-behaved client sends)
      const now = Date.now(); if (now - c.windowStart > 10_000) { c.windowStart = now; c.msgs = 0; }
      if (++c.msgs > 20) { ws.close(1008, 'too many messages'); return; }
      let raw: unknown; try { raw = JSON.parse(String(data)); } catch { return; }
      const p = clientMsg.safeParse(raw); if (!p.success) return;
      // a hello in the URL is the page's anonymous one: never a token (URLs end up in logs), never anything but a hello
      if (fromUrl && (p.data.t !== 'hello' || p.data.token !== undefined)) return;
      const pending=this.onMessage(c,p.data as ClientMsg);
      const generation=c.helloGeneration;
      if(this.lifecycleSouls)void pending.catch(error=>{if(this.clients.has(c)&&c.helloGeneration===generation)this.privateViewFailed(c,error);});
      else void pending;
    };
    ws.on('message', (data) => { this.wire.received += (data as { byteLength?: number }).byteLength ?? 0; inbound(data); });
    // P7: the page's entry socket says its anonymous hello in the URL (/ws?hello=…), so the join leaves as soon as the
    // socket is open: a hello sent from the page's open event waited for its main thread, busy building the world (~1 s
    // on a phone)
    const hello = urlHello(req.url); if (hello) inbound(hello, true);
  }

  private async onMessage(c: Client, m: ClientMsg) {
    if(!this.host.clockAvailable){c.ready=false;c.ws.close(1013,'world unavailable');return;}
    if (m.t === 'ping') return this.send(c, { t: 'pong', n: m.n, serverTime: Date.now() });
    // joining and resyncing each build a full view of the world: once every few seconds per socket is plenty
    const now = Date.now();
    // load dial (black): a join or resync builds a full view of the world; hold it (up to 30 s) instead of adding that
    // cost to a world that cannot keep up. The page hears {t:'load'} and shows "the world is busy" meanwhile.
    if ((m.t === 'hello' || m.t === 'resync') && this.loadLevel === 'black') {
      c.heldSince ??= now;
      if (now - c.heldSince < 30_000) { if (now - c.heldSince < 100) this.send(c, {t: 'load', level: 'black'} as unknown as ServerMsg); setTimeout(() => { if (this.clients.has(c)) void this.onMessage(c, m); }, 2_000).unref(); return; }
    }
    c.heldSince = undefined;
    if (m.t === 'resync') { if (now - c.lastSnapshot < 2_000) return; c.lastSnapshot = now; }
    if (m.t === 'hello') { if (now - c.lastHello < 3_000) return; c.lastHello = now; c.lastSnapshot = now; }
    if (m.t === 'resync') { c.resyncs++; return this.send(c, { t: 'snapshot', reason: `resync: ${String(m.reason).slice(0, 80)}`, ...this.host.snapshotView() }); }
    if (m.t === 'hello') {
      const generation=(c.helloGeneration??0)+1;c.helloGeneration=generation;
      c.ready=false;c.me=null;c.authUserId=null;c.meScope=undefined;c.publishedMe=undefined;c.takeTransport=undefined;c.takeEntities=undefined;c.takeChunks=undefined;c.snapshotColumns=false;c.awaitingTakes=false;
      if (m.proto !== PROTO) { this.send(c, { t: 'welcome', build: this.build, proto: PROTO, worldId: this.host.worldId, rulesVersion: this.host.engine.rulesVersion, schema: this.host.engine.schema, dt: this.host.engine.dt, clockRate: this.host.clockRate, serverTick: this.host.engine.world.tick, you: null, serverTime: Date.now(), epoch: this.epoch }); return this.send(c, { t: 'error', code: 'proto', message: `server speaks protocol ${PROTO}` }); }
      const u = await this.auth.userFromToken(m.token).catch(() => null);
      if(!this.clients.has(c)||c.helloGeneration!==generation||c.ws.readyState!==1||!this.host.clockAvailable)return;
      c.authUserId=u&&(!this.lifecycleSouls||this.db.user(u.id))?u.id:null;
      c.me = u ? this.lifecycleSouls?this.currentMe(u.id):this.auth.me(u) : null;
      c.takeTransport=m.takeTransport===TAKE_BOUNDARY_WIRE_V1?TAKE_BOUNDARY_WIRE_V1:undefined;
      c.takeEntities=m.takeEntities===TAKE_ENTITIES_WIRE_V1?{last:null,...(m.takeEntitiesJoin===TAKE_ENTITIES_JOIN_V1?{join:true as const}:{})}:undefined;
      c.takeChunks=m.takeChunks===TAKE_CHUNKS_WIRE_V1?{last:null}:undefined;c.snapshotColumns=m.snapshotColumns===COLUMNS_V1;
      c.stationContract=negotiateStationContractV1(m.stationContracts?{stationContracts:m.stationContracts}:{},
        [...(this.station?['station-live/1' as const]:[]),...(this.stationV2?['station-live/2' as const]:[])]);
      const e = this.host.engine;
      if(!this.welcomeClient(c))return;
      // resume from the ring buffer if the client only missed a little; otherwise a full snapshot
      const ring = this.host.ring;
      // the join set is bounded (one per hello, hellos at most every 3 s) and is never dropped for backpressure
      c.joinSend=true;c.awaitingTakes=true;
      try{
      const canResume = typeof m.since === 'number' && m.epoch === this.epoch && ring.length > 0 && m.since >= ring[0].seq - 1 && m.since <= this.host.currentBatchSeq;
      if (canResume) for (const b of ring) { if (b.seq > m.since!) this.send(c, { t: 'batch', ...b, log: b.log.map(publicEvent) }); }
      else this.send(c, { t: 'snapshot', reason: typeof m.since === 'number' ? 'too far behind; full snapshot' : 'join', ...this.host.snapshotView() });
      this.send(c, { t: 'log', events: this.db.tailEvents(this.host.worldId, 150, true).map(e=>joinLogEvent(publicEvent(e))) });
      this.send(c, { t: 'kernel', view: this.host.kernelView() });
      this.send(c, { t: 'plays', plays: this.host.recentPlays.slice(-60) });
      this.send(c, { t: 'talk', lines: this.db.recentTalk(40) });
      if (this.brain.camera) this.send(c, { t: 'camera', line: this.brain.camera });
      if (this.brain.ticker.length) this.send(c, { t: 'ticker', lines: this.brain.ticker.slice(-20) });
      for (const v of this.brain.narratives.values()) this.send(c, { t: 'narrative', view: v });
      if (c.me) this.send(c, { t: 'brain', calls: this.db.brainCalls(40, { soulIds: c.me.role === 'admin' ? null : c.me.souls }) });
      this.send(c, { t: 'stats', stats: c.me?.role === 'admin' ? this.stats() : publicStats(this.stats()) });
      this.send(c, {t: 'takes', serverTick: e.world.tick, chunks: (e.takeChunks?.(e.world.tick - 40) ?? []).map(viewerChunk)});
      for (const extra of this.joinMessages) { try { for (const x of extra()) this.send(c, x as ServerMsg); } catch { /* optional standing state */ } }
      this.sendStation(c);
      }finally{c.joinSend=false;}
      c.ready = c.ws.readyState===1&&c.helloGeneration===generation;
    }
  }
  private welcomeClient(c:Client){
    const h=this.host,e=h.engine;
    if(!this.refreshAuthority(c,false))return false;
    if(this.lifecycleSouls)c.meScope={...meLiveDescriptorV1Schema.parse({contract:'me-live/1',connectionId:randomUUID(),userId:c.authUserId??c.me?.userId??null,revision:1}),worldId:h.worldId,epoch:this.epoch};
    const sent=this.send(c,{t:'welcome',build:this.build,proto:PROTO,worldId:h.worldId,rulesVersion:e.rulesVersion,schema:e.schema,dt:e.dt,
      clockRate:h.clockRate,serverTick:e.world.tick,you:c.me,serverTime:Date.now(),epoch:this.epoch,paused:h.paused,
      ...(this.lifecycleSouls?{privateMe:{contract:'me-live/1' as const,connectionId:c.meScope!.connectionId,userId:c.meScope!.userId,revision:1 as const}}:{}),
      ...(this.station||this.stationV2?{stationContract:c.stationContract}:{}),...(c.takeTransport?{takeTransport:c.takeTransport}:{}),...(c.takeEntities?{takeEntities:TAKE_ENTITIES_WIRE_V1}:{}),...(c.takeEntities?.join?{takeEntitiesJoin:TAKE_ENTITIES_JOIN_V1}:{}),...(c.takeChunks?{takeChunks:TAKE_CHUNKS_WIRE_V1}:{})});
    if(sent)c.publishedMe=JSON.stringify(c.me);return sent;
  }
  private sendStation(c:Client){
    if(c.stationContract==='station-live/2'&&this.stationV2)this.send(c,{t:'station-v2',view:this.stationV2.view()});
    else if(c.stationContract==='station-live/1'&&this.station)this.send(c,{t:'station',view:this.station.view()});
  }

  /** columns/1 JSON of a snapshot's entity table (the last one kept: every join of the same world state packs once). */
  private lastColumns:{json:string;packed:string}|null=null;
  private columnsOf(entities:unknown,json=JSON.stringify(entities)):string{
    if(this.lastColumns?.json===json)return this.lastColumns.packed;
    const p=packColumnsV1(entities,joinTableOrderV1),packed=p?JSON.stringify(p):json;this.lastColumns={json,packed};return packed;
  }
  private send(c: Client, m: ServerMsg, takeStrings?:Map<ServerMsg,Record<string,string>>) {
    if(!this.host.clockAvailable){c.ready=false;c.ws.close(1013,'world unavailable');return;}
    if (c.ws.readyState !== 1) return false;
    // slow clients lose messages while over 1 MB is queued, but never their own join set nor the first take after it
    if (c.ws.bufferedAmount > MAX_BUFFERED&&!c.joinSend&&!(m.t==='takes'&&c.awaitingTakes)){if(m.t==='me'||m.t==='welcome'&&m.privateMe){c.ready=false;c.ws.close(1013,'private view backpressure');}return false;}
    const current=this.privateMessage(c,m);if(!current)return false;
    // All existing public/private recipient projection runs before packing.
    let s:string,nextTable:number|null|undefined,nextTake:number|null|undefined;
    try{
      const mode=current.t==='takes'&&c.takeTransport?'wire':'raw';
      // take-chunk-ref/1 first leaves out what repeats the peer's last take; the other transports then pack what is left
      const chunks=current.t==='takes'&&c.takeChunks?this.takeChunks.encode(current,c.takeChunks.last):null;
      const stream=(chunks?chunks.stream:current) as ServerMsg;
      const entities=stream.t==='takes'&&c.takeEntities?this.takeEntities.encode(stream,c.takeEntities.last):null;
      const key=(entities?`${mode}|${c.takeEntities!.last}`:mode)+(chunks?`|c${c.takeChunks!.last}`:''),cached=takeStrings?.get(current)??{};
      const inner=(v:unknown)=>mode==='wire'?stringifyTakeBoundaryWireV1(v):JSON.stringify(v);
      // take-entities-join/1: the snapshot names its entity table, which becomes this peer's last table (its next take's
      // table then travels as a reference or a patch against it)
      const joined=current.t==='snapshot'&&c.takeEntities?.join?this.takeEntities.register(current.entities):null;
      if(joined)nextTable=joined.id;
      s=cached[key]??(()=>{
        if(joined||current.t==='snapshot'&&c.snapshotColumns){const {entities,...rest}=current as Extract<ServerMsg,{t:'snapshot'}>;return JSON.stringify(joined?{...rest,entitiesTable:joined.id}:rest).slice(0,-1)+',"entities":'+(c.snapshotColumns?this.columnsOf(entities,joined?.json):joined!.json)+'}';}
        const packed=entities?JSON.stringify({t:'take-entities',contract:TAKE_ENTITIES_WIRE_V1,ids:entities.envelope.ids}).slice(0,-1)+',"payload":'+inner(entities.envelope.payload)+'}':inner(stream);
        return chunks?JSON.stringify({t:'take-chunks',contract:TAKE_CHUNKS_WIRE_V1,ids:chunks.ids,same:chunks.same}).slice(0,-1)+',"payload":'+packed+'}':packed;
      })();
      if(takeStrings){cached[key]=s;takeStrings.set(current,cached);}
      if(entities)nextTable=entities.last;
      if(chunks)nextTake=chunks.last;
    }catch{
      // A broken fact must not become a different raw message or stop the host.
      c.ready=false;c.ws.send(JSON.stringify({t:'error',code:'takes.transport-invalid',message:'The take transport cannot be encoded exactly.'}));c.ws.close(1011,'invalid take transport');return false;
    }
    s=this.kernelWire(c,current,s);
    c.sent += s.length; this.wire.sent += s.length;
    if(c.joinSend){c.joinPending=(c.joinPending??0)+1;c.ws.send(s,()=>{c.joinPending=(c.joinPending??1)-1;});}else c.ws.send(s);
    if(nextTable!==undefined&&c.takeEntities)c.takeEntities.last=nextTable;
    if(nextTake!==undefined&&c.takeChunks)c.takeChunks.last=nextTake;
    if(current.t==='takes'&&current.chunks.length)c.awaitingTakes=false;
    return true;
  }
  /** No new private lifecycle fields are added to WS. Me retains its existing
   * shape but only usable identities; canonical public bodies/takes stay intact. */
  private currentMe(userId:string):Me|null{
    const user=this.db.user(userId);if(!user)return null;
    const me=this.auth.me(user),souls=this.lifecycleSouls;if(!souls)return me;
    return {...me,souls:souls.invited(user)?souls.ownedRows(user.id).filter(row=>row.world_id===this.host.worldId&&souls.controlReady(row)).map(row=>row.id):[]};
  }
  private privateViewFailed(c:Client,error:unknown){
    // Preserve corrupt evidence for operator reconciliation. Neither an old Me
    // nor a normal arrival refusal may stand in for failed authority verification.
    c.me=null;c.ready=false;
    console.error('[hub] private view invariant failed',error);
    this.send(c,{t:'error',code:'private-view-unavailable',message:'Private view unavailable; reconnect after operator repair.'});
    c.ws.close(1011,'private view unavailable');
  }
  private refreshAuthority(c:Client,publish=true):boolean{
    if(c.ready&&c.meScope&&(c.meScope.worldId!==this.host.worldId||c.meScope.epoch!==this.epoch)){
      c.ready=false;c.me=null;c.authUserId=null;this.send(c,{t:'error',code:'private-scope-differs',message:'Reconnect for current world authority.'});c.ws.close(1012,'private scope changed');return false;
    }
    const subject=c.authUserId===undefined?c.me?.userId:c.authUserId;
    if(this.lifecycleSouls&&subject){
      try{c.me=this.currentMe(subject);
        if(publish&&c.ready&&c.meScope&&c.publishedMe!==JSON.stringify(c.me)){
          const view=meLiveViewV1Schema.parse({...c.meScope,worldId:this.host.worldId,epoch:this.epoch,revision:c.meScope.revision+1,me:c.me});
          if(!this.send(c,{t:'me',view}))return false;c.meScope.revision=view.revision;c.publishedMe=JSON.stringify(c.me);
        }
        // A deleted identity may keep watching public motion. Its old accepted
        // subject must not silently revive if a row reappears; fresh hello only.
        if(c.ready&&c.me===null)c.authUserId=null;
      }
      catch(error){this.privateViewFailed(c,error);return false;}
    }
    return true;
  }
  /** Some client's join set is still being compressed or written, within JOIN_HOLD_MS of its hello (lane P5). One hold lasts
   *  at most JOIN_HOLD_MS and is followed by JOIN_HOLD_REST_MS without any, so slow or staggered joiners cannot stall the world. */
  private holdSince=0;private holdRestUntil=0;
  private joinInFlight(){
    const now=Date.now();
    if(now<this.holdRestUntil)return false;
    let pending=false;
    for(const c of this.clients)if(c.joinPending&&now-c.lastHello<JOIN_HOLD_MS&&c.ws.readyState===1){pending=true;break;}
    if(!pending){this.holdSince=0;return false;}
    if(!this.holdSince)this.holdSince=now;
    if(now-this.holdSince<JOIN_HOLD_MS)return true;
    this.holdSince=0;this.holdRestUntil=now+JOIN_HOLD_REST_MS;return false;
  }
  private privateMessage(c:Client,m:ServerMsg):ServerMsg|null{
    if(m.t==='me'){
      const s=c.meScope,v=m.view;if(!this.lifecycleSouls||!c.ready||!s||s.worldId!==this.host.worldId||s.epoch!==this.epoch||c.authUserId!==s.userId||v.worldId!==s.worldId||v.epoch!==s.epoch||v.connectionId!==s.connectionId||v.userId!==s.userId||v.revision!==s.revision+1)return null;
      c.me=s.userId?this.currentMe(s.userId):null;return {t:'me',view:meLiveViewV1Schema.parse({...v,me:c.me})};
    }
    if(!this.lifecycleSouls)return m;
    if(m.t==='welcome'){if(!this.refreshAuthority(c,false))return null;return {...m,you:c.me};}
    if(m.t==='stats'){if(!this.refreshAuthority(c))return null;return c.me?.role==='admin'?m:{...m,stats:publicStats(m.stats)};}
    if(m.t==='brain'){
      if(!this.refreshAuthority(c)||!c.me)return null;
      const calls=m.calls.filter(call=>c.me!.role==='admin'||(!!call.soulId&&c.me!.souls.includes(call.soulId)));
      return calls.length?{t:'brain',calls}:null;
    }
    return m;
  }
  /** Standing public state a viewer needs on join (e.g. the edge fade roster); public messages only. */
  readonly joinMessages: (() => unknown[])[] = [];
  broadcast(m: ServerMsg, filter?: (c: Client) => boolean) {
    if(m.t==='me')throw new Error('Private Me must be published directly to its bound connection');
    if(m.t==='takes'){
      // Cache only serialized strings for this broadcast, after each recipient's
      // public/private projection. No mutable fact survives across messages.
      const strings=new Map<ServerMsg,Record<string,string>>();
      for(const c of this.clients){if(!c.ready||c.ws.readyState!==1||filter&&!filter(c))continue;this.hold(c.ws);this.send(c,m,strings);}
      return;
    }
    if(this.lifecycleSouls&&(m.t==='brain'||m.t==='stats')){
      for(const c of this.clients){
        if(!c.ready||c.ws.readyState!==1)continue;
        if(!this.refreshAuthority(c)||filter&&!filter(c))continue;this.hold(c.ws);this.send(c,m);
      }
      return;
    }
    const s = JSON.stringify(m),rest=m.t==='kernel'?kernelRestV1(m.view):undefined;
    // a batch is never dropped for backpressure (lane W1, research D6): a missing one is a seq gap, and the gap costs the
    // viewer a whole new snapshot (1.4 MB for Eden 2026); right after a join the join set alone is over 1 MB queued
    for (const c of this.clients) { if (!c.ready || c.ws.readyState !== 1 || (filter && !filter(c))) continue; if (c.ws.bufferedAmount > MAX_BUFFERED && m.t !== 'batch') continue;
      const out=this.kernelWire(c,m,s,rest);c.sent += out.length; this.wire.sent += out.length; this.hold(c.ws); c.ws.send(out); }
  }
  /** srv-hub-physics: a tick's broadcasts reach each viewer as one socket write. The first broadcast frame a socket gets in
   *  this turn of the event loop corks it; the turn's end (process.nextTick, after the tick's synchronous work) uncorks
   *  every held socket, which flushes its frames in one writev (was one write per frame per viewer: N×K for a burst of K
   *  messages). The frames, their bytes and their order are unchanged; ws's own per-frame cork nests inside this one. */
  private held = new Set<import('node:stream').Duplex>();
  private hold(ws: WebSocket) {
    const sock = (ws as unknown as {_socket?: import('node:stream').Duplex})._socket;
    if (!sock || this.held.has(sock) || sock.destroyed) return;
    sock.cork(); this.held.add(sock);
    if (this.held.size === 1) process.nextTick(this.release);
  }
  private release = () => { for (const sock of this.held) sock.uncork(); this.held.clear(); };
  /** take-chunk-ref/1 peers: a kernel view that differs from the last one this socket was sent only in its tick (the hub
   *  re-broadcasts it every 200 ticks: old Eden ~208 KB each) travels as {t:'kernel-tick',tick}. Call only right before
   *  ws.send(result): it records what the peer now has. */
  private kernelWire(c:Client,m:ServerMsg,s:string,rest?:string|null):string{
    if(m.t!=='kernel'||!c.takeChunks)return s;
    const r=rest===undefined?kernelRestV1(m.view):rest;
    if(r!==null&&r===c.takeChunks.kernel)return JSON.stringify({t:'kernel-tick',tick:m.view.tick});
    c.takeChunks.kernel=r??undefined;return s;
  }
  /** Model calls go to admins, and to the owner of the Soul a call is about. World-level calls (narrator, director) are admin only. */
  brainCall(call: BrainCall) { this.broadcast({ t: 'brain', calls: [call] }, (c) => !!c.me && (c.me.role === 'admin' || (!!call.soulId && c.me.souls.includes(call.soulId)))); }
  refreshMe(userId: string) { for (const c of this.clients) if ((c.authUserId===undefined?c.me?.userId:c.authUserId) === userId) { if(this.lifecycleSouls)this.refreshAuthority(c);else{const u = this.db.user(userId); if (u) c.me = this.auth.me(u);} } }

  /** A world's stop (lane MEM3): every viewer gets a 1001 close, and any upgraded socket (viewer or edge event stream) still
   *  open graceMs later is cut. A peer that never answers the close (a frozen or background tab, a phone asleep or off the
   *  network, a dead path behind the proxy) otherwise held server.close() and wss.close() for ws's 30 s close timeout, past
   *  the launcher's 10 s SIGKILL: no stop snapshot, a 10 s handover pause (legacy /w/eden at 3.53 and 3.57). Resolves when
   *  every socket is closed. */
  closeClients(reason: string, graceMs = CLOSE_GRACE_MS): Promise<void> {
    for (const ws of this.wss.clients) ws.close(1001, reason);
    const open = [...this.upgraded].filter((s) => !s.destroyed);
    if (!open.length) return Promise.resolve();
    return new Promise((done) => {
      let left = open.length;
      const cut = setTimeout(() => { for (const s of open) s.destroy(); }, graceMs);
      for (const s of open) s.once('close', () => { if (--left === 0) { clearTimeout(cut); done(); } });
    });
  }

  /** Lag-aware heartbeat (srv-load, audit #5): a stall of the main thread delays both this timer and the reading of
   *  the pongs that arrived meanwhile (timers run before the poll phase). So the verdict waits for the poll phase
   *  (setImmediate), and a sweep that itself ran late by more than 5 s judges nobody: a slow world never cuts its
   *  viewers, which would then all reconnect (and re-download the world) at once. */
  private sweepAt = Date.now();
  /** How late the last sweep ran (ms): also stretches the hello deadline. */
  stallMs = 0;
  private sweep() {
    const now = Date.now(); this.stallMs = Math.max(0, now - this.sweepAt - SWEEP_MS); this.sweepAt = now;
    const judge = this.stallMs <= 5_000 && this.loadLevel !== 'black';
    setImmediate(() => {
      for (const c of this.clients) { if (!c.alive && judge) { c.ws.terminate(); this.clients.delete(c); continue; } c.alive = false; try { c.ws.ping(); } catch { /* closed */ } }
    });
  }
  /** Load dial (LOAD-CONTRACT §1, §3): viewers hear the level ({t:'load'}); at black new joins wait (see hello). */
  loadLevel: 'green' | 'amber' | 'red' | 'black' = 'green';
  setLoadLevel(level: 'green' | 'amber' | 'red' | 'black') {
    if (level === this.loadLevel) return;
    this.loadLevel = level; this.broadcast({t: 'load', level} as unknown as ServerMsg);
  }

  stats(): ServerStats {
    const h = this.host, ms = h.tickMs;
    return {
      tick: h.engine.world.tick, tickMsAvg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, tickMsMax: ms.length ? Math.max(...ms) : 0,
      clients: this.clients.size, entities: Object.keys(h.engine.world.entities).length, souls: h.minds.size, liveActions: h.engine.runtime.liveIds().length,
      seq: h.seq, logEvents: h.seq, lastSnapshotTick: h.lastSnapshotTick, snapshotMs: h.snapshotMs, build: this.build, dbBytes: this.db.bytes(), uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      brain: { mode: this.brain.mode, callsToday: this.brain.callsToday, costToday: this.brain.spentToday, budget: this.brain.budget, inflight: this.brain.inflight.size, jevMsAvg: this.brain.jevMsAvg },
    };
  }
  clientList() { return [...this.clients].map((c) => ({ user: c.me?.short ?? 'anon', role: c.me?.role ?? null, joinedAt: c.joinedAt, resyncs: c.resyncs, sentBytes: c.sent, buffered: c.ws.bufferedAmount })); }
}

/** The `hello` query parameter of a socket's upgrade URL (at most 2 KB), or null. */
export function urlHello(url: string | undefined): string | null {
  const q = url?.indexOf('?') ?? -1; if (!url || q < 0) return null;
  try { const h = new URLSearchParams(url.slice(q + 1)).get('hello'); return h && h.length <= 2048 ? h : null; } catch { return null; }
}
