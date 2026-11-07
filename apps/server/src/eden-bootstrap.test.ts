import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate} from 'node:timers/promises';
import {spawn,type ChildProcess} from 'node:child_process';
import WebSocket from 'ws';
import {PROTO,type LogEvent} from '@souls/protocol';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {edenCoreRequested,edenHistoryFactory,installEdenCore} from './eden-bootstrap.ts';
import {config} from './config.ts';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
const legacy=await marsFactory(GREEN_FIELD_WORLD);
async function until(predicate:()=>boolean|Promise<boolean>){for(let i=0;i<150;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('owned local condition did not settle');}

test('explicit installer refuses missing flags before writes, preserves old native/owner history and selects a compatible postfact code reader',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-bootstrap-')),path=join(dir,'sim.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const old=fixture(path,legacy);await invite(old,'alice');const soul=await accept(old.host,old.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited legacy bootstrap owner'}));old.brain.quiesce();old.host.saveSnapshot(true);old.host.stop();old.db.close();
  const db=new Db(path);t.after(()=>db.close());const factory=await edenHistoryFactory(db,old.host.worldId),h=new WorldHost(db,factory,old.host.seed,1e9,old.host.worldId,{durableClockV1:true});h.boot();
  const prefix=db.events(h.worldId),body=structuredClone(h.engine.world.entities[soul.entity_id]),hash=h.engine.stateHash();
  await assert.rejects(installEdenCore(h,{applyCrew:false,applyCommons:false}),/explicit-crew/);assert.equal(h.engine.stateHash(),hash);assert.deepEqual(db.events(h.worldId),prefix);
  const facts=await installEdenCore(h,{applyCrew:true,applyCommons:true});assert.equal(facts.length,2);assert.deepEqual(h.engine.world.entities[soul.entity_id],body);assert.deepEqual(db.events(h.worldId).slice(0,prefix.length),prefix);
  h.saveSnapshot(true);const expected={engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)};h.stop();
  const rollbackReader=await edenHistoryFactory(db,h.worldId),rollback=new WorldHost(db,rollbackReader,h.seed,1e9,h.worldId,{durableClockV1:true});assert.equal(rollback.boot().from,'snapshot');assert.deepEqual({engine:rollback.engine.stateHash(),kernel:kernelHash(rollback.kernel)},expected);
  assert.deepEqual(await installEdenCore(rollback,{applyCrew:false,applyCommons:false}),[]);assert.equal(db.paidCost(),0);rollback.stop();
  for(const worldKey of ['mars','littlemartians','toy'])assert.equal(edenCoreRequested({...config,worldKey},{ENABLE_EDEN_CORE:'1'}),false);
});

test('a second-checkpoint failure retains the committed policy and can boot retained-reader mode without reversing the header',async t=>{
  // Use an actual legacy origin; do not relabel a fresh world's header.
  const legacyFixture=fixture(':memory:',legacy);t.after(()=>{legacyFixture.brain.quiesce();legacyFixture.db.close();});
  const reader=await edenHistoryFactory(legacyFixture.db,legacyFixture.host.worldId),h=new WorldHost(legacyFixture.db,reader,legacyFixture.host.seed,1e9,legacyFixture.host.worldId);h.boot();
  const append=legacyFixture.db.appendEvent.bind(legacyFixture.db);t.mock.method(legacyFixture.db,'appendEvent',(id:string,e:LogEvent)=>{if(e.payload?.commonsTransition)throw Error('synthetic physical append failure');return append(id,e);});
  await assert.rejects(installEdenCore(h,{applyCrew:true,applyCommons:true}),/synthetic physical/);
  assert.equal(h.engine.world.base.campus,'greenfield');assert.ok(h.engine.rulesVersion.includes('+crew-removal/1'));assert.ok(legacyFixture.db.world(h.worldId)!.rules_version.includes('+crew-removal/1'));
  const retained=new WorldHost(legacyFixture.db,await edenHistoryFactory(legacyFixture.db,h.worldId),h.seed,1e9,h.worldId);retained.boot();assert.equal(retained.engine.stateHash(),h.engine.stateHash());
  assert.deepEqual(await installEdenCore(retained,{applyCrew:false,applyCommons:false,retainReader:true}),[]);
  await assert.rejects(installEdenCore(retained,{applyCrew:true,applyCommons:false,retainReader:true}),/cannot-install/);retained.stop();h.stop();
});

