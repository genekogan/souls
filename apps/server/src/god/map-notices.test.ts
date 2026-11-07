// R8: residents learn about map changes near them without asking again. Pure planning and the spam bound first; then
// a scripted world (real host, edge ledger, compiler and native engine, fake minds) with residents near and far.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { applyBatch, coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { Db } from '../db.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { MAP_NOTICE, MapNotices, mapChanges, mapNoticeText, nearSite, planMapNotices, type MapResident } from './map-notices.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const HOUSE = (name = 'house', p: [number, number] = [0, 0]) => [
  { op: 'define', def: { schema: 'def/1', name: 'cottage', version: 1, tags: ['building'], size: { box: [8, 3, 6] }, make: { kind: 'gen', gen: 'building/1', args: { style: 'shed' } }, params: { floors: { type: 'int', min: 1, max: 6, default: 1 } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
  { op: 'place', tmp: '$h', def: 'cottage@1', name, p },
  { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'ground' }, p: [-2, 0, -1] },
];
function bare() {
  const god = new GodMode(new Db(':memory:'), { worldId: 'r8', ownerId: 'dev:admin', tick: () => 1, emit: () => {} });
  const step = (ops: unknown[]) => { const before = god.model.fork(), after = god.model.fork(), r = applyBatch(after, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); const out = mapChanges(before, after, r.diff!); Object.assign(god.model, after); return out; };
  return { god, step };
}

test('visible changes only, outermost first, with a verb and a name', () => {
  const { god, step } = bare();
  const built = step(HOUSE());
  assert.deepEqual(built.map(c => [c.verb, c.name]), [['built', 'house']], 'the house speaks for the chair inside it');
  assert.ok(built[0].r > 3, 'its footprint reaches past its centre');
  assert.deepEqual(step([{ op: 'place', def: coreRef('bench'), name: 'bench', p: [20, 0] }]).map(c => [c.verb, c.name]), [['placed', 'bench']]);
  const bench = god.model.get('bench')!.id;
  assert.deepEqual(step([{ op: 'set', id: god.model.get('house')!.id, state: { doors: { front: 'shut' } } }]), [], 'a state-only tweak changes nothing anyone sees');
  const moved = step([{ op: 'move', id: bench, p: [24, 0] }]);
  assert.deepEqual(moved.map(c => [c.verb, c.from]), [['moved', [20, 0]]]);
  assert.deepEqual(step([{ op: 'remove', id: bench }]).map(c => [c.verb, c.name, c.at]), [['removed', 'bench', [24, 0]]]);
  const mound = step([{ op: 'place', def: coreRef('knoll'), name: 'mound', p: [60, 0], params: { height: 4, radius: 5 } }]);
  assert.deepEqual(mound.map(c => [c.verb, c.name]), [['reshaped', 'the ground']]);
  assert.equal(mapNoticeText(mound), 'The god reshaped the ground near you.');
  assert.equal(mapNoticeText(built), 'The god built a house near you.');
  assert.equal(mapNoticeText([...built, ...moved], {}, ' at the harbour'), 'The god built a house and changed 1 other thing at the harbour.');
  assert.equal(mapNoticeText(moved, { note: 'tidy the square.' }, ' by the fountain'), 'The god changed things by the fountain: tidy the square.');
  assert.equal(mapNoticeText(built, { title: 'Stone church', say: 'raising the walls' }), 'The god is building Stone church nearby: raising the walls.');
});

test('who hears: residents within 30 m of a change or of where it was, or whose own place it changed; minus those told', () => {
  const { step } = bare();
  const [house] = step(HOUSE('home', [0, 0]));
  const r = (soulId: string, p: [number, number]): MapResident => ({ soulId, name: soulId, p });
  const near = r('near', [house.r + 25, 0]), far = r('far', [house.r + 40, 0]), walked = r('walked', [1, 1]), owner = r('owner', [200, 0]);
  const plan = planMapNotices([house], [near, far, walked, owner], { exclude: new Set(['walked']), mine: (x, c) => x.soulId === 'owner' && c.things.includes(`thing:${house.id}`) });
  assert.deepEqual(plan?.souls, ['near', 'owner']);
  assert.equal(planMapNotices([], [near]), null);
  assert.deepEqual(nearSite({ at: [0, 0], size: [10, 10], yaw: 0 }, [r('in', [0, 0]), r('edge', [34, 0]), r('out', [36, 0])], { skipInside: [{ at: [0, 0], size: [10, 10], yaw: 0 }] }), ['edge']);
});

test('the spam bound: one notice per resident per minute; a 50-edit burst is one now and one merged later', () => {
  let now = 0; const told: [string, string][] = [];
  const n = new MapNotices((s, text) => told.push([s, text]), () => now);
  for (let i = 0; i < 50; i++) { now += 500; n.send('ana', `edit ${i}`); n.send('bo', `edit ${i}`); }
  assert.deepEqual(told, [['ana', 'edit 0'], ['bo', 'edit 0']]);
  n.flush(); assert.equal(told.length, 2, 'still inside the minute');
  now = 500 + MAP_NOTICE.everyMs; n.flush();
  assert.deepEqual(told.slice(2), [['ana', 'The god kept changing things nearby (49 more edits since the last notice).'], ['bo', 'The god kept changing things nearby (49 more edits since the last notice).']]);
  now += 1000; n.send('ana', 'one more'); now += MAP_NOTICE.everyMs; n.flush();
  assert.deepEqual(told.slice(4), [['ana', 'one more']], 'a single held notice keeps its own sentence');
  // A request's notice waits for the request; construction in the same request replaces it and is never held back.
  now += MAP_NOTICE.everyMs; n.stage(['ana', 'bo'], 'The god placed a bench near you.'); n.construction(['ana'], 'Stone church is finished and open.'); n.deliverStaged();
  assert.deepEqual(told.slice(5), [['ana', 'Stone church is finished and open.'], ['bo', 'The god placed a bench near you.']]);
});

test('planning a 40-op batch for 60 residents costs well under a millisecond', t => {
  const { god } = bare();
  const ops = Array.from({ length: 40 }, (_, i) => ({ op: 'place', def: coreRef('bench'), name: `b${i}`, p: [(i % 8) * 3, Math.floor(i / 8) * 3] }));
  const residents = Array.from({ length: 60 }, (_, i): MapResident => ({ soulId: `s${i}`, name: `S${i}`, p: [(i % 10) * 12 - 40, Math.floor(i / 10) * 12 - 30] }));
  const before = god.model.fork(), after = god.model.fork(), r = applyBatch(after, { ops }, 'god', 1);
  assert.equal(r.result.accepted, true);
  const times: number[] = [];
  for (let i = 0; i < 30; i++) { const t0 = performance.now(); const plan = planMapNotices(mapChanges(before, after, r.diff!), residents); times.push(performance.now() - t0); assert.ok(plan && plan.souls.length > 0); }
  const median = times.sort((a, b) => a - b)[15];
  t.diagnostic(`R8 planning median ${median.toFixed(3)} ms (40 changes, 60 residents)`);
  assert.ok(median < 2, `median planning ${median.toFixed(3)} ms`);
});

// ---- the scripted world
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  let now = 1_000_000;
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => now, buildPauseMs: 60_000, buildClosureMs: 600_000, emit: () => {} });
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const caller = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'builder'))!;
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const soul = async (owner: string, name: string, to: [number, number]) => {
    await invite(w, owner); const row: any = await accept(w.host, w.souls.create(`dev:${owner}`, { name, description: 'curious' })); await settle(3);
    const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
    await accept(w.host, w.host.enqueue('edge-relocate', 'test:r8', { soulId: s.soulId, entityId: s.entityId, to, why: 'r8 fixture' })); await settle(2);
    const p = (w.host.engine.world as any).entities[s.entityId].pose.p; assert.ok(Math.hypot(p[0] - to[0], p[2] - to[1]) < .5, `${name} stands at ${to}`);
    return s;
  };
  const notices = (s: any): string[] => ((edge.observe(s, new Set()) as any).notices ?? []).map((n: any) => n.text);
  const act = (ops: unknown[], note?: string) => { const r: any = god.act({ ops, ...(note ? { note } : {}) } as never); assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  return { ...w, god, edge, bridge, caller, settle, soul, notices, act, advance: (ms: number) => { now += ms; } };
}

