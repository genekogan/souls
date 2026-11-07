import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { coreRef } from '@souls/world-compiler';
import { work } from '@souls/world-compiler/work-meter';
import { Hono } from 'hono';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode, type WorldBuildMessage, type WorldDiffMessage } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { VerifyUse } from './verify-use.ts';
import { inSite, inClosure, siteWorld } from './builds.ts';
import { registerEdgeComms } from '../edge/comms/index.ts';
import { edgeSoulResolver } from '../edge/routes.ts';
import type { EdgeCapability } from '../edge/contract.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  let now = 1_000_000;
  const emitted: (WorldBuildMessage | WorldDiffMessage)[] = [];
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => now, buildPauseMs: 50, buildClosureMs: 500, emit: (m: WorldBuildMessage | WorldDiffMessage) => emitted.push(m) });
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'builder'), caller = god.godIdentity(token)!;
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const soul = async (owner = 'ana', name = 'Ana') => { await invite(w, owner); const row: any = await accept(w.host, w.souls.create(`dev:${owner}`, { name, description: 'curious' })); await settle(3); return { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }; };
  const move = async (s: any, to: [number, number]) => { await accept(w.host, w.host.enqueue('edge-relocate', 'test:build', { soulId: s.soulId, entityId: s.entityId, to, why: 'build resident fixture' })); await settle(2); };
  const build = async () => {
    const r = god.act({ ops: [
      { op: 'define', def: { schema: 'def/1', name: 'resident-house', version: 1, tags: ['building'], size: { box: [8, 3, 6] }, make: { kind: 'gen', gen: 'building/1', args: { style: 'shed' } }, params: { floors: { type: 'int', min: 1, max: 6, default: 1 } }, components: { foundation: { kind: 'none' } } } },
      { op: 'place', tmp: '$h', def: 'resident-house@1', name: 'church', p: [10, 0] },
      { op: 'place', def: coreRef('chair'), name: 'pew', in: { parent: '$h', slot: 'ground' }, p: [-2, 0, -1] },
      { op: 'place', def: coreRef('bed'), name: 'bed', in: { parent: '$h', slot: 'ground' }, p: [2, 0, -1] },
    ] }); assert.equal(r.accepted, true, JSON.stringify(r)); await settle();
  };
  const start = (extra = {}) => { const r = god.builds.start({ id: 'church', title: 'Stone church', steps: ['shell', 'roof'], root: 'church', site: { at: [10, 0], size: [14, 12] }, ...extra }, caller) as any; assert.equal(r.ok, true, JSON.stringify(r)); return r; };
  const pos = (s: any): [number, number] => { const p = (w.host.engine.world as any).entities[s.entityId].pose.p; return [p[0], p[2]]; };
  const drive = async <T>(work: Promise<T>): Promise<T> => { let done = false; void work.then(() => { done = true; }, () => { done = true; }); const deadline = performance.now() + 15_000; while (!done && performance.now() < deadline) { for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1)); } assert.ok(done, 'native fixture drive completed'); return work; };
  return { ...w, god, edge, bridge, emitted, caller, token, settle, soul, move, build, start, pos, drive, advance: (ms: number) => { now += ms; } };
}
const cap = (w: ReturnType<typeof world>, s: any, id: string) => { const c = w.edge.capabilities(s).find(c => c.id === id); assert.ok(c, `${id} offered`); return c; };
const blocked = (c: EdgeCapability, code: string) => { assert.equal(c.available, false); assert.equal(c.blocked?.code, code); };

test('resident walk/hang-out, sit, lie and sleep refuse with the actual construction code at act time', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]); w.start(); await w.settle(1);
  const ids = ['walk:church', 'hang-out:church', `sit:${w.god.model.get('church/pew')!.id}`, `lie:${w.god.model.get('church/bed')!.id}`, `sleep:${w.god.model.get('church/bed')!.id}`];
  for (const id of ids) { blocked(cap(w, s, id), 'site.under-construction'); const r = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal(r.accepted, false, JSON.stringify(r)); assert.equal((r as any).code, 'site.under-construction', id); }
  assert.match(w.bridge.layers.tag(w.god.model.get('church/pew')!), /^under construction \(step 1\/2: shell\)/);
  // A body born inside a site is never adopted into roots.
  const roots = JSON.parse(w.god.store.build('church')!.body).roots; assert.ok(!roots.includes(s.entityId));
});

