import{setImmediate}from'node:timers/promises';import{GodMode}from'./god/god.ts';import{installEngineBridge}from'./god/engine-bridge.ts';
import test from 'node:test';import assert from 'node:assert/strict';import{Hono}from'hono';
import{fixture,invite,accept,factory}from'../test/native-owner-fixture.ts';import{EdgeLedger}from'./edge/ledger/ledger.ts';import{mountEdgeRoutes,edgeSoulResolver}from'./edge/routes.ts';
import{PIP_ASSET}from'./edge/body/pip.ts';import{BODY_PRESETS}from'./edge/body/routes.ts';import{MONSTER_ASSET,GHOST_ASSET,CENTAUR_ASSET,CENTAUR_PRESET,centaurBytes}from'./edge/body/shared-bodies.ts';
import{admitBodyGLB,bindBodyDefinition,QUADRUPED_FOOTPRINT_RADIUS,QUADRUPED_FOOTPRINT_KEYS,QUADRUPED_FOOTPRINT_WORK}from'./edge/body/admission.ts';import{validateUpload,BODY_UPLOAD_POLICY}from'./moderation/validate.ts';
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
 // Throughout, not only at frame 0: a hind-leg kick after the first key of Dance_Loop is refused.
 const kick=regl(made.bytes,(j,bin)=>{const leg=j.nodes.findIndex((n:any)=>n.name==='HindUpperLeg.L'),clip=j.animations.find((c:any)=>c.name==='Dance_Loop'),ch=clip.channels.find((c:any)=>c.target.node===leg&&c.target.path==='rotation'),a=j.accessors[clip.samplers[ch.sampler].output],v=j.bufferViews[a.bufferView],at=(v.byteOffset??0)+(a.byteOffset??0);
  const q=[0,1,2,3].map(i=>bin.readFloatLE(at+i*4)),[x,y,z,w]=q,sx=Math.sin(.8),cw=Math.cos(.8),k=[w*sx+x*cw,y*cw+z*sx,z*cw-y*sx,w*cw-x*sx],vals=new Float32Array(a.count*4);for(let i=0;i<a.count;i++)vals.set(i===0?q:k,i*4);
  const add=Buffer.from(vals.buffer);j.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:add.length});j.accessors.push({bufferView:j.bufferViews.length-1,componentType:5126,count:a.count,type:'VEC4'});clip.samplers[ch.sampler].output=j.accessors.length-1;const out=Buffer.concat([bin,add]);j.buffers[0].byteLength=out.length;return out;});
 assert.throws(()=>admit({bytes:kick,manifest:made.manifest}),(e:any)=>e.code==='body.footprint'&&/Dance_Loop at [1-9]/.test(e.message),'a kick after frame 0');
 // Every key time is measured: a kick on one key among 40 is refused; more than the named cap of key times is refused by name.
 const keyed=(n:number,kickAt:number)=>regl(made.bytes,(j,bin)=>{const leg=j.nodes.findIndex((x:any)=>x.name==='HindUpperLeg.L'),clip=j.animations.find((c:any)=>c.name==='Dance_Loop'),ch=clip.channels.find((c:any)=>c.target.node===leg&&c.target.path==='rotation'),a=j.accessors[clip.samplers[ch.sampler].output],v=j.bufferViews[a.bufferView],at=(v.byteOffset??0)+(a.byteOffset??0);
  const [x,y,z,w]=[0,1,2,3].map(i=>bin.readFloatLE(at+i*4)),sx=Math.sin(.45),cw=Math.cos(.45),k=[w*sx+x*cw,y*cw+z*sx,z*cw-y*sx,w*cw-x*sx],T=new Float32Array(n),V=new Float32Array(n*4);for(let i=0;i<n;i++){T[i]=4*i/(n-1);V.set(i===kickAt?k:[x,y,z,w],i*4);}
  const parts=[bin];let off=bin.length;const view=(b:Buffer)=>{j.bufferViews.push({buffer:0,byteOffset:off,byteLength:b.length});parts.push(b);off+=b.length;return j.bufferViews.length-1;};
  j.accessors.push({bufferView:view(Buffer.from(T.buffer)),componentType:5126,count:n,type:'SCALAR',min:[0],max:[4]});clip.samplers[ch.sampler].input=j.accessors.length-1;
  j.accessors.push({bufferView:view(Buffer.from(V.buffer)),componentType:5126,count:n,type:'VEC4'});clip.samplers[ch.sampler].output=j.accessors.length-1;const out=Buffer.concat(parts);j.buffers[0].byteLength=out.length;return out;});
 assert.throws(()=>admit({bytes:keyed(40,13),manifest:made.manifest}),(e:any)=>e.code==='body.footprint'&&/Dance_Loop at 1\.33/.test(e.message),'a kick on key 13 of 40');
 assert.ok(admit({bytes:keyed(40,-1),manifest:made.manifest}).actionProfile,'40 still keys are admitted');
 assert.throws(()=>admit({bytes:keyed(65,-1),manifest:made.manifest}),(e:any)=>e.code==='body.too-complex'&&e.details?.field==='footprintKeys'&&e.details.limit===64&&e.details.measured===65);
 // Many unused vertices (unbounded by the triangle cap) get a measurement, never a stack overflow.
 const padded=regl(made.bytes,(j,bin)=>{const p=j.meshes[0].primitives[0],N=140000;const pos=j.accessors[p.attributes.POSITION],pv=j.bufferViews[pos.bufferView],pat=(pv.byteOffset??0)+(pos.byteOffset??0);
  const P=new Float32Array((pos.count+N)*3),J=new Uint8Array((pos.count+N)*4),W=new Uint8Array((pos.count+N)*4);for(let i=0;i<pos.count*3;i++)P[i]=bin.readFloatLE(pat+i*4);
  const ja=j.accessors[p.attributes.JOINTS_0],jv=j.bufferViews[ja.bufferView],jat=(jv.byteOffset??0)+(ja.byteOffset??0);for(let i=0;i<pos.count;i++){J[i*4]=bin.readUInt16LE(jat+i*8);W[i*4]=255;}for(let i=pos.count;i<pos.count+N;i++){P.set(P.subarray(0,3),i*3);J[i*4]=J[0];W[i*4]=255;}
  const parts=[bin];let off=bin.length;const view=(b:Buffer)=>{j.bufferViews.push({buffer:0,byteOffset:off,byteLength:b.length});parts.push(b,Buffer.alloc((4-b.length%4)%4));off+=Math.ceil(b.length/4)*4;return j.bufferViews.length-1;};
  j.accessors.push({bufferView:view(Buffer.from(P.buffer)),componentType:5126,count:pos.count+N,type:'VEC3',min:pos.min,max:pos.max});p.attributes.POSITION=j.accessors.length-1;
  j.accessors.push({bufferView:view(Buffer.from(J.buffer)),componentType:5121,count:pos.count+N,type:'VEC4'});p.attributes.JOINTS_0=j.accessors.length-1;
  j.accessors.push({bufferView:view(Buffer.from(W.buffer)),componentType:5121,normalized:true,count:pos.count+N,type:'VEC4'});p.attributes.WEIGHTS_0=j.accessors.length-1;delete p.attributes.NORMAL;delete p.attributes.COLOR_0;
  const out=Buffer.concat(parts);j.buffers[0].byteLength=out.length;return out;});
 assert.ok(padded.length<4*1024*1024,'under the byte cap: '+padded.length);
 const t0=Date.now();assert.throws(()=>admit({bytes:padded,manifest:made.manifest}),(e:any)=>e.code==='body.too-complex'&&e.details?.field==='footprintWork'&&e.details.measured>e.details.limit,'bounded work: refused by name');assert.ok(Date.now()-t0<5000,'and quickly');
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
 const contract=await(await app.request('/body-authoring/contract.json')).json();assert.equal(contract.profiles.quadrupedTorso.id,QUADRUPED_TORSO);assert.equal(contract.profiles.quadrupedTorso.footprintRadius,QUADRUPED_FOOTPRINT_RADIUS);assert.equal(contract.profiles.quadrupedTorso.footprintKeys,QUADRUPED_FOOTPRINT_KEYS);assert.equal(contract.profiles.quadrupedTorso.footprintWork,QUADRUPED_FOOTPRINT_WORK);assert.equal(QUADRUPED_FOOTPRINT_KEYS,64,'the served contract and admission agree on the published cap');assert.equal(contract.profiles.rollingGripper.id,'rolling-gripper/1');
});
