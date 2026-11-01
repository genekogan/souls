// Lane S3 (2026-10-20, Gene: "music sucks. didn't we make better music? check the tone.js task ... put those on a
// playlist"): the world's music is a playlist of Gene's Sim Score pieces (score/playlist-runtime.mjs, Tone.js, composed in
// the browser a few bars ahead, no samples). It replaces the old generative 'music' bed that sat at the listener and
// restarted whenever the camera moved: this player has nothing to do with the camera, so a piece plays through.
//
// Cost: nothing at arrival. Tone and the score engine (separate chunks) load only once the arrival is over, after the first
// gesture, with music on and sound unmuted, in idle time; each piece is its own chunk, fetched just before it plays, and
// the next one is fetched during the fade (lane SCORE, 2026-10-22: 40 pieces in one chunk would be ~900 KB). Tone owns its own AudioContext (its PluckSynth / BitCrusher need
// its worklets); a gesture resumes it where a browser insists (iOS). Each piece plays TRACK_S, fades, and the next one
// starts; the first piece is picked at random, then in playlist order. Mute or music off stops it; on again restarts
// the current piece. `window.__edenMusic` reports state and a start/stop/advance log (proof, tests).
//
// PERF-EDEN (2026-11-01, measured on souls.game/w/eden: the music cut out and restarted):
//  - Tone's context is created with latencyHint 'playback' and a 0.3 s lookAhead (was the default 'interactive' / 0.1 s):
//    the conductor schedules notes from the main thread, and a 50–80 ms frame spike inside a 0.1 s window dropped or
//    delayed them (audible stutter). 0.3 s rides over such spikes; the music is not interactive, so the latency is free.
//  - Losing the sound (hidden tab, another tab claiming it) no longer stops the piece at once: it ducks for a GRACE_S
//    grace and comes back where it was if the tab is back in time. After the grace (or on music off) the piece is stopped
//    and remembered (seed, cycle, time left): the next start resumes it from that cycle with the same seed, instead of a
//    new random performance from the top.
//  - The gap between pieces is the next piece's build time only (GAP_S 1.5 → 0.25) and its chunk is fetched 20 s before
//    the end, not only during the fade.
//  - Volume changes (the duck near a piano / jukebox) ramp over ~1 s, not 0.2 s.
import { arrivalOver } from '../arrival-marks.ts';
import type { ScoreConductor, ScoreNamespace, ScorePieceModule } from '../score/playlist/engine.d.mts';

export const TRACK_S = 240, FADE_S = 4, GAP_S = 0.25, GRACE_S = 12, PREFETCH_S = 20, LOOK_AHEAD_S = 0.3, VOLUME_RAMP_S = 0.9;
let trackS = TRACK_S;
/** The music sits at the visitor's master volume (0..1), as Tone's destination level in dB (pieces peak at -1 dBFS). */
export const musicDb = (volume: number) => (volume <= 0 ? -Infinity : 20 * Math.log10(Math.min(1, volume)));

type ToneLike = { start(): Promise<void>; getContext(): { state: string; rawContext: { state: string; createAnalyser(): AnalyserNode } }; getDestination(): { volume: { value: number; rampTo(v: number, s: number): void }; connect(n: AudioNode): unknown } };
export type MusicEvent = { t: number; ev: 'load' | 'loaded' | 'start' | 'fade' | 'stop' | 'error' | 'duck' | 'unduck'; piece?: string; reason?: string };
/** A stopped piece's place, so the next start resumes it (same seed and cycle = the same performance from that cycle). */
export type Paused = { index: number; seed: number; cycle: number; remainingMs: number };

let want = false, volume = 0.3;
let Tone: ToneLike | null = null, Sim: ScoreNamespace | null = null, order: readonly string[] = [], loading = false, failed = false;
let loadPiece: ((id: string) => Promise<ScorePieceModule>) | null = null;
const pieceReady = new Map<string, Promise<void>>();
let conductor: ScoreConductor | null = null, index = -1, playing: string | null = null, starting = false, gen = 0;
let endsAt = 0, fading = false, gapUntil = 0, resumeAt = 0, seed = 0, paused: Paused | null = null, graceUntil = 0, prefetched = false;
const events: MusicEvent[] = [];
const note = (e: Omit<MusicEvent, 't'>) => { events.push({ t: Math.round(performance.now()), ...e }); if (events.length > 200) events.splice(0, events.length - 200); };

