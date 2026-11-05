// CW5 S3 (#739 A3): unit costs over the telemetry window and world-count scenarios from a measured bench. Pure apart
// from sizingFromBench, which reads a capacity-qualify artifact directory.
//
// Unit costs divide one numerator, the S2 window estimate over covered time (every platform item, shared fixed
// overhead included and stated), by three explicit denominators: running world-hours, active-Soul-hours and accepted
// acts. A missing denominator is unknown, a zero one has no unit cost; neither is ever 0 or inferred. Souls are not
// humans.
//
// Scenarios are cost projections, not capacities: the per-world footprint is the bench's measured mean, the host count
// keeps 30 % headroom, and every scenario carries the bench verdict. Only a `passes` verdict that qualifies drops the
// unqualified label, and only for rows at or below the world count the bench measured (larger rows extrapolate the
// per-world footprint). More hosts pack independent worlds without fixing a serialized hot world. A footprint the bench
// did not record is unknown (null), never 0. Amounts are per cost period (the cost file's billing period), not monthly.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labelsOf } from './prom.mjs';
import { view } from './reduce.mjs';

export const HEADROOM = 0.3, SCENARIO_WORLDS = Object.freeze([10, 50, 100, 200, 400]);
const HOUR = 3_600_000;
const r4 = (v) => (v == null ? null : Math.round(v * 10_000) / 10_000), r3 = (v) => (v == null ? null : Number(v.toFixed(3)));
const money = (v) => (v == null ? null : Math.round(v * 100) / 100);

/** Accepted acts in a reduction (reduceRange): the increase of sim_world_requests_total{class="act",outcome="completed"}
 *  (#737 S2: act requests answered below 400, not finished activities), summed over worlds; null when not exported. */
export function acceptedActs(red) {
  const xs = Object.entries(red?.series ?? {}).filter(([k]) => { const { name, labels } = labelsOf(k); return name === 'sim_world_requests_total' && labels.class === 'act' && labels.outcome === 'completed'; });
  return xs.length ? xs.reduce((n, [, s]) => n + (view(s)?.increase ?? 0), 0) : null;
}

/** Active-Soul-hours from a report: per world, mean sim_world_active_souls × that world's covered hours. null when no
 *  world exports the gauge. */
export function soulHours(r, everyMs) {
  const ws = Object.values(r.worlds).filter((w) => w.souls?.active?.mean != null);
  return ws.length ? ws.reduce((n, w) => n + w.souls.active.mean * (w.coverage.samples * everyMs) / HOUR, 0) : null;
}

