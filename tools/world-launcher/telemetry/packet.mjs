// CW5 S2 (#739 A5): a concise context packet an operator or agent reads to answer "what is active, what does it cost,
// where is capacity tight, what next". Deterministic over the report, the saved alert state and the cost report; no
// model, no UI, no raw user content (world slugs and numbers only). With a cost file it also carries the operator's
// private cost figures, rate sources and build label: such a packet is marked private and is not for publication.
import { RULES } from './alerts.mjs';

export const PACKET_SCHEMA = 'sim-context-packet/1';
const GIB = 2 ** 30, ORDER = RULES.map((r) => r.id);
/** Saved alert state older than this before the window's end is stale: it cannot say what is firing now. */
export const ALERTS_STALE_MS = 5 * 60_000;

/** The worst world by loop then tick p99 maxima, or null. */
function worstWorld(r) {
  const rows = Object.entries(r.worlds).map(([w, x]) => ({ world: w, loopP99MaxS: x.loopDelayP99Seconds?.max ?? null, tickP99MaxS: x.tickP99Seconds?.max ?? null })).filter((x) => x.loopP99MaxS != null || x.tickP99MaxS != null);
  rows.sort((a, b) => (b.loopP99MaxS ?? 0) - (a.loopP99MaxS ?? 0) || (b.tickP99MaxS ?? 0) - (a.tickP99MaxS ?? 0) || a.world.localeCompare(b.world));
  return rows[0] ?? null;
}

/** The headroom qualification line: only a qualifying `passes` bench verdict (#736) is qualified. */
export function qualification(capacity) {
  if (!capacity) return 'unqualified (no capacity verdict given: --bench <capacity-qualify dir>)';
  const run = capacity.run ? ` (run ${capacity.run})` : '';
  return capacity.verdict === 'passes' && capacity.qualifies ? `qualified: the bench verdict passes${run}` : `unqualified: the bench verdict is ${capacity.verdict}${run}`;
}

/** r: report() output; open: alerts open() list or null (not evaluated); alertsThrough: the saved state's last evaluated
 *  row time (ms), null when it has none, or left out when the caller vouches it is current; alertsUnreadable: the state file exists but could not be read; cost: costReport() or null;
 *  build: {launcher, tools}; capacity: {verdict, qualifies, run} from the #736 bench (units.mjs sizingFromBench) or null. */
export function packet({ r, open: given = null, alertsThrough, alertsUnreadable = false, cost = null, build = {}, capacity = null }) {
  const qualified = qualification(capacity), end = Date.parse(r.range?.to);
  // a stale or unreadable state never reads as "0 firing": it is reported as such and treated as not evaluated
  // (alertsThrough left out: the caller vouches the state is current, as tests that evaluate in place do)
  const stale = given != null && alertsThrough !== undefined && Number.isFinite(end) && (alertsThrough == null || end - alertsThrough > ALERTS_STALE_MS);
  const open = alertsUnreadable || stale ? null : given;
  const firing = (open ?? []).filter((o) => o.state === 'firing').sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || String(a.world ?? '').localeCompare(String(b.world ?? '')));
  const unknown = (open ?? []).filter((o) => o.state === 'unknown');
  const worst = worstWorld(r), memMin = r.fleet.hostMemAvailableBytes?.min ?? null;
  const bottleneck = firing.length ? { from: 'alerts', rule: firing[0].rule, ...(firing[0].world ? { world: firing[0].world } : {}), alsoFiring: firing.length - 1 }
    : worst ? { from: 'report maxima (no alert firing)', ...worst } : { from: 'none', note: 'no world reported loop or tick timing in the window' };
  const coverage = r.coverage.share;
  let next;
  if (open == null) next = `${alertsUnreadable ? 'alerts-state.json is unreadable: re-evaluate' : stale ? 'the saved alert state is stale: re-evaluate' : 'evaluate'} alerts (telemetry.mjs alerts, or collect --alerts) so the packet can name what is firing`;
  else if (coverage < 0.9 || firing.some((f) => f.rule === 'telemetry-gap')) next = `restore telemetry coverage (${Math.round(coverage * 100)} % of samples in the window) before any capacity decision`;
  else if (firing.length) next = `investigate ${firing[0].rule}${firing[0].world ? ` on ${firing[0].world}` : ''}: a software bottleneck or the allocation? The meetup bench verdict (#736) decides before any hardware change`;
  else if (unknown.length) next = `export the missing series (${[...new Set(unknown.map((u) => u.rule))].join(', ')} unknown) so the alerts can judge them`;
  else if (memMin != null && memMin < 1.5 * GIB) next = `host memory went down to ${(memMin / GIB).toFixed(2)} GiB available: review world heap limits or the running cap before adding worlds`;
  else next = `no capacity action indicated; headroom ${qualified}`;
  return {
    schema: PACKET_SCHEMA, ...(cost ? { private: 'carries the operator\'s cost figures, rate sources and build label: do not publish' } : {}),
    source: { launcherBuild: build.launcher ?? 'unknown', toolsCommit: build.tools ?? 'unknown' },
    window: { ...r.range, coverage: { share: coverage, samples: r.coverage.samples, expected: r.coverage.expected, gaps: r.coverage.gaps } },
    active: { worldsRunningMean: r.fleet.worldsRunning?.mean ?? null, worldsRunningMax: r.fleet.worldsRunning?.max ?? null, soulsActiveMeanTotal: r.fleet.soulsActive?.meanTotal ?? null },
    bottleneck,
    alerts: alertsUnreadable ? 'not evaluated (alerts-state.json unreadable)' : stale ? `stale (evaluated through ${alertsThrough == null ? 'unknown' : new Date(alertsThrough).toISOString()}, window ends ${r.range.to})` : open == null ? 'not evaluated' : { firing: firing.length, unknown: unknown.length },
    cost: cost ? { currency: cost.currency, billed: cost.billed.amount, billedPeriods: [...new Set(cost.billed.entries.filter((b) => b.amount != null).map((b) => `${b.period.start.slice(0, 10)}..${b.period.end.slice(0, 10)}`))].sort(), billedCoverage: cost.billed.coverage, estimatedWindow: cost.estimated.window, estimatedBillingPeriod: cost.estimated.billingPeriod,
      unknown: cost.estimated.unknown, rateSources: cost.estimated.items.map((i) => `${i.id}: ${i.source}${i.sourceDate ? ` (${i.sourceDate})` : ''}`), external: cost.external.map((e) => `${e.id}: ${e.perPeriod}`) } : 'no cost file given',
    headroom: { hostMemAvailableMinGiB: memMin == null ? 'unknown' : Number((memMin / GIB).toFixed(2)), cpu: 'unknown (process and cgroup CPU are not exported)', qualified },
    next,
  };
}

