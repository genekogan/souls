import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, MarsEngine } from './engine.ts';
import { SOULS_REPAIR_POLICY } from './refuse.ts';

// #1150 rung 1. A test invariant runs first in the end-of-tick pass, so what it does to a body lands exactly where a bad
// action step would: real programmes, real invariants after it. `forge` adds a named violation for rules a green field has
// no geometry to break for real.
const on = await marsFactory({ ...GREEN_FIELD_WORLD, soulsRepairV1: true }), off = await marsFactory(GREEN_FIELD_WORLD);
type Fn = (rt: any) => { code: string; message: string; subjects: string[] }[] | void;
function world(factory = on, seed = 'refuse') {
  const e = factory.create(factory.genesis(seed)) as MarsEngine;
  e.spawnHuman({ id: 'a', label: 'Ada', soul: 's_a', at: [0, 0] } as any); e.spawnHuman({ id: 'b', label: 'Bo', soul: 's_b', at: [6, 6] } as any);
  const rt = (e as any).rt, ends: any[] = [];
  const step = () => { const o = e.step(); ends.push(...o.programs.filter(p => p.kind !== 'step')); return o; };
  const inject = (fn: Fn) => { rt.invariants = [(r: any) => fn(r) ?? [], ...rt.invariants]; };
  const once = (fn: Fn) => { let done = false; inject(r => { if (done) return; done = true; return fn(r); }); };
  const walk = (id: string, to: [number, number]) => { const r = e.perform({ actor: id, label: 'walk', steps: [{ verb: 'walk_to', params: { to } }] }); assert.equal(r.ok, true, JSON.stringify(r)); };
  const go = (n: number) => { for (let i = 0; i < n; i++) step(); };
  return { e, rt, ends, step, once, walk, go, pose: (id: string) => [...e.world.entities[id].pose.p] };
}
const shove = (dx: number) => (rt: any) => { rt.world.entities.a.pose.p[0] += dx; };

test('off: no suffix, no key, and a violation stays for the host', () => {
  const w = world(off); assert.ok(!w.e.rulesVersion.includes(SOULS_REPAIR_POLICY));
  w.walk('a', [10, 0]); w.go(5); w.once(shove(1));
  const out = w.step();
  assert.equal('refusals' in out, false); assert.equal(w.e.runtime.violations.length, 1); assert.equal(w.e.runtime.violations[0].code, 'motion.teleport');
  assert.notEqual(w.e.programOf('a'), null, 'the programme runs on, as before');
});

test('a real teleport: the body is back at its last valid pose, the programme failed in that tick, the bystander goes on', () => {
  const w = world(); assert.ok(w.e.rulesVersion.endsWith('+' + SOULS_REPAIR_POLICY));
  w.walk('a', [10, 0]); w.walk('b', [6, 16]); w.go(10);
  const before = w.pose('a'), bo = w.pose('b'); w.once(shove(1));
  const out = w.step();
  assert.deepEqual(w.e.runtime.violations, []);
  assert.deepEqual(w.pose('a'), before); assert.equal(w.e.programOf('a'), null);
  const end = w.ends.at(-1); assert.equal(end.actor, 'a'); assert.equal(end.kind, 'failed'); assert.equal(end.code, 'world.refused:motion.teleport'); assert.match(end.message, /Nothing else changed/);
  assert.deepEqual(out.refusals?.map(r => [r.rule, r.bodies, r.tick]), [['motion.teleport', ['a'], w.e.world.tick]]);
  assert.notDeepEqual(w.pose('b'), bo, 'the other walk moved this tick'); assert.notEqual(w.e.programOf('b'), null);
  w.go(5); assert.deepEqual(w.e.runtime.violations, [], 'the next tick does not read the undone move as a jump');
  w.walk('a', [-10, 0]); w.go(10); assert.deepEqual(w.e.runtime.violations, []); assert.ok(w.pose('a')[0] < before[0], 'free on its next turn');
});

test('the #1120 label: walking speed under `wait` is refused, not left to replay into itself', () => {
  const w = world(); w.walk('a', [10, 0]); w.go(10); const before = w.pose('a');
  w.once(rt => { const h = rt.world.entities.a.human; h.activity = 'wait'; h.speed = 0.9; });
  w.step();
  assert.deepEqual(w.e.runtime.violations, []); assert.equal(w.ends.at(-1).code, 'world.refused:motion.overspeed'); assert.deepEqual(w.pose('a'), before);
});

