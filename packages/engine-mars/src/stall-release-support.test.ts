// stall-release-support/1 (#447). On the capacity bench, two Souls met head-on on a stair flight. One walk was ended
// (yieldTimeoutV1) and sat cancelling mid-flight for good. The edge stall guard then released it, and stallReleaseV1
// stood a body on an upper level exactly where it was: off its level's floor. The next tick faulted
// (collision.human-static). Every recovery plan replayed the same logged release, and the world paused.
// With the policy, a released upper-level body stands where it is only if the floor holds it there; otherwise it goes
// to the nearer free landing of its stair link; otherwise it is not released at all. Histories that predate the policy
// keep the old placement byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD,type MarsEngine} from './engine.ts';

const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
const REASON={code:'stall.released',message:'Synthetic stall release (fixture)'};
type E=MarsEngine&Record<string,any>;
const walk=(e:E,id:string,x:number,z:number,level:number)=>{const p=e.perform({actor:id,label:'fixture walk',steps:[{verb:'mars:walk_to',params:{x,z,level}}]});assert.ok(p.ok,JSON.stringify(p));};
const settle=(e:E,id:string)=>{for(let i=0;i<900&&e.programOf(id);i++)e.step();assert.equal(e.programOf(id),null,`${id} arrived`);};
/** The commons deck's front flight runs from (9, -0.4) on level 0 to its landing at (9, -1.4) on level 1. The descender
 *  starts on the deck and walks down to the ground. Idle bodies fill the bottom landing, so it waits mid-flight on level 1.
 *  Its programme is then stopped, so the walk sits cancelling there: the bench's stuck shape. `dx` varies the repeat. */
function stuck(seed:string,{policy,dx=0,deckBody=false}:{policy:boolean;dx?:number;deckBody?:boolean}){
  const e=factory.create(factory.genesis(seed)) as E;
  if(policy)e.configureRuntimePolicy({sleepBlockTicks:1200,stallReleaseSupportV1:true});
  e.spawnHuman({id:'mover',label:'Synthetic descender',soul:'fixture'});walk(e,'mover',9+dx,-2.4,1);settle(e,'mover');
  if(deckBody){e.spawnHuman({id:'deck',label:'Synthetic deck body',soul:'fixture'});walk(e,'deck',8.2,-2.6,1);settle(e,'deck');}
  for(const [id,x,z] of [['b1',9,-0.1],['b2',8.6,-0.3],['b3',9.4,-0.3]] as [string,number,number][]){e.spawnHuman({id,label:'Synthetic bottom-landing body',soul:'fixture'});walk(e,id,x+dx/2,z,0);settle(e,id);}
  walk(e,'mover',9+dx,3,0);
  for(let i=0;i<900&&e.world.entities.mover.human!.activity!=='climb-wait';i++)e.step();
  for(let i=0;i<200;i++)e.step();
  assert.equal(e.world.entities.mover.human!.activity,'climb-wait','waiting mid-flight');assert.equal(e.world.entities.mover.human!.level,1);
  e.stop(e.programOf('mover')!);for(let i=0;i<200;i++)e.step();
  const probe=e.stallProbeV1('mover')!;assert.deepEqual(probe.holders.map((h:any)=>h.state),['cancelling'],'a stopped walk still cancelling on the flight');
  return e;
}
const run=(e:E,n:number)=>{for(let i=0;i<n;i++)e.step();return e.runtime.violations as {code:string;subjects?:string[]}[];};

test('control (no policy, the old histories): the release stands the body mid-flight and the next tick faults collision.human-static',()=>{
  const e=stuck('stall-release-control',{policy:false});
  const at=[...e.world.entities.mover.pose.p];
  const r=e.stallReleaseV1('mover',REASON)!;assert.deepEqual(r.at.map(Math.round),at.map(Math.round),'set down where it was');
  const v=run(e,2);assert.ok(v.length>0);assert.equal(v[0].code,'collision.human-static');assert.deepEqual(v[0].subjects,['mover']);
});

test('policy: the release stands the body on the nearer free landing of its flight, level and pose consistent, no fault, snapshot continuation agrees',()=>{
  const e=stuck('stall-release-landing',{policy:true});
  assert.equal(e.stallProbeV1('mover')!.exempt,null,'a landing is free: the guard may release');
  const r=e.stallReleaseV1('mover',REASON)!;assert.deepEqual(r.released,['walk_to']);
  const m=e.world.entities.mover;assert.deepEqual([m.pose.p[0],m.pose.p[2]],[9,-1.4],'the deck landing (the bottom one is full)');assert.equal(m.human!.level,1);assert.equal(m.human!.activity,'idle');
  assert.equal(e.programOf('mover'),null);
  const copy=factory.restore(e.snapshot());for(let i=0;i<200;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  assert.deepEqual(e.runtime.violations,[]);
  walk(e,'mover',9,-2.4,1);settle(e,'mover');assert.deepEqual(e.runtime.violations,[],'the released body walks on normally');
});

test('policy: with both landings occupied nothing is released (probe exempt release.unsupported), and nothing faults',()=>{
  const e=stuck('stall-release-none',{policy:true,deckBody:true});
  walk(e,'deck',9,-1.5,1);for(let i=0;i<300&&e.programOf('deck');i++)e.step();
  const probe=e.stallProbeV1('mover')!;assert.equal(probe.exempt,'release.unsupported');
  const before=JSON.stringify(e.world.entities.mover.pose.p);
  assert.equal(e.stallReleaseV1('mover',REASON),null);assert.equal(JSON.stringify(e.world.entities.mover.pose.p),before,'not moved');
  assert.deepEqual(run(e,100),[]);assert.equal(e.world.entities.mover.human!.activity,'climb-wait','still in its native hold');
});

test('policy is prospective, hashed, retained over snapshots and idempotent; an invalid value is refused',()=>{
  const e=factory.create(factory.genesis('stall-release-policy')) as E,before=e.stateHash();
  assert.equal(Object.hasOwn((e.snapshot() as any).cfg,'stallReleaseSupportV1'),false);
  assert.equal((factory.restore(e.snapshot()) as E).stateHash(),before,'a pre-policy snapshot restores to the same hash');
  assert.throws(()=>e.configureRuntimePolicy({sleepBlockTicks:1200,stallReleaseSupportV1:'yes'} as any),/runtime-policy\.stall-release-support/);assert.equal(e.stateHash(),before);
  e.configureRuntimePolicy({sleepBlockTicks:1200,stallReleaseSupportV1:true});const on=e.stateHash();assert.notEqual(on,before);
  e.configureRuntimePolicy({sleepBlockTicks:1200,stallReleaseSupportV1:true});assert.equal(e.stateHash(),on);
  const copy=factory.restore(e.snapshot()) as E;assert.equal((copy.snapshot() as any).cfg.stallReleaseSupportV1,true);assert.equal(copy.stateHash(),on);
});

test('six seeded repeats: the control faults 6 of 6, the policy 0 of 6',()=>{
  const out={control:0,policy:0};
  for(let k=0;k<6;k++){
    const dx=(k-2.5)*0.04;
    for(const arm of ['control','policy'] as const){
      const e=stuck(`stall-release-repeat-${k}`,{policy:arm==='policy',dx});
      e.stallReleaseV1('mover',REASON);
      if(run(e,40).some(v=>v.code==='collision.human-static'))out[arm]++;
    }
  }
  assert.deepEqual(out,{control:6,policy:0});
});
