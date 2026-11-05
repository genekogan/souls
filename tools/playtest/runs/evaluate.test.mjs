// Soul Runs evaluation (#753): synthetic run folders in the shape SR1/SR2 write (run receipt, director records, seat
// transcripts with every CLI call), scored offline. No world, controller, network or model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateRun, compareRunSet, cliArgs, joinRequests, loadSoulRun, answerQuestion, renderIndex, indexSources, directionsMeasure } from './evaluate.mjs';
import { validateSpec } from './spec.mjs';

const Q = (f) => new URL(`./questions/${f}`, import.meta.url).pathname;
const T0 = Date.parse('2026-11-04T07:27:50.000Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();
const w = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 1)); };
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** A transcript in the scripted-owner / Claude stream shape: each [atSec, command, output, isError?]. */
function transcript(calls) {
  const out = [{ type: 'harness_user', text: 'wake', turn: 2 }];
  calls.forEach(([sec, command, output, isError = false], i) => {
    out.push({ type: 'assistant', turn: 2, _rx: T0 + sec * 1000, message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command } }] } });
    out.push({ type: 'user', turn: 2, _rx: T0 + sec * 1000 + 50, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: JSON.stringify(output), is_error: isError }] } });
  });
  return jl(out);
}
const walk = (mid, cap, phase, wait = true) => ({ accepted: true, ...(wait ? { waited: '30s' } : {}), receipt: { id: `r-${mid}`, capability: cap, phase }, for: mid });

/** A trio-shaped run: Bo walks to the orchard, is redirected at 9 s, walks to the hall. opts vary one thing at a time. */
function makeRun(opts = {}) {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'sr-eval-'));
  const dir = join(root, opts.name ?? 'trio-1'), p = join(dir, 'playtest');
  const script = opts.script ?? [{ seat: 'bo', atSec: 0, channel: 'card', text: 'Walk to the orchard', budgetSec: 100 }, { seat: 'bo', atSec: 9, channel: 'card', text: 'Change of plan: the pond hall instead', budgetSec: 100 }];
  const scenario = { name: 'sr-trio', seed: 7, world: { kind: 'dev', genesis: 'worlds/templates/hello-hamlet.json', port: opts.port ?? 4321 }, durationSec: 60, seats: [{ id: 'bo', adapter: 'scripted-owner', soulName: 'Bo', script: { rules: [] } }], director: { mode: 'scripted', sequential: false, script },
    // A recorded run's observer metadata, as lifecycle.mjs writes it: per-run identity next to the requested world time.
    ...(opts.record ? { observer: { record: ['follow'], recordMeta: { runId: opts.name ?? 'trio-1', attempt: 1, worldTimeRequested: opts.record.time ?? { timeOfDay: 12, timeScale: 0 }, specSha256: 'spec', effectiveSpecSha256: `eff-${opts.port ?? 4321}`, source: { commit: opts.commit ?? 'c0ffee', dirtyTrackedFiles: opts.dirty ?? 0 } } } } : {}) };
  w(join(dir, 'scenario.effective.json'), scenario);
  w(join(p, 'scenario.json'), { ...scenario, scenarioPath: join(dir, 'scenario.effective.json'), serverRoot: '/srv', scenarioSha256: 'x' });
  for (const [n, s] of ['0-preflight', '1-provision', '2-seats', '3-play', '4-close', '5-review', '7-report'].entries()) w(join(p, 'receipts', `${s}.json`), { step: s.slice(2), ok: true, ...(n === 5 ? { requests: 0 } : {}) });
  w(join(p, 'world.json'), { startedAt: iso(-10) });
  const m1 = 'msg_1', m2 = 'msg_2';
  w(join(p, 'personas/bo/decisions.jsonl'), jl([
    { t: iso(0), seat: 'bo', mode: 'scripted', scripted: script[0], delivered: { requestId: 'bo-001', channel: 'card', messageId: m1 } },
    { t: iso(9), seat: 'bo', mode: 'scripted', scripted: script[1], delivered: { requestId: 'bo-002', channel: 'card', messageId: m2 } },
  ]));
  w(join(p, 'personas/bo/requests.jsonl'), jl([
    { t: iso(40), requestId: 'bo-002', cutoffReason: 'result', openSec: 31, resultText: 'At the hall' },
    { t: iso(100), requestId: 'bo-001', cutoffReason: opts.director001 ?? 'budget', openSec: 100 },
  ]));
  const hallPhase = opts.hallPhase ?? 'completed';
  const calls = opts.calls ?? [
    [0.05, `node eden.mjs ack ${m1} "Walking to the orchard"`, { acked: m1 }],
    [0.1, 'node eden.mjs act "walk to the orchard"', walk(m1, 'walk:flag-orchard', 'started', false)],
    ...(opts.neverClose ? [] : [[9.05, `node eden.mjs result ${m1} failed "My owner changed the plan"`, { reported: m1, outcome: 'failed' }]]),
    [9.1, `node eden.mjs ack ${m2} "Turning around"`, { acked: m2 }],
    [9.2, 'node eden.mjs act "walk to the pond hall" --wait 100', hallPhase === 'error' ? { accepted: false, code: 'no-route' } : walk(m2, 'walk:lab-pond-hall', hallPhase)],
    [40, `node eden.mjs result ${m2} done "At the hall"`, { reported: m2, outcome: 'done' }],
  ];
  w(join(p, 'seats/bo/seat.json'), { id: 'bo', adapter: 'scripted-owner', model: null, effort: null, ownerIdentity: 'agent-secret' });
  if (!opts.noTranscript) w(join(p, 'seats/bo/transcript.jsonl'), transcript(calls));
  w(join(p, 'seats/bo/turns.jsonl'), jl([{ turn: 1, reason: 'onboard', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }, { turn: 2, reason: 'wake', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }]));
  w(join(p, 'seats/bo/folder/eden.mjs'), '// served CLI; never indexed');
  if (!opts.noTick) w(join(p, 'server/tick-validity.json'), { valid: true, ticks: 1200, seconds: 60, clockRate: 1 });
  if (opts.packs) for (const pk of opts.packs) w(join(p, 'evidence', `${pk.requestId}.json`), pk);
  if (opts.setup) w(join(dir, 'setup.json'), opts.setup);
  if (!opts.plain) w(join(dir, 'run-receipt.json'), {
    soulRun: 1, runId: opts.name ?? 'trio-1', status: opts.status ?? 'completed',
    spec: { sha256: 'spec', effective: { arm: opts.arm ?? null, world: { source: { kind: 'genesis', path: 'worlds/templates/hello-hamlet.json', sha256: 'a'.repeat(64) } }, setup: null, ...(opts.evaluation ? { evaluation: opts.evaluation } : {}) } },
    source: { commit: opts.commit ?? 'c0ffee', dirtyTrackedFiles: opts.dirty ?? 0, node: 'v26', ...((opts.tools ?? opts.toolsCommit) ? { serverRoot: { commit: opts.commit ?? 'c0ffee', dirtyTrackedFiles: opts.dirty ?? 0 }, tools: opts.tools ?? { commit: opts.toolsCommit, dirtyTrackedFiles: opts.toolsDirty ?? 0 } } : {}) },
    preflight: { scenario: { checks: { laptopLoad: [opts.load ?? 2], freeGb: 50, machineOk: true } } },
    observer: opts.observerOk ? { ok: true } : { ok: false, stage: 'import', owner: '#633' },
    evidence: { cli: opts.cli ?? '2.7.1', skill: opts.skill ?? '2.7.1', build: 'dev', ...(opts.noTick ? {} : { tickValidity: { valid: true, ticks: 1200, seconds: 60, clockRate: 1 } }) },
    cost: { wallMs: 61000, executeMs: 60800, lifecycleOverheadMs: 200 },
  });
  return dir;
}
const M = (e, id) => e.measures.find((m) => m.id === id);

