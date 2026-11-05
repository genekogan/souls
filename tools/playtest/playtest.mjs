#!/usr/bin/env node
// Playtest orchestrator: run | review | replay | compare | preflight. See DESIGN.md §1.
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFrozenGenesis } from './lib/physical-fixture.mjs';
import { bindJourneyFixtures } from './arena/fixture-bindings.mjs';
import { providerPolicy, requireProviders, assertMeasurementReady } from './lib/provider-policy.mjs';
import { now, setAnchor, sleep, monoMs } from './lib/clock.mjs';
import { writeJson, readJson, appendJsonl } from './lib/jsonl.mjs';
import { quota, quotaAllows } from './lib/quota.mjs';
import { sha256, rng } from './lib/hash.mjs';
import { tickValidity } from './tick-validity.mjs';
import { freeMemGb, resolvePlaywright } from './lib/platform.mjs';
import { REPO_ROOT, scratchDir } from '../lib/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER_ROOT = process.env.PLAYTEST_SERVER_ROOT ?? REPO_ROOT;
const RUNS_ROOT = process.env.PLAYTEST_RUNS_ROOT ?? scratchDir('playtest/runs');
const FROZEN_BUNDLE = join(here, 'frozen/frozen.json');
const STEPS = ['preflight', 'provision', 'seats', 'play', 'close', 'review', 'develop', 'report'];

function args(argv) { const out = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; out[k] = v; } else out._.push(a); } return out; }
const log = (...a) => console.error(`[playtest ${new Date().toISOString().slice(11, 19)}]`, ...a);
function receipt(runDir, n, step, data) { writeJson(join(runDir, 'receipts', `${n}-${step}.json`), { step, ...now(), ...data }); }
function hasReceipt(runDir, n, step) { const r = readJson(join(runDir, 'receipts', `${n}-${step}.json`)); return r && r.ok; }

export async function loadModules() {
  const m = {};
  const tryImport = async (k, p) => { try { m[k] = await import(p); } catch (e) { m[k] = null; log(`module ${k} unavailable: ${e.message.split('\n')[0]}`); } };
  await tryImport('provision', './arena/provision.mjs');
  await tryImport('seat', './arena/seat.mjs');
  await tryImport('owner', './arena/owner.mjs');
  await tryImport('godSeat', './arena/god-seat.mjs');
  await tryImport('truth', './observer/world-truth.mjs');
  await tryImport('browser', './observer/browser.mjs');
  await tryImport('evidence', './observer/evidence.mjs');
  await tryImport('persona', './director/persona.mjs');
  await tryImport('director', './director/director.mjs');
  await tryImport('oracles', './review/oracles.mjs');
  await tryImport('reviewer', './review/reviewer.mjs');
  await tryImport('developer', './review/developer.mjs');
  await tryImport('metrics', './review/metrics.mjs');
  await tryImport('report', './review/report.mjs');
  await tryImport('compare', './review/compare.mjs');
  return m;
}

/** Machine gate (Gene 2026-10-25): 1-minute load under 10 and at least 6 GB reclaimable memory (vm_stat on macOS,
 *  MemAvailable on Linux; lib/platform.mjs). */
export async function machineCheck() {
  const checks = {};
  try { const { loadavg } = await import('node:os'); checks.laptopLoad = loadavg().map((x) => Math.round(x * 10) / 10); } catch { /* n/a */ }
  checks.freeGb = freeMemGb();
  checks.machineOk = (checks.laptopLoad?.[0] ?? 0) < 10 && (checks.freeGb == null || checks.freeGb >= 6);
  return checks;
}

