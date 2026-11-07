import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {toyFactory} from '@souls/engine-toy';
import {marsFactory} from '@souls/engine-mars';
import type {EngineFactory} from '@souls/engine-contract';
import {kernelHash,validateCard,applyAll,sweep} from '@souls/kernel';
import {publicEvent,steerReceiptSchema,ownerSoulDashboardSchema,type MandateRule} from '@souls/protocol';
import {newLife,compileUser} from '@souls/brain';
import {Db} from './db.ts';
import {WorldHost,replayKernel} from './world.ts';
import {Brain} from './brain.ts';
import {Souls} from './souls.ts';
import {config} from './config.ts';
import {mandateOf,explicitTrigger,triggerDue} from './mandate.ts';

function fixture(factory:EngineFactory=toyFactory){
 const db=new Db(':memory:'),host=new WorldHost(db,factory,'rules',1e9,'toy-1');host.boot();
 const genesis=structuredClone(host.kernel);
 for(const name of ['Alice','Bill']){db.createSoul({id:`s_${name}`,entityId:`h_${name}`,worldId:host.worldId,owner:'owner',name,description:'curious',native:false});void host.enqueue('birth','test',{soulId:`s_${name}`,entityId:`h_${name}`,owner:'owner',name,description:'curious'});}
 host.tickOnce();host.extra.living={origin:0,dayTicks:72000,customs:[],lastDay:0,event:'day',quiet:false};
 for(const m of host.minds.values()){m.life=newLife(host.engine.world.tick);m.nextEvalTick=1e9;}
 const cfg={...config,brainMode:'fake' as const,typesafeKey:undefined,anthropicKey:undefined,budgetUsdPerDay:0};
 const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}}),souls=new Souls(host,db,brain,cfg);
 return {db,host,brain,souls,genesis,alice:db.soul('s_Alice')!};
}
async function accept<T>(h:WorldHost,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){h.tickOnce();await setImmediate();}assert.ok(done,'operation accepted at a tick');return p;}
async function ticks(h:WorldHost,n:number){for(let i=0;i<n;i++){h.tickOnce();if(i%10===0)await setImmediate();}}

