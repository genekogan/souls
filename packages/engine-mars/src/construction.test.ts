import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, type MarsWorldConfig } from './engine.ts';
import { edenCampActivities, CAMP_ARRIVALS } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { constructionDone } from './construction.ts';
import type { Engine } from '@souls/engine-contract';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
const cfg: MarsWorldConfig={scene:'eden-camp',arrival:CAMP_ARRIVALS[0].p,arrivalPlace:'yard',reference:CAMP_ARRIVALS[1].p,grounds:{id:'grounds',name:'Camp'}};
async function setup(){const f=await marsFactory(cfg),e=f.create(f.genesis('construction-proof'));for(const [i,name] of ['Alice','Bob','Carol','David'].entries())e.spawnHuman({id:`h${i}`,label:name,soul:`s${i}`});return {f,e};}
function build(e:Engine,phase:string){const p={actor:'h0',label:`build ${phase}`,steps:[{verb:'build_lookout',params:{phase}}]};assert.equal(e.canPerform(p),null,JSON.stringify(e.canPerform(p)));const hash=e.stateHash(),world=JSON.stringify(e.world),records=JSON.stringify([...e.runtime.records]);const predicted=e.previewAdmission!(p);assert.deepEqual(e.previewAdmission!(p),predicted);assert.equal(e.stateHash(),hash);assert.equal(JSON.stringify(e.world),world);assert.equal(JSON.stringify([...e.runtime.records]),records);const r=e.perform(p);assert.deepEqual(r,predicted);assert.equal(r.ok,true,JSON.stringify(r));return r.id;}
function finish(e:Engine,id:string,cancelled=false){for(let n=0;n<90000;n++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const ev=out.programs.find(p=>p.id===id&&['completed','failed','cancelled'].includes(p.kind));if(ev){assert.equal(ev.kind,cancelled?'cancelled':'completed',JSON.stringify(ev));return;}}assert.fail('finite construction did not finish');}
test('finite chosen jobs assemble all original parts, survive fresh Runtime, and refuse repeated work',async()=>{
 const {f,e}=await setup();
 for(const phase of ['stage','frame','deck','stairs']){finish(e,build(e,phase));assert.equal(e.canPerform({actor:'h0',label:'repeat',steps:[{verb:'build_lookout',params:{phase}}]})?.code,'construction.done');}
 const w=e.world as WorldState;
 for(const a of edenCampActivities().filter(a=>a.id.startsWith('build.')&&a.id!=='build.climb-lookout'))assert.equal(constructionDone(w,a),true,a.id);
 assert.equal(Object.values(w.entities).filter(e=>e.kind==='component'&&e.phase==='installed').length,24);
 e.beginQuiet!();for(let i=0;i<500&&!e.isQuiet!();i++)e.step();assert.equal(e.isQuiet!(),true);
 const before=e.physicalHash();e.compact!();assert.equal(e.physicalHash(),before);
 const fresh=f.create(structuredClone(e.world));for(let i=0;i<100;i++)fresh.step();assert.deepEqual(fresh.runtime.violations,[]);
 for(const a of edenCampActivities().filter(a=>a.id.startsWith('build.')&&a.id!=='build.climb-lookout'))assert.equal(constructionDone(fresh.world as WorldState,a),true,a.id);
});
test('stop and daily quiet drain an in-flight frame to safe support; crew cannot be stolen',async()=>{
 const {e}=await setup();finish(e,build(e,'stage'));const id=build(e,'frame');let held=false;
 for(let i=0;i<90000;i++){e.step();const w=e.world as WorldState;if(['upright-a','upright-b'].every(id=>w.entities[id].support?.kind==='held')){held=true;break;}}
 assert.equal(held,true);assert.equal(e.canSnapshot!(),false);assert.throws(()=>e.snapshot(),{code:'snapshot.non-resumable'});
 assert.equal(e.canPerform({actor:'h2',label:'other work',steps:[{verb:'rest',params:{seconds:1}}]})?.code,'construction.committed');
 const hash=e.stateHash(),heldWorld=JSON.stringify(e.world),preview=e.previewAdmission!({actor:'h2',label:'other work',steps:[{verb:'rest',params:{seconds:1}}]});assert.equal(preview.ok,false);assert.equal(preview.diagnostic?.code,'construction.committed');assert.equal(e.stateHash(),hash);assert.equal(JSON.stringify(e.world),heldWorld,'preview preserves the non-resumable held load');
 assert.equal(e.actorBorrowed!('h2'),true);e.stop(id);e.beginQuiet!();finish(e,id,true);
 for(let i=0;i<500&&!e.isQuiet!();i++)e.step();assert.equal(e.isQuiet!(),true);
 for(const id of ['upright-a','upright-b'])assert.equal((e.world as WorldState).entities[id].support?.kind,'connected');
 assert.deepEqual(e.runtime.violations,[]);
});

