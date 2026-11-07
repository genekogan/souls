import { workerData } from 'node:worker_threads';
import { marsCommonsTransitionFactory } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const {path,phase}=workerData as {path:string;phase:string};
const db=new Db(path),factory=await marsCommonsTransitionFactory(),host=new WorldHost(db,factory,'existing-commons',1e9,'existing-commons');host.boot();
if(phase==='after-event'){
  const append=db.appendEvent.bind(db);db.appendEvent=(world,event)=>{append(world,event);if(event.payload?.commonsTransition)process.exit(23);};
}
if(phase==='after-header'){
  db.db.function('exit_after_header',()=>process.exit(23));
  db.db.exec('CREATE TEMP TRIGGER exit_header AFTER UPDATE OF rules_version ON worlds BEGIN SELECT exit_after_header(); END');
}
if(phase==='after-commit')host.engine.adoptCommons=()=>process.exit(23);
const accepted=host.adoptCommons('world:checkpoint');host.drainInputs();await accepted;
throw new Error('worker did not exit at its requested persistence boundary');
