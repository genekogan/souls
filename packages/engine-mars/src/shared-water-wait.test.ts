import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from './retained-shore-engine.ts';
import type {Engine} from '@souls/engine-contract';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {SHORE_POLICY} from '../../../mars/viewer/engine/locomotion/shore.ts';
const geometry=(await connectedCommonsShoreFixture()).geometry;
const factory=await retainedCommonsShoreFactory();
const policy='shared-water-wait/1';
function setup(legacyRetry=true){
 const e=factory.create(factory.genesis('shared-water-wait-fixture'));
 e.spawnHuman({id:'h_actor',label:'scripted native swimmer',soul:'fixture'});
 const provisions=e.previewCommonsProvisionsV1!();assert.ok(provisions.ok,JSON.stringify(provisions));if(provisions.ok)e.adoptCommonsProvisionsV1!(provisions.transition);
 const shore=e.previewRetainedCommonsShoreV1!();assert.ok(shore.ok,JSON.stringify(shore));if(shore.ok)e.adoptRetainedCommonsShoreV1!(shore.transition);
 if(legacyRetry)(e as any).configureRuntimePolicy({sleepBlockTicks:1200,yieldTimeoutV1:true});
 const region=e.world.regions['shore-water'],mid=[0,1].map(k=>region.polygon.reduce((n,p)=>n+p[k],0)/region.polygon.length);
 const entry=e.perform({actor:'h_actor',label:'actual native fixture swimming to open water',steps:[{verb:'walk_to',params:{to:mid}}]});assert.ok(entry.ok,JSON.stringify(entry));assert.equal(finish(e,entry.id).kind,'completed');assert.equal(e.world.entities.h_actor.human!.activity,'tread');return e;
}
function lateHuman(e:Engine,prefix='h_crossing',stationaryHuman?:unknown){
 const a=e.world.entities.h_actor;
 // Eight physically separated scripted fixture humans occupy the first swept
 // water segments AFTER admission. Actual native capsules/shore planner run.
 for(let i=0;i<8;i++){const id=prefix+i,angle=i*Math.PI/4;e.spawnHuman({id,label:'late native water occupant',soul:'fixture'});const b=e.world.entities[id];b.pose.p=[a.pose.p[0]+Math.cos(angle)*.8,a.pose.p[1],a.pose.p[2]+Math.sin(angle)*.8];b.human=structuredClone(stationaryHuman??a.human) as any;const point=geometry.point([b.pose.p[0],b.pose.p[2]])!;assert.ok(point);const floating=point.depth>=SHORE_POLICY.floatingRootBelowDatum;b.pose.p[1]=floating?geometry.datumY-SHORE_POLICY.floatingRootBelowDatum:point.point[1];b.human!.activity=floating?'tread':'idle';(b.human as any).shore={contract:'shore-contact/1',terrainId:geometry.terrainId,waterId:geometry.waterId,mode:floating?'buoyant':'bed',bedY:point.point[1],datumY:geometry.datumY,depthMetres:point.depth,submergedHeightMetres:Math.max(0,Math.min(b.pose.p[1]+SHORE_POLICY.height,geometry.datumY)-Math.max(b.pose.p[1],point.point[1])),normal:point.normal};}
}
function leave(e:Engine,prefix='h_crossing'){const a=e.world.entities.h_actor;for(let i=0;i<8;i++){const angle=i*Math.PI/4,p=e.perform({actor:prefix+i,label:'actual native occupant clears the water route',steps:[{verb:'walk_to',params:{to:[a.pose.p[0]+Math.cos(angle)*2,a.pose.p[2]+Math.sin(angle)*2]}}]});assert.ok(p.ok,JSON.stringify(p));}}
function finish(e:Engine,id:string){for(let i=0;i<4000;i++){const r=e.step();assert.deepEqual(e.runtime.violations,[]);const terminal=r.programs.find(p=>p.id===id&&p.kind!=='step');if(terminal)return terminal;}throw Error('programme did not finish within native bound');}
for(const later of [false,true])test(`prospective water wait survives actual late human at ${later?'later lowering before soft lap op':'first lowering'}`,()=>{
 const e=setup(),walk={verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}};
 const p=e.perform({actor:'h_actor',label:'scripted late crossing seam',steps:[...(later?[{verb:'rest',params:{seconds:1}}]:[]),walk,{verb:'rest',params:{seconds:1}}]});assert.ok(p.ok,JSON.stringify(p));lateHuman(e);
 const initial=[...e.world.entities.h_actor.pose.p];let failed:any;
 for(let i=0;i<(later?25:5);i++){const r=e.step();failed??=r.programs.find(x=>x.id===p.id&&x.kind==='failed');assert.deepEqual(e.runtime.violations,[]);}
 assert.equal(failed,undefined,JSON.stringify(failed));assert.deepEqual(e.world.entities.h_actor.pose.p,initial,'occupied route must not move through a body');
 leave(e);assert.equal(finish(e,p.id).kind,'completed');assert.equal(e.world.entities.h_actor.human!.activity,'tread');
});

