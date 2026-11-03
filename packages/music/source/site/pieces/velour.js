// Velour: a slow funk in G minor, 88 bpm, where the feel is the idea.
//
// A late-70s studio rhythm section on a velour couch: the drummer sits the snare behind the beat and leans the
// hats forward, the bass pushes its syncopations and lands its downbeats dead centre, the Rhodes comps a hair
// late, the clavinet pecks on top of the hats, and the lead (a warm two-oscillator synth with glide and a late
// vibrato) sings with rubato over all of it, lingering on the high notes and catching up at the ends of phrases.
// The tempo itself moves at the big moments: a ritardando through the last two bars of B into the return, a
// lift (+2 bpm) for the last chorus, and a fermata on the tag's final chord before the band breathes and counts
// back in. All of this is Sim.groove (site/engine/groove.js); the notes are the same every lap, the dress changes.
//
// THE TUNE (fixed by hand; the generator never regenerates it, only arranges, ornaments and times it)
//   Motif: a rise of a minor third and a turn, G B♭ A G, on a dotted-8th/16th funk rhythm; then a rising pickup.
//   A (8 bars):  | Gm9 | Gm9 | Cm9 | Cm9 F13 | Gm9 | E♭maj9 | Am7♭5 | D7♯9 |
//     pickup  D F                  (two 8ths, from the bar before)
//     bar 1   G . . B♭ A G         the motif on i
//     bar 2   F D . . . D F G      the ♭7 falls to the 5th; the pickup climbs again
//     bar 3   B♭ C D . E♭ D        the motif's shape a third higher on iv, reaching the 9
//     bar 4   C B♭ A . G A         answered on the F13 (A is its third; G the 9, a colour tone on purpose)
//     bar 5   B♭ D . D C A         the motif up a third, on i again: the peak of the A section
//     bar 6   G . . F G B♭         on ♭VI the line rests on the third and climbs out
//     bar 7   C E♭ D C             the ii half-diminished, ♭5 in the tune
//     bar 8   B♭ A F♯ D            ♭13 appoggiatura onto the fifth of V7♯9, down to the leading tone; pickup varies
//   Counter (A′, strings, low, in half notes): D C | B♭ A | G B♭ | G A | F G | B♭ G | E♭ C | C A
//   B (8 bars, the lift, in the relative major with a borrowed iv):
//                | E♭maj9 | Dm7 Gm7 | Cm9 | F13 | B♭maj9 | E♭m9 | Gm9 | D7♯9 |
//     bar 1   B♭ D F                the E♭ triad climbs to F5, the piece's high note (the rubato lingers here)
//     bar 2   F D C B♭ . A          falls through Dm7 to the third of Gm7
//     bar 3   G B♭ D . E♭           the motif's rise again, on Cm9
//     bar 4   D C A                 13 → 5 → 3 of F13
//     bar 5   F D C                 B♭maj9: the high F once more, then the 9
//     bar 6   G♭ F E♭               the borrowed iv (E♭m9): the ♭3 sighs down to the root
//     bar 7   D . . B♭ A            home chord, the line settling (ritardando begins)
//     bar 8   B♭ A F♯ (A F♯)        the appoggiatura again, F♯ held; pickup A F♯ leads to G
//   Tag (4 bars): | Gm9 | E♭maj9 | Am7♭5 D7♯9 | Gm9 (fermata) |   the motif · F G B♭ · C E♭ A F♯ · G held
//   One lap: intro 4 · A 8 · A′ 8 · B 8 · A″ 8 · tag 4 = 40 bars ≈ 1:50 at 88. Laps alternate who answers whom.
(function () {
  "use strict";
  const T = Sim.theory, G = Sim.groove;
  const BPB = 4, CB = 2, BPM = 88;
  const mod12 = T.mod12;

  // ---------- notation ----------
  /** Bars of "Note beat dur, ..." (null = empty bar) -> [{bar, beat, dur, note}]; bar -1 holds the pickup. */
  function phrase(bars, pickup) {
    const out = [];
    const add = (txt, bar) => txt && txt.split(",").forEach((tok) => { const [n, b, d] = tok.trim().split(/\s+/); out.push({ bar, beat: +b, dur: +d, note: T.midi(n) }); });
    if (pickup) add(pickup, -1);
    bars.forEach((txt, bar) => add(txt, bar));
    return out;
  }

  // ---------- the score ----------
  const A_CH = ["Gm9", "Gm9", "Cm9", "Cm9 F13", "Gm9", "Ebmaj9", "Am7b5", "D7#9"];
  const A_MEL = [
    "G4 0 1.5, Bb4 1.5 .75, A4 2.25 .25, G4 2.5 1.25",
    "F4 0 .5, D4 .5 1.5, D4 2.5 .5, F4 3 .5, G4 3.5 .5",
    "Bb4 0 1, C5 1 .5, D5 1.5 1.5, Eb5 3 .5, D5 3.5 .5",
    "C5 0 1.5, Bb4 1.5 .5, A4 2 1, G4 3 .5, A4 3.5 .5",
    "Bb4 0 .75, D5 .75 1.25, D5 2 .5, C5 2.5 .5, A4 3 1",
    "G4 0 2, F4 2.5 .5, G4 3 .5, Bb4 3.5 .5",
    "C5 0 1.5, Eb5 1.5 1, D5 2.5 .5, C5 3 1",
    "Bb4 0 1, A4 1 1, F#4 2 .5, D4 2.5 1",
  ];
  const A_PICK = { plain: "D4 3 .5, F4 3.5 .5", fromB: "A4 3 .5, F#4 3.5 .5" };
  const A_CNT = ["D4 0 2, C4 2 2", "Bb3 0 2, A3 2 2", "G3 0 2, Bb3 2 2", "G3 0 2, A3 2 2", "F3 0 2, G3 2 2", "Bb3 0 2, G3 2 2", "Eb4 0 2, C4 2 2", "C4 0 2, A3 2 2"];

  const B_CH = ["Ebmaj9", "Dm7 Gm7", "Cm9", "F13", "Bbmaj9", "Ebm9", "Gm9", "D7#9"];
  const B_MEL = [
    "Bb4 0 1, D5 1 1, F5 2 2",
    "F5 0 .5, D5 .5 1, C5 1.5 .5, Bb4 2 1.5, A4 3.5 .5",
    "G4 0 1, Bb4 1 1, D5 2 1.5, Eb5 3.5 .5",
    "D5 0 1.5, C5 1.5 .5, A4 2 2",
    "F5 0 1.5, D5 1.5 .5, C5 2 2",
    "Gb5 0 2, F5 2 1, Eb5 3 1",
    "D5 0 2.5, Bb4 2.5 .5, A4 3 1",
    "Bb4 0 1.5, A4 1.5 .5, F#4 2 1",
  ];
  const B_PICK = "G4 3.5 .5";

  const TAG_CH = ["Gm9", "Ebmaj9", "Am7b5 D7#9", "Gm9"];
  const TAG_MEL = ["G4 0 1.5, Bb4 1.5 .75, A4 2.25 .25, G4 2.5 1.5", "F4 0 .5, G4 .5 1, Bb4 1.5 2.5", "C5 0 1, Eb5 1 1, A4 2 1, F#4 3 1", "G4 0 4"];

  const INTRO_CH = ["Gm9", "Gm9", "Cm9 F13", "D7#9"];

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, prime: 0, pick: "plain" },
    { id: "A", bars: 8, prime: 1, pick: "plain" },
    { id: "B", bars: 8 },
    { id: "A", bars: 8, prime: 2, pick: "fromB" },
    { id: "TAG", bars: 4 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB; // 40 bars, 20 cycles

  const secCache = new Map();
  function section(f) {
    const key = f.id + (f.pick || "");
    if (secCache.has(key)) return secCache.get(key);
    let s;
    if (f.id === "intro") s = { ch: INTRO_CH, mel: [], cnt: [] };
    else if (f.id === "B") s = { ch: B_CH, mel: phrase(B_MEL, B_PICK), cnt: [] };
    else if (f.id === "TAG") s = { ch: TAG_CH, mel: phrase(TAG_MEL, "D4 3.5 .5"), cnt: [] };
    else s = { ch: A_CH, mel: phrase(A_MEL, A_PICK[f.pick]), cnt: phrase(A_CNT) };
    s.prog = T.progression("| " + s.ch.join(" | ") + " |", BPB);
    secCache.set(key, s);
    return s;
  }
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    let bar = cl * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, cl, i, f, nf, off: bar, lastHalf: bar + CB >= f.bars, firstHalf: bar === 0, nextLap: i + 1 >= LAP.length ? lap + 1 : lap };
  }

  // ---------- tempo: the big moments, keyed by cycle within the lap ----------
  // cycle 13 = B bars 7-8 (ritardando into the return), 14 = A″ starts (the band picks it up with a lift),
  // 18 = tag settles to tempo, 19 = tag bars 3-4 (ritardando into the fermata), 0 = a tempo for the count-in.
  const tempoAt = G.tempoScript(BPM, [
    G.aTempo(0, BPM),
    G.ritardando(13, 80, 8),
    G.accelerando(14, BPM + 2, 2),
    G.accelerando(18, BPM, 4),
    G.ritardando(19, 76, 8),
  ]);

  // ---------- arrangement ----------
  function arrange(f, lap, off) {
    const L = lap % 2, late = lap >= 2;
    const base = { lead: true, cnt: false, keys: "stabs", keysMel: false, clav: "answer", bass: "pocket", drums: "groove", pad: 0, congas: false, tamb: false, shaker: false, rub: 0.6, orn: lap > 0 ? 0.18 : 0, fill: false, crash: false };
    if (f.id === "intro") return { ...base, lead: false, keys: lap === 0 ? (off >= 2 ? "stabs" : null) : "stabs", clav: lap === 0 ? (off >= 2 ? "riff" : null) : L ? "riff" : "answer", drums: "groove", fill: off >= 2, rub: 0 };
    if (f.id === "A" && f.prime === 0) return { ...base, clav: L ? "riff" : "answer", keys: "stabs", fill: off >= 6, rub: 0.55 };
    if (f.id === "A" && f.prime === 1) return { ...base, cnt: true, keys: L ? "held" : "stabs", clav: "riff", bass: late ? "bounce" : "pocket", shaker: L === 1, fill: off >= 6, rub: 0.7, crash: off === 0 };
    if (f.id === "B") return { ...base, keys: "held", clav: null, bass: "half", drums: "latin", congas: true, shaker: true, pad: 0.3, rub: off >= 6 ? 1 : 0.85, fill: off >= 6, crash: off === 0 };
    if (f.id === "A") return { ...base, keys: "pulse", clav: "riff", bass: "bounce", drums: "deep", tamb: true, pad: off < 4 ? 0.22 : 0, rub: 0.65, fill: off >= 6, crash: off === 0, orn: 0.22 };
    return { ...base, keys: off < 2 ? "held" : "fermata", clav: off < 2 ? "answer" : null, bass: off < 2 ? "pocket" : "long", drums: off < 2 ? "thin" : "out", rub: 1, orn: 0 };
  }
  function label(f, lap, off) {
    const n = `Lap ${lap + 1} · `;
    if (f.id === "intro") return n + (lap === 0 ? "count-in · drums and bass find the pocket" : "the breath, then the pocket again");
    if (f.id === "B") return n + (off >= 6 ? "B · ritardando into the return" : off >= 4 ? "B · B♭maj9, the borrowed E♭m9" : "B · the lift into E♭ · congas, strings");
    if (f.id === "TAG") return n + (off < 2 ? "tag · the motif once more" : "tag · fermata on Gm9");
    if (f.prime === 0) return n + `A · the tune${off >= 4 ? " · the motif up a third, ♭VI, ii–V" : " · the motif on i, the pickup climbs"}`;
    if (f.prime === 1) return n + `A′ · the Rhodes counter-line, clav riff${off >= 6 ? " · V7♯9 slips to ♭VI" : ""}`;
    return n + `A″ · the lift · tambourine${off >= 6 ? " · home" : ""}`;
  }

  // comp figures: [offset within the chord span, kind, dur, vel]
  const FIG = {
    stabs: [[0, "up", 0.35, 0.56], [1.5, "up", 0.9, 0.46], [3.5, "up", 0.35, 0.4]],
    held: [[0, "both", 2.4, 0.46], [2.5, "up", 1.4, 0.4]],
    pulse: [[0, "up", 0.4, 0.54], [0.75, "up", 0.3, 0.38], [1.5, "up", 0.5, 0.42], [2.5, "both", 0.4, 0.48], [3.25, "up", 0.3, 0.36]],
    fermata: [[0, "both", 4, 0.5]],
  };
  // clavinet riffs over a one-bar chord span: [offset, degree] where "g" is a muted ghost
  const RIFF = {
    riff: [[0, "R"], [0.5, "7"], [0.75, "O"], [1.25, "g"], [1.5, "5"], [1.75, "7"], [2, "R"], [2.5, "g"], [2.75, "3"], [3, "4"], [3.5, "3"], [3.75, "R"]],
    answer: [[2, "g"], [2.25, "5"], [2.5, "7"], [3, "O"], [3.5, "g"], [3.75, "7"]],
    short: [[0, "R"], [0.5, "7"], [0.75, "O"], [1.25, "g"], [1.5, "5"]],
  };
  // bass figures over a one-bar chord span: [offset, kind, dur, vel]; "ap" approaches the next root
  const BASS = {
    pocket: [[0, "R", 1.4, 0.84], [1.75, "R", 0.4, 0.62], [2.5, "R", 0.6, 0.74], [3.25, "g", 0.1, 0.3], [3.5, "ap", 0.4, 0.6]],
    bounce: [[0, "R", 0.6, 0.84], [0.75, "O", 0.3, 0.56], [1.5, "g", 0.1, 0.3], [1.75, "R", 0.5, 0.64], [2.5, "7", 0.5, 0.7], [3, "5", 0.4, 0.6], [3.5, "ap", 0.4, 0.58]],
    half: [[0, "R", 2.4, 0.8], [2.5, "5", 0.9, 0.62], [3.5, "ap", 0.4, 0.56]],
    long: [[0, "R", 3.8, 0.76]],
    short: [[0, "R", 1.2, 0.8], [1.5, "ap", 0.4, 0.6]],
  };
  const FILLS = [
    [[2, "snare", 0.5], [2.5, "snare", 0.55], [3, "tom", 0.6, 50], [3.5, "tom", 0.66, 45]],
    [[2.5, "snare", 0.45], [2.75, "snare", 0.5], [3, "snare", 0.55], [3.25, "tom", 0.58, 50], [3.5, "tom", 0.62, 45], [3.75, "tom", 0.66, 40]],
    [[3, "snare", 0.42], [3.25, "snare", 0.48], [3.5, "snare", 0.54], [3.75, "snare", 0.6]],
    [[2, "tom", 0.5, 50], [2.5, "snare", 0.52], [3, "tom", 0.56, 45], [3.5, "tom", 0.62, 40], [3.75, "snare", 0.5]],
  ];

  Sim.register({
    id: "velour",
    title: "Velour",
    genre: "Slow funk",
    about: "A slow funk in G minor built on feel: the snare sits late, the hats lean forward, the bass pushes its syncopations, the Rhodes comps behind the beat and the clavinet pecks on top, while a warm glide lead sings the hand-written tune with rubato over the band. The tempo moves at the big moments: a ritardando into the return, a lift for the last chorus, a fermata and a breath before the band counts back in. Built with Sim.groove.",
    situations: ["hangout", "romance", "shopping"],
    energy: 0.45,
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const Gn = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };

      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 300, highcut: 6000 });
      const plate = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.025, lowcut: 400, highcut: 5000 });
      const slap = I.delay(ctx, out, { time: "8n.", feedback: 0.18, wet: 1, highcut: 3200 });

      /** The lead: two detuned saws through a warm low-pass, glide, and a vibrato that arrives after the note settles. */
      const leadG = Gn(-7);
      const leadLp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "lowpass", rolloff: -12, Q: 0.7 })).connect(leadG);
      const leadCh = ctx.keep(new Tone.Chorus({ frequency: 0.35, delayTime: 4.5, depth: 0.35, spread: 90, wet: 0.3 }).start());
      leadCh.connect(leadLp);
      const leadS = ctx.keep(new Tone.MonoSynth({
        portamento: 0.045,
        oscillator: { type: "fatsawtooth", count: 2, spread: 9 },
        filter: { type: "lowpass", rolloff: -24, Q: 1.1 },
        envelope: { attack: 0.035, decay: 0.25, sustain: 0.8, release: 0.22 },
        filterEnvelope: { attack: 0.04, decay: 0.5, sustain: 0.45, release: 0.3, baseFrequency: 420, octaves: 2.4 },
      })).connect(leadCh);
      const leadLfo = ctx.keep(new Tone.LFO({ frequency: 5.1, min: -1, max: 1 }).start());
      const leadVib = ctx.keep(new Tone.Gain(0)); // cents
      leadLfo.connect(leadVib); leadVib.connect(leadS.detune);
      const leadSafe = I.monotonic(leadG);
      function playLead(t, e, d) {
        const tt = leadSafe(t), f = hz(e.note);
        if (e.bend) { leadS.triggerAttackRelease(hz(e.note - e.bend), d, tt, e.vel); leadS.frequency.exponentialRampToValueAtTime(f, tt + 0.1); }
        else leadS.triggerAttackRelease(f, d, tt, e.vel);
        const p = leadVib.gain;
        p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
        if (d > 0.45) { p.setValueAtTime(0, tt + 0.28); p.linearRampToValueAtTime(18, tt + 0.7); }
      }
      const leadP = pan(leadG, -0.05);
      I.send(ctx, leadP, plate, -11); I.send(ctx, leadP, slap, -16);

      /** Fingered bass with flatwounds: a dull, round tone; ghost notes are a muted thump. */
      const bassG = Gn(-15);
      bassG.connect(out);
      const bassLp = ctx.keep(new Tone.Filter({ frequency: 900, type: "lowpass", rolloff: -12 })).connect(bassG);
      const bassS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.6, 0.28, 0.14, 0.07, 0.03] },
        filter: { type: "lowpass", rolloff: -24, Q: 0.9 },
        envelope: { attack: 0.005, decay: 0.35, sustain: 0.5, release: 0.09 },
        filterEnvelope: { attack: 0.004, decay: 0.2, sustain: 0.25, release: 0.1, baseFrequency: 120, octaves: 2.6 },
      })).connect(bassLp);
      const bassSafe = I.monotonic(bassG);
      I.send(ctx, bassG, room, -28);

      /** Clavinet: a bright pulse through a fixed wah peak and a quick decay, so it pecks. */
      const clavG = Gn(-10);
      const clavPeak = ctx.keep(new Tone.Filter({ frequency: 1500, type: "peaking", Q: 2.2, gain: 8 })).connect(clavG);
      const clavHp = ctx.keep(new Tone.Filter({ frequency: 180, type: "highpass", rolloff: -12 })).connect(clavPeak);
      const clavS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.3, 0.55, 0.2, 0.4, 0.12, 0.25, 0.08, 0.15] },
        filter: { type: "lowpass", rolloff: -12, Q: 1.4 },
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.12, release: 0.06 },
        filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0.2, release: 0.08, baseFrequency: 500, octaves: 3 },
      })).connect(clavHp);
      const clavSafe = I.monotonic(clavG);
      const clavP = pan(clavG, 0.32);
      I.send(ctx, clavP, room, -18);

      const rhodes = I.rhodes(ctx, { volume: -9, tremolo: 4.2, tremoloDepth: 0.22, cutoff: 3200, bark: 1.9 });
      const strings = I.strings(ctx, { volume: -14, attack: 0.7, release: 1.4, cutoff: 1900 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 36, preload: ["kick", "snare", "rim", "hatClosed", "hatOpen", "hatPedal", "tom", "crash", "shaker", "tambourine", "conga", "congaLow"] });
      const rp = I.place(ctx, rhodes, -0.25, out), sp = I.place(ctx, strings, 0.1, out), kp = I.place(ctx, kit, 0.0, out);
      I.send(ctx, rp, room, -12); I.send(ctx, rp, plate, -18); I.send(ctx, sp, plate, -8); I.send(ctx, kp, room, -15);

      return {
        lead: { layer: "melody", play: playLead, humanize: { timing: 0.004, vel: 0.04 } },
        counter: { layer: "melody", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.04 } },
        keys: { layer: "harmony", play: (t, e, d) => rhodes.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        pad: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.015, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bassS.triggerAttackRelease(hz(arr(e.note)[0]), e.ghost ? 0.05 : d, bassSafe(t), e.ghost ? e.vel * 0.6 : e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        clav: { layer: "texture", play: (t, e, d) => clavS.triggerAttackRelease(hz(arr(e.note)[0]), e.ghost ? 0.04 : d, clavSafe(t), e.vel), humanize: { timing: 0.003, vel: 0.08 } },
        drums: { layer: "drums", play: (t, e, d) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.003, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, cl, f, nf, off } = W;
      const S = section(f), NS = section(nf);
      const A = arrange(f, lap, off);
      const prog = S.prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      // this cycle's slice of a section's notes, plus the next section's pickup when this is the last slice
      const inBars = (notes, next) => {
        const own = notes.filter((n) => n.bar >= off && n.bar < off + CB).map((n) => ({ ...n, bar: n.bar - off }));
        const pick = W.lastHalf && next ? next.filter((n) => n.bar === -1).map((n) => ({ ...n, bar: CB - 1, pickup: true })) : [];
        return own.concat(pick).map((n) => ({ ...n, abs: n.bar * BPB + n.beat }));
      };

      // ---------- melody ----------
      const mel = inBars(S.mel, NS.mel);
      if (A.lead || mel.some((n) => n.pickup)) {
        let ornBar = -1;
        mel.forEach((n, i) => {
          if (!A.lead && !n.pickup) return;
          const on = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
          let v = on ? (n.beat % 2 === 0 ? 0.78 : 0.72) : 0.66;
          if (n.dur >= 1.5) v += 0.04;
          if (f.id === "B" && n.note >= 77) v += 0.06;
          if (f.id === "A" && f.prime === 2) v += 0.04;
          if (f.id === "TAG") v -= 0.05;
          if (n.pickup) v -= 0.1;
          const art = n.dur <= 0.5 ? n.dur * 0.85 : n.dur - 0.08;
          const canOrn = A.orn && n.bar !== ornBar && !n.pickup && i < mel.length - 1;
          if (canOrn && n.dur >= 1.5 && r.chance(A.orn)) { ornBar = n.bar; push("lead", n.abs, art, n.note, v, { bend: 1 }); return; }
          if (canOrn && n.dur >= 1 && n.dur < 1.5 && r.chance(A.orn * 0.6)) { // a quick upper-neighbour turn
            ornBar = n.bar;
            const c = T.chord(sym(n.abs));
            const up = T.step(n.note, 1, c.scale);
            push("lead", n.abs, 0.2, n.note, v); push("lead", n.abs + 0.25, 0.2, up, v - 0.1); push("lead", n.abs + 0.5, n.dur - 0.58, n.note, v - 0.03);
            return;
          }
          push("lead", n.abs, art, n.note, v);
        });
      }
      // ---------- strings counter-line (A′), under the tune ----------
      if (A.cnt) inBars(S.cnt).forEach((n) => push("counter", n.abs, n.dur - 0.2, n.note, 0.34 + (n.beat === 0 ? 0.03 : 0)));

      // ---------- Rhodes comp ----------
      function voicer(key, opts) {
        const cache = new Map();
        return (b) => {
          const h = chordAt(b), id = h.bar * BPB + h.beat;
          if (!cache.has(id)) {
            // on the V7♯9 the keys play the shell (3, ♭7, ♯9): the tune supplies the ♭13 and the 5th
            const o = { ...opts, n: /#9/.test(h.chord) ? 3 : opts.n, prev: state[key], rng: r, omitBass: true };
            const v = T.voice(h.chord, o); // a 9 beside the 3rd is the Rhodes sound; T.voice keeps rubs out of the low register
            state[key] = v; cache.set(id, v);
          }
          return cache.get(id);
        };
      }
      // the comp sits under the tune (the lead lives G4–F5): four voices with the top no higher than A4
      const up = voicer("vKeys", { lo: 53, hi: 69, n: 4, top: [62, 69] });
      const low = (b) => { const c = T.chord(sym(b)); const root = T.nearest(47, [c.root], 43, 52); return c.intervals.includes(7) ? [root, root + 7] : [root]; }; // no low tritones
      // the low dyad under the voicing, dropping any upper note within a whole step of a dyad note (no mud)
      const stack = (lo, u) => { const all = [...new Set(lo.concat(u))].sort((a, b) => a - b); return all.filter((n) => lo.includes(n) || !lo.some((m) => Math.abs(m - n) <= 2)); };
      if (A.keys) {
        prog.forEach((h) => {
          const s0 = h.bar * BPB + h.beat;
          const fig = h.dur < 4 && A.keys !== "fermata" ? [[0, "both", Math.min(1.4, h.dur - 0.3), 0.5], [1.5, "up", 0.4, 0.42]] : FIG[A.keys];
          fig.forEach(([o, kind, d, v]) => {
            if (o >= h.dur - 0.01) return;
            const at = s0 + o, dd = Math.min(d, h.dur - o - 0.05);
            const vv = v + r.range(-0.03, 0.03) + (f.id === "A" && f.prime === 2 ? 0.04 : 0);
            push("keys", at, dd, kind === "both" ? stack(low(at), up(at)) : up(at), vv);
          });
        });
      }
      // ---------- strings ----------
      if (A.pad) {
        const vp = voicer("vPad", { lo: 50, hi: 67, n: 4, top: [60, 67] });
        prog.forEach((h) => { const at = h.bar * BPB + h.beat; push("pad", at, h.dur - 0.1, vp(at), A.pad + (f.id === "B" && h.bar + off === 0 ? -0.05 : 0)); });
      }

      // ---------- clavinet ----------
      if (A.clav) {
        prog.forEach((h) => {
          const s0 = h.bar * BPB + h.beat, c = T.chord(h.chord);
          const R = T.nearest(52, [c.root], 48, 57);
          const third = c.intervals.includes(3) ? 3 : 4, seventh = c.intervals.includes(11) ? 11 : 10;
          const deg = { R, O: R + 12, 3: R + third, 5: R + (c.intervals.includes(6) ? 6 : 7), 7: R + seventh, 4: T.step(R + third, 1, c.scale), g: R };
          const riff = h.dur < 4 ? RIFF.short : RIFF[A.clav];
          riff.forEach(([o, d]) => {
            if (o >= h.dur - 0.01) return;
            if (d !== "g" && d !== "R" && r.chance(0.08)) return; // the player drops a note now and then
            push("clav", s0 + o, 0.22, deg[d], 0.62, d === "g" ? { ghost: true } : undefined);
          });
        });
      }

      // ---------- bass ----------
      let last = state.bassLast ?? 43;
      const nextPc = T.chord(NS.prog[0].chord).bass;
      // The note before a root: a half step from the side the line is travelling, a scale step, or the fifth.
      const approach = (from, pc, c) => {
        const t = T.nearest(from, [pc], 36, 48);
        const fifth = T.nearest(from, [mod12(c.root + (c.intervals.includes(6) ? 6 : 7))], 34, 50);
        if (t === from) return fifth !== from ? fifth : from;
        const side = t > from ? [[t - 1, 2], [T.step(t, -1, c.scale), 2]] : [[t + 1, 1.2], [T.step(t, 1, c.scale), 2]];
        const cands = side.concat([[fifth, 1]]).filter(([m]) => m !== from && m !== t && m >= 33 && m <= 50);
        return cands.length ? r.weighted(cands) : t;
      };
      prog.forEach((h, i) => {
        const s0 = h.bar * BPB + h.beat, d = h.dur, c = T.chord(h.chord);
        const nxt = i + 1 < prog.length ? T.chord(prog[i + 1].chord).bass : W.lastHalf ? nextPc : T.chord(S.prog.find((x) => x.bar === off + CB).chord).bass;
        const R = T.nearest(last, [c.bass], 36, 48);
        const deg = { R, O: R + 12 <= 55 ? R + 12 : R, 5: R + (c.intervals.includes(6) ? 6 : 7) - (R >= 43 ? 12 : 0), 7: R + (c.intervals.includes(11) ? 11 : 10) - (R >= 41 ? 12 : 0), g: R };
        const fig = d < 4 ? BASS.short : BASS[A.bass];
        let end = R;
        fig.forEach(([o, kind, dur, v]) => {
          if (o >= d - 0.01) return;
          if (kind === "g") { if (r.chance(0.75)) push("bass", s0 + o, 0.1, R, 0.3, { ghost: true }); return; }
          if (kind === "ap") { end = approach(R, nxt, c); push("bass", s0 + o, dur, end, v); return; }
          push("bass", s0 + o, Math.min(dur, d - o - 0.05), deg[kind], v + r.range(-0.02, 0.02));
        });
        last = Math.max(36, Math.min(48, end));
      });
      state.bassLast = last;

      // ---------- drums ----------
      const D = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = off + i, odd = bar % 2 === 1;
        const st = A.drums;
        if (st === "out") { if (i === 0 && off === 2) { D(B0, "crash", 0.42); D(B0, "kick", 0.7); } continue; }
        const fillBar = A.fill && i === CB - 1;
        const fill = fillBar ? r.weighted(st === "thin" ? [[2, 3], [1, 1]] : [[0, 2], [1, 2], [2, 1], [3, 1]]) : null;
        const cut = fill != null ? FILLS[fill][0][0] : 9;
        const ok = (b) => b < cut;
        const K = (b, v) => { if (ok(b)) D(B0 + b, "kick", v); };
        const SN = (b, v, voice = "snare") => { if (ok(b)) D(B0 + b, voice, v); };
        const GH = (b, p) => { if (ok(b) && r.chance(p)) D(B0 + b, "snare", 0.3, { ghost: true }); };
        if (st === "groove" || st === "deep") {
          for (let q = 0; q < 16; q++) {
            const b = q / 4;
            if (!ok(b)) break;
            const open = odd && q === 15 && st !== "thin";
            if (open) { D(B0 + b, "hatOpen", 0.4); continue; }
            D(B0 + b, "hatClosed", 0.46);
          }
          if (odd) { K(0, 0.86); K(0.75, 0.6); K(2.5, 0.76); if (r.chance(0.6)) K(3.25, 0.5); }
          else { K(0, 0.88); K(1.75, 0.62); K(2.5, 0.78); }
          SN(1, 0.84); SN(3, 0.86);
          GH(0.75, odd ? 0.15 : 0.4); GH(2.25, 0.35); GH(3.5, 0.45); GH(1.5, 0.15);
          if (st === "deep" && A.tamb) [[0.5, 0.2], [1, 0.46], [1.75, 0.18], [2.5, 0.2], [3, 0.46], [3.75, 0.2]].forEach(([b, v]) => { if (ok(b)) D(B0 + b, "tambourine", v); });
          if (A.shaker) for (let q = 0; q < 8; q++) if (ok(q / 2)) D(B0 + q / 2, "shaker", q % 2 ? 0.2 : 0.3);
        }
        if (st === "latin") {
          for (let q = 0; q < 8; q++) if (ok(q / 2)) D(B0 + q / 2, "hatClosed", q % 2 ? 0.3 : 0.42);
          K(0, 0.84); K(2.5, 0.72); if (odd) K(3.5, 0.5);
          SN(1, 0.6, "rim"); SN(3, 0.62, "rim");
          for (let q = 0; q < 16; q++) if (ok(q / 4)) D(B0 + q / 4, "shaker", [0.32, 0.14, 0.22, 0.16][q % 4]);
          [[0, "congaLow", 0.62], [1.5, "conga", 0.5], [1.75, "conga", 0.42, 70], [2.5, "congaLow", 0.56], [3.5, "conga", 0.5], [3.75, "conga", 0.36, 70]].forEach(([b, v, vv, p]) => { if (ok(b)) D(B0 + b, v, vv, p ? { pitch: p } : undefined); });
        }
        if (st === "thin") {
          [1, 3].forEach((b) => { if (ok(b)) D(B0 + b, "hatPedal", 0.4); });
          K(0, 0.8); K(2.5, 0.64); SN(1, 0.58, "rim"); SN(3, 0.6, "rim"); GH(3.5, 0.5);
        }
        if (fill != null) FILLS[fill].forEach(([b, voice, v, pitch]) => D(B0 + b, voice, v, { pitch, fill: true }));
        if (fillBar) ev = G.crescendo(ev, { track: "drums", from: B0 + cut, to: B0 + 4, v0: 0.85, v1: 1.2, curve: 1.3 });
      }
      if (A.crash) D(0, "crash", 0.45);

      // ---------- feel: everything above is on the grid; Sim.groove moves it ----------
      const inB = f.id === "B", lift = f.id === "A" && f.prime === 2;
      ev = G.ghosts(ev, { track: "drums", vel: 0.24, dur: 0.08 });
      ev = G.ghosts(ev, { track: "clav", vel: 0.26, dur: 0.06 });
      ev = G.accents(ev, { track: "counter", pattern: [1, 0.9], unit: 2 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: {
            snare: { template: "laidback", amount: inB ? 1.35 : lift ? 0.9 : 1.1 }, rim: { template: "laidback", amount: 1.2 },
            hatClosed: "pushed", hatOpen: "pushed", hatPedal: "pushed", tambourine: { template: "pushed", amount: 0.8 },
            shaker: { template: "mpc58", late: -4 }, conga: "clave", congaLow: "clave", kick: "straight", tom: { template: "mpc54" }, crash: "straight",
          } },
          bass: { template: "funk16", late: inB ? 7 : 3, amount: A.bass === "half" ? 0.7 : 1 },
          keys: { template: "mpc58", late: inB ? 16 : 10, vels: false },
          counter: { template: "straight", late: 20 },
          clav: { template: "funk16", late: -4 },
          pad: { template: "straight", late: 25 },
        },
      });
      if (A.rub) ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: A.rub, linger: inB ? "both" : "high", lingerMs: inB ? 70 : 50, rng: r });

      // the fermata: the tag's last chord rings a beat and a half into the next lap, then half a beat of silence, then the pocket
      if (f.id === "TAG" && off === 2) ev = G.hold(ev, { bar: 1, beat: 0, extra: 1.5, tracks: ["keys", "lead", "bass"] });
      if (f.id === "intro" && off === 0 && lap > 0) ev = G.breath(ev, 2, { bpb: BPB, cycleBars: CB });

      return { events: ev, harmony: prog, section: label(f, lap, off), state, tempo: tempoAt(cl) };
    },
  });
})();
