// Soul Runs SR1 (#750): spec validation, the ownership ledger and the lifecycle's terminal receipts. Deterministic:
// no world, browser, model or network; temporary directories only; borrowed resources are fakes the test watches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from './ledger.mjs';
import { validateSpec } from './spec.mjs';
import { startRun, cleanupRun, RECEIPT } from './lifecycle.mjs';
import { cmdRun } from '../playtest.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 43170;
function fixture({ seats = [{ id: 'pip', adapter: 'codex-headless', model: 'm' }], kind = 'dev' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'soul-runs-'));
  const serverRoot = join(dir, 'root');
  for (const f of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'g.json']) { mkdirSync(join(serverRoot, f, '..'), { recursive: true }); writeFileSync(join(serverRoot, f), ''); }
  const scenario = { name: 'fixture', version: 1, seed: 1, providers: { allowed: ['codex'] }, world: { kind, genesis: 'g.json', slug: 'pt-fixture', port: 4999 }, durationSec: 5, seats, god: null, observer: { cameras: [] }, director: { mode: 'scripted', script: seats.map((s) => ({ seat: s.id, atSec: 1, channel: 'card', text: 'sit' })) }, review: { mode: 'deterministic', developer: false } };
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
  const spec = (extra = {}) => ({ soulRun: 1, scenario: join(dir, 'scenario.json'), cast: 'none', world: { port: nextPort++ }, observer: { check: false }, ...extra });
  return { dir, serverRoot, spec, out: () => join(dir, `run-${nextPort++}`) };
}
const receiptOf = (r) => JSON.parse(readFileSync(join(r.references.runDir, RECEIPT), 'utf8'));

test('ledger releases owned resources newest first, records failure and timeout, never touches borrowed', async () => {
  const order = [];
  const l = createLedger();
  const borrowed = { stopped: false };
  l.borrow('service', 'other-world', { stop: () => { borrowed.stopped = true; } });
  l.own('world', 'w', async () => { order.push('w'); return { stopped: true }; });
  l.own('controller', 'a', async () => { order.push('a'); throw new Error('turn still running'); });
  l.own('browser', 'b', () => new Promise(() => {}));
  const s = await l.releaseAll({ waitMs: 50 });
  assert.deepEqual(order, ['a', 'w']);
  assert.equal(s.ok, false);
  assert.deepEqual(s.failed.sort(), ['browser:b:timed-out', 'controller:a:failed']);
  assert.equal(s.entries.find((e) => e.owner === 'borrowed').state, 'untouched');
  assert.equal(borrowed.stopped, false);
  let late = 0;
  l.own('world', 'late', () => { late++; });
  await sleep(10);
  assert.equal(late, 1, 'a resource registered after cleanup is released at once');
  assert.equal(l.summary().entries.find((e) => e.id === 'late').late, true);
});

