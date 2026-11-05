// PC12 (#691): structural joints between parts (joints.ts). A god joins loose uprights and beams into a bay through typed
// connectors: both parts hold their half, the beams stay at the world root (no scene parenting), and a part with bearing
// connectors is held up through them. Refusals come before anything changes; undo is exact; a second, unrelated kit uses
// the same interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, coreLibrary, jointId, type Entity, type Op, type Result } from './index.ts';
import { connectorPoint } from './joints.ts';

const IN = 0.0254, T = 3 * IN, UP_L = 12 * 0.3048, BEAM_L = 9 * 0.3048, BEAM_H = 4 * IN, ZC = 2 * 0.3048 - 1.5 * IN;
const seat = (i: number) => 12 * IN + 6 * IN * i;   // height of seat i above the upright's base
const GAP = 0.001;                                    // parts placed 1 mm apart, as a builder would leave them
const world = () => { const w = new WorldModel({ constants: { extent: 200, ground: 'land' }, seed: 'joints-test' }); w.library = coreLibrary(); return w; };
const run = (w: WorldModel, ops: unknown[]): Result => applyBatch(w, { ops }, 'god', 1).result;
const ok = (r: Result) => { assert.equal(r.accepted, true, JSON.stringify(r)); return r as Extract<Result, { accepted: true }>; };
const refused = (r: Result, code: string, why?: RegExp) => {
  assert.equal(r.accepted, false, `expected ${code}`);
  if (r.accepted) return;
  assert.equal(r.failures[0].code, code, JSON.stringify(r.failures[0]));
  if (why) assert.match(r.failures[0].detail, why);
};
/** Two uprights standing face to face, a beam's length apart, and four beams at seats 4 and 12 on both columns, joined. */
function bayOps(x0 = 0, lift = 0, pitch = 0): unknown[] {
  const bx = x0 - 2 * T - BEAM_L - 2 * GAP, ops: unknown[] = [
    { op: 'place', tmp: '$a', def: 'core/rack-upright@2', p: [x0, UP_L / 2 + lift, 0], r: [0, pitch, Math.PI / 2], anchor: 'center' },
    { op: 'place', tmp: '$b', def: 'core/rack-upright@2', p: [bx, UP_L / 2 + lift, 0], r: [Math.PI, 0, Math.PI / 2], anchor: 'center' },
  ];
  const k = 0;
  for (const i of [4, 12]) for (const [z, aSide, bSide] of [[-ZC, 'l', 'r'], [ZC, 'r', 'l']] as const) {
    const t = `$b${i}${aSide}`;
    ops.push({ op: 'place', tmp: t, def: 'core/rack-beam@3', p: [x0 - T - GAP - BEAM_L / 2, seat(i) + lift - BEAM_H / 2, z], r: k, anchor: 'center' });
    ops.push({ op: 'connect', a: { id: t, connector: 'end-r' }, b: { id: '$a', connector: `front-${aSide}-${i}` } });
    ops.push({ op: 'connect', a: { id: t, connector: 'end-l' }, b: { id: '$b', connector: `front-${bSide}-${i}` } });
  }
  return ops;
}
const byDef = (w: WorldModel, ref: string) => [...w.entities.values()].filter((e) => w.resolvedDef(e.def)?.ref === ref).sort((a, b) => (a.p![1] - b.p![1]) || ((a.p![2] ?? 0) - (b.p![2] ?? 0)));

test('PC12 A1a/A1b: a god joins two standing uprights and four beams; both halves, stable joint ids, no parenting', () => {
  const w = world(), r = ok(run(w, bayOps()));
  const [a, b] = [r.ids.$a, r.ids.$b].map((id) => w.entities.get(id)!);
  const beams = byDef(w, 'core-rack-beam@3');
  assert.equal(beams.length, 4);
  for (const beam of beams) {
    assert.equal(beam.in.parent, 'world', 'a beam stays at the world root: its support is its joints, not a parent');
    assert.equal(beam.in.slot, undefined);
    const ends = Object.entries(beam.joins ?? {});
    assert.equal(ends.length, 2, 'both ends joined');
    for (const [c, j] of ends) {
      const other = w.entities.get(j.to)!;
      assert.ok(other === a || other === b);
      assert.deepEqual(other.joins?.[j.at], { to: beam.id, at: c }, 'the other part holds the mirror half');
      // the two connector points meet
      const p = connectorPoint(w, beam, w.resolvedDef(beam.def)!.components.connectors!.find((x) => x.id === c)!);
      const q = connectorPoint(w, other, w.resolvedDef(other.def)!.components.connectors!.find((x) => x.id === j.at)!);
      assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.01, `${c} meets ${j.at}`);
    }
  }
  assert.equal(Object.keys(a.joins!).length, 4); assert.equal(Object.keys(b.joins!).length, 4);
  assert.equal(jointId(a.id, 'front-l-4', 'e_x', 'end-r'), jointId('e_x', 'end-r', a.id, 'front-l-4'), 'the same id from either end');
  assert.ok(r.warnings.some((x) => x.startsWith('joint ')), 'the batch names its joints');
  // loose materials have no compiler collider (as before PC12): the engine's own box is their obstacle (server test)
  assert.equal(w.footprint(a).length, 0);
});

