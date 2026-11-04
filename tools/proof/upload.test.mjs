import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  Blocked, blockedMessage, checkLocal, contentType, embedLine, githubTarget, httpTarget, linkMedia, makePreview, pickTarget, previewArgs, previewPath,
  releaseAssetName, uniqueName, uploadAll, PREVIEW_MAX_BYTES,
} from './upload.mjs';
import { validateProof } from './acceptance.mjs';

const dir = mkdtempSync(join(tmpdir(), 'proof-upload-'));
const clip = join(dir, 'desktop.mp4'), proofPath = join(dir, 'proof.json');
writeFileSync(clip, 'not really a video');

const ghError = (msg) => Object.assign(new Error('Command failed: gh api'), { stderr: msg });

/** A fake `gh` that keeps release state; `fail` maps an arg substring to a stderr message. */
function fakeGh({ release = null, assets = [], fail = {} } = {}) {
  const calls = [];
  let rel = release;
  const run = (args) => {
    calls.push(args);
    const joined = args.join(' ');
    for (const [k, msg] of Object.entries(fail)) if (joined.includes(k)) throw ghError(msg);
    if (joined.includes('releases/tags/proofs')) { if (!rel) throw ghError('gh: Not Found (HTTP 404)'); return JSON.stringify(rel); }
    if (args.includes('POST') && args[3] === 'repos/o/r/releases') { rel = { id: 99, assets: [] }; return JSON.stringify(rel); }
    if (/\/assets\?per_page/.test(joined)) return JSON.stringify([assets]);
    if (joined.includes('uploads.github.com')) {
      const name = decodeURIComponent(/name=([^ ]+)/.exec(joined)[1]);
      assets.push({ name });
      return JSON.stringify({ browser_download_url: `https://github.com/o/r/releases/download/proofs/${name}` });
    }
    throw Error(`unexpected gh ${joined}`);
  };
  return { run, calls };
}

test('names: pr-<n>.<file> on the release, safe characters, never overwrite', () => {
  assert.equal(releaseAssetName(12, '/x/y/desktop take 1.mp4'), 'pr-12.desktop-take-1.mp4');
  assert.equal(uniqueName('pr-1.a.mp4', new Set(['pr-1.a.mp4', 'pr-1.a-2.mp4'])), 'pr-1.a-3.mp4');
  assert.equal(contentType('a.webm'), 'video/webm');
  assert.equal(contentType('a.bin'), 'application/octet-stream');
});

test('github target: creates the proofs prerelease once, uploads with a unique name', async () => {
  const gh = fakeGh({ assets: [] });
  const t = githubTarget({ repo: 'o/r', run: gh.run });
  const a = await t.upload(7, clip), b = await t.upload(7, clip);
  assert.equal(a.url, 'https://github.com/o/r/releases/download/proofs/pr-7.desktop.mp4');
  assert.equal(b.name, 'pr-7.desktop-2.mp4');
  const create = gh.calls.find(c => c.includes('POST') && c[3] === 'repos/o/r/releases');
  assert.ok(create.includes('prerelease=true') && create.includes('tag_name=proofs'));
  assert.equal(gh.calls.filter(c => c[3] === 'repos/o/r/releases').length, 1);
  const up = gh.calls.find(c => c.join(' ').includes('uploads.github.com'));
  assert.ok(up.includes('Content-Type: video/mp4') && up.includes(clip));
});

test('github target: an existing release keeps earlier takes', async () => {
  const gh = fakeGh({ release: { id: 5 }, assets: [{ name: 'pr-7.desktop.mp4' }] });
  const r = await githubTarget({ repo: 'o/r', run: gh.run }).upload(7, clip);
  assert.equal(r.name, 'pr-7.desktop-2.mp4');
  assert.ok(!gh.calls.some(c => c.includes('POST') && c[3] === 'repos/o/r/releases'));
});

test('github target: permission or network failures are Blocked, not crashes', async () => {
  for (const msg of ['HTTP 403: Resource not accessible by integration', 'error connecting to api.github.com: Could not resolve host', 'To get started with GitHub CLI, please run:  gh auth login']) {
    const gh = fakeGh({ release: { id: 5 }, fail: { 'uploads.github.com': msg } });
    await assert.rejects(async () => githubTarget({ repo: 'o/r', run: gh.run }).upload(7, clip), Blocked, msg);
  }
  const missing = () => { throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }); };
  await assert.rejects(async () => githubTarget({ repo: 'o/r', run: missing }).upload(7, clip), Blocked);
});

