// The controllability scorecard (#1097, direction of #623, 6 November 2026): M1-M7 and guardrails G1-G3 for one finished
// run, computed offline from what the run retained: the seat's own log (transcript, turns, listen), the world's answers
// to its CLI calls, and the observer's evidence packs when present. It reads any Soul Run or playtest folder, whichever
// director ran it, so the owner messages come from the seat's side, not from the director's records.
// Unknown is never zero: every metric carries its denominator and a count of what could not be read. This file holds the
// definitions and the refusal table, so its hash (recorded in the effective spec, see spec.mjs) predeclares them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonl } from '../lib/jsonl.mjs';

export const SCORER = Object.freeze({ id: 'controllability', version: '2', path: 'tools/playtest/runs/controllability.mjs' });
export const SCORECARD_SCHEMA = 'soul-run-scorecard/1';

// ---- refusal classes (#1097 A2, #628). Only `offer` counts against M1.
const ADMISSION = new Set(['world.busy', 'world.crowded', 'world.starting', 'world.unavailable', 'soul.busy', 'soul.slow-down', 'rate-limited', 'client.rate', 'account.rate', 'budget.world', 'request.budget', 'lifecycle-pending']);
// The world could not read the command: the agent's words or parameters named nothing it offers.
const RESOLUTION = new Set(['params.invalid', 'place.unknown', 'place.ambiguous', 'place.root', 'place.position-unknown', 'soul.unknown', 'soul.name-ambiguous', 'steer.unknown-place', 'steer.params', 'ride.steer-params', 'body.ref-unknown', 'body.ref-unsupported', 'body.unsupported', 'object.action-unknown', 'shared.unknown-op', 'recipient.invalid', 'rps.choose', 'slot.unknown', 'content.book-unknown', 'content.text-required', 'conversation.unknown', 'entity.unknown', 'actor.unknown', 'control.unknown', 'game.which-board', 'gesture.policy-unsupported',
  // Words sent to the strict act (#1093): the same mistake as capability.unknown on the words contract, so it scores the same.
  'act.not-an-id',
  // The words asked for a seat, water or a target the world does not have there; the answer offers the alternatives. seat.none-near
  // also covers "no free seat near", which is a judgement: a seat's being taken has its own code, seat.none-free.
  'seat.none-in-place', 'seat.none-near', 'target.not-in-sight', 'swim.not-swimmable', 'swim.unavailable',
  // Engine codes that reach an act's answer through canPerform (ledger launch): the steps the world compiled from the command.
  'target.unknown', 'action.invalid-params', 'action.unknown-verb', 'gait.invalid', 'body.motion-unavailable']);
// The world named or accepted the place and then found no way there. Not a state change unless the world moved, and the
// world's own offer is what failed, so it counts against M1 under its own label (the #874 geometry sample folds in here).
const ROUTE = new Set(['place.unreachable', 'route.unreachable', 'travel.unreachable', 'place.unwalkable', 'place.unsupported-floor', 'place.no-standing-room', 'room.no-standing-room', 'carry.no-route', 'carry.search-exhausted', 'use.no-approach', 'object.out-of-reach', 'tea.cup-unreachable',
  // Engine codes on the same path. Those that only end a started receipt (route.blocked, route.occupied, action.failed,
  // actor.busy, walk.goal-occupied) are not answers to an act, so they are not here; WAIT_CODES hold the act and never refuse it.
  'route.goal-blocked', 'route.link-unusable', 'route.unknown-level', 'route.region-geometry-invalid', 'route.start-blocked', 'body.no-clearance', 'use.transition-blocked',
  // A fixed fact about this seat and this body, not something that moved. seat.out-of-reach is #1087's replacement for seat.too-high.
  'seat.too-high', 'seat.out-of-reach', 'seat.inside']);