test('PC12 A2a: refusals before anything changes, naming the parts', () => {
  const w = world(), r = ok(run(w, bayOps()));
  const before = JSON.stringify([...w.entities.values()]);
  const [a, b] = [r.ids.$a, r.ids.$b];
  const beam = byDef(w, 'core-rack-beam@3')[0];
  refused(run(w, [{ op: 'connect', a: { id: beam.id, connector: 'end-x' }, b: { id: a, connector: 'front-l-5' } }]), 'connector.unknown', /no connector end-x/);
  refused(run(w, [{ op: 'place', tmp: '$f', def: 'core/rack-beam@3', p: [10, 0], r: 0 }, { op: 'place', tmp: '$g', def: 'core/rack-beam@3', p: [10 + BEAM_L + GAP, 0], r: 0 },
    { op: 'connect', a: { id: '$f', connector: 'end-r' }, b: { id: '$g', connector: 'end-l' } }]), 'connector.incompatible', /beam-end.*does not mate.*beam-end/);
  refused(run(w, [{ op: 'connect', a: { id: beam.id, connector: Object.keys(beam.joins!)[0] }, b: { id: a, connector: 'front-l-5' } }]), 'connector.taken', /already joined/);
  refused(run(w, [{ op: 'place', tmp: '$f', def: 'core/rack-beam@3', p: [20, 0], r: 0 }, { op: 'connect', a: { id: '$f', connector: 'end-r' }, b: { id: a, connector: 'front-l-5' } }]), 'connector.apart', /m apart/);
  refused(run(w, [{ op: 'move', id: a, p: [1, UP_L / 2, 0] }]), 'connector.joined', /is joined .*does not move while joined/);
  refused(run(w, [{ op: 'move', id: beam.id, p: [1, 1, 1] }]), 'connector.joined');
  // unsafe release: a beam left hanging by one end, or the upright under four beams taken away
  refused(run(w, [{ op: 'disconnect', a: { id: beam.id, connector: 'end-r' } }]), 'support.none', /hangs by end-l with end-r joined to nothing/);
  refused(run(w, [{ op: 'remove', id: a }]), 'support.none', /joined to nothing/);
  // a bearing part placed in the air unjoined
  refused(run(w, [{ op: 'place', def: 'core/rack-beam@3', p: [30, 1.5, 0], r: 0, anchor: 'center' }]), 'support.none', /above the ground with none of its bearing connectors/);
  refused(run(w, [{ op: 'disconnect', a: { id: a, connector: 'back-l-3' } }]), 'connector.free');
  refused(run(w, [{ op: 'disconnect', a: { id: a, connector: 'back-x-3' } }]), 'connector.unknown', /has no connector back-x-3/);
  // the default anchor keeps y for a part with connectors and builds no pad under it, so it is refused too
  refused(run(w, [{ op: 'place', def: 'core/rack-beam@3', p: [30, 1.5, 0], r: 0 }]), 'support.none', /above the ground/);
  assert.equal(JSON.stringify([...w.entities.values()]), before, 'nothing changed');
  void b;
  // an upright held a metre in the air does not hold beams up; a part pitched about x does not join (the engine would
  // stand it straight)
  refused(run(world(), bayOps(0, 1)), 'support.none', /holds joined parts up but its foot is 1 m above the ground/);
  refused(run(world(), bayOps(0, 0, 0.4)), 'connector.pose', /tilted 0.4 rad about x/);
});

test('PC12 A2a/A2b: a safe release order is accepted; undo and redo are exact', () => {
  const w = world(), r = ok(run(w, bayOps()));
  const a = r.ids.$a, beams = byDef(w, 'core-rack-beam@3');
  const snap = () => structuredClone([...w.entities.values()].map((e) => ({ ...e, v: 0 })).sort((x, y) => x.id < y.id ? -1 : 1));
  const built = snap();
  // the beams come down first (removed, or set on the ground), then the upright goes: accepted, and nothing dangles
  const ops: Op[] = [...beams.map((x) => ({ op: 'remove', id: x.id, cascade: true }) as Op), { op: 'remove', id: a, cascade: true } as Op];
  const res = applyBatch(w, { ops }, 'god', 2);
  ok(res.result);
  const b = w.entities.get(r.ids.$b)!;
  assert.equal(b.joins, undefined, 'the other upright lost its halves with the beams');
  // undo: everything back, both halves of every joint
  const undo = applyBatch(w, { ops: res.inverse! }, 'god', 3, { trusted: true });
  ok(undo.result);
  assert.deepEqual(snap(), built, 'undo restores the parts and both halves of each joint');
  // redo, then undo again
  const redo = applyBatch(w, { ops: undo.inverse! }, 'god', 4, { trusted: true });
  ok(redo.result);
  assert.equal(w.entities.get(a), undefined); assert.equal(w.entities.get(r.ids.$b)!.joins, undefined);
  ok(applyBatch(w, { ops: redo.inverse! }, 'god', 5, { trusted: true }).result);
  assert.deepEqual(snap(), built, 'redo then undo again');
  // disconnect then reconnect via the inverse
  const one = beams[0], end = Object.keys(one.joins!)[0];
  const off = applyBatch(w, { ops: [{ op: 'disconnect', a: { id: one.id, connector: end } }, { op: 'remove', id: one.id }] }, 'god', 6);
  ok(off.result);
  ok(applyBatch(w, { ops: off.inverse! }, 'god', 7, { trusted: true }).result);
  assert.deepEqual(snap(), built);
});

