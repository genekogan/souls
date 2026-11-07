import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsFactory } from '@souls/engine-mars';
import { toyFactory } from '@souls/engine-toy';
import type { Engine, EngineFactory } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { publicEvent } from '@souls/protocol';
import { Db } from './db.ts';
import { WorldHost, replayFromGenesis, replayKernel } from './world.ts';
import { initKernel } from './fold.ts';
import { optionsFor } from './deck.ts';

// A deterministic adapter fault at execution, not a graceful feasibility refusal.
function faultyFactory(): EngineFactory {
  const wrap=(e:Engine) => { let armed=false; const perform=e.perform.bind(e), step=e.step.bind(e);
    e.perform=p=>{if(p.label==='bad test') armed=true; return perform(p);};
    e.step=()=>{if(armed) throw new Error('fixture.bad-card'); return step();}; return e; };
  return {...toyFactory,create:w=>wrap(toyFactory.create(w)),restore:s=>wrap(toyFactory.restore(s))};
}
test('fault restores checkpoint and filtered log; three faults quarantine; restart and both replay paths agree',()=>{
  const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-recovery-')),'sim.db')), factory=faultyFactory();
  const h=new WorldHost(db,factory,'recovery',1e9); h.boot();
  void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'private-owner'}); h.tickOnce(); h.saveSnapshot();
  for(let fault=1;fault<=3;fault++) {
    void h.enqueue('decision','test',{soulId:'s_A',entityId:'h_A',option:'rest',card:'rest',label:'bad test',steps:[{verb:'rest',params:{seconds:60}}],target:null,approachLen:0,reevalTicks:1200,trigger:'test',fallback:true});
    h.tickOnce(); assert.equal((h.extra.cardFaults as any).rest,fault); assert.equal(h.engine.runtime.violations.length,0);
    assert.ok(!optionsFor(h,h.minds.get('s_A')!).some(o=>o.card==='rest'),'faulty card withheld while choosing again');
    for(let i=0;i<1201;i++) h.tickOnce();
  }
  assert.ok(!optionsFor(h,h.minds.get('s_A')!).some(o=>o.card==='rest'),'third fault persists quarantine');
  void h.enqueue('rules','test',{checkpoint:'exact tick'}); h.drainInputs();
  const events=db.events(h.worldId), replay=replayFromGenesis(factory,'recovery',events,h.engine.world.tick), k=replayKernel(initKernel(factory.create(factory.genesis('recovery'))),events);
  assert.equal(replay.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(replay.kernel),kernelHash(h.kernel)); assert.equal(kernelHash(k),kernelHash(h.kernel));
  const next=new WorldHost(db,factory,'recovery',1e9); next.boot(); assert.equal(next.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(next.kernel),kernelHash(h.kernel)); assert.deepEqual(next.extra.cardFaults,h.extra.cardFaults);
  const repair=events.filter(e=>e.payload?.recovery).at(-1)!; assert.ok(JSON.stringify(repair).includes('private-owner')); assert.ok(!JSON.stringify(publicEvent(repair)).includes('private-owner')); assert.ok(!JSON.stringify(publicEvent(repair)).includes('baseline'));
  db.close();
});

test('historical Mars invariant receipts survive restart without being treated as fresh faults',async()=>{
 const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-old-receipts-')),'sim.db')),factory=await marsFactory();
 const h=new WorldHost(db,factory,'historic',1e9);h.boot();
 void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'test'});h.tickOnce();
 h.engine.runtime.violations.push({tick:0,code:'historic.receipt',message:'A previously recorded violation, already resolved'});h.saveSnapshot();
 const fresh=new WorldHost(db,factory,'historic',1e9);fresh.boot();assert.equal(fresh.engine.runtime.violations.length,1);fresh.tickOnce();
 assert.equal(fresh.engine.runtime.violations.length,1);assert.equal(db.events(h.worldId).filter(e=>e.payload?.recovery).length,0);db.close();
});

