import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// #442: things break and a Soul repairs them with a tool in her hand. All of it is def data: `components.repairable`, state
// `broken`, a `tool-<name>` tag. The world changes when the receipt completes, so an interrupted repair leaves it broken.
const out=process.env.SOUL_ACTIONS_OUT;
const BENCH='core/bench@2',HAMMER='core/hammer@1',TURNS=[0,.4,.785,1.2,1.571,1.9,2.356,2.9,3.7,4.712,5.5];
async function world(t,names=['Ana']){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let current;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>current});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};await tick();
 const souls={};for(const name of names){const id=name.toLowerCase();await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Repair test'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();}
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
const strip=h=>JSON.stringify(h).replace(/"(tick|t|at|now|time|clock)":[^,}]*/g,'');
const refused=b=>JSON.stringify(b);

test('repair: broken, perceived, refused without the tool, repaired with it',{timeout:300000},async t=>{
 const w=await world(t,['Ana','Ben']),{souls:{Ana:ana,Ben:ben},tick,body,here,act,finish,place,named,edge,god,f}=w,report={status:'running'};
 await tick(10);const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 // long tail: absent, then 100 broken benches far off
 const absent=await here(ana);
 place(Array.from({length:100},(_,i)=>({op:'place',def:BENCH,name:`far-${i}`,p:[ax+120+i%10*3,az+120+Math.floor(i/10)*3],state:{broken:true}})));await tick(45);
 const far=await here(ana);assert.equal(strip(far),strip(absent),'100 distant broken benches add nothing');report.hereAbsent=JSON.stringify(absent).length;report.hereFar=JSON.stringify(far).length;
 // a whole bench@2 nearby reads the same as a bench@1 nearby, in another run of the same spot
 place([{op:'place',def:'core/bench@1',name:'old',p:[ax+3,az+2]}]);await tick(45);const nearOld=await here(ana);
 place([{op:'remove',id:named('old').id},{op:'place',def:BENCH,name:'old',p:[ax+3,az+2]}]);await tick(45);const nearNew=await here(ana);
 const norm=h=>strip(h).replace(/[a-z]_[a-z0-9]{6,}/gi,'ID');
 report.hereOld=JSON.stringify(nearOld).length;report.hereWhole=JSON.stringify(nearNew).length;
 assert.equal(report.hereWhole,report.hereOld,'a whole bench@2 costs what a bench@1 does: '+norm(nearNew).slice(0,300));
 assert.equal(edge.capabilities(ana).filter(c=>/:repair$/.test(c.id)).length,0,'a whole bench has no repair offer');
 const whole=await act(ana,'repair the old');assert.equal(whole.accepted,false);assert.match(refused(whole),/repair\.not-broken/,'a whole one is refused by words: '+refused(whole).slice(0,200));
 assert.equal((await act(ana,'sit:'+named('old').id)).accepted,true,'a whole bench can be sat on');await tick(120);assert.equal(f.host.engine.bodyUsesV1(named('old').id)?.body,ana.entityId);
 // the creator breaks it under her: she stays, repair refused while she sits
 place([{op:'set',id:named('old').id,state:{broken:true}}]);await tick(40);
 assert.equal(f.host.engine.bodyUsesV1(named('old').id)?.body,ana.entityId,'seated stays seated');
 const under=await act(ana,'repair the old');assert.equal(under.accepted,false);assert.match(refused(under),/no-tool|occupied/);
 assert.equal((await act(ana,'stand:here')).accepted,true);await tick(40);
 const bench=named('old').id,cap=`object:${bench}:repair`;
 // perceived: the fact and the offer, nearby only
 const near=await here(ana);report.hereBroken=JSON.stringify(near).length;
 const row=near.objects?.find(o=>o.id===bench);assert.equal(row?.state?.broken,'a cracked slat','the nearby fact says what is broken: '+JSON.stringify(row));
 const offer=edge.capabilities(ana).find(c=>c.id===cap);assert.ok(offer,'the repair offer is there');assert.equal(offer.available,false,'unavailable without the tool');assert.match(offer.blocked?.code??'',/repair\.no-tool/);
 // seat refused, by offer and by words
 const sit=edge.capabilities(ana).find(c=>c.id==='sit:'+bench);assert.equal(sit?.blocked?.code,'seat.broken',JSON.stringify(sit));
 const sat=await act(ana,'sit:'+bench);assert.equal(sat.accepted,false);assert.match(refused(sat),/seat\.broken/);
 // refused: no tool (names what to get), the wrong tool, the other hand full
 const none=await act(ana,cap);assert.equal(none.accepted,false);assert.match(refused(none),/repair\.no-tool/);assert.match(refused(none),/no hammer within reach/,refused(none).slice(0,300));
 place([{op:'place',def:HAMMER,name:'hammer',p:[ax+1,az]},{op:'place',def:'core/bowl@2',name:'bowl',p:[ax+1,az+1]}]);await tick(20);
 const hint=await act(ana,cap);assert.match(refused(hint),/Pick up hammer first/,refused(hint).slice(0,300));
 const got=async id=>{const b=await act(ana,'pick-up:'+id);assert.equal(b.accepted,true,refused(b).slice(0,300));assert.equal((await finish(ana,b)).phase,'completed');};
 await got(named('bowl').id);
 const wrong=await act(ana,cap);assert.equal(wrong.accepted,false);assert.match(refused(wrong),/repair\.wrong-tool/);
 const putb=await act(ana,'put-down');await finish(ana,putb);
 await got(named('hammer').id);
 const ham=named('hammer').id,hand0=w.W().entities[ham].support.hand;
 // the act: nothing before completion, hand reaches the work, body still, same hammer in the same hand
 const b=await act(ana,cap);assert.equal(b.accepted,true,refused(b).slice(0,300));
 let working=null,lowest=Infinity,moved=0,early=false,strokes=0,was=null;
 const job=()=>w.f.host.engine.rt.holder('actor:'+ana.entityId).map(id=>w.f.host.engine.rt.records.get(id)).find(r=>r?.verb==='repair_v1');
 for(let n=0;n<1600&&w.receipt(ana,b)?.phase!=='completed';n++){await tick(1);
  if(w.receipt(ana,b)&&['failed','replaced','cancelled'].includes(w.receipt(ana,b).phase))break;
  const r=job();if(r){working??=[...body(ana).pose.p];moved=Math.max(moved,Math.hypot(body(ana).pose.p[0]-working[0],body(ana).pose.p[2]-working[2]));
   const h=body(ana).human.hands?.[hand0];const target=r.params?.hand??r.p?.hand;
   if(h&&target){const d=Math.hypot(h[0]-target[0],h[1]-target[1],h[2]-target[2]);lowest=Math.min(lowest,d);const low=d<.03;if(low&&was===false)strokes++;was=low;}
   if(god.model.get('old').state?.broken!==true)early=true;}
 }
 const end=w.receipt(ana,b);assert.equal(end.phase,'completed',JSON.stringify(end).slice(0,400));
 assert.ok(working,'repair_v1 ran');assert.equal(early,false,'nothing changes before completion');assert.ok(moved<.05,'the body stays put: '+moved);
 assert.ok(lowest<.1,'the hand reaches the work: '+lowest);assert.equal(strokes,7,'the hand comes in, then six strokes land');report.strokesSeen=strokes;
 await tick(2);assert.equal(named('old').state.broken,false,'repaired on completion');
 assert.equal(w.W().entities[ham].support.by,ana.entityId);assert.equal(w.W().entities[ham].support.hand,hand0,'same hammer in the same hand');
 await tick(10);assert.notEqual(body(ana).human.activity,'reach','the body is back to idle');
 assert.match(JSON.stringify(end),/Repaired: it is whole again/,JSON.stringify(end).slice(0,400));
 // perceived after: no fact, no offer, the seat works
 await tick(45);const after=await here(ana);assert.equal(after.objects?.find(o=>o.id===bench)?.state?.broken,undefined);assert.equal(edge.capabilities(ana).filter(c=>c.id===cap).length,0,'no offer once whole');
 assert.equal(edge.capabilities(ben).find(c=>c.id==='sit:'+bench)?.blocked?.code,undefined,'the seat is open again');
 assert.deepEqual(f.host.engine.rt.violations,[],'no violation');
 report.status='pass';if(out){mkdirSync(out,{recursive:true});writeFileSync(out+'/repair-native.json',JSON.stringify(report,null,1));}console.log(JSON.stringify(report));
});

