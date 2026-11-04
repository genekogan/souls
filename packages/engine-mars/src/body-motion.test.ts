import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD,MarsEngine} from './engine.ts';
import {LITTLE_MARTIANS_MOTION,bodyMotionProblem} from '../../../mars/viewer/engine/bodies/motion.ts';
import {floaterPose} from '../../../mars/viewer/engine/bodies/pose.ts';
import {bodyV1Schema} from '../../protocol/src/body-v1.ts';
import {shapeRigidCapabilities,bodyCapabilityProblem,bodyVerbProblem} from '../../../apps/server/src/edge/body/actions.ts';

const body={family:'floater' as const,type:'ceramic' as const,model:'verdelis',radius:.35,hoverHeight:1.45,motion:structuredClone(LITTLE_MARTIANS_MOTION)};
test('authored rigid motion validates complete finite bounded adapters and survives the wire schema',()=>{
 assert.equal(bodyMotionProblem(body.motion),null);assert.ok(bodyV1Schema.safeParse(body).success);
 for(const change of [(m:any)=>delete m.idle,(m:any)=>m.dance.period=0,(m:any)=>m.dance.bob=2,(m:any)=>m.move.yaw=NaN,(m:any)=>m.script='code',(m:any)=>m.rest.pitch=9]){const m=structuredClone(body.motion);change(m);assert.notEqual(bodyMotionProblem(m),null);assert.equal(bodyV1Schema.safeParse({...body,motion:m}).success,false);}
 assert.equal(bodyV1Schema.safeParse({...body,family:'humanoid'}).success,false);
});
test('both differently named worlds admit authored stationary dance; interruption and restore stay deterministic',async()=>{
 for(const name of ['Alder','Birch']){
  const f=await marsFactory({...GREEN_FIELD_WORLD,grounds:{id:name.toLowerCase(),name}}),e=f.create(f.genesis('authored-'+name));assert.ok(e instanceof MarsEngine);
  e.spawnHuman({id:'h',label:'A sculpture',soul:'s'});assert.equal(e.assignBodyV1('h',body),true);
  const p=structuredClone(e.world.entities.h.pose),r=e.perform({actor:'h',label:'wiggle',steps:[{verb:'mars:body_motion_v1',params:{motion:'dance',seconds:3}}]});assert.ok(r.ok,JSON.stringify(r));
  for(let i=0;i<22;i++)e.step();assert.equal(e.world.entities.h.human?.activity,'dance');assert.deepEqual(e.world.entities.h.pose,p,'dance cannot translate or rotate the authoritative root');
  assert.equal(e.assignBodyV1('h',null),false,'unsafe swap preserves the current body');
  const snapshot=e.snapshot(),copy=f.restore(snapshot);for(let i=0;i<8;i++){e.step();copy.step();assert.equal(e.stateHash(),copy.stateHash());}
  assert.equal(e.perform({actor:'h',label:'no imaginary hands',steps:[{verb:'mars:take_item',params:{item:'invented'}}]}).ok,false);
  e.stop(r.id!);for(let i=0;i<12;i++)e.step();assert.equal(e.world.entities.h.human?.activity,'idle');assert.deepEqual(e.world.entities.h.pose,p);
  assert.equal(e.assignBodyV1('h',null),true);
 }
});
test('discovery, dry-run guard and native step selection agree; animals and unadapted bodies retain refusals',()=>{
 const e={body} as any,caps:any[]=[{id:'dance:here',verb:'dance',label:'Dance',available:true},{id:'pick-up:thing',verb:'pick-up',label:'Pick up',available:true}],plans:any=new Map([['dance:here',{label:'Dance',steps:[{verb:'mars:pose_v1',params:{activity:'dance',seconds:60}}]}]]);
 shapeRigidCapabilities(e,caps,plans,{});const dance=caps.find(c=>c.id==='dance:here');assert.ok(dance);assert.equal(bodyVerbProblem(e,'dance'),null);assert.equal(bodyCapabilityProblem(e,dance,plans.get(dance.id).steps),null);assert.ok(!caps.some(c=>c.verb==='pick-up'));
 for(const b of [{...body,motion:undefined},{family:'floater',type:'creature',model:'duck'}])assert.equal(bodyVerbProblem({body:b} as any,'dance')?.code,'body.unsupported');
 assert.equal(bodyCapabilityProblem(e,dance,[{verb:'mars:pose_v1',params:{activity:'pick-up'}}])?.code,'body.unsupported');
});
test('sampled authored dance fades and reverse scrubs without accumulating pose or changing ground coordinates',()=>{
 const signal={since:20,until:100},ground={p:[2,0,3] as [number,number,number],yaw:.2,state:{bodyMotionV1:signal}},at=(tick:number)=>floaterPose('h',ground,body,tick,.05);
 const a=at(44);at(85);assert.deepEqual(at(44),a);assert.equal(a.p[0],2);assert.equal(a.p[2],3);assert.ok(Math.abs(a.p[1]-1.45)<=.06);
 const rest=floaterPose('h',{...ground,state:{}},body,20,.05);assert.deepEqual(at(20),rest,'no entry jump');
 const end=floaterPose('h',{...ground,state:{}},body,100,.05);assert.deepEqual(at(100),end,'no exit jump');
});

test('world type policy refuses live admission without entering replayed state or re-judging logged assignments',async()=>{
 const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('body-policy'));assert.ok(e instanceof MarsEngine);e.spawnHuman({id:'h',label:'Visitor',soul:'s'});
 const before=e.stateHash();e.configureBodyTypesV1(['humanoid']);assert.equal(e.stateHash(),before,'policy is mounted after boot replay, so it cannot be part of the clock-frontier hash');
 assert.equal(e.bodyAssignmentProblemV1('h',body),'body.world-policy');assert.equal(e.world.entities.h.body,undefined);
 const restored=f.restore(e.snapshot());restored.configureBodyTypesV1!(['humanoid']);assert.equal(restored.bodyAssignmentProblemV1!('h',body),'body.world-policy');
 assert.equal(restored.assignBodyV1!('h',body),true,'an assignment already in the log folds under a later, narrower policy');assert.equal(restored.world.entities.h.body?.model,'verdelis');
});