test('cliArgs reads the served CLI calls the transcript records', () => {
  assert.deepEqual(cliArgs('node eden.mjs result msg_1 failed "My owner \\"changed\\" it"'), ['result', 'msg_1', 'failed', 'My owner "changed" it']);
  assert.deepEqual(cliArgs('curl -fsSo eden.mjs http://x'), []);
});

test('a completed run: separate measure families with units and denominators; observer-only measures are unavailable, not 0', async () => {
  const dir = makeRun();
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('evaluate must not use the network'); };
  try {
    const { evaluation: e, dir: out } = await evaluateRun(dir, { questions: [Q('redirect-honoured.mjs'), Q('walk-seen.mjs')] });
    assert.deepEqual(e.offline, { worldStarted: false, controllersStarted: false, network: false, modelCalls: 0 });
    assert.equal(M(e, 'ackSec').unit, 's'); assert.equal(M(e, 'ackSec').denominator, 2); assert.equal(M(e, 'ackSec').family, 'request-latency');
    assert.equal(M(e, 'requestsPhysicallyCompleted').value, 1, 'only the hall walk completed');
    assert.equal(M(e, 'requestsPhysicallyUnknown').value, 1, 'the orchard walk started without a wait');
    assert.equal(M(e, 'requestsPhysicallyCompleted').denominator, 2);
    assert.equal(M(e, 'seatReportedDone').family, 'seat-claims');
    assert.equal(M(e, 'tickRate').value, 20);
    assert.equal(M(e, 'tokens').value, 0); assert.match(M(e, 'tokens').basis, /scripted-owner/);
    assert.equal(M(e, 'walkMps').status, 'unavailable'); assert.equal(M(e, 'walkMps').value, null); assert.match(M(e, 'walkMps').reason, /observer import failed/);
    assert.equal(M(e, 'coLocationRatio').heuristic, true);
    const q = Object.fromEntries(e.questions.map((x) => [x.id, x]));
    assert.equal(q['redirect-honoured'].verdict, 'pass', JSON.stringify(q['redirect-honoured'].notes));
    assert.ok(q['redirect-honoured'].evidence.every((r) => r.path && r.sha256), 'evidence references carry the file hash');
    assert.equal(q['redirect-honoured'].basis, 'exploratory');
    assert.equal(q['walk-seen'].verdict, 'unknown', 'a deliberately absent observation is unknown');
    assert.match(q['walk-seen'].uncertainty, /no observer evidence packs/);
    // The director closed bo-001 by budget although the seat reported failed at once: both records are kept.
    assert.deepEqual(e.conflicts.map((c) => c.kind), ['director-vs-seat']);
    assert.equal(e.sources.unchanged, true);
    assert.ok(!Object.keys(e.sources.index).some((f) => f.includes('/folder/')), 'seat working folders are never indexed');
    assert.ok(!JSON.stringify(e).includes('agent-secret') || JSON.stringify(e.sources.index).includes('seat.json'), 'owner identity is not copied');
    assert.ok(!readFileSync(join(out, 'evaluation.json'), 'utf8').includes('agent-secret'));
    assert.match(readFileSync(join(out, 'EVALUATION.md'), 'utf8'), /redirect-honoured.*\*\*pass\*\*/);
  } finally { globalThis.fetch = realFetch; }
});

