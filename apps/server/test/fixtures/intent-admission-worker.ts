import { workerData } from 'node:worker_threads';
import { marsFactory } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const factory=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
const db=new Db(workerData.path),host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
const revision=Object.values(host.intentHistoryOf('s_A').intents)[0].revision;
const append=db.appendEvent.bind(db);
db.appendEvent=(world,event)=>{
  if(event.kind==='intent-admission-v2' && workerData.phase==='before-fact')process.exit(23);
  append(world,event);
  if(event.kind==='intent-admission-v2' && workerData.phase==='after-fact')process.exit(23);
};
const perform=host.engine.perform.bind(host.engine);
host.engine.perform=program=>{
  if(workerData.phase==='before-apply')process.exit(23);
  const result=perform(program);
  if(workerData.phase==='after-apply')process.exit(23);
  return result;
};
void host.enqueueIntentDecision('brain:reflex',{soulId:'s_A',entityId:'h_A',option:'go:campfire',label:'go to campfire',steps:[{verb:'walk_to',params:{to:'campfire',standoff:1.5}}],reevalTicks:1200,fallback:false,trigger:'new-intent-v2'},
  {intentId:revision.intentId,version:revision.version},()=>true);
host.drainInputs();throw new Error('worker exit boundary was not reached');
