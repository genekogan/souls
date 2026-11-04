// CW2 (#736) A3–A5: the verdict can only pass on a complete, quiet, qualifying matrix; failures name their cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verdict, headroom, evidence, EVIDENCE } from './verdict.mjs';

const good = (profile, rep, o = {}) => ({ profile, rep, qualifying: { executor: true, quiet: true, short: false }, objectives: { read: true, actionStart: true, delivery: true, clock: true, failures: true, restarts: true },
  headroom: { cpu: 0.45, memory: 0.6 }, swapPeakMb: 0, stealShare: 0, throttledPeriodShare: 0, worlds: { mw0: { hottestCores: 0.4, met: true } }, ...o });
const matrix = (o) => [good('even', 1, o), good('even', 2, o), good('meetup', 1, o), good('meetup', 2, o)];

test('headroom uses the cgroup quota first, then the cpuset, then host cores; memory needs a limit', () => {
  assert.deepEqual(headroom({ quotaCores: 4, cpusetCores: 8, hostCores: 16, usedCores: 2, memMaxMb: 8192, memPeakMb: 4096 }), { cpuCapacityCores: 4, cpuCapacityFrom: 'cgroup cpu.max', cpu: 0.5, memory: 0.5 });
  assert.equal(headroom({ hostCores: 16, usedCores: 4, memMaxMb: 'max', memPeakMb: 100 }).memory, null);
});

test('a complete quiet qualifying matrix that meets everything passes', () => {
  const v = verdict(matrix()); assert.equal(v.verdict, 'passes'); assert.equal(v.qualifies, true);
});

test('laptop, not-quiet or short runs can never pass', () => {
  for (const q of [{ executor: false, quiet: true, short: false }, { executor: true, quiet: false, short: false }, { executor: true, quiet: true, short: true }]) {
    const v = verdict(matrix({ qualifying: q })); assert.equal(v.verdict, 'inconclusive'); assert.equal(v.qualifies, false);
  }
});

test('one repeat or one profile is an incomplete matrix', () => {
  assert.equal(verdict(matrix().slice(0, 3)).verdict, 'inconclusive');
  assert.match(verdict(matrix().slice(0, 3)).reasons.join(), /meetup: 1\/2/);
});

test('missed objectives with spare allocation, or a hot world, are a software bottleneck', () => {
  const miss = { objectives: { read: false, actionStart: false, delivery: true, clock: true, failures: true, restarts: true } };
  assert.equal(verdict(matrix(miss)).verdict, 'software bottleneck');
  // even on a laptop: the evidence still names the cause, it just does not qualify
  const v = verdict(matrix({ ...miss, qualifying: { executor: false, quiet: false, short: true }, worlds: { mw0: { hottestCores: 0.97, met: false } }, headroom: { cpu: 0.1, memory: 0.5 } }));
  assert.equal(v.verdict, 'software bottleneck'); assert.equal(v.qualifies, false); assert.match(v.reasons.join(), /mw0/);
});

test('missed objectives without headroom, swap or throttling are insufficient resources', () => {
  assert.equal(verdict(matrix({ objectives: { read: false }, headroom: { cpu: 0.1, memory: 0.6 } })).verdict, 'insufficient resources');
  assert.equal(verdict(matrix({ objectives: { clock: false }, throttledPeriodShare: 0.3 })).verdict, 'insufficient resources');
  // everything met but under 30 % headroom still fails the headroom objective
  assert.equal(verdict(matrix({ headroom: { cpu: 0.2, memory: 0.6 } })).verdict, 'insufficient resources');
});

test('failed runs and unknown allocation keep the verdict inconclusive', () => {
  assert.equal(verdict([...matrix().slice(0, 3), { profile: 'meetup', rep: 2, failed: 'join' }]).verdict, 'inconclusive');
  assert.equal(verdict(matrix({ headroom: { cpu: 0.5, memory: null } })).verdict, 'inconclusive');
});

test('absent evidence is unknown: no objectives, or unreadable swap, steal or throttling, never pass', () => {
  const v = verdict(matrix({ objectives: {} })); assert.equal(v.verdict, 'inconclusive'); assert.equal(v.qualifies, false); assert.match(v.reasons.join(), /no objectives recorded/);
  const bare = ['even', 'meetup'].flatMap((p) => [1, 2].map((rep) => ({ profile: p, rep, qualifying: { executor: true, quiet: true, short: false }, headroom: { cpu: 0.5, memory: 0.5 } })));
  assert.equal(verdict(bare).verdict, 'inconclusive', 'runs holding only profile, rep, qualifying and headroom');
  for (const k of ['swapPeakMb', 'stealShare', 'throttledPeriodShare']) for (const x of [null, undefined]) {
    const w = verdict(matrix({ [k]: x })); assert.equal(w.verdict, 'inconclusive', `${k}=${x}`); assert.match(w.reasons.join(), new RegExp(`unreadable.*${k}`));
  }
  assert.equal(verdict(matrix({ qualifying: { executor: true, quiet: true } })).verdict, 'inconclusive', 'short missing is not short=false');
});

test('repeats are distinct rep identities: two copies of rep 1 are one repeat', () => {
  const v = verdict([good('even', 1), good('even', 1), good('meetup', 1), good('meetup', 1)]);
  assert.equal(v.verdict, 'inconclusive'); assert.match(v.reasons.join(), /even: 1\/2.*meetup: 1\/2/);
});

test('a failed run next to a complete matrix is inconclusive; a hot thread counts from 0.9 core', () => {
  assert.equal(verdict([...matrix(), { profile: 'meetup', rep: 3, failed: 'boot' }]).verdict, 'inconclusive');
  const miss = { objectives: { read: false }, headroom: { cpu: 0.1, memory: 0.6 } };
  assert.equal(verdict(matrix({ ...miss, worlds: { mw0: { hottestCores: 0.9, met: false } } })).verdict, 'software bottleneck');
  assert.equal(verdict(matrix({ ...miss, worlds: { mw0: { hottestCores: 0.89, met: false } } })).verdict, 'insufficient resources');
});

test('summarize shape: every evidence field is present on a run, read values flow through, unread ones are null', () => {
  const read = evidence({ hostRows: [{ cgroupSwapMb: 0 }, { cgroupSwapMb: 3 }], alloc: { stealShare: 0.01, throttledPeriodShare: 0, pressureSomeShare: { cpu: 0.02 } } });
  assert.deepEqual(read, { swapPeakMb: 3, stealShare: 0.01, throttledPeriodShare: 0, pressureSomeShare: { cpu: 0.02 } });
  const unread = evidence({ hostRows: [{ cgroupSwapMb: null }], alloc: null });
  for (const k of [...EVIDENCE, 'pressureSomeShare']) { assert.ok(k in read && k in unread, k); assert.equal(unread[k], null, k); }
  // a matrix built from readable evidence can pass; the same matrix with the bench's unread evidence cannot
  const clean = evidence({ hostRows: [{ cgroupSwapMb: 0 }], alloc: { stealShare: 0, throttledPeriodShare: 0 } });
  assert.equal(verdict(matrix(clean)).verdict, 'passes');
  assert.equal(verdict(matrix(unread)).verdict, 'inconclusive');
  // and the bench's summarize puts them on every run's qualification (a comment once swallowed three of them)
  const src = readFileSync(new URL('./meetup.mjs', import.meta.url), 'utf8'), q = src.slice(src.indexOf('const qualification = {'));
  assert.match(q.slice(0, q.indexOf('\n    allocation:')), /\n\s+\.\.\.evidence\(\{ hostRows, alloc \}\),/);
});
