import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {inPoly} from '../edge/ledger/places.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';
import {coreRef} from '@souls/world-compiler';
import {outdoorRegionExclusions} from '../edge/ledger/region-arrival.ts';
import {GodNav,type Thing} from './nav.ts';

test('walk to the native field leaves Chiba instead of completing inside its parent region', {timeout:120000}, async t=>{
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);
 const edge=new EdgeLedger(w.host,w.db);const bridge=installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const settle=async(n=3)=>{for(let i=0;i<n;i++){w.host.tickOnce();await setImmediate();w.host.drainInputs();}};
 await settle();
 const placed=god.act({ops:[{op:'place',def:'core/mars-chiba@2',name:'chiba',p:[-14.643,0,-28.174],r:-1.431}]});assert.equal(placed.accepted,true,JSON.stringify(placed));await settle();
 await invite(w,'walker');const row=await accept(w.host,w.souls.create('dev:walker',{name:'Walker',description:'A local test walker'})) as {id:string;entity_id:string;name:string;owner:string};
 const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await settle();
 await accept(w.host,w.host.enqueue('edge-relocate','test:field',{...soul,to:[-14.6,-28.2],why:'reproduce field completion inside Chiba'}));await settle();
 const body=()=>w.host.engine.world.entities[soul.entityId] as unknown as {pose:{p:[number,number,number]};human:{level:number}};
 bridge.perceive.sync(true);edge.map();const chiba=edge.places.byId.get('g-chiba')!;assert.ok(chiba);assert.ok(inPoly(body().pose.p[0],body().pose.p[2],chiba.polygon));
 const start=[...body().pose.p];
 const r=await accept(w.host,Promise.resolve(edge.act(soul,{capability:'walk:field'}))) as {accepted:boolean;receipt:{id:string}};assert.equal(r.accepted,true,JSON.stringify(r));
 let ended=false;
 for(let i=0;i<1800;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}const phase=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(phase==='completed'){ended=true;break;}assert.notEqual(phase,'failed');}
 assert.equal(ended,true,'native walk should complete');
 assert.ok(Math.hypot(body().pose.p[0]-start[0],body().pose.p[2]-start[2])>2,`must actually leave Chiba: ${body().pose.p}`);
 assert.equal(inPoly(body().pose.p[0],body().pose.p[2],chiba.polygon),false,'completion is outside the building');assert.equal(body().human.level,0);
 const open=[...body().pose.p];const again=await accept(w.host,Promise.resolve(edge.act(soul,{capability:'walk:field'}))) as {accepted:boolean;receipt:{id:string}};assert.equal(again.accepted,true);await settle(30);assert.equal(edge.receipt(soul.soulId,again.receipt.id)?.phase,'completed');assert.deepEqual(body().pose.p,open,'already in the open field remains a no-op');
});