test('construction outranks private access, then done exposes private refusals for every protected verb', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]);
  const r = w.god.act({ ops: [{ op: 'set', id: 'church', owner: 'soul:Other', access: 'private' }] }); assert.equal(r.accepted, true); w.start({ include: [...w.god.model.entities.keys()] }); await w.settle(1);
  const ids = ['walk:church', 'hang-out:church', `sit:${w.god.model.get('church/pew')!.id}`, `lie:${w.god.model.get('church/bed')!.id}`, `sleep:${w.god.model.get('church/bed')!.id}`];
  for (const id of ids) blocked(cap(w, s, id), 'site.under-construction');
  w.god.builds.done('church', {}, w.caller); await w.settle(1);
  for (const id of ids) { blocked(cap(w, s, id), 'object.private'); const out = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal((out as any).code, 'object.private', id); }
});

test('WD1: a rotated mass closes its 1.5 m margin while seats and residents elsewhere on the plot remain usable', async t => {
  const w = world(t), site = { at: [30, 0] as [number, number], size: [40, 40] as [number, number], yaw: Math.PI / 2 };
  const centre = siteWorld(site, [10, 0]);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'inner', p: centre }, { op: 'place', def: coreRef('bench'), name: 'outer', p: [44, 10] }] }).accepted, true); await w.settle();
  const s = await w.soul(), bystander = await w.soul('bo', 'Bo'); await w.move(s, [30, -7]); await w.move(bystander, [44, 10]);
  const start = w.start({ root: undefined, site, massing: [{ name: 'hall', at: [10, 0], size: [4, 6], h: 5 }] });
  assert.deepEqual(start.inventory.things.map((e: any) => e.path), ['inner']); assert.equal(start.inventory.seats[0].occupied, false);
  assert.deepEqual(start.inventory.bodies, [{ name: s.name, soulId: s.soulId }]); assert.ok(start.inventory.places.length > 0);
  const closing = w.god.builds.closingSites()[0]; assert.equal(inClosure(closing, [30, -6.6]), true); assert.equal(inClosure(closing, [30, -6.4]), false);
  const inner = w.god.model.get('inner')!.id, outer = w.god.model.get('outer')!.id;
  blocked(cap(w, bystander, `sit:${inner}`), 'site.under-construction'); assert.equal(cap(w, bystander, `sit:${outer}`).available, true);
  for (const [at, blockedExpected] of [[[30, -6.6], true], [[30, -6.4], false], [[44, 10], false]] as [[number, number], boolean][]) {
    const r = w.bridge.layers.constructionRefusal(bystander, [{ verb: 'walk_to', params: { to: at } }]); assert.equal(r?.code === 'site.under-construction', blockedExpected);
  }
  const before = w.pos(bystander); await w.settle(15); assert.deepEqual(w.pos(bystander), before);
  assert.equal(inClosure(closing, w.pos(s)), false); assert.equal(inSite(site, w.pos(s)), true, 'evacuation only leaves the construction zone');
});

test('WD1: root closure follows current footprints after move, undo and removal', async t => {
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'moving', p: [0, 0] }] }).accepted, true); await w.settle();
  const start = w.start({ root: 'moving', site: { at: [0, 0], size: [20, 20] } }), id = w.god.model.get('moving')!.id;
  assert.equal(w.god.builds.closingSites().some(s => inClosure(s, [0, 0])), true);
  assert.equal(w.god.act({ ops: [{ op: 'move', id, p: [30, 0], mode: 'nudge' }], build: { id: 'church', lease: start.lease } }).accepted, true);
  assert.equal(w.god.builds.closingSites().some(s => inClosure(s, [0, 0])), false); assert.equal(w.god.builds.closingSites().some(s => inClosure(s, [30, 0])), true);
  assert.equal(w.god.undo().accepted, true); assert.equal(w.god.builds.closingSites().some(s => inClosure(s, [0, 0])), true); assert.equal(w.god.builds.closingSites().some(s => inClosure(s, [30, 0])), false);
  assert.equal(w.god.act({ ops: [{ op: 'remove', id }], build: { id: 'church', lease: start.lease } }).accepted, true); assert.deepEqual(w.god.builds.closingSites()[0].zones, []);
});

