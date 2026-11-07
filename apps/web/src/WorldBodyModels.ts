import type {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {SampledEntity} from '../../../mars/viewer/engine/take/replay.ts';
import type {Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {recordedBody,admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {worldPath} from './world-path.ts';
import {validateBodyRig} from '../../../mars/viewer/app/engine-view/body-rig.ts';
import {LOOK_MODEL} from './humanoid/look.ts';
import {withRetry,type RetryOptions} from '../../../mars/viewer/lib/retry.ts';
// P1 phones: the template builders (people.ts, humanoid/compose.ts) load with the first body that needs one, not on arrival
const people=()=>import('../../../mars/viewer/app/engine-view/people.ts'),compose=()=>import('./humanoid/compose.ts');
/** Validated owner bodies remain separate from the stable built-in template choice. */
export class WorldBodyModels{
 readonly templates=new Map<string,Template>();private pending=new Set<string>();private tasks=new Map<string,Promise<void>>();private failed=new Set<string>();private disposed=false;
 readonly unresolved=new Set<string>();
 /** P1 phones: while held, bodies stay unresolved (a simple figure stands in) and nothing is fetched; the next sync after
  *  release starts their loads. LiveWorld holds a new world's people on a phone until its arrival is over. */
 held=false;
 /** Lane B1: an uploaded body is retried after 2, 5 and 10 s on a network error or HTTP 408/429/5xx (a look's kit parts
  *  retry inside the kit); after that it stays failed: the stand-in, one notice, no more requests. */
 private loader:GLTFLoader;
 private problem:(message:string)=>void;
 private retry:RetryOptions;
 constructor(loader:GLTFLoader,problem:(message:string)=>void,retry:RetryOptions={}){this.loader=loader;this.problem=problem;this.retry=retry;}
 sync(records:Readonly<Record<string,{kind:string;body?:unknown}>>,entities:Readonly<Record<string,SampledEntity>>){
  this.unresolved.clear();
  for(const [id,e] of Object.entries(entities)){const record=records[id];if(record?.kind!=='human')continue;const b=recordedBody(record.body,e.state);if(b?.family!=='humanoid')continue;
   // core/humanoid@2: a look composed from the shared kit, keyed by the record's model (the look key).
   const look=(b as {params?:unknown}).params;
   if(look&&typeof b.model==='string'&&LOOK_MODEL.test(b.model)){const key=b.model;if(this.templates.has(key))continue;this.unresolved.add(id);if(this.held||this.pending.has(key)||this.failed.has(key))continue;this.pending.add(key);
    void compose().then(m=>m.humanoidKit(this.loader).template(look)).then(t=>{if(!this.disposed)this.templates.set(key,t);},()=>{this.failed.add(key);if(!this.disposed)this.problem('A Soul’s chosen look could not be composed; a simple figure marks its position.');}).finally(()=>this.pending.delete(key));
    continue;}
   if(!b.modelUrl)continue;
   const key=admittedBodyUrl(b.modelUrl);if(!key){this.unresolved.add(id);continue;}if(this.templates.has(key))continue;this.unresolved.add(id);if(this.held||this.pending.has(key)||this.failed.has(key))continue;this.pending.add(key);
   const url=admittedBodyUrl(key,worldPath)!;
   const task=Promise.all([withRetry(()=>this.loader.loadAsync(url),this.retry),people()]).then(async([gltf,{templateFromGltfAsync}])=>{if(this.disposed){disposeModel(gltf.scene);return;}try{validateBodyRig(gltf);const template=await templateFromGltfAsync(b.model??key,gltf);if(this.disposed)disposeModel(gltf.scene);else this.templates.set(key,template);}catch(error){disposeModel(gltf.scene);throw error;}},()=>{this.failed.add(key);if(!this.disposed)this.problem('A Soul’s uploaded body could not be shown; a simple figure marks its position.');}).catch(()=>{this.failed.add(key);if(!this.disposed)this.problem('A Soul’s uploaded rig could not be shown; a simple figure marks its position.');}).finally(()=>this.pending.delete(key));this.tasks.set(key,task);
  }
 }
 async readyInitial(records:Readonly<Record<string,{kind:string;body?:unknown}>>,entities:Readonly<Record<string,SampledEntity>>){
  for(const [id,e]of Object.entries(entities)){if(records[id]?.kind!=='human')continue;const body=recordedBody(records[id]?.body,e.state);if(body?.family!=='humanoid'||!body.modelUrl)continue;const key=admittedBodyUrl(body.modelUrl);if(!key)throw Error('A required Soul model URL is invalid.');if(this.failed.has(key)){this.failed.delete(key);this.tasks.delete(key);}}
  this.sync(records,entities);for(const [id,e]of Object.entries(entities)){if(records[id]?.kind!=='human')continue;const body=recordedBody(records[id]?.body,e.state);if(body?.family!=='humanoid'||!body.modelUrl)continue;const key=admittedBodyUrl(body.modelUrl)!;await this.tasks.get(key);if(!this.templates.has(key))throw Error('A required Soul body could not be prepared.');}
 }
 dispose(){this.disposed=true;for(const t of this.templates.values())disposeModel(t.gltf.scene);this.templates.clear();this.tasks.clear();}
}
function disposeModel(root:import('three').Object3D){root.traverse(o=>{const mesh=o as import('three').Mesh;if(mesh.isMesh){mesh.geometry.dispose();for(const m of [mesh.material].flat()){for(const v of Object.values(m))if(v&&typeof v==='object'&&(v as {isTexture?:boolean}).isTexture)(v as import('three').Texture).dispose();m.dispose();}}});}
