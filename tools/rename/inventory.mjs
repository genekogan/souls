#!/usr/bin/env node
// The retired name "Sim", counted by kind across the tracked tree, for the staged rename to Souls.
//   node tools/rename/inventory.mjs            counts by kind and by area
//   node tools/rename/inventory.mjs --lines    every occurrence: path:line kind text
// Not occurrences of the name: "Sim Score" and `Sim.<api>` (the music work and its engine API), "The Sims" and SimCity
// (other people's games), and "simulation". They are listed as `other` or not matched, so a stage never edits them by accident.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const KINDS = [
  ['other', /\bSim Score\b|\bSim\.[a-zA-Z]+|\bThe Sims\b|\bSims-style\b|\bSimCity\b|\bregister\(Sim\b/g],
  ['domain', /\bsim\.eden\.art\b/g],
  ['header', /\b[Xx]-[Ss]im-[A-Za-z-]+/g],
  ['env', /\bSIM_[A-Z0-9_]+/g],
  ['package', /@sim\/[a-z-]+/g],
  ['route', /__sim[A-Za-z_]*/g],
  ['token', /\bsim_<|\bsim_[a-z0-9]{2,}_|['"`]sim_/g],
  ['path-or-id', /\bsim-[a-z][a-z-]*\b|\bsim[A-Z][A-Za-z]*\b|\buseSim\b/g],
  ['word', /\bSim(?:'s)?\b/g],
];

/** The kinds on one line. Earlier kinds consume their matches, so `Sim Score` is never also a `word`. */
export function kindsOf(line) {
  let rest = line; const found = [];
  for (const [kind, re] of KINDS) rest = rest.replace(re, (m) => { found.push([kind, m]); return ' '.repeat(m.length); });
  return found;
}

export const areaOf = (path) => {
  if (path === 'CHANGELOG.md') return 'history';
  const parts = path.split('/');
  return ['apps', 'packages', 'tools', 'docs', 'worlds'].includes(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let out = '';
  try { out = execFileSync('git', ['grep', '-n', '-I', '-i', 'sim', '--', '.'], { encoding: 'utf8', maxBuffer: 1 << 30 }); } catch (e) { if (e.status !== 1) throw e; }
  const lines = process.argv.includes('--lines'), totals = {}, areas = {};
  for (const row of out.split('\n')) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(row); if (!m) continue;
    for (const [kind, text] of kindsOf(m[3])) {
      totals[kind] = (totals[kind] ?? 0) + 1;
      (areas[areaOf(m[1])] ??= {})[kind] = ((areas[areaOf(m[1])] ?? {})[kind] ?? 0) + 1;
      if (lines) process.stdout.write(`${m[1]}:${m[2]} ${kind} ${text}\n`);
    }
  }
  if (!lines) process.stdout.write(JSON.stringify({ totals, areas }, null, 1) + '\n');
}