test('offline rescore writes a new version and leaves sources and earlier evaluations untouched', async () => {
  const dir = makeRun();
  const before = indexSources(dir);
  const a = await evaluateRun(dir, { questions: [Q('redirect-honoured.mjs')] });
  const first = readFileSync(join(a.dir, 'evaluation.json'), 'utf8');
  const b = await evaluateRun(dir, { questions: [Q('redirect-honoured.mjs'), Q('walk-seen.mjs')] });
  assert.deepEqual(readdirSync(join(dir, 'evaluations')), ['001-v3', '002-v3']);
  assert.equal(readFileSync(join(a.dir, 'evaluation.json'), 'utf8'), first);
  assert.deepEqual(indexSources(dir), before, 'evaluations/ is excluded and no source changed');
  assert.equal(b.evaluation.questions.length, 2);
});

test('failures are scored as failures: no closure before the new request, a failed walk, a done claim over failed acts', async () => {
  const neverClosed = (await evaluateRun(makeRun({ neverClose: true }), { questions: [Q('redirect-honoured.mjs')], write: false })).evaluation;
  assert.equal(neverClosed.questions[0].verdict, 'fail');
  const failedWalk = (await evaluateRun(makeRun({ hallPhase: 'error' }), { questions: [Q('redirect-honoured.mjs')], write: false })).evaluation;
  assert.equal(failedWalk.questions[0].verdict, 'fail');
  assert.ok(failedWalk.conflicts.some((c) => c.kind === 'claim-vs-physical'), 'seat said done though its act failed');
  assert.equal(M(failedWalk, 'requestsPhysicallyCompleted').value, 0);
  const cancelled = (await evaluateRun(makeRun({ status: 'cancelled', calls: [[0.05, 'node eden.mjs ack msg_1 "Walking"', { acked: 'msg_1' }]] }), { questions: [Q('redirect-honoured.mjs')], write: false })).evaluation;
  assert.equal(cancelled.questions[0].verdict, 'unknown', 'a run cancelled before the redirection was taken up is not a failure');
  const notWaited = (await evaluateRun(makeRun({ hallPhase: 'started' }), { questions: [Q('redirect-honoured.mjs')], write: false })).evaluation;
  assert.equal(notWaited.questions[0].verdict, 'unknown', 'a walk whose end was not observed is not a pass');
});

