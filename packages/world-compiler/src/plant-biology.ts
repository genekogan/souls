/** Admitted planter biology, shared by authoritative contacts and recorded rendering.
 * Anchors use world hours, never presentation time or the current day length times an old tick. */
export type PlantBiology = {
  biologyEnabled: boolean; biologyHour: number; biologyWilt: number;
  biologyTarget: number; biologyMoisture: number; biologyGrowth: number;
};
type State = Record<string, unknown> | undefined;
type Def = { state?: Record<string, { default?: unknown }> };
const n = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const unit = (v: number) => Math.max(0, Math.min(1, v));
export const BIOLOGY_HOURS = 72;
export const biologyEnabled = (state: State, def: Def) =>
  !!def.state?.biologyEnabled && (state?.biologyEnabled ?? def.state.biologyEnabled.default) === true;
export function biologyOf(state: State, def: Def): PlantBiology | null {
  if (!biologyEnabled(state, def)) return null;
  const value = (key: string, fallback: number) => n(state?.[key], n(def.state?.[key]?.default, fallback));
  return { biologyEnabled: true, biologyHour: value('biologyHour', -1), biologyWilt: value('biologyWilt', 0),
    biologyTarget: value('biologyTarget', 1), biologyMoisture: value('biologyMoisture', .1), biologyGrowth: value('biologyGrowth', 0) };
}
/** Previously active planters retain a frozen recorded picture while disabled. */
export function biologyRecordOf(state:State,def:Def):PlantBiology|null {
  const active=biologyOf(state,def);if(active)return active;
  if(!def.state?.biologyEnabled||n(state?.biologyHour,-1)<0)return null;
  const frozen=biologyOf({...state,biologyEnabled:true},def)!;
  return {...frozen,biologyEnabled:false};
}
export function biologyAt(anchor: PlantBiology, hour: number) {
  const elapsed = Math.max(0, hour - anchor.biologyHour);
  const recovery = Math.max(0, anchor.biologyWilt - anchor.biologyTarget) * BIOLOGY_HOURS;
  const drying = Math.max(0, elapsed - recovery);
  const w = elapsed < recovery ? anchor.biologyWilt - elapsed / BIOLOGY_HOURS : Math.min(1, Math.min(anchor.biologyWilt, anchor.biologyTarget) + drying / BIOLOGY_HOURS);
  const m = unit(anchor.biologyMoisture - drying / BIOLOGY_HOURS);
  const growingHours = anchor.biologyMoisture >= .34 ? recovery + (anchor.biologyMoisture - .34) * BIOLOGY_HOURS : 0;
  return { w: unit(w), m, g: Math.min(4, anchor.biologyGrowth + Math.min(elapsed, growingHours) / 24),
    target: elapsed < recovery ? anchor.biologyTarget : 1 };
}
/** Initialise at activation, or materialise an existing curve without losing pending recovery. */
export function anchorBiology(state: State, def: Def, hour: number): PlantBiology | null {
  const previous = biologyOf(state, def); if (!previous) return null;
  if (previous.biologyHour < 0) {
    const m = n(state?.moisture, n(def.state?.moisture?.default, .1)), thirst = n(state?.thirst, 0);
    return { ...previous, biologyHour: hour, biologyWilt: m >= .34 ? 0 : .35 + .65 * unit(thirst / 3),
      biologyMoisture: m, biologyGrowth: n(state?.growth, 0), biologyTarget: 1 };
  }
  const at = biologyAt(previous, hour);
  // Only edits earlier than the anchor hold it; edits within its curve reevaluate intermediate progress.
  return { ...previous, biologyHour: Math.max(hour, previous.biologyHour), biologyWilt: at.w,
    biologyTarget: at.target, biologyMoisture: at.m, biologyGrowth: at.g };
}
/** A soil dose is a fraction of capacity. Saturation forgives all remaining wilt debt. */
export function waterBiology(state: State, def: Def, hour: number, dose: number) {
  const anchor = anchorBiology(state, def, hour); if (!anchor) return null;
  const added = Math.max(0, dose), moisture = unit(anchor.biologyMoisture + added);
  const pending = Math.min(anchor.biologyWilt, anchor.biologyTarget);
  const target = moisture >= 1 - 1e-9 ? 0 : Math.max(0, pending - added);
  return { ...anchor, biologyMoisture: moisture, biologyTarget: target,
    moisture, growth: anchor.biologyGrowth, thirst: anchor.biologyWilt * 3 };
}
/** The paused sentinel's origin stores the frozen hour; ignore its negligible tick drift. */
export function biologyHourAt(tick: number, clock: { origin: number; dayTicks: number; pausedAtTick?: number }) {
  return Math.max(0, ((clock.dayTicks >= 2 ** 40 ? clock.pausedAtTick ?? tick : tick) - clock.origin) / clock.dayTicks) * 24;
}
