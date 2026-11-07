// PM-R055b: in-flight receipts survive a clean restart. A started act whose programme the snapshot carries keeps
// being followed to completion; a waiting act (body finishing a safe stop first) is re-armed instead of being lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
test('restart: started receipts keep being followed, waiting receipts are re-armed (clean close)',{timeout:300000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'edge-restart-receipts-')),path=join(dir,'sim.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=fixture(path,factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 await accept<unknown>(f.host,f.host.enableContinuousDayV1());   // runtime-policy cfg facts would need the history-aware factory to restore
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'restart receipts'})));}
 const [ana,ben]=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 let ledger=new EdgeLedger(f.host,f.db);
 const run=async(h:WorldHost,n:number,until=()=>false)=>{for(let i=0;i<n&&!until();i++){h.tickOnce();if(i%20===0){await setImmediate();h.drainInputs();}}};
 // Ana: a long rest, started. Ben: asleep, then an act -> waiting while the body rises safely first.
 const a=await accept(f.host,ledger.act(ana,{capability:'rest:here',params:{seconds:120}}));const aid=(a as any).receipt.id;
 await run(f.host,60,()=>ledger.receipt(ana.soulId,aid)!.phase==='started');assert.equal(ledger.receipt(ana.soulId,aid)!.phase,'started');
 await accept(f.host,f.host.enqueue('decision','fixture:sleep',{soulId:ben.soulId,entityId:ben.entityId,option:'sleep',label:'sleep on own mat',steps:[{verb:'mars:sleep',params:{mat:'commons-mat-2',duration:600,returnTo:COMMONS_PERSONAL_RESOURCES[1].sleepReturn}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
 const W=f.host.engine.world as any;await run(f.host,3000,()=>W.entities[ben.entityId].human?.sleepPose?.standingFraction===0);assert.equal(W.entities[ben.entityId].human?.sleepPose?.standingFraction,0,'Ben asleep');
 const b=await accept(f.host,ledger.act(ben,{capability:'rest:here',params:{seconds:5}}));const bid=(b as any).receipt.id;
 const wasWaiting=ledger.receipt(ben.soulId,bid)!.phase==='waiting';
 // Clean close exactly as edge-server does: stop the clock, drain, snapshot.
 f.host.stop();f.host.drainInputs();assert.ok(f.host.engine.canSnapshot?.()!==false,'snapshot carries in-flight work');f.host.saveSnapshot(true);
 const worldId=f.host.worldId,seed=f.host.seed;f.db.close();
 const db=new Db(path),h=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});h.boot();h.drainInputs();t.after(()=>{h.stop();if(db.db.isOpen)db.close();});
 ledger=new EdgeLedger(h,db);
 assert.equal(ledger.receipt(ana.soulId,aid)!.phase,'started','started receipt kept');
 if(wasWaiting)assert.equal(ledger.receipt(ben.soulId,bid)!.phase,'waiting','waiting receipt re-armed, not lost');
 await run(h,6000,()=>ledger.receipt(ana.soulId,aid)!.phase!=='started'&&!['waiting','started'].includes(ledger.receipt(ben.soulId,bid)!.phase));
 assert.equal(ledger.receipt(ana.soulId,aid)!.phase,'completed',JSON.stringify(ledger.receipt(ana.soulId,aid)));
 assert.equal(ledger.receipt(ben.soulId,bid)!.phase,'completed',JSON.stringify(ledger.receipt(ben.soulId,bid)));
 assert.ok(wasWaiting,'the scenario exercised a waiting receipt');
 assert.equal(Number((db.db.prepare("SELECT COUNT(*) n FROM edge_receipts_v1 WHERE code='receipt.lost-on-restart'").get() as any).n),0);
});
