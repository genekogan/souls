// PC11 (#690): a loose material's handling (components.carryable.handling) checked as a whole, so a def no crew could
// carry is refused when it is defined, not discovered when a crew tries. The schema checks each field; this checks how
// they fit together: the crew range, a grip layout of the right size for every crew in it, the mass the largest crew
// can lift, and grips a carrier can reach (on the load's own box). Named codes; the first problem only.
/** The native carry's limit per carrier (mars/viewer/engine/carry/formation.ts MAX_KG_PER_CARRIER; a test pins them equal). */
export const MAX_KG_PER_CARRIER = 30;
/** How far outside the box a grip may lie (m): the box is exact, a grip on its edge is on the load. */
const REACH_SLACK = 0.05;

type Handling = {crew: [number, number]; grips: Record<string, number[][]>};
type DefLike = {size?: {box?: number[]}; components?: {carryable?: {mass?: number; handling?: Handling}}};

export function handlingProblem(def: DefLike): {code: string; field: string; message: string; fix: string} | null {
  const p = handlingProblemOf(def);
  return p && {...p, fix: FIX[p.code]};
}
const FIX: Record<string, string> = {
  'handling.crew': 'Give the crew range as [fewest, most] carriers.',
  'handling.grips': 'Give every crew size in the range, and no other, a grip layout with that many grips.',
  'handling.mass': 'Lower the mass or allow a larger crew (30 kg per carrier), with a grip layout for it.',
  'handling.reach': 'Move the grip onto the load\'s own box (x along its length, y up from its base, z across).',
};
function handlingProblemOf(def: DefLike): {code: string; field: string; message: string} | null {
  const c = def.components?.carryable, h = c?.handling;
  if (!h) return null;
  const [lo, hi] = h.crew, field = 'components.carryable.handling';
  if (lo > hi) return {code: 'handling.crew', field: `${field}.crew`, message: `the crew range [${lo}, ${hi}] is inverted`};
  for (const [n, gs] of Object.entries(h.grips)) {
    const k = Number(n);
    if (k < lo || k > hi) return {code: 'handling.grips', field: `${field}.grips.${n}`, message: `a grip layout for a crew of ${k} is outside the crew range [${lo}, ${hi}]`};
    if (gs.length !== k) return {code: 'handling.grips', field: `${field}.grips.${n}`, message: `the grip layout for a crew of ${k} has ${gs.length} grip${gs.length === 1 ? '' : 's'}`};
  }
  for (let k = lo; k <= hi; k++) if (!h.grips[String(k)]) return {code: 'handling.grips', field: `${field}.grips`, message: `no grip layout for a crew of ${k}, which the crew range [${lo}, ${hi}] allows`};
  const mass = c?.mass ?? 0;
  if (mass > hi * MAX_KG_PER_CARRIER) return {code: 'handling.mass', field: 'components.carryable.mass', message: `${mass} kg needs ${Math.ceil(mass / MAX_KG_PER_CARRIER)} carriers at ${MAX_KG_PER_CARRIER} kg each, but the crew range allows at most ${hi}`};
  const box = def.size?.box;
  if (box) {
    const [L, H, W] = box;
    for (const [n, gs] of Object.entries(h.grips)) for (const [i, g] of gs.entries()) {
      const [x, y, z] = g;
      if (Math.abs(x) > L / 2 + REACH_SLACK || Math.abs(z) > W / 2 + REACH_SLACK || y < -REACH_SLACK || y > H + REACH_SLACK)
        return {code: 'handling.reach', field: `${field}.grips.${n}`, message: `grip ${i + 1} of the crew-of-${n} layout (${g.join(', ')}) is outside the load (${L} × ${H} × ${W} m), where no carrier can hold it`};
    }
  }
  return null;
}
