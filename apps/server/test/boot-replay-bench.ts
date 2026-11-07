// Lane L5 (server reliability, fast boot): how long a boot after SIGKILL replays, on Eden 2026 in memory.
// Boots the eden-2026 template the way main.ts does (bootEden), adds Souls that keep walking, snapshots, runs N live
// ticks (the replay debt a SIGKILL leaves), then cold-boots a second host on the same database and times restore and
// replay, and checks the replayed world equals the live one (engine, physical and kernel hashes at the same tick).
//   node apps/server/test/boot-replay-bench.ts [--souls 6] [--ticks 1200] [--json out.json] [--prof]
// INDICATIVE on the laptop; the numbers to quote come from the eden2 bench (L6).
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { kernelHash } from '@souls/kernel';
import { bootEden } from './eden-capabilities-timing.ts';
import { accept, invite, factory } from './native-owner-fixture.ts';
import { WorldHost } from '../src/world.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SOULS = Number(arg('--souls', '6')), TICKS = Number(arg('--ticks', '1200')), out = arg('--json', '');
// --debt-ms N [--gap-ms M]: run the live world with the adaptive snapshot cadence (main.ts defaults 3000 / 30000)
const DEBT = Number(arg('--debt-ms', '0')), GAP = Number(arg('--gap-ms', '20000'));
// --pace: live ticks at the world's real 20 t/s (50 ms each) instead of flat out, so wall-clock floors admit real tick counts
const PACE = process.argv.includes('--pace');
// --walk-every N: every Soul walks again every N live ticks (default 400); small N puts inputs inside an in-flight sliced capture
const WALK_EVERY = Number(arg('--walk-every', '400'));
const log = (m: string) => console.error(`[bench] ${m}`);