test('native field and authored coextensive field both leave Pavilion and retain genuine outdoor no-ops', {timeout:120000}, async t=>{
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);
 const edge=new EdgeLedger(w.host,w.db);const bridge=installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const settle=async(n=3)=>{for(let i=0;i<n;i++){w.host.tickOnce();await setImmediate();w.host.drainInputs();}};
 await settle();
 const area:[number,number][]=[[-30,-30],[30,-30],[30,30],[-30,30]];
 const placed=god.act({ops:[
  {op:'place',def:coreRef('lawn'),name:'mown-lawn',shape:{area}},
  {op:'place',def:coreRef('zone'),name:'place-field',shape:{area},params:{use:'park'},about:{title:'Commons Field',kind:'district',role:'district'}},
  {op:'place',def:coreRef('pavilion'),name:'pavilion',p:[9,0,-5],params:{w:6,d:4}},
 ]});assert.equal(placed.accepted,true,JSON.stringify(placed));await settle();
 await invite(w,'field-walker');const row=await accept(w.host,w.souls.create('dev:field-walker',{name:'Field Walker',description:'A native outdoor arrival regression'})) as {id:string;entity_id:string;name:string;owner:string};
 const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await settle();
 const authored=JSON.stringify(fixturePose(god));
 const body=()=>w.host.engine.world.entities[soul.entityId] as unknown as {pose:{p:[number,number,number]};human:{level:number}};
 const act=async(capability:string)=>{
  const r=await accept(w.host,edge.act(soul,{capability}));assert.equal(r.accepted,true,JSON.stringify(r));if(!r.accepted)throw Error('native action refused');
  for(let i=0;i<1800;i++){w.host.tickOnce();if(i%10===0){await setImmediate();w.host.drainInputs();}const receipt=edge.receipt(soul.soulId,r.receipt.id);if(receipt?.phase==='completed')return receipt;assert.notEqual(receipt?.phase,'failed',JSON.stringify(receipt));}
  throw Error('native action did not complete');
 };
 bridge.perceive.sync(true);edge.map();
 const field=edge.places.byId.get('field')!,peer=edge.places.byId.get('g-place-field')!,pavilion=edge.places.byId.get('g-pavilion')!;
 assert.ok(field&&peer&&pavilion);assert.deepEqual(peer.polygon,field.polygon);
 assert.notEqual(pavilion.parent,'field','coextensive derived peer receives the building parent');
 const ancestors=new Set<string>();for(let id=pavilion.parent;id&&!ancestors.has(id);id=edge.places.byId.get(id)?.parent??null)ancestors.add(id);
 assert.equal(ancestors.has('field'),false,'regression must not accidentally test the old ancestry-only mask');
 assert.ok(outdoorRegionExclusions(edge.places,'field')!.some(poly=>inPoly(9,-5,poly)));
 for(const capability of ['walk:field','walk:place-field']){
  await act('walk:pavilion');assert.equal(edge.placePathOf(soul.soulId)[0].id,'g-pavilion.pavilion','explicit indoor target still enters the actual room');
  const start=[...body().pose.p],r=await act(capability);
  assert.equal((r.chosen as {place:string}).place,capability==='walk:field'?'field':'g-place-field');
  assert.equal(inPoly(body().pose.p[0],body().pose.p[2],pavilion.polygon),false,`${capability} must leave Pavilion: ${body().pose.p}`);
  assert.equal(inPoly(body().pose.p[0],body().pose.p[2],field.polygon),true,'arrive inside field, not an outside fallback');assert.equal(body().human.level,0);
  assert.ok(Math.hypot(body().pose.p[0]-start[0],body().pose.p[2]-start[2])>1);
  const open=[...body().pose.p];await act(capability);assert.deepEqual(body().pose.p,open,'already genuinely outdoors stays in place');
 }
 assert.equal(JSON.stringify(fixturePose(god)),authored,'authored fixture geometry is unchanged');
 assert.deepEqual(w.host.engine.runtime.violations,[]);
});

function fixturePose(god:GodMode){return ['mown-lawn','place-field','pavilion'].map(name=>{const e=god.model.get(name)!;return{name,p:e.p,shape:e.shape};});}

test('outdoor area search rejects displaced standing points inside an interior and stays bounded',()=>{
 let calls=0;
 const nav=new GodNav({model:{} as never,engineOwned:()=>false,levelAt:()=>0,
  engine:{world:{tick:0,entities:{}},standableNearV1(){calls++;return[0,0];}},
  outdoorRegionExclusions:()=>[[[-2,-2],[2,-2],[2,2],[-2,2]]],
 });
 const area:Thing={id:'area',ref:'area',name:'Area',kind:'area',words:[],what:'an outdoor area',at:[0,0],level:0,area:[[-10,-10],[10,-10],[10,10],[-10,10]]};
 assert.equal(nav.goal(area,[0,0],'body'),null,'standing search cannot turn an outdoor seed back into interior success');
 assert.ok(calls<=35,`bounded standing searches: ${calls}`);
});

test('main-ground adjustment cannot turn a valid outdoor point into interior completion',()=>{
 const nav=new GodNav({model:{} as never,engineOwned:()=>false,levelAt:()=>0,
  engine:{world:{tick:0,entities:{}},standableNearV1:p=>p,navWarmV1:()=>true,navCheckV1:()=>[{ok:false}],navNearestMainV1:()=>[0,0]},
  outdoorRegionExclusions:()=>[[[-2,-2],[2,-2],[2,2],[-2,2]]],
 });
 const area:Thing={id:'area',ref:'area',name:'Area',kind:'area',words:[],what:'an outdoor area',at:[0,0],level:0,area:[[-10,-10],[10,-10],[10,10],[-10,10]]};
 assert.equal(nav.goal(area,[5,5],'body'),null,'no excluded original or main-ground fallback is retained');
});
