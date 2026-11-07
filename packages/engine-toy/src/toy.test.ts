import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine } from '@souls/engine-contract';
import { conformance } from '@souls/engine-contract/conformance';
import { toyFactory } from './index.ts';

function drive(e: Engine, i: number) {
  if (i === 0) for (const n of ['a', 'b', 'c', 'd']) e.spawnHuman({ id: `h-${n}`, label: n.toUpperCase(), soul: `s-${n}` });
  if (i % 60 === 5) {
    for (const id of ['h-a', 'h-b', 'h-c', 'h-d']) {
      if (e.world.entities[id].human!.task) continue;
      const opts = e.enumerateActivities(id, null);
      const pick = opts[(i / 60 + id.charCodeAt(2)) % opts.length | 0];
      e.submit('do_activity', { actor: id, label: pick.label, option: pick.id, steps: pick.steps }, { preempt: true });
    }
  }
}
conformance('toy', toyFactory, drive);

test('toy: a soul walks to the campfire and gathers', () => {
  const e = toyFactory.create(toyFactory.genesis('t'));
  e.spawnHuman({ id: 'h-x', label: 'X', soul: 's-x' });
  const o = e.enumerateActivities('h-x', null).find((o) => o.id === 'attend:campfire')!;
  const r = e.submit('do_activity', { actor: 'h-x', label: o.label, steps: o.steps });
  assert.equal(r.status, 'executing');
  let paths = 0;
  for (let i = 0; i < 20 * 60; i++) paths += e.step().paths.length;
  assert.equal(paths, 1);
  assert.equal(e.world.entities['h-x'].human!.activity, 'gather');
  assert.equal(e.world.entities['h-x'].human!.on, 'campfire');
  assert.equal(e.runtime.violations.length, 0);
  const s = e.describeSurroundings('h-x');
  assert.ok(s.nearby.some((n) => n.id === 'campfire' && n.distance === 'close' || n.distance === 'here'));
});
test('toy: preempt replaces the running activity', () => {
  const e = toyFactory.create(toyFactory.genesis('t'));
  e.spawnHuman({ id: 'h-x', label: 'X', soul: 's-x' });
  const a = e.submit('do_activity', { actor: 'h-x', label: 'w', steps: [{ verb: 'ambient_wander', params: { seconds: 60 } }] });
  for (let i = 0; i < 50; i++) e.step();
  const b = e.submit('do_activity', { actor: 'h-x', label: 'r', steps: [{ verb: 'rest', params: { seconds: 5 } }] }, { preempt: true });
  assert.equal(e.runtime.records.get(a.id)!.status, 'cancelled');
  assert.equal(b.status, 'executing');
  const c = e.submit('do_activity', { actor: 'h-x', label: 'r2', steps: [{ verb: 'rest', params: {} }] });
  assert.equal(c.status, 'failed');
  assert.equal(c.diagnostic?.code, 'reservation.conflict');
});
