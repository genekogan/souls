import { CREATION_LIMITS as L } from '@souls/generators';
import type { WorldModel } from './model.ts';
import type { Failure } from './schemas.ts';
import type { Diff } from './compile.ts';

const totals = new WeakMap<object, number>();
function entityTris(w: WorldModel, id: string): number {
  const e = w.entities.get(id), d = e && w.resolvedDef(e.def);
  return e && d ? w.bake(d, e.params ?? {}, e.seed ?? 0, e.shape).tris : 0;
}
/** One cold scan per model state (boot/import); subsequent plans update only the diff. */
export function worldTris(w: WorldModel): number {
  const key = w.safetyCacheKey(), hit = totals.get(key); if (hit !== undefined) return hit;
  let n = 0; for (const id of w.entities.keys()) n += entityTris(w, id);
  totals.set(key, n); return n;
}

export function worldBudgetFailure(before: WorldModel, after: WorldModel, diff: Pick<Diff, 'upserts' | 'removes'>, op: number): Failure | null {
  const fail = (field: string, measured: number, limit: number, code = 'budget.world'): Failure => ({ op, code, field, measured, limit,
    detail: `${field}: ${measured} > ${limit}`, fix: code === 'budget.region' ? `Spread solid construction across ${L.regionSizeM} m cells or remove some solids.` : `Reduce ${field} before adding more construction; use existing definitions where possible.` });
  const entities = Math.min(L.worldEntities, after.constants.limits.entities);
  if (after.entities.size > entities && after.entities.size > before.entities.size) return fail('entities', after.entities.size, entities);
  const defs = after.retainedDefCount();
  if (defs > L.worldDefs && defs > before.retainedDefCount()) return fail('defs', defs, L.worldDefs);
  const changed = new Set([...diff.upserts.map(e => e.id), ...diff.removes]);
  const previous = worldTris(before);
  let tris = previous;
  for (const id of changed) tris += entityTris(after, id) - entityTris(before, id);
  totals.set(after.safetyCacheKey(), tris);
  if (tris > L.worldTris && tris > previous) return fail('tris', tris, L.worldTris);
  const cells = new Set([...before.solidRegionsOf(changed), ...after.solidRegionsOf(changed)]);
  for (const cell of cells) {
    const count = after.solidRegionCount(cell);
    if (count > L.regionSolidEntities && count > before.solidRegionCount(cell)) return fail(`regions.${cell}.solidEntities`, count, L.regionSolidEntities, 'budget.region');
  }
  return null;
}