export async function preflight({ serverRoot, scenario = {} }) {
  const policy = providerPolicy(scenario);
  const q = policy.claude ? await quota() : { skipped: 'no Claude roles' };
  const checks = { quota: q, serverRoot: existsSync(join(serverRoot, 'tools/god-skill/dev-world.mjs')), webDist: existsSync(join(serverRoot, 'apps/web/dist/index.html')), controllerCli: existsSync(join(serverRoot, 'tools/world-launcher/soul/eden.mjs')), playwright: resolvePlaywright({ serverRoot })?.from ?? false, claude: null, codex: null };
  const { run } = await import('./lib/proc.mjs');
  for (const provider of policy.required) {
    const version = await run(provider, ['--version'], { maxWallMs: 20000 });
    checks[provider] = version.code === 0 ? version.stdout.trim() : null;
  }
  try { requireProviders(policy, checks); checks.providersOk = true; } catch (e) { checks.providersOk = false; checks.providerError = e.message; }
  // Live arena health, so a slow world is caught before a playout, not after (Gene 2026-10-25).
  checks.live = {};
  for (const w of ['eden-2026', 'godmode-lab']) { try { const r = await fetch(`https://sim.eden.art/worlds/w/${w}/healthz`, { signal: AbortSignal.timeout(8000) }); const j = await r.json(); checks.live[w] = { ok: j.ok, build: j.build, tickMs: j.tickMs, clients: j.clients }; } catch (e) { checks.live[w] = { ok: false, error: String(e.message).slice(0, 80) }; } }
  // Machine gate (Gene 2026-10-25): a loaded or memory-bound laptop produced false failures all night. Refuse to start
  // unless the 1-minute load is under 10 and at least 6 GB of memory is free; `--force-machine` records the breach instead.
  // macOS: os.freemem() excludes inactive and purgeable pages; vm_stat gives the reclaimable total (Linux: MemAvailable).
  Object.assign(checks, await machineCheck());
  const allow = policy.claude ? quotaAllows(q, { stopPct: 85 }) : { allowed: true, note: 'Claude unused; Codex limit errors stop the seat' };
  const ok = checks.serverRoot && checks.webDist && checks.controllerCli && checks.playwright && checks.providersOk && allow.allowed && (checks.machineOk || process.argv.includes('--force-machine'));
  return { ok, allow, checks };
}

/** cmdRun(args, hooks?) runs one scenario. hooks (tools/playtest/runs/, all optional) let an owning lifecycle see what
 *  this run creates and stop it: own(kind, id, release, meta) registers a created resource, signal (AbortSignal) is
 *  checked between steps, preflight is a result already computed, modules replaces loadModules() (tests).
 *  Without hooks the behavior is unchanged. */
