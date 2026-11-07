import {Hono} from 'hono';
import test from 'node:test';import assert from 'node:assert/strict';
import {captureRenderScene,parseRenderSceneCapture,hashOf} from '@souls/engine-contract';import {kernelHash} from '@souls/kernel';
import {fixture,accept,factory} from '../test/native-owner-fixture.ts';import {WorldHost} from './world.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';
import {visualFloorOffset,livePlatforms} from './edge/eyes/platforms.ts';import {eyePose} from './edge/eyes/view.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
const platforms=[{id:'stage',c:[92,-30] as [number,number],half:[3,2] as [number,number],top:.6,ramp:{c:[92,-26.2] as [number,number],half:[.9,1.8] as [number,number],from:0,to:.6,dir:[0,-1] as [number,number]}},{id:'bandstand',c:[38.5,-26] as [number,number],r:3,segments:8,top:.35}];
test('prospective platform projection changes new capture hash, preserves physics and old scenes/takes, and replays exactly',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const e=f.host.engine,base=structuredClone(e.world.base),before=JSON.stringify(captureRenderScene(e.rulesVersion,e.renderScene!())),physical=e.physicalHash(),engine=e.stateHash();
 for(let i=0;i<25;i++)f.host.tickOnce();const beforeInstall=e.stateHash();f.host.saveSnapshot(true);const oldCapture=parseRenderSceneCapture(JSON.parse(before));
 assert.deepEqual(await accept(f.host,f.host.installRenderPlatformsV1(platforms)),{installed:true});assert.equal(e.stateHash(),beforeInstall);assert.equal(e.physicalHash(),physical);assert.deepEqual(e.world.base,base);
 const after=captureRenderScene(e.rulesVersion,e.renderScene!());assert.notEqual(after.ref.hash,oldCapture.ref.hash);assert.equal(JSON.stringify(oldCapture),before);assert.equal((oldCapture.body.scene as any).platforms,undefined);assert.equal((after.body.scene as any).platformProvenance.acceptedAtTick,25);
 assert.deepEqual((after.body.scene as any).platforms.map((p:any)=>p.id),['bandstand','stage']);assert.equal(parseRenderSceneCapture(after).ref.hash,after.ref.hash);
 assert.deepEqual(await accept(f.host,f.host.installRenderPlatformsV1(platforms)),{installed:false});assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.renderPlatformsV1).length,1);
 const oldTake=e.takeChunks!(0).find(c=>c.toTick===25);assert.ok(oldTake);assert.equal((oldTake.take as any).renderSceneRef.hash,oldCapture.ref.hash);assert.equal(e.takeScene!(oldCapture.ref.hash)!.ref.hash,oldCapture.ref.hash);
 for(let i=0;i<30;i++)f.host.tickOnce();const expected={engine:e.stateHash(),kernel:kernelHash(f.host.kernel),scene:captureRenderScene(e.rulesVersion,e.renderScene!()).ref.hash};
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});try{assert.equal(h.boot().from,mode);assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),scene:captureRenderScene(h.engine.rulesVersion,h.engine.renderScene!()).ref.hash},expected);}finally{h.stop();}}
 const restored=factory.restore(e.snapshot());assert.equal(restored.stateHash(),e.stateHash());assert.equal(captureRenderScene(restored.rulesVersion,restored.renderScene!()).ref.hash,after.ref.hash);
 assert.throws(()=>e.configureRenderPlatformsV1!({...e.renderPlatformsV1!()!,platforms:[{...platforms[0],top:NaN}]}));assert.throws(()=>parseRenderSceneCapture({...after,body:{...after.body,scene:{...after.body.scene as object,platforms:[{...platforms[0],top:9}]}}}));assert.deepEqual(e.runtime.violations,[]);void engine;
});
test('declared stage/ramp floor aligns human and floater Eyes; native recorded elevations/support never get a second lift',async t=>{
 const f=fixture(':memory:',factory);f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});await accept(f.host,f.host.installRenderPlatformsV1(platforms));const L=new EdgeLedger(f.host,f.db,undefined,{spots:{contract:'activity-spots/1',platforms}}),body={pose:{p:[92,0,-30],yaw:0},human:{level:0,activity:'idle'}};
 assert.equal(visualFloorOffset(L,body),.6);assert.deepEqual(eyePose(body,'standing',0,90,640,400,visualFloorOffset(L,body)).p,[92,2.22,-30]);assert.deepEqual(eyePose({...body,body:{family:'floater',hoverHeight:1.45}},'standing',0,90,640,400,.6).p,[92,2.05,-30]);
 assert.equal(visualFloorOffset(L,{...body,pose:{p:[92,0,-26.2],yaw:0}}),.3);for(const human of [{level:1},{level:0,carrier:'x'},{level:0,on:'beam'},{level:0,grip:'held'},{level:0,boatPassenger:{boat:'x'}},{level:0,shore:{datumY:0}}])assert.equal(visualFloorOffset(L,{...body,human}),0);
 assert.equal(visualFloorOffset(L,{...body,pose:{p:[92,.6,-30],yaw:0}}),0);assert.equal(livePlatforms(L).source,'accepted-render-fact');assert.equal(f.host.engine.world.entities.h?.pose.p[1],undefined);
 const edgeApp=new Hono(),comms=mountEdgeRoutes(edgeApp,{host:f.host,db:f.db,souls:f.souls,ledger:L,soul:edgeSoulResolver(f.host,f.souls,()=>undefined)});t.after(()=>comms.close());const response=await edgeApp.request('/v1/edge/platforms');assert.equal(response.status,200);const published=await response.json();assert.equal(published.worldId,f.host.worldId);assert.equal(published.source,'accepted-render-fact');assert.equal(published.provenance.navHash,hashOf(null));
 const scene=await(await f.app.request('/v1/scene')).json();assert.deepEqual(scene.scene.platforms,published.platforms);
});
test('render-only platform installation accompanies nav once and remains separate from physical geometry',async t=>{
 const f=fixture(':memory:',factory);f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});const spec={version:'nav/1' as const,ground:[{id:'test-ground',boundsXZ:[-8,-8,8,8] as [number,number,number,number]}],solids:[],platforms};
 await accept(f.host,f.host.installNavV1(spec));const nav=(f.host.engine.world as any).navV1,hash=f.host.engine.stateHash(),seq=f.host.seq;assert.equal(nav.platforms,undefined);assert.equal(f.host.engine.renderPlatformsV1!()!.navHash,hashOf(nav));
 assert.deepEqual(await accept(f.host,f.host.installNavV1(spec)),{installed:false});assert.equal(f.host.seq,seq);assert.equal(f.host.engine.stateHash(),hash);assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.navV1).length,1);assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.renderPlatformsV1).length,1);
});
test('actual CN5 physical reader retains captured platform projection through snapshot restore',async t=>{
 const w=await edenNavWorld(0,{cn5:true});t.after(()=>{w.f.host.stop();w.f.db.close();});const meta=w.engine.renderPlatformsV1();assert.ok(meta?.platforms.length);const before=captureRenderScene(w.engine.rulesVersion,w.engine.renderScene());w.f.host.saveSnapshot(true);
 const h=new WorldHost(w.f.db,w.fac,w.f.host.seed,1e9,w.f.host.worldId,{durableClockV1:true});try{assert.equal(h.boot().from,'snapshot');assert.deepEqual(h.engine.renderPlatformsV1!(),meta);assert.equal(captureRenderScene(h.engine.rulesVersion,h.engine.renderScene!()).ref.hash,before.ref.hash);assert.equal(h.engine.stateHash(),w.engine.stateHash());for(let i=0;i<10;i++)h.tickOnce();h.engine.configureRenderPlatformsV1!({...meta!,acceptedAtTick:h.engine.world.tick});const chunk=h.engine.takeChunks!(w.engine.world.tick).at(-1)!;assert.equal((chunk.take as any).renderSceneRef.hash,before.ref.hash);}finally{h.stop();}
});
