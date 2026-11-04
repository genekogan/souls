// `playtest.mjs direct <cast.json>`: one directed session end to end, written as a normal run folder.
// preflight → world (dev world from the cast, or --world <url>) → seats (parallel onboarding) → cameras (follow per seat
// + one wide) → planner → orchestrator with the live console (stdin) or a headless script → close → verdict + metrics,
// journal and story.html. Review and developer stay off: `playtest.mjs review <run>` refers the session later.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { now, setAnchor } from '../../lib/clock.mjs';
import { readJson, writeJson } from '../../lib/jsonl.mjs';
import { sha256 } from '../../lib/hash.mjs';
import { quota, quotaAllows } from '../../lib/quota.mjs';
import { castPolicy, castToScenario, loadCast } from './cast.mjs';
import { plan as makePlan } from './planner.mjs';
import { createSwarm } from './orchestrator.mjs';
import { parseScript, stdinConsole } from './console.mjs';
import { worldTruth } from './truth.mjs';
import { verifyRun } from './verify.mjs';
import { REPO_ROOT, scratchDir } from '../../../lib/paths.mjs';

const DEFAULT_SERVER_ROOT = process.env.PLAYTEST_SERVER_ROOT ?? REPO_ROOT;
const RUNS_ROOT = process.env.PLAYTEST_RUNS_ROOT ?? scratchDir('playtest/runs');
const receipt = (runDir, n, step, data) => writeJson(join(runDir, 'receipts', `${n}-${step}.json`), { step, ...now(), ...data });
const infoOf = (s) => (typeof s?.info === 'function' ? s.info() : s?.info ?? {});

/** Run fn over items with at most n in flight. */
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (q.length) await fn(q.shift()); })); }
/** p, or undefined after ms; the timer is cleared either way so a finished session does not hold the process open. */
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t)); };

/** cmdDirect(args, hooks?, {log}) runs one directed session. hooks (tools/playtest/runs/, all optional) are cmdRun's:
 *  own(kind, id, release, meta) registers each created resource, signal (AbortSignal) is checked between steps and ends
 *  play when aborted, preflight is a result already computed, modules replaces the arena/observer imports (tests),
 *  afterProvision runs after the world is up and before any seat. With hooks, live seats or a live planner are refused
 *  before anything is created unless hooks.allowLiveModels is true. Without hooks the behavior is unchanged. */
