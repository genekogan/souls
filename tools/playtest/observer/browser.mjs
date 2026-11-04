// observer/browser.mjs — real-browser cameras on a world (DESIGN §4.2). Playwright comes from mars/viewer.
//
// How follow is achieved (verified 2026-10-24 on the pttest dev world, web build of the SOUL3 integration worktree):
//  1. `#soul/<soulId>` only SELECTS the Soul (Shell.tsx hashTab → selected; card opens) — the camera stays 'broadcast'.
//  2. The harness then clicks the card's Follow button (`.soul-card .soul-follow`, aria-pressed=false) with a real
//     Playwright click; `.viewer-history[data-viewer-mode]` becomes 'follow' and `[data-viewer-selection]` the soulId,
//     and the HUD shows `.viewer-following-label` "Following <Name>".
//  3. The OWNER's card hides Follow while that Soul's agent is away (SoulCard AWAY-UI). Then follow.ok=false with that
//     reason; ensureFollow() (run before every follow shot) clicks as soon as the button appears.
//
// Selectors used by legible() (from apps/web/src; update here when the UI changes):
//  viewer      .viewer-history  data-viewer-mode|selection|presentation|tick|ready ; .viewer-following-label
//  arrival     .viewer-arrival (card "Arriving in <World>"; arrival = body text no longer contains "Arriving in")
//  card        article.soul-card: #soul-card-name, .soul-character, .soul-status (fade word), .soul-doing, .soul-energy,
//              .soul-agent[data-agent-state] (owner presence chip), .soul-follow[aria-pressed], .soul-card-thread
//  agent box   .agent-message: .agent-message-presence[data-agent-presence] > span (e.g. "agent listening", "away");
//              p.agent-message-receipt[data-message-state]: .agent-message-state, .agent-message-text (sent text),
//              .agent-message-reply ×n = [reply(ack), result] in that order when both exist; .agent-message-error
//  bubbles     .world-name-tag[data-soul-id] children: b=name, div1=doing/speech line, div2=card line,
//              [data-channel-chip]; dialogue dock .dlg-row-text, .dlg-lines
//  signs       .world-place-card, .world-hover-tooltip
//  toasts      [role=status],[role=alert],[aria-live] outside the card and agent box; .viewer-follow-hint;
//              .warn (e.g. "A Soul's chosen look could not be composed…" on local dev worlds)
//  roster      .my-souls button[aria-label] (own Souls, "Open Mira (agent away)"); .explore-souls (Explore open)
//  new soul    button.bring-agent-open / any button whose text is "New Soul"
import { mkdirSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolvePlaywright, browsersPath, launchArgs } from '../lib/platform.mjs';
import { now, sleep } from '../lib/clock.mjs';
import { appendJsonl } from '../lib/jsonl.mjs';

/** openBrowser({headless, gpu, serverRoot}) → {browser, gpu, playwright, openCamera(opts), close()}.
 *  Playwright: global `playwright` first (cloud), then <serverRoot>/mars/viewer, then this checkout's viewer (lib/platform.mjs).
 *  On Linux the launch is SwiftShader headless with --no-sandbox whatever `gpu` says; `gpu` returned is what was used. */
