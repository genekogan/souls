import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { soulLifecycleSchema } from '@souls/protocol';
import { validateCard } from '@souls/kernel';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function admitted(){
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();await invite(f,'alice');
  const response=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Alice',description:'local'})});
  assert.equal(response.status,202);const pending=soulLifecycleSchema.parse((await response.json() as {lifecycle:unknown}).lifecycle);
  f.host.drainInputs();await delay(0);assert.equal(f.souls.controlReady(f.db.soul(pending.soulId)!),true);
  return {...f,soul:f.db.soul(pending.soulId)!};
}
async function retire(f:Awaited<ReturnType<typeof admitted>>){
  const response=await f.app.request(`/v1/souls/${f.soul.id}`,{method:'DELETE',headers:{authorization:'Bearer dev:alice','X-Sim-Lifecycle':'1'}});
  assert.equal(response.status,202);
}
async function token(f:Awaited<ReturnType<typeof admitted>>){
  const code=f.souls.pairCode(f.soul,'http://127.0.0.1:4956',f.db.user('dev:alice')!).code;
  return f.souls.pairExchange(code,'local').token;
}
async function write(f:Awaited<ReturnType<typeof admitted>>,tail:string,input:unknown,credential='dev:alice',agent=false){
  return f.app.request(agent?'/v1/agent/'+tail:`/v1/souls/${f.soul.id}/${tail}`,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(input)});
}
async function drain<T>(f:Awaited<ReturnType<typeof admitted>>,promise:Promise<T>){
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(let i=0;i<100&&!done;i++){f.host.drainInputs();await delay(2);}
  assert.ok(done,'actual local sequencer settles the request');return promise;
}
for(const agent of [false,true])test(`${agent?'agent':'human'} queued HTTP intent cannot apply after durable retirement acceptance`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=agent?await token(f):'dev:alice';
  const before=f.db.events(f.host.worldId).length;
  const request=f.app.request(agent?'/v1/agent/intent':`/v1/souls/${f.soul.id}/intent`,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify({intent:{goal:'wander'}})});
  await delay(0);await retire(f);f.host.drainInputs();
  const result=await request;assert.equal(result.status,agent?401:404);
  assert.equal(f.db.events(f.host.worldId).slice(before).some(e=>e.kind==='intent'||e.kind==='deck'||e.kind==='mandate'),false);
});

for(const agent of [false,true])test(`${agent?'agent':'human'} current authority accepts a normal intent before retirement`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=agent?await token(f):'dev:alice';
  const result=await drain(f,write(f,'intent',{intent:{goal:'wander'}},credential,agent));assert.equal(result.status,200);
  assert.equal(f.host.minds.get(f.soul.id)!.intent?.goal,'wander');assert.equal(f.db.paidCost(),0);
});

for(const changed of ['invite','admin-role','owner','world','body'] as const)test(`queued human intent rechecks current ${changed}`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const before=f.db.events(f.host.worldId).length;
  const pending=write(f,'intent',{intent:{goal:'wander'}},changed==='admin-role'?'dev:admin':'dev:alice');await delay(0);
  switch(changed){
    case 'invite':f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();break;
    case 'admin-role':f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();break;
    case 'owner':await invite(f,'bob');f.db.db.prepare("UPDATE souls SET owner='dev:bob' WHERE id=?").run(f.soul.id);break;
    case 'world':f.db.createWorld({id:'other-local',schema:'local',rules_version:factory.rulesVersion,dt:.05,seed:'other'});f.db.db.prepare("UPDATE souls SET world_id='other-local' WHERE id=?").run(f.soul.id);break;
    case 'body':f.host.engine.world.entities[f.soul.entity_id].human!.soul='different-local-soul';break;
  }
  f.host.drainInputs();const response=await pending;assert.equal(response.status,changed==='invite'||changed==='admin-role'?403:changed==='body'?409:404);
  assert.equal(f.db.events(f.host.worldId).slice(before).some(e=>e.kind==='intent'),false);
});

test('queued agent intent rechecks token rotation and current owner invitation',async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=await token(f),before=f.db.events(f.host.worldId).length;
  const pending=write(f,'intent',{intent:{goal:'wander'}},credential,true);await delay(0);f.souls.pairExchange(f.souls.pairCode(f.soul,'http://127.0.0.1:4956',f.db.user('dev:alice')!).code,'rotated-local');
  f.host.drainInputs();assert.equal((await pending).status,401);assert.equal(f.souls.soulFromToken(credential),null);
  const current=await token(f);const withdrawn=write(f,'intent',{intent:{goal:'wander'}},current,true);await delay(0);f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  f.host.drainInputs();assert.equal((await withdrawn).status,401);assert.equal(f.souls.soulFromToken(current),null);
  assert.equal(f.db.events(f.host.worldId).slice(before).some(e=>e.kind==='intent'),false);
});

