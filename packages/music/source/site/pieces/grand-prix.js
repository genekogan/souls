// Grand Prix: SNES-era futuristic racing fusion. 166 BPM rock-fusion in D with mixolydian (C/D) and lydian
// (E/D) colour over a pedal, a heroic saw lead, slap bass, a rock kit and brass stabs.
//
// The race (one loop = 11 cycles of 8 bars, about 2.2 minutes):
//   Start grid   three countdown beeps over a pedal, a snare roll, then the 3+3+2 riff (D C/D Bb C)
//   Lap 1        the theme, A1 A2: a rising call over D E/D C/D D, answered through bVI-bVII (Bb C)
//   Tunnel       B1: B minor in half-time, the distorted guitar takes a long-breathed line over a ride,
//                SNES pulse arpeggios underneath; B2: double-time again, Gmaj7 A Bbmaj7 C climbing in
//                twin-lead (synth plus guitar a diatonic third below)
//   Lap 2        the theme again, twin-lead harmony, palm-muted chugs, brass on every bar
//   Lap 3        a solo (guitar on odd races, the synth lead on even ones) over the riff changes,
//                turning C D B7 to set up the modulation
//   Final lap    up a whole step to E and the tempo pushes to 176: the theme in octaves (lead plus guitar),
//                16th hats, tambourine, crashes every four bars
//   Checkered flag  a victory tag on the theme's opening and the riff, then back to the grid at 166
// Every chord has a chord scale inside the key (lydian bVI and bVII, mixolydian over C/D, lydian over E/D),
// which the twin lead, the solo and the arpeggios use.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BPM = 166, FINAL_BPM = 176;
  const mod12 = T.mod12;
  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // ---------- notation: "A4/.5 D5/.5 | ..." bars of 4 beats; r = rest; a trailing _ ties into the next note ----------
  function mel(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(_?)$/.exec(tok);
        if (!m) throw new Error(`grand-prix: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), tie: m[3] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`grand-prix: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; }
      else merged.push({ ...n });
    }
    return merged.filter((n) => n.note != null);
  }

  /** Transpose a chord symbol by n semitones (sharp spellings: the piece lives in D and E). */
  function tx(sym, n) {
    if (!n) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    const nm = (p) => SHARPS[mod12(T.PC[p] + n)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }

  // ---------- harmony ----------
  const PROG = {
    grid: "| D | D | D | D | D | C/D | Bb | C |",
    A1: "| D | E/D | C/D | D | Bbmaj7 | C | G/B | A7sus4:2 A7:2 |",
    A2: "| D | E/D | C/D | D | Bbmaj7 | C | Bb:2 C:2 | D |",
    B1: "| Bm | G | D/F# | A | Bm | G | Em7 | F#7sus4:2 F#7:2 |",
    B2: "| Gmaj7 | A | Bbmaj7 | C | Gmaj7 | A | Bb:2 C:2 | Asus4:2 A:2 |",
    solo: "| D | C/D | D | E/D | Bb | C | C:2 D:2 | B7sus4:2 B7:2 |",
    flag: "| Bb | C | D | D | Bb | C | D | D |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  // chord scales in the home key (transposed with the chord in the final lap)
  const SC = {
    D: [2, "ionian"], "E/D": [2, "lydian"], "C/D": [2, "mixolydian"], Bbmaj7: [10, "lydian"], Bb: [10, "lydian"], C: [0, "lydian"],
    "G/B": [7, "ionian"], A7sus4: [9, "mixolydian"], A7: [9, "mixolydian"], Bm: [11, "aeolian"], G: [7, "lydian"], "D/F#": [2, "ionian"],
    A: [9, "mixolydian"], Em7: [4, "dorian"], "F#7sus4": [6, "phrygianDominant"], "F#7": [6, "phrygianDominant"], Gmaj7: [7, "lydian"],
    Asus4: [9, "mixolydian"], B7sus4: [11, "mixolydian"], B7: [11, "mixolydian"],
  };
  const scaleOf = (base, key) => (SC[base] ? T.scale(mod12(SC[base][0] + key), SC[base][1]) : T.chord(tx(base, key)).scale);

  // ---------- tunes (home key) ----------
  const HEAD = "A4/.5 D5/.5 F#5/.5 A5/1 F#5/.5 A5/.5 B5/.5_ | B5/1.5 G#5/.5 F#5/.5 G#5/.5 B5/.5 E6/.5_ | " +
    "E6/1.5 D6/.5 C6/.5 G5/.5 E5/.5 G5/.5 | F#5/2.5 E5/.5 D5/.5 A4/.5 | ";
  const TUNE = {
    A1: mel(HEAD + "D5/.5 F5/.5 A5/1 F5/.5 A5/.5 C6/1 | G5/.5 C6/.5 E6/1.5 D6/.5 C6/1 | D6/1.5 B5/.5 G5/.5 A5/.5 B5/.5 D6/.5_ | D6/2 C#6/1.5 r/.5"),
    A2: mel(HEAD + "D5/.5 F5/.5 A5/1 Bb5/.5 A5/.5 F5/1 | E5/.5 G5/.5 C6/1 E6/1.5 D6/.5_ | D6/1 Bb5/.5 F5/.5 G5/.5 C6/.5 E6/.5 G6/.5 | F#6/3 r/1"),
    B1: mel("B4/1 D5/.5 F#5/2.5 | G5/1.5 F#5/.5 D5/1 B4/1 | F#5/1 A5/.5 D6/2.5 | C#6/1.5 B5/.5 A5/1 E5/1 | " +
      "F#5/1 B5/.5 D6/2.5 | D6/1.5 B5/.5 G5/1 B5/1 | E5/1 G5/.5 B5/.5 D6/1.5 B5/.5 | B5/2 A#5/1.5 r/.5"),
    B2: mel("B5/1.5 A5/.5 F#5/1 D5/1 | E5/1.5 F#5/.5 A5/1 C#6/1 | D6/1.5 C6/.5 A5/1 F5/1 | G5/1.5 A5/.5 C6/1 E6/1 | " +
      "F#6/2 D6/1 B5/1 | E6/2 C#6/1 A5/1 | D6/1 F6/1 E6/1 G6/1 | E6/2 C#6/1.5 r/.5"),
    flag: mel("D5/.5 F5/.5 Bb5/1 D6/1 F6/1 | G6/1.5 E6/.5 C6/1 E6/1 | F#6/3 E6/.5 F#6/.5_ | F#6/2 r/2 | r/4 | r/4 | r/4 | r/4"),
  };

  // ---------- the race ----------
  const RACE = [
    { s: "grid" },
    { s: "A", v: 1, lap: 1 }, { s: "A", v: 2, lap: 1 },
    { s: "B", v: 1 }, { s: "B", v: 2 },
    { s: "A", v: 1, lap: 2 }, { s: "A", v: 2, lap: 2 },
    { s: "solo" },
    { s: "A", v: 1, lap: 4, final: true }, { s: "A", v: 2, lap: 4, final: true },
    { s: "flag", final: true },
  ];
  const FINAL_IDX = RACE.findIndex((x) => x.final);

  // syncopated accent figures for a bar (kick, guitar and brass lock to them; the snare owns beats 2 and 4)
  const ACC = [[[0, 1.5, 2.5], 3], [[0, 0.75, 1.5, 2.5], 2], [[0, 1.5, 3.5], 2], [[0, 2.5, 3.5], 1.5], [[0, 0.75, 2.5], 1.5], [[0, 1.5, 2, 3.5], 1]];
  // the riff: 16ths grouped 3+3+2+3+3+2
  // [beat, accent, degree]: root, root, octave, the scale step under the octave, octave, fifth
  const RIFF = [[0, 1, 0], [0.75, 0.72, 0], [1.5, 0.9, 12], [2, 0.68, "s"], [2.75, 0.82, 12], [3.5, 0.92, 7]];

  Sim.register({
    id: "grand-prix",
    title: "Grand Prix",
    genre: "Racing fusion",
    about: "SNES-style futuristic racing fusion at 166 BPM: a 3+3+2 riff off the start grid, a heroic saw-lead theme over mixolydian and lydian pedal chords, slap bass, rock kit and brass stabs, a half-time B-minor tunnel, a solo, and a final lap that jumps up a step and pushes the tempo.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["chase", "training"],
    energy: 0.95,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 250, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.025, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: 60 / BPM * 0.75, feedback: 0.24, highcut: 3200, pingPong: true });

      const lead = I.lead(ctx, { volume: -1, glide: 0.022, vibratoDepth: 0.07, vibratoDelay: 0.28, base: 700, octaves: 3.2 });
      const gtr = I.distGuitar(ctx, { volume: -4, drive: 0.82, cutoff: 4000 }); // lead guitar: B section, solos, twin lead
      const rhythm = I.distGuitar(ctx, { volume: -10, drive: 0.7, cutoff: 3000 }); // power chords and chugs
      const brass = I.brassStab(ctx, { volume: -6 });
      const bass = I.slapBass(ctx, { volume: -4 });
      const arp = I.pulse(ctx, { volume: -17, width: 0.5, decay: 0.09, sustain: 0.3, release: 0.04 });
      const beep = I.pulse(ctx, { volume: -9, width: 0, decay: 0.05, sustain: 0.85, release: 0.03 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 32, preload: ["kick", "rockSnare", "hatClosed", "hatOpen", "crash", "ride", "tom", "tambourine"] });

      const lp = I.place(ctx, lead, 0.06, out), gp = I.place(ctx, gtr, -0.18, out), rp = I.place(ctx, rhythm, -0.42, out);
      const bp = I.place(ctx, brass, 0.36, out), ap = I.place(ctx, arp, 0.3, out), ep = I.place(ctx, beep, 0, out);
      I.place(ctx, bass, 0, out);
      const kp = I.place(ctx, kit, 0.02, out);
      I.send(ctx, lp, hall, -13); I.send(ctx, lp, echo, -19);
      I.send(ctx, gp, hall, -15); I.send(ctx, gp, echo, -20);
      I.send(ctx, rp, room, -14); I.send(ctx, bp, room, -11); I.send(ctx, bp, hall, -18);
      I.send(ctx, ap, echo, -12); I.send(ctx, ep, hall, -10);
      I.send(ctx, kp, room, -15);

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        gtr: { layer: "melody", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        beep: { layer: "texture", play: (t, e, d) => beep.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        rhythm: { layer: "harmony", play: (t, e, d) => rhythm.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.06 } },
        brass: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        arp: { layer: "texture", play: (t, e, d) => arp.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.06 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel, e.art), humanize: { timing: 0.003, vel: 0.06 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.003, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const race = Math.floor(cycle / RACE.length), idx = cycle % RACE.length;
      const S = RACE[idx];
      const key = S.final ? 2 : 0;
      const pkey = S.s === "A" ? "A" + S.v : S.s === "B" ? "B" + S.v : S.s;
      const prog = PROGS[pkey].map((e) => ({ ...e, chord: tx(e.chord, key), base: e.chord }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const scaleAt = (b) => scaleOf(chordAt(b).base, key);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const drum = (abs, voice, vel, pitch) => push("drums", abs, 0.25, voice, vel, pitch != null ? { pitch } : {});
      if (state.bass == null) Object.assign(state, { bass: 38, rv: null, bv: null, soloMotif: null, soloLast: null });

      // accent figure per bar, shared by kick, rhythm guitar, bass and brass
      const accents = [];
      for (let bar = 0; bar < 8; bar++) accents.push(r.weighted(ACC));

      // ================= melody =================
      const leadAttacks = []; // abs beats of melody attacks (brass answers around them)
      const playTune = (track, notes, o = {}) => {
        const shift = (o.shift || 0) + key;
        let prev = null;
        notes.forEach((n) => {
          const note = n.note + shift;
          const inBar = n.beat % BPB;
          const vel = (o.vel ?? 0.78) + (inBar === 0 ? 0.06 : inBar % 1 === 0.5 ? 0.02 : 0) + (n.dur >= 1.5 ? 0.03 : 0);
          // a scoop from a step below into a long note reached by a leap (laps 2 and the final lap)
          if (o.grace && prev != null && n.dur >= 1 && Math.abs(n.note - prev) >= 5 && n.beat > 0 && r.chance(0.45)) {
            push(track, n.beat - 0.125, 0.12, T.step(note, -1, scaleAt(n.beat)), vel * 0.7, { straight: true });
          }
          push(track, n.beat, Math.max(0.2, n.dur * (n.dur <= 0.5 ? 0.85 : 0.94)), note, vel);
          if (track === "lead" || o.main) leadAttacks.push(n.beat);
          prev = n.note;
        });
      };
      /** Diatonic third below in each chord's scale (twin lead). */
      // (a note tied across a barline takes its harmony from the bar where it mostly sounds)
      const soundsIn = (n) => { const bl = (Math.floor(n.beat / BPB) + 1) * BPB; return n.beat + n.dur - bl > bl - n.beat ? bl : n.beat; };
      const thirdBelow = (notes) => notes.map((n) => ({ ...n, note: T.step(n.note + key, -2, scaleAt(soundsIn(n))) - key }));

      if (S.s === "A") {
        const tune = TUNE["A" + S.v];
        playTune("lead", tune, { vel: S.final ? 0.82 : 0.78, grace: S.lap >= 2 });
        if (S.lap === 2) playTune("gtr", thirdBelow(tune), { vel: 0.5 });
        if (S.final) playTune("gtr", tune, { vel: 0.56, shift: -12 });
      } else if (S.s === "B") {
        if (S.v === 1) playTune("gtr", TUNE.B1, { vel: 0.7, main: true });
        else { playTune("lead", TUNE.B2, { vel: 0.76 }); playTune("gtr", thirdBelow(TUNE.B2), { vel: 0.5 }); }
      } else if (S.s === "flag") {
        playTune("lead", TUNE.flag, { vel: 0.84 });
        playTune("gtr", TUNE.flag, { vel: 0.52, shift: -12 });
      } else if (S.s === "solo") {
        const guitar = race % 2 === 0;
        // the solo builds: four bars of statement in the middle register, then denser and higher
        const common = { chordAt: sym, scaleFor: (s) => scaleOf(prog.find((e) => e.chord === s)?.base ?? s, key), phrase: [4, 8], chromatic: 0.22, upbeatStart: 0.5 };
        const m1 = C.line({ ...common, start: 0, end: 16, lo: guitar ? 64 : 70, hi: guitar ? 81 : 86, rng: r.fork(11), density: 0.55, rest: [1, 2],
          motif: state.soloMotif, motifProb: 0.5, register: 0.5, prev: state.soloLast });
        const m2 = C.line({ ...common, start: 16, end: 23.5, lo: guitar ? 67 : 72, hi: guitar ? 86 : 91, rng: r.fork(12), density: 0.78, rest: [0.5, 1],
          motif: m1.motif, motifProb: 0.55, register: 0.7, prev: m1.last, phrase: [3, 7] });
        state.soloMotif = m1.motif;
        const tr = guitar ? "gtr" : "lead", oct = guitar ? 0 : 12;
        m1.notes.concat(m2.notes).forEach((n) => { push(tr, n.beat, n.dur, n.note, 0.6 + (n.vel - 0.6) * 1.3 + (n.strong ? 0.06 : 0)); leadAttacks.push(n.beat); });
        // bar 7: the fusion sequence lick, 16ths in groups of four climbing through the scale (1-2-3-1, up a step)
        let x = T.nearest((guitar ? 72 : 74) + r.int(-2, 1), T.chord(sym(24)).pcs);
        for (let g = 0; g < 4; g++) {
          const b0 = 24 + g, sc = scaleAt(b0);
          [x, T.step(x, 1, sc), T.step(x, 2, sc), x].forEach((n, i) => push(tr, b0 + i * 0.25, 0.22, n, 0.62 + (i === 0 ? 0.1 : 0) + g * 0.03));
          x = T.step(x, 1, scaleAt(b0 + 1));
        }
        // bar 8: a held sus note, then the run up B7 (the leading tone climbs into E)
        const held = T.nearest(x - 2, [4, 6], x - 7, x + 2); // E or F# over B7sus4
        push(tr, 28, 1.9, held, 0.78);
        const run = T.notesIn(T.chord(sym(30)).pcs, held - 4, held + 14).slice(0, 4);
        run.forEach((n, i) => push(tr, 30 + i * 0.5, 0.45, n, 0.7 + i * 0.05));
        state.soloLast = run[3];
      }

      // grid: three beeps and a high one, over the pedal
      if (S.s === "grid") {
        [0, 4, 8].forEach((b) => push("beep", b, 0.55, 81, 0.6));
        push("beep", 12, 1.6, 93, 0.66);
      }

      // ================= rhythm guitar =================
      const power = (b) => { // power chord (root, fifth, octave) or an upper triad over a pedal
        const c = T.chord(sym(b));
        if (c.bass !== c.root) {
          const v = T.voice(sym(b).split("/")[0], { lo: 55, hi: 71, n: 3, rootless: false, prev: state.rv, spread: "close" });
          state.rv = v; return v;
        }
        const root = T.nearest(state.rv ? state.rv[0] : 47, [c.root], 40, 52);
        const v = [root, root + 7, root + 12]; state.rv = v; return v;
      };
      /** The riff line (bass pitches) for a bar: parallel power chords follow it. */
      const riffLine = (bar) => {
        const B = bar * BPB, c = T.chord(sym(B));
        const root = pickBass(c.bass);
        const sc = chordAt(B).base === "D" ? T.scale(mod12(2 + key), "mixolydian") : scaleAt(B);
        state.bass = root;
        return RIFF.map(([b, acc, deg]) => ({ b: B + b, acc, n: deg === "s" ? T.step(root + 12, -1, sc) : root + deg }));
      };
      const riffBar = (bar, o = {}) => {
        riffLine(bar).forEach(({ b, acc, n }, i) => {
          const p = T.nearest(n, [mod12(n)], 40, 52);
          push("rhythm", b, i === 5 ? 0.45 : 0.4, [p, p + 7, p + 12], 0.55 + 0.25 * acc);
          push("bass", b, 0.42, n, 0.6 + 0.3 * acc, { art: i === 2 || i === 4 ? "pop" : "thumb" });
          if (o.brass && [1, 4, 5].includes(i)) brassHit(b, 0.32, 0.66 + 0.08 * acc);
        });
      };
      const compBar = (bar, o = {}) => {
        const B = bar * BPB, acc = accents[bar];
        acc.forEach((a, i) => {
          const end = i + 1 < acc.length ? acc[i + 1] : 4;
          const v = power(B + a);
          push("rhythm", B + a, o.chug ? 0.42 : Math.max(0.4, end - a - 0.1), v, 0.66);
        });
        if (o.chug) for (let b = 0; b < 4; b += 0.5) {
          if (acc.includes(b)) continue;
          const v = power(B + b);
          push("rhythm", B + b, 0.17, v.slice(0, 2), 0.3 + (b % 1 === 0 ? 0.04 : 0));
        }
      };

      // ================= brass stabs =================
      function brassHit(abs, dur, vel) {
        const v = T.voice(sym(abs), { lo: 58, hi: 79, n: 4, prev: state.bv, top: [72, 79], omitBass: true, rootless: false });
        state.bv = v;
        push("brass", abs, dur, v, vel);
      }
      const brassBar = (bar, o = {}) => {
        const B = bar * BPB;
        const cands = accents[bar].filter((a) => a > 0).concat(accents[bar].includes(3.5) ? [] : [3.5]);
        cands.forEach((a) => {
          if (leadAttacks.some((x) => Math.abs(x - (B + a)) < 0.3)) return; // answer the lead, don't sit on it
          brassHit(B + a, 0.3, (o.vel ?? 0.62) + (a % 1 === 0.5 ? 0.04 : 0));
        });
      };

      // ================= arpeggio (SNES pulse) =================
      const arpBar = (bar, vel) => {
        const B = bar * BPB;
        for (let s = 0; s < 16; s++) {
          const b = B + s * 0.25, c = T.chord(sym(b));
          const tones = T.notesIn([c.root, ...c.pcs.filter((p) => p !== c.root).slice(0, 3)], 62, 86);
          const k = [0, 1, 2, 3, 4, 3, 2, 1][s % 8] + (s >= 8 ? 1 : 0); // up and back, the second half a step higher
          push("arp", b, 0.2, tones[Math.min(tones.length - 1, k)], vel * (s % 4 === 0 ? 1 : 0.75));
        }
      };

      // ================= bass =================
      const pickBass = (pc, from = state.bass, lo = 33, hi = 45) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.4 * Math.abs(m - 39); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const nextBassPc = (b) => T.chord(sym(Math.min(31.99, b))).bass;
      const driveBar = (bar, o = {}) => {
        const B = bar * BPB, acc = accents[bar];
        let root = pickBass(T.chord(sym(B)).bass);
        for (let p = 0; p < 4; p += 0.5) {
          const pc = T.chord(sym(B + p)).bass;
          if (mod12(root) !== pc) root = pickBass(pc, root);
          const last = p === 3.5;
          const nb = bar < 7 ? nextBassPc(B + 4) : o.nextPc;
          if (last && !acc.includes(3.5) && nb != null && nb !== pc) { // approach the next bar's bass
            const target = pickBass(nb, root); // the note the next bar will start on
            push("bass", B + p, 0.4, r.chance(0.65) ? target - 1 : target + 1, 0.7, { art: "finger" });
          } else if (acc.includes(p)) push("bass", B + p, 0.42, root, 0.92, { art: "thumb" });
          else if (p === 1 || p === 3) push("bass", B + p, 0.3, root + 12, 0.78, { art: "pop" });
          else push("bass", B + p, 0.38, root, 0.62, { art: "thumb" });
          if (o.ghosts && !acc.includes(p + 0.25) && r.chance(0.28) && p !== 3.5) push("bass", B + p + 0.25, 0.1, root, 0.4, { art: "ghost" });
        }
        state.bass = root;
      };
      const halfBar = (bar) => {
        const B = bar * BPB, c = T.chord(sym(B));
        const root = pickBass(c.bass);
        const fifth = mod12(c.root + 7);
        push("bass", B, 1.4, root, 0.9, { art: "finger" });
        push("bass", B + 1.5, 0.4, root, 0.6, { art: "finger" });
        push("bass", B + 2, 0.4, root + 12, 0.78, { art: "pop" });
        push("bass", B + 2.5, 0.4, T.nearest(root + 7, [fifth], root, root + 12), 0.62, { art: "finger" });
        const nb = bar < 7 ? nextBassPc(B + 4) : null;
        if (nb != null && nb !== c.bass) { const t = pickBass(nb, root); push("bass", B + 3.5, 0.4, t + (t > root ? -1 : 1), 0.66, { art: "finger" }); }
        else push("bass", B + 3, 0.8, root, 0.64, { art: "thumb" });
        state.bass = root;
      };

      // ================= drums =================
      const crash = (abs, v = 0.75) => drum(abs, "crash", v);
      const hats = (bar, mode, o = {}) => {
        const B = bar * BPB;
        if (mode === "ride") { for (let b = 0; b < 4; b += 0.5) drum(B + b, "ride", b % 1 === 0 ? 0.55 : 0.4); return; }
        const step = mode === "16" ? 0.25 : 0.5;
        for (let b = 0; b < (o.until ?? 4) - 1e-6; b += step) {
          if (o.open && b === 3.5) { drum(B + b, "hatOpen", 0.42); continue; }
          const v = b % 1 === 0 ? 0.62 : b % 0.5 === 0 ? 0.42 : 0.28;
          drum(B + b, "hatClosed", v * (o.vel ?? 1));
        }
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, acc = accents[bar], until = o.until ?? 4;
        acc.filter((a) => a < until).forEach((a, i) => drum(B + a, "kick", i === 0 ? 0.92 : 0.8));
        [1, 3].filter((b) => b < until).forEach((b) => drum(B + b, "rockSnare", 0.86));
        if (o.ghosts) [0.75, 2.25, 3.75].forEach((b) => { if (b < until && r.chance(0.35)) drum(B + b, "rockSnare", 0.16); });
        hats(bar, o.hats || "8", { open: o.open && until === 4, until, vel: o.hatVel });
        if (o.tamb) [0.5, 1.5, 2.5, 3.5].forEach((b) => { if (b < until) drum(B + b, "tambourine", 0.4); });
      };
      const halfGroove = (bar) => {
        const B = bar * BPB;
        drum(B, "kick", 0.9); drum(B + 2.5, "kick", 0.72); if (r.chance(0.4)) drum(B + 0.75, "kick", 0.6);
        drum(B + 2, "rockSnare", 0.88);
        hats(bar, "ride");
      };
      /** A fill from `from` to the end of the bar. */
      const fill = (bar, from, kind) => {
        const B = bar * BPB;
        if (kind === "snare") for (let b = from, i = 0; b < 4 - 1e-6; b += 0.25, i++) drum(B + b, "rockSnare", 0.42 + 0.45 * (b - from) / (4 - from));
        else if (kind === "toms") {
          const P = [62, 62, 57, 57, 52, 52, 45, 45];
          for (let b = from, i = 0; b < 4 - 1e-6; b += 0.25, i++) {
            const k = Math.floor((i * 8) / ((4 - from) * 4));
            if (i < 2 && from <= 2) drum(B + b, "rockSnare", 0.6 + 0.1 * i); else drum(B + b, "tom", 0.62 + 0.03 * i, P[Math.min(7, k)]);
          }
          drum(B + from, "kick", 0.8);
        } else { // band hits: kick and snare in unison with the brass
          [2.5, 3, 3.5].filter((b) => b >= from).forEach((b) => { drum(B + b, "kick", 0.9); drum(B + b, "rockSnare", 0.85); brassHit(B + b, 0.3, 0.74); });
        }
      };

      // ================= sections =================
      let label = "";
      if (S.s === "grid") {
        for (let bar = 0; bar < 4; bar++) { // the countdown: pedal D in eighths, hats rising, a roll
          const B = bar * BPB;
          for (let p = 0; p < 4; p += 0.5) push("bass", B + p, 0.36, 38, 0.48 + 0.08 * bar + (p === 0 ? 0.1 : 0), { art: "finger" });
          drum(B, "kick", 0.8);
          if (bar < 3) for (let b = 0; b < 4; b += 0.5) drum(B + b, "hatClosed", 0.25 + 0.06 * bar + (b % 1 === 0 ? 0.12 : 0));
          else for (let b = 0; b < 4 - 1e-6; b += 0.25) drum(B + b, "rockSnare", 0.2 + 0.7 * (b / 4));
          if (bar === 3) push("rhythm", B + 2, 2, [50, 57, 62], 0.5); // power chord swells under the roll
        }
        state.bass = 38;
        for (let bar = 4; bar < 8; bar++) {
          riffBar(bar, { brass: true });
          const B = bar * BPB;
          if (bar === 4) crash(B, 0.8);
          RIFF.forEach(([b]) => drum(B + b, "kick", b === 0 ? 0.92 : 0.82));
          [1, 3].forEach((b) => drum(B + b, "rockSnare", 0.86));
          hats(bar, "8", { until: bar === 7 ? 3 : 4 });
          if (bar === 7) fill(bar, 3, "snare");
        }
        label = race === 0 ? "Start grid · countdown, then the riff" : `Race ${race + 1} · start grid`;
      } else if (S.s === "A") {
        const lap2 = S.lap === 2, fin = !!S.final;
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          const fillHere = bar === 7 ? r.pick(["snare", "toms", "hits"]) : bar === 3 && (lap2 || fin) && r.chance(0.5) ? "snare" : null;
          const from = bar === 7 ? (fillHere === "hits" ? 2.5 : r.pick([2, 3])) : 3.5;
          if (bar === 0 || (fin && bar === 4)) crash(B, bar === 0 ? 0.8 : 0.66);
          groove(bar, { hats: fin ? "16" : "8", ghosts: lap2 || fin, open: !fin && bar % 2 === 1, tamb: fin || (lap2 && S.v === 2), until: fillHere ? from : 4, hatVel: fin ? 0.85 : 1 });
          if (fillHere) fill(bar, from, fillHere);
          compBar(bar, { chug: lap2 || fin });
          const nextPc = bar === 7 ? T.chord(tx(PROGS[S.v === 1 ? "A2" : nextKeyOf(idx)][0].chord, nextKey(idx))).bass : null;
          driveBar(bar, { ghosts: lap2 || fin, nextPc });
          if (S.lap === 1 ? bar % 4 >= 2 : true) brassBar(bar, { vel: fin ? 0.68 : 0.62 });
          if (fin) arpBar(bar, 0.32);
        }
        label = fin ? `Final lap · up a step to E, ${S.v === 1 ? "the tempo pushes" : "flat out"}` : lap2 ? `Lap 2 · theme in twin-lead harmony${S.v === 2 ? ", answer" : ""}` : `Lap 1 · theme${S.v === 2 ? ", answer" : ""}`;
      } else if (S.s === "B") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (S.v === 1) {
            if (bar === 0) crash(B, 0.7);
            if (bar === 7) { halfGroove(bar); fill(bar, 2.5, "toms"); }
            else halfGroove(bar);
            halfBar(bar);
            // brass section holds the changes softly; the pulse arpeggio rolls underneath
            const v = T.voice(sym(B), { lo: 55, hi: 74, n: 4, prev: state.bv, top: [67, 74], omitBass: true });
            state.bv = v;
            push("brass", B, 3.7, v, 0.36);
            arpBar(bar, 0.42);
          } else {
            if (bar === 0) crash(B, 0.8);
            const build = bar >= 6;
            groove(bar, { hats: bar >= 4 ? "16" : "8", ghosts: true, until: bar === 7 ? 0.01 : 4 });
            if (bar === 6) [0.5, 1.5, 2.5, 3.5].forEach((b) => drum(B + b, "rockSnare", 0.4 + 0.1 * b));
            if (bar === 7) { drum(B, "kick", 0.9); for (let b = 0; b < 4 - 1e-6; b += 0.25) drum(B + b, "rockSnare", 0.35 + 0.55 * (b / 4)); for (let b = 0; b < 4; b += 1) drum(B + b, "kick", 0.75); }
            compBar(bar, { chug: build });
            driveBar(bar, { ghosts: true, nextPc: 2 });
            if (bar % 2 === 1 || build) brassBar(bar, { vel: 0.64 });
            arpBar(bar, 0.3);
          }
        }
        label = S.v === 1 ? "Tunnel · B minor, half-time, guitar lead" : "Tunnel exit · ♭VI–♭VII climb in twin lead";
      } else if (S.s === "solo") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar === 0) crash(B, 0.8);
          const last = bar === 7;
          groove(bar, { hats: bar < 4 ? "ride" : "8", ghosts: true, open: bar >= 4 && bar % 2 === 1, until: last ? 2 : 4 });
          if (last) { fill(bar, 2, "toms"); }
          compBar(bar, { chug: bar >= 4 });
          driveBar(bar, { ghosts: true, nextPc: 4 });
          if (bar >= 4) brassBar(bar, { vel: 0.6 });
        }
        label = `Lap 3 · ${race % 2 === 0 ? "guitar" : "synth"} solo over the riff changes`;
      } else { // flag
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar < 4) {
            if (bar === 0 || bar === 2) crash(B, 0.8);
            groove(bar, { hats: "16", ghosts: true, tamb: true, until: bar === 3 ? 3 : 4, hatVel: 0.85 });
            if (bar === 3) fill(bar, 3, "snare");
            compBar(bar, { chug: true });
            driveBar(bar, { ghosts: true, nextPc: null });
            brassBar(bar, { vel: 0.7 });
          } else if (bar < 7) {
            riffBar(bar, { brass: true });
            if (bar === 4) crash(B, 0.8);
            RIFF.forEach(([b]) => drum(B + b, "kick", b === 0 ? 0.92 : 0.84));
            [1, 3].forEach((b) => drum(B + b, "rockSnare", 0.88));
            hats(bar, "16", { vel: 0.85 });
          } else { // the line: one big chord, then the toms take it home
            const v = power(B);
            push("rhythm", B, 2.2, v, 0.8);
            brassHit(B, 1.6, 0.8);
            push("bass", B, 2, pickBass(T.chord(sym(B)).bass), 0.95, { art: "thumb" });
            crash(B, 0.9); drum(B, "kick", 0.95);
            fill(bar, 2, "toms");
          }
        }
        label = "Checkered flag · victory lap";
      }

      const res = { events: ev, harmony: prog.map(({ base, ...h }) => h), section: label, state };
      if (idx === 0 && cycle > 0) res.tempo = { bpm: BPM };
      if (idx === FINAL_IDX) res.tempo = { bpm: FINAL_BPM, rampBeats: 4 };
      return res;
    },
  });

  // the section that follows RACE[idx] (for the bass's approach into the next cycle)
  function nextKeyOf(idx) {
    const n = RACE[(idx + 1) % RACE.length];
    return n.s === "A" ? "A" + n.v : n.s === "B" ? "B" + n.v : n.s;
  }
  function nextKey(idx) { return RACE[(idx + 1) % RACE.length].final ? 2 : 0; }
})();
