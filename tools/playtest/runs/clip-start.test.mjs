// Clips without loading, idle time or night (#888): recordings start at arrival (or from load when asked), previews
// start from run events, and runs set the world's time of day before any camera opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCamera, writeRecording } from '../observer/browser.mjs';
import { worldBase } from '../lib/arrival.mjs';
import { autoStart, runEvents } from './recording.mjs';
import { validateSpec } from './spec.mjs';
import { startRun, RECEIPT } from './lifecycle.mjs';
import { applyWorldTime, parseTimeOfDay, worldTimeRequest } from './setup.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NO_WORLD = 'http://127.0.0.1:1/w/x'; // refuses at once: the clock read is best effort

/** A Playwright stand-in that logs the order of what the camera does. */
function fakeBrowser({ screencast = true } = {}) {
  const log = [];
  const browser = { contexts: [], newContext: async (opts) => {
    const c = { opts, addInitScript: async () => {}, close: async () => { log.push('close'); },
      newPage: async () => {
        const page = { on: () => {}, goto: async () => { log.push('goto'); }, waitForFunction: async () => { log.push('arrived'); },
          evaluate: async () => ({}), screenshot: async () => {},
          video: () => (opts.recordVideo ? { path: async () => { const f = join(opts.recordVideo.dir, 'pw-video.webm'); writeFileSync(f, 'load-video'); return f; } } : null),
          ...(screencast ? { screencast: { start: async ({ path }) => { log.push('screencast'); page.cast = path; }, stop: async () => { log.push('stop'); writeFileSync(page.cast, 'arrival-video'); } } } : {}) };
        return page;
      } };
    browser.contexts.push(c); return c;
  } };
  return { browser, log };
}

test('a run camera records from arrival by default: no video before the world is on screen; the sidecar says arrival with an arrived mark at 0', async () => {
  const dir = tmp('clip-arrival-'), { browser, log } = fakeBrowser();
  const o = { base: NO_WORLD, kind: 'wide', name: 'wide', viewport: { width: 640, height: 400 }, record: { dir, meta: { runId: 'r' } } };
  const cam = await openCamera({ ...o, browser });
  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.contexts[0].opts.recordVideo, undefined, 'the context does not record from page creation');
  assert.deepEqual(log, ['goto', 'arrived', 'screencast'], 'the take starts only after arrival');
  const meta = writeRecording({ name: cam.name, o, cam, state: await cam.state(), r: await cam.close() });
  assert.equal(readFileSync(join(dir, 'wide.webm'), 'utf8'), 'arrival-video');
  assert.deepEqual({ start: meta.start, startRequested: meta.startRequested, marks: meta.marks, uncut: meta.uncut, realSpeed: meta.realSpeed }, { start: 'arrival', startRequested: 'arrival', marks: [{ label: 'arrived', atSec: 0 }], uncut: true, realSpeed: true });
  assert.match(meta.startedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(Date.parse(meta.startedAt) >= Date.parse(meta.openedAt));
});

test('--from-load (record.start "load") records the context from page creation; a Playwright without screencast falls back, labelled', async () => {
  const dir = tmp('clip-load-');
  const load = fakeBrowser(), o = { base: NO_WORLD, kind: 'wide', name: 'wide', viewport: { width: 640, height: 400 }, record: { dir, start: 'load' } };
  const cam = await openCamera({ ...o, browser: load.browser });
  assert.ok(load.browser.contexts[0].opts.recordVideo, 'recorded from page creation');
  assert.ok(!load.log.includes('screencast'));
  const meta = writeRecording({ name: cam.name, o, cam, r: await cam.close() });
  assert.deepEqual({ start: meta.start, startRequested: meta.startRequested, fallback: meta.startFallback }, { start: 'load', startRequested: 'load', fallback: undefined });
  assert.equal(meta.marks[0].label, 'arrived');
  assert.equal(meta.startedAt, meta.openedAt);

  const old = fakeBrowser({ screencast: false }), o2 = { ...o, name: 'old', record: { dir } };
  const cam2 = await openCamera({ ...o2, browser: old.browser });
  assert.equal(old.browser.contexts.length, 2, 'reopened with recordVideo');
  const meta2 = writeRecording({ name: cam2.name, o: o2, cam: cam2, r: await cam2.close() });
  assert.deepEqual({ start: meta2.start, startRequested: meta2.startRequested }, { start: 'load', startRequested: 'arrival' });
  assert.match(meta2.startFallback, /page\.screencast unavailable/);
});

