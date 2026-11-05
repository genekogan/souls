#!/usr/bin/env node
// Prints the proof tier (T0–T3) a change needs, from docs/process/PROOF-POLICY.yml.
//
//   node tools/proof/tier.mjs                        working tree (committed + uncommitted + untracked) vs origin/main
//   node tools/proof/tier.mjs --base <ref> [--head <ref>] [--label tier:T3 ...] [--json]
//   node tools/proof/tier.mjs --files a,b,c
//
// The tier is the highest any changed file maps to; a `tier:Tn` label can raise it. `--json` adds the per-file
// mapping and the release gate's `--scope auto` steps for the same diff.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeFor } from '../test-harness/release-gate.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const POLICY_PATH = resolve(ROOT, 'docs/process/PROOF-POLICY.yml');
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'];
const rank = tier => TIERS.indexOf(tier);
/** Conditions a path rule can carry. `tests-only`: the change touches only test files and T0 paths. */
const WHEN = ['tests-only'];
export const TEST_FILE = /\.test\.(ts|mjs)$/;

/** Reads the parts of the policy this tool needs: the `paths` rules (one-line flow maps) and `default_tier`. */
export function loadPolicy(text = readFileSync(POLICY_PATH, 'utf8')) {
  const paths = [];
  let section = null, defaultTier = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) {
      section = line.split(':')[0];
      const m = /^default_tier:\s*(T\d)\s*$/.exec(line);
      if (m) defaultTier = m[1];
      continue;
    }
    if (section !== 'paths' || !line.trim() || line.trim().startsWith('#')) continue;
    const m = /^\s*-\s*\{(.*)\}\s*$/.exec(line);
    if (!m) throw Error(`PROOF-POLICY paths: expected "- { prefix|glob: ..., tier: Tn }", got: ${raw.trim()}`);
    const rule = Object.fromEntries([...m[1].matchAll(/(\w+):\s*("[^"]*"|'[^']*'|[^,\s}]+)/g)].map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
    if (!rule.tier || rank(rule.tier) < 0 || rank(rule.tier) > 3 || !(rule.prefix || rule.glob)) throw Error(`PROOF-POLICY paths: bad rule: ${raw.trim()}`);
    if (rule.when !== undefined && !WHEN.includes(rule.when)) throw Error(`PROOF-POLICY paths: unknown when "${rule.when}" (known: ${WHEN.join(', ')}): ${raw.trim()}`);
    const when = rule.when ? { when: rule.when } : {};
    paths.push(rule.prefix ? { prefix: rule.prefix, tier: rule.tier, ...when } : { glob: rule.glob, re: globToRegExp(rule.glob), tier: rule.tier, ...when });
  }
  if (!paths.length || !defaultTier) throw Error('PROOF-POLICY needs a paths list and default_tier');
  return { paths, defaultTier };
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The first rule matching `file`; a `when: tests-only` rule counts only when `testsOnly` (the whole change) holds. */
export function tierForFile(file, policy, { testsOnly = false } = {}) {
  const rule = policy.paths.find(r => (!r.when || (r.when === 'tests-only' && testsOnly)) && (r.prefix ? file.startsWith(r.prefix) : r.re.test(file)));
  return { tier: rule ? rule.tier : policy.defaultTier, rule: rule ? (rule.prefix || rule.glob) : 'default_tier' };
}

/** Whether a change touches only test files and T0 paths (unconditional rules decide what is T0). */
export const testsOnly = (files, policy) => files.every(f => TEST_FILE.test(f) || tierForFile(f, policy).tier === 'T0');

export function tierFor(files, policy = loadPolicy(), labels = []) {
  const list = files.filter(Boolean), only = testsOnly(list, policy);
  const byFile = list.map(file => ({ file, ...tierForFile(file, policy, { testsOnly: only }) }));
  const fileTier = byFile.reduce((t, f) => rank(f.tier) > rank(t) ? f.tier : t, 'T0');
  const label = labels.map(l => /^tier:(T[0-4])$/.exec(l)?.[1]).filter(Boolean).reduce((t, l) => rank(l) > rank(t) ? l : t, 'T0');
  const raised = rank(label) > rank(fileTier);
  return { tier: raised ? label : fileTier, raisedByLabel: raised ? label : null, byFile };
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').filter(Boolean);
function defaultBase() {
  for (const ref of ['origin/main', 'main']) { try { return git('merge-base', 'HEAD', ref)[0]; } catch { /* next */ } }
  throw Error('no origin/main or main to diff against; pass --base');
}

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const labels = argv.flatMap((a, i) => a === '--label' ? [argv[i + 1]] : []);
  let files;
  if (opt('--files') !== undefined) files = opt('--files').split(',');
  else if (opt('--head')) files = git('diff', '--name-only', `${opt('--base') || defaultBase()}...${opt('--head')}`);
  else files = [...new Set([...git('diff', '--name-only', opt('--base') || defaultBase()), ...git('ls-files', '--others', '--exclude-standard')])];
  const result = tierFor(files, loadPolicy(), labels);
  if (argv.includes('--json')) {
    const gate = scopeFor(files);
    console.log(JSON.stringify({ tier: result.tier, raisedByLabel: result.raisedByLabel, files: result.byFile, gate: { scope: gate.resolved, steps: gate.steps } }, null, 2));
  } else {
    const top = result.byFile.filter(f => f.tier === result.tier).slice(0, 5).map(f => f.file);
    console.log(`${result.tier}${result.raisedByLabel ? ' (raised by label)' : top.length ? ` (${top.join(', ')}${result.byFile.filter(f => f.tier === result.tier).length > 5 ? ', ...' : ''})` : ''}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