// The world's state answering: a seat taken, a ride gone, hands full, a game in progress. Listed one by one on purpose, so a
// new code is unclassified and named on the card until someone decides. Left out for that reason: carry.crew-too-small,
// carry.crew-too-large, carry.too-tall and carry.ground-only, which an agent could read before asking.
const STATE = new Set(`action.interrupted activity.not-reached bed.attachment-unavailable bed.native-berth-required bed.taken bed.yours bike.no-dock bike.none-left
body.authority-changed body.changed body.moderated body.protected body.receipt-changed body.safe-standing-required body.source-slow body.source-unavailable body.unavailable body.withdrawn body.world-policy
calendar.already-interested calendar.full calendar.over carry.hands-full carry.in-use carry.occupied
chess.already-seated chess.illegal chess.in-progress chess.not-playing chess.not-your-piece chess.not-your-turn chess.seat-taken chess.seats-taken
contact.commit-refused contact.failed contact.identity-changed contact.not-applied contact.not-reached contact.out-of-reach contact.target-changed
container.closed container.full container.in-use container.moving container.no-room
conversation.already-member conversation.closed conversation.full conversation.invited conversation.no-request conversation.not-invited conversation.not-member conversation.out-of-range conversation.self
door.inside door.locked door.not-yours fire.out floor.no-body floor.no-building floor.none follow.already follow.destination follow.none follow.unavailable gait.no-bank-loop
game.elsewhere game.full gesture.no-room gesture.partner-unavailable gesture.too-far give.other-item ground.unsettled hands.empty hands.full hands.holding hands.not-holding
invite.absent invite.gone invite.none invite.not-near item.does-not-fit item.gone item.lit item.no-room item.none-near item.not-held item.not-yours lookout.prerequisite make.limit mark.full mark.removed meal.none
object.admission-failed object.body-unavailable object.for-sale object.gone object.not-yours object.private object.role object.state
painting.failed painting.identity-changed painting.no-easel painting.not-reached painting.offer-stale painting.refused painting.renderer painting.target-changed
place.dynamic place.items-full place.marks-full pose.no-room
presentation.already-reserved presentation.closed presentation.doors-closed presentation.ended presentation.entered presentation.full presentation.no-ticket presentation.not-open presentation.presenter presentation.standby-wait
project.done project.unfinished receipt.lost-on-restart revision.stale
ride.aboard ride.aloft ride.already-aboard ride.automatic ride.blocked ride.closed ride.departed ride.full ride.keeping-place ride.landing ride.not-aboard ride.not-boarding ride.on-ground ride.seated ride.steered ride.unavailable
seat.approach-busy seat.none-free seat.taken seat.yours shared.busy shared.full shared.left shared.not-member shared.not-ready shared.not-running shared.revision-changed shared.stop-asked shared.stop-requested shared.too-far
site.under-construction sky.daylight sky.no-clock slot.none-free soul.faded soul.not-in-sight stall.released state.asleep state.changed state.safe-stop-timeout steer.unavailable surface.full swim.no-deep-middle
tea.counter-blocked tea.cup-clean tea.cup-empty tea.cup-full tea.cup-not-down tea.cup-not-empty tea.hands-full tea.kettle-cold tea.kettle-empty tea.kettle-full tea.kettle-hot tea.kettle-not-down tea.kettle-on tea.no-bag tea.no-cup tea.no-kettle tea.no-tap tea.not-boiled tea.not-holding tea.tap-blocked
together.nobody-leading travel.failed walk.stuck wallet.insufficient
water.hands-full water.no-source water.no-tap water.no-vessel water.plant-blocked water.plant-wet water.source-empty water.tap-blocked water.vessel-empty water.vessel-full
activity.readiness-committed carrier.aloft carrier.busy classroom.owned-host-control-required construction.committed construction.one-job construction.site-busy disassembly.one-job
eat.bowl-empty food.service-in-use food.unavailable gait.dry-ground-required gait.unsupported-body object.changed object.refused physical.unavailable punt.unsupported-water
rest.native-seat-required ride.refused route.region-full serve.bowl-not-empty shuffle.dry-ground-required stand.seat-claim-changed stand.unsupported`.split(/\s+/));

/** One refusal code → {class: 'offer'|'state'|'admission'|'unclassified', sub?}. A code nobody listed stays unclassified. */
export function classifyRefusal(code) {
  if (typeof code !== 'string' || !code) return { class: 'unclassified' };
  if (ADMISSION.has(code)) return { class: 'admission' };
  if (code.startsWith('capability.') || RESOLUTION.has(code)) return { class: 'offer', sub: 'resolution' };
  if (ROUTE.has(code)) return { class: 'offer', sub: 'route' };
  if (STATE.has(code)) return { class: 'state' };
  return { class: 'unclassified' };
}

// ---- what a model decision did (M2, M3)
const ACT_VERBS = new Set(['act', 'object', 'travel']);
const SAY_VERBS = new Set(['say', 'converse']);
const REPLY_VERBS = new Set(['ack', 'result']);
const WAIT_VERBS = new Set(['wait', 'listen']);
const MSG = /^msg_/;

/** The assistant turns of one transcript: stream events sharing a message id are one model decision. */
export function seatDecisions(file) {
  if (!existsSync(file)) return { decisions: [], wakeBytes: {} };
  const decisions = [], byKey = new Map(), byTool = new Map(), wakeBytes = {};
  readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let ev; try { ev = JSON.parse(l); } catch { return; }
    if (ev.type === 'harness_user') { wakeBytes[ev.turn] = (wakeBytes[ev.turn] ?? 0) + Buffer.byteLength(String(ev.text ?? '')); return; }
    if (ev.type === 'assistant') {
      const key = ev.message?.id ? `${ev.turn}:${ev.message.id}` : `line:${i}`;
      let d = byKey.get(key);
      if (!d) { d = { turn: ev.turn ?? null, line: i + 1, atMs: ev._rx ?? null, toolLines: [], hasText: false, resultBytes: 0 }; byKey.set(key, d); decisions.push(d); }
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') { d.toolLines.push(i + 1); byTool.set(c.id, d); }
        else if (c.type === 'text' && String(c.text ?? '').trim()) d.hasText = true;
      }
    } else if (ev.type === 'user') {
      for (const c of ev.message?.content ?? []) if (c.type === 'tool_result') {
        const d = byTool.get(c.tool_use_id);
        if (d) d.resultBytes += Buffer.byteLength(typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? ''));
      }
    }
  });
  return { decisions, wakeBytes };
}

const verbsOf = (d, stepAt) => d.toolLines.map((n) => stepAt.get(n)?.verb ?? null);
/** act > say > reply > read > wait > other > text: what the decision is counted as. */
export function decisionKind(verbs, hasText = false) {
  if (verbs.some((v) => ACT_VERBS.has(v))) return 'act';
  if (verbs.some((v) => SAY_VERBS.has(v))) return 'say';
  if (verbs.some((v) => REPLY_VERBS.has(v))) return 'reply';
  if (verbs.some((v) => WAIT_VERBS.has(v))) return 'wait';
  if (verbs.some((v) => v != null)) return 'read';
  if (verbs.length) return 'other'; // a tool that is not the CLI: curl, cat, a file read
  return hasText ? 'text' : 'other';
}

