import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {KITE,kiteAt,kiteHand,kiteOut,kiteTimes} from '../../mars/viewer/engine/items/kite.ts';
import {recordedKites} from '../../mars/viewer/app/engine-view/recorded-games.ts';

// #441 (W108): flying a kite with real custody. One held item before, during and after; the kite's place is a pure function of
// the recorded flight and the tick; a stop reels it in first; 100 distant kites cost nothing.
const DEF='core/kite@2',TURNS=[0,.4,.785,1.2,1.571,1.9,2.356,2.9,3.7,4.712,5.5];
async function world(t,names=['Ana']){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let current;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>current});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};await tick();
 const souls={};for(const name of names){const id=name.toLowerCase();await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Kite test'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();}
 const W=()=>f.host.engine.world,body=s=>W().entities[s.entityId],named=n=>[...god.model.entities.values()].find(e=>e.name===n);
 const here=async s=>{current=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const act=(s,capability,params)=>accept(f.host,edge.act(s,{capability,...(params?{params}:{})}));
 const receipt=(s,b)=>edge.receipt(s.soulId,b.receipt.id);
 const ended=(s,b)=>['completed','failed','cancelled','replaced'].includes(receipt(s,b)?.phase);
 const until=async(cond,limit=2400)=>{for(let n=0;n<limit;n++){if(cond())return n;await tick(1);}return -1;};
 const finish=async(s,b)=>{assert.ok(await until(()=>ended(s,b))>=0,'the receipt ends');return receipt(s,b);};
 const place=ops=>{const r=god.act({ops});assert.equal(r.accepted,true,JSON.stringify(r.failures?.slice(0,3)));};
 const relocate=async(s,x,z)=>{await accept(f.host,f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to:[x,z],why:'test placement'}));await tick(6);};
 return {f,edge,god,tick,souls,W,body,named,here,act,receipt,until,finish,place,relocate};
}
async function kit(t,names=['Ana']){
 const w=await world(t,names),{souls,tick,body,place,named,act,finish}=w;await tick(10);const ana=souls[names[0]],[ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 place([{op:'place',def:DEF,name:'kite',p:[ax+.8,az]}]);await tick(30);
 const grab=async(s=ana)=>{const b=await act(s,'pick-up:'+named('kite').id);assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.equal((await finish(s,b)).phase,'completed');};
 return {...w,ana,ax,az,grab,cap:()=>'kite:'+named('kite').id};
}
const flying=(w,s)=>w.f.host.engine.rt.holder('actor:'+s.entityId).map(id=>w.f.host.engine.rt.records.get(id)).find(r=>r?.verb==='kite_v1');

test('fly the kite: it climbs, sways and comes back; the same kite in the same hand, the body still',{timeout:300000},async t=>{
 const w=await kit(t,['Ana','Ben']),{ana,souls:{Ben:ben},tick,act,finish,receipt,named,body,grab,W,edge,here,until,f,relocate,ax,az}=w;
 assert.equal(edge.capabilities(ana).filter(c=>c.verb==='fly-kite').length,0,'no offer before it is held');
 const none=await act(ben,'fly a kite');assert.equal(none.accepted,false);assert.equal(none.code,'kite.no-kite',JSON.stringify(none).slice(0,200));
 await grab();const id=named('kite').id,hand0=W().entities[id].support.hand;
 assert.equal(edge.capabilities(ana).filter(c=>c.verb==='fly-kite').length,1,'the offer while it is held');
 await relocate(ben,ax+3,az+2);
 const b=await act(ana,'fly the kite for 6 seconds');assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.equal(b.receipt.capability,'kite:'+id);
 assert.ok(await until(()=>flying(w,ana),400)>=0,'it started');const p0=[...body(ana).pose.p];
 let top=0,both=0,saw=false,moved=0;
 for(let n=0;n<800&&receipt(ana,b)?.phase!=='completed';n++){await tick(1);
  const s=body(ana).human.kiteV1,T=W().tick,sampled={[ana.entityId]:{state:{kiteV1:s},activity:body(ana).human.activity,p:body(ana).pose.p,yaw:body(ana).pose.yaw}},r=recordedKites(sampled,T);
  if(r.kites.length){top=Math.max(top,r.kites[0].p[1]);if(!r.items.has(id))both++;saw=true;}
  moved=Math.max(moved,Math.hypot(body(ana).pose.p[0]-p0[0],body(ana).pose.p[2]-p0[2]));
  if(n===100){assert.equal(body(ana).human.activity,'kite');const h=await here(ben);assert.match(JSON.stringify(h.near),/flying a kite/,'Ben sees it: '+JSON.stringify(h.near).slice(0,200));}
 }
 assert.equal(receipt(ana,b).phase,'completed',JSON.stringify(receipt(ana,b)).slice(0,300));assert.equal(receipt(ana,b).code??null,null);
 assert.ok(saw,'it was in the air');assert.equal(both,0,'drawn once');assert.ok(moved<1e-6,'the body stays put: '+moved);assert.ok(top>4,'it climbs: '+top);
 assert.equal(W().entities[id].support.by,ana.entityId);assert.equal(W().entities[id].support.hand,hand0,'same kite, same hand');
 await tick(5);assert.equal(body(ana).human.activity,'idle');
 assert.match(JSON.stringify(edge.outcomes.read(b.receipt.id)),/Flew the kite low in the still air/);
 assert.deepEqual(f.host.engine.rt.violations,[]);
});

test('the words: closed, and a refusal says what to pick up',{timeout:300000},async t=>{
 const w=await kit(t),{ana,act,grab,named,edge}=w;
 const near=await act(ana,'fly the kite');assert.equal(near.code,'kite.no-kite');assert.match(JSON.stringify(near),/Pick up/);
 for(const words of ['fly to the moon','kite surfing','fly the balloon']){const r=await act(ana,words);assert.doesNotMatch(JSON.stringify(r),/kite\./,words);assert.notEqual(r.receipt?.capability?.split(':')[0],'kite',words);}
 await grab();
 for(const words of ['fly a kite for 30 seconds','please fly my kite','fly kite.']){const r=edge.resolve?.(ana,words);void r;}
 const b=await act(ana,'please fly my kite');assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.equal(b.receipt.capability,'kite:'+named('kite').id);
});

test('refused: the other hand full; the action not holding it, seated, mid-walk',{timeout:300000},async t=>{
 const w=await kit(t),{ana,ax,az,tick,act,place,named,grab,cap,f,W,edge,finish,body}=w;
 place([{op:'place',def:DEF,name:'loose',p:[ax+3,az+3]},{op:'place',def:'core/bench@1',name:'bench',p:[ax+1,az-2.5]},{op:'place',def:'core/table@1',name:'far',p:[ax-12,az+6]}]);await tick(30);
 const steps=item=>[{verb:'mars:kite_v1',params:{item,seconds:10}}];
 assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('loose').id)})?.code,'kite.not-held');
 await grab();
 const loose=W().entities[named('loose').id],keep=structuredClone(loose.support);loose.support={kind:'in-hand',by:ana.entityId,hand:'left'};
 assert.equal(edge.capabilities(ana).find(c=>c.id===cap())?.blocked?.code,'kite.hand-full');
 const full=await act(ana,cap());assert.equal(full.accepted,false);assert.match(JSON.stringify(full),/kite\.hand-full/);
 assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('kite').id)})?.code,'kite.hand-full');loose.support=keep;
 // at the Soul's level a seated Soul stands first, like every other hand act
 const sit=await act(ana,'sit:'+named('bench').id);assert.equal(sit.accepted,true,JSON.stringify(sit).slice(0,300));await tick(140);assert.equal(body(ana).human.activity,'sit');
 assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('kite').id)})?.code,'kite.not-still','the action refuses a seated body');
 const up=await act(ana,cap(),{seconds:5});assert.equal(up.accepted,true,JSON.stringify(up).slice(0,300));const r=await finish(ana,up);assert.equal(r.phase,'completed',JSON.stringify(r).slice(0,300));
 // mid-walk the action refuses
 const walk=await act(ana,'walk:far');assert.equal(walk.accepted,true);await tick(10);assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('kite').id)})?.code,'kite.not-still');await finish(ana,walk);
});

