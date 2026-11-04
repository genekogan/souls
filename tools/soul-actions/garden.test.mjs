import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

// Entry 16: a sprinkler turned on by hand soaks the planters within its reach at the contact; others stay dry.
const out=process.env.SOUL_ACTIONS_OUT;
test('garden sprinkler: hand contact soaks planters in reach only, at contact; persistence; bounded perception', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Water test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:i%2?'core/garden-planter@1':'core/garden-sprinkler@1',name:`distant-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2]}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();if(process.env.DIFF_HERE)console.error('HEREDIFF',JSON.stringify({absent,far}));
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant sprinkler offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/garden-sprinkler@1',name:'sprinkler',p:[ax+1.5,az+2]},{op:'place',def:'core/garden-planter@3',name:'bed-a',p:[ax+2.9,az+4.2],state:{biologyEnabled:true}},{op:'place',def:'core/garden-planter@3',name:'bed-b',p:[ax+0.2,az+4.4],state:{biologyEnabled:true}},{op:'place',def:'core/garden-planter@3',name:'bed-far',p:[ax+7,az+2],state:{biologyEnabled:true}},{op:'place',def:'core/garden-planter@3',name:'bed-behind',p:[ax+1.5,az+0.2],state:{biologyEnabled:true}}]}).accepted,true);await tick(45);
 const near=await here(),state=n=>god.model.get(n).state;
 assert.ok(!JSON.stringify(near).includes('moisture'),'no moisture facts in here');
 const act=async(cap,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:cap})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const dry=n=>assert.ok((state(n).moisture??0.1)<0.5,n+' dry');
 const cut=await act('object:sprinkler:switch-on');for(let n=0;n<300&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);
 assert.equal(state('sprinkler').on,false);for(const n of ['bed-a','bed-b','bed-far'])dry(n);
 const r=await act('object:sprinkler:switch-on');let early=false,contact=false;
 for(let n=0;n<500;n++){const m=body().human?.handActuator;if(m){contact=true;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state('bed-a').moisture===1)early=true;}if(['completed','failed'].includes(edge.receipt(soul.soulId,r.receipt.id).phase))break;await tick(1);}
 assert.equal(edge.receipt(soul.soulId,r.receipt.id).phase,'completed');assert.ok(contact);assert.equal(early,false,'no soaking before contact');
 assert.equal(state('sprinkler').on,true);assert.equal(state('bed-a').moisture,1);assert.equal(state('bed-b').moisture,1);dry('bed-far');dry('bed-behind');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('bed-a').state.moisture,1);
 const off=await act('object:sprinkler:switch-off');for(let n=0;n<500&&!['completed','failed'].includes(edge.receipt(soul.soulId,off.receipt.id).phase);n++)await tick(1);assert.equal(state('sprinkler').on,false);assert.equal(state('bed-a').moisture,1,'turning off keeps the soil wet');
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/garden.json`,JSON.stringify(god.model.snapshot()));}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100:JSON.stringify(far).length,nearby:JSON.stringify(near).length},checks:['interruption before contact: no spray, no soaking','in-reach planters soak at contact only','out-of-reach and behind-the-arc planters stay dry','persistence','turning off keeps the soil wet','no distant offers','no moisture facts in here','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