test('a camera that never arrives under the arrival start keeps a still of where it stuck, not an empty video', async () => {
  const dir = tmp('clip-stuck-'), { browser } = fakeBrowser();
  const shots = [];
  browser.newContext = ((orig) => async (opts) => { const c = await orig(opts); const np = c.newPage; c.newPage = async () => { const p = await np(); p.waitForFunction = async () => { throw new Error('Timeout 10ms exceeded'); }; p.screenshot = async ({ path }) => { shots.push(path); writeFileSync(path, 'png'); }; return p; }; return c; })(browser.newContext);
  const o = { base: NO_WORLD, kind: 'wide', name: 'wide', viewport: { width: 640, height: 400 }, record: { dir } };
  const err = await openCamera({ ...o, browser }).catch((e) => e);
  assert.match(err.message, /Timeout/);
  const meta = writeRecording({ name: 'wide', o, cam: err.cam, r: { video: err.video, opened: err.opened, closed: { at: new Date().toISOString(), mono: 0 } }, closedBy: 'open-failed' });
  assert.deepEqual({ file: meta.file, shot: meta.openFailedShot, partial: meta.partial, start: meta.start }, { file: null, shot: 'wide.open-failed.png', partial: true, start: 'arrival' });
  assert.ok(existsSync(join(dir, 'wide.open-failed.png')));
});

function runFolder() {
  const run = tmp('clip-auto-'), pt = join(run, 'playtest');
  for (const d of ['recordings', 'seats/ada', 'seats/bo', 'personas/ada', 'personas/bo']) mkdirSync(join(pt, d), { recursive: true });
  writeFileSync(join(pt, 'recordings', 'wide.webm'), 'v');
  writeFileSync(join(pt, 'recordings', 'wide.webm.json'), JSON.stringify({ camera: 'wide', file: 'wide.webm', start: 'arrival', startedAt: '2026-11-05T10:00:00.000Z', videoSec: 120 }));
  writeFileSync(join(pt, 'recordings', 'ada.webm'), 'v');
  writeFileSync(join(pt, 'recordings', 'ada.webm.json'), JSON.stringify({ camera: 'ada', file: 'ada.webm', start: 'arrival', startedAt: '2026-11-05T09:59:58.000Z', videoSec: 120 }));
  writeFileSync(join(pt, 'recordings', 'old.webm'), 'v'); // recorded from page creation before #888: no startedAt
  writeFileSync(join(pt, 'recordings', 'old.webm.json'), JSON.stringify({ camera: 'old', file: 'old.webm', openedAt: '2026-11-05T09:59:50.000Z', videoSec: 120 }));
  const turn = (t, calls) => JSON.stringify({ turn: 2, reason: 'wake', startedAt: t, toolCalls: calls });
  writeFileSync(join(pt, 'seats', 'ada', 'turns.jsonl'), [JSON.stringify({ turn: 1, reason: 'onboard', startedAt: '2026-11-05T09:59:00.000Z', toolCalls: [{ cmd: 'node eden.mjs create Ada', ms: 100 }] }),
    turn('2026-11-05T10:00:08.000Z', [{ cmd: 'node eden.mjs ack m1 "Walking"', ms: 80 }, { cmd: 'node eden.mjs act "walk to the orchard"', ms: 30000 }])].join('\n') + '\n');
  writeFileSync(join(pt, 'seats', 'bo', 'turns.jsonl'), turn('2026-11-05T10:00:06.000Z', [{ cmd: 'node eden.mjs ack m2 "Walking"', ms: 500 }, { cmd: 'node eden.mjs act "walk to the orchard"', ms: 9000 }]) + '\n');
  writeFileSync(join(pt, 'personas', 'bo', 'decisions.jsonl'), JSON.stringify({ t: '2026-11-05T10:00:05.900Z', delivered: { requestId: 'bo-001' }, scripted: { text: 'Walk to the orchard' } }) + '\n');
  return run;
}

