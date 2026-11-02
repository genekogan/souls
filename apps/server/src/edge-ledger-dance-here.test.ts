import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCapabilities,loadSpots,type ActivityWorld} from './edge/ledger/activities.ts';
function offer(clearance:number,seated=false){
  const w:ActivityWorld={me:[.05,.05],seated,clearance:()=>clearance,open:()=>[8,8],taken:()=>false,enterable:()=>true,seat:()=>null,placeName:()=>null,ancestors:()=>[],groupSize:()=>0};
  const all=activityCapabilities(loadSpots(undefined).data,w);
  return {cap:all.caps.find(c=>c.id==='dance:here')!,plan:all.plans.get('dance:here')!};
}
test('dance here uses standing clearance at this point without a relocation leg',()=>{
  const o=offer(.35);assert.equal(o.cap.available,true);assert.deepEqual(o.plan.steps.map(s=>s.verb),['mars:pose_v1']);
});
test('seated dance capability retains an explicit stand before the native pose',()=>{
  const o=offer(.35,true);assert.equal(o.cap.available,true);assert.deepEqual(o.plan.steps.map(s=>s.verb),['stand','mars:pose_v1']);
});
test('dance here refuses a physically blocked current point even if another venue is open',()=>{
  const o=offer(0);assert.equal(o.cap.available,false);assert.equal(o.cap.blocked?.code,'pose.no-room');assert.ok(!o.plan.steps.some(s=>s.verb==='walk_to'));
});
