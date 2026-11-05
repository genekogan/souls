// Scenario validation (DESIGN §2 shape, as playtest.mjs run reads it) plus the round-2 truth checks: every expect block
// is well formed and its target refs and positions match the genesis template; a round list names files that load.
// node tools/playtest/scenarios/lib/validate.mjs [file…]   (no args: every scenarios/*.json and casts/*.json) — no world.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExpect, wordFromTargets } from '../../review/expect-oracles.mjs';
import { normalizeCast } from '../../director/swarm/cast.mjs';
import { providerPolicy } from '../../lib/provider-policy.mjs';
import { templateNames, dist } from './world-names.mjs';
import { validateScript } from '../../arena/adapters/scripted-owner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS = resolve(HERE, '..');
export const REPO = resolve(HERE, '../../../..');
const PERSONAS = resolve(HERE, '../../personas');
const ADAPTERS = ['claude-headless', 'codex-headless', 'scripted-owner'];
const names = new Map();
const namesOf = (genesis) => {
  if (!names.has(genesis)) {
    // #1011: a missing template is a loud failure, never a bare ENOENT or a skipped check
    if (!genesis || !existsSync(join(REPO, genesis))) throw new Error(`genesis ${genesis} not found in the repo: template checks cannot run`);
    names.set(genesis, templateNames(join(REPO, genesis)));
  }
  return names.get(genesis);
};

/** Truth check of target refs against the template: the ref exists and pos is the template's (±0.5 m). → [string] */
export function checkTargets(genesis, targets, where) {
  const errs = []; const N = namesOf(genesis);
  for (const [i, t] of (targets ?? []).entries()) {
    const ref = t.ref ?? t.names?.[0]; const n = N.get(ref);
    if (!n) { errs.push(`${where} targets[${i}]: "${ref}" is not a placed name in ${genesis}`); continue; }
    if (n.pos && Array.isArray(t.pos) && dist(n.pos, t.pos) > 0.5) errs.push(`${where} targets[${i}]: pos ${t.pos} is not ${ref}'s template position ${n.pos}`);
  }
  return errs;
}

/** Near-expect truth against the template (H4): targets[] with radiusM, and every answer.anyOf word that names placed
 *  things names one within radiusM of a target (a word that names nothing placed is an alias and passes). → [string] */
export function checkNear(genesis, x, where) {
  if (!Array.isArray(x?.targets) || !x.targets.length) return [`${where} expect.targets[] required for near (the place asked about, from the template)`];
  const errs = x.targets.flatMap((t, i) => (t.radiusM > 0 ? [] : [`${where} targets[${i}].radiusM required for near`]));
  if (errs.length) return errs;
  const N = namesOf(genesis);
  for (const w of x.answer?.anyOf ?? []) {
    const j = wordFromTargets(N, x.targets, w);
    if (j.self) errs.push(`${where} answer.anyOf "${w}" names only the place asked about (${j.thing})`);
    else if (j.placed && !j.near) errs.push(`${where} answer.anyOf "${w}": the nearest placed ${j.thing} is ${j.d.toFixed(1)} m from ${j.target.ref ?? j.target.names[0]} (radiusM ${j.target.radiusM})`);
  }
  return errs;
}

