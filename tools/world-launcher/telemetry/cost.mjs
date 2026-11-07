// CW5 S2 (#739 A1–A3): cost provenance over the telemetry window. Pure. The cost file is the operator's private record
// (real rates and invoices never enter the repository); cost.example.json shows the format with placeholder numbers.
//
// Three numbers, never summed into one:
//   billed     actual invoice amounts the file records, for billing periods that overlap the window
//   estimated  configured rates prorated over the window and projected over the billing period, as a low/high range
//              (an unknown rate or usage leaves the high end open, never 0)
//   allocated  the window's known estimate split by a stated rule: covered time by running world-hours; covered time
//              with no world running is shared fixed overhead; uncovered time stays unallocated
// Fixed rent stays fixed whatever the activity: an allocation moves cost between workloads, it never saves an invoice.
export const COST_SCHEMA = 'sim-cost/1';
export const KINDS = ['compute', 'storage', 'backups', 'bandwidth', 'cdn', 'auth', 'model', 'render', 'other'];
const DAY = 86_400_000, HOUR = 3_600_000;
const money = (v) => (v == null ? null : Math.round(v * 100) / 100);
const date = (v, f) => { const t = Date.parse(`${v}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || !Number.isFinite(t)) throw new Error(`cost: ${f} must be YYYY-MM-DD`); return t; };
const nonneg = (v, f) => { if (v == null) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`cost: ${f} must be a number >= 0 or null (unknown)`); return v; };
const span = (p, f) => { const start = date(p?.start, `${f}.start`), end = date(p?.end, `${f}.end`); if (end <= start) throw new Error(`cost: ${f}.end must be after ${f}.start`); return { start, end }; };

/** Validate a sim-cost/1 object; throws naming the field. */
export function parseCost(o) {
  if (o?.schema !== COST_SCHEMA) throw new Error(`cost: schema must be ${COST_SCHEMA}`);
  if (!/^[A-Z]{3}$/.test(o.currency ?? '')) throw new Error('cost: currency must be an ISO 4217 code such as EUR');
  const period = span(o.period, 'period'), ids = new Set();
  if (!Array.isArray(o.items)) throw new Error('cost: items must be a list');
  const items = o.items.map((x, i) => {
    const f = `items[${i}]`;
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(x?.id ?? '') || ids.has(x.id)) throw new Error(`cost: ${f}.id must be a unique short id`); ids.add(x.id);
    if (!KINDS.includes(x.kind)) throw new Error(`cost: ${f}.kind must be one of ${KINDS.join(', ')}`);
    const payer = x.payer ?? 'platform'; if (!['platform', 'owner'].includes(payer)) throw new Error(`cost: ${f}.payer must be platform or owner`);
    if (!['fixed', 'metered'].includes(x.basis)) throw new Error(`cost: ${f}.basis must be fixed or metered`);
    if (typeof x.source !== 'string' || !x.source) throw new Error(`cost: ${f}.source must say where the rate comes from`);
    const sourceDate = x.sourceDate == null ? null : (date(x.sourceDate, `${f}.sourceDate`), x.sourceDate);
    const billed = (x.billed ?? []).map((b, j) => ({ ...span(b.period, `${f}.billed[${j}].period`), amount: nonneg(b.amount, `${f}.billed[${j}].amount`) }));
    return x.basis === 'fixed'
      ? { id: x.id, kind: x.kind, payer, basis: 'fixed', amount: nonneg(x.amount, `${f}.amount`), source: x.source, sourceDate, billed }
      : { id: x.id, kind: x.kind, payer, basis: 'metered', rate: nonneg(x.rate, `${f}.rate`), unit: String(x.unit ?? 'unit'), usage: nonneg(x.usage, `${f}.usage`), source: x.source, sourceDate, billed };
  });
  return { currency: o.currency, period, items };
}

const strip = ({ raw, ...x }) => x;
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const iso = (t) => new Date(t).toISOString();

/** cost (parseCost), window [from, to), telemetry: {coveredHours, busyHours (covered time with ≥ 1 world running), worldHours}. */
export function costReport(cost, { from, to, coveredHours = 0, busyHours = null, worldHours = {} }) {
  const P = cost.period, periodMs = P.end - P.start, inWindow = overlap(from, to, P.start, P.end), share = inWindow / periodMs;
  const platform = cost.items.filter((x) => x.payer === 'platform'), owner = cost.items.filter((x) => x.payer === 'owner');
  const perPeriod = (x) => (x.basis === 'fixed' ? x.amount : x.rate == null || x.usage == null ? null : x.rate * x.usage);
  const why = (x) => (x.basis === 'fixed' ? (x.amount == null ? 'amount unknown' : null) : x.rate == null ? 'rate unknown' : x.usage == null ? 'usage unknown' : null);
  const rows = platform.map((x) => ({ id: x.id, kind: x.kind, basis: x.basis, period: money(perPeriod(x)), window: perPeriod(x) == null ? null : money(perPeriod(x) * share), source: x.source, sourceDate: x.sourceDate, ...(why(x) ? { unknown: why(x) } : {}) }));
  const raw = platform.map(perPeriod), unknown = rows.filter((r) => r.period == null).map((r) => `${r.id}: ${r.unknown}`);
  const range = (k) => { const low = raw.reduce((n, v) => n + (v ?? 0) * (k === 'window' ? share : 1), 0); return { low: money(low), high: unknown.length ? null : money(low), raw: low }; };

  const billedEntries = platform.flatMap((x) => x.billed.filter((b) => overlap(from, to, b.start, b.end) > 0).map((b) => ({ id: x.id, period: { start: iso(b.start), end: iso(b.end) }, amount: b.amount })));
  const billedKnown = billedEntries.filter((b) => b.amount != null);

  // allocation over the window's known estimate
  const windowHours = (to - from) / HOUR, covered = Math.min(coveredHours, windowHours), est = range('window').raw;
  const coveredShare = windowHours > 0 ? covered / windowHours : 0, allocatable = est * coveredShare;
  const hours = Object.entries(worldHours).filter(([, h]) => h > 0), totalWorldHours = hours.reduce((n, [, h]) => n + h, 0);
  const busy = busyHours ?? Math.max(0, ...hours.map(([, h]) => h)), busyShare = covered > 0 ? Math.min(1, busy / covered) : 0;
  const toWorlds = totalWorldHours > 0 ? allocatable * busyShare : 0;
  const allocated = {
    rule: 'covered time is split across worlds by running world-hours; covered time with no world running is shared fixed overhead; uncovered time is unallocated',
    basis: 'the known part of the window estimate (low end)',
    byWorld: Object.fromEntries(hours.map(([w, h]) => [w, { worldHours: Number(h.toFixed(3)), amount: money(toWorlds * (h / totalWorldHours)) }])),
    sharedOverhead: money(allocatable - toWorlds), unallocated: money(est - allocatable), coveredShare: Number(coveredShare.toFixed(3)),
    note: 'allocated amounts move cost between workloads; fixed rent stays fixed when activity drops, so an allocated saving is not an invoice saving',
  };
  return {
    currency: cost.currency,
    billingPeriod: { start: iso(P.start), end: iso(P.end) },
    window: { from: iso(from), to: iso(to), shareOfBillingPeriod: Number(share.toFixed(4)), ...(inWindow < to - from ? { outsideBillingPeriodHours: Number(((to - from - inWindow) / HOUR).toFixed(2)) } : {}) },
    billed: { amount: billedKnown.length ? money(billedKnown.reduce((n, b) => n + b.amount, 0)) : null, entries: billedEntries, coverage: `${new Set(billedKnown.map((b) => b.id)).size} of ${platform.length} platform items have a billed amount for a period overlapping the window` },
    estimated: { window: strip(range('window')), billingPeriod: strip(range('period')), items: rows, unknown, note: 'configured rates, not invoices; high is null (open) while any rate or usage is unknown' },
    allocated,
    external: [...owner.map((x) => ({ id: x.id, kind: x.kind, payer: 'owner', perPeriod: perPeriod(x) == null ? 'unknown' : money(perPeriod(x)) })),
      ...(owner.some((x) => x.kind === 'model') ? [] : [{ id: 'owner-agent-inference', kind: 'model', payer: 'owner', perPeriod: 'unknown' }])],
    externalNote: 'owner-paid costs (agent inference at the edge) are outside platform spend and never included above',
  };
}

/** World running hours and covered hours from a telemetry report (report.mjs): status share × covered time. */
// Busy time (≥ 1 world running): all of it when the fleet never dropped to 0 running, none when it never rose above 0,
// otherwise the longest single world's running time (a lower bound; the rest counts as overhead).
export function hoursFromReport(r, everyMs) {
  const coveredHours = (r.coverage.samples * everyMs) / HOUR;
  const worldHours = Object.fromEntries(Object.entries(r.worlds).map(([w, x]) => [w, ((x.status?.running ?? 0) * (x.coverage.samples * everyMs)) / HOUR]));
  const wr = r.fleet?.worldsRunning, longest = Math.max(0, ...Object.values(worldHours));
  const busyHours = wr?.min >= 1 ? coveredHours : wr?.max === 0 ? 0 : longest;
  return { coveredHours, busyHours, worldHours, busyFrom: wr?.min >= 1 ? 'fleet never idle' : wr?.max === 0 ? 'no world ran' : 'lower bound: the longest-running world' };
}
export { DAY };
