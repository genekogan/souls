// Soul Runs specification, version 1: a small envelope that REFERENCES an existing scenario (tools/playtest/scenarios/)
// and records what this run changes about it. It does not copy the scenario's fields. See README.md.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createServer } from 'node:net';
import { providerPolicy, assertMeasurementReady } from '../lib/provider-policy.mjs';
import { sha256 } from '../lib/hash.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';
import { validateScenario } from '../scenarios/lib/validate.mjs';
import { normalizeCast, castPolicy } from '../director/swarm/cast.mjs';
import { validateScript } from '../arena/adapters/scripted-owner.mjs';

export const SPEC_VERSION = 1;
const TOP = new Set(['soulRun', 'name', 'arm', 'scenario', 'cast', 'world', 'durationSec', 'observer', 'limits', 'controllers', 'retention', 'setup', 'evaluation']);
const CASTS = ['scenario', 'none'];
// The scripted director delivers cards and chat; it has no pause or resume (end is the run's own cancellation).
const DIRECTOR_COMMANDS = { scripted: [] };
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
export function adHocSpec({ scenario, name, arm, cast, port, durationSec }) {
  return { soulRun: SPEC_VERSION, name: name ?? null, ...(arm ? { arm } : {}), scenario, ...(cast ? { cast } : {}), ...(port ? { world: { port: Number(port) } } : {}), ...(durationSec ? { durationSec: Number(durationSec) } : {}) };
}

export function readSpec(file) {
  const text = readFileSync(file, 'utf8');
  return { spec: JSON.parse(text), specPath: resolve(file), specSha256: sha256(text) };
}