const w = await bootEden(log);
const souls = [w.soul];
for (let i = 1; i < SOULS; i++) {
  const owner = `dev:b${i}`; await invite(w, `b${i}`);
  const row = await accept(w.host, w.souls.create(owner, { name: `B${i}`, description: 'walker' })) as { id: string; entity_id: string; name: string; owner: string };
  souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
}
await w.settle(3);
type Cap = { verb: string; available?: boolean; id: string; target?: { kind?: string; id?: string } };
let k = 0;
const walkAll = async () => {
  for (const s of souls) {
    const caps = (w.edge.capabilities(s) as Cap[]).filter((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (!caps.length) continue;
    try { await accept(w.host, Promise.resolve(w.edge.act(s, { capability: caps[(k++ * 7) % caps.length].id }))); } catch { /* a refused walk is not the point */ }
  }
};
await walkAll(); await w.settle(5);
const snap = w.host.saveSnapshot(true);
log(`snapshot at tick ${snap.tick} (${SOULS} Souls), running ${TICKS} live ticks`);
const tickMs: number[] = [];
w.host.snapshotDebtMs = DEBT; w.host.snapshotMinGapMs = GAP;
const captures: { tick: number; atMs: number; costMs: number; capture: number; finish: number; serialize: number; persist: number }[] = [];
let lastCost = w.host.lastSnapshotCostMs;
const t0 = performance.now();
for (let i = 0; i < TICKS; i++) {
  if (i % WALK_EVERY === 0) await walkAll();
  const a = performance.now(); w.host.tickOnce(); tickMs.push(performance.now() - a);
  for (let j = 0; j < 4; j++) await new Promise((r) => setImmediate(r));   // let a sliced capture finish its stages
  if (PACE) { const due = t0 + (i + 1) * 50 - performance.now(); if (due > 0) await new Promise((r) => setTimeout(r, due)); }
  w.host.drainInputs();
  if (w.host.lastSnapshotCostMs !== lastCost) { lastCost = w.host.lastSnapshotCostMs; const m = w.host.snapshotMs;
    captures.push({ tick: w.host.lastSnapshotTick, atMs: Math.round(performance.now() - t0), costMs: +lastCost.toFixed(1), capture: +m.capture.toFixed(1), finish: +m.finish.toFixed(1), serialize: +m.serialize.toFixed(1), persist: +m.persist.toFixed(1) }); }
}
// a last logged input at the head, so a boot without a durable clock frontier replays to it
await walkAll(); w.host.tickOnce(); w.host.drainInputs();
const liveMs = performance.now() - t0;
const live = { tick: w.host.engine.world.tick, engine: w.host.engine.stateHash(), physical: w.host.engine.physicalHash(), kernel: kernelHash(w.host.kernel) };
w.host.stop();

const b = new WorldHost(w.db, factory, (w.host as unknown as { seed: string }).seed, 1e9, w.host.worldId);
// --after-replay N: the booted host snapshots on its first tick after a replay longer than N ticks (main.ts: 200)
b.snapshotAfterReplayTicks = Number(arg('--after-replay', '0'));
const prof = arg('--prof', '');   // a .cpuprofile path: profile the cold boot only
const session = prof ? new Session() : null;
if (session) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 200 }); await session.post('Profiler.start'); }
const bt = performance.now();
const booted = b.boot();
const bootMs = performance.now() - bt;
if (session) { const { profile } = await session.post('Profiler.stop'); writeFileSync(prof, JSON.stringify(profile)); session.disconnect(); }
const replayedTo = b.engine.world.tick;
while (b.engine.world.tick < live.tick) b.tickOnce();
const got = { tick: b.engine.world.tick, engine: b.engine.stateHash(), physical: b.engine.physicalHash(), kernel: kernelHash(b.kernel) };
const same = JSON.stringify(got) === JSON.stringify(live);
const differs = Object.keys(live).filter((key) => (got as Record<string, unknown>)[key] !== (live as Record<string, unknown>)[key]);
const sorted = [...tickMs].sort((x, y) => x - y), avg = tickMs.reduce((s, x) => s + x, 0) / tickMs.length;
const lastSnap = w.db.latestSnapshot(w.host.worldId)!.tick;
const gaps = captures.map((c, i) => c.atMs - (i ? captures[i - 1].atMs : 0)).slice(1);
// --every-snapshot: also boot from each older retained snapshot of the live run (newer ones deleted), so a bad
// intermediate capture shows up, not only the last one
const fromEach: { from: number; replayTicks: number; same: boolean; differs: string[] }[] = [];
const EACH = process.argv.includes('--every-snapshot');
b.stop();
if (EACH) {
  for (;;) {
    const top = w.db.latestSnapshot(w.host.worldId)!.tick;
    w.db.db.prepare('DELETE FROM snapshots WHERE world_id = ? AND tick = ?').run(w.host.worldId, top);
    const next = w.db.latestSnapshot(w.host.worldId)?.tick;
    if (next === undefined || next <= snap.tick) break;
    const c = new WorldHost(w.db, factory, (w.host as unknown as { seed: string }).seed, 1e9, w.host.worldId);
    c.boot(); const replayTicks = c.engine.world.tick - next;
    while (c.engine.world.tick < live.tick) c.tickOnce();
    const g = { tick: c.engine.world.tick, engine: c.engine.stateHash(), physical: c.engine.physicalHash(), kernel: kernelHash(c.kernel) };
    const d = Object.keys(live).filter((key) => (g as Record<string, unknown>)[key] !== (live as Record<string, unknown>)[key]);
    fromEach.push({ from: next, replayTicks, same: d.length === 0, differs: d }); c.stop();
  }
}
const result = { souls: SOULS, debtMs: DEBT, gapMs: GAP, paced: PACE, captures, maxCaptureGapTicks: captures.length > 1 ? Math.max(...captures.slice(1).map((c, i) => c.tick - captures[i].tick)) : null, captureShareMax: gaps.length ? +Math.max(...captures.slice(1).map((c, i) => c.costMs / gaps[i])).toFixed(4) : null, lastSnapshotTick: lastSnap, snapshotTick: snap.tick, liveTicks: TICKS, liveTickMsAvg: +avg.toFixed(2), liveTickMsP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
  liveMs: Math.round(liveMs), boot: { ...booted, ms: Math.round(bootMs), replayedTo, replayTicks: replayedTo - lastSnap, phases: b.bootStats ?? null }, sameAsLive: same, differs, fromEach };
console.log(JSON.stringify(result));
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
w.db.close();
if (!same || fromEach.some((f) => !f.same)) process.exitCode = 1;
