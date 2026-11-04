#!/usr/bin/env node
// Soul Runs entry point (#749). One owned lifecycle around an existing scenario; see README.md.
//   node tools/playtest/runs/run.mjs validate <spec.json> | --scenario <file> [--cast none] [--port n]
//   node tools/playtest/runs/run.mjs start    <spec.json> | --scenario <file> [--cast none] [--port n] [--duration s] [--name x] [--out dir] [--server-root dir] [--force-machine]
//   node tools/playtest/runs/run.mjs cleanup  <runDir> [--world-data] [--controller-state]
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
    const v = validateSpec(spec, { specPath });
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
  console.error('usage: run.mjs validate|start <spec.json> | --scenario <file> [--cast none] [--port n] [--duration s] [--out dir] | cleanup <runDir> [--world-data] [--controller-state]');
  return 2;
}
main().then((code) => process.exit(code), (e) => { log(e.stack ?? e.message); process.exit(1); });
