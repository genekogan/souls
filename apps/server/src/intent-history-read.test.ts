import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTENT_V2,intentHistoryPageV1Schema,publicEvent } from '@souls/protocol';
import { intentNativeFixture } from '../test/intent-native-fixture.ts';
import { hashToken } from './auth.ts';
type F=ReturnType<typeof intentNativeFixture>;
const query=(f:F,cursor?:string,credential='dev:alice',agent=false)=>f.app.request((agent?'/v1/agent/intent-v2/history':'/v1/souls/s_A/intent-v2/history')+(cursor?'?cursor='+cursor:''),{headers:{authorization:'Bearer '+credential}});
async function page(f:F,cursor?:string,credential='dev:alice',agent=false){const r=await query(f,cursor,credential,agent);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');return intentHistoryPageV1Schema.parse(await r.json());}
async function drive<T>(f:F,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done);return p;}
async function publish(f:F,id:string){const r=await drive(f,f.post({contract:INTENT_V2,requestId:id,op:'upsert',words:'PRIVATE_WORDS make friends if you feel like it'}));assert.equal(r.status,202);await drive(f,f.service.settled());const receipt=await f.lookup(id);assert.equal(receipt.status,200);const revision=(await receipt.json() as any).revision;return {intentId:revision.intentId as string,version:revision.version as number};}
async function physical(f:F,ref:{intentId:string;version:number},x:number){
  f.mind.nextEvalTick=1e9;
  await drive(f,f.host.enqueueIntentDecision('fixture',{soulId:'s_A',entityId:'h_A',option:'native-test-walk',label:'Walk',
    steps:[{verb:'walk_to',params:{to:[x,-9],standoff:0}}],reevalTicks:1e9,trigger:'fixture',fallback:false},ref,()=>true));
  for(let i=0;i<300&&!Object.values(f.host.intentHistoryOf('s_A').attempts).some(a=>a.intent.intentId===ref.intentId&&a.phase==='completed');i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  assert.ok(Object.values(f.host.intentHistoryOf('s_A').attempts).some(a=>a.intent.intentId===ref.intentId&&a.phase==='completed'));
}

test('advertised private HTTP history contains actual admitted/start/completed facts while its broader purpose stays active',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true),ref=await publish(f,'actual');await physical(f,ref,15);
  const p=await page(f);assert.equal(p.state,'page');if(p.state!=='page')return;
  assert.deepEqual(p.events.map(e=>e.op==='outcome'?e.outcome.phase:e.op),['upsert','accepted','started','completed']);
  assert.equal(p.complete,true);assert.ok(p.resumeCursor);assert.equal(p.nextCursor,null);
  assert.equal(f.host.intentHistoryOf('s_A').intents[ref.intentId].status,'active');assert.ok(!p.events.some(e=>e.op==='resolve'));
  for(const e of p.events)assert.ok(f.db.events(f.host.worldId,e.seq-1,1).length===1);
  const dashboard=await f.app.request('/v1/souls/s_A',{headers:{authorization:'Bearer dev:alice'}});
  assert.equal((await dashboard.json() as any).control.intentHistoryContract,'private-intent-history/1');
  const credential='sim_FAKE_HISTORY_A';f.db.setSoulToken('s_A',hashToken(credential),'local');
  const perception=await f.app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+credential}});
  assert.equal(f.souls.lifecycle,undefined);assert.equal(perception.headers.get('cache-control'),'no-store');
  assert.equal((await perception.json() as any).intentHistory.contract,'private-intent-history/1');
  const agent=await page(f,undefined,credential,true);assert.equal(agent.state,'page');if(agent.state==='page')assert.deepEqual(agent.events,p.events);
  const absent=await f.app.request('/v1/agent/perceive');assert.equal(absent.status,404);assert.equal(absent.headers.get('cache-control'),'no-store');
  assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes('PRIVATE_WORDS'));
});

