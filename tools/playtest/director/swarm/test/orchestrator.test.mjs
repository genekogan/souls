import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonl, readJson, writeJson } from '../../../lib/jsonl.mjs';
import * as evidence from '../../../observer/evidence.mjs';
import { createSwarm } from '../orchestrator.mjs';
import { templateDirections } from '../planner.mjs';
import { verifyRun } from '../verify.mjs';
import { fakeClock, fakeWorld, testCast, WALL0 } from './fakes.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'swarm-test-'));
const planOf = (cast) => ({ source: 'template', seats: Object.fromEntries(cast.order.map((id) => [id, templateDirections(cast, id)])) });

async function play({ cast = testCast(), behaviour = {}, script = null, during = null, onboarding = {}, prepare = null } = {}) {
  const clock = fakeClock(0); const runDir = tmp();
  if (prepare) prepare(runDir);
  const w = fakeWorld({ clock, cast, behaviour });
  for (const [id, v] of Object.entries(onboarding)) w.seats[id].onboarding = v;
  writeJson(join(runDir, 'cast.json'), cast);
  const lines = [];
  const sw = createSwarm({ cast, runDir, seats: w.seats, world: { base: 'http://fake' }, owner: w.owner, truth: w.truth, plan: planOf(cast), clock, wall0: WALL0,
    observer: { cameras: {}, evidence, truth: w.observerTruth }, script, print: (l) => lines.push(l) });
  if (during) during(sw, clock, w);
  const summary = await sw.run();
  const dirs = readJsonl(join(runDir, 'director', 'directions.jsonl'));
  return { runDir, w, sw, summary, dirs, lines, clock, verdict: verifyRun(runDir, cast) };
}
const goes = (dirs) => dirs.filter((d) => d.kind === 'go').map((d) => d.seat);

test('happy path: gather, everyone-present gate, talks in order, prepare ahead, verdict passes', async () => {
  const r = await play();
  assert.equal(r.summary.stopped, 'plan-complete');
  assert.deepEqual(goes(r.dirs), ['ann', 'bob', 'cy']);
  const kinds = r.dirs.map((d) => `${d.kind}:${d.seat}`);
  assert.deepEqual(kinds.slice(0, 3), ['gather:ann', 'gather:bob', 'gather:cy']);
  // bob is prepared right after ann gets her turn, before ann has finished
  assert.ok(kinds.indexOf('prepare:bob') === kinds.indexOf('go:ann') + 1);
  assert.ok(kinds.indexOf('prepare:cy') === kinds.indexOf('go:bob') + 1);
  // every direction has a reason and went through the card
  for (const d of r.dirs) { assert.ok(d.reason && d.reason.length > 5, `reason for ${d.kind}`); assert.equal(d.channel, 'card'); assert.ok(d.messageId); }
  assert.equal(r.w.owner.sent.length, r.dirs.length);
  assert.equal(r.verdict.pass, true, JSON.stringify(r.verdict.checks));
  assert.deepEqual(r.verdict.spokenOrder, ['ann', 'bob', 'cy']);
  // story inputs: one director's-view turn per direction, evidence pack per card direction
  const turns = readJsonl(join(r.runDir, 'personas', 'ann', 'turns.jsonl'));
  assert.equal(turns.length, r.dirs.filter((d) => d.seat === 'ann').length);
  assert.match(turns[0].decision.thought, /^director: /);
  assert.equal(turns[0].decision.say.channel, 'card');
  assert.ok(existsSync(join(r.runDir, 'evidence', 'ann-001.json')));
  assert.ok(existsSync(join(r.runDir, 'director', 'VERDICT.md')));
  assert.ok(r.lines.some((l) => /gate: everyone is in/.test(l)));
});

test('turn-taking gate: the next go waits for the previous speaker to finish (speech seen, then result or quiet)', async () => {
  const r = await play({ behaviour: { ann: { lines: 3 } } });
  const speech = readJsonl(join(r.runDir, 'director', 'speech.jsonl'));
  const annLast = Math.max(...speech.filter((s) => s.seat === 'ann').map((s) => s.atMs));
  const bobGo = Date.parse(r.dirs.find((d) => d.kind === 'go' && d.seat === 'bob').t);
  assert.ok(bobGo >= annLast, 'bob was not told to start before ann had finished speaking');
  assert.equal(speech.filter((s) => s.seat === 'ann').length, 3);
  assert.equal(r.verdict.pass, true, JSON.stringify(r.verdict.checks));
});

