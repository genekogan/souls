import {withStaticGridReadCache} from '../../../mars/viewer/engine/spatial/grid.ts';
import type {Program,Engine} from '@souls/engine-contract';
import type {WorldHost,Mind} from './world.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
type SleepStopPreview=(program:Program)=>string|null;
const activeReads=new WeakMap<WorldHost,Map<Mind,SleepStopPreview>>();
function synchronousResult<T>(result:T):T{if(result&&typeof(result as {then?:unknown}).then==='function')throw Error('human-sleep-transition.synchronous-read-required');return result;}
/** One synchronous read can share the detached rise, never a live admission.
 * The probe expires on return and never survives a tick/writer boundary. */
export function withHumanSleepStopReadV1<T>(host:WorldHost,m:Mind,read:(preview:(program:Program)=>string|null)=>T):T{
 const nested=activeReads.get(host)?.get(m);if(nested)return synchronousResult(read(nested));
 let open=true,attempted=false,copy:Engine|undefined,before:string|undefined,id:string|null=null;
 const source=host.engine,factory=host.factory,restore=factory.restore;
 const preview=(program:Program):string|null=>{
  if(!open||host.engine!==source||host.factory!==factory||factory.restore!==restore||!host.extra.intentHumanSleepTransitionV1||program.actor!==m.entityId||host.quietBarrier)return null;
  const current=source.programOf(m.entityId),action=current?source.programAction?.(current):null;
  if(!current||action?.actor!==m.entityId||action.action.verb!=='sleep'||!(source.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||source.canSnapshot?.()!==true)return null;
  const hash=source.stateHash();if(before!==undefined&&before!==hash)return null;
  if(!attempted){attempted=true;before=hash;id=current;
   try{const candidate=factory.restore(structuredClone(source.snapshot()));if(candidate===source||candidate.world===source.world||candidate.stateHash()!==before)return null;
    candidate.stop(id);for(let i=0;i<120&&candidate.programOf(m.entityId)===id;i++)candidate.step();
    if(candidate.programOf(m.entityId)!==null||(candidate.world as NativeWorld).entities[m.entityId]?.human?.sleepPose||candidate.runtime.violations.length)return null;copy=candidate;
   }catch{return null;}
  }
  if(!copy||current!==id)return null;
  try{const projected=copy.stateHash(),issue=copy.canPerform(program);if(copy.stateHash()!==projected){copy=undefined;return null;}return issue?null:id;}catch{copy=undefined;return null;}
 };
 const scopes=activeReads.get(host)??new Map<Mind,SleepStopPreview>();activeReads.set(host,scopes);scopes.set(m,preview);
 try{return withStaticGridReadCache(()=>synchronousResult(read(preview)));}
 finally{scopes.delete(m);if(scopes.size===0)activeReads.delete(host);open=false;copy=undefined;if(before!==undefined&&source.stateHash()!==before)throw Error('human-sleep-transition.preview-mutated-source');}
}
/** Detached native projection, never an admission or a change to the live body.
 * Only the existing resumable sleep codec can qualify this narrow transition. */
export function previewHumanSleepStopV1(host:WorldHost,m:Mind,program:Program):string|null{
 return withHumanSleepStopReadV1(host,m,preview=>preview(program));
}
