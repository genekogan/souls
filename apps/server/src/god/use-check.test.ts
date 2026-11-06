// Lane BS1 (BUILDSAFE item 5): the use-check says a seat or bed can be used exactly when a body can actually sit or lie on
// it. A free bench and bed pass and a Soul sits and lies on them; a bench hemmed in by walls (no room to stand), one ringed
// by a thin wall (the sit/stand slide would cross it) and one sealed in a walled yard (cut off from the main ground) fail
// with a god-readable line each, and a Soul sent to sit on them never does. In-process CPU checks.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreLibrary, coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { SEAT_HEIGHTS, useCheck } from './use-check.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function setup(t: TestContext) {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle();
  await invite(f, 'rowan');
  const row = await accept(f.host, f.souls.create('dev:rowan', { name: 'Rowan', description: 'use-check control' }));
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle();
  const act = (ops: any[]) => { const r = god.act({ ops }) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  const until = async (ok: () => boolean, max = 1500) => { for (let i = 0; i < max && !ok(); i++) await settle(1); return ok(); };
  const human = () => f.host.engine.world.entities[soul.entityId].human as { activity: string; berth?: string };
  return { ...f, god, edge, bridge, soul, settle, act, until, human, E: f.host.engine as any };
}

// core-bench-seat: 1.37 × 0.31 m, two seats facing +z at x = ±0.35. Walls are core walls (w ≥ 0.5 m along x, d along z; turned a quarter for the ends).
const wall = (name: string, p: [number, number], w: number, d: number, r = 0) => ({ op: 'place', def: coreRef('wall'), name, p, r, params: { w, h: 2.6, d } });
const ring = (name: string, c: [number, number], hx: number, hz: number, d: number) => [
  wall(`${name}-n`, [c[0], c[1] + hz + d / 2], 2 * hx, d), wall(`${name}-s`, [c[0], c[1] - hz - d / 2], 2 * hx, d),
  wall(`${name}-e`, [c[0] + hx + d / 2, c[1]], 2 * (hz + d), d, Math.PI / 2), wall(`${name}-w`, [c[0] - hx - d / 2, c[1]], 2 * (hz + d), d, Math.PI / 2),
];

