#!/usr/bin/env node
// Soul Runs entry point (#749). One owned lifecycle around an existing scenario; see README.md.
//   node tools/playtest/runs/run.mjs validate <spec.json> | --scenario <file> [--cast none] [--port n]
//   node tools/playtest/runs/run.mjs start    <spec.json> | --scenario <file> [--cast none] [--port n] [--duration s] [--name x] [--out dir] [--server-root dir] [--force-machine]
//   node tools/playtest/runs/run.mjs cleanup  <runDir> [--world-data] [--controller-state]
//   node tools/playtest/runs/run.mjs evaluate <runDir>… [--question q.mjs]…            (offline; new versioned evaluations/)
//   node tools/playtest/runs/run.mjs compare  <runDir|replay-set>… [--question q.mjs]… [--out dir] [--md]
//   node tools/playtest/runs/run.mjs correlate <runDir>                 (diagnostics: trace ↔ run records, offline)
//   node tools/playtest/runs/run.mjs inspect   <runDir> --seat <id>     (diagnostics: the local inspector, read-only)
//   node tools/playtest/runs/run.mjs preview   <runDir> --camera <c> --from <s> --to <s>   (offline: labelled excerpt, never full proof)
//   node tools/playtest/runs/run.mjs preview   <runDir> --camera <c> --auto [--seconds 20]   (start from the run's first act)
//   node tools/playtest/runs/run.mjs package   <runDir> [--select <camera|preview file>]…   (offline: local index + selected projection)
// Exit: 0 completed/valid, 1 failed, 2 refused, 130 cancelled, 124 stopped at limits.maxWallSec.
import { resolve } from 'node:path';
import { readSpec, adHocSpec, validateSpec } from './spec.mjs';
import { startRun, cleanupRun, preflightRun } from './lifecycle.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';

const EXIT = { completed: 0, failed: 1, refused: 2, cancelled: 130, 'stopped-limit': 124 };
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const has = (k) => argv.includes(`--${k}`);
const log = (...a) => console.error(`[soul-run ${new Date().toISOString().slice(11, 19)}]`, ...a);
const print = (x) => console.log(JSON.stringify(x, null, 1));

function load() {
  const file = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  if (file) {
    // Flags given with a spec file override it and are recorded: the effective spec, not the file, is what ran.
    const r = readSpec(file);
    const o = adHocSpec({ scenario: flag('scenario') ?? r.spec.scenario, name: flag('name'), cast: flag('cast'), port: flag('port'), durationSec: flag('duration') });
    const overrides = Object.fromEntries(Object.entries({ name: o.name, cast: o.cast, durationSec: o.durationSec, scenario: flag('scenario') }).filter(([, v]) => v != null));
    return { ...r, spec: { ...r.spec, ...overrides, ...(o.world ? { world: { ...(r.spec.world ?? {}), ...o.world } } : {}) }, overrides: Object.keys(overrides).concat(o.world ? ['world.port'] : []) };
  }
  if (!flag('scenario')) throw new Error('give a spec file or --scenario <file>');
  return { spec: adHocSpec({ scenario: flag('scenario'), name: flag('name'), cast: flag('cast'), port: flag('port'), durationSec: flag('duration') }), specPath: null, specSha256: null };
}

