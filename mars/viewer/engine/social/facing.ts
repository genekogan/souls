// One authoritative in-place turn, shared by native face and prospective pose policies.
import {angleDelta,clamp,wrapAngle} from '../core/math.ts';
import {HUMAN_PROFILE} from '../spatial/types.ts';
import type {Entity} from '../world/types.ts';

export const FACING_TOLERANCE = .03;
export const turnToward = (yaw:number,want:number,max:number) => wrapAngle(yaw+clamp(angleDelta(yaw,want),-max,max));
/** A completion check precedes the turn, preserving face's existing tick semantics. */
export function stepFacing(actor:Pick<Entity,'pose'>,want:number,dt:number):boolean{
  if(Math.abs(angleDelta(actor.pose.yaw,want))<=FACING_TOLERANCE)return true;
  actor.pose.yaw=turnToward(actor.pose.yaw,want,HUMAN_PROFILE.turnRate*dt);
  return false;
}
