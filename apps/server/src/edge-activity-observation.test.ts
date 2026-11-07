import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture,factory,invite,accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';
import {activityObserver} from './edge/events/activity-observation.ts';
import {toEnvelope} from './edge/events/envelope.ts';
import {buildDigest} from './edge/events/digest.ts';
import type {StreamEvent} from './edge/comms/stream.ts';

async function setup(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const ledger=new EdgeLedger(f.host,f.db,undefined,{spots:{contract:'activity-spots/1',spots:[{id:'reader',activity:'read',base:'idle',at:[-8,0],prop:'book'},{id:'music',activity:'play-music',base:'idle',at:[8,-8],instrument:'guitar'}]}});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit:()=>{}});installEngineBridge({host:f.host,god,edge:ledger,log:()=>{}});
 const tick=async(n=1)=>{for(let i=0;i<n;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}};await tick(3);
 await invite(f,'activity-observer');const row=await accept(f.host,f.souls.create('dev:activity-observer',{name:'Observer',description:'isolated native observation test'}));
 const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(3);
 assert.equal(god.act({ops:[{op:'place',def:coreRef('chair'),name:'observer-seat',p:[5,5]}]}).accepted,true);await tick(3);const seat=god.model.get('observer-seat')!.id;
 const events:{to:string;event:StreamEvent}[]=[],observer=activityObserver({host:f.host,db:f.db,now:()=>123456,deliver:(to,tick,body)=>events.push({to,event:{id:'c_'+(events.length+1),kind:'activity.observed',tick,at:123456,...body}})});
 f.host.listeners.push(observer.listener);
 t.after(()=>{observer.close();const i=f.host.listeners.indexOf(observer.listener);if(i>=0)f.host.listeners.splice(i,1);f.host.stop();f.db.close();});
 const until=async(pred:()=>boolean,max=1800)=>{for(let i=0;i<max&&!pred();i++)await tick();assert.ok(pred(),'bounded native progress');};
 const body=()=>f.host.engine.world.entities[soul.entityId];
 return {...f,ledger,soul,seat,tick,until,body,events,observer};
}

test('native approach is not seating; actual exact occupied seat is observed long before 600-second terminal',async t=>{
 const w=await setup(t);const result=await accept(w.host,w.ledger.act(w.soul,{capability:'sit:'+w.seat,params:{seconds:600}}));assert.equal(result.accepted,true);if(!result.accepted)return;
 await w.until(()=>w.body().human?.activity==='walk');assert.equal(w.events.length,0,'accepted programme/walking is not actual seated activity');
 await w.until(()=>w.events.length===1);
 const {to,event}=w.events[0],b=event.body as any;
 assert.equal(to,w.soul.soulId);assert.equal(event.receipt&&((event.receipt as any).id),result.receipt.id);assert.equal((event.receipt as any).phase,'started');assert.equal(b.activity,'sit');assert.equal(b.posture,'seated');assert.deepEqual(b.occupiedSeats,[w.seat+'#seat']);assert.equal((event.action as any).phase,'occupied');assert.equal(event.observation,'native-current-body');assert.equal(event.reason,'native-transition');
 assert.equal(w.ledger.receipt(w.soul.soulId,result.receipt.id)!.phase,'started');assert.ok(w.host.engine.world.tick-result.receipt.acceptedTick<600*20);
 await w.tick(100);assert.equal(w.events.length,1,'unchanged held pose does not generate timer/model wake spam');
 const env=toEnvelope(event,{soulId:w.soul.soulId,name:'Observer'});assert.equal(env.kind,'activity.observed');assert.equal(env.salience,2);assert.match(env.text,/remains open/);assert.match(env.text,/No completion/);assert.equal((env.data?.body as any).occupiedSeats[0],w.seat+'#seat');
});

test('finite read and music actual poses are nonterminal observations, never delivered content',async t=>{
 const w=await setup(t);
 for(const [capability,activity,instrument]of [['read:reader','read',undefined],['play-music:music','play-music','guitar']]){
  const before=w.events.length,result=await accept(w.host,w.ledger.act(w.soul,{capability,params:{seconds:3}}));assert.equal(result.accepted,true);if(!result.accepted)return;
  await w.until(()=>w.body().human?.activity==='walk');assert.equal(w.events.length,before);
  await w.until(()=>w.events.length>before);const event=w.events.at(-1)!.event;
  assert.equal((event.body as any).activity,activity);assert.equal((event.body as any).instrument,instrument);assert.equal((event.receipt as any).phase,'started');assert.equal((event.receipt as any).outcome,undefined);assert.equal(w.ledger.receipt(w.soul.soulId,result.receipt.id)!.phase,'started');
  await w.until(()=>w.ledger.receipt(w.soul.soulId,result.receipt.id)!.phase==='completed');
 }
 assert.deepEqual(w.host.engine.runtime.violations,[]);assert.equal(w.db.paidCost(),0);
});