test('preview --auto takes its start from the run\'s first act and records the event and the mapping', () => {
  const run = runFolder();
  const ev = runEvents(run);
  assert.deepEqual([ev.firstAct.seat, ev.firstAct.t, ev.firstRequest.seat], ['bo', '2026-11-05T10:00:06.500Z', 'bo'], 'the act call, after the ack before it');
  const wide = autoStart(run, { camera: 'wide', seconds: 15 });
  assert.equal(wide.ok, true, wide.error);
  assert.equal(wide.auto.offsetSec, 6.5);
  assert.deepEqual([wide.fromSec, wide.toSec], [5.5, 20.5]);
  assert.ok(Math.abs(wide.fromSec - wide.auto.offsetSec) <= 3, 'within 3 s of the first act');
  assert.deepEqual([wide.auto.event.kind, wide.auto.event.source, wide.auto.recording.basis], ['first-act', 'playtest/seats/bo/turns.jsonl', 'startedAt']);
  const ada = autoStart(run, { camera: 'ada' });
  assert.deepEqual([ada.auto.event.seat, ada.auto.offsetSec, ada.fromSec], ['ada', 10.08, 9.1], "a follow camera starts from its own seat's first act");
  const old = autoStart(run, { camera: 'old' });
  assert.deepEqual([old.auto.recording.basis, old.auto.offsetSec], ['openedAt (recorded from page creation)', 16.5]);
  assert.match(autoStart(run, { camera: 'drone' }).error, /no recording for camera drone/);
  const empty = runFolder(); writeFileSync(join(empty, 'playtest', 'seats', 'ada', 'turns.jsonl'), ''); writeFileSync(join(empty, 'playtest', 'seats', 'bo', 'turns.jsonl'), ''); writeFileSync(join(empty, 'playtest', 'personas', 'bo', 'decisions.jsonl'), '');
  assert.match(autoStart(empty, { camera: 'wide' }).error, /no act or delivered request/);
});

function specFixture() {
  const dir = tmp('clip-spec-'), serverRoot = join(dir, 'root');
  for (const f of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'g.json']) { mkdirSync(join(serverRoot, f, '..'), { recursive: true }); writeFileSync(join(serverRoot, f), ''); }
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ name: 'fixture', version: 1, seed: 1, providers: { allowed: ['codex'] }, world: { kind: 'dev', genesis: 'g.json', slug: 'pt-fixture', port: 4999 }, durationSec: 5, seats: [], god: null, observer: { cameras: [] }, director: { mode: 'scripted', script: [] }, review: { mode: 'deterministic' } }));
  let port = 43470;
  return { dir, serverRoot, spec: (world = {}, observer = {}) => ({ soulRun: 1, scenario: join(dir, 'scenario.json'), cast: 'none', world: { port: port++, ...world }, observer: { check: false, ...observer } }) };
}

test('world time: midday with the clock paused by default, "keep" leaves it, an invalid timeOfDay or recordStart is refused', () => {
  const f = specFixture();
  const v = (w, o) => validateSpec(f.spec(w, o), { serverRoot: f.serverRoot });
  assert.deepEqual(v().effective.world.time, { timeOfDay: 12, timeScale: 0 });
  assert.equal(v({ timeOfDay: 'keep' }).effective.world.time, null);
  assert.deepEqual(v({ timeOfDay: '15:30', timeScale: 24 }).effective.world.time, { timeOfDay: '15:30', timeScale: 24 });
  for (const bad of [25, -1, '25:00', '12:75', 'noon', true]) assert.deepEqual(v({ timeOfDay: bad }).errors.map((e) => e.code), ['world.timeOfDay'], JSON.stringify(bad));
  assert.deepEqual(v({ timeScale: 2000 }).errors.map((e) => e.code), ['world.timeScale']);
  assert.deepEqual(v({}, { recordStart: 'whenever' }).errors.map((e) => e.code), ['observer.recordStart']);
  assert.equal(v({}, { cameras: ['wide'], record: ['wide'], recordStart: 'load' }).scenario.observer.recordStart, 'load');
  assert.equal(v({}, { cameras: ['wide'], record: ['wide'] }).scenario.observer.recordStart, 'arrival');
  assert.deepEqual(v({ timeScale: 0.05 }).errors.map((e) => e.code), ['world.timeScale'], 'below the server\'s slowest clock');
  // A scenario's own recordStart stands unless the spec names one, and the effective spec says the same.
  const sc = JSON.parse(readFileSync(join(f.dir, 'scenario.json'), 'utf8')); writeFileSync(join(f.dir, 'scenario.json'), JSON.stringify({ ...sc, observer: { ...sc.observer, recordStart: 'load' } }));
  const fromScenario = v({}, { cameras: ['wide'], record: ['wide'] });
  assert.deepEqual([fromScenario.effective.observer.recordStart, fromScenario.scenario.observer.recordStart], ['load', 'load']);
  const overridden = v({}, { cameras: ['wide'], record: ['wide'], recordStart: 'arrival' });
  assert.deepEqual([overridden.effective.observer.recordStart, overridden.scenario.observer.recordStart], ['arrival', 'arrival']);
  writeFileSync(join(f.dir, 'scenario.json'), JSON.stringify(sc));
  assert.deepEqual([parseTimeOfDay('7pm'), parseTimeOfDay('12am'), parseTimeOfDay(24), parseTimeOfDay('x')], [19, 0, 0, null]);
  assert.equal(worldTimeRequest({ timeOfDay: 'keep', timeScale: 0 }).time.timeScale, 0, 'pause the clock without moving it');
});

