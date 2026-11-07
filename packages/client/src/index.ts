// The client replica: a best-effort copy of the world built from a snapshot
// plus batches. Positions are computed locally from timed paths (the shared
// kinematics), so the server never streams per-tick poses. Each heartbeat
// carries the server's view hash; the replica recomputes its own at that tick
// and asks for a resync when they differ. Runs in browsers and in Node.
import type { Entity, Environment, PathCommit, PoseSample, Region } from '@souls/engine-contract';
import { isPackedColumnsV1, unpackColumnsV1, samplePath, viewHashOf, viewRow, PROTO,TAKE_BOUNDARY_WIRE_V1,hydrateTakeBoundaryWireV1,TAKE_ENTITIES_WIRE_V1,TAKE_ENTITIES_JOIN_V1,adoptSnapshotTableV1,hydrateTakeEntitiesV1,type TakeEntitiesStateV1,TAKE_CHUNKS_WIRE_V1,hydrateTakeChunksV1,hydrateKernelTickV1,type TakeChunksStateV1, stationLiveV1Schema,stationV2MessageSchema,acceptStationLiveProgressV2,stationHelloCapabilitiesV1Schema,stationLiveContractSchema,meLiveDescriptorV1Schema,meLiveViewV1Schema,meLiveMessageV1Schema,
  type StationLiveV2,type StationAnchorVariant,type StationLiveContract,type StationLiveV1, type KernelView, type PlayView, type TalkLine, type Batch, type BrainCall, type CameraLine, type ClientMsg, type Heartbeat, type LogEvent, type Me, type NarrativeView, type PublicSoul, type ServerMsg, type ServerStats, type Snapshot, type TickerLine } from '@souls/protocol';

import { helloMessage } from './hello.ts';
export { helloMessage, anonymousHello } from './hello.ts';

/** A socket opened before the Connection existed (the web page's entry script), with the hello it already sent (if
 *  open) and every message received since, in order. */
export type AdoptedSocket = { ws: WSLike; queue: unknown[]; hello: string; sent: boolean };

export class Replica {
  tick = 0;            // latest tick we have data through
  seq = -1;            // last batch seq applied
  entities: Record<string, Entity> = {};
  regions: Record<string, Region> = {};
  env: Environment | null = null;
  paths = new Map<string, PathCommit>();
  souls = new Map<string, PublicSoul>();
  ready = false;

  applySnapshot(s: Snapshot) {
    this.entities = s.entities; this.regions = s.regions; this.env = s.env; this.tick = s.tick; this.seq = s.seq;
    this.paths = new Map(s.paths.map((p) => [p.entity, p]));
    this.souls = new Map(s.souls.map((x) => [x.id, x]));
    this.ready = true;
  }

  /** Returns false if a batch was missed (gap in seq): the caller should resync. */
  applyBatch(b: Batch): boolean {
    if (!this.ready) return true;
    if (b.seq <= this.seq) return true;           // already have it (overlap after a snapshot)
    if (b.seq !== this.seq + 1) return false;      // gap
    for (const [tick, id, field, value] of b.changes) {
      if (id === '$env') { if (this.env && field === 'datetime') this.env = { ...this.env, datetime: value as string }; continue; }
      if (field === 'present') {
        if (value === null) { this.settle(id, tick); delete this.entities[id]; this.paths.delete(id); }
        else if (!this.entities[id]) this.entities[id] = structuredClone(value as Entity);
        continue;
      }
      const e = this.entities[id]; if (!e?.human) continue;
      if (field === 'body') {if(value===null)delete e.body;else e.body=structuredClone(value as Entity['body']);}
      else if (field === 'activity') e.human.activity = value as string;
      else if (field === 'on') { if (value === null) delete e.human.on; else e.human.on = value as string; }
      else if (field === 'task') { if (value === null) delete e.human.task; else e.human.task = value as string; }
    }
    for (const p of b.paths) { if (!this.entities[p.entity]) continue; this.settle(p.entity, p.startTick); this.paths.set(p.entity, p); }   // (a body removed in this batch has no path)
    for (const s of b.souls) this.souls.set(s.id, s);
    for (const id of b.removedSouls) this.souls.delete(id);
    this.seq = b.seq; this.tick = b.toTick;
    return true;
  }

