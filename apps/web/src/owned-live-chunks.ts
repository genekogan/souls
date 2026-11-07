import {recordedTakeChunkSchema,type RecordedTakeChunk} from '@souls/protocol';
// Only this module can brand a validated, detached, deeply immutable wire chunk.
// Mutable caller objects are never identity-cached or frozen in place.
const owned=new WeakSet<object>();
// A built world carries its static physics (entityPhysicsV1: every building's floors, walls and stairs) in each take's
// final state: Eden 2026 (3.5k entities, 244 furnished buildings) is ~290k nodes. The old 200k cap silently dropped
// every live chunk there, so the viewer never drew a first frame. 2M keeps a bound against runaway data.
export const LIVE_CHUNK_NODE_BUDGET=2_000_000;
// take-entities-ref/1 (L3e): the socket decoder shares one deeply frozen entity table between chunks that carry the same
// world, so each entity's owned copy is made once and reused (Eden 2026: ~4,900 entities, ~40 ms desktop / ~160 ms phone a
// chunk otherwise). Only deeply frozen source values are cached: they cannot change, so their copy stays exact.
const sharedEntity=new WeakMap<object,{value:unknown;nodes:number}>(),cachedOwned=new WeakSet<object>();
const deeplyFrozen=(value:unknown):boolean=>{
 if(!value||typeof value!=='object')return true;if(!Object.isFrozen(value))return false;
 for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!deeplyFrozen(d.value))return false;}
 return true;
};
function detachedEntity(value:unknown,ancestors:Set<object>,budget:{nodes:number},depth:number):unknown{
 if(!value||typeof value!=='object')return detachedData(value,ancestors,budget,depth);
 const hit=sharedEntity.get(value);
 if(hit){if((budget.nodes+=hit.nodes)>LIVE_CHUNK_NODE_BUDGET)throw Error('Live chunk data budget');return hit.value;}
 const before=budget.nodes,out=detachedData(value,ancestors,budget,depth);
 if(out&&typeof out==='object'&&deeplyFrozen(value)){freeze(out);cachedOwned.add(out);sharedEntity.set(value,{value:out,nodes:budget.nodes-before});}
 return out;
}
export function detachedData(value:unknown,ancestors=new Set<object>(),budget={nodes:0},depth=0,entities?:object):unknown{
 if(++budget.nodes>LIVE_CHUNK_NODE_BUDGET||depth>64)throw Error('Live chunk data budget');
 if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite live chunk');return value;}
 if(typeof value!=='object'||ancestors.has(value))throw Error('Live chunk plain acyclic data required');
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null)throw Error('Live chunk plain data required');
 ancestors.add(value);const out:unknown[]|Record<string,unknown>=array?[]:{};
 try{for(const key of Reflect.ownKeys(value)){
  if(array&&key==='length')continue;if(typeof key!=='string')throw Error('Live chunk symbol');
  const property=Object.getOwnPropertyDescriptor(value,key);if(!property||!Object.hasOwn(property,'value'))throw Error('Live chunk accessor');
  const child=value===entities?detachedEntity(property.value,ancestors,budget,depth+1):detachedData(property.value,ancestors,budget,depth+1,entities);
  // F12: a plain assignment makes the same writable, configurable property (and keeps the copy a fast object); only a
  // hidden key or an own __proto__ needs defineProperty.
  if(property.enumerable&&key!=='__proto__')(out as Record<string,unknown>)[key]=child;
  else Object.defineProperty(out,key,{value:child,enumerable:property.enumerable,writable:true,configurable:true});
 }}finally{ancestors.delete(value);}
 return out;
}
function freeze(value:unknown){if(value&&typeof value==='object'&&!cachedOwned.has(value)){for(const key of Reflect.ownKeys(value)){const property=Object.getOwnPropertyDescriptor(value,key);if(property&&Object.hasOwn(property,'value'))freeze(property.value);}Object.freeze(value);}}
// The viewer never reads a take's static physics (it draws geometry from /v1/scene); copying, validating and freezing
// it per live chunk cost ~120 ms a chunk on Eden 2026. Drop it from the owned copy only when every hop is plain data.
const dataOf=(value:unknown,key:string)=>{if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value as unknown:undefined;};
export function withoutStaticPhysics(raw:unknown):unknown{
 const take=dataOf(raw,'take'),state=dataOf(take,'finalState');
 if(!state||typeof state!=='object'||!Object.hasOwn(state,'entityPhysicsV1')||dataOf(state,'entityPhysicsV1')===undefined)return raw;
 const plain=(o:object)=>Reflect.ownKeys(o).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(o,k)!,'value'));
 if(!plain(raw as object)||!plain(take as object)||!plain(state))return raw;
 const {entityPhysicsV1:_omit,...rest}=state as Record<string,unknown>;
 return {...(raw as object),take:{...(take as object),finalState:rest}};
}
export function ownLiveChunk(raw:unknown):RecordedTakeChunk|null{
 if(raw&&typeof raw==='object'&&owned.has(raw))return raw as RecordedTakeChunk;
 try{const chunk=withoutStaticPhysics(raw),table=dataOf(dataOf(dataOf(chunk,'take'),'finalState'),'entities');
  const result=recordedTakeChunkSchema.safeParse(detachedData(chunk,undefined,undefined,0,table&&typeof table==='object'?table:undefined));if(!result.success)return null;freeze(result.data);owned.add(result.data);return result.data;}catch{return null;}
}
export function ownedLiveChunk(raw:unknown):RecordedTakeChunk|null{return raw&&typeof raw==='object'&&owned.has(raw)?raw as RecordedTakeChunk:null;}
