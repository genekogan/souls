import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {Spatial} from '../spatial/service.ts';
import {emptyWorld,human,addAll,FIXTURE} from '../world/factory.ts';
import {poseV1} from '../social/pose.ts';
import {SOCIAL_ACTIONS} from '../social/actions.ts';
import {FACING_TOLERANCE} from '../social/facing.ts';
import {walkTo} from '../locomotion/walk.ts';
import {HUMAN_PROFILE,type SpatialScene} from '../spatial/types.ts';
import type {ActionDef} from '../actions/types.ts';
import type {Entity} from '../world/types.ts';
const scene:SpatialScene={bounds:[-10,-10,10,10],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'floor',level:0,y:0,obb:{c:[0,0],half:[10,10],yaw:0}}],obstacles:[],links:[]};
const registry=new Map<string,ActionDef>([['pose_v1',poseV1],['walk_to',walkTo],...SOCIAL_ACTIONS.map(a=>[a.verb,a] as [string,ActionDef])]);
const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const five=5*Math.PI/180;
function setup(...entities:Entity[]){const world=addAll(emptyWorld('social-facing',scene),...entities),spatial=new Spatial(scene,{cell:.1});spatial.sync(world);return new Runtime(world,registry,{spatial},[]);}
const body=(rt:Runtime,id='a')=>rt.world.entities[id];
const pose=(rt:Runtime,id='a',extra:Record<string,unknown>={})=>rt.submit('pose_v1',{actor:id,activity:'listen',seconds:8,facingPolicy:'social-v1',...extra});
function centreErrors(rt:Runtime){const all=Object.values(rt.world.entities).filter(a=>a.human),x=all.reduce((s,a)=>s+a.pose.p[0],0)/all.length,z=all.reduce((s,a)=>s+a.pose.p[2],0)/all.length;return all.map(a=>Math.abs(delta(Math.atan2(z-a.pose.p[2],x-a.pose.p[0]),a.pose.yaw)));}
for(const seed of [41,42])test(`prospective three-person group targets centre within2s, stays bounded and never translates (${seed})`,()=>{
 const rt=setup(human('a',-1.5,0,{yaw:seed*.71}),human('b',1.5,0,{yaw:seed*.71+1.3}),human('c',0,2.6,{yaw:seed*.71+2.6}));
 const starts=Object.fromEntries(Object.values(rt.world.entities).map(a=>[a.id,[...a.pose.p]]));
 for(const id of ['a','b','c'])assert.equal(pose(rt,id,{group:'friends',need:2,alone:'fail'}).status,'executing');
 let maxStep=0,maxError=0,firstWithin:number|undefined;
 for(let tick=1;tick<=120;tick++){
  const before=Object.fromEntries(Object.values(rt.world.entities).map(a=>[a.id,a.pose.yaw]));rt.step();
  const errors=centreErrors(rt);if(firstWithin===undefined&&errors.every(e=>e<=five))firstWithin=tick/20;
  if(tick>=40){maxError=Math.max(maxError,...errors);assert.ok(errors.every(e=>e<=five),JSON.stringify(errors));}
  for(const a of Object.values(rt.world.entities)){const step=Math.abs(delta(a.pose.yaw,before[a.id]));maxStep=Math.max(maxStep,step);assert.ok(step<=HUMAN_PROFILE.turnRate/20+1e-10);assert.deepEqual(a.pose.p,starts[a.id]);}
 }
 assert.ok(firstWithin!==undefined&&firstWithin<=2);console.log(JSON.stringify({seed,firstWithin,maxStep,maxErrorDegrees:maxError*180/Math.PI}));
});
test('missing policy preserves legacy nearest-partner snap rather than rewriting old operations',()=>{
 const rt=setup(human('a',-1.5,0,{yaw:2.8}),human('b',1.5,0,{yaw:-2.1}),human('c',0,2.6,{yaw:.7}));
 for(const actor of ['a','b','c'])rt.submit('pose_v1',{actor,activity:'listen',seconds:8,group:'legacy',need:2,alone:'fail'});
 for(let i=0;i<40;i++)rt.step();assert.ok(centreErrors(rt).some(e=>e>.5),'legacy nearest-partner target remains distinct from centroid');
});
test('ordinary object-facing preparation publishes no hand activity while still turning',()=>{
 const rt=setup(human('a',0,0,{yaw:Math.PI})),at=[...body(rt).pose.p];const action=pose(rt,'a',{activity:'read',prop:'book',face:[2,0],seconds:1});
 let sawPreparation=false,sawActivity=false;
 for(let i=0;i<60&&action.status==='executing';i++){const before=body(rt).pose.yaw;rt.step();const a=body(rt);assert.ok(Math.abs(delta(a.pose.yaw,before))<=.2+1e-10);assert.deepEqual(a.pose.p,at);if(a.human!.activity==='read'){sawActivity=true;assert.ok(Math.abs(delta(a.pose.yaw,0))<=FACING_TOLERANCE);}else if(action.phase==='facing'){sawPreparation=true;assert.equal(a.human!.activity,'idle');}}
 assert.ok(sawPreparation&&sawActivity);assert.equal(action.status,'completed');
});
test('cancelling a partial turn retains its attained heading and releases the pose',()=>{
 const rt=setup(human('a',0,0,{yaw:Math.PI}));const action=pose(rt,'a',{activity:'read',prop:'book',face:[2,0]});for(let i=0;i<3;i++)rt.step();const yaw=body(rt).pose.yaw,at=[...body(rt).pose.p];assert.ok(Math.abs(delta(yaw,Math.PI))>.1&&Math.abs(delta(yaw,0))>.1);rt.cancel(action.id);for(let i=0;i<30;i++)rt.step();assert.equal(body(rt).pose.yaw,yaw);assert.deepEqual(body(rt).pose.p,at);assert.equal(body(rt).human!.activity,'idle');assert.equal(rt.holder('pose:a').length,0);
});
test('a native seated overlay retains the seat facing and exact support position',()=>{
 const chair:Entity={id:'chair',kind:'fixture',def:'camp-chair',pose:{p:[3,0,0],yaw:.7},provenance:FIXTURE};const rt=setup(human('a',1,0),chair),sit=rt.submit('sit',{actor:'a',fixture:'chair'});
 for(let i=0;i<600&&sit.phase!=='occupied';i++)rt.step();assert.equal(sit.phase,'occupied',sit.diagnostic?.message);const yaw=body(rt).pose.yaw,at=[...body(rt).pose.p];const a=pose(rt,'a',{activity:'read',prop:'book',face:[-3,0]});assert.equal(a.status,'executing',a.diagnostic?.message);for(let i=0;i<30;i++){rt.step();assert.equal(body(rt).pose.yaw,yaw);assert.deepEqual(body(rt).pose.p,at);}assert.equal(body(rt).human!.baseActivity,'sit');
});
test('moving actors and choreographed policies are not borrowed by social facing',()=>{
 const rt=setup(human('a',0,0));const walk=rt.submit('walk_to',{actor:'a',x:3,z:0});assert.equal(walk.status,'executing');const a=pose(rt,'a',{face:[0,2]});assert.equal(a.status,'failed');assert.equal(a.diagnostic?.code,'pose.not-still');
 for(const params of [{activity:'play-frisbee',group:'court',game:{kind:'frisbee'}},{activity:'hug',group:'pair',gap:.8},{activity:'nap'}])assert.equal(poseV1.schema.safeParse({actor:'a',seconds:2,facingPolicy:'social-v1',...params}).success,false,'choreography cannot opt into a competing rule');
});
test('prospective and legacy mid-turn/group snapshots continue identically',()=>{
 for(const prospective of [false,true]){
  const rt=setup(human('a',-1.5,0,{yaw:Math.PI}),human('b',1.5,0,{yaw:-1}),human('c',0,2.6,{yaw:2}));
  for(const actor of ['a','b','c'])rt.submit('pose_v1',{actor,activity:'listen',seconds:8,group:'friends',need:2,...(prospective?{facingPolicy:'social-v1'}:{})});
  for(let i=0;i<3;i++)rt.step();const snap=JSON.parse(JSON.stringify(rt.snapshot())),restored=Runtime.restore(snap,registry,{spatial:new Spatial(scene)},[]);
  for(let i=0;i<120;i++){rt.step();restored.step();assert.equal(restored.stateHash(),rt.stateHash());}
 }
});

