// PERF-MUSIC (2026-11-01, Gene: "can we move music to a separate thread, and make them all mp3s instead of rendering over
// cpu?"): the playlist's pieces pre-rendered to audio files (tools/score/render-playlist.mjs, one deterministic seed each,
// on the asset CDN; playlist-audio.json is the index) and played with media elements through a GainNode graph, so the
// browser's media pipeline decodes them off the main thread and a frame spike cannot drop a note. Tone.js and the score
// engine stay the fallback (music.ts) when the index lacks a piece or a file fails.
//
// What the Tone path could not do: a real crossfade. The next file starts CROSSFADE_S before the end of the current one,
// fading in while the current fades out over FADE_S, and it has been prefetched PREFETCH_S earlier (a media element with
// preload=auto, so the browser buffers it ahead). Pause and resume keep the position in the file.
//
// Everything that touches the Web Audio or media APIs goes through `FileEnv`, so music-file.test.ts drives the player with
// fake nodes and a fake clock. The player owns one deck (element + gain) per sounding piece and reports what it does through
// `on` (the same event names music.ts logs).
import type { MusicEvent } from './music.ts';

export const CROSSFADE_S = 3, FADE_IN_S = 0.5;

/** One rendered performance of a piece (its seed and file). */
export type Performance = { seed: number; url: string; bytes: number; sha256: string };
/** The rendered-audio index (score/playlist/playlist-audio.json). Version 2 lists several performances per piece; a
 *  version 1 entry (one file, its fields inline) reads as one performance. */
export type FileIndex = { version: number; format: string | null; seconds: number; pieces: Record<string, { seconds: number; performances?: Performance[]; url?: string; seed?: number; bytes?: number; sha256?: string }> };
export function performancesOf(index: FileIndex, id: string): Performance[] {
  const e = index.pieces[id]; if (!e) return [];
  if (e.performances?.length) return e.performances;
  return e.url ? [{ seed: e.seed ?? 0, url: e.url, bytes: e.bytes ?? 0, sha256: e.sha256 ?? '' }] : [];
}
/** The subset of HTMLMediaElement the player uses (a fake in tests). */
export type AudioEl = { src: string; crossOrigin: string | null; preload: string; currentTime: number; duration: number; readyState: number; paused: boolean; play(): Promise<void>; pause(): void; load(): void; removeAttribute(name: string): void; addEventListener(type: string, fn: () => void, opts?: { once?: boolean }): void; removeEventListener(type: string, fn: () => void): void };
export type ParamLike = { value: number; cancelScheduledValues(t: number): unknown; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown };
export type GainLike = { gain: ParamLike; connect(n: unknown): unknown; disconnect(): void };
export type CtxLike = { currentTime: number; state: string; destination: unknown; createGain(): GainLike; createMediaElementSource(el: AudioEl): { connect(n: unknown): unknown; disconnect(): void }; resume(): Promise<void>; createAnalyser?(): AnalyserNode; createMediaStreamDestination?(): MediaStreamAudioDestinationNode; createMediaStreamSource?(s: MediaStream): AudioNode };
export type FileEnv = { ctx(): CtxLike; audio(): AudioEl; now(): number; random?(): number };

type Deck = { id: string; perf: number; el: AudioEl; gain: GainLike; src: { disconnect(): void }; startedAt: number; endsAt: number; positionAt: number; fading: boolean; prefetched: boolean; retireAt: number; failed: string | null; onError: () => void };
export type FileEventHandler = (e: Omit<MusicEvent, 't'>) => void;

const dbToAmp = (db: number) => (db === -Infinity ? 0 : Math.pow(10, db / 20));

/** The browser environment: a playback-latency AudioContext made on first use (after the gesture that unlocked sound). */
export function browserEnv(): FileEnv {
  let ctx: CtxLike | null = null;
  return {
    ctx: () => (ctx ??= new AudioContext({ latencyHint: 'playback' }) as unknown as CtxLike),
    audio: () => { const a = document.createElement('audio'); a.crossOrigin = 'anonymous'; a.preload = 'auto'; return a as unknown as AudioEl; },
    now: () => performance.now(),
  };
}
/** The CDN URL of a piece, or (for proofs on a local build, where the bucket's CORS does not admit localhost) the same key
 *  under the origin `?musicAudio=<origin>` names, serving the rendered files flat by file name. */
export function fileUrl(url: string, search = typeof location === 'undefined' ? '' : location.search) {
  const o = new URLSearchParams(search).get('musicAudio');
  if (!o) return url;
  try { return new URL(url.split('/').pop()!, o.endsWith('/') ? o : o + '/').href; } catch { return url; }
}

