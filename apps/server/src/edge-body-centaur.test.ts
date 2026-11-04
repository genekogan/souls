import{setImmediate}from'node:timers/promises';import{GodMode}from'./god/god.ts';import{installEngineBridge}from'./god/engine-bridge.ts';
import test from 'node:test';import assert from 'node:assert/strict';import{Hono}from'hono';
import{fixture,invite,accept,factory}from'../test/native-owner-fixture.ts';import{EdgeLedger}from'./edge/ledger/ledger.ts';import{mountEdgeRoutes,edgeSoulResolver}from'./edge/routes.ts';
import{PIP_ASSET}from'./edge/body/pip.ts';import{BODY_PRESETS}from'./edge/body/routes.ts';import{MONSTER_ASSET,GHOST_ASSET,CENTAUR_ASSET,CENTAUR_PRESET,centaurBytes}from'./edge/body/shared-bodies.ts';
import{admitBodyGLB,bindBodyDefinition,QUADRUPED_FOOTPRINT_RADIUS}from'./edge/body/admission.ts';import{validateUpload,BODY_UPLOAD_POLICY}from'./moderation/validate.ts';
import{authorCentaur}from'../../../tools/body-authoring/centaur/author.mjs';import{bodyV1Schema}from'../../../packages/protocol/src/body-v1.ts';
import{profileActionProblem,QUADRUPED_ACTIONS,QUADRUPED_TORSO}from'../../../mars/viewer/engine/bodies/action-profile.ts';import{HUMAN_RADIUS}from'../../../mars/viewer/engine/world/catalog.ts';

const admit=(made:{bytes:Buffer;manifest:unknown})=>admitBodyGLB(Buffer.from(validateUpload(bindBodyDefinition(made.bytes,made.manifest),BODY_UPLOAD_POLICY).bytes),made.manifest);

test('centaur source: reproducible, within unchanged limits, and its lower body is admitted only inside the navigation disc',()=>{
 const made=authorCentaur(),again=authorCentaur();assert.ok(made.bytes.equals(again.bytes),'reproducible bytes');
 const a=admit(made);assert.equal(a.assetId,CENTAUR_ASSET);assert.equal(a.actionProfile,QUADRUPED_TORSO);assert.ok(a.bytes<4*1024*1024&&a.triangles<10_000&&a.images===0);
 const j=JSON.parse(made.bytes.toString('utf8',20,20+made.bytes.readUInt32LE(12)));assert.deepEqual(j.animations.map((c:any)=>c.name),['Idle','Walk','Dance_Loop','Standby_Loop']);
 for(const n of ['HindUpperLeg.L','HindLowerLeg.L','HindFoot.L','HindUpperLeg.R','HindLowerLeg.R','HindFoot.R'])assert.ok(j.skins[0].joints.includes(j.nodes.findIndex((x:any)=>x.name===n)),n);
 const walk=j.animations.find((c:any)=>c.name==='Walk'),hind=j.nodes.findIndex((x:any)=>x.name==='HindUpperLeg.L');assert.ok(walk.channels.some((c:any)=>c.target.node===hind&&c.target.path==='rotation'),'walk drives the hind legs');
 assert.equal(QUADRUPED_FOOTPRINT_RADIUS,HUMAN_RADIUS);
 // A longer-bodied variant would hide its hind legs outside the admitted clearance: refused with field/measured/limit.
 assert.throws(()=>admit(authorCentaur({hindOffset:.45})),(e:any)=>e.code==='body.footprint'&&e.details?.field==='footprint'&&e.details.measured>e.details.limit);
 // The human Idle's staggered stance on four legs puts a hind hoof outside the disc where the renderer stands it.
 assert.throws(()=>admit(authorCentaur({stance:'canonical'})),(e:any)=>e.code==='body.footprint'&&/Idle/.test(e.message));
 // Valid glTF variants are measured, not crashed on: normalised byte weights admit; no inverse binds is a named refusal.
 const regl=(bytes:Buffer,edit:(j:any,bin:Buffer)=>Buffer)=>{const n=bytes.readUInt32LE(12),j=JSON.parse(bytes.toString('utf8',20,20+n)),bin=edit(j,bytes.subarray(28+n)),jb=Buffer.from(JSON.stringify(j)),json=Buffer.alloc(Math.ceil(jb.length/4)*4,32);jb.copy(json);
  const o=Buffer.alloc(28+json.length+bin.length);o.writeUInt32LE(0x46546c67,0);o.writeUInt32LE(2,4);o.writeUInt32LE(o.length,8);o.writeUInt32LE(json.length,12);o.writeUInt32LE(0x4e4f534a,16);json.copy(o,20);o.writeUInt32LE(bin.length,20+json.length);o.writeUInt32LE(0x004e4942,24+json.length);bin.copy(o,28+json.length);return o;};
 const ubyte=regl(made.bytes,(j,bin)=>{const a=j.accessors[j.meshes[0].primitives[0].attributes.WEIGHTS_0],v=j.bufferViews[a.bufferView],at=(v.byteOffset??0)+(a.byteOffset??0),u=Buffer.alloc(a.count*4);for(let i=0;i<a.count*4;i++)u[i]=Math.round(bin.readFloatLE(at+i*4)*255);
  j.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:u.length});j.accessors.push({bufferView:j.bufferViews.length-1,componentType:5121,normalized:true,count:a.count,type:'VEC4'});j.meshes[0].primitives[0].attributes.WEIGHTS_0=j.accessors.length-1;const out=Buffer.concat([bin,u]);j.buffers[0].byteLength=out.length;return out;});
 assert.equal(admit({bytes:ubyte,manifest:made.manifest}).actionProfile,QUADRUPED_TORSO,'normalised UNSIGNED_BYTE weights are admitted');
 const noBinds=regl(made.bytes,(j,bin)=>{delete j.skins[0].inverseBindMatrices;return bin;});
 assert.throws(()=>admit({bytes:noBinds,manifest:made.manifest}),(e:any)=>typeof e.code==='string'&&e.code.startsWith('body.'),'identity binds are measured; a refusal is named, never a TypeError');
 // The profile needs the canonical rig; it is not a rigid-body option.
 assert.throws(()=>admit({bytes:made.bytes,manifest:{...made.manifest,type:'ceramic'}}),(e:any)=>e.code==='body.action-profile');
});