test('the gate holds until everyone is present; a straggler gets a nudge with its reason', async () => {
  const r = await play({ behaviour: { bob: { ignoreFirstGather: true } } });
  const nudge = r.dirs.find((d) => d.kind === 'nudge' && d.seat === 'bob');
  assert.ok(nudge, 'bob nudged');
  assert.match(nudge.reason, /straggler/);
  const firstGo = Date.parse(r.dirs.find((d) => d.kind === 'go').t);
  const bobIn = readJsonl(join(r.runDir, 'director', 'presence.jsonl')).find((p) => p.seat === 'bob' && p.present);
  assert.ok(firstGo >= Date.parse(bobIn.t), 'first talk only after bob arrived');
  assert.ok(Date.parse(nudge.t) - Date.parse(r.dirs[1].t) >= 60000, 'nudge waits nudgeAfterSec');
  assert.equal(r.verdict.pass, true);
});

test('a never-paired seat gets onboarding nudges on the chat channel, then its gather once paired', async () => {
  const r = await play({ behaviour: { cy: { unpaired: true, pairAfterNudge: true } } });
  const ob = r.dirs.find((d) => d.kind === 'onboard-nudge');
  assert.ok(ob); assert.equal(ob.seat, 'cy'); assert.equal(ob.channel, 'chat'); assert.match(ob.reason, /never paired/);
  assert.equal(r.w.seats.cy.chats.length >= 1, true);
  assert.ok(r.w.seats.cy.waking, 'wake loop started on pairing');
  assert.ok(r.dirs.some((d) => d.kind === 'gather' && d.seat === 'cy'));
  assert.deepEqual(goes(r.dirs), ['ann', 'bob', 'cy']);
  assert.equal(r.verdict.pass, true);
});

test('a seat still onboarding is waited for; paired() hands it to the plan', async () => {
  const r = await play({ behaviour: { cy: { unpaired: true } }, onboarding: { cy: true }, during: (sw, clock, w) => {
    (async () => { await clock.sleep(200000); w.seats.cy.info.soulId = 's_cy'; sw.paired('cy'); })();
  } });
  assert.equal(r.dirs.filter((d) => d.kind === 'onboard-nudge').length, 0);
  const cyGather = r.dirs.find((d) => d.kind === 'gather' && d.seat === 'cy');
  assert.ok(Date.parse(cyGather.t) - WALL0 >= 200000);
  assert.equal(r.verdict.pass, true);
});

test('a silent speaker gets one speak nudge and is then skipped; the verdict fails eachPresented', async () => {
  const r = await play({ behaviour: { bob: { silent: true } } });
  const n = r.dirs.filter((d) => d.kind === 'nudge' && d.seat === 'bob');
  assert.equal(n.length, 1); assert.match(n[0].reason, /silent/);
  assert.deepEqual(goes(r.dirs), ['ann', 'bob', 'cy']);
  assert.equal(r.summary.seats.bob.done, 'silent');
  assert.equal(r.verdict.pass, false);
  assert.equal(r.verdict.checks.eachPresented.pass, false);
});

test('a seat that leaves the room before its turn is nudged back', async () => {
  const r = await play({ behaviour: { cy: { leaveAfterGather: true } } });
  assert.ok(r.dirs.some((d) => d.kind === 'nudge' && d.seat === 'cy' && /not in the library hall before/.test(d.reason)));
});

test('early talker: speaking on prepare is caught as out of turn by the verdict', async () => {
  const r = await play({ behaviour: { bob: { speakOnPrepare: true } } });
  assert.equal(r.verdict.checks.eachOnce.pass, false);
  assert.equal(r.verdict.pass, false);
});

test('console: a scripted redirect changes what the seat does; it is recorded as the console\'s direction', async () => {
  const script = [{ at: 'go:ann', line: 'redirect cy: talk about the piano in the hall instead.', expect: ['piano'] }];
  const r = await play({ script });
  const red = r.dirs.find((d) => d.kind === 'redirect');
  assert.equal(red.seat, 'cy'); assert.equal(red.by, 'console');
  const cyGo = r.dirs.find((d) => d.kind === 'go' && d.seat === 'cy');
  assert.match(cyGo.text, /piano/);
  assert.match(cyGo.reason, /redirected/);
  assert.equal(r.verdict.redirects[0].observed, true);
  assert.equal(r.verdict.pass, true, JSON.stringify(r.verdict.checks));
});

test('console: broadcast and per-seat lines go through the card verbatim; pause holds the plan; end stops', async () => {
  const r = await play({ during: (sw, clock) => {
    sw.submit('pause'); sw.submit('hello all'); sw.submit('Bob: wave to Ann');
    (async () => {
      await clock.sleep(400000); assert.equal(sw.state.phase, 'gather'); sw.submit('resume');
      await clock.sleep(100000); sw.submit('end');
    })();
  } });
  assert.equal(r.summary.stopped, 'console-end');
  const typed = r.dirs.filter((d) => d.by === 'console');
  assert.equal(typed.filter((d) => d.text === 'hello all').length, 3);
  assert.equal(typed.find((d) => d.seat === 'bob' && d.text === 'wave to Ann').channel, 'card');
  assert.equal(r.dirs.filter((d) => d.kind === 'gather').length, 3, 'gather sent only after resume');
  assert.ok(Date.parse(r.dirs.find((d) => d.kind === 'gather').t) - WALL0 >= 400000);
});

