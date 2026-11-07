// WEATHER-RULES (Gene 2026-10-23): a god's rain or storm is a shower with an end, also across a restart from the snapshot;
// lightning only inside it; the scheduled weather never rains two slots running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strikesBetween, setWeatherInForce, WEATHER_RULES } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { envPatch, setEnv, weatherNow } from './world-env.ts';
import { viewerWeatherKind } from '../edge/eyes/sight.ts';

test('a set storm ends (default 45 world min), survives a restart with its end, and strikes only before it', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wr-')), 'w.db');
  let tick = 10_000;
  const opts = { worldId: 'wr', ownerId: null, tick: () => tick, emit: () => {}, constants: { extent: 400 } } as any;
  const god = new GodMode(new Db(file), opts);
  assert.equal((setEnv(god, { weather: { kind: 'storm', intensity: 1 } }) as any).accepted, true);
  const w = god.model.state.weather as any, end = 10_000 + Math.round((45 * 72000) / 1440);
  assert.equal(w.until, end); assert.equal(w.minutes, WEATHER_RULES.stormMinutes);
  assert.equal(weatherNow(god.model.state, null, end - 1).kind, 'storm');
  assert.equal(weatherNow(god.model.state, '2027-01-01T12:00:00', end).scheduled, true, 'past its end: the schedule');
  const b = [-200, -200, 200, 200];
  assert.ok(strikesBetween(god.model.state as any, 's', b, 10_000, end).length > 0);
  assert.equal(strikesBetween(god.model.state as any, 's', b, end, end + 50_000).length, 0, 'no lightning after the storm');
  // restart: a fresh GodMode on the same database keeps the end tick
  const again = new GodMode(new Db(file), opts);
  assert.equal((again.model.state.weather as any).until, end);
  assert.equal(setWeatherInForce(again.model.state.weather as any, end + 1), false);
  // a lightning strike alone does not move the end; a dry setting has none and stays
  tick = 11_000;
  assert.equal((setEnv(again, { weather: { kind: 'rain', minutes: 30 } }) as any).accepted, true);
  assert.equal((again.model.state.weather as any).until, 11_000 + 1500);
  assert.equal((setEnv(again, { weather: { kind: 'clear' } }) as any).accepted, true);
  assert.equal((again.model.state.weather as any).until, null);
  assert.equal(weatherNow(again.model.state, null, 1e9).kind, 'clear');
});

test('a wet setting without an end (set before the rule) has ended; minutes are bounded', () => {
  assert.equal(setWeatherInForce({ kind: 'storm', intensity: 0.8 }, 5), false);
  assert.equal(setWeatherInForce({ kind: 'rain' }, NaN), false);
  assert.equal(setWeatherInForce({ kind: 'fog' }, 5), true);
  assert.equal(strikesBetween({ weather: { kind: 'storm', intensity: 1 } }, 's', [-200, -200, 200, 200], 0, 50_000).length, 0);
  const base: any = { time: { dayTicks: 72000 }, weather: { kind: 'auto' } };
  assert.throws(() => envPatch(base, { weather: { kind: 'rain', minutes: 600 } }, 1), /minutes/);
  assert.equal(envPatch(base, { weather: { kind: 'rain' } }, 1).weather!.minutes, WEATHER_RULES.rainMinutes);
});

test('the schedule: never two wet 2 h slots running; most of the daylight dry', () => {
  let prevWet = false, wetRuns = 0, day = 0, dayWet = 0;
  for (let t = Date.parse('2026-01-01T01:00:00Z'); t < Date.parse('2029-01-01T00:00:00Z'); t += 2 * 3600e3) {
    const k = viewerWeatherKind(new Date(t).toISOString()), wet = k === 'rain' || k === 'storm';
    if (wet && prevWet) wetRuns++; prevWet = wet;
    const h = new Date(t).getUTCHours(); if (h >= 6 && h < 18) { day++; if (wet) dayWet++; }
  }
  assert.equal(wetRuns, 0);
  assert.ok(dayWet / day < 0.25, `daylight wet share ${dayWet / day}`);
});

test('re-sending the same weather while a storm runs keeps its end; after the end, setting it again starts a new one', () => {
  let tick = 1000;
  const god = new GodMode(new Db(':memory:'), { worldId: 'wr2', ownerId: null, tick: () => tick, emit: () => {}, constants: { extent: 400 } } as any);
  assert.equal((setEnv(god, { weather: { kind: 'storm', intensity: 0.8 } }) as any).accepted, true);
  const end = (god.model.state.weather as any).until;
  tick = 1500;
  const w = god.model.state.weather as any;
  god.act({ ops: [{ op: 'world', state: { sky: { palette: 'clear-day', sun: 0.5 }, weather: { kind: w.kind, intensity: w.intensity, minutes: w.minutes } } }] } as any);
  assert.equal((god.model.state.weather as any).until, end, 'carried-along weather does not stretch the storm');
  tick = end + 10;
  assert.equal((setEnv(god, { weather: { kind: 'storm', intensity: 0.8 } }) as any).accepted, true);
  assert.equal((god.model.state.weather as any).until, end + 10 + 2250);
});
