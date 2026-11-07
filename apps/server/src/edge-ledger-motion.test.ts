// P0 (Gene: re-animate the Souls). edgeMotionV1: a people jam at the deck's single-file step (traffic.yield /
// traffic.person, never reported as deadlock.*) resolves by stepping back and re-trying; wander:here always moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {WorldHost} from './world.ts';
const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
for(const motion of [false,true])test(`deck crowd then everyone leaves at once: ${motion?'edgeMotionV1 moves them':'without the policy (diagnostic)'}`,{timeout:300000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableStairMakeWayV1(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),...(motion?[f.host.enableEdgeMotionV1()]:[])])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy','dee']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'motion'})));}
 const ledger=new EdgeLedger(f.host,f.db),souls=rows.map(r=>({soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner}));
 const run=async(n:number)=>{for(let i=0;i<n;i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}};
 const W=f.host.engine.world as any,pos=(s:any)=>W.entities[s.entityId].pose.p as number[];
 const deck=ledger.capabilities(souls[0]).find(c=>c.id==='hang-out:commons-deck');if(!deck){t.skip('fixture has no commons-deck');return;}
 for(const s of souls)assert.equal((await accept(f.host,ledger.act(s,{capability:'hang-out:commons-deck',params:{seconds:600}}))).accepted,true);
 await run(2400);
 const onDeck=souls.filter(s=>W.entities[s.entityId].human.level>0).length;t.diagnostic(`on deck: ${onDeck}`);
 const start=souls.map(s=>[...pos(s)]);
 const targets=['walk:social-eden-fire-circle','walk:shore-bank','walk:commons','wander:here'];
 const acts=[];for(const [i,s] of souls.entries()){const caps=ledger.capabilities(s),id=caps.some(c=>c.id===targets[i])?targets[i]:'wander:here';acts.push(await accept(f.host,ledger.act(s,{capability:id,...(id==='wander:here'?{params:{seconds:30}}:{})})));}
 await run(2400);
 const moved=souls.map((s,i)=>Math.hypot(pos(s)[0]-start[i][0],pos(s)[2]-start[i][2]));t.diagnostic('moved '+moved.map(m=>m.toFixed(1)).join(' '));
 const phases=acts.map((a:any,i)=>ledger.receipt(souls[i].soulId,a.receipt.id)!.phase);t.diagnostic('phases '+phases.join(' '));
 if(motion){assert.ok(moved.every(m=>m>1),'every body visibly moved');assert.deepEqual(f.host.engine.runtime.violations,[]);
  f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const h=new WorldHost(f.db,await factory(),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'replay exact');h.stop();}
});
