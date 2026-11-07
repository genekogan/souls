// #487: the driver's pure parts, replayed. run-family.mjs itself needs a world, so its evidence is a real run, in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { byIssueTime, createProcessWatch, descendants, drift, exportReport, idleBracket, alive, staleReads, verdict } from './lib.mjs';

// Read 2 was issued second and answered last: the slow read of #484. It saw tick 20, and its answer lands after read 3's.
const slow = [
  { requestedAt: 1000, receivedAt: 1010, tick: 10, activity: 'idle' },
  { requestedAt: 3000, receivedAt: 3010, tick: 30, activity: 'idle' },
  { requestedAt: 2000, receivedAt: 3500, tick: 20, activity: 'idle' },
  { requestedAt: 4000, receivedAt: 4010, tick: 40, activity: 'idle' },
];

test('#484: a slow read is ordered by when it was issued, and is no fault', () => {
  assert.deepEqual(byIssueTime(slow).map((s) => s.tick), [10, 20, 30, 40]);
  assert.deepEqual(staleReads(slow), []);
  const byCompletion = [...slow].sort((a, b) => a.receivedAt - b.receivedAt).map((s) => s.tick);
  assert.deepEqual(byCompletion, [10, 30, 20, 40], 'in completion order the same reads look stale');
});

test('#484: a tick that really goes backwards in issue order is still a fault', () => {
  const stale = staleReads([{ requestedAt: 1, receivedAt: 2, tick: 10 }, { requestedAt: 3, receivedAt: 4, tick: 9 }]);
  assert.equal(stale.length, 1); assert.equal(stale[0].tick, 9);
});

test('#484: the idle bracket comes from the samples around it, so the slow read leaves it conclusive', () => {
  const b = idleBracket(slow, { from: 2500, to: 3500 });
  assert.equal(b.status, 'idle'); assert.equal(b.before.tick, 20); assert.equal(b.after.tick, 40);
  assert.equal(idleBracket(slow, { from: 500, to: 3500 }).status, 'inconclusive', 'nothing before the window');
  assert.equal(idleBracket(slow, { from: 2500, to: 9000 }).status, 'inconclusive', 'nothing after the window');
  assert.equal(idleBracket([...slow, { requestedAt: 5000, receivedAt: 5001, tick: 50, activity: 'walking' }], { from: 2500, to: 4500 }).status, 'not-idle');
});

test('drift is the furthest from the first sample, on the ground plane', () => {
  assert.equal(drift([]), 0); assert.equal(drift([[1, 1], [1, 1]]), 0);
  assert.equal(drift([[0, 0], [3, 4], [1, 0]]), 5); assert.equal(drift([[0, 9, 0], [3, 2, 4]]), 5);
});

test('the export keeps named fields of the right shape and nothing else', () => {
  const token = 'dev-token-abc123', path = '/somewhere/private/world.log';
  const out = exportReport({
    schema: 'continuity-family/1', family: 'restart', pass: true, failure: null, forcedFailure: false, startedAt: '2026-11-07T08:29:01.453Z', token, world: 'http://127.0.0.1:4390/w/x', log: path,
    restart: { journalSame: true, threadSame: true, generationBefore: 1, generationAfter: 2, killedWithOpenOperation: true, recoveryMs: 14360, threadId: 'thread-1', journalPath: path },
    effects: { spoken: 6, spokenAfterRestart: 5, duplicates: 0, texts: ['beat one'] },
    placedBody: { samples: 24, driftMetres: 0, facts: 1, wakeEligible: 1, soulId: 's_1' },
    reads: { samples: 24, stale: 0, bracket: 'idle' }, cleanup: { listening: false, survivors: 0, pids: [1234] }, extra: { token },
  });
  assert.deepEqual(Object.keys(out).sort(), ['cleanup', 'effects', 'failure', 'family', 'forcedFailure', 'pass', 'placedBody', 'reads', 'restart', 'schema', 'startedAt']);
  const text = JSON.stringify(out);
  for (const leak of [token, path, 'thread-1', 'beat one', 's_1', '1234', '127.0.0.1']) assert.ok(!text.includes(leak), leak);
});

