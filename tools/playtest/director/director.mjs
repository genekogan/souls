// The Director: a real-time loop that plays each seat's persona against the live world (DESIGN §4.3).
// Seats are independent: own RNG (seed + index), own camera, own card, own chat, own persona. Nothing crosses seats.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { monoMs, sleep as realSleep } from '../lib/clock.mjs';
import { rng as makeRng } from '../lib/hash.mjs';
import { appendJsonl, writeJson } from '../lib/jsonl.mjs';
import { quota, quotaAllows } from '../lib/quota.mjs';
import { withKinematics } from '../observer/kinematics.mjs';
import { runFixtureSetup } from '../arena/fixture-setup.mjs';
import { PersonaSession, loadSheet, parseSheet } from './persona.mjs';

const RESULT_STATES = new Set(['done', 'completed', 'complete', 'failed', 'refused', 'declined', 'cancelled', 'canceled', 'replaced', 'result', 'error']);
const realClock = { now: monoMs, sleep: realSleep };
const log = (...a) => process.stderr.write(`[director] ${a.join(' ')}\n`);

/** The message for `messageId` in an owner card view, if it carries a result: {resultText, state} | null. */
function cardMessageFor(view, messageId) {
  if (!view || messageId == null) return null;
  return [view.latest,view.message,...(Array.isArray(view.messages)?view.messages:[]),...(Array.isArray(view.history)?view.history:[])].find(x=>x&&(x.id??x.messageId)===messageId)??null;
}
export function cardResultFor(view, messageId) {
  if (!view || messageId == null) return null;
  const pool = [view.latest, view.message, ...(Array.isArray(view.messages) ? view.messages : []), ...(Array.isArray(view.history) ? view.history : [])].filter(Boolean);
  const m = pool.find((x) => (x.id ?? x.messageId) === messageId);
  if (!m) return null;
  const resultText = m.result ?? m.resultText ?? null;
  if (resultText || RESULT_STATES.has(String(m.state ?? '').toLowerCase())) return { resultText, state: m.state ?? null };
  return null;
}
const cardSig = (v) => { try { return JSON.stringify(v ?? null); } catch { return String(v); } };
const resultSig = (v) => { const l = v?.latest ?? v?.message; return l ? `${l.id ?? l.messageId}|${l.result ?? l.resultText ?? ''}|${l.state ?? ''}` : ''; };
const turnCountOf = (s) => (typeof s.turnCount === 'function' ? s.turnCount() : Number.isFinite(s.turnCount) ? s.turnCount : null);
const explicitTerminal = m => !!m?.result && m.resultBy!=='server' && RESULT_STATES.has(String(m.outcome??m.state??'').toLowerCase());

/** Next glance delay (ms): the persona's waitSec jittered ±15%, else uniform in the glance range; never under its minimum. */
export function nextIntervalMs(glance, waitSec, r) {
  const [a, b] = glance;
  const sec = Number.isFinite(waitSec) ? waitSec * (0.85 + 0.3 * r()) : a + r() * (b - a);
  return Math.round(Math.min(900, Math.max(a, sec)) * 1000);
}

export function budgetMsFor({ scenario, quick, budgetSec, god = false }) {
  if (Number.isFinite(budgetSec)) return budgetSec * 1000;
  if (god) return (scenario.director?.godBudgetSec ?? 600) * 1000; // a build outlives a Soul request window
  const o = scenario.director?.budgetSec;
  if (Number.isFinite(o)) return o * 1000;
  return ((quick ? o?.quick : o?.default) ?? (quick ? 90 : 180)) * 1000;
}

/**
 * runPlay({runDir, scenario, world, seats, god, observer, owner, clock?, personaFactory?, quotaCheck?, seed?, pollSec?})
 * seats: array (or {id: seat}) of arena Seat objects matched to scenario.seats by id. god: god Seat or null.
 * Returns {stoppedBy, elapsedSec, seats: {id: {steps, requests, closed}}}.
 */