/** Is the playlist sounding (so a world's own 'music' objects stay quiet under it)? */
export const musicPlaying = () => !!playing || starting;

function idle(fn: () => void) {
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 200);
}
function load() {
  if (loading || Sim || failed) return;
  loading = true; note({ ev: 'load' });
  idle(() => {
    Promise.all([import('tone'), import('../score/playlist/engine.mjs')]).then(([tone, score]) => {
      // PERF-EDEN: a playback-latency context with a wider lookAhead, before the score engine touches Tone's context
      try { const T = tone as unknown as { Context: new (o: { latencyHint: string; lookAhead: number }) => unknown; setContext(c: unknown): void }; T.setContext(new T.Context({ latencyHint: 'playback', lookAhead: LOOK_AHEAD_S })); } catch (e) { note({ ev: 'error', reason: 'context: ' + String(e).slice(0, 120) }); }
      Tone = tone as unknown as ToneLike; Sim = score.createPlaylistScore(tone); order = score.PLAYLIST; loadPiece = score.loadPiece;
      conductor = new Sim.Conductor(); loading = false; note({ ev: 'loaded', reason: `engine, ${order.length} pieces` });
    }, (e) => { loading = false; failed = true; note({ ev: 'error', reason: String(e).slice(0, 200) }); });
  });
}
/** A gesture resumes Tone's context where the browser did not let it start on its own (iOS). */
export function musicGesture() { if (Tone && want && Tone.getContext().state !== 'running') void Tone.start().catch(() => {}); }

/** A piece's own chunk, fetched and registered once: just before it plays, or during the previous piece's fade. */
function fetchPiece(id: string, why: string) {
  let p = pieceReady.get(id);
  if (!p) {
    note({ ev: 'load', piece: id, reason: why });
    p = loadPiece!(id).then((m) => { m.default(Sim!, Tone); note({ ev: 'loaded', piece: id }); });
    p.catch(() => pieceReady.delete(id));   // a failed fetch is tried again the next time round
    pieceReady.set(id, p);
  }
  return p;
}

function start(i: number, reason: string, from: Paused | null = null) {
  if (!Sim || !conductor || !order.length) return;
  const my = ++gen; index = ((i % order.length) + order.length) % order.length;
  const id = order[index];
  starting = true; fading = false; prefetched = false; graceUntil = 0;
  const resume = from && from.index === index ? from : null;
  seed = resume ? resume.seed : (Math.random() * 2 ** 31) >>> 0;
  fetchPiece(id, 'play').then(() => {
    if (my !== gen) return;   // stopped or superseded while its chunk loaded
    const piece = Sim!.pieces.find((p) => p.id === id);
    if (!piece) throw Error('missing piece');
    Tone!.getDestination().volume.value = musicDb(volume);
    return conductor!.play(piece, { seed, cycle: resume?.cycle ?? 0 }).then(() => {
      if (my !== gen) return;   // stopped or superseded while it was building its instruments
      starting = false; playing = id; paused = null; endsAt = performance.now() + (resume ? resume.remainingMs : trackS * 1000);
      note({ ev: 'start', piece: id, reason: resume ? `${reason} at cycle ${resume.cycle}` : reason });
    });
  }).catch((e) => { if (my !== gen) return; starting = false; note({ ev: 'error', piece: id, reason: String(e).slice(0, 200) }); gapUntil = performance.now() + 5000; index++; });
}
/** The playing piece's place now (cycle, time left), for a later resume. */
function placeNow(): Paused | null {
  if (!playing || !conductor) return null;
  let cycle = 0; try { cycle = (conductor as unknown as { now(): { cycle: number } | null }).now()?.cycle ?? 0; } catch { /* no transport */ }
  return { index, seed, cycle, remainingMs: Math.max(15_000, endsAt - performance.now()) };
}
/** `remember`: keep the piece's place so the next start resumes it (focus lost, music off); a finished piece is not kept. */
function stop(reason: string, remember = false) {
  gen++;
  if (playing || starting) { paused = remember ? placeNow() : null; try { conductor?.stop(); } catch { /* disposed */ } note({ ev: 'stop', piece: playing ?? order[index], reason }); }
  playing = null; starting = false; fading = false; graceUntil = 0;
}