test('repeated faults between snapshots never nest recovery recipes; boot and readers skip the recipe bodies',()=>{
  const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-recovery-nest-')),'sim.db')), factory=faultyFactory();
  const h=new WorldHost(db,factory,'nest',1e9); h.boot();
  void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'private-owner'}); h.tickOnce(); h.saveSnapshot();
  const preFix=db.db.prepare('SELECT * FROM snapshots WHERE world_id=? ORDER BY tick DESC LIMIT 1').get(h.worldId) as Record<string,any>;
  const sizes:number[]=[];
  for(let fault=1;fault<=5;fault++) {
    void h.enqueue('decision','test',{soulId:'s_A',entityId:'h_A',option:'rest',card:`rest-${fault}`,label:'bad test',steps:[{verb:'rest',params:{seconds:60}}],target:null,approachLen:0,reevalTicks:1200,trigger:'test',fallback:true});
    h.tickOnce();
    const repair=db.tailEvents(h.worldId,5).filter(e=>e.payload?.recovery).at(-1)!;
    assert.ok(!repair.payload.recovery.events.some((e:any)=>e.payload?.recovery),`recipe ${fault} carries no earlier recipe`);
    sizes.push(JSON.stringify(repair.payload).length);
    for(let i=0;i<3;i++) h.tickOnce();
  }
  assert.ok(Math.max(...sizes) < 2*Math.min(...sizes), `recipe sizes stay flat: ${sizes}`);
  const light=db.tailEvents(h.worldId,40,true).filter(e=>e.payload?.recovery);
  assert.equal(light.length,5); for (const e of light) { assert.deepEqual(Object.keys(e.payload.recovery).sort(),['excluded','faults']); assert.equal(e.payload.recovery.excluded.length,1); }
  assert.deepEqual(db.tailEvents(h.worldId,40,true).map(e=>publicEvent(e)),db.tailEvents(h.worldId,40).map(e=>publicEvent(e)));
  assert.ok(db.hasVocabulary(h.worldId));
  void h.enqueue('rules','test',{checkpoint:'exact tick'}); h.drainInputs();
  const events=db.events(h.worldId), replay=replayFromGenesis(factory,'nest',events,h.engine.world.tick);
  assert.equal(replay.engine.stateHash(),h.engine.stateHash());
  const next=new WorldHost(db,factory,'nest',1e9); next.boot(); assert.equal(next.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(next.kernel),kernelHash(h.kernel));
  const lastRepair=db.lastRecoverySeq(h.worldId,0)!; assert.ok(db.latestSnapshot(h.worldId)!.seq>=lastRepair,'a snapshot follows the last recovery');
  const after=new WorldHost(db,factory,'nest',1e9); after.boot(); assert.equal(after.engine.stateHash(),h.engine.stateHash()); assert.equal(kernelHash(after.kernel),kernelHash(h.kernel));
  // A log written before this fix: no snapshot after the recoveries. The boot replays the last one and rebaselines there.
  const firstRepair=db.events(h.worldId).find(e=>e.payload?.recovery)!.seq;
  db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);
  db.db.prepare(`INSERT INTO snapshots (${Object.keys(preFix)}) VALUES (${Object.keys(preFix).map(()=>'?')})`).run(...Object.values(preFix)); assert.ok(db.latestSnapshot(h.worldId)!.seq<firstRepair);
  const old=new WorldHost(db,factory,'nest',1e9); old.boot(); assert.equal(old.engine.stateHash(),h.engine.stateHash());
  void old.enqueue('decision','test',{soulId:'s_A',entityId:'h_A',option:'rest',card:'rest-6',label:'bad test',steps:[{verb:'rest',params:{seconds:60}}],target:null,approachLen:0,reevalTicks:1200,trigger:'test',fallback:true});
  old.tickOnce();
  const sixth=db.tailEvents(h.worldId,5).filter(e=>e.payload?.recovery).at(-1)!; assert.ok(sixth.seq>lastRepair);
  assert.ok(!sixth.payload.recovery.events.some((e:any)=>e.payload?.recovery),'a recovery after such a boot carries no earlier recipe');
  db.close();
});

