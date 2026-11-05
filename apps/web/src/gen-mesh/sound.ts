// VOCAB-W2 + W7: the soundscape. Procedural WebAudio only (no audio files, nothing to license or download).
//
// Sources (planned in sound-plan.ts, pure and tested): every def's `components.sound` (one spec or a list; each
// instance gets a variant of its kind) plus sounds implied by what a thing is (trees rustle, flags flap, bees at flowers,
// ducks, fridges; a fountain also drips and draws pigeons), the ambience around the listener (wind rising on open and
// high ground, birds by day in the world's trees, crickets and pond frogs by night, water near water, gulls over the sea),
// residents (chatter where they gather, footsteps where they walk) and the visitor's own feet.
// Loops are built from filtered noise and oscillators; events (song phrases, steps, syllables) are scheduled each tick.
// Gain falls off with distance to the thing; at most MAX_VOICES loudest sources sound at once.
//
// New worlds only: it starts when the page publishes `window.__simEntity` (LiveWorld does that only for world-engine
// worlds), and the AudioContext is created on the first pointer/key gesture (browsers refuse audio before one).
// The navbar Audio menu independently toggles effects and music, remembered per browser.
// `window.__edenSound.state()` reports emitters and voices; `.log()` lists which sources started where, `.events()` every
// start and stop with its reason (tests, proof).
//
// Lane S3 (2026-10-20, Gene): no wind bed (ambience is incidental: things that are there and what happens); the music is
// a playlist of Sim Score pieces in music.ts, on every world page, with nothing tied to the camera; and a camera move no
// longer restarts sounds: a source that drops out of hearing keeps its voice, silent, for LINGER_MS and picks up where it
// was if it is heard again, a source that follows the listener (the sea) is heard wherever the camera is, and a voice's
// event clock never fires a backlog of notes when it comes back.
import {audioSettings,setAudioSettings,subscribeAudioSettings} from '../audio-settings.ts';
import { kettleHeat, type WorldModel } from '@sim/world-compiler';
import { accompanistOf, crackle, drumHits, PIANO_FADE, pianoEndAt, pianoNotes, pianoReadyAt, recordNotes, sungNotes, type Accompanist } from '../../../../mars/viewer/app/engine-view/piano-score.ts';
import { RADIO_STATIONS, stationEvents, TUNE, type RadioEvent } from './radio-stations.ts';
import { makeSinger, micChain, type Singer } from './voice.ts';
import { ambienceAt, condition, distanceTo, emittersOf, exposureAt, falloff, Movement, notesToSound, QueuedNotes, treeIndex, treesOf, type Emitter, type Resident, type SoundKind, type Source, type TreeIndex } from './sound-plan.ts';
import { nightOf } from './motion.ts';
import { sharedCoverProbe, type CoverProbe } from '../world-env.ts';
import { arrivalOver } from '../arrival-marks.ts';
import { audible, audioFocus } from '../audio-focus.ts';
import { musicGesture, musicLevel, musicTap, musicLog, musicPlaying, musicState, musicTrackSeconds, nextPiece, syncMusic } from './music.ts';
import type * as THREE from 'three';

export { condition, distanceTo, falloff, emittersOf } from './sound-plan.ts';
export type { SoundKind, SoundSpec } from './sound-plan.ts';

type Cam = { position: { x: number; y: number; z: number }; matrixWorld?: { elements: ArrayLike<number> } };
type Host = { layer: { model?: WorldModel | null; group?: THREE.Object3D; groundAt?(x: number, z: number): number | null }; camera: Cam; residents?: () => Resident[]; worldSeconds?: number | null };

const MAX_VOICES = 12, TICK_MS = 100;
/** A voice no longer heard stays alive (silent) this long before it stops, so a camera move does not restart it. */
const LINGER_MS = 8000, MAX_LIVE = MAX_VOICES + 8;
/** Quiet voices that only schedule notes (birds, crickets, bells) hold no running nodes, just a gain: they linger outside
 * MAX_LIVE, longer and under a looser bound, so flying fast across a wood does not evict and restart them. */
const MAX_LIVE_EVENTS = 48, LINGER_EVENTS_MS = 20000;

// ------------------------------------------------------------------ synthesis (procedural, no files)

type Voice = { kind: SoundKind; variant: number; source: Source; out: GainNode; loops: boolean; stop: () => void; tick: (t: number, e: Emitter) => void; gain: number; quietSince: number };
let ctx: AudioContext | null = null, master: GainNode | null = null, noiseBuf: AudioBuffer | null = null;
let settings = audioSettings();

