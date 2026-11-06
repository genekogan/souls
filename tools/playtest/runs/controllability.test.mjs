// The controllability scorecard (#1097): synthetic run folders in the shapes real seats write, scored offline. The Claude
// shape splits one assistant message over several stream events; the scripted-owner shape has one event per tool call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actOutput, classifyRefusal, decisionKind, firstActResult, receiptOutcome, seatDecisions, ownerMessages, SCORER, scoreRun } from './controllability.mjs';
import { evaluateRun, loadSoulRun, seatSteps } from './evaluate.mjs';
import { sha256 } from '../lib/hash.mjs';

const T0 = Date.parse('2026-11-06T20:00:00.000Z');
const at = (sec) => T0 + sec * 1000;
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const w = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };

/** Stream events for one model message: {sec, tools: [[command, output, isError?]], text, id}. */
function events(turn, msgs) {
  const out = [];
  msgs.forEach((m, i) => {
    const id = m.id ?? `assistant_${turn}_${i}`;
    if (m.text) out.push({ type: 'assistant', turn, _rx: at(m.sec), message: { id, content: [{ type: 'text', text: m.text }] } });
    for (const [j, [command, output, isError = false]] of (m.tools ?? []).entries()) {
      const tid = `t${turn}_${i}_${j}`;
      out.push({ type: 'assistant', turn, _rx: at(m.sec), message: { id, content: [{ type: 'tool_use', id: tid, name: 'Bash', input: { command } }] } });
      out.push({ type: 'user', turn, _rx: at(m.sec) + 40, message: { content: [{ type: 'tool_result', tool_use_id: tid, content: typeof output === 'string' ? output : JSON.stringify(output), is_error: isError }] } });
    }
  });
  return out;
}
const ack = (id, text = 'On it') => [`node eden.mjs ack ${id} "${text}"`, { acked: id, reply: text }];
const result = (id, outcome = 'done') => [`node eden.mjs result ${id} ${outcome} "Finished"`, { reported: id, outcome }];
const act = (words, out) => [`node eden.mjs act "${words}" --wait 55`, out];
const ok = (rid, cap, phase, forId, extra = {}) => ({ accepted: true, receipt: { id: rid, capability: cap, phase }, for: forId, ...extra });
const no = (code) => ({ accepted: false, code, reason: 'refused' });

function run({ seats, scenario = {}, receipt = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'sr-card-')), p = join(dir, 'playtest');
  w(join(dir, 'run-receipt.json'), { runId: 'card-1', status: 'completed', ...receipt });
  w(join(p, 'scenario.json'), { name: 'card', seats: [], ...scenario });
  for (const f of ['0-preflight', '1-provision', '2-seats', '3-play', '4-close']) w(join(p, 'receipts', `${f}.json`), { ok: true });
  w(join(p, 'world.json'), {});
  for (const [seat, s] of Object.entries(seats)) {
    const d = join(p, 'seats', seat);
    w(join(d, 'seat.json'), { adapter: s.adapter ?? 'claude-headless' });
    w(join(d, 'turns.jsonl'), jl(s.turns ?? []));
    w(join(d, 'cost.jsonl'), jl(s.cost ?? []));
    w(join(d, 'listen.jsonl'), jl(s.listen ?? []));
    if (s.transcript) w(join(d, 'transcript.jsonl'), jl(s.transcript));
  }
  return dir;
}
const listen = (sec, id, text) => ({ t: new Date(at(sec)).toISOString(), messages: [id], stdout: JSON.stringify({ messages: [{ id, text, sentAt: at(sec) - 100 }] }) });