/** A short text rendering. */
export function packetText(p) {
  const c = p.cost === 'no cost file given' ? p.cost : `${p.cost.currency} billed ${p.cost.billed == null ? 'none recorded' : `${p.cost.billed} (invoice period ${p.cost.billedPeriods.join(', ')}, not prorated to the window)`}; estimated window ${p.cost.estimatedWindow.low}..${p.cost.estimatedWindow.high ?? 'open'}, billing period ${p.cost.estimatedBillingPeriod.low}..${p.cost.estimatedBillingPeriod.high ?? 'open'}${p.cost.unknown.length ? `; unknown: ${p.cost.unknown.join(', ')}` : ''}; sources: ${p.cost.rateSources.join('; ')}; external: ${p.cost.external.join(', ')}`;
  const b = p.bottleneck;
  return [`context packet (${p.schema})${p.private ? ` PRIVATE: ${p.private}` : ''}`,
    `source     launcher ${p.source.launcherBuild}, tools ${p.source.toolsCommit}`,
    `window     ${p.window.from} .. ${p.window.to}, coverage ${Math.round(p.window.coverage.share * 100)} % (${p.window.coverage.samples}/${p.window.coverage.expected}, ${p.window.coverage.gaps} gaps)`,
    `active     worlds running mean ${p.active.worldsRunningMean ?? '—'} max ${p.active.worldsRunningMax ?? '—'}, Souls active mean total ${p.active.soulsActiveMeanTotal ?? '—'}`,
    `bottleneck ${b.from === 'alerts' ? `${b.rule}${b.world ? ` on ${b.world}` : ''} firing (+${b.alsoFiring} more)` : b.world ? `${b.world}: loop p99 max ${b.loopP99MaxS ?? '—'} s, tick p99 max ${b.tickP99MaxS ?? '—'} s (${b.from})` : b.note}`,
    `alerts     ${typeof p.alerts === 'string' ? p.alerts : `${p.alerts.firing} firing, ${p.alerts.unknown} unknown`}`,
    `cost       ${c}`,
    `headroom   host memory min ${typeof p.headroom.hostMemAvailableMinGiB === 'number' ? `${p.headroom.hostMemAvailableMinGiB} GiB` : 'unknown'}; cpu ${p.headroom.cpu}; ${p.headroom.qualified}`,
    `next       ${p.next}`].join('\n') + '\n';
}