/** Every owner message this seat's side saw: id, text, the server's sentAt, and when it first reached the seat. */
export function ownerMessages(playtestDir, seat, steps) {
  const m = new Map();
  const see = (id, { text = null, sentAt = null, at = null, via = null }) => {
    if (typeof id !== 'string' || !MSG.test(id)) return;
    const x = m.get(id) ?? { id, text: null, sentAtMs: null, deliveredMs: null, deliveredBy: null };
    x.text ??= text; x.sentAtMs ??= sentAt;
    if (at != null && (x.deliveredMs == null || at < x.deliveredMs)) { x.deliveredMs = at; x.deliveredBy = via; }
    m.set(id, x);
  };
  for (const row of readJsonl(join(playtestDir, 'seats', seat, 'listen.jsonl'))) {
    const at = Date.parse(row.t) || null;
    let parsed = null; try { parsed = JSON.parse(row.stdout); } catch { /* brief or cut output: the ids still count */ }
    for (const x of parsed?.messages ?? []) see(x.id, { text: x.text, sentAt: x.sentAt, at, via: 'listen' });
    for (const id of row.messages ?? []) see(id, { at, via: 'listen' });
  }
  for (const s of steps) {
    const o = s.out && typeof s.out === 'object' ? s.out : null;
    for (const x of [...(o?.ownerMessages ?? []), ...(o?.messages ?? [])]) see(x?.id, { text: x?.text, sentAt: x?.sentAt, at: s.doneMs ?? s.atMs, via: s.verb });
    if (REPLY_VERBS.has(s.verb)) see(s.args[0], { at: s.atMs, via: s.verb });
  }
  return [...m.values()].sort((a, b) => (a.deliveredMs ?? a.sentAtMs ?? 0) - (b.deliveredMs ?? b.sentAtMs ?? 0));
}

const ENDED_BAD = new Set(['failed', 'refused', 'cancelled', 'interrupted']);
/** What the world's records say became of one receipt: completed | ongoing | failed | cut-short | started. */
export function receiptOutcome(id, steps, packs = []) {
  const phases = []; let held = false;
  for (const s of steps) {
    const o = s.out && typeof s.out === 'object' ? s.out : null; if (!o) continue;
    if (o.receipt?.id === id) phases.push(o.receipt.phase);
    if (s.verb === 'receipt' && s.args[0] === id) phases.push(o.phase);
    for (const e of o.events ?? []) if (e?.receipt?.id === id) {
      phases.push(e.receipt.phase);
      if (e.kind === 'activity.observed' && e.action?.status === 'executing') held = true;
    }
  }
  for (const p of packs) {
    for (const r of p.receipts ?? []) if (r?.id === id) { phases.push(r.phase); if (r.endedAt?.posture && !['walking', 'standing'].includes(r.endedAt.posture)) held = true; }
    for (const x of p.samples ?? []) if (x.lastReceipt?.id === id) phases.push(x.lastReceipt.phase);
  }
  if (phases.includes('completed')) return 'completed';
  if (phases.some((p) => ENDED_BAD.has(p))) return 'failed';
  if (held) return 'ongoing';
  if (phases.includes('replaced')) return 'cut-short';
  return 'started';
}

/** When the world said this receipt started (server clock), or null. */
function startedAt(id, steps, packs = []) {
  const at = [];
  for (const s of steps) for (const e of (s.out && typeof s.out === 'object' ? s.out.events : null) ?? []) if (e?.receipt?.id === id && e.receipt.phase === 'started' && Number.isFinite(e.at)) at.push(e.at);
  for (const p of packs) for (const r of p.receipts ?? []) if (r?.id === id && Number.isFinite(Date.parse(r.startedAt ?? ''))) at.push(Date.parse(r.startedAt));
  return at.length ? Math.min(...at) : null;
}

/** What an act call printed, as an object or null. A model seat sees a non-zero exit as "Exit code 2\n<stdout>", sometimes in
 *  text blocks, and the strict contract's act.not-an-id exits 2: unread, that refusal would leave M1's denominator. */
