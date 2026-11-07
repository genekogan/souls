import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf,type Engine,type ProgramEvent} from '@souls/engine-contract';
import {connectedCommonsShoreFactory} from './connected-shore-engine.ts';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
import {probeNativeHumanBirth} from './birth.ts';
import {loadMars} from './load.ts';
import {regionSlots} from '../../../mars/viewer/engine/social/slots.ts';

// Native eventCursor is a local subscriber cursor; restore starts a new event
// window. Compare all canonical adapter/native graph fields, excluding it only.
const graph=(snapshot:any)=>{const {eventCursor,...mars}=snapshot.mars;return {...snapshot,mars};};
const tick=(e:Engine,n:number)=>{const events:ProgramEvent[]=[];for(let i=0;i<n;i++)events.push(...e.step().programs);return events;};
test('fresh adapter admits a detached birth and ordinary body-language travel through native shore phases with exact recovery and paired takes',async()=>{
  const f=await connectedCommonsShoreFactory(),e=f.create(f.genesis('connected-adapter'));
  const probe=probeNativeHumanBirth(e,f,{id:'h',label:'Hypothetical native fixture',soul:'hypothetical-fixture'});assert.equal(probe.outcome,'ready');
  e.spawnHuman({id:'h',label:'Hypothetical native fixture',soul:'hypothetical-fixture'});
  assert.ok(e.describeVerbs().some(v=>v.verb==='mars:commons_shore_travel'));
  const p=e.perform({actor:'h',label:'go to calm shore water',steps:[{verb:'walk_to',params:{to:'shore-water',standoff:0}}]});assert.equal(p.ok,true,JSON.stringify(p));
  const phases=new Set<string>(),events:ProgramEvent[]=[];let copy:Engine|undefined;
  for(let i=0;i<2400&&e.programOf('h');i++){
    const out=e.step();events.push(...out.programs);phases.add(e.world.entities.h.human!.activity);
    if(copy){copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(hashOf(graph(copy.snapshot())),hashOf(graph(e.snapshot())));}
    if(e.world.entities.h.human!.activity==='swim'&&!copy){copy=f.restore(JSON.parse(JSON.stringify(e.snapshot())));assert.equal(copy.stateHash(),e.stateHash());}
  }
  assert.ok(phases.has('walk')&&phases.has('wade')&&phases.has('swim'));assert.equal(events.filter(v=>v.id===p.id&&v.kind==='completed').length,1);
  assert.equal(e.regionAt(e.world.entities.h.pose.p),'shore-water');assert.equal(e.world.entities.h.human!.activity,'tread');assert.deepEqual(e.runtime.violations,[]);
  assert.ok(e.takeChunks!(0).length);for(const c of e.takeChunks!(0)){const take=c.take as {rulesVersion:string;renderSceneRef:{hash:string}};assert.equal(take.rulesVersion,f.rulesVersion);const scene=e.takeScene!(take.renderSceneRef.hash)!;assert.ok(scene);assert.equal(scene.body.shore!.physicalBase.staticHash,e.world.base.staticHash);}
  const before=e.stateHash();e.compact!();assert.equal(e.stateHash(),before);assert.equal(f.restore(e.snapshot()).stateHash(),before);
  const back=e.perform({actor:'h',label:'return to commons',steps:[{verb:'walk_to',params:{to:'commons',standoff:0}}]});assert.equal(back.ok,true,JSON.stringify(back));
  const ended=tick(e,2200);assert.equal(ended.filter(v=>v.id===back.id&&v.kind==='completed').length,1);assert.deepEqual(e.world.entities.h.pose.p,[9,0,5]);assert.equal((e.world.entities.h.human as any).shore,undefined);assert.deepEqual(e.runtime.violations,[]);
});

test('fresh adapter and legacy commons fence foreign bases, rules, config, snapshot tampering and adoption in both directions',async()=>{
  const f=await connectedCommonsShoreFactory(),old=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1:true}),e=f.create(f.genesis('fences')),legacy=old.create(old.genesis('fences'));
  assert.equal(f.canReplayHistory!(old.rulesVersion),false);assert.equal(old.canReplayHistory!(f.rulesVersion),false);assert.equal(f.canRestoreSnapshot!(old.rulesVersion),false);assert.equal(old.canRestoreSnapshot!(f.rulesVersion),false);
  assert.throws(()=>f.create(legacy.world),/physical base differs/);assert.throws(()=>old.create(e.world),/physical base differs/);assert.throws(()=>old.restore(e.snapshot()),/physical binding differs/);assert.throws(()=>f.restore(legacy.snapshot()),/snapshot-binding-differs/);
  const a=e.snapshot() as any;a.cfg.walkBlockV1=false;assert.throws(()=>f.restore(a),/snapshot-policy-differs/);
  const b=e.snapshot();b.stateHash='0'.repeat(64);assert.throws(()=>f.restore(b),/snapshot-state-differs/);
  assert.throws(()=>e.adoptCamp!(),/adoption-unqualified/);assert.equal(f.restore(e.snapshot()).stateHash(),e.stateHash());
});

