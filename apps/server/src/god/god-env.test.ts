// GOD-ENV: the god's land ops — world bounds that grow in any direction (invertible), terrain edits that keep placed
// things grounded, previews, and lightning. Pure model/compiler level here; the server routes are in land.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, boundsOf, CORE_KIT } from '@souls/world-compiler';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(extent = 200) {
  const m = new WorldModel({ constants: { ground: 'land', extent }, seed: 'god-env-test' });
  for (const d of CORE_KIT) m.defineDef(d as any, 'core', 0);
  return m;
}
const act = (m: WorldModel, ops: unknown[], trusted = false) => applyBatch(m, { ops }, 'god', 1, { trusted });

test('expand: bounds grow in one direction, things can stand there, and the inverse shrinks back only when the land is empty', () => {
  const m = world(200);
  assert.deepEqual(boundsOf(m), [-100, -100, 100, 100]);
  const far = act(m, [{ op: 'place', def: 'core/bench@1', p: [250, 0] }]);
  assert.equal(far.result.accepted, false); assert.equal((far.result as any).failures[0].code, 'extent.outside');
  const r = act(m, [{ op: 'expand', bounds: [-100, -100, 400, 100] }]);
  assert.equal(r.result.accepted, true);
  assert.deepEqual(boundsOf(m), [-100, -100, 400, 100]);
  assert.equal(m.constants.extent, 200, 'the centred square is unchanged; the bounds carry the growth');
  assert.deepEqual(r.inverse, [{ op: 'expand', bounds: [-100, -100, 100, 100], extent: 200 }]);
  const shrink = act(m, [{ op: 'expand', bounds: [-100, -100, 300, 100] }]);
  assert.equal(shrink.result.accepted, false, 'a god cannot shrink the world'); assert.equal((shrink.result as any).failures[0].code, 'constant.immutable');
  const placed = act(m, [{ op: 'place', def: 'core/bench@1', p: [250, 0] }]);
  assert.equal(placed.result.accepted, true);
  const blocked = act(m, r.inverse!, true);
  assert.equal(blocked.result.accepted, false); assert.equal((blocked.result as any).failures[0].code, 'undo.conflict');
  assert.equal(act(m, placed.inverse!, true).result.accepted, true);
  const undone = act(m, r.inverse!, true);
  assert.equal(undone.result.accepted, true);
  assert.deepEqual(boundsOf(m), [-100, -100, 100, 100]);
  // the old square form still works and keeps a directional extension
  act(m, [{ op: 'expand', bounds: [-100, -100, 400, 100] }]);
  assert.equal(act(m, [{ op: 'expand', extent: 600 }]).result.accepted, true);
  assert.deepEqual(boundsOf(m), [-300, -300, 400, 300]); assert.equal(m.constants.extent, 600);
});

test('a terrain edit under a placed thing re-grounds it; undo puts it back', () => {
  const m = world(400);
  const b = act(m, [{ op: 'place', tmp: '$b', def: 'core/bench@1', name: 'bench', p: [10, 0] }]);
  const id = (b.result as any).ids.$b, y0 = (m.entities.get(id)!.p as number[])[1];
  const raise = act(m, [{ op: 'place', def: 'core/brush@1', p: [10, 0], params: { op: 'raise', radius: 12, amount: 5 } }]);
  assert.equal(raise.result.accepted, true);
  const y1 = (m.entities.get(id)!.p as number[])[1];
  assert.ok(y1 - y0 > 4, `the bench rose with the ground: ${y0} → ${y1}`);
  assert.ok(Math.abs(y1 - m.terrain.sample(10, 0)) < 0.3, 'it stands on the new ground');
  act(m, raise.inverse!, true);
  assert.ok(Math.abs((m.entities.get(id)!.p as number[])[1] - y0) < 1e-6, 'undo: back down');
});

test('lightning: storm strikes are deterministic, scale with intensity, stay in the world; the god strikes a point and Souls hear it', async () => {
  const { stormStrikes, strikesBetween } = await import('@souls/world-compiler');
  const b = [-500, -500, 500, 500];
  const a1 = stormStrikes('w', b, 1, 0, 20 * 600), a2 = stormStrikes('w', b, 1, 0, 20 * 600);
  assert.deepEqual(a1, a2, 'same world, same strikes');
  assert.ok(a1.length > 20 && a1.length < 45, `a full storm (WEATHER-RULES): about 30 strikes in 10 min, got ${a1.length}`);
  assert.ok(stormStrikes('w', b, 0.3, 0, 20 * 600).length < a1.length / 2);
  assert.ok(a1.every((s) => s.x >= -450 && s.x <= 450 && s.z >= -450 && s.z <= 450));
  // windows split anywhere give the same strikes
  assert.deepEqual([...stormStrikes('w', b, 1, 0, 5000), ...stormStrikes('w', b, 1, 5000, 12000)], a1);
  assert.equal(strikesBetween({ weather: { kind: 'rain' } }, 'w', b, 0, 12000).length, 0, 'no storm, no lightning');
  const { Db } = await import('../db.ts'); const { GodMode } = await import('./god.ts'); const { strike, lightningNear } = await import('./lightning.ts');
  let tick = 1000;
  const god = new GodMode(new Db(':memory:'), { worldId: 'l', ownerId: null, tick: () => tick, emit: () => {}, constants: { extent: 400 } } as any);
  assert.equal(god.act({ ops: [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [40, 0] }] } as any).accepted, true);
  const r: any = strike(god, 'bench', tick);
  assert.equal(r.accepted, true); assert.equal(r.strike.x, 40);
  tick += 40;   // 2 s later, a Soul 343 m … no: 100 m west of it
  const heard = lightningNear(god, -60, 0, tick)!;
  assert.ok(/lightning struck 100 m to the east/.test(heard.last) && /thunder reached you/.test(heard.last), heard.last);
  const far = lightningNear(god, 40, -1200, tick)!;   // 1.2 km away: 3.5 s of sound, 2 s gone
  assert.ok(/thunder will reach you/.test(far.last), far.last);
  god.undo();
  assert.equal(lightningNear(god, 0, 0, tick), null, 'undone: no strike');
  assert.throws(() => strike(god, [900, 0], tick), /outside the world/);
});
