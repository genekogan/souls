// Firn Light: the snow stage. Old granular snow at the head of a glacier, a long view, cold clear air and
// everything glittering. D major in 6/8 at 92 (quarter = 92, so a bar is six eighths at 0.5 beat), written for a
// SNES-style sound chip (Sim.spc): seven chip voices plus one lead that lives outside the chip's voice allocator
// but is mixed through the chip's lo-fi stage and its echo, so the whole piece leaves through one DAC. The echo
// sits at 160 ms, a sixteenth at this tempo, so every bell and pluck leaves a sparkle on the next sixteenth.
//
// ---- THE HOOK (A, 16 bars, written by hand; the generator never changes a pitch or a rhythm) ----
//   Sim.phrasing notation, one string per bar, bars of 3 beats (eighths are 0.5):
//   ^ scoop in from below   ~ slur   v vibrato   > accent   f fall off   _ tenuto   . staccato
//
//   | Dadd9     D5/1 A5/0.5 F#6/1.5^v       a fifth up, then a sixth up: the leap IS the hook, landing on the third
//   | Gmaj9#11  D6/1 C#6/0.5 B5/1 A5/0.5    it falls through the Lydian C# (on a passing eighth) to the third of G
//   | Bm9       C#6/1 A5/0.5 F#5/1.5        the hook's shape upside down: a fall of a third, then a third
//   | A7sus4 A7 G5/1.5_ E5/1 r/0.5          a half close: the seventh held, settling to the fifth; a breath
//   | D/F#      D5/1 A5/0.5 F#6/1.5^v       the hook again
//   | Gmaj9     G6/1.5 D6/0.5 B5/0.5 A5/0.5 ...and this time it rises one more step to G6, the top of the first half
//   | Em9       D6/1 B5/0.5 G5/1.5          a tumble down the Em
//   | A7sus4    E5/0.5 F#5/0.5 A5/0.5 D6/1.5v  three eighths up to the suspended fourth, hanging over the dominant
//   | Bm9       F#5/1 B5/0.5 D6/1.5         the melancholy half: vi, then iii, the hook's leaps in minor
//   | F#m7      C#6/1 A5/0.5 E6/1.5v        landing on the seventh of F#m: the saddest note of the tune
//   | Gmaj9     D6/0.5 E6/0.5 F#6/0.5 G6/1.5  a scale run up to G6...
//   | E/D       G#6/1> E6/0.5 B5/1.5        ...and G6 lifts to G#6: THE LYDIAN LIFT, a major II over the tonic pedal
//   | Dadd9     D5/1 A5/0.5 F#6/1.5^v       the hook, home
//   | Bm7       D6/1 C#6/0.5 F#5/1.5
//   | Em7 A7sus4  G5/0.5 A5/0.5 B5/0.5 E6/1.5   the run up again, into the ninth over the dominant
//   | Dmaj9     A5/1 F#6/0.5 E6/1.5f2       a last sixth up, settling onto the ninth, falling away into the breath
//   Four phrases of four bars, each slurred, each starting a hair late after a breath and ending on a lengthened note.
//
// ---- THE WIND (B, 16 bars, B minor): denser, faster, detached. Repeated staccato eighths like gusts, each pair of
//   bars a call that drives up and a fall that settles; F#7 (the dominant of B minor, the one A# in the piece) at bar 8;
//   bars 14-15 quote the hook's F#m7 bar and its scale run, so the return is prepared by the tune itself; bar 16 hangs
//   on the suspended fourth over A7sus4 like the hook's bar 8 did, and the calm comes back.
//   | Bm9  F#5. F#5. F#5. B5/1 A5/.5 | Bm9  F#5 E5 D5 C#5/1.5 | Gmaj9  B5. B5. B5. D6/1 A5/.5 | Gmaj9  B5 A5 G5 F#5/1.5 |
//   | Em9  G5. G5. G5. B5/1 D6/.5 | Em9  E6 D6 B5 F#5/1.5 | F#7sus4  E5 F#5 B5 C#6/1.5 | F#7  A#5/1 C#6/.5 F#5/1.5 |
//   | Bm9  F#5. F#5. F#5. B5/1 D6/.5 | Bm9  C#6 B5 A5 F#5/1.5 | Gmaj9  D6. D6. D6. G6/1 F#6/.5 | Gmaj9  D6 E6 B5 A5/1.5 |
//   | Em9  G5 A5 B5 D6/1 E6/.5 | F#m7  C#6/1 A5/.5 E6/1.5 | Gmaj9  D6 E6 F#6 G6/1.5 | A7sus4  G6 F#6 E6 D6/1.5 |
//
// ---- THE COUNTER-LINE (A2 only, chip flute, hand-written): a slow inner voice in dotted quarters below the hook,
//   mostly thirds and sixths against it, with the 4-3 suspension spelled out in bar 4 (D over A7sus4, C# over A7).
//   Sim.dialogue.separate keeps it out of the lead's register.
//
// ---- FORM: one lap = 17 cycles of 4 bars (68 bars, about 2:13), after a one-time 4-bar intro ----
//   A1  the hook on the lead, glass pad in dyads with composed suspensions, bells glittering, the pluck arrives at
//       bar 5, drums almost nothing
//   A2  the counter-line joins on the chip flute; the pad falls silent to give it the register (pluck and bass carry
//       the chord), kick and brushed snare, pluck in eighths
//   B   the wind: B minor, pluck in sixteenths, hats in sixteenths, snare and ghosts, bass in eighths, the bells
//       tremolo like a whistle in the last two bars of each half, an accelerando into it and a ritardando out of it
//   A3  the calm returns: the hook is shared between the lead and the chip flute (Sim.dialogue handoff, the incoming
//       player doubling the tail of the outgoing note), three glass voices with suspensions, kick and light hats
//   TAG four bars over a D pedal: the lead states the hook's first bar, the bells answer with it backwards two octaves
//       up, the chip flute answers with it inverted, then one bell on the ninth and the lap begins again.
//   Across laps the generator chooses only arrangement: ornament density, kick figures, hat density, glitter, fills,
//   bass shapes, where the hook changes hands. The tunes above are never regenerated.
//
// ---- MODULES: Sim.spc (chip, echo, voice budget with stealing), Sim.phrasing (the lead's slurs, scoops, breath,
//   fall, the wrapper that realizes them), Sim.dialogue (separate / handoff / answer), Sim.groove (a 6/8 skating lilt
//   on pluck, hat and bass; rubato for the lead in A1 and A2; the tempo script; ghosts and the crescendo through fills).
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, G = Sim.groove, D = Sim.dialogue, S = Sim.spc;
  const BPB = 3, BPM = 92, CB = 4, CYC = CB * BPB, VOICES = 8; // 7 chip voices + the lead
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);
  const clamp01 = (v) => Math.max(0.05, Math.min(1, v));

  // ---------- harmony ----------
  const PROG = {
    INTRO: "| Dadd9 | Dadd9 | Gmaj9#11 | A7sus4 |",
    A: "| Dadd9 | Gmaj9#11 | Bm9 | A7sus4 A7 | D/F# | Gmaj9 | Em9 | A7sus4 | Bm9 | F#m7 | Gmaj9 | E/D | Dadd9 | Bm7 | Em7 A7sus4 | Dmaj9 |",
    B: "| Bm9 | Bm9 | Gmaj9 | Gmaj9 | Em9 | Em9 | F#7sus4 | F#7 | Bm9 | Bm9 | Gmaj9 | Gmaj9 | Em9 | F#m7 | Gmaj9 | A7sus4 |",
    TAG: "| Dadd9 | Dadd9 | G/D | A7sus4 |",
  };
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const BARS = { INTRO: 4, A: 16, B: 16, TAG: 4 };
  const progKey = (sec) => (sec[0] === "A" ? "A" : sec);
  const chordAtIn = Object.fromEntries(Object.keys(TL).map((k) => [k, T.chordAtFactory(TL[k], BPB)]));
  const symAt = (key, b) => chordAtIn[key](Math.max(0, Math.min(b, BARS[key] * BPB - 0.001))).chord;
  const scaleAtFor = (key) => (b) => T.chord(symAt(key, b)).scale;

  // ---------- the tunes ----------
  const HOOK = [
    "D5/1 A5/0.5 F#6/1.5^1v",
    "D6/1 C#6/0.5 B5/1 A5/0.5",
    "C#6/1 A5/0.5 F#5/1.5",
    "G5/1.5_ E5/1 r/0.5",
    "D5/1 A5/0.5 F#6/1.5^1v",
    "G6/1.5 D6/0.5 B5/0.5 A5/0.5",
    "D6/1 B5/0.5 G5/1.5",
    "E5/0.5 F#5/0.5 A5/0.5 D6/1.5v",
    "F#5/1 B5/0.5 D6/1.5",
    "C#6/1 A5/0.5 E6/1.5v",
    "D6/0.5 E6/0.5 F#6/0.5 G6/1.5",
    "G#6/1> E6/0.5 B5/1.5",
    "D5/1 A5/0.5 F#6/1.5^1v",
    "D6/1 C#6/0.5 F#5/1.5",
    "G5/0.5 A5/0.5 B5/0.5 E6/1.5",
    "A5/1 F#6/0.5 E6/1.5f2",
  ];
  const WIND = [
    "F#5/0.5. F#5/0.5. F#5/0.5. B5/1 A5/0.5",
    "F#5/0.5 E5/0.5 D5/0.5 C#5/1.5",
    "B5/0.5. B5/0.5. B5/0.5. D6/1 A5/0.5",
    "B5/0.5 A5/0.5 G5/0.5 F#5/1.5",
    "G5/0.5. G5/0.5. G5/0.5. B5/1 D6/0.5",
    "E6/0.5 D6/0.5 B5/0.5 F#5/1.5",
    "E5/0.5 F#5/0.5 B5/0.5 C#6/1.5",
    "A#5/1 C#6/0.5 F#5/1.5",
    "F#5/0.5. F#5/0.5. F#5/0.5. B5/1 D6/0.5",
    "C#6/0.5 B5/0.5 A5/0.5 F#5/1.5",
    "D6/0.5. D6/0.5. D6/0.5. G6/1 F#6/0.5",
    "D6/0.5 E6/0.5 B5/0.5 A5/1.5",
    "G5/0.5 A5/0.5 B5/0.5 D6/1 E6/0.5",
    "C#6/1 A5/0.5 E6/1.5v",
    "D6/0.5 E6/0.5 F#6/0.5 G6/1.5",
    "G6/0.5 F#6/0.5 E6/0.5 D6/1.5v",
  ];
  const COUNTER = [
    "A4/3", "G4/1.5 A4/1.5", "F#4/3", "D4/1.5 C#4/1.5",
    "F#4/3", "A4/1.5 G4/1.5", "G4/1.5 E4/1.5", "A4/1.5 G4/1.5",
    "B4/1.5 A4/1.5", "F#4/1.5 A4/1.5", "G4/1.5 B4/1.5", "B4/1.5 G#4/1.5",
    "A4/3", "B4/1.5 A4/1.5", "G4/3", "F#4/3",
  ];
  const HEAD = ["D5/1 A5/0.5 F#6/1.5^1v"]; // the hook's first bar, the tag's call
  const PHR_A = [0, 1, 2, 3].map((i) => ({ from: i * 12, to: (i + 1) * 12, dyn: i === 3 ? [1, 0.92] : "arch", legato: true }));
  const PHR_B = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ from: i * 6, to: (i + 1) * 6, dyn: i % 2 ? ">" : "<", legato: i >= 6, lengthen: 1.04 }));

  // ---------- form ----------
  const LAP = [];
  for (const [sec, n] of [["A1", 4], ["A2", 4], ["B", 4], ["A3", 4], ["TAG", 1]]) for (let k = 0; k < n; k++) LAP.push({ sec, k });
  const B_FIRST = LAP.findIndex((x) => x.sec === "B"), B_LAST = B_FIRST + 3, TAG_AT = LAP.length - 1;
  // the tempo: the wind picks up (an accelerando over the first two cycles of B, held), dies down through B's last
  // cycle, the return is a tempo; the tag slows into the lap's downbeat, which snaps back to tempo
  const tempoAt = G.tempoScript(BPM, [
    G.aTempo(0, BPM),
    G.accelerando(B_FIRST, 97, 2 * CYC),
    G.ritardando(B_LAST, 86, CYC),
    G.ritardando(TAG_AT, 84, CYC),
  ]);
  const PRIORITY = { lead: 7, flute2: 6, kick: 5, snare: 5, pad: 4, bass: 3, tom: 3, bells: 2, pluck: 2, hat: 1 };
  // the skating lilt in 6/8: the second eighth of each group leans late and light, the third pulls a hair forward
  const LILT = { unit: 0.5, offsets: [0, 0.05, -0.012, 0, 0.05, -0.012], vels: [1, 0.62, 0.8, 0.92, 0.6, 0.78] };
  // the wind's sixteenths: groups of six, the offbeat sixteenths early and quiet, the third of each group leaning back
  const GUST = { unit: 0.25, offsets: [0, -0.01, 0.02, 0.005, -0.01, 0.015], vels: [1, 0.5, 0.74, 0.62, 0.5, 0.7] };
  const NAMES = {
    INTRO: "Intro · the chime, the glass, the view",
    A1: "A · the hook over glass, the pluck arrives", A2: "A · the chip flute's counter-line joins",
    B: "B · the wind picks up (B minor, sixteenths)", A3: "A · the calm returns, the hook changes hands", TAG: "Tag · the head answered backwards and upside down",
  };

  // ---------- the lead: an ice flute, a soft looped wave through a gentle filter, played by Sim.phrasing ----------
  function iceFlute(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.3, 0.09, 0.04, 0.015] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.9 },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.85, release: 0.32 },
      filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.3, baseFrequency: 1300, octaves: 1.7 },
    }));
  }

  Sim.register({
    id: "firn-light",
    title: "Firn Light",
    genre: "16-bit snow stage",
    about: "The snow stage: D major in a lilting 6/8 on a SNES-style sound chip, bell and glass colours through a sixteenth-note chip echo. A hand-written hook built on wide leaps (a fifth, then a sixth) with a melancholy minor half and a Lydian lift (G6 rising to G#6 over a major II on the tonic pedal), slurred and breathed by the phrasing engine with rubato over a band that keeps time. A counter-line on the chip flute, a B-minor middle where the wind picks up (sixteenths, an accelerando, bells whistling) and a return where the tune is handed between two players. Composed suspensions in the pad, a skating groove template, a tag that answers the hook backwards and inverted.",
    bpm: BPM, beatsPerBar: BPB, strongBeats: [0, 1.5], swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["explore", "campfire"],
    energy: 0.42,

    instruments(ctx) {
      const chip = S.chip(ctx, {
        voices: VOICES - 1, volume: -4, rate: 32000, bits: 8, crush: 0.4, tone: 7600,
        echo: { time: 0.16, feedback: 0.4, tone: 3200, level: -8, lowcut: 180 },
      });
      // the lead lives outside the chip's allocator but inside its DAC and echo
      const lead = P.wrap(ctx, iceFlute(ctx), {
        volume: -3, glide: 0.06, scoopTime: 0.09, fallTime: 0.3, release: 0.32, staccatoRelease: 0.06,
        vibrato: { rate: 5.1, depth: 0.07, delay: 0.36, rise: 0.4, deepen: 1.3 },
        breath: P.breath(ctx, chip.bus, { level: -30, freq: 3400, q: 1.1, length: 0.16 }),
      });
      const leadPan = ctx.keep(new Tone.Panner(0.06)).connect(chip.bus); lead.out.connect(leadPan);
      const leadEcho = ctx.keep(new Tone.Gain(0.45)).connect(chip.echo); leadPan.connect(leadEcho);
      // the chip voices
      const flute2 = chip.voice("flute", { priority: PRIORITY.flute2, echo: 0.5, pan: 0.28, volume: -4, cutoff: 4200, vibrato: { rate: 4.8, depth: 0.09, delay: 0.4 } });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.3, pan: -0.2, volume: -6, wave: "glass", cutoff: 3600, attack: 0.15, release: 0.35 });
      const bells = chip.voice("bell", { poly: 2, priority: PRIORITY.bells, echo: 0.65, pan: 0.38, volume: -6, cutoff: 8000, decay: 1.4 });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.5, pan: -0.32, volume: -6, wave: "glass", cutoff: 6800, decay: 0.3 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.1, pan: 0, volume: -3, cutoff: 190, grit: 5, gritWet: 0.2 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: -2, note: 40, decay: 0.22, octaves: 3.2 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.3, pan: 0.05, volume: -5, tone: 1900, sweep: 1200, decay: 0.12, body: 170 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.22, volume: -8, cutoff: 8000, sweep: 2500, closed: 0.035, open: 0.22 });
      const tom = chip.voice("tom", { priority: PRIORITY.tom, echo: 0.3, pan: 0.18, volume: -3 });
      const chipHum = { timing: 0.002, vel: 0.04 };
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        flute2: { layer: "melody", play: flute2.play, humanize: chipHum },
        pad: { layer: "harmony", play: pad.play, humanize: chipHum },
        bells: { layer: "texture", play: bells.play, humanize: chipHum },
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
      const { sec, k } = intro ? { sec: "INTRO", k: 0 } : LAP[idx];
      const key = progKey(sec), prog = TL[key], nbars = BARS[key];
      const secStart = k * CYC; // first beat of this cycle within the section
      const scaleAt = scaleAtFor(key);
      const sym = (b) => symAt(key, b);
      const ch = (b) => T.chord(sym(b));
      const nextSec = intro ? "A1" : LAP[(idx + 1) % LAP.length].sec;
      const nextFirst = T.chord(TL[progKey(nextSec)][0].chord);
      const inA = sec[0] === "A", lastCycle = secStart + CYC >= nbars * BPB;
      let ev = [];
      /** push by beat within the SECTION; anything outside this cycle's window is dropped */
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -1e-6 || abs >= CYC - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: clamp01(vel), ...extra });
      };
      const emit = (notes, o = {}) => {
        for (const n of notes) {
          const { bar, beat, dur, note, vel, at, idx: _i, voice, entrance, shift, answer, phrase, ...extra } = n;
          push(o.track || n.track, bar * BPB + beat, dur, note, vel * (o.gain ?? 1), extra);
        }
      };
      if (state.padV === undefined) Object.assign(state, { padV: null, plV: null, bassLast: 42, stolen: 0, dropped: 0, lastFill: null });

      // ---- the lap's arrangement choices (drawn once per lap; the tunes are fixed) ----
      if (!state.plan || state.plan.lap !== lap) {
        const rr = r.fork(7 + lap);
        state.plan = {
          lap,
          orn: lap === 0 ? 0.1 : rr.range(0.2, 0.4),
          glitter: lap === 0 ? 0.4 : rr.range(0.45, 0.7),
          a1Kick: lap === 0 ? 8 : rr.pick([0, 4, 8]),
          a2Open: rr.chance(0.6),
          bHats: rr.pick(["16", "16", "8"]),
          bKick: rr.pick(["two", "three"]),
          a3Bass: rr.pick(["octave", "fifth"]),
          handoff: rr.range(0.4, 0.7),
          stay: rr.range(0.25, 0.5),
          pluckShape: rr.pick([0, 1, 2]),
        };
      }
      const PL = state.plan;

      // ================= the lines: built once per section (its cycles share them) =================
      const lineKey = `${sec}:${lap}`;
      if (!state.lines || state.lines.key !== lineKey) {
        const rr = r.fork(31 + lap);
        const L = { key: lineKey };
        if (inA) {
          const line = P.line(HOOK, { beatsPerBar: BPB, track: "lead" });
          const orn = sec === "A1" ? PL.orn * 0.5 : sec === "A2" ? PL.orn : PL.orn * 0.6;
          line.forEach((e, i) => {
            const prev = line[i - 1];
            const leap = prev ? e.note - prev.note : 0;
            const a = P.parseArt(e.art || "");
            e.vel = 0.72 + (e.note - 82) / 110 + (e.dur >= 1.5 ? 0.04 : 0) + (a.accent ? 0.03 : 0) + rr.gauss(0.01);
            if (!a.scoop && !a.accent && !a.fall && !a.tenuto) {
              if (leap >= 7 && e.dur >= 1 && rr.chance(orn)) e.grace = "step"; //          a grace into a wide leap
              else if (e.dur >= 1.5 && e.beat === 0 && rr.chance(orn * 0.5)) e.mordent = true; // a mordent on a held downbeat
            }
          });
          L.lead = P.articulate(line, PHR_A, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.1, breathLate: 0.035, breathGap: 0.15, breathFirst: true });
          if (sec === "A3") {
            // the calm returns and the tune is shared: the lead and the chip flute pass it between them after long
            // notes and at phrase ends; the incoming player doubles the tail of the outgoing note, softly
            L.lead = D.distribute(L.lead, {
              voices: [{ track: "lead", range: [72, 94] }, { track: "flute2", range: [60, 94], gain: 0.92 }],
              mode: "handoff", join: "double", overlap: 0.08, handoffDur: 1.5, handoffChance: PL.handoff, minNotes: 3, stay: PL.stay, rng: rr, bpb: BPB,
            });
            // both players are monophonic: a doubled tail gives way the moment that player's own next note begins
            for (const tr of ["lead", "flute2"]) {
              const own = L.lead.filter((n) => n.track === tr).sort((a, b) => a.at - b.at);
              for (let i = 0; i + 1 < own.length; i++) { const room = own[i + 1].at - own[i].at - 0.02; if (own[i].dur > room) own[i].dur = Math.max(0.1, room); }
            }
          }
          if (sec === "A2") {
            const cnt = P.line(COUNTER, { beatsPerBar: BPB, track: "flute2", vel: 0.5 });
            L.counter = D.separate(L.lead, cnt, { range: [60, 84], prefer: "below", min: 3, bpb: BPB }).map((n) => ({ ...n, track: "flute2" }));
          }
        } else if (sec === "B") {
          const line = P.line(WIND, { beatsPerBar: BPB, track: "lead" });
          line.forEach((e, i) => {
            const a = P.parseArt(e.art || "");
            e.vel = 0.74 + (e.note - 82) / 120 + (e.dur >= 1.5 ? 0.04 : 0) + (a.staccato ? -0.02 + 0.02 * (i % 3) : 0) + rr.gauss(0.01);
          });
          L.lead = P.articulate(line, PHR_B, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.04, breathLate: 0.02, breathGap: 0.1, breathFirst: true, staccato: 0.55 });
        } else if (sec === "TAG") {
          const head = P.articulate(P.line(HEAD, { beatsPerBar: BPB, track: "lead", vel: 0.74 }), [{ from: 0, to: 3, dyn: "arch", legato: true, lengthen: 1 }], { beatsPerBar: BPB, breathFirst: true });
          L.lead = head;
          // the answers: the bells play the head backwards, two octaves up (bar 2); the chip flute plays it upside down (bar 3)
          L.bells = D.answer(HEAD_NOTES, { track: "bells", transform: { retrograde: true }, at: 3, scaleAt, range: [86, 103], vel: 0.5, bpb: BPB });
          L.flute2 = D.answer(HEAD_NOTES, { track: "flute2", transform: { invert: true }, at: 6, scaleAt, range: [62, 88], vel: 0.6, bpb: BPB });
        }
        state.lines = L;
      }
      const L = state.lines;
      if (L.lead) emit(L.lead);
      if (L.counter) emit(L.counter);
      if (L.bells) emit(L.bells);
      if (L.flute2) emit(L.flute2);
      const leadPcsIn = (a, b) => { // pitch classes the tune sounds within [a, b) of the section, for the pad's suspensions
        const out = new Set();
        for (const n of L.lead || []) { const at = n.bar * BPB + n.beat; if (at < b && at + n.dur > a && typeof n.note === "number") out.add(mod12(n.note)); }
        return out;
      };

      // ================= pad: the glass, with composed suspensions =================
      // The pad voices the plain chord (no ninths, no #11): those colours belong to the lead and the bells, and a
      // glass pad of two or three chip voices wants open intervals. In A2 the pad is silent: the chip flute's
      // counter-line is the inner voice there, with the pluck and bass carrying the chord.
      const plain = (s) => s.replace(/maj9#11/, "maj7").replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/add9/, "");
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= secStart && c.s < secStart + CYC);
      const padN = sec === "A3" || sec === "TAG" ? 3 : 2; // three glass voices only where the chip can spare them
      const padVel = sec === "B" ? 0.56 : sec === "INTRO" || sec === "TAG" ? 0.48 : 0.52;
      const padByBar = {};
      for (const c of spans) {
        const v = T.voice(plain(c.chord), { lo: 55, hi: 76, n: padN, prev: state.padV, omitBass: true, top: [66, 76], spread: "close" });
        const prev = state.padV;
        state.padV = v;
        if (!v || !v.length) continue;
        padByBar[c.bar] = (padByBar[c.bar] || []).concat(v);
        if (sec === "A2") continue;
        const dur = c.dur - 0.15;
        // a suspension: the old top voice is a step above the new top and in the new chord's scale, the tune sounds
        // nothing a semitone from it while it hangs; it holds for half the bar, then resolves down
        let suspended = false;
        if (prev && prev.length && c.dur >= 3 && sec !== "B") {
          const pt = Math.max(...prev), vt = Math.max(...v);
          const cc = T.chord(c.chord);
          const near = leadPcsIn(c.s, c.s + 1.5);
          const rub = [...near].some((pc) => (pc - mod12(pt) + 12) % 12 === 1 || (mod12(pt) - pc + 12) % 12 === 1);
          if ((pt - vt === 1 || pt - vt === 2) && !v.includes(pt) && cc.scale.includes(mod12(pt)) && !rub) {
            const held = v.slice().sort((a, b) => a - b).slice(0, -1).concat([pt]);
            push("pad", c.s, 1.45, held, padVel);
            push("pad", c.s + 1.5, dur - 1.5, v, padVel - 0.04);
            suspended = true;
          }
        }
        if (!suspended) push("pad", c.s, dur, v, padVel);
      }

      // ================= pluck: the 6/8 broken chord, the skating figure =================
      const PATTERNS = [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 1, 2], [0, 1, 3, 2, 1, 2]];
      const pluckBar = (bar, o = {}) => {
        const B0 = bar * BPB, c = sym(B0);
        const v = T.voice(c, { lo: 64, hi: 83, n: 4, rootless: false, prev: state.plV, omitBass: true, spread: "close", top: [74, 83] });
        state.plV = v;
        if (!v || !v.length) return;
        const notes = v.slice().sort((a, b) => a - b);
        const pat = PATTERNS[(PL.pluckShape + bar) % PATTERNS.length];
        const step = o.sixteenths ? 0.25 : 0.5, n = BPB / step;
        for (let s = 0; s < n; s++) {
          if (o.until != null && s * step >= o.until) break;
          const m = notes[pat[s % pat.length] % notes.length];
          push("pluck", B0 + s * step, step * 0.9, m, (o.vel ?? 0.6) * (s % 2 ? 0.92 : 1));
        }
      };

      // ================= bells: glitter =================
      /** one (sometimes two) of the chord's colour tones high up, on a weak eighth; never a semitone from a pad note */
      const glitter = (bar, p, o = {}) => {
        const B0 = bar * BPB, c = ch(B0);
        if (!r.chance(p)) return;
        const padPcs = new Set((padByBar[bar] || []).map(mod12));
        const clear = (pc) => ![...padPcs].some((q) => (q - pc + 12) % 12 === 1 || (pc - q + 12) % 12 === 1);
        let pcs = (c.colors && c.colors.length ? c.colors : []).concat([mod12(c.root + 7), mod12(c.root + 4), mod12(c.root + 3)]).filter((pc) => c.pcs.includes(pc) && clear(pc));
        if (!pcs.length) return;
        const slots = r.shuffle(o.slots || [1, 2, 2.5, 0.5]).slice(0, o.two !== false && r.chance(0.3) ? 2 : 1);
        slots.forEach((b, i) => {
          // above the tune, and never a semitone from what the tune sings while the bell rings
          const sung = leadPcsIn(B0 + b, B0 + b + 1);
          const ok = pcs.filter((pc) => ![...sung].some((q) => (q - pc + 12) % 12 === 1 || (pc - q + 12) % 12 === 1));
          if (!ok.length) return;
          const m = T.nearest(o.lo ?? 92, [ok[(i + bar) % ok.length]], 87, 99);
          if (m != null && Number.isFinite(m)) push("bells", B0 + b, 1, m, 0.34 + r.range(0, 0.1));
        });
      };
      /** the wind's whistle: two neighbouring chord tones (root, third, fifth) in sixteenths, crescendo across the bar */
      const whistle = (bar, v0, v1) => {
        const B0 = bar * BPB, c = ch(B0);
        const sung = leadPcsIn(B0, B0 + BPB);
        const pcs = [0, 3, 4, 7].map((k) => mod12(c.root + k)).filter((pc) => c.pcs.includes(pc) && ![...sung].some((q) => (q - pc + 12) % 12 === 1 || (pc - q + 12) % 12 === 1));
        if (pcs.length < 2) return;
        const hi = T.nearest(95, pcs, 90, 99), lo = hi == null ? null : T.nearest(hi - 3, pcs.filter((pc) => pc !== mod12(hi)), hi - 5, hi - 1);
        if (hi == null || lo == null) return;
        for (let s = 0; s < 12; s++) push("bells", B0 + s * 0.25, 0.3, s % 2 ? lo : hi, v0 + ((v1 - v0) * s) / 11);
      };

      // ================= bass =================
      const near = (pc, from, lo = 37, hi = 48) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.25 * Math.abs(m - 42); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const rootAt = (b) => near(ch(b).bass, state.bassLast);
      const rootNext = (bar, from) => near(bar + 1 < nbars ? ch((bar + 1) * BPB).bass : nextFirst.bass, from);
      const bassBar = (bar, style) => {
        const B0 = bar * BPB, R = rootAt(B0);
        const chg = prog.find((e) => e.bar === bar && e.beat > 0);
        const R2 = chg ? near(ch(B0 + chg.beat).bass, R) : null; // a mid-bar change (A7sus4 A7, Em7 A7sus4)
        const fifth = (m) => (m + 7 <= 50 ? m + 7 : m - 5);
        const N = rootNext(bar, R2 ?? R);
        // the step into the next root: diatonic (the pad is sounding), chromatic now and then for colour
        const inKey = (m) => ch(B0 + 2.5).scale.includes(mod12(m));
        const stepTo = (dir) => { const a = N - dir, b = N - 2 * dir; return inKey(a) && (r.chance(0.3) || !inKey(b)) ? a : inKey(b) ? b : a; };
        const approach = N === (R2 ?? R) ? fifth(N) : stepTo(N > (R2 ?? R) ? 1 : -1);
        const c0 = ch(B0);
        const mid = R2 ?? (c0.bass !== c0.root ? near(c0.root, R + 6, R + 1, R + 11) // over a slash bass, the chord's root above it
          : style === "octave" ? (R + 12 <= 50 ? R + 12 : fifth(R)) : fifth(R));
        if (style === "hold") push("bass", B0, 2.85, R, 0.78);
        else if (style === "holdMid") { push("bass", B0, 1.45, R, 0.8); push("bass", B0 + 1.5, 1.35, mid, 0.62); }
        else if (style === "fifth" || style === "octave") {
          push("bass", B0, 1.4, R, 0.82); push("bass", B0 + 1.5, 0.9, mid, 0.64);
          if (r.chance(0.65)) push("bass", B0 + 2.5, 0.45, approach, 0.6);
        } else if (style === "eighths") {
          const seq = [R, R, mid, R, R, mid];
          seq.forEach((m, i) => push("bass", B0 + i * 0.5, 0.45, i >= 3 && R2 ? (i === 5 ? mid : R2) : m, i === 0 ? 0.86 : i % 3 === 0 ? 0.76 : 0.6));
        } else if (style === "tag") { push("bass", B0, 2.85, R, 0.74); }
        state.bassLast = R2 ?? R;
      };

      // ================= drums =================
      // drum durations are the voices' real hold times in beats, so the compose-side budget matches the chip
      const HOLD = { hat: 0.09, hatOpen: 0.38, kick: 0.36, snare: 0.27, tom: 0.5 };
      const drum = (track, secBeat, vel, extra) => push(track, secBeat, track === "hat" && extra && extra.open ? HOLD.hatOpen : HOLD[track], track, vel, extra);
      // eighths; "light" leaves out the two group downbeats (the airy pattern: and-two-three, and-five-six)
      const hats8 = (bar, v, o = {}) => { const B0 = bar * BPB; for (let e = 0; e < 6; e++) { const b = e * 0.5; if (o.light && e % 3 === 0) continue; if (o.until != null && b >= o.until) break; if (o.open && e === 5) { drum("hat", B0 + b, v * 0.9, { open: true }); continue; } drum("hat", B0 + b, v * (e % 3 === 0 ? 1 : e % 3 === 1 ? 0.7 : 0.8)); } };
      const hats16 = (bar, v, o = {}) => { const B0 = bar * BPB; for (let s = 0; s < 12; s++) { const b = s * 0.25; if (o.until != null && b >= o.until) break; if (o.open && s === 11) { drum("hat", B0 + b, v * 0.9, { open: true }); continue; } drum("hat", B0 + b, v * (s % 6 === 0 ? 1 : s % 2 === 0 ? 0.72 : 0.5)); } };
      const tomFill = (bar, from, v0 = 0.5) => {
        const B0 = bar * BPB, P6 = [67, 64, 60, 57, 55, 52, 50, 47, 45, 43, 43, 40];
        const steps = Math.round((BPB - from) * 4);
        for (let i = 0; i < steps; i++) { const b = from + i * 0.25; if (i === 0) drum("snare", B0 + b, 0.7); else drum("tom", B0 + b, v0 + 0.03 * i, { pitch: P6[Math.min(11, Math.floor((i * 12) / steps))] }); }
        drum("kick", B0 + from, 0.85);
      };
      const snareRoll = (bar, from) => { const B0 = bar * BPB; for (let b = from; b < BPB - 1e-6; b += 0.25) drum("snare", B0 + b, 0.3 + 0.5 * ((b - from) / (BPB - from))); };

      // ================= the sections =================
      const bars = [];
      for (let bar = secStart / BPB; bar < Math.min(nbars, secStart / BPB + CB); bar++) bars.push(bar);
      if (intro) {
        // the chime: the bells say the hook's first bar before the lead does, at pitch, over the glass
        [[0, 1, 74], [1, 0.5, 81], [1.5, 1.5, 90]].forEach(([b, d, m]) => push("bells", b, d, m, 0.5));
        for (const bar of bars) {
          if (bar >= 1) pluckBar(bar, { vel: 0.5 });
          if (bar >= 2) hats8(bar, 0.3, { light: true });
          if (bar >= 2) bassBar(bar, "hold");
          if (bar >= 2) glitter(bar, 0.6, { lo: 92 });
        }
      } else if (inA) {
        const v = Number(sec[1]);
        for (const bar of bars) {
          const B0 = bar * BPB, last = bar === nbars - 1;
          if (v === 1) {
            if (bar >= 4) pluckBar(bar, { vel: 0.52 });
            hats8(bar, 0.3, { light: true, open: bar % 8 === 7 });
            if (bar >= PL.a1Kick) drum("kick", B0, 0.58);
            bassBar(bar, bar < 8 ? "hold" : "holdMid");
            glitter(bar, PL.glitter * 0.7);
            if (last) { drum("snare", B0 + 2.5, 0.4); drum("snare", B0 + 2.75, 0.5); }
          } else if (v === 2) {
            pluckBar(bar, { vel: 0.58, until: last ? 1.5 : undefined });
            hats8(bar, 0.36, { open: PL.a2Open && bar % 4 === 3, until: last ? 1.5 : undefined });
            drum("kick", B0, 0.74); if (bar % 2 === 1) drum("kick", B0 + 1.5, 0.52);
            if (!last) drum("snare", B0 + 1.5, 0.5);
            if (r.chance(0.3) && !last) drum("snare", B0 + 2.75, 0.3, { ghost: true });
            bassBar(bar, "fifth");
            glitter(bar, PL.glitter * 0.6, { lo: 91 });
            if (last) { snareRoll(bar, 1.5); drum("kick", B0 + 1.5, 0.7); }
          } else {
            // the calm: three glass voices, the light hat pattern (no group downbeats, where the kick and the
            // shared tune need the voices), the kick alone as the pulse, one bell a bar
            pluckBar(bar, { vel: 0.56, until: last ? 2.5 : undefined });
            hats8(bar, 0.34, { light: true, open: last, until: last ? 2.5 : undefined });
            drum("kick", B0, 0.7); if (bar % 2 === 1 && !last) drum("kick", B0 + 1.5, 0.48);
            if (r.chance(0.25) && !last) drum("snare", B0 + 2.75, 0.26, { ghost: true });
            bassBar(bar, last ? "hold" : PL.a3Bass);
            glitter(bar, PL.glitter * 0.8, { two: false, slots: [1, 2] });
          }
        }
      } else if (sec === "B") {
        for (const bar of bars) {
          const B0 = bar * BPB, half = bar === 7, last = bar === 15, fillBar = half || last;
          const from = last ? 0.75 : 1.5;
          pluckBar(bar, { vel: 0.58, sixteenths: true, until: fillBar ? from : undefined });
          if (PL.bHats === "16") hats16(bar, 0.3, { open: bar % 2 === 1, until: fillBar ? from : undefined });
          else hats8(bar, 0.36, { open: bar % 2 === 1, until: fillBar ? from : undefined });
          drum("kick", B0, 0.9);
          if (!fillBar || from > 1.5) drum("kick", B0 + 1.5, 0.74);
          if (PL.bKick === "three" && !fillBar && r.chance(0.5)) drum("kick", B0 + 2.5, 0.6);
          if (!fillBar || from > 1.5) drum("snare", B0 + 1.5, 0.84);
          if (!fillBar) { if (r.chance(0.45)) drum("snare", B0 + 1.25, 0.3, { ghost: true }); if (r.chance(0.45)) drum("snare", B0 + 2.75, 0.3, { ghost: true }); }
          bassBar(bar, "eighths");
          if (bar === 6 || bar === 7 || bar === 14 || bar === 15) whistle(bar, bar % 2 ? 0.34 : 0.26, bar % 2 ? 0.46 : 0.34);
          if (fillBar) tomFill(bar, from, last ? 0.52 : 0.46);
        }
      } else { // TAG: over the D pedal
        for (const bar of bars) {
          const B0 = bar * BPB;
          if (bar < 3) { pluckBar(bar, { vel: 0.46 }); hats8(bar, 0.24, { light: true }); }
          else drum("hat", B0 + 0.5, 0.22);
          bassBar(bar, bar === 3 ? "holdMid" : "tag");
          if (bar === 0) drum("kick", B0, 0.6);
          if (bar === 3) push("bells", B0 + 1.5, 1.5, 95, 0.44); // one bell on the ninth of A7sus4, and the lap begins
        }
      }

      // ================= the chip: eight voices by priority; the score shows what survived =================
      ev = G.ghosts(ev, { tracks: ["snare"], vel: 0.26, dur: 0.12 }); // ghosts are short, so they hold a voice briefly
      const bud = S.budget(ev, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      ev = bud.events; state.stolen += bud.stolen; state.dropped += bud.dropped;

      // ================= feel: everything above is on the grid; Sim.groove moves it =================
      if (sec === "B") {
        for (const bar of bars) if (bar === 7 || bar === 15) ev = G.crescendo(ev, { tracks: ["tom", "snare", "kick"], from: (bar - secStart / BPB) * BPB + (bar === 15 ? 0.75 : 1.5), to: (bar - secStart / BPB) * BPB + BPB, v0: 0.8, v1: 1.15, curve: 1.2, bpb: BPB });
        ev = G.apply(ev, { bpm: BPM, bpb: BPB, cycle, tracks: { pluck: { template: GUST, late: 2 }, hat: { template: GUST, late: -4 }, bass: { template: GUST, late: 3, vels: false }, snare: { template: "straight", late: 10 } } });
      } else {
        ev = G.apply(ev, { bpm: BPM, bpb: BPB, cycle, tracks: { pluck: { template: LILT, late: 4 }, hat: { template: LILT, late: -3 }, bass: { template: LILT, late: 5, vels: false }, bells: { template: "straight", late: 8 }, snare: { template: "straight", late: 14 } } });
        // the singer floats over the band: rubato while the hook is one player's (A1, A2); shared in A3, it keeps time
        if (sec === "A1" || sec === "A2") ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: sec === "A1" ? 0.75 : 0.6, linger: "high", lingerMs: 60, leapMs: 20, legato: true, rng: r });
      }

      const harmony = spans.map((c) => ({ bar: c.bar - secStart / BPB, beat: c.beat, dur: c.dur, chord: c.chord }));
      const label = intro ? NAMES.INTRO : `Lap ${lap + 1} · ${NAMES[sec]}${inA ? ` (bars ${secStart / BPB + 1}–${secStart / BPB + CB})` : ""}`;
      return { events: ev, harmony, section: label, state, tempo: intro ? null : tempoAt(idx) };
    },
  });

  // the head as plain notes for Sim.dialogue.answer (at, dur, note)
  const HEAD_NOTES = P.line(HEAD, { beatsPerBar: BPB, vel: 0.74 }).map((e) => ({ at: e.bar * BPB + e.beat, dur: e.dur, note: e.note, vel: e.vel }));
})();
