// Harness fixes of 2026-10-25 (ROOT-CAUSES B3/B4): in-window arrival targets, turn links, chat-reply truthfulness,
// chat result-sent, the turn↔request cost join, and the offline re-score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, linkTurns } from '../run.mjs';
import { runOracles, claimsIn, tickClock, placeTarget } from '../oracles.mjs';
import { computeMetrics, joinTurns } from '../metrics.mjs';
import { rescoreRun } from '../rescore-oracles.mjs';
import { FIX, MAIN, copyRuns } from './helpers.mjs';

const run = loadRun(join(FIX, MAIN));
const ev = (rid) => structuredClone(run.evidence.find((e) => e.requestId === rid));
const st = (rows, id) => rows.find((o) => o.id === id);

test('arrival never takes an earlier request\'s walk: the target is an in-window receipt (ticks) or the seat\'s act', () => {
  const e = ev('r3');
  // An older walk (accepted before sentAt, tick 500 < the window's ~3000) sits first in the pack; the request's own walk
  // carries only ticks. The body ends at the library.
  e.receipts = [{ id: 'r_old', capability: 'walk:market', phase: 'completed', acceptedTick: 500, endedTick: 1000 }, { id: 'r_new', capability: 'walk:library', phase: 'started', acceptedTick: 3200 }];
  e.samples.at(-1).place = 'Library';
  const r = runOracles(e, { acts: [] });
  assert.equal(st(r, 'arrival').status, 'pass');
  assert.match(st(r, 'arrival').detail, /receipt r_new/);
  e.receipts = [e.receipts[0]];
  assert.equal(st(runOracles(e, { acts: [] }), 'arrival').status, 'unknown', 'only an earlier walk → no target');
});

test('placeTarget: the last walk act wins; an act accepted after the cutoff is late, not a target', () => {
  const acts = [{ cmd: 'node eden.mjs act "go to the kitchen"', output: { accepted: true, receipt: { id: 'a', capability: 'walk:house-1/kitchen-chair', phase: 'replaced', acceptedTick: 3200 } } },
    { cmd: 'node eden.mjs act walk:house-2/kitchen', output: { accepted: true, receipt: { id: 'b', capability: 'walk:house-2/kitchen', phase: 'started', acceptedTick: 3300 } } }];
  assert.equal(placeTarget({ receipts: [] }, acts).place, 'house-2/kitchen');
  const late = placeTarget({ receipts: [] }, [acts[1]], { inWindow: () => false });
  assert.equal(late.late, true);
  const e = ev('r3'); e.receipts = [];
  const r = runOracles(e, { acts: [{ cmd: 'node eden.mjs act walk:library', output: { accepted: true, receipt: { id: 'z', capability: 'walk:library', acceptedTick: 25000 } } }] });
  assert.match(st(r, 'arrival').detail, /accepted after the cutoff/);
  assert.equal(st(r, 'arrival').status, 'unknown');
});

test('tickClock maps ticks to wall time from the samples', () => {
  const c = tickClock([{ tick: 100, ms: 1000 }, { tick: 200, ms: 2000 }, { tick: 300, ms: 4000 }]);
  assert.equal(c(150), 1500); assert.equal(c(250), 3000); assert.equal(c(50), 250); assert.equal(c(400), 5500); // ends extrapolate at the mean rate
  assert.equal(tickClock([{ tick: 1, ms: 1 }]), null);
});

test('linkTurns infers chat turns in order and wake turns inside a card window (old runs had chatTurns [])', () => {
  const seats = structuredClone(run.seats); const evs = structuredClone(run.evidence).map((e) => ({ ...e, chatTurns: [] }));
  linkTurns(seats, evs);
  assert.deepEqual(Object.fromEntries(evs.map((e) => [e.requestId, e.chatTurns])), { r1: [2], r2: [3], r3: [4] });
  assert.ok(evs.every((e) => e.chatTurnsInferred));
});

test('claims: negation, future and questions are not claims; third-person location needs the Soul as subject', () => {
  assert.deepEqual(claimsIn("Pip is walking to the pond, but hasn't arrived yet."), []);
  assert.deepEqual(claimsIn("I'll tell you once she arrives. Is Pip sitting?"), []);
  assert.deepEqual(claimsIn('9 (the kitchen is at 32.9, 4).', { soulName: 'Pip' }), []);
  assert.deepEqual(claimsIn('Pip is at oak-1.', { soulName: 'Pip' }).map((c) => [c.id, c.named]), [['arrived', 'oak-1']]);
  assert.equal(claimsIn('Pip sat on the bench.')[0].past, true);
  assert.deepEqual(claimsIn('Rook is in front of Mira, sitting. Your message is done.', { soulName: 'Mira', others: ['Rook'] }), [], 'another Soul as subject; message status');
});

