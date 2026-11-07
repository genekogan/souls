// W7 soundscape planning (no WebAudio): lists of sounds per def, variants per instance, ambience by place and time,
// residents' chatter and footsteps, the visitor's feet, and settings that persist.
//   node --test apps/web/src/gen-mesh/sound-plan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentsSchema, coreLibrary } from '@souls/world-compiler';
import { ambienceAt, condition, DEFAULT_SETTINGS, distanceTo, emittersOf, exposureAt, impliedSpecs, treeIndex, treesOf, loadSettings, Movement, saveSettings, SETTINGS_KEY, specsOf, variantOf, VARIANTS, KINDS, MASTER_DEFAULT, QueuedNotes } from './sound-plan.ts';

test('a def may carry one sound or a list; unknown kinds are dropped; the schema accepts both', () => {
  assert.equal(specsOf({ components: { sound: { kind: 'water', radius: 10, volume: 0.5 } } } as never).length, 1);
  const two = specsOf({ components: { sound: { kind: 'water', radius: 10, volume: 0.5, also: [{ kind: 'hum', radius: 6, volume: 0.2 }, { kind: 'nope' }] } } } as never);
  assert.deepEqual(two.map((s) => s.kind), ['water', 'hum']);
  assert.ok(componentsSchema.safeParse({ sound: { kind: 'water', also: [{ kind: 'chatter', variant: 2 }] } }).success);
  assert.ok(componentsSchema.safeParse({ sound: { kind: 'crickets' } }).success);
  assert.ok(!componentsSchema.safeParse({ sound: { kind: 'kazoo' } }).success);
  assert.ok(!componentsSchema.safeParse({ sound: { kind: 'water', also: [] } }).success);
});

test('every kind has more than one voicing, and instances spread over them', () => {
  for (const k of KINDS) assert.ok(VARIANTS[k] >= 2, k);
  const seen = new Set<number>(); for (let i = 0; i < 40; i++) seen.add(variantOf('birds', `fountain-${i}`));
  assert.equal(seen.size, VARIANTS.birds);
  assert.equal(variantOf('music', 'x', 6), 6 % VARIANTS.music);   // a pinned variant wins
});

test('emittersOf: each spec of a multi-sound def is its own emitter with its own variant', () => {
  const def = { components: { sound: { kind: 'water', radius: 10, volume: 0.5, also: [{ kind: 'birds', radius: 20, volume: 0.3 }] } }, state: { on: { default: true } }, form: 'point', size: { box: [1, 2, 1] } };
  const model = {
    entities: new Map([['f1', { id: 'f1', def: 'd', in: { parent: 'world' }, params: { soundVariant: 2 } }], ['f2', { id: 'f2', def: 'd', in: { parent: 'world' }, params: {} }]]),
    resolvedDef: () => def, worldPose: () => ({ x: 1, y: 0, z: 2, s: 1 }), terrain: { sample: () => 0 },
  };
  const em = emittersOf(model as never);
  assert.deepEqual(em.map((e) => e.id), ['f1#0', 'f1#1', 'f2#0', 'f2#1']);
  assert.equal(em[0].spec.variant, 2);
  assert.deepEqual(em[0].pts, [[1, 1, 2]]);
  assert.ok(em.every((e) => e.source === 'object' && e.state.on === true));
});