export async function cmdRun(a, hooks = null) {
  const scenarioPath = resolve(a._[1]);
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const policy = providerPolicy(scenario);
  assertMeasurementReady(scenario);
  const seed = Number(a.seed ?? scenario.seed ?? 1);
  const serverRoot = resolve(a['server-root'] ?? scenario.serverRoot ?? DEFAULT_SERVER_ROOT);
  assertFrozenGenesis(scenario, serverRoot);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const runDir = a.out ? resolve(a.out) : join(RUNS_ROOT, `${stamp}-${scenario.name}-${seed}`);
  mkdirSync(join(runDir, 'receipts'), { recursive: true });
  setAnchor(performance.now());
  writeJson(join(runDir, 'scenario.json'), { ...scenario, seed, serverRoot, scenarioPath, scenarioSha256: sha256(readFileSync(scenarioPath)) });
  log(`run ${runDir}`);
  const from = a.from ? STEPS.indexOf(a.from) : 0;
  const m = hooks?.modules ?? await loadModules();
  const own = (kind, id, release, meta) => hooks?.own?.(kind, id, release, meta);
  const checkAbort = (step) => { if (hooks?.signal?.aborted) throw Object.assign(new Error(`run cancelled before ${step}: ${hooks.signal.reason ?? 'aborted'}`), { code: 'RUN_CANCELLED' }); };
  const ctx = { runDir, scenario, seed, serverRoot, m, world: null, seats: [], god: null, browser: null, cameras: {}, owner: null };

  // 0 preflight
  if (from <= 0) { const pf = hooks?.preflight ?? await preflight({ serverRoot, scenario }); writeJson(join(runDir, 'preflight.json'), pf); receipt(runDir, 0, 'preflight', { ok: pf.ok, allow: pf.allow }); if (!pf.ok) { log('preflight failed', JSON.stringify(pf.checks)); return 2; } }
  // 1 provision
  if (from <= 1) {
    if (!m.provision) throw new Error('arena/provision.mjs missing');
    checkAbort('provision');
    if (scenario.world.kind !== 'dev') throw new Error(`world kind ${scenario.world.kind} is not available in this stage`);
    const slug = scenario.world.slug ?? `pt-${scenario.name}`.slice(0, 31);
    ctx.world = await m.provision.startWorld({ serverRoot, slug, port: scenario.world.port, genesis: resolve(serverRoot, scenario.world.genesis), snapshot:scenario.world.snapshot?resolve(serverRoot,scenario.world.snapshot):undefined, dataDir: join(runDir, 'server', 'data'), log: join(runDir, 'server', 'world.log'), fresh: true, natives: scenario.world.natives === true, onSpawn: (child) => own('world', slug, () => m.provision.stopWorld({ pid: child.pid }), { pid: child.pid, port: scenario.world.port, dataDir: join(runDir, 'server', 'data') }) });
    try { ctx.world = { ...ctx.world, ...(await m.provision.describeWorld({ base: ctx.world.base, slug, port: scenario.world.port, pid: ctx.world.pid, build: ctx.world.build, startedAt: new Date().toISOString() })) }; } catch (e) { log('describeWorld failed', e.message); }
    writeJson(join(runDir, 'world.json'), { ...ctx.world, child: undefined, healthz: undefined });
    try { writeJson(join(runDir, 'server', 'healthz-before.json'), { ...(await m.provision.healthz(ctx.world.base)), at: Date.now() }); } catch { /* recorded as missing */ }
    receipt(runDir, 1, 'provision', { ok: true, base: ctx.world.base, build: ctx.world.build });

  } else { ctx.world = readJson(join(runDir, 'world.json')); }

  let exitCode = 0;
  try {
    // An owning lifecycle's world setup (tools/playtest/runs/setup.mjs): after provision, before any seat; it throws to refuse.
    if (from <= 1 && hooks?.afterProvision) { checkAbort('setup'); await hooks.afterProvision({ world: ctx.world, runDir }); }
    if (scenario.director?.script?.some(e => e.expect?.journey)) {
      const response = await fetch(`${ctx.world.base}/v1/world/snapshot`);
      if (!response.ok) throw new Error('fixture snapshot unavailable');
      writeJson(join(runDir, 'fixture-bindings.json'), bindJourneyFixtures(scenario, await response.json()));
      writeJson(join(runDir, 'scenario.json'), { ...scenario, seed, serverRoot, scenarioPath, scenarioSha256: sha256(readFileSync(scenarioPath)) });
    }
    // 2 seats
    if (from <= 2) {
      if (!m.seat || !m.owner) throw new Error('arena/seat.mjs or owner.mjs missing');
      ctx.owner = m.owner;
      // Keep each declared adapter; a missing provider fails instead of spending on another one.
      for (const s of scenario.seats) {
        checkAbort(`seat ${s.id}`);
        const seat = await m.seat.createSeat({ runDir, seat: s, worldBase: ctx.world.base, serverRoot, rails: scenario.rails ?? {} });
        own('controller', s.id, () => seat.stop(), { dir: seat.dir ?? null, adapter: s.adapter ?? 'claude-headless', model: s.model ?? null });
        if (s.substitutedFrom) { seat.info.substitutedFrom = s.substitutedFrom; seat.save?.(); }
        const ob = await seat.onboard({ text: onboardingText(ctx.world.base, s.soulName), maxWallSec: scenario.rails?.onboardWallSec ?? 600, timeoutSec: scenario.rails?.onboardTimeoutSec ?? 540 });
        log(`seat ${s.id}: ${ob.ok ? 'paired ' + ob.soulId : 'NOT PAIRED'}`);
        if (ob.ok) { const w = seat.wakeLoop?.(); log(`seat ${s.id}: wake loop ${w ? 'on' : 'off'}`); }
        ctx.seats.push(seat);
        if (!ob.ok) { appendJsonl(join(runDir, 'infrastructure-invalid.jsonl'), { seat: s.id, reason: 'onboarding did not pair' }); throw new Error(`seat ${s.id} onboarding invalid; no product requests sent`); }
      }
      if (scenario.god && m.godSeat) {
        checkAbort('god seat');
        ctx.god = await m.godSeat.createGodSeat({ runDir, god: scenario.god, worldBase: ctx.world.base, serverRoot, rails: scenario.rails ?? {} });
        own('controller', 'god', () => ctx.god.stop(), { dir: ctx.god.dir ?? null, adapter: scenario.god.adapter ?? 'claude-headless', model: scenario.god.model ?? null });
        const gb = ctx.god.onboardGod ? await ctx.god.onboardGod({ maxWallSec: scenario.rails?.onboardWallSec ?? 600, timeoutSec: scenario.rails?.onboardTimeoutSec ?? 540 }) : await ctx.god.onboard({ text: godOnboardingText(ctx.world.base), maxWallSec: scenario.rails?.maxTurnWallSec ?? 300 });
        log(`god seat: ${gb.ok ? 'paired' : 'NOT PAIRED'}`);
        if (gb.ok) ctx.god.wakeLoop?.();
      }
      receipt(runDir, 2, 'seats', { ok: ctx.seats.every((s) => !!infoOf(s).soulId), seats: ctx.seats.map((s) => infoOf(s)), god: ctx.god ? infoOf(ctx.god) : null });
    }
    // 3 play
    if (from <= 3) {
      if (!m.director) throw new Error('director/director.mjs missing');
      checkAbort('play');
      let observer = null;
      const obsMode = scenario.observer?.mode ?? 'cameras';
      if (obsMode === 'passive' && m.evidence && m.truth) {
        // Passive observation (#754): world-truth evidence packs only, no browser and no cameras.
        observer = { camera: () => null, cameras: {}, truth: m.truth, evidence: m.evidence, browser: null, sampleSec: scenario.observer?.sampleSec ?? 5 };
        log('observer: passive (evidence packs, no cameras)');
      } else if (obsMode === 'off') log('observer: off');
      else if (m.browser && m.evidence && m.truth) {
        ctx.browser = await m.browser.openBrowser({ headless: true, gpu: scenario.observer?.gpu ?? 'metal', serverRoot });
        own('browser', 'observer', () => ctx.browser.close(), { gpu: ctx.browser.gpu ?? null });
        const vpRaw = scenario.observer?.viewport ?? [1280, 800]; const vp = Array.isArray(vpRaw) ? { width: vpRaw[0], height: vpRaw[1] } : vpRaw;
        // Recording (#754): the cameras named in observer.record (true = all) record one uncut real-speed video each.
        const rec = scenario.observer?.record ?? null, recDir = join(runDir, 'recordings');
        const recMeta = { attempt: scenario.observer?.recordMeta?.attempt ?? 1, ...(scenario.observer?.recordMeta ?? {}), world: { slug: scenario.world?.slug ?? null, port: scenario.world?.port ?? null } };
        const recordFor = (name, kind) => (rec === true || (Array.isArray(rec) && (rec.includes(name) || (kind === 'follow' && rec.includes('follow')))) ? { dir: (mkdirSync(recDir, { recursive: true }), recDir), meta: recMeta } : null);
        ctx.cameraLog = [];
        const openCam = async (opts) => { try { const c = await ctx.browser.openCamera({ ...opts, record: recordFor(opts.name, opts.kind), arrivalTimeoutMs: scenario.observer?.arrivalTimeoutMs ?? 180000 }); ctx.cameraLog.push({ name: opts.name, kind: opts.kind, ok: true, arrivedMs: c.arrivedMs, follow: c.follow, free: c.free }); return c; } catch (e) { log(`camera ${opts.name} failed: ${String(e.message).split('\n')[0]}`); ctx.cameraLog.push({ name: opts.name, kind: opts.kind, ok: false, reason: String(e.message).split('\n')[0] }); return null; } };
        for (const seat of ctx.seats) { const info = infoOf(seat); if (info.soulId) { const cam = await openCam({ base: ctx.world.base, identity: info.ownerIdentity, kind: 'follow', soulId: info.soulId, viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: info.id }); if (cam) ctx.cameras[info.id] = cam; } }
        if ((scenario.observer?.cameras ?? []).includes('wide')) { const cam = await openCam({ base: ctx.world.base, identity: null, kind: 'wide', viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: 'wide' }); if (cam) ctx.cameras.wide = cam; }
        if ((scenario.observer?.cameras ?? []).includes('free')) { const cam = await openCam({ base: ctx.world.base, identity: null, kind: 'free', composition: scenario.observer?.freeComposition ?? null, viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: 'free' }); if (cam) ctx.cameras.free = cam; }
        writeJson(join(runDir, 'cameras.json'), { ...now(), cameras: ctx.cameraLog });
        // The creator sees the whole world page as its owner (dev:admin on a dev world): a wide camera named after the god seat.
        if (ctx.god) { const gid = infoOf(ctx.god).id ?? 'god'; const cam = await openCam({ base: ctx.world.base, identity: 'admin', kind: 'wide', viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: gid }); if (cam) ctx.cameras[gid] = cam; }
        observer = { camera: (id) => ctx.cameras[id] ?? null, cameras: ctx.cameras, truth: m.truth, evidence: m.evidence, browser: ctx.browser, sampleSec: scenario.observer?.sampleSec ?? 5 };
      } else log('observer modules missing: playing without screenshots/evidence');
      const quotaCheck = async () => { if (!policy.claude) return true; const q = await quota(); const r = quotaAllows(q, { stopPct: scenario.rails?.quotaStopPct ?? 90 }); if (!r.allowed) log('QUOTA STOP', r.note); return r.allowed; };
      const play = await m.director.runPlay({ runDir, scenario, world: { ...ctx.world, name: scenario.world.slug, skillPath: join(runDir, 'server', 'skill.md') }, seats: Object.fromEntries(ctx.seats.map((s) => [infoOf(s).id, s])), god: ctx.god, observer, owner: m.owner, seed, quotaCheck });
      ctx.browser?.markComplete?.();
      receipt(runDir, 3, 'play', { ok: true, ...play });
    }
    // 4 close
    if (from <= 4) {
      const closed = { seats: [], god: null };
      for (const seat of ctx.seats) { try { await seat.stop(); closed.seats.push(infoOf(seat)); } catch (e) { closed.seats.push({ error: e.message }); } }
      if (ctx.god) { try { await ctx.god.stop(); closed.god = infoOf(ctx.god); } catch (e) { closed.god = { error: e.message }; } }
      if (ctx.sampler) { try { await ctx.sampler.stop?.(); } catch { /* ignore */ } }
      if (ctx.browser) { try { await ctx.browser.close(); } catch { /* ignore */ } }
      try { if (m.provision && ctx.world?.base) writeJson(join(runDir, 'server', 'healthz-after.json'), await m.provision.healthz(ctx.world.base)); } catch { /* recorded as missing */ }
      // H-a: verdicts count only if the world ticked at its nominal rate while the Souls played
      try { const before = existsSync(join(runDir, 'server', 'healthz-before.json')) ? readJson(join(runDir, 'server', 'healthz-before.json')) : null, after = existsSync(join(runDir, 'server', 'healthz-after.json')) ? { ...readJson(join(runDir, 'server', 'healthz-after.json')), at: Date.now() } : null;
        const v = tickValidity(before, after); writeJson(join(runDir, 'server', 'tick-validity.json'), v); log('H-a tick service', v.service ?? '-', v.valid === false ? 'INVALID' : v.valid ? 'valid' : 'not judged');
        if (v.valid === false) appendJsonl(join(runDir, 'infrastructure-invalid.jsonl'), { check: 'H-a', reason: v.reason, service: v.service }); } catch (e) { log('H-a check failed', e.message); }
      writeJson(join(runDir, 'close.json'), { ...now(), ...closed });
      receipt(runDir, 4, 'close', { ok: true });
    }
  } catch (e) {
    log('run failed:', e.stack ?? e.message); exitCode = 1;
    receipt(runDir, 9, 'failure', { ok: false, error: String(e.stack ?? e.message) });
    for (const seat of ctx.seats) { try { await seat.stop(); } catch { /* ignore */ } }
    if (ctx.browser) { try { await ctx.browser.close(); } catch { /* ignore */ } }
  } finally {
    if (ctx.world?.pid && !a['keep-world'] && m.provision) { try { await m.provision.stopWorld(ctx.world); log('world stopped'); } catch (e) { log('world stop failed', e.message); } }
  }
  if (exitCode) return exitCode;
  return await reviewRun(runDir, m, { serverRoot, from });
}

