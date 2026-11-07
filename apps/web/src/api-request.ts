import {ownerLifecycleCapabilitySchema} from '@souls/protocol';
type ApiOptions={path:(value:string)=>string;session?:()=>number;fetch?:typeof fetch;timeoutMs?:number};
/** A panel disappearing cannot revoke a request already accepted by the server.
 * Fence queued dispatch and returned data at the current Shell session instead. */
export function createApiRequest(getToken:()=>Promise<string|null>,options:ApiOptions){
 return async function api<T=any>(path:string,body?:unknown,method?:string,admission?:{capability:unknown;worldId:string;userId:string}):Promise<{status:number;data:T}>{
  const verb=method??(body!==undefined?'POST':'GET');
  let lifecycleHeader=false;
  if(admission){const cap=ownerLifecycleCapabilitySchema.safeParse(admission.capability);if(!cap.success||cap.data.worldId!==admission.worldId||cap.data.userId!==admission.userId||path!=='/v1/souls'||verb!=='POST')return {status:0,data:{message:'Arrival response protocol is unavailable.'} as T};lifecycleHeader=true;}
  const generation=options.session?.();
  const current=()=>!options.session||options.session()===generation;
  const retired=()=>({status:0,data:{message:'This request belongs to an earlier session.'} as T});
  try{
   let tokenTimer:ReturnType<typeof setTimeout>|undefined;
   let token:string|null;
   try{
    token=await Promise.race([getToken(),new Promise<never>((_,reject)=>{tokenTimer=setTimeout(()=>reject(new Error('Token wait expired.')),options.timeoutMs??30000);})]);
   }finally{clearTimeout(tokenTimer);}

   if(!current())return retired();
   const r=await (options.fetch??fetch)(options.path(path),{
    method:verb,redirect:'error',signal:AbortSignal.timeout(options.timeoutMs??30000),
    headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...(lifecycleHeader?{'X-Sim-Lifecycle':'1'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
   });
   const text=await r.text();
   if(!current())return retired();
   let data:any;try{data=JSON.parse(text);}catch{data=r.ok?text:{message:`the server answered ${r.status}`};}
   return {status:r.status,data};
  }catch{return {status:0,data:{message:'Response unconfirmed. Check current state before retrying a write.'} as T};}
 };
}
