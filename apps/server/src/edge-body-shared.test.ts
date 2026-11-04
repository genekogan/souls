import{setImmediate}from'node:timers/promises';import{GodMode}from'./god/god.ts';import{installEngineBridge}from'./god/engine-bridge.ts';
import test from 'node:test';import assert from 'node:assert/strict';import{Hono}from'hono';
import{fixture,invite,accept,factory}from'../test/native-owner-fixture.ts';import{EdgeLedger}from'./edge/ledger/ledger.ts';import{mountEdgeRoutes,edgeSoulResolver}from'./edge/routes.ts';
import{PIP_ASSET}from'./edge/body/pip.ts';import{BODY_PRESETS}from'./edge/body/routes.ts';
import{MONSTER_ASSET,GHOST_ASSET,MONSTER_PRESET,GHOST_PRESET,monsterBytes,ghostBytes}from'./edge/body/shared-bodies.ts';
import{GHOST_MANIFEST}from'../../../tools/body-authoring/ghost/author.mjs';import{bodyV1Schema}from'../../../packages/protocol/src/body-v1.ts';

test('shared monster and ghost: pinned bytes, existing presets unchanged, refusals for the ghost, real custody for the monster',async t=>{
 // Existing identities keep their place; the two examples are appended.
 assert.equal(PIP_ASSET,'body_0ac8dd17fab38e64b9367357232b819847bad25254252b5a47921ff1afa23b0f');
 assert.deepEqual(BODY_PRESETS.slice(0,2).map(p=>p.id),['humanoid','pip']);assert.deepEqual(BODY_PRESETS.slice(-3).map(p=>p.id),['monster','ghost','centaur']);
 assert.equal(new Set(BODY_PRESETS.map(p=>p.id)).size,BODY_PRESETS.length);
 for(const p of [MONSTER_PRESET,GHOST_PRESET])assert.ok(bodyV1Schema.safeParse(p.body).success,p.id);
 assert.deepEqual((GHOST_PRESET.body as any).motion,GHOST_MANIFEST.motion,'one motion source');
 assert.strictEqual(await monsterBytes(),await monsterBytes(),'built once per process');assert.ok((await ghostBytes()).byteLength<200_000);
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const tick=(n=1)=>{for(let i=0;i<n;i++)f.host.tickOnce();};const people=[];
 for(const owner of ['monster-owner','ghost-owner']){await invite(f,owner);const row=await accept(f.host,f.souls.create('dev:'+owner,{name:owner,description:'Shared example body'})),pair=f.souls.pairCode(row,'https://example.invalid'),token=f.souls.pairExchange(pair.code,'fixture').token;people.push({row,token,soul:{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner}});}
 const [m,g]=people,req=async(who:typeof m,body?:unknown)=>app.request('/v1/edge/body',{method:body?'PUT':'GET',headers:{authorization:'Bearer '+who.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});tick(5);
 for(const asset of [MONSTER_ASSET,GHOST_ASSET]){const r=await app.request('/v1/edge/body/assets/'+asset+'.glb');assert.equal(r.status,200);assert.match(r.headers.get('cache-control')??'',/immutable/);}
 const catalog=await(await req(m)).json();assert.ok(['monster','ghost'].every(id=>catalog.presets.some((p:any)=>p.id===id)));assert.equal(catalog.body?.family??'humanoid','humanoid','humanoid stays the default');assert.deepEqual(catalog.uploads,[]);
 for(const [who,id]of [[m,'monster'],[g,'ghost']] as const){const r=await accept(f.host,req(who,{preset:id}));assert.equal(r.status,200,await r.clone().text());}
 assert.equal(f.host.engine.world.entities[m.row.entity_id].body?.model,MONSTER_ASSET);assert.equal(f.host.engine.world.entities[g.row.entity_id].body?.model,GHOST_ASSET);
 assert.equal((f.db.db.prepare('SELECT COUNT(*) n FROM edge_body_assets_v1').get() as {n:number}).n,0,'presets add no per-world blobs');
 // The ghost: hover is appearance; hands, seats, swimming and rides refuse with the body reason.
 const ghostCaps=edge.capabilities(g.soul);assert.ok(!ghostCaps.some(c=>['sit','swim','pick-up'].includes(c.verb)));
 for(const verb of ['sit','swim','jump']){const r=await accept(f.host,edge.act(g.soul,{capability:verb+':here'}));assert.equal(r.accepted,false,verb);assert.equal((r as any).code,'body.unsupported',verb);}
 const dance=await accept(f.host,edge.act(g.soul,{capability:'dance:here',params:{seconds:3}}));assert.ok(dance.accepted,JSON.stringify(dance));
 // The monster: the canonical humanoid hand actions are the world's own, with a real item in hand and released.
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:fixture',tick:()=>f.host.engine.world.tick,emit(){}});installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 assert.ok(god.act({ops:[{op:'place',def:'core/table@1',name:'load-table',p:[2,0]},{op:'place',def:'core/lantern@3',name:'real-load',in:{parent:'load-table',slot:'top'},p:[0,0]}]}).accepted);tick(15);
 const id=(name:string)=>[...god.model.entities.values()].find(e=>e.name===name)!.id,item=id('real-load'),table=id('load-table');
 const settle=async(soul:typeof m,receipt:string)=>{for(let i=0;i<1500&&!['completed','failed','interrupted'].includes(edge.receipt(soul.row.id,receipt)?.phase??'');i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}return edge.receipt(soul.row.id,receipt)?.phase;};
 const grabbed=await accept(f.host,edge.act(g.soul,{capability:'pick-up:'+item}));assert.equal(grabbed.accepted,false,'the ghost cannot take the item');
 const pick=await accept(f.host,edge.act(m.soul,{capability:'pick-up:'+item}));assert.ok(pick.accepted,JSON.stringify(pick));assert.equal(await settle(m,pick.receipt.id),'completed');
 assert.equal(((f.host.engine.world.entities[item] as any).support).kind,'in-hand');
 const put=await accept(f.host,edge.act(m.soul,{capability:'put-on:'+table}));assert.ok(put.accepted,JSON.stringify(put));assert.equal(await settle(m,put.receipt.id),'completed');
 assert.notEqual(((f.host.engine.world.entities[item] as any).support).kind,'in-hand','released onto the table');
 const swap=await accept(f.host,req(m,{preset:'humanoid'}));assert.equal(swap.status,200,'safe swap back with free hands');
});
