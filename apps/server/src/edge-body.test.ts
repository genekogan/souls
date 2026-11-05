import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {rigidGLB,RIGID_MANIFEST,canonicalHumanoidGLB} from './edge/body/testing.ts';import {WorldHost} from './world.ts';import {Db} from './db.ts';
async function setup(t:any){const dir=mkdtempSync(join(tmpdir(),'body-api-')),path=join(dir,'sim.db'),f=fixture(path,factory,{durableClockV1:true});f.brain.quiesce();
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});const ss:any[]=[];
 for(const owner of ['a','b']){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:'Body '+owner,description:'scripted body test'}));const p=f.souls.pairCode(row,'http://127.0.0.1:4958'),token=f.souls.pairExchange(p.code,'scripted').token;ss.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const req=async(s:any,url:string,data?:unknown,method=data===undefined?'GET':'POST')=>app.request('/v1/edge/'+url,{method,headers:{authorization:'Bearer '+s.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const upload=(s:any,bytes=rigidGLB(),manifest:any=RIGID_MANIFEST)=>{const form=new FormData();form.set('manifest',JSON.stringify(manifest));form.set('model',new Blob([new Uint8Array(bytes)],{type:'model/gltf-binary'}),'../../unsafe.glb');return app.request('/v1/edge/body/uploads',{method:'POST',headers:{authorization:'Bearer '+s.token},body:form});};
 return {f,path,dir,ss,ledger,app,req,upload};}
test('BODY owner API: admission, ownership, rights and honest rigid offers/refusals, logged safe assignment and restart/genesis replay',async t=>{
 const w=await setup(t),[a,b]=w.ss;
 assert.equal((await w.app.request('/v1/edge/body')).status,401);
 const bad=await w.upload(a,rigidGLB(),{...RIGID_MANIFEST,rightsConfirmed:false});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'body.rights');assert.equal((w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1').get() as any).n,0);
 const response=await w.upload(a);assert.equal(response.status,200);const asset=(await response.json()).asset;assert.match(asset.assetId,/^body_[a-f0-9]{64}$/);
 assert.match(asset.modelUrl,/^\/w\/eden\/v1\/edge\/body\/assets\//);const publicAsset=await w.app.request(asset.modelUrl.replace(/^\/w\/eden/,''));assert.equal(publicAsset.status,200);assert.equal(publicAsset.headers.get('content-type'),'model/gltf-binary');assert.deepEqual(Buffer.from(await publicAsset.arrayBuffer()),rigidGLB());
 assert.equal((await w.req(b,'body',{assetId:asset.assetId},'PUT')).status,403);assert.equal(w.f.host.engine.world.entities[b.row.entity_id].body,undefined);
 const human=await w.upload(b,canonicalHumanoidGLB(),{type:'humanoid',license:'CC0',rightsConfirmed:true,rig:'quaternius/1'});assert.equal(human.status,200,await human.clone().text());const humanAsset=(await human.json()).asset;
 const humanAssigned=await accept(w.f.host,w.req(b,'body',{assetId:humanAsset.assetId},'PUT'));assert.equal(humanAssigned.status,200,await humanAssigned.clone().text());assert.equal(w.f.host.engine.world.entities[b.row.entity_id].body?.family,'humanoid');
 const assigned=await accept(w.f.host,w.req(a,'body',{assetId:asset.assetId},'PUT'));assert.equal(assigned.status,200,await assigned.clone().text());assert.equal((await assigned.json()).body.type,'ceramic');
 const caps=w.ledger.capabilities(a.soul);assert.ok(caps.some(c=>c.verb==='hover'));assert.ok(caps.some(c=>c.verb==='settle'));assert.ok(!caps.some(c=>['sit','swim','hug','wave','pick-up','play-piano'].includes(c.verb)));
 const refusalHead=w.f.host.seq,refusalHash=w.f.host.engine.stateHash();
 for(const q of [{capability:'sit:here'},{verb:'sit',target:{nearest:'seat'}},{capability:'hug:'+b.row.id},{capability:'swim:shore-water'},{capability:'swim:the pond'},{capability:'swim:invented-water'},{capability:'read:the library'}]){const out=await accept(w.f.host,w.ledger.act(a.soul,q));assert.equal(out.accepted,false);assert.equal((out as any).code,'body.unsupported',JSON.stringify(q));}
 assert.equal(w.f.host.seq,refusalHead,'unsupported BODY requests admit no native input');assert.equal(w.f.host.engine.stateHash(),refusalHash);
 const unknownWalk=await accept(w.f.host,w.ledger.act(a.soul,{capability:'walk:invented-room'}));assert.equal(unknownWalk.accepted,false);assert.equal((unknownWalk as any).code,'capability.unknown','rigid-supported movement keeps strict unknown target refusal');
 assert.equal((w.ledger.intents.dryRun(a.soul,{verb:'sit',target:{nearest:'seat'}}) as any).code,'body.unsupported');
 const hover=await accept(w.f.host,w.ledger.act(a.soul,{capability:'hover:here',params:{seconds:1}}));assert.ok(hover.accepted);const unsafe=await w.req(a,'body',{preset:'humanoid'},'PUT');assert.equal(unsafe.status,409);assert.equal((await unsafe.json()).error.code,'body.safe-standing-required');
 for(let i=0;i<60;i++)w.f.host.tickOnce();assert.deepEqual(w.f.host.engine.runtime.violations,[]);
 const body=structuredClone(w.f.host.engine.world.entities[a.row.entity_id].body),humanBody=structuredClone(w.f.host.engine.world.entities[b.row.entity_id].body),hash=w.f.host.engine.stateHash(),events=w.f.db.events(w.f.host.worldId);assert.equal(events.filter(e=>e.kind==='body-assignment-v1').length,2);
 w.f.host.saveSnapshot(true);const id=w.f.host.worldId,seed=w.f.host.seed;w.f.host.stop();w.f.db.close();
 for(const mode of ['snapshot','genesis']){const db=new Db(w.path);if(mode==='genesis')db.db.exec('DELETE FROM snapshots');const h=new WorldHost(db,factory,seed,1e9,id,{durableClockV1:true});const result=h.boot();h.drainInputs();assert.deepEqual(h.engine.world.entities[a.row.entity_id].body,body,JSON.stringify(result));assert.deepEqual(h.engine.world.entities[b.row.entity_id].body,humanBody);assert.equal(h.engine.stateHash(),hash);h.stop();db.close();}
});
test('BODY presets: thirteen role-independent shipped sculptures and three creatures plus default; pending swap revocation leaves no assignment',async t=>{
 const w=await setup(t),[a,b]=w.ss,catalog=await (await w.req(a,'body')).json();assert.deepEqual(catalog.presets.map((p:any)=>p.id),['humanoid','pip','verdelis','kalama','kweku','mycos','ada','shuijing','nyx','green-patterns-blue','chebel','colors-lemuet','crystal-freeman','dark-blue','green-brains-out','duck','snail','dog','monster','ghost']);
 for(const preset of catalog.presets.slice(1).filter((p:any)=>p.body.family==='floater'&&p.body.type!=='creature'&&p.body.model===p.id)){const response=await accept(w.f.host,w.req(b,'body',{preset:preset.id},'PUT'));assert.equal(response.status,200,await response.clone().text());const body=(await response.json()).body;assert.equal(body.model,preset.id);assert.equal(body.modelUrl,`/world-assets/littlemartians/characters/${preset.id}.glb`);assert.equal(body.avatar.modelUrl,body.modelUrl);}
 const request=w.req(a,'body',{preset:'verdelis'},'PUT');await new Promise(r=>setImmediate(r));w.f.db.setSoulToken(a.row.id,null,null);const response=await accept(w.f.host,request);assert.equal(response.status,401);assert.equal(w.f.host.engine.world.entities[a.row.entity_id].body,undefined);assert.equal(w.f.db.events(w.f.host.worldId).filter(e=>e.kind==='body-assignment-v1'&&e.payload.soulId===a.row.id).length,0);
});
test('BODY same content hash deduplicates bytes while preserving each owner manifest and rights attestation',async t=>{
 const w=await setup(t),[a,b]=w.ss,ca=await w.upload(a),fb=await w.upload(b,rigidGLB(),{type:'floater',license:'CC0',rightsConfirmed:true});assert.equal(ca.status,200);assert.equal(fb.status,200);const x=(await ca.json()).asset,y=(await fb.json()).asset;assert.equal(x.assetId,y.assetId);
 assert.equal((w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1').get() as any).n,1);
 const ownedA=await(await w.req(a,'body')).json(),ownedB=await(await w.req(b,'body')).json();assert.equal(ownedA.uploads[0].type,'ceramic');assert.equal(ownedA.uploads[0].license,'owned');assert.equal(ownedB.uploads[0].type,'floater');assert.equal(ownedB.uploads[0].license,'CC0');assert.equal(ownedB.uploads[0].rightsConfirmed,true);
 const aa=await accept(w.f.host,w.req(a,'body',{assetId:x.assetId},'PUT')),bb=await accept(w.f.host,w.req(b,'body',{assetId:y.assetId},'PUT'));assert.equal((await aa.json()).body.type,'ceramic');assert.equal((await bb.json()).body.type,'floater');
});
test('BODY a faded Soul is told to act once to come back, not to finish a commitment (release-3.1 walk)',async t=>{
 const w=await setup(t),[a]=w.ss;w.ledger.faded.add(a.soul.soulId);
 const r=await w.req(a,'body',{look:{hat:'cap'}},'PUT');assert.equal(r.status,409);const e=(await r.json()).error;assert.equal(e.code,'body.safe-standing-required');assert.match(e.message,/faded.*act once/);
 w.ledger.faded.delete(a.soul.soulId);
});
