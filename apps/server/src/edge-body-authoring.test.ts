import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {rigidGLB} from './edge/body/testing.ts';import {LITTLE_MARTIANS_MOTION} from '../../../mars/viewer/engine/bodies/motion.ts';
import {mountBodyRoutes,BODY_PRESETS} from './edge/body/routes.ts';
import {admitBodyGLB} from './edge/body/admission.ts';

test('downloaded dependency-free validator, named owner discovery, upload, dance, refusal and safe selection',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();const dir=mkdtempSync(join(tmpdir(),'authored-body-'));
 t.after(()=>{f.host.stop();f.db.close();rmSync(dir,{recursive:true,force:true});});
 const people=[];
 for(const owner of ['author','visitor']){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:'Sculpture '+owner,description:'Authored body fixture'}));const p=f.souls.pairCode(row,'http://example.invalid'),token=f.souls.pairExchange(p.code,'fixture').token;people.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const [a,b]=people,L=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:L,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const request=async(who:typeof a,path='',body?:unknown)=>app.request('/v1/edge/body'+path,{method:body?'PUT':'GET',headers:{authorization:'Bearer '+who.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 for(const file of ['validate.mjs','upload.mjs','admission.ts','rig.ts','motion.ts','action-profile.ts','upload-validation.ts']){const r=await app.request('/body-authoring/'+file);assert.equal(r.status,200);writeFileSync(join(dir,file),await r.text());}
 const skill=await(await app.request('/body-authoring/SKILL.md')).text();assert.ok(!skill.includes('{{BASE}}'));assert.match(skill,/upload.mjs/);
 const manifest={type:'ceramic',license:'owned',rightsConfirmed:true,name:'Cloud Pebble',description:'A locally authored floating sculpture.',motion:structuredClone(LITTLE_MARTIANS_MOTION)},bytes=rigidGLB(j=>{j.extras={authoringNote:'Discarded source metadata'};});
 writeFileSync(join(dir,'model.glb'),bytes);writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));
 const local=JSON.parse(execFileSync(process.execPath,['validate.mjs','model.glb','manifest.json'],{cwd:dir,encoding:'utf8'}));assert.equal(local.valid,true);
 const upload=async(m:unknown)=>{const form=new FormData();form.set('model',new Blob([new Uint8Array(bytes)],{type:'model/gltf-binary'}),'sculpture.glb');form.set('manifest',JSON.stringify(m));return app.request('/v1/edge/body/uploads',{method:'POST',headers:{authorization:'Bearer '+a.token},body:form});};
 const r=await upload(manifest);assert.equal(r.status,200,await r.clone().text());const asset=(await r.json()).asset;assert.equal(asset.assetId,local.admitted.assetId);assert.equal(asset.name,'Cloud Pebble');const served=await app.request(asset.modelUrl.replace(/^\/w\/eden/,''));const admittedBytes=Buffer.from(await served.arrayBuffer());const {createHash}=await import('node:crypto');assert.equal(asset.assetId,'body_'+createHash('sha256').update(admittedBytes).digest('hex'));assert.deepEqual(asset.motion,manifest.motion);
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:'http://example.invalid',token:a.token}),{mode:0o600});const helper=await import(pathToFileURL(join(dir,'upload.mjs')).href);const viaHelper=await helper.uploadBody('model.glb','manifest.json',{read:(file:string,encoding?:BufferEncoding)=>readFileSync(join(dir,file),encoding),fetcher:(url:string,init:RequestInit)=>app.request(new URL(url).pathname,init)});assert.equal(viaHelper.asset.assetId,asset.assetId,'downloaded helper works with existing paired state and agrees with local/server admission');assert.equal((await(await request(a)).json()).authoring.skill,'/w/eden/body-authoring/SKILL.md');
 assert.equal((await(await request(a)).json()).uploads[0].assetId,asset.assetId);assert.deepEqual((await(await request(b)).json()).uploads,[]);assert.equal((await request(b,'',{assetId:asset.assetId})).status,403);
 const worn=await accept(f.host,request(a,'',{assetId:asset.assetId}));assert.equal(worn.status,200,await worn.clone().text());
 const dance=L.capabilities(a.soul).find(c=>c.id==='dance:here');assert.ok(dance?.available,JSON.stringify(dance));assert.equal((L.intents.dryRun(a.soul,{capability:'dance:here',params:{seconds:2}}) as any).ok,true);
 const spatial=(f.host.engine as any).rt.services.spatial,reader=spatial.clearanceReader;
 try{spatial.clearanceReader=()=>()=>.3;f.host.tickOnce();const blocked=L.capabilities(a.soul).find(c=>c.id==='dance:here');assert.equal(blocked?.available,false,'discovery uses the rigid radius, not the smaller humanoid radius');assert.equal(f.host.engine.canPerform({actor:a.row.entity_id,label:'dance',steps:[{verb:'mars:body_motion_v1',params:{motion:'dance',seconds:2}}]})?.code,'body.motion-unavailable');}finally{spatial.clearanceReader=reader;f.host.tickOnce();}
 const p=structuredClone(f.host.engine.world.entities[a.row.entity_id].pose),act=await accept(f.host,L.act(a.soul,{capability:'dance:here',params:{seconds:2}}));assert.ok(act.accepted,JSON.stringify(act));for(let i=0;i<22;i++)f.host.tickOnce();
 assert.equal(f.host.engine.world.entities[a.row.entity_id].human?.activity,'dance');assert.deepEqual(f.host.engine.world.entities[a.row.entity_id].pose,p);
 assert.equal((await request(a,'',{preset:'humanoid'})).status,409);
 for(let i=0;i<42;i++)f.host.tickOnce();assert.equal(f.host.engine.world.entities[a.row.entity_id].human?.activity,'idle');
 const refused=await accept(f.host,L.act(a.soul,{verb:'pick-up',target:{id:'anything'}}));assert.equal(refused.accepted,false);assert.equal((refused as any).code,'body.unsupported');
 const rediscovered=await(await request(a)).json();assert.equal(rediscovered.uploads[0].name,'Cloud Pebble');assert.equal(rediscovered.body.model,asset.assetId);
 const changed=structuredClone(manifest);changed.motion.dance!.yaw=.2;assert.notEqual(admitBodyGLB(admittedBytes,changed).assetId,asset.assetId,'a changed adapter is a different immutable definition');
 for(const preset of rediscovered.presets.filter((p:any)=>p.body?.type==='ceramic')){const r=await accept(f.host,request(a,'',{preset:preset.id}));assert.equal(r.status,200);assert.ok((await r.json()).body.motion.dance,preset.id);}
 const prior=f.souls.cfg.bodyTypes;try{f.souls.cfg.bodyTypes=['humanoid'];const limited=new Hono();mountBodyRoutes(limited,{host:f.host,db:f.db,souls:f.souls,ledger:L,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const headers={authorization:'Bearer '+a.token,'content-type':'application/json'};const catalog=await(await limited.request('/v1/edge/body',{headers})).json();assert.deepEqual(catalog.types,['humanoid']);assert.deepEqual(catalog.presets.map((p:any)=>p.id),['humanoid','pip','monster']);assert.equal((await limited.request('/v1/edge/body',{method:'PUT',headers,body:JSON.stringify({preset:'verdelis'})})).status,403);
 const ceramic=BODY_PRESETS.find(p=>p.body?.type==='ceramic')!.body!,host=f.host as unknown as {restoreBody(b:unknown):void;captureBody():unknown};
 assert.equal(f.host.engine.bodyAssignmentProblemV1!(a.soul.entityId,ceramic),'body.world-policy');
 host.restoreBody(host.captureBody());assert.equal(f.host.engine.bodyAssignmentProblemV1!(a.soul.entityId,ceramic),'body.world-policy','a host engine swap (rollback/recovery) keeps the world policy for travel and other live guards');
 }finally{f.souls.cfg.bodyTypes=prior;f.host.configureBodyTypesV1(prior??['humanoid','ceramic','floater','creature']);}
});
