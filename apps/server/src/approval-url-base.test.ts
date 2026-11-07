// Lane AU (hotfix 2026-10-20): the approval link an agent prints must open the world it came from. Live 3.57 handed
// https://sim.eden.art/#approve/ap_… for /worlds/w/bench-hamlet: a launcher child runs with PUBLIC_URL = the bare origin
// and WORLD_PATH = /worlds/w/<slug>, and under Clerk the account routes used PUBLIC_URL alone, so the link landed on the
// site root (the legacy /w/eden world), where that approval does not exist. The legacy servers set PUBLIC_URL to
// origin + world path, which is why /w/eden was right. Both shapes must give <origin><world path>, never the Host header.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {config,publicWorldBase} from './config.ts';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {fixture} from '../test/native-owner-fixture.ts';import {buildApp} from './http.ts';import type {Hub} from './hub.ts';

const origin='https://sim.example.test';

test('publicWorldBase: launcher child (bare origin) and legacy root world (origin + path) both give origin + world path',()=>{
 assert.equal(publicWorldBase({publicUrl:origin,worldPath:'/worlds/w/bench-hamlet'}),origin+'/worlds/w/bench-hamlet');
 assert.equal(publicWorldBase({publicUrl:origin+'/',worldPath:'/worlds/w/bench-hamlet'}),origin+'/worlds/w/bench-hamlet');
 assert.equal(publicWorldBase({publicUrl:origin+'/w/eden',worldPath:'/w/eden'}),origin+'/w/eden');
 assert.equal(publicWorldBase({publicUrl:origin+'/worlds/w/mars',worldPath:'/worlds/w/mars'}),origin+'/worlds/w/mars');
 assert.equal(publicWorldBase({publicUrl:'http://localhost:6670',worldPath:'/w/toy'}),'http://localhost:6670/w/toy');
});

for(const shape of [
 {name:'launcher-mounted world',publicUrl:origin,worldPath:'/worlds/w/bench-hamlet'},
 {name:'legacy root world',publicUrl:origin+'/w/eden',worldPath:'/w/eden'},
]) test(`Clerk approvalURL and world.url carry the world's public base: ${shape.name}`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-au-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cfg={...config,authProvider:'clerk' as const,accountAuthRequired:true,clerkIssuer:'https://clerk.example.test',clerkPublishableKey:'pk_live_'+Buffer.from('clerk.example.test$').toString('base64'),clerkAuthorizedParties:[origin],publicUrl:shape.publicUrl,worldPath:shape.worldPath,accountRegistryPath:join(dir,'accounts.sqlite'),privyAppId:'MUST_NOT_INITIALIZE',privyAppSecret:'synthetic-unused'};
 const f=fixture(':memory:',await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true}));t.after(()=>{f.host.stop();f.auth.close();f.db.close();});f.brain.quiesce();f.souls.enableLifecycle();Object.assign(f.souls.cfg,cfg,{worldId:f.host.worldId,inviteRequired:false});f.auth.devAuth=false;await f.auth.init();
 const app=buildApp({cfg:f.souls.cfg,db:f.db,host:f.host,souls:f.souls,brain:f.brain,auth:f.auth,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
 // what the launcher forwards from Caddy, plus a hostile forwarded host that must not reach the link
 const headers={host:'sim.example.test','x-forwarded-proto':'https','x-forwarded-host':'evil.example.test','content-type':'application/json'};
 const pollSecret=randomBytes(32).toString('base64url');
 const res=await app.request('/v1/agent/approval/start',{method:'POST',headers,body:JSON.stringify({name:'Base Avery',agentLabel:'au fixture',idempotencyKey:'au-fixture-000001',pollSecret})});
 assert.equal(res.status,200);const started:any=await res.json(),id=started.approval.id;
 assert.equal(started.approvalURL,origin+shape.worldPath+'/#approve/'+id);
 assert.equal(started.world.url,origin+shape.worldPath);
 const cancel:any=await(await app.request('/v1/agent/approval/cancel',{method:'POST',headers,body:JSON.stringify({approvalId:id,pollSecret})})).json();
 assert.equal(cancel.approval.status,'cancelled');assert.equal(cancel.world.url,origin+shape.worldPath);
});
