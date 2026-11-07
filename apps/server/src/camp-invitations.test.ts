import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {marsFactory,type MarsWorldConfig} from '@souls/engine-mars';
import {cardSchema,cardHash,kernelHash,whyNot,type Card} from '@souls/kernel';
import {hashOf} from '@souls/engine-contract';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {CampCards} from './camp.ts';
import {CampCards as LegacyCampCards} from '../test/fixtures/camp-resources/legacy-camp.ts';
import {optionsFor,type CardOption} from './deck.ts';
import {WorldHost,type Mind} from './world.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsFactory(cfg);
async function drain(f:ReturnType<typeof fixture>){for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}}
async function populate(names:string[]){
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
  for(const [i,name] of names.entries()){
    const owner='guest'+i;await invite(f,owner);
    const op=f.souls.acceptLifecycleCreate('dev:'+owner,{name,description:'Local invited human-owned camp resident'});await drain(f);
    const mind=f.host.minds.get(op.scope.soulId)!;assert.ok(mind);mind.nextEvalTick=1e9;
    assert.equal(f.souls.controlReady(f.db.soul(mind.soulId)!),true);
  }
  return f;
}
function legacyCards(host:WorldHost):Card[]{
  const cards:Card[]=[],view=Object.create(host) as WorldHost;
  view.listeners=[];
  // Observe the exact frozen recipe producer without submitting invalid cards
  // to the native host or mutating its deck/log.
  view.enqueue=(async(kind:string,_by:string,payload:any)=>{if(kind==='mint')cards.push(payload.card);return {} as any;}) as WorldHost['enqueue'];
  new LegacyCampCards(view);return cards;
}
async function choose(f:ReturnType<typeof fixture>,m:Mind,opt:CardOption){
  assert.equal(whyNot(f.host.kernel,f.host.kernel.vocab.cards[opt.card],m.soulId,opt.cardTarget),null);
  void f.host.enqueue('decision','fixture',{soulId:m.soulId,entityId:m.entityId,option:opt.id,card:opt.card,target:opt.cardTarget,
    label:opt.label,steps:opt.steps,approachLen:opt.approachLen,mood:'content',reevalTicks:1e9,continue:false,fallback:true,trigger:'fixture'});
  await drain(f);
}
test('frozen eight-resident supper recipe exceeds the actual card bound; current recipes and individual invitations fit',async()=>{
  const f=await populate(['Alice','Bob','Carol','David','Eve','Frank','Grace','Hank']);
  try{
    const old=legacyCards(f.host).filter(c=>c.name.startsWith('host supper'));
    assert.equal(old.length,8);for(const card of old){assert.equal(card.then.length,11);assert.equal(cardSchema.safeParse(card).success,false);}
    const pack=new CampCards(f.host);await drain(f);
    const hosts=Object.values(f.host.kernel.vocab.cards).filter(c=>c.name.startsWith('host supper'));
    const invitations=Object.values(f.host.kernel.vocab.cards).filter(c=>c.name.startsWith('invite '));
    assert.equal(hosts.length,8);assert.equal(invitations.length,56);
    for(const card of hosts){const {hash,by,mintedAt,origin,...recipe}=card;assert.equal(card.then.length,4);assert.equal(cardSchema.safeParse(recipe).success,true);}
    for(const card of invitations){const {hash,by,mintedAt,origin,...recipe}=card;assert.equal(card.then.length,1);assert.equal(cardSchema.safeParse(recipe).success,true);}
    assert.equal(pack.resourceIssues.size,4,'missing personal mats/utensils remain honest, not invented for this proof');
    assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.souls.lifecycle!.faults.size,0);assert.equal(f.db.paidCost(),0);
  }finally{f.host.stop();f.db.close();}
});
test('legacy four-resident host definitions remain exact and later arrivals gain invitation cards without rewriting them',async()=>{
  const f=await populate(['Alice','Bob','Carol','David']);
  try{
    const old=legacyCards(f.host).filter(c=>c.name.startsWith('host supper'));
    const pack=new CampCards(f.host);await drain(f);
    for(const card of old){const {hash:_hash,by:_by,mintedAt:_tick,origin:_origin,...recipe}=card as any;
      assert.equal(f.host.kernel.vocab.cards[card.name].hash,cardHash(recipe));}
    const oldHashes=old.map(c=>f.host.kernel.vocab.cards[c.name].hash);
    await invite(f,'newguest');f.souls.acceptLifecycleCreate('dev:newguest',{name:'Eve',description:'A later human-owned resident'});await drain(f);pack.install();await drain(f);
    assert.deepEqual(old.map(c=>f.host.kernel.vocab.cards[c.name].hash),oldHashes);
    const eve=[...f.host.minds.values()].find(m=>m.name==='Eve')!;
    const alice=[...f.host.minds.values()].find(m=>m.name==='Alice')!;
    assert.ok(f.host.kernel.decks[alice.soulId].cards.some(name=>{
      const c=f.host.kernel.vocab.cards[name];return c.then.some(st=>'say' in st&&st.say[1]===eve.soulId)&&name.startsWith('invite ');
    }));
  }finally{f.host.stop();f.db.close();}
});
test('actual owned host arrives, opens supper and chooses one invitation without assigning the guest; snapshot/genesis preserve it',async()=>{
  const f=await populate(['Alice','Bob','Carol','David','Eve','Frank','Grace','Hank']);
  try{
    new CampCards(f.host);await drain(f);
    const alice=[...f.host.minds.values()].find(m=>m.name==='Alice')!,guest=[...f.host.minds.values()].find(m=>m.name==='Eve')!;
    const arrival=[...f.host.engine.world.entities[alice.entityId].pose.p];
    const direction=await accept(f.host,f.request('/v1/souls/'+alice.soulId+'/intent',{intent:{agenda:[{card:'host supper alice',target:null}]}},'guest0'));assert.equal(direction.status,200);
    const host=optionsFor(f.host,alice).find(o=>o.card==='host supper alice');assert.ok(host);await choose(f,alice,host);
    for(let i=0;i<6000&&!Object.values(f.host.kernel.links).some(l=>l.kind==='hosts'&&l.from===alice.soulId);i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
    const gathering=Object.values(f.host.kernel.links).find(l=>l.kind==='hosts'&&l.from===alice.soulId)?.to;assert.ok(gathering);
    const hostedAt=f.host.engine.world.entities[alice.entityId].pose.p;
    assert.ok(Math.hypot(hostedAt[0]-arrival[0],hostedAt[2]-arrival[2])>20,'actual native host approach precedes opening supper');
    assert.equal(f.host.kernel.things[gathering].states.meal,true);
    assert.equal(Object.values(f.host.kernel.links).some(l=>l.kind==='said'&&l.from===alice.soulId),false,'large host creation does not implicitly invite anyone');
    const invitation=Object.values(f.host.kernel.vocab.cards).find(c=>c.name.startsWith('invite ')&&c.then.some(st=>'say' in st&&st.say[1]===guest.soulId)
      &&f.host.kernel.decks[alice.soulId].cards.includes(c.name));assert.ok(invitation);
    const next=await accept(f.host,f.request('/v1/souls/'+alice.soulId+'/intent',{intent:{agenda:[{card:invitation.name,target:gathering}]}},'guest0'));assert.equal(next.status,200);
    const option=optionsFor(f.host,alice).find(o=>o.card===invitation.name&&o.cardTarget===gathering);assert.ok(option);
    const guestBefore={body:hashOf(f.host.engine.world.entities[guest.entityId]),intent:hashOf(guest.intent),pending:guest.pending,owner:guest.owner};
    await choose(f,alice,option);
    for(let i=0;i<300&&f.host.engine.programOf(alice.entityId);i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
    await drain(f);assert.equal(f.host.engine.programOf(alice.entityId),null);
    const plays=f.db.events(f.host.worldId).filter(e=>e.kind==='play'&&e.payload.card===option.card);assert.equal(plays.length,1);
    assert.ok(Object.values(f.host.kernel.links).some(l=>l.kind==='said'&&l.from===alice.soulId&&l.to===guest.soulId));
    assert.equal(Object.values(f.host.kernel.links).some(l=>l.kind==='attends'&&l.from===guest.soulId&&l.to===gathering),false);
    assert.deepEqual({body:hashOf(f.host.engine.world.entities[guest.entityId]),intent:hashOf(guest.intent),pending:guest.pending,owner:guest.owner},guestBefore);
    assert.equal(guest.evalTrigger,'spoken-to');assert.ok(whyNot(f.host.kernel,f.host.kernel.vocab.cards[option.card],alice.soulId,gathering),'recent speech suppresses immediate duplicate');
    assert.ok(whyNot(f.host.kernel,f.host.kernel.vocab.cards[option.card],guest.soulId,gathering),'being invited does not give host authority');
    // Attendance is a second actor's independent owned choice, not an effect
    // of the invitation. This uses the existing ordinary joining controller,
    // without promising a fifth mat, utensils or eight-person meal service.
    const guestArrival=[...f.host.engine.world.entities[guest.entityId].pose.p];
    const guestDirection=await accept(f.host,f.request('/v1/souls/'+guest.soulId+'/intent',{intent:{agenda:[{card:'join',target:gathering}]}},'guest4'));assert.equal(guestDirection.status,200);
    const joining=optionsFor(f.host,guest).find(o=>o.card==='join'&&o.cardTarget===gathering);assert.ok(joining);await choose(f,guest,joining);
    for(let i=0;i<7000&&f.host.engine.programOf(guest.entityId);i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
    await drain(f);assert.equal(f.host.engine.programOf(guest.entityId),null);
    assert.ok(Object.values(f.host.kernel.links).some(l=>l.kind==='attends'&&l.from===guest.soulId&&l.to===gathering));
    const joinedAt=f.host.engine.world.entities[guest.entityId].pose.p;
    assert.ok(Math.hypot(joinedAt[0]-guestArrival[0],joinedAt[2]-guestArrival[2])>20);
    assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='play'&&e.payload.soulId===guest.soulId&&e.payload.card==='join').length,1);
    const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};const saved=f.host.saveSnapshot(true);assert.ok(!saved.pending);
    const boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(boot.boot().from,'snapshot');new CampCards(boot);await drain({...f,host:boot});
    assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},head);boot.stop();
    f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
    const genesis=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');new CampCards(genesis);await drain({...f,host:genesis});
    assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},head);genesis.stop();
    assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
    const proof={contract:'core-owned-camp-invitations/1',worldId:f.host.worldId,seed:'native-owner-lifecycle',rulesVersion:factory.rulesVersion,
      sourcePins:['./camp.ts','./camp-invitations.test.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')})),
      actors:[...f.host.minds.values()].map(m=>({soulId:m.soulId,entityId:m.entityId,owner:m.owner,name:m.name,controlReady:f.souls.controlReady(f.db.soul(m.soulId)!)})),
      host:{soulId:alice.soulId,arrival,hostedAt:[...hostedAt]},invitation:{card:option.card,gathering,guest:guest.soulId,guestBefore,playSeq:plays[0].seq},
      joining:{guestArrival,joinedAt:[...joinedAt]},headTick:f.host.engine.world.tick,head,snapshot:{engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},genesis:{engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},
      trace:f.db.events(f.host.worldId).filter(e=>['birth','intent','decision','play'].includes(e.kind)).map(e=>({seq:e.seq,tick:e.tick,kind:e.kind,author:e.author,payload:e.payload})),
      nativeViolations:f.host.engine.runtime.violations,brainCalls:f.db.brainCalls(100).length,paidUSD:0,
      scope:'Eight synthetic invited human owners/native bodies in existing camp. Actual owner structured legacy agendas, selected fixture decisions and native execution; not ordinary language/compiler/autonomous choice, eight personal fixtures/meal service, expanded Mars/stairs/water, realAuth/cohort or World consumer qualification. Synthetic private causal trace, never public take.'};
    const dir=new URL('../../../.e2e/camp-invitations/',import.meta.url);mkdirSync(dir,{recursive:true});const out=new URL(new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
    console.log('Synthetic private invitation trace '+out.pathname);
  }finally{f.host.stop();f.db.close();}
});