test('stroll and non-enclosed walk targets are closed; probe exemption preserves plans', async t => {
  const w = world(t); assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [0, 0] }] }).accepted, true); await w.settle();
  w.start({ root: 'bench', site: { at: [0, 0], size: [10, 10] } });
  const target = w.god.model.get('bench')!.id, soul = { soulId: 's_test', entityId: 'h_test', name: 'Test', owner: 'owner' };
  for (const probe of [false, true]) {
    const caps = ['walk', 'hang-out', 'stroll'].map(verb => ({ id: `${verb}:bench`, verb, label: verb, available: true, target: { id: target, kind: 'object' } })) as EdgeCapability[];
    const plans = new Map(caps.map(c => [c.id, { label: c.label, steps: [] }]));
    w.bridge.layers.capabilities({ ...soul, soulId: probe ? 's_vp0000000001' : soul.soulId }, caps, plans, [10, 0]);
    for (const c of caps) if (probe) { assert.equal(c.available, true); assert.ok(plans.has(c.id)); } else { blocked(c, 'site.under-construction'); assert.ok(!plans.has(c.id)); }
  }
});

test('verify-use enters and sits at an open build; probe body never evacuates or becomes a root', { timeout: 30_000 }, async t => {
  const w = world(t); await w.build(); w.start();
  const verify = new VerifyUse(w.host, w.souls, w.god, w.edge);
  const r = await w.drive(verify.run({ target: 'church', seat: 'church/pew', timeoutMs: 12_000 }));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.probe.removed, true);
  const events = w.db.events(w.host.worldId, 0, 10000); assert.ok(!events.some(e => e.kind === 'edge-relocate' && (e.payload as any).why === 'the god started building here: stepped off the site' && String((e.payload as any).soulId).startsWith('s_vp')));
  assert.equal(JSON.parse(w.god.store.build('church')!.body).roots.some((id: string) => id.startsWith('h_vp')), false);
});

test('G1: a resident inside a newly marked site walks off it within 15 ticks and is told why', async t => {
  const w = world(t), s = await w.soul(); await w.move(s, [0, 0]);
  w.start({ root: undefined, site: { at: [0, 0], size: [10, 10], yaw: .4 }, massing: [{ at: [0, 0], size: [10, 10], h: 2 }] });
  await w.settle(15); assert.equal(inSite({ at: [0, 0], size: [10, 10], yaw: .4 }, w.pos(s), .5), false, JSON.stringify(w.pos(s)));
  const ev = w.db.events(w.host.worldId, 0, 10000).filter(e => e.author === 'god:walkout');
  assert.equal(ev.length, 1, 'one walk-out, not one per cadence'); assert.equal(ev[0].kind, 'edge-god-walkout');
  const why = 'The god started building Stone church here; you stepped off the site.';
  assert.equal((ev[0].payload as any).why, why); assert.deepEqual([w.pos(s)[0], w.pos(s)[1]], (ev[0].payload as any).to, 'the walk ends at its exit in the same pass');
  const seen = w.edge.observe(s as any, new Set()) as any;
  assert.deepEqual(seen.notices?.map((n: any) => [n.kind, n.text, n.moved, n.place]), [['god-change', why, 'walked', 'Stone church']], 'the next observation carries the notice');
  assert.ok(w.host.minds.get(s.soulId)!.recent.includes(why), 'the native observation remembers it too');
});

