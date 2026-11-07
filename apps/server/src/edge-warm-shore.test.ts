import {walkWithDestinationWords} from './edge/intents/intents.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {kernelHash} from '@souls/kernel';import {WorldHost,replayFromGenesis} from './world.ts';
import {accept} from '../test/native-owner-fixture.ts';
async function swimming(t:{after:(f:()=>void)=>void}){
 const w=await edenNavWorld(1,{nav:false});t.after(()=>{w.f.host.stop();w.f.db.close();});const a=w.souls[0];
 const swim=await w.act(a,'swim:shore-water',{seconds:30});assert.ok(swim.accepted,JSON.stringify(swim));
 await w.run([{soulId:a.soulId,id:swim.receipt.id}],10000);assert.equal(w.ledger.receipt(a.soulId,swim.receipt.id)!.phase,'completed');
 const body=w.engine.world.entities[a.entityId];assert.ok(['swim','tread'].includes(body.human.activity));return {w,a,body};
}
test('a new warm-by-fire act actually exits the pond and occupies the named fire place before completing',async t=>{
 const {w,a,body}=await swimming(t),fire=w.engine.world.entities['social-eden-fire'];let occupied=false;
 const warm=await w.act(a,'warm up by the fire',{seconds:5});assert.ok(warm.accepted,JSON.stringify(warm));
 await w.run([{soulId:a.soulId,id:warm.receipt.id}],10000,()=>{occupied ||= body.human.activity==='warm'&&Math.hypot(body.pose.p[0]-fire.pose.p[0],body.pose.p[2]-fire.pose.p[2])<2;});
 const end=w.ledger.receipt(a.soulId,warm.receipt.id)!;assert.equal(end.phase,'completed',JSON.stringify(end));assert.ok(occupied,'actual native occupied warm state at exact fire');assert.ok(Math.hypot(body.pose.p[0]-fire.pose.p[0],body.pose.p[2]-fire.pose.p[2])<2);assert.notEqual((end.endedAt as {posture:string}).posture,'swimming');assert.deepEqual(w.engine.runtime.violations,[]);assert.equal(w.f.db.paidCost(),0);
});

test('new fire receipts fail truthful outcomes for unseated native aggregate completion; accepted physics still replays exactly',async t=>{
 const {w,a}=await swimming(t);const ghost=await accept(w.f.host,w.ledger.performBodies(a,'warm-by-fire:social-eden-fire','new synthetic failed native gather',[{verb:'mars:campfire_circle',params:{actors:[a.entityId],fire:'social-eden-fire'}},{verb:'rest',params:{seconds:1}}]));assert.ok(ghost.accepted);if(!ghost.accepted)throw Error('fixture not admitted');
 await w.run([{soulId:a.soulId,id:ghost.receipt.id}],2000);const r=w.ledger.receipt(a.soulId,ghost.receipt.id)!;assert.equal(r.phase,'failed');assert.equal(r.code,'activity.not-reached');assert.equal((r.endedAt as {posture:string}).posture,'swimming');
 const expected={engine:w.engine.stateHash(),kernel:kernelHash(w.f.host.kernel)};w.f.host.saveSnapshot(true);const restored=new WorldHost(w.f.db,w.fac,w.f.host.seed,1e9,w.f.host.worldId,{durableClockV1:true});try{restored.boot();assert.deepEqual({engine:restored.engine.stateHash(),kernel:kernelHash(restored.kernel)},expected);}finally{restored.stop();}
 const genesis=replayFromGenesis(w.fac,w.f.host.seed,w.f.db.events(w.f.host.worldId),w.engine.world.tick);assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},expected);assert.deepEqual(w.engine.runtime.violations,[]);
});
test('walk with a named companion to a destination preserves that place and requests consent instead of timed follow',async t=>{
 const w=await edenNavWorld(2,{nav:false});t.after(()=>{w.f.host.stop();w.f.db.close();});const [a,b]=w.souls,words=`walk with ${b.name} to the fire`;
 const before=w.f.host.seq,dry=w.ledger.intents.dryRun(a,{capability:words}) as {ok:boolean;would:{capability:string;params:{with:string[]}}};assert.equal(dry.ok,true,JSON.stringify(dry));assert.equal(dry.would.capability,'walk:social-eden-fire');assert.deepEqual(dry.would.params.with,[b.name]);assert.equal(w.f.host.seq,before);
 const out=await w.act(a,words,{seconds:5});assert.ok(out.accepted,JSON.stringify(out));assert.equal(out.receipt.capability,'walk:social-eden-fire');assert.notEqual(out.receipt.capability,'follow:'+b.soulId);assert.equal(w.engine.programOf(b.entityId),null,'companion control is not taken by an invitation');
 const wrong=await w.act(a,`walk with ${b.name} to invented-harbour`);assert.equal(wrong.accepted,false);assert.equal(w.engine.programOf(b.entityId),null);const ignored=await w.act(a,`follow ${b.name} to the fire`);assert.equal(ignored.accepted,false);assert.equal(ignored.code,'follow.destination');
});

test('destination parsing preserves an exact Soul name containing to and explicit capability IDs',()=>{
 assert.equal(walkWithDestinationWords('walk with Road to Fire',['Road to Fire','Road']),null);
 assert.equal(walkWithDestinationWords('walk:harbour'),null);
 assert.deepEqual(walkWithDestinationWords('walk with Arlo to the fire',['Arlo']),{verb:'go',target:{place:'the fire'},with:['Arlo']});
});

test('absent private fire proof version retains legacy receipt behavior without changing native accepted execution',async t=>{
 const {w,a}=await swimming(t);const old=await accept(w.f.host,w.ledger.performBodies(a,'warm-by-fire:social-eden-fire','synthetic old persisted receipt',[{verb:'mars:campfire_circle',params:{actors:[a.entityId],fire:'social-eden-fire'}},{verb:'rest',params:{seconds:1}}]));assert.ok(old.accepted);if(!old.accepted)throw Error('fixture not admitted');
 // Simulate only an existing persisted receipt from before the private outcome policy.
 // Accepted native input/history is untouched; the old raw aggregate behavior remains exact.
 w.f.db.db.prepare("UPDATE edge_receipts_v1 SET detail=json_remove(detail,'$.warmTargetV1') WHERE world_id=? AND receipt_id=?").run(w.f.host.worldId,old.receipt.id);
 await w.run([{soulId:a.soulId,id:old.receipt.id}],2000);const end=w.ledger.receipt(a.soulId,old.receipt.id)!;assert.equal(end.phase,'completed');assert.equal((end.endedAt as {posture:string}).posture,'swimming');assert.deepEqual(w.engine.runtime.violations,[]);
});
