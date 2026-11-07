// The media manifest and the repository agree: every pulled path is git-ignored and untracked, the only binaries in
// git are the small allowlisted ones, nothing dropped comes back, and pull.mjs places and verifies files correctly.
// Offline: no network (the fetch test uses a stub).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, globToRegExp, loadManifest, run, select } from './pull.mjs';

const git = (args, input) => execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 1 << 26 }).toString();
const MEDIA = /\.(glb|gltf|bin|drc|ktx2|basis|hdr|exr|fbx|obj|blend|usdz|png|jpe?g|webp|avif|gif|bmp|tiff?|heic|psd|mp3|ogg|oga|wav|flac|m4a|aac|opus|mp4|m4v|webm|mov|mkv|db|sqlite\d?|zip|tar|tgz|gz|7z|pdf)$/i;
// Same list as the negations in the root .gitignore (and the media audit's keep list).
const KEEP = [/^apps\/web\/pwa\/icon-\d+\.png$/, /^apps\/web\/src\/media\/gallery-loop\.mp4$/, /^tools\/god-skill\/reference\/kit-primitives\.png$/, /^tools\/playtest\/review\/fixtures\/runs\/.+\.png$/, /^apps\/server\/test\/fixtures\/sample-texture\.jpg$/];
// Dropped by decision: the Mars archive photo gallery, its captions and the 2020 evidence strip are never pulled or
// committed. Under history/ and 2020/ only the wall, mural, sign and Portal screen texture crops are media.
const DROPPED = /^mars\/viewer\/public\/(2020\/evidence\/|(history|2020)\/.*\.(json|html|md)$)|discord/i;

test('manifest entries are well formed, unique and exclude dropped media', async () => {
  const m = await loadManifest();
  assert.ok(m.files.length > 1000);
  for (const f of m.files) {
    assert.doesNotMatch(f.path, DROPPED, f.path);
    if (f.symlink === undefined) assert.ok(f.url.startsWith(`${m.cdn}/assets/`) && f.url.includes(f.sha256), f.path);
  }
});

test('every manifest path is git-ignored and untracked', async () => {
  const paths = (await loadManifest()).files.map(f => f.path);
  const notIgnored = git(['check-ignore', '--no-index', '--stdin', '-v', '-n'], paths.join('\n')).split('\n').filter(l => l.startsWith('::'));
  assert.deepEqual(notIgnored, []);
  const tracked = new Set(git(['ls-files', '-z']).split('\0'));
  assert.deepEqual(paths.filter(p => tracked.has(p)), []);
});

test('the only tracked binaries are the allowlisted ones', () => {
  const extra = git(['ls-files', '-z']).split('\0').filter(p => MEDIA.test(p) && !KEEP.some(k => k.test(p)) && !/\.jsonl\.br$/.test(p));
  assert.deepEqual(extra, []);
});

test('globs: ** crosses directories, * does not, a trailing / takes the subtree', () => {
  assert.ok(globToRegExp('worlds/**/*.glb').test('worlds/a/b/c.glb'));
  assert.ok(globToRegExp('worlds/**/*.glb').test('worlds/c.glb'));
  assert.ok(!globToRegExp('worlds/*.glb').test('worlds/a/c.glb'));
  assert.ok(globToRegExp('mars/viewer/').test('mars/viewer/public/x.png'));
  assert.ok(!globToRegExp('apps/web/**').test('apps/webx/a.mp3'));
  const files = [{ path: 'a/x.glb', set: 'runtime' }, { path: 'b/y.png', set: 'test' }];
  assert.deepEqual(select(files, { sets: ['runtime'] }).map(f => f.path), ['a/x.glb']);
  assert.deepEqual(select(files, { sets: ['runtime', 'test'], only: ['b/**'] }).map(f => f.path), ['b/y.png']);
});

test('pull downloads, verifies, caches, links and is idempotent; a wrong body fails without landing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'souls-assets-test-'));
  try {
    const good = Buffer.from('good bytes'), bad = Buffer.from('bad bytes!');
    const sha = b => createHash('sha256').update(b).digest('hex');
    const manifest = { version: 1, cdn: 'https://cdn.test', files: [
      { path: 'w/a.glb', sha256: sha(good), bytes: good.length, url: 'https://cdn.test/assets/a.glb', set: 'runtime' },
      { path: 'w/b.glb', sha256: sha(good), bytes: good.length, url: 'https://cdn.test/assets/bad.glb', set: 'runtime' },
      { path: 'w/link.glb', symlink: 'a.glb', set: 'runtime' },
      { path: 'w/c.png', sha256: sha(bad), bytes: bad.length, url: 'https://cdn.test/assets/gone.png', set: 'test' },
    ] };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const calls = [];
    const fetcher = async url => { calls.push(url); return url.endsWith('/a.glb') ? new Response(good) : url.endsWith('/bad.glb') ? new Response(bad) : new Response('no', { status: 404 }); };
    const opts = { manifest: join(dir, 'manifest.json'), dest: join(dir, 'tree'), cache: join(dir, 'cache'), fetcher, quiet: true };
    // b.glb shares a.glb's sha256, so whichever runs second is served from the cache: run them one at a time.
    const first = await run({ ...opts, concurrency: 1 });
    assert.deepEqual(first.failed.map(f => f.path), ['w/c.png']);
    assert.equal(await readFile(join(dir, 'tree/w/a.glb'), 'utf8'), 'good bytes');
    assert.equal(await readFile(join(dir, 'tree/w/b.glb'), 'utf8'), 'good bytes');
    assert.equal(await readlink(join(dir, 'tree/w/link.glb')), 'a.glb');
    calls.length = 0;
    const again = await run({ ...opts, sets: ['runtime'] });
    assert.deepEqual([again.failed, calls, again.counts], [[], [], { ok: 3 }]);
    const check = await run({ ...opts, check: true });
    assert.deepEqual(check.failed, [{ path: 'w/c.png', error: 'missing' }]);
    // a body with the wrong hash never lands in the tree or the cache
    const fresh = await run({ ...opts, dest: join(dir, 'tree2'), cache: join(dir, 'cache2'), only: ['w/b.glb'] });
    assert.match(fresh.failed[0].error, /want 10 bytes/);
    await assert.rejects(readFile(join(dir, 'tree2/w/b.glb')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
