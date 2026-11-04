// CW5 S3 (#739 A3): unit costs with explicit denominators, world-count scenarios from a measured bench, the packet's
// qualification line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { metricsText } from './metrics.mjs';
import { openStore, scrapeOnce, costFor } from './telemetry.mjs';
import { report, reduceRange } from './telemetry/report.mjs';
import { parseCost, costReport, hoursFromReport } from './telemetry/cost.mjs';
import { packet, qualification } from './telemetry/packet.mjs';
import { acceptedActs, scenarios, scenariosText, sizingFromBench, soulHours, unitCosts } from './telemetry/units.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (t) => { mkdirSync(join(ROOT, '.local'), { recursive: true }); const d = mkdtempSync(join(ROOT, '.local', 'units-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const S = 1000, H = 3_600_000, EVERY = 15 * S, NOV = Date.UTC(2026, 10, 1);
const base = () => ({ schema: 'sim-cost/1', currency: 'EUR', period: { start: '2026-11-01', end: '2026-12-01' }, items: [
  { id: 'host', kind: 'compute', basis: 'fixed', amount: 300, host: { cores: 8, memGiB: 16 }, source: 'invoice', sourceDate: '2026-11-01' },
  { id: 'backups', kind: 'backups', basis: 'metered', rate: 0.02, unit: 'GB-month', usage: 500, source: 'price list', sourceDate: '2026-10-15' },
  { id: 'edge', kind: 'model', payer: 'owner', basis: 'metered', rate: null, usage: null, source: 'owners' }] });

// a store of `minutes` scrapes: worlds a (4 awake Souls) and b (2), and optionally an act-completed counter rising 1/scrape
async function store(t, { minutes = 60, acts = true, souls = true } = {}) {
  const dir = tmp(t), s = openStore(dir, { everyMs: EVERY }), T0 = NOV + 2 * 24 * H;
  for (let k = 0; k < minutes * 4; k++) {
    const at = T0 + k * EVERY;
    const live = (n) => ({ v: 1, pid: 1, at: at - 2 * S, phase: 'serving', loop: { lastTurnAgeMs: 10, delayP99Ms: 20, elu: 0.3 }, tick: { world: k * 300, service5s: 1, p99Ms: 30, lateTotal: 0 },
      heap: { usedMb: 500, limitMb: 2048, gcPct10s: 1, gcSecondsTotal: 0 }, level: 'green', queue: { depth: 0, oldestMs: 0 }, ...(souls ? { souls: { awake: n, waiting: 0, connected: n } } : {}), shed: { reads: 0, acts: 0 } });
    let body = metricsText({ now: at, launcher: { build: 'b1', maxRunning: 10, memAvailableMb: 8192 }, worlds: [{ slug: 'a', status: 'running', restarts: 0, live: live(4) }, { slug: 'b', status: 'running', restarts: 0, live: live(2) }] });
    if (acts) body += `# TYPE sim_world_requests_total counter\nsim_world_requests_total{world="a",class="act",outcome="completed"} ${k}\nsim_world_requests_total{world="a",class="act",outcome="rejected"} ${5 * k}\nsim_world_requests_total{world="b",class="act",outcome="completed"} ${k}\n`;
    await scrapeOnce(s, 'http://127.0.0.1:1/', { now: () => at, fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) });
  }
  s.saveState();
  return { dir, s, range: `${new Date(T0).toISOString()}..${new Date(T0 + minutes * 60 * S).toISOString()}`, from: T0, to: T0 + minutes * 60 * S };
}
const unitsOf = (x, file) => {
  const st = openStore(x.dir), r = report(x.dir, st.state, { range: x.range, now: x.to, everyMs: EVERY }), h = hoursFromReport(r, EVERY);
  return unitCosts(costFor(r, file, EVERY), { worldHours: h.worldHours, soulHours: soulHours(r, EVERY), acts: acceptedActs(reduceRange(x.dir, st.state.types, x.from, x.to, EVERY)) });
};