test('http target (SIM_PROOF_UPLOAD_URL): PUT with bearer token, url from JSON, 403 is Blocked', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 201, headers: { get: () => null }, json: async () => ({ url: 'https://cdn.example/p/pr-7/desktop.mp4' }) }; };
  const t = pickTarget({ env: { SIM_PROOF_UPLOAD_URL: 'https://up.example/proofs/', SIM_PROOF_UPLOAD_TOKEN: 'tok' }, fetchImpl });
  const r = await t.upload(7, clip);
  assert.equal(seen[0].url, 'https://up.example/proofs/pr-7/desktop.mp4');
  assert.equal(seen[0].init.method, 'PUT');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(r.url, 'https://cdn.example/p/pr-7/desktop.mp4');
  const fallback = httpTarget({ url: 'https://up.example/x', publicUrl: 'https://pub.example/x', fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw Error('no body'); } }) });
  assert.equal((await fallback.upload(3, clip)).url, 'https://pub.example/x/pr-3/desktop.mp4');
  const denied = httpTarget({ url: 'https://up.example/x', fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(() => denied.upload(3, clip), Blocked);
  const offline = httpTarget({ url: 'https://up.example/x', fetchImpl: async () => { throw Error('getaddrinfo ENOTFOUND'); } });
  await assert.rejects(() => offline.upload(3, clip), Blocked);
});

test('no repo and no endpoint is Blocked', () => {
  assert.throws(() => pickTarget({ env: {}, repo: null }), Blocked);
});

test('--proof: links uploaded media into proof.json, then uploads proof.json last', async () => {
  writeFileSync(proofPath, JSON.stringify({ schema: 'sim-proof/1', media: [{ file: 'desktop.mp4', kind: 'video', uncut: true, realSpeed: true }] }));
  const shot = join(dir, 'still.png'); writeFileSync(shot, 'png');
  const gh = fakeGh({ release: { id: 5 }, assets: [] });
  const out = await uploadAll({ pr: 7, files: [clip, shot], proofPath, target: githubTarget({ repo: 'o/r', run: gh.run }) });
  assert.equal(out.proofLink, 'https://github.com/o/r/releases/download/proofs/pr-7.proof.json');
  const saved = JSON.parse(readFileSync(proofPath, 'utf8'));
  assert.equal(saved.media[0].url, 'https://github.com/o/r/releases/download/proofs/pr-7.desktop.mp4');
  assert.deepEqual(saved.media[1], { file: 'still.png', url: 'https://github.com/o/r/releases/download/proofs/pr-7.still.png', kind: 'image', caption: '' });
  assert.equal(out.uploaded.at(-1).file, proofPath);
});

test('linkMedia leaves a new video for the author to assert uncut / real speed', () => {
  const p = linkMedia({}, [{ file: '/x/phone.webm', url: 'https://h/pr-1.phone.webm' }]);
  assert.equal(p.media[0].uncut, null);
});

test('linkMedia: a mixed upload puts the clip in media[] and the log and JSON in files[]; old file entries move', () => {
  const old = { media: [{ file: 'run.log', url: 'https://h/old.log', kind: 'file', caption: 'server log' }] };
  const p = linkMedia(old, [
    { file: '/x/desktop.mp4', url: 'https://h/pr-1.desktop.mp4' },
    { file: '/x/run.log', url: 'https://h/pr-1.run.log' },
    { file: '/x/summary.json', url: 'https://h/pr-1.summary.json' },
  ]);
  assert.deepEqual(p.media.map(m => [m.file, m.kind]), [['desktop.mp4', 'video']]);
  assert.deepEqual(p.files, [
    { file: 'run.log', url: 'https://h/pr-1.run.log', caption: 'server log' },
    { file: 'summary.json', url: 'https://h/pr-1.summary.json', caption: '' },
  ]);
  assert.equal(linkMedia({}, [{ file: '/x/a.png', url: 'https://h/a.png' }]).files, undefined, 'no files[] when nothing needs it');
});

test('--proof with a clip, a log and a JSON summary yields a proof.json that passes acceptance at T2', async () => {
  const log = join(dir, 'server.log'), summary = join(dir, 'summary.json');
  writeFileSync(log, 'log'); writeFileSync(summary, '{}');
  const criteria = [{ id: 'A1', text: 't', status: 'met', evidence: ['`node --test x` -> pass'] }];
  writeFileSync(proofPath, JSON.stringify({ schema: 'sim-proof/1', tier: 'T2', criteria, media: [{ file: 'desktop.mp4', kind: 'video', uncut: true, realSpeed: true }],
    checks: [{ cmd: 'node --test x', result: 'pass' }], failedAttempts: [], externalities: [{ what: 'bytes', result: '+0', ok: true }], limits: [] }));
  const gh = fakeGh({ release: { id: 5 }, assets: [] });
  await uploadAll({ pr: 8, files: [clip, log, summary], proofPath, target: githubTarget({ repo: 'o/r', run: gh.run }) });
  const saved = JSON.parse(readFileSync(proofPath, 'utf8'));
  assert.deepEqual(saved.media.map(m => m.file), ['desktop.mp4']);
  assert.deepEqual(saved.files.map(f => f.file), ['server.log', 'summary.json']);
  assert.deepEqual(validateProof(saved, { tier: 'T2' }).problems, []);
});

