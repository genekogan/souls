// More of the orchestra: drum machines and world percussion for I.kit, plus basses, guitars, leads, voices
// and effects for the dance, rock, 80s, chiptune and world pieces. Same conventions as instruments.js:
// factories take (ctx, opts) and return { out, play(time, notes, dur, vel, ...extra) }; `volume: 0`
// is calibrated to the same loudness as every other instrument.
(function (root) {
  "use strict";
  const Sim = root.Sim;
  const I = Sim.instruments;
  const { hz } = Sim.theory;
  const { CAL, outGain, poly, playPoly, pool, windVoice, arr, db } = I._lib;
  const monotonic = I.monotonic;

  // calibration (dB) for the new instruments, measured like the originals (see tools/calibrate)
  Object.assign(CAL, {
    slapBass: -8, acid: -12.5, fmBass: -1, pluck: -11.5, supersaw: -6.5, pulse: -15, stringMachine: 0.5, choir: 1, orchHit: -4, brassStab: -3, sax: -9, distGuitar: -7, guitar: -1, koto: -3.5, shakuhachi: -15, steelDrum: -9, harmonica: -10, accordion: -6, pedalSteel: -12.5, lead: -5.5,
  });

  // ================================================================== kit voices
  // Each maker gets (ctx, V, kitOpts) and returns (time, vel, dur, pitch) => void. V(name, pan) is the voice's
  // trimmed output. Voices that fire several bursts per hit drive the gain of a running source, so overlapping
  // hits (flams, rolls) never ask a source to start twice.
  const K = {}, TR = {};
  const keep = (ctx, n) => ctx.keep(n);
  /** Noise that always runs, behind a gain the hit automates. */
  function runningNoise(ctx, dest, type = "white") {
    const g = keep(ctx, new Tone.Gain(0)).connect(dest);
    keep(ctx, new Tone.Noise({ type }).start()).connect(g);
    return g.gain;
  }
  /** Envelope bursts on a gain param: [[offset, level, decay]...]. */
  function bursts(param, t, v, list) {
    for (const [o, lvl, dec] of list) {
      param.setValueAtTime(0, t + o);
      param.linearRampToValueAtTime(lvl * v, t + o + 0.0015);
      param.setTargetAtTime(0, t + o + 0.0015, dec / 4);
    }
  }

  // ---- drum machines ----
  K.kick808 = (ctx, V, o) => { // long sine boom with a pitch drop; pitch = the note it settles on
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.09, octaves: 4.5, envelope: { attack: 0.001, decay: o.boom ?? 1.1, sustain: 0, release: 0.2 } })).connect(V("kick808"));
    return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 29), 0.6, t, v);
  };
  TR.kick808 = -6;
  K.kick909 = (ctx, V) => { // punchy body plus a short click
    const out = V("kick909");
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.035, octaves: 6, envelope: { attack: 0.0008, decay: 0.32, sustain: 0, release: 0.08 } })).connect(out);
    const hp = keep(ctx, new Tone.Filter(2500, "highpass")).connect(out);
    const click = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.008, sustain: 0, release: 0.005 } })).connect(hp);
    click.volume.value = -10;
    return (t, v, d, p) => { s.triggerAttackRelease(hz(p ?? 33), 0.2, t, v); click.triggerAttackRelease(0.008, t, v); };
  };
  TR.kick909 = -7;
  K.snare808 = (ctx, V) => {
    const out = V("snare808", 0.04);
    const a = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 0.8, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 } })).connect(out);
    const b = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 0.8, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } })).connect(out);
    b.volume.value = -5;
    const hp = keep(ctx, new Tone.Filter(1800, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.19, sustain: 0, release: 0.05 } })).connect(hp);
    return (t, v) => { a.triggerAttackRelease(185, 0.1, t, v); b.triggerAttackRelease(330, 0.06, t, v); n.triggerAttackRelease(0.15, t, v); };
  };
  TR.snare808 = -9;
  K.clap = (ctx, V) => { // three quick slaps and a short room tail
    const bp = keep(ctx, new Tone.Filter({ frequency: 1150, type: "bandpass", Q: 1.1 })).connect(V("clap", 0.06));
    const g = runningNoise(ctx, bp);
    return (t, v) => bursts(g, t, v, [[0, 1, 0.01], [0.011, 0.9, 0.01], [0.023, 0.85, 0.012], [0.034, 0.75, 0.16]]);
  };
  TR.clap = 6.5;
  K.gatedSnare = (ctx, V) => { // the 1984 snare: a fat hit inside a big room that is cut off dead
    const out = V("gatedSnare", 0.04);
    const verb = keep(ctx, new Tone.Reverb({ decay: 1.6, preDelay: 0.004, wet: 0.55 }));
    const gate = keep(ctx, new Tone.Gain(0)).connect(out);
    verb.connect(gate);
    const lp = keep(ctx, new Tone.Filter(7000, "lowpass")).connect(verb);
    const hp = keep(ctx, new Tone.Filter(900, "highpass")).connect(lp);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.2, sustain: 0.25, release: 0.06 } })).connect(hp);
    const b = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.6, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 } })).connect(lp);
    b.volume.value = -3;
    const clock = monotonic(gate);
    return (t, v, d) => {
      const len = Math.min(0.42, d ?? 0.32);
      const tt = clock(t);
      gate.gain.cancelAndHoldAtTime(tt);
      gate.gain.setValueAtTime(1, tt);
      gate.gain.setValueAtTime(1, tt + len);
      gate.gain.linearRampToValueAtTime(0, tt + len + 0.025);
      n.triggerAttackRelease(len * 0.8, t, v); b.triggerAttackRelease(hz(53), 0.1, t, v);
    };
  };
  TR.gatedSnare = -1.5;
  K.rockSnare = (ctx, V) => { // fat acoustic snare, rim-heavy
    const out = V("rockSnare", 0.04);
    const hp = keep(ctx, new Tone.Filter(1100, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.08 } })).connect(hp);
    const b = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.018, octaves: 1.8, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.05 } })).connect(out);
    b.volume.value = -2;
    return (t, v) => { n.triggerAttackRelease(0.2, t, v); b.triggerAttackRelease(hz(52), 0.1, t, v); };
  };
  TR.rockSnare = -6.5;
  K.simmons = (ctx, V) => { // electronic tom: a sine that dives; pitch = start note
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.14, octaves: 2.2, oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.55, sustain: 0, release: 0.1 } })).connect(V("simmons", -0.15));
    return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 50), 0.4, t, v);
  };
  TR.simmons = -3.5;
  K.cowbell = (ctx, V) => { // 808 cowbell: two square waves a fifth-ish apart, band-passed
    const bp = keep(ctx, new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 1.2 })).connect(V("cowbell", 0.2));
    const env = keep(ctx, new Tone.Gain(0)).connect(bp);
    keep(ctx, new Tone.Oscillator({ type: "square", frequency: 540 }).start()).connect(env);
    keep(ctx, new Tone.Oscillator({ type: "square", frequency: 800 }).start()).connect(env);
    return (t, v) => { env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.5 * v, t + 0.001); env.gain.setTargetAtTime(0.15 * v, t + 0.001, 0.012); env.gain.setTargetAtTime(0, t + 0.03, 0.07); };
  };
  TR.cowbell = -2.5;
  K.hat808 = (ctx, V) => {
    const hp = keep(ctx, new Tone.Filter(7500, "highpass")).connect(V("hat808", -0.22));
    const s = keep(ctx, new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.045, release: 0.02 }, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5 })).connect(hp);
    s.volume.value = -14;
    return (t, v) => s.triggerAttackRelease(400, 0.03, t, v);
  };
  TR.hat808 = 17;
  K.hat808Open = (ctx, V) => {
    const hp = keep(ctx, new Tone.Filter(7000, "highpass")).connect(V("hat808Open", -0.22));
    const s = keep(ctx, new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.35, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5 })).connect(hp);
    s.volume.value = -14;
    return (t, v, d) => s.triggerAttackRelease(400, Math.min(0.5, d ?? 0.3), t, v);
  };
  TR.hat808Open = 15.5;
  K.tambourine = (ctx, V) => {
    const out = V("tambourine", 0.3);
    const hp = keep(ctx, new Tone.Filter(6500, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 } })).connect(hp);
    const m = keep(ctx, new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.16, release: 0.05 }, harmonicity: 8.2, modulationIndex: 20, resonance: 9000, octaves: 0.8 })).connect(hp);
    m.volume.value = -18;
    return (t, v) => { n.triggerAttackRelease(0.08, t, v); m.triggerAttackRelease(900, 0.1, t, v); };
  };
  TR.tambourine = 0.5;
  K.crash = (ctx, V) => {
    const out = V("crash", -0.35);
    const hp = keep(ctx, new Tone.Filter(2500, "highpass")).connect(out);
    const m = keep(ctx, new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 2.2, release: 1 }, harmonicity: 4.9, modulationIndex: 40, resonance: 4500, octaves: 1.8 })).connect(hp);
    m.volume.value = -16;
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 0.5 } })).connect(hp);
    n.volume.value = -10;
    return (t, v) => { m.triggerAttackRelease(300, 1.2, t, v); n.triggerAttackRelease(1, t, v); };
  };
  TR.crash = 3.5;
  K.triangle = (ctx, V) => {
    const s = keep(ctx, new Tone.Synth({ oscillator: { type: "custom", partials: [1, 0, 0.5, 0, 0.3, 0, 0.2] }, envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 0.5 } })).connect(V("triangle", 0.4));
    return (t, v, d) => s.triggerAttackRelease(2900, d ?? 1, t, v);
  };
  TR.triangle = -10.5;

  // ---- Latin & Brazilian ----
  K.timbale = (ctx, V) => { // ringing metal-shelled drum; pitch: 74 high, 67 low
    const out = V("timbale", 0.25);
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.004, octaves: 0.7, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 } })).connect(out);
    const hp = keep(ctx, new Tone.Filter(3000, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } })).connect(hp);
    n.volume.value = -8;
    return (t, v, d, p) => { s.triggerAttackRelease(hz(p ?? 74), 0.25, t, v); n.triggerAttackRelease(0.02, t, v); };
  };
  TR.timbale = -4;
  K.agogo = (ctx, V) => { // two-tone bell; pitch: 86 high, 81 low
    const s = keep(ctx, new Tone.FMSynth({ harmonicity: 2.76, modulationIndex: 1.6, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }, modulationEnvelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } })).connect(V("agogo", -0.3));
    return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 86), 0.2, t, v);
  };
  TR.agogo = 3.5;
  K.surdo = (ctx, V) => { // big low samba drum; dur < 0.15 = muted stroke
    const lp = keep(ctx, new Tone.Filter(500, "lowpass")).connect(V("surdo"));
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 1.6, envelope: { attack: 0.002, decay: 0.75, sustain: 0, release: 0.15 } })).connect(lp);
    const m = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.2, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 } })).connect(lp);
    return (t, v, d, p) => (d != null && d < 0.15 ? m : s).triggerAttackRelease(hz(p ?? 38), 0.4, t, v);
  };
  TR.surdo = -6;
  K.tamborim = (ctx, V) => {
    const out = V("tamborim", 0.35);
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.003, octaves: 0.5, envelope: { attack: 0.0005, decay: 0.06, sustain: 0, release: 0.02 } })).connect(out);
    const hp = keep(ctx, new Tone.Filter(2500, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.03, sustain: 0, release: 0.01 } })).connect(hp);
    return (t, v) => { s.triggerAttackRelease(hz(88), 0.04, t, v); n.triggerAttackRelease(0.02, t, v * 0.7); };
  };
  TR.tamborim = -7.5;
  K.caixa = (ctx, V) => { // samba snare: tight, bright, buzzy
    const out = V("caixa", -0.1);
    const bp = keep(ctx, new Tone.Filter({ frequency: 4200, type: "bandpass", Q: 0.8 })).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 } })).connect(bp);
    const b = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 1, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } })).connect(out);
    b.volume.value = -10;
    return (t, v) => { n.triggerAttackRelease(0.07, t, v); b.triggerAttackRelease(hz(64), 0.04, t, v); };
  };
  TR.caixa = 0;
  K.guiro = (ctx, V) => { // a scrape: a train of tiny clicks; dur sets the length
    const bp = keep(ctx, new Tone.Filter({ frequency: 3200, type: "bandpass", Q: 2 })).connect(V("guiro", 0.25));
    const g = runningNoise(ctx, bp);
    return (t, v, d) => {
      const len = Math.max(0.05, Math.min(0.4, d ?? 0.18)), n = Math.round(len / 0.012);
      const list = [];
      for (let i = 0; i < n; i++) list.push([i * 0.012, 0.5 + 0.5 * Math.sin((Math.PI * i) / n), 0.008]);
      bursts(g, t, v, list);
    };
  };
  TR.guiro = -0.5;

  // ---- Japanese ----
  K.taiko = (ctx, V) => { // o-daiko: a huge, slow drum; pitch around 36
    const out = V("taiko");
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.07, octaves: 1.9, envelope: { attack: 0.003, decay: 1.3, sustain: 0, release: 0.3 } })).connect(out);
    const lp = keep(ctx, new Tone.Filter(1200, "lowpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.05 } })).connect(lp);
    n.volume.value = -6;
    return (t, v, d, p) => { s.triggerAttackRelease(hz(p ?? 36), 0.8, t, v); n.triggerAttackRelease(0.1, t, v); };
  };
  TR.taiko = -4.5;
  K.shime = (ctx, V) => { // shime-daiko: a high, tightly roped drum that keeps time
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.004, octaves: 0.8, envelope: { attack: 0.0006, decay: 0.09, sustain: 0, release: 0.02 } })).connect(V("shime", 0.2));
    return (t, v) => s.triggerAttackRelease(hz(76), 0.06, t, v);
  };
  TR.shime = -5;
  K.kachi = (ctx, V) => { // stick on the drum's rim
    const bp = keep(ctx, new Tone.Filter({ frequency: 2200, type: "bandpass", Q: 3 })).connect(V("kachi", -0.2));
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.001, octaves: 0.3, envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.01 } })).connect(bp);
    return (t, v) => s.triggerAttackRelease(hz(91), 0.03, t, v);
  };
  TR.kachi = 2.5;

  // ---- Middle Eastern & West African ----
  K.dum = (ctx, V) => { // darbuka centre stroke
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 1.4, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 } })).connect(V("dum", -0.05));
    return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 47), 0.3, t, v);
  };
  TR.dum = -2.5;
  K.tek = (ctx, V) => { // darbuka rim crack; pitch shades it
    const out = V("tek", 0.15);
    const bp = keep(ctx, new Tone.Filter({ frequency: 3800, type: "bandpass", Q: 1.4 })).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.01 } })).connect(bp);
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.002, octaves: 0.6, envelope: { attack: 0.0005, decay: 0.05, sustain: 0, release: 0.02 } })).connect(out);
    s.volume.value = -6;
    return (t, v, d, p) => { n.triggerAttackRelease(0.03, t, v); s.triggerAttackRelease(hz(p ?? 81), 0.04, t, v); };
  };
  TR.tek = -2;
  K.djembe = (ctx, V) => { // pitch below 50 = bass, 50-64 = tone, above = slap
    const out = V("djembe", -0.25);
    const s = keep(ctx, new Tone.MembraneSynth({ pitchDecay: 0.012, octaves: 1.4, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.08 } })).connect(out);
    const hp = keep(ctx, new Tone.Filter(2000, "highpass")).connect(out);
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.05, sustain: 0, release: 0.02 } })).connect(hp);
    return (t, v, d, p) => {
      const m = p ?? 58;
      s.triggerAttackRelease(hz(m), m < 50 ? 0.3 : 0.15, t, v);
      if (m > 64) n.triggerAttackRelease(0.04, t, v * 0.9);
    };
  };
  TR.djembe = -1.5;
  K.shekere = (ctx, V) => { // beaded gourd: a softer, longer shaker
    const bp = keep(ctx, new Tone.Filter({ frequency: 5200, type: "bandpass", Q: 0.7 })).connect(V("shekere", -0.35));
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.018, decay: 0.08, sustain: 0, release: 0.04 } })).connect(bp);
    return (t, v) => n.triggerAttackRelease(0.06, t, v);
  };
  TR.shekere = -3.5;
  K.gankogui = (ctx, V) => { // gankogui / clave bell for 12/8 timelines; pitch 84 high, 77 low
    const s = keep(ctx, new Tone.FMSynth({ harmonicity: 3.4, modulationIndex: 2.4, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 }, modulationEnvelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.03 } })).connect(V("gankogui", 0.3));
    return (t, v, d, p) => s.triggerAttackRelease(hz(p ?? 84), 0.15, t, v);
  };
  TR.gankogui = 4;
  K.chipNoise = (ctx, V) => { // 8-bit noise channel: short = hat, long = snare
    const crush = keep(ctx, new Tone.BitCrusher({ bits: 4 })).connect(V("chipNoise"));
    const n = keep(ctx, new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 } })).connect(crush);
    return (t, v, d) => { n.envelope.decay = Math.max(0.02, Math.min(0.3, d ?? 0.08)); n.triggerAttackRelease(0.02, t, v); };
  };
  TR.chipNoise = -6;
  I.kitVoices = K;
  I.kitTrims = TR;

  // ================================================================== basses
  /** Slap bass. extra art: "thumb" (default), "pop" (bright octave snap), "ghost" (dead click), "finger". */
  I.slapBass = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "slapBass");
    const comp = ctx.keep(new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.002, release: 0.12 })).connect(out);
    const s = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.8, 0.55, 0.42, 0.3, 0.22, 0.15, 0.1] },
      filter: { type: "lowpass", rolloff: -24, Q: 2 },
      envelope: { attack: 0.002, decay: 0.35, sustain: 0.45, release: 0.08 },
      filterEnvelope: { attack: 0.001, decay: 0.09, sustain: 0.25, release: 0.1, baseFrequency: 180, octaves: 4.2 },
    })).connect(comp);
    const hp = ctx.keep(new Tone.Filter(1800, "highpass")).connect(comp);
    const click = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 } })).connect(hp);
    click.volume.value = -14;
    const mono = monotonic(out);
    return {
      out,
      play(time, notes, dur, vel = 0.8, art = "thumb") {
        const t = mono(time), m = arr(notes)[0];
        if (art === "ghost") { click.triggerAttackRelease(0.01, t, vel); s.triggerAttackRelease(hz(m), 0.03, t, vel * 0.3); return; }
        const v = art === "pop" ? Math.min(1, vel * 1.15) : art === "finger" ? vel * 0.8 : vel;
        s.triggerAttackRelease(hz(m), dur, t, v);
        if (art !== "finger") click.triggerAttackRelease(0.01, t, art === "pop" ? vel * 1.3 : vel);
      },
    };
  };

  /**
   * TB-303-style acid line. play(t, note, dur, vel, {slide, accent}): slide glides from the previous note
   * without re-triggering (give the previous note a duration that reaches this one); accent opens the
   * filter wider and snappier. o.cutoff, o.resonance, o.envMod, o.decay, o.wave, o.drive.
   */
  I.acid = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "acid");
    let dest = out;
    if (o.drive) { dest = ctx.keep(new Tone.Distortion({ distortion: o.drive, oversample: "2x", wet: 0.6 })); dest.connect(out); }
    const amp = ctx.keep(new Tone.Gain(0)).connect(dest);
    const f = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 300, type: "lowpass", rolloff: -24, Q: o.resonance ?? 9 })).connect(amp);
    const osc = ctx.keep(new Tone.Oscillator({ type: o.wave ?? "sawtooth", frequency: 110 }).start()).connect(f);
    const clock = monotonic(amp);
    // the cutoff knob as a timeline, so a sweep keeps gliding underneath the per-note envelopes
    let knob = { t0: 0, c0: o.cutoff ?? 300, t1: 0, c1: o.cutoff ?? 300 };
    const base = (t) => {
      if (t >= knob.t1) return knob.c1;
      if (t <= knob.t0) return knob.c0;
      return knob.c0 * Math.pow(knob.c1 / knob.c0, (t - knob.t0) / (knob.t1 - knob.t0));
    };
    return {
      out, filter: f,
      /** Move the cutoff (the knob everyone tweaks) smoothly from `time` over `secs`. */
      sweep(time, cutoff, secs = 2) {
        const c = Math.max(40, Math.min(12000, cutoff));
        knob = { t0: time, c0: base(time), t1: time + Math.max(0.005, secs), c1: c };
        f.frequency.exponentialRampToValueAtTime(c, knob.t1);
      },
      play(time, notes, dur, vel = 0.8, x = {}) {
        const t = clock(time), fq = hz(arr(notes)[0]), acc = !!x.accent;
        const rest = base(t), peak = Math.min(12000, rest * Math.pow(2, (o.envMod ?? 3.2) + (acc ? 1.2 : 0)));
        if (x.slide) {
          osc.frequency.cancelAndHoldAtTime(t);
          osc.frequency.exponentialRampToValueAtTime(fq, t + 0.065);
          amp.gain.cancelAndHoldAtTime(t);
          amp.gain.setTargetAtTime(vel * (acc ? 1 : 0.75), t, 0.03);
        } else {
          osc.frequency.cancelAndHoldAtTime(t);
          osc.frequency.setValueAtTime(fq, t);
          amp.gain.cancelAndHoldAtTime(t);
          amp.gain.linearRampToValueAtTime(vel * (acc ? 1 : 0.75), t + 0.003);
          amp.gain.setTargetAtTime(vel * (acc ? 0.6 : 0.5), t + 0.003, 0.25);
          f.frequency.cancelAndHoldAtTime(t);
          f.frequency.setValueAtTime(peak, t + 0.001);
          f.frequency.setTargetAtTime(rest, t + 0.002, (o.decay ?? 0.22) * (acc ? 0.5 : 1) / 3);
          if (knob.t1 > t) f.frequency.exponentialRampToValueAtTime(knob.c1, knob.t1); // the sweep carries on after the decay
        }
        amp.gain.setTargetAtTime(0, t + Math.max(0.02, dur), 0.012);
      },
    };
  };

  /** DX7-style FM bass ("solid bass"): a knock on the attack, round below. */
  I.fmBass = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "fmBass");
    const s = ctx.keep(new Tone.FMSynth({
      harmonicity: o.harmonicity ?? 1, modulationIndex: o.bite ?? 6, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.5, sustain: 0.55, release: 0.1 },
      modulationEnvelope: { attack: 0.001, decay: 0.18, sustain: 0.12, release: 0.1 },
    })).connect(out);
    const mono = monotonic(out);
    return { out, play(time, notes, dur, vel = 0.8) { s.triggerAttackRelease(hz(arr(notes)[0]), dur, mono(time), vel); } };
  };

  // ================================================================== synths
  /** Plucky poly synth (house stabs, arps, trance plucks). o.wave, o.cutoff, o.decay, o.octaves. */
  I.pluck = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "pluck");
    const s = poly(ctx, Tone.MonoSynth, {
      oscillator: { type: o.wave ?? "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: o.resonance ?? 2 },
      envelope: { attack: 0.002, decay: o.decay ?? 0.35, sustain: o.sustain ?? 0.0, release: o.release ?? 0.25 },
      filterEnvelope: { attack: 0.001, decay: o.filterDecay ?? 0.18, sustain: 0.05, release: 0.2, baseFrequency: o.cutoff ?? 300, octaves: o.octaves ?? 4 },
    }, 16).connect(out);
    return { out, play: playPoly(s) };
  };

  /** Seven-voice detuned saw (trance pads and leads, synthwave). o.cutoff, o.attack, o.release, o.detune. */
  I.supersaw = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "supersaw");
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 4500, type: "lowpass", rolloff: -12 })).connect(out);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 5, spread: o.detune ?? 32 },
      envelope: { attack: o.attack ?? 0.02, decay: 0.4, sustain: o.sustain ?? 0.8, release: o.release ?? 0.5 },
    }, 12).connect(lp);
    return { out, filter: lp, play: playPoly(s) };
  };

  /**
   * Chiptune pulse channel. o.width: 0 = square (50% duty), 0.5 ≈ 25%, 0.75 ≈ 12.5%. o.wave "triangle"
   * gives the soft wave channel. o.bits (4-8) adds crunch. Short release: chip channels stop dead.
   */
  I.pulse = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "pulse");
    let dest = out;
    if (o.bits) { dest = ctx.keep(new Tone.BitCrusher({ bits: o.bits })); dest.connect(out); }
    const osc = o.wave === "triangle" ? { type: "triangle" } : { type: "pulse", width: o.width ?? 0.5 };
    const s = poly(ctx, Tone.Synth, {
      oscillator: osc,
      envelope: { attack: 0.002, decay: o.decay ?? 0.12, sustain: o.sustain ?? 0.65, release: o.release ?? 0.03 },
    }, 8).connect(dest);
    return { out, play: playPoly(s) };
  };

  /** String machine (Solina): bright saws through a thick ensemble chorus. */
  I.stringMachine = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "stringMachine");
    const shimmer = ctx.keep(new Tone.Chorus({ frequency: 6, delayTime: 2, depth: 0.15, spread: 90, wet: 0.5 }).start()).connect(out);
    const ens = ctx.keep(new Tone.Chorus({ frequency: 0.6, delayTime: 5, depth: 0.8, spread: 180, wet: 0.7 }).start()).connect(shimmer);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 3200, type: "lowpass", rolloff: -12 })).connect(ens);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 2, spread: 8 },
      envelope: { attack: o.attack ?? 0.35, decay: 0.5, sustain: 0.9, release: o.release ?? 1.2 },
    }, 20).connect(lp);
    return { out, play: playPoly(s) };
  };

  /** Wordless choir: buzz through vowel formants. o.vowel: a e i o u. */
  I.choir = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "choir");
    const VOW = { a: [800, 1150, 2900], e: [400, 1600, 2700], i: [350, 1700, 2700], o: [450, 800, 2830], u: [325, 700, 2700] };
    const fm = VOW[o.vowel ?? "a"] || VOW.a;
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 4.6, depth: 0.05 })).connect(out);
    const ch = ctx.keep(new Tone.Chorus({ frequency: 0.4, delayTime: 6, depth: 0.7, spread: 180, wet: 0.6 }).start()).connect(vib);
    const sum = ctx.keep(new Tone.Gain(1)).connect(ch);
    const src = ctx.keep(new Tone.Gain(1));
    fm.forEach((f, i) => {
      const bp = ctx.keep(new Tone.Filter({ frequency: f, type: "bandpass", Q: [5, 7, 9][i] }));
      const g = ctx.keep(new Tone.Gain([1.6, 0.8, 0.35][i]));
      src.connect(bp); bp.connect(g); g.connect(sum);
    });
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 18 },
      envelope: { attack: o.attack ?? 0.6, decay: 0.4, sustain: 0.9, release: o.release ?? 1.6 },
    }, 20).connect(src);
    return { out, play: playPoly(s) };
  };

  /** Fairlight-style orchestra hit: a noise burst and an octave-stacked saw chord that dies fast. */
  I.orchHit = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "orchHit");
    const lp = ctx.keep(new Tone.Filter({ frequency: 5000, type: "lowpass" })).connect(out);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 25 },
      envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.2 },
    }, 16).connect(lp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 0.6 })).connect(lp);
    const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 } })).connect(bp);
    const mono = monotonic(out);
    return {
      out,
      play(time, notes, dur, vel = 0.8) {
        const ns = arr(notes), stack = [...new Set(ns.flatMap((m) => [m - 12, m, m + 12]))];
        s.triggerAttackRelease(stack.map(hz), Math.min(dur, 0.4), time, vel);
        n.triggerAttackRelease(0.1, mono(time), vel);
      },
    };
  };

  /** Brass section stab (disco, funk, 80s): bright saws, quick filter blip, short fall. */
  I.brassStab = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "brassStab");
    const s = poly(ctx, Tone.MonoSynth, {
      oscillator: { type: "fatsawtooth", count: 2, spread: 10 },
      filter: { type: "lowpass", rolloff: -24, Q: 1 },
      envelope: { attack: o.attack ?? 0.012, decay: 0.25, sustain: 0.6, release: o.release ?? 0.12 },
      filterEnvelope: { attack: 0.015, decay: 0.25, sustain: 0.5, release: 0.15, baseFrequency: o.base ?? 500, octaves: o.octaves ?? 3 },
    }, 12).connect(out);
    return { out, play: playPoly(s) };
  };

  /** Mono lead (racing, 80s TV, synthwave): fat saw or square, glide, delayed vibrato. */
  I.lead = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "lead");
    const vib = ctx.keep(new Tone.Vibrato({ frequency: o.vibrato ?? 5.5, depth: o.vibratoDepth ?? 0.08 })).connect(out);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: o.glide ?? 0.03,
      oscillator: { type: o.wave ?? "fatsawtooth", count: 2, spread: o.detune ?? 12 },
      filter: { type: "lowpass", rolloff: -24, Q: o.resonance ?? 1.5 },
      envelope: { attack: o.attack ?? 0.01, decay: 0.3, sustain: o.sustain ?? 0.75, release: o.release ?? 0.25 },
      filterEnvelope: { attack: 0.01, decay: 0.4, sustain: 0.5, release: 0.3, baseFrequency: o.base ?? 600, octaves: o.octaves ?? 3 },
    })).connect(vib);
    vib.depth.value = 0;
    const mono = monotonic(out);
    const depth = o.vibratoDepth ?? 0.08, delay = o.vibratoDelay ?? 0.35;
    return {
      out, synth: s,
      play(time, notes, dur, vel = 0.8) {
        const t = mono(time);
        s.triggerAttackRelease(hz(arr(notes)[0]), dur, t, vel);
        vib.depth.cancelAndHoldAtTime(t);
        vib.depth.setValueAtTime(0, t);
        if (dur > delay) vib.depth.linearRampToValueAtTime(depth, t + Math.min(dur, delay + 0.4));
      },
    };
  };

  // ================================================================== guitars & plucked
  /** Overdriven guitar for power chords and riffs. Short, quiet notes read as palm mutes. o.drive. */
  I.distGuitar = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "distGuitar");
    const cab = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 3400, type: "lowpass", rolloff: -24 })).connect(out);
    const mid = ctx.keep(new Tone.EQ3({ low: -2, mid: 3, high: -3, lowFrequency: 250, highFrequency: 2500 })).connect(cab);
    const dist = ctx.keep(new Tone.Distortion({ distortion: o.drive ?? 0.75, oversample: "4x" })).connect(mid);
    const hp = ctx.keep(new Tone.Filter(90, "highpass")).connect(dist);
    const s = poly(ctx, Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 2, spread: 9 },
      envelope: { attack: 0.003, decay: 1.2, sustain: 0.6, release: 0.12 },
    }, 12).connect(hp);
    return { out, play: playPoly(s) };
  };

  /**
   * Steel-string, clean electric or muted guitar (Karplus-Strong). o.kind: "steel" | "clean" | "muted".
   * play(t, notes, dur, vel, strum): strum seconds between strings (negative = up-strum).
   */
  I.guitar = function (ctx, o = {}) {
    const kind = o.kind ?? "steel";
    const P = { steel: { an: 1.2, damp: 5200, res: 0.975, eq: [3, -1, 0] }, clean: { an: 0.8, damp: 3800, res: 0.96, eq: [-1, 1, 1] }, muted: { an: 2.2, damp: 1700, res: 0.82, eq: [-3, 3, 1] } }[kind];
    const out = outGain(ctx, (o.volume ?? 0) + (kind === "muted" ? 4 : 0), "guitar");
    let dest = out;
    if (o.chorus) { dest = ctx.keep(new Tone.Chorus({ frequency: 0.9, delayTime: 3, depth: 0.5, spread: 160, wet: 0.5 }).start()); dest.connect(out); }
    const body = ctx.keep(new Tone.EQ3({ low: P.eq[0], mid: P.eq[1], high: P.eq[2], lowFrequency: 200, highFrequency: 3000 })).connect(dest);
    const trig = pool(ctx, () => new Tone.PluckSynth({ attackNoise: o.attackNoise ?? P.an, dampening: o.dampening ?? P.damp, resonance: o.resonance ?? P.res, release: 1 }), o.voices ?? 10, body);
    return {
      out,
      play(time, notes, dur, vel = 0.7, strum = 0) {
        let ns = arr(notes).slice().sort((a, b) => a - b);
        if (strum < 0) ns = ns.reverse();
        ns.forEach((m, i) => trig(time + i * Math.abs(strum), m, dur, vel * (1 - i * 0.035)));
      },
    };
  };

  /** Koto (or shamisen with o.resonance ~0.9): bright, nasal plucks. */
  I.koto = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "koto");
    const eq = ctx.keep(new Tone.EQ3({ low: -4, mid: 4, high: 2, lowFrequency: 300, highFrequency: 2800 })).connect(out);
    const trig = pool(ctx, () => new Tone.PluckSynth({ attackNoise: 2.5, dampening: o.dampening ?? 6500, resonance: o.resonance ?? 0.97, release: 1.5 }), o.voices ?? 8, eq);
    return { out, play(time, notes, dur, vel = 0.7) { arr(notes).forEach((m, i) => trig(time + i * 0.03, m, dur, vel)); } };
  };

  /** Steel pan: round fundamental with octave and twelfth, a soft "boing". */
  I.steelDrum = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "steelDrum");
    const a = poly(ctx, Tone.Synth, { oscillator: { type: "custom", partials: [1, 0.55, 0.3, 0.08] }, envelope: { attack: 0.003, decay: o.decay ?? 1.1, sustain: 0, release: 0.5 } }).connect(out);
    const b = poly(ctx, Tone.FMSynth, { harmonicity: 2, modulationIndex: 2, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.1 }, modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } }).connect(out);
    b.volume.value = -10;
    return { out, play(time, notes, dur, vel = 0.7) { const f = arr(notes).map(hz); a.triggerAttackRelease(f, dur, time, vel); b.triggerAttackRelease(f, 0.15, time, vel); } };
  };

  // ================================================================== winds & reeds
  I.sax = (ctx, o = {}) => windVoice(ctx, { cal: "sax", cutoff: 3200, base: 700, octaves: 2.4, breath: -24, breathFreq: 1900, vibrato: 5.4, vibratoDepth: 0.05, attack: 0.03, glide: 0.03, ...o }, { type: "custom", partials: [1, 0.85, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25, 0.18, 0.12] });
  I.shakuhachi = (ctx, o = {}) => windVoice(ctx, { cal: "shakuhachi", cutoff: 3000, base: 800, octaves: 1.4, breath: -13, breathFreq: 1700, vibrato: 4.4, vibratoDepth: 0.07, attack: 0.14, glide: 0.09, release: 0.4, ...o }, { type: "custom", partials: [1, 0.08, 0.14, 0.03, 0.04] });
  I.harmonica = (ctx, o = {}) => windVoice(ctx, { cal: "harmonica", cutoff: 2800, base: 900, octaves: 1.8, breath: -26, breathFreq: 2400, vibrato: 5.8, vibratoDepth: 0.03, attack: 0.035, glide: 0.04, ...o }, { type: "custom", partials: [0.7, 1, 0.85, 0.55, 0.42, 0.28, 0.18, 0.1] });
  I.pedalSteel = (ctx, o = {}) => windVoice(ctx, { cal: "pedalSteel", cutoff: 2600, base: 500, octaves: 2, breath: 0, vibrato: 4.6, vibratoDepth: 0.025, attack: 0.28, glide: 0.18, release: 1.2, ...o }, { type: "custom", partials: [1, 0.45, 0.3, 0.12, 0.06, 0.03] });

  /** Accordion / melodica (o.melodica): reedy, musette-detuned. */
  I.accordion = function (ctx, o = {}) {
    const out = outGain(ctx, o.volume ?? 0, "accordion");
    const trem = ctx.keep(new Tone.Tremolo({ frequency: o.melodica ? 0 : 5.5, depth: o.melodica ? 0 : 0.15 }).start()).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? (o.melodica ? 2200 : 2800), type: "lowpass" })).connect(trem);
    const s = poly(ctx, Tone.Synth, {
      oscillator: o.melodica ? { type: "custom", partials: [1, 0.3, 0.55, 0.12, 0.3, 0.06, 0.15] } : { type: "fatsquare", count: 3, spread: 16 },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.85, release: 0.12 },
    }, 12).connect(lp);
    return { out, play: playPoly(s) };
  };

  // ================================================================== effects & beds
  /**
   * Sidechain pump: route parts into `input`; call duck(time) on every kick.
   * o.depth (0..1), o.release seconds.
   */
  I.pump = function (ctx, dest, o = {}) {
    const g = ctx.keep(new Tone.Gain(1)).connect(dest);
    const clock = monotonic(g);
    const depth = o.depth ?? 0.6, rel = o.release ?? 0.22;
    return {
      input: g,
      duck(time) {
        const t = clock(time);
        g.gain.cancelAndHoldAtTime(t);
        g.gain.linearRampToValueAtTime(1 - depth, t + 0.006);
        g.gain.setTargetAtTime(1, t + 0.01, rel / 3);
      },
    };
  };

  /** Tape: wow, flutter, head-loss lowpass and a little saturation. Returns the input node. */
  I.tape = function (ctx, dest, o = {}) {
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 6500, type: "lowpass", rolloff: -12 })).connect(dest);
    const sat = ctx.keep(new Tone.Distortion({ distortion: o.drive ?? 0.06, oversample: "2x", wet: 0.3 })).connect(lp);
    const wow = ctx.keep(new Tone.Vibrato({ frequency: o.wowRate ?? 0.45, depth: o.wow ?? 0.25, maxDelay: 0.006 })).connect(sat);
    const flutter = ctx.keep(new Tone.Vibrato({ frequency: 6.3, depth: o.flutter ?? 0.04, maxDelay: 0.004 })).connect(wow);
    return flutter;
  };

  /** Gated reverb return: a big room chopped short (80s drums). */
  I.gatedReverb = function (ctx, dest, o = {}) {
    const gate = ctx.keep(new Tone.Gate({ threshold: o.threshold ?? -34, smoothing: 0.02 })).connect(dest);
    const r = ctx.keep(new Tone.Reverb({ decay: o.decay ?? 1.8, preDelay: 0.008, wet: 1 })).connect(gate);
    return r;
  };

  /** Vinyl bed: a looping buffer of crackle and pops plus soft hiss. o.level dB, o.seed. */
  I.vinyl = function (ctx, dest, o = {}) {
    const g = ctx.keep(new Tone.Gain(db(o.level ?? -30))).connect(dest);
    const sr = Tone.getContext().sampleRate, n = Math.floor(sr * 5.3);
    const L = new Float32Array(n), R = new Float32Array(n);
    let x = (o.seed ?? 7) >>> 0;
    const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += 0.08 * (rnd() * 2 - 1 - lp); L[i] = R[i] = lp * 0.06; }
    const pops = Math.round(5.3 * (o.crackle ?? 9));
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(rnd() * (n - 400)), big = rnd() < 0.08, amp = (big ? 0.9 : 0.25) * (0.4 + rnd()), sgn = rnd() < 0.5 ? -1 : 1, ch = rnd();
      for (let j = 0; j < (big ? 60 : 14); j++) { const v = sgn * amp * Math.exp(-j / (big ? 9 : 3)) * (j % 2 ? -0.6 : 1); if (ch < 0.7) L[at + j] += v; if (ch > 0.3) R[at + j] += v; }
    }
    const buf = Tone.ToneAudioBuffer.fromArray([L, R]);
    const hp = ctx.keep(new Tone.Filter(250, "highpass")).connect(g);
    const pl = ctx.keep(new Tone.Player({ url: buf, loop: true })).connect(hp);
    pl.start();
    return { out: g };
  };
})(typeof window !== "undefined" ? window : globalThis);