test('refusal classes: only offer counts against M1, and a code nobody listed stays unclassified', () => {
  assert.deepEqual(classifyRefusal('capability.choose'), { class: 'offer', sub: 'resolution' });
  assert.deepEqual(classifyRefusal('capability.unknown'), { class: 'offer', sub: 'resolution' });
  assert.deepEqual(classifyRefusal('place.ambiguous'), { class: 'offer', sub: 'resolution' });
  assert.deepEqual(classifyRefusal('route.unreachable'), { class: 'offer', sub: 'route' });
  assert.deepEqual(classifyRefusal('carry.no-route'), { class: 'offer', sub: 'route' });
  assert.deepEqual(classifyRefusal('seat.taken'), { class: 'state' });
  assert.deepEqual(classifyRefusal('ride.departed'), { class: 'state' });
  assert.deepEqual(classifyRefusal('hands.full'), { class: 'state' });
  assert.deepEqual(classifyRefusal('soul.busy'), { class: 'admission' });
  assert.deepEqual(classifyRefusal('world.crowded'), { class: 'admission' });
  assert.deepEqual(classifyRefusal('zebra.striped'), { class: 'unclassified' });
  assert.deepEqual(classifyRefusal('carry.brand-new'), { class: 'unclassified' }, 'a new code in a known family is named, not filed as state');
  assert.deepEqual(classifyRefusal('place.brand-new'), { class: 'unclassified' });
  assert.deepEqual(classifyRefusal('carry.crew-too-small'), { class: 'unclassified' }, 'an agent could read the crew size first: undecided, and visible');
  assert.deepEqual(classifyRefusal(null), { class: 'unclassified' });
});

test('the codes the steward named, and the engine codes that reach an act\'s answer, have a class', () => {
  for (const c of ['act.not-an-id', 'seat.none-in-place', 'seat.none-near', 'target.not-in-sight', 'action.invalid-params']) assert.deepEqual(classifyRefusal(c), { class: 'offer', sub: 'resolution' }, c);
  for (const c of ['route.goal-blocked', 'route.start-blocked', 'use.transition-blocked', 'seat.too-high']) assert.deepEqual(classifyRefusal(c), { class: 'offer', sub: 'route' }, c);
  for (const c of ['seat.none-free', 'seat.approach-busy', 'gait.dry-ground-required', 'physical.unavailable', 'object.refused', 'ride.refused']) assert.deepEqual(classifyRefusal(c), { class: 'state' }, c);
});

test('a refused first act of an unknown class, or an unreadable one, is unknown and never a success', () => {
  assert.equal(firstActResult({ state: 'accepted' }), true);
  assert.equal(firstActResult({ state: 'refused', class: 'state' }), true);
  assert.equal(firstActResult({ state: 'refused', class: 'admission' }), true);
  assert.equal(firstActResult({ state: 'refused', class: 'offer' }), false);
  assert.equal(firstActResult({ state: 'refused', class: 'unclassified' }), null);
  assert.equal(firstActResult({ state: 'unknown' }), null);
  assert.equal(firstActResult(undefined), null);
  const dir = run({ seats: { bo: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [listen(0, 'msg_u', 'Sit on the bench')],
    transcript: events(1, [{ sec: 1, tools: [ack('msg_u')] }, { sec: 2, tools: [act('sit:bench', no('zebra.striped'))] }, { sec: 3, tools: [act('sit:bench2', ok('r_u', 'sit:bench2', 'completed', 'msg_u'))] }, { sec: 4, tools: [result('msg_u')] }]),
  } } });
  const first = scoreRun(loadSoulRun(dir)).metrics.M1.firstActOfIntention;
  assert.equal(first.value, null);
  assert.deepEqual([first.denominator, first.unknown], [0, 1]);
});

test('a model seat\'s non-zero exit is read: the refusal stays in M1, in every shape it can arrive', () => {
  const refusal = no('act.not-an-id');
  assert.deepEqual(actOutput(refusal), refusal);
  assert.deepEqual(actOutput(JSON.stringify(refusal)), refusal);
  assert.deepEqual(actOutput(`Exit code 2\n${JSON.stringify(refusal)}`), refusal);
  assert.deepEqual(actOutput([{ type: 'text', text: `Exit code 2\n${JSON.stringify(refusal)}` }]), refusal);
  for (const bad of ['Exit code 1\nboom', 'not json', '', null, 7, '3', []]) assert.equal(actOutput(bad), null, String(bad));
});