test('validateSpec refuses unsupported or unauthorized runs before anything is created', () => {
  const f = fixture();
  const codes = (spec) => validateSpec(spec, { serverRoot: f.serverRoot }).errors.map((e) => e.code);
  assert.deepEqual(codes({ ...f.spec(), soulRun: 2 }), ['spec.version']);
  assert.deepEqual(codes({ ...f.spec(), extra: 1 }), ['spec.unknown-field']);
  assert.deepEqual(codes({ ...f.spec(), cast: 'composed' }), ['cast.unsupported']);
  assert.deepEqual(codes({ ...f.spec(), scenario: join(f.dir, 'nope.json') }), ['scenario.not-found']);
  assert.deepEqual(codes({ ...f.spec(), world: { natives: true } }), ['world.override']);
  assert.deepEqual(codes({ ...f.spec(), world: { genesis: 'x' } }), ['world.source'], 'a world source must exist under the server root');
  assert.deepEqual(codes({ ...f.spec(), world: { genesis: 'g.json', snapshot: 'g.json' } }), ['world.source']);
  assert.deepEqual(codes({ ...f.spec(), cast: 'scenario' }), ['controllers.live-model'], 'a live seat needs explicit opt-in');
  assert.deepEqual(codes({ ...f.spec(), cast: 'scenario', controllers: { allowLiveModels: true }, limits: { maxControllers: 0 } }), ['limits.maxControllers']);
  const live = fixture({ kind: 'live' });
  assert.ok(codes(live.spec()).includes('world.kind'));
  const ok = validateSpec(f.spec({ durationSec: 7 }), { serverRoot: f.serverRoot });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.scenario.seats, []);
  assert.deepEqual(ok.scenario.director.script, []);
  assert.deepEqual(ok.scenario.soulRunCast.removedSeats, ['pip']);
  assert.equal(ok.scenario.durationSec, 7);
  assert.deepEqual(ok.policy.required, []);
  const withSeats = validateSpec({ ...f.spec(), cast: 'scenario', controllers: { allowLiveModels: true } }, { serverRoot: f.serverRoot });
  assert.deepEqual(withSeats.controllers, [{ id: 'pip', adapter: 'codex-headless', model: 'm', effort: null }]);
  // An arm label (#839) is recorded in the effective spec; a malformed one is refused.
  assert.equal(ok.effective.arm, null);
  assert.equal(validateSpec({ ...f.spec(), arm: 'baseline' }, { serverRoot: f.serverRoot }).effective.arm, 'baseline');
  assert.deepEqual(codes({ ...f.spec(), arm: 'two words' }), ['spec.arm']);
  assert.deepEqual(codes({ ...f.spec(), arm: 7 }), ['spec.arm']);
});

test('refused runs create no run directory', async () => {
  const f = fixture();
  const out = f.out();
  const r = await startRun({ spec: { ...f.spec(), cast: 'scenario' }, serverRoot: f.serverRoot, outDir: out, execute: () => assert.fail('must not execute') });
  assert.equal(r.status, 'refused');
  assert.equal(existsSync(out), false);
  mkdirSync(join(f.dir, 'empty'), { recursive: true }); writeFileSync(join(f.dir, 'empty', 'g.json'), '{}');
  const missing = await startRun({ spec: f.spec(), serverRoot: join(f.dir, 'empty'), outDir: out, execute: () => assert.fail('must not execute') });
  assert.equal(missing.stage, 'preflight');
  assert.equal(existsSync(out), false);
});

test('completed run releases owned resources, keeps evidence and applies delete retention', async () => {
  const f = fixture();
  const r = await startRun({ spec: f.spec({ retention: { worldData: 'delete', controllerState: 'keep' } }), serverRoot: f.serverRoot, outDir: f.out(), execute: async ({ hooks, runDir }) => {
    const data = join(runDir, 'playtest/server/data'); mkdirSync(data, { recursive: true });
    const seat = join(runDir, 'playtest/seats/pip'); mkdirSync(seat, { recursive: true });
    hooks.own('world', 'w', async () => ({ stopped: true }), { pid: 0, dataDir: data });
    hooks.own('controller', 'pip', async () => {}, { dir: seat });
    return 0;
  } });
  assert.equal(r.status, 'completed');
  const rec = receiptOf(r);
  assert.equal(rec.resources.ok, true);
  assert.equal(rec.resources.borrowed, 2);
  assert.equal(rec.retention.worldData.action, 'deleted');
  assert.equal(existsSync(rec.retention.worldData.paths[0]), false);
  assert.equal(existsSync(rec.retention.controllerState.paths[0]), true);
  assert.equal(rec.retention.controllerState.sensitive, true);
  assert.ok(rec.cost.wallMs >= 0 && rec.cost.lifecycleOverheadMs >= 0);
  assert.ok(['measured', 'unavailable'].includes(rec.cost.processes?.status), 'descendant process cost is recorded (#803)');
  assert.equal(existsSync(join(rec.references.runDir, 'scenario.effective.json')), true);
  const c = cleanupRun(rec.references.runDir, { controllerState: true });
  assert.equal(c.ok, true);
  assert.equal(existsSync(rec.retention.controllerState.paths[0]), false);
});

