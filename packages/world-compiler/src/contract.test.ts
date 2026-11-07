// Contract-commit features: kit/2 defs, float anchoring, facing, clone, prefab when/repeat, river water, generator registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGenerators } from '@souls/generators';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Accepted, type Refused } from './index.ts';

function fresh() { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'contract' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
const refused = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, false); return (r.result as Refused).failures; };

const duck = { schema: 'def/1', name: 'duck', version: 1, tags: ['animal', 'bird'], layer: 'decor', anchor: 'float', size: { box: [0.4, 0.35, 0.25] },
  make: { kind: 'gen', gen: 'kit/2', args: { gait: 'biped-waddle', shapes: [
    { kind: 'sphere', at: [0, 0.12, 0], r: 0.14, scale: [1, 0.75, 1.4], color: '#f2f0e6', role: 'body' },
    { kind: 'sphere', at: [0, 0.27, 0.13], r: 0.07, color: '#2e6b3a', role: 'head' },
    { kind: 'cone', at: [0, 0.26, 0.21], r: 0.03, h: 0.07, pitch: 1.57, color: '#e8a33a', role: 'beak' },
  ] } } };

test('the registry lists every planned generator with an owner', () => {
  const ids = describeGenerators().map((g) => g.id);
  for (const id of ['kit/2', 'building/1', 'stairs/1', 'road/1', 'river/1', 'bridge/1', 'plaza/1', 'scatter/2', 'animals/1', 'deck/1']) assert.ok(ids.includes(id), id);
});

test('kit/2: define a creature as data, physics bounds from shapes; float on the pond, refused on dry land', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'define', def: duck }, { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }, params: { level: -0.2 } }] }, 'god', 1));
  const d = w.def('duck@1')!; const baked = w.bake(d, {}, 0);
  assert.ok(baked.box[0] > 0.25 && baked.box[1] > 0.3, JSON.stringify(baked.box));
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'duck@1', name: 'duck-1', p: [2, 3] }] }, 'god', 2));
  assert.equal(w.get('duck-1')!.p![1], -0.2, 'floats at the water level');
  assert.ok(!w.ground().landforms.some((l) => l.id.endsWith(':pad')), 'no pads under ducks');
  assert.equal(refused(applyBatch(w, { ops: [{ op: 'place', def: 'duck@1', p: [50, 50] }] }, 'god', 3))[0].code, 'float.no-water');
});

test('facing: a bench turns its front toward the fountain', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('fountain'), name: 'fountain', p: [0, 0] }, { op: 'place', def: coreRef('bench'), name: 'b', p: [0, 6], constraints: [{ kind: 'facing', ref: 'fountain' }] }] }, 'god', 1));
  const yaw = w.get('b')!.r as number;
  assert.ok(Math.abs(Math.abs(yaw) - Math.PI) < 1e-6, `faces -z toward the fountain, yaw ${yaw}`);
});

test('clone: copies a subtree with fresh ids and names, stepped; inverse removes them', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', p: [0, 0] }, { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } }] }, 'god', 1));
  const r = applyBatch(w, { ops: [{ op: 'clone', id: 'table', name: 'stall', p: [10, 0], count: 3, step: [4, 0] }] }, 'god', 2); ok(r);
  assert.ok(w.get('stall-1') && w.get('stall-2') && w.get('stall-3'));
  assert.equal(w.get('stall-3')!.p![0], 18);
  assert.ok(w.get('stall-2/bowl'), 'children cloned under the copy');
  assert.equal(w.entities.size, 8);
  ok(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }));
  assert.equal(w.entities.size, 2);
});

test('prefab when/repeat: optional porch and a row of seats from params', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'define', def: { schema: 'def/1', name: 'stand', version: 1, size: { box: [8, 1, 3] }, params: { seats: { type: 'int', min: 1, max: 12, default: 4 }, awning: { type: 'bool', default: false } },
    make: { kind: 'parts', parts: [
      { id: 'seat', def: coreRef('chair'), p: [-3, 0], repeat: { count: '$seats', step: [1.2, 0] } },
      { id: 'awning', def: coreRef('platform'), p: [0, 0, 2.5], when: '$awning', params: { w: 8, d: 3, h: 0.1 } },
    ] } } }, { op: 'place', def: 'stand@1', name: 's1', p: [0, 0], params: { seats: 5 } }, { op: 'place', def: 'stand@1', name: 's2', p: [0, 20], params: { seats: 2, awning: true } }] }, 'god', 1));
  assert.equal(w.subtree(w.get('s1')!.id).length, 1 + 5, 'five seats, no awning');
  assert.equal(w.subtree(w.get('s2')!.id).length, 1 + 2 + 1, 'two seats and an awning');
  assert.equal(w.get('s1/seat-5')!.p![0], -3 + 4 * 1.2);
});