test('missing evidence stays unknown or unavailable; a scorer that cites nothing, throws or invents a verdict is not believed', async () => {
  const e = (await evaluateRun(makeRun({ noTranscript: true, noTick: true }), { questions: [Q('redirect-honoured.mjs')], write: false })).evaluation;
  assert.equal(M(e, 'requestsPhysicallyCompleted').status, 'unavailable');
  assert.equal(M(e, 'tickRate').status, 'unavailable');
  assert.equal(M(e, 'ackSec').status, 'unavailable', 'no transcript: no seat timing, not a median of nothing');
  assert.equal(M(e, 'unacked').status, 'unavailable', 'a deleted transcript is not seven unacked requests');
  assert.equal(M(e, 'directorOpenSec').status, 'measured', 'the director\'s own records still count');
  assert.equal(e.questions[0].verdict, 'unknown', 'without the transcript the closure cannot be read');
  const ctx = { requests: [], observer: { available: false } };
  const q = (score) => ({ id: 'x', version: 1, question: 'x?', path: 'x.mjs', sha256: 'h', score });
  assert.equal((await answerQuestion(q(() => ({ verdict: 'pass', evidence: [] })), ctx, { predeclared: false })).verdict, 'unknown');
  assert.equal((await answerQuestion(q(() => { throw new Error('boom'); }), ctx, { predeclared: false })).verdict, 'unknown');
  assert.equal((await answerQuestion(q(() => ({ verdict: 'probably', evidence: [{ path: 'a' }] })), ctx, { predeclared: false })).verdict, 'unknown');
  const plain = loadSoulRun(makeRun({ plain: true }));
  assert.equal(plain.kind, 'playtest'); assert.equal(joinRequests(plain).length, 2);
});

test('observer evidence packs answer the question that needs them', async () => {
  const pack = (requestId, xs) => ({ requestId, seat: 'bo', channel: 'card', text: 't', sentAt: iso(9), cutoffAt: iso(40), samples: xs.map((x, i) => ({ t: iso(9 + i * 5), pos: [x, 0, 0] })), receipts: [] });
  const moved = (await evaluateRun(makeRun({ observerOk: true, packs: [pack('bo-002', [0, 3, 8])] }), { questions: [Q('walk-seen.mjs')], write: false })).evaluation;
  assert.equal(moved.questions[0].verdict, 'pass');
  assert.equal(moved.coverage.observerEvidencePacks, 1);
  assert.equal(M(moved, 'oracles').status, 'measured', 'the review oracles run offline over the packs');
  const still = (await evaluateRun(makeRun({ observerOk: true, packs: [pack('bo-002', [0, 0.2, 0.3])] }), { questions: [Q('walk-seen.mjs')], write: false })).evaluation;
  assert.equal(still.questions[0].verdict, 'fail');
});

test('the setup question: no setup or no recorded ids is unknown; a recorded setup entity passes, another entity fails', async () => {
  const sit = { accepted: true, waited: '61s', receipt: { id: 'r9', capability: 'sit:e_39', phase: 'started' }, for: 'msg_1', events: [{ kind: 'receipt', where: { place: 'Glazed Court' } }, { kind: 'activity.observed', receipt: { id: 'r9' }, action: { status: 'executing' }, body: { posture: 'seated' } }] };
  const calls = [[0.05, 'node eden.mjs ack msg_1 "Going to sit"', { acked: 'msg_1' }], [0.1, 'node eden.mjs act "sit on the bench" --wait 60', sit], [61, 'node eden.mjs result msg_1 done "Seated"', { reported: 'msg_1', outcome: 'done' }]];
  const setup = { ok: true, batches: [{ id: 'garden-bench', accepted: true, seq: 8 }] };
  const none = (await evaluateRun(makeRun({ calls }), { questions: [Q('setup-bench-sat.mjs')], write: false })).evaluation;
  assert.equal(none.questions[0].verdict, 'unknown');
  const unlinked = (await evaluateRun(makeRun({ calls, setup }), { questions: [Q('setup-bench-sat.mjs')], write: false })).evaluation;
  assert.equal(unlinked.questions[0].verdict, 'unknown'); assert.match(unlinked.questions[0].uncertainty, /does not record the entity ids/);
  assert.match(unlinked.questions[0].notes[0], /e_39 in Glazed Court/);
  assert.equal(M(unlinked, 'requestsPhysicallyOngoing').value, 1, 'seated counts as ongoing, not completed');
  // #784: setup.json lists the entities each accepted batch created; the question matches the sat-on id exactly.
  const withEntities = (entities) => ({ ...setup, batches: [{ ...setup.batches[0], entities }] });
  const linked = (await evaluateRun(makeRun({ calls, setup: withEntities([{ id: 'e_39', op: 'place', opIndex: 0, name: 'sr-court-bench', def: 'core/bench@1' }]) }), { questions: [Q('setup-bench-sat.mjs')], write: false })).evaluation;
  assert.equal(linked.questions[0].verdict, 'pass'); assert.match(linked.questions[0].notes[0], /e_39, created by setup batch garden-bench \(place sr-court-bench\)/);
  const other = (await evaluateRun(makeRun({ calls, setup: withEntities([{ id: 'e_390', op: 'place', opIndex: 0 }, { id: 'e_39', op: 'move', opIndex: 1 }]) }), { questions: [Q('setup-bench-sat.mjs')], write: false })).evaluation;
  assert.equal(other.questions[0].verdict, 'fail', 'a different (or only moved) entity is not the setup bench; no substring match');
  assert.match(other.questions[0].uncertainty, /not on an entity the setup created \(e_390\)/);
});