test('startup failure: owned resources released, evidence and receipt kept, delete retention not applied', async () => {
  const f = fixture();
  const released = [];
  const r = await startRun({ spec: f.spec({ retention: { worldData: 'delete', controllerState: 'delete' } }), serverRoot: f.serverRoot, outDir: f.out(), execute: async ({ hooks, runDir }) => {
    const data = join(runDir, 'playtest/server/data'); mkdirSync(data, { recursive: true });
    hooks.own('world', 'w', () => { released.push('world'); }, { dataDir: data });
    throw new Error('world did not come up');
  } });
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /did not come up/);
  assert.deepEqual(released, ['world']);
  const rec = receiptOf(r);
  assert.match(rec.retention.worldData.action, /did not complete/);
  assert.equal(existsSync(rec.retention.worldData.paths[0]), true);
});

test('cancellation stops a running scenario, releases owned resources and says cancelled', async () => {
  const f = fixture();
  const ac = new AbortController();
  const released = [];
  const running = startRun({ spec: f.spec(), serverRoot: f.serverRoot, outDir: f.out(), signal: ac.signal, execute: async ({ hooks }) => {
    hooks.own('world', 'w', () => { released.push('world'); });
    hooks.own('controller', 'a', () => { released.push('a'); });
    await new Promise(() => {}); // a play step that never returns on its own
  } });
  await sleep(50);
  ac.abort('SIGINT');
  const r = await running;
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(released, ['a', 'world']);
  assert.equal(receiptOf(r).resources.ok, true);
});

test('wall limit stops the run; a failed release turns success into a recorded failure', async () => {
  const f = fixture();
  const limited = await startRun({ spec: f.spec({ limits: { maxWallSec: 0.05 } }), serverRoot: f.serverRoot, outDir: f.out(), execute: async ({ hooks }) => { hooks.own('world', 'w', () => {}); await new Promise(() => {}); } });
  assert.equal(limited.status, 'stopped-limit');
  const leaky = await startRun({ spec: f.spec({ limits: { cleanupWaitMs: 30 } }), serverRoot: f.serverRoot, outDir: f.out(), execute: async ({ hooks }) => { hooks.own('browser', 'b', () => new Promise(() => {})); return 0; } });
  assert.equal(leaky.status, 'failed');
  assert.match(leaky.reason, /cleanup incomplete: browser:b:timed-out/);
});

test('observer check failure is attributed to #633; required observer fails the start, optional disables cameras', async () => {
  const f = fixture();
  const importer = async () => { throw new SyntaxError('missing ) after argument list'); };
  let modulesSeen = null;
  const optional = await startRun({ spec: f.spec({ observer: { check: true, timeoutMs: 1000 } }), serverRoot: f.serverRoot, outDir: f.out(), observerImporter: importer, loadModules: async () => ({ browser: {}, provision: {} }), execute: async ({ hooks }) => { modulesSeen = hooks.modules; return 0; } });
  assert.equal(optional.status, 'completed');
  assert.deepEqual({ ok: optional.observer.ok, stage: optional.observer.stage, owner: optional.observer.owner }, { ok: false, stage: 'import', owner: '#633' });
  assert.equal(modulesSeen.browser, null);
  const required = await startRun({ spec: f.spec({ observer: { check: true, required: true, timeoutMs: 1000 } }), serverRoot: f.serverRoot, outDir: f.out(), observerImporter: importer, execute: () => assert.fail('must not execute') });
  assert.equal(required.status, 'failed');
  assert.equal(required.stage, 'observer-check');
  const hung = await startRun({ spec: f.spec({ observer: { check: true, timeoutMs: 30 } }), serverRoot: f.serverRoot, outDir: f.out(), observerImporter: () => new Promise(() => {}), loadModules: async () => ({}), execute: async () => 0 });
  assert.match(hung.observer.error, /exceeded 30 ms/);
});