test('truthfulness reads the chat reply, judged against the body when the reply was written', () => {
  const e = ev('r2'); // chat "say hi to the duck"; Pip sits throughout
  const turns = structuredClone(run.seats.pip.turns);
  const t3 = turns.find((t) => t.turn === 3);
  t3.finalText = 'Pip has arrived at the library.';
  assert.equal(st(runOracles(e, { acts: [], turns }), 'truthfulness-basic').status, 'fail', 'false arrival claim in chat');
  t3.finalText = 'Pip is lying on the grass.';
  assert.equal(st(runOracles(e, { acts: [], turns }), 'truthfulness-basic').status, 'fail');
  t3.finalText = 'Pip is sitting on the bench.';
  assert.equal(st(runOracles(e, { acts: [], turns }), 'truthfulness-basic').status, 'pass');
  // true when written (12:01:44, sitting) although Pip stood up before the cutoff
  const e2 = ev('r2'); e2.samples.slice(-2).forEach((s) => { s.posture = 'standing'; });
  assert.equal(st(runOracles(e2, { acts: [], turns }), 'truthfulness-basic').status, 'pass');
});

test('result-sent on the chat channel passes on a chat reply before the cutoff and fails after it', () => {
  const turns = structuredClone(run.seats.pip.turns);
  const e = ev('r2'); e.resultAt = null; e.resultText = null;
  assert.equal(st(runOracles(e, { acts: [], turns }), 'result-sent').status, 'pass');
  turns.find((t) => t.turn === 3).endedAt = '2026-10-24T12:02:30.000Z';
  const r = st(runOracles(e, { acts: [], turns }), 'result-sent');
  assert.equal(r.status, 'fail'); assert.match(r.detail, /30 s after cutoff/);
});

test('cost join: turns overlapping a request window carry its tokens, split evenly when a turn serves several', () => {
  const per = joinTurns(run);
  assert.deepEqual([per.get('r1').turns, per.get('r1').output, per.get('r2').output, per.get('r3').output, per.get('r3').calls], [1, 300, 250, 320, 3]);
  const r2 = structuredClone(run); r2.evidence.find((e) => e.requestId === 'r2').cutoffAt = '2026-10-24T12:02:40.000Z'; // r2 now overlaps turn 4 too
  const p2 = joinTurns(r2);
  assert.equal(p2.get('r2').output, 250 + 160); assert.equal(p2.get('r3').output, 160); assert.equal(p2.get('r2').turns, 2);
  const m = computeMetrics(run, {});
  assert.equal(m.cost.tokensPerRequest.output, 300); assert.equal(m.cost.turnsPerRequest.median, 1); assert.equal(m.cost.cliCallsPerRequest.median, 3);
  assert.equal(m.speed.chatQueuedSec.median, 0);
});

test('rescore-oracles rewrites oracles.jsonl and metrics.json and keeps the originals as .v1', () => {
  const { main } = copyRuns();
  writeFileSync(join(main, 'oracles.jsonl'), '{"old":true}\n'); writeFileSync(join(main, 'metrics.json'), '{"version":1}\n');
  const r = rescoreRun(main);
  assert.equal(readFileSync(join(main, 'oracles.jsonl.v1'), 'utf8'), '{"old":true}\n');
  assert.ok(existsSync(join(main, 'metrics.json.v1')));
  assert.equal(JSON.parse(readFileSync(join(main, 'metrics.json'), 'utf8')).version, 2);
  assert.equal(readFileSync(join(main, 'oracles.jsonl'), 'utf8').trim().split('\n').length, 3 * 15);
  rescoreRun(main); assert.equal(readFileSync(join(main, 'oracles.jsonl.v1'), 'utf8'), '{"old":true}\n', 'v1 is never overwritten');
  assert.equal(r.requests, 3);
});

test('failed action reports are not positive body claims, while a later but-clause remains scoreable',()=>{
 assert.deepEqual(claimsIn('The swim itself failed with `swim.steep`, so I reported the request as unsuccessful.'),[]);
 assert.deepEqual(claimsIn('The first swim failed, but I am swimming now.').map(c=>c.id),['swimming']);
 assert.deepEqual(claimsIn('Sitting was refused; I am seated now.').map(c=>c.id),['sitting']);
});
