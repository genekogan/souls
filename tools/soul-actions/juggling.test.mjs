import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {writeFileSync,mkdirSync} from 'node:fs';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {JUGGLE,juggleBalls,juggleBallsOut,juggleHand,juggleThrows,juggleTimes} from '../../mars/viewer/engine/items/juggle.ts';
import {recordedJuggles} from '../../mars/viewer/app/engine-view/recorded-games.ts';
import {makeWay} from '../../mars/viewer/engine/locomotion/walk.ts';

// #441 (W107): juggling three balls with real custody. The set is one held item before, during and after; the cascade is a
// pure function of the recorded run and the tick; a stop lets what is in the air land; 100 distant sets cost nothing.
const out=process.env.SOUL_ACTIONS_OUT;
const DEF='core/juggling-balls@1',TURNS=[0,.4,.785,1.2,1.571,1.9,2.356,2.9,3.7,4.712,5.5];

async function world(t,names=['Ana']){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let current;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>current});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};await tick();
 const souls={};for(const name of names){const id=name.toLowerCase();await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Juggling test'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();}
 const W=()=>f.host.engine.world,body=s=>W().entities[s.entityId],named=n=>[...god.model.entities.values()].find(e=>e.name===n);
 const here=async s=>{current=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const act=(s,capability,params)=>accept(f.host,edge.act(s,{capability,...(params?{params}:{})}));
 const receipt=(s,b)=>edge.receipt(s.soulId,b.receipt.id);
 const ended=(s,b)=>['completed','failed','cancelled','replaced'].includes(receipt(s,b)?.phase);
 const until=async(cond,limit=2400)=>{for(let n=0;n<limit;n++){if(cond())return n;await tick(1);}return -1;};
 const finish=async(s,b)=>{assert.ok(await until(()=>ended(s,b))>=0,'the receipt ends');return receipt(s,b);};
 const place=ops=>{const r=god.act({ops});assert.equal(r.accepted,true,JSON.stringify(r.failures?.slice(0,3)));};
 return {f,edge,god,tick,souls,W,body,named,here,act,receipt,until,finish,place};
}

test('the cascade is a pure function of the record: three balls, each thrown from one palm and caught by the other',()=>{
 const s={item:'set',hand:'right',startTick:100,throws:9},p=[3,0,-2],yaw=.7,T=juggleTimes(s);
 assert.equal(juggleBallsOut(s,100+JUGGLE.RAISE-JUGGLE.PART-1),false,'whole before it parts');
 assert.equal(juggleBallsOut(s,100+JUGGLE.RAISE-JUGGLE.PART),true);
 assert.equal(juggleBallsOut(s,100+T.gathered-1),true);assert.equal(juggleBallsOut(s,100+T.gathered),false,'whole once gathered');
 assert.equal(juggleBalls(s,100+T.gathered,p,yaw),null);
 let top=-Infinity,maxStep=0,prev=null,maxHandStep=0,prevHands=null;
 for(let t=JUGGLE.RAISE-JUGGLE.PART;t<T.gathered;t+=.25){
  const b=juggleBalls(s,100+t,p,yaw);assert.equal(b.length,3);for(const q of b)top=Math.max(top,q[1]);
  if(prev)for(let i=0;i<3;i++)maxStep=Math.max(maxStep,Math.hypot(b[i][0]-prev[i][0],b[i][1]-prev[i][1],b[i][2]-prev[i][2]));prev=b;
 }
 for(let t=0;t<T.end;t+=.25){const h=['left','right'].map(x=>juggleHand(s,x,100+t,p,yaw));if(prevHands)for(let i=0;i<2;i++)maxHandStep=Math.max(maxHandStep,Math.hypot(h[i][0]-prevHands[i][0],h[i][1]-prevHands[i][1],h[i][2]-prevHands[i][2]));prevHands=h;}
 assert.ok(top>1.45&&top<1.85,`the arc tops out about head height: ${top}`);
 assert.ok(maxStep<.2,`no ball jumps between quarter ticks: ${maxStep}`);
 assert.ok(maxHandStep<.08,`no hand jumps between quarter ticks: ${maxHandStep}`);
 // every ball is at a hand at its throw and its catch
 for(const k of [0,1,2,3,4,5]){const by=k%2?'left':'right',to=k%2?'right':'left',at=JUGGLE.RAISE+JUGGLE.BEAT*k,ball=k%3;
  const thrown=juggleBalls(s,100+at,p,yaw)[ball],hand=juggleHand(s,by,100+at,p,yaw);assert.ok(Math.hypot(thrown[0]-hand[0],thrown[2]-hand[2])<.03,`throw ${k} leaves ${by}`);
  const caught=juggleBalls(s,100+at+JUGGLE.FLIGHT,p,yaw)[ball],catcher=juggleHand(s,to,100+at+JUGGLE.FLIGHT,p,yaw);assert.ok(Math.hypot(caught[0]-catcher[0],caught[1]-catcher[1]-.045,caught[2]-catcher[2])<.08,`throw ${k} lands in ${to}`);}
});

test('the viewer draws what the record says: three balls or the whole set, never both, and nothing for a body without a run',()=>{
 const s={item:'set',hand:'right',startTick:100,throws:6},T=juggleTimes(s),ents=st=>({a:{p:[1,0,2],yaw:.3,state:st},b:{p:[9,0,9],yaw:0,state:{}}});
 for(const [at,out] of [[100,false],[100+JUGGLE.RAISE-JUGGLE.PART,true],[100+T.lastCatch,true],[100+T.gathered,false],[100+T.end,false]]){
  const {balls,sets}=recordedJuggles(ents({juggleV1:s}),at);assert.equal(balls.length,out?3:0,String(at));assert.equal(sets.has('set'),out,String(at));}
 assert.equal(recordedJuggles(ents({juggleV1:{...s,endTick:100+20}}),100+21).balls.length,0,'a run that ended draws nothing');
 assert.deepEqual(recordedJuggles(ents({juggleV1:{...s,colors:['#111111','#222222','#333333']}}),100+20).balls.map(b=>b.color),['#111111','#222222','#333333']);
});

test('juggling: effect, custody, offers, refusals, stop, and nothing for the far away',{timeout:600000},async t=>{
 const w=await world(t,['Ana','Ben']),{souls:{Ana:ana,Ben:ben},tick,body,here,act,finish,place,named,edge,W}=w,sz=x=>Buffer.byteLength(JSON.stringify(x));
 await tick(10);const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 const report={status:'fail',hereBytes:{},checks:[]};
 // long tail: absent, then 100 sets 100+ m away, then 100 distant bodies juggling
 const absent=await here(ben),absentAna=await here(ana);report.hereBytes.absent=sz(absent);
 const distant=[];for(let i=0;i<100;i++)distant.push({op:'place',def:DEF,name:`far-${i}`,p:[ax+150+i%10*2,az+150+Math.floor(i/10)*2]});
 for(let i=0;i<distant.length;i+=50)place(distant.slice(i,i+50));await tick(30);
 const far=await here(ben);report.hereBytes.far100=sz(far);assert.equal(sz(far),sz(absent),'100 distant sets add nothing');
 assert.ok(!/juggl/i.test(JSON.stringify(far)),'no distant juggling words');
 const ents=W().entities;for(let i=0;i<100;i++){const id=`farb_${i}`,e=structuredClone(body(ben));e.id=id;e.label=`Far ${i}`;delete e.human.task;ents[id]=e;e.pose.p=[ax+150+i%10*3,0,az-150-Math.floor(i/10)*3];e.human.activity='juggle';e.human.juggleV1={item:`far-${i}`,hand:'right',startTick:W().tick,throws:300};}
 await tick(5);const farJ=await here(ben);report.hereBytes.farJuggling100=sz(farJ);assert.equal(sz(farJ),sz(absent),'100 distant bodies juggling add nothing');
 for(let i=0;i<100;i++)delete ents[`farb_${i}`];await tick(2);

 // refused: nothing to juggle, nothing near
 const none=await act(ana,'juggle');assert.equal(none.accepted,false);assert.equal(none.code,'juggle.no-balls',JSON.stringify(none).slice(0,300));assert.match(none.reason,/no juggling balls within reach/);
 // the set near, not held: words say what to pick up, and no juggle offer exists
 place([{op:'place',def:DEF,name:'set',p:[ax+1.2,az]},{op:'place',def:'core/bowl@2',name:'bowl',p:[ax+1.2,az+.6]}]);await tick(30);
 const set=named('set').id,bowl=named('bowl').id;
 const offers=s=>edge.capabilities(s).filter(c=>c.verb==='juggle');
 const near=await here(ana);assert.deepEqual(offers(ana),[],'no offer until held');assert.ok(edge.capabilities(ana).some(c=>c.id==='pick-up:'+set));
 const notHeld=await act(ana,'juggle the balls');assert.equal(notHeld.accepted,false);assert.equal(notHeld.code,'juggle.no-balls');assert.match(notHeld.reason,/pick-up:/);
 // effect: pick up, juggle by words, the receipt, custody all along
 assert.equal((await finish(ana,await act(ana,'pick-up:'+set))).phase,'completed');
 assert.equal(W().entities[set].support.by,ana.entityId);const hand=W().entities[set].support.hand;
 assert.deepEqual(offers(ana).map(c=>[c.id,c.available]),[['juggle:'+set,true]],'one offer while held');assert.deepEqual(offers(ben),[],'and to nobody else');
 const heldHere=await here(ana);report.nearBytes=sz(heldHere)-sz(absentAna);assert.ok(report.nearBytes<500,`bounded nearby detail: ${report.nearBytes}`);
 assert.equal(body(ana).human.juggleV1,undefined,'no record on a body that has not juggled');
 const before=[...body(ana).pose.p],start=W().tick,b=await act(ana,'juggle',{seconds:5});assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));
 let sawJuggle=false,custody=true,moved=0,balls=0;
 const done=await w.until(()=>{const e=W().entities[set],h=body(ana).human;custody&&=e.support?.kind==='in-hand'&&e.support.by===ana.entityId&&e.support.hand===hand;moved=Math.max(moved,Math.hypot(body(ana).pose.p[0]-before[0],body(ana).pose.p[2]-before[2]));if(h.activity==='juggle')sawJuggle=true;const s=h.juggleV1;if(s&&juggleBallsOut(s,W().tick)&&s.endTick===undefined){const q=juggleBalls(s,W().tick,body(ana).pose.p,body(ana).pose.yaw);balls=Math.max(balls,q.length);}return ['completed','failed','cancelled','replaced'].includes(w.receipt(ana,b)?.phase);});
 assert.ok(done>=0);const r=w.receipt(ana,b);assert.equal(r.phase,'completed',JSON.stringify(r).slice(0,400));
 assert.ok(sawJuggle);assert.ok(custody,'the set never left the hand');assert.ok(moved<.05,`the body stayed: ${moved}`);assert.equal(balls,3);
 assert.equal(body(ana).human.activity,'idle');assert.equal(body(ana).human.juggleV1.throws,15,'5 s is 15 throws');
 assert.equal(W().entities[set].support.by,ana.entityId);
 const ended=W().tick;assert.ok(ended-start>=juggleTimes(body(ana).human.juggleV1).end&&ended-start<juggleTimes(body(ana).human.juggleV1).end+40,'as long as its timeline');
 assert.match(edge.outcomes.read(r.id)?.summary??'',/Juggled 15 throws/);
 // perceived: nearby Ben sees her juggling
 const again=await act(ana,'juggle:'+set,{seconds:60});assert.equal(again.accepted,true);await w.until(()=>body(ana).human.activity==='juggle');await tick(30);
 await accept(w.f.host,w.f.host.enqueue('edge-relocate','edge:'+ben.soulId,{soulId:ben.soulId,entityId:ben.entityId,to:[ax,az+3],why:'test placement'}));await tick(6);
 const seen=await here(ben);assert.equal(seen.near.find(s=>s.name==='Ana').doing,'juggle','a nearby Soul sees it');
 // nobody's make-way moves a juggler
 const rt=w.f.host.engine.rt,yards=rt.records.size;
 makeWay(rt,ana.entityId,[body(ana).pose.p[0]+.2,body(ana).pose.p[2]]);await tick(5);
 assert.equal(rt.records.size,yards,'no make-way walk was started');assert.equal(body(ana).human.activity,'juggle');
 // interrupted by a real walk: the balls land, then she goes, the set in hand; the receipt is honest
 place([{op:'place',def:'core/table@1',name:'far-table',p:[ax+9,az+1]},{op:'place',def:'core/bowl@2',name:'far-table-bowl',in:{parent:'far-table',slot:'top'},p:[-.3,0]}]);await tick(20);
 const s0=body(ana).human.juggleV1,p0=[...body(ana).pose.p],tStop=W().tick,walk=await act(ana,'walk:far-table');assert.equal(walk.accepted,true,JSON.stringify(walk).slice(0,300));
 let movedAt=-1,gatheredAt=-1;
 for(let n=0;n<300&&(movedAt<0||gatheredAt<0);n++){const h=body(ana).human,now=W().tick;if(gatheredAt<0&&!juggleBallsOut(h.juggleV1,now))gatheredAt=now-tStop;if(movedAt<0&&Math.hypot(body(ana).pose.p[0]-p0[0],body(ana).pose.p[2]-p0[2])>.001)movedAt=now-tStop;await tick(1);}
 assert.ok(gatheredAt>=0&&gatheredAt<=30,`in hand within 1.5 s: ${gatheredAt} ticks`);assert.ok(movedAt>=gatheredAt,`the body stays until the balls are in hand: moved at ${movedAt}, gathered at ${gatheredAt}`);
 assert.equal(w.receipt(ana,again).phase,'replaced');assert.ok(body(ana).human.juggleV1.throws<s0.throws,'the run was shortened');
 assert.equal((await finish(ana,walk)).phase,'completed','the walk that interrupted went ahead');assert.equal(W().entities[set].support.by,ana.entityId,'the set came along');
 // the same with an item act and with a second run: they wait for the landing and then happen
 await tick(10);const r1=await act(ana,'juggle:'+set,{seconds:60});await w.until(()=>body(ana).human.activity==='juggle',200);await tick(40);
 const r2=await act(ana,'juggle:'+set,{seconds:1});assert.equal(r2.accepted,true,JSON.stringify(r2).slice(0,300));assert.equal((await finish(ana,r2)).phase,'completed',JSON.stringify(w.receipt(ana,r2)).slice(0,300));assert.equal(w.receipt(ana,r1).phase,'replaced');
 const r3=await act(ana,'juggle:'+set,{seconds:60});await w.until(()=>body(ana).human.activity==='juggle',200);await tick(40);
 const r4=await act(ana,'put-on:'+named('far-table').id);assert.equal(r4.accepted,true,JSON.stringify(r4).slice(0,300));assert.equal((await finish(ana,r4)).phase,'completed',JSON.stringify(w.receipt(ana,r4)).slice(0,300));assert.equal(w.receipt(ana,r3).phase,'replaced');
 assert.notEqual(W().entities[set].support?.kind,'in-hand');
 // words: only these words are juggling; the duration is honoured
 assert.equal((await finish(ana,await act(ana,'pick-up:'+named('far-table-bowl').id))).phase,'completed');await tick(10);
 const other=await act(ana,'juggle');assert.equal(other.code,'juggle.no-balls');assert.match(other.reason,/Put it down first/);assert.doesNotMatch(other.reason,/not holding anything/);
 assert.equal((await finish(ana,await act(ana,'put-on:'+named('far-table').id))).phase,'completed');await tick(10);
 assert.equal((await finish(ana,await act(ana,'pick-up:'+set))).phase,'completed');await tick(10);
 const knives=await act(ana,'juggle the knives');assert.notEqual(body(ana).human.activity,'juggle');assert.equal(knives.accepted,false,JSON.stringify(knives).slice(0,200));
 const three=await act(ana,'juggle for 3 seconds');assert.equal(three.accepted,true,JSON.stringify(three).slice(0,200));assert.equal((await finish(ana,three)).phase,'completed');assert.equal(body(ana).human.juggleV1.throws,juggleThrows(3));
 place([{op:'place',def:'core/table@1',name:'juggling-yard',p:[ax-8,az+1]}]);await tick(20);
 const yard=await act(ana,'juggling yard');assert.notEqual(yard.code,'juggle.no-balls','a thing named for it is not these words');
 await w.until(()=>['completed','failed','replaced','cancelled'].includes(yard.receipt?w.receipt(ana,yard)?.phase:'completed'),600);await tick(20);
 // seated or lying: she stands up first, as every hand act here does; the engine itself refuses (below)
 for(const pose of ['sit-ground:here','lie:here']){const sat=await act(ana,pose,{seconds:60});assert.equal(sat.accepted,true);await w.until(()=>body(ana).human.activity!=='idle',200);await tick(30);
  const up=await finish(ana,await act(ana,'juggle:'+set,{seconds:1}));assert.equal(up.phase,'completed',pose+JSON.stringify(up).slice(0,300));assert.equal(body(ana).human.activity,'idle');await tick(10);}
 // refused at the engine, nothing moved: not held, seated, lying, mid-walk, the other hand holding something
 const refused=(p,code)=>{const r=rt.submit('juggle_v1',{actor:ana.entityId,seconds:5,...p});assert.equal(r.status,'failed',code);assert.equal(r.diagnostic.code,code);};
 refused({item:bowl},'juggle.not-held');
 for(const pose of ['sit-ground:here','lie:here']){const sat=await act(ana,pose,{seconds:60});await w.until(()=>body(ana).human.activity!=='idle',200);await tick(30);refused({item:set},'juggle.not-still');assert.ok(sat.accepted);await finish(ana,await act(ana,'stand:here'));await tick(20);}
 const goes=await act(ana,'walk:juggling-yard');assert.equal(goes.accepted,true);assert.ok(await w.until(()=>body(ana).human.activity==='walk',100)>=0,'she is walking');refused({item:set},'juggle.not-still');await finish(ana,goes);await tick(10);
 await accept(w.f.host,w.f.host.enqueue('edge-relocate','edge:'+ana.soulId,{soulId:ana.soulId,entityId:ana.entityId,to:[ax,az+.6],why:'test placement'}));await tick(10);
 const left=rt.submit('take_item',{actor:ana.entityId,item:bowl,hand:'left'});assert.notEqual(left.status,'failed',JSON.stringify(left).slice(0,300));assert.ok(await w.until(()=>W().entities[bowl].support?.kind==='in-hand',400)>=0,JSON.stringify(rt.records.get(left.id)?.diagnostic??left).slice(0,300));await tick(40);
 const blockedOffer=offers(ana)[0];assert.equal(blockedOffer.available,false);assert.equal(blockedOffer.blocked.code,'juggle.hand-full');
 refused({item:set},'juggle.hand-full');const noHand=await act(ana,'juggle');assert.equal(noHand.accepted,false);assert.equal(noHand.code,'juggle.hand-full',JSON.stringify(noHand).slice(0,300));
 assert.deepEqual(rt.violations,[],'no violation in the whole run');
 report.status='pass';if(out){mkdirSync(out,{recursive:true});writeFileSync(out+'/juggling-native.json',JSON.stringify(report,null,1));}
 console.log(JSON.stringify(report));
});

