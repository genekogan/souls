// Process cost by class (#803): the runner's descendant processes (world server, seats, observer browser and
// Playwright's video encoder), sampled with `ps` so browser rendering and video encoding are reported apart. Only the
// class of each process is kept, never its command line. Cumulative CPU per pid is monotonic, so a pid's cost is its
// last seen CPU minus its CPU when first seen before the run (0 for a pid born during it); a pid that exits between
// samples loses at most one interval.
import { execFile } from 'node:child_process';

export const CLASSES = ['browser', 'encoder', 'world', 'other'];

/** classify(command) → one of CLASSES. The command is read here and dropped. */
export function classify(command) {
  const c = String(command);
  if (/ffmpeg/i.test(c)) return 'encoder';
  if (/chrom(e|ium)|headless[_-]shell/i.test(c)) return 'browser';
  if (/apps\/server\/src\/main\.ts/.test(c)) return 'world';
  return 'other';
}

/** "[[dd-]hh:]mm:ss[.ss]" (ps TIME) → seconds. */
export function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + Number(m[3]) * 60 + Number(m[4]);
}

/** One `ps` table: [{pid, ppid, rssKb, cpuSec, command}]. */
export function parsePs(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpuSec: parseCpuTime(m[4]), command: m[5] });
  }
  return rows;
}

const defaultPs = () => new Promise((res, rej) => execFile('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,command='], { maxBuffer: 16 << 20, timeout: 5000 }, (e, out) => (e ? rej(e) : res(out))));

/** startProcessSampler({rootPid, intervalMs, ps}) → {stop() → summary}. summary: {status: 'measured', intervalMs,
 *  samples, classes: {<class>: {cpuSec, peakRssMb, processes}}, basis} or {status: 'unavailable', reason}. */
export function startProcessSampler({ rootPid = process.pid, intervalMs = 2000, ps = defaultPs } = {}) {
  const procs = new Map(); // pid → {cls, base, last}
  const peakKb = Object.fromEntries(CLASSES.map((c) => [c, 0])); // largest per-sample sum of RSS by class
  let samples = 0, failed = null, first = true, timer = null, busy = null;
  const sample = async () => {
    let rows;
    try { rows = parsePs(await ps()); } catch (e) { failed ??= String(e?.message ?? e).split('\n')[0]; return; }
    const kids = new Map();
    for (const r of rows) (kids.get(r.ppid) ?? kids.set(r.ppid, []).get(r.ppid)).push(r);
    const stack = [...(kids.get(rootPid) ?? [])], rss = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    while (stack.length) {
      const r = stack.pop();
      stack.push(...(kids.get(r.pid) ?? []));
      if (r.cpuSec == null) continue;
      const p = procs.get(r.pid);
      if (!p) procs.set(r.pid, { cls: classify(r.command), base: first ? r.cpuSec : 0, last: r.cpuSec });
      else p.last = Math.max(p.last, r.cpuSec);
      rss[procs.get(r.pid).cls] += r.rssKb;
    }
    for (const c of CLASSES) peakKb[c] = Math.max(peakKb[c], rss[c]);
    samples++; first = false;
  };
  busy = sample();
  timer = setInterval(() => { busy = busy.then(sample); }, intervalMs);
  timer.unref?.();
  return {
    stop: async () => {
      clearInterval(timer);
      await busy; await sample();
      if (!samples) return { status: 'unavailable', reason: `ps failed: ${failed ?? 'no sample'}` };
      const classes = Object.fromEntries(CLASSES.map((c) => [c, { cpuSec: 0, peakRssMb: 0, processes: 0 }]));
      for (const p of procs.values()) { const k = classes[p.cls]; k.cpuSec += Math.max(0, p.last - p.base); k.processes++; }
      for (const c of CLASSES) classes[c].peakRssMb = Math.round(peakKb[c] / 1024);
      for (const k of Object.values(classes)) k.cpuSec = +k.cpuSec.toFixed(1);
      return { status: 'measured', intervalMs, samples, classes, ...(failed ? { sampleErrors: failed } : {}),
        basis: `ps every ${intervalMs} ms over the runner's descendants (${procs.size} processes); CPU per process is last seen minus first seen before the run, a process that exits between samples loses up to one interval; peak RSS is the largest sampled sum over the class's processes; commands are classified and not kept` };
    },
  };
}