test('a listed field of the wrong shape is dropped too: a path or token can\'t ride in as a failure code', () => {
  assert.deepEqual(exportReport({ failure: '/somewhere/private', family: 'Has Spaces', startedAt: 'yesterday', restart: { recoveryMs: 'x' }, reads: 'token' }), { restart: {} });
  assert.deepEqual(exportReport({ failure: null }), { failure: null });
});

test('the verdict fails on each broken condition, and on a missing section', () => {
  const good = { failure: null, restart: { journalSame: true, threadSame: true, generationBefore: 1, generationAfter: 2 }, effects: { spoken: 6, spokenAfterRestart: 5, duplicates: 0 }, reads: { stale: 0, bracket: 'idle' }, cleanup: { listening: false, survivors: 0 } };
  assert.equal(verdict(good), true);
  const broken = {
    'a failure': { failure: 'NO_RECOVERY' }, 'another journal': { restart: { ...good.restart, journalSame: false } }, 'another thread': { restart: { ...good.restart, threadSame: false } },
    'no new generation': { restart: { ...good.restart, generationAfter: 1 } }, 'a duplicate': { effects: { ...good.effects, duplicates: 1 } }, 'nothing said': { effects: { ...good.effects, spoken: 1 } },
    'nothing said after': { effects: { ...good.effects, spokenAfterRestart: 0 } }, 'a stale read': { reads: { ...good.reads, stale: 1 } }, 'an open bracket': { reads: { ...good.reads, bracket: 'inconclusive' } },
    'a port still open': { cleanup: { ...good.cleanup, listening: true } }, 'a survivor': { cleanup: { ...good.cleanup, survivors: 1 } },
    'no restart section': { restart: undefined }, 'no effects section': { effects: undefined }, 'no reads section': { reads: undefined }, 'no cleanup section': { cleanup: undefined },
  };
  for (const [name, change] of Object.entries(broken)) assert.equal(verdict({ ...good, ...change }), false, name);
});

test('descendants walks the whole tree from one table', () => {
  const table = [{ pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 3 }, { pid: 9, ppid: 8 }];
  assert.deepEqual(descendants([1], table).sort(), [2, 3, 4]);
});

test('#368: a detached grandchild outlives its parent and is still swept', async (t) => {
  const code = `const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});g.unref();console.log(g.pid);setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  const gone = new Promise((ok) => child.once('exit', ok));
  const grandchild = await new Promise((ok) => child.stdout.once('data', (d) => ok(Number(String(d)))));
  t.after(() => { try { process.kill(grandchild, 'SIGKILL'); } catch { /* swept */ } });
  const watch = createProcessWatch(); assert.ok(watch.note() >= 2, 'both are noted while the tree is whole');
  child.kill('SIGKILL'); await gone; assert.equal(alive(grandchild), true, 'it outlives its parent');
  assert.deepEqual(await watch.sweep(), []); assert.equal(alive(grandchild), false);
});

test('the sweep leaves a reused pid alone', async () => {
  const signals = [], token = { 7: 'first birth' };
  const watch = createProcessWatch({ root: 1, table: () => [{ pid: 7, ppid: 1 }], inspect: (pid) => ({ startToken: token[pid] }), kill: (pid, s) => signals.push([pid, s]), sleep: async () => {} });
  watch.note(); token[7] = 'another birth';
  assert.deepEqual(await watch.sweep({ graceMs: 1 }), []); assert.deepEqual(signals, []);
});

test('a process whose identity is unknown is never signalled', async () => {
  const signals = [];
  const watch = createProcessWatch({ root: 1, table: () => [{ pid: 7, ppid: 1 }], inspect: () => { throw Error('ps failed'); }, kill: (pid, s) => signals.push([pid, s]), sleep: async () => {} });
  assert.equal(watch.note(), 0); assert.deepEqual(await watch.sweep({ graceMs: 1 }), []); assert.deepEqual(signals, []);
});

test('no host names, user names or home paths in the driver', () => {
  const dir = new URL('./', import.meta.url);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /\/Users\/|\/home\/|\bssh\b|[a-z0-9-]+@[a-z0-9-]+\.[a-z]|\b(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, name);
  }
});
