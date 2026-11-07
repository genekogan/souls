// Edge: real limits only. The thin commons strip takes many arrivals; quiet renewal waits instead of refusing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
async function world(t:any,n:number){
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableQuietStallReleaseV1(),f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(let i=0;i<n;i++){const name='s'+i;await invite(f,name);rows.push(await accept(f.host,f.souls.create('dev:'+name,{name,description:'edge'})));}
 const ledger=new EdgeLedger(f.host,f.db),souls=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0)await setImmediate();}return until();};
 return {f,ledger,souls,run};
}
test('five Souls walk to the thin commons strip at once: all accepted, all arrive',{timeout:300000},async t=>{
 const {f,ledger,souls,run}=await world(t,5),ids:string[]=[];
 const r0=(f.host.engine.world as NativeWorld).regions['commons'];assert.ok(r0,'native commons region present');
 for(const s of souls){const r=await accept(f.host,ledger.act(s,{capability:'walk:commons'}));assert.equal(r.accepted,true,JSON.stringify(r));if(r.accepted)ids.push(r.receipt.id);}
 assert.ok(await run(12000,()=>ids.every((id,i)=>!['waiting','started'].includes(ledger.receipt(souls[i].soulId,id)!.phase))));
 assert.deepEqual(ids.map((id,i)=>ledger.receipt(souls[i].soulId,id)!.phase),souls.map(()=>'completed'),JSON.stringify(ids.map((id,i)=>[ledger.receipt(souls[i].soulId,id)!.phase,ledger.receipt(souls[i].soulId,id)!.code])));
 assert.deepEqual(f.host.engine.runtime.violations,[]);
});
test('during quiet renewal an act is accepted as waiting and runs after first light',{timeout:300000},async t=>{
 const {f,ledger,souls,run}=await world(t,1);
 await accept(f.host,f.host.enqueue('rules','world',{quiet:true,day:f.host.living!.lastDay,why:'overdue quiet checkpoint'}));assert.equal(f.host.quietBarrier,true);
 const r=await accept(f.host,ledger.act(souls[0],{capability:'rest:here',params:{seconds:5}}));assert.equal(r.accepted,true,JSON.stringify(r));if(!r.accepted)return;assert.equal(r.receipt.phase,'waiting');
 assert.ok(await run(20000,()=>ledger.receipt(souls[0].soulId,r.receipt.id)!.phase==='completed'),JSON.stringify(ledger.receipt(souls[0].soulId,r.receipt.id)));
 assert.equal(f.host.quietBarrier,false);
});