export async function openBrowser({ headless = true, gpu: wantGpu = 'metal', serverRoot = null } = {}) {
  browsersPath();
  const pw = resolvePlaywright({ serverRoot });
  if (!pw) throw new Error("Playwright not found (global playwright, <server-root>/mars/viewer or this checkout's viewer)");
  const { args, gpu } = launchArgs({ gpu: wantGpu });
  // The caller owns shutdown (a Soul Run releases the browser from its ledger on cancel). Playwright's default SIGINT,
  // SIGTERM and SIGHUP handlers kill the browser and exit the process mid-cleanup (exit 130), leaking the world and seats.
  const browser = await pw.chromium.launch({ headless, args, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const cams = [], recordings = [];
  let completed = false, closing = null;
  return { browser, gpu, playwright: pw.from, recordings,
    openCamera: async (o) => {
      try { const c = await openCamera({ ...o, browser }); cams.push({ cam: c, o }); return c; }
      catch (e) { if (o.record?.dir) recordings.push(writeRecording({ name: o.name ?? o.kind, o, r: { video: e.video ?? null, opened: e.opened ?? null, closed: { at: new Date().toISOString(), mono: performance.timeOrigin + performance.now() } }, closedBy: 'open-failed', error: String(e?.message ?? e).split('\n')[0] })); throw e; }
    },
    /** The play phase ended normally: recordings closed after this are complete, not partial. */
    markComplete: () => { completed = true; },
    /** close() → recording sidecars. Every path (normal close, failure, a cancelled run's ledger release) comes here, so
     *  each recording is finalized and described; a recording closed before markComplete() is labelled partial. */
    close: () => (closing ??= (async () => {
      for (const { cam, o } of cams) {
        const state = cam.recording ? await cam.state().catch((e) => ({ error: String(e?.message ?? e) })) : null;
        const r = await cam.close().catch((e) => ({ error: String(e?.message ?? e) }));
        if (cam.recording) recordings.push(writeRecording({ name: cam.name, o, cam, state, r, partial: !completed }));
      }
      await browser.close().catch(() => {});
      return recordings;
    })()) };
}

/** Move one camera's video to <dir>/<name>.webm and write <name>.webm.json beside it: what was asked, what the camera
 *  showed, when it ran, page errors, size and hash. Failed and partial recordings are kept and labelled, never dropped. */
export function writeRecording({ name, o, cam = null, state = null, r = null, partial = false, closedBy = null, error = null }) {
  const dir = o.record.dir, file = join(dir, `${name}.webm`);
  let bytes = null, sha256 = null;
  try { if (r?.video && existsSync(r.video)) { renameSync(r.video, file); bytes = statSync(file).size; sha256 = createHash('sha256').update(readFileSync(file)).digest('hex'); } } catch (e) { error ??= String(e?.message ?? e); }
  const opened = r?.opened ?? cam?.opened ?? null, closed = r?.closed ?? null;
  // The video's own length (ffprobe, when installed): it starts at the first painted frame, so it can be shorter than
  // the context's open-to-close time; the gap is lead-in before the page painted, not a cut.
  let videoSec = null;
  if (sha256) { const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags=DURATION:stream_tags=DURATION', '-of', 'json', file], { encoding: 'utf8' }); try { const j = JSON.parse(p.stdout); const d = Number(j.format?.duration); const tag = j.streams?.[0]?.tags?.DURATION ?? j.format?.tags?.DURATION; videoSec = Number.isFinite(d) ? +d.toFixed(2) : tag ? +tag.split(':').reduce((a, x) => a * 60 + Number(x), 0).toFixed(2) : null; } catch { /* no ffprobe */ } }
  const sec = videoSec ?? (opened && closed ? (closed.mono - opened.mono) / 1000 : null); // MB per camera-minute basis
  const meta = { recording: 1, camera: name, file: sha256 ? `${name}.webm` : null, bytes, sha256, uncut: true, realSpeed: true,
    partial: !!partial || !!closedBy, ...(closedBy ? { closedBy } : {}), ...(error || r?.error ? { error: error ?? r.error } : {}),
    requested: { kind: o.kind ?? 'wide', soulId: o.soulId ?? null, identity: o.identity ? 'dev-owner' : 'public', viewport: o.viewport ?? null, ...(o.kind === 'free' ? { composition: o.composition ?? FREE_COMPOSITION } : {}) },
    actual: state?.actual ?? null, ready: state?.ready ?? false, arrivedMs: cam?.arrivedMs ?? null,
    openedAt: opened?.at ?? null, closedAt: closed?.at ?? null, durationSec: opened && closed ? +((closed.mono - opened.mono) / 1000).toFixed(2) : null, videoSec,
    encoding: cam?.encoding ?? recordEncoding(o.record.size ?? 'compact', o.viewport ?? undefined),
    mbPerMin: bytes != null && sec > 0 ? +(bytes / 1e6 / (sec / 60)).toFixed(2) : null,
    pageErrors: cam?.errors ?? [], ...(o.record.meta ?? {}) };
  writeFileSync(`${file}.json`, JSON.stringify(meta, null, 1) + '\n');
  return meta;
}

/** Recording size (#802). Playwright's recorder encodes VP9 at a fixed 25 fps with a target bitrate of 1000 kbps ×
 *  max(1, w·h / (800·450)); only the frame size is ours to set. `compact` (the default) fits the viewport, aspect kept,
 *  into 800×450 pixels' worth of area, where the target sits at its 1000 kbps floor (about 7.5–8 MB per camera-minute,
 *  measured median 7.7; 1280×800 at full size targets about 2840 kbps). `viewport` records at the viewport's own size
 *  (the earlier quality); {width, height} is an explicit size. The page is scaled down to fit; what is recorded and when
 *  is unchanged. */
export const RECORD_FPS = 25, RECORD_FLOOR_AREA = 800 * 450;
export const RECORD_SIZES = ['compact', 'viewport'];
export function recordEncoding(setting = 'compact', viewport = { width: 1280, height: 800 }) {
  let size;
  if (setting && typeof setting === 'object') size = { width: setting.width, height: setting.height };
  else if (setting === 'viewport') size = { width: viewport.width, height: viewport.height };
  else { const k = Math.min(1, Math.sqrt(RECORD_FLOOR_AREA / (viewport.width * viewport.height))); size = { width: Math.max(2, Math.floor(viewport.width * k / 2) * 2), height: Math.max(2, Math.floor(viewport.height * k / 2) * 2) }; }
  const targetKbps = Math.round(Math.max(1, size.width * size.height / RECORD_FLOOR_AREA) * 1000);
  return { setting: setting && typeof setting === 'object' ? 'explicit' : (setting ?? 'compact'), size, fps: RECORD_FPS, targetKbps };
}

/** The free-camera recipe (#754): a real click on the viewer's own broadcast/free toggle, the viewer's "Reset view", then
 *  an optional fixed mouse drag and wheel on the canvas centre. The default composition is the reset pose itself (the
 *  whole settlement). Same start pose, same input: repeatable. Only this page's view moves. */
export const FREE_COMPOSITION = { drag: [0, 0], wheel: 0 };
const FREE_CONTROLS = ['.camera-main', '.viewer-broadcast'];

/** openCamera({browser, base, identity?, kind:'follow'|'wide'|'free', soulId?, viewport, dpr, arrivalTimeoutMs, record?,
 *  composition?}) → Camera. One context (own localStorage) and one persistent page per camera. identity signs in as that
 *  dev owner. record: {dir, size?} records the context as one uncut real-speed video (Playwright recordVideo) until
 *  close(), at recordEncoding(size) (default compact). */
export async function openCamera({ browser, base, identity = null, kind = 'wide', soulId = null, viewport = { width: 1280, height: 800 }, dpr = 1, arrivalTimeoutMs = 90000, name = null, record = null, composition = null }) {
  const opened = { at: new Date().toISOString(), mono: performance.timeOrigin + performance.now() };
  const encoding = record?.dir ? recordEncoding(record.size ?? 'compact', viewport) : null;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, ...(encoding ? { recordVideo: { dir: record.dir, size: encoding.size } } : {}) });
  await ctx.addInitScript((id) => { try { if (id) localStorage.setItem('sim.dev', id); localStorage.setItem('skipgc', 't'); } catch { /* storage off */ } }, identity);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 300)));
  const t0 = performance.now();
  const url = String(base).replace(/\/+$/, '') + '/' + (kind === 'follow' && soulId ? '#soul/' + encodeURIComponent(soulId) : '');
  try {
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => document.body && !document.body.innerText.includes('Arriving in') && document.querySelector('.viewer-history[data-viewer-ready="true"]'), null, { timeout: arrivalTimeoutMs });
  } catch (e) { // a camera that never arrived leaves no open context; its partial video is kept as failed evidence
    const v = record?.dir ? page.video() : null;
    await ctx.close().catch(() => {});
    e.video = v ? await v.path().catch(() => null) : null; e.opened = opened;
    throw e;
  }
  const cam = { name: name ?? (kind === 'follow' ? soulId : kind), kind, soulId, page, context: ctx, errors, arrivedMs: Math.round(performance.now() - t0), follow: null, free: null, opened, recording: !!record?.dir, encoding };
  cam.viewer = () => page.evaluate(() => { const d = document.querySelector('.viewer-history')?.dataset ?? {}; return { mode: d.viewerMode ?? null, selection: d.viewerSelection ?? null, presentation: d.viewerPresentation ?? null, tick: d.viewerTick ? Number(d.viewerTick) : null }; }).catch(() => ({}));
  cam.ensureFollow = async ({ waitMs = 6000 } = {}) => {
    if (kind !== 'follow') return null;
    let v = await cam.viewer();
    if (v.mode === 'follow' && v.selection === soulId) return (cam.follow = { ok: true, how: cam.follow?.how ?? 'already' });
    if (v.selection !== soulId) { await page.evaluate((id) => { location.hash = 'soul/' + encodeURIComponent(id); }, soulId); await sleep(500); }
    const btn = page.locator('.soul-card .soul-follow[aria-pressed="false"]');
    try { await btn.waitFor({ state: 'visible', timeout: waitMs }); } catch {
      return (cam.follow = { ok: false, how: null, reason: 'no Follow button on the card (the owner card hides it while the agent is away)' });
    }
    await btn.click();
    await page.waitForFunction((id) => { const d = document.querySelector('.viewer-history')?.dataset; return d?.viewerMode === 'follow' && d.viewerSelection === id; }, soulId, { timeout: 5000 }).catch(() => {});
    v = await cam.viewer();
    return (cam.follow = v.mode === 'follow' ? { ok: true, how: 'hash #soul/<id> + click .soul-card .soul-follow' } : { ok: false, how: 'clicked', reason: `mode stayed ${v.mode}` });
  };
  /** shot(outPath) → {t, mono, ms, mode, selection, following} */
  cam.shot = async (outPath) => {
    if (kind === 'follow' && !cam.follow?.ok) await cam.ensureFollow({ waitMs: 1500 });
    mkdirSync(dirname(outPath), { recursive: true });
    const c = now(), s0 = performance.now();
    // software GL (the Linux cloud box) renders a frame slowly: a 30 s timeout dropped every shot of a 1280x800 world page
    await page.screenshot({ path: outPath, timeout: process.platform === 'linux' ? 90000 : 30000 });
    const v = await cam.viewer();
    return { t: c.t, mono: c.mono, ms: Math.round(performance.now() - s0), path: outPath, mode: v.mode, selection: v.selection, tick: v.tick, following: v.mode === 'follow' };
  };
  cam.legible = () => page.evaluate(readLegible);
  /** applyFree() → {ok, how, mode, navigation, composition, reason?}: the free recipe through the viewer's own controls. */
  cam.applyFree = async (comp = composition ?? FREE_COMPOSITION) => {
    // The viewer's own broadcast/free toggle: `.camera-main` ("Broadcast: Switch to Free camera") in current builds,
    // the `.viewer-broadcast` pill in earlier ones. Clicked only while the camera is on broadcast.
    let control = null;
    for (const sel of FREE_CONTROLS) if (await page.locator(sel).count()) { control = sel; break; }
    if (!control) return (cam.free = { ok: false, how: null, composition: comp, reason: `no free-camera control (${FREE_CONTROLS.join(', ')}) on this page` });
    if ((await cam.viewer()).mode === 'broadcast') await page.locator(control).first().click();
    await page.waitForFunction(() => document.querySelector('.viewer-history')?.dataset.viewerMode === 'manual', null, { timeout: 5000 }).catch(() => {});
    // Start from the viewer's own reset pose (camera controls → "Reset view"), not from wherever broadcast had cut,
    // so the composition is the same every run. Without that control the start pose is recorded as not reset.
    let reset = false;
    const resetBtn = () => page.getByRole('button', { name: /^Reset view$/ }).first();
    if (!(await resetBtn().isVisible().catch(() => false)) && await page.locator('.hud-camera').count()) await page.locator('.hud-camera').first().click().catch(() => {});
    if (await resetBtn().isVisible().catch(() => false)) { await resetBtn().click().catch(() => {}); reset = true; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(800); }
    const vp = page.viewportSize() ?? viewport, cx = Math.round(vp.width / 2), cy = Math.round(vp.height / 2);
    if (comp.drag[0] || comp.drag[1]) { // a drag only: a press and release in place would be a click on the world
      await page.mouse.move(cx, cy); await page.mouse.down();
      await page.mouse.move(cx + comp.drag[0], cy + comp.drag[1], { steps: 20 }); await page.mouse.up();
    }
    if (comp.wheel) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, comp.wheel); }
    await page.waitForTimeout(600);
    const v = await cam.viewer(), navigation = await page.evaluate(() => document.querySelector('.viewer-history')?.dataset.viewerNavigation ?? null).catch(() => null);
    return (cam.free = v.mode === 'manual' ? { ok: true, how: `click ${control}${reset ? ' + Reset view' : ''} + mouse drag/wheel`, reset, mode: v.mode, navigation, composition: comp }
      : { ok: false, how: 'clicked', reset, mode: v.mode ?? null, navigation, composition: comp, reason: `mode stayed ${v.mode ?? 'unknown'}` });
  };
  /** state() → requested versus actual camera state, for the recording sidecar. */
  cam.state = async () => ({ requested: { kind, soulId, ...(kind === 'free' ? { composition: composition ?? FREE_COMPOSITION } : {}) },
    actual: { ...(await cam.viewer()), follow: cam.follow, free: cam.free }, ready: true, arrivedMs: cam.arrivedMs });
  /** close() → {video, closed} — the video file is complete only after its context closed. */
  cam.close = async () => {
    const video = cam.recording ? page.video() : null;
    await ctx.close();
    const closed = { at: new Date().toISOString(), mono: performance.timeOrigin + performance.now() };
    return { video: video ? await video.path().catch(() => null) : null, opened, closed };
  };
  // Post-arrival setup can throw too (a click on a detached control): close the context the same way, so its video is
  // finalized and named in the open-failed sidecar rather than left open until browser.close().
  try {
    if (kind === 'follow') await cam.ensureFollow();
    if (kind === 'free') await cam.applyFree();
  } catch (e) {
    const v = record?.dir ? page.video() : null;
    await ctx.close().catch(() => {});
    e.video = v ? await v.path().catch(() => null) : null; e.opened = opened;
    throw e;
  }
  return cam;
}