test('a run applies world time after provision and before seats or cameras; the receipt and sidecar meta record it', async () => {
  const f = specFixture(), calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url.replace(/^.*\/v1/, '/v1'), init?.body ? JSON.parse(init.body) : null]);
    const body = url.endsWith('/mint') ? { token: 'god-token' } : { accepted: true, env: { time: { clock: '12:00', datetime: '2026-01-01T12:00:00', paused: true, timeScale: 0 } } };
    return { ok: true, status: 200, json: async () => body };
  };
  const order = [];
  const r = await startRun({ spec: f.spec({}, { cameras: ['wide'], record: ['wide'] }), serverRoot: f.serverRoot, outDir: join(f.dir, 'run'),
    worldTimeFn: (a) => { order.push('world time'); return applyWorldTime({ ...a, fetchImpl }); },
    execute: async ({ hooks, scenarioFile }) => { await hooks.afterProvision({ world: { base: NO_WORLD } }); order.push('seats and cameras'); assert.deepEqual(JSON.parse(readFileSync(scenarioFile, 'utf8')).observer.recordMeta.worldTimeRequested, { timeOfDay: 12, timeScale: 0 }); return 0; } });
  assert.equal(r.status, 'completed', r.reason);
  assert.deepEqual(order, ['world time', 'seats and cameras']);
  assert.deepEqual(calls[1], ['/v1/god/env', { timeOfDay: 12, timeScale: 0, note: 'run world time (#888)' }]);
  const rec = JSON.parse(readFileSync(join(f.dir, 'run', RECEIPT), 'utf8'));
  assert.deepEqual({ ok: rec.worldTime.ok, applied: rec.worldTime.applied }, { ok: true, applied: { clock: '12:00', datetime: '2026-01-01T12:00:00', paused: true, timeScale: 0 } });
  assert.ok(!JSON.stringify(rec).includes('god-token'), 'the minted token is never recorded');
  // A world that refuses is recorded, and the run goes on.
  const refused = await applyWorldTime({ base: NO_WORLD, time: { timeOfDay: 12 }, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ code: 'forbidden' }) }) });
  assert.deepEqual({ ok: refused.ok, error: refused.error }, { ok: false, error: 'god mint refused: HTTP 403 forbidden' });
});

test('a camera refuses a record start it does not know rather than record nothing', async () => {
  const { browser } = fakeBrowser();
  await assert.rejects(openCamera({ browser, base: NO_WORLD, kind: 'wide', record: { dir: tmp('clip-bad-'), start: 'Load' } }), /record\.start "Load": arrival or load/);
});

test('the proof recorder: arrival by default, --from-load, and a time-of-day plan only for a local world page', async () => {
  const { parseArgs, worldTimePlan } = await import('../../../.claude/skills/proof/record.mjs');
  const tools = { ...(await import('../lib/arrival.mjs')), ...(await import('./setup.mjs')) };
  const d = parseArgs(['--url', 'http://127.0.0.1:4710/w/proof?dev=1', '--out', 'x.mp4']);
  assert.deepEqual([d.fromLoad, d.timeOfDay, d.arrivalSeconds], [false, '12', 120]);
  assert.equal(parseArgs(['--from-load']).fromLoad, true);
  assert.deepEqual(worldTimePlan(d, tools), { base: 'http://127.0.0.1:4710/w/proof', time: { timeOfDay: 12, timeScale: 0 } });
  assert.deepEqual(worldTimePlan({ ...d, timeOfDay: '7pm' }, tools).time, { timeOfDay: '7pm', timeScale: 0 });
  assert.deepEqual(worldTimePlan({ ...d, timeOfDay: 'keep' }, tools), { why: 'keep' });
  assert.deepEqual(worldTimePlan({ ...d, url: 'http://127.0.0.1:4720/' }, tools), { why: 'not a local world URL' });
  assert.throws(() => worldTimePlan({ ...d, timeOfDay: '26' }, tools), /--time-of-day: 26/);
});

test('the proof recorder sets time only on a local world page', () => {
  assert.equal(worldBase('http://127.0.0.1:4710/w/proof?dev=1'), 'http://127.0.0.1:4710/w/proof');
  assert.equal(worldBase('http://localhost:4720/'), null, 'the world list is not a world');
  assert.equal(worldBase('https://soul.game/w/eden'), null, 'never a public world');
});
