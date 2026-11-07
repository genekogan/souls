import { footprintOf, heightAt } from '@souls/ground';
import { onAbsoluteDeck, type Entity, type WorldModel } from '@souls/world-compiler';

/** Preserve the audit's terrain-gap metric, except for real full-footprint deck
 * support proven by the same predicate used during physical admission. */
export function unsupportedRootGap(model: WorldModel, entity: Entity): number {
  const pose=model.worldPose(entity),gap=pose.y-heightAt(model.ground(),pose.x,pose.z);
  if(gap<=0||entity.in.parent!=='world') return gap;
  const def=model.resolvedDef(entity.def); if(!def) return gap;
  const baked=model.bake(def,entity.params??{},entity.seed??0,entity.shape);
  const fp=footprintOf(pose.x,pose.z,baked.box[0]*pose.s/2,baked.box[2]*pose.s/2,pose.yaw);
  return onAbsoluteDeck(model,entity,fp,pose.y)?0:gap;
}
