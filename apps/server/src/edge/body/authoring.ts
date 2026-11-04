import {readFileSync} from 'node:fs';
import type {Context,Hono} from 'hono';
import {BODY_LIMITS,QUADRUPED_FOOTPRINT_RADIUS} from './admission.ts';
import {ROLLING_ACTIONS,QUADRUPED_ACTIONS} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';
import {requestWorldBase} from '../../world-base.ts';
import {MOTION_LIMITS} from '../../../../../mars/viewer/engine/bodies/motion.ts';

/** A fixed allowlist: a downloaded skill and the identical dependency-free admission implementation. */
export function mountBodyAuthoring(app:Hono,prefix:string,types:string[]){
 // The skill's links follow the world's own base rule (proxy-forwarded scheme and host), never the proxied hop's http URL.
 const base=(c:Context)=>requestWorldBase(prefix,name=>c.req.header(name),()=>new URL(c.req.url).origin+prefix)+'/body-authoring';
 const at=(file:string)=>new URL('../../../../../'+file,import.meta.url);
 const files={
  'SKILL.md':at('tools/body-authoring/SKILL.md'),
  'validate.mjs':at('tools/body-authoring/validate.mjs'),
  'upload.mjs':at('tools/body-authoring/upload.mjs'),
  'example.json':at('tools/body-authoring/example.json'),
  'admission.ts':new URL('./admission.ts',import.meta.url),
  'rig.ts':new URL('./rig.ts',import.meta.url),
  'upload-validation.ts':new URL('../../moderation/validate.ts',import.meta.url),
  'action-profile.ts':at('mars/viewer/engine/bodies/action-profile.ts'),
  'motion.ts':at('mars/viewer/engine/bodies/motion.ts'),
 };
 app.get('/body-authoring/contract.json',c=>c.json({contract:'body-authoring/1',limits:BODY_LIMITS,types,motionLimits:MOTION_LIMITS,
  manifest:{required:['type','license','rightsConfirmed'],fields:{type:['humanoid','ceramic','floater'],license:['CC0','owned'],rightsConfirmed:true,rig:'quaternius/1 (required for humanoids)',name:{minLength:1,maxLength:80},description:{minLength:1,maxLength:240},actionProfile:'rolling-gripper/1 or quadruped-torso/1 (canonical rig, Dance_Loop and Standby_Loop required; quadruped-torso/1 keeps the lower body inside the 0.28 m disc)',motion:{contract:'body-motion/1',required:['idle','move','rest'],optional:['dance'],adapterFields:['period','bob','pitch','roll','yaw']}}},
  profiles:{rollingGripper:ROLLING_ACTIONS,quadrupedTorso:{...QUADRUPED_ACTIONS,footprintRadius:QUADRUPED_FOOTPRINT_RADIUS},humanoid:{rig:'quaternius/1',clips:['Idle','Walk'],actions:'existing canonical humanoid adapters'},rigid:{support:'ground navigation',radius:.35,hoverHeight:1.45,meshExtent:.7,core:['move','stop','orient','rest','observe','speak'],dance:'requires admitted motion.dance',otherPhysical:{supported:false,reason:'This profile has no hands, seat, swim or ride adaptations.'}}},
  selection:{default:'humanoid',presets:'shared',uploads:'owner-only in the admitting world',discovery:'GET /v1/edge/body'},
 }));
 for(const [file,path]of Object.entries(files))app.get('/body-authoring/'+file,c=>{
  let text=readFileSync(path,'utf8');
  if(file==='SKILL.md')text=text.replaceAll('{{BASE}}',base(c));
  if(file==='admission.ts')text=text.replace('../../../../../mars/viewer/engine/bodies/motion.ts','./motion.ts').replace('../../../../../mars/viewer/engine/bodies/action-profile.ts','./action-profile.ts');
  const type=file.endsWith('.json')?'application/json':file.endsWith('.md')?'text/markdown':'text/javascript';
  return c.body(text,200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'});
 });
}
