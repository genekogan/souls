// CW5 S2 (#739 A1–A3, A5): cost provenance (billed / estimated / allocated, kept apart) and the context packet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { metricsText } from './metrics.mjs';
import { openStore, scrapeOnce, costFor, launcherBuild } from './telemetry.mjs';
import { report } from './telemetry/report.mjs';
import { catchUp, open } from './telemetry/alerts.mjs';
import { parseCost, costReport, hoursFromReport } from './telemetry/cost.mjs';
import { packet, packetText } from './telemetry/packet.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const tmp = (t) => { mkdirSync(join(ROOT, '.local'), { recursive: true }); const d = mkdtempSync(join(ROOT, '.local', 'cost-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const S = 1000, H = 3_600_000, EVERY = 15 * S, NOV = Date.UTC(2026, 10, 1), DEC = Date.UTC(2026, 11, 1);
const base = () => ({ schema: 'sim-cost/1', currency: 'EUR', period: { start: '2026-11-01', end: '2026-12-01' }, items: [
  { id: 'host', kind: 'compute', basis: 'fixed', amount: 300, source: 'invoice', sourceDate: '2026-11-01', billed: [{ period: { start: '2026-10-01', end: '2026-11-01' }, amount: 290 }, { period: { start: '2026-11-01', end: '2026-12-01' }, amount: 300 }] },
  { id: 'backups', kind: 'backups', basis: 'metered', rate: 0.02, unit: 'GB-month', usage: 500, source: 'price list', sourceDate: '2026-10-15' },
  { id: 'edge', kind: 'model', payer: 'owner', basis: 'metered', rate: null, usage: null, source: 'owners' }] });
const day = { from: NOV + 2 * 24 * H, to: NOV + 3 * 24 * H };

test('cost file: refused with the field named', () => {
  const bad = (f, re) => { const c = base(); f(c); assert.throws(() => parseCost(c), re); };
  bad((c) => { c.schema = 'x'; }, /schema/);
  bad((c) => { c.currency = 'euro'; }, /currency/);
  bad((c) => { c.period.end = '2026-10-01'; }, /period.end/);
  bad((c) => { c.items[0].kind = 'rent'; }, /items\[0\].kind/);
  bad((c) => { c.items[1].rate = -1; }, /items\[1\].rate/);
  bad((c) => { c.items[1].id = 'host'; }, /items\[1\].id/);
  bad((c) => { delete c.items[0].source; }, /items\[0\].source/);
  bad((c) => { c.items[0].billed[0].period.start = 'Oct'; }, /billed\[0\].period.start/);
  assert.equal(parseCost(JSON.parse(readFileSync(join(ROOT, 'tools/world-launcher/telemetry/cost.example.json'), 'utf8'))).items.length, 6, 'the committed example parses');
});

test('three numbers kept apart: billed (overlapping periods only), estimated (prorated, projected), allocated (by world-hours)', () => {
  const r = costReport(parseCost(base()), { ...day, coveredHours: 24, busyHours: 24, worldHours: { a: 24, b: 8 } });
  assert.equal(r.billed.amount, 300, 'the October invoice does not overlap a November day');
  assert.deepEqual(r.billed.entries.map((e) => e.period.start), ['2026-11-01T00:00:00.000Z']);
  assert.deepEqual(r.estimated.window, { low: 10.33, high: 10.33 }, '(300 + 0.02 x 500) / 30 days');
  assert.deepEqual(r.estimated.billingPeriod, { low: 310, high: 310 });
  assert.equal(r.allocated.byWorld.a.amount, 7.75); assert.equal(r.allocated.byWorld.b.amount, 2.58);
  assert.equal(r.allocated.sharedOverhead, 0); assert.equal(r.allocated.unallocated, 0);
  assert.match(r.allocated.note, /not an invoice saving/);
  assert.ok(!('total' in r), 'no single figure adds billed, estimated and allocated');
  // owner-paid inference is external, never platform spend
  assert.deepEqual(r.external, [{ id: 'edge', kind: 'model', payer: 'owner', perPeriod: 'unknown' }]);
  assert.ok(!r.estimated.items.some((i) => i.id === 'edge'));
});