test('use-check: a seat or bed is usable exactly when a body can sit or lie on it', { timeout: 300_000 }, async (t) => {
  const w = await setup(t);
  const placed = w.act([
    { op: 'place', def: coreRef('bench-seat'), name: 'free-bench', p: [10, 10] },
    { op: 'place', def: coreRef('bed'), name: 'free-bed', p: [16, 10] },
    // hemmed in: 0.2 m of floor round the bench, then 1 m thick walls (every candidate stand point has < 0.34 m clear)
    { op: 'place', def: coreRef('bench-seat'), name: 'hemmed', p: [-20, 10] }, ...ring('hem', [-20, 10], 0.685 + 0.2, 0.155 + 0.2, 1),
    // ringed: a thin wall 3 cm off the bench all round; outside it there is standing room, but sliding on would cross it
    { op: 'place', def: coreRef('bench-seat'), name: 'ringed', p: [-20, -10] }, ...ring('rim', [-20, -10], 0.685 + 0.03, 0.155 + 0.03, 0.1),
    // sealed: a free bench in the middle of a 6 m walled yard with no way in
    { op: 'place', def: coreRef('bench-seat'), name: 'sealed', p: [20, -20] }, ...ring('yard', [20, -20], 3, 3, 0.3),
  ]);
  // buildsafe/1 (BS2) repairs a god edit that hems a bench in (it nudges hem-n clear); keep the use-check's no-approach
  // coverage by putting hem-n back where it was sent as a legacy wall (as verify-use.test seeds its legacy sealed world).
  assert.ok(placed.warnings.some((l: string) => /buildsafe\/1\): hem-n moved .* so hemmed can be walked to/.test(l)), JSON.stringify(placed.warnings));
  const hn = w.god.model.get('hem-n')!, back = { ...hn, p: [-20, 0, 10 + 0.155 + 0.2 + 0.5] as [number, number, number] };
  w.god.model.delete(hn.id); w.god.model.insert(back); w.god.model.index(back.id, w.god.model.footprint(back)); w.bridge.reconcile();
  await w.settle(4);
  const id = (n: string) => w.god.model.get(n)!.id;
  const names = ['free-bench', 'free-bed', 'hemmed', 'ringed', 'sealed'];
  const all = useCheck(w.E, names.map(id), w.god.model);
  const by = (n: string) => all.filter((v) => v.of === id(n));
  console.log(all.map((v) => `${w.god.model.pathOf(v.of)} ${v.id.split('#')[1]} ${v.ok ? 'ok' : v.code}${v.line ? ` | ${v.line}` : ''}`).join('\n'));
  assert.deepEqual(by('free-bench').map((v) => [v.kind, v.ok]), [['seat', true], ['seat', true]]);
  assert.deepEqual(by('free-bed').map((v) => [v.kind, v.ok]), [['berth', true], ['berth', true]]);
  assert.deepEqual(by('hemmed').map((v) => v.code), ['use.no-approach', 'use.no-approach']);
  assert.deepEqual(by('ringed').map((v) => v.code), ['use.transition-blocked', 'use.transition-blocked']);
  assert.deepEqual(by('sealed').map((v) => v.code), ['nav.disconnected', 'nav.disconnected']);
  for (const v of all.filter((x) => !x.ok)) assert.match(v.line ?? '', /^(hemmed|ringed|sealed) seat-\d: cannot be sat on: /);
  assert.match(by('hemmed')[0].line!, /in the way: hem-n, hem-s\.$/);
  assert.match(by('ringed')[0].line!, /in the way: rim-[nsew]\.$/);
  // all fixtures by default (the walls have no slots), and the seat-top read: the bench's 0.465 m seat fits the standard body
  assert.equal(useCheck(w.E).length, all.length);
  assert.deepEqual(w.E.useCheckV1({ of: [id('free-bench')], seatTop: () => 1.3 }).map((v: any) => v.ok), [true, true], '#1083: a 1.3 m seat top is no finding (any declared seat is sat on)');
  assert.deepEqual(w.E.useCheckV1({ of: [id('free-bench')], seatTop: () => 2.3 }).map((v: any) => v.code), ['use.seat-out-of-reach', 'use.seat-out-of-reach'], 'above the 2.06 m standing reach: out of reach');
  // what a body actually does: sits on the free bench and lies on the free bed, never gets onto the others
  const send = async (cap: string) => { const out = await accept(w.host, w.edge.act(w.soul, { capability: cap, params: { seconds: 2 } })) as any; return out; };
  const done = async (r: any) => { if (r.accepted) await w.until(() => ['completed', 'failed', 'cancelled'].includes(w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase ?? '')); };
  let r = await send(`sit:${id('free-bench')}`);
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => w.human().activity === 'sit'), 'sits on the free bench');
  await done(r);
  r = await send(`lie:${id('free-bed')}`);
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => !!w.human().berth), 'lies on the free bed');
  await done(r);
  for (const n of ['hemmed', 'ringed', 'sealed']) {
    r = await send(`sit:${id(n)}`);
    let sat = false;
    if (r.accepted) { await w.until(() => (sat ||= w.human().activity === 'sit') || ['completed', 'failed', 'cancelled'].includes(w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase ?? ''), 3000); }
    assert.equal(sat, false, `${n}: the body never sits (${JSON.stringify(r.accepted ? w.edge.receipt(w.soul.soulId, r.receipt.id) : r)})`);
  }
});

