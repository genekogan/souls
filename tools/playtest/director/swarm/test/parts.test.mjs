import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { castToScenario, loadCast, normalizeCast } from '../cast.mjs';
import { parseLine, parseScript, scriptFeeder } from '../console.mjs';
import { plan, plannerPrompt, templateDirections } from '../planner.mjs';
import { inRoom, projectTruth, speechOf } from '../truth.mjs';
import { verifySession } from '../verify.mjs';
import { testCast, WALL0 } from './fakes.mjs';

const CASTS = join(dirname(fileURLToPath(import.meta.url)), '../../../scenarios/casts');

test('seven-dwarves cast validates: seven seats, order, room, the redirect script', () => {
  const c = loadCast(join(CASTS, 'seven-dwarves.json'));
  assert.equal(c.seats.length, 7);
  assert.deepEqual(c.order, ['doc', 'happy', 'sleepy', 'bashful', 'sneezy', 'grumpy', 'dopey']);
  assert.ok(c.seats.every((s) => s.character && s.model && s.economy && c.economy[s.economy]));
  assert.equal(c.console.script[0].at, 'go:sleepy');
  assert.deepEqual(c.observer.viewport, [1024, 640]);
  const sc = castToScenario(c);
  assert.equal(sc.director.mode, 'swarm'); assert.equal(sc.review.reviewer, false); assert.equal(sc.review.developer, false);
  assert.equal(sc.seats.length, 7);
});

test('normalizeCast lists every problem', () => {
  assert.throws(() => normalizeCast({ kind: 'cast', name: 'x', world: { kind: 'live' }, seats: [{ id: 'a' }, { id: 'a', soulName: 'A', character: 'c' }], order: ['zz'], room: {} }),
    (e) => /world.kind/.test(e.message) && /brief/.test(e.message) && /duplicate/.test(e.message) && /unknown seat zz/.test(e.message) && /room/.test(e.message));
});

test('console lines: broadcast, seat by id or Soul name, redirect, economy, controls', () => {
  const seats = testCast().seats;
  assert.deepEqual(parseLine('hello everyone', { seats }), { cmd: 'broadcast', text: 'hello everyone' });
  assert.deepEqual(parseLine('bob: wave', { seats }), { cmd: 'say', seat: 'bob', text: 'wave' });
  assert.deepEqual(parseLine('Bob: wave', { seats }), { cmd: 'say', seat: 'bob', text: 'wave' });
  assert.deepEqual(parseLine('Note: this is not a seat', { seats }), { cmd: 'broadcast', text: 'Note: this is not a seat' });
  assert.deepEqual(parseLine('redirect Cy: talk about pianos', { seats }), { cmd: 'redirect', seat: 'cy', text: 'talk about pianos' });
  assert.equal(parseLine('redirect zed: x', { seats }).cmd, 'error');
  assert.deepEqual(parseLine('economy all rich', { seats }), { cmd: 'economy', seat: null, level: 'rich' });
  assert.deepEqual(parseLine('economy ann lean', { seats }), { cmd: 'economy', seat: 'ann', level: 'lean' });
  for (const c of ['pause', 'resume', 'status', 'END']) assert.equal(parseLine(c, { seats }).cmd, c.toLowerCase());
  assert.equal(parseLine('# comment', { seats }).cmd, 'noop');
});

test('script feeder: by time and by orchestrator event; text scripts', () => {
  const f = scriptFeeder([{ atSec: 10, line: 'a' }, { at: 'go:bob', line: 'b' }]);
  assert.deepEqual(f.due({ elapsedSec: 5, events: new Set() }), []);
  assert.equal(f.due({ elapsedSec: 11, events: new Set() })[0].line, 'a');
  assert.equal(f.due({ elapsedSec: 12, events: new Set(['go:bob']) })[0].line, 'b');
  assert.equal(f.left, 0);
  assert.deepEqual(parseScript('+30 hello\n@go:ann redirect bob: x\n# c\nend'), [{ atSec: 30, line: 'hello' }, { at: 'go:ann', line: 'redirect bob: x' }, { atSec: 0, line: 'end' }]);
});