test('shared centaur preset: earlier presets unchanged, selection, honest dispositions, standby rest and wake, real custody',async t=>{
 assert.equal(PIP_ASSET,'body_0ac8dd17fab38e64b9367357232b819847bad25254252b5a47921ff1afa23b0f');assert.equal(MONSTER_ASSET,'body_e7f634a0d090b71d85229a737bbf8bb9274ffadee38d4107a79b0db599c52b77');assert.equal(GHOST_ASSET,'body_8111f1c4504c9c3b585fcc36d2590af26c3371aa7ce3390d8b7e7549f0e1a2bd');
 assert.equal(BODY_PRESETS.at(-1)?.id,'centaur');assert.ok(bodyV1Schema.safeParse(CENTAUR_PRESET.body).success);assert.strictEqual(await centaurBytes(),await centaurBytes(),'built once per process');
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const tick=(n=1)=>{for(let i=0;i<n;i++)f.host.tickOnce();};const people=[];
 for(const owner of ['centaur-rider','humanoid-friend']){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:owner,description:'Shared centaur body'})),pair=f.souls.pairCode(row,'https://example.invalid'),token=f.souls.pairExchange(pair.code,'fixture').token;people.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const [a,b]=people,req=async(who:typeof a,body?:unknown)=>app.request('/v1/edge/body',{method:body?'PUT':'GET',headers:{authorization:'Bearer '+who.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});tick(5);
 const asset=await app.request('/v1/edge/body/assets/'+CENTAUR_ASSET+'.glb');assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control')??'',/immutable/);
 const catalog=await(await req(a)).json();assert.ok(catalog.presets.some((p:any)=>p.id==='centaur'));assert.equal(catalog.body?.family??'humanoid','humanoid','humanoid stays the default');
 const sel=await accept(f.host,req(a,{preset:'centaur'}));assert.equal(sel.status,200,await sel.clone().text());const body=f.host.engine.world.entities[a.row.entity_id];assert.equal(body.body?.actionProfile,QUADRUPED_TORSO);assert.equal(body.body?.model,CENTAUR_ASSET);
 assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1').get() as {n:number}).n,0,'presets add no per-world blobs');
 // Discovery names its own way of resting and moving; nothing it cannot do is offered.
 const caps=edge.capabilities(a.soul);assert.ok(caps.some(c=>c.id==='nap:here'&&/standing/i.test(c.label)));assert.ok(!caps.some(c=>/\bRoll\b/.test(c.label)),'not relabelled as rolling');
 assert.ok(!caps.some(c=>['sit','sit-ground','swim','jump','eat','drink','ride','board'].includes(c.verb)));
 for(const verb of ['sit','sit-ground','swim','jump','eat','ride','invented-action']){assert.equal((edge.intents.dryRun(a.soul,{capability:verb+':here'}) as any).code,'body.unsupported',verb);const r=await accept(f.host,edge.act(a.soul,{capability:verb+':here'}));assert.equal(r.accepted,false,verb);assert.equal((r as any).code,'body.unsupported',verb);assert.match((r as any).reason??(r as any).message??'',/four-legged/,verb);}
 for(const p of [{activity:'sit-ground',seconds:2},{activity:'nap',seconds:2},{activity:'wave',seconds:2,base:'sit'}]){const r=f.host.engine.perform({actor:a.row.entity_id,label:'refused pose',steps:[{verb:'mars:pose_v1',params:p}]});assert.equal(r.ok,false,JSON.stringify(r));}
 const start=structuredClone(body.pose);for(const gait of ['cycle','run','jog'])assert.equal((f.host.engine as any).previewMarsVerbV1('walk_to',{actor:a.row.entity_id,x:start.p[0]+1,z:start.p[2],gait})?.code,'body.unsupported',gait);
 // Every native verb has a disposition: qualified, or refused with a reason.
 const registry=(f.host.engine as any).registry;for(const verb of registry.keys()){const reason=profileActionProblem(body.body,verb,{});if(!QUADRUPED_ACTIONS.native.includes(verb as never))assert.ok(reason&&reason.length>10,'unqualified native action must refuse: '+verb);}
 // Rest is upright standby on the same support, interrupted safely by a stand; replay stays deterministic.
 for(const verb of ['rest','nap','lie']){const r=await accept(f.host,edge.act(a.soul,{capability:verb+':here',params:{seconds:3}}));assert.ok(r.accepted,JSON.stringify(r));tick(20);assert.equal(body.human?.activity,'rest',verb);assert.deepEqual(body.pose,start);assert.equal((edge as any).posture(a.row.entity_id),'standby');
  const copy=factory.restore(f.host.engine.snapshot());for(let i=0;i<5;i++){f.host.engine.step();copy.step();assert.equal(copy.stateHash(),f.host.engine.stateHash());}
  const stop=await accept(f.host,edge.act(a.soul,{capability:'stand:here'}));assert.ok(stop.accepted);tick(20);assert.equal(body.human?.activity,'idle');assert.deepEqual(body.pose,start);}
 const dance=await accept(f.host,edge.act(a.soul,{capability:'dance:here',params:{seconds:3}}));assert.ok(dance.accepted,JSON.stringify(dance));tick(10);assert.equal(body.human?.activity,'dance');assert.deepEqual(body.pose,start,'dances in place');
 const halt=await accept(f.host,edge.act(a.soul,{capability:'stand:here'}));assert.ok(halt.accepted);tick(20);
 // A humanoid next to the centaur is not offered paired contact acts with it (partner profile), as native admission says.
 for(const verb of ['hug','high-five','dance-with'])assert.equal(profileActionProblem(body.body,verb,undefined,'edge')!==null,true,verb);
 const toward=edge.capabilities(b.soul).filter(c=>['hug','high-five','dance-with','handshake'].includes(c.verb)&&c.id.endsWith(':'+a.row.id));assert.ok(toward.length>0,'paired offers toward the centaur are listed');
 for(const c of toward){assert.equal(c.available,false,c.id);assert.equal(c.blocked?.code,'body.unsupported',c.id);const r=await accept(f.host,edge.act(b.soul,{capability:c.id}));assert.equal(r.accepted,false,c.id);assert.equal((r as any).code,'body.unsupported',c.id);}
 // Hands: the canonical adapters with real custody, then release onto support.
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:fixture',tick:()=>f.host.engine.world.tick,emit(){}});installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 assert.ok(god.act({ops:[{op:'place',def:'core/table@1',name:'load-table',p:[2,0]},{op:'place',def:'core/lantern@3',name:'real-load',in:{parent:'load-table',slot:'top'},p:[0,0]}]}).accepted);tick(15);
 const id=(name:string)=>[...god.model.entities.values()].find(e=>e.name===name)!.id,item=id('real-load'),table=id('load-table');
 const settle=async(receipt:string)=>{for(let i=0;i<1500&&!['completed','failed','interrupted'].includes(edge.receipt(a.row.id,receipt)?.phase??'');i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}return edge.receipt(a.row.id,receipt)?.phase;};
 const pick=await accept(f.host,edge.act(a.soul,{capability:'pick-up:'+item}));assert.ok(pick.accepted,JSON.stringify(pick));if(!pick.accepted)return;assert.equal(await settle(pick.receipt.id),'completed');
 assert.equal(((f.host.engine.world.entities[item] as any).support).kind,'in-hand');assert.equal(((f.host.engine.world.entities[item] as any).support).by,a.row.entity_id);
 const held=f.host.engine.perform({actor:a.row.entity_id,label:'no standby with a load',steps:[{verb:'mars:body_motion_v1',params:{motion:'rest',seconds:3}}]});assert.equal(held.ok,false,'rest refuses while carrying; custody kept');
 const put=await accept(f.host,edge.act(a.soul,{capability:'put-on:'+table}));assert.ok(put.accepted,JSON.stringify(put));if(!put.accepted)return;assert.equal(await settle(put.receipt.id),'completed');
 assert.notEqual(((f.host.engine.world.entities[item] as any).support).kind,'in-hand','released onto the table');
 const back=await accept(f.host,req(a,{preset:'humanoid'}));assert.equal(back.status,200,'safe swap back');assert.ok(edge.capabilities(b.soul).some(c=>c.verb==='sit'),'ordinary humanoid seating is preserved');
 const contract=await(await app.request('/body-authoring/contract.json')).json();assert.equal(contract.profiles.quadrupedTorso.id,QUADRUPED_TORSO);assert.equal(contract.profiles.quadrupedTorso.footprintRadius,.28);assert.equal(contract.profiles.rollingGripper.id,'rolling-gripper/1');
});
