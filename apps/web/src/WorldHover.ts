import * as THREE from 'three';
import {cameraGround} from './WorldCameraGround.ts';
export type HoverTarget={kind:'soul'|'object'|'place';id:string;name:string;detail?:string;point:THREE.Vector3;markerPoint?:THREE.Vector3;radius:number};
export type HoverPlace={id:string;name:string;polygon:readonly(readonly[number,number])[];level?:number;schedule?:readonly{label:string}[]};
export function containingPlace(point:THREE.Vector3,places:readonly HoverPlace[]):HoverPlace|null{
 let best:HoverPlace|null=null,area=Infinity;
 for(const place of places){if(place.level&&Math.abs(point.y-place.level*3)>2)continue;const poly=place.polygon;let inside=false,size=0;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [x,z]=poly[i],[a,b]=poly[j];if(z>point.z!==b>point.z&&point.x<(a-x)*(point.z-z)/(b-z)+x)inside=!inside;size+=(a+x)*(b-z);}
  if(inside&&Math.abs(size)<area){best=place;area=Math.abs(size);}
 }return best;
}
/** At most 30 picks/second, one shared marker and a plain-text tooltip. */
export class WorldHover{
 readonly marker=new THREE.Mesh(new THREE.RingGeometry(.58,.67,48).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#fff0ab',transparent:true,opacity:.6,depthTest:false,side:THREE.DoubleSide}));
 private tooltip:HTMLDivElement;private pointer:{x:number;y:number;ndc:THREE.Vector2}|null=null;private last=0;private held=false;private listeners:[EventTarget,string,EventListener][]=[];private timer:ReturnType<typeof setTimeout>|null=null;
 private target:HoverTarget|null=null;
 private canvas:HTMLCanvasElement;
 private camera:THREE.PerspectiveCamera;
 private o:{scene:()=>THREE.Object3D;roots:()=>readonly THREE.Object3D[];entity:(id:string)=>Omit<HoverTarget,'radius'>|null;places:()=>readonly HoverPlace[];available:()=>boolean;inspect:(t:HoverTarget)=>void};
 constructor(canvas:HTMLCanvasElement,camera:THREE.PerspectiveCamera,o:{scene:()=>THREE.Object3D;roots:()=>readonly THREE.Object3D[];entity:(id:string)=>Omit<HoverTarget,'radius'>|null;places:()=>readonly HoverPlace[];available:()=>boolean;inspect:(t:HoverTarget)=>void}){this.canvas=canvas;this.camera=camera;this.o=o;
  this.marker.name='hover-ring';this.marker.visible=false;this.marker.renderOrder=997;
  this.tooltip=document.createElement('div');this.tooltip.className='world-hover-tooltip';this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');canvas.parentElement?.append(this.tooltip);
  const listen=(t:EventTarget,n:string,f:EventListener)=>{t.addEventListener(n,f);this.listeners.push([t,n,f]);};
  listen(canvas,'pointermove',((e:PointerEvent)=>{if(e.buttons){this.clear();return;}this.remember(e);}) as EventListener);
  listen(canvas,'pointerleave',()=>{this.pointer=null;this.clear();});
  listen(canvas,'pointerdown',((e:PointerEvent)=>{this.held=true;this.clear();if(e.pointerType==='touch'){this.remember(e);this.timer=setTimeout(()=>{const t=this.pick(e.clientX,e.clientY);if(t){this.show(t,e.clientX,e.clientY);this.o.inspect(t);}},450);}}) as EventListener);
  listen(canvas,'pointerup',()=>{this.held=false;if(this.timer)clearTimeout(this.timer);this.timer=null;});
  listen(canvas,'pointercancel',()=>{this.held=false;this.pointer=null;this.clear();});
 }
 private remember(e:PointerEvent){const r=this.canvas.getBoundingClientRect();this.pointer={x:e.clientX,y:e.clientY,ndc:new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1)};}
 pick(x:number,y:number):HoverTarget|null{
  if(!this.o.available())return null;const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return null;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),this.camera);
  const visible=(o:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(!p.visible)return false;return true;};
  for(const hit of ray.intersectObjects([...new Set(this.o.roots())],true)){if(!visible(hit.object))continue;let o:THREE.Object3D|null=hit.object;
   while(o){const id=typeof o.userData.entity==='string'?o.userData.entity:o.name;const entity=id?this.o.entity(id):null;if(entity){
     const box=new THREE.Box3().setFromObject(o),size=box.getSize(new THREE.Vector3());
     const valid=!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite);
     return {...entity,markerPoint:entity.point,point:valid?box.getCenter(new THREE.Vector3()):entity.point,radius:valid?Math.max(.5,size.length()/2):entity.kind==='soul'?1:2};
   }o=o.parent;}
   const material=(hit.object as THREE.Mesh).material;const materials=[material].flat();if(hit.object.userData.cameraTransparent!==true&&materials.some(m=>m&&m.visible&&(!m.transparent||m.opacity>=.5)))break;
  }
  if(ray.ray.direction.y>=-.02)return null;let ground:THREE.Vector3|null=null;
  for(let t=1;t<600;t+=Math.max(1,t*.025)){const p=ray.ray.at(t,new THREE.Vector3()),height=cameraGround.heightAt(this.o.scene(),p.x,p.z)??0;if(p.y<=height){p.y=height;ground=p;break;}}
  if(!ground)return null;const place=containingPlace(ground,this.o.places());if(!place)return null;
  const point=new THREE.Vector3();for(const p of place.polygon)point.add(new THREE.Vector3(p[0],ground.y,p[1]));point.multiplyScalar(1/place.polygon.length);
  return {kind:'place',id:place.id,name:place.name,detail:place.schedule?.map(s=>s.label).join(' · '),point,radius:Math.max(8,...place.polygon.map(p=>Math.hypot(p[0]-point.x,p[1]-point.z)))};
 }
 private show(t:HoverTarget,x:number,y:number){this.target=t;this.marker.visible=true;this.marker.position.copy(t.markerPoint??t.point);this.marker.position.y+=.05;this.marker.scale.setScalar(t.kind==='place'?Math.min(7,t.radius*.25):1);this.tooltip.textContent=hoverTooltipText(t.name,t.detail);this.tooltip.title=t.name+(t.detail?' · '+t.detail:'');const r=this.canvas.getBoundingClientRect();this.tooltip.style.left=Math.max(8,Math.min(r.width-180,x-r.left+12))+'px';this.tooltip.style.top=Math.max(8,y-r.top-40)+'px';this.tooltip.hidden=false;this.canvas.style.cursor='pointer';}
 update(now:number){if(this.held||!this.pointer||now-this.last<34)return;this.last=now;const t=this.pick(this.pointer.x,this.pointer.y);if(t)this.show(t,this.pointer.x,this.pointer.y);else this.clear();}
 clear(){this.target=null;this.marker.visible=false;this.tooltip.hidden=true;this.canvas.style.cursor='';if(this.timer)clearTimeout(this.timer);this.timer=null;}
 dispose(){this.clear();for(const [t,n,f] of this.listeners)t.removeEventListener(n,f);this.tooltip.remove();this.marker.removeFromParent();this.marker.geometry.dispose();(this.marker.material as THREE.Material).dispose();}
}

export function hoverTooltipText(name:string,detail?:string){const short=(text:string,max:number)=>text.length>max?text.slice(0,max-1).trimEnd()+'…':text;return short(name,54)+(detail?' · '+short(detail,76):'');}