test('explicit deep-water stop and new return preserve actual buoyancy and native terminal associations',async()=>{
  const f=await connectedCommonsShoreFactory(),e=f.create(f.genesis('deep-stop'));e.spawnHuman({id:'h',label:'Hypothetical native fixture',soul:'fixture'});
  const p=e.perform({actor:'h',label:'swim',steps:[{verb:'walk_to',params:{to:'shore-water'}}]});assert.equal(p.ok,true);
  for(let i=0;i<2400&&e.world.entities.h.human!.activity!=='swim';i++)e.step();assert.equal(e.world.entities.h.human!.activity,'swim');
  const at=[...e.world.entities.h.pose.p],action=e.programAction!(p.id)!;assert.equal(action.action.verb,'commons_shore_travel');e.stop(p.id);
  assert.equal(e.runtime.records.get(action.action.id)!.status,'cancelled');assert.equal(e.programOf('h'),null);assert.deepEqual(e.world.entities.h.pose.p,at);assert.equal(e.world.entities.h.human!.activity,'tread');
  const copy=f.restore(e.snapshot());for(let i=0;i<20;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.deepEqual(e.world.entities.h.pose.p,at);}
  const back=e.perform({actor:'h',label:'return',steps:[{verb:'walk_to',params:{to:'commons'}}]});assert.equal(back.ok,true);tick(e,2200);assert.equal(e.programOf('h'),null);assert.deepEqual(e.world.entities.h.pose.p,[9,0,5]);assert.deepEqual(e.runtime.violations,[]);
});

async function blockedCompositeFixture(){
  const f=await connectedCommonsShoreFactory(),m=await loadMars(),w=f.genesis('deferred-stop');
  const region={id:'hold',label:'Hypothetical landing hold',provenance:{origin:'test-fixture' as const,confidence:'hypothetical' as const},kind:'place' as const,level:1,polygon:[[8.9,-2.71],[9.1,-2.71],[9.1,-.7],[8.9,-.7]] as [number,number][],layout:{focus:[9,1] as [number,number],kind:'stand' as const}};w.regions.hold=region;
  // Native slot geometry is unchanged on commons; these are low-level fixtures.
  const rt=new m.Runtime(w,m.createRegistry(),m.servicesFor({...m.scenes,[w.base.campus]:m.scenes['eden-commons']})(w),m.invariants),slot=regionSlots(rt,region).find(s=>Math.abs(s.p[1]+1.7)<1e-8)!;assert.ok(slot);
  w.entities.blocker=m.human('blocker',slot.p[0],slot.p[1],{level:1,y:.24,yaw:slot.yaw});w.entities.h=m.human('h',9,.8,{yaw:-Math.PI/2});const e=f.create(w);
  assert.notEqual(e.submit('take_slot',{actor:'blocker',slot:slot.id}).status,'failed');tick(e,20);
  const p=e.perform({actor:'h',label:'deck',steps:[{verb:'mars:commons_shore_travel',params:{x:9,z:-1.8,level:1}}]});assert.equal(p.ok,true);tick(e,250);assert.equal(e.world.entities.h.human!.activity,'climb-wait');assert.equal(e.programAction!(p.id)!.action.verb,'commons_shore_travel');
  return {f,e,id:p.id};
}

test('unsafe between-level replacement is read-only refused; explicit stop stays live until native landing becomes safe',async()=>{
  const {f,e,id}=await blockedCompositeFixture();
  const replacement={actor:'h',label:'water instead',steps:[{verb:'walk_to',params:{to:'shore-water'}}]};const before=e.stateHash(),preview=e.previewAdmission!(replacement);assert.equal(preview.ok,false);assert.equal(preview.diagnostic!.code,'program.safe-stop-required');assert.equal(e.stateHash(),before);
  assert.equal(e.perform(replacement).ok,false);assert.equal(e.stateHash(),before);assert.equal(e.programOf('h'),id);
  e.stop(id);assert.equal(e.programOf('h'),id);assert.ok(e.runtime.liveIds().includes(e.programAction!(id)!.action.id));const copy=f.restore(e.snapshot());
  for(let i=0;i<30;i++){const out=e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());assert.equal(out.programs.some(v=>v.id===id&&v.kind==='cancelled'),false);}
  const clear={actor:'blocker',label:'clear landing',steps:[{verb:'walk_to',params:{to:[9.9,-1.7]}}]};assert.equal(e.perform(clear).ok,true);assert.equal(copy.perform(clear).ok,true);
  const ends:ProgramEvent[]=[];for(let i=0;i<200;i++){ends.push(...e.step().programs);copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  assert.equal(ends.filter(v=>v.id===id&&v.kind==='cancelled').length,1);assert.equal(e.programOf('h'),null);assert.equal(e.world.entities.h.pose.p[1],.24);assert.deepEqual(e.runtime.violations,[]);
});


test('a prolonged blocked composite keeps native stair cleanup and its program pending, then emits one true route failure after safe release',async()=>{
  const {f,e,id}=await blockedCompositeFixture(),events=tick(e,1500);
  assert.equal(e.programOf('h'),id);assert.equal(e.world.entities.h.human!.activity,'climb-wait');assert.equal(events.some(v=>v.id===id&&v.kind==='failed'),false);
  const snap=e.snapshot() as any;assert.ok(snap.programs.find((p:any)=>p.id===id).walkStopping);const copy=f.restore(snap);assert.equal(copy.stateHash(),e.stateHash());
  const clear={actor:'blocker',label:'clear landing after timeout',steps:[{verb:'walk_to',params:{to:[9.9,-1.7]}}]};assert.equal(e.perform(clear).ok,true);assert.equal(copy.perform(clear).ok,true);
  for(let i=0;i<200;i++){events.push(...e.step().programs);copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  const failure=events.filter(v=>v.id===id&&v.kind==='failed');assert.equal(failure.length,1);assert.equal(failure[0].code,'route.blocked');assert.equal(e.programOf('h'),null);assert.equal(e.world.entities.h.pose.p[1],.24);assert.deepEqual(e.runtime.violations,[]);
});
