#!/usr/bin/env node
// Host disk/memory check for eden2 (lane OPS2). Run every 10 min by sim-worlds-health@<stage>.timer as simworlds.
//   node host-health.mjs <dataDir> [--disk-path /] [--min-free-pct 15] [--min-free-gb 20] [--min-mem-mb 1536]
// Writes <dataDir>/host-health.json (always, atomically) and appends one line to <dataDir>/host-health.log whenever a
// threshold is breached (ALERT) or clears (RECOVERED). The launcher folds the JSON into /__sim/healthz: `hostOk` and the
// short problem `codes` for everyone, the numbers for direct (loopback) requests. Alert when disk free < 15% OR < 20 GB,
// or MemAvailable < 1.5 GB; (t4-o1) when a sim-worlds@<stage> unit's working set (cgroup memory.current minus inactive
// file cache) reaches 90% of its MemoryMax, or its oom_kill count rose since the last run; and, only while a
// sim-worlds-backup@<stage>.timer is enabled, when that backup's last run did not succeed.
// No dependencies, no network. The off-box watcher (team/ops/sim-watch, Modal) reads `hostOk`/`hostCodes` from healthz and
// DMs Gene. Exit 0 always (a failed check must not flap the unit).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function memAvailableMb(meminfo) {
  const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo);
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

export const CGROUP_SLICE = '/sys/fs/cgroup/system.slice/system-sim\\x2dworlds.slice';

/** One sim-worlds@<stage> cgroup: working set (current - inactive_file), cap (memory.max), oom_kill count. */
export function readCgroup(dir) {
  const num = (f) => { const v = readFileSync(join(dir, f), 'utf8').trim(); return v === 'max' ? null : Number(v); };
  const stat = readFileSync(join(dir, 'memory.stat'), 'utf8'), events = readFileSync(join(dir, 'memory.events'), 'utf8');
  const field = (text, k) => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(text)?.[1] ?? 0);
  return { workingBytes: num('memory.current') - field(stat, 'inactive_file'), maxBytes: num('memory.max'), oomKills: field(events, 'oom_kill') };
}

export function evaluate({ diskTotalBytes, diskFreeBytes, memMb, units = {}, prevUnits = {}, backups = {}, worldProblems = [] }, t = {}) {
  const minPct = t.minFreePct ?? 15, minGb = t.minFreeGb ?? 20, minMem = t.minMemMb ?? 1536, capPct = t.capPct ?? 90;
  const diskFreeGb = +(diskFreeBytes / 1e9).toFixed(1), diskFreePct = +(100 * diskFreeBytes / diskTotalBytes).toFixed(1);
  const problems = [], codes = new Set();
  const flag = (code, text) => { codes.add(code); problems.push(text); };
  if (diskFreePct < minPct) flag('disk', `disk free ${diskFreePct}% < ${minPct}%`);
  if (diskFreeGb < minGb) flag('disk', `disk free ${diskFreeGb} GB < ${minGb} GB`);
  if (memMb == null) flag('memory', 'MemAvailable unreadable');
  else if (memMb < minMem) flag('memory', `MemAvailable ${memMb} MB < ${minMem} MB`);
  const unitStatus = {};
  for (const [stage, u] of Object.entries(units)) {
    const pct = u.maxBytes ? +(100 * u.workingBytes / u.maxBytes).toFixed(1) : null;
    unitStatus[stage] = { workingMb: Math.round(u.workingBytes / 2 ** 20), maxMb: u.maxBytes ? Math.round(u.maxBytes / 2 ** 20) : null, pct, oomKills: u.oomKills };
    if (pct != null && pct >= capPct) flag(`cap:${stage}`, `sim-worlds@${stage} working set ${unitStatus[stage].workingMb} MB = ${pct}% of its ${unitStatus[stage].maxMb} MB cap`);
    const before = prevUnits[stage]?.oomKills;
    if (Number.isInteger(before) && u.oomKills > before) flag(`oom:${stage}`, `sim-worlds@${stage} OOM kills ${before} -> ${u.oomKills}`);
  }
  for (const [stage, b] of Object.entries(backups)) {
    if (b.enabled && b.result && b.result !== 'success') flag(`backup:${stage}`, `sim-worlds-backup@${stage} last run: ${b.result}`);
  }
  // lane L1: the launcher's guard (children.mjs problems(), via <data>/world-problems.json): wedged, held, crashloop, bootSlow, halted
  for (const w of worldProblems) if (w?.code && w.text) flag(w.code, w.text);
  return { ok: problems.length === 0, diskFreeGb, diskFreePct, memAvailableMb: memMb, problems, codes: [...codes], units: unitStatus, backups,
    thresholds: { minFreePct: minPct, minFreeGb: minGb, minMemMb: minMem, capPct } };
}

