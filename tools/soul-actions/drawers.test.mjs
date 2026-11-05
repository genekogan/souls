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
import {handActuatorFrame,slidePoint} from '../../mars/viewer/engine/social/hand-actuator.ts';

// Entry 24: a drawer slid open and shut by hand: the hand stays on the knob as it travels, the body steps with it.
const out=process.env.SOUL_ACTIONS_OUT;
test('hand drawer: words, slide contact, hand on the knob, refusal, interruption, persistence, bounded perception', {timeout:240000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Drawer test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/drawer-chest@3',name:`distant-chest-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{open:i%2===0}}));
 {const res=god.act({ops:distant});assert.equal(res.accepted,true,JSON.stringify(res).slice(0,600));}await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/drawer-chest@3',name:'chest',p:[ax+1,az+2.6],r:Math.PI},{op:'place',def:'core/drawer-chest@3',name:'private-chest',p:[ax-4,az+3],r:Math.PI,access:'private'}]}).accepted,true);await tick(45);
 const near=await here();if(out)writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id;
 const row_=near.objects.find(o=>o.id===id('chest')&&o.state);assert.deepEqual(row_?.state,{open:false},'a nearby chest shows only its open fact');
 const contact=(n,a)=>isContactActuator(god.model.resolvedDef(god.model.get(n).def),{name:a});assert.ok(contact('chest','open')&&contact('chest','close'));
 const act=async(words,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:words})}));const b=await r.json();assert.equal(b.accepted,accepted,words+' '+JSON.stringify(b).slice(0,300));return b;};
 const e=god.model.get('chest'),wp=god.model.worldPose(e),c=Math.cos(wp.yaw),sn=Math.sin(wp.yaw),local=p=>[(p[0]-wp.x)*c-(p[2]-wp.z)*sn,(p[0]-wp.x)*sn+(p[2]-wp.z)*c];
 const finish=async(r,want,limit=800)=>{let early=false,maxHandOff=0,minFront=9,steps=[],motion=null;for(let n=0;n<limit;n++){const b=body(),m=b.human?.handActuator;if(m){motion=m;const tt=(f.host.engine.world.tick-m.startTick)*f.host.engine.dt,fr=handActuatorFrame(m,tt);if(tt<0.6&&state('chest').open===want)early=true;
   // during the pull/push the hand is exactly on the knob where the drawer is, and the body stays in front, off the chest
   if(m.slide&&b.human.hands&&tt>0.7&&!fr.armDown){const k=slidePoint(m.slide,fr.pos).hand,h=b.human.hands.right;maxHandOff=Math.max(maxHandOff,Math.hypot(h[0]-k[0],h[1]-k[1],h[2]-k[2]));}
   const [lx,lz]=local(b.pose.p);minFront=Math.min(minFront,Math.abs(lx)<0.45+0.28?lz-(0.25+0.28):9);steps.push(lz);}
  const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}
  return {early,maxHandOff:+maxHandOff.toFixed(4),clearOfChestBy:+minFront.toFixed(3),stepRange:steps.length?+(Math.max(...steps)-Math.min(...steps)).toFixed(3):0,swing:motion?.slide?Math.abs(motion.slide.to-motion.slide.from):null,phase:edge.receipt(soul.soulId,r.receipt.id).phase};};
 await act('close the drawer',false);await act('open the private chest',false);
 const cut=await act('open the drawer');for(let n=0;n<400&&!body().human?.handActuator;n++)await tick(1);await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);assert.equal(state('chest').open,false,'interrupted before the grasp: the drawer stays shut');
 const results={};
 for(const [words,want] of [['open the drawer',true],['close the drawer',false],['open the drawer',true]]){
  const r=await act(words);assert.match(r.receipt.capability,new RegExp(`object:${id('chest')}:${want?'open':'close'}$`),words+' resolved to '+r.receipt.capability);
  assert.notEqual(state('chest').open,want,'admission changes nothing remotely');const x=await finish(r,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.equal(x.early,false,'nothing changes before the grasp');assert.equal(state('chest').open,want);
  assert.ok(x.maxHandOff<1e-6,'the hand stays on the knob: '+x.maxHandOff);assert.ok(x.clearOfChestBy>0,'the body never enters the chest: '+x.clearOfChestBy);assert.ok(Math.abs(x.swing-0.32)<1e-9);
  results[`${Object.keys(results).length+1}:${words}`]=x;assert.equal(body().human?.handActuator,undefined);
 }
 const spatial=f.host.engine.rt.services.spatial;spatial.sync(f.host.engine.world);assert.ok(spatial.scene.obstacles.some(o=>o.id===e.id||o.id.startsWith(e.id+'#')),'an open chest stays solid to navigation');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('chest').state.open,true);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100Chests:JSON.stringify(far).length,nearby:JSON.stringify(near).length},row:row_,results,checks:['plain words resolve to the drawer offers','closed drawer: close refused; private chest refused','interruption before the grasp keeps it shut','open/close/open through the slide contact','the hand stays exactly on the knob while the drawer travels','the body steps with the drawer and never enters the chest','nothing changes before the grasp','an open chest stays solid to navigation','snapshot persistence','100 distant chests: no offers','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
