// Soul Runs lifecycle (SR1, #750): validate → preflight → owned run directory and ledger → execute an existing
// scenario through playtest.mjs cmdRun → release owned resources → retention → terminal run-receipt.json.
// The lifecycle owns cleanup and the receipt; the scenario runner keeps its own steps and semantics.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createLedger } from './ledger.mjs';
import { validateSpec, portFree } from './spec.mjs';
import { applySetup } from './setup.mjs';
import { writeJson, readJson } from '../lib/jsonl.mjs';
import { scratchDir } from '../../lib/paths.mjs';

export const RECEIPT = 'run-receipt.json';
const TIMEOUT = Symbol('timeout');
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(TIMEOUT), ms); })]).finally(() => clearTimeout(t)); };
const short = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 300);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const inside = (root, p) => { const r = relative(resolve(root), resolve(p)); return r && !r.startsWith('..') && !r.startsWith(sep) && r !== '..'; };

function sourceIdentity(serverRoot) {
  const git = (args) => { try { return execFileSync('git', args, { cwd: serverRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim(); } catch { return null; } };
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  return { commit: git(['rev-parse', 'HEAD']), dirtyTrackedFiles: status == null ? null : status.split('\n').filter(Boolean).length, node: process.version };
}

function bytesUnder(dir) {
  let n = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) n += statSync(p).size; } };
  try { walk(dir); } catch { return null; }
  return n;
}

/** Static checks plus capability checks that create nothing: server files, the world port, the scenario runner's own
 *  preflight (providers, quota, machine gate). Returns {ok, errors, checks}. */
export async function preflightRun({ validation, serverRoot, scenarioPreflight }) {
  const errors = [];
  const files = { server: 'apps/server/src/main.ts', webDist: 'apps/web/dist/index.html', controllerCli: 'tools/world-launcher/soul/eden.mjs' };
  const checks = { files: {} };
  for (const [k, f] of Object.entries(files)) { checks.files[k] = existsSync(join(serverRoot, f)); if (!checks.files[k]) errors.push({ code: `executable.${k}`, message: `${f} missing under the server root` }); }
  checks.portFree = await portFree(validation.effective.world.port);
  if (!checks.portFree) errors.push({ code: 'world.port-busy', message: `port ${validation.effective.world.port} is in use; choose another (a run never stops what holds it)` });
  if (scenarioPreflight) {
    try { checks.scenario = await scenarioPreflight({ serverRoot, scenario: validation.scenario }); }
    catch (e) { checks.scenario = { ok: false, error: short(e) }; }
    if (!checks.scenario.ok) {
      const c = checks.scenario.checks ?? {};
      const why = [...['serverRoot', 'webDist', 'controllerCli', 'playwright', 'providersOk'].filter((k) => c[k] === false || c[k] == null && k in c).map((k) => `${k} ${c.providerError ?? 'missing'}`),
        ...(c.machineOk === false ? [`machine gate: load ${c.laptopLoad?.[0]}, free ${c.freeGb} GB (needs load < 10 and 6 GB; --force-machine records a breach)`] : []),
        ...(checks.scenario.allow?.allowed === false ? [`quota: ${checks.scenario.allow.note}`] : []), ...(checks.scenario.error ? [checks.scenario.error] : [])];
      errors.push({ code: 'preflight.scenario', message: `scenario preflight refused: ${why.join('; ') || 'see checks.scenario'}` });
    }
  }
  return { ok: errors.length === 0, errors, checks };
}

/** Bounded observer qualification: import the stock observer and launch/close one headless browser. A failure is an
 *  attributed, unavailable capability (browser startup repair is #633), not a hidden success. */
export async function observerCheck({ serverRoot, timeoutMs, ledger, importer = () => import('../observer/browser.mjs') }) {
  const t0 = Date.now();
  const left = () => Math.max(1, timeoutMs - (Date.now() - t0));
  const out = (ok, stage, extra = {}) => ({ ok, stage, ms: Date.now() - t0, ...(ok ? {} : { owner: '#633' }), ...extra });
  let mod;
  try { mod = await within(importer(), left()); } catch (e) { return out(false, 'import', { error: short(e) }); }
  if (mod === TIMEOUT) return out(false, 'import', { error: `import exceeded ${timeoutMs} ms` });
  const launching = mod.openBrowser({ headless: true, serverRoot });
  let browser;
  try { browser = await within(launching, left()); } catch (e) { return out(false, 'launch', { error: short(e) }); }
  if (browser === TIMEOUT) { launching.then((b) => b.close()).catch(() => {}); return out(false, 'launch', { error: `launch exceeded ${timeoutMs} ms` }); }
  const entry = ledger.own('browser', 'observer-check', () => browser.close(), { gpu: browser.gpu ?? null, playwright: browser.playwright ?? null });
  await entry.release(); entry.state = 'released'; entry.releaseMs = 0;
  return out(true, 'launch', { gpu: browser.gpu ?? null, playwright: browser.playwright ?? null });
}