test('an ordinary walk taking over an active group retains exactly the native walk trajectory and heading',()=>{
 const make=()=>{const rt=setup(human('a',-1.5,0,{yaw:2}),human('b',1.5,0,{yaw:-2}),human('c',0,2.6,{yaw:1}));const actions=['a','b','c'].map(id=>pose(rt,id,{group:'friends',need:2}));for(let i=0;i<4;i++)rt.step();return{rt,actions};};
 const candidate=make(),control=make();control.rt.cancel(control.actions[0].id);
 for(const f of [candidate,control])assert.equal(f.rt.submit('walk_to',{actor:'a',x:-5,z:-4}).status,'executing');
 for(let i=0;i<120;i++){candidate.rt.step();control.rt.step();assert.deepEqual(body(candidate.rt).pose,body(control.rt).pose);assert.equal(body(candidate.rt).human!.activity,body(control.rt).human!.activity);assert.equal(body(candidate.rt).human!.speed,body(control.rt).human!.speed);}
 assert.equal(candidate.actions[0].status,'failed');assert.equal(candidate.actions[0].diagnostic?.code,'pose.not-still');assert.equal(candidate.rt.holder('pose:a').length,0);
});

test('fixed object target takes priority over centroid and prepares before grouped hand publication',()=>{
 const rt=setup(human('a',-1.5,0,{yaw:Math.PI}),human('b',1.5,0,{yaw:Math.PI}),human('c',0,2.6,{yaw:Math.PI}));
 for(const id of ['a','b','c'])pose(rt,id,{group:'objects',need:2,face:[8,8],activity:'read',prop:'book'});
 let observed=0;for(let i=0;i<100;i++){rt.step();for(const a of Object.values(rt.world.entities)){if(a.human!.activity==='read'){observed++;assert.ok(Math.abs(delta(Math.atan2(8-a.pose.p[2],8-a.pose.p[0]),a.pose.yaw))<=FACING_TOLERANCE);}}}assert.ok(observed>100);
});

