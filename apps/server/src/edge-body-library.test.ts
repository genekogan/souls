import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {rigidGLB,RIGID_MANIFEST} from './edge/body/testing.ts';import {BodyCollections} from './edge/body/collections.ts';

/** One world on a shared collection store (or its own database when `shared` is unset). Souls: owner a twice, owner b once. */
async function world(t:any,dir:string,name:string,shared?:string,types?:string[]){
 const f=fixture(join(dir,name+'.db'),factory,{durableClockV1:true});f.brain.quiesce();
 const cfg=f.souls.cfg as {worldPath:string;bodyCollectionPath?:string};cfg.worldPath='/w/'+name;if(shared)cfg.bodyCollectionPath=shared;if(types)(cfg as any).bodyTypes=types;
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();});const ss:any[]=[];
 for(const [owner,n] of [['a',1],['a',2],['b',1]] as const){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:`${name} ${owner}${n}`,description:'library test'}));const p=f.souls.pairCode(row,'http://example.invalid'),token=f.souls.pairExchange(p.code,'scripted').token;ss.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const req=async(s:any,url:string,data?:unknown,method=data===undefined?'GET':'POST')=>{const r=await app.request('/v1/edge/'+url,{method,headers:{authorization:'Bearer '+s.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,json:await r.json() as any};};
 const upload=async(s:any,manifest:any,bytes=rigidGLB())=>{const form=new FormData();form.set('manifest',JSON.stringify(manifest));form.set('model',new Blob([new Uint8Array(bytes)],{type:'model/gltf-binary'}),'b.glb');const r=await app.request('/v1/edge/body/uploads',{method:'POST',headers:{authorization:'Bearer '+s.token},body:form});return {status:r.status,json:await r.json() as any};};
 for(let i=0;i<5;i++)f.host.tickOnce();
 return {f,ss,app,req,upload,ledger};
}

test('body-library/1: owner collections across worlds, public lookup by reference, owner-only mutation, bounded pages',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'body-library-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const shared=join(dir,'body-collections.sqlite');
 const fen=await world(t,dir,'fen',shared),[a1,a2,b]=fen.ss;
 const up=await fen.upload(a1,{...RIGID_MANIFEST,name:'Moss Lantern',description:'A small glowing sculpture.'});assert.equal(up.status,200,JSON.stringify(up.json));const ref=up.json.asset.assetId;
 // A2: the creator's collection, rediscovered by a fresh session of the same owner without filenames; unrelated owners do not see it
 const mineA2=await fen.req(a2,'body/library?scope=mine');assert.equal(mineA2.status,200);assert.deepEqual(mineA2.json.items.map((i:any)=>i.ref),[ref]);assert.equal(mineA2.json.items[0].name,'Moss Lantern');
 assert.deepEqual((await fen.req(b,'body/library?scope=mine')).json.items,[]);
 // public lookup by explicit reference, with attribution; it grants no membership
 const look=await fen.req(b,'body/library/'+ref);assert.equal(look.status,200);assert.equal(look.json.definition.attribution.creatorSoul,a1.row.id);assert.equal(look.json.definition.status,'active');assert.equal(look.json.saved,false);assert.deepEqual(look.json.selectable,{ok:true});
 assert.equal((await fen.req(b,'body/library/body_'+'0'.repeat(64))).json.error.code,'body.ref-unknown');
 // explicit public reference selection by another owner; the old owner-only assetId route still refuses them
 assert.equal((await fen.req(b,'body',{assetId:ref},'PUT')).status,403);
 const chosen=await accept(fen.f.host,fen.req(b,'body',{ref},'PUT'));assert.equal(chosen.status,200,JSON.stringify(chosen.json));assert.equal(fen.f.host.engine.world.entities[b.row.entity_id].body?.model,ref);
 // owner-only mutation: b saves to b's collection; b cannot remove it from a's
 assert.equal((await fen.req(b,'body/library/'+ref,{}, 'PUT')).json.saved,true);assert.equal((await fen.req(b,'body/library?scope=mine')).json.items.length,1);
 assert.equal((await fen.req(b,'body/library/'+ref,undefined,'DELETE')).json.saved,false);assert.equal((await fen.req(a2,'body/library?scope=mine')).json.items.length,1,'a forget by b leaves a unchanged');
 // a second, differently named world on the same store: the owner rediscovers the definition; bytes are not here yet
 const tarn=await world(t,dir,'tarn',shared),[ta]=tarn.ss;
 const there=await tarn.req(ta,'body/library?scope=mine');assert.deepEqual(there.json.items.map((i:any)=>i.ref),[ref]);
 const lookThere=await tarn.req(ta,'body/library/'+ref);assert.equal(lookThere.json.definition.sourceWorld,'/w/fen');assert.equal(lookThere.json.selectable.code,'body.source-unavailable');
 const refused=await tarn.req(ta,'body',{ref},'PUT');assert.equal(refused.status,409);assert.equal(refused.json.error.code,'body.source-unavailable');
 // routine discovery carries only a short pointer (A6)
 const plain=await fen.req(a1,'body');assert.deepEqual(plain.json.library,{mine:1,next:'GET /v1/edge/body/library?scope=mine'});
 // core scope: shared presets, paginated, bounded search
 const core=await fen.req(a1,'body/library?scope=core&limit=5');assert.equal(core.json.items.length,5);assert.equal(core.json.items[0].ref,'humanoid');assert.equal(core.json.next,core.json.items[4].ref);
 const page2=await fen.req(a1,`body/library?scope=core&limit=5&cursor=${core.json.next}`);assert.notEqual(page2.json.items[0].ref,core.json.items[0].ref);
 assert.deepEqual((await fen.req(a1,'body/library?scope=core&q=monster')).json.items.map((i:any)=>i.ref),['monster']);
 for(const bad of ['scope=all','limit=0','limit=21','q='+'x'.repeat(61),'scope=core&cursor=nope'])assert.equal((await fen.req(a1,'body/library?'+bad)).status,400,bad);
});

