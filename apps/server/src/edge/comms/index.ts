// Core-Comms routes under /v1/edge: wait (event stream), say, subscribe, converse, objects,
// digest, and the steward work queue under /v1/edge/steward/*.
// Mounted by Ledger's edge/routes.ts via registerEdgeComms(app, deps).
import {randomUUID} from 'node:crypto';
import type {Context, Hono} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import type {EdgeDeps, EdgeReceipt, EdgeSoul} from '../contract.ts';
import {EdgeError, edgeBody, edgeErrorOf} from '../contract.ts';
import {Conversations} from './converse.ts';
import {chessKind} from './objects/chess.ts';
import {Objects} from './objects/framework.ts';
import {presentationKind} from './objects/presentation.ts';
import {markKind, projectKind} from './objects/marks.ts';
import {calendarKind} from './objects/calendar.ts';
import {rideKind} from './objects/ride.ts';
import type {CommsCore, SpectatorEdgeMessage} from './core.ts';
import {Presence} from './presence.ts';
import {say} from './speech.ts';
import {dialogueReplay} from './dialogue-replay.ts';
import {Steward} from './steward.ts';
import {Fading} from './fading.ts';
import {ensureCommsSchema,tx,afterCommit} from './store.ts';
import {EventStreams, parseCursor} from './stream.ts';
import {Webhooks, type Fetch} from './webhook.ts';
import {TokenBuckets} from '../../flood.ts';

export type CommsOptions = {
  now?: () => number;
  retainEvents?: number;
  retainMs?: number;
  /** Conversation member inactivity / invitation expiry (Gene §13: 10 min). */
  conversationTimeoutMs?: number;
  /** An unanswered invitation expires (and the inviter hears so) after this long. Default 2 min. */
  inviteTimeoutMs?: number;
  /** Background sweep period; 0 disables the timer (tests call runtime.sweep()). */
  sweepMs?: number;
  /** Webhook transport; defaults to global fetch. `null` disables delivery. */
  fetch?: Fetch | null;
  /** Bearer token the steward session presents on /v1/edge/steward/*; unset = 503. */
  stewardToken?: string;
  /** C9 fading rule. Ships OFF; only Gene turns it on. */
  fading?: boolean;
  /** LINK BODY: the idle beam-up (default: SIM_BEAM=1 only). Tests of the old rule pass true. */
  beam?: boolean;
  /** D3 (#804): the owner loop `/v1/edge/act` uses, so an object action can name the owner message it serves (`for`). */
  ownerLoop?: {check(soul: EdgeSoul, message: unknown): string | null; link(soul: EdgeSoul, receipt: EdgeReceipt, message: string, implicit?: boolean): {open: boolean}};
};

export type CommsRuntime = {
  core: CommsCore;
  streams: EventStreams;
  conversations: Conversations;
  webhooks: Webhooks;
  /** Object framework: `objects.create({...})` seeds instances; kinds via `objects.register`. */
  objects: Objects;
  /** Steward work queue: `enqueue`, `narrate`, `requestRender`, `latestDigest`. */
  steward: Steward;
  /** C9 fading (flag-off by default): `status(soulId)` for observe.self.fade, `onFade` for body effects. */
  fading: Fading;
  /** Narration/world text to one Soul, some Souls, or every live Soul. */
  publishWorld(text: string, to?: string[]): void;
  /** Spectator `edge` messages (§7) for the hub to broadcast. */
  onSpectator(listener: (m: SpectatorEdgeMessage) => void): () => void;
  /** Standing spectator state a newly joined viewer needs: the fade roster (also re-broadcast each sweep), then the
   *  recent dialogue (`speech` / `conversation.turn`, marked `replay: true`; see dialogue-replay.ts). */
  spectatorJoin(): SpectatorEdgeMessage[];
  sweep(): void;
  close(): void;
};

export const DEFAULT_WAIT_SECONDS = 25;

