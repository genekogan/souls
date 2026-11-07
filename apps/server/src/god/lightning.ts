// GOD-ENV: lightning on a god's world. The storm's strikes are deterministic (packages/world-compiler lightning.ts);
// the god can strike a point on purpose (POST /v1/god/strike → a `world` op patch weather.strike: in the ledger, undoable,
// broadcast). Souls perceive both: `here.weather.lightning` says where the last bolt fell, how far, and when its thunder
// reached them; viewers draw the bolt and the flash and play the thunder delayed by the distance.
import type { Context, Hono } from 'hono';
import { boundsOf, strikesBetween, SOUND_MPS, type Strike, type WorldState } from '@souls/world-compiler';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import { callerOf } from './builds.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { CREATION_LIMITS } from '@souls/generators';
import { godTokenLimiter } from './rate-limit.ts';

const r1 = (v: number) => Math.round(v * 10) / 10;
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Compass word for a direction in the world frame (−z is north). */
export const compassWord = (dx: number, dz: number) => DIRS[((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8];
const seconds = (s: number) => (s < 1.5 ? 'a moment' : s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** The strikes of the last `windowTicks` up to `tick` (the storm's and the god's). */
export function recentStrikes(god: GodMode, tick: number, windowTicks = 1200): Strike[] {
  return strikesBetween(god.model.state as never, god.model.seed, boundsOf(god.model), Math.max(0, tick - windowTicks), tick + 1);
}

/** What a Soul at (x, z) perceived of the lightning in the last minute, in words (null: none). */
export function lightningNear(god: GodMode, x: number, z: number, tick: number, names?: (x: number, z: number) => string | null): { last: string; strikes: number; nearest: number } | null {
  return lightningFrom(recentStrikes(god, tick), x, z, tick, names);
}
/** lightningNear over a strike list (Stage B: a read worker holds main's recent strikes, shipped per tick). */
export function lightningFrom(list: readonly Strike[], x: number, z: number, tick: number, names?: (x: number, z: number) => string | null): { last: string; strikes: number; nearest: number } | null {
  if (!list.length) return null;
  const last = list[list.length - 1], d = Math.hypot(last.x - x, last.z - z), ago = (tick - last.tick) / 20, delay = d / SOUND_MPS;
  const by = names?.(last.x, last.z);
  const thunder = ago < delay ? `its thunder will reach you in ${seconds(delay - ago)}` : `its thunder reached you ${seconds(delay)} after the flash`;
  const where = d < 25 ? 'right beside you' : `${Math.round(d)} m to the ${compassWord(last.x - x, last.z - z)}`;
  return { last: `${last.god ? 'the god\'s ' : ''}lightning struck ${where}${by ? ` (by ${by})` : ''} ${seconds(ago)} ago; ${thunder}`, strikes: list.length, nearest: Math.round(Math.min(...list.map((s) => Math.hypot(s.x - x, s.z - z)))) };
}

/** The god strikes: at a point, at a thing, or (no `at`) somewhere among the things the god built. */
export function strike(god: GodMode, at: unknown, tick: number) {
  const m = god.model, bb = boundsOf(m);
  let x: number, z: number, near: string | null = null;
  if (typeof at === 'string' && !/^\s*-?\d/.test(at)) {
    const e = m.get(at); if (!e) throw new ApiError(400, 'invalid', `no thing called ${at}`);
    const p = m.worldPose(e); x = p.x; z = p.z; near = m.pathOf(e.id);
  } else if (at !== undefined) {
    const v = Array.isArray(at) ? at.map(Number) : String(at).split(',').map(Number);
    if (v.length !== 2 || !v.every(Number.isFinite)) throw new ApiError(400, 'invalid', 'at is [x, z], "x,z" or a thing');
    [x, z] = v;
  } else {
    const roots = [...m.entities.values()].filter((e) => e.in.parent === 'world' && e.p && !e.shape);
    const pick = roots.length ? roots[(tick >>> 3) % roots.length] : null;
    const p = pick ? m.worldPose(pick) : { x: (bb[0] + bb[2]) / 2, z: (bb[1] + bb[3]) / 2 };
    const a = ((tick * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    x = p.x + Math.cos(a) * 25; z = p.z + Math.sin(a) * 25;
  }
  if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) throw new ApiError(400, 'invalid', `(${r1(x)}, ${r1(z)}) is outside the world [${bb.join(', ')}]`);
  const prev = (m.state as WorldState & { weather: { strike?: { n: number } | null } }).weather.strike;
  const s = { x: r1(x), z: r1(z), n: (prev?.n ?? 0) + 1, tick };
  const r = god.act({ ops: [{ op: 'world', state: { weather: { strike: s } } }] }, `lightning at ${s.x}, ${s.z}`);
  return { ...r, strike: { ...s, near, delayNote: 'at the speed of sound (≈ 3 s per km)' } };
}

/** Souls perceive the lightning (edge `here`). */
export function installLightning(god: GodMode, edge: EdgeLedger | undefined, tick: () => number) {
  if (!edge) return;
  (edge as EdgeLedger & { lightningNear?: (x: number, z: number) => unknown }).lightningNear = (x: number, z: number) => lightningNear(god, x, z, tick());
  // Stage B (split/verdict-pump.ts): the strikes a read worker's lightningNear reads
  (edge as EdgeLedger & { recentStrikesV1?: () => Strike[] }).recentStrikesV1 = () => recentStrikes(god, tick());
}

export function mountLightningRoutes(app: Hono, d: { god: GodMode; requireGod: (c: Context) => unknown; tick: () => number }) {
  const limitGod = godTokenLimiter(d.requireGod);
  app.post('/v1/god/strike', async (c) => {
    limitGod(c, 'strike', CREATION_LIMITS.strikesPerMinute);
    let b: { at?: unknown } = {}; try { b = await c.req.json(); } catch { /* no body: anywhere */ }
    return c.json(d.god.as(callerOf(d.requireGod(c)), () => strike(d.god, b?.at, d.tick())), 200, { 'cache-control': 'no-store' });
  });
}
