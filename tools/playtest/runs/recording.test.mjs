// Soul Run recording (#754): spec validation for cameras/record/modes, the lifecycle's provenance and summary, preview
// derivation (labelled, source untouched) and packaging (private index, selected projection that refuses private paths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateSpec, applyOverrides } from './spec.mjs';
import { startRun, summarizeRecordings, RECEIPT } from './lifecycle.mjs';
import { previewRecording, packageRun, listRecordings } from './recording.mjs';

let nextPort = 43270;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'soul-rec-'));
  const serverRoot = join(dir, 'root');
  for (const f of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'g.json']) { mkdirSync(join(serverRoot, f, '..'), { recursive: true }); writeFileSync(join(serverRoot, f), ''); }
  const scenario = { name: 'fixture', version: 1, seed: 1, providers: { allowed: ['codex'] }, world: { kind: 'dev', genesis: 'g.json', slug: 'pt-fixture', port: 4999 }, durationSec: 5, seats: [], god: null, observer: { cameras: [] }, director: { mode: 'scripted', script: [] }, review: { mode: 'deterministic', developer: false } };
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
  const spec = (observer = {}) => ({ soulRun: 1, scenario: join(dir, 'scenario.json'), cast: 'none', world: { port: nextPort++ }, observer: { check: false, ...observer } });
  return { dir, serverRoot, spec, out: () => join(dir, `run-${nextPort++}`) };
}
const codes = (v) => v.errors.map((e) => e.code);

test('cameras, recording and observer modes validate; unknown or inconsistent requests are refused before anything starts', () => {
  const f = fixture();
  const ok = validateSpec(f.spec({ cameras: ['wide', 'free'], record: ['wide', 'free', 'follow'], freeComposition: { drag: [-100, 20], wheel: -200 } }), { serverRoot: f.serverRoot });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.scenario.observer.record, ['wide', 'free', 'follow']);
  assert.deepEqual(ok.scenario.observer.cameras, ['wide', 'free']);
  assert.deepEqual(codes(validateSpec(f.spec({ cameras: ['drone'] }), { serverRoot: f.serverRoot })), ['observer.cameras']);
  assert.deepEqual(codes(validateSpec(f.spec({ cameras: [], record: ['wide'] }), { serverRoot: f.serverRoot })), ['observer.record'], 'recording a camera that is not opened');
  assert.deepEqual(codes(validateSpec(f.spec({ mode: 'passive', record: true }), { serverRoot: f.serverRoot })), ['observer.record'], 'recording needs cameras');
  assert.deepEqual(codes(validateSpec(f.spec({ mode: 'radio' }), { serverRoot: f.serverRoot })), ['observer.mode']);
  assert.deepEqual(codes(validateSpec(f.spec({ zoom: 2 }), { serverRoot: f.serverRoot })), ['observer.unknown-field']);
  assert.deepEqual(codes(validateSpec(f.spec({ cameras: ['free'], freeComposition: { drag: [1] } }), { serverRoot: f.serverRoot })), ['observer.freeComposition']);
  // Recording size (#802): compact by default, viewport or an explicit size by option; bad values refused by field.
  assert.equal(ok.scenario.observer.recordSize, 'compact', 'compact is the default');
  const full = validateSpec(f.spec({ cameras: ['wide'], record: ['wide'], recordSize: 'viewport' }), { serverRoot: f.serverRoot });
  assert.equal(full.ok, true, JSON.stringify(full.errors));
  assert.equal(full.scenario.observer.recordSize, 'viewport');
  assert.deepEqual(validateSpec(f.spec({ cameras: ['wide'], record: ['wide'], recordSize: { width: 640, height: 400 } }), { serverRoot: f.serverRoot }).scenario.observer.recordSize, { width: 640, height: 400 });
  for (const bad of ['tiny', { width: 0, height: 400 }, { width: 640.5, height: 400 }, { width: 640 }, { width: 640, height: 400, fps: 10 }, 12])
    assert.deepEqual(codes(validateSpec(f.spec({ cameras: ['wide'], record: ['wide'], recordSize: bad }), { serverRoot: f.serverRoot })), ['observer.recordSize'], JSON.stringify(bad));
  assert.deepEqual(codes(validateSpec(f.spec({ cameras: ['wide'], recordSize: 'viewport' }), { serverRoot: f.serverRoot })), ['observer.recordSize'], 'a size without a recording');
  // The default mode leaves an existing scenario's observer untouched.
  assert.equal(applyOverrides({ world: {}, observer: { sampleSec: 3 } }, { observer: { mode: 'cameras' } }).observer.mode, undefined);
  assert.equal(applyOverrides({ world: {}, observer: {} }, { observer: { mode: 'off' } }).observer.mode, 'off');
});