test('unit costs: one numerator over three explicit denominators; only completed acts count', async (t) => {
  const x = await store(t); const file = join(x.dir, 'cost.json'); writeFileSync(file, JSON.stringify(base()));
  const u = unitsOf(x, file);
  // (300 + 10) / 30 days / 24 = 0.4306 per hour of the window, all of it covered
  assert.ok(Math.abs(u.numerator.low - 0.43) <= 0.01, JSON.stringify(u.numerator)); assert.equal(u.numerator.low, u.numerator.high);
  assert.match(u.numerator.what, /shared fixed overhead included/); assert.equal(u.numerator.sharedFixedOverheadShare, 0);
  assert.ok(Math.abs(u.perWorldHour.denominator - 2) < 0.02, 'two worlds for an hour');
  assert.ok(Math.abs(u.perActiveSoulHour.denominator - 6) < 0.1, '4 + 2 awake Souls for an hour');
  assert.ok(Math.abs(u.perAcceptedAct.denominator - 2 * 239) < 1, 'completed only: the rejected counter is not an accepted act');
  assert.ok(Math.abs(u.perWorldHour.low - u.numerator.low / u.perWorldHour.denominator) < 0.001);
  assert.match(u.note, /not humans/);
});

test('unit costs: absent series are unknown with the reason; zero activity has no unit cost; an open high stays open', async (t) => {
  const x = await store(t, { acts: false, souls: false, minutes: 10 }); const file = join(x.dir, 'cost.json');
  const c = base(); c.items[1].usage = null; writeFileSync(file, JSON.stringify(c));
  const u = unitsOf(x, file);
  assert.equal(u.perAcceptedAct.value, null); assert.match(u.perAcceptedAct.reason, /not exported/);
  assert.equal(u.perActiveSoulHour.value, null); assert.match(u.perActiveSoulHour.reason, /not exported/);
  assert.equal(u.perWorldHour.high, null, 'backups usage unknown: open high'); assert.ok(u.perWorldHour.low > 0);
  assert.deepEqual(u.numerator.unknown, ['backups: usage unknown']);
  const idle = unitCosts(costReport(parseCost(base()), { from: NOV, to: NOV + 24 * H, coveredHours: 24, busyHours: 0, worldHours: {} }), { worldHours: {}, soulHours: 0, acts: 0 });
  for (const k of ['perWorldHour', 'perActiveSoulHour', 'perAcceptedAct']) { assert.equal(idle[k].value, null); assert.equal(idle[k].denominator, 0); assert.match(idle[k].reason, /no unit cost/); }
  assert.equal(idle.numerator.sharedFixedOverheadShare, 1, 'with no world running, all of it is shared fixed overhead');
});

function bench(t, verdict = 'inconclusive', qualifies = false) {
  const dir = tmp(t);
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ verdict: { verdict, qualifies } }));
  writeFileSync(join(dir, 'qualify.json'), JSON.stringify({ workflowRun: '123', commit: 'abc', inputs: { hostClass: 'test-class' } }));
  const run = (name, scale) => { mkdirSync(join(dir, name)); writeFileSync(join(dir, name, 'result.json'), JSON.stringify({ resources: {
    quiet: { worlds: { w0: { cpuCores: 0.2, rssMbMax: 1000 }, w1: { cpuCores: 0.04, rssMbMax: 400 } } },
    active: { worlds: { w0: { cpuCores: 0.8 * scale, rssMbMax: 1600 }, w1: { cpuCores: 0.2 * scale, rssMbMax: 400 } }, launcherCpuCores: 0.04, launcherRssMbMax: 128 } } }));
    writeFileSync(join(dir, name, 'receipt.json'), JSON.stringify({ fixtures: [{ souls: 8 }, { souls: 2 }] })); };
  run('even-r1', 1); run('meetup-r1', 1.2);
  return dir;
}

