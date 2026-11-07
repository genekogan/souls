import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef } from '@souls/world-compiler';
import { toyFactory } from '@souls/engine-toy';
import { PlaceIndex, type Place } from '../edge/ledger/places.ts';
import { Db } from '../db.ts';
import { WorldHost } from '../world.ts';
import { GodMode } from './god.ts';
import { EngineBridge, installEngineBridge } from './engine-bridge.ts';
import { GodPlaces } from './places.ts';
import type { GodNav, Thing } from './nav.ts';

type LayerState = { layerDay: string; layerPlacesPending: string | null; layersStep(sweep?: boolean): void };
function fixture() {
  const model = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'layer-slices' });
  for (const d of CORE_KIT) model.defineDef(d, 'core', 0);
  const r = applyBatch(model, { ops: [
    { op: 'place', def: coreRef('plaza'), name: 'plaza', shape: { area: [[0, 0], [10, 0], [10, 10], [0, 10]] } },
    { op: 'place', def: coreRef('bench'), name: 'bench', p: [20, 0] },
  ] }, 'god', 1);
  assert.equal(r.result.accepted, true);
  const root: Place = { id: 'world', name: 'World', kind: 'outdoor', parent: null, polygon: [[-50, -50], [50, -50], [50, 50], [-50, 50]], level: 0, enclosed: false, capacity: null, starting: true };
  const edge = { places: new PlaceIndex({ contract: 'place-data/1', world: 'test', places: [root] }) };
  let day = 'day-one', edits = 0, revision = 0, tick = 0, slices = 0, sweeps = 0, evacuations = 0;
  const published: string[][] = [], complete: ReturnType<GodPlaces['list']>[] = [], errors: string[] = [];
  const host = { running: true };
  const state = Object.assign(Object.create(EngineBridge.prototype), {
    host, god: { model, builds: { sweep() { sweeps++; }, hasClosure: () => true } },
    layerDay: '', layerPlacesPending: null, evacuateSites() { evacuations++; }, log: (s: string) => errors.push(s),
  }) as LayerState;
  const nav = {
    things(): Thing[] { const e = model.get('plaza')!; return [{ id: e.id, ref: model.pathOf(e.id), name: e.name!, kind: 'area', what: 'plaza', words: [], at: [5, 5], level: 0, area: (e.shape as { area: [number, number][] }).area }]; },
    *thingsGen(): Generator<void, Thing[]> { const things = this.things(); yield; yield; yield; return things; },
  } as GodNav;
  const layers = { active: () => true, dayKey: () => day, slotsFor: () => [], tag: () => '', peopleAt: () => '',
    step() { const list = places.list(); complete.push(structuredClone(list)); published.push(list.map(p => p.id)); assert.ok(edge.places.byId.has('g-plaza'), 'calendar can only run after the complete index is installed'); } };
  const places = new GodPlaces({ model, nav, edge: edge as never, layers,
    version: () => `${edits}:${Math.floor(tick / 1200)}`, structuralVersion: () => revision,
    deferred: () => state.layerPlacesPending !== null, engineOwned: () => false, levelAt: () => 0, log: s => errors.push(s) });
  const syncStep = places.syncStep.bind(places);
  // Deterministically stop at the first generator yield, without wall-clock waits.
  places.syncStep = () => { slices++; return syncStep(0); };
  Object.assign(state, { layers, places });
  return { state, places, host, model, nav, edge, published, complete, errors, syncStep,
    day(value: string) { day = value; }, churn(changeKey = false) { const b = model.get('bench')!; model.entities.set(b.id, { ...b }); revision++; tick += 1200; if (changeKey) edits++; },
    counts: () => ({ slices, sweeps, evacuations }) };
}

test('initial layer places finish incrementally under model/key churn without partial publication or a final full derive', () => {
  const f = fixture();
  f.state.layersStep();
  assert.equal(f.state.layerPlacesPending, 'day-one'); assert.equal(f.state.layerDay, '');
  assert.deepEqual([...f.edge.places.byId.keys()], ['world']); assert.equal(f.published.length, 0);
  let n = 0;
  while (f.state.layerPlacesPending !== null) {
    assert.ok(++n < 30, 'engine/model churn cannot starve the existing generator');
    f.churn(true); f.state.layersStep(false);
  }
  assert.ok(f.counts().slices > 2); assert.equal(f.places.stats.derives, 1, 'completion and calendar reads must not synchronously drain a newer key');
  assert.equal(f.published.length, 1); assert.deepEqual(f.published[0], ['g-plaza']);
  const reference = fixture(); reference.host.running = false; reference.state.layersStep();
  assert.deepEqual(f.complete, reference.complete, 'sliced publication preserves every derived place field');
  assert.deepEqual(f.counts(), { slices: f.counts().slices, sweeps: 1, evacuations: 1 }); assert.deepEqual(f.errors, []);
});

test('a day boundary during a pass is caught up at the next normal cadence and shared perception progress is retained', () => {
  const f = fixture();
  assert.equal(f.syncStep(0), false, 'perception may already own the place generator');
  f.state.layersStep(); f.day('day-two');
  for (let n = 0; f.state.layerPlacesPending !== null; n++) { assert.ok(n < 30); f.state.layersStep(false); }
  assert.equal(f.state.layerDay, 'day-one'); assert.equal(f.places.stats.derives, 1);
  f.state.layersStep();
  for (let n = 0; f.state.layerPlacesPending !== null; n++) { assert.ok(n < 30); f.state.layersStep(false); }
  assert.equal(f.state.layerDay, 'day-two'); assert.equal(f.places.stats.derives, 2);
  assert.equal(f.published.length, 2); assert.deepEqual(f.published[0], f.published[1]); assert.deepEqual(f.errors, []);
});