/** Static validation: no process, port or directory is touched. Returns {ok, errors, effective, scenario, policy}. */
export function validateSpec(spec, { specPath = null, cwd = process.cwd(), serverRoot = REPO_ROOT } = {}) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, errors: [{ code: 'spec.not-object', message: 'spec must be a JSON object' }] };
  if (spec.soulRun !== SPEC_VERSION) fail('spec.version', `soulRun must be ${SPEC_VERSION} (got ${JSON.stringify(spec.soulRun)})`);
  for (const k of Object.keys(spec)) if (!TOP.has(k)) fail('spec.unknown-field', `unknown field "${k}"`);
  // An arm label (#839): a declared condition such as baseline or candidate; compare never pools different labels.
  if (spec.arm != null && !(typeof spec.arm === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(spec.arm))) fail('spec.arm', `arm must be a short label (letters, digits, . _ -; at most 40), got ${JSON.stringify(spec.arm)}`);
  // A directed cast (#783): cast {file} names a swarm cast file (tools/playtest/scenarios/casts/) instead of a scenario.
  if (spec.cast && typeof spec.cast === 'object' && !Array.isArray(spec.cast) && 'file' in spec.cast) return validateDirected(spec, { specPath, cwd, serverRoot, errors });
  if (typeof spec.scenario !== 'string') fail('scenario.missing', 'scenario: path to an existing scenario JSON is required');
  const cast = spec.cast ?? DEFAULTS.cast;
  const composed = cast && typeof cast === 'object' && !Array.isArray(cast);
  if (!composed && !CASTS.includes(cast)) fail('cast.unsupported', `cast ${JSON.stringify(cast)} is not supported; use ${CASTS.join(' or ')}, or an object {seats, script}`);
  if (composed) {
    for (const k of Object.keys(cast)) if (!['seats', 'script'].includes(k)) fail('cast.unknown-field', `cast.${k} is unknown (cast takes seats and script, in the scenario's own formats)`);
    if (cast.seats != null && (!Array.isArray(cast.seats) || !cast.seats.length)) fail('cast.seats', 'cast.seats: a non-empty list of scenario seats');
    const ids = (cast.seats ?? []).map((x) => x?.id);
    if (new Set(ids).size !== ids.length) fail('cast.seats.duplicate', `cast.seats ids must be unique (one controller per Soul): ${ids.join(', ')}`);
    if (cast.script != null && !Array.isArray(cast.script)) fail('cast.script', 'cast.script: a list of scripted director entries');
    for (const [i, e] of (cast.script ?? []).entries()) {
      if (e?.command != null) fail('direction.unsupported', `cast.script[${i}].command "${e.command}": the scripted director supports ${DIRECTOR_COMMANDS.scripted.length ? DIRECTOR_COMMANDS.scripted.join(', ') : 'no commands'} beyond card/chat deliveries; end a run by cancelling it`);
    }
  }
  const setup = spec.setup ?? null;
  if (setup != null) {
    for (const k of Object.keys(setup)) if (!['batches', 'maxWallSec'].includes(k)) fail('setup.unknown-field', `setup.${k} is unknown`);
    if (!Array.isArray(setup.batches) || !setup.batches.length) fail('setup.batches', 'setup.batches: a list of god-edit batch files or {id, ops} objects');
    if (setup.maxWallSec != null && !(setup.maxWallSec > 0)) fail('setup.maxWallSec', 'setup.maxWallSec must be positive');
  }
  // Predeclared evaluation (SR4): question scorer files named before the run, hashed now, so a later evaluation can tell
  // predeclared acceptance from exploratory post-run questions.
  const evaluation = spec.evaluation ?? null;
  if (evaluation != null) {
    for (const k of Object.keys(evaluation)) if (k !== 'questions') fail('evaluation.unknown-field', `evaluation.${k} is unknown (evaluation takes questions)`);
    if (!Array.isArray(evaluation.questions) || !evaluation.questions.every((q) => typeof q === 'string')) fail('evaluation.questions', 'evaluation.questions: a list of question scorer files (runs/questions/)');
  }
  const observer = { ...DEFAULTS.observer, ...(spec.observer ?? {}) };
  const limits = { ...DEFAULTS.limits, ...(spec.limits ?? {}) };
  const controllers = { ...DEFAULTS.controllers, ...(spec.controllers ?? {}) };
  const retention = { ...DEFAULTS.retention, ...(spec.retention ?? {}) };
  for (const [k, v] of Object.entries(retention)) if (!RETAIN.includes(v)) fail('retention.value', `retention.${k} must be keep or delete`);
  for (const k of Object.keys(retention)) if (!(k in DEFAULTS.retention)) fail('retention.unknown', `retention.${k} is unknown (evidence is always kept)`);
  if (!(limits.maxWallSec > 0)) fail('limits.maxWallSec', 'limits.maxWallSec must be positive');
  if (!(observer.timeoutMs > 0)) fail('observer.timeoutMs', 'observer.timeoutMs must be positive');
  if (observer.cameras != null && !(Array.isArray(observer.cameras) && observer.cameras.every((c) => c === 'wide'))) fail('observer.cameras', 'observer.cameras: only ["wide"] or [] here (seat follow cameras come from the scenario)');
  for (const k of Object.keys(spec.world ?? {})) if (!['port', 'slug', 'genesis', 'snapshot'].includes(k)) fail('world.override', `world.${k} cannot be overridden here; reference a scenario with that world`);
  if (spec.world?.genesis != null && spec.world?.snapshot != null) fail('world.source', 'world: give genesis or snapshot, not both');
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

  const base0 = specPath ? dirname(specPath) : cwd;
  const find = (p) => isAbsolute(p) ? p : [resolve(base0, p), resolve(cwd, p), resolve(REPO_ROOT, p)].find(existsSync) ?? null;
  // World source: a genesis template or a frozen compiler snapshot, both repo paths read by existing provisioning.
  const sourceKey = spec.world?.snapshot != null ? 'snapshot' : spec.world?.genesis != null ? 'genesis' : scenario.world?.snapshot ? 'snapshot' : 'genesis';
  const sourceRel = spec.world?.[sourceKey] ?? scenario.world?.[sourceKey];
  const sourcePath = typeof sourceRel === 'string' ? resolve(serverRoot, sourceRel) : null; // provisioning resolves it the same way
  if (!sourcePath || !existsSync(sourcePath)) fail('world.source', `world ${sourceKey} not found: ${sourceRel}`);
  // Setup: existing god-edit batches, resolved and hashed now; applied after provision, before any seat exists.
  const batches = [];
  for (const [i, b] of (setup?.batches ?? []).entries()) {
    if (typeof b === 'string') {
      const p = find(b);
      if (!p) { fail('setup.batch-missing', `setup.batches[${i}]: ${b} not found`); continue; }
      const text = readFileSync(p, 'utf8'); let j = null; try { j = JSON.parse(text); } catch (e) { fail('setup.batch-unreadable', `setup.batches[${i}]: ${e.message}`); continue; }
      if (!Array.isArray(j?.ops) || !j.ops.length) { fail('setup.batch-ops', `setup.batches[${i}]: ${b} has no ops`); continue; }
      batches.push({ id: j.id ?? b.split('/').pop().replace(/\.json$/, ''), path: p, sha256: sha256(text), ops: j.ops, note: j.note ?? null });
    } else if (b && typeof b === 'object' && Array.isArray(b.ops) && b.ops.length && typeof b.id === 'string') batches.push({ id: b.id, path: null, sha256: sha256(JSON.stringify(b.ops)), ops: b.ops, note: b.note ?? null });
    else fail('setup.batch', `setup.batches[${i}]: a file path or {id, ops}`);
  }
  const questions = [];
  for (const [i, q] of (evaluation?.questions ?? []).entries()) {
    const p = find(q);
    if (!p) { fail('evaluation.question-missing', `evaluation.questions[${i}]: ${q} not found`); continue; }
    questions.push({ id: q.split('/').pop().replace(/\.mjs$/, ''), path: p, sha256: sha256(readFileSync(p)) });
  }
  if (errors.length) return { ok: false, errors };
  const effectiveScenario = applyOverrides(scenario, { cast, world: spec.world, durationSec: spec.durationSec, observer });
  if (composed) for (const m of validateScenario(effectiveScenario)) fail('cast.scenario', `composed scenario: ${m}`);
  let policy = null;
  try { policy = providerPolicy(effectiveScenario); } catch (e) { fail('controllers.policy', e.message); }
  const controllerList = [...(effectiveScenario.seats ?? []).map((s) => ({ id: s.id, adapter: s.adapter ?? 'claude-headless', model: s.model ?? null, effort: s.effort ?? null })), ...(effectiveScenario.god ? [{ id: 'god', adapter: effectiveScenario.god.adapter ?? 'claude-headless', model: effectiveScenario.god.model ?? null, effort: effectiveScenario.god.effort ?? null }] : [])];
  if (controllerList.length > limits.maxControllers) fail('limits.maxControllers', `${controllerList.length} controllers exceed limits.maxControllers ${limits.maxControllers}`);
  if (policy?.required?.length && controllers.allowLiveModels !== true) fail('controllers.live-model', `this run needs live model providers (${policy.required.join(', ')}) for ${[...controllerList.map((c) => `${c.id}:${c.adapter}`), ...(policy.claude && !controllerList.length ? ['director/reviewer'] : [])].join(', ')}; set controllers.allowLiveModels only with explicit authorization, or use cast "none" with a scripted director and deterministic review`);
  if (errors.length) return { ok: false, errors };

  const effective = { soulRun: SPEC_VERSION, name: spec.name ?? `${scenario.name}${cast === 'none' ? '-world' : ''}`, arm: spec.arm ?? null, scenario: { path: scenarioPath, sha256: sha256(scenarioText), name: scenario.name }, cast, world: { port: effectiveScenario.world.port, slug: effectiveScenario.world.slug ?? null, genesis: effectiveScenario.world.genesis ?? null, snapshot: effectiveScenario.world.snapshot ?? null, source: { kind: sourceKey, path: sourceRel, sha256: sha256(readFileSync(sourcePath)) } }, setup: setup ? { maxWallSec: setup.maxWallSec ?? 120, batches: batches.map(({ id, path, sha256: h, ops }) => ({ id, path, sha256: h, ops: ops.length })) } : null, durationSec: effectiveScenario.durationSec ?? null, observer, limits, controllers, retention, ...(evaluation ? { evaluation: { questions } } : {}) };
  return { ok: true, errors: [], effective, scenario: effectiveScenario, controllers: controllerList, policy, setup: setup ? { maxWallSec: setup.maxWallSec ?? 120, batches } : null };
}