test('zero activity: fixed rent stays, everything is shared overhead, nothing divides by zero', () => {
  const r = costReport(parseCost(base()), { ...day, coveredHours: 24, busyHours: 0, worldHours: {} });
  assert.equal(r.estimated.window.low, 10.33, 'fixed cost does not drop with activity');
  assert.deepEqual(r.allocated.byWorld, {}); assert.equal(r.allocated.sharedOverhead, 10.33);
  const none = costReport(parseCost(base()), { ...day, coveredHours: 0, worldHours: {} });
  assert.equal(none.allocated.unallocated, 10.33, 'no telemetry at all: unallocated, not zero');
  // an owner-only file still names owner inference and has an empty platform estimate
  const c = base(); c.items = [c.items[2]];
  assert.deepEqual(costReport(parseCost(c), { ...day }).estimated.window, { low: 0, high: 0 });
});

test('missing rates or usage are unknown with coverage: the high end stays open, never 0', () => {
  const c = base(); c.items[1].usage = null; c.items.push({ id: 'render', kind: 'render', basis: 'metered', rate: null, usage: 10, source: 'unrecorded' });
  const r = costReport(parseCost(c), { ...day, coveredHours: 24, busyHours: 24, worldHours: { a: 24 } });
  assert.deepEqual(r.estimated.window, { low: 10, high: null });
  assert.deepEqual(r.estimated.unknown, ['backups: usage unknown', 'render: rate unknown']);
  assert.equal(r.external.at(-1).id, 'edge', 'owner model item given: no duplicate generic entry');
  assert.match(r.billed.coverage, /^1 of 3 platform items/);
});

test('partial periods: a window half outside the billing period is prorated over the overlap only and says so', () => {
  const r = costReport(parseCost(base()), { from: DEC - 12 * H, to: DEC + 12 * H, coveredHours: 24, busyHours: 24, worldHours: { a: 24 } });
  assert.equal(r.window.shareOfBillingPeriod, 0.0167); assert.equal(r.window.outsideBillingPeriodHours, 12);
  assert.equal(r.estimated.window.low, 5.17);
  const late = base(); late.items[0].billed = [];
  assert.equal(costReport(parseCost(late), { ...day }).billed.amount, null, 'no invoice for the window: null, not 0');
});

async function store(t, scene, minutes) {
  const dir = tmp(t), s = openStore(dir, { everyMs: EVERY }), T0 = NOV + 2 * 24 * H;
  for (let k = 0; k < minutes * 4; k++) {
    const at = T0 + k * EVERY, worlds = scene(k * 15);
    const live = (o = {}) => ({ v: 1, pid: 1, at: at - 2 * S, phase: 'serving', loop: { lastTurnAgeMs: 10, delayP99Ms: o.loop ?? 20, elu: 0.3 }, tick: { world: k * 300, service5s: 1, p99Ms: 30, lateTotal: 0 }, heap: { usedMb: 500, limitMb: 2048, gcPct10s: 1, gcSecondsTotal: 0 }, level: 'green', queue: { depth: 0, oldestMs: 0 }, souls: { awake: 4, waiting: 0, connected: 4 }, shed: { reads: 0, acts: 0 } });
    const body = metricsText({ now: at, launcher: { build: 'build-test-1', maxRunning: 10, memAvailableMb: 8192 }, worlds: worlds.map((w) => ({ slug: w.slug, status: w.status ?? 'running', restarts: 0, live: w.status && w.status !== 'running' ? null : live(w) })) });
    await scrapeOnce(s, 'http://127.0.0.1:1/', { now: () => at, fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) });
  }
  s.saveState();
  return { dir, s, from: T0, to: T0 + minutes * 60 * S };
}

test('allocation from a real store: world-hours from status share; busy time from the fleet running count', async (t) => {
  const { dir, from, to } = await store(t, (s) => [{ slug: 'a' }, { slug: 'b', status: s < 30 * 60 ? 'running' : 'asleep' }], 60);
  const r = report(dir, openStore(dir).state, { range: `${new Date(from).toISOString()}..${new Date(to).toISOString()}`, now: to, everyMs: EVERY });
  const h = hoursFromReport(r, EVERY);
  assert.equal(h.busyFrom, 'fleet never idle'); assert.ok(Math.abs(h.worldHours.a - 1) < 0.02 && Math.abs(h.worldHours.b - 0.5) < 0.02, JSON.stringify(h));
  const file = join(dir, 'cost.json'); writeFileSync(file, JSON.stringify(base()));
  const c = costFor(r, file, EVERY);
  assert.ok(Math.abs(c.allocated.byWorld.a.worldHours / c.allocated.byWorld.b.worldHours - 2) < 0.05);
  assert.ok(Math.abs(c.allocated.byWorld.a.amount + c.allocated.byWorld.b.amount + c.allocated.sharedOverhead + c.allocated.unallocated - c.estimated.window.low) <= 0.02, 'the allocation adds back up to the estimate');
  assert.equal(launcherBuild(dir, from, to + 1), 'build-test-1');
});

