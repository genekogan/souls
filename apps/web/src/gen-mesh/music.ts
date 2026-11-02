// Lane S3 (2026-10-20, Gene: "music sucks. didn't we make better music? check the tone.js task ... put those on a
// playlist"): the world's music is a playlist of Gene's Sim Score pieces (score/playlist-runtime.mjs, Tone.js, composed in
// the browser a few bars ahead, no samples). It replaces the old generative 'music' bed that sat at the listener and
// restarted whenever the camera moved: this player has nothing to do with the camera, so a piece plays through.
//
// Cost: nothing at arrival. The player loads only once the arrival is over, after the first gesture, with music on and
// sound unmuted, in idle time. Each piece plays TRACK_S, fades, and the next one starts; the first piece is picked at
// random, then in playlist order. Mute or music off stops it; on again restarts the current piece. `window.__edenMusic`
// reports state and a start/stop/advance log (proof, tests).
//
// PERF-MUSIC (2026-11-01, Gene: "can we move music to a separate thread, and make them all mp3s instead of rendering over
// cpu?"): two sources, chosen per piece (`source` in the state and the log):
//  - 'file' (the default): the piece pre-rendered by the score engine itself (tools/score/render-playlist.mjs, one seed per
//    piece, 240 s, on the asset CDN; score/playlist/playlist-audio.json is the index) and streamed by a media element
//    through a GainNode graph (music-file.ts): decoding happens in the browser's media pipeline, off the main thread, so a
//    frame spike cannot drop a note. The next file is prefetched 20 s before the end and crossfades in 3 s before it, while
//    the current one fades over 4 s; pause/resume keeps the position in the file. Tone and the engine are never loaded.
//  - 'tone': the Tone.js path (synthesised on the main thread), used when the index lacks a piece or its file fails
//    (3 failures in a row give up on files for the session). PERF-EDEN (2026-11-01): Tone's context has latencyHint
//    'playback' and a 0.3 s lookAhead so a 50–80 ms frame spike does not drop notes; a stopped piece is remembered
//    (seed, cycle) and resumes from that cycle with the same seed. The gap between pieces is the next piece's build time.
//  - Both: losing the sound (hidden tab, another tab claiming it) ducks the piece for a GRACE_S grace and brings it back where
//    it was if the tab is back in time; after the grace (or on music off) the piece is stopped and remembered (file
//    position, or Tone seed and cycle). Volume changes (the duck near a piano / jukebox) ramp over ~1 s.
import { arrivalOver } from '../arrival-marks.ts';
import type { ScoreConductor, ScoreNamespace, ScorePieceModule } from '../score/playlist/engine.d.mts';
import type { FilePlayer } from './music-file.ts';

export const TRACK_S = 240, FADE_S = 4, GAP_S = 0.25, GRACE_S = 12, PREFETCH_S = 20, LOOK_AHEAD_S = 0.3, VOLUME_RAMP_S = 0.9, FILE_FAILURES_MAX = 3;
let trackS = TRACK_S;
/** The music sits at the visitor's master volume (0..1), as the music's destination level in dB (pieces peak at -1 dBFS). */
export const musicDb = (volume: number) => (volume <= 0 ? -Infinity : 20 * Math.log10(Math.min(1, volume)));

type ToneLike = { start(): Promise<void>; getContext(): { state: string; rawContext: { state: string; createAnalyser(): AnalyserNode } }; getDestination(): { volume: { value: number; rampTo(v: number, s: number): void }; connect(n: AudioNode): unknown } };
export type MusicSource = 'file' | 'tone';
// reason is the machine-readable transition; file selection and resume position are separate log metadata.
export type MusicEvent = { t: number; ev: 'load' | 'loaded' | 'start' | 'fade' | 'stop' | 'error' | 'duck' | 'unduck'; piece?: string; reason?: string; source?: MusicSource; performance?: number; performances?: number; positionS?: number };
/** A stopped piece's place, so the next start resumes it: the position in its file, or (Tone) the seed and cycle, which
 *  give the same performance from that cycle. */