const SEAT_ADAPTERS = ['claude-headless', 'codex-headless', 'scripted-owner'];
const CAST_CAMERAS = ['follow', 'wide'];

/** A directed-cast spec: {soulRun, cast: {file}, name?, world? {port, slug}, durationSec?, observer?, limits?,
 *  controllers?, retention?, evaluation?}. The cast runs through the swarm director (playtest.mjs direct), headless, with
 *  its own console script. Static: nothing is started. Returns validateSpec's shape plus `cast` (the effective cast). */
function validateDirected(spec, { specPath, cwd, serverRoot, errors }) {
  const fail = (code, message) => errors.push({ code, message });
  if (spec.scenario != null) fail('cast.with-scenario', 'a directed cast spec names cast.file and no scenario (the cast file is the whole scene)');
  if (spec.setup != null) fail('setup.directed', 'setup batches are not supported with a directed cast yet; put the scene in the cast\'s genesis');
  for (const k of Object.keys(spec.cast)) if (k !== 'file') fail('cast.unknown-field', `cast.${k} is unknown (a directed cast takes only file)`);
  if (typeof spec.cast.file !== 'string' || !spec.cast.file) fail('cast.file', 'cast.file: path to a cast JSON (tools/playtest/scenarios/casts/)');
  const observer = { ...DEFAULTS.observer, ...(spec.observer ?? {}) };
  const limits = { ...DEFAULTS.limits, ...(spec.limits ?? {}) };
  const controllers = { ...DEFAULTS.controllers, ...(spec.controllers ?? {}) };
  const retention = { ...DEFAULTS.retention, ...(spec.retention ?? {}) };
  for (const [k, v] of Object.entries(retention)) if (!RETAIN.includes(v)) fail('retention.value', `retention.${k} must be keep or delete`);
  for (const k of Object.keys(retention)) if (!(k in DEFAULTS.retention)) fail('retention.unknown', `retention.${k} is unknown (evidence is always kept)`);
  if (!(limits.maxWallSec > 0)) fail('limits.maxWallSec', 'limits.maxWallSec must be positive');
  if (!(observer.timeoutMs > 0)) fail('observer.timeoutMs', 'observer.timeoutMs must be positive');
  if (observer.cameras != null && !(Array.isArray(observer.cameras) && observer.cameras.every((c) => CAST_CAMERAS.includes(c)))) fail('observer.cameras', `observer.cameras: a subset of ${CAST_CAMERAS.join(', ')} for a directed cast`);
  for (const k of Object.keys(spec.world ?? {})) if (!['port', 'slug'].includes(k)) fail('world.override', `world.${k} cannot be overridden for a directed cast; change the cast file`);
  if (spec.world?.port != null && !(Number.isInteger(spec.world.port) && spec.world.port > 1024 && spec.world.port < 65536)) fail('world.port', 'world.port must be an unprivileged port');
  if (spec.world?.slug != null && !/^[a-z][a-z0-9-]{0,31}$/.test(spec.world.slug)) fail('world.slug', 'world.slug: lowercase letters, digits, dashes');
  if (spec.durationSec != null && !(spec.durationSec > 0)) fail('durationSec', 'durationSec must be positive');
  const evaluation = spec.evaluation ?? null;
  if (evaluation != null) {
    for (const k of Object.keys(evaluation)) if (k !== 'questions') fail('evaluation.unknown-field', `evaluation.${k} is unknown (evaluation takes questions)`);
    if (!Array.isArray(evaluation.questions) || !evaluation.questions.every((q) => typeof q === 'string')) fail('evaluation.questions', 'evaluation.questions: a list of question scorer files (runs/questions/)');
  }
  if (errors.length) return { ok: false, errors };

  const base = specPath ? dirname(specPath) : cwd;
  const find = (p) => isAbsolute(p) ? (existsSync(p) ? p : null) : [resolve(base, p), resolve(cwd, p), resolve(REPO_ROOT, p)].find(existsSync) ?? null;
  const castPath = find(spec.cast.file);
  if (!castPath) return { ok: false, errors: [{ code: 'cast.not-found', message: `cast file not found: ${spec.cast.file}` }] };
  let raw, castText;
  try { castText = readFileSync(castPath, 'utf8'); raw = JSON.parse(castText); } catch (e) { return { ok: false, errors: [{ code: 'cast.unreadable', message: e.message }] }; }
  let cast;
  try { cast = normalizeCast(raw); } catch (e) { return { ok: false, errors: [{ code: 'cast.invalid', message: e.message }] }; }
  if (cast.world.kind !== 'dev') fail('world.kind', `world.kind "${cast.world.kind}" is not supported; only isolated dev worlds`);
  for (const st of cast.seats) {
    if (!SEAT_ADAPTERS.includes(st.adapter)) fail('cast.adapter', `seat ${st.id}: adapter ${st.adapter} is not one of ${SEAT_ADAPTERS.join(', ')}`);
    if (st.adapter === 'scripted-owner') for (const m of validateScript(st.script)) fail('cast.seat-script', `seat ${st.id}: ${m}`);
  }
  const sourcePath = cast.world.genesis ? resolve(serverRoot, cast.world.genesis) : null;
  if (!sourcePath || !existsSync(sourcePath)) fail('world.source', `world genesis not found: ${cast.world.genesis}`);
  const questions = [];
  for (const [i, q] of (evaluation?.questions ?? []).entries()) {
    const p = find(q);
    if (!p) { fail('evaluation.question-missing', `evaluation.questions[${i}]: ${q} not found`); continue; }
    questions.push({ id: q.split('/').pop().replace(/\.mjs$/, ''), path: p, sha256: sha256(readFileSync(p)) });
  }
  if (errors.length) return { ok: false, errors };
  // The effective cast: the file plus only the overrides this spec names. Headless runs take its console script.
  const eff = structuredClone(cast);
  if (spec.world?.port != null) eff.world.port = spec.world.port;
  if (spec.world?.slug != null) eff.world.slug = spec.world.slug;
  if (spec.durationSec != null) eff.durationSec = spec.durationSec;
  if (observer.cameras != null) eff.observer = { ...eff.observer, cameras: observer.cameras };
  if (!Number.isInteger(eff.world.port)) fail('world.port', 'the cast has no world.port; set world.port in the spec');
  let policy = null;
  try { policy = castPolicy(eff); } catch (e) { fail('controllers.policy', e.message); }
  const controllerList = eff.seats.map((x) => ({ id: x.id, adapter: x.adapter, model: x.adapter === 'scripted-owner' ? null : x.model ?? null, effort: x.adapter === 'scripted-owner' ? null : x.effort ?? null }));
  if (controllerList.length > limits.maxControllers) fail('limits.maxControllers', `${controllerList.length} controllers exceed limits.maxControllers ${limits.maxControllers}`);
  if (policy?.live.length && controllers.allowLiveModels !== true) fail('controllers.live-model', `this cast needs live models for ${policy.live.join(', ')}; set controllers.allowLiveModels only with explicit authorization, or use scripted-owner seats and no planner`);
  if (errors.length) return { ok: false, errors };
  const effective = { soulRun: SPEC_VERSION, kind: 'cast', name: spec.name ?? cast.name, arm: spec.arm ?? null, cast: { path: castPath, sha256: sha256(castText), name: cast.name, seats: eff.seats.length, consoleScript: eff.console.script.length },
    world: { port: eff.world.port, slug: eff.world.slug ?? null, genesis: eff.world.genesis, snapshot: null, source: { kind: 'genesis', path: eff.world.genesis, sha256: sha256(readFileSync(sourcePath)) } },
    setup: null, durationSec: eff.durationSec, observer, limits, controllers, retention, ...(evaluation ? { evaluation: { questions } } : {}) };
  // scenario: the shape the playtest preflight reads, so it checks exactly the providers this cast needs.
  return { ok: true, errors: [], effective, scenario: policy.scenario, cast: eff, controllers: controllerList, policy, setup: null };
}

