// EVENTS-v1: push delivery of a Soul's stream (SSE + WebSocket), resumable by the same cursor as `wait`,
// filtered server-side by kind and salience, plus the reconnect digest, world.notice and the event kinds the
// stream did not have yet (approach, light.changed, world.join/leave, follow.stop). Mounted by edge/routes.ts.
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import type {Context, Hono} from 'hono';
import {streamSSE} from 'hono/streaming';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {WebSocketServer, type WebSocket} from 'ws';
import {clockAt} from '@souls/brain';
import {EDGE_CONTRACT, EdgeError, edgeBody, type EdgeDeps, type EdgeSoul, edgeErrorOf} from '../contract.ts';
import type {CommsRuntime} from '../comms/index.ts';
import {cursorOf, parseCursor, type StreamEvent} from '../comms/stream.ts';
import {oneLine, parseFilter, passes, relativeBearing, toEnvelope, type Envelope, type Filter} from './envelope.ts';
import {buildDigest} from './digest.ts';
import {activityObserver} from './activity-observation.ts';

export const HEARTBEAT_MS = 15_000;
export const MAX_STREAMS_PER_SOUL = 3;
export const APPROACH_M = 3, APART_M = 6, APPROACH_COOLDOWN_MS = 5 * 60_000;

export type EventsOptions = {
  /** Heartbeat period for SSE/WS (tests shorten it). */
  heartbeatMs?: number;
  /** Deliver a `world.notice` (level restart) to every live Soul once at start (env EDGE_BOOT_NOTICE=1). */
  bootNotice?: string | null;
  /** Place id → name (the Ledger's place index). */
  placeName?: (id: string) => string | null;
  /** Called with the active plan summary for digests (plans module). */
  planSummary?: (soulId: string) => unknown;
};

type Conn = {soulId: string; since: number; close(reason: string): void};
const timeLabel = (phase: number) => phase < .2 ? 'morning' : phase < .45 ? 'day' : phase < .55 ? 'evening' : phase < .75 ? 'dusk' : 'night';
const LIGHT_TEXT: Record<string, string> = {morning: 'Morning light comes up.', day: 'It is full day now.', evening: 'Evening comes on.', dusk: 'Dusk falls.', night: 'Night falls.'};

export type EventsRuntime = {
  /** Envelope of one stored event for its own Soul. */
  envelope(soulId: string, e: StreamEvent): Envelope;
  /** Deliver a steward notice (also the boot notice). Returns how many Souls got it. */
  notice(input: {text: string; level?: string; salience?: number; to?: string[]}): number;
  /** WebSocket upgrade handler for /v1/edge/events/ws (the Hub forwards non-/ws upgrades here). */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  connections(soulId: string): number;
  /** Proximity / light sweep (the world clock drives it every second; tests may call it). */
  sweep(tick: number): void;
  close(): void;
};

