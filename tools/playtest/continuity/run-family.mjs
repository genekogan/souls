#!/usr/bin/env node
// One continuity family from a fresh clone, with one command and no model (#487). A local fake-mind hello-hamlet world, one
// managed Soul on the real launcher and controller with a model-free host, and one unlaunched body beside it. Partway the
// controller is killed with SIGKILL; the launcher must bring it back on the same journal and thread with no write repeated.
// This proves the driver and the recovery path. It qualifies nothing about agent behaviour.
//   node tools/playtest/continuity/run-family.mjs [--out .local/continuity-1] [--port <n>] [--seconds 60] [--force-failure]
// Exit 0 is a pass, 1 a failed run, 2 a checkout that isn't set up. report.json stays local; export.json is what may leave.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { startWorld, stopWorld } from '../arena/provision.mjs';
import { superviseProcess } from '../../soul-runtime/launch.mjs';
import { readControllerSnapshot } from '../../soul-runtime/controller-ownership.mjs';
import { createWorldClient } from '../../soul-runtime/world-client.mjs';
import { attentionPriority } from '../../soul-runtime/supervisor.mjs';
import { createProcessWatch, drift, exportReport, firstMoved, idleBracket, staleReads, verdict } from './lib.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms, code) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await check(); if (v) return v; } throw Object.assign(Error(code), { code }); };
const freePort = () => new Promise((ok, no) => { const s = createServer().once('error', no).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const listening = (port) => new Promise((ok) => { const c = connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); ok(true); }); c.once('error', () => ok(false)); });

/** A folder paired to one new Soul, through the same CLI an owner uses. */
async function pairedSoul(folder, name, base) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, '.eden-agent.json'), JSON.stringify({ identity: `agent-${randomBytes(12).toString('hex')}` }) + '\n', { mode: 0o600 });
  copyFileSync(join(root, 'tools/world-launcher/soul/eden.mjs'), join(folder, 'eden.mjs'));
  const eden = (...args) => new Promise((done, fail) => execFile(process.execPath, ['eden.mjs', ...args], { cwd: folder, timeout: 120_000 }, (e, stdout) => (e ? fail(Object.assign(Error('EDEN_CLI_FAILED'), { code: 'EDEN_CLI_FAILED' })) : done(stdout))));
  await eden('register', base); await eden('create', name);
  const paired = JSON.parse(readFileSync(join(folder, '.eden-agent.json'), 'utf8'));
  if (!paired.world || !paired.soul || !paired.token) throw Object.assign(Error('PAIRING_INCOMPLETE'), { code: 'PAIRING_INCOMPLETE' });
  return paired;
}
/** Each world row a Soul spoke, read after the world has stopped. */
function spokenBy(dataDir, soulId) {
  const db = new DatabaseSync(join(dataDir, 'sim.db'), { readOnly: true });
  try { return db.prepare('SELECT text, at FROM edge_comms_speech WHERE soul_id=?').all(soulId); } finally { db.close(); }
}
/**
 * Facts about one Soul in another's journal, and how many the runtime's own rule would wake on (#475): under the scope the
 * Soul really has, and under `nearby`, because a salience 1 presence fact only wakes a Soul that listens for it.
 */
function factsAbout(journalPath, soulId) {
  const db = new DatabaseSync(journalPath, { readOnly: true });
  try {
    const facts = db.prepare('SELECT source, payload FROM events').all().map((r) => ({ source: r.source, event: JSON.parse(r.payload) })).filter((f) => f.event.about?.soulId === soulId);
    const listenTo = JSON.parse(db.prepare('SELECT payload FROM checkpoint WHERE singleton=1').get().payload).listenTo ?? [];
    const waking = (scope) => facts.filter((f) => attentionPriority(f, scope) >= 1).length;
    return { facts: facts.length, wakeEligible: waking(listenTo), wakeEligibleNearby: waking('nearby') };
  } finally { db.close(); }
}

