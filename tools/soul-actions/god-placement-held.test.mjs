import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// #1066: a god's thing placed on a Soul never stops the clock, whatever the Soul is holding or doing.
async function world(t){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let current;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>current});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const logs=[],god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(m){logs.push(m);},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};await tick();
 const souls={};for(const name of ['Ana','Ben']){const id=name.toLowerCase();await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Placement test'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();}
 const W=()=>f.host.engine.world,body=s=>W().entities[s.entityId],named=n=>[...god.model.entities.values()].find(e=>e.name===n);
 const act=(s,capability,params)=>accept(f.host,edge.act(s,{capability,...(params?{params}:{})}));
 const until=async(c,l=1200)=>{for(let n=0;n<l;n++){if(c())return n;await tick(1);}return -1;};
 const finish=async(s,b)=>{assert.equal(b.accepted,true,JSON.stringify(b).slice(0,300));await until(()=>['completed','failed','cancelled','replaced'].includes(edge.receipt(s.soulId,b.receipt.id)?.phase));return edge.receipt(s.soulId,b.receipt.id);};
 return {f,edge,god,tick,souls,W,body,named,act,until,finish,logs};
}
for(const [label,cap,held] of [['resting, holding a bowl','rest:here',true],['dancing, holding a bowl','dance:here',true],['resting, empty-handed','rest:here',false],['idle, holding a bowl',null,true],['idle, empty-handed',null,false]]){
 test(`a table placed over a Soul ${label}: she is walked clear, the clock runs on, and no fault`,{timeout:120000},async t=>{
  const w=await world(t),{souls:{Ana:ana,Ben:ben},tick,god,body,W,act,finish,named,f,logs}=w;await tick(10);
  const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
  if(held){assert.equal(god.act({ops:[{op:'place',def:'core/bowl@2',name:'bowl',p:[ax+1,az]}]}).accepted,true);await tick(20);assert.equal((await finish(ana,await act(ana,'pick-up:'+named('bowl').id))).phase,'completed');await tick(10);}
  if(cap){const b=await act(ana,cap,{seconds:60});assert.equal(b.accepted,true,JSON.stringify(b).slice(0,200));await tick(30);assert.ok(f.host.engine.programOf(ana.entityId),'a program is running');}
  const [x,z]=[body(ana).pose.p[0],body(ana).pose.p[2]],before=W().tick;
  const placed=god.act({ops:[{op:'place',def:'core/table@1',name:'over-her',p:[x,z]}]});assert.equal(placed.accepted,true);
  await tick(40);
  assert.equal(f.host.paused,false,'the world did not pause');assert.equal(f.host.engineFault??null,null,'no engine fault');assert.deepEqual(f.host.engine.rt.violations,[],'no violation');assert.ok(W().tick-before>=40);
  const [nx,nz]=[body(ana).pose.p[0],body(ana).pose.p[2]],away=Math.hypot(nx-x,nz-z);assert.ok(away>.4,`she is clear of the top: ${away}`);
  assert.ok(logs.some(l=>/Ana .*(out of the god's way|open ground)/.test(l)),'and told why: '+JSON.stringify(logs.slice(-3)));
  if(held){const bowl=W().entities[named('bowl').id];assert.ok(['in-hand','ground'].includes(bowl.support?.kind),JSON.stringify(bowl.support));}
  // unrelated Souls still act, and so does she
  assert.equal((await finish(ben,await act(ben,'wave:here'))).phase,'completed');assert.equal((await finish(ana,await act(ana,'wave:here'))).phase,'completed');
 });
}
test('other fixtures and turns, a move as well as a place: no fault at any of them',{timeout:300000},async t=>{
 const w=await world(t),{souls:{Ana:ana},tick,god,body,W,act,finish,named,f}=w;await tick(10);
 const go=async(x,z)=>{await accept(f.host,f.host.enqueue('edge-relocate','edge:'+ana.soulId,{soulId:ana.soulId,entityId:ana.entityId,to:[x,z],why:'test placement'}));await tick(6);};
 const holding=()=>Object.values(W().entities).some(e=>e.support?.kind==='in-hand'&&e.support.by===ana.entityId);
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];let k=0;
 const ready=async(x,z)=>{await go(x,z);if(!holding()){const n=`bowl-${k}`;assert.equal(god.act({ops:[{op:'place',def:'core/bowl@2',name:n,p:[x+1,z]}]}).accepted,true);await tick(20);const p=await finish(ana,await act(ana,'pick-up:'+named(n).id));assert.equal(p.phase,'completed',JSON.stringify(p).slice(0,300));await tick(10);}
  const rest=await act(ana,'rest:here',{seconds:60});assert.equal(rest.accepted,true);await tick(20);assert.ok(f.host.engine.programOf(ana.entityId));return [body(ana).pose.p[0],body(ana).pose.p[2]];};
 for(const def of ['core/table@1','core/bench@1','core/lockers@3','core/drawer-chest@2'])for(const r of [0,.785,2.356]){
  const [bx,bz]=await ready(ax-9+(k%4)*6,az-9+Math.floor(k/4)*6);k++;
  assert.equal(god.act({ops:[{op:'place',def,name:`f${k}`,p:[bx,bz],r}]}).accepted,true,def);await tick(30);
  assert.equal(f.host.paused,false,`${def} r=${r}: not paused`);assert.deepEqual(f.host.engine.rt.violations,[],`${def} r=${r}`);
 }
 // a table moved over her, from nearby
 assert.equal(god.act({ops:[{op:'place',def:'core/table@1',name:'mover',p:[ax-4,az-16]}]}).accepted,true);await tick(10);
 const [mx,mz]=await ready(ax,az-16);assert.equal(god.act({ops:[{op:'move',id:named('mover').id,p:[mx,mz]}]}).accepted,true);await tick(30);
 assert.equal(f.host.paused,false,'a move: not paused');assert.deepEqual(f.host.engine.rt.violations,[]);
});