test('predeclared questions come from the spec and are kept apart from exploratory ones; a changed scorer is not trusted', async () => {
  const v = validateSpec({ soulRun: 1, scenario: 'tools/playtest/scenarios/soul-runs/hamlet-trio.json', evaluation: { questions: ['tools/playtest/runs/questions/redirect-honoured.mjs'] } }, { serverRoot: new URL('../../../', import.meta.url).pathname });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const declared = v.effective.evaluation.questions;
  assert.equal(declared[0].id, 'redirect-honoured'); assert.match(declared[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(validateSpec({ soulRun: 1, scenario: 'x', evaluation: { questions: 'nope', other: 1 } }).errors.map((x) => x.code).sort(), ['evaluation.questions', 'evaluation.unknown-field']);
  const e = (await evaluateRun(makeRun({ evaluation: { questions: declared } }), { questions: [Q('walk-seen.mjs')], write: false })).evaluation;
  assert.deepEqual(e.acceptance.predeclared.map((q) => `${q.id}:${q.verdict}`), ['redirect-honoured:pass']);
  assert.deepEqual(e.questions.map((q) => `${q.id}:${q.basis}`), ['walk-seen:exploratory']);
  const stale = (await evaluateRun(makeRun({ evaluation: { questions: [{ ...declared[0], sha256: 'f'.repeat(64) }] } }), { write: false })).evaluation;
  assert.equal(stale.acceptance.predeclared[0].verdict, 'unknown'); assert.match(stale.acceptance.predeclared[0].uncertainty, /hash mismatch/);
});

test('comparison keeps every attempt, pools completed repeats within an arm and flags incompatible arms', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-cmp-'));
  const a = makeRun({ root, name: 'trio-1', port: 4321 });
  const b = makeRun({ root, name: 'trio-2', port: 4322, load: 9 });
  const c = makeRun({ root, name: 'trio-cancel', status: 'cancelled' });
  const d = makeRun({ root, name: 'trio-other', script: [{ seat: 'bo', atSec: 0, channel: 'card', text: 'Walk to the orchard', budgetSec: 60 }, { seat: 'bo', atSec: 9, channel: 'card', text: 'Change of plan: the pond hall instead', budgetSec: 100 }] });
  const plain = makeRun({ root, name: 'plain-1', plain: true });
  mkdirSync(join(root, 'set'), { recursive: true });
  writeFileSync(join(root, 'set', 'replay-set.json'), JSON.stringify({ version: 1, runs: [{ label: 'trio', exits: [{ dir: plain, exit: 0 }, { dir: join(root, 'gone'), exit: 1 }] }] }));
  const ix = await compareRunSet([a, b, c, d, join(root, 'set')], { questions: [Q('redirect-honoured.mjs')] });
  assert.equal(ix.attempts.length, 6, 'every attempt is kept, including cancelled and missing');
  assert.deepEqual(ix.attempts.find((x) => x.runId === 'gone'), { runId: 'gone', from: 'replay-set set:trio', status: 'missing', arm: null, note: 'listed but not on disk' });
  const main = ix.arms.find((x) => x.attempts.some((t) => t.runId === 'trio-1'));
  assert.deepEqual(main.attempts.map((t) => `${t.runId}:${t.status}`), ['trio-1:completed', 'trio-2:completed', 'trio-cancel:cancelled']);
  assert.deepEqual(main.repeats, ['trio-1', 'trio-2'], 'a cancelled attempt is kept but is not a repeat');
  // A plain playtest run of the same scenario has no hashed world source, so it cannot be shown identical: its own arm.
  const plainArm = ix.arms.find((x) => x.attempts.some((t) => t.runId === 'plain-1'));
  // It also has no receipt, so its condition identity is unrecorded: each field is named, never assumed equal.
  assert.deepEqual(ix.incompatible.find((x) => x.arms.includes(main.arm) && x.arms.includes(plainArm.arm)).differ, ['worldSource', 'serverCommit', 'serverDirtyTrackedFiles', 'cli', 'skill']);
  assert.deepEqual(main.conditionsDiffer, [], 'port and machine load are listed per attempt, not arm identity');
  assert.equal(main.measures.tickRate.median, 20);
  assert.equal(main.questions['redirect-honoured'].pass, 2);
  const other = ix.arms.find((x) => x.attempts.some((t) => t.runId === 'trio-other'));
  assert.notEqual(other.arm, main.arm);
  const flag = ix.incompatible.find((x) => x.arms.includes(main.arm) && x.arms.includes(other.arm));
  assert.ok(flag.differ.includes('director') && flag.differ.includes('scenario'), JSON.stringify(flag));
  assert.match(ix.pooled, /never averaged together/);
  assert.match(renderIndex(ix), /Incompatible arms/);
  assert.ok(!existsSync(join(a, 'evaluations')), 'compare evaluates in memory and writes nothing into the runs');
  // A traced seat (#752) is its own arm, but two traced repeats are one arm despite their run-specific trace files.
  const traced = (name) => { const dir = makeRun({ root, name }); for (const f of ['scenario.effective.json', 'playtest/scenario.json']) { const sc = JSON.parse(readFileSync(join(dir, f), 'utf8')); sc.seats[0].diagnostics = { trace: { tap: 'file:///t.mjs', file: `${dir}/diagnostics/bo.trace.jsonl`, run: name, seat: 'bo' } }; writeFileSync(join(dir, f), JSON.stringify(sc)); } return dir; };
  const tx = await compareRunSet([a, traced('t-1'), traced('t-2')]);
  assert.deepEqual(tx.arms.map((x) => x.repeats), [['trio-1'], ['t-1', 't-2']]);
});

test('compare separates runs served by a different server, tools checkout or CLI/skill, names each difference, and pools them only with --pool (#839)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-cond-'));
  const base = [makeRun({ root, name: 'base-1', commit: 'aaaa1111bbbb', port: 4321 }), makeRun({ root, name: 'base-2', commit: 'aaaa1111bbbb', port: 4322 })];
  const cand = [makeRun({ root, name: 'cand-1', commit: 'cccc2222dddd', cli: '2.8.1', skill: '2.8.1' }), makeRun({ root, name: 'cand-2', commit: 'cccc2222dddd', cli: '2.8.1', skill: '2.8.1' })];
  const dirty = makeRun({ root, name: 'dirty-1', commit: 'aaaa1111bbbb', dirty: 3 });
  const ix = await compareRunSet([...base, ...cand, dirty]);
  const armOf = (x, id) => x.arms.find((a) => a.attempts.some((t) => t.runId === id));
  assert.equal(ix.arms.length, 3, JSON.stringify(ix.arms.map((a) => a.attempts.map((t) => t.runId))));
  assert.deepEqual(armOf(ix, 'base-1').repeats, ['base-1', 'base-2'], 'identical identities still pool (A3)');
  assert.deepEqual(armOf(ix, 'cand-1').repeats, ['cand-1', 'cand-2']);
  assert.deepEqual(armOf(ix, 'base-1').condition, { serverCommit: 'aaaa1111bbbb', serverDirtyTrackedFiles: 0, toolsCommit: null, toolsDirtyTrackedFiles: null, cli: '2.7.1', skill: '2.7.1' });
  const pair = (x, i, j) => x.incompatible.find((p) => p.arms.includes(armOf(x, i).arm) && p.arms.includes(armOf(x, j).arm));
  assert.deepEqual(pair(ix, 'base-1', 'cand-1').differ, ['serverCommit', 'cli', 'skill']);
  assert.deepEqual(pair(ix, 'base-1', 'cand-1').values.cli, ['2.7.1', '2.8.1']);
  assert.deepEqual(pair(ix, 'base-1', 'dirty-1').differ, ['serverDirtyTrackedFiles'], 'uncommitted tracked files on the same commit are a different server');
  assert.match(armOf(ix, 'dirty-1').caveats.join(' '), /source not exactly identified for dirty-1/);
  const md = renderIndex(ix);
  assert.match(md, /3 arm\(s\)/); assert.match(md, /serverCommit \(aaaa1111 vs cccc2222\), cli \(2\.7\.1 vs 2\.8\.1\)/); assert.match(md, /Served by: serverCommit aaaa1111, serverDirtyTrackedFiles 0, toolsCommit unrecorded/);
  // Older receipts without the tools source read null on both sides: not a difference (A6). A recorded tools commit is.
  const tools = [makeRun({ root, name: 'tools-1', commit: 'aaaa1111bbbb', tools: { commit: 'eeee3333ffff', dirtyTrackedFiles: 0 } }), makeRun({ root, name: 'tools-2', commit: 'aaaa1111bbbb', tools: { commit: '99998888aaaa', dirtyTrackedFiles: 1 } })];
  const it = await compareRunSet([base[0], ...tools]);
  assert.equal(it.arms.length, 3);
  assert.deepEqual(pair(it, 'tools-1', 'tools-2').differ, ['toolsCommit', 'toolsDirtyTrackedFiles']);
  assert.deepEqual(pair(it, 'base-1', 'tools-1').differ, ['toolsCommit', 'toolsDirtyTrackedFiles']);
  // --pool: one arm across the condition identity, which names what it pooled across and keeps every value (A4).
  const ip = await compareRunSet([...base, ...cand], { pool: true });
  assert.equal(ip.arms.length, 1);
  assert.deepEqual(ip.arms[0].repeats, ['base-1', 'base-2', 'cand-1', 'cand-2']);
  assert.deepEqual(ip.arms[0].pooledAcross, ['serverCommit', 'cli', 'skill']);
  assert.deepEqual(ip.arms[0].conditionValues.cli, { 'base-1': '2.7.1', 'base-2': '2.7.1', 'cand-1': '2.8.1', 'cand-2': '2.8.1' });
  assert.ok(ip.arms[0].conditionsDiffer.includes('commit') && ip.arms[0].conditionsDiffer.includes('cli'));
  assert.match(ip.pooled, /--pool/); assert.equal(ip.poolConditions, true);
  assert.match(renderIndex(ip), /Pooled across serverCommit: base-1 aaaa1111, base-2 aaaa1111, cand-1 cccc2222, cand-2 cccc2222/);
  // What ran and the label separate arms with or without --pool (A2, A4).
  const other = makeRun({ root, name: 'other-1', commit: 'cccc2222dddd', script: [{ seat: 'bo', atSec: 0, channel: 'card', text: 'Walk to the orchard', budgetSec: 60 }] });
  const lab = [makeRun({ root, name: 'lab-a', arm: 'baseline' }), makeRun({ root, name: 'lab-b', arm: 'candidate' })];
  const iq = await compareRunSet([base[0], other, ...lab], { pool: true });
  assert.equal(iq.arms.length, 4);
  assert.deepEqual(pair(iq, 'base-1', 'other-1').differ, ['scenario', 'director']);
  assert.deepEqual(pair(iq, 'lab-a', 'lab-b').differ, ['label']); assert.deepEqual(pair(iq, 'lab-a', 'lab-b').values.label, ['baseline', 'candidate']);
  assert.equal(armOf(iq, 'lab-a').label, 'baseline');
  assert.match(renderIndex(iq), /## Arm `[0-9a-f]{12}` \(candidate\)/);
});

