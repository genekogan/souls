#!/usr/bin/env node
// Lane BUDGET (2026-10-22): the web bundle size is a release-gate invariant. The gate step V3-bundle
// (bundle-gate.test.mjs) measures the candidate's own `pnpm --filter @souls/web build` (apps/web/dist, made by V2-build-root)
// and fails when any chunk or the total grew by THRESHOLD_PCT or more over the checked-in, reviewed baseline.json, or when
// a new chunk of NEW_CHUNK_BYTES or more appears that the baseline does not know. Changing the baseline is an explicit,
// reviewed commit of baseline.json, never a side effect of a gate run:
//   node tools/test-harness/bundle-budget/budget.mjs --build            build apps/web, print the comparison
//   node tools/test-harness/bundle-budget/budget.mjs --check            compare the existing apps/web/dist; exit 1 on offenders
//   node tools/test-harness/bundle-budget/budget.mjs --build --write    ... and write the result as the new baseline
//   node tools/test-harness/bundle-budget/budget.mjs --from <gate out>/candidate/out/suite/bundle/current.json --write
//   options: --dist <dir>, --baseline <file>, --threshold <pct> (default 10), --slack <bytes>, --new-chunk <bytes>
// Rules. Code files only (.js .mjs .css .wasm; images/video/models are CDN assets, not bundle). A chunk is keyed by its
// path with vite's 8-character content hash removed (assets/core-kit-DboE7x8I.js -> assets/core-kit.js); files sharing a
// key (two rollup chunks both named "esm") are summed, so code moving between them is not a change. Each key is checked on
// raw bytes and on gzip -9 bytes. A key is an offender when it grew by >= THRESHOLD_PCT and by more than SLACK_BYTES (so a
// 2 KB chunk gaining 300 bytes is noise, not a failure); the total has no slack. A key absent from the baseline fails only
// at >= NEW_CHUNK_BYTES raw; smaller new keys and removed keys are reported, never failed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const DIST = join(ROOT, 'apps/web/dist');
export const BASELINE = join(HERE, 'baseline.json');
export const BUILD = ['pnpm', ['--filter', '@souls/web', 'build']]; // exactly the gate's V2-build-root
export const THRESHOLD_PCT = 10;
export const SLACK_BYTES = 4096;
export const NEW_CHUNK_BYTES = 100 * 1024;
export const CODE_EXT = /\.(?:js|mjs|css|wasm)$/;
export const SCHEMA = 'bundle-budget/1';
export const HEADER = [
  'Reviewed web bundle baseline for the release-gate step V3-bundle (tools/test-harness/bundle-budget/budget.mjs has the rules).',
  'Update ONLY as its own reviewed commit: node tools/test-harness/bundle-budget/budget.mjs --build --write (or --from <gate>/candidate/out/suite/bundle/current.json --write).',
  'The gate never writes this file. Sizes are of a plain `pnpm --filter @souls/web build`, as the gate builds it.',
  '2026-10-22 (lane BUDGET): written from main 41a5b530e (live 3.62). Lane DEPS is removing the ~460 KB viem chunk (assets/toViemAccount-moo9TJem.js) in parallel; the integrator (STACK) re-runs --write as its own reviewed commit after DEPS merges, so the smaller sizes become the budget.',
];

/** assets/core-kit-DboE7x8I.js -> assets/core-kit.js (only vite's trailing 8-char base64url hash is removed). */
export function stableName(path) { return path.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1'); }

function* walkFiles(dir, base = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p, base);
    else if (e.isFile()) yield relative(base, p).split('\\').join('/');
  }
}

/** Measure a dist directory: { total, chunks: { key: { files, bytes, gzip } } }. */
export function measure(dist) {
  if (!existsSync(dist) || !statSync(dist).isDirectory()) throw Error(`no build at ${dist} (run with --build, or the gate's V2-build-root first)`);
  const chunks = {}, total = { files: 0, bytes: 0, gzip: 0 };
  for (const file of walkFiles(dist)) {
    if (!CODE_EXT.test(file)) continue;
    const data = readFileSync(join(dist, file));
    const gz = gzipSync(data, { level: 9 }).length;
    const c = chunks[stableName(file)] ??= { files: 0, bytes: 0, gzip: 0 };
    c.files++; c.bytes += data.length; c.gzip += gz;
    total.files++; total.bytes += data.length; total.gzip += gz;
  }
  if (!total.files) throw Error(`no code files in ${dist}`);
  return { total, chunks: Object.fromEntries(Object.entries(chunks).sort(([a], [b]) => a.localeCompare(b))) };
}

const pct = (base, now) => base ? (now - base) / base * 100 : Infinity;
/** Is `now` over budget against `base` on raw bytes or gzip? Returns the offending metrics. */
export function over(base, now, { threshold = THRESHOLD_PCT, slack = SLACK_BYTES } = {}) {
  const bad = [];
  for (const m of ['bytes', 'gzip']) {
    const grew = (now?.[m] ?? 0) - (base?.[m] ?? 0);
    if (grew > slack && pct(base[m], now[m]) >= threshold) bad.push({ metric: m, base: base[m], now: now[m], pct: pct(base[m], now[m]) });
  }
  return bad;
}

