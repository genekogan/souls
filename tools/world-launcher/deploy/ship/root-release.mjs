#!/usr/bin/env node
// Verdicts for ship.sh's root-only release: the receipts, the host snapshot and its drift, the row-verified backup and
// the activation preconditions. Each command reads local files, prints what it found and exits 1 with the reason.
//   node root-release.mjs receipts <gate receipt> <ship receipt> <sha>
//   node root-release.mjs snapshot <healthz.json> <remote.json> <label sha> <out.json>
//   node root-release.mjs drift <snapshot.json> <healthz.json> <remote.json>
//   node root-release.mjs backup <backup.log> <quick-check.log> <snapshot.json> <label> <out.json>
//   node root-release.mjs activation <snapshot.json> <backup-receipt.json> <upload-receipt.json> <manifest>
//   node root-release.mjs health <healthz.json> <build> <worlds>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = f => JSON.parse(readFileSync(f, 'utf8'));
const digest = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const HOUR_MS = 3_600_000;
export const IDLE_HANDOVERS = [null, undefined, 'done', 'failed', 'rolled-back'];
export const DRIFT_KEYS = ['productionTarget', 'configurationSha256', 'worlds', 'registryIdentitySha256', 'databasePaths', 'databases', 'keeperPid', 'servicePid', 'keeperSha', 'activeBuild', 'deployedKeeperSha'];
export const HEALTH_KEYS = ['ok', 'build', 'worlds', 'hostOk', 'auth', 'maxWorlds', 'maxRunning'];

/** A clean gate receipt and ship receipt for exactly this commit (docs/testing/remote-gate.md). */
export function receiptProblems(gate, ship, sha, gateSha256) {
  const out = [];
  if (gate?.refs?.candidate?.sha !== sha) out.push(`gate receipt is for ${gate?.refs?.candidate?.sha}, not this commit`);
  if (gate?.scope?.resolved !== 'full') out.push(`gate scope ${gate?.scope?.resolved} is not the full contract`);
  if (!['pass', 'quarantined'].includes(gate?.status)) out.push(`gate status ${gate?.status}`);
  for (const k of ['blockers', 'newFailures', 'unexpectedSkips', 'removed']) if (gate?.[k]?.length) out.push(`gate has ${gate[k].length} ${k}`);
  if (ship?.candidate !== sha) out.push(`ship receipt is for ${ship?.candidate}, not this commit`);
  if (!['pass', 'quarantined'].includes(ship?.status)) out.push(`ship receipt status ${ship?.status}`);
  if (ship?.blockers?.length) out.push(`ship receipt has ${ship.blockers.length} blockers`);
  if (ship?.newFailures) out.push(`ship receipt has ${ship.newFailures} new failures`);
  if (ship?.gate?.sha256 !== gateSha256) out.push('ship receipt names a different gate receipt');
  return out;
}

export function snapshotProblems(health, remote, sha = '') {
  const out = [], previous = remote.productionTarget.split('/').pop();
  if (sha && previous === `we-${sha.slice(0, 12)}`) out.push('this commit is already live: a new snapshot would name it as the previous build');
  if (!health.ok || !health.hostOk) out.push('public healthz is not ok');
  if (health.build !== previous || remote.activeBuild !== previous) out.push(`stage link ${previous}, healthz ${health.build}, keeper ${remote.activeBuild} disagree`);
  if (health.worlds !== remote.worlds) out.push(`healthz has ${health.worlds} worlds, the registry ${remote.worlds}`);
  if (!(remote.databases >= remote.worlds)) out.push(`${remote.databases} databases for ${remote.worlds} worlds`);
  if (!(Number(remote.keeperPid) > 1) || Number(remote.keeperPid) !== remote.servicePid) out.push('keeper and service pid differ');
  if (remote.keeperSha !== remote.deployedKeeperSha) out.push('keeper source differs from the deployed release');
  if (!IDLE_HANDOVERS.includes(remote.handoverState)) out.push(`handover ${remote.handoverState} is active`);
  return out;
}

export function driftProblems(before, health, remote) {
  const out = [];
  for (const k of HEALTH_KEYS) if (JSON.stringify(health[k]) !== JSON.stringify(before.publicHealth[k])) out.push(`public health ${k} changed`);
  for (const k of DRIFT_KEYS) if (JSON.stringify(remote[k]) !== JSON.stringify(before.remote[k])) out.push(`${k} changed`);
  return out;
}

