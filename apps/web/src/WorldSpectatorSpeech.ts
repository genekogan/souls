import * as THREE from 'three';
import type {TalkLine} from '@souls/protocol';
import {EDEN_VIEWER_PLACES,type ViewerPlace} from './WorldEdenPlaceData.ts';
/** W4 spectator speech: show WHO CAN HEAR each line. Spectators see everything;
 * Souls only hear their channel. Draws only what the speech record says.
 *
 * Channels (PLACE-DATA-v1 / edge §6): earshot radius outdoors, the enclosure
 * indoors, a presenter's audience, or a conversation's members. Until Core's
 * C5/C6 events land, talk lines (always pairwise speaker→listener) map to a
 * two-member conversation, and enclosure comes from where the speaker stands. */
export type SpeechChannel=
 |{kind:'earshot';radius:number}
 |{kind:'enclosure';placeId:string}
 |{kind:'audience';placeId:string}
 |{kind:'conversation';conversationId:string;members:string[]};
export type SpectatorSpeech={id:string;at:number;speaker:string;speakerName:string;text:string;channel:SpeechChannel;
 /** World tick of the line (edge feed only). */
 tick?:number;
 /** Souls the server delivered the line to (edge `say`), when known. */
 heardBy?:string[];
 /** Innermost enclosed place around the speaker, if any (speech stays inside it). */
 within:string|null};
const placeById=new Map(EDEN_VIEWER_PLACES.map(p=>[p.id,p]));
const insidePoly=(x:number,z:number,poly:readonly [number,number][])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;};
const depth=(p:ViewerPlace)=>{let d=0;for(let q:ViewerPlace|undefined=p;q?.parent;q=placeById.get(q.parent))d++;return d;};
/** Innermost enclosed place containing a world position (level-aware), or null. */
export function enclosingPlace(x:number,y:number,z:number,places:readonly ViewerPlace[]=EDEN_VIEWER_PLACES):ViewerPlace|null{
 const level=y>2.4?Math.round(y/3):0;let best:ViewerPlace|null=null;
 for(const p of places){if(!p.enclosed||!insidePoly(x,z,p.polygon))continue;if(p.level!==0&&p.level!==level)continue;if(!best||depth(p)>depth(best))best=p;}
 return best;
}
export function speechFromTalk(line:TalkLine,speakerAt:readonly [number,number,number]|null):SpectatorSpeech{
 const members=[line.from,line.to].filter(Boolean).sort();
 const within=speakerAt?enclosingPlace(speakerAt[0],speakerAt[1],speakerAt[2])?.id??null:null;
 return {id:`talk:${line.id}`,at:line.at,speaker:line.from,speakerName:line.fromName,text:line.text,within,
  channel:members.length>=2?{kind:'conversation',conversationId:'c:'+members.join('|'),members}:within?{kind:'enclosure',placeId:within}:{kind:'earshot',radius:10}};
}
const PALETTE=['#ffd166','#06d6a0','#4cc9f0','#f78c6b','#c77dff','#90be6d','#f15bb5','#ffb4a2'];
export function conversationColour(id:string){let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}return PALETTE[(h>>>0)%PALETTE.length];}
/** Short chip shown on the speaker's label: what the line was and who could hear it. */
export function channelChip(s:SpectatorSpeech,nameOf:(soulId:string)=>string):{text:string;colour:string;private:boolean}{
 const inside=s.within?placeById.get(s.within)?.name:null,where=inside?` · inside ${inside}`:'';
 const heard=s.heardBy?(s.heardBy.length?` · heard by ${s.heardBy.slice(0,4).map(nameOf).join(', ')}${s.heardBy.length>4?` +${s.heardBy.length-4}`:''}`:' · nobody in earshot'):'';
 switch(s.channel.kind){
  case 'conversation':{const others=s.channel.members.filter(m=>m!==s.speaker).map(nameOf);return {text:others.length?`🔒 private · with ${others.join(', ')}${where} — only they hear`:`🔒 private conversation${where}`,colour:conversationColour(s.channel.conversationId),private:true};}
  case 'enclosure':return {text:heard?`🏠 ${inside??'inside'}${heard}`:`🏠 ${inside??'inside'} — only those inside hear`,colour:'#ffe8b0',private:false};
  case 'audience':return {text:`📣 to the audience · ${placeById.get(s.channel.placeId)?.name??''}${heard}`,colour:'#bde0fe',private:false};
  default:return {text:heard?`💬 aloud${heard}`:`💬 aloud — heard within ~${Math.round(s.channel.radius)} m`,colour:'#ffffff',private:false};
 }
}
/** Three.js cue layer (added to the scene, outside camera visibility roots):
 * conversation tethers, fading earshot rings, and enclosure outlines. Pooled; no per-frame allocation. */