test('placement turns: picks up, juggles and puts back at 11 turns, on the ground and on a turned table',{timeout:600000},async t=>{
 const w=await world(t),{souls:{Ana:ana},tick,body,finish,place,named,edge}=w;await tick(10);
 const {act}=w;
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]],bad=[];
 const run=async(label,set,back)=>{
  const go=async(what,cap,params)=>{const b=await act(ana,cap,params);if(!b.accepted){bad.push([label,what,JSON.stringify(b).slice(0,300)]);return false;}const r=await finish(ana,b);if(r.phase!=='completed'){bad.push([label,what,r.phase,JSON.stringify(r.failure??r.reason??r.outcome??r).slice(0,200)]);return false;}return true;};
  if(!await go('pick','pick-up:'+set))return;await go('juggle','juggle:'+set,{seconds:1});await go('put',back());
  await tick(20);
 };
 let k=0;
 const go=async(x,z)=>{await accept(w.f.host,w.f.host.enqueue('edge-relocate','edge:'+ana.soulId,{soulId:ana.soulId,entityId:ana.entityId,to:[x,z],why:'test placement'}));await tick(6);};
 for(const r of TURNS){const x=ax+6+(k%4)*7,z=az+6+Math.floor(k/4)*7,g=`ground-${k}`,tb=`table-${k}`,on=`on-${k}`;
  await go(x-1.4,z);place([{op:'place',def:DEF,name:g,p:[x,z],r}]);await tick(20);
  await run(g,named(g).id,()=>'put-down');
  await go(x-1.4,z+3);place([{op:'place',def:'core/table@1',name:tb,p:[x,z+3],r},{op:'place',def:DEF,name:on,in:{parent:tb,slot:'top'},p:[.1,0],r}]);await tick(20);
  await run(tb,named(on).id,()=>'put-on:'+named(tb).id);
  k++;}
 assert.deepEqual(bad,[],'every turn passes');assert.deepEqual(w.f.host.engine.rt.violations,[],'and no violation');
 // another palette through the def's params: the same action, the balls in its own colours; nothing in code names an instance
 await go(ax-2,az);place([{op:'place',def:DEF,name:'blue',p:[ax-1,az],params:{one:'#102030',two:'#203040',three:'#304050'}}]);await tick(20);
 const blue=named('blue').id;assert.equal((await finish(ana,await act(ana,'pick-up:'+blue))).phase,'completed');
 const j=await act(ana,'juggle:'+blue,{seconds:1});await w.until(()=>body(ana).human.juggleV1?.item===blue,100);
 assert.deepEqual(body(ana).human.juggleV1.colors,['#102030','#203040','#304050']);assert.equal((await finish(ana,j)).phase,'completed');
 assert.equal(edge.capabilities(ana).find(c=>c.verb==='juggle').id,'juggle:'+blue);
});

