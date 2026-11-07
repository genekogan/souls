// Soul Actions entry 18: gardens dry out. Each new world day, every thing with numeric `moisture` (a planter) loses a
// third, so a watered plant droops again after a few days unless someone waters it. One pass per world-day change (the
// bridge compares day numbers each tick); the commit is an ordinary engine edit, so viewers redraw the wilting.
// Entry 34: a planter with `growth` (planter@2) grows in the same pass: one stage per day change it starts moist enough
// (at least DRY_BELOW), capped at the last stage; a dry one stalls and its `thirst` (dry days in a row, capped) rises,
// so it wilts further, but it never dies. Nothing about plants is computed on any other tick.
import { opSchema, GROWTH_STAGES, type Op, type WorldModel } from '@souls/world-compiler';
export const DRY_PER_DAY = 1 / 3, DRY_BELOW = 0.34, MAX_THIRST = 3, LAST_STAGE = GROWTH_STAGES.length - 1;
/** Test-visible: planters visited by the daily pass (it is 0 on every tick without a day change). */
export const gardenStats = { planterVisits: 0, passes: 0 };
type F = { type?: string; default?: unknown };
/** One world day for a growing planter: grow (moist) or stall and thirst (dry), then dry by a third. */
export function growDay(st: { moisture: number; growth: number; thirst: number }) {
  const moist = st.moisture >= DRY_BELOW;
  const growth = moist ? Math.min(LAST_STAGE, Math.round(st.growth) + 1) : Math.round(st.growth);
  const thirst = moist ? 0 : Math.min(MAX_THIRST, Math.round(st.thirst) + 1);
  const next = Math.round((st.moisture - DRY_PER_DAY) * 1000) / 1000;
  return { moisture: next < 0.02 ? 0 : next, growth, thirst };
}
/** The ops that dry every moist thing by `days` world days (none when nothing is moist). */
export function dryingOps(model: WorldModel, days: number): Op[] {
  if (!(days > 0)) return [];
  const ops: Op[] = [];
  gardenStats.passes++;
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), st = def?.state as Record<string, F> | undefined, f = st?.moisture;
    if (f?.type !== 'number') continue;
    gardenStats.planterVisits++;
    const now = typeof e.state?.moisture === 'number' ? e.state.moisture : Number(f.default ?? 0);
    if (st?.growth?.type === 'number') {
      const val = (k: string) => (typeof e.state?.[k] === 'number' ? e.state[k] as number : Number(st[k]?.default ?? 0));
      let g = { moisture: now, growth: val('growth'), thirst: val('thirst') };
      for (let d = 0; d < days; d++) g = growDay(g);
      if (g.moisture !== now || g.growth !== val('growth') || g.thirst !== val('thirst')) ops.push(opSchema.parse({ op: 'set', id: e.id, state: g }));
      continue;
    }
    if (now <= 0) continue;
    { const next = Math.round((now - DRY_PER_DAY * days) * 1000) / 1000; ops.push(opSchema.parse({ op: "set", id: e.id, state: { moisture: next < 0.02 ? 0 : next } })); }
  }
  return ops;
}
/** Is this thing dry enough that a Soul standing by it would notice (`dry` fact)? */
export const isDry = (moisture: unknown) => typeof moisture === 'number' && moisture < DRY_BELOW;
/** Entry 34: the word for a growing planter's stage (null for planters without growth). */
export const stageWord = (growth: unknown) => (typeof growth === 'number' ? GROWTH_STAGES[Math.max(0, Math.min(LAST_STAGE, Math.round(growth)))] : null);