export function registerEdgeComms(app: Hono, deps: EdgeDeps, options: CommsOptions = {}): CommsRuntime {
  const db = deps.db.db, worldId = deps.host.worldId;
  ensureCommsSchema(db);
  const now = options.now ?? Date.now;
  const streams = new EventStreams(db, worldId, {now, retainEvents: options.retainEvents ?? 1000, retainMs: options.retainMs ?? 24 * 3600_000});
  deps.ownerInbox?.onSoulSend(soulId => streams.poke(soulId));
  const spectators: ((m: SpectatorEdgeMessage) => void)[] = [];
  const core: CommsCore = {
    deps, db, worldId, streams, now,
    tick: () => { try { return deps.host.engine.world.tick; } catch { return 0; } },
    nameOf: id => deps.host.minds?.get(id)?.name ?? deps.db.soul(id)?.name ?? 'someone',
    nameMetadata:id=>deps.host.publicNameMetadata?.(id)??{},
    liveSoulIds: () => deps.db.liveSouls(worldId).map(s => s.id),
    isLive: id => { const s = deps.db.soul(id); return !!s && s.world_id === worldId && s.retired_at === null; },
    spectate: m => { if (!spectators.length) return; const msg = structuredClone({type:'edge',at:now(),...m}) as SpectatorEdgeMessage;afterCommit(db,()=>{for(const l of [...spectators])try{l(msg);}catch{/* never break comms */}}); },
  };
  const conversations = new Conversations(core, options.conversationTimeoutMs ?? 10 * 60_000, options.inviteTimeoutMs ?? 2 * 60_000);
  const webhooks = new Webhooks(core, options.fetch === null ? undefined : options.fetch ?? (globalThis.fetch as unknown as Fetch));
  const objects = new Objects(core);
  objects.register(chessKind);
  objects.register(presentationKind);
  objects.register(markKind);
  objects.register(projectKind);
  objects.register(calendarKind);
  objects.register(rideKind);
  // Audited read-only object offers cannot replace a walk. The ledger still
  // evaluates/validates this projection; a future non-object offer falls back.
  deps.ledger.addCapabilityProvider((soul, only, places) => objects.capabilities(soul, only, places),{exactWalk:'objects-only'});
  const steward = new Steward(core, options.stewardToken);
  const fading = new Fading(core, steward, options.fading === true, options.beam);
  core.isFaded = id => fading.status(id)?.colour === 'gone';
  const roster = (): SpectatorEdgeMessage[] => fading.enabled ? [{type: 'edge', kind: 'fade.roster', tick: core.tick(), at: now(), souls: fading.roster()}] : [];
  const presence = new Presence({ledger: deps.ledger, liveSoulIds: core.liveSoulIds, nameOf: core.nameOf, deliver: (s, k, t, b) => { streams.deliver(s, k, t, b); }});

  // Ledger feeds: receipt phases to their own Soul (deduplicated durably, so replays
  // after boot do not repeat), place changes to the Souls who share the place.
  deps.ledger.onReceipt((r: EdgeReceipt) => tx(db,()=>{
    const fresh = Number(db.prepare('INSERT OR IGNORE INTO edge_comms_receipts_seen (world_id, receipt_id, phase) VALUES (?,?,?)').run(worldId, r.id, r.phase).changes) > 0;
    if (!fresh) return;
    if (r.phase === 'started' || r.phase === 'waiting') fading.touch(r.soulId);
    const tick = r.endedTick ?? r.startedTick ?? r.acceptedTick;
    streams.deliver(r.soulId, 'receipt', tick, {receipt: {id: r.id, capability: r.capability, phase: r.phase, acceptedTick: r.acceptedTick, startedTick: r.startedTick, endedTick: r.endedTick, code: r.code, reason: r.reason, ...(r.channel ? {channel: r.channel} : {}), ...(r.chosen ? {chosen: r.chosen} : {}), ...(r.endedAt ? {endedAt: r.endedAt} : {}), ...(r.outcome?{outcome:r.outcome}:{}), ...((r as {alternatives?: unknown}).alternatives ? {alternatives: (r as {alternatives?: unknown}).alternatives} : {})}});   // Core-A: strict/1 endedAt, intents/1 chosen + alternatives
  }));
  deps.ledger.onPlaceChange(e => presence.onPlaceChange(e));
  try { presence.prime(); } catch { /* ledger not ready: paths are learned on first change */ }

  // EdgeError → its status; any other fault → 503 `unavailable` (same mapping as Ledger's routes).
  const failure = (c: Context, error: unknown) => {
    if (error instanceof EdgeError) return c.json(edgeBody({error: edgeErrorOf(error)}), error.status as ContentfulStatusCode);
    console.error('[edge] comms fault', c.req.method, c.req.path, error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error));
    return c.json(edgeBody({error: {code: 'unavailable', message: 'the world could not answer; retry'}}), 503);
  };
  const route = (fn: (c: Context, soul: EdgeSoul) => object | Promise<object>) => async (c: Context) => {
    try {
      const soul = deps.soul(c);
      return c.json(edgeBody(await fn(c, soul)));
    } catch (error) {
      return failure(c, error);
    }
  };
  const json = async (c: Context): Promise<Record<string, unknown>> => {
    let body: unknown;
    try { body = await c.req.json(); } catch { throw new EdgeError(400, 'invalid', 'body must be JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EdgeError(400, 'invalid', 'body must be a JSON object');
    return body as Record<string, unknown>;
  };

  app.get('/v1/edge/wait', route(async (c, soul) => {
    const after = parseCursor(c.req.query('after'));
    if (after === undefined) throw new EdgeError(400, 'invalid', 'after must be a cursor from observe or wait');
    const rawTimeout = c.req.query('timeout');
    const seconds = rawTimeout === undefined ? DEFAULT_WAIT_SECONDS : Number(rawTimeout);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 55) throw new EdgeError(400, 'invalid', 'timeout must be 1..55 seconds');
    const box = deps.ownerInbox;
    if (!box) return streams.wait(soul.soulId, after, seconds * 1000, c.req.raw.signal);
    // SOULSIM-H F1: a wait also ends when the owner writes (a message no listen has handed over, or one sent after
    // `ownerSince`, the `ownerMark` of the agent's previous wait), so a Soul busy walking sees "sit on the bench" at once.
    const rawSince = c.req.query('ownerSince'), since = rawSince === undefined ? now() : Number(rawSince);
    if (!Number.isSafeInteger(since) || since < 0) throw new EdgeError(400, 'invalid', 'ownerSince must be an ownerMark from wait');
    // SOULSIM-H F7: for a client that sends ownerSince (CLI 1.9.6+, which prints the messages), EVERY message not yet
    // acknowledged ends the wait: an agent looping `wait 60` before acking "stop" slept 20 s through it. Older clients
    // (no ownerSince, e.g. the live poll) keep the since-now rule, so a held message never spins them.
    const scope = {scope: `soul:${soul.soulId}`, owner: soul.owner}, from = rawSince === undefined ? since : 0;
    // D3 (playtest 2026-10-25: the card read "away" while the agent sat in `act --wait`, which does return on owner messages):
    // a wait that ends when the owner writes is listening, so presence says the agent will see the next message
    const end = (box as {listening?: (s: {scope: string; owner: string}) => () => void}).listening?.(scope);
    let r: Awaited<ReturnType<typeof streams.wait>>;
    try {r = await streams.wait(soul.soulId, after, seconds * 1000, c.req.raw.signal, () => !!box.ownerWrote(scope, from));} finally {end?.();}
    const wrote = box.ownerWrote(scope, from);
    return wrote ? {...r, ownerWrote: wrote.waiting, ownerMark: Math.max(since, wrote.newestAt + 1)} : {...r, ownerMark: Math.max(since, now())};
  }));
  app.post('/v1/edge/say', route(async (c, soul) => { const out = say(core, soul, await json(c), id => objects.addressees(id)); fading.touch(soul.soulId); return out; }));
  app.post('/v1/edge/subscribe', route(async (c, soul) => webhooks.subscribe(soul, await json(c))));
  app.delete('/v1/edge/subscribe', route((_c, soul) => webhooks.unsubscribe(soul)));
  app.post('/v1/edge/converse', route(async (c, soul) => { const out = conversations.handle(soul, await json(c)); if (out.accepted) fading.touch(soul.soulId); else deps.ledger.recordRefusal?.(soul.soulId, 'converse', String((out as {op?: unknown}).op ?? 'converse'), String((out as {code?: unknown}).code ?? 'refused')); return out; }));
  app.get('/v1/edge/conversations', route((_c, soul) => conversations.list(soul)));
  app.get('/v1/edge/conversations/:id/turns', route((c, soul) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) throw new EdgeError(400, 'invalid', 'after must be a turn number');
    return conversations.turns(soul, c.req.param('id') ?? '', after);
  }));

  app.get('/v1/edge/objects', route((_c, soul) => ({objects: objects.visibleTo(soul)})));
  app.get('/v1/edge/objects/:id', route((c, soul) => objects.get(c.req.param('id') ?? '', soul)));
  app.post('/v1/edge/objects/:id/act', route(async (c, soul) => {
    // D3 (#804): `for` / `forDefault` name the owner message this action serves, checked and linked as on /v1/edge/act
    const {for: forMessage, forDefault, ...body} = await json(c), id = c.req.param('id') ?? '', cap = `object:${id}:${String(body.action ?? '')}`, loop = forMessage !== undefined ? options.ownerLoop : undefined;
    if (loop) {const no = loop.check(soul, forMessage); if (no) throw new EdgeError(400, 'invalid', no);}
    const linked = <T extends object>(out: T, receipt: EdgeReceipt): T => {if (!loop) return out; const {open} = loop.link(soul, receipt, forMessage as string, forDefault === true); return {...out, for: forMessage, ...(open ? {open} : {})};};
    const prepared=objects.prepareAct(id,soul,body),out=prepared.result;
    if (!out.accepted) { if(!prepared.movesBody)objects.act(id,soul,body);deps.ledger.recordRefusal?.(soul.soulId, 'object', cap, String((out as {code?: unknown}).code ?? 'refused'), String((out as {reason?: unknown}).reason ?? '')); return out; }
    // A body-moving action (a ride's join/leave/start) gets a normal receipt from the Ledger, or its genuine refusal.
    const {bodies, ...rest} = out;
    // A non-body action has no Ledger receipt here; a linked one is a defined immediate result: an in-memory completed
    // receipt goes through the same link rules (one step: the message closes now; not its last step: `open`).
    if(!bodies?.length){const accepted=prepared.commit();fading.touch(soul.soulId);const t=core.tick();
      if(!loop||!accepted.accepted)return accepted;
      // the owner's card reads the action's own label ("Leave a short response: done."), not the capability id
      const label=objects.kindOf(objects.all().find(o=>o.id===id)?.kind??'')?.actions[String(body.action)]?.label;
      return linked(accepted,{id:`object-act:${soul.soulId}:${randomUUID()}`,soulId:soul.soulId,capability:cap,phase:'completed',acceptedTick:t,startedTick:t,endedTick:t,code:null,reason:null,programId:null,channel:'none',...(label?{done:`${label}: done.`}:{})} as EdgeReceipt);}
    if(!deps.ledger.performBodies)return {accepted:false,code:'object.body-unavailable',reason:'Body admission is unavailable.',object:id,action:out.action};
    const contact=deps.ledger.contactActuatorDetail?.(soul,id,out.action,(body.params&&typeof body.params==='object'?body.params:{}) as Record<string,unknown>);
    const b = await deps.ledger.performBodies(soul, cap, bodies[0]!.label, bodies[0]!.steps as never, typeof body.clientRef === 'string' ? `obj:${body.clientRef}` : undefined,undefined,{guard:prepared.guard,commit:()=>{if(contact)return contact;prepared.commit();}});
    if(b.accepted)fading.touch(soul.soulId);
    return b.accepted ? linked({...rest, receipt: b.receipt}, b.receipt) : {accepted: false, code: b.code, reason: b.reason, object: id, action: out.action};
  }));
  // Public (no Soul token). L8: the items are serialized once per object-table change, not per request, and one visitor
  // address may read it 60 times a minute (a request with no x-forwarded-for came from this machine: no limit).
  const calendarReads = new TokenBuckets(1, 60);
  let calendarItems: {changes: number; json: string} | undefined;
  app.get('/v1/edge/calendar', c => {
    const xff = c.req.header('x-forwarded-for'), wait = xff ? calendarReads.take(xff.split(',')[0].trim()) : 0;
    if (wait) { c.header('Retry-After', String(Math.ceil(wait / 1000))); return failure(c, new EdgeError(429, 'rate-limited', 'More than 60 calendar reads a minute from your address; wait a moment.')); }
    const changes = objects.generation();
    if (calendarItems?.changes !== changes) calendarItems = {changes, json: JSON.stringify(objects.ofKind('calendar-item').filter(o => (o.state as {phase: string}).phase !== 'over').map(o => ({id: o.id, ...(o.state as object)})))};
    return c.body(`${JSON.stringify(edgeBody({tick: core.tick()})).slice(0, -1)},"items":${calendarItems.json}}`, 200, {'Content-Type': 'application/json'});
  });
  app.get('/v1/edge/digest', route(() => ({digest: steward.latestDigest()})));

  // Steward session endpoints (not Soul-authenticated).
  const stewardRoute = (fn: (c: Context) => object | Promise<object>) => async (c: Context) => {
    try { steward.authorize(c.req.header('authorization')); return c.json(edgeBody(await fn(c))); }
    catch (error) { return failure(c, error); }
  };
  const by = (body: Record<string, unknown>) => typeof body.by === 'string' && body.by.length <= 100 ? body.by : 'steward';
  // Steward calendar: post an open gathering (often one a Soul proposed). Public listing for everyone.
  app.post('/v1/edge/steward/calendar', stewardRoute(async c => {
    const b = await json(c), title = String(b.title ?? '').trim(), placeId = String(b.placeId ?? '');
    const minutes = Number(b.startsInMinutes), duration = Number(b.durationMinutes ?? 60);
    if (!title || title.length > 80 || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(placeId) || !Number.isFinite(minutes) || minutes < 0 || minutes > 7 * 24 * 60 || !Number.isFinite(duration) || duration < 5 || duration > 600) throw new EdgeError(400, 'invalid', 'body: {title<=80, placeId, startsInMinutes 0..10080, durationMinutes? 5..600, description?, proposedBy?}');
    const tick = core.tick(), id = 'cal-' + Math.random().toString(36).slice(2, 10);
    const placeName = (deps.ledger as unknown as {places?: {byId: Map<string, {name: string}>}}).places?.byId.get(placeId)?.name ?? placeId;
    const o = objects.create({id, kind: 'calendar-item', name: title, placeId, params: {title, description: b.description, placeId, placeName, proposedBy: b.proposedBy, startsAtTick: tick + Math.round(minutes * 60 * 20), durationTicks: Math.round(duration * 60 * 20)}});
    {const text = `New on the calendar: "${title}" at ${placeName} in ${Math.round(minutes)} minutes.`, t = core.tick(); for (const sid of core.liveSoulIds()) streams.deliver(sid, 'world', t, {text}); core.spectate({kind: 'world', tick: t, text});}
    return {calendarItem: {id: o.id, title, placeId, startsAtTick: (o.state as {startsAtTick: number}).startsAtTick}};
  }));
  app.get('/v1/edge/steward/work', stewardRoute(c => { steward.schedule(); return {clock: steward.clock(), work: steward.list(c.req.query('done') === '1')}; }));
  app.post('/v1/edge/steward/work/:id/claim', stewardRoute(async c => ({work: steward.claim(c.req.param('id') ?? '', by(await json(c)))})));
  app.post('/v1/edge/steward/work/:id/release', stewardRoute(c => steward.release(c.req.param('id') ?? '')));
  app.post('/v1/edge/steward/work/:id/complete', stewardRoute(async c => {
    const body = await json(c);
    const result = body.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new EdgeError(400, 'invalid', 'result must be an object');
    return {work: steward.complete(c.req.param('id') ?? '', result as Record<string, unknown>)};
  }));
  app.get('/v1/edge/steward/log', stewardRoute(c => {
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isFinite(since) || since < 0) throw new EdgeError(400, 'invalid', 'since must be ms since epoch');
    return steward.log(since);
  }));

  let closed = false;
  let pendingSweep: Generator<void, void, void> | undefined;
  let sweepTurn: ReturnType<typeof setImmediate> | undefined;
  const cancelSweep = () => {
    pendingSweep = undefined;
    if (sweepTurn) clearImmediate(sweepTurn);
    sweepTurn = undefined;
  };
  // Keep the existing phase order and retry policy. Only timer maintenance yields to the event loop; explicit sweep()
  // remains synchronous. Object work yields after a complete transaction, including its committed notifications.
  function* sweepSteps(sliced: boolean): Generator<void, void, void> {
    try { conversations.sweep(); } catch { /* retried next period */ }
    yield;
    try { if (sliced) yield* objects.sweepSteps(); else objects.sweep(); } catch { /* retried next period */ }
    yield;
    try { steward.schedule(); } catch { /* retried next period */ }
    yield;
    try { fading.sweep(); } catch { /* retried next period */ }
    yield;
    try { for (const m of roster()) core.spectate(m); } catch { /* retried next period */ }
    yield;
    try { streams.pruneAll(); } catch { /* retried next period */ }
  }
  const sweep = () => {
    cancelSweep();
    if (closed) return;
    for (const _ of sweepSteps(false)) if (closed) break;
  };
  const advanceSweep = (work: Generator<void, void, void>) => {
    if (closed || pendingSweep !== work) return;
    const deadline = performance.now() + 8;
    do {
      const done = work.next().done;
      // A committed notification can close the runtime or request a synchronous sweep reentrantly.
      if (closed || pendingSweep !== work) return;
      if (done) { pendingSweep = undefined; return; }
    } while (performance.now() < deadline);
    // Eight milliseconds is a turn budget, not a preemption guarantee: one advance/other phase remains atomic.
    sweepTurn = setImmediate(() => {
      if (closed || pendingSweep !== work) return;
      sweepTurn = undefined;
      advanceSweep(work);
    });
    sweepTurn.unref?.();
  };
  const scheduleSweep = () => {
    if (closed || pendingSweep) return;
    pendingSweep = sweepSteps(true);
    advanceSweep(pendingSweep);
  };
  const timer = (options.sweepMs ?? 30_000) > 0 ? setInterval(scheduleSweep, options.sweepMs ?? 30_000) : null;
  timer?.unref?.();
  for (const r of db.prepare('SELECT soul_id FROM edge_comms_subscriptions WHERE world_id = ?').all(worldId) as {soul_id: string}[]) void webhooks.push(r.soul_id);

  return {
    core, streams, conversations, webhooks, objects, steward, fading,
    publishWorld(text, to) {
      const tick = core.tick();
      for (const id of to ?? core.liveSoulIds()) streams.deliver(id, 'world', tick, {text});
      core.spectate({kind: 'world', tick, text});
    },
    onSpectator(l) { spectators.push(l); return () => {const i=spectators.indexOf(l);if(i>=0)spectators.splice(i,1);}; },
    spectatorJoin: () => { let replay: SpectatorEdgeMessage[] = []; try { replay = dialogueReplay(core); } catch { /* history is optional */ } return [...roster(), ...replay]; },
    sweep,
    close() { closed = true; if (timer) clearInterval(timer); cancelSweep(); webhooks.close(); streams.wakeAll(); },
  };
}

/** EDGE-CONTRACT-v1 §8 export: object actions as capabilities for a Soul. */
export function edgeObjectCapabilities(runtime: CommsRuntime, soul: EdgeSoul) { return runtime.objects.capabilities(soul); }
