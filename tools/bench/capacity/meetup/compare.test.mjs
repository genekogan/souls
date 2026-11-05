// CW8 (#742) A1, #947: the comparison keeps every cell; missing is never better; a regression stays visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, compareText, direction } from './compare.mjs';

const run = (profile, rep, h = {}, o = {}, w = {}) => ({ profile, rep,
  headline: { joined: 50, readE2eP95Ms: 2000, actionStartP95Ms: 1300, clockMinActive: 0.57, restarts: 1, ...h },
  qualification: { qualifying: { executor: true, quiet: true, short: false }, objectives: { read: false, clock: false, failures: false, ...o },
    allocation: { cpuMax: null, memoryMaxMb: null }, worlds: { mw0: { hottestCores: 0.54, loopP99MsMax: 700, queueMax: 5, met: false, ...w } } } });
const art = (runs, inputs = {}) => ({ summary: { verdict: { verdict: 'software bottleneck', qualifies: false, reasons: ['objectives missed'] }, runs },
  qualify: { workflowRun: '1', commit: 'aaaaaaaa1', inputs: { hostClass: 'maintainer-self-hosted', short: false, quietDeclared: true, browser: false, repeats: 2, slice: null, ...inputs }, before: { quiet: true }, after: { quiet: true } } });

test('direction: called only when the repeat ranges do not overlap; missing is never better', () => {
  assert.equal(direction([100, 200], [50, 90], 'lower'), 'better');
  assert.equal(direction([100, 200], [150, 300], 'lower'), 'overlaps');
  assert.equal(direction([100, 200], [201, 300], 'lower'), 'worse');
  assert.equal(direction([0.5, 0.6], [0.99, 1], 'higher'), 'better');
  assert.equal(direction(null, [1, 1], 'lower'), 'missing');
  assert.equal(direction([1, 1], null, 'lower'), 'missing');
  assert.equal(direction([100, 200], Object.assign([10, 10], { partial: '1/2' }), 'lower'), 'partial');
});

test('an artifact compared with itself: like for like, no direction but overlaps, every cell present', () => {
  const a = art([run('even', 1), run('even', 2), run('meetup', 1), run('meetup', 2)]), x = compare(a, a);
  assert.deepEqual(x.conditions.notLikeForLike, []);
  for (const P of Object.values(x.profiles)) {
    assert.deepEqual(P.missing, []);
    assert.ok(P.headline.filter((h) => h.base).every((h) => h.dir === 'overlaps'));
    assert.ok(P.objectives.every((o) => o.state === 'still failing'));
  }
  // the fixtures record no cgroup limits: a null match is reported as not compared, not as like for like
  assert.deepEqual(x.conditions.unknown, ['cpuMax', 'memoryMaxMb']);
  assert.match(compareText(x), /like for like on the known conditions[\s\S]*not compared: `cpuMax`, `memoryMaxMb`/);
  assert.match(compareText(x), /Verdict before:[^\n]*\n  - objectives missed/);
});

test('fixed, still failing and regressed objectives; a still-missed world stays bold', () => {
  const base = art([run('even', 1), run('even', 2)]);
  const cand = art([run('even', 1, { readE2eP95Ms: 200, restarts: 0 }, { read: true, clock: false, failures: true, delivery: false }, { hottestCores: 0.3 }),
    run('even', 2, { readE2eP95Ms: 220, restarts: 0 }, { read: true, clock: false, failures: true, delivery: false }, { hottestCores: 0.31 })]);
  const P = compare(base, cand).profiles.even, st = (rep, key) => P.objectives.find((o) => o.rep === rep && o.key === key).state;
  assert.equal(st(1, 'read'), 'fixed'); assert.equal(st(1, 'clock'), 'still failing'); assert.equal(st(1, 'delivery'), 'new, misses');
  assert.equal(P.headline.find((h) => h.key === 'readE2eP95Ms').dir, 'better');
  assert.equal(P.worlds[0].stillMissed, true); assert.equal(P.worlds[0].cells.find((c) => c.key === 'hottestCores').dir, 'better');
  const t = compareText(compare(base, cand));
  assert.match(t, /\| clock \| 1 \| misses \| \*\*misses\*\* \| \*\*still failing\*\* \|/);
  assert.match(t, /\| delivery \| 1 \| missing \| \*\*misses\*\* \| \*\*new, misses\*\* \|/);
  // an objective that met before and misses now is a regression
  const reg = compare(art([run('even', 1, {}, { read: true })]), art([run('even', 1, {}, { read: false })])).profiles.even;
  assert.equal(reg.objectives.find((o) => o.key === 'read').state, 'regressed');
  assert.match(t, /\| mw0 \| r1 missed, r2 missed \| \*\*r1 missed, r2 missed\*\* \|/);
});

test('missing repeats, cells and worlds are listed, never read as better', () => {
  const base = art([run('even', 1), run('even', 2, {}, {}, {})]);
  const c2 = run('even', 1, { readE2eP95Ms: undefined }); delete c2.qualification.objectives.clock; c2.qualification.worlds = {};
  const x = compare(base, art([c2])), P = x.profiles.even;
  assert.deepEqual(P.missing, ['candidate r2']);
  assert.equal(P.headline.find((h) => h.key === 'readE2eP95Ms').dir, 'missing');
  assert.equal(P.objectives.find((o) => o.rep === 1 && o.key === 'clock').state, 'missing');
  assert.equal(P.worlds[0].missing, true); assert.equal(P.worlds[0].cells[0].dir, 'missing');
  const t = compareText(x);
  assert.match(t, /\*\*Missing repeats:\*\* candidate r2/); assert.match(t, /\| readE2eP95Ms \| lower \| 2000 \| missing \| \*\*missing\*\* \|/);
  // a value missing in one repeat of a present run is partial, never a direction
  const half = compare(base, art([run('even', 1, { readE2eP95Ms: 10 }), run('even', 2, { readE2eP95Ms: undefined })])).profiles.even.headline.find((h) => h.key === 'readE2eP95Ms');
  assert.equal(half.dir, 'partial'); assert.equal(half.cand.partial, '1/2');
  // a profile on one side only is still listed
  assert.deepEqual(compare(base, art([run('meetup', 1)])).profiles.meetup.missing, ['baseline r1']);
});

test('changed run conditions are flagged as not like for like', () => {
  const runs = [run('even', 1), run('even', 2)], x = compare(art(runs), art(runs, { slice: { cpuQuota: '600%', memoryMax: '12G' }, quietDeclared: false }));
  assert.deepEqual(x.conditions.notLikeForLike.map((d) => d.key).sort(), ['quietDeclared', 'slice']);
  assert.match(compareText(x), /\*\*Not like for like\.\*\*[\s\S]*`slice`: "none" → \{"cpuQuota":"600%","memoryMax":"12G"\}/);
});