function noise(c: AudioContext) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2; } }
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(); return s;
}
const filt = (c: AudioContext, type: BiquadFilterType, f: number, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const lfo = (c: AudioContext, rate: number, depth: number, target: AudioParam) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g).connect(target); o.start(); return o; };
/** A short enveloped tone (birdsong notes, bells, croaks, music). */
function tone(c: AudioContext, out: AudioNode, at: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator(), g = c.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
  return o;
}
function burst(c: AudioContext, out: AudioNode, at: number, dur: number, peak: number, hp: number, type: BiquadFilterType = 'highpass') {
  const s = c.createBufferSource(); s.buffer = noiseBuf; const f = filt(c, type, hp), g = c.createGain();
  g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out); s.start(at, Math.random()); s.stop(at + dur + 0.02);
}
/** A piano key: a triangle fundamental with a quieter octave, struck and decaying. */
function pianoKey(c: AudioContext, out: AudioNode, at: number, midi: number, peak: number) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  return [tone(c, out, at, f, f, midi < 60 ? 1.8 : 1.3, peak, 'triangle'), tone(c, out, at, f * 2, f * 2, 0.6, peak * 0.22, 'sine')];
}
// Entry 14: Souls playing the piano, heard where they are. Notes come from the shared score at depicted world seconds
// (the hands strike the same onsets); scheduled a short way ahead, each note once. A note sounds only once the arm entry
// blend has put the hands on the keys (#422), and a note scheduled but not yet started is cancelled when its player stops.
const PIANO_RADIUS = 24, PIANO_VOLUME = 0.55, PIANO_AHEAD = 0.35, pianoDone = new Map<string, number>();
const pianoQueued = new QueuedNotes<OscillatorNode>();
let pianoNear = false, audioNow = 0;
function playPianos(host: Host, x: number, y: number, z: number) {
  pianoNear = false;
  const now = host.worldSeconds; if (typeof now !== 'number' || !ctx || !master) return;
  const playing = new Set<string>();
  for (const r of host.residents?.() ?? []) {
    if (r.activity !== 'play-piano' || !r.body) continue;
    playing.add(r.body);
    const g = falloff(Math.hypot(r.p[0] - x, r.p[1] - y, r.p[2] - z), PIANO_RADIUS, PIANO_VOLUME); if (g <= 0.001) continue;
    pianoNear = true;
    // silent while still reaching for the keys and from the run's recorded end; entry 36: keyed by hand too (the bass and the
    // melody often start together: keyed by time alone, the melody note on every half bar was dropped since entry 14)
    const ready = pianoReadyAt(now, r.activityAge, PIANO_FADE), end = pianoEndAt(now, r.activityLeft), body = r.body;
    for (const n of notesToSound(pianoNotes(body, now - 0.05, now + PIANO_AHEAD), ready, end, pianoDone, n => `${body}:${n.t}:${n.hand}`)) {
      const at = audioNow + Math.max(0, n.t - now);
      pianoQueued.add(r.body, at, pianoKey(ctx, master, at, n.midi, g * n.vel * 0.5)); if (n.hand === 1) pianoAt.set(`${r.body}:${n.t}`, at);
    }
  }
  for (const o of pianoQueued.settle(audioNow, playing)) o.disconnect(); // the player stopped before this note began: it never sounds
  for (const [k, t] of pianoDone) if (t < now - 2) pianoDone.delete(k);
  for (const [k] of pianoAt) if (Number(k.slice(k.lastIndexOf(':') + 1)) < now - 4) pianoAt.delete(k);
}
// Entry 20: a jukebox a Soul switched on by hand plays a song from the same score clock as the piano (seeded by the
// jukebox), with a soft beat, heard where it stands. Jukeboxes are picked out of the emitter scan (`objects`, rebuilt on
// an edit or every 2 s), never by a per-tick world scan; their generic music loop never plays.
const JUKEBOX_AHEAD = 0.35, jukeboxDone = new Map<string, number>();
let jukeboxIds = new Set<string>(), jukeboxNear = false;
function jukeboxesOf(model: WorldModel, list: Emitter[]) {
  const ids = new Set<string>();
  for (const e of list) if (e.spec.kind === 'music' && !e.cloud) { const ent = model.entities.get(e.id), def = ent && model.resolvedDef(ent.def); if (def?.tags?.includes('jukebox')) ids.add(e.id); }
  return ids;
}
function playJukeboxes(host: Host, x: number, y: number, z: number) {
  jukeboxNear = false;
  const now = host.worldSeconds, model = host.layer.model; if (typeof now !== 'number' || !ctx || !master || !model || !jukeboxIds.size) return;
  for (const e of objects) {
    // the switch is read live (a map lookup per jukebox): the emitter scan can be up to 2 s old after a state change
    if (!jukeboxIds.has(e.id) || !condition(e.spec.when, { ...e.state, ...model.entities.get(e.id)?.state }, night)) continue;
    const g = falloff(distanceTo(e, x, y, z), e.spec.radius, e.spec.volume); if (g <= 0.001) continue;
    jukeboxNear = true;
    // #431: a record player plays the record on its platter (the sleeve's song); a jukebox its own song
    const st = { ...e.state, ...model.entities.get(e.id)?.state }, ent = model.entities.get(e.id), def = ent && model.resolvedDef(ent.def);
    const sleeves = (def?.state as Record<string, { values?: unknown[] }> | undefined)?.record?.values, record = typeof st.record === 'string' && Array.isArray(sleeves) ? st.record : null;
    const notes = record !== null ? recordNotes(sleeves!.map(String), record, now - 0.05, now + JUKEBOX_AHEAD) : pianoNotes('jukebox:' + e.id, now - 0.05, now + JUKEBOX_AHEAD);
    for (const n of notes) {
      const key = `${e.id}:${n.t}:${n.hand}`; if (jukeboxDone.has(key)) continue; jukeboxDone.set(key, n.t);
      const at = ctx.currentTime + Math.max(0, n.t - now);
      pianoKey(ctx, master, at, n.midi, g * n.vel * 0.45);
      if (n.hand === 0) burst(ctx, master, at, 0.09, g * 0.12, 120, 'lowpass');   // a soft kick under the bass
    }
    // a brushed off-beat every half second
    for (let k = Math.ceil((now - 0.05) / 0.5); k * 0.5 < now + JUKEBOX_AHEAD; k++) {
      const key = `${e.id}:b${k}`; if (jukeboxDone.has(key)) continue; jukeboxDone.set(key, k * 0.5);
      if (k % 2) burst(ctx, master, ctx.currentTime + Math.max(0, k * 0.5 - now), 0.07, g * 0.06, 5000);
    }
    // a record's surface crackle: a few soft clicks a second, the same for every listener (a pure function of world time)
    if (record !== null) for (let k = Math.ceil((now - 0.05) / 0.125); k * 0.125 < now + JUKEBOX_AHEAD; k++) {
      const key = `${e.id}:c${k}`; if (jukeboxDone.has(key)) continue; jukeboxDone.set(key, k * 0.125);
      if (crackle(k)) burst(ctx, master, ctx.currentTime + Math.max(0, k * 0.125 - now), 0.006, g * 0.05, 3200);
    }
  }
  for (const [k, t] of jukeboxDone) if (t < now - 2) jukeboxDone.delete(k);
}
// Entry 26: a Soul at the drums is heard from the drum part on the piano's own clock (piano-score.ts), so a pianist and a
// drummer play in time; the sticks strike the same hits. Scheduled a short way ahead, each hit once, within earshot only.
const DRUM_RADIUS = 26, DRUM_VOLUME = 0.6, drumDone = new Map<string, number>();
let drumsNear = false;
function drumSound(c: AudioContext, out: AudioNode, at: number, kind: string, peak: number) {
  if (kind === 'kick') { tone(c, out, at, 120, 42, 0.32, peak * 0.9, 'sine'); burst(c, out, at, 0.03, peak * 0.12, 1800, 'lowpass'); }
  else if (kind === 'snare') { burst(c, out, at, 0.16, peak * 0.5, 1400); tone(c, out, at, 220, 180, 0.08, peak * 0.25, 'triangle'); }
  else if (kind === 'hat') burst(c, out, at, 0.045, peak * 0.22, 7000);
  else if (kind === 'tom') { tone(c, out, at, 160, 110, 0.35, peak * 0.6, 'sine'); burst(c, out, at, 0.05, peak * 0.1, 900, 'lowpass'); }
  else burst(c, out, at, 1.1, peak * 0.22, 5000);   // crash
}
function playDrums(host: Host, x: number, y: number, z: number) {
  drumsNear = false;
  const now = host.worldSeconds; if (typeof now !== 'number' || !ctx || !master) return;
  for (const r of host.residents?.() ?? []) {
    if (r.activity !== 'play-music' || r.instrument !== 'drums' || !r.body) continue;
    const g = falloff(Math.hypot(r.p[0] - x, r.p[1] - y, r.p[2] - z), DRUM_RADIUS, DRUM_VOLUME); if (g <= 0.001) continue;
    drumsNear = true;
    for (const h of drumHits(r.body, now - 0.05, now + PIANO_AHEAD)) {
      const key = `${r.body}:${h.t}:${h.kind}`; if (drumDone.has(key)) continue; drumDone.set(key, h.t);
      drumSound(ctx, master, audioNow + Math.max(0, h.t - now), h.kind, g * h.vel);
    }
  }
  for (const [k, t] of drumDone) if (t < now - 2) drumDone.delete(k);
}
// Entry 37: radios a Soul works by hand. Each radio plays the station it is tuned to (radio-stations.ts: a pure function of
// station and depicted world seconds, so everyone near it hears the same station at the same moment) through its own small
// speaker (a band-limited channel), falling off with distance. A station change (the tuning knob's contact, depicted on the
// Soul's clock) cross-fades through a burst of static and a sweeping whistle; power on crackles and fades in; power off is
// silent within a tick. Radios are picked out of the emitter scan like jukeboxes; each tick reads only the known radios'
// live `on` and `station` (a map lookup each), never a world scan.
const RADIO_STATIC = 2.2, RADIO_AHEAD = 0.35, RADIO_LINGER_MS = 6000, radioDone = new Map<string, number>();
type RadioRt = { bus: GainNode; voice: AudioNode; hiss: GainNode; hissSrc: AudioBufferSourceNode; ch: Map<string, GainNode>; station: string; on: boolean; tunedAt: number; prev: string | null; quietSince: number; gain: number; tunes: number };
const radios = new Map<string, RadioRt>();
let radioIds = new Set<string>(), radioNear = false;
function radiosOf(model: WorldModel, list: Emitter[]) {
  const ids = new Set<string>();
  for (const e of list) if (e.spec.kind === 'music' && !e.cloud) { const ent = model.entities.get(e.id), def = ent && model.resolvedDef(ent.def); if (def?.tags?.includes('radio') && !def.tags.includes('jukebox') && (def.state as Record<string, unknown> | undefined)?.station) ids.add(e.id); }
  return ids;
}
function radioChannel(c: AudioContext, r: RadioRt, station: string) {
  let g = r.ch.get(station); if (!g) { g = c.createGain(); g.gain.value = 0; g.connect(r.voice); r.ch.set(station, g); }
  return g;
}
function makeRadio(c: AudioContext, station: string, on: boolean): RadioRt {
  const bus = c.createGain(); bus.gain.value = 0; bus.connect(master!);
  // a small cabinet speaker on the AM band: no deep bass, nothing above ~3 kHz (two lowpasses), a little presence. The
  // static bypasses it: a broadband hiss (take 2: through the same band it was no louder above 2 kHz than the piano)
  const hp = filt(c, 'highpass', 190), lp = filt(c, 'lowpass', 2900), lp2 = filt(c, 'lowpass', 3300), mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1300; mid.gain.value = 4; mid.Q.value = 0.8;
  hp.connect(lp).connect(lp2).connect(mid).connect(bus);
  const hiss = c.createGain(); hiss.gain.value = 0; const hissSrc = noise(c), hf = filt(c, 'bandpass', 3400, 0.35); hissSrc.connect(hf).connect(hiss).connect(bus);
  const r: RadioRt = { bus, voice: hp, hiss, hissSrc, ch: new Map(), station, on, tunedAt: -1e9, prev: null, quietSince: 0, gain: 0, tunes: 0 };
  radioChannel(c, r, station).gain.value = 1;
  return r;
}
function dropRadio(id: string, r: RadioRt) { try { r.hissSrc.stop(); } catch { /* stopped */ } r.bus.disconnect(); radios.delete(id); }
/** Static and a heterodyne whistle over a station change (radio-stations.ts TUNE), and the two channels' cross-fade. */
function tuneRadio(c: AudioContext, r: RadioRt, from: string, to: string) {
  const t = c.currentTime, a = radioChannel(c, r, from), b = radioChannel(c, r, to);
  a.gain.cancelScheduledValues(t); a.gain.setValueAtTime(a.gain.value, t); a.gain.linearRampToValueAtTime(0, t + TUNE.fromOut);
  b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(0, t); b.gain.setValueAtTime(0, t + TUNE.toIn); b.gain.linearRampToValueAtTime(1, t + TUNE.toLocked);
  const h = r.hiss.gain; h.cancelScheduledValues(t); h.setValueAtTime(h.value, t); h.linearRampToValueAtTime(RADIO_STATIC, t + TUNE.staticUp); h.setValueAtTime(RADIO_STATIC, t + TUNE.staticHold); h.linearRampToValueAtTime(0, t + TUNE.staticOut);
  for (let i = 0; i < 9; i++) burst(c, r.bus, t + 0.04 + Math.random() * (TUNE.staticOut - 0.15), 0.012 + Math.random() * 0.02, 0.25 + Math.random() * 0.3, 1800);   // crackle
  const o = c.createOscillator(), og = c.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.38); o.frequency.exponentialRampToValueAtTime(1500, t + 0.72);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05, t + 0.08); og.gain.setValueAtTime(0.05, t + 0.55); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
  o.connect(og).connect(r.bus); o.start(t); o.stop(t + 0.82);
}
/** Power on: a short crackle as the valves warm, and the station fades in. */
function warmRadio(c: AudioContext, r: RadioRt) {
  const t = c.currentTime, g = radioChannel(c, r, r.station);
  for (const [s, ch] of r.ch) if (s !== r.station) { ch.gain.cancelScheduledValues(t); ch.gain.setValueAtTime(0, t); }
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.05, t); g.gain.linearRampToValueAtTime(1, t + 0.3);
  const h = r.hiss.gain; h.cancelScheduledValues(t); h.setValueAtTime(0.3, t); h.linearRampToValueAtTime(0, t + 0.3);
}
function radioEvent(c: AudioContext, out: AudioNode, at: number, n: RadioEvent) {
  const f = (m: number) => 440 * 2 ** ((m - 69) / 12);
  if (n.kind === 'key') pianoKey(c, out, at, n.midi, n.vel * 0.5);
  else if (n.kind === 'bass') { tone(c, out, at, f(n.midi), f(n.midi), 0.42, n.vel * 0.5, 'triangle'); tone(c, out, at, f(n.midi) * 2, f(n.midi) * 2, 0.12, n.vel * 0.12, 'sawtooth'); }
  else if (n.kind === 'lead') { tone(c, out, at, f(n.midi), f(n.midi) * 0.997, 0.26, n.vel * 0.16, 'square'); tone(c, out, at, f(n.midi), f(n.midi), 0.3, n.vel * 0.2, 'triangle'); }
  else if (n.kind === 'kick') { tone(c, out, at, 150, 48, 0.16, n.vel * 0.55); }
  else if (n.kind === 'snare') burst(c, out, at, 0.12, n.vel * 0.15, 1500, 'bandpass');   // a brushed snare, soft above 2 kHz
  else if (n.kind === 'hat') burst(c, out, at, 0.04, n.vel * 0.12, 6500);
  else if (n.kind === 'syl') voiced(c, out, at, n.f0, n.dur, n.vel * 0.5, n.vowel);
}
/** A syllable on the air: a voiced buzz through two vowel formants (deterministic: the station's own vowel and pitch). */
function voiced(c: AudioContext, out: AudioNode, at: number, f0: number, dur: number, peak: number, vowel: number) {
  const vowels = [[700, 1200], [400, 2000], [300, 900], [600, 1700], [500, 1000]] as const, [a, b] = vowels[vowel % vowels.length];
  const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.04, at); o.frequency.linearRampToValueAtTime(f0 * 0.96, at + dur);
  const f1 = filt(c, 'bandpass', a, 5), f2 = filt(c, 'bandpass', b, 7), mix = c.createGain(); mix.gain.value = 2.2;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.025); g.gain.setValueAtTime(peak, at + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(f1).connect(mix); g.connect(f2).connect(mix); mix.connect(out); o.start(at); o.stop(at + dur + 0.05);
}
function playRadios(host: Host, x: number, y: number, z: number) {
  radioNear = false;
  const now = host.worldSeconds, model = host.layer.model, wall = performance.now(); if (typeof now !== 'number' || !ctx || !master || !model) return;
  const seen = new Set<string>();
  if (radioIds.size) for (const e of objects) {
    if (!radioIds.has(e.id)) continue;
    // live state (a map lookup per radio): the emitter scan can be up to 2 s old after a hand changed it
    const st = { ...e.state, ...model.entities.get(e.id)?.state }, on = condition(e.spec.when, st, night), station = String(st.station ?? RADIO_STATIONS[0]);
    const g = falloff(distanceTo(e, x, y, z), e.spec.radius, e.spec.volume);
    let r = radios.get(e.id);
    if (!r) { if (!on || g <= 0.001) continue; r = makeRadio(ctx, station, on); radios.set(e.id, r); }
    seen.add(e.id);
    const t = ctx.currentTime;
    if (station !== r.station) { if (on && r.on) { tuneRadio(ctx, r, r.station, station); r.prev = r.station; r.tunedAt = now; r.tunes++; } r.station = station; }
    if (on && !r.on) warmRadio(ctx, r);
    r.on = on; r.gain = on ? g : 0;
    r.bus.gain.setTargetAtTime(r.gain, t, on ? 0.05 : 0.015);
    if (!on || g <= 0.001) { if (!r.quietSince) r.quietSince = wall; else if (wall - r.quietSince > RADIO_LINGER_MS) dropRadio(e.id, r); continue; }
    r.quietSince = 0; radioNear = true;
    const playing = [r.station, ...(r.prev && now - r.tunedAt < TUNE.fromOut + 0.05 ? [r.prev] : [])];
    for (const s of playing) {
      const out = radioChannel(ctx, r, s);
      for (const n of stationEvents(s, now - 0.05, now + RADIO_AHEAD)) {
        const key = `${e.id}:${s}:${n.t}:${n.kind}`; if (radioDone.has(key)) continue; radioDone.set(key, n.t);
        radioEvent(ctx, out, t + Math.max(0, n.t - now), n);
      }
    }
  }
  for (const [id, r] of radios) if (!seen.has(id)) dropRadio(id, r);
  for (const [k, t] of radioDone) if (t < now - 2) radioDone.delete(k);
}
// Entry 36: a Soul singing at a microphone is heard singing the melody of the music she sings along with (the nearest
// pianist's right hand an octave down, or the drummer's piece), a synthesized voice (voice.ts) through the mic and a short
// room. Notes come from the shared score at depicted world seconds, scheduled at the same AudioContext moment as the
// piano's notes of the same second (so the two never drift), each once. Only within earshot of a singer; no accompanist,
// no voice (the world ends her singing too). Nothing runs for a mic nobody sings at.
const VOICE_RADIUS = 26, VOICE_VOLUME = 0.4, singers = new Map<string, { voice: Singer; done: Set<number>; with: string }>();
let voiceNear = false, mic: AudioNode | null = null;
const voiceLog: { singer: string; with: string; t: number; at: number; midi: number; syl: string; pianoAt?: number }[] = [];
/** The ctx time each pianist's melody note of a world second was scheduled at (for the no-drift log). */
const pianoAt = new Map<string, number>();
function playSingers(host: Host, x: number, y: number, z: number) {
  voiceNear = false;
  const now = host.worldSeconds, live = new Set<string>();
  if (typeof now === 'number' && ctx && master) {
    const rs = host.residents?.() ?? [], players = rs.flatMap(r => r.body && (r.activity === 'play-piano' || (r.activity === 'play-music' && r.instrument === 'drums')) ? [{ id: r.body, p: r.p, kind: r.activity === 'play-piano' ? 'piano' as const : 'drums' as const }] : []);
    for (const r of rs) {
      if (r.activity !== 'sing' || !r.body) continue;
      const g = falloff(Math.hypot(r.p[0] - x, r.p[1] - y, r.p[2] - z), VOICE_RADIUS, VOICE_VOLUME); if (g <= 0.001) continue;
      const who: Accompanist | null = accompanistOf(r.p, players); if (!who) continue;
      voiceNear = true; live.add(r.body);
      let s = singers.get(r.body);
      if (s && s.with !== who.seed) { s.voice.silence(ctx.currentTime); s.done.clear(); s.with = who.seed; }
      if (!s) { mic ??= micChain(ctx, master); s = { voice: makeSinger(ctx, mic), done: new Set(), with: who.seed }; singers.set(r.body, s); }
      s.voice.out.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
      // with a piano, the voice keeps to the pianist's audible notes: silent while the hands reach for the keys (#422)
      const pianist = who.kind === 'piano' ? rs.find(q => q.body === who.seed) : undefined;
      const ready = pianist ? pianoReadyAt(now, pianist.activityAge, PIANO_FADE) : -Infinity, end = pianist ? pianoEndAt(now, pianist.activityLeft) : Infinity;
      for (const n of sungNotes(who, now - 0.05, now + PIANO_AHEAD)) {
        if (s.done.has(n.t)) continue; s.done.add(n.t);
        if (n.t < ready - 1e-6 || n.t > end + 1e-6) continue;
        // the moment the piano's note of that second sounds, when it is already scheduled (a singer who starts mid-song
        // joins on the piano's own note: scheduled a tick later from the world clock, it landed 5–10 ms off in take 3)
        const at = pianoAt.get(`${who.seed}:${n.t}`) ?? audioNow + Math.max(0, n.t - now);
        s.voice.schedule(n, at, 1); voiceLog.push({ singer: r.body, with: who.seed, t: n.t, at, midi: n.midi, syl: n.syl, ...(pianoAt.has(`${who.seed}:${n.t}`) ? { pianoAt: pianoAt.get(`${who.seed}:${n.t}`) } : {}) });
        if (voiceLog.length > 400) voiceLog.splice(0, voiceLog.length - 400);
      }
      for (const t of s.done) if (t < now - 4) s.done.delete(t);
    }
  }
  // a singer who stopped (or walked out of earshot, or whose music stopped): the voice ends now
  for (const [id, s] of singers) if (!live.has(id)) { if (ctx) s.voice.stop(ctx.currentTime); singers.delete(id); }
}
function bell(c: AudioContext, out: AudioNode, at: number, f = 1180, peak = 0.35) {
  for (const [m, a, d] of [[1, 1, 1.4], [2.0, 0.5, 0.9], [2.76, 0.35, 0.6], [5.4, 0.15, 0.3]] as const) tone(c, out, at, f * m, f * m * 0.995, d, peak * a);
}
/** A muffled syllable: a voiced buzz through two vowel formants, pitch gliding (distant chatter). */
function syllable(c: AudioContext, out: AudioNode, at: number, f0: number, dur: number, peak: number) {
  const o = c.createOscillator(), g = c.createGain(), vowels = [[700, 1200], [400, 2000], [300, 900], [600, 1700], [500, 1000]] as const, [a, b] = vowels[Math.floor(Math.random() * vowels.length)];
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.35), at + dur);
  const f1 = filt(c, 'bandpass', a, 6), f2 = filt(c, 'bandpass', b, 8), mix = c.createGain(); mix.gain.value = 1;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(f1).connect(mix); g.connect(f2).connect(mix); mix.connect(out); o.start(at); o.stop(at + dur + 0.05);
}

