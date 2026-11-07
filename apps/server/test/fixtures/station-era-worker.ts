import { workerData } from 'node:worker_threads';
import { marsCommonsTransitionFactory } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const {path,phase}=workerData as {path:string;phase:string};
const db=new Db(path),factory=await marsCommonsTransitionFactory(),host=new WorldHost(db,factory,'station-era',1e9,'station-era');host.boot();
const append=db.appendEvent.bind(db);
db.appendEvent=(world,event)=>{
  if(phase==='before-event'&&event.payload?.commonsTransition)process.exit(23);
  append(world,event);
  if(phase==='after-event'&&event.payload?.commonsTransition||phase==='after-era'&&event.kind==='station-rules-era-v1')process.exit(23);
};
if(phase==='after-header'){
  db.db.function('exit_after_header',()=>process.exit(23));
  db.db.exec('CREATE TEMP TRIGGER exit_header AFTER UPDATE OF rules_version ON worlds BEGIN SELECT exit_after_header(); END');
}
const adopt=host.engine.adoptCommons!.bind(host.engine);
if(phase==='after-commit')host.engine.adoptCommons=()=>process.exit(23);
if(phase==='after-physical')host.engine.adoptCommons=transition=>{adopt(transition);process.exit(23);};
const accepted=host.adoptCommons('world:checkpoint',{stationEraV1:true});host.drainInputs();await accepted;
throw new Error('worker did not exit at its requested station checkpoint boundary');
