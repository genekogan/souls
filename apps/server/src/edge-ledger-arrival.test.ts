// G425: consecutive arrivals must not overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
test('souls created back to back arrive at least 0.8 m apart',async t=>{
 const f=fixture(':memory:',await retainedCommonsShoreFactory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 for(const n of ['mira','tomas','ines'])await invite(f,n);
 const created=await accept(f.host,Promise.all(['mira','tomas','ines'].map(n=>f.souls.create('dev:'+n,{name:n,description:'arrival'}))));
 const w=f.host.engine.world as NativeWorld,ps=created.map(r=>w.entities[r.entity_id].pose.p);
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.hypot(ps[i][0]-ps[j][0],ps[i][2]-ps[j][2])>=0.8,JSON.stringify(ps));
 t.diagnostic(JSON.stringify(ps.map(p=>[p[0],p[2]])));
});
