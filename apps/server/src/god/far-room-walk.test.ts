// F6 (SOULSIM-H, 2026-10-21): a Soul ~90 m from the bench-hamlet cottage asked for `walk:cottage/bedroom` was refused
// place.unwalkable (rooms are offered only within 80 m of their building), and "walk to the cottage bedroom" resolved to
// walk:cottage ("contains it"): the agent walked to the front door, then into the bedroom (~10 s detour). A far room asked
// for by id or by name now gets its one walk on demand, in at the building's front door: one act, one walk.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, factory, invite, accept } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { GroundHost } from './ground-host.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
const COTTAGE = { w: 8, d: 6, floors: 1, floorHeight: 2.8, style: 'cottage', roof: 'gable', roofPitch: 32, material: 'plaster', front: 's', porch: 0, balcony: false, windows: 0.6, wallThickness: 0.22 };
const inPoly = (x: number, z: number, poly: Vec2[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

async function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {} });
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const run = async (n: number) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } } };
  await invite(w, 'ada'); const row: any = await accept(w.host, w.souls.create('dev:ada', { name: 'Ada', description: 'curious' })); await settle(3);
  const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const pos = (): Vec2 => { const p = (w.host.engine.world as any).entities[s.entityId].pose.p; return [p[0], p[2]]; };
  // the cottage ~95 m east of wherever Ada arrived: within the building listing (150 m), beyond its rooms' (80 m)
  const at = pos(), r = god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'cottage', p: [Math.round(at[0] + 95), Math.round(at[1])], params: COTTAGE }] }) as any;
  assert.equal(r.accepted, true, JSON.stringify(r)); await settle(4);
  const act = (capability: string) => accept(w.host, Promise.resolve(edge.act(s, { capability }))) as Promise<any>;
  const steps = () => { const E = w.host.engine as any, id = E.programOf(s.entityId); return (id ? E.programs?.get(id)?.steps ?? [] : []) as { verb: string; params: any }[]; };
  return { w, god, edge, bridge, s, pos, run, settle, act, steps };
}

const ROOM = 'walk:cottage/bedroom';

for (const ask of [ROOM, 'walk to the cottage bedroom']) test(`F6: a far room walks in one go, in at the front door (${ask})`, { timeout: 300_000 }, async (t) => {
  const x = await world(t);
  const caps = x.edge.capabilities(x.s);
  assert.ok(caps.some((c) => c.id === 'walk:cottage' && c.available), 'the cottage itself is offered');
  assert.ok(!caps.some((c) => c.id === ROOM), 'its bedroom is beyond the rooms listing (the case this covers)');
  const room = x.bridge.nav.thing('cottage/bedroom')!; assert.ok(room?.poly && room.entry, 'the bedroom has an outline and a front-door entry');
  const dry: any = (x.edge as any).intents.dryRun(x.s, { capability: ask });
  assert.equal(dry.ok, true, `resolve: ${JSON.stringify(dry).slice(0, 400)}`);
  assert.equal(dry.would.capability, ROOM, `resolve names the bedroom walk: ${JSON.stringify(dry).slice(0, 400)}`);
  const a = await x.act(ask);
  assert.equal(a.accepted, true, `accepted (${a.code ?? ''} ${a.reason ?? ''})`);
  assert.equal(a.receipt.capability, ROOM);
  // one walk: to the front door's approach outside, then onto the bedroom floor
  const st = x.steps().filter((s) => /walk_to$/.test(s.verb)), door = room.entry!.p;
  assert.ok(st.length >= 2, `door, then room: ${JSON.stringify(st)}`);
  const to = (s: { params: any }): Vec2 => s.params.to ?? [s.params.x, s.params.z];
  assert.deepEqual(to(st[0]), door, 'first to the front door');
  assert.ok(inPoly(...to(st[st.length - 1]), room.poly!), 'then into the bedroom');
  assert.ok(!x.edge.capabilities(x.s).some((c) => c.id === ROOM), 'the listing is unchanged (the walk was for that act only)');
  let inside = false; for (let i = 0; i < 25 && !inside; i++) { await x.run(100); inside = inPoly(...x.pos(), room.poly!); }
  assert.ok(inside, `Ada stands in the bedroom (${x.pos().map((v) => v.toFixed(1))})`);
});

test('F6: running to a far room goes to its front door once, then in', { timeout: 300_000 }, async (t) => {
  const x = await world(t);
  const place = x.edge.capabilities(x.s).find((c) => c.id === 'walk:cottage')!.target!.id + '.bedroom', caps: any[] = [], plans = new Map<string, { label: string; steps: { verb: string; params: any }[] }>();
  assert.equal(x.bridge.nav.gaitOnDemand(x.s, place, 'run', caps, plans), true, 'run:<bedroom> is offered on demand');
  const door = String(x.bridge.nav.thing('cottage/bedroom')!.entry!.p), run = plans.get(`run:${place}`)!.steps;
  assert.equal(run.filter((s) => s.verb === 'walk_to' && String(s.params.to) === door).length, 1, JSON.stringify(run));
  assert.equal(run[0].params.gait, 'run', 'running to the door');
});
