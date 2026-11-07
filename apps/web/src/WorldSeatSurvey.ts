import * as THREE from 'three';
/** W8: whole-map "sits on the ground" check. Every drawn seat (bench, chair, stool, sofa, seat) is tested where it
 * stands: a short ray from just above its lowest point finds what is under it (ground, floor, deck, pier). A seat
 * whose base hangs more than FLOAT_M above that support is floating; one whose base sits more than BURY_M below the
 * ground under it is buried. Read-only and on demand (`?survey=seats`, result on window.__soulsSeatSurvey). */
export const FLOAT_M=.12,BURY_M=.15;
export const SEAT_NAME=/(?:^|[^a-z])(?:bench|benches|chair|chairs|stool|stools|sofa|sofas|couch|settee|seat|seats|armchair|deckchair|lounger|pew|pews)(?:[^a-z]|$)/i;
const NOT_SEAT=/(?:^|[^a-z])(?:seat-?belt|car|vehicle|wagon|balloon|boat|bike|bicycle|swing|label|marker|ring|halo|highlight|ghost|people|soul|body)(?:[^a-z]|$)/i;
export type SeatFinding={name:string;at:[number,number,number];base:number;support:number|null;ground:number|null;gap:number|null;verdict:'ok'|'floating'|'buried'|'unsupported'};
const box=new THREE.Box3(),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),from=new THREE.Vector3();
const names=(o:THREE.Object3D)=>{let s='';for(let p:THREE.Object3D|null=o,n=0;p&&n<4;p=p.parent,n++)s+=' '+p.name;return s;};
/** Seat roots: the outermost object whose own name says seat (its children are its parts). */
export function findSeats(root:THREE.Object3D):THREE.Object3D[]{
 const out:THREE.Object3D[]=[];
 const walk=(o:THREE.Object3D)=>{if(!o.visible)return;if(o!==root&&SEAT_NAME.test(o.name)&&!NOT_SEAT.test(names(o))){out.push(o);return;}for(const c of o.children)walk(c);};
 walk(root);return out;
}
/** Survey seats. `ground(x,z)` is the bare ground height (null where none); `solids` are what a seat may stand on. */
export function surveySeats(seats:readonly THREE.Object3D[],solids:readonly THREE.Object3D[],ground:(x:number,z:number)=>number|null):SeatFinding[]{
 const out:SeatFinding[]=[];
const m4=new THREE.Matrix4();
 const one=(name:string,own:Set<THREE.Object3D>)=>{
  if(box.isEmpty())return;
  const c=box.getCenter(new THREE.Vector3()),base=box.min.y;
  // probe under the middle and four inset corners: the highest support under any of them is what it rests on
  let support:number|null=null;const sx=(box.max.x-box.min.x)*.35,sz=(box.max.z-box.min.z)*.35;
  for(const [dx,dz] of [[0,0],[sx,sz],[-sx,sz],[sx,-sz],[-sx,-sz]]){
   ray.set(from.set(c.x+dx,base+.3,c.z+dz),down);ray.near=0;ray.far=6;
   for(const h of ray.intersectObjects(solids as THREE.Object3D[],true)){if(own.has(h.object))continue;const y=h.point.y;if(support===null||y>support)support=y;break;}
  }
  const g=ground(c.x,c.z),gap=support===null?null:base-support;
  const buried=g!==null&&g-base>BURY_M&&(support===null||support<g-.05||Math.abs(support-g)<.05);
  const verdict=buried?'buried':support===null?'unsupported':gap!>FLOAT_M?'floating':'ok';
  out.push({name,at:[+c.x.toFixed(2),+c.y.toFixed(2),+c.z.toFixed(2)],base:+base.toFixed(3),support:support===null?null:+support.toFixed(3),ground:g===null?null:+g.toFixed(3),gap:gap===null?null:+gap.toFixed(3),verdict});
 };
 for(const s of seats){
  s.updateWorldMatrix(true,true);const own=new Set<THREE.Object3D>();s.traverse(o=>own.add(o));
  // instanced seats (a row of park benches drawn as one mesh): each instance is its own seat
  // (only when the seat object itself is instanced: instanced parts inside a seat group are slats and legs)
  const inst:THREE.InstancedMesh[]=(s as THREE.InstancedMesh).isInstancedMesh?[s as THREE.InstancedMesh]:[];
  if(inst.length){for(const im of inst){if(!im.geometry.boundingBox)im.geometry.computeBoundingBox();
    for(let i=0;i<im.count;i++){im.getMatrixAt(i,m4);box.copy(im.geometry.boundingBox!).applyMatrix4(m4.premultiply(im.matrixWorld));one(`${s.name} #${i}`,own);}}continue;}
  box.setFromObject(s);one(s.name,own);
 }
 return out;
}
