import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost,installGroundCapabilities} from './ground-host.ts';
import type {EdgeSoul} from '../edge/contract.ts';

// Public act audit: real private ownership/build closure, native sequencer,
// receipt and physical body. No layer/refusal or launch functions are mocked.
async function setup(t:test.TestContext,kind:'private'|'construction'|'public'){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'owner',constants:{extent:60},tick:()=>f.host.engine.world.tick,emit(){}});
 const edge=new EdgeLedger(f.host,f.db);new GroundHost(f.db,f.host,god);installGroundCapabilities(edge,god,f.host);const bridge=installEngineBridge({host:f.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 const tick=async(n=4)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const built=god.act({ops:[{op:'expand',extent:400},{op:'place',tmp:'$house',def:coreRef('pavilion'),name:'far-house',p:[90,-10],...(kind==='private'?{owner:'soul:Other',access:'private' as const}:{})},{op:'place',def:coreRef('chair'),name:'audit-chair',in:{parent:'$house'},p:[1,0,1]}]});assert.equal(built.accepted,true,JSON.stringify(built));await tick(8);
 const density=god.act({ops:Array.from({length:126},(_,i)=>({op:'place',def:coreRef('zone'),name:`tiny-${String(i).padStart(3,'0')}`,shape:{area:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]},params:{use:'park'}}))} as never);assert.equal(density.accepted,true,JSON.stringify(density));await tick(4);
 await invite(f,'walker');const row=await accept(f.host,f.souls.create('dev:walker',{name:'Walker',description:'Native on-demand admission audit'}));
 const soul:EdgeSoul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 if(kind==='construction'){
  const caller=god.godIdentity(god.mintFor({id:'owner',role:'user'},'builder'))!;
  const start=god.builds.start({id:'far-renovation',title:'Far house renovation',steps:['shell','roof'],root:'far-house',site:{at:[90,-10],size:[24,24]}},caller);
  assert.equal(start.ok,true,JSON.stringify(start));await tick(2);assert.equal(god.builds.closingSites().length,1);
 }
 bridge.perceive.sync(true);edge.map();
 const room=bridge.nav.things().find(x=>x.ref.startsWith('far-house/')&&x.kind==='room')!;assert.ok(room);
 const asked='walk:'+room.ref;
 edge.invalidateBodies();const full=edge.coreA.binds(soul);assert.equal(full.caps.some(c=>c.id===asked),false,'actual far room is absent from the bounded listing');
 assert.equal(bridge.nav.exactListedWalk(soul,room.ref,[],new Map()),false);
 // Establish the actual layer's denial on the actual native on-demand plan.
 const caps:Parameters<typeof bridge.layers.capabilities>[1]=[],plans=new Map();assert.equal(bridge.nav.walkRefOnDemand(soul,room.ref,caps,plans),true);
 assert.ok(plans.get(asked),JSON.stringify({caps,room}));const body=f.host.engine.world.entities[soul.entityId]!;
 bridge.layers.capabilities(soul,caps,plans,[body.pose.p[0],body.pose.p[2]]);
 const expected=kind==='private'?'object.private':kind==='construction'?'site.under-construction':null;assert.equal(caps.find(c=>c.id===asked)?.blocked?.code??null,expected);assert.equal(plans.has(asked),expected===null);
 return {f,god,bridge,edge,soul,asked,tick,expected};
}
for(const kind of ['private','construction'] as const)for(const mode of ['default','sparse-disabled'] as const){
 test(`public act refuses an unlisted ${kind} far room (${mode})`,async t=>{
  const w=await setup(t,kind),{f,edge,soul,asked}=w;
  if(mode==='sparse-disabled')(edge as unknown as {exactWalkBindings:()=>null}).exactWalkBindings=()=>null;
  const before=[...f.host.engine.world.entities[soul.entityId]!.pose.p];
  const result=await accept(f.host,edge.act(soul,{capability:asked,clientRef:`mask-${kind}-${mode}`}));
  await w.tick(12);
  const receipts=f.db.db.prepare('SELECT receipt_id,capability,phase,program_id FROM edge_receipts_v1 WHERE soul_id=?').all(soul.soulId);
  const body=f.host.engine.world.entities[soul.entityId]!;
  t.diagnostic(JSON.stringify({kind,mode,asked,result,receipts,before,after:body.pose.p,activity:body.human?.activity,nativeViolations:f.host.engine.runtime.violations}));
  assert.equal(result.accepted,false,JSON.stringify(result));
  if(!result.accepted)assert.equal(result.code,w.expected);
  assert.equal(receipts.length,0,'a protected destination creates no native action receipt');
  assert.deepEqual(body.pose.p,before,'refusal leaves the native body in place');
 });
}

