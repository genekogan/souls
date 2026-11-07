// continuousDayV1 (Gene: no nightly quiet hours): a quiet under way ends without compaction, the day turns as a
// plain event, nothing ever pauses; history before the fact (quiet/compact) still replays exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,accept,factory} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
const rules=(f:any)=>f.db.events(f.host.worldId).filter((e:any)=>e.kind==='rules').map((e:any)=>e.payload);
test('continuousDayV1: legacy quiet ends at once, days turn without quiet, replay exact',{timeout:300000},async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 new LivingWorld(f.host);await accept(f.host,f.host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:400,customs:[]}}));
 // legacy behaviour first: the day boundary brings a quiet renewal and its compaction
 for(let i=0;i<450;i++){f.host.tickOnce();f.host.drainInputs();}
 assert.ok(rules(f).some((p:any)=>p.quiet),'legacy quiet emitted');assert.ok(rules(f).some((p:any)=>p.compact),'legacy compaction');
 // a quiet under way when the fact arrives
 await accept(f.host,f.host.enqueue('rules','fixture',{quiet:true,day:9,why:'fixture: a quiet under way'}));assert.equal(f.host.quietBarrier,true);
 await accept<unknown>(f.host,f.host.enableContinuousDayV1());const before=rules(f).length;
 for(let i=0;i<5;i++){f.host.tickOnce();f.host.drainInputs();}
 assert.equal(f.host.quietBarrier,false,'quiet ended');assert.equal(f.host.engine.isQuiet?.()!==undefined,true);
 const after=rules(f).slice(before);assert.ok(after.some((p:any)=>p.quietEnded),'quietEnded fact');assert.ok(!after.some((p:any)=>p.compact),'no compaction');
 for(let i=0;i<1300;i++){f.host.tickOnce();f.host.drainInputs();assert.equal(f.host.quietBarrier,false);}
 const later=rules(f).slice(before);assert.ok(!later.some((p:any)=>p.quiet||p.compact),'never quiet again');assert.ok(later.filter((p:any)=>p.dayTurn).length>=3,'days turned');
 assert.ok(later.some((p:any)=>p.worldEvent?.id==='first-light'));
 f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');
 assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'genesis replay exact');assert.equal(h.quietBarrier,false);h.stop();
});
