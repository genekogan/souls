// swimwall: a Soul whose swim has ended is left treading water; its owner/agent status says so, not "standing around".
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

test('a Soul left treading water after its swim reads "treading water" in status',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 await invite(f,'pip');const row:any=await accept(f.host,f.souls.create('dev:pip',{name:'Pip',description:'swimmer'}));
 const ledger=new EdgeLedger(f.host,f.db),soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};
 const status=()=>(f.souls.status(row) as {doing?:string;activity?:string});
 assert.equal(status().doing,'standing around');                                  // on dry ground, nothing running
 const r=await accept(f.host,ledger.act(soul,{capability:'swim:shore-water'}));assert.equal(r.accepted,true,JSON.stringify(r));
 const id=r.accepted?r.receipt.id:'',w=f.host.engine.world as NativeWorld;
 for(let i=0;i<20000&&['waiting','started'].includes(ledger.receipt(soul.soulId,id)!.phase);i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
 assert.equal(ledger.receipt(soul.soulId,id)!.phase,'completed');
 assert.equal(w.entities[soul.entityId].human?.activity,'tread');                  // the body stays in the water, still
 assert.equal(f.host.engine.programOf(soul.entityId),null);                        // and no activity is running
 assert.equal(f.host.minds.get(soul.soulId)!.doing,'standing around');            // the plan's idle word, kept for the mind
 // D1: the card reads the body, not the idle plan (before: publicSoul said "standing around" and only the web relabelled it)
 assert.equal(f.host.publicSoul(f.host.minds.get(soul.soulId)!).doing,'treading water');
 assert.equal((status() as {body?:{inWater?:boolean}}).body?.inWater,true);
 assert.equal(status().activity,'tread');assert.equal(status().doing,'treading water');
});
