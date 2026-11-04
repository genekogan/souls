// Custom-journey lifecycle enforcement. Operational records are private; none of this output is publishable by default.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startWorld } from '../god-skill/dev-world.mjs';
import { checkPort, portFree } from '../../e2e/local-smoke.mjs';
import { config } from '../../e2e/config.mjs';
import { launchArgs } from '../playtest/lib/platform.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROCESS_USED = Symbol.for('souls.owned-proof-attempt.production-used');
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const writeNew = (file, value) => writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requireThat = (ok, why) => { if (!ok) throw new Error(`proof.${why}`); };
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const loadedToolHead = git(TOOL_ROOT, 'rev-parse', 'HEAD');
const loadedFiles = ['tools/proof/owned-attempt.mjs', 'tools/god-skill/dev-world.mjs', 'e2e/config.mjs', 'e2e/local-smoke.mjs', 'tools/playtest/lib/platform.mjs'].map(path => ({ path, hash: digest(readFileSync(join(TOOL_ROOT, path))) }));
const source = root => { requireThat(!git(root, 'status', '--porcelain'), 'source-dirty'); return { root: resolve(root), head: git(root, 'rev-parse', 'HEAD') }; };
const within = (root, path) => { const p = relative(root, resolve(path)); return p && p !== '..' && !p.startsWith('../') && !isAbsolute(p); };
const sameSource = (a, b) => !!a && !!b && JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && Object.keys(a).every(k => a[k].head === b[k].head && a[k].root === b[k].root);
async function bounded(work, signal, ms, phase, onTimeout) {
  let timer, abort;
  try {
    const stopped = new Promise((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('proof.interrupted'));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { const error = new Error(`proof.${phase}-timeout`); onTimeout?.(error); reject(error); }, ms);
    });
    return await Promise.race([Promise.resolve().then(work), stopped]);
  } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}

