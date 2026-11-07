// CW7 (#741): the slopes bench's pure parts: its arms, the reduction of a run's raw records and samples, CPU-profile
// summaries, the slopes across arms and REPORT.md. No I/O, no clock. slopes.mjs runs the arms; slopes.test.mjs pins them.
import { DEMAND, quantiles, rng } from '../meetup/workload.mjs';

// /2 (#951): the active window's plan is seeded by the repeat, not the arm (activePlan below)
export const SLOPES = 'cw7-slopes/2';

// Three orthogonal axes, not a sweep. Each arm: placed objects in the designated world (null = the template as
// authored), registered and active Souls in it, and quiet worlds ticking beside it (CW1 fixtures 1..n, no Souls).
export const AXES = Object.freeze({
  inventory: Object.freeze([{ id: 'inv5000', placed: 5000, registered: 5, active: 5, quiet: 0 }, { id: 'inv10000', placed: 10000, registered: 5, active: 5, quiet: 0 }]),
  activity: Object.freeze([{ id: 'act0', placed: null, registered: 10, active: 0, quiet: 0 }, { id: 'act5', placed: null, registered: 10, active: 5, quiet: 0 }, { id: 'act10', placed: null, registered: 10, active: 10, quiet: 0 }]),
  quiet: Object.freeze([{ id: 'quiet1', placed: null, registered: 5, active: 5, quiet: 0 }, { id: 'quiet10', placed: null, registered: 5, active: 5, quiet: 9 }]),
});

// The per-route probe (serial, rotating over the registered Souls, nothing else active) and the active window's per-Soul demand: CW1's rates
// (a read every 4 s, an act every 20 s, one call at a time) with acts that never move a Soul, so the neighbourhood
// stays the same in every arm. Walk planning (#454) is not exercised here.
export const PROBE_ROUTES = Object.freeze(['here', 'observe', 'capabilities', 'resolve', 'act']);
export const ACTS = Object.freeze(['look left', 'wave', 'say', 'look right', 'nod', 'say']);

// The active window's plan: per Soul, a read every 4 s and an act every 20 s from seeded offsets. The demand is strictly
// periodic, so a Soul's phase against the others holds for the whole window and decides how often its calls queue
// behind another Soul's (#951). The seed is the bench version and the repeat, never the arm: within a repeat every arm
// replays the same schedule for its first k Souls (arms are compared on the same phases), and repeats sample different
// phases. Seeded by arm (cw7-slopes/1), quiet10 packed all five Souls' reads into 784 ms of every period and quiet1 none.
export const planSeed = (rep) => `${SLOPES}|r${rep}`;
/** [soul] → its ops [{at ms from the window start, route, n?}], sorted by time. Pure: the same seed gives the same plan. */
export function activePlan(seed, souls, activeMs) {
  const R = rng(seed);
  return Array.from({ length: souls }, () => {
    const ops = [], ro = R() * DEMAND.readEveryMs, ao = R() * DEMAND.actEveryMs; let n = Math.floor(R() * DEMAND.readMix.length);
    for (let t = ro; t < activeMs; t += DEMAND.readEveryMs) ops.push({ at: t, route: DEMAND.readMix[n++ % DEMAND.readMix.length] });
    for (let t = ao, k = 0; t < activeMs; t += DEMAND.actEveryMs) ops.push({ at: t, route: 'act', n: k++ });
    return ops.sort((a, b) => a.at - b.at);
  });
}
/** A read is crowded when another Soul's call was scheduled less than this before it: it may wait for that call's turn.
 *  An indicator of bunching, not of waiting: it looks back only CROWD_MS, so a queue chain (reads 300+ ms apart, each
 *  still waiting on the earlier ones' frame credit) is not counted. */
