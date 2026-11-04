// stair-landing-clearance/1 (#509): the final climb step refuses a landing that a body on the destination level
// occupies, whatever the direction of that step. Without the policy, histories keep the old behaviour byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD,GREEN_FIELD_WORLD,type MarsEngine} from './engine.ts';
import {loadMars} from './load.ts';

const m=await loadMars();
const commons=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,walkBlockV1:true});

test('stair landing clearance is prospective, hashed, retained and idempotent',async()=>{
  const factory=await marsFactory(GREEN_FIELD_WORLD),e=factory.create(factory.genesis('stair-landing-policy')) as MarsEngine;
  const before=e.stateHash(),historical=factory.restore(e.snapshot()) as MarsEngine;
  assert.equal(Object.hasOwn((e.snapshot() as any).cfg,'stairLandingClearanceV1'),false);
  assert.equal((historical as any).rt.services.stairLandingClearanceV1,undefined);
  assert.equal(historical.stateHash(),before);
  e.configureRuntimePolicy({sleepBlockTicks:1200,stairLandingClearanceV1:true});
  assert.notEqual(e.stateHash(),before);
  const accepted=e.stateHash();
  e.configureRuntimePolicy({sleepBlockTicks:1200,stairLandingClearanceV1:true});
  assert.equal(e.stateHash(),accepted);
  const copy=factory.restore(e.snapshot()) as MarsEngine;
  assert.equal((copy as any).rt.services.stairLandingClearanceV1,true);
  for(let i=0;i<20;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
  assert.equal((copy.snapshot() as any).cfg.stairLandingClearanceV1,true);
});

test('an invalid stair landing policy is refused without partial activation',async()=>{
  const factory=await marsFactory(GREEN_FIELD_WORLD),e=factory.create(factory.genesis('stair-landing-refusal')) as MarsEngine;
  const before=JSON.stringify(e.snapshot()),hash=e.stateHash();
  for(const policy of [{sleepBlockTicks:1200,stairLandingClearanceV1:'bad',spreadV2:true},{sleepBlockTicks:0,stairLandingClearanceV1:true,spreadV2:true}]){
    assert.throws(()=>e.configureRuntimePolicy(policy as any),/runtime-policy\./);
    assert.equal(e.stateHash(),hash);assert.equal(JSON.stringify(e.snapshot()),before);
    assert.equal((e as any).rt.services.stairLandingClearanceV1,undefined);
  }
});

/** The commons deck's front flight climbs from (9, -0.4) on level 0 to its landing at (9, -1.4) on level 1; its top
 *  0.6 m is flat at deck height. A deck body (hypothetical native fixture, not a Soul) walks to 0.3 m from that
 *  landing after the climber has passed it, as the cohort's make-way walks did (seed walk-1, tick 5012): the
 *  climber's last step moves away from the body, so `stairBlocker` alone lets it land overlapping. */
function stairTop(policy:boolean){
  const w=commons.genesis('stair-landing') as any;
  w.entities.deck=m.human('deck',8.3,-1.8,{level:1,y:.24});
  w.entities.climber=m.human('climber',9,.8,{yaw:-Math.PI/2});
  const e=commons.create(w) as MarsEngine;
  if(policy)e.configureRuntimePolicy({sleepBlockTicks:1200,stairLandingClearanceV1:true});
  const climb=e.perform({actor:'climber',label:'climb onto the deck',steps:[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}]});assert.equal(climb.ok,true,JSON.stringify(climb));
  for(let i=0;i<200;i++){
    const c=e.world.entities.climber;
    if(c.human!.activity==='climb-up'&&c.pose.p[2]<-.8)break;
    e.step();assert.deepEqual(e.runtime.violations,[]);
  }
  assert.equal(e.world.entities.climber.human!.activity,'climb-up','the climber is on the flat top of the flight');
  const step=e.perform({actor:'deck',label:'stand near the landing',steps:[{verb:'mars:walk_to',params:{x:8.83,z:-1.1,level:1}}]});assert.equal(step.ok,true,JSON.stringify(step));
  return e;
}

test('without the policy the climber lands overlapping a deck body (the #509 fault)',()=>{
  const e=stairTop(false);
  for(let i=0;i<60&&!e.runtime.violations.length;i++)e.step();
  const v=e.runtime.violations[0] as unknown as {code:string;subjects:string[]}|undefined;
  assert.equal(v?.code,'collision.human-human',JSON.stringify(v));
  assert.deepEqual([...v!.subjects].sort(),['climber','deck']);
});

/** Steps until `done`, asserting no invariant violation and no teleport of the climber on every tick. */
function run(e:MarsEngine,ticks:number,done:()=>boolean,each?:()=>void){
  for(let i=0;i<ticks;i++){
    const before=[...e.world.entities.climber.pose.p];e.step();assert.deepEqual(e.runtime.violations,[]);
    const p=e.world.entities.climber.pose.p;assert.ok(Math.hypot(p[0]-before[0],p[1]-before[1],p[2]-before[2])<=.05,'no teleport');
    each?.();if(done())return i+1;
  }
  return -1;
}
function landedClear(e:MarsEngine){
  const c=e.world.entities.climber,d=e.world.entities.deck;
  assert.equal(c.human!.level,1);assert.ok(Math.hypot(c.pose.p[0]-d.pose.p[0],c.pose.p[2]-d.pose.p[2])>=.54-1e-9,'landed clear of the deck body');
}

test('with the policy the climber waits on the flight, the idle deck body makes way, then the climber lands',()=>{
  const e=stairTop(true),rt=(e as any).rt;let waited=0;
  const landed=run(e,400,()=>e.world.entities.climber.human!.level===1,()=>{
    const c=e.world.entities.climber;
    if(c.human!.activity!=='climb-wait')return;
    waited++;const rec=rt.records.get(c.human!.task);
    assert.equal(rec?.status,'blocked');assert.equal(rec.diagnostic.code,'traffic.person');assert.ok(rec.diagnostic.subjects.includes('deck'),JSON.stringify(rec.diagnostic));
  });
  assert.ok(landed>0,'the climber reached the deck');assert.ok(waited>0,'the climber waited at the occupied landing');
  assert.ok([...rt.records.keys()].some((id:string)=>id.startsWith('deck:make-way:')),'the deck body was asked to make way');
  landedClear(e);
  assert.ok(run(e,400,()=>e.programOf('climber')===null)>=0,'the climb completed');
});

test('with the policy a climb stopped while waiting at the landing ends on it once the landing clears',()=>{
  const e=stairTop(true);
  assert.ok(run(e,200,()=>e.world.entities.climber.human!.activity==='climb-wait'&&e.world.entities.climber.pose.p[2]<-1.38)>0,'waiting at the landing');
  e.stop(e.programOf('climber')!);
  assert.ok(run(e,400,()=>e.world.entities.climber.human!.level===1)>0,'the cancelled climb stepped off');
  landedClear(e);assert.equal(e.world.entities.climber.human!.activity,'idle');
});