  /** Bake the position reached on the old path into the entity before replacing the path. */
  private settle(id: string, tick: number) {
    const p = this.paths.get(id), e = this.entities[id];
    if (p && e) { const s = samplePath(p.waypoints, tick); e.pose.p = [s[1] / 1000, 0, s[3] / 1000]; e.pose.yaw = s[4] / 1000; }
  }

  /** Where an entity is at a tick: on its path if it has one, else where it last stood. */
  poseAt(id: string, tick: number): PoseSample {
    const e = this.entities[id], p = this.paths.get(id);
    if (p && tick >= p.waypoints[0][0]) return samplePath(p.waypoints, tick);
    return [tick, Math.round(e.pose.p[0] * 1000), 0, Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }

  viewHash(tick: number): string {
    return viewHashOf(Object.keys(this.entities).filter((id) => this.entities[id].kind === 'human').map((id) => viewRow(this.entities[id], this.poseAt(id, tick))));
  }

  /** Check a heartbeat. 'ok', 'mismatch' (resync needed) or 'pending' (we have not received that tick yet). */
  check(h: Heartbeat): 'ok' | 'mismatch' | 'pending' {
    if (!this.ready || this.seq < h.seq) return 'pending';
    if (this.seq > h.seq) return 'ok'; // already moved on; the next heartbeat will check
    return this.viewHash(h.tick) === h.viewHash ? 'ok' : 'mismatch';
  }
}

export type ConnState = 'connecting' | 'open' | 'closed';
export type ConnStats = { state: ConnState; resyncs: number; reconnects: number; heartbeats: number; lastCheck: string; lastHash: string; myHash: string; bytesIn: number; msgsIn: number; rttMs: number; lastHeartbeatTick: number; snapshots: number };
/** A local socket/welcome generation, distinct from the server process epoch. */
export type ConnectionSession = { generation:number;worldId:string;epoch:string|null };
export type TransportReceipt = { session:ConnectionSession;receivedAtMs:number };
export type ClockProbe = { session:ConnectionSession;n:number;sentAtMs:number;automatic:boolean };
export type PongReceipt = TransportReceipt & { sentAtMs:number;rttMs:number;automatic:boolean };
export type EdgeSpectatorMessage = {type:'edge';kind:string;tick:number;at:number}&Record<string,unknown>;
export type Handlers = {
  /** EDGE-CONTRACT-v1 §7 spectator messages (speech, conversations, objects, fading) — viewer only. */
  onEdge?(m: EdgeSpectatorMessage): void;
  /** Current private authority only; null scope clears old private generations. */
  onMe?(me:Me|null,scope:PrivateMeSession|null):void;
  /** null invalidates the previous station; no playback can rely on it. */
  onStation?(view:StationLiveV1|null,receipt:TransportReceipt|null):void;
  /** Explicitly negotiated V2 only; checkpoint receipt preserves clock session. */
  onStationV2?(view:StationLiveV2|null,receipt:TransportReceipt|null):void;
  /** Called before onWelcome, and with null on disconnect/replacement/close. */
  onSession?(session:ConnectionSession|null):void;
  /** Only a strictly valid reply to a current, unconsumed sent probe. */
  onPong?(pong:Extract<ServerMsg,{t:'pong'}>,receipt:PongReceipt):void;
  onTakes?(stream: Extract<ServerMsg, {t: 'takes'}>): void;
  onChange?(): void; onLog?(e: LogEvent[]): void; onBrain?(c: BrainCall[]): void; onCamera?(l: CameraLine): void; onTicker?(l: TickerLine[]): void;
  onNarrative?(v: NarrativeView): void; onStats?(s: ServerStats): void; onLoad?(level: 'green' | 'amber' | 'red' | 'black'): void; onKernel?(v: KernelView): void; onError?(code: string, message: string): void; onPlays?(p: PlayView[]): void; onTalk?(l: TalkLine[]): void; onWelcome?(me: Me | null, w: Extract<ServerMsg, { t: 'welcome' }>): void;
};
type WSLike = { send(s: string): void; close(): void; readyState: number; onopen: any; onmessage: any; onclose: any; onerror: any };
export type PrivateMeSession={generation:number;worldId:string;epoch:string;connectionId:string;userId:string|null;revision:number};

/** Connection with automatic reconnect (resuming from the last batch seq) and heartbeat-driven resync. */
export class Connection {
  replica = new Replica();
  stats: ConnStats = { state: 'connecting', resyncs: 0, reconnects: 0, heartbeats: 0, lastCheck: '-', lastHash: '', myHash: '', bytesIn: 0, msgsIn: 0, rttMs: 0, lastHeartbeatTick: 0, snapshots: 0 };
  welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;
  me:Me|null=null;
  private privateMeSession:PrivateMeSession|null=null;
  heartbeat: Heartbeat | null = null;
  /** Wall-clock anchor for smooth local tick estimation between batches. */
  anchor = { tick: 0, at: 0 };
  private ws: WSLike | null = null;
  private boot: AdoptedSocket | null = null;
  private closed = false;
  private retry = 0;
  private pendingHb: Heartbeat | null = null;
  private pingTimer: any = null;
  private reconnectTimer: any = null;
  /** The world's load level from its last `{t:'load'}` frame (null until one arrives). */
  load: 'green' | 'amber' | 'red' | 'black' | null = null;
  private lastMessageAt = 0;
  private resyncing = 0;
  /** The server process this replica was built from (batch numbers restart when the server does). */
  private epoch: string | null = null;
  private sessionSerial=0;
  private transport:ConnectionSession|null=null;
  private pendingPings=new Map<number,ClockProbe>();
  private lastMonotonicAt:number|null=null;
  private lastExplicitProbeN=-1;
  private automaticProbeN=0;
  station:StationLiveV1|null=null;
  stationV2:StationLiveV2|null=null;
  private lastStationAnchorV2:StationAnchorVariant|null=null;
  private stationOffer?:StationLiveContract[];
  stationContract:StationLiveContract|null=null;
  /** Same monotonic domain used for actual send and receive boundaries. */
  monotonicNow:()=>number;
  readonly takeBoundaryTransport:boolean;
  url: string; getToken: () => Promise<string | null>; handlers: Handlers; make: (url: string) => WSLike; now: () => number;