/** Runs inside the page. Keep it self-contained (no closures). */
function readLegible() {
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const tx = (el) => (el ? (el.innerText ?? el.textContent ?? '').trim() || null : null);
  const cardEl = q('article.soul-card'), box = q('.agent-message');
  const replies = qa('.agent-message-reply', box ?? document.createElement('i')).map(tx);
  const receiptEl = box && q('.agent-message-receipt', box);
  const card = cardEl ? {
    name: tx(q('#soul-card-name', cardEl)) ?? tx(q('.soul-back-name', cardEl)),
    presence: tx(box && q('.agent-message-presence > span', box)) ?? tx(q('.soul-agent', cardEl)),
    presenceState: (box && q('.agent-message-presence', box)?.dataset.agentPresence) ?? q('.soul-agent', cardEl)?.dataset.agentState ?? null,
    chip: tx(q('.soul-agent', cardEl)), fade: tx(q('.soul-status', cardEl)), doing: tx(q('.soul-doing', cardEl)), energy: tx(q('.soul-energy', cardEl)),
    following: q('.soul-follow', cardEl)?.getAttribute('aria-pressed') === 'true', followButton: !!q('.soul-follow', cardEl),
    sent: tx(receiptEl && q('.agent-message-text', receiptEl)), messageState: receiptEl?.dataset.messageState ?? null,
    stateText: tx(receiptEl && q('.agent-message-state', receiptEl)),
    ack: replies[0] ?? null, result: replies.length > 1 ? replies[1] : null, replies,
    error: tx(box && q('.agent-message-error', box)), thread: tx(q('.soul-card-thread', cardEl)), view: cardEl.classList.contains('soul-activity') ? 'activity' : 'card',
  } : null;
  const bubbles = qa('.world-name-tag').map((el) => { const k = [...el.children]; return { soulId: el.dataset.soulId ?? null, name: tx(k[0]), line: tx(k[1]), card: tx(k[2]), chip: tx(q('[data-channel-chip]', el)) }; })
    .concat(qa('.dlg-row-text, .dlg-lines').map((el) => ({ dock: true, text: tx(el) })));
  const inCard = (el) => (cardEl && cardEl.contains(el)) || (box && box.contains(el));
  const toasts = qa('[role=status],[role=alert],[aria-live],.viewer-follow-hint,.warn').filter((el) => !inCard(el)).map((el) => ({ cls: String(el.className || el.getAttribute('role') || ''), text: tx(el) })).filter((x) => x.text);
  const d = q('.viewer-history')?.dataset ?? {};
  return {
    card, bubbles,
    signs: qa('.world-place-card, .world-hover-tooltip').map(tx).filter(Boolean),
    toasts: toasts.filter((x, i, a) => a.findIndex((y) => y.text === x.text) === i),
    roster: qa('.my-souls button').map((b) => b.getAttribute('aria-label') || tx(b)).concat(qa('.explore-souls').map(tx)).filter(Boolean),
    arrival: tx(q('.viewer-arrival')),
    newSoul: qa('button').some((b) => (b.innerText || '').trim() === 'New Soul'),
    viewer: { mode: d.viewerMode ?? null, selection: d.viewerSelection ?? null, presentation: d.viewerPresentation ?? null, following: tx(q('.viewer-following-label')) },
    raw: (document.body.innerText || '').slice(0, 20000),
  };
}

/** sampler({cameras:{name:Camera}|Camera[], everySec, runDir, onShot}) → {stop(), done}. Shots go to
 *  <runDir>/shots/<cam>/<mono>.png and one line each in <runDir>/shots/index.jsonl. */
export function sampler({ cameras, everySec = 5, runDir, onShot = null }) {
  const list = Array.isArray(cameras) ? cameras.map((c) => [c.name, c]) : Object.entries(cameras);
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      const tick = performance.now();
      for (const [name, cam] of list) {
        if (stopped) break;
        try {
          const mono = now().mono, path = join(runDir, 'shots', name, `${mono}.png`);
          const rec = { cam: name, ...(await cam.shot(path)), mono }; // mono = the file name; rec.t is when the shot ran
          appendJsonl(join(runDir, 'shots', 'index.jsonl'), rec);
          await onShot?.(rec, cam);
        } catch (e) { appendJsonl(join(runDir, 'shots', 'index.jsonl'), { cam: name, ...now(), error: String(e?.message ?? e).slice(0, 300) }); }
      }
      const wait = everySec * 1000 - (performance.now() - tick);
      if (wait > 0 && !stopped) await sleep(wait);
    }
  })();
  return { stop: async () => { stopped = true; await done; }, done };
}
