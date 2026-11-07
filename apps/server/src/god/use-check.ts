// Lane BS1 (BUILDSAFE item 5, 2026-10-21): can a body actually use what a god placed? Every seat is sat on and every berth
// lain on exactly as the sit plan does it (engine useCheckV1: standing approach, the sit/stand slide, joined to the main
// ground both ways, and the seat height for the standard body), and each unusable slot gets one line a god can act on.
// Callers: BS2's commit check (the entities a commit placed or moved) and BS3's fuzz fixture; seatTopsOf also feeds the
// edge sit capability's seat.too-high block (engine-bridge.ts). The walk audit does not call it
// (its V3-walk baseline counts only navTargetsV1).
import type { WorldModel } from '@souls/world-compiler';
import type { UseCheckV1 } from '@souls/engine-mars';

export type UseVerdict = UseCheckV1 & {
  /** One god-readable line, unusable slots only: what cannot be used, why, and where. */
  line?: string;
};
type UseEngine = { useCheckV1(opts?: { of?: string[]; keep?: (at: [number, number]) => boolean; seatTop?: (slot: { id: string; of: string }) => number | undefined }): UseCheckV1[] };

const WHY: Record<string, string> = {
  'use.no-approach': 'there is no room to stand beside it',
  'use.transition-blocked': 'getting on and off it would pass through something solid',
  'use.seat-out-of-reach': 'its seat is above the standing reach a body needs to get onto it',
  'nav.disconnected': 'where a body stands to use it is cut off from the rest of the world',
  'nav.one-way': 'where a body stands to use it can be reached one way only',
  'nav.no-standing-room': 'where a body stands to use it has no room to stand',
};

/** SEATDEF (2026-10-22): the measured seat height (m above where a sitter's feet rest) of each core def whose earlier
 *  revisions stored something else there: the Mars bus seats' and papasan's box top (1.22 / 1.36 m; the seat surface is
 *  0.51 / 0.70 m on the model), a vehicle seat's height above the ground instead of above its cab floor, a bleacher bench's
 *  height above the ground instead of above its own footboard. Worlds keep the revisions they placed (stored by hash, never
 *  rewritten), so these apply to every revision of the def; the current library revisions carry exactly these values
 *  (use-check.test). Measured with team/scratch/t4/seatdef/probe/{glbtop.mjs,kitfloor.ts}. Floor seats (Mars cushions
 *  0.09, tiers 0.18, mattresses 0.14) store their true tops and are not listed. */
export const SEAT_HEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'core-mars-bus-seat': 0.51, 'core-mars-bus-seat-2': 0.51, 'core-mars-bus-seat-3': 0.51, 'core-mars-bus-seat-4': 0.51, 'core-mars-papasan': 0.7,
  'core-tractor': 0.2, 'core-truck': 0.8, 'core-fire-engine': 0.7, 'core-excavator': 0.3, 'core-crane': 0.2, 'core-bleachers': 0.28,
});

/** The seat heights of a placed entity, by slot id: how high each seat is above where a sitter's feet rest (the slot's
 *  `height`, else its baked top p[1]; SEAT_HEIGHTS for the defs listed there), stretched with the def and at the
 *  entity's scale. Engine seat slots carry no height (the catalog adapter keeps only their footprint), so this is where a
 *  seat's height is read: by the use-check and by the edge sit capability (seat.too-high). Empty when unknown. */
export function seatTopsOf(model: WorldModel, of: string): Map<string, number> {
  const m = new Map<string, number>(), e = model.entities.get(of), def = e && model.resolvedDef(e.def);
  if (e && def) {
    const s = model.worldPose(e).s, fixed = SEAT_HEIGHTS[def.name];
    for (const slot of model.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).slots) {
      if (slot.kind !== 'seat') continue;
      if (fixed === undefined) { m.set(slot.id, (slot.height ?? slot.p[1]) * s); continue; }
      // the def's stretch (sy) scales the baked slot: carry it to the measured height
      const own = def.slots.find((x) => x.id === slot.id), k = own && own.p[1] > 0 ? slot.p[1] / own.p[1] : 1;
      m.set(slot.id, fixed * k * s);
    }
  }
  return m;
}

/** Every seat and berth of `ids` (all fixtures when omitted). With the world `model`, seat heights are checked (the def's
 *  baked seat top at the entity's scale) and lines name things by their path. Pure read. */
export function useCheck(engine: UseEngine, ids?: readonly string[], model?: WorldModel): UseVerdict[] {
  const tops = new Map<string, Map<string, number>>();
  const seatTop = model ? ({ id, of }: { id: string; of: string }) => {
    let m = tops.get(of);
    if (!m) { m = seatTopsOf(model, of); tops.set(of, m); }
    return m.get(id.slice(id.indexOf('#') + 1));
  } : undefined;
  const name = (of: string) => (model?.entities.has(of) ? model.pathOf(of) : of);
  return engine.useCheckV1({ ...(ids ? { of: [...ids] } : {}), ...(seatTop ? { seatTop } : {}) }).map((v) => {
    if (v.ok) return v;
    const slot = v.id.slice(v.id.indexOf('#') + 1), at = v.at ? ` (at ${v.at[0].toFixed(1)}, ${v.at[1].toFixed(1)})` : '';
    // what is in the way, by path: the engine names obstacles by entity id (`e_…` or `e_…#c0`)
    const inWay = [...new Set([...(v.message ?? '').matchAll(/\b(e_[0-9a-f]{6,})(?:#[\w-]+)?/g)].map((m) => m[1]).filter((e) => e !== v.of))].map(name);
    return { ...v, line: `${name(v.of)} ${slot}: cannot be ${v.kind === 'berth' ? 'lain on' : 'sat on'}: ${WHY[v.code ?? ''] ?? v.code}${at}${inWay.length ? `; in the way: ${inWay.join(', ')}` : ''}.` };
  });
}