// The edge sit capability reads the same baked seat tops (seatTopsOf): engine seat slots carry no height, so it used to read
// none and offered every seat to every body, which then failed at the seat. A 1.16 m stool top suits the standard 1.75 m
// body (seats up to 1.2 m) but not the shortest look (1.65 m: up to 1.13 m), and the use-check reads the same top.
test('use-check: a seat higher than the body\'s comfortable range is offered and sat on (#1083)', { timeout: 120_000 }, async (t) => {
  const w = await setup(t);
  const me = w.host.engine.world.entities[w.soul.entityId] as any, at: [number, number] = [me.pose.p[0] + 4, me.pose.p[2]];
  const stool = { schema: 'def/1', name: 'tall-stool', version: 1, tags: ['furniture', 'seat'], form: 'point', size: { box: [0.5, 1.16, 0.5] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.58, 0], size: [0.5, 1.16, 0.5] }] } },
    slots: [{ id: 'seat', kind: 'seat', p: [0, 1.16, 0], yaw: 0, height: 1.16, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: 1.16 } } };
  w.act([{ op: 'define', def: stool }, { op: 'place', def: 'tall-stool@1', name: 'stool', p: at }]);
  await w.settle(4);
  const id = w.god.model.get('stool')!.id, cap = () => w.edge.capabilities(w.soul).find((c: any) => c.id === `sit:${id}`) as any;
  assert.deepEqual(useCheck(w.E, [id], w.god.model).map((v) => [v.kind, v.ok]), [['seat', true]], 'the standard body sits on it');
  assert.equal(cap()?.available, true, `the standard body may sit on a 1.16 m seat: ${JSON.stringify(cap())}`);
  me.body = { family: 'humanoid', model: 'short', params: { height: 1.65 } };
  await w.settle(1);   // capabilities are cached per tick
  // #1083: the shortest look sits on it too, whatever its height
  const c = cap();
  assert.equal(c?.available, true, JSON.stringify(c));
  const r = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${id}`, params: { seconds: 2 } })) as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => w.human().activity === 'sit'), 'the 1.65 m body sits on the 1.16 m stool');
  assert.deepEqual(w.E.rt?.violations ?? [], []);
});

// SEATDEF (2026-10-22): 32 of the library's 180 seat slots stored a seat height no body sits at (the Mars bus seats' and
// papasan's box top, cab seats' and bleacher benches' height above the ground) or a true floor-seat top (cushions,
// tiers, mattresses). The library revisions now carry the measured heights, SEAT_HEIGHTS carries them to the revisions
// worlds already placed, and no core seat is too high for the shortest look.
const SHORT = { family: 'humanoid', model: 'short', params: { height: 1.65 } } as const;
test('use-check: every core seat has a real height, and SEAT_HEIGHTS is what the library revisions store', () => {
  const lib = coreLibrary(), high: string[] = [];
  for (const d of lib.all()) {
    if (!lib.get(d.ref) || lib.get(d.ref)!.hash !== d.hash) continue;   // current revisions only
    for (const s of d.slots.filter((x) => x.kind === 'seat')) {
      const h = SEAT_HEIGHTS[d.name] ?? s.height ?? s.p[1];
      if (!(h >= 0)) high.push(`${d.ref} ${s.id} ${h}`);   // #1083: every core seat has a real height (none is refused by it)
      if (SEAT_HEIGHTS[d.name] !== undefined) assert.equal(s.height, SEAT_HEIGHTS[d.name], `${d.ref} ${s.id} stores the measured height`);
    }
  }
  assert.deepEqual(high, []);
  for (const n of Object.keys(SEAT_HEIGHTS)) assert.ok(lib.all().some((d) => d.name === n), `${n} is a library def`);
  // the Mars seats' top is the seat surface too (the slot sits a body there); vehicle and bleacher seats keep their place
  for (const r of ['core/mars-bus-seat@3', 'core/mars-papasan@3']) for (const s of lib.get(r)!.slots) assert.equal(s.p[1], SEAT_HEIGHTS[lib.get(r)!.name], r);
  assert.equal(lib.get('core/tractor@1')!.slots[0].p[1], 1.5);
});

// The retired bus seat revision (box top 1.22 m as seat height, def hash 0fdaaed90c23…) stays what worlds that placed it
// store, byte for byte; its seat reads the measured 0.51 m, so the shortest look may sit on it and does, as Souls sit on
// the Mars diner bus seats today (mars-two e2e S10). Likewise the bleachers (top bench 1.4 m up), the papasan and a floor
// cushion (too low for a chair sit, sat on all the same). (Vehicles carry no seat component, so they offer no sit.)
test('use-check: seats Souls sit on today stay sittable for every look, retired revisions included', { timeout: 300_000 }, async (t) => {
  const w = await setup(t);
  const cur = coreLibrary().get('core/mars-bus-seat@3')!;
  const { hash: _h, ref: _r, by: _b, born: _n, budget: _u, ...input } = cur as any;
  const old = JSON.parse(JSON.stringify({ ...input, version: 2, description: input.description.replace('at 0.51 m', 'at 1.22 m') }));
  for (const s of old.slots) { s.p[1] = 1.22; s.height = 1.22; }
  old.components.seat.height = 1.22;
  const pinned = w.god.model.defineDef(old, 'core', 0);
  assert.equal(pinned.hash.slice(0, 12), '0fdaaed90c23', 'the retired revision, byte for byte');
  const me = w.host.engine.world.entities[w.soul.entityId] as any, [x0, z0] = [me.pose.p[0], me.pose.p[2]];
  w.act([
    { op: 'place', def: 'core/mars-bus-seat@2', name: 'old-bus-seat', p: [x0 + 4, z0] },
    { op: 'place', def: coreRef('mars-bus-seat', 3), name: 'bus-seat', p: [x0 - 4, z0] },
    { op: 'place', def: coreRef('mars-papasan', 3), name: 'papasan', p: [x0, z0 + 5] },
    { op: 'place', def: coreRef('bleachers'), name: 'bleachers', p: [x0 - 12, z0 + 10] },
    { op: 'place', def: coreRef('mars-tool-library-floor-cushion', 2), name: 'cushion', p: [x0, z0 - 5] },
  ]);
  await w.settle(4);
  assert.equal(w.god.model.resolvedDef(w.god.model.get('old-bus-seat')!.def)!.hash, pinned.hash, 'the placed seat is the retired revision');
  me.body = SHORT;
  await w.settle(1);
  const id = (n: string) => w.god.model.get(n)!.id;
  for (const n of ['old-bus-seat', 'bus-seat', 'papasan', 'bleachers', 'cushion']) {
    const c = w.edge.capabilities(w.soul).find((x: any) => x.id === `sit:${id(n)}`) as any;
    assert.equal(c?.available, true, `${n}: ${JSON.stringify(c)}`);
  }
  const fit = useCheck(w.E, ['old-bus-seat', 'bus-seat', 'papasan', 'bleachers'].map(id), w.god.model).filter((v) => !v.ok);
  assert.deepEqual(fit.map((v) => v.line), [], 'no finding on them');
  const r = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${id('old-bus-seat')}`, params: { seconds: 2 } })) as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(await w.until(() => w.human().activity === 'sit'), 'the shortest look sits on the retired bus seat');
});

