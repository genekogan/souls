// Soul Run recordings after the run (#754, SR5): a separately labelled preview excerpt of one camera's recording, and a
// package of the run's evidence (local index plus a selected, publishable projection). Offline: reads a finished run
// folder and writes only under <run>/derived/. It never edits a recording, never uploads and never posts; publication
// stays `tools/proof/upload.mjs`. See tools/playtest/runs/README.md (Recording).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson } from '../lib/jsonl.mjs';

const sha256File = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const ffmpeg = (args) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });

/** Recording sidecars of a run, by camera. */
export function listRecordings(runDir) {
  const dir = join(resolve(runDir), 'playtest', 'recordings');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.webm.json')).sort().map((f) => ({ ...readJson(join(dir, f)), sidecar: join(dir, f), path: join(dir, f.replace(/\.json$/, '')) }));
}

/** The preview label as a PNG, rendered by the observer's own Playwright (ffmpeg here may lack drawtext). */
async function labelPng(text, width, out) {
  const { resolvePlaywright, browsersPath, launchArgs } = await import('../lib/platform.mjs');
  browsersPath();
  const pw = resolvePlaywright({});
  if (!pw) throw new Error('Playwright not found for the preview label');
  const browser = await pw.chromium.launch({ headless: true, args: launchArgs({ gpu: 'swiftshader' }).args });
  try {
    const page = await browser.newPage({ viewport: { width, height: 34 } });
    await page.setContent(`<body style="margin:0;background:transparent"><div style="font:600 15px/34px system-ui,sans-serif;color:#fff;background:rgba(170,20,20,.88);padding:0 12px;white-space:nowrap;overflow:hidden">${text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</div></body>`);
    await page.screenshot({ path: out, omitBackground: true });
  } finally { await browser.close(); }
}

/** previewRecording(runDir, {camera, fromSec, toSec}) → sidecar. A labelled excerpt of one recording, written beside
 *  nothing it came from: <run>/derived/previews/<camera>-<from>-<to>.mp4 (+ .json). The source is hashed before and
 *  after; a changed source fails the preview. A preview is never full proof. */
export async function previewRecording(runDir, { camera, fromSec, toSec, label = labelPng } = {}) {
  const rec = listRecordings(runDir).find((r) => r.camera === camera);
  if (!rec?.file || !existsSync(rec.path)) return { ok: false, error: `no recording for camera ${camera}` };
  if (!(toSec > fromSec && fromSec >= 0)) return { ok: false, error: '--from and --to: 0 <= from < to (seconds into the recording)' };
  const len = rec.videoSec ?? rec.durationSec;
  if (len != null && fromSec >= len) return { ok: false, error: `--from ${fromSec} is past the recording (${len} s)` };
  const before = sha256File(rec.path);
  if (rec.sha256 && before !== rec.sha256) return { ok: false, error: `${rec.file} no longer matches its sidecar hash; not deriving from it` };
  const to = len != null ? Math.min(toSec, len) : toSec;
  const outDir = join(resolve(runDir), 'derived', 'previews'); mkdirSync(outDir, { recursive: true });
  const name = `${camera}-${fromSec}-${to}`.replace(/[^\w.-]/g, '_'), out = join(outDir, `${name}.mp4`);
  const width = rec.requested?.viewport?.width ?? 1280;
  const text = `PREVIEW, not full proof: ${fromSec}-${to} s of ${rec.file} (sha256 ${before.slice(0, 12)}), run ${rec.runId ?? basename(resolve(runDir))}`;
  const work = mkdtempSync(join(tmpdir(), 'sr-preview-'));
  try {
    const png = join(work, 'label.png');
    await label(text, width, png);
    const r = ffmpeg(['-ss', String(fromSec), '-to', String(to), '-i', rec.path, '-i', png, '-filter_complex', '[0:v][1:v]overlay=0:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', '-an', out]);
    if (r.status !== 0) { rmSync(out, { force: true }); return { ok: false, error: `ffmpeg: ${(r.stderr || '').trim().split('\n').pop()}` }; }
  } finally { rmSync(work, { recursive: true, force: true }); }
  const after = sha256File(rec.path);
  const meta = { preview: 1, derived: true, fullProof: false, kind: 'excerpt', label: text, file: basename(out), bytes: statSync(out).size, sha256: sha256File(out),
    source: { camera, file: rec.file, sha256: before, fromSec, toSec: to, recordingSec: len, partial: !!rec.partial }, sourceUnchanged: before === after, createdAt: new Date().toISOString() };
  // A source that changed while the excerpt was cut leaves no preview behind, only the error.
  if (!meta.sourceUnchanged) { rmSync(out, { force: true }); return { ok: false, error: `${rec.file} changed while the preview was cut; preview discarded`, ...meta, path: null }; }
  writeJson(`${out}.json`, meta);
  return { ok: true, ...meta, path: out };
}