function readUnits(slice = CGROUP_SLICE) {
  const units = {};
  if (!existsSync(slice)) return units;
  for (const d of readdirSync(slice)) {
    const m = /^sim-worlds@([\w-]+)\.service$/.exec(d);
    if (m) try { units[m[1]] = readCgroup(join(slice, d)); } catch {}
  }
  return units;
}

/** Backups count only while their timer is enabled (Gene, 2026-10-19: scheduled backups are off until he wants them). */
function readBackups(stages) {
  const backups = {};
  const show = (unit, props) => Object.fromEntries(execFileSync('systemctl', ['show', unit, '-p', props], { encoding: 'utf8', timeout: 10_000 })
    .trim().split('\n').map(l => l.split('=')));
  for (const stage of stages) {
    try {
      const timer = show(`sim-worlds-backup@${stage}.timer`, 'UnitFileState');
      if (timer.UnitFileState !== 'enabled') { backups[stage] = { enabled: false }; continue; }
      // lane DASH: when the last run started and ended (the owner's health page shows them; '' = never ran)
      const s = show(`sim-worlds-backup@${stage}.service`, 'Result,ExecMainStartTimestamp,ExecMainExitTimestamp,ExecMainStatus');
      const iso = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
      backups[stage] = { enabled: true, result: s.Result, startedAt: iso(s.ExecMainStartTimestamp), endedAt: iso(s.ExecMainExitTimestamp), exitStatus: s.ExecMainStatus === undefined ? null : Number(s.ExecMainStatus) };
    } catch {}
  }
  return backups;
}

/** The launcher's guard findings (written every 10 s); none when the file is older than 2 min (the launcher is down:
 *  its own unit and the healthz probe report that). */
export function readWorldProblems(dataDir, now = Date.now()) {
  try { const j = JSON.parse(readFileSync(join(dataDir, 'world-problems.json'), 'utf8')); return now - Date.parse(j.at) < 120_000 && Array.isArray(j.problems) ? j.problems : []; } catch { return []; }
}

function main(argv) {
  const dataDir = argv[0];
  if (!dataDir) { console.error('usage: host-health.mjs <dataDir> [--disk-path /] [--min-free-pct N] [--min-free-gb N] [--min-mem-mb N]'); return; }
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
  const diskPath = opt('disk-path', '/');
  const out = join(dataDir, 'host-health.json'), log = join(dataDir, 'host-health.log');
  let prev = null; try { prev = JSON.parse(readFileSync(out, 'utf8')); } catch {}
  let status;
  try {
    const s = statfsSync(diskPath);
    const units = readUnits();
    status = evaluate({ diskTotalBytes: s.blocks * s.bsize, diskFreeBytes: s.bavail * s.bsize, memMb: memAvailableMb(readFileSync('/proc/meminfo', 'utf8')),
      units, prevUnits: prev?.units ?? {}, backups: readBackups(Object.keys(units)), worldProblems: readWorldProblems(dataDir) },
      { minFreePct: Number(opt('min-free-pct', 15)), minFreeGb: Number(opt('min-free-gb', 20)), minMemMb: Number(opt('min-mem-mb', 1536)), capPct: Number(opt('cap-pct', 90)) });
  } catch (e) { status = { ok: false, problems: [`check failed: ${e.message}`], codes: ['check'] }; }
  status = { ...status, at: new Date().toISOString(), diskPath };
  const tmp = `${out}.tmp`; writeFileSync(tmp, JSON.stringify(status) + '\n'); renameSync(tmp, out);
  if (!status.ok) appendFileSync(log, `${status.at} ALERT ${status.problems.join('; ')}\n`);
  else if (prev && prev.ok === false) appendFileSync(log, `${status.at} RECOVERED disk ${status.diskFreeGb} GB (${status.diskFreePct}%) mem ${status.memAvailableMb} MB\n`);
  console.log(JSON.stringify(status));
}

// Compare real paths: on eden2 the unit runs it through the /srv/sim-worlds/<stage> symlink, while import.meta.url is the
// resolved release path, so a plain string compare never ran main().
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
