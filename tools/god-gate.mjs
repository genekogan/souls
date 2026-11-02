#!/usr/bin/env node
// Focused authoring gate. No services, browser, network, paid models or monorepo suite.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Explicit override is useful for diagnosing a broken installed Node; the default is the Node running this gate
// (package.json engines sets the supported version).
const node = process.env.GOD_GATE_NODE || process.execPath;
const dir = mkdtempSync(join(tmpdir(), 'god-gate-'));
const files = (path, suffix) => readdirSync(join(root, path)).filter(f => f.endsWith(suffix)).sort().map(f => `${path}/${f}`);
const test = paths => ['--test', '--test-reporter=tap', '--test-concurrency=1', ...paths];
const suites = [
  ['god', test(files('apps/server/src/god', '.test.ts'))],
  ['world-compiler', test([...files('packages/world-compiler/src', '.test.ts'), ...files('packages/world-compiler/src/core-kit', '.test.ts')])],
  // Catalog discovery includes EF4 conformance.test.ts (all defs, endpoints/enums/scales, seeded K=2).
  ['conformance', test(files('packages/conformance/src', '.test.ts'))],
  ['generators', test(files('packages/generators/src', '.test.ts'))],
  // K1 / NT5: offline kit semantics always run; recorded pixel captures can gate the same command.
  ['kit-mesh', test(['apps/web/src/gen-mesh/kit.mesh.test.ts', 'apps/web/src/gen-mesh/kit-surfaces.test.ts'])], // Y1: + surfaces
  ['faces', test(['apps/web/src/gen-mesh/faces.test.ts'])], // XP8: viewer faces/decals and their offline network log
  ['gallery-diff', test(['tools/god-skill/scripts/gallery-diff.test.mjs'])],
  ['CLI-lib', test([...files('tools/god-skill', '.test.mjs'), ...files('tools/god-skill/lib', '.test.mjs')])],
  ...['server', 'world-compiler', 'generators'].map(name => [`tsc-${name}`, ['node_modules/@typescript/native/bin/tsc', '--noEmit', '-p', name === 'server' ? 'apps/server' : `packages/${name}`]]),
  ['skill-build', ['tools/god-skill/build.mjs', '--check']],
];
if (process.env.GOD_GALLERY_BEFORE || process.env.GOD_GALLERY_AFTER) {
  if (!process.env.GOD_GALLERY_BEFORE || !process.env.GOD_GALLERY_AFTER) throw new Error('set both GOD_GALLERY_BEFORE and GOD_GALLERY_AFTER');
  suites.push(['gallery-pixels', ['tools/god-skill/scripts/gallery-diff.mjs', process.env.GOD_GALLERY_BEFORE, process.env.GOD_GALLERY_AFTER, ...(process.env.GOD_GALLERY_ALLOW ? [process.env.GOD_GALLERY_ALLOW] : [])]]);
} else console.log('gallery-pixels: NOT RUN (set GOD_GALLERY_BEFORE and GOD_GALLERY_AFTER to recorded galleries)');
console.log(`god-gate node=${node} logs=${dir}`);
const results = [];
for (const [name, args] of suites) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn('nice', ['-n', '10', node, ...args], { cwd: root, env: { ...process.env, PATH: `${dirname(node)}:${process.env.PATH ?? ''}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('error', e => resolve({ code: 1, output: `${output}\n${e.message}` }));
    child.on('close', (code, signal) => resolve({ code: code ?? 1, output: output + (signal ? `\nsignal=${signal}` : '') }));
  });
  const log = join(dir, `${name}.log`); writeFileSync(log, result.output);
  const count = key => Number(result.output.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] ?? 0);
  const isTest = args[0] === '--test';
  const pass = isTest ? count('pass') : Number(result.code === 0), fail = isTest ? Math.max(count('fail'), result.code ? 1 : 0) : Number(result.code !== 0);
  const tests = isTest ? count('tests') : 1, skipped = count('skipped'), cancelled = count('cancelled');
  const ok = result.code === 0 && fail === 0 && cancelled === 0 && (!isTest || tests > 0);
  const row = { suite: name, ok, tests, pass, fail: ok ? fail : Math.max(1, fail), skipped, cancelled, ms: Date.now() - started, log };
  results.push(row);
  console.log(`${name}: ${ok ? 'PASS' : 'FAIL'} pass=${pass} fail=${row.fail} skipped=${skipped} cancelled=${cancelled} (${row.ms} ms)`);
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify({ node, results }, null, 2) + '\n');
process.exitCode = results.every(r => r.ok) ? 0 : 1;
