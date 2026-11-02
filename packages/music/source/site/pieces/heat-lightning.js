// Heat Lightning: a rooftop in late August, nine at night, the air still warm from the tar, a storm flashing
// silently on the horizon that never arrives. Broken beat in 7/8, A dorian, 118 to the pulse.
//
// THE METER. Seven eighths grouped 2+2+3, written with the eighth as the beat (beatsPerBar 7, bpm 236).
// The groove is half a bar of funk with the last step stretched: kick on 1 and 3, the snare on 5, the first
// step of the three-group, where a 4/4 ear expects the backbeat and gets it a hair late. Hats run the eighths
// and the open hat sits on 7, the exhale before the downbeat. You nod on the kick and the snare and the
// long step takes care of itself; nobody has to count.
//
// THE HOOK (A, 8 bars, fixed by hand; the generator never regenerates these notes). Two rhythmic cells alternate
// every bar: a rising one (1+1+2+3) that lands its long note on the snare, and a falling one (2+1+1+3).
//   bar 1  A4 C5 E5~ G5~~          (the cell: an arpeggio up to the seventh, landing on the lurch)
//   bar 2  F#5~ E5 D5 B4~~         (the answer falls from the dorian sixth, the note that tells you the key)
//   bar 3  A4 C5 E5~ G5~~          (the same cell over F lydian: now 3 5 7 9)
//   bar 4  B5~ A5 G5 E5~~          (the answer a fourth higher: the #11 of F on the downbeat, the flash)
//   bar 5  E5 G5 A5~ C6~~          (the cell climbs: the top of the arc)
//   bar 6  B5~ A5 G5 F#5~~         (the answer leaves the sixth hanging over A minor)
//   bar 7  F5~ E5 D5 C5~~          (over Bb lydian, bII: the melody starts a long descent)
//   bar 8  D5 C5 B4~ G#4~~         (that descent reaches the leading tone, held on the lurch, resolving to the pickup A)
// Harmony: | Am9 | Am9 | Fmaj7#11 | Fmaj7#11 | Am9 | Am9 | Bbmaj7#11 | E7b9#9 |
// The counter-line (A4): a diatonic sixth below each note of the hook, written out so every landing is a true chord
// tone; the last bar leaves the sixths for thirds, and the seventh of E7 falls to the third of A minor.
//
// THE B THEME (8 bars): long notes only, two per bar (4+3), the same gesture (third falling to ninth) planed
// through major-ninth chords a minor third and then two fourths apart, C, Eb, Ab, Db: the lightning, four flashes
// each in a different place. Db climbs a half step to Dm11, iv to V, and the hook's own descent brings A minor back.
//   E5~~~ D5~~ | G5~~~ F5~~ | C6~~~ Bb5~~ | G5~~~ F5~~ | E5~~~ F5~~ | G5~ F5 E5 D5~~ | E5~ C5~ A4~~ | . . . . G4 G#4~ |
// Harmony: | Cmaj9 | Ebmaj9 | Abmaj9 | Dbmaj7#11 | Dm11 | E7b9#9 | Am9 | Am9 E7b9#9 |
//
// FORM (one lap, 8 cycles of 8 bars, about 1:54): A alone over the riff · A with the pad · B in half time ·
// A in octaves with congas · breakdown (kick, hats, bass; the two glass voices trade halves of the cell) ·
// B full · A in sixths, everything in · tag (the descent twice, two bars of nothing but the flashes, the run back).
// Per cycle the generator chooses only arrangement: kick figures, hat density, ghost notes, fills, pad rhythm and
// voicings, bass pattern, grace notes, where the flashes fall. The tunes above never change.
//
// PALETTE (built here, not the stock orchestra): an FM "glass" lead whose modulation index spikes on the attack and
// falls away, so every note begins as a flash and ends as a sine; a second glass voice, darker, for the counter-line;
// an amber pad of three detuned saws under a slowly breathing lowpass and chorus; a round bass (a resonant saw with a
// short filter envelope over a sine); the stock kit; and the lightning itself: a pink-noise swell whose bandpass
// sweeps down as it fades, with a high sine ping on a chord tone that goes into a dotted-quarter delay the lead
// shares. In seven, a three-eighth delay drifts across the bar and comes round every three bars.
(function () {
  "use strict";
  const T = Sim.theory;
  const I = Sim.instruments;
  const BPB = 7; // eighths, grouped 2+2+3
  const BPM = 236; // eighths per minute: a 118 pulse with a long third step
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);
  const arr = (n) => (Array.isArray(n) ? n : [n]);

  // ---------- notation: "A4/1 C5/1 E5/2 G5/3" one bar per entry, durations in eighths, bars must sum to 7 ----------
  function line(bars) {
    const out = [];
    bars.forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`heat-lightning: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ bar: bi, beat: pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`heat-lightning: bar ${bi + 1} has ${pos} eighths: ${bar}`);
    });
    return out;
  }

  // ---------- the music ----------
  const A = {
    harm: ["Am9", "Am9", "Fmaj7#11", "Fmaj7#11", "Am9", "Am9", "Bbmaj7#11", "E7b9#9"],
    lead: [
      "A4/1 C5/1 E5/2 G5/3", //   the cell
      "F#5/2 E5/1 D5/1 B4/3", //  the answer, from the dorian sixth
      "A4/1 C5/1 E5/2 G5/3", //   the cell over F lydian
      "B5/2 A5/1 G5/1 E5/3", //   the answer a fourth up: the #11 on the downbeat
      "E5/1 G5/1 A5/2 C6/3", //   the cell climbs
      "B5/2 A5/1 G5/1 F#5/3", //  the answer leaves the sixth hanging
      "F5/2 E5/1 D5/1 C5/3", //   the descent begins over bII
      "D5/1 C5/1 B4/2 G#4/3", //  and lands on the leading tone
    ],
    sixths: [ // the counter-line: a sixth below, thirds in the last bar
      "C4/1 E4/1 G4/2 B4/3",
      "A4/2 G4/1 F#4/1 D4/3",
      "C4/1 E4/1 G4/2 B4/3",
      "D5/2 C5/1 B4/1 G4/3",
      "G4/1 B4/1 C5/2 E5/3",
      "D5/2 C5/1 B4/1 A4/3",
      "A4/2 G4/1 F4/1 E4/3",
      "B4/1 A4/1 G#4/2 D4/3", // thirds, then the seventh of E7 falling to the third of Am
    ],
  };
  const B = {
    harm: ["Cmaj9", "Ebmaj9", "Abmaj9", "Dbmaj7#11", "Dm11", "E7b9#9", "Am9", [["Am9", 4], ["E7b9#9", 3]]],
    lead: [
      "E5/4 D5/3", //             third to ninth
      "G5/4 F5/3", //             the same, a minor third up
      "C6/4 Bb5/3", //            and up a fourth
      "G5/4 F5/3", //             the fourth flash breaks the pattern: #11 to third
      "E5/4 F5/3", //             the gesture inverted over iv
      "G5/2 F5/1 E5/1 D5/3", //   the altered dominant, in the answer's rhythm
      "E5/2 C5/2 A4/3", //        home, through the hook's own notes
      "r/4 G4/1 G#4/2", //        the pickup: a chromatic climb into the hook
    ],
  };
  const TAG = {
    harm: ["Bbmaj7#11", "E7b9#9", "Bbmaj7#11", "E7b9#9", "Am9", "Am9", "Fmaj7#11", "E7b9#9"],
    lead: [
      "F5/2 E5/1 D5/1 C5/3", "D5/1 C5/1 B4/2 G#4/3",
      "F5/2 E5/1 D5/1 C5/3", "D5/1 C5/1 B4/2 G#4/3",
      "r/7", "r/7", "r/7", "r/2 D5/1 B4/1 G#4/3",
    ],
  };
  for (const s of [A, B, TAG]) { s.notes = line(s.lead); if (s.sixths) s.sixthNotes = line(s.sixths); }
  // PAD VOICINGS, by hand (rootless; the bass has the root). Am9 and Fmaj7#11 share three notes, so the pad barely
  // moves while the bass changes what the chord means; the dominant stacks G# D F B, both ninths kept above the
  // third when the B theme sings G over it, and resolves to Am9 by three half steps and a common tone. The B theme's
  // ninth chords plane up a minor third and then fold down an octave so the pad never climbs into the lead.
  const PAD = {
    Am9: ["G3", "C4", "E4", "B4"], "Fmaj7#11": ["A3", "C4", "E4", "B4"], "Bbmaj7#11": ["F3", "D4", "E4", "A4"], "E7b9#9": ["G#3", "D4", "F4", "B4"],
    "E7b9#9 low": ["G#3", "B3", "D4", "F4"], //  under the hook's descent, which passes through C a step above the pad's B
    Cmaj9: ["B3", "D4", "E4", "G4"], Ebmaj9: ["D4", "F4", "G4", "Bb4"], Abmaj9: ["G3", "C4", "Eb4", "Bb4"], "Dbmaj7#11": ["F3", "C4", "Eb4", "G4"], Dm11: ["F3", "C4", "G4", "A4"],
  };
  for (const k of Object.keys(PAD)) PAD[k] = PAD[k].map(T.midi);

  const LAP = ["A1", "A2", "B1", "A3", "BRK", "B2", "A4", "TAG"];
  const NAMES = {
    A1: "A · the hook over the riff", A2: "A · the pad comes in", B1: "B · the flashes, half time", A3: "A · in octaves, congas",
    BRK: "breakdown · the glass voices trade halves", B2: "B · full", A4: "A · in sixths, everything in", TAG: "tag · the descent, the breath, the run back",
  };

  // ---------- the palette ----------
  function glassLead(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const hp = ctx.keep(new Tone.Filter({ frequency: 160, type: "highpass" })).connect(out);
    const s = ctx.keep(new Tone.FMSynth({
      harmonicity: o.harmonicity ?? 2, modulationIndex: o.index ?? 9,
      oscillator: { type: "sine" }, modulation: { type: o.modType ?? "triangle" },
      envelope: { attack: 0.004, decay: 0.18, sustain: 0.55, release: 0.24 },
      modulationEnvelope: { attack: 0.002, decay: o.flashDecay ?? 0.14, sustain: 0.1, release: 0.2 },
    })).connect(hp);
    const mono = I.monotonic(out);
    return { out, play(time, note, dur, vel) { s.triggerAttackRelease(T.hz(note), Math.max(0.05, dur - 0.02), mono(time), vel); } };
  }
  function amberPad(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const chorus = ctx.keep(new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.45, wet: 0.45 }).start()).connect(out);
    const lp = ctx.keep(new Tone.Filter({ frequency: 1300, type: "lowpass", rolloff: -24, Q: 0.7 })).connect(chorus);
    const lfo = ctx.keep(new Tone.LFO({ frequency: 0.055, min: 850, max: 1700 }).start());
    lfo.connect(lp.frequency);
    const s = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 12, options: {
      oscillator: { type: "fatsawtooth", count: 3, spread: 14 },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.7, release: 0.7 },
    } })).connect(lp);
    return {
      out,
      play(time, notes, dur, vel, attack) {
        s.set({ envelope: { attack: attack ?? 0.08 } });
        s.triggerAttackRelease(arr(notes).map(T.hz), Math.max(0.1, dur - 0.03), time, vel);
      },
    };
  }
  function roundBass(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 2400, type: "lowpass" })).connect(out);
    const s = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 2.2, rolloff: -24 },
      filterEnvelope: { attack: 0.004, decay: 0.16, sustain: 0.22, release: 0.1, baseFrequency: 100, octaves: 3.2 },
      envelope: { attack: 0.004, decay: 0.12, sustain: 0.8, release: 0.06 },
    })).connect(lp);
    const subGain = ctx.keep(new Tone.Gain(db(o.sub ?? -5))).connect(out);
    const sub = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.9, release: 0.05 } })).connect(subGain);
    const m1 = I.monotonic(out), m2 = I.monotonic(out);
    return {
      out,
      play(time, note, dur, vel) {
        const d = Math.max(0.05, dur - 0.02);
        s.triggerAttackRelease(T.hz(note), d, m1(time), vel);
        sub.triggerAttackRelease(T.hz(note), d, m2(time), vel * 0.9);
      },
    };
  }
  function lightning(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const bp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 1.5 })).connect(out);
    const noise = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.03, decay: 0.42, sustain: 0, release: 0.1 } })).connect(bp);
    const pingGain = ctx.keep(new Tone.Gain(db(o.ping ?? -3))).connect(out);
    const ping = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.9 } })).connect(pingGain);
    const mn = I.monotonic(out), mp = I.monotonic(out);
    return {
      out,
      flash(time, vel) {
        const t = mn(time);
        bp.frequency.cancelScheduledValues(t);
        bp.frequency.setValueAtTime(5200, t);
        bp.frequency.exponentialRampToValueAtTime(480, t + 0.45);
        noise.triggerAttackRelease(0.4, t, vel);
      },
      spark(time, note, vel) { ping.triggerAttackRelease(T.hz(note), 0.6, mp(time), vel); },
    };
  }

  Sim.register({
    id: "heat-lightning",
    title: "Heat Lightning",
    genre: "Broken beat in seven",
    about: "A rooftop in late August with a storm flashing on the horizon that never arrives. 7/8 grouped 2+2+3 at 118 to the pulse: kick on one and three, the snare a step late, an open hat before every downbeat. An FM glass lead plays a hand-written hook in A dorian over Fmaj7#11 and a Bbmaj7#11 flash; the B theme planes two long notes a bar through C, Eb, Ab and Db major ninths. Breakdown, sixths, a tag with two bars of nothing but the lightning.",
    situations: ["hangout", "party"],
    energy: 0.55,
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    strongBeats: [0, 2, 4],

    instruments(ctx) {
      const { out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.015, lowcut: 300, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: (3 * 60) / BPM, feedback: 0.42, highcut: 2600 }); // three eighths
      const lead = glassLead(ctx, { volume: -13, harmonicity: 2, index: 9 });
      const lead2 = glassLead(ctx, { volume: -17, harmonicity: 1, index: 5, modType: "sine", flashDecay: 0.1 });
      const pad = amberPad(ctx, { volume: -23 });
      const bass = roundBass(ctx, { volume: -13, sub: -4 });
      const kit = I.kit(ctx, { volume: -3, preload: ["kick", "snare", "rim", "hatClosed", "hatOpen", "hatPedal"] });
      const sky = lightning(ctx, { volume: -22, ping: -2 });
      const L = I.place(ctx, lead, -0.12, out), L2 = I.place(ctx, lead2, 0.28, out), P = I.place(ctx, pad, 0.1, out);
      I.place(ctx, bass, 0, out); const K = I.place(ctx, kit, 0.05, out); const S = I.place(ctx, sky, -0.35, out);
      I.send(ctx, L, echo, -13); I.send(ctx, L, room, -18);
      I.send(ctx, L2, echo, -16); I.send(ctx, L2, room, -18);
      I.send(ctx, P, room, -14);
      I.send(ctx, K, room, -24);
      I.send(ctx, S, echo, -6); I.send(ctx, S, room, -10);
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        glass: { layer: "harmony", play: (t, e, d) => lead2.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.06 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel, e.attack), humanize: { timing: 0.008, vel: 0.05 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        kit: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.004, vel: 0.06 } },
        flash: { layer: "texture", play: (t, e) => sky.flash(t, e.vel), humanize: { timing: 0.02, vel: 0.1 } },
        spark: { layer: "texture", play: (t, e) => sky.spark(t, e.note, e.vel), humanize: { timing: 0.02, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const lap = Math.floor(cycle / LAP.length), idx = cycle % LAP.length, kind = LAP[idx];
      const secOf = (k) => (k === "TAG" ? TAG : k === "B1" || k === "B2" ? B : A);
      const sec = secOf(kind);
      const ev = [];
      const push = (track, bar, beat, dur, note, vel, extra) => {
        if (bar < 0 || bar >= 8) return;
        ev.push({ track, bar, beat: +beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const harmony = [];
      sec.harm.forEach((h, bar) => {
        if (typeof h === "string") harmony.push({ bar, beat: 0, dur: BPB, chord: h });
        else { let b = 0; for (const [c, d] of h) { harmony.push({ bar, beat: b, dur: d, chord: c }); b += d; } }
      });
      const chordAt = (bar, beat) => { let cur = null; for (const h of harmony) if (h.bar === bar && h.beat <= beat + 1e-6) cur = h; return T.chord(cur.chord); };

      // ---- the lap's plan: arrangement only, drawn once per lap ----
      if (idx === 0 || !state.plan) {
        state.plan = {
          kick: lap === 0 ? "plain" : r.pick(["plain", "pickup", "push", "pickup"]), // the kick figure of the lap
          bassA: lap === 0 ? "riff" : r.pick(["riff", "riff", "walk"]),
          padA: r.pick(["push", "hold"]),
          ghosts: lap === 0 ? 0.3 : r.range(0.25, 0.55),
          graces: lap === 0 ? 0.25 : r.range(0.3, 0.5),
          tagBreath: lap === 0 ? true : r.chance(0.7), // the two empty bars of the tag
          a1Drums: lap === 0 ? 4 : r.pick([0, 2, 4]), // bar where the snare joins in A1
          b1Half: lap === 0 ? true : r.chance(0.75),
          congas: lap === 0 ? "late" : r.pick(["late", "early"]),
        };
      }
      const P = state.plan;

      // ================= lead: the tune =================
      const playTune = (notes, track, { gain = 1, octave = 0, graces = 0, skip = null } = {}) => {
        notes.forEach((n, i) => {
          if (skip && skip(n, i)) return;
          const cellBar = sec.lead[n.bar].split(/\s+/)[0].endsWith("/1"); // the rising cell starts with two short notes
          const landing = n.beat === 4 && n.dur === 3;
          let vel = 0.62 + (landing ? 0.16 : 0) + (n.beat === 0 ? 0.06 : 0) + (!cellBar && n.beat === 0 ? 0.04 : 0) + (sec === B ? 0.04 : 0);
          vel *= gain;
          let at = n.beat, dur = n.dur;
          // a grace note a scale step below the landing, stolen from the end of the previous note
          if (landing && graces && r.chance(graces) && track === "lead") {
            const below = T.step(n.note, -1, chordAt(n.bar, n.beat).scale);
            const prev = ev.filter((e) => e.track === track && e.bar === n.bar && e.beat + e.dur > at - 0.5 + 1e-6 && e.beat < at);
            prev.forEach((e) => { e.dur = Math.max(0.5, at - 0.5 - e.beat); });
            push(track, n.bar, at - 0.5, 0.45, below + octave, vel - 0.2);
          }
          push(track, n.bar, at, dur, n.note + octave, vel);
        });
      };
      if (kind === "A1") playTune(sec.notes, "lead", { gain: 0.96 });
      if (kind === "A2") playTune(sec.notes, "lead", { graces: P.graces * 0.5 });
      if (kind === "A3") { playTune(sec.notes, "lead", { graces: P.graces }); playTune(sec.notes, "glass", { gain: 0.8, octave: -12 }); }
      if (kind === "A4") {
        playTune(sec.notes, "lead", { gain: 1.04, graces: P.graces });
        sec.sixthNotes.forEach((n) => push("glass", n.bar, n.beat, n.dur, n.note, 0.58 + (n.beat === 4 ? 0.1 : 0)));
      }
      if (kind === "B1") playTune(sec.notes, "lead", { gain: 0.95 });
      if (kind === "B2") { playTune(sec.notes, "lead"); playTune(sec.notes, "glass", { gain: 0.78, octave: -12, skip: (n) => n.bar === 7 }); }
      if (kind === "BRK") {
        // the two glass voices trade halves of the cell: the lead opens a bar, the darker voice lands it
        const bars = new Set([0, 4, ...[1, 2, 3, 5, 6].filter(() => r.chance(0.45))]);
        sec.notes.forEach((n) => {
          const landing = n.beat === 4;
          if (n.bar === 7) { if (landing) push("glass", n.bar, 4, 3, n.note - 12, 0.6); return; }
          if (bars.has(n.bar) && !landing) push("lead", n.bar, n.beat, n.dur, n.note, 0.6 + (n.beat === 0 ? 0.05 : 0));
          if (landing && (!bars.has(n.bar) || r.chance(0.5))) push("glass", n.bar, 4, 3, n.note - (bars.has(n.bar) ? 0 : 12), 0.56);
        });
      }
      if (kind === "TAG") playTune(sec.notes, "lead", { gain: 1.02, graces: P.graces * 0.6 });

      // ================= pad =================
      const padOn = ["A2", "A3", "A4", "B1", "B2", "TAG"].includes(kind);
      if (padOn) {
        const pattern = sec === B ? "swell" : kind === "A4" ? "stab" : kind === "TAG" ? "push" : P.padA;
        for (const h of harmony) {
          if (kind === "TAG" && h.bar >= 4 && h.bar < 6) continue;
          if (kind === "TAG" && h.bar === 6) { continue; }
          const v = (sec === B && h.bar < 7 ? PAD[h.chord] : PAD[`${h.chord} low`]) || PAD[h.chord];
          if (!v) throw new Error(`heat-lightning: no pad voicing for ${h.chord}`);
          const vel = 0.5;
          if (pattern === "swell") push("pad", h.bar, h.beat, h.dur, v, vel + (h.bar === 3 ? 0.08 : 0), { attack: h.dur >= 4 ? 0.35 : 0.08 });
          else if (pattern === "hold") push("pad", h.bar, h.beat, h.dur, v, vel - 0.04, { attack: 0.12 });
          else if (pattern === "push") { if (h.dur >= 7) { push("pad", h.bar, 0, 3.6, v, vel - 0.04); push("pad", h.bar, 4, 2.8, v, vel + 0.06); } else push("pad", h.bar, h.beat, h.dur - 0.2, v, vel); }
          else if (pattern === "stab") {
            if (h.dur >= 7) { push("pad", h.bar, 0, 1.2, v, vel + 0.04, { attack: 0.01 }); push("pad", h.bar, 4, 1.2, v, vel + 0.1, { attack: 0.01 }); if (h.bar % 2 === 1) push("pad", h.bar, 6, 0.9, v, vel - 0.06, { attack: 0.01 }); }
            else push("pad", h.bar, h.beat, 1.2, v, vel + 0.04, { attack: 0.01 });
          }
        }
      }

      // ================= bass =================
      const bassOf = (bar, beat) => {
        const c = chordAt(bar, beat);
        const root = T.nearest(40, [c.bass], 36, 47); // E2..B2
        const fifth = root + 7 <= 50 ? root + 7 : root - 5;
        const sev = c.intervals.find((i) => i === 10 || i === 11) ?? 9;
        const seventh = root + sev;
        const oct = root + 12;
        const scale = new Set(c.scale.concat(c.pcs));
        const nextSec = secOf(LAP[(idx + 1) % LAP.length]);
        const nb = bar + 1 < 8 ? chordAt(bar + 1, 0) : T.chord(nextSec.harm[0]);
        const nroot = T.nearest(root, [nb.bass], 36, 47);
        const approach = [nroot - 1, nroot + 1, nroot - 2].find((m) => scale.has(mod12(m))) ?? fifth;
        return { root, fifth, seventh, oct, approach, scale };
      };
      for (let bar = 0; bar < 8; bar++) {
        const n = bassOf(bar, 0);
        const vb = 0.82;
        const bp = (beat, dur, m, vel) => push("bass", bar, beat, dur, m, vel);
        const last = bar === 7;
        if (kind === "TAG" && bar >= 4 && bar < 6) { if (P.tagBreath) { bp(0, 6.8, n.root, vb - 0.08); continue; } }
        const split = harmony.filter((h) => h.bar === bar).length > 1; // the bar with two chords
        if (sec === B) {
          if (split) { bp(0, 3.8, n.root, vb); const m = bassOf(bar, 4); bp(4, 2, m.root, vb - 0.04); bp(6, 1, m.approach, vb - 0.1); }
          else if (kind === "B1" && P.b1Half) { bp(0, 3.8, n.root, vb); bp(4, 1.8, n.fifth, vb - 0.1); bp(6, 1, last ? n.approach : n.root, vb - 0.12); }
          else { bp(0, 1.8, n.root, vb); bp(2, 1, n.root, vb - 0.14); bp(3, 1, n.fifth, vb - 0.1); bp(4, 1.8, n.root, vb - 0.02); bp(6, 1, n.approach, vb - 0.1); }
          continue;
        }
        const pattern = kind === "BRK" ? (P.bassA === "walk" ? "riff" : "walk") : kind === "A1" ? "riff" : P.bassA;
        if (pattern === "riff") { // root root fifth . seventh octave: the last two lean into the downbeat
          bp(0, 1.8, n.root, vb + 0.04); bp(2, 0.9, n.root, vb - 0.1); bp(3, 0.9, n.fifth, vb - 0.08);
          bp(5, 0.9, n.seventh, vb - 0.06); bp(6, 0.9, last || r.chance(0.5) ? n.approach : n.oct, vb - 0.02);
          if (r.chance(P.ghosts * 0.6)) bp(4.5, 0.4, n.root, vb - 0.4); // a ghost after the snare
        } else { // walk: the root held through the kicks, a run up through the three-group
          bp(0, 2.8, n.root, vb + 0.04); bp(3, 0.9, n.fifth, vb - 0.1);
          bp(4, 0.9, n.seventh, vb - 0.04); bp(5, 0.9, n.oct, vb - 0.08); bp(6, 0.9, n.approach, vb - 0.04);
        }
      }

      // ================= drums =================
      const hit = (bar, beat, voice, vel, pitch) => push("kit", bar, beat, voice === "hatOpen" ? 1 : 0.5, voice, vel, pitch != null ? { pitch } : undefined);
      const fill = (bar, kindOf) => {
        if (kindOf === "snares") [5, 5.5, 6, 6.5].forEach((b, i) => hit(bar, b, "snare", 0.42 + i * 0.13));
        else if (kindOf === "toms") { hit(bar, 4, "snare", 0.8); hit(bar, 4.5, "tom", 0.6, 52); hit(bar, 5, "tom", 0.62, 48); hit(bar, 5.5, "tom", 0.66, 45); hit(bar, 6, "tom", 0.7, 41); hit(bar, 6.5, "snare", 0.5); }
        else if (kindOf === "stutter") { hit(bar, 4, "snare", 0.8); hit(bar, 4.5, "kick", 0.6); hit(bar, 5, "kick", 0.7); hit(bar, 5.5, "snare", 0.5); hit(bar, 6, "hatOpen", 0.6); hit(bar, 6.5, "snare", 0.7); }
        else if (kindOf === "drop") { hit(bar, 4, "snare", 0.85); }
      };
      const kickFigure = (bar, vel = 0.9) => {
        hit(bar, 0, "kick", vel); hit(bar, 2, "kick", vel - 0.12);
        if (P.kick === "pickup" && (bar % 2 === 1 || r.chance(0.3))) hit(bar, 6, "kick", vel - 0.25);
        if (P.kick === "push" && r.chance(0.6)) hit(bar, 5, "kick", vel - 0.22);
        if (P.kick === "plain" && bar % 4 === 3 && r.chance(0.5)) hit(bar, 6, "kick", vel - 0.3);
      };
      const hats = (bar, { sixteenths = false, gain = 1, openEnd = true } = {}) => {
        for (let b = 0; b < 7; b++) {
          if (b === 6 && openEnd && (bar % 2 === 1 || r.chance(0.35))) { hit(bar, 6, "hatOpen", 0.5 * gain); continue; }
          hit(bar, b, "hatClosed", (b % 2 === 0 ? (b === 0 ? 0.6 : 0.52) : 0.34) * gain);
          if (sixteenths && b >= 4) hit(bar, b + 0.5, "hatClosed", 0.26 * gain);
          else if (sixteenths && r.chance(0.25)) hit(bar, b + 0.5, "hatClosed", 0.22 * gain);
        }
      };
      const snareOn = (bar, vel = 0.85, voice = "snare") => {
        hit(bar, 4, voice, vel);
        if (r.chance(P.ghosts)) hit(bar, 3, "rim", 0.28);
        if (r.chance(P.ghosts * 0.7)) hit(bar, 6.5, "snare", 0.2);
      };
      const congas = (bar) => { hit(bar, 1, "conga", 0.46); hit(bar, 3, "congaLow", 0.52); hit(bar, 5, "conga", 0.56); if (r.chance(0.6)) hit(bar, 5.5, "conga", 0.36); if (bar % 4 === 3) hit(bar, 6.5, "bongo", 0.4); };
      const shaker = (bar) => { for (let b = 0; b < 7; b += 0.5) hit(bar, b, "shaker", b % 1 === 0 ? 0.3 : 0.4); };
      const lastBar = (bar) => bar === 7;
      const fillKind = r.pick(["snares", "toms", "stutter"]);
      for (let bar = 0; bar < 8; bar++) {
        if (kind === "A1") {
          kickFigure(bar, 0.84);
          hats(bar, { gain: 0.85, openEnd: bar >= 2 });
          if (bar >= P.a1Drums) snareOn(bar, 0.78); else hit(bar, 4, "rim", 0.6);
          if (lastBar(bar)) fill(bar, "snares");
        } else if (kind === "A2" || kind === "A3") {
          if (bar === 0 && (kind === "A3" || lap > 0)) hit(bar, 0, "crash", 0.5);
          kickFigure(bar);
          hats(bar, { sixteenths: kind === "A3" && bar >= 4 });
          if (lastBar(bar)) fill(bar, fillKind); else snareOn(bar);
          if (kind === "A3" && (P.congas === "early" || bar >= 4)) congas(bar);
        } else if (kind === "B1") {
          if (P.b1Half) { // half time: the kick and the snare alone, hats pedalled on the two-groups
            hit(bar, 0, "kick", 0.9); hit(bar, 4, "snare", 0.9); hit(bar, 2, "hatPedal", 0.4); hit(bar, 5, "hatPedal", 0.35);
            if (bar % 2 === 1) hit(bar, 6, "hatOpen", 0.4);
            if (bar >= 6) hit(bar, 2, "kick", 0.7);
          } else { kickFigure(bar, 0.86); hats(bar, { gain: 0.9 }); snareOn(bar, 0.82); }
          if (lastBar(bar)) fill(bar, "toms");
        } else if (kind === "BRK") {
          kickFigure(bar, 0.9);
          hats(bar, { gain: 0.9, openEnd: false });
          if (bar >= 5) hit(bar, 4, "snare", 0.5 + (bar - 5) * 0.15); else if (r.chance(0.4)) hit(bar, 4, "rim", 0.4);
          if (bar >= 6) hit(bar, 6, "hatOpen", 0.5);
          if (lastBar(bar)) fill(bar, "snares");
        } else if (kind === "B2") {
          if (bar === 0) hit(bar, 0, "crash", 0.55);
          kickFigure(bar);
          hats(bar, { sixteenths: true });
          if (lastBar(bar)) fill(bar, "stutter"); else { snareOn(bar, 0.86); hit(bar, 4, "clap", 0.5); }
          if (bar >= 4) shaker(bar);
        } else if (kind === "A4") {
          if (bar === 0) hit(bar, 0, "crash", 0.6);
          kickFigure(bar);
          hats(bar, { sixteenths: true });
          if (lastBar(bar)) fill(bar, fillKind); else { snareOn(bar, 0.9); hit(bar, 4, "clap", 0.42); }
          congas(bar); shaker(bar);
          hit(bar, 4, "tambourine", 0.45); hit(bar, 6, "tambourine", 0.38);
        } else if (kind === "TAG") {
          if (bar < 4) { kickFigure(bar); hats(bar, { sixteenths: bar >= 2 }); if (bar === 3) fill(bar, "drop"); else snareOn(bar, 0.88); congas(bar); }
          else if (bar < 6) { if (!P.tagBreath) { hit(bar, 0, "kick", 0.8); hit(bar, 4, "rim", 0.5); hit(bar, 2, "hatPedal", 0.35); hit(bar, 5, "hatPedal", 0.35); } }
          else if (bar === 6) { kickFigure(bar, 0.86); hats(bar, { gain: 0.85, openEnd: false }); hit(bar, 4, "rim", 0.6); }
          else { kickFigure(bar, 0.9); hats(bar, { openEnd: false }); fill(bar, r.pick(["snares", "toms"])); }
        }
      }

      // ================= the lightning =================
      const flashRate = kind === "BRK" ? 0.7 : sec === B ? 0.55 : kind === "TAG" ? 0.5 : kind === "A1" ? 0.2 : 0.3;
      for (let bar = 0; bar < 8; bar++) {
        const breath = kind === "TAG" && bar >= 4 && bar < 6;
        if (!(breath || r.chance(flashRate))) continue;
        const count = breath ? r.int(1, 2) : 1;
        for (let k = 0; k < count; k++) {
          const beat = +(r.pick([1, 1.5, 3, 3.5, 5, 5.5, 6]) + (r.chance(0.5) ? 0.25 : 0)).toFixed(2);
          if (beat >= 6.9) continue;
          const vel = breath ? r.range(0.45, 0.7) : r.range(0.3, 0.55);
          push("flash", bar, beat, 1, "flash", vel);
          if (breath || r.chance(0.6)) {
            const c = chordAt(bar, beat);
            const sung = ev.filter((e) => e.track === "lead" && e.bar === bar).map((e) => mod12(e.note));
            const pcs = c.pcs.filter((pc) => !sung.some((x) => Math.abs(mod12(pc - x) - 6) === 5)); // no semitone rubs
            const m = T.nearest(r.int(81, 93), pcs.length ? pcs : c.pcs, 79, 96);
            push("spark", bar, beat + 0.1, 1.5, m, vel * 0.7);
          }
        }
      }

      return { events: ev, harmony, section: `Lap ${lap + 1} · ${NAMES[kind]}`, state };
    },
  });
})();
