// What a proof clip must never show, shared by the recorder (.claude/skills/proof/record.mjs), which watches for it
// during a take, and upload.mjs, which refuses a take that showed it (#1238).
//
// A Soul's card prints the world's URL and the Soul's id in the Reconnect box and the start prompt, whenever the Soul
// reads as disconnected. On a local world that is a device detail in a published video. The sidecar keeps the kind and
// the second of each hit and never the text, and stays unpublished in any case (it holds local paths).
//
// Limits: this reads text, so it can't see a URL inside a picture, and it polls, so something on screen for less than
// the sidecar's `maxGapSec` can pass between two reads. It reads the top page only, not iframes (the app has none).

// The wording, pinned to the app's own sentences by clip-privacy.test.mjs.
const WORDING = [['reconnect-box', /by prompting your agent/i], ['start-prompt', /resume my existing Soul/i]];
// The live site prints its own name, which is no device detail. Everywhere else the page's host is one.
const PUBLIC_HOST = /(^|\.)soul\.game$/i;

/** The kinds of private thing in a page's visible text. `hostname` also catches the same machine on another port. */
export function pageTextHits(text, hostname) {
  const hits = WORDING.filter(([, re]) => re.test(text)).map(([kind]) => kind);
  if (hostname && !PUBLIC_HOST.test(hostname) && text.toLowerCase().includes(hostname.toLowerCase())) hits.push('page-host');
  return hits;
}

/** Runs in the page: what is painted as text, including fields' values, which innerText leaves out. */
export const readPageText = () => ({
  hostname: location.hostname,
  text: [document.body?.innerText ?? '', ...[...document.querySelectorAll('input,textarea')].filter(e => e.checkVisibility()).map(e => e.value)].join('\n'),
});

/** Polls `read` from now until stop(), which reads once more and returns the sidecar's `privacy` record. `sinceSec()` is
 *  the take's clock. A take with no good read is a hit of kind `not-watched`: nobody looked, so nothing is known. */
export function watchTake({ read, sinceSec, everyMs = 500, stopTimeoutMs = 5000 }) {
  const hits = new Map();
  let polls = 0, missed = 0, lastAt = null, maxGapSec = 0, stopped = false, timer = null, running = null;
  const poll = async () => {
    const at = +sinceSec().toFixed(2);
    try {
      const { text, hostname } = await read();
      polls++;
      if (lastAt != null) maxGapSec = Math.max(maxGapSec, +(at - lastAt).toFixed(2));
      lastAt = at;
      for (const kind of pageTextHits(text, hostname)) {
        const hit = hits.get(kind) ?? { kind, firstSec: at, lastSec: at, polls: 0 };
        hit.lastSec = at; hit.polls++; hits.set(kind, hit);
      }
    } catch { missed++; }                              // a navigation in progress, or the page has gone
  };
  const tick = () => { running = poll().then(() => { if (!stopped) timer = setTimeout(tick, everyMs); }); };
  tick();
  return {
    async stop() {
      stopped = true; clearTimeout(timer);
      let wait;                                        // a stalled page must not hang the recorder
      await Promise.race([running.then(poll), new Promise(r => { wait = setTimeout(r, stopTimeoutMs); })]);
      clearTimeout(wait);
      return { everyMs, polls, missed, maxGapSec, hits: polls ? [...hits.values()] : [{ kind: 'not-watched', firstSec: 0, lastSec: +sinceSec().toFixed(2), polls: 0 }] };
    },
  };
}

/** The hits a clip's sidecar records; none for a clip without a sidecar or from before the watcher. */
export const clipPrivacyHits = sidecar => (Array.isArray(sidecar?.privacy?.hits) ? sidecar.privacy.hits : []);

/** One line of kinds and seconds for a person. Holds no page text. */
export const hitSummary = hits => hits.map(h => `${h.kind} at ${h.firstSec}-${h.lastSec} s`).join(', ');