/** The SR1 adapter: one existing scenario through playtest.mjs cmdRun, with the lifecycle's hooks. */
export async function executeScenario({ scenarioFile, playtestDir, serverRoot, hooks }) {
  const { cmdRun } = await import('../playtest.mjs');
  return cmdRun({ _: ['run', scenarioFile], out: playtestDir, 'server-root': serverRoot }, hooks);
}

/** The directed-cast adapter (#783): one cast through director/swarm/run.mjs cmdDirect, headless, with the lifecycle's
 *  hooks. Live minds stay refused inside cmdDirect too unless the spec allowed them. A session that ran to its end is
 *  completed whatever its verdict (exit 4); the verdict is evidence, read by evaluate. */
export async function executeCast({ castFile, playtestDir, serverRoot, hooks, allowLiveModels = false }) {
  const { cmdDirect } = await import('../director/swarm/run.mjs');
  const code = await cmdDirect({ _: ['direct', castFile], out: playtestDir, 'server-root': serverRoot, headless: true }, { ...hooks, allowLiveModels });
  return code === 4 ? 0 : code;
}

/** startRun → terminal receipt. status: refused (nothing created) | completed | failed | cancelled | stopped-limit.
 *  signal: an AbortSignal the caller aborts on SIGINT/SIGTERM. execute/scenarioPreflight/importer are injectable. */
