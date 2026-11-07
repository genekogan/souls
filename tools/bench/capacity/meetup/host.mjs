// CW2 (#736) A1/A4: what the allocation actually is and how hard it is pressed, from the kernel's own files.
// Linux cgroup v2, PSI and /proc only; anything this host does not expose is `null` (unknown), never 0. The parsers
// are pure (host.test.mjs feeds them fixed text); `probe` and `threads` read the files.
import { readFileSync, readdirSync, statfsSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const num = (v) => (v == null || v === '' || v === 'max' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** cpu.max: "<quota|max> <period>" → {quotaCores: number|null (null = unlimited), periodUs}. */
export function parseCpuMax(t) {
  if (t == null) return null;
  const [q, p] = t.trim().split(/\s+/), period = num(p) ?? 100_000;
  return { quotaCores: q === 'max' ? null : +(Number(q) / period).toFixed(3), periodUs: period, unlimited: q === 'max' };
}
/** Flat "key value" files (cpu.stat, memory.stat). */
export function parseKv(t) {
  if (t == null) return null;
  const o = {}; for (const line of t.trim().split('\n')) { const [k, v] = line.trim().split(/\s+/); if (k) o[k] = num(v); } return o;
}
/** PSI: "some avg10=.. avg60=.. avg300=.. total=..\nfull ..." → {some: {...}, full: {...}}. */
export function parsePressure(t) {
  if (t == null) return null;
  const o = {};
  for (const line of t.trim().split('\n')) { const [kind, ...kv] = line.trim().split(/\s+/); o[kind] = Object.fromEntries(kv.map((x) => x.split('=')).map(([k, v]) => [k, Number(v)])); }
  return o;
}
/** The aggregate "cpu" line of /proc/stat → jiffies {user, nice, system, idle, iowait, irq, softirq, steal, total}. */
export function parseProcStat(t) {
  const line = t?.split('\n').find((l) => /^cpu\s/.test(l)); if (!line) return null;
  const [user, nice, system, idle, iowait, irq, softirq, steal = 0] = line.trim().split(/\s+/).slice(1).map(Number);
  return { user, nice, system, idle, iowait, irq, softirq, steal, total: user + nice + system + idle + iowait + irq + softirq + steal };
}
/** /proc/<pid>/task/<tid>/stat → {name, cpuTicks} (utime + stime). The name may hold spaces and parentheses. */
export function parseTaskStat(t) {
  if (t == null) return null;
  const close = t.lastIndexOf(')'), name = t.slice(t.indexOf('(') + 1, close), f = t.slice(close + 2).split(' ');
  return { name, cpuTicks: Number(f[11]) + Number(f[12]) };
}
/** cgroup v2 path of a process ("0::/system.slice/x.scope") → the directory under /sys/fs/cgroup, or null (v1 / not Linux). */
export function cgroupDir(t) {
  const line = t?.split('\n').find((l) => l.startsWith('0::')); return line ? `/sys/fs/cgroup${line.slice(3).trim()}`.replace(/\/$/, '') : null;
}

/** One reading of the allocation a process lives in (pid default: this process). Sizes in MB. */
export function probe(pid = 'self') {
  const dir = cgroupDir(read(`/proc/${pid}/cgroup`)), cg = (f) => (dir ? read(`${dir}/${f}`) : null), mb = (v) => (v == null ? null : Math.round(v / 2 ** 20));
  const mem = (f) => { const t = cg(f); return t == null ? null : t.trim() === 'max' ? 'max' : mb(num(t.trim())); };
  return {
    supported: !!dir, cores: cpus().length, cpuset: (cg('cpuset.cpus.effective') ?? '').trim() || null,
    cpuMax: parseCpuMax(cg('cpu.max')), cpuStat: parseKv(cg('cpu.stat')),
    memoryMaxMb: mem('memory.max'), memoryHighMb: mem('memory.high'), memoryCurrentMb: mem('memory.current'), memoryPeakMb: mem('memory.peak'), swapCurrentMb: mem('memory.swap.current'), swapMaxMb: mem('memory.swap.max'),
    pressure: { cpu: parsePressure(cg('cpu.pressure') ?? read('/proc/pressure/cpu')), memory: parsePressure(cg('memory.pressure') ?? read('/proc/pressure/memory')), io: parsePressure(cg('io.pressure') ?? read('/proc/pressure/io')) },
    procStat: parseProcStat(read('/proc/stat')),
  };
}
/** Per-thread CPU ticks of a process: {main, threads: [{tid, name, cpuTicks}]}; null where /proc is absent. */
export function threads(pid) {
  let tids; try { tids = readdirSync(`/proc/${pid}/task`); } catch { return null; }
  const out = tids.map((tid) => ({ tid: Number(tid), ...(parseTaskStat(read(`/proc/${pid}/task/${tid}/stat`)) ?? { cpuTicks: null }) })).filter((x) => x.cpuTicks != null);
  return { main: out.find((x) => x.tid === Number(pid))?.cpuTicks ?? null, threads: out };
}

/** Between two probes: steal share of host CPU, throttled share of cgroup periods, cgroup CPU used in cores, PSI totals. */
export function between(a, b, seconds) {
  if (!a || !b || !(seconds > 0)) return null;
  const d = (x, y) => (x == null || y == null ? null : y - x), ps = (k) => d(a.pressure?.[k]?.some?.total, b.pressure?.[k]?.some?.total);
  const dt = d(a.procStat?.total, b.procStat?.total), periods = d(a.cpuStat?.nr_periods, b.cpuStat?.nr_periods);
  const usage = d(a.cpuStat?.usage_usec, b.cpuStat?.usage_usec), throttled = d(a.cpuStat?.throttled_usec, b.cpuStat?.throttled_usec);
  const share = (us) => (us == null ? null : +(us / 1e6 / seconds).toFixed(4));
  return {
    stealShare: dt ? +(d(a.procStat.steal, b.procStat.steal) / dt).toFixed(4) : null,
    cgroupCpuCores: usage == null ? null : +(usage / 1e6 / seconds).toFixed(3),
    // no enforcement periods (no CPU quota) means nothing could be throttled: 0, known; no cpu.stat at all: null, unknown
    throttledPeriodShare: periods == null ? null : periods === 0 ? 0 : +(d(a.cpuStat.nr_throttled, b.cpuStat.nr_throttled) / periods).toFixed(4),
    throttledSecondsPerSecond: throttled == null ? null : +(throttled / 1e6 / seconds).toFixed(4),
    pressureSomeShare: { cpu: share(ps('cpu')), memory: share(ps('memory')), io: share(ps('io')) },
  };
}
/** Hottest thread and main thread of a process between two `threads` readings, in cores (1 = one core saturated). */
export function hotThreads(a, b, seconds, clkTck = 100) {
  if (!a || !b || !(seconds > 0)) return null;
  const before = new Map(a.threads.map((x) => [x.tid, x.cpuTicks]));
  const rates = b.threads.filter((x) => before.has(x.tid)).map((x) => ({ tid: x.tid, name: x.name, cores: (x.cpuTicks - before.get(x.tid)) / clkTck / seconds })).sort((x, y) => y.cores - x.cores);
  const main = a.main != null && b.main != null ? (b.main - a.main) / clkTck / seconds : null;
  return { mainCores: main == null ? null : +main.toFixed(3), hottest: rates[0] ? { name: rates[0].name, cores: +rates[0].cores.toFixed(3) } : null, threads: rates.length };
}

// CW8 A2 (#955): one resource sample, every 30 s (meetup.mjs). Per world: RSS (given), heap used/limit, GC % and queue
// depth from its own live.json, threads from /proc/<pid>/task, sim.db / -wal / -shm and the whole data directory; the
// telemetry store (when given) and free space on the data volume. MB throughout; anything unreadable is null, never 0.
const MB = 2 ** 20;
const fileMb = (p) => { try { return +(statSync(p).size / MB).toFixed(3); } catch { return null; } };
export function dirMb(p) {
  let n = 0, seen = false;
  const walk = (d) => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } seen = true;
    for (const e of es) { const q = join(d, e.name); if (e.isDirectory()) walk(q); else if (e.isFile()) try { n += statSync(q).size; } catch { /* gone */ } } };
  walk(p); return seen ? +(n / MB).toFixed(3) : null;
}
/** {ldata, worlds: [{slug, pid, rssMb}], telemetryDir|null} → {worlds: {slug: {...}}, telemetryMb, diskFreeMb}. */
export function resourceSample({ ldata, worlds, telemetryDir = null, procRoot = '/proc' }) {
  const out = {};
  for (const w of worlds) {
    const wd = join(ldata, 'worlds', w.slug);
    let live = null; try { live = JSON.parse(readFileSync(join(wd, 'live.json'), 'utf8')); } catch { /* not yet */ }
    let threads = null; if (w.pid) try { threads = readdirSync(`${procRoot}/${w.pid}/task`).length; } catch { /* not Linux */ }
    const rss = Number.isFinite(w.rssMb) ? Math.round(w.rssMb) : null, heap = Number.isFinite(live?.heap?.usedMb) ? live.heap.usedMb : null;
    out[w.slug] = { rssMb: rss, heapUsedMb: heap, heapLimitMb: live?.heap?.limitMb ?? null, nonHeapMb: rss != null && heap != null ? rss - heap : null,
      gcPct: live?.heap?.gcPct10s ?? null, queueDepth: live?.queue?.depth ?? null, threads,
      dbMb: fileMb(join(wd, 'sim.db')), walMb: fileMb(join(wd, 'sim.db-wal')), shmMb: fileMb(join(wd, 'sim.db-shm')), dataDirMb: dirMb(wd) };
  }
  let diskFreeMb = null; try { const v = statfsSync(ldata); diskFreeMb = Math.round((v.bavail * v.bsize) / MB); } catch { /* unsupported */ }
  return { worlds: out, telemetryMb: telemetryDir ? dirMb(telemetryDir) : null, diskFreeMb };
}