test('fixed-frontier pagination and resume separate later publications and bound both canonical scan and private events',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true);
  for(let i=0;i<18;i++){const ref=await publish(f,'purpose'+i);await physical(f,ref,i%2?16:15);}
  const first=await page(f);assert.equal(first.state,'page');if(first.state!=='page')return;
  assert.equal(first.events.length,50);assert.ok(first.nextCursor);const frontier=first.frontier;
  const later=await publish(f,'later');const collected=[...first.events];let p=first;
  while(p.nextCursor){const next=await page(f,p.nextCursor);assert.equal(next.state,'page');if(next.state!=='page')return;assert.deepEqual(next.frontier,frontier);collected.push(...next.events);p=next;}
  assert.equal(new Set(collected.map(e=>e.seq)).size,collected.length);assert.equal(collected.length,72);
  assert.ok(!collected.some(e=>e.op==='upsert'&&e.revision.intentId===later.intentId));
  const resumed=await page(f,p.resumeCursor!);assert.equal(resumed.state,'page');if(resumed.state==='page')assert.ok(resumed.events.some(e=>e.op==='upsert'&&e.revision.intentId===later.intentId));
  for(let i=0;i<205;i++){void f.host.enqueue('admin','fixture',{private:'UNRELATED_NOT_A_PURPOSE'});f.host.drainInputs();}
  const scanned=await page(f,resumed.state==='page'?resumed.resumeCursor!:undefined);assert.equal(scanned.state,'page');if(scanned.state==='page'){assert.equal(scanned.events.length,0);assert.equal(scanned.throughSeq-scanned.fromSeq,200);assert.equal(scanned.complete,false);assert.ok(scanned.nextCursor);}
  assert.equal(f.db.paidCost(),0);
});

test('current authority precedes cursor decode; scope/generation/expiry/query/corruption are explicit and private',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true);await publish(f,'private');const p=await page(f);assert.equal(p.state,'page');if(p.state!=='page')return;
  const cursor=p.resumeCursor!;
  f.db.db.prepare('UPDATE intent_history_cursors_v1 SET body=? WHERE cursor=?').run('{"BAD_PRIVATE_CURSOR":true}',cursor);
  const foreign=await query(f,cursor,'dev:bob');assert.equal(foreign.status,404);assert.ok(!(await foreign.text()).includes('BAD_PRIVATE'));
  const own=await query(f,cursor);assert.equal(own.status,503);assert.ok(!(await own.text()).includes('BAD_PRIVATE'));
  for(const path of ['?cursor=PRIVATE_BAD_QUERY','?owner=dev:bob','?worldId=OTHER_PRIVATE','?cursor='+cursor+'&extra=PRIVATE']){
    const r=await f.app.request('/v1/souls/s_A/intent-v2/history'+path,{headers:{authorization:'Bearer dev:alice'}});assert.equal(r.status,400);assert.ok(!(await r.text()).includes('PRIVATE'));
  }
  const token='sim_FAKE_HISTORY_ROTATION';f.db.setSoulToken('s_A',hashToken(token),'local');const agent=await page(f,undefined,token,true);assert.equal(agent.state,'page');if(agent.state!=='page')return;
  assert.equal((await query(f,agent.resumeCursor!)).status,404);
  const replacement='sim_FAKE_HISTORY_NEXT';f.db.setSoulToken('s_A',hashToken(replacement),'local');
  assert.equal((await query(f,agent.resumeCursor!,replacement,true)).status,404);assert.equal((await query(f,undefined,token,true)).status,401);
  const fresh=await page(f);if(fresh.state!=='page')throw new Error('unexpected gap');f.db.db.prepare('UPDATE intent_history_cursors_v1 SET expires_at=0 WHERE cursor=?').run(fresh.resumeCursor!);
  const expired=await query(f,fresh.resumeCursor!);assert.equal(expired.status,410);assert.equal((await expired.json() as any).code,'cursor-expired');
  const gap=await page(f);if(gap.state!=='page')throw new Error('unexpected gap');
  f.db.db.prepare('UPDATE events SET author=? WHERE world_id=? AND seq=?').run('changed-source',f.host.worldId,gap.frontier.seq);
  const changed=await page(f,gap.resumeCursor!);assert.equal(changed.state,'gap');if(changed.state==='gap')assert.equal(changed.reason,'source-changed');
});

test('missing prefix gives an explicit gap and unrelated malformed private payloads are not decoded or exposed',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true);await publish(f,'private');
  void f.host.enqueue('admin','fixture',{soulId:'s_foreign',words:'PRIVATE_FOREIGN'});f.host.drainInputs();
  f.db.db.prepare("UPDATE events SET kind='intent-v2',payload='PRIVATE_FOREIGN_INVALID_JSON' WHERE world_id=? AND seq=?").run(f.host.worldId,f.host.seq);
  const p=await page(f);assert.equal(p.state,'page');assert.ok(!JSON.stringify(p).includes('PRIVATE_FOREIGN'));
  f.db.db.exec('PRAGMA foreign_keys=OFF');f.db.db.prepare('DELETE FROM events WHERE world_id=? AND seq=1').run(f.host.worldId);
  const lost=await page(f);assert.equal(lost.state,'gap');if(lost.state==='gap'){assert.equal(lost.reason,'prefix-missing');assert.equal(lost.expectedSeq,1);assert.ok(!('events'in lost));}
});