test('the same mistake scores the same on both contracts', () => {
  // One intention: words the world cannot use, then the offered id. Only the wire differs: the words contract answers
  // capability.unknown with exit 0; the strict CLI answers act.not-an-id with exit 2, as a model seat sees it.
  const card = (refused) => scoreRun(loadSoulRun(run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [listen(0, 'msg_m', 'Walk to the orchard')],
    transcript: events(1, [
      { sec: 1, tools: [ack('msg_m')] },
      { sec: 2, tools: [act('go to that orchard', ...refused)] },
      { sec: 3, tools: [act('walk:orchard', ok('r_m', 'walk:orchard', 'completed', 'msg_m'))] },
      { sec: 4, tools: [result('msg_m')] },
    ]),
  } } })));
  const words = card([no('capability.unknown')]), strict = card([`Exit code 2\n${JSON.stringify(no('act.not-an-id'))}`, true]);
  assert.equal(words.metrics.M1.value, 0.5);
  for (const k of ['value', 'denominator', 'classes', 'missing']) assert.deepEqual(strict.metrics.M1[k], words.metrics.M1[k], k);
  assert.deepEqual(strict.metrics.M1.firstActOfIntention, words.metrics.M1.firstActOfIntention);
  assert.equal(strict.metrics.M1.firstActOfIntention.value, 0);
});

test('M4 names the sent-at fallback when the message reached the seat after the start, or left no record', () => {
  const dir = run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [{ t: new Date(at(20)).toISOString(), messages: ['msg_late'], stdout: JSON.stringify({ messages: [{ id: 'msg_late', text: 'Walk to the orchard', sentAt: at(0) }] }) }],
    transcript: events(1, [
      { sec: 1, tools: [act('walk:orchard', ok('r_l', 'walk:orchard', 'started', 'msg_late', { events: [{ kind: 'receipt', at: at(12), receipt: { id: 'r_l', phase: 'started' } }] }))] },
      { sec: 21, tools: [ack('msg_late')] },
      { sec: 22, tools: [result('msg_late')] },
    ]),
  } } });
  const m4 = scoreRun(loadSoulRun(dir)).metrics.M4;
  assert.deepEqual(m4.bases, { 'receipt started event, from when it was sent': 1 });
  assert.equal(m4.value, 12, 'sent at 0, started at 12; the seat read it at 20');
});

test('one assistant message split over stream events is one model decision; onboarding is left out', () => {
  const dir = run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'onboard' }, { turn: 2, reason: 'wake' }],
    listen: [listen(10, 'msg_a', 'Walk to the orchard')],
    transcript: [
      { type: 'harness_user', turn: 1, text: 'Make me a Soul', _rx: at(0) },
      ...events(1, [{ sec: 1, tools: [['curl -fsSo eden.mjs http://w/eden.mjs', '68445 bytes'], ['node eden.mjs create Ada', { created: true }]], id: 'boot' }]),
      { type: 'harness_user', turn: 2, text: 'wake msg_a', _rx: at(10) },
      // Two tool calls in one message: one decision, with the act's kind.
      ...events(2, [{ sec: 11, id: 'm1', text: 'Going', tools: [ack('msg_a'), act('walk to the orchard', ok('r1', 'walk:orchard', 'completed', 'msg_a'))] }, { sec: 40, id: 'm2', tools: [result('msg_a')] }, { sec: 41, id: 'm3', text: 'Done.' }]),
    ],
  } } });
  const c = scoreRun(loadSoulRun(dir));
  assert.equal(c.metrics.M2.value, 3, 'three model decisions: the act message, the result message, the closing line');
  assert.equal(c.metrics.M2.turnsTotal, 3, 'the onboarding turn is not counted');
  assert.deepEqual(c.metrics.M3.byKind, { act: 1, reply: 1, text: 1 });
  assert.equal(c.metrics.M3.value, 0, 'an act, a result and a closing line are not polling');
  assert.equal(c.metrics.M3.closingTextTurns, 1);
  assert.match(c.metrics.M2.source, /seat log/);
  assert.equal(c.metrics.M6.onboardingBytes > 0, true);
  assert.ok(c.metrics.M6.value > 0);
});

