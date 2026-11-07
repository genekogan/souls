import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import type {callTool,CompileOut} from '@souls/brain';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {TakeArchive} from './take-archive.ts';
import {Db} from './db.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});

test('quiescence suppresses new thought but drains accepted compiler, nested mint and durable V2 publication with DB/sequencer open',async t=>{
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await invite(f,'alice');
  const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited owner shutdown fixture'}));f.brain.quiesce();
  let release!:()=>void,calls=0;const held=new Promise<void>(r=>release=r);
  const compilerCall:typeof callTool=async<T>()=>{calls++;await held;
    const out:CompileOut={understood:true,agenda:[{card:'shutdown demonstration',target:null}],new_cards:[{name:'shutdown demonstration',summary:'Wait quietly.',target:null,when:[],then:[{set:['$actor','doing','waiting']}],approach:[],during:[{verb:'rest',params:{seconds:1}}],takes:'seconds'}],alignment:{understanding:'Wait quietly.',trigger:{kind:'now'}}};
    return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
  };
  const cfg={...f.brain.cfg,anthropicKey:'synthetic-only-compiler',compilerModel:'synthetic-only-compiler',budgetUsdPerDay:.5};
  const brain=new Brain(f.host,f.db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:true});
  t.after(()=>brain.quiesce());brain.mode='live'; // Only injected compiler; Jev stays fake, no provider.
  const service=new IntentControlV2(f.host,brain,f.souls,{historyV1:true});
  const scope=service.ownerScope({userId:row.owner,expiresAt:Number.MAX_SAFE_INTEGER},row.id);
  const received=await accept(f.host,service.submit(scope,{contract:'soul-intent/2',requestId:'shutdown-held-original',op:'upsert',words:'Wait quietly.'}));assert.equal(received.phase,'received');
  // Upserts publish their durable received receipt before scheduling interpretation
  // on the next event-loop turn. This test shuts down an already-entered compiler.
  for(let i=0;i<100&&calls===0;i++)await delay(1);
  assert.equal(calls,1,'the accepted injected compiler has entered before shutdown');
  brain.quiesce();let drained=false;const drain=Promise.all([brain.settled(),service.settled()]).then(()=>drained=true);
  await setImmediate();assert.equal(drained,false);assert.equal(await brain.compile(f.host.minds.get(row.id)!,'another direction'),null);
  await brain.evaluate(f.host.minds.get(row.id)!,'timer');await brain.direct();assert.equal(calls,1);
  release();for(let i=0;i<100&&!drained;i++){await setImmediate();f.host.drainInputs();}await drain;assert.equal(drained,true);
  assert.equal(service.lookup(scope,'shutdown-held-original').phase,'understood');assert.ok(f.host.kernel.vocab.cards['shutdown demonstration']);
  assert.equal(Object.keys(f.host.intentHistoryOf(row.id).attempts).length,0,'drained understanding is not invented physical execution');
  assert.equal(f.db.paidCost(),0);assert.equal(brain.cfg, cfg);assert.equal(brain.budget,.5);
  await brain.settled();assert.equal(calls,1);f.host.saveSnapshot(true);
});

test('archive drain keeps database available until an already-started verified upload settles',async()=>{
  const db=new Db(':memory:'),objects=new Map<string,Uint8Array>();let release!:()=>void,entered=false;const held=new Promise<void>(r=>release=r);
  const archive=new TakeArchive(db,'local-drain',{async put(key,body){entered=true;await held;objects.set(key,body);},async get(key){return objects.get(key)!;}},'local-test');
  try{
    db.saveTake('local-drain',{fromTick:0,toTick:6000,take:{frames:[{tick:0,public:'synthetic pose'}]}});
    const push=archive.archiveOne(6000);for(let i=0;i<100&&!entered;i++)await delay(10);assert.equal(entered,true);
    archive.stop();let done=false;const drain=archive.settled().then(()=>done=true);await setImmediate();assert.equal(done,false);
    release();assert.equal(await push,true);await drain;assert.equal(done,true);assert.equal(objects.size,1);assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM take_archives').get() as {n:number}).n,1);
  }finally{release();archive.stop();await archive.settled();db.close();}
});