test('G1: seated residents are walked out by a closing site, a build edit and a whole-build undo; none is refused', { timeout: 60_000 }, async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 8]); const E = w.host.engine as any;
  const pew = w.god.model.get('church/pew')!.id, church = w.god.model.get('church')!.id;
  const sit = async () => {
    const r = await accept(w.host, w.edge.act(s, { capability: `sit:${pew}`, params: { seconds: 600 } })); assert.equal(r.accepted, true, JSON.stringify(r));
    for (let i = 0; i < 3000 && E.world.entities[s.entityId].human.activity !== 'sit'; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } }
    await w.settle(5); assert.equal(E.world.entities[s.entityId].human.activity, 'sit', 'seated on the pew');
  };
  const outside = () => { const [x, z] = w.pos(s); return Math.abs(x - 10) > 4 || Math.abs(z) > 3; };
  await sit();
  // 1. Starting a build over an occupied pew is not refused; the closure walks the seated resident off the site.
  const start = w.start(); assert.ok(start.inventory.seats.some((x: any) => x.path === 'church/pew' && x.occupied), 'the inventory still shows who sits there');
  await w.settle(45);
  assert.notEqual(E.world.entities[s.entityId].human.activity, 'sit'); assert.equal(w.god.builds.closingSites().some(site => inClosure(site, w.pos(s))), false);
  const first = w.db.events(w.host.worldId, 0, 10000).filter(e => e.author === 'god:walkout').at(-1)!;
  assert.equal((first.payload as any).why, 'The god started building Stone church here; you stood up and stepped off the site.');
  assert.ok((first.payload as any).released.includes(pew), 'the pew is released');
  // 2. A build edit (not just a free edit) over a seated resident applies at once and walks it outside.
  w.advance(501); w.god.builds.sweep(); await w.settle(1); await sit();
  const resume = w.god.builds.resume('church', {}, w.caller) as any; assert.equal(resume.ok, true);
  const edit = w.god.act({ ops: [{ op: 'set', id: 'church', params: { floors: 2 } }], build: { id: 'church', lease: resume.lease } }) as any;
  assert.equal(edit.accepted, true, JSON.stringify(edit));
  assert.deepEqual(edit.moved.map((m: any) => [m.name, m.how, m.reason]), [['Ana', 'walked', 'The god is rebuilding the church; you stood up and stepped outside.']]);
  assert.equal(E.world.entities[s.entityId].human.activity, 'idle'); assert.ok(outside(), `outside the church: ${w.pos(s)}`);
  assert.equal(w.god.model.entities.get(church)!.params?.floors, 2);
  // 3. Whole-build undo after done (the release-1 copy case) is a god edit too: walked out, never refused.
  w.god.builds.done('church', {}, w.caller); await w.settle(1); await sit();
  const undo = w.god.undoGroup('church') as any; assert.equal(undo.accepted, true, JSON.stringify(undo));
  assert.deepEqual(undo.moved.map((m: any) => [m.name, m.how]), [['Ana', 'walked']]); assert.match(undo.moved[0].reason, /^The god is rebuilding the church; you stood up and stepped outside\.$/);
  assert.ok(undo.warnings.some((x: string) => x.startsWith('body.walked-out: Ana walked to ')));
  assert.equal(E.world.entities[s.entityId].human.activity, 'idle'); assert.ok(outside(), `outside the church: ${w.pos(s)}`);
  assert.equal(w.god.model.entities.get(church)!.params?.floors ?? 1, 1, 'the build edit is undone');
  await w.settle(5); assert.deepEqual(E.runtime.violations, []);
});

test('G1: a resident walking through a closing site to a seat beyond it is passing by: never walked out, reaches the seat', { timeout: 60_000 }, async t => {
  const w = world(t), s = await w.soul(), E = w.host.engine as any;
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'far-bench', p: [-14, 0] }] }).accepted, true); await w.settle(3);
  await w.move(s, [14, 0]);
  w.start({ root: undefined, site: { at: [0, 0], size: [12, 30] }, massing: [{ at: [0, 0], size: [12, 30], h: 2 }] }); await w.settle(2);
  const bench = w.god.model.get('far-bench')!.id;
  const r = await accept(w.host, w.edge.act(s, { capability: `sit:${bench}`, params: { seconds: 600 } })); assert.equal(r.accepted, true, JSON.stringify(r));
  let crossed = false;
  for (let i = 0; i < 3000 && E.world.entities[s.entityId].human.activity !== 'sit'; i++) {
    w.host.tickOnce(); if (w.god.builds.closingSites().some(site => inClosure(site, w.pos(s)))) crossed = true;
    if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); }
  }
  await w.settle(3);
  assert.ok(crossed, 'the route crossed the closing site');
  assert.equal(E.world.entities[s.entityId].human.activity, 'sit', `reached the bench beyond the site: ${JSON.stringify(w.pos(s))}`);
  assert.equal(w.db.events(w.host.worldId, 0, 10000).filter(e => e.author === 'god:walkout').length, 0, 'never walked out on the way');
});

