// Uses the native perception/comms harness; no browser, server, renderer or painting recipe.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Op } from '@souls/world-compiler';
import { Db } from '../db.ts';
import type { EdgeSoul } from '../edge/contract.ts';
import { commsFixture } from '../edge/comms/testing.ts';
import { GodLayers } from './layers.ts';
import { GodNav } from './nav.ts';
import { GodPerceive, type BuiltState } from './perceive.ts';

function fixture(t: TestContext, longHours = false, initiallyPainted = false) {
  const oldLayers = process.env.LAYERS;
  process.env.LAYERS = '1';
  t.after(() => { if (oldLayers === undefined) delete process.env.LAYERS; else process.env.LAYERS = oldLayers; });
  const db = new Db(':memory:');
  const f = commsFixture(['Ana', 'Ben'], { sweepMs: 0 }, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const model = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'painting-perception-metadata' });
  for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
  let version = 0;
  const act = (ops: Op[]) => {
    const result = applyBatch(model, { ops }, 'god', ++version);
    assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  };
  act([
    { op: 'place', def: coreRef('cottage'), name: 'inn', in: { parent: 'world' }, mode: 'strict', p: [0, 0] },
    { op: 'place', def: coreRef('sign'), name: 'map', in: { parent: 'world' }, mode: 'strict', p: [7, 0] },
    { op: 'place', def: coreRef('easel', 2), name: 'canvas', in: { parent: 'inn' }, mode: 'strict', p: [0, 0],
      owner: 'soul:s_ana', access: 'private', price: { amount: 2 },
      ...(initiallyPainted ? { state: { media: `/art/${'a'.repeat(64)}.png`,
        title: 'After the Summer Rain', maker: 'soul:s_artist:Alexandra Montgomery' } } : {}),
      schedule: { open: longHours ? [
        { from: '01:00', to: '02:00' }, { from: '03:00', to: '04:00' },
        { from: '05:00', to: '06:00' }, { from: '07:00', to: '08:00' },
        { from: '09:00', to: '10:00' },
      ] : [{ from: '07:00', to: '15:00' }] } },
  ]);
  const target = model.get('inn/canvas')!.id;
  const ben: EdgeSoul = { soulId: f.id('Ben'), entityId: `h_${f.id('Ben')}`, name: 'Ben', owner: 'dev:Ben' };
  f.at('Ben', 0, 0);
  const edge = Object.assign(f.ledger, {
    comms: f.runtime,
    host: { minds: new Map([['s_ana', { soulId: 's_ana', entityId: 'h_s_ana', name: 'Ana' }]]) },
    places: { byId: new Map([['eden-commons', { id: 'eden-commons', parent: null }]]) },
    enclosureAtPoint: () => null,
  });
  const engine = f.host.engine as never;
  const layers = new GodLayers({ model, edge: edge as never, engine, living: () => null,
    engineAct: ops => applyBatch(model, { ops }, 'engine', ++version, { trusted: true }).result, log() {} });
  const nav = new GodNav({ model, version: () => version, describeStamp: () => 'stable-ground',
    engine, engineOwned: () => false, levelAt: () => 0 });
  const errors: string[] = [];
  const perceive = new GodPerceive({ model, version: () => version, edge: edge as never, engine,
    engineOwned: () => false, levelAt: () => 0, things: () => nav.things(),
    namesNear: (at, except) => nav.namesNear(at, except), layers, log: message => errors.push(message) });
  perceive.sync();

  // This is the actual public projection, after GodPerceive creates/advances SQLite comms objects.
  type Seen = { id: string; public: BuiltState; owner?: string; price?: { amount: number }; hours?: string };
  const seen = () => {
    const row = f.runtime.objects.visibleTo(ben).find(row => row.id === target) as unknown as Seen | undefined;
    assert.ok(row, 'another Soul sees this nearby easel through the real built-object projection');
    return row;
  };
  const finish = (title: string, maker = 'Ana') => {
    act([{ op: 'set', id: target, state: {
      media: `/worlds/w/test/art/${'a'.repeat(64)}.png`, title, maker: `soul:s_artist:${maker}`,
    } }]);
    perceive.note([target], false, 'authored');
    perceive.sync();
    return seen();
  };
  const clear = () => {
    act([{ op: 'set', id: target, state: { media: '', title: '', maker: '' } }]);
    perceive.note([target], false, 'authored');
    perceive.sync();
    return seen();
  };
  return { f, target, seen, finish, clear, errors };
}