export type Paused = { index: number; seed: number; cycle: number; remainingMs: number; positionS?: number; perf?: number };

let want = false, volume = 0.3;
let Tone: ToneLike | null = null, Sim: ScoreNamespace | null = null, order: readonly string[] = [], loading = false, failed = false;
let loadPiece: ((id: string) => Promise<ScorePieceModule>) | null = null;
const pieceReady = new Map<string, Promise<void>>();
let file: FilePlayer | null = null, fileFailures = 0, fileOff = false, fileIndexSize = 0;
const fileFailed = new Set<string>();
let conductor: ScoreConductor | null = null, index = -1, playing: string | null = null, source: MusicSource | null = null, starting = false, gen = 0;
let endsAt = 0, fading = false, gapUntil = 0, resumeAt = 0, seed = 0, paused: Paused | null = null, graceUntil = 0, prefetched = false;
const events: MusicEvent[] = [];
const note = (e: Omit<MusicEvent, 't'>) => { events.push({ t: Math.round(performance.now()), ...e }); if (events.length > 200) events.splice(0, events.length - 200); };

/** Is the playlist sounding (so a world's own 'music' objects stay quiet under it)? */
export const musicPlaying = () => !!playing || starting;

function idle(fn: () => void) {
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 200);
}
/** Which source plays `id` now: its file unless files are off, it has none, or its file failed before. */
const sourceFor = (id: string): MusicSource => (file && !fileOff && file.has(id) && !fileFailed.has(id) ? 'file' : 'tone');
/** The playlist order comes with the file index (tiny); Tone and the engine (large) only when a piece needs them. */
function loadFiles() {
  if (loading || file || failed) return;
  loading = true; note({ ev: 'load', reason: 'file index' });
  idle(() => {
    Promise.all([import('./music-file.ts'), import('../score/playlist/playlist-audio.json'), import('../score/playlist/order.mjs').then((m) => m.PLAYLIST as readonly string[])]).then(([mod, idx, playlist]) => {
      const index = (idx as { default: import('./music-file.ts').FileIndex }).default ?? (idx as unknown as import('./music-file.ts').FileIndex);
      order = playlist; fileIndexSize = Object.keys(index.pieces ?? {}).length;
      file = new mod.FilePlayer(mod.browserEnv(), index, (e) => onFileEvent(e));
      file.fadeS = FADE_S; file.prefetchS = PREFETCH_S; file.trackS = trackS; file.setVolume(musicDb(volume), 0.01);
      if (!fileIndexSize) fileOff = true;
      loading = false; note({ ev: 'loaded', reason: `file index, ${fileIndexSize} of ${order.length} pieces` });
    }, (e) => { loading = false; fileOff = true; note({ ev: 'error', reason: 'file index: ' + String(e).slice(0, 200) }); loadTone(); });
  });
}
let toneLoading = false;
function loadTone() {
  if (toneLoading || Sim || failed) return;
  toneLoading = true; note({ ev: 'load', reason: 'tone engine' });
  idle(() => {
    Promise.all([import('tone'), import('../score/playlist/engine.mjs')]).then(([tone, score]) => {
      // PERF-EDEN: a playback-latency context with a wider lookAhead, before the score engine touches Tone's context
      try { const T = tone as unknown as { Context: new (o: { latencyHint: string; lookAhead: number }) => unknown; setContext(c: unknown): void }; T.setContext(new T.Context({ latencyHint: 'playback', lookAhead: LOOK_AHEAD_S })); } catch (e) { note({ ev: 'error', reason: 'context: ' + String(e).slice(0, 120) }); }
      Tone = tone as unknown as ToneLike; Sim = score.createPlaylistScore(tone); order = score.PLAYLIST; loadPiece = score.loadPiece;
      conductor = new Sim.Conductor(); toneLoading = false; note({ ev: 'loaded', reason: `engine, ${order.length} pieces` });
    }, (e) => { toneLoading = false; failed = true; note({ ev: 'error', reason: String(e).slice(0, 200) }); });
  });
}
/** A gesture resumes the music's context where the browser did not let it start on its own (iOS). */
export function musicGesture() {
  if (!want) return;
  if (Tone && Tone.getContext().state !== 'running') void Tone.start().catch(() => {});
  try { if (file && file.ctx.state !== 'running') void file.ctx.resume().catch(() => {}); } catch { /* no context yet */ }
}

