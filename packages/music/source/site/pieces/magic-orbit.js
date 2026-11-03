// Magic Orbit: late-70s space disco at 124 BPM, for a dancefloor that has left the atmosphere.
//
// One "orbit" is about 2.7 minutes in a minor key, built like a long Cerrone-style record:
//   launch (sequencer, lasers, a kick in the dark; first orbit only) -> build (layers stack) ->
//   theme (portamento lead with vibrato) -> theme with synth-brass answers -> brass theme (strings
//   through a phaser, a chromatic Ebmaj7#11 that slides onto the dominant) -> peak (everything: tom
//   runs, congas, brass stabs) -> cosmic breakdown (only arpeggiators and pads, the filter closing,
//   lasers) -> second breakdown (bII lydian, then a dominant sus that belongs to a key a minor third
//   up) -> the drums crash back and the theme re-enters in the new key -> brass theme -> peak.
// The next orbit stays in the new key, so the piece climbs by minor thirds: E -> G -> Bb -> C# -> E.
//
// Drums are a disco kit: four-on-the-floor kick with syncopated extra kicks, snare and claps on 2
// and 4, closed 16th hats under open hats on every offbeat, descending tom runs into sections, a
// crash on arrivals, and a conga / shaker / tambourine layer that comes and goes with the form.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4;
  const HOME = 4; // everything below is written in E minor and transposed

  // ---------- harmony (in E minor) ----------
  const PROG_TEXT = {
    LAUNCH: "| Em9 | Em9 | Em9 | Em9 | Cmaj9 | Cmaj9 | D6 | D6 |",
    BUILD: "| Em9 | Em9 | Cmaj9 | D6 | Em9 | Em9 | Cmaj9 | Bsus4:2 B7:2 |",
    A: "| Em9 | D/E | Cmaj7 | D | Em9 | G | Am7 | Bsus4:2 B7:2 |",
    A2: "| Em9 | D/E | Cmaj7 | D | Em9 | G | Am7 | D:2 D7:2 |",
    B: "| Cmaj9 | D6 | Bm7 | Em9 | Cmaj9 | D6 | Ebmaj7#11 | Bsus4:2 B7:2 |",
    COSMIC1: "| Cmaj9#11 | Cmaj9#11 | Em9 | Em9 | Cmaj9#11 | Cmaj9#11 | Am9 | Am9 |",
    COSMIC2: "| Cmaj9#11 | Cmaj9#11 | Em9 | Em9 | Fmaj9#11 | Fmaj9#11 | Dsus4 | D7 |", // D7 = V of G minor
  };
  const PROGS = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v, BPB)]));
  function tSym(sym, n) {
    if (!n) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const nm = (x) => T.NAMES[mod12(T.PC[x] + n)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }

  // ---------- melody notation: one string per bar, "note/beats", r = rest ----------
  function bars(list, startBar = 0) {
    const out = [];
    list.forEach((s, i) => {
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const [n, d] = tok.split("/");
        const dur = Number(d);
        if (!(dur > 0)) throw new Error(`magic-orbit: bad duration in "${tok}"`);
        if (n !== "r") out.push({ beat: (startBar + i) * BPB + b, dur, note: T.midi(n) });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`magic-orbit: bar sums to ${b}: ${s}`);
    });
    return out;
  }

  // The theme (portamento lead): long floating tones that glide, a rising Cmaj7 arpeggio, a held A.
  const THEME_HEAD = ["E5/2.5 B4/0.5 D5/0.5 E5/0.5", "F#5/3 E5/0.5 D5/0.5", "E5/2 G5/1 B5/1", "A5/3 r/1"];
  const THEME = {
    A: bars(THEME_HEAD.concat(["B5/2.5 A5/0.5 G5/0.5 F#5/0.5", "G5/2 D5/2", "E5/1.5 G5/0.5 C5/2", "F#5/2 D#5/1.5 r/0.5"])),
    A2: bars(THEME_HEAD.concat(["B5/2.5 A5/0.5 G5/0.5 F#5/0.5", "G5/1.5 A5/0.5 B5/2", "C6/1.5 B5/0.5 A5/1 E5/1", "F#5/2 D5/1 C5/1"])),
  };
  // The brass theme: a top line the section harmonizes in block chords.
  const BRASS_B = bars(["G5/1.5 E5/0.5 G5/1 B5/1", "A5/3 F#5/1", "F#5/1.5 D5/0.5 F#5/1 A5/1", "G5/3 r/1",
    "G5/1.5 E5/0.5 G5/1 C6/1", "B5/3 A5/1", "Bb5/2 G5/1 D5/1", "E5/2 D#5/1.5 r/0.5"]);
  // Brass answer in the second theme statement, in the gap the lead leaves in bar 4.
  const BRASS_ANS = bars(["r/2.5 E5/0.5 F#5/0.5 G5/0.5"], 3);

  // ---------- arpeggiator shapes (indices into the chord-tone ladder) ----------
  const ARP_PATS = [[0, 4, 2, 4, 1, 4, 2, 4], [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 2, 0, 2, 4, 5], [0, 4, 1, 4, 2, 5, 3, 4]];

  // ---------- form ----------
  // f: layer flags. cut: arp filter arc. nk: in the new key (a minor third up).
  const SEC = {
    launch: { prog: "LAUNCH", kind: "launch", cut: [260, 1500], label: "Launch · sequencer, lasers, the layers stack" },
    build: { prog: "BUILD", kind: "build", cut: [700, 1900], label: "Build · the layers stack" },
    themeA: { prog: "A", kind: "theme", mel: "A", cut: [1500, 1800], label: "Theme · portamento lead" },
    themeA2: { prog: "A2", kind: "theme", mel: "A2", answers: true, cut: [1800, 2100], label: "Theme · synth brass answers" },
    themeB: { prog: "B", kind: "brass", cut: [1700, 1900], label: "Brass theme · string machine through the phaser" },
    peak: { prog: "A", kind: "peak", mel: "A", cut: [2400, 2700], label: "Peak · tom runs, congas, brass stabs" },
    cosmic1: { prog: "COSMIC1", kind: "cosmic", n: 1, cut: [1900, 380], label: "Cosmic breakdown · only arpeggiators and pads" },
    cosmic2: { prog: "COSMIC2", kind: "cosmic", n: 2, cut: [340, 4200], label: "Cosmic breakdown · pulled toward a new key" },
    reentry: { prog: "A", kind: "peak", mel: "A2x", nk: true, reentry: true, cut: [2600, 2400], label: "Re-entry · the drums crash back, a minor third higher" },
    themeBn: { prog: "B", kind: "brass", nk: true, cut: [2000, 2100], label: "Brass theme · in the new key" },
    peakn: { prog: "A", kind: "peak", mel: "A", nk: true, cut: [2600, 2900], label: "Peak · in the new key" },
  };
  const ORBIT = ["build", "themeA", "themeA2", "themeB", "peak", "cosmic1", "cosmic2", "reentry", "themeBn", "peakn"];
  // The first orbit's launch stacks its layers fast and goes straight to the theme; later orbits rebuild.
  function planAt(cycle) {
    if (cycle === 0) return { id: "launch", orbit: 0, ...SEC.launch };
    const k = cycle - 1, first = ORBIT.length - 1;
    if (k < first) return { id: ORBIT[k + 1], orbit: 0, ...SEC[ORBIT[k + 1]] };
    const k2 = k - first, orbit = 1 + Math.floor(k2 / ORBIT.length), id = ORBIT[k2 % ORBIT.length];
    return { id, orbit, ...SEC[id] };
  }
  const keyOf = (plan) => mod12(HOME + 3 * plan.orbit + (plan.nk ? 3 : 0));
  const offOf = (key) => ((mod12(key - HOME) + 6) % 12) - 6; // E 0, G +3, Bb -6, C# -3

  // ---------- drums ----------
  const CONGA = [[0.5, "conga", 0.32, 63], [1.5, "conga", 0.28, 63], [1.75, "conga", 0.24, 66], [2.5, "congaLow", 0.4, 56], [3, "conga", 0.28, 63], [3.5, "congaLow", 0.44, 56]];
  /** One bar of disco drums. f: { kick, sync[], snare, clap, hat, open, shaker, conga, tamb, crash, fill }. */
  function drumBar(push, bar, f) {
    const B = bar * BPB;
    const hit = (b, voice, vel, x = {}) => push("drums", B + b, 0.25, voice, vel, x);
    const fillAt = f.fill === "toms" ? 2 : f.fill === "tomsBar" ? 0 : 4;
    if (f.kick) {
      for (let q = 0; q < 4; q++) if (q < Math.max(fillAt, 3) || f.fill !== "tomsBar") hit(q, "kick", (q === 0 ? 0.9 : 0.82) * f.kick);
      (f.sync || []).forEach((b) => { if (b < fillAt) hit(b, "kick", 0.55 * f.kick); });
    }
    [1, 3].forEach((q) => {
      if (q >= fillAt) return;
      if (f.snare) hit(q, "snare", 0.6 * f.snare);
      if (f.clap) hit(q, "clap", 0.46 * f.clap);
    });
    if (f.hat) for (let i = 0; i < 16; i++) {
      const b = i * 0.25;
      if (b >= fillAt) break;
      if (f.open && i % 4 === 2) continue;
      if (f.hat === 8 && i % 2) continue;
      hit(b, "hatClosed", [0.42, 0.18, 0.3, 0.2][i % 4] * (f.hatV ?? 1));
    }
    if (f.open) [0.5, 1.5, 2.5, 3.5].forEach((b) => { if (b < fillAt) hit(b, "hatOpen", 0.3 * f.open); });
    if (f.shaker) for (let i = 0; i < 16; i++) { if (i * 0.25 < fillAt) hit(i * 0.25, "shaker", (i % 2 ? 0.18 : 0.28) * f.shaker); }
    if (f.conga) CONGA.forEach(([b, v, vel, p]) => { if (b < fillAt) hit(b, v, vel * f.conga, { pitch: p }); });
    if (f.tamb) [1, 3].forEach((q) => { if (q < fillAt) hit(q, "tambourine", 0.38 * f.tamb); });
    if (f.crash) hit(0, "crash", 0.55 * f.crash);
    if (f.fill === "toms") [57, 57, 53, 53, 50, 50, 45, 45].forEach((p, i) => hit(2 + i * 0.25, "tom", 0.36 + i * 0.05, { pitch: p }));
    if (f.fill === "tomsBar") {
      [62, 60, 57, 57, 55, 53, 53, 50, 50, 48, 45, 45, 43, 43, 40, 40].forEach((p, i) => hit(i * 0.25, "tom", 0.26 + 0.42 * i / 15, { pitch: p }));
      hit(3.5, "snare", 0.5); hit(3.75, "snare", 0.62);
    }
  }

  // ---------- custom sources ----------
  /** Laser zaps: a square blip diving from a few kHz to almost nothing. */
  function lasers(ctx) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(Math.pow(10, -15 / 20)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 5000, type: "lowpass" })).connect(out);
    const s = ctx.keep(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.06 } })).connect(lp);
    const mono = I.monotonic(s);
    const ok = (x) => Number.isFinite(x) && x > 20 && x < 15000;
    return {
      out,
      play(t, e) {
        if (!ok(e.f0) || !ok(e.f1) || !(e.len > 0.03 && e.len < 2)) return;
        const tt = mono(t);
        s.frequency.cancelScheduledValues(tt);
        s.triggerAttackRelease(e.f0, e.len, tt, Math.max(0.05, Math.min(1, e.vel)));
        s.frequency.exponentialRampToValueAtTime(e.f1, tt + e.len);
      },
    };
  }
  /** Noise sweeps: risers into arrivals, whooshes after them. */
  function noiseSweep(ctx) {
    const env = ctx.keep(new Tone.Gain(0));
    const bp = ctx.keep(new Tone.Filter({ frequency: 800, type: "bandpass", Q: 2.2 })).connect(env);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(bp);
    const level = Math.pow(10, -15 / 20);
    const fin = (x, d) => (Number.isFinite(x) && x > 40 ? Math.min(x, 12000) : d);
    return {
      out: env,
      play(t, e, d) {
        const f0 = fin(e.f0, 400), f1 = fin(e.f1, 4000), v = Math.max(0, Math.min(1, e.vel || 0)) * level, len = Math.max(0.1, d);
        env.gain.cancelAndHoldAtTime(t); bp.frequency.cancelAndHoldAtTime(t);
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(f1, t + len);
        env.gain.setValueAtTime(e.up ? 0 : v, t);
        if (e.up) { env.gain.linearRampToValueAtTime(v, t + len * 0.96); env.gain.linearRampToValueAtTime(0, t + len + 0.04); }
        else env.gain.linearRampToValueAtTime(0, t + len);
      },
    };
  }

  Sim.register({
    id: "magic-orbit",
    title: "Magic Orbit",
    genre: "Space disco",
    about: "Late-70s space disco that climbs by minor thirds: sequenced arpeggios, a gliding vibrato lead, CS-80 brass and a phased string machine over syncopated disco drums with tom runs, laser zaps, long builds and a cosmic breakdown of pure arps and pads before the drums crash back in a new key.",
    situations: ["party", "explore"],
    energy: 0.75,
    bpm: 124, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 4.5, preDelay: 0.035, lowcut: 300, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 300, highcut: 7500 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.38, highcut: 3200 });
      const space = I.delay(ctx, out, { pingPong: true, time: "4n", feedback: 0.5, highcut: 2400 });

      const lead = I.lead(ctx, { volume: 0, wave: "fatsawtooth", detune: 6, glide: 0.11, base: 520, octaves: 2.3, resonance: 2, sustain: 0.8, release: 0.3, vibrato: 5.2, vibratoDepth: 0.12, vibratoDelay: 0.22 });
      const brass = I.synthBrass(ctx, { volume: -3, attack: 0.05, swell: 0.22, release: 0.5, base: 360, octaves: 3 });
      const strings = I.stringMachine(ctx, { volume: -8, cutoff: 3000, attack: 0.5, release: 1.6 });
      const phaser = ctx.keep(new Tone.Phaser({ frequency: 0.18, octaves: 3.5, baseFrequency: 380, Q: 5, wet: 0.65 }));
      strings.out.connect(phaser);
      const glass = I.glassPad(ctx, { volume: -16, attack: 3, release: 5 });
      const seq = I.analog(ctx, { volume: -9, wave: "sawtooth", resonance: 6, base: 200, octaves: 2.6, attack: 0.003, decay: 0.15, sustain: 0.2, release: 0.1, filterDecay: 0.13 });
      const arp2 = I.pluck(ctx, { volume: -13, wave: "square", cutoff: 900, octaves: 2.5, decay: 0.3, filterDecay: 0.2, resonance: 1.5, release: 0.2 });
      const bass = I.analog(ctx, { volume: -4, wave: "square", glide: 0.012, resonance: 2, base: 120, octaves: 2.6, attack: 0.004, decay: 0.3, sustain: 0.5, release: 0.08, filterDecay: 0.16 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 31, preload: ["kick", "snare", "clap", "hatClosed", "hatOpen", "tom", "crash", "conga", "congaLow", "shaker", "tambourine"] });
      const zap = lasers(ctx), sweep = noiseSweep(ctx);

      const lp = I.place(ctx, lead, 0.04, out), bp = I.place(ctx, brass, -0.12, out), sp = I.place(ctx, { out: phaser }, 0.15, out);
      const gp = I.place(ctx, glass, -0.4, out), qp = I.place(ctx, seq, -0.28, out), a2 = I.place(ctx, arp2, 0.45, out);
      I.place(ctx, bass, 0, out);
      const kp = I.place(ctx, kit, 0, out), zp = I.place(ctx, zap, 0.3, out), wp = I.place(ctx, sweep, -0.1, out);
      I.send(ctx, lp, echo, -12); I.send(ctx, lp, hall, -12);
      I.send(ctx, bp, hall, -9); I.send(ctx, sp, hall, -9); I.send(ctx, gp, hall, -5);
      I.send(ctx, qp, echo, -12); I.send(ctx, qp, hall, -18); I.send(ctx, a2, space, -8); I.send(ctx, a2, hall, -12);
      I.send(ctx, kp, room, -14); I.send(ctx, zp, space, -4); I.send(ctx, zp, hall, -8); I.send(ctx, wp, hall, -5);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        lead: { layer: "melody", play: pl(lead), humanize: { timing: 0.006, vel: 0.04 } },
        brass: { layer: "melody", play: pl(brass), humanize: { timing: 0.008, vel: 0.04 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0.012, vel: 0.03 } },
        glass: { layer: "harmony", play: pl(glass), humanize: { timing: 0, vel: 0 } },
        seq: {
          layer: "texture", humanize: { timing: 0.002, vel: 0.03 },
          play: (t, e, d) => {
            if (Number.isFinite(e.cut)) seq.filterEnvelope.baseFrequency = Math.max(80, Math.min(6000, e.cut));
            seq.filterEnvelope.octaves = e.acc ? 3.3 : 2.5;
            seq.play(t, e.note, d, e.vel);
          },
        },
        arp2: { layer: "texture", play: pl(arp2), humanize: { timing: 0.002, vel: 0.05 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.08 } },
        lasers: { layer: "texture", play: (t, e) => zap.play(t, e), humanize: { timing: 0.01, vel: 0.1 } },
        sweep: { layer: "texture", play: (t, e, d) => sweep.play(t, e, d), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const key = keyOf(plan), off = offOf(key);
      const prog = PROGS[plan.prog].map((h) => ({ ...h, chord: tSym(h.chord, mod12(key - HOME)) }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(b).chord;
      const spans = prog.map((h) => ({ sym: h.chord, start: h.bar * BPB + h.beat, dur: h.dur }));
      const nextFirst = tSym(PROGS[next.prog][0].chord, mod12(keyOf(next) - HOME));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const kind = plan.kind;
      if (state.orbit !== plan.orbit) { state.orbit = plan.orbit; state.arpPat = plan.orbit === 0 ? 0 : (state.arpPat + 1 + r.int(0, 2)) % ARP_PATS.length; }

      /** Strong or long notes become chord tones; others stay in the chord scale. */
      const fit = (n) => {
        const c = T.chord(symAt(n.beat)), pc = mod12(n.note);
        const strong = Math.abs(n.beat - Math.round(n.beat)) < 1e-6 || n.dur >= 1;
        if (strong && !c.pcs.includes(pc) && c.bass !== pc) return T.nearest(n.note, c.pcs);
        if (!strong && !c.scale.includes(pc) && !c.pcs.includes(pc)) return T.nearest(n.note, c.scale);
        return n.note;
      };
      /** Block-chord the brass under a top note: chord tones below it, no seconds, nothing under F3. */
      const block = (note, beat, n = 3) => {
        const c = T.chord(symAt(beat));
        const v = [note];
        for (const m of T.notesIn(c.pcs, note - 10, note - 3).reverse()) { if (v.length >= n) break; if (m >= 53 && v.every((x) => Math.abs(x - m) >= 3)) v.push(m); }
        return v.sort((a, b) => a - b);
      };

      // ================= lead =================
      const leadNotes = [];
      if (plan.mel) {
        const src = plan.mel === "A2x" ? THEME.A : THEME[plan.mel];
        src.forEach((n) => {
          const note = fit({ ...n, note: n.note + off });
          const long = n.dur >= 2;
          const vel = (long ? 0.78 : n.beat % 1 === 0 ? 0.7 : 0.62) * (kind === "peak" ? 1.04 : 1);
          push("lead", n.beat, n.dur * (n.dur >= 1 ? 0.97 : 1.0), note, vel); // legato: notes touch, so the glide connects them
          leadNotes.push({ b: n.beat, e: n.beat + n.dur, note });
        });
      }

      // ================= brass =================
      if (kind === "brass") {
        BRASS_B.forEach((n) => {
          const top = fit({ ...n, note: n.note + off });
          push("brass", n.beat, n.dur * 0.92, block(top, n.beat), (n.beat % BPB === 0 ? 0.62 : 0.54) + (n.dur >= 2 ? 0.04 : 0));
        });
      }
      if (plan.answers) {
        BRASS_ANS.forEach((n) => push("brass", n.beat, n.dur * 0.9, block(fit({ ...n, note: n.note + off }), n.beat), 0.56));
        // bar 8: a low swell on the dominant-seventh under the lead, pushing into the brass theme
        const v = T.voice(symAt(30), { lo: 53, hi: 68, n: 3, prev: state.brassV, top: [62, 68], rng: r });
        state.brassV = v;
        push("brass", 30, 1.9, v, 0.5);
      }
      if (kind === "peak") {
        // stabs on the second bar of each pair, while the lead holds
        [1, 3, 5].forEach((bar) => {
          const pat = plan.reentry && bar === 1 ? [[0, 0.9]] : [[1.5, 0.35], [2.5, 0.35], [3, 0.8]];
          pat.forEach(([b, d]) => {
            const at = bar * BPB + b;
            const held = leadNotes.filter((x) => x.b <= at + 1e-6 && x.e > at).map((x) => x.note);
            const topMax = held.length ? Math.min(...held) - 3 : 72;
            const v = T.voice(symAt(at), { lo: 57, hi: Math.max(66, Math.min(74, topMax)), n: 3, prev: b === 1.5 ? null : state.brassV, top: [67, 73], rng: r });
            state.brassV = v;
            push("brass", at, d, v, b === 3 || d > 0.5 ? 0.6 : 0.5);
          });
        });
      }

      // ================= string machine (phased) and glass =================
      {
        const o = kind === "cosmic" ? { lo: 55, hi: 84, n: 4, top: [76, 83], vel: 0.42 }
          : kind === "brass" ? { lo: 50, hi: 69, n: 4, top: [62, 68], vel: 0.38 }
          : kind === "launch" ? { lo: 52, hi: 72, n: 4, top: [64, 71], vel: 0.3 }
          : { lo: 52, hi: 71, n: 4, top: [64, 70], vel: kind === "peak" ? 0.42 : 0.36 };
        // repeated chords are held, not re-bowed
        const held = [];
        spans.forEach((s) => { const l = held[held.length - 1]; if (l && l.sym === s.sym && !(kind === "launch" && s.start === 16)) l.dur += s.dur; else held.push({ ...s }); });
        held.forEach((s, si) => {
          if (kind === "launch" && s.start < 16) return;
          if (kind === "build" && s.start < 8) return;
          const fresh = si === 0 && kind === "cosmic" && plan.n === 1;
          const v = T.voice(s.sym, { lo: o.lo, hi: o.hi, n: o.n, prev: fresh ? null : state.strV, top: o.top, rng: r });
          // no semitone inside the section (a minor 9th apart is fine): spread the pair by an octave
          for (let guard = 0; guard < 3; guard++) {
            const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
            if (i < 0) break;
            const free = (m) => !v.some((z) => Math.abs(z - m) <= 2);
            if (v[i - 1] - 12 >= 50 && free(v[i - 1] - 12)) v[i - 1] -= 12;
            else if (v[i] + 12 <= o.hi + 3 && free(v[i] + 12)) v[i] += 12;
            else v.splice(i - 1, 1);
            v.sort((x, y) => x - y);
          }
          state.strV = v;
          push("strings", s.start, s.dur - 0.05, v, o.vel);
        });
        if (kind === "cosmic") spans.forEach((s) => {
          const c = T.chord(s.sym);
          const pcs = c.colors.length ? c.colors : [mod12(c.root + 7)];
          const g = T.nearest(state.glassLast ?? 86, [pcs[0]], 81, 91);
          state.glassLast = g;
          push("glass", s.start + 0.5, s.dur - 0.5, g, 0.4);
        });
      }

      // ================= sequencer (16ths) and the dotted-eighth arpeggio =================
      {
        const pat = ARP_PATS[state.arpPat || 0];
        const [c0, c1] = plan.cut;
        const ladder = (sym, base) => {
          const c = T.chord(sym);
          const core = c.intervals.filter((iv) => iv < 12).map((iv) => mod12(c.root + iv));
          return T.notesIn(core, base, base + 30).slice(0, 6);
        };
        for (let s = 0; s < 128; s++) {
          const b = s * 0.25;
          if (kind === "launch" && b < 0) continue;
          if (kind === "cosmic" && plan.n === 2 && b >= 30) break; // the tom run has the last half bar
          const lad = ladder(symAt(b), 50);
          const note = lad[Math.min(pat[s % 8], lad.length - 1)];
          const u = b / 32;
          const cut = Math.round(c0 * Math.pow(c1 / c0, u) * (1 + 0.18 * Math.sin((2 * Math.PI * (cycle * 32 + b)) / 48)));
          const acc = s % 8 === 0 || s % 8 === 3 || s % 8 === 6; // a 3+3+2 accent inside the 16ths
          const vel = acc ? 0.8 : 0.52 + (s % 2 ? 0 : 0.04);
          push("seq", b, acc ? 0.22 : 0.17, note, vel * (kind === "launch" && b < 8 ? 0.85 : 1), { cut, acc, straight: true });
        }
        const arp2On = kind === "cosmic" || kind === "peak" || kind === "brass" || (kind === "build" && true) || plan.answers;
        if (arp2On) {
          const from = kind === "build" ? 16 : 0;
          const shape = [0, 2, 1, 3, 2, 4];
          let k = 0;
          for (let b = from; b < 32 - 0.01; b += 0.75, k++) {
            if (kind === "cosmic" && plan.n === 2 && b >= 30) break;
            const lad = ladder(symAt(b), 67).filter((m) => m <= 86);
            push("arp2", b, 0.5, lad[Math.min(shape[k % shape.length], lad.length - 1)], 0.42 + (k % 4 === 0 ? 0.08 : 0), { straight: true });
          }
        }
      }

      // ================= bass =================
      if (kind !== "cosmic") {
        let last = state.bassLast ?? 40;
        const RIFF = kind === "brass"
          ? [[0, "R", 0.9, 1.3], [1.5, "F", 0.62, 0.4], [2, "O", 0.74, 0.4], [2.5, "R", 0.68, 0.4], [3, "F", 0.7, 0.4], [3.5, "N", 0.64, 0.4]]
          : [[0, "R", 0.9, 0.6], [0.75, "R", 0.5, 0.2], [1, "O", 0.74, 0.4], [1.75, "F", 0.55, 0.2], [2, "R", 0.84, 0.6], [2.75, "R", 0.5, 0.2], [3, "O", 0.74, 0.4], [3.5, "S", 0.64, 0.4]];
        spans.forEach((s, si) => {
          const c = T.chord(s.sym);
          const root = T.nearest(last, [c.bass], 33, 45);
          const nextSym = si + 1 < spans.length ? spans[si + 1].sym : nextFirst;
          const nextC = T.chord(nextSym);
          const fifthIv = c.intervals.find((iv) => iv === 7 || iv === 6 || iv === 8) ?? 7;
          const sev = c.intervals.find((iv) => iv === 10 || iv === 9);
          for (let bs = s.start; bs < s.start + s.dur - 1e-6; bs += BPB) {
            const bar = Math.floor(bs / BPB);
            if (kind === "launch" && bar < 2) continue;
            const sparse = (kind === "launch" && bar < 4) || (kind === "build" && bar < 2);
            RIFF.forEach(([p, deg, vel, d]) => {
              const at = bs + (s.dur < BPB ? p % s.dur : p);
              if (at >= s.start + s.dur - 1e-6 || (s.dur < BPB && p >= s.dur)) return;
              if (sparse && p % 1 !== 0) return;
              let n = root;
              if (deg === "O") n = root + 12;
              else if (deg === "F") n = root + (fifthIv <= 7 ? fifthIv : fifthIv - 12);
              else if (deg === "S") n = sev != null ? root + sev : root + 12;
              else if (deg === "N") {
                const tgt = T.nearest(root, [nextC.bass], 31, 47);
                const sc = c.scale.concat(c.pcs);
                n = [tgt - 1, tgt + 1, tgt - 2, tgt + 2].find((m) => sc.includes(mod12(m))) ?? root + 7;
              }
              push("bass", at, d, n, vel * (sparse ? 0.85 : 1));
            });
          }
          last = root;
        });
        state.bassLast = last;
      }

      // ================= drums =================
      for (let b = 0; b < 8; b++) {
        let f = {};
        const sync = b % 4 === 3 ? [3.75] : b % 2 ? [1.75] : [];
        if (kind === "launch") f = { kick: 1, hat: b >= 1 ? (b >= 3 ? 16 : 8) : 0, hatV: b < 3 ? 0.75 : 0.9, snare: b >= 4 ? 1 : 0, clap: b >= 4 ? 0.8 : 0, open: b >= 6 ? 1 : 0, fill: b === 7 ? "toms" : null };
        else if (kind === "build") f = { kick: 1, sync: b >= 4 ? sync : [], snare: b >= 2 ? 1 : 0, clap: b >= 4 ? 1 : 0, hat: 16, hatV: b < 2 ? 0.7 : 1, open: b >= 4 ? 1 : 0, crash: b === 0 && plan.orbit > 0 ? 0.7 : 0, fill: b === 7 ? "toms" : null };
        else if (kind === "theme") f = { kick: 1, sync, snare: 1, clap: 1, hat: 16, open: 1, shaker: plan.answers ? 1 : 0, crash: b === 0 ? 1 : 0, fill: b === 7 && plan.answers ? "toms" : null };
        else if (kind === "brass") f = { kick: 1, sync, snare: 1, clap: 0.8, hat: 16, open: 1, conga: 1, crash: b === 0 ? 1 : 0, fill: b === 7 ? "toms" : null };
        else if (kind === "peak") f = { kick: 1, sync: b % 2 ? [1.75, 3.75] : [1.75], snare: 1, clap: 1, hat: 16, open: 1, conga: 1, shaker: 1, tamb: 1, crash: b === 0 ? (plan.reentry ? 1.2 : 1) : 0, fill: b === 3 ? "toms" : b === 7 && next.kind !== "cosmic" ? "toms" : null };
        else if (kind === "cosmic") f = plan.n === 2 && b === 7 ? { fill: "tomsBar" } : {};
        drumBar(push, b, f);
      }

      // ================= lasers and sweeps =================
      const zapAt = (abs, vel = 0.5) => push("lasers", abs, 0.5, "zap", vel, { f0: r.range(1600, 4200), f1: r.range(70, 220), len: r.range(0.12, 0.42) });
      if (kind === "launch") [2.5, 9.5, 14, 18.5, 22, 26.5, 29.5].forEach((b) => zapAt(b, 0.5));
      else if (kind === "cosmic") for (let bar = 0; bar < 8; bar++) { if (r.chance(0.7)) zapAt(bar * BPB + r.pick([0.5, 1.5, 2.5, 3.25]), 0.45); if (r.chance(0.3)) zapAt(bar * BPB + r.pick([1, 3]), 0.35); }
      else if (kind === "build") [7.5, 15.5, 23.5, 27.5, 29.5, 31].forEach((b) => zapAt(b, 0.45));
      else [15.5, 31.5].forEach((b) => { if (r.chance(0.6)) zapAt(b, 0.4); });
      if (kind === "launch") push("sweep", 16, 16, "rise", 0.5, { f0: 300, f1: 6000, up: true });
      if (kind === "build") push("sweep", 20, 12, "rise", 0.5, { f0: 300, f1: 7000, up: true });
      if (kind === "cosmic" && plan.n === 1) push("sweep", 0, 10, "whoosh", 0.5, { f0: 7000, f1: 200 });
      if (kind === "cosmic" && plan.n === 2) push("sweep", 8, 24, "rise", 0.62, { f0: 200, f1: 8000, up: true });
      if (kind === "peak" || (kind === "theme" && plan.mel === "A")) push("sweep", 0, 6, "whoosh", 0.4, { f0: 8000, f1: 300 });

      const label = `Orbit ${plan.orbit + 1} · ${T.NAMES[key]} minor · ${plan.label}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
