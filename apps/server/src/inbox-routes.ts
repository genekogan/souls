import type {Context, Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import type {Db, UserRow} from './db.ts';
import type {GodMode} from './god/god.ts';
import {ApiError, type Souls} from './souls.ts';
import {AgentInbox, type InboxScope, type TicketFocus} from './inbox.ts';
import {soulLink} from './soul-link.ts';
import type {WorldModel} from '@sim/world-compiler';

/** Who answers POST /v1/souls/<id>/command in a world (#982): one route, one handler per world mode. An edge world
 *  delivers the owner's text to the Soul's agent inbox (this file); a central-mind world translates it (http.ts). */
export type OwnerCommandRoute = 'edge-inbox' | 'central-translator';
export const ownerCommandRoute = (edge: boolean): OwnerCommandRoute => (edge ? 'edge-inbox' : 'central-translator');
type Deps = {db: Db; worldId: string; souls: Souls; god?: GodMode; edge?: boolean; command?: OwnerCommandRoute; requireUser(c: Context): Promise<UserRow>; ownerSoul(c: Context, id: string): Promise<{id: string; owner: string}>; now?: () => number};
type Agent = {kind: 'god' | 'soul'; scope: InboxScope};
export function mountAgentInbox(app: Hono, d: Deps) {
  const inbox = new AgentInbox(d.db, d.worldId, d.now);
  const ownsCommand = (d.command ?? ownerCommandRoute(!!d.edge)) === 'edge-inbox';
  if (d.god) {
    const god = d.god;
    // G4: the edits that commit while the god holds a command are that command's; its ack records where they are.
    god.onCommit(c => { if (god.owner && (c.diff.upserts.length || c.diff.removes.length)) inbox.recordTouched({scope: 'god', owner: god.owner}, [...c.diff.upserts.map(e => e.id), ...c.diff.removes]); });
    inbox.focusOf = ids => focusOf(god.model, ids);
  }
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const agent = (c: Context): Agent | null => {
    const token = bearer(c);
    if (token?.startsWith('god_') && d.god?.owner) {
      const identity = d.god.godIdentity(token);
      if (identity && identity.label !== 'browser') return {kind: 'god', scope: {scope: 'god', owner: d.god.owner}};
    }
    if (token?.startsWith('sim_')) {
      const soul = d.souls.soulFromToken(token);
      if (soul) return {kind: 'soul', scope: {scope: `soul:${soul.id}`, owner: soul.owner}};
    }
    return null;
  };
  const requireAgent = (c: Context, kind: Agent['kind']) => {
    const a = agent(c);
    if (!a || a.kind !== kind) {
      if (kind === 'soul') {
        const refusal = d.souls.controlRefusal(bearer(c));
        throw new ApiError(401, refusal.code, refusal.message, refusal.extra);
      }
      throw new ApiError(401, 'unauthorized', 'use the paired agent credential; browser access does not receive messages');
    }
    return a.scope;
  };
  // This middleware precedes every God/edge subroute. A human identity and the
  // Godmode browser token never count as an agent or receive a private message.
  app.use('/v1/*', async (c, next) => {
    const before = agent(c);
    if (before) inbox.touch(before.scope);
    await next();
    if (!before || c.req.raw.signal.aborted || c.res.status === 401 || c.res.status === 403) return;
    const current = agent(c);
    if (!current || current.kind !== before.kind || current.scope.owner !== before.scope.owner || current.scope.scope !== before.scope.scope) return;
    // Versioned strict contracts (intent-v2 receipts, history pages, arrivals; the MCP tools that relay them) must keep their
    // exact JSON shape: strict clients reject an extra key. They carry the inbox in the header, like binary/stream replies.
    const contract = /\/intent-v2(\/|$)/.test(c.req.path);
    // G4: a successful ack answers with the command it acknowledged; it does not hand over the next queued one (the next
    // listen does). Any other private answer carries, and so delivers, the command the agent should see.
    const acked = c.res.status >= 200 && c.res.status < 300 && /\/v1\/(god|edge)\/inbox\/[^/]+\/(ack|result)$/.test(c.req.path);
    // MSG: a Soul's messages have one consumer, its listen (which hands over the whole backlog). Other answers carry a
    // private notice of the oldest waiting message but do not mark it received, so a listen never misses its wake-up.
    const soulListen = current.kind === 'soul' && c.res.status === 200 && c.req.path.endsWith('/v1/edge/inbox/listen');
    const carry = (own?: unknown) => (acked || soulListen) && own ? own : current.kind === 'god' ? inbox.deliver(current.scope) : inbox.view(current.scope);
    if (contract || !c.res.headers.get('content-type')?.includes('application/json')) {
      if (c.res.status < 200 || c.res.status >= 300) return;
      inbox.touch(current.scope);
      const encoded = Buffer.from(JSON.stringify({inbox: carry()}), 'utf8').toString('base64url');
      // Binary and streaming consumers read one private header without changing
      // the image/event bytes or waiting for a streaming body to finish.
      c.res.headers.set('X-Sim-Agent-Inbox', encoded);
      c.res.headers.set('Cache-Control', 'no-store'); c.res.headers.delete('ETag');
      return;
    }
    const payload: unknown = await c.res.clone().json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    inbox.touch(current.scope);
    const headers = new Headers(c.res.headers); headers.set('Cache-Control', 'no-store'); headers.delete('ETag'); headers.delete('Content-Length');
    c.res = new Response(JSON.stringify({...payload, inbox: carry((payload as {inbox?: unknown}).inbox)}), {status: c.res.status, headers});
  });
  for (const path of ['/v1/god/inbox', '/v1/god/inbox/*', '/v1/edge/inbox/*', '/v1/edge/owner/:soulId/inbox', ...(ownsCommand ? ['/v1/souls/:soulId/command'] : [])]) {
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
    app.use(path, bodyLimit({maxSize: 8192, onError: c => c.json({ok: false, code: 'too-large', message: 'message is too large'}, 413)}));
  }
  const json = async (c: Context) => { try { const b = await c.req.json(); if (!b || typeof b !== 'object' || Array.isArray(b)) throw Error(); return b as Record<string, unknown>; } catch { throw new ApiError(400, 'invalid', 'body must be a JSON object'); } };
  const limit = (key: string, max: number) => { const r = d.souls.limits.allow(key, max, 60_000); if (!r.ok) throw new ApiError(429, 'rate-limited', 'too many requests; slow down', {retry_after: r.retryAfter}); };
  const godOwner = async (c: Context): Promise<InboxScope> => {
    const u = await d.requireUser(c);
    if (!d.god?.owner || u.id !== d.god.owner) throw new ApiError(403, 'forbidden', 'only this world’s owner');
    return {scope: 'god', owner: u.id};
  };
  const soulOwner = async (c: Context): Promise<InboxScope> => {
    const soul = await d.ownerSoul(c, c.req.param('soulId')!);
    return {scope: `soul:${soul.id}`, owner: soul.owner};
  };
  /** LINK (COMMON-LINK §2): a Soul owner's view also carries the one link state and the agent's public `now` line. */
  const linkFields = async (c: Context, s: InboxScope) => {
    if (!s.scope.startsWith('soul:')) return {};
    const row = d.db.soul(s.scope.slice(5)); if (!row) return {};
    const u = await d.requireUser(c);
    return {link: soulLink(d.souls, inbox, row, u.id), now: d.souls.host.nowOf(row.id)};
  };
  const ownerRoutes = (path: string, owner: (c: Context) => Promise<InboxScope>, bucket: 'god-inbox' | 'cmd', command = false) => {
    if (!command) app.get(path, async c => { const s = await owner(c); return c.json({inbox: {...inbox.ownerView(s), ...await linkFields(c, s)}}); });
    app.post(path, async c => {
      const s = await owner(c), b = await json(c);
      if (command && (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 280)) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
      limit(`${bucket}:${s.owner}`, 20);
      // Recheck authority after reading the body before storing private text.
      const current = await owner(c);
      if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(403, 'forbidden', 'owner authority changed');
      const sent = inbox.send(s, b.text);
      return c.json({ok: true, inbox: command ? sent : {...sent, ...await linkFields(c, s)}});
    });
  };
  if (d.god) {
    ownerRoutes('/v1/god/inbox', godOwner, 'god-inbox');
    // G4: the owner takes back a command that is waiting (or one the agent holds and never finished).
    app.post('/v1/god/inbox/:id/withdraw', async c => { const s = await godOwner(c); limit(`god-inbox:${s.owner}`, 20); return c.json({ok: true, inbox: inbox.withdraw(s, c.req.param('id')!)}); });
  }
  ownerRoutes('/v1/edge/owner/:soulId/inbox', soulOwner, 'cmd');
  // Edge Souls use the existing owner command channel; the new box endpoint is
  // an alias over its same latest record and 20/min owner bucket. On a central-mind
  // world http.ts mounts the translator instead (ownerCommandRoute, #982).
  if (ownsCommand) ownerRoutes('/v1/souls/:soulId/command', soulOwner, 'cmd', true);
  const agentRoutes = (path: string, kind: Agent['kind']) => {
    app.get(`${path}/listen`, async c => {
      const s = requireAgent(c, kind), raw = c.req.query('timeoutMs'), timeout = raw === undefined ? 25_000 : Number(raw), after = c.req.query('after');
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 55_000 || (after?.length ?? 0) > 100) throw new ApiError(400, 'invalid', 'timeoutMs must be 0..55000 and after must be a message id');
      const key = JSON.stringify(s); limit(`inbox-listen:${kind}:${key}`, 120);
      // LISTEN-LEAK: a newer listen for the same agent supersedes this one instead of being refused (one live listener).
      // A timeoutMs=0 peek (the CLI's wait interrupt) never supersedes the waiting listener.
      const claim = timeout > 0 ? inbox.claimListen(s) : {signal: new AbortController().signal, release: () => {}};
      const end = inbox.listening(s);   // G4: the owner's "connected" is a listener waiting now
      let handed = false;               // MSG: an empty answer means the CLI re-polls at once (presence keeps 'listening')
      try {
        await inbox.listen(s, after, timeout, AbortSignal.any([c.req.raw.signal, claim.signal]));
        // Superseded (or the caller hung up): hand over nothing; the newer listen takes every waiting message.
        if (claim.signal.aborted) throw new ApiError(409, 'superseded', 'superseded by a newer listen for this agent; this listen has ended, do not restart it');
        if (c.req.raw.signal.aborted) throw new ApiError(499, 'closed', 'the listener hung up');
        const current = requireAgent(c, kind);
        if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(401, 'unauthorized', 'agent authority changed');
        // MSG: a Soul's listen hands over every waiting message at once, oldest first (the agent works through them all).
        // An older CLI reads `latest`: the first one after its cursor, so its listen/follow loop walks the queue in order.
        if (kind === 'soul') { const backlog = inbox.takeBacklog(s, after), v = inbox.view(s); handed = backlog.length > 0; return c.json({inbox: {...v, latest: backlog[0] ?? v.latest}, backlog}); }
        return c.json({inbox: inbox.view(s)});
      } finally { claim.release(); end(handed); }
    });
    app.post(`${path}/:id/ack`, async c => {
      const s = requireAgent(c, kind), b = await json(c); limit(`inbox-ack:${kind}:${JSON.stringify(s)}`, 120);
      const current = requireAgent(c, kind);
      if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(401, 'unauthorized', 'agent authority changed');
      return c.json({inbox: inbox.acknowledge(s, c.req.param('id')!, b.reply, b.outcome)});
    });
  };
  if (d.god) agentRoutes('/v1/god/inbox', 'god');
  agentRoutes('/v1/edge/inbox', 'soul');
  // Readback uses the native queue, including finished messages that listen no
  // longer returns. This route is mounted before the edge middleware.
  app.get('/v1/edge/inbox/:id', c => {
    const s = requireAgent(c, 'soul'); limit(`inbox-read:soul:${JSON.stringify(s)}`, 120);
    const message = inbox.messageById(s, c.req.param('id')!);
    if (!message) throw new ApiError(404, 'not-found', 'no such message (it may be too old)');
    return c.json({message});
  });
  // MSG: a Soul's second answer, when its work ends ("Arrived" / "Couldn't: ..."); the first is the ack's reply.
  app.post('/v1/edge/inbox/:id/result', async c => {
    const s = requireAgent(c, 'soul'), b = await json(c); limit(`inbox-ack:soul:${JSON.stringify(s)}`, 120);
    const current = requireAgent(c, 'soul');
    if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(401, 'unauthorized', 'agent authority changed');
    return c.json({inbox: inbox.result(s, c.req.param('id')!, b.text, b.outcome)});
  });
  return inbox;
}

/** Where a command's edits are now: the box around the touched things still in the world (shaped things by their shape). */
export function focusOf(model: WorldModel, ids: string[]): TicketFocus | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, ys = 0, count = 0, label: string | undefined;
  for (const id of ids.slice(0, 300)) {
    const e = model.entities.get(id); if (!e) continue;
    const sh = (e as {shape?: {area?: number[][]; path?: number[][]}}).shape, pts = sh?.area ?? sh?.path;
    let y = 0;
    if (pts?.length) for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    else { let w; try { w = model.worldPose(e); } catch { continue; } x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); z0 = Math.min(z0, w.z); z1 = Math.max(z1, w.z); y = w.y; }
    ys += y; count++;
    if (!label && e.in.parent === 'world') label = e.name ?? e.def.replace(/^core[/-]/, '').replace(/@\d+$/, '');
  }
  if (!count) return null;
  const r = (v: number) => Math.round(v * 10) / 10;
  return {x: r((x0 + x1) / 2), y: r(ys / count), z: r((z0 + z1) / 2), span: r(Math.max(6, x1 - x0, z1 - z0)), ...(label ? {label} : {}), count};
}