test('compare groups recorded repeats by spec, server and label, not by run id, port or attempt: two arms of two repeats', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-rec-'));
  const run = (name, port, commit, arm, time) => makeRun({ root, name, port, commit, arm, record: time ? { time } : {} });
  const runs = [run('base-1', 4321, 'aaaa1111bbbb', 'baseline'), run('base-2', 4322, 'aaaa1111bbbb', 'baseline'), run('cand-1', 4323, 'cccc2222dddd', 'candidate'), run('cand-2', 4324, 'cccc2222dddd', 'candidate')];
  const ix = await compareRunSet(runs);
  assert.deepEqual(ix.arms.map((a) => a.repeats), [['base-1', 'base-2'], ['cand-1', 'cand-2']], 'each repeat joins its arm despite its own run id and port');
  assert.deepEqual(ix.arms.map((a) => a.label), ['baseline', 'candidate']);
  assert.equal(ix.incompatible.length, 1);
  assert.deepEqual(ix.incompatible[0].differ, ['label', 'serverCommit'], 'the recorded server commit is condition identity, not a scenario difference');
  assert.deepEqual(ix.arms.map((a) => a.caveats ?? []), [[], []], 'two completed repeats per arm');
  assert.match(renderIndex(ix), /4 attempt\(s\), 2 arm\(s\)/);
  // The requested world time is what ran: the same spec at another hour is a different arm.
  const night = await compareRunSet([runs[0], run('night-1', 4325, 'aaaa1111bbbb', 'baseline', { timeOfDay: 0, timeScale: 0 })]);
  assert.equal(night.arms.length, 2);
  assert.deepEqual(night.incompatible[0].differ, ['scenario']);
  // A directed cast's scenario hashes its effective cast file, which carries the port: the run's cast.json minus the
  // port is what counts, so repeats on different ports pool and a different console script does not.
  const directed = (name, port, console) => {
    const dir = makeRun({ root, name, port }), cast = { name: 'trio', world: { kind: 'dev', port }, console: { script: console } };
    w(join(dir, 'playtest', 'cast.json'), cast);
    const f = join(dir, 'playtest', 'scenario.json'), sc = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...sc, castPath: join(dir, 'cast.effective.json'), castSha256: `sha-of-cast-on-${port}` }));
    return dir;
  };
  const say = [{ atSec: 0, text: 'Bo, walk to the orchard' }];
  const dx = await compareRunSet([directed('d-1', 4331, say), directed('d-2', 4332, say), directed('d-other', 4333, [{ atSec: 0, text: 'Bo, sit down' }])]);
  assert.deepEqual(dx.arms.map((a) => a.repeats), [['d-1', 'd-2'], ['d-other']]);
  assert.deepEqual(dx.incompatible[0].differ, ['scenario']);
});