test('default candidate has no history advertisement, route or cursor rows; enabled cursor survives exact native snapshot restart and is bounded',async t=>{
  const off=intentNativeFixture(t);assert.equal((await query(off)).status,404);assert.equal(off.service.ownerControl(off.service.ownerScope({userId:'dev:alice',expiresAt:Infinity},'s_A'))!.intentHistoryContract,undefined);
  assert.equal(off.db.db.prepare('SELECT COUNT(*) AS n FROM intent_history_cursors_v1').get()!.n,0);
  const dir=mkdtempSync(join(tmpdir(),'intent-history-cursor-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'world.db');
  const f=intentNativeFixture(t,path,true,true);await publish(f,'durable');f.mind.nextEvalTick=1e9;for(let i=0;i<37;i++)f.host.tickOnce();f.host.saveSnapshot();
  const p=await page(f);assert.equal(p.state,'page');if(p.state!=='page')return;const cursor=p.resumeCursor!;f.db.close();
  const next=intentNativeFixture(t,path,true,true),continued=await page(next,cursor);assert.equal(continued.state,'page');if(continued.state==='page')assert.deepEqual(continued.events,[]);
  for(let i=0;i<70;i++)assert.equal((await page(next)).state,'page');assert.equal(next.db.db.prepare('SELECT COUNT(*) AS n FROM intent_history_cursors_v1').get()!.n,64);
  assert.equal((await query(next,cursor)).status,404);assert.equal(next.db.paidCost(),0);
});

test('history retains original and edited versions plus explicit withdrawal without implying purpose fulfilment',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true),ref=await publish(f,'original');
  const edit=await drive(f,f.post({contract:INTENT_V2,requestId:'edit',op:'upsert',words:'PRIVATE_EDIT make friends if you feel like it',edit:{intentId:ref.intentId,expectedVersion:1}}));assert.equal(edit.status,202);await drive(f,f.service.settled());
  const withdrawal=await drive(f,f.post({contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:ref.intentId,expectedVersion:2}}));assert.equal(withdrawal.status,202);await drive(f,f.service.settled());
  const p=await page(f);assert.equal(p.state,'page');if(p.state!=='page')return;
  assert.deepEqual(p.events.map(e=>e.op),['upsert','upsert','withdraw']);
  assert.deepEqual(p.events.filter(e=>e.op==='upsert').map(e=>e.revision.version),[1,2]);
  assert.ok(!p.events.some(e=>e.op==='resolve'));assert.equal(f.host.intentHistoryOf('s_A').intents[ref.intentId].status,'withdrawn');assert.equal(f.db.paidCost(),0);
});

for(const fault of ['publication','controller'] as const)test(`owned ${fault} integrity failure is generic unavailable, never a private partial page`,async t=>{
  const f=intentNativeFixture(t,':memory:',true,true),ref=await publish(f,'evidence');await physical(f,ref,15);
  if(fault==='publication')f.db.db.prepare('UPDATE intent_request_events_v2 SET event_hash=? WHERE world_id=?').run('PRIVATE_BAD_HASH',f.host.worldId);
  else f.db.db.prepare('UPDATE intent_observations_v2 SET body_hash=? WHERE world_id=?').run('PRIVATE_BAD_HASH',f.host.worldId);
  const denied=await query(f);assert.equal(denied.status,503);assert.equal(denied.headers.get('cache-control'),'no-store');const body=await denied.text();assert.ok(!body.includes('PRIVATE'));assert.ok(!body.includes('events'));assert.equal(JSON.parse(body).code,'history-unavailable');
  assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM intent_history_cursors_v1').get()!.n,0);
});

test('HTTP final response rechecks retirement after a valid read and emits no private facts',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true);await publish(f,'last');const before=f.host.seq,read=f.service.historyPage.bind(f.service);
  t.mock.method(f.service,'historyPage',(...args:Parameters<typeof read>)=>{const p=read(...args);f.db.retireSoul('s_A');return p;});
  const r=await query(f);assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.text()).includes('PRIVATE_WORDS'));assert.equal(f.host.seq,before);
});
