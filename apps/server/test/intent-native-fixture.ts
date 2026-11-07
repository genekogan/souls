// Shared actual local dev Auth/Hono/SQLite/native control fixture. Synthetic
// compiler and fake Jev only; this is neither production bootstrap nor a worker.
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory} from '@souls/engine-mars';
import {newLife,type CompileOut,type callTool} from '@souls/brain';
import {Auth} from '../src/auth.ts';
import {Brain} from '../src/brain.ts';
import {config} from '../src/config.ts';
import {Db} from '../src/db.ts';
import {buildApp} from '../src/http.ts';
import type {Hub} from '../src/hub.ts';
import {IntentControlV2} from '../src/intent-control.ts';
import {Souls} from '../src/souls.ts';
import {WorldHost} from '../src/world.ts';

const factory=await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
export const seed='wire-intentions',worldId='wire-eden';
export function intentNativeFixture(t:TestContext,path=':memory:',enabled=true,historyV1=false,compilerOutput?:CompileOut,retryV1=false) {
  const db=new Db(path);t.after(()=>{if(db.db.isOpen)db.close();});
  for(const id of ['dev:alice','dev:bob','dev:admin']) {
    db.upsertUser({id,role:id==='dev:admin'?'admin':'user',email:null,wallet:null});db.setInvited(id,'local');
  }
  const host=new WorldHost(db,factory,seed,1e9,worldId);host.boot();
  if(!db.soul('s_A')) {
    db.createSoul({id:'s_A',worldId,owner:'dev:alice',entityId:'h_A',name:'Alice',description:'local',native:false});
    void host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'dev:alice',name:'Alice',description:'local'});host.drainInputs();
  }
  const mind=host.minds.get('s_A')!;mind.life=newLife(0);mind.nextEvalTick=1e9;
  let calls=0,hold:Promise<void>|undefined;
  const compilerCall:typeof callTool=async<T>(input:Parameters<typeof callTool>[0])=>{
    calls++;if(!compilerOutput)assert.match(input.system,/ordinary actionable present direction/);
    const standing=JSON.stringify(input.messages).includes('make friends if you feel like it');
    if(hold)await hold;
    const out:CompileOut=compilerOutput?structuredClone(compilerOutput):{understood:true,agenda:[{card:standing?'rest':'go to',target:standing?null:'campfire'}],
      alignment:{understanding:standing?'PRIVATE_STANDING_SUMMARY':'Walk to the campfire.',trigger:{kind:standing?'none':'now'}}};
    return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
  };
  const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,publicUrl:'http://127.0.0.1:4957',
    typesafeKey:undefined,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',privyAppId:'',privyAppSecret:'',inviteRequired:true};
  const auth=new Auth(cfg,db);auth.devAuth=true;
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:enabled,intentV2Retries:retryV1});
  // Exercise the real compiler validation/mint/journal path with the injected
  // synthetic transport. The native chooser remains the already-created fake Jev.
  const compile=brain.compile.bind(brain);
  t.mock.method(brain,'compile',async(...args:Parameters<typeof brain.compile>)=>{
    brain.mode='live';try{return await compile(...args);}finally{brain.mode='fake';}
  });
  const souls=new Souls(host,db,brain,cfg),service=enabled?new IntentControlV2(host,brain,souls,{historyV1}):undefined;
  const deps={cfg,db,host,auth,brain,souls,hub:{clients:new Set(),refreshMe(){}} as unknown as Hub,intentV2:service};
  const app=buildApp(deps),post=async(input:unknown,credential='dev:alice',agent=false)=>app.request(agent?'/v1/agent/intent-v2':'/v1/souls/s_A/intent-v2',{
    method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(input)});
  const lookup=async(id:string,credential='dev:alice',agent=false)=>app.request(agent?'/v1/agent/intent-v2/requests/'+id:'/v1/souls/s_A/intent-v2/requests/'+id,{headers:{authorization:'Bearer '+credential}});
  return {db,host,mind,brain,souls,auth,deps,app,post,lookup,service:service!,get calls(){return calls;},set hold(value:Promise<void>|undefined){hold=value;}};
}
