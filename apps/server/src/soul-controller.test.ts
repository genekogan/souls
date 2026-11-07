// SOUL3 controller: one delegated controller per Soul. Only a newly approved pairing/creation or an explicit owner revoke
// supersedes it (retirement removes the body); registration, sign-out, idle time,
// a not-ready moment and restarts keep it. A superseded token answers 401 control.revoked (which Soul, when, why, how to
// pair again); any other supplied bearer answers 401 control.unknown. Fake world, $0.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
import type {AccountIdentity} from './accounts/store.ts';
import {WorldAccounts} from './accounts/service.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {Db} from './db.ts';
import {hashToken} from './auth.ts';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

function accountWorld(t:TestContext){
 const f=fixture(':memory:',factory);f.brain.quiesce();f.souls.enableLifecycle();t.after(()=>{f.host.stop();f.db.close();});
 f.souls.cfg.accountAuthRequired=true;f.souls.cfg.inviteRequired=false;
 const id='did:privy:alice';f.db.upsertUser({id,email:null,wallet:null,role:'user'});
 const identity:AccountIdentity={id,issuer:'privy.io/test-app',subject:id,verifiedAt:Date.now(),expiresAt:Date.now()+600000};
 f.auth.accountFromToken=async token=>token==='alice'?{identity,user:f.db.user(id)!}:null;
 const originalAuth=f.auth.userFromToken.bind(f.auth);f.auth.userFromToken=async token=>token==='alice'?f.db.user(id)!:originalAuth(token);
 const make=()=>buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,souls:f.souls,brain:f.brain,auth:f.auth,edge:new EdgeLedger(f.host,f.db),hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 let app=make(),skew=0;
 // The account store's clock: `skew` moves it forward (approval and first poll can be far apart).
 const clock=()=>{(f.souls.accounts!.store as unknown as {now:()=>number}).now=()=>Date.now()+skew;};clock();
 const request=async(path:string,body?:unknown,token?:string)=>{const res=await app.request(path,{method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:4956',...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json() as any};};
 let n=0;
 const start=async(input:{name?:string;soulId?:string},label='agent one')=>{const secret=randomBytes(32).toString('base64url');const r=await request('/v1/agent/approval/start',{agentLabel:label,idempotencyKey:'controller-test-key-'+(n++).toString().padStart(4,'0'),pollSecret:secret,...input});assert.equal(r.status,200,JSON.stringify(r.body));return {id:r.body.approval.id as string,secret};};
 const approve=async(a:{id:string})=>assert.equal((await request('/v1/account/approvals/'+a.id+'/approve',{},'alice')).status,200);
 const poll=async(a:{id:string;secret:string})=>{let out:any;for(let i=0;i<50;i++){await setImmediate();f.host.drainInputs();out=(await request('/v1/agent/approval/poll',{approvalId:a.id,pollSecret:a.secret})).body;if(out.token)break;}assert.ok(out.token,JSON.stringify(out));return {token:out.token as string,soulId:out.soulId as string,approval:a};};
 const pair=async(input:{name?:string;soulId?:string},label?:string)=>{const a=await start(input,label);await approve(a);return poll(a);};
 // Owner-made legacy pairing code exchanged by an agent (the other kind of controller).
 const legacyPair=async(soulId:string)=>{const code=(await request('/v1/souls/'+soulId+'/pair',{},'alice')).body.code;assert.ok(code);const r=await request('/v1/agent/pair',{code,agent:'legacy agent'});assert.ok(r.body.token,JSON.stringify(r.body));return r.body.token as string;};
 return {...f,request,start,approve,poll,pair,legacyPair,advance(ms:number){skew+=ms;},restart(){f.souls.accounts=new WorldAccounts(f.host,f.souls);app=make();clock();}};
}
const me=(f:ReturnType<typeof accountWorld>,token:string)=>f.request('/v1/agent/me',undefined,token);

test('account controller: issue time is the first poll; registration, a not-ready moment and restart keep it; replacement says it moved, revoke says revoked',async t=>{
 const f=accountWorld(t);
 // since = the token's actual first issue (first ready poll), not the approval; stable across re-polls and restart.
 const a=await f.start({name:'Ada Lovelace'});await f.approve(a);const approvedAt=Date.now();f.advance(60_000);
 const first=await f.poll(a),sid=first.soulId;
 const m=await me(f,first.token);assert.equal(m.status,200);assert.equal(m.body.paired_as,'agent one');
 assert.ok(m.body.since>=approvedAt+60_000,`since ${m.body.since} is the first poll, not approval ${approvedAt}`);assert.equal(new Date(m.body.since_at).getTime(),m.body.since);assert.match(m.body.since_at,ISO);
 f.advance(30_000);const repoll=await f.poll(a);assert.equal(repoll.token,first.token);assert.equal((await me(f,first.token)).body.since,m.body.since,'a re-poll does not move the issue time');
 assert.equal((await f.request('/v1/edge/observe',undefined,first.token)).status,200,'edge route accepts the controller');
 const release=await f.request('/v1/agent/release',{},first.token);assert.equal(release.status,403);assert.equal(release.body.error.code,'control.owner_required');assert.equal((await me(f,first.token)).status,200);
 const garbage=await me(f,'garbage');assert.equal(garbage.body.contract,'eden-edge/1');assert.equal(garbage.body.error.code,'control.unknown');
 // A fresh registration (another Soul approved for the same account), a cancelled re-pair request, the world's config
 // read (what `register` does in account worlds), a browser session read, and 40 idle days keep the controller.
 const other=await f.pair({name:'Second Soul'},'agent two');assert.notEqual(other.soulId,sid);
 const pending=await f.start({soulId:sid},'agent three');assert.equal((await f.request('/v1/agent/approval/cancel',{approvalId:pending.id,pollSecret:pending.secret})).status,200);
 assert.equal((await f.request('/v1/config')).status,200);assert.equal((await f.request('/v1/account/session',undefined,'alice')).status,200);
 // Not ready: no authority (401), but the pairing is kept and works again once ready; a browser view meanwhile ends nothing.
 const ready=f.souls.controlReady.bind(f.souls);f.souls.controlReady=()=>false;
 const nr=await me(f,first.token);assert.equal(nr.status,401);assert.equal(nr.body.code,'unauthorized');
 assert.equal((await f.request('/v1/edge/observe',undefined,first.token)).status,401);
 await f.request('/v1/account/approvals/'+a.id,undefined,'alice');f.souls.controlReady=ready;
 assert.equal((await me(f,first.token)).status,200,'controller survives registration, cancel and a not-ready moment with a browser view');
 f.advance(40*86_400_000);assert.equal((await me(f,first.token)).status,200,'40 idle days end nothing');
 f.advance(-40*86_400_000); // the owner's fixture sign-in is short-lived; back to the present for the owner's next approval
 // Approved replacement: the old token is revoked at approval, before the new agent has polled.
 const b=await f.start({soulId:sid},'agent four');await f.approve(b);
 const old=await me(f,first.token);assert.equal(old.status,401);assert.equal(old.body.code,'control.revoked');assert.equal(old.body.reason,'replaced');
 assert.match(old.body.revokedAt,ISO);assert.equal(old.body.replacedAt,old.body.revokedAt);
 assert.equal(old.body.message,`Ada Lovelace's control moved to a newer pairing at ${old.body.revokedAt}.`);
 assert.equal(old.body.hint,`Run: node eden.mjs pair ${sid} --for CODE`);assert.deepEqual(old.body.soul,{id:sid,name:'Ada Lovelace'});
 const second=await f.poll(b);assert.notEqual(second.token,first.token);
 const after=await me(f,first.token);assert.deepEqual(after.body,old.body,'the new agent polling changes nothing the old holder sees');
 assert.ok(!JSON.stringify(old.body).includes(second.token)&&!JSON.stringify(old.body).includes('did:privy'),'no replacement bearer or account');
 assert.equal((await me(f,second.token)).body.paired_as,'agent four');
 assert.equal((await f.request('/v1/agent/soul',undefined,first.token)).body.code,'control.revoked','profile/dashboard route agrees');
 const edge=await f.request('/v1/edge/observe',undefined,first.token);assert.equal(edge.status,401);assert.equal(edge.body.contract,EDGE_CONTRACT);
 assert.equal(edge.body.error.code,'control.revoked');assert.equal(edge.body.error.message,old.body.message);assert.equal(edge.body.error.hint,old.body.hint);assert.equal(edge.body.error.revokedAt,old.body.revokedAt);
 for(const [path,body] of [['/v1/edge/inbox/listen?timeoutMs=0',undefined],['/v1/edge/inbox/missing/ack',{}],['/v1/edge/inbox/missing/result',{}]] as const){
  const r=await f.request(path,body,first.token);assert.equal(r.status,401);assert.equal(r.body.contract,EDGE_CONTRACT);assert.equal(r.body.error.code,'control.revoked');assert.equal(r.body.error.revokedAt,old.body.revokedAt);assert.equal(r.body.error.hint,old.body.hint);
 }
 // Unknown: never issued, garbage, oversized or a browser credential on a Soul route. Missing stays unauthorized.
 for(const bad of ['sim_'+sid+'_'+'0'.repeat(64),'garbage-token','sim_'+'x'.repeat(2000),'x'.repeat(5000),'alice']){
  const r=await me(f,bad);assert.equal(r.status,401);assert.equal(r.body.code,'control.unknown',bad.slice(0,20));assert.equal(r.body.soul,undefined);
  const e=await f.request('/v1/edge/observe',undefined,bad);assert.equal(e.status,401);assert.equal(e.body.error.code,'control.unknown');
  const inbox=await f.request('/v1/edge/inbox/listen?timeoutMs=0',undefined,bad);assert.equal(inbox.status,401);assert.equal(inbox.body.error.code,'control.unknown');
 }
 assert.equal((await f.request('/v1/agent/me')).body.code,'unauthorized');assert.equal((await f.request('/v1/edge/observe')).body.error.code,'unauthorized');
 // Restart (fresh account service + routes over the same database) keeps both facts and the issue time.
 const sinceB=(await me(f,second.token)).body.since;f.restart();
 assert.equal((await me(f,second.token)).body.since,sinceB);
 assert.deepEqual((await me(f,first.token)).body,old.body);
 assert.equal((await me(f,other.token)).status,200);
 // Explicit owner revoke says revoked, not moved.
 assert.equal((await f.request('/v1/account/souls/'+sid+'/revoke',{},'alice')).status,200);
 const revoked=await me(f,second.token);assert.equal(revoked.status,401);assert.equal(revoked.body.code,'control.revoked');assert.equal(revoked.body.reason,'revoked');
 assert.equal(revoked.body.replacedAt,null);assert.equal(revoked.body.message,`Ada Lovelace's control was revoked by its owner at ${revoked.body.revokedAt}.`);
 assert.equal((await me(f,other.token)).status,200,'revoking one Soul leaves the other controller');
});

test('an open listen rechecks a replaced controller before delivering owner messages',async t=>{
 const f=accountWorld(t),first=await f.pair({name:'Listener'});
 const pending=f.request('/v1/edge/inbox/listen?timeoutMs=1000',undefined,first.token);
 let open=false;
 for(let i=0;i<30;i++){await setImmediate();open=(await f.request(`/v1/edge/owner/${first.soulId}/inbox`,undefined,'alice')).body.inbox.connected;if(open)break;}
 assert.equal(open,true);
 const second=await f.pair({soulId:first.soulId},'replacement');
 await f.request(`/v1/edge/owner/${first.soulId}/inbox`,{text:'Only the new controller may see this.'},'alice');
 const old=await pending;assert.equal(old.status,401);assert.equal(old.body.error.code,'control.revoked');assert.ok(!JSON.stringify(old.body).includes('Only the new controller'));
 const current=await f.request('/v1/edge/inbox/listen?timeoutMs=0',undefined,second.token);assert.equal(current.status,200);assert.equal(current.body.backlog[0].text,'Only the new controller may see this.');
});

test('account world: a legacy token and a delegated grant never both steer one Soul, in either order',async t=>{
 const f=accountWorld(t);
 const grant=await f.pair({name:'Cleo'}),sid=grant.soulId;
 const legacy=await f.legacyPair(sid);
 assert.equal((await me(f,legacy)).status,200);
 const g=await me(f,grant.token);assert.equal(g.body.code,'control.revoked');assert.equal(g.body.reason,'replaced');assert.equal(g.body.message,`Cleo's control moved to a newer pairing at ${g.body.revokedAt}.`);
 const repaired=await f.pair({soulId:sid},'agent five');
 assert.equal((await me(f,repaired.token)).status,200);
 const l=await me(f,legacy);assert.equal(l.body.code,'control.revoked');assert.equal(l.body.reason,'replaced');assert.equal(l.body.message,`Cleo's control moved to a newer pairing at ${l.body.revokedAt}.`);
 assert.equal((await me(f,grant.token)).body.code,'control.revoked');
 const live=[grant.token,legacy,repaired.token].filter(token=>f.souls.soulFromToken(token)?.id===sid);assert.deepEqual(live,[repaired.token],'exactly one live controller');
});

test('legacy world: register paths keep the controller; re-pair says moved; agent release cannot revoke control; tombstones survive reopening without the token',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'soul-controller-')),path=join(dir,'world.db');
 const f=fixture(path,factory);f.brain.quiesce();let closed=false;t.after(()=>{if(!closed){f.host.stop();f.db.close();}});
 await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Basil',description:'Synthetic controller Soul'}));
 const agentMe=async(token:string)=>{const r=await f.app.request('/v1/agent/me',{headers:{authorization:'Bearer '+token}});return {status:r.status,body:await r.json() as any};};
 const pairOnce=async()=>{const code=(await (await f.request('/v1/souls/'+row.id+'/pair',{})).json() as any).code;const res=await f.app.request('/v1/agent/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,agent:'legacy agent'})});return (await res.json() as any).token as string;};
 const a=await pairOnce();
 const meA=await agentMe(a);assert.equal(meA.body.paired_as,'legacy agent');assert.match(meA.body.since_at,ISO);assert.equal(meA.body.since,f.db.soul(row.id)!.token_created_at);
 // What `register` sends (config, the owner identity's /v1/me, an invitation) and a second folder registering a new identity.
 assert.equal((await f.request('/v1/config')).status,200);assert.equal((await f.request('/v1/me')).status,200);
 assert.equal((await f.request('/v1/me',undefined,'agent-'+'e'.repeat(24))).status,200);
 const still=await agentMe(a);assert.deepEqual([still.status,still.body.paired_as,still.body.since],[200,meA.body.paired_as,meA.body.since],'register paths leave the controller and its issue time alone');
 const b=await pairOnce();assert.notEqual(a,b);
 const old=await agentMe(a);assert.equal(old.status,401);assert.equal(old.body.code,'control.revoked');assert.equal(old.body.reason,'replaced');
 assert.equal(old.body.message,`Basil's control moved to a newer pairing at ${old.body.revokedAt}.`);assert.equal(old.body.hint,`Run: node eden.mjs pair ${row.id} --for CODE`);
 // Only the human can revoke; an old client's register/cleanup release call cannot disconnect control.
 const attempt=await f.app.request('/v1/agent/release',{method:'POST',headers:{authorization:'Bearer '+b}});assert.equal(attempt.status,403);assert.equal((await attempt.json() as any).error.code,'control.owner_required');
 assert.equal((await agentMe(b)).status,200);
 assert.equal((await f.request('/v1/souls/'+row.id+'/revoke',{})).status,200);
 const released=await agentMe(b);assert.equal(released.body.code,'control.revoked');assert.equal(released.body.reason,'revoked');assert.equal(released.body.contract,'eden-edge/1');assert.equal(released.body.error.revokedAt,released.body.revokedAt);
 assert.equal((await agentMe('sim_'+row.id+'_nope')).body.code,'control.unknown');
 f.host.stop();f.db.close();closed=true;
 const reopened=new Db(path);t.after(()=>reopened.close());
 const dump=JSON.stringify(reopened.db.prepare('SELECT * FROM soul_token_tombstones_v1').all());assert.ok(!dump.includes(a)&&!dump.includes(b),'no bearer plaintext');assert.ok(dump.includes(hashToken(a)));
 assert.equal(reopened.tokenTombstone(hashToken(a))?.reason,'replaced');assert.equal(reopened.tokenTombstone(hashToken(b))?.reason,'revoked');
});
