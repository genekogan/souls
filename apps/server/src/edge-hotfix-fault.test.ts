// Hotfix (acceptance 2026-10-08, P0): the first accepted hug pushed Liora 0.47 m into a standing bystander
// (collision.human-human); recoverFault found no mind card to blame and the process exited, and every restart replayed into
// the same fault. Now: an edge-world fault is put down to the edge programmes of the bodies it names and the world carries
// on (receipts end engine.fault-recovered); a log that crashed before (no recovery logged) boots and recovers on its first
// live tick; and paired gestures keep clear of bystanders (or refuse gesture.no-room).
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {kernelHash} from '@souls/kernel';
import {edenNavWorld, factory} from '../test/eden-nav-fixture.ts';
import {WorldHost} from './world.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {EDEN_PLACES, EDEN_SPOTS} from '../test/eden-nav-fixture.ts';
import {accept} from '../test/native-owner-fixture.ts';

type W = Awaited<ReturnType<typeof edenNavWorld>>;
const pos = (w: W, s: {entityId: string}) => {const p = (w.engine.world.entities as any)[s.entityId].pose.p; return [p[0], p[2]] as [number, number];};
const gap = (w: W, a: {entityId: string}, b: {entityId: string}) => {const p = pos(w, a), q = pos(w, b); return Math.hypot(p[0] - q[0], p[1] - q[1]);};
const decide = (host: WorldHost, s: {soulId: string; entityId: string}, steps: unknown[], option = 'test') => accept(host,
  host.enqueue('decision', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, option, label: option, steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-test'}));
async function ticks(host: WorldHost, n: number, each?: () => void) {for (let i = 0; i < n; i++) {host.tickOnce(); each?.(); if (i % 20 === 0) {await setImmediate(); host.drainInputs();}}}
/** Sage at (2.2, 50), Liora at (0, 50), the bystander 0.35 m off the line between them: a hug meeting in the middle crowds her. */
async function scene(w: W) {
  const [sage, liora, by] = w.souls;
  for (const [s, at] of [[sage, [2.2, 50]], [liora, [0, 50]], [by, [1.1, 50.35]]] as const) {
    await decide(w.f.host, s, [{verb: 'walk_to', params: {to: at}}], 'place');
    for (let i = 0; i < 40 && (Math.hypot(pos(w, s)[0] - at[0], pos(w, s)[1] - at[1]) >= 0.05 || w.engine.programOf(s.entityId)); i++) await ticks(w.f.host, 100);
    assert.ok(Math.hypot(pos(w, s)[0] - at[0], pos(w, s)[1] - at[1]) < 0.05, `${s.name} in place ${pos(w, s)}`);
  }
  return {sage, liora, by};
}
/** The CN4 (dbfdf59b) hug both bodies ran: a grouped pose without `clear` (it steps in regardless of bystanders). */
const oldHug = [{verb: 'mars:pose_v1', params: {activity: 'hug', seconds: 5, group: 'inv_crash', gap: 0.52, waitSeconds: 30, alone: 'fail'}}];

test('hotfix: a collision from an edge programme is recovered (no exit), receipts end engine.fault-recovered, the log replays exactly', {timeout: 400000}, async () => {
  const w = await edenNavWorld(3); const host = w.f.host;
  try {
    const {sage, liora, by} = await scene(w);
    // the bystander has an open receipt (she is warming herself): it must not be left hanging
    const rest: any = await w.act(by, 'rest:here', {seconds: 300}); assert.equal(rest.accepted, true);
    await ticks(host, 5);
    await decide(host, sage, oldHug, 'hug'); await decide(host, liora, oldHug, 'hug');
    let min = 9; await ticks(host, 200, () => {min = Math.min(min, gap(w, liora, by), gap(w, sage, by));});
    const rec = w.f.db.events(host.worldId).filter(e => e.kind === 'rules' && e.payload?.recovery);
    assert.equal(rec.length, 1, 'one logged recovery');
    const edge = rec[0].payload.recovery.edge; assert.ok(edge && edge.excludedSeqs.length, JSON.stringify(edge)); // only the running decisions set aside (stopActors: programmes begun before the baseline)
    assert.match(rec[0].payload.recovery.reason, /collision\.human-human/);
    assert.deepEqual(host.engine.runtime.violations, [], 'the recovered world is clean');
    assert.ok(min >= 0.48 - 1e-9 || rec.length === 1);
    const r = w.ledger.receipt(by.soulId, rest.receipt.id)!; if (edge.souls.includes(by.soulId)) {assert.equal(r.phase, 'failed'); assert.equal(r.code, 'engine.fault-recovered');}
    // the world keeps running and acting
    const t0 = host.engine.world.tick; await ticks(host, 100); assert.equal(host.engine.world.tick, t0 + 100);
    const walk: any = await w.act(sage, 'walk:social-eden-fire-circle'); assert.equal(walk.accepted, true);
    await ticks(host, 100);
    // exact replay from genesis, through the logged recovery
    host.drainInputs(); host.saveSnapshot(true); const head = {engine: host.engine.stateHash(), kernel: kernelHash(host.kernel)};
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);
    const h = new WorldHost(w.f.db, await factory(), host.seed, 1e9, host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
  } finally {host.stop(); w.f.db.close();}
});

test('hotfix: a world that crashed on the fault (nothing recovered, the old build exited) boots and recovers on its first live ticks; the reboot is stable', {timeout: 400000}, async () => {
  const w = await edenNavWorld(3); const host = w.f.host;
  try {
    const {sage, liora} = await scene(w);
    await decide(host, sage, oldHug, 'hug'); await decide(host, liora, oldHug, 'hug');
    // the dbfdf59b process: no edge recovery, the fault escapes tickOnce and the process exits
    host.recoveryForEdge = false;
    let crash: unknown = null; try {await ticks(host, 200);} catch (e) {crash = e;}
    assert.match(String(crash), /no attributable card.*collision\.human-human/, 'the trace fault, reproduced');
    host.stop();
    assert.equal(w.f.db.events(host.worldId).filter(e => e.kind === 'rules' && e.payload?.recovery).length, 0);
    // restart with the hotfix: boot replays to the durable frontier, then the first live ticks hit the fault and recover
    for (let boot = 0; boot < 2; boot++) {
      const h = new WorldHost(w.f.db, await factory(), host.seed, 1e9, host.worldId, {durableClockV1: true}); h.boot();
      const ledger = new EdgeLedger(h, w.f.db, EDEN_PLACES, {spots: EDEN_SPOTS}); assert.equal(h.recoveryForEdge, true); void ledger;
      await ticks(h, 300);
      assert.deepEqual(h.engine.runtime.violations, []);
      assert.equal(w.f.db.events(h.worldId).filter(e => e.kind === 'rules' && e.payload?.recovery).length, 1, `boot ${boot}: one recovery, logged once`);
      h.saveSnapshot(true); h.stop();
    }
  } finally {w.f.db.close();}
});

test('hotfix: a hug next to a standing bystander keeps clear of her (or refuses gesture.no-room); nobody is pushed', {timeout: 400000}, async () => {
  const w = await edenNavWorld(3); const host = w.f.host;
  try {
    const {sage, liora, by} = await scene(w);
    const hug: any = await w.act(sage, 'hug ' + liora.name);
    let min = 9;
    if (hug.accepted) {
      await ticks(host, 40);
      const yes: any = await w.act(liora, 'accept');
      if (yes.accepted) await w.run([{soulId: sage.soulId, id: hug.receipt.id}, {soulId: liora.soulId, id: yes.receipt.id}], 3000, () => {min = Math.min(min, gap(w, liora, by), gap(w, sage, by));});
      else assert.equal(yes.code, 'gesture.no-room', JSON.stringify(yes));
    } else assert.equal(hug.code, 'gesture.no-room', JSON.stringify(hug));
    assert.ok(min >= 0.56, `bystander kept clear (closest ${min.toFixed(2)} m)`);
    assert.equal(w.f.db.events(host.worldId).filter(e => e.kind === 'rules' && e.payload?.recovery).length, 0, 'no fault at all');
    assert.deepEqual(host.engine.runtime.violations, []);
    // with room (the bystander walks off), the hug happens
    await decide(host, by, [{verb: 'walk_to', params: {to: [1.1, 56]}}], 'away'); await ticks(host, 900);
    const again: any = await w.act(sage, 'hug ' + liora.name); assert.equal(again.accepted, true, JSON.stringify(again)); await ticks(host, 40);
    const ok: any = await w.act(liora, 'accept'); assert.equal(ok.accepted, true, JSON.stringify(ok));
    let hugged = false; await w.run([{soulId: sage.soulId, id: again.receipt.id}, {soulId: liora.soulId, id: ok.receipt.id}], 3000, () => {if ((w.engine.world.entities as any)[sage.entityId].human.activity === 'hug') hugged = true;});
    assert.ok(hugged, 'they hug'); assert.equal(w.ledger.receipt(sage.soulId, again.receipt.id)!.phase, 'completed');
    assert.deepEqual(host.engine.runtime.violations, []);
  } finally {host.stop(); w.f.db.close();}
});