test('the four rule forms align once, retain owner words and do not install a daily agenda',async()=>{
 const f=fixture();try{
  const wishes=['rest now','rest at 5pm every day','join every time Bill is having a party','rest if you feel like it'];
  let calls=0;const compile=f.brain.compile.bind(f.brain);f.brain.compile=async(...args)=>{calls++;return compile(...args);};
  const rules:MandateRule[]=[];
  for(const words of wishes){const r=await accept(f.host,f.souls.steer(f.alice,{words}));steerReceiptSchema.parse(r);assert.ok(r.ok);if(r.ok)rules.push(r.rule);}
  assert.equal(calls,4);assert.deepEqual(rules.map(r=>r.trigger.kind),['now','time','gathering','none']);assert.deepEqual(rules.map(r=>r.words),wishes);
  assert.equal((rules[1].trigger as {hour:number}).hour,17);assert.equal((rules[2].trigger as {host:string}).host,'s_Bill');
  assert.ok(!f.host.minds.get(f.alice.id)!.agenda.some(a=>a.of==='s_Bill'),'party rule did not replace the NOW agenda');
  assert.equal(explicitTrigger('rest not now',()=>null).kind,'none');
 }finally{await setImmediate();f.db.close();}
});
test('NOW takes precedence next tick, records done, and removing all rules leaves decisions running',async()=>{
 const f=fixture();try{
  const r=await accept(f.host,f.souls.steer(f.alice,{words:'rest now'}));assert.ok(r.ok);await ticks(f.host,15);
  const decisions=f.db.events(f.host.worldId).filter(e=>e.kind==='decision'&&e.payload.soulId===f.alice.id);
  assert.equal(decisions[0]?.author,'brain:reflex');assert.equal(decisions[0]?.payload.card,'rest');
  const accepted=f.db.events(f.host.worldId).find(e=>e.kind==='mandate'&&e.payload.op==='upsert')!;assert.equal(decisions[0].tick,accepted.tick+1);
  assert.equal(mandateOf(f.host.kernel,f.alice.id)[0].status,'done');
  await accept(f.host,f.souls.removeRule(f.alice,mandateOf(f.host.kernel,f.alice.id)[0].id));
  f.host.minds.get(f.alice.id)!.nextEvalTick=f.host.engine.world.tick;await ticks(f.host,2500);
  assert.equal(mandateOf(f.host.kernel,f.alice.id).length,0);assert.ok(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length>decisions.length);
 }finally{await setImmediate();f.db.close();}
});
test('time and condition edges wake thought without directly choosing cards',async()=>{
 const f=fixture();try{
  await accept(f.host,f.souls.steer(f.alice,{words:'rest at 5pm every day'}));const time=mandateOf(f.host.kernel,f.alice.id)[0];
  assert.equal(triggerDue(time,f.host.kernel,0,16),false);assert.equal(triggerDue(time,f.host.kernel,0,17),true);assert.equal(triggerDue({...time,lastFiredDay:0},f.host.kernel,0,17),false);
  await accept(f.host,f.souls.steer(f.alice,{words:'join every time Bill is having a party'}));
  f.host.kernel.things.party={id:'party',kind:'gathering',name:'Bill’s party',at:null,traits:{},states:{},born:0,by:'s_Bill'};
  f.host.kernel.links['hosts|s_Bill|party']={kind:'hosts',from:'s_Bill',to:'party',since:0};
  await ticks(f.host,25);const wakes=f.db.events(f.host.worldId).filter(e=>e.kind==='mandate'&&e.payload.op==='wake');assert.equal(wakes.length,1);
  assert.equal(f.host.minds.get(f.alice.id)!.activeRule,undefined);assert.equal(f.host.minds.get(f.alice.id)!.agenda.length,0);
  await ticks(f.host,25);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='mandate'&&e.payload.op==='wake').length,1);
 }finally{await setImmediate();f.db.close();}
});
test('rule state replays, survives restart, stays out of public views and cannot be changed by cards',async()=>{
 const f=fixture();try{
  await accept(f.host,f.souls.steer(f.alice,{words:'rest if you feel like it',strict:true}));
  const secret='rest if you feel like it';assert.ok(JSON.stringify(ownerSoulDashboardSchema.parse(f.souls.dashboard(f.alice))).includes(secret));
  assert.ok(!JSON.stringify(f.host.kernelView()).includes(secret));assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes(secret));
  assert.ok(!compileUser(f.host.kernel,'s_Bill','rest',['s_Alice']).includes(secret));
  const events=f.db.events(f.host.worldId),replayed=replayKernel(f.genesis,events);replayed.tick=f.host.engine.world.tick;sweep(replayed);assert.equal(kernelHash(replayed),kernelHash(f.host.kernel));
  f.host.drainInputs();f.host.saveSnapshot(true);const restored=new WorldHost(f.db,toyFactory,'rules',1e9,'toy-1');restored.boot();assert.deepEqual(mandateOf(restored.kernel,f.alice.id),mandateOf(f.host.kernel,f.alice.id));
  const card={name:'overwrite rules',summary:'bad',target:null,derive:{},when:[],then:[{set:['$actor','privateMandate',[]]}],approach:[],during:[],wants:[],takes:'seconds'};
  assert.equal(validateCard(card,f.host.kernel,new Set()).ok,false);
  assert.equal(applyAll(f.host.kernel,[{op:'set',id:f.alice.id,key:'privateMandate',value:[]}],f.alice.id).ok,false);
 }finally{await setImmediate();f.db.close();}
});
test('an impossible NOW rule reports blocked after ten minutes and releases the mind',async()=>{
 const f=fixture();try{
  const rule:MandateRule={id:'r_blocked',words:'join that gathering now',strict:false,understanding:'Join the requested gathering',agenda:[{card:'join',target:'vanished-party'}],trigger:{kind:'now'},status:'active',report:null};
  await accept(f.host,f.host.enqueue('mandate','test',{soulId:f.alice.id,op:'upsert',rule}));await ticks(f.host,12200);
  const saved=mandateOf(f.host.kernel,f.alice.id)[0];assert.equal(saved.status,'blocked');assert.match(saved.report!,/ten minutes/);assert.equal(f.host.minds.get(f.alice.id)!.activeRule,undefined);
 }finally{await setImmediate();f.db.close();}
});
test('NOW replaces a running Mars activity through ordinary program cancellation',async()=>{
 const f=fixture(await marsFactory());try{
  await accept(f.host,f.host.enqueue('decision','test',{soulId:f.alice.id,entityId:f.alice.entity_id,option:'rest',label:'long rest',steps:[{verb:'rest',params:{seconds:300}}],card:'rest',target:null,approachLen:0,reevalTicks:1e9}));
  const old=f.host.engine.programOf(f.alice.entity_id);assert.ok(old);
  const r=await accept(f.host,f.souls.steer(f.alice,{words:'perform now'}));assert.ok(r.ok);await ticks(f.host,10);
  assert.notEqual(f.host.engine.programOf(f.alice.entity_id),old);assert.equal(f.host.minds.get(f.alice.id)!.doing,'perform');assert.equal(f.host.engine.runtime.violations.length,0);
  assert.equal(mandateOf(f.host.kernel,f.alice.id)[0].status,'done');
 }finally{await setImmediate();f.db.close();}
});

