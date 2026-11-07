import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Op } from '@souls/world-compiler';
import { GodLayers, deferredOp } from './layers.ts';

// The economy and relationships are opt-in (LAYERS=1); these tests exercise the opted-in world, the last one the default.
process.env.LAYERS = '1';

function world() {
  const m = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'layers-srv' });
  for (const d of CORE_KIT) m.defineDef(d, 'core', 0);
  const minds = new Map([['s_ana', { soulId: 's_ana', entityId: 'h_ana', name: 'Ana' }], ['s_ben', { soulId: 's_ben', entityId: 'h_ben', name: 'Ben' }]]);
  const engine = { world: { tick: 0, entities: {} as Record<string, unknown> } };
  const edits: string[] = [];
  const L = new GodLayers({ model: m, edge: { host: { minds }, perceivedBodies: () => [] } as never, engine, living: () => ({ origin: 0, dayTicks: 72000 }),
    engineAct: (ops: Op[], note: string) => { edits.push(note); return applyBatch(m, { ops }, 'engine', engine.world.tick, { trusted: true }).result; }, log: () => {} });
  const god = (ops: unknown[]) => { const r = applyBatch(m, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  return { m, L, engine, edits, god };
}
const ana = { soulId: 's_ana', name: 'Ana', entityId: 'h_ana', owner: 'u1' }, ben = { soulId: 's_ben', name: 'Ben', entityId: 'h_ben', owner: 'u2' };

test('ownership: inherited by what stands inside, owner by id or name, group members, works-at; words per viewer', () => {
  const { m, L, god } = world();
  assert.equal(L.active(), false, 'no layers yet');
  god([{ op: 'place', def: coreRef('cottage'), name: 'house', p: [0, 0], owner: 'soul:Ana', access: 'private' }, { op: 'place', def: coreRef('door'), name: 'gate', p: [20, 0], owner: 'group:bakers', access: 'private' }]);
  god([{ op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: 'house' }, p: [0, 0] }]);
  assert.equal(L.active(), true);
  const chair = m.get('house/chair')!.id, gate = m.get('gate')!.id;
  assert.equal(L.refusal(chair, ana), null, 'her own chair (named owner)');
  assert.match(L.refusal(chair, ben)!.reason, /Ana's and private/);
  assert.equal(L.ownerWord(chair, ana), 'yours'); assert.equal(L.ownerWord(chair, ben), "Ana's, private");
  assert.equal(L.refusal(gate, ben)?.code, 'object.private');
  god([{ op: 'relate', a: 'soul:s_ben', rel: 'member-of', b: 'group:bakers' }]);
  assert.equal(L.refusal(gate, ben), null, 'a member of the owning group');
  god([{ op: 'relate', a: 'soul:s_ben', rel: 'works-at', b: 'thing:house' }]);
  assert.equal(L.refusal(chair, ben), null, 'works there');
  assert.match(L.peopleAt(m.get('house')!.id), /Ben works here/);
});

test('economy: buy a thing (owner moves, price cleared), a service (stays), overspend refused, pay, sell; name-keyed wallet merges', () => {
  const { m, L, god, edits } = world();
  god([{ op: 'place', def: coreRef('loaf'), name: 'loaf', p: [1, 1], owner: 'soul:s_ana', price: { amount: 3 } }, { op: 'place', def: coreRef('bench'), name: 'stall', p: [5, 5], owner: 'soul:s_ana', price: { amount: 2, service: 'a coffee' } },
    { op: 'economy', currency: 'shells' }, { op: 'mint', to: 'soul:ben', amount: 6 }]);
  const loaf = m.get('loaf')!.id, stall = m.get('stall')!.id;
  const b = L.act(ben, `buy:${loaf}`, {}, [0, 0]);
  assert.equal(b.accepted, true, JSON.stringify(b));
  assert.equal(m.get('loaf')!.owner, 'soul:s_ben'); assert.equal(m.get('loaf')!.price, undefined);
  assert.deepEqual(m.state.layers!.wallets, { 'soul:s_ben': 3, 'soul:s_ana': 3 }, 'the name-keyed grant merged into Ben\'s id wallet');
  assert.equal(L.act(ben, `buy:${stall}`, {}, [0, 0]).accepted, true);
  assert.equal(m.get('stall')!.owner, 'soul:s_ana', 'a service stays');
  const no = L.act(ben, `buy:${stall}`, {}, [0, 0]); assert.equal(no.accepted, false); assert.equal((no as { code: string }).code, 'wallet.insufficient');
  assert.equal((L.act(ben, `buy:${stall}`, {}, [100, 100]) as { code: string }).code, 'object.out-of-reach');
  assert.equal(L.act(ana, 'pay:Ben', { amount: 1 }).accepted, true);
  assert.equal(L.walletOf(ben).amount, 2);
  assert.equal(L.act(ben, `sell:${loaf}`, { price: 4 }).accepted, true); assert.equal(m.get('loaf')!.price!.amount, 4);
  assert.equal((L.act(ana, `sell:${loaf}`, { price: 1 }) as { code: string }).code, 'object.not-yours');
  assert.ok(edits.some((e) => /Ben bought loaf from Ana for 3 shells/.test(e)));
});

test('the clock: follow states change at the boundary as one engine edit, once; nothing scheduled = nothing done', () => {
  const { m, L, engine, god, edits } = world();
  assert.deepEqual(L.step(), { changed: 0, posted: 0 });
  god([{ op: 'place', def: coreRef('door'), name: 'door', p: [0, 0], schedule: { open: [{ from: '07:00', to: '15:00' }], follow: [{ field: 'locked', when: 'open', is: false, else: true }] } }]);
  engine.world.tick = 0;                       // 06:00 (the clock's origin)
  assert.equal(L.step().changed, 1); assert.equal(m.get('door')!.state?.locked, true);
  assert.equal(L.step().changed, 0, 'already so');
  engine.world.tick = 72000 / 24 * 1.5;        // 07:30
  assert.equal(L.step().changed, 1); assert.equal(m.get('door')!.state?.locked, false);
  assert.ok(edits.every((e) => /^schedule: door locked=/.test(e)));
  assert.match(L.hoursOf(m.get('door')!.schedule), /open 07:00–15:00 \(open now\)/);
});

test('DEFER: without LAYERS=1 the god cannot set prices, money or relationships, and Souls see no economy; ownership and schedules work', () => {
  const was = process.env.LAYERS; delete process.env.LAYERS;
  try {
    const { m, L, god } = world();
    for (const op of [{ op: 'economy', currency: 'shells' }, { op: 'mint', to: 'soul:ben', amount: 6 }, { op: 'relate', a: 'soul:s_ben', rel: 'works-at', b: 'thing:x' }, { op: 'place', def: coreRef('chair'), name: 'c', p: [0, 0], price: { amount: 2 } }])
      assert.equal(deferredOp({ ops: [op] })?.code, 'layers.deferred', JSON.stringify(op));
    assert.equal(deferredOp({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'h', p: [0, 0], owner: 'soul:Ana', access: 'private' }] }), null, 'ownership stays');
    // a world that had prices before (an old journal) shows none of them now
    god([{ op: 'place', def: coreRef('chair'), name: 'stall-chair', p: [3, 0], price: { amount: 2 } }, { op: 'place', def: coreRef('cottage'), name: 'house', p: [20, 0], owner: 'soul:Ana', access: 'private' }]);
    const chair = m.get('stall-chair')!.id;
    assert.doesNotMatch(L.tag(m.entities.get(chair)!), /sale/);
    const caps: never[] = []; L.capabilities(ben as never, caps, new Map(), [3, 0]);
    assert.equal(caps.length, 0, 'no buy/pay capabilities');
    assert.equal(L.act(ben as never, `buy:${chair}`, {}).accepted, false);
    assert.deepEqual(Object.keys(L.me(ana)), ['owns']);
    const v = L.publicView() as Record<string, unknown>;
    assert.equal(v.currency, undefined); assert.equal(v.relations, undefined);
    assert.match(L.refusal(m.get('house')!.id, ben)!.reason, /Ana's and private/, 'ownership still refuses');
  } finally { if (was !== undefined) process.env.LAYERS = was; }
});
