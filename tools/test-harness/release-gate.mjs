#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This is the CPU-only contract, not a discovery list supplied by a candidate.
export const REQUIRED_STEPS = [
  'V1-types', 'V2-build-root', 'V2-build-worlds', 'V3-packages',
  'V3-mars-engine', 'V3-client-cli', 'V3-launcher-unit', 'V3-harness', 'V3-walk', 'V3-bundle', 'V4-web',
  'V5-server-full', 'V6-scenarios', 'V6-party', 'V6-souls-r2',
  'V6-join-clerk', 'V6-join-dev', 'V6-mars-two', 'V6-lm-two',
];
// The launcher e2e (tools/god-skill/e2e/launcher.mjs) is not a CPU gate step: Z3 (2026-10-20) took the stale V6-launcher out;
// GT (B8, 2026-10-20) rewrote it against the one-view God modal and it runs in V7 (v7-walks.sh), in real Chrome.
// V3-walk (lane WALK, 2026-10-21): walkability of fixed world fixtures + a fresh Eden 2026 genesis against tools/test-harness/walk/baseline.
// V3-bundle (lane BUDGET, 2026-10-22): web chunk/total sizes of V2-build-root's apps/web/dist against tools/test-harness/bundle-budget/baseline.json.
const TAP_STEPS = new Set(['V3-packages', 'V3-mars-engine', 'V3-client-cli', 'V3-launcher-unit', 'V3-harness', 'V3-walk', 'V3-bundle', 'V4-web', 'V5-server-full']);
export const REQUIRED_PACKAGES = ['music', 'engine-mars', 'world-compiler', 'generators', 'ground', 'kernel', 'brain', 'engine-toy', 'engine-contract', 'protocol', 'engine-native', 'conformance'];
/** Runs made before 2026-10-16 name the EF4 conformance package by its old directory, packages/catalog. */
const PACKAGE_ALIASES = { catalog: 'conformance' };
const STEP_EXCLUSIONS = new Set(); // No step is excluded whole any more (the launcher e2e moved to V7, see above).
const CASE_STEPS = new Set(REQUIRED_STEPS.filter(step => step.startsWith('V6-')));
const EXPECTED_SKIP = ['V7', 'V8'];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const key = (step, id) => `${step}\u0000${id}`;
const unquote = s => s?.replace(/^['"]|['"]$/g, '').replace(/''/g, "'");
const sourceFile = s => unquote(s)?.replace(/^file:\/\//, '').replace(/^.*\/work\/(?:head|base)\//, '').replace(/:\d+(?::\d+)?$/, '');

/** Parse Node's raw TAP, retaining every assertion rather than failed-file names.
 * An enclosing suite's subtestsFailed result is coverage, never a blanket waiver.
 * Missing final plans/counters, loader failures and cancellations fail closed.
 */
export function parseTap(raw, label = 'TAP') {
  const lines = raw.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
  const documents = [], errors = [], tests = [], packageExits = {};
  let doc, stack = [], diagnostic, packageName = '';
  const finish = () => {
    if (!doc) return;
    if (!doc.ended || doc.plan === undefined) errors.push(`${label}: incomplete TAP (${doc.prefix || 'root'})`);
    if (doc.plan !== doc.nodes.filter(n => n.indent === 0).length) errors.push(`${label}: root plan/result mismatch`);
    for (const n of doc.nodes) if (!n.status) errors.push(`${label}: missing result for ${n.name}`);
    const c = doc.counts;
    for (const k of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
      if (!Number.isInteger(c[k])) errors.push(`${label}: missing TAP ${k} counter`);
    }
    if (doc.nodes.length !== c.tests + (c.suites || 0)) errors.push(`${label}: incomplete assertion inventory`);
    if (c.tests !== c.pass + c.fail + c.cancelled + c.skipped + c.todo) errors.push(`${label}: inconsistent TAP counters`);
    if (c.cancelled) errors.push(`${label}: cancelled tests (${c.cancelled})`);
    documents.push(doc);
    doc = undefined; stack = []; diagnostic = undefined;
  };
  for (const line of lines) {
    const pkgExit = /^## ([\w-]+) exit=(\d+)$/.exec(line);
    if (pkgExit) { packageExits[pkgExit[1]] = Number(pkgExit[2]); continue; }
    const pkg = /^## ([\w-]+)$/.exec(line);
    if (pkg) { finish(); packageName = pkg[1]; continue; }
    if (line === 'TAP version 13') {
      finish(); doc = { prefix: packageName, nodes: [], counts: {}, ended: false }; continue;
    }
    if (/^\s*Bail out!/.test(line)) errors.push(`${label}: TAP bailout`);
    if (!doc) continue;
    if (diagnostic) {
      if (/^\s*\.\.\.\s*$/.test(line)) { diagnostic = undefined; continue; }
      const field = /^(\s*)(type|location|failureType|exitCode|code):\s*(.*)$/.exec(line);
      if (field && field[1].length === diagnostic.indent + 2) diagnostic[field[2]] = unquote(field[3]);
      continue;
    }
    const sub = /^( *)# Subtest: (.*)$/.exec(line);
    if (sub) {
      const indent = sub[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const parent = stack.at(-1);
      const n = { indent, name: sub[2], ancestors: parent ? [...parent.ancestors, parent.name] : [], children: [] };
      if (parent) parent.children.push(n);
      doc.nodes.push(n); stack.push(n); continue;
    }
    const result = /^( *)(not ok|ok) \d+ - (.*?)(?:\s+# (SKIP|TODO)(?:\s+(.*))?)?$/.exec(line);
    if (result) {
      const indent = result[1].length;
      const n = [...stack].reverse().find(n => n.indent === indent && !n.status);
      if (!n || n.name !== result[3]) { errors.push(`${label}: unmatched TAP assertion ${result[3]}`); continue; }
      n.status = result[4]?.toLowerCase() || (result[2] === 'ok' ? 'pass' : 'fail');
      n.directive = result[5] || '';
      diagnostic = n;
      continue;
    }
    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) { if (doc.plan !== undefined) errors.push(`${label}: duplicate root plan`); doc.plan = Number(plan[1]); }
    const count = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (count) {
      if (doc.counts[count[1]] !== undefined) errors.push(`${label}: duplicate TAP counter`);
      doc.counts[count[1]] = Number(count[2]);
    }
    if (/^# duration_ms [\d.]+$/.test(line)) doc.ended = true;
  }
  finish();
  if (!documents.length) errors.push(`${label}: no complete Node TAP output`);
  const occurrences = new Map();
  for (const d of documents) for (const n of d.nodes) {
    const title = [...(d.prefix ? [d.prefix] : []), ...n.ancestors, n.name].join(' > ');
    const ordinal = (occurrences.get(title) || 0) + 1;
    occurrences.set(title, ordinal);
    const id = title + (ordinal > 1 ? ` [duplicate ${ordinal}]` : '');
    const aggregate = n.failureType === 'subtestsFailed';
    // A file that never loaded hides its test inventory, so cannot be quarantined.
    const loader = n.status === 'fail' && /(?:^|\/)\S+\.test\.(?:[cm]?[jt]sx?)$/.test(n.name) && (n.exitCode !== undefined || !n.children.length);
    if (n.failureType === 'cancelledByParent' || n.failureType === 'testTimeoutFailure') errors.push(`${label}: cancelled/timed-out test ${id}`);
    if (n.status === 'fail' && ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'EADDRINUSE', 'ENOSPC', 'ENOMEM', 'EMFILE', 'ENFILE', 'ECONNREFUSED', 'ERR_WORKER_OUT_OF_MEMORY'].includes(n.code)) errors.push(`${label}: infrastructure error ${n.code}: ${id}`);
    tests.push({ id, status: n.status, aggregate, loader, source: sourceFile(loader ? n.name : n.location), directive: n.directive });
  }
  const counts = { tests: 0, suites: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0 };
  for (const d of documents) {
    for (const k of Object.keys(counts)) counts[k] += k === 'topLevel' ? d.plan || 0 : d.counts[k] || 0;
  }
  return { tests, errors, counts, documents: documents.length, packages: documents.map(d => d.prefix), packageExits };
}

export function validateQuarantine(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw Error('quarantine.json must use schemaVersion 1 and entries[]');
  if (!Array.isArray(manifest.scopeExclusions) || JSON.stringify(manifest.scopeExclusions.map(e => e.step).sort()) !== JSON.stringify([...EXPECTED_SKIP].sort()) || !manifest.scopeExclusions.every(e => [e.owner, e.reason].every(v => typeof v === 'string' && v.trim()))) throw Error('scopeExclusions must document exactly V7 and V8 with owner and reason');
  const seen = new Set();
  for (const e of manifest.entries) {
    if (![e.step, e.id, e.reason, e.owner].every(v => typeof v === 'string' && v.trim())) throw Error('every quarantine needs step, id, reason and owner');
    if (!REQUIRED_STEPS.includes(e.step)) throw Error(`unknown quarantine step ${e.step}`);
    if (CASE_STEPS.has(e.step)) throw Error(`V6 scenario failures cannot be quarantined: ${e.step}`);
    if (!['fail', 'skip', 'todo'].includes(e.status || 'fail')) throw Error(`invalid quarantine status ${e.status}`);
    if (e.kind === 'step' ? (!STEP_EXCLUSIONS.has(e.step) || e.id !== '*') : (e.id === '*' || e.kind && e.kind !== 'test')) throw Error(`invalid broad quarantine ${e.step}/${e.id}`);
    const k = key(e.step, e.id);
    if (seen.has(k)) throw Error(`duplicate quarantine ${e.step}/${e.id}`);
    seen.add(k);
  }
  return new Map(manifest.entries.map(e => [key(e.step, e.id), e]));
}

/** renames.json: reviewed renames and replacements of baseline assertions. A listed baseline id that is gone from the
 * candidate is satisfied only when every replacement id ran and passed there (compareRuns); nothing unlisted is. */
export function validateRenames(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw Error('renames.json must use schemaVersion 1 and entries[]');
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const out = new Map();
  for (const e of manifest.entries) {
    const to = typeof e.to === 'string' ? [e.to] : e.to;
    if (![e.step, e.from, e.reason].every(text) || !Array.isArray(to) || !to.length || !to.every(text)) throw Error('every rename needs step, from, to (an id or a list of ids) and reason');
    if (typeof e.pr !== 'string' || !/^#\d+$/.test(e.pr)) throw Error(`rename ${e.step}/${e.from}: pr must be "#<number>"`);
    if (!REQUIRED_STEPS.includes(e.step)) throw Error(`unknown rename step ${e.step}`);
    if (CASE_STEPS.has(e.step)) throw Error(`V6 scenarios cannot be renamed away: ${e.step}`);
    if (to.includes(e.from) || new Set(to).size !== to.length) throw Error(`rename ${e.step}/${e.from}: replacements must be distinct from it and from each other`);
    const k = key(e.step, e.from);
    if (out.has(k)) throw Error(`duplicate rename ${e.step}/${e.from}`);
    out.set(k, { ...e, to });
  }
  return out;
}

/** Validate a returned Modal directory; exported for synthetic, port-free proof. */
export function readRun(dir, expected, manifest, requiredSteps = REQUIRED_STEPS, options = {}) {
  const errors = [], steps = {}, evidence = {};
  const q = validateQuarantine(manifest);
  const read = path => {
    if (!lstatSync(path).isFile() || !realpathSync(path).startsWith(realpathSync(dir) + '/')) throw Error('evidence must be a regular file inside the run');
    const b = readFileSync(path); evidence[path] = sha256(b);
    if (!isUtf8(b)) throw Error('evidence is not valid UTF-8');
    return b.toString();
  };
  let metadata;
  try {
    metadata = JSON.parse(read(join(dir, 'out/RUN-METADATA.json')));
    for (const [field, value] of Object.entries(expected)) {
      if (JSON.stringify(metadata[field]) !== JSON.stringify(value)) errors.push(`metadata mismatch: ${field}`);
    }
    if (metadata.only !== undefined && !('only' in expected)) errors.push('scoped run (a subset of steps) is not a full gate run');
    if (metadata.baselineSha !== null) errors.push('unexpected embedded baseline');
    if (JSON.stringify(metadata.skip) !== JSON.stringify(EXPECTED_SKIP)) errors.push('unexpected suite skips');
    if (!Array.isArray(metadata.serverFiles) || metadata.serverFiles.length) errors.push('bounded server suite is not a release gate');
    if (typeof metadata.nodeVersion !== 'string' || !metadata.nodeVersion.startsWith(`v${metadata.node}.`)) errors.push('missing/mismatched actual Node version');
    if (metadata.pnpmVersion !== '10.27.0') errors.push('missing/mismatched actual pnpm version');
  } catch (e) { errors.push(`missing/invalid run metadata: ${e.message}`); }
  try {
    const summaryPath = join(dir, 'out/suite/SUMMARY.tsv');
    const lines = read(summaryPath).trim().split(/\r?\n/);
    if (lines.shift() !== 'step\texit\tseconds\tlog') errors.push('invalid SUMMARY.tsv header');
    for (const line of lines) {
      const fields = line.split('\t');
      if (fields.length !== 4) { errors.push(`malformed summary row: ${line}`); continue; }
      const [step, exit, seconds, remoteLog] = fields;
      if (step === 'V8-history-boot' && exit === 'SKIP') continue;
      if (!requiredSteps.includes(step) || steps[step]) { errors.push(`unexpected/duplicate step: ${step}`); continue; }
      if (!/^\d+$/.test(seconds)) errors.push(`${step}: invalid elapsed time`);
      const item = steps[step] = { exit, tests: [], log: remoteLog === '-' ? null : join(dir, 'out/suite', basename(remoteLog)) };
      const excluded = q.get(key(step, '*'));
      if (exit === 'QUARANTINE' && excluded?.kind === 'step') {
        try { if (!read(item.log).includes(excluded.reason)) errors.push(`${step}: exclusion reason not in log`); }
        catch { errors.push(`${step}: missing quarantine explanation log`); }
        continue;
      }
      if (!/^\d+$/.test(exit)) { errors.push(`${step}: unexpected status ${exit}`); continue; }
      if ([124, 137, 142, 143].includes(Number(exit)) || Number(exit) >= 128) errors.push(`${step}: timeout/signal/infrastructure exit ${exit}`);
      let raw;
      try { raw = read(item.log); if (!raw.trim() && step !== 'V1-types') errors.push(`${step}: empty log`); }
      catch { errors.push(`${step}: missing log`); continue; }
      if (CASE_STEPS.has(step)) {
        try {
          const cases = JSON.parse(read(join(dir, `out/suite/${step}-cases.json`)));
          if (cases.schemaVersion !== 1 || cases.completed !== true || !Array.isArray(cases.steps) || !cases.steps.length || !Array.isArray(cases.harnessFailures) || typeof cases.sourceReport !== 'string' || !cases.sourceReport) errors.push(`${step}: missing/incomplete scenario case inventory`);
          else {
            const seen = new Set();
            for (const c of cases.steps) {
              if (typeof c.id !== 'string' || !c.id || !['pass', 'fail'].includes(c.status) || seen.has(c.id)) { errors.push(`${step}: malformed/duplicate scenario case`); continue; }
              seen.add(c.id); item.tests.push({ id: c.id, status: c.status, aggregate: false, directive: '' });
            }
            if (cases.harnessFailures.length) errors.push(`${step}: scenario harness failures: ${cases.harnessFailures.join(', ')}`);
            const failures = item.tests.filter(t => t.status === 'fail');
            if (Number(exit) === 0 && failures.length) errors.push(`${step}: scenario failures hidden by zero exit`);
            if (Number(exit) !== 0 && !failures.length && !cases.harnessFailures.length) errors.push(`${step}: nonzero exit without scenario failure evidence`);
          }
        } catch (e) { errors.push(`${step}: missing/invalid scenario case inventory: ${e.message}`); }
      } else if (TAP_STEPS.has(step)) {
        const tap = parseTap(raw, step); item.tests = tap.tests; errors.push(...tap.errors);
        if (step === 'V3-packages') {
          const alias = (p) => PACKAGE_ALIASES[p] ?? p;
          tap.packages = tap.packages.map(alias); tap.packageExits = Object.fromEntries(Object.entries(tap.packageExits).map(([p, x]) => [alias(p), x]));
          for (const t of tap.tests) { const [p, ...rest] = t.id.split(' > '); if (rest.length && PACKAGE_ALIASES[p]) t.id = [PACKAGE_ALIASES[p], ...rest].join(' > '); }
          if (JSON.stringify([...tap.packages].sort()) !== JSON.stringify([...REQUIRED_PACKAGES].sort())) errors.push(`${step}: missing/duplicate package test output`);
          for (const p of REQUIRED_PACKAGES) {
            if (!Number.isInteger(tap.packageExits[p])) errors.push(`${step}: missing package exit for ${p}`);
            else if (tap.packageExits[p] !== 0 && !tap.tests.some(t => t.id.startsWith(`${p} > `) && t.status === 'fail')) errors.push(`${step}: package ${p} failed without assertion evidence`);
          }
        }
        const failures = tap.tests.filter(t => t.status === 'fail' && !t.aggregate);
        if (Number(exit) === 0 && failures.length) errors.push(`${step}: failure hidden by zero exit`);
        if (Number(exit) !== 0 && !failures.length) errors.push(`${step}: nonzero exit without test failure evidence`);
        if (step === 'V4-web' || step === 'V3-harness') {
          try {
            const attributionPath = join(dir, `out/suite/${step}-files.jsonl`);
            const events = read(attributionPath).trim().split(/\r?\n/).map(line => JSON.parse(line));
            if (events.at(-1)?.event !== 'test:summary') errors.push(`${step}: incomplete executed-files attribution`);
            const finalCounts = events.at(-1)?.counts;
            const countNames = { tests: 'tests', suites: 'suites', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo', topLevel: 'topLevel' };
            for (const [tapName, reporterName] of Object.entries(countNames)) {
              if (finalCounts?.[reporterName] !== tap.counts[tapName]) errors.push(`${step}: executed-files/TAP ${tapName} count mismatch`);
            }
            const executed = new Set();
            for (const event of events) {
              if (event.event === 'test:summary') continue;
              if (!['test:pass', 'test:fail'].includes(event.event) || typeof event.file !== 'string' || typeof event.name !== 'string' || !['test', 'suite'].includes(event.type)) {
                errors.push(`${step}: malformed executed-files attribution`); continue;
              }
              const file = sourceFile(event.file);
              if (event.type === 'test' && !event.skip && !event.todo && sourceFile(event.name) !== file) executed.add(file);
            }
            item.executedFiles = [...executed];
          } catch (e) { errors.push(`${step}: missing/invalid executed-files attribution: ${e.message}`); }
        }
      } else if (Number(exit) !== 0) errors.push(`${step}: non-test/infrastructure failure (exit ${exit})`);
    }
    for (const step of requiredSteps) if (!steps[step]) errors.push(`missing mandatory step: ${step}`);
  } catch (e) { errors.push(`missing/invalid summary: ${e.message}`); }
  let collectionRecovery;
  if (metadata && metadata.suiteCompleted !== true) {
    try {
      collectionRecovery = recoverAssetCollisions(dir, metadata, requiredSteps, read, options.root || ROOT);
    } catch (e) { errors.push(`Modal suite did not complete: ${e.message}`); }
  }
  return { dir: resolve(dir), metadata, steps, evidence, errors, ...(collectionRecovery && { collectionRecovery }) };
}

// Historical collector compatibility, not a waiver: this exact collector discards duplicate informational asset
// diagnostics after retaining every group's completion/summary and V5 shards. Future collectors fail closed here.
const ASSET_COLLISION_COLLECTOR = 'f2812707466098b30ab8fd7f280cd65bee6a8481';
const COLLISION_GROUPS = {
  a: { only: 'V1-types,V2-build-root,V2-build-worlds,V3-harness,V3-bundle,V3-packages,V4-web,V4-web-baseline,V6-scenarios,V6-join-clerk,V6-join-dev,V7-old-worlds,V7-new-world,V7-camera-dpr2,V7-god-modal,V8-history-boot', shard: null, suiteExit: 0 },
  s: { only: 'V3-walk,V3-mars-engine,V3-client-cli,V3-launcher-unit,V6-party,V6-souls-r2,V6-souls-ux,V6-mars-two,V6-lm-two', shard: null, suiteExit: 0 },
  'v5-1': { only: 'V5-server-full', shard: '1/2', suiteExit: 0 },
  'v5-2': { only: 'V5-server-full', shard: '2/2', suiteExit: 0 },
};
function verifyHarnessArchive(metadata, root) {
  if (!/^[0-9a-f]{40}$/.test(metadata.harnessRef || '')) throw Error('missing exact harness commit');
  if (gitAt(root, 'rev-parse', `${metadata.harnessRef}:tools/test-harness`) !== metadata.harnessTree) throw Error('metadata mismatch: harnessTree');
  const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar.gz', metadata.harnessRef, 'tools/test-harness'], { maxBuffer: MAX_BUFFER });
  if (sha256(archive) !== metadata.harnessArchiveSha256) throw Error('metadata mismatch: harnessArchiveSha256');
}
function recoverAssetCollisions(dir, m, requiredSteps, read, root) {
  const require = (ok, why) => { if (!ok) throw Error(`asset collection recovery: ${why}`); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  require(m.suiteCompleted === false && m.suiteExit === 0 && m.only === undefined && same(requiredSteps, REQUIRED_STEPS), 'not a full completed execution');
  verifyHarnessArchive(m, root);
  require(gitAt(root, 'rev-parse', `${m.harnessRef}:tools/test-harness/modal_suite.py`) === ASSET_COLLISION_COLLECTOR, 'unsupported collector');
  require(same(m.fanout?.groups, COLLISION_GROUPS), 'unexpected group plan');
  const problems = ['s', 'v5-1', 'v5-2'].map(g => `group ${g}: file collision V0-assets.log`);
  require(same(m.fanout?.problems, problems), 'unexpected collector problems');
  require(same(readdirSync(join(dir, 'out/groups')).sort(), Object.keys(COLLISION_GROUPS).sort()), 'missing/extra retained group');
  require(/^[0-9a-f]{40}$/.test(m.sourceSha || '') && /^[0-9a-f]{64}$/.test(m.sourceArchiveSha256 || ''), 'missing source identity');
  read(join(dir, 'out/suite/V0-assets.log')); // --check --quiet legitimately produces an empty file.
  const rows = path => {
    const lines = read(path).trimEnd().split('\n');
    require(lines.shift() === 'step\texit\tseconds\tlog', 'invalid group summary header');
    const parsed = lines.map(l => l.split('\t'));
    require(parsed.every(r => r.length === 4 && /^\d+$/.test(r[2]) && (r[3] === '-' || r[3] === `/out/suite/${r[0]}.log`)), 'malformed group summary');
    require(new Set(parsed.map(r => r[0])).size === parsed.length, 'duplicate summary row');
    return parsed;
  };
  const summaries = {};
  for (const [name, plan] of Object.entries(COLLISION_GROUPS)) {
    const gm = JSON.parse(read(join(dir, 'out/groups', name, 'RUN-METADATA.json')));
    const { fanout, suiteCompleted, ...identity } = m;
    require(same(Object.keys(gm).sort(), [...Object.keys(identity), 'suiteCompleted'].sort()), `${name}: metadata fields differ`);
    require(gm.suiteCompleted === true && Object.entries(identity).every(([k, v]) => same(gm[k], v)), `${name}: incomplete or mismatched identity/runtime`);
    const rs = summaries[name] = rows(join(dir, 'out/groups', name, 'SUMMARY.tsv'));
    const wanted = plan.only.split(',').filter(s => REQUIRED_STEPS.includes(s) || s === 'V8-history-boot');
    require(same(rs.map(r => r[0]), wanted), `${name}: missing/extra/reordered steps`);
    for (const r of rs) require(r[0] === 'V8-history-boot' ? same(r, ['V8-history-boot', 'SKIP', '0', '-']) : /^\d+$/.test(r[1]) && r[3] === `/out/suite/${r[0]}.log`, `${name}: unexpected exit/log`);
  }
  const all = gitAt(root, 'ls-tree', '-r', '--name-only', m.sourceSha, '--', 'apps/server/src').split('\n')
    .filter(f => f.endsWith('.test.ts')).map(f => f.slice('apps/server/'.length)).sort().join('\n') + '\n';
  require(all !== '\n', 'empty source server inventory');
  const picked = [], logs = [], attribution = [];
  for (const name of ['v5-1', 'v5-2']) {
    const path = file => join(dir, 'out/groups', name, file);
    require(read(path('V5-all-files.txt')) === all, `${name}: server inventory differs from source`);
    picked.push(read(path('V5-shard-files.txt')));
    require(picked.at(-1).trim().length > 0, `${name}: empty shard`);
    logs.push(read(path('V5-server-full.log')));
    attribution.push(read(path('V5-server-full-files.jsonl')));
    const parsed = parseTap(logs.at(-1), name), events = attribution.at(-1).trim().split('\n').map(JSON.parse);
    require(!parsed.errors.length, `${name}: incomplete server TAP`);
    require(events.at(-1)?.event === 'test:summary', `${name}: incomplete server attribution`);
    const exit = Number(summaries[name][0][1]), failures = parsed.tests.filter(t => t.status === 'fail' && !t.aggregate);
    require(exit < 128 && exit !== 124 && (exit === 0 ? !failures.length : failures.length > 0), `${name}: exit/assertion mismatch or infrastructure exit`);
    const counters = { tests: 'tests', suites: 'suites', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo', topLevel: 'topLevel' };
    require(Object.entries(counters).every(([k, v]) => parsed.counts[k] === events.at(-1).counts?.[v]), `${name}: attribution/TAP counts differ`);
    const files = new Set();
    for (const event of events.slice(0, -1)) {
      // Node emits per-file summaries too; the last event is the complete shard's aggregate (checked above).
      if (event.event === 'test:summary') continue;
      require(['test:pass', 'test:fail'].includes(event.event) && typeof event.file === 'string' && typeof event.name === 'string' && ['test', 'suite'].includes(event.type), `${name}: malformed server attribution`);
      files.add(sourceFile(event.file).replace(/^apps\/server\//, ''));
    }
    require([...files].sort().join('\n') + '\n' === picked.at(-1), `${name}: executed files differ from shard inventory`);
  }
  require(picked.join('') === all, 'server shards are not an exact ordered cover');
  require(read(join(dir, 'out/suite/V5-server-full.log')) === logs.join(''), 'merged server log differs from shards');
  require(read(join(dir, 'out/suite/V5-server-full-files.jsonl')) === attribution.join(''), 'merged server attribution differs from shards');
  const shardRows = [summaries['v5-1'][0], summaries['v5-2'][0]];
  const server = ['V5-server-full', String(Math.max(...shardRows.map(r => Number(r[1])))), String(Math.max(...shardRows.map(r => Number(r[2])))), '/out/suite/V5-server-full.log'];
  const merged = [...summaries.a, ...summaries.s, server].sort(([a], [b]) => a.localeCompare(b));
  require(same(rows(join(dir, 'out/suite/SUMMARY.tsv')).sort(([a], [b]) => a.localeCompare(b)), merged), 'merged summary differs from groups');
  return { schemaVersion: 1, kind: 'informational-assets-collision', rawSuiteCompleted: false, executionCompleted: true,
    collectorBlob: ASSET_COLLISION_COLLECTOR, groups: Object.keys(COLLISION_GROUPS), problems, serverFiles: all.trimEnd().split('\n').length };
}

/** options.driverTestsChanged: the cached baseline ran other laptop-side driver files (same suite tree, see DRIVER_ONLY);
 * their own V3-harness self-tests may then be renamed or removed without that counting as lost coverage.
 * options.renames: validateRenames() of renames.json; a listed baseline id gone from the candidate is renamed, not
 * removed, only when every replacement id ran and passed in the candidate's same step. */
export function compareRuns(baseline, candidate, manifest, candidateSourceFiles = new Set(), options = {}) {
  const q = validateQuarantine(manifest);
  const blockers = [...baseline.errors.map(e => `baseline: ${e}`), ...candidate.errors.map(e => `candidate: ${e}`)];
  if (baseline.metadata && candidate.metadata) for (const field of ['nodeVersion', 'pnpmVersion']) {
    if (baseline.metadata[field] !== candidate.metadata[field]) blockers.push(`baseline/candidate runtime mismatch: ${field}`);
  }
  const fixed = [], quarantined = [], newFailures = [], removed = [], unexpectedSkips = [], added = [], driverTestsRemoved = [], renamed = [];
  const renames = options.renames ?? new Map();
  for (const [step, b] of Object.entries(baseline.steps)) {
    const c = candidate.steps[step]; if (!c) continue;
    if (b.exit === 'QUARANTINE' || c.exit === 'QUARANTINE') {
      if (b.exit !== c.exit) blockers.push(`${step}: step exclusion changed between runs`);
      else quarantined.push({ step, id: '*', ...q.get(key(step, '*')) });
      continue;
    }
    const bt = new Map(b.tests.map(t => [t.id, t]));
    const ct = new Map(c.tests.map(t => [t.id, t]));
    for (const t of b.tests) {
      const now = ct.get(t.id);
      if (t.loader) {
        const stillBroken = c.tests.some(n => n.loader && n.source === t.source);
        if (!candidateSourceFiles.has(t.source)) removed.push({ step, id: t.id, source: t.source });
        else if (!stillBroken && c.executedFiles?.includes(t.source)) fixed.push({ step, id: t.id, source: t.source, kind: 'repaired-loader' });
        else if (!stillBroken) blockers.push(`${step}: no executed test attribution for baseline loader ${t.source}`);
        continue;
      }
      if (!now) {
        const rename = renames.get(key(step, t.id));
        if (options.driverTestsChanged && step === 'V3-harness' && DRIVER_ONLY.some(f => t.source === `tools/test-harness/${f}`)) driverTestsRemoved.push({ step, id: t.id, source: t.source });
        else if (rename) {
          const notPassing = rename.to.filter(id => ct.get(id)?.status !== 'pass');
          if (notPassing.length) removed.push({ step, id: t.id, rename: { to: rename.to, notPassing } });
          else renamed.push({ step, from: t.id, to: rename.to, reason: rename.reason, pr: rename.pr });
        } else removed.push({ step, id: t.id });
        continue;
      }
      if (t.status === 'fail' && !t.aggregate) {
        const entry = q.get(key(step, t.id));
        if (now.status !== 'pass' && (!entry || (entry.status || 'fail') !== 'fail')) blockers.push(`${step}: baseline failure has no quarantine: ${t.id}`);
        if (now.status === 'pass') fixed.push({ step, id: t.id });
      }
    }
    for (const t of c.tests) {
      const before = bt.get(t.id);
      if (!before) added.push({ step, id: t.id });
      if (t.loader) { blockers.push(`${step}: candidate test file did not load: ${t.id}`); continue; }
      if (t.status === 'fail' && !t.aggregate) {
        const entry = q.get(key(step, t.id));
        if (before?.status !== 'fail' || before.source !== t.source) newFailures.push({ step, id: t.id, source: t.source });
        else if (!entry || (entry.status || 'fail') !== 'fail') blockers.push(`${step}: unquarantined failure: ${t.id}`);
        else quarantined.push({ step, id: t.id, reason: entry.reason, owner: entry.owner, status: 'fail' });
      }
      if (t.status === 'skip' || t.status === 'todo') {
        const entry = q.get(key(step, t.id));
        if (before?.status !== t.status || before.directive !== t.directive || !entry || entry.status !== t.status) unexpectedSkips.push({ step, id: t.id, status: t.status });
        else quarantined.push({ step, id: t.id, reason: entry.reason, owner: entry.owner, status: t.status });
      }
    }
    // Baseline skips also need an explicit reason even when a candidate fixes them.
    for (const t of b.tests.filter(t => ['skip', 'todo'].includes(t.status))) {
      if (q.get(key(step, t.id))?.status !== t.status) blockers.push(`${step}: undocumented baseline ${t.status}: ${t.id}`);
    }
  }
  if (newFailures.length) blockers.push(`${newFailures.length} new test failure(s)`);
  if (removed.length) blockers.push(`${removed.length} baseline assertions removed`);
  if (unexpectedSkips.length) blockers.push(`${unexpectedSkips.length} unexpected test skip(s)/TODO(s)`);
  return { status: blockers.length ? 'blocked' : quarantined.length ? 'quarantined' : 'pass', blockers, fixed, quarantined, newFailures, removed, renamed, unexpectedSkips, added, ...(options.driverTestsChanged && { driverTestsRemoved }) };
}

const MAX_BUFFER = 64 * 1024 * 1024;
function gitAt(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim(); }
async function remoteRun(out, sourceSha, harnessRef, node, root = ROOT, only = []) {
  mkdirSync(out, { recursive: true });
  const logPath = join(out, 'gate-driver.log');
  const logFd = openSync(logPath, 'w');
  const child = spawn('bash', [join(root, 'tools/test-harness/remote-suite.sh'), out, '--ref', sourceSha, '--baseline-ref', 'none', '--harness-ref', harnessRef, '--node', node, ...(only.length ? ['--only', only.join(',')] : [])], {
    // Modal auth comes from the caller: MODAL_TOKEN_ID/MODAL_TOKEN_SECRET (CI) or a MODAL_PROFILE of their own; no default.
    cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
  child.stdout.on('data', b => writeSync(logFd, b)); child.stderr.on('data', b => writeSync(logFd, b));
  let timedOut = false;
  let killTimeout;
  const timeout = setTimeout(() => {
    timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
  }, (4 * 3600 + 600) * 1000);
  const rc = await new Promise(resolve => {
    child.once('error', e => { writeSync(logFd, e.message); resolve(127); });
    child.once('close', (code, signal) => resolve(code ?? `signal:${signal}`));
  });
  clearTimeout(timeout); clearTimeout(killTimeout); closeSync(logFd);
  return { exit: rc, timedOut, log: logPath, logSha256: sha256(readFileSync(logPath)) };
}

// ── Baseline cache (team/lanes/MODAL-POLICY.md rule 1: no baseline re-runs) ─────────────────────────────────────────────
// A completed, validated run is stored as <cache>/<sourceSha>-<suiteTree>-node<major>/ (its out/ plus CACHE.json, which
// records every file's sha256). The key is the harness that executed inside the containers, not the harness commit
// (git archive bytes embed the commit id) and not the laptop-side driver: suiteTree hashes the tools/test-harness
// entries (mode, type, blob sha, path) without DRIVER_ONLY, in path order. Runtime (actual Node patch, pnpm) is checked
// against the candidate before comparing. Imported pairs keep the exact full harnessTree identity.
export const SUCCESS = new Set(['pass', 'quarantined']);
/** Laptop-side gate driver files (relative to tools/test-harness). Nothing here changes what a container runs, except
 * that V3-harness executes their self-tests, so compareRuns lets those be renamed against a cached baseline. Everything
 * else (modal_suite.py, remote-suite.sh, one-validation.sh, package-suite.sh, quarantine.json, step scripts,
 * v5-durations.json, campus-assets.json, …) stays in the key. */
export const DRIVER_ONLY = ['release-gate.mjs', 'ship-receipt.mjs', 'release-gate.test.mjs', 'ship-receipt.test.mjs', 'release-no-delete.test.mjs', 'REMOTE-SUITE.md'];
export function suiteTree(root, ref) {
  const lines = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--full-tree', ref, '--', 'tools/test-harness'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })
    .split('\n').filter(Boolean).map(line => { const [meta, path] = line.split('\t'); return [meta, path.slice('tools/test-harness/'.length)]; })
    .filter(([, path]) => !DRIVER_ONLY.includes(path)).sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!lines.length) throw Error(`no tools/test-harness in ${ref}`);
  return sha256(lines.map(([meta, path]) => `${meta}\t${path}\n`).join(''));
}
export const cacheKey = ({ sourceSha, suiteTree, node }) => `${sourceSha}-${suiteTree}-node${String(node).split('.')[0]}`;
/** Read a run for reuse under a suite identity: source, Node major and complete contract by readRun; the suite tree from
 * the run's own harness commit, which must also match the run's recorded full harnessTree. */
export function readSuiteRun(dir, { sourceSha, suiteTree: suite, node }, manifest, root = ROOT, requiredSteps = REQUIRED_STEPS, readOptions = {}) {
  const run = readRun(dir, { schemaVersion: 1, sourceSha, node }, manifest, requiredSteps, { ...readOptions, root });
  const ref = run.metadata?.harnessRef;
  try {
    verifyHarnessArchive(run.metadata, root);
    run.suiteTree = suiteTree(root, ref);
    if (run.suiteTree !== suite) run.errors.push('metadata mismatch: suiteTree');
  } catch (e) { run.errors.push(`unverifiable harness ${ref}: ${e.message.split('\n')[0]}`); }
  return run;
}
/** Identity of a solo --baseline-results import: the identical full harness tree (any harness commit). */
export const reuseIdentity = ({ sourceSha, harnessTree, node }) => ({ schemaVersion: 1, sourceSha, harnessTree, node });
export function defaultCacheDir(root = ROOT) {
  if (process.env.SIM_GATE_CACHE) return resolve(process.env.SIM_GATE_CACHE);
  for (let d = resolve(root); d !== dirname(d); d = dirname(d)) if (existsSync(join(d, 'team/lanes'))) return join(d, 'team/scratch/gates/cache');
  return join(resolve(root), '.lane/gate-cache');
}
const listFiles = (dir, rel = '') => readdirSync(join(dir, rel), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? listFiles(dir, join(rel, e.name)) : e.isFile() ? [join(rel, e.name)] : []).sort();
const hashTree = dir => Object.fromEntries(listFiles(dir).map(f => [f, sha256(readFileSync(join(dir, f)))]));
// No-delete rule: anything we abandon moves to the Trash, like remote-suite.sh's stage.
function retire(path) {
  const trash = join(homedir(), '.Trash'); mkdirSync(trash, { recursive: true });
  renameSync(path, join(trash, `${basename(path)}-${Date.now()}`));
}

export function lookupCache(cacheDir, identity, manifest, requiredSteps = REQUIRED_STEPS, readOptions = {}, root = ROOT) {
  const key = cacheKey(identity), dir = join(cacheDir, key);
  if (!existsSync(join(dir, 'CACHE.json'))) return { hit: false, key, dir, reason: 'no cached run' };
  let entry;
  try { entry = JSON.parse(readFileSync(join(dir, 'CACHE.json'), 'utf8')); } catch (e) { return { hit: false, key, dir, reason: `unreadable CACHE.json: ${e.message}` }; }
  if (entry.key !== key) return { hit: false, key, dir, reason: 'cache entry key mismatch' };
  let now;
  try { now = hashTree(join(dir, 'out')); } catch (e) { return { hit: false, key, dir, reason: `unreadable cached run: ${e.message}` }; }
  const recorded = entry.files || {};
  const changed = [...new Set([...Object.keys(recorded), ...Object.keys(now)])].filter(f => recorded[f] !== now[f]);
  if (!Object.keys(recorded).length || changed.length) return { hit: false, key, dir, reason: `cache entry changed since it was stored: ${changed.slice(0, 3).join(', ') || 'no file list'}` };
  if (entry.suiteTree !== identity.suiteTree) return { hit: false, key, dir, reason: 'cache entry suite tree mismatch' };
  const run = readSuiteRun(dir, identity, manifest, root, requiredSteps, readOptions);
  if (run.errors.length) return { hit: false, key, dir, reason: `cached run does not validate: ${run.errors.slice(0, 3).join('; ')}` };
  return { hit: true, key, dir, run, entry };
}

const BUNDLE_BASELINE = 'bundle-budget/baseline.json';
const BUNDLE_COMPARATOR = 'bundle-budget/budget.mjs';
const BUNDLE_TEST = 'bundle-budget/bundle-gate.test.mjs';
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const carryRequire = (value, message) => { if (!value) throw Error(`bundle baseline carry: ${message}`); };
const harnessEntries = (root, ref) => new Map(gitAt(root, 'ls-tree', '-r', '--full-tree', ref, '--', 'tools/test-harness')
  .split('\n').filter(Boolean).map(line => { const [meta, path] = line.split('\t'); return [path.slice('tools/test-harness/'.length), meta]; }));

/** Explicit, narrowly bounded reuse of an executed full baseline. Its raw run,
 * metadata, TAP and cache are never rewritten or stored under another identity.
 * Only new bundle-key expectations are evaluated from its original measurement;
 * the separate comparison view labels every derived assertion. */
export async function prepareBundleBaselineCarry(dir, { sourceSha, harnessRef, node, manifest, root = ROOT }) {
  dir = resolve(dir);
  const manifestPath = join(dir, 'CACHE.json'), manifestBytes = readFileSync(manifestPath), entry = JSON.parse(manifestBytes);
  carryRequire(entry.sourceSha === sourceSha && entry.node === node, 'cached source/Node major differs from the named baseline');
  const cached = lookupCache(dirname(dir), { sourceSha, suiteTree: entry.suiteTree, node }, manifest, REQUIRED_STEPS, {}, root);
  carryRequire(cached.hit && resolve(cached.dir) === dir, `original cache invalid: ${cached.reason || 'directory/key mismatch'}`);
  const original = cached.run, m = original.metadata;
  for (const field of ['sourceSha', 'harnessRef', 'harnessTree', 'harnessArchiveSha256', 'sourceArchiveSha256', 'node', 'nodeVersion', 'pnpmVersion'])
    carryRequire(entry[field] === m[field], `original cache/metadata differs: ${field}`);
  carryRequire(/^[0-9a-f]{40}$/.test(sourceSha) && /^[0-9a-f]{64}$/.test(m.sourceArchiveSha256 || ''), 'exact original source/archive identity required');
  gitAt(root, 'cat-file', '-e', `${sourceSha}^{commit}`);
  const oldArchive = execFileSync('git', ['-C', root, 'archive', '--format=tar.gz', m.harnessRef, 'tools/test-harness'], { maxBuffer: MAX_BUFFER });
  carryRequire(sha256(oldArchive) === m.harnessArchiveSha256, 'original harness archive differs');
  carryRequire(entry.provenance?.via === 'gate' && entry.provenance.label === 'candidate' && SUCCESS.has(entry.provenance.status), 'passing full-gate candidate provenance required');
  const qualificationPath = join(entry.provenance.gate, 'receipt.json'), qualificationBytes = readFileSync(qualificationPath), qualification = JSON.parse(qualificationBytes);
  carryRequire(SUCCESS.has(qualification.status) && qualification.refs?.candidate?.sha === sourceSha && qualification.scope?.resolved === 'full'
    && equalJson(qualification.scope.steps, REQUIRED_STEPS), 'original qualification does not name this full baseline');
  for (const field of ['blockers', 'newFailures', 'removed', 'unexpectedSkips'])
    carryRequire(Array.isArray(qualification[field]) && !qualification[field].length, `original qualification has ${field}`);
  carryRequire(equalJson(qualification.runs?.candidate?.metadata, m), 'qualified execution metadata differs from original cached execution');
  const ownSourceFiles = new Set(gitAt(root, 'ls-tree', '-r', '--name-only', sourceSha).split('\n'));
  carryRequire(!compareRuns(original, original, manifest, ownSourceFiles).blockers.length, 'original full run does not pass on its own terms');

  const oldEntries = harnessEntries(root, m.harnessRef), newEntries = harnessEntries(root, harnessRef);
  const changed = [...new Set([...oldEntries.keys(), ...newEntries.keys()])].filter(path => oldEntries.get(path) !== newEntries.get(path)).sort();
  const suiteChanges = changed.filter(path => !DRIVER_ONLY.includes(path));
  carryRequire(equalJson(suiteChanges, [BUNDLE_BASELINE]), 'only bundle-budget/baseline.json may change in the executed suite');
  const gitBytes = (ref, path) => execFileSync('git', ['-C', root, 'show', `${ref}:tools/test-harness/${path}`], { maxBuffer: MAX_BUFFER });
  const beforeBytes = gitBytes(m.harnessRef, BUNDLE_BASELINE), afterBytes = gitBytes(harnessRef, BUNDLE_BASELINE);
  const before = JSON.parse(beforeBytes), after = JSON.parse(afterBytes);
  carryRequire(equalJson(Object.keys(before).sort(), Object.keys(after).sort()) && before.schema === 'bundle-budget/1' && after.schema === before.schema,
    'baseline schema/fields changed');
  for (const field of Object.keys(before).filter(field => !['note', 'chunks'].includes(field)))
    carryRequire(equalJson(before[field], after[field]), `existing baseline ${field} changed`);
  carryRequire(Array.isArray(after.note) && after.note.every(note => typeof note === 'string'), 'baseline notes must remain data');
  const addedKeys = Object.keys(after.chunks).filter(key => !(key in before.chunks));
  carryRequire(addedKeys.length > 0, 'at least one explicit new-key registration required');
  for (const [key, value] of Object.entries(before.chunks))
    carryRequire(equalJson(value, after.chunks[key]), `existing chunk removed or budget changed: ${key}`);
  for (const key of addedKeys) {
    const value = after.chunks[key];
    carryRequire(equalJson(Object.keys(value).sort(), ['bytes', 'files', 'gzip']) && ['bytes', 'files', 'gzip'].every(k => Number.isSafeInteger(value[k]) && value[k] > 0),
      `invalid new-key budget: ${key}`);
  }
  const comparatorBytes = gitBytes(harnessRef, BUNDLE_COMPARATOR), testBytes = gitBytes(harnessRef, BUNDLE_TEST);
  carryRequire(sha256(readFileSync(join(root, 'tools/test-harness', BUNDLE_COMPARATOR))) === sha256(comparatorBytes), 'local comparator differs from committed unchanged code');
  const budget = await import(pathToFileURL(join(root, 'tools/test-harness', BUNDLE_COMPARATOR)));
  carryRequire(sha256(readFileSync(join(root, 'tools/test-harness', BUNDLE_COMPARATOR))) === sha256(comparatorBytes), 'comparator changed while loading');
  const measurementPath = join(dir, 'out/suite/bundle/current.json'), measurementBytes = readFileSync(measurementPath), current = JSON.parse(measurementBytes);
  carryRequire(entry.files['suite/bundle/current.json'] === sha256(measurementBytes), 'original measurement is not pinned by original cache');
  const validSize = value => value && ['files', 'bytes', 'gzip'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0);
  carryRequire(validSize(current.total) && current.total.files > 0 && current.chunks && Object.values(current.chunks).every(validSize), 'malformed original measurement');
  for (const metric of ['files', 'bytes', 'gzip']) carryRequire(Object.values(current.chunks).reduce((sum, value) => sum + value[metric], 0) === current.total[metric], `measurement total differs: ${metric}`);
  const gateAssertions = baseline => [
    { id: `bundle total within +${budget.THRESHOLD_PCT}% of baseline`, pass: !budget.over(baseline.total, current.total, { slack: 0 }).length },
    { id: `bundle: no new chunk of ${budget.NEW_CHUNK_BYTES / 1024} KB or more without a baseline entry`, pass: !budget.compare(baseline, current).offenders.some(o => o.kind === 'new') },
    ...Object.entries(baseline.chunks).map(([key, value]) => ({ id: `bundle chunk ${key} within +${budget.THRESHOLD_PCT}% of baseline`, pass: !budget.over(value, current.chunks[key], { slack: budget.SLACK_BYTES }).length })),
  ];
  const oldAssertions = gateAssertions(before), derived = gateAssertions(after);
  for (const assertion of oldAssertions) {
    const found = original.steps['V3-bundle'].tests.filter(t => t.id === assertion.id);
    carryRequire(assertion.pass && found.length === 1 && found[0].status === 'pass' && !found[0].loader, `original bundle assertion/measurement disagrees: ${assertion.id}`);
  }
  carryRequire(derived.every(assertion => assertion.pass), 'original raw bundle does not satisfy the new expectations');
  const oldIds = new Set(oldAssertions.map(assertion => assertion.id));
  const derivedAssertions = derived.map(assertion => ({ id: assertion.id, status: 'pass', aggregate: false, loader: false, directive: '',
    evidenceKind: 'derived-bundle-expectation', executed: false }));
  const comparisonRun = { ...original, steps: { ...original.steps, 'V3-bundle': { ...original.steps['V3-bundle'],
    tests: [...original.steps['V3-bundle'].tests.filter(t => !oldIds.has(t.id)), ...derivedAssertions] } } };
  const unchangedStages = REQUIRED_STEPS.filter(step => step !== 'V3-bundle').map(step => ({ step, evidenceKind: 'original-executed', exit: original.steps[step].exit,
    assertionInventorySha256: sha256(JSON.stringify(original.steps[step].tests)),
    log: { path: original.steps[step].log, sha256: original.evidence[original.steps[step].log] } }));
  carryRequire(unchangedStages.length === 18 && unchangedStages.every(stage => stage.exit === '0' && stage.log.sha256), 'all 18 unchanged executed stages must be present and successful');
  const provenance = { schema: 'bundle-baseline-carry/1', originalCacheDir: dir, originalCacheKey: entry.key, originalCacheManifestSha256: sha256(manifestBytes),
    originalQualification: { path: qualificationPath, sha256: sha256(qualificationBytes) }, originalExecutionMetadata: m,
    originalSuiteTree: entry.suiteTree, expectationSuiteTree: suiteTree(root, harnessRef), expectationHarnessRef: harnessRef,
    expectationHarnessTree: gitAt(root, 'rev-parse', `${harnessRef}:tools/test-harness`), changedSuiteFiles: suiteChanges, existingDriverOnlyChanges: changed.filter(path => DRIVER_ONLY.includes(path)),
    originalBaselineSha256: sha256(beforeBytes), newBaselineSha256: sha256(afterBytes), comparatorSha256: sha256(comparatorBytes), unchangedBundleTestSha256: sha256(testBytes),
    originalMeasurement: { path: measurementPath, sha256: sha256(measurementBytes) }, addedKeys, unchangedStages, derivedAssertions,
    rawExecutionUnmodified: true, derivedAssertionsExecuted: false, baselineRerunAllowed: false };
  return { originalRun: original, comparisonRun, provenance, pinsSha256: sha256(JSON.stringify(provenance)) };
}

/** Copy a validated run into the cache (APFS clone where possible). Never overwrites an entry. */
export function storeCache(cacheDir, run, provenance = {}, root = ROOT) {
  const m = run.metadata;
  if (!m || run.errors.length) return { stored: false, reason: 'run has validation errors' };
  if (m.only !== undefined) return { stored: false, reason: 'scoped run (only full runs are cached)' };
  let suite;
  try {
    if (gitAt(root, 'rev-parse', `${m.harnessRef}:tools/test-harness`) !== m.harnessTree) return { stored: false, reason: 'run harnessTree differs from its harness commit' };
    suite = suiteTree(root, m.harnessRef);
  } catch (e) { return { stored: false, reason: `unverifiable harness ${m.harnessRef}: ${e.message.split('\n')[0]}` }; }
  const key = cacheKey({ sourceSha: m.sourceSha, suiteTree: suite, node: m.node }), dir = join(cacheDir, key);
  if (existsSync(dir)) return { stored: false, key, dir, reason: 'already cached' };
  mkdirSync(cacheDir, { recursive: true });
  const tmp = mkdtempSync(join(cacheDir, `.incoming-${m.sourceSha.slice(0, 9)}-`));
  try {
    cpSync(join(run.dir, 'out'), join(tmp, 'out'), { recursive: true, mode: constants.COPYFILE_FICLONE });
    if (existsSync(join(run.dir, 'REFS.txt'))) copyFileSync(join(run.dir, 'REFS.txt'), join(tmp, 'REFS.txt'));
    const files = hashTree(join(tmp, 'out'));
    for (const [path, hash] of Object.entries(run.evidence)) {
      const rel = relative(join(run.dir, 'out'), resolve(path));
      if (files[rel] !== hash) throw Error(`copy differs from the validated evidence: ${rel}`);
    }
    writeFileSync(join(tmp, 'CACHE.json'), JSON.stringify({ schemaVersion: 1, key, sourceSha: m.sourceSha, suiteTree: suite, harnessTree: m.harnessTree, harnessRef: m.harnessRef,
      harnessArchiveSha256: m.harnessArchiveSha256, sourceArchiveSha256: m.sourceArchiveSha256, node: m.node, nodeVersion: m.nodeVersion, pnpmVersion: m.pnpmVersion,
      from: run.dir, storedAt: new Date().toISOString(), provenance, files }, null, 2) + '\n');
    renameSync(tmp, dir);
  } catch (e) { try { retire(tmp); } catch {} return { stored: false, key, dir, reason: e.message }; }
  return { stored: true, key, dir };
}

/** Seed the cache with a completed run (a passing gate's, or a bare remote-suite.sh run), validated exactly like a
 * --baseline-results import plus its own quarantine check. */
export function cacheAdd(runDir, { root = ROOT, cacheDir = defaultCacheDir(root) } = {}) {
  runDir = resolve(runDir);
  let run;
  try {
    const meta = JSON.parse(readFileSync(join(runDir, 'out/RUN-METADATA.json'), 'utf8'));
    for (const f of ['sourceSha', 'harnessRef']) if (!/^[0-9a-f]{40}$/.test(meta[f] || '')) throw Error(`${f} is not a full commit sha`);
    gitAt(root, 'cat-file', '-e', `${meta.sourceSha}^{commit}`);
    const harnessTree = gitAt(root, 'rev-parse', `${meta.harnessRef}:tools/test-harness`);
    const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar.gz', meta.harnessRef, 'tools/test-harness'], { maxBuffer: MAX_BUFFER });
    const manifest = JSON.parse(execFileSync('git', ['-C', root, 'show', `${meta.harnessRef}:tools/test-harness/quarantine.json`], { maxBuffer: MAX_BUFFER }));
    run = readRun(runDir, { schemaVersion: 1, sourceSha: meta.sourceSha, harnessRef: meta.harnessRef, harnessTree, harnessArchiveSha256: sha256(archive), node: meta.node }, manifest, REQUIRED_STEPS, { root });
    // On its own terms, the run must pass as a gate baseline: every failure, skip and TODO has its exact quarantine,
    // no test file failed to load and no V6 scenario failed (compareRuns of the run with itself, on its own source tree).
    const sourceFiles = new Set(gitAt(root, 'ls-tree', '-r', '--name-only', meta.sourceSha).split('\n'));
    if (!run.errors.length) run.errors.push(...compareRuns(run, run, manifest, sourceFiles).blockers.map(b => `run: ${b}`));
    // A gate receipt beside the run (a gate's baseline/ or candidate/) must name it and have passed. A bare
    // remote-suite.sh run (how a baseline is produced once under a new harness tree) has none: it is cached on its own.
    const receiptPath = join(dirname(runDir), 'receipt.json');
    let provenance = { via: 'cache-add-bare', receipt: null };
    if (existsSync(receiptPath)) {
      const receiptBytes = readFileSync(receiptPath), receipt = JSON.parse(receiptBytes);
      const label = ['candidate', 'baseline'].find(l => receipt.runs?.[l]?.dir === runDir);
      if (!label) run.errors.push('the gate receipt beside the run does not name this run directory');
      else if (receipt.refs?.[label]?.sha !== meta.sourceSha) run.errors.push(`receipt ${label} sha differs from the run`);
      if (!SUCCESS.has(receipt.status)) run.errors.push(`gate receipt status ${receipt.status}`);
      if (receipt.harness?.tree !== harnessTree) run.errors.push('receipt harness tree differs from the run');
      provenance = { via: 'cache-add', receipt: receiptPath, receiptSha256: sha256(receiptBytes), label };
    }
    if (run.errors.length) return { stored: false, reason: run.errors.join('; ') };
    return storeCache(cacheDir, run, provenance, root);
  } catch (e) { return { stored: false, reason: e.message }; }
}

// ── Scoped candidate gates (MODAL-POLICY rule 4) ─────────────────────────────────────────────────────────────────────
// `--scope auto` picks the CPU contract's steps from `git diff --name-only <baseline> <candidate>`; the release head
// always takes the default `--scope full`. Paths no rule names (root files, lockfile, mars/, worlds/, vendor/, infra/,
// e2e/, .github/ ...) select the full contract; docs and other tools never gate (the CPU contract does not cover them),
// except the tools directories whose own tests or e2es are contract steps.
const V6_STEPS = REQUIRED_STEPS.filter(step => step.startsWith('V6-'));
const STEP_SETS = { V1: ['V1-types'], V2: ['V2-build-root', 'V2-build-worlds'], V4: ['V4-web'], V5: ['V5-server-full'], V6: V6_STEPS };
export const SCOPE_RULES = [
  // V3-walk audits fixed world fixtures and a fresh Eden genesis, which the server and the packages produce
  ['apps/server/', ['V1', 'V3-packages', 'V3-walk', 'V5', 'V6']],
  ['apps/web/', ['V1', 'V2', 'V3-bundle', 'V4']],
  // Owned music inputs feed the generated web playlist as well as package composition checks.
  ['packages/music/', ['V1', 'V2', 'V3-bundle', 'V3-packages', 'V4']],
  ['packages/', ['V1', 'V3-packages', 'V3-mars-engine', 'V3-walk', 'V5']],
  ['tools/edge-skill/', ['V3-client-cli']],
  ['tools/client-eval/', ['V3-client-cli']],
  ['tools/world-launcher/', ['V3-launcher-unit', 'V6']],
  ['tools/god-skill/', ['V6']],
  ['tools/', []],
  ['docs/', []],
];
const ROOT_DOCS = /^[^/]+\.md$|^LICENSE$/;
export function scopeFor(files) {
  const byArea = {}, unmapped = [], picked = new Set();
  for (const file of files.filter(Boolean)) {
    const rule = ROOT_DOCS.test(file) ? ['docs/', []] : SCOPE_RULES.find(([prefix]) => file.startsWith(prefix));
    if (!rule) { unmapped.push(file); continue; }
    byArea[rule[0]] = (byArea[rule[0]] || 0) + 1;
    for (const set of rule[1]) for (const step of STEP_SETS[set] || [set]) picked.add(step);
  }
  const diff = { files: files.filter(Boolean).length, byArea, unmapped: unmapped.slice(0, 20), unmappedCount: unmapped.length };
  if (unmapped.length) return { resolved: 'full', steps: [...REQUIRED_STEPS], diff };
  if (!picked.size) return { resolved: 'none', steps: [], diff };
  return { resolved: 'scoped', steps: REQUIRED_STEPS.filter(step => picked.has(step)), diff };
}

export const USAGE = `usage: release-gate.sh <candidate-ref> [--baseline <ref>] [--out <dir>] [--node 22|26]
         [--baseline-results <dir> [--candidate-results <dir>]] [--cache <dir> | --no-cache] [--scope full|auto] [--dry-run]
         [--baseline-bundle-carry <qualified-cache-dir>]
       release-gate.sh cache-add <completed-run-dir> [--cache <dir>]
The baseline (default main) comes from the gate cache when a validated run of it exists for this harness tree and Node
major; otherwise it runs once on Modal beside the candidate and is cached. A passing gate caches its candidate run.
--scope auto (lane candidates) runs only the steps the baseline..candidate diff touches (docs/tools only: no gate, exit 0,
status not-gated); the default --scope full is the release head's gate. Only full gates qualify a ship or fill the cache.
--baseline-bundle-carry explicitly retains an original qualified cache across only new bundle-key registrations;
old execution stays unchanged, derived expectations are labelled separately, and no baseline fallback is allowed.
--dry-run prints the plan (refs, scope, cache hit/miss, Modal runs) without contacting Modal or writing anything.`;
const VALUE_OPTIONS = ['--out', '--baseline', '--baseline-results', '--candidate-results', '--node', '--cache', '--scope', '--baseline-bundle-carry'];
const FLAG_OPTIONS = ['--dry-run', '--no-cache'];
export function parseArgs(args) {
  args = [...args];
  const candidateRef = args.shift();
  if (!candidateRef || candidateRef.startsWith('-')) throw Error(USAGE);
  const options = {}, flags = new Set();
  while (args.length) {
    const option = args.shift();
    if (FLAG_OPTIONS.includes(option)) { if (flags.has(option)) throw Error(`duplicate option ${option}`); flags.add(option); continue; }
    if (!VALUE_OPTIONS.includes(option) || !args.length) throw Error(`invalid option ${option}`);
    if (options[option] !== undefined) throw Error(`duplicate option ${option}`);
    options[option] = args.shift();
  }
  if (options['--candidate-results'] && !options['--baseline-results']) throw Error('--candidate-results needs --baseline-results');
  if (options['--cache'] && flags.has('--no-cache')) throw Error('--cache and --no-cache conflict');
  if (options['--scope'] && !['full', 'auto'].includes(options['--scope'])) throw Error('--scope is full or auto');
  if (options['--baseline-bundle-carry'] && (options['--baseline-results'] || options['--candidate-results'] || flags.has('--no-cache') || options['--scope'] === 'auto'))
    throw Error('--baseline-bundle-carry requires full scope/cache and cannot combine with result imports');
  return { candidateRef, options, flags };
}

function cacheAddCli(args, { root, log }) {
  const runDir = args.shift();
  let cacheDir = defaultCacheDir(root);
  if (args[0] === '--cache' && args[1]) { cacheDir = resolve(args[1]); args.splice(0, 2); }
  if (!runDir || args.length) { log(USAGE); return 2; }
  const r = cacheAdd(runDir, { root, cacheDir });
  log(`GATE_CACHE ${r.stored ? 'STORED' : r.reason === 'already cached' ? 'PRESENT' : 'REJECTED'} run=${resolve(runDir)}${r.key ? ` key=${r.key}` : ''}${r.dir ? ` dir=${r.dir}` : ''}${r.stored ? '' : ` reason=${r.reason}`}`);
  return r.stored || r.reason === 'already cached' ? 0 : 1;
}

export async function main(args = process.argv.slice(2), deps = {}) {
  const root = deps.root || ROOT, runRemote = deps.remoteRun || remoteRun, log = deps.log || console.log;
  const git = (...a) => gitAt(root, ...a);
  if (['--help', '-h'].includes(args[0])) { log(USAGE); return 0; }
  if (args[0] === 'cache-add') return cacheAddCli(args.slice(1), { root, log });
  let receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'blocked', blockers: [] };
  let out = join(root, '.lane/release-gate', new Date().toISOString().replace(/[:.]/g, '-'));
  let dryRun = false;
  try {
    const { candidateRef, options, flags } = parseArgs(args);
    dryRun = flags.has('--dry-run');
    if (options['--out']) out = resolve(options['--out']);
    if (!dryRun) {
      if (existsSync(join(out, 'receipt.json'))) { const previous = out; out = join(out, `rejected-attempt-${Date.now()}`); throw Error(`output already has a receipt: ${previous}`); }
      mkdirSync(out, { recursive: true });
    }
    // the baseline is what is live: main by default; a release line compares with its live release (e.g. --baseline 19d17c90)
    const baselineRef = options['--baseline'] || 'main';
    const baselineSha = git('rev-parse', '--verify', `${baselineRef}^{commit}`);
    const candidateSha = git('rev-parse', '--verify', `${candidateRef}^{commit}`);
    const harnessRef = git('rev-parse', 'HEAD');
    const harnessTree = git('rev-parse', `${harnessRef}:tools/test-harness`), suite = suiteTree(root, harnessRef);
    const harnessClean = !git('status', '--porcelain', '--', 'tools/test-harness');
    if (!harnessClean && !dryRun) throw Error('commit the trusted harness and quarantine before running the gate');
    const harnessArchive = execFileSync('git', ['-C', root, 'archive', '--format=tar.gz', harnessRef, 'tools/test-harness'], { maxBuffer: MAX_BUFFER });
    const manifestBytes = execFileSync('git', ['-C', root, 'show', `${harnessRef}:tools/test-harness/quarantine.json`]);
    const manifest = JSON.parse(manifestBytes);
    validateQuarantine(manifest);
    // An older harness without renames.json has no reviewed renames; an empty list only ever keeps removals blocking.
    let renamesBytes = Buffer.from('{"schemaVersion":1,"entries":[]}\n');
    try { renamesBytes = execFileSync('git', ['-C', root, 'show', `${harnessRef}:tools/test-harness/renames.json`], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
    const renames = validateRenames(JSON.parse(renamesBytes));
    const node = options['--node'] || '22';
    if (!['22', '26'].includes(node)) throw Error('supported Node versions: 22, 26');
    receipt = { ...receipt, refs: { baseline: { ref: baselineRef, sha: baselineSha }, candidate: { ref: candidateRef, sha: candidateSha } },
      harness: { ref: harnessRef, tree: harnessTree, suiteTree: suite, archiveSha256: sha256(harnessArchive) }, quarantineSha256: sha256(manifestBytes), renamesSha256: sha256(renamesBytes), node, exclusions: EXPECTED_SKIP, scopeExclusions: manifest.scopeExclusions };
    const identity = { schemaVersion: 1, harnessRef, harnessTree, harnessArchiveSha256: sha256(harnessArchive), node };
    const scopeMode = options['--scope'] || 'full';
    const scope = scopeMode === 'full' ? { resolved: 'full', steps: [...REQUIRED_STEPS] }
      : scopeFor(git('diff', '--name-only', baselineSha, candidateSha).split('\n'));
    receipt.scope = { mode: scopeMode, resolved: scope.resolved, steps: scope.steps, ...(scope.diff && { diff: { range: `${baselineSha}..${candidateSha}`, ...scope.diff } }) };
    const scoped = scope.resolved === 'scoped', only = scoped ? scope.steps : [];
    const candidateIdentity = { ...identity, sourceSha: candidateSha, ...(scoped && { only }) };
    if (scope.resolved === 'none') {
      if (dryRun) { log(JSON.stringify({ refs: receipt.refs, scope: receipt.scope, modalRuns: [] }, null, 2)); log(`RELEASE_GATE_PLAN candidate=${candidateSha} baseline=${baselineSha} scope=none modal_runs=0`); return 0; }
      receipt = { ...receipt, status: 'not-gated', endedAt: new Date().toISOString() };
      throw Object.assign(Error('scope none'), { notGated: true });
    }
    const useCache = !flags.has('--no-cache'), cacheDir = resolve(options['--cache'] || defaultCacheDir(root));
    const pairImport = Boolean(options['--candidate-results']);
    // Where the baseline comes from: an audited import, the cache, or one fresh Modal run (which is then cached).
    let base, cached, bundleCarry;
    const carryOptions = { sourceSha: baselineSha, harnessRef, node, manifest, root };
    if (options['--baseline-bundle-carry']) {
      bundleCarry = await prepareBundleBaselineCarry(options['--baseline-bundle-carry'], carryOptions);
      base = { source: 'cached', dir: bundleCarry.provenance.originalCacheDir, cacheKey: bundleCarry.provenance.originalCacheKey,
        bundleExpectationCarry: bundleCarry.provenance };
    } else if (options['--baseline-results']) base = { source: 'imported', dir: resolve(options['--baseline-results']), exact: pairImport };
    else if (useCache && (cached = lookupCache(cacheDir, { sourceSha: baselineSha, suiteTree: suite, node }, manifest, REQUIRED_STEPS, {}, root)).hit) base = { source: 'cached', dir: cached.dir, cacheKey: cached.key };
    else base = { source: 'run', dir: join(out, 'baseline'), exact: true, cacheKey: cacheKey({ sourceSha: baselineSha, suiteTree: suite, node }), cacheMiss: useCache ? cached.reason : 'cache disabled (--no-cache)' };
    const candidateDir = pairImport ? resolve(options['--candidate-results']) : join(out, 'candidate');
    const plan = { refs: receipt.refs, harness: { ...receipt.harness, clean: harnessClean }, node, scope: receipt.scope, cache: useCache ? cacheDir : null,
      baseline: { source: base.source, dir: base.dir, cacheKey: base.cacheKey, cacheMiss: base.cacheMiss,
        ...(bundleCarry && { bundleExpectationCarry: bundleCarry.provenance }) },
      candidate: { source: pairImport ? 'imported' : 'run', dir: candidateDir },
      modalRuns: [...(pairImport ? [] : ['candidate']), ...(base.source === 'run' ? ['baseline'] : [])] };
    if (dryRun) {
      log(JSON.stringify(plan, null, 2));
      log(`RELEASE_GATE_PLAN candidate=${candidateSha} baseline=${baselineSha} scope=${scope.resolved} steps=${scope.steps.length} baseline_source=${base.source} modal_runs=${plan.modalRuns.length}${harnessClean ? '' : ' harness=DIRTY(would block)'}`);
      return 0;
    }
    receipt.importedResults = pairImport;
    receipt.baseline = { source: base.source, dir: base.dir, ...(base.cacheKey && { cacheKey: base.cacheKey }), ...(base.cacheMiss && { cacheMiss: base.cacheMiss }),
      ...(bundleCarry && { bundleExpectationCarry: bundleCarry.provenance }) };
    const drivers = {};
    const runs = [];
    if (!pairImport) runs.push(runRemote(candidateDir, candidateSha, harnessRef, node, root, only).then(d => { drivers.candidate = d; }));
    if (base.source === 'run') runs.push(runRemote(base.dir, baselineSha, harnessRef, node, root).then(d => { drivers.baseline = d; }));
    await Promise.all(runs);
    if (bundleCarry) {
      const rechecked = await prepareBundleBaselineCarry(base.dir, carryOptions);
      if (rechecked.pinsSha256 !== bundleCarry.pinsSha256) throw Error('bundle baseline carry: original evidence or expectations changed during candidate execution; no baseline fallback allowed');
      bundleCarry = rechecked;
    }
    const readBaseline = () => bundleCarry ? bundleCarry.originalRun : base.source === 'cached' || (base.source === 'imported' && !base.exact) ? readSuiteRun(base.dir, { sourceSha: baselineSha, suiteTree: suite, node }, manifest, root)
      : readRun(base.dir, { ...identity, sourceSha: baselineSha }, manifest, REQUIRED_STEPS, { root });
    let baseline = readBaseline();
    const candidate = readRun(candidateDir, candidateIdentity, manifest, scope.steps, { root });
    if (drivers.candidate && (drivers.candidate.exit !== 0 || drivers.candidate.timedOut)) candidate.errors.push(`Modal driver failed (${drivers.candidate.timedOut ? 'timeout' : drivers.candidate.exit})`);
    // A cached baseline is only comparable on the candidate's exact runtime (the node:<major> image can move its patch).
    const runtime = r => r.metadata && `${r.metadata.nodeVersion}/${r.metadata.pnpmVersion}`;
    if (base.source === 'cached' && candidate.metadata && runtime(baseline) !== runtime(candidate)) {
      if (bundleCarry) baseline.errors.push(`bundle baseline carry: runtime ${runtime(baseline)} differs from the candidate's ${runtime(candidate)}; baseline fallback forbidden`);
      else {
        receipt.baseline = { ...receipt.baseline, source: 'run', cacheRejected: `runtime ${runtime(baseline)} differs from the candidate's ${runtime(candidate)}`, cachedDir: base.dir, dir: join(out, 'baseline') };
        base = { source: 'run', dir: join(out, 'baseline'), exact: true };
        drivers.baseline = await runRemote(base.dir, baselineSha, harnessRef, node, root);
        baseline = readBaseline();
      }
    }
    if (drivers.baseline && (drivers.baseline.exit !== 0 || drivers.baseline.timedOut)) baseline.errors.push(`Modal driver failed (${drivers.baseline.timedOut ? 'timeout' : drivers.baseline.exit})`);
    const candidateSourceFiles = new Set(git('ls-tree', '-r', '--name-only', candidateSha).split('\n'));
    const suiteReuse = base.source === 'cached' || (base.source === 'imported' && !base.exact);
    const driverTestsChanged = suiteReuse && !baseline.errors.length && baseline.suiteTree === suite && baseline.metadata?.harnessTree !== harnessTree;
    if (suiteReuse) receipt.baseline = { ...receipt.baseline, harnessRef: baseline.metadata?.harnessRef, harnessTree: baseline.metadata?.harnessTree, suiteTree: baseline.suiteTree, driverTestsChanged };
    receipt = { ...receipt, ...compareRuns(bundleCarry ? bundleCarry.comparisonRun : baseline, candidate, manifest, candidateSourceFiles, { driverTestsChanged, renames }), drivers,
      runs: { baseline, candidate } };
    // Cache what this gate proved: a fresh baseline run that validated, and the candidate of a passing gate
    // (the next gate's baseline once it becomes main).
    if (useCache) {
      receipt.cache = { dir: cacheDir, stored: [], notStored: [] };
      const keep = (label, run) => { const r = storeCache(cacheDir, run, { via: 'gate', label, gate: out, status: receipt.status }, root);
        (r.stored ? receipt.cache.stored : receipt.cache.notStored).push({ label, key: r.key, dir: r.dir, ...(r.stored ? {} : { reason: r.reason }) }); };
      if (base.source === 'run' && !baseline.errors.length) keep('baseline', baseline);
      if (SUCCESS.has(receipt.status) && !scoped) keep('candidate', candidate);
    }
    receipt.endedAt = new Date().toISOString();
  } catch (e) {
    if (dryRun) { log(`RELEASE_GATE_PLAN ERROR ${e.message}`); return 2; }
    if (!e.notGated) { receipt.blockers.push(e.message); receipt.endedAt = new Date().toISOString(); }
  }
  mkdirSync(out, { recursive: true });
  const receiptPath = join(out, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  log(`RELEASE_GATE ${receipt.status.toUpperCase()} baseline=${receipt.refs?.baseline.sha || '?'} candidate=${receipt.refs?.candidate.sha || '?'} scope=${receipt.scope?.resolved || '?'} baseline_source=${receipt.baseline?.source || '?'} fixed=${receipt.fixed?.length || 0} quarantined=${receipt.quarantined?.length || 0} new=${receipt.newFailures?.length || 0} blockers=${receipt.blockers.length} receipt=${receiptPath}`);
  return receipt.status === 'blocked' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
