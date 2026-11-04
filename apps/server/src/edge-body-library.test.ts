import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {rigidGLB,RIGID_MANIFEST} from './edge/body/testing.ts';import {BodyCollections} from './edge/body/collections.ts';

/** One world on a shared collection store (or its own database when `shared` is unset). Souls: owner a twice, owner b once. */
async function world(t:any,dir:string,name:string,shared?:string,types?:string[],bodySite?:unknown){
 const f=fixture(join(dir,name+'.db'),factory,{durableClockV1:true});f.brain.quiesce();
 const cfg=f.souls.cfg as {worldPath:string;bodyCollectionPath?:string};cfg.worldPath='/w/'+name;if(shared)cfg.bodyCollectionPath=shared;if(types)(cfg as any).bodyTypes=types;
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();});const ss:any[]=[];
 for(const [owner,n] of [['a',1],['a',2],['b',1]] as const){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:`${name} ${owner}${n}`,description:'library test'}));const p=f.souls.pairCode(row,'http://example.invalid'),token=f.souls.pairExchange(p.code,'scripted').token;ss.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,...(bodySite?{bodySite}:{}),soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))} as never);
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

test('body-library/1: a second world pulls the admitted bytes once through the site path, verified and re-admitted',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'body-library-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const shared=join(dir,'body-collections.sqlite'),KEY='site-key-0123456789';
 const fen=await world(t,dir,'fen',shared,undefined,{key:KEY}),[a1]=fen.ss;
 const ref=(await fen.upload(a1,{...RIGID_MANIFEST,name:'Travelling Stone'})).json.asset.assetId;
 // the world route is private: no key, a wrong key, or a proxied request is a plain 404
 for(const headers of [{},{'x-sim-site-key':'wrong-key-0123456789'},{'x-sim-site-key':KEY,'x-forwarded-for':'1.2.3.4'}] as Record<string,string>[])assert.equal((await fen.app.request(`/v1/site/body/${ref}.glb`,{headers})).status,404);
 let pulls=0,tamper=false;
 const pull=async(slug:string,r:string)=>{pulls++;assert.equal(slug,'fen');const res=await fen.app.request(`/v1/site/body/${r}.glb`,{headers:{'x-sim-site-key':KEY}});if(!res.ok)return null;const b=new Uint8Array(await res.arrayBuffer());if(tamper)b[b.length-1]^=1;return b;};
 const tarn=await world(t,dir,'tarn',shared,undefined,{key:KEY,pull}),[ta1,ta2,tb]=tarn.ss;
 assert.deepEqual((await tarn.req(ta1,'body/library/'+ref)).json.selectable,{ok:true,pull:true},'lookup says the bytes will be fetched at selection');
 tamper=true;const bad=await tarn.req(ta1,'body',{ref},'PUT');assert.equal(bad.json.error.code,'body.source-unavailable','tampered bytes never enter the world');tamper=false;
 const first=await accept(tarn.f.host,tarn.req(tb,'body',{ref},'PUT'));assert.equal(first.status,200,JSON.stringify(first.json));assert.equal(tarn.f.host.engine.world.entities[tb.row.entity_id].body?.model,ref);
 const served=await tarn.app.request(`/v1/edge/body/assets/${ref}.glb`);assert.equal(served.status,200);assert.deepEqual(new Uint8Array(await served.arrayBuffer()),new Uint8Array(await (await fen.app.request(`/v1/edge/body/assets/${ref}.glb`)).arrayBuffer()));
 const before=pulls;const second=await accept(tarn.f.host,tarn.req(ta2,'body',{ref},'PUT'));assert.equal(second.status,200);assert.equal(pulls,before,'cached once per world; no pull on the next selection');
 assert.equal((tarn.f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1 WHERE asset_id=?').get(ref) as {n:number}).n,1);
 assert.equal((tarn.f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_owners_v1').get() as {n:number}).n,0,'a pulled definition is not an upload of this world');
 // the destination's own moderation applies to a pulled definition too (a world or site hide of the same sha)
 const ref2=(await fen.upload(a1,{...RIGID_MANIFEST,name:'Second Stone'},rigidGLB((j:any)=>{j.nodes[0].name='Second';}))).json.asset.assetId;
 const pulled=await accept(tarn.f.host,tarn.req(ta1,'body',{ref:ref2},'PUT'));assert.equal(pulled.status,200,JSON.stringify(pulled.json));
 const {moderationFor}=await import('./moderation/store.ts');moderationFor(tarn.f.db.db,tarn.f.host.worldId).append({sha:ref2.slice(5),action:'hide',actor:'dev:mod',role:'admin',reason:'test'} as never);
 assert.equal((await tarn.req(tb,'body/library/'+ref2)).json.selectable.code,'body.withdrawn');assert.equal((await accept(tarn.f.host,tarn.req(ta2,'body',{ref:ref2},'PUT'))).json.error.code,'body.withdrawn');
 assert.equal((await fen.req(a1,'body/library/'+ref2)).json.definition.status,'active','a destination hide does not withdraw it at the source');
 // withdrawal at the source is written through when it is appended: nobody in fen looks it up, and tarn refuses at once
 moderationFor(fen.f.db.db,fen.f.host.worldId).append({sha:ref.slice(5),action:'hide',actor:'dev:mod',role:'admin',reason:'test'} as never);
 assert.equal((await accept(tarn.f.host,tarn.req(ta1,'body',{ref},'PUT'))).json.error.code,'body.withdrawn');
 assert.equal((await tarn.req(tb,'body/library/'+ref)).json.definition.status,'withdrawn');
 assert.equal((await fen.app.request(`/v1/site/body/${ref}.glb`,{headers:{'x-sim-site-key':KEY}})).status,410);
});