test('editing unfinished NOW into a standing rule clears its direct agenda',async()=>{
 const f=fixture();try{
  const rule:MandateRule={id:'r_edit',words:'join now',strict:false,understanding:'join',agenda:[{card:'join',target:'missing'}],trigger:{kind:'now'},status:'active',report:null};
  await accept(f.host,f.host.enqueue('mandate','test',{soulId:f.alice.id,op:'upsert',rule}));
  await accept(f.host,f.souls.steer(f.alice,{id:rule.id,words:'rest if you feel like it',strict:true}));
  assert.equal(f.host.minds.get(f.alice.id)!.activeRule,undefined);assert.equal(f.host.minds.get(f.alice.id)!.agenda.length,0);
  assert.equal(mandateOf(f.host.kernel,f.alice.id).length,1);assert.equal(mandateOf(f.host.kernel,f.alice.id)[0].strict,true);
 }finally{await setImmediate();f.db.close();}
});
test('structured steering uses the same rules and a newer NOW reports its predecessor replaced',async()=>{
 const f=fixture();try{
  const rule:MandateRule={id:'r_old',words:'join now',strict:false,understanding:'join',agenda:[{card:'join',target:'missing'}],trigger:{kind:'now'},status:'active',report:null};
  await accept(f.host,f.host.enqueue('mandate','test',{soulId:f.alice.id,op:'upsert',rule}));
  await accept(f.host,f.souls.setIntent(f.alice,{goal:'rest',note:'quiet please'},'api'));await ticks(f.host,12);
  const rules=mandateOf(f.host.kernel,f.alice.id);assert.equal(rules[0].status,'blocked');assert.match(rules[0].report!,/newer NOW/);
  assert.equal(rules[1].words,'quiet please');assert.equal(rules[1].trigger.kind,'now');assert.equal(rules[1].status,'done');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,0);
 }finally{await setImmediate();f.db.close();}
});
test('strict standing rules are first in context and report a different decision once per day',async()=>{
 const f=fixture();try{
  await accept(f.host,f.souls.steer(f.alice,{words:'rest if you feel like it'}));
  await accept(f.host,f.souls.steer(f.alice,{words:'wander if you feel like it',strict:true}));
  const m=f.host.minds.get(f.alice.id)!,ctx=f.brain.midContext(m,'mandate-trigger');assert.equal(ctx.soul.mandate![0].strict,true);
  const rule=mandateOf(f.host.kernel,f.alice.id).find(r=>r.strict)!;
  // Make this standing preference impossible: thought must stay free to choose another option.
  await accept(f.host,f.host.enqueue('mandate','test',{soulId:f.alice.id,op:'upsert',rule:{...rule,agenda:[{card:'join',target:'missing'}]}}));m.nextEvalTick=f.host.engine.world.tick;
  await ticks(f.host,3500);
  const reports=f.db.events(f.host.worldId).filter(e=>e.kind==='mandate'&&e.payload.op==='report'&&e.payload.ruleId===rule.id);
  assert.equal(reports.length,1);assert.match(mandateOf(f.host.kernel,f.alice.id).find(r=>r.id===rule.id)!.report!,/did not follow/);
  assert.equal(m.activeRule,undefined);
 }finally{await setImmediate();f.db.close();}
});
