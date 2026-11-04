import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Hono } from '../../apps/server/node_modules/hono/dist/index.js';
import { fixture, invite, accept, factory } from '../../apps/server/test/native-owner-fixture.ts';
import { EdgeLedger } from '../../apps/server/src/edge/ledger/ledger.ts';
import { mountEdgeRoutes } from '../../apps/server/src/edge/routes.ts';
import { GodMode } from '../../apps/server/src/god/god.ts';
import { installEngineBridge } from '../../apps/server/src/god/engine-bridge.ts';
import { HOOK_PEG, CAN_GRIP } from '../../packages/world-compiler/src/core-kit/watering-can.ts';
import { biologyOf, biologyAt, biologyHourAt, WorldModel } from '../../packages/world-compiler/src/index.ts';
import { sampleTake } from '../../mars/viewer/engine/take/replay.ts';
import { viewerChunk } from '../../apps/server/src/hub.ts';
import { gardenStats } from '../../apps/server/src/god/garden.ts';

test('admitted full-wilt native watering, opt-out, two historical anchors, clock and restore', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const published=[];
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(e){if(e.kind==='world-diff')published.push(structuredClone(e));}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const captured=new Map();
 const tick=async(n=1)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();for(const c of f.host.engine.takeChunks?.(0)??[])captured.set(c.take.id,structuredClone(c));}};
 const clock=async hour=>{const now=f.host.engine.world.tick;await accept(f.host,f.host.enqueue('rules','fixture',{dayConfig:{origin:Math.round(now-hour/24*72000),dayTicks:72000,customs:[]}}));await tick(3);};
 await tick(5);await clock(0);await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Garden lifecycle test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(5);
 const body=()=>f.host.engine.world.entities[soul.entityId], [ax,,az]=body().pose.p;
 const place=ops=>{const r=god.act({ops});assert.equal(r.accepted,true,JSON.stringify(r));};
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return(await r.json()).here;};
 const absent=await here();
 place(Array.from({length:100},(_,i)=>({op:'place',def:'core/garden-planter@3',name:`far-bed-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2]})));
 await tick(45);const far=await here();assert.equal(JSON.stringify(far).length,JSON.stringify(absent).length,'100 distant beds add zero here bytes');
 gardenStats.planterVisits=0;await tick(45);assert.equal(gardenStats.planterVisits,0,'no biological visits for unflagged beds');
 place([{op:'place',def:'core/can-hook@1',tmp:'$hook',name:'can-hook',p:[ax+1.8,az-1.5]},
  {op:'place',def:'core/watering-can@2',name:'watering-can',in:{parent:'$hook'},p:HOOK_PEG.map((x,i)=>x-CAN_GRIP[i]),r:Math.PI/2,state:{level:1}},
  {op:'place',def:'core/garden-planter@3',name:'rose-bed',p:[ax+.6,az+2.6],state:{biologyEnabled:true,moisture:.1,growth:2,thirst:3}},
  {op:'place',def:'core/garden-planter@2',name:'unflagged',p:[ax-2,az+2.6],state:{moisture:.1,growth:2,thirst:3}}]);await tick(45);
 const bed=()=>god.model.get('rose-bed'),def=god.model.resolvedDef(bed().def),unflagged=()=>god.model.get('unflagged');
 const unchanged=structuredClone(unflagged().state);
 const h=()=>biologyHourAt(f.host.engine.world.tick,f.host.engine.plantClockV1());
 const look=()=>biologyAt(biologyOf(bed().state,def),h());
 const rejected=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${unflagged().id}:water`})}));
 assert.equal((await rejected.json()).accepted,false);assert.deepEqual(unflagged().state,unchanged);
 const journeys=[];
 async function water(){
  const response=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${bed().id}:water`})}));
  const admission=await response.json();assert.equal(admission.accepted,true,JSON.stringify(admission));
  const trace=[];let previous=JSON.stringify(bed().state);
  for(let n=0;n<4000;n++){
   const state=JSON.stringify(bed().state);if(state!==previous){trace.push({tick:f.host.engine.world.tick,hour:h(),state:structuredClone(bed().state),look:look()});previous=state;}
   const rec=edge.receipt(soul.soulId,admission.receipt.id);if(['completed','failed','cancelled','replaced'].includes(rec.phase)){assert.equal(rec.phase,'completed',JSON.stringify(rec));break;}
   await tick();if(n===3999)assert.fail('native watering did not finish');
  }
  const impulses=trace.filter(x=>x.state.biologyTarget<1);
  assert.ok(impulses.length>=3,'all soil impulses recorded');assert.equal(bed().state.biologyTarget,0,'a full native watering saturates pending recovery');
  assert.ok(impulses[0].look.w>.99,'first contact has no instant revival');assert.deepEqual(unflagged().state,unchanged);
  journeys.push({trace,anchor:structuredClone(bed().state),tick:f.host.engine.world.tick});return journeys.at(-1);
 }
 const first=await water(),firstHour=h();await clock(firstHour+36);assert.ok(look().w>.48&&look().w<.52);await clock(firstHour+72);assert.ok(look().w<.01,'full revival before redrying');
 await clock(firstHour+144);assert.ok(look().w>.99);const second=await water();await tick(25);
 assert.ok(second.anchor.biologyHour>first.anchor.biologyHour+140);
 // A fresh wire-only reader seeks back across both contacts, with no God model or current clock supplied.
 for(const journey of journeys){
  const impulses=journey.trace.filter(x=>x.state.biologyTarget<1);
  for(const event of impulses){
   const matches=[...captured.values()].filter(c=>c.fromTick<=event.tick+2&&c.toTick>=event.tick+2);assert.ok(matches.length,'historical chunk retained');
   const chunk=JSON.parse(JSON.stringify(viewerChunk(matches.at(-1)))),take=chunk.take;
   assert.ok(take.clock,'per-take clock captured');const at=sampleTake(take,(event.tick+2-take.startTick)*take.dt);
   const recorded=at.entities[bed().id]?.state.plantBiology;assert.ok(recorded,'recorded biology survives live transport');
   assert.equal(recorded.biologyTarget,event.state.biologyTarget,'fresh seek uses historical pending target '+JSON.stringify({eventTick:event.tick,chunk:[chunk.fromTick,chunk.toTick],native:f.host.engine.world.entities[bed().id]?.plantBiology,final:take.finalState.entities[bed().id]?.plantBiology,changes:take.changes.filter(c=>c[1]===bed().id&&c[2]==='plantBiology')}));
   const hour=biologyHourAt(event.tick+2,take.clock);assert.deepEqual(biologyAt(recorded,hour),biologyAt(biologyOf(event.state,def),hour));
  }
 }
 const snapshot=JSON.parse(JSON.stringify(god.model.snapshot())),restored=WorldModel.fromSnapshot(snapshot,undefined,god.model.library);
 assert.deepEqual(restored.get('rose-bed').state,bed().state);const engineState=f.host.engine.snapshot();const restoredEngine=factory.restore(engineState);assert.deepEqual(restoredEngine.plantClockV1(),f.host.engine.plantClockV1());
 // Interrupt an actual admitted pour after its first soil impulse; only delivered water survives.
 await clock(h()+144);
 const can=()=>[...god.model.entities.values()].find(e=>e.name==='watering-can'),beforeLevel=can().state.level;
 const partialResponse=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${bed().id}:water`})}));
 const partialAdmission=await partialResponse.json();assert.equal(partialAdmission.accepted,true);
 for(let n=0;n<4000&&bed().state.biologyTarget===1;n++)await tick();
 assert.ok(bed().state.biologyTarget<1,'first real partial impulse delivered');
 await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(100);
 const partialTarget=bed().state.biologyTarget;
 assert.ok(partialTarget>0&&partialTarget<1);assert.equal(bed().state.pouring,false);
 assert.ok(can().state.level>0&&can().state.level<beforeLevel,'abort consumes only delivered can water');
 assert.ok(Math.abs((beforeLevel-can().state.level)*10-bed().state.biologyMoisture*4)<=.005,'soil and can delivery agree within existing .001 level quantisation');
 const repeatedResponse=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${bed().id}:water`})}));
 const repeated=await repeatedResponse.json();assert.equal(repeated.accepted,true);
 for(let n=0;n<4000;n++){const phase=edge.receipt(soul.soulId,repeated.receipt.id).phase;if(['completed','failed','cancelled','replaced'].includes(phase)){assert.equal(phase,'completed');break;}await tick();if(n===3999)assert.fail('repeated native partial pour timed out');}
 assert.ok(bed().state.biologyTarget<partialTarget&&bed().state.biologyTarget>0,'new partial watering retains earlier pending recovery');
 assert.equal(can().state.level,0);
 const plantId=bed().id;
 const begin=async()=>{const response=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:`object:${plantId}:water`})}));const r=await response.json();assert.equal(r.accepted,true,JSON.stringify(r));return r;};
 const untilPour=async()=>{for(let n=0;n<4000&&!bed().state.pouring;n++)await tick();assert.equal(bed().state.pouring,true);};
 await clock(h()+144);place([{op:'set',id:can().id,state:{level:1}}]);await tick(3);
 await begin();await untilPour();
 const seqBeforeDisable=god.model.editSeq,publishedBeforeDisable=published.length;
 place([{op:'set',id:plantId,state:{biologyEnabled:false}}]);
 assert.equal(god.model.editSeq,seqBeforeDisable+1,'policy and frozen anchor are one atomic journal commit');
 assert.deepEqual(published.slice(publishedBeforeDisable).map(e=>e.seq),[seqBeforeDisable+1],'one ordered diff, no nested sequence gap');
 assert.equal(published.at(-1).diff.upserts.find(e=>e.id===plantId).state.pouring,false,'the original published transition already releases pouring');
 assert.equal(bed().state.pouring,false,'policy disable releases owned pouring immediately');
 const disabled=structuredClone(bed().state);await tick(140);assert.deepEqual(bed().state,disabled,'all later disabled soil impulses leave complete state unchanged');
 await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(80);assert.deepEqual(bed().state,disabled,'cancel cannot relatch disabled pouring');
 assert.ok(!f.host.engine.world.plantBiologyIdsV1?.includes(plantId),'disable removes native biology tick work');
 assert.ok(f.host.engine.world.plantStaticIdsV1.includes(plantId),'disabled history retains a frozen picture');
 const disabledEngine=factory.restore(f.host.engine.snapshot());assert.equal(disabledEngine.world.plantBiologyIdsV1,undefined);assert.deepEqual(disabledEngine.world.plantStaticIdsV1,[plantId]);
 await clock(h()+144);assert.deepEqual(bed().state,disabled,'disabled time has no biological work');
 place([{op:'set',id:plantId,state:{biologyEnabled:true}}]);await tick(3);
 assert.ok(f.host.engine.world.plantBiologyIdsV1.includes(plantId),'re-enable restores index');assert.ok(Math.abs(bed().state.biologyWilt-disabled.biologyWilt)<.001,'re-enable resumes frozen state without elapsed catch-up');
 assert.equal(f.host.engine.world.plantStaticIdsV1,undefined);
 // Removing a target during a real pour cannot create water or resurrect the target.
 const levelBeforeRemoval=can().state.level;await begin();await untilPour();await tick(30);
 place([{op:'remove',id:plantId}]);await tick(140);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(80);
 assert.ok(can().state.level<levelBeforeRemoval,'water delivered after target removal is still spent');
 assert.equal(f.host.engine.world.plantBiologyIdsV1,undefined,'removal clears last index entry');assert.equal(f.host.engine.world.plantStaticIdsV1,undefined);
 assert.equal(f.host.engine.world.entities[plantId],undefined);
 assert.equal(factory.create(factory.genesis('old-no-biology')).world.plantBiologyIdsV1,undefined,'old world has no index');
 assert.deepEqual(unflagged().state,unchanged);assert.deepEqual(f.host.engine.runtime.violations,[]);
 console.log(JSON.stringify({status:'pass',journeys:journeys.length,soilStateChanges:journeys.map(x=>x.trace.length),hereBytes:{absent:JSON.stringify(absent).length,distant100:JSON.stringify(far).length},recordedChunks:captured.size}));
});
