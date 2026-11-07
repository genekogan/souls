// R4-LIVE: a god world's environment — time of day, the speed of time, and the weather — as ONE small setter over the
// god's world state (the `world` op: validated, in the ledger, invertible, broadcast to every viewer as a world diff).
//
//   setEnv(god, { timeOfDay: 19.5 | '19:30', timeScale: 24, weather: { kind: 'storm', intensity: 0.8, wind: 0.9, fog: 0.2 } })
//
// - timeOfDay: the clock moves to the NEAREST occurrence of that hour, at most 12 h back or forward (world-clock.ts
//   applies it once per set; GOD-ENV: repeated sets of one hour no longer advance the calendar day).
// - timeScale: world hours per real hour (24 = one world day per real hour, the default; 1 = real time; 0 = paused).
// - weather.kind: 'auto' = the live worlds' scheduled weather (a kind per 2 h slot, seeded by the day, exactly as /w/eden
//   draws it); 'clear' | 'cloudy' | 'rain' | 'wind' | 'fog' | 'storm' set the channels from the kind × intensity (storm =
//   lightning and thunder in the viewer); 'manual' keeps the channels as given. wind / fog / clouds / rain override the
//   kind's channel. Every field is optional; what is not named keeps its value.
//
// The viewer draws it (apps/web WorldAtmosphere, world-env.ts there); Souls perceive it (edge `here` weather and Eyes'
// caption via EdgeLedger.weatherNow). GOD-ENV wraps this as god ops / CLI verbs; HTTP: GET /v1/world/env (public),
// POST /v1/god/env (god token) with the same body.
import type { Context, Hono } from 'hono';
import { WEATHER_KINDS, type WorldState } from '@souls/world-compiler';
import type { WorldHost } from '../world.ts';
import type { GodMode } from './god.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { viewerWeatherKind } from '../edge/eyes/sight.ts';
import { ApiError } from '../souls.ts';
import { recentStrikes } from './lightning.ts';
import { CREATION_LIMITS } from '@souls/generators';
import { WEATHER_RULES, setWeatherInForce, showerMinutes } from '@souls/world-compiler';
import { godTokenLimiter } from './rate-limit.ts';
import { syncWorldClock } from './world-clock.ts';
import { callerOf } from './builds.ts';

export type WeatherKind = (typeof WEATHER_KINDS)[number];
export type EnvInput = {
  timeOfDay?: number | string;
  timeScale?: number;
  weather?: { kind?: WeatherKind; intensity?: number; wind?: number; fog?: number; clouds?: number; rain?: number; minutes?: number };
};
export type Channels = { clouds: number; rain: number; wind: number; fog: number };

/** The channels each named kind shows at full intensity (the viewer's own targets, atmosphere/weather.ts targetFor). */
export const KIND_CHANNELS: Record<Exclude<WeatherKind, 'auto' | 'manual'>, Channels> = {
  clear: { clouds: 0.15, rain: 0, wind: 0.28, fog: 0 },
  cloudy: { clouds: 0.72, rain: 0, wind: 0.4, fog: 0.03 },
  rain: { clouds: 0.95, rain: 1, wind: 0.55, fog: 0.25 },
  wind: { clouds: 0.38, rain: 0, wind: 1, fog: 0 },
  fog: { clouds: 0.5, rain: 0, wind: 0.06, fog: 1 },
  storm: { clouds: 1, rain: 1, wind: 0.85, fog: 0.3 },
};
const CALM = KIND_CHANNELS.clear;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number) => Math.round(x * 1000) / 1000;

/** "19:30", "7pm", 19.5 → hours 0..24. */
export function parseHour(v: number | string): number {
  if (typeof v === 'number') { if (!Number.isFinite(v) || v < 0 || v > 24) throw new ApiError(400, 'invalid', 'timeOfDay is 0–24 (hours) or "HH:MM"'); return v % 24; }
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(v);
  if (!m) throw new ApiError(400, 'invalid', 'timeOfDay is 0–24 (hours) or "HH:MM"');
  let h = Number(m[1]); const min = Number(m[2] ?? 0), ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  if (h > 24 || min > 59) throw new ApiError(400, 'invalid', 'timeOfDay is 0–24 (hours) or "HH:MM"');
  return (h + min / 60) % 24;
}

