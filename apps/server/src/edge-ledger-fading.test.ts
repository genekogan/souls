// C9 body effects (flag-on and SIM_BEAM in this test only): removal at 60 min idle, reclaim lands at a starting place.
// LINK BODY: with the beam off again, a Soul the beam took comes back as a sleeping body (one-time migration).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import {edgeSoulResolver} from './edge/routes.ts';
// LINK (Gene 2026-10-24): idle bodies now stay in the world (zombie/asleep); removal after 60 min idle only runs with SIM_BEAM on, so this enables it.
test('fading (flag on): removed after 60 min idle, hidden from others; next act reclaims at a starting place',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'fade'})));}
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono();let now=1_000_000;
 const comms=registerEdgeComms(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger},{fading:true,beam:true,now:()=>now,sweepMs:0});ledger.attachComms(comms as any);t.after(()=>comms.close());
 const ana={soulId:rows[0].id,entityId:rows[0].entity_id,name:'ana',owner:rows[0].owner};
 const first=await accept(f.host,ledger.act(ana,{capability:'rest:here',params:{seconds:600}}));assert.equal(first.accepted,true);
 for(let i=0;i<20;i++)f.host.tickOnce();
 now+=61*60_000;comms.sweep();for(let i=0;i<10;i++){f.host.tickOnce();f.host.drainInputs();}
 assert.ok(ledger.faded.has(ana.soulId),'faded');{const r=ledger.receipt(ana.soulId,(first as any).receipt.id)!;assert.deepEqual([r.phase,r.code],['failed','soul.faded'],'fading ends the open act failed, not replaced');}assert.equal(f.host.engine.programOf(ana.entityId),null,'body stopped');
 assert.ok(!ledger.perceivedBodies(rows[1].id,500).some(b=>b.soulId===ana.soulId),'hidden from others');
 assert.equal((ledger.observe(ana,new Set()) as any).self.state,'faded');
 // DLG1: `faded` is memory; a restarted Ledger re-learns the durable roster, so the absent Soul stays hidden and is not animated.
 {const n=f.host.listeners.length,l2=new EdgeLedger(f.host,f.db),c2=registerEdgeComms(new Hono(),{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger:l2},{fading:true,beam:true,now:()=>now,sweepMs:0});l2.attachComms(c2 as any);
  try{assert.ok(l2.faded.has(ana.soulId),'re-learned after restart');assert.ok(!l2.perceivedBodies(rows[1].id,500).some(b=>b.soulId===ana.soulId),'still hidden after restart');}finally{c2.close();f.host.listeners.splice(n);}}
 const back=await accept(f.host,ledger.act(ana,{capability:'rest:here',params:{seconds:5}}));assert.equal(back.accepted,true,JSON.stringify(back));
 assert.ok(!ledger.faded.has(ana.soulId));assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='edge-relocate').length,1);
 const p=(f.host.engine.world as NativeWorld).entities[ana.entityId].pose.p;t.diagnostic('landed at '+JSON.stringify(p));
 for(let i=0;i<40;i++)f.host.tickOnce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,mode);h.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('LINK migration: a Soul the old beam took is back on the next boot without the beam, asleep where it was, visible',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'fade'})));}
 let now=1_000_000;const mk=(beam:boolean)=>{const l=new EdgeLedger(f.host,f.db,undefined,{now:()=>now}),c=registerEdgeComms(new Hono(),{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger:l},{fading:true,beam,now:()=>now,sweepMs:0});l.attachComms(c as any);return {l,c};};
 const old=mk(true);const ana={soulId:rows[0].id,entityId:rows[0].entity_id,name:'ana',owner:rows[0].owner};
 old.c.sweep();now+=61*60_000;old.c.sweep();for(let i=0;i<10;i++){f.host.tickOnce();f.host.drainInputs();}
 assert.ok(old.l.faded.has(ana.soulId),'the old beam took ana');const was=(f.host.engine.world as NativeWorld).entities[ana.entityId].pose.p.slice();
 old.c.close();const n=f.host.listeners.length;
 const next=mk(false);t.after(()=>next.c.close());assert.ok(next.l.faded.has(ana.soulId),'still faded before the body rule runs');
 const rule=next.l.attachPresence({soulPresence:()=>({listening:false,at:null})})!;
 for(let i=0;i<60;i++){now+=50;f.host.tickOnce();f.host.drainInputs();}
 assert.ok(!next.l.faded.has(ana.soulId),'back');assert.deepEqual(rule.view(ana.soulId)?.state,'asleep');
 assert.equal((next.c as any).fading.status(ana.soulId).colour,'green');
 assert.ok(next.l.perceivedBodies(rows[1].id,500).some(b=>b.soulId===ana.soulId),'visible to others again');
 const p=(f.host.engine.world as NativeWorld).entities[ana.entityId];t.diagnostic('was '+JSON.stringify(was)+' now '+JSON.stringify(p.pose.p)+' '+(p.human as any).activity);
 assert.deepEqual(p.pose.p,was,'stays where it was (dry, clear ground)');assert.equal(String((p.human as any).activity),'nap','asleep, lying down');
 assert.deepEqual((next.c as any).fading.restoreGone(),[],'one-time: nothing left to restore');
 f.host.listeners.splice(n);
});
