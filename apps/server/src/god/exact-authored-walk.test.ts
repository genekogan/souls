import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from 'hono';
import {coreRef} from '@souls/world-compiler';
import {fixture,factory,invite,accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {GroundHost,installGroundCapabilities} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {installGovernance} from './governance-edge.ts';
import {registerEdgeComms} from '../edge/comms/index.ts';
import {edgeSoulResolver} from '../edge/routes.ts';
import {readHumanCapabilitiesV1} from '../human-capabilities.ts';
import type {EdgeSoul} from '../edge/contract.ts';

async function setup(t:test.TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}}),edge=new EdgeLedger(f.host,f.db);
 new GroundHost(f.db,f.host,god);installGroundCapabilities(edge,god,f.host);
 const bridge=installEngineBridge({host:f.host,god,edge,log(){},worldClock:false,worldLore:true});
 installGovernance(god,{host:f.host,edge,edgeHooks:true});
 const comms=registerEdgeComms(new Hono(),{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger:edge},{sweepMs:0,fetch:null});edge.attachComms(comms as never);
 t.after(()=>{comms.close();f.brain.quiesce();f.host.stop();f.db.close();});
 const tick=async(n=4)=>{for(let i=0;i<n;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}};await tick();
 const area:[number,number][]=[[-30,-30],[30,-30],[30,30],[-30,30]];
 const built=god.act({ops:[
  {op:'place',def:coreRef('pavilion'),name:'eden-library-1',p:[24,-10]},
  {op:'place',def:coreRef('zone'),name:'field',shape:{area},params:{use:'park'}},
  {op:'place',def:coreRef('zone'),name:'flag-marker',shape:{area:[[-10,-10],[-5,-10],[-5,-5],[-10,-5]]},params:{use:'park'}},
  {op:'place',def:coreRef('flag'),name:'marker',p:[-8,-8]},
  {op:'place',def:coreRef('zone'),name:'place-field',shape:{area},params:{use:'park'},about:{title:'Commons Field',kind:'district',role:'district'}},
  {op:'place',def:coreRef('pavilion'),name:'far-house',p:[180,-10]},
  {op:'place',def:coreRef('pavilion'),name:'private-house',p:[15,20],owner:'soul:SomeoneElse',access:'private'},
  {op:'place',def:coreRef('chair'),name:'chair',p:[3,-3]},
 ]});assert.equal(built.accepted,true,JSON.stringify(built));await tick(8);
 await invite(f,'walker');const row=await accept(f.host,f.souls.create('dev:walker',{name:'Walker',description:'Native exact-walk regression'}));
 const soul:EdgeSoul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(4);bridge.perceive.sync(true);edge.map();
 comms.objects.create({id:'projection-object',kind:'mark',name:'Projection test note',placeId:'field',params:{form:'note',title:'Projection test note',text:'A public native object',author:{soulId:soul.soulId,name:soul.name}}});
 const sparse=(capability:string,params?:unknown)=>{edge.invalidateBodies();return (edge as any).exactWalkBindings(soul,{capability,params});};
 const full=(capability:string)=>{edge.invalidateBodies();const b=edge.coreA.binds(soul);return {cap:structuredClone(b.caps.find(c=>c.id===capability)),plan:structuredClone(b.plans.get(capability))};};
 return {f,god,edge,bridge,comms,soul,tick,sparse,full};
}
// Exercise the real SHOW=120 plus six-extra-area bounds, rather than mocking
// selection: nearer tiny named zones fill SHOW, then six larger named areas
// consume the outdoor-place allowance ahead of place-field.
async function omitFieldFromListing(w:Awaited<ReturnType<typeof setup>>){
 const body=w.f.host.engine.world.entities[w.soul.entityId]!,x=body.pose.p[0],z=body.pose.p[2];
 const ops=Array.from({length:126},(_,i)=>({op:'place',def:coreRef('zone'),name:`a-tiny-${String(i).padStart(3,'0')}`,shape:{area:[[x-.1,z-.1],[x+.1,z-.1],[x+.1,z+.1],[x-.1,z+.1]]},params:{use:'park'}}));
 ops.push(...Array.from({length:6},(_,i)=>({op:'place',def:coreRef('zone'),name:`b-area-${i}`,shape:{area:[[x-12,z-12],[x+12,z-12],[x+12,z+12],[x-12,z+12]]},params:{use:'park'}})));
 const out=w.god.act({ops} as never);assert.equal(out.accepted,true,JSON.stringify(out));await w.tick(8);w.bridge.perceive.sync(true);w.edge.map();
 assert.equal(w.full('walk:place-field').cap,undefined,'real bounded listing must omit the area');
 assert.equal(w.bridge.nav.exactListedWalk(w.soul,'place-field',[],new Map()),false);
}
function fullOnDemand(w:Awaited<ReturnType<typeof setup>>,asked:string){
 w.edge.invalidateBodies();const b=w.edge.coreA.binds(w.soul),od=w.edge.resolveOnDemand(w.soul,asked,b.caps,b.plans);
 assert.notEqual(od.v.kind,'unknown',JSON.stringify(od.v));
 return {cap:structuredClone(od.caps.find(c=>c.id===asked)),plan:structuredClone(od.plans.get(asked))};
}
test('default native fixture uses exact walk projection with capability/plan parity and no unrelated enumeration',async t=>{
 const w=await setup(t),{edge,bridge,soul,f}=w;
 assert.equal((edge as any).providers.length,1,'actual Comms object provider remains installed');
 assert.ok((edge as any).providers[0](soul).length>0,'default object provider contributes actual visible object offers');
 for(const capability of ['walk:eden-library-1','walk:place-field','walk:field','walk:flag-marker']){
  const original=w.full(capability);assert.ok(original.cap?.available,capability);
  const projected=w.sparse(capability);assert.ok(projected,'default Ground/Held/Lore/Governance/Comms hooks permit exact projection');
  assert.deepEqual(projected.caps.find((c:any)=>c.id===capability),original.cap);assert.deepEqual(projected.plans.get(capability),original.plan);
  assert.equal((edge as any).capCache.size,0,'sparse projection never enters full capability cache');
 }
 const native=w.sparse('walk:field');assert.equal(native.caps.find((c:any)=>c.id==='walk:field').target.id,'field','actual native binding beats same-ID authored field');assert.equal(native.plans.get('walk:field').steps[0].params.spread,'region/1');
 const flag=w.sparse('walk:flag-marker');assert.equal(flag.caps.find((c:any)=>c.id==='walk:flag-marker').target.kind,'object','preceding native ground flag beats same-ID authored area');
 const roomRef=bridge.nav.things().find(x=>x.ref.startsWith('eden-library-1/')&&x.kind==='room')!.ref,roomFull=w.full('walk:'+roomRef),roomSparse=w.sparse('walk:'+roomRef);assert.ok(roomSparse);assert.deepEqual(roomSparse.plans.get('walk:'+roomRef),roomFull.plan,'listed room retains its ordinary plan without an extra on-demand door leg');
 const original=w.full('walk:eden-library-1');edge.invalidateBodies();let fullLists=0,social=0,activities=0;const goals:string[]=[],admission:string[]=[];
 const binds=(edge as any).binds.bind(edge);(edge as any).binds=(...args:any[])=>{fullLists++;return binds(...args);};
 const tog=edge.together.capabilities.bind(edge.together);edge.together.capabilities=(...args:any[])=>{social++;return (tog as any)(...args);};
 const list=bridge.capabilities.bind(bridge);bridge.capabilities=(...args:any[])=>{activities++;return (list as any)(...args);};
 const goal=bridge.nav.goal.bind(bridge.nav);bridge.nav.goal=(target,...args)=>{goals.push(target.ref);return goal(target,...args);};
 const can=f.host.engine.canPerform.bind(f.host.engine);f.host.engine.canPerform=request=>{admission.push(request.label);return can(request);};
 const out=await accept(f.host,edge.act(soul,{capability:'walk:eden-library-1',params:{},clientRef:'one-native-walk'}));assert.equal(out.accepted,true,JSON.stringify(out));if(!out.accepted)return;
 assert.equal(fullLists,0);assert.equal(social,0);assert.equal(activities,0);assert.ok(goals.length>0);assert.ok(goals.every(ref=>ref==='eden-library-1'||ref.startsWith('eden-library-1/')),'only requested building/related interior goals are planned');
 assert.ok(admission.length>0);assert.ok(admission.every(label=>label===original.plan!.label),'ordinary native launch admission still executes');
 assert.deepEqual(out.receipt.chosen,{capability:'walk:eden-library-1',target:'g-eden-library-1',kind:'place',place:'g-eden-library-1'});
 const count=f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n:number};
 edge.knowledge.setSecret('g-eden-library-1',true);edge.addCapabilityProvider(()=>{throw Error('replay must not discover capabilities');});
 const replay=await edge.act(soul,{capability:'walk:eden-library-1',clientRef:'one-native-walk'});assert.equal(replay.accepted,true);if(replay.accepted)assert.equal(replay.receipt.id,out.receipt.id);assert.deepEqual(f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get(),count,'replay creates no receipt');
 // The original full listing remains available, with unrelated offers intact.
 (edge as any).binds=binds;edge.knowledge.setSecret('g-eden-library-1',false);const all=edge.capabilities(soul);assert.ok(all.some(c=>c.verb==='read'));assert.ok(all.some(c=>c.verb==='sit'));assert.ok(all.length>20);
});
test('native exact walk selector reuses original anchor steps and skips unrelated native admission',async t=>{
 const {f,soul}=await setup(t),mind=f.host.minds.get(soul.soulId)!;
 const full=readHumanCapabilitiesV1(f.host,mind,{registeredActivitiesV1:true,deferRouteChecks:true,skipRegisteredCards:true});let admissions=0;const can=f.host.engine.canPerform.bind(f.host.engine);f.host.engine.canPerform=r=>{admissions++;return can(r);};
 const exact=readHumanCapabilitiesV1(f.host,mind,{registeredActivitiesV1:true,deferRouteChecks:true,skipRegisteredCards:true,onlyWalkTarget:'field'});
 assert.deepEqual(exact.bindings.get('walk:field'),full.bindings.get('walk:field'));assert.equal(exact.bindings.size,1);assert.equal(admissions,0,'unrelated rest/eat/sit/swim admission is not evaluated');
});
test('unknown profiles/providers, provider drift, aliases and parameter-bearing input retain full resolution',async t=>{
 const w=await setup(t),{edge,soul}=w;
 for(const params of [{via:['field']},{with:['someone']},{painting:{x:1}},{seconds:1},[]])assert.equal(w.sparse('walk:eden-library-1',params),null);
 for(const asked of ['walk:Eden Library','walk:unknown-place','walk:here','walk:eden-library-1:other'])assert.equal(w.sparse(asked),null);
 const refKnown=edge.exactAuthoredWalkRef!;edge.exactAuthoredWalkRef=()=>{throw Error('index unavailable')};assert.equal(w.sparse('walk:eden-library-1'),null,'failed identity projection falls back rather than changing public refusal semantics');edge.exactAuthoredWalkRef=refKnown;
 const profile=edge.worldProfile!;edge.worldProfile=(...args)=>profile(...args);assert.equal(w.sparse('walk:eden-library-1'),null,'unknown wrapper is not certified by name or apparent transparency');edge.worldProfile=profile;
 edge.addCapabilityProvider(()=>[{id:'object:example:read',verb:'object',label:'Read object',available:true}],{exactWalk:'objects-only'});assert.ok(w.sparse('walk:eden-library-1'));
 edge.addCapabilityProvider(()=>[{id:'walk:drift',verb:'walk',label:'future provider walk',available:true}],{exactWalk:'objects-only'});assert.equal(w.sparse('walk:eden-library-1'),null,'declared object-only provider drift is checked, not blindly trusted');
 const unknown=await setup(t);unknown.edge.addCapabilityProvider(()=>[]);assert.equal(unknown.sparse('walk:eden-library-1'),null);
 const before=unknown.full('walk:eden-library-1');const out=await accept(unknown.f.host,unknown.edge.act(unknown.soul,{capability:'walk:eden-library-1',params:{via:['field']}}));assert.equal(out.accepted,true,JSON.stringify(out));assert.ok(before.plan);
});
test('secret ancestors, inherited private room and coordinate construction closure cannot be bypassed',async t=>{
 const w=await setup(t),{edge,bridge,soul}=w;
 edge.knowledge.setSecret('g-eden-library-1',true);const secretRoom=bridge.nav.things().find(x=>x.ref.startsWith('eden-library-1/')&&x.kind==='room')!;assert.ok(secretRoom);assert.equal(w.sparse('walk:'+secretRoom.ref),null,'secret ancestor also hides exact child room');assert.equal(w.full('walk:'+secretRoom.ref).cap,undefined);assert.equal(w.sparse('walk:eden-library-1'),null);assert.equal(w.full('walk:eden-library-1').cap,undefined);edge.knowledge.setSecret('g-eden-library-1',false);
 const room=bridge.nav.things().find(x=>x.ref.startsWith('private-house/')&&x.kind==='room')!;assert.ok(room);
 for(const asked of ['walk:private-house','walk:'+room.ref]){assert.equal(w.sparse(asked),null);const b=w.full(asked);assert.equal(b.cap?.blocked?.code,'object.private');assert.equal(b.plan,undefined);}
 const active=bridge.layers.active.bind(bridge.layers),refuse=bridge.layers.constructionRefusal.bind(bridge.layers);bridge.layers.active=()=>true;
 bridge.layers.constructionRefusal=(_s,steps)=>steps.some(s=>s.verb==='walk_to'&&Array.isArray(s.params.to))?{code:'site.under-construction',reason:'Native fixture closes this coordinate route'}:null;
 assert.equal(w.sparse('walk:eden-library-1'),null);const b=w.full('walk:eden-library-1');assert.equal(b.cap?.blocked?.code,'site.under-construction');assert.equal(b.plan,undefined);
 bridge.layers.active=active;bridge.layers.constructionRefusal=refuse;
});
test('native/profile exact-ID precedence and blocked offers are never replaced by authored walks',async t=>{
 const w=await setup(t),{edge}=w,profile=edge.worldProfile!;
 // An explicitly supported preceding native/profile binding shadows GodNav,
 // using the same existing-ID rule as offerWalk in the full path.
 const prior=(s:any,c:any[],p:Map<string,any>)=>{c.push({id:'walk:eden-library-1',verb:'walk',label:'Native first',available:false,target:{id:'field',kind:'place'},blocked:{code:'native.blocked',reason:'Native authoritative block'}});p.delete('walk:eden-library-1');};
 edge.registerExactWalkProfile(prior,undefined,(s,a,c,p)=>{prior(s,c,p);return true;});
 const wrapper=(s:any,c:any[],p:Map<string,any>)=>{prior(s,c,p);profile(s,c,p);};edge.worldProfile=wrapper;
 edge.registerExactWalkProfile(wrapper,prior,(s,a,c,p)=>true);
 assert.equal(w.sparse('walk:eden-library-1'),null);const b=w.full('walk:eden-library-1');assert.equal(b.cap?.label,'Native first');assert.equal(b.cap?.blocked?.code,'native.blocked');assert.equal(b.plan,undefined);
});
test('far rooms keep legacy on-demand planning and ride/body masks stay authoritative',async t=>{
 const w=await setup(t),{edge,bridge,f,soul}=w;
 const room=bridge.nav.things().find(x=>x.ref.startsWith('far-house/')&&x.kind==='room')!;assert.ok(room);assert.equal(w.sparse('walk:'+room.ref),null,'unlisted room does not get the listed plan accidentally');
 const base=w.full('walk:eden-library-1');const aboard=(edge as any).aboard,stepOut=(edge as any).stepOutRefusal;(edge as any).aboard=()=>({phase:'aloft',label:'native ride'});(edge as any).stepOutRefusal=()=>null;
 assert.equal(w.sparse('walk:eden-library-1'),null);assert.equal(w.full('walk:eden-library-1').cap?.blocked?.code,'ride.aboard');
 (edge as any).aboard=()=>({phase:'landed',label:'native ride'});(edge as any).stepOutRefusal=()=>({code:'ride.step-out',reason:'Native rider is stepping out'});assert.equal(w.sparse('walk:eden-library-1'),null);assert.equal(w.full('walk:eden-library-1').cap?.blocked?.code,'ride.step-out');
 (edge as any).aboard=aboard;(edge as any).stepOutRefusal=stepOut;
 const body=f.host.engine.world.entities[soul.entityId]!,original=body.body;body.body={family:'floater',type:'ceramic'} as never;
 const projected=w.sparse('walk:eden-library-1'),full=w.full('walk:eden-library-1');assert.ok(projected);assert.deepEqual(projected.caps.find((c:any)=>c.id==='walk:eden-library-1'),full.cap);assert.match(full.cap!.label,/Glide/);assert.deepEqual(projected.plans.get('walk:eden-library-1'),full.plan);body.body=original;assert.ok(base.cap);
});
test('a real occupied native seat is released through omitted-area normal walk admission',async t=>{
 const w=await setup(t),{f,edge,soul,bridge,tick}=w,chair=bridge.god.model.get('chair')!;
 const sit=await accept(f.host,edge.act(soul,{capability:'sit:'+chair.id,params:{seconds:600}}));assert.equal(sit.accepted,true,JSON.stringify(sit));if(!sit.accepted)return;
 const occupied=()=>f.host.engine.world.entities[soul.entityId]!.human?.activity==='sit'&&f.host.engine.nativeSeatHoldsV1?.(soul.entityId).some(hold=>f.host.engine.runtime.records.get(hold.action)?.phase==='occupied');
 for(let i=0;i<800&&!occupied();i++)await tick(1);
 assert.ok(occupied(),'fixture must actually occupy a native slot, not merely reserve/approach it');await omitFieldFromListing(w);
 const full=fullOnDemand(w,'walk:place-field'),projected=w.sparse('walk:place-field');assert.ok(projected);assert.deepEqual(projected.plans.get('walk:place-field'),full.plan);assert.equal(full.plan!.steps[0].verb,'stand');
 const walk=await accept(f.host,edge.act(soul,{capability:'walk:place-field'}));assert.equal(walk.accepted,true,JSON.stringify(walk));if(!walk.accepted)return;
 for(let i=0;i<1200&&edge.receipt(soul.soulId,walk.receipt.id)?.phase!=='completed';i++)await tick(1);
 assert.equal(edge.receipt(soul.soulId,walk.receipt.id)?.phase,'completed');assert.equal(f.host.engine.nativeSeatHoldsV1?.(soul.entityId).length,0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('canonical omitted area keeps exact legacy on-demand cap/plan and native receipt without full enumeration',async t=>{
 const w=await setup(t),{edge,soul,bridge,f}=w;await omitFieldFromListing(w);
 const original=fullOnDemand(w,'walk:place-field');assert.equal(original.cap?.target?.id,'g-place-field');assert.ok(original.cap?.available);assert.ok(original.plan);
 const projected=w.sparse('walk:place-field');assert.ok(projected);assert.deepEqual(projected.caps.find((c:any)=>c.id==='walk:place-field'),original.cap);assert.deepEqual(projected.plans.get('walk:place-field'),original.plan);
 assert.equal(projected.caps.some((c:any)=>c.verb!=='walk'),false,'no sibling area activity offers');assert.equal((edge as any).capCache.size,0);
 // Reading the full listing first must neither disable on-demand admission nor
 // install the sparse result in the cache.
 edge.invalidateBodies();const full=edge.coreA.binds(soul),cache=(edge as any).capCache.get(soul.soulId);assert.equal(full.caps.some(c=>c.id==='walk:place-field'),false);
 const after=(edge as any).exactWalkBindings(soul,{capability:'walk:place-field'});assert.ok(after);assert.deepEqual(after.plans.get('walk:place-field'),original.plan);assert.equal((edge as any).capCache.get(soul.soulId),cache);assert.equal(full.caps.some(c=>c.id==='walk:place-field'),false);
 // Existing native exact-ID and preceding ground/profile offers still win.
 for(const id of ['walk:field','walk:flag-marker']){const legacy=fullOnDemand(w,id),sparse=w.sparse(id);assert.ok(sparse);assert.deepEqual(sparse.caps.find((c:any)=>c.id===id),legacy.cap);assert.deepEqual(sparse.plans.get(id),legacy.plan);}
 assert.equal(w.sparse('walk:field').caps.find((c:any)=>c.id==='walk:field').target.id,'field');
 // [ref,g-ref] chooses the native/authored exact place ID first. Do not take
 // the canonical-area shortcut if that identity is owned by another place.
 const place=edge.places.byId.get('field')!;edge.places.byId.set('place-field',{...place,id:'place-field'});
 assert.equal(w.sparse('walk:place-field'),null,'a first-ID collision retains complete resolution');edge.places.byId.delete('place-field');
 assert.ok(w.sparse('walk:place-field'));
 // Normal act admission still creates the native receipt and no full listing.
 edge.invalidateBodies();let lists=0;const binds=(edge as any).binds.bind(edge);(edge as any).binds=(...a:any[])=>{lists++;return binds(...a);};
 const out=await accept(f.host,edge.act(soul,{capability:'walk:place-field',clientRef:'omitted-area'}));assert.equal(out.accepted,true,JSON.stringify(out));if(!out.accepted)return;assert.equal(lists,0);
 assert.deepEqual(out.receipt.chosen,{capability:'walk:place-field',target:'g-place-field',kind:'place',place:'g-place-field'});
 const prior=(edge as any).exactWalkBindings;(edge as any).exactWalkBindings=()=>null;
 const legacy=await accept(f.host,edge.act(soul,{capability:'walk:place-field',clientRef:'legacy-area'}));assert.equal(legacy.accepted,true,JSON.stringify(legacy));if(legacy.accepted)assert.deepEqual(legacy.receipt.chosen,out.receipt.chosen);
 (edge as any).exactWalkBindings=prior;(edge as any).binds=binds;
 edge.knowledge.setSecret('g-place-field',true);const replay=await edge.act(soul,{capability:'walk:place-field',clientRef:'omitted-area'});assert.equal(replay.accepted,true);if(replay.accepted)assert.equal(replay.receipt.id,out.receipt.id);
 assert.equal(w.sparse('walk:place-field'),null,'unknown secret area cannot use sparse admission');edge.knowledge.setSecret('g-place-field',false);
 const active=bridge.layers.active.bind(bridge.layers),refuse=bridge.layers.constructionRefusal.bind(bridge.layers);bridge.layers.active=()=>true;bridge.layers.constructionRefusal=()=>({code:'site.under-construction',reason:'Native fixture closes this route'});
 assert.equal(w.sparse('walk:place-field'),null,'on-demand area still runs coordinate construction safety');bridge.layers.active=active;bridge.layers.constructionRefusal=refuse;
 const aboard=(edge as any).aboard,stepOut=(edge as any).stepOutRefusal;(edge as any).aboard=()=>({phase:'aloft',label:'native ride'});(edge as any).stepOutRefusal=()=>null;assert.equal(w.sparse('walk:place-field'),null);(edge as any).aboard=aboard;(edge as any).stepOutRefusal=stepOut;
});

test('unlisted room, water/shore and area-shaped landform retain full legacy resolution',async t=>{
 const w=await setup(t),{god,bridge,edge}=w;
 const out=god.act({ops:[
  {op:'place',def:coreRef('pond'),name:'pond',shape:{area:[[70,40],[80,40],[80,50],[70,50]]},params:{depth:.3,level:0,edge:1}},
  {op:'place',def:coreRef('plateau'),name:'terrace',shape:{area:[[100,40],[110,40],[110,50],[100,50]]},params:{height:1.6,edge:1}},
 ]});assert.equal(out.accepted,true,JSON.stringify(out));await w.tick(8);await omitFieldFromListing(w);
 assert.equal(bridge.nav.thing('terrace')?.kind,'area','landforms can share the area-shaped navigation class');
 assert.equal(bridge.places.forRef('terrace')?.of,'landform');assert.equal(bridge.places.forRef('pond')?.of,'shore');
 const room=bridge.nav.things().find(x=>x.ref.startsWith('far-house/')&&x.kind==='room')!;
 for(const ref of ['pond','terrace',room.ref]){
  assert.equal(bridge.nav.exactListedWalk(w.soul,ref,[],new Map()),false,ref);
  assert.equal(edge.exactAuthoredAreaWalkRef!(ref),false,ref);
  assert.equal(w.sparse('walk:'+ref),null,ref);
  edge.coreA.binds(w.soul);assert.equal((edge as any).exactWalkBindings(w.soul,{capability:'walk:'+ref}),null,'full-cache miss must not broaden '+ref);
 }
});
test('exact walk asks the object provider for no unrelated objects (no object table read, no offer build)',async t=>{
 const w=await setup(t),{edge,comms,soul,bridge}=w,objects=comms.objects as any;
 assert.ok(objects.capabilities(soul).some((c:any)=>c.id.startsWith('object:projection-object:')),'a visible object offer exists');
 const asked:(ReadonlySet<string>|undefined)[]=[];let tableReads=0;
 const caps=objects.capabilities.bind(objects);objects.capabilities=(s:EdgeSoul,only?:ReadonlySet<string>,places?:Map<string,string>)=>{asked.push(only);return caps(s,only,places);};
 const fresh=objects.fresh.bind(objects);objects.fresh=(...args:any[])=>{tableReads++;return fresh(...args);};
 const roomRef=bridge.nav.things().find(x=>x.ref.startsWith('eden-library-1/')&&x.kind==='room')!.ref;
 for(const capability of ['walk:eden-library-1','walk:place-field','walk:field','walk:flag-marker','walk:'+roomRef]){
  asked.length=0;tableReads=0;
  const projected=w.sparse(capability);assert.ok(projected,capability);assert.ok(projected.caps.find((c:any)=>c.id===capability)?.available,capability);
  assert.ok(asked.length>0,`${capability}: the provider drift check still runs`);
  assert.ok(asked.every(only=>only!==undefined&&only.size===0),`${capability}: asked for no objects (${JSON.stringify(asked.map(o=>o&&[...o]))})`);
  assert.equal(tableReads,0,`${capability}: the whole object table is not read`);
  assert.ok(!projected.caps.some((c:any)=>c.verb==='object'),`${capability}: no object offers built`);
 }
});
test('god object capability wrapper preserves a selected object and its place output',async t=>{
 const {comms,soul}=await setup(t),objects=comms.objects as any;
 let tableReads=0;
 const fresh=objects.fresh.bind(objects);objects.fresh=(...args:any[])=>{tableReads++;return fresh(...args);};
 const places=new Map<string,string>();
 const caps=objects.capabilities(soul,new Set(['projection-object']),places);
 assert.ok(caps.length>0,'the selected object still offers its actions');
 assert.ok(caps.every((c:any)=>c.object==='projection-object'),'no unrelated object offers');
 assert.deepEqual([...places.keys()],['projection-object'],'the caller receives the selected object place');
 assert.equal(typeof places.get('projection-object'),'string');
 assert.equal(tableReads,0,'selected-object lookup never reads the whole object table');
});
