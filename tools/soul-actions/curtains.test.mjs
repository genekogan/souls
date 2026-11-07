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

// Entry 23: curtains and a roller blind drawn by hand at a pull cord, by plain words; the covering changes only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
test('hand-drawn curtains and blind: words, cord contact, refusal, interruption, persistence, bounded perception', {timeout:240000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Curtains test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:i%2?'core/blind-window@1':'core/curtained-window@2',name:`distant-window-${i}`,p:[120+i%10*4,120+Math.floor(i/10)*4],state:{open:i%4<2}}));
 {const res=god.act({ops:distant});assert.equal(res.accepted,true,JSON.stringify(res).slice(0,600));}await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 // the windows face -z (their inside, +z, toward the Soul): placed in front of her, turned round
 assert.equal(god.act({ops:[{op:'place',def:'core/curtained-window@2',name:'curtains',p:[ax+1.2,az+3],r:Math.PI},{op:'place',def:'core/blind-window@1',name:'blind',p:[ax-2.2,az+3],r:Math.PI}]}).accepted,true);await tick(45);
 const near=await here();if(out)writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const rows=Object.fromEntries(['curtains','blind'].map(n=>[n,near.objects.find(o=>o.id===id(n)&&o.state)?.state]));
 for(const n of ['curtains','blind'])assert.deepEqual(rows[n],{open:true},n+' shows only its open fact');
 const contact=(n,a)=>isContactActuator(god.model.resolvedDef(god.model.get(n).def),{name:a});
 for(const n of ['curtains','blind'])assert.ok(contact(n,'open')&&contact(n,'close'),n+' is a hand contact');
 const act=async(words,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:words})}));const b=await r.json();assert.equal(b.accepted,accepted,words+' '+JSON.stringify(b).slice(0,300));return b;};
 const finish=async(r,name,want,limit=600)=>{let contact=false,early=false;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){contact=true;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.6&&state(name).open===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {contact,early,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('open the curtains',false);
 const cut=await act('close the blind');for(let n=0;n<400&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('blind').open,true,'interrupted before contact: the blind stays up');
 const results={};
 for(const [name,words,want] of [['curtains','close the curtains',false],['blind','close the blind',false],['curtains','open the curtains',true],['blind','open the blind',true],['curtains','close the curtains',false]]){
  const r=await act(words);assert.match(r.receipt.capability,new RegExp(`object:${id(name)}:${want?'open':'close'}$`),words+' resolved to '+r.receipt.capability);
  assert.notEqual(state(name).open,want,'admission changes nothing remotely');const x=await finish(r,name,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'nothing changes before contact');assert.equal(state(name).open,want);
  // the Soul stands on the inside (+z local) of the wall, in front of the cord
  const e=god.model.get(name),wp=god.model.worldPose(e),p=body().pose.p,lz=(p[0]-wp.x)*Math.sin(wp.yaw)+(p[2]-wp.z)*Math.cos(wp.yaw);x.insideBy=+lz.toFixed(2);assert.ok(lz>0.3,'stands inside, off the wall: '+lz);
  results[`${Object.keys(results).length+1}:${words}`]=x;assert.equal(body().human?.handActuator,undefined);
 }
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('curtains').state.open,false);assert.equal(restored.get('blind').state.open,true);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 assert.equal(isContactActuator(god.model.resolvedDef('core/window@1'),{name:'open'}),false,'frozen v1 window unchanged');
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Windows:JSON.stringify(far).length,nearby:JSON.stringify(near).length},rows,results,checks:['plain words resolve to the cord offers','open curtains: open refused','interruption before contact keeps the blind up','curtains and blind via the same hand contact, close/open/close','stands inside, in front of the cord','nothing changes before contact','snapshot persistence','100 distant windows: no offers, no far landmarks','frozen v1 window unchanged','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
