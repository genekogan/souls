// The swarm orchestrator: one director above N seats. It owns the brief, sends each Soul's directions through the real
// owner card channel, gates turn-taking on world truth (everyone present in the room, the previous speaker finished),
// sends the next speaker a "prepare" direction while the current one talks, nudges stragglers and never-paired seats,
// and logs every direction with its reason. It never builds and never relays one seat's words to another: Souls hear
// each other only through world speech.
//
// createSwarm(opts) → {submit(line), paired(id), onboardFailed(id), state, run() → summary}
// Run folder outputs: director/{directions,timeline,speech,presence}.jsonl, director/state.json,
// personas/<seat>/turns.jsonl + shown/<n>.{json,png} (the director's view, read by review/story.mjs),
// evidence/<seat>-NNN.json (one pack per card direction, via observer/evidence.mjs).
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appendJsonl, writeJson } from '../../lib/jsonl.mjs';
import { monoMs, sleep as realSleep } from '../../lib/clock.mjs';
import { cardResultFor } from '../director.mjs';
import { economyOf } from './cast.mjs';
import { NUDGE, withEconomy, withHold } from './planner.mjs';
import { inRoom } from './truth.mjs';
import { parseLine, scriptFeeder } from './console.mjs';

const realClock = { now: monoMs, sleep: realSleep };
const clip = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const infoOf = (s) => (typeof s?.info === 'function' ? s.info() : s?.info ?? {});