async function main() {
  const cmd = argv[0];
  const serverRoot = resolve(flag('server-root') ?? process.env.PLAYTEST_SERVER_ROOT ?? REPO_ROOT);
  if (cmd === 'validate') {
    const { spec, specPath } = load();
    const v = validateSpec(spec, { specPath, serverRoot });
    if (!v.ok) { print({ status: 'refused', stage: 'validate', errors: v.errors }); return 2; }
    // validate applies the same preflight as start (providers, quota, machine gate) and creates nothing.
    const { preflight } = await import('../playtest.mjs');
    const pre = await preflightRun({ validation: v, serverRoot, scenarioPreflight: preflight });
    print({ status: pre.ok ? 'valid' : 'refused', stage: 'preflight', effective: v.effective, controllers: v.controllers, providers: v.policy.required, errors: pre.errors, checks: pre.checks });
    return pre.ok ? 0 : 2;
  }
  if (cmd === 'start') {
    const { spec, specPath, specSha256 } = load();
    const ac = new AbortController();
    let signals = 0;
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (++signals > 1) { log('second signal: exiting without waiting for cleanup'); process.exit(130); } log(`${sig}: cancelling; releasing owned resources`); ac.abort(sig); });
    const { preflight } = await import('../playtest.mjs');
    const receipt = await startRun({ spec, specPath, specSha256, serverRoot, outDir: flag('out'), signal: ac.signal, log, scenarioPreflight: preflight });
    print(receipt.status === 'refused' ? receipt : { status: receipt.status, reason: receipt.reason ?? null, runDir: receipt.references.runDir, receipt: `${receipt.references.runDir}/run-receipt.json`, resources: { ok: receipt.resources.ok, failed: receipt.resources.failed }, observer: receipt.observer, cost: receipt.cost });
    return EXIT[receipt.status] ?? 1;
  }
  if (cmd === 'cleanup') {
    if (!argv[1]) throw new Error('cleanup <runDir>');
    const r = cleanupRun(resolve(argv[1]), { worldData: has('world-data'), controllerState: has('controller-state') });
    print(r); return r.ok ? 0 : 1;
  }
  if (cmd === 'evaluate' || cmd === 'compare') {
    // Offline: reads retained run folders only; starts no world, controller or model.
    const { evaluateRun, compareRunSet, renderIndex } = await import('./evaluate.mjs');
    const dirs = []; const questions = [];
    for (let i = 1; i < argv.length; i++) { if (argv[i] === '--question') questions.push(resolve(argv[++i])); else if (argv[i] === '--out') i++; else if (!argv[i].startsWith('--')) dirs.push(argv[i]); }
    if (!dirs.length) throw new Error(`${cmd} <runDir>${cmd === 'compare' ? ' <runDir>…' : ''} [--question file.mjs]…`);
    if (cmd === 'evaluate') {
      for (const d of dirs) { const { evaluation: e, dir } = await evaluateRun(d, { questions }); print({ run: e.run.runId, status: e.run.status, arm: e.run.arm, evaluation: dir, measured: e.measures.filter((m) => m.status === 'measured').length, unavailable: e.measures.filter((m) => m.status === 'unavailable').map((m) => m.id), questions: [...e.acceptance.predeclared, ...e.questions].map((q) => `${q.id}:${q.basis}:${q.verdict}`), conflicts: e.conflicts.length, sourcesUnchanged: e.sources.unchanged }); }
      return 0;
    }
    const ix = await compareRunSet(dirs, { questions });
    if (flag('out')) { const { writeFileSync, mkdirSync } = await import('node:fs'); const o = resolve(flag('out')); mkdirSync(o, { recursive: true }); writeFileSync(`${o}/run-index.json`, JSON.stringify(ix, null, 1) + '\n'); writeFileSync(`${o}/COMPARE.md`, renderIndex(ix)); print({ index: `${o}/run-index.json`, arms: ix.arms.length, attempts: ix.attempts.length }); }
    else process.stdout.write(has('md') ? renderIndex(ix) : JSON.stringify(ix, null, 1) + '\n');
    return 0;
  }
  if (cmd === 'preview') {
    // Offline: a separately labelled excerpt of one camera's recording under <run>/derived/previews; the source is untouched.
    const { previewRecording, autoStart } = await import('./recording.mjs');
    if (!argv[1] || !flag('camera') || (!has('auto') && (flag('from') == null || flag('to') == null))) throw new Error('preview <runDir> --camera <name> (--from <s> --to <s> | --auto [--seconds s])');
    // --auto (#888): the window starts at the run's first act (else its first delivered request), from run events.
    const a = has('auto') ? autoStart(argv[1], { camera: flag('camera'), seconds: flag('seconds') != null ? Number(flag('seconds')) : 20 }) : null;
    if (a && !a.ok) { print(a); return 1; }
    const r = await previewRecording(argv[1], { camera: flag('camera'), fromSec: a ? a.fromSec : Number(flag('from')), toSec: a ? a.toSec : Number(flag('to')), auto: a?.auto ?? null });
    print(r); return r.ok ? 0 : 1;
  }
  if (cmd === 'package') {
    // Offline: local index plus a selected projection under <run>/derived/package. Never uploads or posts.
    const { packageRun } = await import('./recording.mjs');
    if (!argv[1]) throw new Error('package <runDir> [--select <camera|preview file>]…');
    const select = []; for (let i = 2; i < argv.length; i++) if (argv[i] === '--select') select.push(argv[++i]);
    const r = packageRun(argv[1], { select });
    print(r); return r.ok ? 0 : 1;
  }
  if (cmd === 'correlate') {
    // Analysis of a finished run's traces against its own records; offline, reads only.
    if (!argv[1]) throw new Error('correlate <runDir>');
    const { correlateRun } = await import('./diagnostics.mjs');
    print(await correlateRun(resolve(argv[1]))); return 0;
  }
  if (cmd === 'inspect') {
    // The viewer is a separate choice: the existing local inspector (#624) over one seat's trace file. It reads the file
    // only; it does not start, stop or listen for any controller or world.
    if (!argv[1] || !flag('seat')) throw new Error('inspect <runDir> --seat <id> [--port n]');
    const { traceCapability, TRACE } = await import('./diagnostics.mjs');
    const { readJson } = await import('../lib/jsonl.mjs');
    const rd = resolve(argv[1]), rc = readJson(`${rd}/run-receipt.json`, null);
    const entry = rc?.diagnostics?.capture?.seats?.[flag('seat')];
    if (!entry) { print({ ok: false, error: `no trace for seat ${flag('seat')} in this run (diagnostics off or seat not traced)` }); return 2; }
    const cap = traceCapability();
    if (!cap.inspector) { print({ ok: false, error: cap.inspectorReason }); return 2; }
    const { startInspector } = await import(`${REPO_ROOT}/${TRACE.inspector}`);
    const h = await startInspector({ file: `${rd}/${entry.file}`, port: flag('port') ? Number(flag('port')) : 0 });
    log(`inspector for ${rc.runId}/${flag('seat')}: ${h.url ?? h}`); log('Ctrl-C stops the inspector; the run and its trace are unaffected');
    await new Promise((r) => process.on('SIGINT', r)); await h.close?.(); return 0;
  }
  console.error('usage: run.mjs validate|start <spec.json> | --scenario <file> [--cast none] [--port n] [--duration s] [--out dir] | cleanup <runDir> [--world-data] [--controller-state] | evaluate <runDir>… [--question q.mjs]… | compare <runDir|replay-set>… [--question q.mjs]… [--out dir] [--md] | correlate <runDir> | inspect <runDir> --seat <id> [--port n]');
  return 2;
}
main().then((code) => process.exit(code), (e) => { log(e.stack ?? e.message); process.exit(1); });
