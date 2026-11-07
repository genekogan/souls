// nav-connect/1 (lane NAV, 2026-10-20): no god edit leaves a Soul unable to walk. An edit that closes a Soul into a
// pocket steps it to open ground (a logged edge-relocate the replay folds); things the edit leaves with no walk to them
// are named to the god in one line; a big separate area (an island, a walled quarter) is a place, not a trap.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { coreRef } from '@souls/world-compiler';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => 1_000_000, emit() {} });
  const edge = new EdgeLedger(w.host, w.db); installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'builder'); god.godIdentity(token);
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  return { ...w, god, settle, ledger: edge, E: w.host.engine as any };
}
const box = (name: string, x: number, z: number) => ({ schema: 'def/1', name, version: 1, layer: 'solid', size: { box: [x, 3, z] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1.5, 0], size: [x, 3, z] }] } } });
/** Four walls round c, inner side `s` m: the east/west walls are long, the north/south ones stop 5 cm short of them
 *  (solids may not overlap; no gap a body fits through). Defines its own two wall defs. */
function ring(c: [number, number], s: number, tag: string) {
  const h = s / 2 + 0.5;
  return [{ op: 'define', def: box(`${tag}long`, s + 2, 1) }, { op: 'define', def: box(`${tag}short`, s - 0.1, 1) },
    { op: 'place', def: `${tag}short@1`, name: `${tag}n`, p: [c[0], c[1] + h] }, { op: 'place', def: `${tag}short@1`, name: `${tag}s`, p: [c[0], c[1] - h] },
    { op: 'place', def: `${tag}long@1`, name: `${tag}e`, p: [c[0] + h, c[1]], r: Math.PI / 2 }, { op: 'place', def: `${tag}long@1`, name: `${tag}w`, p: [c[0] - h, c[1]], r: Math.PI / 2 }];
}

test('walls built round a Soul: it steps to open ground (logged, nav-connect/1) and the god hears of it once', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'ana'); const row: any = await accept(w.host, w.souls.create('dev:ana', { name: 'Ana', description: 'curious' })); await w.settle(8);
  // away from the arrival point (the main area is the one holding it)
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 20, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  const crate = box('crate', 0.6, 0.6);
  const r0: any = w.god.act({ ops: [{ op: 'define', def: crate }, { op: 'place', def: 'crate@1', name: 'crate', p: [at[0] + 2, at[1] + 2] }] });
  assert.equal(r0.accepted, true, JSON.stringify(r0.failures)); await w.settle(2);
  assert.equal(w.E.navCheckV1([{ id: 'ana', p: at, level: 0 }])[0].ok, true, 'open ground before');
  const r: any = w.god.act({ ops: ring(at, 7, 'r') });
  assert.equal(r.accepted, true, JSON.stringify(r.failures));
  assert.ok(r.warnings.some((x: string) => /^1 Soul cut off by this edit stepped to open ground nearby\.$/.test(x)), JSON.stringify(r.warnings));
  // buildsafe/1 names the crate at once, with a tested fix op; nav-connect/1 does not name it again
  const named = r.warnings.filter((x: string) => /\bcrate\b/.test(x) && x.startsWith('No walk reaches'));
  assert.equal(named.length, 1, JSON.stringify(r.warnings)); assert.match(named[0], /\(buildsafe\/1\).*fix: \{"op":"move"/);
  await w.settle(3);
  const p = w.host.engine.world.entities[row.entity_id]!.pose.p;
  assert.ok(Math.max(Math.abs(p[0] - at[0]), Math.abs(p[2] - at[1])) > 4.5, `outside the walls: ${p}`);
  assert.equal(w.E.navCheckV1([{ id: 'ana', p: [p[0], p[2]], level: 0 }])[0].ok, true, 'on the main area now');
  const ev = w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1');
  assert.equal(ev.length, 1, 'one logged step'); assert.ok(Array.isArray(ev[0].payload.to) && /nav-connect\/1/.test(ev[0].payload.why));
  // an edit near the same pocket names the crate no more (said once), and moves nobody
  const again: any = w.god.act({ ops: [{ op: 'place', def: 'crate@1', name: 'crate2', p: [at[0] + 6, at[1] + 6] }] });
  assert.equal(again.warnings.some((x: string) => x.startsWith('No walk reaches') || /Soul/.test(x)), false, JSON.stringify(again.warnings));
  // ... and more edits round it never move it again (it stands on open ground; at most once a minute in any case)
  for (let i = 0; i < 5; i++) assert.equal((w.god.act({ ops: [{ op: 'place', def: 'crate@1', name: `crate-x${i}`, p: [at[0] - 8, at[1] - 6 + 2 * i] }] }) as any).warnings.some((x: string) => /Soul/.test(x)), false);
  assert.equal(w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1').length, 1, 'still one logged step');
});

