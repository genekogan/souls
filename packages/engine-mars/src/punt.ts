// punt/1: a conservative calm-water route plus dry-bank transfer, using carrier/1's two-seat controller.
// The exact route and bank heights are logged by the host. No author-model reads are needed on replay.
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {CarrierInstallSpec, CarrierRoute} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {routePosition,routeTicks} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import type {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import type {RenderScene} from '@souls/engine-contract';
import {groundRecipe} from './ground-bridge.ts';
import {createTerrainGeometryProbe} from './terrain.ts';
import {createWaterGeometryProbe} from './water-geometry.ts';
import {hashOf} from '../../../mars/viewer/engine/core/hash.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';

type V2=[number,number];
type V3=[number,number,number];
type Surface={id:string;polygon:V2[];level:number;wet(x:number,z:number):boolean;bank(x:number,z:number):number|null};
const round=(v:number)=>Math.round(v*1e4)/1e4;
// Pure numeric constants, with the same angle/multiplication order as the original
// probes. Cache neither world geometry nor verdicts; every point still queries the live surface.
const HULL_OFFSETS=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [Math.cos(a)*1.75,Math.sin(a)*1.75] as const;});
const DISC_OFFSETS=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return [Math.cos(a)*.3,Math.sin(a)*.3] as const;});
const inPoly=(x:number,z:number,p:V2[])=>{let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
function surfaces(rt:Runtime,render?:RenderScene):Surface[]{
  const out:Surface[]=[],sp=rt.services.spatial as Spatial;
  const fact=(rt.world as typeof rt.world&{groundV1?:{recipeHash:string}}).groundV1,g=fact?groundRecipe(fact.recipeHash):null,f=sp.ground?.field;
  if(g&&f)for(const w of g.waters){if(!w.area)continue;const polygon=w.area as V2[];
    out.push({id:w.id,polygon,level:w.level,wet:(x,z)=>inPoly(x,z,polygon)&&Math.abs((f.waterLevel(x,z)??Infinity)-w.level)<.001&&w.level-f.height(x,z)>=.12,
      bank:(x,z)=>f.waterLevel(x,z)===null&&f.medium(x,z)<=1?f.height(x,z):null});}
  const shore=render?.shore;
  if(shore){const bed=createTerrainGeometryProbe(shore.terrain),water=createWaterGeometryProbe({...shore.water,terrain:shore.terrain}),b=shore.water.wetBoundsXZ;
    out.push({id:'eden-pond',polygon:[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],level:shore.water.datumY,
      wet:(x,z)=>{const q=water.column({atXZ:[x,z]});return q.depthMetres!==null&&q.depthMetres>=.12;},
      bank:(x,z)=>{const p=bed.point({atXZ:[x,z]}),q=water.column({atXZ:[x,z]});return p.point&&q.depthMetres===0?p.point[1]:null;}});
  }
  return out;
}
export type PuntSearchPhase='hull'|'route'|'bank'|'obstacles'|'edge'|'lattice'|'shelf'|'sort'|'sync'|'surface';
type Steps<T>=Generator<PuntSearchPhase,T,void>;
const drain=<T>(steps:Steps<T>):T=>{let n=steps.next();while(!n.done)n=steps.next();return n.value;};

/** A value snapshot, not an epoch/hash guess: catalogue furniture may move in a non-static phase, and
 * deck surfaces may be edited in place. Body poses and paged navigation windows are deliberately absent.
 * Ground recipes are content-addressed immutable inputs; replacing a field (including the same id) is a change.
 * Field implementations must replace their identity/functions when changing otherwise hidden geometry. */
function geometryValues(rt:Runtime,render:RenderScene|undefined,put:(value:unknown)=>void):void{
  const sp=rt.services.spatial as Spatial,g=sp.ground,f=g?.field;
  const fact=(rt.world as typeof rt.world&{groundV1?:{recipeHash:string}}).groundV1;
  put(rt.world);put(sp);put(g);put(f);put(f?.id);put(f?.height);put(f?.medium);put(f?.waterLevel);
  for(const value of f?.extent??[])put(value);
  put(fact?.recipeHash);put(fact?groundRecipe(fact.recipeHash):undefined);put(rt.world.base?.staticHash);put(sp.baseId);
  put((rt.world as typeof rt.world&{entityPhysicsV1?:{hash:string}}).entityPhysicsV1?.hash);
  put(JSON.stringify(render?.shore));
  // The field's deck overlay retains these live surface records. Do not compare scene identity: paged body
  // windows replace it without changing any water, deck or bank.
  for(const scene of [sp.base,sp.scene]){
    put(scene?.surfaces.length);
    for(const s of scene?.surfaces??[]){put(s.id);put(s.level);put(s.y);put(s.obb.c[0]);put(s.obb.c[1]);put(s.obb.half[0]);put(s.obb.half[1]);put(s.obb.yaw);}
  }
  let count=0;
  for(const id in rt.world.entities){
    if(!Object.hasOwn(rt.world.entities,id))continue;
    const e=rt.world.entities[id];count++;put(id);
    // All ids matter to the no-existing-punt condition. Only geometry contributors' poses matter, so a
    // moving person or non-obstacle carrier cannot continually cancel an otherwise unchanged search.
    const relevant=e.kind!=='human'&&((e.phase&&STATIC_PHASES.has(e.phase))||CATALOG[e.def]?.obstacle===true);
    put(!!relevant);
    if(!relevant)continue;
    put(e.kind);put(!!e.human);put(e.def);put(e.phase);put(e.pose.p[0]);put(e.pose.p[1]);put(e.pose.p[2]);
    put(e.pose.yaw);put(e.pose.pitch);put(e.pose.roll);put(e.support?.kind);
    const size=CATALOG[e.def]?.size;put(size?.[0]);put(size?.[2]);
    put(e.connections?.length);for(const c of e.connections??[]){put(c.socket);put(c.to);put(c.toSocket);}
  }
  put(count);
}
const STATIC_PHASES=new Set(['stored','reserved','staged','placed','installed','raising']);
function geometryStamp(rt:Runtime,render:RenderScene|undefined):unknown[]{const values:unknown[]=[];geometryValues(rt,render,v=>values.push(v));return values;}
function sameGeometry(stamp:unknown[],rt:Runtime,render:RenderScene|undefined):boolean{
  // Keep the exact geometryValues order, but avoid a callback for every scalar on every slice.
  // Object.is matters here: -0 differs from +0, while an unchanged NaN remains unchanged.
  // The focused mutation matrix checks this reader against the captured flat stamp.
  let i=0;
  const sp=rt.services.spatial as Spatial,g=sp.ground,f=g?.field;
  const fact=(rt.world as typeof rt.world&{groundV1?:{recipeHash:string}}).groundV1;
  if(!Object.is(rt.world,stamp[i++])||!Object.is(sp,stamp[i++])||!Object.is(g,stamp[i++])||!Object.is(f,stamp[i++])||
    !Object.is(f?.id,stamp[i++])||!Object.is(f?.height,stamp[i++])||!Object.is(f?.medium,stamp[i++])||!Object.is(f?.waterLevel,stamp[i++]))return false;
  for(const value of f?.extent??[])if(!Object.is(value,stamp[i++]))return false;
  if(!Object.is(fact?.recipeHash,stamp[i++])||!Object.is(fact?groundRecipe(fact.recipeHash):undefined,stamp[i++])||
    !Object.is(rt.world.base?.staticHash,stamp[i++])||!Object.is(sp.baseId,stamp[i++])||
    !Object.is((rt.world as typeof rt.world&{entityPhysicsV1?:{hash:string}}).entityPhysicsV1?.hash,stamp[i++])||
    !Object.is(JSON.stringify(render?.shore),stamp[i++]))return false;
  for(const scene of [sp.base,sp.scene]){
    if(!Object.is(scene?.surfaces.length,stamp[i++]))return false;
    for(const s of scene?.surfaces??[]){
      if(!Object.is(s.id,stamp[i++])||!Object.is(s.level,stamp[i++])||!Object.is(s.y,stamp[i++])||
        !Object.is(s.obb.c[0],stamp[i++])||!Object.is(s.obb.c[1],stamp[i++])||!Object.is(s.obb.half[0],stamp[i++])||
        !Object.is(s.obb.half[1],stamp[i++])||!Object.is(s.obb.yaw,stamp[i++]))return false;
    }
  }
  let count=0;
  for(const id in rt.world.entities){
    if(!Object.hasOwn(rt.world.entities,id))continue;
    const e=rt.world.entities[id];count++;
    const relevant=e.kind!=='human'&&((e.phase&&STATIC_PHASES.has(e.phase))||CATALOG[e.def]?.obstacle===true);
    if(!Object.is(id,stamp[i++])||!Object.is(!!relevant,stamp[i++]))return false;
    if(!relevant)continue;
    if(!Object.is(e.kind,stamp[i++])||!Object.is(!!e.human,stamp[i++])||!Object.is(e.def,stamp[i++])||!Object.is(e.phase,stamp[i++])||
      !Object.is(e.pose.p[0],stamp[i++])||!Object.is(e.pose.p[1],stamp[i++])||!Object.is(e.pose.p[2],stamp[i++])||
      !Object.is(e.pose.yaw,stamp[i++])||!Object.is(e.pose.pitch,stamp[i++])||!Object.is(e.pose.roll,stamp[i++])||!Object.is(e.support?.kind,stamp[i++]))return false;
    const size=CATALOG[e.def]?.size;
    if(!Object.is(size?.[0],stamp[i++])||!Object.is(size?.[2],stamp[i++])||!Object.is(e.connections?.length,stamp[i++]))return false;
    for(const c of e.connections??[]){
      if(!Object.is(c.socket,stamp[i++])||!Object.is(c.to,stamp[i++])||!Object.is(c.toSocket,stamp[i++]))return false;
    }
  }
  return Object.is(count,stamp[i++])&&i===stamp.length;
}
const shelfMemo=new WeakMap<Runtime,{stamp:unknown[];values:Map<string,CarrierInstallSpec|null>}>();
export type PuntSearchResult={state:'pending';phase:PuntSearchPhase|null}|{state:'cancelled'}|{state:'done';candidates:CarrierInstallSpec[]};

/** Private speculative work. advance(0) only polls; no iterator, geometry read or memo write starts.
 * Budget includes freshness checking. A yielded unit is a hull probe, short route block, bank probe or
 * direction trial; cold field queries, spatial sync and native sorting remain atomic and must be profiled.
 * The clock is injectable for deterministic scheduling tests, not a performance assertion. */
export class PuntSearch {
  private result:PuntSearchResult={state:'pending',phase:null};
  private steps:Steps<CarrierInstallSpec[]>|undefined;
  private stamp:unknown[]=[];
  private memo=new Map<string,CarrierInstallSpec|null>();
  private rt:Runtime;
  private render:()=>RenderScene|undefined;
  private now:()=>number;
  constructor(rt:Runtime,render:()=>RenderScene|undefined=()=>undefined,now:()=>number=()=>performance.now()){
    this.rt=rt;this.render=render;this.now=now;
  }
  cancel():PuntSearchResult{
    if(this.result.state==='pending'){this.steps?.return([]);this.steps=undefined;this.memo.clear();this.result={state:'cancelled'};}
    return this.result;
  }
  advance(budgetMs:number):PuntSearchResult{
    if(this.result.state!=='pending'||!(budgetMs>0))return this.result;
    const start=this.now(),render=this.render();
    if(!this.steps){
      this.stamp=geometryStamp(this.rt,render);
      const shared=shelfMemo.get(this.rt);
      if(shared&&sameGeometry(shared.stamp,this.rt,render))this.memo=new Map(shared.values);
      this.steps=puntCandidatesSteps(this.rt,render,this.memo,()=>{
        // Our synchronous sync can replace the field. This transition belongs to the original algorithm:
        // keep its pre-sync enumeration surface, but validate routes against its post-sync context.
        const next=geometryStamp(this.rt,render);
        if(next.length!==this.stamp.length||next.some((v,i)=>!Object.is(v,this.stamp[i])))this.memo.clear();
        this.stamp=next;
      });
    }else if(!sameGeometry(this.stamp,this.rt,render))return this.cancel();
    // Always advance one unit: a slow freshness check must not starve a pending search forever.
    do{
      const n=this.steps.next();
      if(n.done){
        if(!sameGeometry(this.stamp,this.rt,this.render()))return this.cancel();
        shelfMemo.set(this.rt,{stamp:this.stamp,values:this.memo});
        this.steps=undefined;this.result={state:'done',candidates:n.value};return this.result;
      }
      if(this.result.phase!==n.value)this.result={state:'pending',phase:n.value};
    }while(this.now()-start<budgetMs);
    return this.result;
  }
}

function* hullWetSteps(s:Surface,p:V3):Steps<boolean>{
  if(!(Math.abs(p[1]-s.level)<.001))return false;
  for(let i=0;i<HULL_OFFSETS.length;i++){const d=HULL_OFFSETS[i],wet=s.wet(p[0]+d[0],p[2]+d[1]);yield 'hull';if(!wet)return false;}
  return true;
};

type BankObstacle={x:number;z:number;radius:number};
type PreviewContext={surfaces():Surface[];obstacles():BankObstacle[]};
/** Geometry shared within one preview or a freshness-checked search job. */
function previewContext(rt:Runtime,render?:RenderScene):PreviewContext{
  let water:Surface[]|undefined,blocked:BankObstacle[]|undefined;
  return {
    surfaces:()=>water??(water=surfaces(rt,render)),
    obstacles:()=>{
      if(blocked)return blocked;
      blocked=[];
      for(const e of Object.values(rt.world.entities)){
        if(e.human||e.kind==='marker')continue;
        const size=CATALOG[e.def]?.obstacle?CATALOG[e.def]?.size:undefined;
        if(size)blocked.push({x:e.pose.p[0],z:e.pose.p[2],radius:Math.hypot(size[0],size[2])/2+.3});
      }
      return blocked;
    },
  };
}

/** Refuse a route leaving real water, a shallow hull, dry-water spoofing or a boarding/exit point off dry support. */
export function previewPunt(rt:Runtime,spec:CarrierInstallSpec,render?:RenderScene):{code:string;message:string}|null{
  return drain(previewInContextSteps(spec,previewContext(rt,render)));
}
function* previewInContextSteps(spec:CarrierInstallSpec,context:PreviewContext):Steps<{code:string;message:string}|null>{
  const no=(message:string)=>({code:'punt.unsupported-water',message});
  if(!spec.bank||!spec.routeKeys)return no('A punt needs a water-level loop and dry-bank boarding points.');
  const route:CarrierRoute={id:spec.route,keys:spec.routeKeys};
  let surface:Surface|undefined;
  for(const s of context.surfaces())if(yield* hullWetSteps(s,route.keys[0].p)){surface=s;break;}
  if(!surface)return no('There is no calm water deep and wide enough for the punt hull at this home.');
  const end=routeTicks(route);
  if(end<20*20||end>600*20)return no('A punt loop must take between 20 seconds and 10 minutes.');
  let last=routePosition(route,0);
  for(let k=1;k<=end;k++){const p=routePosition(route,k);
    if(Math.hypot(p[0]-last[0],p[1]-last[1],p[2]-last[2])>.6/20+.001)return no('The punt route exceeds its calm rowing speed of 0.6 m/s.');
    if((k%10===0||k===end)&&!(yield* hullWetSteps(surface,p)))return no('The entire punt loop must stay on water with room around the hull.');
    if(k%10===0)yield 'route';
    last=p;
  }
  const home=route.keys[0].p,bank=spec.bank;
  if(Math.hypot(bank.door[0]-home[0],bank.door[2]-home[2])>3.2)return no('The dry bank must be within reach of a short boarding plank.');
  for(const p of [bank.door,...Object.values(bank.exits)]){
    const y=surface.bank(p[0],p[2]);if(y===null||Math.abs(y-p[1])>.001)return no('The boarding plank and both exits need supported dry bank.');
    for(let i=0;i<DISC_OFFSETS.length;i++){const d=DISC_OFFSETS[i],y=surface.bank(p[0]+d[0],p[2]+d[1]);yield 'bank';if(y===null)return no('The whole standing disc needs dry bank.');}
    let tested=0;
    for(const e of context.obstacles()){
      // Flat native fixture boxes conservatively exclude a bank obstructed by furniture; ground solids are checked by the adapter.
      if(Math.hypot(e.x-p[0],e.z-p[2])<e.radius)return no('Furniture obstructs the boarding bank.');
      if(++tested%64===0)yield 'obstacles';
    }
  }
  return null;
}

/** Find one bounded water loop per admitted standing water (river paths remain an honest refusal).
 * Try the shore's long sides first; a concave/narrow/steep water simply yields no candidate. */
export function puntCandidates(rt:Runtime,render?:RenderScene):CarrierInstallSpec[]{
  const result=new PuntSearch(rt,()=>render).advance(Infinity);
  if(result.state!=='done')throw Error('punt.search-source-changed');
  return result.candidates;
}

function* puntCandidatesSteps(rt:Runtime,render:RenderScene|undefined,memo:Map<string,CarrierInstallSpec|null>,synced:()=>void):Steps<CarrierInstallSpec[]>{
  const out:CarrierInstallSpec[]=[];
  let context=previewContext(rt,render);
  for(const surface of context.surfaces()){
    yield 'surface';
    const p=surface.polygon,area=p.reduce((a,q,i)=>a+q[0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*q[1],0),sign=area>0?1:-1;
    const edges=p.map((a,i)=>({a,b:p[(i+1)%p.length],i})).sort((a,b)=>Math.hypot(b.b[0]-b.a[0],b.b[1]-b.a[1])-Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1])||a.i-b.i);
    let found:CarrierInstallSpec|undefined;
    for(const {a,b} of edges){if(found)break;yield 'edge';const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<7)continue;
      const tangent:V2=[dx/length,dz/length],normal:V2=[-tangent[1]*sign,tangent[0]*sign],mid:V2=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const home:V3=[round(mid[0]+normal[0]*2.2),surface.level,round(mid[1]+normal[1]*2.2)];
      const point=(inward:number,along=0):V3|null=>{const x=round(mid[0]+normal[0]*inward+tangent[0]*along),z=round(mid[1]+normal[1]*inward+tangent[1]*along),y=surface.bank(x,z);return y===null?null:[x,round(y),z];};
      const door=point(-.9),ea=point(-1.45,-.85),eb=point(-1.45,.85);if(!door||!ea||!eb)continue;
      for(const radius of [5,4,3,2]){
        const id=idOf(surface);
        const keys=Array.from({length:17},(_,i)=>{const angle=i/16*2*Math.PI,n=radius*(1-Math.cos(angle)),t=radius*.65*Math.sin(angle);return {t:i/16*150,p:[round(home[0]+normal[0]*n+tangent[0]*t),home[1],round(home[2]+normal[1]*n+tangent[1]*t)] as V3};});
        const spec:CarrierInstallSpec={id,def:'rowing-punt',label:surface.id==='eden-pond'?'Pond rowing punt':`${surface.id} rowing punt`,at:[home[0],home[2]],y:home[1],yaw:Math.atan2(-normal[1],-normal[0]),route:`${id}-loop`,routeKeys:keys,bank:{door,exits:{'rider-a':ea,'rider-b':eb}},waitSeconds:30};
        if(!(yield* previewInContextSteps(spec,context))){found=spec;break;}
      }
    }
    if(!found&&!rt.world.entities[idOf(surface)]){
      // memoised per water and static world (the navigation epoch): the host asks every minute
      yield 'sync';
      const sp=rt.services.spatial as Spatial;sp.sync(rt.world);synced();
      // sync may replace the deck-overlaid ground field. Preserve the original enumeration surface,
      // but validate prospective routes against the post-sync field, just as a fresh preview does.
      context=previewContext(rt,render);
      const key=`${surface.id}|${surface.level}|${sp.epoch}`;
      if(!memo.has(key)){if(memo.size>64)memo.clear();memo.set(key,(yield* shelfCandidateSteps(surface,context))??null);}
      const hit=memo.get(key);found=hit?structuredClone(hit):undefined;
    }
    if(found)out.push(found);
  }
  return out;
}


