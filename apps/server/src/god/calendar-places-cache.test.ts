import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Entity } from '@souls/world-compiler';
import { Objects } from '../edge/comms/objects/framework.ts';
import { calendarKind } from '../edge/comms/objects/calendar.ts';
import { ensureCommsSchema } from '../edge/comms/store.ts';
import type { CommsCore } from '../edge/comms/core.ts';
import { PlaceIndex, type Place } from '../edge/ledger/places.ts';
import { EngineBridge } from './engine-bridge.ts';
import { GodLayers, type LayersHost } from './layers.ts';
import { humanTitle } from './meaning.ts';
import { GodPlaces, type PlacesHost } from './places.ts';
import { GodPlaces as LegacyPlaces } from './places-membership-reference.fixture.ts';
import { GodNav, type Thing } from './nav.ts';

// The frozen writer predates meaning. Compare every physical field, then assert
// the new generic-vocabulary classification explicitly below.
const physical = (places: ReturnType<GodPlaces['list']>) => places.map(({name: _n, aliases: _a, genericAliases: _g, semanticParent: _p, semanticRole: _r, semanticKind: _k, salience: _s, parts: _parts, ...p}) => ({...p, ...(p.of === 'shore' ? {description: 'shore'} : {})}));

type Lookup = (e: Entity) => { id: string; name: string } | null;
function fixture(memo = true) {
  const model = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'calendar-places' });
  for (const d of CORE_KIT) model.defineDef(d, 'core', 0);
  const act = (ops: unknown[]) => { const r = applyBatch(model, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  act([
    { op: 'place', def: coreRef('plaza'), name: 'alpha', shape: { area: [[-20, -10], [-10, -10], [-10, 0], [-20, 0]] } },
    { op: 'place', def: coreRef('plaza'), name: 'beta', shape: { area: [[10, -10], [20, -10], [20, 0], [10, 0]] } },
    { op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 20] },
  ]);
  const engine = { world: { tick: 0, entities: {} } }, clock = { origin: 0, dayTicks: 72000 };
  const root: Place = { id: 'world', name: 'World', kind: 'outdoor', parent: null, polygon: [[-200, -200], [200, -200], [200, 200], [-200, 200]], level: 0, enclosed: false, capacity: null, starting: true };
  const edge = { places: new PlaceIndex({ contract: 'place-data/1', world: 'test', places: [root] }) };
  let deferred = false, edits = 0;
  // The test isolates place/calendar derivation from navigation raster work; area things have the compiler's real paths.
  const nav = { things: (): Thing[] => [...model.entities.values()].filter(e => e.shape && 'area' in e.shape).map(e => ({
    id: e.id, ref: model.pathOf(e.id), name: e.name ?? e.id, kind: 'area', what: 'plaza', words: [], at: [0, 0], level: 0,
    area: (e.shape as { area: [number, number][] }).area,
  })) } as GodNav;
  // Exercise the production bridge lookup without booting an engine/world or registering listeners.
  const bridge = Object.assign(Object.create(EngineBridge.prototype), { god: { model }, edge, version: 0, levelAt: () => 0 }) as { version: number; calendarPlaces(sources: readonly Entity[]): Lookup; layerPlace: Lookup };
  const host: PlacesHost = { model, nav, edge: edge as never, version: () => `${edits}:${Math.floor(engine.world.tick / 1200)}`, ...(memo ? { structuralVersion: () => bridge.version } : {}), deferred: () => deferred, engineOwned: () => false, levelAt: () => 0, log: () => {} };
  const places = new GodPlaces(host); Object.assign(bridge, { places });
  return { model, act, engine, clock, edge, places, bridge, host, nav, sources: () => [...model.entities.values()],
    edited() { edits++; bridge.version++; }, defer(on: boolean) { deferred = on; } };
}

test('calendar own-place identities survive minute changes; ordinary place reads still refresh', () => {
  const f = fixture(), sources = f.sources(), initial = f.places.calendarIdentities(sources, f.bridge.version);
  assert.deepEqual(initial.get(f.model.get('alpha')!.id), { id: 'g-alpha', name: 'Alpha' });
  const derives = f.places.stats.derives;
  f.engine.world.tick = 2400;
  assert.strictEqual(f.places.calendarIdentities(sources, f.bridge.version), initial);
  assert.equal(f.places.stats.derives, derives);
  f.places.list();
  assert.equal(f.places.stats.derives, derives + 1, 'normal description freshness is unchanged');
  assert.notStrictEqual(f.places.calendarIdentities(sources, f.bridge.version), initial, 'a new installed index invalidates identities');
});

