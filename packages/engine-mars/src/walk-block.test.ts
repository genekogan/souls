import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD,GREEN_FIELD_WORLD} from './engine.ts';
import {loadMars} from './load.ts';
import {regionSlots} from '../../../mars/viewer/engine/social/slots.ts';
import type {Engine,ProgramEvent} from '@souls/engine-contract';

async function blockedDeck(walkBlockV1:boolean|undefined,z=-1.7){
  const cfg={...EDEN_SAFE_COMMONS_WORLD,walkBlockV1},f=await marsFactory(cfg),m=await loadMars(),w=f.genesis('native-walk-block');
  // Hypothetical native body fixtures, not admitted or ownerless product Souls.
  // An actual reserved standing slot prevents autonomous make-way from moving
  // the blocker. No action record, observation, pose or terminal is fabricated.
  const region={id:'hold',label:'Hypothetical landing hold',provenance:{origin:'test-fixture' as const,confidence:'hypothetical' as const},kind:'place' as const,level:1,polygon:[[8.9,z-1.01],[9.1,z-1.01],[9.1,z+1],[8.9,z+1]] as [number,number][],layout:{focus:[9,1] as [number,number],kind:'stand' as const}};
  w.regions.hold=region;
  const rt=new m.Runtime(w,m.createRegistry(),m.servicesFor(m.scenes)(w),m.invariants);
  const slots=regionSlots(rt,region),slot=slots.find(s=>Math.abs(s.p[1]-z)<1e-9);assert.ok(slot,'actual supported standing slot at the requested landing');
  w.entities.blocker=m.human('blocker',slot.p[0],slot.p[1],{level:1,y:.24,yaw:slot.yaw});
  w.entities.walker=m.human('walker',9,.8,{yaw:-Math.PI/2});
  const e=f.create(w),hold=e.submit('take_slot',{actor:'blocker',slot:slot.id});assert.notEqual(hold.status,'failed',JSON.stringify(hold));
  for(let i=0;i<20;i++)e.step();assert.equal(hold.phase,'occupied');
  const admission=e.perform({actor:'walker',label:'walk onto presentation deck',steps:[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}]});assert.equal(admission.ok,true,JSON.stringify(admission));
  return {f,e,id:admission.id,hold:hold.id};
}
function advance(e:Engine,n:number){const events:ProgramEvent[]=[];for(let i=0;i<n;i++)events.push(...e.step().programs);return events;}

test('new walk policy fences history/checkpoints in both directions and leaves false/absent legacy hashes equal',async()=>{
  for(const cfg of [GREEN_FIELD_WORLD,EDEN_SAFE_COMMONS_WORLD]){
    const old=await marsFactory(cfg),off=await marsFactory({...cfg,walkBlockV1:false}),next=await marsFactory({...cfg,walkBlockV1:true});
    assert.equal(next.rulesVersion,old.rulesVersion+'+walk-block/1');assert.equal(off.rulesVersion,old.rulesVersion);
    const a=old.create(old.genesis('identity')),b=off.create(off.genesis('identity')),c=next.create(next.genesis('identity'));
    assert.equal(a.stateHash(),b.stateHash());assert.notEqual(a.stateHash(),c.stateHash());
    for(const [reader,other] of [[old,next],[next,old]]){
      assert.equal(reader.canReplayHistory!(other.rulesVersion),false);assert.equal(reader.canRestoreSnapshot!(other.rulesVersion),false);
      assert.throws(()=>reader.restore(other.create(other.genesis('identity')).snapshot()),/walk policy differs/);
    }
    assert.equal(next.canReplayHistory!(next.rulesVersion),true);assert.equal(next.canRestoreSnapshot!(next.rulesVersion),true);
    for(const bad of [next.rulesVersion+'+walk-block/1',next.rulesVersion.replace('walk-block/1','walk-block/2')])assert.equal(next.canReplayHistory!(bad),false);
  }
});

