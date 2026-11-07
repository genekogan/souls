// Doors and gates in the walk graph (harvest fix "doorblock", 2026-10-18).
//
// A def with the `opening` component (core/door@1, core/gate@1, a god's own door or gate) is a door: shut, it blocks
// the gap it stands in; open, it lets walkers through. A def that bakes its own doorway (a footprint portal, a
// building's door) is blocked across that doorway; one that bakes none (a free-standing kit door in its frame) is
// blocked across its own width at its own spot. A wall or fence gate (`gates` param) with a door standing in it yields
// to that door: the door, not the wall's built-in gate, decides whether the gap passes. A bare gate (no door in it) is
// an open gap unless its params say `state: 'closed'` (SEALED 2026-10-21; packages/generators paths.ts gateOpenings).
import type { Entity, StoredDef } from '@souls/world-compiler';

type Vec2 = [number, number];
type Opening = { id: string; kind: 'door' | 'window' | 'gate' | 'arch'; at: Vec2; yaw: number; width: number; height: number; sill?: number; level: number; state?: 'open' | 'closed' | 'always' };

/** A door entity is shut: its `open` state, else the def's default for it, is false. */
export function isShut(e: Entity, def: StoredDef): boolean {
  if (!def.components.opening) return false;
  const v = e.state?.open ?? (def.state as Record<string, { default?: unknown } | undefined>)?.open?.default;
  return v === false;
}

/** Is this def a passable door or gate (not a window or a serving hatch, which carry `opening` too)? */
export function isDoorDef(def: StoredDef): boolean {
  if (!def.components.opening || def.form !== 'point') return false;
  return !/window|hatch/.test(def.name) && !def.tags.some((t) => t === 'window' || t === 'hatch');
}

/** The opening a free-standing door blocks when it bakes no doorway of its own: its own width (the frame's, when
 *  wider than the leaf) across its origin, facing its front. Null when the def bakes a door or gate opening already. */
export function freeDoorOpening(def: StoredDef, baked: { box: number[]; openings?: Opening[] }): Opening | null {
  if (!isDoorDef(def)) return null;
  if ((baked.openings ?? []).some((o) => o.kind === 'door' || o.kind === 'gate')) return null;
  const op = def.components.opening!;
  return { id: 'opening', kind: 'door', at: [0, 0], yaw: 0, width: Math.max(op.width, baked.box[0] ?? 0), height: Math.max(op.height, 0.5), level: 0, state: 'always' };
}

/** Is a door standing in this gap (a wall/fence gate centred at `c`, `width` wide)? `doors` are door spots in the world. */
export function doorInGap(c: Vec2, width: number, doors: { id: string; p: Vec2 }[]): boolean {
  const r = Math.max(0.6, width / 2);
  return doors.some((d) => Math.hypot(d.p[0] - c[0], d.p[1] - c[1]) <= r);
}