test('calendar identities invalidate for model edits, non-map bridge revisions and deferred installs', () => {
  const f = fixture(), alpha = f.model.get('alpha')!;
  f.places.list(); // Deferred reads keep a previously installed full index.
  let before = f.places.calendarIdentities(f.sources(), f.bridge.version);
  f.model.entities.set(alpha.id, { ...alpha, name: 'renamed' });
  assert.notStrictEqual(f.places.calendarIdentities(f.sources(), f.bridge.version), before, 'map mutations invalidate independently of bridge revision');
  f.edited();
  f.defer(true);
  const deferred = f.places.calendarIdentities(f.sources(), f.bridge.version);
  assert.notStrictEqual(deferred, before);
  assert.deepEqual(deferred.get(alpha.id), { id: 'g-alpha', name: 'Alpha' }, 'existing deferred-read semantics remain');
  f.defer(false); f.places.sync(true);
  const installed = f.places.calendarIdentities(f.sources(), f.bridge.version);
  assert.deepEqual(installed.get(alpha.id), { id: 'g-renamed', name: 'Renamed' }, 'the completed install replaces a deferred identity');
  before = installed;
  for (const edit of [() => { f.model.state = { ...f.model.state, constitution: 'updated' }; }, () => { const g = f.model.ground(); f.model.terrain.update({ ...g, extent: [-210, -200, 200, 200] }, []); }]) {
    const safetyKey = f.model.safetyCacheKey(); edit(); f.bridge.version++;
    assert.strictEqual(f.model.safetyCacheKey(), safetyKey, 'terrain/state are outside the map safety key');
    const after = f.places.calendarIdentities(f.sources(), f.bridge.version);
    assert.notStrictEqual(after, before, 'bridge revision invalidates even without a map change'); before = after;
  }
});

test('calendar misses use live native names, containment and moved source positions', () => {
  const f = fixture(), bench = f.model.get('bench')!, lookup = f.bridge.calendarPlaces(f.sources());
  assert.deepEqual(lookup(bench), { id: 'world', name: 'World' });
  const native: Place = { ...f.edge.places.byId.get('world')!, id: 'native', name: 'Native hall', parent: 'world', polygon: [[-2, 18], [2, 18], [2, 22], [-2, 22]] };
  f.edge.places.add(native);
  assert.deepEqual(lookup(bench), { id: 'native', name: 'Native hall' });
  f.edge.places.byId.set(native.id, { ...native, name: 'Renamed hall' });
  assert.deepEqual(lookup(bench), { id: 'native', name: 'Renamed hall' });
  f.act([{ op: 'move', id: 'bench', p: [30, 20] }]); f.edited();
  const moved = f.model.get('bench')!;
  assert.deepEqual(f.bridge.calendarPlaces(f.sources())(moved), { id: 'world', name: 'World' });
  f.edge.places.byId.delete(native.id);
  assert.deepEqual(lookup(bench), { id: 'world', name: 'World' });
});

