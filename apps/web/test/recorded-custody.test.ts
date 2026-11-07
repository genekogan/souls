// #637: same-tick custody proof. Replay-state checks do not stand in for client mesh/hand proof.
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';
import{HumanoidKit}from'../src/humanoid/compose.ts';
import{hashOf}from'../../../mars/viewer/engine/core/hash.ts';
import{Runtime}from'../../../mars/viewer/engine/runtime/runtime.ts';
import{createRegistry,ENGINE_INVARIANTS}from'../../../mars/viewer/engine/api/registry.ts';
import{Spatial}from'../../../mars/viewer/engine/spatial/service.ts';
import{emptyWorld,addAll,human}from'../../../mars/viewer/engine/world/factory.ts';
import{openGround}from'../../../mars/viewer/engine/test/frame-fixtures.ts';
import{itemEntity,putInHand,followHand}from'../../../mars/viewer/engine/items/model.ts';
import{bodyFrame,carryHand}from'../../../mars/viewer/engine/items/body.ts';
import{TakeRecorder}from'../../../mars/viewer/engine/take/recorder.ts';
import{sampleTake}from'../../../mars/viewer/engine/take/replay.ts';
import{TakePeople}from'../../../mars/viewer/app/engine-view/take-replay.ts';
import type{Take}from'../../../mars/viewer/engine/take/types.ts';
const DT=.05,legacy=JSON.parse(readFileSync(new URL('./fixtures/recorded-custody-legacy.json',import.meta.url),'utf8'));
function fixture(others:'none'|'presented'|'legacy'='none'){
 const scene=openGround(),a=human('giver',0,0),b=human('receiver',.9,0,{yaw:Math.PI});
 const w=addAll(emptyWorld('custody-audit',scene),a,b);
 for(const[id,actor,hand,presented]of [ ['bowl',a,'right',true],...(others==='none'?[]:[['other-giver',a,'left',others==='presented'],['other-receiver',b,'right',others==='presented']])] as const){
  const item=itemEntity(id,'bowl',[0,0,0]);item.tags=presented?['entity-world','entity-world-item-pose']:[];putInHand(item,actor.id,hand);followHand(item,carryHand(bodyFrame(actor),hand),actor.pose.yaw);w.entities[id]=item;
 }
 const rt=new Runtime(w,createRegistry(),{spatial:new Spatial(scene)},ENGINE_INVARIANTS);rt.submit('hold_items',{actor:a.id});if(others!=='none')rt.submit('hold_items',{actor:b.id});rt.step();return rt;
}
function state(rt:Runtime){return Object.fromEntries(Object.entries(rt.world.entities).map(([id,e])=>[id,{support:structuredClone(e.support??null),held:structuredClone(e.human?.heldItemsV1??null),hands:structuredClone(e.human?.hands??null)}]));}
function run(marked:boolean,chunkSize:number,reverse=false,others:'none'|'presented'|'legacy'='none',cancel?:{side:'giver'|'receiver';tick:number}){
 const rt=fixture(others),all=new TakeRecorder(rt,{rulesVersion:'custody-audit'}),start=rt.tick;let rec=new TakeRecorder(rt,{rulesVersion:'custody-audit'});const chunks:Take[]=[],live=new Map([[rt.tick,state(rt)]]),hashes:{tick:number;world:string;events:string}[]=[],snapshots=new Map<number,ReturnType<Runtime['snapshot']>>(),physical=new Map<number,string>();
 const base={item:'bowl',group:'group',...(marked?{custodyPolicy:'same-tick-v1'}:{})},offer=()=>rt.submit('hand_over_v1',{actor:'giver',mode:'offer',partner:'receiver',...base}),receive=()=>rt.submit('hand_over_v1',{actor:'receiver',mode:'receive',partner:'giver',...(others!=='none'?{hand:'left'}:{}),...base});
 const records=reverse?[receive(),offer()]:[offer(),receive()];assert.ok(records.every(r=>r.status==='executing'),JSON.stringify(records));
 for(let k=1;k<=180;k++){
  if(cancel&&rt.tick===cancel.tick){const r=records.find(r=>(r.params as {actor?:string}).actor===cancel.side)!;rt.cancel(r.id);}
  rt.step();live.set(rt.tick,state(rt));const ph=structuredClone(rt.world.entities);for(const e of Object.values(ph))if(e.human)delete e.human.heldItemsV1;physical.set(rt.tick,hashOf(ph));hashes.push({tick:rt.tick,world:rt.stateHash(),events:hashOf(rt.events)});
  if([58,59,60].includes(rt.tick)&&!cancel)snapshots.set(rt.tick,JSON.parse(JSON.stringify(rt.snapshot())));
  if(k%chunkSize===0){chunks.push(rec.finish());rec=new TakeRecorder(rt,{rulesVersion:'custody-audit'});}
 }
 chunks.push(rec.finish());const take=all.finish();let changes=0,prev='giver';const inconsistent:number[]=[];
 for(const[tick,want]of live){const full=sampleTake(take,(tick-start)*DT),chunk=chunks.find(c=>tick>=c.startTick&&tick<=c.startTick+c.ticks)!;const parts=chunks.filter(c=>tick>=c.startTick&&tick<=c.startTick+c.ticks);
  // Inclusive edges deliberately check BOTH the previous window's final frame and the new window's initial frame.
  for(const frame of[full,...parts.map(c=>sampleTake(c,(tick-c.startTick)*DT))])for(const[id,s]of Object.entries(want)){
   if(!frame.entities[id]){assert.ok(id.startsWith('other-')&&others==='legacy','only unpresented authored items may be absent');continue;}
   assert.deepEqual(frame.entities[id].state.support??null,s.support,`${id} support at tick${tick}`);assert.deepEqual(frame.entities[id].state.heldItemsV1??null,s.held,`${id} held map at tick${tick}`);
  }
  const holder=(want.bowl.support as{by?:string}).by!;if(holder!==prev){changes++;prev=holder;}
  const maps=Object.entries(want).filter(([id,s])=>['giver','receiver'].includes(id)&&Object.values(s.held??{}).includes('bowl')).map(([id])=>id);if(maps.length!==1||maps[0]!==holder)inconsistent.push(tick);
  for(const[id,s]of Object.entries(want))if(id.startsWith('other-')){const owner=(s.support as{by:string}).by;assert.equal(owner,id==='other-giver'?'giver':'receiver');assert.equal(Object.values(want[owner].held??{}).includes(id),others==='presented','other hand and tag eligibility preserved');}
  if(tick%11===0){const view=new TakePeople(chunk);view.setWaterHistory(chunks);view.show((tick-chunk.startTick)*DT,tick*DT);assert.deepEqual(view.frame!.entities.bowl.state.support,want.bowl.support,'fresh arbitrary replay state');}
 }
 for(const[tick,snapshot]of snapshots){const restored=Runtime.restore(snapshot,createRegistry(),{spatial:new Spatial(openGround())},ENGINE_INVARIANTS);for(let k=tick+1;k<=Math.min(tick+30,start+180);k++){restored.step();assert.equal(restored.stateHash(),hashes.find(x=>x.tick===k)!.world,`snapshot continuation from${tick} at${k}`);}}
 assert.deepEqual(rt.violations,[]);return{hashes,inconsistent,changes,holder:prev,live,take,chunks,physical};
}
for(const chunk of[7,20,29,61])for(const reverse of[false,true])for(const others of['none','presented','legacy']as const)test(`same-tick handover policy: chunk${chunk}, reverse${reverse}, other${others}`,()=>{
 const r=run(true,chunk,reverse,others);assert.equal(r.changes,1);assert.equal(r.holder,'receiver');assert.deepEqual(r.inconsistent,[]);console.log(JSON.stringify({chunk,reverse,others,ticks:r.live.size,changes:r.changes,metadataLagTicks:r.inconsistent}));
});
test('absent policy preserves pinned intake world/event hash trace and legacy one-tick metadata lag',()=>{
 const r=run(false,7);assert.equal(hashOf(r.hashes),legacy.traceHash);assert.equal(r.hashes.length,legacy.samples);assert.deepEqual(r.inconsistent,legacy.staleMetadataTicks);assert.equal(r.changes,1);assert.equal(r.holder,'receiver');
});
for(const side of['giver','receiver']as const)for(const tick of[12,45,58,59,60])test(`same-tick policy cancellation ${side} at tick${tick}`,()=>{
 const r=run(true,29,false,'presented',{side,tick});assert.ok(r.changes<=1);assert.deepEqual(r.inconsistent,[]);assert.ok(r.holder==='giver'||r.holder==='receiver');
});