test('PC12 A3a: a second, unrelated kit joins through the same interface; mixing kits is refused', () => {
  const w = world();
  const box = (b: [number, number, number], shapes: unknown[]) => ({ make: { kind: 'gen', gen: 'kit/2', args: { shapes } }, size: { box: b } });
  ok(run(w, [
    { op: 'define', def: { schema: 'def/1', name: 'peg-post', version: 1, tags: ['post'], ...box([0.1, 1.2, 0.1], [{ kind: 'box', at: [0, 0.6, 0], size: [0.1, 1.2, 0.1] }]),
      components: { connectors: [{ id: 'hole', kind: 'peg-hole', at: [0.05, 1.0, 0], mates: ['peg'] }] } } },
    { op: 'define', def: { schema: 'def/1', name: 'peg-shelf', version: 1, tags: ['shelf'], ...box([1.0, 0.05, 0.3], [{ kind: 'box', at: [0, 0.025, 0], size: [1.0, 0.05, 0.3] }]),
      components: { connectors: [{ id: 'west', kind: 'peg', at: [-0.5, 0.025, 0], mates: ['peg-hole'], bears: true }, { id: 'east', kind: 'peg', at: [0.5, 0.025, 0], mates: ['peg-hole'], bears: true }] } } },
  ]));
  // a shelf on two pegged posts 1.1 m apart, at 1.0 m
  const r = ok(run(w, [
    { op: 'place', tmp: '$w', def: 'peg-post@1', p: [-0.55, 0], r: 0 }, { op: 'place', tmp: '$e', def: 'peg-post@1', p: [0.55, 0], r: Math.PI },
    { op: 'place', tmp: '$s', def: 'peg-shelf@1', p: [0, 1.0 - 0.025, 0], r: 0, anchor: 'center' },
    { op: 'connect', a: { id: '$s', connector: 'west' }, b: { id: '$w', connector: 'hole' } },
    { op: 'connect', a: { id: '$s', connector: 'east' }, b: { id: '$e', connector: 'hole' } },
  ]));
  assert.deepEqual(w.entities.get(r.ids.$s)!.joins, { west: { to: r.ids.$w, at: 'hole' }, east: { to: r.ids.$e, at: 'hole' } });
  refused(run(w, [{ op: 'remove', id: r.ids.$e }]), 'support.none', /hangs by west with east joined to nothing/);
  // a rack beam's end does not mate with a peg hole
  ok(run(w, [{ op: 'place', tmp: '$p', def: 'peg-post@1', p: [10, 0], r: 0 }]));
  const post = [...w.entities.values()].find((e: Entity) => w.resolvedDef(e.def)?.ref === 'peg-post@1' && e.p![0] === 10)!;
  refused(run(w, [{ op: 'place', tmp: '$x', def: 'core/rack-beam@3', p: [10 + 0.05 + BEAM_L / 2, 1.0 - BEAM_H / 2, 0], r: 0, anchor: 'center' },
    { op: 'connect', a: { id: '$x', connector: 'end-l' }, b: { id: post.id, connector: 'hole' } }]), 'connector.incompatible', /beam-end.*does not mate.*peg-hole/);
  // a connector off its part is refused on define
  refused(run(w, [{ op: 'define', def: { schema: 'def/1', name: 'bad-post', version: 1, tags: [], ...box([0.1, 1, 0.1], [{ kind: 'box', at: [0, 0.5, 0], size: [0.1, 1, 0.1] }]),
    components: { connectors: [{ id: 'hole', kind: 'peg-hole', at: [0, 2, 0], mates: ['peg'] }] } } }]), 'def.invalid', /off the part/);
});

test('PC12 A3b: defs without connectors are unchanged; slot parenting still works; copies are loose', () => {
  const w = world();
  // the pallet-rack's beam slots still take a beam by scene parenting (its own, older mechanism)
  const rack = ok(run(w, [{ op: 'place', tmp: '$r', def: 'core/pallet-rack@1', p: [0, 0] }])).ids.$r;
  ok(run(w, [{ op: 'place', def: 'core/rack-beam@1', in: { parent: rack, slot: 'beam-l-3' } }]));
  // a loose beam without connectors may still be placed anywhere, as before
  ok(run(w, [{ op: 'place', def: 'core/rack-beam@2', p: [40, 1.5, 0], r: 0, anchor: 'center' }]));
  // a clone of a joined part is loose
  const w2 = world(), r = ok(run(w2, bayOps()));
  const c = ok(run(w2, [{ op: 'clone', tmp: '$c', id: r.ids.$a, p: [50, UP_L / 2, 10] }]));
  assert.equal(w2.entities.get(c.ids.$c)!.joins, undefined);
});
