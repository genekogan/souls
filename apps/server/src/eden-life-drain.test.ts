import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,accept} from '../test/native-owner-fixture.ts';
import {commonsLifeReaderFactory,marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {drainEdenThought} from './eden-bootstrap.ts';
const factory=commonsLifeReaderFactory(await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true}));
async function setup(t:any){const f=fixture(':memory:',factory);t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await accept(f.host,f.host.installCommonsProvisionsV1());f.host.paused=true;return f;}
test('original drain ordering leaves a paused late life installation queued after its pump has ended',async t=>{
 const f=await setup(t);await drainEdenThought(f.host,f.brain,undefined);const tick=f.host.engine.world.tick;let settled=false;const pending=f.host.installCommonsKitchenV1().then(()=>{settled=true;});await delay(35);assert.equal(settled,false);assert.equal(f.host.engine.world.tick,tick);assert.equal(f.host.paused,true);f.host.drainInputs();await pending;assert.equal(settled,true);
});

test('expanded pumped drain settles delayed direct life work and later Brain work while the clock remains paused',async t=>{
 const f=await setup(t),tick=f.host.engine.world.tick;let installed=false,closed=false;const settle=async()=>{await delay(20);await f.host.installCommonsKitchenV1();installed=true;await f.host.enqueue('rules','synthetic-life-drain',{worldEvent:{id:'life-drained',text:'Synthetic bounded life work drained.'}});};
 await drainEdenThought(f.host,f.brain,undefined,Promise.resolve(),[settle]);closed=true;assert.equal(installed,true);assert.equal(closed,true);assert.equal(f.host.engine.world.tick,tick);assert.equal(f.host.paused,true);assert.ok(f.host.engine.rulesVersion.includes('+commons-kitchen/2'));assert.equal(f.db.paidCost(),0);
});
