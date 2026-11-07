import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {WebSocket} from 'ws';
import {captureRenderScene,hashOf} from '@souls/engine-contract';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {recordedTakeChunkSchema,decodeSceneCapturePublication} from '@souls/protocol';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';
import {takeIdOf} from '../../../mars/viewer/engine/take/recorder.ts';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {TakeArchive,type ArchiveStore} from './take-archive.ts';
import {Auth} from './auth.ts';
import {Brain} from './brain.ts';
import {Hub} from './hub.ts';
import {Souls} from './souls.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';

async function nativeChunk() {
  const factory=await marsFactory(GREEN_FIELD_WORLD),engine=factory.create(factory.genesis('captured-scene'));
  engine.spawnHuman({id:'a',label:'Alice',soul:'s_a'});
  for(let i=0;i<20;i++)engine.step();
  const chunk=engine.takeChunks!(-1)[0],ref=(chunk.take as Take).renderSceneRef!;
  return {factory,engine,chunk,capture:engine.takeScene!(ref.hash)!};
}
function tmp(t:any) {
  const dir=mkdtempSync(join(tmpdir(),'core-scene-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'world.sqlite');
}
const count=(db:Db,table:string)=>Number((db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n);

test('native take and scene capture persist atomically, deduplicate, and reload without a model or render source',async t=>{
  const f=await nativeChunk(),path=tmp(t);let db=new Db(path);const reader=new Db(path);
  t.after(()=>{db.close();reader.close();});
  const hooked=db as unknown as {verifiedCapture(w:string,h:string):unknown},read=hooked.verifiedCapture.bind(db);let sawTransaction=false;
  hooked.verifiedCapture=(worldId,hash)=>{
    assert.equal(reader.renderSceneCapture(worldId,hash),undefined);assert.equal(reader.takes(worldId,0,100,10).chunks.length,0);
    sawTransaction=true;return read(worldId,hash);
  };
  db.saveTake('eden-proof',f.chunk,f.capture);assert.ok(sawTransaction);hooked.verifiedCapture=read;
  assert.deepEqual(reader.renderSceneCapture('eden-proof',f.capture.ref.hash),f.capture);
  db.saveTake('eden-proof',f.chunk);assert.equal(count(db,'render_scene_captures'),1);assert.equal(count(db,'take_chunks'),1);
  assert.equal(db.renderSceneCapture('other-world',f.capture.ref.hash),undefined);
  db.close();db=new Db(path);assert.deepEqual(db.renderSceneCapture('eden-proof',f.capture.ref.hash),f.capture);
  const stored=db.takes('eden-proof',0,100,10).chunks[0];assert.deepEqual(stored,f.chunk);
  assert.equal(takeIdOf(stored.take as Take),(stored.take as Take).id);assert.equal(db.paidCost(),0);
});

test('scene/take write failure rolls back the capture and never leaves an unresolved reference',async t=>{
  const f=await nativeChunk(),path=tmp(t),db=new Db(path);t.after(()=>db.close());
  db.db.exec("CREATE TEMP TRIGGER reject_take BEFORE INSERT ON take_chunks BEGIN SELECT RAISE(ABORT,'fixture write refusal'); END");
  assert.throws(()=>db.saveTake('eden-proof',f.chunk,f.capture),/fixture write refusal/);
  assert.equal(count(db,'render_scene_captures'),0);assert.equal(count(db,'take_chunks'),0);
  db.db.exec('DROP TRIGGER reject_take');
  assert.throws(()=>db.saveTake('eden-proof',f.chunk),/unavailable/);
  const tampered=structuredClone(f.capture);tampered.body.scene=null;
  assert.throws(()=>db.saveTake('eden-proof',f.chunk,tampered),/hash mismatch/);
  const forged=structuredClone(f.chunk);(forged.take as Take).renderSceneRef!.rulesVersion='wrong-rules';
  assert.throws(()=>db.saveTake('eden-proof',forged,f.capture),/rules versions differ/);
  const altered=structuredClone(f.chunk);(altered.take as Take).finalStateHash='fake';
  assert.throws(()=>db.saveTake('eden-proof',altered,f.capture),/content address/);
  assert.equal(count(db,'render_scene_captures'),0);
  db.saveTake('eden-proof',f.chunk,f.capture);
  db.db.prepare('UPDATE render_scene_captures SET body=?').run(JSON.stringify(tampered));
  // L8: a capture is verified once by hash (rows are never rewritten) and then served from memory; a connection that has
  // not verified it yet (the next process) still refuses the tampered row.
  const cold=new Db(path);t.after(()=>cold.close());
  assert.throws(()=>cold.renderSceneCapture('eden-proof',f.capture.ref.hash),/hash mismatch/);
});

for(const phase of ['before-take','before-commit','after-commit'] as const)
test(`real worker exit ${phase} preserves the scene/take transaction`,async t=>{
  const f=await nativeChunk(),path=tmp(t),db=new Db(path);t.after(()=>db.close());
  const worker=new Worker(new URL('../test/fixtures/scene-capture-worker.ts',import.meta.url),{workerData:{path,phase,chunk:f.chunk,capture:f.capture},execArgv:[]});
  t.after(()=>worker.terminate());assert.equal((await once(worker,'exit'))[0],23);
  const committed=phase==='after-commit';assert.equal(count(db,'render_scene_captures'),committed?1:0);assert.equal(count(db,'take_chunks'),committed?1:0);
  if(committed)assert.deepEqual(db.renderSceneCapture('eden-proof',f.capture.ref.hash),f.capture);
});

test('actual native render reference survives verified local archive pruning and restart',async t=>{
  const f=await nativeChunk(),path=tmp(t);let db=new Db(path);t.after(()=>db.close());
  db.saveTake('eden-proof',f.chunk,f.capture);const objects=new Map<string,Uint8Array>();
  const store:ArchiveStore={async put(k,b){objects.set(k,b);},async get(k){return objects.get(k)!;}};
  let archive=new TakeArchive(db,'eden-proof',store,'local-test');
  // Synthetic completed/pruning watermark; source chunk is actual native0–20.
  assert.equal(await archive.archiveOne(1806000),true);assert.equal(count(db,'take_chunks'),0);
  assert.equal(count(db,'render_scene_captures'),1);db.close();db=new Db(path);archive=new TakeArchive(db,'eden-proof',store,'local-test');
  const page=await archive.read(0,100,10);assert.deepEqual(page.chunks,[f.chunk]);
  const ref=recordedTakeChunkSchema.parse(page.chunks[0]).take.renderSceneRef!;
  assert.deepEqual(db.renderSceneCapture('eden-proof',ref.hash),f.capture);assert.equal(db.paidCost(),0);
});

test('legacy takes stay unbound and a conflicting geometry reference cannot rewrite retained history',async t=>{
  const f=await nativeChunk(),db=new Db(':memory:');t.after(()=>db.close());
  const legacy=structuredClone(f.chunk);delete (legacy.take as Take).renderSceneRef;
  (legacy.take as Take).id=takeIdOf(legacy.take as Take);db.saveTake('legacy',legacy);
  assert.equal((db.takes('legacy',0,100,10).chunks[0].take as Take).renderSceneRef,undefined);
  assert.equal(count(db,'render_scene_captures'),0);
  db.saveTake('eden-proof',f.chunk,f.capture);
  const changed=captureRenderScene(f.engine.rulesVersion,{scene:null}),replacement=structuredClone(f.chunk);
  (replacement.take as Take).renderSceneRef=changed.ref;(replacement.take as Take).id=takeIdOf(replacement.take as Take);
  assert.throws(()=>db.saveTake('eden-proof',replacement,changed),/identity conflict/);
  assert.equal(db.renderSceneCapture('eden-proof',changed.ref.hash),undefined);
  assert.deepEqual(db.takes('eden-proof',0,100,10).chunks[0],f.chunk);
  assert.throws(()=>db.saveTake('invalid',{...f.chunk,take:{...(f.chunk.take as object),renderSceneRef:null}}));
});

test('real Hub/anonymous socket and Hono scene routes expose scoped immutable public captures',async t=>{
  const factory=await marsFactory(GREEN_FIELD_WORLD),db=new Db(':memory:');t.after(()=>db.close());
  const host=new WorldHost(db,factory,'socket-scene',1e9,'eden-proof');host.boot();
  db.createSoul({id:'s_a',entityId:'a',worldId:host.worldId,owner:'PRIVATE_OWNER',name:'Alice',description:'Public resident',native:false});
  void host.enqueue('birth','fixture',{soulId:'s_a',entityId:'a',owner:'PRIVATE_OWNER',name:'Alice',description:'Public resident'});host.tickOnce();
  host.minds.get('s_a')!.nextEvalTick=1e9;host.extra.privateJournal='PRIVATE_JOURNAL';
  const cfg={...config,worldId:host.worldId,brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:''};
  const auth=new Auth(cfg,db),server=createServer((_,res)=>res.end('fixture')),hub=new Hub(server,host,auth,db);
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}});hub.brain=brain;
  const souls=new Souls(host,db,brain,cfg),app=buildApp({cfg,db,host,auth,hub,brain,souls});
  await new Promise<void>(resolve=>server.listen(4955,'127.0.0.1',resolve));
  const ws=new WebSocket('ws://127.0.0.1:4955/ws'),messages:any[]=[];ws.on('message',b=>messages.push(JSON.parse(String(b))));
  t.after(async()=>{ws.terminate();hub.wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  await once(ws,'open');
  // Subscribe before hello/ticks: scheduler turns do not prove socket delivery.
  const takesMessage=new Promise<any>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(deadline);ws.off('message',onMessage);ws.off('error',onError);ws.off('close',onClose);};
    const finish=(error?:Error,message?:any)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(message);};
    const onMessage=(data:WebSocket.RawData)=>{try{const m=JSON.parse(String(data));if(m.t==='takes'&&Array.isArray(m.chunks)&&m.chunks.length)finish(undefined,m);}catch{finish(new Error('anonymous WebSocket delivered invalid JSON'));}};
    const onError=(error:Error)=>finish(error),onClose=()=>finish(new Error('anonymous WebSocket closed before takes delivery'));
    const deadline=setTimeout(()=>finish(new Error('anonymous WebSocket takes were not delivered within 2000 ms')),2000);
    ws.on('message',onMessage);ws.on('error',onError);ws.on('close',onClose);t.after(cleanup);
  });
  // Keep a pending readiness rejection handled while the welcome is awaited.
  void takesMessage.catch(()=>{});
  const welcome=once(ws,'message',{signal:AbortSignal.timeout(2000)});ws.send(JSON.stringify({t:'hello',proto:1}));await welcome;
  while(host.engine.world.tick<25)host.tickOnce();
  const chunk=(await takesMessage).chunks[0],ref=recordedTakeChunkSchema.parse(chunk).take.renderSceneRef!;
  const response=await app.request(`/v1/scenes/${ref.hash}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const capture:any=await response.json();assert.equal(capture.worldId,host.worldId);assert.deepEqual(capture.ref,ref);
  assert.deepEqual(decodeSceneCapturePublication(capture),capture);
  // lane W1: a page that names its world may keep the content-addressed capture; another world's name is not found
  const kept=await app.request(`/v1/scenes/${ref.hash}?world=${encodeURIComponent(host.worldId)}`);assert.equal(kept.status,200);assert.equal(kept.headers.get('cache-control'),'private, max-age=604800, immutable');assert.deepEqual(await kept.json(),capture);
  // L8: the content address is the ETag; a revalidation is a 304 with no body
  assert.equal(kept.headers.get('etag'),`"${ref.hash}"`);
  const again=await app.request(`/v1/scenes/${ref.hash}?world=${encodeURIComponent(host.worldId)}`,{headers:{'if-none-match':`W/"x", "${ref.hash}"`}});
  assert.equal(again.status,304);assert.equal(await again.text(),'');assert.equal(again.headers.get('cache-control'),'private, max-age=604800, immutable');
  const elsewhere=await app.request(`/v1/scenes/${ref.hash}?world=other-world`);assert.equal(elsewhere.status,404);assert.equal(elsewhere.headers.get('cache-control'),'no-store');
  const {worldId:_worldId,...body}=capture;assert.deepEqual(body,db.renderSceneCapture(host.worldId,ref.hash));
  const current=await (await app.request('/v1/scene')).json() as any;assert.deepEqual(current.renderSceneRef,ref);
  host.engine.configureClock!({origin:100,dayTicks:72000});
  const changed=await (await app.request('/v1/scene')).json() as any;assert.notEqual(changed.renderSceneRef.hash,ref.hash);
  assert.deepEqual(await (await app.request(`/v1/scenes/${ref.hash}`)).json(),capture,'historical response remains original');
  const foreign=captureRenderScene(host.engine.rulesVersion,{scene:null});
  const foreignChunk=structuredClone(chunk);foreignChunk.take.renderSceneRef=foreign.ref;foreignChunk.take.id=takeIdOf(foreignChunk.take);
  db.saveTake('other-world',foreignChunk,foreign);
  for(const hash of [foreign.ref.hash,'0'.repeat(64),'bad']) {const r=await app.request(`/v1/scenes/${hash}`);assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');}
  const text=JSON.stringify({messages,capture,current});for(const marker of ['PRIVATE_OWNER','PRIVATE_JOURNAL'])assert.ok(!text.includes(marker));
  assert.equal(hashOf(capture.body),hashOf(host.engine.takeScene!(ref.hash)!.body));assert.equal(db.paidCost(),0);
});