/** A piece's own chunk, fetched and registered once: just before it plays, or during the previous piece's fade. */
function fetchPiece(id: string, why: string) {
  let p = pieceReady.get(id);
  if (!p) {
    note({ ev: 'load', piece: id, reason: why, source: 'tone' });
    p = loadPiece!(id).then((m) => { m.default(Sim!, Tone); note({ ev: 'loaded', piece: id, source: 'tone' }); });
    p.catch(() => pieceReady.delete(id));   // a failed fetch is tried again the next time round
    pieceReady.set(id, p);
  }
  return p;
}

/** The file player's own events (its crossfade starts and ends), into the log and the state. */
function onFileEvent(e: Omit<MusicEvent, 't'>) {
  note({ ...e, source: 'file' });
  if (e.ev === 'start' && e.reason === 'crossfade' && e.piece) {   // the next piece took over during the fade
    const i = order.indexOf(e.piece); if (i >= 0) index = i;
    playing = e.piece; source = 'file'; starting = false; fading = false; prefetched = false; paused = null; endsAt = file!.playing()?.endsAt ?? endsAt;
  } else if (e.ev === 'error' && e.piece) fileTrouble(e.piece, e.reason ?? '');
}
function fileTrouble(id: string, reason: string) {
  fileFailed.add(id); fileFailures++;
  if (fileFailures >= FILE_FAILURES_MAX && !fileOff) { fileOff = true; note({ ev: 'error', reason: `files off after ${fileFailures} failures: ${reason.slice(0, 80)}`, source: 'file' }); }
  loadTone();
}

function start(i: number, reason: string, from: Paused | null = null) {
  if (!order.length) return;
  const my = ++gen; index = ((i % order.length) + order.length) % order.length;
  const id = order[index];
  starting = true; fading = false; prefetched = false; graceUntil = 0;
  const resume = from && from.index === index ? from : null;
  if (sourceFor(id) === 'file') {
    file!.trackS = trackS; file!.setVolume(musicDb(volume), 0.01);
    file!.play(id, { positionS: resume?.positionS ?? 0, perf: resume?.perf, reason }).then(() => {
      if (my !== gen) return;
      starting = false; playing = id; source = 'file'; paused = null; endsAt = file!.playing()?.endsAt ?? performance.now() + trackS * 1000;
    }, (e) => {
      if (my !== gen) return;
      starting = false; note({ ev: 'error', piece: id, reason: String(e).slice(0, 200), source: 'file' });
      fileTrouble(id, String(e)); gapUntil = performance.now() + 500;   // the same piece again, through Tone, once it has loaded
    });
    return;
  }
  if (!Sim || !conductor) { starting = false; loadTone(); return; }
  seed = resume ? resume.seed : (Math.random() * 2 ** 31) >>> 0;
  fetchPiece(id, 'play').then(() => {
    if (my !== gen) return;   // stopped or superseded while its chunk loaded
    const piece = Sim!.pieces.find((p) => p.id === id);
    if (!piece) throw Error('missing piece');
    Tone!.getDestination().volume.value = musicDb(volume);
    return conductor!.play(piece, { seed, cycle: resume?.cycle ?? 0 }).then(() => {
      if (my !== gen) return;   // stopped or superseded while it was building its instruments
      starting = false; playing = id; source = 'tone'; paused = null; endsAt = performance.now() + (resume ? resume.remainingMs : trackS * 1000);
      note({ ev: 'start', piece: id, reason: resume ? `${reason} at cycle ${resume.cycle}` : reason, source: 'tone' });
    });
  }).catch((e) => { if (my !== gen) return; starting = false; note({ ev: 'error', piece: id, reason: String(e).slice(0, 200), source: 'tone' }); gapUntil = performance.now() + 5000; index++; });
}
/** The playing piece's place now (file position, or Tone cycle; time left), for a later resume. */
function placeNow(): Paused | null {
  if (!playing) return null;
  if (source === 'file') { const p = file?.stop(); return { index, seed, cycle: 0, remainingMs: Math.max(15_000, p?.remainingMs ?? endsAt - performance.now()), positionS: p?.positionS ?? 0, perf: p?.perf }; }
  if (!conductor) return null;
  let cycle = 0; try { cycle = (conductor as unknown as { now(): { cycle: number } | null }).now()?.cycle ?? 0; } catch { /* no transport */ }
  return { index, seed, cycle, remainingMs: Math.max(15_000, endsAt - performance.now()) };
}
/** `remember`: keep the piece's place so the next start resumes it (focus lost, music off); a finished piece is not kept. */
function stop(reason: string, remember = false) {
  gen++;
  if (playing || starting) {
    paused = remember ? placeNow() : null;
    try { file?.stop(); } catch { /* gone */ }
    try { conductor?.stop(); } catch { /* disposed */ }
    note({ ev: 'stop', piece: playing ?? order[index], reason, source: source ?? undefined });
  }
  playing = null; source = null; starting = false; fading = false; graceUntil = 0;
}
/** The music's level, both sources (whichever sounds), ramped. */
function setLevel(db: number, rampS: number) {
  try { file?.setVolume(db, rampS); } catch { /* gone */ }
  if (Tone) { try { Tone.getDestination().volume.rampTo(db, rampS); } catch { /* gone */ } }
}