test('directions: the direction journal is counted by command and outcome; each redirection says whether its target spoke after', () => {
  const pt = mkdtempSync(join(tmpdir(), 'sr-dir-'));
  const sr = { playtestDir: pt, at: (...p) => ['playtest', ...p].join('/') };
  assert.equal(directionsMeasure(sr).status, 'unavailable', 'no journal: unavailable, never 0');
  w(join(pt, 'director', 'commands.jsonl'), jl([
    { t: iso(10), elapsedSec: 10, source: 'console', cmd: 'broadcast', target: 'all', outcome: 'applied', requestIds: ['a-001', 'b-001'] },
    { t: iso(12), elapsedSec: 12, source: 'console', cmd: 'error', target: null, outcome: 'refused', reason: 'unknown seat "zed"', requestIds: [] },
    { t: iso(20), elapsedSec: 20, source: 'script', cmd: 'redirect', target: 'b', outcome: 'applied', requestIds: ['b-002'], expect: ['Piano'] },
    { t: iso(25), elapsedSec: 25, source: 'script', cmd: 'redirect', target: 'c', outcome: 'held', reason: 'card not delivered (seat not paired); kept for its turn', requestIds: [] },
    { t: iso(90), elapsedSec: 90, source: 'lifecycle', cmd: 'end', target: 'all', outcome: 'applied', reason: 'lifecycle-cancel', requestIds: [] },
  ]));
  w(join(pt, 'director', 'speech.jsonl'), jl([{ t: iso(15), seat: 'b', atMs: T0 + 15000, text: 'rocks' }, { t: iso(40), seat: 'b', atMs: T0 + 40000, text: 'I love the old piano' }]));
  const m = directionsMeasure(sr);
  assert.deepEqual({ status: m.status, value: m.value, refused: m.refused }, { status: 'measured', value: 5, refused: 1 });
  assert.deepEqual(m.byCommand, { broadcast: { applied: 1, held: 0, refused: 0 }, error: { applied: 0, held: 0, refused: 1 }, redirect: { applied: 1, held: 1, refused: 0 }, end: { applied: 1, held: 0, refused: 0 } });
  assert.deepEqual(m.redirections.map((r) => [r.target, r.atSec, r.outcome, r.spokeAfter, r.expectHeard ?? null]), [['b', 20, 'applied', true, true], ['c', 25, 'held', false, null]]);
  assert.deepEqual(m.sources, ['playtest/director/commands.jsonl', 'playtest/director/speech.jsonl']);
  assert.equal(m.skipped, 0);
  // A killed run's torn last line is skipped and counted; it is not a command and adds no undefined key.
  writeFileSync(join(pt, 'director', 'commands.jsonl'), readFileSync(join(pt, 'director', 'commands.jsonl'), 'utf8') + '{"t":"2026-01-01T00:01:40Z","cmd":"redir');
  const torn = directionsMeasure(sr);
  assert.deepEqual({ value: torn.value, skipped: torn.skipped, keys: Object.keys(torn.byCommand) }, { value: 5, skipped: 1, keys: ['broadcast', 'error', 'redirect', 'end'] });
});

