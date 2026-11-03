// Headland: the view from the cliff path, the whole map laid out below. 112 BPM, E dorian, written for an
// eight-voice sound chip (Sim.spc): every note below competes for one of eight hardware voices, and the
// arrangement is written to be economical the way the old overworld themes had to be. A three-voice pad, a
// bass, a lead, a doubled lead, a two-voice pluck, kick, snare, hat and tom add up to twelve; the chip
// gives eight. Priorities decide who loses: chord stabs outrank the bass (it drops out for the stab and its
// echo covers the gap), the kick outranks the hat, and the second lead exists only where a voice is free.
//
// ---- the ideas, fixed before any code (these never change; the generator only arranges) ----
//
// THE HOOK (A, 8 bars, E dorian). A rising fourth-and-steps cell that leans on the ninth, answered by a fall
// to the seventh; the third phrase reaches a step higher, the fourth turns major on the dorian IV.
//   bar 1  B4 E5 F#5 G5~ F#5       (5 1 2 b3: up from the fifth, lean on the ninth, settle on the third)
//   bar 2  E5 D5 B4 · A4 B4         (the answer falls to the seventh; a breath; the pickup)
//   bar 3  C5~ D5 E5 F#5            (bVI: C lydian, the raised fourth is the colour)
//   bar 4  E5 D5 A4 B4~~            (bVII add9: hangs on its sixth)
//   bar 5  B4 E5 F#5 G5~ A5         (the cell again, pushed up to the eleventh)
//   bar 6  B5 A5 G5 E5 D5           (the top of the arc, falling through Cmaj9)
//   bar 7  C#5~ B4 A4 F#4           (A69: the dorian sixth turns the light on)
//   bar 8  F#4 G4 A4 B4~ ·          (Bm7 to B7: walks back up into the re-strike)
// Harmony: | Em9 | Em9 | Cmaj7#11 | Dadd9 | Em9 | Cmaj9 | A69 | Bm7 B7 |
//
// THE B THEME (G major, 8 bars): the same cell opened out over the relative major, bar 2 quoting the hook's
// answer, then the minor iv and a bVI chord (E♭maj7#11) that darkens the sky before the dominant.
//   D5 G5 A5 B5~ A5 | F#5 D5 B4 · A4 B4 | E5 D5 E5 G5 A5 | G5 Eb5 D5 A4~~ |
//   B4 D5 G5 A5~ B5 | Bb5 G5 F5 D5 Eb5 | E5 C5 B4 G4 A4 | C5 B4 A4 F#4~ · |
// Harmony: | Gmaj9 | Bm7 | Cmaj9 | Cm6 | Gmaj9/B | Ebmaj7#11 | Am9 | D7sus4 D7 |
//
// THE BASS: root on one, the octave on the and of two, the fifth on four, a step into the next root; in
// the breakdown it sings the hook's first bar itself under the echo.
//
// ---- form: one lap = 7 cycles of 8 bars (about 2:00), after a one-time 8-bar intro ----
//   A1  hook, lead alone over a thin band       A2  hook doubled (where a voice is free), pad thins to dyads,
//                                                   stabs cut the bass
//   B   the B theme on the flute voice, pluck   A3  hook, pluck answers in the rests, double on the long notes
//       arpeggios fill the room
//   BRK no pad: bass, kick, hat and pluck; the lead calls the first bar of the hook across the echo;
//       snare build                             B2  the B theme on brass, a third below where free, stabs
//   A4  the hook in octaves (lead + brass), full pad, stabs: the budget at its tightest, then the fill home
// Per cycle the generator chooses only: kick figures, hat density, fills, stab placement, bass shapes,
// arpeggio direction and velocities. The melodies above are never regenerated.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BPM = 112, VOICES = 8;
  const mod12 = T.mod12;

  // ---------- notation: "F4/.5 Bb4/.5 | ..." bars of 4 beats; r = rest; trailing _ ties into the next note ----------
  function mel(text) {
    const out = [];
    text.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let pos = 0;
      bar.split(/\s+/).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(_?)$/.exec(tok);
        if (!m) throw new Error(`headland: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), tie: m[3] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`headland: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; }
      else merged.push({ ...n });
    }
    return merged.filter((n) => n.note != null);
  }

  // ---------- the tunes ----------
  const HOOK7 = "B4/1 E5/.5 F#5/.5 G5/1.5 F#5/.5 | E5/1 D5/.5 B4/.5 r/.5 A4/.5 B4/1 | C5/1.5 D5/.5 E5/1 F#5/1 | E5/1 D5/.5 A4/.5 B4/2 | " +
    "B4/1 E5/.5 F#5/.5 G5/1.5 A5/.5 | B5/1 A5/.5 G5/.5 E5/1 D5/1 | C#5/1.5 B4/.5 A4/1 F#4/1 | ";
  const HOOK = {
    down: mel(HOOK7 + "F#4/1 G4/.5 A4/.5 B4/1.5 r/.5"),   // Bm7 B7: back up into the re-strike
    toB: mel(HOOK7 + "F#4/1 G4/.5 A4/.5 C#5/1.5 r/.5"),   // the ninth of B7 lifts into the B theme
  };
  const BTUNE = mel("D5/.5 G5/.5 A5/1 B5/1.5 A5/.5 | F#5/1 D5/.5 B4/.5 r/.5 A4/.5 B4/1 | E5/1 D5/.5 E5/.5 G5/1 A5/1 | G5/1 Eb5/.5 D5/.5 A4/2 | " +
    "B4/1 D5/.5 G5/.5 A5/1.5 B5/.5 | Bb5/1 G5/.5 F5/.5 D5/1 Eb5/1 | E5/1 C5/.5 B4/.5 G4/1 A4/1 | C5/1 B4/.5 A4/.5 F#4/1.5 r/.5");
  const CALL = mel("B4/1 E5/.5 F#5/.5 G5/1.5 F#5/.5 | E5/1 D5/.5 B4/1.5 r/1"); // the hook's first bar, for the breakdown

  // ---------- harmony ----------
  const PROG = {
    INTRO: "| Em9 | Em9 | Cmaj7#11 | Dadd9 | Em9 | Cmaj9 | A69 | Bm7:2 B7:2 |",
    A: "| Em9 | Em9 | Cmaj7#11 | Dadd9 | Em9 | Cmaj9 | A69 | Bm7:2 B7:2 |",
    B: "| Gmaj9 | Bm7 | Cmaj9 | Cm6 | Gmaj9/B | Ebmaj7#11 | Am9 | D7sus4:2 D7:2 |",
    BRK: "| Em9 | Em9 | Cmaj9 | Cmaj9 | Am9 | Am9 | Bm7 | B7sus4:2 B7:2 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const LAP = ["A1", "A2", "B", "A3", "BRK", "B2", "A4"];
  // who wins a hardware voice when eight are busy (ev.priority overrides: the stabs use 5, so they cut the
  // bass before the pad; the pad outranks the bass so a held chord never loses a voice to a bass note)
  const PRIORITY = { lead: 6, flute: 6, brass: 6, kick: 5, snare: 5, pad: 4, bass: 3, tom: 2, pluck: 2, hat: 1, lead2: 1, third: 1 };

  Sim.register({
    id: "headland",
    title: "Headland",
    genre: "16-bit overworld",
    about: "An overworld theme in E dorian for an eight-voice sound chip: a hook that leans on the ninth and turns major on the dorian sixth, a B theme over the relative major darkened by a ♭VI chord, and an arrangement forced to be economical by the hardware voice budget, so the bass drops out for every chord stab, the hat gives way to the kick, and the lead is doubled only where a voice is free. Everything leaves through the chip's echo and a 32 kHz-ish lo-fi stage.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["explore", "hangout"],
    energy: 0.55,

    instruments(ctx) {
      const chip = Sim.spc.chip(ctx, {
        voices: VOICES, volume: -8, rate: 32000, bits: 8, crush: 0.45, tone: 7000,
        echo: { time: 0.128, feedback: 0.42, tone: 2200, level: -7 },
      });
      const lead = chip.voice("lead", { priority: PRIORITY.lead, echo: 0.55, pan: 0.08, volume: 0, cutoff: 4800, vibrato: { rate: 5.4, depth: 0.09, delay: 0.32 } });
      const lead2 = chip.voice("lead", { priority: PRIORITY.lead2, echo: 0.4, pan: -0.3, volume: -4, wave: "pulse", cutoff: 3800, detune: 9, vibrato: { rate: 5.4, depth: 0.09, delay: 0.32 } });
      const flute = chip.voice("flute", { priority: PRIORITY.flute, echo: 0.6, pan: 0.05, volume: 0 });
      const brass = chip.voice("brass", { priority: PRIORITY.brass, echo: 0.35, pan: -0.1, volume: -2 });
      const third = chip.voice("clarinet", { priority: PRIORITY.third, echo: 0.45, pan: 0.3, volume: -5 });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.3, pan: 0.15, volume: -5, cutoff: 3000 });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.6, pan: -0.35, volume: 0 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.22, pan: 0, volume: -2 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: 4, note: 38 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.3, pan: 0.04, volume: 3 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.2, volume: 1 });
      const tom = chip.voice("tom", { priority: PRIORITY.tom, echo: 0.3, pan: 0.2, volume: 2 });
      const chipHum = { timing: 0.002, vel: 0.04 }; // a chip does not breathe; the velocities already do
      return {
        lead: { layer: "melody", play: lead.play, humanize: chipHum },
        lead2: { layer: "melody", play: lead2.play, humanize: chipHum },
        flute: { layer: "melody", play: flute.play, humanize: chipHum },
        brass: { layer: "melody", play: brass.play, humanize: chipHum },
        third: { layer: "melody", play: third.play, humanize: chipHum },
        pad: { layer: "harmony", play: pad.play, humanize: chipHum },
        pluck: { layer: "texture", play: pluck.play, humanize: chipHum },
        bass: { layer: "bass", play: bass.play, humanize: chipHum },
        kick: { layer: "drums", play: kick.play, humanize: chipHum },
        snare: { layer: "drums", play: snare.play, humanize: chipHum },
        hat: { layer: "drums", play: hat.play, humanize: chipHum },
        tom: { layer: "drums", play: tom.play, humanize: chipHum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const intro = cycle === 0;
      const idx = intro ? -1 : (cycle - 1) % LAP.length, lap = intro ? 0 : Math.floor((cycle - 1) / LAP.length);
      const S = intro ? "INTRO" : LAP[idx];
      const isA = S[0] === "A", isB = S[0] === "B" && S !== "BRK";
      const prog = PROGS[intro ? "INTRO" : isA ? "A" : isB ? "B" : "BRK"].map((e) => ({ ...e }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ch = (b) => T.chord(sym(b));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      if (state.bass == null) Object.assign(state, { bass: 40, pv: null, lastFill: null, stolen: 0, dropped: 0 });
      const nextSection = intro ? "A1" : LAP[(idx + 1) % LAP.length];
      const nextFirst = T.chord(PROGS[nextSection[0] === "A" ? "A" : nextSection === "BRK" ? "BRK" : "B"][0].chord);

      // ================= melodies =================
      const playTune = (track, notes, o = {}) => {
        notes.forEach((n) => {
          const inBar = n.beat % BPB;
          const vel = (o.vel ?? 0.8) + (inBar === 0 ? 0.05 : 0) + (n.dur >= 1.5 ? 0.04 : 0) + (n.dur <= 0.5 ? -0.04 : 0);
          push(track, n.beat + (o.offset || 0), Math.max(0.2, n.dur * (n.dur <= 0.5 ? 0.85 : 0.94)), n.note + (o.shift || 0), vel);
        });
      };
      /** Call after everything else is written: is one hardware voice free for the whole of [abs, abs+dur]? */
      const roomFor = () => {
        const L = Sim.spc.ledger(ev, { voices: VOICES, bpb: BPB });
        return (abs, dur) => [abs + 0.01, abs + dur / 2, abs + dur - 0.05].every((t) => L.free(t) >= 1);
      };
      /** The second lead, slightly sharp and on the other side: only the notes the chip has a voice for. */
      const double = (notes, o = {}) => {
        const room = roomFor();
        notes.filter((n) => (!o.longOnly || n.dur >= 1.5) && (!o.bars || o.bars.includes(Math.floor(n.beat / BPB))))
          .forEach((n) => { const d = Math.max(0.2, n.dur * 0.9); if (room(n.beat, d)) push("lead2", n.beat, d, n.note, 0.6); });
      };
      /** A harmony line below the tune on the clarinet voice, the nearest chord tone a third to a fifth below, where a voice is free. */
      const thirds = (notes) => {
        const room = roomFor();
        notes.forEach((n) => {
          const c = ch(n.beat), m = T.nearest(n.note - 4, c.pcs, n.note - 7, n.note - 3), d = Math.max(0.2, n.dur * 0.9);
          if (m != null && Number.isFinite(m) && room(n.beat, d)) push("third", n.beat, d, m, 0.55);
        });
      };

      // ================= pad =================
      /** The pad voices the plain chord (no ninths or #11s: those are the lead's colours, and a chip pad is three voices). */
      const plain = (s) => s.replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/add9/, "").replace(/69/, "6").replace(/#11/, "");
      const voicing = (b, n = 3, lo = 55, hi = 74) => {
        const v = T.voice(plain(sym(b)), { lo, hi, n, rootless: true, prev: state.pv, spread: "close", top: [64, 74], omitBass: true });
        state.pv = v;
        return v;
      };
      /** Long chords following the harmony, n voices wide, leaving a gap before each change; in the A sections
       *  the pad sits out the first half of bar 8 (a breath before the dominant, under the hook's walk-up). */
      const padBar = (bar, n, vel, o = {}) => prog.filter((e) => e.bar === bar).forEach((e) => {
        if (isA && bar === 7 && e.beat === 0) return;
        const dur = o.until != null ? Math.min(e.dur - 0.3, o.until - e.beat - 0.25) : e.dur - 0.3;
        if (dur >= 0.4) push("pad", bar * BPB + e.beat, dur, voicing(bar * BPB + e.beat, n), vel);
      });
      /** A chord stab: three voices at the drums' priority, so it steals the hat, the double and the bass. */
      const stab = (abs, vel = 0.62, dur = 0.3) => push("pad", abs, Math.min(dur, BPB - (abs % BPB) - 0.1), voicing(abs, 3), vel, { priority: 5 });
      const STABS = [[[2.5], 3], [[2.5, 3.5], 2], [[1.5, 3.5], 2], [[3.5], 1.5], [[0.5, 2.5], 1]];

      // ================= pluck =================
      /** Eighth-note arpeggio of the chord's tones between E4 and B5, direction chosen per bar. */
      const arpBar = (bar, vel, o = {}) => {
        const B = bar * BPB, c = ch(B);
        const tones = T.notesIn(c.pcs, 64, 83);
        const up = o.dir ?? (bar % 2 === 0);
        const seq = up ? tones : tones.slice().reverse();
        const step = o.sixteenths ? 0.25 : 0.5, n = BPB / step;
        for (let s = 0; s < n; s++) {
          if (o.until != null && s * step >= o.until) break;
          const k = o.bounce ? (s % (2 * seq.length - 2) < seq.length ? s % (2 * seq.length - 2) : 2 * seq.length - 2 - (s % (2 * seq.length - 2))) : s % seq.length;
          push("pluck", B + s * step, step * 0.8, seq[k], vel * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.85 : 0.72));
        }
      };
      /** The pluck answers the hook's rests with the cell inverted (bars 2 and 4 of the hook). */
      const answer = (bar) => {
        const B = bar * BPB, c = ch(B);
        const top = T.nearest(79, [c.root], 74, 86);
        [[2, 0.5, 0], [2.5, 0.5, -1], [3, 0.5, -2], [3.5, 0.5, -3]].forEach(([b, d, k]) => push("pluck", B + b, d * 0.9, T.step(top, k, c.scale), 0.6 - 0.03 * Math.abs(k)));
      };

      // ================= bass =================
      const near = (pc, from = state.bass, lo = 31, hi = 45) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 38); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const bassAt = (b) => near(ch(b).bass);
      const rootAfter = (bar, from) => near(bar < 7 ? ch((bar + 1) * BPB).bass : nextFirst.bass, from);
      /** Root on one, the octave on the and of two, the fifth on four, a step into the next root. */
      const bassBar = (bar, o = {}) => {
        const B = bar * BPB, R = bassAt(B);
        const chg = prog.filter((e) => e.bar === bar && e.beat > 0)[0];
        const R2 = chg ? near(ch(B + chg.beat).bass, R) : R;
        const N = rootAfter(bar, R2);
        const approach = N === R2 ? R2 + 7 : N > R2 ? N - (r.chance(0.5) ? 1 : 2) : N + (r.chance(0.5) ? 1 : 2);
        const fig = o.thin
          ? [[0, 1.5, R, 0.88], [2, 1, R2, 0.8], [3, 1, R2 + 7, 0.72]]
          : r.weighted([
            [[[0, 1, R, 0.9], [1.5, 0.5, R + 12, 0.7], [2, 1, R2, 0.84], [3, 0.5, R2 + 7, 0.74], [3.5, 0.5, approach, 0.7]], 3],
            [[[0, 0.75, R, 0.9], [0.75, 0.25, R, 0.5], [1.5, 0.5, R + 12, 0.7], [2.5, 0.5, R2, 0.84], [3, 1, R2 + 7, 0.74]], 2],
            [[[0, 1, R, 0.9], [1.5, 0.5, R, 0.66], [2, 0.5, R2 + 12, 0.76], [2.5, 0.5, R2, 0.8], [3, 0.5, R2 + 7, 0.7], [3.5, 0.5, approach, 0.72]], 1.5],
          ]);
        fig.forEach(([b, d, n, v]) => { if (o.until == null || b < o.until) push("bass", B + b, d * 0.92, n, v + (o.lift || 0)); });
        state.bass = R2;
      };
      /** The breakdown: the bass sings the hook's first bar under the echo. */
      const bassCell = (bar) => {
        const B = bar * BPB, c = ch(B), R = near(c.root, state.bass, 31, 41), third = c.intervals.includes(3) ? 15 : 16;
        [[0, 1, 7], [1, 0.5, 12], [1.5, 0.5, 14], [2, 1.5, third], [3.5, 0.5, 14]].forEach(([b, d, k]) => push("bass", B + b, d * 0.9, R + k - 12, 0.8 + (d >= 1 ? 0.06 : 0)));
        state.bass = R;
      };

      // ================= drums =================
      const drum = (track, abs, vel, extra) => push(track, abs, track === "hat" && extra?.open ? 0.5 : 0.25, track, vel, extra);
      const KICKS = [[[0, 2.5], 3], [[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 2, 2.5], 1], [[0, 1.5, 3.5], 1]];
      const hats = (bar, mode, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        const step = mode === "16" ? 0.25 : mode === "4" ? 1 : 0.5;
        for (let b = 0; b < until - 1e-6; b += step) {
          if (o.open && b === 3.5) { drum("hat", B + b, 0.5, { open: true }); continue; }
          drum("hat", B + b, (b % 1 === 0 ? 0.6 : b % 0.5 === 0 ? 0.42 : 0.3) * (o.vel ?? 1));
        }
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        (o.kicks || r.weighted(KICKS)).filter((k) => k < until).forEach((k, i) => drum("kick", B + k, i === 0 ? 0.95 : 0.8));
        [1, 3].filter((b) => b < until).forEach((b) => drum("snare", B + b, o.snare ?? 0.85));
        if (o.ghosts) [1.75, 2.75, 3.75].forEach((b) => { if (b < until && r.chance(0.28)) drum("snare", B + b, 0.22); });
        if (o.hats !== false) hats(bar, o.hats || "8", { open: o.open, until, vel: o.hatVel });
      };
      const fill = (bar, from, kind) => {
        const B = bar * BPB;
        if (kind === "snare") for (let b = from; b < 4 - 1e-6; b += 0.25) drum("snare", B + b, 0.4 + 0.5 * ((b - from) / (4 - from)));
        else if (kind === "toms") {
          const P = [62, 59, 55, 50, 47, 43, 43, 40], steps = Math.round((4 - from) * 4);
          for (let i = 0; i < steps; i++) { const b = from + i * 0.25; if (i === 0) drum("snare", B + b, 0.7); else drum("tom", B + b, 0.62 + 0.03 * i, { pitch: P[Math.min(7, Math.floor((i * 8) / steps))] }); }
          drum("kick", B + from, 0.8);
        } else { // hits: kick, snare and a stab together on the last three eighths
          [2.5, 3, 3.5].filter((b) => b >= from).forEach((b) => { drum("kick", B + b, 0.9); drum("snare", B + b, 0.85); stab(B + b, 0.7, 0.28); });
        }
      };
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill)); state.lastFill = k; return k; };

      // ================= sections =================
      let label = "";
      if (intro) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          arpBar(bar, 0.55, { bounce: true });
          padBar(bar, 3, 0.5);
          if (bar >= 2) hats(bar, "8", { vel: 0.7 });
          if (bar >= 4) { bassBar(bar, { thin: true, until: bar === 7 ? 2 : 4 }); drum("kick", B, 0.8); drum("kick", B + 2.5, 0.65); }
          if (bar === 7) fill(bar, 2, "toms");
        }
        label = "Intro · the pluck draws the coastline";
      } else if (isA) {
        const v = Number(S[1]); // 1..4
        const tune = HOOK[v === 2 ? "toB" : "down"];
        playTune("lead", tune, { vel: 0.8 + 0.02 * (v - 1) });
        if (v === 4) playTune("brass", tune, { vel: 0.7, shift: -12 }); // the hook in octaves
        const DYAD_BARS = [0, 1, 4, 5]; // A2: the pad thins to dyads under the cell so the double can have the voice
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, last = bar === 7;
          const fillKind = last ? pickFill(v === 1 ? ["toms", "snare"] : v === 4 ? ["hits", "toms", "snare"] : ["snare", "toms", "hits"]) : null;
          const from = fillKind === "hits" ? 2.5 : fillKind ? r.pick([2, 3]) : 4;
          if (v === 1) {
            padBar(bar, 3, 0.48);
            groove(bar, { kicks: [0, 2.5], snare: 0.55, hats: "8", until: from, hatVel: 0.8 });
            bassBar(bar, { thin: bar < 4 && lap === 0, until: from });
          } else if (v === 2) {
            padBar(bar, DYAD_BARS.includes(bar) ? 2 : 3, 0.5);
            groove(bar, { hats: "8", open: bar % 2 === 1, until: from, ghosts: lap > 0 });
            bassBar(bar, { until: from });
            if ((bar === 3 || bar === 6) && bar < 7) r.weighted(STABS).forEach((p) => stab(B + p)); // three-voice bars: the stabs cut the bass
          } else if (v === 3) {
            padBar(bar, 3, 0.5);
            groove(bar, { hats: lap % 2 ? "16" : "8", hatVel: 0.85, ghosts: true, until: from });
            bassBar(bar, { until: from });
            if (bar === 1 || bar === 3) answer(bar);
            if (bar >= 4 && bar < 7) arpBar(bar, 0.42, { until: 4, dir: bar % 2 === 1 });
          } else {
            const stabs = bar < 7 ? r.weighted(STABS) : [];
            padBar(bar, 3, 0.55, { until: stabs[0] }); // the pad holds up to the first stab, then the stabs are the chord
            groove(bar, { hats: "16", hatVel: 0.8, ghosts: true, open: bar % 2 === 1, until: from, kicks: r.weighted([[[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 2, 2.5], 1]]) });
            bassBar(bar, { until: from, lift: 0.04 });
            stabs.forEach((p, i) => stab(B + p, 0.66, i === stabs.length - 1 ? 0.6 : 0.3));
            if (bar === 0 || bar === 4) drum("tom", B + 3.5, 0.6, { pitch: 55 });
          }
          if (fillKind) fill(bar, from, fillKind);
        }
        if (v === 2) double(tune, { bars: DYAD_BARS });
        if (v === 3) double(tune, { longOnly: true });
        label = ["", `Lap ${lap + 1} · the hook from the cliff path`, "The hook doubled where a voice is free · stabs cut the bass", "Return · the pluck answers in the rests", "The hook in octaves · the budget at its tightest"][v];
      } else if (isB) {
        const second = S === "B2";
        playTune(second ? "brass" : "flute", BTUNE, { vel: second ? 0.76 : 0.8 });
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, last = bar === 7;
          const fillKind = last ? pickFill(second ? ["hits", "toms"] : ["toms", "snare"]) : null;
          const from = fillKind === "hits" ? 2.5 : fillKind ? 2 : 4;
          padBar(bar, second ? 3 : 2, second ? 0.52 : 0.46); // dyads under the arpeggio, so the kick never silences it
          if (!second) arpBar(bar, 0.46, { dir: bar % 2 === 0, bounce: true, until: from });
          groove(bar, { hats: second ? "16" : "8", open: second && bar % 2 === 1, ghosts: second, until: from, hatVel: second ? 0.8 : 0.9, snare: second ? 0.85 : 0.75 });
          bassBar(bar, { until: from });
          if (second && (bar === 3 || bar === 5)) r.weighted(STABS).forEach((p) => stab(B + p, 0.64));
        }
        if (second) thirds(BTUNE);
        label = second ? "B theme on brass · a third below where the chip allows" : "B theme · the relative major, a ♭VI darkens the sky";
      } else { // BRK
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar < 6) { drum("kick", B, 0.88); drum("kick", B + 2.5, 0.7); if (bar >= 4) drum("kick", B + 3.5, 0.6); }
          if (bar < 7) hats(bar, bar < 4 ? "4" : "8", { vel: 0.75 });
          if (bar % 2 === 0 && bar < 6) bassCell(bar); else bassBar(bar, { until: bar === 7 ? 2 : 4 });
          arpBar(bar, bar < 4 ? 0.4 : 0.48, { sixteenths: bar >= 4, bounce: true });
          if (bar === 1 || bar === 4) playTune("lead", CALL, { offset: B, vel: 0.72, shift: bar === 4 ? -7 : 0 }); // the call, then a fourth up (an octave down) over Am9
          if (bar === 6) { drum("snare", B + 1, 0.55); drum("snare", B + 3, 0.7); }
          if (bar === 7) { groove(bar, { kicks: [0, 1], until: 2, hats: "8" }); fill(bar, 2, "snare"); }
        }
        label = "Breakdown · the bass sings the hook under the echo";
      }

      // the chip: eight voices, stolen by priority; the score shows what survived
      const bud = Sim.spc.budget(ev, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      return { events: bud.events, harmony: prog, section: label, state };
    },
  });
})();