test('new calendar sources entering the horizon reuse primed identities and match uncached records', () => {
  const f = fixture(), db = new DatabaseSync(':memory:'); ensureCommsSchema(db);
  try {
    const objects = new Objects({ db, worldId: 'calendar-places', now: () => 1000, tick: () => f.engine.world.tick, nameOf: (id: string) => id } as CommsCore);
    objects.register(calendarKind);
    let prepared = 0;
    const host: LayersHost = { model: f.model, engine: f.engine, living: () => f.clock, edge: { comms: { objects } } as never,
      engineAct: () => { throw new Error('no follow states'); }, log: message => { throw new Error(message); },
      placeOf: e => f.bridge.layerPlace(e), calendarPlaces: sources => { prepared++; return f.bridge.calendarPlaces(sources); } };
    const layers = new GodLayers(host), c = layers.clock()!;
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    f.act([
      { op: 'set', id: 'alpha', schedule: { events: [{ name: 'today', at: '06:00', minutes: 60, days: [weekdays[c.weekday]] }] } },
      { op: 'set', id: 'beta', schedule: { events: [{ name: 'tomorrow', at: '06:30', minutes: 60, days: [weekdays[(c.weekday + 1) % 7]] }] } },
    ]); f.edited();
    assert.equal(layers.step().posted, 1); assert.equal(prepared, 1);
    const derives = f.places.stats.derives;
    assert.equal(layers.step().posted, 0); assert.equal(prepared, 1, 'no lookup preparation without a new occurrence');
    f.engine.world.tick = 1500; // 06:30; a new description bucket and tomorrow's event enters the horizon.
    assert.equal(layers.step().posted, 1); assert.equal(prepared, 2);
    assert.equal(f.places.stats.derives, derives, 'even the source first posted later was primed');
    const generated = objects.all().find(o => o.name === 'tomorrow')!;
    const params = objects.creationParams(generated.id)!;
    assert.equal(params.placeId, 'g-beta'); assert.equal(params.placeName, 'Beta');
    assert.equal(params.startsAtTick, 73500); assert.equal(params.durationTicks, 3000);
    assert.deepEqual(params.godSchedule, { entity: f.model.get('beta')!.id, event: 'tomorrow', date: new Date(Date.parse(c.day) + 86400_000).toISOString().slice(0, 10) });
    objects.remove(generated.id);
    delete host.calendarPlaces;
    assert.equal(layers.step().posted, 1);
    assert.deepEqual(objects.creationParams(generated.id), params, 'uncached creation has identical identity, text, timing and provenance');
  } finally { db.close(); }
});

test('cold identities after an edit skip decoration, and the next full read reuses owned membership', t => {
  const f = fixture(); f.places.list();
  f.engine.world.tick = 2400; f.edited();
  const internals = f.places as unknown as { describe(...args: never[]): string; layer(...args: never[]): void };
  const describe = t.mock.method(internals, 'describe'), layer = t.mock.method(internals, 'layer');
  const before = { ...f.places.stats };
  const own = f.places.calendarIdentities(f.sources(), f.bridge.version);
  assert.deepEqual(own.get(f.model.get('alpha')!.id), { id: 'g-alpha', name: 'Alpha' });
  assert.equal(f.places.stats.derives, before.derives);
  assert.equal(f.places.stats.memberships, before.memberships + 1);
  assert.equal(describe.mock.callCount(), 0); assert.equal(layer.mock.callCount(), 0);
  f.places.list();
  assert.equal(f.places.stats.derives, before.derives + 1);
  assert.equal(f.places.stats.memberships, before.memberships + 1, 'full read does not repeat the membership pass');
  assert.ok(describe.mock.callCount() > 0);
});

test('mutable public polygons and descriptions cannot contaminate the membership memo', () => {
  const f = fixture(); f.places.calendarIdentities(f.sources(), f.bridge.version);
  const publicList = f.places.list(), expected = structuredClone(publicList), builds = f.places.stats.memberships;
  publicList[0].polygon[0][0] = 9999; publicList[0].polygon.push([999, 999]);
  publicList[0].name = 'changed by caller'; publicList[0].description = 'changed by caller';
  publicList[0].schedule = [{ id: 'caller', cron: '* * * * *' }]; publicList.reverse();
  f.engine.world.tick = 1200;
  assert.deepEqual(f.places.list(), expected);
  assert.equal(f.places.stats.memberships, builds);
  assert.deepEqual(f.places.calendarIdentities(f.sources(), f.bridge.version).get(f.model.get('alpha')!.id), { id: 'g-alpha', name: 'Alpha' });
});

test('membership reuse requires a structural host version and tracked model maps', () => {
  const unversioned = fixture(false);
  unversioned.places.calendarIdentities(unversioned.sources(), 0);
  assert.equal(unversioned.places.stats.memberships, 1);
  unversioned.places.list(); assert.equal(unversioned.places.stats.memberships, 2);
  unversioned.engine.world.tick = 1200; unversioned.places.list();
  assert.equal(unversioned.places.stats.memberships, 3);
  const untracked = fixture();
  untracked.model.entities = new Map(untracked.model.entities);
  untracked.places.calendarIdentities(untracked.sources(), 0);
  untracked.places.calendarIdentities(untracked.sources(), 0);
  assert.equal(untracked.places.stats.memberships, 2);
});