export function actOutput(out) {
  const text = Array.isArray(out) ? out.filter((b) => b?.type === 'text').map((b) => b.text).join('') : out;
  if (text && typeof text === 'object') return text;
  if (typeof text !== 'string') return null;
  try { const o = JSON.parse(text.replace(/^Exit code \d+\n/, '')); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** Did an intention's first act work? Accepted, or refused by the world's state or admission: yes. An offer refusal: no.
 *  An unclassified refusal or an unreadable answer: unknown, never a success. */
export function firstActResult(a) {
  if (!a || a.state === 'unknown' || (a.state === 'refused' && a.class === 'unclassified')) return null;
  return !(a.state === 'refused' && a.class === 'offer');
}

// One act call → accepted, refused with its class, or unknown (a CLI error or output we cannot read).
function readAct(s) {
  const o = actOutput(s.out);
  if (o?.accepted === false) return { state: 'refused', code: o.code ?? null, ...classifyRefusal(o.code) };
  if (!s.isError && o && (o.accepted === true || o.receipt?.id)) return { state: 'accepted', receipt: o.receipt?.id ?? null, capability: o.receipt?.capability ?? o.resolved ?? null, for: o.for ?? null };
  return { state: 'unknown', why: s.isError ? 'CLI error' : o ? 'no accepted or receipt field' : 'output not JSON' };
}

// Owner words at the start of a message; a long brief that says "instead" in its middle is not a correction.
const CORRECTION = /^\W*(actually|change of plan|never mind|no\b|not that|wrong|i meant|instead|sorry)/i;
const CANCEL = /^\W*(actually[, ]+)?(stop(?! by)|cancel|never mind|forget (it|that))\b/i;
const sec = (ms) => (ms == null || !Number.isFinite(ms) ? null : Math.round(ms / 100) / 10);
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
const metric = (fields) => ({ status: fields.value == null ? 'unknown' : 'measured', ...fields });

/** Score one seat: its intentions (M1-M7 per intention) and its per-decision records. */
function scoreSeat(sr, seat, packs) {
  const steps = sr.steps[seat] ?? [];
  const file = join(sr.playtestDir, 'seats', seat, 'transcript.jsonl');
  const { decisions, wakeBytes } = seatDecisions(file);
  const stepAt = new Map(steps.map((s) => [s.line, s]));
  const reasons = new Map(readJsonl(join(sr.playtestDir, 'seats', seat, 'turns.jsonl')).map((t) => [t.turn, t.reason]));
  const messages = ownerMessages(sr.playtestDir, seat, steps);
  const onboarding = (d) => reasons.get(d.turn) === 'onboard';
  const seatPacks = packs.filter((p) => p.seat === seat);

  const acts = steps.filter((s) => (s.verb === 'act' || s.verb === 'object') && !(reasons.get(s.turn) === 'onboard'));
  const actRows = acts.map((s) => ({ line: s.resultLine ?? s.line, atMs: s.atMs, doneMs: s.doneMs, words: s.args[0] ?? null, ...readAct(s) }));

  // Which message each act and reply belongs to: the world's `for`, the id the seat named, or the seat's latest ack.
  const closedAt = new Map(), resultOf = new Map(), ackAt = new Map();
  for (const s of steps) {
    if (s.verb === 'ack' && MSG.test(s.args[0] ?? '')) { if (!ackAt.has(s.args[0])) ackAt.set(s.args[0], s); }
    if (s.verb === 'result' && MSG.test(s.args[0] ?? '') && !resultOf.has(s.args[0])) { resultOf.set(s.args[0], s); closedAt.set(s.args[0], s.line); }
  }
  let current = null;
  const actFor = new Map();
  for (const s of steps) {
    if (s.verb === 'ack' && MSG.test(s.args[0] ?? '')) current = s.args[0];
    if (s.verb === 'act' || s.verb === 'object') {
      const r = actRows.find((x) => x.line === (s.resultLine ?? s.line));
      if (r) { r.intention = r.for ?? current; actFor.set(r.line, r.intention); }
    }
    if (s.verb === 'result' && s.args[0] === current) current = null;
  }

  const hasBody = (id) => actRows.some((r) => r.intention === id);
  const isIntention = (m) => hasBody(m.id) || resultOf.has(m.id);

  // Attribute every model decision to one message, so nothing is counted twice: an id the decision names, else the rest of
  // the same wake, else the latest delivered intention still open, else nothing (reported as unattributed).
  let prev = null;
  const rows = decisions.map((d) => {
    const verbs = verbsOf(d, stepAt);
    const kind = decisionKind(verbs, d.hasText);
    const row = { turn: d.turn, line: d.line, atMs: d.atMs, kind, bytes: d.resultBytes, onboarding: onboarding(d), message: null };
    if (row.onboarding) return row;
    for (const n of d.toolLines) {
      const s = stepAt.get(n); if (!s) continue;
      const named = REPLY_VERBS.has(s.verb) ? s.args[0] : (s.verb === 'act' || s.verb === 'object') ? actFor.get(s.resultLine ?? s.line) : null;
      if (named) { row.message = named; break; }
    }
    if (!row.message && prev?.turn === d.turn && prev.message) row.message = prev.message;
    if (!row.message) {
      const open = messages.filter((m) => isIntention(m) && (m.deliveredMs ?? m.sentAtMs ?? Infinity) <= (d.atMs ?? -Infinity) && !(closedAt.has(m.id) && closedAt.get(m.id) < d.line));
      row.message = open.at(-1)?.id ?? null;
    }
    prev = row;
    return row;
  });

  const scriptEntries = sr.scenario?.director?.script ?? [];
  const intentions = messages.map((m) => {
    const mine = actRows.filter((r) => r.intention === m.id);
    const res = resultOf.get(m.id);
    const outcome = res ? (res.out?.outcome ?? res.args[1] ?? null) : null;
    const turns = rows.filter((r) => r.message === m.id);
    const firstAccepted = mine.find((r) => r.state === 'accepted');
    const delivered = m.deliveredMs ?? m.sentAtMs;
    const startMs = firstAccepted?.receipt ? startedAt(firstAccepted.receipt, steps, seatPacks) : null;
    const m4At = startMs ?? firstAccepted?.doneMs ?? null;
    // Reached the seat only after the start, or no record of reaching it: count from when the owner sent it.
    const m4FromSent = m.deliveredMs == null || (m4At != null && delivered > m4At);
    const m4From = m4FromSent ? m.sentAtMs : delivered;
    const acts = mine.map((r) => ({ words: r.words, state: r.state, code: r.code ?? null, class: r.class ?? null, sub: r.sub ?? null, receipt: r.receipt ?? null, capability: r.capability ?? null, world: r.state !== 'accepted' ? null : r.receipt ? receiptOutcome(r.receipt, steps, seatPacks) : 'unknown', line: r.line }));
    const declared = scriptEntries.find((e) => e.text === m.text);
    return {
      seat, id: m.id, text: m.text == null ? null : String(m.text).slice(0, 120),
      kind: hasBody(m.id) ? 'intention' : resultOf.has(m.id) ? 'spoken-request' : 'conversation',
      deliveredBy: m.deliveredBy,
      result: outcome,
      acts,
      turns: turns.length, turnsByKind: turns.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {}),
      firstActSucceeded: firstActResult(mine[0]),
      m4Sec: m4From != null && m4At != null && m4At >= m4From ? sec(m4At - m4From) : null,
      m4Basis: m4At == null ? null : `${startMs != null ? 'receipt started event' : 'act call returned'}${m4FromSent ? ', from when it was sent' : ''}`,
      correction: declared?.correction === true || (declared?.correction == null && m.text != null && CORRECTION.test(m.text)),
      correctionBasis: declared?.correction != null ? 'spec' : 'text',
      cancel: m.text != null && CANCEL.test(m.text),
      deliveredMs: delivered,
      closeMs: res?.doneMs ?? res?.atMs ?? null,
    };
  });

  // M7: an intention was disturbed if another owner message reached the seat after its first act began and before it closed.
  for (const x of intentions) {
    if (x.kind !== 'intention' || !x.acts.some((a) => a.state === 'accepted')) { x.retention = null; continue; }
    const rows4 = actRows.filter((r) => r.intention === x.id && r.state === 'accepted');
    const from = rows4[0].atMs, lastAct = rows4.at(-1).doneMs ?? rows4.at(-1).atMs;
    const until = x.closeMs ?? lastAct;
    const others = intentions.filter((y) => y.id !== x.id && y.deliveredMs != null && from != null && until != null && y.deliveredMs > from && y.deliveredMs < until);
    if (!others.length) { x.retention = null; continue; }
    const cancel = others.find((y) => y.cancel), redirect = others.find((y) => !y.cancel && (y.correction || y.acts.length));
    const world = x.acts.filter((a) => a.state === 'accepted').at(-1).world;
    if (cancel) {
      const after = rows4.filter((r) => r.atMs > cancel.deliveredMs);
      x.retention = { disturbedBy: 'cancel', state: after.length ? 'lost' : 'kept', note: after.length ? `${after.length} new act(s) for it after the cancel` : 'no new act for it after the cancel' };
    } else if (redirect) x.retention = { disturbedBy: 'redirect', state: 'replaced', note: 'a newer owner body request replaces it; not in the denominator' };
    else if (world === 'completed' || world === 'ongoing') x.retention = { disturbedBy: 'chat', state: 'kept', note: `last act ${world}` };
    else if (world === 'started' || world === 'unknown') x.retention = { disturbedBy: 'chat', state: 'unknown', note: 'no later world record of its last act' };
    else x.retention = { disturbedBy: 'chat', state: 'lost', note: `last act ${world}` };
  }
  const bodyRows = rows.filter((r) => !r.onboarding);
  return {
    seat, adapter: readAdapter(sr, seat), actRows, intentions, turns: rows,
    onboardingBytes: rows.filter((r) => r.onboarding).reduce((a, r) => a + r.bytes, 0) + Object.entries(wakeBytes).filter(([t]) => reasons.get(Number(t)) === 'onboard').reduce((a, [, b]) => a + b, 0),
    bodyBytes: bodyRows.reduce((a, r) => a + r.bytes, 0) + Object.entries(wakeBytes).filter(([t]) => reasons.get(Number(t)) !== 'onboard').reduce((a, [, b]) => a + b, 0),
    hasTranscript: steps.length > 0,
    tokens: readJsonl(join(sr.playtestDir, 'seats', seat, 'cost.jsonl')).reduce((a, c) => a + (Number(c.inputTokens) || 0) + (Number(c.cachedTokens) || 0) + (Number(c.cacheCreationTokens) || 0), 0),
    wakes: new Set(bodyRows.map((r) => r.turn)).size,
  };
}
function readAdapter(sr, seat) {
  try { return JSON.parse(readFileSync(join(sr.playtestDir, 'seats', seat, 'seat.json'), 'utf8')).adapter ?? null; } catch { return null; }
}

const M3_KINDS = ['read', 'wait', 'other'];
const TARGETS = {
  M1: '>= 0.90 (0.95 stretch)', M2: 'candidate beats baseline on the same specs', M3: 'towards 0 with the resident client', M4: 'reported as an upper bound; absolute claims need a quiet machine',
  M5: '<= baseline', M6: 'reported, not optimized blindly', M7: '>= baseline', G1: 'no regression', G2: 'no regression', G3: 'no regression',
};
// Predeclared questions that answer M7 directly when a spec names them; their verdicts stand beside the computed number.
const RETENTION_QUESTIONS = new Set(['errand-kept-through-burst', 'cancel-not-resumed', 'redirect-honoured', 'chained-steer']);

/** The scorecard for one finished run. answers: the run's question answers; hash: this file's sha256 and whether the spec had it. */
export function scoreRun(sr, { answers = [], scorer = null } = {}) {
  const packs = sr.run?.evidence ?? [];
  const seats = (sr.playtestDir ? sr.seatIds : []).map((s) => scoreSeat(sr, s, packs));
  const seen = seats.filter((s) => s.hasTranscript), blind = seats.filter((s) => !s.hasTranscript).map((s) => s.seat);
  const missing = blind.length ? { seatsWithoutTranscript: blind } : {};
  const acts = seen.flatMap((s) => s.actRows), intentions = seen.flatMap((s) => s.intentions);
  const bodyIntentions = intentions.filter((i) => i.kind === 'intention'), spoken = intentions.filter((i) => i.kind === 'spoken-request');
  const turns = seen.flatMap((s) => s.turns.filter((r) => !r.onboarding));
  const modelFree = seen.length > 0 && seen.every((s) => s.adapter === 'scripted-owner');
  const none = !seen.length ? 'no seat transcript in this run' : null;

  // M1: refusal classes; only `offer` counts against. Unreadable and unclassified acts are out of the denominator and counted.
  const by = (f) => acts.filter(f).length;
  const refused = acts.filter((a) => a.state === 'refused');
  const classes = { offer: by((a) => a.class === 'offer'), offerResolution: by((a) => a.sub === 'resolution'), offerRoute: by((a) => a.sub === 'route'), state: by((a) => a.class === 'state'), admission: by((a) => a.class === 'admission') };
  const unclassified = refused.filter((a) => a.class === 'unclassified').map((a) => a.code ?? null), unknownActs = by((a) => a.state === 'unknown');
  const denom = acts.length - unclassified.length - unknownActs;
  const withAct = bodyIntentions.filter((i) => i.firstActSucceeded != null);
  const M1 = metric({
    value: denom ? ratio(denom - classes.offer, denom) : null, numerator: denom - classes.offer, denominator: denom, missing: { unclassified: unclassified.length, unreadable: unknownActs, ...missing }, classes,
    unclassifiedCodes: [...new Set(unclassified)], refusedCodes: refused.reduce((a, r) => ({ ...a, [r.code ?? 'none']: (a[r.code ?? 'none'] ?? 0) + 1 }), {}),
    firstActOfIntention: { value: ratio(withAct.filter((i) => i.firstActSucceeded).length, withAct.length), denominator: withAct.length, unknown: bodyIntentions.filter((i) => i.acts.length && i.firstActSucceeded == null).length },
    acceptedThenFailed: acts.filter((a) => a.state === 'accepted' && a.receipt).filter((a) => { const s = seen.find((x) => x.actRows.includes(a)); return receiptOutcome(a.receipt, sr.steps[s.seat], packs) === 'failed'; }).length,
    basis: 'act and object calls after onboarding (a travel call counts as an act for M2 and M3, not here), from the world\'s answer to each call; 1 - offer refusals / classified acts. State and admission refusals stay in the denominator and do not count against it. A repair attempt is a new act, so firstActOfIntention is the stricter reading.',
    ...(none ? { reason: none } : !denom ? { reason: 'no act in this run' } : {}),
  });

  // M2/M3: one model decision is one assistant message; onboarding is left out. A closing line with no tool is a model turn
  // (M2) but not a poll (M3); ack and result answer the owner, so they are not polls either.
  const source = 'seat log (transcript.jsonl assistant messages, turns.jsonl wake reasons)';
  const traced = !!sr.receipt?.diagnostics?.capture;
  const sourceNote = `${traced ? 'The trace tap was on. Turns still come from the seat log: soul-trace/1 can carry host.turn (tools/soul-trace/host.mjs), but nothing in tools/playtest writes it yet and this scorer does not read it. ' : ''}${modelFree ? 'Every seat is model-free (scripted-owner): a "turn" is a scripted CLI step and costs no model call, so turn counts describe the script.' : ''}`.trim();
  const done = bodyIntentions.filter((i) => i.result === 'done');
  const notDone = bodyIntentions.filter((i) => i.result !== 'done');
  const spokenDone = spoken.filter((i) => i.result === 'done');
  const unattributed = turns.filter((r) => r.message == null).length;
  const M2 = metric({
    value: median(done.map((i) => i.turns)), perIntention: bodyIntentions.map((i) => ({ id: i.id, seat: i.seat, result: i.result, turns: i.turns })), denominator: done.length,
    spokenRequests: { median: median(spokenDone.map((i) => i.turns)), denominator: spokenDone.length },
    missing: { intentionsNotDone: notDone.length, ...missing }, turnsTotal: turns.length, turnsOnIntentions: turns.filter((r) => bodyIntentions.some((i) => i.id === r.message)).length, turnsOnSpokenRequests: turns.filter((r) => spoken.some((i) => i.id === r.message)).length, turnsOnConversation: turns.filter((r) => intentions.some((i) => i.id === r.message && i.kind === 'conversation')).length, turnsUnattributed: unattributed,
    wakes: seen.reduce((a, s) => a + s.wakes, 0), source, ...(sourceNote ? { sourceNote } : {}),
    basis: 'median model decisions per intention (an owner message with a body act) that the seat closed with result done; intentions closed otherwise are listed in perIntention and counted in missing. A message closed by result with no act is a spoken request, reported apart. Each decision is attributed to one owner message: the id it names, else the rest of its wake, else the latest open intention.',
    ...(none ? { reason: none } : !done.length ? { reason: 'no intention was closed with result done' } : {}),
  });
  const kinds = turns.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {});
  const polling = turns.filter((r) => M3_KINDS.includes(r.kind)).length;
  const M3 = metric({
    value: seen.length ? polling : null, denominator: turns.length, share: ratio(polling, turns.length), byKind: kinds, closingTextTurns: kinds.text ?? 0, missing, source, ...(sourceNote ? { sourceNote } : {}),
    basis: 'model decisions after onboarding that ran only a read, a wait or a non-CLI tool. An act, say, ack or result is not counted, nor is a closing line with no tool (listed as closingTextTurns).',
    ...(none ? { reason: none } : {}),
  });

  // M4: no receipt carries a first-motion tick, so this is delivery to the world's own "started" (or the act call returning).
  const m4 = bodyIntentions.filter((i) => i.acts.some((a) => a.state === 'accepted'));
  const m4Known = m4.filter((i) => i.m4Sec != null);
  const M4 = metric({
    value: median(m4Known.map((i) => i.m4Sec)), unit: 's', upperBound: true, denominator: m4.length, missing: { unknown: m4.length - m4Known.length, ...missing },
    bases: m4Known.reduce((a, i) => ({ ...a, [i.m4Basis]: (a[i.m4Basis] ?? 0) + 1 }), {}), perIntention: m4Known.map((i) => ({ id: i.id, sec: i.m4Sec, basis: i.m4Basis })),
    basis: 'median seconds from the owner message first reaching the seat (listen, or the output that carried it) to the receipt\'s started event, or to the act call returning when no event was seen. Receipts have no first-motion tick; started is the world\'s start of the activity, not observed displacement (see observedFirstBodyChangeSec for that). Local wall clock and world wall clock on one machine.',
    ...(none ? { reason: none } : !m4.length ? { reason: 'no accepted act for any intention' } : {}),
  });

  // M5: what the spec says, or the owner's words. A scripted director sends the same messages whatever the Soul does.
  const corrections = intentions.filter((i) => i.correction), requested = [...bodyIntentions, ...spoken];
  const scriptFixed = (sr.scenario?.director?.mode ?? null) === 'scripted' || existsSync(join(sr.playtestDir ?? '', 'director', 'directions.jsonl'));
  const M5 = metric({
    value: requested.length ? ratio(corrections.length, requested.length) : null, corrections: corrections.length, denominator: requested.length, scriptFixed, missing,
    bases: corrections.reduce((a, c) => ({ ...a, [c.correctionBasis]: (a[c.correctionBasis] ?? 0) + 1 }), {}),
    basis: `owner messages marked correction in the spec's script, else opening with correcting words (${CORRECTION.source}), per intention or spoken request.${scriptFixed ? ' The director was scripted, so this number is the script\'s and cannot move between arms; only a persona director can show repair burden.' : ''}`,
    ...(none ? { reason: none } : !requested.length ? { reason: 'no intention in this run' } : {}),
  });

  // M6
  const bytes = seen.reduce((a, s) => a + s.bodyBytes, 0), tokens = seen.reduce((a, s) => a + s.tokens, 0);
  const M6 = metric({
    value: turns.length ? Math.round(bytes / turns.length) : null, unit: 'bytes/turn', bytesTotal: bytes, denominator: turns.length, onboardingBytes: seen.reduce((a, s) => a + s.onboardingBytes, 0),
    ...(tokens ? { contextTokensPerTurn: Math.round(tokens / Math.max(turns.length, 1)) } : {}), missing,
    basis: 'bytes the agent was handed after onboarding (wake text and tool results) per model decision; onboardingBytes is the skill and boot reads, once per seat. contextTokensPerTurn, when the adapter reports usage, is the input the model was charged for.',
    ...(none ? { reason: none } : !turns.length ? { reason: 'no model decision after onboarding' } : {}),
  });

  // M7
  const disturbed = bodyIntentions.filter((i) => i.retention);
  const kept = disturbed.filter((i) => i.retention.state === 'kept').length, lost = disturbed.filter((i) => i.retention.state === 'lost').length, unknownRet = disturbed.filter((i) => i.retention.state === 'unknown').length;
  const related = answers.filter((a) => RETENTION_QUESTIONS.has(a.id)).map((a) => ({ id: a.id, verdict: a.verdict, basis: a.basis }));
  const M7 = metric({
    value: kept + lost ? ratio(kept, kept + lost) : null, kept, lost, denominator: kept + lost, missing: { unknown: unknownRet, ...missing }, replaced: disturbed.filter((i) => i.retention.state === 'replaced').length, questions: related,
    basis: 'intentions another owner message reached while they were under way. Chat: kept if the last act completed or is held in the world. Cancel: kept if the seat started nothing new for it afterwards; this does not check that the body stopped, which the predeclared questions cover. A newer body request replaces it and leaves the denominator. Predeclared questions on retention stand beside the number.',
    ...(none ? { reason: none } : !(kept + lost) ? { reason: 'no owner message arrived while an intention was under way' } : {}),
  });

  // G1: seat claims against the world's receipts; the observer's truthfulness oracle when the run has one.
  const claims = bodyIntentions.filter((i) => i.result === 'done' && i.acts.some((a) => a.state === 'accepted'));
  const worldOf = (i) => i.acts.filter((a) => a.state === 'accepted').at(-1).world;
  const untruthful = claims.filter((i) => ['failed', 'cut-short'].includes(worldOf(i)));
  const oracles = sr.playtestDir ? readJsonl(join(sr.playtestDir, 'oracles.jsonl')) : [];
  const truthOracle = oracles.filter((o) => /truth/.test(o.id ?? ''));
  const G1 = metric({
    value: seen.length ? untruthful.length : null, denominator: claims.length, unknown: claims.filter((i) => ['started', 'unknown'].includes(worldOf(i))).length, missing, examples: untruthful.slice(0, 5).map((i) => ({ id: i.id, seat: i.seat, world: worldOf(i) })),
    truthfulnessOracle: truthOracle.length ? { pass: truthOracle.filter((o) => o.status === 'pass').length, fail: truthOracle.filter((o) => o.status === 'fail').length, unknown: truthOracle.filter((o) => o.status === 'unknown').length } : null,
    basis: 'result done claims whose last accepted act the world records as failed or cut short.', ...(none ? { reason: none } : {}),
  });
  // G2: every seat that acted got somewhere, and a stalled neighbour is visible.
  const progress = seen.map((s) => {
    const accepted = s.actRows.filter((a) => a.state === 'accepted' && a.receipt);
    return { seat: s.seat, accepted: accepted.length, reached: accepted.filter((a) => ['completed', 'ongoing'].includes(receiptOutcome(a.receipt, sr.steps[s.seat], packs))).length };
  });
  const stalled = progress.filter((p) => p.accepted && !p.reached).map((p) => p.seat);
  const noProgress = oracles.filter((o) => o.id === 'no-progress');
  const G2 = metric({
    value: seen.length > 1 ? stalled.length : null, denominator: progress.filter((p) => p.accepted).length, perSeat: progress, stalled, missing, noProgressOracle: noProgress.length ? { pass: noProgress.filter((o) => o.status === 'pass').length, fail: noProgress.filter((o) => o.status === 'fail').length } : null,
    basis: 'seats with an accepted act and no receipt the world records as completed or held.', ...(seen.length > 1 ? {} : { reason: 'needs more than one seat with a transcript' }),
  });
  const tv = sr.receipt?.evidence?.tickValidity ?? null;
  const tickOk = tv && Number.isFinite(tv.ticks) && Number.isFinite(tv.seconds) && tv.seconds > 0;
  const G3 = metric({
    value: tickOk ? Math.round((tv.ticks / tv.seconds) * 1000) / 1000 : null, unit: 'ticks/s', valid: tv?.valid ?? null, ticks: tv?.ticks ?? null, seconds: tv?.seconds ?? null,
    basis: 'tick-validity from the run receipt.', ...(tickOk ? {} : { reason: 'no tick-validity record in the run receipt' }),
  });

  const metrics = { M1, M2, M3, M4, M5, M6, M7 }, guardrails = { G1, G2, G3 };
  for (const [k, m] of [...Object.entries(metrics), ...Object.entries(guardrails)]) m.target = TARGETS[k];
  return {
    schema: SCORECARD_SCHEMA,
    scorer: { ...SCORER, ...(scorer ?? {}) },
    run: { runId: sr.runId, status: sr.status, kind: sr.kind },
    controllers: seats.map((s) => ({ seat: s.seat, adapter: s.adapter, transcript: s.hasTranscript })),
    modelFree, source, ...(sourceNote ? { sourceNote } : {}),
    metrics, guardrails,
    intentions: intentions.map(({ deliveredMs, closeMs, ...i }) => i),
    limits: ['Two repeats is a demonstration, not a rate.', 'Refusal classes come from the code alone: a state code cannot tell a seat taken after the agent looked from one it could have seen.', 'Absolute times need a quiet machine.'],
  };
}

