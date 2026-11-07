// End-to-end native decision acceptance boundary, using a disposable fake camp.
// Token issuance stays in memory; fixtures never log or export credentials.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';import {setImmediate} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {openWorldServer} from './world-server.mjs';
import {copySqliteReadOnly} from './copy-sqlite.mjs';
const input=resolve(new URL('../../../',import.meta.url).pathname);
async function accept(app,p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){app.host.drainInputs();await setImmediate();}return p;}
async function complete(app,soul,capability){const result=await accept(app,app.edge.act(soul,{capability}));assert.ok(result.accepted,JSON.stringify(result));for(let i=0;i<45000;i++){app.host.tickOnce();if(i%20===0)await setImmediate();const r=app.edge.receipt(soul.soulId,result.receipt.id);if(!['started','waiting'].includes(r.phase)){assert.equal(r.phase,'completed',JSON.stringify(r));return;}}assert.fail('Construction did not finish');}
test('native cast cannot borrow paired crew, safe pairing refuses active borrow, queued authority is revoked, and accepted history replays independently',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-native-custody-'));let app;
 try{
  const options={input,dataDir:join(dir,'live'),worldKey:'mars',worldId:'mars-2026-1',port:4963};
  app=await openWorldServer(options);app.host.stop();app.brain.quiesce();
  const cast=[...app.host.minds.values()],lead=cast[0],other=cast[1];
  await complete(app,lead,'build:lookout-stage');
  const frame=await accept(app,app.edge.act(lead,{capability:'build:lookout-frame'}));assert.ok(frame.accepted,JSON.stringify(frame));
  // Edge admission can honestly wait for quiet renewal/safe cleanup. Verify
  // the actual native program starts before making a crew-custody assertion.
  for(let i=0;i<2400&&!app.host.engine.actorBorrowed(other.entityId);i++){app.host.tickOnce();if(i%20===0)await setImmediate();const r=app.edge.receipt(lead.soulId,frame.receipt.id);assert.ok(['waiting','started'].includes(r.phase),JSON.stringify(r));}
  const row=app.db.soul(other.soulId),owner=app.db.user(row.owner);
  assert.ok(app.host.engine.actorBorrowed(other.entityId),'actual native construction borrows the secondary crew member');
  assert.throws(()=>app.souls.pairCode(row,app.cfg.publicUrl,owner),e=>e.code==='native-cast.busy');
  assert.equal(app.db.soul(row.id).token_hash,null);
  for(let i=0;i<45000;i++){app.host.tickOnce();if(i%20===0)await setImmediate();const r=app.edge.receipt(lead.soulId,frame.receipt.id);if(!['started','waiting'].includes(r.phase)){assert.equal(r.phase,'completed',JSON.stringify(r));break;}if(i===44999)assert.fail('Frame did not finish');}
  app.host.drainInputs();await setImmediate();app.host.drainInputs();
  const decision={soulId:lead.soulId,entityId:lead.entityId,option:'native-take-down-frame',label:'Take down frame',steps:[{verb:'unbuild_lookout',params:{phase:'frame'}}],mood:'calm',reevalTicks:1200,fallback:false,trigger:'native-custody-fixture'};
  const before=app.host.seq,position=structuredClone(app.host.engine.world.entities[other.entityId].pose);
  // This is the private native enqueue entry used by reflex/mid choices. Its
  // synchronous authority preview is valid, then pairing changes before append.
  app.brain.enqueueDecision(lead,'brain:reflex',decision);
  assert.ok(app.host.queue.some(p=>p.kind==='decision'&&p.author==='brain:reflex'&&p.payload.option===decision.option),'real native choice was queued before pairing');
  const issued=app.souls.pairCode(row,app.cfg.publicUrl,owner);app.souls.pairExchange(issued.code,'scripted local fixture');
  app.host.drainInputs();await setImmediate();assert.equal(app.host.seq,before,'revoked native choice never enters accepted history');
  assert.deepEqual(app.host.engine.world.entities[other.entityId].pose,position);assert.equal(app.host.engine.programOf(lead.entityId),null);
  app.brain.enqueueDecision(lead,'brain:reflex',decision);app.host.drainInputs();await setImmediate();assert.equal(app.host.seq,before,'new native work refuses paired crew');
  app.brain.quiescing=false;
  const calls=app.db.brainCalls(1000).filter(c=>c.soulId===other.soulId).length;
  await app.brain.evaluate(other,'timer');await app.brain.reflect(other,1);await app.brain.attune(other);await app.brain.speak(other.soulId,lead.soulId,'greet');
  assert.equal(app.db.brainCalls(1000).filter(c=>c.soulId===other.soulId).length,calls);
  assert.equal(app.db.recentTalk(100).filter(c=>c.from===other.soulId).length,0);
  app.brain.quiesce();await app.brain.settled();app.host.drainInputs();
  assert.deepEqual(app.host.engine.runtime.violations,[]);assert.equal(app.db.events(app.host.worldId).filter(e=>e.kind==='rules'&&e.payload?.recovery).length,0);assert.equal(app.db.paidCost(),0);
  const expected={tick:app.host.engine.world.tick,head:app.host.seq,stateHash:app.host.engine.stateHash()};await app.close();app=null;
  const snapshot=await openWorldServer({...options,checkOnly:true});for(const k of Object.keys(expected))assert.equal(snapshot[k],expected[k]);
  const copy=join(dir,'genesis');mkdirSync(copy);const target=join(copy,'sim.db');
  copySqliteReadOnly(join(options.dataDir,'sim.db'),target);
  // Only this disposable copy drops checkpoints. Accepted events and the paired
  // token row remain, so genesis replay must ignore present native permissions.
  const clear=spawnSync('sqlite3',[target,'DELETE FROM snapshots'],{encoding:'utf8'});assert.equal(clear.status,0,clear.stderr);
  const genesis=await openWorldServer({...options,dataDir:copy,checkOnly:true});assert.equal(genesis.boot.from,'genesis');for(const k of Object.keys(expected))assert.equal(genesis[k],expected[k]);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('retired cast name reuse does not inherit native authority after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-native-roster-'));let app;
 try{
  const options={input,dataDir:dir,worldKey:'littlemartians',worldId:'littlemartians-1',port:4964};
  app=await openWorldServer(options);app.host.stop();app.brain.quiesce();
  const original=[...app.host.minds.values()].find(m=>m.name==='Verdelis'),owner=app.db.soul(original.soulId).owner;
  await accept(app,app.souls.retire(app.db.soul(original.soulId)));
  const replacement=await accept(app,app.souls.create(owner,{name:'Verdelis',description:'Synthetic same-name replacement; no native authorization.'}));
  const roster=app.db.rulesEvents(app.host.worldId).find(e=>e.payload?.nativeCastRosterV1).payload.nativeCastRosterV1;
  assert.ok(roster.cast.some(e=>e.soulId===original.soulId));assert.equal(roster.cast.some(e=>e.soulId===replacement.id),false);
  await app.close();app=null;
  app=await openWorldServer(options);app.host.stop();
  const next=app.host.minds.get(replacement.id),before=app.host.seq,calls=app.db.brainCalls(1000).filter(c=>c.soulId===next.soulId).length;
  await app.brain.evaluate(next,'timer');await app.brain.reflect(next,1);await app.brain.attune(next);app.host.drainInputs();await setImmediate();
  assert.equal(app.host.seq,before);assert.equal(app.db.brainCalls(1000).filter(c=>c.soulId===next.soulId).length,calls);
  assert.equal(app.db.rulesEvents(app.host.worldId).filter(e=>e.payload?.nativeCastRosterV1).length,1,'roster is durable and idempotent');
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
