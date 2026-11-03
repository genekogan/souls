// Tax Holiday: a minor-key bossa at dusk, string-arranged in the manner of the late-sixties Rio records.
// ABAC in D minor, 4/4 at 104 felt in two (one 4/4 bar = one 2/4 bar of the Brazilian notation).
//
//   A   the line cliché: the tonic chord's inner voice sinks D C# C B while the melody hovers on E,
//       the ninth, then holds that E across Bbmaj7#11 into A7 so the same note turns from #11 to fifth.
//   B   the relative major, F; the bass climbs F F# G G# A, a mirror of the A section's descent, under
//       a wider, rising tune that peaks over the diminished chord and falls in a D7b9 arpeggio.
//   A'  the A again, turning at the end toward the subdominant.
//   C   the closing strain: long notes whose meaning changes underneath (3rd -> 13th, 3rd -> #11),
//       a high point over Em7b5 and a cadence that ends on the ninth rather than the root.
//
// Each round is a piano chorus, a chorus where the strings take the tune, then a dusk vamp on D with
// a Neapolitan Ebmaj7#11 over the pedal. In the piano chorus the strings hold guide tones and answer
// under the long notes; in the string chorus the line cliché moves into the bass (slash chords), the
// piano switches to sparse shells and single-note fills over the strings' held notes, and in the last
// strain the piano doubles the strings. Odd rounds play the two choruses in the other order. The nylon
// guitar keeps a quiet batida on hand-written grips; brushes, soft surdo-ish kick and, later, shaker.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const M = T.midi, mod12 = T.mod12;

  // ---------- harmony ----------
  const FORM = {
    A1: "| Dmadd9 | DmMaj9 | Dm9 | Dm69 | Bbmaj9#11 | A7b13 | Dm9 Dm7/C | Gm9 C13sus4 |",
    B: "| Fmaj9 | F#dim7 | Gm9 | G#dim7 | Am7 | D7b9 | Gm9 | Em7b5 A7b9 |",
    A2: "| Dmadd9 | DmMaj9 | Dm9 | Dm69 | Bbmaj9#11 | A7b13 | Dm9 | Am7b5 D7b9 |",
    C: "| Gm9 | C13 | Fmaj9 | Ebmaj9#11 | Em7b5 | A7b13 | Dm69 | Bbmaj9#11 A7b9 |",
    // string chorus: the cliché moves into the bass under a fixed F-A-E upper structure
    A1s: "| Dmadd9 | DmMaj9/C# | Dm9/C | Dm69/B | Bbmaj9#11 | A7b13 | Dm9 Dm7/C | Gm9 C13sus4 |",
    A2s: "| Dmadd9 | DmMaj9/C# | Dm9/C | Dm69/B | Bbmaj9#11 | A7b13 | Dm9 | Am7b5 D7b9 |",
    // intro and interlude: D pedal with the Neapolitan above it, then iv and a minor ii-V
    V: "| Dm9 | Ebmaj9#11/D | Dm9 | Ebmaj9#11/D | Gm9 | Gm9/F | Em7b5 | A7b13 |",
  };
  const ORDER = ["A1", "B", "A2", "C"];
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));

  // ---------- guitar grips (low E string first, x = muted); alt = the thumb's beat-3 note ----------
  const OPEN = [40, 45, 50, 55, 59, 64];
  const GRIP_SRC = {
    // the cliché on the G string under F on top
    "Dmadd9": ["x5776x", "A2"], "DmMaj9": ["x5766x", "A2"], "Dm9": ["x5756x", "A2"], "Dm69": ["x5746x", "A2"],
    "Bbmaj9#11": ["x13230", "F2"], "A7b13": ["5x566x", "E2"], "Dm7/C": ["x3323x", "G2"],
    "Gm9": ["3x3333", "D3"], "C13sus4": ["x33335", "G2"], "Fmaj9": ["1x2213", "C3"], "F#dim7": ["2x121x", null],
    "G#dim7": ["4x343x", null], "Am7": ["5x555x", "E2"], "D7b9": ["x5454x", "A2"], "Em7b5": ["0x2333", "Bb2"],
    "A7b9": ["x02323", "E2"], "Am7b5": ["5x554x", null], "C13": ["x3x355", "G2"], "Ebmaj9#11": ["x65765", "Bb2"],
    "Ebmaj9#11/D": ["x5534x", null], "Gm9/F": ["1x5335", null],
    // the bass-line version: F3 A3 over the walking thumb, E4 on top until the tune climbs to F, then D4
    "Dmadd9 ped": ["x5325x", "A2"], "DmMaj9/C#": ["x4325x", null], "Dm9/C": ["x3323x", null], "Dm69/B": ["x2323x", null],
    "Bbmaj9#11 ped": ["x1325x", "F2"],
  };
  const GRIPS = {};
  for (const [sym, [frets, alt]] of Object.entries(GRIP_SRC)) {
    const ns = [];
    [...frets].forEach((f, i) => { if (f !== "x") ns.push(OPEN[i] + Number(f)); });
    GRIPS[sym] = { bass: ns[0], fingers: ns.slice(1), alt: alt ? M(alt) : ns[0] };
  }
  const grip = (sym, ped) => (ped && GRIPS[sym + " ped"]) || GRIPS[sym];

  // ---------- the tune: [beat, dur, note] within the 8-bar strain ----------
  const A_HEAD = [ // bars 1-6, shared by A and A'
    [0.5, 0.5, "D5"], [1, 1, "E5"], [2, 0.5, "F5"], [2.5, 3.5, "E5"],          // the ninth, held over DmMaj7
    [7.5, 0.5, "E5"], [8, 1, "F5"], [9, 0.5, "G5"], [9.5, 4.5, "F5"],          // same cell a step up, an eighth earlier
    [14, 0.5, "E5"], [14.5, 0.5, "D5"], [15, 0.5, "B4"], [15.5, 5.5, "E5"],    // E: #11 of Bb, then fifth of A
    [21, 0.5, "F5"], [21.5, 1, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "C#5"], [23.5, 2, "D5"],
  ];
  const A_END = {
    A1: [[26, 0.5, "A4"], [26.5, 0.5, "C5"], [27, 0.5, "F5"], [27.5, 2.5, "A5"], [30, 0.5, "G5"], [30.5, 1.5, "F5"]], // F major arpeggio, sus into B
    A2: [[26, 0.5, "E5"], [26.5, 0.5, "F5"], [27, 0.5, "A5"], [27.5, 2, "G5"], [29.5, 0.5, "Eb5"], [30, 0.5, "F#5"], [30.5, 0.5, "A5"], [31, 1, "C6"]],
  };
  const B_TUNE = [
    [0, 1, "E5"], [1, 0.5, "F5"], [1.5, 2.5, "A5"],
    [4.5, 0.5, "A5"], [5, 1, "C6"], [6, 3, "A5"],                                // A: third, then minor third of F#dim7, then ninth of Gm
    [9, 0.5, "Bb5"], [9.5, 0.5, "A5"], [10, 1, "G5"], [11, 0.5, "F5"], [11.5, 1, "D5"],
    [12.5, 0.5, "F5"], [13, 1, "B5"], [14, 1, "D6"], [15, 0.5, "B5"], [15.5, 5.5, "C6"], // up the diminished chord; C held from Am7 into D7
    [21, 0.5, "A5"], [21.5, 0.5, "F#5"], [22, 1, "Eb5"], [23, 0.5, "D5"], [23.5, 2.5, "Bb4"], // falls through D7b9
    [26.5, 0.5, "C5"], [27, 0.5, "D5"], [27.5, 2, "G5"], [29.5, 0.5, "F5"], [30, 1, "E5"], [31, 0.5, "C#5"], [31.5, 0.5, "A4"],
  ];
  const C_TUNE = [
    [0, 2.5, "Bb5"], [2.5, 0.5, "A5"], [3, 0.5, "G5"], [3.5, 2.5, "A5"],        // A arrives early: the 13th of C
    [6.5, 0.5, "G5"], [7, 0.5, "F5"], [7.5, 2.5, "E5"],
    [10, 0.5, "F5"], [10.5, 1, "G5"], [11.5, 4.5, "A5"],                        // third of F, then #11 of Eb
    [16.5, 0.5, "Bb5"], [17, 1, "D6"], [18, 1, "Bb5"], [19, 0.5, "G5"], [19.5, 2.5, "F5"],
    [22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "C#5"], [23.5, 4, "E5"],      // home on the ninth
  ];
  const PICKUP = [[-0.5, 0.5, "A4"]];
  // intro / interlude material
  const CALL = [[0.5, 0.5, "D5"], [1, 1, "E5"], [2, 0.5, "F5"], [2.5, 1.5, "E5"], [4.5, 0.5, "D5"], [5, 1, "Eb5"], [6, 0.5, "F5"], [6.5, 1.5, "Eb5"]];
  const CALL_ANSWER = [[8, 4, "A4"], [12, 3.5, "Bb4"]];
  const DUSK_LINE = [[16, 3.5, "D5"], [19.5, 4.5, "A4"], [24, 2, "Bb4"], [26, 2, "D5"], [28, 2, "F5"], [30, 1.5, "E5"]];

  const toNotes = (xs) => xs.map(([beat, dur, n]) => {
    const note = M(n);
    return { beat, dur, note, vel: 0.54 + Math.min(0.1, dur * 0.025) + (note - 74) * 0.004 };
  });
  const tune = (name) => toNotes(name === "B" ? B_TUNE : name === "C" ? C_TUNE : A_HEAD.concat(A_END[name], name === "A1" ? PICKUP : []))
    .sort((a, b) => a.beat - b.beat);

  // ---------- batida: finger strokes over two bars (beats 0-8) ----------
  const BATIDA = {
    calma: [0, 2.5, 4, 5.5],            // 1, &3 | 1, &2
    noite: [0, 1, 2.5, 4.5, 6, 7],      // 1, 2, &3 | &1, 3, 4
    onda: [0, 1.5, 2.5, 4, 5, 6.5],     // busier, for the bridge in F and the string chorus
  };
  const TAPS = [0.24, 0.09, 0.15, 0.12, 0.2, 0.09, 0.16, 0.13]; // brushed eighths, leaning on the "and" of 2 and 4
  const SHAKE = [0.2, 0.1, 0.15, 0.12, 0.18, 0.1, 0.15, 0.13];

  /** cycle 0 is the intro; then rounds of [chorus, chorus, interlude] with the two choruses swapping order. */
  function plan(cycle) {
    if (cycle === 0) return { kind: "intro", name: "V", round: 0 };
    const k = cycle - 1, p = k % 9, round = Math.floor(k / 9);
    const leads = round % 2 === 0 ? ["piano", "strings"] : ["strings", "piano"];
    if (p < 8) {
      const second = p >= 4, name = ORDER[p % 4];
      let lead = leads[second ? 1 : 0];
      if (second && name === "C") lead = "tutti";
      return { kind: "chorus", name, lead, round, second, chorus: round * 2 + (second ? 2 : 1) };
    }
    return { kind: "interlude", name: "V", round };
  }
  const isStr = (P) => P.kind === "chorus" && (P.lead === "strings" || (P.lead === "tutti" && !(P.round % 2)));
  const progName = (P) => (P.kind === "chorus" && isStr(P) && P.name !== "B" && P.name !== "C" ? P.name + "s" : P.name);

  Sim.register({
    id: "tax-holiday",
    title: "Tax Holiday",
    genre: "Bossa nova",
    about: "A minor-key, string-arranged bossa at dusk: ABAC in D minor with a line cliché under a tune that hovers on the ninth, a bridge in F, piano and string choruses, and a quiet nylon batida.",
    bpm: 104, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 3, strongBeats: [0, 2],

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.8, preDelay: 0.015, lowcut: 220, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 5, preDelay: 0.04, lowcut: 320, highcut: 5800 });
      const piano = I.softPiano(ctx, { volume: -1, decay: 4.5, release: 1.4, cutoff: 2700 });
      const strMel = I.strings(ctx, { volume: -3, attack: 0.16, release: 0.9, cutoff: 2500 });
      const strPad = I.strings(ctx, { volume: -11, attack: 1.2, release: 2.2, cutoff: 1600 });
      const gtr = I.nylon(ctx, { volume: -7, cutoff: 3000, dampening: 3000, voices: 12 });
      const thumb = I.nylon(ctx, { volume: -9, cutoff: 1500, dampening: 2000, resonance: 0.95, voices: 3 });
      const bass = I.upright(ctx, { volume: -5, base: 130 });
      const kit = I.kit(ctx, { volume: -3, kickNote: 31, preload: ["brushSweep", "brushTap", "softKick", "hatPedal", "shaker", "rim"] });
      const pp = I.place(ctx, piano, 0.06, out), sp = I.place(ctx, strMel, 0.2, out), pd = I.place(ctx, strPad, -0.22, out);
      const gp = I.place(ctx, gtr, -0.3, out), tp = I.place(ctx, thumb, -0.2, out);
      I.place(ctx, bass, 0, out); const kp = I.place(ctx, kit, 0.12, out);
      I.send(ctx, pp, hall, -10); I.send(ctx, pp, room, -16);
      I.send(ctx, sp, hall, -7); I.send(ctx, pd, hall, -6);
      I.send(ctx, gp, room, -12); I.send(ctx, gp, hall, -22); I.send(ctx, tp, room, -18);
      I.send(ctx, kp, room, -14); I.send(ctx, bass.out, room, -24);
      return {
        piano: { layer: "melody", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        strings: { layer: "melody", play: (t, e, d) => strMel.play(t, e.note, d, e.vel), humanize: { timing: 0.014, vel: 0.04 } },
        comp: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.015, vel: 0.06 } },
        pad: { layer: "harmony", play: (t, e, d) => strPad.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        guitar: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, e.strum ?? 0.01), humanize: { timing: 0.008, vel: 0.07 } },
        thumb: { layer: "harmony", play: (t, e, d) => thumb.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        fill: { layer: "texture", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        counter: { layer: "texture", play: (t, e, d) => strMel.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.04 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = plan(cycle), next = plan(cycle + 1);
      const pname = progName(P), prog = PROG[pname];
      const ped = pname.endsWith("s");
      const nextPed = progName(next).endsWith("s"), nextFirst = PROG[progName(next)][0].chord;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(Math.max(0, Math.min(31.99, b))).chord;
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const round = P.round, mode = round % 3, vamp = P.kind !== "chorus";
      const starts = new Set(prog.map((c) => c.bar * 4 + c.beat));

      // ================= strings pad: guide tones (and the cliché itself in the A section) =================
      const padAt = []; // [{from, to, notes}] for keeping the counter-line out of the pad's way
      const padOn = vamp ? (P.kind === "interlude" ? 0 : 16) : (P.lead === "piano" ? 0 : null);
      if (padOn != null) {
        prog.forEach((c) => {
          const s0 = c.bar * 4 + c.beat;
          if (s0 < padOn) return;
          let v;
          const cliche = { Dmadd9: 62, DmMaj9: 61, Dm9: 60, Dm69: 59 };
          if (!vamp && (P.name === "A1" || P.name === "A2") && c.bar < 4) v = [cliche[c.chord], 69];
          else v = T.voice(c.chord, { lo: 55, hi: 69, n: 2, prev: state.pad, top: [62, 69], omitBass: true, rng: r });
          state.pad = v;
          padAt.push({ from: s0, to: s0 + c.dur, notes: v });
          push("pad", s0, c.dur - 0.1, v, (vamp ? 0.36 : 0.4) + (P.name === "C" ? 0.04 : 0) + r.range(-0.02, 0.02));
        });
      } else state.pad = null;
      const padNotes = (b) => (padAt.find((p) => b >= p.from - 1e-6 && b < p.to - 1e-6) || { notes: [] }).notes;

      // ================= melody =================
      let mel = []; // what carries the tune this cycle (for fills, counter-lines and guitar comping)
      if (P.kind === "chorus") {
        const first = round === 0 && !P.second && P.name === "A1";
        const amt = first ? 0 : Math.min(0.45, 0.1 + 0.1 * round + (P.second ? 0.08 : 0));
        mel = vary(tune(P.name), r.fork(7), amt, sym);
        const climb = P.name === "B" || P.name === "C" ? 0.04 : 0;
        const strTune = P.lead === "strings" || P.lead === "tutti";
        const pianoTune = P.lead === "piano" || P.lead === "tutti";
        // an octave doubling below the tune must not land a semitone from the guitar's grip or the pad
        const lowOk = (m, from, to) => prog.filter((c) => c.bar * 4 + c.beat < to && c.bar * 4 + c.beat + c.dur > from)
          .every((c) => grip(c.chord, ped).fingers.concat(P.lead === "piano" ? padNotes(c.bar * 4 + c.beat) : []).every((f) => Math.abs(f - m) !== 1));
        mel.forEach((n, i) => {
          const nx = mel[i + 1];
          if (strTune) { // legato; violas double an octave below in the bridge and the last strain
            const dur = nx ? Math.min(n.dur, nx.beat - n.beat) - 0.04 : n.dur;
            const oct = (P.name === "B" || P.name === "C") && n.note - 12 >= 57 && lowOk(n.note - 12, n.beat - 0.5, n.beat + n.dur);
            push("strings", n.beat, Math.max(0.3, dur), oct ? [n.note - 12, n.note] : n.note, n.vel * 0.95 + climb, { delay: 0.01 });
          }
          if (pianoTune) {
            const oct = P.lead === "piano" && mode === 1 && (P.name === "B" || P.name === "C") && n.note - 12 >= 62 && lowOk(n.note - 12, n.beat - 0.5, n.beat + n.dur);
            const v = P.lead === "tutti" ? n.vel * 0.72 : n.vel + climb;
            push("piano", n.beat, n.dur, oct ? [n.note - 12, n.note] : n.note, v, { delay: 0.014 });
          }
        });
      } else {
        const swap = P.kind === "interlude" && round % 2 === 1;
        if (P.kind === "interlude") toNotes(CALL).forEach((n) => push(swap ? "strings" : "piano", n.beat, swap ? n.dur - 0.04 : n.dur, n.note, n.vel * 0.85, { delay: 0.014 }));
        if (P.kind === "interlude") toNotes(CALL_ANSWER).forEach((n) => push("counter", n.beat, n.dur, n.note, 0.32));
        mel = toNotes(DUSK_LINE);
        mel.forEach((n) => push(swap ? "piano" : "strings", n.beat, n.dur - 0.04, n.note, n.vel * (swap ? 0.9 : 0.85), { delay: 0.012 }));
      }

      // ================= piano comping in the string chorus: sparse shells =================
      // Each shell steers clear of a semitone (or minor ninth) against the tune and the guitar's grip.
      const sounding = (from, to) => mel.filter((m) => m.beat < to - 1e-6 && m.beat + m.dur > from + 1e-6).map((m) => m.note);
      const rub = (a, b) => { const d = Math.abs(a - b); return d === 1 || d === 13; };
      const compHits = [];
      if (P.kind === "chorus" && P.lead === "strings") {
        const SHELL4 = [[[[0.5, 1.5]], 3], [[[1.5, 2]], 2], [[[1, 1], [2.5, 1.5]], 1], [[[0, 2]], 2]];
        const SHELL2 = [[[[0, 1.5]], 3], [[[0.5, 1]], 1.5]];
        let skipped = false;
        prog.forEach((c, ci) => {
          const s0 = c.bar * 4 + c.beat;
          if (ci > 0 && !skipped && c.dur >= 4 && r.chance(0.28)) { skipped = true; return; }
          skipped = false;
          const v = T.voice(c.chord, { lo: 52, hi: 70, n: 3, prev: state.comp, top: [62, 69], omitBass: true, rng: r });
          state.comp = v;
          const fingers = grip(c.chord, ped).fingers;
          const pat = r.weighted(c.dur >= 4 ? SHELL4 : SHELL2);
          pat.forEach(([b, d]) => {
            const at = s0 + b, dur = Math.max(0.5, Math.min(d, c.dur - b - 0.5)); // let go before the guitar anticipates
            const tune = sounding(at, at + dur);
            const ns = v.filter((m, k) => !(k + 1 < v.length && v[k + 1] - m === 1 && m < 64)) // no low semitone rubs
              .filter((m) => !tune.some((t) => rub(t, m) || t === m) && !fingers.some((f) => rub(f, m)));
            if (ns.length >= 2) { push("comp", at, dur, ns, 0.3 + r.range(-0.03, 0.04)); compHits.push({ from: at, to: at + dur, ns }); }
          });
        });
      } else state.comp = null;
      const fingersAt = (b) => grip(sym(b), ped).fingers.concat(grip(sym(b + 0.5), ped).fingers);
      const compAt = (b) => compHits.filter((h) => b >= h.from - 1e-6 && b < h.to).flatMap((h) => h.ns);

      // ================= answers under / over the long notes =================
      if (P.kind === "chorus") {
        const pianoLead = P.lead === "piano";
        const cp = round === 0 && (P.name === "A1" || P.name === "A2") ? 0.45 : 0.65;
        const lastEnd = P.name === "C" ? 31.25 : 32; // leave the next chorus's pickup alone
        mel.forEach((n, i) => {
          const nx = mel[i + 1];
          const end = Math.min(nx ? nx.beat : lastEnd, lastEnd) - 0.25, nEnd = n.beat + n.dur;
          let from;
          if (n.dur >= 2.5) from = n.beat + r.pick([1, 1, 1.5]);
          else if (end - nEnd >= 2) from = nEnd + 0.5; // a rest in the tune
          else return;
          const held = n.note;
          if (pianoLead && r.chance(cp)) {
            // strings rise underneath the held piano note, slowly
            const notes = fillLine({
              from, to: end, sym, r, lo: Math.max(60, held - 12), hi: Math.min(74, held - 3), dir: 1,
              rhythms: [[0, 1], [0, 1, 2], [0, 0.5, 1.5], [0, 2], [0, 1, 2, 3], [0, 1.5, 2, 3]],
              avoid: (m, b) => clashes(m, held) || padNotes(b).some((p) => p === m) || padNotes(b).concat(fingersAt(b)).some((p) => rub(p, m)),
            });
            notes.forEach((f, j) => push("counter", f.beat, f.dur, f.note, 0.3 + j * 0.03));
          } else if (P.lead === "strings" && r.chance(0.62)) {
            // the piano drops single notes around the held string note: above it when there is room, else below
            const above = held <= 77;
            const notes = fillLine({
              from: from + (n.dur >= 2.5 ? r.pick([0, 0.5, 0.5, 1]) : 0), to: end, sym, r,
              lo: above ? held + 3 : Math.max(64, held - 10), hi: above ? Math.min(88, held + 12) : held - 3, dir: -1,
              rhythms: [[0, 0.5, 1], [0, 0.5, 1, 1.5], [0, 1, 1.5], [0, 0.5, 1.5], [0, 1]],
              avoid: (m, b) => clashes(m, held) || compAt(b).concat(fingersAt(b)).some((x) => rub(x, m)),
            });
            notes.forEach((f, j) => push("fill", f.beat, f.dur, f.note, 0.36 - j * 0.015 + r.range(-0.02, 0.02), { delay: 0.02 }));
          }
        });
      }

      // ================= guitar: quiet batida =================
      let pat;
      if (vamp) pat = "calma";
      else if (P.name === "B") pat = round === 0 && !P.second ? "noite" : "onda";
      else if (isStr(P)) pat = r.weighted([["noite", 3], ["onda", 1]]);
      else pat = round === 0 ? "calma" : r.weighted([["calma", 2], ["noite", 2]]);
      const strokes = [];
      for (let two = 0; two < 4; two++) {
        let ps = BATIDA[pat];
        if (P.kind === "intro" && two === 0) ps = [0, 4.5];
        else if (two === 3 && !vamp && r.chance(0.35)) ps = BATIDA[r.pick(Object.keys(BATIDA).filter((k) => k !== pat))];
        ps.forEach((p) => strokes.push(two * 8 + p));
      }
      for (const s of starts) { // every chord arrives with a stroke, on it or an eighth early
        if (s === 0) continue;
        if (!strokes.some((x) => x >= s - 0.5 - 1e-6 && x <= s + 0.5 + 1e-6)) strokes.push(r.chance(0.55) ? s - 0.5 : s);
      }
      for (const s of starts) { // where the tune anticipates a chord with a long note, the guitar goes with it
        if (s > 0 && mel.some((m) => Math.abs(m.beat - (s - 0.5)) < 1e-6 && m.dur >= 1.5)) strokes.push(s - 0.5);
      }
      if (r.chance(vamp ? 0.35 : 0.55)) strokes.push(31.5);
      let uniq = [...new Set(strokes.map((x) => Math.round(x * 2) / 2))].sort((a, b) => a - b);
      if (state.antNext) uniq = uniq.filter((x) => x !== 0); // tied over from the last cycle's anticipation
      const isAnt = (x) => Math.abs(x - Math.round(x)) > 1e-6 && (starts.has(x + 0.5) || x + 0.5 === 32);
      uniq = uniq.filter((x) => !uniq.some((y) => isAnt(y) && Math.abs(y + 0.5 - x) < 1e-6));
      state.antNext = uniq.includes(31.5);
      uniq.forEach((x, i) => {
        const offbeat = Math.abs(x - Math.round(x)) > 1e-6, ant = isAnt(x);
        const s = ant && x + 0.5 === 32 ? nextFirst : ant ? sym(x + 0.5) : sym(x);
        const g = grip(s, ant && x + 0.5 === 32 ? nextPed : ped);
        let notes = g.fingers.slice();
        if (offbeat && !ant && notes.length > 3 && r.chance(0.35)) notes = notes.slice(1);
        const nextX = uniq[i + 1] ?? 32.5;
        const dur = Math.max(0.3, Math.min(ant ? 1.6 : vamp ? 2.5 : 1.4, nextX - x - 0.06));
        const vel = (ant ? 0.46 : x % 4 === 0 ? 0.42 : 0.37) + r.range(-0.03, 0.03) + (isStr(P) ? 0.03 : 0) - (vamp ? 0.03 : 0);
        push("guitar", x, dur, notes, vel, { strum: ant ? 0.016 : offbeat ? 0.008 : 0.012 });
      });
      // thumb on 1 and 3
      for (let bar = 0; bar < 8; bar++) {
        for (const b of [0, 2]) {
          const at = bar * 4 + b, s = sym(at), g = grip(s, ped);
          push("thumb", at, 1.8, starts.has(at) || at === 0 ? g.bass : g.alt, b === 0 ? 0.5 : 0.43);
        }
      }

      // ================= upright: root on 1, fifth on 3, with the bossa pickups =================
      const low = (m) => (m - 12 < 28 ? m : m - 12);
      const bassAt = (at) => {
        const s = sym(at), c = T.chord(s), root = low(grip(s, ped).bass);
        if (starts.has(at) || at % 32 === 0) return root;
        if (c.bass !== c.root || !c.intervals.includes(7)) return root; // slash chords keep the line; no 5th, no move
        return T.nearest(root - 5, [mod12(c.root + 7)], 28, 45);
      };
      const bassFrom = P.kind === "intro" ? 4 : 0;
      const busy = !vamp && !(round === 0 && !P.second && P.name === "A1");
      for (let bar = bassFrom; bar < 8; bar++) {
        for (const b of [0, 2]) {
          const at = bar * 4 + b, n = bassAt(at);
          push("bass", at, 1.45, n, b === 0 ? 0.72 : 0.6);
          if (busy && b === 0 && r.chance(0.3)) { // the "and" of 2, tied feel into 3
            const t = bassAt(at + 2);
            push("bass", at + 1.5, 0.45, t, 0.44);
          }
          if (busy && b === 2 && r.chance(0.22) && at + 2 < 32) { // approach the next bar by a half step
            const t = bassAt(at + 2);
            const ap = t - 1 < 28 || r.chance(0.5) ? t + 1 : t - 1;
            if (ap !== n) push("bass", at + 1.5, 0.45, ap, 0.42);
          }
        }
      }

      // ================= brushes, kick, shaker =================
      const kickOn = !vamp && !(round === 0 && !P.second && P.name === "A1");
      const tapsOn = !vamp;
      const shakerOn = (P.kind === "chorus" && (isStr(P) || mode === 2)) || P.kind === "interlude";
      for (let bar = 0; bar < 8; bar++) {
        const B0 = bar * 4;
        if (P.kind === "intro" && bar < 6) continue;
        const swell = 0.92 + 0.1 * Math.sin(((bar + 0.5) / 8) * Math.PI);
        const fill = !vamp && bar === 7 && (P.name === "B" || P.name === "C") && r.chance(0.8);
        push("drums", B0, 1, "brushSweep", 0.22 * swell, { sweep: 0.9 });
        push("drums", B0 + 2, 1, "brushSweep", 0.2 * swell, { sweep: 0.9 });
        if (tapsOn) {
          const first = round === 0 && !P.second && P.name === "A1";
          for (let i = 0; i < 8; i++) {
            if (fill && i >= 5) continue;
            if (first && bar < 4 && i % 2 === 0) continue; // only the offbeats at first
            if (shakerOn && i % 2 === 0 && i !== 0) continue; // the shaker carries the eighths
            if (i % 2 === 1 && r.chance(0.12)) continue; // a hand that breathes
            push("drums", B0 + i / 2, 0.1, "brushTap", TAPS[i] * swell * (first ? 0.8 : 1));
          }
        }
        if (shakerOn) for (let i = 0; i < 8; i++) push("drums", B0 + i / 2, 0.1, "shaker", SHAKE[i] * swell * (vamp ? 0.75 : 1));
        if (kickOn) {
          [[0, 0.4, 1], [1.5, 0.14, 0.55], [2, 0.3, 1], [3.5, 0.12, 0.45]].forEach(([p, v, c]) => { if (r.chance(c)) push("drums", B0 + p, 0.1, "softKick", v); });
          push("drums", B0 + 1, 0.1, "hatPedal", 0.22); push("drums", B0 + 3, 0.1, "hatPedal", 0.26);
        }
        if (fill) [[2.5, 0.26], [3, 0.32], [3.5, 0.38]].forEach(([p, v]) => push("drums", B0 + p, 0.1, "brushTap", v));
        if (fill && P.name === "C") push("drums", B0 + 3.5, 0.1, "rim", 0.3);
      }

      const SEC = { A1: "A", B: "B · F major", A2: "A′", C: "C" };
      const who = { piano: "piano", strings: "strings take the tune", tutti: "strings and piano" };
      const label = P.kind === "intro" ? "Intro · guitar, then strings"
        : P.kind === "interlude" ? "Interlude · dusk vamp on D"
          : `Chorus ${P.chorus} · ${SEC[P.name]} · ${who[P.lead]}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });

  // Am7 in the bridge is iii of F: keep its fills out of the dorian F#
  const FILL_SCALE = { Am7: [9, 0, 2, 4, 7] };
  const fillScale = (s) => FILL_SCALE[s] || T.chord(s).scale;

  /** A note that would rub against a held melody note: unison, semitone, or the same across an octave. */
  function clashes(m, held) {
    const d = Math.abs(m - held);
    return d <= 2 || d === 11 || d === 12 || d === 13;
  }

  /**
   * A short line into a chord tone that lands at the end of a window: built backwards from the target,
   * stepping through each moment's chord scale (dir -1 = falling into the target, +1 = rising into it).
   */
  function fillLine({ from, to, sym, r, lo, hi, dir, rhythms, avoid }) {
    if (hi - lo < 3) return [];
    from = Math.ceil(from * 2 - 1e-9) / 2;
    const span = to - from;
    const fits = rhythms.filter((rh) => rh[rh.length - 1] + 0.5 <= span + 1e-6);
    if (!fits.length) return [];
    const rh = r.weighted(fits.map((x) => [x, x.length])); // longer windows invite longer answers
    const at = rh.map((x) => from + x);
    const last = at[at.length - 1];
    const c = T.chord(sym(last));
    const aim = dir < 0 ? lo + (hi - lo) * 0.3 : lo + (hi - lo) * 0.75;
    const cands = T.notesIn(c.guide.concat(c.colors, [mod12(c.root + 7)]), lo, hi).filter((m) => !avoid(m, last));
    if (!cands.length) return [];
    let target = cands[0], best = Infinity;
    for (const m of cands) { const s = Math.abs(m - aim) + r() * 3; if (s < best) { best = s; target = m; } }
    const out = [{ beat: last, note: target }];
    let cur = target;
    for (let j = at.length - 2; j >= 0; j--) {
      const here = sym(at[j]), there = sym(at[j + 1]);
      // a passing note must also suit the chord it leads into when the harmony changes under it
      const sc = here === there ? fillScale(here) : fillScale(here).filter((p) => fillScale(there).includes(p));
      const bad = (m) => m > hi || m < lo || avoid(m, at[j]);
      let m = T.step(cur, -dir, sc);
      if (bad(m)) m = T.step(m, -dir, sc);
      if (bad(m)) break;
      if (Math.abs(at[j] % 2) < 1e-6 && !T.chord(here).pcs.includes(mod12(m))) { // strong beats prefer chord tones
        const m2 = T.step(m, -dir, sc);
        if (!bad(m2) && T.chord(here).pcs.includes(mod12(m2))) m = m2;
      }
      out.unshift({ beat: at[j], note: m });
      cur = m;
    }
    if (out.length < 2) return [];
    // the last note is held to the end of the window, unless the harmony moves out from under it
    let endAt = to;
    for (let b = Math.floor(last * 2) / 2 + 0.5; b < to - 1e-6; b += 0.5) {
      if (sym(b) !== sym(b - 0.5) && (!T.chord(sym(b)).pcs.includes(mod12(target)) || avoid(target, b))) { endAt = b; break; }
    }
    return out.map((n, i) => ({ ...n, dur: i === out.length - 1 ? Math.max(0.5, endAt - n.beat) : (out[i + 1].beat - n.beat) * 0.92 }));
  }

  /**
   * Recall the tune with small changes that a singer or pianist would make on a later chorus: lean into a
   * long note from a step above or below, anticipate an on-beat long note by an eighth, re-strike a very
   * long note on the offbeat so it does not die away.
   */
  function vary(notes, r, amt, sym) {
    if (!amt) return notes.slice();
    const sc = (b) => T.chord(sym(Math.max(0, b))).scale;
    const out = [];
    notes.forEach((n0) => {
      const n = { ...n0 };
      const prev = out[out.length - 1];
      const prevEnd = prev ? prev.beat + prev.dur : -Infinity;
      const onBeat = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
      if (onBeat && n.dur >= 1 && n.beat >= 0.5 && n.beat - prevEnd >= 0.5 && sc(n.beat - 0.5).includes(mod12(n.note)) && r.chance(amt * 0.4)) {
        n.beat -= 0.5; n.dur += 0.5;
      } else if (n.dur >= 2.5 && n.beat >= 0.5 && n.beat - prevEnd >= 0.5 && r.chance(amt * 0.45)) {
        const up = r.chance(0.55);
        const g = up ? T.step(n.note, 1, sc(n.beat - 0.5)) : T.step(n.note, -1, sc(n.beat - 0.5));
        out.push({ beat: n.beat - 0.5, dur: 0.46, note: g, vel: n.vel * 0.82 });
      }
      if (n.dur >= 4 && r.chance(amt * 0.5)) { // re-strike on the "and" two beats in
        const cut = Math.floor(n.beat + 2) + 0.5;
        if (cut < n.beat + n.dur - 1) {
          out.push({ ...n, dur: cut - n.beat - 0.04 });
          out.push({ beat: cut, dur: n.beat + n.dur - cut, note: n.note, vel: n.vel * 0.8 });
          return;
        }
      }
      out.push(n);
    });
    return out;
  }
})();