  constructor(url: string, getToken: () => Promise<string | null>, handlers: Handlers, make: (url: string) => WSLike, now: () => number = () => Date.now(), monotonicNow:()=>number=()=>performance.now(),stationCapabilities?:{stationContracts?:StationLiveContract[]},takeBoundaryTransport=false) {
    this.url = url; this.getToken = getToken; this.handlers = handlers; this.make = make; this.now = now;
    this.monotonicNow=monotonicNow;
    this.takeBoundaryTransport=takeBoundaryTransport;
    this.stationOffer=stationHelloCapabilitiesV1Schema.parse(stationCapabilities??{}).stationContracts?.slice();
  }

  get session():ConnectionSession|null {return this.transport?{...this.transport}:null;}
  get meSession():PrivateMeSession|null{return this.privateMeSession?{...this.privateMeSession}:null;}
  private clearPrivateMe(){
    const had=this.me!==null||this.privateMeSession!==null;this.me=null;this.privateMeSession=null;
    if(this.welcome)this.welcome={...this.welcome,you:null};if(had)this.handlers.onMe?.(null,null);
  }
  private invalidPrivateMe(){this.clearPrivateMe();this.handlers.onError?.('me.invalid','Private authority does not match the current connection.');try{this.ws?.close();}catch{/* reconnect needs fresh authority */}}
  private clearTransport() {
    this.clearPrivateMe();
    const hadSession=this.transport!==null,hadStation=this.station!==null,hadV2=this.stationV2!==null;
    this.transport=null;this.station=null;this.stationV2=null;this.lastStationAnchorV2=null;this.stationContract=null;
    this.pendingPings.clear();this.lastMonotonicAt=null;
    if(hadStation)this.handlers.onStation?.(null,null);
    if(hadV2)this.handlers.onStationV2?.(null,null);
    if(hadSession)this.handlers.onSession?.(null);
  }
  private monotonicSample(receivedAtMs?:number):number|null {
    const at=receivedAtMs??this.monotonicNow();
    if(!Number.isFinite(at)||at<0||this.lastMonotonicAt!==null&&at<this.lastMonotonicAt){
      this.clearTransport();this.handlers.onError?.('clock.invalid','The local monotonic clock is unavailable or regressed.');
      try{this.ws?.close();}catch{/* reconnect will request a fresh welcome */}return null;
    }
    this.lastMonotonicAt=at;return at;
  }
  /** Build a correlated ping at its actual monotonic send boundary. App's
   * clock.begin(at) can return this existing public ping; no second socket. */
  probe(build:(sentAtMs:number)=>Extract<ClientMsg,{t:'ping'}>):ClockProbe|null {
    if(!this.transport||!this.transport.epoch||this.stats.state!=='open'||this.ws?.readyState!==1)return null;
    const generation=this.transport.generation;
    const at=this.monotonicSample();if(at===null)return null;
    const message=build(at);if(this.transport?.generation!==generation)return null;
    return this.sendProbe(message,at,false);
  }
  private sendProbe(message:Extract<ClientMsg,{t:'ping'}>,at:number,automatic:boolean):ClockProbe|null {
    if(!this.transport||this.ws?.readyState!==1||!message||typeof message!=='object'||Object.keys(message).length!==2||message.t!=='ping'||!Number.isSafeInteger(message.n)
      ||(automatic?message.n>=0:message.n<0||message.n<=this.lastExplicitProbeN))return null;
    for(const [n,p] of this.pendingPings)if(at-p.sentAtMs>12000)this.pendingPings.delete(n);
    if(this.pendingPings.has(message.n)||this.pendingPings.size>=16)return null;
    if(!automatic)this.lastExplicitProbeN=message.n;
    const p={session:{...this.transport},n:message.n,sentAtMs:at,automatic};this.pendingPings.set(message.n,p);
    try{this.ws.send(JSON.stringify({t:'ping',n:message.n}));return structuredClone(p);}catch{this.pendingPings.delete(message.n);return null;}
  }