test('navigation level changes invalidate cold calendar identities and membership without a model or caller revision change', () => {
  const f = fixture(), alpha = f.model.get('alpha')!;
  let buildingLevel = 0, describeEpoch = 0, levels = 1;
  f.host.structuralVersion = () => `${f.bridge.version}:${describeEpoch}:${levels}`;
  const poly: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  f.nav.things = (): Thing[] => [
    { id: alpha.id, ref: 'alpha', name: 'alpha', kind: 'building', what: 'building', words: [], at: [0, 0], level: buildingLevel },
    { id: alpha.id, ref: 'alpha/room', name: 'room', kind: 'room', what: 'room', words: [], at: [0, 0], level: 1, poly },
  ];
  const model = f.model.safetyCacheKey(), revision = f.bridge.version;
  const first = f.places.calendarIdentities(f.sources(), revision);
  assert.equal(first.get(alpha.id), null, 'a building without rooms on its level has no own place');
  buildingLevel = 1; levels++;
  const added = f.places.calendarIdentities(f.sources(), revision);
  assert.notStrictEqual(added, first);
  assert.deepEqual(added.get(alpha.id), { id: 'g-alpha', name: 'Alpha' });
  assert.equal(f.places.stats.memberships, 2, 'new levels invalidate membership as well as the identity shortcut');
  buildingLevel = 0; describeEpoch++;
  const reused = f.places.calendarIdentities(f.sources(), revision);
  assert.notStrictEqual(reused, added); assert.equal(reused.get(alpha.id), null);
  assert.equal(f.places.stats.memberships, 3, 'level reuse invalidates even when the level count stays constant');
  assert.strictEqual(f.model.safetyCacheKey(), model); assert.equal(f.bridge.version, revision);
  assert.strictEqual(f.places.calendarIdentities(f.sources(), revision), reused);
});

test('membership provenance begins before yielding Things acquisition, including existing memo reuse', () => {
  const f = fixture(), alpha = f.model.get('alpha')!;
  f.places.list(); const builds = f.places.stats.memberships;
  f.nav.thingsGen = function* () { const things = structuredClone(f.nav.things()); yield; return things; };
  f.engine.world.tick = 1200;
  assert.equal(f.places.syncStep(Number.MIN_VALUE), false);
  f.model.entities.set(alpha.id, { ...alpha, name: 'renamed' }); f.bridge.version++;
  assert.equal(f.places.syncStep(Infinity), true);
  assert.equal(f.places.stats.memberships, builds + 1, 'the old memo cannot be reused after Things acquisition crossed an edit');
  assert.equal((f.places as unknown as { membership?: unknown }).membership, undefined, 'mixed-provenance Things cannot be memoized under the newer model');
  f.engine.world.tick = 2400;
  assert.ok(f.places.list().some(p => p.id === 'g-renamed'));
  assert.equal(f.places.stats.memberships, builds + 2);
  assert.ok((f.places as unknown as { membership?: unknown }).membership, 'a later stable full derive can memoize');
});

test('sliced full places finish under ongoing engine writebacks without memoizing unstable membership', () => {
  const f = fixture(), alpha = f.model.get('alpha')!, bench = f.model.get('bench')!;
  f.nav.things = () => Array.from({ length: 96 }, (_, i): Thing => ({
    id: alpha.id, ref: `area-${i}`, name: 'area', kind: 'area', what: 'an area', words: [], at: [i * 3, 0], level: 0,
    area: [[i * 3, 0], [i * 3 + 2, 0], [i * 3 + 2, 2], [i * 3, 2]],
  }));
  f.nav.thingsGen = function* () { yield; return f.nav.things(); };
  let slices = 0;
  while (!f.places.syncStep(Number.MIN_VALUE)) {
    assert.ok(++slices < 100, 'ordinary publication must make progress under writebacks');
    f.model.entities.set(bench.id, { ...bench }); f.bridge.version++;
  }
  assert.ok(slices > 2); assert.equal(f.places.stats.derives, 1);
  assert.equal(f.places.stats.memberships, 1);
  assert.equal((f.places as unknown as { membership?: unknown }).membership, undefined);
  assert.equal(f.edge.places.byId.has('g-area-0'), true);
  assert.equal(f.places.syncStep(Infinity), true);
  assert.equal(f.places.stats.derives, 1, 'engine-only edits keep the original installed-index freshness rule');
});

