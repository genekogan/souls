// Soul Runs specification, version 1: a small envelope that REFERENCES an existing scenario (tools/playtest/scenarios/)
// and records what this run changes about it. It does not copy the scenario's fields. See README.md.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createServer } from 'node:net';
import { providerPolicy, assertMeasurementReady } from '../lib/provider-policy.mjs';
import { sha256 } from '../lib/hash.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';

export const SPEC_VERSION = 1;
const TOP = new Set(['soulRun', 'name', 'scenario', 'cast', 'world', 'durationSec', 'observer', 'limits', 'controllers', 'retention']);
const CASTS = ['scenario', 'none'];
const RETAIN = ['keep', 'delete'];

export const DEFAULTS = Object.freeze({
  cast: 'scenario',
  observer: { check: true, required: false, cameras: null, timeoutMs: 60000 },
  limits: { maxWallSec: 1800, maxControllers: 4, cleanupWaitMs: 15000 },
  controllers: { allowLiveModels: false },
  // Evidence is always kept. These apply only after a completed run; failed or cancelled runs keep everything.
  retention: { worldData: 'keep', controllerState: 'keep' },
});

/** An ad hoc spec from CLI flags, so a one-off run needs no file. */
export function adHocSpec({ scenario, name, cast, port, durationSec }) {
  return { soulRun: SPEC_VERSION, name: name ?? null, scenario, ...(cast ? { cast } : {}), ...(port ? { world: { port: Number(port) } } : {}), ...(durationSec ? { durationSec: Number(durationSec) } : {}) };
}

export function readSpec(file) {
  const text = readFileSync(file, 'utf8');
  return { spec: JSON.parse(text), specPath: resolve(file), specSha256: sha256(text) };
}

