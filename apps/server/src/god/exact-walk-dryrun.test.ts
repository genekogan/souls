// Continuity r3 (2026-10-30): two concurrent `resolve walk:<ref>` dry runs each built the whole-world capability
// menu (binds: providers, activities, Together, the bridge listing) before their exact-walk short-circuit; on
// Eden 2026 (4935 entities) that stalled the world server ~1.9 s. An eligible exact walk now resolves over the
// narrow bindings act already uses (exactWalkBindings). Latency only: every response is byte-identical to the full
// path's, which is computed here by disabling exactWalkBindings (the same switch the act parity test uses).
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
  // the r3 witness's garden, as worlds/templates/eden-2026.json places it (a farm zone), moved near the fixture's body
  {op:'place',def:coreRef('zone'),name:'place-eden-stone-garden',shape:{area:[[13.2,-13.8],[20.8,-13.8],[20.8,-6.2],[13.2,-6.2]]},params:{use:'farm'}},
  {op:'place',def:coreRef('pavilion'),name:'far-house',p:[180,-10]},
  {op:'place',def:coreRef('pavilion'),name:'private-house',p:[15,20],owner:'soul:SomeoneElse',access:'private'},
  {op:'place',def:coreRef('chair'),name:'chair',p:[3,-3]},
 ]});assert.equal(built.accepted,true,JSON.stringify(built));await tick(8);
 await invite(f,'walker');const row=await accept(f.host,f.souls.create('dev:walker',{name:'Walker',description:'Native exact-walk dry-run parity'}));
 const soul:EdgeSoul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick(4);bridge.perceive.sync(true);edge.map();
 comms.objects.create({id:'projection-object',kind:'mark',name:'Projection test note',placeId:'field',params:{form:'note',title:'Projection test note',text:'A public native object',author:{soulId:soul.soulId,name:soul.name}}});
 // Counts whole-world menu work: ledger binds (which the coreA facade and every full-path reader go through), and the
 // pieces it fans out to that r3 implicated: the bridge listing (-> perceive.capabilities -> perceive.ensure) and Together.
 let menus=0,listings=0,perceives=0,social=0;const binds=(edge as any).binds.bind(edge);(edge as any).binds=(...a:any[])=>{menus++;return binds(...a);};
 const list=bridge.capabilities.bind(bridge);bridge.capabilities=(...a:any[])=>{listings++;return (list as any)(...a);};
 const seen=bridge.perceive.capabilities.bind(bridge.perceive);bridge.perceive.capabilities=(...a:any[])=>{perceives++;return (seen as any)(...a);};
 const tog=edge.together.capabilities.bind(edge.together);edge.together.capabilities=(...a:any[])=>{social++;return (tog as any)(...a);};
 const exactWalk=(edge as any).exactWalkBindings;
 /** One dry run from a cold cache: the response, its JSON bytes and how much whole-menu work it did. */
 const dry=(capability:string,params?:unknown)=>{edge.invalidateBodies();menus=listings=perceives=social=0;const out=edge.intents.dryRun(soul,{capability,...(params!==undefined?{params}:{})} as never);return {out,json:JSON.stringify(out),menus,work:{menus,listings,perceives,social}};};
 /** The same dry run on the full path only (exactWalkBindings disabled): today's response. */
 const legacy=(capability:string,params?:unknown)=>{(edge as any).exactWalkBindings=()=>null;try{return dry(capability,params);}finally{(edge as any).exactWalkBindings=exactWalk;}};
 return {f,god,edge,bridge,comms,soul,tick,dry,legacy};
}
type W=Awaited<ReturnType<typeof setup>>;
// The real SHOW=120 plus six-extra-area bounds (as exact-authored-walk.test.ts): place-field leaves the listing.
async function omitFieldFromListing(w:W){
 const body=w.f.host.engine.world.entities[w.soul.entityId]!,x=body.pose.p[0],z=body.pose.p[2];
 const ops=Array.from({length:126},(_,i)=>({op:'place',def:coreRef('zone'),name:`a-tiny-${String(i).padStart(3,'0')}`,shape:{area:[[x-.1,z-.1],[x+.1,z-.1],[x+.1,z+.1],[x-.1,z+.1]]},params:{use:'park'}}));
 ops.push(...Array.from({length:6},(_,i)=>({op:'place',def:coreRef('zone'),name:`b-area-${i}`,shape:{area:[[x-12,z-12],[x+12,z-12],[x+12,z+12],[x-12,z+12]]},params:{use:'park'}})));
 const out=w.god.act({ops} as never);assert.equal(out.accepted,true,JSON.stringify(out));await w.tick(8);w.bridge.perceive.sync(true);w.edge.map();
 w.edge.invalidateBodies();assert.equal(w.edge.coreA.binds(w.soul).caps.some(c=>c.id==='walk:place-field'),false,'real bounded listing must omit the area');
}
/** Parity for one ask: same bytes as the full path; `fast` says whether it may skip the whole menu. */
function parity(w:W,t:test.TestContext,capability:string,fast:boolean,params?:unknown){
 const old=w.legacy(capability,params),now=w.dry(capability,params);
 t.diagnostic(`${capability}${params!==undefined?' '+JSON.stringify(params):''} work=${JSON.stringify(now.work)} legacyWork=${JSON.stringify(old.work)} ${now.json}`);
 assert.equal(now.json,old.json,`${capability}: byte-identical resolve response`);assert.deepEqual(now.out,old.out);
 assert.ok(old.menus>0,`${capability}: the full path builds the whole menu`);
 if(fast)assert.deepEqual(now.work,{menus:0,listings:0,perceives:0,social:0},`${capability}: an eligible exact walk never builds the whole-world menu`);
 else assert.ok(now.menus>0,`${capability}: an ineligible ask keeps the full path`);
 assert.equal((w.edge as any).capCache.size,now.menus?1:0,'sparse bindings never enter the full capability cache');
 return now.out as any;
}

