// Explicit native seat release is a physical action, even while a sit timer runs.
// Own in-process fake0 fixture; no P0 data, service or browser is used.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory, seed } from '../test/native-owner-fixture.ts';
import { WorldHost } from './world.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import type { EdgeSoul } from './edge/contract.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { decodeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { MarsEngine } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { appearanceFromSeed, compactLook, lookKey } from '../../web/src/humanoid/look.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

async function setup(t: TestContext, dbPath = ':memory:') {
  const f = fixture(dbPath, factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 1) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle(3);
  const souls: EdgeSoul[] = [];
  for (const name of ['Mira', 'Noor']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create('dev:' + name.toLowerCase(), { name, description: 'native stand control' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle(3);
  const placed = god.act({ ops: [{ op: 'place', def: coreRef('chair'), name: 'seat', p: [5, 5] }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await settle(3);
  const seat = god.model.get('seat')!.id;
  const graph = () => decodeSnapshot((f.host.engine.snapshot() as unknown as {mars: Parameters<typeof decodeSnapshot>[0]}).mars);
  assert.ok(f.host.engine instanceof MarsEngine);
  const holds = (actor: string) => graph().records.filter(r => ['sit', 'take_slot'].includes(r.verb) && (r.params as {actor?:string}).actor === actor && graph().live.some(x => x.id === r.id));
  const until = async (pred: () => boolean, max = 1500) => { for (let i = 0; i < max && !pred(); i++) await settle(); assert.ok(pred(), 'bounded native progress'); };
  const sit = async (seconds = 600, explicit = false) => {
    const [soul] = souls;
    const out = await accept(f.host, explicit
      ? edge.performBodies(soul, 'sit:' + seat, 'Sit by explicit slot', [{ verb: 'mars:sit', params: {slot: seat + '#seat'} }, {verb: 'rest', params: {seconds}}])
      : edge.act(soul, { capability: 'sit:' + seat, params: {seconds} }));
    assert.equal(out.accepted, true, JSON.stringify(out));
    if (!out.accepted) throw Error('sit refused');
    await until(() => f.host.engine.world.entities[soul.entityId].human?.activity === 'sit');
    return {receipt: out.receipt, hold: holds(soul.entityId)[0]};
  };
  return { ...f, god, edge, settle, souls, seat, graph, holds, until, sit };
}

test('one stand during active native sit timer stays tracked until original seat is actually released', async t => {
  const w = await setup(t), [soul, other] = w.souls;
  const seated = await w.sit();
  assert.ok(w.host.engine.programOf(soul.entityId), 'finite timer is still running');
  assert.ok(seated.hold, 'actual native fixture-param hold');
  assert.equal((seated.hold.params as {fixture?:string}).fixture, w.seat);
  const otherBefore = JSON.stringify(w.host.engine.world.entities[other.entityId]);
  const out = await accept(w.host, w.edge.act(soul, {capability: 'stand:here', clientRef: 'one-stand'}));
  assert.equal(out.accepted, true, JSON.stringify(out));
  if (!out.accepted) return;
  assert.notEqual(out.receipt.phase, 'completed', 'command acceptance is not physical stand completion');
  assert.ok(out.receipt.programId, 'strict stand has its own tracked programme');
  let sawDeferred = false;
  await w.until(() => {
    const r = w.edge.receipt(soul.soulId, out.receipt.id)!;
    const h = w.host.engine.world.entities[soul.entityId].human!;
    if (h.activity === 'stand-up') { sawDeferred = true; assert.notEqual(r.phase, 'completed'); assert.equal(w.holds(soul.entityId)[0]?.id, seated.hold.id); assert.equal(w.host.engine.standingSupportProblemV1?.(soul.entityId,[{action:seated.hold.id,slot:w.seat+'#seat'}])?.code,'stand.unsupported'); }
    return r.phase === 'completed';
  });
  assert.ok(sawDeferred);
  assert.equal(w.host.engine.world.entities[soul.entityId].human?.activity, 'idle');
  assert.deepEqual(w.holds(soul.entityId), []);
  assert.equal(w.graph().owners.some(([resource]) => resource === 'slot:' + w.seat + '#seat'), false);
  assert.equal(JSON.stringify(w.host.engine.world.entities[other.entityId]), otherBefore);
  assert.equal(w.db.soul(soul.soulId)?.entity_id, soul.entityId);
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('explicit-slot seat after its timer ends releases once; duplicate clientRef and old receipts stay immutable', async t => {
  const w = await setup(t), [soul] = w.souls;
  const seated = await w.sit(1, true);
  assert.equal((seated.hold.params as {slot?:string}).slot, w.seat + '#seat');
  await w.until(() => w.edge.receipt(soul.soulId, seated.receipt.id)?.phase === 'completed');
  const historical = w.edge.receipt(soul.soulId, seated.receipt.id)!;
  assert.equal(w.host.engine.programOf(soul.entityId), null);
  const out = await accept(w.host, w.edge.act(soul, {capability: 'stand:here', clientRef: 'expired-stand'}));
  assert.equal(out.accepted, true);
  if (!out.accepted) return;
  assert.notEqual(out.receipt.phase, 'completed');
  const again = await w.edge.act(soul, {capability: 'stand:here', clientRef: 'expired-stand'});
  assert.equal(again.accepted, true);
  if (again.accepted) assert.equal(again.receipt.id, out.receipt.id);
  await w.until(() => w.edge.receipt(soul.soulId, out.receipt.id)?.phase === 'completed');
  const terminal = w.edge.receipt(soul.soulId, out.receipt.id)!;
  assert.equal(terminal.endedAt && (terminal.endedAt as {posture?: string}).posture, 'standing');
  assert.deepEqual(w.holds(soul.entityId), []);
  assert.deepEqual(w.edge.receipt(soul.soulId, seated.receipt.id), historical);
  const repeat = await w.edge.act(soul, {capability: 'stand:here', clientRef: 'expired-stand'});
  if (repeat.accepted) assert.deepEqual(repeat.receipt, terminal);
  assert.equal(w.graph().records.filter(r => r.verb === 'stand' && (r.params as {actor?:string}).actor === soul.entityId).length, 1);
  w.host.drainInputs();w.host.saveSnapshot(true);
  const head={engine:w.host.engine.stateHash(),kernel:kernelHash(w.host.kernel)};
  w.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.host.worldId);
  const replay=new WorldHost(w.db,factory,seed,1e9,w.host.worldId,{durableClockV1:true});t.after(()=>replay.stop());
  assert.equal(replay.boot().from,'genesis');
  assert.deepEqual({engine:replay.engine.stateHash(),kernel:kernelHash(replay.kernel)},head,'accepted versioned stand recipe replays exactly');
});

test('blocked exit retains original claims and open receipt until the independent blocker walks away', async t => {
  const w = await setup(t), [soul, blocker] = w.souls;
  const seated = await w.sit();
  const seatExec = w.graph().live.find(x => x.id === seated.hold.id)!.exec as {approach: [number, number]};
  const [x,z] = seatExec.approach;
  const walk = await accept(w.host, w.edge.performBodies(blocker, 'walk:exit-control', 'Walk to the seat exit', [{verb:'mars:walk_to',params:{x,z,level:0}}]));
  assert.equal(walk.accepted, true, JSON.stringify(walk));
  if (!walk.accepted) return;
  await w.until(() => w.edge.receipt(blocker.soulId, walk.receipt.id)?.phase === 'completed');
  const blockerBefore = JSON.stringify(w.host.engine.world.entities[blocker.entityId]);
  const stop = await accept(w.host, w.edge.act(soul, {capability:'stand:here'}));
  assert.equal(stop.accepted, true, JSON.stringify(stop));
  if (!stop.accepted) return;
  await w.settle(35);
  assert.ok(['waiting','started'].includes(w.edge.receipt(soul.soulId, stop.receipt.id)!.phase));
  assert.equal(w.holds(soul.entityId)[0]?.id, seated.hold.id);
  assert.equal(w.graph().live.find(x => x.id === seated.hold.id)?.cancelling, true);
  assert.equal(JSON.stringify(w.host.engine.world.entities[blocker.entityId]), blockerBefore);
  assert.deepEqual(w.host.engine.runtime.violations, []);
  const progress=(w.graph().live.find(x=>x.id===seated.hold.id)!.exec as {t:number}).t;
  const replacement=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(replacement.accepted,true,JSON.stringify(replacement));
  if(!replacement.accepted)return;
  assert.notEqual(replacement.receipt.phase,'completed');
  await w.settle(5);
  assert.equal((w.graph().live.find(x=>x.id===seated.hold.id)!.exec as {t:number}).t,progress,'repeat stand does not reset native blocked exit');
  assert.equal(w.holds(soul.entityId)[0]?.id,seated.hold.id);
  const away = await accept(w.host, w.edge.performBodies(blocker, 'walk:away-control', 'Walk away from exit', [{verb:'mars:walk_to',params:{x:x+2,z:z+2,level:0}}]));
  assert.equal(away.accepted, true, JSON.stringify(away));
  await w.until(() => w.edge.receipt(soul.soulId, replacement.receipt.id)?.phase === 'completed');
  assert.deepEqual(w.holds(soul.entityId), []);
  assert.equal(w.host.engine.world.entities[soul.entityId].human?.activity, 'idle');
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('versioned stand cannot transfer a foreign or stale seat; explicit take_slot seat is supported', async t => {
  const w=await setup(t),[soul,other]=w.souls;
  const rest=await accept(w.host,w.edge.performBodies(other,'rest:other-control','Independent timer',[{verb:'rest',params:{seconds:600}}]));assert.equal(rest.accepted,true);
  const otherProgram=w.host.engine.programOf(other.entityId);
  const seated=await w.sit(),before=w.host.engine.stateHash();
  for(const [actor,action] of [[other.entityId,seated.hold.id],[soul.entityId,'missing-action']] as const){
    const issue=w.host.engine.canPerform({actor,label:'Foreign seat release negative',steps:[{verb:'stand',params:{nativeSeatReleaseV1:action}}]});
    assert.equal(issue?.code,'stand.seat-claim-changed');assert.equal(w.host.engine.stateHash(),before);
  }
  const refused=w.host.engine.perform({actor:other.entityId,label:'Foreign seat release negative',steps:[{verb:'stand',params:{nativeSeatReleaseV1:seated.hold.id}}]});
  assert.equal(refused.ok,false);assert.equal(w.host.engine.programOf(other.entityId),otherProgram);
  assert.equal(w.holds(soul.entityId)[0]?.id,seated.hold.id,'refusal leaves the original actor seat intact');
  const stop=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(stop.accepted,true);if(!stop.accepted)return;
  await w.until(()=>w.edge.receipt(soul.soulId,stop.receipt.id)?.phase==='completed');
  const taken=await accept(w.host,w.edge.performBodies(soul,'sit:take-slot-control','Use explicit seat slot',[{verb:'mars:take_slot',params:{slot:w.seat+'#seat'}},{verb:'rest',params:{seconds:600}}]));assert.equal(taken.accepted,true,JSON.stringify(taken));
  await w.until(()=>w.holds(soul.entityId).some(r=>r.verb==='take_slot'&&r.phase==='occupied'));
  const release=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(release.accepted,true);if(!release.accepted)return;
  await w.until(()=>w.edge.receipt(soul.soulId,release.receipt.id)?.phase==='completed');
  assert.deepEqual(w.holds(soul.entityId),[]);
  assert.equal(w.host.engine.programOf(other.entityId),otherProgram,'owned seat release preserves the independent actor timer');
});

// A tall composed body (height 1.85: not HUMAN_PROFILE; radius 0.288 before the lane N1 cap, now 0.28). The skip this test carried ("upstairs route
// unreachable", blamed on stairs reach) was its own build 1.08: radius 0.311 plans at 0.371 m, and building/1's 0.9 m
// interior doors give only 0.35 m of raster clearance (the stairs themselves were fine; see L3 status, FOR GENE).
test('elevated-floor exit uses its admitted height and a composed humanoid profile', async t => {
  const w=await setup(t),[soul]=w.souls;
  assert.ok(w.host.engine instanceof MarsEngine);
  const look={...appearanceFromSeed(7),height:1.85,build:1};
  assert.equal(w.host.engine.assignBodyV1(soul.entityId,{family:'humanoid',model:lookKey(look),params:compactLook(look)}),true);
  const r=w.god.act({ops:[
    {op:'define',def:{schema:'def/1',name:'stand-house',version:1,tags:['building'],size:{box:[8,6,6]},make:{kind:'gen',gen:'building/1'},params:{floors:{type:'int',min:1,max:6,default:2}},state:{doors:{type:'json',default:{}}},components:{foundation:{kind:'none'}}}},
    // Use the already-supported upstairs bridge-test layout for this precondition.
    {op:'place',tmp:'$h',def:'stand-house@1',name:'house',p:[10,0]},
    {op:'place',def:coreRef('chair'),name:'upper-seat',in:{parent:'$h',slot:'floor-1'},p:[-2,0,1]},
  ]});assert.equal(r.accepted,true,JSON.stringify(r));await w.settle(4);
  const seat=w.god.model.get('house/upper-seat')!.id;
  const sit=await accept(w.host,w.edge.act(soul,{capability:'sit:'+seat,params:{seconds:600}}));assert.equal(sit.accepted,true,JSON.stringify(sit));
  try { await w.until(()=>w.host.engine.world.entities[soul.entityId].human?.activity==='sit',3000); }
  catch { assert.fail(JSON.stringify({precondition:'composed upstairs native sit',receipt:sit.accepted?w.edge.receipt(soul.soulId,sit.receipt.id):sit,body:w.host.engine.world.entities[soul.entityId],holds:w.holds(soul.entityId)})); }
  assert.equal(w.host.engine.world.entities[soul.entityId].human?.level,1);
  const y=w.host.engine.world.entities[soul.entityId].pose.p[1];assert.ok(y>2);
  const stop=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(stop.accepted,true,JSON.stringify(stop));if(!stop.accepted)return;
  await w.until(()=>w.edge.receipt(soul.soulId,stop.receipt.id)?.phase==='completed');
  assert.equal(w.host.engine.world.entities[soul.entityId].pose.p[1],y);
  assert.equal(w.host.engine.standingSupportProblemV1(soul.entityId),null);
  assert.deepEqual(w.host.engine.runtime.violations,[]);
});

test('identity drift during exit fails its receipt instead of certifying another binding', async t => {
  const w=await setup(t),[soul]=w.souls;await w.sit();
  const stop=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(stop.accepted,true);if(!stop.accepted)return;
  // Deliberate own-fixture authority fault; no body movement is injected.
  w.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('dev:changed-owner',soul.soulId);
  await w.until(()=>!['waiting','started'].includes(w.edge.receipt(soul.soulId,stop.receipt.id)!.phase));
  assert.equal(w.edge.receipt(soul.soulId,stop.receipt.id)?.phase,'failed');
  assert.equal(w.edge.receipt(soul.soulId,stop.receipt.id)?.code,'stand.identity-changed');
});

test('modern floater high-level stand/no-op retains its body and never adopts humanoid strict recipe', async t => {
  const w=await setup(t),[soul]=w.souls;assert.ok(w.host.engine instanceof MarsEngine);
  const body={family:'floater' as const,type:'ceramic' as const,model:'verdelis',modelUrl:'/world-assets/littlemartians/characters/verdelis.glb',radius:.35,hoverHeight:1.45};
  assert.equal(w.host.engine.assignBodyV1(soul.entityId,body),true);
  const out=await w.edge.act(soul,{capability:'stand:here'});assert.equal(out.accepted,true,JSON.stringify(out));
  assert.deepEqual(w.host.engine.world.entities[soul.entityId].body,body);
  const typed=w.host.engine.canPerform({actor:soul.entityId,label:'Unsupported humanoid release',steps:[{verb:'stand',params:{nativeSeatReleaseV1:'foreign'}}]});assert.equal(typed?.code,'stand.seat-claim-changed');
});

test('native stand refusal is strict; already standing no-op and refusal leave other body untouched', async t => {
  const w = await setup(t), [soul, other] = w.souls;
  const before = JSON.stringify(w.host.engine.world.entities[soul.entityId]);
  const otherBefore = JSON.stringify(w.host.engine.world.entities[other.entityId]);
  const out = await accept(w.host, w.edge.performBodies(soul, 'stand:strict-control', 'Strict stand with no seat', [{verb:'mars:stand',params:{}}]));
  assert.equal(out.accepted, false, JSON.stringify(out));
  assert.equal((out as {code?:string}).code, 'social.not-seated');
  assert.equal(JSON.stringify(w.host.engine.world.entities[soul.entityId]), before);
  const noop = await w.edge.act(soul, {capability:'stand:here'});
  assert.equal(noop.accepted, true);
  if (noop.accepted) assert.equal(noop.receipt.phase, 'completed');
  assert.equal(JSON.stringify(w.host.engine.world.entities[other.entityId]), otherBefore);
});

test('stand interrupts a real approach and sit-down safely with no remaining original claim', async t => {
  for (const phase of ['approach','sit-down']) {
    const w = await setup(t), [soul] = w.souls;
    const sit = await accept(w.host, w.edge.act(soul, {capability:'sit:'+w.seat,params:{seconds:600}}));
    assert.equal(sit.accepted, true);
    await w.until(() => w.holds(soul.entityId).some(r => r.phase === phase));
    const original = w.holds(soul.entityId)[0].id;
    const stop = await accept(w.host, w.edge.act(soul, {capability:'stand:here'}));
    assert.equal(stop.accepted, true, JSON.stringify(stop));
    if (!stop.accepted) return;
    await w.until(() => w.edge.receipt(soul.soulId,stop.receipt.id)?.phase === 'completed');
    assert.equal(w.host.engine.runtime.liveIds().includes(original), false);
    assert.deepEqual(w.holds(soul.entityId), []);
    assert.equal(w.host.engine.world.entities[soul.entityId].human?.activity,'idle');
    assert.deepEqual(w.host.engine.runtime.violations, []);
  }
});

test('mid-exit snapshot and a fresh Node process preserve claims, identity and receipt completion', async t => {
  const dir=mkdtempSync(join(tmpdir(),'native-stand-cold-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const w=await setup(t,join(dir,'sim.db')),[soul]=w.souls,seated=await w.sit();
  const stop=await accept(w.host,w.edge.act(soul,{capability:'stand:here'}));assert.equal(stop.accepted,true);
  if(!stop.accepted)return;
  await w.until(()=>w.host.engine.world.entities[soul.entityId].human?.activity==='stand-up');
  assert.equal(w.holds(soul.entityId)[0]?.id,seated.hold.id);
  w.host.drainInputs();w.host.saveSnapshot(true);w.host.stop();
  const input={db:join(dir,'sim.db'),worldId:w.host.worldId,soul,receipt:stop.receipt.id,original:seated.hold.id,head:w.host.engine.stateHash()};
  writeFileSync(join(dir,'input.json'),JSON.stringify(input));
  // the child imports by absolute URL: the suite runs from apps/server (Modal V5), a lane may run it from the repo root
  const SERVER=new URL('../',import.meta.url).href;
  const source=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {setImmediate} from 'node:timers/promises';import {Db} from '${SERVER}src/db.ts';import {WorldHost} from '${SERVER}src/world.ts';import {EdgeLedger} from '${SERVER}src/edge/ledger/ledger.ts';import {factory,seed} from '${SERVER}test/native-owner-fixture.ts';const p=JSON.parse(readFileSync(process.argv[1],'utf8')),db=new Db(p.db),host=new WorldHost(db,factory,seed,1e9,p.worldId,{durableClockV1:true});try{assert.equal(host.boot().from,'snapshot');assert.equal(host.engine.stateHash(),p.head);const edge=new EdgeLedger(host,db);assert.equal(host.engine.nativeSeatHoldsV1(p.soul.entityId)[0].action,p.original);assert.equal(host.engine.world.entities[p.soul.entityId].human.activity,'stand-up');for(let i=0;i<100&&edge.receipt(p.soul.soulId,p.receipt).phase!=='completed';i++){host.tickOnce();await setImmediate();host.drainInputs();}assert.equal(edge.receipt(p.soul.soulId,p.receipt).phase,'completed');assert.deepEqual(host.engine.nativeSeatHoldsV1(p.soul.entityId),[]);assert.equal(host.engine.standingSupportProblemV1(p.soul.entityId),null);assert.equal(db.soul(p.soul.soulId).entity_id,p.soul.entityId);console.log(JSON.stringify({from:'snapshot',original:p.original,completed:true,identity:true}));}finally{host.stop();db.close();}`;
  const result=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','--eval',source,join(dir,'input.json')],{cwd:process.cwd(),env:{PATH:process.env.PATH},encoding:'utf8',timeout:15000});
  // L5 (srv-boot item 1): boot now prints its `[boot] <phase>` lines on stdout, so the child's verdict is its last line
  assert.equal(JSON.parse(result.trim().split('\n').at(-1)!).completed,true);
});
