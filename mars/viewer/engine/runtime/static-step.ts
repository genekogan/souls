// One rule for a step an action owns (a reach's lean, a stroke's step to the board), the walker's hard static layer
// (locomotion/walk.ts): the invariant reads the rasterized clearance (runtime/invariants.ts humanStaticClearance), which near a
// turned footprint can read lower than the exact distance. A step that would trip it on this tick's end is not taken. It syncs
// nothing of its own, so it adds no scan and cannot change what a later reader sees.
import {isFloater,floaterBody} from '../bodies/body.ts';
import {humanRadius} from '../bodies/humanoid.ts';
import {HUMAN_RADIUS} from '../world/catalog.ts';
import {clearanceAt,clearanceFromObb} from '../spatial/grid.ts';
import {G_SWIM} from '../spatial/ground.ts';
import type {Spatial} from '../spatial/service.ts';
import type {Entity} from '../world/types.ts';
import {dcos,dsin,type OBB2,type Vec2} from '../core/math.ts';
import type {Runtime} from './runtime.ts';

const STATIC_TOL=0.03; // m: the static-clearance invariant's tolerance (runtime/invariants.ts)
/** May this body's action step it to `to`? False only when `to` is below the invariant's limit and worse than where it stands. */
export function staticStepClear(rt:Runtime,a:Entity,to:Vec2):boolean{
 const sp=rt.services.spatial as Spatial|undefined;if(!sp||!a.human||a.human.on||a.human.carrier)return true;
 // the ground worlds' invariant (packages/engine-mars ground-bridge.ts) does not ask this of a body in deep water
 if((a.human.level??0)===0&&sp.ground?.field?.medium(to[0],to[1])===G_SWIM)return true;
 const g=sp.levelAt(a.human.level,to);if(!g)return true;
 const c=clearanceAt(g,to),radius=isFloater(a)?floaterBody(a.body).radius:humanRadius(a);
 return !(c<radius-STATIC_TOL&&c<clearanceAt(g,[a.pose.p[0],a.pose.p[2]])-1e-9);
}
/** Below this a world edit (a door shutting is one) relocates a body: a little above the invariant's limit. */
export const EDIT_CLEAR=HUMAN_RADIUS*.9;
const SETTLE_STEP=.02,SETTLE_MAX=.18; // m
/** #1070: `solids` aren't standing yet, and this body will be at `to` when they do (a door's gap turns solid at the close's
 *  contact). Undefined when it will be clear of them there, so nothing changes; else the smallest shift of `to` that clears
 *  them and everything already standing, or null when there is none. */
export function settleBeside(rt:Runtime,a:Entity,to:Vec2,solids:readonly OBB2[]):Vec2|null|undefined{
 const sp=rt.services.spatial as Spatial|undefined;if(!sp||!a.human||a.human.on||a.human.carrier)return undefined;
 sp.sync(rt.world);const g=sp.levelAt(a.human.level,to);if(!g)return undefined;
 const limit=Math.max(EDIT_CLEAR,(isFloater(a)?floaterBody(a.body).radius:humanRadius(a))-STATIC_TOL),clearOf=(p:Vec2)=>solids.every(o=>clearanceFromObb(g,o,p)>=limit);
 if(clearOf(to))return undefined;
 for(let k=1;k*SETTLE_STEP<=SETTLE_MAX+1e-9;k++)for(let i=0;i<8;i++){const dx=k*SETTLE_STEP*dcos(i*Math.PI/4),dz=k*SETTLE_STEP*dsin(i*Math.PI/4),p:Vec2=[to[0]+dx,to[1]+dz];
  if(clearOf(p)&&clearanceAt(g,p)>=limit)return [dx,dz];}
 return null;
}