test('each prospective water leg gets its own bounded wait after actual earlier wait consumption',()=>{
 const e=setup(),walk={verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}},p=e.perform({actor:'h_actor',label:'actual two contested water legs',steps:[{verb:'rest',params:{seconds:1}},walk,{verb:'rest',params:{seconds:1}},walk,{verb:'rest',params:{seconds:1}}]});assert.ok(p.ok,JSON.stringify(p));lateHuman(e);
 for(let i=0;i<1120;i++){const r=e.step();assert.ok(!r.programs.some(x=>x.id===p.id&&x.kind==='failed'),JSON.stringify(r.programs));assert.deepEqual(e.runtime.violations,[]);}
 leave(e);let between=false;
 for(let i=0;i<1400;i++){const out=e.step();assert.ok(!out.programs.some(x=>x.id===p.id&&x.kind==='failed'),JSON.stringify(out.programs));assert.deepEqual(e.runtime.violations,[]);if((e.snapshot() as any).programs.find((x:any)=>x.id===p.id)?.index===2){between=true;break;}}
 assert.ok(between,'first real water leg completed into its ordinary rest');lateHuman(e,'h_second');
 for(let i=0;i<240;i++){const out=e.step();assert.ok(!out.programs.some(x=>x.id===p.id&&x.kind==='failed'),JSON.stringify(out.programs));assert.deepEqual(e.runtime.violations,[]);}
 leave(e,'h_second');assert.equal(finish(e,p.id).kind,'completed');
});

test('permanent body obstruction stays bounded and never becomes an arrival',()=>{
 const e=setup(),initial=[...e.world.entities.h_actor.pose.p],p=e.perform({actor:'h_actor',label:'bounded body crowd',steps:[{verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}}]});assert.ok(p.ok);lateHuman(e);const begin=e.world.tick,terminal=finish(e,p.id);assert.equal(terminal.kind,'failed');assert.equal(terminal.code,'shore.occupied-route');assert.ok(e.world.tick-begin<=1201);assert.ok(Math.hypot(e.world.entities.h_actor.pose.p[0]-initial[0],e.world.entities.h_actor.pose.p[2]-initial[2])<.25,'native approach stops before the .8m ring of .28m capsules');assert.equal(e.world.entities.h_actor.human!.activity,'tread');
});
test('static occupied water route is refused without turning into a body wait',()=>{
 const e=setup(),a=e.world.entities.h_actor,p=e.perform({actor:'h_actor',label:'actual static water obstruction',steps:[{verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}}]});assert.ok(p.ok);
 for(let i=0;i<8;i++){const angle=i*Math.PI/4,id='fixture-chair'+i;e.world.entities[id]={id,def:'camp-chair',kind:'fixture',pose:{p:[a.pose.p[0]+Math.cos(angle)*1.2,(a.human as any).shore.bedY,a.pose.p[2]+Math.sin(angle)*1.2],yaw:0},provenance:{origin:'test-fixture',confidence:'hypothetical'},support:{kind:'ground'}} as any;}
 const terminal=e.step().programs.find(x=>x.id===p.id&&x.kind!=='step');assert.equal(terminal?.kind,'failed',JSON.stringify(terminal));assert.equal(terminal?.code,'shore.occupied-route');assert.deepEqual(e.runtime.violations,[]);
});
test('explicit unknown policy refuses and a finite waiting snapshot resumes exactly',()=>{
 const e=setup(false),unknown={actor:'h_actor',label:'unsupported future policy',steps:[{verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:'shared-water-wait/9'}}]},hash=e.stateHash();assert.equal(e.canPerform(unknown)?.code,'action.invalid-spread-wait-policy');assert.equal(e.stateHash(),hash);
 const p=e.perform({...unknown,steps:[{verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}},{verb:'rest',params:{seconds:1}}]});assert.ok(p.ok);lateHuman(e);for(let i=0;i<45;i++)e.step();
 const snap=e.snapshot(),copy=factory.restore(snap);assert.equal(copy.stateHash(),e.stateHash());leave(e);leave(copy);let terminal=false;
 for(let i=0;i<1500&&!terminal;i++){const a=e.step(),b=copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.deepEqual(b.programs,a.programs);terminal=a.programs.some(x=>x.id===p.id&&x.kind==='completed');}assert.ok(terminal);
 const tampered=structuredClone(snap) as any;tampered.programs[0].steps[0].params.spreadWaitPolicy='shared-water-wait/9';assert.throws(()=>factory.restore(tampered),/unknown-spread-wait-policy/);
});

test('accepted soft water action blocked by late bodies exhausts as failure rather than skipped arrival',()=>{
 const e=setup(),stationary=structuredClone(e.world.entities.h_actor.human),p=e.perform({actor:'h_actor',label:'late body after actual native submission',steps:[{verb:'walk_to',params:{to:'shore-water',spread:'pond-lap/1',spreadWaitPolicy:policy}},{verb:'rest',params:{seconds:1}}]});assert.ok(p.ok);e.step();e.step();assert.ok((e.snapshot() as any).programs.find((x:any)=>x.id===p.id)?.action,'native action has actually been submitted');lateHuman(e,'h_crossing',stationary);const initial=[...e.world.entities.h_actor.pose.p],start=e.world.tick,terminal=finish(e,p.id);assert.equal(terminal.kind,'failed');assert.equal(terminal.code,'shore.occupied-route');assert.ok(e.world.tick-start<=2600,'native hold plus actual renewals remain bounded');assert.ok(Math.hypot(e.world.entities.h_actor.pose.p[0]-initial[0],e.world.entities.h_actor.pose.p[2]-initial[2])<.25,'native approach stops before the .8m ring of .28m capsules');assert.equal(e.world.entities.h_actor.human!.activity,'tread');
});