/** validateScenario(obj) → [string] (empty when it would run). */
export function validateScenario(s) {
  const errs = [];
  if (!s?.name || !/^[a-z0-9-]+$/.test(s.name)) errs.push('name: lowercase letters, digits and -');
  if (s?.world?.kind !== 'dev') errs.push('world.kind must be "dev" (the only kind run provisions)');
  const genesisOk = !!s?.world?.genesis && existsSync(join(REPO, s.world.genesis));
  if (!genesisOk) errs.push(`scenario ${s?.name}: world.genesis ${s?.world?.genesis} not found in the repo`);
  if (!Number.isInteger(s?.world?.port)) errs.push('world.port required');
  if (!(s?.durationSec > 0)) errs.push('durationSec > 0');
  const ids = new Set();
  for (const [i, x] of (s?.seats ?? []).entries()) {
    if (!x.id || ids.has(x.id)) errs.push(`seats[${i}].id missing or duplicate`); ids.add(x.id);
    if (!ADAPTERS.includes(x.adapter)) errs.push(`seats[${i}].adapter ${x.adapter}`);
    if (x.adapter === 'claude-headless' && !x.model) errs.push(`seats[${i}].model required for a Claude seat`);
    if (!x.soulName) errs.push(`seats[${i}].soulName required`);
    if (x.adapter === 'scripted-owner') for (const e of validateScript(x.script)) errs.push(`seats[${i}].${e}`);
    if (x.persona && !existsSync(join(PERSONAS, `${x.persona}.md`))) errs.push(`seats[${i}].persona ${x.persona}: no personas/${x.persona}.md`);
  }
  if (!s?.seats?.length) errs.push('seats[] required');
  const d = s?.director ?? {};
  if (!['persona', 'scripted'].includes(d.mode)) errs.push('director.mode must be persona or scripted');
  if (d.mode === 'persona' && (s.seats ?? []).some((x) => !x.persona)) errs.push('persona mode: every seat needs a persona');
  if (d.mode === 'scripted') {
    if (!Array.isArray(d.script) || !d.script.length) errs.push('scripted mode: director.script[] required');
    const bySeat = {};
    for (const [i, e] of (d.script ?? []).entries()) {
      if (!ids.has(e.seat) && e.seat !== '*') errs.push(`script[${i}].seat ${e.seat} is not a seat`);
      if (!['chat', 'card'].includes(e.channel)) errs.push(`script[${i}].channel`);
      if (!e.text) errs.push(`script[${i}].text`);
      if (!(e.atSec >= 0)) errs.push(`script[${i}].atSec`);
      if (e.after != null && e.after !== 'result') errs.push(`script[${i}].after must be "result" (send once this seat's open requests have closed)`);
      if (e.atSec + (e.budgetSec ?? 0) > s.durationSec) errs.push(`script[${i}] ends after durationSec`);
      for (const id of e.seat === '*' ? ids : [e.seat]) (bySeat[id] ??= []).push(e);
      if (e.expect) {
        for (const m of validateExpect(e.expect)) errs.push(`script[${i}] ${m}`);
        if (genesisOk) { errs.push(...checkTargets(s.world.genesis, e.expect.targets, `script[${i}]`)); if (e.expect.kind === 'near') errs.push(...checkNear(s.world.genesis, e.expect, `script[${i}]`)); }
        else if (e.expect.targets?.length || e.expect.kind === 'near') errs.push(`script[${i}] template checks not run: scenario ${s?.name} names world.genesis ${s?.world?.genesis}, which is missing`);
      }
    }
    // Sequential direction waits for each request; non-sequential direction may overlap them (a mid-activity redirection).
    if (d.sequential !== false) for (const [seat, es] of Object.entries(bySeat)) { const o = [...es].sort((a, b) => a.atSec - b.atSec); for (let k = 1; k < o.length; k++) if (o[k].atSec < o[k - 1].atSec + (o[k - 1].budgetSec ?? 0)) errs.push(`seat ${seat}: "${o[k].text}" starts before "${o[k - 1].text}" has used its budget`); }
  }
  if (!Array.isArray(s?.observer?.viewport)) errs.push('observer.viewport required');
  if (s?.observer?.recordStart != null && !['arrival', 'load'].includes(s.observer.recordStart)) errs.push('observer.recordStart must be arrival or load');
  if (s?.review?.mode !== 'deterministic' && !s?.review?.reviewerModel) errs.push('review.reviewerModel required');
  try { providerPolicy(s); } catch (e) { errs.push(e.message); }
  if (!s?.rails) errs.push('rails required');
  return errs;
}

/** validateCast(obj) → [string]: the loader's own checks (normalizeCast) plus podium and room truth vs the template. */
export function validateCast(raw) {
  let c; try { c = normalizeCast(raw); } catch (e) { return [e.message]; }
  const errs = [];
  if (c.world.kind === 'dev') {
    if (!existsSync(join(REPO, c.world.genesis))) return [`world.genesis ${c.world.genesis} not found`];
    const N = namesOf(c.world.genesis);
    for (const m of c.room.match) if (![...N.keys()].some((n) => n.toLowerCase().includes(m.toLowerCase()))) errs.push(`room.match "${m}" names nothing placed in ${c.world.genesis}`);
    if (c.podium?.ref) errs.push(...checkTargets(c.world.genesis, [{ ref: c.podium.ref, pos: c.podium.pos }], 'podium'));
    for (const r of c.podium?.refs ?? []) { const n = N.get(r); if (!n) errs.push(`podium.refs: "${r}" is not a placed name in ${c.world.genesis}`); else if (n.pos && dist(n.pos, c.podium.pos) > c.podium.radiusM) errs.push(`podium.refs: ${r} at ${n.pos} is outside the podium radius`); }
  }
  return errs;
}

/** A round list: {kind:'round', runs:[{label, scenario|cast, …}]} → [string]. */
export function validateRound(r, base = SCENARIOS) {
  const errs = [];
  if (r?.kind !== 'round') errs.push('kind must be "round"');
  for (const [i, x] of (r?.runs ?? []).entries()) {
    const f = x.scenario ?? x.cast; if (!f) { errs.push(`runs[${i}] needs scenario or cast`); continue; }
    const p = join(base, f); if (!existsSync(p)) { errs.push(`runs[${i}] ${f} not found`); continue; }
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    for (const m of x.cast ? validateCast(obj) : validateScenario(obj)) errs.push(`runs[${i}] ${f}: ${m}`);
    if (!x.label) errs.push(`runs[${i}].label required`);
  }
  if (!r?.runs?.length) errs.push('runs[] required');
  return errs;
}

export function validateFile(file) {
  const obj = JSON.parse(readFileSync(file, 'utf8'));
  return obj.kind === 'cast' ? validateCast(obj) : obj.kind === 'round' ? validateRound(obj, dirname(file)) : validateScenario(obj);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => resolve(f))
    : [...readdirSync(SCENARIOS).filter((f) => f.endsWith('.json')).map((f) => join(SCENARIOS, f)), ...readdirSync(join(SCENARIOS, 'casts')).filter((f) => f.endsWith('.json')).map((f) => join(SCENARIOS, 'casts', f))];
  let bad = 0;
  for (const f of files) { const e = validateFile(f); if (e.length) bad += 1; process.stdout.write(`${e.length ? 'FAIL' : 'ok  '} ${f.replace(SCENARIOS + '/', '')}${e.length ? '\n  ' + e.join('\n  ') : ''}\n`); }
  process.exit(bad ? 1 : 0);
}