test('closure lift, done and abandon reopen capabilities; lifted build keeps its slot', async t => {
  const w = world(t); await w.build(); const s = await w.soul(); await w.move(s, [10, 9]); w.start(); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction');
  w.advance(501); w.god.builds.sweep(); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true); assert.equal(w.bridge.layers.active(), false); assert.equal(w.god.builds.list().open.length, 1);
  assert.ok(w.emitted.some(m => m.kind === 'world-build' && m.event === 'closure-lifted' && m.delta?.closed === false));
  const resume = w.god.builds.resume('church', {}, w.caller); assert.equal(resume.ok, true); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true, 'resume does not re-arm closure');
  assert.equal(w.god.builds.step('church', { lease: (resume as any).lease, say: 'Reading the plans' }, w.caller).ok, true); assert.equal(cap(w, s, 'walk:church').available, true);
  assert.equal(w.god.act({ ops: [{ op: 'set', id: 'church/pew', name: 'pew-ready' }], build: { id: 'church', lease: (resume as any).lease } }).accepted, true); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction');
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true); assert.equal(w.bridge.layers.active(), false);
  w.start({ id: 'renovation' }); await w.settle(1); blocked(cap(w, s, 'walk:church'), 'site.under-construction'); w.god.builds.abandon('renovation', {}, () => ({ accepted: true, reverted: [], notReverted: [] })); await w.settle(1); assert.equal(cap(w, s, 'walk:church').available, true);
});

// Z3: work budgets, not milliseconds (see @souls/world-compiler/work-meter): the same answer on any CPU, so it runs in the gate.
// Measured 2026-10-20, identical on every run: capabilities for 20 Souls 744,455 (max of 30 ticks), +296,620 with a build
// open, an idle evacuation with 8 sites 2,311. Budgets are about 2x.
const RESIDENT_WORK = { capabilities20: 1_500_000, buildOverhead: 600_000, evacuate20x8: 4_700 };
test('bench: capabilities for 20 Souls, idle evacuation with 8 sites', { timeout: 120_000 }, async t => {
  const w = world(t); await w.build();
  const souls: Awaited<ReturnType<typeof w.soul>>[] = []; for (let i = 0; i < 20; i++) souls.push(await w.soul(`bench${i}`, `Resident${i}`));
  const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)], max: s.at(-1)! }; };
  const measure = () => { const samples: number[] = []; for (let i = 0; i < 30; i++) { w.host.engine.world.tick++; samples.push(work(() => { for (const soul of souls) w.edge.capabilities(soul); }).total); } return stats(samples); };
  measure(); const plain = measure(); w.start(); measure(); const build = measure();
  for (let i = 1; i < 8; i++) w.start({ id: `site-${i}`, root: undefined, site: { at: [i * 20 - 80, 40], size: [10, 10] } });
  const samples: number[] = []; for (let i = 0; i < 100; i++) samples.push(work(() => w.bridge.evacuateSites()).total);
  const evacuate = stats(samples);
  console.log('RESIDENT_BENCH ' + JSON.stringify({ capabilities20Work: { plain, build }, evacuate20x8Work: evacuate }));
  assert.ok(plain.max <= RESIDENT_WORK.capabilities20, `capabilities work ${plain.max}`);
  assert.ok(build.max - plain.max <= RESIDENT_WORK.buildOverhead, `capabilities build overhead work ${build.max - plain.max}`);
  assert.ok(evacuate.max <= RESIDENT_WORK.evacuate20x8, `evacuation work ${evacuate.max}`);
});