test('economy: the seat level sets the wake cap and the direction guidance; console can change it', async () => {
  const r = await play({ script: [{ atSec: 0, line: 'economy bob rich' }] });
  const bobGo = r.dirs.find((d) => d.kind === 'go' && d.seat === 'bob');
  assert.equal(bobGo.economy, 'rich'); assert.match(bobGo.text, /Take the time you need/);
  assert.equal(r.w.seats.bob.rails.maxTurnsPerRequest, 6);
  assert.equal(r.w.seats.ann.rails.maxTurnsPerRequest, 2);
  assert.match(r.dirs.find((d) => d.seat === 'ann' && d.kind === 'go').text, /Keep it cheap/);
  assert.ok(r.dirs.some((d) => d.kind === 'economy' && d.channel === 'none'));
});

test('gather timeout drops a seat that never arrives and goes on with the others', async () => {
  const cast = testCast({ timing: { gatherMaxSec: 300, maxNudges: 1 } });
  const r = await play({ cast, behaviour: { cy: { ignoreFirstGather: true, latencyMs: 1e9 } } });
  assert.equal(r.summary.gateReason, 'gather-timeout');
  assert.equal(r.summary.seats.cy.done, 'absent');
  assert.deepEqual(goes(r.dirs), ['ann', 'bob']);
  assert.equal(r.verdict.pass, false);
});

test('the direction log, timeline and state files are written', async () => {
  const r = await play();
  for (const f of ['directions.jsonl', 'timeline.jsonl', 'speech.jsonl', 'presence.jsonl', 'state.json', 'verdict.json']) assert.ok(existsSync(join(r.runDir, 'director', f)), f);
  const tl = readJsonl(join(r.runDir, 'director', 'timeline.jsonl'));
  assert.ok(tl.some((e) => e.kind === 'gate')); assert.ok(tl.some((e) => e.kind === 'turn-done'));
  assert.equal(readJson(join(r.runDir, 'director', 'state.json')).phase, 'done');
  assert.match(readFileSync(join(r.runDir, 'director', 'VERDICT.md'), 'utf8'), /PASS/);
});

test('story: the session renders as director moments per seat (review/story.mjs reads the run folder as any run)', async () => {
  const { castToScenario } = await import('../cast.mjs');
  const { loadRun } = await import('../../../review/run.mjs');
  const { buildStory } = await import('../../../review/story.mjs');
  const r = await play();
  writeJson(join(r.runDir, 'scenario.json'), castToScenario(testCast()));
  const st = buildStory(loadRun(r.runDir));
  assert.deepEqual(Object.keys(st.seats).sort(), ['ann', 'bob', 'cy']);
  const says = st.merged.filter((m) => m.kinds.includes('say'));
  assert.ok(says.length >= 6, `director moments: ${says.length}`);
  assert.ok(says.some((m) => /^director: /.test(m.persona.thought ?? '')));
});

test('hold guard: an eager seat that speaks on any card speaks only in its turn; the redirect is folded into its turn direction', async () => {
  const { HOLD } = await import('../planner.mjs');
  const script = [{ at: 'go:ann', line: 'redirect cy: talk about the piano in the hall instead.', expect: ['piano'] }];
  const r = await play({ script, behaviour: { cy: { speaksOnAny: true, obeysGuard: true }, bob: { speaksOnAny: true, obeysGuard: true } } });
  // every card a seat got before its own turn carries the guard; its turn direction does not
  for (const id of ['ann', 'bob', 'cy']) {
    const goT = Date.parse(r.dirs.find((d) => d.kind === 'go' && d.seat === id).t);
    for (const d of r.dirs.filter((x) => x.seat === id && x.channel === 'card' && Date.parse(x.t) < goT)) assert.ok(d.text.includes(HOLD), `${id} ${d.kind} held`);
    assert.ok(!r.dirs.find((d) => d.kind === 'go' && d.seat === id).text.includes(HOLD));
  }
  const red = r.dirs.find((d) => d.kind === 'redirect');
  assert.ok(red.text.includes(HOLD)); assert.match(red.text, /for when your turn comes/); assert.match(red.reason, /folded/);
  const cyGo = r.dirs.find((d) => d.kind === 'go' && d.seat === 'cy');
  assert.match(cyGo.text, /piano in the hall instead/);
  const speech = readJsonl(join(r.runDir, 'director', 'speech.jsonl'));
  assert.equal(speech.filter((s) => s.seat === 'cy').length, 1, 'cy spoke once, in its turn');
  assert.ok(speech.find((s) => s.seat === 'cy').atMs >= Date.parse(cyGo.t));
  assert.equal(r.verdict.checks.eachOnce.pass, true, r.verdict.checks.eachOnce.detail);
  assert.equal(r.verdict.redirects[0].observed, true);
  assert.equal(r.verdict.pass, true, JSON.stringify(r.verdict.checks));
});

