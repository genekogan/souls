// CW2 (#736) A3–A5: the compact verdict over a set of meetup runs, applying #443's objectives as written. Pure.
// passes | insufficient resources | software bottleneck | inconclusive. A run that cannot qualify (not quiet, short,
// off the qualifying executor, missing a profile or a repeat, allocation unknown) can never make it `passes`; a
// failing run is still evidence and can name the bottleneck.
export const HEADROOM = 0.3, HOT_CORE = 0.9, REPEATS = 2, PROFILES = ['even', 'meetup'];

/** Allocation headroom during the active window. capacity = cgroup quota in cores, else the cpuset or host cores.
 *  used = the worlds' and launcher's CPU (the driver runs outside the allocation on the executor). */
export function headroom({ quotaCores = null, cpusetCores = null, hostCores, usedCores, memMaxMb = null, memPeakMb = null }) {
  const capacity = quotaCores ?? cpusetCores ?? hostCores ?? null;
  return {
    cpuCapacityCores: capacity, cpuCapacityFrom: quotaCores != null ? 'cgroup cpu.max' : cpusetCores != null ? 'cpuset' : 'host cores',
    cpu: capacity && usedCores != null ? +(1 - usedCores / capacity).toFixed(3) : null,
    memory: memMaxMb != null && memMaxMb !== 'max' && memPeakMb != null ? +(1 - memPeakMb / memMaxMb).toFixed(3) : null,
  };
}

/** runs: [{profile, rep, failed?, qualifying: {executor, quiet, short}, objectives: {name: bool}, headroom: {cpu, memory},
 *  swapPeakMb, stealShare, throttledPeriodShare, worlds: {slug: {hottestCores, met: bool}}}] → {verdict, reasons[], ...}. */
export function verdict(runs) {
  const reasons = [], missing = [];
  for (const p of PROFILES) { const n = runs.filter((r) => r.profile === p && !r.failed).length; if (n < REPEATS) missing.push(`${p}: ${n}/${REPEATS} completed repeats`); }
  const failed = runs.filter((r) => r.failed), ok = runs.filter((r) => !r.failed);
  const notQualifying = ok.filter((r) => !r.qualifying?.executor || !r.qualifying?.quiet || r.qualifying?.short);
  const missed = ok.flatMap((r) => Object.entries(r.objectives ?? {}).filter(([, v]) => v === false).map(([k]) => `${r.profile} r${r.rep}: ${k}`));
  const unknown = ok.filter((r) => r.headroom?.cpu == null || r.headroom?.memory == null).map((r) => `${r.profile} r${r.rep}`);
  const lowHeadroom = ok.filter((r) => (r.headroom?.cpu ?? 1) < HEADROOM || (r.headroom?.memory ?? 1) < HEADROOM || (r.swapPeakMb ?? 0) > 0 || (r.throttledPeriodShare ?? 0) > 0.05 || (r.stealShare ?? 0) > 0.05);
  const hot = ok.flatMap((r) => Object.entries(r.worlds ?? {}).filter(([, w]) => w.met === false && (w.hottestCores ?? 0) >= HOT_CORE).map(([s, w]) => `${r.profile} r${r.rep} ${s} (${w.hottestCores} core)`));
  const missedWithRoom = ok.some((r) => Object.values(r.objectives ?? {}).includes(false) && (r.headroom?.cpu ?? 0) >= HEADROOM && (r.headroom?.memory ?? 0) >= HEADROOM);
  if (failed.length) reasons.push(`${failed.length} run(s) failed before a measuring window: ${failed.map((r) => `${r.profile} r${r.rep}`).join(', ')}`);
  if (missed.length) reasons.push(`objectives missed: ${missed.join('; ')}`);
  if (hot.length) reasons.push(`serialized hot world(s) with a thread at ≥ ${HOT_CORE} core while missing: ${hot.join('; ')}`);
  if (lowHeadroom.length) reasons.push(`below ${HEADROOM * 100} % headroom, swapping, throttled or stolen: ${lowHeadroom.map((r) => `${r.profile} r${r.rep}`).join(', ')}`);
  let v;
  if (missed.length && (hot.length || (missedWithRoom && !lowHeadroom.length))) v = 'software bottleneck';
  else if (missed.length && lowHeadroom.length) v = 'insufficient resources';
  else if (failed.length || missing.length || notQualifying.length || unknown.length || missed.length) v = 'inconclusive';
  else v = lowHeadroom.length ? 'insufficient resources' : 'passes';
  const qualifies = v === 'passes' || (!notQualifying.length && !missing.length && !unknown.length);
  if (missing.length) reasons.push(`incomplete matrix: ${missing.join('; ')}`);
  if (notQualifying.length) reasons.push(`not qualifying (laptop, not quiet, short or off the executor): ${notQualifying.map((r) => `${r.profile} r${r.rep}`).join(', ')}`);
  if (unknown.length) reasons.push(`allocation unknown (no cgroup v2 limits): ${unknown.join(', ')}`);
  return { verdict: v, qualifies, indicativeOnly: !qualifies, reasons };
}