/** A Soul sat on a core bench 2 m from `at` (it walks to the seat and sits). Returns the bench's engine id. */
async function seat(w: ReturnType<typeof world>, entityId: string, at: [number, number], name = 'bench') {
  const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name, p: [at[0] + 2, at[1]] }] }); assert.equal(r.accepted, true, JSON.stringify(r.failures)); await w.settle(3);
  const id = w.god.model.get(name)!.id; assert.ok(w.host.engine.world.entities[id], 'the bench is an engine fixture');
  const s = w.E.submit('sit', { actor: entityId, fixture: id }); assert.notEqual(s.status, 'failed', JSON.stringify(s));
  for (let i = 0; i < 400 && w.host.engine.world.entities[entityId]!.human!.activity !== 'sit'; i++) w.host.tickOnce();
  await w.settle(2); assert.equal(w.host.engine.world.entities[entityId]!.human!.activity, 'sit', 'seated');
  return id;
}
const navSteps = (w: ReturnType<typeof world>) => w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1');

test('a Soul seated on a bench beside open ground: 20 edits round it move nobody and tell the god nothing (R21, 3.59.4)', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'dee'); const row: any = await accept(w.host, w.souls.create('dev:dee', { name: 'Dee', description: 'calm' })); await w.settle(8);
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  await seat(w, row.entity_id, at);
  const sat = [...w.host.engine.world.entities[row.entity_id]!.pose.p];
  assert.equal(w.E.navRescueV1(row.entity_id, Infinity), null, 'judged at its seat\'s standing approach: connected');
  assert.equal((w.god.act({ ops: [{ op: 'define', def: box('crate', 0.6, 0.6) }] }) as any).accepted, true);
  for (let i = 0; i < 20; i++) {
    const r: any = w.god.act({ ops: [{ op: 'place', def: 'crate@1', name: `c${i}`, p: [at[0] - 6 + (i % 5) * 1.5, at[1] - 8 + Math.floor(i / 5) * 1.5] }] });
    assert.equal(r.accepted, true, JSON.stringify(r.failures));
    assert.equal(r.warnings.some((x: string) => /Soul/.test(x)), false, `edit ${i}: ${JSON.stringify(r.warnings)}`);
    w.host.tickOnce(); await setImmediate(); w.host.drainInputs();
  }
  await w.settle(6);
  assert.equal(navSteps(w).length, 0, 'no edge-relocate');
  const h = w.host.engine.world.entities[row.entity_id]!; assert.equal(h.human!.activity, 'sit', 'still seated'); assert.deepEqual(h.pose.p, sat);
});