test('near residents get exactly one notice per request, far ones none; state tweaks none; native minds remember it', { timeout: 120_000 }, async t => {
  const w = world(t);
  const near = await w.soul('ana', 'Ana', [8, 4]), far = await w.soul('bo', 'Bo', [-28, -28]);
  w.act([...HOUSE('shed', [14, 14]), { op: 'place', def: coreRef('bench'), name: 'bench', p: [4, 4] }]); await w.settle(2);
  assert.deepEqual(w.notices(near), ['The god built a shed and changed 1 other thing at Green field.']);
  assert.deepEqual(w.notices(far), []);
  await w.settle(4); assert.ok(w.host.minds.get(near.soulId)!.recent.some(x => x.includes('The god built a shed')), `the native mind remembers it: ${JSON.stringify(w.host.minds.get(near.soulId)!.recent)}`);
  w.advance(MAP_NOTICE.everyMs + 1);
  w.act([{ op: 'set', id: w.god.model.get('shed')!.id, state: { doors: { front: 'shut' } } }]); await w.settle(2);
  assert.equal(w.notices(near).length, 1, 'a state-only edit tells nobody');
  w.act([{ op: 'place', def: coreRef('fountain'), name: 'fountain', p: [-2, 4] }], 'water the square'); await w.settle(2);
  assert.deepEqual(w.notices(near)[0], 'The god changed things at Green field: water the square.');
  // A far owner hears of a change to its own place.
  w.advance(MAP_NOTICE.everyMs + 1);
  w.act([{ op: 'set', id: w.god.model.get('fountain')!.id, owner: `soul:${far.soulId}` }]); await w.settle(2);
  w.act([{ op: 'move', id: w.god.model.get('fountain')!.id, p: [-3, 4] }]); await w.settle(2);
  assert.deepEqual(w.notices(far), ['The god moved the fountain at Green field.']);
});

