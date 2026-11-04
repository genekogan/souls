// Opted-in planter biology is evaluated on world-hour anchors. Materialisation is a daily engine commit;
// enabled ids are indexed at commits, with no unflagged biological tick work. Native contacts share this policy.
import { opSchema, GROWTH_STAGES, biologyEnabled, biologyOf, anchorBiology, type Diff, type Op, type WorldModel } from '@sim/world-compiler';
export const DRY_PER_DAY = 1 / 3, DRY_BELOW = 0.34, MAX_THIRST = 3, LAST_STAGE = GROWTH_STAGES.length - 1;
/** Test-visible: planters visited by the daily pass (it is 0 on every tick without a day change). */
export const gardenStats = { planterVisits: 0, passes: 0 };
/** Derived state joins the owner's original SQL commit/diff, including after restart. No nested engine commit. */
export function gardenPolicyOps(before: WorldModel, after: WorldModel, diff: Diff, hour: number, restoring = false): Op[] {
  return diff.upserts.flatMap(e => {
    const previous = before.entities.get(e.id), def = after.resolvedDef(e.def);
    if (!previous || !def?.state.biologyEnabled) return [];
    const was = biologyEnabled(previous.state, before.resolvedDef(previous.def)!), enabled = biologyEnabled(e.state, def);
    if (was === enabled) return [];
    const state = restoring ? previous.state : e.state;
    const anchor = was ? anchorBiology({ ...state, biologyEnabled: true }, def, hour)
      : Number(state?.biologyHour ?? -1) >= 0 ? { ...biologyOf({ ...state, biologyEnabled: true }, def)!, biologyHour: hour }
        : anchorBiology({ ...state, biologyEnabled: enabled }, def, hour);
    return anchor ? [opSchema.parse({ op: 'set', id: e.id, state: { ...anchor, biologyEnabled: enabled,
      moisture: anchor.biologyMoisture, growth: anchor.biologyGrowth, thirst: anchor.biologyWilt * 3, ...(!enabled && def.state.pouring ? { pouring: false } : {}) } })] : [];
  });
}
/** One world day for a growing planter: grow (moist) or stall and thirst (dry), then dry by a third. */
export function growDay(st: { moisture: number; growth: number; thirst: number }) {
  const moist = st.moisture >= DRY_BELOW;
  const growth = moist ? Math.min(LAST_STAGE, Math.round(st.growth) + 1) : Math.round(st.growth);
  const thirst = moist ? 0 : Math.min(MAX_THIRST, Math.round(st.thirst) + 1);
  const next = Math.round((st.moisture - DRY_PER_DAY) * 1000) / 1000;
  return { moisture: next < 0.02 ? 0 : next, growth, thirst };
}
/** Enabled ids are rebuilt only after a commit. Idle unflagged worlds do no biological entity work. */
const indexes = new WeakMap<WorldModel, { seq: number; ids: string[] }>();
export function enabledPlanters(model: WorldModel) {
  const previous = indexes.get(model); if (previous?.seq === model.editSeq) return previous.ids;
  const ids = [...model.entities.values()].filter(e => { const def = model.resolvedDef(e.def); return def && biologyEnabled(e.state, def); }).map(e => e.id);
  indexes.set(model, { seq: model.editSeq, ids }); return ids;
}
/** Materialise only opted-in curves; watering recovery is never overwritten by a daily pass. */
export function dryingOps(model: WorldModel, days: number, hour?: number): Op[] {
  if (!(days > 0)) return [];
  const ops: Op[] = []; gardenStats.passes++;
  for (const id of enabledPlanters(model)) {
    const e = model.entities.get(id)!, def = model.resolvedDef(e.def)!; gardenStats.planterVisits++;
    const at = anchorBiology(e.state, def, hour ?? Math.max(0, Number(e.state?.biologyHour ?? 0)) + days * 24)!;
    ops.push(opSchema.parse({ op: 'set', id, state: { ...at, moisture: at.biologyMoisture, growth: at.biologyGrowth, thirst: at.biologyWilt * 3 } }));
  }
  return ops;
}
/** Is this thing dry enough that a Soul standing by it would notice (`dry` fact)? */
export const isDry = (moisture: unknown) => typeof moisture === 'number' && moisture < DRY_BELOW;
/** Entry 34: the word for a growing planter's stage (null for planters without growth). */
export const stageWord = (growth: unknown) => (typeof growth === 'number' ? GROWTH_STAGES[Math.max(0, Math.min(LAST_STAGE, Math.round(growth)))] : null);