test('M1 separates refusal classes; M2 and M3 see the repair and the polling; M4 names its basis', () => {
  const dir = run({ seats: { bo: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [listen(0, 'msg_b', 'Sit on the bench')],
    transcript: [{ type: 'harness_user', turn: 1, text: 'wake', _rx: at(0) }, ...events(1, [
      { sec: 1, tools: [ack('msg_b')] },
      { sec: 2, tools: [['node eden.mjs here', { here: true }]] },
      { sec: 3, tools: [act('sit on the bench', no('capability.choose'))] },
      { sec: 4, tools: [act('sit:bench', no('seat.taken'))] },
      { sec: 5, tools: [act('sit:bench2', no('soul.busy'))] },
      { sec: 6, tools: [act('sit:bench2', no('zebra.striped'))] },
      { sec: 7, tools: [act('sit:bench3', 'not json at all')] },
      { sec: 8, tools: [act('sit:bench2', ok('r2', 'sit:bench2', 'started', 'msg_b', { events: [{ kind: 'receipt', at: at(8.5), receipt: { id: 'r2', phase: 'started' } }, { kind: 'activity.observed', at: at(9), receipt: { id: 'r2', phase: 'started' }, action: { status: 'executing' } }] }))] },
      { sec: 9, tools: [['node eden.mjs receipt r2', { phase: 'started' }]] },
      { sec: 10, tools: [result('msg_b')] },
    ])],
  } } });
  const c = scoreRun(loadSoulRun(dir));
  const m1 = c.metrics.M1;
  assert.deepEqual(m1.classes, { offer: 1, offerResolution: 1, offerRoute: 0, state: 1, admission: 1 });
  assert.equal(m1.denominator, 4, 'six acts less one unclassified and one unreadable');
  assert.equal(m1.value, 0.75, 'only the offer refusal counts against');
  assert.deepEqual([m1.missing.unclassified, m1.missing.unreadable], [1, 1], 'unknown is counted, not zero');
  assert.deepEqual(m1.unclassifiedCodes, ['zebra.striped']);
  assert.equal(m1.firstActOfIntention.value, 0, 'the first act of the one intention was an offer refusal');
  assert.equal(c.metrics.M2.value, 10, 'every decision after delivery belongs to the one intention');
  assert.equal(c.metrics.M3.value, 2, 'here and receipt are the two polls');
  assert.equal(c.metrics.M4.value, 8.5, 'delivery to the receipt\'s started event');
  assert.deepEqual(c.metrics.M4.bases, { 'receipt started event': 1 });
  assert.equal(c.metrics.M4.upperBound, true);
  assert.equal(c.guardrails.G1.value, 0, 'the seated receipt supports the done claim');
});