/** Called by the sound layer every tick (100 ms) with the visitor's settings and whether sound is unlocked. `audible`:
 *  whether this tab may sound now (audio focus); false ducks the music for a grace, then stops it, remembering its place. */
export function syncMusic(o: { on: boolean; volume: number; unlocked: boolean; audible?: boolean }) {
  want = o.on;
  const hear = o.audible ?? true, now = performance.now();
  if (o.volume !== volume) { volume = o.volume; if (Tone && playing && !graceUntil) Tone.getDestination().volume.rampTo(musicDb(volume), VOLUME_RAMP_S); }
  if (!want) { if (playing || starting) stop('off', true); return; }
  if (!hear) {
    if (starting) stop('focus', true);
    else if (playing) {
      if (!graceUntil) { graceUntil = now + GRACE_S * 1000; try { Tone!.getDestination().volume.rampTo(-60, 0.8); } catch { /* gone */ } note({ ev: 'duck', piece: playing, reason: 'focus' }); }
      else if (now >= graceUntil) stop('focus', true);
    }
    return;
  }
  if (graceUntil && playing) { graceUntil = 0; try { Tone!.getDestination().volume.rampTo(musicDb(volume), 0.6); } catch { /* gone */ } note({ ev: 'unduck', piece: playing, reason: 'focus' }); }
  if (!o.unlocked || !arrivalOver()) return;
  if (!Sim) { load(); return; }
  if (Tone!.getContext().state !== 'running') { if (now >= resumeAt) { resumeAt = now + 2000; void Tone!.start().catch(() => {}); } if (!playing) return; }
  if (!playing && !starting) { if (now >= gapUntil) start(index < 0 ? Math.floor(Math.random() * order.length) : index, index < 0 ? 'first' : 'resume', paused); return; }
  if (playing && !prefetched && now >= endsAt - PREFETCH_S * 1000) { prefetched = true; fetchPiece(order[(index + 1) % order.length], 'prefetch').catch(() => {}); }   // start() reports a failure
  if (playing && !fading && now >= endsAt - FADE_S * 1000) { fading = true; try { conductor?.out?.gain.rampTo(0, FADE_S); } catch { /* gone */ } note({ ev: 'fade', piece: playing }); }
  if (playing && now >= endsAt) { stop('end'); gapUntil = now + GAP_S * 1000; index++; }
}

/** Skip to the next piece (tests, and a hook for a future "next" control). */
export function nextPiece() { if (!Sim) return; stop('next'); index++; gapUntil = 0; }
/** Tests: the remembered place of the last stopped piece (null = none). */
export const musicPaused = () => paused;

export function musicState() {
  return { want, loaded: !!Sim, loading, failed, fetched: [...pieceReady.keys()], playing, starting, index, piece: order[index] ?? null, playlist: order.slice(),
    endsInS: playing ? Math.max(0, Math.round((endsAt - performance.now()) / 1000)) : null, toneCtx: Tone?.getContext().state ?? 'none', db: +musicDb(volume).toFixed(1),
    seed, paused, graceLeftS: graceUntil ? Math.max(0, Math.round((graceUntil - performance.now()) / 1000)) : null, lookAhead: (() => { try { return (Tone?.getContext() as unknown as { lookAhead?: number } | undefined)?.lookAhead ?? null; } catch { return null; } })() };
}
export const musicLog = () => events.slice();
let meter: AnalyserNode | null = null;
/** RMS of the music actually coming out (proof that it sounds; 0 when stopped). */
/** The music's output as a MediaStream (review recordings mix it with the soundscape); null until the score has loaded. */
export function musicTap(): MediaStream | null {
  if (!Tone) return null;
  try { const raw = Tone.getContext().rawContext as unknown as AudioContext, d = raw.createMediaStreamDestination(); Tone.getDestination().connect(d); return d.stream; } catch { return null; }
}
export function musicLevel() {
  if (!Tone) return 0;
  try {
    if (!meter) { meter = Tone.getContext().rawContext.createAnalyser(); meter.fftSize = 2048; Tone.getDestination().connect(meter); }
    const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return +Math.sqrt(q / d.length).toFixed(5);
  } catch { return 0; }
}
/** Tests: a shorter piece length on this page, to watch the playlist advance. */
export function musicTrackSeconds(s: number) { trackS = Math.max(5, s); if (playing) endsAt = Math.min(endsAt, performance.now() + trackS * 1000); }