export class SpectatorSpeechLayer{
 readonly group=new THREE.Group();
 private tethers:THREE.Line[]=[];private rings:THREE.Mesh[]=[];private outlines:THREE.LineLoop[]=[];
 private ringGeometry=new THREE.RingGeometry(.96,1,64).rotateX(-Math.PI/2);
 private disposables:(THREE.BufferGeometry|THREE.Material)[]=[this.ringGeometry];
 constructor(){this.group.name='spectator-speech-cues';this.group.renderOrder=998;}
 private tether(i:number){let l=this.tethers[i];if(!l){const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(6),3));const m=new THREE.LineDashedMaterial({color:'#ffffff',dashSize:.35,gapSize:.2,transparent:true,depthTest:false});l=new THREE.Line(g,m);l.frustumCulled=false;this.disposables.push(g,m);this.tethers[i]=l;this.group.add(l);}return l;}
 private ring(i:number){let r=this.rings[i];if(!r){const m=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,depthWrite:false,side:THREE.DoubleSide});r=new THREE.Mesh(this.ringGeometry,m);this.disposables.push(m);this.rings[i]=r;this.group.add(r);}return r;}
 private outline(i:number){let o=this.outlines[i];if(!o){const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(3*32),3));const m=new THREE.LineBasicMaterial({color:'#ffe8b0',transparent:true,depthTest:false});o=new THREE.LineLoop(g,m);o.frustumCulled=false;this.disposables.push(g,m);this.outlines[i]=o;this.group.add(o);}return o;}
 /** speeches: recent lines (any order); now: same clock as speech.at (ms); where: soulId → head position or null. */
 update(speeches:readonly SpectatorSpeech[],now:number,where:(soulId:string)=>THREE.Vector3|null){
  let t=0,r=0,o=0;const conversations=new Map<string,{members:string[];last:number}>(),outlined=new Map<string,number>();
  for(const s of speeches){const age=(now-s.at)/1000;if(age<0||age>20)continue;
   if(s.channel.kind==='conversation'){const c=conversations.get(s.channel.conversationId);if(!c||c.last<s.at)conversations.set(s.channel.conversationId,{members:s.channel.members,last:s.at});}
   if(s.channel.kind==='earshot'&&age<3){const p=where(s.speaker);if(p){const ring=this.ring(r++);ring.visible=true;ring.position.set(p.x,p.y-1.95+.05,p.z);ring.scale.setScalar(s.channel.radius);(ring.material as THREE.MeshBasicMaterial).opacity=.35*(1-age/3);}}
   if(s.within&&age<5)outlined.set(s.within,Math.max(outlined.get(s.within)??0,1-age/5));}
  for(const [id,c] of conversations){const age=(now-c.last)/1000,ps=c.members.map(where).filter((p):p is THREE.Vector3=>!!p);if(ps.length<2)continue;
   const colour=new THREE.Color(conversationColour(id)),fade=Math.max(0,1-Math.max(0,age-12)/8);
   for(let i=1;i<ps.length;i++){const l=this.tether(t++),pos=l.geometry.attributes.position as THREE.BufferAttribute;pos.setXYZ(0,ps[0].x,ps[0].y-.25,ps[0].z);pos.setXYZ(1,ps[i].x,ps[i].y-.25,ps[i].z);pos.needsUpdate=true;l.computeLineDistances();
    const m=l.material as THREE.LineDashedMaterial;m.color.copy(colour);m.opacity=.85*fade;l.visible=fade>0;}}
  for(const [id,fade] of outlined){const place=placeById.get(id);if(!place)continue;const loop=this.outline(o++),pos=loop.geometry.attributes.position as THREE.BufferAttribute,n=Math.min(32,place.polygon.length),y=place.level*3+.06;
   for(let i=0;i<32;i++){const [x,z]=place.polygon[Math.min(i,n-1)];pos.setXYZ(i,x,y,z);}pos.needsUpdate=true;loop.geometry.setDrawRange(0,n);(loop.material as THREE.LineBasicMaterial).opacity=.9*fade;loop.visible=true;}
  for(let i=t;i<this.tethers.length;i++)this.tethers[i].visible=false;for(let i=r;i<this.rings.length;i++)this.rings[i].visible=false;for(let i=o;i<this.outlines.length;i++)this.outlines[i].visible=false;
 }
 dispose(){this.group.removeFromParent();for(const d of this.disposables)d.dispose();this.group.clear();}
}