test('shared membership retains full legacy places, calendar identities, and current decoration', () => {
  const f = fixture();
  f.act([
    { op: 'place', def: coreRef('roundhouse'), name: 'house', p: [60, 40] },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[40, -40], [50, -40], [50, -30], [40, -30]] }, params: { depth: .3, level: 0, edge: 1 } },
    { op: 'place', def: coreRef('gazebo'), name: 'gazebo', p: [-70, 20] },
    { op: 'place', def: coreRef('obelisk'), name: 'needle', p: [-70, -40] },
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [-15, -5] },
    { op: 'place', def: coreRef('hill'), name: 'hill', p: [110, 110], params: { height: 5, radius: 20 } },
    { op: 'set', id: 'alpha', schedule: { events: [{ name: 'market', at: '06:00', minutes: 60 }] } },
  ]); f.edited();
  const ground = f.model.ground(); f.model.terrain.update({ ...ground, extent: [-220, -200, 200, 200] }, []); f.edited();
  const nav = new GodNav({ model: f.model, version: () => f.bridge.version, engine: f.engine as never, levelAt: () => 0, engineOwned: () => false });
  f.host.nav = nav;
  f.host.layers = { active: () => true, dayKey: () => 'test-day', slotsFor: () => [{ id: 'market', cron: '0 6 * * *', label: `market ${f.engine.world.tick}` }],
    tag: () => `clock ${f.engine.world.tick}`, peopleAt: () => '', onNow: () => '' };
  const legacy = new LegacyPlaces(f.host);
  const compare = () => {
    const sources = f.sources(), expected = legacy.list();
    const own = f.places.calendarIdentities(sources, f.bridge.version), builds = f.places.stats.memberships;
    for (const e of sources) {
      const p = legacy.ofEntity(e.id);
      assert.deepEqual(own.get(e.id), p ? { id: p.id, name: humanTitle(p.ref) } : null);
    }
    const actual = f.places.list();
    assert.deepEqual(physical(actual), physical(expected), 'geometry, physical parent, seats and schedules match the frozen writer; labels and shore prose now carry meaning');
    for (const ref of ['alpha', 'beta']) assert.deepEqual(actual.find(p => p.ref === ref)!.genericAliases, ['plaza', 'paving', 'place']);
    assert.deepEqual(actual.find(p => p.ref === 'gazebo')!.genericAliases, ['civic', 'garden', 'shade', 'park', 'structure']);
    for (const p of actual.filter(p => p.of === 'room' || p.of === 'shore')) {
      assert.deepEqual(p.genericAliases, [], `${p.ref}: rooms and banks cannot inherit their owner's generic identity`);
    }
    assert.equal(f.places.stats.memberships, builds, 'full decoration uses the completed calendar membership');
    return expected;
  };
  const initial = compare(), kinds = new Set(initial.map(p => p.of));
  for (const kind of ['area', 'water', 'shore', 'room', 'building', 'landform', 'land']) assert.ok(kinds.has(kind as never), kind);
  assert.ok(initial.some(p => p.ref === 'gazebo')); assert.ok(initial.some(p => p.ref === 'needle' && p.of === 'landmark'));
  assert.equal(initial.some(p => p.ref === 'fountain'), false, 'a landmark inside an area has no own place');
  const builds = f.places.stats.memberships;
  // Live Thing metadata is read by decoration; the memo must not retain an earlier door/room description.
  const house = nav.things().find(t => t.ref === 'house')!, room = nav.things().find(t => t.kind === 'room' && t.id === house.id)!;
  house.doorOpen = !house.doorOpen; room.what = 'Changed room wording';
  f.engine.world.tick = 1200;
  const changed = compare();
  assert.equal(f.places.stats.memberships, builds);
  assert.match(changed.find(p => p.ref === room.ref)!.description!, /Changed room wording/);
  assert.match(changed.find(p => p.ref === 'alpha')!.description!, /clock 1200/);
  assert.equal(changed.find(p => p.ref === 'alpha')!.schedule![0].label, 'market 1200');
  // Parent selection must still consult the mutable native ledger, outside membership caching.
  f.edge.places.add({ ...f.edge.places.byId.get('world')!, id: 'native', name: 'Native', parent: 'world', polygon: [[-90, 0], [-50, 0], [-50, 40], [-90, 40]] });
  f.engine.world.tick = 2400; compare();
  assert.equal(f.places.ofEntity(f.model.get('gazebo')!.id)!.parent, 'native');
  // A model/bridge edit produces fresh membership; neither map identity nor the clock alone is enough.
  f.act([{ op: 'move', id: 'needle', p: [15, -5] }]); f.edited(); f.engine.world.tick = 3600;
  compare(); assert.equal(f.places.ofEntity(f.model.get('needle')!.id), undefined);
  const prior = f.places.stats.memberships;
  f.model.state = { ...f.model.state, constitution: 'new' }; f.bridge.version++; f.engine.world.tick = 4800;
  compare(); assert.equal(f.places.stats.memberships, prior + 1);
  const bench = f.model.get('bench')!, parent = f.model.get('house')!;
  f.model.delete(bench.id); f.model.insert({ ...bench, in: { parent: parent.id, slot: room.room! }, p: [0, 0, 0] });
  f.edited(); f.engine.world.tick = 6000;
  compare(); assert.equal(f.model.pathOf(bench.id), 'house/bench');
});

