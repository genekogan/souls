import test from 'node:test';import assert from 'node:assert/strict';
import {marsFactory} from '@souls/engine-mars';
import {CAMP_ARRIVALS} from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';import {WorldHost} from './world.ts';

test('Edge ambient cannot borrow native construction crew, including queued crew admission; restart/genesis remain exact',async t=>{
 const factory=await marsFactory({scene:'eden-camp',arrival:CAMP_ARRIVALS[0].p,arrivalPlace:'yard',reference:CAMP_ARRIVALS[1].p,grounds:{id:'grounds',name:'Camp'}}),f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const rows:any[]=[];for(const owner of ['ana','ben','cy','dee']){await invite(f,owner);rows.push(await accept(f.host,f.souls.create('dev:'+owner,{name:owner,description:'native construction custody fixture'})));}
 const actor=rows[0].entity_id;
 const decision=(phase:string)=>({soulId:rows[0].id,entityId:actor,option:'construction:'+phase,label:phase,steps:[{verb:'build_lookout',params:{phase}}],reevalTicks:1e9,fallback:false,trigger:'scripted-construction'});
 await accept(f.host,f.host.enqueue('decision','scripted:construction',decision('stage')));
 for(let i=0;i<90000&&f.host.engine.programOf(actor);i++)f.host.tickOnce();assert.equal(f.host.engine.programOf(actor),null);
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true});
 (ledger as any).ambientLife(0);
 const frame=f.host.enqueue('decision','scripted:construction',decision('frame'));
 // The construction is queued before ambient proposals, so only the acceptance
 // guard can see that the formerly idle secondary actors became borrowed crew.
 (ledger as any).ambientLife(400);await accept(f.host,frame);await new Promise(r=>setImmediate(r));f.host.drainInputs();
 assert.ok(f.host.engine.programOf(actor));for(const row of rows.slice(1)){assert.equal(f.host.engine.programOf(row.entity_id),null);assert.equal(f.host.engine.actorBorrowed!(row.entity_id),true);}
 (ledger as any).ambientLife(800);await new Promise(r=>setImmediate(r));f.host.drainInputs();
 assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&e.payload.trigger==='edge-ambient').length,0);
 const hash=f.host.engine.stateHash();f.host.saveSnapshot(true);
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const replay=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(replay.boot().from,mode);assert.equal(replay.engine.stateHash(),hash);for(const row of rows.slice(1))assert.equal(replay.engine.actorBorrowed!(row.entity_id),true);replay.stop();}
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
