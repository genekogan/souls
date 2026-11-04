// Native timing preflight for the disclosed partial-wilt film. No browser or wall-clock performance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../apps/server/test/native-owner-fixture.ts';
import { EdgeLedger } from '../../apps/server/src/edge/ledger/ledger.ts';
import { Hono } from '../../apps/server/node_modules/hono/dist/index.js';
import { mountEdgeRoutes } from '../../apps/server/src/edge/routes.ts';
import { GodMode } from '../../apps/server/src/god/god.ts';
import { installEngineBridge } from '../../apps/server/src/god/engine-bridge.ts';
import { CAN_GRIP, HOOK_PEG, biologyAt, biologyOf, biologyHourAt } from '../../packages/world-compiler/src/index.ts';

test('partial-wilt journey fits normal-speed footage on the admitted continuous60s world day', {timeout:60000}, async t => {
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const edge=new EdgeLedger(f.host,f.db),god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}}),app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});t.after(()=>comms.close());
 installEngineBridge({host:f.host,god,edge,worldClock:false,worldLore:false,log(){}});
 const tick=async n=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await accept(f.host,f.host.enqueue('rules','fixture',{dayConfig:{origin:f.host.engine.world.tick,dayTicks:1200,customs:[]}}));
 await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Garden timing preflight'}));
 soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(5);
 const [x,,z]=f.host.engine.world.entities[soul.entityId].pose.p;
 const hour=()=>biologyHourAt(f.host.engine.world.tick,f.host.engine.plantClockV1());
 const r=god.act({ops:[{op:'place',def:'core/can-hook@1',tmp:'$hook',name:'can-hook',p:[x+1.8,z-1.5]},
  {op:'place',def:'core/watering-can@2',name:'watering-can',in:{parent:'$hook'},p:HOOK_PEG.map((v,i)=>v-CAN_GRIP[i]),r:Math.PI/2,state:{level:1}},
  {op:'place',def:'core/garden-planter@3',name:'rose-bed',p:[x+.6,z+2.6],state:{biologyEnabled:true,biologyHour:hour(),biologyWilt:.2,biologyTarget:1,biologyMoisture:.1,biologyGrowth:4,moisture:.1,growth:4,thirst:0}},
  {op:'place',def:'core/garden-planter@3',name:'unflagged',p:[x-1.2,z+2.6],state:{moisture:1,growth:4}}]});assert.equal(r.accepted,true,JSON.stringify(r));
 await tick(45);const bed=()=>god.model.get('rose-bed'),def=god.model.resolvedDef(bed().def),look=()=>biologyAt(biologyOf(bed().state,def),hour());
 const unchanged=structuredClone(god.model.get('unflagged').state),start=f.host.engine.world.tick,startWilt=look().w;
 await tick(120);const response=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${bed().id}:water`})})),admission=await response.json();assert.equal(admission.accepted,true,JSON.stringify(admission));
 let firstContact,completed;const trace=[];
 for(let n=0;n<1800;n++){
  const at=look(),phase=edge.receipt(soul.soulId,admission.receipt.id).phase;
  if(firstContact===undefined&&bed().state.biologyTarget===0)firstContact={seconds:(f.host.engine.world.tick-start)/20,wilt:at.w};
  if(phase==='completed'&&completed===undefined)completed=(f.host.engine.world.tick-start)/20;
  assert.ok(!['failed','cancelled','replaced'].includes(phase),JSON.stringify(edge.receipt(soul.soulId,admission.receipt.id)));
  if(n%20===0)trace.push({seconds:(f.host.engine.world.tick-start)/20,wilt:at.w,phase});
  if(firstContact&&completed&&at.w<.005)break;
  await tick(1);
 }
 assert.ok(firstContact&&completed,'actual admitted native pour and return completed');
 assert.ok(firstContact.wilt>startWilt&&firstContact.wilt<.4,'filmed partial plant dries further before actual contact');
 assert.ok(look().w<.005,'actual continuous clock reaches healthy');
 const seconds=(f.host.engine.world.tick-start)/20;
 assert.ok(seconds<75,`native partial journey leaves setup margin in90s clip: ${seconds}s`);
 assert.deepEqual(god.model.get('unflagged').state,unchanged);assert.deepEqual(f.host.engine.runtime.violations,[]);
 console.log(JSON.stringify({status:'pass',dayTicks:1200,realSecondsPerWorldDay:60,startWilt,firstContact,nativeCompletedSeconds:completed,healthySeconds:seconds,trace}));
});