export async function runFamily({ out, port, seconds = 60, forceFailure = false }) {
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const report = { schema: 'continuity-family/1', family: 'restart', pass: false, failure: null, forcedFailure: forceFailure, startedAt: new Date().toISOString() };
  const watch = createProcessWatch(), stop = new AbortController(), samples = [], controllers = [];
  const noting = setInterval(() => { try { watch.note(); } catch { /* the next tick tries again */ } }, 1000);
  const began = Date.now();
  let world = null, supervised = null, sampling = null, paired = null, stateDir = null, killedAt = null;
  try {
    world = await startWorld({ serverRoot: root, slug: 'continuity', port, genesis: 'worlds/templates/hello-hamlet.json', dataDir: join(out, 'data'), log: join(out, 'world.log') });
    const base = `http://127.0.0.1:${port}/w/continuity`;
    // The placed body comes first, so the managed Soul's arrival is what could disturb it (#475).
    const placed = await pairedSoul(join(out, 'placed'), 'Placed', base);
    paired = await pairedSoul(join(out, 'managed'), 'Keeper', base);
    const placedClient = createWorldClient({ world: placed.world, token: placed.token, expectedSoulId: placed.soul, timeoutMs: 10000 });
    sampling = (async () => {
      while (!stop.signal.aborted) {
        const requestedAt = Date.now();
        try { const here = (await placedClient.read('here', { view: 'body' }, stop.signal)).here; samples.push({ requestedAt, receivedAt: Date.now(), tick: here.tick, activity: here.me?.activity?.kind ?? null, pos: here.me?.pos ?? null }); } catch { /* a missed sample is a gap, and the count shows it */ }
        await sleep(1000);
      }
    })();
    stateDir = join(out, 'managed/.soul-runtime');
    const journalPath = join(stateDir, 'continuity.sqlite'), instruction = join(out, 'instruction.txt');
    writeFileSync(instruction, 'Keep saying short beats until the run ends.\n', { mode: 0o600 });
    const args = ['--folder', join(out, 'managed'), '--state', stateDir, '--instruction', instruction, '--model', 'model-free', '--session-name', 'continuity-family'];
    supervised = superviseProcess({ args, seconds: seconds + 120, signal: stop.signal, ownershipDirectory: stateDir, script: fileURLToPath(new URL('./fake-controller.mjs', import.meta.url)), onState: (s) => { if (s.state === 'controller-started') controllers.push(s.pid); } });
    supervised.catch(() => {});
    const snapshot = () => { try { return readControllerSnapshot(journalPath); } catch { return null; } };
    const before = await until(() => { const s = snapshot(); return s?.threadId && s.revision > 0 && controllers.length ? s : null; }, 30_000, 'NO_FIRST_CHECKPOINT');
    watch.note();
    if (forceFailure) throw Object.assign(Error('FORCED_FAILURE'), { code: 'FORCED_FAILURE' });
    // Prefer to kill with a write in flight, the case a duplicate would come from. If none shows up in time, kill anyway.
    const open = await until(() => (snapshot()?.operations.length ? true : null), 10_000, 'NO_OPEN_OPERATION').catch(() => false);
    const last = snapshot() ?? before;
    killedAt = Date.now(); process.kill(controllers.at(-1), 'SIGKILL');
    const after = await until(() => { const s = snapshot(); return s && s.generation > last.generation ? s : null; }, 45_000, 'NO_RECOVERY');
    const recoveryMs = Date.now() - killedAt;
    await sleep(Math.max(8000, began + seconds * 1000 - Date.now())); // at least long enough for a write after the restart
    report.restart = { journalSame: after.journalIdentity === before.journalIdentity, threadSame: after.threadId === before.threadId, generationBefore: last.generation, generationAfter: after.generation, killedWithOpenOperation: open, recoveryMs };
    const [from, to] = [samples[0]?.requestedAt ?? 0, samples.at(-1)?.requestedAt ?? 0];
    report.reads = { samples: samples.length, stale: staleReads(samples).length, bracket: idleBracket(samples, { from, to }).status };
    const placedAt = samples.filter((s) => s.pos), moved = firstMoved(placedAt);
    report.placedBody = { samples: placedAt.length, driftMetres: drift(placedAt.map((s) => s.pos)), ...(moved ? { firstMovedSec: Math.round((moved.requestedAt - began) / 1000) } : {}), ...factsAbout(journalPath, placed.soul) };
  } catch (e) {
    report.failure = typeof e.code === 'string' ? e.code : 'RUN_FAILED';
  } finally {
    clearInterval(noting); try { watch.note(); } catch { /* the sweep works from what it has */ }
    stop.abort(); await Promise.allSettled([supervised, sampling].filter(Boolean));
    if (world) await stopWorld({ pid: world.pid });
    const survivors = await watch.sweep();
    report.cleanup = { listening: await listening(port), survivors: survivors.length };
  }
  if (!report.failure && paired) {
    const rows = spokenBy(join(out, 'data'), paired.soul), texts = rows.map((r) => r.text);
    report.effects = { spoken: rows.length, spokenAfterRestart: rows.filter((r) => Number(r.at) > killedAt).length, duplicates: texts.length - new Set(texts).size };
  }
  report.pass = verdict(report);
  report.endedAt = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1) + '\n', { mode: 0o600 });
  writeFileSync(join(out, 'export.json'), JSON.stringify(exportReport(report), null, 1) + '\n', { mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, port: { type: 'string' }, seconds: { type: 'string' }, 'force-failure': { type: 'boolean' } } });
  const missing = ['node_modules', 'apps/web/dist'].filter((p) => !existsSync(join(root, p)));
  if (missing.length) { console.error(`Not set up: ${missing.join(', ')} missing. Run: pnpm install --frozen-lockfile && pnpm assets:pull && pnpm --dir apps/web build`); process.exit(2); }
  const report = await runFamily({ out: resolve(values.out ?? `.local/continuity-${Date.now()}`), port: Number(values.port ?? await freePort()), seconds: Number(values.seconds ?? 60), forceFailure: values['force-failure'] === true });
  console.log(JSON.stringify(exportReport(report)));
  process.exit(report.pass ? 0 : 1);
}
