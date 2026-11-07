import { workerData } from 'node:worker_threads';
import { marsFactory,EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { Db } from '../../src/db.ts';
import { WorldHost } from '../../src/world.ts';
const {path,phase}=workerData as {path:string;phase:string};
const db=new Db(path),factory=await marsFactory(EDEN_COMMONS_WORLD);
const host=new WorldHost(db,factory,'clock-crash',1e9,'clock-crash',{durableClockV1:true});host.boot();
if(phase==='after-step'){
  const step=host.engine.step.bind(host.engine);host.engine.step=()=>{step();process.exit(23);};
}else if(phase==='after-write'){
  db.db.function('exit_after_clock_write',()=>process.exit(23));
  db.db.exec('CREATE TEMP TRIGGER exit_clock AFTER UPDATE ON clock_frontiers_v1 BEGIN SELECT exit_after_clock_write(); END');
}else if(phase==='after-commit'){
  const exec=db.db.exec.bind(db.db);db.db.exec=(sql:string)=>{exec(sql);if(sql==='COMMIT')process.exit(23);};
}else throw new Error('unknown clock boundary');
host.tickOnce();throw new Error('worker did not exit at requested clock boundary');