test('hand-stepped worlds preserve immediate full place publication', () => {
  const f = fixture(); f.host.running = false; f.state.layersStep();
  assert.equal(f.state.layerDay, 'day-one'); assert.equal(f.state.layerPlacesPending, null);
  assert.equal(f.counts().slices, 0); assert.equal(f.published.length, 1); assert.equal(f.places.stats.derives, 1);
});

test('switching a pending world to manual stepping clears the continuation after full publication', () => {
  const f = fixture(); f.state.layersStep();
  assert.equal(f.state.layerPlacesPending, 'day-one'); assert.equal(f.published.length, 0);
  f.host.running = false; f.state.layersStep(false);
  assert.equal(f.state.layerPlacesPending, null); assert.equal(f.state.layerDay, 'day-one');
  assert.equal(f.published.length, 1); assert.deepEqual(f.errors, []);
  const derives = f.places.stats.derives; f.state.layersStep();
  assert.equal(f.places.stats.derives, derives, 'manual completion must not leave a day refresh armed');
});

test('a real Things generator failure discards the closed pass and retries without publishing partial places', () => {
  const f = fixture(), ordinary = f.nav.thingsGen!.bind(f.nav);
  let attempts = 0;
  f.nav.thingsGen = function* () {
    if (++attempts === 1) { yield; throw new Error('Things generator failed'); }
    return yield* ordinary();
  };
  f.state.layersStep(); assert.equal(f.state.layerPlacesPending, 'day-one');
  f.state.layersStep(false);
  assert.equal(f.state.layerPlacesPending, null); assert.equal(f.state.layerDay, '');
  assert.equal(f.published.length, 0); assert.deepEqual([...f.edge.places.byId.keys()], ['world']);
  assert.deepEqual(f.errors, ['layers: Things generator failed']);
  f.state.layersStep();
  for (let n = 0; f.state.layerPlacesPending !== null; n++) { assert.ok(n < 30); f.state.layersStep(false); }
  assert.equal(attempts, 2); assert.equal(f.places.stats.derives, 2);
  assert.equal(f.published.length, 1); assert.deepEqual(f.published[0], ['g-plaza']);
  assert.deepEqual(f.errors, ['layers: Things generator failed'], 'closed generator must never be retried as an undefined list');
});

test('a failed place slice publishes no layer facts and leaves the requested day retryable', () => {
  const f = fixture(), step = f.places.syncStep;
  f.places.syncStep = () => { throw new Error('place failure'); };
  f.state.layersStep();
  assert.equal(f.state.layerPlacesPending, null); assert.equal(f.state.layerDay, '');
  assert.equal(f.published.length, 0); assert.deepEqual(f.errors, ['layers: place failure']);
  f.places.syncStep = step; f.state.layersStep();
  for (let n = 0; f.state.layerPlacesPending !== null; n++) { assert.ok(n < 30); f.state.layersStep(false); }
  assert.equal(f.published.length, 1); assert.equal(f.state.layerDay, 'day-one');
});

test('the installed bridge listener resumes pending places each tick without repeating build sweeps', t => {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'layer-scheduler', 1e9, 'layer-scheduler');
  host.boot(); host.drainInputs();
  Object.defineProperty(host, 'running', { get: () => true });
  const god = new GodMode(db, { worldId: host.worldId, ownerId: 'test-owner', tick: () => host.engine.world.tick, emit() {} });
  const bridge = installEngineBridge({ host, god, worldClock: false, worldLore: false, log() {} });
  const state = bridge as unknown as LayerState & { reconciled: boolean; navWarm: boolean; navPending: boolean;
    flush(): void; writeBack(): void; perceiveStep(): void; spotsStep(): void; flushMapNotices(): void;
    navStep(): void; evacuateSites(): void; rescueTrapped(): void };
  state.reconciled = true; state.navWarm = true; state.navPending = false;
  for (const name of ['flush', 'writeBack', 'perceiveStep', 'spotsStep', 'flushMapNotices', 'navStep', 'evacuateSites', 'rescueTrapped'] as const)
    t.mock.method(state, name, () => {});
  const slices: number[] = [], sweeps: number[] = [], publications: number[] = [];
  t.mock.method(god.builds, 'sweep', () => { sweeps.push(host.engine.world.tick); });
  t.mock.method(god.builds, 'hasClosure', () => false);
  t.mock.method(bridge.layers, 'active', () => true); t.mock.method(bridge.layers, 'dayKey', () => 'day');
  t.mock.method(bridge.layers, 'step', () => { publications.push(host.engine.world.tick); return { changed: 0, posted: 0 }; });
  t.mock.method(bridge.places, 'syncStep', () => { slices.push(host.engine.world.tick); return slices.length === 3; });
  t.after(() => { host.stop(); db.close(); });
  for (let n = 0; n < 12; n++) host.tickOnce();
  assert.deepEqual(slices, [7, 8, 9]); assert.deepEqual(sweeps, [7]); assert.deepEqual(publications, [9]);
  assert.equal(state.layerPlacesPending, null); assert.equal(state.layerDay, 'day');
});