/** Core's spectator feed on the viewer hub (edge comms): `{type:'edge',kind,tick,at,...}`. */
export type EdgeSpectatorMessage={type:'edge';kind:string;tick:number;at:number}&Record<string,unknown>;
type SoulRefMsg={soulId:string;name:string};
/** Fold the edge feed into spectator speech (say + conversation turns), tracking conversation members. */
export function speechFromEdge(messages:readonly EdgeSpectatorMessage[],where:(soulId:string)=>readonly [number,number,number]|null):SpectatorSpeech[]{
 const members=new Map<string,Set<string>>(),out:SpectatorSpeech[]=[];
 const ref=(v:unknown)=>v&&typeof v==='object'&&typeof (v as SoulRefMsg).soulId==='string'?v as SoulRefMsg:null;
 for(const m of messages){
  if(m.kind==='conversation.start'){const id=String(m.conversation),from=ref(m.from);const set=new Set<string>();if(from)set.add(from.soulId);members.set(id,set);}
  else if(m.kind==='conversation.member'){const id=String(m.conversation),who=ref(m.soul);if(!who)continue;const set=members.get(id)??new Set<string>();if(m.change==='joined'||m.change==='accepted')set.add(who.soulId);else if(m.change==='left'||m.change==='dropped')set.delete(who.soulId);members.set(id,set);}
  else if(m.kind==='conversation.closed')members.delete(String(m.conversation));
  else if(m.kind==='conversation.turn'){const id=String(m.conversation),turn=m.turn as {seq:number;at:number;from:SoulRefMsg;text:string}|undefined;if(!turn||!ref(turn.from))continue;
   const set=members.get(id)??new Set<string>();set.add(turn.from.soulId);members.set(id,set);const p=where(turn.from.soulId);
   out.push({id:`turn:${id}:${turn.seq}`,at:turn.at??m.at,tick:m.tick,speaker:turn.from.soulId,speakerName:turn.from.name,text:String(turn.text??''),within:p?enclosingPlace(p[0],p[1],p[2])?.id??null:null,channel:{kind:'conversation',conversationId:id,members:[...set].sort()}});}
  else if(m.kind==='speech'){const from=ref(m.from);if(!from)continue;const ch=m.channel as {kind:string;placeId?:string|null;radius?:number;object?:string;base?:{kind:string;placeId?:string|null}}|undefined;
   const base=ch?.kind==='audience'?ch.base:ch,within=base?.kind==='enclosure'&&base.placeId?base.placeId:null;
   const channel:SpeechChannel=ch?.kind==='audience'?{kind:'audience',placeId:String(base?.placeId??'')}:within?{kind:'enclosure',placeId:within}:{kind:'earshot',radius:Number(ch?.radius)||12};
   out.push({id:String(m.id??`speech:${m.tick}`),at:m.at,tick:m.tick,...(Array.isArray(m.heardBy)?{heardBy:m.heardBy.map(String)}:{}),speaker:from.soulId,speakerName:from.name,text:String(m.text??''),within,channel});}
 }
 return out;
}
