// Milonga Terrace: a tango nuevo / milonga in D minor, 104 bpm in 4 (one bar = one 2/4 milonga bar, the
// 3-3-2 in eighths: beats 1, 2½ and 4), for a terrace at dusk. The feel is the idea: the band keeps the 3-3-2
// dead in time (guitar bordoneo, upright, piano marcato) while a bandoneon sings the tune over it in rubato,
// lingering on the high notes and catching up at the ends of phrases. Arrastres drag into the downbeats (the
// bass slides up a major third, the piano crawls chromatically), a ritardando carries the last strain into the
// Phrygian cadence, a fermata on the dominant, a breath, and the guitar counts the band back in.
// All the feel is Sim.groove (site/engine/groove.js); the notes never change, the dress does.
//
// THE TUNE (fixed by hand; the generator arranges, ornaments and times it, never rewrites it)
//   The DNA: a chromatic inner line falling against a tonic pedal, D C♯ C B, then on through B♭ to A, the
//   Phrygian step (♭VI–V) that every tango lives on; the melody rides the 3-3-2 and keeps to the stable tones
//   (D, F, A) while the line sinks underneath it, then climbs out of the pedal to its peak on iv.
//   A (8 bars):  | Dm | Dm(maj7) | Dm7 | Dm6 | Gm | B♭ | A7♭9 | A7♭9 |      line: D C♯ C B B♭ B♭ A A (the tenor)
//     pickup  C♯ (the leading tone, one eighth before the bar)
//     bar 1   D . F . E D              the motif: up a third on the 3-3-2, a turn back to the tonic
//     bar 2   A G A . F                a stutter on the fifth, resting on the third (the band breathes)
//     bar 3   C . A . F A              the motif's shape on the ♭7 (Dm7), falling to the third
//     bar 4   B D F . . A G            Dm6: the raised sixth on the downbeat, an arpeggio climbing out
//     bar 5   G . B♭ A G               the peak, on iv: the motif a fourth up
//     bar 6   F . D .                  ♭VI: the fall, and a rest for the violin to answer in
//     bar 7   E . C♯ B♭ A G            V7♭9: the ♭9 sighs onto the root, then the seventh
//     bar 8   F E A . .                the ♭13 appoggiatura onto the fifth; rest; the pickup climbs again
//   Violin counter for A′ (hand-written, mostly sixths and thirds under the tune, answering in its rests):
//     F A G F | C♯ . E F | A F D F | G B D F E | B♭ D C B♭ | A F B♭ C | C♯ A G E | D C♯ E
//   B (8 bars, the sudden major turn, D major; the ♭9 on the last beat turns it back):
//                | D | Bm | Em7 | A7 | D | F♯7 | Bm | E7 A7♭9 |
//     bar 1   D F♯ A . (G) F♯    the tonic triad rising to the fifth; the first smile
//     bar 2   D F♯ E D           the motif's turn, in the major
//     bar 3   E G . B            climbing on ii
//     bar 4   A G E C♯           13 → 5 → 3 of the dominant, falling
//     bar 5   D F♯ . A           the triad again, held
//     bar 6   E C♯ A♯ C♯         V/vi: the A♯ is the brightest note in the piece
//     bar 7   B D F♯ B           vi, the arpeggio to the top (B5, the high point)
//     bar 8   G♯ E D C♯ B♭ A     E7 then A7♭9: the B♭ is the door back to D minor
//     Violin under B: A D | F♯ B | G B G | C♯ A E | F♯ A D | C♯ A♯ F♯ A♯ | F♯ B D F♯ | B G♯ A G
//   Variación (8 bars over the A changes): the bandoneon doubles the time, in sixteenths written out below,
//     keeping the tune's notes on the 3-3-2 (D F D | A C♯ F | C A A | B F A | G B♭ G | F D | E C♯ A | F A C♯).
//   One lap: intro 4 · A 8 · A′ 8 (violin counter) · B 8 · variación 8 · A″ 8 (ritardando, fermata on the
//   dominant, the count-in) = 44 bars ≈ 1:45 at 104. On odd laps the violin takes the first A and the bandoneon
//   holds the chromatic line; the variación builds from eighths; ornaments and arrastres thicken lap by lap.
(function () {
  "use strict";
  const T = Sim.theory, G = Sim.groove;
  const BPB = 4, CB = 2, BPM = 104;
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
  /** Bars of sixteen sixteenth tokens ("-" ties, "." rests) -> notes. */
  function run(bars) {
    const out = [];
    bars.forEach((txt, bar) => txt.trim().split(/\s+/).forEach((tok, i) => {
      if (tok === ".") return;
      if (tok === "-") { out[out.length - 1].dur += 0.25; return; }
      out.push({ bar, beat: i * 0.25, dur: 0.25, note: T.midi(tok) });
    }));
    return out;
  }

  // ---------- the score ----------
  const A_CH = ["Dm", "DmMaj7", "Dm7", "Dm6", "Gm", "Bb", "A7b9", "A7b9"];
  const A_RHY = ["Dm", "DmMaj7", "Dm7", "Dm6", "Gm", "Bb", "A7", "A7"]; // what the guitar and bass voice: the line, a plain V (the ♭9 is the piano's)
  const A_MEL = [
    "D5 0 1.5, F5 1.5 1, E5 2.5 .5, D5 3 1",
    "A4 0 1, G4 1 .5, A4 1.5 1, F4 2.5 .5",
    "C5 0 1.5, A4 1.5 1, F4 2.5 .5, A4 3 1",
    "B4 0 1, D5 1 .5, F5 1.5 1.5, A5 3 .5, G5 3.5 .5",
    "G5 0 1.5, Bb5 1.5 1, A5 2.5 .5, G5 3 1",
    "F5 0 1.5, D5 1.5 1.5",
    "E5 0 1.5, C#5 1.5 1, Bb4 2.5 .5, A4 3 .5, G4 3.5 .5",
    "F4 0 1, E4 1 .5, A4 1.5 1.5",
  ];
  const PICK = "C#5 3.5 .5";
  const LINE = ["D4 0 4", "C#4 0 4", "C4 0 4", "B3 0 4", "Bb3 0 4", "Bb3 0 4", "A3 0 4", "A3 0 4"];
  const VLN_A = [
    "F4 0 1.5, A4 1.5 1, G4 2.5 .5, F4 3 1",
    "C#4 0 3, E4 3 .5, F4 3.5 .5",
    "A4 0 1.5, F4 1.5 1, D4 2.5 .5, F4 3 1",
    "G4 0 1, B4 1 .5, D5 1.5 1.5, F5 3 .5, E5 3.5 .5",
    "Bb4 0 1.5, D5 1.5 1, C5 2.5 .5, Bb4 3 1",
    "A4 0 1.5, F4 1.5 1.5, Bb4 3 .5, C5 3.5 .5",
    "C#5 0 1.5, A4 1.5 1, G4 2.5 .5, E4 3 1",
    "Bb3 0 1, A3 1 .5, C#4 1.5 1.5",
  ];
  const END_MEL = ["E5 0 4", null], END_VLN = ["C#5 0 4", null]; // the fermata bars of A″

  const B_CH = ["D", "Bm", "Em7", "A7", "D", "F#7", "Bm", "E7 A7b9"];
  const B_MEL = [
    "D5 0 1, F#5 1 .5, A5 1.5 1.25, G5 2.75 .25, F#5 3 1",
    "D5 0 1.5, F#5 1.5 1, E5 2.5 .5, D5 3 1",
    "E5 0 1.5, G5 1.5 1.5, B5 3 1",
    "A5 0 1.5, G5 1.5 .5, E5 2 1, C#5 3 1",
    "D5 0 1.5, F#5 1.5 1.5, A5 3 1",
    "E5 0 1.5, C#5 1.5 1, A#4 2.5 .5, C#5 3 1",
    "B4 0 1.5, D5 1.5 1, F#5 2.5 .5, B5 3 1",
    "G#5 0 1, E5 1 .5, D5 1.5 .5, C#5 2 1, Bb4 3 .5, A4 3.5 .5",
  ];
  const VLN_B = [
    "A4 0 3, D5 3 1",
    "F#4 0 3, B4 3 1",
    "G4 0 1.5, B4 1.5 1.5, G5 3 1",
    "C#5 0 2, A4 2 1, E4 3 1",
    "F#4 0 1.5, A4 1.5 1.5, D5 3 1",
    "C#5 0 1.5, A#4 1.5 1, F#4 2.5 .5, A#4 3 1",
    "F#4 0 1.5, B4 1.5 1, D5 2.5 .5, F#5 3 1",
    "B4 0 1, G#4 1 1, A4 2 1, G4 3 1",
  ];
  const VAR_MEL = [
    "D5 E5 F5 A5 G5 E5 F5 G5 A5 Bb5 A5 G5 D5 C#5 D5 E5",
    "A4 C#5 D5 F5 E5 D5 C#5 D5 A4 F4 E4 F4 A4 Bb4 B4 C#5",
    "C5 D5 E5 F5 E5 D5 A4 C5 F5 E5 D5 C5 A4 F4 G4 A4",
    "B4 C#5 D5 E5 F5 D5 F5 G5 A5 B5 A5 G5 A5 G5 F5 E5",
    "G5 A5 Bb5 D6 C6 A5 Bb5 A5 G5 F5 E5 D5 G5 A5 Bb5 A5",
    "F5 G5 F5 D5 C5 Bb4 D5 F5 Bb5 A5 G5 F5 Bb4 C5 D5 D#5",
    "E5 F5 E5 D5 C#5 Bb4 C#5 E5 G5 Bb5 A5 G5 A4 Bb4 A4 G4",
    "F4 E4 D4 C#4 E4 G4 A4 Bb4 A4 G4 E4 C#4 E4 G4 A4 C#5",
  ];
  const VAR_ACC = [1, 0.66, 0.78, 0.7, 0.8, 0.68, 0.96, 0.66, 0.78, 0.7, 0.8, 0.68, 0.94, 0.66, 0.8, 0.72]; // the 3-3-2 in sixteenths
  const INTRO_CH = ["Dm", "Dm", "Gm", "A7"];

  const LAP = [
    { id: "intro", bars: 4 },
    { id: "A", bars: 8, prime: 0 },
    { id: "A", bars: 8, prime: 1 },
    { id: "B", bars: 8 },
    { id: "VAR", bars: 8 },
    { id: "A", bars: 8, prime: 2 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB; // 44 bars, 22 cycles

  const secCache = new Map();
  function section(f) {
    const key = f.id + (f.prime ?? "");
    if (secCache.has(key)) return secCache.get(key);
    let s;
    if (f.id === "intro") s = { ch: INTRO_CH, rhy: INTRO_CH, mel: [], vln: [], line: [] };
    else if (f.id === "B") s = { ch: B_CH, rhy: B_CH, mel: phrase(B_MEL, PICK), vln: phrase(VLN_B), line: [] };
    else if (f.id === "VAR") s = { ch: A_CH, rhy: A_RHY, mel: run(VAR_MEL), tune: phrase(A_MEL), vln: [], line: phrase(LINE) };
    else if (f.prime === 2) s = { ch: A_CH, rhy: A_RHY, mel: phrase(A_MEL.slice(0, 6).concat(END_MEL), PICK), vln: phrase(VLN_A.slice(0, 6).concat(END_VLN)), line: phrase(LINE) };
    else s = { ch: A_CH, rhy: A_RHY, mel: phrase(A_MEL, PICK), vln: phrase(VLN_A), line: phrase(LINE) };
    s.prog = T.progression("| " + s.ch.join(" | ") + " |", BPB);
    s.rprog = T.progression("| " + s.rhy.join(" | ") + " |", BPB);
    secCache.set(key, s);
    return s;
  }
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES), cl = cycle % LAP_CYCLES;
    let bar = cl * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i], nf = LAP[(i + 1) % LAP.length];
    return { lap, cl, i, f, nf, off: bar, lastHalf: bar + CB >= f.bars };
  }

  // ---------- tempo: keyed by cycle within the lap ----------
  // 14 = the variación pushes a touch, 18 = A″ a tempo, 20 = A″ bars 5-6 (Gm, B♭): the ritardando into the
  // Phrygian cadence; 21 snaps back a tempo under the fermata so the count-in is at speed.
  const tempoAt = G.tempoScript(BPM, [G.accelerando(14, BPM + 3, 4), G.aTempo(18, BPM), G.ritardando(20, 84, 8)]);

  // ---------- arrangement ----------
  function chooseRoles(lap, r) {
    return {
      swapA: lap % 2 === 1,                                   // the violin takes the first A, the bandoneon holds the line
      varBuild: lap % 2 === 1,                                // the variación states the tune once more, then doubles the time
      orn: lap === 0 ? 0 : Math.min(0.4, 0.18 + 0.08 * lap),  // mordents and grace notes, more each lap
      arr: lap === 0 ? 0.45 : 0.7,                            // how often the bass drags into a downbeat
      pianoB: lap === 0 || r.chance(0.5) ? "dos" : "cuatro",  // the piano's marcato in the major strain
      lineInA: lap === 0 || lap % 2 === 1 || r.chance(0.5),   // whether anyone sustains the line in the first A
    };
  }
  function arrange(f, lap, off, R) {
    const base = { lead: "tune", vln: null, piano: "marcato", line: true, lh: false, guitar: "bordoneo", bass: "milonga", arr: R.arr, chich: [2.5], golpe: [], rub: 0.6, vrub: 0, orn: R.orn, linger: "high" };
    if (f.id === "intro") return { ...base, lead: null, piano: off >= 2 ? "light" : null, line: false, arr: off >= 2 ? 1 : 0, rub: 0, orn: 0 };
    if (f.id === "A" && f.prime === 0) {
      if (R.swapA) return { ...base, lead: "line", vln: "tune", piano: "light", vrub: 0.5, chich: [2.5], arr: R.arr * 0.7 };
      return { ...base, vln: R.lineInA ? "line" : null, piano: "light", rub: 0.5, orn: R.orn * 0.5, arr: R.arr * 0.7 };
    }
    if (f.id === "A" && f.prime === 1) return { ...base, vln: "counter", guitar: "scratch", chich: [0.5, 2.5], golpe: [1, 3], rub: 0.7, vrub: 0.3 };
    if (f.id === "B") return { ...base, vln: "counter", piano: R.pianoB, line: false, guitar: "light", chich: [], arr: 0.3, rub: 0.85, vrub: 0.3, linger: "both" };
    if (f.id === "VAR") return { ...base, lead: R.varBuild && off < 4 ? "tune2" : "var", vln: "line", lh: true, guitar: "scratch", chich: [0.5, 1, 2.5, 3.5], golpe: [1, 3], arr: 0.9, rub: R.varBuild && off < 4 ? 0.4 : 0, orn: 0 };
    // A″: the return, the ritardando, the fermata on A7♭9 and the count-in
    if (off < 6) return { ...base, vln: "counter", rub: off >= 4 ? 1 : 0.85, vrub: 0.35, orn: R.orn * 0.7, arr: off >= 4 ? 0.9 : R.arr, linger: "both" };
    return { ...base, lead: "tune", vln: "hold", piano: "fermata", line: false, guitar: "held", bass: "long", arr: 0, chich: [], rub: 0, orn: 0 };
  }
  function label(f, lap, off, R) {
    const n = `Lap ${lap + 1} · `;
    if (f.id === "intro") return n + (off < 2 ? "the 3-3-2: guitar and upright" : "the piano's marcato, an arrastre into A");
    if (f.id === "B") return n + (off >= 6 ? "B · vi, then the ♭9 turns it back to minor" : off >= 4 ? "B · F♯7, the brightest bar" : "B · the major turn");
    if (f.id === "VAR") return n + (off < 4 ? (R.varBuild ? "variación · the tune once more, marcato" : "variación · the bandoneon doubles the time") : "variación · sixteenths over the Phrygian cadence");
    if (f.prime === 0) return n + (R.swapA ? "A · the violin takes the tune, the bandoneon holds the line" : off >= 4 ? "A · the peak on iv, B♭ to A7♭9" : "A · the tune over the falling line");
    if (f.prime === 1) return n + (off >= 6 ? "A′ · the violin answers in the rests" : "A′ · violin counter, chicharra");
    return n + (off >= 6 ? "A″ · fermata on the dominant, then the count-in" : off >= 4 ? "A″ · ritardando into the Phrygian cadence" : "A″ · the return");
  }

  // guitar bordoneo over a bar: [beat, kind, dur, vel]; B = bass string (root), B5 = fifth, C = chord chop, S = slow strum
  const GFIG = {
    bordoneo: [[0, "B", 0.45, 0.8], [0.5, "C", 0.22, 0.5], [1, "C", 0.35, 0.62], [1.5, "B5", 0.45, 0.74], [2, "C", 0.22, 0.5], [2.5, "C", 0.35, 0.6], [3, "B", 0.45, 0.76], [3.5, "C", 0.22, 0.56]],
    scratch: [[0, "B", 0.45, 0.8], [1, "C", 0.35, 0.62], [1.5, "B5", 0.45, 0.74], [2, "C", 0.22, 0.5], [3, "B", 0.45, 0.76], [3.5, "C", 0.22, 0.56]],
    light: [[0, "B", 1.4, 0.7], [0.5, "S", 1.2, 0.42], [1.5, "B5", 1.4, 0.6], [2, "S", 0.9, 0.4], [3, "B", 0.45, 0.66], [3.5, "S", 0.45, 0.4]],
    held: [[0, "B", 4, 0.62], [0, "S", 4, 0.52]],
  };
  // piano figures: [beat, dur, vel]
  const PFIG = {
    light: [[0, 1.4, 0.5]],
    marcato: [[0, 1.2, 0.52], [1.5, 0.9, 0.44], [3, 0.6, 0.5]],
    dos: [[0, 1.3, 0.46], [2, 1.0, 0.4]],
    cuatro: [[0, 0.5, 0.42], [1, 0.5, 0.34], [2, 0.5, 0.38], [3, 0.5, 0.34]],
    fermata: [[0, 4, 0.56]],
  };

  Sim.register({
    id: "milonga-terrace",
    title: "Milonga Terrace",
    genre: "Tango nuevo / milonga",
    about: "A milonga in D minor for a terrace at dusk, built on feel: the guitar's bordoneo, the upright and the piano's marcato keep the 3-3-2 dead in time while a bandoneon (two detuned reeds through a slow lowpass, with a breath of bellows at every phrase) sings the hand-written tune in rubato over them. The tune rides a chromatic line falling against a tonic pedal into a Phrygian cadence; a violin answers it in sixths; the second strain turns suddenly to D major; a variación doubles the time; then the band drags into the last cadence with arrastres, slows, holds the dominant, breathes, and the guitar counts it back in. Built with Sim.groove.",
    situations: ["hangout", "romance"],
    energy: 0.4,
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    strongBeats: [0, 1.5, 3],

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const Gn = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };

      const hall = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 350, highcut: 5200 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.008, lowcut: 250, highcut: 6000 });

      /** Bandoneon: a pulse and a saw a few cents apart (two reeds), each with a slow bellows-like filter swell,
       *  summed through a gentle lowpass; a puff of pink noise (the bellows) on phrase starts. */
      const bnG = Gn(-13);
      const bnLp = ctx.keep(new Tone.Filter({ frequency: 2100, type: "lowpass", rolloff: -12, Q: 0.6 })).connect(bnG);
      const reed = (osc, detune) => ctx.keep(new Tone.MonoSynth({
        portamento: 0, detune,
        oscillator: osc,
        filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
        envelope: { attack: 0.06, decay: 0.3, sustain: 0.85, release: 0.16 },
        filterEnvelope: { attack: 0.18, decay: 0.6, sustain: 0.6, release: 0.2, baseFrequency: 500, octaves: 2.2 },
      })).connect(bnLp);
      const reedA = reed({ type: "pulse", width: 0.32 }, -5), reedB = reed({ type: "sawtooth" }, 6);
      const bellowsG = Gn(-20);
      const bellowsBp = ctx.keep(new Tone.Filter({ frequency: 1400, type: "bandpass", Q: 0.8 })).connect(bellowsG);
      const bellows = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.03, decay: 0.16, sustain: 0, release: 0.08 } })).connect(bellowsBp);
      const bnSafe = I.monotonic(bnG), bellowsSafe = I.monotonic(bellowsG);
      function playLead(t, e, d) {
        const tt = bnSafe(t), f = hz(e.note);
        reedA.triggerAttackRelease(f, d, tt, e.vel);
        reedB.triggerAttackRelease(f, d, tt, e.vel * 0.8);
        if (e.breath) bellows.triggerAttackRelease(0.14, bellowsSafe(tt), Math.min(1, 0.4 * e.vel + 0.1));
      }
      const bnP = pan(bnG, -0.1); pan(bellowsG, -0.1);
      I.send(ctx, bnP, hall, -12);

      /** Violin: a saw through a nasal peak and a lowpass, slow bow attack, vibrato that arrives after the note settles. */
      const vnG = Gn(-11);
      const vnLp = ctx.keep(new Tone.Filter({ frequency: 3400, type: "lowpass", rolloff: -12 })).connect(vnG);
      const vnBody = ctx.keep(new Tone.Filter({ frequency: 2600, type: "peaking", Q: 1.4, gain: 5 })).connect(vnLp);
      const vnS = ctx.keep(new Tone.MonoSynth({
        portamento: 0.02,
        oscillator: { type: "sawtooth" },
        filter: { type: "lowpass", rolloff: -12, Q: 1.2 },
        envelope: { attack: 0.09, decay: 0.2, sustain: 0.9, release: 0.25 },
        filterEnvelope: { attack: 0.12, decay: 0.4, sustain: 0.7, release: 0.3, baseFrequency: 600, octaves: 2 },
      })).connect(vnBody);
      const vnLfo = ctx.keep(new Tone.LFO({ frequency: 5.6, min: -1, max: 1 }).start());
      const vnVib = ctx.keep(new Tone.Gain(0)); // cents
      vnLfo.connect(vnVib); vnVib.connect(vnS.detune);
      const vnSafe = I.monotonic(vnG);
      function playVln(t, e, d) {
        const tt = vnSafe(t);
        vnS.triggerAttackRelease(hz(e.note), d, tt, e.vel);
        const p = vnVib.gain;
        p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
        if (d > 0.5) { p.setValueAtTime(0, tt + 0.3); p.linearRampToValueAtTime(14, tt + 0.8); }
      }
      const vnP = pan(vnG, 0.3);
      I.send(ctx, vnP, hall, -9);

      /** Upright: round, quick thump; an arrastre event starts below the target and slides up into it. */
      const bsG = Gn(-14);
      const bsLp = ctx.keep(new Tone.Filter({ frequency: 700, type: "lowpass", rolloff: -12 })).connect(bsG);
      const bsS = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "custom", partials: [1, 0.5, 0.25, 0.12, 0.06] },
        filter: { type: "lowpass", rolloff: -24, Q: 1.1 },
        envelope: { attack: 0.006, decay: 0.45, sustain: 0.4, release: 0.12 },
        filterEnvelope: { attack: 0.003, decay: 0.18, sustain: 0.3, release: 0.15, baseFrequency: 150, octaves: 2.6 },
      })).connect(bsLp);
      const bsSafe = I.monotonic(bsG);
      function playBass(t, e, d) {
        const tt = bsSafe(t), f0 = hz(e.note);
        bsS.triggerAttackRelease(f0, d, tt, e.vel);
        if (e.slide) { bsS.frequency.setValueAtTime(f0, tt); bsS.frequency.exponentialRampToValueAtTime(hz(e.note + e.slide), tt + d * 0.9); }
      }
      bsG.connect(out);
      I.send(ctx, bsG, room, -28);

      /** Chicharra (the scratch behind the guitar's bridge) and golpe (a knock on the guitar's body). */
      const chG = Gn(-15);
      const chBp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 1.3 })).connect(chG);
      const chich = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.02 } })).connect(chBp);
      const goG = Gn(-11);
      const goLp = ctx.keep(new Tone.Filter({ frequency: 380, type: "lowpass" })).connect(goG);
      const golpe = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.5, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.05 } })).connect(goLp);
      const chSafe = I.monotonic(chG), goSafe = I.monotonic(goG);
      const chP = pan(chG, -0.3), goP = pan(goG, 0.15);
      I.send(ctx, chP, room, -18); I.send(ctx, goP, room, -16);

      const guitar = I.nylon(ctx, { volume: -8, cutoff: 3800 });
      const piano = I.softPiano(ctx, { volume: -9, decay: 2.4, release: 0.4, cutoff: 3000 });
      const gp = I.place(ctx, guitar, -0.35, out), pp = I.place(ctx, piano, 0.2, out);
      I.send(ctx, gp, room, -16); I.send(ctx, pp, room, -14); I.send(ctx, pp, hall, -20);

      return {
        lead: { layer: "melody", play: playLead, humanize: { timing: 0.006, vel: 0.05 } },
        violin: { layer: "melody", play: playVln, humanize: { timing: 0.01, vel: 0.04 } },
        piano: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        guitar: { layer: "harmony", play: (t, e, d) => guitar.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.004, vel: 0.06 } },
        bass: { layer: "bass", play: playBass, humanize: { timing: 0.003, vel: 0.04 } },
        perc: { layer: "drums", play: (t, e) => (e.note === "golpe" ? golpe.triggerAttackRelease(hz(40), 0.1, goSafe(t), e.vel) : chich.triggerAttackRelease(0.04, chSafe(t), e.vel)), humanize: { timing: 0.003, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, cl, f, nf, off } = W;
      if (!state.roles || state.rolesLap !== lap) { state.roles = chooseRoles(lap, r); state.rolesLap = lap; }
      const R = state.roles;
      const S = section(f), NS = section(nf);
      const A = arrange(f, lap, off, R);
      const slice = (p) => p.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      const prog = slice(S.prog), rprog = slice(S.rprog);
      const chordAt = T.chordAtFactory(prog, BPB), rhyAt = T.chordAtFactory(rprog, BPB);
      let ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      // this cycle's slice of a section's notes, plus the next section's pickup when this is the last slice
      const inBars = (notes, next) => {
        const own = notes.filter((n) => n.bar >= off && n.bar < off + CB).map((n) => ({ ...n, bar: n.bar - off }));
        const pick = W.lastHalf && next && f.id !== "VAR" ? next.filter((n) => n.bar === -1).map((n) => ({ ...n, bar: CB - 1, pickup: true })) : [];
        return own.concat(pick).map((n) => ({ ...n, abs: n.bar * BPB + n.beat }));
      };
      // the root of the bar after bar i (for arrastres and approach notes)
      const nextRoot = (i) => {
        if (i + 1 < CB) return T.chord(rhyAt((i + 1) * BPB).chord).bass;
        if (W.lastHalf) return T.chord(NS.rprog[0].chord).bass;
        return T.chord(S.rprog.find((x) => x.bar === off + CB && x.beat === 0).chord).bass;
      };

      // ---------- the tune (bandoneon, or the violin on swapped laps) ----------
      function emitTune(track, notes, v0, orn) {
        let prevEnd = state[track + "Tail"] ?? -9, ornBar = -1;
        notes.forEach((n, i) => {
          const on = Math.abs(n.beat * 2 - Math.round(n.beat * 2)) < 1e-6 && [0, 1.5, 3].includes(n.beat);
          let v = v0 + (on ? 0.06 : 0) + (n.dur >= 1.5 ? 0.04 : 0) + (n.note >= 79 ? 0.05 : 0) - (n.pickup ? 0.1 : 0);
          const breath = n.abs - prevEnd >= 0.75;
          prevEnd = n.abs + n.dur;
          const art = n.dur <= 0.5 ? n.dur * 0.9 : n.dur - 0.08;
          const canOrn = orn && n.bar !== ornBar && !n.pickup && i < notes.length - 1;
          if (canOrn && n.dur >= 1.5 && r.chance(orn)) { // a mordent on a long note
            ornBar = n.bar;
            const up = T.step(n.note, 1, T.chord(chordAt(n.abs).chord).scale);
            push(track, n.abs, 0.16, n.note, v, { breath });
            push(track, n.abs + 0.18, 0.14, up, v - 0.1);
            push(track, n.abs + 0.36, art - 0.36, n.note, v - 0.03);
            return;
          }
          if (canOrn && breath && n.dur >= 1 && r.chance(orn * 0.7)) { // an acciaccatura from a semitone below
            ornBar = n.bar;
            push(track, n.abs - 0.12, 0.1, n.note - 1, v - 0.18, { breath });
            push(track, n.abs, art, n.note, v);
            return;
          }
          push(track, n.abs, art, n.note, v, breath ? { breath } : undefined);
        });
        state[track + "Tail"] = prevEnd - CB * BPB;
      }
      const mel = inBars(S.mel, NS.mel);
      if (A.lead === "tune") emitTune("lead", mel, 0.7, A.orn);
      else if (A.lead === "tune2") emitTune("lead", inBars(S.tune), 0.72, 0); // the variación's first half on odd laps: the tune, marcato
      else if (A.lead === "var") {
        // the variación: sixteenths, détaché
        mel.forEach((n, i) => push("lead", n.abs, 0.23, n.note, 0.64 + (n.note >= 81 ? 0.05 : 0), i === 0 && off % 4 === 0 ? { breath: true } : undefined));
        state.leadTail = 0;
      } else if (A.lead === "line") {
        inBars(S.line).forEach((n) => push("lead", n.abs, n.dur - 0.15, n.note, 0.46, { norubato: true, breath: n.bar + off === 0 || n.bar + off === 4 }));
        if (mel.some((n) => n.pickup)) mel.filter((n) => n.pickup).forEach((n) => push("lead", n.abs, n.dur - 0.05, n.note, 0.58, { breath: true }));
        state.leadTail = 0;
      } else if (mel.some((n) => n.pickup)) emitTune("lead", mel.filter((n) => n.pickup), 0.7, 0);

      // ---------- violin ----------
      if (A.vln === "tune") emitTune("violin", mel.filter((n) => !n.pickup), 0.56, A.orn * 0.5);
      else if (A.vln === "counter") inBars(S.vln).forEach((n) => push("violin", n.abs, n.dur - 0.12, n.note, 0.4 + (n.beat === 0 ? 0.04 : 0) + (f.id === "B" ? 0.02 : 0)));
      else if (A.vln === "line") inBars(S.line).forEach((n) => push("violin", n.abs, n.dur - 0.2, n.note, f.id === "VAR" ? 0.4 : 0.36));
      else if (A.vln === "hold") inBars(S.vln).forEach((n) => push("violin", n.abs, n.dur, n.note, 0.42));

      // ---------- piano: the marcato, the held line, the fermata, the arrastre crawl ----------
      const voicer = (key, opts) => {
        const cache = new Map();
        return (b, at) => {
          const h = at(b), id = h.bar * BPB + h.beat;
          if (!cache.has(id)) { const v = T.voice(h.chord, { ...opts, prev: state[key], rng: r, omitBass: true }); state[key] = v; cache.set(id, v); }
          return cache.get(id);
        };
      };
      const pv = voicer("vPno", { lo: 53, hi: 67, n: 3, top: [60, 67] });
      const pvWide = voicer("vPnoF", { lo: 50, hi: 71, n: 4, top: [64, 71] });
      const lowRoot = (pc) => T.nearest(42, [pc], 36, 47);
      const fermata = f.id === "A" && f.prime === 2 && off === 6; // cycle 21: bar 0 holds the dominant, bar 1 is the breath
      if (A.piano) {
        for (let i = 0; i < CB; i++) {
          const B0 = i * BPB;
          if (fermata && i === 1) break;
          PFIG[A.piano].forEach(([o, d, v]) => {
            const h = chordAt(B0 + o), end = h.bar * BPB + h.beat + h.dur;
            const dd = Math.min(d, end - (B0 + o) - 0.05);
            if (dd <= 0.1) return;
            push("piano", B0 + o, dd, A.piano === "fermata" ? pvWide(B0 + o, chordAt) : pv(B0 + o, chordAt), v + r.range(-0.03, 0.03));
          });
          if (A.lh) [0, 3].forEach((o) => push("piano", B0 + o, o === 0 ? 1 : 0.5, lowRoot(T.chord(rhyAt(B0 + o).chord).bass), 0.5));
        }
        if (A.line && S.line.length) inBars(S.line).forEach((n) => push("piano", n.abs, n.dur - 0.1, n.note, 0.48, { line: true }));
      }
      // the piano's arrastre: a chromatic crawl in the left hand into the next section's downbeat
      const crawl = (i) => [[3.25, -3, 0.3], [3.5, -2, 0.4], [3.75, -1, 0.5]].forEach(([o, s, v]) => push("piano", i * BPB + o, 0.2, lowRoot(nextRoot(i)) + s, v));
      if (W.lastHalf && (f.id === "VAR" || (f.id === "intro" && lap > 0) || (f.id === "A" && f.prime === 1 && lap > 0))) crawl(CB - 1);

      // ---------- guitar: the bordoneo (bass string on the 3-3-2, chord chops between) ----------
      const gv = voicer("vGtr", { lo: 52, hi: 64, n: 3, top: [57, 64] });
      const gBass = (pc, from) => T.nearest(from, [pc], 40, 51);
      if (A.guitar) {
        for (let i = 0; i < CB; i++) {
          const B0 = i * BPB;
          if (fermata && i === 1) break;
          GFIG[A.guitar].forEach(([o, kind, d, v]) => {
            const h = rhyAt(B0 + o), c = T.chord(h.chord);
            const vv = v + r.range(-0.03, 0.03);
            if (kind === "B") push("guitar", B0 + o, d, gBass(c.bass, 45), vv);
            else if (kind === "B5") push("guitar", B0 + o, d, gBass(mod12(c.root + 7), 45), vv);
            else if (kind === "C") { if (r.chance(0.06)) return; push("guitar", B0 + o, d, gv(B0 + o, rhyAt), vv, { strum: 0.012 }); }
            else push("guitar", B0 + o, d, gv(B0 + o, rhyAt), vv, { strum: 0.03 });
          });
        }
      }

      // ---------- upright: root, fifth, root on the 3-3-2; the arrastre slides into the next downbeat ----------
      let last = state.bassLast ?? 38;
      if (A.bass) {
        for (let i = 0; i < CB; i++) {
          const B0 = i * BPB, c = T.chord(rhyAt(B0).chord);
          const R0 = T.nearest(last, [c.bass], 36, 48);
          if (A.bass === "long") { if (i === 0) push("bass", B0, 4, R0, 0.7); last = R0; continue; }
          const c2 = T.chord(rhyAt(B0 + 1.5).chord), c3 = T.chord(rhyAt(B0 + 3).chord);
          const fifth = c2.root === c.root ? (R0 + 7 <= 48 ? R0 + 7 : R0 - 5) : T.nearest(R0, [c2.bass], 36, 48);
          const R3 = c3.root === c.root ? R0 : T.nearest(R0, [c3.bass], 36, 48);
          push("bass", B0, 1.4, R0, 0.86);
          push("bass", B0 + 1.5, 1.4, fifth, 0.68);
          push("bass", B0 + 3, 0.45, R3, 0.76);
          last = R3;
          // the arrastre: from a major third below (or a minor third above), sliding into the next bar's root
          const nxt = T.nearest(R3, [nextRoot(i)], 36, 48);
          const same = mod12(nxt) === mod12(R3);
          // structural drags: into the peak on iv, into the Phrygian V, into every section; random elsewhere
          const structural = f.id !== "intro" && (f.id === "B" ? [3, 7] : [3, 5, 7]).includes(off + i);
          if (r.chance(structural ? Math.max(A.arr, 0.95) : same ? A.arr * 0.4 : A.arr)) {
            // start a third below (or above) the target, but never a semitone against the held line
            const ln = A.line || A.vln === "line" ? S.line.find((n) => n.bar === off + i) : null;
            const held = ln ? [mod12(ln.note)] : [];
            const clean = (m) => !held.some((pc) => Math.abs(((mod12(m) - pc) % 12 + 12) % 12 - 6) === 5);
            const from = (r.chance(0.72) ? [-4, -3, 3] : [3, -4, -3]).find((s) => clean(nxt + s));
            if (from != null) push("bass", B0 + 3.5, 0.5, nxt + from, 0.5, { slide: -from });
          } else if (!same && r.chance(0.3)) { // or the fifth of the coming chord, the player's other way in
            const fifth = T.nearest(nxt, [mod12(nxt + 7)], 36, 48);
            if (!c3.pcs.some((pc) => [1, 11].includes(((mod12(fifth) - pc) % 12 + 12) % 12))) push("bass", B0 + 3.5, 0.4, fifth, 0.52);
          }
        }
      }
      state.bassLast = last;

      // ---------- chicharra and golpe ----------
      const D = (b, voice, v) => push("perc", b, 0.1, voice, v);
      for (let i = 0; i < CB; i++) {
        const B0 = i * BPB;
        A.chich.forEach((o) => D(B0 + o, "chicharra", o % 1 === 0.5 ? 0.5 : 0.4));
        A.golpe.forEach((o) => D(B0 + o, "golpe", f.id === "VAR" ? 0.46 : 0.34));
      }
      // the count-in after the fermata: two knocks and a scratch, at tempo, into the next lap's downbeat
      if (fermata) { D(BPB + 2, "golpe", 0.5); D(BPB + 3, "golpe", 0.58); D(BPB + 3.5, "chicharra", 0.5); push("guitar", BPB + 3, 0.4, 45, 0.7); push("guitar", BPB + 3.5, 0.4, 45, 0.6); }

      // ---------- feel: everything above is on the grid; Sim.groove moves it ----------
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          bass: { template: "straight", late: 2, vels: false },
          guitar: { template: "straight", late: 0, vels: false },
          piano: { template: "straight", late: 6, vels: false },
          violin: { template: "straight", late: 14, vels: false },
          perc: { template: "straight", late: -6, vels: false },
        },
      });
      ev = G.accents(ev, { track: "bass", pattern: [1, 0.8, 0.8, 0.96, 0.8, 0.8, 0.92, 0.8], unit: 0.5 });
      ev = G.accents(ev, { track: "guitar", pattern: [1, 0.72, 0.8, 0.95, 0.72, 0.78, 0.9, 0.74], unit: 0.5 });
      if (A.lead === "var") ev = G.accents(ev, { track: "lead", pattern: VAR_ACC, unit: 0.25 });
      if (A.rub) ev = G.rubato(ev, { track: "lead", bpm: BPM, bpb: BPB, amount: A.rub, linger: A.linger, lingerMs: A.linger === "both" ? 70 : 55, rng: r });
      if (A.vrub) ev = G.rubato(ev, { track: "violin", bpm: BPM, bpb: BPB, amount: A.vrub, linger: "high", lingerMs: 45, rng: r });
      if (f.id === "VAR" && off >= 4) ev = G.crescendo(ev, { tracks: ["lead", "guitar", "perc"], from: 0, to: 8, v0: 0.95, v1: 1.1 });

      // the fermata: the dominant rings two beats into the breath bar, then the count-in
      if (fermata) ev = G.hold(ev, { bar: 0, beat: 0, extra: 2, tracks: ["lead", "violin", "piano", "guitar", "bass"] });

      return { events: ev, harmony: prog, section: label(f, lap, off, R), state, tempo: tempoAt(cl) };
    },
  });
})();
