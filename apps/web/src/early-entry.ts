// P7b lever E1: the page's first loading phase (phased-entry.ts writes it into index.html as its own entry). On the early
// layer's pages it starts the world's entity layer at once and lets the second phase (main.tsx, React, the Shell, the
// socket) start when the snapshot is in; elsewhere it lets it start at once and does nothing else.
import './client-errors.ts';   // lane ERR: first, so errors from here on are reported
import { installAssetTransport } from './boot-assets.ts';
import { earlyLayerWanted, startEarlyLayer } from './early-layer.ts';
import { callPhase2 } from './phased-entry.ts';
import { followBootLight } from './boot-light.ts';

const phase2 = (hold = false) => callPhase2(hold ? true : undefined);
/** P7d: phase two's entry waits at most this long after the snapshot for the early renderer's poster. */
const POSTER_WAIT_MS = 5_000;
let started = false;
try {
  // P7d: when the snapshot is in, the early renderer's chunk is asked for first (ahead of phase two on the link); phase
  // two downloads (and its socket opens) meanwhile, but its entry (React, the Shell, LiveWorld: ~1 s of a phone's CPU)
  // runs once the poster is up or the early renderer gave up, so LiveWorld never takes the renderer before the poster
  let asked = false;
  const onSnapshot = () => {
    if (asked) return; asked = true;
    if (new URLSearchParams(location.search).get('earlyRender') === '0') return phase2();
    let released = false; const release = () => { if (!released) { released = true; phase2(); } };
    phase2(true); setTimeout(release, POSTER_WAIT_MS);
    try { void import('./early-render.ts').then((m) => m.startEarlyRender(release), release); } catch { release(); }
  };
  if (earlyLayerWanted()) { installAssetTransport(); followBootLight(); started = startEarlyLayer(onSnapshot); }
} catch { /* LiveWorld makes its own layer */ }
if (!started) phase2();
