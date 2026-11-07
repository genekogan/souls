// Harvest fix "figures": a god can stage people as scenery (core/figure@1: poses, hats, colours), which are props and
// never Souls; placing a resident body is still refused as body.protected, and that refusal points to the figure.
//   node --test apps/server/src/god/people-as-scenery.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef, CORE_KIT } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { GodMode } from './god.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { installEngineBridge, PEOPLE_AS_SCENERY } from './engine-bridge.ts';
import { searchDefs, publicRef } from './assets.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function world() {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  return { ...f, god, edge, settle };
}

test('figures place as scenery (every pose, hats, colours, a child, a seated one on a bench); they are not residents', { timeout: 300000 }, async (t) => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const def = w.god.model.resolvedDef(coreRef('figure'));
  assert.ok(def, 'core/figure@1 is in the core kit');
  assert.equal(def!.components.body, undefined, 'a figure has no body component');
  const minds = w.host.minds.size;
  const poses = ['stand', 'walk', 'carry', 'serve', 'wave'];
  const ops: any[] = poses.map((pose, i) => ({ op: 'place', def: coreRef('figure'), name: `extra-${pose}`, p: [i * 2, 6], params: { pose, hat: ['none', 'cap', 'sunhat', 'chef', 'scarf'][i], top: '#c8452c' } }));
  ops.push({ op: 'place', def: coreRef('figure'), name: 'child', p: [12, 6], s: 0.6, params: { pose: 'walk' } });
  ops.push({ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 12] });
  const r: any = w.god.act({ ops });
  assert.equal(r.accepted, true, JSON.stringify(r.failures));
  await w.settle(3);
  const benchId = w.god.model.get('bench')!.id;
  const seated: any = w.god.act({ ops: [{ op: 'place', def: coreRef('figure'), name: 'sitter', p: [0.4, 12], params: { pose: 'sit' } }] });
  assert.equal(seated.accepted, true, `a seated figure shares the bench (no collider): ${JSON.stringify(seated.failures)}`);
  await w.settle(3);
  const E = w.host.engine as any;
  for (const name of [...poses.map((p) => `extra-${p}`), 'child', 'sitter']) {
    const e = w.god.model.get(name)!; assert.ok(e, name);
    assert.equal(E.world.entities[e.id]?.human, undefined, `${name} is not simulated as a body`);
  }
  assert.equal(w.host.minds.size, minds, 'no resident was made');
  assert.ok(w.god.model.get('bench')!.id === benchId);
  // and they are removable like any prop
  assert.equal(w.god.act({ ops: [{ op: 'remove', id: w.god.model.get('extra-wave')!.id }] }).accepted, true);
});

test('placing a resident body is still refused, and the refusal points to core/figure@1', { timeout: 300000 }, async (t) => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  for (const body of [coreRef('humanoid', 2), coreRef('humanoid'), coreRef('floater')]) {
    const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: `bench-${body.length}`, p: [20, 20] }, { op: 'place', def: body, name: 'stand-in', p: [4, 4] }] });
    assert.equal(r.accepted, false, body); assert.equal(r.failures[0].code, 'body.protected');
    assert.equal(r.failures[0].op, 1, 'the refusal names the body placement');
    assert.match(r.failures[0].detail, /resident's body/); assert.equal(r.failures[0].fix, PEOPLE_AS_SCENERY);
    assert.match(r.failures[0].fix, /core\/figure@1/);
  }
  // a world def extending a body is a body too
  const ext: any = w.god.act({ ops: [{ op: 'define', def: { schema: 'def/1', name: 'my-person', version: 1, extends: 'core/humanoid@2', description: 'A person.', tags: ['body'], size: { box: [0.56, 1.8, 0.56] }, make: { kind: 'none' } } }, { op: 'place', def: 'my-person@1', name: 'p1', p: [2, 2] }] });
  assert.equal(ext.accepted, false); assert.equal(ext.failures[0].code, 'body.protected'); assert.match(ext.failures[0].fix, /core\/figure@1/);
  // a Soul's own body stays untouchable
  await invite(w, 'dee');
  const row: any = await accept(w.host, w.souls.create('dev:dee', { name: 'Dee', description: 'likes crowds' }));
  await w.settle(3);
  for (const op of [{ op: 'remove', id: row.entity_id }, { op: 'move', id: row.entity_id, p: [30, 30] }]) {
    const r: any = w.god.act({ ops: [op] });
    assert.equal(r.accepted, false); assert.equal(r.failures[0].code, 'body.protected');
  }
});

test('find people / waiters / a crowd ranks core/figure@1 first', () => {
  const lib = CORE_KIT.map((d) => ({ ...d, ref: `${d.name}@${d.version ?? 1}` })) as any[];
  for (const q of ['people', 'person', 'a crowd', 'waiters', 'stallholders', 'pedestrians', 'a choir', 'children']) {
    const top = searchDefs(lib, q, { limit: 3 }).map((h) => publicRef(h.def));
    assert.equal(top[0], 'core/figure@1', `${q}: ${top.join(', ')}`);
  }
});
