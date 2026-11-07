// W5 provisioning (lane mars, 2026-10-16): water is finite and moves by hand. A Soul carries a vessel (a carryable thing
// with state `level`: a watering can) to a water source (a fixed thing tagged `water` with state `level`: a tank, a rain
// barrel), draws water into the vessel — the source loses exactly the litres the vessel gains — and pours it on a plant
// (a thing with state `moisture`: a planter). These are ordinary object actions of god things (actuators.ts):
//   object:<source>:draw-water   "Fill the watering can you are holding from the water tank"
//   object:<plant>:water         "Water the planter with the watering can you are holding"
// A vessel's own `fill` (a can left lying about) also draws from a source standing next to it, and refuses otherwise:
// water never appears from nothing. A source refills only by a delivery: the world's creator sets its level (Godmode
// `set`), or a def's own `fill` action where the god kept one. Refusals say what is missing in plain words.
import type { StoredDef } from '@souls/world-compiler';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Action = StoredDef['actions'][number];
type Refusal = { code: string; reason: string };
export type Vec2 = [number, number];

/** Litres when a thing has no `litres` param (base def name without its library prefix). */
export const LITRES: Record<string, number> = { 'water-tank': 3000, 'rain-barrel': 200, trough: 120, 'watering-can': 10, 'planter-box': 6, planter: 6, 'potted-plant': 2, 'flower-pot': 2 };
const FALLBACK = { source: 200, vessel: 5, plant: 4 } as const;
/** A can left lying about fills from a source within this distance of it (it stands under the tap). */
export const SOURCE_NEAR_VESSEL = 2.5;
const EPS = 1e-6;

export type WaterRole = 'source' | 'vessel' | 'plant';
const base = (name: string) => name.replace(/^(core|mars|lm|ew|world)-/, '');
const comps = (def: StoredDef) => def.components as Record<string, unknown>;
export function waterRole(def: StoredDef): WaterRole | null {
  const st = def.state as Record<string, { type?: string }>;
  if (st.moisture?.type === 'number') return 'plant';
  if (st.level?.type !== 'number') return null;
  if (comps(def).carryable) return 'vessel';
  return def.tags.includes('water') ? 'source' : null;
}
/** A thing's capacity in litres: its own `litres` param, else the def's default, else the table, else by role. */
export function litresOf(def: StoredDef, params?: Record<string, unknown>): number {
  const own = Number(params?.litres ?? (def.params as Record<string, { default?: unknown }>).litres?.default);
  if (Number.isFinite(own) && own > 0) return own;
  const role = waterRole(def);
  return LITRES[base(def.name)] ?? (role ? FALLBACK[role] : 1);
}
/** Plain words for a def: `core-water-tank` → "water tank". */
export const wordOf = (def: StoredDef) => base(def.name).replace(/-/g, ' ');
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Levels keep their precision (a 10 L can from a 3000 L tank is 0.0033 of it): only float dust is trimmed. */
const lv = (x: number) => Math.round(x * 1e9) / 1e9;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The synthetic actions a def gets from its water role (def/1-shaped so the actuator path offers them). */
export function waterActions(def: StoredDef): Action[] {
  const role = waterRole(def), w = wordOf(def);
  const mk = (name: string, label: string, field: string) => ({ name, label, roles: 'anyone', reach: 'touch', params: {}, when: [], then: [{ op: 'set', field, value: 0 }], water: true }) as unknown as Action;
  if (role === 'source' && !def.actions.some((a) => a.name === 'draw-water')) return [mk('draw-water', `Fill the watering can you are holding from the ${w}`, 'level')];
  // entry 34: a growing planter is watered with a can fetched from its hook (watering.ts), not only one already held
  const growing = (def.state as Record<string, { type?: string }>).growth?.type === 'number';
  if (role === 'plant' && !def.actions.some((a) => a.name === 'water')) return [mk('water', growing ? `Water the plants and flowers in the ${w} with the watering can` : `Water the ${w} with the watering can you are holding`, 'moisture')];
  return [];
}
export const isWaterAction = (a: Action | undefined) => !!(a as { water?: boolean } | undefined)?.water;