export const CROWD_MS = 300;
/** How bursty a plan is: each Soul's read phase within the read period, and the share of reads that are crowded. */
export function scheduleFacts(plan, seed) {
  const all = plan.flatMap((ops, i) => ops.map((o) => ({ at: o.at, read: o.route !== 'act', i }))).sort((a, b) => a.at - b.at);
  let reads = 0, crowded = 0;
  for (let j = 0; j < all.length; j++) {
    if (!all[j].read) continue; reads++;
    for (let q = j - 1; q >= 0 && all[j].at - all[q].at < CROWD_MS; q--) if (all[q].i !== all[j].i) { crowded++; break; }
  }
  return { seed, readPhasesMs: plan.map((ops) => { const x = ops.find((o) => o.route !== 'act'); return x ? Math.round(x.at % DEMAND.readEveryMs) : null; }), crowdedReadFrac: reads ? +(crowded / reads).toFixed(2) : null };
}

/** Process CPU cores between two proc samples ({t ms, cpuS}). */
export const cores = (a, b) => (a && b && b.t > a.t && a.cpuS != null && b.cpuS != null ? (b.cpuS - a.cpuS) / ((b.t - a.t) / 1000) : null);
const r = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

// CPU seconds over a span net of the quiet rate; below the quiet rate it is unknown (null), never a negative cost.
const netCpuS = (cpuS, spanMs, quietCores) => { if (cpuS == null || quietCores == null || spanMs == null) return null; const x = cpuS - (quietCores * spanMs) / 1000; return x < 0 ? null : x; };

/** One probe route: calls [{ms, bytes, status}] and the CPU seconds the world used over the route's span, minus the quiet
 *  rate over that span. → per-call CPU-ms (an upper bound: tick variation and the hub are inside it). */
export function probeRoute(calls, { cpuS, spanMs, quietCores }) {
  const ok = calls.filter((c) => c.status >= 200 && c.status < 300), q = quantiles(ok.map((c) => c.ms));
  const extra = netCpuS(cpuS, spanMs, quietCores);
  const waits = calls.reduce((m, c) => m + (c.busyWaits ?? 0), 0);
  return { n: calls.length, ok: ok.length, ...(waits ? { busyWaits: waits } : {}), cpuMsPerCall: ok.length && extra != null ? r(1000 * extra / ok.length) : null, p50Ms: q.p50 ?? null, p95Ms: q.p95 ?? null, bytesMean: ok.length ? Math.round(ok.reduce((s, c) => s + c.bytes, 0) / ok.length) : null };
}

/** The active window's calls ({route, ms, lateMs, bytes, status, outcome}) → per-route latency and the CPU per served call. */
export function activeWindow(calls, { cpuS, spanMs, quietCores, offered }) {
  const served = calls.filter((c) => c.outcome === 'ok' || c.outcome === 'gameplay-refused'), routes = {};
  for (const c of calls) (routes[c.route] ??= []).push(c);
  const extra = netCpuS(cpuS, spanMs, quietCores);
  return {
    offered, issued: calls.length, busyWaits: calls.reduce((m, c) => m + (c.busyWaits ?? 0), 0), refusals: calls.flatMap((c) => c.refusals ?? []).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}), unissued: offered - calls.length, served: served.length,
    outcomes: calls.reduce((m, c) => ({ ...m, [c.outcome]: (m[c.outcome] ?? 0) + 1 }), {}),
    servedPerS: r(served.length / (spanMs / 1000), 2), cpuMsPerServed: served.length && extra != null ? r(1000 * extra / served.length) : null,
    endToEnd: (({ n, p50, p95, max }) => ({ n, p50, p95, max }))(quantiles(calls.map((c) => c.ms + c.lateMs))),
    byRoute: Object.fromEntries(Object.entries(routes).sort().map(([k, cs]) => { const q = quantiles(cs.filter((c) => c.outcome === 'ok').map((c) => c.ms)); return [k, { n: cs.length, p50Ms: q.p50 ?? null, p95Ms: q.p95 ?? null, bytesMean: Math.round(cs.reduce((s, c) => s + c.bytes, 0) / cs.length) }]; })),
  };
}