test('actual prolonged native traffic waits reach safe cancellation before reporting program failure; snapshot continues exactly',async()=>{
  const {f,e,id}=await blockedDeck(true),events:ProgramEvent[]=[];
  let firstBlocked:number|undefined,stoppingSnapshot:ReturnType<typeof e.snapshot>|undefined,copy:Engine|undefined;
  for(let i=0;i<1500;i++){
    const out=e.step();events.push(...out.programs);if(copy){copy.step();assert.equal(copy.stateHash(),e.stateHash());}
    const current=e.programAction!(id),rec=current?e.runtime.records.get(current.action.id):undefined;
    if(rec?.status==='blocked'&&firstBlocked===undefined){firstBlocked=e.world.tick;assert.equal(rec.diagnostic?.code,'traffic.person');}
    const snap=(!copy&&firstBlocked!==undefined&&e.world.tick>firstBlocked+1200?e.snapshot():{programs:[]}) as ReturnType<typeof e.snapshot>&{programs:{walkStopping?:{code:string}}[]};
    if(snap.programs.some(p=>p.walkStopping)&&!copy){stoppingSnapshot=snap;copy=f.restore(JSON.parse(JSON.stringify(snap)));assert.equal(copy.stateHash(),e.stateHash());}
  }
  assert.ok(firstBlocked);assert.ok(stoppingSnapshot,'timeout must request an actual deferred stair cancellation');
  // The far landing remains occupied: native cleanup, body/link claims and the
  // program stay live. A failed fact at the timeout would be physically false.
  assert.equal(e.programOf('walker'),id);const pending=e.programAction!(id);assert.ok(pending);assert.ok(e.runtime.liveIds().includes(pending.action.id));assert.equal(events.some(x=>x.id===id&&x.kind==='failed'),false);
  assert.equal(e.world.entities.walker.human!.activity,'climb-wait');
  assert.deepEqual(e.runtime.violations,[]);
  // A real director intervention releases the blocker and walks it sideways;
  // the blocked body is never relocated and only its controller moves it.
  assert.equal(e.perform({actor:'blocker',label:'clear the landing',steps:[{verb:'walk_to',params:{to:[9.9,-1.7],standoff:0}}]}).ok,true);
  assert.equal(copy!.perform({actor:'blocker',label:'clear the landing',steps:[{verb:'walk_to',params:{to:[9.9,-1.7],standoff:0}}]}).ok,true);
  for(let i=0;i<200;i++){const out=e.step();events.push(...out.programs);copy!.step();assert.equal(copy!.stateHash(),e.stateHash());}
  const failure=events.filter(x=>x.id===id&&x.kind==='failed');assert.equal(failure.length,1);assert.equal(failure[0].code,'route.blocked');assert.ok(failure[0].tick>firstBlocked!+1200);
  assert.equal(e.programOf('walker'),null);assert.equal(e.world.entities.walker.human!.level,1);assert.equal(e.world.entities.walker.pose.p[1],.24);assert.deepEqual(e.runtime.violations,[]);
});

test('traffic clearing before the limit resumes the same walk without a failed/completed fiction at admission',async()=>{
  const {e,id}=await blockedDeck(true),events=advance(e,250);
  const current=e.programAction!(id);assert.ok(current);assert.equal(current.action.status,'blocked');assert.equal(e.programOf('walker'),id);
  assert.equal(events.some(x=>x.id===id&&x.kind!=='step'),false);
  assert.equal(e.perform({actor:'blocker',label:'clear the landing',steps:[{verb:'walk_to',params:{to:[9.9,-1.7],standoff:0}}]}).ok,true);
  events.push(...advance(e,200));assert.equal(events.filter(x=>x.id===id&&x.kind==='completed').length,1);assert.equal(events.some(x=>x.id===id&&x.kind==='failed'),false);
  assert.equal(e.programOf('walker'),null);assert.deepEqual(e.world.entities.walker.pose.p,[9,.24,-1.8]);assert.deepEqual(e.runtime.violations,[]);
});

test('false and absent policy retain identical legacy physical behavior, including its premature deferred-stop failure',async()=>{
  const a=await blockedDeck(false),b=await blockedDeck(undefined),events:ProgramEvent[]=[];
  for(let i=0;i<1500;i++){const out=a.e.step(),other=b.e.step();events.push(...out.programs);assert.deepEqual(other.programs,out.programs);assert.equal(b.e.stateHash(),a.e.stateHash());}
  // The native deadlock diagnostic eventually enters the old timeout branch.
  // Preserve that old replay, even its end-before-safe-cleanup fault. Only the
  // explicit new rules claim fixes the adapter's physical terminal ordering.
  assert.equal(a.e.programOf('walker'),null);assert.equal(events.filter(x=>x.id===a.id&&x.kind==='failed'&&x.code==='route.blocked').length,1);
  assert.equal(a.e.world.entities.walker.human!.activity,'climb-wait');assert.ok(a.e.runtime.liveIds().map(id=>a.e.runtime.records.get(id)!).some(r=>(r.params as {actor?:unknown}).actor==='walker'));
  assert.deepEqual(a.e.runtime.violations,[]);
});

test('timeout before halfway cancels to the supported entry, releases the walker and reports one genuine failure',async()=>{
  const {e,id}=await blockedDeck(true,-1.3),events=advance(e,1600);
  const failures=events.filter(x=>x.id===id&&x.kind==='failed');assert.equal(failures.length,1);assert.equal(failures[0].code,'route.blocked');assert.match(failures[0].message!,/traffic.person|deadlock.stalled/);
  assert.equal(e.programOf('walker'),null);assert.equal(e.world.entities.walker.human!.level,0);assert.equal(e.world.entities.walker.pose.p[1],0);assert.equal(e.world.entities.walker.human!.activity,'idle');
  const current=e.runtime.liveIds().map(id=>e.runtime.records.get(id)!);assert.ok(current.every(r=>(r.params as {actor?:unknown}).actor!=='walker'));assert.deepEqual(e.runtime.violations,[]);
});
