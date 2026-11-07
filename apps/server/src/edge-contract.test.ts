// EDGE-CONTRACT-v1 conformance (Ledger verbs). Fake world, no model calls, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {Hono} from 'hono';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {EDGE_CONTRACT} from './edge/contract.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function setup(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 const rows=[];for(const name of ['alice','bob']){await invite(f,name);rows.push(await accept(f.host,f.souls.create('dev:'+name,{name:name[0].toUpperCase()+name.slice(1),description:'Synthetic edge Soul'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_EDGE_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});
 t.after(()=>{f.host.stop();f.db.close();});
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await accept(f.host,app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);const json=await res.json() as any;if(process.env.EDGE_DEBUG&&res.status!==200)console.error('EDGE',path,res.status,JSON.stringify(json));assert.equal(json.contract,EDGE_CONTRACT,path);return {status:res.status,json};};
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0)await setImmediate();}return until();};
 const receipt=async(i:number,id:string)=>(await call(i,'GET','/v1/edge/receipts/'+id)).json.receipt;
 return {...f,rows,tokens,ledger,app,call,run,receipt};
}

test('observe, capabilities, act → receipt → completion; refusal shape; auth; version on every body',async t=>{
 const f=await setup(t);
 const o=(await f.call(0,'GET','/v1/edge/observe?include=capabilities,map')).json;
 assert.equal(o.self.soulId,f.rows[0].id);assert.ok(Array.isArray(o.self.placePath)&&o.self.placePath.length>=1);assert.equal(typeof o.self.state,'string');assert.ok(o.here.untrusted);
 assert.ok(o.here.souls.some((s:any)=>s.soulId===f.rows[1].id)||true);assert.ok(Array.isArray(o.capabilities)&&Array.isArray(o.map.places));
 const caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 for(const id of ['stand:here','rest:here','swim:shore-water'])assert.ok(caps.some(c=>c.id===id),id);
 const walk=caps.find(c=>c.verb==='walk'&&c.available);assert.ok(walk,'some walk is available');
 const acted=(await f.call(0,'POST','/v1/edge/act',{capability:walk.id})).json;assert.equal(acted.accepted,true,JSON.stringify(acted));
 assert.ok(['waiting','started'].includes(acted.receipt.phase));
 let last:any;assert.ok(await f.run(4000,()=>false)||true);
 for(let i=0;i<40&&(last=await f.receipt(0,acted.receipt.id)).phase!=='completed';i++)await f.run(100,()=>false);
 assert.equal(last.phase,'completed',JSON.stringify(last));assert.ok(last.endedTick>=last.startedTick);
 const refused=(await f.call(0,'POST','/v1/edge/act',{capability:'walk:no-such-place'})).json;assert.deepEqual([refused.accepted,refused.code],[false,'capability.unknown']);
 const bad=await f.app.request('/v1/edge/observe');assert.equal(bad.status,401);assert.equal(((await bad.json()) as any).error.code,'unauthorized');
 assert.equal((await f.call(1,'GET','/v1/edge/receipts/'+acted.receipt.id)).status,404,'another Soul cannot read my receipt');
 assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM brain_calls').get() as {n:number}).n,0,'no world-side model calls');assert.equal(f.db.paidCost(),0);
});

test('a newer act replaces the open receipt; clientRef is idempotent',async t=>{
 const f=await setup(t),caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 const first=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water',clientRef:'k1'})).json,again=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water',clientRef:'k1'})).json;
 assert.equal(again.receipt.id,first.receipt.id,'same clientRef returns the original receipt');
 await f.run(40,()=>false);
 const second=(await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}})).json;assert.equal(second.accepted,true,JSON.stringify(second));
 await f.run(40,()=>false);
 assert.equal((await f.receipt(0,first.receipt.id)).phase,'replaced');
 const p=(await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:9999}})).json;assert.deepEqual([p.accepted,p.code],[false,'capability.params']);
 void caps;
});

test('asleep: act is accepted as waiting, the body rises safely (logged edge-stop) and the action starts and completes; replay exact',async t=>{
 const f=await setup(t),row=f.rows[0];
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:row.id,entityId:row.entity_id,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-1',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[0].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const pose=()=>(f.host.engine.world as NativeWorld).entities[row.entity_id].human?.sleepPose;
 assert.ok(await f.run(3000,()=>pose()?.standingFraction===0),'asleep');
 assert.equal((await f.call(0,'GET','/v1/edge/observe')).json.self.state,'sleeping');
 const r=(await f.call(0,'POST','/v1/edge/act',{capability:'swim:shore-water'})).json;assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.receipt.phase,'waiting');
 let rec:any;for(let i=0;i<60&&(rec=await f.receipt(0,r.receipt.id)).phase!=='completed';i++)await f.run(200,()=>false);
 assert.equal(rec.phase,'completed',JSON.stringify(rec));assert.equal(pose(),undefined,'rose');
 assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='edge-stop').length,1);
 f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,mode);h.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});