test('catch-up is explicitly current state; foreign ownership and replaced receipt cannot claim engagement',async t=>{
 const w=await setup(t),result=await accept(w.host,w.ledger.act(w.soul,{capability:'sit:'+w.seat,params:{seconds:600}}));assert.equal(result.accepted,true);if(!result.accepted)return;
 await w.until(()=>w.events.length===1);
 const captured:Record<string,unknown>[]=[],restart=activityObserver({host:w.host,db:w.db,now:()=>999999,deliver:(_s,_tick,b)=>captured.push(b)});t.after(()=>restart.close());
 restart.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(captured.length,1);assert.equal(captured[0].reason,'catch-up');assert.equal(captured[0].observedAt,999999);assert.equal((captured[0].receipt as any).endedTick,undefined);
 restart.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(captured.length,1,'catch-up is once, not polling');
 const human=w.body().human!,actual=human.activity,contrary:Record<string,unknown>[]=[],check=activityObserver({host:w.host,db:w.db,deliver:(_s,_tick,b)=>contrary.push(b)});t.after(()=>check.close());
 human.activity='walk';check.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(contrary.length,0,'occupied action alone cannot contradict the actual body');human.activity=actual;
 const nativeAction=w.host.engine.nativeSeatHoldsV1!(w.soul.entityId)[0].action;
 check.listener.onRuntimeEvent!({type:'action',id:nativeAction,tick:w.host.engine.world.tick,verb:'take_slot',status:'executing',phase:'occupied'});
 // Replace the receipt after observing its native event but before projection.
 w.db.db.prepare("UPDATE edge_receipts_v1 SET phase='replaced' WHERE world_id=? AND receipt_id=?").run(w.host.worldId,result.receipt.id);
 check.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(contrary.length,0,'queued native phase cannot revive a replaced receipt');
 w.db.db.prepare("UPDATE edge_receipts_v1 SET phase='started' WHERE world_id=? AND receipt_id=?").run(w.host.worldId,result.receipt.id);
 const unrelatedRows:unknown[]=[],unrelated=activityObserver({host:w.host,db:w.db,deliver:(_s,_t,b)=>unrelatedRows.push(b)});unrelated.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(unrelatedRows.length,1);unrelated.listener.onRuntimeEvent!({type:'action',id:'foreign-action',tick:w.host.engine.world.tick,verb:'pose_v1',status:'executing'});unrelated.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(unrelatedRows.length,1,'unrelated native action cannot create a second own-body observation');unrelated.close();
 const oldOwner=w.db.soul(w.soul.soulId)!.owner;w.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:foreign',w.soul.soulId);
 const foreignRows:unknown[]=[],foreign=activityObserver({host:w.host,db:w.db,deliver:(_s,_t,b)=>foreignRows.push(b)});foreign.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(foreignRows.length,0,'foreign owner body cannot be projected');foreign.close();w.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run(oldOwner,w.soul.soulId);
 const staleRows:unknown[]=[],stale=activityObserver({host:w.host,db:w.db,deliver:(_s,_t,b)=>staleRows.push(b)});
 w.db.db.prepare("UPDATE edge_receipts_v1 SET phase='replaced' WHERE world_id=? AND receipt_id=?").run(w.host.worldId,result.receipt.id);stale.listener.afterTickComplete!(w.host.engine.world.tick);assert.equal(staleRows.length,0,'terminal receipt cannot be projected');stale.close();
});

test('digest labels prior native activity as an observation rather than a finished act',()=>{
 const event:StreamEvent={id:'c_1',kind:'activity.observed',tick:30,at:1000,body:{posture:'seated',activity:'sit',occupiedSeats:['chair#seat']},receipt:{id:'r',capability:'sit:chair',phase:'started'}};
 const streams={head:()=>1,floor:()=>0,read:(_s:string,after:number)=>({events:after===0?[event]:[]})};
 const digest=buildDigest({streams:streams as any,soulId:'s',since:0,envelope:e=>toEnvelope(e,{soulId:'s',name:'Soul'}),now:1100,fade:null,plan:null,clock:null,place:null});
 assert.match(digest.text,/Observed activity \(then, not completion\)/);assert.ok(!digest.text.includes('Your last act:'));assert.ok(digest.salient.some(s=>s.includes('activity.observed')));
});
