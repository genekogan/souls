// #1234: a secret place reaches no public field of a Soul's record, read with no token, and a public place keeps every one.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {secretMatcher,withoutSecrets} from './edge/perception/public-scrub.ts';

const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function world(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installNativeSleepSnapshotV1());
 await invite(f,'alice');const row=await accept<{id:string}>(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic'}) as never);f.db.setSoulToken(row.id,hashToken('sim_T'),'synthetic');
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>{f.host.stop();f.db.close();});
 const owner=async(m:string,p:string,b?:unknown)=>await (await accept<Response>(f.host,app.request(p,{method:m,headers:{authorization:'Bearer sim_T','content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{})}) as never)).json() as any;
 const pub=async()=>{const r=await accept<Response>(f.host,app.request('/v1/edge/public/souls/'+row.id) as never),text=await r.text();return {status:r.status,text,j:JSON.parse(text)};};
 // a walk that ends somewhere: a real receipt with a capability, an endedAt and a path
 const caps=(await owner('GET','/v1/edge/capabilities')).capabilities as any[],walk=caps.find((c)=>c.verb==='walk'&&c.available),acted=await owner('POST','/v1/edge/act',{capability:walk.id});
 for(let i=0;i<4000;i++){f.host.tickOnce();if(i%20===0)await setImmediate();if((await owner('GET','/v1/edge/receipts/'+acted.receipt.id)).receipt?.phase==='completed')break;}
 return {...f,row,ledger,pub,owner,receiptId:acted.receipt.id as string,walk:walk.id as string};
}
/** Every place the record names, inner first, leaving the world itself. */
const places=(j:any)=>(j.self.placePath as {id:string;name:string}[]).filter((p)=>p.id!=='world');

test('A1: with no secret place every field is there: the control', async t => {
 const f=await world(t),{status,j}=await f.pub();
 assert.equal(status,200);assert.ok(places(j).length>0,'a path');
 const r=j.receipts.find((x:any)=>x.id===f.receiptId);
 assert.equal(r.capability,f.walk);assert.ok(r.endedAt?.place);assert.ok(Array.isArray(r.endedAt.pos));
});

test('A1: a secret place is gone from self.placePath, receipts[].endedAt and receipts[].capability, by id and by name; the rest stays', async t => {
 const f=await world(t),before=(await f.pub()).j,all=before.self.placePath as {id:string;name:string}[],path=places(before),target=path[0]!,r=before.receipts.find((x:any)=>x.id===f.receiptId);
 assert.ok(f.ledger.knowledge.setSecret(target.id,true));
 const {status,text,j}=await f.pub();
 assert.equal(status,200);
 assert.ok(!text.includes(`"${target.id}"`),'the id, in any field');assert.ok(!new RegExp(`(?<![\\w-])${target.name}(?![\\w-])`,'i').test(text),'the name, in any field');
 assert.ok(!(j.self.placePath as any[]).some((p)=>p.id===target.id));
 assert.ok(j.self.placePath.length>0&&j.self.placePath.length<all.length);assert.ok(j.self.placePath.every((p:any)=>!f.ledger.knowledge.isSecret(p.id)),'what is public about where it is stays');
 assert.ok(!j.receipts.some((x:any)=>x.id===f.receiptId),'the receipt that names it goes whole, capability, endedAt and position');
 assert.ok(!text.includes(JSON.stringify(r.endedAt.pos)));
 assert.equal(j.soul.name,'Alice');assert.equal(j.self.state,before.self.state);assert.deepEqual(j.fade,before.fade);
 f.ledger.knowledge.setSecret(target.id,false);
 assert.ok((await f.pub()).j.receipts.some((x:any)=>x.id===f.receiptId),'public again, shown again');
});

test('A1: what is inside a secret place goes with it, and so do world rows naming it; a Soul\'s own words stay', async t => {
 const f=await world(t),outer=places((await f.pub()).j)[0]!,inner={...f.ledger.places.byId.get(outer.id)!,id:'inner-room',name:'Inner Room',parent:outer.id};
 f.ledger.places.byId.set(inner.id,inner);   // a room inside it: this fixture has no such nesting
 f.db.db.exec("CREATE TABLE IF NOT EXISTS edge_comms_stream(world_id TEXT,soul_id TEXT,seq INTEGER,tick INTEGER,at INTEGER,kind TEXT,body TEXT);CREATE TABLE IF NOT EXISTS edge_comms_speech(world_id TEXT,id TEXT,soul_id TEXT,tick INTEGER,at INTEGER,channel TEXT,text TEXT,heard_by TEXT)");
 const w=f.host.worldId,s=f.row.id,row=f.db.db.prepare('INSERT INTO edge_comms_stream VALUES(?,?,?,?,?,?,?)'),said=f.db.db.prepare("INSERT INTO edge_comms_speech(world_id,id,soul_id,tick,at,channel,text,heard_by) VALUES(?,?,?,?,?,?,?,'[]')");
 const soulRef={soulId:'s_b',name:'Bo'};
 row.run(w,s,9001,1,1,'arrival',JSON.stringify({placeId:inner.id,soul:soulRef,untrusted:true}));row.run(w,s,9002,2,2,'arrival',JSON.stringify({placeId:'field-public',soul:soulRef,untrusted:true}));
 said.run(w,'c_1',s,4,4,JSON.stringify({kind:'public',placeId:inner.id}),'Over here.');said.run(w,'c_2',s,5,5,JSON.stringify({kind:'public',placeId:'field-public'}),`I know ${inner.name}.`);
 assert.ok(f.ledger.knowledge.setSecret(outer.id,true));
 const {text,j}=await f.pub();
 assert.ok(!text.includes(`"${inner.id}"`));assert.ok(!text.includes(`"${outer.id}"`));
 assert.deepEqual(j.events.filter((e:any)=>e.kind==='arrival').map((e:any)=>e.placeId),['field-public'],'a public place\'s row stays');
 assert.deepEqual(j.events.filter((e:any)=>e.kind==='speech').map((e:any)=>e.text),[`I know ${inner.name}.`],'its own words stay; words said in there go');
});

test('A1: a receipt that ended inside a place built later goes by its position; an open one goes while the Soul is in there', async t => {
 const f=await world(t),path=places((await f.pub()).j),spot={...f.ledger.places.byId.get(path[0]!.id)!,id:'late-cove',name:'Late Cove',parent:'world'};
 f.ledger.places.byId.set(spot.id,spot);const was=f.ledger.places.containing.bind(f.ledger.places);(f.ledger.places as any).containing=(x:number,z:number,l:number)=>[spot,...was(x,z,l)];
 f.ledger.knowledge.setSecret(spot.id,true);
 assert.ok(!(await f.pub()).j.receipts.some((x:any)=>x.id===f.receiptId));
});

test('A2: a Soul\'s own token still reads everything', async t => {
 const f=await world(t),before=await f.owner('GET','/v1/edge/receipts/'+f.receiptId),target=places((await f.pub()).j)[0]!;
 f.ledger.knowledge.setSecret(target.id,true);
 assert.deepEqual(await f.owner('GET','/v1/edge/receipts/'+f.receiptId),before);
});

test('A1: a public place outlives a secret one that sounds like it; words mean nothing in a key or an enum', () => {
 const s=secretMatcher(['g-sq'],['Square','Self','Plaza','Receipts'])!;
 const answer={self:{placePath:[{id:'open-sq',name:'Open Square',kind:'plaza'},{id:'g-sq',name:'Square',kind:'plaza'}],state:'plaza'},receipts:[{id:'r',capability:'walk:g-sq'},{id:'r2',capability:'sit:here',phase:'completed'}]};
 assert.deepEqual(withoutSecrets(answer,s),{self:{placePath:[{id:'open-sq',name:'Open Square',kind:'plaza'}],state:'plaza'},receipts:[{id:'r2',capability:'sit:here',phase:'completed'}]});
 assert.deepEqual(withoutSecrets({receipts:[{capability:'sit:here'}]},secretMatcher(['here','g-a'])),{receipts:[{capability:'sit:here'}]},'`here` is no place\'s ref');
 assert.equal(secretMatcher([123,null,''],[7]),null,'a ref that isn\'t text is no term, and no 503');
});

test('A1: a seat goes with its place, by its own id; and a receipt in a public place keeps its path and its verb', () => {
 const s=secretMatcher(['g-sq','seat-0','walk','jump'],['Square','World-Tree'])!;
 assert.deepEqual(withoutSecrets({placePath:[{id:'seat-0',name:'Square seat',kind:'occupier'},{id:'bench',name:'Bench',kind:'place'}]},s),{placePath:[{id:'bench',name:'Bench',kind:'place'}]});
 const publicOne={id:'r',capability:'jump:here',endedAt:{place:'open-sq',placePath:['Open Square','Town'],pos:[1,2]}},walkOne={id:'r2',capability:'walk:field'};
 assert.deepEqual(withoutSecrets({receipts:[publicOne,walkOne]},s),{receipts:[publicOne,walkOne]},'an exact field isn\'t read for words, and a verb is no place');
 assert.deepEqual(withoutSecrets({receipts:[{...publicOne,endedAt:{place:'x',placePath:['Square','Town']}}]},s),{receipts:[]},'the exact name in a path is');
 assert.deepEqual(withoutSecrets({receipts:[{capability:'walk:g-sq'}]},s),{receipts:[]});
});

test('A1: a real seat: its occupier entry goes with the place', async t => {
 const f=await world(t),target=places((await f.pub()).j)[0]!,place=f.ledger.places.byId.get(target.id)!;
 (f.ledger.places.occupierOf as Map<string,unknown>).set('seat-x',{occ:{id:'bench-seat-0'},place});
 f.ledger.knowledge.setSecret(target.id,true);
 assert.ok(f.ledger.knowledge.publicMatcher()!.ids.has('bench-seat-0'));
 assert.ok(f.ledger.places.occupierOf.size>0);
});

test('A1: with a secret place in the world, no receipt carries a chosen target', async t => {
 const f=await world(t),target=places((await f.pub()).j)[0]!;
 f.ledger.knowledge.setSecret('field',true);f.ledger.knowledge.setSecret(target.id,false);
 assert.ok(!(await f.pub()).text.includes('"chosen"'));
});

test('A1: a new field can\'t bring one back: the scrub works on the answer, not on field names', () => {
 const s=secretMatcher(['hut-1'],['Hidden Cove'])!,gone=withoutSecrets({a:{later:{where:'hut-1',ok:1}},list:[{deep:[{x:'At the hidden cove.'}]},{y:'hut-12 and chutney'}],k:'Hidden Cove',n:3},s);
 assert.deepEqual(gone,{a:{later:{ok:1}},list:[{y:'hut-12 and chutney'}],n:3},'whole words only; an entry goes whole, a field alone');
 assert.equal(secretMatcher([]),null);const v={a:1};assert.equal(withoutSecrets(v,null),v,'no secret place, nothing touched');
});