  /** Use this already-opened socket for the first connection (lane W1: the page opened it at entry). It is kept only
   *  if the hello it sent is exactly the one this Connection would send now (signed out, no replica); otherwise it is
   *  closed and a fresh socket says the right hello. */
  adopt(boot: AdoptedSocket) { this.boot = boot; }
  connect() {
    this.closed = false; this.open();
  }
  private open(anonymousReconnect = false) {
    if (this.closed) return;
    this.clearTransport();
    clearInterval(this.pingTimer);
    const replaced=this.ws;this.ws=null;try{replaced?.close();}catch{/* obsolete socket is already ignored */}
    clearTimeout(this.reconnectTimer);
    this.stats.state = 'connecting'; this.handlers.onChange?.();
    const boot=this.boot;this.boot=null;
    const adopted=!!boot&&boot.ws.readyState<=1;
    if(boot&&!adopted)try{boot.ws.close();}catch{/* already closed */}
    // A restarted anonymous viewer can say hello in the upgrade URL, as the entry socket already does.
    // Only a freshly resolved null token enables this path; signed-in credentials never enter a URL.
    const earlyHello=anonymousReconnect&&!adopted?JSON.stringify(helloMessage({
      ...(this.replica.ready&&this.epoch?{since:this.replica.seq,epoch:this.epoch}:{}),
      stationContracts:this.stationOffer,takeBoundaryTransport:this.takeBoundaryTransport})):null;
    const reconnectUrl=earlyHello?new URL(this.url):null;
    if(reconnectUrl)reconnectUrl.searchParams.set('hello',earlyHello!);
    const ws = (this.ws = adopted?boot!.ws:this.make(reconnectUrl?.href??this.url));
    let active=true;
    // the last entity table this socket received (take-entities-ref/1): a new socket starts empty, as does the server's view of it
    const takeEntities:TakeEntitiesStateV1={last:null};
    // the last take this socket received (take-chunk-ref/1): repeated parts of later takes are restored from it
    const takeChunks:TakeChunksStateV1={last:null};let lastKernelJson:string|null=null;
    const mine = () => active && this.ws === ws && !this.closed;      // a socket that has been replaced or closed must not touch the replica
    ws.onopen = async () => {
      if (!mine()) return;
      this.stats.state = 'open'; this.lastMessageAt = this.now(); this.resyncing = 0;
      const token = await this.getToken().catch(() => null);
      if (!mine() || ws.readyState !== 1) return;
      // resume only from the same server process: batch numbers start again after a restart
      const hello = JSON.stringify(helloMessage({ token, ...(this.replica.ready && this.epoch ? { since: this.replica.seq, epoch: this.epoch } : {}),
        stationContracts: this.stationOffer, takeBoundaryTransport: this.takeBoundaryTransport }));
      // an adopted socket that already said this hello goes on as it is; one that said another (a signed-in page) is
      // replaced at once (the server ignores a second hello within 3 s), resuming from what it already received
      // (compared without since/epoch: the entry socket spoke for a page with no replica yet; its queued snapshot, replayed
      // below before the token is known, must not make that look like a different hello)
      if (adopted && boot!.sent) { if (boot!.hello !== JSON.stringify(helloMessage({ token, stationContracts: this.stationOffer, takeBoundaryTransport: this.takeBoundaryTransport }))) { this.open(); return; } }
      else if(earlyHello){
        // Identity may have changed while the upgrade was queued behind a handover. Reopen with the
        // current token in a frame instead of trying a second hello the server would rate-limit.
        if(token){this.open();return;}
      }else ws.send(hello);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (!mine()) return;
        // the server speaks every two seconds; long silence means the socket is dead even if the browser has not noticed
        // P1 phones: until the join snapshot has arrived, one message can take far longer than 12 s on a slow link (1.4 MB
        // decoded for Eden 2026 on Slow 4G: ~16 s); closing then threw the join away and started it again
        if (this.now() - this.lastMessageAt > (this.replica.ready ? 12_000 : 60_000)) { try { ws.close(); } catch { /* already closed */ } return; }
        if (ws.readyState === 1) {const at=this.monotonicSample();if(at!==null)this.sendProbe({t:'ping',n:--this.automaticProbeN},at,true);}
      }, 5000);
      this.handlers.onChange?.();
    };
    ws.onmessage = (ev: { data: unknown }) => {
      if (!mine()) return;const receivedAtMs=this.monotonicNow(); const s = String(ev.data); this.stats.bytesIn += s.length; this.stats.msgsIn++; this.lastMessageAt = this.now();
      let m:ServerMsg;try{m=JSON.parse(s) as ServerMsg;}catch{this.handlers.onError?.('message.invalid','The server message is not valid JSON.');return;}
      if(m&&typeof m==='object'&&(m as {type?:unknown}).type==='edge'){this.handlers.onEdge?.(m as unknown as EdgeSpectatorMessage);return;}
      if(!m||typeof m!=='object'||typeof m.t!=='string')return;
      // LOAD-CONTRACT v1 §3: the hub's `{t:'load', level}` on change; a quiet hint, never an error.
      if((m as {t:string}).t==='load'){const level=(m as {level?:unknown}).level;if(level==='green'||level==='amber'||level==='red'||level==='black'){this.load=level;this.handlers.onLoad?.(level);}return;}
      try{
        // columns/1 (lane JOINSET): a snapshot's entity table in the column form is put back exactly before anything reads it
        if(m.t==='snapshot'&&isPackedColumnsV1((m as {entities?:unknown}).entities))(m as {entities:unknown}).entities=unpackColumnsV1((m as unknown as {entities:Parameters<typeof unpackColumnsV1>[0]}).entities);
        // take-chunks wraps whatever take-entities / take-boundary-wire / takes message the reduced stream became
        const t=(v:unknown)=>v&&typeof v==='object'?(v as {t?:unknown}).t:undefined;
        const boundary=(v:unknown)=>{if(t(v)!=='take-boundary-wire')return v;if(!this.takeBoundaryTransport||this.welcome?.takeTransport!==TAKE_BOUNDARY_WIRE_V1)throw new Error('unnegotiated take transport');return hydrateTakeBoundaryWireV1(v);};
        const entities=(v:unknown)=>{if(t(v)!=='take-entities')return boundary(v);if(!this.takeBoundaryTransport||this.welcome?.takeEntities!==TAKE_ENTITIES_WIRE_V1)throw new Error('unnegotiated take transport');return hydrateTakeEntitiesV1(v,takeEntities,boundary);};
        if((m as {t:string}).t==='take-chunks'){
          if(!this.takeBoundaryTransport||this.welcome?.takeChunks!==TAKE_CHUNKS_WIRE_V1)throw new Error('unnegotiated take transport');
          m=hydrateTakeChunksV1(m,takeChunks,entities) as ServerMsg;
        }else if((m as {t:string}).t==='kernel-tick'){
          if(!this.takeBoundaryTransport||this.welcome?.takeChunks!==TAKE_CHUNKS_WIRE_V1)throw new Error('unnegotiated take transport');
          m=hydrateKernelTickV1(m,lastKernelJson) as ServerMsg;
        }else if(m.t==='snapshot'&&Object.hasOwn(m,'entitiesTable')){
          // take-entities-join/1: this snapshot's entity table is now the socket's last table (the next take refers to it)
          if(!this.takeBoundaryTransport||this.welcome?.takeEntities!==TAKE_ENTITIES_WIRE_V1||this.welcome?.takeEntitiesJoin!==TAKE_ENTITIES_JOIN_V1)throw new Error('unnegotiated take transport');
          m=adoptSnapshotTableV1(m,takeEntities) as ServerMsg;
        }else{
          if(m.t==='kernel')lastKernelJson=s;
          m=entities(m) as ServerMsg;
        }
      }catch{this.handlers.onError?.('takes.transport-invalid','The take transport cannot be restored exactly.');try{ws.close();}catch{/* closing */}return;}
      this.onMessage(m,receivedAtMs);
    };
    ws.onclose = (ev?: { code?: number }) => {
      if (this.ws !== ws) return;
      active=false;this.clearTransport();
      clearInterval(this.pingTimer); this.stats.state = 'closed'; this.handlers.onChange?.();
      if (this.closed) return;
      this.stats.reconnects++;
      // exponential backoff with jitter, so a restart does not bring every client back on the same millisecond.
      // (`retry` is reset only once the server has actually welcomed us: a server that accepts and then closes must not be hammered.)
      // G9 (lane Z1): a welcomed socket the server closed because it is restarting (1001, a release handover) comes back
      // after 50-150 ms: the launcher holds the new upgrade until the world is up again, so waiting longer only adds to
      // the visible pause. Only the first try: a server that closes again before welcoming us gets the backoff above.
      const restarting = ev?.code === 1001 && this.retry === 0;
      // L6 (LOAD-CONTRACT v1 §3): jittered over the upper half of a window that doubles to a 30 s cap, so a world coming
      // back is not met by every page at once and a page never retries faster than the floor; 1013 (the hub is full or the
      // world is unavailable) waits at least 5 s.
      const window = Math.min(30_000, 500 * 2 ** this.retry), backoffMs = Math.max(ev?.code === 1013 ? 5_000 : 0, window * (0.5 + 0.5 * Math.random()));
      // Resolve anonymous status during the existing jitter, never delaying the reconnect for auth.
      // A slow/failed lookup uses the ordinary frame hello. Recheck identity again once the socket opens.
      let anonymous=false;
      try{void this.getToken().then(token=>{anonymous=token===null;},()=>{});}catch{/* ordinary frame hello */}
      this.reconnectTimer = setTimeout(() => this.open(anonymous), restarting ? 50 + 100 * Math.random() : backoffMs);
      this.retry++;
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
    if (adopted) {
      // what arrived before the Connection existed, in order; then the open handshake if it already happened
      if (ws.readyState === 1) void ws.onopen();
      for (const data of boot!.queue.splice(0)) { if (!mine()) break; ws.onmessage({ data }); }
    }
  }
  close() { this.closed = true;this.clearTransport(); clearInterval(this.pingTimer); clearTimeout(this.reconnectTimer); this.ws?.close(); }
  /** Re-send hello (for example after signing in or out) on the same socket. */
  rehello() { this.ws?.close(); }
  /** Ask for a full snapshot. One request at a time: every batch that arrives before the snapshot is another gap, not another reason to ask. */
  resync(reason: string) {
    if (this.resyncing && this.now() - this.resyncing < 5_000) return;
    this.resyncing = this.now(); this.stats.resyncs++;
    try { this.ws?.send(JSON.stringify({ t: 'resync', reason } satisfies ClientMsg)); } catch { /* socket closing; reconnect will resume */ }
  }
  /** Test hook: drop the socket without the caller asking, as a network failure would. */
  dropForTest() { this.ws?.close(); }

