// Real native-engine activity/receipt path, fake brain, no HTTP listener or renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { createPaintingService } from './art/painting-completion.ts';

const picture = {title:'Quiet sky',background:'#1a2b60',shapes:[{kind:'ellipse',cx:0.5,cy:0.4,rx:0.2,ry:0.2,colour:'#ffcc44'}]};
test('real paint offer/completion publishes once, credits the Soul, keeps legacy offers and cancels without publishing', {timeout:60000}, async t => {
  const dir=mkdtempSync(join(tmpdir(),'painting-ledger-')), f=fixture(':memory:',factory,{durableClockV1:true}); f.brain.quiesce();
  t.after(()=>{f.host.stop();f.db.close();rmSync(dir,{recursive:true,force:true});});
  const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit:()=>{},assetDir:dir});
  const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}); installEngineBridge({host:f.host,god,edge,log:()=>{},worldLore:false,worldClock:false});
  edge.painting=createPaintingService({model:()=>god.model,dir,basePath:'/w/fixture',worldId:f.host.worldId,commit:(ops,note,done,durable)=>god.engineAct(ops,note,done,durable)});
  const tick=async(n=4)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
  await tick();
  const placed=god.act({ops:[{op:'place',def:coreRef('easel',2),name:'new-easel',p:[3,0]},{op:'place',def:coreRef('easel',1),name:'legacy-easel',p:[7,0]},{op:'place',def:coreRef('workbench'),name:'bench',p:[12,0]}]});assert.equal(placed.accepted,true,JSON.stringify(placed));await tick();
  await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'local painting test'}));
  const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
  const target=god.model.get('new-easel')!.id,old=god.model.get('legacy-easel')!.id;
  const caps=edge.capabilities(soul),cap=caps.find(c=>c.id===`paint:paint.${target}`)!;assert.ok(cap?.available,JSON.stringify(caps.filter(c=>c.verb==='paint')));
  assert.ok(cap.params?.painting);assert.equal((cap.params!.seconds as {default:number}).default,180);
  assert.equal(caps.find(c=>c.id===`paint:paint.${old}`)!.params!.painting,undefined);
  assert.ok(caps.filter(c=>c.verb!=='paint').every(c=>!c.params?.painting),'unrelated offers have no drawing help');
  const bad=await accept(f.host,edge.act(soul,{capability:cap.id,params:{painting:{...picture,maker:'creator:spoof'}}}));assert.equal(bad.accepted,false);
  assert.equal(god.model.entities.get(target)!.state!.media,'');assert.deepEqual(readdirSync(dir).filter(x=>x.endsWith('.png')),[]);
  const wait=async(id:string)=>{for(let i=0;i<1800;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}const r=edge.receipt(soul.soulId,id)!;if(!['waiting','started'].includes(r.phase))return r;}assert.fail('painting did not finish within bounded native ticks');};
  const a=await accept(f.host,edge.act(soul,{capability:cap.id,params:{seconds:5,painting:picture},clientRef:'one'}));assert.equal(a.accepted,true,JSON.stringify(a));if(!a.accepted)return;
  assert.equal(god.model.entities.get(target)!.state!.media,'','walking/painting keeps old canvas');
  const done=await wait(a.receipt.id);assert.equal(done.phase,'completed',JSON.stringify(done));
  const canvas={...god.model.entities.get(target)!.state};assert.equal(canvas.title,picture.title);assert.equal(canvas.maker,`soul:${encodeURIComponent(soul.soulId)}:Ana`);assert.match(canvas.media as string,/\/art\/[a-f0-9]{64}\.png$/);
  assert.equal(done.outcome!.produced[0].kind,'painting');assert.equal(done.outcome!.produced[0].visibility,'public');assert.equal((done.outcome!.detail.painting as {media:string}).media,canvas.media);
  assert.equal((f.db.db.prepare('SELECT count(*) n FROM edge_written_objects_v1 WHERE receipt_id=?').get(done.id) as {n:number}).n,0,'real painting creates no private pretend artifact');
  const retry=await edge.act(soul,{capability:cap.id,params:{painting:picture},clientRef:'one'});assert.equal(retry.accepted,true);assert.equal(god.store.edits(30).filter(e=>e.note?.startsWith('painting/1 ')).length,1);
  const b=await accept(f.host,edge.act(soul,{capability:cap.id,params:{seconds:180,painting:{...picture,title:'Abandoned'}}}));assert.equal(b.accepted,true,JSON.stringify(b));if(!b.accepted)return;
  await tick(20);assert.deepEqual(god.model.entities.get(target)!.state,canvas);
  const stop=await accept(f.host,edge.act(soul,{capability:'stand:here'}));assert.equal(stop.accepted,true);await tick(20);
  assert.ok(['failed','replaced'].includes(edge.receipt(soul.soulId,b.receipt.id)!.phase));assert.deepEqual(god.model.entities.get(target)!.state,canvas);assert.equal(readdirSync(dir).filter(x=>x.endsWith('.png')).length,1);
  const legacy=await accept(f.host,edge.act(soul,{capability:`paint:paint.${old}`,params:{seconds:5}}));assert.equal(legacy.accepted,true,JSON.stringify(legacy));if(!legacy.accepted)return;
  const legacyDone=await wait(legacy.receipt.id);assert.equal(legacyDone.phase,'completed',JSON.stringify(legacyDone));assert.equal(legacyDone.outcome!.produced[0].kind,'paint-record');assert.equal(god.model.entities.get(old)!.state?.media,undefined);
  const sleeping=await accept(f.host,edge.act(soul,{capability:cap.id,params:{seconds:180,painting:{...picture,title:'Sleep interrupted'}}}));assert.equal(sleeping.accepted,true,JSON.stringify(sleeping));if(!sleeping.accepted)return;
  await tick(200);
  // This is the same native nap program the presence body rule dispatches for
  // body:asleep. It replaces the in-progress paint through the real engine.
  let sleepResult: {programOk?:boolean} | undefined;
  f.host.listeners.push({onDecision:(event,result)=>{if((event.payload as {trigger?:string}).trigger==='body:asleep')sleepResult=result;}});
  const activeBeforeSleep=edge.receipt(soul.soulId,sleeping.receipt.id)!;assert.equal(activeBeforeSleep.phase,'started');
  let sleepCancelledPaint=false;f.host.listeners.push({onProgram:event=>{if(event.id===activeBeforeSleep.programId&&event.kind==='cancelled')sleepCancelledPaint=true;}});
  assert.equal((f.host.engine.world.entities[soul.entityId] as {human?:{activity?:string}}).human!.activity,'paint','sleep replaces the actual paint pose');
  // Walk clear of the easel before lying down: its footprint truthfully refuses
  // a nap beside the canvas. This single replacement program cancels painting.
  await accept(f.host,f.host.enqueue('decision','body:'+soul.soulId,{soulId:soul.soulId,entityId:soul.entityId,option:'body:asleep',label:'Sleeping on open grass',steps:[{verb:'walk_to',params:{to:[20,10]}},{verb:'mars:pose_v1',params:{activity:'nap',seconds:3600}}],reevalTicks:1e9,fallback:false,trigger:'body:asleep'}));
  assert.equal(sleepResult?.programOk,true,JSON.stringify(sleepResult));
  await tick(2);
  assert.equal(sleepCancelledPaint,true,'native sleep replacement emits cancellation for the actual paint program');
  assert.equal(edge.receipt(soul.soulId,sleeping.receipt.id)!.phase,'failed','sleep replacement terminates the paint receipt');
  for(let i=0;i<1000&&(f.host.engine.world.entities[soul.entityId] as {human?:{activity?:string}}).human!.activity!=='nap';i++)await tick(1);
  assert.equal((f.host.engine.world.entities[soul.entityId] as {human?:{activity?:string}}).human!.activity,'nap');
  assert.equal(edge.receipt(soul.soulId,sleeping.receipt.id)!.phase,'failed');assert.deepEqual(god.model.entities.get(target)!.state,canvas);assert.equal(readdirSync(dir).filter(x=>x.endsWith('.png')).length,1);
});
