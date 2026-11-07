import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Auth} from './auth.ts';import {Db} from './db.ts';import {config} from './config.ts';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {AccountRegistry} from './account-registry.ts';
import {fixture} from '../test/native-owner-fixture.ts';import {buildApp} from './http.ts';import type {Hub} from './hub.ts';
import {randomBytes} from 'node:crypto';import {setImmediate} from 'node:timers/promises';import {spawnSync} from 'node:child_process';
test('Clerk exact verified issuer and origin bind opaque shared identity, never metadata or disabled Privy',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-clerk-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const issuer='https://clerk.example.test',origin='https://sim.example.test';
 const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'fixture',alg:'RS256'};
 const original=globalThis.fetch;let fetches=0;globalThis.fetch=async input=>{assert.equal(String(input),issuer+'/.well-known/jwks.json');fetches++;return new Response(JSON.stringify({keys:[jwk]}));};t.after(()=>globalThis.fetch=original);
 const cfg={...config,authProvider:'clerk' as const,accountAuthRequired:true,clerkIssuer:issuer,clerkPublishableKey:'pk_live_'+Buffer.from('clerk.example.test$').toString('base64'),clerkAuthorizedParties:[origin],publicUrl:origin+'/w/eden',accountRegistryPath:join(dir,'accounts.sqlite'),privyAppId:'MUST_NOT_INITIALIZE',privyAppSecret:'synthetic-unused',adminEmails:['admin@example.test']};
 const db=new Db(':memory:'),auth=new Auth(cfg,db);auth.devAuth=false;await auth.init();t.after(()=>{auth.close();db.close();});assert.equal(fetches,0);
 const sign=async(extra:Record<string,unknown>={},iss=issuer)=>new SignJWT({sid:'sess_fixture',azp:origin,email:'admin@example.test',...extra}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject(typeof extra.sub==='string'?extra.sub:'user_alice').setIssuer(iss).setIssuedAt().setNotBefore('0s').setExpirationTime(typeof extra.exp==='number'?extra.exp:'60s').sign(privateKey);
 const forged=(await sign()).split('.');forged[2]=(forged[2][0]==='a'?'b':'a')+forged[2].slice(1);
 for(const token of [forged.join('.'),'user_alice','admin@example.test','dev:admin',await sign({},'https://other.example.test'),await sign({azp:'https://evil.example.test'}),await sign({sid:null}),await sign({exp:1})])assert.equal(await auth.accountFromToken(token),null);
 const account=await auth.accountFromToken(await sign());assert.ok(account);assert.match(account.identity.id,/^acct_/);assert.notEqual(account.identity.id,account.identity.subject);assert.equal(account.user.email,null);assert.equal(account.user.role,'user');assert.equal(account.identity.subject,'user_alice');assert.equal(auth.me(account.user).userId,account.identity.id);
 const secondDb=new Db(':memory:'),second=new Auth({...cfg,worldId:'other-world'},secondDb);second.devAuth=false;await second.init();assert.equal((await second.accountFromToken(await sign()))?.identity.id,account.identity.id);second.close();secondDb.close();
 const reopened=new AccountRegistry(cfg.accountRegistryPath);assert.equal(reopened.bind(issuer,'user_alice'),account.identity.id);assert.notEqual(reopened.bind('https://other.example.test','user_alice'),account.identity.id);assert.notEqual(reopened.bind(issuer,'user_bob'),account.identity.id);reopened.close();
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import {AccountRegistry} from "+JSON.stringify(new URL('./account-registry.ts',import.meta.url).href)+";const r=new AccountRegistry(process.argv[1]);console.log(JSON.stringify({pid:process.pid,id:r.bind(process.argv[2],process.argv[3])}));r.close();",cfg.accountRegistryPath,issuer,'user_alice'],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);const restored=JSON.parse(child.stdout);assert.notEqual(restored.pid,process.pid);assert.equal(restored.id,account.identity.id);
 const f=fixture(':memory:',await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true}));t.after(()=>{f.host.stop();f.auth.close();f.db.close();});f.brain.quiesce();f.souls.enableLifecycle();Object.assign(f.souls.cfg,cfg,{worldId:f.host.worldId,inviteRequired:false});f.auth.devAuth=false;await f.auth.init();
 const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,souls:f.souls,brain:f.brain,auth:f.auth,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 const alice=await sign(),bob=await sign({sub:'user_bob'});
 const hostileHeaders={host:'preview.trycloudflare.com','x-forwarded-host':'evil.example.test','x-forwarded-proto':'https'};const publicConfig:any=await(await app.request('/v1/config',{headers:hostileHeaders})).json();assert.equal(publicConfig.authenticationOrigin,origin);assert.equal(publicConfig.publicUrl,'https://evil.example.test'+f.souls.cfg.worldPath);assert.equal(publicConfig.devAuth,false);

 const request=(path:string,body?:unknown,token?:string,extraHeaders:Record<string,string>={})=>app.request(path,{method:body===undefined?'GET':'POST',headers:{...extraHeaders,...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await request('/v1/souls',{name:'Unsigned'})).status,401);assert.equal((await request('/v1/souls',{name:'Bypass'},alice)).status,403);
 const binding=await request('/v1/account/session',undefined,alice);assert.equal(binding.headers.get('cache-control'),'no-store');assert.deepEqual(await binding.json(),{accountId:account.identity.id,issuer,subject:'user_alice'});
 const secret=randomBytes(32).toString('base64url'),start=await request('/v1/agent/approval/start',{name:'Clerk Avery',agentLabel:'independent fixture',idempotencyKey:'clerk-fixture-00001',pollSecret:secret},undefined,hostileHeaders);assert.equal(start.status,200);const started:any=await start.json(),id=started.approval.id;assert.equal(started.approvalURL,origin+'/w/eden/#approve/'+id);
 assert.equal((await request('/v1/account/approvals/'+id+'/approve',{},alice)).status,200);assert.equal((await request('/v1/account/approvals/'+id+'/approve',{},bob)).status,403);
 let delegated:any;for(let i=0;i<50;i++){await setImmediate();f.host.drainInputs();delegated=await(await request('/v1/agent/approval/poll',{approvalId:id,pollSecret:secret})).json();if(delegated.token)break;}
 assert.equal(delegated.status,'ready');assert.ok(delegated.token);assert.equal(f.db.soul(delegated.soulId)?.owner,account.identity.id);
 assert.equal((await request('/v1/souls/'+delegated.soulId,undefined,bob)).status,403);assert.equal((await request('/v1/agent/account-me',undefined,delegated.token)).status,200);
 assert.equal((await request('/v1/souls/'+delegated.soulId+'/revoke',{},alice)).status,200);assert.equal((await request('/v1/agent/account-me',undefined,delegated.token)).status,401);
 const none=new Auth({...cfg,authProvider:'none'},db);await none.init();assert.equal(await none.accountFromToken(await sign()),null);
});
test('Clerk activation rejects test keys, mismatched issuer, missing origin and missing shared registry',async()=>{
 const db=new Db(':memory:');const base={...config,accountAuthRequired:true,authProvider:'clerk' as const,publicUrl:'https://sim.example.test',clerkIssuer:'https://clerk.example.test',clerkPublishableKey:'pk_live_'+Buffer.from('clerk.example.test$').toString('base64'),clerkAuthorizedParties:['https://sim.example.test'],accountRegistryPath:':memory:'};
 try{for(const change of [{clerkPublishableKey:'pk_test_invalid'},{clerkIssuer:'https://wrong.example.test'},{clerkAuthorizedParties:[]},{accountRegistryPath:''}])await assert.rejects(new Auth({...base,...change},db).init());}finally{db.close();}
});
test('selected Clerk refuses construction before omitted init can enable anonymous dev fallback',async()=>{
 const db=new Db(':memory:');
 try{
  for(const publicUrl of ['http://127.0.0.1:4959','https://sim.example.test/w/eden']){
   assert.throws(()=>new Auth({...config,authProvider:'clerk',accountAuthRequired:false,publicUrl,privyAppId:'synthetic-disabled',privyAppSecret:'synthetic-disabled'},db),/Clerk activation requires ACCOUNT_AUTH_REQUIRED=1/);
  }
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n,0);
  // Existing explicit local/legacy flows retain their original semantics.
  const legacy=new Auth({...config,authProvider:'privy',accountAuthRequired:false,publicUrl:'http://127.0.0.1:4959'},db);legacy.devAuth=true;assert.ok(await legacy.userFromToken('dev:agent-'+'b'.repeat(24)));legacy.close();
 }finally{db.close();}
});