const working=(w,s)=>w.f.host.engine.rt.holder('actor:'+s.entityId).map(id=>w.f.host.engine.rt.records.get(id)).find(r=>r?.verb==='repair_v1');
async function kit(t,names=['Ana'],bench={}){
 const w=await world(t,names),{souls,tick,body,place,named,act,finish}=w;await tick(10);const ana=souls[names[0]],[ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 place([{op:'place',def:BENCH,name:'bench',p:[ax+2,az-1.5],state:{broken:true},...bench},{op:'place',def:HAMMER,name:'hammer',p:[ax+.8,az]}]);await tick(30);
 const grab=async(s=ana,tool='hammer')=>{const b=await act(s,'pick-up:'+named(tool).id);assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.equal((await finish(s,b)).phase,'completed');};
 return {...w,ana,ax,az,grab,cap:()=>`object:${named('bench').id}:repair`};
}

test('interrupted by a real walk: the hand comes back first, the bench stays broken, the hammer goes along',{timeout:300000},async t=>{
 const w=await kit(t),{ana,ax,az,tick,act,finish,receipt,until,named,body,grab,cap,W,place,f}=w;
 place([{op:'place',def:'core/table@1',name:'far-table',p:[ax-10,az+6]}]);await tick(30);await grab();
 const b=await act(ana,cap());assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.ok(await until(()=>working(w,ana),800)>=0,'the work started');await tick(30);
 const p0=[...body(ana).pose.p],walk=await act(ana,'walk:far-table');assert.equal(walk.accepted,true,JSON.stringify(walk).slice(0,300));
 let n=0,movedDuring=false;for(;n<40&&working(w,ana);n++){await tick(1);if(Math.hypot(body(ana).pose.p[0]-p0[0],body(ana).pose.p[2]-p0[2])>.02&&working(w,ana))movedDuring=true;}
 assert.equal(working(w,ana),undefined,`the hand is back within 2 s (${n} ticks)`);assert.equal(movedDuring,false,'the body holds until the hand is back');
 assert.equal(receipt(ana,b).phase,'replaced','the receipt is honest');assert.equal(named('bench').state.broken,true,'still broken');
 assert.equal(W().entities[named('hammer').id].support.by,ana.entityId);
 const r=await finish(ana,walk);assert.equal(r.phase,'completed',JSON.stringify(r).slice(0,300));assert.equal(W().entities[named('hammer').id].support.by,ana.entityId,'the hammer came along');
 assert.deepEqual(f.host.engine.rt.violations,[]);
});

test('the creator moves or removes it mid-repair: failed, the hammer in hand; two Souls at one bench: whole once, nobody stuck',{timeout:300000},async t=>{
 const w=await kit(t,['Ana','Ben']),{souls:{Ana:ana,Ben:ben},tick,act,finish,until,named,place,grab,cap,W,relocate,ax,az,f}=w;await grab();
 let b=await act(ana,cap());assert.ok(await until(()=>working(w,ana),800)>=0);await tick(20);
 place([{op:'move',id:named('bench').id,p:[ax+6,az+6]}]);let r=await finish(ana,b);assert.equal(r.phase,'failed',JSON.stringify(r).slice(0,300));assert.match(JSON.stringify(r),/repair\.target-moved/);assert.equal(named('bench').state.broken,true);
 assert.equal(W().entities[named('hammer').id].support.by,ana.entityId);
 await tick(20);b=await act(ana,cap());assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.ok(await until(()=>working(w,ana),800)>=0);await tick(20);
 place([{op:'remove',id:named('bench').id}]);r=await finish(ana,b);assert.notEqual(r.phase,'completed',JSON.stringify(r).slice(0,300));assert.equal(W().entities[named('hammer').id].support.by,ana.entityId);
 await tick(20);place([{op:'place',def:BENCH,name:'bench',p:[ax+2,az-1.5],state:{broken:true}},{op:'place',def:HAMMER,name:'hammer2',p:[ax+1.2,az+.8]}]);await tick(30);
 await relocate(ben,ax+1.2,az+2.6);const pb=await act(ben,'pick-up:'+named('hammer2').id);const rp=await finish(ben,pb);assert.equal(rp.phase,'completed',JSON.stringify(rp).slice(0,400));
 const a1=await act(ana,cap()),b1=await act(ben,cap());assert.equal(a1.accepted,true,JSON.stringify(a1).slice(0,300));
 const ra=await finish(ana,a1);assert.equal(ra.phase,'completed',JSON.stringify(ra).slice(0,300));await tick(2);assert.equal(named('bench').state.broken,false,'whole');
 const rb=b1.accepted?await finish(ben,b1):null;console.log(JSON.stringify({two:{ana:ra.phase,ben:rb?{phase:rb.phase,code:rb.code}:{refused:b1.code}}}));
 await tick(20);assert.notEqual(w.body(ben).human.activity,'reach','Ben is not stuck');assert.deepEqual(f.host.engine.rt.violations,[]);
});

test('refused: the engine\'s own checks, the other hand full, no room to stand',{timeout:300000},async t=>{
 const w=await kit(t),{ana,ax,az,tick,act,place,named,grab,cap,f,body,god,W}=w;await grab();
 const steps=(item,hand)=>[{verb:'mars:repair_v1',params:{item,target:named('bench').id,face:0,hand,strokes:2,lift:.1,motion:'strike'}}];
 assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('hammer').id,[body(ana).pose.p[0]+5,.5,body(ana).pose.p[2]])})?.code,'repair.too-far');
 place([{op:'place',def:HAMMER,name:'loose',p:[ax+3,az+3]}]);await tick(20);
 assert.equal(f.host.engine.canPerform({actor:ana.entityId,label:'x',steps:steps(named('loose').id,[body(ana).pose.p[0]+.3,.5,body(ana).pose.p[2]])})?.code,'repair.not-held');
 // the other hand full: injected, since a Soul's pick-up takes the right hand
 const loose=W().entities[named('loose').id],keep=structuredClone(loose.support);loose.support={kind:'in-hand',by:ana.entityId,hand:'left'};
 const full=await act(ana,cap());assert.equal(full.accepted,false);assert.match(JSON.stringify(full),/repair\.hand-full/);loose.support=keep;
 // no room: something solid at each stand point
 const wp=god.model.worldPose(named('bench'));
 place([{op:'place',def:'core/table@1',name:'in-the-way',p:[wp.x,wp.z+.85]}]);await tick(30);
 const room=await act(ana,cap());assert.equal(room.accepted,false,JSON.stringify(room).slice(0,200));assert.match(JSON.stringify(room),/repair\.no-room/,JSON.stringify(room).slice(0,300));
 assert.equal(named('bench').state.broken,true);
});