test('interrupted by a real walk: reeled in first, then she goes, the kite in hand; removed mid-flight: failed, nothing in the air',{timeout:300000},async t=>{
 const w=await kit(t),{ana,ax,az,tick,act,finish,receipt,until,named,body,grab,cap,W,place,f}=w;
 place([{op:'place',def:'core/table@1',name:'far-table',p:[ax-10,az+6]}]);await tick(30);await grab();
 let b=await act(ana,cap(),{seconds:60});assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.ok(await until(()=>flying(w,ana),800)>=0);await tick(120);
 assert.ok(kiteOut(body(ana).human.kiteV1,W().tick),'in the air');
 const p0=[...body(ana).pose.p],walk=await act(ana,'walk:far-table');assert.equal(walk.accepted,true,JSON.stringify(walk).slice(0,300));
 let n=0,movedDuring=false;for(;n<60&&flying(w,ana);n++){await tick(1);if(Math.hypot(body(ana).pose.p[0]-p0[0],body(ana).pose.p[2]-p0[2])>.02&&flying(w,ana))movedDuring=true;}
 assert.equal(flying(w,ana),undefined,`back in hand within 2 s (${n} ticks)`);assert.ok(n<=40,'within 2 s: '+n);assert.equal(movedDuring,false,'the body holds until the kite is in');
 assert.equal(receipt(ana,b).phase,'replaced','the receipt is honest');assert.equal(kiteOut(body(ana).human.kiteV1,W().tick),false,'nothing in the air');
 const r=await finish(ana,walk);assert.equal(r.phase,'completed',JSON.stringify(r).slice(0,300));assert.equal(W().entities[named('kite').id].support.by,ana.entityId,'the kite came along');
 // removed mid-flight
 b=await act(ana,cap(),{seconds:60});assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.ok(await until(()=>flying(w,ana),800)>=0);await tick(60);
 place([{op:'remove',id:named('kite').id}]);const gone=await finish(ana,b);assert.equal(gone.phase,'failed',JSON.stringify(gone).slice(0,300));
 await tick(5);console.log('DBG',JSON.stringify({s:body(ana).human.kiteV1,tick:W().tick,act:body(ana).human.activity,gone:JSON.stringify(gone).slice(0,260),hands:body(ana).human.hands,rec:f.host.engine.rt.holder('actor:'+ana.entityId).map(i=>f.host.engine.rt.records.get(i)?.verb)}));await tick(5);assert.equal(recordedKites({[ana.entityId]:{state:{kiteV1:body(ana).human.kiteV1},activity:body(ana).human.activity,p:body(ana).pose.p,yaw:body(ana).pose.yaw}},W().tick).kites.length,0,'nothing left in the air');await tick(10);assert.equal(body(ana).human.activity,'idle');
 assert.deepEqual(f.host.engine.rt.violations,[]);
});

