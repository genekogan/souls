import * as THREE from 'three';
import {makeProp,PROPS,type PropKind} from '../../../mars/viewer/app/engine-view/activity-poses.ts';
import {humanGroundAt} from '../../../mars/viewer/app/engine-view/people-light.ts';
import {Backoff,whenVisible} from './poll-pace.ts';
/** Things lying around (together/1 items, EDGE-CONTRACT §7d): the public `GET /v1/edge/items` list drawn as small props
 * on the ground at their `at`. Read-only and cosmetic: polled every few seconds; nothing here can pick up or move an item. */
export type EdgeItem={id:string;kind:string;name?:string;state:string;at:[number,number]|null;placeId?:string|null;holder?:string|null};
const KIND:Record<string,PropKind>={book:'book',flower:'flower',cup:'cup',food:'food',letter:'letter',tool:'tool',frisbee:'frisbee',plate:'plate',pen:'pen',brush:'brush',cards:'cards'};
const POLL_MS=6000,POLL_MAX_MS=30_000;  // PERF-EDEN: ×1.5 while the list does not change, up to 30 s; never while hidden
export class WorldEdgeItems{
 readonly group=new THREE.Group();
 private shown=new Map<string,{kind:PropKind;obj:THREE.Object3D;key:string}>();
 private timer:ReturnType<typeof setTimeout>|null=null;
 constructor(private readonly url:string){this.group.name='edge items';}
 start(signal:AbortSignal){
  const pace=new Backoff(POLL_MS,POLL_MAX_MS);let last='',cancelVisible=()=>{};
  const tick=async()=>{
   let changed=false;
   try{const r=await fetch(this.url,{signal});if(r.ok){const text=await r.text();changed=text!==last;last=text;const body=JSON.parse(text) as {items?:EdgeItem[]};if(Array.isArray(body.items)&&changed)this.set(body.items);}}catch{/* offline: keep what is shown */}
   if(!signal.aborted)this.timer=setTimeout(()=>{cancelVisible=whenVisible(()=>void tick());},pace.next(changed));
  };
  signal.addEventListener('abort',()=>{if(this.timer)clearTimeout(this.timer);cancelVisible();});
  void tick();
 }
 /** Draw exactly the placed items of this list (each a prop lying on its side on the ground). */
 set(items:readonly EdgeItem[]){
  const keep=new Set<string>();
  for(const it of items.slice(0,200)){
   const kind=KIND[it.kind];if(it.state!=='placed'||!it.at||!kind||!(PROPS as readonly string[]).includes(kind))continue;
   const [x,z]=it.at;if(!Number.isFinite(x)||!Number.isFinite(z))continue;
   keep.add(it.id);const key=`${kind}:${x.toFixed(3)}:${z.toFixed(3)}`;
   let s=this.shown.get(it.id);
   if(s&&s.key===key)continue;
   if(!s||s.kind!==kind){if(s)this.group.remove(s.obj);const obj=new THREE.Group();obj.add(lay(makeProp(kind),kind));obj.name='item '+it.id;s={kind,obj,key};this.shown.set(it.id,s);this.group.add(obj);}
   s.key=key;const y=humanGroundAt(x,z)??0,h=hash(it.id);
   s.obj.position.set(x,y,z);s.obj.rotation.set(0,h*Math.PI*2,0);
  }
  for(const [id,s] of this.shown)if(!keep.has(id)){this.group.remove(s.obj);this.shown.delete(id);}
 }
 dispose(){if(this.timer)clearTimeout(this.timer);this.group.clear();this.shown.clear();}
}
/** A hand prop (activity-poses.ts frame: x away from the holder, y up) set down: flat things lie flat, the rest stand. */
function lay(o:THREE.Object3D,kind:PropKind){
 o.traverse(m=>{m.castShadow=true;});
 if(kind==='book'||kind==='letter'||kind==='cards'){o.rotation.z=Math.PI/2;o.position.y=0.03;}
 else if(kind==='flower'||kind==='pen'||kind==='brush'||kind==='tool'){o.rotation.x=Math.PI/2;o.position.y=0.02;}
 else if(kind==='plate'||kind==='food'){o.position.y=0.03;}
 else if(kind==='frisbee'){o.position.y=0.02;}
 else o.position.y=0.0;
 return o;
}
const hash=(id:string)=>{let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return (h>>>0)/4294967296;};