for(const operation of ['cards','mandate'] as const)test(`actual queued ${operation} primitive cannot apply after retirement`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const before=f.db.events(f.host.worldId).length;
  const {hash,by,mintedAt,origin,...card}=structuredClone(f.host.kernel.vocab.cards.wander),proposal={...card,name:'drift locally'};
  assert.equal(validateCard(proposal,f.host.kernel,new Set(f.host.engine.describeVerbs().map(v=>v.verb))).ok,true);
  const queued:string[]=[],enqueue=f.host.enqueueChecked.bind(f.host);
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{queued.push(args[0]);return enqueue(...args);});
  const input=operation==='cards'?{cards:[proposal]}:{words:'rest now'};
  const pending=write(f,operation,input);await delay(0);assert.ok(queued.includes(operation==='cards'?'mint':'mandate'),'actual primitive reached the guarded sequencer');await retire(f);f.host.drainInputs();
  assert.equal((await pending).status,404);assert.equal(f.db.events(f.host.worldId).slice(before).some(e=>['intent','mandate','mint','deck'].includes(e.kind)),false);
  assert.equal(f.host.kernel.vocab.cards['drift locally'],undefined);
});

for(const agent of [false,true])test(`${agent?'agent':'human'} late local compiler result cannot mutate after retirement`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=agent?await token(f):'dev:alice',before=f.db.events(f.host.worldId).length;
  let finish!:(value:Awaited<ReturnType<typeof f.brain.compile>>)=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),result=new Promise<Awaited<ReturnType<typeof f.brain.compile>>>(resolve=>finish=resolve);
  t.mock.method(f.brain,'compile',async (...args:Parameters<typeof f.brain.compile>)=>{assert.equal(typeof args[3],'function');assert.equal(typeof args[4],'function');entered();return result;});
  const pending=write(f,'command',{text:'wander'},credential,agent);await started;await retire(f);
  finish({ok:true,agenda:[{card:'wander',target:null}],minted:[]});const response=await pending;assert.equal(response.status,agent?401:404);
  f.host.drainInputs();assert.equal(f.db.events(f.host.worldId).slice(before).some(e=>['intent','mandate','mint','deck'].includes(e.kind)),false);assert.equal(f.db.paidCost(),0);
});

for(const agent of [false,true])test(`${agent?'agent':'human'} final HTTP delivery cannot report stale success after an earlier valid accepted intent`,async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=agent?await token(f):'dev:alice';
  let entered!:()=>void,finish!:()=>void;const held=new Promise<void>(resolve=>finish=resolve),accepted=new Promise<void>(resolve=>entered=resolve),original=f.souls.setIntent.bind(f.souls);
  t.mock.method(f.souls,'setIntent',async(...args:Parameters<typeof f.souls.setIntent>)=>{const result=await original(...args);entered();await held;return result;});
  const pending=write(f,'intent',{intent:{goal:'wander'}},credential,agent);await delay(0);f.host.drainInputs();await accepted;
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,1);await retire(f);finish();
  const response=await pending;assert.equal(response.status,agent?401:404);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,1,'prior accepted fact stays immutable');
});

test('agent long-poll final delivery denies retired private status',async t=>{
  const f=await admitted();t.after(()=>f.db.close());const credential=await token(f);
  const pending=f.app.request('/v1/agent/wait?seconds=1',{headers:{authorization:'Bearer '+credential}});await delay(0);await retire(f);f.host.drainInputs();
  const response=await pending;assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal('status' in await response.json(),false);
});

test('actual intent and mint guards execute while the canonical SQLite write transaction holds',async t=>{
  const f=await admitted();t.after(()=>f.db.close());const enqueue=f.host.enqueueChecked.bind(f.host),locked:string[]=[];
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{
    const [kind,author,payload,guard,journal]=args;
    return enqueue(kind,author,payload,()=>{assert.equal(f.db.db.isTransaction,true);locked.push(kind);return guard();},journal);
  });
  assert.equal((await drain(f,write(f,'intent',{intent:{goal:'wander'}}))).status,200);
  const {hash,by,mintedAt,origin,...card}=structuredClone(f.host.kernel.vocab.cards.wander);
  const minted=await drain(f,write(f,'cards',{cards:[{...card,name:'drift locally'}]}));assert.equal(minted.status,200);assert.equal((await minted.json() as {ok:boolean}).ok,true);
  assert.deepEqual(locked,['intent','mint']);assert.ok(f.host.kernel.vocab.cards['drift locally']);
});
