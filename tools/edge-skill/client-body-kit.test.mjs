import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {bodyKit,parseKitArgs,rigidStarterGLB,keepClips,KIT_FILES,HUMANOID_SOURCE} from './client-body-kit.mjs';

const root=new URL('../../',import.meta.url);
const src={'SKILL.md':'tools/body-authoring/SKILL.md','validate.mjs':'tools/body-authoring/validate.mjs','upload.mjs':'tools/body-authoring/upload.mjs','example.json':'tools/body-authoring/example.json',
 'admission.ts':'apps/server/src/edge/body/admission.ts','rig.ts':'apps/server/src/edge/body/rig.ts','upload-validation.ts':'apps/server/src/moderation/validate.ts',
 'action-profile.ts':'mars/viewer/engine/bodies/action-profile.ts','motion.ts':'mars/viewer/engine/bodies/motion.ts'};
const TOKEN='secret-soul-token-0123456789';
/** The served kit: the same text substitutions the world's /body-authoring/ route makes. */
function served(file){
 if(file==='contract.json')return Buffer.from(JSON.stringify({contract:'body-authoring/1',types:['humanoid','ceramic','floater'],profiles:{rigid:{otherPhysical:{supported:false,reason:'This profile has no hands, seat, swim or ride adaptations.'}}}}));
 let t=readFileSync(new URL(src[file],root),'utf8');
 if(file==='admission.ts')t=t.replace('../../../../../mars/viewer/engine/bodies/motion.ts','./motion.ts').replace('../../../../../mars/viewer/engine/bodies/action-profile.ts','./action-profile.ts');
 return Buffer.from(t);
}
function world({types=['humanoid','ceramic','floater'],humanoid=null}={}){
 const seen=[];
 const fetchImpl=async(url,init={})=>{seen.push({url,auth:init.headers?.authorization});const path=new URL(url).pathname;
  const file=path.replace(/^\/w\/test\/body-authoring\//,'');
  const body=KIT_FILES.includes(file)?served(file):path===HUMANOID_SOURCE&&humanoid?humanoid:null;
  return body?{ok:true,status:200,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length)}:{ok:false,status:404};};
 const call=async path=>{assert.equal(path,'/v1/edge/body');return {status:200,data:{available:true,types,presets:[],body:null,uploads:[{assetId:'body_'+'a'.repeat(64),name:'Earlier',type:'ceramic'}],authoring:{skill:'/w/test/body-authoring/SKILL.md'}}};};
 return {fetchImpl,call,seen,load:()=>({world:'http://127.0.0.1:4199/w/test',token:TOKEN,soul:'s1'})};
}

test('kit args: dir, starter, seed and force', ()=>{
 assert.deepEqual(parseKitArgs(['k','--starter','rolling','--force']),{dir:'k',starter:'rolling',seed:1,force:true});
 assert.throws(()=>parseKitArgs([]),/usage/);assert.throws(()=>parseKitArgs(['k','--starter','dragon']),/rigid, humanoid or rolling/);
});

