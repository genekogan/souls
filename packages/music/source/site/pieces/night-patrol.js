// Night Patrol: an 80s action-TV theme for a car that drives itself through the sim at night.
//
// The engine is a sequenced analog bass that never stops: sixteenths on an F# pedal, the low note on
// the 3+3+2+3+3+2 accents and the octave in between, its filter opening and closing with the form.
// Over it: a LinnDrum-style kit (gated snare doubled by a clap on 2 and 4, sixteenth hats, Simmons tom
// fills, tambourine on the big choruses), a heroic CS-80 brass fanfare, Solina string-machine pads and a
// "scanner": a plucked arpeggio whose pitch and stereo position move together, sweeping left to right
// and back twice a bar. A Fairlight orchestra hit marks the big arrivals.
//
// Harmony: F# minor with a phrygian edge (G/F# over the pedal, a bII-bIII-i cadence G A F#m) and sudden
// half-step shifts for tension: the bridge jumps up a semitone for three bars (Cm7 Eb F) and slides back
// through F = E# onto C#7; the pursuit lurches up to G minor for two bars; the theme comes back a half step
// higher, in G minor, and the tag snaps back down to F# for the next pass.
//
// Form (cycles of 8 bars; 8 cycles a round, about 2.1 minutes, after a cold open):
//   cold open (sequence and scanner, stab hits, then the kit and a distant tease of the fanfare)
//   [ theme A1 A2 (brass fanfare) -> bridge (square lead, up a half step) or, on odd rounds, a lead solo ->
//     pursuit 1 (just bass and drums, filter closed, claps) -> pursuit 2 (snare back, Simmons, the filter
//     opens, the scanner and strings return, a lurch to G minor) ->
//     theme A1 A2 in G minor, bigger (brass in thirds doubled by the lead, tambourine, orchestra hits) ->
//     tag (cadence and a stinger in G, then straight back down to the F# pedal) ] repeat.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;

  // ---------- notation: "F#4/.75 F#4/.25 | ..." bars of 4 beats, r = rest ----------
  function mel(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`night-patrol: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`night-patrol: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    return out;
  }
  /** Transpose a chord symbol by n semitones (flat spellings: the return is in G minor). */
  function tx(sym, n) {
    if (!n) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    const nm = (p) => T.NAMES[mod12(T.PC[p] + n)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }

  // ---------- harmony ----------
  const PROG = {
    open: "| F#m | G/F# | F#m | G/F# | F#m | G/F# | E/F# | C#7sus4:2 C#7:2 |",
    A1: "| F#m | G/F# | F#m | E/F# | D | E | Bm7 | C#7sus4:2 C#7:2 |",
    A2: "| F#m | G/F# | F#m | E/F# | D | E | G:2 A:2 | F#m |",
    B: "| Bm7 | D | E | F#m | Cm7 | Eb | F | C#7sus4:2 C#7:2 |",
    P1: "| F#m | F#m | F#m | F#m | Gm | Gm | F#m | C#7sus4:2 C#7:2 |",
    P2: "| F#m | F#m | F#m | F#m | Gm | Gm | F#m | D7sus4:2 D7:2 |",
    tag: "| Cm7 | Ebmaj7 | F | Gm | F#m | G/F# | F#m | C#7sus4:2 C#7:2 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  // chord scales: all inside F# aeolian / phrygian (or G, after the shift)
  const SC = {
    "F#m": [6, "aeolian"], "G/F#": [6, "phrygian"], "E/F#": [6, "aeolian"], D: [2, "lydian"], E: [4, "mixolydian"], Bm7: [11, "dorian"],
    "C#7sus4": [1, "phrygianDominant"], "C#7": [1, "phrygianDominant"], G: [7, "lydian"], A: [9, "ionian"], Cm7: [0, "dorian"],
    Eb: [3, "lydian"], F: [5, "mixolydian"], Gm: [7, "aeolian"], "D7sus4": [2, "phrygianDominant"], D7: [2, "phrygianDominant"], Ebmaj7: [3, "lydian"],
  };
  const scaleOf = (base, key) => (SC[base] ? T.scale(mod12(SC[base][0] + key), SC[base][1]) : T.chord(tx(base, key)).scale);

  // ---------- tunes ----------
  const HEAD = "F#4/.75 F#4/.25 C#5/1 B4/.5 C#5/.5 E5/1 | D5/2 B4/1 G4/.5 B4/.5 | C#5/.75 C#5/.25 F#5/1 E5/.5 F#5/.5 A5/1 | G#5/3 r/1 | ";
  const TUNE = {
    A1: mel(HEAD + "A5/1.5 F#5/.5 E5/.5 D5/.5 F#5/1 | G#5/1.5 E5/.5 B4/1 E5/1 | F#5/1.5 D5/.5 B4/.5 C#5/.5 D5/1 | F#5/2 F5/2"),
    A2: mel(HEAD + "A5/1.5 F#5/.5 E5/.5 D5/.5 A4/1 | B4/1.5 C#5/.5 E5/1 G#5/1 | D5/1 B4/.5 D5/.5 E5/1 C#5/.5 E5/.5 | F#5/3 r/1"),
    B: mel("F#5/1 E5/.5 D5/.5 C#5/1 D5/1 | A5/2 F#5/1 E5/.5 D5/.5 | B4/1 E5/.5 G#5/.5 B5/1.5 A5/.5 | G#5/1 F#5/1 C#5/2 | " +
      "G5/1 F5/.5 Eb5/.5 D5/1 Eb5/1 | Bb5/2 G5/1 F5/.5 Eb5/.5 | C5/1 F5/.5 A5/.5 C6/1.5 Bb5/.5 | G#5/1 F#5/1 F5/1.5 r/.5"),
    open: mel("r/4 | r/4 | r/4 | r/4 | r/4 | F#4/.75 F#4/.25 C#5/1 B4/.5 C#5/.5 r/1 | r/4 | r/2 C#5/.75 C#5/.25 F5/1"),
    tag: mel("G5/.75 G5/.25 Eb5/1 F5/.5 G5/.5 Bb5/1 | G5/2 Bb5/1 G5/.5 Bb5/.5 | C6/1.5 A5/.5 F5/1 A5/1 | G5/3.5 r/.5 | r/4 | r/4 | r/4 | r/4"),
  };

  // the round: cold open once, then 8 cycles that repeat
  const ROUND = [
    { s: "A", v: 1 }, { s: "A", v: 2 }, { s: "mid" }, { s: "P1" }, { s: "P2" },
    { s: "A", v: 1, up: true }, { s: "A", v: 2, up: true }, { s: "tag" },
  ];
  const planAt = (cycle) => (cycle === 0 ? { s: "open", round: 0 } : { ...ROUND[(cycle - 1) % ROUND.length], round: Math.floor((cycle - 1) / ROUND.length) });

  // the sequencer's accents: 16ths grouped 3+3+2+3+3+2
  const ACCENT = new Set([0, 3, 6, 8, 11, 14]);

  Sim.register({
    id: "night-patrol",
    title: "Night Patrol",
    genre: "80s TV synth",
    about: "An 80s action-TV theme in F♯ minor at 120 BPM: a relentless 3+3+2 sequenced bass, LinnDrum kit with gated snare, claps and Simmons fills, a CS-80 brass fanfare, Solina strings and a left-right \"scanner\" arpeggio, with sudden half-step shifts, a drums-and-bass pursuit, and the theme back bigger a semitone higher.",
    bpm: 120, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["chase", "mystery"],
    energy: 0.8,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 350, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.008, lowcut: 300, highcut: 7500 });
      const echo = I.delay(ctx, out, { time: 0.375, feedback: 0.32, highcut: 3000, pingPong: true }); // dotted eighth at 120

      const brass = I.synthBrass(ctx, { volume: -1, attack: 0.05, swell: 0.18, octaves: 3.2 });
      const lead = I.lead(ctx, { volume: -4, wave: "fatsquare", detune: 8, glide: 0.04, vibratoDepth: 0.06, base: 500, octaves: 3 });
      const strings = I.stringMachine(ctx, { volume: -11, cutoff: 2800, attack: 0.5, release: 1.4 });
      const bass = I.analog(ctx, { volume: -5, resonance: 6, base: 260, octaves: 3, decay: 0.14, sustain: 0.15, filterDecay: 0.09, release: 0.06 });
      const scan = I.pluck(ctx, { volume: -12, cutoff: 700, decay: 0.22, filterDecay: 0.08, octaves: 3.5, resonance: 4 });
      const hit = I.orchHit(ctx, { volume: -9 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 33, preload: ["kick", "gatedSnare", "clap", "hatClosed", "hatOpen", "simmons", "tambourine", "crash"] });

      const scanPan = ctx.keep(new Tone.Panner(0));
      scan.out.connect(scanPan); scanPan.connect(out);
      const bp = I.place(ctx, brass, 0.04, out), lp = I.place(ctx, lead, -0.12, out), sp = I.place(ctx, strings, 0, out);
      const hp = I.place(ctx, hit, 0.1, out), kp = I.place(ctx, kit, 0, out);
      I.place(ctx, bass, 0, out);
      I.send(ctx, bp, hall, -9); I.send(ctx, bp, echo, -22);
      I.send(ctx, lp, hall, -12); I.send(ctx, lp, echo, -15);
      I.send(ctx, sp, hall, -8); I.send(ctx, scanPan, echo, -14); I.send(ctx, scanPan, hall, -16);
      I.send(ctx, hp, hall, -6); I.send(ctx, kp, room, -12); I.send(ctx, kp, hall, -24);

      const fenv = bass.synth.filterEnvelope;
      return {
        brass: { layer: "melody", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        hit: { layer: "harmony", play: (t, e, d) => hit.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        bass: {
          layer: "bass", humanize: { timing: 0.001, vel: 0.03 }, // a sequencer: dead on the grid
          play: (t, e, d) => { if (Number.isFinite(e.cut)) fenv.baseFrequency = e.cut; bass.play(t, e.note, d, e.vel); },
        },
        scanner: {
          layer: "texture", humanize: { timing: 0, vel: 0.03 },
          play: (t, e, d) => { if (Number.isFinite(e.pan)) scanPan.pan.setValueAtTime(Math.max(-1, Math.min(1, e.pan)), t); scan.play(t, e.note, d, e.vel); },
        },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.gate }), humanize: { timing: 0.002, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = planAt(cycle);
      const key = P.up ? 1 : 0;
      const solo = P.s === "mid" && P.round % 2 === 1;
      const pkey = P.s === "A" ? "A" + P.v : P.s === "mid" ? (solo ? "A1" : "B") : P.s;
      const prog = PROGS[pkey].map((e) => ({ ...e, chord: tx(e.chord, key), base: e.chord }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const scaleAt = (b) => scaleOf(chordAt(b).base, key);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const drum = (abs, voice, vel, extra) => push("drums", abs, 0.25, voice, vel, extra);
      if (state.sv == null) Object.assign(state, { sv: null, soloMotif: null, soloLast: null });

      // ================= the sequencer =================
      const seqBar = (bar, cut, o = {}) => {
        const B = bar * BPB;
        for (let s = 0; s < 16; s++) {
          const b = B + s * 0.25, c = T.chord(sym(b));
          const root = T.nearest(42, [c.bass], 36, 47); // C2..B2, around F#2
          const acc = ACCENT.has(s);
          let n = acc ? root : root + 12;
          if (o.fifths && (s === 7 || s === 15)) n = T.nearest(root + 7, [mod12(c.root + 7)], root + 5, root + 12); // the "2" groups lift to the fifth
          push("bass", b, 0.2, n, acc ? 0.92 : 0.55 + (s % 2 ? 0 : 0.05), { cut });
        }
      };

      // ================= scanner =================
      const scanBar = (bar, vel) => {
        const B = bar * BPB;
        for (let s = 0; s < 16; s++) {
          const b = B + s * 0.25, c = T.chord(sym(b));
          const pcs = c.bass !== c.root ? c.pcs.filter((p) => p !== c.bass) : c.pcs.slice(0, 4);
          const tones = T.notesIn(pcs, 61, 86).slice(0, 5);
          const i = [0, 1, 2, 3, 4, 3, 2, 1][s % 8];
          push("scanner", b, 0.22, tones[Math.min(i, tones.length - 1)], vel * (s % 4 === 0 ? 1 : 0.78), { pan: -0.8 + 0.4 * i });
        }
      };

      // ================= strings =================
      const pads = (fromBar, toBar, vel, o = {}) => {
        prog.filter((e) => e.bar >= fromBar && e.bar < toBar).forEach((e) => {
          const v = T.voice(e.chord, { lo: o.lo ?? 50, hi: o.hi ?? 71, n: 4, prev: state.sv, top: o.top ?? [64, 71], omitBass: true, rng: r });
          state.sv = v;
          push("strings", e.bar * BPB + e.beat, e.dur - 0.05, v, vel);
        });
      };

      // ================= melody =================
      const melAttacks = [];
      /** A second brass part under the tune: a chord tone a 3rd-6th below on strong or long notes, else a diatonic third. */
      const harmonyBelow = (note, beat, dur) => {
        const c = T.chord(sym(beat));
        if (beat % 1 === 0 || dur >= 1) {
          for (let m = note - 3; m >= note - 9; m--) if (c.pcs.includes(mod12(m))) return m;
        }
        return T.step(note, -2, scaleAt(beat));
      };
      const playTune = (track, notes, o = {}) => {
        notes.forEach((n) => {
          const note = n.note + key + (o.shift || 0);
          const inBar = n.beat % BPB;
          const vel = (o.vel ?? 0.74) + (inBar === 0 ? 0.06 : 0) + (n.dur >= 2 ? 0.03 : 0);
          let out = note;
          if (o.thirds && n.dur >= 0.5) out = [harmonyBelow(note, n.beat, n.dur), note]; // the brass section in two parts
          push(track, n.beat, n.dur * (n.dur <= 0.25 ? 0.8 : 0.93), out, vel);
          melAttacks.push(n.beat);
        });
      };

      // ================= drums =================
      const crash = (abs, v = 0.7) => drum(abs, "crash", v);
      const snare = (abs, v = 0.85, o = {}) => { drum(abs, "gatedSnare", v, { gate: o.gate ?? 0.3 }); if (o.clap !== false) drum(abs, "clap", v * 0.7); };
      const hats16 = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        for (let s = 0; s < 16 && s * 0.25 < until - 1e-6; s++) {
          const b = s * 0.25;
          if (o.open && b === 3.5) { drum(B + b, "hatOpen", 0.4); s++; continue; }
          drum(B + b, "hatClosed", (b % 1 === 0.5 ? 0.6 : b % 1 === 0 ? 0.48 : 0.3) * (o.vel ?? 1));
        }
      };
      const kickBar = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        const pat = o.pat || state.kick || [0, 1.5, 2];
        pat.filter((b) => b < until).forEach((b, i) => drum(B + b, "kick", i === 0 ? 0.92 : 0.8));
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        kickBar(bar, { until, pat: o.pat });
        if (o.snare !== false) [1, 3].filter((b) => b < until).forEach((b) => snare(B + b, 0.85, { clap: o.clap !== false }));
        else if (o.clap) [1, 3].filter((b) => b < until).forEach((b) => drum(B + b, "clap", 0.72));
        hats16(bar, { until, open: o.open && until === 4, vel: o.hatVel });
        if (o.tamb) [0.5, 1.5, 2.5, 3.5].filter((b) => b < until).forEach((b) => drum(B + b, "tambourine", 0.36));
      };
      /** Simmons fill from `from` to the end of the bar: tom pitches dive bar by bar. */
      const simFill = (bar, from, kind = r.pick(["down16", "down8", "flam"])) => {
        const B = bar * BPB;
        if (kind === "down8") {
          const P = [67, 62, 58, 53, 50, 46, 43, 40];
          for (let b = from, i = 0; b < 4 - 1e-6; b += 0.5, i++) drum(B + b, "simmons", 0.66 + 0.04 * i, { pitch: P[Math.min(7, i)] });
        } else if (kind === "down16") {
          const P = [69, 69, 64, 64, 60, 60, 55, 55, 50, 50, 45, 45];
          const n = Math.round((4 - from) / 0.25);
          for (let i = 0; i < n; i++) drum(B + from + i * 0.25, i === 0 ? "gatedSnare" : "simmons", 0.6 + 0.3 * (i / n), i === 0 ? { gate: 0.2 } : { pitch: P[Math.min(P.length - 1, Math.floor((i * P.length) / n))] });
        } else { // snare-tom call and response: "ka-DOOM ka-DOOM"
          for (let b = from; b < 4 - 1e-6; b += 1) { drum(B + b, "gatedSnare", 0.62, { gate: 0.18 }); drum(B + b + 0.5, "simmons", 0.8, { pitch: b < 3 ? 57 : 47 }); }
        }
        drum(B + from, "kick", 0.85);
      };
      state.kick = r.pick([[0, 1.5, 2], [0, 1.5, 2, 2.75], [0, 0.75, 2], [0, 1.5, 2, 3.5]]);

      // ================= sections =================
      let label = "";
      if (P.s === "open") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          seqBar(bar, 180 + 40 * bar);
          scanBar(bar, bar < 4 ? 0.42 + 0.04 * bar : 0.5);
          if (bar === 0 || bar === 2) { // stab hits in the dark
            push("hit", B, 0.8, T.voice(sym(B), { lo: 54, hi: 73, n: 3, omitBass: true }), bar === 0 ? 0.7 : 0.55);
            drum(B, "kick", 0.9); snare(B, 0.8, { gate: 0.4 }); if (bar === 0) crash(B, 0.6);
          }
          if (bar === 1 || bar === 3) for (let b = 0; b < 4; b += 0.5) drum(B + b, "hatClosed", 0.22 + 0.05 * bar);
          if (bar === 3) [2, 2.5, 3, 3.5].forEach((b, i) => drum(B + b, "simmons", 0.4 + 0.12 * i, { pitch: 45 + 4 * i })); // rising toms
          if (bar >= 4) {
            if (bar === 4) crash(B, 0.75);
            groove(bar, { until: bar === 7 ? 2 : 4, open: bar === 5 });
            if (bar === 7) simFill(bar, 2, "down16");
          }
        }
        pads(4, 8, 0.42);
        playTune("lead", TUNE.open, { vel: 0.6 });
        label = "Cold open · the sequencer and the scanner, then the kit";
      } else if (P.s === "A") {
        const up = !!P.up;
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          seqBar(bar, up ? 560 : 440, { fifths: up || P.v === 2 });
          if (bar === 0 || (up && bar === 4)) crash(B, bar === 0 ? 0.75 : 0.6);
          const fill = bar === 7 ? r.pick([2, 3]) : bar === 3 && r.chance(0.5) ? 3.5 : null;
          groove(bar, { until: fill ?? 4, open: bar % 2 === 1, tamb: up || P.v === 2 });
          if (fill === 3.5) { drum(B + 3.5, "gatedSnare", 0.45, { gate: 0.12 }); drum(B + 3.75, "gatedSnare", 0.6, { gate: 0.12 }); }
          else if (fill != null) simFill(bar, fill);
          if (!up && (bar === 2 || bar === 6) && r.chance(0.6)) scanBar(bar, 0.36); // the scanner glints between phrases
          if (up && (bar === 0 || bar === 4)) push("hit", B, 0.8, T.voice(sym(B), { lo: 55, hi: 74, n: 3, omitBass: true }), 0.62);
        }
        if (up) {
          playTune("brass", TUNE["A" + P.v], { vel: 0.76, thirds: true });
          playTune("lead", TUNE["A" + P.v], { vel: 0.6 });
          pads(0, 8, 0.5, { lo: 55, hi: 76, top: [69, 76] });
          for (const bar of [3, 7]) scanBar(bar, 0.4); // the scanner sweeps under the held notes
        } else {
          playTune("brass", TUNE["A" + P.v], { vel: 0.76 });
          pads(0, 8, 0.44);
        }
        label = up ? `Theme ${P.v === 1 ? "A" : "A′"} · up a half step to G minor, bigger` : `Theme ${P.v === 1 ? "A" : "A′"} · brass fanfare`;
      } else if (P.s === "mid") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          seqBar(bar, solo ? 470 : 380 + (bar >= 4 ? 80 : 0), { fifths: bar % 2 === 1 });
          if (bar === 0 || (!solo && bar === 4)) crash(B, 0.65);
          if (solo) {
            groove(bar, { until: bar === 7 ? 2 : 4, open: true });
            if (bar === 7) simFill(bar, 2);
          } else { // half-time: the snare on 3, kicks on the sequencer's accents
            kickBar(bar, { pat: [0, 1.5, 2.75], until: bar === 7 ? 2 : 4 });
            snare(B + 2, 0.82, { gate: 0.42 });
            for (let b = 0; b < (bar === 7 ? 2 : 4); b += 0.5) drum(B + b, "hatClosed", b % 1 ? 0.5 : 0.36);
            if (bar % 2 === 1 && bar < 7) drum(B + 3.5, "simmons", 0.55, { pitch: 50 });
            if (bar === 7) simFill(bar, 2.5, "flam");
          }
          scanBar(bar, solo ? 0.3 : 0.4);
        }
        pads(0, 8, 0.46);
        if (solo) {
          const m = C.line({
            start: 0, end: 30, chordAt: sym, scaleFor: (s) => scaleOf(prog.find((e) => e.chord === s)?.base ?? s, key),
            lo: 64, hi: 86, rng: r.fork(5), density: 0.55, phrase: [4, 8], rest: [1, 2], motif: state.soloMotif, motifProb: 0.5,
            chromatic: 0.18, register: 0.55, prev: state.soloLast, upbeatStart: 0.4,
          });
          state.soloMotif = m.motif; state.soloLast = m.last;
          m.notes.forEach((n) => push("lead", n.beat, n.dur, n.note, 0.6 + (n.vel - 0.6) * 1.2));
          push("lead", 30, 1.8, 77, 0.66); // E# over C#7: the leading tone into the pursuit
        } else playTune("lead", TUNE.B, { vel: 0.72 });
        label = solo ? "Interlude · square-lead solo over the theme" : "Bridge · half-time, a sudden half step up and back";
      } else if (P.s === "P1") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          seqBar(bar, 150 + 22 * bar, { fifths: bar >= 4 });
          kickBar(bar, { pat: bar < 2 ? [0, 2] : [0, 1.5, 2] });
          if (bar >= 2) for (let b = 0; b < 4; b += 0.25) drum(B + b, "hatClosed", (b % 1 === 0.5 ? 0.42 : 0.24) * (0.7 + 0.05 * bar));
          if (bar >= 4) [1, 3].forEach((b) => drum(B + b, "clap", 0.7));
          if (bar === 7) [3, 3.25, 3.5, 3.75].forEach((b, i) => drum(B + b, "clap", 0.45 + 0.1 * i));
        }
        label = "Pursuit · just the sequencer and the drums, filter closed";
      } else if (P.s === "P2") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          seqBar(bar, 320 + 55 * bar, { fifths: true });
          if (bar === 0 || bar === 4) crash(B, bar === 4 ? 0.75 : 0.6);
          if (bar < 6) groove(bar, { open: bar % 2 === 1, tamb: bar >= 4, clap: true });
          if (bar === 4 || bar === 5) [0.75, 2.75].forEach((b) => drum(B + b, "simmons", 0.6, { pitch: 55 })); // the lurch to G minor
          if (bar === 6) { groove(bar, { until: 2 }); for (let b = 2; b < 4 - 1e-6; b += 0.25) drum(B + b, "gatedSnare", 0.35 + 0.25 * (b - 2), { gate: 0.1 }); }
          if (bar === 7) { drum(B, "kick", 0.9); drum(B, "crash", 0.5); simFill(bar, 0.5, "down8"); }
          if (bar >= 3) scanBar(bar, 0.32 + 0.03 * bar);
        }
        pads(6, 8, 0.5);
        label = "Pursuit · the snare is back, the filter opens, a lurch to G minor";
      } else { // tag
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar < 3) {
            seqBar(bar, 560, { fifths: true });
            if (bar === 0) crash(B, 0.7);
            groove(bar, { tamb: true, until: bar === 2 ? 3 : 4 });
            if (bar === 2) [3, 3.25, 3.5, 3.75].forEach((b, i) => drum(B + b, "simmons", 0.6 + 0.08 * i, { pitch: 62 - 5 * i }));
          } else if (bar === 3) { // the stinger, then a beat of silence before the drop
            push("hit", B, 1.2, T.voice(sym(B), { lo: 55, hi: 74, n: 3 }), 0.78);
            push("bass", B, 1.5, T.nearest(42, [T.chord(sym(B)).bass], 36, 47), 0.95, { cut: 700 });
            drum(B, "kick", 0.95); crash(B, 0.85); snare(B, 0.9, { gate: 0.42 });
            [2.5, 3, 3.5].forEach((b, i) => drum(B + b, "simmons", 0.5 + 0.1 * i, { pitch: 47 - 2 * i }));
          } else { // back down to F#: the patrol goes on
            seqBar(bar, 200 + 50 * (bar - 4));
            scanBar(bar, 0.4);
            kickBar(bar, { pat: [0, 2] });
            for (let b = 0; b < 4; b += 0.5) drum(B + b, "hatClosed", 0.3 + 0.04 * (bar - 4));
            if (bar >= 6) [1, 3].forEach((b) => drum(B + b, "clap", 0.66));
            if (bar === 7) simFill(bar, 2, "down16");
          }
        }
        pads(0, 3, 0.5, { lo: 55, hi: 76, top: [69, 76] });
        pads(4, 8, 0.38);
        playTune("brass", TUNE.tag, { vel: 0.8, thirds: true });
        playTune("lead", TUNE.tag, { vel: 0.6 });
        label = "Tag · a stinger in G minor, then straight back down to F♯";
      }

      return { events: ev, harmony: prog.map(({ base, ...h }) => h), section: label, state };
    },
  });
})();
