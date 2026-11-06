import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
export const soulAvatars={images:new Map<string,string>(),sources:new Map<string,{entityId:string;model:string;bodyRoot:string}>(),events:new EventTarget()};
const activityProp=(o:THREE.Object3D)=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(p.name.startsWith('activity prop:'))return true;return false;};
/** Fit visible portrait geometry and aim at its actual head, independent of world pose/hidden helpers. */
export function soulPortraitView(root:THREE.Object3D,rigid:boolean){
 root.position.set(0,0,0);root.rotation.set(0,0,0);root.visible=true;root.updateMatrixWorld(true);const box=new THREE.Box3();let head:THREE.Object3D|null=null;
 root.traverse(o=>{for(let p:THREE.Object3D|null=o;p;p=p.parent)if(!p.visible)return;if((o as THREE.Bone).isBone&&/head$/i.test(o.name))head??=o;if((o as THREE.Mesh).isMesh){const mesh=o as THREE.Mesh;let local:THREE.Box3|null;if((o as THREE.SkinnedMesh).isSkinnedMesh){const skin=o as THREE.SkinnedMesh;skin.skeleton.update();skin.computeBoundingBox();local=skin.boundingBox;}else if((o as THREE.InstancedMesh).isInstancedMesh){const instances=o as THREE.InstancedMesh;instances.computeBoundingBox();local=instances.boundingBox;}else{if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();local=mesh.geometry.boundingBox;}if(local)box.union(local.clone().applyMatrix4(o.matrixWorld));}});
 if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return null;const size=box.getSize(new THREE.Vector3()),target=box.getCenter(new THREE.Vector3());
 if(!rigid){if(head){(head as THREE.Object3D).getWorldPosition(target);target.y+=(box.max.y-target.y)*.35;}else target.y=box.max.y-size.y*.17;}
 const height=rigid?Math.max(size.x,size.y,size.z):head?Math.max(size.y*.42,.35):Math.max(size.y*.42,size.x*.85);return{box,target,height};
}
/** Bounded portraits use the world renderer and one reusable offscreen target. */
export class WorldSoulAvatars{
 private target:THREE.WebGLRenderTarget|null=null;private failed=false;private last=0;private keys=new Map<string,string>();
 private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(28,1,.01,100);
 private renderer:THREE.WebGLRenderer;
 constructor(renderer:THREE.WebGLRenderer){this.renderer=renderer;this.scene.background=new THREE.Color('#e9e6dc');this.scene.add(new THREE.HemisphereLight(0xffffff,0x67543f,3));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,3);this.scene.add(light);}
 capture(id:string,key:string,body:THREE.Object3D|null,rigid:boolean,now:number){
  if(!body||this.failed||now-this.last<300)return;const surfaces:string[]=[];body.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh&&!activityProp(o))surfaces.push(m.geometry.uuid+':'+[m.material].flat().map(material=>material.uuid+':'+((material as THREE.MeshStandardMaterial).map?.uuid??'')).join(','));});key+='|'+surfaces.join(';');if(this.keys.get(id)===key)return;this.last=now;
  let portrait:THREE.Object3D|null=null;
  try{
   this.target??=new THREE.WebGLRenderTarget(96,96,{depthBuffer:true});this.target.texture.colorSpace=THREE.SRGBColorSpace;
   portrait=clone(body);if(!rigid&&body.userData.avatarIdleClip){const mixer=new THREE.AnimationMixer(portrait);mixer.clipAction(THREE.AnimationClip.parse(body.userData.avatarIdleClip)).play();mixer.update(.01);}
   const props:THREE.Object3D[]=[];portrait.traverse(o=>{if(o.name.startsWith('activity prop:'))props.push(o);});props.forEach(p=>p.removeFromParent());
   this.scene.add(portrait);const view=soulPortraitView(portrait,rigid);if(!view)return;const {target,height}=view;
   const distance=height/(2*Math.tan(this.camera.fov*Math.PI/360))*1.25;
   // Both rigs and canonical ceramic heads face local +X after their model adapter.
   this.camera.position.copy(target).add(new THREE.Vector3(distance,height*.08,distance*.45));this.camera.lookAt(target);
   const renderer=this.renderer,previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear;
   const pixels=new Uint8Array(96*96*4);
   // setRenderTarget uses physical96px even on a Retina world canvas; setViewport would multiply by its pixel ratio.
   try{renderer.setRenderTarget(this.target);renderer.setScissorTest(false);renderer.autoClear=true;renderer.render(this.scene,this.camera);renderer.readRenderTargetPixels(this.target,0,0,96,96,pixels);}
   finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;}
   const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Portrait canvas unavailable');
   const image=ctx.createImageData(96,96);for(let y=0;y<96;y++)image.data.set(pixels.subarray((95-y)*96*4,(96-y)*96*4),y*96*4);ctx.putImageData(image,0,0);const url=canvas.toDataURL('image/png');
   this.keys.set(id,key);soulAvatars.images.set(id,url);soulAvatars.sources.set(id,{entityId:String(body.userData.entity??body.name),model:String(body.userData.bodyModel??'stand-in'),bodyRoot:body.uuid});soulAvatars.events.dispatchEvent(new Event('change'));
  }catch{this.failed=true;this.target?.dispose();this.target=null;soulAvatars.images.delete(id);soulAvatars.sources.delete(id);soulAvatars.events.dispatchEvent(new Event('change'));}
  finally{portrait?.removeFromParent();portrait?.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)(o as THREE.SkinnedMesh).skeleton.dispose();});}
 }
 dispose(){this.target?.dispose();this.target=null;this.keys.clear();}
}