/** The water fields the viewer and Souls see (level / moisture), with defaults. */
export function waterFields(def: StoredDef): string[] {
  const r = waterRole(def); return r === 'plant' ? ['moisture'] : r ? ['level'] : [];
}

export type Tank = { id: string; name: string; level: number; litres: number };
export type Plant = { id: string; name: string; moisture: number; litres: number };
export type Vessel = { id: string; name: string; level: number; litres: number };
export type Transfer = { litres: number; set: { id: string; field: 'level' | 'moisture'; value: number }[]; summary: string };

const holdCan = (v: Vessel | null, verb: string): Refusal | null =>
  v ? null : { code: 'water.no-vessel', reason: `You are not holding a watering can; pick one up first, then ${verb}.` };

/** Draw from a source into the vessel in hand: as much as the vessel has room for, or what the source has left. */
export function drawWater(src: Tank, v: Vessel | null): Refusal | Transfer {
  const no = holdCan(v, `fill it at ${src.name}`); if (no) return no;
  const room = (1 - v!.level) * v!.litres, have = src.level * src.litres;
  if (room <= EPS) return { code: 'water.vessel-full', reason: `${v!.name} is already full.` };
  if (have <= EPS) return { code: 'water.source-empty', reason: `${src.name} is empty; it needs a water delivery before anyone can draw from it.` };
  const l = Math.min(room, have);
  const vNext = clamp01(v!.level + l / v!.litres), sNext = clamp01(src.level - l / src.litres);
  return { litres: r3(l), set: [{ id: src.id, field: 'level', value: lv(sNext) }, { id: v!.id, field: 'level', value: lv(vNext) }],
    summary: `Drew ${fmt(l)} L from ${src.name} into ${v!.name}${l < room - EPS ? ` (all it had; ${v!.name} is not full)` : ''}; ${src.name} has ${fmt(src.level * src.litres - l)} L left.` };
}
/** Pour from the vessel in hand onto a plant: what the soil still takes, or what the vessel has. */
export function waterPlant(p: Plant, v: Vessel | null): Refusal | Transfer {
  const no = holdCan(v, `water ${p.name}`); if (no) return no;
  const want = (1 - p.moisture) * p.litres, have = v!.level * v!.litres;
  if (want <= EPS) return { code: 'water.plant-wet', reason: `${p.name} is already well watered.` };
  if (have <= EPS) return { code: 'water.vessel-empty', reason: `${v!.name} is empty; fill it at a water tank or a rain barrel first.` };
  const l = Math.min(want, have);
  return { litres: r3(l), set: [{ id: v!.id, field: 'level', value: lv(clamp01(v!.level - l / v!.litres)) }, { id: p.id, field: 'moisture', value: lv(clamp01(p.moisture + l / p.litres)) }],
    summary: `Watered ${p.name} with ${fmt(l)} L from ${v!.name}${l < want - EPS ? ` (it could take ${fmt(want - l)} L more)` : ''}; ${v!.name} has ${fmt(have - l)} L left.` };
}
const fmt = (l: number) => (l >= 10 ? String(Math.round(l)) : String(Math.round(l * 10) / 10));

export const asTank = (id: string, name: string, def: StoredDef, state: Record<string, unknown>, params?: Record<string, unknown>): Tank => ({ id, name, level: num(state.level, num((def.state as any).level?.default)), litres: litresOf(def, params) });
export const asPlant = (id: string, name: string, def: StoredDef, state: Record<string, unknown>, params?: Record<string, unknown>): Plant => ({ id, name, moisture: num(state.moisture, num((def.state as any).moisture?.default)), litres: litresOf(def, params) });