/** cost: costReport() for the window; worldHours: {world: h}; soulHours, acts: numbers or null (unknown). */
export function unitCosts(cost, { worldHours = {}, soulHours: sh = null, acts = null }) {
  // the unrounded window estimate (costReport's `raw`) when given: dividing the 0.01-rounded amount loses precision
  const share = cost.allocated.coveredShare, est = cost.estimated.window, raw = est.raw ?? est.low;
  const num = { low: raw == null ? null : raw * share, high: est.high == null ? null : raw * share };
  const overhead = num.low > 0 ? r3(cost.allocated.sharedOverhead / num.low) : null;
  const per = (d, unit, why) => {
    if (d == null) return { unit, value: null, reason: why };
    if (!(d > 0)) return { unit, value: null, denominator: 0, reason: `no ${unit} in the covered window: no unit cost` };
    return { unit, low: r4(num.low / d), high: num.high == null ? null : r4(num.high / d), denominator: r3(d) };
  };
  const wh = Object.values(worldHours).reduce((n, h) => n + (h > 0 ? h : 0), 0);
  return {
    currency: cost.currency,
    numerator: { low: money(num.low), high: money(num.high), what: 'the S2 window estimate over covered time: every platform item, shared fixed overhead included',
      coveredShare: share, sharedFixedOverheadShare: overhead, unknown: cost.estimated.unknown,
      provenance: { window: cost.window, billingPeriod: cost.billingPeriod, rateSources: (cost.estimated.items ?? []).map((i) => ({ id: i.id, source: i.source ?? null, sourceDate: i.sourceDate ?? null })),
        note: 'configured rates prorated over the window, not invoices' } },
    perWorldHour: per(wh, 'world-hours', 'no running world-hours'),
    perActiveSoulHour: per(sh, 'active-Soul-hours', 'sim_world_active_souls is not exported in the window'),
    perAcceptedAct: per(acts, 'accepted acts', 'sim_world_requests_total{class="act",outcome="completed"} is not exported (#737 S2, #859); completed activities are not counted'),
    note: 'Souls are not humans; fixed rent does not fall with activity, so a lower unit cost at higher activity is not an invoice saving',
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The measured per-world footprint from a capacity-qualify artifact: <dir>/summary.json (verdict), optional
 *  qualify.json (run id) and <dir>/<profile>-r<n>/{result,receipt}.json. Means are over runs of the fleet mean per
 *  world; max is the largest single world. RSS is each world's maximum, so its sum is an upper bound. */
export function sizingFromBench(dir) {
  if (!existsSync(dir)) throw new Error(`--bench ${dir}: no such directory`);
  const summary = readJson(join(dir, 'summary.json')), q = readJson(join(dir, 'qualify.json'));
  const runs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ name: d.name, result: readJson(join(dir, d.name, 'result.json')), receipt: readJson(join(dir, d.name, 'receipt.json')) })).filter((x) => x.result?.resources);
  if (!runs.length) throw new Error(`--bench ${dir}: no <run>/result.json with resources`);
  // a phase or field a run did not record is left out, never counted as 0; with none at all the stat is null (unknown)
  const vals = (x, phase, k) => Object.values(x.result.resources[phase]?.worlds ?? {}).map((v) => v?.[k]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const fleet = (phase, k) => runs.map((x) => mean(vals(x, phase, k))).filter((v) => v != null);
  const top = (phase, k) => { const xs = runs.flatMap((x) => vals(x, phase, k)); return xs.length ? Math.max(...xs) : null; };
  const stat = (phase, k) => ({ mean: r3(mean(fleet(phase, k))), max: r3(top(phase, k)) });
  const worldsMeasured = Math.max(0, ...runs.map((x) => Object.keys(x.result.resources.active?.worlds ?? {}).length));
  const souls = runs.map((x) => { const f = x.receipt?.fixtures; return Array.isArray(f) && f.length ? f.reduce((n, w) => n + (w.souls ?? 0), 0) / f.length : null; }).filter((v) => v != null);
  const launcher = (k) => r3(mean(runs.map((x) => x.result.resources.active?.[k]).filter((v) => v != null)));
  return {
    source: { run: q?.workflowRun ?? null, commit: q?.commit ?? runs[0].receipt?.source?.sha ?? null, hostClass: q?.inputs?.hostClass ?? runs[0].receipt?.measurement?.hostClass ?? null, runs: runs.map((x) => x.name) },
    verdict: summary?.verdict?.verdict ?? 'unknown', qualifies: summary?.verdict?.qualifies === true, worldsMeasured: worldsMeasured || null,
    soulsPerWorld: souls.length ? r3(mean(souls)) : null,
    perWorld: { activeCores: stat('active', 'cpuCores'), quietCores: stat('quiet', 'cpuCores'), activeRssMb: stat('active', 'rssMbMax'), quietRssMb: stat('quiet', 'rssMbMax') },
    launcher: { cores: launcher('launcherCpuCores'), rssMb: launcher('launcherRssMbMax') },
  };
}