test('calendar membership uses the full index sort and water duplicate-ref precedence', () => {
  const f = fixture(), [a, b, c] = f.sources();
  const base: Thing = { id: a.id, ref: 'shared', name: 'shared', kind: 'area', what: 'an area', words: [], at: [0, 0], level: 0, area: [[0, 0], [10, 0], [10, 10], [0, 10]] };
  f.nav.things = () => [base, { ...base, id: b.id, kind: 'water' }, { ...base, id: c.id, ref: 'shared/room', kind: 'room', poly: base.area }];
  const legacy = new LegacyPlaces(f.host), own = f.places.calendarIdentities(f.sources(), f.bridge.version);
  for (const e of f.sources()) {
    const p = legacy.ofEntity(e.id); assert.deepEqual(own.get(e.id), p ? { id: p.id, name: humanTitle(p.ref) } : null);
  }
  assert.equal(own.get(b.id), null, 'water cannot overwrite a previous area with the same ref');
  assert.equal(own.get(c.id), null, 'room does not become its entity own-place');
  const actual = f.places.list();
  assert.deepEqual(physical(actual), physical(legacy.list()));
  assert.deepEqual(actual.find(p => p.ref === 'shared' && p.of === 'area')!.genericAliases, ['plaza', 'paving', 'place']);
  for (const p of actual.filter(p => p.of === 'room' || p.of === 'shore')) assert.deepEqual(p.genericAliases, []);
  assert.equal(f.places.forRef('shared')!.of, 'shore');
});

test('calendar place decoration reclassifies authored identities without changing physical membership', () => {
  const f = fixture(), initial = f.places.list();
  assert.deepEqual(initial.find(p => p.ref === 'alpha')!.genericAliases, ['plaza', 'paving', 'place']);
  f.act([{ op: 'set', id: 'alpha', about: { title: 'Paving', aliases: ['PLACE'] } }]); f.edited();
  const authored = f.places.list(), alpha = authored.find(p => p.ref === 'alpha')!;
  assert.equal(alpha.name, 'Paving');
  assert.ok(alpha.aliases!.includes('PLACE'), 'authored aliases remain publicly available');
  assert.deepEqual(alpha.genericAliases, ['plaza'], 'authored title and alias are identities, even when they match type vocabulary case-insensitively');
  assert.deepEqual(physical(authored), physical(initial));
  f.act([{ op: 'set', id: 'alpha', about: null }]); f.edited();
  const cleared = f.places.list();
  assert.deepEqual(cleared.find(p => p.ref === 'alpha')!.genericAliases, ['plaza', 'paving', 'place'], 'clearing meaning restores generic vocabulary on publication');
  assert.deepEqual(physical(cleared), physical(initial));
});