/** One sounding source; `variant` picks one of the kind's voicings (sound-plan VARIANTS). */
function makeVoice(c: AudioContext, kind: SoundKind, variant: number, source: Source): Voice {
  const out = c.createGain(); out.gain.value = 0;
  // residents' chatter is distant: a gentle lowpass on the whole voice
  if (kind === 'chatter') { const lp = filt(c, 'lowpass', 1500); out.connect(lp).connect(master!); } else out.connect(master!);
  const nodes: (AudioScheduledSourceNode)[] = [];
  let next = c.currentTime + Math.random() * 0.5;
  let tick: (t: number, e: Emitter) => void = () => {};
  const every = (fn: (at: number, e: Emitter) => number) => { tick = (t, e) => { if (next < t - 0.25) next = t + Math.random() * 0.2; let guard = 0; while (next < t + 0.3 && guard++ < 32) next += fn(next, e); }; };   // after a silent spell: no backlog of notes
  const bed = (type: BiquadFilterType, f: number, q: number, level: number) => { const n = noise(c), b = filt(c, type, f, q), g = c.createGain(); g.gain.value = level; n.connect(b).connect(g).connect(out); nodes.push(n); return { b, g }; };
  const r = Math.random;
  switch (kind) {
    case 'water':
      if (variant === 1) { const a = bed('lowpass', 500, 0.8, 1.0); nodes.push(lfo(c, 0.18, 0.45, a.g.gain)); }   // still water lapping
      else if (variant === 2) { bed('bandpass', 1600, 0.8, 0.35); every((at) => { tone(c, out, at, 900 + r() * 900, 1400 + r() * 900, 0.05, 0.12); return 0.12 + r() * 0.5; }); }   // dripping basin
      // entry 34: a watering can's rose on soil: a soft hiss of fine jets over a quick, damp patter of drops landing
      else if (variant === 3) { const a = bed('bandpass', 2600, 0.7, 0.5); nodes.push(lfo(c, 0.9, 0.12, a.g.gain)); bed('lowpass', 420, 0.7, 0.35); every((at) => { burst(c, out, at, 0.012 + r() * 0.02, 0.12 + r() * 0.18, 1400 + r() * 1600, 'bandpass'); return 0.018 + r() * 0.05; }); }
      else { const a = bed('bandpass', 1100, 0.6, 0.9); nodes.push(lfo(c, 0.37, 260, a.b.frequency)); const s = bed('highpass', 3800, 0.5, 0.25); nodes.push(lfo(c, 1.7, 0.12, s.g.gain)); }   // fountain
      break;
    case 'stream': { const a = bed('lowpass', variant ? 900 : 650, 0.9, 1.1); nodes.push(lfo(c, 0.23, 180, a.b.frequency)); every((at) => { tone(c, out, at, 380 + r() * 500, 700 + r() * 600, 0.08, 0.05); return 0.15 + r() * (variant ? 0.3 : 0.5); }); break; }
    case 'waves': { const a = bed('lowpass', variant ? 700 : 450, 0.6, 1.0); nodes.push(lfo(c, variant ? 0.16 : 0.09, 0.7, a.g.gain)); nodes.push(lfo(c, variant ? 0.16 : 0.09, 250, a.b.frequency)); break; }
    case 'fire':
      bed('lowpass', variant ? 180 : 320, 0.7, variant ? 1.3 : 0.9);
      every((at) => { burst(c, out, at, 0.02 + r() * 0.05, 0.25 + r() * 0.5, variant ? 1200 : 1800); return 0.04 + r() * (variant ? 0.6 : 0.35); }); break;
    case 'wind':
      if (variant === 1) { const a = bed('bandpass', 900, 3, 0.5); nodes.push(lfo(c, 0.21, 450, a.b.frequency)); nodes.push(lfo(c, 0.05, 0.4, a.g.gain)); }   // high, gusty
      else { const a = bed('bandpass', 420, 1.2, 0.8); nodes.push(lfo(c, 0.11, 200, a.b.frequency)); nodes.push(lfo(c, 0.07, 0.3, a.g.gain)); }
      break;
    case 'creak': { const a = bed('bandpass', 380, 1.4, 0.45); nodes.push(lfo(c, 0.13, 160, a.b.frequency));
      every((at) => { tone(c, out, at, variant ? 140 : 90, variant ? 95 : 70, variant ? 0.35 : 0.5, 0.12, 'sawtooth'); return 2.2 + r() * 1.6; }); break; }
    case 'birds':
      if (variant === 1) every((at) => { const f = 520 + r() * 120; tone(c, out, at, f, f * 0.95, 0.32, 0.2); tone(c, out, at + 0.42, f * 0.8, f * 0.78, 0.45, 0.18); return 3.5 + r() * 4; });   // a dove's two notes
      else if (variant === 2) every((at) => { const n = 4 + Math.floor(r() * 6); for (let i = 0; i < n; i++) tone(c, out, at + i * 0.06, 4200 + r() * 1400, 3800 + r() * 900, 0.035, 0.12); return 0.8 + r() * 2.2; });   // sparrow chirps
      else if (variant === 3) every((at) => { let a = at, f = 3200 + r() * 600; for (let i = 0; i < 5; i++) { tone(c, out, a, f, f * 0.8, 0.16, 0.16); a += 0.2; f *= 0.92; } return 2.5 + r() * 4; });   // a falling whistle
      else every((at) => { let a = at; const f = 2400 + r() * 2200, n = 2 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) { tone(c, out, a, f * (0.9 + r() * 0.3), f * (1.1 + r() * 0.4), 0.07 + r() * 0.06, 0.18); a += 0.09 + r() * 0.07; }
        return a - at + 1.2 + r() * 3.5; });   // warbler trills
      break;
    case 'crickets': every((at) => { const f = variant ? 3600 : 4600; for (let i = 0; i < (variant ? 6 : 3); i++) tone(c, out, at + i * (variant ? 0.03 : 0.05), f, f, 0.025, 0.1); return variant ? 0.35 + r() * 0.2 : 0.6 + r() * 0.4; }); break;
    case 'bell': { const f = [1180, 880, 1480][variant] ?? 1180; every((at) => { bell(c, out, at, f); return variant === 1 ? 1.4 : 0.9; }); break; }
    case 'hum': {
      if (variant === 2) {
        // Soul Actions entry 33: a neon sign's transformer buzz. Twice the mains frequency (120 Hz) rich in harmonics through a
        // resonant band, a pure 120 Hz under it, a faint high fizz and the odd tick at the electrodes.
        const o = c.createOscillator(), bp = filt(c, 'bandpass', 240, 1.1), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 120; g.gain.value = 0.3;
        o.connect(bp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 0.43, 0.05, g.gain));
        const p = c.createOscillator(), pg = c.createGain(); p.frequency.value = 120; pg.gain.value = 0.32; p.connect(pg).connect(out); p.start(); nodes.push(p);
        bed('bandpass', 3600, 1.4, 0.035);
        every((at) => { burst(c, out, at, 0.008 + r() * 0.015, 0.04 + r() * 0.06, 4800); return 0.4 + r() * 2.2; });
        break;
      }
      const base = variant ? 60 : 50;
      for (const [m, a] of [[1, 0.5], [2, 0.3], [3, 0.12]] as const) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = base * m; g.gain.value = a; o.connect(g).connect(out); o.start(); nodes.push(o); }
      bed('bandpass', 2500, 2, 0.04); break; }
    case 'engine': { const o = c.createOscillator(), lp = filt(c, 'lowpass', 220, 2), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = [42, 30, 58][variant] ?? 42; g.gain.value = 0.7; o.connect(lp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 6, 4, o.frequency)); break; }
    case 'frogs':
      if (variant === 1) every((at) => { tone(c, out, at, 2600 + r() * 400, 3100 + r() * 300, 0.08, 0.12); return 0.4 + r() * 0.9; });   // spring peepers
      else every((at) => { const f = 160 + r() * 120; for (let i = 0; i < 3; i++) tone(c, out, at + i * 0.07, f, f * 0.8, 0.06, 0.2, 'square'); return 0.6 + r() * 1.8; });
      break;
    case 'music': {
      // four pieces, all generative: pentatonic triangle tune, slow pad chords, minor plucked arpeggio, music box
      const roots = [330, 220, 262, 523], root = roots[variant] ?? 330; let i = 0;
      if (variant === 1) every((at) => { for (const s of [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]][i++ % 4]) tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12), 2.6, 0.08, 'sine'); return 2.4; });
      else if (variant === 2) every((at) => { const s = [0, 3, 7, 10, 12, 10, 7, 3][i++ % 8]; tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12) * 0.998, 0.35, 0.16, 'triangle'); return 0.22; });
      else if (variant === 3) every((at) => { const s = [0, 7, 12, 16, 14, 12, 7, 9][i++ % 8]; bell(c, out, at, root * 2 ** (s / 12), 0.07); return 0.36; });
      else every((at) => { const s = [0, 2, 4, 7, 9, 12, 14][(i * 3 + (i >> 2)) % 7]; tone(c, out, at, root * 2 ** (s / 12), root * 2 ** (s / 12), 0.42, 0.22, 'triangle'); if (i % 4 === 0) tone(c, out, at, root / 2, root / 2, 0.8, 0.18); i++; return 0.28; });
      break; }
    case 'chime': { const base = [1600, 1200, 2100][variant] ?? 1600; every((at) => { bell(c, out, at, base + Math.floor(r() * 4) * 240, 0.2); return 1.5 + r() * 3; }); break; }
    case 'chatter': {
      bed('bandpass', 600, 0.8, 0.05);   // room tone under the voices
      every((at, e) => { const people = Math.max(1, Math.min(6, Number(e.state.size) || 2)), who = Math.floor(r() * people), f0 = [120, 210, 165, 240, 105, 190][who] * (variant === 2 ? 1.1 : 1);
        let a = at; const n = 2 + Math.floor(r() * 5); for (let k = 0; k < n; k++) { const d = 0.09 + r() * 0.14; syllable(c, out, a, f0 * (0.95 + r() * 0.15), d, 0.22); a += d + 0.02; }
        return a - at + 0.15 + r() * (variant === 1 ? 0.3 : 0.7); });
      break; }
    case 'leaves':
      // lane S3: no continuous whoosh, only now-and-then rustles (Gene: the wind-like beds were annoying)
      if (variant === 1) every((at) => { burst(c, out, at, 0.4 + r() * 0.5, 0.1 + r() * 0.08, 1300, 'bandpass'); return 2.5 + r() * 5; });   // pine whisper (and reeds)
      else every((at) => { burst(c, out, at, 0.12 + r() * 0.25, 0.12 + r() * 0.16, 3200 + r() * 1800); return 0.6 + r() * 2.4; });   // broadleaf rustle
      break;
    case 'flag': {
      // cloth flapping now and then; variant 1 adds the halyard tapping the pole
      // lane S3: the flaps only, no continuous flutter bed
      every((at) => { burst(c, out, at, 0.05, 0.35, 1400, 'bandpass'); if (variant === 1 && r() < 0.35) tone(c, out, at + 0.1, 2300 + r() * 200, 2250, 0.12, 0.08, 'triangle'); return 0.8 + r() * 2.4; });
      break; }
    case 'waterfowl':
      if (variant === 1) every((at) => { const n = 2 + Math.floor(r() * 3); for (let i = 0; i < n; i++) { const b = filt(c, 'bandpass', 950, 2.5), o = c.createOscillator(), g = c.createGain(), t0 = at + i * 0.22; o.type = 'square'; o.frequency.setValueAtTime(330, t0); o.frequency.exponentialRampToValueAtTime(240, t0 + 0.13); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14); o.connect(b).connect(g).connect(out); o.start(t0); o.stop(t0 + 0.2); } return 3 + r() * 6; });   // ducks quacking
      else every((at) => { tone(c, out, at, 1900, 1150, 0.42, 0.12, 'sawtooth'); for (let i = 0; i < 2 + Math.floor(r() * 3); i++) tone(c, out, at + 0.55 + i * 0.16, 1500, 1250, 0.09, 0.09, 'sawtooth'); return 4 + r() * 7; });   // a gull's cry
      break;
    case 'bees': {
      // a few bees around flowers: detuned buzzes that come and go
      const base = variant ? 240 : 205;
      for (const d of [0, 7, -11]) { const o = c.createOscillator(), g = c.createGain(), bp = filt(c, 'bandpass', 450, 1.5); o.type = 'sawtooth'; o.frequency.value = base + d; g.gain.value = 0; o.connect(bp).connect(g).connect(out); o.start(); nodes.push(o, lfo(c, 3 + r() * 4, 6, o.frequency), lfo(c, 0.15 + r() * 0.3, 0.16, g.gain)); }
      break; }
    case 'kettle': {
      // Entry 43: an electric kettle. A low rumble and a rising hiss as the element heats (both follow the water's
      // temperature, `kettleTemp`, derived from the switch tick and the depicted tick), then a rolling boil: the rumble
      // swells and bubbles burst at the surface. The click on and off is the one-shot below.
      // two voicings (every kind has more than one): variant 1 is a slightly smaller kettle, its rumble and hiss a little higher
      const hi = variant === 1 ? 1.12 : 1;
      const rumble = bed('lowpass', 260 * hi, 0.9, 0), hiss = bed('bandpass', 2300 * hi, 0.9, 0), roll = bed('bandpass', 700 * hi, 0.7, 0);
      let bubble = c.currentTime;
      tick = (t, e) => { const temp = Math.max(0, Math.min(1, Number(e.state.kettleTemp) || 0)), boil = e.state.kettlePhase === 'boiling';
        rumble.g.gain.setTargetAtTime(0.15 + 0.55 * temp + (boil ? 0.4 : 0), t, 0.4); hiss.g.gain.setTargetAtTime(0.04 + 0.32 * temp ** 2 + (boil ? 0.12 : 0), t, 0.5);
        hiss.b.frequency.setTargetAtTime((1600 + 1700 * temp) * hi, t, 0.8); roll.g.gain.setTargetAtTime(boil ? 0.45 : temp > 0.75 ? (temp - 0.75) * 1.2 : 0, t, 0.3);
        if (bubble < t - 0.25) bubble = t;
        let guard = 0; while ((boil || temp > 0.7) && bubble < t + 0.3 && guard++ < 24) { burst(c, out, bubble, 0.012 + r() * 0.02, (boil ? 0.35 : 0.12) * (0.5 + r()), 500 + r() * 900, 'bandpass'); bubble += boil ? 0.025 + r() * 0.06 : 0.12 + r() * 0.3; } };
      break; }
    case 'footsteps': every((at, e) => { const sp = Math.max(0.5, Math.min(5, Number(e.state.speed) || 1.3));
      // soft earth thud, or gravel crunch; cadence follows the walker's speed
      if (variant === 1) { burst(c, out, at, 0.07, 0.5, 2400); burst(c, out, at + 0.015, 0.05, 0.3, 4200); } else { burst(c, out, at, 0.09, 0.9, 260, 'lowpass'); tone(c, out, at, 90, 60, 0.07, 0.25); }
      return Math.max(0.28, 0.75 / Math.sqrt(sp)); }); break;
  }
  return { kind, variant, source, out, loops: nodes.length > 0, gain: 0, quietSince: 0, tick: (t, e) => tick(t, e), stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } } setTimeout(() => out.disconnect(), 200); } };
}
/** A one-shot for `mode: 'change'` (a door creak, a bell ringing, a splash). */
function oneShot(c: AudioContext, kind: SoundKind, gain: number) {
  const out = c.createGain(); out.gain.value = gain; out.connect(master!); const t = c.currentTime + 0.02;
  if (kind === 'bell' || kind === 'chime') { bell(c, out, t, kind === 'bell' ? 1180 : 1600, 0.4); bell(c, out, t + 0.45, kind === 'bell' ? 1180 : 1900, 0.3); }
  else if (kind === 'creak') tone(c, out, t, 120, 70, 0.7, 0.3, 'sawtooth');
  else if (kind === 'water' || kind === 'stream' || kind === 'waves') for (let i = 0; i < 6; i++) tone(c, out, t + i * 0.05, 500 + Math.random() * 600, 900 + Math.random() * 700, 0.07, 0.15);
  else if (kind === 'fire') for (let i = 0; i < 8; i++) burst(c, out, t + i * 0.05, 0.04, 0.4, 1500);
  else if (kind === 'footsteps') burst(c, out, t, 0.09, 0.9, 260, 'lowpass');
  else if (kind === 'kettle') { burst(c, out, t, 0.008, 0.9, 3200); burst(c, out, t + 0.012, 0.02, 0.4, 900, 'bandpass'); }   // the switch: a plastic click
  else tone(c, out, t, 660, 880, 0.3, 0.3);
  setTimeout(() => out.disconnect(), 3000);
}

