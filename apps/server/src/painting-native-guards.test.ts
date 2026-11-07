import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture,invite,accept,factory,seed} from '../test/native-owner-fixture.ts';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';
import {createPaintingService} from './art/painting-completion.ts';

const picture={title:'Original',background:'#123456',shapes:[]};
async function world(t:TestContext,beforeLedger?:(host:WorldHost)=>void){
  const root=mkdtempSync(join(tmpdir(),'painting-native-guards-')),path=join(root,'world.db'),art=join(root,'art');
  const f=fixture(path,factory,{durableClockV1:true});f.brain.quiesce();let host=f.host,db=f.db;
  t.after(()=>{host.stop();if(db.db.isOpen)db.close();rmSync(root,{recursive:true,force:true});});
  let god:GodMode,edge:EdgeLedger,bridge:ReturnType<typeof installEngineBridge>;
  const attach=()=>{
    god=new GodMode(db,{worldId:host.worldId,ownerId:'dev:admin',tick:()=>host.engine.world.tick,emit(){},assetDir:root});
    beforeLedger?.(host);edge=new EdgeLedger(host,db,undefined,{ambient:false});
    bridge=installEngineBridge({host,god,edge,log(){},worldLore:false,worldClock:false});
    edge.painting=createPaintingService({model:()=>god.model,dir:art,basePath:'/w/guard',worldId:host.worldId,commit:(ops,note,done,durable)=>god.engineAct(ops,note,done,durable)});
  };attach();
  const tick=async(n=1)=>{for(let i=0;i<n;i++){host.tickOnce();await setImmediate();host.drainInputs();}};
  await tick(4);assert.equal(god!.act({ops:[{op:'place',def:coreRef('easel',2),name:'canvas',p:[3,0]}]}).accepted,true);await tick(4);
  await invite(f,'ana');const row=await accept(host,f.souls.create('dev:ana',{name:'Ana',description:'painting guards'}));
  const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(4);
  const target=god!.model.get('canvas')!.id,cap=`paint:paint.${target}`;
  const until=async(pred:()=>boolean,max=1800)=>{for(let i=0;i<max&&!pred();i++)await tick();assert.ok(pred(),'bounded native painting progress');};
  const start=async(title:string,seconds=5)=>{const out=await accept(host,edge.act(soul,{capability:cap,params:{seconds,painting:{...picture,title}}}));assert.equal(out.accepted,true,JSON.stringify(out));if(!out.accepted)throw Error('painting refused');return out.receipt.id;};
  const finish=async(id:string)=>{await until(()=>!['waiting','started'].includes(edge.receipt(soul.soulId,id)!.phase));return edge.receipt(soul.soulId,id)!;};
  return {soul,target,cap,art,tick,until,start,finish,get host(){return host;},get db(){return db;},get god(){return god!;},get edge(){return edge!;},get bridge(){return bridge!;},
    restart(){host.stop();host.drainInputs();assert.ok(host.engine.canSnapshot?.()!==false);host.saveSnapshot(true);const worldId=host.worldId;db.close();db=new Db(path);host=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(host.boot().from,'snapshot');host.drainInputs();attach();},
  };
}
test('a real warm paint offer refuses after the easel moves while activity spots still retain their old coordinates',async t=>{
  const w=await world(t),first=await w.start('Original');assert.equal((await w.finish(first)).phase,'completed');
  const canvas={...w.god.model.entities.get(w.target)!.state},oldSpots=w.bridge.activitySpots.data();assert.ok(w.edge.capabilities(w.soul).find(c=>c.id===w.cap)?.available);
  assert.equal(w.god.act({ops:[{op:'move',id:w.target,p:[30,0]}]}).accepted,true);
  assert.equal(w.bridge.activitySpots.data(),oldSpots,'actual catch-up returns the old derived spots');
  const out=await accept(w.host,w.edge.act(w.soul,{capability:w.cap,params:{seconds:5,painting:{...picture,title:'Remote'}}}));
  assert.equal(out.accepted,false,JSON.stringify(out));if(!out.accepted)assert.equal(out.code,'painting.offer-stale');
  assert.deepEqual(w.god.model.entities.get(w.target)!.state,canvas);assert.equal(readdirSync(w.art).length,1);assert.equal(w.edge.openReceipts(w.soul.soulId).length,0);
});
test('a genuine native completion with an adversarially displaced body cannot publish remotely; level and vertical reach are bounded',async t=>{
  // Only this observer injects a displacement, between native completion and
  // ledger observation; no claim that an ordinary native move bypasses cancellation.
  let displace=false,actor='';
  const w=await world(t,host=>host.listeners.push({onProgram:event=>{if(displace&&event.kind==='completed'){const body=host.engine.world.entities[actor];if(body?.human){body.pose.p=[30,0,0];displace=false;}}}}));actor=w.soul.entityId;
  const first=await w.start('Original');assert.equal((await w.finish(first)).phase,'completed');const canvas={...w.god.model.entities.get(w.target)!.state};
  const remote=await w.start('Remote');displace=true;const end=await w.finish(remote);assert.equal(end.phase,'failed');assert.equal(end.code,'painting.not-reached');
  assert.deepEqual(w.god.model.entities.get(w.target)!.state,canvas);assert.equal(readdirSync(w.art).length,1);
  const intent=w.edge.painting!.prepare(w.soul,w.target,picture);assert.ok(!('ok'in intent));
  // Same X/Z is insufficient across floors. Test the pure reach check without
  // injecting an unsupported floor into the native physics world.
  assert.equal(w.edge.painting!.reached(intent,{position:[3,0,1.5],level:0,scale:1}),null,'legal standing approach remains in touch reach');
  assert.equal(w.edge.painting!.reached(intent,{position:[3,0,0.85],level:1,scale:1})!.code,'painting.not-reached');
  assert.equal(w.edge.painting!.reached(intent,{position:[3,4,0.85],level:0,scale:1})!.code,'painting.not-reached');
  const farOffer=w.edge.painting!.prepare(w.soul,w.target,picture,{face:[3,0],stand:[3,1.7],level:0});assert.ok('ok'in farOffer);if('ok'in farOffer)assert.equal(farOffer.code,'painting.not-reached','an over-retreated clearAt approach refuses consistently at admission');
  assert.deepEqual(w.god.model.entities.get(w.target)!.state,canvas);assert.equal(readdirSync(w.art).length,1);
});
test('the exact active native painting receipt and program survive a SQLite/snapshot restart and finish once',async t=>{
  const w=await world(t),first=await w.start('Original');assert.equal((await w.finish(first)).phase,'completed');const before={...w.god.model.entities.get(w.target)!.state};
  const id=await w.start('After restart',30);await w.until(()=>w.host.engine.world.entities[w.soul.entityId].human?.activity==='paint');
  const pending=w.edge.receipt(w.soul.soulId,id)!;assert.equal(pending.phase,'started');assert.ok(pending.programId);const program=pending.programId,head=w.host.engine.stateHash();
  w.restart();assert.equal(w.host.engine.stateHash(),head);assert.equal(w.host.engine.programOf(w.soul.entityId),program);assert.equal(w.edge.receipt(w.soul.soulId,id)!.phase,'started');assert.deepEqual(w.god.model.entities.get(w.target)!.state,before);
  const done=await w.finish(id);assert.equal(done.phase,'completed',JSON.stringify(done));assert.equal(done.programId,program);assert.equal(w.god.model.entities.get(w.target)!.state!.title,'After restart');
  assert.equal(w.god.store.edits(30).filter(e=>e.note?.startsWith('painting/1 ')&&e.note.includes(id)).length,1);assert.equal(readdirSync(w.art).length,2);
});
