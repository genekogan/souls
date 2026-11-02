// Citronella: a late-evening hangout. People on a porch after dark, talking; the music is company, not a
// performance. D major at 76, straight 8ths with a brushed pocket so light it is almost implied.
//
// The band: a hummed voice (a wordless mono "ooh" with late vibrato, scoops, slurs and breaths, built on
// Sim.phrasing), a nylon guitar that fingerpicks under it and takes the tune when the voice stops (one tune
// shared between two players: Sim.dialogue), a soft electric piano that comes in for the second half, an
// upright bass mostly in two, brushes on 2 and 4, and a pad that only breathes under the lift and the tag.
// Feel: Sim.groove templates (the brushes sit late, the taps lean forward, the piano sits back) and rubato on
// the voice; the tag slows a little every lap and the band comes back a tempo.
//
// THE TUNE (fixed by hand; the generator never changes a pitch or a rhythm, only who plays it, how it is
// ornamented, and whether it plays at all). The motif is a scoop into the third and two slurred steps down.
//   A  | Dmaj9 | Gmaj9 | F#m7 | B9 | Em9 | A13sus4 | D69 | Gm6 A13 |
//      | . F#4^ E4~ D4~ | B3_ . A3 B3 | C#4~ A3~ E4~v | D#4~v . . | . G4^ F#4~ E4~ D4~ | B3_ . D4 E4 F#4 | A4v F#4~ E4~ D4~ | Bb3_v A3~ . |
//      bar 1 the motif on I; bar 2 the third of IV, low, and a pickup; bar 3 the pickup climbs F#m7 to its seventh;
//      bar 4 D# is the third of B9, the secondary dominant that smiles, held; bar 5 the motif a step up on ii;
//      bar 6 the 9 of the sus chord and a climbing pickup; bar 7 the motif from the fifth; bar 8 Bb, the borrowed
//      iv, sighing down to A: the lived-in note of the whole piece.
//   A' bars 7-8: | Bm9 | Em9 A13sus4 |  A4v F#4~ D4~ | E4 G4~ B4~v   (the line rises into the lift)
//   B (the lift, a fifth higher) | Gmaj9 | Gm6 | Dmaj9/F# | Bm9 | E9 | E9 | A13sus4 | A13 |
//      | D5^ B4~ A4~ G4~ | Bb4_v A4~ . | . A4 F#4~ E4~ D4~ | C#4 D4~ F#4~v . | G#4^v F#4~ E4~ | D4_ B3~ E4~v | . D4 E4~ F#4~ G4~v | F#4v E4~ C#4~ . |
//      bar 2 the Bb-to-A sigh an octave up; bar 5 G# is the third of E9 (II7), the other smile; bars 7-8 climb and settle.
//   TAG | Dmaj9 | Bbmaj7 | Gm6 | A13sus4 |   the motif · D4 F4~ A4~v · Bb4_v G4~ E4~ · E4 D4~ B3~v
//      bVI, then the borrowed iv, then the sus chord: the 70s turnaround.
// ONE LAP = intro 4 · A 8 · A' 8 · B 8 · A 8 · tag 4 = 40 bars ≈ 2:05. The tune is present about two thirds of the
// time: some sections are only the guitar and the room (Orbital Survey's lesson: hold a room for an hour).
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const { mod12 } = T;
  const BPB = 4, CB = 4, BPM = 76;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- harmony ----------
  const PROG = {
    intro: "| Dmaj9 | Gmaj9/D | Dmaj9 | Gm6/D |",
    A: "| Dmaj9 | Gmaj9 | F#m7 | B9 | Em9 | A13sus4 | D69 | Gm6 A13 |",
    A2: "| Dmaj9 | Gmaj9 | F#m7 | B9 | Em9 | A13sus4 | Bm9 | Em9 A13sus4 |",
    B: "| Gmaj9 | Gm6 | Dmaj9/F# | Bm9 | E9 | E9 | A13sus4 | A13 |",
    tag: "| Dmaj9 | Bbmaj7 | Gm6 | A13sus4 |",
  };
  PROG.A3 = PROG.A;
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const BARS = { intro: 4, A: 8, A2: 8, B: 8, A3: 8, tag: 4 };

  // ---------- the tune (Sim.phrasing notation: Note/beats + marks; ^ scoop, ~ slur, v vibrato, _ tenuto) ----------
  const TUNE_A = [
    "r/0.5 F#4/1.5^ E4/1~ D4/1~",
    "B3/2.5_ r/0.5 A3/0.5 B3/0.5",
    "C#4/1.5~ A3/0.5~ E4/2~v",
    "D#4/2.5~v r/1.5",
    "r/0.5 G4/1^ F#4/0.5~ E4/1~ D4/1~",
    "B3/2_ r/0.5 D4/0.5 E4/0.5 F#4/0.5",
    "A4/1.5v F#4/0.5~ E4/1~ D4/1~",
    "Bb3/2_v A3/1.5~ r/0.5",
  ];
  const TUNE_A2 = TUNE_A.slice(0, 6).concat(["A4/1.5v F#4/0.5~ D4/2~", "E4/1 G4/1~ B4/2~v"]);
  const TUNE_B = [
    "D5/1.5^ B4/0.5~ A4/1~ G4/1~",
    "Bb4/2_v A4/1~ r/1",
    "r/0.5 A4/1 F#4/0.5~ E4/1~ D4/1~",
    "C#4/1.5 D4/0.5~ F#4/1.5~v r/0.5",
    "G#4/2^v F#4/1~ E4/1~",
    "D4/1.5_ B3/0.5~ E4/2~v",
    "r/0.5 D4/1 E4/0.5~ F#4/0.5~ G4/1.5~v",
    "F#4/1.5v E4/0.5~ C#4/1~ r/1",
  ];
  const TUNE_TAG = [
    "r/0.5 F#4/1.5^ E4/1~ D4/0.5~ r/0.5",
    "D4/1 F4/1~ A4/2~v",
    "Bb4/2_v G4/1~ E4/0.5~ r/0.5",
    "E4/1 D4/1~ B3/1.5~v r/0.5",
  ];
  const FRAG = ["r/0.5 F#4/1.5^ E4/1~ D4/1~"]; // the motif alone, for an intro
  const TUNE = { A: TUNE_A, A2: TUNE_A2, B: TUNE_B, A3: TUNE_A, tag: TUNE_TAG };
  // phrase marks in beats from the section start (where the rests are)
  const PHR = {
    A: [{ from: 0, to: 6.5, dyn: "arch", legato: true }, { from: 7, to: 16, dyn: "arch", legato: true }, { from: 16, to: 22, dyn: "arch", legato: true }, { from: 22.5, to: 32, dyn: ">", legato: true }],
    B: [{ from: 0, to: 7, dyn: ">", legato: true }, { from: 8.5, to: 16, dyn: "arch", legato: true }, { from: 16, to: 23, dyn: "arch", legato: true }, { from: 24.5, to: 32, dyn: ">", legato: true }],
    tag: [{ from: 0, to: 4, dyn: "arch", legato: true }, { from: 4, to: 11.5, dyn: "arch", legato: true }, { from: 12, to: 16, dyn: ">", legato: true }],
  };
  PHR.A2 = PHR.A; PHR.A3 = PHR.A;

  // ---------- form ----------
  const LAP = [["intro", 0], ["A", 0], ["A", 1], ["A2", 0], ["A2", 1], ["B", 0], ["B", 1], ["A3", 0], ["A3", 1], ["tag", 0]];
  // who: who has the tune. hum | gtr | handoff | phrase (alternating, `order`) | none (the band and the room)
  // respond: the guitar answers in the voice's rests. keys: e-piano in. pad: the bed. gtr: pick | thumb. frag: the motif in the intro.
  const PLANS = [
    {
      intro: { who: "none", gtr: "pick", drums: "intro" },
      A: { who: "hum", gtr: "pick", drums: "light", orn: 0 },
      A2: { who: "handoff", gtr: "pick", keys: true, drums: "light", orn: 0.15 },
      B: { who: "hum", gtr: "pick", keys: true, pad: true, drums: "lift", orn: 0.2 },
      A3: { who: "phrase", order: ["gtrLead", "hum"], gtr: "pick", keys: true, drums: "light", orn: 0.25 },
      tag: { who: "gtr", gtr: "thumb", pad: true, drums: "tag" },
    },
    {
      intro: { who: "none", frag: true, gtr: "pick", drums: "intro" },
      A: { who: "gtr", gtr: "thumb", drums: "light", orn: 0.1 },
      A2: { who: "hum", respond: true, gtr: "pick", keys: true, drums: "light", orn: 0.2 },
      B: { who: "handoff", gtr: "pick", keys: true, pad: true, drums: "lift", orn: 0.2 },
      A3: { who: "hum", gtr: "pick", keys: true, drums: "light", orn: 0.3 },
      tag: { who: "none", gtr: "pick", keys: true, pad: true, drums: "tag" },
    },
    {
      intro: { who: "none", gtr: "pick", drums: "intro" },
      A: { who: "none", gtr: "pick", drums: "light" },
      A2: { who: "phrase", order: ["hum", "gtrLead"], respond: true, gtr: "pick", keys: true, drums: "light", orn: 0.2 },
      B: { who: "hum", gtr: "pick", keys: true, pad: true, drums: "lift", orn: 0.25 },
      A3: { who: "handoff", gtr: "pick", keys: true, drums: "light", orn: 0.3 },
      tag: { who: "hum", gtr: "thumb", pad: true, drums: "tag", orn: 0 },
    },
  ];
  const NAMES = { intro: "intro · the guitar, the room", A: "A · the tune", A2: "A′ · rising into the lift", B: "B · the lift, a fifth up", A3: "A · again", tag: "tag · ♭VI, the borrowed iv, and back" };
  const WHO = { hum: "the voice", gtr: "the guitar has the tune", handoff: "voice and guitar pass it", phrase: "voice and guitar trade phrases", none: "no tune" };

  // the tag slows a touch every lap; the next lap's intro counts back in a tempo
  const tempoAt = G.tempoScript(BPM, [G.aTempo(0, BPM), G.ritardando(9, 71, 12)]);

  // ---------- the hummed voice: mostly fundamental, an "ooh" formant, late vibrato ----------
  function humSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.42, 0.14, 0.07, 0.03, 0.015] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.7 },
      envelope: { attack: 0.06, decay: 0.3, sustain: 0.85, release: 0.3 },
      filterEnvelope: { attack: 0.09, decay: 0.4, sustain: 0.6, release: 0.3, baseFrequency: 520, octaves: 1.3 },
    }));
  }

  /** A guitar shape: the root on a low string (nearest the last one), then 3rd (or 4th), 7th (or 6th) and the 9th, else the 5th, stacked upward. */
  function guitarShape(ch, prevRoot) {
    const R = T.nearest(prevRoot ?? 50, [ch.root], 43, 55);
    const third = ch.intervals.find((i) => i === 3 || i === 4), seventh = ch.intervals.find((i) => i === 10 || i === 11);
    const fifth = ch.intervals.find((i) => i === 7 || i === 6), ninth = ch.intervals.includes(14) ? 14 : null;
    const order = [];
    if (third != null) order.push(third); else if (ch.intervals.includes(17)) order.push(5); else if (ninth) order.push(2);
    if (seventh != null) { order.push(seventh); if (ninth && third != null) order.push(14); else if (fifth != null) order.push(fifth); }
    else if (ch.intervals.includes(9)) { if (fifth != null) order.push(fifth); order.push(9); }
    else { if (fifth != null) order.push(fifth); if (ninth) order.push(14); }
    const out = [R];
    let cur = R;
    for (const iv of order) {
      let m = R + (iv % 12);
      while (m <= cur + 1) m += 12; // strictly above the last voice, never a semitone over it
      if (m > 69) continue;
      out.push(m); cur = m;
    }
    return out;
  }

  Sim.register({
    id: "citronella",
    title: "Citronella",
    genre: "Porch song",
    about: "A late-evening hangout on a porch after dark: a hummed voice sings one hand-written tune with scoops, slurs and breaths, the nylon guitar fingerpicks under it and takes the tune over when the voice stops, a soft electric piano and a pad arrive for the lift, the upright plays in two and the brushes barely touch the snare. D major at 76 with maj9s, a borrowed iv that sighs to the fifth, two secondary dominants that smile, and a ♭VI turnaround that slows a little every lap. Some sections leave the tune out entirely: the music is company, not a performance.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["hangout", "campfire", "romance"],
    energy: 0.35,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.014, lowcut: 260, highcut: 6500 });
      const porch = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.03, lowcut: 350, highcut: 5000 });
      // the voice: synth -> phrasing wrapper -> formant peak -> soft lowpass -> pan
      const hum = P.wrap(ctx, humSynth(ctx), {
        volume: -7, glide: 0.085, scoopTime: 0.13, fallTime: 0.3, release: 0.3,
        vibrato: { rate: 4.7, depth: 0.065, delay: 0.42, rise: 0.55, deepen: 1.3 },
        breath: P.breath(ctx, room, { level: -31, freq: 1500, length: 0.16 }),
      });
      const formant = ctx.keep(new Tone.Filter({ frequency: 720, type: "peaking", Q: 1.1, gain: 4 }));
      const humLp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 }));
      const humP = ctx.keep(new Tone.Panner(0.06)).connect(out);
      hum.out.connect(formant); formant.connect(humLp); humLp.connect(humP);
      const guitar = I.nylon(ctx, { volume: -8, cutoff: 3400 });
      const gtrLead = I.nylon(ctx, { volume: -2, cutoff: 4300, attackNoise: 0.9 });
      const keys = I.rhodes(ctx, { volume: -13, cutoff: 2600, tremolo: 2.6, tremoloDepth: 0.16, bark: 1.5, tine: -18 });
      const bass = I.upright(ctx, { volume: -5, base: 150 });
      const pad = I.pad(ctx, { volume: -23, cutoff: 820, attack: 2.2, release: 3.2, breath: 0.05, detune: 14 });
      const kit = I.kit(ctx, { volume: 0, kickNote: 34, preload: ["brushSweep", "brushTap", "hatPedal", "softKick", "rim", "shaker"] });
      const gP = I.place(ctx, guitar, -0.3, out), glP = I.place(ctx, gtrLead, 0.22, out), kP = I.place(ctx, keys, 0.3, out);
      const bP = I.place(ctx, bass, 0, out), pP = I.place(ctx, pad, -0.1, out), dP = I.place(ctx, kit, 0.05, out);
      I.send(ctx, humP, room, -12); I.send(ctx, humP, porch, -16);
      I.send(ctx, gP, room, -11); I.send(ctx, gP, porch, -20);
      I.send(ctx, glP, room, -10); I.send(ctx, glP, porch, -15);
      I.send(ctx, kP, room, -13); I.send(ctx, kP, porch, -18);
      I.send(ctx, bP, room, -26);
      I.send(ctx, pP, porch, -8);
      I.send(ctx, dP, room, -14);
      return {
        hum: { layer: "melody", play: (t, e, d) => hum.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        gtrLead: { layer: "melody", play: (t, e, d) => gtrLead.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        guitar: { layer: "harmony", play: (t, e, d) => guitar.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.009, vel: 0.08 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        pad: { layer: "texture", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.len }), humanize: { timing: 0.006, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const pos = cycle % LAP.length, lap = Math.floor(cycle / LAP.length);
      const [sec, half] = LAP[pos];
      const plan = PLANS[lap % PLANS.length][sec];
      const bars = BARS[sec], secStart = half * 16, secEnd = bars * BPB;
      const prog = TL[sec];
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(Math.max(0, Math.min(b, secEnd - 0.001))).chord;
      const scaleAt = (b) => T.chord(sym(b)).scale;
      const lastHalf = secStart + 16 >= secEnd;
      const nextSec = LAP[(pos + 1) % LAP.length][0];
      const nextFirst = TL[nextSec][0].chord;
      let ev = [];
      // push by beat within the SECTION; events outside this cycle's window are dropped
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -1e-6 || abs >= 16 - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---------- the tune: built once per section and lap, then shared by both halves ----------
      const key = `${sec}:${lap}`;
      if (!state.line || state.line.key !== key) {
        const rr = r.fork(31 + lap);
        const L = { key, notes: [] };
        const text = sec === "intro" ? (plan.frag ? FRAG : null) : plan.who !== "none" ? TUNE[sec] : null;
        if (text) {
          const line = P.line(text, { beatsPerBar: BPB, track: "hum" });
          const orn = plan.orn ?? 0;
          line.forEach((e, i) => {
            const a = P.parseArt(e.art || "");
            const prev = line[i - 1];
            const leap = prev ? e.note - prev.note : 0;
            // a hum: higher and longer a touch fuller; the phrase-closing sighs stay soft
            e.vel = 0.7 + (e.note - 66) / 110 + (e.dur >= 2 ? 0.03 : 0) + (a.tenuto ? 0.02 : 0) + rr.gauss(0.012);
            if (sec === "B") e.vel += 0.04;
            // ornaments, sparingly and never on a note that already scoops: a grace from below on a leap, a mordent on a held note
            if (!a.scoop && !a.staccato && !a.grace && !a.mordent) {
              if (leap >= 4 && e.dur >= 1 && rr.chance(orn * 0.6)) e.grace = "step";
              else if (e.dur >= 2 && !a.legato && prev && prev.bar * BPB + prev.beat + prev.dur >= e.bar * BPB + e.beat - 0.01 && rr.chance(orn * 0.5)) e.mordent = true;
              else if (e.dur >= 1.5 && a.legato && rr.chance(orn * 0.35)) e.fall = 2;
            }
          });
          const marks = sec === "intro" ? [{ from: 8, to: 12, dyn: "arch", legato: true }] : PHR[sec];
          const shaped = P.articulate(line, marks, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.08, breathLate: 0.035, breathGap: 0.14, breathFirst: true });
          const notes = shaped.map((e) => ({ ...e, at: e.bar * BPB + e.beat }));
          // who plays it
          const V = { hum: { track: "hum", range: [55, 77] }, gtr: { track: "gtrLead", range: [50, 81], gain: 0.92 } };
          let dist;
          const who = sec === "intro" ? "gtr" : plan.who;
          if (who === "hum") dist = notes.map((n) => ({ ...n, track: "hum" }));
          else if (who === "gtr") dist = notes.map((n) => ({ ...n, track: "gtrLead", vel: n.vel * 0.92 }));
          else if (who === "handoff") dist = D.distribute(notes, { voices: [V.hum, V.gtr], mode: "handoff", rng: rr, bpb: BPB, breath: 0.5, handoffDur: 2, minNotes: 2, handoffChance: 0.5, stay: 0.4, join: "extend", overlap: 0.2 });
          else dist = D.distribute(notes, { voices: [V.hum, V.gtr], mode: "phrase", order: plan.order, rng: rr, bpb: BPB, breath: 0.5 });
          // the guitar only slurs on paper: strip the voice's articulation from its notes (a pluck cannot scoop)
          dist = dist.map((n) => (n.track === "hum" ? n : { ...n, scoop: undefined, fall: undefined, bend: undefined, vib: undefined, breath: undefined, delay: n.delay && n.entrance ? n.delay : undefined }));
          if (plan.respond) {
            const calls = dist.filter((n) => n.track === "hum");
            const ans = D.respond(calls, {
              track: "gtrLead", transform: (i) => ({ tail: 3, even: 0.5, steps: i % 2 ? -2 : -3 }), scaleAt, range: [57, 79], vel: 0.5, minGap: 1, end: secEnd, bpb: BPB, breath: 0.5,
              gap: (i, ph) => { const e = Math.max(...ph.map((n) => n.at + n.dur)); return Math.ceil(e * 2 - 1e-6) / 2 - e; },
            });
            dist = dist.concat(ans);
          }
          L.notes = dist;
        }
        state.line = L;
      }
      const tune = state.line.notes;
      for (const n of tune) {
        const { at, bar, beat, dur, note, vel, track, idx, phrase, voice, shift, entrance, handoff, join, answer, ...extra } = n;
        push(track, at, dur, note, vel, extra);
      }
      // notes the accompaniment must not rub against (held, in this window)
      const held = tune.filter((n) => n.dur >= 0.9 && n.at < secStart + 16 && n.at + n.dur > secStart);
      const rub = (m, y) => [1, 13].includes(Math.abs(m - y));
      const badFor = (s0, s1, others = []) => {
        const hs = held.filter((n) => n.at < s1 - 0.4 && n.at + n.dur > s0 + 0.4).map((n) => n.note).concat(others);
        return (y) => hs.some((m) => rub(m, y));
      };
      /** Drop (or lower an octave) voices that rub against a held tune note or another instrument, then refill to `want`. */
      const fit = (v, c, bad, lo, hi, want) => {
        const o = [];
        for (let x of v) {
          if (bad(x) && x - 12 >= lo && !bad(x - 12) && !v.some((z) => Math.abs(z - (x - 12)) <= 2)) x -= 12;
          if (!bad(x) && !o.includes(x)) o.push(x);
        }
        const fill = [c.root, mod12(c.root + 7), ...c.colors, ...c.guide].filter((pc) => c.pcs.includes(pc));
        for (const pc of fill) {
          if (o.length >= want) break;
          if (o.some((m) => mod12(m) === pc)) continue;
          const mid = o.length ? (Math.min(...o) + Math.max(...o)) / 2 : (lo + hi) / 2;
          const cand = T.notesIn([pc], lo, hi).filter((m) => !bad(m) && o.every((z) => Math.abs(z - m) >= 2 && !rub(z, m)) && !(m < 52 && o.some((z) => Math.abs(z - m) < 5)));
          if (cand.length) o.push(cand.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x)));
        }
        return (o.length ? o : v).sort((a, b) => a - b);
      };
      const gtrLeadBars = new Set(tune.filter((n) => n.track === "gtrLead").map((n) => Math.floor(n.at / BPB)));

      // ---------- harmony: guitar, e-piano, pad ----------
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= secStart && c.s < secStart + 16);
      // the e-piano's figure per span is decided first: when it anticipates a change, the guitar leaves the and-of-4 empty
      const kinds = spans.map((c) => !plan.keys ? null : sec === "B" ? r.weighted([["ant", 2], ["pulse", 2], ["hold", 1]]) : r.weighted([["hold", 3], ["ant", 2], ["rest", 1]]));
      spans.forEach((c, i) => {
        const kind = kinds[i], antNext = kinds[i + 1] === "ant";
        const bad = badFor(c.s, c.s + c.dur);
        const ch = T.chord(c.chord);
        const leadHere = gtrLeadBars.has(c.bar);
        // guitar: a four-voice shape in the middle of the neck, voice-led from the last one
        let gv = guitarShape(ch, state.gRoot);
        state.gRoot = gv[0];
        gv = fit(gv, ch, bad, 43, 69, gv.length);
        const lowest = gv[0], rest = gv.slice(1);
        const mid = rest[0], high = rest[rest.length - 1];
        const inner = rest.length > 2 ? rest[1] : lowest + 12 <= 71 && !rest.includes(lowest + 12) ? lowest + 12 : high;
        const strum = (sec === "B" && c.bar === 0 && half === 0) || (sec === "tag" && c.bar === 1);
        const base = sec === "intro" ? 0.46 : sec === "B" ? 0.44 : 0.42;
        const style = leadHere ? "thumb" : plan.gtr;
        if (style === "thumb") {
          // under its own melody the guitar only keeps the thumb going: bass note on 1, the middle of the shape on 3
          push("guitar", c.s, 1.8, lowest, base + 0.04);
          if (c.dur >= 4) push("guitar", c.s + 2, antNext ? 1.3 : 1.6, r.chance(0.6) ? inner : mid, base - 0.08);
        } else {
          // fingerpicking: thumb on 1 and 3, fingers on the 8ths, a few left out so it never becomes a machine
          const cell = c.dur >= 4
            ? r.weighted([[[[0, lowest, 1], [0.5, mid, 0.82], [1, inner, 0.86], [1.5, high, 0.8], [2, lowest, 0.96], [2.5, mid, 0.8], [3, inner, 0.84], [3.5, high, 0.78]], 3],
              [[[0, lowest, 1], [1, mid, 0.84], [1.5, high, 0.8], [2, lowest, 0.94], [2.5, inner, 0.8], [3, high, 0.82], [3.5, mid, 0.76]], 2],
              [[[0, lowest, 1], [0.5, inner, 0.8], [1, high, 0.84], [2, lowest, 0.94], [2.5, mid, 0.8], [3, high, 0.82]], 1.5]])
            : [[0, lowest, 1], [0.5, mid, 0.82], [1, inner, 0.86], [1.5, high, 0.8]];
          const drop = r.chance(0.5) ? r.pick([1.5, 2.5, 3.5]) : -1;
          cell.forEach(([o, m, w]) => {
            if (o >= c.dur - 0.01 || o === drop || (strum && o < 1) || (antNext && o >= c.dur - 0.6)) return;
            push("guitar", c.s + o, o % 2 === 0 ? 1.7 : 0.45, m, base * w + r.range(-0.02, 0.02));
          });
          // a soft downstrum on the bar that lifts (B's first bar) and the tag's ♭VI
          if (strum) push("guitar", c.s, 2.4, gv, base - 0.04, { strum: 0.03 });
        }
        // electric piano: held, or anticipated on the and-of-4 before the change; under the lift it pulses
        if (plan.keys) {
          let kv = T.voice(c.chord, { lo: 57, hi: 74, n: 3, prev: state.kV, rng: r, omitBass: true, top: [65, 73] });
          state.kV = kv;
          kv = fit(kv, ch, badFor(kind === "ant" ? c.s - 0.6 : c.s, c.s + c.dur, gv), 57, 74, 3);
          state.kvNow = kv;
          const kvel = 0.36 + (sec === "B" ? 0.04 : 0);
          if (kind === "hold") push("keys", c.s, c.dur - 0.4, kv, kvel);
          else if (kind === "ant") { if (c.s > secStart) push("keys", c.s - 0.5, Math.min(2.2, c.dur), kv, kvel); else push("keys", c.s, Math.min(2.2, c.dur), kv, kvel - 0.02); }
          else if (kind === "pulse") { push("keys", c.s, 1.2, kv, kvel); if (c.dur >= 4) push("keys", c.s + 2.5, 1.2, kv, kvel - 0.06); }
        }
        // the bed: one chord per span, low and slow, only under the lift and the tag
        if (plan.pad) {
          let pv = T.voice(c.chord, { lo: 53, hi: 69, n: 3, prev: state.pV, rng: r, omitBass: true, top: [62, 69] });
          state.pV = pv;
          pv = fit(pv, ch, badFor(c.s, c.s + c.dur, gv.concat(plan.keys ? state.kvNow || [] : [])), 53, 69, 3);
          push("pad", c.s, c.dur - (antNext ? 0.7 : 0.2), pv, sec === "tag" ? 0.3 : 0.34);
        }
      });

      // ---------- bass: in two, the fifth or a walk into the next root ----------
      {
        const lo = 36, hi = 50;
        let last = state.bLast ?? 38;
        spans.forEach((c, i) => {
          const ch = T.chord(c.chord);
          const root = T.nearest(last - 3, [ch.bass], lo, hi);
          const nextSym = i + 1 < spans.length ? spans[i + 1].chord : lastHalf ? nextFirst : (prog.find((x) => x.bar * BPB + x.beat === c.s + c.dur) || prog[0]).chord;
          const nextRoot = T.nearest(root, [T.chord(nextSym).bass], lo, hi);
          const pedal = ch.bass !== ch.root;
          const fifthPc = mod12(ch.root + (ch.intervals.includes(6) ? 6 : 7));
          const fifth = T.nearest(root + (root > 43 ? -5 : 7), [fifthPc], lo, hi);
          const third = ch.intervals.includes(3) || ch.intervals.includes(4) ? T.nearest(root + 3, [mod12(ch.root + (ch.intervals.includes(3) ? 3 : 4))], root + 1, hi + 4) : fifth;
          const vr = sec === "B" ? 0.8 : sec === "intro" || sec === "tag" ? 0.72 : 0.76;
          const long = c.dur < 4 || sec === "intro" || (sec === "tag" && c.bar === 3) || pedal;
          const cell = long ? "hold" : sec === "B" ? r.weighted([["two", 3], ["walk", 1]]) : r.weighted([["hold", 2], ["two", 3], ["walk", 1.2], ["octave", 0.6]]);
          let end = root;
          if (cell === "hold") push("bass", c.s, c.dur - 0.3, root, vr);
          else if (cell === "two") { push("bass", c.s, 1.8, root, vr); push("bass", c.s + 2, 1.7, r.chance(0.3) && third <= hi ? third : fifth, vr - 0.12); }
          else if (cell === "octave") { push("bass", c.s, 2.7, root, vr); push("bass", c.s + 3, 0.9, root + 12 <= hi + 5 ? root + 12 : fifth, vr - 0.16); }
          else { // walk: root, fifth, then a diatonic approach from a step away into the next root
            push("bass", c.s, 1.8, root, vr); push("bass", c.s + 2, 0.9, fifth, vr - 0.12);
            const scale = ch.scale;
            const cands = nextRoot === root ? [[fifth, 1]]
              : [[T.step(nextRoot, nextRoot > root ? -1 : 1, scale), 3], [T.step(nextRoot, nextRoot > root ? 1 : -1, scale), 1.5], [nextRoot - 1, 1]]
                .filter(([m]) => m !== fifth && m !== root && m >= lo - 2 && m <= hi + 2);
            end = cands.length ? r.weighted(cands) : fifth;
            push("bass", c.s + 3, 0.9, end, vr - 0.16);
          }
          last = Math.max(lo, Math.min(hi, root));
        });
        state.bLast = last;
      }

      // ---------- brushes ----------
      {
        const hit = (b, voice, vel, extra) => push("drums", b, 0.1, voice, vel, extra);
        const style = plan.drums;
        for (let bar = 0; bar < 4; bar++) {
          const s = secStart + bar * BPB, secBar = half * 4 + bar;
          const finalBar = lastHalf && bar === 3;
          if (style === "intro") {
            if (lap === 0 && secBar < 1) continue;
            hit(s + 1, "brushSweep", 0.26, { len: 0.3 }); hit(s + 3, "brushSweep", 0.28, { len: 0.3 });
            if (lap > 0) hit(s, "softKick", 0.22);
            continue;
          }
          if (style === "tag") {
            if (finalBar) { hit(s, "brushSweep", 0.3, { len: 0.9 }); hit(s + 2, "brushSweep", 0.2, { len: 0.7 }); continue; }
            hit(s, "softKick", 0.26); hit(s + 1, "brushSweep", 0.3, { len: 0.32 }); hit(s + 3, "brushSweep", 0.3, { len: 0.32 });
            if (r.chance(0.5)) hit(s + 2.5, "brushTap", 0.16);
            continue;
          }
          const lift = style === "lift";
          // the sweep on 2 and 4 (a cross-stick on 4 under the lift), the pedal hat with it
          hit(s + 1, "brushSweep", lift ? 0.34 : 0.32, { len: 0.34 });
          if (lift) hit(s + 3, "rim", 0.3); else hit(s + 3, "brushSweep", 0.32, { len: 0.34 });
          hit(s + 1, "hatPedal", 0.16); hit(s + 3, "hatPedal", 0.16);
          // the left hand taps 8ths, about half of them
          [0, 0.5, 1.5, 2, 2.5, 3.5].forEach((o) => { if (r.chance(lift ? 0.55 : 0.45)) hit(s + o, "brushTap", 0.13 + (o % 1 === 0 ? 0.05 : 0) + r.range(0, 0.04)); });
          // the kick barely: 1, sometimes the and-of-2; under the lift 1 and 3
          hit(s, "softKick", lift ? 0.3 : 0.27);
          if (lift) hit(s + 2, "softKick", 0.22); else if (r.chance(0.35)) hit(s + 2.5, "softKick", 0.18);
          if (lift) for (let e = 0; e < 8; e++) hit(s + e * 0.5, "shaker", e % 2 ? 0.13 : 0.19);
          // into the next section: a pair of 16th taps
          if (finalBar && r.chance(0.55)) { hit(s + 3.5, "brushTap", 0.22); hit(s + 3.75, "brushTap", 0.26); }
        }
      }

      // ---------- feel ----------
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { brushSweep: "laidback", rim: "laidback", brushTap: "pushed", hatPedal: "pushed", shaker: "pushed", softKick: "straight" } },
          bass: { template: "straight", late: 5, vels: false },
          guitar: { template: { unit: 0.5, offsets: [0, 0.015], ms: [0, 3], vels: [1, 0.9] }, late: 4 },
          keys: { template: "straight", late: 14, vels: false },
        },
      });
      ev = G.rubato(ev, { track: "hum", bpm: BPM, bpb: BPB, amount: 0.7, gap: 0.4, linger: "high", legato: true, rng: r.fork(3) });
      ev = G.rubato(ev, { track: "gtrLead", bpm: BPM, bpb: BPB, amount: 0.35, gap: 0.4, linger: "high", legato: true, rng: r.fork(4) });

      const harmony = prog.filter((c) => c.bar >= half * 4 && c.bar < half * 4 + 4).map((c) => ({ ...c, bar: c.bar - half * 4 }));
      const who = sec === "intro" ? (plan.frag ? "the guitar remembers the motif" : "") : WHO[plan.who];
      const extras = [who, plan.keys ? "e-piano" : "", plan.pad ? "pad" : ""].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${NAMES[sec]}${extras ? " · " + extras : ""}`, state, tempo: tempoAt(pos) };
    },
  });
})();
