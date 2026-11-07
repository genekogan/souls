import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {coreRef} from '@souls/world-compiler';
import {GodNav, type NavHost, type Thing} from './nav.ts';
import {fixture, invite, accept, factory} from '../../test/native-owner-fixture.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {HumanState} from '../../../../mars/viewer/engine/world/types.ts';

type V2 = [number, number];
function targetFixture() {
  let points = [{id:'work',at:[0,0] as V2,level:0}];
  let reachable = (_:V2) => true, displace = (p:V2) => p;
  const engine={world:{tick:0,entities:{}},standableNearV1:(p:V2)=>displace(p),reachV1:(_from:unknown,to:{p:V2})=>({ok:reachable(to.p)})};
  const nav=new GodNav({model:{entities:new Map(),ground:()=>({waters:[]}),editSeq:0},engine,
    levelAt:()=>0,engineOwned:()=>false,serviceStandingPoints:()=>points} as unknown as NavHost);
  const room:Thing={ref:'room',id:'room',name:'Room',kind:'room',what:'room',words:[],at:[0,0],level:0,poly:[[-3,-3],[3,-3],[3,3],[-3,3]],entry:{p:[0,-4],level:0}};
  return {nav,room,engine,setPoints:(p:typeof points)=>points=p,setReach:(r:typeof reachable)=>reachable=r,setDisplace:(f:typeof displace)=>displace=f};
}

test('generic room arrival leaves a service point clear, but explicit stand targets retain it',()=>{
  const f=targetFixture(),goal=f.nav.goal(f.room,[0,-5]);
  assert.ok(goal);assert.ok(Math.hypot(...goal.p)>=.7);
  const explicit={...f.room,ref:'instrument',kind:'thing' as const,poly:undefined,stands:[[0,0] as V2]};
  assert.deepEqual(f.nav.goal(explicit,[0,-5])?.p,[0,0]);
});

test('no reachable alternative preserves the old reachable goal; displaced candidates are rechecked',()=>{
  const f=targetFixture();f.setReach(p=>Math.hypot(...p)<.01);
  assert.deepEqual(f.nav.goal(f.room,[0,-5])?.p,[0,0]);
  const g=targetFixture();g.setDisplace(()=>[0,0]);
  assert.deepEqual(g.nav.goal(g.room,[0,-5])?.p,[0,0],'native refinement back onto the station is not accepted as an alternative');
});

test('work geometry invalidates cached goals, and another floor does not reserve this one',()=>{
  const f=targetFixture();f.setPoints([]);assert.deepEqual(f.nav.goal(f.room,[0,-5])?.p,[0,0]);
  f.setPoints([{id:'work',at:[0,0],level:0}]);assert.ok(Math.hypot(...f.nav.goal(f.room,[0,-5])!.p)>=.7,'same-tick cached centre is reconsidered');
  f.setPoints([{id:'work',at:[0,0],level:1}]);assert.deepEqual(f.nav.goal(f.room,[0,-5])?.p,[0,0]);
});

test('native public pavilion arrivals keep the actual authored violin usable under five-body occupancy', {timeout:60000},async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
  const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}}),edge=new EdgeLedger(f.host,f.db);
  const bridge=installEngineBridge({host:f.host,god,edge,log(){},worldClock:false,worldLore:false});
  t.after(()=>{f.brain.quiesce();f.host.stop();edge.comms?.close();f.db.close();});
  const tick=async(n=4)=>{for(let i=0;i<n;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}};await tick();
  const violin={schema:'def/1',name:'test-violin',version:1,tags:['music','violin'],form:'point',layer:'solid',size:{box:[.5,1.2,.4]},make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'cyl',at:[0,.55,0],r:.01,h:1.1,color:'#222222',collide:false}]}},components:{},slots:[]};
  const built=god.act({ops:[{op:'define',def:violin},{op:'place',def:coreRef('pavilion'),name:'concert-room',p:[10,-10]},{op:'place',def:'test-violin@1',name:'violin',p:[9.1,-9.4],r:2.4}]} as never) as {accepted:boolean};assert.equal(built.accepted,true);await tick(8);
  // Native bodies/writeback legitimately add engine-owned entities and revision
  // counters; compare the authored physical state, not the whole live world.
  const authored=()=>{const s=god.model.snapshot();return {entities:s.entities.filter(e=>e.by==='god'),defs:s.defs.filter(d=>!d.tags.includes('body')),ground:s.ground};};
  const snapshotBefore=structuredClone(authored()),bodies:EdgeSoul[]=[];
  for(let i=0;i<5;i++){const owner='visitor-'+i;await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:'Visitor'+i,description:'native fixture'}));bodies.push({soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner});await tick(3);}
  const service=bridge.activitySpots.serviceStandingPoints().find(p=>p.id.startsWith('play-music.'));assert.ok(service);
  const originalServices=bridge.activitySpots.serviceStandingPoints();
  const act=async(soul:typeof bodies[number],capability:string,params={})=>{
    const ack=await accept(f.host,edge.act(soul,{capability,params}));assert.equal(ack.accepted,true,JSON.stringify(ack));
    let receipt=edge.receipt(soul.soulId,ack.receipt!.id);
    for(let i=0;i<2400&&['waiting','started'].includes(receipt!.phase);i++){await tick(1);receipt=edge.receipt(soul.soulId,ack.receipt!.id);}
    assert.equal(receipt!.phase,'completed',JSON.stringify(receipt));return receipt;
  };
  for(const soul of bodies.slice(1)){
    await act(soul,'walk:concert-room');const p=f.host.engine.world.entities[soul.entityId]!.pose.p;
    assert.ok(Math.hypot(p[0]-service.at[0],p[2]-service.at[1])>=.7,`visitor occupies work point: ${p}`);
  }
  assert.equal(bridge.activitySpots.serviceStandingPoints(),originalServices,'body occupancy does not change service geometry identity');
  const performer=bodies[0],instrument=god.model.get('violin')!;
  const music=edge.capabilities(performer).find(c=>c.id===`play-music:play-music.${instrument.id}`);assert.equal(music?.available,true,'same actual instrument remains offered after all public arrivals');
  const ack=await accept(f.host,edge.act(performer,{capability:music!.id,params:{seconds:40}}));assert.equal(ack.accepted,true,JSON.stringify(ack));
  let heldTicks=0,maxHeld=0;
  for(let i=0;i<2200;i++){await tick(1);const b=f.host.engine.world.entities[performer.entityId]!,human=b.human as HumanState|undefined;heldTicks=human?.activity==='play-music'&&human.instrument==='violin'?heldTicks+1:0;maxHeld=Math.max(maxHeld,heldTicks);const r=edge.receipt(performer.soulId,ack.receipt!.id);if(r?.phase==='completed')break;}
  assert.ok(maxHeld>=600,`actual play-music/violin lasts >=30 native seconds (${maxHeld} ticks)`);
  assert.deepEqual(f.host.engine.runtime.violations,[]);
  assert.deepEqual(authored(),snapshotBefore,'visitor target selection did not edit authored compiler geometry');
});
