// Edge: several Souls swim at once; a crossing body never fails a swim receipt with occupied-route.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
async function fourSwims(t:any,birthIds?:string[]){
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 await accept<unknown>(f.host,f.host.enableQuietStallReleaseV1());await accept<unknown>(f.host,f.host.enableYieldTimeoutV1());await accept<unknown>(f.host,f.host.enableShoreDepartV1());
 const rows:any[]=[];for(const [i,n]of ['ana','ben','cy','di'].entries()){await invite(f,n);if(!birthIds){rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'edge swimmer'})));continue;}
  // Reproduce the ACTUAL failed tuple through normal Souls.create/birth. Only
  // five-byte Soul ID randomness is pinned; all motion/collision checks remain.
  const original=crypto.randomBytes;let calls=0;const stub=t.mock.method(crypto,'randomBytes',(...args:any[])=>{if(args[0]===5){assert.equal(++calls,1);return Buffer.from(birthIds[i].slice(2),'hex');}return (original as any)(...args);});syncBuiltinESMExports();
  try{rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'edge swimmer'})));assert.equal(rows[i].id,birthIds[i]);}finally{stub.mock.restore();syncBuiltinESMExports();}
 }
 const ledger=new EdgeLedger(f.host,f.db),souls=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 t.diagnostic('swimmer identities '+JSON.stringify(souls.map(s=>({soulId:s.soulId,entityId:s.entityId}))));
 const native=(f.host.engine as any).rt;if(birthIds){const cancel=native.cancel.bind(native);t.mock.method(native,'cancel',(id:string,why:any)=>{if(why?.code==='route.blocked')t.diagnostic('before safe cancel '+JSON.stringify({id,tick:native.tick,records:[...native.records.values()].filter((r:any)=>r.id===id||r.parent===id).map((r:any)=>({id:r.id,parent:r.parent,verb:r.verb,status:r.status,phase:r.phase,diagnostic:r.diagnostic})),waits:[...(native.services.moverWaits?.samples.values()??[])].map((r:any)=>({mover:r.mover,owner:r.owner,blockers:r.blockers,code:r.code,tick:r.tick}))}));return cancel(id,why);});}
 const receipts:string[]=[];for(const s of souls){const r=await accept(f.host,ledger.act(s,{capability:'swim:shore-water'}));assert.equal(r.accepted,true,JSON.stringify(r));if(r.accepted)receipts.push(r.receipt.id);}
 const w=f.host.engine.world as NativeWorld;let peak=0;
 const done=()=>receipts.every((id,i)=>!['waiting','started'].includes(ledger.receipt(souls[i].soulId,id)!.phase));
 for(let i=0;i<20000&&!done();i++){f.host.tickOnce();if(i%20===0)await setImmediate();peak=Math.max(peak,souls.filter(s=>['swim','tread'].includes(String(w.entities[s.entityId].human?.activity))).length);}
 const final=receipts.map((id,i)=>ledger.receipt(souls[i].soulId,id));
 const engine=f.host.engine as any;
 t.diagnostic('swim final diagnostics '+JSON.stringify({tick:w.tick,peak,receipts:final,programs:[...engine.programs.values()].filter((p:any)=>souls.some(s=>s.entityId===p.actor)).map((p:any)=>({id:p.id,actor:p.actor,index:p.index,status:p.status,spreadWaits:p.spreadWaits,steps:p.steps,diagnostic:p.diagnostic})),records:[...engine.runtime.records.values()].filter((r:any)=>souls.some(s=>s.entityId===(r.params as any)?.actor)&&/shore|walk_to/.test(r.verb)).map((r:any)=>({id:r.id,verb:r.verb,status:r.status,phase:r.phase,params:r.params,diagnostic:r.diagnostic,history:r.history}))}));
 assert.deepEqual(final.map(r=>r!.phase),['completed','completed','completed','completed'],JSON.stringify(final.map(r=>[r!.phase,r!.code])));
 assert.ok(peak>=3,'peak '+peak);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 t.diagnostic('peak simultaneous swimmers '+peak);
}
test('four edge swims at once all complete; peak simultaneous swimmers >= 3',{timeout:300000},async t=>fourSwims(t));
test('captured connected-gate failure tuple completes all four real swim receipts',{timeout:300000},async t=>fourSwims(t,['s_97bcc2b8d7','s_c0fd670f18','s_8eed8dee09','s_fe091e7358']));
test('captured connected-water child failure tuple completes all four real swim receipts',{timeout:300000},async t=>fourSwims(t,['s_15651a5250','s_deb97f53b3','s_7cfa396701','s_6bafe7feea']));
test('captured dry-child current wait evidence',{timeout:300000},async t=>fourSwims(t,['s_cfab80d090','s_a4e2f51728','s_6997c43e88','s_fa16b5dfe1']));
test('captured occupied-route failure tuple (Modal n2 5ac841e9) completes all four real swim receipts',{timeout:300000},async t=>fourSwims(t,['s_9a2b2272bf','s_52c1e0a87c','s_b659127058','s_2e5d8ae1bf']));
// Two swimmers stopped touching a third on the dry gate; without shoreDepartV1 each step away was occupied for good and
// three receipts failed shore.occupied-route (deterministic with these IDs before the policy).
test('captured gate-departure failure tuple (Modal r13 a34d4b8d9) completes all four real swim receipts',{timeout:300000},async t=>fourSwims(t,['s_94b5b3be42','s_c53217e44c','s_cc9df835c7','s_01c1f66bdf']));