/** Called by the sound layer every tick (100 ms) with the visitor's settings and whether sound is unlocked. `audible`:
 *  whether this tab may sound now (audio focus); false ducks the music for a grace, then stops it, remembering its place. */
export function syncMusic(o: { on: boolean; volume: number; unlocked: boolean; audible?: boolean }) {
  want = o.on;
  const hear = o.audible ?? true, now = performance.now();
  if (o.volume !== volume) { volume = o.volume; if (playing && !graceUntil) setLevel(musicDb(volume), VOLUME_RAMP_S); }
  if (!want) { if (playing || starting) stop('off', true); return; }
  if (!hear) {
    if (starting) stop('focus', true);
    else if (playing) {
      if (!graceUntil) { graceUntil = now + GRACE_S * 1000; setLevel(-60, 0.8); note({ ev: 'duck', piece: playing, reason: 'focus' }); }
      else if (now >= graceUntil) stop('focus', true);
    }
    return;
  }
  if (graceUntil && playing) { graceUntil = 0; setLevel(musicDb(volume), 0.6); note({ ev: 'unduck', piece: playing, reason: 'focus' }); }
  if (!o.unlocked || !arrivalOver()) return;
  if (!file && !Sim) { loadFiles(); return; }
  if (!order.length) return;
  if (!playing && !starting) {
    if (now < gapUntil) return;
    const first = index < 0; if (first) index = Math.floor(Math.random() * order.length);   // picked once, kept while its source loads
    if (sourceFor(order[index]) === 'tone') {
      if (!Sim) { loadTone(); return; }
      if (Tone!.getContext().state !== 'running') { if (now >= resumeAt) { resumeAt = now + 2000; void Tone!.start().catch(() => {}); } return; }
    }
    start(index, first ? 'first' : paused?.index === index ? 'resume' : 'next', paused); return;
  }
  if (playing && source === 'file') {
    // the file player schedules its own prefetch, fade and crossfade; a piece that ends without a successor (its file
    // failed, or the next has no file) is advanced here
    const nextId = order[(index + 1) % order.length];
    const r = file!.tick(now, sourceFor(nextId) === 'file' ? nextId : null);
    const p = file!.playing(); fading = !!p?.fading; if (p) endsAt = p.endsAt;
    if (!prefetched && now >= endsAt - PREFETCH_S * 1000) { prefetched = true; if (sourceFor(nextId) === 'tone') { loadTone(); if (Sim) fetchPiece(nextId, 'prefetch').catch(() => {}); } }
    if (r === 'ended' || (!p && !file!.busy && r !== 'crossfade')) { playing = null; source = null; fading = false; gapUntil = now + GAP_S * 1000; index++; }
    return;
  }
  if (playing && !prefetched && now >= endsAt - PREFETCH_S * 1000) { prefetched = true; const nextId = order[(index + 1) % order.length]; if (sourceFor(nextId) === 'file') file!.prefetch(nextId); else fetchPiece(nextId, 'prefetch').catch(() => {}); }   // start() reports a failure
  if (playing && !fading && now >= endsAt - FADE_S * 1000) { fading = true; try { conductor?.out?.gain.rampTo(0, FADE_S); } catch { /* gone */ } note({ ev: 'fade', piece: playing, source: 'tone' }); }
  if (playing && now >= endsAt) { stop('end'); gapUntil = now + GAP_S * 1000; index++; }
}

