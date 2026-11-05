#!/usr/bin/env node
// CW4 (#738): bounded telemetry history and an operator report, from the launcher's existing loopback /__sim/metrics.
// A separate process: it reads Prometheus text the launcher builds from each world's live.json, so it never wakes a
// world, touches attention or makes an agent read. Docs: docs/operations/telemetry.md.
//
//   node tools/world-launcher/telemetry.mjs collect --url http://127.0.0.1:<port>/__sim/metrics --dir <data>/telemetry
//        [--every 15] [--fine-days 7] [--rollup-days 90] [--max-bytes 2147483648] [--once]
//   node tools/world-launcher/telemetry.mjs report --dir <d> [--range 1h|24h|7d|<iso>..<iso>] [--json]
//   node tools/world-launcher/telemetry.mjs close --dir <d>        roll up, gzip and prune finished hours now
//   node tools/world-launcher/telemetry.mjs alerts --dir <d> [--rules <file.json>] [--json]   evaluate alert rules (#739)
//   collect ... --alerts [--rules <file.json>]                        the same evaluation after every scrape
//   node tools/world-launcher/telemetry.mjs cost --dir <d> --cost <private cost.json> [--range 24h] [--json]
//   node tools/world-launcher/telemetry.mjs packet --dir <d> [--cost <file>] [--bench <dir>] [--range 24h] [--json]   context packet
//   node tools/world-launcher/telemetry.mjs units --dir <d> --cost <file> [--range 24h] [--json]   unit costs (#739 S3)
//   node tools/world-launcher/telemetry.mjs scenarios --cost <file> --bench <capacity-qualify dir> [--worlds 10,50,100,200,400] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { parsePrometheus } from './telemetry/prom.mjs';
import { Store, DEFAULTS } from './telemetry/store.mjs';
import { reduceHour } from './telemetry/reduce.mjs';
import { report, text } from './telemetry/report.mjs';
import { catchUp, rulesWith, open as openAlerts } from './telemetry/alerts.mjs';
import { parseCost, costReport, hoursFromReport } from './telemetry/cost.mjs';
import { packet, packetText } from './telemetry/packet.mjs';
import { fineFiles, tryReadHour } from './telemetry/store.mjs';
import { acceptedActs, scenarios, scenariosText, sizingFromBench, soulHours, unitCosts } from './telemetry/units.mjs';
import { reduceRange } from './telemetry/report.mjs';
import { execFileSync } from 'node:child_process';

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
const readJson = (file, what) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${what} ${file}: ${e.message}`); } };
/** The cost section for a report window: the private cost file applied to the window's world-hours. */
export function costFor(r, file, everyMs) {
  return costReport(parseCost(readJson(file, '--cost')), { from: Date.parse(r.range.from), to: Date.parse(r.range.to), ...hoursFromReport(r, everyMs) });
}
/** The launcher build label from the newest answered scrape in the window, or null. */
export function launcherBuild(dir, from, to) {
  if (!existsSync(join(dir, 'fine'))) return null;
  const rows = fineFiles(dir, from, to).map(tryReadHour).filter(Boolean).flatMap((h) => h.rows).filter((x) => x.ok);
  const key = rows.length ? [...rows.at(-1).values.keys()].find((k) => k.startsWith('sim_launcher_info{')) : null;
  return key ? /build="([^"]*)"/.exec(key)?.[1] ?? null : null;
}
const toolsCommit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const rulesFrom = (file) => { if (!file) return rulesWith(); try { return rulesWith(JSON.parse(readFileSync(file, 'utf8')).rules ?? {}); } catch (e) { throw new Error(`--rules ${file}: ${e.message}`); } };

async function main() {
  if (cmd === 'scenarios') {
    if (!opt('cost') || !opt('bench')) throw new Error('scenarios needs --cost <private cost file> and --bench <capacity-qualify artifact dir>');
    const worlds = opt('worlds', '10,50,100,200,400').split(',').map(Number); if (!worlds.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--worlds must be positive integers, e.g. 10,50');
    const s = scenarios(parseCost(readJson(opt('cost'), '--cost')), sizingFromBench(opt('bench')), worlds);
    process.stdout.write(flag('json') ? JSON.stringify(s, null, 1) + '\n' : scenariosText(s)); return;
  }
  const dir = opt('dir'); if (!dir) throw new Error('--dir <telemetry directory> is required');
  if (cmd === 'collect') {
    const url = opt('url'); if (!url || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url)) throw new Error('--url must be the launcher\'s loopback /__sim/metrics');
    const everyMs = num('every', DEFAULTS.everyMs / 1000) * 1000;
    const store = openStore(dir, { everyMs, fineDays: num('fine-days', DEFAULTS.fineDays), rollupDays: num('rollup-days', DEFAULTS.rollupDays), maxBytes: num('max-bytes', DEFAULTS.maxBytes) });
    try { store.close(Date.now()); } catch { store.state.loss.failedWrites++; }   // finish hours a previous run left open; never fatal
    if (flag('once')) { await scrapeOnce(store, url, { timeoutMs: Math.min(10_000, everyMs) }); store.saveState(); return; }
    const rules = flag('alerts') ? rulesFrom(opt('rules')) : null;   // read once: a bad rules file stops here, not mid-run
    let stop = false; const quit = () => { stop = true; }; process.on('SIGINT', quit); process.on('SIGTERM', quit);
    const t0 = Date.now(); let k = 0;
    while (!stop) {
      await scrapeOnce(store, url, { timeoutMs: Math.min(10_000, everyMs) });
      store.state.collector = { rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), at: Date.now(), everyMs };
      if (k === 0) store.saveState();
      if (rules) try { catchUp(dir, { rules, everyMs, lookbackMs: 3 * everyMs }); } catch { store.state.loss.failedWrites++; }   // alerts never stop the collector
      const next = t0 + ++k * everyMs; await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));   // fixed cadence: a slow scrape does not shift the grid
    }
    store.saveState(); return;
  }
  if (cmd === 'close') { const s = openStore(dir); s.close(Date.now()); return; }   // the collector's own options (state.json); do not run while it is collecting
  if (cmd === 'report') {
    const s = openStore(dir), r = report(dir, s.state, { range: opt('range', '24h'), everyMs: s.o.everyMs });
    process.stdout.write(flag('json') ? JSON.stringify(r, null, 1) + '\n' : text(r)); return;
  }
  if (cmd === 'alerts') {
    const s = openStore(dir), r = catchUp(dir, { rules: rulesFrom(opt('rules')), everyMs: s.o.everyMs });
    if (flag('json')) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); return; }
    const line = (e) => `${new Date(e.t).toISOString()} ${e.rule}${e.world ? ` ${e.world}` : ''}: ${e.from} -> ${e.to} (${e.what} ${e.value ?? 'missing'}, threshold ${e.threshold})`;
    process.stdout.write([`${r.rows} new row(s), ${r.events.length} transition(s)`, ...r.events.map(line),
      `open: ${r.open.length ? r.open.map((o) => `${o.rule}${o.world ? ` ${o.world}` : ''} ${o.state}`).join(', ') : 'none'}`, `not exported (unknown): ${r.notExported.join(', ')}`].join('\n') + '\n');
    return;
  }
  if (cmd === 'units') {
    if (!opt('cost')) throw new Error('--cost <private cost file> is required');
    const s = openStore(dir), r = report(dir, s.state, { range: opt('range', '24h'), everyMs: s.o.everyMs }), h = hoursFromReport(r, s.o.everyMs);
    const red = reduceRange(dir, s.state.types ?? {}, Date.parse(r.range.from), Date.parse(r.range.to), s.o.everyMs);
    const u = unitCosts(costFor(r, opt('cost'), s.o.everyMs), { worldHours: h.worldHours, soulHours: soulHours(r, s.o.everyMs), acts: acceptedActs(red) });
    process.stdout.write(JSON.stringify(u, null, 1) + '\n'); return;
  }
  if (cmd === 'cost' || cmd === 'packet') {
    const s = openStore(dir), r = report(dir, s.state, { range: opt('range', '24h'), everyMs: s.o.everyMs });
    if (cmd === 'cost' && !opt('cost')) throw new Error('--cost <private cost file> is required');
    const cost = opt('cost') ? costFor(r, opt('cost'), s.o.everyMs) : null;
    if (cmd === 'cost') { process.stdout.write(JSON.stringify(cost, null, 1) + '\n'); return; }
    let open = null, alertsThrough = null, alertsUnreadable = false; const af = join(dir, 'alerts-state.json');
    if (existsSync(af)) { try { const st = JSON.parse(readFileSync(af, 'utf8')); open = openAlerts(st); alertsThrough = st.lastT ?? null; } catch { alertsUnreadable = true; } }   // absent: alerts never evaluated here
    const b = opt('bench') ? sizingFromBench(opt('bench')) : null, capacity = b ? { verdict: b.verdict, qualifies: b.qualifies, run: b.source.run } : null;
    const p = packet({ r, open, alertsThrough, alertsUnreadable, cost, capacity, build: { launcher: launcherBuild(dir, Date.parse(r.range.from), Date.parse(r.range.to)), tools: toolsCommit() } });
    process.stdout.write(flag('json') ? JSON.stringify(p, null, 1) + '\n' : packetText(p)); return;
  }
  throw new Error('usage: telemetry.mjs collect|report|close|alerts|cost|packet|units|scenarios ...');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(`telemetry: ${e.message}`); process.exit(1); });
