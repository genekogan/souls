// core/humanoid@2 looks over the BODY owner API (needs the L10 shared-file patches: routes, engine body check).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {Hono} from 'hono';
import {WorldHost} from './world.ts';import {Db} from './db.ts';import {bodyV1Schema} from '@souls/protocol';
import {lookKey,resolveLook,appearanceFromSeed,legacyPreset,compactLook} from '../../web/src/humanoid/look.ts';
import {bodyProfile} from '../../../mars/viewer/engine/bodies/navigation.ts';
async function setup(t:any){const dir=mkdtempSync(join(tmpdir(),'body-look-')),path=join(dir,'sim.db'),f=fixture(path,factory,{durableClockV1:true});f.brain.quiesce();
 t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});const ss:any[]=[];
 for(const owner of ['a','b']){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:'Look '+owner,description:'scripted look test'}));const p=f.souls.pairCode(row,'http://127.0.0.1:4958'),token=f.souls.pairExchange(p.code,'scripted').token;ss.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
 const req=async(s:any,url:string,data?:unknown,method=data===undefined?'GET':'POST')=>app.request('/v1/edge/'+url,{method,headers:{authorization:'Bearer '+s.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 return {f,path,ss,req};}
const put=(w:any,s:any,look:unknown)=>accept(w.f.host,w.req(s,'body',{look},'PUT')) as Promise<Response>;
test('LOOK: edit over today\'s look, seeded random, preset, refusals, schema, other owner untouched, replay',async t=>{
 const w=await setup(t),[a,b]=w.ss,ent=(s:any)=>w.f.host.engine.world.entities[s.row.entity_id];
 const g=await (await w.req(a,'body')).json();if(g.lookDef===undefined){t.skip('needs the L10 routes/engine patches (tools/humanoid/patches)');return;}assert.equal(g.look,null);assert.equal(g.lookDef,'core/humanoid@2');assert.deepEqual(g.lookChoices.hat,['none','cap','beanie','sunhat']);
 // an edit starts from today's look (the legacy preset of this id) and keeps the other parts
 const r1=await put(w,a,{hat:'cap',top1:'#356477'});assert.equal(r1.status,200,await r1.clone().text());const b1=(await r1.json()).body;
 const today=resolveLook({preset:legacyPreset(a.row.entity_id)});
 assert.equal(b1.family,'humanoid');assert.equal(b1.model,lookKey({...today,preset:'none',hat:'cap',top1:'#356477'}));assert.equal(resolveLook(b1.params).top,today.top);assert.equal(resolveLook(b1.params).hat,'cap');
 assert.ok(bodyV1Schema.safeParse(b1).success,'stored body fits BODY-v1');assert.deepEqual(ent(a).body,b1);
 const g2=await (await w.req(a,'body')).json();assert.equal(g2.look.hat,'cap');
 // seeded random is deterministic; preset resets to the exact legacy look
 const r2=await put(w,a,{random:true,seed:42});assert.equal(r2.status,200);assert.deepEqual((await r2.json()).body,{family:'humanoid',model:lookKey(appearanceFromSeed(42)),params:compactLook(appearanceFromSeed(42))});
 const r3=await put(w,a,{random:true});assert.equal(r3.status,200);assert.match((await r3.json()).body.model,/^humanoid2-[0-9a-f]{16}$/);
 const r4=await put(w,a,{preset:'woman'});assert.equal(r4.status,200);assert.deepEqual((await r4.json()).body.params,{preset:'woman'});
 // sizes: a taller, broader, slower body is a different engine body (profile speed; the collider is capped at today's); the preset stays
 const r6=await put(w,a,{height:1.9,build:1.1,walkSpeed:1.0});assert.equal(r6.status,200,await r6.clone().text());const b6=(await r6.json()).body;
 assert.deepEqual(b6.params,{preset:'woman',height:1.9,build:1.1,walkSpeed:1});assert.deepEqual(ent(a).body,b6);
 const prof=bodyProfile(ent(a) as never);assert.equal(prof.speed,1);assert.equal(prof.radius,0.28,'a taller, broader look collides as today\'s body (lane N1 cap)');assert.equal(bodyProfile(ent(b) as never).speed,1.35,'the other Soul walks as before');
 // refusals: unknown key, bad value, mixed random, two assignment kinds; nothing changes
 const before=structuredClone(ent(a).body),seq=w.f.host.seq;
 for(const [look,code] of [[{wings:'big'},'body.look'],[{hair:'purple'},'body.look'],[{headSize:2},'body.look'],[{walkSpeed:1.5},'body.look'],[{height:2.3},'body.look'],[{random:true,hat:'cap'},'body.look'],['cap','body.look']] as const){
  const r=await put(w,a,look);assert.equal(r.status,400,JSON.stringify(look));assert.equal((await r.json()).error.code,code);}
 const both=await w.req(a,'body',{look:{hat:'cap'},preset:'humanoid'},'PUT');assert.equal(both.status,400);
 assert.deepEqual(ent(a).body,before);assert.equal(w.f.host.seq,seq,'refused looks admit no world input');
 assert.equal(ent(b).body,undefined,'the other Soul keeps its body');
 // back to the default humanoid; then a look again, and replay restores it
 assert.equal((await accept(w.f.host,w.req(a,'body',{preset:'humanoid'},'PUT'))).status,200);assert.equal(ent(a).body,undefined);
 const r5=await put(w,a,{random:true,seed:7});const kept=(await r5.json()).body;
 w.f.host.saveSnapshot(true);const id=w.f.host.worldId,seed=w.f.host.seed;w.f.host.stop();w.f.db.close();
 for(const mode of ['snapshot','genesis']){const db=new Db(w.path);if(mode==='genesis')db.db.exec('DELETE FROM snapshots');const h=new WorldHost(db,factory,seed,1e9,id,{durableClockV1:true});h.boot();
  assert.deepEqual(h.engine.world.entities[a.row.entity_id].body,kept,mode+' replay keeps the look');h.stop();db.close();}
});
