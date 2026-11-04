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
import { mkdirSync } from 'node:fs';
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
  const browser = await pw.chromium.launch({ headless, args });
  const cams = [];
  return { browser, gpu, playwright: pw.from,
    openCamera: async (o) => { const c = await openCamera({ ...o, browser }); cams.push(c); return c; },
    close: async () => { for (const c of cams) await c.close().catch(() => {}); await browser.close().catch(() => {}); } };
}

/** openCamera({browser, base, identity?, kind:'follow'|'wide', soulId?, viewport, dpr, arrivalTimeoutMs}) → Camera.
 *  One context (own localStorage) and one persistent page per camera. identity signs in as that dev owner. */
export async function openCamera({ browser, base, identity = null, kind = 'wide', soulId = null, viewport = { width: 1280, height: 800 }, dpr = 1, arrivalTimeoutMs = 90000, name = null }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  await ctx.addInitScript((id) => { try { if (id) localStorage.setItem('sim.dev', id); localStorage.setItem('skipgc', 't'); } catch { /* storage off */ } }, identity);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 300)));
  const t0 = performance.now();
  const url = String(base).replace(/\/+$/, '') + '/' + (kind === 'follow' && soulId ? '#soul/' + encodeURIComponent(soulId) : '');
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => document.body && !document.body.innerText.includes('Arriving in') && document.querySelector('.viewer-history[data-viewer-ready="true"]'), null, { timeout: arrivalTimeoutMs });
  const cam = { name: name ?? (kind === 'follow' ? soulId : 'wide'), kind, soulId, page, context: ctx, errors, arrivedMs: Math.round(performance.now() - t0), follow: null };
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
  cam.close = () => ctx.close();
  if (kind === 'follow') await cam.ensureFollow();
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
