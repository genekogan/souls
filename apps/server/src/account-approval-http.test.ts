import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
import type {AccountIdentity} from './accounts/store.ts';
import {SoulProfiles} from './soul-profile.ts';
import {WorldAccounts} from './accounts/service.ts';
import {IntentControlV2} from './intent-control.ts';
import {Brain} from './brain.ts';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});

test('mounted verified account approval creates once, delegates only ready Soul, survives restart and revokes queued authority',async t=>{
 const f=fixture(':memory:',factory);f.brain.quiesce();f.souls.enableLifecycle();t.after(()=>{f.host.stop();f.db.close();});
 f.souls.cfg.accountAuthRequired=true;f.souls.cfg.inviteRequired=false;
 const identities=new Map<string,AccountIdentity>();for(const name of ['alice','bob']){const id='did:privy:'+name;f.db.upsertUser({id,email:null,wallet:null,role:'user'});identities.set(name,{id,issuer:'privy.io/test-app',subject:id,verifiedAt:Date.now(),expiresAt:Date.now()+60000});}
 // This fixture supplies already-verified identities at the provider boundary;
 // JWT verification is qualified separately. No provider/network is contacted.
 f.auth.accountFromToken=async token=>{const identity=identities.get(token??'');return identity?{identity,user:f.db.user(identity.id)!}:null;};
 const originalAuth=f.auth.userFromToken.bind(f.auth);f.auth.userFromToken=async token=>identities.has(token??'')?f.db.user(identities.get(token!)!.id)!:originalAuth(token);
 const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,souls:f.souls,brain:f.brain,auth:f.auth,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 const request=(path:string,body?:unknown,token?:string,method=body===undefined?'GET':'POST')=>app.request(path,{method,headers:{host:'127.0.0.1:4956',...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const secret=randomBytes(32).toString('base64url'),input={name:'Account Avery',agentLabel:'independent agent',idempotencyKey:'test-idempotency-0001',pollSecret:secret};
 assert.equal((await request('/v1/souls',{name:'Anonymous'})).status,401);
 assert.equal((await request('/v1/souls',{name:'Direct bypass'},'alice')).status,403);
 assert.throws(()=>f.souls.acceptLifecycleCreate('did:privy:alice',{name:'Internal bypass'}),/approve/);
 const first=await request('/v1/agent/approval/start',input);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');const started:any=await first.json(),id=started.approval.id;
 assert.equal(started.approval.status,'pending');assert.equal(started.approval.soulId,null);assert.ok(started.approvalURL.endsWith('/w/eden/#approve/'+id));assert.ok(!JSON.stringify(started).includes(secret));
 assert.equal((await request('/v1/account/approvals/'+id)).status,401);
 assert.equal((await request('/v1/agent/approval/poll',{approvalId:id,pollSecret:randomBytes(32).toString('base64url')})).status,401);
 assert.equal((await request('/v1/account/approvals/'+id+'/approve',{},'alice')).status,200);
 assert.equal((await request('/v1/account/approvals/'+id+'/approve',{},'bob')).status,403);
 assert.equal((await request('/v1/account/approvals/'+id+'/approve',{},'alice')).status,200);
 assert.equal(f.db.soulsOf('did:privy:alice').length,1);
 let result:any;for(let i=0;i<50;i++){await setImmediate();f.host.drainInputs();result=await (await request('/v1/agent/approval/poll',{approvalId:id,pollSecret:secret})).json();if(result.token)break;}
 assert.equal(result.status,'ready');assert.ok(result.token);const sid=result.soulId,row=f.db.soul(sid)!;assert.equal(f.souls.controlReady(row),true);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='birth'&&e.payload.soulId===sid).length,1);
 assert.equal((await (await request('/v1/agent/approval/poll',{approvalId:id,pollSecret:secret})).json() as any).token,result.token,'repeat polling recovers same delegate');
 const me:any=await (await request('/v1/me',undefined,'alice')).json();assert.deepEqual(me.me.souls,[sid]);assert.equal((await request('/v1/souls/'+sid,undefined,'bob')).status,403);
 const delegate:any=await (await request('/v1/agent/account-me',undefined,result.token)).json();assert.equal(delegate.souls[0].id,sid);assert.equal(delegate.me.email,null);assert.equal(delegate.me.wallet,null);assert.notEqual(delegate.me.id,'did:privy:alice');
 const guard=f.souls.agentControlGuard(row,result.token)!;assert.equal(guard(),true);
 const profiles=new SoulProfiles(f.host,f.souls),pending=profiles.update(row.owner,sid,{name:'Revoked queued rename'},guard);pending.catch(()=>{});
 assert.equal((await request('/v1/account/souls/'+sid+'/revoke',{},'bob')).status,403);
 assert.equal((await request('/v1/account/souls/'+sid+'/revoke',{},'alice')).status,200);f.host.drainInputs();await assert.rejects(pending,/invalid soul token/);
 assert.equal(f.db.soul(sid)!.name,'Account Avery');assert.equal(f.souls.soulFromToken(result.token),null);assert.equal((await request('/v1/agent/account-me',undefined,result.token)).status,401);
 const repairSecret=randomBytes(32).toString('base64url'),repair:any=await (await request('/v1/agent/approval/start',{...input,soulId:sid,name:row.name,idempotencyKey:'test-repair-0002',pollSecret:repairSecret})).json();
 assert.equal((await request('/v1/account/approvals/'+repair.approval.id+'/approve',{},'alice')).status,200);const repaired:any=await (await request('/v1/agent/approval/poll',{approvalId:repair.approval.id,pollSecret:repairSecret})).json();assert.equal(repaired.status,'ready');assert.notEqual(repaired.token,result.token);assert.equal(repaired.soulId,sid);assert.equal(f.db.soulsOf('did:privy:alice').length,1);
 const reconstructed=new WorldAccounts(f.host,f.souls);assert.equal(reconstructed.store.resolveGrant(repaired.token)?.soulId,sid,'new service/store instance resolves durable grant');assert.equal(reconstructed.store.resolveGrant(result.token),null);
 assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('account associations preserve legacy body/history and valid agent startup; unrelated account and revoked old owner cannot bypass',async t=>{
 const f=fixture(':memory:',factory);f.brain.quiesce();f.souls.enableLifecycle();t.after(()=>{f.host.stop();f.db.close();});const legacy='agent-'+'c'.repeat(24);await invite(f,legacy);
 const born:any=await (await accept(f.host,f.request('/v1/souls',{name:'Legacy Lark'},legacy))).json(),sid=born.soul.id,row=f.db.soul(sid)!,canonical={owner:row.owner,entity:row.entity_id},operation=f.souls.lifecycle!.journal.creationOfSoul(f.host.worldId,sid)!;
 const pair:any=await (await f.request('/v1/souls/'+sid+'/pair',{},legacy)).json(),exchange:any=await (await f.app.request('/v1/agent/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair.code})})).json();assert.ok(exchange.token);const originalEvents=f.db.events(f.host.worldId),originalHash=f.host.engine.stateHash();
 f.souls.cfg.accountAuthRequired=true;f.souls.cfg.inviteRequired=false;f.auth.devAuth=false;const identity:AccountIdentity={id:'did:privy:gene-fixture',issuer:'privy.io/test-app',subject:'did:privy:gene-fixture',verifiedAt:Date.now(),expiresAt:Date.now()+60000};f.db.upsertUser({id:identity.id,email:null,wallet:null,role:'user'});
 const providerToken=Buffer.from(JSON.stringify({alg:'fixture-only'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({exp:Math.floor(identity.expiresAt/1000)})).toString('base64url')+'.synthetic';
 const previous=f.auth.userFromToken.bind(f.auth);f.auth.userFromToken=async token=>token===providerToken?f.db.user(identity.id)!:previous(token);f.auth.accountFromToken=async token=>token===providerToken?{identity,user:f.db.user(identity.id)!}:null;
 const optedBrain=new Brain(f.host,f.db,f.souls.cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true});optedBrain.quiesce();t.after(()=>optedBrain.quiesce());const intentV2=new IntentControlV2(f.host,optedBrain,f.souls,{historyV1:true});const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,auth:f.auth,souls:f.souls,brain:optedBrain,intentV2,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 const req=(path:string,token?:string,body?:unknown)=>app.request(path,{method:body===undefined?'GET':'POST',headers:{...(token?{authorization:'Bearer '+(token==='verified-gene'?providerToken:token)}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await req('/v1/me','dev:'+legacy)).status,200);assert.equal((await req('/v1/me','dev:agent-'+'d'.repeat(24))).status,401);assert.equal(f.db.user('dev:agent-'+'d'.repeat(24)),undefined);assert.equal((await req('/v1/agent/me',exchange.token)).status,200);assert.equal((await req('/v1/souls/'+sid+'/pair','dev:'+legacy,{})).status,401);
 assert.equal((await req('/v1/lifecycle/'+operation.requestId,'verified-gene')).status,404);
 // Synthetic source-reviewed association ONLY. This does not qualify actual
 // Gene attribution or select an allowlist for a public deployment.
 f.souls.accounts!.store.associate(identity,sid,{attribution:'synthetic-creator-proof',evidenceHash:'f'.repeat(64)});
 const owned:any=await (await req('/v1/me','verified-gene')).json();assert.ok(owned.me.souls.includes(sid));assert.equal((await req('/v1/lifecycle/'+operation.requestId,'verified-gene')).status,200);const history:any=await (await req('/v1/lifecycle','verified-gene')).json();assert.equal(history.requests[0].soulId,sid);
 const scope=intentV2.ownerScope({userId:identity.id,expiresAt:identity.expiresAt},sid);assert.equal(intentV2.guard(scope),true);assert.deepEqual(scope.source,{kind:'owner',ownerId:canonical.owner,principalId:identity.id,channel:'web'});const currentControl=intentV2.ownerControl(scope)!;assert.equal(currentControl.ownerId,canonical.owner);assert.equal(currentControl.accountOwnerId,identity.id);assert.equal((await (await req('/v1/souls/'+sid,'verified-gene')).json() as any).control.accountOwnerId,identity.id);
 assert.deepEqual(f.db.events(f.host.worldId),originalEvents);assert.equal(f.host.engine.stateHash(),originalHash);assert.deepEqual({owner:f.db.soul(sid)!.owner,entity:f.db.soul(sid)!.entity_id},canonical);assert.equal(f.souls.soulFromToken(exchange.token)?.id,sid);const legacyStartup:any=await (await req('/v1/me','dev:'+legacy)).json();assert.ok(legacyStartup.me.souls.includes(sid),'association preserves valid legacy client startup');
 assert.equal((await req('/v1/account/souls/'+sid+'/revoke','verified-gene',{})).status,200);assert.equal(f.souls.soulFromToken(exchange.token),null);assert.equal((await req('/v1/me','dev:'+legacy)).status,401);assert.equal((await req('/v1/souls/'+sid+'/pair','dev:'+legacy,{})).status,401);assert.equal((await req('/v1/lifecycle/'+operation.requestId,'verified-gene')).status,200);
 assert.deepEqual(f.db.events(f.host.worldId),originalEvents);assert.deepEqual({owner:f.db.soul(sid)!.owner,entity:f.db.soul(sid)!.entity_id},canonical);assert.equal(f.db.paidCost(),0);
});