// #1083: seated on one god-built seat, a sit on another stands first (the bare walk from inside the first seat's footprint
// was refused route.start-blocked); found by the seat-height Soul Run, with a 1.6 m stool and a 0.1 m seat.
test('use-check: from a 1.6 m god stool to a 0.1 m god seat, by their offers', { timeout: 180_000 }, async (t) => {
  const w = await setup(t);
  const me = w.host.engine.world.entities[w.soul.entityId] as any, [x, z] = [me.pose.p[0], me.pose.p[2]];
  const seat = (name: string, h: number, box: number[]) => ({ schema: 'def/1', name, version: 1, tags: ['furniture', 'seat'], form: 'point', size: { box },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, h / 2, 0], size: [box[0], h, box[2]] }] } },
    slots: [{ id: 'seat', kind: 'seat', p: [0, h, 0], yaw: 0, height: h, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: h } } });
  w.act([{ op: 'define', def: seat('tall-stool', 1.6, [0.5, 1.6, 0.5]) }, { op: 'define', def: seat('floor-seat', 0.1, [0.6, 0.1, 0.6]) },
    { op: 'place', def: 'tall-stool@1', name: 'tall', p: [x + 4, z] }, { op: 'place', def: 'floor-seat@1', name: 'floor', p: [x - 6, z] }]);
  await w.settle(4);
  const sit = async (n: string) => { const r = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${w.god.model.get(n)!.id}`, params: { seconds: 2 } })) as any;
    assert.equal(r.accepted, true, `${n}: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(await w.until(() => w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase === 'completed'), `${n}: ${JSON.stringify(w.edge.receipt(w.soul.soulId, r.receipt.id)).slice(0, 300)}`); };
  await sit('tall'); await sit('floor');
  assert.deepEqual(w.E.rt?.violations ?? [], []);
});