for(const kind of ['private','construction'] as const)for(const mode of ['default','sparse-disabled'] as const){
 test(`on-demand place, floor, thing and gait public act keep ${kind} admission (${mode})`,async t=>{
  const w=await setup(t,kind),{f,edge,soul,bridge}=w;
  if(mode==='sparse-disabled')(edge as unknown as {exactWalkBindings:()=>null}).exactWalkBindings=()=>null;
  const cases=[
   {asked:'walk:g-far-house.pavilion',hook:'walkOnDemand'},
   {asked:'ground floor far-house',hook:'floorOnDemand'},
   ...(kind==='construction'?[{asked:'walk to audit chair',hook:'thingOnDemand'} as const]:[]),
   {asked:'run:g-far-house.pavilion',hook:'gaitOnDemand'},
   {asked:'jog:g-far-house.pavilion',hook:'gaitOnDemand'},
  ] as const;
  assert.equal(edge.coreA.binds(soul).caps.some(c=>c.id==='walk:far-house/audit-chair'),false,'actual named thing is omitted');
  for(const {asked,hook}of cases){
   let calls=0;const original=edge[hook]!;(edge as any)[hook]=(...args:any[])=>{calls++;return(original as any)(...args);};
   const before=[...f.host.engine.world.entities[soul.entityId]!.pose.p];
   const result=await accept(f.host,edge.act(soul,{capability:asked,clientRef:`${kind}-${mode}-${hook}-${asked}`}));await w.tick(3);
   (edge as any)[hook]=original;
   t.diagnostic(JSON.stringify({kind,mode,asked,hook,calls,result}));assert.ok(calls>0,'actual public resolver must reach '+hook+' for '+asked);
   assert.equal(result.accepted,false,JSON.stringify(result));if(!result.accepted)assert.equal(result.code,w.expected,asked);
   assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1 WHERE soul_id=?').get(soul.soulId) as {n:number}).n,0);
   assert.deepEqual(f.host.engine.world.entities[soul.entityId]!.pose.p,before);
  }
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.ok(bridge.layers.active());
 });
}
for(const mode of ['default','sparse-disabled'] as const)test(`public unlisted route and derived gait remain native actions (${mode})`,async t=>{
 const w=await setup(t,'public'),{f,edge,soul,asked}=w;
 if(mode==='sparse-disabled')(edge as unknown as {exactWalkBindings:()=>null}).exactWalkBindings=()=>null;
 for(const capability of [asked,'run:g-far-house.pavilion','jog:g-far-house.pavilion']){
  const before=[...f.host.engine.world.entities[soul.entityId]!.pose.p];
  const out=await accept(f.host,edge.act(soul,{capability,clientRef:`public-${mode}-${capability}`}));assert.equal(out.accepted,true,JSON.stringify(out));if(out.accepted){assert.ok(out.receipt.programId);assert.equal((out.receipt.chosen as {target?:string}|undefined)?.target,'g-far-house.pavilion');}
  await w.tick(12);const body=f.host.engine.world.entities[soul.entityId]!;
  assert.equal(body.human?.activity,capability.split(':')[0]);assert.ok(Math.hypot(body.pose.p[0]-before[0],body.pose.p[2]-before[2])>0,'each accepted native walk/run/jog must actually move the body');
 }
 assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('gait identity uses only exact installed authored refs, never decoded native or mismatched IDs',async t=>{
 const w=await setup(t,'private'),{edge,bridge}=w;
 const ref=(bridge.layers as any).h.authoredPlaceRef as (id:string)=>string|undefined;
 assert.equal(ref('g-far-house.pavilion'),'far-house/pavilion');assert.equal(ref('field'),undefined);assert.equal(ref('g-field'),undefined);
 const id='g-far-house.pavilion',place=edge.places.byId.get(id)!;
 edge.places.byId.set(id,{...place,ref:'far-house'} as typeof place);
 assert.equal(ref(id),undefined,'mismatched stored ref must not map one place to a different authored target');
 edge.places.byId.set(id,place);assert.equal(ref(id),'far-house/pavilion');
});