test('M7: chat keeps an errand, a cancel is honoured, a newer body request replaces, and a lost errand shows', () => {
  const dir = run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [listen(0, 'msg_e', 'Walk to the orchard and sit'), listen(5, 'msg_c', 'lovely morning!'), listen(40, 'msg_x', 'Walk to the pond'), listen(45, 'msg_s', 'actually stop, never mind'), listen(70, 'msg_y', 'Walk to the mill'), listen(75, 'msg_z', 'Go to the hall')],
    transcript: events(1, [
      { sec: 1, tools: [ack('msg_e')] },
      { sec: 2, tools: [act('walk to the orchard', ok('r_e', 'walk:orchard', 'started', 'msg_e'))] },
      { sec: 6, tools: [ack('msg_c', 'It is')] },
      { sec: 7, tools: [['node eden.mjs say "Lovely"', { said: {} }]] },
      { sec: 8, tools: [result('msg_c')] },
      { sec: 30, tools: [['node eden.mjs receipt r_e', { phase: 'completed' }]] },
      { sec: 31, tools: [result('msg_e')] },
      { sec: 41, tools: [ack('msg_x')] },
      { sec: 42, tools: [act('walk to the pond', ok('r_x', 'walk:pond', 'started', 'msg_x'))] },
      { sec: 46, tools: [ack('msg_s')] },
      { sec: 47, tools: [act('stand:here', ok('r_s', 'stand:here', 'completed', 'msg_s'))] },
      { sec: 48, tools: [result('msg_s')] },
      { sec: 49, tools: [result('msg_x', 'failed')] },
      { sec: 71, tools: [ack('msg_y')] },
      { sec: 72, tools: [act('walk to the mill', ok('r_y', 'walk:mill', 'started', 'msg_y'))] },
      { sec: 76, tools: [ack('msg_z')] },
      { sec: 77, tools: [act('walk to the hall', ok('r_z', 'walk:hall', 'completed', 'msg_z'))] },
      { sec: 78, tools: [result('msg_z')] },
      { sec: 79, tools: [result('msg_y', 'failed')] },
    ]),
  } } });
  const c = scoreRun(loadSoulRun(dir));
  const by = Object.fromEntries(c.intentions.map((i) => [i.id, i]));
  assert.equal(by.msg_c.kind, 'spoken-request', 'closed with result, no body act');
  assert.deepEqual([by.msg_e.retention.disturbedBy, by.msg_e.retention.state], ['chat', 'kept']);
  assert.deepEqual([by.msg_x.retention.disturbedBy, by.msg_x.retention.state], ['cancel', 'kept']);
  assert.deepEqual([by.msg_y.retention.disturbedBy, by.msg_y.retention.state], ['redirect', 'replaced']);
  assert.equal(c.metrics.M7.value, 1);
  assert.equal(c.metrics.M7.denominator, 2, 'a replaced intention leaves the denominator');
  assert.equal(c.metrics.M7.replaced, 1);
  assert.equal(c.metrics.M2.spokenRequests.denominator, 1, 'chat closed by result is reported apart from body intentions');
  assert.equal(c.metrics.M5.corrections, 1, 'only the message opening with correcting words');
  assert.equal(by.msg_s.correctionBasis, 'text');
});

test('M4 is never negative: a message first seen in the output of the act that started the receipt counts from when it was sent', () => {
  const dir = run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }],
    transcript: events(1, [{ sec: 1, tools: [act('walk to the hall', { accepted: true, for: 'msg_a', receipt: { id: 'r_a', capability: 'walk:hall', phase: 'started' }, ownerMessages: [{ id: 'msg_a', text: 'Walk to the hall', sentAt: at(0) }], events: [{ kind: 'receipt', at: at(0.5), receipt: { id: 'r_a', phase: 'started' } }] })] }]),
  } } });
  assert.equal(scoreRun(loadSoulRun(dir)).metrics.M4.value, 0.5);
});

test('a traced run says why its turns come from the seat log', () => {
  const dir = run({ receipt: { diagnostics: { capture: { seats: {} } } }, seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }], listen: [listen(0, 'msg_a', 'Walk')],
    transcript: events(1, [{ sec: 1, tools: [ack('msg_a')] }]),
  } } });
  assert.match(scoreRun(loadSoulRun(dir)).sourceNote, /nothing in tools\/playtest writes it yet/);
});

test('words in the middle of a brief are neither a correction nor a cancel', () => {
  const dir = run({ seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }],
    listen: [listen(0, 'msg_a', 'Please stop by the mill, instead of the shop, on the way')],
    transcript: events(1, [{ sec: 1, tools: [ack('msg_a')] }, { sec: 2, tools: [act('stop by the mill', ok('r_a', 'walk:mill', 'completed', 'msg_a'))] }, { sec: 3, tools: [result('msg_a')] }]),
  } } });
  const [i] = scoreRun(loadSoulRun(dir)).intentions;
  assert.equal(i.correction, false);
  assert.equal(i.cancel, false);
});