test('placement turns: repair completes at 11 turns and the hand reaches the work; a fixture dropped on the worker doesn\'t fault',{timeout:600000},async t=>{
 const w=await world(t),{souls:{Ana:ana},tick,act,finish,place,named,relocate,body,until,god,f}=w;await tick(10);
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]],bad=[];
 let k=0;
 place([{op:'place',def:HAMMER,name:'h',p:[ax+.8,az]}]);await tick(20);
 const pick=await act(ana,'pick-up:'+named('h').id);assert.equal((await finish(ana,pick)).phase,'completed');
 for(const r of TURNS){const x=ax+8+(k%4)*7,z=az+6+Math.floor(k/4)*7,g=`bench-${k}`;await relocate(ana,x-2,z-2);
  place([{op:'place',def:BENCH,name:g,p:[x,z],r,state:{broken:true}}]);await tick(25);
  const id=named(g).id,b=await act(ana,`object:${id}:repair`);if(!b.accepted){bad.push([g,JSON.stringify(b).slice(0,200)]);k++;continue;}
  let low=Infinity;for(let n=0;n<1000&&!['completed','failed','replaced','cancelled'].includes(w.receipt(ana,b)?.phase);n++){await tick(1);const rec=working(w,ana),hh=body(ana).human.hands?.right,tg=rec?.params?.hand;if(hh&&tg)low=Math.min(low,Math.hypot(hh[0]-tg[0],hh[1]-tg[1],hh[2]-tg[2]));}
  const end=w.receipt(ana,b);await tick(2);
  if(end?.phase!=='completed')bad.push([g,end?.phase,end?.code,end?.reason]);
  if(named(g).state.broken!==false)bad.push([g,'still broken']);
  if(!(low<.1))bad.push([g,'hand never reached',low]);
  // the contact stays on the slat in world terms at any turn
  const def=god.model.resolvedDef(named(g).def),wp=god.model.worldPose(named(g)),c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[lx,,lz]=def.components.repairable.hand,want=[wp.x+lx*c+lz*s,wp.z-lx*s+lz*c];
  const hp=[...body(ana).pose.p];const face=Math.hypot(hp[0]-want[0],hp[2]-want[1]);if(face>1.1)bad.push([g,'stood too far',face]);
  k++;}
 assert.deepEqual(bad,[],'every turn passes');assert.deepEqual(f.host.engine.rt.violations,[],'no violation');
 // a fixture dropped on the worker (#1066's class): no recovered fault, a defined end
 const x=ax-9,z=az-8;await relocate(ana,x-2,z-2);place([{op:'place',def:BENCH,name:'last',p:[x,z],state:{broken:true}}]);await tick(25);
 const b=await act(ana,`object:${named('last').id}:repair`);assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));assert.ok(await until(()=>working(w,ana),800)>=0,JSON.stringify(w.receipt(ana,b)).slice(0,300));await tick(20);
 const at=body(ana).pose.p;place([{op:'place',def:'core/table@1',name:'dropped',p:[at[0],at[2]]}]);await tick(60);
 console.log(JSON.stringify({dropped:{phase:w.receipt(ana,b)?.phase,code:w.receipt(ana,b)?.code,paused:f.host.engine.paused??null}}));
 assert.deepEqual(f.host.engine.rt.violations,[],'no violation after the drop');assert.equal(w.W().entities[named('h').id].support?.by,ana.entityId,'the hammer is still in hand');
});

