// Ground in the engine (spec <eden4>/31 B1, lane L8). An entity world's
// terrain (ground/1 tiles from the world compiler) is the only height: a body
// on level 0 stands at the field's height, and what it meets there (walk,
// wade, swim, steep, outside) decides where it may route. The engine sees
// only this interface; the adapter (packages/engine-mars/src/ground-bridge.ts)
// builds it from @souls/ground. Absent in every authored world (Mars, Eden,
// Little Martians): their flat-level behaviour is untouched.

/** Edge of a ground tile (m); fine grids are built and cached per tile. Equals @souls/ground TILE_M. */
export const GROUND_TILE_M = 64;
/** Media codes, as @souls/ground MEDIUM. */
export const G_WALK = 0, G_WADE = 1, G_SWIM = 2, G_STEEP = 3, G_OUTSIDE = 4;
export const MEDIUM_NAMES = ['walk', 'wade', 'swim', 'steep', 'outside'] as const;
export type GroundMediumName = (typeof MEDIUM_NAMES)[number];

/** logged rules fact `groundV1`: which ground recipe the world stands on (resolved by hash; replay re-derives every height). */
/** `nav: 'paged/1'` (lane NAV): Souls walk the whole ground (spatial/tiled.ts paged windows); absent: the 384 m window. */
export type GroundV1 = { version: 'ground/1'; recipeHash: string; editSeq: number; nav?: 'paged/1' };

export interface GroundField {
  /** The recipe hash (world.groundV1.recipeHash). */
  readonly id: string;
  /** World extent [x0, z0, x1, z1]; nothing outside is walkable. */
  readonly extent: readonly [number, number, number, number];
  /** Deepest water a walker wades (m) and steepest walkable rise/run, for the humanoid body. */
  readonly wadeMax: number;
  readonly maxSlope: number;
  /** Ground height at (x, z), bilinear from the baked 1 m tiles (the picture's height to the bit). */
  height(x: number, z: number): number;
  /** Water surface at (x, z), or null. */
  waterLevel(x: number, z: number): number | null;
  /** Authored water whose surface wins here (overlaps use recipe order), or null. */
  waterId?(x: number, z: number): string | null;
  /** Bounds of one authored water; used only by an explicitly requested swim planner. */
  waterBounds?(id: string): readonly [number, number, number, number] | null;
  /** Medium code of one point (fine: bilinear depth, the 1 m cell's slope). */
  medium(x: number, z: number): number;
  /** Coarse media of one tile: 64 × 64 codes of 1 m cells (row-major), cached by the field. */
  mediaTile(tx: number, tz: number): Uint8Array;
}

/** Coarse medium of the 1 m cell containing (x, z). */
export function coarseMedium(f: GroundField, x: number, z: number): number {
  const tx = Math.floor(x / GROUND_TILE_M), tz = Math.floor(z / GROUND_TILE_M);
  let i = Math.floor(x - tx * GROUND_TILE_M), j = Math.floor(z - tz * GROUND_TILE_M);
  if (i >= GROUND_TILE_M) i = GROUND_TILE_M - 1; if (j >= GROUND_TILE_M) j = GROUND_TILE_M - 1;
  return f.mediaTile(tx, tz)[j * GROUND_TILE_M + i];
}

/** Height a swimmer's root keeps: the bed, or 1.2 m under the surface where deeper (as the shore controller). */
export const SWIM_ROOT_BELOW = 1.2;
export function swimRootY(f: GroundField, x: number, z: number): number {
  const bed = f.height(x, z), lvl = f.waterLevel(x, z);
  if (lvl === null) return bed;
  return lvl - bed > SWIM_ROOT_BELOW ? lvl - SWIM_ROOT_BELOW : bed;
}