test('member departure retargets only remaining explicit group members gradually',()=>{
 const rt=setup(human('a',-1.5,0,{yaw:2}),human('b',1.5,0,{yaw:-2}),human('c',0,2.6,{yaw:1})),actions=['a','b','c'].map(id=>pose(rt,id,{group:'friends',need:2}));for(let i=0;i<40;i++)rt.step();rt.cancel(actions[2].id);const at=['a','b'].map(id=>[...body(rt,id).pose.p]);
 for(let i=0;i<60;i++){const before=['a','b'].map(id=>body(rt,id).pose.yaw);rt.step();for(const [j,id]of ['a','b'].entries()){assert.ok(Math.abs(delta(body(rt,id).pose.yaw,before[j]))<=.2+1e-10);assert.deepEqual(body(rt,id).pose.p,at[j]);if(i>=40){const other=body(rt,id==='a'?'b':'a');assert.ok(Math.abs(delta(Math.atan2(other.pose.p[2]-body(rt,id).pose.p[2],other.pose.p[0]-body(rt,id).pose.p[0]),body(rt,id).pose.yaw))<=FACING_TOLERANCE);}}}
});

test('legacy face trace retains its check-before-turn completion boundary exactly',()=>{
 const rt=setup(human('a',0,0,{yaw:2.9})),action=rt.submit('face',{actor:'a',target:{point:[2,0]}});let expected=2.9;
 for(let i=0;i<30&&action.status==='executing';i++){const done=Math.abs(delta(0,expected))<=.03;if(!done)expected=Math.atan2(Math.sin(expected+Math.max(-.2,Math.min(.2,delta(0,expected)))),Math.cos(expected+Math.max(-.2,Math.min(.2,delta(0,expected)))));rt.step();assert.ok(Math.abs(delta(body(rt).pose.yaw,expected))<1e-12);assert.equal(action.status,done?'completed':'executing');}
 assert.equal(action.status,'completed');
});

test('a courtesy step recomputes fixed-target heading before hands resume at the new root',()=>{
 const rt=setup(human('a',0,0),human('b',2,0));for(const id of ['a','b'])pose(rt,id,{group:'objects',need:1,face:[4,0],activity:'read',prop:'book',seconds:10});for(let i=0;i<40;i++)rt.step();
 const nudge=rt.submit('walk_to',{actor:'a',x:0,z:1},{id:'a:make-way:2'});assert.equal(nudge.status,'executing');let resumed=0;
 for(let i=0;i<150;i++){rt.step();const a=body(rt);if(rt.records.get(nudge.id)?.status==='completed'&&a.human!.activity==='read'){resumed++;assert.ok(Math.abs(delta(Math.atan2(-a.pose.p[2],4-a.pose.p[0]),a.pose.yaw))<=FACING_TOLERANCE);}}
 assert.equal(nudge.status,'completed');assert.ok(resumed>20);assert.ok(body(rt).pose.p[2]>.5,'actual native courtesy changed the supported root');
});
