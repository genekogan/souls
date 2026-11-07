// #1150: the report on a real fault. Same scene as edge-hotfix-fault.test.ts: a hug that crowds a bystander breaks
// collision.human-human, a real edge recovery repairs it, and that recovery is reported once, also after a replay from genesis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {edenNavWorld, factory} from '../test/eden-nav-fixture.ts';
import {accept} from '../test/native-owner-fixture.ts';
import {rowsOf} from '../test/glitch-rows.ts';
import {WorldHost} from './world.ts';

type W = Awaited<ReturnType<typeof edenNavWorld>>;
const pos = (w: W, s: {entityId: string}) => {const p = (w.engine.world.entities as any)[s.entityId].pose.p; return [p[0], p[2]] as [number, number];};
const decide = (host: WorldHost, s: {soulId: string; entityId: string}, steps: unknown[], option = 'test') => accept(host,
  host.enqueue('decision', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, option, label: option, steps, reevalTicks: 1e9, fallback: false, trigger: 'edge-test'}));
async function ticks(host: WorldHost, n: number) {for (let i = 0; i < n; i++) {host.tickOnce(); if (i % 20 === 0) {await setImmediate(); host.drainInputs();}}}
const hug = [{verb: 'mars:pose_v1', params: {activity: 'hug', seconds: 5, group: 'inv_crash', gap: 0.52, waitSeconds: 30, alone: 'fail'}}];

test('a real collision: one recovery, one record naming the rule, the bodies and the logged recipe; a replay from genesis adds none', {timeout: 400000}, async t => {
  const lines: string[] = [], warn = console.warn; t.mock.method(console, 'warn', (...a: unknown[]) => {const s = a.map(String).join(' '); if (s.startsWith('[world] glitch')) lines.push(s); else warn(...a);});
  const w = await edenNavWorld(3), host = w.f.host;
  try {
    const [sage, liora, by] = w.souls;
    for (const [s, at] of [[sage, [2.2, 50]], [liora, [0, 50]], [by, [1.1, 50.35]]] as const) {
      await decide(host, s, [{verb: 'walk_to', params: {to: at}}], 'place');
      for (let i = 0; i < 40 && (Math.hypot(pos(w, s)[0] - at[0], pos(w, s)[1] - at[1]) >= 0.05 || w.engine.programOf(s.entityId)); i++) await ticks(host, 100);
    }
    assert.deepEqual(host.glitches, {total: 0, byRule: {}}, 'nothing yet');
    await decide(host, sage, hug, 'hug'); await decide(host, liora, hug, 'hug');
    await ticks(host, 200);
    const rec = w.f.db.events(host.worldId).filter(e => e.kind === 'rules' && e.payload?.recovery);
    assert.equal(rec.length, 1, 'one logged recovery');
    assert.deepEqual(host.glitches, {total: 1, byRule: {'collision.human-human': {recovery: 1}}});
    const rows = rowsOf(w.f.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rung, 'recovery'); assert.equal(rows[0].rule, 'collision.human-human');
    assert.ok(rows[0].bodies.length >= 2 && rows[0].bodies.every(b => (w.engine.world.entities as any)[b]), JSON.stringify(rows[0].bodies));
    assert.equal(rows[0].evidence.seq, rec[0].seq, 'names the logged recipe');
    assert.deepEqual(rows[0].evidence.excludedSeqs, rec[0].payload.recovery.edge.excludedSeqs);
    assert.deepEqual(lines, [`[world] glitch rung=recovery rule=collision.human-human tick=${rows[0].tick} seq=${rec[0].seq} bodies=${rows[0].bodies.join(',')}`]);
    host.drainInputs(); host.saveSnapshot(true); const hash = host.engine.stateHash();
    w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);
    const h = new WorldHost(w.f.db, await factory(), host.seed, 1e9, host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
    assert.equal(h.engine.stateHash(), hash, 'the record is outside the log: replay reaches the same state');
    assert.deepEqual(h.glitches, {total: 1, byRule: {'collision.human-human': {recovery: 1}}}); assert.equal(rowsOf(w.f.db).length, 1);
    h.stop();
  } finally {host.stop(); w.f.db.close();}
});
