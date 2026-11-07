// F7 (#378): a sit or lie keeps its receipt `started` while the body holds the pose, so `act … --wait 60` ran its whole
// window. The world's activity.observed for that receipt now ends the wait; the receipt stays `started` and the brief
// output carries the observed held phase. Timed activities, an act with its own `seconds`, other receipts and terminal
// receipts behave as before. (A ride join already completes when the rider is seated: the old terminal path.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {heldPhase} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
// The shape apps/server/src/edge/events/activity-observation.ts delivers (raw stream event).
const observed = (capability, body, action = {verb: 'sit', status: 'executing', phase: 'occupied'}, receipt = 'r_1') =>
  ({id: 'c_2', kind: 'activity.observed', tick: 40, at: 1, receipt: {id: receipt, capability, phase: 'started'}, action: {id: 'a_1', ...action}, body});
const SEATED = {posture: 'seated', activity: 'sit', on: null, inWater: false, occupiedSeats: ['chair#seat']};

test('heldPhase: the act\'s own pose reached is held; timed activities, other receipts and transitions are not', () => {
  assert.equal(heldPhase(observed('sit:chair', SEATED), 'r_1'), 'occupied');
  assert.equal(heldPhase(observed('sit:chair', SEATED, {verb: 'rest', status: 'executing'}), 'r_1'), 'seated', 'a sit resting on its seat');
  assert.equal(heldPhase(observed('sit-ground:here', SEATED, {verb: 'mars:pose_v1', status: 'executing'}), 'r_1'), 'seated');
  for (const posture of ['lying', 'sleeping']) assert.equal(heldPhase(observed('lie:bed', {posture, activity: 'lie', on: null}, {verb: 'mars:pose_v1', status: 'executing'}), 'r_1'), posture);
  assert.equal(heldPhase(observed('nap:here', {posture: 'sleeping', activity: 'nap', on: null}, {verb: 'mars:pose_v1', status: 'executing'}), 'r_1'), 'sleeping');
  // Not held: a punt being rowed (the Soul steers), another receipt, a timed activity, a pose the act did not ask for.
  assert.equal(heldPhase(observed('object:punt-1:join', {posture: 'rowing', activity: 'row', on: 'punt', aboard: 'seated'}, {verb: 'mars:carrier_ride', status: 'executing'}), 'r_1'), null);
  assert.equal(heldPhase(observed('sit:chair', SEATED), 'r_other'), null);
  assert.equal(heldPhase(observed('dance:here', {posture: 'busy', activity: 'dance'}, {verb: 'mars:pose_v1', status: 'executing'}), 'r_1'), null);
  assert.equal(heldPhase(observed('read:book', {posture: 'seated', activity: 'read'}, {verb: 'read', status: 'executing'}), 'r_1'), null, 'reading while seated is a timed activity');
  assert.equal(heldPhase(observed('lie:bed', SEATED), 'r_1'), null, 'a lie that is only seated has not reached its pose');
  assert.equal(heldPhase(observed('sit:chair', {posture: 'standing', activity: 'idle'}), 'r_1'), null);
  assert.equal(heldPhase(observed('sit:chair', SEATED, {verb: 'sit', status: 'done', phase: 'occupied'}), 'r_1'), null);
  assert.equal(heldPhase({...observed('sit:chair', SEATED), kind: 'receipt.started'}, 'r_1'), null);
  assert.equal(heldPhase(observed('sit:chair', SEATED), undefined), null);
});

async function world(t, {events, receipt}) {
  const waits = [], dir = mkdtempSync(join(tmpdir(), 'held-'));
  const server = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), reply = (data) => {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
      if (u.pathname === '/v1/edge/act') return reply({accepted: true, channel: 'body', receipt: {id: 'r_1', phase: 'started', capability: receipt.capability}});
      if (u.pathname === '/v1/edge/wait') {
        const n = waits.push(u.searchParams.get('after'));
        // The first long-poll hands over the stream page; later ones hold for the timeout they ask for (nothing new).
        if (n === 1) return reply({cursor: 'c_9', events});
        return setTimeout(() => reply({cursor: 'c_9', events: []}), Number(u.searchParams.get('timeout')) * 1000);
      }
      if (u.pathname === '/v1/edge/receipts/r_1') return reply({receipt: {id: 'r_1', ...receipt, now: 'sitting on the chair; not finished yet'}});
      reply({});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, {recursive: true, force: true});});
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: 'http://127.0.0.1:' + server.address().port, soul: 's_pip', token: 'sim_fixture', cursor: 'c_1'}));
  const run = (args) => new Promise(resolve => {
    const t0 = Date.now();
    execFile(process.execPath, [CLI, ...args], {cwd: dir}, (err, out, errText) => {assert.equal(err?.code ?? 0, 0, errText); resolve({d: JSON.parse(out), ms: Date.now() - t0});});
  });
  return {run, waits};
}