test('a real collision between people refuses the one who moved, and leaves the other where they stand', () => {
  const w = world(); w.walk('a', [10, 0]); w.go(10); const before = w.pose('a'), bo = w.pose('b');
  w.once(rt => { const a = rt.world.entities.a, p = bo; a.pose.p = [p[0] + 0.1, p[1], p[2]]; });
  const out = w.step();
  assert.deepEqual(w.e.runtime.violations, []); assert.deepEqual(w.pose('a'), before); assert.deepEqual(w.pose('b'), bo);
  assert.ok(out.refusals?.some(r => r.rule === 'collision.human-human' && r.bodies.join() === 'a'), JSON.stringify(out.refusals));
});

for (const rule of ['collision.human-static', 'collision.human-human', 'collision.human-load', 'motion.overspeed', 'motion.teleport', 'carry.load-static', 'lift.hands-out-of-reach'])
  test(`${rule} is refusable`, () => {
    const w = world(); w.walk('a', [10, 0]); w.go(10); const before = w.pose('a');
    w.once(() => [{ code: rule, message: 'forced', subjects: ['a'] }]);
    w.step();
    assert.deepEqual(w.e.runtime.violations, []); assert.equal(w.ends.at(-1).code, `world.refused:${rule}`); assert.deepEqual(w.pose('a'), before);
  });

test('rung 2 keeps what refusal cannot undo: another rule, a body that did not move, a programme past its refusals', () => {
  let w = world(); w.walk('a', [10, 0]); w.go(10); w.once(() => [{ code: 'support.floating', message: 'forced', subjects: ['a'] }]);
  w.step(); assert.equal(w.e.runtime.violations.length, 1, 'outside the classes'); assert.notEqual(w.e.programOf('a'), null);
  w = world(); w.walk('a', [10, 0]); w.go(10); w.once(() => [{ code: 'collision.human-static', message: 'forced', subjects: ['b'] }]);
  w.step(); assert.equal(w.e.runtime.violations.length, 1, 'b stood still: the world moved onto it'); assert.notEqual(w.e.programOf('a'), null);
  w = world(); w.walk('a', [10, 0]); w.go(10); const t = w.e.world.tick;
  (w.e as any).programs.get(w.e.programOf('a')).refusalsV1 = [t - 40, t - 20]; w.once(shove(1));
  w.step(); assert.equal(w.e.runtime.violations.length, 1, 'a third refusal within 5 s goes to the host');
  w = world(); w.walk('a', [10, 0]); w.go(10); const u = w.e.world.tick;
  (w.e as any).programs.get(w.e.programOf('a')).refusalsV1 = [u - 120, u - 110]; w.once(shove(1));
  w.step(); assert.deepEqual(w.e.runtime.violations, [], 'older refusals have left the window');
  w = world(); w.walk('a', [10, 0]); w.go(10); w.once(rt => { shove(1)(rt); return [{ code: 'support.floating', message: 'forced', subjects: ['b'] }]; });
  w.step(); assert.equal(w.e.runtime.violations.length, 2, 'all of a tick or none of it'); assert.notEqual(w.e.programOf('a'), null);
});

test('a refusal needs no input: two runs and a restored copy reach the same state', () => {
  const run = () => { const w = world(); w.walk('a', [10, 0]); w.walk('b', [6, 16]); w.go(10); w.once(shove(1)); w.go(30); return w; };
  const one = run(), two = run(); assert.equal(one.e.stateHash(), two.e.stateHash());
  const w = world(); w.walk('a', [10, 0]); w.walk('b', [6, 16]); w.go(10); const copy = on.restore(w.e.snapshot()) as MarsEngine;
  const rt = (copy as any).rt; let done = false; rt.invariants = [(r: any) => { if (!done) { done = true; shove(1)(r); } return []; }, ...rt.invariants];
  w.once(shove(1));
  for (let i = 0; i < 30; i++) { w.e.step(); copy.step(); } assert.equal(copy.stateHash(), w.e.stateHash());
});

test('rules: the suffix is refused where it is unknown, and history without it is refused under the flag', () => {
  assert.equal(off.canReplayHistory?.(on.rulesVersion), false); assert.equal(off.canRestoreSnapshot?.(on.rulesVersion), false);
  assert.equal(on.canReplayHistory?.(off.rulesVersion), false); assert.equal(on.canRestoreSnapshot?.(off.rulesVersion), false);
  assert.equal(on.canReplayHistory?.(on.rulesVersion), true); assert.equal(on.canRestoreSnapshot?.(on.rulesVersion), true);
  const e = off.create(off.genesis('x')); assert.throws(() => on.restore(e.snapshot()), /snapshot repair policy/);
});