export async function startRun({ spec, specPath = null, specSha256 = null, serverRoot, outDir = null, signal = null, log = () => {},
  execute = null, scenarioPreflight = null, observerImporter, loadModules = null, setupFn = applySetup }) {
  const validation = validateSpec(spec, { specPath, serverRoot });
  if (!validation.ok) return { status: 'refused', stage: 'validate', errors: validation.errors };
  const pre = await preflightRun({ validation, serverRoot, scenarioPreflight });
  if (!pre.ok) return { status: 'refused', stage: 'preflight', errors: pre.errors, checks: pre.checks };
  const eff = validation.effective;

  // Resources begin here: the run directory, its ledger and the terminal receipt.
  const runDir = resolve(outDir ?? scratchDir(join('soul-runs', `${stamp()}-${eff.name}`)));
  if (existsSync(join(runDir, RECEIPT))) return { status: 'refused', stage: 'validate', errors: [{ code: 'run.exists', message: `a run already exists at ${runDir}` }] };
  mkdirSync(runDir, { recursive: true });
  const playtestDir = join(runDir, 'playtest');
  const ledger = createLedger({ file: join(runDir, 'ledger.jsonl') });
  ledger.borrow('checkout', 'server-root', { path: serverRoot, use: 'read-only source and web build' });
  ledger.borrow('port-range', 'host', { note: 'other services on this host are never stopped' });
  const t0 = Date.now(), usage0 = process.resourceUsage();
  const receipt = {
    soulRun: 1, runId: runDir.split(sep).pop(), status: 'running', startedAt: new Date(t0).toISOString(),
    spec: { path: specPath, sha256: specSha256, effective: eff }, source: sourceIdentity(serverRoot), controllers: validation.controllers,
    preflight: pre.checks, references: { runDir, playtestDir, ledger: join(runDir, 'ledger.jsonl') },
  };
  const save = () => writeJson(join(runDir, RECEIPT), receipt);
  save(); // a crash from here on leaves status "running", never a false success
  const directed = !!validation.cast;
  const scenarioFile = join(runDir, directed ? 'cast.effective.json' : 'scenario.effective.json');
  writeJson(scenarioFile, directed ? validation.cast : validation.scenario);
  if (directed) Object.assign(receipt.references, { cast: scenarioFile, journal: join(playtestDir, 'director', 'commands.jsonl') });
  const run = execute ?? (directed ? (o) => executeCast({ ...o, castFile: o.scenarioFile, allowLiveModels: eff.controllers.allowLiveModels === true }) : executeScenario);
  writeJson(join(runDir, 'spec.effective.json'), eff);

  let stop = null;
  const stopped = new Promise((r) => { stop = r; });
  const abort = new AbortController();
  const onAbort = () => { abort.abort(signal.reason ?? 'cancelled'); stop({ status: 'cancelled', reason: String(signal.reason ?? 'cancelled') }); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const wall = setTimeout(() => { abort.abort('limits.maxWallSec'); stop({ status: 'stopped-limit', reason: `limits.maxWallSec ${eff.limits.maxWallSec} s reached` }); }, eff.limits.maxWallSec * 1000);

  let outcome, execMs = null;
  try {
    let modules;
    if (eff.observer.check) {
      receipt.observer = await observerCheck({ serverRoot, timeoutMs: eff.observer.timeoutMs, ledger, importer: observerImporter });
      log(`observer check: ${receipt.observer.ok ? 'ok' : `unavailable at ${receipt.observer.stage}: ${receipt.observer.error}`}`);
      if (!receipt.observer.ok && eff.observer.required) throw Object.assign(new Error(`observer required but unavailable (${receipt.observer.stage}: ${receipt.observer.error}); see #633`), { stage: 'observer-check' });
      if (!receipt.observer.ok) {
        // Play without cameras rather than fail later inside the runner; the receipt says so.
        modules = await (loadModules ?? (await import('../playtest.mjs')).loadModules)();
        modules.browser = null;
        receipt.observer.effect = 'cameras disabled for this run';
      }
    } else receipt.observer = { ok: null, skipped: 'observer.check false' };
    save();
    // The scenario preflight already ran in preflightRun; hand its result over so cmdRun does not repeat it (a second
    // machine-gate roll could otherwise refuse inside the runner and read as failed rather than refused).
    const hooks = { own: ledger.own, signal: abort.signal, ...(pre.checks.scenario ? { preflight: pre.checks.scenario } : {}), ...(modules ? { modules } : {}),
      ...(validation.setup ? { afterProvision: async ({ world }) => {
        receipt.setup = await setupFn({ base: world.base, setup: validation.setup });
        writeJson(join(runDir, 'setup.json'), receipt.setup); save();
        log(`setup: ${receipt.setup.ok ? `${receipt.setup.batches.length} batch(es) applied` : `refused: ${receipt.setup.error}`}`);
        if (!receipt.setup.ok) throw Object.assign(new Error(receipt.setup.error), { stage: 'setup' });
      } } : {}) };
    const e0 = Date.now();
    const executing = Promise.resolve().then(() => run({ scenarioFile, playtestDir, serverRoot, hooks, runDir }))
      .then((code) => ({ status: code === 0 ? 'completed' : 'failed', exit: code, ...(code === 0 ? {} : { reason: `scenario runner exited ${code}` }) }),
        (e) => ({ status: 'failed', reason: short(e), stage: e?.code === 'RUN_CANCELLED' ? 'cancelled-step' : 'execute' }));
    outcome = await Promise.race([executing, stopped]);
    execMs = Date.now() - e0;
  } catch (e) { outcome = { status: 'failed', reason: short(e), stage: e?.stage ?? 'startup' }; }
  finally { clearTimeout(wall); signal?.removeEventListener?.('abort', onAbort); }
  if (receipt.setup && !receipt.setup.ok && outcome.status === 'failed') outcome = { ...outcome, stage: 'setup', reason: `setup refused: ${receipt.setup.error}` };
  if (abort.signal.aborted && outcome.status !== 'cancelled' && outcome.status !== 'stopped-limit') outcome = { ...outcome, status: abort.signal.reason === 'limits.maxWallSec' ? 'stopped-limit' : 'cancelled' };
  if (!abort.signal.aborted) abort.abort('run finished'); // runner steps still pending see a stop, not a fresh start

  log(`run ${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ''}; releasing owned resources`);
  const cleanup = await ledger.releaseAll({ waitMs: eff.limits.cleanupWaitMs });
  receipt.retention = applyRetention({ runDir, ledger, retention: eff.retention, completed: outcome.status === 'completed' && cleanup.ok });
  const usage1 = process.resourceUsage(), endedAt = Date.now();
  Object.assign(receipt, outcome, {
    endedAt: new Date(endedAt).toISOString(), resources: cleanup,
    cost: { wallMs: endedAt - t0, executeMs: execMs, lifecycleOverheadMs: execMs == null ? null : endedAt - t0 - execMs, runnerCpuUserMs: Math.round((usage1.userCPUTime - usage0.userCPUTime) / 1000), runnerCpuSystemMs: Math.round((usage1.systemCPUTime - usage0.systemCPUTime) / 1000), runnerMaxRssMb: Math.round(usage1.maxRSS / 1024), runDirBytes: bytesUnder(runDir) },
    evidence: summarizeEvidence(playtestDir),
  });
  if (!cleanup.ok && receipt.status === 'completed') { receipt.status = 'failed'; receipt.reason = `cleanup incomplete: ${cleanup.failed.join(', ')}`; }
  save();
  return receipt;
}

function summarizeEvidence(playtestDir) {
  const receipts = existsSync(join(playtestDir, 'receipts')) ? readdirSync(join(playtestDir, 'receipts')).sort() : [];
  const world = readJson(join(playtestDir, 'world.json'), null);
  const verdict = readJson(join(playtestDir, 'director', 'verdict.json'), null);
  return { receipts, ...(verdict ? { verdict: { pass: verdict.pass ?? null, checks: Object.fromEntries(Object.entries(verdict.checks ?? {}).map(([k, v]) => [k, v?.pass ?? null])) } } : {}), report: existsSync(join(playtestDir, 'REPORT.md')) ? join(playtestDir, 'REPORT.md') : null, build: world?.build ?? null, skill: world?.skill?.version ?? null, cli: world?.cli?.['eden.mjs.version'] ?? null, tickValidity: readJson(join(playtestDir, 'server', 'tick-validity.json'), null), infrastructureInvalid: existsSync(join(playtestDir, 'infrastructure-invalid.jsonl')) };
}

/** Evidence is always kept. World data and controller state (sensitive: owner identities and controller credentials)
 *  are deleted only after a completed run whose spec says delete; otherwise they are listed for explicit cleanup. */
function applyRetention({ runDir, ledger, retention, completed }) {
  const paths = (kind, key) => ledger.entries.filter((e) => e.owner === 'run' && e.kind === kind && e.meta?.[key]).map((e) => e.meta[key]).filter((p) => inside(runDir, p));
  const plan = { evidence: { kept: true, path: runDir }, worldData: { paths: paths('world', 'dataDir'), sensitive: false }, controllerState: { paths: paths('controller', 'dir'), sensitive: true, publish: false } };
  for (const key of ['worldData', 'controllerState']) {
    const want = retention[key];
    if (want === 'delete' && completed) { for (const p of plan[key].paths) rmSync(p, { recursive: true, force: true }); plan[key].action = 'deleted'; }
    else plan[key].action = want === 'delete' ? 'kept: run did not complete (evidence survives failure); use cleanup' : 'kept by retention; use cleanup';
  }
  return plan;
}

/** Explicit owned-state cleanup for a finished run: deletes only paths its receipt lists, inside its run directory. */
export function cleanupRun(runDir, { worldData = false, controllerState = false, alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  const file = join(resolve(runDir), RECEIPT);
  const receipt = readJson(file, null);
  if (!receipt) return { ok: false, error: `no ${RECEIPT} in ${runDir}` };
  if (receipt.status === 'running') return { ok: false, error: 'run has no terminal receipt (status running); stop it first' };
  const live = (receipt.resources?.entries ?? []).filter((e) => e.owner === 'run' && e.kind === 'world' && e.meta?.pid && alive(e.meta.pid));
  if (live.length) return { ok: false, error: `owned world process still alive: ${live.map((e) => e.meta.pid).join(', ')}` };
  const done = [];
  for (const [key, want] of [['worldData', worldData], ['controllerState', controllerState]]) {
    if (!want) continue;
    for (const p of receipt.retention?.[key]?.paths ?? []) { if (!inside(runDir, p)) continue; rmSync(p, { recursive: true, force: true }); done.push(p); }
    if (receipt.retention?.[key]) receipt.retention[key].action = `deleted by cleanup ${new Date().toISOString()}`;
  }
  writeFileSync(file, JSON.stringify(receipt, null, 1) + '\n');
  return { ok: true, deleted: done };
}
