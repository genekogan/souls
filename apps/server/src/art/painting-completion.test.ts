import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode } from '../god/god.ts';
import { afterCommit, tx } from '../edge/comms/store.ts';
import { paintingLine, planHang } from './art.ts';
import { createPaintingService, type PaintingIntent } from './painting-completion.ts';
import { rasterizePainting } from './painting.ts';

const ana = {soulId: 's_ana', entityId: 'h_aaaa', name: 'Ana', owner: 'dev:ana'}, ben = {soulId: 's_ben', entityId: 'h_bbbb', name: 'Ben', owner: 'dev:ben'};
const recipe = (title = 'Dusk', background = '#123456') => ({title, background, shapes: []});
function setup(t: {after(fn: () => void): void}) {
  const root = mkdtempSync(join(tmpdir(), 'painting-')), dir=join(root,'art'), path=join(root,'world.db'), order: string[] = []; mkdirSync(dir);
  let db = new Db(path);
  let god = new GodMode(db, {worldId: 'paint-test', ownerId: 'dev:owner', tick: () => 1, emit: () => { order.push('world'); }, assetDir: dir});
  assert.equal(god.act({ops: [{op: 'place', def: coreRef('easel', 2), name: 'canvas', p: [0, 0]}, {op: 'place', def: coreRef('picture-frame'), name: 'frame', p: [5, 0]}]}).accepted, true);
  const target = god.model.get('canvas')!.id;
  const service = createPaintingService({model: () => god.model, dir, basePath: '/w/paint-test', worldId:'paint-test', commit: (ops, note, done, durable) => god.engineAct(ops, note, done, durable)});
  const prepare = (soul = ana, p = recipe(), id = target) => { const result = service.prepare(soul, id, p); assert.ok(!('ok' in result), JSON.stringify(result)); return result as PaintingIntent; };
  t.after(() => { if (db.db.isOpen) db.close(); rmSync(root, {recursive: true, force: true}); });
  return {get db(){return db;}, dir, order, target, service, prepare, get god() {return god;}, restart() {db.close();db=new Db(path);god = new GodMode(db, {worldId: 'paint-test', ownerId: 'dev:owner', tick: () => 1, emit: () => {}, assetDir: dir});} };
}
test('finished paint uses Soul credit, preserves the old image until commit, journals recoverable pictures, and reloads', t => {
  const w = setup(t), intent = w.prepare(); assert.equal(w.god.model.entities.get(w.target)!.state?.media, '');
  let published: unknown; assert.equal(w.service.complete(ana, 'r_one', intent, p => {published = p;}).ok, true);
  const first = {...w.god.model.entities.get(w.target)!.state}; assert.equal(first.title, 'Dusk'); assert.equal(first.maker, 'soul:s_ana:Ana'); assert.match(first.media as string, /^\/w\/paint-test\/art\/[a-f0-9]{64}\.png$/); assert.ok(published);
  const line=paintingLine(w.god.model.entities.get(w.target)!,w.god.model.resolvedDef(w.god.model.entities.get(w.target)!.def));assert.equal(line,'an easel with Ana’s painting “Dusk”');assert.ok(!/[\r\n\u2028\u2029]/.test(line!));assert.ok(line!.length<120);
  assert.equal(paintingLine(w.god.model.get('frame')!,w.god.model.resolvedDef(w.god.model.get('frame')!.def)),null);
  assert.equal(planHang(w.god.model, {kind:'soul',id:ben.soulId,name:ben.name}, {frame:w.target,media:'/other.png'}).ok, false, 'general hang permission remains strict');
  const next = w.prepare(ben, recipe('Dawn', '#aabbcc')); assert.deepEqual(w.god.model.entities.get(w.target)!.state, first, 'in-progress paint leaves old image');
  assert.equal(w.service.complete(ben, 'r_two', next, () => {}).ok, true);
  assert.equal(w.god.model.entities.get(w.target)!.state!.maker, 'soul:s_ben:Ben');
  const log = w.god.store.edits(20).filter(e => e.note?.startsWith('painting/1 ')).map(e => JSON.parse(e.note!.slice(11)));
  assert.equal(log.length, 2); const old = log.find(e => e.receipt === 'r_one'), latest = log.find(e => e.receipt === 'r_two');
  assert.equal(latest.previous.media, first.media); assert.equal(old.renderer, 'painting-rgb/1');
  const file = (first.media as string).split('/').at(-1)!;
  assert.equal(createHash('sha256').update(readFileSync(join(w.dir,file))).digest('hex')+'.png',file,'reference hashes complete PNG including server identity');
  assert.deepEqual(rasterizePainting(old.recipe,old.publication), readFileSync(join(w.dir, file)), 'history recipe recovers actual old appearance');
  assert.equal(readdirSync(w.dir).filter(x=>x.endsWith('.png')).length, 2, 'immutable media retention grows per distinct painting');
  w.restart(); assert.equal(w.god.model.entities.get(w.target)!.state!.title, 'Dawn'); assert.ok(readFileSync(join(w.dir, file)).length);
});
test('completion binds the current target: first painter wins, duplicate completion and edits publish nothing', t => {
  const w = setup(t), one = w.prepare(), two = w.prepare(ben, recipe('Other', '#ffffff'));
  assert.equal(w.service.complete(ana,'r_one',one,()=>{}).ok,true);
  const current = {...w.god.model.entities.get(w.target)!.state};
  assert.equal(w.service.complete(ben,'r_two',two,()=>assert.fail()).ok,false);
  assert.equal(w.service.complete(ana,'r_one',one,()=>assert.fail()).ok,false);
  assert.deepEqual(w.god.model.entities.get(w.target)!.state,current); assert.equal(readdirSync(w.dir).length,1);
  const changed = w.prepare(); assert.equal(w.god.act({ops:[{op:'move',id:w.target,p:[1,0]}]}).accepted,true);
  assert.equal(w.service.complete(ana,'r_move',changed,()=>assert.fail()).ok,false);
  const deleted = w.prepare(); assert.equal(w.god.act({ops:[{op:'remove',id:w.target}]}).accepted,true);
  assert.equal(w.service.complete(ana,'r_delete',deleted,()=>assert.fail()).ok,false); assert.equal(readdirSync(w.dir).length,1);
  assert.ok('ok' in w.service.prepare(ana,w.god.model.get('frame')!.id,recipe()), 'ordinary picture frames do not opt in');
});
test('refused or throwing completion rolls back journal, entity and participant state with no orphan output', t => {
  const w = setup(t), before = w.god.model.editSeq, intent = w.prepare();
  w.db.db.exec('CREATE TABLE painting_test_receipt(id TEXT PRIMARY KEY)');
  w.order.length = 0;
  assert.throws(() => w.service.complete(ana,'r_fail',intent,()=>{w.db.db.prepare('INSERT INTO painting_test_receipt VALUES (?)').run('r_fail');afterCommit(w.db.db,()=>w.order.push('receipt'));throw Error('participant failed');}),/participant failed/);
  assert.equal(w.god.model.editSeq,before); assert.equal(w.god.store.edits(20).filter(e=>e.note?.startsWith('painting/1 ')).length,0);
  assert.equal(w.db.db.prepare('SELECT count(*) n FROM painting_test_receipt').get()!.n,0); assert.deepEqual(w.order,[]); assert.deepEqual(readdirSync(w.dir),[]);
  const refuse = createPaintingService({model:()=>w.god.model,dir:w.dir,basePath:'/w/paint-test',worldId:'paint-test',commit:()=>({accepted:false})});
  assert.equal(refuse.complete(ana,'r_refuse',intent,()=>assert.fail()).ok,false); assert.deepEqual(readdirSync(w.dir),[]);
});
test('world commit publishes its installed model before participant receipt observers; refusal never invokes participant', t => {
  const w = setup(t); let called = 0; const intent = w.prepare(); w.order.length = 0;
  assert.equal(w.service.complete(ana,'r_ok',intent,p=>tx(w.db.db,()=>{
    afterCommit(w.db.db,()=>{assert.equal(w.god.model.entities.get(w.target)!.state!.media,p.media);assert.equal(w.db.db.isTransaction,false);w.order.push('receipt');called++;});
  })).ok,true);
  assert.deepEqual(w.order,['world','receipt']); assert.equal(called,1);
  assert.equal(w.god.engineAct([{op:'set',id:'e_missing',state:{media:'/bad.png'}}] as never,'refused',()=>assert.fail()).accepted,false);
});
test('a committed painting retained in history survives post-commit observer failure and a subsequent canvas change', t => {
  const w=setup(t),intent=w.prepare();let media='';
  const service=createPaintingService({model:()=>w.god.model,dir:w.dir,basePath:'/w/paint-test',worldId:'paint-test',commit:(ops,note,done,durable)=>{
    const result=w.god.engineAct(ops,note,done,durable);
    // Simulate downstream publication work changing this display, then failing.
    assert.equal(w.god.engineAct([{op:'set',id:w.target,state:{media:'',title:'',maker:''}}],'later canvas edit').accepted,true);
    assert.equal(result.accepted,true);throw Error('post-commit observer failed');
  }});
  assert.throws(()=>service.complete(ana,'r_history',intent,p=>{media=p.media;}),/post-commit observer failed/);
  assert.equal(w.god.model.entities.get(w.target)!.state!.media,'');
  assert.deepEqual(readFileSync(join(w.dir,media.split('/').at(-1)!)),rasterizePainting(intent.recipe,{worldId:'paint-test',receiptId:'r_history'}));
  assert.ok(w.god.store.edits(20).some(e=>e.note?.includes('r_history')));
});
