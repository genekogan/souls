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
import {freeDoorOpening} from '../../apps/server/src/god/doors.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';
import {isContactActuator} from '../../apps/server/src/god/contact-actuator.ts';

// Openings family (#427), entry 1: a tent flap fastened at its toggle (the drawn covering's contact) and a five-bar field
// gate on its hinge (core-gate@2's contact), both data only, by plain words; each changes only at the hand's contact.
const out=process.env.SOUL_ACTIONS_OUT;
test('tent flap and field gate by hand: words, contact, refusal, interruption, passage, persistence, bounded perception', {timeout:300000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Openings test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const ok=r=>{assert.equal(r.accepted,true,JSON.stringify(r).slice(0,600));return r;};
 const absent=await here();
 // tents are landmarks: far away they are named in `far` as tent@1 is. The control is the same 100 copies of the frozen
 // revisions (tent@1, gate@2) at the same spots; the new revisions must add nothing to that.
 const spots=(defs)=>Array.from({length:100},(_,i)=>({op:'place',def:defs[i%2],name:`distant-opening-${i}`,p:[120+i%10*5,120+Math.floor(i/10)*5],state:{open:i%4<2}}));
 ok(god.act({ops:spots(['core/tent@1','core/gate@2'])}));await tick(45);const control=await here();
 ok(god.act({ops:spots([]).map(d=>({op:'remove',id:d.name}))}));await tick(20);
 const distant=spots(['core/tent@2','core/field-gate@1']);
 ok(god.act({ops:distant}));await tick(45);const far=await here();
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));writeFileSync(`${out}/here-control.json`,JSON.stringify(control,null,1));}
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 assert.equal(JSON.stringify(far).length,JSON.stringify(control).length,'100 distant new tents and gates add 0 bytes over the frozen revisions');
 assert.ok(!/"open"|distant-opening/.test(JSON.stringify(far.objects??[])),'no distant facts');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 // both face the Soul (their front, local +z, toward her: turned round), in plain sight and a few metres apart
 ok(god.act({ops:[{op:'place',def:'core/tent@2',name:'tent',p:[ax+2,az+3],r:Math.PI},{op:'place',def:'core/field-gate@1',name:'field-gate',p:[ax-2.4,az+3],r:Math.PI}]}));await tick(45);
 const near=await here();if(out)writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));
 const state=n=>god.model.get(n).state,id=n=>god.model.get(n).id,def=n=>god.model.resolvedDef(god.model.get(n).def);
 // a tent is a place in `here` (an exit), not an object: its flap is perceived through its offers; the gate says `open`
 const rows={'field-gate':near.objects.find(o=>o.id===id('field-gate'))?.state,tentExit:near.exits.find(x=>x.walk==='walk:tent')?.name};
 assert.deepEqual(rows['field-gate'],{open:false},'the field gate shows only its open fact');assert.equal(rows.tentExit,'Tent');
 assert.ok(!near.objects.some(o=>o.id===id('tent')),'the tent is not an object row');
 for(const n of ['tent','field-gate'])assert.ok(isContactActuator(def(n),{name:'open'})&&isContactActuator(def(n),{name:'close'}),n+' is a hand contact');
 const offers=n=>edge.capabilities(soul).filter(c=>c.object===id(n)&&c.available!==false).map(c=>c.id.split(':').pop()).sort();
 assert.deepEqual(offers('tent'),['open'],'a shut tent offers open');assert.deepEqual(offers('field-gate'),['open'],'a shut gate offers open');
 // O6: the tent gains no door solid (no hinge component); the field gate closes its own gap like core-gate@2
 const baked=n=>({box:def(n).size.box});
 assert.equal(freeDoorOpening(def('tent'),baked('tent')),null,'no door solid across the tent');
 assert.equal(freeDoorOpening(def('field-gate'),baked('field-gate'))?.width,1.58,'the field gate blocks its gap');
 const act=async(words,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:words})}));const b=await r.json();assert.equal(b.accepted,accepted,words+' '+JSON.stringify(b).slice(0,300));return b;};
 const finish=async(r,name,want,limit=900)=>{let contact=false,early=false,contactTick=null,changeTick=null;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){contact=true;contactTick??=m.startTick;}if(state(name).open===want&&changeTick===null){changeTick=f.host.engine.world.tick;if(!contact)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}
  return {phase:edge.receipt(soul.soulId,r.receipt.id)?.phase,contact,early,handStart:contactTick,changed:changeTick};};
 // O5: an act interrupted before the contact changes nothing
 const cut=await act('open the tent flap');for(let n=0;n<600&&!body().human?.handActuator;n++)await tick(1);await tick(3);
 ok(await accept(f.host,edge.act(soul,{capability:'stand:here'})));await tick(60);assert.equal(state('tent').open,false,'interrupted before contact: the flap stays shut');
 assert.ok(['replaced','cancelled','failed'].includes(edge.receipt(soul.soulId,cut.receipt.id).phase));
 const results={};
 for(const [name,words,want] of [['tent','open the tent flap',true],['tent','close the tent flap',false],['tent','open the tent',true],['field-gate','open the field gate',true],['field-gate','close the field gate',false],['field-gate','open the gate',true]]){
  const r=await act(words);assert.match(r.receipt.capability,new RegExp(`object:${id(name)}:${want?'open':'close'}$`),words+' resolved to '+r.receipt.capability);
  assert.notEqual(state(name).open,want,'admission changes nothing remotely');const x=await finish(r,name,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.contact,'actual hand contact ran');assert.equal(x.early,false,'nothing changes before contact');assert.equal(state(name).open,want);
  // she stands in front (local +z) of the thing she worked, out of its footprint
  const e=god.model.get(name),wp=god.model.worldPose(e),p=body().pose.p;x.frontBy=+((p[0]-wp.x)*Math.sin(wp.yaw)+(p[2]-wp.z)*Math.cos(wp.yaw)).toFixed(2);
  results[`${Object.keys(results).length+1}:${words}`]=x;assert.equal(body().human?.handActuator,undefined);
  // O5: the same act again is not on offer
  if(want){const again=await act(`object:${id(name)}:open`,false);x.again=again.code;assert.ok(again.code,words+' twice: '+JSON.stringify(again).slice(0,200));}
 }
 const open=await here();const facts={'field-gate':open.objects.find(o=>o.id===id('field-gate'))?.state};
 assert.deepEqual(facts,{'field-gate':{open:true}},'the gate says open');
 assert.deepEqual(offers('tent'),['close'],'an open tent offers close');assert.deepEqual(offers('field-gate'),['close'],'an open gate offers close');
 // O6: a walk that the shut field gate walls off goes through it by hand (entry 31's passage, data only) and shuts it behind
 const gz=az+14,gx=ax-14,yard=(x,w=.79)=>({op:'place',def:'core/garden-wall@1',name:'yard-walls',shape:{path:[[x-w,gz],[x-4,gz],[x-4,gz+6],[x+4,gz+6],[x+4,gz],[x+w,gz]]}});
 ok(god.act({ops:[yard(gx),{op:'place',def:'core/field-gate@1',name:'yard-gate',p:[gx,gz],r:Math.PI},{op:'place',def:'core/bench@1',name:'yard-bench',p:[gx+1.5,gz+4]}]}));await tick(45);
 const walk=ok(await accept(f.host,edge.act(soul,{capability:'walk:yard-bench'})));assert.match(walk.receipt.reason??'',/Through/,JSON.stringify(walk.receipt).slice(0,300));assert.equal(state('yard-gate').open,false,'admission does not open the gate');
 let sawOpen=false;for(let n=0;n<2400;n++){if(state('yard-gate').open)sawOpen=true;const ph=edge.receipt(soul.soulId,walk.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}
 const walked=edge.receipt(soul.soulId,walk.receipt.id);assert.equal(walked.phase,'completed',JSON.stringify(walked).slice(0,400));assert.ok(sawOpen,'opened by hand on the way');assert.equal(state('yard-gate').open,false,'shut behind');
 assert.ok(body().pose.p[2]>gz,'inside the yard');results.passage={phase:walked.phase,reason:walk.receipt.reason,openedOnTheWay:sawOpen,closedBehind:!state('yard-gate').open};
 // O7: a restored snapshot keeps both
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('tent').state.open,true);assert.equal(restored.get('field-gate').state.open,true);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 // O9: the frozen revisions keep their hand-free behaviour and bytes
 assert.equal(isContactActuator(god.model.resolvedDef('core/tent@1'),{name:'open'}),false,'frozen tent@1 unchanged');
 assert.ok(isContactActuator(god.model.resolvedDef('core/gate@2'),{name:'open'}),'gate@2 still a hand contact');
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,control100Frozen:JSON.stringify(control).length,distant100:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyOpen:JSON.stringify(open).length},rows,facts,results,
  checks:['plain words resolve to the flap and gate offers','no distant offers, +0 bytes','interruption before contact keeps the flap shut','tent open/close/open at the toggle contact','field gate open/close/open on its hinge','an open flap or gate is not offered open again','no door solid across the tent; the field gate blocks its gap','a walk walled off by the shut field gate goes through it by hand and shuts it behind','snapshot keeps open','tent@1 frozen, gate@2 unchanged']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
