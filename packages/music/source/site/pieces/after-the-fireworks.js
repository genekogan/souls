// After the Fireworks: the ending theme, the one that keeps the player in their seat through the names.
// F major, 80 BPM (the solo at 74), written for a seven-voice sound chip (Sim.spc) plus one expressive
// solo voice that goes through the chip's lo-fi stage and echo but is played with Sim.phrasing (scoops,
// slurs, late vibrato, breaths) and Sim.groove rubato. One lap is the whole arc, about 2:28, then it
// begins again quietly so it loops:
//
//   SOLO    the hook alone, rubato, a thin pad from bar 5                    (74 bpm)
//   BAND    the band enters on the pickup: bass, soft kit, pad, harp, a horn counter-line   (80)
//   PASSED  the hook handed around the ensemble (Sim.dialogue: a phrase each, or mid-line handoffs)
//   B       the bridge: IV, the climb to A5, the borrowed iv (B♭m6) with the tune on D♭, the ♭VII pivot
//   LIFT    the hook in A♭ major, big: solo + detuned pulse in unison, horn an octave down, bells
//   CODA    back to F: a deceptive cadence (V → vi), IV → iv once more, ritardando, the real cadence
//           on a fermata, the harp sweep, the bells say goodnight, and the solo voice picks it up again
//
// THE HOOK (fixed by hand; the generator never changes a pitch or a rhythm, only who plays it, the
// ornaments, the dynamics and the time). Beats from the bar; ^ scoop, v vibrato, ~ slur (Sim.phrasing marks).
//   pickup      . . . A4 C5                   a rising third, the piece's motto
//   bar 1 Fmaj9      F5(2)^ E5 D5             up a fourth into the long note, then two steps down
//   bar 2 Am7        C5(2.5)v . B♭4 C5        rests on the third of iii (the bittersweet chord), pickup
//   bar 3 B♭maj9     D5(2) C5 B♭4             the same shape a third lower, on IV
//   bar 4 Gm9 C13    A4(2.5)v . A4 C5         the motto again, on ii–V
//   bar 5 A7sus4 A7  G5(2)^v F5 E5            the peak: a fifth up, scooped; F over A7 is an appoggiatura to E
//   bar 6 Dm9        D5(2.5)v . D5 E5         vi; a stepwise pickup this time
//   bar 7 Gm9 C13    F5(1.5) D5 C5 B♭4        falls through the ii–V
//   bar 8 F69 (C9sus4)  A4(2.5)v . [pickup]   home on the third
// THE BRIDGE (B): | B♭maj9 | Am7 Dm9 | Gm9 | C13sus4 C13 | B♭maj9 | B♭m6 | Fmaj9/C | E♭13sus4 E♭13 |
//   pickup C5 | D5 F5 G5(1.5) F5 | E5(1.5) C5 D5(2)v | B♭4 D5 F5(1.5) E5 | D5(1.5) B♭4 C5(2)v |
//   F5 G5 A5(2)^v | G5 F5 D♭5(3)v  ← the key moment, the tune on the borrowed ♭3 | C5(3)v A4 | D♭5(1.5) B♭4 . C5 E♭5 |
//   the last bar's ♭VII (E♭13) is V of A♭: the pickup C5 E♭5 is the motto, lifted a minor third.
// THE LIFT: the hook up a minor third over | A♭maj9 | Cm7 | D♭maj9 | B♭m9 E♭13 | C7sus4 C7 | Fm9 | B♭m9 E♭13 | A♭69 C9sus4 |,
//   its last bar cut short so the C9sus4 and a G4 B♭4 pickup bring it back down to F.
// THE CODA: | Gm9 C13 | Dm9 (deceptive) | B♭maj9 B♭m6 | Fmaj9/C C7sus4 | F69 (fermata) | F69 | F69 | F69 |
//   F5(1.5) D5 C5 B♭4 | A4(2.5)v . A4 C5 | D5(1.5) C5 D♭5(2)v | C5(2)v B♭4 G4 | A4(4)v ‖ bells: C5 | A4 F4 | C4 . A4 C5 (solo pickup)
// COUNTER-LINE (horn, half notes under the hook): A3 C4 | E4 C4 | D4 F4 | B♭3 E4 | D4 C♯4 | F4 E4 | D4 E4 | F4 —
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const BPB = 4, CB = 2, BPM = 80, SOLO_BPM = 74, VOICES = 8;
  const SEC_BARS = 8, SEC_BEATS = SEC_BARS * BPB;
  const SECS = ["SOLO", "BAND", "PASSED", "B", "LIFT", "CODA"];
  const LAP_BARS = SECS.length * SEC_BARS, LAP_CYCLES = LAP_BARS / CB; // 48 bars, 24 cycles
  const mod12 = T.mod12;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- the tunes (Sim.phrasing notation; the first bar is the pickup, bar -1) ----------
  const HOOK = [
    "r/3 A4/0.5 C5/0.5",
    "F5/2^ E5/1 D5/1",
    "C5/2.5v r/0.5 Bb4/0.5 C5/0.5",
    "D5/2 C5/1 Bb4/1",
    "A4/2.5v r/0.5 A4/0.5 C5/0.5",
    "G5/2^v F5/1 E5/1",
    "D5/2.5v r/0.5 D5/0.5 E5/0.5",
    "F5/1.5 D5/0.5 C5/1 Bb4/1",
    "A4/2.5v r/1.5",
  ];
  const HOOK_LIFT_LAST = "A4/2 r/2"; // the lift's bar 8 (written in F, transposed +3 → C5, the third of A♭), then the C9sus4 and the pickup home
  const BRIDGE = [
    "r/3.5 C5/0.5",
    "D5/1 F5/1 G5/1.5 F5/0.5",
    "E5/1.5 C5/0.5 D5/2v",
    "Bb4/1 D5/1 F5/1.5 E5/0.5",
    "D5/1.5 Bb4/0.5 C5/2v",
    "F5/1 G5/1 A5/2^v",
    "G5/0.5 F5/0.5 Db5/3v",
    "C5/3v A4/1",
    "Db5/1.5 Bb4/0.5 r/2",
  ];
  const CODA = [
    "r/3 G4/0.5 Bb4/0.5",
    "F5/1.5 D5/0.5 C5/1 Bb4/1",
    "A4/2.5v r/0.5 A4/0.5 C5/0.5",
    "D5/1.5 C5/0.5 Db5/2v",
    "C5/2v Bb4/1 G4/1",
    "A4/4v",
    "r/4", "r/4", "r/4",
  ];
  const COUNTER = ["A3/2 C4/2", "E4/2 C4/2", "D4/2 F4/2", "Bb3/2 E4/2", "D4/2 C#4/2", "F4/2 E4/2", "D4/2 E4/2", "F4/4"];
  const COUNTER_B = ["Bb3/2 D4/2", "C4/2 A3/2", "Bb3/2 D4/2", "F4/2 E4/2", "D4/2 F4/2", "Db4/2 F4/2", "A3/4", "Db4/2 G3/2"];
  const BELL_CLOSE = ["r/4", "r/2 C5/2", "A4/2 F4/2", "C4/2 r/2"]; // bars 44-47 of the coda
  // phrase marks in beats from the section start (the pickup belongs to the phrase it starts)
  const PHR_HOOK = [
    { from: -1, to: 7, dyn: "arch", legato: true },
    { from: 7, to: 15, dyn: "arch", legato: true },
    { from: 15, to: 23, dyn: "<", legato: true },
    { from: 23, to: 31, dyn: ">", legato: true },
  ];
  const PHR_BRIDGE = [
    { from: -0.5, to: 8, dyn: "arch", legato: true },
    { from: 8, to: 16, dyn: "arch", legato: true },
    { from: 16, to: 24, dyn: "<", legato: true, lengthen: 1 },
    { from: 24, to: 32, dyn: ">", legato: true },
  ];
  const PHRASES_HOOK = [[-1, 7], [7, 15], [15, 23], [23, 31.5]]; // for Sim.dialogue: the pickup starts its phrase
  const PHR_CODA = [
    { from: -1, to: 7, dyn: "arch", legato: true },
    { from: 7, to: 16, dyn: ">", legato: true },
    { from: 16, to: 32, dyn: [0.9, 0.7], legato: true, lengthen: 1 },
  ];

  // ---------- harmony ----------
  const CH = {
    HOOK: "| Fmaj9 | Am7 | Bbmaj9 | Gm9 C13 | A7sus4 A7 | Dm9 | Gm9 C13 | F69:2 C9sus4:2 |",
    HOOK_TO_B: "| Fmaj9 | Am7 | Bbmaj9 | Gm9 C13 | A7sus4 A7 | Dm9 | Gm9 C13 | F69 |",
    B: "| Bbmaj9 | Am7 Dm9 | Gm9 | C13sus4 C13 | Bbmaj9 | Bbm6 | Fmaj9/C | Eb13sus4 Eb13 |",
    LIFT: "| Abmaj9 | Cm7 | Dbmaj9 | Bbm9 Eb13 | C7sus4 C7 | Fm9 | Bbm9 Eb13 | Ab69:2 C9sus4:2 |",
    CODA: "| Gm9 C13 | Dm9 | Bbmaj9 Bbm6 | Fmaj9/C C7sus4 | F69 | F69 | F69 | F69 |",
  };
  const PROG = Object.fromEntries(Object.entries(CH).map(([k, v]) => [k, T.progression(v, BPB)]));
  const progOf = (sec) => sec === "B" ? PROG.B : sec === "LIFT" ? PROG.LIFT : sec === "CODA" ? PROG.CODA : sec === "PASSED" ? PROG.HOOK_TO_B : PROG.HOOK;

  // who wins a hardware voice (ev.priority overrides)
  const PRIORITY = { solo: 7, flute: 6, pulse: 6, horn: 5, kick: 5, snare: 5, bass: 5, pad: 4, crash: 2, bell: 3, tom: 3, pluck: 2, hat: 1 };
  const MONO = ["flute", "pulse", "horn"]; // one hardware voice each: a new note replaces the old
  const CHIP_MELODIC = new Set(["flute", "pulse", "horn", "bell"]);
  const RANGE = { solo: [57, 91], flute: [60, 91], pulse: [55, 88], horn: [50, 81], bell: [67, 96] };

  // ---------- the lap ----------
  const tempoAt = G.tempoScript(BPM, [
    { at: 0, bpm: SOLO_BPM, rampBeats: 0, hold: true },        // the solo, a little under tempo
    { at: 4, bpm: BPM, rampBeats: 4, hold: true },             // the band picks it up on the pickup
    { at: 21, bpm: 68, rampBeats: 8, hold: true },             // ritardando through IV–iv and the sus
    { at: 22, bpm: 58, rampBeats: 4, hold: true },             // the fermata bar
    { at: 23, bpm: SOLO_BPM, rampBeats: 0, hold: true },       // the bells, at the solo's tempo
  ]);
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    const bar = cl * CB, si = Math.floor(bar / SEC_BARS), off = bar % SEC_BARS;
    return { lap, cl, si, sec: SECS[si], off, lastCycle: off + CB >= SEC_BARS };
  }

  // ---------- material: one section of one lap, hand-written and routed ----------
  /** Notation → events with `at` in beats from the section start (the first bar of `bars` is the pickup, bar -1). */
  function tune(bars, o = {}) {
    return P.line(bars, { beatsPerBar: BPB, track: o.track, vel: o.vel ?? 0.76 }).map((e) => ({ ...e, bar: e.bar - 1, note: e.note + (o.up || 0) }));
  }
  const atOf = (e) => e.bar * BPB + e.beat;
  /** Articulate a line (phrasing fields, dynamics, slurs, breaths), then give it `at`. */
  function sing(line, marks, o = {}) {
    const out = P.articulate(line, marks, { beatsPerBar: BPB, scale: o.scaleAt, lengthen: o.lengthen ?? 1.1, breathLate: 0.04, breathGap: 0.15, breathFirst: true, overlap: 0.06 });
    return out.map((e) => ({ ...e, at: atOf(e) }));
  }
  /** Ornaments by hand-rule, never on a note that already scoops: a grace from below after a leap, a mordent on a long held note. */
  function ornament(line, density, rr) {
    line.forEach((e, i) => {
      const a = P.parseArt(e.art || "");
      const prev = line[i - 1];
      const leap = prev && prev.bar === e.bar ? e.note - prev.note : 0;
      e.vel = 0.74 + (e.note - 74) / 110 + (e.dur >= 2 ? 0.04 : 0) + rr.gauss(0.012);
      if (density <= 0 || a.scoop || a.staccato || a.grace || a.mordent) return;
      if (leap >= 4 && e.dur >= 1 && rr.chance(density * 0.6)) e.grace = "step";
      else if (e.dur >= 2.5 && rr.chance(density * 0.45)) e.mordent = true;
      else if (e.dur >= 2 && leap >= 3 && rr.chance(density * 0.5)) e.scoop = 1;
    });
    return line;
  }

  function buildSection(sec, lap, r) {
    const prog = progOf(sec);
    const chordAt = T.chordAtFactory(prog, BPB);
    const sym = (b) => chordAt(clamp(b, 0, SEC_BEATS - 0.001)).chord;
    const scaleAt = (b) => T.chord(sym(b)).scale;
    const notes = [];
    const L = lap % 3;
    let label = "";
    const orn = lap === 0 ? 0 : Math.min(0.5, 0.2 + 0.12 * lap);
    if (sec === "SOLO" || sec === "BAND") {
      const line = ornament(tune(HOOK, { track: "solo" }), sec === "SOLO" ? orn * 0.6 : orn, r);
      notes.push(...sing(line, PHR_HOOK, { scaleAt }));
      if (sec === "BAND") notes.push(...tune(COUNTER, { track: "horn", vel: 0.5 }).map((e) => ({ ...e, bar: e.bar + 1, at: atOf(e) + BPB }))); // COUNTER has no pickup bar
      label = sec === "SOLO" ? "the hook alone, rubato" : "the band comes in · horn counter-line";
    } else if (sec === "PASSED") {
      const line = sing(ornament(tune(HOOK, {}), orn * 0.5, r), PHR_HOOK, { scaleAt });
      const V = (...names) => names.map((n) => ({ track: n, range: RANGE[n], gain: n === "bell" ? 0.85 : n === "horn" ? 0.9 : 1 }));
      let routed;
      if (L === 1) {
        routed = D.distribute(line, { voices: V("flute", "pulse", "horn", "solo"), mode: "handoff", phrases: PHRASES_HOOK, join: "extend", overlap: 0.3, handoffDur: 2, minNotes: 2, stay: 0.35, rng: r });
        label = "the hook handed off mid-line: flute, pulse, horn, solo";
      } else {
        const order = L === 0 ? ["flute", "horn", "pulse", "solo"] : ["pulse", "flute", "solo", "horn"];
        routed = D.distribute(line, { voices: V("flute", "pulse", "horn", "solo"), mode: "phrase", phrases: PHRASES_HOOK, order, rng: r });
        label = "the hook passed around · " + order.join(", ");
      }
      notes.push(...routed.map((n) => ({ ...n, at: n.at })));
      // the bell doubles the long notes of whoever has the tune, an octave up (the chime on the held note)
      routed.filter((n) => n.dur >= 2.5).forEach((n) => notes.push({ track: "bell", at: n.at, dur: 2, note: n.note + 12 <= 93 ? n.note + 12 : n.note, vel: 0.32 }));
    } else if (sec === "B") {
      const line = ornament(tune(BRIDGE, { track: "solo" }), orn * 0.5, r);
      const sung = sing(line, PHR_BRIDGE, { scaleAt });
      notes.push(...sung);
      notes.push(...tune(COUNTER_B, { track: "horn", vel: 0.48 }).map((e) => ({ ...e, bar: e.bar + 1, at: atOf(e) + BPB })));
      // the bell chimes the climax: the A5 and the D♭5 (the borrowed note), at pitch
      sung.filter((n) => n.dur >= 2 && n.at >= 16 && n.at < 24).forEach((n) => notes.push({ track: "bell", at: n.at, dur: 2, note: n.note, vel: 0.42 }));
      label = "the bridge · the climb, the borrowed iv, the ♭VII pivot";
    } else if (sec === "LIFT") {
      const bars = HOOK.slice(0, 8).concat([HOOK_LIFT_LAST]);
      const line = ornament(tune(bars, { track: "solo", up: 3 }), orn * 0.7, r);
      const marks = PHR_HOOK.map((m, i) => (i === 3 ? { ...m, to: 30.1 } : m));
      const sung = sing(line, marks, { scaleAt });
      notes.push(...sung);
      // the big statement: a detuned pulse in unison, the horn an octave down, bells on the long notes
      const plain = (n) => { const c = { ...n }; for (const k of ["grace", "mordent", "breath", "phraseStart", "phraseEnd", "delay", "scoop", "fall"]) delete c[k]; return c; };
      sung.forEach((n) => notes.push({ ...plain(n), track: "pulse", vel: n.vel * 0.8 }));
      sung.forEach((n) => notes.push({ ...plain(n), track: "horn", note: n.note - 12, vel: n.vel * 0.85, dur: Math.max(0.2, n.dur - 0.05) }));
      sung.filter((n) => n.dur >= 2 && n.at > 0 && (L !== 2 || n.note >= 80)).forEach((n) => notes.push({ track: "bell", at: n.at, dur: 2, note: n.note + 12 <= 93 ? n.note + 12 : n.note, vel: 0.44 }));
      label = "the lift · the hook in A♭, solo and pulse in unison, horn below, bells";
    } else { // CODA
      const line = ornament(tune(CODA, { track: "solo" }), 0, r);
      line.forEach((e) => { if (e.bar >= 2) e.vel -= 0.04; });
      notes.push(...sing(line, PHR_CODA, { scaleAt, lengthen: 1.05 }));
      notes.push(...tune(BELL_CLOSE, { track: "bell", vel: 0.4 }).map((e) => ({ ...e, bar: e.bar + 5, at: atOf(e) + 5 * BPB })));
      label = "the coda · deceptive cadence, IV–iv, ritardando, the real one";
    }
    return { prog, notes, label };
  }

  Sim.register({
    id: "after-the-fireworks",
    title: "After the Fireworks",
    genre: "16-bit ending theme",
    about: "The credits theme: a hand-written hook in F major that starts on one expressive solo voice with rubato, gathers the band, is passed around the ensemble phrase by phrase, climbs through a bridge whose key moment is the tune on the borrowed iv, lifts a minor third into a big last statement in A♭ with unison leads, horn and bells, and comes back down through a deceptive cadence, a ritardando and a fermata to the bells and the solo voice again. Written for an eight-voice sound chip with its short dark echo; the solo is articulated with scoops, slurs, late vibrato and breaths. One lap is the whole arc, then it begins again quietly.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["celebrate", "romance", "hangout"],
    energy: 0.4,

    instruments(ctx) {
      const { I } = ctx;
      const chip = Sim.spc.chip(ctx, {
        voices: VOICES - 1, volume: -7, rate: 32000, bits: 8, crush: 0.4, tone: 7400,
        echo: { time: 0.16, feedback: 0.46, tone: 2600, level: -8 },
      });
      // the solo voice: a triangle-ish loop played with Sim.phrasing, into the chip's output stage and echo
      const soloSynth = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.26, 0.09, 0.04, 0.015] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
        envelope: { attack: 0.035, decay: 0.25, sustain: 0.82, release: 0.26 },
        filterEnvelope: { attack: 0.05, decay: 0.4, sustain: 0.7, release: 0.3, baseFrequency: 1400, octaves: 1.4 },
      }));
      const solo = P.wrap(ctx, soloSynth, {
        volume: -9, glide: 0.06, scoopTime: 0.1, fallTime: 0.25, release: 0.26,
        vibrato: { rate: 5.1, depth: 0.1, delay: 0.36, rise: 0.45, deepen: 1.3 },
        breath: P.breath(ctx, chip.bus, { level: -31, freq: 2400, length: 0.16 }),
      });
      const soloPan = ctx.keep(new Tone.Panner(0.06)).connect(chip.bus);
      solo.out.connect(soloPan);
      const soloEcho = ctx.keep(new Tone.Gain(0.5)); soloPan.connect(soloEcho); soloEcho.connect(chip.echo);

      const flute = chip.voice("flute", { priority: PRIORITY.flute, echo: 0.55, pan: -0.22, volume: -1 });
      const pulse = chip.voice("lead", { priority: PRIORITY.pulse, echo: 0.45, pan: 0.3, volume: -4, wave: "pulse", cutoff: 3600, detune: 7, bend: { cents: 30, time: 0.02 }, vibrato: { rate: 5.1, depth: 0.08, delay: 0.36 } });
      const horn = chip.voice("brass", { priority: PRIORITY.horn, echo: 0.4, pan: -0.12, volume: -4, cutoff: 2600, attack: 0.03, bend: { cents: -40, time: 0.05 } });
      const bell = chip.voice("bell", { poly: 2, priority: PRIORITY.bell, echo: 0.6, pan: 0.35, volume: -4, decay: 1.4 });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.35, pan: -0.1, volume: -6, cutoff: 2800, attack: 0.18, release: 0.4 });
      const pluck = chip.voice("pluck", { poly: 1, priority: PRIORITY.pluck, echo: 0.6, pan: 0.4, volume: -3, decay: 0.34 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.15, pan: 0, volume: -2, cutoff: 150, decay: 0.4, sustain: 0.6 });
      const kick = chip.voice("kick", { priority: PRIORITY.kick, volume: 1, note: 40, decay: 0.26 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.3, pan: 0.05, volume: -1, decay: 0.14, tone: 2200, body: 170 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.25, volume: -3, cutoff: 7500 });
      const crash = chip.voice("hat", { priority: PRIORITY.crash, echo: 0.35, pan: 0.15, volume: -5, cutoff: 4200, sweep: 2500, open: 1.1, closed: 0.5 });
      const tom = chip.voice("tom", { priority: PRIORITY.tom, echo: 0.3, pan: 0.2, volume: 0 });
      const hum = { timing: 0.002, vel: 0.04 }; // a chip does not breathe; the velocities already do
      return {
        solo: { layer: "melody", play: (t, e, d) => solo.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        flute: { layer: "melody", play: flute.play, humanize: hum },
        pulse: { layer: "melody", play: pulse.play, humanize: hum },
        horn: { layer: "melody", play: horn.play, humanize: hum },
        bell: { layer: "texture", play: bell.play, humanize: hum },
        pad: { layer: "harmony", play: pad.play, humanize: hum },
        pluck: { layer: "texture", play: pluck.play, humanize: hum },
        bass: { layer: "bass", play: bass.play, humanize: hum },
        kick: { layer: "drums", play: kick.play, humanize: hum },
        snare: { layer: "drums", play: snare.play, humanize: hum },
        hat: { layer: "drums", play: hat.play, humanize: hum },
        crash: { layer: "drums", play: crash.play, humanize: hum },
        tom: { layer: "drums", play: tom.play, humanize: hum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, cl, si, sec, off } = W;
      const L = lap % 3;
      if (!state.built) Object.assign(state, { built: {}, padV: null, bassLast: 41, stolen: 0, dropped: 0, lastFill: null });
      const section = (s, lp) => {
        const key = `${lp}:${s}`;
        if (!state.built[key]) state.built[key] = buildSection(s, lp, r.fork(17 + lp * 7 + SECS.indexOf(s)));
        return state.built[key];
      };
      const S = section(sec, lap);
      const nextSec = SECS[(si + 1) % SECS.length], nextLap = si + 1 >= SECS.length ? lap + 1 : lap;
      const NS = W.lastCycle ? section(nextSec, nextLap) : null;
      const prog = S.prog;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(clamp(b, 0, SEC_BEATS - 0.001)).chord;
      const ch = (b) => T.chord(sym(b));
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      let ev = [];
      // push by beat within the SECTION; events outside this cycle's window are dropped
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - s0;
        if (abs < -1e-6 || abs >= CB * BPB - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      const emit = (n, secBeat) => {
        const { at, bar, beat, idx, track, dur, note, vel, ...extra } = n;
        push(track, secBeat, dur, note, vel, extra);
      };

      // ---------- the hand-written lines (this window), plus the next section's pickup ----------
      for (const n of S.notes) if (n.at >= s0 - 1e-6 && n.at < s1 - 1e-6) emit(n, n.at);
      if (NS) for (const n of NS.notes) if (n.at < -1e-6 && n.at + SEC_BEATS >= s0) emit(n, n.at + SEC_BEATS);
      const busy = (track, b0, b1) => S.notes.some((n) => n.track === track && n.at < b1 && n.at + n.dur > b0);

      // ---------- arrangement plan ----------
      const plan = {
        pad: sec === "SOLO" ? (off >= 4 ? 2 : 0) : sec === "LIFT" ? 2 : sec === "CODA" ? (off < 6 ? 3 : 0) : 3, // the chip has seven voices besides the solo
        padVel: sec === "SOLO" ? 0.3 : sec === "LIFT" ? 0.5 : sec === "CODA" ? 0.4 : 0.42,
        bass: sec === "SOLO" ? null : sec === "CODA" ? (off < 4 ? "long" : off < 6 ? "hold" : null) : sec === "LIFT" ? "push" : sec === "B" ? "two" : "half",
        drums: sec === "SOLO" ? null : sec === "CODA" ? (off < 2 ? "thin" : null) : sec === "LIFT" ? "full" : sec === "B" && off >= 4 ? "build" : "soft",
        pluck: sec === "BAND" ? "sweep" : sec === "PASSED" ? (L === 2 ? "sweep" : "bar") : sec === "B" ? "bar" : sec === "LIFT" ? "run" : sec === "CODA" && off === 4 ? "gliss" : null,
      };
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= s0 && c.s < s1);

      // ---------- pad: the plain chord, a few voices, voice-led ----------
      const plain = (s) => s.replace(/maj9/, "").replace(/m9/, "m7").replace(/13sus4/, "7sus4").replace(/13/, "7").replace(/9sus4/, "7sus4").replace(/69/, "6").replace(/(?<=[A-G][b#]?)9/, "7");
      if (plan.pad) {
        const tuneTracks = new Set(["solo", "flute", "pulse", "horn"]);
        const sungIn = (b0, b1) => ev.filter((e) => tuneTracks.has(e.track) && typeof e.note === "number" && e.bar * BPB + e.beat < b1 - s0 && e.bar * BPB + e.beat + e.dur > b0 - s0 + 0.1).map((e) => e.note);
        for (const c of spans) {
          const slash = /\//.test(c.chord);
          let v = slash
            ? T.voice(c.chord.replace(/maj9|maj7|69|6|add9/, ""), { lo: 53, hi: 72, n: plan.pad, rootless: false, prev: state.padV, spread: "close", top: [60, 69], omitBass: false })
            : T.voice(plain(c.chord), { lo: 53, hi: 72, n: plan.pad, rootless: true, prev: state.padV, spread: "close", top: [60, 69], omitBass: true });
          state.padV = v;
          // a chip arranger's rule: the pad never holds a semitone (or a minor ninth) against the tune
          const sung = sungIn(c.s, c.s + c.dur);
          const rubbed = v.filter((m) => !sung.some((x) => Math.abs(x - m) % 12 === 1 && Math.abs(x - m) < 14));
          if (rubbed.length >= Math.min(2, plan.pad - 1)) v = rubbed; // a two-voice pad may thin to one note
          const fermata = sec === "CODA" && c.bar === 4;
          const dur = fermata ? 7.5 : c.dur - 0.25;
          if (sec === "CODA" && c.bar === 5) continue; // the fermata chord already rings through bar 45
          push("pad", c.s, dur, v, plan.padVel + (sec === "B" && c.bar === 5 ? -0.05 : 0));
        }
      }

      // ---------- harp ----------
      const arp = (c, o = {}) => {
        const tones = T.notesIn(T.chord(plain(c.chord)).pcs, 57, 81);
        const start = tones.findIndex((m) => mod12(m) === T.chord(c.chord).root && m >= 57);
        const seq = tones.slice(Math.max(0, start));
        const step = o.step ?? 0.5, n = Math.min(Math.round((o.len ?? c.dur) / step), o.max ?? 99);
        for (let k = 0; k < n; k++) {
          const i = o.bounce ? (k % (2 * seq.length - 2) < seq.length ? k % (2 * seq.length - 2) : 2 * seq.length - 2 - (k % (2 * seq.length - 2))) : k % seq.length;
          push("pluck", c.s + (o.from ?? 0) + k * step, step * 0.9, seq[i], (o.vel ?? 0.44) * (k === 0 ? 1 : k % 2 ? 0.75 : 0.88));
        }
      };
      if (plan.pluck === "sweep") for (const c of spans) if (!(sec === "BAND" && c.bar === 7)) arp(c, { max: 4, vel: 0.4 });
      if (plan.pluck === "bar") for (const c of spans) if (c.dur >= 2) arp(c, { bounce: true, vel: 0.38 });
      if (plan.pluck === "run") for (const c of spans) { if (c.dur >= 4) arp(c, { from: 2, len: 2, vel: 0.42 }); else if (c.beat === 2) arp(c, { len: 2, vel: 0.42 }); } // after the bell has rung
      if (plan.pluck === "gliss") { const c = spans[0]; if (c) [53, 57, 60, 62, 65, 69, 72, 74, 77, 81].forEach((m, k) => push("pluck", c.s + k * 0.25, 0.3, m, 0.34 + 0.02 * k)); }

      // ---------- bass ----------
      if (plan.bass) {
        const near = (pc, from, lo = 36, hi = 47) => T.nearest(from, [pc], lo, hi);
        spans.forEach((c, i) => {
          const cc = T.chord(c.chord);
          const R = near(cc.bass, state.bassLast);
          const fifthPc = cc.bass !== cc.root ? cc.root : mod12(cc.root + 7); // a slash chord alternates its bass note with the root
          const fifth = R >= 43 ? near(fifthPc, R - 5, 34, 47) : near(fifthPc, R + 7, 34, 50);
          const next = i + 1 < spans.length ? spans[i + 1] : prog.find((x) => x.bar * BPB + x.beat === c.s + c.dur) || (NS ? NS.prog[0] : null);
          const nextR = next ? near(T.chord(next.chord).bass, R) : R;
          const nextScale = T.chord(next ? next.chord : c.chord).scale;
          const stepIn = nextR === R ? fifth : nextR > R ? T.step(nextR, -1, nextScale) : T.step(nextR, 1, nextScale);
          const ap = Math.abs(nextR - R) <= 2 || !r.chance(0.55) ? fifth : stepIn;
          const add = (b, d, n, v) => { if (b < c.dur - 0.01) push("bass", c.s + b, Math.min(d, c.dur - b - 0.05), n, v); };
          if (plan.bass === "half") { add(0, c.dur >= 4 ? 1.9 : c.dur - 0.1, R, 0.82); if (c.dur >= 4) { add(2, 1.4, fifth, 0.66); if (r.chance(0.5)) add(3.5, 0.45, ap, 0.6); } }
          else if (plan.bass === "two") { add(0, 1.4, R, 0.82); if (c.dur >= 4) { add(1.5, 0.4, R, 0.5); add(2, 1.4, r.chance(0.5) ? fifth : R, 0.64); add(3.5, 0.45, ap, 0.58); } else if (c.dur >= 2) add(1.5, 0.45, ap, 0.56); }
          else if (plan.bass === "push") { add(0, 0.9, R, 0.86); if (c.dur >= 4) { add(1.5, 0.45, R, 0.62); add(2, 0.9, fifth, 0.7); add(3, 0.45, R, 0.6); add(3.5, 0.45, ap, 0.62); } else add(1.5, 0.45, ap, 0.6); }
          else if (plan.bass === "long") { add(0, c.dur - 0.15, R, 0.78); if (c.dur >= 4 && ap === fifth && r.chance(0.5)) add(3.5, 0.45, fifth, 0.52); }
          else if (plan.bass === "hold") { if (c.bar === 4) push("bass", c.s, 7.5, R, 0.72); }
          state.bassLast = R;
        });
      }

      // ---------- drums ----------
      const drum = (track, secBeat, vel, extra) => push(track, secBeat, track === "hat" && extra?.open ? 0.5 : 0.25, track, vel, extra);
      const FILLS = {
        roll: (b) => { for (let q = 0; q < 8; q++) drum("snare", b + 2 + q * 0.25, 0.38 + 0.06 * q); },
        toms: (b) => { drum("snare", b + 2, 0.6); [[2.5, 57], [3, 52], [3.5, 47], [3.75, 43]].forEach(([p, m]) => drum("tom", b + p, 0.6 + 0.05 * p, { pitch: m })); },
        soft: (b) => { drum("snare", b + 3, 0.45); drum("snare", b + 3.5, 0.5); drum("hat", b + 3.5, 0.45, { open: true }); },
        build: (b) => { for (let q = 0; q < 16; q++) drum("snare", b + q * 0.25, 0.3 + 0.045 * q); drum("kick", b, 0.9); drum("kick", b + 2, 0.9); },
      };
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill) || opts); state.lastFill = k; return k; };
      if (plan.drums) {
        for (let i = 0; i < CB; i++) {
          const bar = off + i, b = bar * BPB, last = bar === SEC_BARS - 1;
          const st = plan.drums;
          const fill = last ? (sec === "B" ? "build" : sec === "LIFT" ? pickFill(["toms", "roll"]) : sec === "CODA" ? null : pickFill(["soft", "toms", "roll"])) : null;
          const cut = fill === "build" ? 0 : fill === "soft" ? 3 : fill ? 2 : 9;
          const ok = (x) => x < cut;
          if (st === "thin") {
            [1.5, 3.5].forEach((q) => drum("hat", b + q, 0.34));
            drum("kick", b, 0.7); if (bar === 0) drum("snare", b + 1, 0.4); drum("snare", b + 3, 0.42);
          } else {
            const full = st === "full", build = st === "build";
            const kicks = [0, 2.5].concat(full && bar % 2 === 1 ? [3.5] : []);
            // the kit is one hardware voice: hats sit on the 8ths the kick and snare leave free
            if (!full) for (const x of [0.5, 1.5, 2.5, 3.5]) {
              if (!ok(x) || kicks.includes(x)) continue;
              if (x === 3.5 && bar % 2 === 1 && build) { drum("hat", b + x, 0.42, { open: true }); continue; }
              drum("hat", b + x, x === 1.5 || x === 3.5 ? 0.4 : 0.3);
            }
            kicks.forEach((k, j) => { if (ok(k)) drum("kick", b + k, j === 0 ? 0.9 : 0.72); });
            if (ok(1)) drum("snare", b + 1, full ? 0.8 : build ? 0.64 : 0.5);
            if (ok(3)) drum("snare", b + 3, full ? 0.82 : build ? 0.68 : 0.52);
            if (build && ok(3.5) && r.chance(0.5)) drum("snare", b + 3.75, 0.3);
            if (full && r.chance(0.3) && ok(3.75)) drum("snare", b + 3.75, 0.28);
          }
          if (fill) FILLS[fill](b);
          if (fill === "build" || fill === "roll") ev = G.crescendo(ev, { tracks: ["snare"], from: (bar - off) * BPB + (fill === "build" ? 0 : 2), to: (bar - off + 1) * BPB, v0: 0.85, v1: 1.15 });
        }
        if (sec === "LIFT" && off === 0) drum("crash", 0, 0.6, { open: true });
        if (sec === "CODA" && off === 0 && L !== 0) drum("crash", 0, 0.4, { open: true });
      }

      // ---------- feel: groove templates, rubato for the solo, the fermata ----------
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          snare: { template: "laidback", amount: 0.8 }, hat: { template: "pushed", amount: 0.5 }, kick: "straight", tom: "straight",
          pad: { template: "straight", late: 18, vels: false }, horn: { template: "straight", late: 12, vels: false },
          bass: { template: "straight", late: 3, vels: false }, pluck: { template: "mpc54", amount: 0.5 },
        },
      });
      const rub = sec === "SOLO" || sec === "CODA" ? 0.95 : sec === "PASSED" ? 0.5 : 0.6;
      ev = G.rubato(ev, { track: "solo", bpm: BPM, bpb: BPB, amount: rub, linger: sec === "B" ? "both" : "high", lingerMs: sec === "SOLO" ? 70 : 50, rng: r });
      if (sec === "PASSED") ev = G.rubato(ev, { track: "flute", bpm: BPM, bpb: BPB, amount: 0.45, linger: "high", rng: r });
      if (sec === "CODA" && off === 4) ev = G.hold(ev, { bar: 0, beat: 0, extra: 2, tracks: ["solo", "bass"] });

      // ---------- the chip: phrasing marks the chip voices can honour, then the voice budget ----------
      for (const e of ev) {
        if (!CHIP_MELODIC.has(e.track)) continue;
        if (e.scoop) e.bend = { cents: -100 * e.scoop, time: 0.08 };
        else if (e.entrance && e.track !== "bell") e.bend = { cents: -35, time: 0.05 };
      }
      const pos = (e) => e.bar * BPB + e.beat;
      for (const tr of MONO) {
        const xs = ev.filter((e) => e.track === tr).sort((a, b) => pos(a) - pos(b));
        for (let i = 1; i < xs.length; i++) xs[i - 1].dur = Math.max(0.05, Math.min(xs[i - 1].dur, +(pos(xs[i]) - pos(xs[i - 1])).toFixed(4)));
      }
      const soloEv = ev.filter((e) => e.track === "solo");
      const bud = Sim.spc.budget(ev.filter((e) => e.track !== "solo"), { voices: VOICES - 1, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      const events = bud.events.concat(soloEv);

      const harmony = prog.filter((c) => c.bar >= off && c.bar < off + CB).map((c) => ({ ...c, bar: c.bar - off }));
      return { events, harmony, section: `Lap ${lap + 1} · ${S.label}`, state, tempo: tempoAt(cl) };
    },
  });
})();
