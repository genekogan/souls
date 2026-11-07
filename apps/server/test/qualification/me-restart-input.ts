// Bounded existing C194 input: close/reopen SQLite and native server objects.
// Does not edit that immutable supplier or qualify an OS/process/browser restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {testPort} from '../test-port.ts';
const TEST_PORT=await testPort();

const input=resolve(new URL('../../../../.e2e/exports/core-native-c190-live-me-45b9c986/sim',import.meta.url).pathname);
const parent=resolve(input,'..');
const manifest=JSON.parse(readFileSync(join(parent,'CONTENT-MANIFEST.json'),'utf8'));
const paths=['apps/server/test/native-owner-fixture.ts','apps/server/src/hub.ts','apps/server/src/auth.ts',
  'apps/server/src/http.ts','apps/server/src/world.ts','apps/server/src/db.ts','apps/server/src/souls.ts',
  'packages/client/src/index.ts','packages/engine-mars/src/index.ts','packages/kernel/src/index.ts'];
const pins=paths.map(path=>{
  const sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');
  assert.equal(sha256,manifest[path].sha256,'immutable C194 source '+path);
  return {path,sha256};
});
const load=(path:string)=>import(pathToFileURL(join(input,path)).href);
const {fixture,invite,accept}=await load('apps/server/test/native-owner-fixture.ts');
const {Hub}=await load('apps/server/src/hub.ts');
const {buildApp}=await load('apps/server/src/http.ts');
const {Connection}=await load('packages/client/src/index.ts');
const {marsFactory,EDEN_SAFE_COMMONS_WORLD}=await load('packages/engine-mars/src/index.ts');
const {kernelHash}=await load('packages/kernel/src/index.ts');
const requireInput=createRequire(join(input,'apps/server/src/hub.ts'));
const WebSocket=requireInput('ws');
const native=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
async function until(f:()=>boolean){const end=performance.now()+3000;while(!f()&&performance.now()<end)await delay(2);assert.ok(f(),'scoped native connection becomes ready');}

