// Sim.spc: the sound chip. A per-piece "console" that imposes the SPC700's character as a system rather
// than a sprinkle of effects: a hardware voice budget with priority and note stealing, a shared lo-fi output
// stage (32 kHz-ish DAC, gentle bit reduction, Gaussian-interpolation roll-off), the famous short echo with
// a dark filter in its feedback loop and per-voice sends, and a small library of chip voices built from Tone
// primitives with the old sound-designer tricks (short looped waves, pitch envelopes, BRR grit, swept noise).
//
// Optional: a piece that never calls Sim.spc changes nothing.
//
//   instruments(ctx) {
//     const chip = Sim.spc.chip(ctx, { voices: 8, bits: 8, rate: 32000, echo: { time: 0.128, feedback: 0.45, tone: 2400, level: -6 } });
//     const lead = chip.voice("lead", { priority: 6, echo: 0.5, pan: 0.1, volume: 0 });
//     const pad  = chip.voice("pad",  { poly: 3, priority: 3, echo: 0.35 });
//     const bass = chip.voice("bass", { priority: 3, grit: 6 });
//     const kick = chip.voice("kick", { priority: 5 }), snare = chip.voice("snare", { priority: 5, echo: 0.25 }), hat = chip.voice("hat", { priority: 1 });
//     return { lead: { layer: "melody", play: lead.play }, pad: { layer: "harmony", play: pad.play }, ... };
//   }
//   compose(...) {
//     ... build events ...
//     const { events, stolen, dropped } = Sim.spc.budget(ev, { voices: 8, bpb: 4, priority: { lead: 6, kick: 5, snare: 5, pad: 3, bass: 3, hat: 1 } });
//     return { events, harmony, section };
//   }
//
// chip.voice(name, opts) -> { play(time, ev, dur), out, units }     play reads ev.note (midi or array), ev.vel,
//   ev.priority (overrides the voice's), ev.bend {cents, time}, ev.open (hat), ev.pitch (tom, midi).
//   opts: priority, echo (0..1 send), pan (-1..1), volume (dB), poly (units = hardware voices this patch may
//   hold at once), grit (bits, per-voice BRR-style crunch), detune (cents, tone family), plus the voice's own
//   parameters (see VOICES: wave, cutoff, attack/decay/sustain/release, bend {cents, time}, vibrato {rate, depth, delay}).
// chip.out  the chip's output (already connected to ctx.out unless opts.dest is null).
// chip.stats() -> { stolen, dropped }  runtime allocator counters.
//
// Sim.spc.budget(events, opts) applies the same budget at compose time, deterministically, so the score
//   printout and the linter see the economised arrangement: a note that needs a voice when all are busy
//   steals the oldest lower-or-equal-priority note (its dur is shortened to end at the steal) or, when
//   every active note outranks it, is dropped. Chord arrays count one voice per note.
//   opts: voices (8), bpb (4), priority {track: n} (ev.priority overrides), stealEqual (true), minBeats (0.1).
//   Returns { events, stolen, dropped, ledger }.
// Sim.spc.ledger(events, opts) -> { used(absBeat), free(absBeat) }  voices in use at a beat.
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const S = {};
  const db = (x) => Math.pow(10, x / 20);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fin = (x, d) => (Number.isFinite(x) ? x : d);
  const arr = (n) => (Array.isArray(n) ? n : [n]);
  const hz = (m) => Sim.theory.hz(m);

  // Short single-cycle "loops": a few harmonics, the way a 32-sample BRR loop sounds.
  S.WAVES = {
    saw: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12, 0.1],
    square: [1, 0, 0.33, 0, 0.2, 0, 0.14, 0, 0.11],
    pulse: [1, 0.64, 0.21, 0.08, 0.2, 0.17, 0.06, 0.03, 0.1], // ~25% duty
    reed: [1, 0.35, 0.65, 0.2, 0.42, 0.12, 0.22, 0.06, 0.1], // a clipped brass / reed loop
    organ: [1, 0.7, 0.2, 0.5, 0.08, 0.3, 0, 0.2],
    glass: [1, 0.04, 0.42, 0.02, 0.16, 0, 0.06, 0, 0.02],
    soft: [1, 0.22, 0.07, 0.03, 0.01], // triangle-ish, the flute / ocarina family
    bell: [1, 0, 0.3, 0, 0, 0.26, 0, 0, 0, 0.12],
    hollow: [1, 0, 0, 0.3, 0, 0, 0.12], // a clarinet-ish loop with the even harmonics missing
  };

  // ---------- compose-side budget ----------
  S.ledger = function (events, o = {}) {
    const voices = o.voices ?? 8, bpb = o.bpb ?? 4;
    const spans = events.map((e) => ({ a: e.bar * bpb + e.beat, b: e.bar * bpb + e.beat + e.dur, n: Array.isArray(e.note) ? e.note.length : 1 }));
    const used = (t) => spans.reduce((s, x) => s + (x.a <= t + 1e-6 && x.b > t + 1e-6 ? x.n : 0), 0);
    return { used, free: (t) => Math.max(0, voices - used(t)) };
  };

  S.budget = function (events, o = {}) {
    const voices = o.voices ?? 8, bpb = o.bpb ?? 4, pri = o.priority || {}, stealEqual = o.stealEqual !== false, minBeats = o.minBeats ?? 0.1;
    const order = events.map((e, i) => ({ e: { ...e }, i, t: e.bar * bpb + e.beat, p: e.priority ?? pri[e.track] ?? 1, n: Array.isArray(e.note) ? e.note.length : 1 }))
      .sort((x, y) => x.t - y.t || y.p - x.p || x.i - y.i);
    const active = []; // one entry per sounding event: { t, end, p, n, rec }; a stolen chord is freed as a whole
    const out = [];
    let stolen = 0, dropped = 0;
    const inUse = () => active.reduce((s, x) => s + x.n, 0);
    for (const rec of order) {
      const t = rec.t;
      for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= t + 1e-6) active.splice(i, 1);
      let used = inUse();
      const victims = [];
      if (used + rec.n > voices) {
        const cands = active.filter((s) => s.p < rec.p || (stealEqual && s.p === rec.p)).sort((a, b) => a.p - b.p || a.t - b.t);
        while (used + rec.n > voices && cands.length) { const v = cands.shift(); victims.push(v); used -= v.n; }
      }
      if (used + rec.n > voices) { dropped++; continue; }
      for (const v of victims) {
        active.splice(active.indexOf(v), 1);
        stolen++;
        const newDur = t - v.t;
        if (newDur < minBeats) v.rec.e._dropped = true; else v.rec.e.dur = +newDur.toFixed(4);
      }
      active.push({ t, end: t + rec.e.dur, p: rec.p, n: rec.n, rec });
      out.push(rec);
    }
    const kept = out.filter((r) => !r.e._dropped).sort((x, y) => x.i - y.i).map((r) => r.e);
    return { events: kept, stolen, dropped, ledger: S.ledger(kept, { voices, bpb }) };
  };

  // ---------- voice library ----------
  // Each maker gets (ctx, dest, vo) and returns a unit: { trigger(t, midi, durSec, vel, ev), cut(t), [hold(ev, dur)] }.
  // A unit is one hardware voice: one monophonic Tone source behind its own gain; the gain carries velocity
  // and is also what a steal cuts.
  function unit(ctx, dest, extras = {}) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    return {
      g,
      gate(t, vel) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(clamp(fin(vel, 0.8), 0, 1), t); },
      cut(t) { g.gain.cancelAndHoldAtTime(t); g.gain.linearRampToValueAtTime(0, t + 0.012); },
      ...extras,
    };
  }
  /** Pitch envelope on a Tone source's detune signal: start `cents` away and settle over `secs`. */
  function bend(src, t, cents, secs, rest = 0) {
    if (!cents || !(secs > 0)) return;
    src.detune.cancelScheduledValues(t);
    src.detune.setValueAtTime(rest + cents, t);
    src.detune.linearRampToValueAtTime(rest, t + secs);
  }
  const wave = (w) => (Array.isArray(w) ? w : S.WAVES[w] || S.WAVES.saw);

  /** A looped-waveform tone with a pitch envelope and delayed vibrato: the lead / brass / flute / organ / pad family. */
  function toneUnit(ctx, dest, vo) {
    const lp = ctx.keep(new Tone.Filter({ frequency: vo.cutoff ?? 5200, type: "lowpass", rolloff: -12 }));
    const vib = ctx.keep(new Tone.Vibrato({ frequency: vo.vibrato?.rate ?? 5.4, depth: 0, maxDelay: 0.005 }));
    const s = ctx.keep(new Tone.Synth({
      oscillator: { type: "custom", partials: wave(vo.wave) },
      envelope: { attack: vo.attack ?? 0.006, decay: vo.decay ?? 0.12, sustain: vo.sustain ?? 0.7, release: vo.release ?? 0.04 },
    }));
    const u = unit(ctx, dest);
    s.chain(lp, vib, u.g);
    const rest = fin(vo.detune, 0); // a constant offset in cents: the doubled, slightly-off second lead
    s.detune.value = rest;
    const vdepth = vo.vibrato?.depth ?? 0, vdelay = vo.vibrato?.delay ?? 0.25;
    u.trigger = (t, m, dur, vel, ev) => {
      const b = ev.bend || vo.bend;
      u.gate(t, vel);
      if (b) bend(s, t, b.cents, b.time, rest);
      if (vdepth) {
        vib.depth.cancelScheduledValues(t);
        vib.depth.setValueAtTime(0, t);
        vib.depth.setValueAtTime(0, t + vdelay);
        vib.depth.linearRampToValueAtTime(vdepth, t + vdelay + 0.2);
      }
      s.triggerAttackRelease(hz(m), dur, t, 1);
    };
    return u;
  }

  // trims (dB) measured like the engine's calibration (tools/calibrate): a sustained note at vel 0.8 near
  // -20 dB RMS, struck voices peaking near -12 dB, drums near -8 dB, so `volume: 0` is a real mix level
  const VOICES = {
    // melodic
    lead: { trim: -7, make: toneUnit, defaults: { wave: "saw", cutoff: 5200, bend: { cents: 45, time: 0.022 }, vibrato: { rate: 5.6, depth: 0.08, delay: 0.3 } } },
    brass: { trim: -5, make: toneUnit, defaults: { wave: "reed", cutoff: 3400, attack: 0.012, decay: 0.15, sustain: 0.6, bend: { cents: -70, time: 0.045 } } },
    flute: { trim: -9.5, make: toneUnit, defaults: { wave: "soft", cutoff: 4000, attack: 0.045, decay: 0.2, sustain: 0.75, release: 0.08, bend: { cents: 25, time: 0.05 }, vibrato: { rate: 5, depth: 0.12, delay: 0.35 } } },
    organ: { trim: -9, make: toneUnit, defaults: { wave: "organ", cutoff: 4500, attack: 0.004, decay: 0.03, sustain: 0.9, release: 0.03 } },
    clarinet: { trim: -7, make: toneUnit, defaults: { wave: "hollow", cutoff: 3600, attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.06, vibrato: { rate: 4.8, depth: 0.06, delay: 0.4 } } },
    pad: { trim: -11, poly: 3, make: toneUnit, defaults: { wave: "glass", cutoff: 3200, attack: 0.12, decay: 0.4, sustain: 0.8, release: 0.3, vibrato: { rate: 0.7, depth: 0.05, delay: 0 } } },
    bell: { trim: -7.5, poly: 2, make: toneUnit, defaults: { wave: "bell", cutoff: 7000, attack: 0.002, decay: 1.2, sustain: 0, release: 0.4 } },

    // a bright pluck with a fast decay (harp / guitar / koto family on the chip)
    pluck: {
      trim: -8, poly: 2,
      defaults: { wave: "glass", cutoff: 6500, decay: 0.26, release: 0.06, bend: { cents: 30, time: 0.009 } },
      make(ctx, dest, vo) {
        const lp = ctx.keep(new Tone.Filter({ frequency: vo.cutoff, type: "lowpass", rolloff: -12 }));
        const s = ctx.keep(new Tone.Synth({ oscillator: { type: "custom", partials: wave(vo.wave) }, envelope: { attack: 0.001, decay: vo.decay, sustain: 0, release: vo.release } }));
        const u = unit(ctx, dest);
        s.chain(lp, u.g);
        u.trigger = (t, m, dur, vel, ev) => { u.gate(t, vel); bend(s, t, (ev.bend || vo.bend).cents, (ev.bend || vo.bend).time); s.triggerAttackRelease(hz(m), Math.min(dur, vo.decay + 0.05), t, 1); };
        return u;
      },
    },

    // bass: a filtered square loop with a thump of pitch envelope and BRR grit by default
    bass: {
      trim: -11,
      defaults: { wave: "square", cutoff: 160, octaves: 2.6, decay: 0.32, sustain: 0.55, release: 0.05, bend: { cents: 25, time: 0.016 }, grit: 6, gritWet: 0.3 },
      make(ctx, dest, vo) {
        const s = ctx.keep(new Tone.MonoSynth({
          oscillator: { type: "custom", partials: wave(vo.wave) },
          filter: { type: "lowpass", rolloff: -24, Q: 1.1 },
          envelope: { attack: 0.003, decay: vo.decay, sustain: vo.sustain, release: vo.release },
          filterEnvelope: { attack: 0.002, decay: 0.14, sustain: 0.35, release: 0.08, baseFrequency: vo.cutoff, octaves: vo.octaves },
        }));
        const u = unit(ctx, dest);
        s.connect(u.g);
        u.trigger = (t, m, dur, vel, ev) => { u.gate(t, vel); const b = ev.bend || vo.bend; bend(s, t, b.cents, b.time); s.triggerAttackRelease(hz(m), dur, t, 1); };
        return u;
      },
    },

    // drums: tuned membranes and swept noise, each one hardware voice
    kick: {
      trim: -3,
      defaults: { note: 36, pitchDecay: 0.04, octaves: 4, decay: 0.3 },
      make(ctx, dest, vo) {
        const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: vo.pitchDecay, octaves: vo.octaves, envelope: { attack: 0.001, decay: vo.decay, sustain: 0, release: 0.05 } }));
        const u = unit(ctx, dest, { hold: () => vo.decay });
        s.connect(u.g);
        u.trigger = (t, m, dur, vel, ev) => { u.gate(t, vel); s.triggerAttackRelease(hz(ev.pitch ?? vo.note), vo.decay * 0.7, t, 1); };
        return u;
      },
    },
    snare: {
      trim: 0,
      defaults: { decay: 0.16, tone: 2600, sweep: 1500, body: 185 },
      make(ctx, dest, vo) {
        const u = unit(ctx, dest, { hold: () => vo.decay + 0.05 });
        const bp = ctx.keep(new Tone.Filter({ frequency: vo.tone, type: "bandpass", Q: 0.8 })).connect(u.g);
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: vo.decay, sustain: 0, release: 0.03 } })).connect(bp);
        const b = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.018, octaves: 1.6, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 } })).connect(u.g);
        b.volume.value = -7;
        u.trigger = (t, m, dur, vel, ev) => {
          u.gate(t, vel);
          bp.frequency.cancelScheduledValues(t);
          bp.frequency.setValueAtTime(vo.tone + vo.sweep, t);
          bp.frequency.exponentialRampToValueAtTime(vo.tone, t + 0.05);
          n.triggerAttackRelease(vo.decay, t, 1);
          b.triggerAttackRelease(vo.body, 0.07, t, 1);
        };
        return u;
      },
    },
    hat: {
      trim: -2,
      defaults: { cutoff: 7000, sweep: 3000, closed: 0.045, open: 0.28 },
      make(ctx, dest, vo) {
        const u = unit(ctx, dest, { hold: (ev) => (ev.open ? vo.open : vo.closed) + 0.02 });
        const hp = ctx.keep(new Tone.Filter({ frequency: vo.cutoff, type: "highpass", rolloff: -12 })).connect(u.g);
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: vo.closed, sustain: 0, release: 0.02 } })).connect(hp);
        u.trigger = (t, m, dur, vel, ev) => {
          const d = ev.open ? vo.open : vo.closed;
          u.gate(t, vel);
          n.envelope.decay = d;
          hp.frequency.cancelScheduledValues(t);
          hp.frequency.setValueAtTime(vo.cutoff + vo.sweep, t);
          hp.frequency.exponentialRampToValueAtTime(vo.cutoff, t + Math.min(0.08, d));
          n.triggerAttackRelease(0.01, t, 1);
        };
        return u;
      },
    },
    tom: {
      trim: -3,
      defaults: { note: 50, pitchDecay: 0.05, octaves: 1.4, decay: 0.34 },
      make(ctx, dest, vo) {
        const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: vo.pitchDecay, octaves: vo.octaves, envelope: { attack: 0.001, decay: vo.decay, sustain: 0, release: 0.05 } }));
        const u = unit(ctx, dest, { hold: () => vo.decay });
        s.connect(u.g);
        u.trigger = (t, m, dur, vel, ev) => { u.gate(t, vel); s.triggerAttackRelease(hz(ev.pitch ?? (typeof m === "number" ? m : vo.note)), vo.decay * 0.8, t, 1); };
        return u;
      },
    },
  };
  S.VOICES = Object.keys(VOICES);

  // ---------- the chip ----------
  S.chip = function (ctx, o = {}) {
    const I = Sim.instruments;
    const N = Math.max(1, o.voices ?? 8);
    const dest = o.dest === undefined ? ctx.out : o.dest;
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? 0)));
    if (dest) out.connect(dest);
    // output stage, last to first: the DAC's band edge (32 kHz-ish), the Gaussian interpolation roll-off
    // that softens everything above ~7 kHz, and a gentle word-length reduction on the whole mix.
    const rate = o.rate ?? 32000;
    const edge = ctx.keep(new Tone.Filter({ frequency: clamp(rate * 0.42, 4000, 20000), type: "lowpass", rolloff: -48 })).connect(out);
    const gauss = ctx.keep(new Tone.Filter({ frequency: o.tone ?? 7200, type: "lowpass", rolloff: -12, Q: 0.5 })).connect(edge);
    const crush = ctx.keep(new Tone.BitCrusher({ bits: clamp(o.bits ?? 8, 4, 16), wet: clamp(o.crush ?? 0.5, 0, 1) })).connect(gauss);
    const bus = ctx.keep(new Tone.Gain(1)).connect(crush);
    // the echo: delay in 16 ms steps like the hardware (0..240 ms), feedback through a dark FIR-ish filter
    const e = o.echo || {};
    const edl = clamp(Math.round((e.time ?? 0.128) / 0.016), 1, 15);
    const echoIn = ctx.keep(new Tone.Gain(1));
    const delay = ctx.keep(new Tone.Delay({ delayTime: edl * 0.016, maxDelay: 0.5 }));
    const fir = ctx.keep(new Tone.Filter({ frequency: e.tone ?? 2400, type: "lowpass", rolloff: -12 }));
    const firHp = ctx.keep(new Tone.Filter({ frequency: e.lowcut ?? 140, type: "highpass" }));
    const fb = ctx.keep(new Tone.Gain(clamp(e.feedback ?? 0.45, 0, 0.9)));
    const echoOut = ctx.keep(new Tone.Gain(db(e.level ?? -6))).connect(bus);
    echoIn.connect(delay); delay.connect(fir); fir.connect(firHp); firHp.connect(fb); fb.connect(delay); firHp.connect(echoOut);

    // the allocator: at most N units sounding; a new note steals the oldest (or quietest) lower-or-equal
    // priority note, or is dropped when everything sounding outranks it
    const steal = o.steal ?? "oldest";
    const slots = [];
    const stats = { stolen: 0, dropped: 0 };
    function alloc(t, end, p, vel, cut) {
      for (let i = slots.length - 1; i >= 0; i--) if (slots[i].end <= t + 1e-4) slots.splice(i, 1);
      if (slots.length >= N) {
        let best = null;
        for (const s of slots) {
          if (s.p > p) continue;
          if (!best || s.p < best.p || (s.p === best.p && (steal === "quietest" ? s.vel < best.vel : s.t < best.t))) best = s;
        }
        if (!best) { stats.dropped++; return null; }
        best.cut(Math.max(t, best.t + 0.005));
        slots.splice(slots.indexOf(best), 1);
        stats.stolen++;
      }
      const s = { t, end, p, vel, cut };
      slots.push(s);
      return s;
    }
    const free = (s) => { const i = slots.indexOf(s); if (i >= 0) slots.splice(i, 1); };

    const chip = { out, bus, echo: echoIn, voices: N, stats: () => ({ ...stats }) };
    chip.voice = function (name, vo = {}) {
      const def = VOICES[name];
      if (!def) throw new Error(`spc: no voice "${name}" (have ${S.VOICES.join(", ")})`);
      const opts = { ...def.defaults, ...vo };
      const trim = ctx.keep(new Tone.Gain(db(fin(opts.volume, 0) + def.trim)));
      const pan = ctx.keep(new Tone.Panner(clamp(fin(opts.pan, 0), -1, 1))).connect(bus);
      trim.connect(pan);
      let dest = trim;
      if (opts.grit) { dest = ctx.keep(new Tone.BitCrusher({ bits: clamp(opts.grit, 3, 12), wet: clamp(opts.gritWet ?? 0.35, 0, 1) })); dest.connect(trim); }
      if (opts.echo > 0) { const send = ctx.keep(new Tone.Gain(clamp(opts.echo, 0, 1))); pan.connect(send); send.connect(echoIn); }
      const K = Math.max(1, Math.round(opts.poly ?? def.poly ?? 1));
      const units = Array.from({ length: K }, () => { const u = def.make(ctx, dest, opts); u.clock = I.monotonic(trim); u.slot = null; u.last = -1; return u; });
      const pri = fin(opts.priority, 1);
      const voice = {
        name, out: pan, units,
        play(time, ev, dur) {
          const notes = ev.note == null || typeof ev.note === "string" ? [null] : arr(ev.note);
          const vel = clamp(fin(ev.vel, 0.8), 0, 1), p = fin(ev.priority, pri);
          for (const m of notes.slice(0, K)) {
            if (m != null && !Number.isFinite(m)) continue;
            let u = units.find((x) => !x.slot || x.slot.end <= time);
            if (!u) u = units.reduce((a, b) => (a.last <= b.last ? a : b));
            if (u.slot) free(u.slot); // its own previous note is over, or retriggered
            const t = u.clock(time);
            const hold = u.hold ? u.hold(ev, dur) : dur + 0.02;
            const slot = alloc(t, t + Math.max(0.02, fin(hold, dur)), p, vel, (tc) => u.cut(tc));
            if (!slot) continue;
            u.slot = slot; u.last = t;
            u.trigger(t, m, Math.max(0.02, fin(dur, 0.1)), vel, ev);
          }
        },
      };
      return voice;
    };
    return chip;
  };

  Sim.spc = S;
})(typeof window !== "undefined" ? window : globalThis);
