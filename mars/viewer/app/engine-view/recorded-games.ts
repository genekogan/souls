import type {SampledEntity} from '../../engine/take/replay.ts';
import {juggleBalls,type JuggleV1} from '../../engine/items/juggle.ts';
export type RecordedGame={kind:'frisbee'|'petanque'|'volleyball';group:string;players:string[];flightPolicy?:'clear-v1';since?:number;joinedAt?:number;releaseTick?:number;releaseFrameTick?:number;releaseFrom?:number;waiting?:boolean;from?:string;to?:string|null;throwTick?:number;landTick?:number;turn?:number;end?:number;jack?:[number,number];at?:[number,number];boules?:{by:string;at:[number,number]}[]};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const v2=(v:unknown):v is [number,number]=>Array.isArray(v)&&v.length===2&&v.every(finite);
/** Only sampled discrete state is authoritative. Never derive a game from nearby people. */
export function recordedGame(value:unknown):RecordedGame|null{
 if(!obj(value)||!['frisbee','petanque','volleyball'].includes(String(value.kind))||typeof value.group!=='string'||!value.group||!Array.isArray(value.players)||!value.players.every(p=>typeof p==='string')||value.players.length>50)return null;
 if(value.waiting!==true&&(!finite(value.throwTick)||!finite(value.landTick)||value.landTick<=value.throwTick||typeof value.from!=='string'||!value.players.includes(value.from)))return null;
 for(const key of ['since','joinedAt','releaseTick','releaseFrameTick','releaseFrom'])if(value[key]!==undefined&&!finite(value[key]))return null;
 if(value.flightPolicy!==undefined&&value.flightPolicy!=='clear-v1')return null;
 if(value.to!==undefined&&value.to!==null&&(typeof value.to!=='string'||!value.players.includes(value.to)))return null;
 for(const key of ['jack','at'])if(value[key]!==undefined&&!v2(value[key]))return null;
 if(value.boules!==undefined&&(!Array.isArray(value.boules)||value.boules.length>100||!value.boules.every(b=>obj(b)&&typeof b.by==='string'&&v2(b.at))))return null;
 return value as RecordedGame;
}
export type GameObject={key:string;kind:RecordedGame['kind']|'jack';p:[number,number,number];flight:boolean;progress:number};
/** Release/catch landmarks fit the shared1.34m shoulder/0.62m arm model. */
export function gameContact(kind:RecordedGame['kind']){return kind==='volleyball'?{forward:.2,height:1.85}:kind==='petanque'?{forward:.32,height:.92}:{forward:.43,height:1.05};}
export type JuggledBall={key:string;p:[number,number,number];color?:string};
/** #441: the balls of every juggling body, and the sets they stand in for (each set is drawn whole or as balls, never both). */
export function recordedJuggles(entities:Readonly<Record<string,SampledEntity>>,absoluteTick:number):{balls:JuggledBall[];sets:Set<string>}{
 const balls:JuggledBall[]=[],sets=new Set<string>();
 for(const [id,e] of Object.entries(entities)){const s=e.state.juggleV1 as JuggleV1|undefined;if(!s)continue;
  const at=juggleBalls(s,absoluteTick,e.p,e.yaw);if(!at)continue;sets.add(s.item);
  at.forEach((p,i)=>balls.push({key:id+':juggle:'+i,p,...(s.colors?{color:s.colors[i]}:{})}));}
 return {balls,sets};
}
/** Pooled game props are a replay-stable depiction of logged turns; no collision/score simulation. */
export function recordedGameObjects(entities:Readonly<Record<string,SampledEntity>>,absoluteTick:number):GameObject[]{
 const groups=new Map<string,RecordedGame>();
 for(const e of Object.values(entities)){const g=recordedGame(e.state.game);if(g&&g.releaseTick===undefined&&!groups.has(g.group))groups.set(g.group,g);}
 const out:GameObject[]=[];
 for(const g of groups.values()){
  const a=g.from?entities[g.from]:null,b=g.to?entities[g.to]:null;
  // Courts on a platform follow the recorded player's feet; no global y=0 assumption.
  const floor=a?.p[1]??entities[g.players[0]]?.p[1]??0;
  if(g.kind==='petanque'){
   if(g.jack)out.push({key:g.group+':jack',kind:'jack',p:[g.jack[0],floor+.025,g.jack[1]],flight:false,progress:1});
   g.boules?.forEach((boule,i)=>out.push({key:g.group+':boule:'+i,kind:'petanque',p:[boule.at[0],floor+.045,boule.at[1]],flight:false,progress:1}));
  }
  if(g.waiting||!a||g.throwTick===undefined||g.landTick===undefined||absoluteTick<g.throwTick||absoluteTick>=g.landTick)continue;
  const u=(absoluteTick-g.throwTick)/(g.landTick-g.throwTick),{forward,height}=gameContact(g.kind);
  const from:[number,number,number]=[a.p[0]+Math.cos(a.yaw)*forward,a.p[1]+height,a.p[2]+Math.sin(a.yaw)*forward];
  const to:[number,number,number]|null=g.kind==='petanque'&&g.at?[g.at[0],floor+.045,g.at[1]]:b?[b.p[0]+Math.cos(b.yaw)*forward,b.p[1]+height,b.p[2]+Math.sin(b.yaw)*forward]:null;
  if(!to)continue;const arc=g.kind==='volleyball'?2.6:g.kind==='petanque'?1.1:.35;
  const p=from.map((v,i)=>v+(to[i]-v)*u) as [number,number,number];p[1]+=4*arc*u*(1-u);
  out.push({key:g.group+':flight',kind:g.kind,p,flight:true,progress:u});
 }
 return out;
}
