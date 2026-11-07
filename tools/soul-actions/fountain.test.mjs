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
import {isContactActuator} from '../../apps/server/src/god/contact-actuator.ts';

// Entry 21: a garden fountain turned on and off by hand at the valve on its post; water changes only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
test('hand-operated fountain: valve contact, refusal, interruption, persistence, bounded perception', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Fountain test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/garden-fountain@2',name:`distant-fountain-${i}`,p:[120+i%10*4,120+Math.floor(i/10)*4],state:{on:i%2===0}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant fountain offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/garden-fountain@2',name:'fountain',p:[ax+2.4,az+2.6]},{op:'place',def:'core/garden-tap@1',name:'tap',p:[ax-1.8,az+1.4],r:Math.PI},{op:'place',def:'core/fountain@1',name:'old-fountain',p:[ax+6,az-6]}]}).accepted,true);await tick(45);
 const near=await here(),state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const fountainRow=near.objects.find(o=>o.id===id('fountain'));assert.deepEqual(fountainRow?.state,{on:false},'a nearby fountain shows only its on fact');
 const act=async(cap,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:cap})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(r,name,want,limit=500)=>{let contact=false,early=false;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){contact=true;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name).on===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {contact,early,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('object:fountain:switch-off',false);
 // interruption before contact: nothing changes
 const cut=await act('object:fountain:switch-on');for(let n=0;n<300&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('fountain').on,false,'interrupted before contact: the fountain stays off');
 const results={};
 for(const [name,cap] of [['fountain','object:fountain:switch-on'],['tap','object:tap:switch-on'],['fountain','object:fountain:switch-off'],['fountain','object:fountain:switch-on']]){
  const r=await act(cap);assert.notEqual(state(name).on,cap.endsWith('on'),'admission changes nothing remotely');const x=await finish(r,name,cap.endsWith('on'));if(name==='fountain'){const e=god.model.get('fountain'),wp=god.model.worldPose(e),p=body().pose.p;x.standFromCentre=Math.hypot(p[0]-wp.x,p[2]-wp.z);assert.ok(x.standFromCentre>1.15+0.28,'stands off the basin rim: '+x.standFromCentre);}
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'no water before contact');assert.equal(state(name).on,cap.endsWith('on'));results[`${Object.keys(results).length+1}:${cap}`]=x;
  const m=body().human;assert.equal(m?.handActuator,undefined);
 }
  const contact=(n,a)=>isContactActuator(god.model.resolvedDef(god.model.get(n).def),{name:a});assert.ok(!god.model.resolvedDef('core/fountain@1').actions.some(a=>contact('old-fountain',a.name)),'v1 fountain has no hand contact');assert.ok(contact('fountain','switch-on')&&contact('fountain','switch-off'),'the garden fountain is a hand contact');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('fountain').state.on,true);assert.equal(restored.get('tap').state.on,true);
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/fountain.json`,JSON.stringify(god.model.snapshot()));}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 for(const ref of ['core/fountain@1','core/tiered-fountain@1','core/drinking-fountain@1'])assert.equal(god.model.resolvedDef(ref).tags.includes('hand-operated'),false,'frozen v1 fountain unchanged: '+ref);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Fountains:JSON.stringify(far).length,nearby:JSON.stringify(near).length},fountainRow,results,checks:['off-fountain switch-off refused','interruption before contact keeps it off','fountain and tap via the same hand contact; on/off/on','stands beside the valve post, off the basin','no water before contact','snapshot persistence','100 distant fountains: no offers','frozen v1 fountains unchanged','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
