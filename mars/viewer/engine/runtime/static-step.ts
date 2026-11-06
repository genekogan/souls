// One rule for a step an action owns (a reach's lean, a stroke's step to the board), the walker's hard static layer
// (locomotion/walk.ts): the invariant reads the rasterized clearance (runtime/invariants.ts humanStaticClearance), which near a
// turned footprint can read lower than the exact distance. A step that would trip it on this tick's end is not taken. It reads
// the grid as the last tick's end left it and syncs nothing, so it adds no scan and cannot change what a later reader sees.
import {isFloater,floaterBody} from '../bodies/body.ts';
import {humanRadius} from '../bodies/humanoid.ts';
import {clearanceAt} from '../spatial/grid.ts';
import type {Spatial} from '../spatial/service.ts';
import type {Entity} from '../world/types.ts';
import type {Vec2} from '../core/math.ts';
import type {Runtime} from './runtime.ts';

const STATIC_TOL=0.03; // m: the static-clearance invariant's tolerance (runtime/invariants.ts)
/** May this body's action step it to `to`? False only when `to` is below the invariant's limit and worse than where it stands. */
export function staticStepClear(rt:Runtime,a:Entity,to:Vec2):boolean{
 const sp=rt.services.spatial as Spatial|undefined;if(!sp||!a.human||a.human.on||a.human.carrier)return true;
 const g=sp.levelAt(a.human.level,to);if(!g)return true;
 const c=clearanceAt(g,to),radius=isFloater(a)?floaterBody(a.body).radius:humanRadius(a);
 return !(c<radius-STATIC_TOL&&c<clearanceAt(g,[a.pose.p[0],a.pose.p[2]])-1e-9);
}