test('second case, data only: a flat tyre on a cart, pumped up with a pump, through the same action',{timeout:300000},async t=>{
 const w=await world(t),{souls:{Ana:ana},tick,act,finish,place,named,relocate,body,god,edge}=w;await tick(10);
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 place([{op:'place',def:'core/cart@2',name:'cart',p:[ax+3,az+3],r:.6,state:{broken:true}},{op:'place',def:'core/tyre-pump@1',name:'pump',p:[ax+.8,az]},{op:'place',def:HAMMER,name:'hammer',p:[ax-.8,az]}]);await tick(30);
 const id=named('cart').id,cap=`object:${id}:repair`;
 assert.match(JSON.stringify(edge.capabilities(ana).find(c=>c.id===cap)),/Pump up the flat tyre/);
 const h=await act(ana,'pick-up:'+named('hammer').id);await finish(ana,h);const wrong=await act(ana,cap);assert.equal(wrong.accepted,false);assert.match(JSON.stringify(wrong),/repair\.wrong-tool/,'a hammer does not pump a tyre');
 const dn=await act(ana,'put-down');await finish(ana,dn);
 const p=await act(ana,'pick-up:'+named('pump').id);assert.equal((await finish(ana,p)).phase,'completed');
 const b=await act(ana,'pump up the flat tyre');assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));
 let motion=null;for(let n=0;n<1000&&w.receipt(ana,b)?.phase!=='completed';n++){await tick(1);motion??=working(w,ana)?.params?.motion;if(['failed','replaced'].includes(w.receipt(ana,b)?.phase))break;}
 assert.equal(w.receipt(ana,b).phase,'completed',JSON.stringify(w.receipt(ana,b)).slice(0,300));assert.equal(motion,'pump','the pump\'s own motion');await tick(2);assert.equal(named('cart').state.broken,false);
 // no code names a repairable def: only the data file does
 for(const file of ['apps/server/src/god/mending.ts','mars/viewer/engine/items/repair.ts']){const src=readFileSync(new URL('../../'+file,import.meta.url),'utf8');assert.doesNotMatch(src,/\b(?:bench|cart|hammer|tyre)\b/i,file+' names no def');}
 void relocate;void god;
});