/** live.json samples (LOAD-CONTRACT §4) over a window → the maxima and means a slope needs. */
export function liveWindow(samples) {
  const v = (f) => samples.map(f).filter((x) => typeof x === 'number' && Number.isFinite(x)), max = (xs) => (xs.length ? Math.max(...xs) : null), mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { samples: samples.length, tickP99MsMax: max(v((s) => s.tick?.p99Ms)), loopP99MsMax: max(v((s) => s.loop?.delayP99Ms)), eluMean: r(mean(v((s) => s.loop?.elu)), 3), heapUsedMbMax: r(max(v((s) => s.heap?.usedMb)), 0),
    queueDepthMax: max(v((s) => s.queue?.depth)), awakeMean: r(mean(v((s) => s.souls?.awake)), 1), levels: samples.reduce((m, s) => (s.level ? { ...m, [s.level]: (m[s.level] ?? 0) + 1 } : m), {}) };
}

// Paths named in a decision, kept by inclusive time whatever their rank: a top-15 list cannot show a mid-tree path's share
// (the first qualifying run, 41972880510, could not confirm #912's `goal()` share for that reason). Matched on the
// function name and the file it is in.
export const WATCH = Object.freeze([
  ['bindsCoreIn', 'apps/server/src/edge/ledger/ledger.ts'], ['pumpFrame', 'apps/server/src/world.ts'],
  ['capabilities', 'apps/server/src/god/nav.ts'], ['offerWalk', 'apps/server/src/god/nav.ts'], ['goal', 'apps/server/src/god/nav.ts'],
  ['standableNearV1', 'packages/engine-mars/src/engine.ts'], ['navScan', 'mars/viewer/engine/spatial/service.ts'],
  ['heldGodThing', 'apps/server/src/god/held.ts'], ['outdoorRegionExclusions', 'apps/server/src/edge/ledger/region-arrival.ts'],
]);

/** A V8 .cpuprofile → sampled ms, the top self-time and inclusive functions, and the WATCH paths' inclusive time (0 when
 *  never sampled). File paths are made relative to `root`; Node's own and anonymous frames are kept under their names. */
