import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {writeFileSync} from 'node:fs';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {routeFrame} from '../edge/perception/route.ts';
import {resolvedParts} from '../edge/intents/resolved-parts.ts';
import {GroundHost} from './ground-host.ts';

test('resolve exposes a real distant bound seat and exact selection reaches it; description invents no action',{timeout:120000},async t=>{
 const w=fixture(':memory:',factory,{durableClockV1:true});w.brain.quiesce();
 const god=new GodMode(w.db,{worldId:w.host.worldId,ownerId:'owner',tick:()=>w.host.engine.world.tick,emit(){}});
 new GroundHost(w.db,w.host,god);const edge=new EdgeLedger(w.host,w.db);
 const bridge=installEngineBridge({host:w.host,god,edge,log(){},worldClock:false,worldLore:false});
 t.after(()=>{w.brain.quiesce();w.host.stop();edge.comms?.close();w.db.close();});
 const settle=async(n=3)=>{for(let i=0;i<n;i++){w.host.tickOnce();await setImmediate();w.host.drainInputs();}};await settle();
 const built=god.act({ops:[{op:'place',def:'core/plaza@1',name:'music-stage',shape:{area:[[30,30],[35,30],[35,35],[30,35]]},about:{title:'Music Stage',what:'Live music and community performances.',kind:'stage'}},{op:'place',def:'core/plaza@1',name:'west-pier',shape:{area:[[-5,130],[5,130],[5,150],[-5,150]]}},{op:'place',def:'core/plaza@1',name:'private-room',shape:{area:[[-4,140],[4,140],[4,150],[-4,150]]}},{op:'place',def:'core/bench@1',name:'pier-bench',in:{parent:'private-room'},p:[0,145]}]});assert.equal(built.accepted,true,JSON.stringify(built));await settle();
 const bench=god.model.get('private-room/pier-bench')!,slot=god.model.slotsOf(bench).find(s=>s.kind==='seat')!;
 const labeled=god.act({ops:[{op:'set',id:'west-pier',about:{title:'Harbour West Pier',aliases:['west pier'],parts:[{id:'sea-view-seat',title:'Sea-View Bench',anchor:{kind:'entity',ref:'private-room/pier-bench',slot:slot.id}},{id:'sunset',title:'Sunset view'},{id:'gallery',title:'Unreachable gallery',anchor:{kind:'local',point:[0,10,0],stand:[0,10,0],level:9}}]}}]});assert.equal(labeled.accepted,true,JSON.stringify(labeled));await settle();
 for(let start=0;start<125;start+=25){const noise=god.act({ops:Array.from({length:25},(_,j)=>({op:'place',def:'core/bench@1',name:`noise-${start+j}`,p:[20+((start+j)%13)*2,-20-Math.floor((start+j)/13)*2]}))});assert.equal(noise.accepted,true,JSON.stringify(noise));await settle();}
 await invite(w,'walker');const row=await accept(w.host,w.souls.create('dev:walker',{name:'Walker',description:'Local discovery test'})) as {id:string;entity_id:string;name:string;owner:string};
 const soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await settle();
 await accept(w.host,w.host.enqueue('edge-relocate','test:parts',{...soul,to:[0,0],why:'far discovery'}));await settle();bridge.perceive.sync(true);edge.map();
 const exact='sit:west-pier/part-sea-view-seat';assert.equal(edge.coreA.binds(soul).caps.some(c=>c.id===exact),false,'far part omitted from compact listing');
 const out=edge.intents.dryRun(soul,{capability:'go to the harbour and sit on the west pier'}) as any;
 assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.would.capability,'walk:west-pier','discovery does not choose seat for agent');
 const part=out.would.parts.find((p:any)=>p.id==='sea-view-seat');assert.equal(part.target.entity,bench.id);assert.equal(part.target.slot,slot.id);assert.equal(part.affordances.find((a:any)=>a.capability===exact).available,true);
 // #849: the seat named by its own words ("sea view bench") is the only one, so it is taken; the place alone is still a choice
 const named=edge.intents.dryRun(soul,{capability:'sit at the sea view bench on the west pier'}) as any;assert.equal(named.ok,true,JSON.stringify(named));assert.equal(named.would.capability,exact);assert.match(named.would.resolved,/^The only seat these words name is Sea-View Bench .*; it was taken\.$/);
 for(const query of ['sit on the harbour west pier','take a seat at the west pier']){const d=edge.intents.dryRun(soul,{capability:query}) as any;assert.equal(d.code,'capability.choose',JSON.stringify(d));assert.deepEqual(d.did_you_mean.map((c:any)=>c.id),[exact]);assert.equal(d.did_you_mean[0].target.entity,bench.id);}
 const choose=await edge.act(soul,{capability:'sit on the harbour west pier'});assert.equal(choose.accepted,false,'natural discovery asks agent to choose; no action is silently issued');
 assert.equal((edge.intents.dryRun(soul,{capability:'sit at the west pier sunset view'}) as any).did_you_mean.length,0,'descriptive part is not a seat');
 assert.equal(out.would.parts.find((p:any)=>p.id==='sunset').affordances,undefined);assert.equal(out.would.parts.find((p:any)=>p.id==='gallery').affordances[0].available,false);
 assert.equal(edge.knowledge.setSecret('g-west-pier',true),true);
 assert.deepEqual(resolvedParts(edge,soul,'walk:west-pier'),{});
 const hidden=edge.resolveOnDemand(soul,exact,[],new Map()).v;assert.equal(hidden.kind,'unknown','explicit far seat cannot reveal an unknown secret owner');
 edge.knowledge.setSecret('g-west-pier',false);
 assert.equal(edge.knowledge.setSecret('g-private-room',true),true);
 assert.ok(!(resolvedParts(edge,soul,'walk:west-pier') as any).parts.some((p:any)=>p.id==='sea-view-seat'),'secret ancestor hides its bound descendant');
 assert.equal(edge.resolveOnDemand(soul,exact,[],new Map()).v.kind,'unknown','secret descendant cannot be admitted on demand');
 assert.equal((edge.intents.dryRun(soul,{capability:exact.replace('sit:','walk:')}) as any).ok,false,'exact part walk cannot bypass secret ancestor');
 assert.equal(edge.resolveOnDemand(soul,exact,[{id:exact,verb:'sit',label:'stale public offer',available:true,target:{kind:'object',id:bench.id}}],new Map()).v.kind,'unknown','a stale exact object offer cannot bypass ancestor privacy');
 edge.knowledge.setSecret('g-private-room',false);
 const invented='walk:west-pier/part-missing';assert.equal((edge.intents.dryRun(soul,{capability:invented}) as any).ok,false);assert.equal((await edge.act(soul,{capability:invented})).accepted,false,'unknown qualified refs stay refused');
 const music=routeFrame(edge,soul,'live music') as any;assert.equal(music.kind,'purpose');assert.equal(music.candidates[0].capability,'walk:music-stage');assert.equal(music.candidates[0].available,true);assert.equal((routeFrame(edge,soul,'live music missing') as any).found,false);
 edge.knowledge.setSecret('g-music-stage',true);assert.equal((routeFrame(edge,soul,'live music') as any).found,false);edge.knowledge.setSecret('g-music-stage',false);
 const route=routeFrame(edge,soul,'sea view bench') as any;assert.equal(route.reachable,true,JSON.stringify(route));assert.equal(route.walk,exact.replace('sit:','walk:'));
 const advertised=part.affordances.filter((a:any)=>a.available);
 for(const offer of advertised){const resolved=edge.intents.dryRun(soul,{capability:offer.capability}) as any;assert.equal(resolved.ok,true,JSON.stringify({offer,resolved}));assert.equal(resolved.would.capability,offer.capability);}
 const walkId=advertised.find((a:any)=>a.capability.startsWith('walk:')).capability;
 const walk=await accept(w.host,Promise.resolve(edge.act(soul,{capability:walkId}))) as any;assert.equal(walk.accepted,true,JSON.stringify(walk));assert.equal(walk.receipt.chosen.target,bench.id,'first accepted receipt identifies exact fixture');
 let walkReceipt:any;for(let i=0;i<4000;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}walkReceipt=edge.receipt(soul.soulId,walk.receipt.id);if(['completed','failed'].includes(walkReceipt.phase))break;}
 assert.equal(walkReceipt.phase,'completed',JSON.stringify(walkReceipt));assert.equal(walkReceipt.chosen.target,bench.id);assert.ok(Math.abs(w.host.engine.world.entities[soul.entityId].pose.p[2]-145)<3,'exact part walk physically arrives');
 await accept(w.host,w.host.enqueue('edge-relocate','test:parts-return',{...soul,to:[0,0],why:'independent far sit admission'}));await settle();
 const exactResolve=edge.intents.dryRun(soul,{capability:exact}) as any;assert.equal(exactResolve.ok,true,JSON.stringify(exactResolve));
 const act=await accept(w.host,Promise.resolve(edge.act(soul,{capability:exact}))) as any;assert.equal(act.accepted,true,JSON.stringify(act));
 let seated=false;for(let i=0;i<4000;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}if((w.host.engine.world.entities[soul.entityId] as any).human?.activity==='sit' && w.host.engine.nativeSeatHoldsV1?.(soul.entityId).some(h=>h.slot===`${bench.id}#${slot.id}`)){seated=true;break;}assert.notEqual(edge.receipt(soul.soulId,act.receipt.id)?.phase,'failed',JSON.stringify(edge.receipt(soul.soulId,act.receipt.id)));}
 const body=w.host.engine.world.entities[soul.entityId] as any;
 const held=w.host.engine.nativeSeatHoldsV1!(soul.entityId);assert.ok(held.some(h=>h.slot===`${bench.id}#${slot.id}`),JSON.stringify(held));
 assert.ok(seated,JSON.stringify({human:body.human,receipt:edge.receipt(soul.soulId,act.receipt.id)}));assert.ok(Math.abs(body.pose.p[2]-145)<3,'body actually reaches far fixture');
 const receipt=edge.receipt(soul.soulId,act.receipt.id) as any;assert.equal(receipt.chosen?.target,bench.id,JSON.stringify(receipt));
 assert.equal(receipt.chosen.slot,`${bench.id}#${slot.id}`);
 if(process.env.PARTS_PROOF)writeFileSync(process.env.PARTS_PROOF,JSON.stringify({resolve:out,exactResolve,walkAccepted:walk.receipt,walkReceipt,receipt,held,body:{pose:body.pose,human:body.human}},null,2)+'\n');
});