export function registerEdgeEvents(app: Hono, deps: EdgeDeps, comms: CommsRuntime, options: EventsOptions = {}): EventsRuntime {
  const {streams, core} = comms, ledger = deps.ledger, heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const placeName = (id: string | null | undefined) => (id && options.placeName?.(id)) || null;
  const name = (soulId: string) => core.nameOf(soulId);
  const viewer = (soulId: string) => ({soulId, name: name(soulId)});
  const clock = (): string | null => {
    try {
      const day = deps.host.living; if (!day) return null;
      const c = clockAt(core.tick(), day.origin, day.dayTicks);
      return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    } catch { return null; }
  };
  const placeOf = (soulId: string) => { try { const p = ledger.placePathOf(soulId).find(x => x.kind !== 'occupier') ?? ledger.placePathOf(soulId)[0]; return p ? {id: p.id, name: p.name} : null; } catch { return null; } };
  const receiptPlan = (receiptId: string): {id: string; step: number} | null => {
    try {
      const r = core.db.prepare('SELECT client_ref FROM edge_receipts_v1 WHERE world_id = ? AND receipt_id = ?').get(core.worldId, receiptId) as {client_ref: string | null} | undefined;
      const m = /^pl:(pl_[A-Za-z0-9_-]+):(\d+):\d+$/.exec(r?.client_ref ?? '');
      return m ? {id: m[1]!, step: Number(m[2])} : null;
    } catch { return null; }
  };

  // ---- delivery-time enrichment: clock, where (relative to the receiving Soul), plan tag on plan-driven receipts
  streams.enrich = (soulId, kind, body) => {
    const extra: Record<string, unknown> = {};
    const c = clock(); if (c) extra.clock = c;
    const b = body as Record<string, any>;
    const aboutId: string | undefined = b.from?.soulId ?? b.soul?.soulId ?? b.turn?.from?.soulId ?? b.invite?.from?.soulId;
    if (body.where === undefined) {
      const where: Record<string, unknown> = {};
      if (kind === 'arrive' && Array.isArray(b.placePath) && b.placePath[0]) where.place = b.placePath[0];
      if (typeof b.placeId === 'string') { where.placeId = b.placeId; const n = placeName(b.placeId); if (n) where.place = n; }
      if (aboutId && aboutId !== soulId) {
        if (!where.place) { const p = placeOf(aboutId); if (p) { where.placeId = p.id; where.place = p.name; } }
        const me = ledger.poseOf?.(soulId), them = ledger.poseOf?.(aboutId);
        if (me && them) { const dx = them.x - me.x, dz = them.z - me.z; where.dist = Math.round(Math.hypot(dx, dz) * 10) / 10; where.bearing = relativeBearing(me.yaw, dx, dz); }
      } else if (!where.place && (kind === 'receipt' || kind === 'arrive' || kind.startsWith('plan.') || kind === 'fade')) { const p = placeOf(soulId); if (p) { where.placeId = p.id; where.place = p.name; } }
      if (Object.keys(where).length) extra.where = where;
    }
    if ((kind === 'receipt' || kind === 'arrive') && typeof b.receipt?.id === 'string' && b.plan === undefined) { const plan = receiptPlan(b.receipt.id); if (plan) extra.plan = plan; }
    return extra;
  };
  const envelope = (soulId: string, e: StreamEvent) => toEnvelope(e, viewer(soulId));

  // ---- connection registry (per-Soul cap; the newest connection wins, the oldest is told why and closed)
  const conns = new Map<string, Set<Conn>>();
  const admit = (conn: Conn) => {
    let set = conns.get(conn.soulId); if (!set) { set = new Set(); conns.set(conn.soulId, set); }
    set.add(conn);
    while (set.size > MAX_STREAMS_PER_SOUL) { const oldest = [...set].sort((a, b) => a.since - b.since)[0]!; set.delete(oldest); oldest.close(`more than ${MAX_STREAMS_PER_SOUL} event streams for this Soul; the oldest closes`); }
  };
  const release = (conn: Conn) => {
    const set = conns.get(conn.soulId);
    if (set) { set.delete(conn); if (!set.size) conns.delete(conn.soulId); }
  };

  const failure = (c: Context, error: unknown) => {
    if (error instanceof EdgeError) return c.json(edgeBody({error: edgeErrorOf(error)}), error.status as ContentfulStatusCode);
    console.error('[edge] events fault', c.req.method, c.req.path, error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error));
    return c.json(edgeBody({error: {code: 'unavailable', message: 'the world could not answer; retry'}}), 503);
  };
  const limit = (soulId: string, key: string, n: number) => {
    const r = (deps.souls as {limits?: {allow(k: string, n: number, ms: number): {ok: boolean}}}).limits?.allow(`edge-${key}:${soulId}`, n, 60_000);
    if (r && !r.ok) throw new EdgeError(429, 'rate-limited', 'too many requests; slow down');
  };
  /** Start position: an explicit cursor (Last-Event-ID, cursor= or after=) or now. */
  const startOf = (soulId: string, raw: string | undefined | null): number => {
    const p = parseCursor(raw);
    if (p === undefined) throw new EdgeError(400, 'invalid', 'cursor must be a cursor from observe, wait or a previous event id');
    return p === null ? streams.head(soulId) : p;
  };

  /** One reader loop shared by SSE and WS: page from the durable stream by cursor, filter, send; wait for growth or heartbeat. */
  async function pump(soulId: string, start: number, getFilter: () => Filter, raw: boolean, out: {event(env: Envelope | StreamEvent, id: string): Promise<void>; cursor(c: string): Promise<void>; gap(oldest: string): Promise<void>; idle(): Promise<void>}, signal: AbortSignal) {
    let pos = start, sent = start;
    while (!signal.aborted) {
      const page = streams.read(soulId, pos, 200);
      if (page.gap) {
        const floor = streams.floor(soulId), head = streams.head(soulId);
        if (pos > head) { pos = head; sent = head; continue; }      // a cursor from the future: resume at the head
        await out.gap(cursorOf(floor)); pos = floor; sent = floor; continue;
      }
      for (const e of page.events) {
        const seq = Number(e.id.slice(2));
        const env = envelope(soulId, e);
        if (passes(env, getFilter())) { await out.event(raw ? e : env, e.id); sent = seq; }
        pos = seq;
        if (signal.aborted) return;
      }
      if (page.events.length >= 200) continue;
      const before = streams.head(soulId);
      // Delivery may append while an awaited send drains. Read that backlog
      // before waiting for future growth; its wake-up has already happened.
      if (before > pos) continue;
      await streams.waitForEvent(soulId, heartbeatMs, signal);
      if (signal.aborted) return;
      if (streams.head(soulId) === before) { if (pos > sent) { await out.cursor(cursorOf(pos)); sent = pos; } else await out.idle(); }
    }
  }

  // ---- SSE: GET /v1/edge/events (text/event-stream)
  app.get('/v1/edge/events', async c => {
    let soul: EdgeSoul, start: number;
    const q = (n: string) => c.req.query(n);
    try {
      soul = deps.soul(c); limit(soul.soulId, 'events', 30);
      start = startOf(soul.soulId, c.req.header('last-event-id') ?? q('cursor') ?? q('after'));
    } catch (error) { return failure(c, error); }
    const filter = parseFilter(q), raw = q('format') === 'raw', pad = q('pad') !== '0';
    c.header('Cache-Control', 'no-cache, no-transform'); c.header('X-Accel-Buffering', 'no');
    const response = streamSSE(c, async stream => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      c.req.raw.signal?.addEventListener('abort', () => ac.abort(), {once: true});
      const conn: Conn = {soulId: soul.soulId, since: Date.now(), close: reason => { void stream.writeSSE({event: 'bye', data: JSON.stringify({reason})}).catch(() => {}).finally(() => { ac.abort(); stream.abort(); }); }};
      admit(conn);
      try {
        // a padding comment defeats proxy buffering (tunnels) so the first events arrive at once
        if (pad) await stream.write(`: ${' '.repeat(2048)}\n\n`);
        await stream.writeSSE({event: 'hello', retry: 3000, data: JSON.stringify({contract: EDGE_CONTRACT, soulId: soul.soulId, cursor: cursorOf(start), head: streams.headCursor(soul.soulId), filter, format: raw ? 'raw' : 'envelope', heartbeatSeconds: Math.round(heartbeatMs / 1000), digest: `/v1/edge/events/digest?since=${cursorOf(start)}`})});
        await pump(soul.soulId, start, () => filter, raw, {
          event: (env, id) => stream.writeSSE({id, event: raw ? (env as StreamEvent).kind : (env as Envelope).kind, data: JSON.stringify(env)}),
          cursor: cur => stream.writeSSE({id: cur, event: 'cursor', data: JSON.stringify({cursor: cur, tick: core.tick()})}),
          gap: oldest => stream.writeSSE({id: oldest, event: 'gap', data: JSON.stringify({gap: true, oldest, digest: `/v1/edge/events/digest?since=${oldest}`, note: 'events before this were pruned; read the digest'})}),
          idle: async () => { await stream.write(`: keepalive ${core.tick()}\n\n`); },
        }, ac.signal);
      } catch { /* the client went away */ }
      finally { release(conn); }
    });
    // Hono's streamSSE assigns Cache-Control: no-cache after c.header above.
    // Preserve the transport directive on the actual outgoing response.
    response.headers.set('Cache-Control', 'no-cache, no-transform');
    return response;
  });

  // ---- WebSocket: /v1/edge/events/ws (auth: Authorization header, or a first message {"type":"auth","token"} within 5 s)
  const wss = new WebSocketServer({noServer: true, maxPayload: 16 * 1024});
  const soulFromToken = (token: string | undefined): EdgeSoul => deps.soul({req: {header: (n: string) => n.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : undefined, query: () => undefined}} as unknown as Context);
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== '/v1/edge/events/ws') return false;
    wss.handleUpgrade(req, socket, head, ws => { void serveWs(ws, req, url); });
    return true;
  }
  async function serveWs(ws: WebSocket, req: IncomingMessage, url: URL) {
    const send = (m: object) => new Promise<void>(res => { if (ws.readyState !== ws.OPEN) return res(); ws.send(JSON.stringify(m), () => res()); });
    const header = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || undefined;
    let filter = parseFilter(n => url.searchParams.get(n) ?? undefined);
    const raw = url.searchParams.get('format') === 'raw';
    const firstMessage = new Promise<Record<string, unknown> | null>(res => {
      const t = setTimeout(() => res(null), 5000);
      ws.once('message', d => { clearTimeout(t); try { res(JSON.parse(String(d))); } catch { res(null); } });
      ws.once('close', () => { clearTimeout(t); res(null); });
    });
    let soul: EdgeSoul, start: number;
    try {
      const token = header ?? (await firstMessage.then(m => m?.type === 'auth' && typeof m.token === 'string' ? m.token : undefined));
      soul = soulFromToken(token); limit(soul.soulId, 'events', 30);
      start = startOf(soul.soulId, url.searchParams.get('cursor') ?? url.searchParams.get('after'));
    } catch (error) {
      const e = error instanceof EdgeError ? error : new EdgeError(503, 'unavailable', 'the world could not answer; retry');
      await send({type: 'error', contract: EDGE_CONTRACT, error: edgeErrorOf(e)}); ws.close(e.status === 401 ? 4401 : e.status === 429 ? 4429 : 4400, e.code); return;
    }
    const ac = new AbortController();
    let alive = true;
    const conn: Conn = {soulId: soul.soulId, since: Date.now(), close: reason => { void send({type: 'bye', reason}).finally(() => { ac.abort(); ws.close(4000, 'replaced'); }); }};
    admit(conn);
    const ping = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; try { ws.ping(); } catch { /* closed */ } }, heartbeatMs * 2); ping.unref?.();
    ws.on('pong', () => { alive = true; });
    ws.on('message', d => {
      try {
        const m = JSON.parse(String(d)) as Record<string, unknown>;
        if (m.type === 'filter') filter = parseFilter(n => { const v = n === 'kinds' && Array.isArray(m.kinds) ? (m.kinds as unknown[]).join(',') : m[n]; return v === undefined || v === null ? undefined : String(v); });
      } catch { /* ignore junk */ }
    });
    ws.on('close', () => ac.abort());
    try {
      await send({type: 'hello', contract: EDGE_CONTRACT, soulId: soul.soulId, cursor: cursorOf(start), head: streams.headCursor(soul.soulId), filter, format: raw ? 'raw' : 'envelope', heartbeatSeconds: Math.round(heartbeatMs / 1000)});
      await pump(soul.soulId, start, () => filter, raw, {
        event: (env, id) => send({type: 'event', id, event: env}),
        cursor: cur => send({type: 'cursor', cursor: cur, tick: core.tick()}),
        gap: oldest => send({type: 'gap', oldest, digest: `/v1/edge/events/digest?since=${oldest}`}),
        idle: () => send({type: 'heartbeat', tick: core.tick()}),
      }, ac.signal);
    } catch { /* the client went away */ }
    finally { clearInterval(ping); release(conn); try { ws.close(); } catch { /* closed */ } }
  }

  // ---- digest on reconnect: a short structured summary instead of the backlog
  app.get('/v1/edge/events/digest', async c => {
    try {
      const soul = deps.soul(c); limit(soul.soulId, 'digest', 60);
      const raw = c.req.query('since') ?? c.req.query('after') ?? c.req.query('cursor'), since = parseCursor(raw);
      if (since === undefined) throw new EdgeError(400, 'invalid', 'since must be a cursor from observe, wait or an event id');
      c.header('Cache-Control', 'no-store');
      return c.json(edgeBody(buildDigest({streams, soulId: soul.soulId, since, envelope: e => envelope(soul.soulId, e), now: core.now(), fade: comms.fading.status(soul.soulId), plan: options.planSummary?.(soul.soulId) ?? null, clock: clock(), place: placeOf(soul.soulId)?.name ?? null})));
    } catch (error) { return failure(c, error); }
  });

  // ---- world.notice: steward broadcast (maintenance, restarts, outages). Bearer EDGE_STEWARD_TOKEN (never logged).
  const notice = (input: {text: string; level?: string; salience?: number; to?: string[]}) => {
    const text = oneLine(input.text, 300), level = ['info', 'maintenance', 'restart', 'outage', 'back'].includes(String(input.level)) ? String(input.level) : 'info';
    const salience = input.salience === 3 ? 3 : 2, tick = core.tick(), live = core.liveSoulIds();
    const to = (input.to?.length ? input.to.filter(id => live.includes(id)) : live).filter(id => !core.isFaded?.(id));
    for (const id of to) streams.deliver(id, 'world.notice', tick, {text, level, salience});
    core.spectate({kind: 'world.notice', tick, text, level});
    return to.length;
  };
  app.post('/v1/edge/steward/notice', async c => {
    try {
      comms.steward.authorize(c.req.header('authorization'));
      let b: Record<string, unknown>;
      try { b = await c.req.json(); } catch { throw new EdgeError(400, 'invalid', 'body must be JSON {text, level?, salience?, to?}'); }
      const text = typeof b?.text === 'string' ? b.text.trim() : '';
      if (!text || text.length > 300) throw new EdgeError(400, 'invalid', 'body: {text 1..300, level? info|maintenance|restart|outage|back, salience? 2|3, to? [soulId]}');
      const to = Array.isArray(b.to) ? (b.to as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 500) : undefined;
      return c.json(edgeBody({notice: {text, delivered: notice({text, level: b.level as string, salience: Number(b.salience), to})}}));
    } catch (error) { return failure(c, error); }
  });

  // ---- kinds the stream did not have: follow.stop (to the followed Soul), world.join / world.leave (to Souls who met them)
  ledger.onReceipt(r => {
    if (!r.capability.startsWith('follow:') || ['waiting', 'started'].includes(r.phase)) return;
    const target = r.capability.slice('follow:'.length);
    if (!core.isLive(target) || target === r.soulId) return;
    streams.deliver(target, 'follow.stop', core.tick(), {from: {soulId: r.soulId, name: name(r.soulId)}, text: `${name(r.soulId)} stopped walking with you.`, untrusted: true});
  });
  const metWith = (soulId: string): string[] => {
    const since = core.now() - 7 * 24 * 3600_000, out = new Set<string>();
    try {
      for (const r of core.db.prepare('SELECT heard_by FROM edge_comms_speech WHERE world_id = ? AND soul_id = ? AND at >= ? ORDER BY at DESC LIMIT 300').all(core.worldId, soulId, since) as {heard_by: string}[]) for (const id of JSON.parse(r.heard_by) as string[]) out.add(id);
      for (const r of core.db.prepare('SELECT soul_id FROM edge_comms_speech WHERE world_id = ? AND at >= ? AND heard_by LIKE ? LIMIT 300').all(core.worldId, since, `%"${soulId}"%`) as {soul_id: string}[]) out.add(r.soul_id);
      for (const r of core.db.prepare('SELECT DISTINCT t2.soul_id AS other FROM edge_comms_turns t1 JOIN edge_comms_turns t2 ON t1.world_id = t2.world_id AND t1.conversation_id = t2.conversation_id WHERE t1.world_id = ? AND t1.soul_id = ? AND t1.at >= ? LIMIT 300').all(core.worldId, soulId, since) as {other: string}[]) out.add(r.other);
    } catch { /* comms tables missing: nobody met */ }
    out.delete(soulId);
    return [...out].filter(id => core.isLive(id) && !core.isFaded?.(id)).slice(0, 200);
  };
  comms.fading.onFade(ch => {
    if (ch.change !== 'removed' && ch.change !== 'reclaimed') return;
    const kind = ch.change === 'removed' ? 'world.leave' : 'world.join', who = name(ch.soulId), tick = core.tick();
    for (const id of metWith(ch.soulId)) streams.deliver(id, kind, tick, {soul: {soulId: ch.soulId, name: who}, text: ch.change === 'removed' ? `${who} faded out of the world.` : `${who} is back in the world.`, untrusted: true});
  });
  // fade by abandonment: a resting posture or activity the Soul's own act chose holds it at green
  if (ledger.postureHold) comms.fading.addHold(id => ledger.postureHold!(id));

  // ---- approach (within 3 m, hysteresis to 6 m, once per pair per 5 min) and light changes, on the world clock
  const close = new Set<string>(), lastApproach = new Map<string, number>();
  let light: string | null = null;
  function sweep(tick: number) {
    // light: morning / day / evening / dusk / night (first sight only learns the label)
    try {
      const day = deps.host.living;
      if (day) {
        const c = clockAt(tick, day.origin, day.dayTicks), label = timeLabel(c.phase);
        if (light !== null && label !== light) {
          const hm = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
          for (const id of core.liveSoulIds()) if (!core.isFaded?.(id)) streams.deliver(id, 'light.changed', tick, {light: label, text: `${LIGHT_TEXT[label]} (${hm})`});
        }
        light = label;
      }
    } catch { /* no living clock */ }
    if (!ledger.poseOf) return;
    try {
      const live = core.liveSoulIds().filter(id => !core.isFaded?.(id)), now = core.now(), seen = new Set<string>();
      for (const a of live) {
        let near: {soulId: string; distance: number}[] = [];
        try { near = ledger.perceivedBodies(a, APART_M); } catch { near = []; }
        for (const o of near) {
          if (o.soulId <= a || !live.includes(o.soulId)) continue;
          const key = `${a}|${o.soulId}`; seen.add(key);
          if (close.has(key) || o.distance > APPROACH_M) continue;
          close.add(key);
          if (now - (lastApproach.get(key) ?? -Infinity) < APPROACH_COOLDOWN_MS) continue;
          lastApproach.set(key, now);
          for (const [to, from] of [[a, o.soulId], [o.soulId, a]] as const) streams.deliver(to, 'approach', tick, {from: {soulId: from, name: name(from)}, text: `${name(from)} is close by.`, untrusted: true});
        }
      }
      for (const key of close) if (!seen.has(key)) close.delete(key);       // further than 6 m (or gone): apart again
      if (lastApproach.size > 5000) for (const [k, t] of lastApproach) if (now - t > APPROACH_COOLDOWN_MS) lastApproach.delete(k);
    } catch { /* proximity is best effort */ }
  }
  const activity = activityObserver({host:deps.host,db:deps.db,deliver:(soulId,tick,body)=>streams.deliver(soulId,'activity.observed',tick,body)});
  const listeners = deps.host.listeners;
  const tickListener = {afterTick: (tick: number) => { if (tick % 20 === 0) sweep(tick); }};
  listeners?.push(tickListener,activity.listener);

  if (options.bootNotice) { try { notice({text: options.bootNotice, level: 'restart'}); } catch { /* best effort */ } }

  return {
    envelope, notice, upgrade, sweep,
    connections: soulId => conns.get(soulId)?.size ?? 0,
    close() {
      for (const set of conns.values()) for (const c of set) c.close('server stopping');
      conns.clear(); wss.close();
      activity.close();
      if (listeners) for(const listener of [tickListener,activity.listener]) { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); }
      streams.enrich = null;
    },
  };
}
