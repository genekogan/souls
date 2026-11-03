// Sim.register / Sim.Conductor: pieces compose one cycle (a few bars) at a time, just ahead of
// the playhead, so the music keeps developing instead of repeating.
//
// A piece:
//   Sim.register({
//     id, title, genre, about,            // strings for the UI
//     bpm, beatsPerBar = 4, swing = 0.5,  // swing: offbeat position, 0.5 straight .. 0.67 triplet
//     swingUnit = 0.5,                    // 0.5 swings 8ths, 0.25 swings 16ths
//     cycleBars = 8, gainDb = 0,
//     instruments(ctx) -> { trackName: { layer, play(time, ev, durSeconds), humanize? }, ... }
//         ctx: { keep(node), out, I: Sim.instruments, T: Sim.theory, bpm }
//         layer: "melody" | "harmony" | "bass" | "drums" | "texture"
//     compose({ cycle, rng, state, T }) -> { events, harmony?, section?, state? }
//         events: [{ track, bar, beat, dur, note, vel, ...extra }]  (bar within cycle, beat within bar, dur in beats)
//         harmony: [{ bar, beat, dur, chord }]                      (for display and linting)
//         tempo: { bpm, rampBeats? }  change tempo at the start of this cycle (ramped over rampBeats)
//     situations: ["party", ...], energy: 0..1                   (for the houseband; see catalog.js)
//   })
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const LAYERS = ["melody", "harmony", "bass", "drums", "texture"];
  Sim.LAYERS = LAYERS;
  Sim.pieces = [];
  Sim.register = function (p) {
    Sim.pieces.push({ beatsPerBar: 4, swing: 0.5, swingUnit: 0.5, cycleBars: 8, gainDb: 0, ...p });
  };

  /** Map a straight beat position to its swung position. */
  function swingBeat(b, s, unit) {
    if (s === 0.5) return b;
    const p = b / (2 * unit), i = Math.floor(p + 1e-9), f = p - i;
    if (f < 1e-6) return b;
    const g = f <= 0.5 ? (f / 0.5) * s : s + ((f - 0.5) / 0.5) * (1 - s);
    return (i + g) * 2 * unit;
  }
  Sim.swingBeat = swingBeat;

  class Conductor {
    constructor(hooks = {}) {
      this.hooks = hooks; // onNote({time, note, dur, layer, vel, track}), onCycle({cycle, section, harmony, startBeat})
      this.piece = null;
      this.muted = new Set();
      this.autoMuted = new Set(); // set by the houseband's energy control
      this.master = null;
    }

    _ensureMaster() {
      if (this.master) return this.master;
      const limiter = new Tone.Limiter(-1).toDestination();
      const comp = new Tone.Compressor({ threshold: -20, ratio: 2.2, attack: 0.03, release: 0.3, knee: 12 }).connect(limiter);
      const input = new Tone.Gain(1).connect(comp);
      this.master = { input, comp, limiter };
      return this.master;
    }

    /** Start a performance. `cycle` begins it part-way through: the earlier cycles are composed silently so the
     *  piece's memory (form, motifs, loop phases) is exactly what it would have been. */
    async play(piece, { seed = (Math.random() * 2 ** 31) >>> 0, cycle = 0 } = {}) {
      await Tone.start();
      this.stop();
      await this._setup(piece, seed, this._ensureMaster().input, cycle);
      const tr = Tone.getTransport();
      tr.start("+0.1");
    }

    /** Build the piece's instruments into `dest` and schedule `startCycle` on the current context's transport. */
    async _setup(piece, seed, dest, startCycle = 0) {
      // Capture the transport now: inside an offline render, later Tone.getTransport() calls return the live one.
      const tr = (this.tr = Tone.getTransport());
      tr.bpm.cancelScheduledValues(0);
      tr.bpm.value = piece.bpm;
      tr.position = 0;
      const nodes = [];
      const gain = Math.pow(10, (piece.gainDb || 0) / 20);
      const out = new Tone.Gain(0).connect(dest);
      nodes.push(out);
      const ctx = { keep: (n) => (nodes.push(n), n), out, I: Sim.instruments, T: Sim.theory, bpm: piece.bpm };
      const tracks = piece.instruments(ctx);
      await Promise.all(nodes.filter((n) => n && n.ready instanceof Promise).map((n) => n.ready));
      this.piece = piece; this.seed = seed; this.nodes = nodes; this.tracks = tracks; this.out = out;
      this.state = {}; this.rng = Sim.theory.rng(seed); this.harmony = []; this.sections = [];
      this.cycleBeats = piece.cycleBars * piece.beatsPerBar;
      this.secPerBeat = 60 / piece.bpm;
      startCycle = Math.max(0, Math.floor(startCycle || 0));
      if (startCycle > 0) { // replay the skipped cycles for their state (and the last tempo they set), without scheduling
        let bpm = piece.bpm;
        for (let c = 0; c < startCycle; c++) {
          const res = piece.compose({ cycle: c, rng: this.rng.fork(c), state: this.state, T: Sim.theory }) || {};
          if (res.state) this.state = res.state;
          if (res.tempo && res.tempo.bpm > 0) bpm = res.tempo.bpm;
        }
        tr.bpm.value = bpm;
        tr.ticks = Math.round(startCycle * this.cycleBeats * tr.PPQ);
      }
      this.startCycle = startCycle;
      this._schedule(startCycle);
      out.gain.setValueAtTime(0, Tone.now());
      out.gain.linearRampToValueAtTime(gain, Tone.now() + 0.5);
    }

    _schedule(cycle) {
      const p = this.piece, tr = this.tr, T = Sim.theory;
      const res = p.compose({ cycle, rng: this.rng.fork(cycle), state: this.state, T }) || {};
      if (res.state) this.state = res.state;
      const base = cycle * this.cycleBeats, bpb = p.beatsPerBar;
      const ticks = (b) => `${Math.round(b * tr.PPQ)}i`;
      if (res.tempo && res.tempo.bpm > 0) {
        const { bpm, rampBeats = 0 } = res.tempo;
        tr.scheduleOnce((time) => {
          if (this.piece !== p) return;
          tr.bpm.cancelScheduledValues(time);
          if (rampBeats > 0) tr.bpm.linearRampToValueAtTime(bpm, time + (rampBeats * 60) / ((tr.bpm.getValueAtTime(time) + bpm) / 2));
          else tr.bpm.setValueAtTime(bpm, time);
        }, ticks(base));
      }
      for (const h of res.harmony || []) this.harmony.push({ start: base + h.bar * bpb + h.beat, dur: h.dur, chord: h.chord });
      this.sections.push({ start: base, cycle, section: res.section || "" });
      const piece = p;
      for (const ev of res.events || []) {
        const track = this.tracks[ev.track];
        if (!track) { console.warn(`${p.id}: no track ${ev.track}`); continue; }
        const b0 = base + ev.bar * bpb + ev.beat;
        let b = b0, durBeats = ev.dur;
        if (!ev.straight) { // swing both ends, so a swung offbeat note doesn't spill over the next beat
          b = swingBeat(b0, p.swing, p.swingUnit);
          durBeats = swingBeat(b0 + ev.dur, p.swing, p.swingUnit) - b;
        }
        const hum = { timing: 0.007, vel: 0.07, ...(track.humanize || {}) };
        tr.scheduleOnce((time) => {
          if (this.piece !== piece || this.muted.has(track.layer) || this.autoMuted.has(track.layer)) return;
          const r = Math.random;
          // triangular jitter around the grid; the callback runs ~0.1 s ahead, so small negative offsets are safe
          const t = Math.max(0, time + (r() + r() - 1) * hum.timing + (ev.delay || 0));
          const durSec = Math.max(0.02, (durBeats * 60) / tr.bpm.getValueAtTime(time));
          const vel = Math.max(0.05, Math.min(1, (ev.vel ?? 0.75) * (1 + (r() * 2 - 1) * hum.vel)));
          track.play(t, { ...ev, vel }, durSec);
          if (this.hooks.onNote) {
            const pitched = typeof ev.note === "number" || Array.isArray(ev.note);
            this.hooks.onNote({ time: t, note: pitched ? ev.note : null, dur: durSec, layer: track.layer, vel, track: ev.track });
          }
        }, ticks(b));
      }
      // compose the next cycle one bar before this one ends
      tr.scheduleOnce(() => { if (this.piece === piece) this._schedule(cycle + 1); }, ticks(base + this.cycleBeats - bpb));
      // forget old harmony
      const now = this.beat();
      this.harmony = this.harmony.filter((h) => h.start + h.dur > now - 64);
      this.sections = this.sections.filter((s) => s.start > now - 256);
      if (this.hooks.onCycle) this.hooks.onCycle({ cycle, section: res.section || "", startBeat: base });
    }

    /** Current musical position in beats (transport time, i.e. before swing). */
    beat() {
      if (!this.piece) return 0;
      // what is sounding now, not what is being scheduled (transport.seconds runs a lookahead early)
      return this.tr.getTicksAtTime(this.tr.context.currentTime) / this.tr.PPQ;
    }
    now() {
      if (!this.piece) return null;
      const b = this.beat(), bpb = this.piece.beatsPerBar;
      const h = [...this.harmony].reverse().find((x) => x.start <= b + 1e-6);
      const s = [...this.sections].reverse().find((x) => x.start <= b + 1e-6);
      return { bpm: this.tr.bpm.value, beat: b, bar: Math.floor(b / bpb) + 1, beatInBar: Math.floor(b % bpb) + 1, chord: h ? h.chord : "", section: s ? s.section : "", cycle: s ? s.cycle : 0 };
    }
    setLayer(layer, on) { if (on) this.muted.delete(layer); else this.muted.add(layer); }

    stop() {
      const tr = Tone.getTransport();
      tr.stop(); tr.cancel(0);
      if (this.piece) {
        const nodes = this.nodes, out = this.out;
        this.piece = null;
        try { out.gain.cancelScheduledValues(Tone.now()); out.gain.setValueAtTime(out.gain.value, Tone.now()); out.gain.linearRampToValueAtTime(0, Tone.now() + 0.25); } catch (e) { /* already disposed */ }
        setTimeout(() => nodes.forEach((n) => { try { n.dispose(); } catch (e) { /* ignore */ } }), 400);
      }
    }
  }
  Sim.Conductor = Conductor;

  /**
   * Render a piece offline (for level checks and exports). layers: optional list of layers to keep.
   * Returns a ToneAudioBuffer.
   */
  Sim.renderOffline = async function (piece, { seconds = 30, seed = 1, sampleRate = 22050, channels = 2, layers = null, master = true } = {}) {
    return Tone.Offline(async () => {
      const c = new Conductor();
      if (layers) Sim.LAYERS.filter((l) => !layers.includes(l)).forEach((l) => c.muted.add(l));
      let dest = Tone.getDestination();
      if (master) {
        const limiter = new Tone.Limiter(-1).toDestination();
        const comp = new Tone.Compressor({ threshold: -20, ratio: 2.2, attack: 0.03, release: 0.3, knee: 12 }).connect(limiter);
        dest = new Tone.Gain(1).connect(comp);
      }
      await c._setup(piece, seed, dest);
      Tone.getTransport().start(0);
    }, seconds, channels, sampleRate);
  };
})(typeof window !== "undefined" ? window : globalThis);