test('a restart mid-juggle leaves a defined state: the set held, the body juggling on or idle, never stuck',{timeout:300000},async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const dir=mkdtempSync(join(tmpdir(),'juggle-restart-'));let soul,set;
 try{for(let boot=0;boot<2;boot++){
  const f=fixture(join(dir,'world.db'),factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
  const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
  const act=async(capability,params)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));return r.json();};
  try{await tick();
   if(!boot){await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Juggling test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(10);
    const b=f.host.engine.world.entities[soul.entityId];assert.equal(god.act({ops:[{op:'place',def:DEF,name:'set',p:[b.pose.p[0]+1,b.pose.p[2]]}]}).accepted,true);await tick(20);
    set=[...god.model.entities.values()].find(e=>e.name==='set').id;const p=await act('pick-up:'+set);for(let n=0;n<400&&edge.receipt(soul.soulId,p.receipt.id)?.phase!=='completed';n++)await tick(1);
    const j=await act('juggle:'+set,{seconds:30});assert.equal(j.accepted,true);for(let n=0;n<200&&f.host.engine.world.entities[soul.entityId].human.activity!=='juggle';n++)await tick(1);await tick(60);assert.equal(f.host.engine.world.entities[soul.entityId].human.activity,'juggle');
   }else{const W=()=>f.host.engine.world;for(let n=0;n<900&&W().entities[soul.entityId].human.activity==='juggle';n++)await tick(1);
    assert.notEqual(W().entities[soul.entityId].human.activity,'juggle','not stuck');assert.equal(W().entities[set].support?.kind,'in-hand');assert.equal(W().entities[set].support.by,soul.entityId);
   }
  }finally{comms.close();f.host.stop();f.db.close();}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