test('C1b #9: plans into a closing site are blocked even when their named plaza surrounds it', async t => {
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('plaza'), name: 'square', shape: { area: [[-16, -16], [16, -16], [16, 16], [-16, 16]] } }] }).accepted, true); await w.settle();
  const s = await w.soul(); await w.move(s, [0, 30]);
  w.start({ root: undefined, site: { at: [0, 0], size: [10, 10] }, massing: [{ at: [0, 0], size: [10, 10], h: 2 }] }); await w.settle(1);
  for (const id of ['walk:square', 'hang-out:square']) {
    blocked(cap(w, s, id), 'site.under-construction');
    const result = await accept(w.host, w.edge.act(s, { capability: id })); assert.equal((result as any).code, 'site.under-construction');
  }
  // Stroll routes vary with the plaza seed. Every retained stop must be outside the closure.
  const stroll = cap(w, s, 'stroll:square'), plan = w.edge.coreA.binds(s).plans.get(stroll.id);
  if (stroll.available) { assert.ok(plan); for (const step of plan.steps) if (step.verb === 'walk_to') assert.equal(inSite({ at: [0, 0], size: [10, 10], yaw: 0 }, step.params.to as [number, number], .5), false); }
  else { blocked(stroll, 'site.under-construction'); assert.equal(plan, undefined); }
  const synthetic = { id: 'stroll:square', verb: 'stroll', label: 'stroll', available: true } as EdgeCapability;
  const plans = new Map([[synthetic.id, { label: 'stroll', steps: [{ verb: 'walk_to', params: { to: [20, 20] } }, { verb: 'mars:walk_to', params: { x: 0, z: 0 } }] }]]);
  w.bridge.layers.capabilities(s, [synthetic], plans, [0, 30]); blocked(synthetic, 'site.under-construction'); assert.equal(plans.size, 0);
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, 'walk:square').available, true);
});

test('C1b #10: approach by id/name and go-near cannot bypass membership or destination closure', async t => {
  const w = world(t); assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [30, 0] }] }).accepted, true); await w.settle();
  const s = await w.soul(), other = await w.soul('bo', 'Bo'); await w.move(s, [30, 12]); await w.move(other, [30, 7.5]);
  const bench = w.god.model.get('bench')!.id, E = w.host.engine as any;
  assert.equal((await accept(w.host, w.edge.act(other, { capability: `sit:${bench}`, params: { seconds: 1 } }))).accepted, true);
  for (let i = 0; i < 3000 && E.world.entities[other.entityId].human.activity !== 'sit'; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } }
  await w.settle(40); assert.equal(E.world.entities[other.entityId].human.activity, 'sit');
  w.start({ root: 'bench', site: { at: [30, 0], size: [10, 10] }, include: [bench] }); await w.settle(1);
  for (const target of [bench, 'bench', other.soulId]) {
    const dry = w.edge.intents.resolve(s, { verb: 'approach', target }); assert.equal(dry.ok, false, JSON.stringify({ target, dry })); assert.equal(!dry.ok && dry.code, 'site.under-construction');
    const result = await accept(w.host, w.edge.act(s, { verb: 'approach', target })); assert.equal(result.accepted, false); assert.equal((result as any).code, 'site.under-construction');
  }
  const near = `go-near:${other.soulId}`; blocked(cap(w, s, near), 'site.under-construction');
  assert.equal((await accept(w.host, w.edge.act(s, { capability: near })) as any).code, 'site.under-construction');
  assert.equal(E.programOf(s.entityId), null);
  w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(w.edge.intents.resolve(s, { verb: 'approach', target: bench }).ok, true); assert.equal(cap(w, s, near).available, true);
});

test('C1b #11: read and every model-object target honor closure while private access keeps its verb scope', async t => {
  const w = world(t);
  const comms = registerEdgeComms(new Hono(), { host: w.host, db: w.db, souls: w.souls, soul: edgeSoulResolver(w.host, w.souls, () => undefined), ledger: w.edge } as any, { sweepMs: 0 } as any); w.edge.attachComms(comms as any);
  try {
    assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('sign'), name: 'notice', p: [10, 0], state: { text: 'Opening soon' }, owner: 'soul:Other', access: 'private' }] }).accepted, true); await w.settle();
    const s = await w.soul(); await w.move(s, [10, 12]); w.start({ root: 'notice', include: [w.god.model.get('notice')!.id] }); await w.settle(1);
    const target = w.god.model.get('notice')!.id, read = `read:${target}`;
    blocked(cap(w, s, read), 'site.under-construction'); assert.equal((await accept(w.host, w.edge.act(s, { capability: read })) as any).code, 'site.under-construction');
    const caps = ['read', 'inspect', 'play'].map(verb => ({ id: `${verb}:${target}`, verb, label: verb, target: { id: target, kind: 'object' }, available: true })) as EdgeCapability[];
    const plans = new Map(caps.map(c => [c.id, { label: c.label, steps: [] }]));
    w.bridge.layers.capabilities(s, caps, plans, [10, 12]); for (const c of caps) blocked(c, 'site.under-construction');
    w.god.builds.done('church', {}, w.caller); await w.settle(1); assert.equal(cap(w, s, read).available, true, 'read is not subject to private-seat/hand restrictions');
  } finally { (comms as any).close(); }
});

