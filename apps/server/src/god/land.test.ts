// GOD-ENV: land verbs as god ops — preview, commit, undo, grounding, extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db.ts';
import { boundsOf } from '@souls/world-compiler';
import { GodMode, type WorldDiffMessage } from './god.ts';
import { land } from './land.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fixture() {
  const db = new Db(':memory:'); const emitted: WorldDiffMessage[] = []; let tick = 100;
  const god = new GodMode(db, { worldId: 'land-1', ownerId: null, tick: () => tick++, emit: (m: WorldDiffMessage) => emitted.push(m), constants: { extent: 400 } } as any);
  return { god, emitted };
}

test('land: preview changes nothing; mountain raises the ground and re-grounds the bench; undo restores', () => {
  const { god, emitted } = fixture();
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [30, 0] }] } as any).accepted, true);
  const y0 = (god.model.get('bench')!.p as number[])[1], seq0 = god.model.editSeq;
  const pv = land(god, { verb: 'hill', at: [30, 0], height: 20, radius: 60, preview: true });
  assert.equal(pv.accepted, true, pv.says);
  assert.equal(god.model.editSeq, seq0, 'preview commits nothing');
  assert.ok(pv.ground && pv.ground.raisedM > 15, pv.says);
  assert.ok(pv.moved.some((m: { path: string; dy: number }) => m.path === 'bench' && m.dy > 15), `the preview says the bench rises: ${pv.says}`);
  const r = land(god, { verb: 'hill', at: [30, 0], height: 20, radius: 60 });
  assert.equal(r.accepted, true); assert.ok(r.seq);
  const y1 = (god.model.get('bench')!.p as number[])[1];
  assert.ok(y1 - y0 > 15, `bench on the hill: ${y0} → ${y1}`);
  const msg = emitted[emitted.length - 1];
  assert.ok(msg.diff.tiles.length > 0 && msg.ground, 'viewers get the tiles and the ground');
  // move the hill east by 100 m: the bench comes back down
  const mv = land(god, { verb: 'move', ref: 'hill', by: [100, 0] });
  assert.equal(mv.accepted, true, mv.says);
  assert.ok((god.model.get('bench')!.p as number[])[1] < y1 - 10);
  assert.ok(god.model.terrain.sample(130, 0) > 15, 'the hill stands at its new place');
  god.undo(); god.undo();
  assert.ok(Math.abs((god.model.get('bench')!.p as number[])[1] - y0) < 1e-6, 'two undos: flat again');
});

test('land: brushes, valley, cliff, water level, extend east, and refusals', () => {
  const { god } = fixture();
  for (const v of ['raise', 'lower', 'smooth'] as const) assert.equal(land(god, { verb: v, at: [-50, -50], radius: 10, amount: v === 'smooth' ? 0.5 : 3 }).accepted, true, v);
  const fl = land(god, { verb: 'flatten', at: [-50, -50], radius: 10, level: 1 });
  assert.equal(fl.accepted, true);
  assert.ok(Math.abs(god.model.terrain.sample(-50, -50) - 1) < 0.2, 'flattened to 1 m');
  const va = land(god, { verb: 'valley', path: [[-150, 100], [150, 100]], depth: 6, width: 8 });
  assert.equal(va.accepted, true, va.says);
  assert.ok(god.model.terrain.sample(0, 100) < -5, 'the valley floor is 6 m down');
  assert.equal(land(god, { verb: 'cliff', path: [[-100, -150], [100, -150]], height: 12 }).accepted, true);
  assert.equal(land(god, { verb: 'ditch', path: [[0, 0], [0, 50]] }).accepted, true);
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[60, 60], [90, 60], [90, 90], [60, 90]] } }] } as any).accepted, true);
  const lvl0 = Number(god.model.get('pond')!.params?.level ?? -0.3);
  const w = land(god, { verb: 'water', ref: 'pond', by: -0.5 });
  assert.equal(w.accepted, true, w.says);
  assert.equal(god.model.ground().waters.find((x) => x.id === god.model.get('pond')!.id)!.level, Math.round((lvl0 - 0.5) * 100) / 100);
  const ex = land(god, { verb: 'extend', toward: 'east', metres: 300 });
  assert.equal(ex.accepted, true, ex.says);
  assert.deepEqual(boundsOf(god.model), [-200, -200, 500, 200]);
  assert.ok(/grows/.test(ex.says));
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core/bench@1', p: [450, 0] }] } as any).accepted, true, 'things can stand on the new land');
  // refusals
  assert.throws(() => land(god, { verb: 'warp' } as any), /unknown land verb/);
  assert.throws(() => land(god, { verb: 'extend', toward: 'up', metres: 10 }), /toward/);
  assert.equal(land(god, { verb: 'raise', at: [900, 0] }).accepted, false, 'outside the world');
});

test('land: a house on ground that turns into a slope gets a foundation pad; undo takes it away again', () => {
  const { god } = fixture();
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core-cottage@1', name: 'home', p: [40, 0] }] } as any).accepted, true);
  const pads = () => god.model.ground().landforms.filter((l) => l.id.endsWith(':pad'));
  assert.equal(pads().length, 0);
  const h = land(god, { verb: 'hill', at: [60, 0], height: 10, radius: 40 });
  assert.equal(h.accepted, true, h.says);
  const y = (god.model.get('home')!.p as number[])[1];
  assert.equal(pads().length, 1, 'a pad under the house');
  assert.ok(Math.abs(god.model.terrain.sample(40, 0) - y) < 0.05, 'the ground under the house is at its floor');
  god.undo();
  assert.equal(pads().length, 0, 'undo: no pad');
  assert.ok(Math.abs((god.model.get('home')!.p as number[])[1]) < 0.05);
});