/** Soul Actions entry 32: hand contact on a door, scheduled on the depicted tick by the entity layer: knuckles on wood (a
 *  knock), a lock's bolt seating (a click), a latch snapping shut. Heard with distance from the listener. */
type ContactKind = 'knock' | 'click' | 'latch';
type ContactRow = { t: number; kind: ContactKind; at: [number, number, number]; d: number; gain: number; ctxTime: number | null };
const contacts: ContactRow[] = [];
let listener: [number, number, number] | null = null;
function contactSound(kind: ContactKind, at: [number, number, number]) {
  const d = listener ? Math.hypot(at[0] - listener[0], at[1] - listener[1], at[2] - listener[2]) : 0;
  const gain = falloff(d, kind === 'knock' ? 24 : 14, kind === 'knock' ? 0.95 : 0.7);
  const row: ContactRow = { t: Math.round(performance.now()), kind, at, d: +d.toFixed(2), gain: +gain.toFixed(3), ctxTime: null };
  contacts.push(row); if (contacts.length > 200) contacts.splice(0, contacts.length - 200);
  if (!ctx || !master || gain < 0.001 || !audible()) return;
  const c = ctx, out = c.createGain(); out.gain.value = gain; out.connect(master); const t = c.currentTime + 0.01; row.ctxTime = +t.toFixed(3);
  if (kind === 'knock') {
    // knuckles on a solid leaf: a dull wooden thump (low body, quick decay) with a little attack noise
    tone(c, out, t, 190, 120, 0.13, 0.55, 'triangle'); tone(c, out, t, 92, 70, 0.16, 0.45, 'sine'); burst(c, out, t, 0.035, 0.5, 900, 'lowpass');
  } else if (kind === 'click') {
    // a bolt thrown: two small metal clicks (the cam, then the bolt seating) and a faint ring
    burst(c, out, t, 0.018, 0.55, 2600); burst(c, out, t + 0.07, 0.025, 0.7, 1800); tone(c, out, t + 0.07, 2400, 2300, 0.08, 0.08, 'square');
  } else { burst(c, out, t, 0.03, 0.75, 1200); tone(c, out, t, 160, 110, 0.1, 0.3, 'triangle'); burst(c, out, t + 0.05, 0.02, 0.5, 2400); }
  setTimeout(() => out.disconnect(), 1500);
}

