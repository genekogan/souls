// Edge social vocabulary: wave, face, wander, warm-by-fire, gather — accepted and natively completed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
test('social verbs are offered and complete natively',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableQuietStallReleaseV1(),f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'social'})));}
 const ledger=new EdgeLedger(f.host,f.db),[a,b]=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const caps=ledger.capabilities(a),verbs=new Set(caps.map(c=>c.verb));
 const fire=Object.values((f.host.engine.world as any).entities).some((e:any)=>e.def==='campfire');
 for(const v of ['wave','face','wander','gather',...(fire?['warm-by-fire']:[])])assert.ok(verbs.has(v),v+' offered: '+[...verbs].join(','));
 const outcomes:Record<string,string>={};
 for(const id of ['wave:'+b.soulId,'face:'+b.soulId,'wander:here',...(fire?[caps.find(c=>c.verb==='warm-by-fire')!.id]:[]),caps.find(c=>c.verb==='gather')!.id]){
  const r=await accept(f.host,ledger.act(a,{capability:id,params:id.startsWith('wave')||id.startsWith('face')?{}:{seconds:10}}));assert.equal(r.accepted,true,id+' '+JSON.stringify(r));if(!r.accepted)continue;
  for(let i=0;i<3000&&['waiting','started'].includes(ledger.receipt(a.soulId,r.receipt.id)!.phase);i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
  outcomes[id.split(':')[0]]=ledger.receipt(a.soulId,r.receipt.id)!.phase+(ledger.receipt(a.soulId,r.receipt.id)!.code?':'+ledger.receipt(a.soulId,r.receipt.id)!.code:'');
 }
 t.diagnostic(JSON.stringify(outcomes));
 for(const [k,v] of Object.entries(outcomes))assert.equal(v,'completed',k+' '+v);
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