/** Compare a measurement with a baseline. ok=false when any chunk/total is over budget or a new big chunk appeared. */
export function compare(baseline, current, { threshold = THRESHOLD_PCT, slack = SLACK_BYTES, newChunk = NEW_CHUNK_BYTES } = {}) {
  const offenders = [], added = [], removed = [];
  for (const o of over(baseline.total, current.total, { threshold, slack: 0 })) offenders.push({ kind: 'total', key: 'TOTAL', ...o });
  for (const [k, now] of Object.entries(current.chunks)) {
    const base = baseline.chunks[k];
    if (!base) {
      added.push({ key: k, ...now });
      if (now.bytes >= newChunk) offenders.push({ kind: 'new', key: k, metric: 'bytes', base: 0, now: now.bytes, pct: Infinity });
      continue;
    }
    for (const o of over(base, now, { threshold, slack })) offenders.push({ kind: 'grew', key: k, ...o });
  }
  for (const [k, base] of Object.entries(baseline.chunks)) if (!current.chunks[k]) removed.push({ key: k, ...base });
  return { ok: !offenders.length, offenders, added, removed, threshold, slack, newChunk };
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
/** One line per offender, then a one-line summary. */
export function describe(c, current) {
  const lines = c.offenders.map(o => `${o.kind.toUpperCase().padEnd(5)} ${o.key.padEnd(48)} ${o.metric.padEnd(5)} ${o.kind === 'new' ? 'new' : kb(o.base)} -> ${kb(o.now)}${Number.isFinite(o.pct) ? ` (+${o.pct.toFixed(1)}%)` : ''}`);
  lines.push(`bundle ${c.ok ? 'OK' : 'OVER BUDGET'}: total ${kb(current.total.bytes)} raw / ${kb(current.total.gzip)} gzip in ${current.total.files} files; ${c.offenders.length} offender(s), ${c.added.length} new key(s), ${c.removed.length} removed (fail at >= +${c.threshold}% over ${kb(c.slack)} slack, new keys at >= ${kb(c.newChunk)})`);
  return lines.join('\n');
}

export function readBaseline(path = BASELINE) {
  const b = JSON.parse(readFileSync(path, 'utf8'));
  if (b.schema !== SCHEMA || !b.total || !b.chunks) throw Error(`${path}: not a ${SCHEMA} baseline`);
  return b;
}

function gitSource() {
  try {
    const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no', '--', 'apps', 'packages', 'pnpm-lock.yaml'], { encoding: 'utf8' }).trim() !== '';
    return { sha, dirty };
  } catch { return { sha: null, dirty: null }; }
}

export function writeBaseline(current, path = BASELINE, source = gitSource()) {
  if (process.env.REMOTE_SUITE_CPU || process.env.SUITE_COVERAGE_DIR) throw Error('refusing --write inside a gate run: the baseline changes only as a reviewed commit');
  const doc = { schema: SCHEMA, note: HEADER, source: { ...source, build: `${BUILD[0]} ${BUILD[1].join(' ')}`, writtenAt: new Date().toISOString() }, total: current.total, chunks: current.chunks };
  // One line per chunk, so a reviewed baseline change reads as a per-chunk diff.
  const body = Object.entries(doc.chunks).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  const head = JSON.stringify({ ...doc, chunks: undefined }, null, 1).replace(/\n}$/, '');
  writeFileSync(path, `${head},\n "chunks": {\n${body}\n }\n}\n`);
  return doc;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const o = { dist: DIST, baseline: BASELINE, threshold: THRESHOLD_PCT, slack: SLACK_BYTES, newChunk: NEW_CHUNK_BYTES };
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw Error(`${a} needs a value`); return argv[++i]; };
    if (['--check', '--write', '--build', '--json'].includes(a)) flags.add(a);
    else if (a === '--dist') o.dist = resolve(v());
    else if (a === '--baseline') o.baseline = resolve(v());
    else if (a === '--from') o.from = resolve(v());
    else if (a === '--threshold') o.threshold = Number(v());
    else if (a === '--slack') o.slack = Number(v());
    else if (a === '--new-chunk') o.newChunk = Number(v());
    else throw Error(`unknown option ${a}`);
  }
  if (![o.threshold, o.slack, o.newChunk].every(n => Number.isFinite(n) && n >= 0)) throw Error('--threshold/--slack/--new-chunk must be numbers >= 0');
  if (flags.has('--build')) execFileSync(BUILD[0], BUILD[1], { cwd: ROOT, stdio: ['ignore', 2, 2] });
  const current = o.from ? JSON.parse(readFileSync(o.from, 'utf8')) : measure(o.dist);
  if (flags.has('--json')) log(JSON.stringify(current, null, 1));
  let rc = 0;
  if (existsSync(o.baseline)) {
    const c = compare(readBaseline(o.baseline), current, o);
    log(describe(c, current));
    if (!c.ok && flags.has('--check')) rc = 1;
  } else {
    log(`no baseline at ${o.baseline}`);
    if (flags.has('--check')) rc = 1;
  }
  if (flags.has('--write')) { writeBaseline(current, o.baseline); log(`wrote ${o.baseline} (${Object.keys(current.chunks).length} keys) - commit it as a reviewed change`); rc = 0; }
  return rc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (e) { console.error(`budget: ${e.message}`); process.exitCode = 2; }
}
