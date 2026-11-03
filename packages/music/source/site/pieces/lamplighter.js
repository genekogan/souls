// Lamplighter: a city theme for the hour the streetlights come on. A♭ major, 104 bpm.
//
// The city seen from a hill at half past five: offices emptying, lamps flickering on one block at a
// time, hopeful and a little wistful. Not the sunny morning of Pixel Town: the light is lower, the
// harmony moves more, and the band is small and particular (a chorused FM marimba, a nasal lead
// whose vibrato arrives late, a plucky synth bass, a bit-crushed echo).
//
// THE TUNE (fixed by hand before any code; the generator never regenerates it, only dresses it)
//   Motif  = three notes in a 3+3+2 rhythm (dotted, dotted, quarter): C5 E♭5 A♭5 (+3 +5).
//   A (8 bars, A♭):           | A♭maj9 | Gm7♭5 C7♭9 | Fm9 | E♭m7 A♭7 | D♭maj9 | D♭m6 | A♭/E♭ F7♭9 | B♭m7 E♭7 |
//     bar 1  C  E♭ A♭         the motif on I
//     bar 2  G  F  D♭ . C     the odd turn: a drop of a major third onto the ♭9 of C7
//     bar 3  A♭ C  F          the motif on vi (starts where bar 1's pickup note sat)
//     bar 4  G♭ E♭ C E♭ G♭    dusk colour: ii–V of IV, the key's ♭7 in the tune
//     bar 5  F  A♭ D♭         the motif on IV, an exact transposition, the melodic peak
//     bar 6  B♭ A♭ F♭         the sigh over borrowed iv (D♭m6); F♭ resolves to E♭ in bar 7
//     bar 7  E♭ . C A C E♭ G♭ an F7♭9 arpeggio run up to the cadence
//     bar 8  F E♭ D♭ B♭ (A♭ B♭)  ii–V, pickup back to C; the second time it hangs on B♭ and the
//                               cadence is deceptive: B♭m7 E♭7 lands on Fm9 (B begins in the relative minor)
//   Counter (a second voice in half notes, mostly contrary): G F | F E | F E♭ | D♭ C | F A♭ | F♭ A♭ | A♭ E♭ | D♭ G
//   B (8 bars, F minor):      | Fm9 | Fm7/E♭ | D♭maj7♯11 | C7♭9♭13 | Fm9 | B♭m9 | D♭maj7 | C7sus4 C7♭9 |
//     the motif inverted (A♭ F C) and displaced one beat late across the bar line; in bar 5 it lands back
//     on the downbeat, bar 6 has the upright motif on iv, bar 4 and bar 8 answer A's arpeggio run.
//   Bridge (8 bars, modulating): | Fm9 | B♭13 | Gm9 | C13 | E♭maj9 | E♭m6 | Cm9 | F13sus4 F7♭9 |
//     the motif's own notes (C E♭ A♭) reharmonised over Fm9, sequenced up a step over Gm9–C13, then
//     C13 overshoots into E♭maj9 (the city grows a district), IV→iv again in the new key, ii–V into B♭.
//   A″ = A a whole step up in B♭ (the lift), cadencing properly this time.
//   Tag (4 bars): | B♭maj9 | B♭m7 E♭7 | A♭maj9 | D♭/A♭ |  the motif, its inversion, and B♭ slipping home
//     through its parallel minor; the vibes play the inverted motif as a tail.
//   One lap: intro 4 · A 8 · A′ 8 · B 8 · bridge 8 · A″ 8 · tag 4 = 48 bars ≈ 1:51. Laps alternate
//   orchestration (who sings, who answers, comp figure, drum weight); rng chooses fills, voicings, ornaments.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4, CB = 4;
  const mod12 = T.mod12;

  // ---------- notation ----------
  /** Bars of "Note beat dur, ..." (null = empty bar) -> [{bar, beat, dur, note}], transposed by k. */
  function phrase(bars, k = 0) {
    const out = [];
    bars.forEach((txt, bar) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => {
        const [n, b, d] = tok.trim().split(/\s+/);
        out.push({ bar, beat: +b, dur: +d, note: T.midi(n) + k });
      });
    });
    return out;
  }
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  /** Transpose one bar's chord text ("Gm7b5 C7b9", "C7sus4:1.5 C7b9:2.5", "Ab/Eb") by k semitones. */
  function trBar(text, k) {
    if (!k) return text;
    return text.split(/\s+/).map((tok) => {
      const [s, d] = tok.split(":");
      const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(s);
      const nm = (x) => FLAT[mod12(T.PC[x] + k)];
      const sym = nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
      return d ? `${sym}:${d}` : sym;
    }).join(" ");
  }

  // ---------- the score ----------
  const A_CH = ["Abmaj9", "Gm7b5 C7b9", "Fm9", "Ebm7 Ab7", "Dbmaj9", "Dbm6", "Ab/Eb F7b9", "Bbm7 Eb7"];
  const A_MEL = [
    "C5 0 1.5, Eb5 1.5 1.5, Ab5 3 1",
    "G5 0 1.5, F5 1.5 .5, Db5 2 1.5, C5 3.5 .5",
    "Ab4 0 1.5, C5 1.5 1.5, F5 3 1",
    "Gb5 0 1.5, Eb5 1.5 .5, C5 2 1, Eb5 3 .5, Gb5 3.5 .5",
    "F5 0 1.5, Ab5 1.5 1.5, Db6 3 1",
    "Bb5 0 1.5, Ab5 1.5 1.5, E5 3 1",
    "Eb5 0 1.5, C5 1.5 .5, A4 2 .5, C5 2.5 .5, Eb5 3 .5, Gb5 3.5 .5",
  ];
  const A_END = {
    toA: "F5 0 1, Eb5 1 .5, Db5 1.5 .5, Bb4 2 1, Ab4 3 .5, Bb4 3.5 .5",
    toB: "F5 0 1, Eb5 1 .5, Db5 1.5 .5, Bb4 2 2",
  };
  const A_CNT = ["G4 0 3, F4 3 1", "F4 0 2, E4 2 2", "F4 0 2, Eb4 2 2", "Db4 0 2, C4 2 2", "F4 0 2, Ab4 2 2", "E4 0 2, Ab4 2 2", "Ab4 0 2, Eb4 2 2", "Db4 0 2, G4 2 1"];

  const B_CH = ["Fm9", "Fm7/Eb", "Dbmaj7#11", "C7b9b13", "Fm9", "Bbm9", "Dbmaj7", "C7sus4:1.5 C7b9:2.5"];
  const B_MEL = [
    "Ab5 1 1.5, F5 2.5 1.5",
    "C5 0 1, Eb5 1 .5, F5 1.5 .5, G5 2 2",
    "F5 1 1.5, Db5 2.5 1.5",
    "Ab4 0 1, G4 1 .5, Bb4 1.5 .5, Db5 2 1, E5 3 .5, G5 3.5 .5",
    "Ab5 0 1.5, F5 1.5 1.5, C5 3 1",
    "Db5 0 1.5, F5 1.5 1.5, Bb5 3 1",
    "Ab5 0 1.5, F5 1.5 .5, Eb5 2 .5, Db5 2.5 1.5",
    "F5 0 1.5, E5 1.5 1.5, Db5 3 .5, Bb4 3.5 .5",
  ];
  const B_CNT = [null, "Eb5 2 .5, C5 2.5 .5, Ab4 3 1", null, null, "Eb4 0 2, G4 2 2", "F4 0 2, Ab4 2 2", "Ab4 0 2, F4 2 2", "G4 0 2, E4 2 1.5"];

  const BR_CH = ["Fm9", "Bb13", "Gm9", "C13", "Ebmaj9", "Ebm6", "Cm9", "F13sus4 F7b9"];
  const BR_MEL = [
    "C5 0 1.5, Eb5 1.5 1.5, Ab5 3 1",
    "G5 0 2, F5 2 1, D5 3 1",
    "D5 0 1.5, F5 1.5 1.5, Bb5 3 1",
    "A5 0 2, G5 2 1, E5 3 1",
    "F5 0 1.5, G5 1.5 1.5, Bb5 3 1",
    "Gb5 0 2, F5 2 1, C5 3 1",
    "D5 0 1, Eb5 1 1, G5 2 1, Bb5 3 1",
    "C6 0 2, A5 2 1, Gb5 3 .5, F5 3.5 .5",
  ];
  const BR_CNT = ["Eb4 0 2, Ab4 2 2", "D4 0 2, Ab4 2 2", "G4 0 2, F4 2 2", "E4 0 2, Bb4 2 2", "Bb4 0 2, D5 2 2", "Bb4 0 2, Eb4 2 2", "G4 0 2, Bb4 2 2", "Eb5 0 2, A4 2 1"];

  const TAG_CH = ["Bbmaj9", "Bbm7 Eb7", "Abmaj9", "Dbmaj7/Ab"];
  const TAG_MEL = ["D5 0 1.5, F5 1.5 1.5, Bb5 3 1", "Ab5 0 1.5, F5 1.5 1.5, Db5 3 1", "C5 0 3", null];
  const TAG_CNT = ["F4 0 2, A4 2 2", "Ab4 0 2, G4 2 2", "Eb4 0 2, G4 2 2", "Eb5 0 1.5, C5 1.5 1.5, Ab4 3 1"];

  const INTRO_CH = ["Abmaj9", "Fm9", "Dbmaj9", "Bbm7 Eb7"];
  const INTRO_MEL = [null, null, null, "Ab4 3 .5, Bb4 3.5 .5"];
  const INTRO_CNT = [null, null, "F5 0 1.5, Ab5 1.5 1.5, Db6 3 1", null]; // the peak statement, previewed

  // One lap. prime: 0 = A, 1 = A′ (deceptive into B), 2 = A″ (in B♭).
  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, end: "toA", prime: 0 },
    { id: "A", bars: 8, end: "toB", prime: 1 },
    { id: "B", bars: 8 },
    { id: "BR", bars: 8 },
    { id: "A", bars: 8, end: "toA", prime: 2, key: 2 },
    { id: "TAG", bars: 4 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;

  const secCache = new Map();
  function section(f) {
    const key = f.id + (f.end || "") + (f.key || 0);
    if (secCache.has(key)) return secCache.get(key);
    const k = f.key || 0;
    let s;
    if (f.id === "intro") s = { ch: INTRO_CH, mel: phrase(INTRO_MEL), cnt: phrase(INTRO_CNT) };
    else if (f.id === "B") s = { ch: B_CH, mel: phrase(B_MEL), cnt: phrase(B_CNT) };
    else if (f.id === "BR") s = { ch: BR_CH, mel: phrase(BR_MEL), cnt: phrase(BR_CNT) };
    else if (f.id === "TAG") s = { ch: TAG_CH, mel: phrase(TAG_MEL), cnt: phrase(TAG_CNT) };
    else s = { ch: A_CH.map((x) => trBar(x, k)), mel: phrase(A_MEL.concat([A_END[f.end]]), k), cnt: phrase(A_CNT, k) };
    s.key = f.id === "B" || f.id === "BR" ? 0 : f.id === "TAG" ? 0 : k; // tonic offset from A♭ (for diatonic ornaments)
    s.prog = T.progression("| " + s.ch.join(" | ") + " |", BPB);
    secCache.set(key, s);
    return s;
  }
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, i, f, nf, off: bar, half: bar / CB, lastHalf: bar + CB >= f.bars, nextLap: i + 1 >= LAP.length ? lap + 1 : lap };
  }

  // ---------- arrangement ----------
  // mel/cnt: who plays the tune / the counter-line. comp: the marimba figure. bass/drums: styles.
  function arrange(f, lap, half) {
    const L = lap % 4;
    const base = { mel: "lead", cnt: "vibe", comp: "lift", bass: "bounce", drums: "light", pad: 0, bells: null, tamb: false, orn: lap > 0, fill: false, crash: false, tri: false };
    if (f.id === "intro") return { ...base, cnt: L % 2 ? "bells" : "vibe", comp: lap === 0 ? "sparse" : L === 2 ? "ripple" : "lift", bass: lap === 0 ? "enter" : "bounce", drums: lap === 0 ? "intro" : "light", fill: true };
    if (f.id === "A" && f.prime === 0) return { ...base, mel: L === 1 ? "vibe" : "lead", cnt: L === 1 ? "lead" : L === 3 ? "vibe" : null, comp: L === 2 ? "ripple" : "lift", drums: L >= 2 ? "groove" : "light", fill: half === 1 && L >= 2 };
    if (f.id === "A" && f.prime === 1) return { ...base, comp: L === 2 ? "lift" : "ripple", drums: "groove", bells: L % 2 ? "motif" : null, fill: half === 1 };
    if (f.id === "B") return { ...base, mel: L === 3 ? "vibe" : "lead", cnt: L === 3 ? "lead" : "vibe", comp: "broken", bass: "walk", drums: "commute", fill: half === 1 };
    if (f.id === "BR") return { ...base, comp: "pushed", bass: half === 0 ? "half" : "bounce", pad: half === 0 ? 0.26 : 0.32, drums: half === 0 ? "halftime" : "build" };
    if (f.id === "A") return { ...base, comp: L % 2 ? "lift" : "ripple", pad: 0.24, bells: "long", tamb: true, drums: "full", crash: half === 0, fill: half === 1 };
    return { ...base, comp: "sparse", bass: "long", pad: 0.2, drums: "thin", tri: true, fill: lap % 2 === 1 };
  }
  function label(f, lap, half) {
    const n = `Lap ${lap + 1} · `;
    if (f.id === "intro") return n + "intro · the marimba sets the pulse";
    if (f.id === "B") return n + `B · F minor · the motif inverted${half ? ", back on the downbeat" : ", a beat late"}`;
    if (f.id === "BR") return n + (half ? "bridge · C13 overshoots into E♭ · ii–V into B♭" : "bridge · the motif reharmonised, sequenced up a step");
    if (f.id === "TAG") return n + "tag · B♭ slips home through B♭m7–E♭7";
    if (f.prime === 0) return n + `A · the tune in A♭ · ${half ? "the motif climbs to IV, borrowed iv" : "motif on I, the ♭9 turn, motif on vi"}`;
    if (f.prime === 1) return n + `A′ · counter-line${half ? " · deceptive cadence into F minor" : ""}`;
    return n + `A″ · chorus in B♭ · tambourine${half ? " · home" : ""}`;
  }

  // comp figures: [offset within the chord span, kind, dur, vel]
  const FIG = {
    lift: [[0, "low", 0.9, 0.5], [1, "up", 0.4, 0.42], [1.5, "up", 0.3, 0.34], [2.5, "low", 0.9, 0.46], [3, "up", 0.4, 0.4]],
    ripple: [[0, "low", 1.2, 0.48], [1, "arpUp", 0.3, 0.36], [2.5, "low", 0.9, 0.44], [3, "arpDn", 0.3, 0.34]],
    pushed: [[0, "both", 1.4, 0.48], [1.5, "up", 1.3, 0.42], [3, "up", 0.9, 0.4]],
    sparse: [[0, "roll", 2.4, 0.4], [2.5, "up", 0.5, 0.28]],
  };
  const FILLS = [
    [[2, "snare", 0.5], [2.5, "snare", 0.55], [3, "tom", 0.6, 50], [3.5, "tom", 0.65, 45]],
    [[2.5, "snare", 0.45], [2.75, "snare", 0.5], [3, "snare", 0.55], [3.5, "tom", 0.6, 45]],
    [[2, "tom", 0.5, 50], [2.5, "snare", 0.5], [3, "tom", 0.55, 45], [3.5, "tom", 0.6, 40]],
    [[2.5, "rim", 0.4], [3, "rim", 0.45], [3.5, "hatOpen", 0.4]],
    [[3, "snare", 0.4], [3.25, "snare", 0.45], [3.5, "snare", 0.5], [3.75, "snare", 0.55]],
  ];

  Sim.register({
    id: "lamplighter",
    title: "Lamplighter",
    genre: "City theme",
    about: "A city theme in A♭ for the hour the streetlights come on: a hand-written 3+3+2 motif that climbs I–vi–IV over secondary dominants and a borrowed iv, a counter-line in the vibes, an F-minor B with the motif inverted and displaced, a rising ii–V bridge that overshoots into B♭ for the chorus, and a tag that slips home. Chorused FM marimba, a nasal lead with late vibrato, plucky synth bass, brushed kit, shaker, woodblock and tambourine, through a bit-crushed echo.",
    situations: ["work", "hangout", "explore"],
    energy: 0.5,
    bpm: 104, beatsPerBar: BPB, swing: 0.54, swingUnit: 0.25, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const G = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };

      const room = I.reverb(ctx, out, { decay: 1.9, preDelay: 0.014, lowcut: 280, highcut: 6500 });
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.03, lowcut: 350, highcut: 5500 });
      // The echo: an 8th-note feedback delay through a bit crusher and a dark low-pass, the SPC's own grain.
      const echoLp = ctx.keep(new Tone.Filter({ frequency: 2400, type: "lowpass", rolloff: -12 })).connect(out);
      const crush = ctx.keep(new Tone.BitCrusher(9)).connect(echoLp);
      const echo = ctx.keep(new Tone.FeedbackDelay({ delayTime: "8n", maxDelay: 2, feedback: 0.3, wet: 1 })).connect(crush);

      // Custom voices are trimmed so a note at vel 0.8 sits near the library's calibration, then offset for the mix.
      /** Chorused FM mallet: sine carrier, fast-decaying modulator at a near-integer ratio for the woody overtone. */
      function mallet(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12 })).connect(g);
        let dest = lp;
        if (o.tremolo) { const tr = ctx.keep(new Tone.Tremolo({ frequency: o.tremolo, depth: 0.3, spread: 60 }).start()); tr.connect(lp); dest = tr; }
        const ch = ctx.keep(new Tone.Chorus({ frequency: o.chorusRate, delayTime: 3.2, depth: 0.55, spread: 100, wet: 0.45 }).start());
        ch.connect(dest);
        const s = ctx.keep(new Tone.PolySynth({
          voice: Tone.FMSynth, maxPolyphony: 16,
          options: {
            harmonicity: o.ratio, modulationIndex: o.index,
            oscillator: { type: "sine" }, modulation: { type: "sine" },
            envelope: { attack: 0.002, decay: o.decay, sustain: 0, release: o.decay * 0.5 },
            modulationEnvelope: { attack: 0.001, decay: o.modDecay, sustain: 0, release: 0.05 },
          },
        })).connect(ch);
        return { out: g, play: (t, notes, d, v) => s.triggerAttackRelease(arr(notes).map(hz), Math.min(d, o.decay), t, v) };
      }
      const marimba = mallet({ volume: 1, cutoff: 5200, chorusRate: 0.8, ratio: 3.98, index: 2.6, decay: 0.75, modDecay: 0.09 });
      const vibe = mallet({ volume: -2, cutoff: 4200, chorusRate: 0.5, ratio: 3.01, index: 1.4, decay: 2.2, modDecay: 0.2, tremolo: 4.3 });
      const mp = pan(marimba.out, 0.28), vp = pan(vibe.out, -0.3);
      I.send(ctx, mp, room, -13); I.send(ctx, mp, echo, -20); I.send(ctx, vp, room, -10); I.send(ctx, vp, echo, -15);

      /** Nasal lead: a reedy spectrum through a formant peak, slow-ish attack, vibrato that arrives after the note has settled. */
      function nasalLead(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12, Q: 0.6 })).connect(g);
        const formant = ctx.keep(new Tone.Filter({ frequency: 1350, type: "peaking", Q: 1.4, gain: 7 })).connect(lp);
        const s = ctx.keep(new Tone.MonoSynth({
          portamento: 0.018,
          oscillator: { type: "custom", partials: [0.5, 1, 0.85, 0.9, 0.6, 0.42, 0.3, 0.22, 0.14, 0.09, 0.05] },
          filter: { type: "lowpass", rolloff: -12, Q: 1 },
          envelope: { attack: 0.028, decay: 0.18, sustain: 0.82, release: 0.14 },
          filterEnvelope: { attack: 0.03, decay: 0.3, sustain: 0.55, release: 0.2, baseFrequency: 650, octaves: 1.9 },
        })).connect(formant);
        const lfo = ctx.keep(new Tone.LFO({ frequency: o.rate, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0)); // cents
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const tt = safe(t), f = hz(e.note);
            if (e.bend) { s.triggerAttackRelease(hz(e.note - e.bend), d, tt, e.vel); s.frequency.exponentialRampToValueAtTime(f, tt + 0.09); }
            else s.triggerAttackRelease(f, d, tt, e.vel);
            const p = depth.gain;
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > o.vibDelay + 0.15) { p.setValueAtTime(0, tt + o.vibDelay); p.linearRampToValueAtTime(o.vibCents, tt + o.vibDelay + 0.35); }
          },
        };
      }
      const lead = nasalLead({ volume: -12, cutoff: 3600, rate: 5.4, vibDelay: 0.24, vibCents: 20 });
      const lp = pan(lead.out, -0.06);
      I.send(ctx, lp, room, -12); I.send(ctx, lp, echo, -13);

      /** Plucky synth bass: a rolled-off saw with a short filter envelope, so it reads as a pick, not a pad. */
      const bassG = G(-14);
      bassG.connect(out);
      const bassLp = ctx.keep(new Tone.Filter({ frequency: 1400, type: "lowpass", rolloff: -12 })).connect(bassG);
      const bassS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.5, 0.3, 0.18, 0.1, 0.06, 0.03] },
        filter: { type: "lowpass", rolloff: -24, Q: 1.2 },
        envelope: { attack: 0.004, decay: 0.22, sustain: 0.45, release: 0.08 },
        filterEnvelope: { attack: 0.003, decay: 0.16, sustain: 0.2, release: 0.1, baseFrequency: 110, octaves: 3.2 },
      })).connect(bassLp);
      const bassSafe = I.monotonic(bassG);
      I.send(ctx, bassG, room, -26);

      // Stock colours for support: strings pad, glockenspiel, kit.
      const strings = I.strings(ctx, { volume: -12, attack: 0.5, release: 1.2, cutoff: 2100 });
      const glock = I.glock(ctx, { volume: -12, decay: 1.8 });
      const kit = I.kit(ctx, { volume: 0, kickNote: 33, preload: ["softKick", "rim", "snare", "hatClosed", "hatOpen", "shaker", "woodblock", "tambourine", "tom", "crash", "triangle"] });
      const sp = I.place(ctx, strings, 0.05, out), gp = I.place(ctx, glock, 0.42, out), kp = I.place(ctx, kit, 0.04, out);
      I.send(ctx, sp, hall, -9); I.send(ctx, gp, echo, -11); I.send(ctx, gp, hall, -12); I.send(ctx, kp, room, -16);

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        vibeMel: { layer: "melody", play: (t, e, d) => vibe.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        bells: { layer: "melody", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        vibe: { layer: "harmony", play: (t, e, d) => vibe.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        leadCnt: { layer: "harmony", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        comp: { layer: "harmony", play: (t, e, d) => marimba.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.07 } },
        pad: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.015, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => bassS.triggerAttackRelease(hz(arr(e.note)[0]), d, bassSafe(t), e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, nf, off, half } = W;
      const S = section(f), NS = section(nf);
      const A = arrange(f, lap, half);
      const nextA = arrange(nf, W.nextLap, 0);
      // this cycle's slice of the section
      const prog = S.prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const spanEnd = (b) => { const h = chordAt(b); return h.bar * BPB + h.beat + h.dur; };
      const keyScale = T.scale(mod12(8 + S.key), f.id === "B" ? "aeolian" : "ionian");
      const ev = [];
      const hasRub = (v) => v.slice().sort((a, b) => a - b).some((n, i, a) => i && n - a[i - 1] === 1);
      const uniq = (v) => [...new Set(v)].sort((a, b) => a - b);
      // the low dyad and the upper voicing as one chord, dropping an upper note a semitone from the dyad
      const stack = (lo, up) => { const all = uniq(lo.concat(up)); return all.filter((n) => lo.includes(n) || !lo.some((m) => Math.abs(m - n) === 1)); };
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const inBars = (notes) => notes.filter((n) => n.bar >= off && n.bar < off + CB).map((n) => ({ ...n, bar: n.bar - off, abs: (n.bar - off) * BPB + n.beat }));

      // ---------- melody ----------
      const MEL_TRACK = { lead: "lead", vibe: "vibeMel" };
      const mel = inBars(S.mel);
      const isPickup = (n) => W.lastHalf && n.bar === CB - 1 && n.beat >= 3 && n.dur <= 0.5;
      const velOf = (n) => {
        const on = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
        let v = on ? (n.beat % 2 === 0 ? 0.76 : 0.7) : 0.63;
        if (n.dur >= 1.5) v += 0.05;
        if (f.id === "A" && f.prime === 2) v += 0.04; // the chorus leans in
        if (f.id === "TAG" || f.id === "intro") v -= 0.06;
        return v;
      };
      const ornP = A.orn ? Math.min(0.22, 0.1 + 0.03 * Math.min(lap, 4)) : 0;
      let ornBar = -1;
      mel.forEach((n, i) => {
        const pickup = isPickup(n);
        const track = MEL_TRACK[pickup ? nextA.mel : A.mel];
        const v = velOf(n);
        const art = n.dur <= 0.5 ? n.dur * 0.82 : n.dur - 0.07;
        const canOrn = ornP && track === "lead" && n.bar !== ornBar && i < mel.length - 1;
        // a scoop into a long note, or a quick upper-neighbour mordent on a one-beat note
        if (canOrn && n.dur >= 1.5 && r.chance(ornP)) { ornBar = n.bar; push(track, n.abs, art, n.note, v, { bend: 1 }); return; }
        if (canOrn && n.dur >= 1 && n.dur < 1.5 && r.chance(ornP * 0.7)) {
          ornBar = n.bar;
          const c = T.chord(sym(n.abs));
          const k = T.step(n.note, 1, keyScale.includes(mod12(n.note)) ? keyScale : c.scale);
          const rub = !c.pcs.includes(mod12(k)) && c.pcs.some((p) => mod12(k - p) === 1 || mod12(p - k) === 1);
          const up = rub ? T.step(n.note, 1, c.scale) : k;
          push(track, n.abs, 0.2, n.note, v); push(track, n.abs + 0.25, 0.2, up, v - 0.08); push(track, n.abs + 0.5, n.dur - 0.57, n.note, v - 0.03);
          return;
        }
        push(track, n.abs, art, n.note, pickup ? v - 0.1 : v);
      });

      // ---------- counter-line ----------
      const cnt = inBars(S.cnt);
      if (A.cnt) {
        const track = A.cnt === "lead" ? "leadCnt" : A.cnt === "bells" ? "bells" : "vibe";
        const octave = A.cnt === "bells" ? 12 : 0;
        cnt.forEach((n) => {
          const long = n.dur >= 2;
          const vel = (A.cnt === "lead" ? 0.42 : A.cnt === "bells" ? 0.32 : f.id === "intro" ? 0.4 : 0.44) + (n.beat === 0 ? 0.03 : 0);
          // vibes re-strike a held half note on its last 8th every so often: a little breath in the line
          if (track === "vibe" && long && r.chance(0.3)) { push(track, n.abs, n.dur - 0.6, n.note, vel); push(track, n.abs + n.dur - 0.5, 0.45, n.note, vel - 0.12); }
          else push(track, n.abs, n.dur - (A.cnt === "lead" ? 0.1 : 0.05), n.note + octave, vel);
        });
      }
      // bells: the motif's long notes an octave up (chorus), or the motif's first bar only (A′ on odd laps)
      if (A.bells === "long") mel.filter((n) => n.dur >= 1.5 && !isPickup(n)).forEach((n) => push("bells", n.abs, 1.6, n.note + 12, 0.3));
      if (A.bells === "motif") mel.filter((n) => (n.bar + off) % 4 === 0 && n.dur >= 1).forEach((n) => push("bells", n.abs, Math.min(1.4, n.dur), n.note + 12, 0.28));

      // ---------- marimba comp ----------
      function voicer(key, opts) {
        const cache = new Map();
        return (b) => {
          const h = chordAt(b), id = h.bar * BPB + h.beat;
          if (!cache.has(id)) {
            const o = { ...opts, prev: state[key], rng: r, omitBass: true };
            let v = T.voice(h.chord, o);
            // a 9th or 6th sitting a semitone from a chord tone is a cluster on mallets: retry without the colours
            if (hasRub(v)) {
              const c = T.chord(h.chord);
              for (const alt of [{ ...c, colors: [] }, { ...c, colors: [], guide: c.guide.slice(0, 1), pcs: c.pcs.filter((x) => x !== c.guide[1]) }]) { const v2 = T.voice(alt, o); if (!hasRub(v2)) { v = v2; break; } }
            }
            state[key] = v; cache.set(id, v);
          }
          return cache.get(id);
        };
      }
      const up = voicer("vComp", { lo: 62, hi: 74, n: 3, top: [66, 74] });
      const low = (b) => { // root and fifth (or ♭7 over a diminished fifth), E3–E4
        const c = T.chord(sym(b));
        const root = T.nearest(57, [c.root], 52, 63);
        return [root, root + (c.intervals.includes(7) ? 7 : 10)];
      };
      if (A.comp) {
        prog.forEach((h) => {
          const s0 = h.bar * BPB + h.beat;
          if (A.comp === "broken") {
            // 8th-note broken chord: low root, upper voices, low fifth, upper voices
            const u = up(s0).slice().sort((a, b) => a - b), l = low(s0);
            const seq = [l[0], u[0], u[1], u[2], l[1], u[1], u[0], u[2]];
            for (let k = 0; k < h.dur * 2 && k < 8; k++) push("comp", s0 + k / 2, 0.42, seq[k], (k % 2 ? 0.34 : 0.42) + (k === 0 ? 0.08 : 0) + r.range(-0.02, 0.02));
            return;
          }
          if (A.bass === "enter" && h.bar < 2 && A.comp === "sparse") { // first bars of the first lap: a roll alone
            const notes = stack(low(s0), up(s0));
            notes.forEach((n, k) => push("comp", s0 + k * 0.25, 2.4 - k * 0.2, n, 0.42 - 0.03 * k));
            return;
          }
          FIG[A.comp].forEach(([o, kind, d, v]) => {
            if (o >= h.dur - 0.01) return;
            const at = s0 + o, dd = Math.min(d, h.dur - o - 0.05);
            const vv = v + r.range(-0.03, 0.03);
            if (kind === "low") push("comp", at, dd, low(at), vv);
            else if (kind === "up") push("comp", at, dd, up(at), vv);
            else if (kind === "both") push("comp", at, dd, stack(low(at), up(at)), vv);
            else if (kind === "arpUp" || kind === "arpDn") {
              const u = up(at).slice().sort((a, b) => a - b); if (kind === "arpDn") u.reverse();
              u.forEach((n, k) => push("comp", at + k * 0.25, 0.35, n, vv - 0.02 * k));
            } else if (kind === "roll") {
              const notes = stack(low(at), up(at));
              notes.forEach((n, k) => push("comp", at + k * 0.25, dd - k * 0.2, n, vv - 0.03 * k));
            }
          });
        });
      }

      // ---------- strings pad ----------
      if (A.pad) {
        const vp = voicer("vPad", { lo: 55, hi: 72, n: 4, top: [64, 72] });
        prog.forEach((h, i) => {
          const at = h.bar * BPB + h.beat;
          const swell = f.id === "BR" ? 1 + 0.08 * (h.bar + off) / 8 : 1;
          push("pad", at, h.dur - 0.1, vp(at), A.pad * swell + (i === 0 && half === 0 ? -0.04 : 0));
        });
      }

      // ---------- bass ----------
      let last = state.bassLast ?? 44;
      const nextPc = T.chord(NS.prog[0].chord).bass;
      // The note before a root: a half step from the side the line is already travelling, or the fifth.
      // Into the same root again, the fifth (or nothing new).
      const approach = (from, pc, c) => {
        const t = T.nearest(from, [pc], 38, 50);
        const fifth = T.nearest(t, [mod12(c.root + (c.intervals.includes(6) ? 6 : 7))], 38, 52); // the fifth nearest the target
        if (t === from) return fifth !== from ? fifth : from;
        // under sustained strings the chromatic leading tone rubs the held chord, so the line goes by scale step
        const chrom = A.pad ? 0.4 : 3;
        const below = [[t - 1, chrom], [T.step(t, -1, c.scale), 1.2]], above = [[t + 1, chrom], [T.step(t, 1, c.scale), 1.2]];
        const side = t > from ? below.concat(above.map(([m, w]) => [m, w / 5])) : above.concat(below.map(([m, w]) => [m, w / 5]));
        const cands = side.concat([[fifth, 1.2]]).filter(([m]) => m !== from && m !== t && m >= 36 && m <= 52);
        return cands.length ? r.weighted(cands) : t;
      };
      prog.forEach((h, i) => {
        const s = h.bar * BPB + h.beat, d = h.dur, c = T.chord(h.chord);
        const nxt = i + 1 < prog.length ? T.chord(prog[i + 1].chord).bass : W.lastHalf ? nextPc : T.chord(S.prog.find((x) => x.bar === off + CB).chord).bass;
        const R = T.nearest(last, [c.bass], 38, 50);
        const fifthPc = mod12(c.bass + (c.bass === c.root ? (c.intervals.includes(6) ? 6 : 7) : 7));
        const F5 = R >= 45 ? T.nearest(R - 5, [fifthPc], 34, 52) : T.nearest(R + 7, [fifthPc], 34, 52);
        const oct = R + 12 <= 56 ? R + 12 : R - 12;
        const add = (b, n, dur, v) => push("bass", s + b, dur, n, v);
        let end = R;
        let style = A.bass;
        if (style === "enter") { if (h.bar < 2) return; style = "bounce"; }
        if (style === "bounce") { // root, a short repeat, root with the kick on the and of 3, approach
          if (d >= 4) {
            add(0, R, 1.3, 0.8); add(1.5, r.chance(0.3) ? oct : R, 0.4, 0.5); add(2.5, R, 0.85, 0.7);
            end = approach(R, nxt, c); add(3.5, end, 0.42, 0.58);
          } else if (d >= 2) { add(0, R, 1.3, 0.78); end = approach(R, nxt, c); add(1.5, end, 0.42, 0.56); }
          else add(0, R, d - 0.1, 0.76);
        } else if (style === "walk") { // quarters: root, fifth or octave, root or third, approach
          if (d >= 4) {
            const third = T.nearest(R + 3, [mod12(c.root + (c.intervals.includes(3) ? 3 : 4))], 36, 54);
            add(0, R, 0.9, 0.8); add(1, r.chance(0.5) ? F5 : oct, 0.9, 0.62); add(2, r.chance(0.4) ? third : R, 0.9, 0.7);
            end = approach(R, nxt, c); add(3, end, 0.9, 0.6);
          } else if (d >= 2) { add(0, R, 0.9, 0.78); end = approach(R, nxt, c); add(1, end, 0.9, 0.58); }
          else add(0, R, d - 0.1, 0.76);
        } else if (style === "half") {
          add(0, R, 2.4, 0.78);
          if (d >= 4) { add(2.5, F5, 0.9, 0.6); end = approach(F5, nxt, c); add(3.5, end, 0.42, 0.56); }
        } else { // long
          add(0, R, d - 0.15, 0.74);
          if (d >= 4 && h.bar + off === 1 && r.chance(0.6)) { end = approach(R, nxt, c); add(3.5, end, 0.42, 0.5); }
        }
        last = Math.max(36, Math.min(52, end));
      });
      state.bassLast = last;

      // ---------- drums ----------
      const D = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      const SHK = [0.3, 0.13, 0.21, 0.15];
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB, bar = off + i, fillBar = A.fill && i === CB - 1;
        let st = A.drums;
        if (st === "intro") st = bar < 2 ? "shaker" : "light";
        if (st === "build") st = i < 2 ? "halftime" : i === 2 ? "drive" : "roll";
        const fill = fillBar && st !== "roll" ? r.weighted(f.id === "TAG" || f.id === "intro" ? [[3, 3], [4, 1]] : f.id === "B" ? [[0, 2], [1, 2], [2, 2]] : [[0, 2], [1, 1], [2, 1], [3, 1]]) : null;
        const cut = fill != null ? FILLS[fill][0][0] : 9;
        const ok = (b) => b < cut;
        // shaker: 16ths, or 8ths in the thin textures
        if (st !== "roll") for (let q = 0; q < 16; q++) {
          const b = q / 4;
          if ((st === "shaker" || st === "thin") && q % 2) continue;
          if (!ok(b)) break;
          D(B0 + b, "shaker", SHK[q % 4] * (st === "halftime" ? 0.8 : st === "thin" || st === "shaker" ? 0.85 : 1));
        }
        // hats
        if (st !== "roll" && st !== "shaker") for (let e8 = 0; e8 < 8; e8++) {
          const b = e8 / 2, offb = e8 % 2 === 1;
          if (!ok(b)) break;
          if ((st === "thin" || st === "light") && !offb) continue;
          const open = (st === "groove" || st === "full" || st === "commute") && bar % 4 === 3 && e8 === 7;
          D(B0 + b, open ? "hatOpen" : "hatClosed", open ? 0.34 : offb ? 0.26 : st === "light" ? 0.2 : 0.3);
        }
        const K = (b, v) => { if (ok(b)) D(B0 + b, "softKick", v); };
        const SN = (b, v, voice = "snare") => { if (ok(b)) D(B0 + b, voice, v); };
        if (st === "light") { K(0, 0.7); K(2.5, 0.55); SN(1, 0.5, "rim"); SN(3, 0.52, "rim"); if (bar % 2 === 1) D(B0 + 3.5, "woodblock", 0.28, { pitch: 84 }); }
        if (st === "groove") { K(0, 0.74); K(2.5, 0.6); if (bar % 2 === 1) K(1.5, 0.4); SN(1, 0.52, "rim"); SN(3, 0.55, "rim"); if (bar % 2 === 1) D(B0 + 3.5, "woodblock", 0.3, { pitch: 84 }); if (r.chance(0.2)) SN(3.75, 0.16); }
        if (st === "full") {
          K(0, 0.8); K(2.5, 0.64); if (bar % 2 === 1) K(1.5, 0.44); SN(1, 0.6); SN(3, 0.64);
          if (r.chance(0.3)) SN(3.75, 0.18);
          if (A.tamb) { [[0.5, 0.18], [1, 0.42], [2.5, 0.18], [3, 0.42]].forEach(([b, v]) => { if (ok(b)) D(B0 + b, "tambourine", v); }); }
        }
        if (st === "commute") {
          K(0, 0.72); K(1.5, 0.5); K(2.5, 0.6); SN(1, 0.5, "rim"); SN(3, 0.56); if (r.chance(0.35)) SN(2.75, 0.17);
          (bar % 2 === 0 ? [1.5, 3] : [2.5]).forEach((b) => { if (ok(b)) D(B0 + b, "woodblock", 0.3, { pitch: b === 3 ? 79 : 84 }); });
        }
        if (st === "halftime") { K(0, 0.72); if (i >= 2 || half === 1) K(2.5, 0.42); SN(2, 0.56); if (half === 1) D(B0 + 3.5, "woodblock", 0.26, { pitch: 84 }); }
        if (st === "drive") { [0, 1, 2, 3].forEach((b) => K(b, 0.6 + (b === 0 ? 0.1 : 0))); SN(1, 0.5); SN(3, 0.56); }
        if (st === "roll") {
          for (let q = 0; q < 16; q++) D(B0 + q / 4, "snare", 0.26 + q * 0.03, { straight: true });
          K(0, 0.7); K(2, 0.6); D(B0 + 3, "tom", 0.6, { pitch: 50 }); D(B0 + 3.5, "tom", 0.66, { pitch: 45 });
        }
        if (st === "thin") { if (bar < 2) { K(0, 0.6); K(2.5, 0.4); } if (bar === 3) { D(B0 + 2, "woodblock", 0.26, { pitch: 84 }); D(B0 + 3, "woodblock", 0.22, { pitch: 79 }); } }
        if (fill != null) FILLS[fill].forEach(([b, voice, v, pitch]) => D(B0 + b, voice, v, { pitch, straight: b % 0.5 !== 0 }));
      }
      if (A.crash && half === 0) D(0, "crash", 0.4);
      if (A.tri) D(2 * BPB, "triangle", 0.3, { len: 1.5 }); // the ping on the home chord

      return { events: ev, harmony: prog, section: label(f, lap, half), state };
    },
  });
})();