// Decided: a seated Soul whose seat is walled in stands up and steps to open ground once (a god walk-out, as when a god
// edit lands on it), with one line to the god; staying seated would leave it shut in, since every later walk from the
// seat's approach is refused.
test('a seated Soul whose bench gets walled in stands up and steps to open ground, once, with one note', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'eve'); const row: any = await accept(w.host, w.souls.create('dev:eve', { name: 'Eve', description: 'calm' })); await w.settle(8);
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  await seat(w, row.entity_id, at);
  const c: [number, number] = [at[0] + 2, at[1]];
  const r: any = w.god.act({ ops: ring(c, 7, 'w') }); assert.equal(r.accepted, true, JSON.stringify(r.failures));
  assert.equal(r.warnings.filter((x: string) => /^1 Soul cut off by this edit stepped to open ground nearby\.$/.test(x)).length, 1, JSON.stringify(r.warnings));
  await w.settle(4);
  const ev = navSteps(w); assert.equal(ev.length, 1, 'one logged step'); assert.equal(ev[0].payload.godWalkout, true); assert.match(ev[0].payload.why, /sat in a closed-off .*stood up and stepped/);
  const h = w.host.engine.world.entities[row.entity_id]!, p = h.pose.p;
  assert.notEqual(h.human!.activity, 'sit', 'stood up');
  assert.ok(Math.max(Math.abs(p[0] - c[0]), Math.abs(p[2] - c[1])) > 4.5, `outside the walls: ${p}`);
  assert.equal(w.E.navCheckV1([{ id: 'eve', p: [p[0], p[2]], level: 0 }])[0].ok, true, 'on the main area now');
  for (let i = 0; i < 5; i++) assert.equal((w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: `b${i}`, p: [c[0] - 9, c[1] - 6 + 2.5 * i] }] }) as any).warnings.some((x: string) => /Soul/.test(x)), false);
  await w.settle(2); assert.equal(navSteps(w).length, 1, 'still one');
});

test('a door shut on a Soul in a walled yard: it steps out, as for a wall (a door state edit is checked too)', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'bo'); const row: any = await accept(w.host, w.souls.create('dev:bo', { name: 'Bo', description: 'quiet' })); await w.settle(8);
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 20, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, [x, z] = [b.pose.p[0], b.pose.p[2]];
  const yard: any = w.god.act({ ops: [
    { op: 'place', def: coreRef('garden-wall'), name: 'yard', shape: { path: [[x - 0.6, z - 3], [x - 4, z - 3], [x - 4, z + 3], [x + 4, z + 3], [x + 4, z - 3], [x + 0.6, z - 3]] } },
    { op: 'place', def: coreRef('door'), name: 'yard-door', p: [x, z - 3], state: { open: true } }] });
  assert.equal(yard.accepted, true, JSON.stringify(yard.failures)); await w.settle(3);
  assert.equal(w.E.navCheckV1([{ id: 'bo', p: [x, z], level: 0 }])[0].ok, true, 'door open: Bo can walk out');
  const shut: any = w.god.act({ ops: [{ op: 'set', id: w.god.model.get('yard-door')!.id, state: { open: false } }] });
  assert.equal(shut.accepted, true, JSON.stringify(shut.failures));
  assert.ok(shut.warnings.some((x: string) => /^1 Soul cut off by this edit stepped to open ground nearby\.$/.test(x)), JSON.stringify(shut.warnings));
  await w.settle(3);
  const p = w.host.engine.world.entities[row.entity_id]!.pose.p;
  assert.equal(w.E.navCheckV1([{ id: 'bo', p: [p[0], p[2]], level: 0 }])[0].ok, true, 'out on the main area');
});

