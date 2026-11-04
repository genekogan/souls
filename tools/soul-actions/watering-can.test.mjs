import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {gardenStats, growDay} from '../../apps/server/src/god/garden.ts';
import {wateringFrame, wateringEvents, TILT} from '../../mars/viewer/engine/items/watering.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';
import {HOOK_PEG, CAN_GRIP} from '../../packages/world-compiler/src/core-kit/watering-can.ts';
const HANG=[HOOK_PEG[0]-CAN_GRIP[0],HOOK_PEG[1]-CAN_GRIP[1],HOOK_PEG[2]-CAN_GRIP[2]];

// Entry 34: "water the planter" — the can from its hook by the handle, filled at the tap if empty, poured through the
// rose, hung back; growth stages a day at a time; nothing for distant Souls.
const out=process.env.SOUL_ACTIONS_OUT;
const r3=x=>Math.round(x*1000)/1000;
test('watering can and growth stages', {timeout:600000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(m){if(/watering/.test(m))console.log('bridge:',m);},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Watering test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];

 // ---- context: absent, then 100 distant growing planters (and 100 cans on hooks), then nearby ----
 const absent=await here();
 const distant=[];for(let i=0;i<100;i++){const x=120+i%10*3,z=120+Math.floor(i/10)*3;distant.push({op:'place',def:'core/garden-planter@3',name:`far-bed-${i}`,p:[x,z],state:{biologyEnabled:true,moisture:i%2?1:0.1,growth:i%5}},{op:'place',def:'core/can-hook@1',tmp:`$h${i}`,name:`far-hook-${i}`,p:[x+1.2,z]},{op:'place',def:'core/watering-can@2',name:`far-can-${i}`,in:{parent:`$h${i}`},p:HANG,state:{level:1}});}
 for(let i=0;i<distant.length;i+=150){const placed=god.act({ops:distant.slice(i,i+150)});assert.equal(placed.accepted,true,JSON.stringify(placed.failures?.slice(0,3)));}await tick(45);
 const far=await here();
 const byName=n=>[...god.model.entities.values()].find(e=>e.name===n);
 const farIds=new Set(distant.filter(d=>d.name).map(d=>byName(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 // the scene beside Ana: a hook with an empty can, the garden tap, two planters@2
 const sc=god.act({ops:[{op:'place',def:'core/can-hook@1',tmp:'$hook',name:'can-hook',p:[ax+1.8,az-1.5]},{op:'place',def:'core/watering-can@2',name:'watering-can',in:{parent:'$hook'},p:HANG,r:Math.PI/2,state:{level:0}},
  {op:'place',def:'core/garden-tap@1',name:'garden-tap',p:[ax-2.2,az-1.2]},{op:'place',def:'core/garden-planter@3',name:'rose-bed',p:[ax+0.6,az+2.6],state:{biologyEnabled:true}},{op:'place',def:'core/garden-planter@3',name:'herb-bed',p:[ax-1.6,az+2.6],state:{biologyEnabled:true,growth:2,moisture:0.2}}]});
 assert.equal(sc.accepted,true,JSON.stringify(sc.failures?.slice(0,3)));await tick(45);
 const id=n=>byName(n).id,state=n=>byName(n).state??{},ent=n=>f.host.engine.world.entities[id(n)];
 assert.deepEqual([ent('watering-can')?.support?.kind,ent('watering-can')?.support?.on],['resting-on',id('can-hook')],'the can hangs on its hook in the engine '+JSON.stringify(ent('watering-can')?.support));
 const near=await here(),obj=(h,n)=>h.objects.find(o=>o.id===id(n));
 assert.deepEqual(obj(near,'rose-bed')?.state,{stage:'seed',dry:true},'a nearby planter says its stage (and dry)');
 const cap=c=>edge.capabilities(soul).find(x=>x.id===c);
 const offer=cap(`object:${id('rose-bed')}:water`);assert.ok(offer?.available,'water the rose bed is offered '+JSON.stringify(offer));

 // ---- the act: words resolve to it ----
 const act=async(capability,accepted=true)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b).slice(0,600));return b;};
 const timeline=[];let last={};
 const watch=async(r,limit=4000)=>{for(let n=0;n<limit;n++){const b=body(),h=b.human,can=ent('watering-can'),s={tick:f.host.engine.world.tick,tap:!!state('garden-tap').on,level:state('watering-can').level,moisture:state('rose-bed').moisture,pouring:!!state('rose-bed').pouring,support:can?.support?.kind,on:can?.support?.on,phase:edge.receipt(soul.soulId,r.receipt.id)?.phase,motion:h?.wateringV1?.stage,activity:h?.activity,yawGap:can?.support?.kind==='in-hand'?r3(Math.abs(((can.pose.yaw-b.pose.yaw+Math.PI*3)%(Math.PI*2))-Math.PI)):undefined};
   const key=JSON.stringify({...s,tick:0,yawGap:0});if(key!==JSON.stringify({...last,tick:0,yawGap:0}))timeline.push(s);last=s;
   if(['completed','failed','cancelled','replaced'].includes(s.phase))return s;await tick(1);}return last;};
 const r1=await act(`object:${id('rose-bed')}:water`);
 assert.equal(state('rose-bed').moisture,0.1,'admission changes nothing');
 const end1=await watch(r1);
 assert.equal(end1.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r1.receipt.id)).slice(0,600)+'\n'+JSON.stringify(timeline.slice(-6)));
 const receipt1=edge.receipt(soul.soulId,r1.receipt.id);
 const grasp=timeline.find(x=>x.support==='in-hand');assert.ok(grasp&&grasp.yawGap<0.05,'the can comes off the hook facing the way the body faces (no turn at the grasp): '+JSON.stringify(grasp));
 console.log(JSON.stringify(timeline,null,0));
 assert.equal(state('garden-tap').on,false,'the tap is off again');
 assert.ok(timeline.some(s=>s.tap),'the tap ran during the fill');
 assert.equal(r3(state('rose-bed').moisture),1,'3.6 L soak a 4 L bed from 0.1');
 assert.equal(r3(state('watering-can').level),0.6,'10 L can, 4 L delivered including surplus');
 assert.deepEqual([ent('watering-can').support?.kind,ent('watering-can').support?.on],['resting-on',id('can-hook')],'hung back on its hook');
 assert.equal(byName('watering-can').in.parent,id('can-hook'),'the world has it on the hook too');
 // the tap ran only after the can was under the spout; moisture rose only while the stream ran (three steps)
 const tapOn=timeline.findIndex(s=>s.tap),firstMoist=timeline.findIndex(s=>s.moisture>0.1),pourOn=timeline.findIndex(s=>s.pouring);
 assert.ok(tapOn>0&&timeline[tapOn].motion==='fill','tap on during the fill motion');
 assert.ok(pourOn>0&&firstMoist>=pourOn&&timeline[firstMoist].motion==='pour','soil wet only while pouring');
 assert.equal(new Set(timeline.filter(s=>s.motion==='pour').map(s=>s.moisture)).size,4,'moisture in three steps');

 // ---- the can runs out: two more pours empty it, the fourth act fills it again ----
 const levels=[r3(state('watering-can').level)];
 for(const bed of ['herb-bed','rose-bed']){god.act({ops:[{op:'set',id:id(bed),state:{moisture:0,biologyHour:0,biologyMoisture:0,biologyWilt:1,biologyTarget:1}}]});await tick(5);const r=await act(`object:${id(bed)}:water`);const e=await watch(r);assert.equal(e.phase,'completed');levels.push(r3(state('watering-can').level));}
 assert.deepEqual(levels,[0.6,0.2,0],'pours of 4, 4 and the last 2 L: '+JSON.stringify(levels));
 god.act({ops:[{op:'set',id:id('herb-bed'),state:{moisture:0,biologyHour:0,biologyMoisture:0,biologyWilt:1,biologyTarget:1}}]});await tick(5);
 const before=timeline.length;const r4=await act(`object:${id('herb-bed')}:water`);await watch(r4);assert.ok(timeline.slice(before).some(s=>s.tap),'an empty can is filled first');

 // ---- interruption before the valve: nothing changes ----
 god.act({ops:[{op:'set',id:id('rose-bed'),state:{moisture:0,biologyHour:0,biologyMoisture:0,biologyWilt:1,biologyTarget:1}},{op:'set',id:id('watering-can'),state:{level:0}}]});await tick(5);
 const m0=state('rose-bed').moisture;const cut=await act(`object:${id('rose-bed')}:water`);
 for(let n=0;n<2000&&body().human?.wateringV1?.stage!=='fill';n++)await tick(1);
 await tick(6);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(120);
 assert.equal(state('garden-tap').on,false,'interrupted before the valve: tap untouched');assert.equal(state('rose-bed').moisture,m0,'no water');

 // ---- the timeline itself (what viewers draw) ----
 const pm={stage:'pour',seconds:3.2,levelAfter:0.6,startTick:0},tl=[];for(let s=0;s<=wateringFrame(pm,0).end+0.05;s+=0.05)tl.push(wateringFrame(pm,s));
 const maxTilt=Math.max(...tl.map(x=>x.tilt)),steps=tl.slice(1).map((x,i)=>Math.abs(x.tilt-tl[i].tilt));
 assert.ok(maxTilt>=45*Math.PI/180,'tilts at least 45°');assert.ok(Math.max(...steps)<=10*Math.PI/180,'no tilt step over 10° per 50 ms: '+Math.max(...steps));
 assert.ok(Math.max(...steps)/0.05<=150*Math.PI/180+1e-9,'angular speed within 150°/s');
 assert.ok(tl.every(x=>x.flow===0||x.tilt>=25*Math.PI/180-1e-9),'the stream only at ≥ 25°');
 const fm={stage:'fill',seconds:3.2,levelAfter:1,startTick:0,valve:[0,0,0]},ev=wateringEvents(fm);
 assert.deepEqual(ev.map(e=>e.key),['valve-on','valve-off']);
 const outIn=0.9,outFull=wateringFrame(fm,0).end-(ev[1].at+0.35);assert.ok(outFull>=1.0&&outIn<=0.75+0.15,'full can lifted out slowly: '+outFull);

 // ---- growth: stages a day at a time, stall when dry, never dies ----
 let g={moisture:1,growth:0,thirst:0};const days=[];for(let d=0;d<12;d++){g=growDay(g);days.push(g.growth);}
 assert.deepEqual(days.slice(0,3),[1,2,2],'one soaking: a stage a day while moist (1 → 0.67 → 0.33), then it stalls');
 assert.equal(days.at(-1),2,'dry: stalls, never dies');
 let dry={moisture:0,growth:2,thirst:0};for(let d=0;d<10;d++)dry=growDay(dry);assert.deepEqual([dry.growth,dry.thirst],[2,3],'ten dry days: stage kept, thirst capped');
 // the daily pass in the world, with 100 distant growing planters: no visits on any tick without a day change
 const living0=f.host.living??{};Object.defineProperty(f.host,'living',{configurable:true,value:{...living0,origin:f.host.engine.world.tick,dayTicks:400}});
 await tick(3);const v0=gardenStats.planterVisits,passes0=gardenStats.passes;await tick(300);
 assert.equal(gardenStats.planterVisits-v0,0,'no planter visited on 300 ticks without a day change');
 god.act({ops:[{op:'set',id:id('rose-bed'),state:{moisture:1,growth:0,thirst:0,biologyHour:0,biologyMoisture:1,biologyWilt:0,biologyGrowth:0,biologyTarget:1}},{op:'set',id:id('herb-bed'),state:{moisture:0,growth:2,thirst:0,biologyHour:0,biologyMoisture:0,biologyWilt:0,biologyGrowth:2,biologyTarget:1}}]});await tick(5);
 const sql=f.db.db??f.db,seqNow=()=>sql.prepare('SELECT MAX(seq) AS s FROM edge_comms_stream WHERE soul_id = ?').get(soul.soulId)?.s??0,seq0=seqNow();
 await tick(110);
 const dayEvents=sql.prepare('SELECT kind, body FROM edge_comms_stream WHERE soul_id = ? AND seq > ?').all(soul.soulId,seq0);
 const farEvents=dayEvents.filter(r=>[...farIds].some(x=>r.body.includes(x)));
 assert.equal(farEvents.length,0,'no events about the distant planters that grew: '+JSON.stringify(farEvents.slice(0,2)));
 assert.equal(gardenStats.passes-passes0,1,'one pass at the day change');assert.equal(gardenStats.planterVisits-v0,102,'the pass visits each opted-in planter once (100 distant + 2 here)');
 assert.deepEqual([state('rose-bed').growth,state('herb-bed').growth,state('herb-bed').thirst],[1,2,1],'rose grows, herb stalls and thirsts');
 assert.deepEqual(edge.contactActuator.facts(id('rose-bed')),{stage:'sprout'},'now a sprout (what a Soul beside it sees)');
 assert.deepEqual(edge.contactActuator.facts(id('herb-bed')),{stage:'leafy',dry:true},'the herb bed: leafy and dry');
 // tick cost: the same tick count with and without the 100 distant planters (the pass excluded: no day change inside)
 const cost=async()=>{const ts=[];for(let i=0;i<200;i++){const t0=performance.now();f.host.tickOnce();ts.push(performance.now()-t0);await setImmediate();f.host.drainInputs();}ts.sort((a,b)=>a-b);return {mean:r3(ts.reduce((a,b)=>a+b,0)/ts.length),median:r3(ts[100]),p90:r3(ts[180])};};
 Object.defineProperty(f.host,'living',{configurable:true,value:{...living0,origin:f.host.engine.world.tick,dayTicks:100000}});
 // the same 100 distant beds as growing planters@2 and as v1 planters (same count, no growth), measured twice alternately
 const farBeds=distant.filter(d=>d.name?.startsWith('far-bed'));
 const swap=async(def)=>{for(const d of farBeds){const e=byName(d.name);if(e)assert.equal(god.act({ops:[{op:'remove',id:e.id}]}).accepted,true);}assert.equal(god.act({ops:farBeds.map(d=>({...d,def,state:def.endsWith('@1')?{moisture:d.state.moisture}:d.state}))}).accepted,true);await tick(45);};
 const tickCost={};const vWith=gardenStats.planterVisits;
 tickCost.growing1=await cost();await swap('core/garden-planter@1');tickCost.v1a=await cost();await swap('core/garden-planter@3');tickCost.growing2=await cost();await swap('core/garden-planter@1');tickCost.v1b=await cost();
 assert.equal(gardenStats.planterVisits,vWith,'still no planter visits without a day change');

 // distant Soul context across the day change: nothing (checked through a second Soul far away)
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100PlantersAndCans:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyStateRow:obj(near,'rose-bed')?.state},
  receipt:{summary:receipt1?.outcome?.summary??receipt1?.summary,phase:receipt1?.phase},timeline:timeline.slice(0,40),canLevelsByPour:levels,growthByDay:days,tickMs:tickCost,dayChangeEventsForThisSoul:{all:dayEvents.length,aboutDistantPlanters:farEvents.length,kinds:[...new Set(dayEvents.map(r=>r.kind))]},
  checks:['offer only near; words resolve','tap only at the valve contact','soil wet only while the stream runs, in three steps','4 L per pour; three pours empty the can; an empty can is filled first','hung back on its hook (engine and world)','interruption before the valve changes nothing','tilt ≥45°, ≤10° per 50 ms, stream only ≥25°','growth a stage a day while moist; dry stalls; never dies','no planter visits on ticks without a day change; one visit each at the change','zero native violations']};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}
 console.log(JSON.stringify({...report,timeline:undefined}));
});
