// CW1 (#735): REPORT.md for one meetup run. The objectives are #443's initial qualification budgets, fixed before
// any run; a run labelled not-quiet (or any run off the qualifying executor) is indicative and never qualifies.
export const OBJECTIVES = Object.freeze({ readP95Ms: 250, readP99Ms: 1000, actStartP95Ms: 500, actStartP99Ms: 1000, deliveryP95Ms: 250, deliveryP99Ms: 1000, clockMin: 0.99 });

const f = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v));
const qs = (x) => (x?.n ? `${f(x.p50)} / ${f(x.p95)} / ${f(x.p99)}${x.p99Supported === false ? '*' : ''} / ${f(x.max)} (n ${x.n})` : '— (n 0)');
const mark = (ok) => (ok == null ? '—' : ok ? 'meets' : '**misses**');

export function report(receipt, r) {
  const L = [], O = OBJECTIVES, a = r.accounting, h = r.headline;
  L.push(`# Meetup workload: ${r.profile}, repeat ${r.rep}`, '');
  L.push(`${receipt.workload}, seed \`${receipt.seed}\`${receipt.short ? ', **short smoke** (not a measuring window)' : ''}. Source \`${receipt.source.sha?.slice(0, 12)}\`${receipt.source.dirty ? ' (dirty)' : ''}, Node ${receipt.source.node}, Soul CLI ${receipt.source.cliVersion}. Schedule sha256 \`${receipt.workloadDefinition.scheduleSha256.slice(0, 16)}\`.`, '');
  L.push(`**Measurement: ${receipt.measurement.label}, ${receipt.measurement.hostClass} (${receipt.host.cores} cores, ${receipt.host.memGb} GB). Indicative only; ${receipt.measurement.why}.** Host load before ${r.load.before.loadavg.join(' / ')}, after ${r.load.after.loadavg.join(' / ')}; other Souls server processes on the host ${r.load.otherSoulsProcessesBefore} before, ${r.load.otherSoulsProcessesAfter} after.`, '');
  L.push('## Against #443 objectives (indicative)', '', '| objective | budget | this run | |', '|---|---|---|---|');
  const rd = a['all|read']?.e2eMs ?? {}, st = r.actionStartMs.all ?? {}, dl = r.receiptDeliveryMs.all ?? {};
  L.push(`| read end-to-end p95 / p99 (from scheduled time) | ≤ ${O.readP95Ms} / ≤ ${O.readP99Ms} ms | ${f(rd.p95)} / ${f(rd.p99)} ms | ${mark(rd.n ? rd.p95 <= O.readP95Ms && rd.p99 <= O.readP99Ms : null)} |`);
  L.push(`| action start p95 / p99 (from scheduled time) | ≤ ${O.actStartP95Ms} / ≤ ${O.actStartP99Ms} ms | ${f(st.p95)} / ${f(st.p99)} ms | ${mark(st.n ? st.p95 <= O.actStartP95Ms && st.p99 <= O.actStartP99Ms && !h.actsWithoutStart : null)} |${h.actsWithoutStart ? ` (${h.actsWithoutStart} accepted acts never started)` : ''}`);
  L.push(`| receipt delivery p95 / p99 (after server time) | ≤ ${O.deliveryP95Ms} / ≤ ${O.deliveryP99Ms} ms | ${f(dl.p95)} / ${f(dl.p99)} ms | ${mark(dl.n ? dl.p95 <= O.deliveryP95Ms && dl.p99 <= O.deliveryP99Ms : null)} |`);
  L.push(`| full clock, every world, quiet and active | ≥ ${O.clockMin} | quiet ${f(h.clockMinQuiet, 3)}, active ${f(h.clockMinActive, 3)} | ${mark(h.clockMinQuiet >= O.clockMin && h.clockMinActive >= O.clockMin)} |`);
  L.push(`| load failures (incl. reactive), overdue, unissued (incl. reactive) | 0 | ${h.loadFailures}, ${h.overdue}, ${h.unissued + (h.reactiveUnissued ?? 0)}${h.unissuedJoinFailed ? ` (${h.unissuedJoinFailed} of them belong to Souls that failed to join)` : ''} | ${mark(h.loadFailures === 0 && h.overdue === 0 && h.unissued === 0 && !h.reactiveUnissued)} |`);
  L.push(`| restarts, paused or dilated samples | 0 | ${h.restarts}, ${r.pausedSamples}, ${r.dilatedSamples} | ${mark(h.restarts === 0 && r.pausedSamples === 0 && r.dilatedSamples === 0)} |`);
  L.push('', 'CPU and memory headroom (≥ 30 %) need the executor\'s entitlement and cgroup limits: #736.', '');
  L.push('## Offered demand and outcomes', '', 'Latency columns are p50 / p95 / p99 / max ms (n); `*` = p99 from fewer than 100 samples. End-to-end runs from the scheduled time; answered-only is diagnostic.', '');
  L.push('| group | offered | issued | unissued | overdue | load failures | outcomes | end-to-end | lateness at send | answered-only |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, x] of Object.entries(a)) L.push(`| ${k} | ${x.offered} | ${x.issued} | ${x.unissued} | ${x.overdue} | ${x.loadFailures} | ${Object.entries(x.outcomes).map(([o, n]) => `${o} ${n}`).join(', ')} | ${qs(x.e2eMs)} | ${qs(x.lateMs)} | ${qs(x.answeredOnlyServiceMs)} |`);
  const rx = r.reactiveDemand;
  if (rx) L.push('', `Reactive demand (accepting invitations from the event stream; not in the fixed schedule): offered ${rx.offered}, issued ${rx.issued}, unissued ${rx.unissued}, outcomes ${JSON.stringify(rx.outcomes)}, end-to-end from receipt of the invitation ${qs(rx.e2eMs)}, invitation delivery ${qs(rx.inviteDeliveryMs)}, refusal codes ${JSON.stringify(rx.gameplayCodes)}.`);
  L.push('', `Valid gameplay refusals (kept, not load failures): ${Object.entries(r.gameplayRefusals).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}. Busy answers seen (incl. ones the client then waited out): ${Object.entries(r.refusalTags).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`, '');
  L.push('## Actions and receipts', '', '| world | action start | receipt delivery | planned activity (travel etc., not delay) |', '|---|---|---|---|');
  for (const k of Object.keys(r.actionStartMs)) L.push(`| ${k} | ${qs(r.actionStartMs[k])} | ${qs(r.receiptDeliveryMs[k])} | ${qs(r.plannedActivityMs[k])} |`);
  if (r.sharedActionStartMs) L.push('', `Invitations (shared actions) start when the partner accepts, so their start is a social wait and is not in the action-start rows above: ${qs(r.sharedActionStartMs)}.`);
  L.push('', `Accepted acts with no start or end seen on the stream, by last phase: ${JSON.stringify(r.actsWithoutStart)}. Stream: ${r.stream.responses} responses, ${r.stream.events} events, events per non-empty batch ${qs(r.stream.batches)}, gaps ${r.stream.gaps}, failures ${r.stream.failures}, non-200 ${JSON.stringify(r.stream.non200)}.`, '');
  L.push('## Clock (actual ticks / due ticks at the admin rate, externally timed)', '', '| world | rate | quiet | active | meetups (10 s each) | max stall ms | max deficit ticks | healthz misses | levels after quiet start |', '|---|---|---|---|---|---|---|---|---|');
  for (const [w, c] of Object.entries(r.clock)) {
    const mt = Object.entries(c).filter(([n]) => n.startsWith('meetup')).map(([, x]) => f(x.ratio, 3)).join(' / ');
    L.push(`| ${w} | ${r.rates[w] ?? '—'} | ${f(c.quiet.ratio, 3)} ± ${f(c.quiet.ratioUncertainty, 3)} | ${f(c.active.ratio, 3)} ± ${f(c.active.ratioUncertainty, 3)} | ${mt} | ${f(Math.max(c.quiet.maxStallMs ?? 0, c.active.maxStallMs ?? 0))} | ${f(Math.max(c.quiet.maxDeficitTicks ?? 0, c.active.maxDeficitTicks ?? 0), 1)} | ${r.healthzMisses[w]} | ${JSON.stringify(r.levels[w])} |`);
  }
  L.push('', '## Resources (existing sources: process CPU/RSS, launcher health, /healthz)', '', '| world | quiet cores | active cores | RSS max MB (active) | pid changes | restarts |', '|---|---|---|---|---|---|');
  for (const w of Object.keys(r.clock)) L.push(`| ${w} | ${f(r.resources.quiet.worlds[w]?.cpuCores, 3)} | ${f(r.resources.active.worlds[w]?.cpuCores, 3)} | ${f(r.resources.active.worlds[w]?.rssMbMax)} | ${r.worldPidChanges[w]} | ${r.restarts[w]} |`);
  const A = r.resources.active;
  L.push('', `Launcher: ${f(A.launcherCpuCores, 3)} cores, RSS ${A.launcherRssMbMax} MB. Driver (this process, outside the worlds): ${f(A.driverCpuCores, 3)} cores, RSS ${A.driverRssMbMax} MB, event-loop delay p99 max ${A.driverLagP99MsMax} ms, max ${A.driverLagMaxMs} ms.`, '');
  L.push('## Join, viewers, browser, cleanup', '');
  L.push(`Joined ${h.joined}/50; join ms ${qs(r.join.ms)}; create retries ${r.join.retries}; failed joins ${r.join.failed.length}. Boot seconds per world ${JSON.stringify(r.bootS)}.`);
  L.push(`Viewers: ${Object.entries(r.viewers).map(([w, v]) => `${w} ${v.opens} open / ${v.closes} closed / ${Math.round(v.bytes / 1024)} KB`).join('; ')}.`);
  L.push(`Real browser: ${r.browser ? JSON.stringify(r.browser) : 'not run'}.`);
  L.push(`Cleanup: ${JSON.stringify(r.cleanup)}.`, '');
  L.push('## Coverage', '', ...Object.entries(receipt.coverage).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join('; ') : v}`), '');
  return L.join('\n') + '\n';
}
