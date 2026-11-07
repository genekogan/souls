import {Hono} from 'hono';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {setImmediate} from 'node:timers/promises';
import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {createSoulSchema,publicEvent} from '@souls/protocol';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {hereFrame} from './edge/perception/here.ts';
import {mountBootRoutes} from './edge/boot/routes.ts';
import {terminalSnapshot} from './edge/outcomes/providers.ts';
import {WorldHost,replayFromGenesis} from './world.ts';
import {SoulProfiles} from './soul-profile.ts';
import {validateProfilePNG} from './profile-png.ts';
import {projectLifecycle} from './lifecycle-runner.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
function crc(data:Buffer){let n=0xffffffff;for(const b of data){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function png(extra=false,width=1){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...(extra?[chunk('tEXt',Buffer.from('private metadata'))]:[]),chunk('IDAT',deflateSync(Buffer.alloc(width*4+1))),chunk('IEND',Buffer.alloc(0))]);}
const url=(b:Buffer)=>'data:image/png;base64,'+b.toString('base64');
function local(){const f=fixture(':memory:',factory);f.souls.enableLifecycle();f.brain.quiesce();return f;}
async function drive<T>(f:ReturnType<typeof fixture>,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);const until=performance.now()+4000;while(!done&&performance.now()<until){await setImmediate();f.host.drainInputs();}assert.ok(done);return p;}
async function born(f:ReturnType<typeof fixture>,owner='alice',name='Avery Original'){await invite(f,owner);const response=await drive(f,f.request('/v1/souls',{name},owner));assert.equal(response.status,200);const data:any=await response.json();const s=f.db.soul(data.soul.id)!;assert.equal(s.description,'A new Soul.');return s;}

test('name-only uses canonical default; PNG is bounded, fully validated and strips metadata without fetching',()=>{
 assert.deepEqual(createSoulSchema.parse({name:'New Soul'}),{name:'New Soul',description:'A new Soul.'});
 assert.equal(createSoulSchema.parse({name:'New Soul',description:'An explicit character'}).description,'An explicit character');
 const validated=validateProfilePNG(url(png(true)));assert.deepEqual(validated.image,png());assert.equal(validated.photo.width,1);
 for(const bad of ['https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zz4=',url(png(false,513)),url(png().subarray(0,-1)),url(Buffer.from(png()).fill(0,30,31))])assert.throws(()=>validateProfilePNG(bad));
});