test('a restart mid-repair: never stuck, the hammer held; a repair survives a restart; a broken bench stays broken',{timeout:300000},async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const dir=mkdtempSync(join(tmpdir(),'repair-restart-'));let soul,ham,bench,receiptId;
 try{for(let boot=0;boot<3;boot++){
  const f=fixture(join(dir,'world.db'),factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
  installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
  const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
  const act=async(capability,params)=>(await accept(f.host,edge.act(soul,{capability,...(params?{params}:{})})));const W=()=>f.host.engine.world,me=()=>W().entities[soul.entityId];
  try{await tick();
   if(boot===0){await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Repair test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(10);
    const p=me().pose.p;assert.equal(god.act({ops:[{op:'place',def:BENCH,name:'bench',p:[p[0]+2,p[2]-1.5],state:{broken:true}},{op:'place',def:HAMMER,name:'hammer',p:[p[0]+.8,p[2]]}]}).accepted,true);await tick(30);
    ham=[...god.model.entities.values()].find(e=>e.name==='hammer').id;bench=[...god.model.entities.values()].find(e=>e.name==='bench').id;
    const pk=await act('pick-up:'+ham);for(let n=0;n<400&&edge.receipt(soul.soulId,pk.receipt.id)?.phase!=='completed';n++)await tick(1);
    const b=await act(`object:${bench}:repair`);assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));receiptId=b.receipt.id;
    for(let n=0;n<400&&!f.host.engine.rt.holder('actor:'+soul.entityId).some(id=>f.host.engine.rt.records.get(id)?.verb==='repair_v1');n++)await tick(1);await tick(20);
    assert.equal(god.model.get('bench').state.broken,true,'broken while she works');
   }else if(boot===1){
    for(let n=0;n<400&&f.host.engine.rt.holder('actor:'+soul.entityId).some(id=>f.host.engine.rt.records.get(id)?.verb==='repair_v1');n++)await tick(1);await tick(40);
    assert.equal(W().entities[ham].support?.by,soul.entityId,'the hammer held after the restart');assert.notEqual(me().human.activity,'reach','not stuck');
    const end=edge.receipt(soul.soulId,receiptId),state=god.model.get('bench').state.broken;console.log(JSON.stringify({restart:{phase:end?.phase,code:end?.code,broken:state}}));
    assert.equal(state,end?.phase!=='completed','the bench agrees with the receipt');
    if(end?.phase!=='completed'){const b=await act(`object:${bench}:repair`);assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));for(let n=0;n<600&&edge.receipt(soul.soulId,b.receipt.id)?.phase!=='completed';n++)await tick(1);await tick(2);assert.equal(god.model.get('bench').state.broken,false);}
   }else{await tick(20);assert.equal(god.model.get('bench').state.broken,false,'repaired stays repaired across a restart');}
  }finally{comms.close();f.host.stop();f.db.close();}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