test('off and passive modes skip the browser check; a recorded run carries its provenance and a recordings summary', async () => {
  const f = fixture();
  const off = await startRun({ spec: f.spec({ check: true, mode: 'off' }), serverRoot: f.serverRoot, outDir: f.out(), observerImporter: () => assert.fail('no browser in mode off'), execute: async () => 0 });
  assert.equal(off.status, 'completed');
  assert.deepEqual({ ok: off.observer.ok, mode: off.observer.mode }, { ok: null, mode: 'off' });
  let scen = null;
  const rec = await startRun({ spec: f.spec({ cameras: ['wide'], record: ['wide'] }), serverRoot: f.serverRoot, outDir: f.out(),
    execute: async ({ scenarioFile, playtestDir }) => {
      scen = JSON.parse(readFileSync(scenarioFile, 'utf8'));
      mkdirSync(join(playtestDir, 'recordings'), { recursive: true });
      writeFileSync(join(playtestDir, 'recordings', 'wide.webm'), 'v');
      writeFileSync(join(playtestDir, 'recordings', 'wide.webm.json'), JSON.stringify({ camera: 'wide', file: 'wide.webm', bytes: 1, sha256: 'x', durationSec: 2, partial: true, closedBy: null, requested: { kind: 'wide' }, actual: { mode: 'broadcast' }, pageErrors: ['e'] }));
      return 0;
    } });
  assert.equal(scen.observer.recordMeta.runId, rec.runId);
  assert.match(scen.observer.recordMeta.effectiveSpecSha256, /^[0-9a-f]{64}$/);
  const r = JSON.parse(readFileSync(join(rec.references.runDir, RECEIPT), 'utf8')).recordings;
  assert.deepEqual({ count: r.count, partial: r.partial, camera: r.items[0].camera, actual: r.items[0].actual, pageErrors: r.items[0].pageErrors }, { count: 1, partial: 1, camera: 'wide', actual: 'broadcast', pageErrors: 1 });
  assert.equal(summarizeRecordings(join(f.dir, 'none')).count, 0);
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
function recordedRun() {
  const run = mkdtempSync(join(tmpdir(), 'soul-rec-run-')), recDir = join(run, 'playtest', 'recordings');
  mkdirSync(recDir, { recursive: true });
  const video = join(recDir, 'wide.webm');
  const g = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x200:rate=10:duration=4', '-c:v', 'libvpx', '-b:v', '200k', video]);
  assert.equal(g.status, 0, String(g.stderr));
  const sha = createHash('sha256').update(readFileSync(video)).digest('hex');
  writeFileSync(`${video}.json`, JSON.stringify({ recording: 1, camera: 'wide', file: 'wide.webm', bytes: 1, sha256: sha, durationSec: 4, partial: false, requested: { kind: 'wide', viewport: { width: 320, height: 200 } }, actual: { mode: 'broadcast', presentation: 'broadcast' }, pageErrors: [], runId: 'fixture-run' }));
  writeFileSync(join(run, 'run-receipt.json'), JSON.stringify({ runId: 'fixture-run', status: 'completed', startedAt: 'a', endedAt: 'b', spec: { sha256: 's', effective: { name: 'fx', observer: { mode: 'cameras' } } }, source: { commit: 'c0ffee' }, resources: { ok: true, failed: [] }, observer: { ok: true }, references: { runDir: run } }));
  return { run, video, sha };
}

test('a preview is a separately labelled excerpt with its source and range; the source recording is unchanged', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { run, video, sha } = recordedRun();
  let labelled = null;
  const label = async (text, width, out) => { labelled = { text, width }; spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=red:s=${width}x20`, '-frames:v', '1', out]); };
  const p = await previewRecording(run, { camera: 'wide', fromSec: 1, toSec: 9, label });
  assert.equal(p.ok, true, p.error);
  assert.deepEqual({ derived: p.derived, fullProof: p.fullProof, camera: p.source.camera, file: p.source.file, sha256: p.source.sha256, from: p.source.fromSec, to: p.source.toSec, unchanged: p.sourceUnchanged }, { derived: true, fullProof: false, camera: 'wide', file: 'wide.webm', sha256: sha, from: 1, to: 4, unchanged: true });
  assert.match(labelled.text, /^PREVIEW, not full proof: 1-4 s of wide\.webm/);
  assert.equal(createHash('sha256').update(readFileSync(video)).digest('hex'), sha);
  assert.ok(existsSync(join(run, 'derived', 'previews', 'wide-1-4.mp4.json')));
  assert.match((await previewRecording(run, { camera: 'follow', fromSec: 0, toSec: 1, label })).error, /no recording for camera follow/);
  assert.match((await previewRecording(run, { camera: 'wide', fromSec: 5, toSec: 6, label })).error, /past the recording/);
  writeFileSync(video, 'tampered');
  assert.match((await previewRecording(run, { camera: 'wide', fromSec: 0, toSec: 1, label })).error, /no longer matches/);
});

test('packaging writes a private index and a selected projection; unselected and path-bearing items stay out', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { run } = recordedRun();
  const p = packageRun(run, { select: ['wide', 'nope'] });
  assert.equal(p.ok, true);
  const ix = JSON.parse(readFileSync(p.index, 'utf8')), sel = JSON.parse(readFileSync(p.selected, 'utf8'));
  assert.equal(ix.private, true);
  assert.equal(ix.recordings[0].file, join('playtest', 'recordings', 'wide.webm'));
  assert.ok(ix.limits.includes('not evaluated (run.mjs evaluate)'));
  assert.deepEqual(sel.evidence.map((e) => [e.kind, e.camera, e.complete, e.actionVisible]), [['recording', 'wide', true, 'not judged by the package: watch it']]);
  assert.deepEqual(sel.refused, [{ item: 'nope', why: 'not a recording camera or preview file of this run' }]);
  assert.doesNotMatch(readFileSync(p.selected, 'utf8'), /\/(Users|home|private|tmp|var)\//);
  assert.match(readFileSync(p.md, 'utf8'), /Private local index: do not publish/);
  assert.equal(packageRun(run, {}).picked, 0, 'nothing is selected by default');
  assert.equal(listRecordings(run).length, 1);
});

test('packaging refuses a selected sidecar, a measurement and a question basis that hold local paths or hosts', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { run } = recordedRun();
  // Built at run time so the fixture paths are not literals in the tree.
  const abs = ['', 'home', 'fixture-user', 'runs', 'x.webm'].join('/'), homeRel = ['~', 'runs', 'q.json'].join('/'), up = ['..', '..', 'outside', 'm.json'].join('/');
  const recDir = join(run, 'playtest', 'recordings');
  writeFileSync(join(recDir, 'leaky.webm'), 'v');
  writeFileSync(join(recDir, 'leaky.webm.json'), JSON.stringify({ recording: 1, camera: 'leaky', file: 'leaky.webm', bytes: 1, sha256: 'y', durationSec: 1, partial: false, requested: { kind: 'wide', viewport: { width: 320, height: 200 } }, actual: { mode: abs, presentation: 'broadcast' }, pageErrors: [] }));
  const evDir = join(run, 'evaluations', '001-fixture'); mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, 'evaluation.json'), JSON.stringify({ measures: [{ id: 'ok-measure', status: 'measured', value: 3 }, { id: 'abs-measure', status: 'measured', value: { log: abs } }, { id: 'host-measure', status: 'measured', summary: 'served from 10.1.2.3:4300' }, { id: 'up-measure', status: 'measured', value: up }],
    acceptance: { predeclared: [{ id: 'q1', basis: `read ${homeRel}`, verdict: 'pass' }] }, questions: [{ id: 'q2', basis: 'world truth', verdict: 'pass' }] }));
  const p = packageRun(run, { select: ['wide', 'leaky'] });
  assert.equal(p.ok, true, p.error);
  const text = readFileSync(p.selected, 'utf8'), sel = JSON.parse(text);
  assert.deepEqual(sel.evidence.map((e) => e.camera), ['wide'], 'the path-bearing sidecar is not published');
  assert.deepEqual(sel.refused.map((r) => r.item).sort(), ['leaky', 'measurement abs-measure', 'measurement host-measure', 'measurement up-measure', 'question q1']);
  assert.deepEqual(sel.measurements.measured.find((m) => m.id === 'ok-measure'), { id: 'ok-measure', value: 3 });
  assert.equal(sel.measurements.measured.find((m) => m.id === 'abs-measure').withheld, true);
  assert.equal(sel.measurements.questions.find((q) => q.id === 'q2').basis, 'world truth');
  for (const leak of [abs, homeRel, up, '10.1.2.3']) assert.ok(!text.includes(leak), `selected.json holds ${leak}`);
  assert.ok(readFileSync(p.index, 'utf8').includes(abs), 'the private index keeps the full value');
});
