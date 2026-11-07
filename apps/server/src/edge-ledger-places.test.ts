// placeRegionsV1 (World WORLD-SPREAD tiers 0/1): W1 places on admitted native ground become destination regions with
// walk/hang-out offers; places off native ground are refused honestly (no fake walks); genesis replay is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {inPoly} from './edge/ledger/places.ts';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('W1 places on native ground become walkable destinations; off-ground places are refused; replay exact',{timeout:300000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableContinuousDayV1()])await accept<unknown>(f.host,p);
 await invite(f,'ana');const row:any=await accept(f.host,f.souls.create('dev:ana',{name:'ana',description:'walker'}));
 const kitchen={id:'commons-kitchen',label:'Shared kitchen tables',polygon:[[-25,2.5],[-1,2.5],[-1,5.5],[-25,5.5]] as [number,number][]};
 // This fixture has no east-side ground (eg/1): an east place must be refused, not faked.
 const garden={id:'eden-stone-garden',label:'Stone garden gate',polygon:[[53.2,-13.8],[60.8,-13.8],[60.8,-6.2],[53.2,-6.2]] as [number,number][]};
 const out=await accept(f.host,f.host.installPlaceRegionsV1([kitchen,garden]));
 assert.deepEqual(out.admitted,['commons-kitchen']);assert.equal(out.refused[0]?.code,'region.unsupported',JSON.stringify(out));
 const again=await accept(f.host,f.host.installPlaceRegionsV1([kitchen]));assert.deepEqual(again.admitted,[],'idempotent');
 const W=f.host.engine.world as any;assert.equal(W.regions['commons-kitchen'].kind,'place');assert.ok(f.host.kernel.things['commons-kitchen'],'kernel place');
 const ledger=new EdgeLedger(f.host,f.db),soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};
 const caps=ledger.capabilities(soul);assert.ok(caps.some(c=>c.id==='walk:commons-kitchen'),'walk offered');assert.ok(!caps.some(c=>c.id==='walk:eden-stone-garden'),'no fake walk');
 const r=await accept(f.host,ledger.act(soul,{capability:'walk:commons-kitchen'}));assert.equal(r.accepted,true,JSON.stringify(r));
 for(let i=0;i<3000&&['waiting','started'].includes(ledger.receipt(soul.soulId,(r as any).receipt.id)!.phase);i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}
 assert.equal(ledger.receipt(soul.soulId,(r as any).receipt.id)!.phase,'completed');
 const p=W.entities[soul.entityId].pose.p;assert.ok(inPoly(p[0],p[2],kitchen.polygon),`inside the kitchen: ${p}`);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,await factory(),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'replay exact');h.stop();
});