test('body-library/1: withdrawal, narrowed world policy, idempotent import, 100 saved definitions leave routine context unchanged',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'body-library-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const shared=join(dir,'body-collections.sqlite');
 const fen=await world(t,dir,'fen',shared),[a1,,b]=fen.ss;
 const ref=(await fen.upload(a1,{...RIGID_MANIFEST,name:'Withdrawn One'})).json.asset.assetId;
 const ok=await fen.upload(a1,{...RIGID_MANIFEST,name:'Kept One'},rigidGLB((j:any)=>{j.nodes[0].name='Kept';}));assert.equal(ok.status,200,JSON.stringify(ok.json));const kept=ok.json.asset.assetId;
 // the source world's moderation withdrawal is written through: lookup says so and new selection refuses
 const {moderationFor}=await import('./moderation/store.ts');moderationFor(fen.f.db.db,fen.f.host.worldId).append({sha:ref.slice(5),action:'hide',actor:'dev:mod',role:'admin',reason:'test'} as never);
 const look=await fen.req(b,'body/library/'+ref);assert.equal(look.json.definition.status,'withdrawn');assert.equal(look.json.selectable.code,'body.withdrawn');
 assert.equal((await fen.req(b,'body',{ref},'PUT')).json.error.code,'body.withdrawn');
 // a world narrowed to humanoids refuses the ceramic definition clearly
  const narrow=await world(t,dir,'narrow',shared,['humanoid']),[n1]=narrow.ss;const policy=await narrow.req(n1,'body/library/'+kept);assert.equal(policy.json.selectable.code,'body.world-policy');assert.equal((await narrow.req(n1,'body',{ref:kept},'PUT')).status,403);
 // idempotent import: reopening the store and re-recording keeps the first attribution
 const store=new BodyCollections(shared);const before=store.definition(ref);store.record({ref,descriptor:{name:'changed'},creatorSoul:'someone',owner:'dev:z',sourceWorld:'/w/x',license:'CC0',rightsConfirmed:true},1);assert.deepEqual(store.definition(ref),before);
 // A6: 100 unrelated saved definitions in owner a's collection; routine body discovery and observation stay the same size
 const ctx0=JSON.stringify((await fen.req(b,'body')).json).length,obs0=JSON.stringify(fen.ledger.observe(b.soul,new Set())).length;
 for(let i=0;i<100;i++){const r='body_'+i.toString(16).padStart(64,'0');store.record({ref:r,descriptor:{name:'Unrelated '+i,type:'ceramic'},creatorSoul:'s_x',owner:'dev:a',sourceWorld:'/w/elsewhere',license:'CC0',rightsConfirmed:true},2);}
 assert.equal(JSON.stringify((await fen.req(b,'body')).json).length,ctx0);assert.equal(JSON.stringify(fen.ledger.observe(b.soul,new Set())).length,obs0);
 const mine=await fen.req(a1,'body/library?scope=mine&limit=20');assert.equal(mine.json.items.length,20);assert.ok(mine.json.next);
 assert.equal((await fen.req(a1,'body')).json.library.mine,102);
 store.close();
});