test('a directed-away native sleep purpose reports blockage and releases the daily quiet barrier',async()=>{
 const {e}=await setup();
 const r=e.perform({actor:'h0',label:'sleep in camp',steps:[{verb:'mars:sleep',params:{mat:'mat-1',duration:600}}]});assert.equal(r.ok,true);
 for(let i=0;i<20;i++)e.step();
 e.submit('walk_to',{actor:'h0',x:0,z:10},{preempt:true});
 let blocked=false;
 for(let i=0;i<10000;i++){e.step();if([...e.runtime.records.values()].some(r=>r.verb==='sleep'&&r.status==='blocked')){blocked=true;break;}}
 assert.ok(blocked);e.beginQuiet!();for(let i=0;i<2000;i++)e.step();assert.equal(e.isQuiet!(),false,'legacy native policy stays unchanged until activation');e.configureRuntimePolicy!({sleepBlockTicks:1200});let failed=false;
 for(let i=0;i<2000;i++){const out=e.step();if(out.programs.some(p=>p.id===r.id&&p.kind==='failed'&&p.code==='activity.blocked'))failed=true;if(e.isQuiet!())break;}
 assert.ok(failed);assert.equal(e.isQuiet!(),true);assert.deepEqual(e.runtime.violations,[]);
});

test('logged quiet courtesy lets a completed workstation exit past an idle bystander without stealing active work',async()=>{
 const {e}=await setup(), rt=(e as any).rt;
 const r=e.perform({actor:'h0',label:'computer work',steps:[{verb:'mars:work_at',params:{station:'computer-1',seat:'computer-1-chair#seat',task:'Exit proof',duration:120}}]});assert.equal(r.ok,true);
 let seat:any;
 for(let i=0;i<10000;i++){e.step();seat=[...rt.live.values()].find((x:any)=>x.rec.verb==='sit'&&x.exec.actor==='h0'&&x.exec.phase==='occupied');if(seat)break;}
 assert.ok(seat?.exec.approach);const foot=seat.exec.approach;
 const blocker=e.world.entities.h1;
 const walk=e.submit('walk_to',{actor:'h1',x:foot[0],z:foot[1]});
 for(let i=0;i<2000&&e.runtime.records.get(walk.id)?.status!=='completed';i++)e.step();
 assert.equal(e.runtime.records.get(walk.id)?.status,'completed');
 assert.ok(Math.hypot(blocker.pose.p[0]-foot[0],blocker.pose.p[2]-foot[1])<0.3);
 for(let i=0;i<3000;i++)e.step();assert.ok([...e.runtime.records.values()].some(r=>r.verb==='work_at'&&r.phase==='stopping'));
 e.beginQuiet!();for(let i=0;i<2000;i++)e.step();assert.equal(e.isQuiet!(),false,'old policy keeps the demonstrated blocked seat exit');
 const own=e.perform({actor:'h1',label:'my pause',steps:[{verb:'rest',params:{seconds:10}}]});assert.equal(own.ok,true);
 e.configureRuntimePolicy!({sleepBlockTicks:1200,quietSeatCourtesy:true});const before=[...blocker.pose.p];for(let i=0;i<100;i++)e.step();assert.deepEqual(blocker.pose.p,before,'courtesy does not seize an active program');
 for(let i=0;i<3000&&!e.isQuiet!();i++)e.step();assert.equal(e.isQuiet!(),true);assert.deepEqual(e.runtime.violations,[]);
 assert.ok([...rt.records.values()].some((r:any)=>r.internalCause==='traffic.make-way'),'ordinary native courtesy walk was used');
});
