// CW7 (#741): the slopes bench's pure parts: its arms, the reduction of a run's raw records and samples, CPU-profile
// summaries, the slopes across arms and REPORT.md. No I/O, no clock. slopes.mjs runs the arms; report.test.mjs pins them.
import { quantiles } from '../meetup/workload.mjs';

export const SLOPES = 'cw7-slopes/1';

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

/** Process CPU cores between two proc samples ({t ms, cpuS}). */
export const cores = (a, b) => (a && b && b.t > a.t && a.cpuS != null && b.cpuS != null ? (b.cpuS - a.cpuS) / ((b.t - a.t) / 1000) : null);
const r = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

/** One probe route: calls [{ms, bytes, status}] and the CPU seconds the world used over the route's span, minus the quiet
 *  rate over that span. → per-call CPU-ms (an upper bound: tick variation and the hub are inside it). */
export function probeRoute(calls, { cpuS, spanMs, quietCores }) {
  const ok = calls.filter((c) => c.status >= 200 && c.status < 300), q = quantiles(ok.map((c) => c.ms));
  const extra = cpuS == null || quietCores == null ? null : cpuS - quietCores * spanMs / 1000;
  const waits = calls.reduce((m, c) => m + (c.busyWaits ?? 0), 0);
  return { n: calls.length, ok: ok.length, ...(waits ? { busyWaits: waits } : {}), cpuMsPerCall: ok.length && extra != null ? r(1000 * extra / ok.length) : null, p50Ms: q.p50 ?? null, p95Ms: q.p95 ?? null, bytesMean: ok.length ? Math.round(ok.reduce((s, c) => s + c.bytes, 0) / ok.length) : null };
}

