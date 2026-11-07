// Lossless, self-contained transport only. Canonical Take/WorldState never use refs.
import {authoredBoundariesV1Schema,hashOf,stableStringify} from '@souls/engine-contract';

export const TAKE_BOUNDARY_WIRE_V1='take-boundary-facts/1' as const;
export const TAKE_BOUNDARY_WIRE_LIMITS={chunks:512,facts:32,factBytes:8*1024*1024,dictionaryBytes:32*1024*1024,expandedBytes:64*1024*1024} as const;
const REF='$takeBoundaryFactV1';
type JsonObject=Record<string,unknown>;
const record=(v:unknown):v is JsonObject=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const bytes=(s:string)=>new TextEncoder().encode(s).length;
const keyOk=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fail(reason:string):never{throw new Error('take-boundary-wire.invalid: '+reason);}
function fact(value:unknown){
 const parsed=authoredBoundariesV1Schema.safeParse(value);
 if(!parsed.success||stableStringify(parsed.data)!==stableStringify(value))fail('noncanonical authored fact');
 const encoded=JSON.stringify(value);if(bytes(encoded)>TAKE_BOUNDARY_WIRE_LIMITS.factBytes)fail('fact size');
 return {value:parsed.data,key:hashOf(value),encoded};
}
function stream(value:unknown):asserts value is JsonObject&{chunks:unknown[]}{
 if(!record(value)||value.t!==undefined&&value.t!=='takes'||!Array.isArray(value.chunks)||value.chunks.length>TAKE_BOUNDARY_WIRE_LIMITS.chunks||!Number.isSafeInteger(value.serverTick)||Number(value.serverTick)<0)fail('stream shape/size');
}
/** Called only on an already-public message. Returns a string, never a mutable
 * transport object sharing canonical tracks/entities/facts with its caller. */
export function stringifyTakeBoundaryWireV1(publicStream:unknown):string{
 stream(publicStream);
 if(publicStream.chunks.length<2)return JSON.stringify(publicStream);
 const definitions=new Map<string,unknown>(),definitionJSON=new Map<string,string>(),byJson=new Map<string,string>();let dictionaryBytes=0,expansion=0;
 const chunks=publicStream.chunks.map(chunk=>{
  if(!record(chunk)||!record(chunk.take)||!record(chunk.take.finalState))return chunk;
  const finalState=chunk.take.finalState,full=finalState.authoredBoundariesV1;if(full===undefined)return chunk;
  const json=JSON.stringify(full);let key=byJson.get(json);
  if(!key){const checked=fact(full);key=checked.key;byJson.set(json,key);
   if(definitions.has(key)&&definitionJSON.get(key)!==json)fail('same hash has different fact bytes');
   if(!definitions.has(key)){definitions.set(key,full);definitionJSON.set(key,json);dictionaryBytes+=bytes(json);}
   if(definitions.size>TAKE_BOUNDARY_WIRE_LIMITS.facts||dictionaryBytes>TAKE_BOUNDARY_WIRE_LIMITS.dictionaryBytes)fail('dictionary size');
  }
  const ref={[REF]:key};expansion+=bytes(json)-bytes(JSON.stringify(ref));
  return {...chunk,take:{...chunk.take,finalState:{...finalState,authoredBoundariesV1:ref}}};
 });
 if(!definitions.size)return JSON.stringify(publicStream);
 if(chunks.some(chunk=>!record(chunk)||!record(chunk.take)||!record(chunk.take.finalState)))fail('chunk shape');
 // Bound decoded amplification as well as compressed input. This is a byte
 // count, not a strip/normalization of any canonical ending or hash.
 const payload={...publicStream,chunks},expandedSize=bytes(JSON.stringify(payload))+expansion;
 if(expandedSize>TAKE_BOUNDARY_WIRE_LIMITS.expandedBytes)fail('expanded size');
 const packed=JSON.stringify({t:'take-boundary-wire',contract:TAKE_BOUNDARY_WIRE_V1,facts:[...definitions].map(([key,value])=>({key,value})),payload});
 // A one-chunk live frame has no repetition to remove. Negotiated peers also
 // accept raw Takes, so avoid increasing its size merely to add an envelope.
 return bytes(packed)<expandedSize?packed:JSON.stringify(publicStream);
}

/** Restore the exact full JSON Take before normal hash/replay/replica code.
 * Dictionary scope is one message; no cache/current-scene fallback exists.
 * Each take receives its own full fact copy, so mutable consumers never alias. */
export function hydrateTakeBoundaryWireV1(input:unknown):unknown{
 if(!record(input)||input.t!=='take-boundary-wire')return input;
 if(Object.keys(input).sort().join(',')!=='contract,facts,payload,t'||input.contract!==TAKE_BOUNDARY_WIRE_V1||!Array.isArray(input.facts)||!input.facts.length||input.facts.length>TAKE_BOUNDARY_WIRE_LIMITS.facts)fail('envelope');
 stream(input.payload);const dictionary=new Map<string,{json:string;size:number}>();let total=0;
 for(const entry of input.facts){
  if(!record(entry)||Object.keys(entry).sort().join(',')!=='key,value'||!keyOk(entry.key)||dictionary.has(entry.key))fail('key/duplicate');
  const checked=fact(entry.value);if(checked.key!==entry.key)fail('content hash');
  const size=bytes(checked.encoded);total+=size;if(total>TAKE_BOUNDARY_WIRE_LIMITS.dictionaryBytes)fail('dictionary size');dictionary.set(entry.key,{json:checked.encoded,size});
 }
 const used=new Set<string>();let expanded=bytes(JSON.stringify(input.payload));
 if(expanded>TAKE_BOUNDARY_WIRE_LIMITS.expandedBytes)fail('expanded size');
 const chunks=input.payload.chunks.map(chunk=>{
  if(!record(chunk)||!record(chunk.take)||!record(chunk.take.finalState))fail('chunk shape');
  const finalState=chunk.take.finalState,ref=finalState.authoredBoundariesV1;if(ref===undefined)return chunk;
  if(!record(ref)||Object.keys(ref).join(',')!==REF||!keyOk(ref[REF]))fail('reference shape');
  const key=ref[REF],full=dictionary.get(key);if(!full)fail('unknown reference');
  used.add(key);expanded+=full.size-bytes(JSON.stringify(ref));if(expanded>TAKE_BOUNDARY_WIRE_LIMITS.expandedBytes)fail('expanded size');
  return {...chunk,take:{...chunk.take,finalState:{...finalState,authoredBoundariesV1:JSON.parse(full.json)}}};
 });
 if(used.size!==dictionary.size)fail('unused dictionary entries');
 return {...input.payload,chunks};
}