/** Skip to the next piece (tests, and a hook for a future "next" control). */
export function nextPiece() { if (!order.length) return; stop('next'); index++; gapUntil = 0; }
/** Tests: the remembered place of the last stopped piece (null = none). */
export const musicPaused = () => paused;

export function musicState() {
  let fileCtx = 'none'; try { fileCtx = file?.ctx.state ?? 'none'; } catch { /* not made yet */ }
  return { want, loaded: !!file || !!Sim, loading: loading || toneLoading, failed, source, fetched: [...pieceReady.keys()], playing, starting, index, piece: order[index] ?? null, playlist: order.slice(),
    endsInS: playing ? Math.max(0, Math.round((endsAt - performance.now()) / 1000)) : null, toneCtx: Tone?.getContext().state ?? 'none', db: +musicDb(volume).toFixed(1),
    seed, paused, graceLeftS: graceUntil ? Math.max(0, Math.round((graceUntil - performance.now()) / 1000)) : null, lookAhead: (() => { try { return (Tone?.getContext() as unknown as { lookAhead?: number } | undefined)?.lookAhead ?? null; } catch { return null; } })(),
    file: { index: fileIndexSize, off: fileOff, failures: fileFailures, failed: [...fileFailed], ctx: fileCtx, positionS: source === 'file' && file ? +file.position().toFixed(1) : null, performance: source === 'file' && file ? (file.playing()?.perf ?? null) : null, performances: playing && file ? file.performances(playing) : 0, fading } };
}
export const musicLog = () => events.slice();
let meter: AnalyserNode | null = null;
/** The music's output as a MediaStream (review recordings mix it with the soundscape); null until a player has loaded. */
export function musicTap(): MediaStream | null {
  let tone: MediaStream | null = null;
  if (Tone) { try { const raw = Tone.getContext().rawContext as unknown as AudioContext, d = raw.createMediaStreamDestination(); Tone.getDestination().connect(d); tone = d.stream; } catch { tone = null; } }
  if (file) { try { return file.tap(tone ? [tone] : []); } catch { /* fall through */ } }
  return tone;
}
/** RMS of the music actually coming out (proof that it sounds; 0 when stopped). */
export function musicLevel() {
  if (source === 'file' || (!Tone && file)) return file?.level() ?? 0;
  if (!Tone) return 0;
  try {
    if (!meter) { meter = Tone.getContext().rawContext.createAnalyser(); meter.fftSize = 2048; Tone.getDestination().connect(meter); }
    const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return +Math.sqrt(q / d.length).toFixed(5);
  } catch { return 0; }
}
/** Tests: a shorter piece length on this page, to watch the playlist advance. */
export function musicTrackSeconds(s: number) { trackS = Math.max(5, s); if (playing) endsAt = Math.min(endsAt, performance.now() + trackS * 1000); file?.setTrackSeconds(trackS); }