for(const reverse of[false,true])for(const others of['none','presented','legacy']as const)test(`prospective metadata preserves exact physical path/contact ${reverse}/${others}`,()=>{
 const before=run(false,29,reverse,others),after=run(true,29,reverse,others);assert.deepEqual(after.physical,before.physical,'all entity pose/support/hands/activity/transfer fields unchanged at every native tick');
 if(!reverse&&others==='none')assert.equal([...after.live].find(([,s])=>(s.bowl.support as{by?:string}).by==='receiver')![0],59,'unchanged contact transfer tick');
});
for(const frame of['masc','fem']as const)test(`actual composed ${frame} handover: paired legacy/marked palms and unchanged motion bounds`,async()=>{
 const runs=[run(false,29),run(true,29)],kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)as ArrayBuffer;}),tpl=await kit.template({frame,preset:frame==='masc'?'casual':'woman'});
 const rendered=runs.map(r=>{const view=new TakePeople(r.take);view.setTemplates([tpl]);const rows:{tick:number;palms:Record<string,number[][]>;fresh?:Record<string,number[][]>}[]=[];let prev:Record<string,number[][]>|undefined,maxStep=0,contactStep=0,freshDrift=0,contactError=0,freshContactError=0;
  for(const[tick]of r.live){view.show((tick-r.take.startTick)*DT,tick*DT);const palms=Object.fromEntries(Object.entries(view.bones()).map(([id,b])=>[id,b.arms.map(a=>a.palm)]));
   if(prev)for(const[id,arms]of Object.entries(palms))for(let i=0;i<arms.length;i++){const step=Math.hypot(...arms[i].map((x,k)=>x-prev![id][i][k]));maxStep=Math.max(maxStep,step);if(tick>=57&&tick<=61)contactStep=Math.max(contactStep,step);}
   let freshPalms:Record<string,number[][]>|undefined;if(tick>=57&&tick<=61)for(const[id,b]of Object.entries(view.bones()))for(const arm of b.arms){const target=r.live.get(tick)![id].hands?.[arm.side];if(target)contactError=Math.max(contactError,Math.hypot(...arm.palm.map((x,k)=>x-target[k])));}
   if(tick>=57&&tick<=61){const chunk=r.chunks.find(c=>tick>=c.startTick&&tick<=c.startTick+c.ticks)!,fresh=new TakePeople(chunk);fresh.setTemplates([tpl]);fresh.setWaterHistory(r.chunks);fresh.show((tick-chunk.startTick)*DT,tick*DT);freshPalms=Object.fromEntries(Object.entries(fresh.bones()).map(([id,b])=>[id,b.arms.map(a=>a.palm)]));for(const[id,b]of Object.entries(fresh.bones()))for(const arm of b.arms){const target=r.live.get(tick)![id].hands?.[arm.side];if(target)freshContactError=Math.max(freshContactError,Math.hypot(...arm.palm.map((x,k)=>x-target[k])));}
for(const[id,arms]of Object.entries(palms))for(let i=0;i<arms.length;i++)freshDrift=Math.max(freshDrift,Math.hypot(...arms[i].map((x,k)=>x-freshPalms![id][i][k])));}
   rows.push({tick,palms,...(freshPalms?{fresh:freshPalms}:{})});prev=palms;
  }
  assert.ok(maxStep<=.08,'unchanged M04 full handover path bound');assert.ok(contactStep<=.08,'unchanged M04 contact boundary bound');return{rows,maxStep,contactStep,freshDrift,contactError,freshContactError};
 });
 let pairedError=0;for(let k=0;k<rendered[0].rows.length;k++)for(const field of['palms','fresh']as const){const a=rendered[0].rows[k][field],b=rendered[1].rows[k][field];if(!a||!b){assert.equal(!!a,!!b);continue;}for(const[id,arms]of Object.entries(a))for(let i=0;i<arms.length;i++)pairedError=Math.max(pairedError,Math.hypot(...arms[i].map((x,j)=>x-b[id][i][j])));}
 // Metadata intentionally selects recorded hands at the truthful transfer tick; cross-mode exact palms are not promised.
 console.log(JSON.stringify({frame,legacy:{maxStep:rendered[0].maxStep,contactStep:rendered[0].contactStep,freshDrift:rendered[0].freshDrift},marked:{maxStep:rendered[1].maxStep,contactStep:rendered[1].contactStep,freshDrift:rendered[1].freshDrift},pairedError,contactErrors:rendered.map(x=>x.contactError),freshContactErrors:rendered.map(x=>x.freshContactError)}));for(const r of rendered){assert.ok(r.contactError<=.0055,'existing 5.5mm native-hand precision at contact');assert.ok(r.freshContactError<=.0055,'fresh replay retains existing native-hand contact precision');}
});