/** The receipt, or throws. compact-copy prints one JSON row per database; compact-backup's last line is the folder. */
export function backupReceipt(log, quick, snapshot, snapshotSha256, label, now = new Date()) {
  const lines = log.split('\n').filter(Boolean), folder = lines.at(-1) ?? '', want = snapshot.remote;
  const escaped = label.replace(/[^A-Za-z0-9_-]/g, '');
  if (!new RegExp(`^/.+/pre-r${escaped}-production-[A-Za-z0-9-]+$`).test(folder)) throw Error('the backup did not name its folder');
  const rows = lines.filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  if (rows.length !== want.databases) throw Error(`${rows.length} rows of copies for ${want.databases} databases`);
  if (!rows.every(r => r.dropped && !Object.keys(r.dropped).length)) throw Error('a compact copy dropped rows');
  const checks = quick.split('\n').filter(Boolean);
  if (!checks.every(l => l.startsWith('ok '))) throw Error('a backup failed quick_check');
  const found = checks.map(l => l.slice(3).replace(`${folder}/`, '')).sort();
  if (JSON.stringify(found) !== JSON.stringify([...want.databasePaths].sort())) throw Error('backup filenames differ from the snapshot');
  return { at: now.toISOString(), status: 'pass', databases: want.databases, quickChecks: checks.length, rowsCopiedAndCompared: true, backup: folder, dataRestored: false, snapshotSha256, databasePaths: want.databasePaths };
}

export function activationProblems(snapshot, snapshotSha256, backup, upload, manifestSha256, now = Date.now()) {
  const out = [], fresh = at => { const age = now - Date.parse(at); return age >= 0 && age < HOUR_MS; };
  if (!fresh(snapshot.at)) out.push('the snapshot is over an hour old: rerun from snapshot');
  if (!fresh(backup.at)) out.push('the backup is over an hour old: rerun from backup');
  if (backup.status !== 'pass' || backup.snapshotSha256 !== snapshotSha256) out.push('the backup receipt is not for this snapshot');
  if (backup.databases !== snapshot.remote.databases || backup.quickChecks !== backup.databases) out.push('the backup does not cover every database');
  if (upload.sha !== snapshot.candidate || upload.manifestSha256 !== manifestSha256) out.push('the upload receipt does not match the local manifest');
  return out;
}

const fail = lines => { for (const l of lines) console.log(l); process.exit(1); };
export function main(argv) {
  const [cmd, ...a] = argv;
  if (cmd === 'receipts') { const p = receiptProblems(read(a[0]), read(a[1]), a[2], digest(a[0])); if (p.length) fail(p); console.log('gate and ship receipts are clean for this commit'); }
  else if (cmd === 'snapshot') {
    const health = read(a[0]), remote = read(a[1]), p = snapshotProblems(health, remote, a[2]); if (p.length) fail(p);
    if (existsSync(a[3])) { const aside = `${a[3]}.${Date.now()}`; renameSync(a[3], aside); console.log(`kept the earlier snapshot as ${aside.split('/').pop()}`); }
    const publicHealth = Object.fromEntries(HEALTH_KEYS.map(k => [k, health[k]]));
    writeFileSync(a[3], JSON.stringify({ schema: 'ship-snapshot/1', at: new Date().toISOString(), candidate: a[2], previousBuild: remote.productionTarget.split('/').pop(), publicHealth, remote, databaseContentsRead: false }, null, 2) + '\n', { flag: 'wx' });
    console.log(`${remote.worlds} worlds, ${remote.databases} databases, previous ${remote.productionTarget.split('/').pop()}`);
  } else if (cmd === 'drift') { const p = driftProblems(read(a[0]), read(a[1]), read(a[2])); if (p.length) fail(p); console.log('live metadata equals the snapshot'); }
  else if (cmd === 'backup') {
    const r = backupReceipt(readFileSync(a[0], 'utf8'), readFileSync(a[1], 'utf8'), read(a[2]), digest(a[2]), a[3]);
    writeFileSync(a[4], JSON.stringify(r, null, 2) + '\n', { flag: 'wx' }); console.log(`${r.databases} databases copied, compared and quick-checked`);
  } else if (cmd === 'activation') { const p = activationProblems(read(a[0]), digest(a[0]), read(a[1]), read(a[2]), digest(a[3])); if (p.length) fail(p); console.log('snapshot, backup and upload are fresh and agree'); }
  else if (cmd === 'health') { const h = read(a[0]); if (!h.ok || !h.hostOk || h.build !== a[1] || h.worlds !== Number(a[2])) fail([`healthz: ok ${h.ok}, hostOk ${h.hostOk}, build ${h.build}, worlds ${h.worlds}`]); console.log(`healthz ok, ${h.build}, ${h.worlds} worlds`); }
  else fail([`unknown command ${cmd}`]);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)); } catch (e) { fail([e.message]); }
}