test('a script entry marked correction is the spec\'s word, over the text', () => {
  const dir = run({ scenario: { director: { mode: 'scripted', script: [{ seat: 'ada', atSec: 0, channel: 'card', text: 'The hall, please', correction: true }] } }, seats: { ada: {
    turns: [{ turn: 1, reason: 'wake' }], listen: [listen(0, 'msg_a', 'The hall, please')],
    transcript: events(1, [{ sec: 1, tools: [ack('msg_a')] }, { sec: 2, tools: [act('walk to the hall', ok('r_a', 'walk:hall', 'completed', 'msg_a'))] }, { sec: 3, tools: [result('msg_a')] }]),
  } } });
  const c = scoreRun(loadSoulRun(dir));
  assert.equal(c.metrics.M5.corrections, 1);
  assert.deepEqual(c.metrics.M5.bases, { spec: 1 });
  assert.equal(c.metrics.M5.scriptFixed, true, 'a scripted director cannot show repair burden, and the card says so');
});

test('unknown is not zero: no transcript means no number, and the seat is named', () => {
  const dir = run({ seats: { ada: { turns: [{ turn: 1, reason: 'wake' }] } } });
  const c = scoreRun(loadSoulRun(dir));
  for (const k of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']) { assert.equal(c.metrics[k].value, null, k); assert.equal(c.metrics[k].status, 'unknown', k); assert.ok(c.metrics[k].reason, k); }
  assert.equal(c.guardrails.G1.value, null);
  assert.equal(c.guardrails.G3.value, null, 'no tick-validity');
  assert.deepEqual(c.metrics.M1.missing.seatsWithoutTranscript, ['ada']);
});

test('a false done claim shows in G1; a stalled seat shows in G2; tick health comes from the receipt', () => {
  const dir = run({ receipt: { evidence: { tickValidity: { valid: true, ticks: 1200, seconds: 60 } } }, seats: {
    ada: { turns: [{ turn: 1, reason: 'wake' }], listen: [listen(0, 'msg_a', 'Walk to the hall')],
      transcript: events(1, [{ sec: 1, tools: [ack('msg_a')] }, { sec: 2, tools: [act('walk to the hall', ok('r_a', 'walk:hall', 'failed', 'msg_a'))] }, { sec: 3, tools: [result('msg_a')] }]) },
    bo: { turns: [{ turn: 1, reason: 'wake' }], listen: [listen(0, 'msg_b', 'Walk to the mill')],
      transcript: events(1, [{ sec: 1, tools: [ack('msg_b')] }, { sec: 2, tools: [act('walk to the mill', ok('r_b', 'walk:mill', 'completed', 'msg_b'))] }, { sec: 3, tools: [result('msg_b')] }]) },
  } });
  const c = scoreRun(loadSoulRun(dir));
  assert.equal(c.guardrails.G1.value, 1);
  assert.equal(c.guardrails.G1.denominator, 2);
  assert.deepEqual(c.guardrails.G2.stalled, ['ada']);
  assert.equal(c.guardrails.G3.value, 20);
  assert.equal(c.metrics.M1.acceptedThenFailed, 1, 'accepted is not done: the world\'s later failure is listed');
});

test('receipt outcome reads the world, in order of what it can prove', () => {
  const step = (o, verb = 'act', args = []) => ({ verb, args, out: o });
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'started' } })]), 'started');
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'started' } }), step({ phase: 'completed' }, 'receipt', ['r'])]), 'completed');
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'failed' } })]), 'failed');
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'started' }, events: [{ kind: 'activity.observed', receipt: { id: 'r', phase: 'started' }, action: { status: 'executing' } }] })]), 'ongoing');
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'started' } })], [{ receipts: [{ id: 'r', phase: 'replaced' }] }]), 'cut-short');
  assert.equal(receiptOutcome('r', [step({ receipt: { id: 'r', phase: 'started' } })], [{ receipts: [{ id: 'r', phase: 'replaced', endedAt: { posture: 'seated' } }] }]), 'ongoing', 'a sit replaced while seated was reached');
});