test('river/1 stub carves a bed and lays path water; building/1 stub is hollow with a door and a room slot', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [
    { op: 'define', def: { schema: 'def/1', name: 'river', version: 1, form: 'path', layer: 'volume', size: { box: [10, 2, 10] }, make: { kind: 'gen', gen: 'river/1' } } },
    { op: 'place', def: 'river@1', name: 'brook', shape: { path: [[-50, 0], [50, 0]], width: 6 } },
    { op: 'define', def: { schema: 'def/1', name: 'house', version: 1, size: { box: [8, 3, 6] }, make: { kind: 'gen', gen: 'building/1' }, components: { foundation: { kind: 'pad' } } } },
    { op: 'place', tmp: '$h', def: 'house@1', name: 'house', p: [0, 40] },
    { op: 'place', def: coreRef('table'), name: 'table', in: { parent: '$h', slot: 'ground' }, p: [0, 0, 0] },
  ] }, 'god', 1));
  assert.ok(w.terrain.sample(0, 0) < -1, 'bed carved');
  assert.ok(w.ground().waters.some((x) => x.path), 'path water');
  const h = w.get('house')!; const baked = w.bake(w.resolvedDef(h.def)!, h.params ?? {}, 0);
  assert.ok(baked.colliders.length >= 4 && baked.openings!.some((o) => o.id === 'front-door') && baked.rooms!.length >= 1);
  assert.equal(w.get('house/table')!.in.slot, 'ground');
});

test('persistent relationships: the bench keeps facing the fountain when it moves; houses ride along a road; things re-settle on new hills; ducks follow the water level', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [
    { op: 'define', def: duck },
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [0, 0] },
    { op: 'place', def: coreRef('bench'), name: 'b', p: [0, 8], constraints: [{ kind: 'facing', ref: 'fountain' }] },
    { op: 'define', def: { schema: 'def/1', name: 'road', version: 1, form: 'path', layer: 'surface', size: { box: [10, 0.1, 10] }, make: { kind: 'gen', gen: 'road/1' } } },
    { op: 'place', def: 'road@1', name: 'lane', shape: { path: [[-50, 40], [50, 40]], width: 6 } },
    { op: 'place', def: coreRef('cottage'), name: 'h1', p: [0, 0], constraints: [{ kind: 'along', ref: 'lane', t: 0.25, side: 'left', offset: 6 }] },
    { op: 'place', def: coreRef('rock'), name: 'rock', p: [100, 100] },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[200, 200], [220, 200], [220, 220], [200, 220]] }, params: { level: -0.2 } },
    { op: 'place', def: 'duck@1', name: 'duck', p: [210, 210] },
  ] }, 'god', 1));
  ok(applyBatch(w, { ops: [{ op: 'move', id: 'fountain', p: [20, 8] }] }, 'god', 2));
  const yaw = w.get('b')!.r as number;
  assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-6, `bench turned east to face the moved fountain: ${yaw}`);
  ok(applyBatch(w, { ops: [{ op: 'move', id: 'lane', shape: { path: [[-50, 60], [50, 60]], width: 6 } }] }, 'god', 3));
  const h1 = w.get('h1')!; assert.ok(Math.abs(h1.p![h1.p!.length - 1] - (60 + 9)) < 1e-6 || Math.abs(h1.p![h1.p!.length - 1] - (60 - 9)) < 1e-6, `house rode with the road: ${JSON.stringify(h1.p)}`);
  const y0 = w.get('rock')!.p![1];
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('hill'), name: 'hill', p: [100, 100], params: { height: 20, radius: 60 } }] }, 'god', 4));
  assert.ok(w.get('rock')!.p![1] > y0 + 15, 'rock sits on top of the new hill, not inside it');
  ok(applyBatch(w, { ops: [{ op: 'set', id: 'pond', params: { level: 0.5 } }] }, 'god', 5));
  assert.equal(w.get('duck')!.p![1], 0.5, 'duck rose with the water');
});


test('an unrelated pond in the same terrain tile preserves explicit slab-supported height', () => {
  const w = fresh();
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('bench'),name:'deck-bench',p:[-12,.373,-18]}]},'god',1));
  const before = structuredClone(w.get('deck-bench'));
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('pond'),name:'distant-pond',shape:{area:[[-48,-48],[-40,-48],[-40,-40],[-48,-40]]},params:{depth:2}}]},'god',2));
  assert.deepEqual(w.get('deck-bench'),before,'coarse tile invalidation is not a change to this support');
});

test('foundation pads cannot hide terrain changes from building resettlement', () => {
  const w = fresh();
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('knoll'),name:'hill',p:[40,10],params:{height:5,radius:20}}]},'god',1));
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('cottage'),name:'house',p:[48,10]}]},'god',2));
  const house=w.get('house')!, y=house.p![1];
  assert.ok(w.ground().landforms.some(l=>l.id===`${house.id}:pad`));
  ok(applyBatch(w,{ops:[{op:'set',id:'hill',params:{height:1}}]},'god',3));
  assert.ok(w.get('house')!.p![1]<y-.5,'remove the old pad before measuring its new support');
});
