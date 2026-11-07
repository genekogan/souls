// Restart safety with the durable clock: run, tick past the last snapshot, stop, restart, keep ticking.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function world(t:any){
 const dir=mkdtempSync(join(tmpdir(),'edge-restart-')),path=join(dir,'sim.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=fixture(path,factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'restart'}));
 return {f,path,row};
}
function reboot(path:string,worldId:string,seed:string){const db=new Db(path),h=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});const boot=h.boot();h.drainInputs();return {db,h,boot};}
async function afterRestart(db:Db,h:WorldHost){
 // Exactly what the edge server does at boot: enqueue prospective facts, then keep ticking.
 await accept(h,h.enqueue('rules','operator:test',{runtimePolicy:{sleepBlockTicks:1200,...h.extra.runtimePolicy as object,quietStallReleaseV1:true},why:'restart test'}));
 for(let i=0;i<200;i++)h.tickOnce();
 await accept(h,h.enqueue('rules','operator:test',{worldEvent:{id:'after-restart',text:'still here'},why:'restart test'}));
 for(let i=0;i<50;i++)h.tickOnce();
 const ev=db.events(h.worldId);for(let i=1;i<ev.length;i++)assert.ok(ev[i].tick>=ev[i-1].tick,`log ticks monotonic at seq ${ev[i].seq}`);
}
for(const mode of ['clean-close-with-snapshot','close-while-walking (no snapshot)','hard stop (no close)'] as const)test('restart: '+mode,async t=>{
 const {f,path,row}=await world(t);f.host.saveSnapshot(true);
 if(mode.startsWith('close-while-walking'))await accept(f.host,f.host.enqueue('decision','fixture:walk',{soulId:row.id,entityId:row.entity_id,option:'walk',label:'walk far',steps:[{verb:'walk_to',params:{to:'shore-bank'}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 for(let i=0;i<300;i++)f.host.tickOnce();                          // well past the last snapshot, eventless clock
 const tickBefore=f.host.engine.world.tick,worldId=f.host.worldId,seed=f.host.seed;
 if(mode!=='hard stop (no close)'){f.host.stop();if(!f.host.engine.canSnapshot||f.host.engine.canSnapshot())f.host.saveSnapshot(true);else f.host.saveSnapshot(true);}
 f.db.close();
 const {db,h,boot}=reboot(path,worldId,seed);t.after(()=>{h.stop();if(db.db.isOpen)db.close();});
 assert.ok(h.engine.world.tick>=tickBefore-1,`resumed at ${h.engine.world.tick}, was ${tickBefore} (${JSON.stringify(boot)})`);
 await afterRestart(db,h);
 // and a second restart still boots
 h.stop();h.saveSnapshot(true);db.close();const again=reboot(path,worldId,seed);again.h.stop();again.db.close();
});