test('placement turns: flies at 11 turns, out ahead of her facing; the height comes from the wind it started in',{timeout:600000},async t=>{
 const w=await kit(t),{ana,ax,az,tick,act,finish,grab,body,W,f}=w;await grab();const bad=[];
 await finish(ana,await act(ana,'put-down'));
 for(const [k,r] of TURNS.entries()){const x=ax+1.6*Math.cos(k),z=az+1.6*Math.sin(k),g=`kite-${k}`;w.place([{op:'place',def:DEF,name:g,p:[x,z],r}]);await tick(25);
  const pk=await act(ana,'pick-up:'+w.named(g).id);if(!pk.accepted||(await finish(ana,pk)).phase!=='completed'){bad.push([k,'pick-up',JSON.stringify(pk).slice(0,200)]);continue;}
  const b=await act(ana,'kite:'+w.named(g).id,{seconds:5});if(!b.accepted){bad.push([k,JSON.stringify(b).slice(0,200)]);continue;}
  let ahead=null;for(let n=0;n<600&&!['completed','failed','replaced','cancelled'].includes(w.receipt(ana,b)?.phase);n++){await tick(1);const s=body(ana).human.kiteV1,at=s&&kiteAt(s,W().tick,body(ana).pose.p,body(ana).pose.yaw);if(at&&W().tick-s.startTick===KITE.RAISE+KITE.CLIMB){const y=body(ana).pose.yaw;ahead=(at.p[0]-body(ana).pose.p[0])*Math.cos(y)+(at.p[2]-body(ana).pose.p[2])*Math.sin(y);}}
  if(w.receipt(ana,b)?.phase!=='completed')bad.push([k,w.receipt(ana,b)?.phase,w.receipt(ana,b)?.code]);if(!(ahead>KITE.NEAR-.5))bad.push([k,'not out ahead',ahead]);
  await finish(ana,await act(ana,'put-down'));await tick(10);}
 assert.deepEqual(bad,[],'every turn passes '+JSON.stringify(bad).slice(0,400));assert.deepEqual(f.host.engine.rt.violations,[],'no violation');
 // pure function of the record: 4 m in still air, 14 m in a full wind, within 0.5 m of the ground point; not by the world's wind now
 const s=(wind)=>({item:'i',hand:'right',startTick:0,at:[0,0],wind,flight:KITE.RAISE+KITE.CLIMB+400});
 for(const [wind,want] of [[0,4],[1,14]]){let lo=Infinity,hi=-Infinity;for(let tk=KITE.RAISE+KITE.CLIMB;tk<KITE.RAISE+KITE.CLIMB+300;tk++){const y=kiteAt(s(wind),tk,[0,0,0],0).p[1];lo=Math.min(lo,y);hi=Math.max(hi,y);}assert.ok(Math.abs((lo+hi)/2-want-.28)<.5,`wind ${wind}: ${lo}..${hi}, about ${want} m`);}
 assert.deepEqual(kiteAt({...s(.5),at:[1,2]},100,[1,0,2],.7),kiteAt({...s(.5),at:[1,2]},100,[1,0,2],.7),'the same record, the same place');assert.equal(kiteAt(s(.5),100,[1,0,2],.7),null,'a body forced off its spot has no kite up');
 assert.equal(kiteAt(s(.5),kiteTimes(s(.5)).down,[0,0,0],0),null,'in the hand once reeled in');assert.equal(kiteAt({...s(.5),endTick:50},60,[0,0,0],0),null,'ended means gone');
 assert.deepEqual(kiteHand(s(0),0,[0,0,0],0).length,3);
});

