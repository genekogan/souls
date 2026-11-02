// Sim.instruments: a small orchestra of synthesized instruments built on Tone.js.
// Every factory takes (ctx, opts) and returns { out, play(time, notes, dur, vel) } where
// notes is a midi number or array, dur is seconds and vel is 0..1. Kits return { out, hit(voice, time, vel) }.
// ctx.keep(node) registers nodes for disposal; route `out` wherever the piece wants.
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const { hz } = Sim.theory;
  const arr = (n) => (Array.isArray(n) ? n : [n]);
  const db = (x) => Math.pow(10, x / 20);

  /**
   * Monophonic sources reject out-of-order triggers, and Tone clamps past times to "now", which can
   * make two triggers coincide. Keep each source's trigger times in the future and strictly increasing.
   */
  function monotonic(node) {
    let last = -Infinity;
    return (t) => (last = Math.max(t, node.context.currentTime + 0.003, last + 0.003));
  }
  // Level calibration (dB) so that `volume: 0` means the same loudness for every instrument:
  // a sustained note at vel 0.8 sits near -20 dB RMS, struck/plucked notes peak near -12 dB.
  const CAL = {
    rhodes: 7, softPiano: -1.5, organ: -11, vibes: 8, marimba: 0, kalimba: 0, glock: 0, bell: 0, nylon: 2, harp: 0, pizz: -11,
    upright: -7, ebass: -10, sub: -14, analog: -5, pad: 1, glassPad: 14, strings: -5, synthBrass: -6,
    flute: -13, clarinet: -13, oboe: -9, mutedTrumpet: -8, whistle: -13,
  };
  function outGain(ctx, volumeDb = 0, name) { return ctx.keep(new Tone.Gain(db(volumeDb + (CAL[name] || 0)))); }
  function poly(ctx, Voice, options, maxPolyphony = 24) {
    return ctx.keep(new Tone.PolySynth({ voice: Voice, maxPolyphony, options }));
  }
  function playPoly(synth) {
    return (time, notes, dur, vel = 0.8) => synth.triggerAttackRelease(arr(notes).map(hz), dur, time, vel);
  }
  /** A round-robin pool of monophonic voices, each behind its own velocity gain. */
  function pool(ctx, make, size, dest) {
    const voices = Array.from({ length: size }, () => {
      const g = ctx.keep(new Tone.Gain(1)).connect(dest);
      const v = ctx.keep(make()); v.connect(g);
      return { v, g, mono: monotonic(g) };
    });
    let i = 0;
    return (time, m, dur, vel) => {
      const { v, g, mono } = voices[i++ % size];
      const t = mono(time);
      g.gain.setValueAtTime(vel, t);
      v.triggerAttackRelease(hz(m), dur, t);
    };
  }

  const I = {};

  // ---------- keys ----------
  /** Electric piano in the DX "E.Piano" family: 1:1 FM body + high-ratio tine, stereo tremolo. */
  I.rhodes = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "rhodes");
    const trem = ctx.keep(new Tone.Tremolo({ frequency: o.tremolo ?? 3.6, depth: o.tremoloDepth ?? 0.28, spread: 160 }).start()).connect(out);
    const tone = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 3800, type: "lowpass", rolloff: -12 })).connect(trem);
    const body = poly(ctx, Tone.FMSynth, {
      harmonicity: 1, modulationIndex: o.bark ?? 2.2,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 2.8, sustain: 0.1, release: 0.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.7, sustain: 0.12, release: 0.5 },
    }).connect(tone);
    const tine = poly(ctx, Tone.FMSynth, {
      harmonicity: 14, modulationIndex: 0.55,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.55, sustain: 0, release: 0.3 },
      modulationEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
    }).connect(tone);
    tine.volume.value = o.tine ?? -14;
    return {
      out,
      play(time, notes, dur, vel = 0.7) {
        const f = arr(notes).map(hz);
        body.triggerAttackRelease(f, dur, time, vel);
        tine.triggerAttackRelease(f, Math.min(dur, 0.5), time, vel * vel);
      },
    };
  };

  /** Soft felt piano / music-box hybrid for ambient work: gentle FM with long decay. */
  I.softPiano = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "softPiano");
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 2600, type: "lowpass", rolloff: -12 })).connect(out);
    const a = poly(ctx, Tone.FMSynth, {
      harmonicity: 1, modulationIndex: 1.1, oscillator: { type: "sine" }, modulation: { type: "triangle" },
      envelope: { attack: 0.004, decay: o.decay ?? 5, sustain: 0, release: o.release ?? 3 },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.05, release: 0.6 },
    }).connect(lp);
    const b = poly(ctx, Tone.FMSynth, {
      harmonicity: 2, modulationIndex: 0.6, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: (o.decay ?? 5) * 0.4, sustain: 0, release: 1.5 },
      modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.3 },
    }).connect(lp);
    b.volume.value = -12;
    return { out, play(time, notes, dur, vel = 0.6) { const f = arr(notes).map(hz); a.triggerAttackRelease(f, dur, time, vel); b.triggerAttackRelease(f, dur, time, vel * 0.8); } };
  };

  /** Drawbar-ish organ: additive sines, a little drive and slow rotary-style chorus. */
  I.organ = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "organ");
    const ch = ctx.keep(new Tone.Chorus({ frequency: 0.8, delayTime: 3, depth: 0.5, spread: 180, wet: 0.5 }).start()).connect(out);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "custom", partials: o.partials ?? [1, 0.6, 0.45, 0.2, 0, 0.12, 0, 0.08] },
      envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.12 },
    }).connect(ch);
    return { out, play: playPoly(s) };
  };

  // ---------- mallets & plucked ----------
  /** Vibraphone: 1:4 FM bar with motor tremolo. */
  I.vibes = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "vibes");
    const motor = ctx.keep(new Tone.Tremolo({ frequency: o.motor ?? 5.2, depth: o.motorDepth ?? 0.3, spread: 60 }).start()).connect(out);
    const s = poly(ctx, Tone.FMSynth, {
      harmonicity: 4, modulationIndex: 0.9, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: o.decay ?? 3.2, sustain: 0, release: o.release ?? 1.6 },
      modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.05, release: 0.3 },
    }).connect(motor);
    return { out, play: playPoly(s) };
  };

  /** Marimba: hard-mallet click into a short woody decay. */
  I.marimba = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "marimba");
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 5000, type: "lowpass" })).connect(out);
    const s = poly(ctx, Tone.FMSynth, {
      harmonicity: 4, modulationIndex: o.hardness ?? 1.6, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: o.decay ?? 0.75, sustain: 0, release: 0.3 },
      modulationEnvelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(lp);
    return { out, play: playPoly(s) };
  };

  /** Kalimba / mbira: inharmonic tine with quick bright attack. */
  I.kalimba = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "kalimba");
    const s = poly(ctx, Tone.FMSynth, {
      harmonicity: 5.95, modulationIndex: o.bright ?? 1.1, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: o.decay ?? 1.4, sustain: 0, release: 0.6 },
      modulationEnvelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.05 },
    }).connect(out);
    return { out, play: playPoly(s) };
  };

  /** Glockenspiel / celesta. */
  I.glock = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "glock");
    const s = poly(ctx, Tone.FMSynth, {
      harmonicity: o.celesta ? 2 : 3.5, modulationIndex: o.celesta ? 0.8 : 1.4, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: o.decay ?? 2.2, sustain: 0, release: 1.2 },
      modulationEnvelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
    }).connect(out);
    return { out, play: playPoly(s) };
  };

  /** Struck bell / tubular chime with inharmonic overtone. */
  I.bell = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "bell");
    const s = poly(ctx, Tone.FMSynth, {
      harmonicity: 3.01, modulationIndex: 2.2, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: o.decay ?? 6, sustain: 0, release: 4 },
      modulationEnvelope: { attack: 0.002, decay: 1.2, sustain: 0.1, release: 2 },
    }, 12).connect(out);
    return { out, play: playPoly(s) };
  };

  /** Nylon-string guitar: Karplus-Strong voices, with strum spread for chords. */
  I.nylon = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "nylon");
    const body = ctx.keep(new Tone.EQ3({ low: 2, mid: -1, high: -4, lowFrequency: 220, highFrequency: 3200 })).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 4200, type: "lowpass" })).connect(body);
    const trig = pool(ctx, () => new Tone.PluckSynth({ attackNoise: o.attackNoise ?? 0.8, dampening: o.dampening ?? 3800, resonance: o.resonance ?? 0.94, release: 1 }), o.voices ?? 8, lp);
    return {
      out,
      /** strum: seconds between strings (positive = down-strum low to high, negative = up). */
      play(time, notes, dur, vel = 0.7, strum = 0) {
        let ns = arr(notes).slice().sort((a, b) => a - b);
        if (strum < 0) ns = ns.reverse();
        ns.forEach((m, i) => trig(time + i * Math.abs(strum), m, dur, vel * (1 - i * 0.04)));
      },
    };
  };

  /** Harp / zither: brighter, longer-ringing plucks. */
  I.harp = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "harp");
    const trig = pool(ctx, () => new Tone.PluckSynth({ attackNoise: 0.4, dampening: o.dampening ?? 5200, resonance: o.resonance ?? 0.975, release: 2 }), o.voices ?? 10, out);
    return { out, play(time, notes, dur, vel = 0.7) { arr(notes).forEach((m) => trig(time, m, dur, vel)); } };
  };

  /** Pizzicato strings. */
  I.pizz = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "pizz");
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 2400, type: "lowpass" })).connect(out);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0.5, 0.28, 0.16, 0.08, 0.04] },
      envelope: { attack: 0.002, decay: o.decay ?? 0.32, sustain: 0, release: 0.15 },
    }).connect(lp);
    return { out, play: playPoly(s) };
  };

  // ---------- bass ----------
  /** Upright bass: round fundamental, quick filter thump, light growl. */
  I.upright = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "upright");
    const s = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.55, 0.22, 0.1, 0.05] },
      filter: { type: "lowpass", rolloff: -24, Q: 1.2 },
      envelope: { attack: 0.004, decay: 0.5, sustain: 0.32, release: 0.18 },
      filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.35, release: 0.2, baseFrequency: o.base ?? 160, octaves: 2.8 },
    })).connect(out);
    const mono = monotonic(out);
    return { out, play(time, notes, dur, vel = 0.8) { s.triggerAttackRelease(hz(arr(notes)[0]), dur, mono(time), vel); } };
  };

  /** Fingered electric bass (fretless-ish when fretless:true, with glide). */
  I.ebass = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "ebass");
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: o.fretless ? 0.06 : 0,
      oscillator: { type: "custom", partials: [1, 0.7, 0.35, 0.25, 0.12, 0.08] },
      filter: { type: "lowpass", rolloff: -24, Q: o.fretless ? 2.5 : 1 },
      envelope: { attack: 0.006, decay: 0.6, sustain: 0.55, release: 0.12 },
      filterEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.4, release: 0.2, baseFrequency: o.base ?? 140, octaves: o.fretless ? 2.6 : 2.2 },
    })).connect(out);
    const mono = monotonic(out);
    return { out, play(time, notes, dur, vel = 0.8) { s.triggerAttackRelease(hz(arr(notes)[0]), dur, mono(time), vel); } };
  };

  /** Pure sub-bass sine with soft attack. */
  I.sub = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "sub");
    const s = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "sine" }, filter: { type: "lowpass", Q: 0 },
      envelope: { attack: o.attack ?? 0.02, decay: 0.3, sustain: 0.85, release: o.release ?? 0.3 },
      filterEnvelope: { baseFrequency: 400, octaves: 0, attack: 0, decay: 0, sustain: 1, release: 0 },
    })).connect(out);
    const mono = monotonic(out);
    return { out, play(time, notes, dur, vel = 0.8) { s.triggerAttackRelease(hz(arr(notes)[0]), dur, mono(time), vel); } };
  };

  /** Analog mono synth (bass or lead): resonant filter env; returns filter for automation. */
  I.analog = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "analog");
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: o.glide ?? 0,
      oscillator: { type: o.wave ?? "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: o.resonance ?? 4 },
      envelope: { attack: o.attack ?? 0.004, decay: o.decay ?? 0.25, sustain: o.sustain ?? 0.3, release: o.release ?? 0.2 },
      filterEnvelope: { attack: 0.002, decay: o.filterDecay ?? 0.2, sustain: 0.15, release: 0.3, baseFrequency: o.base ?? 260, octaves: o.octaves ?? 3.2 },
    })).connect(out);
    const mono = monotonic(out);
    return { out, synth: s, filterEnvelope: s.filterEnvelope, play(time, notes, dur, vel = 0.8) { s.triggerAttackRelease(hz(arr(notes)[0]), dur, mono(time), vel); } };
  };

  // ---------- sustained ----------
  /** Warm analog pad: detuned saws through a slowly breathing lowpass. */
  I.pad = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "pad");
    const ch = ctx.keep(new Tone.Chorus({ frequency: 0.3, delayTime: 4, depth: 0.6, spread: 180, wet: 0.6 }).start()).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 1100, type: "lowpass", rolloff: -24, Q: 0.6 })).connect(ch);
    const lfo = ctx.keep(new Tone.LFO({ frequency: o.breath ?? 0.07, min: (o.cutoff ?? 1100) * 0.6, max: (o.cutoff ?? 1100) * 1.5 }).start());
    lfo.connect(lp.frequency);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: o.wave ?? "fatsawtooth", count: 3, spread: o.detune ?? 22 },
      envelope: { attack: o.attack ?? 1.8, decay: 1, sustain: 0.85, release: o.release ?? 3.5 },
    }, 20).connect(lp);
    return { out, filter: lp, play: playPoly(s) };
  };

  /** Glassy sine pad (AM), for very soft beds. */
  I.glassPad = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "glassPad");
    const s = poly(ctx, Tone.AMSynth, {
      harmonicity: o.harmonicity ?? 2, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: o.attack ?? 2.5, decay: 1, sustain: 0.9, release: o.release ?? 4 },
      modulationEnvelope: { attack: 3, decay: 1, sustain: 0.6, release: 4 },
    }, 20).connect(out);
    return { out, play: playPoly(s) };
  };

  /** String ensemble (section, not solo): detuned saws, slow bow, darkened. */
  I.strings = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "strings");
    const ch = ctx.keep(new Tone.Chorus({ frequency: 1.4, delayTime: 3.5, depth: 0.35, spread: 180, wet: 0.5 }).start()).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 2400, type: "lowpass", rolloff: -24 })).connect(ch);
    const hp = ctx.keep(new Tone.Filter({ frequency: 120, type: "highpass" })).connect(lp);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 14 },
      envelope: { attack: o.attack ?? 0.45, decay: 0.3, sustain: 0.85, release: o.release ?? 1.3 },
    }).connect(hp);
    return { out, play: playPoly(s) };
  };

  /** CS-80 style brass: filter swells open on each note; huge with reverb. */
  I.synthBrass = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "synthBrass");
    const ch = ctx.keep(new Tone.Chorus({ frequency: 0.5, delayTime: 5, depth: 0.4, spread: 180, wet: 0.45 }).start()).connect(out);
    const s = poly(ctx, Tone.MonoSynth, {
      oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
      filter: { type: "lowpass", rolloff: -24, Q: 1.5 },
      envelope: { attack: o.attack ?? 0.12, decay: 0.6, sustain: 0.75, release: o.release ?? 1.2 },
      filterEnvelope: { attack: o.swell ?? 0.35, decay: 1.2, sustain: 0.45, release: 1.2, baseFrequency: o.base ?? 300, octaves: o.octaves ?? 3 },
    }, 12).connect(ch);
    return { out, play: playPoly(s) };
  };

  // ---------- winds (monophonic, expressive) ----------
  function windVoice(ctx, o, osc) {
    const out = outGain(ctx, o.volume ?? 0, o.cal);
    const vib = ctx.keep(new Tone.Vibrato({ frequency: o.vibrato ?? 5.2, depth: o.vibratoDepth ?? 0.06 })).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 3000, type: "lowpass", rolloff: -12 })).connect(vib);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: o.glide ?? 0.025,
      oscillator: osc,
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: o.attack ?? 0.06, decay: 0.2, sustain: 0.8, release: o.release ?? 0.22 },
      filterEnvelope: { attack: o.attack ?? 0.06, decay: 0.3, sustain: 0.7, release: 0.3, baseFrequency: o.base ?? 700, octaves: o.octaves ?? 2.4 },
    })).connect(lp);
    const mono = monotonic(out);
    let breath = null;
    if (o.breath !== 0) {
      const bp = ctx.keep(new Tone.Filter({ frequency: o.breathFreq ?? 2200, type: "bandpass", Q: 0.9 })).connect(lp);
      breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.02, decay: 0.12, sustain: 0.12, release: 0.15 } })).connect(bp);
      breath.volume.value = o.breath ?? -24;
    }
    return {
      out,
      play(time, notes, dur, vel = 0.7) {
        const t = mono(time);
        s.triggerAttackRelease(hz(arr(notes)[0]), dur, t, vel);
        if (breath) breath.triggerAttackRelease(Math.max(0.05, dur * 0.9), t, vel);
      },
    };
  }
  I.flute = (ctx, o = {}) => windVoice(ctx, { cal: "flute", cutoff: 3600, base: 900, octaves: 2, breath: -20, breathFreq: 2600, ...o }, { type: "custom", partials: [1, 0.18, 0.08, 0.03] });
  I.clarinet = (ctx, o = {}) => windVoice(ctx, { cal: "clarinet", cutoff: 2600, base: 600, octaves: 2.2, breath: -30, vibratoDepth: 0.02, ...o }, { type: "custom", partials: [1, 0.04, 0.55, 0.03, 0.3, 0.02, 0.14, 0.01, 0.06] });
  I.oboe = (ctx, o = {}) => windVoice(ctx, { cal: "oboe", cutoff: 3400, base: 900, octaves: 1.6, breath: -32, vibratoDepth: 0.035, ...o }, { type: "custom", partials: [0.6, 1, 0.8, 0.55, 0.4, 0.3, 0.2, 0.12] });
  I.mutedTrumpet = (ctx, o = {}) => windVoice(ctx, { cal: "mutedTrumpet", cutoff: 2400, base: 800, octaves: 1.8, breath: -30, vibratoDepth: 0.03, attack: 0.035, ...o }, { type: "custom", partials: [0.4, 0.8, 1, 0.9, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12] });
  I.whistle = (ctx, o = {}) => windVoice(ctx, { cal: "whistle", cutoff: 5000, base: 1500, octaves: 1, breath: -26, breathFreq: 3500, vibratoDepth: 0.04, glide: 0.05, ...o }, { type: "sine" });

  // ---------- drums ----------
  /**
   * Drum kit. voices: kick, softKick, snare, rim, brushTap, brushSweep, hatClosed, hatOpen, hatPedal,
   * ride, shaker, conga, congaLow, bongo, clave, woodblock, tom, cajon, snap. Built lazily.
   * hit(voice, time, vel = 0.8, opts?) — opts.pitch (midi) for tuned percussion, opts.pan.
   */
  I.kit = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "kit");
    const cache = {};
    // per-voice trims (dB): peak near -8 dB for kick/snare/hand drums at vel 0.8, softer for brushes and metals
    const TRIM = { kick: -6, softKick: -7, snare: -4, rim: 8, brushTap: 11, brushSweep: 12, hatClosed: 7, hatOpen: 0, hatPedal: 0, ride: 11,
      shaker: 2, conga: -1, congaLow: 0, bongo: -4, clave: -5, woodblock: 2, tom: -4, cajon: -7, snap: 3 };
    /** Output for one voice: trim gain -> optional pan -> kit out. */
    const V = (name, pan = 0) => {
      const g = ctx.keep(new Tone.Gain(db(TRIM[name] || 0)));
      if (pan) g.connect(ctx.keep(new Tone.Panner(pan)).connect(out)); else g.connect(out);
      return g;
    };
    const mk = {
      kick: () => { const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 } })).connect(V("kick")); return (t, v) => s.triggerAttackRelease(hz(o.kickNote ?? 31), 0.2, t, v); },
      softKick: () => { const lp = ctx.keep(new Tone.Filter(220, "lowpass")).connect(V("softKick")); const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.1 } })).connect(lp); return (t, v) => s.triggerAttackRelease(hz(o.kickNote ?? 33), 0.15, t, v); },
      snare: () => {
        const v = V("snare", 0.05);
        const hp = ctx.keep(new Tone.Filter(1400, "highpass")).connect(v);
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 } })).connect(hp);
        const b = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.015, octaves: 1.5, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 } })).connect(v);
        b.volume.value = -8;
        return (t, v) => { n.triggerAttackRelease(0.12, t, v); b.triggerAttackRelease(hz(55), 0.08, t, v); };
      },
      rim: () => {
        const bp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 3 })).connect(V("rim", 0.1));
        const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.002, octaves: 0.6, envelope: { attack: 0.0005, decay: 0.045, sustain: 0, release: 0.02 } })).connect(bp);
        return (t, v) => s.triggerAttackRelease(hz(86), 0.03, t, v);
      },
      brushTap: () => {
        const bp = ctx.keep(new Tone.Filter({ frequency: 2800, type: "bandpass", Q: 0.7 })).connect(V("brushTap", 0.08));
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.003, decay: 0.09, sustain: 0, release: 0.04 } })).connect(bp);
        return (t, v) => n.triggerAttackRelease(0.06, t, v);
      },
      brushSweep: () => {
        const bp = ctx.keep(new Tone.Filter({ frequency: 2200, type: "bandpass", Q: 0.6 })).connect(V("brushSweep", -0.05));
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.09, decay: 0.2, sustain: 0.15, release: 0.12 } })).connect(bp);
        n.volume.value = -6;
        return (t, v, d = 0.25) => n.triggerAttackRelease(d, t, v);
      },
      hatClosed: () => { const hp = ctx.keep(new Tone.Filter(8000, "highpass")).connect(V("hatClosed", -0.25)); const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 } })).connect(hp); return (t, v) => n.triggerAttackRelease(0.03, t, v); },
      hatOpen: () => { const hp = ctx.keep(new Tone.Filter(7000, "highpass")).connect(V("hatOpen", -0.25)); const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.1 } })).connect(hp); return (t, v) => n.triggerAttackRelease(0.25, t, v); },
      hatPedal: () => { const bp = ctx.keep(new Tone.Filter({ frequency: 5500, type: "bandpass", Q: 1.2 })).connect(V("hatPedal", -0.25)); const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02 } })).connect(bp); return (t, v) => n.triggerAttackRelease(0.03, t, v); },
      ride: () => {
        const s = ctx.keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.1, release: 0.4 }, harmonicity: 5.1, modulationIndex: 18, resonance: 5200, octaves: 1.1 })).connect(V("ride", 0.3));
        s.volume.value = -22;
        return (t, v) => s.triggerAttackRelease(310, 0.4, t, v);
      },
      shaker: () => { const bp = ctx.keep(new Tone.Filter({ frequency: 6500, type: "bandpass", Q: 0.8 })).connect(V("shaker", 0.35)); const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.012, decay: 0.05, sustain: 0, release: 0.02 } })).connect(bp); return (t, v) => n.triggerAttackRelease(0.04, t, v); },
      conga: () => { const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.012, octaves: 1.2, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } })).connect(V("conga", 0.2)); return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 62), 0.2, t, v); },
      congaLow: () => { const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.015, octaves: 1.2, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } })).connect(V("congaLow", 0.3)); return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 55), 0.25, t, v); },
      bongo: () => { const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 1, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 } })).connect(V("bongo", -0.2)); return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 72), 0.1, t, v); },
      clave: () => { const s = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } })).connect(V("clave", 0.15)); return (t, v) => s.triggerAttackRelease(2500, 0.04, t, v); },
      woodblock: () => { const bp = ctx.keep(new Tone.Filter({ frequency: 1100, type: "bandpass", Q: 4 })).connect(V("woodblock", -0.15)); const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.001, octaves: 0.4, envelope: { attack: 0.0005, decay: 0.07, sustain: 0, release: 0.02 } })).connect(bp); return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 79), 0.05, t, v); },
      tom: () => { const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 2, envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.1 } })).connect(V("tom", -0.1)); return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 45), 0.3, t, v); },
      cajon: () => { const lp = ctx.keep(new Tone.Filter(900, "lowpass")).connect(V("cajon")); const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 } })).connect(lp); return (t, v) => s.triggerAttackRelease(hz(40), 0.12, t, v); },
      snap: () => { const bp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 1.5 })).connect(V("snap", 0.12)); const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } })).connect(bp); return (t, v) => n.triggerAttackRelease(0.04, t, v); },
    };
    // more voices (drum machines, Latin, Japanese, Middle Eastern...) registered by more-instruments.js
    for (const [name, make] of Object.entries(I.kitVoices || {})) mk[name] = () => make(ctx, V, o);
    Object.assign(TRIM, I.kitTrims || {});
    const clocks = {};
    function hit(voice, time, vel = 0.8, opts = {}) {
      if (!mk[voice]) throw new Error(`kit has no voice ${voice}`);
      if (!cache[voice]) {
        // built lazily, possibly from inside a scheduled callback: build in the kit's own context
        // (during an offline render the global Tone context is the live one)
        const prev = Tone.getContext(), own = out.context;
        if (prev !== own) Tone.setContext(own);
        try { cache[voice] = mk[voice](); } finally { if (prev !== own) Tone.setContext(prev); }
        clocks[voice] = monotonic(out);
      }
      cache[voice](clocks[voice](time), vel, opts.dur, opts.pitch);
    }
    (o.preload || []).forEach((v) => { cache[v] = mk[v](); clocks[v] = monotonic(out); });
    return { out, hit, voices: Object.keys(mk) };
  };

  // ---------- effects & routing ----------
  /** A wet-only reverb return connected to dest. Use send(src, fx, db) to feed it. */
  I.reverb = function (ctx, dest, o = {}) {
    const r = ctx.keep(new Tone.Reverb({ decay: o.decay ?? 3, preDelay: o.preDelay ?? 0.02, wet: 1 }));
    if (o.lowcut || o.highcut) {
      const hp = ctx.keep(new Tone.Filter(o.lowcut ?? 200, "highpass"));
      const lp = ctx.keep(new Tone.Filter(o.highcut ?? 9000, "lowpass"));
      r.chain(hp, lp, dest);
    } else r.connect(dest);
    return r;
  };
  I.delay = function (ctx, dest, o = {}) {
    const D = o.pingPong ? Tone.PingPongDelay : Tone.FeedbackDelay;
    const d = ctx.keep(new D({ delayTime: o.time ?? "8n.", maxDelay: o.maxDelay ?? 4, feedback: o.feedback ?? 0.3, wet: 1 }));
    const lp = ctx.keep(new Tone.Filter(o.highcut ?? 3500, "lowpass"));
    d.chain(lp, dest);
    return d;
  };
  /** Post-fader send: src -> gain(db) -> fx. */
  I.send = function (ctx, src, fx, gainDb = -12) {
    const g = ctx.keep(new Tone.Gain(db(gainDb)));
    src.connect(g); g.connect(fx);
    return g;
  };
  /** Stereo placement + level for an instrument's out. Returns the panner (connect it onward). */
  I.place = function (ctx, inst, pan = 0, dest) {
    const p = ctx.keep(new Tone.Panner(pan));
    inst.out.connect(p);
    if (dest) p.connect(dest);
    return p;
  };

  /** For custom monophonic sources in pieces: t => safe trigger time (future, strictly increasing). */
  I.monotonic = monotonic;
  // building blocks for more-instruments.js
  I._lib = { CAL, outGain, poly, playPoly, pool, windVoice, arr, db };

  Sim.instruments = I;
})(typeof window !== "undefined" ? window : globalThis);
