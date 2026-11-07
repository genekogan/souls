import { workerData } from 'node:worker_threads';
import { marsFactory } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
import { IntentObservations } from '../../src/intent-observations.ts';
const factory=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
const db=new Db(workerData.path),host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
const capture=IntentObservations.prototype.capture,publish=IntentObservations.prototype.publish,append=db.appendEvent.bind(db);
IntentObservations.prototype.capture=function(payload){
  if(payload.phase==='completed' && workerData.phase==='before-capture'){host.saveSnapshot(true);process.exit(26);}
  capture.call(this,payload);
  if(payload.phase==='completed' && workerData.phase==='after-capture')process.exit(26);
};
db.appendEvent=(world,event)=>{
  if(event.kind==='intent-controller-v2' && event.payload.phase==='completed' && workerData.phase==='before-fact')process.exit(26);
  append(world,event);
  if(event.kind==='intent-controller-v2' && event.payload.phase==='completed' && workerData.phase==='after-fact')process.exit(26);
};
IntentObservations.prototype.publish=function(payload,event,validate){
  publish.call(this,payload,event,validate);
  if(payload.phase==='completed' && workerData.phase==='after-commit')process.exit(26);
};
for(let i=0;i<2000;i++)host.tickOnce();throw new Error('worker missed terminal boundary');