export function summarizeProfile(p, root = '', top = 15, watch = WATCH) {
  if (!p?.nodes?.length) return null;
  const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map(), self = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  (p.samples ?? []).forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas?.[i] ?? 0) / 1000));
  const keyOf = (n) => { const f = n.callFrame, u = String(f.url ?? '').replace(/^file:\/\//, ''), file = root && u.startsWith(root) ? u.slice(root.length).replace(/^\//, '') : u; return `${f.functionName || '(anonymous)'} ${file ? `${file}:${f.lineNumber + 1}` : ''}`.trim(); };
  const selfBy = new Map(), inclBy = new Map(), watchBy = new Map(watch.map(([name, file]) => [`${name} ${file}`, 0]));
  let total = 0, idle = 0;
  for (const [id, ms] of self) {
    const n = byId.get(id); total += ms; const k = keyOf(n); if (/^\((idle|program|garbage collector)\)/.test(k)) { if (k.startsWith('(idle)')) idle += ms; }
    selfBy.set(k, (selfBy.get(k) ?? 0) + ms);
    const seen = new Set(), wseen = new Set();
    for (let x = id; x != null; x = parent.get(x)) {
      const kk = keyOf(byId.get(x)); if (!seen.has(kk)) { seen.add(kk); inclBy.set(kk, (inclBy.get(kk) ?? 0) + ms); }
      const wk = kk.replace(/:\d+$/, ''); if (watchBy.has(wk) && !wseen.has(wk)) { wseen.add(wk); watchBy.set(wk, watchBy.get(wk) + ms); }   // same-named functions of a file nested on one stack count once
    }
  }
  const busy = total - idle, list = (m) => [...m].filter(([k]) => !/^\((idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([fn, ms]) => ({ fn, ms: r(ms, 0), share: busy ? r(ms / busy, 3) : null }));
  const watched = [...watchBy].map(([fn, ms]) => ({ fn, ms: r(ms, 0), share: busy ? r(ms / busy, 3) : null }));
  return { sampledMs: r(total, 0), busyMs: r(busy, 0), self: list(selfBy), inclusive: list(inclBy).filter((x) => !/^\(program\)/.test(x.fn)), watched };
}

const mean = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const spread = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length > 1 ? r(Math.max(...v) - Math.min(...v), 2) : null; };

/** Can this run qualify? The qualifying executor, declared quiet, full-length windows and at least two repeats per arm
 *  (#911 review). Anything else is indicative, whatever the host. */
export const qualifies = ({ executor, quiet, short, repeats }) => !!executor && !!quiet && !short && Number(repeats) >= 2;

/** Results (one per arm and repeat) → the slopes, each with its repeats' spread. Missing arms give null, never 0. Failed
 *  runs ({error}) never enter a mean; each section's `n` gives how many runs of each arm its means rest on. */
export function slopes(all) {
  const results = all.filter((x) => !x.error), n = (ids) => Object.fromEntries(ids.map((id) => [id, of(id).length]));
  const of = (id) => results.filter((x) => x.arm.id === id), m = (id, f) => mean(of(id).map(f)), sp = (id, f) => spread(of(id).map(f));
  const out = {};
  if (of('inv5000').length && of('inv10000').length) {
    out.inventory = { per: '5,000 more distant placed objects', n: n(['inv5000', 'inv10000']), probeCpuMsPerCall: {}, activeCpuMsPerServed: null, quietCores: null, rssMb: null, bootS: null };
    for (const k of PROBE_ROUTES) { const f = (x) => x.probe?.[k]?.cpuMsPerCall; const a = m('inv5000', f), b = m('inv10000', f); out.inventory.probeCpuMsPerCall[k] = { at5000: r(a), at10000: r(b), delta: a == null || b == null ? null : r(b - a), spread: [sp('inv5000', f), sp('inv10000', f)] }; }
    const d = (f, dd = 2) => { const a = m('inv5000', f), b = m('inv10000', f); return a == null || b == null ? null : { at5000: r(a, dd), at10000: r(b, dd), delta: r(b - a, dd) }; };
    out.inventory.activeCpuMsPerServed = d((x) => x.active?.cpuMsPerServed, 1); out.inventory.quietCores = d((x) => x.windows?.quiet?.cores, 3);
    out.inventory.rssMb = d((x) => x.windows?.active?.rssMbMax, 0); out.inventory.bootS = d((x) => x.boot?.seconds, 1); out.inventory.dbMb = d((x) => x.boot?.dbMb, 1);
  }
  const acts = ['act0', 'act5', 'act10'].filter((id) => of(id).length);
  if (acts.length >= 2) {
    const pts = acts.map((id) => ({ active: of(id)[0].arm.active, cores: m(id, (x) => x.windows?.active?.cores), cpuMsPerServed: m(id, (x) => x.active?.cpuMsPerServed), servedPerS: m(id, (x) => x.active?.servedPerS), loopP99MsMax: m(id, (x) => x.live?.active?.loopP99MsMax), spread: sp(id, (x) => x.windows?.active?.cores) }));
    const [a, b] = [pts[0], pts.at(-1)];
    out.activity = { n: n(acts), points: pts.map((p) => ({ ...p, cores: r(p.cores, 3), cpuMsPerServed: r(p.cpuMsPerServed), servedPerS: r(p.servedPerS, 2) })), coresPerActiveSoul: a.cores == null || b.cores == null ? null : r((b.cores - a.cores) / (b.active - a.active), 4) };
  }
  if (of('quiet1').length && of('quiet10').length) {
    const f = (x) => x.active?.cpuMsPerServed, g = (x) => x.active?.endToEnd?.p95, h = (x) => x.quietWorlds?.cores;
    out.quiet = { n: n(['quiet1', 'quiet10']), designatedCpuMsPerServed: { alone: r(m('quiet1', f)), with9: r(m('quiet10', f)) }, designatedE2eP95Ms: { alone: m('quiet1', g), with9: m('quiet10', g) },
      quietWorldsCores: r(m('quiet10', h), 3), coresPerQuietWorld: m('quiet10', h) == null ? null : r(m('quiet10', h) / 9, 4) };
  }
  return out;
}

/** REPORT.md: the receipt line, the per-arm table, the slopes and the profile tops. Numbers only; no host names or paths. */
export function reportText(receipt, all) {
  const s = slopes(all), L = [], results = all.filter((x) => !x.error), failed = all.filter((x) => x.error);
  L.push(`# Slopes bench (${SLOPES}) — ${receipt.indicative ? 'INDICATIVE (not a qualifying run)' : 'qualifying executor'}`, '');
  L.push(`Source ${receipt.source?.commit ?? '?'}${receipt.source?.dirty ? ' (dirty)' : ''} · host class ${receipt.host?.class} · ${receipt.host?.cores} cores · quiet declared ${!!receipt.host?.quietDeclared} · repeats ${receipt.repeats} · windows quiet ${receipt.windows?.quietS} s / active ${receipt.windows?.activeS} s · fake minds`, '');
  L.push('| arm | rep | placed | reg/active | quiet worlds | quiet cores | active cores | CPU-ms/served | served/s | e2e p95 ms | crowded reads | probe CPU-ms here/observe/caps/resolve/act | loop p99 max ms | RSS max MB | boot s |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of results) {
    const p = (k) => x.probe?.[k]?.cpuMsPerCall ?? '?';
    L.push(`| ${x.arm.id} | ${x.rep} | ${x.facts?.placed ?? '?'} | ${x.arm.registered}/${x.arm.active} | ${x.arm.quiet} | ${x.windows?.quiet?.cores ?? '?'} | ${x.windows?.active?.cores ?? '?'} | ${x.active?.cpuMsPerServed ?? '—'} | ${x.active?.servedPerS ?? '—'} | ${x.active?.endToEnd?.p95 ?? '—'} | ${x.schedule?.crowdedReadFrac ?? '—'} | ${PROBE_ROUTES.map(p).join(' / ')} | ${x.live?.active?.loopP99MsMax ?? '?'} | ${x.windows?.active?.rssMbMax ?? '?'} | ${x.boot?.seconds ?? '?'} |`);
  }
  if (failed.length) {
    L.push('', `## Failed runs: ${failed.length} of ${all.length}`, '', 'These runs are in no mean or slope below (each section\'s `n` counts the runs it rests on).', '', '| arm | rep | error |', '|---|---|---|');
    for (const x of failed) L.push(`| ${x.arm?.id ?? '?'} | ${x.rep ?? '?'} | ${String(x.error).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300)} |`);
  }
  L.push('', '## Slopes', '', '```json', JSON.stringify(s, null, 1), '```', '');
  for (const x of results) for (const [w, prof] of Object.entries(x.profiles ?? {})) if (prof) {
    L.push(`### Profile ${x.arm.id} r${x.rep} ${w}: ${prof.busyMs} ms busy of ${prof.sampledMs} ms sampled`, '', '| self ms | share | function |', '|---|---|---|');
    for (const f of prof.self.slice(0, 10)) L.push(`| ${f.ms} | ${f.share} | \`${f.fn}\` |`);
    L.push('', '| inclusive ms | share | function |', '|---|---|---|');
    for (const f of prof.inclusive.slice(0, 12)) L.push(`| ${f.ms} | ${f.share} | \`${f.fn}\` |`);
    if (prof.watched?.length) { L.push('', '| watched inclusive ms | share | path |', '|---|---|---|'); for (const f of prof.watched) L.push(`| ${f.ms} | ${f.share} | \`${f.fn}\` |`); }
    L.push('');
  }
  L.push('## Coverage', '', ...(receipt.coverage ?? []).map((c) => `- ${c}`), '');
  return L.join('\n');
}
