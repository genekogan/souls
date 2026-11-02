// Second Ring Road: the elevated expressway around a city at two in the morning, driven fast and
// without hurry. 128 BPM, E minor (dorian), for an imagined eight-voice sound chip (Sim.spc): seven
// chip voices plus one lead synth of its own that is sent through the chip's lo-fi output and its echo.
//
// THE IDEA. The road does not move; the sky does. The bass riff pedals on E for whole sections while
// the harmony above it changes: Em9, then Cmaj9 over the same E (the pedal becomes a major third), then
// A9 over E (the dorian IV, the pedal becomes a fifth). The riff is written as scale steps from the pedal,
// so its sixth is C# over E minor and C over the C chord: the same riff, lit differently. The B section
// finally lets the bass leave: the key drops a major third to C, a pad appears that was not there, and
// the chords walk the cycle of major thirds C → (F) → Ab → C/E → B7 and home to E: three keys a third
// apart, closed in eight bars.
//
// ---- fixed by hand (the generator never changes a pitch or a rhythm; it only arranges) ----
//
// THE HOOK (A, 8 bars, E dorian over the E pedal; Sim.phrasing marks: ~ slur, ^ scoop, f fall, v vibrato,
// > accent, . staccato, _ tenuto, b2 bend up a whole tone):
//   | Em9       | Em9                  | Cmaj9/E          | Cmaj9/E          |
//   | . B4 E5~ G5^v F#5~ E5~ | D5_ . B4 D5. C#5. E5 | . G5 B5^v A5~ | G5~ E5~ D5f . . |
//   | Em9       | Em9                  | A9/E             | A9/E             |
//   | . B4 E5~ G5^v A5~ B5~ | C#6> B5~ A5~ G5~ F#5~ | E5^v F#5~ G5~ A5~ C#6~ | B5_ A5~ G5~ E5f . |
//   bar 1: a pickup from the fifth, a scoop into the third held with vibrato, two slurred steps down.
//   bar 2: the seventh, a breath, then the riff's own turn (D C#, staccato) in the lead's octave, up into E.
//   bar 3: up to B5, the major seventh of the C chord: the first hint of sky.   bar 4: falls to D and rests.
//   bar 5: the cell again, climbing.   bar 6: the top: C#6 accented, the strange bright note, falling.
//   bar 7: over A9 the same C# arrives as the chord's own third (the strange note comes home).
//   bar 8: falls back to E; A′ instead holds the leading tone D#5 over B7, which resolves up into the B theme.
//
// THE B THEME (8 bars; | Cmaj9 | Cmaj9 | Fmaj9 | Fmaj9 | Abmaj9 | Abmaj9 | Cmaj9/E | B7sus4 B7 |):
//   | E5^v (3 beats) D5~ C5~ | D5~ G5v . | A5^ G5~ E5~ C5~ | D5 b2 v (a 13th bent up into the seventh) . E5 G5~ |
//   | Bb5^v Ab5~ G5~ Eb5~ | F5~ Eb5~ C5v | E5^ G5~ B5v A5~ G5~ | F#5_ E5~ D#5~ B4f |
//
// THE RIFF (bass, 2 bars, scale steps from the chord's bass note; 7 = the octave):
//   | 1 . . 1 8 . 1 . . . 3 . 4 . 5 . | 1 . . 1 8 . 7 . . . 6 . 7 . 5 . |   (sixteenths; over E dorian:
//   E E E' E G A B | E E E' D C# D B).  The cadence bar walks B B B' A G# F# D# into E.
//
// FORM: one lap = 7 cycles of 8 bars (1:45), after a one-time 8-bar intro.
//   A1 the hook over the riff, lean          A2 the hook, offbeat pluck, the brass finishes its sentences
//      (Sim.dialogue.respond); the bass leaves the pedal for the first time: Am9, B7
//   B  the sky opens: C major, the pad, long bass, the lead with rubato (Sim.groove)
//   A3 the hook back, brass dyad stabs, claps, ghost snares
//   BRK drums and riff; the lead calls the hook's first bars across the echo, the brass answers; snare build
//   B2 the B theme passed between the lead and the brass mid-phrase (Sim.dialogue.distribute, handoff)
//   A4 the hook with the sky still open: the pad stays, sixteenth hats, the brass answers inverted
// Per cycle the generator chooses only kick figures, hat density, fills, stab placement, ghost notes,
// pluck direction, which rests the brass answers in, where the handoffs fall, and velocities.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose, P = Sim.phrasing, G = Sim.groove, D = Sim.dialogue, S = Sim.spc;
  const BPB = 4, BPM = 128, VOICES = 8;
  const mod12 = T.mod12;

  // ---------- the tunes (Sim.phrasing notation, one string per bar) ----------
  const HOOK7 = [
    "r/0.5 B4/0.5 E5/0.5~ G5/1.5^v F#5/0.5~ E5/0.5~",
    "D5/1_ r/0.5 B4/0.5 D5/0.5. C#5/0.5. E5/1",
    "r/0.5 G5/0.5 B5/2^v A5/1~",
    "G5/1~ E5/0.5~ D5/0.5f r/2",
    "r/0.5 B4/0.5 E5/0.5~ G5/1.5^v A5/0.5~ B5/0.5~",
    "C#6/1> B5/0.5~ A5/0.5~ G5/1~ F#5/1~",
  ];
  const HOOK = {
    down: HOOK7.concat(["E5/1^v F#5/0.5~ G5/0.5~ A5/1~ C#6/1~", "B5/1_ A5/0.5~ G5/0.5~ E5/0.5f r/1.5"]),   // A9/E: the C# comes home
    toB: HOOK7.concat(["E5/1^v F#5/0.5~ G5/0.5~ A5/1~ C6/1~", "B5/1_ A5/0.5~ F#5/0.5~ D#5/2v"]),          // Am9, B7: the leading tone held
  };
  const BTUNE = [
    "E5/3^v D5/0.5~ C5/0.5~",
    "D5/1~ G5/2.5v r/0.5",
    "A5/1.5^ G5/0.5~ E5/1~ C5/1~",
    "D5/2.5b2v r/0.5 E5/0.5 G5/0.5~",
    "Bb5/2^v Ab5/0.5~ G5/1~ Eb5/0.5~",
    "F5/1.5~ Eb5/0.5~ C5/2v",
    "E5/1^ G5/0.5~ B5/1.5v A5/0.5~ G5/0.5~",
    "F#5/1.5_ E5/0.5~ D#5/1~ B4/1f",
  ];
  const MARKS_A = [{ from: 0, to: 16, dyn: "arch" }, { from: 16, to: 32, dyn: "arch" }];
  const MARKS_B = [{ from: 0, to: 8, dyn: "arch" }, { from: 8, to: 15.5, dyn: "<" }, { from: 15.5, to: 24, dyn: "arch" }, { from: 24, to: 32, dyn: ">" }];
  // the riff: [offset within two bars, dur, scale steps from the chord's bass note]
  const RIFF = [
    [0, 0.5, 0], [0.75, 0.25, 0], [1, 0.5, 7], [1.5, 0.75, 0], [2.5, 0.5, 2], [3, 0.5, 3], [3.5, 0.5, 4],
    [4, 0.5, 0], [4.75, 0.25, 0], [5, 0.5, 7], [5.5, 0.75, 6], [6.5, 0.5, 5], [7, 0.5, 6], [7.5, 0.5, 4],
  ];
  const CADENCE = [[0, 0.5, 35], [0.75, 0.25, 35], [1, 0.5, 47], [1.5, 0.75, 45], [2.5, 0.5, 44], [3, 0.5, 42], [3.5, 0.5, 39]]; // B B B' A G# F# D#

  // ---------- harmony ----------
  const PROG = {
    INTRO: "| Em9 | Em9 | Em9 | Em9 | Cmaj9/E | Cmaj9/E | A9/E | A9/E |",
    A: "| Em9 | Em9 | Cmaj9/E | Cmaj9/E | Em9 | Em9 | A9/E | A9/E |",
    Ax: "| Em9 | Em9 | Cmaj9/E | Cmaj9/E | Em9 | Em9 | Am9 | B7sus4:2 B7:2 |",
    B: "| Cmaj9 | Cmaj9 | Fmaj9 | Fmaj9 | Abmaj9 | Abmaj9 | Cmaj9/E | B7sus4:2 B7:2 |",
    BRK: "| Em9 | Em9 | Em9 | Em9 | Em9 | Em9 | Am9 | B7sus4:2 B7:2 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const LAP = ["A1", "A2", "B", "A3", "BRK", "B2", "A4"];
  const PROG_OF = { INTRO: "INTRO", A1: "A", A2: "Ax", B: "B", A3: "A", BRK: "BRK", B2: "B", A4: "A" };
  // who keeps a hardware voice when all eight are busy
  const PRIORITY = { lead: 7, kick: 6, snare: 6, bass: 5, clap: 4, pad: 4, brass: 4, tom: 3, pluck: 2, hat: 1 };

  Sim.register({
    id: "second-ring-road",
    title: "Second Ring Road",
    genre: "Night-highway chip",
    about: "The elevated expressway around a city at two in the morning, at 128 BPM through an eight-voice sound chip. The bass riff pedals on E while the harmony above it changes colour (E minor, then C major and A9 over the same pedal); the B section opens the sky a major third down into C, brings in a pad that was not there, and walks the cycle of major thirds C → A♭ → E back to the road. A lead that scoops, slurs, bends and falls off; brass that finishes the lead's sentences and takes the B theme from it mid-phrase; a drum part with a pocket.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["chase", "explore"],
    energy: 0.75,

    instruments(ctx) {
      const chip = S.chip(ctx, {
        voices: VOICES - 1, volume: -6, rate: 32000, bits: 8, crush: 0.4, tone: 7400,
        echo: { time: 0.112, feedback: 0.4, tone: 2600, level: -8 }, // 7 × 16 ms: a sixteenth at 128
      });
      // the lead: a pulse-loop mono synth of its own, played through Sim.phrasing (scoops, slurs, bends, falls,
      // late vibrato), then into the chip's bus and echo so it shares the console's lo-fi output stage
      const leadSyn = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.64, 0.21, 0.08, 0.2, 0.17, 0.06, 0.03, 0.1] },
        filter: { type: "lowpass", rolloff: -12, Q: 1.3 },
        envelope: { attack: 0.008, decay: 0.12, sustain: 0.75, release: 0.12 },
        filterEnvelope: { attack: 0.005, decay: 0.18, sustain: 0.55, release: 0.12, baseFrequency: 900, octaves: 2.2 },
      }));
      const lead = P.wrap(ctx, leadSyn, {
        volume: -9, glide: 0.05, scoopTime: 0.08, fallTime: 0.22, bendTime: 0.45, release: 0.12,
        vibrato: { rate: 5.6, depth: 0.08, delay: 0.26, rise: 0.35, deepen: 1.3 },
      });
      const leadPan = ctx.keep(new Tone.Panner(0.06)).connect(chip.bus);
      lead.out.connect(leadPan);
      const leadEcho = ctx.keep(new Tone.Gain(0.5)); leadPan.connect(leadEcho); leadEcho.connect(chip.echo);

      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.15, volume: -1, grit: 6, cutoff: 180, octaves: 2.4 });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.4, pan: -0.15, volume: -6, cutoff: 2800, attack: 0.25, release: 0.4 });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.55, pan: 0.35, volume: -3 });
      const brass = chip.voice("brass", { poly: 2, priority: PRIORITY.brass, echo: 0.3, pan: -0.25, volume: -3 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: 3, note: 40, decay: 0.26 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.2, pan: 0.03, volume: 2 });
      const clap = chip.voice("snare", { priority: PRIORITY.clap, echo: 0.35, pan: -0.1, volume: -2, decay: 0.11, tone: 1700, sweep: 500, body: 160 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.22, volume: 0 });
      const tom = chip.voice("tom", { priority: PRIORITY.tom, echo: 0.25, pan: 0.2, volume: 1 });
      const chipHum = { timing: 0.002, vel: 0.04 };
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.004, vel: 0.04 } },
        brass: { layer: "melody", play: brass.play, humanize: chipHum },
        pad: { layer: "harmony", play: pad.play, humanize: chipHum },
        pluck: { layer: "texture", play: pluck.play, humanize: chipHum },
        bass: { layer: "bass", play: bass.play, humanize: chipHum },
        kick: { layer: "drums", play: kick.play, humanize: chipHum },
        snare: { layer: "drums", play: snare.play, humanize: chipHum },
        clap: { layer: "drums", play: clap.play, humanize: chipHum },
        hat: { layer: "drums", play: hat.play, humanize: chipHum },
        tom: { layer: "drums", play: tom.play, humanize: chipHum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const intro = cycle === 0;
      const idx = intro ? -1 : (cycle - 1) % LAP.length, lap = intro ? 0 : Math.floor((cycle - 1) / LAP.length);
      const SEC = intro ? "INTRO" : LAP[idx];
      const isA = SEC[0] === "A", isB = SEC === "B" || SEC === "B2";
      const prog = PROGS[PROG_OF[SEC]].map((e) => ({ ...e }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ch = (b) => T.chord(sym(b));
      const scaleAt = (b) => ch(b).scale;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      if (state.pv === undefined) Object.assign(state, { pv: null, lastFill: null, stolen: 0, dropped: 0 });
      const nextSec = intro ? "A1" : LAP[(idx + 1) % LAP.length];
      const nextFirstBass = T.chord(PROGS[PROG_OF[nextSec]][0].chord).bass;

      // ================= lead =================
      const leadAttacks = [];
      /** A hand-written line through Sim.phrasing: notation → events → articulation (slurs, scoops, falls, breaths). */
      const leadLine = (bars, marks, o = {}) => {
        const line = P.line(bars, { beatsPerBar: BPB, track: "lead", vel: o.vel ?? 0.78 });
        const out = P.articulate(line, marks, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1, glide: 0.05, breathLate: 0.03, breathGap: 0.12 });
        if (o.shiftBars) out.forEach((e) => { e.bar += o.shiftBars; });
        return out;
      };
      const sing = (evs) => { evs.forEach((e) => { ev.push(e); leadAttacks.push(e.bar * BPB + e.beat); }); return evs; };
      /** The brass finishes the lead's sentences: an answer in every rest long enough (Sim.dialogue.respond). */
      const answers = (leadEvs, transform, o = {}) => {
        const out = D.respond(leadEvs, { bpb: BPB, breath: 0.75, track: "brass", minGap: 1, end: o.end ?? 32.5, scaleAt, range: [57, 81], transform, gap: 0, vel: o.vel ?? 0.6 });
        out.forEach((n) => { const { at, idx: _i, answer, ...rest } = n; ev.push({ ...rest, dur: Math.max(0.2, rest.dur * 0.85) }); });
        return out;
      };

      // ================= pad and brass =================
      /** The pad voices the plain seventh chord (the ninths are the lead's); in the last A only triads, so the
       *  riff's dorian sixth has no held seventh a ninth above it to rub against. */
      const plain = (s, triad) => (triad ? s.replace(/maj9|maj7/, "").replace(/m9|m7/, "m").replace(/^([A-G][#b]?)9/, "$1")
        : s.replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/^([A-G][#b]?)9/, "$17"));
      const voicing = (b, n = 3, triad = false) => {
        const v = T.voice(plain(sym(b), triad), { lo: 58, hi: 77, n, rootless: true, prev: state.pv, spread: "close", top: [66, 76], omitBass: true });
        state.pv = v;
        return v;
      };
      const padBar = (bar, vel, o = {}) => prog.filter((e) => e.bar === bar).forEach((e) => {
        const dur = e.dur - 0.25;
        if (dur >= 0.5) push("pad", bar * BPB + e.beat, dur, voicing(bar * BPB + e.beat, 3, o.triad), vel);
      });
      /** The chord's guide tones as a dyad for the brass (two chip voices). */
      const dyad = (b) => {
        const c = ch(b);
        const a = T.nearest(64, [c.guide[0]], 58, 70);
        let d = T.nearest(a + 5, [c.guide[1] ?? mod12(c.root + 7)], a + 2, a + 10);
        if (d - a < 2) d += 12;
        return [a, d];
      };
      const stab = (abs, vel = 0.6, dur = 0.3, force = false) => {
        if (!force && leadAttacks.some((x) => Math.abs(x - abs) < 0.3)) return; // never on top of the tune's attacks
        push("brass", abs, Math.min(dur, BPB - (abs % BPB) - 0.05), dyad(abs), vel);
      };
      const STABS = [[[2.5], 3], [[1.5, 3.5], 2], [[2.5, 3.5], 2], [[3.5], 1.5], [[0.5, 2.5], 1]];

      // ================= pluck =================
      /** Chord tones E4–B5: "off8" plays the offbeat eighths only, "8" eighths, "16" sixteenths; direction per bar. */
      const arpBar = (bar, vel, o = {}) => {
        const B = bar * BPB, step = o.mode === "16" ? 0.25 : 0.5, n = BPB / step;
        const down = o.down ?? bar % 2 === 1;
        for (let s = 0; s < n; s++) {
          const b = B + s * step;
          if (o.until != null && s * step >= o.until) break;
          if (o.mode === "off8" && s % 2 === 0) continue;
          const c = ch(b), tones = T.notesIn(c.pcs, 64, 83), L = tones.length;
          const k = o.bounce ? (s % (2 * L - 2) < L ? s % (2 * L - 2) : 2 * L - 2 - (s % (2 * L - 2))) : s % L;
          const seq = down ? tones.slice().reverse() : tones;
          push("pluck", b, step * 0.8, seq[k], vel * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.86 : 0.74));
        }
      };

      // ================= bass =================
      const bassRoot = (b) => T.nearest(40, [ch(b).bass], 34, 46);
      /** The riff over two bars from `bar`, as scale steps from the chord's bass note at each note's own time. */
      const riff = (bar, o = {}) => {
        const B = bar * BPB;
        RIFF.forEach(([off, d, st]) => {
          if (o.until != null && off >= o.until) return;
          const b = B + off, c = ch(b), R = bassRoot(b);
          const n = st === 7 ? R + 12 : T.step(R, st, c.scale);
          const v = (off % 4 === 0 ? 0.92 : st === 7 ? 0.74 : off % 1 === 0 ? 0.82 : 0.7) + (o.lift || 0);
          push("bass", b, d * 0.9, n, v);
        });
      };
      const cadenceBar = (bar, o = {}) => CADENCE.forEach(([off, d, n]) => { if (o.until == null || off < o.until) push("bass", bar * BPB + off, d * 0.9, n, 0.84 + (off === 0 ? 0.06 : 0)); });
      /** The B section: the bass stops riffing and holds, octave and fifth on the pushes, a step into the next root. */
      const longBar = (bar, o = {}) => {
        const B = bar * BPB, R = bassRoot(B);
        const nextR = bar < 7 ? bassRoot(B + BPB) : T.nearest(40, [nextFirstBass], 34, 46);
        const chg = prog.find((e) => e.bar === bar && e.beat > 0);
        const R2 = chg ? bassRoot(B + chg.beat) : R;
        const fifth = T.nearest(R2 + 7, [mod12(ch(B + 2).root + 7)], R2 + 5, R2 + 9);
        push("bass", B, 1.75, R, 0.9);
        if (bar % 2 === 0) { push("bass", B + 2, 0.5, R2 + 12, 0.7); push("bass", B + 2.5, o.until != null ? Math.min(1.5, o.until - 2.5) : 1.5, R2, 0.84); }
        else {
          push("bass", B + 2, 0.5, fifth, 0.72); push("bass", B + 2.5, 1, R2, 0.8);
          if (nextR !== R2) push("bass", B + 3.5, 0.5, nextR > R2 ? nextR - 1 : nextR + 1, 0.74); // a half step into the next root
        }
      };

      // ================= drums =================
      const drum = (track, abs, vel, extra) => push(track, abs, track === "hat" && extra?.open ? 0.5 : 0.25, track, vel, extra);
      const KICKS = [[[0, 2.5], 3], [[0, 1.5, 2.5], 2.5], [[0, 2.5, 3.5], 2], [[0, 1.5, 3.5], 1.5], [[0, 2, 2.5], 1]];
      const hats = (bar, mode, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4, step = mode === "16" ? 0.25 : mode === "4" ? 1 : 0.5;
        for (let b = 0; b < until - 1e-6; b += step) {
          if (o.open && b === 3.5) { drum("hat", B + b, 0.5, { open: true }); continue; }
          drum("hat", B + b, (b % 1 === 0 ? 0.58 : b % 0.5 === 0 ? 0.42 : 0.3) * (o.vel ?? 1));
        }
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        (o.kicks || r.weighted(KICKS)).filter((k) => k < until).forEach((k, i) => drum("kick", B + k, i === 0 ? 0.95 : 0.8));
        if (o.snare !== false) [1, 3].filter((b) => b < until).forEach((b) => { drum("snare", B + b, o.snareVel ?? 0.86); if (o.clap) drum("clap", B + b, 0.62); });
        if (o.ghosts) [1.75, 2.25, 3.75].forEach((b) => { if (b < until && r.chance(0.3)) drum("snare", B + b, 0.3, { ghost: true }); });
        if (o.hats !== false) hats(bar, o.hats || "8", { open: o.open, until, vel: o.hatVel });
      };
      const fill = (bar, from, kind) => {
        const B = bar * BPB;
        if (kind === "snare") for (let b = from; b < 4 - 1e-6; b += 0.25) drum("snare", B + b, 0.45);
        else if (kind === "toms") {
          const Pn = [57, 55, 52, 50, 47, 45, 43, 40], steps = Math.round((4 - from) * 4);
          for (let i = 0; i < steps; i++) { const b = from + i * 0.25; if (i === 0) drum("snare", B + b, 0.72); else drum("tom", B + b, 0.66, { pitch: Pn[Math.min(7, Math.floor((i * 8) / steps))] }); }
          drum("kick", B + from, 0.8);
        } else if (kind === "hits") { // kick, snare and a brass dyad together on the last three eighths
          [2.5, 3, 3.5].filter((b) => b >= from).forEach((b) => { drum("kick", B + b, 0.92); drum("snare", B + b, 0.86); stab(B + b, 0.7, 0.28, true); });
        } else if (kind === "stop") { drum("snare", B + from, 0.9); drum("hat", B + from, 0.55, { open: true }); }
        ev = G.crescendo(ev, { tracks: ["snare", "tom", "kick"], from: B + from, to: B + 4, v0: 0.85, v1: 1.15, bpb: BPB, curve: 1.2 });
      };
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill)); state.lastFill = k; return k; };
      const arrive = (abs, vel = 0.6) => { drum("hat", abs, vel, { open: true }); drum("tom", abs, vel, { pitch: 43 }); };

      // ================= sections =================
      let label = "";
      let rub = 0;
      if (intro) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar % 2 === 0) riff(bar);
          hats(bar, bar < 4 ? "4" : "8", { vel: bar < 2 ? 0.6 : 0.85, until: bar === 7 ? 2 : 4 });
          if (bar >= 2) (bar < 4 ? [0, 2.5] : [0, 1.5, 2.5]).forEach((k, i) => { if (bar < 7 || k < 2) drum("kick", B + k, i ? 0.78 : 0.92); });
          if (bar >= 4) arpBar(bar, 0.5, { mode: "off8", until: bar === 7 ? 2 : 4 });
          if (bar >= 5 && bar < 7) { drum("snare", B + 1, 0.7); drum("snare", B + 3, 0.78); }
          if (bar === 7) { drum("snare", B + 1, 0.8); fill(bar, 2, "snare"); }
        }
        label = "Intro · the riff, the road";
      } else if (isA) {
        const v = Number(SEC[1]); // 1..4
        const tune = sing(leadLine(HOOK[v === 2 ? "toB" : "down"], MARKS_A, { vel: 0.78 + 0.02 * (v - 1) }));
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, last = bar === 7;
          const fillKind = last ? pickFill(v === 1 ? ["toms", "snare"] : v === 2 ? ["hits", "stop"] : v === 3 ? ["snare", "toms", "hits"] : ["toms", "stop"]) : null;
          const from = fillKind === "hits" ? 2.5 : fillKind === "stop" ? 3 : fillKind ? r.pick([2, 3]) : 4;
          if (bar === 0 && v > 1) arrive(B, v === 4 ? 0.7 : 0.55);
          if (v === 1) {
            groove(bar, { kicks: bar < 4 ? [0, 2.5] : undefined, hats: "8", until: from, hatVel: 0.85, ghosts: lap > 0 });
            if (lap > 0 && bar >= 4) arpBar(bar, 0.46, { mode: "off8", until: from });
          } else if (v === 2) {
            groove(bar, { hats: "8", open: bar % 2 === 1, until: from, ghosts: true });
            arpBar(bar, 0.5, { mode: "off8", until: from });
          } else if (v === 3) {
            groove(bar, { hats: lap % 2 ? "16" : "8", open: bar % 2 === 1, until: from, ghosts: true, clap: true, hatVel: lap % 2 ? 0.8 : 1 });
            arpBar(bar, 0.5, { mode: bar >= 4 ? "16" : "off8", until: from, bounce: true });
            if (bar < 7) r.weighted(STABS).forEach((p) => stab(B + p, 0.58));
          } else {
            padBar(bar, 0.44, { triad: true });
            groove(bar, { hats: "16", open: bar % 2 === 1, until: from, ghosts: true, clap: true, hatVel: 0.8, kicks: r.weighted([[[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 2, 2.5], 1]]) });
            arpBar(bar, 0.46, { mode: "off8", until: from });
            if (bar % 2 === 1 && bar < 7) stab(B + 3.5, 0.56, 0.25);
          }
          // the riff on every odd bar pair; the cadence bar where the bass finally leaves the pedal
          if (v === 2 && bar === 7) cadenceBar(bar, { until: from });
          else if (bar % 2 === 0) riff(bar, { until: last ? from : bar === 6 && v === 2 ? 4 : undefined, lift: v === 4 ? 0.03 : 0 });
          if (fillKind) fill(bar, from, fillKind);
        }
        if (v === 2) answers(tune, [{ tail: 3 }, { even: 0.5 }, { steps: -2 }]);
        if (v === 4) answers(tune, [{ tail: 3 }, { even: 0.5 }, { invert: true }, { transpose: -12 }], { vel: 0.56 });
        label = ["", `Lap ${lap + 1} · the hook over the pedal`, "The hook again · the brass finishes the sentences, the bass leaves E", "Return · stabs and claps", "The hook with the sky still open"][v];
      } else if (isB) {
        const second = SEC === "B2";
        const line = leadLine(BTUNE, MARKS_B, { vel: 0.8 });
        if (!second) sing(line);
        else { // the B theme changes hands between the lead and the brass after long notes
          const dist = D.distribute(line, {
            bpb: BPB, breath: 0.75, mode: "handoff", rng: r.fork(7), handoffDur: 1.5, minNotes: 2, stay: 0.35, join: "extend", overlap: 0.25,
            voices: [{ track: "lead", range: [55, 88], weight: 1.2 }, { track: "brass", range: [57, 84], gain: 0.88 }],
          });
          dist.forEach((n) => { const { at, idx: _i, voice, shift, entrance, phrase, handoff, join, ...rest } = n; ev.push(rest); if (rest.track === "lead") leadAttacks.push(rest.bar * BPB + rest.beat); });
        }
        rub = second ? 0.35 : 0.5;
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, last = bar === 7;
          const fillKind = last ? pickFill(second ? ["hits", "toms"] : ["toms", "snare"]) : null;
          const from = fillKind === "hits" ? 2.5 : fillKind ? 2 : 4;
          if (bar === 0) arrive(B, 0.65);
          padBar(bar, second ? 0.5 : 0.46);
          groove(bar, { hats: second ? "16" : "8", open: bar % 2 === 1, until: from, ghosts: second, clap: second, hatVel: second ? 0.8 : 0.9, snareVel: 0.8,
            kicks: r.weighted([[[0, 2.5], 3], [[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 1]]) });
          arpBar(bar, second ? 0.48 : 0.44, { mode: second ? "16" : "8", until: from, bounce: !second, down: second ? bar % 2 === 1 : undefined });
          longBar(bar, { until: from });
          if (second && bar % 2 === 1 && bar < 7 && r.chance(0.6)) stab(B + 3.5, 0.52, 0.25);
          if (fillKind) fill(bar, from, fillKind);
        }
        label = second ? "The sky again · the theme passed from lead to brass" : "The sky opens · C major, the pad, the bass lets go";
      } else { // BRK
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar % 2 === 0) riff(bar, { until: bar === 6 ? 4 : undefined });
          if (bar === 7) cadenceBar(bar, { until: 2 });
          if (bar < 7) { drum("kick", B, 0.9); drum("kick", B + 2.5, 0.74); if (bar >= 4) drum("kick", B + 3.5, 0.6); }
          hats(bar, bar < 2 ? "4" : bar < 6 ? "8" : "16", { vel: bar < 4 ? 0.8 : 0.9, until: bar === 7 ? 2 : 4 });
          if (bar >= 2) arpBar(bar, bar < 4 ? 0.4 : 0.48, { mode: bar < 4 ? "off8" : "16", bounce: true, until: bar === 7 ? 2 : 4 });
          if (bar === 6) { drum("snare", B + 1, 0.6); drum("snare", B + 3, 0.72); }
          if (bar === 7) { drum("snare", B + 1, 0.8); fill(bar, 2, "snare"); }
        }
        // the lead calls the hook's first bars across the echo (bars 5-6); the brass answers in bar 7
        const call = sing(leadLine([HOOK7[0], HOOK7[1]], "auto", { vel: 0.74, shiftBars: 4 }));
        answers(call, [{ tail: 4 }, { even: 0.5 }, { steps: -3 }], { end: 29, vel: 0.58 });
        label = "Breakdown · the riff alone, the lead calls across the echo";
      }

      // ================= the chip, then the feel =================
      const bud = S.budget(ev, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      ev = bud.events;
      ev = G.ghosts(ev, { track: "snare", vel: 0.22, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          kick: "straight", snare: { template: "laidback", amount: 0.8 }, clap: { template: "laidback", amount: 1 }, hat: { template: "pushed", amount: 0.9 }, tom: "mpc54",
          bass: { template: "funk16", late: 2, amount: 0.7 }, pluck: { template: "disco", late: -2 },
          brass: { template: "straight", late: 5, vels: false }, pad: { template: "straight", late: 14, vels: false },
          lead: { template: "straight", late: isB ? 0 : 6, vels: false },
        },
      });
      if (rub) ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: rub, linger: "high", lingerMs: 50, legato: true, rng: r });
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
