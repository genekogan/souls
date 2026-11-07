import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {activityCapabilities,type ActivityWorld,type SpotsData} from './edge/ledger/activities.ts';

for(const branch of ['same-cap','near-spot'])for(const prospective of [false,true])test(`social facing: ${branch} acceptance preserves the invitation's ${prospective?'new':'legacy'} preparation policy`,async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),souls=[];
 for(const name of ['Ana','Ben']){await invite(f,name);const r=await accept(f.host,f.souls.create('dev:'+name,{name,description:'Facing compatibility'}));souls.push({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner});}
 const [a,b]=souls,request=await accept(f.host,edge.act(a,{capability:'read:here',params:{with:[b.soulId],seconds:10}}));assert.equal(request.accepted,true,JSON.stringify(request));
 const inv=edge.together.invitesFor(b.soulId)[0];assert.ok(inv);inv.what='paint';inv.activity='paint';inv.capability=branch==='same-cap'?'paint:easel':'paint:missing';delete inv.meetAt;
 if(prospective)inv.facingPolicy='social-v1';else delete inv.facingPolicy;
 // A saved pre-policy invitation is the legacy input; accepting it builds against today's real activity menu.
 f.db.db.prepare('UPDATE edge_invites_v1 SET body=? WHERE world_id=? AND invite_id=?').run(JSON.stringify(inv),f.host.worldId,inv.id);
 const data:SpotsData={contract:'activity-spots/1',spots:[{id:'easel',activity:'paint',at:[2,0],faceTo:[3,0],base:'idle'}],shelves:[],interiors:[],solids:[],rings:[],platforms:[]};
 const w:ActivityWorld={me:[0,0],seated:false,socialFacing:true,clearance:()=>1,open:p=>p,taken:()=>false,enterable:()=>true,seat:()=>null,placeName:()=>null,ancestors:()=>[],groupSize:()=>0};
 const {caps,plans}=activityCapabilities(data,w),original=structuredClone(plans.get('paint:easel')!.steps);
 assert.ok(original.some(s=>s.verb==='mars:face'&&s.params.facingPolicy==='social-v1'),'new menu has the versioned preparation step');
 const result=edge.together.acceptPlan(b,inv.id,caps,plans);assert.ok('steps'in result,JSON.stringify(result));if(!('steps'in result))return;
 const turn=result.steps.find(s=>s.verb==='mars:face'),pose=result.steps.find(s=>s.verb==='mars:pose_v1'&&s.params.activity==='paint');assert.ok(pose);
 assert.equal(turn?.params.facingPolicy,prospective?'social-v1':undefined);assert.equal(Boolean(turn),prospective);assert.equal(pose.params.facingPolicy,prospective?'social-v1':undefined);assert.deepEqual(plans.get('paint:easel')!.steps,original,'guest menu remains immutable');
});

test('social facing native phase defaults off in normal activity plans',()=>{
 const w:ActivityWorld={me:[0,0],seated:false,socialFacing:false,clearance:()=>1,open:p=>p,taken:()=>false,enterable:()=>true,seat:()=>null,placeName:()=>null,ancestors:()=>[],groupSize:()=>0};
 const data:SpotsData={contract:'activity-spots/1',spots:[{id:'easel',activity:'paint',at:[2,0],faceTo:[3,0],base:'idle'},{id:'mic',activity:'sing',at:[4,0],faceTo:[5,0],base:'idle',accompany:10}],shelves:[],interiors:[],solids:[],rings:[],platforms:[]};
 const {plans}=activityCapabilities(data,w);for(const p of plans.values())for(const step of p.steps)assert.equal(step.params.facingPolicy,undefined);
 assert.equal(plans.get('paint:easel')!.steps.some(s=>s.verb==='mars:face'),false,'ordinary spot retains the default legacy plan');assert.equal(plans.get('sing:mic')!.steps.some(s=>s.verb==='mars:face'),true,'original singing preparation is preserved');
});