test('a legacy nested recovery chain boots in one linear replay, to the same head as its flat equivalent',()=>{
  let steps=0;
  const counting=(e:Engine)=>{ const step=e.step.bind(e); e.step=()=>{steps++; return step();}; return e; };
  const factory:EngineFactory={...toyFactory,create:w=>counting(toyFactory.create(w)),restore:s=>counting(toyFactory.restore(s))};
  const span=50, levels=5;
  // Recipes as recoverFault logged them before they stopped nesting (eden-2026 seq 828..835): each carries the
  // baseline body and every event since it, the earlier recipes included.
  const world=(nest:boolean)=>{
    const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-recovery-legacy-')),'sim.db'));
    const h=new WorldHost(db,factory,'legacy',1e9); h.boot();
    void h.enqueue('birth','test',{soulId:'s_A',entityId:'h_A',name:'A',description:'quiet',owner:'private-owner'}); h.tickOnce(); h.saveSnapshot();
    const snap=db.latestSnapshot(h.worldId)!, baseline=snap.body, since:any[]=[]; let seq=h.seq;
    const ins=db.db.prepare('INSERT INTO events (world_id, seq, tick, kind, author, payload, at) VALUES (?,?,?,?,?,?,?)');
    for(let k=1;k<=levels;k++){
      const recipe={baseline,events:nest?[...since]:[],untilTick:snap.tick+k*span,faults:{},excluded:[],reason:'legacy nested recovery'};
      const e={seq:++seq,tick:recipe.untilTick,kind:'rules',author:'world:recovery',payload:{recovery:recipe},at:Date.now()};
      if(nest||k===levels) ins.run(h.worldId,e.seq,e.tick,e.kind,e.author,JSON.stringify(e.payload),e.at);
      since.push(e);
    }
    return db;
  };
  const flatDb=world(false), nestDb=world(true);
  steps=0; const flat=new WorldHost(flatDb,factory,'legacy',1e9); flat.boot(); const flatSteps=steps;
  steps=0; const nested=new WorldHost(nestDb,factory,'legacy',1e9); nested.boot();
  assert.equal(flatSteps,levels*span);
  assert.equal(steps,levels*span,`nested chain steps once per tick, not once per level (2^${levels}): ${steps}`);
  assert.equal(nested.engine.stateHash(),flat.engine.stateHash()); assert.equal(kernelHash(nested.kernel),kernelHash(flat.kernel));
  flatDb.close(); nestDb.close();
});


test('skipping a superseded recovery prefix preserves its original violation ceiling',()=>{
  const factory:EngineFactory={...toyFactory,restore:s=>{
    const e=toyFactory.restore(s);
    if((s as any).testHistoricViolation)e.runtime.violations.push({rule:'fixture.historic',message:'fixture'} as any);
    return e;
  }};
  const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-recovery-ceiling-')),'sim.db'));
  const h=new WorldHost(db,factory,'ceiling',1e9); h.boot(); h.saveSnapshot();
  const snap=db.latestSnapshot(h.worldId)!, baseline=snap.body as any;
  const innerBody=structuredClone(baseline); innerBody.runtime.testHistoricViolation=true;
  const inner={baseline:innerBody,events:[],untilTick:snap.tick,faults:{},excluded:[],reason:'fixture'};
  const event={seq:h.seq+1,tick:snap.tick,kind:'rules',author:'world:recovery',payload:{recovery:inner},at:Date.now()};
  const outer={...inner,baseline,events:[event]};
  db.db.prepare('INSERT INTO events (world_id,seq,tick,kind,author,payload,at) VALUES (?,?,?,?,?,?,?)')
    .run(h.worldId,h.seq+2,snap.tick,'rules','world:recovery',JSON.stringify({recovery:outer}),Date.now());
  assert.throws(()=>new WorldHost(db,factory,'ceiling',1e9).boot(),/recovery replay still violates/);
  db.close();
});

test('a recovery replay that still violates names the new violation and the original fault (#509)',()=>{
  const factory:EngineFactory={...toyFactory,restore:s=>{
    const e=toyFactory.restore(s);
    if((s as any).testReplayViolation)e.runtime.violations.push({code:'collision.human-human',message:'a and b overlap (0.30 m apart)',subjects:['a','b'],tick:7} as any);
    return e;
  }};
  const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-recovery-cause-')),'sim.db'));
  const h=new WorldHost(db,factory,'cause',1e9); h.boot(); h.saveSnapshot();
  const snap=db.latestSnapshot(h.worldId)!, baseline=snap.body as any;
  const innerBody=structuredClone(baseline); innerBody.runtime.testReplayViolation=true;
  const inner={baseline:innerBody,events:[],untilTick:snap.tick,faults:{},excluded:[],reason:'inner'};
  const event={seq:h.seq+1,tick:snap.tick,kind:'rules',author:'world:recovery',payload:{recovery:inner},at:Date.now()};
  const outer={...inner,baseline,events:[event],reason:'Error: [{"code":"collision.human-human","subjects":["c","d"]}]'};
  db.db.prepare('INSERT INTO events (world_id,seq,tick,kind,author,payload,at) VALUES (?,?,?,?,?,?,?)')
    .run(h.worldId,h.seq+2,snap.tick,'rules','world:recovery',JSON.stringify({recovery:outer}),Date.now());
  assert.throws(()=>new WorldHost(db,factory,'cause',1e9).boot(),(error:Error)=>{
    assert.match(error.message,/^recovery replay still violates the engine: collision\.human-human \[a, b\] at tick 7: a and b overlap/);
    assert.match(error.message,/original fault: Error: \[\{"code":"collision\.human-human","subjects":\["c","d"\]\}\]$/);
    assert.equal(error.cause,outer.reason);
    return true;
  });
  db.close();
});