test('cmdRun hooks: the real scenario runner registers its world and controllers, and a failed onboarding is cleaned up', async () => {
  const f = fixture();
  const stops = { world: 0, seat: 0 };
  const modules = {
    provision: {
      startWorld: async ({ onSpawn, port }) => { onSpawn({ pid: 999999 }); return { base: `http://127.0.0.1:${port}/w/x`, pid: 999999, build: 'test' }; },
      describeWorld: async () => ({}), healthz: async () => ({ ok: true }), stopWorld: async () => { stops.world++; return { stopped: true }; },
    },
    seat: { createSeat: async ({ seat }) => ({ dir: join(f.dir, 'seat'), info: { id: seat.id }, onboard: async () => ({ ok: false }), stop: async () => { stops.seat++; } }) },
    owner: {},
  };
  const r = await startRun({ spec: f.spec({ cast: 'scenario', controllers: { allowLiveModels: true } }), serverRoot: f.serverRoot, outDir: f.out(),
    execute: ({ scenarioFile, playtestDir, serverRoot, hooks }) => cmdRun({ _: ['run', scenarioFile], out: playtestDir, 'server-root': serverRoot }, { ...hooks, modules, preflight: { ok: true, allow: { allowed: true } } }) });
  assert.equal(r.status, 'failed');
  assert.equal(r.exit, 1);
  const rec = receiptOf(r);
  assert.deepEqual(rec.resources.entries.filter((e) => e.owner === 'run').map((e) => `${e.kind}:${e.id}:${e.state}`), ['world:pt-fixture:released', 'controller:pip:released']);
  assert.ok(stops.world >= 1 && stops.seat >= 1);
  assert.ok(rec.evidence.receipts.includes('9-failure.json'), 'the runner kept its own failure receipt');
});

test('cmdRun hooks are opt-in: without a signal it reaches provision as before; an aborted signal stops before it', async () => {
  // A cancelled signal only matters when a lifecycle passes one; a plain call reaches provision as before.
  const f = fixture();
  const ac = new AbortController(); ac.abort('x');
  let started = false;
  const modules = { provision: { startWorld: async () => { started = true; throw new Error('stop here'); } } };
  await assert.rejects(cmdRun({ _: ['run', join(f.dir, 'scenario.json')], out: join(f.dir, 'plain'), 'server-root': f.serverRoot }, { modules, preflight: { ok: true } }), /stop here/);
  assert.equal(started, true);
  await assert.rejects(cmdRun({ _: ['run', join(f.dir, 'scenario.json')], out: join(f.dir, 'cancelled'), 'server-root': f.serverRoot }, { modules, preflight: { ok: true }, signal: ac.signal }), /cancelled before provision/);
});

test('the scenario preflight runs once: its result reaches cmdRun through hooks', async () => {
  const f = fixture();
  let calls = 0, seen = null;
  const r = await startRun({ spec: f.spec(), serverRoot: f.serverRoot, outDir: f.out(), scenarioPreflight: async () => { calls += 1; return { ok: true, checks: {}, allow: { allowed: true } }; },
    execute: async ({ hooks }) => { seen = hooks.preflight; return 0; } });
  assert.equal(r.status, 'completed');
  assert.equal(calls, 1);
  assert.deepEqual(seen, { ok: true, checks: {}, allow: { allowed: true } });
});

test('process cost (#803): the sampler runs for the whole run and its summary lands in cost.processes; a throwing sampler never stops the run', async () => {
  const f = fixture();
  let started = 0, stopped = 0;
  const fake = () => { started++; return { stop: async () => { stopped++; return { status: 'measured', intervalMs: 2000, samples: 3, classes: { browser: { cpuSec: 1, peakRssMb: 1, processes: 1 } } }; } }; };
  const r = await startRun({ spec: f.spec(), serverRoot: f.serverRoot, outDir: f.out(), processSampler: fake, execute: async () => 0 });
  assert.equal(r.status, 'completed');
  assert.deepEqual([started, stopped], [1, 1]);
  assert.equal(receiptOf(r).cost.processes.classes.browser.cpuSec, 1);
  const bad = await startRun({ spec: f.spec(), serverRoot: f.serverRoot, outDir: f.out(), processSampler: () => { throw new Error('no ps'); }, execute: async () => 0 });
  assert.equal(bad.status, 'completed');
  assert.deepEqual(receiptOf(bad).cost.processes, { status: 'unavailable', reason: 'no ps' });
});
