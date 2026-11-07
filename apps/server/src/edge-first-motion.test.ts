// #790 (D021): a walk receipt's `startedTick` is when its body program started; `firstMotionTick` is the first tick
// after it at which the body visibly began (its activity changed or it moved more than 5 cm). Fake world, no model, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import type {EdgeReceipt} from './edge/contract.ts';

const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic edge Soul'})) as {id:string};
 const tok='sim_EDGE_TEST_TOKEN_0';f.db.setSoulToken(row.id,hashToken(tok),'synthetic');
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});
 t.after(()=>{f.host.stop();f.db.close();});
 const call=async(method:string,path:string,body?:unknown)=>{const res=await accept(f.host,app.request(path,{method,headers:{authorization:'Bearer '+tok,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const receipt=async(id:string)=>(await call('GET','/v1/edge/receipts/'+id)).receipt;
 const entity=f.host.minds.get(row.id)!.entityId,body=()=>{const e=(f.host.engine.world as NativeWorld).entities[entity]!;return {activity:String(e.human?.activity??'idle'),p:[e.pose.p[0],e.pose.p[2]] as [number,number]};};
 // Settle to idle first: the walk must start from a standing, idle body.
 for(let i=0;i<200;i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
 return {...f,row,ledger,call,receipt,body};
}
const far=(caps:any[],skip=new Set<string>())=>caps.find(c=>c.verb==='walk'&&c.available&&!skip.has(c.id));

test('A3: a walk from idle: startedTick is the program start, firstMotionTick the first tick the body visibly begins',async t=>{
 const f=await setup(t),caps=(await f.call('GET','/v1/edge/capabilities')).capabilities as any[],walk=far(caps);assert.ok(walk,'some walk is available');
 const ended:EdgeReceipt[]=[];f.ledger.onReceipt(r=>{if(!['waiting','started'].includes(r.phase))ended.push(r);});
 const before=f.body();assert.equal(before.activity,'idle','starts idle');
 const acted=await f.call('POST','/v1/edge/act',{capability:walk.id});assert.equal(acted.accepted,true,JSON.stringify(acted));
 let started:number|null=null,observed:number|null=null,sawBeforeMotion=false;
 for(let i=0;i<400&&observed===null;i++){
  f.host.tickOnce();if(i%20===0)await setImmediate();
  const r=await f.receipt(acted.receipt.id),b=f.body(),tick=f.host.engine.world.tick;
  if(started===null&&r.startedTick!==null&&r.programId)started=r.startedTick;
  if(started!==null&&b.activity===before.activity&&Math.hypot(b.p[0]-before.p[0],b.p[1]-before.p[1])<=0.05){assert.equal(r.firstMotionTick,undefined,'no first motion while the body has not begun');sawBeforeMotion=true;}
  else if(started!==null){observed=tick;assert.equal(r.firstMotionTick,tick,'first motion is the tick the body began');}
 }
 assert.ok(started!==null&&observed!==null,'the walk started and the body moved');
 assert.ok(observed!>started!,`first motion (${observed}) comes after the program start (${started})`);
 assert.ok(sawBeforeMotion,'there were ticks between program start and first motion');
 for(let i=0;i<60&&(await f.receipt(acted.receipt.id)).phase==='started';i++)for(let k=0;k<100;k++){f.host.tickOnce();if(k%20===0)await setImmediate();}
 const last=await f.receipt(acted.receipt.id);assert.equal(last.firstMotionTick,observed,'kept on the terminal receipt');assert.equal(last.startedTick,started,'started keeps its meaning');
 const emitted=ended.find(r=>r.id===acted.receipt.id);assert.equal(emitted?.firstMotionTick,observed,'and on the terminal receipt event');
});

test('A3: a receipt replaced before its body moved never gets firstMotionTick; refusals have none',async t=>{
 const f=await setup(t),caps=(await f.call('GET','/v1/edge/capabilities')).capabilities as any[],a=far(caps),b=far(caps,new Set([a.id]));assert.ok(a&&b,'two walks');
 const first=await f.call('POST','/v1/edge/act',{capability:a.id});assert.equal(first.accepted,true);
 f.host.tickOnce();await setImmediate();
 const r1=await f.receipt(first.receipt.id);assert.equal(r1.phase,'started');assert.ok(r1.programId,'the first walk started its body program, so it was watched');assert.equal(r1.firstMotionTick,undefined,JSON.stringify(r1));
 const second=await f.call('POST','/v1/edge/act',{capability:b.id});assert.equal(second.accepted,true);
 for(let i=0;i<400&&(await f.receipt(second.receipt.id)).firstMotionTick===undefined;i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
 const replaced=await f.receipt(first.receipt.id);assert.equal(replaced.phase,'replaced');assert.equal(replaced.firstMotionTick,undefined);
 assert.ok(Number.isSafeInteger((await f.receipt(second.receipt.id)).firstMotionTick),'the replacing walk gets one');
 const refused=await f.call('POST','/v1/edge/act',{capability:'walk:no-such-place'});assert.equal(refused.accepted,false);assert.equal(refused.receipt?.firstMotionTick,undefined);
});