// ------------------------------------------------------------------ the layer

type Heard = { id: string; kind: SoundKind; variant: number; source: Source; gain: number; d: number; e: Emitter };
type LogRow = { t: number; id: string; kind: SoundKind; variant: number; source: Source; gain: number; d: number; at: [number, number, number] };
type EventRow = { t: number; id: string; kind: SoundKind; ev: 'start' | 'stop'; reason: string };
const voices = new Map<string, Voice>();
const movement = new Movement();
let objects: Emitter[] = [], ambient: Emitter[] = [], people: Emitter[] = [], lastScan = 0, lastSeq = -1, lastAmb = 0, lastHeard: Heard[] = [];
let probe: CoverProbe | null = null, probeLayer: unknown = null, covered = false;
// what the world is like around the listener: its trees (birds), its typical ground and its obstacles (wind)
let trees: TreeIndex = { count: 0, cells: new Map() }, obstacles: [number, number, number][] = [], typicalGround = 0, exposure = 0, night = 0;
function scanWorld(model: WorldModel) {
  trees = treeIndex(treesOf(model));
  obstacles = []; const ys: number[] = [];
  for (const e of model.entities.values()) {
    if (e.in.parent !== 'world') continue;
    const def = model.resolvedDef(e.def); if (!def || def.form !== 'point') continue;
    const p = model.worldPose(e), b = def.size?.box ?? [1, 1, 1], tall = (b[1] ?? 1) * p.s, wide = Math.max(b[0] ?? 1, b[2] ?? 1) * p.s;
    if (tall > 1.8) obstacles.push([p.x, Math.min(3, (tall * wide) / 12), p.z]);   // weight: how much wind it blocks
    try { ys.push(model.terrain.sample(p.x, p.z)); } catch { /* no terrain */ }
  }
  ys.sort((a, b) => a - b); typicalGround = ys.length ? ys[Math.floor(ys.length / 2)] : 0;
}
const lastValue = new Map<string, unknown>();
let meter: AnalyserNode | null = null, bedsMeter: AnalyserNode | null = null;
/** Main-thread time spent in the sound tick and in its ambient-bed part (ms, since load), for frame-cost checks. */
const cost = { ticks: 0, tickMs: 0, bedsMs: 0 };
// lane AMBIENT: recorded beds under the procedural voices (lazy chunk after the first unlock; see ambient-beds.ts)
let bedsMod: typeof import('./ambient-beds.ts') | null = null, beds: import('./ambient-beds.ts').Beds | null = null, bedsLoading = false, bedsOn = true;
const log: LogRow[] = [];
const events: EventRow[] = [];
const started = new Set<string>();
function event(id: string, kind: SoundKind, ev: EventRow['ev'], reason: string) { events.push({ t: Math.round(performance.now()), id, kind, ev, reason }); if (events.length > 600) events.splice(0, events.length - 600); }
function stopVoice(id: string, v: Voice, reason: string) { v.stop(); voices.delete(id); event(id, v.kind, 'stop', reason); }