export class FilePlayer {
  private master: GainLike | null = null;
  private current: Deck | null = null;
  private pending: Deck | null = null;      // the next piece, buffering ahead
  private outgoing: Deck[] = [];            // fading out, retired after their fade
  private starting: Promise<unknown> | null = null;
  private meter: AnalyserNode | null = null;
  private volume = 0;
  trackS = Infinity;
  fadeS = 4; prefetchS = 20; crossfadeS = CROSSFADE_S;
  constructor(private env: FileEnv, private index: FileIndex, private on: FileEventHandler = () => {}) {}

  has(id: string) { return performancesOf(this.index, id).length > 0; }
  /** How many performances a piece has. */
  performances(id: string) { return performancesOf(this.index, id).length; }
  /** A random performance of a piece (each start of a piece picks afresh; a resume passes the one it paused). */
  private pick(id: string) { const n = this.performances(id); return n > 1 ? Math.min(n - 1, Math.floor((this.env.random ?? Math.random)() * n)) : 0; }
  get ctx() { return this.env.ctx(); }
  private out(): GainLike {
    if (!this.master) { this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination); }
    return this.master;
  }
  private ramp(p: ParamLike, v: number, s: number) {
    const t = this.ctx.currentTime;
    try { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + Math.max(0.01, s)); } catch { p.value = v; }
  }
  /** The music's level (dB at the master; -Infinity is silence), ramped over `rampS`. */
  setVolume(db: number, rampS: number) { this.volume = dbToAmp(db); if (this.master) this.ramp(this.master.gain, this.volume, rampS); }

  private deck(id: string, perf?: number): Deck {
    if (this.pending?.id === id && (perf == null || this.pending.perf === perf)) { const d = this.pending; this.pending = null; return d; }
    if (this.pending) { this.retire(this.pending); this.pending = null; }
    const all = performancesOf(this.index, id), k = perf != null && perf >= 0 && perf < all.length ? perf : this.pick(id);
    const out = this.out(), el = this.env.audio(), gain = this.ctx.createGain(); gain.gain.value = 0; gain.connect(out);
    const src = this.ctx.createMediaElementSource(el); src.connect(gain);
    const d: Deck = { id, perf: k, el, gain, src, startedAt: 0, endsAt: 0, positionAt: 0, fading: false, prefetched: false, retireAt: 0, failed: null, onError: () => { d.failed = 'media error'; } };
    el.addEventListener('error', d.onError);
    el.src = fileUrl(all[k].url); el.load();
    return d;
  }
  private retire(d: Deck) {
    try { d.el.pause(); } catch { /* gone */ }
    try { d.el.removeEventListener('error', d.onError); d.src.disconnect(); d.gain.disconnect(); d.el.removeAttribute('src'); d.el.load(); } catch { /* gone */ }
  }
  /** Start buffering the next piece (a media element with preload=auto), without playing it. */
  prefetch(id: string) {
    if (!this.has(id) || this.pending?.id === id || this.current?.id === id) return false;
    this.pending = this.deck(id); this.pending.prefetched = true;
    this.on({ ev: 'load', piece: id, reason: 'prefetch file' });
    return true;
  }
  /** Play a piece from `positionS` (a resume), fading in over `fadeInS`: performance `perf` (a resume), else a random
   *  one (or the prefetched one). Resolves once it sounds; rejects when the file does not load or play (the caller falls
   *  back to Tone). A piece already playing fades out (a crossfade). */
  play(id: string, { positionS = 0, fadeInS = FADE_IN_S, reason = 'play', perf }: { positionS?: number; fadeInS?: number; reason?: string; perf?: number } = {}): Promise<void> {
    const entry = this.index.pieces[id]; if (!entry || !this.has(id)) return Promise.reject(Error(`no file for ${id}`));
    const d = this.deck(id, perf);
    let settledNow = false;
    const p = new Promise<void>((ok, fail) => {
      let settled = false;
      const done = (e?: unknown) => { if (settled) return; settled = true; settledNow = true; this.starting = null; d.el.removeEventListener('loadedmetadata', meta); d.el.removeEventListener('error', err); if (e) { this.retire(d); fail(e); } else ok(); };
      const err = () => done(Error(`${id}: ${d.failed ?? 'media error'}`));
      const meta = () => {
        if (positionS > 0) { try { d.el.currentTime = Math.min(positionS, Math.max(0, (d.el.duration || entry.seconds) - 1)); } catch { /* not seekable yet */ } }
        const start = () => {
          if (settled) return;
          const now = this.env.now(), left = Math.min(entry.seconds - positionS, this.trackS);
          d.startedAt = now; d.positionAt = positionS; d.endsAt = now + left * 1000;
          this.ramp(d.gain.gain, 1, fadeInS);
          if (this.current && this.current !== d) { this.fadeOut(this.current, this.fadeS); }
          this.current = d;
          const performances = this.performances(id);
          this.on({ ev: 'start', piece: id, reason,
            ...(performances > 1 ? { performance: d.perf, performances } : {}),
            ...(positionS > 0 ? { positionS } : {}),
          });
          done();
        };
        (this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(() => {})).then(() => d.el.play()).then(start, (e) => done(Error(`${id}: play: ${String(e).slice(0, 80)}`)));
      };
      if (d.failed) return err();
      d.el.addEventListener('error', err);
      if (d.el.readyState >= 1) meta(); else d.el.addEventListener('loadedmetadata', meta, { once: true });
    });
    if (!settledNow) this.starting = p.catch(() => {});
    return p;
  }
  private fadeOut(d: Deck, s: number) {
    if (!d.fading) { d.fading = true; this.ramp(d.gain.gain, 0, s); this.on({ ev: 'fade', piece: d.id }); }
    if (this.current === d) this.current = null;
    d.retireAt = this.env.now() + s * 1000 + 100;
    if (!this.outgoing.includes(d)) this.outgoing.push(d);
  }
  /** Fade the playing piece out over `s` (its end, with no successor). */
  fade(s = this.fadeS) { if (this.current) this.fadeOut(this.current, s); }
  /** Stop everything now. Returns where the playing piece was (position in the file), for a later resume. */
  stop(): { id: string; perf: number; positionS: number; remainingMs: number } | null {
    const c = this.current, place = c ? { id: c.id, perf: c.perf, positionS: this.position(), remainingMs: Math.max(0, c.endsAt - this.env.now()) } : null;
    for (const d of [c, this.pending, ...this.outgoing]) if (d) this.retire(d);
    this.current = null; this.pending = null; this.outgoing = [];
    return place;
  }
  /** The position in the playing file (seconds). */
  position() { const c = this.current; if (!c) return 0; const t = c.el.currentTime; return Number.isFinite(t) && t > 0 ? t : c.positionAt + (this.env.now() - c.startedAt) / 1000; }
  /** The playing piece, with when it ends (ms on the env clock). */
  playing() { const c = this.current; return c ? { id: c.id, perf: c.perf, endsAt: c.endsAt, fading: c.fading } : null; }
  /** A shorter piece length from now on (tests), applied to the playing piece too. */
  setTrackSeconds(s: number) { this.trackS = s; if (this.current) this.current.endsAt = Math.min(this.current.endsAt, this.env.now() + s * 1000); }

  /** The scheduler, once per tick: prefetch `nextId` PREFETCH_S before the end, fade FADE_S before it, start `nextId`
   *  CROSSFADE_S before it (while the fade runs), retire faded decks. Returns 'ended' when the playing piece finished without
   *  a successor (the caller starts the next, or falls back), 'crossfade' when the next file is starting. */
  tick(now: number, nextId: string | null): 'ended' | 'crossfade' | null {
    for (const d of this.outgoing.slice()) if (now >= d.retireAt) { this.retire(d); this.outgoing.splice(this.outgoing.indexOf(d), 1); this.on({ ev: 'stop', piece: d.id, reason: 'end' }); }
    const c = this.current; if (!c) return null;
    if (nextId && this.has(nextId) && now >= c.endsAt - this.prefetchS * 1000 && !this.pending && !this.starting) this.prefetch(nextId);
    if (!c.fading && now >= c.endsAt - this.fadeS * 1000) { c.fading = true; this.ramp(c.gain.gain, 0, this.fadeS); this.on({ ev: 'fade', piece: c.id }); }
    if (nextId && this.has(nextId) && !this.starting && now >= c.endsAt - this.crossfadeS * 1000) {
      // the current piece keeps fading on its own ramp; it retires at its end
      c.retireAt = c.endsAt + 100; this.outgoing.push(c); this.current = null;
      this.play(nextId, { fadeInS: this.crossfadeS, reason: 'crossfade' }).catch((e) => { this.on({ ev: 'error', piece: nextId, reason: String(e).slice(0, 200) }); });
      return 'crossfade';
    }
    if (now >= c.endsAt) { this.retire(c); this.current = null; this.on({ ev: 'stop', piece: c.id, reason: 'end' }); return 'ended'; }
    return null;
  }
  /** Is a crossfade start still in flight? */
  get busy() { return !!this.starting; }
  /** RMS of the music coming out of the master (proof that it sounds; 0 when stopped). */
  level() {
    try {
      if (!this.master) return 0;
      const ctx = this.ctx; if (!ctx.createAnalyser) return 0;
      if (!this.meter) { this.meter = ctx.createAnalyser(); this.meter.fftSize = 2048; this.out().connect(this.meter); }
      const d = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return +Math.sqrt(q / d.length).toFixed(5);
    } catch { return 0; }
  }
  /** The master as a MediaStream (review recordings), with `extra` streams (the Tone path's output) mixed in. */
  tap(extra: MediaStream[] = []): MediaStream | null {
    try { const ctx = this.ctx; if (!ctx.createMediaStreamDestination) return null; const d = ctx.createMediaStreamDestination(); this.out().connect(d); for (const s of extra) ctx.createMediaStreamSource?.(s)?.connect(d); return d.stream; } catch { return null; }
  }
}