/** The active window's calls ({route, ms, lateMs, bytes, status, outcome}) → per-route latency and the CPU per served call. */
export function activeWindow(calls, { cpuS, spanMs, quietCores, offered }) {
  const served = calls.filter((c) => c.outcome === 'ok' || c.outcome === 'gameplay-refused'), routes = {};
  for (const c of calls) (routes[c.route] ??= []).push(c);
  const extra = cpuS == null || quietCores == null ? null : cpuS - quietCores * spanMs / 1000;
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

/** A V8 .cpuprofile → sampled ms and the top self-time and inclusive functions. File paths are made relative to `root`;
 *  Node's own and anonymous frames are kept under their names. */
export function summarizeProfile(p, root = '', top = 15) {
  if (!p?.nodes?.length) return null;
  const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map(), self = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  (p.samples ?? []).forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas?.[i] ?? 0) / 1000));
  const keyOf = (n) => { const f = n.callFrame, u = String(f.url ?? '').replace(/^file:\/\//, ''), file = root && u.startsWith(root) ? u.slice(root.length).replace(/^\//, '') : u; return `${f.functionName || '(anonymous)'} ${file ? `${file}:${f.lineNumber + 1}` : ''}`.trim(); };
  const selfBy = new Map(), inclBy = new Map();
  let total = 0, idle = 0;
  for (const [id, ms] of self) {
    const n = byId.get(id); total += ms; const k = keyOf(n); if (/^\((idle|program|garbage collector)\)/.test(k)) { if (k.startsWith('(idle)')) idle += ms; }
    selfBy.set(k, (selfBy.get(k) ?? 0) + ms);
    const seen = new Set(); for (let x = id; x != null; x = parent.get(x)) { const kk = keyOf(byId.get(x)); if (!seen.has(kk)) { seen.add(kk); inclBy.set(kk, (inclBy.get(kk) ?? 0) + ms); } }
  }
  const busy = total - idle, list = (m) => [...m].filter(([k]) => !/^\((idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([fn, ms]) => ({ fn, ms: r(ms, 0), share: busy ? r(ms / busy, 3) : null }));
  return { sampledMs: r(total, 0), busyMs: r(busy, 0), self: list(selfBy), inclusive: list(inclBy).filter((x) => !/^\(program\)/.test(x.fn)) };
}

const mean = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const spread = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length > 1 ? r(Math.max(...v) - Math.min(...v), 2) : null; };

/** Results (one per arm and repeat) → the slopes, each with its repeats' spread. Missing arms give null, never 0. */
export function slopes(results) {
  const of = (id) => results.filter((x) => x.arm.id === id), m = (id, f) => mean(of(id).map(f)), sp = (id, f) => spread(of(id).map(f));
  const out = {};
  if (of('inv5000').length && of('inv10000').length) {
    out.inventory = { per: '5,000 more distant placed objects', probeCpuMsPerCall: {}, activeCpuMsPerServed: null, quietCores: null, rssMb: null, bootS: null };
    for (const k of PROBE_ROUTES) { const f = (x) => x.probe?.[k]?.cpuMsPerCall; const a = m('inv5000', f), b = m('inv10000', f); out.inventory.probeCpuMsPerCall[k] = { at5000: r(a), at10000: r(b), delta: a == null || b == null ? null : r(b - a), spread: [sp('inv5000', f), sp('inv10000', f)] }; }
    const d = (f, dd = 2) => { const a = m('inv5000', f), b = m('inv10000', f); return a == null || b == null ? null : { at5000: r(a, dd), at10000: r(b, dd), delta: r(b - a, dd) }; };
    out.inventory.activeCpuMsPerServed = d((x) => x.active?.cpuMsPerServed, 1); out.inventory.quietCores = d((x) => x.windows?.quiet?.cores, 3);
    out.inventory.rssMb = d((x) => x.windows?.active?.rssMbMax, 0); out.inventory.bootS = d((x) => x.boot?.seconds, 1); out.inventory.dbMb = d((x) => x.boot?.dbMb, 1);
  }
  const acts = ['act0', 'act5', 'act10'].filter((id) => of(id).length);
  if (acts.length >= 2) {
    const pts = acts.map((id) => ({ active: of(id)[0].arm.active, cores: m(id, (x) => x.windows?.active?.cores), cpuMsPerServed: m(id, (x) => x.active?.cpuMsPerServed), servedPerS: m(id, (x) => x.active?.servedPerS), loopP99MsMax: m(id, (x) => x.live?.active?.loopP99MsMax), spread: sp(id, (x) => x.windows?.active?.cores) }));
    const [a, b] = [pts[0], pts.at(-1)];
    out.activity = { points: pts.map((p) => ({ ...p, cores: r(p.cores, 3), cpuMsPerServed: r(p.cpuMsPerServed), servedPerS: r(p.servedPerS, 2) })), coresPerActiveSoul: a.cores == null || b.cores == null ? null : r((b.cores - a.cores) / (b.active - a.active), 4) };
  }
  if (of('quiet1').length && of('quiet10').length) {
    const f = (x) => x.active?.cpuMsPerServed, g = (x) => x.active?.endToEnd?.p95, h = (x) => x.quietWorlds?.cores;
    out.quiet = { designatedCpuMsPerServed: { alone: r(m('quiet1', f)), with9: r(m('quiet10', f)) }, designatedE2eP95Ms: { alone: m('quiet1', g), with9: m('quiet10', g) },
      quietWorldsCores: r(m('quiet10', h), 3), coresPerQuietWorld: m('quiet10', h) == null ? null : r(m('quiet10', h) / 9, 4) };
  }
  return out;
}

/** REPORT.md: the receipt line, the per-arm table, the slopes and the profile tops. Numbers only; no host names or paths. */
export function reportText(receipt, results) {
  const s = slopes(results), L = [];
  L.push(`# Slopes bench (${SLOPES}) — ${receipt.indicative ? 'INDICATIVE (not a qualifying run)' : 'qualifying executor'}`, '');
  L.push(`Source ${receipt.source?.commit ?? '?'}${receipt.source?.dirty ? ' (dirty)' : ''} · host class ${receipt.host?.class} · ${receipt.host?.cores} cores · quiet declared ${!!receipt.host?.quietDeclared} · repeats ${receipt.repeats} · windows quiet ${receipt.windows?.quietS} s / active ${receipt.windows?.activeS} s · fake minds`, '');
  L.push('| arm | rep | placed | reg/active | quiet worlds | quiet cores | active cores | CPU-ms/served | served/s | e2e p95 ms | probe CPU-ms here/observe/caps/resolve/act | loop p99 max ms | RSS max MB | boot s |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of results) {
    const p = (k) => x.probe?.[k]?.cpuMsPerCall ?? '?';
    L.push(`| ${x.arm.id} | ${x.rep} | ${x.facts?.placed ?? '?'} | ${x.arm.registered}/${x.arm.active} | ${x.arm.quiet} | ${x.windows?.quiet?.cores ?? '?'} | ${x.windows?.active?.cores ?? '?'} | ${x.active?.cpuMsPerServed ?? '—'} | ${x.active?.servedPerS ?? '—'} | ${x.active?.endToEnd?.p95 ?? '—'} | ${PROBE_ROUTES.map(p).join(' / ')} | ${x.live?.active?.loopP99MsMax ?? '?'} | ${x.windows?.active?.rssMbMax ?? '?'} | ${x.boot?.seconds ?? '?'} |`);
  }
  L.push('', '## Slopes', '', '```json', JSON.stringify(s, null, 1), '```', '');
  for (const x of results) for (const [w, prof] of Object.entries(x.profiles ?? {})) if (prof) {
    L.push(`### Profile ${x.arm.id} r${x.rep} ${w}: ${prof.busyMs} ms busy of ${prof.sampledMs} ms sampled`, '', '| self ms | share | function |', '|---|---|---|');
    for (const f of prof.self.slice(0, 10)) L.push(`| ${f.ms} | ${f.share} | \`${f.fn}\` |`);
    L.push('', '| inclusive ms | share | function |', '|---|---|---|');
    for (const f of prof.inclusive.slice(0, 12)) L.push(`| ${f.ms} | ${f.share} | \`${f.fn}\` |`);
    L.push('');
  }
  L.push('## Coverage', '', ...(receipt.coverage ?? []).map((c) => `- ${c}`), '');
  return L.join('\n');
}