// lane PUX: only the tab that holds the audio focus sounds (audio-focus.ts); the others mute and suspend their context
function applyMaster() {
  const on = audible();
  if (master) master.gain.value = settings.muted || !on ? 0 : settings.volume;
  if (ctx) { if (!on && ctx.state === 'running') void ctx.suspend().catch(() => {}); else if (on && ctx.state === 'suspended') void ctx.resume().catch(() => {}); }
}
const musicOn = () => settings.music;
// PERF-EDEN (2026-11-01): the playlist ducks to 20 % near a piano, jukebox, drums, radio or singer. The near flags flip the
// moment an emitter comes into range, so walking past one toggled the music up and down; now the duck holds for 2.5 s
// after the last near tick (hysteresis) and the music ramps the change over ~1 s (music.ts), so it breathes instead of
// stepping.
const DUCK_HOLD_MS = 2500; let duckHeldUntil = 0;
const musicDuck = () => { const now = performance.now(); if (pianoNear || jukeboxNear || drumsNear || radioNear || voiceNear) duckHeldUntil = now + DUCK_HOLD_MS; return now < duckHeldUntil ? 0.2 : 1; };
const musicSync = () => syncMusic({ on: musicOn(), station: settings.station, audible: audible(), volume: settings.volume * musicDuck(), unlocked: !!ctx && ctx.state === 'running' });
function unlock() {
  if (ctx || typeof AudioContext === 'undefined') return;
  try { ctx = new AudioContext(); master = ctx.createGain(); applyMaster(); master.connect(ctx.destination); meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter); noise(ctx).stop(); } catch { ctx = null; }
}
function step(host: Host) {
  const model = host.layer.model; if (!model) return;
  const now = performance.now(), seq = (model as unknown as { editSeq?: number }).editSeq ?? -2;
  if (now - lastScan > 2000 || seq !== lastSeq) { objects = emittersOf(model); jukeboxIds = jukeboxesOf(model, objects); radioIds = radiosOf(model, objects); if (seq !== lastSeq || now - lastScan > 10000 || !trees.count) scanWorld(model); lastScan = now; lastSeq = seq; }
  const { x, y, z } = host.camera.position;
  listener = [x, y, z];
  const ground = host.layer.groundAt?.(x, z) ?? null;
  if (now - lastAmb > 500) {
    lastAmb = now;
    if (host.layer.group && probeLayer !== host.layer) { probe = sharedCoverProbe(host.layer.group); probeLayer = host.layer; }
    covered = !!probe && probe.test(x, y, z);
    let waters: { area?: [number, number][]; path?: [number, number][]; w?: number; level: number }[] = [], seaLevel: number | undefined;
    try { const g = model.ground() as { waters?: typeof waters; seaLevel?: number }; waters = g.waters ?? []; seaLevel = g.seaLevel; } catch { /* no ground yet */ }
    night = nightOf(model);
    exposure = ground === null ? 0 : exposureAt(x, z, ground, typicalGround, obstacles);
    ambient = ambienceAt({ x, y, z, ground, night, covered, waters, seaLevel, trees, exposure });
  }
  people = movement.emitters(host.residents?.() ?? [], { x, y, z, ground }, now / 1000);
  // entry 36: one audio clock reading per tick for every instrument and the voice (ctx.currentTime moves in 128-sample
  // steps while the tick runs: read per instrument, the voice landed up to one step (2.9 ms) off the piano's note)
  audioNow = ctx?.currentTime ?? 0;
  if (!settings.muted) { playPianos(host, x, y, z); playJukeboxes(host, x, y, z); playDrums(host, x, y, z); playRadios(host, x, y, z); playSingers(host, x, y, z); } else { pianoNear = jukeboxNear = drumsNear = radioNear = voiceNear = false; for (const [id, r] of radios) dropRadio(id, r); if (singers.size && ctx) for (const [id, s] of singers) { s.voice.stop(ctx.currentTime); singers.delete(id); } }
  const heard: Heard[] = [], playlist = musicPlaying();
  for (const e of [...objects, ...ambient, ...people]) {
    if (e.spec.kind === 'music' && (jukeboxIds.has(e.id) || radioIds.has(e.id))) continue;   // a jukebox plays its song (playJukeboxes), a radio its station (playRadios)
    if (playlist && e.spec.kind === 'music') continue;   // a world's own music things stay quiet under the playlist
    const d = e.follow ? 0 : distanceTo(e, x, y, z);
    // Soul Actions: a switched sound (a fountain, a tap) follows the hand, not the 2 s emitter scan. Within earshot, its
    // state is read live (one map lookup; the entity's specs share this state object).
    if (e.source === 'object' && e.spec.when && d < e.spec.radius) { const live = model.entities.get(e.id.split('#')[0])?.state; if (live) Object.assign(e.state, live); }
    // Entry 43: a kettle's sound follows its heat, a pure function of the switch tick and the depicted tick
    if (e.spec.kind === 'kettle' && d < e.spec.radius) { const k = kettleHeat(e.state, (window as unknown as { __simEntity?: { depictedTick?: number } }).__simEntity?.depictedTick ?? NaN); e.state.heating = k.on; e.state.kettleTemp = k.temp; e.state.kettlePhase = k.phase; e.state.kettleSwitch = k.on ? 1 : typeof e.state.heatTick === 'number' && e.state.heatTick >= 0 && k.phase !== 'cold' ? 2 : 0; }
    if (e.spec.mode === 'change') {
      // Native diffs advance the layer's depicted state without model.editSeq.
      // Read only already cached change emitters; do not rescan the world.
      if(e.source==='object'){const live=model.entities.get(e.id.replace(/#\d+$/, ''));if(!live)continue;e.state={...e.state,...live.state};}
      const k = (e.spec.when ?? '').replace(/^!/, ''), v = e.state[k], prev = lastValue.get(e.id);
      lastValue.set(e.id, v);
      if (prev !== undefined && prev !== v && condition(e.spec.when, e.state, night) && ctx) { const g = falloff(d, e.spec.radius, e.spec.volume); if (g > 0.001) oneShot(ctx, e.spec.kind, g); }
      continue;
    }
    if (!condition(e.spec.when, e.state, night)) continue;
    // indoors, the outside world is muffled; things in the room are not
    const g = falloff(d, e.spec.radius, e.spec.volume) * (covered && e.source === 'object' && d > 8 ? 0.4 : 1);
    if (g > 0.001) heard.push({ id: e.id, kind: e.spec.kind, variant: e.spec.variant ?? 0, source: e.source, gain: g, d, e });
  }
  const m = host.camera.matrixWorld?.elements;
  const tb0 = performance.now();
  const bedTargets = bedsMod && ctx ? bedsMod.bedMix(heard, { x, z, right: m ? [m[0], m[2]] : undefined }, { exposure, covered, music: playlist }) : null;
  let bedsMs = performance.now() - tb0;
  heard.sort((a, b) => b.gain - a.gain); heard.length = Math.min(heard.length, MAX_VOICES);
  lastHeard = heard;
  if (!ctx) return;
  if (!audible()) { applyMaster(); return; }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  if (!bedsLoading) { bedsLoading = true; void import('./ambient-beds.ts').then((mod) => { bedsMod = mod; if (ctx && master) beds = mod.createBeds(ctx, master); }, () => {}); }
  const tb1 = performance.now();
  if (beds && bedTargets) beds.update(bedsOn ? bedTargets : bedsMod!.bedMix([], { x, z }, { exposure: 0, covered: true, music: false }), now);
  bedsMs += performance.now() - tb1; cost.bedsMs += bedsMs;
  const live = new Set(heard.map((h) => h.id)), t = ctx.currentTime;
  for (const h of heard) {
    let v = voices.get(h.id);
    if (v && (v.kind !== h.kind || v.variant !== h.variant)) { stopVoice(h.id, v, 'changed'); v = undefined; }
    if (!v) {
      v = makeVoice(ctx, h.kind, h.variant, h.source); voices.set(h.id, v);
      event(h.id, h.kind, 'start', started.has(h.id) ? 'again' : 'new'); started.add(h.id);
      const p = h.e.pts[0];
      log.push({ t: Math.round(now), id: h.id, kind: h.kind, variant: h.variant, source: h.source, gain: +h.gain.toFixed(3), d: +h.d.toFixed(1), at: [+p[0].toFixed(1), +p[1].toFixed(1), +p[2].toFixed(1)] }); if (log.length > 400) log.splice(0, log.length - 400);
    }
    v.gain = h.gain; v.quietSince = 0; v.out.gain.setTargetAtTime(h.gain, t, 0.25); v.tick(t, h.e);
  }
  // out of hearing: fade, keep the voice LINGER_MS (a camera move brings it straight back, not from the start), then stop
  for (const [id, v] of voices) if (!live.has(id)) {
    if (!v.quietSince) { v.quietSince = now; v.gain = 0; v.out.gain.setTargetAtTime(0, t, 0.3); }
    else if (now - v.quietSince > (v.loops ? LINGER_MS : LINGER_EVENTS_MS)) stopVoice(id, v, 'out of hearing');
  }
  // too many lingering: stop the longest-quiet first (looping voices cost CPU while silent, note-only voices almost nothing)
  for (const [loops, cap] of [[true, MAX_LIVE], [false, MAX_LIVE_EVENTS]] as const) {
    const kept = [...voices].filter(([, v]) => v.loops === loops);
    if (kept.length <= cap) continue;
    let n = kept.length;
    for (const [id, v] of kept.filter(([, v]) => v.quietSince).sort((a, b) => a[1].quietSince - b[1].quietSince)) { if (n <= cap) break; stopVoice(id, v, 'too many'); n--; }
  }
}

// Listener preferences are shared with the React navbar; no separate floating controls.
const setSettings = setAudioSettings;

/** Starts once per page; idles until a world-engine world publishes its host object. */
export function startSoundLayer() {
  if (typeof window === 'undefined' || (window as unknown as { __edenSound?: unknown }).__edenSound) return;
  settings = audioSettings();
  subscribeAudioSettings(()=>{settings=audioSettings();applyMaster();lastAmb=0;musicSync();});
  const w = window as unknown as { __simEntity?: Host; __edenSound?: unknown };
  w.__edenSound = {
    state: () => ({ ctx: ctx?.state ?? 'none', muted: settings.muted, music: settings.music, volume: settings.volume, covered, piano: { near: pianoNear, scheduled: pianoDone.size }, jukebox: { near: jukeboxNear, ids: jukeboxIds.size, scheduled: jukeboxDone.size }, drums: { near: drumsNear, scheduled: drumDone.size },
      radio: { near: radioNear, ids: radioIds.size, scheduled: radioDone.size, radios: [...radios].map(([id, r]) => ({ id, on: r.on, station: r.station, gain: +r.gain.toFixed(3), tunes: r.tunes, tuning: typeof w.__simEntity?.worldSeconds === 'number' && w.__simEntity.worldSeconds - r.tunedAt < TUNE.toLocked, hiss: +r.hiss.gain.value.toFixed(3) })) }, voice: { near: voiceNear, singers: [...singers].map(([id, s]) => ({ id, with: s.with })), scheduled: voiceLog.length },
      world: { trees: trees.count, exposure: +exposure.toFixed(2), night: +night.toFixed(2), typicalGround: +typicalGround.toFixed(1) },
      emitters: [...objects, ...ambient, ...people].map((e) => ({ id: e.id, kind: e.spec.kind, variant: e.spec.variant ?? 0, source: e.source, when: e.spec.when ?? null, on: condition(e.spec.when, e.state, night) })),
      heard: lastHeard.map(({ e: _e, ...h }) => ({ ...h, gain: +h.gain.toFixed(3), d: +h.d.toFixed(1) })),
      beds: beds?.state() ?? null,
      voices: [...voices.entries()].map(([id, v]) => ({ id, kind: v.kind, variant: v.variant, source: v.source, gain: +v.gain.toFixed(3) })) }),
    log: () => log.slice(),
    events: () => events.slice(),
    /** Entry 32: door contact sounds (knocks, lock clicks, latches) as played: listener distance, gain, AudioContext time. */
    contacts: () => contacts.slice(),
    contact: (kind: ContactKind, at: [number, number, number]) => contactSound(kind, at),
    /** Entry 36: every sung note scheduled (world second, ctx time, pitch, and the ctx time of the piano's note then). */
    voiceLog: () => voiceLog.slice(),
    /** Entry 36: the voice alone, rendered offline with the live code: `seconds` of the sung part from world second t0
     *  along with `seed` (a pianist's body id). Returns the samples (mono) for listening and pitch tracking. */
    renderVoice: async (seed: string, t0: number, seconds: number, kind: 'piano' | 'drums' = 'piano', room = true) => {
      const rate = 44100, off = new OfflineAudioContext(1, Math.ceil(rate * (seconds + 1.5)), rate), dest = room ? micChain(off, off.destination) : off.destination;
      const v = makeSinger(off, dest); v.out.gain.value = 1;
      const notes = sungNotes({ seed, kind }, t0, t0 + seconds);
      for (const n of notes) v.schedule(n, 0.25 + n.t - t0, 1);
      const buf = await off.startRendering();
      return { rate, start: 0.25, notes, samples: Array.from(buf.getChannelData(0)) };
    },
    /** RMS of what is actually coming out (after the master gain), for proof that sound plays and that mute silences it. */
    level: () => { if (!ctx || !master) return 0; if (!meter) { meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter); } const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return +Math.sqrt(q / d.length).toFixed(5); },
    /** RMS of the recorded ambient beds alone (their bus, after bed gains, before the master gain). */
    bedsLevel: () => { if (!ctx || !beds) return 0; if (!bedsMeter) { bedsMeter = ctx.createAnalyser(); bedsMeter.fftSize = 2048; beds.bus.connect(bedsMeter); } const d = new Float32Array(bedsMeter.fftSize); bedsMeter.getFloatTimeDomainData(d); let q = 0; for (const v of d) q += v * v; return Math.sqrt(q / d.length); },
    /** Cumulative main-thread ms of the sound tick and its bed part (diff two reads over a counted span of frames). */
    cost: () => ({ ...cost }),
    mute: (m: boolean) => setSettings({ muted: m }),
    music: (m: boolean) => setSettings({ music: m }),
    unlock,
    /** Recorded ambient beds on/off (A/B listening and level checks); the speaker's mute is the user control. */
    beds: (on: boolean) => { bedsOn = on; },
    /** The soundscape's output plus the music as one MediaStream (recordings for review); null before the first unlock. */
    tap: () => { if (!ctx || !master) return null; const d = ctx.createMediaStreamDestination(); master.connect(d); const m = musicTap(); if (m) ctx.createMediaStreamSource(m).connect(d); return d.stream; },
  };
  (window as unknown as { __edenMusic?: unknown }).__edenMusic = { state: musicState, log: musicLog, level: musicLevel, next: nextPiece, trackSeconds: musicTrackSeconds };
  // another tab took the sound, or this one came back: act now, not on the next (throttled, when hidden) tick
  audioFocus()?.subscribe(() => { applyMaster(); musicSync(); });
  const gesture = () => { unlock(); musicGesture(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click'] as const) window.addEventListener(ev, gesture, { capture: true, passive: true });
  // lane W1: the first scan of the world's sound sources (~0.2 s at 2x CPU on Eden 2026) waits until the arrival is over.
  // Lane S3: the speaker and the music on every world page (old worlds too); the soundscape where a world has entities.
  setInterval(() => {
    if (!arrivalOver() || !document.querySelector('.world-scene canvas')) return;

    // entry 37: the step first, so the playlist ducks in the same tick a radio (or piano, jukebox) becomes audible
    const host = w.__simEntity; if (host?.camera && host.layer) { const t0 = performance.now(); try { step(host); } catch { /* a world mid-reload */ } cost.ticks++; cost.tickMs += performance.now() - t0; }
    musicSync();
  }, TICK_MS);
}
startSoundLayer();