test('walls round a thing far from any Soul: the reply stays fast ("pending"), the note rides on the next reply, once', async t => {
  const w = world(t); await w.settle(1);
  for (let i = 0; i < 40; i++) { w.host.tickOnce(); await setImmediate(); } // labels warm
  const c: [number, number] = [20, 20];
  assert.equal((w.god.act({ ops: [{ op: 'define', def: box('chest', 0.6, 0.6) }, { op: 'place', def: 'chest@1', name: 'chest', p: c }] }) as any).accepted, true); await w.settle(6);
  // buildsafe/1 sees the chest cut off on the edit's own raster and names it in this reply; nav-connect/1's pending
  // note on the next reply leaves it out (said once)
  const r: any = w.god.act({ ops: ring(c, 5, 'q') }); assert.equal(r.accepted, true, JSON.stringify(r.failures));
  const named = r.warnings.filter((x: string) => x.startsWith('No walk reaches'));
  assert.equal(named.length, 1, JSON.stringify(r.warnings)); assert.match(named[0], /\bchest\b.*\(buildsafe\/1\)/);
  await w.settle(12);
  const next: any = w.god.act({ ops: [{ op: 'place', def: 'chest@1', name: 'chest2', p: [-20, -20] }] });
  assert.equal(next.warnings.some((x: string) => x.startsWith('No walk reaches') && /\bchest\b/.test(x)), false, JSON.stringify(next.warnings));
  await w.settle(12);
  const third: any = w.god.act({ ops: [{ op: 'place', def: 'chest@1', name: 'chest3', p: [-24, -20] }] });
  assert.equal(third.warnings.some((x: string) => x.startsWith('No walk reaches')), false, JSON.stringify(third.warnings));
});

test('the engine rescue target: a pocket gets one; open ground and an area above the size limit do not', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'ben'); const row: any = await accept(w.host, w.souls.create('dev:ben', { name: 'Ben', description: 'calm' })); await w.settle(8);
  // away from the arrival point (the main area is the one holding it); the fixture world is 60 m across
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  assert.equal(w.E.navRescueV1(row.entity_id), null, 'connected: no rescue');
  // the hook off, so the engine read alone is under test (as when the edit came from elsewhere)
  (w.god as any).bodies.navNote = undefined;
  const r: any = w.god.act({ ops: ring(at, 5, 'y') }); assert.equal(r.accepted, true, JSON.stringify(r.failures)); await w.settle(1);
  const v = w.E.navCheckV1([{ id: 'ben', p: at, level: 0 }])[0]; assert.equal(v.ok, false); assert.ok(v.pocket > 10 && v.pocket < 25, String(v.pocket));
  assert.equal(w.E.navRescueV1(row.entity_id, Infinity, 10), null, 'a separate area above the size limit is a place, not a trap');
  const res = w.E.navRescueV1(row.entity_id, Infinity);
  assert.ok(res && res.code === 'nav.disconnected' && res.level === 0, JSON.stringify(res));
  assert.ok(Math.hypot(res.to[0] - at[0], res.to[1] - at[1]) > 3, 'outside the walls');
  assert.equal(w.E.navCheckV1([{ id: 'to', p: res.to, level: 0 }])[0].ok, true, 'on the main area');
});

test('a Soul already cut off (an edit the hook did not see) steps out when its walk is refused, then walks', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'cy'); const row: any = await accept(w.host, w.souls.create('dev:cy', { name: 'Cy', description: 'calm' })); await w.settle(8);
  const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const at: [number, number] = [w.host.engine.world.entities[row.entity_id]!.pose.p[0], w.host.engine.world.entities[row.entity_id]!.pose.p[2]];
  const crate: any = w.god.act({ ops: [{ op: 'define', def: box('crate', 0.6, 0.6) }, { op: 'place', def: 'crate@1', name: 'crate', p: [at[0] - 20, at[1] + 5] }] }); assert.equal(crate.accepted, true);
  (w.god as any).bodies.navNote = undefined;
  const r: any = w.god.act({ ops: ring(at, 5, 'z') }); assert.equal(r.accepted, true, JSON.stringify(r.failures)); await w.settle(3);
  assert.equal(w.E.navCheckV1([{ id: 'cy', p: at, level: 0 }])[0].ok, false, 'cut off');
  const out: any = await accept(w.host, w.ledger.act(s as any, { capability: 'walk:crate' }));
  assert.equal(out.accepted, true, JSON.stringify(out));
  const ev = w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1');
  assert.equal(ev.length, 1, 'one logged step out'); assert.match(ev[0].payload.why, /nav-connect\/1: stood cut off \(nav\.disconnected\)/);
});