test('rigid kit: served files, a valid original starter, report and preview, no credential, refuses to overwrite', ()=>{
 return (async()=>{
 const dir=mkdtempSync(join(tmpdir(),'body-kit-'));try{
  const w=world(),out=await bodyKit([join(dir,'k')],w);
  assert.equal(out.validation.valid,true,JSON.stringify(out.validation));
  assert.equal(out.recover.uploads[0].name,'Earlier');
  for(const f of KIT_FILES)assert.deepEqual(readFileSync(join(dir,'k',f)),served(f),f);
  assert.ok(w.seen.every(s=>s.auth===undefined),'kit files are fetched without the Soul token');
  for(const f of readdirSync(join(dir,'k')))assert.ok(!readFileSync(join(dir,'k',f)).includes(TOKEN),f+' contains the token');
  const kit=JSON.parse(readFileSync(join(dir,'k','kit.json'),'utf8'));assert.equal(kit.starter,'rigid');assert.match(kit.files['validate.mjs'],/^sha256:[a-f0-9]{64}$/);
  const r=spawnSync(process.execPath,['validate.mjs','body.glb','manifest.json','--report','--preview','preview.html'],{cwd:join(dir,'k'),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const {report}=JSON.parse(r.stdout);
  assert.equal(report.profile,'rigid');assert.equal(report.world.typeAllowed,true);assert.deepEqual(report.requirements.adapters.present,['idle','move','rest','dance']);
  assert.ok(report.actions.refused.some(a=>a.action==='sit'&&/no hands, seat/.test(a.reason)));assert.ok(report.actions.supported.some(a=>a.action==='dance'));
  assert.equal(report.measured.fps,null);assert.equal(report.measured.contacts,null);assert.equal(report.repeated.copies[2].triangles,report.repeated.copies[0].triangles*20);
  assert.ok(report.budgets.every(b=>b.remaining>=0));
  const page=readFileSync(join(dir,'k','preview.html'),'utf8');assert.match(page,/Visual preview only/);assert.ok(page.includes(report.assetId));
  // A second run would replace the source: refused, nothing changed.
  const before=readFileSync(join(dir,'k','body.glb'));
  await assert.rejects(bodyKit([join(dir,'k'),'--seed','7'],world()),/already has .*body\.glb.*nothing was changed/);
  assert.deepEqual(readFileSync(join(dir,'k','body.glb')),before);
  await bodyKit([join(dir,'k'),'--seed','7','--force'],world());assert.notDeepEqual(readFileSync(join(dir,'k','body.glb')),before);
 }finally{rmSync(dir,{recursive:true,force:true});}})();
});

test('an over-budget body keeps its field/measured/limit error; a world policy refusal is named', async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'body-kit-'));try{
  await bodyKit([dir],world());
  const m=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  // five copies of the sculpture's one primitive: five draws against the rigid ceiling of four
  const b=rigidStarterGLB(1),n=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+n));j.meshes[0].primitives=Array(5).fill(j.meshes[0].primitives[0]);
  const js=Buffer.from(JSON.stringify(j)),pad=Buffer.alloc(Math.ceil(js.length/4)*4,32);js.copy(pad);const rest=b.subarray(20+n),out=Buffer.concat([b.subarray(0,20),pad,rest]);out.writeUInt32LE(out.length,8);out.writeUInt32LE(pad.length,12);
  writeFileSync(join(dir,'big.glb'),out);
  const r=spawnSync(process.execPath,['validate.mjs','big.glb','manifest.json','--report'],{cwd:dir,encoding:'utf8'});
  assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stderr).error.details,{field:'drawCalls',measured:5,limit:4});
  void m;
  await assert.rejects(bodyKit([join(dir,'h'),'--starter','rolling'],world()),/does not offer the shared rolling robot/);
  await assert.rejects(bodyKit([join(dir,'c')],world({types:['humanoid']})),/does not admit ceramic/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const casual=new URL('mars/viewer/public/modular/environment/animated-casual.glb',root);
test('humanoid kit: the canonical CC0 rig reduced to Idle and Walk passes admission with its clip requirements', {skip:!existsSync(casual)&&'canonical media not pulled (pnpm assets:pull)'}, async ()=>{
 const dir=mkdtempSync(join(tmpdir(),'body-kit-'));try{
  const out=await bodyKit([dir,'--starter','humanoid'],world({humanoid:readFileSync(casual)}));
  assert.equal(out.validation.valid,true,JSON.stringify(out.validation));
  const r=spawnSync(process.execPath,['validate.mjs','body.glb','manifest.json','--report'],{cwd:dir,encoding:'utf8'});
  const {report}=JSON.parse(r.stdout);assert.equal(report.profile,'humanoid');assert.deepEqual(report.requirements.clips.missing,[]);assert.equal(report.repeated.copies[1].skeletons,5);
  assert.throws(()=>keepClips(readFileSync(casual),['NoSuchClip']),/no NoSuchClip clip/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
