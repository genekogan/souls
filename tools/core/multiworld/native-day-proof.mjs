// Accelerated real native-cast day and exact graceful-close replay, using only
// disposable local databases and the seeded fake backend ($0).
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {setImmediate} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
import {openWorldServer} from './world-server.mjs';
export async function proveNativeDay({input,worldKey,output}){
 const dir=mkdtempSync(join(tmpdir(),'souls-native-day-'));let app;
 try{
  const options={input:resolve(input),dataDir:dir,worldKey,worldId:worldKey==='mars'?'mars-2026-1':'littlemartians-1',port:worldKey==='mars'?4963:4964};
  app=await openWorldServer(options);app.host.stop();
  const cast=app.host.minds.size;
  const host=app.host,start=host.engine.world.tick,through=start+host.living.dayTicks+2000;
  const errors=[];host.listeners.push({onRuntimeEvent:e=>{if(e.kind==='violation')errors.push(e);}});
  for(let i=0;host.engine.world.tick<through;i++){
   host.tickOnce();
   if(i%20===0)await setImmediate();
   if(i%12000===0)console.log(JSON.stringify({worldKey,tick:host.engine.world.tick,head:host.seq,quiet:!!host.living.quiet}));
   assert.deepEqual(host.engine.runtime.violations,[],'physical violations');
   assert.ok(i<host.living.dayTicks+12000,'clock must advance');
  }
  app.brain.quiesce();await app.brain.settled();host.drainInputs();
  const events=app.db.events(host.worldId),recoveries=events.filter(e=>e.kind==='rules'&&e.payload?.recovery);
  assert.equal(recoveries.length,0,'no cleared/retained physical recovery');assert.equal(errors.length,0);
  assert.equal(app.db.paidCost(),0);assert.equal(app.brain.budget,0);
  assert.ok(events.some(e=>e.kind==='decision'&&e.author.startsWith('brain:')),'native cast actually chose activities');
  assert.ok(events.some(e=>e.kind==='rules'&&e.payload?.compact&&e.payload?.firstLight),'quiet first-light renewal');
  const before={tick:host.engine.world.tick,head:host.seq,stateHash:host.engine.stateHash(),rulesVersion:host.engine.rulesVersion};
  const nativeDecisions=events.filter(e=>e.kind==='decision'&&e.author.startsWith('brain:')).length;
  await app.close();app=null;
  const after=await openWorldServer({...options,checkOnly:true});
  for(const key of Object.keys(before))assert.equal(after[key],before[key],key);
  const proof={contract:'native-fake-cast-day-proof/1',qualifiedAtUTC:new Date().toISOString(),worldKey,fromTick:start,throughTick:before.tick,dayTicks:72000,cast,nativeDecisions,recoveries:0,violations:0,paidCost:0,exactRestart:before,boot:after.boot,scope:'Accelerated disposable native world, fake choices only; no live or production data.'};
  if(output){mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(resolve(output),JSON.stringify(proof,null,2)+'\n');}return proof;
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [input,worldKey,output]=process.argv.slice(2);console.log(JSON.stringify(await proveNativeDay({input,worldKey,output})));}
