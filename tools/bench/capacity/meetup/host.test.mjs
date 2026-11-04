// CW2 (#736) A1/A4: the allocation probe's parsers on fixed kernel text; unknown stays null, never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCpuMax, parseKv, parsePressure, parseProcStat, parseTaskStat, cgroupDir, between, hotThreads, probe } from './host.mjs';

test('cpu.max: a quota in cores, or unlimited', () => {
  assert.deepEqual(parseCpuMax('200000 100000\n'), { quotaCores: 2, periodUs: 100000, unlimited: false });
  assert.deepEqual(parseCpuMax('max 100000'), { quotaCores: null, periodUs: 100000, unlimited: true });
  assert.equal(parseCpuMax(null), null);
});

test('cgroup v2 path; v1 or absent is unknown', () => {
  assert.equal(cgroupDir('0::/system.slice/sim-bench.scope\n'), '/sys/fs/cgroup/system.slice/sim-bench.scope');
  assert.equal(cgroupDir('0::/\n'), '/sys/fs/cgroup');
  assert.equal(cgroupDir('12:cpu,cpuacct:/x\n'), null);
  assert.equal(cgroupDir(null), null);
});

test('PSI, cpu.stat and /proc/stat (steal included)', () => {
  const p = parsePressure('some avg10=1.50 avg60=0.80 avg300=0.10 total=123456\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=10\n');
  assert.equal(p.some.avg10, 1.5); assert.equal(p.full.total, 10);
  assert.deepEqual(parseKv('usage_usec 5000000\nnr_periods 100\nnr_throttled 7\nthrottled_usec 350000\n'), { usage_usec: 5e6, nr_periods: 100, nr_throttled: 7, throttled_usec: 350000 });
  const s = parseProcStat('cpu  100 0 50 800 10 0 0 40 0 0\ncpu0 1 2 3\n');
  assert.equal(s.steal, 40); assert.equal(s.total, 1000);
  assert.equal(parseProcStat('intr 1 2'), null);
});

test('task stat: names with spaces and parentheses', () => {
  assert.deepEqual(parseTaskStat('4242 (node (main) x) S 1 1 1 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 9 0'), { name: 'node (main) x', cpuTicks: 300 });
});

test('between: steal share, throttling and pressure as rates; missing sources stay null', () => {
  const a = { procStat: { steal: 10, total: 1000 }, cpuStat: { usage_usec: 0, nr_periods: 0, nr_throttled: 0, throttled_usec: 0 }, pressure: { cpu: { some: { total: 0 } }, memory: null, io: null } };
  const b = { procStat: { steal: 60, total: 2000 }, cpuStat: { usage_usec: 15e6, nr_periods: 100, nr_throttled: 25, throttled_usec: 2e6 }, pressure: { cpu: { some: { total: 1e6 } }, memory: null, io: null } };
  assert.deepEqual(between(a, b, 10), { stealShare: 0.05, cgroupCpuCores: 1.5, throttledPeriodShare: 0.25, throttledSecondsPerSecond: 0.2, pressureSomeShare: { cpu: 0.1, memory: null, io: null } });
  assert.equal(between(a, null, 10), null);
});

test('hot threads: the main thread and the hottest one, in cores', () => {
  const a = { main: 100, threads: [{ tid: 1, name: 'node', cpuTicks: 100 }, { tid: 2, name: 'worker', cpuTicks: 0 }] };
  const b = { main: 1000, threads: [{ tid: 1, name: 'node', cpuTicks: 1000 }, { tid: 2, name: 'worker', cpuTicks: 200 }, { tid: 3, name: 'new', cpuTicks: 5 }] };
  assert.deepEqual(hotThreads(a, b, 10), { mainCores: 0.9, hottest: { name: 'node', cores: 0.9 }, threads: 2 });
});

test('probe never invents numbers where the host has no cgroup v2 (macOS: all unknown)', () => {
  const p = probe();
  assert.equal(typeof p.cores, 'number');
  if (!p.supported) { assert.equal(p.cpuMax, null); assert.equal(p.memoryMaxMb, null); assert.equal(p.cpuStat, null); }
});

test('between: no enforcement periods is 0 throttling (known); no cpu.stat is unknown', () => {
  const at = (periods, throttled) => ({ procStat: { steal: 0, total: 1000 }, cpuStat: { usage_usec: 0, nr_periods: periods, nr_throttled: throttled, throttled_usec: 0 }, pressure: {} });
  assert.equal(between(at(0, 0), at(0, 0), 10).throttledPeriodShare, 0);
  assert.equal(between({ ...at(0, 0), cpuStat: null }, { ...at(0, 0), cpuStat: null }, 10).throttledPeriodShare, null);
});