test('C1b #12: sit:here chooses the nearest usable seat and named sit reports the construction code', async t => {
  // D2 (2026-10-25): sit:here takes only a seat that is here (within 3 m outdoors), so the Soul stands 2 m from outer
  const w = world(t);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'inner', p: [30, 0] }, { op: 'place', def: coreRef('bench'), name: 'outer', p: [30, 17] }] }).accepted, true); await w.settle();
  const s = await w.soul(); await w.move(s, [30, 15]); w.start({ root: 'inner', site: { at: [30, 0], size: [6, 6] } }); await w.settle(1);
  const inner = w.god.model.get('inner')!.id, outer = w.god.model.get('outer')!.id;
  blocked(cap(w, s, `sit:${inner}`), 'site.under-construction'); assert.equal(cap(w, s, `sit:${outer}`).available, true);
  const here = cap(w, s, 'sit:here'); assert.equal(here.available, true); assert.equal(here.target?.id, outer); assert.equal(here.blocked, undefined);
  const named = await accept(w.host, w.edge.act(s, { verb: 'sit', target: inner })); assert.equal(named.accepted, false); assert.equal((named as any).code, 'site.under-construction');
  const result = await accept(w.host, w.edge.act(s, { capability: 'sit:here' })); assert.equal(result.accepted, true, JSON.stringify(result));
});

test('L4 item 5: build events re-perceive only the layered things under the site, and end where a whole pass ends', async t => {
  const w = world(t);
  const comms = registerEdgeComms(new Hono(), { host: w.host, db: w.db, souls: w.souls, soul: edgeSoulResolver(w.host, w.souls, () => undefined), ledger: w.edge } as any, { sweepMs: 0 } as any); w.edge.attachComms(comms as any);
  t.after(() => comms.close?.());
  await w.build();
  const r = w.god.act({ ops: [{ op: 'set', id: 'church', owner: 'soul:Other', access: 'private' }, { op: 'place', def: coreRef('fountain'), name: 'far-fountain', p: [60, 60], owner: 'soul:Other' }] }); assert.equal(r.accepted, true, JSON.stringify(r));
  await w.settle(3);
  const P = w.bridge.perceive as any; P.sync(true);
  const wanted = () => JSON.stringify([...(P.desired as Map<string, unknown>).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const church = w.god.model.get('church')!.id;
  const check = async (label: string, fn: () => void) => {
    const runs = P.stats.runs; fn();
    for (let i = 0; i < 200 && (P.pending() || P.stats.runs === runs); i++) await w.settle(1);
    assert.equal(P.pending(), false, `${label}: caught up`);
    assert.equal(P.stats.lastFull, false, `${label}: no whole pass`);
    assert.ok(P.stats.lastIds <= 2, `${label}: only the layered things under the site (${P.stats.lastIds})`);
    const inc = wanted(); P.sync(true); assert.equal(inc, wanted(), `${label}: equals a whole pass`);
    return JSON.parse(inc).find(([id]: [string]) => id === church)?.[1]?.what as string;
  };
  assert.match(await check('started', () => w.start({ include: ['church', 'church/pew', 'church/bed'].map((n) => w.god.model.get(n)!.id) })), /under construction \(step 1\/2: shell\)/);
  assert.doesNotMatch(await check('done', () => w.god.builds.done('church', {}, w.caller)), /under construction/);
  // the load dial: at black no background catch-up starts; back at green it does
  w.bridge.setLoadLevel('black');
  const g = w.god.act({ ops: [{ op: 'set', id: 'far-fountain', owner: 'soul:Ana' }] }); assert.equal(g.accepted, true);
  for (let i = 0; i < 120; i++) await w.settle(1);
  assert.equal(P.pending(), true, 'black: the change waits');
  w.bridge.setLoadLevel('green');
  for (let i = 0; i < 120 && P.pending(); i++) await w.settle(1);
  assert.equal(P.pending(), false, 'green: caught up');
});