test('eligible exact walks resolve without the whole-world menu, byte-identical to the full path',async t=>{
 const w=await setup(t),{bridge}=w;
 const room=bridge.nav.things().find(x=>x.ref.startsWith('eden-library-1/')&&x.kind==='room')!.ref;
 // canonical building, a far building the listing still offers, authored area (the garden: a farm zone), area with
 // `about`, native region, ground flag, listed room
 for(const capability of ['walk:eden-library-1','walk:far-house','walk:place-eden-stone-garden','walk:place-field','walk:field','walk:flag-marker','walk:'+room]){
  const out=parity(w,t,capability,true);assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.would.capability,capability);
 }
 // empty params are what act's fast path also accepts
 parity(w,t,'walk:eden-library-1',true,{});
});
test('ineligible asks keep the full path: place-ID form, names, unlisted far room, unknown/private targets, params, non-walk verbs',async t=>{
 const w=await setup(t),{bridge,god}=w;
 const far=bridge.nav.things().find(x=>x.ref.startsWith('far-house/')&&x.kind==='room')!.ref,priv=bridge.nav.things().find(x=>x.ref.startsWith('private-house/')&&x.kind==='room')!.ref;
 const chair=god.model.get('chair')!.id;
 // the r3 witness's literal ask is the authored place ID (g-…), not the listed ref: it resolves through place matching
 const witness=parity(w,t,'walk:g-place-eden-stone-garden',false);assert.equal(witness.ok,true,JSON.stringify(witness));
 for(const capability of ['walk:Eden Library','walk:Commons Field','walk:commons-field',' walk:eden-library-1','walk:'+far,'walk:unknown-place','walk:here','walk:eden-library-1:other',
  'walk:private-house','walk:'+priv,'sit:'+chair,'wave:here','wander:here','jog:place-field','walk to the library','look at the chair'])parity(w,t,capability,false);
 for(const params of [{via:['field']},{with:['someone']},{seconds:1}])parity(w,t,'walk:eden-library-1',false,params);
});
test('protected and masked answers are unchanged: secret, private, construction, aloft, rigid body, faded',async t=>{
 const w=await setup(t),{edge,bridge,f,soul}=w;
 const room=bridge.nav.things().find(x=>x.ref.startsWith('eden-library-1/')&&x.kind==='room')!.ref;
 edge.knowledge.setSecret('g-eden-library-1',true);
 for(const capability of ['walk:eden-library-1','walk:'+room]){const out=parity(w,t,capability,false);assert.equal(out.ok,false,JSON.stringify(out));}
 edge.knowledge.setSecret('g-eden-library-1',false);
 // a private building is reported, as today, as offered but blocked (unavailable offers keep the full path)
 for(const capability of ['walk:private-house','walk:'+bridge.nav.things().find(x=>x.ref.startsWith('private-house/')&&x.kind==='room')!.ref]){const priv=parity(w,t,capability,false);assert.equal(priv.would?.blocked?.code,'object.private',JSON.stringify(priv));}
 const active=bridge.layers.active.bind(bridge.layers),refuse=bridge.layers.constructionRefusal.bind(bridge.layers);bridge.layers.active=()=>true;
 bridge.layers.constructionRefusal=(_s,steps)=>steps.some(s=>s.verb==='walk_to'&&Array.isArray(s.params.to))?{code:'site.under-construction',reason:'Native fixture closes this coordinate route'}:null;
 const closed=parity(w,t,'walk:eden-library-1',false);assert.equal(closed.would?.blocked?.code??closed.code,'site.under-construction',JSON.stringify(closed));
 bridge.layers.active=active;bridge.layers.constructionRefusal=refuse;
 const aboard=(edge as any).aboard,stepOut=(edge as any).stepOutRefusal;(edge as any).aboard=()=>({phase:'aloft',label:'native ride'});(edge as any).stepOutRefusal=()=>null;
 const aloft=parity(w,t,'walk:eden-library-1',false);assert.equal(aloft.would?.blocked?.code??aloft.code,'ride.aboard',JSON.stringify(aloft));
 (edge as any).aboard=aboard;(edge as any).stepOutRefusal=stepOut;
 // a rigid body is relabelled by the shared finishing pass: still eligible, still identical
 const body=f.host.engine.world.entities[soul.entityId]!,original=body.body;body.body={family:'floater',type:'ceramic'} as never;
 const glide=parity(w,t,'walk:eden-library-1',true);assert.match(glide.would.label,/Glide/);body.body=original;
 // a faded Soul is reclaimed only by act; its dry run keeps the full path
 edge.faded.add(soul.soulId);parity(w,t,'walk:eden-library-1',false);edge.faded.delete(soul.soulId);
});
test('an area the bounded listing omits keeps the full path (its answer comes from place matching over the whole listing)',async t=>{
 const w=await setup(t);await omitFieldFromListing(w);
 parity(w,t,'walk:place-field',false);
 parity(w,t,'walk:eden-library-1',true);
});