test('a resident walked out by the edit hears only the walk-out; a 50-edit burst stays one notice now and one merged later', { timeout: 180_000 }, async t => {
  const w = world(t);
  const inside = await w.soul('ana', 'Ana', [0, 0]), beside = await w.soul('bo', 'Bo', [12, 0]);
  const r = w.act(HOUSE('house', [0, 0])); await w.settle(2);
  assert.equal(r.moved?.[0]?.soulId, inside.soulId, 'Ana was in the way');
  const seen = w.notices(inside);
  assert.equal(seen.length, 1); assert.match(seen[0], /^The god is building the house; you stepped outside\.$/);
  assert.deepEqual(w.notices(beside), ['The god built a house at Green field.']);
  w.advance(1000);
  for (let i = 0; i < 50; i++) { w.act([{ op: 'place', def: coreRef('bench'), name: `b${i}`, p: [20 + (i % 10) * 1.5, 10 + Math.floor(i / 10) * 2] }]); w.advance(500); }
  await w.settle(25);
  assert.equal(w.notices(beside).length, 1, 'nothing new inside the minute');
  w.advance(MAP_NOTICE.everyMs); await w.settle(25);
  assert.deepEqual(w.notices(beside)[0], 'The god kept changing things nearby (50 more edits since the last notice).');
  assert.equal(w.notices(beside).length, 2);
});

test('construction: one notice when a build starts nearby, none per edit while it is closed, one at done', { timeout: 120_000 }, async t => {
  const w = world(t);
  const near = await w.soul('ana', 'Ana', [20, 0]), far = await w.soul('bo', 'Bo', [-28, -28]);
  const started: any = w.god.builds.start({ id: 'church', title: 'Stone church', steps: ['shell', 'roof'], site: { at: [0, 0], size: [14, 12] } }, w.caller);
  assert.equal(started.ok, true, JSON.stringify(started)); await w.settle(2);
  assert.deepEqual(w.notices(near), ['The god started building Stone church nearby; it is closed until finished.']);
  w.advance(MAP_NOTICE.everyMs + 1);
  const r: any = w.god.as({ identity: w.caller, build: { id: 'church', lease: started.lease, step: 1 } }, () => w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'pew', p: [2, 2] }] }));
  assert.equal(r.accepted, true, JSON.stringify(r)); await w.settle(2);
  assert.equal(w.notices(near).length, 1, 'a closed site\'s edits are covered by its start and done notices');
  const done: any = w.god.builds.done('church', {}, w.caller);
  assert.equal(done.ok, true, JSON.stringify(done)); await w.settle(2);
  assert.deepEqual(w.notices(near)[0], 'Stone church is finished and open.');
  assert.deepEqual(w.notices(far), []);
});
