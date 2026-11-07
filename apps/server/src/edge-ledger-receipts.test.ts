// PM-R054: a finished act ends `completed`; only this Soul's own newer act ends the older one `replaced`;
// ambient reflexes never touch an agent receipt; anything else that ends an open act reports `failed` with a code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
test('receipts: completed on arrival, replaced only by own newer act, ambient never replaces, interruption is failed',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'receipts'})));}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),[ana,ben]=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const run=async(n:number,until=()=>false)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}};
 const phase=(s:typeof ana,id:string)=>ledger.receipt(s.soulId,id)!;
 // 1. A walk that arrives ends completed.
 const walk=ledger.capabilities(ana).find(c=>c.verb==='walk'&&c.available&&c.target?.id==='shore-bank')??ledger.capabilities(ana).find(c=>c.verb==='walk'&&c.available)!;
 const w=await accept(f.host,ledger.act(ana,{capability:walk.id}));assert.equal(w.accepted,true,JSON.stringify(w));const wid=(w as any).receipt.id;
 await run(6000,()=>!['waiting','started'].includes(phase(ana,wid).phase));
 assert.equal(phase(ana,wid).phase,'completed',JSON.stringify(phase(ana,wid)));
 // 2. Ben holds a long act; ambient life runs for Ana (idle) but never touches Ben's open receipt.
 const b=await accept(f.host,ledger.act(ben,{capability:'rest:here',params:{seconds:600}}));assert.equal(b.accepted,true);const bid=(b as any).receipt.id;
 const ambientBefore=f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&(e.payload as any).trigger==='edge-ambient');
 await run(1600);
 const ambient=f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&(e.payload as any).trigger==='edge-ambient').slice(ambientBefore.length);
 assert.ok(ambient.some(e=>(e.payload as any).soulId===ana.soulId),'idle Ana got ambient life');
 assert.ok(!ambient.some(e=>(e.payload as any).soulId===ben.soulId),'Ben, with an open receipt, got none');
 assert.equal(phase(ben,bid).phase,'started');assert.equal(phase(ana,wid).phase,'completed','ambient life after completion keeps it completed');
 // 3. Ben's own newer act replaces the older receipt (no code); the newer one completes.
 const b2=await accept(f.host,ledger.act(ben,{capability:'rest:here',params:{seconds:3}}));assert.equal(b2.accepted,true);const b2id=(b2 as any).receipt.id;
 assert.deepEqual([phase(ben,bid).phase,phase(ben,bid).code],['replaced',null]);
 await run(400,()=>phase(ben,b2id).phase==='completed');assert.equal(phase(ben,b2id).phase,'completed',JSON.stringify(phase(ben,b2id)));
 // 4. Something other than the Soul's own act stops an open act: failed with a code, never replaced.
 const b3=await accept(f.host,ledger.act(ben,{capability:'rest:here',params:{seconds:600}}));const b3id=(b3 as any).receipt.id;
 await run(100,()=>phase(ben,b3id).phase==='started');assert.equal(phase(ben,b3id).phase,'started');
 await accept(f.host,f.host.enqueue('edge-stop','fixture:interrupt',{soulId:ben.soulId,entityId:ben.entityId,why:'test interruption'}));await run(100);
 assert.deepEqual([phase(ben,b3id).phase,phase(ben,b3id).code],['failed','action.interrupted']);
 const m=ledger.metrics();assert.equal(m.receiptsByPhase.completed,2);assert.equal(m.receiptFailuresByCode['action.interrupted'],1);assert.equal(m.completedShareOfFinished,0.5);
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
