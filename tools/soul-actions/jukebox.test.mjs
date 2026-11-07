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

// Entry 20: a jukebox turned on and off by hand at its knob; the music state changes only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
test('jukebox: knob contact, refusal, interruption, persistence, bounded perception', {timeout:120000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Jukebox test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/jukebox@2',name:`distant-jukebox-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{on:i%2===0}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();assert.equal(JSON.stringify(far).length,JSON.stringify(absent).length,'distant jukeboxes add 0 bytes');assert.ok(!/jukebox/.test(JSON.stringify(far)),'no distant jukebox in here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant jukebox offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/jukebox@2',name:'jukebox',p:[ax+1.6,az+1.4],r:Math.PI},{op:'place',def:'core/garden-tap@1',name:'tap',p:[ax-1.8,az+1.4]}]}).accepted,true);await tick(45);
 const near=await here(),state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const boxRow=near.objects.find(o=>o.id===id('jukebox'));assert.deepEqual(boxRow?.state,{on:false},'a nearby jukebox shows only its on fact');
 const act=async(cap,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:cap})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(r,name,want,limit=500)=>{let contact=false,early=false;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){contact=true;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name).on===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {contact,early,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('object:jukebox:switch-off',false);
 // interruption before contact: nothing changes
 const cut=await act('object:jukebox:switch-on');for(let n=0;n<300&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('jukebox').on,false,'interrupted before contact: jukebox stays off');
 const results={};
 for(const [name,cap] of [['jukebox','object:jukebox:switch-on'],['tap','object:tap:switch-on'],['jukebox','object:jukebox:switch-off'],['jukebox','object:jukebox:switch-on']]){
  const r=await act(cap);assert.notEqual(state(name).on,cap.endsWith('on'),'admission changes nothing remotely');const x=await finish(r,name,cap.endsWith('on'));
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'no change before contact');assert.equal(state(name).on,cap.endsWith('on'));results[cap]=x;
  const m=body().human;assert.equal(m?.handActuator,undefined);
 }
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('jukebox').state.on,true);assert.equal(restored.get('tap').state.on,true);
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/jukebox.json`,JSON.stringify(god.model.snapshot()));}
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Jukeboxes:JSON.stringify(far).length,nearby:JSON.stringify(near).length},boxRow,results,checks:['off jukebox switch-off refused','interruption before contact keeps it off','jukebox and tap via the same hand contact','on/off/on','no change before contact','snapshot persistence','100 distant jukeboxes (half on): no offers, +0 here bytes','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