function changed(fix, snapshots, inspectChange) {
  requireThat(fix?.scope?.trim() && fix.paths?.length && fix.from && fix.to && fix.from !== fix.to, 'material-change-required');
  const found = Object.values(snapshots).find(s => s.head === fix.to && s.root === resolve(fix.root));
  requireThat(found, 'change-source-mismatch');
  const actual = inspectChange(found.root, fix.from, fix.to);
  requireThat(actual.some(Boolean) && fix.paths.every(p => p?.trim() && !isAbsolute(p) && !p.startsWith('../') && actual.includes(p)), 'change-paths-mismatch');
}
function reviewThird(review, attempts, owner, current, repair, now, lineChanged) {
  const previous = attempts.slice(-2);
  requireThat(review?.evidenceOnly === true && review.reviewer && review.reviewer !== owner, 'independent-review-required');
  requireThat(review.decision === 'TRY', 'review-escalate-or-missing');
  requireThat(Date.parse(review.at) > Date.parse(previous.at(-1).endedAt) && Date.parse(review.at) <= now + 1000, 'review-stale');
  requireThat(JSON.stringify(review.evidence) === JSON.stringify(previous.map(a => a.reportHash)), 'review-evidence-mismatch');
  requireThat(sameSource(review.source, current), 'review-source-mismatch');
  requireThat(review.hypothesis?.trim() && previous.every(a => review.hypothesis !== a.hypothesis), 'different-hypothesis-required');
  requireThat(review.change?.path && Number.isSafeInteger(review.change.line) && review.change.line > 0 && repair.paths.includes(review.change.path), 'review-file-line-required');
  const path = resolve(repair.root, review.change.path);
  requireThat(within(repair.root, path) && readFileSync(path, 'utf8').split('\n').length >= review.change.line, 'review-file-line-invalid');
  requireThat(lineChanged(repair.root, repair.from, repair.to, review.change.path, review.change.line), 'review-line-not-changed');
}
function verifyRecords(state) {
  for (const attempt of state.attempts) {
    requireThat(digest(readFileSync(attempt.report)) === attempt.reportHash, 'attempt-record-changed');
    const report = json(attempt.report);
    for (const e of report.evidence) requireThat(digest(readFileSync(e.file)) === e.hash, 'evidence-changed');
  }
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const wait = ms => new Promise((resolve, reject) => {
    const finish = value => { clearTimeout(timer); child.removeListener('exit', exit); child.removeListener('error', error); resolve(value); };
    const exit = () => finish(true), error = e => { finish(false); reject(e); }, timer = setTimeout(() => finish(false), ms);
    child.once('exit', exit); child.once('error', error);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
  child.kill('SIGTERM');
  if (!await wait(5000)) {
    child.kill('SIGKILL');
    requireThat(await wait(2000), 'owned-child-did-not-exit');
  }
}
async function openBrowser(o, paths, base) {
  requireThat(o.browserCache && existsSync(o.browserCache), 'explicit-browser-cache-required');
  requireThat(o.browserExecutable && within(resolve(o.browserCache), resolve(o.browserExecutable)) && existsSync(o.browserExecutable), 'explicit-browser-executable-required');
  // Resolve only the explicitly selected checkout dependency; never inspect default package/browser stores.
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(o.browserCache);
  const pw = createRequire(join(o.playwrightRoot ?? o.sourceRoot, 'mars/viewer/package.json'))('@playwright/test');
  const context = await pw.chromium.launchPersistentContext(paths.profile, { executablePath: o.browserExecutable,
    // The owner controller must finish evidence/ledger/world cleanup; Playwright's default SIGINT handler exits early.
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    timeout: o.phaseTimeoutMs ?? 30000,
    headless: o.headless ?? true, args: launchArgs({ gpu: o.gpu ?? 'metal' }).args,
    viewport: o.viewport ?? { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    recordVideo: { dir: paths.video, size: o.viewport ?? { width: 1920, height: 1080 } },
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve(o.browserCache) } });
  const page = context.pages()[0] ?? await context.newPage();
  return { page, close: () => context.close(), base };
}

const production = { source, changed: (root, from, to) => git(root, 'diff', '--name-only', from, to).split('\n'),
  lineChanged: (root, from, to, path, line) => [...git(root, 'diff', '--unified=0', from, to, '--', path).matchAll(/^@@ .*\+(\d+)(?:,(\d+))? @@/gm)].some(m => line >= Number(m[1]) && line < Number(m[1]) + Number(m[2] ?? 1)),
  boot: startWorld, browser: openBrowser, stop: stopChild, portFree, now: () => Date.now(), test: false };

/** Exactly one invocation = one fresh owned lifecycle. A failed slot cannot be replaced by another sample id.
 * cycle.plan is fixed in advance, e.g. baseline1,baseline2,candidate1,candidate2. Each slot's repair loop is capped3.
 * A material corrective cycle must be explicit; changing HEAD never starts one. No URL parameter is accepted. */
export const runOwnedAttempt = options => run(options, production);

/** Injection is deliberately unqualified; test reports can never be presented as browser proof. */
export const createTestRunner = overrides => options => run(options, { ...production, lineChanged: () => true, ...overrides, test: true });

async function run(o, d) {
  requireThat(o.owner?.trim() && o.cycle?.id && o.cycle.plan?.length && o.ledger, 'plan-and-agent-identity-required');
  requireThat(!('url' in o) && !('runDir' in o) && !('dataDir' in o) && !('profileDir' in o), 'existing-resource-override');
  for (const [value, max] of [[o.phaseTimeoutMs ?? 30000, 30000], [o.cleanupTimeoutMs ?? 8000, 8000], [o.journeyTimeoutMs ?? 90000, 90000], [o.navigationTimeoutMs ?? 30000, 30000], [o.world?.timeoutMs ?? 180000, 180000]]) requireThat(Number.isSafeInteger(value) && value > 0 && value <= max, 'timeout-out-of-bounds');
  if (!d.test) requireThat(!o.journey && o.driver?.root && o.driver?.path, 'committed-driver-required');
  const ledger = resolve(o.ledger), toolRoot = resolve(o.toolRoot ?? TOOL_ROOT), lock = ledger + '.lock';
  if (!d.test) requireThat(toolRoot === TOOL_ROOT, 'tool-checkout-mismatch');
  requireThat(within(toolRoot, ledger), 'ledger-outside-tool-checkout');
  if (!d.test) requireThat(git(toolRoot, 'check-ignore', ledger), 'ledger-must-be-ignored');
  mkdirSync(dirname(ledger), { recursive: true });
  mkdirSync(lock); // exclusive; stale ownership is never stolen automatically
  writeNew(join(lock, 'owner.json'), { owner: o.owner, at: new Date(d.now()).toISOString() });
  let state, report, paths, browser, child, childError, worldDeath, observationStop, closing = false, cleanupFailed = false, finalized = false, timedOut = false;
  const controller = new AbortController(), onAbort = () => controller.abort(o.signal?.reason ?? new Error('proof.interrupted'));
  const timeout = error => { timedOut = true; controller.abort(error); };
  const onSignal = () => controller.abort(new Error('proof.interrupted'));
  o.signal?.addEventListener('abort', onAbort, { once: true }); if (o.signal?.aborted) onAbort();
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); process.on('SIGHUP', onSignal);
  const save = () => { const tmp = ledger + '.' + randomUUID(); writeNew(tmp, state); renameSync(tmp, ledger); };
  try {
    const current = { product: d.source(o.sourceRoot), tool: d.source(toolRoot) };
    let driver = { default: o.journey };
    if (!d.test) {
      requireThat(current.tool.head === loadedToolHead && loadedFiles.every(f => digest(execFileSync('git', ['-C', toolRoot, 'show', `${loadedToolHead}:${f.path}`])) === f.hash), 'loaded-tool-source-mismatch');
      requireThat(!globalThis[PROCESS_USED], 'fresh-node-process-required');
      globalThis[PROCESS_USED] = true;
    }
    if (o.driver) {
      current.driver = d.source(o.driver.root);
      const file = resolve(o.driver.root, o.driver.path);
      requireThat(within(o.driver.root, file) && !isAbsolute(o.driver.path) && git(o.driver.root, 'ls-files', '--error-unmatch', '--', o.driver.path), 'driver-not-tracked');
      driver = await bounded(() => import(pathToFileURL(file).href + '?source=' + current.driver.head), controller.signal, o.phaseTimeoutMs ?? 30000, 'driver-import', timeout);
      requireThat(typeof driver.default === 'function', 'driver-function-required');
    }
    state = existsSync(ledger) ? json(ledger) : { version: 1, owner: o.owner, historicalCaptures: o.history?.count ?? 0, historicalEvidence: o.history?.evidence ?? [], captures: 0, attempts: [], cycles: [] };
    requireThat(state.owner === o.owner, 'owner-mismatch');
    requireThat(Number.isSafeInteger(state.historicalCaptures) && state.historicalCaptures >= 0, 'historical-count-invalid');
    if (!d.test && state.historicalCaptures) requireThat(state.historicalEvidence.length, 'historical-evidence-required');
    for (const e of state.historicalEvidence) requireThat(digest(readFileSync(e.file)) === e.hash, 'historical-evidence-changed');
    verifyRecords(state);
    let cycle = state.cycles.at(-1);
    requireThat(!cycle?.inFlight, 'unfinished-attempt');
    requireThat(digest({ count: state.historicalCaptures, evidence: state.historicalEvidence }) === digest(o.history ?? { count: 0, evidence: [] }), 'historical-record-changed');
    if (cycle?.id !== o.cycle.id) {
      changed(o.cycle.fix, current, d.changed);
      if (cycle) requireThat([...Object.values(cycle.armSources), cycle.toolSource, cycle.driverSource].filter(Boolean).some(s => s.root === resolve(o.cycle.fix.root) && s.head === o.cycle.fix.from), 'cycle-change-from-mismatch');
      requireThat(!state.cycles.some(c => c.id === o.cycle.id), 'cycle-id-reused');
      requireThat(new Set(o.cycle.plan.map(s => `${s.arm}:${s.repeat}`)).size === o.cycle.plan.length, 'duplicate-measurement-slot');
      requireThat(o.cycle.plan.every(s => o.cycle.arms?.[s.arm]?.head && isAbsolute(o.cycle.arms[s.arm].root) && Number.isSafeInteger(s.repeat) && s.repeat > 0), 'planned-source-required');
      cycle = { ...structuredClone(o.cycle), cursor: 0, chain: 0, armSources: structuredClone(o.cycle.arms), toolSource: current.tool,
        ...(o.driver ? { driverSource: current.driver, driverPath: o.driver.path } : {}) }; state.cycles.push(cycle);
    } else requireThat(digest(cycle.plan) === digest(o.cycle.plan) && digest(cycle.arms) === digest(o.cycle.arms) && digest(cycle.fix) === digest(o.cycle.fix), 'cycle-plan-changed');
    requireThat(cycle.cursor < cycle.plan.length, 'passing-scenario-rerun');
    requireThat(!cycle.stopped && cycle.chain < config.iterationCap, 'repair-ceiling');
    const slot = cycle.plan[cycle.cursor];
    requireThat(slot.arm === o.arm && slot.repeat === o.repeat, 'failed-slot-cannot-be-skipped');
    if (cycle.driverPath) requireThat(o.driver?.path === cycle.driverPath, 'driver-path-changed');
    const planned = { product: cycle.armSources[slot.arm], tool: cycle.toolSource, ...(cycle.driverSource ? { driver: cycle.driverSource } : {}) };
    requireThat(planned.product.root === current.product.root, 'planned-source-mismatch');
    const chain = state.attempts.filter(a => a.cycle === cycle.id && a.slot === cycle.cursor);
    if (chain.length || !sameSource(planned, current)) {
      requireThat(o.repair, 'planned-source-mismatch-or-material-change-required');
      changed(o.repair, current, d.changed);
      if (chain.length) requireThat(!sameSource(chain.at(-1).source, current), 'unchanged-retry');
      requireThat(Object.values(planned).some(s => s.root === resolve(o.repair.root) && s.head === o.repair.from), 'repair-from-mismatch');
    }
    if (cycle.chain === 2) reviewThird(o.review, chain, o.owner, current, o.repair, d.now(), d.lineChanged);
    checkPort(o.world.port);
    requireThat(await d.portFree(o.world.port), 'occupied-resource');
    controller.signal.throwIfAborted();
    const runParent = join(dirname(ledger), 'runs'); mkdirSync(runParent, { recursive: true });
    const dir = mkdtempSync(join(runParent, 'attempt-'));
    paths = { dir, data: join(dir, 'data'), profile: join(dir, 'profile'), video: join(dir, 'video'), log: join(dir, 'world.log') };
    for (const name of ['data', 'profile', 'video']) mkdirSync(paths[name]);
    cycle.chain++;
    report = { version: 1, qualified: false, injected: d.test, owner: o.owner, cycle: cycle.id, slot: cycle.cursor,
      arm: slot.arm, repeat: slot.repeat, repairAttempt: cycle.chain, cumulativeRun: state.attempts.length + 1,
      startedAt: new Date(d.now()).toISOString(), source: current, hypothesis: o.review?.hypothesis ?? o.repair?.hypothesis ?? 'predeclared measurement',
      paths, driver: o.driver ?? null, browserStarted: false, status: 'BOOT_ABORT', assertions: [], console: [], evidence: [], teardown: {}, review: o.review ?? null };
    cycle.inFlight = paths.dir; save(); // a crash remains an explicit unfinished ownership record
    requireThat(!state.attempts.some(a => a.runDir === paths.dir), 'reused-run-directory');
    const world = await d.boot({ ...o.world, checkout: current.product.root, data: paths.data, fresh: false, log: paths.log,
      signal: controller.signal, onSpawn(c) { requireThat(!child, 'multiple-world-children'); child = c;
        const died = e => { if (!closing) { worldDeath = e; controller.abort(e); } };
        c.once('error', e => { childError = e; died(e); }); c.once('exit', () => died(new Error('proof.owned-world-exited'))); } });
    requireThat(child && world.child === child && child.exitCode === null && child.signalCode === null && !childError, 'boot-not-owned');
    requireThat(resolve(world.dataDir) === paths.data && new URL(world.base).port === String(o.world.port), 'boot-resource-mismatch');
    controller.signal.throwIfAborted();
    const fixture = await bounded(() => driver.prepare?.({ base: world.base, paths, signal: controller.signal, arm: slot.arm, repeat: slot.repeat }), controller.signal, o.phaseTimeoutMs ?? 30000, 'prepare', timeout);
    let launchSettled = false, lateBrowser;
    const opening = Promise.resolve().then(() => d.browser(o, paths, world.base));
    opening.then(value => { launchSettled = true; lateBrowser = value; }, () => { launchSettled = true; });
    try { browser = await bounded(() => opening, controller.signal, (o.phaseTimeoutMs ?? 30000) + 1000, 'browser-open', timeout); }
    catch (error) {
      if (lateBrowser) browser = lateBrowser;
      else if (!launchSettled) {
        cleanupFailed = true; report.teardown.browserOpenPending = true;
        // A late context is still ours. Preserve its separate cleanup result; never rewrite the failed report.
        void opening.then(async context => {
          const result = { browserOpenedAfterAbort: true, closed: false };
          try { await bounded(() => context.close(), null, o.cleanupTimeoutMs ?? 8000, 'late-browser-close'); result.closed = true; }
          catch (e) { result.error = String(e); }
          writeNew(join(paths.dir, 'late-browser-cleanup.json'), result);
        }, error => writeNew(join(paths.dir, 'late-browser-cleanup.json'), { browserOpenedAfterAbort: false, error: String(error) })).catch(() => {});
      }
      throw error;
    }
    report.browserStarted = true; state.captures++; report.captureOrdinal = state.historicalCaptures + state.captures;
    const page = browser.page;
    page.on('console', m => report.console.push({ kind: m.type(), text: m.text() }));
    page.on('pageerror', e => report.console.push({ kind: 'pageerror', text: String(e) }));
    observationStop = await bounded(() => driver.beforeNavigation?.({ page, base: world.base, paths, signal: controller.signal }), controller.signal, o.phaseTimeoutMs ?? 30000, 'before-navigation', timeout);
    await bounded(() => page.goto(world.base + '?dev=1', { waitUntil: 'domcontentloaded', timeout: o.navigationTimeoutMs ?? 30000 }), controller.signal, o.navigationTimeoutMs ?? 30000, 'navigation', timeout);
    await bounded(() => driver.default({ page, base: world.base, paths, signal: controller.signal, fixture, arm: slot.arm, repeat: slot.repeat,
      check(key, ok, detail = '') { report.assertions.push({ key, ok: !!ok, detail }); if (!ok) throw Object.assign(new Error(detail || key), { assertion: key }); } }), controller.signal, o.journeyTimeoutMs ?? 90000, 'journey', timeout);
    requireThat(report.assertions.length && report.assertions.every(a => a.ok), 'no-passing-assertions');
    requireThat(new URL(page.url()).origin === new URL(world.base).origin, 'journey-left-owned-origin');
    const endSource = { product: d.source(o.sourceRoot), tool: d.source(toolRoot), ...(o.driver ? { driver: d.source(o.driver.root) } : {}) };
    requireThat(sameSource(current, endSource), 'source-changed-during-attempt');
    requireThat(!worldDeath && child.exitCode === null && child.signalCode === null, 'owned-world-exited');
    report.status = 'PASS';
  } catch (error) {
    if (!report) throw error;
    report.status = report.browserStarted ? controller.signal.aborted && !worldDeath && !timedOut ? 'INTERRUPTED' : 'FAIL' : 'BOOT_ABORT';
    report.error = String(error?.stack ?? error); report.assertion = error?.assertion ?? error?.message ?? 'unknown';
  } finally {
    try {
    if (report) {
      const evidence = (name, value) => { const file = join(paths.dir, name); writeNew(file, value); report.evidence.push({ file, hash: digest(readFileSync(file)) }); };
      try {
        for (const [name, capture] of [[report.status === 'PASS' ? 'final.png' : 'failure.png', () => browser?.page.screenshot()], ['accessibility.yml', () => browser?.page.locator('body').ariaSnapshot()]]) {
          try { const value = await bounded(capture, null, o.cleanupTimeoutMs ?? 8000, 'evidence'); if (value) evidence(name, value); else { evidence(name + '.unavailable.txt', 'Browser observation unavailable at this boundary.\n'); if (report.browserStarted) report.status = 'EVIDENCE_FAIL'; } }
          catch (e) { evidence(name + '.unavailable.txt', String(e)); if (report.browserStarted) report.status = 'EVIDENCE_FAIL'; }
        }
        evidence('console.json', report.console);
        evidence('world-tail.log', existsSync(paths.log) ? readFileSync(paths.log, 'utf8').slice(-12000) : 'World did not write a log.\n');
        evidence('explanation.md', `${report.error ?? 'Predeclared journey passed.'}\n\n${o.explanation ?? 'See assertions and source-bound repair history.'}\n`);
      } catch (e) { report.evidenceError = String(e); report.status = 'EVIDENCE_FAIL'; }
      try { if (observationStop) await bounded(observationStop, null, o.cleanupTimeoutMs ?? 8000, 'observer-close'); } catch (e) { report.teardown.observerError = String(e); cleanupFailed = true; }
      try { if (browser) await bounded(() => browser.close(), null, o.cleanupTimeoutMs ?? 8000, 'browser-close'); report.teardown.browserClosed = !report.teardown.browserOpenPending; } catch (e) { report.teardown.browserError = String(e); cleanupFailed = true; }
      if (report.status === 'PASS' && child && (child.exitCode !== null || child.signalCode !== null)) worldDeath ??= new Error('proof.owned-world-exited');
      closing = true;
      try { await bounded(() => d.stop(child), null, o.cleanupTimeoutMs ?? 8000, 'world-stop'); report.teardown.worldStopped = true; } catch (e) { report.teardown.worldError = String(e); cleanupFailed = true; }
      if (cleanupFailed) report.status = 'CLEANUP_FAIL';
      else if (worldDeath) { report.status = report.browserStarted ? 'FAIL' : 'BOOT_ABORT'; report.error ??= String(worldDeath); }
      else if (controller.signal.aborted) { report.status = report.browserStarted ? timedOut ? 'FAIL' : 'INTERRUPTED' : 'BOOT_ABORT'; report.error ??= String(controller.signal.reason); }
      if (report.status === 'PASS') {
        try { requireThat(sameSource(report.source, { product: d.source(o.sourceRoot), tool: d.source(toolRoot), ...(o.driver ? { driver: d.source(o.driver.root) } : {}) }), 'source-changed-during-finalization'); }
        catch (e) { report.status = 'FAIL'; report.error = String(e); }
      }
      report.endedAt = new Date(d.now()).toISOString(); report.qualified = !d.test && report.status === 'PASS';
      const cycle = state.cycles.at(-1), chain = state.attempts.filter(a => a.cycle === cycle.id && a.slot === cycle.cursor);
      cycle.armSources[report.arm] = report.source.product; cycle.toolSource = report.source.tool; if (report.source.driver) cycle.driverSource = report.source.driver;
      if (report.status === 'PASS') { cycle.cursor++; cycle.chain = 0; }
      else if (chain.some(a => a.assertion === report.assertion && sameSource(a.source, report.source))) cycle.stopped = 'unchanged repeated assertion';
      const file = join(paths.dir, 'report.json'); writeNew(file, report);
      state.attempts.push({ cycle: report.cycle, slot: report.slot, runDir: paths.dir, source: report.source, status: report.status,
        assertion: report.assertion, hypothesis: report.hypothesis, endedAt: report.endedAt, report: file, reportHash: digest(readFileSync(file)) });
      delete cycle.inFlight; if (cleanupFailed) cycle.stopped = 'cleanup failed'; save(); finalized = true;
    }
    } finally {
    o.signal?.removeEventListener('abort', onAbort); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); process.removeListener('SIGHUP', onSignal);
    if (report && !finalized) cleanupFailed = true;
    if (!cleanupFailed) rmSync(lock, { recursive: true });
    }
  }
  return report;
}
