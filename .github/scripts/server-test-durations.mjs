#!/usr/bin/env node
// Measures each server test file's wall time from GitHub Actions logs of the `server-*` CI jobs, for balancing the
// server shards (server-test-files.mjs). Read-only; writes the durations JSON to stdout.
//
//   gh run view --job <server job id> --log -R <owner/repo> > job.log      (one per server shard job, several runs)
//   node .github/scripts/server-test-durations.mjs [--src apps/server] job.log... > .github/scripts/server-test-durations.json
//
// Use logs of serial runs (the serial pass of each job, or a run with --test-concurrency=1): attribution assumes files
// report in list order, which parallel runs do not keep.
// Each job prints its file list ({"shard":…,"files":[…]}) and runs the files one after another (--test-concurrency=1);
// node's TAP output reports each top-level test as `ok N - <name>` when its file finishes. A test is attributed to the
// first file at or after the current one whose source contains its name (files run in list order), and a file's time
// is the step from the previous file's last report to its own (process start, imports and teardown included). Times are
// averaged over every log that ran the file. Files the logs never attribute a test to get no entry; the planner uses
// the median for them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseLog(text) {
  const lines = text.split('\n').map((l) => { const m = /(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$/.exec(l); return m ? { t: Date.parse(m[1]), s: m[2] } : null; }).filter(Boolean);
  const head = lines.find((l) => l.s.startsWith('{"shard"'));
  if (!head) return null;
  const { files } = JSON.parse(head.s);
  const tests = lines.filter((l) => /^(ok|not ok) \d+ - /.test(l.s)).map((l) => ({ t: l.t, name: l.s.replace(/^(ok|not ok) \d+ - /, '').replace(/ # (SKIP|TODO).*$/, '') }));
  return { start: head.t, files, tests };
}

/** {file: seconds} for one log. `sourceOf(file)` returns the file's text (or '' when absent). */
export function fileTimes({ start, files, tests }, sourceOf) {
  const src = files.map((f) => sourceOf(f)), last = new Array(files.length).fill(null);
  let cur = 0;
  for (const x of tests) {
    const needle = x.name.slice(0, 80).replace(/\\(.)/g, '$1');
    let k = cur; while (k < files.length && !src[k].includes(needle)) k++;
    if (k < files.length) cur = k;   // not found anywhere ahead (a computed name): stays with the current file
    last[cur] = x.t;
  }
  const out = {}; let prev = start;
  for (let i = 0; i < files.length; i++) { if (last[i] == null) continue; out[files[i]] = Math.max(0, (last[i] - prev) / 1000); prev = last[i]; }
  return out;
}

function main(argv) {
  const i = argv.indexOf('--src'), root = i >= 0 ? argv[i + 1] : 'apps/server', logs = argv.filter((a, j) => !(j === i || j === i + 1));
  const cache = new Map(), sourceOf = (f) => { if (!cache.has(f)) { const p = join(root, f); cache.set(f, existsSync(p) ? readFileSync(p, 'utf8') : ''); } return cache.get(f); };
  const sum = {}, n = {};
  for (const log of logs) {
    const parsed = parseLog(readFileSync(log, 'utf8')); if (!parsed) { console.error(`${log}: no server shard header`); continue; }
    for (const [f, s] of Object.entries(fileTimes(parsed, sourceOf))) { sum[f] = (sum[f] ?? 0) + s; n[f] = (n[f] ?? 0) + 1; }
  }
  const seconds = Object.fromEntries(Object.keys(sum).sort().map((f) => [f, Math.round(10 * sum[f] / n[f]) / 10]));
  process.stdout.write(JSON.stringify({ about: 'Mean wall seconds per server test file on ubuntu-latest, from server-* CI job logs (server-test-durations.mjs). Regenerate when shards drift; files missing here use the median.', logs: logs.length, seconds }, null, 1) + '\n');
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main(process.argv.slice(2));