  private setAnchor(tick: number) { this.anchor = { tick, at: this.now() }; }
  /** Smooth estimate of the current world tick for display. */
  displayTick(): number {
    const w = this.welcome; if (!w) return this.replica.tick;
    const rate = (this.heartbeat?.paused ? 0 : (this.heartbeat?.clockRate ?? w.clockRate)) / (w.dt * 1000);
    return Math.min(this.replica.tick + 10, this.anchor.tick + (this.now() - this.anchor.at) * rate);
  }

  private onMessage(m: ServerMsg,receivedAtMs:number) {
    const r = this.replica, h = this.handlers;
    switch (m.t) {
      case 'welcome': {
        this.clearTransport();this.welcome = m; this.retry = 0; this.epoch = m.epoch ?? null;
        const selected=m.stationContract===undefined?((this.stationOffer??['station-live/1']).includes('station-live/1')?'station-live/1':null):m.stationContract;
        if(selected!==null&&(!stationLiveContractSchema.safeParse(selected).success||!(this.stationOffer??['station-live/1']).includes(selected)))
          h.onError?.('station.negotiation-invalid','The selected station contract was not offered.');
        else this.stationContract=selected;
        if(typeof m.worldId==='string'&&m.worldId&&(m.epoch===undefined||typeof m.epoch==='string'&&m.epoch.length>0)){
          this.transport={generation:++this.sessionSerial,worldId:m.worldId,epoch:m.epoch??null};
          h.onSession?.({...this.transport});
        }
        if(m.privateMe!==undefined){
          const desc=meLiveDescriptorV1Schema.safeParse(m.privateMe),initial=desc.success?meLiveViewV1Schema.safeParse({...desc.data,worldId:m.worldId,epoch:m.epoch,me:m.you}):null;
          if(!initial?.success||!this.transport){this.invalidPrivateMe();break;}
          this.privateMeSession={generation:this.transport.generation,worldId:initial.data.worldId,epoch:initial.data.epoch,connectionId:initial.data.connectionId,userId:initial.data.userId,revision:initial.data.revision};
          this.me=structuredClone(initial.data.me);
        }else this.me=m.you;
        h.onWelcome?.(this.me, m);break;
      }
      case 'me': {
        const parsed=meLiveMessageV1Schema.safeParse(m),s=this.privateMeSession,t=this.transport;
        if(!s||!t)break;
        if(!parsed.success){this.invalidPrivateMe();break;}
        const v=parsed.data.view;
        if(t.generation!==s.generation||v.worldId!==s.worldId||v.epoch!==s.epoch||v.connectionId!==s.connectionId||v.userId!==s.userId)break;
        if(v.revision<=s.revision)break;
        if(v.revision!==s.revision+1){this.invalidPrivateMe();break;}
        this.privateMeSession={...s,revision:v.revision};this.me=structuredClone(v.me);
        if(this.welcome)this.welcome={...this.welcome,you:structuredClone(v.me)};
        h.onMe?.(structuredClone(v.me),{...this.privateMeSession});break;
      }
      case 'snapshot': r.applySnapshot(m); this.stats.snapshots++; this.setAnchor(m.tick); this.pendingHb = null; this.resyncing = 0; break;
      case 'batch': {
        if (this.resyncing && this.now() - this.resyncing < 5_000) break;      // a snapshot is on its way
        if (!r.applyBatch(m)) { this.resync(`gap: have ${r.seq}, got ${m.seq}`); break; }
        this.setAnchor(m.toTick);
        if (m.log.length) h.onLog?.(m.log);
        if (this.pendingHb) this.verify(this.pendingHb);
        break;
      }
      case 'heartbeat': this.heartbeat = m; this.stats.heartbeats++; this.stats.lastHeartbeatTick = m.tick; this.verify(m); break;
      case 'log': h.onLog?.(m.events); break;
      case 'brain': h.onBrain?.(m.calls); break;
      case 'camera': h.onCamera?.(m.line); break;
      case 'ticker': h.onTicker?.(m.lines); break;
      case 'narrative': h.onNarrative?.(m.view); break;
      case 'stats': h.onStats?.(m.stats); break;
      case 'kernel': h.onKernel?.(m.view); break;
      case 'plays': h.onPlays?.(m.plays); break;
      case 'talk': h.onTalk?.(m.lines); break;
      case 'takes': h.onTakes?.(m); break;
      case 'station': {
        const view=stationLiveV1Schema.safeParse(m.view),session=this.transport;
        if(Object.keys(m).length!==2||!view.success||!session||this.stationContract!=='station-live/1'||view.data.worldId!==session.worldId){
          this.station=null;h.onStation?.(null,null);h.onError?.('station.invalid','The public station does not match the current world session.');break;
        }
        const at=this.monotonicSample(receivedAtMs);if(at===null)break;
        this.station=structuredClone(view.data);h.onStation?.(structuredClone(view.data),{session:{...session},receivedAtMs:at});break;
      }
      case 'station-v2': {
        const parsed=stationV2MessageSchema.safeParse(m),session=this.transport,w=this.welcome;
        let view:StationLiveV2;
        try{
          if(!parsed.success||!session||!w||this.stationContract!=='station-live/2')throw new Error('unnegotiated or malformed station');
          view=acceptStationLiveProgressV2(this.stationV2,parsed.data.view,
            {worldId:session.worldId,rulesVersion:w.rulesVersion,dtSeconds:w.dt},this.lastStationAnchorV2);
        }catch{
          // Socket close is asynchronous. Invalidate now so queued messages
          // cannot restore a phase or consume a probe before its close event.
          this.stationV2=null;this.clearTransport();h.onStationV2?.(null,null);
          h.onError?.('station-v2.invalid','The station does not match its negotiated world or recorded progression.');
          try{this.ws?.close();}catch{/* fresh welcome required for a skipped or invalid era */}
          break;
        }
        const at=this.monotonicSample(receivedAtMs);if(at===null)break;
        this.stationV2=structuredClone(view);if(view.anchor)this.lastStationAnchorV2=structuredClone(view.anchor);
        h.onStationV2?.(structuredClone(view),{session:{...session!},receivedAtMs:at});
        break;
      }
      case 'pong': {
        if(Object.keys(m).length!==3||!Number.isSafeInteger(m.n)||!Number.isSafeInteger(m.serverTime)||m.serverTime<0)break;
        const p=this.pendingPings.get(m.n),session=this.transport;if(!p||!session||p.session.generation!==session.generation)break;
        const at=this.monotonicSample(receivedAtMs);if(at===null)break;this.pendingPings.delete(m.n);
        const rttMs=at-p.sentAtMs;if(rttMs<0||rttMs>12000)break;
        this.stats.rttMs=rttMs;h.onPong?.({...m},{session:{...session},receivedAtMs:at,sentAtMs:p.sentAtMs,rttMs,automatic:p.automatic});break;
      }
      case 'error': console.warn('[sim] server error', m.code, m.message); h.onError?.(m.code, m.message); break;
    }
    h.onChange?.();
  }

  private verify(hb: Heartbeat) {
    const res = this.replica.check(hb);
    this.stats.lastCheck = res; this.stats.lastHash = hb.viewHash;
    if (res === 'pending') { this.pendingHb = hb; return; }
    this.pendingHb = null;
    this.stats.myHash = this.replica.seq === hb.seq ? this.replica.viewHash(hb.tick) : '(moved on)';
    if (res === 'mismatch') this.resync(`view hash mismatch at tick ${hb.tick}`);
  }
}