test('painting credit preserves parent, landmarks and ownership/access/price/hours in actual perception', t => {
  const { f, target, seen, finish, errors } = fixture(t);
  const blank = seen();
  assert.ok(blank.public.what.length <= 120, 'ordinary unpainted projection retains its original bound');
  assert.match(blank.public.what, /^an easel in inn, by /);
  assert.ok(blank.public.near.includes('map'), 'GodNav supplies an actual nearby landmark');
  assert.match(blank.public.what, /\bmap\b/);
  assert.match(blank.public.what, /; Ana's, private; for sale: 2 coins; open 07:00–15:00$/);
  const suffix = blank.public.what.slice('an easel'.length);
  const credit = (title: string) => `an easel with Ana’s painting “${title}”`;
  assert.ok((credit('Evening Light') + suffix).length <= 120,
    'ordinary title and concise place/landmark names fit the existing projection bound');

  const paint = (title: string) => {
    const actual = finish(title);
    assert.equal(actual.public.what, credit(title) + suffix,
      'painting replaces only the kind prefix; the complete applicable relation/layer suffix remains');
    assert.deepEqual(actual.public.near, blank.public.near);
    assert.equal(actual.owner, "Ana's, private");
    assert.deepEqual(actual.price, { amount: 2 });
    assert.equal(actual.hours, 'open 07:00–15:00');
    const stored = f.runtime.objects.all().find(row => row.id === target);
    assert.ok(stored);
    assert.equal((stored.state as BuiltState).what, actual.public.what,
      'the public credit and metadata come from the real durable built state');
    assert.equal(Object.hasOwn(actual.public, 'paintingWhat'), false);
    assert.equal(Object.hasOwn(stored.state as object, 'paintingWhat'), false);
  };
  paint('Evening Light');
  paint('Morning Light'); // Same object refreshes its title without losing relations or metadata.
  assert.equal(f.runtime.objects.all().filter(row => row.id === target).length, 1);
  assert.deepEqual(errors, []);
});

// Painted descriptions use the explicit 230-character bound, preserving full credit and existing metadata.
test('ordinary longer painting credit must retain the complete existing metadata suffix', t => {
  const { seen, finish, errors } = fixture(t);
  const blank = seen();
  assert.match(blank.public.what, /^an easel in inn, by /);
  assert.match(blank.public.what, /; Ana's, private; for sale: 2 coins; open 07:00–15:00$/);
  const suffix = blank.public.what.slice('an easel'.length);
  const actual = finish('After the Summer Rain', 'Alexandra Montgomery');
  const fullCredit = 'an easel with Alexandra Montgomery’s painting “After the Summer Rain”';
  assert.equal(actual.public.what, fullCredit + suffix, 'full bounded title and credit accompany all previously visible metadata');
  assert.ok(actual.public.what.length > 120 && actual.public.what.length <= 230,
    'this explicitly exercises the new painting-only bound; it is not a passing old-120 claim');
  assert.deepEqual(actual.public.near, blank.public.near);
  assert.equal(actual.owner, "Ana's, private");
  assert.deepEqual(actual.price, { amount: 2 });
  assert.equal(actual.hours, 'open 07:00–15:00');
  assert.deepEqual(errors, []);
});

test('a painting must not worsen metadata visibility when the blank description already clips', t => {
  const { f, target, seen, finish, clear, errors } = fixture(t, true, true);
  const initial = seen();
  const created = f.runtime.objects.all().find(row => row.id === target)!;
  assert.equal(f.runtime.objects.creationParams(target)?.paintingWhat, true,
    'initial creation uses the same explicit private initialization hint as desired-state refresh');
  assert.equal(Object.hasOwn(initial.public, 'paintingWhat'), false);
  assert.equal(Object.hasOwn(created.state as object, 'paintingWhat'), false);
  assert.equal(Object.hasOwn(f.runtime.objects.kindOf(created.kind)!.schema, 'paintingWhat'), false);
  const blank = clear();
  assert.equal(blank.public.what.length, 120, 'this blank easel already reaches the preexisting bound');
  const priorVisibleSuffix = blank.public.what.slice('an easel'.length);
  const actual = finish('After the Summer Rain', 'Alexandra Montgomery');
  const fullCredit = 'an easel with Alexandra Montgomery’s painting “After the Summer Rain”';
  assert.equal(actual.public.what, fullCredit + priorVisibleSuffix,
    'exactly the previously visible suffix survives; complete long metadata cannot all fit');
  assert.equal(initial.public.what, actual.public.what, 'creation and refresh apply the same painted bound');
  assert.ok(actual.public.what.length <= 230);
  assert.equal(actual.owner, "Ana's, private");
  assert.deepEqual(actual.price, { amount: 2 });
  assert.equal(actual.hours, blank.hours);
  assert.deepEqual(errors, []);
});