/** cost: parseCost(); sizing: sizingFromBench(); → one row per world count. */
export function scenarios(cost, sizing, worlds = SCENARIO_WORLDS, headroom = HEADROOM) {
  const platform = cost.items.filter((x) => x.payer === 'platform'), shaped = platform.filter((x) => x.kind === 'compute' && x.basis === 'fixed' && x.host);
  const host = shaped[0]?.host ?? null, hostAmount = shaped[0]?.amount ?? null;
  const others = platform.filter((x) => x !== shaped[0]), perPeriod = (x) => (x.basis === 'fixed' ? x.amount : x.rate == null || x.usage == null ? null : x.rate * x.usage);
  const otherKnown = others.reduce((n, x) => n + (perPeriod(x) ?? 0), 0), otherUnknown = others.filter((x) => perPeriod(x) == null).map((x) => x.id);
  const verdictQualifies = sizing.verdict === 'passes' && sizing.qualifies, measured = sizing.worldsMeasured ?? null;
  const pw = sizing.perWorld, lc = sizing.launcher.cores ?? 0, lm = (sizing.launcher.rssMb ?? 0) / 1024;
  const times = (n, v, d = 1) => (v == null ? null : r3((n * v) / d));
  const rows = worlds.map((n) => {
    const need = (cores, rssMb) => ({ cores: times(n, cores), memGiB: times(n, rssMb, 1024), withHeadroom: { cores: times(n, cores, 1 - headroom), memGiB: times(n, rssMb, 1024 * (1 - headroom)) } });
    const active = need(pw.activeCores.mean, pw.activeRssMb.mean), quiet = need(pw.quietCores.mean, pw.quietRssMb.mean);
    let hosts = null;
    if (host && pw.activeCores.mean != null && pw.activeRssMb.mean != null) {   // usable per host = (1 − headroom) of its shape, less one launcher
      const uc = host.cores * (1 - headroom) - lc, um = host.memGiB * (1 - headroom) - lm;
      hosts = uc > 0 && um > 0 ? Math.max(1, Math.ceil(Math.max((n * pw.activeCores.mean) / uc, (n * pw.activeRssMb.mean) / 1024 / um))) : null;
    }
    const compute = hosts == null || hostAmount == null ? null : hosts * hostAmount;
    // a passing verdict qualifies only what the bench measured: a larger row extrapolates the per-world footprint
    const qualified = verdictQualifies && measured != null && n <= measured;
    return { worlds: n, souls: sizing.soulsPerWorld == null ? null : Math.round(n * sizing.soulsPerWorld), active, quiet, hosts,
      perPeriod: { compute: money(compute), low: compute == null ? null : money(compute + otherKnown), high: compute == null || otherUnknown.length ? null : money(compute + otherKnown) },
      qualified, ...(verdictQualifies && !qualified ? { extrapolated: `per-world footprint measured at ${measured ?? 'an unknown number of'} worlds` } : {}) };
  });
  return {
    currency: cost.currency, period: { start: new Date(cost.period.start).toISOString(), end: new Date(cost.period.end).toISOString(), days: r3((cost.period.end - cost.period.start) / (24 * HOUR)) },
    amounts: 'perPeriod: per cost period (the cost file\'s billing period above), not normalised to a month', headroom,
    host: host ? { ...host, item: shaped[0].id, amount: hostAmount, source: shaped[0].source, sourceDate: shaped[0].sourceDate } : 'unknown: no fixed compute item has a host shape {cores, memGiB}',
    sizing,
    notScaled: [...others.filter((x) => x.basis === 'metered').map((x) => `${x.id}: not scaled (no per-world usage driver)`), ...others.filter((x) => x.basis === 'fixed').map((x) => `${x.id}: fixed, unchanged`)],
    unknown: otherUnknown.map((id) => `${id}: amount unknown`),
    external: cost.items.filter((x) => x.payer === 'owner').map((x) => x.id),
    rows,
    label: verdictQualifies ? `qualified by the bench verdict (passes, run ${sizing.source.run ?? 'unknown'}) for rows up to the ${measured ?? '?'} worlds it measured; larger rows extrapolate the per-world footprint and are unqualified`
      : `unqualified: the bench verdict is ${sizing.verdict}${sizing.source.run ? ` (run ${sizing.source.run})` : ''}. These are cost projections from measured activity, not capacities; hosts pack independent worlds but do not fix a serialized hot world`,
  };
}

/** A short text rendering of scenarios(). */
export function scenariosText(s) {
  const pw = s.sizing.perWorld, f = (v) => (v == null ? '—' : String(v)), pair = (x) => `${f(x.cores)}/${f(x.memGiB)} (${f(x.withHeadroom.cores)}/${f(x.withHeadroom.memGiB)})`;
  return [`scenarios (${s.currency}, ${s.period.start.slice(0, 10)}..${s.period.end.slice(0, 10)}): ${s.label}`,
    `measured per world (bench ${s.sizing.source.run ?? '?'}, ${s.sizing.source.hostClass ?? '?'}, ${s.sizing.worldsMeasured ?? '?'} worlds, ${s.sizing.soulsPerWorld ?? '?'} Souls/world): active ${f(pw.activeCores.mean)} cores (max ${f(pw.activeCores.max)}), ${f(pw.activeRssMb.mean)} MB (max ${f(pw.activeRssMb.max)}); quiet ${f(pw.quietCores.mean)} cores, ${f(pw.quietRssMb.mean)} MB`,
    `host ${typeof s.host === 'string' ? s.host : `${s.host.cores} cores / ${s.host.memGiB} GiB at ${s.host.amount} per period (${s.host.source})`}; headroom ${s.headroom * 100} %`,
    `worlds  souls  active cores/GiB (+headroom)   quiet cores/GiB (+headroom)  hosts  per period (${s.period.days} days) low..high`,
    ...s.rows.map((r) => [String(r.worlds).padStart(6), f(r.souls).padStart(6), pair(r.active).padStart(30), pair(r.quiet).padStart(29), f(r.hosts).padStart(6),
      `${f(r.perPeriod.low)}..${r.perPeriod.high ?? 'open'}`.padStart(18), r.qualified ? 'qualified' : r.extrapolated ? `extrapolated (${r.extrapolated})` : ''].join(' ').trimEnd()),
    ...s.notScaled.map((x) => `note: ${x}`), ...s.unknown.map((x) => `unknown: ${x}`), `external (owner-paid, not included): ${s.external.join(', ') || 'none'}`].join('\n') + '\n';
}