export async function reviewRun(runDir, m, { serverRoot, from = 5 } = {}) {
  const scenario = readJson(join(runDir, 'scenario.json'));
  const policy = providerPolicy(scenario);
  if (!m) m = await loadModules();
  if (from <= 5) {
    if (!m.reviewer) { log('review module missing'); return 3; }
    const r = await m.reviewer.reviewRun({ runDir, model: scenario.review?.reviewerModel ?? 'opus', log });
    receipt(runDir, 5, 'review', { ok: true, requests: r.reviews?.length ?? 0, issues: r.issues?.length ?? 0, featureRequests: r.featureRequests?.length ?? 0, fidelity: (r.reviews ?? []).map((x) => `${x.requestId}:${x.fidelity}`).join(' ') });
  }
  if (from <= 6) {
    if (policy.deterministic || scenario.review?.developer === false) receipt(runDir, 6, 'develop', { ok: true, skipped: policy.deterministic ? 'deterministic review: no model developer' : 'scenario.review.developer is false' });
    else if (m.developer) {
      // The Developer is a draft generator in this stage: cap how many issues and feature requests get a spec per run.
      const maxI = scenario.review?.developerMaxIssues ?? 4, maxF = scenario.review?.developerMaxFeatureRequests ?? 3;
      const ids = [...(readJson(join(runDir, 'issues.json'), []) ?? []).slice(0, maxI).map((i) => i.id), ...(readJson(join(runDir, 'feature-requests.json'), []) ?? []).slice(0, maxF).map((f) => f.id)].filter(Boolean);
      const d = await m.developer.developRun({ runDir, serverRoot: serverRoot ?? scenario.serverRoot ?? DEFAULT_SERVER_ROOT, model: scenario.review?.developerModel ?? 'opus', only: ids.length ? ids : null, log });
      receipt(runDir, 6, 'develop', { ok: true, drafted: ids.length, ...summary(d) });
    }
    else receipt(runDir, 6, 'develop', { ok: false, note: 'developer module missing' });
  }
  if (from <= 7) {
    if (m.metrics?.metricsRun) m.metrics.metricsRun(runDir);
    if (m.report?.reportRun) m.report.reportRun(runDir);
    receipt(runDir, 7, 'report', { ok: true });
  }
  log(`done: ${runDir}/REPORT.md`);
  return 0;
}
const infoOf = (s) => (typeof s?.info === 'function' ? s.info() : s?.info ?? {});
const summary = (x) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))) : {});