test('compare lists the tools checkout next to the server root; a tools-only difference is its own arm unless --pool (#785, #839)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-tools-'));
  const a = makeRun({ root, name: 'trio-1', port: 4321, toolsCommit: 'aaaa1111bbbb' });
  const b = makeRun({ root, name: 'trio-2', port: 4322, toolsCommit: 'cccc2222dddd', toolsDirty: 3 });
  const old = makeRun({ root, name: 'trio-old', port: 4323, noTools: true });
  assert.equal((await compareRunSet([a, b, old], {})).arms.length, 3, 'the tools checkout is condition identity (#839): separate arms');
  const ix = await compareRunSet([a, b, old], { pool: true });
  assert.equal(ix.arms.length, 1, '--pool pools across the tools checkout and lists it per attempt');
  const arm = ix.arms[0];
  assert.deepEqual([arm.conditions['trio-1'].commit, arm.conditions['trio-1'].toolsCommit], ['c0ffee', 'aaaa1111bbbb']);
  assert.equal(arm.conditions['trio-old'].toolsCommit, null, 'an older receipt without tools reads as unrecorded');
  assert.ok(arm.conditionsDiffer.includes('toolsCommit') && arm.conditionsDiffer.includes('toolsDirtyTrackedFiles'));
  assert.ok(!arm.conditionsDiffer.includes('commit'), 'the server root is the same');
  assert.match(arm.caveats.join(' '), /source not exactly identified for trio-2 \(tools\)/);
  const md = renderIndex(ix);
  assert.match(md, /Conditions differ: toolsCommit, toolsDirtyTrackedFiles/);
  assert.match(md, /trio-1 \(server root c0ffee, tools aaaa1111\); trio-2 \(server root c0ffee, tools cccc2222\+3\); trio-old \(server root c0ffee, tools unrecorded\)/);
});