/** Static validation: no process, port or directory is touched. Returns {ok, errors, effective, scenario, policy}. */
export function validateSpec(spec, { specPath = null, cwd = process.cwd() } = {}) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, errors: [{ code: 'spec.not-object', message: 'spec must be a JSON object' }] };
  if (spec.soulRun !== SPEC_VERSION) fail('spec.version', `soulRun must be ${SPEC_VERSION} (got ${JSON.stringify(spec.soulRun)})`);
  for (const k of Object.keys(spec)) if (!TOP.has(k)) fail('spec.unknown-field', `unknown field "${k}"`);
  if (typeof spec.scenario !== 'string') fail('scenario.missing', 'scenario: path to an existing scenario JSON is required');
  const cast = spec.cast ?? DEFAULTS.cast;
  if (!CASTS.includes(cast)) fail('cast.unsupported', `cast "${cast}" is not supported; use ${CASTS.join(' or ')} (composed casts are SR2, #751)`);
  const observer = { ...DEFAULTS.observer, ...(spec.observer ?? {}) };
  const limits = { ...DEFAULTS.limits, ...(spec.limits ?? {}) };
  const controllers = { ...DEFAULTS.controllers, ...(spec.controllers ?? {}) };
  const retention = { ...DEFAULTS.retention, ...(spec.retention ?? {}) };
  for (const [k, v] of Object.entries(retention)) if (!RETAIN.includes(v)) fail('retention.value', `retention.${k} must be keep or delete`);
  for (const k of Object.keys(retention)) if (!(k in DEFAULTS.retention)) fail('retention.unknown', `retention.${k} is unknown (evidence is always kept)`);
  if (!(limits.maxWallSec > 0)) fail('limits.maxWallSec', 'limits.maxWallSec must be positive');
  if (!(observer.timeoutMs > 0)) fail('observer.timeoutMs', 'observer.timeoutMs must be positive');
  if (observer.cameras != null && !(Array.isArray(observer.cameras) && observer.cameras.every((c) => c === 'wide'))) fail('observer.cameras', 'observer.cameras: only ["wide"] or [] here (seat follow cameras come from the scenario)');
  for (const k of Object.keys(spec.world ?? {})) if (!['port', 'slug'].includes(k)) fail('world.override', `world.${k} cannot be overridden here; reference a scenario with that world`);
  if (spec.world?.port != null && !(Number.isInteger(spec.world.port) && spec.world.port > 1024 && spec.world.port < 65536)) fail('world.port', 'world.port must be an unprivileged port');
  if (spec.world?.slug != null && !/^[a-z][a-z0-9-]{0,31}$/.test(spec.world.slug)) fail('world.slug', 'world.slug: lowercase letters, digits, dashes');
  if (spec.durationSec != null && !(spec.durationSec > 0)) fail('durationSec', 'durationSec must be positive');
  if (errors.length) return { ok: false, errors };

  // The referenced scenario: relative to the spec file, else to the working directory, else to the repo.
  const base = specPath ? dirname(specPath) : cwd;
  const scenarioPath = isAbsolute(spec.scenario) ? spec.scenario : [resolve(base, spec.scenario), resolve(cwd, spec.scenario), resolve(REPO_ROOT, spec.scenario)].find(existsSync) ?? resolve(base, spec.scenario);
  if (!existsSync(scenarioPath)) return { ok: false, errors: [{ code: 'scenario.not-found', message: `scenario not found: ${spec.scenario}` }] };
  let scenario, scenarioText;
  try { scenarioText = readFileSync(scenarioPath, 'utf8'); scenario = JSON.parse(scenarioText); } catch (e) { return { ok: false, errors: [{ code: 'scenario.unreadable', message: e.message }] }; }
  if (scenario.world?.kind !== 'dev') fail('world.kind', `world.kind "${scenario.world?.kind}" is not supported; only isolated dev worlds`);
  try { assertMeasurementReady(scenario); } catch (e) { fail('scenario.measurement', e.message); }

  const effectiveScenario = applyOverrides(scenario, { cast, world: spec.world, durationSec: spec.durationSec, observer });
  let policy = null;
  try { policy = providerPolicy(effectiveScenario); } catch (e) { fail('controllers.policy', e.message); }
  const controllerList = [...(effectiveScenario.seats ?? []).map((s) => ({ id: s.id, adapter: s.adapter ?? 'claude-headless', model: s.model ?? null, effort: s.effort ?? null })), ...(effectiveScenario.god ? [{ id: 'god', adapter: effectiveScenario.god.adapter ?? 'claude-headless', model: effectiveScenario.god.model ?? null, effort: effectiveScenario.god.effort ?? null }] : [])];
  if (controllerList.length > limits.maxControllers) fail('limits.maxControllers', `${controllerList.length} controllers exceed limits.maxControllers ${limits.maxControllers}`);
  if (policy?.required?.length && controllers.allowLiveModels !== true) fail('controllers.live-model', `this run needs live model providers (${policy.required.join(', ')}) for ${[...controllerList.map((c) => `${c.id}:${c.adapter}`), ...(policy.claude && !controllerList.length ? ['director/reviewer'] : [])].join(', ')}; set controllers.allowLiveModels only with explicit authorization, or use cast "none" with a scripted director and deterministic review`);
  if (errors.length) return { ok: false, errors };

  const effective = { soulRun: SPEC_VERSION, name: spec.name ?? `${scenario.name}${cast === 'none' ? '-world' : ''}`, scenario: { path: scenarioPath, sha256: sha256(scenarioText), name: scenario.name }, cast, world: { port: effectiveScenario.world.port, slug: effectiveScenario.world.slug ?? null, genesis: effectiveScenario.world.genesis ?? null }, durationSec: effectiveScenario.durationSec ?? null, observer, limits, controllers, retention };
  return { ok: true, errors: [], effective, scenario: effectiveScenario, controllers: controllerList, policy };
}

/** The scenario this run executes: the referenced scenario plus only the overrides the spec names. */
export function applyOverrides(scenario, { cast = 'scenario', world = null, durationSec = null, observer = null } = {}) {
  const out = structuredClone(scenario);
  if (world?.port != null) out.world.port = world.port;
  if (world?.slug != null) out.world.slug = world.slug;
  if (durationSec != null) out.durationSec = durationSec;
  if (observer?.cameras != null) out.observer = { ...(out.observer ?? {}), cameras: observer.cameras };
  if (cast === 'none') {
    out.seats = []; out.god = null;
    if (out.director) out.director = { ...out.director, script: [] };
    out.soulRunCast = { mode: 'none', removedSeats: (scenario.seats ?? []).map((s) => s.id), removedGod: !!scenario.god, removedScriptEvents: scenario.director?.script?.length ?? 0 };
  }
  return out;
}

/** True when nothing listens on 127.0.0.1:port (the world binds it). Checks only; never stops what holds it. */
export function portFree(port) {
  return new Promise((resolvePort) => {
    const srv = createServer();
    srv.once('error', () => resolvePort(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolvePort(true)));
  });
}