test('act --wait returns once the sit holds its seat; the receipt stays started with the observed phase', async t => {
  const w = await world(t, {events: [{id: 'c_2', kind: 'receipt.started', receipt: {id: 'r_1', capability: 'sit:chair', phase: 'started'}}, observed('sit:chair', SEATED)], receipt: {capability: 'sit:chair', phase: 'started'}});
  const {d, ms} = await w.run(['act', 'sit:chair', '--wait', '20']);
  assert.ok(ms < 10_000, `returned after ${ms} ms, not the 20 s window`);
  assert.equal(w.waits.length, 1);
  assert.equal(d.done, false); assert.equal(d.now, 'sitting on the chair; not finished yet');
  assert.deepEqual(d.receipt, {id: 'r_1', capability: 'sit:chair', phase: 'started', observed: 'occupied'});
  const {events: _e, eventWindow: _w, ...summary} = d;
  assert.ok(JSON.stringify(summary).length <= 600, 'the action summary keeps its 600-character budget');
  // The cursor moved past that observation: a second wait does not end on it again.
  const again = await w.run(['wait', '2', 'r_1']);
  assert.equal(again.d.receipt.observed, undefined); assert.equal(again.d.done, false); assert.ok(w.waits.length >= 2); assert.equal(w.waits.at(-1), 'c_9');
  assert.equal(again.d.waited, '2s');
});

test('a timed activity observed under way still waits its window (no held pose)', async t => {
  const w = await world(t, {events: [observed('dance:here', {posture: 'busy', activity: 'dance'}, {verb: 'mars:pose_v1', status: 'executing'})], receipt: {capability: 'dance:here', phase: 'started'}});
  const {d} = await w.run(['wait', '2', 'r_1', '--json']);
  assert.equal(d.waited, '2s'); assert.equal(d.held, undefined); assert.equal(d.receipt.phase, 'started');
});

test('a completed receipt is still reported done, never as held', async t => {
  const w = await world(t, {events: [observed('sit:chair', SEATED), {id: 'c_3', kind: 'receipt.terminal', receipt: {id: 'r_1', capability: 'sit:chair', phase: 'completed'}}], receipt: {capability: 'sit:chair', phase: 'completed', done: 'Sat on the chair.'}});
  const {d} = await w.run(['wait', '20', 'r_1']);
  assert.equal(d.done, 'Sat on the chair.'); assert.equal(d.receipt.phase, 'completed'); assert.equal(d.receipt.observed, undefined);
});

test('the latest observation decides: a held pose since left does not end the wait', async t => {
  const w = await world(t, {events: [observed('sit:chair', SEATED), {...observed('sit:chair', {posture: 'busy', activity: 'climb-down'}, {verb: 'walk_to', status: 'executing', phase: 'climb'}), id: 'c_3'}], receipt: {capability: 'sit:chair', phase: 'started'}});
  const {d} = await w.run(['wait', '2', 'r_1', '--json']);
  assert.equal(d.waited, '2s'); assert.equal(d.held, undefined);
});

test('an act that asked for its own seconds is waited out as before, even once seated', async t => {
  const w = await world(t, {events: [observed('sit:chair', SEATED)], receipt: {capability: 'sit:chair', phase: 'started'}});
  const {d} = await w.run(['act', 'sit:chair', '{"seconds":30}', '--wait', '2', '--json']);
  assert.equal(d.waited, '2s'); assert.equal(d.held, undefined); assert.equal(d.receipt.phase, 'started');
});