test('mounted owner rename/photo is atomic; identities/birth/physical pose, readiness, snapshot and genesis replay agree',async t=>{
 const f=local();t.after(()=>{f.host.stop();f.db.close();});const a=await born(f),b=await born(f,'bob','Briar Neighbour');
 const profile=new SoulProfiles(f.host,f.souls),originalBirth=f.db.events(f.host.worldId).find(e=>e.kind==='birth'&&e.payload.soulId===a.id)!;
 const operation=f.souls.lifecycle!.journal.creationOfSoul(f.host.worldId,a.id)!,originalOperation=structuredClone(operation);let physical=structuredClone(f.host.engine.world.entities[a.entity_id].pose);
 const oldNames=f.db.db.prepare('SELECT id,owner,entity_id,created_at FROM souls ORDER BY id').all();
 const ledger=new EdgeLedger(f.host,f.db),comms=registerEdgeComms(new Hono(),{host:f.host,db:f.db,souls:f.souls,build:'test',soul:()=>{throw Error('unused authenticated route');},ledger},{fetch:null});t.after(()=>comms.close());
 const actor=(id:string)=>{const m=f.host.minds.get(id)!;return {soulId:id,entityId:m.entityId,name:m.name,owner:m.owner};};
 const start=comms.conversations.handle(actor(a.id),{op:'start',with:[b.id],text:'Before rename'});assert.equal(start.accepted,true);const cv=String((start.conversation as {id:string}).id);
 assert.equal(comms.conversations.handle(actor(b.id),{op:'accept',conversation:cv}).accepted,true);
 const pending=await accept(f.host,ledger.act(actor(a.id),{capability:'rest:here',params:{seconds:10}}));assert.equal(pending.accepted,true);const nativeProgram=f.host.engine.programOf(a.entity_id);assert.ok(nativeProgram);physical=structuredClone(f.host.engine.world.entities[a.entity_id].pose);
 const eventHead=f.db.events(f.host.worldId).length;
 for(const [owner,payload,status] of [['bob',{name:'Stolen'},403],['alice',{name:b.name},409],['alice',{name:'Avery Current',expectedRevision:99},409],['alice',{name:'<invalid>'},400]] as const){const r=await f.request(`/v1/souls/${a.id}/profile`,payload,owner,'PATCH');assert.equal(r.status,status);assert.equal(f.db.events(f.host.worldId).length,eventHead);}
 const r=await drive(f,f.request(`/v1/souls/${a.id}/profile`,{name:'Avery Current',description:'Current character',expectedRevision:0},'alice','PATCH'));assert.equal(r.status,200);const result:any=await r.json();assert.equal(result.profile.soulId,a.id);assert.equal(result.profile.revision,1);
 assert.equal(f.host.engine.programOf(a.entity_id),nativeProgram,'rename does not interrupt the existing native programme');
 assert.deepEqual(f.db.db.prepare('SELECT id,owner,entity_id,created_at FROM souls ORDER BY id').all(),oldNames);assert.deepEqual(f.host.engine.world.entities[a.entity_id].pose,physical);
 for(const label of [f.db.soul(a.id)!.name,f.host.minds.get(a.id)!.name,f.host.engine.world.entities[a.entity_id].label,f.host.kernel.things[a.id].name])assert.equal(label,'Avery Current');
 assert.equal(f.host.publicSoul(f.host.minds.get(a.id)!).name,'Avery Current');assert.equal(f.souls.controlReady(f.db.soul(a.id)!),true);assert.equal(projectLifecycle(f.host,operation).ready,true);
 assert.deepEqual(f.souls.lifecycle!.journal.creationOfSoul(f.host.worldId,a.id),originalOperation);assert.deepEqual(f.db.events(f.host.worldId).find(e=>e.seq===originalBirth.seq),originalBirth);
 assert.equal((await (await f.request('/v1/me')).json() as any).souls[0].name,'Avery Current');
 const ownHere=hereFrame(ledger,{...actor(a.id),name:'Avery Original'});assert.equal(ownHere.me.soulId,a.id);assert.equal(ownHere.me.name,'Avery Current');assert.equal(ownHere.me.profileRevision,1);
 const actualHere=hereFrame(ledger,actor(b.id));assert.equal(actualHere.near.find(n=>n.id===a.id)?.name,'Avery Current');
 const bootApp=new Hono();mountBootRoutes(bootApp,{host:f.host,db:f.db,souls:f.souls,build:'test',soul:()=>actor(a.id),ledger},[]);const boot:any=await (await bootApp.request('/v1/edge/boot')).json();assert.equal(boot.me.name,'Avery Current');
 const directory=terminalSnapshot(ledger,actor(b.id),'use-computer').sections.find(s=>s.section==='directory')!;assert.equal((directory.rows.find((r:any)=>r.soulId===a.id) as any).name,'Avery Current');
 const profileEvent=f.db.events(f.host.worldId).find(e=>e.payload?.soulProfileV1)!;assert.equal(publicEvent(profileEvent).payload.soulProfileV1.owner,'someone');
 const view:any=comms.conversations.list(actor(b.id));assert.equal(view.conversations[0].members.find((m:any)=>m.soulId===a.id).name,'Avery Current');
 assert.equal(comms.conversations.handle(actor(a.id),{op:'say',conversation:cv,text:'After rename'}).accepted,true);
 const turns:any=comms.conversations.turns(actor(b.id),cv,0);assert.equal(turns.turns.find((x:any)=>x.text==='After rename').from.name,'Avery Current');
 const savedTurns=f.db.db.prepare('SELECT * FROM edge_comms_turns ORDER BY seq').all();const bodies=f.db.db.prepare('SELECT body FROM edge_comms_conversations').all();
 const photo=await drive(f,f.request(`/v1/souls/${a.id}/photo`,{dataUrl:url(png(true))}));assert.equal(photo.status,200);const dto:any=await photo.json();assert.equal(dto.profile.photo.mime,'image/png');assert.equal(dto.profile.revision,2);
 const image=await f.request(`/v1/souls/${a.id}/profile-photo/${dto.profile.photo.hash}`);assert.equal(image.status,200);assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png());
 assert.deepEqual(f.db.db.prepare('SELECT * FROM edge_comms_turns ORDER BY seq').all(),savedTurns);assert.deepEqual(f.db.db.prepare('SELECT body FROM edge_comms_conversations').all(),bodies);
 const seq=f.host.seq;assert.equal((await f.request(`/v1/souls/${a.id}/photo`,{dataUrl:'https://169.254.169.254'})).status,400);assert.equal(f.host.seq,seq);
 f.db.db.exec("CREATE TRIGGER fail_profile BEFORE UPDATE ON souls WHEN NEW.name='Fail Atomic' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");await assert.rejects(()=>drive(f,profile.update(a.owner,a.id,{name:'Fail Atomic'})));assert.equal(f.host.seq,seq);assert.equal(f.db.soul(a.id)!.name,'Avery Current');assert.equal(f.host.minds.get(a.id)!.name,'Avery Current');f.db.db.exec('DROP TRIGGER fail_profile');
 const first=profile.update(a.owner,a.id,{name:'Avery Next',expectedRevision:2}),second=profile.update(a.owner,a.id,{name:'Avery Race',expectedRevision:2});const all=Promise.allSettled([first,second]);await drive(f,all);const settled=await all;assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);assert.equal(settled.filter(x=>x.status==='rejected').length,1);
 await drive(f,profile.update(b.owner,b.id,{name:'Avery Current'}));assert.equal(f.host.soulNameRefusal('Avery Current'),'soul.name-ambiguous');assert.deepEqual(f.host.publicNameMetadata(b.id),{nameAmbiguous:true});assert.equal(f.souls.resolveThing('Avery Current'),null);assert.equal(f.souls.resolveThing(a.id),a.id);
 const historic:any=comms.conversations.turns(actor(b.id),cv,0);const after=historic.turns.find((x:any)=>x.text==='After rename');assert.equal(after.from.name,'Avery Current');assert.equal(after.from.currentName,'Avery Next');assert.equal(after.from.nameSource,'at-turn');
 const replayedTurn:any=comms.spectatorJoin().find((m:any)=>m.kind==='conversation.turn'&&m.turn?.text==='After rename');assert.equal(replayedTurn.turn.from.name,'Avery Current');assert.equal(replayedTurn.turn.from.currentName,'Avery Next');assert.equal(replayedTurn.members.find((m:any)=>m.soulId===a.id).name,'Avery Next');
 assert.equal(hereFrame(ledger,actor(a.id)).near.find(n=>n.id===b.id)?.nameAmbiguous,true);const group:any=comms.conversations.list(actor(a.id));assert.equal(group.conversations[0].members.find((m:any)=>m.soulId===b.id).nameAmbiguous,true);
 f.host.saveSnapshot(true);const hashes={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 const restored=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId);restored.boot();assert.deepEqual({engine:restored.engine.stateHash(),kernel:kernelHash(restored.kernel)},hashes);assert.equal(restored.currentProfileName(a.id,originalBirth.payload.name),'Avery Next');assert.equal(projectLifecycle(restored,operation).ready,true);assert.equal(restored.profilePhoto(a.id)?.hash,dto.profile.photo.hash);restored.stop();
 const replay=replayFromGenesis(factory,f.host.seed,f.db.events(f.host.worldId),f.host.engine.world.tick,{includeHeadEvents:true});assert.deepEqual({engine:replay.engine.stateHash(),kernel:kernelHash(replay.kernel)},hashes);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});