test('a restart mid-flight: never stuck, the kite held',{timeout:300000},async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const dir=mkdtempSync(join(tmpdir(),'kite-restart-'));let soul,id,receiptId;
 try{for(let boot=0;boot<2;boot++){
  const f=fixture(join(dir,'world.db'),factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
  installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
  const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
  const act=async(capability,params)=>(await accept(f.host,edge.act(soul,{capability,...(params?{params}:{})})));const W=()=>f.host.engine.world,me=()=>W().entities[soul.entityId];
  try{await tick();
   if(boot===0){await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Kite test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(10);
    const p=me().pose.p;assert.equal(god.act({ops:[{op:'place',def:DEF,name:'kite',p:[p[0]+.8,p[2]]}]}).accepted,true);await tick(30);id=[...god.model.entities.values()].find(e=>e.name==='kite').id;
    const pk=await act('pick-up:'+id);for(let n=0;n<400&&edge.receipt(soul.soulId,pk.receipt.id)?.phase!=='completed';n++)await tick(1);
    const b=await act('kite:'+id,{seconds:5});assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));receiptId=b.receipt.id;await tick(120);
   }else{for(let n=0;n<600&&f.host.engine.rt.holder('actor:'+soul.entityId).some(r=>f.host.engine.rt.records.get(r)?.verb==='kite_v1');n++)await tick(1);await tick(40);
    assert.equal(W().entities[id].support?.by,soul.entityId,'the kite held after the restart');assert.notEqual(me().human.activity,'kite','not stuck');assert.equal(kiteOut(me().human.kiteV1,W().tick),false,'nothing in the air');
    console.log(JSON.stringify({restart:{phase:edge.receipt(soul.soulId,receiptId)?.phase,code:edge.receipt(soul.soulId,receiptId)?.code}}));
   }
  }finally{comms.close();f.host.stop();f.db.close();}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('long tail: 100 distant kites and fliers cost nothing, one nearby is one line and one offer',{timeout:300000},async t=>{
 const w=await world(t),{souls:{Ana:ana},tick,here,place,body,act,finish,named,edge,W}=w;await tick(10);const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 const strip=h=>JSON.stringify(h).replace(/"(tick|t|at|now|time|clock)":[^,}]*/g,''),frame=h=>{const {doHere,doHereCoverage,...rest}=h;return JSON.stringify(rest).length;};
 const absent=await here(ana);
 place(Array.from({length:100},(_,i)=>({op:'place',def:DEF,name:`far-${i}`,p:[ax+120+i%10*3,az+120+Math.floor(i/10)*3]})));await tick(45);
 const far=await here(ana);assert.equal(strip(far),strip(absent),'100 distant kites add nothing');
 // injected: a distant body with a flight on its record reads the same
 const ghost=W().entities[named('far-0').id];void ghost;
 place([{op:'place',def:DEF,name:'kite',p:[ax+.8,az]}]);await tick(45);const near=await here(ana),added=frame(near)-frame(absent);assert.ok(added>0&&added<300,'one item line: '+added);
 const b=await act(ana,'pick-up:'+named('kite').id);await finish(ana,b);await tick(10);
 assert.equal(edge.capabilities(ana).filter(c=>c.verb==='fly-kite').length,1,'one offer');
 console.log(JSON.stringify({bytes:{absent:JSON.stringify(absent).length,far:JSON.stringify(far).length,added}}));
});