export async function cmdDirect(a, hooks = null, { log = (...x) => console.error('[direct]', ...x) } = {}) {
  const castPath = resolve(a._[1] ?? '');
  if (!existsSync(castPath)) { log(`usage: playtest.mjs direct <cast.json> [--server-root dir] [--world <url>] [--headless] [--script file] [--only a,b] [--out dir] [--no-planner] [--force-machine] [--keep-world]`); return 1; }
  let cast = loadCast(castPath);
  if (a.only) { const only = String(a.only).split(','); cast = { ...cast, seats: cast.seats.filter((s) => only.includes(s.id)), order: cast.order.filter((id) => only.includes(id)), console: { script: (cast.console?.script ?? []).filter((e) => { const m = String(e.line).match(/^redirect\s+([^:]+):/i); const at = String(e.at ?? '').split(':')[1]; return (!m || only.includes(m[1].trim().toLowerCase())) && (!at || only.includes(at)); }) } }; }
  if (a['no-planner']) cast = { ...cast, orchestrator: { ...cast.orchestrator, planner: null } };
  const own = (kind, id, release, meta) => hooks?.own?.(kind, id, release, meta);
  const checkAbort = (step) => { if (hooks?.signal?.aborted) throw Object.assign(new Error(`run cancelled before ${step}: ${hooks.signal.reason ?? 'aborted'}`), { code: 'RUN_CANCELLED' }); };
  const policy = hooks ? castPolicy(cast) : null;
  // An owning lifecycle admits live minds only when told to; refused here, before the run folder or any process exists.
  if (policy?.live.length && hooks.allowLiveModels !== true) { log(`refused: live model roles ${policy.live.join(', ')} need controllers.allowLiveModels (explicit authorization); use scripted-owner seats and no planner`); return 2; }
  const serverRoot = resolve(a['server-root'] ?? DEFAULT_SERVER_ROOT);
  const headless = !!a.headless;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const runDir = a.out ? resolve(a.out) : join(RUNS_ROOT, `${stamp}-${cast.name}-${cast.seed}`);
  mkdirSync(join(runDir, 'receipts'), { recursive: true });
  setAnchor(performance.now());
  const worldUrl = a.world ? String(a.world).replace(/\/+$/, '') : cast.world.kind === 'url' ? cast.world.base : null;
  writeJson(join(runDir, 'cast.json'), cast);
  writeJson(join(runDir, 'scenario.json'), { ...castToScenario(cast), serverRoot, castPath, castSha256: sha256(readFileSync(castPath)), headless, worldUrl });
  log(`direct ${cast.name} → ${runDir}`);
  const print = (line) => process.stdout.write(line + '\n');

  // 0 preflight
  const { preflight, onboardingText } = await import('../../playtest.mjs');
  const pf = hooks?.preflight ?? await preflight({ serverRoot, ...(policy ? { scenario: policy.scenario } : {}) });
  writeJson(join(runDir, 'preflight.json'), pf);
  const pfOk = pf.ok || (a['force-machine'] && (policy ? pf.checks.providersOk : pf.checks.claude) && pf.allow?.allowed !== false);
  receipt(runDir, 0, 'preflight', { ok: !!pfOk, allow: pf.allow, machineOk: pf.checks.machineOk });
  if (!pfOk) { log('preflight failed', JSON.stringify(pf.checks)); return 2; }

  const mods = hooks?.modules ?? {};
  // A module given as null (a lifecycle whose observer check failed sets browser: null) stays off; undefined loads it.
  const pick = async (k, p) => (mods[k] !== undefined ? mods[k] : import(p));
  const provision = await pick('provision', '../../arena/provision.mjs');
  const seatMod = await pick('seat', '../../arena/seat.mjs');
  const owner = await pick('owner', '../../arena/owner.mjs');
  const truthMod = await pick('truth', '../../observer/world-truth.mjs');
  const evidence = await pick('evidence', '../../observer/evidence.mjs');
  // The observer browser is optional, as in playtest.mjs loadModules: an import failure (#633) plays without cameras.
  const browserMod = await pick('browser', '../../observer/browser.mjs').catch((e) => { log(`observer browser unavailable: ${String(e.message).split('\n')[0]}`); return null; });
  const swarmTruth = mods.swarmTruth ?? worldTruth;

  let world = null, browser = null, sw = null, consoleIn = null; const seats = {}; const cameras = {};
  let code = 0;
  let onAbort = null;
  try {
    // 1 world
    checkAbort('provision');
    if (worldUrl) { world = { kind: 'url', base: worldUrl, startedAt: new Date().toISOString() }; }
    else {
      const slug = cast.world.slug ?? `pt-${cast.name}`.slice(0, 31);
      world = await provision.startWorld({ serverRoot, slug, port: cast.world.port, genesis: join(serverRoot, cast.world.genesis), dataDir: join(runDir, 'server', 'data'), log: join(runDir, 'server', 'world.log'), fresh: true, natives: cast.world.natives === true, onSpawn: (child) => own('world', slug, () => provision.stopWorld({ pid: child.pid }), { pid: child.pid, port: cast.world.port, dataDir: join(runDir, 'server', 'data') }) });
      try { world = { ...world, ...(await provision.describeWorld({ base: world.base, slug, port: cast.world.port, pid: world.pid, build: world.build, startedAt: new Date().toISOString() })) }; } catch (e) { log('describeWorld failed', e.message); }
    }
    writeJson(join(runDir, 'world.json'), { ...world, child: undefined, healthz: undefined });
    try { writeJson(join(runDir, 'server', 'healthz-before.json'), await provision.healthz(world.base)); } catch { /* recorded as missing */ }
    receipt(runDir, 1, 'provision', { ok: true, base: world.base, build: world.build ?? null, kind: worldUrl ? 'url' : 'dev' });
    if (hooks?.afterProvision) { checkAbort('setup'); await hooks.afterProvision({ world, runDir }); }

    // 2 seats: created now, onboarded in parallel while the planner writes the directions
    const codexHere = (() => { try { return spawnSync('codex', ['--version'], { stdio: 'ignore', timeout: 10000 }).status === 0; } catch { return false; } })();
    for (const s0 of cast.seats) {
      checkAbort(`seat ${s0.id}`);
      let s = { ...s0, persona: null };
      if (s.adapter === 'codex-headless' && !codexHere) { s = { ...s, adapter: 'claude-headless', model: process.env.PLAYTEST_CODEX_SUBSTITUTE_MODEL ?? 'sonnet', wake: true, substitutedFrom: `codex-headless/${s0.model ?? 'default'}` }; log(`seat ${s.id}: codex not installed; played by claude-headless/${s.model}`); }
      const seat = await seatMod.createSeat({ runDir, seat: s, worldBase: world.base, serverRoot, rails: cast.rails });
      own('controller', s.id, () => seat.stop(), { dir: seat.dir ?? null, adapter: s.adapter ?? 'claude-headless', model: s.model ?? null });
      if (s.substitutedFrom) { seat.info.substitutedFrom = s.substitutedFrom; seat.save?.(); }
      seat.onboarding = true; seats[s.id] = seat;
    }
    receipt(runDir, 2, 'seats', { ok: true, seats: Object.values(seats).map(infoOf), onboarding: 'parallel, during play' });

    // cameras: one wide now, a follow camera per seat once it is paired
    const vpRaw = cast.observer.viewport; const vp = Array.isArray(vpRaw) ? { width: vpRaw[0], height: vpRaw[1] } : vpRaw;
    if (browserMod) { try { checkAbort('browser'); browser = await browserMod.openBrowser({ headless: true, gpu: cast.observer.gpu ?? 'metal', serverRoot }); own('browser', 'observer', () => browser.close(), { gpu: browser.gpu ?? null }); } catch (e) { if (e.code === 'RUN_CANCELLED') throw e; log(`browser failed: ${e.message}`); } }
    else log('observer browser unavailable: playing without cameras');
    const openCam = async (opts) => { if (!browser) return null; try { return await browser.openCamera({ ...opts, viewport: vp, dpr: cast.observer.dpr ?? 1, runDir, arrivalTimeoutMs: cast.observer.arrivalTimeoutMs ?? 180000 }); } catch (e) { log(`camera ${opts.name} failed: ${String(e.message).split('\n')[0]}`); return null; } };
    if (cast.observer.cameras.includes('wide')) openCam({ base: world.base, identity: null, kind: 'wide', name: 'wide' }).then((c) => { if (c) cameras.wide = c; });
    const followCam = (id) => { const i = infoOf(seats[id]); if (!cast.observer.cameras.includes('follow') || !i.soulId || cameras[id]) return; openCam({ base: world.base, identity: i.ownerIdentity, kind: 'follow', soulId: i.soulId, name: id }).then((c) => { if (c) cameras[id] = c; }); };

    const early = [];
    const notify = (id, ok, soul) => { if (!sw) { early.push([id, ok, soul]); return; } if (ok) sw.paired(id, soul); else sw.onboardFailed(id); };
    const onboardAll = pool(cast.order.map((id) => seats[id]).filter(Boolean), cast.rails.onboardConcurrency, async (seat) => {
      const i = infoOf(seat);
      try {
        const ob = await seat.onboard({ text: onboardingText(world.base, i.soulName), maxWallSec: cast.rails.onboardWallSec, timeoutSec: cast.rails.onboardTimeoutSec });
        seat.onboarding = false;
        log(`seat ${i.id}: ${ob.ok ? `paired ${ob.soulId}` : 'NOT PAIRED'}`);
        if (ob.ok) seat.wakeLoop?.();
        notify(i.id, ob.ok, ob.ok ? { id: ob.soulId, name: ob.soulName } : null);
      } catch (e) { seat.onboarding = false; log(`seat ${i.id} onboarding error: ${e.message}`); notify(i.id, false); }
    });

    // planner (the agent above the seats) while onboarding runs
    const plan = await makePlan({ cast, runDir, log });
    log(`plan: ${plan.source}${plan.model ? ` (${plan.model})` : ''}`);

    // 3 play
    const script = a.script ? parseScript(readFileSync(resolve(a.script), 'utf8')) : headless ? cast.console.script : [];
    const quotaCheck = policy && !policy.claude ? null : async () => quotaAllows(await quota(), { stopPct: cast.rails.quotaStopPct ?? 90 }).allowed;
    checkAbort('play');
    sw = createSwarm({ cast, runDir, seats, world, owner, truth: swarmTruth({ base: world.base }), plan, observer: { cameras, evidence, truth: truthMod }, script, print, quotaCheck, log: (m) => log(m) });
    sw.onPaired(followCam);
    // A lifecycle cancel during play ends the session the way the console's `end` does, so close and verdict still run.
    if (hooks?.signal) { onAbort = () => sw.end('lifecycle-cancel'); if (hooks.signal.aborted) onAbort(); else hooks.signal.addEventListener('abort', onAbort, { once: true }); }
    for (const [id, ok, soul] of early.splice(0)) notify(id, ok, soul);
    if (!headless) { consoleIn = stdinConsole((l) => sw.submit(l)); print('console: type to all, "<seat>: …", "redirect <seat>: …", "economy <seat|all> lean|normal|rich", pause, resume, status, end'); }
    const summary = await sw.run();
    consoleIn?.close();
    await within(onboardAll, 5000);
    receipt(runDir, 3, 'play', { ok: true, stoppedBy: summary.stopped, elapsedSec: summary.elapsedSec, phase: summary.phase, gateReason: summary.gateReason });
  } catch (e) {
    log('direct failed:', e.stack ?? e.message); code = 1;
    receipt(runDir, 9, 'failure', { ok: false, error: String(e.stack ?? e.message), ...(e.code ? { code: e.code } : {}) });
  } finally {
    if (onAbort) hooks.signal.removeEventListener?.('abort', onAbort);
    consoleIn?.close();
    const closed = { seats: [] };
    for (const seat of Object.values(seats)) { try { await within(seat.stop(), 300000); closed.seats.push(infoOf(seat)); } catch (e) { closed.seats.push({ error: e.message }); } }
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    try { if (world?.base) writeJson(join(runDir, 'server', 'healthz-after.json'), await provision.healthz(world.base)); } catch { /* recorded as missing */ }
    writeJson(join(runDir, 'close.json'), { ...now(), ...closed });
    receipt(runDir, 4, 'close', { ok: true });
    if (world?.pid && !a['keep-world']) { try { await provision.stopWorld(world); log('world stopped'); } catch (e) { log('world stop failed', e.message); } }
  }

  // verdict + stories (review and developer off)
  let verdict = null;
  try { verdict = verifyRun(runDir, cast); } catch (e) { log('verdict failed', e.message); }
  receipt(runDir, 5, 'review', { ok: true, skipped: 'direct sessions keep review off; run `playtest.mjs review <run>` to refer this one' });
  receipt(runDir, 6, 'develop', { ok: true, skipped: 'developer off' });
  try { const rep = await import('../../review/report.mjs'); rep.reportRun(runDir); } catch (e) { log('report failed', e.message); try { (await import('../../review/story.mjs')).writeStory(runDir); } catch (e2) { log('story failed', e2.message); } }
  try { writeFileSync(join(runDir, 'REPORT.md'), `${existsSync(join(runDir, 'director', 'VERDICT.md')) ? readFileSync(join(runDir, 'director', 'VERDICT.md'), 'utf8') + '\n---\n\n' : ''}${existsSync(join(runDir, 'REPORT.md')) ? readFileSync(join(runDir, 'REPORT.md'), 'utf8') : ''}`); } catch { /* keep the report */ }
  receipt(runDir, 7, 'report', { ok: true });
  const out = { ok: code === 0, runDir, pass: verdict?.pass ?? false, checks: verdict ? Object.fromEntries(Object.entries(verdict.checks).map(([k, v]) => [k, v.pass])) : null, story: existsSync(join(runDir, 'story.html')) ? join(runDir, 'story.html') : null, costUsd: verdict?.cost?.total?.costUsd ?? null };
  print(JSON.stringify(out));
  return code || (out.pass ? 0 : 4);
}