export async function runPlay({ runDir, scenario, world, seats, god = null, observer, owner, clock = realClock, personaFactory = null, quotaCheck = null, seed = 0, pollSec = 2 }) {
  const mode = scenario.director?.mode ?? 'persona';
  const rails = scenario.rails ?? {};
  const maxTurns = rails.maxTurnsPerRequest ?? 6;
  const durationMs = (scenario.durationSec ?? 600) * 1000;
  const pollMs = pollSec * 1000;
  const start = clock.now();
  const endAt = start + durationMs;
  const state = { stopped: null };
  const stop = (why) => { if (!state.stopped) { state.stopped = why; log('stop:', why); } };
  const live = () => !state.stopped && clock.now() < endAt;
  const elapsedSec = () => (clock.now() - start) / 1000;
  const sleepUntil = async (target, wake = null) => { while (live() && clock.now() < target) { if (wake?.()) return true; await clock.sleep(Math.min(pollMs, target - clock.now(), endAt - clock.now())); } return false; };
  const seatById = Array.isArray(seats) ? Object.fromEntries(seats.map((s) => [s.id, s])) : (seats ?? {});
  const quotaFn = quotaCheck ?? (async () => quotaAllows(await quota(), { stopPct: rails.quotaStopPct ?? 90 }));

  const cfgs = (scenario.seats ?? []).map((c) => ({ ...c, kind: 'player', seatObj: seatById[c.id] }));
  if (scenario.god && god) cfgs.push({ ...scenario.god, id: god.id ?? 'god', kind: 'god', seatObj: god });
  const ctxs = cfgs.map((cfg, i) => makeCtx(cfg, i));

  function makeCtx(cfg, i) {
    if (!cfg.seatObj) throw new Error(`no seat object for ${cfg.id}`);
    let meta = {};
    try { if (cfg.persona) meta = parseSheet(loadSheet(cfg.persona).text).meta; } catch { /* custom/fake persona */ }
    const dir = join(runDir, 'personas', cfg.id);
    const s = cfg.seatObj;
    const ctx = { id: cfg.id, cfg, kind: cfg.kind, seat: s, dir, rng: makeRng(seed + i), meta,
      glance: cfg.glanceSec ?? meta.glanceSec ?? scenario.director?.glanceSec ?? [10, 30],
      soulId: s.soulId ?? s.info?.soulId, identity: s.identity ?? s.ownerIdentity ?? s.info?.ownerIdentity,
      lastTurn: 0, lastChatSeen: '', requests: [], open: new Map(), reqN: 0, step: 0, lastGlanceAt: start, changedAt: -Infinity,
      cardSeen: null, lastView: null, chatChain: Promise.resolve(), directorTurns: 0, pending: 0, ratings: [], persona: null };
    if (mode === 'persona') {
      const setting = { worldName: world?.name ?? world?.slug ?? scenario.world?.slug, soulName: s.soulName ?? cfg.soulName };
      const opts = { runDir, seat: cfg.id, sheet: cfg.persona, model: cfg.personaModel ?? 'opus', setting, skillPath: world?.skillPath ?? null, clock };
      ctx.persona = personaFactory ? personaFactory({ ...opts, kind: cfg.kind, cfg }) : PersonaSession(opts);
      ctx.meta = ctx.persona.meta ?? meta;
      if (!cfg.glanceSec && ctx.persona.meta?.glanceSec) ctx.glance = ctx.persona.meta.glanceSec;
    }
    return ctx;
  }

  const cardView = async (ctx) => {
    try { return ctx.kind === 'god' ? (await ctx.seat.cardView?.()) ?? null : await owner.cardView({ base: world?.base, soulId: ctx.soulId, identity: ctx.identity }); }
    catch (e) { return { error: String(e?.message ?? e) }; }
  };
  const chatSince = async (ctx, n) => {
    const r = await ctx.seat.renderedChatSince?.(n);
    if (r == null) return { text: '', lastTurn: n };
    if (typeof r === 'string') return { text: r, lastTurn: turnCountOf(ctx.seat) ?? n };
    return { text: r.text ?? '', lastTurn: r.lastTurn ?? turnCountOf(ctx.seat) ?? n };
  };

  async function gatherShown(ctx) {
    const mono = clock.now();
    const cam = camOf(ctx);
    let screenshotPath = null, legible = null;
    if (cam) {
      const p = join(runDir, 'shots', ctx.id, `${mono}.png`);
      try { await cam.shot(p); screenshotPath = p; } catch (e) { log(ctx.id, 'shot failed', e?.message ?? e); }
      try { legible = await cam.legible(); } catch (e) { log(ctx.id, 'legible failed', e?.message ?? e); }
    }
    const view = await cardView(ctx);
    const chat = await chatSince(ctx, ctx.lastTurn);
    ctx.lastTurn = chat.lastTurn; ctx.lastChatSeen = '';
    return { elapsedSec: Math.round((mono - start) / 100) / 10, screenshotPath, legible, cardView: view, chatRendered: chat.text, lastRequests: ctx.requests.map(({ atSec, channel, text }) => ({ atSec, channel, text })) };
  }

  async function deliver(ctx, say, { quick = false, budgetSec = null, journey = false } = {}) {
    if (!live()) return { skipped: 'stopped' };
    const requestId = `${ctx.id}-${String(++ctx.reqN).padStart(3, '0')}`;
    const sentMono = clock.now(); const sentAt = new Date().toISOString();
    const turnsAtOpen = turnCountOf(ctx.seat);
    let messageId = null;
    try { ctx.seat.noteRequest?.(); } catch { /* optional: arena's per-request wake counter */ }
    try {
      if (say.channel === 'card') {
        const r = ctx.kind === 'god' ? await ctx.seat.sendGodCard({ text: say.text }) : await owner.sendCard({ base: world?.base, soulId: ctx.soulId, identity: ctx.identity, text: say.text });
        messageId = r?.messageId ?? r?.id ?? null;
      }
    } catch (e) { return { requestId, error: String(e?.message ?? e) }; }
    const atSec = Math.round((sentMono - start) / 100) / 10;
    ctx.requests.push({ atSec, channel: say.channel, text: say.text, requestId });
    const budgetMs = budgetMsFor({ scenario, quick, budgetSec, god: ctx.kind === 'god' });
    let evidence = null;
    try { evidence = await observer?.evidence?.openRequest({ runDir, seat: ctx.id, soulId: ctx.soulId, requestId, text: say.text, channel: say.channel, sentAt, messageId, budgetSec: budgetMs / 1000 }); }
    catch (e) { log(ctx.id, 'openRequest failed', e?.message ?? e); }
    const lv = ctx.lastView;
    const req = { requestId, channel: say.channel, messageId, evidence, openedAt: sentMono, budgetMs, budgetFrom: say.channel === 'chat' ? null : sentMono,
      journey, sentAt, turnsAtOpen, observedTurn: false, directorTurnsAtOpen: ctx.directorTurns, resultSigAtOpen: resultSig(lv) };
    ctx.open.set(requestId, req);
    if (say.channel === 'chat') {
      // The chat message waits for the seat's running turn (wake or earlier chat): Claude Code queues typed input until the
      // turn boundary. The budget clock starts when the turn carrying it starts; queuedSec records the wait (DESIGN §9).
      ctx.directorTurns += 1; ctx.pending += 1;
      const text = say.text;
      const onStart = (info) => chatStarted(req, info);
      ctx.chatChain = ctx.chatChain.then(() => ctx.seat.chat(text, { reason: 'chat', onStart })).then((rec) => { if (rec?.turn != null) chatStarted(req, { turn: rec.turn, afterEnd: true }); })
        .catch((e) => log(ctx.id, 'chat failed', e?.message ?? e)).finally(() => { ctx.pending -= 1; if (req.budgetFrom == null) req.budgetFrom = clock.now(); });
    }
    return { requestId, channel: say.channel, messageId };
  }

  function chatStarted(req, info) {
    if (req.turnLinked) return;
    req.turnLinked = true;
    try { req.evidence?.addChatTurn?.(info.turn); } catch { /* best effort */ }
    if (info.afterEnd) return; // the seat did not report its start: the budget ran from the turn's end
    const t = clock.now(); req.budgetFrom = t; req.queuedSec = Math.max(0, Math.round((t - req.openedAt) / 100) / 10);
    try { req.evidence?.setQueue?.({ queuedSec: req.queuedSec, budgetStartAt: new Date().toISOString() }); } catch { /* best effort */ }
  }


  // Evidence sampling for open requests: world truth (with the owner's inbox), the follow camera's legible text and a shot,
  // every observer.sampleSec while a request is open, and once on each card change (DESIGN §4.2).
  // A seat without its own follow camera (arrival timed out) is shown the wide camera: a real player still sees the page.
  const camOf = (ctx) => observer?.camera?.(ctx.id) ?? observer?.cameras?.[ctx.id] ?? observer?.camera?.('wide') ?? observer?.cameras?.wide ?? null;
  const sampleSec = scenario.observer?.sampleSec ?? 5;
  const shotsDir = join(runDir, 'shots');
  async function sampleOnce(ctx) {
    if (!ctx.open.size || ctx.kind === 'god') return;
    const cam = camOf(ctx);
    let snap = null, legible = null, shot = null;
    try { if (observer?.truth?.snapshotSoul && ctx.soulId) snap = await observer.truth.snapshotSoul({ base: world?.base, soulId: ctx.soulId, identity: ctx.identity }); } catch (e) { log(ctx.id, 'snapshot failed', e?.message ?? e); }
    if (snap && scenario.observer?.kinematics && ctx.seat.cliJson) {
      const startedAt = new Date().toISOString();
      const here = await ctx.seat.cliJson(['here']);
      // Failed/missing fields are unknown; public body fields belong to an earlier observation.
      snap = withKinematics(snap, here.ok ? here.data : null, {startedAt, endedAt:new Date().toISOString(), mono:clock.now()});
    }
    try { if (cam?.legible) legible = await cam.legible(); } catch { /* best effort */ }
    try { if (cam?.shot) { const mono = Math.round(clock.now() - start); const p = join(shotsDir, ctx.id, `${mono}.png`); mkdirSync(join(shotsDir, ctx.id), { recursive: true }); await cam.shot(p); shot = p; appendJsonl(join(shotsDir, 'index.jsonl'), { cam: ctx.id, mono, t: new Date().toISOString(), path: p }); } } catch (e) { log(ctx.id, 'shot failed', e?.message ?? e); }
    ctx.latestSample = snap;
    for (const r of ctx.open.values()) { try { r.evidence?.sample?.({ snap, legible, shot }); } catch { /* sampling is best effort */ } }
  }
  async function sampleLoop(ctx) {
    while (live()) {
      const t0 = clock.now();
      if (ctx.open.size) await sampleOnce(ctx);
      const wait = Math.max(500, sampleSec * 1000 - (clock.now() - t0));
      await clock.sleep(Math.min(wait, Math.max(1, endAt - clock.now())));
    }
  }

  async function closeReq(ctx, req, cutoffReason, extra = {}) {
    let terminal = false;
    if (req.journey) {
      await sampleOnce(ctx); // terminal body and receipts, including failures after an intermediate result
      const latest = cardMessageFor(await cardView(ctx), req.messageId);
      req.evidence?.recordCard?.(latest, new Date().toISOString());
      terminal = explicitTerminal(latest);
    }
    if(req.journey && req.budgetFrom!=null && clock.now()-req.budgetFrom>=req.budgetMs)cutoffReason='budget';
    if(req.journey && cutoffReason==='turn-complete') {
      // An async act or a new wake can start after checkOpen's previous observation.
      // The terminal refresh is authoritative; keep collecting if it found ongoing or unknown work.
      const receipts=ctx.latestSample?.receipts;
      if(ctx.seat.inTurn || ctx.pending>0 || (!terminal && (!Array.isArray(receipts) || receipts.some(r=>['accepted','waiting','started','running'].includes(r.phase)))))return;
    }
    ctx.open.delete(req.requestId);
    const rec = { t: new Date().toISOString(), mono: clock.now(), requestId: req.requestId, cutoffReason, openSec: (clock.now() - req.openedAt) / 1000, ...extra };
    appendJsonl(join(ctx.dir, 'requests.jsonl'), rec);
    try { await req.evidence?.close?.({ cutoffReason, ...(req.journey ? {cutoffAt:new Date(cutoffReason==='budget'?Date.parse(req.sentAt)+req.budgetMs:Math.min(Date.now(),Date.parse(req.sentAt)+req.budgetMs)).toISOString()} : {}) }); } catch (e) { log(ctx.id, 'evidence close failed', e?.message ?? e); }
  }

  async function checkOpen(ctx, view) {
    const now = clock.now();
    for (const req of [...ctx.open.values()]) {
      const tc = turnCountOf(ctx.seat);
      const turns = tc != null && req.turnsAtOpen != null ? tc - req.turnsAtOpen : ctx.directorTurns - req.directorTurnsAtOpen;
      const res = req.channel === 'card' ? cardResultFor(view, req.messageId) : null;
      if (req.journey) {
        req.observedTurn ||= ctx.seat.inTurn === true;
        req.evidence?.recordCard?.(cardMessageFor(view,req.messageId),new Date().toISOString());
        // A native action may write an automatic card result in the middle of a longer owner request.
        // A finished model turn is necessary; an action still running after that turn keeps the window open.
        const turnFinished = tc != null && req.turnsAtOpen != null ? tc > req.turnsAtOpen : req.observedTurn && ctx.seat.inTurn === false;
        const receipts = ctx.latestSample?.receipts;
        const actionPending = !Array.isArray(receipts) || receipts.some(r=>['accepted','waiting','started','running'].includes(r.phase));
        if (req.budgetFrom != null && now-req.budgetFrom >= req.budgetMs) await closeReq(ctx,req,'budget');
        else if (turns > maxTurns) await closeReq(ctx,req,'max-turns',{turns});
        else if (turnFinished && !ctx.seat.inTurn && ctx.pending===0 && (explicitTerminal(cardMessageFor(view,req.messageId)) || !actionPending)) await closeReq(ctx,req,'turn-complete',res??{});
        continue;
      }
      if (res) await closeReq(ctx, req, 'result', res);
      else if (req.channel === 'chat' && ctx.pending === 0 && resultSig(view) && resultSig(view) !== req.resultSigAtOpen) await closeReq(ctx, req, 'result', { via: 'card-after-chat' });
      else if (turns > maxTurns) await closeReq(ctx, req, 'max-turns', { turns });
      else if (req.budgetFrom != null && now - req.budgetFrom >= req.budgetMs) await closeReq(ctx, req, 'budget', req.queuedSec ? { queuedSec: req.queuedSec } : {});
      else if (req.budgetFrom == null && now - req.openedAt >= req.budgetMs + 2 * (rails.maxTurnWallSec ?? 240) * 1000) await closeReq(ctx, req, 'queued');
    }
  }

  async function monitor(ctx) {
    while (live()) {
      const view = await cardView(ctx);
      const sig = cardSig(view);
      if (ctx.cardSeen !== null && sig !== ctx.cardSeen) { ctx.changedAt = clock.now(); try { await sampleOnce(ctx); } catch { /* sampling is best effort */ } }
      ctx.cardSeen = sig; ctx.lastView = view;
      const chat = await chatSince(ctx, ctx.lastTurn);
      if (chat.text && chat.text !== ctx.lastChatSeen) { ctx.changedAt = clock.now(); ctx.lastChatSeen = chat.text; }
      await checkOpen(ctx, view);
      await clock.sleep(Math.max(1, Math.min(pollMs, endAt - clock.now())));
    }
  }

  function logDesires(ctx, d, extra) {
    for (const [kind, arr] of [['desire', d.desires], ['complaint', d.complaints]]) for (const text of arr ?? []) appendJsonl(join(ctx.dir, 'desires.jsonl'), { t: new Date().toISOString(), mono: clock.now(), elapsedSec: elapsedSec(), kind, text, ...extra });
  }
  function record(ctx, entry) { appendJsonl(join(ctx.dir, 'decisions.jsonl'), { t: new Date().toISOString(), mono: clock.now(), elapsedSec: elapsedSec(), seat: ctx.id, mode, ...entry }); }

  async function personaLoop(ctx) {
    await sleepUntil(start + (ctx.cfg.startOffsetSec ?? 0) * 1000);
    while (live()) {
      ctx.step += 1; ctx.lastGlanceAt = clock.now();
      const shown = await gatherShown(ctx);
      const d = await ctx.persona.step({ shown });
      logDesires(ctx, d, { step: ctx.step });
      if (d.rating) ctx.ratings.push({ elapsedSec: elapsedSec(), step: ctx.step, ...d.rating });
      const delivered = d.say && live() ? await deliver(ctx, d.say, { quick: d.quick }) : null;
      const interval = nextIntervalMs(ctx.glance, d.waitSec, ctx.rng);
      record(ctx, { step: ctx.step, decision: { say: d.say, waitSec: d.waitSec, quick: d.quick, done: d.done, parseError: !!d.parseError, thought: d.thought }, delivered, nextGlanceInSec: interval / 1000 });
      if (d.done) break;
      const minGap = ctx.glance[0] * 1000;
      await sleepUntil(clock.now() + interval, () => ctx.changedAt > ctx.lastGlanceAt && clock.now() - ctx.lastGlanceAt >= minGap);
    }
  }

  async function scriptedLoop(ctx) {
    // seat "*" is a broadcast: the same entry is delivered to every seat, each on its own record.
    const entries = (scenario.director?.script ?? []).filter((e) => (e.seat ?? null) === ctx.id || e.seat === '*').sort((a, b) => a.atSec - b.atSec);
    const sequential = scenario.director?.sequential !== false; // a person waits for the result before the next basic instruction
    for (const e of entries) {
      await sleepUntil(start + e.atSec * 1000);
      // after "result" (#888): this entry waits for the seat's own open requests to close, so direction follows results
      // instead of a fixed clock; atSec is then the earliest time it can go.
      if (sequential || e.after === 'result') { while (live() && (ctx.open.size > 0 || ctx.pending > 0)) await clock.sleep(Math.min(pollMs, Math.max(1, endAt - clock.now()))); }
      if (!live()) break;
      ctx.step += 1;
      if (e.setup) {
        const setup = await runFixtureSetup({ seat: ctx.seat, setup: e.setup, runDir, requestKey: e.id ?? `${ctx.id}-${ctx.step}` });
        if (!setup.ok) {
          appendJsonl(join(runDir, 'infrastructure-invalid.jsonl'), { requestKey: e.id ?? `${ctx.id}-${ctx.step}`, text: e.text, reason: setup.error });
          continue;
        }
      }
      // #1138: a card with `restart` reaches a Soul whose resident client has just restarted, in a new chat: only what it wrote down carries over.
      if (e.restart) {
        try { await ctx.seat.restart?.(); }
        catch (err) { appendJsonl(join(runDir, 'infrastructure-invalid.jsonl'), { requestKey: e.id ?? `${ctx.id}-${ctx.step}`, text: e.text, reason: err.message }); continue; }
      }
      const shown = await gatherShown(ctx);
      saveShown(ctx, shown);
      const delivered = await deliver(ctx, { channel: e.channel ?? 'card', text: e.text }, { budgetSec: e.budgetSec ?? null, journey: !!e.expect?.journey });
      record(ctx, { step: ctx.step, scripted: { atSec: e.atSec, ...(e.after ? { after: e.after } : {}), channel: e.channel, text: e.text, budgetSec: e.budgetSec ?? null, ...(e.seat === '*' ? { broadcast: true } : {}) }, delivered });
    }
  }

  async function quotaLoop() {
    let next = clock.now() + 300000;
    while (live()) {
      await sleepUntil(next);
      if (!live()) break;
      next += 300000;
      try { const q = await quotaFn(); if (q && q.allowed === false) stop(`quota: ${q.note ?? ''}`.trim()); } catch (e) { log('quota check failed', e?.message ?? e); }
    }
  }

  const loops = ctxs.map((c) => (mode === 'scripted' ? scriptedLoop(c) : personaLoop(c)).catch((e) => { log(c.id, 'loop error', e?.stack ?? e); }));
  const background = [...ctxs.map((c) => monitor(c).catch((e) => log(c.id, 'monitor error', e?.message ?? e))), ...ctxs.map((c) => sampleLoop(c).catch((e) => log(c.id, 'sampler error', e?.message ?? e))), quotaLoop()];
  await Promise.all(loops);
  if (!state.stopped) {
    if (mode === 'scripted') await sleepUntil(endAt, () => ctxs.every((c) => c.open.size === 0)); // let open requests resolve
    stop(clock.now() >= endAt ? 'duration' : (mode === 'scripted' ? 'script-complete' : 'all-done'));
  }
  await Promise.all(background);
  const reason = state.stopped.startsWith('quota') ? 'quota' : 'run-end';
  for (const c of ctxs) { if (c.open.size) { try { await sampleOnce(c); } catch { /* best effort */ } } for (const r of [...c.open.values()]) await closeReq(c, r, reason); }
  const summary = { stoppedBy: state.stopped, elapsedSec: elapsedSec(), mode, seats: {} };
  for (const c of ctxs) {
    let final = null;
    if (c.persona && !state.stopped.startsWith('quota')) { try { final = await c.persona.finalRating(); } catch (e) { log(c.id, 'final rating failed', e?.message ?? e); } }
    if (final) logDesires(c, final, { final: true });
    if (c.persona) writeJson(join(c.dir, 'ratings.json'), { seat: c.id, persona: c.cfg.persona, steps: c.ratings, final: final?.rating ?? null });
    summary.seats[c.id] = { steps: c.step, requests: c.requests.length, pendingChatTurns: c.pending };
  }
  return summary;

  function saveShown(ctx, shown) {
    // Scripted mode keeps the same record a persona would have seen (no model call).
    const n = ctx.step; const dir = join(ctx.dir, 'shown');
    let png = null;
    if (shown.screenshotPath) { png = join(dir, `${n}.png`); try { copyPng(shown.screenshotPath, png); } catch { png = null; } }
    writeJson(join(dir, `${n}.json`), { ...shown, sourceScreenshotPath: shown.screenshotPath, screenshotPath: png });
  }
}

function copyPng(from, to) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
