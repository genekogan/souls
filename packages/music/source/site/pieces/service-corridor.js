// Service Corridor: sneaking through the back of a building after hours. F minor, 106 BPM, a light 8th swing.
//
// The hook is the bass. A fingered upright tiptoes in staccato 8ths with a chromatic slide into the fifth
// (B natural into C), walks down a chromatic ladder over a tritone substitute, and rests every other bar so a
// harmon-muted trumpet can answer it. Around it: finger snaps that lean back, brushes, a chip "muted guitar"
// and a chip pad that leave through the SNES echo, vibes comping in the gaps, and a B section where the
// harmony descends by tritone substitutes while the tempo pushes, until two stop-hits and silence; then a
// half-time breath in which the vibes sing and the bass slides, and the hook comes back with the ride.
//
// Engine modules: Sim.phrasing (the bass is a notated line with staccato, slides, scoops, fall-offs and breaths,
// realised by the phrasing wrapper), Sim.dialogue (respond: the trumpet's answers are derived from the tail of
// each bass phrase and may only sound while the bass rests; distribute: on alternate laps the hook is shared
// between the bass and the chip guitar by register, or a phrase each), Sim.spc (a six-voice chip for the
// guitar, the pad, an alarm blip and the B-section hat, with the 144 ms echo and the lo-fi output stage;
// the compose-side budget decides who keeps a voice), Sim.groove (snaps and rim late on 2 and 4, hats and
// brushes pushed, the bass a hair behind, rubato for the vibes line, a tempo script: push through B,
// ritardando into C, a tempo for the return).
//
// THE HOOK (bass, fixed by hand; the generator never changes a pitch or a rhythm, only who plays it and how)
//   | Fm9             | Fm9            | B♭m9             | G♭13                 | Fm9 | D♭maj7♯11 | Gm7♭5 C7♭9 | Fm9 |
//   | F . F A♭ . B→C~ | E♭ C(fall) . . | B♭ . B♭ D♭ . E→F~ | D♭ . C B B♭ A A♭ G   | (bar 1 again) | D♭ A♭(fall) . . |
//   | G . B♭ D♭ C . B♭ E | F . A♭ C E♭ D♭ C G♭ |
//   bar 1: the tiptoe cell: root, root, minor third, then a chromatic B that slides into the fifth.
//   bar 2: the seventh falls to the fifth; the bass rests and the trumpet answers with the same three notes, two
//          octaves up (later inverted, backwards, a step higher), snapped to the chord of the moment.
//   bar 3: the cell a fourth up over iv, E sliding into F.   bar 4: a chromatic walk down from D♭ to G over the
//          tritone substitute G♭13, landing on F.   bars 5-6: the cell again; the answer over ♭VI (lydian).
//   bar 7: the ii-V, the bass outlining both chords.   bar 8: up the tonic, down through E♭ D♭ C to G♭, the
//          half-step above the root, which drops into the repeat.
// B (8 bars, "nearly caught"): | B♭m9 | % | A7♯11 | % | A♭m9 | % | G7♯11 | C7♭9 | — the bass pulses the root in
//   staccato 8ths with the third on the and of 3 and a chromatic approach from below into each new root; the roots
//   descend B♭ A A♭ G (every other chord a tritone sub: A7♯11 for E♭7, G7♯11 for D♭7), then V7♭9 and two stop-hits.
// C (8 bars, "all clear", half-time): | Fm9 | D♭maj7♯11 | B♭m9 | G♭13 | Fm9 | D♭maj7♯11 | Gm7♭5 | C7♭9 |
//   vibes: r C E♭ G | F E♭ C A♭ . | r D♭ F A♭ C | B♭ A♭ E♭ . | r C E♭ F G A♭ | G(♯11) F C . | r B♭ D♭ F | E D♭ G
//   bass: long notes that scoop and slide (F . . | D♭→A♭ | B♭ | G♭ D♭→C | F | D♭ F→A♭ | G D♭ | C B♭ A♭ G♭→F).
// One lap: intro 4 (bass alone) · A 8 · A′ 8 (shared hook) · B 8 · C 8 · A″ 8 = 44 bars, about 1:42.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const BPB = 4, CB = 4, BPM = 106, VOICES = 6;
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);
  const clamp = (x, a = 0.05, b = 1) => Math.max(a, Math.min(b, x));

  // ---------- harmony ----------
  const CH = {
    intro: "| Fm9 | Fm9 | Bbm9 | Gb13 |",
    A: "| Fm9 | Fm9 | Bbm9 | Gb13 | Fm9 | Dbmaj7#11 | Gm7b5 C7b9 | Fm9 |",
    B: "| Bbm9 | Bbm9 | A7#11 | A7#11 | Abm9 | Abm9 | G7#11 | C7b9 |",
    C: "| Fm9 | Dbmaj7#11 | Bbm9 | Gb13 | Fm9 | Dbmaj7#11 | Gm7b5 | C7b9 |",
  };
  const PROG = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- the lines (Sim.phrasing notation: Note/beats then marks; . staccato > accent ~ slur ^n scoop fn fall) ----------
  const HOOK = [
    "F2/0.5.> r/0.5 F2/0.5. Ab2/0.5. r/0.5 B2/0.5 C3/1~",
    "Eb3/0.5. C3/0.75f2 r/2.75",
    "Bb2/0.5.> r/0.5 Bb2/0.5. Db3/0.5. r/0.5 E3/0.5 F3/1~",
    "Db3/0.5.> r/0.5 C3/0.5. B2/0.5. Bb2/0.5. A2/0.5. Ab2/0.5. G2/0.5.",
    "F2/0.5.> r/0.5 F2/0.5. Ab2/0.5. r/0.5 B2/0.5 C3/1~",
    "Db3/0.5. Ab2/0.75f2 r/2.75",
    "G2/0.5.> r/0.5 Bb2/0.5. Db3/0.5. C3/0.5. r/0.5 Bb2/0.5. E2/0.5.",
    "F2/0.5.> r/0.5 Ab2/0.5. C3/0.5. Eb3/0.5. Db3/0.5. C3/0.5. Gb2/0.5.",
  ];
  const B_BASS = [
    "Bb2/0.5.> Bb2/0.5. r/0.5 Bb2/0.5. r/0.5 Db3/0.5. Bb2/0.5. r/0.5",
    "Bb2/0.5.> Bb2/0.5. r/0.5 Bb2/0.5. F3/0.5. Db3/0.5. Bb2/0.5. Ab2/0.5.",
    "A2/0.5.> A2/0.5. r/0.5 A2/0.5. r/0.5 C#3/0.5. A2/0.5. r/0.5",
    "A2/0.5.> A2/0.5. r/0.5 A2/0.5. Eb3/0.5. C#3/0.5. A2/0.5. G2/0.5.",
    "Ab2/0.5.> Ab2/0.5. r/0.5 Ab2/0.5. r/0.5 B2/0.5. Ab2/0.5. r/0.5",
    "Ab2/0.5.> Ab2/0.5. r/0.5 Ab2/0.5. Eb3/0.5. B2/0.5. Ab2/0.5. Gb2/0.5.",
    "G2/0.5.> G2/0.5. r/0.5 G2/0.5. r/0.5 B2/0.5. G2/0.5. F2/0.5.",
    "C3/0.5> r/1 C3/0.5> r/2",
  ];
  const C_BASS = [
    "F2/3^2 r/1",
    "Db2/2 Ab2/2~",
    "Bb2/3.5^1 r/0.5",
    "Gb2/2 Db3/1~ Eb3/0.5~ C3/0.5f2",
    "F2/3~ r/1",
    "Db2/2 F2/1.5~ Ab2/0.5~",
    "G2/2 Db3/2~",
    "C3/2> Bb2/1~ Ab2/0.5~ Gb2/0.5~",
  ];
  const VIBES_C = [
    "r/1 C5/0.5 Eb5/0.5 G5/2",
    "F5/0.5 Eb5/0.5 C5/0.5 Ab4/1 r/1.5",
    "r/1 Db5/0.5 F5/0.5 Ab5/1.5 C6/0.5",
    "Bb5/1 Ab5/0.5 Eb5/1 r/1.5",
    "r/0.5 C5/0.5 Eb5/0.5 F5/0.5 G5/1 Ab5/1",
    "G5/1 F5/0.5 C5/1 r/1.5",
    "r/1 Bb4/0.5 Db5/0.5 F5/2",
    "E5/1 Db5/1 G4/1 Bb4/1",
  ];
  // the trumpet in B: a searchlight on the fifth of A♭m, a question over G7♯11, and the two stop-hits
  const B_TPT = ["r/4", "r/4", "r/4", "r/4", "r/1 Eb5/2.5 r/0.5", "r/0.5 Gb5/1 Eb5/2 r/0.5", "r/2.5 Db5/0.5 F5/1", "E5/0.5> r/1 E5/0.5> r/2"];

  // ---------- form ----------
  const SEC = { intro: { prog: "intro", bars: 4 }, A1: { prog: "A", bars: 8 }, A2: { prog: "A", bars: 8 }, B: { prog: "B", bars: 8 }, C: { prog: "C", bars: 8 }, A3: { prog: "A", bars: 8 } };
  const LAP = [
    { sec: "intro", half: 0 },
    { sec: "A1", half: 0 }, { sec: "A1", half: 1 },
    { sec: "A2", half: 0 }, { sec: "A2", half: 1 },
    { sec: "B", half: 0 }, { sec: "B", half: 1 },
    { sec: "C", half: 0 }, { sec: "C", half: 1 },
    { sec: "A3", half: 0 }, { sec: "A3", half: 1 },
  ];
  // tempo, keyed by cycle within the lap: B pushes (106 → 110 → 114), C sits back (98, then 102), A″ a tempo
  const tempoAt = G.tempoScript(BPM, [
    G.aTempo(0, BPM),
    G.accelerando(5, 110, 16),
    G.accelerando(6, 114, 12),
    G.ritardando(7, 98, 8, true),
    G.accelerando(8, 102, 12),
    G.aTempo(9, BPM),
  ]);
  // who keeps a chip voice when six are busy
  const PRIORITY = { pluckLine: 5, blip: 4, pluck: 3, chipPad: 2, chipHat: 1 };
  const CHIP_TRACKS = new Set(Object.keys(PRIORITY));

  // ---------- helpers on lines ----------
  /** P.line events → dialogue notes ({at, dur, note, vel, art}), with phrase ids: a new phrase after a rest ≥ gap. */
  function toLine(evs, gap = 1) {
    const xs = evs.map((e) => ({ at: e.bar * BPB + e.beat, dur: e.dur, note: e.note, vel: e.vel, art: e.art })).sort((a, b) => a.at - b.at);
    let ph = 0;
    xs.forEach((n, i) => { if (i && n.at - (xs[i - 1].at + xs[i - 1].dur) >= gap - 1e-6) ph++; n.phrase = ph; });
    return xs;
  }
  /** Dialogue note → conductor event (keeps only what the conductor and the wrapper read). */
  const fromNote = (n) => ({ track: n.track, bar: n.bar, beat: n.beat, dur: n.dur, note: n.note, vel: n.vel, art: n.art });
  /** For instruments without the phrasing wrapper: realise . and > in dur and vel, drop the marks. */
  function plain(evs) {
    return evs.map((e) => {
      const a = P.parseArt(e.art || "");
      const { art, ...rest } = e;
      return { ...rest, dur: a.staccato ? e.dur * 0.5 : e.dur, vel: clamp(e.vel + (a.accent ? 0.1 : 0)) };
    });
  }

  // ---------- everything hand-written for one section of one lap, routed ----------
  const TF_A = [
    [{ tail: 3 }, { transpose: 24 }],
    [{ tail: 3 }, { transpose: 24 }, { invert: true }],
    [{ tail: 4 }, { retrograde: true }, { transpose: 24 }],
    [{ tail: 3 }, { transpose: 24 }, { steps: 2 }],
  ];
  const TF_C = [[{ tail: 2 }], [{ tail: 2 }, { steps: -2 }], [{ tail: 3 }, { retrograde: true }]];
  function planSection(sec, lap, r) {
    const S = SEC[sec], prog = PROG[S.prog];
    const chordAt = T.chordAtFactory(prog, BPB);
    const symAt = (b) => chordAt(Math.max(0, Math.min(b, S.bars * BPB - 0.001))).chord;
    const scaleAt = (b) => { const c = T.chord(symAt(b)); return c.scale.concat(c.pcs); };
    const out = { prog, bass: [], pluckLine: [], trumpet: [], vibesLine: [], label: "", share: null };
    const artBass = (evs, o = {}) => P.articulate(evs, "auto", { beatsPerBar: BPB, gap: 1, lengthen: 1.08, breathLate: 0.02, breathGap: 0.1, staccato: 0.5, overlap: 0.04, ...o });
    const L = lap % 3;
    if (sec === "intro") {
      out.bass = artBass(P.line(HOOK.slice(0, 4), { beatsPerBar: BPB, track: "bass", vel: 0.8 }));
      out.label = lap === 0 ? "the corridor · the bass alone, on tiptoe" : "back in the corridor · the bass alone";
    } else if (sec === "A1" || sec === "A2" || sec === "A3") {
      const raw = P.line(HOOK, { beatsPerBar: BPB, track: "bass", vel: 0.82 });
      const line = toLine(raw, 1);
      if (sec === "A2") {
        // the hook is shared with the chip guitar: by register (bass below D3, guitar above, an octave up) or a phrase each
        const byRegister = lap % 2 === 0;
        const voices = byRegister
          ? [{ track: "bass", range: [36, 58], octaves: false }, { track: "pluckLine", range: [60, 84], gain: 0.85 }]
          : [{ track: "bass", range: [36, 58], octaves: false }, { track: "pluckLine", range: [53, 84], gain: 0.85 }];
        const split = byRegister
          ? D.distribute(line, { voices, mode: "interval", pivot: 50, bpb: BPB })
          : D.distribute(line, { voices, mode: "phrase", order: ["bass", "pluckLine", "bass"], bpb: BPB });
        out.bass = artBass(split.filter((n) => n.track === "bass").map(fromNote));
        out.pluckLine = plain(split.filter((n) => n.track === "pluckLine").map(fromNote)).map((e) => ({ ...e, dur: Math.min(e.dur, 0.5) }));
        out.share = byRegister ? "register" : "phrase";
        out.label = byRegister ? "A′ · the hook shared by register: bass below D, chip guitar above" : "A′ · the hook a phrase each: bass, chip guitar, bass";
      } else {
        out.bass = artBass(raw);
        out.label = sec === "A1" ? "A · the tiptoe hook, finger snaps · the trumpet answers in the rests" : "A″ · the hook returns with the ride · the guitar doubles the walk-downs";
      }
      if (sec === "A3") // the chip guitar doubles the chromatic walk-downs two octaves up, through the echo
        out.pluckLine = plain(raw.filter((e) => e.bar === 3 || e.bar === 7).map((e) => ({ ...e, track: "pluckLine", note: e.note + 24, vel: 0.5 }))).map((e) => ({ ...e, dur: Math.min(e.dur, 0.45) }));
      // the trumpet: the tail of each bass phrase, two octaves up and transformed, only while the bass rests
      const base = (sec === "A1" ? 0 : sec === "A2" ? 1 : 2) + lap;
      out.trumpet = D.respond(line, {
        track: "trumpet", transform: (i) => TF_A[(base + i) % TF_A.length],
        minGap: 1.5, end: S.bars * BPB, gap: 0.25, breath: 0.25, scaleAt, range: [60, 80], vel: 0.6, bpb: BPB,
      }).map(fromNote);
    } else if (sec === "B") {
      out.bass = artBass(P.line(B_BASS, { beatsPerBar: BPB, track: "bass", vel: 0.78 }), { gap: 1.5, lengthen: 1 });
      out.trumpet = plain(P.line(B_TPT, { beatsPerBar: BPB, track: "trumpet", vel: 0.62 }));
      out.label = "B · nearly caught · the roots fall B♭ A A♭ G by tritone subs, the tempo pushes";
    } else if (sec === "C") {
      out.bass = artBass(P.line(C_BASS, { beatsPerBar: BPB, track: "bass", vel: 0.74 }), { gap: 0.75, lengthen: 1 });
      const vl = P.line(VIBES_C, { beatsPerBar: BPB, track: "vibesLine", vel: 0.7 });
      out.vibesLine = plain(vl);
      out.trumpet = D.respond(toLine(vl, 1), {
        track: "trumpet", transform: TF_C[L], minGap: 1, end: S.bars * BPB, gap: 0.5, breath: 0.25, scaleAt, range: [58, 79], vel: 0.48, bpb: BPB,
      }).map(fromNote);
      out.label = L === 0 ? "C · all clear · half-time, the vibes breathe, the trumpet repeats their last words" : L === 1 ? "C · all clear · the trumpet answers a third below" : "C · all clear · the trumpet answers backwards";
    }
    return out;
  }

  // ---------- the band ----------
  Sim.register({
    id: "service-corridor",
    title: "Service Corridor",
    genre: "Stealth groove",
    about: "Sneaking through the back of a building in F minor at 106: a fingered upright tiptoes the hook in staccato eighths with a chromatic slide into the fifth, and a harmon-muted trumpet answers only when the bass rests. Finger snaps lean back, a chip muted guitar and pad leave through the SNES echo, vibes comp in the gaps; a B section descends by tritone substitutes while the tempo pushes, stops dead, and relaxes into a half-time breath where the vibes sing and the bass slides. Built on the phrasing, dialogue, chip and groove engines.",
    situations: ["mystery", "hangout"],
    energy: 0.42,
    bpm: BPM, beatsPerBar: BPB, swing: 0.56, swingUnit: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.012, lowcut: 260, highcut: 6500 });
      const plate = I.reverb(ctx, out, { decay: 2.9, preDelay: 0.03, lowcut: 380, highcut: 5200 });
      const slap = I.delay(ctx, out, { time: "8n", feedback: 0.16, highcut: 2600 });

      // the bass: a fingered upright with flatwounds (round partials, a quick filter thump), realised by the phrasing wrapper
      const bassS = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.62, 0.3, 0.16, 0.07, 0.03] },
        filter: { type: "lowpass", rolloff: -24, Q: 1.4 },
        envelope: { attack: 0.004, decay: 0.42, sustain: 0.3, release: 0.1 },
        filterEnvelope: { attack: 0.002, decay: 0.14, sustain: 0.3, release: 0.12, baseFrequency: 170, octaves: 2.6 },
      }));
      const bassLp = ctx.keep(new Tone.Filter({ frequency: 1500, type: "lowpass", rolloff: -12 }));
      bassS.connect(bassLp);
      const bass = P.wrap(ctx, { synth: bassS, out: bassLp }, {
        volume: -9, glide: 0.06, scoopTime: 0.08, fallTime: 0.2, release: 0.1, staccatoRelease: 0.04,
        vibrato: { rate: 4.4, depth: 0.025, delay: 0.45, rise: 0.4, auto: true },
      });
      // the finger's thump on the string
      const thumpG = ctx.keep(new Tone.Gain(db(-21)));
      const thumpLp = ctx.keep(new Tone.Filter({ frequency: 420, type: "lowpass" })).connect(thumpG);
      const thump = ctx.keep(new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } })).connect(thumpLp);
      const thumpT = I.monotonic(thumpG);
      const bassP = I.place(ctx, bass, 0, out);
      thumpG.connect(bassP);
      I.send(ctx, bassP, room, -26);

      // the chip: six voices, the 144 ms echo with a dark feedback filter, 8-bit-ish output
      const chip = Sim.spc.chip(ctx, { voices: VOICES, volume: -5, rate: 32000, bits: 8, crush: 0.4, tone: 6800, echo: { time: 0.144, feedback: 0.5, tone: 2000, level: -5 } });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.6, pan: 0.32, volume: -3, wave: "hollow", cutoff: 3200, decay: 0.2 });
      const pluckLine = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluckLine, echo: 0.55, pan: 0.18, volume: 0, wave: "hollow", cutoff: 3600, decay: 0.24 });
      const blip = chip.voice("lead", { priority: PRIORITY.blip, echo: 0.8, pan: -0.38, volume: -9, wave: "pulse", cutoff: 5200, attack: 0.003, decay: 0.08, sustain: 0.3, release: 0.03, bend: { cents: 0, time: 0 }, vibrato: { depth: 0 } });
      const chipHat = chip.voice("hat", { priority: PRIORITY.chipHat, pan: -0.22, volume: -5, cutoff: 7500 });
      const chipPad = chip.voice("pad", { poly: 3, priority: PRIORITY.chipPad, echo: 0.45, pan: -0.1, volume: -7, cutoff: 2600, attack: 0.18, release: 0.4 });
      I.send(ctx, chip.out, room, -20);

      const vibes = I.vibes(ctx, { volume: -8, decay: 2.8, motor: 3.4, motorDepth: 0.28 });
      const tpt = I.mutedTrumpet(ctx, { volume: -3, vibratoDepth: 0.03 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 34, preload: ["softKick", "kick", "snap", "rim", "brushTap", "brushSweep", "hatPedal", "ride", "snare", "shaker", "tom", "crash"] });
      const vp = I.place(ctx, vibes, 0.3, out), tp = I.place(ctx, tpt, -0.28, out), kp = I.place(ctx, kit, 0.05, out);
      I.send(ctx, vp, plate, -12); I.send(ctx, vp, room, -18);
      I.send(ctx, tp, plate, -11); I.send(ctx, tp, slap, -15);
      I.send(ctx, kp, room, -14);

      const chipHum = { timing: 0.002, vel: 0.04 };
      return {
        bass: {
          layer: "bass", humanize: { timing: 0.004, vel: 0.04 },
          play(t, e, d) { bass.play(t, e, d); if (!e.legato && Number.isFinite(e.vel)) thump.triggerAttackRelease(0.03, thumpT(t), clamp(e.vel * 0.9)); },
        },
        trumpet: { layer: "melody", play: (t, e, d) => tpt.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        vibesLine: { layer: "melody", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.05 } },
        pluckLine: { layer: "melody", play: pluckLine.play, humanize: chipHum },
        vibes: { layer: "harmony", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.06 } },
        chipPad: { layer: "harmony", play: chipPad.play, humanize: chipHum },
        pluck: { layer: "texture", play: pluck.play, humanize: chipHum },
        blip: { layer: "texture", play: blip.play, humanize: chipHum },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.len, pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.1 } },
        chipHat: { layer: "drums", play: chipHat.play, humanize: chipHum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const pos = cycle % LAP.length, lap = Math.floor(cycle / LAP.length);
      const { sec, half } = LAP[pos];
      const S = SEC[sec];
      const key = `${lap}:${pos - half}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...planSection(sec, lap, r.fork(7)) };
      const PL = state.plan;
      const prog = PL.prog;
      const off = half * CB, w0 = off * BPB, w1 = w0 + CB * BPB;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (secBeat) => chordAt(Math.max(0, Math.min(secBeat, S.bars * BPB - 0.001))).chord;
      const nextSec = LAP[(pos + 1) % LAP.length].sec;
      const lastHalf = (pos + 1) % LAP.length === 0 || LAP[(pos + 1) % LAP.length].sec !== sec;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beats from this cycle's start
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: clamp(vel), ...extra });
      };
      /** Emit a section's pre-routed events that fall in this cycle's window. */
      const emit = (evs, gain = 1) => {
        for (const e of evs) {
          const abs = e.bar * BPB + e.beat - w0;
          if (abs < -1e-6 || abs >= w1 - w0 - 1e-6) continue;
          const bar = Math.floor(abs / BPB + 1e-9);
          ev.push({ ...e, bar, beat: +(abs - bar * BPB).toFixed(4), vel: clamp(e.vel * gain) });
        }
      };
      emit(PL.bass); emit(PL.pluckLine); emit(PL.trumpet); emit(PL.vibesLine);
      if (PL.share === "phrase") for (let i = 0; i < CB; i++) { // the bass holds the root under the guitar's phrase
        const secBar = off + i;
        if (PL.bass.some((n) => n.bar === secBar)) continue;
        const c = T.chord(sym(secBar * BPB));
        push("bass", i * BPB, 2.6, T.nearest(41, [c.bass], 36, 48), 0.62);
      }
      const tptAt = (secBeat, dur) => PL.trumpet.some((n) => { const a = n.bar * BPB + n.beat; return Math.min(a + n.dur, secBeat + dur) - Math.max(a, secBeat) > 0.05; });
      const pluckLineInBar = (secBar) => PL.pluckLine.some((n) => n.bar === secBar);
      const spans = prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, s: h.bar * BPB + h.beat }));
      const isA = sec === "A1" || sec === "A2" || sec === "A3";

      const plainSym = (sym) => sym.replace(/m9/, "m7").replace(/maj7#11/, "maj7").replace(/13/, "7").replace(/7b9|7#11/, "7");
      // ---------- vibes comping ----------
      const PATS = [[[[1.5, 0.6], [3.5, 0.45]], 3], [[[2.5, 1.0]], 2], [[[0.5, 0.45], [2, 0.6]], 1.5], [[[3, 0.7]], 1.5]];
      const voicing = (h, o) => { const v = T.voice(h.chord, { lo: 62, hi: 81, n: 3, prev: state.vv, top: [69, 79], rng: r, omitBass: true, ...o }); state.vv = v; return v; };
      for (const h of spans) {
        const secBar = h.bar;
        if (isA) {
          if (sec === "A1" && secBar < 4) continue;
          if (pluckLineInBar(secBar)) continue; // the chip guitar has the line (or the walk-down) here: the vibes clear out
          const pat = h.dur >= 4 ? r.weighted(PATS) : [[0.5, 0.55]];
          for (const [o, len] of pat) {
            if (o >= h.dur - 0.1) continue;
            const at = h.s + o;
            if (tptAt(at, len)) continue; // the vibes stay out of the trumpet's answer
            push("vibes", at - w0, Math.min(len, h.dur - o - 0.05), voicing(h), 0.4 + r.range(-0.03, 0.03) + (sec === "A3" ? 0.04 : 0));
          }
        } else if (sec === "B") {
          const ph = { ...h, chord: plainSym(h.chord) }; // the plain seventh chord: the ninths and sharp elevenths belong to the guitar and the bass
          if (secBar === 7) { [0, 1.5].forEach((o) => push("vibes", h.s + o - w0, 0.35, voicing(ph, { n: 4, lo: 60, hi: 82 }), 0.58)); }
          else push("vibes", h.s - w0, h.dur - 0.25, voicing(ph, { n: 3, lo: 60, hi: 80, top: [68, 78] }), 0.36 + 0.015 * secBar);
        }
      }
      // ---------- chip pad (C only) ----------
      if (sec === "C") for (const h of spans) {
        const v = T.voice(plainSym(h.chord), { lo: 57, hi: 74, n: 3, prev: state.pv, top: [65, 73], rng: r, omitBass: true });
        state.pv = v;
        push("chipPad", h.s - w0, h.dur - 0.35, v, 0.42);
      }
      // ---------- chip guitar: the comping "chick" (guide tones, offbeats) and the B ostinato ----------
      const guide = (secBeat, centre = 70) => { const c = T.chord(sym(secBeat)); return c.guide.map((pc) => T.nearest(centre, [pc], 64, 78)); };
      for (let i = 0; i < CB; i++) {
        const secBar = off + i, B0 = i * BPB, sb = secBar * BPB;
        if (isA) {
          if (sec === "A1" && secBar < 4) continue;
          if (pluckLineInBar(secBar)) continue; // not while it carries the hook
          const slots = sec === "A1" ? [2.5] : [0.5, 2.5];
          for (const o of slots) {
            if (tptAt(sb + o, 0.3) && r.chance(0.5)) continue;
            push("pluck", B0 + o, 0.25, guide(sb + o), 0.42 + (o === 2.5 ? 0.03 : 0));
          }
        } else if (sec === "B") {
          const c = T.chord(sym(sb));
          if (secBar === 7) continue;
          if (secBar < 4) { // offbeat 8ths, the third and the fifth alternating up high
            const third = T.nearest(76, [mod12(c.root + (c.intervals.includes(3) ? 3 : 4))], 70, 82), fifth = T.nearest(76, [mod12(c.root + (c.intervals.includes(6) ? 6 : 7))], 70, 82);
            [0.5, 1.5, 2.5, 3.5].forEach((o, k) => push("pluck", B0 + o, 0.25, k % 2 ? fifth : third, 0.44));
          } else { // 16ths bouncing 3 5 7 9 7 5 (six against the sixteen), the echo smearing them
            const iv = [c.intervals.includes(3) ? 3 : 4, c.intervals.includes(6) ? 6 : 7, c.intervals.includes(11) ? 11 : 10, 14];
            let m = T.nearest(secBar % 2 ? 74 : 70, [mod12(c.root + iv[0])], 66, 78);
            const stack = [m];
            for (const k of iv.slice(1)) { m = T.nearest(m + 3, [mod12(c.root + k)], m + 1, m + 12); stack.push(m); }
            const seq = [stack[0], stack[1], stack[2], stack[3], stack[2], stack[1]];
            for (let q = 0; q < 16; q++) push("pluck", B0 + q * 0.25, 0.22, seq[q % 6], 0.36 + (q % 4 === 0 ? 0.1 : q % 2 === 0 ? 0.04 : 0));
          }
        }
      }
      // ---------- the alarm blip (B): the ninth, high, through the long echo ----------
      if (sec === "B") for (let i = 0; i < CB; i++) {
        const secBar = off + i, B0 = i * BPB, c = T.chord(sym(secBar * BPB));
        if (secBar === 7) { [0, 1.5].forEach((o) => push("blip", B0 + o, 0.2, T.nearest(88, [mod12(c.root + 4)], 82, 94), 0.6)); continue; }
        if (secBar % 2 === 0) push("blip", B0 + 3.5, 0.2, T.nearest(86, [mod12(c.root + 2)], 80, 92), 0.5);
        if (secBar === 5) push("blip", B0 + 3.75, 0.15, T.nearest(86, [mod12(c.root + 2)], 80, 92), 0.4);
      }

      // ---------- drums ----------
      const Dr = (i, b, voice, vel, extra) => push("drums", i * BPB + b, 0.1, voice, vel, extra);
      const Hat = (i, b, vel) => push("chipHat", i * BPB + b, 0.1, "chipHat", vel);
      for (let i = 0; i < CB; i++) {
        const secBar = off + i, last = lastHalf && i === CB - 1;
        if (sec === "intro") {
          if (secBar >= 1) Dr(i, 0, "softKick", 0.5);
          if (secBar >= 2 || lap > 0) { Dr(i, 1, "snap", 0.55); Dr(i, 3, "snap", 0.58); }
          if (lap > 0) { Dr(i, 1, "hatPedal", 0.26); Dr(i, 3, "hatPedal", 0.26); }
          if (secBar === 3) { Dr(i, 3, "brushTap", 0.3); Dr(i, 3.5, "brushTap", 0.36); }
          continue;
        }
        if (isA) {
          const full = sec === "A3", mid = sec === "A2";
          Dr(i, 0, "softKick", full ? 0.72 : 0.6); Dr(i, 2.5, "softKick", full ? 0.5 : 0.4);
          if (full && secBar % 2 === 1 && r.chance(0.6)) Dr(i, 1.75, "softKick", 0.34);
          Dr(i, 1, "snap", 0.6); if (!(last && r.chance(0.5))) Dr(i, 3, "snap", 0.62);
          if (full) { Dr(i, 1, "rim", 0.42); Dr(i, 3, "rim", 0.44); }
          Dr(i, 1, "hatPedal", 0.28); Dr(i, 3, "hatPedal", 0.3);
          if (mid || full) for (let e = 0; e < 8; e++) { if (last && e >= 6) break; Dr(i, e / 2, "ride", e % 2 ? 0.2 : e % 4 === 0 ? 0.34 : 0.28); }
          else for (let e = 0; e < 8; e++) { if (last && e >= 6) break; if (e % 2 || sec !== "A1" || secBar >= 2) Dr(i, e / 2, "brushTap", e % 2 ? 0.2 : 0.27); }
          if (full) for (let q = 1; q < 16; q += 2) Dr(i, q / 4, "shaker", q % 4 === 1 ? 0.15 : 0.2); // the 16th offbeats between the ride's 8ths
          if (r.chance(mid || full ? 0.35 : 0.2)) Dr(i, 3.75, "rim", 0.3, { ghost: true });
          if (r.chance(0.25)) Dr(i, 1.75, "rim", 0.3, { ghost: true });
          if (full && half === 0 && i === 0) Dr(i, 0, "crash", 0.34);
          if (last) { // a small fill into whatever comes next
            if (nextSec === "B") { for (let q = 8; q < 16; q++) Dr(i, q / 4, "brushTap", 0.26 + 0.05 * (q - 8)); Dr(i, 3.5, "softKick", 0.5); Dr(i, 3.75, "rim", 0.5); }
            else { [3, 3 + 1 / 3, 3 + 2 / 3].forEach((p, k) => Dr(i, p, "brushTap", 0.34 + 0.08 * k, { straight: true })); Dr(i, 3 + 2 / 3, "softKick", 0.4, { straight: true }); }
          }
        } else if (sec === "B") {
          if (secBar === 7) { // the stop-hits, then nothing
            [0, 1.5].forEach((b) => { Dr(i, b, "kick", 0.85); Dr(i, b, "snare", 0.75); Dr(i, b, "snap", 0.7); Hat(i, b, 0.6); });
            continue;
          }
          for (let q = 0; q < 16; q++) Hat(i, q / 4, q % 4 === 0 ? 0.6 : q % 2 === 0 ? 0.42 : 0.28);
          Dr(i, 0, "kick", 0.8); Dr(i, 2.5, "kick", 0.62); if (secBar >= 4) Dr(i, 3.5, "kick", 0.5);
          Dr(i, 1, "snare", 0.5); Dr(i, 3, "snare", 0.54); Dr(i, 1, "snap", 0.6); Dr(i, 3, "snap", 0.62);
          if (secBar >= 4 && r.chance(0.5)) Dr(i, 3.75, "snare", 0.3, { ghost: true });
          if (secBar === 6) { Dr(i, 2.5, "tom", 0.5, { pitch: 50 }); Dr(i, 3, "tom", 0.56, { pitch: 45 }); Dr(i, 3.5, "tom", 0.62, { pitch: 41 }); Dr(i, 3.75, "snare", 0.5); }
        } else if (sec === "C") {
          Dr(i, 0, "brushSweep", 0.3, { len: 1.6 }); Dr(i, 2, "brushSweep", 0.26, { len: 1.5 });
          Dr(i, 0, "softKick", 0.56); if (secBar % 2 === 1) Dr(i, 2.5, "softKick", 0.36);
          Dr(i, 2, "snap", 0.52);
          Dr(i, 1, "hatPedal", 0.22); Dr(i, 3, "hatPedal", 0.24);
          if (secBar >= 4) for (let e = 0; e < 8; e += 2) Dr(i, e / 2, "ride", 0.2);
          if (last) { [3, 3 + 1 / 3, 3 + 2 / 3].forEach((p, k) => Dr(i, p, "brushTap", 0.3 + 0.1 * k, { straight: true })); Dr(i, 3.5, "softKick", 0.45); }
        }
      }

      // ---------- feel: everything above sits on the grid; Sim.groove moves it ----------
      ev = G.ghosts(ev, { track: "drums", vel: 0.22, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: {
            snap: { template: "laidback", amount: 1.3 }, rim: { template: "laidback", amount: 1.2 }, snare: { template: "laidback", amount: 1.1 },
            hatPedal: "pushed", brushTap: { template: "pushed", amount: 0.5 }, ride: { template: "mpc54", late: 4 }, shaker: { template: "mpc58", late: -3 },
            softKick: "straight", kick: "straight", brushSweep: "straight", crash: "straight", tom: "straight",
          } },
          chipHat: "pushed",
          bass: { template: { unit: 0.5, offsets: [0, 0], ms: [0, 3], vels: [1, 0.92] }, late: sec === "C" ? 10 : 2 },
          pluck: { template: "straight", late: -3 },
          vibes: { template: "straight", late: 12, vels: false },
          vibesLine: { template: "straight", late: 8, vels: false },
          trumpet: { template: "straight", late: 18, vels: false },
          chipPad: { template: "straight", late: 20, vels: false },
        },
      });
      if (sec === "C") ev = G.rubato(ev, { track: "vibesLine", bpm: BPM, bpb: BPB, amount: 0.7, linger: "high", lingerMs: 50, rng: r });
      if (sec === "B" && half === 1) ev = G.crescendo(ev, { tracks: ["drums", "chipHat", "pluck"], from: 0, to: 12, v0: 0.92, v1: 1.1 });

      // ---------- the chip: six voices, stolen by priority ----------
      const chipEv = ev.filter((e) => CHIP_TRACKS.has(e.track)), rest = ev.filter((e) => !CHIP_TRACKS.has(e.track));
      const bud = Sim.spc.budget(chipEv, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen = (state.stolen || 0) + bud.stolen;
      ev = rest.concat(bud.events);

      const harmony = spans.map((h) => ({ bar: h.bar - off, beat: h.beat, dur: h.dur, chord: h.chord }));
      let label = PL.label;
      if (sec === "B" && half === 1) label = "B · G7♯11 into C7♭9 · two stop-hits and silence";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${label}`, state, tempo: tempoAt(pos) };
    },
  });
})();