test('an edit after membership completes preserves deferred publication and subsequent catchup', () => {
  const f = fixture(), alpha = f.model.get('alpha')!;
  f.nav.things = () => Array.from({ length: 96 }, (_, i): Thing => ({
    id: alpha.id, ref: `${f.model.entities.get(alpha.id)!.name}-${i}`, name: 'area', kind: 'area', what: 'an area', words: [], at: [i * 3, 0], level: 0,
    area: [[i * 3, 0], [i * 3 + 2, 0], [i * 3 + 2, 2], [i * 3, 2]],
  }));
  let slices = 0;
  while (!(f.places as unknown as { membership?: unknown }).membership) {
    assert.equal(f.places.syncStep(Number.MIN_VALUE), false); assert.ok(++slices < 100);
  }
  assert.equal(f.edge.places.byId.has('g-alpha-0'), false, 'membership is not a published place index');
  f.model.entities.set(alpha.id, { ...alpha, name: 'renamed' }); f.edited(); f.defer(true);
  assert.equal(f.places.syncStep(Infinity), true);
  assert.equal(f.edge.places.byId.has('g-alpha-0'), true, 'the existing in-flight full derive still publishes');
  assert.equal(f.edge.places.byId.has('g-renamed-0'), false);
  assert.equal(f.places.stats.memberships, 1);
  assert.equal(f.places.syncStep(Infinity), true);
  assert.equal(f.edge.places.byId.has('g-alpha-0'), false);
  assert.equal(f.edge.places.byId.has('g-renamed-0'), true);
  assert.equal(f.places.stats.memberships, 2, 'the newer model cannot reuse the old completed membership');
});

test('cold membership invalidates on definition maps, removals, and bridge-only ground/state edits', () => {
  const f = fixture();
  const read = () => f.places.calendarIdentities(f.sources(), f.bridge.version);
  read(); let builds = f.places.stats.memberships;
  const entry = [...f.model.defs][0];
  f.model.defs.set(entry[0], { ...entry[1] }); read();
  assert.equal(f.places.stats.memberships, ++builds);
  f.model.entities.delete(f.model.get('beta')!.id); read();
  assert.equal(f.places.stats.memberships, ++builds);
  f.model.state = { ...f.model.state, constitution: 'changed' }; f.bridge.version++; read();
  assert.equal(f.places.stats.memberships, ++builds);
  const ground = f.model.ground(); f.model.terrain.update({ ...ground, extent: [-210, -200, 200, 200] }, []);
  f.bridge.version++; read(); assert.equal(f.places.stats.memberships, ++builds);
});

test('authored publication guard discards a superseded sliced derive before ledger publication', () => {
  const f = fixture(); let authored = 0;
  f.host.publicationVersion = () => authored;
  f.places.sync();
  assert.equal(f.places.hasCurrentPublication(), true);
  f.nav.thingsGen = function* () { const things = structuredClone(f.nav.things()); yield; return things; };
  f.edited(); authored++;
  assert.equal(f.places.syncStep(Number.MIN_VALUE), false);
  f.act([{ op: 'set', id: 'alpha', name: 'renamed', about: { title: 'New assembly court', what: 'A court for public talks.' } }]); f.edited(); authored++;
  assert.equal(f.places.hasCurrentPublication(), false);
  const published = [...f.edge.places.byId.keys()];
  assert.equal(f.places.syncStep(Number.MIN_VALUE), false, 'superseded iterator restarts within one slice');
  assert.deepEqual([...f.edge.places.byId.keys()], published, 'no mixed old iterator publishes');
  while (!f.places.syncStep(Number.MIN_VALUE)) { /* finish the stable authored revision */ }
  assert.equal(f.places.hasCurrentPublication(), true);
  assert.equal(f.edge.places.byId.has('g-renamed'), true);
  assert.equal(f.edge.places.byId.has('g-alpha'), false);
  assert.equal(f.edge.places.byId.get('g-renamed')!.name, 'New assembly court');
  assert.match(f.edge.places.byId.get('g-renamed')!.description!, /public talks/);
  f.act([{ op: 'set', id: 'renamed', name: 'final-name' }]); f.edited(); authored++;
  assert.equal(f.places.hasCurrentPublication(), false);
  f.places.sync(true);
  assert.equal(f.places.hasCurrentPublication(), true, 'synchronous publication records the same provenance');
});