test('actual main opt-in preserves cfg budget and old owner, enables lifecycle/V2/private WS and closes/reopens with retained reader and no checkpoint flags',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-main-')),path=join(dir,'sim.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const old=fixture(path,legacy);await invite(old,'alice');const row=await accept(old.host,old.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited original main owner'}));old.brain.quiesce();old.host.saveSnapshot(true);old.host.stop();old.db.close();
  let child:ChildProcess|undefined,ws:WebSocket|undefined,output='';
  const base='http://127.0.0.1:4959/w/eden';
  const env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,HOST:'127.0.0.1',PORT:'4959',WORLD_KEY:'eden',ENGINE:'mars',WORLD_ID:old.host.worldId,WORLD_SEED:old.host.seed,WORLD_PATH:'/w/eden',PUBLIC_URL:base,DATA_DIR:dir,DEV_AUTH:'1',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'.37',SEED_NATIVES:'0',ENABLE_LIVING_WORLD:'1',ARCHIVE_TAKES:'0',ENABLE_EDEN_CORE:'1',BUILD_ID:'local-main-core-bootstrap'};
  const request=async(p:string,body?:unknown)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:{authorization:'Bearer dev:alice',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as any};};
  async function open(apply:boolean){output='';child=spawn(process.execPath,['apps/server/src/main.ts'],{cwd:new URL('../../../',import.meta.url).pathname,env:{...env,...(apply?{APPLY_EDEN_CREW_CHECKPOINT:'1',APPLY_EDEN_COMMONS_CHECKPOINT:'1'}:{})},stdio:['ignore','pipe','pipe']});child.stdout!.on('data',b=>output+=String(b));child.stderr!.on('data',b=>output+=String(b));await until(async()=>{if(child!.exitCode!==null)throw Error('owned main exited: '+output);try{return (await fetch(base+'/healthz')).ok;}catch{return false;}});}
  async function close(){ws?.close();ws=undefined;if(!child)return;const process=child;child=undefined;process.kill('SIGTERM');await until(()=>process.exitCode!==null);assert.equal(process.exitCode,0,output);}
  try{
    await open(true);assert.ok(output.includes('budget $0.37/day'));
    const dashboard=await request('/v1/souls/'+row.id);assert.equal(dashboard.status,200);assert.equal(dashboard.body.control.soulId,row.id);assert.equal(dashboard.body.control.intentContract,'soul-intent/2');
    const frames:any[]=[];ws=new WebSocket('ws://127.0.0.1:4959/w/eden/ws');ws.on('message',b=>frames.push(JSON.parse(String(b))));await new Promise<void>((r,j)=>{ws!.once('open',r);ws!.once('error',j);});ws.send(JSON.stringify({t:'hello',proto:PROTO,token:'dev:alice'}));await until(()=>frames.some(f=>f.t==='welcome'));const welcome=frames.find(f=>f.t==='welcome');assert.deepEqual(welcome.you.souls,[row.id]);assert.equal(welcome.privateMe.contract,'me-live/1');
    const body={contract:'soul-intent/2',op:'upsert',requestId:'main-bootstrap-original-ref',words:'Explore the garden.'};const response=await request('/v1/souls/'+row.id+'/intent-v2',body);assert.ok([200,202].includes(response.status));await until(async()=>{const r=await request('/v1/souls/'+row.id+'/intent-v2/requests/'+body.requestId);return r.status===200&&r.body.phase==='refused';});
    await close();await open(false);const recovered=await request('/v1/souls/'+row.id+'/intent-v2/requests/'+body.requestId);assert.equal(recovered.status,200);assert.equal(recovered.body.phase,'refused');assert.equal(recovered.body.code,'not-understood');await close();
    const db=new Db(path);try{assert.equal(db.soul(row.id)!.owner,row.owner);assert.equal(db.soul(row.id)!.entity_id,row.entity_id);assert.equal(db.paidCost(),0);
      const dir=new URL('../../../.e2e/eden-bootstrap/',import.meta.url);mkdirSync(dir,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',dir);
      writeFileSync(file,JSON.stringify({status:'PASS',worldId:old.host.worldId,originalSoul:{id:row.id,owner:row.owner,entityId:row.entity_id},budgetUsdPerDay:.37,brainMode:'fake',privateMeContract:welcome.privateMe.contract,
        originalV2Request:body,terminalPhase:recovered.body.phase,terminalCode:recovered.body.code,withoutCheckpointFlagsReopen:true,paidUSD:0,
        rules:db.events(old.host.worldId).filter(e=>e.kind==='rules'&&(e.payload?.crewRemovalTransition||e.payload?.commonsTransition)),closed:true,
        limits:['Actual main/loopback HTTP/WS and old synthetic invited owner, no browser/realSSO/provider/production launch','Controlled shutdown/reopen, not active-provider abort or crash-pending recovery','Retained compatible reader, no DB/header reversal']},null,2)+'\n',{flag:'wx'});t.diagnostic('Actual main installation proof '+file.pathname);
    }finally{db.close();}
  }finally{await close();}
});
