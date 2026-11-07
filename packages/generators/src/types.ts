// What a generator produces: the physics half (pure; server, skill, viewer all use it).
// The mesh half lives in apps/web/src/gen-mesh/*.mesh.ts under the same id.
// Owner: L1. Spec <eden4>/29 §4.2, 31 §3 (Stage-B readiness).
import type { z } from 'zod';
import type { LandformBody } from '@souls/ground';
import type { Field, FieldInput, Slot, SlotInput, Value } from './fields.ts';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Oriented box in the def frame: centre (x, z), half extents, yaw, vertical span. Solids only. */
export type LocalOBB = { c: Vec2; half: Vec2; yaw: number; y0: number; y1: number; tag?: string; /** world-frame (path/area) bakes: y0/y1 are absolute, not above the ground */ abs?: boolean };
/** A walkable floor at a level (Stage B feeds these into Spatial). */
export type Surface = { level: number; y: number; polygon: Vec2[]; material?: string; tag?: string; /** world-frame (path/area) bakes: y is absolute, not above the ground */ abs?: boolean };
/** A gap in a wall: door, window, gate, arch. `wall` indexes the generator's wall list. */
export type Opening = { id: string; kind: 'door' | 'window' | 'gate' | 'arch'; wall?: number; at: Vec2; yaw: number; width: number; height: number; sill?: number; level: number; state?: 'open' | 'closed' | 'always'; /** Building design graph, preserved for admission (windows never connect rooms). */ from?: string; to?: string; exterior?: boolean };
/** A connection between levels: stairs, ramps, ladders, float shafts. Path in the def frame. */
export type Link = { id: string; kind: 'stairs' | 'ramp' | 'ladder' | 'float'; from: number; to: number; path: Vec2[]; width: number; y0: number; y1: number };
/** A room: floor index, polygon and frame in the def frame. Exposed as a `room` slot of the same id. */
export type Room = { id: string; name: string; floor: number; y: number; polygon: Vec2[]; origin: Vec2; yaw: number; height: number };
/** A baked slot. `retired`: a frame an earlier release offered where this one has none (building/1 facade frames on
 *  a wall run with no clear wall, since r2.1). It still resolves at its old place, so whatever already hangs there
 *  stays put and can be edited, but it takes no new mount and is not listed. */
export type BakedSlot = Slot & { retired?: true };

export type Baked = {
  /** Local bounds (x width, y height, z depth) at scale 1. */
  box: Vec3;
  colliders: LocalOBB[];
  surfaces?: Surface[];
  openings?: Opening[];
  links?: Link[];
  rooms?: Room[];
  slots: BakedSlot[];
  landform?: LandformBody;
  water?: { level: number; area?: Vec2[]; path?: Vec2[]; width?: number; /** path water: level per path point (rivers flow) */ levels?: number[] };
  /** Triangle estimate for budgets. */
  tris: number;
  /** Free-form facts for `describe` (e.g. reachability, warnings). */
  notes?: string[];
};

export type Shape = { path?: Vec2[]; width?: number; area?: Vec2[] };
export type GenContext = {
  /** Instance params, defaults filled. */
  params: Record<string, Value>;
  /** Def-level fixed arguments (`make.args`): kit shape lists, building presets. */
  args: Record<string, unknown>;
  seed: number;
  shape?: Shape;
};

export type Generator = {
  id: string;
  /** Which entity form this generator expects. */
  form: 'point' | 'path' | 'area';
  /** One line for the god's schema browser. */
  doc: string;
  /** Instance params a def may expose (defaults); a def's own `params` override these. */
  params: Record<string, FieldInput>;
  /** Optional validation of `make.args` (e.g. kit shapes). */
  args?: z.ZodType;
  /** Who owns the implementation (lane), for the schema browser and reviewers. */
  owner?: string;
  physics(ctx: GenContext): Baked;
};

export type { Field, FieldInput, Slot, SlotInput, Value };