/** The `world` op patch for an env request against the current state (pure; the op's own inverse undoes it). */
export function envPatch(state: WorldState, env: EnvInput, journalSeq: number): { time?: Record<string, unknown>; weather?: Record<string, unknown> } {
  const out: { time?: Record<string, unknown>; weather?: Record<string, unknown> } = {};
  if (env.timeOfDay !== undefined) out.time = { ...out.time, set: { hour: round(parseHour(env.timeOfDay)), n: journalSeq } };
  if (env.timeScale !== undefined) {
    const s = Number(env.timeScale);
    if (!Number.isFinite(s) || s < 0 || s > 1440) throw new ApiError(400, 'invalid', 'timeScale is world hours per real hour: 0 (paused) … 1440; 24 = one world day per real hour');
    if (s === 0) out.time = { ...out.time, paused: true };
    else {
      const dayTicks = Math.round((24 * 3600 * 20) / s);
      if (dayTicks < 1200 || dayTicks > 20_000_000) throw new ApiError(400, 'invalid', 'timeScale is 0 or 0.09 … 1440');
      out.time = { ...out.time, paused: false, dayTicks };
    }
  }
  if (env.weather) {
    const w = env.weather, cur = state.weather as WorldState['weather'] & Partial<Channels> & { kind?: WeatherKind; intensity?: number };
    const kind = w.kind ?? cur.kind ?? 'auto';
    if (!(WEATHER_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'invalid', `weather.kind is one of ${WEATHER_KINDS.join(', ')}`);
    for (const k of ['intensity', 'wind', 'fog', 'clouds', 'rain'] as const) if (w[k] !== undefined && !(Number(w[k]) >= 0 && Number(w[k]) <= 1)) throw new ApiError(400, 'invalid', `weather.${k} is 0…1`);
    const intensity = w.intensity ?? (w.kind ? 1 : cur.intensity ?? 1);
    const patch: Record<string, unknown> = { kind, intensity };
    if (kind !== 'auto' && kind !== 'manual' && (w.kind !== undefined || w.intensity !== undefined)) {
      const full = KIND_CHANNELS[kind];
      for (const k of ['clouds', 'rain', 'wind', 'fog'] as const) patch[k] = round(CALM[k] + (full[k] - CALM[k]) * intensity);
    }
    for (const k of ['clouds', 'rain', 'wind', 'fog'] as const) if (w[k] !== undefined) patch[k] = round(Number(w[k]));
    // WEATHER-RULES: a rain or storm is a shower with an end; `minutes` (world minutes) sets its length
    if (w.minutes !== undefined) {
      const m = Number(w.minutes);
      if (!(m >= WEATHER_RULES.minMinutes && m <= WEATHER_RULES.maxMinutes)) throw new ApiError(400, 'invalid', `weather.minutes is ${WEATHER_RULES.minMinutes}…${WEATHER_RULES.maxMinutes} world minutes (how long the rain or storm lasts)`);
      patch.minutes = Math.round(m);
    } else if (w.kind === 'rain' || w.kind === 'storm') patch.minutes = showerMinutes({ kind });
    out.weather = patch;
  }
  return out;
}

/** Apply an env request as one `world` op (in the ledger, undoable). */
export function setEnv(god: GodMode, env: EnvInput, note = 'environment') {
  const patch = envPatch(god.model.state, env, god.model.editSeq + 1);
  if (!patch.time && !patch.weather) throw new ApiError(400, 'invalid', 'give timeOfDay, timeScale and/or weather');
  return god.act({ ops: [{ op: 'world', state: patch }] }, note);
}

/** What the weather is right now (the scheduled kind on 'auto'), for Souls and the API. */
export function weatherNow(state: WorldState, datetime: string | null, tick = NaN): Channels & { kind: Exclude<WeatherKind, 'auto'>; scheduled: boolean; intensity: number; lightning: number; until?: number } {
  const w = state.weather as WorldState['weather'] & Partial<Channels> & { kind?: WeatherKind; intensity?: number; until?: number | null };
  // WEATHER-RULES: a set rain/storm past its end (or without one) is back on the schedule
  const kind = setWeatherInForce(w, tick) ? w.kind! : 'auto';
  if (kind === 'auto') {
    const k = (datetime ? viewerWeatherKind(datetime) : null) ?? 'clear';
    return { kind: k, scheduled: true, intensity: 1, ...KIND_CHANNELS[k], lightning: k === 'storm' ? 1 : 0 };
  }
  const ch = { clouds: clamp01(w.clouds ?? 0.1), rain: clamp01(w.rain ?? 0), wind: clamp01(w.wind ?? 0.1), fog: clamp01(w.fog ?? 0) };
  return { kind, scheduled: false, intensity: clamp01(w.intensity ?? 1), ...ch, lightning: kind === 'storm' ? clamp01(w.intensity ?? 1) : 0, ...(typeof w.until === 'number' ? { until: w.until } : {}) };
}

/** The env as a reader sees it: the clock (from the engine), its speed, and the weather now. */
export function envView(host: WorldHost, god: GodMode) {
  const datetime = (host.engine.world as { env?: { datetime?: string } }).env?.datetime ?? null;
  const t = god.model.state.time as WorldState['time'] & { set?: { hour: number; n: number } | null; paused?: boolean };
  const paused = t.paused === true, dayTicks = Number(t.dayTicks) || 72000;
  return {
    contract: 'world-env/1',
    time: { datetime, clock: datetime ? datetime.slice(11, 16) : null, paused, timeScale: paused ? 0 : round((24 * 3600 * 20) / dayTicks), dayTicks, set: t.set ?? null },
    weather: weatherNow(god.model.state, datetime, host.engine.world.tick),
    undoNote: 'Undo restores environment settings; it does not rewind the world clock.',
    // GOD-ENV: the last lightning strike of the last minute (the storm's or the god's)
    ...(() => { const tick = host.engine.world.tick, l = recentStrikes(god, tick).pop(); return l ? { strike: { x: l.x, z: l.z, tick: l.tick, ago: Math.round((tick - l.tick) / 20), god: !!l.god } } : {}; })(),
    setter: 'POST /v1/god/env { timeOfDay?, timeScale?, weather?: { kind?, intensity?, wind?, fog?, clouds?, rain?, minutes? } } (god token); a rain or storm ends after `minutes` world minutes (default rain 90, storm 45; 5…360)',
  };
}

/** Souls perceive the god's weather (edge `here`, Eyes' caption). */
export function installWorldEnv(host: WorldHost, god: GodMode, edge?: EdgeLedger) {
  if (edge) edge.weatherNow = () => weatherNow(god.model.state, (host.engine.world as { env?: { datetime?: string } }).env?.datetime ?? null, host.engine.world.tick);
}

export function mountEnvRoutes(app: Hono, d: { host: WorldHost; god: GodMode; requireGod: (c: Context) => unknown }) {
  const limitGod = godTokenLimiter(d.requireGod);
  const noStore = { 'cache-control': 'no-store' };
  app.get('/v1/world/env', (c) => c.json(envView(d.host, d.god), 200, noStore));
  app.post('/v1/god/env', async (c) => {
    limitGod(c, 'env', CREATION_LIMITS.envEditsPerMinute);
    let b: EnvInput & { note?: string };
    try { b = await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); }
    const r = d.god.as(callerOf(d.requireGod(c)), () => setEnv(d.god, b, typeof b?.note === 'string' ? b.note : 'environment'));
    const identity = d.god.godIdentity(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''));
    const warnings = r.accepted ? d.god.sharedClockWarnings(identity ?? undefined) : [];
    // onCommit queues the logged engine rules. Read the clock only after those rules have applied.
    if (r.accepted) await syncWorldClock(d.god);
    return c.json({ ...r, ...(warnings.length ? { warnings: [...(r.accepted ? r.warnings : []), ...warnings] } : {}), env: envView(d.host, d.god) }, 200, noStore);
  });
}