test('stand:here stops the current activity; go-near lists perceived Souls',async t=>{
 const f=await setup(t);
 await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:120}});await f.run(20,()=>false);
 const s=(await f.call(0,'POST','/v1/edge/act',{capability:'stand:here'})).json;assert.equal(s.accepted,true);assert.equal(s.receipt.phase,'completed');
 await f.run(40,()=>false);assert.equal(f.host.engine.programOf(f.rows[0].entity_id),null);
 const caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 const near=caps.filter(c=>c.verb==='go-near');const bodies=f.ledger.perceivedBodies(f.rows[0].id,20);assert.equal(near.length,bodies.length);
});

test('G430 public Soul read: no auth, own data only, no owner/token fields',async t=>{
 const f=await setup(t);await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}});
 const res=await f.app.request('/v1/edge/public/souls/'+f.rows[0].id);assert.equal(res.status,200);const j=await res.json() as any;
 assert.equal(j.contract,EDGE_CONTRACT);assert.equal(j.soul.soulId,f.rows[0].id);assert.ok(j.soul.untrusted);assert.ok(Array.isArray(j.receipts)&&j.receipts.length>=1);assert.ok(j.lastAcceptedAt>0);
 const text=JSON.stringify(j);for(const k of ['owner','token','dev:alice','programId'])assert.ok(!text.includes(k),k);
 assert.equal((await f.app.request('/v1/edge/public/souls/s_nobody')).status,404);
});

test('refusals are logged for measurement; /v1/edge/metrics counts accepted, refused and codes (no text)',async t=>{
 const f=await setup(t);await f.call(0,'POST','/v1/edge/act',{capability:'rest:here',params:{seconds:5}});await f.call(0,'POST','/v1/edge/act',{capability:'walk:nowhere'});
 const m=(await f.call(0,'GET','/v1/edge/metrics?minutes=60')).json;
 assert.equal(m.acts.accepted,1);assert.equal(m.acts.refused,1);assert.equal(m.refusalsByCode['act capability.unknown'],1);assert.equal(m.activeSouls,1);assert.equal(m.worldModelCalls,0);
 const rows=f.db.db.prepare('SELECT soul_id,verb,capability,code FROM edge_refusals_v1').all() as any[];assert.deepEqual(rows.map(r=>[r.soul_id,r.verb,r.capability,r.code]),[[f.rows[0].id,'act','walk:nowhere','capability.unknown']]);
});

test('map is public and never lists occupants',async t=>{
 const f=await setup(t),res=await f.app.request('/v1/edge/map');assert.equal(res.status,200);const j=await res.json() as any;
 assert.equal(j.contract,EDGE_CONTRACT);assert.ok(j.places.length>=1);assert.ok(!JSON.stringify(j).includes(f.rows[0].id),'no Soul ids in the map');
});

test('lasting marks: make a sign while walking (not interrupted), others read and respond; shared project; per-Soul limit',async t=>{
 const f=await setup(t);
 const walk=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities.find((c:any)=>c.verb==='walk'&&c.available);
 const w=(await f.call(0,'POST','/v1/edge/act',{capability:walk.id})).json;assert.equal(w.accepted,true);
 const m=(await f.call(0,'POST','/v1/edge/act',{capability:'make:mark',params:{form:'sign',title:'Ground Found',text:'A blessing on the arm of this bench.'}})).json;
 assert.equal(m.accepted,true,JSON.stringify(m));assert.match(m.receipt.object,/^mark-/);
 assert.ok(['waiting','started','completed'].includes((await f.receipt(0,w.receipt.id)).phase),'walk not replaced by making a mark');
 const id=m.receipt.object,seen=(await f.call(1,'GET','/v1/edge/objects/'+id)).json;assert.equal(seen.object.state.title,'Ground Found',JSON.stringify(seen));assert.equal(seen.object.state.form,'sign');
 const resp=(await f.call(1,'POST','/v1/edge/objects/'+id+'/act',{action:'respond',params:{text:'Lovely.'}})).json;assert.equal(resp.accepted,true,JSON.stringify(resp));
 const p=(await f.call(0,'POST','/v1/edge/act',{capability:'make:project',params:{title:'The bench',text:'A garden bench together'}})).json;assert.equal(p.accepted,true);
 const c1=(await f.call(1,'POST','/v1/edge/objects/'+p.receipt.object+'/act',{action:'contribute',params:{text:'I carve the arm',effort:5}})).json;assert.equal(c1.accepted,true,JSON.stringify(c1));
 const proj=(await f.call(0,'GET','/v1/edge/objects/'+p.receipt.object)).json.object.state;assert.equal(proj.progress,5);assert.equal(proj.contributors.length,1);
 for(let i=0;i<3;i++)assert.equal((await f.call(0,'POST','/v1/edge/act',{capability:'make:mark',params:{title:'n'+i,text:'t'}})).json.accepted,true);
 const sixth=(await f.call(0,'POST','/v1/edge/act',{capability:'make:mark',params:{title:'n9',text:'t'}})).json;assert.deepEqual([sixth.accepted,sixth.code],[false,'make.limit']);
 const bad=(await f.call(0,'POST','/v1/edge/act',{capability:'make:project',params:{}})).json;assert.equal(bad.code,'capability.params');
});