test('planner: templates name the room, order and predecessor; model output is used where valid', async () => {
  const c = testCast();
  const t = templateDirections(c, 'bob');
  assert.match(t.gather, /the library hall/); assert.match(t.gather, /2nd of 3, right after Ann/); assert.match(t.go, /^Your turn/);
  assert.match(plannerPrompt(c), /"gather"/);
  const off = await plan({ cast: c });
  assert.equal(off.source, 'template');
  const call = async () => ({ json: { seats: { ann: { gather: 'Ann, please walk to the library hall and wait for your turn.', prepare: 'x', go: 'Ann, your turn now: tell the room about your rock.' } } }, costUsd: 0.01 });
  const p = await plan({ cast: { ...c, orchestrator: { planner: 'opus' } }, call });
  assert.equal(p.source, 'mixed');
  assert.match(p.seats.ann.gather, /^Ann, please/);
  assert.equal(p.seats.ann.prepare, templateDirections(c, 'ann').prepare, 'a too-short model text falls back to the template');
  assert.equal(p.seats.bob.go, t.go);
  const failing = await plan({ cast: { ...c, orchestrator: { planner: 'opus' } }, call: async () => { throw new Error('down'); } });
  assert.equal(failing.source, 'template');
});

test('truth: placePath room match and speech projection (ms and seconds)', () => {
  assert.equal(inRoom(['hall', 'library', 'World'], { match: ['hall'] }), true);
  assert.equal(inRoom([{ id: 'x', name: 'Library Hall' }], { match: ['hall'] }), true);
  assert.equal(inRoom(['commons'], { match: ['hall'] }), false);
  const pub = { self: { placePath: [{ id: 'p1', name: 'hall' }], state: 'sitting' }, events: [{ kind: 'speech', at: WALL0 + 5000, text: 'b' }, { kind: 'speech', at: (WALL0 + 1000) / 1000, text: 'a' }, { kind: 'arrive', at: WALL0 }] };
  assert.deepEqual(speechOf(pub).map((s) => s.text), ['a', 'b']);
  const t = projectTruth('s_1', pub);
  assert.deepEqual(t.placePath, ['hall']); assert.equal(t.posture, 'sitting'); assert.equal(t.speech.length, 2);
  assert.equal(projectTruth('s_1', null).ok, false);
});

test('verify: out-of-order talks and missing presence fail; a clean session passes', () => {
  const cast = testCast();
  const at = (s) => new Date(WALL0 + s * 1000).toISOString();
  const directions = [{ seat: 'ann', kind: 'go', t: at(100) }, { seat: 'bob', kind: 'go', t: at(200) }, { seat: 'cy', kind: 'go', t: at(300) }];
  const presence = ['ann', 'bob', 'cy'].map((seat) => ({ seat, present: true, t: at(50) }));
  const long = (who) => `${who} says a talk that is long enough to count as a presentation.`;
  const sp = (seat, s) => ({ seat, atMs: WALL0 + s * 1000, at: at(s), text: long(seat), present: true });
  const ok = verifySession({ cast, directions, presence, speech: [sp('ann', 130), sp('bob', 230), sp('cy', 330)] });
  assert.equal(ok.pass, true, JSON.stringify(ok.checks));
  // bob talks in ann's window too: not "each once"; cy never talks
  const bad = verifySession({ cast, directions, presence: presence.slice(0, 2), speech: [sp('ann', 130), sp('bob', 140), sp('bob', 230)] });
  assert.equal(bad.checks.eachOnce.pass, false); assert.equal(bad.checks.eachPresented.pass, false); assert.equal(bad.checks.allPresent.pass, false);
  assert.equal(bad.pass, false);
  // talks that start out of order (cy speaks before bob inside bob's late window) → inOrder fails
  const late = verifySession({ cast, directions: [directions[0], { seat: 'bob', kind: 'go', t: at(200) }, { seat: 'cy', kind: 'go', t: at(201) }], presence, speech: [sp('ann', 130), sp('cy', 210), sp('bob', 205)] });
  assert.equal(late.checks.eachPresented.pass, false);
});

test('H-h (#371): cast seats get 480 s turns at every economy level, by default and in the shipped casts', async () => {
  const { ECONOMY, loadCast } = await import('../cast.mjs');
  const { readdirSync } = await import('node:fs');
  const { join: j } = await import('node:path');
  for (const [k, v] of Object.entries(ECONOMY)) assert.equal(v.maxTurnWallSec, 480, k);
  assert.deepEqual(Object.fromEntries(Object.entries(ECONOMY).map(([k, v]) => [k, v.maxTurnsPerDirection])), { lean: 2, normal: 4, rich: 6 }, 'turn caps unchanged');
  const dir = new URL('../../../scenarios/casts/', import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  for (const f of files) { const c = loadCast(j(dir, f)); assert.equal(c.rails.maxTurnWallSec, 480, f); for (const [k, v] of Object.entries(c.economy)) assert.equal(v.maxTurnWallSec, 480, `${f} ${k}`); }
});
