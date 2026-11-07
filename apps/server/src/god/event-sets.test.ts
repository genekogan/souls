import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Op } from '@souls/world-compiler';
import { GodLayers } from './layers.ts';
import { isSetPiece, pieceNames, describeSet } from './event-sets.ts';

// A world whose clock we drive: dayTicks 1440 → one tick per world minute.
function fixture() {
  let model = new WorldModel({ constants: { extent: 400, ground: 'land' }, seed: 'event-sets' });
  for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
  const engine = { world: { tick: 0, entities: {} as Record<string, unknown> } };
  const notes: string[] = [];
  const engineAct = (ops: Op[], note: string) => { const r = applyBatch(model, { ops }, 'engine', engine.world.tick, { trusted: true }); if (r.result.accepted) notes.push(note); return r.result; };
  let layers!: GodLayers;
  const reload = () => { model = WorldModel.fromSnapshot(model.snapshot()); layers = new GodLayers({ model, engine, living: () => ({ origin: 0, dayTicks: 1440 }), engineAct, log: () => {} }); };
  reload();
  const god = (ops: unknown[]) => { const r = applyBatch(model, { ops }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  // the world clock starts at 06:00 on a Saturday (tick 0): day 0 is that Saturday
  const at = (hhmm: string, day = 0) => { const [h, m] = hhmm.split(':').map(Number); engine.world.tick = day * 1440 + h * 60 + m - 360; assert.equal(layers.clock()!.minute, h * 60 + m); };
  const pieces = () => [...model.entities.values()].filter(isSetPiece);
  return { god, at, pieces, notes, reload, get model() { return model; }, get layers() { return layers; } };
}
const market = { name: 'market', label: 'Saturday market', at: '09:00', minutes: 240, days: ['sat'] as const, set: [
  { def: 'core/market-stall@1', p: [-6, 0] }, { def: 'core/market-stall@1', p: [0, 0] }, { def: 'core/market-stall@1', p: [6, 0] },
  { def: 'core/banner@1', p: [0, -5], state: { text: 'Saturday market' } },
] };

test('event sets: a market sets up its stalls on time, inside its square, and packs them away after', () => {
  const f = fixture();
  f.god([{ op: 'place', def: 'core/zone@1', name: 'square', shape: { area: [[80, 80], [120, 80], [120, 120], [80, 120]] }, params: { use: 'commercial' }, schedule: { events: [market] } }]);
  f.at('08:59'); assert.equal(f.layers.step().set, undefined); assert.equal(f.pieces().length, 0, 'nothing before the market');
  f.at('09:00'); const s = f.layers.step(); assert.equal(s.set, 4); assert.equal(f.pieces().length, 4);
  assert.deepEqual(f.pieces().map((e) => e.name).sort(), ['market-banner-1', 'market-market-stall-1', 'market-market-stall-2', 'market-market-stall-3']);
  const stall = f.model.get('square/market-market-stall-2')!; const wp = f.model.worldPose(stall);
  assert.ok(Math.abs(wp.x - 100) < 1.5 && Math.abs(wp.z - 100) < 1.5, `the middle stall stands at the square's centre (${wp.x}, ${wp.z})`);
  assert.equal(f.model.get('square/market-banner-1')!.state?.text, 'Saturday market');
  assert.match(f.notes.at(-1)!, /Saturday market: set up 4 things at square/);
  assert.match(f.layers.onNow(f.model.get("square")!), /Saturday market is on here now \(3 market stalls and a banner set up, until 13:00\)/);
  f.at('10:30'); assert.equal(f.layers.step().set, undefined, 'standing sets are left alone'); assert.equal(f.pieces().length, 4);
  f.reload(); f.at('11:00'); assert.equal(f.layers.step().set, undefined, 'a restart mid-event keeps the set'); assert.equal(f.pieces().length, 4);
  f.at('13:00'); assert.equal(f.layers.step().packed, 4); assert.equal(f.pieces().length, 0, 'packed away at the end');
  assert.doesNotMatch(f.layers.onNow(f.model.get("square")!), /is on here now/);
  f.at('09:30', 1); f.layers.step(); assert.equal(f.pieces().length, 0, 'a Saturday market does not come on Sunday');
  f.at('09:30', 7); f.layers.step(); assert.equal(f.pieces().length, 4, 'and comes back next Saturday');
});

test('event sets: a dusk concert on a point thing brings its stage with lights on; removing the event packs it away', () => {
  const f = fixture();
  const concert = { name: 'concert', label: 'Dusk concert', at: '19:30', minutes: 120, set: [
    { def: 'core/stage@1', p: [0, 6] }, { def: 'core/floodlight@1', p: [-6, 9], r: Math.PI, state: { on: true } }, { def: 'core/floodlight@1', p: [6, 9], r: Math.PI, state: { on: true } },
    { def: 'core/speaker@1', p: [-4, 4], state: { playing: true } },
  ] };
  f.god([{ op: 'place', def: coreRef('lamp-post'), name: 'green-lamp', p: [-50, 40], schedule: { events: [concert] } }]);
  f.at('20:00'); assert.equal(f.layers.step().set, 4);
  assert.equal(f.model.get('green-lamp/concert-floodlight-2')!.state?.on, true);
  assert.equal(f.model.get('green-lamp/concert-speaker-1')!.state?.playing, true);
  const st = f.layers.publicView().sets!; assert.deepEqual(st.map((x) => [x.event, x.pieces, x.out, x.on]), [['concert', 4, 4, true]]);
  // the god moves the stage while the concert is on: it is set up again where the set now says
  f.god([{ op: 'set', id: 'green-lamp', schedule: { events: [{ ...concert, set: [{ ...concert.set[0], p: [0, -5] }, ...concert.set.slice(1)] }] } }]);
  f.at('20:01'); f.layers.step(); f.layers.step();
  const stage = f.model.get('green-lamp/concert-stage-1')!; assert.deepEqual([stage.p![0], stage.p![stage.p!.length - 1]], [0, -5]);
  assert.equal(f.pieces().length, 4, 'still four pieces, the stage moved');
  f.god([{ op: 'set', id: 'green-lamp', schedule: null }]);
  f.at('20:10'); assert.equal(f.layers.step().packed, 4, 'a removed event leaves nothing behind'); assert.equal(f.pieces().length, 0);
  assert.equal(f.layers.active(), false, 'and no layer work remains');
});

test('event sets: a refused piece does not keep the rest away; an unknown def is reported to the god', () => {
  const f = fixture();
  f.god([{ op: 'place', def: 'core/zone@1', name: 'yard', shape: { area: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }, params: { use: 'park' }, schedule: { events: [{ name: 'fair', at: '10:00', minutes: 60, set: [{ def: 'core/market-stall@1', p: [0, 0] }, { def: 'core/no-such-thing@1', p: [4, 0] }] }] } }]);
  f.at('10:05'); assert.equal(f.layers.step().set, 1);
  const st = f.layers.publicView().sets![0]; assert.equal(st.out, 1); assert.match(st.refused![0], /fair-no-such-thing-1: def\.unknown/);
});

test('event sets: names and descriptions', () => {
  assert.deepEqual(pieceNames('concert', [{ def: 'core/floodlight@1', p: [0, 0] }, { def: 'core/stage@1', p: [0, 0] }, { def: 'core/floodlight@1', p: [0, 0] }]), ['concert-floodlight-1', 'concert-stage-1', 'concert-floodlight-2']);
  assert.equal(describeSet([{ def: 'core/stage@1', p: [0, 0] }, { def: 'core/floodlight@1', p: [0, 0] }, { def: 'core/floodlight@1', p: [0, 0] }, { def: 'core/string-lights@1', p: [0, 0] }]), 'a stage, 2 floodlights and string lights');
});