const latestEvaluation = (runDir) => {
  const root = join(runDir, 'evaluations');
  const d = existsSync(root) ? readdirSync(root).filter((x) => /^\d{3}-/.test(x)).sort().pop() : null;
  return d ? { dir: join(root, d), evaluation: readJson(join(root, d, 'evaluation.json'), null) } : null;
};
// What the selected projection never carries: absolute paths (POSIX or Windows), home-relative (`~/`) and parent-relative
// (`../`) paths, user-directory paths with the leading slash dropped, file URLs, and hosts (IPv4, localhost, *.local,
// *.lan, *.internal and mesh-VPN host names). Run-relative paths such as `playtest/recordings/wide.webm` pass.
const PRIVATE = [
  /(^|[\s"'(=:,\[])(\/(Users|home|private|var|tmp|opt|Volumes|root|mnt|srv)\/|[A-Za-z]:[\\/])/,
  /(^|[\s"'(=:,\[])~[\\/]/, /(^|[\s"'(=:,\[])\.\.[\\/]/,
  /(^|[\s"'(=:,\[])(Users|home)\/[^/\s"]+\//, /\bfile:\/\//i,
  /\b\d{1,3}(\.\d{1,3}){3}\b/, /\blocalhost\b/i, /\b[\w-]+\.(local|ts\.net|lan|internal)\b/i,
];
export const looksPrivate = (x) => { const t = typeof x === 'string' ? x : JSON.stringify(x ?? null); return PRIVATE.some((r) => r.test(t)); };

/** packageRun(runDir, {select}) → {index, selected}. Local index: outcome, measurements, recordings, previews and their
 *  hashes, limits (private, may hold absolute paths). Selected projection: only the evidence named in `select`
 *  (recording cameras or preview files), run-relative, with anything that looks private refused and listed. */
export function packageRun(runDir, { select = [] } = {}) {
  runDir = resolve(runDir);
  const receipt = readJson(join(runDir, 'run-receipt.json'), null);
  if (!receipt) return { ok: false, error: `no run-receipt.json in ${runDir}` };
  const ev = latestEvaluation(runDir), e = ev?.evaluation;
  const recordings = listRecordings(runDir);
  const pdir = join(runDir, 'derived', 'previews');
  const previews = existsSync(pdir) ? readdirSync(pdir).filter((f) => f.endsWith('.mp4.json')).sort().map((f) => readJson(join(pdir, f))) : [];
  const rel = (p) => relative(runDir, p);
  const limits = [
    ...(receipt.observer?.ok === false ? [`observer unavailable at ${receipt.observer.stage}: ${receipt.observer.effect ?? 'no cameras'}`] : []),
    ...recordings.filter((r) => r.partial).map((r) => `recording ${r.camera} is partial (${r.closedBy ?? 'closed before play ended'})`),
    ...recordings.filter((r) => r.pageErrors?.length).map((r) => `recording ${r.camera} has ${r.pageErrors.length} page error(s)`),
    ...(e ? e.measures.filter((m) => m.status === 'unavailable').map((m) => `${m.id} unavailable${m.why ? `: ${m.why}` : ''}`) : ['not evaluated (run.mjs evaluate)']),
    ...(receipt.evidence?.tickValidity?.valid === false ? [`tick service invalid: ${receipt.evidence.tickValidity.reason}`] : []),
  ];
  const outcome = { runId: receipt.runId, status: receipt.status, stage: receipt.stage ?? null, reason: receipt.reason ?? null, startedAt: receipt.startedAt, endedAt: receipt.endedAt,
    spec: { name: receipt.spec?.effective?.name ?? null, sha256: receipt.spec?.sha256 ?? null }, source: receipt.source ?? null, resources: { ok: receipt.resources?.ok ?? null, failed: receipt.resources?.failed ?? [] },
    observer: { mode: receipt.spec?.effective?.observer?.mode ?? 'cameras', ok: receipt.observer?.ok ?? null }, cost: receipt.cost ?? null };
  const measurements = e ? { evaluation: rel(join(ev.dir, 'evaluation.json')), measured: e.measures.filter((m) => m.status === 'measured').map((m) => ({ id: m.id, value: m.value ?? m.summary ?? null })),
    questions: [...(e.acceptance?.predeclared ?? []), ...(e.questions ?? [])].map((q) => ({ id: q.id, basis: q.basis, verdict: q.verdict })) } : null;
  const index = { package: 1, private: true, createdAt: new Date().toISOString(), outcome, measurements,
    recordings: recordings.map((r) => ({ camera: r.camera, file: r.file ? rel(r.path) : null, bytes: r.bytes, sha256: r.sha256, durationSec: r.durationSec, videoSec: r.videoSec ?? null, partial: r.partial, requested: r.requested, actual: r.actual, pageErrors: r.pageErrors?.length ?? 0 })),
    previews: previews.map((p) => ({ file: rel(join(pdir, p.file)), sha256: p.sha256, fullProof: false, source: p.source })),
    diagnostics: receipt.diagnostics ? { requested: true, result: receipt.diagnostics.capture?.result ?? null } : { requested: false }, limits };
  // Selected projection: only what was named, run-relative, nothing that looks like a private path.
  const want = new Set(select), refused = [];
  const picked = [
    // complete = uncut, not partial, no page errors. Whether the action is visible is a person's call after watching it.
    ...index.recordings.filter((r) => want.has(r.camera)).map((r) => ({ kind: 'recording', complete: !r.partial && r.pageErrors === 0, actionVisible: 'not judged by the package: watch it', ...r })),
    ...index.previews.filter((p) => want.has(basename(p.file))).map((p) => ({ kind: 'preview', ...p })),
  ];
  for (const s of want) if (!picked.some((p) => p.camera === s || basename(p.file ?? '') === s)) refused.push({ item: s, why: 'not a recording camera or preview file of this run' });
  const selected = { package: 1, selected: true, runId: outcome.runId, status: outcome.status, spec: outcome.spec.name, commit: outcome.source?.commit ?? null,
    measurements: measurements ? { measured: measurements.measured, questions: measurements.questions } : null, evidence: [], limits, refused };
  for (const p of picked) {
    const { actual, requested, ...rest } = p;
    const item = { ...rest, requested: requested ? { kind: requested.kind, viewport: requested.viewport, ...(requested.composition ? { composition: requested.composition } : {}) } : undefined, actual: actual ? { mode: actual.mode, presentation: actual.presentation } : undefined };
    if (looksPrivate(item)) refused.push({ item: p.camera ?? p.file, why: 'contains a local path or host' }); else selected.evidence.push(item);
  }
  // Every other field of the projection is screened the same way: a measured value or question basis that holds a path
  // or host is withheld and listed, never copied.
  if (selected.measurements) {
    selected.measurements.measured = selected.measurements.measured.map((m) => { if (!looksPrivate(m.value)) return m; refused.push({ item: `measurement ${m.id}`, why: 'value contains a local path or host' }); return { id: m.id, value: null, withheld: true }; });
    selected.measurements.questions = selected.measurements.questions.map((q) => { if (!looksPrivate(q.basis)) return q; refused.push({ item: `question ${q.id}`, why: 'basis contains a local path or host' }); return { ...q, basis: '[withheld: contains a local path or host]' }; });
  }
  selected.limits = selected.limits.map((l) => (looksPrivate(l) ? '[limit withheld: contains a local path or host]' : l));
  for (const k of ['runId', 'spec', 'commit']) if (looksPrivate(selected[k])) { refused.push({ item: k, why: 'contains a local path or host' }); selected[k] = null; }
  if (looksPrivate(selected)) return { ok: false, error: 'selected projection still holds a local path or host after screening; not written' };
  const out = join(runDir, 'derived', 'package'); mkdirSync(out, { recursive: true });
  writeJson(join(out, 'index.json'), index);
  writeFileSync(join(out, 'index.md'), renderIndex(index));
  writeJson(join(out, 'selected.json'), selected);
  return { ok: true, index: join(out, 'index.json'), md: join(out, 'index.md'), selected: join(out, 'selected.json'), recordings: index.recordings.length, previews: index.previews.length, picked: selected.evidence.length, refused };
}

function renderIndex(ix) {
  const o = ix.outcome, L = [`# Soul Run ${o.runId}: ${o.status}`, '', `Spec ${o.spec.name ?? '-'} (${(o.spec.sha256 ?? '-').slice(0, 12)}), source ${(o.source?.commit ?? '-').slice(0, 12)}; ${o.startedAt} → ${o.endedAt}. Private local index: do not publish; publish only selected.json items with tools/proof/upload.mjs.`, ''];
  if (o.reason) L.push(`Reason: ${o.reason}`, '');
  L.push('## Recordings (uncut, real speed)', '', '| camera | file | s | MB | partial | requested → actual |', '|---|---|---|---|---|---|');
  for (const r of ix.recordings) L.push(`| ${r.camera} | ${r.file ?? '(none)'} | ${r.videoSec ?? r.durationSec ?? '-'} | ${r.bytes ? (r.bytes / 1e6).toFixed(1) : '-'} | ${r.partial ? 'yes' : 'no'} | ${r.requested?.kind ?? '-'} → ${r.actual?.mode ?? '-'} |`);
  if (ix.previews.length) { L.push('', '## Previews (derived, not full proof)', ''); for (const p of ix.previews) L.push(`- ${p.file}: ${p.source.fromSec}–${p.source.toSec} s of ${p.source.file}`); }
  if (ix.measurements) { L.push('', '## Measurements', ''); for (const m of ix.measurements.measured) L.push(`- ${m.id}: ${typeof m.value === 'object' ? JSON.stringify(m.value) : m.value}`); for (const q of ix.measurements.questions) L.push(`- question ${q.id}: ${q.verdict} (${q.basis})`); }
  L.push('', '## Limits', '', ...(ix.limits.length ? ix.limits.map((l) => `- ${l}`) : ['- none recorded']), '');
  return L.join('\n');
}