test('packet: deterministic, names the firing bottleneck and the next decision, holds no user content', async (t) => {
  const { dir, from, to } = await store(t, (s) => [{ slug: 'quiet-hall' }, { slug: 'busy-plaza', loop: s >= 20 * 60 ? 600 : 20 }], 40);
  const r = report(dir, openStore(dir).state, { range: `${new Date(from).toISOString()}..${new Date(to).toISOString()}`, now: to, everyMs: EVERY });
  const evaluated = catchUp(dir, { everyMs: EVERY, now: to });
  const file = join(dir, 'cost.json'); writeFileSync(file, JSON.stringify(base()));
  const p = packet({ r, open: evaluated.open, cost: costFor(r, file, EVERY), build: { launcher: 'build-test-1', tools: 'abc1234' } });
  assert.deepEqual(p.bottleneck, { from: 'alerts', rule: 'loop-stall', world: 'busy-plaza', alsoFiring: 0 });
  assert.match(p.next, /^investigate loop-stall on busy-plaza/);
  assert.equal(p.headroom.qualified, 'unqualified (no capacity verdict given: --bench <capacity-qualify dir>)');
  assert.equal(p.cost.billed, 300); assert.deepEqual(p.cost.external, ['edge: unknown']);
  assert.deepEqual(packet({ r, open: evaluated.open, cost: costFor(r, file, EVERY), build: { launcher: 'build-test-1', tools: 'abc1234' } }), p, 'same inputs, same packet');
  const txt = packetText(p);
  assert.ok(txt.split('\n').length <= 10, 'concise');
  assert.doesNotMatch(JSON.stringify(p), /Meet\d|soul_|token/i, "world slugs and numbers only");
  // without alerts evaluated, the next step says so; with everything quiet, no capacity action
  assert.match(packet({ r, open: null }).next, /^evaluate alerts/);
  assert.match(packet({ r, open: [] }).next, /^no capacity action indicated; headroom unqualified \(no capacity verdict given/);
  assert.equal(packet({ r, open: [{ rule: 'telemetry-gap', state: 'firing' }] }).next.startsWith('restore telemetry coverage'), true);
  // #853 review notes: the invoice period is printed with the billed amount; a cost packet is marked private
  assert.deepEqual(p.cost.billedPeriods, ['2026-11-01..2026-12-01']); assert.match(txt, /billed 300 \(invoice period 2026-11-01\.\.2026-12-01, not prorated to the window\)/);
  assert.match(p.private, /do not publish/); assert.match(txt.split('\n')[0], /PRIVATE/); assert.equal(packet({ r, open: [] }).private, undefined, 'no cost file: nothing private');
  // a stale or unreadable alert state never reads as "0 firing"
  const end = Date.parse(r.range.to);
  const stale = packet({ r, open: [], alertsThrough: end - 10 * 60_000 });
  assert.match(stale.alerts, /^stale \(evaluated through /); assert.match(stale.next, /^the saved alert state is stale: re-evaluate alerts/);
  assert.match(packet({ r, open: [], alertsThrough: null }).alerts, /^stale/, 'a state with no evaluated row is stale');
  assert.deepEqual(packet({ r, open: [], alertsThrough: end - 60_000 }).alerts, { firing: 0, unknown: 0 }, 'current');
  const bad = packet({ r, open: null, alertsUnreadable: true }); assert.equal(bad.alerts, 'not evaluated (alerts-state.json unreadable)'); assert.match(bad.next, /^alerts-state\.json is unreadable: re-evaluate/);
});

test('cli: cost needs --cost; packet prints the text packet from a store', async (t) => {
  const { dir } = await store(t, () => [{ slug: 'a' }], 10);
  const cli = (args) => { try { return { out: execFileSync(process.execPath, [join(ROOT, 'tools/world-launcher/telemetry.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }; } catch (e) { return { out: String(e.stderr), code: e.status }; } };
  const no = cli(['cost', '--dir', dir]); assert.equal(no.code, 1); assert.match(no.out, /--cost/);
  const p = cli(['packet', '--dir', dir, '--range', '2026-11-03T00:00:00Z..2026-11-03T00:10:00Z']);
  assert.equal(p.code, 0); assert.match(p.out, /^context packet \(sim-context-packet\/1\)/); assert.match(p.out, /launcher build-test-1/); assert.match(p.out, /next {7}evaluate alerts/);
});