test('instructions serving substitutes the actual prefixed base, keeps skill and reports unavailable source honestly',async t=>{
 const f=local();t.after(()=>f.db.close());const dir=mkdtempSync(join(tmpdir(),'soul-instructions-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const instructions=join(dir,'instructions.md'),skill=join(dir,'skill.md');writeFileSync(instructions,'Create a Soul in {{WORLD}} at {{BASE}}/eden-agent.mjs');writeFileSync(skill,'Skill {{BASE}}');
 const app=buildApp({cfg:{...config,worldKey:'eden',worldPath:'/w/eden',instructionsFile:instructions,skillFile:skill},db:f.db,host:f.host,auth:f.auth,brain:f.brain,souls:f.souls,hub:{clients:new Map(),refreshMe(){}} as any});
 const headers={host:'localhost:4959'};assert.equal(await (await app.request('/instructions.md',{headers})).text(),'Create a Soul in Eden at http://localhost:4959/w/eden/eden-agent.mjs');assert.equal(await (await app.request('/skill.md',{headers})).text(),'Skill http://localhost:4959/w/eden');const cfg:any=await (await app.request('/v1/config',{headers})).json();assert.equal(cfg.instructionsURL,'http://localhost:4959/w/eden/instructions.md');
 rmSync(instructions);assert.equal((await app.request('/instructions.md',{headers})).status,503);
});


test('queued profile guard rechecks current owner/invitation; foreign, retired, anonymous and admin substitution refuse',async t=>{
 const f=local();t.after(()=>{f.host.stop();f.db.close();});const a=await born(f),service=new SoulProfiles(f.host,f.souls);
 const head=f.host.seq;
 const anonymous=await f.app.request(`/v1/souls/${a.id}/profile`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Anonymous rename'})});assert.equal(anonymous.status,401);
 assert.equal((await f.request(`/v1/souls/${a.id}/profile`,{name:'Admin substitute'},'admin','PATCH')).status,403);
 const queued=service.update(a.owner,a.id,{name:'Withdrawn'});f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run(a.owner);await assert.rejects(()=>drive(f,queued));assert.equal(f.host.seq,head);assert.equal(f.db.soul(a.id)!.name,a.name);f.db.db.prepare('UPDATE users SET invited_by=? WHERE id=?').run('fixture-restored',a.owner);
 f.db.createWorld({id:'other-world',schema:'fixture',rules_version:factory.rulesVersion,dt:.05,seed:'other'});f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other-world',a.id);assert.equal((await f.request(`/v1/souls/${a.id}/profile`,{name:'Wrong world'},'alice','PATCH')).status,404);f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run(f.host.worldId,a.id);
 f.db.db.prepare('UPDATE souls SET retired_at=1 WHERE id=?').run(a.id);assert.equal((await f.request(`/v1/souls/${a.id}/photo`,{dataUrl:url(png())})).status,404);assert.equal(f.host.seq,head);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM soul_profile_photos_v1').get()!.n,0);
});