test('decision kinds: the strongest thing the decision did', () => {
  assert.equal(decisionKind(['ack', 'act']), 'act');
  assert.equal(decisionKind(['ack', 'say']), 'say');
  assert.equal(decisionKind(['here', 'ack']), 'reply');
  assert.equal(decisionKind(['wait']), 'wait');
  assert.equal(decisionKind(['here', 'caps']), 'read');
  assert.equal(decisionKind([null]), 'other');
  assert.equal(decisionKind([], true), 'text');
});

test('evaluate writes scorecard.json, lists M1-G3 as measures, and A5: only a run whose spec hashed this scorer is predeclared', async () => {
  const seats = { ada: { turns: [{ turn: 1, reason: 'wake' }], listen: [listen(0, 'msg_a', 'Walk to the hall')],
    transcript: events(1, [{ sec: 1, tools: [ack('msg_a')] }, { sec: 2, tools: [act('walk to the hall', ok('r_a', 'walk:hall', 'completed', 'msg_a'))] }, { sec: 3, tools: [result('msg_a')] }]) } };
  const hash = sha256(readFileSync(new URL('./controllability.mjs', import.meta.url)));
  const yes = run({ seats, receipt: { spec: { effective: { scorer: { ...SCORER, sha256: hash } } } } });
  const { dir: out } = await evaluateRun(yes);
  assert.ok(readdirSync(out).includes('scorecard.json'));
  const card = JSON.parse(readFileSync(join(out, 'scorecard.json'), 'utf8'));
  assert.equal(card.schema, 'soul-run-scorecard/1');
  assert.equal(card.scorer.predeclared, true);
  assert.equal(card.scorer.sha256, hash);
  assert.match(readFileSync(join(out, 'EVALUATION.md'), 'utf8'), /Controllability scorecard/);
  const { evaluation: e } = await evaluateRun(yes, { write: false });
  assert.deepEqual(e.measures.filter((m) => m.family === 'controllability').map((m) => m.id.split('-')[0]), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'G1', 'G2', 'G3']);
  const changed = run({ seats, receipt: { spec: { effective: { scorer: { ...SCORER, sha256: 'f'.repeat(64) } } } } });
  const c1 = (await evaluateRun(changed, { write: false })).scorecard;
  assert.equal(c1.scorer.predeclared, false);
  assert.match(c1.scorer.note, /changed since the run/);
  const earlier = run({ seats });
  const c2 = (await evaluateRun(earlier, { write: false })).scorecard;
  assert.equal(c2.scorer.predeclared, false);
  assert.match(c2.scorer.note, /no scorer hash/);
});

test('owner messages reach the scorecard from listen, from an act\'s output, and from the id the seat answers', () => {
  const dir = run({ seats: { ada: { listen: [listen(5, 'msg_l', 'from listen')] } } });
  const steps = [
    { verb: 'act', args: [], atMs: at(10), doneMs: at(11), out: { ownerMessages: [{ id: 'msg_o', text: 'from act', sentAt: at(9) }] } },
    { verb: 'ack', args: ['msg_n', 'ok'], atMs: at(12), out: {} },
  ];
  const ms = ownerMessages(join(dir, 'playtest'), 'ada', steps);
  assert.deepEqual(ms.map((m) => [m.id, m.deliveredBy]), [['msg_l', 'listen'], ['msg_o', 'act'], ['msg_n', 'ack']]);
  assert.equal(seatDecisions(join(dir, 'nowhere')).decisions.length, 0);
  assert.equal(seatSteps(join(dir, 'nowhere'), 'ada').length, 0);
});
