import { footprintOf, heightAt, padFlatDist, pointInPoly, settle, type Landform } from '@souls/ground';
import type { WorldModel } from './model.ts';

type Pad = Extract<Landform, { kind: 'pad' }>;
/** How far off its level a flat may lie (or a pad-less base off its lowest corner) before it is re-settled. */
export const RESETTLE_TOL_M = 0.05;
/** Pre-filter before baking a thing: no footprint is wider than this from its centre. */
const REACH_SLACK_M = 40;

/**
 * PADFIX (2026-10-21): the standing things whose foundation must be re-cut in place under pad/2b ("flats win") so every
 * building's flat is back at its own level. pad/2 folds banks one after another, so where two buildings stand closer than
 * a bank's reach (up to 16 m) the later bank re-cut the ground under the other's flat; and a re-cut that found a
 * neighbour's bank within the skirt under a building dropped its pad. Returned: (a) every older (non-2b) pad whose flat
 * (area or door landing) is off its level, (b) every pad-less base-anchored thing within a graded bank's reach that lost
 * its pad in an earlier re-cut (`hadPad`: the ids that re-cut moved) or whose lowest corner is off its pose, and, by closure, every older pad whose bank or flat reaches one of those (a whole
 * hillside cluster folds together, so no pad/2 bank is left cutting a pad/2b flat). pad/2b pads are never returned, so a
 * world re-settled once returns nothing (idempotent).
 */
export function padResettle(w: WorldModel, hadPad: ReadonlySet<string> = new Set()): string[] {
  const g = w.ground();
  const standing = (l: Landform): l is Pad => l.kind === 'pad' && l.id.endsWith(':pad') && w.entities.has(l.id.slice(0, -4));
  const pads = g.landforms.filter(standing);
  const old = pads.filter((l) => l.fold !== 'flats');
  if (!old.some((l) => l.grade !== undefined)) return [];
  const polys = (l: Pad) => [l.area, ...(l.aprons ?? [])];
  const offFlat = (l: Pad) => {
    const b = polys(l).flat().reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    for (let x = b[0] + 0.25; x < b[2]; x += 0.5) for (let z = b[1] + 0.25; z < b[3]; z += 0.5) {
      if (!polys(l).some((q) => pointInPoly(x, z, q))) continue;
      if (Math.abs(heightAt(g, x, z) - l.level) > RESETTLE_TOL_M) return true;
    }
    return false;
  };
  // distance between two pads' flats (vertex to flat, both ways; 0 when they overlap)
  const gap = (a: Pad, b: Pad) => Math.min(...polys(a).flat().map(([x, z]) => padFlatDist(x, z, b)), ...polys(b).flat().map(([x, z]) => padFlatDist(x, z, a)));
  const reaches = (a: Pad, b: Pad) => gap(a, b) < Math.max(a.grade !== undefined ? a.edge : 1.5, b.grade !== undefined ? b.edge : 1.5);
  const seeds = new Set<Pad>(old.filter(offFlat));
  const things: string[] = [];
  for (const e of w.entities.values()) {
    if (e.in.parent !== 'world' || !Array.isArray(e.p) || e.p.length !== 3 || g.landforms.some((l) => l.id === `${e.id}:pad`)) continue;
    const def = w.resolvedDef(e.def); if (!def || def.layer === 'volume' || def.form !== 'point' || (e.anchor ?? def.anchor) !== 'base' || (def.components.foundation?.kind ?? 'pad') !== 'pad') continue;
    if (e.constraints?.some((c) => c.kind === 'float')) continue;
    const [px, py, pz] = e.p as [number, number, number];
    if (!old.some((l) => l.grade !== undefined && padFlatDist(px, pz, l) < l.edge + REACH_SLACK_M)) continue;
    let baked; try { baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape); } catch { continue; }
    if (baked.landform) continue;
    const s = e.s ?? 1, yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
    const half = Math.hypot(baked.box[0] * s, baked.box[2] * s) / 2;
    const near = old.filter((l) => l.grade !== undefined && padFlatDist(px, pz, l) < l.edge + half);
    if (!near.length) continue;
    const st = settle(w.terrain, footprintOf(px, pz, (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw), 'base');
    if (!hadPad.has(e.id) && Math.abs(st.y - py) <= RESETTLE_TOL_M) continue;
    if (hadPad.has(e.id) && st.gap <= RESETTLE_TOL_M && Math.abs(st.y - py) <= RESETTLE_TOL_M) continue;
    things.push(e.id); for (const l of near) seeds.add(l);
  }
  if (!seeds.size && !things.length) return [];
  const cluster = new Set<Pad>(seeds), todo = [...seeds];
  while (todo.length) { const a = todo.pop()!; for (const b of old) if (!cluster.has(b) && reaches(a, b)) { cluster.add(b); todo.push(b); } }
  return [...[...cluster].map((l) => l.id.slice(0, -4)), ...things];
}