test('checkLocal refuses committed media and warns on unignored media in the tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'proof-root-'));
  for (const d of ['.e2e', 'apps']) mkdirSync(join(root, d));
  const files = ['.e2e/ok.mp4', 'apps/tracked.mp4', 'apps/loose.mp4'].map(p => { writeFileSync(join(root, p), 'x'); return join(root, p); });
  const git = (cmd, ...rest) => {
    const rel = rest.at(-1);
    if (cmd === 'ls-files' && rel === 'apps/tracked.mp4') return rel;
    if (cmd === 'check-ignore' && rel.startsWith('.e2e/')) return '';
    throw Error('exit 1');
  };
  const r = checkLocal([...files, clip, join(root, 'missing.mp4')], git, root);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /apps\/tracked\.mp4: tracked by git/);
  assert.match(r.problems[1], /missing\.mp4: no such file/);
  assert.deepEqual(r.warnings.map(w => w.split(':')[0]), ['apps/loose.mp4']);
});

test('the blocked message names the files and the retry command, and forbids committing', () => {
  const m = blockedMessage({ reason: 'HTTP 403', files: [clip], pr: 7, proofPath });
  assert.match(m, /blocked: HTTP 403/);
  assert.ok(m.includes(clip));
  assert.match(m, /upload\.mjs --pr 7 --proof/);
  assert.match(m, /Never commit media/);
});

test('previews: a GIF beside the clip, smaller frames until it fits 5 MB, skipped without ffmpeg', () => {
  assert.equal(previewPath('/x/.e2e/desktop.mp4'), '/x/.e2e/desktop.preview.gif');
  const args = previewArgs({ input: 'a.mp4', output: 'a.preview.gif', start: 2, seconds: 5, width: 360, fps: 8 });
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4), ['-ss', '2', '-t', '5']);
  assert.match(args[args.indexOf('-vf') + 1], /^fps=8,scale=360:-2.*palettegen.*paletteuse/);
  const widths = [];
  const sizes = [9 * 1024 ** 2, 4 * 1024 ** 2];
  const p = makePreview('/x/desktop.mp4', { ffmpeg: a => widths.push(Number(/scale=(\d+)/.exec(a[a.indexOf('-vf') + 1])[1])), size: () => sizes.shift() });
  assert.deepEqual(widths, [480, 360]);
  assert.deepEqual(p, { file: '/x/desktop.preview.gif', bytes: 4 * 1024 ** 2, width: 360, fps: 8 });
  assert.match(makePreview('/x/d.mp4', { ffmpeg: () => {}, size: () => PREVIEW_MAX_BYTES + 1 }).skipped, /over 5 MB/);
  assert.equal(makePreview('/x/d.mp4', { ffmpeg: () => { throw Object.assign(Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }); } }).skipped, 'ffmpeg is not installed');
});

test('uploadAll: each video gets its preview uploaded beside it and recorded in proof.json; images do not', async () => {
  writeFileSync(proofPath, JSON.stringify({ schema: 'sim-proof/1', media: [{ file: 'desktop.mp4', kind: 'video', uncut: true, realSpeed: true }] }));
  const shot = join(dir, 'still.png'); writeFileSync(shot, 'png');
  const gh = fakeGh({ release: { id: 5 }, assets: [] }), asked = [], warned = [];
  const preview = file => { asked.push(basename(file)); const out = previewPath(file); writeFileSync(out, 'gif'); return { file: out, bytes: 3 }; };
  const out = await uploadAll({ pr: 8, files: [clip, shot], proofPath, target: githubTarget({ repo: 'o/r', run: gh.run }), preview, warn: m => warned.push(m) });
  assert.deepEqual(asked, ['desktop.mp4']);
  const base = 'https://github.com/o/r/releases/download/proofs/';
  assert.equal(out.uploaded[0].preview, `${base}pr-8.desktop.preview.gif`);
  assert.equal(JSON.parse(readFileSync(proofPath, 'utf8')).media[0].preview, `${base}pr-8.desktop.preview.gif`);
  assert.equal(embedLine(out.uploaded[0]), `[![desktop.mp4](${base}pr-8.desktop.preview.gif)](${base}pr-8.desktop.mp4)`);
  assert.equal(embedLine({ file: 'a.mp4', url: 'https://h/a.mp4' }), '[a.mp4](https://h/a.mp4)');
  assert.deepEqual(warned, []);
  const skipped = await uploadAll({ pr: 9, files: [clip], target: githubTarget({ repo: 'o/r', run: fakeGh({ release: { id: 5 } }).run }), preview: () => ({ skipped: 'ffmpeg is not installed' }), warn: m => warned.push(m) });
  assert.equal(skipped.uploaded[0].preview, undefined);
  assert.match(warned[0], /no inline preview \(ffmpeg is not installed\)/);
});