test('ambience: no wind bed (lane S3), birds by day, crickets by night, waves near water, muffled indoors', () => {
  const base = { x: 10, y: 1.7, z: 10, ground: 0, night: 0, covered: false, waters: [] as never[] };
  const day = ambienceAt(base), night = ambienceAt({ ...base, night: 1 });
  assert.ok(!day.some((e) => e.spec.kind === 'wind') && !ambienceAt({ ...base, y: 60, exposure: 1 }).some((e) => e.spec.kind === 'wind'));
  assert.ok(day.some((e) => e.spec.kind === 'birds') && !day.some((e) => e.spec.kind === 'crickets'));
  assert.ok(night.some((e) => e.spec.kind === 'crickets') && !night.some((e) => e.spec.kind === 'birds'));
  const lake = ambienceAt({ ...base, waters: [{ area: [[0, 0], [5, 0], [5, 5], [0, 5]], level: 0 }] });
  assert.ok(lake.some((e) => e.spec.kind === 'waves' && e.area));
  const inside = ambienceAt({ ...base, covered: true });
  const birds = (a: ReturnType<typeof ambienceAt>) => a.filter((e) => e.spec.kind === 'birds').reduce((v, e) => v + e.spec.volume, 0);
  assert.ok(birds(inside) < birds(day));
  // deterministic: the same place gives the same singers
  assert.deepEqual(ambienceAt(base).map((e) => e.id), day.map((e) => e.id));
});

test('residents: footsteps where they walk, chatter where two or more stand together; the visitor walks at eye height', () => {
  const m = new Movement(), cam = { x: 0, y: 1.7, z: 0, ground: 0 };
  m.emitters([{ id: 'a', p: [0, 0, 0] }, { id: 'b', p: [2, 0, 0] }, { id: 'c', p: [20, 0, 0] }], cam, 0);
  const out = m.emitters([{ id: 'a', p: [0, 0, 0] }, { id: 'b', p: [2, 0, 0] }, { id: 'c', p: [20.5, 0, 0] }], { ...cam, x: 0.5 }, 0.5);
  assert.ok(out.some((e) => e.id === 'res:steps:c' && e.spec.kind === 'footsteps'));
  assert.ok(out.some((e) => e.id === 'res:chatter:a+b' && e.spec.kind === 'chatter' && e.state.size === 2));
  assert.ok(out.some((e) => e.id === 'me:steps' && e.source === 'visitor'));
  const high = m.emitters([], { x: 3, y: 40, z: 0, ground: 0 }, 1.0);
  assert.ok(!high.some((e) => e.id === 'me:steps'), 'no footsteps from an overhead camera');
});

