import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { createTestRunner, runOwnedAttempt } from './owned-attempt.mjs';

const parent = resolve('.e2e/670'); mkdirSync(parent, { recursive: true });
function setup(t, overrides = {}) {
  const root = mkdtempSync(join(parent, 'lifecycle-')), product = join(root, 'product'); mkdirSync(product);
  writeFileSync(join(product, 'fix.ts'), 'export const repaired = true;\n');
  let head = 'p1', tool = 't1', clock = Date.now(); const children = [], browsers = [];
  const identity = r => ({ root: resolve(r), head: resolve(r) === product ? head : tool });
  const runner = createTestRunner({ source: identity, changed: () => ['fix.ts'], now: () => ++clock,
    portFree: async () => true,
    boot: async o => { const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }); children.push(child); o.onSpawn(child);
      writeFileSync(o.log, 'owned fake world\n'); return { child, base: `https://example.com:${o.port}/w/${o.slug}`, dataDir: o.data }; },
    browser: async (o, paths, base) => { let url = base; const b = { closed: false, base,
      page: { on() {}, goto: async v => { url = v; }, url: () => url, screenshot: async () => Buffer.from('PNG observation'), locator: () => ({ ariaSnapshot: async () => '- canvas' }) },
      close: async () => { b.closed = true; } }; browsers.push(b); return b; },
    stop: async c => { if (c) c.exitCode = 0; }, ...overrides });
  const o = { owner: '/test/implementer', toolRoot: root, sourceRoot: product, ledger: join(root, 'ledger.json'), arm: 'candidate', repeat: 1,
    cycle: { id: 'corrective-1', fix: { root: product, from: 'p0', to: 'p1', paths: ['fix.ts'], scope: 'repair fixture lifecycle' },
      arms: { candidate: { root: product, head: 'p1' } }, plan: [{ arm: 'candidate', repeat: 1 }] },
    world: { slug: 'proof-fixture', port: 19040 }, journey: async c => c.check('contact', true) };
  const change = (next, hypothesis = 'correct the contact fixture') => { const from = head; head = next; o.repair = { root: product, from, to: next, paths: ['fix.ts'], scope: 'relevant contact correction', hypothesis }; };
  const ledger = () => JSON.parse(readFileSync(o.ledger));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, product, runner, o, change, children, browsers, ledger, identity, now: () => ++clock };
}
test('fresh success owns directories and teardown; passing scenario cannot be rerun by a commit', async t => {
  const f = setup(t); const r = await f.runner(f.o);
  assert.equal(r.status, 'PASS'); assert.equal(r.qualified, false); assert.equal(r.injected, true);
  assert.equal(r.captureOrdinal, 1); assert.equal(f.children[0].exitCode, 0); assert.equal(f.browsers[0].closed, true);
  assert.notEqual(r.paths.data, r.paths.profile); assert.ok(existsSync(r.paths.data));
  f.change('p2'); await assert.rejects(f.runner(f.o), /passing-scenario-rerun/);
});
test('failed assertion preserves immutable observations, fresh retry, and pins the planned sample', async t => {
  const f = setup(t); f.o.cycle.plan.push({ arm: 'candidate', repeat: 2 });
  f.o.journey = async c => c.check('contact', false, 'no soil contact');
  const one = await f.runner(f.o), raw = readFileSync(join(one.paths.dir, 'report.json'));
  assert.equal(one.status, 'FAIL'); assert.ok(one.evidence.some(e => e.file.endsWith('failure.png')));
  for (const name of ['accessibility.yml', 'console.json', 'world-tail.log', 'explanation.md']) assert.ok(one.evidence.some(e => e.file.endsWith(name)));
  f.o.repeat = 2; await assert.rejects(f.runner(f.o), /failed-slot-cannot-be-skipped/); f.o.repeat = 1;
  await assert.rejects(f.runner(f.o), /material-change-required/);
  f.change('p2'); f.o.journey = async c => c.check('contact', true);
  const two = await f.runner(f.o); assert.equal(two.repairAttempt, 2); assert.notEqual(two.paths.dir, one.paths.dir);
  assert.deepEqual(readFileSync(join(one.paths.dir, 'report.json')), raw);
  writeFileSync(join(one.paths.dir, 'explanation.md'), 'tampered'); f.o.repeat = 2;
  await assert.rejects(f.runner(f.o), /evidence-changed/);
});
test('third attempt requires fresh independent evidence-bound review and is the last attempt', async t => {
  let changedLine = true; const f = setup(t, { lineChanged: () => changedLine }); f.o.journey = async c => c.check('contact', false);
  await f.runner(f.o); f.change('p2', 'adjust hand approach'); await f.runner(f.o); f.change('p3', 'repair target fixture');
  await assert.rejects(f.runner(f.o), /independent-review-required/);
  const attempts = f.ledger().attempts;
  f.o.review = { reviewer: f.o.owner, evidenceOnly: true, decision: 'TRY', at: new Date(f.now()).toISOString(), evidence: attempts.map(a => a.reportHash),
    source: { product: f.identity(f.product), tool: f.identity(f.root) }, hypothesis: 'different concrete frame hypothesis', change: { path: 'fix.ts', line: 1 } };
  await assert.rejects(f.runner(f.o), /independent-review-required/);
  f.o.review.reviewer = '/test/evidence-reviewer'; f.o.review.decision = 'ESCALATE';
  await assert.rejects(f.runner(f.o), /review-escalate/); f.o.review.decision = 'TRY';
  f.o.review.evidence = ['stale']; await assert.rejects(f.runner(f.o), /review-evidence-mismatch/); f.o.review.evidence = attempts.map(a => a.reportHash);
  f.o.review.source.product.head = 'stale'; await assert.rejects(f.runner(f.o), /review-source-mismatch/); f.o.review.source.product = f.identity(f.product);
  f.o.review.at = attempts[1].endedAt; await assert.rejects(f.runner(f.o), /review-stale/); f.o.review.at = new Date(f.now()).toISOString();
  const newHypothesis = f.o.review.hypothesis; f.o.review.hypothesis = attempts[0].hypothesis;
  await assert.rejects(f.runner(f.o), /different-hypothesis-required/); f.o.review.hypothesis = newHypothesis;
  changedLine = false; await assert.rejects(f.runner(f.o), /review-line-not-changed/); changedLine = true;
  const third = await f.runner(f.o); assert.equal(third.repairAttempt, 3); assert.equal(third.status, 'FAIL');
  f.change('p4'); await assert.rejects(f.runner(f.o), /repair-ceiling/);
});
test('two predeclared repeats per arm allow passes, but a failure cannot be sidestepped and counts all three tries', async t => {
  const f = setup(t); f.o.cycle.arms.baseline = { root: f.product, head: 'p1' };
  f.o.cycle.plan = [{ arm: 'baseline', repeat: 1 }, { arm: 'baseline', repeat: 2 }, { arm: 'candidate', repeat: 1 }, { arm: 'candidate', repeat: 2 }];
  f.o.arm = 'baseline'; const a = await f.runner(f.o); f.o.repeat = 2; const b = await f.runner(f.o);
  assert.equal(a.repairAttempt, 1); assert.equal(b.repairAttempt, 1);
  f.o.arm = 'candidate'; f.o.repeat = 1; f.o.journey = async c => c.check('contact', false); const c = await f.runner(f.o);
  f.o.repeat = 2; await assert.rejects(f.runner(f.o), /failed-slot-cannot-be-skipped/); f.o.repeat = 1;
  f.change('p2'); f.o.journey = async c => c.check('contact', true); const d = await f.runner(f.o);
  f.o.repeat = 2; const e = await f.runner(f.o);
  assert.deepEqual([a, b, c, d, e].map(r => r.captureOrdinal), [1, 2, 3, 4, 5]);
  assert.deepEqual([c, d, e].map(r => r.repairAttempt), [1, 2, 1]);
});
test('competing owner, occupied/reserved resources, existing paths and unowned healthy world are refused', async t => {
  const f = setup(t); mkdirSync(f.o.ledger + '.lock');
  await assert.rejects(f.runner(f.o), /EEXIST/); rmSync(f.o.ledger + '.lock', { recursive: true });
  await assert.rejects(f.runner({ ...f.o, url: 'https://example.com' }), /existing-resource-override/);
  await assert.rejects(f.runner({ ...f.o, dataDir: f.root }), /existing-resource-override/);
  f.o.world.port = 7830; await assert.rejects(f.runner(f.o), /reserved/);
  const g = setup(t, { portFree: async () => false }); await assert.rejects(g.runner(g.o), /occupied-resource/);
  const h = setup(t, { boot: async () => ({ child: {}, base: 'https://example.com', dataDir: 'old' }) });
  const r = await h.runner(h.o); assert.equal(r.status, 'BOOT_ABORT'); assert.match(r.error, /boot-not-owned/); assert.equal(r.qualified, false);
});
test('boot errors, interruption and cleanup failure stay visible and never qualify', async t => {
  const f = setup(t, { boot: async o => { const c = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }); o.onSpawn(c); throw Error('boot failed'); } });
  const boot = await f.runner(f.o); assert.equal(boot.status, 'BOOT_ABORT'); assert.equal(boot.browserStarted, false); assert.equal(boot.teardown.worldStopped, true);
  const g = setup(t, { stop: async () => { throw Error('owned teardown failed'); } }); const cleanup = await g.runner(g.o);
  assert.equal(cleanup.status, 'CLEANUP_FAIL'); assert.equal(cleanup.qualified, false); assert.ok(existsSync(g.o.ledger + '.lock'));
  const h = setup(t), controller = new AbortController(); h.o.signal = controller.signal;
  h.o.journey = async () => { controller.abort(Error('test interrupt')); await new Promise(() => {}); };
  const interrupted = await h.runner(h.o); assert.equal(interrupted.status, 'INTERRUPTED'); assert.equal(h.browsers[0].closed, true); assert.equal(h.children[0].exitCode, 0);
});
test('historical capture ordinals survive explicit cycles and changed HEAD does not reset a failed chain', async t => {
  const f = setup(t); f.o.history = { count: 7, evidence: [] }; f.o.journey = async c => c.check('contact', false);
  const r = await f.runner(f.o); assert.equal(r.captureOrdinal, 8); f.change('p2');
  const second = await f.runner(f.o); assert.equal(second.repairAttempt, 2);
  f.o.cycle = { ...f.o.cycle, id: 'corrective-2', fix: { root: f.product, from: 'p2', to: 'p2', paths: ['fix.ts'], scope: 'commit alone' } };
  await assert.rejects(f.runner(f.o), /material-change-required/);
});
test('crashed in-flight ownership and unplanned source substitutions cannot start another attempt', async t => {
  const f = setup(t); await f.runner(f.o);
  const state = f.ledger(); state.cycles[0].cursor = 0; state.cycles[0].chain = 0; state.cycles[0].inFlight = 'unfinished-owned-run';
  writeFileSync(f.o.ledger, JSON.stringify(state));
  await assert.rejects(f.runner(f.o), /unfinished-attempt/);
  const g = setup(t); g.o.cycle.arms.candidate.head = 'different-source';
  await assert.rejects(g.runner(g.o), /planned-source-mismatch/);
});
test('failure evidence errors still close exactly the owned browser and world', async t => {
  let stopped = false, closed = false;
  const f = setup(t, { browser: async (o, paths, base) => ({ page: { on() {}, goto: async () => {}, url: () => base,
    screenshot: async () => { mkdirSync(join(paths.dir, 'failure.png')); mkdirSync(join(paths.dir, 'failure.png.unavailable.txt')); throw Error('capture unavailable'); },
    locator: () => ({ ariaSnapshot: async () => '- fixture' }) }, close: async () => { closed = true; } }),
    stop: async () => { stopped = true; } });
  f.o.journey = async c => c.check('contact', false);
  try { await f.runner(f.o); } catch { /* disk/capture faults must not bypass resource cleanup */ }
  assert.equal(closed, true); assert.equal(stopped, true);
});
test('passing assertions cannot qualify without required screenshot and accessibility observations', async t => {
  const f = setup(t, { browser: async (o, paths, base) => ({ page: { on() {}, goto: async () => {}, url: () => base,
    screenshot: async () => { throw Error('screenshot unavailable'); }, locator: () => ({ ariaSnapshot: async () => { throw Error('accessibility unavailable'); } }) }, close: async () => {} }) });
  const report = await f.runner(f.o); assert.equal(report.status, 'EVIDENCE_FAIL'); assert.equal(report.qualified, false);
  assert.equal(report.teardown.worldStopped, true); assert.ok(report.evidence.some(e => e.file.endsWith('.unavailable.txt')));
});
test('real owned tiny child receives forced fake/data/auth settings and exits after success and boot abort', async t => {
  let owned;
  const f = setup(t, { boot: undefined, stop: undefined });
  // Use production boot/teardown with an isolated tiny native-entry fixture; browser remains an injected observation.
  const { startWorld } = await import('../god-skill/dev-world.mjs');
  const server = join(f.product, 'apps/server/src'); mkdirSync(server, { recursive: true });
  writeFileSync(join(server, 'main.ts'), `import {createServer} from 'node:http';\nconsole.log(JSON.stringify({brain:process.env.BRAIN_MODE,auth:process.env.DEV_AUTH,data:process.env.DATA_DIR}));\ncreateServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT));\n`);
  const port = await new Promise(resolve => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const runner = createTestRunner({ source: r => ({root:resolve(r),head:resolve(r).endsWith('/product')?'p1':'t1'}), changed: () => ['fix.ts'], browser: async (o, paths, base) => ({ page: {
    on() {}, goto: async () => {}, url: () => base, screenshot: async () => Buffer.from('PNG'), locator: () => ({ ariaSnapshot: async () => '- fixture' }) }, close: async () => {} }),
    boot: async o => startWorld({ ...o, onSpawn(c) { owned = c; o.onSpawn(c); } }) });
  f.o.world.port = port; f.o.world.env = { BRAIN_MODE: 'live', DEV_AUTH: '0', DATA_DIR: 'old-data' };
  const result = await runner(f.o); assert.equal(result.status, 'PASS'); assert.ok(owned.exitCode !== null || owned.signalCode !== null);
  const env = JSON.parse(readFileSync(result.paths.log, 'utf8').trim()); assert.equal(env.brain, 'fake'); assert.equal(env.auth, '1'); assert.equal(env.data, result.paths.data);
  assert.equal(result.qualified, false);
  const g = setup(t); mkdirSync(join(g.product, 'apps/server/src'), { recursive: true });
  writeFileSync(join(g.product, 'apps/server/src/main.ts'), "throw Error('fixture boot failed');\n");
  g.o.world.port = port; g.o.world.timeoutMs = 1000;
  const aborted = await runner({ ...g.o, journey: async c => c.check('must-not-run', true) });
  assert.equal(aborted.status, 'BOOT_ABORT'); assert.equal(aborted.assertions.length, 0);
  assert.ok(owned.exitCode !== null || owned.signalCode !== null);
  const h = setup(t); mkdirSync(join(h.product, 'apps/server/src'), { recursive: true });
  writeFileSync(join(h.product, 'apps/server/src/main.ts'), "import {createServer} from 'node:http';createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT));setTimeout(()=>process.exit(1),180);\n");
  h.o.world.port = port; h.o.journey = async c => { await new Promise(r => setTimeout(r, 250)); c.check('contact', true); };
  const death = await runner(h.o); assert.equal(death.status, 'FAIL'); assert.match(death.error, /owned-world-exited/);
});
test('default checkout caller and ownership-callback error retain default entrypoint and stop the spawned child', async t => {
  const f = setup(t); const { startWorld } = await import('../god-skill/dev-world.mjs'); let child;
  const data = join(f.root, 'default-data');
  await assert.rejects(startWorld({ slug: 'default-fixture', port: 19049, data, log: join(f.root, 'default.log'),
    onSpawn(c) { child = c; assert.equal(c.spawnargs[1], 'apps/server/src/main.ts'); throw Error('stop before entry'); } }), /stop before entry/);
  await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); });
  assert.ok(existsSync(data)); assert.ok(child.exitCode !== null || child.signalCode !== null);
});
test('actual public API rejects arbitrary running URLs before any browser or child work', async () => {
  await assert.rejects(runOwnedAttempt({ owner: 'agent', cycle: { id: 'x', plan: [{}] }, ledger: 'unused', url: 'https://example.com' }), /existing-resource-override/);
});
test('empty-tree fix, changed agent identity and untracked driver cannot launder qualification', async t => {
  const f = setup(t, { changed: () => [''] }); f.o.cycle.fix.paths = [''];
  await assert.rejects(f.runner(f.o), /change-paths-mismatch/);
  const g = setup(t); g.o.journey = async c => c.check('contact', false); await g.runner(g.o); g.change('p2'); g.o.owner = '/test/renamed';
  await assert.rejects(g.runner(g.o), /owner-mismatch/);
  await assert.rejects(runOwnedAttempt({ ...g.o, journey: async () => {} }), /committed-driver-required/);
});
test('owned-world death during otherwise passing assertions and late interruption are failures', async t => {
  const f = setup(t); f.o.journey = async c => { f.children[0].exitCode = 1; f.children[0].emit('exit', 1); c.check('contact', true); };
  const died = await f.runner(f.o); assert.equal(died.status, 'FAIL'); assert.equal(died.qualified, false);
  const controller = new AbortController();
  const g = setup(t, { browser: async (o, paths, base) => ({ page: { on() {}, goto: async () => {}, url: () => base,
    screenshot: async () => { controller.abort(Error('late interrupt')); return Buffer.from('PNG'); }, locator: () => ({ ariaSnapshot: async () => '- fixture' }) }, close: async () => {} }) });
  g.o.signal = controller.signal;
  const interrupted = await g.runner(g.o); assert.equal(interrupted.status, 'INTERRUPTED'); assert.equal(interrupted.qualified, false);
});
test('interrupted browser launch retains pending ownership, stops the world, and closes only its late context', async t => {
  const controller = new AbortController(); let opened, closed = false;
  const f = setup(t, { browser: async () => { setTimeout(() => controller.abort(Error('launch interrupted')), 1); return await new Promise(resolve => { opened = resolve; }); } });
  f.o.signal = controller.signal;
  const report = await f.runner(f.o); assert.equal(report.status, 'CLEANUP_FAIL'); assert.equal(report.teardown.worldStopped, true);
  assert.equal(report.teardown.browserClosed, false); assert.equal(report.teardown.browserOpenPending, true); assert.ok(existsSync(f.o.ledger + '.lock'));
  const original = readFileSync(join(report.paths.dir, 'report.json'));
  opened({ close: async () => { closed = true; } }); await new Promise(r => setImmediate(r));
  assert.equal(closed, true); assert.deepEqual(readFileSync(join(report.paths.dir, 'report.json')), original);
  assert.equal(JSON.parse(readFileSync(join(report.paths.dir, 'late-browser-cleanup.json'))).closed, true);
});
test('tracked committed driver preflight uses matching product/tool/driver identities and bounds all hooks', async t => {
  const f = setup(t), env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Proof Fixture', GIT_AUTHOR_EMAIL: 'proof@example.com', GIT_COMMITTER_NAME: 'Proof Fixture', GIT_COMMITTER_EMAIL: 'proof@example.com' };
  const git = (...args) => execFileSync('git', ['-C', f.root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); writeFileSync(join(f.root, '.gitignore'), 'runs/\nledger.json*\n');
  writeFileSync(join(f.root, 'driver.mjs'), 'export default async c => c.check("tracked-driver",true);\n');
  git('add', '.'); git('commit', '-m', 'Initial fixture'); const from = git('rev-parse', 'HEAD');
  writeFileSync(join(f.root, 'driver.mjs'), 'export default async c => c.check("tracked-driver",true,"corrected fixture");\n');
  git('add', '.'); git('commit', '-m', 'Correct fixture'); let head = git('rev-parse', 'HEAD');
  f.o.sourceRoot = f.root; f.o.driver = { root: f.root, path: 'driver.mjs' };
  f.o.cycle.fix = { root: f.root, from, to: head, paths: ['driver.mjs'], scope: 'relevant fixture correction' };
  f.o.cycle.arms.candidate = { root: f.root, head };
  let cancelling, controller;
  const callbacks = { boot: async o => { const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }); o.onSpawn(child); if (cancelling === 'prepare') setTimeout(() => controller.abort(Error('prepare interrupted')), 5); return { child, base: `https://example.com:${o.port}`, dataDir: o.data }; },
    browser: async (o, paths, base) => { if (cancelling === 'beforeNavigation') setTimeout(() => controller.abort(Error('navigation interrupted')), 5); return { page: { on() {}, goto: async () => {}, url: () => base, screenshot: async () => Buffer.from('PNG'), locator: () => ({ ariaSnapshot: async () => '- fixture' }) }, close: async () => {} }; }, stop: async c => { if(c)c.exitCode = 0; },
    source: root => ({ root: resolve(root), head: git('rev-parse', 'HEAD') }), changed: () => ['driver.mjs'], portFree: async () => true };
  const runner = createTestRunner(callbacks), passed = await runner(f.o);
  assert.equal(passed.status, 'PASS'); assert.deepEqual(Object.keys(passed.source).sort(), ['driver', 'product', 'tool']);
  for (const phase of ['prepare', 'prepare-abort', 'beforeNavigation', 'beforeNavigation-abort', 'observer']) {
    const hook = phase.replace('-abort', '');
    const code = phase === 'observer' ? 'export const beforeNavigation=async()=>()=>new Promise(()=>{});' : `export const ${hook}=async({signal,paths})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{writeFileSync(join(paths.dir,'hook-aborted.txt'),'observed');${phase.endsWith('-abort') ? 'reject(signal.reason);' : ''}},{once:true}));`;
    writeFileSync(join(f.root, 'driver.mjs'), "import {writeFileSync} from 'node:fs';import {join} from 'node:path';\n" + code + '\nexport default async c=>c.check("hook",true);\n');
    git('add', 'driver.mjs'); git('commit', '-m', 'Correct hook fixture'); const next = git('rev-parse', 'HEAD');
    f.o.cycle = { ...f.o.cycle, id: phase, fix: { ...f.o.cycle.fix, from: head, to: next }, arms: { candidate: { root: f.root, head: next } } }; head = next;
    cancelling = phase.endsWith('-abort') ? hook : null; controller = new AbortController(); f.o.signal = controller.signal;
    f.o.phaseTimeoutMs = cancelling ? 1000 : 5; f.o.cleanupTimeoutMs = 5;
    const r = await runner(f.o); assert.equal(r.teardown.worldStopped, true);
    assert.equal(r.qualified, false); assert.equal(r.status, phase === 'observer' ? 'CLEANUP_FAIL' : hook === 'prepare' ? 'BOOT_ABORT' : cancelling ? 'INTERRUPTED' : 'FAIL');
    if (phase !== 'observer') assert.ok(existsSync(join(r.paths.dir, 'hook-aborted.txt')), 'timeout and cancellation abort the hook signal');
    if (phase === 'observer') assert.ok(existsSync(f.o.ledger + '.lock'), 'failed observer cleanup retains ownership');
  }
});
test('public production preflight refuses a dirty helper, or reaches owned boot with three matching committed identities', async t => {
  const f = setup(t), env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Proof Fixture', GIT_AUTHOR_EMAIL: 'proof@example.com', GIT_COMMITTER_NAME: 'Proof Fixture', GIT_COMMITTER_EMAIL: 'proof@example.com' };
  const git = (...args) => execFileSync('git', ['-C', f.root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); writeFileSync(join(f.root, '.gitignore'), 'runs/\nledger.json*\n');
  mkdirSync(join(f.root, 'apps/server/src'), { recursive: true });
  writeFileSync(join(f.root, 'apps/server/src/main.ts'), "import {createServer} from 'node:http';createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT));\n");
  writeFileSync(join(f.root, 'driver.mjs'), 'export default async c=>c.check("fixture",true);\n');
  git('add', '.'); git('commit', '-m', 'Initial fixture'); const from = git('rev-parse', 'HEAD');
  writeFileSync(join(f.root, 'driver.mjs'), 'export default async c=>c.check("fixture",true,"corrected fixture");\n');
  git('add', '.'); git('commit', '-m', 'Correct fixture'); const head = git('rev-parse', 'HEAD');
  const port = await new Promise(resolve => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const o = { ...f.o, toolRoot: undefined, sourceRoot: f.root, driver: { root: f.root, path: 'driver.mjs' }, world: { slug: 'owned-test', port, timeoutMs: 2000 },
    cycle: { id: 'public-preflight', fix: { root: f.root, from, to: head, paths: ['driver.mjs'], scope: 'actual committed fixture correction' }, arms: { candidate: { root: f.root, head } }, plan: [{ arm: 'candidate', repeat: 1 }] } };
  delete o.journey;
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) await assert.rejects(runOwnedAttempt(o), /source-dirty/);
  else {
    const r = await runOwnedAttempt(o); assert.equal(r.status, 'BOOT_ABORT'); assert.equal(r.browserStarted, false);
    assert.match(r.error, /explicit-browser-cache-required/); assert.equal(r.teardown.worldStopped, true); assert.equal(r.qualified, false);
    assert.deepEqual(Object.keys(r.source).sort(), ['driver', 'product', 'tool']);
    await assert.rejects(runOwnedAttempt(o), /fresh-node-process-required/);
  }
});
