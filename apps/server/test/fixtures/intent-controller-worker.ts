import { workerData } from 'node:worker_threads';
import { marsFactory } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const factory=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
const db=new Db(workerData.path),host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
const append=db.appendEvent.bind(db);
db.appendEvent=(world,event)=>{
  if(event.kind==='intent-controller-v2' && workerData.phase==='before-fact')process.exit(24);
  append(world,event);
  if(event.kind==='intent-controller-v2' && workerData.phase==='after-fact')process.exit(24);
};
host.tickOnce();throw new Error('worker did not reach controller evidence boundary');
