// PR CI and its latency job must cover the complete recursive server test inventory.
// The server-* jobs split it into SERVER_SHARDS shards balanced by measured file durations (server-test-durations.json,
// regenerated with server-test-durations.mjs); the durations only balance the split, so a missing or stale entry can
// make a shard slower but can never drop or repeat a file.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LATENCY_TEST = 'owner-response-milestones.test.ts';
export const SERVER_SHARDS = 6;

export function serverTestFiles(src = 'apps/server/src') {
  const files = [];
  function visit(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), relative + '/');
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(relative);
    }
  }
  visit(src);
  return files.sort();
}

/** The measured seconds per file ({'src/x.test.ts': s}); {} when the file is absent or unreadable. */
export function serverTestDurations(file = new URL('./server-test-durations.json', import.meta.url)) {
  try { return JSON.parse(readFileSync(file, 'utf8')).seconds ?? {}; } catch { return {}; }
}

/** Every shard's files: longest first, each to the currently lightest shard (ties: lower index, then name), deterministic.
 *  Unmeasured files weigh the median. The latency test runs in its own job. */
export function serverShards(all, shards = SERVER_SHARDS, seconds = serverTestDurations()) {
  if (!Number.isInteger(shards) || shards < 1) throw Error('Invalid server shard count');
  if (!all.includes(LATENCY_TEST)) throw Error('Expected latency test is missing');
  const files = all.filter(f => f !== LATENCY_TEST).map(f => `src/${f}`);
  const known = files.map(f => seconds[f]).filter(Number.isFinite).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = f => (Number.isFinite(seconds[f]) ? seconds[f] : median);
  const out = Array.from({ length: shards }, () => ({ files: [], seconds: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))) {
    const s = out.reduce((best, x, i) => (x.seconds < out[best].seconds ? i : best), 0);
    out[s].files.push(f); out[s].seconds += weight(f);
  }
  for (const x of out) { if (!x.files.length) throw Error('Empty server shard'); x.files.sort(); x.seconds = Math.round(x.seconds); }
  return out;
}

export function serverShardFiles(all, shard, shards = SERVER_SHARDS, seconds = serverTestDurations()) {
  if (!Number.isInteger(shard) || shard < 0 || shard >= shards) throw Error('Invalid server shard');
  return serverShards(all, shards, seconds)[shard].files;
}
