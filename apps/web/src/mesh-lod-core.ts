/** The pure half of WorldMeshLod's level building (no three.js), shared by the main thread (tests, fallback) and the
 * worker (mesh-lod.worker.ts) so a phone never stalls for hundreds of milliseconds simplifying a big terrain sector. */
export type Simplifier={simplify(indices:Uint32Array,positions:Float32Array,stride:number,targetIndexCount:number,targetError:number,flags?:string[]):[Uint32Array,number];
  simplifyWithAttributes?(indices:Uint32Array,positions:Float32Array,stride:number,attributes:Float32Array,attributeStride:number,weights:number[],lock:Uint8Array|null,targetIndexCount:number,targetError:number,flags?:string[]):[Uint32Array,number]};
/** Copied, transferable arrays of one geometry: positions (xyz), indices, and the attributes that guide simplification
 * (vertex colours, normals) with their weights. */
export type LodInput={positions:Float32Array;indices:Uint32Array;parts:{array:Float32Array;n:number;w:number}[]};
export type LodLevel={index:Uint32Array;error:number;triangles:number};
/** Admission before copying a mesh's input; cancel releases callbacks, not still-running physical work. */
export type LodReservation={levels(input:LodInput,ratios:readonly number[],maxError:number):Promise<LodLevel[]>;cancel():void};
/** Builds levels off the main thread; resolves with the same result as simplifyLevels. */
export type AsyncSimplifier={levels(input:LodInput,ratios:readonly number[],maxError:number):Promise<LodLevel[]>;reserve?():LodReservation|null;readonly isAsync:true};

/** Coarser index levels, coarsest last; a level is kept only when it is meaningfully coarser than the previous one. */
export function simplifyLevels(s:Simplifier,input:LodInput,ratios:readonly number[],maxError=Number.MAX_VALUE):LodLevel[]{
  const {positions,indices,parts}=input,count=positions.length/3;
  const stride=parts.reduce((k,p)=>k+p.n,0),attributes=stride&&s.simplifyWithAttributes?new Float32Array(count*stride):null;
  if(attributes)for(let v=0;v<count;v++){let o=v*stride;for(const p of parts)for(let c=0;c<p.n;c++)attributes[o++]=p.array[v*p.n+c];}
  const weights=parts.flatMap(p=>Array(p.n).fill(p.w));
  const out:LodLevel[]=[];let last=indices.length;
  for(const r of ratios){
    const target=Math.max(3,Math.floor(indices.length*r/3)*3);
    const [index,error]=attributes?s.simplifyWithAttributes!(indices,positions,3,attributes,stride,weights,null,target,maxError,['LockBorder','ErrorAbsolute']):s.simplify(indices,positions,3,target,maxError,['LockBorder','ErrorAbsolute']);
    if(!(index.length>0)||index.length>=last*0.8||!Number.isFinite(error))continue;
    out.push({index,error,triangles:index.length/3});last=index.length;
  }
  return out;
}
