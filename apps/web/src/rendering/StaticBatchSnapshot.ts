import * as THREE from 'three';
import {frozenMatrixWorld} from './FrozenMatrixWorld.ts';

type NodeStamp={object:THREE.Object3D;parent:NodeStamp|null;index:number;childCount:number;visible:boolean;static:boolean;complete:boolean;registered:boolean;whole:boolean;path:boolean};
const nativeWorld=THREE.Object3D.prototype.updateWorldMatrix,nativeLocal=THREE.Object3D.prototype.updateMatrix,nativeTree=THREE.Object3D.prototype.updateMatrixWorld;
const ordinary=(o:THREE.Object3D)=>o.updateWorldMatrix===nativeWorld&&(!o.matrixAutoUpdate||o.updateMatrix===nativeLocal)&&(o.updateMatrixWorld===nativeTree||o.updateMatrixWorld===frozenMatrixWorld);
const isStatic=(o:THREE.Object3D)=>!o.animations.length&&!o.userData.dynamicScreen&&!o.userData.renderDynamic&&o.userData.kind!=='context_person';
const inert=(o:THREE.Object3D)=>o.constructor===THREE.Object3D||o.constructor===THREE.Group;
const refresh=(o:THREE.Object3D)=>{(o.updateWorldMatrix as (parents:boolean,children:boolean,force:boolean)=>void)(false,false,true);};

/** A bounded, parent-first record of only inspected nodes. Child indices prove links without searching new trees.
 * Node discovery and child-link discovery each have the same finite maxNodes ceiling. Matrix work is one call per
 * saved node per refresh; a failed root's partial records are discarded, while its work remains charged. */