export function onboardingText(base, name) { return `Make me a Soul in this world: ${base}/ . Call it ${name}. Start from ${base}/instructions.md and do everything it says without stopping to ask, one command per call from this folder with relative paths (\`node eden.mjs …\`, no cd, no && chains); tell me when it is ready.`; }
export function godOnboardingText(base) { return `You are the god of my world at ${base}/ . Set yourself up from ${base}/god/SKILL.md (register with dev:admin and mint, since this is a local world), then wait for my messages.`; }

/** replay-set: the frozen set (ROOT-CAUSES §E) as scripted replays, one playout at a time under the machine gate,
 *  then <out>/SCORECARD.md against --baseline (a previous replay-set out dir) or the original runs. */
async function cmdReplaySet(a) {
  const sc = await import('./review/scorecard.mjs');
  const runsRoot = resolve(a['runs-root'] ?? RUNS_ROOT);
  const repeats = Number(a.repeats ?? 2);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const out = resolve(a.out ?? join(runsRoot, `replay-set-${stamp}`));
  const baselineDir = a.baseline ? resolve(a.baseline) : null;
  const only = a.only ? String(a.only).split(',') : null;
  const frozen = sc.FROZEN.filter((f) => !only || only.includes(f.label));
  // Frozen bundle (tools/playtest/frozen/frozen.json, from `freeze-bundle`): the frozen scenarios and baseline measures
  // without the run folders, for a machine that does not have them (the cloud box). Used when --frozen is given, or
  // when a frozen run folder is missing and the default bundle exists.
  const bundleFile = a.frozen ? resolve(a.frozen) : (frozen.some((f) => !existsSync(join(runsRoot, f.run, 'scenario.json'))) && existsSync(FROZEN_BUNDLE) ? FROZEN_BUNDLE : null);
  const bundle = bundleFile ? readJson(bundleFile, null) : null;
  if (bundleFile && !bundle) { log(`frozen bundle unreadable: ${bundleFile}`); return 2; }
  if (bundle) log(`frozen bundle ${bundleFile} (${bundle.createdAt})`);
  const fromBundle = (label) => bundle?.entries?.find((e) => e.label === label) ?? null;
  const plan = frozen.map((f) => {
    const src = join(runsRoot, f.run);
    const b = fromBundle(f.label);
    if (bundle && !b) throw new Error(`frozen bundle has no entry for ${f.label}; rebuild it with freeze-bundle`);
    let scen;
    if (b) scen = b.scenario;
    else {
      const orig = readJson(join(src, 'scenario.json'), {});
      const current = orig.scenarioPath && existsSync(orig.scenarioPath) ? readJson(orig.scenarioPath, null) : null;
      scen = sc.frozenScenario(src, { currentScenario: current });
    }
    return { ...f, source: b ? `${bundleFile}#${f.label}` : src, scenario: scen, scenarioFile: join(out, 'scenarios', `${f.label}.json`), repeats: Array.from({ length: repeats }, (_, i) => join(out, `${f.label}-r${i + 1}`)) };
  });
  if (a['dry-run']) {
    console.log(`replay-set plan → ${out}\nbaseline: ${baselineDir ?? 'the original runs'} · repeats ${repeats} · sequential, one playout at a time, machine gate before each\n`);
    for (const p of plan) {
      const s = p.scenario; const script = s.director.script;
      const ch = script.reduce((acc, e) => ({ ...acc, [e.channel]: (acc[e.channel] ?? 0) + 1 }), {});
      console.log(`${p.label} (${p.kind}) ← ${p.run}\n  seed ${s.seed} · ${s.durationSec} s · seats ${(s.seats ?? []).map((x) => `${x.id}:${x.adapter}/${x.model}`).join(', ')}${s.god ? ` · god ${s.god.adapter}/${s.god.model}` : ''} · natives ${s.world.natives === true} · sequential ${s.director.sequential} · developer off`);
      console.log(`  ${script.length} requests (${Object.entries(ch).map(([k, v]) => `${v} ${k}`).join(', ')}):`);
      for (const e of script) console.log(`    +${String(e.atSec).padStart(6)} s ${e.seat.padEnd(5)} ${e.channel.padEnd(4)} budget ${e.budgetSec ?? 'default'}  "${e.text.slice(0, 70)}"`);
      console.log(`  → ${p.repeats.join(', ')}`);
    }
    return 0;
  }
  mkdirSync(join(out, 'scenarios'), { recursive: true });
  const manifestFile = join(out, 'replay-set.json');
  const manifest = readJson(manifestFile, null) ?? { version: 1, createdAt: new Date().toISOString(), baseline: baselineDir, repeats, runs: [] };
  const save = () => writeJson(manifestFile, manifest);
  for (const p of plan) {
    writeJson(p.scenarioFile, p.scenario);
    let entry = manifest.runs.find((r) => r.label === p.label);
    if (!entry) { entry = { label: p.label, kind: p.kind, source: p.source, scenario: p.scenarioFile, repeats: [], exits: [] }; manifest.runs.push(entry); }
    if (a['score-only']) { entry.repeats = p.repeats.filter((d) => existsSync(join(d, 'evidence'))); continue; }
    for (const dir of p.repeats) {
      if (existsSync(join(dir, 'receipts', '7-report.json'))) { if (!entry.repeats.includes(dir)) entry.repeats.push(dir); continue; } // resumable
      const gateUntil = Date.now() + Number(a['gate-wait-min'] ?? 30) * 60000;
      let gate = await machineCheck();
      while (!gate.machineOk && !a['force-machine'] && Date.now() < gateUntil) { log(`machine gate: load ${gate.laptopLoad?.[0]} free ${gate.freeGb} GB; waiting`); await sleep(60000); gate = await machineCheck(); }
      if (!gate.machineOk && a['force-machine']) { log(`machine gate breached (load ${gate.laptopLoad?.[0]} free ${gate.freeGb} GB); --force-machine: recorded, continuing`); entry.gateBreaches = [...(entry.gateBreaches ?? []), { dir, ...gate }]; }
      else if (!gate.machineOk) { log('machine gate never cleared; stopping the replay set'); entry.exits.push({ dir, exit: 'gate' }); save(); return 2; }
      log(`replay ${p.label} → ${dir}`);
      const code = await cmdRun({ _: ['run', p.scenarioFile], seed: p.scenario.seed, 'server-root': a['server-root'], out: dir });
      entry.exits.push({ dir, exit: code }); if (existsSync(join(dir, 'evidence'))) entry.repeats.push(dir); save();
    }
  }
  save();
  const baseFrom = {};
  const entries = manifest.runs.filter((r) => r.repeats.length || a['score-only']).map((r) => {
    const f = sc.FROZEN.find((x) => x.label === r.label);
    const fb = fromBundle(r.label);
    const fromDir = baselineDir && sc.baselineFor(f, { baselineDir, runsRoot: null, dirOnly: true });
    const b = fromDir?.measures?.length ? fromDir : fb?.replayBaseline?.measures?.length ? fb.replayBaseline : fb ? { measures: [fb.baseline] } : sc.baselineFor(f, { baselineDir, runsRoot });
    baseFrom[r.label] = fromDir?.measures?.length ? 'replay set dir' : fb?.replayBaseline?.measures?.length ? `bundle replay set ${fb.replayBaseline.from}` : fb ? 'bundle original run' : 'original run';
    return { label: r.label, kind: r.kind, base: sc.mergeBase(b.measures), reps: r.repeats.map(sc.runMeasures) };
  });
  const md = sc.renderScorecard({ entries, repeats, baselineName: baselineDir ? `previous replay set \`${baselineDir}\`` : bundle ? `the frozen bundle (${bundle.createdAt}): ${[...new Set(Object.values(baseFrom))].join(', ')}` : 'the original runs (re-scored with the current oracles)', notes: [bundle ? `Frozen scenarios and baselines from ${basename(bundleFile)} (built from ${bundle.runsRoot}). Baseline per run: ${Object.entries(baseFrom).map(([k, v]) => `${k} ← ${v}`).join('; ')}.` : `Frozen runs from ${runsRoot}.`, 'Pinkteam is a stress add-on (report, do not gate); it is not in this set.'] });
  writeFileSync(join(out, 'SCORECARD.md'), md);
  log(`scorecard: ${join(out, 'SCORECARD.md')}`);
  return 0;
}

