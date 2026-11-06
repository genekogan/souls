// F2 (#373): a ride join whose body never got aboard ends failed or replaced; its receipt must not carry the boarding
// success summary ("Boarded …"), and the CLI's one-line brief says it failed instead of `done`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@sim/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
// @ts-expect-error plain .mjs Soul CLI (its pure brief formatter)
import {brief} from '../../../tools/world-launcher/soul/eden.mjs';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('F2: a ride join replaced before boarding is not reported as boarded',{timeout:600000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 await invite(f,'ana');const row:any=await accept(f.host,f.souls.create('dev:ana',{name:'ana',description:'rider'}));
 const tok='sim_F2_TEST_TOKEN';f.db.setSoulToken(row.id,hashToken(tok),'synthetic');
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const pump=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return p;};
 const call=async(method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 // ana joins the parked balloon (her body starts walking to its step), then her owner sends her elsewhere before she boards
 const join=await call('POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(join.accepted,true,JSON.stringify(join));
 await run(10,()=>false);
 const walk=(await call('GET','/v1/edge/capabilities')).capabilities.find((c:any)=>/^walk:/.test(c.id)&&c.available);assert.ok(walk,'a walk is offered');
 const w=await call('POST','/v1/edge/act',{capability:walk.id});assert.equal(w.accepted,true,JSON.stringify(w));
 await run(40,()=>false);
 const r=ledger.receipt(row.id,join.receipt.id)!;
 t.diagnostic(`join receipt: ${JSON.stringify({phase:r.phase,code:r.code,reason:r.reason,summary:r.outcome?.summary})}; brief: ${JSON.stringify(brief({accepted:true,receipt:r}))}`);
 assert.notEqual(r.phase,'completed',`the join never completed: ${JSON.stringify(r)}`);
 assert.doesNotMatch(String(r.outcome?.summary??''),/Boarded/,`a join that ended ${r.phase} is not reported as boarded: ${JSON.stringify(r.outcome)}`);
 const b=brief({accepted:true,receipt:r}) as Record<string,unknown>;
 assert.equal(b.done,undefined,`the brief does not say done for a ${r.phase} receipt: ${JSON.stringify(b)}`);
 assert.match(String(b.failed),/./,`the brief says it failed: ${JSON.stringify(b)}`);
});