test('live plan fallback requires both explicit development flags, with no ActivityWorld override',()=>{
 const previous=[process.env.DEV_AUTH,process.env.SOUL_SOCIAL_FACING];
 try{for(const dev of [undefined,'0','1'])for(const flag of [undefined,'0','1']){
  if(dev===undefined)delete process.env.DEV_AUTH;else process.env.DEV_AUTH=dev;if(flag===undefined)delete process.env.SOUL_SOCIAL_FACING;else process.env.SOUL_SOCIAL_FACING=flag;
  const w:ActivityWorld={me:[0,0],seated:false,clearance:()=>1,open:p=>p,taken:()=>false,enterable:()=>true,seat:()=>null,placeName:()=>null,ancestors:()=>[],groupSize:()=>0};
  const data:SpotsData={contract:'activity-spots/1',spots:[{id:'easel',activity:'paint',at:[2,0],faceTo:[3,0],base:'idle'}],shelves:[],interiors:[],solids:[],rings:[],platforms:[]},plan=activityCapabilities(data,w).plans.get('paint:easel')!,enabled=dev==='1'&&flag==='1';
  assert.equal(plan.steps.some(s=>s.params.facingPolicy==='social-v1'),enabled,JSON.stringify({dev,flag}));assert.equal(plan.steps.some(s=>s.verb==='mars:face'),enabled);
 }}finally{for(const [i,key]of ['DEV_AUTH','SOUL_SOCIAL_FACING'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}}
});

// #423 A2: a forming conversation turns both free bodies gradually (native face) before the first reply is published.
for(const on of [true,false])test(`social facing: conversation start and join ${on?'turn bodies gradually (flags on)':'keep legacy attention (flags off)'}`,{timeout:600000},async t=>{
 const previous=[process.env.DEV_AUTH,process.env.SOUL_SOCIAL_FACING];process.env.DEV_AUTH='1';process.env.SOUL_SOCIAL_FACING=on?'1':'0';
 const {Hono}=await import('hono'),{mountEdgeRoutes}=await import('./edge/routes.ts'),{setImmediate}=await import('node:timers/promises');
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();
 let comms:ReturnType<typeof mountEdgeRoutes>|undefined;
 t.after(()=>{comms?.close();f.host.stop();f.db.close();for(const [i,key]of ['DEV_AUTH','SOUL_SOCIAL_FACING'].entries()){if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}});
 comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>undefined as never});
 const souls=[];for(const name of ['Ana','Ben']){await invite(f,name);const r=await accept(f.host,f.souls.create('dev:'+name,{name,description:'Facing conversation'}));souls.push({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner});}
 const ents=()=>f.host.engine.world.entities,tick=async(n:number)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick(10);const [a,b]=souls,A=()=>ents()[a.entityId],B=()=>ents()[b.entityId];
 // Turn both away from each other first, so a facing change is observable.
 A().pose.yaw=Math.atan2(B().pose.p[2]-A().pose.p[2],B().pose.p[0]-A().pose.p[0])+1;B().pose.yaw=Math.atan2(A().pose.p[2]-B().pose.p[2],A().pose.p[0]-B().pose.p[0])-1;
 const err=(x:typeof A,y:typeof A)=>Math.abs(Math.atan2(Math.sin(Math.atan2(y().pose.p[2]-x().pose.p[2],y().pose.p[0]-x().pose.p[0])-x().pose.yaw),Math.cos(Math.atan2(y().pose.p[2]-x().pose.p[2],y().pose.p[0]-x().pose.p[0])-x().pose.yaw)));
 const cv=comms.conversations.handle(a as never,{op:'start',with:[b.soulId]}) as {accepted:boolean;conversation:{id:string}};assert.equal(cv.accepted,true);
 assert.equal(comms.conversations.handle(b as never,{op:'accept',conversation:cv.conversation.id}).accepted,true);
 let maxStep=0;for(let i=0;i<10;i++){const y=[A().pose.yaw,B().pose.yaw];await tick(1);const w=(d:number)=>Math.abs(Math.atan2(Math.sin(d),Math.cos(d)));maxStep=Math.max(maxStep,w(A().pose.yaw-y[0]),w(B().pose.yaw-y[1]));}
 const events=f.db.events(f.host.worldId).filter(e=>e.kind===('edge-attention' as never)).map(e=>e.payload as {yaw?:number;turn?:string});
 if(on){assert.ok(err(A,B)<=5*Math.PI/180&&err(B,A)<=5*Math.PI/180,JSON.stringify([err(A,B),err(B,A)]));assert.ok(maxStep<=4/20+1e-9,String(maxStep));assert.ok(events.some(e=>e.turn==='gradual-v1'&&typeof e.yaw==='number'));}
 else{assert.ok(err(A,B)>.9&&err(B,A)>.9,'flags off: forming a conversation turns no body before its first turn');assert.equal(events.some(e=>e.turn!==undefined),false);}
});