export class StaticBatchSnapshot{
 readonly records:NodeStamp[]=[];readonly nodes=new Map<THREE.Object3D,NodeStamp>();
 nodeVisits=0;sourceNodes=0;ancestorNodes=0;linkVisits=0;matrixUpdates=0;
 private scene:THREE.Scene;private maxNodes:number;
 private indices=new Map<THREE.Object3D,{next:number;known:Map<THREE.Object3D,number>}>();
 constructor(scene:THREE.Scene,maxNodes:number){this.scene=scene;this.maxNodes=maxNodes;}
 private charge(ancestor:boolean){if(this.nodeVisits>=this.maxNodes)throw Error('static-batches.node-budget');this.nodeVisits++;if(ancestor)this.ancestorNodes++;else this.sourceNodes++;}
 private link(parent:THREE.Object3D,index:number){if(this.linkVisits>=this.maxNodes)throw Error('static-batches.topology-budget');this.linkVisits++;return parent.children[index];}
 private index(parent:THREE.Object3D,child:THREE.Object3D){
  let scan=this.indices.get(parent);if(!scan){scan={next:0,known:new Map()};this.indices.set(parent,scan);}
  const known=scan.known.get(child);if(known!==undefined){if(parent.children[known]!==child)throw Error('static-batches.source-changed');return known;}
  while(scan.next<parent.children.length){const i=scan.next++,o=this.link(parent,i);scan.known.set(o,i);if(o===child)return i;}
  throw Error('static-batches.source-changed');
 }
 private add(object:THREE.Object3D,parent:NodeStamp|null,index:number){
  if(!ordinary(object))throw Error('static-batches.unsupported-matrices');
  const stamp:NodeStamp={object,parent,index,childCount:object.children.length,visible:object.visible,static:isStatic(object),complete:false,registered:object===this.scene||!!parent?.registered,whole:true,path:object.visible&&isStatic(object)&&(!parent||parent.path)};
  refresh(object);this.matrixUpdates++;this.nodes.set(object,stamp);this.records.push(stamp);return stamp;
 }
 capture(root:THREE.Object3D){
  if(root===this.scene)throw Error('static-batches.unregistered-root');
  if(this.nodes.get(root)?.complete)return null;
  const start=this.records.length,completed:NodeStamp[]=[];
  try{
   // Stop as soon as the saved parent chain is reached. A cycle or a deep new chain never recurses.
   const ancestors:THREE.Object3D[]=[],chain=new Set<THREE.Object3D>();let p=root.parent;
   while(p&&!this.nodes.has(p)){if(p===root||chain.has(p))throw Error('static-batches.source-cycle');chain.add(p);this.charge(true);ancestors.push(p);p=p.parent;}
   let parent=p?this.nodes.get(p)!:null;
   for(let i=ancestors.length-1;i>=0;i--){const o=ancestors[i];parent=this.add(o,parent,parent?this.index(parent.object,o):-1);}
   if(!parent?.registered)throw Error('static-batches.unregistered-root');
   let first=this.nodes.get(root);if(!first){this.charge(false);first=this.add(root,parent,this.index(parent.object,root));}
   const selected:NodeStamp[]=[first],stack:{stamp:NodeStamp;next:number}[]=[{stamp:first,next:0}];
   while(stack.length){const frame=stack[stack.length-1],s=frame.stamp;
    if(frame.next===s.childCount){s.complete=true;completed.push(s);stack.pop();continue;}
    // Do not even read the next child when a root cannot fit. A hidden boundary still needs a complete bounded
    // snapshot: if it becomes visible later, coverage can be revoked without inspecting new descendants.
    if(this.nodeVisits>=this.maxNodes)throw Error('static-batches.node-budget');
    const i=frame.next++,o=this.link(s.object,i);if(!o||o.parent!==s.object)throw Error('static-batches.source-changed');
    const known=this.nodes.get(o);
    if(known){if(known.parent!==s||known.index!==i||!known.complete)throw Error('static-batches.source-cycle');first.whole=false;continue;}
    this.charge(false);const child=this.add(o,s,i);selected.push(child);stack.push({stamp:child,next:0});
   }
   return {stamps:selected,discard:()=>{for(const s of completed)s.complete=false;for(let i=this.records.length-1;i>=start;i--)this.nodes.delete(this.records[i].object);this.records.length=start;}};
  }catch(error){for(const s of completed)s.complete=false;for(let i=this.records.length-1;i>=start;i--)this.nodes.delete(this.records[i].object);this.records.length=start;throw error;}
 }
 finishCapture(){this.indices.clear();}
 /** Current source paths use only saved parent links. Child counts affect complete coverage, not the validity of an
  * unchanged represented sibling. Reparenting to a new/deep/cyclic branch never follows that branch. */
 refresh(){
  const paths=new Map<THREE.Object3D,boolean>();
  for(const s of this.records){const o=s.object,linked=o.parent===(s.parent?.object??null)&&(!s.parent||s.parent.object.children[s.index]===o),parentOkay=!s.parent||paths.get(s.parent.object)===true;
   const okay=linked&&parentOkay&&ordinary(o);if(okay){refresh(o);this.matrixUpdates++;}paths.set(o,okay&&o.visible&&isStatic(o));
  }return paths;
 }
 unchanged(){return this.records.every(s=>s.object.parent===(s.parent?.object??null)&&(!s.parent||s.parent.object.children[s.index]===s.object)&&ordinary(s.object)&&(!s.complete||s.object.children.length===s.childCount&&s.object.visible===s.visible&&isStatic(s.object)===s.static));}
 covered(root:THREE.Object3D,represented:Set<THREE.Mesh>,cache:Map<THREE.Object3D,boolean>){
  if(!cache.size){
   for(const s of this.records){const o=s.object;cache.set(o,!o.visible||s.complete&&o.children.length===s.childCount&&(inert(o)||represented.has(o as THREE.Mesh)||o.userData.shadowProxy===true));}
   for(let i=this.records.length-1;i>=0;i--){const s=this.records[i];if(s.parent&&s.parent.object.visible&&(s.object.parent!==s.parent.object||s.parent.object.children[s.index]!==s.object||!cache.get(s.object)))cache.set(s.parent.object,false);}
  }
  return this.nodes.get(root)?.whole===true&&cache.get(root)===true;
 }
}