/** The scenario this run executes: the referenced scenario plus only the overrides the spec names. */
export function applyOverrides(scenario, { cast = 'scenario', world = null, durationSec = null, observer = null } = {}) {
  const out = structuredClone(scenario);
  if (world?.port != null) out.world.port = world.port;
  if (world?.slug != null) out.world.slug = world.slug;
  if (world?.genesis != null) { out.world.genesis = world.genesis; delete out.world.snapshot; }
  if (world?.snapshot != null) out.world.snapshot = world.snapshot;
  if (durationSec != null) out.durationSec = durationSec;
  if (observer?.cameras != null) out.observer = { ...(out.observer ?? {}), cameras: observer.cameras };
  if (cast && typeof cast === 'object') {
    // A composed cast replaces the scenario's seats and/or scripted direction in their own formats (seat "*" is the
    // scripted director's broadcast).
    if (cast.seats) out.seats = structuredClone(cast.seats);
    if (cast.script) out.director = { ...(out.director ?? {}), mode: 'scripted', script: structuredClone(cast.script) };
    out.soulRunCast = { mode: 'composed', seats: out.seats.map((x) => x.id), replacedSeats: !!cast.seats, replacedScript: !!cast.script, broadcasts: (cast.script ?? []).filter((e) => e.seat === '*').length };
  }
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