export function createSwarm({ cast, runDir, seats, world, owner, truth, plan, clock = realClock, observer = null, script = null, print = () => {}, quotaCheck = null, log = () => {}, wall0 = Date.now(), requestBudgetSec = 300 }) {
  const T = cast.timing;
  const start = clock.now();
  const elapsed = () => (clock.now() - start) / 1000;
  const wallMs = () => wall0 + (clock.now() - start);
  const iso = () => new Date(wallMs()).toISOString();
  const dir = join(runDir, 'director');
  mkdirSync(dir, { recursive: true });
  const feeder = scriptFeeder(script ?? cast.console?.script ?? []);
  // #1098: `console.clockFrom: "paired"` starts the cast clock (console offsets and durationSec) once every seat is paired
  // and the director has its first world observation of it (or the seat was dropped), so a live seat's onboarding can't
  // swallow the script's first lines. Without it the clock starts at the swarm's start, as before.
  let castStart = cast.console?.clockFrom === 'paired' ? null : start;
  const castElapsed = () => (castStart == null ? -1 : (clock.now() - castStart) / 1000);
  const events = new Set();
  const inbox = [];
  const state = { phase: 'gather', speakerIdx: 0, paused: false, stopped: null, gateOpenedAt: null, gateReason: null, directions: 0, redirects: [], startedAt: iso() };

  const S = {};
  for (const c of cast.seats) {
    const seat = seats[c.id] ?? null;
    const info = infoOf(seat);
    S[c.id] = { id: c.id, cfg: c, seat, economy: c.economy, pairing: info.soulId ? 'paired' : seat?.onboarding ? 'onboarding' : 'unpaired',
      present: false, everPresent: false, speech: [], seen: new Set(), reqN: 0, viewN: 0, open: new Map(), nudges: { gather: 0, left: 0, speak: 0, onboard: 0 },
      lastDirAt: null, lastStatusAt: null, override: null, goAt: null, goMsg: null, prepAt: null, firstSpeechAt: null, lastSpeechAt: null, done: null, gathered: false, camChain: Promise.resolve() };
  }
  const soulOf = (st) => infoOf(st.seat).soulId ?? null;
  const identityOf = (st) => infoOf(st.seat).ownerIdentity ?? infoOf(st.seat).identity ?? null;
  const inScene = (x) => x.pairing === 'paired' && !['absent', 'never-paired'].includes(x.done);

  function timeline(kind, data = {}, line = null) {
    const rec = { t: iso(), mono: clock.now(), elapsedSec: Math.round(elapsed() * 10) / 10, kind, phase: state.phase, ...data };
    appendJsonl(join(dir, 'timeline.jsonl'), rec);
    if (line) print(`[${mmss(elapsed())}] ${line}`);
    return rec;
  }
  const fire = (key) => { events.add(key); };

  // ---- camera work is serialized per seat (one page each); never blocks the plan loop
  const camOf = (id) => observer?.cameras?.[id] ?? null;
  function camOp(st, fn) { const p = st.camChain.then(fn).catch((e) => log(`${st.id} camera: ${e?.message ?? e}`)); st.camChain = p; return p; }

  function directorView(st, n, rec) {
    // The director's view of the moment, in the shape a persona turn has, so review/story.mjs shows it as a moment.
    const pdir = join(runDir, 'personas', st.id);
    appendJsonl(join(pdir, 'turns.jsonl'), { n, kind: 'step', t: rec.t, mono: rec.mono, elapsedSec: rec.elapsedSec, by: rec.by, directionKind: rec.kind,
      decision: { say: rec.channel === 'none' ? null : { channel: rec.channel, text: rec.text }, thought: `${rec.by === 'console' ? 'console' : 'director'}: ${rec.reason}`, waitSec: null }, requestId: rec.requestId ?? null });
    const cam = camOf(st.id);
    if (!cam) { writeJson(join(pdir, 'shown', `${n}.json`), { elapsedSec: rec.elapsedSec, legible: null, direction: rec }); return; }
    camOp(st, async () => {
      let legible = null; const png = join(pdir, 'shown', `${n}.png`);
      mkdirSync(join(pdir, 'shown'), { recursive: true });
      try { await cam.shot(png); } catch (e) { log(`${st.id} view shot: ${e?.message ?? e}`); }
      try { legible = await cam.legible?.(); } catch { /* best effort */ }
      writeJson(join(pdir, 'shown', `${n}.json`), { elapsedSec: rec.elapsedSec, legible, direction: rec, screenshotPath: png });
    });
  }

  /** Send one direction. channel 'card' (owner inbox), 'chat' (the owner's terminal: onboarding only), 'none' (log only). */
  // Before a seat's own turn every composed direction carries the hold guard; Gene's verbatim console lines do not.
  const beforeTurn = (st) => !st.goAt && !st.done && cast.order.includes(st.id);
  async function direct(st, kind, text, reason, { by = 'director', channel = 'card', economy = true, hold = channel === 'card' && kind !== 'go' && kind !== 'console' } = {}) {
    const lvl = economyOf(cast, st.economy);
    const held = hold && beforeTurn(st) ? withHold(text) : text;
    const body = channel === 'card' && economy ? withEconomy(cast, st.economy, held) : held;
    const n = ++state.directions;
    const rec = { t: iso(), mono: clock.now(), elapsedSec: Math.round(elapsed() * 10) / 10, n, seat: st.id, kind, by, channel, text: body, reason, phase: state.phase,
      speaker: cast.order[state.speakerIdx] ?? null, economy: st.economy, messageId: null, requestId: null };
    try {
      if (channel === 'card') {
        if (st.pairing !== 'paired') throw new Error('seat not paired');
        if (st.seat?.rails) { st.seat.rails.maxTurnsPerRequest = lvl.maxTurnsPerDirection; st.seat.rails.maxTurnWallSec = lvl.maxTurnWallSec; }
        try { st.seat?.noteRequest?.(); } catch { /* optional */ }
        const r = await owner.sendCard({ base: world.base, soulId: soulOf(st), identity: identityOf(st), text: body });
        rec.messageId = r?.messageId ?? null;
        rec.requestId = `${st.id}-${String(++st.reqN).padStart(3, '0')}`;
        openEvidence(st, rec);
      } else if (channel === 'chat') {
        st.seat.chat(body, { reason: 'chat' }).catch((e) => log(`${st.id} chat: ${e?.message ?? e}`));
      }
    } catch (e) { rec.error = String(e?.message ?? e); }
    st.lastDirAt = clock.now();
    appendJsonl(join(dir, 'directions.jsonl'), rec);
    timeline('direction', { seat: st.id, n, direction: kind, by, channel, reason, requestId: rec.requestId, error: rec.error ?? null }, `${st.id.padEnd(8)} ← ${kind}${by === 'console' ? ' (console)' : ''}: ${clip(text, 110)}  [${reason}]${rec.error ? ` ERROR ${rec.error}` : ''}`);
    if (channel !== 'none') directorView(st, ++st.viewN, rec);
    return rec;
  }

  // ---- evidence: one pack per card direction, closed on its card result, the next direction, budget or run end
  function openEvidence(st, rec) {
    for (const r of [...st.open.values()]) closeEvidence(st, r, 'next-direction');
    let ev = null;
    try { ev = observer?.evidence?.openRequest({ runDir, seat: st.id, soulId: soulOf(st), requestId: rec.requestId, text: rec.text, channel: 'card', sentAt: rec.t, messageId: rec.messageId, budgetSec: requestBudgetSec }); }
    catch (e) { log(`${st.id} openRequest: ${e?.message ?? e}`); }
    st.open.set(rec.requestId, { requestId: rec.requestId, messageId: rec.messageId, openedAt: clock.now(), ev });
  }
  function closeEvidence(st, r, cutoffReason) {
    st.open.delete(r.requestId);
    appendJsonl(join(runDir, 'personas', st.id, 'requests.jsonl'), { t: iso(), mono: clock.now(), requestId: r.requestId, cutoffReason, openSec: (clock.now() - r.openedAt) / 1000 });
    try { r.ev?.close?.({ cutoffReason }); } catch (e) { log(`${st.id} evidence close: ${e?.message ?? e}`); }
  }
  async function sampleSeat(st) {
    if (!st.open.size) return;
    let snap = null;
    try { if (observer?.truth?.snapshotSoul) snap = await observer.truth.snapshotSoul({ base: world.base, soulId: soulOf(st), identity: identityOf(st) }); } catch (e) { log(`${st.id} snapshot: ${e?.message ?? e}`); }
    const cam = camOf(st.id);
    let legible = null, shot = null;
    if (cam) await camOp(st, async () => {
      try { legible = await cam.legible?.(); } catch { /* best effort */ }
      try { const mono = Math.round(clock.now() - start); const p = join(runDir, 'shots', st.id, `${mono}.png`); mkdirSync(join(runDir, 'shots', st.id), { recursive: true }); await cam.shot(p); shot = p; appendJsonl(join(runDir, 'shots', 'index.jsonl'), { cam: st.id, mono, t: iso(), path: p }); } catch (e) { log(`${st.id} shot: ${e?.message ?? e}`); }
    });
    for (const r of [...st.open.values()]) {
      try { r.ev?.sample?.({ snap, legible, shot }); } catch { /* best effort */ }
      const res = snap?.inbox ? cardResultFor(snap.inbox, r.messageId) : null;
      if (res) closeEvidence(st, r, 'result');
      else if (clock.now() - r.openedAt >= requestBudgetSec * 1000) closeEvidence(st, r, 'budget');
    }
  }
  async function sampleLoop(st) { while (!state.stopped) { const t0 = clock.now(); await sampleSeat(st); await clock.sleep(Math.max(500, (cast.observer?.sampleSec ?? 15) * 1000 - (clock.now() - t0))); } }
  async function wideLoop() {
    // The wide camera opens in the background (arrival can take minutes on software GL): wait for it, then sample.
    if (!observer) return;
    while (!state.stopped) {
      const t0 = clock.now(); const cam = camOf('wide');
      if (!cam) { await clock.sleep(5000); continue; }
      try { const mono = Math.round(clock.now() - start); const p = join(runDir, 'shots', 'wide', `${mono}.png`); mkdirSync(join(runDir, 'shots', 'wide'), { recursive: true }); await cam.shot(p); appendJsonl(join(runDir, 'shots', 'index.jsonl'), { cam: 'wide', mono, t: iso(), path: p }); } catch (e) { log(`wide shot: ${e?.message ?? e}`); }
      await clock.sleep(Math.max(500, (cast.observer?.sampleSec ?? 15) * 1000 - (clock.now() - t0)));
    }
  }

  // ---- world truth
  async function poll() {
    await Promise.all(Object.values(S).filter((st) => st.pairing === 'paired' && soulOf(st)).map(async (st) => {
      const tr = await truth.soul(soulOf(st));
      if (!tr?.ok) return;
      st.lastTruth = tr;
      const now = inRoom(tr.placePath, cast.room);
      if (now !== st.present) {
        st.present = now; if (now) st.everPresent = true;
        appendJsonl(join(dir, 'presence.jsonl'), { t: iso(), mono: clock.now(), seat: st.id, present: now, placePath: tr.placePath, posture: tr.posture, pos: tr.pos ?? null });
        timeline('presence', { seat: st.id, present: now, placePath: tr.placePath }, `${st.id.padEnd(8)} ${now ? 'is in' : 'left'} ${cast.room.label} (${tr.placePath.slice(0, 2).join(' / ') || '?'})`);
      }
      for (const sp of tr.speech) {
        const k = `${sp.atMs}|${sp.text}`; if (st.seen.has(k)) continue; st.seen.add(k);
        const rec = { seat: st.id, atMs: sp.atMs, at: sp.atMs ? new Date(sp.atMs).toISOString() : null, tick: sp.tick, text: sp.text, channel: sp.channel, present: st.present, pos: sp.pos ?? tr.pos ?? null, posSource: sp.posSource ?? tr.posSource ?? null, speaker: cast.order[state.speakerIdx] ?? null, phase: state.phase };
        st.speech.push(rec);
        appendJsonl(join(dir, 'speech.jsonl'), { t: iso(), mono: clock.now(), ...rec });
        timeline('speech', { seat: st.id, text: sp.text, atMs: sp.atMs }, `${st.id.padEnd(8)} says: "${clip(sp.text, 120)}"`);
      }
    }));
  }

  // ---- console
  function submit(line) { inbox.push({ line, at: elapsed() }); }
  // The direction journal (director/commands.jsonl): one record per console command (typed, scripted or from the
  // lifecycle) with its target, timing, outcome and the cards it sent. outcome: applied | held (a redirect kept for the
  // seat's turn but not delivered now) | refused (no effect, with the reason).
  // The journal is evidence about the run, never a reason to stop it: a write failure (disk full, permissions) warns
  // once and the command still takes effect, and a lifecycle end still stops the run.
  let journalWarned = false;
  function journal(rec) {
    const out = { t: iso(), mono: clock.now(), elapsedSec: Math.round(elapsed() * 10) / 10, phase: state.phase, ...rec };
    try {
      appendJsonl(join(dir, 'commands.jsonl'), out);
      if (out.outcome !== 'applied') timeline('command', { cmd: out.cmd, source: out.source, outcome: out.outcome, reason: out.reason ?? null }, `command ${out.cmd} ${out.outcome}${out.reason ? `: ${out.reason}` : ''}`);
    } catch (e) {
      if (!journalWarned) { journalWarned = true; print(`[${mmss(elapsed())}] warning: direction journal not written (${String(e?.message ?? e).split('\n')[0]}); the run goes on`); }
    }
    return out;
  }
  async function handle({ line, expect = null, scripted = false }) {
    const p = parseLine(line, { seats: cast.seats });
    timeline('console', { line, cmd: p.cmd, scripted }, `console> ${line}`);
    if (p.cmd === 'noop') return;
    const j = { target: p.seat ?? null, requestIds: [], errors: [], outcome: 'applied', reason: null };
    const send = async (st, ...args) => { const r = await direct(st, ...args); if (r.requestId) j.requestIds.push(r.requestId); if (r.error) j.errors.push(`${st.id}: ${r.error}`); return r; };
    await command(p, { expect, j, send });
    journal({ source: scripted ? 'script' : 'console', line: String(line), cmd: p.cmd, target: j.target, outcome: j.outcome, ...(j.reason ? { reason: j.reason } : {}), requestIds: j.requestIds, ...(j.errors.length ? { errors: j.errors } : {}), ...(expect ? { expect } : {}) });
  }
  async function command(p, { expect, j, send }) {
    const by = 'console';
    const refuse = (reason) => { j.outcome = 'refused'; j.reason = reason; };
    if (p.cmd === 'pause') { j.target = 'all'; state.paused = true; return; }
    if (p.cmd === 'resume') { j.target = 'all'; state.paused = false; return; }
    if (p.cmd === 'end') { j.target = 'all'; stop('console-end'); return; }
    if (p.cmd === 'status') { print(statusLine()); return; }
    if (p.cmd === 'error') { print(`console: ${p.error}`); refuse(p.error); return; }
    if (p.cmd === 'broadcast') {
      j.target = 'all';
      const paired = Object.values(S).filter((st) => st.pairing === 'paired');
      for (const st of paired) await send(st, 'console', p.text, 'typed to everyone at the console', { by, economy: false });
      if (!paired.length) refuse('no paired seat');
      else if (!j.requestIds.length) refuse('no card delivered');
      return;
    }
    if (p.cmd === 'say') { await send(S[p.seat], 'console', p.text, 'typed to this seat at the console', { by, economy: false }); if (!j.requestIds.length) refuse(j.errors[0]?.replace(/^[^:]+: /, '') ?? 'no card delivered'); return; }
    if (p.cmd === 'economy') {
      j.target = p.seat ?? 'all';
      for (const st of p.seat ? [S[p.seat]] : Object.values(S)) { if (!cast.economy[p.level]) { print(`console: unknown economy ${p.level}`); refuse(`unknown economy ${p.level}`); return; } st.economy = p.level; await send(st, 'economy', `token economy → ${p.level}`, 'console set the token economy', { by, channel: 'none' }); }
      return;
    }
    if (p.cmd === 'redirect') {
      const st = S[p.seat]; st.override = p.text;
      // Before its turn the redirect is held and folded into its "your turn" direction (NUDGE.goOverride); during its turn it applies now.
      const rec = await send(st, 'redirect', NUDGE.redirect(st.cfg, p.text, !st.goAt), st.goAt ? 'redirect during its turn' : 'redirect before its turn: held, folded into its turn direction', { by, economy: false });
      state.redirects.push({ seat: st.id, text: p.text, t: rec.t, atMs: wallMs(), expect: expect ?? null, beforeTurn: !st.goAt, requestId: rec.requestId });
      // Not delivered now (the seat is not paired yet): the override still replaces its talk when its turn comes.
      if (!rec.requestId) { j.outcome = 'held'; j.reason = `card not delivered (${rec.error ?? 'no request'}); kept for its turn`; }
      fire(`redirect:${st.id}`);
    }
  }

  function statusLine() {
    const sp = cast.order[state.speakerIdx];
    return `status: phase ${state.phase}${state.paused ? ' (paused)' : ''} · speaker ${sp ?? '-'} · ` + cast.order.map((id) => { const st = S[id]; return `${id}:${st.pairing === 'paired' ? (st.present ? 'in' : 'out') : st.pairing}${st.done ? `/${st.done}` : ''}`; }).join(' ');
  }
  function stop(why) { if (!state.stopped) { state.stopped = why; timeline('stop', { why }, `stop: ${why}`); } }

  // ---- the plan
  const lastFor = (st) => st.lastDirAt ?? -Infinity;
  const due = (st, sec) => clock.now() - lastFor(st) >= sec * 1000;

  async function stepGather() {
    for (const id of cast.order) {
      const st = S[id];
      if (st.pairing === 'paired' && !st.gathered) { st.gathered = true; await direct(st, 'gather', plan.seats[id].gather, 'opening direction: who you are, the plan, go to the room'); continue; }
      if (st.pairing === 'paired' && !st.present && due(st, T.nudgeAfterSec) && st.nudges.gather < T.maxNudges) { st.nudges.gather += 1; await direct(st, 'nudge', NUDGE.gather(cast, st.cfg), `straggler: not in ${cast.room.label} ${Math.round((clock.now() - lastFor(st)) / 1000)} s after the last direction (nudge ${st.nudges.gather}/${T.maxNudges})`); }
      if (st.pairing === 'unpaired') await nudgeOnboarding(st);
    }
    const want = cast.order.map((id) => S[id]);
    const allIn = want.every((st) => st.pairing === 'paired' && st.present);
    const timedOut = elapsed() >= T.gatherMaxSec;
    if (allIn || timedOut) {
      for (const st of want) if (!(st.pairing === 'paired' && st.everPresent) && timedOut) { st.done = st.pairing === 'paired' ? 'absent' : 'never-paired'; timeline('drop', { seat: st.id, why: st.done }, `${st.id.padEnd(8)} dropped from the order (${st.done})`); }
      state.phase = 'turns'; state.gateOpenedAt = iso(); state.gateReason = allIn ? 'all-present' : 'gather-timeout';
      timeline('gate', { gate: 'everyone-present', reason: state.gateReason, present: want.filter((s) => s.present).map((s) => s.id) }, `gate: ${allIn ? 'everyone is in' : 'gather timed out; going on with'} ${cast.room.label} (${want.filter((s) => s.present).length}/${want.length})`);
      fire('phase:turns');
    }
  }

  async function nudgeOnboarding(st) {
    if (!st.seat?.status || !due(st, T.nudgeAfterSec)) return;
    const s = await st.seat.status().catch(() => null);
    if (s?.ok && s.data?.paired && s.data?.soul?.id) { markPaired(st, s.data.soul); return; }
    if (st.nudges.onboard >= T.maxNudges) { st.lastDirAt = clock.now(); return; }
    st.nudges.onboard += 1;
    await direct(st, 'onboard-nudge', NUDGE.onboard(world.base, st.cfg), `never paired: status shows paired ${s?.data?.paired ?? 'unknown'} (nudge ${st.nudges.onboard}/${T.maxNudges})`, { channel: 'chat', economy: false });
  }
  function markPaired(st, soul = null) {
    const info = infoOf(st.seat);
    if (soul?.id && !info.soulId) { info.soulId = soul.id; try { st.seat.save?.(); } catch { /* optional */ } }
    st.pairing = 'paired';
    timeline('paired', { seat: st.id, soulId: infoOf(st.seat).soulId }, `${st.id.padEnd(8)} paired`);
    try { st.seat.wakeLoop?.(); } catch { /* optional */ }
    try { onPaired?.(st.id); } catch { /* optional */ }
  }
  let onPaired = null;

  async function stepTurns() {
    while (state.speakerIdx < cast.order.length && S[cast.order[state.speakerIdx]].done && S[cast.order[state.speakerIdx]].done !== 'speaking') state.speakerIdx += 1;
    if (state.speakerIdx >= cast.order.length) { state.phase = 'done'; fire('phase:done'); timeline('phase', { phase: 'done' }, 'all talks given'); stop('plan-complete'); return; }
    const st = S[cast.order[state.speakerIdx]];
    const room = cast.order.map((id) => S[id]).filter(inScene);
    if (!st.goAt) {
      const away = room.filter((x) => !x.present);
      for (const x of away) if (due(x, T.nudgeAfterSec) && x.nudges.left < T.maxNudges) { x.nudges.left += 1; await direct(x, 'nudge', NUDGE.left(cast, x.cfg), `not in ${cast.room.label} before ${st.id}'s turn (nudge ${x.nudges.left}/${T.maxNudges})`); }
      st.readyAt ??= clock.now();
      if (away.length && clock.now() - st.readyAt < T.presentWaitSec * 1000) return;
      const text = st.override ? NUDGE.goOverride(cast, st.cfg, st.override) : plan.seats[st.id].go;
      const why = state.speakerIdx === 0 ? 'everyone is present: first talk' : `${cast.order[state.speakerIdx - 1]} finished`;
      const rec = await direct(st, 'go', text, `${why}${away.length ? ` (still away: ${away.map((x) => x.id).join(', ')})` : ''}${st.override ? '; talk redirected at the console' : ''}`);
      st.goAt = clock.now(); st.goWall = wallMs(); st.goMsg = rec.messageId; st.done = 'speaking';
      fire(`go:${st.id}`);
      const next = cast.order.slice(state.speakerIdx + 1).map((id) => S[id]).find((x) => !x.done && x.pairing === 'paired');
      if (T.prepareAhead && next && !next.prepAt) { next.prepAt = clock.now(); await direct(next, 'prepare', plan.seats[next.id].prepare, `${st.id} has started: prepare ahead to hide the turn latency`); fire(`prepare:${next.id}`); }
      return;
    }
    const mine = st.speech.filter((x) => x.atMs != null && x.atMs >= st.goWall - 2000);
    if (mine.length) {
      st.firstSpeechAt ??= clock.now();
      const lastWall = Math.max(...mine.map((x) => x.atMs));
      let result = null;
      try { result = st.goMsg ? cardResultFor(await owner.cardView({ base: world.base, soulId: soulOf(st), identity: identityOf(st) }), st.goMsg) : null; } catch { /* the quiet rule decides */ }
      const quiet = wallMs() - lastWall >= T.quietSec * 1000;
      if (result || quiet) {
        st.done = 'presented'; state.speakerIdx += 1;
        timeline('turn-done', { seat: st.id, by: result ? 'card-result' : 'quiet', speeches: mine.length }, `${st.id.padEnd(8)} finished (${result ? 'card result' : `${T.quietSec} s quiet`}, ${mine.length} line${mine.length > 1 ? 's' : ''})`);
        fire(`done:${st.id}`);
      }
      return;
    }
    const since = clock.now() - (st.lastSpeakNudgeAt ?? st.goAt);
    if (since >= T.speakTimeoutSec * 1000) {
      if (st.nudges.speak < T.maxSpeakNudges) { st.nudges.speak += 1; st.lastSpeakNudgeAt = clock.now(); const rec = await direct(st, 'nudge', NUDGE.speak(cast, st.cfg), `silent ${Math.round(since / 1000)} s after its turn began (nudge ${st.nudges.speak}/${T.maxSpeakNudges})`); st.goMsg = rec.messageId ?? st.goMsg; }
      else { st.done = 'silent'; state.speakerIdx += 1; timeline('drop', { seat: st.id, why: 'silent' }, `${st.id.padEnd(8)} skipped: never spoke after its turn began`); fire(`done:${st.id}`); }
    }
  }

  async function run() {
    timeline('start', { cast: cast.name, order: cast.order, room: cast.room, planSource: plan.source }, `swarm ${cast.name}: ${cast.order.length} seats, room ${cast.room.label}, plan from ${plan.source}`);
    const bg = [...Object.values(S).map((st) => sampleLoop(st).catch((e) => log(`${st.id} sampler: ${e?.message ?? e}`))), wideLoop().catch((e) => log(`wide: ${e?.message ?? e}`))];
    let nextQuota = clock.now() + 300000;
    while (!state.stopped) {
      const t0 = clock.now();
      await poll().catch((e) => log(`poll: ${e?.message ?? e}`));
      if (castStart == null && Object.values(S).every((st) => (st.pairing === 'paired' && st.lastTruth) || ['never-paired', 'absent'].includes(st.done))) {
        castStart = clock.now(); timeline('cast-clock', { afterSec: elapsed(), seats: Object.values(S).map((st) => ({ seat: st.id, pairing: st.pairing, done: st.done ?? null })) }, `cast clock starts ${elapsed().toFixed(1)} s in: every seat paired and observed`);
      }
      for (const e of feeder.due({ elapsedSec: castElapsed(), events })) await handle({ line: e.line, expect: e.expect ?? null, scripted: true });
      while (inbox.length) await handle(inbox.shift());
      if (state.stopped) break;
      if (!state.paused) { if (state.phase === 'gather') await stepGather(); else if (state.phase === 'turns') await stepTurns(); }
      if (castElapsed() >= cast.durationSec) stop('duration');
      // #1098: a live seat's turn refused by the world budget ends the scene; nothing is asked of a model past the cap
      const broke = Object.values(S).find((st) => st.seat?.budgetRefused);
      if (broke) { timeline('budget', { seat: broke.id, reason: broke.seat.budgetRefused }, `${broke.id.padEnd(8)} turn refused: ${broke.seat.budgetRefused}`); stop('world-budget'); }
      if (quotaCheck && clock.now() >= nextQuota) { nextQuota += 300000; try { const q = await quotaCheck(); if (q === false || q?.allowed === false) stop('quota'); } catch { /* keep going */ } }
      writeJson(join(dir, 'state.json'), snapshot());
      if (!state.stopped) await clock.sleep(Math.max(200, T.truthPollSec * 1000 - (clock.now() - t0)));
    }
    await poll().catch(() => {});
    await Promise.all(bg);
    for (const st of Object.values(S)) { await st.camChain; for (const r of [...st.open.values()]) { await sampleSeat(st).catch(() => {}); if (st.open.has(r.requestId)) closeEvidence(st, r, 'run-end'); } }
    const out = snapshot();
    writeJson(join(dir, 'state.json'), out);
    return out;
  }

  function snapshot() {
    return { ...state, endedAt: state.stopped ? iso() : null, elapsedSec: Math.round(elapsed()), scriptLeft: feeder.left,
      seats: Object.fromEntries(Object.values(S).map((st) => [st.id, { pairing: st.pairing, present: st.present, everPresent: st.everPresent, done: st.done, economy: st.economy, nudges: st.nudges, speeches: st.speech.length, directions: st.reqN, override: st.override }])) };
  }

  return {
    state, seats: S, submit, run, statusLine,
    /** end(why): stop from outside the console (a Soul Run cancel); the loop closes as after `end`. */
    end: (why = 'external-end', source = 'lifecycle') => { if (!state.stopped) journal({ source, line: null, cmd: 'end', target: 'all', outcome: 'applied', reason: why, requestIds: [] }); stop(why); },
    paired: (id, soul = null) => { const st = S[id]; if (st && st.pairing !== 'paired') markPaired(st, soul); },
    onboardFailed: (id) => { const st = S[id]; if (st && st.pairing === 'onboarding') { st.pairing = 'unpaired'; st.lastDirAt = null; timeline('unpaired', { seat: id }, `${id.padEnd(8)} onboarding ended unpaired`); } },
    onPaired: (fn) => { onPaired = fn; },
  };
}
