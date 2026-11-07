// Optional authored LM visits are data-bound self-only walks and rest, never
// actor/role programs or automatic assignments. Legacy worlds do not install it.
import type {Program} from '@souls/engine-contract';
import type {WorldHost} from '../world.ts';import type {EdgeSoul,EdgeCapability} from '../edge/contract.ts';
import {inPoly} from '../edge/ledger/places.ts';import type {WorldPlans} from './mars-edge.ts';
type Experience={id:string;place:string;at:[number,number];label:string;steps:Program['steps']};
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(k=>allowed.includes(k));
export function validatedLmExperiences(raw:unknown,regions:WorldHost['engine']['world']['regions']):Experience[]{
 const fail=()=>{throw Error('world-experiences.invalid: only four named native self walk/rest visits are supported');};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();const d=raw as Record<string,unknown>;
 if(!keys(d,['schema','world','experiences','integration'])||d.schema!=='lm-native-experiences/1'||d.world!=='littlemartians'||!Array.isArray(d.experiences)||d.experiences.length!==4)return fail();
 const ids=new Set<string>();return d.experiences.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();const e=value as Record<string,unknown>;
  if(!keys(e,['id','place','at','label','steps'])||typeof e.id!=='string'||!/^lm-[a-z0-9-]{1,90}$/.test(e.id)||ids.has(e.id)||typeof e.place!=='string'||!regions[e.place]||typeof e.label!=='string'||e.label.length<1||e.label.length>160||!Array.isArray(e.at)||e.at.length!==2||!e.at.every(Number.isFinite))return fail();
  const at=e.at as [number,number];if(!inPoly(at[0],at[1],regions[e.place].polygon))return fail();
  if(!Array.isArray(e.steps)||e.steps.length!==2)return fail();const [walk,rest]=e.steps;
  if(!walk||!rest||!keys(walk,['verb','params'])||!keys(rest,['verb','params'])||walk.verb!=='walk_to'||rest.verb!=='rest'||!walk.params||!rest.params||!keys(walk.params,['to'])||!keys(rest.params,['seconds'])||JSON.stringify(walk.params.to)!==JSON.stringify(at)||!Number.isInteger(rest.params.seconds)||rest.params.seconds<1||rest.params.seconds>600)return fail();
  ids.add(e.id);return structuredClone({id:e.id,place:e.place,at,label:e.label,steps:e.steps}) as Experience;
 });
}
export function lmExperienceEdgeProfile(host:WorldHost,raw:unknown){const rows=validatedLmExperiences(raw,host.engine.world.regions);return(soul:EdgeSoul,caps:EdgeCapability[],plans:WorldPlans)=>{
 for(const row of rows){const id='walk:experience-'+row.id;if(plans.has(id))throw Error('world-experiences.capability-collision');
  const steps=structuredClone(row.steps),label=row.label,issue=host.engine.canPerform({actor:soul.entityId,label,steps});
  caps.push({id,verb:'walk',label,target:{id:row.place,kind:'place'},available:!issue,...(issue?{blocked:{code:issue.code,reason:issue.message}}:{})});plans.set(id,{label,steps});
 }
};}