test('settings: quiet by default, music on (the playlist, lane S3), remembered, robust to junk and to storage failures', () => {
  assert.deepEqual(loadSettings(null), { ...DEFAULT_SETTINGS });
  assert.ok(MASTER_DEFAULT <= 0.35 && DEFAULT_SETTINGS.music === true && DEFAULT_SETTINGS.muted === false);
  const mem = new Map<string, string>(), store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveSettings(store, { muted: true, volume: 0.2, music: true });
  assert.deepEqual(loadSettings(store), { muted: true, volume: 0.2, music: true });
  mem.set(SETTINGS_KEY, '{bad'); assert.deepEqual(loadSettings(store), { ...DEFAULT_SETTINGS });
  saveSettings({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, DEFAULT_SETTINGS);   // must not throw
});

// ---- release 3.1: a fuller soundscape
const fakeModel = (ents: [string, string, [number, number]][], defs: Record<string, unknown>) => ({
  entities: new Map(ents.map(([id, def, p]) => [id, { id, def, in: { parent: 'world' }, params: {}, p }])),
  resolvedDef: (d: string) => defs[d], worldPose: (e: { p: [number, number] }) => ({ x: e.p[0], y: 0, z: e.p[1], s: 1 }), terrain: { sample: () => 0 },
});

test('implied sounds: things sound like what they are; sounding things gain a second sound; no phantom work', () => {
  const kinds = (d: unknown) => impliedSpecs(d as never).map((s) => `${s.kind}${s.when ? '@' + s.when : ''}`);
  assert.deepEqual(kinds({ name: 'core-tree', form: 'point', tags: ['plant', 'tree', 'oak'] }), ['leaves']);
  assert.equal(impliedSpecs({ name: 'core-pine', tags: ['tree', 'pine'] } as never)[0].variant, 1);
  assert.deepEqual(kinds({ name: 'core-woodland', form: 'area', tags: ['cover', 'forest', 'plant'] }), ['leaves']);
  assert.deepEqual(kinds({ name: 'core-log', tags: ['log', 'wood', 'forest'] }), []);
  assert.deepEqual(kinds({ name: 'core-flower-bed', tags: ['plant', 'flowers', 'garden'] }), ['bees@day']);
  assert.deepEqual(kinds({ name: 'core-reedbed', form: 'area', tags: ['cover', 'water', 'plant'] }), ['frogs@night', 'leaves']);
  assert.deepEqual(kinds({ name: 'core-duck', tags: ['creature', 'duck', 'bird', 'water'] }), ['waterfowl@day']);
  assert.deepEqual(kinds({ name: 'core-flag', tags: [] }), ['flag']);
  assert.deepEqual(kinds({ name: 'core-mars-white-fridge', tags: ['mars', 'kitchen', 'fridge'] }), ['hum']);
  assert.deepEqual(kinds({ name: 'core-mars-kitchen', tags: ['mars', 'building', 'kitchen'] }), [], 'a kitchen with nobody in it is silent');
  assert.deepEqual(kinds({ name: 'core-fountain', tags: ['fountain', 'water'], components: { sound: { kind: 'water', radius: 14, volume: 0.5 } } }), ['water', 'birds@day']);
  assert.deepEqual(kinds({ name: 'core-watermill', tags: ['water', 'mill'], components: { sound: { kind: 'water', radius: 22, volume: 0.5, when: 'on' } } }), ['stream']);
  // and the fountain sounds as three emitters: its own water, the drip and the pigeons
  const fountain = { name: 'core-fountain', form: 'point', tags: ['fountain'], size: { box: [2, 2, 2] }, components: { sound: { kind: 'water', radius: 14, volume: 0.5 } } };
  const em = emittersOf(fakeModel([['f', 'fo', [0, 0]]], { fo: fountain }) as never);
  assert.deepEqual(em.map((e) => `${e.id}:${e.spec.kind}`), ['f#0:water', 'f#1:water', 'f#2:birds']);
});

test('a wood rustles as one voice per cluster, louder than a single tree; the distance is to the nearest tree', () => {
  const tree = { name: 'core-tree', form: 'point', tags: ['tree'], size: { box: [4, 8, 4] } };
  const ents: [string, string, [number, number]][] = [['lone', 't', [100, 100]]];
  for (let i = 0; i < 12; i++) ents.push([`w${i}`, 't', [2 + (i % 4) * 4, 2 + Math.floor(i / 4) * 5]]);
  const em = emittersOf(fakeModel(ents, { t: tree }) as never).filter((e) => e.spec.kind === 'leaves');
  assert.equal(em.length, 2, 'one cluster for the wood, one for the lone tree');
  const wood = em.find((e) => e.pts.length === 12)!, lone = em.find((e) => e.pts.length === 1)!;
  assert.ok(wood.cloud && wood.spec.volume > lone.spec.volume && wood.spec.volume <= 0.3);
  assert.ok(distanceTo(wood, 2, 4, 2) < 0.01);
  // the trees index puts birds in the wood, not in the open
  const idx = treeIndex(treesOf(fakeModel(ents, { t: tree }) as never));
  assert.equal(idx.count, 13);
  const base = { y: 1.7, ground: 0, night: 0, covered: false, waters: [] as never[], trees: idx };
  const inWood = ambienceAt({ ...base, x: 8, z: 8 }).filter((e) => e.spec.kind === 'birds');
  assert.ok(inWood.some((e) => e.id === 'amb:birds:0,0' && e.pts[0][1] > 2), 'a singer up in a tree of the wood');
  const far = ambienceAt({ ...base, x: 400, z: 400 }).filter((e) => e.spec.kind === 'birds');
  assert.ok(far.every((e) => e.spec.volume <= 0.1 + 1e-9), 'beside a wooded world, open ground has only rare quiet birds');
});

test('exposure still measures open, high ground (reported in state); the sea follows the listener', () => {
  const crowd: [number, number, number][] = Array.from({ length: 10 }, (_, i) => [i, 2, 0] as [number, number, number]);
  const sheltered = exposureAt(0, 0, 0, 0, crowd), open = exposureAt(0, 0, 0, 0, []), hill = exposureAt(0, 0, 14, 0, []);
  assert.ok(sheltered < open && open < hill && hill === 1, `${sheltered} ${open} ${hill}`);
  const shore = ambienceAt({ x: 0, y: 1.7, z: 0, ground: 0.5, night: 0, covered: false, waters: [] as never[], seaLevel: 0 });
  assert.ok(shore.find((e) => e.id === 'amb:sea')?.follow === true);
});

test('day/night conditions follow the world clock; frogs at ponds by night, gulls over the sea by day', () => {
  assert.equal(condition('night', {}, 0.9), true); assert.equal(condition('day', {}, 0.9), false); assert.equal(condition('!night', {}, 0.1), true);
  assert.equal(condition('night', { night: false }, 0.9), false, "an entity's own state wins");
  const base = { x: 2, y: 1.7, z: 2, ground: 0, covered: false, waters: [{ area: [[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][], level: 0 }] };
  assert.ok(ambienceAt({ ...base, night: 1 }).some((e) => e.spec.kind === 'frogs' && e.area));
  assert.ok(!ambienceAt({ ...base, night: 0 }).some((e) => e.spec.kind === 'frogs'));
  const sea = { x: 0, y: 1.7, z: 0, ground: 0.5, covered: false, waters: [], seaLevel: 0 };
  assert.ok(ambienceAt({ ...sea, night: 0 }).some((e) => e.id === 'amb:gulls' && e.spec.kind === 'waterfowl'));
  assert.ok(!ambienceAt({ ...sea, night: 1 }).some((e) => e.id === 'amb:gulls'));
});

test('a resident who is speaking murmurs where they stand, alone or not; silent residents do not', () => {
  const m = new Movement(), cam = { x: 0, y: 1.7, z: 0, ground: 0 };
  const out = m.emitters([{ id: 'a', p: [5, 0, 5], speaking: true }, { id: 'b', p: [30, 0, 0] }], cam, 0);
  const talk = out.filter((e) => e.id.startsWith('res:talk:'));
  assert.deepEqual(talk.map((e) => e.id), ['res:talk:a']);
  assert.equal(talk[0].spec.kind, 'chatter'); assert.equal(talk[0].state.size, 1); assert.equal(talk[0].pts[0][1], 1.6);
});

// #422: a piano note scheduled ahead never sounds once its player has stopped; a begun note keeps its decay.
test('queued notes: a stopped player loses only the notes that have not begun', () => {
  const q = new QueuedNotes<string>();
  q.add('a', 10.0, ['a-begun']); q.add('a', 10.2, ['a-next', 'a-next-octave']); q.add('b', 10.3, ['b-next']);
  assert.deepEqual(q.settle(10.1, new Set(['a', 'b'])), [], 'both playing: nothing cancelled');
  assert.equal(q.size, 2, 'the begun note is forgotten, not cancelled');
  assert.deepEqual(q.settle(10.15, new Set(['b'])), ['a-next', 'a-next-octave'], 'a stopped: its not-yet-begun note is silenced');
  assert.deepEqual(q.settle(10.35, new Set()), [], 'b had begun before it stopped');
  assert.equal(q.size, 0);
});

test('a switched-off record player is silent, whatever record is set (#1051)', () => {
  const def = coreLibrary().get('core/record-player@1')!, spec = (def.components as { sound: { when: string } }).sound;
  const model = fakeModel([['p', 'rp', [0, 0]]], { rp: def }), [em] = emittersOf(model as never);
  assert.equal(em.spec.when, 'on');
  assert.equal(condition(spec.when, { on: false, record: 'Low Tide' }), false, 'off: no emitter sounds and no note is scheduled (playJukeboxes reads this gate first)');
  assert.equal(condition(spec.when, { on: true, record: 'Low Tide' }), true);
});