/** freeze-bundle: frozen.json with each frozen run's replay scenario and its baseline measures (current oracles), so a
 *  replay set runs where the run folders are not (tools/playtest/frozen/; small: no screenshots, no transcripts).
 *  --baseline <replay-set dir> also stores that set's repeats' measures per label (replayBaseline), which replay-set
 *  then prefers over the original run (like-for-like: scripted replay against scripted replay). */
export async function cmdFreezeBundle(a) {
  const sc = await import('./review/scorecard.mjs');
  const runsRoot = resolve(a['runs-root'] ?? RUNS_ROOT);
  const out = resolve(a.out ?? FROZEN_BUNDLE);
  const baselineDir = a.baseline ? resolve(a.baseline) : null; // a previous replay set: its repeats become the preferred baseline
  const entries = sc.FROZEN.map((f) => {
    const src = join(runsRoot, f.run);
    const orig = readJson(join(src, 'scenario.json'), {});
    const current = orig.scenarioPath && existsSync(orig.scenarioPath) ? readJson(orig.scenarioPath, null) : null;
    const rb = baselineDir ? sc.baselineFor(f, { baselineDir, runsRoot: null, dirOnly: true }) : null;
    return { ...f, scenario: sc.frozenScenario(src, { currentScenario: current }), baseline: sc.runMeasures(src), ...(rb ? { replayBaseline: { from: basename(baselineDir), measures: rb.measures } } : {}) };
  });
  writeJson(out, { version: 1, createdAt: new Date().toISOString(), runsRoot, replayBaseline: baselineDir ? basename(baselineDir) : null, entries });
  log(`frozen bundle: ${out} (${entries.length} runs)`);
  return 0;
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'run') process.exit(await cmdRun(a));
  if (cmd === 'review') process.exit(await reviewRun(resolve(a._[1]), null, { serverRoot: a['server-root'], from: a.from ? STEPS.indexOf(a.from) : 5 }));
  if (cmd === 'preflight') { const pf = await preflight({ serverRoot: resolve(a['server-root'] ?? DEFAULT_SERVER_ROOT) }); console.log(JSON.stringify(pf, null, 1)); process.exit(pf.ok ? 0 : 2); }
  if (cmd === 'compare') { const m = await loadModules(); if (!m.compare) { log('compare module missing'); process.exit(3); } const c = m.compare.compareRuns(resolve(a._[1]), resolve(a._[2])); console.log(m.compare.compareMd ? m.compare.compareMd(c) : JSON.stringify(c, null, 1)); process.exit(0); }
  if (cmd === 'replay-set') process.exit(await cmdReplaySet(a));
  if (cmd === 'freeze-bundle') process.exit(await cmdFreezeBundle(a));
  // direct: a swarm-directed session from a cast file (director/swarm/, STATUS-SWARM.md at the worktree root)
  if (cmd === 'direct') { const { cmdDirect } = await import('./director/swarm/run.mjs'); process.exit(await cmdDirect(a, { log })); }
  if (cmd === 'replay') {
    const src = resolve(a._[1]); const rp = readJson(join(src, 'replay.json')); if (!rp) { log('no replay.json'); process.exit(2); }
    const mode = a.mode ?? 'scripted';
    const { replayToScenario } = await import('./review/report.mjs'); const scen = { ...replayToScenario(rp, mode), name: `${rp.scenario.name}-replay` };
    const tmp = join(src, `replay-${mode}.scenario.json`); writeJson(tmp, scen);
    process.exit(await cmdRun({ _: ['run', tmp], seed: rp.seed, 'server-root': a['server-root'], out: a.out }));
  }
  console.log('usage: playtest.mjs run <scenario.json> [--seed n] [--out dir] [--from step] [--server-root dir] [--keep-world] | review <run> | replay <run> --mode scripted|live | compare <a> <b> | preflight | replay-set [--server-root dir] [--repeats 2] [--out dir] [--baseline dir] [--dry-run] [--score-only] [--only labels] [--frozen bundle.json] [--force-machine] | freeze-bundle [--runs-root dir] [--out file] | direct <cast.json> [--server-root dir] [--world <url>] [--headless] [--script file] [--only a,b] [--out dir] [--no-planner] [--force-machine] [--keep-world]');
  process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
