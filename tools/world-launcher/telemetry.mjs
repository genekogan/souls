#!/usr/bin/env node
// CW4 (#738): bounded telemetry history and an operator report, from the launcher's existing loopback /__sim/metrics.
// A separate process: it reads Prometheus text the launcher builds from each world's live.json, so it never wakes a
// world, touches attention or makes an agent read. Docs: docs/operations/telemetry.md.
//
//   node tools/world-launcher/telemetry.mjs collect --url http://127.0.0.1:<port>/__sim/metrics --dir <data>/telemetry
//        [--every 15] [--fine-days 7] [--rollup-days 90] [--max-bytes 2147483648] [--once]
//   node tools/world-launcher/telemetry.mjs report --dir <d> [--range 1h|24h|7d|<iso>..<iso>] [--json]
//   node tools/world-launcher/telemetry.mjs close --dir <d>        roll up, gzip and prune finished hours now
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePrometheus } from './telemetry/prom.mjs';
import { Store, DEFAULTS } from './telemetry/store.mjs';
import { reduceHour } from './telemetry/reduce.mjs';
import { report, text } from './telemetry/report.mjs';

const argv = process.argv.slice(2), cmd = argv[0], opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; }, flag = (k) => argv.includes(`--${k}`);
const num = (k, d) => { const v = Number(opt(k, d)); if (!Number.isFinite(v) || v <= 0) throw new Error(`--${k} must be a positive number`); return v; };

/** One scrape into the store. Never throws; an unreachable launcher or a bad answer is a recorded gap. */
export async function scrapeOnce(store, url, { now = Date.now, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  const t = now();
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return store.append({ t, ok: false, error: `HTTP ${r.status}` }) && false;
    const p = parsePrometheus(await r.text()); store.state.loss.skippedLines += p.skipped;
    const stamp = p.samples.find((x) => x.name === 'sim_metrics_scrape_timestamp_seconds')?.value;
    return store.append({ t, ok: true, types: p.types, skewMs: stamp != null ? t - stamp * 1000 : null, samples: p.samples });
  } catch (e) { store.append({ t, ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.cause?.code ?? e?.message ?? e) }); return false; }
}

export function openStore(dir, o = {}) { return new Store(dir, { ...o, reduceHour }); }

async function main() {
  const dir = opt('dir'); if (!dir) throw new Error('--dir <telemetry directory> is required');
  if (cmd === 'collect') {
    const url = opt('url'); if (!url || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url)) throw new Error('--url must be the launcher\'s loopback /__sim/metrics');
    const everyMs = num('every', DEFAULTS.everyMs / 1000) * 1000;
    const store = openStore(dir, { everyMs, fineDays: num('fine-days', DEFAULTS.fineDays), rollupDays: num('rollup-days', DEFAULTS.rollupDays), maxBytes: num('max-bytes', DEFAULTS.maxBytes) });
    store.close(Date.now());   // finish hours a previous run left open
    if (flag('once')) { await scrapeOnce(store, url, { timeoutMs: Math.min(10_000, everyMs) }); store.saveState(); return; }
    let stop = false; const quit = () => { stop = true; }; process.on('SIGINT', quit); process.on('SIGTERM', quit);
    const t0 = Date.now(); let k = 0;
    while (!stop) {
      await scrapeOnce(store, url, { timeoutMs: Math.min(10_000, everyMs) });
      store.state.collector = { rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), at: Date.now(), everyMs };
      const next = t0 + ++k * everyMs; await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));   // fixed cadence: a slow scrape does not shift the grid
    }
    store.saveState(); return;
  }
  if (cmd === 'close') { const s = openStore(dir); s.close(Date.now()); return; }
  if (cmd === 'report') {
    const s = openStore(dir), r = report(dir, s.state, { range: opt('range', '24h'), everyMs: s.state.collector?.everyMs ?? DEFAULTS.everyMs });
    process.stdout.write(flag('json') ? JSON.stringify(r, null, 1) + '\n' : text(r)); return;
  }
  throw new Error('usage: telemetry.mjs collect|report|close --dir <d> ...');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(`telemetry: ${e.message}`); process.exit(1); });
