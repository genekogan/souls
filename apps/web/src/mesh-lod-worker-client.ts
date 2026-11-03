import type {AsyncSimplifier,LodInput,LodLevel,LodReservation} from './mesh-lod-core.ts';

type Reply={id:number;ready?:boolean;levels?:LodLevel[];error?:string};
type Waiter={ok:(levels:LodLevel[])=>void;no:(error:Error)=>void};
export type WorkerSimplifier=AsyncSimplifier&{
 inspection():{physical:number;callbacks:number;tombstones:number;closed:boolean};
};
const canceled=()=>new DOMException('Obsolete LOD work','AbortError');

/** One world owns the worker through signal. Reserve one of two physical slots before copying input; no queue.
 * Canceling posted work releases its callbacks, but keeps its scalar slot until reply or worker retirement.
 * A lost reply occupies bounded admission until world retirement; timeoutMs applies only to worker startup. */
export function workerSimplifier(make:()=>Worker,timeoutMs=15000,signal?:AbortSignal):Promise<WorkerSimplifier|null>{
 if(signal?.aborted)return Promise.resolve(null);
 let worker:Worker;try{worker=make();}catch{return Promise.resolve(null);}
 const physical=new Map<number,{posted:boolean}>(),waiters=new Map<number,Waiter>();
 let next=1,closed=false,ready=false,reason:Error=new Error('LOD worker unavailable');
 return new Promise(resolve=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const settle=(id:number,levels:LodLevel[]|null,error?:Error)=>{
   const waiter=waiters.get(id);waiters.delete(id);
   if(waiter){if(levels!==null)waiter.ok(levels);else waiter.no(error??new Error('LOD worker failed'));}
  };
  const close=(error:Error)=>{
   if(closed)return;closed=true;reason=error;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;
   physical.clear();for(const id of [...waiters.keys()])settle(id,null,error);
   worker.terminate();resolve(null);
  };
  const abort=()=>close(canceled());
  const cancel=(id:number)=>{
   const job=physical.get(id);if(!job)return;
   if(!job.posted)physical.delete(id);
   settle(id,null,canceled());
  };
  const post=(id:number,input:LodInput,ratios:readonly number[],maxError:number):Promise<LodLevel[]>=>{
   const job=physical.get(id);if(closed)return Promise.reject(reason);if(!job||job.posted)return Promise.reject(canceled());
   return new Promise((ok,no)=>{
    waiters.set(id,{ok,no});job.posted=true;
    try{worker.postMessage({id,input,ratios:[...ratios],maxError},[input.positions.buffer,input.indices.buffer,...input.parts.map(p=>p.array.buffer)]);}
    catch(error){physical.delete(id);settle(id,null,error instanceof Error?error:new Error(String(error)));}
   });
  };
  const reserve=():LodReservation|null=>{
   if(closed)throw reason;if(!ready||physical.size>=2)return null;
   const id=next++;physical.set(id,{posted:false});return{levels:(input,ratios,maxError)=>post(id,input,ratios,maxError),cancel:()=>cancel(id)};
  };
  const service:WorkerSimplifier={isAsync:true,reserve,
   levels:(input,ratios,maxError)=>{try{const job=reserve();return job?job.levels(input,ratios,maxError):Promise.reject(new Error('LOD worker capacity occupied'));}catch(error){return Promise.reject(error);}},
   inspection:()=>({physical:physical.size,callbacks:waiters.size,tombstones:[...physical.values()].filter(j=>j.posted).length-waiters.size,closed}),
  };
  worker.onerror=()=>close(new Error('LOD worker failed'));
  worker.onmessageerror=()=>close(new Error('LOD worker reply could not be decoded'));
  worker.onmessage=(event:MessageEvent<Reply>)=>{
   if(closed)return;const{id,levels,error}=event.data;
   if(id===0){if(ready)return;if(!event.data.ready){close(new Error('LOD simplifier unavailable'));return;}ready=true;clearTimeout(timer);resolve(service);return;}
   if(!physical.get(id)?.posted)return;physical.delete(id);settle(id,levels??null,new Error(error??'LOD worker failed'));
  };
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  timer=setTimeout(()=>close(new Error('LOD worker startup timed out')),timeoutMs);
  try{worker.postMessage({id:0});}catch(error){close(error instanceof Error?error:new Error(String(error)));}
 });
}