test('without the guard the same eager seat would talk out of turn (the verifier\'s eachOnce rule is unchanged)', async () => {
  const r = await play({ behaviour: { cy: { speaksOnAny: true, obeysGuard: false } } });
  assert.equal(r.verdict.checks.eachOnce.pass, false);
});

test('direction journal: every console command is recorded with source, target, timing, outcome and the cards it sent', async () => {
  const r = await play({ behaviour: { cy: { unpaired: true } }, onboarding: { cy: true },
    script: [{ atSec: 0, line: 'redirect cy: talk about the piano instead' }, { at: 'go:ann', line: 'redirect bob: talk about the piano instead', expect: ['piano'] }],
    during: (sw, clock) => {
      sw.submit('hello all'); sw.submit('redirect zed: nothing'); sw.submit('economy all lavish'); sw.submit('cy: are you there'); sw.submit('# a comment'); sw.submit('status');
    } });
  const cmds = readJsonl(join(r.runDir, 'director', 'commands.jsonl'));
  const row = (cmd, source) => cmds.find((c) => c.cmd === cmd && (!source || c.source === source));
  assert.equal(cmds.some((c) => c.line === '# a comment'), false, 'comments are not commands');
  const hello = cmds.find((c) => c.line === 'hello all');
  assert.deepEqual({ source: hello.source, target: hello.target, outcome: hello.outcome, cards: hello.requestIds.length }, { source: 'console', target: 'all', outcome: 'applied', cards: 2 });
  assert.match(hello.t, /^\d{4}-\d\d-\d\dT/); assert.equal(typeof hello.elapsedSec, 'number');
  assert.deepEqual([cmds.find((c) => c.line === 'redirect zed: nothing').outcome, cmds.find((c) => c.line === 'redirect zed: nothing').reason], ['refused', 'unknown seat "zed"']);
  assert.deepEqual([row('economy').outcome, row('economy').reason], ['refused', 'unknown economy lavish']);
  assert.deepEqual([row('say').outcome, row('say').target, row('say').reason], ['refused', 'cy', 'seat not paired']);
  const held = cmds.find((c) => c.cmd === 'redirect' && c.target === 'cy');
  assert.deepEqual([held.source, held.outcome], ['script', 'held']);
  const bob = cmds.find((c) => c.cmd === 'redirect' && c.target === 'bob');
  assert.deepEqual([bob.source, bob.outcome, bob.requestIds.length, bob.expect], ['script', 'applied', 1, ['piano']]);
  assert.equal(row('status').outcome, 'applied');
  // directions.jsonl keeps its shape: one record per direction with the same fields as before
  assert.deepEqual(Object.keys(r.dirs.find((d) => !d.error)).sort(), ['by', 'channel', 'economy', 'elapsedSec', 'kind', 'messageId', 'mono', 'n', 'phase', 'reason', 'requestId', 'seat', 'speaker', 't', 'text']);
});

test('direction journal: a lifecycle end is recorded once, from its source, and stops the run', async () => {
  const r = await play({ during: (sw, clock) => { (async () => { await clock.sleep(20000); sw.end('lifecycle-cancel'); sw.end('again'); })(); } });
  const cmds = readJsonl(join(r.runDir, 'director', 'commands.jsonl'));
  assert.deepEqual(cmds.map((c) => [c.source, c.cmd, c.target, c.outcome, c.reason]), [['lifecycle', 'end', 'all', 'applied', 'lifecycle-cancel']]);
  assert.equal(r.summary.stopped, 'lifecycle-cancel');
});

test('direction journal: an unwritable journal warns once; commands still apply and a lifecycle end still stops the run', async () => {
  const r = await play({ prepare: (runDir) => mkdirSync(join(runDir, 'director', 'commands.jsonl'), { recursive: true }),
    during: (sw, clock) => { sw.submit('hello all'); sw.submit('redirect zed: nothing'); (async () => { await clock.sleep(20000); sw.end('lifecycle-cancel'); })(); } });
  assert.equal(r.summary.stopped, 'lifecycle-cancel', 'end() reached stop()');
  assert.deepEqual(r.dirs.filter((d) => d.text === 'hello all').map((d) => d.seat), ['ann', 'bob', 'cy'], 'the typed command was still delivered');
  assert.ok(r.dirs.some((d) => d.kind === 'gather'), 'the plan loop went on after the failed journal write');
  assert.equal(r.lines.filter((l) => /direction journal not written/.test(l)).length, 1, 'one warning, not one per command');
});