test('scenarios: measured footprint, 30 % headroom, hosts from the host shape, verdict carried, metered items not scaled', (t) => {
  const z = sizingFromBench(bench(t));
  assert.deepEqual(z.perWorld.activeCores, { mean: 0.55, max: 0.96 }, 'mean of the fleet means (0.5, 0.6); max is one world');
  assert.deepEqual(z.perWorld.activeRssMb, { mean: 1000, max: 1600 }); assert.equal(z.soulsPerWorld, 5); assert.equal(z.source.run, '123');
  const s = scenarios(parseCost(base()), z, [10, 50]);
  const [ten, fifty] = s.rows;
  assert.deepEqual(ten.active, { cores: 5.5, memGiB: 9.766, withHeadroom: { cores: 7.857, memGiB: 13.951 } });
  // usable per host: 8 × 0.7 − 0.04 = 5.56 cores, 16 × 0.7 − 0.125 = 11.075 GiB → memory binds: ceil(9.766 / 11.075) = 1
  assert.equal(ten.hosts, 1); assert.equal(fifty.hosts, 5, 'ceil(48.83 / 11.075)');
  assert.deepEqual(fifty.monthly, { compute: 1500, low: 1510, high: 1510 });
  assert.equal(ten.souls, 50); assert.equal(ten.qualified, false);
  assert.match(s.label, /^unqualified: the bench verdict is inconclusive \(run 123\)/); assert.match(s.label, /serialized hot world/);
  assert.deepEqual(s.notScaled, ['backups: not scaled (no per-world usage driver)']); assert.deepEqual(s.external, ['edge']);
  assert.match(scenariosText(s), /unqualified/);
  // no host shape: hosts and cost unknown, never 0; only a qualifying `passes` lifts the label
  const c = base(); delete c.items[0].host; const u = scenarios(parseCost(c), z, [10]);
  assert.equal(u.rows[0].hosts, null); assert.deepEqual(u.rows[0].monthly, { compute: null, low: null, high: null }); assert.match(u.host, /^unknown/);
  assert.equal(scenarios(parseCost(base()), sizingFromBench(bench(t, 'passes', true)), [10]).rows[0].qualified, true);
  assert.equal(scenarios(parseCost(base()), sizingFromBench(bench(t, 'passes', false)), [10]).rows[0].qualified, false, 'passes on a non-qualifying run stays unqualified');
  const open = base(); open.items[1].rate = null; assert.equal(scenarios(parseCost(open), z, [10]).rows[0].monthly.high, null);
});

test('cost file: a host shape must be positive and only on a fixed compute item', () => {
  const bad = (f, re) => { const c = base(); f(c); assert.throws(() => parseCost(c), re); };
  bad((c) => { c.items[0].host.cores = 0; }, /items\[0\].host.cores/);
  bad((c) => { c.items[0].host = { cores: 4 }; }, /items\[0\].host.memGiB/);
  bad((c) => { c.items[1].host = { cores: 4, memGiB: 8 }; }, /items\[1\].host is only for a fixed compute item/);
  assert.deepEqual(parseCost(base()).items[0].host, { cores: 8, memGiB: 16 });
});

test('packet: qualified only by a qualifying passes verdict', () => {
  assert.match(qualification(null), /^unqualified \(no capacity verdict given/);
  assert.equal(qualification({ verdict: 'inconclusive', qualifies: false, run: '9' }), 'unqualified: the bench verdict is inconclusive (run 9)');
  assert.equal(qualification({ verdict: 'passes', qualifies: false }), 'unqualified: the bench verdict is passes');
  assert.equal(qualification({ verdict: 'passes', qualifies: true, run: '9' }), 'qualified: the bench verdict passes (run 9)');
  const r = { range: {}, coverage: { share: 1, samples: 1, expected: 1, gaps: 0 }, fleet: {}, worlds: {} };
  assert.equal(packet({ r, open: [], capacity: { verdict: 'software bottleneck', qualifies: true } }).next, 'no capacity action indicated; headroom unqualified: the bench verdict is software bottleneck');
});

test('cli: units and scenarios', async (t) => {
  const x = await store(t, { minutes: 10 }); const file = join(x.dir, 'cost.json'); writeFileSync(file, JSON.stringify(base()));
  const cli = (args) => { try { return { out: execFileSync(process.execPath, [join(ROOT, 'tools/world-launcher/telemetry.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }; } catch (e) { return { out: String(e.stderr), code: e.status }; } };
  const u = cli(['units', '--dir', x.dir, '--cost', file, '--range', x.range]); assert.equal(u.code, 0, u.out); assert.ok(JSON.parse(u.out).perAcceptedAct.denominator > 0);
  const s = cli(['scenarios', '--cost', file, '--bench', bench(t), '--worlds', '10,400']); assert.equal(s.code, 0, s.out); assert.match(s.out, /^scenarios \(EUR/); assert.match(s.out, /^ {3}400 /m);
  assert.equal(cli(['scenarios', '--cost', file]).code, 1);
  const p = cli(['packet', '--dir', x.dir, '--range', x.range, '--bench', bench(t)]); assert.equal(p.code, 0, p.out); assert.match(p.out, /unqualified: the bench verdict is inconclusive \(run 123\)/);
});
