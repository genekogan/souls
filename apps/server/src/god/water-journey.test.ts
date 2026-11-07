// The owner's west-lake swim starts on the actual Eden jetty. The water outline
// is not the wetted bank: a guessed shore used to finish >6m from a usable entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {GodMode} from './god.ts';
import {WorldModel} from '@souls/world-compiler';
import {WorldStore} from './store.ts';
const {compilerSnapshot}=await import(new URL('../../../../tools/playtest/lib/physical-fixture.mjs',import.meta.url).href);
import {groundField} from '@souls/engine-mars';
import {GroundHost,installGroundCapabilities} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
test('named-water progress reports actual swimming without prematurely completing the receipt', {timeout:30000}, async t=>{
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);const edge=new EdgeLedger(w.host,w.db);
 installGroundCapabilities(edge as never,god,w.host);installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const tick=async(n:number)=>{for(let i=0;i<n;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}}};
 await tick(4);
 const placed:any=god.act({ops:[{op:'place',def:'core/pond@1',name:'progress-pond',params:{depth:3},shape:{area:[[-22,-36],[-10,-36],[-10,-24],[-22,-24]]}}]} as any);
 assert.equal(placed.accepted,true,JSON.stringify(placed));await tick(4);
 await invite(w,'swimmer');const row:any=await accept(w.host,w.souls.create('dev:swimmer',{name:'Swimmer',description:'takes a lake swim'}));await tick(4);
 const s={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner},E=w.host.engine as any;
 await accept(w.host,w.host.enqueue('edge-relocate','test:dry-bank',{soulId:row.id,entityId:row.entity_id,to:[-4,-30],why:'start on dry ground outside the pond'}));await tick(4);
 const a:any=await accept(w.host,edge.act(s,{capability:'swim:progress-pond/middle'}));assert.equal(a.accepted,true,JSON.stringify(a));
 let receipt:any,sawApproach=false,sawSwimming=false;
 for(let i=0;i<5000;i++){
  receipt=edge.receipt(row.id,a.receipt.id);
  if(['completed','failed','cancelled'].includes(receipt?.phase))break;
  if(receipt?.body?.activity==='walk'){
   sawApproach=true;assert.match(receipt.now,/^walking to the middle of progress-pond, \d+ m left; not swimming yet$/);
  }
  if(receipt?.body?.activity==='swim'){
   sawSwimming=true;assert.equal(receipt.phase,'started');assert.equal(receipt.body.inWater,true);
   assert.match(receipt.now,/^swimming to the middle of progress-pond, \d+ m left; not finished yet$/);
   assert.ok(E.programOf(row.entity_id),'swimming progress is still an active journey');
  }
  await tick(1);
 }
 assert.ok(sawApproach,'observed the real dry-ground approach');assert.ok(sawSwimming,'observed actual swimming before completion');
 assert.equal(receipt?.phase,'completed',JSON.stringify(receipt));assert.equal(E.world.entities[row.entity_id].human.activity,'tread');
 assert.deepEqual(E.runtime.violations,[]);
});
for(const spec of [{world:'eden-2026',water:'land-west-lake',start:[-122,26],name:'Eden west-lake jetty to swimming and back uses a real bank and finishes both legs'},{world:'mars-two',water:'campus-swimming-pond',start:[0,0],name:'Mars campus pond generic swim and standard dry bank return finish with headroom'}])test(spec.name, {timeout:180000}, async t=>{
 const genesis=JSON.parse(readFileSync(new URL(`../../../../worlds/templates/${spec.world}.json`,import.meta.url),'utf8'));
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 if(spec.world==='eden-2026'&&process.env.SWIM_FIXTURE_SNAPSHOT){
  const model=WorldModel.fromSnapshot(compilerSnapshot(JSON.parse(readFileSync(process.env.SWIM_FIXTURE_SNAPSHOT,'utf8')))),store=new WorldStore(w.db,w.host.worldId);store.init(model,null);model.editSeq=1;
  assert.equal(store.commit(model,null,{defs:[],upserts:[...model.entities.values()],removes:[],answers:[],tiles:[]},{seq:1,by:'fixture',at:0,note:'Frozen public swim fixture',ops:[],inverse:[],kind:'engine'}),null);
 }
 const god=new GodMode(w.db,{genesis,worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);const edge=new EdgeLedger(w.host,w.db);
 installGroundCapabilities(edge as never,god,w.host);installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const tick=async(n:number)=>{for(let i=0;i<n;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}}};
 await tick(4);await invite(w,'swimmer');const row:any=await accept(w.host,w.souls.create('dev:swimmer',{name:'Swimmer',description:'takes a lake swim'}));await tick(4);
 const s={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner},E=w.host.engine as any;
 await accept(w.host,w.host.enqueue('edge-relocate','test:jetty',{soulId:row.id,entityId:row.entity_id,to:spec.start,why:'start at the actual journey fixture'}));await tick(4);
 const start=[...E.world.entities[row.entity_id].pose.p];
 const fld=groundField(E.world.groundV1.recipeHash),read=fld.waterId!;let probes=0;fld.waterId=(x,z)=>{probes++;return read(x,z);};
 const planTimes=[];try{for(const label of ['cold','warm']){probes=0;const before=performance.now();const issue=E.canPerform({actor:row.entity_id,label:'take a swim',steps:[{verb:'mars:swim_in',params:{water:god.model.get(spec.water)!.id}}]});planTimes.push({label,ms:performance.now()-before,waterIdentityProbes:probes});assert.equal(issue,null,JSON.stringify(issue));}}finally{fld.waterId=read;}

 for(const text of ['swim',`swim in the nearest ${spec.world==='eden-2026'?'lake':'pond'}`,`swim in ${spec.water}`]){const {caps,plans}=edge.coreA.binds(s);const r=edge.resolveOnDemand(s,text,caps,plans).v;assert.notEqual(r.kind,'unknown',JSON.stringify({text,r}));if(r.kind!=='unknown')assert.equal(r.cap.id,`swim:${spec.water}`,text);}
 const a:any=await accept(w.host,edge.act(s,{capability:`swim:${spec.water}`}));assert.equal(a.accepted,true,JSON.stringify(a));
 let receipt:any;
 for(let i=0;i<20000;i++){receipt=edge.receipt(row.id,a.receipt.id);if(receipt&&['completed','failed','cancelled'].includes(receipt.phase))break;await tick(1);}
 assert.equal(receipt?.phase,'completed',JSON.stringify(receipt));
 assert.equal(E.world.entities[row.entity_id].human.activity,'tread','actually swimming at completion');
 const swimAt=[...E.world.entities[row.entity_id].pose.p];assert.ok(Math.hypot(swimAt[0]-start[0],swimAt[2]-start[2])>=2.5,`left the jetty for deep water: ${swimAt}`);
 const swimSeconds=(E.world.tick-a.receipt.acceptedTick)/20;
 const backAct:any=await accept(w.host,edge.act(s,{capability:`walk:${spec.water}`}));assert.equal(backAct.accepted,true,JSON.stringify(backAct));
 let backReceipt:any;
 for(let i=0;i<4000;i++){backReceipt=edge.receipt(row.id,backAct.receipt.id);if(['completed','failed','cancelled'].includes(backReceipt?.phase))break;await tick(1);}
 assert.equal(backReceipt?.phase,'completed',JSON.stringify(backReceipt));
 const b=E.world.entities[row.entity_id];assert.equal(b.human.activity,'idle');assert.equal(edge.bodyOf(row.id)?.inWater,false);
 const totalSeconds=(E.world.tick-a.receipt.acceptedTick)/20;
 console.log(JSON.stringify({world:spec.world,frozenSnapshot:spec.world==='eden-2026'?process.env.SWIM_FIXTURE_SNAPSHOT??null:null,planTimes,swimAt,returnAt:b.pose.p,swimSeconds,totalSeconds,returnChosen:backReceipt.chosen,returnPlacePath:edge.placePathOf(row.id)}));
 assert.ok(totalSeconds<100,`physical swim+standard bank return leaves model overhead: ${totalSeconds}s`);
 assert.deepEqual(E.runtime.violations,[]);
});