// #1083 (steward's review): up to the standing reach a seat is sat on, at that height; above it the sit is refused with the
// physical reason, by offer and by act
test('use-check: a 2.05 m god stool is sat on; a 2.2 m one is out of reach', { timeout: 180_000 }, async (t) => {
  const w = await setup(t);
  const me = w.host.engine.world.entities[w.soul.entityId] as any, [x, z] = [me.pose.p[0], me.pose.p[2]];
  const stool = (name: string, h: number) => ({ schema: 'def/1', name, version: 1, tags: ['furniture', 'seat'], form: 'point', size: { box: [0.5, h, 0.5] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, h / 2, 0], size: [0.5, h, 0.5] }] } },
    slots: [{ id: 'seat', kind: 'seat', p: [0, h, 0], yaw: 0, height: h, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: h } } });
  w.act([{ op: 'define', def: stool('reach-stool', 2.05) }, { op: 'define', def: stool('over-stool', 2.2) },
    { op: 'place', def: 'reach-stool@1', name: 'reach', p: [x + 4, z] }, { op: 'place', def: 'over-stool@1', name: 'over', p: [x - 4, z] }]);
  await w.settle(4);
  const cap = (n: string) => w.edge.capabilities(w.soul).find((c: any) => c.id === `sit:${w.god.model.get(n)!.id}`) as any;
  assert.equal(cap('reach')?.available, true, JSON.stringify(cap('reach')));
  assert.equal(cap('over')?.blocked?.code, 'seat.out-of-reach', JSON.stringify(cap('over')));
  assert.match(cap('over').blocked.reason, /2\.20 m high, above the 2\.06 m this body can reach/);
  const no = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${w.god.model.get('over')!.id}`, params: { seconds: 2 } })) as any;
  assert.equal(no.accepted, false); assert.equal(no.code, 'seat.out-of-reach');
  const r = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${w.god.model.get('reach')!.id}`, params: { seconds: 2 } })) as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 300));
  assert.ok(await w.until(() => w.edge.receipt(w.soul.soulId, r.receipt.id)?.phase === 'completed'), 'sat on the 2.05 m stool');
  assert.deepEqual(w.E.rt?.violations ?? [], []);
});

// #1090: a god seat's top reaches the engine body while seated (what the client draws the hips at) and is cleared on rising
test('seat render height: seated on a god seat, the body carries the seat top; standing clears it', { timeout: 180_000 }, async (t) => {
  const w = await setup(t);
  const me = w.host.engine.world.entities[w.soul.entityId] as any, [x, z] = [me.pose.p[0], me.pose.p[2]];
  const seat = (name: string, h: number) => ({ schema: 'def/1', name, version: 1, tags: ['furniture', 'seat'], form: 'point', size: { box: [0.5, h, 0.5] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, h / 2, 0], size: [0.5, h, 0.5] }] } },
    slots: [{ id: 'seat', kind: 'seat', p: [0, h, 0], yaw: 0, height: h, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: h } } });
  w.act([{ op: 'define', def: seat('tall-stool', 1.6) }, { op: 'define', def: seat('floor-seat', 0.1) },
    { op: 'place', def: 'tall-stool@1', name: 'tall', p: [x + 4, z] }, { op: 'place', def: 'floor-seat@1', name: 'floor', p: [x - 4, z] }]);
  await w.settle(4);
  for (const [n, h] of [['tall', 1.6], ['floor', 0.1]] as const) {
    const r = await accept(w.host, w.edge.act(w.soul, { capability: `sit:${w.god.model.get(n)!.id}` })) as any;
    assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 300));
    assert.ok(await w.until(() => w.human().activity === 'sit'), `${n}: seated`);
    assert.equal(w.human().seatHeight, h, `${n}: the body carries the seat top`);
    const up = await accept(w.host, w.edge.act(w.soul, { capability: 'stand:here' })) as any;
    assert.ok(await w.until(() => w.edge.receipt(w.soul.soulId, up.receipt.id)?.phase === 'completed' && w.human().activity !== 'sit' && w.human().activity !== 'stand-up'), `${n}: stood up`);
    assert.equal(w.human().seatHeight, undefined, `${n}: cleared on rising`);
  }
  assert.deepEqual(w.E.rt?.violations ?? [], []);
});
