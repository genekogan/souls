// Paired/foreign Souls never receive native fake choices, words or reflection;
// pairing also fences a decision already queued by the native brain.
import test from 'node:test';import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {toyFactory} from '@souls/engine-toy';
import {Brain} from './brain.ts';import {WorldHost} from './world.ts';import {Db} from './db.ts';import {config} from './config.ts';
test('native cast predicate suppresses every Soul route and fences queued work',async()=>{
 const db=new Db(':memory:'),host=new WorldHost(db,toyFactory,'native-boundary',1e9);host.boot();
 const skipped=new Set(['paired']),sink={onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){},clients:()=>0};
 const brain=new Brain(host,db,{...config,worldKey:'toy',mindDriver:'central',brainMode:'fake',typesafeKey:undefined,anthropicKey:undefined,budgetUsdPerDay:.5},sink,{skipMind:m=>skipped.has(m.soulId)});
 try{
  for(const id of ['native','paired'])void host.enqueue('birth','test',{soulId:id,entityId:'h_'+id,name:id,description:'Synthetic native boundary fixture',owner:'dev:admin'});
  host.drainInputs();await setImmediate();
  const paired=host.minds.get('paired')!,native=host.minds.get('native')!;
  await brain.evaluate(paired,'timer');await brain.reflect(paired,1);await brain.attune(paired);await brain.speak('paired','native','greet',undefined,undefined);
  assert.equal(db.brainCalls(1000).some(c=>c.soulId==='paired'),false);
  assert.equal(db.recentTalk(100).some(c=>c.from==='paired'),false);
  for(let i=0;i<400;i++){host.tickOnce();if(i%5===0)await setImmediate();}
  assert.ok(db.brainCalls(1000).some(c=>c.soulId==='native'),'native cast continues to think');
  assert.equal(db.brainCalls(1000).some(c=>c.soulId==='paired'),false);
  assert.equal(db.events(host.worldId).some(e=>e.kind==='decision'&&e.payload.soulId==='paired'),false);
  // Stop periodic work, then accept a private native choice but revoke native
  // authority before its queued event is appended.
  brain.quiesce();await brain.settled();host.drainInputs();
  const before=db.events(host.worldId).filter(e=>e.kind==='decision').length;
  (brain as unknown as {quiescing:boolean}).quiescing=false;
  native.lastFingerprint='';native.pending=null;native.nextEvalTick=0;
  await brain.evaluate(native,'new-intent');skipped.add('native');host.drainInputs();await setImmediate();
  assert.equal(db.events(host.worldId).filter(e=>e.kind==='decision').length,before,'pairing fences the queued decision');
  // Reflection is also queued work. Revocation must drop it quietly rather
  // than leak a journal write or reject an unobserved afterTick promise.
  skipped.delete('native');
  const reflectionsBefore=db.events(host.worldId).filter(e=>e.kind==='rules'&&e.payload?.reflection).length;
  const reflection=brain.reflect(native,2);skipped.add('native');host.drainInputs();await reflection;
  assert.equal(db.events(host.worldId).filter(e=>e.kind==='rules'&&e.payload?.reflection).length,reflectionsBefore);
  // A speaker removed after generation began must not be resurrected by the
  // async word-commit route. Default callers retain their legacy behavior.
  const talkBefore=db.recentTalk(100).length;host.minds.delete('native');
  await (brain as unknown as {speakWork:(from:string,to:string,act:string,about?:string,manner?:string)=>Promise<void>}).speakWork('native','paired','greet');
  assert.equal(db.recentTalk(100).length,talkBefore);host.minds.set('native',native);
  assert.equal(db.paidCost(),0);
 }finally{brain.quiesce();host.stop();await brain.settled();db.close();}
});