/** Scorecard rows for the evaluation's measures table, so compare lists them per repeat and per arm. */
export function scorecardMeasures(card) {
  const unit = { M1: 'fraction', M2: 'turns/intention', M3: 'turns', M4: 's (upper bound)', M5: 'corrections/intention', M6: 'bytes/turn', M7: 'fraction', G1: 'claims', G2: 'seats', G3: 'ticks/s' };
  const name = { M1: 'first-try-success', M2: 'turns-per-intention', M3: 'turns-no-act-or-say', M4: 'time-to-start', M5: 'owner-repair', M6: 'context-bytes-per-turn', M7: 'intent-retention', G1: 'untruthful-claims', G2: 'stalled-seats', G3: 'tick-rate' };
  return Object.entries({ ...card.metrics, ...card.guardrails }).map(([k, m]) => ({
    id: `${k}-${name[k]}`, family: 'controllability', unit: unit[k], status: m.status === 'measured' ? 'measured' : 'unavailable', value: m.value,
    ...(m.status === 'measured' ? { n: m.denominator ?? null, denominator: m.denominator ?? null } : { reason: m.reason ?? 'unknown' }), basis: m.basis, sources: ['scorecard.json'],
  }));
}

export function renderScorecard(card) {
  const fmt = (v) => (v == null ? 'unknown' : String(v));
  const miss = (m) => { const x = Object.entries(m.missing ?? {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)); return x.length ? x.map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(' ') : v}`).join(', ') : ''; };
  const L = [`## Controllability scorecard`, '', `Scorer ${card.scorer.id} v${card.scorer.version}, ${card.scorer.predeclared ? 'predeclared (hash in the spec)' : 'not predeclared for this run'}. Turns from ${card.source}.${card.sourceNote ? ` ${card.sourceNote}` : ''}`, '', '| id | value | of | missing | target |', '|---|---|---|---|---|'];
  for (const [k, m] of [...Object.entries(card.metrics), ...Object.entries(card.guardrails)]) L.push(`| ${k} | ${fmt(m.value)}${m.reason ? ` (${m.reason})` : ''} | ${fmt(m.denominator)} | ${miss(m)} | ${m.target} |`);
  const c = card.metrics.M1.classes;
  L.push('', `M1 refusals: offer ${c.offer} (resolution ${c.offerResolution}, route ${c.offerRoute}), state ${c.state}, admission ${c.admission}, unclassified ${card.metrics.M1.missing.unclassified}${card.metrics.M1.unclassifiedCodes?.length ? ` (${card.metrics.M1.unclassifiedCodes.join(', ')})` : ''}.`);
  return L.join('\n') + '\n';
}