test('C194 SQLite reopen preserves two owned bodies, intents, receipts and reciprocal private WS authority',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-c194-restart-')),dbPath=join(dir,'world.sqlite');
  const intervals:Set<ReturnType<typeof setInterval>>=new Set(),realInterval=setInterval;
  t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=realInterval(...args);intervals.add(timer);return timer;});
  let active:any;
  async function close(){
    if(!active)return;const f=active;active=null;
    for(const peer of f.peers){peer.c.close();assert.equal(peer.c.me,null);}
    for(const timer of intervals)clearInterval(timer);intervals.clear();
    for(const ws of f.hub.wss.clients)ws.terminate();
    await new Promise<void>(r=>f.hub.wss.close(()=>r()));
    await new Promise<void>(r=>f.server.close(()=>r()));
    f.host.stop();f.db.close();
  }
  t.after(async()=>{await close();rmSync(dir,{recursive:true,force:true});});
  async function open(){
    const f=fixture(dbPath,native);f.souls.enableLifecycle();
    const server=createServer(),hub=new Hub(server,f.host,f.auth,f.db,f.souls);hub.brain=f.brain;
    const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,hub});
    active={...f,server,hub,app,peers:[]};
    await new Promise<void>((r,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',r);});
    const connect=async(owner:string|null)=>{
      const frames:any[]=[];
      const c=new Connection(`ws://127.0.0.1:${TEST_PORT}/ws`,async()=>owner?'dev:'+owner:null,{},(url:string)=>{
        const ws=new WebSocket(url);ws.on('message',(d:Buffer)=>frames.push(JSON.parse(String(d))));return ws;
      });
      const peer={c,frames};active.peers.push(peer);c.connect();await until(()=>c.replica.ready);return peer;
    };
    return Object.assign(active,{connect});
  }
  const first=await open(),owners=['alice','bob'];
  const admissions:any[]=[];
  for(const owner of owners){
    await invite(first,owner);
    const response=await first.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:'+owner,'content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Restart '+owner,description:'Synthetic human-owned restart fixture'})});
    assert.equal(response.status,202);admissions.push({owner,...(await response.json()).lifecycle});
    first.host.drainInputs();await delay(0);first.host.drainInputs();await delay(0);
  }
  for(const op of admissions){
    assert.equal(first.souls.lifecycleReceipt('dev:'+op.owner,op.requestId).ready,true);
    const response=await accept(first.host,first.request('/v1/souls/'+op.soulId+'/intent',{intent:{goal:'rest',text:'PRIVATE_RESTART_'+op.owner}},op.owner));assert.equal(response.status,200);
    first.db.db.prepare('UPDATE users SET email=? WHERE id=?').run('private-restart-'+op.owner+'@local.invalid','dev:'+op.owner);
  }
  for(let i=0;i<40;i++)first.host.tickOnce();first.host.drainInputs();await delay(0);
  const checkpoint=first.host.saveSnapshot(true);assert.ok(!checkpoint.pending);assert.equal(checkpoint.tick,first.host.engine.world.tick);
  const before={stateHash:first.host.engine.stateHash(),kernelHash:kernelHash(first.host.kernel),tick:first.host.engine.world.tick,
    births:first.db.events(first.host.worldId).filter((e:any)=>e.kind==='birth').length,
    receipts:admissions.map(op=>first.souls.lifecycleReceipt('dev:'+op.owner,op.requestId)),
    intents:admissions.map(op=>structuredClone(first.host.minds.get(op.soulId).intent))};
  const initialPeers=await Promise.all([...owners,null].map(owner=>first.connect(owner)));
  const scopes=initialPeers.slice(0,2).map(peer=>structuredClone(peer.c.meSession));
  function verifyPeers(peers:any[]){
    for(let i=0;i<2;i++){
      assert.equal(peers[i].c.me.userId,'dev:'+owners[i]);assert.deepEqual(peers[i].c.me.souls,[admissions[i].soulId]);
      assert.ok(JSON.stringify(peers[i].frames).includes('private-restart-'+owners[i]+'@local.invalid'));
      assert.equal(JSON.stringify(peers[i].frames).includes('private-restart-'+owners[1-i]+'@local.invalid'),false);
    }
    assert.equal(peers[2].c.me,null);const publicBytes=JSON.stringify(peers[2].frames);
    for(const op of admissions){assert.ok(publicBytes.includes(op.entityId));assert.equal(publicBytes.includes('PRIVATE_RESTART_'+op.owner),false);assert.equal(publicBytes.includes(op.requestId),false);assert.equal(publicBytes.includes('private-restart-'+op.owner+'@local.invalid'),false);}
  }
  verifyPeers(initialPeers);await close();
  const second=await open();
  assert.equal(second.host.engine.stateHash(),before.stateHash);assert.equal(kernelHash(second.host.kernel),before.kernelHash);assert.equal(second.host.engine.world.tick,before.tick);
  assert.equal(second.db.events(second.host.worldId).filter((e:any)=>e.kind==='birth').length,before.births);
  assert.deepEqual(admissions.map(op=>second.souls.lifecycleReceipt('dev:'+op.owner,op.requestId)),before.receipts);
  assert.deepEqual(admissions.map(op=>second.host.minds.get(op.soulId).intent),before.intents);
  const returnPeers=await Promise.all([...owners,null].map(owner=>second.connect(owner)));verifyPeers(returnPeers);
  const privateReads:any[]=[];
  for(let i=0;i<2;i++){
    assert.notEqual(returnPeers[i].c.meSession.connectionId,scopes[i].connectionId);
    for(const owner of [owners[i],owners[1-i],null]){
      const response=await second.app.request('/v1/lifecycle/'+admissions[i].requestId,{headers:owner?{authorization:'Bearer dev:'+owner}:{}});
      const body=await response.text();assert.equal(response.status,owner===owners[i]?200:owner?404:401);assert.equal(response.headers.get('cache-control'),'no-store');
      if(owner!==owners[i])assert.equal(body.includes(admissions[i].requestId),false);
      privateReads.push({reader:owner,requestFor:owners[i],status:response.status,cacheControl:response.headers.get('cache-control'),body});
    }
  }
  assert.equal(second.db.paidCost(),0);
  const proof={contract:'core-c194-two-owner-reopen/1',input,pins,before,admissions,initialFrames:initialPeers.map(p=>p.frames),returnFrames:returnPeers.map(p=>p.frames),privateReads,paidUSD:0,
    scope:'Actual SQLite close/reopen, fresh native Host/Auth/Souls/Hub/server, real WS+SDK, in-process Hono receipt routes. Two synthetic owned humans; no OS process/browser/realAuth/current PM candidate/full privacy/cohort qualification.'};
  await close();
  for(const pin of pins)assert.equal(createHash('sha256').update(readFileSync(join(input,pin.path))).digest('hex'),pin.sha256);
  const out=new URL('../../../../.e2e/me-restart/',import.meta.url);mkdirSync(out,{recursive:true});
  const artifact=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);writeFileSync(artifact,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});t.diagnostic('Synthetic private restart evidence '+artifact.pathname);
});