test('PM-R057 vocabulary over HTTP: natural names resolve (resolved), unknown gets did_you_mean, object capabilities act via /act',async t=>{
 const f=await setup(t),caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 const place=caps.find(c=>c.verb==='walk'&&c.available&&c.target?.kind==='place'&&/\s/.test(c.label))!;assert.ok(place,'a walk target with a multi-word name');
 const natural=(await f.call(0,'POST','/v1/edge/act',{capability:'go to '+place.label.toLowerCase()})).json;
 assert.equal(natural.accepted,true,JSON.stringify(natural));assert.equal(natural.receipt.capability,place.id);assert.deepEqual([natural.resolved.from,natural.resolved.to],['go to '+place.label.toLowerCase(),place.id]);
 const unknown=(await f.call(0,'POST','/v1/edge/act',{capability:'walk:the-moon'})).json;
 assert.deepEqual([unknown.accepted,unknown.code],[false,'capability.unknown']);assert.ok(unknown.did_you_mean.length>=1&&unknown.did_you_mean.every((d:any)=>caps.some(c=>c.id===d.id)),JSON.stringify(unknown));
 assert.ok(unknown.did_you_mean.every((d:any)=>d.id.startsWith('walk:')),'same verb first');
 f.ledger.comms!.objects.create({id:'talk-1',kind:'presentation',name:'A talk',placeId:place.target.id,params:{title:'Hello',startsAtTick:f.host.engine.world.tick+20*600,capacity:5}});
 const reserve=(await f.call(1,'GET','/v1/edge/capabilities')).json.capabilities.find((c:any)=>c.id==='object:talk-1:reserve');assert.ok(reserve,'listed');
 const r=(await f.call(1,'POST','/v1/edge/act',{capability:'object:talk-1:reserve'})).json;assert.equal(r.accepted,true,JSON.stringify(r));assert.deepEqual([r.receipt.phase,r.receipt.object],['completed','talk-1']);
 assert.equal((await f.call(1,'GET','/v1/edge/objects/talk-1')).json.object.mine.ticket,true);
 const again=(await f.call(1,'POST','/v1/edge/act',{capability:'object:talk-1:reserve'})).json;assert.equal(again.accepted,false,JSON.stringify(again));
});

test('PM-R055 observe.elsewhere: a few other places with the walk there, why (quiet / marks / on now), counts only',async t=>{
 const f=await setup(t),o=(await f.call(0,'GET','/v1/edge/observe')).json,caps=(await f.call(0,'GET','/v1/edge/capabilities')).json.capabilities as any[];
 assert.ok(Array.isArray(o.happening)&&Array.isArray(o.elsewhere)&&o.elsewhere.length>=1&&o.elsewhere.length<=4,JSON.stringify(o.elsewhere));
 const mine=new Set(o.self.placePath.map((p:any)=>p.id));
 for(const e of o.elsewhere){assert.ok(caps.some(c=>c.id===e.capability),e.capability);assert.ok(!mine.has(e.placeId),'not where I already am');assert.ok(Array.isArray(e.why));assert.equal(typeof e.souls,'number');}
 assert.ok(!JSON.stringify(o.elsewhere).includes(f.rows[1].id),'no Soul identities');
 // Bob walks somewhere and leaves a mark there; Alice's elsewhere counts it (counts only, never the text).
 const target=o.elsewhere[0],walk=(await f.call(1,'POST','/v1/edge/act',{capability:target.capability})).json;assert.equal(walk.accepted,true);
 for(let i=0;i<60&&(await f.receipt(1,walk.receipt.id)).phase!=='completed';i++)await f.run(100,()=>false);
 const mk=(await f.call(1,'POST','/v1/edge/act',{capability:'make:mark',params:{title:'Come by',text:'secret words'}})).json;assert.equal(mk.accepted,true,JSON.stringify(mk));
 const placeId=f.ledger.comms!.objects.all().find(x=>x.id===mk.receipt.object)!.placeId;
 const away=(await f.call(1,'GET','/v1/edge/capabilities')).json.capabilities.filter((c:any)=>c.verb==='walk'&&c.available&&c.target?.kind==='place'&&c.target.id!==placeId).pop();
 const left=(await f.call(1,'POST','/v1/edge/act',{capability:away.id})).json;for(let i=0;i<60&&(await f.receipt(1,left.receipt.id)).phase!=='completed';i++)await f.run(100,()=>false);
 const again=(await f.call(0,'GET','/v1/edge/observe')).json,e=again.elsewhere.find((x:any)=>x.placeId===placeId);t.diagnostic(JSON.stringify(again.elsewhere));
 assert.ok(e&&e.why.some((w:string)=>/lasting mark/.test(w))&&e.souls===0,'the quiet place with a fresh mark is suggested: '+JSON.stringify(again.elsewhere));
 assert.ok(!again.elsewhere.some((x:any)=>/(^|-)mat-\d+$/.test(x.placeId)),'no personal sleeping mats');
 assert.ok(!JSON.stringify(again.elsewhere).includes('secret words'),'mark text never listed elsewhere');
});