const idOf=(surface:Surface)=>surface.id==='eden-pond'?'eden-punt':`punt-${surface.id.replace(/[^a-z0-9._-]+/gi,'-').toLowerCase().slice(0,50)}-${hashOf(surface.id).slice(0,6)}`;

/** L1: a water whose long shore sides all have shallows wider than a plank (Eden 2026's commons pond: ~6 m of shelf) can
 * still board a punt where the hull floats within a short plank of dry bank — a jetty or deck over the water, a quay, a
 * steeper stretch of bank. Tried on a 0.5 m lattice (waters up to 200 × 200 m; not the sea): every home where the hull
 * floats, nearest the water's middle first, with its dry boarding point in any of 32 directions; the punt rule
 * (previewPunt) still decides. Prospective: only a water with no punt yet gets one. */
function* shelfCandidateSteps(surface:Surface,context:PreviewContext):Steps<CarrierInstallSpec|undefined>{
  const p=surface.polygon,xs=p.map(q=>q[0]),zs=p.map(q=>q[1]),x0=Math.min(...xs),z0=Math.min(...zs),x1=Math.max(...xs),z1=Math.max(...zs);
  if((x1-x0)*(z1-z0)>40000)return undefined;
  const S=0.5,nx=Math.ceil((x1-x0)/S)+1,nz=Math.ceil((z1-z0)/S)+1,cx=xs.reduce((a,b)=>a+b,0)/xs.length,cz=zs.reduce((a,b)=>a+b,0)/zs.length;
  function* disc(x:number,z:number):Steps<boolean>{
    if(surface.bank(x,z)===null)return false;
    for(let i=0;i<DISC_OFFSETS.length;i++){const d=DISC_OFFSETS[i],y=surface.bank(x+d[0],z+d[1]);yield 'bank';if(y===null)return false;}
    return true;
  };
  const homes:V3[]=[];
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const h:V3=[round(x0+i*S),surface.level,round(z0+j*S)];if(inPoly(h[0],h[2],p)&&(yield* hullWetSteps(surface,h)))homes.push(h);yield 'lattice';}
  // Native sorting remains one atomic unit; the diagnostic phase makes its maximum visible.
  yield 'sort';
  homes.sort((a,b)=>Math.hypot(a[0]-cx,a[2]-cz)-Math.hypot(b[0]-cx,b[2]-cz)||a[0]-b[0]||a[2]-b[2]);
  yield 'sort';
  const id=idOf(surface),label=surface.id==='eden-pond'?'Pond rowing punt':`${surface.id} rowing punt`;
  let tried=0;
  for(const home of homes)for(let k=0;k<32;k++){
    yield 'shelf';
    const a=k*Math.PI/16,d:V2=[Math.cos(a),Math.sin(a)],tangent:V2=[-d[1],d[0]],normal:V2=[-d[0],-d[1]];
    for(const r of [3.1,2.8,2.5,2.2]){
      const at=(out:number,along:number):V3|null=>{const x=round(home[0]+d[0]*out+tangent[0]*along),z=round(home[2]+d[1]*out+tangent[1]*along),y=surface.bank(x,z);return y===null?null:[x,round(y),z];};
      const door=at(r,0);if(!door||!(yield* disc(door[0],door[2])))continue;
      const ea=at(r+.55,-.85),eb=at(r+.55,.85);if(!ea||!eb)continue;
      for(const radius of [5,4,3,2]){
        const keys=Array.from({length:17},(_,i)=>{const angle=i/16*2*Math.PI,n=radius*(1-Math.cos(angle)),t=radius*.65*Math.sin(angle);return {t:i/16*150,p:[round(home[0]+normal[0]*n+tangent[0]*t),home[1],round(home[2]+normal[1]*n+tangent[1]*t)] as V3};});
        const spec:CarrierInstallSpec={id,def:'rowing-punt',label,at:[home[0],home[2]],y:home[1],yaw:Math.atan2(-normal[1],-normal[0]),route:`${id}-loop`,routeKeys:keys,bank:{door,exits:{'rider-a':ea,'rider-b':eb}},waitSeconds:30};
        if(!(yield* previewInContextSteps(spec,context)))return spec;
        if(++tried>400)return undefined;   // bounded: a water this shallow everywhere is an honest "no punt"
      }
      break;
    }
  }
  return undefined;
}
