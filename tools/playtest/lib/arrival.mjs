// Where a clip starts (#888). A recording starts at arrival by default: the world is on screen and the arrival card is
// gone. Loading is cut, not shown; a take stays one uncut, real-speed recording from that point. A journey whose subject
// is loading or arrival itself records from page creation instead (`load`). Shared by the run cameras
// (observer/browser.mjs) and the proof recorder (.claude/skills/proof/record.mjs).

export const RECORD_STARTS = ['arrival', 'load'];

/** Runs inside the page (keep it self-contained): the world is drawn and no arrival or loading card is showing. The
 *  arrival card ("Arriving in <World>") fades for 0.25 s and is then removed, so its text going is the dismissal. */
export function worldArrived() {
  return !!document.body && !document.body.innerText.includes('Arriving in') && !!document.querySelector('.viewer-history[data-viewer-ready="true"]');
}

/** True when this Playwright can start a page recording mid-page (page.screencast; older Playwright lacks it). */
export const canScreencast = (page) => typeof page?.screencast?.start === 'function' && typeof page.screencast.stop === 'function';

/** startScreencast(page, {path, size}) → {startedAt, mono}: the recording of this page begins now. */
export async function startScreencast(page, { path, size }) {
  await page.screencast.start({ path, ...(size ? { size } : {}) });
  return { startedAt: new Date().toISOString(), mono: performance.timeOrigin + performance.now() };
}

/** The world's API base for a world page URL (`…/w/<slug>…` → origin + `/w/<slug>`), or null when the URL is not a
 *  world page. Only local hosts qualify for the proof recorder's time-of-day default. */
export function worldBase(url, { localOnly = true } = {}) {
  let u; try { u = new URL(url); } catch { return null; }
  if (localOnly && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null;
  const m = /^\/w\/([^/?#]+)/.exec(u.pathname);
  return m ? `${u.origin}/w/${m[1]}` : null;
}
