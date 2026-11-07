// Actual native paint -> public built object -> observer HTTP here. No listener, browser or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {coreRef} from '@souls/world-compiler';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import type {EdgeSoul} from './edge/contract.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes} from './edge/routes.ts';
import {hereFrame, Perception} from './edge/perception/here.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';
import {createPaintingService} from './art/painting-completion.ts';

test('ordinary observer here carries current completed painting credit, with existing visibility and object bounds', {timeout:60000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'painting-here-native-'));
  const f = fixture(':memory:', factory, {durableClockV1:true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient:false});
  const app = new Hono(), souls = new Map<string, EdgeSoul>();
  const comms = mountEdgeRoutes(app, {host:f.host, db:f.db, souls:f.souls, ledger:edge,
    soul:c => souls.get(c.req.header('authorization')!)!});
  t.after(() => {comms.close(); f.host.stop(); f.db.close(); rmSync(dir, {recursive:true, force:true});});
  const god = new GodMode(f.db, {worldId:f.host.worldId, ownerId:'dev:admin',
    tick:() => f.host.engine.world.tick, emit() {}, assetDir:dir});
  installEngineBridge({host:f.host, god, edge, log() {}, worldLore:false, worldClock:false});
  edge.painting = createPaintingService({model:() => god.model, dir, basePath:'/w/here-test', worldId:f.host.worldId,
    commit:(ops, note, done, durable) => god.engineAct(ops, note, done, durable)});
  const tick = async (n = 4) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await tick();
  assert.equal(god.act({ops:[
    {op:'place', def:coreRef('easel', 2), name:'canvas', p:[3, 0]},
    {op:'place', def:coreRef('sign'), name:'ordinary-sign', p:[7, 0]},
  ]}).accepted, true);
  await tick(45);
  for (const name of ['Ana', 'Ben']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create(`dev:${name.toLowerCase()}`, {name, description:'painting here test'}));
    souls.set(name, {soulId:row.id, entityId:row.entity_id, name:row.name, owner:row.owner});
  }
  const ana = souls.get('Ana')!, ben = souls.get('Ben')!, target = god.model.get('canvas')!.id;
  const put = async (s:EdgeSoul, to:[number, number]) => {
    await accept(f.host, f.host.enqueue('edge-relocate', 'test:painting-here', {soulId:s.soulId, entityId:s.entityId, to}));
    edge.invalidateBodies();
  };
  await put(ben, [0, 2]); await tick(45);
  const here = async (s = ben) => {
    const response = await app.request('/v1/edge/here?include=doHere', {headers:{authorization:s.name}});
    assert.equal(response.status, 200);
    return (await response.json() as {here:ReturnType<typeof hereFrame>}).here;
  };
  const blank = await here(), blankCanvas = blank.objects.find(o => o.id === target)!;
  assert.ok(blankCanvas, 'second Soul sees the actual blank easel');
  assert.equal('what' in blankCanvas, false, 'unpainted compact objects retain their existing shape');
  assert.ok(blank.objects.filter(o => o.id !== target).every(o => !('what' in o)), 'generic descriptions are unchanged');
  const picture = {title:'Quiet sky', background:'#1a2b60', shapes:[{kind:'ellipse', cx:0.5, cy:0.4, rx:0.2, ry:0.2, colour:'#ffcc44'}]};
  const paint = async (s:EdgeSoul, title:string) => {
    const previousWhat = (await here()).objects.find(o => o.id === target)?.what;
    const previousCanvas = {...god.model.entities.get(target)!.state};
    const started = await accept(f.host, edge.act(s, {capability:`paint:paint.${target}`, params:{seconds:5, painting:{...picture, title}}}));
    assert.equal(started.accepted, true, JSON.stringify(started)); if (!started.accepted) assert.fail('paint refused');
    assert.equal((await here()).objects.find(o => o.id === target)?.what, previousWhat,
      'unfinished activity keeps the previously published perception');
    assert.deepEqual(god.model.entities.get(target)!.state, previousCanvas, 'unfinished activity leaves the actual canvas unchanged');
    for (let i = 0; i < 1800; i++) {
      const receipt = edge.receipt(s.soulId, started.receipt.id)!;
      if (!['waiting', 'started'].includes(receipt.phase)) {assert.equal(receipt.phase, 'completed', JSON.stringify(receipt)); await tick(45); return;}
      await tick(1);
    }
    assert.fail('painting did not complete within bounded native ticks');
  };
  const credit = async (s:EdgeSoul, expected:string) => {
    const frame = await here(s), canvas = frame.objects.find(o => o.id === target)!;
    assert.ok(canvas, 'ordinary observer HTTP here includes the nearby easel');
    assert.equal(canvas.name, blankCanvas.name, 'painting preserves target name and identity');
    assert.equal(canvas.what, (comms.objects.all().find(o => o.id === target)!.state as {what:string}).what,
      'here carries the current advanced durable public what');
    assert.ok(canvas.what?.startsWith(expected), JSON.stringify(canvas));
    assert.ok(canvas.what.length <= 230); assert.doesNotMatch(canvas.what, /[\u0000-\u001f\u007f\u0085\u2028\u2029]/);
    assert.doesNotMatch(JSON.stringify(frame), /#1a2b60|#ffcc44|"recipe"|"cx"|"cy"|"rx"|"ry"/,
      'the actual recipe and colours never enter observer perception');
    assert.ok(frame.objects.length <= 6);
    return frame;
  };
  await paint(ana, picture.title);
  await credit(ben, 'an easel with Ana’s painting “Quiet sky”');
  // Another painter overwrites the same easel; Ana is now the independent observer.
  await put(ana, [0, 2]);
  const longTitle = 'Morning light '.repeat(8).trim();
  await paint(ben, longTitle);
  const overwritten = await credit(ana, `an easel with Ben’s painting “${longTitle.slice(0, 50)}”`);
  assert.ok(!JSON.stringify(overwritten.objects).includes('Quiet sky'), 'old title/credit is replaced');
  assert.equal(god.act({ops:[
    {op:'place', def:coreRef('easel', 2), name:'closer-canvas-one', p:[1, 2]},
    {op:'place', def:coreRef('easel', 2), name:'closer-canvas-two', p:[1, 1]},
    ...[4, 5, 6].map(z => ({op:'place' as const, def:coreRef('sign'), name:`near-sign-${z}`, p:[2, z] as [number, number]})),
  ]}).accepted, true);
  await tick(45);
  const crowded = await here(ana);
  assert.equal(crowded.objects.length, 6, 'painting does not expand the six-object budget');
  // (Soul Actions: built object kinds carry the def revision past v1, e.g. `easel-v2`, so a frozen v1 never gets v2 actions)
  const easelKind = (k?: string) => k === 'easel' || /^easel-v\d+$/.test(k ?? '');
  assert.equal(crowded.objects.filter(o => easelKind(o.kind)).length, 2, 'same-kind budget remains two');
  assert.ok(!crowded.objects.some(o => o.id === target), 'a painted easel gets no priority over nearer easels');
  assert.ok(Object.entries(crowded.more ?? {}).some(([k, n]) => easelKind(k) && n >= 1), 'omitted painted easel remains counted');
  assert.equal(god.act({ops:['closer-canvas-one', 'closer-canvas-two', 'near-sign-4', 'near-sign-5', 'near-sign-6']
    .map(name => ({op:'remove' as const, id:god.model.get(name)!.id}))}).accepted, true);
  await tick(45);
  const uncrowded = await credit(ana, `an easel with Ben’s painting “${longTitle.slice(0, 50)}”`);
  const visibleIds = uncrowded.objects.map(o => o.id);
  const publicRoot = edge.placePathOf(ana.soulId).find(p => edge.places.byId.get(p.id)?.parent === null)!.id;
  edge.places.add({id:'painting-test-room', name:'Test room', kind:'room', parent:publicRoot,
    polygon:[[2.5, -0.5], [3.5, -0.5], [3.5, 0.5], [2.5, 0.5]], level:0, enclosed:true, capacity:null, starting:false});
  assert.notEqual(edge.enclosureOf(ana.soulId), edge.enclosureAtPoint(3, 0));
  assert.ok(!(await here(ana)).objects.some(o => o.id === target), 'painting inside another enclosure stays invisible');
  edge.places.byId.delete('painting-test-room');
  assert.deepEqual((await here(ana)).objects.map(o => o.id), visibleIds, 'visibility returns with unchanged selection');
  await put(ana, [-20, 2]);
  assert.ok(!(await here(ana)).objects.some(o => o.id === target), 'painting outside the 15m object radius stays invisible');
  await put(ana, [-3, 0]);
  // here uses the native nav/1 solids, independently of the built-object projection.
  await accept(f.host, f.host.installNavV1({version:'nav/1', ground:[{id:'test-ground', boundsXZ:[-20, -20, 20, 20]}],
    solids:[{id:'sight-wall', c:[0, 0], half:[0.2, 3], yaw:0, height:3}]}));
  assert.equal(new Perception(edge, ana).sees([3, 0]), false, 'native nav/1 wall blocks the actual sightline');
  assert.ok(!(await here(ana)).objects.some(o => o.id === target), 'blocked painting stays invisible');
});
