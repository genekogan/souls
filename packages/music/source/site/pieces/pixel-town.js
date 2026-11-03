// Pixel Town: a 16-bit town theme in F for a city that is having a good day.
// Form (one "day", 13 cycles of 8 bars): intro over a tonic pedal; A A B A (B in the relative minor);
// a second pass re-orchestrated (thinner 12.5% lead, bells, two-channel thirds); a 16-bar bridge that
// leans on IV, then pivots through Am7 (iii of F = ii of G) into a festival chorus in G that slips
// home through Gm7–C7. The tune is composed, not generated; the rng only decides ornaments, fills
// and small arranging choices, so every return is the same tune heard a little differently.
// Sound: a little sound-chip palette built here (pulse leads at 25% / 12.5% duty with vibrato that
// arrives after the attack, a fast-cycling chip arpeggio, a triangle bass and a noise kit) beside
// softer "sampled" colours (glockenspiel, marimba, very short strings) through a SNES-style echo.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;

  // ---------- the tune ----------
  // Bars are "note beat dur, ..." (beat within the bar); null = empty bar.
  const A_BODY = [
    "A5 0 1.5, G5 1.5 .5, F5 2 .5, C6 2.5 1.5", //            antecedent: motif
    "A5 0 1, G5 1 .5, F5 1.5 .5, D5 2 1.5, E5 3.5 .5", //     motif answered, falling to the 6th degree
    "F5 0 .5, Bb5 .5 .5, D6 1 1, B5 2 1, Ab5 3 1", //          climbs on IV, then the B°7 colour
    "G5 0 2.5, C5 3 .5, F5 3.5 .5", //                         half cadence (4–3 in the harmony)
    "A5 0 1.5, G5 1.5 .5, E5 2 .5, C#6 2.5 1.5", //            consequent: motif, leap widened onto V/vi
    "D6 0 1, C6 1 .5, A5 1.5 .5, F#5 2 2", //                  down the D7 (V/ii)
    "G5 0 .5, A5 .5 .5, Bb5 1 .5, D6 1.5 .5, C6 2 .5, Bb5 2.5 .5, G5 3 .5, E5 3.5 .5", // run to the cadence
  ];
  const A_CH = ["F", "Dm7", "Bb Bdim7", "C7sus4 C7", "F A7/E", "Dm7 D7/C", "Gm7/Bb C7"];
  // Bar 8 depends on where the music goes next; each ending carries its own pickup.
  const A_END = {
    toA2: { ch: "F:2 Gm7:1 C7:1", mel: "F5 0 2, C5 3 .5, F5 3.5 .5" },
    toB: { ch: "F A7", mel: "F5 0 2, E5 2 .5, G5 2.5 .5, A5 3 .5, C#6 3.5 .5" },
    toA1: { ch: "F:1 D7:1 Gm7:1 C7:1", mel: "F5 0 1, C5 3 .5, F5 3.5 .5" },
    toC: { ch: "F F7", mel: "F5 0 2, Eb5 2.5 1.5" },
    home: { ch: "Gm7 C7", mel: "F5 0 2.5", abs: true }, // in G: lands on G over Gm7, the side door back to F
  };
  // B: the same rhythmic cell, now falling down a lament bass D C Bb A, then a chromatic return.
  const B_BODY = [
    "D6 0 1.5, C6 1.5 .5, A5 2 .5, F5 2.5 1.5",
    "C6 0 1.5, Bb5 1.5 .5, G5 2 .5, E5 2.5 1.5",
    "Bb5 0 1.5, A5 1.5 .5, F5 2 .5, D5 2.5 1.5",
    "E5 0 1, D5 1 1, C#5 2 1.5, E5 3.5 .5",
    "F5 0 .5, A5 .5 .5, D6 1 1.5, C6 2.5 .5, A5 3 1",
    "G5 0 1, B5 1 .5, D6 1.5 .5, F6 2 2",
    "D6 0 1, Bb5 1 1, Db6 2 2",
    "C6 0 1, Bb5 1 .5, G5 1.5 .5, E5 2 1, C5 3 .5, F5 3.5 .5",
  ];
  const B_CH = ["Dm", "C7", "Bbmaj7", "A7sus4 A7", "Dm Dm7/C", "G7/B", "Gm7/Bb Bbm6", "C7sus4 C7"];
  // Bridge: a two-bar idea sequenced down a step over IV–V/IV–iii–vi, then a rising ii–iii–IV–V.
  const C1_BODY = [
    "D5 0 .5, F5 .5 .5, A5 1 2, Bb5 3 .5, A5 3.5 .5",
    "G5 0 2, E5 2 1, C5 3 1",
    "C5 0 .5, E5 .5 .5, G5 1 2, A5 3 .5, G5 3.5 .5",
    "F5 0 2, D5 2 1, A4 3 1",
    "D5 0 .5, F5 .5 .5, Bb5 1 2, A5 3 .5, G5 3.5 .5",
    "C6 0 1.5, B5 1.5 .5, A5 2 1, E5 3 1",
    "F5 0 1, D6 1 3",
    "C6 0 2, Bb5 2 1, G5 3 1",
  ];
  const C1_CH = ["Bbmaj7", "C/Bb", "Am7", "Dm7", "Gm7", "Am7", "Bbmaj7", "C7sus4 C7"];
  // Second half: same opening, but Am7 is now heard as ii of G; Bm7–E7 and a long D pedal climb into G.
  const C2_BODY = [
    C1_BODY[0], C1_BODY[1], C1_BODY[2],
    "F#5 0 1, D5 1 1, G#5 2 1, B5 3 1",
    "C6 0 2, B5 2 .5, A5 2.5 .5, G5 3 1",
    "E5 0 1, G5 1 1, B5 2 2",
    "A5 0 1, C6 1 1, E6 2 2",
    "D6 0 1, C6 1 .5, A5 1.5 .5, F#5 2 1, D5 3 .5, G5 3.5 .5",
  ];
  const C2_CH = ["Bbmaj7", "C/Bb", "Am7", "Bm7 E7", "Am7", "Cmaj7", "D9sus4", "D7"];
  // Intro: tonic pedal, then vi–ii–V; the bells preview the motif over Dm7 and sequence it up.
  const INTRO_CH = ["F", "Gm7/F", "Fmaj7", "Bbmaj7/F", "Dm7", "Gm7", "C9sus4", "C7"];
  const INTRO_BELLS = [null, null, null, null,
    "A5 0 1.5, G5 1.5 .5, F5 2 .5, C6 2.5 1.5",
    "Bb5 0 1.5, A5 1.5 .5, G5 2 .5, D6 2.5 1.5",
    "C6 0 1, Bb5 1 .5, G5 1.5 .5, F5 2 2", null];
  const INTRO_PICKUP = [null, null, null, null, null, null, null, "C5 3 .5, F5 3.5 .5"];

  // One "day" of town music. pass 1 plain, pass 2 re-orchestrated, pass 3 = festival in G.
  const ARC = [
    { id: "intro" },
    { id: "A", part: 1, pass: 1, end: "toA2" },
    { id: "A", part: 2, pass: 1, end: "toB" },
    { id: "B", pass: 1 },
    { id: "A", part: 3, pass: 1, end: "toA1" },
    { id: "A", part: 1, pass: 2, end: "toA2" },
    { id: "A", part: 2, pass: 2, end: "toB" },
    { id: "B", pass: 2 },
    { id: "A", part: 3, pass: 2, end: "toC" },
    { id: "C1" },
    { id: "C2" },
    { id: "A", part: 1, pass: 3, key: 2, end: "toA2" },
    { id: "A", part: 3, pass: 3, key: 2, end: "home" },
  ];
  const TIMES = ["Morning", "Noon", "Afternoon", "Evening", "Night"];

  // ---------- helpers ----------
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
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  /** Transpose one bar's chord text ("Gm7/Bb C7", "F:2 Gm7:1 C7:1") by k semitones. */
  function trBar(text, k) {
    if (!k) return text;
    const names = k > 0 ? SHARP : FLAT;
    return text.split(/\s+/).map((tok) => {
      const [s, d] = tok.split(":");
      const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(s);
      const nm = (x) => names[mod12(T.PC[x] + k)];
      const sym = nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
      return d ? `${sym}:${d}` : sym;
    }).join(" ");
  }
  const progText = (bars) => "| " + bars.join(" | ") + " |";

  function buildSection(f) {
    const k = f.key || 0;
    if (f.id === "intro") return { ch: INTRO_CH, mel: phrase(INTRO_PICKUP), key: 0 };
    if (f.id === "B") return { ch: B_CH, mel: phrase(B_BODY), key: 0 };
    if (f.id === "C1") return { ch: C1_CH, mel: phrase(C1_BODY), key: 0 };
    if (f.id === "C2") return { ch: C2_CH, mel: phrase(C2_BODY), key: 2 };
    const e = A_END[f.end];
    const ch = A_CH.map((x) => trBar(x, k)).concat([e.abs ? e.ch : trBar(e.ch, k)]);
    return { ch, mel: phrase(A_BODY.concat([e.mel]), k), key: k };
  }
  const FIRST_BASS = (f) => (f.id === "B" ? 2 : f.id === "C1" || f.id === "C2" ? 10 : 5 + (f.key || 0));

  /**
   * The second pulse channel's note under `note`: parallel diatonic thirds in the key; where that
   * third rubs a semitone against the chord (C under A7, Bb under Dm7) it takes the chord scale's
   * third, and on beats and long notes anything still rubbing (or a non-chord tone under a long
   * note) becomes a chord tone a third, sixth or fourth below.
   */
  function below(note, sym, keyScale, onBeat, long) {
    const c = T.chord(sym), pcs = c.pcs;
    const clash = (m) => !pcs.includes(mod12(m)) && pcs.some((p) => mod12(m - p) === 1 || mod12(p - m) === 1);
    // chromatic melody notes (B natural in F) step through the chord's own scale
    let h = T.step(note, -2, keyScale.includes(mod12(note)) ? keyScale : c.scale);
    if (clash(h)) { const alt = T.step(note, -2, c.scale); if (!clash(alt) || !(onBeat || long)) h = alt; }
    const ok = !((onBeat || long) && clash(h)) && !(long && !pcs.includes(mod12(h))) && h >= 64 && note - h >= 3;
    if (ok) return h;
    for (const d of [3, 4, 8, 9, 5]) if (note - d >= 64 && pcs.includes(mod12(note - d))) return note - d;
    return h;
  }

  /** Re-stack a voicing's pitch classes in close position (span < an octave), nearest the previous one. */
  function closeUp(v, prev, lo, hi) {
    const pcs = [...new Set(v.map(mod12))].sort((a, b) => a - b);
    const target = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
    let best = v, bestS = Infinity;
    for (let i = 0; i < pcs.length; i++) {
      for (let base = lo; base <= hi; base++) {
        if (mod12(base) !== pcs[i]) continue;
        const stack = [base];
        for (let j = 1; j < pcs.length; j++) { let m = stack[0]; while (mod12(m) !== pcs[(i + j) % pcs.length] || m <= stack[stack.length - 1]) m++; stack.push(m); }
        if (stack[stack.length - 1] > hi || stack[stack.length - 1] - stack[0] >= 12) continue;
        let s = Math.abs(stack.reduce((a, b) => a + b, 0) / stack.length - target);
        for (let j = 1; j < stack.length; j++) if (stack[j] - stack[j - 1] === 1) s += 3; // no rubbing semitones
        if (s < bestS) { bestS = s; best = stack; }
      }
    }
    return best;
  }

  // ---------- arrangement per section ----------
  function arrange(f, arc) {
    const swap = arc % 2 === 1; // alternate days hand the tune to the other pulse channel first
    const L1 = swap ? "lead2" : "lead", L2 = swap ? "lead" : "lead2";
    const base = { lead: L1, other: L2, harm: null, bells: null, comp: null, stabs: false, pad: false, arp: null, arpFrom: 0, bass: "two", drums: "groove", fill: false, crash: false };
    if (f.id === "intro") return { ...base, lead: "lead", other: "lead2", bells: "preview", arp: "tresillo", comp: "pahLate", bass: "pedal", drums: "intro", fill: true };
    if (f.id === "B") {
      return f.pass === 1
        ? { ...base, pad: true, arp: "tresillo", bass: "lament", drums: "half", fill: true }
        : { ...base, lead: L2, other: L1, harm: [4, 8], bells: "sparkle", pad: true, arp: "tresillo", bass: "lament", drums: "half", fill: true };
    }
    if (f.id === "C1") return { ...base, lead: L2, other: L1, bells: "sparkle", pad: true, bass: "long", drums: "soft" };
    if (f.id === "C2") return { ...base, lead: L2, other: L1, bells: "sparkle", pad: true, arp: "tresillo", arpFrom: 2, stabs: true, bass: "climb", drums: "build" };
    // A sections
    if (f.pass === 1) {
      if (f.part === 1) return { ...base, comp: "pah", drums: "easy" };
      if (f.part === 2) return { ...base, bells: "sparkle", comp: "pah", drums: "groove", fill: true };
      return { ...base, bells: "sparkle", comp: "skank", stabs: true, bass: "bounce", drums: "full", fill: true, crash: true };
    }
    if (f.pass === 2) {
      if (f.part === 1) return { ...base, lead: L2, other: L1, bells: "double", comp: "skank", bass: "bounce", drums: "groove", crash: true };
      if (f.part === 2) return { ...base, lead: L2, other: L1, harm: [4, 8], comp: "skank", bass: "bounce", drums: "groove", fill: true };
      return { ...base, harm: [0, 8], bells: "sparkle", comp: "skank", stabs: true, bass: "bounce", drums: "full", fill: true, crash: true };
    }
    // festival in G
    return { ...base, harm: [0, 8], bells: f.part === 1 ? "sparkle" : "double", comp: "skank", stabs: true, bass: "bounce", drums: "full", fill: true, crash: f.part === 1 };
  }

  function label(f, arc) {
    const t = TIMES[arc % TIMES.length];
    if (f.id === "intro") return `${t} · the town wakes (tonic pedal)`;
    if (f.id === "B") return `${t} · side street (D minor)${f.pass === 2 ? " · in thirds" : ""}`;
    if (f.id === "C1") return `${t} · bridge · the park`;
    if (f.id === "C2") return `${t} · bridge · up the hill to G`;
    const part = ["", "A", "A again", "A home"][f.part];
    if (f.pass === 1) return `${t} · main street · ${part}`;
    if (f.pass === 2) return `${t} · market day · ${part}${f.part === 1 ? " · bells" : " · thirds"}`;
    return `${t} · festival in G · ${f.part === 1 ? "A" : "A, home through Gm7–C7"}`;
  }

  // Comping and gating patterns: [beat, dur, vel]
  const COMP = {
    pah: [[1, 0.45, 0.5], [3, 0.45, 0.46]],
    skank: [[0.5, 0.3, 0.4], [1.5, 0.3, 0.47], [2.5, 0.3, 0.4], [3.5, 0.3, 0.47]],
  };
  const TRESILLO = [[0, 1.4, 0.5], [1.5, 0.9, 0.42], [2.5, 1.4, 0.46]];
  // String stabs that underline the tune's syncopations and the harmonic rhythm: [bar, beat]
  const STABS_A = [[0, 0], [0, 2.5], [2, 0], [2, 2], [3, 0], [3, 2], [4, 0], [4, 2.5], [5, 0], [5, 2], [6, 0], [6, 2]];

  Sim.register({
    id: "pixel-town",
    title: "Pixel Town",
    genre: "16-bit town theme",
    about: "A sunny town theme in F: A A B A with a D-minor side street, a second pass in two-channel thirds, a bridge that climbs into G for a festival chorus and slips home through Gm7–C7. Pulse leads at 25% and 12.5% duty with vibrato after the attack, a chip arpeggio, triangle bass and noise kit, plus glockenspiel, marimba and short strings through a SNES-style echo.",
    bpm: 124, beatsPerBar: BPB, swing: 0.55, swingUnit: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out, bpm } = ctx;
      const hz = T.hz;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const G = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };
      // Band-limited pulse of duty d: |a_k| = sin(pi k d) / k (PeriodicWave normalises the peak).
      const pulse = (d, n = 24) => Array.from({ length: n }, (_, i) => Math.round(1e5 * Math.sin(Math.PI * (i + 1) * d) / (i + 1)) / 1e5);

      const room = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.012, lowcut: 300, highcut: 6000 });
      const echo = I.delay(ctx, out, { time: "8n", feedback: 0.32, highcut: 2600 }); // the SNES echo buffer

      // Levels: custom voices are trimmed so a sustained note at vel 0.8 sits near -20 dB RMS
      // (the library's calibration), then offset for the mix. Normalised pulses measure about -10 dB RMS.
      /** Pulse lead: amp envelope, gentle low-pass, and a vibrato LFO whose depth rises after the attack. */
      function chipLead(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12, Q: 0.5 })).connect(g);
        const s = ctx.keep(new Tone.Synth({
          oscillator: { type: "custom", partials: pulse(o.duty) },
          envelope: { attack: 0.005, decay: 0.16, sustain: 0.72, release: 0.07 },
        })).connect(lp);
        const lfo = ctx.keep(new Tone.LFO({ frequency: o.rate, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0)); // cents of vibrato
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const tt = safe(t), f = hz(e.note);
            if (e.bend) { s.triggerAttackRelease(hz(e.note - e.bend), d, tt, e.vel); s.frequency.exponentialRampToValueAtTime(f, tt + 0.07); }
            else s.triggerAttackRelease(f, d, tt, e.vel);
            const p = depth.gain;
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > o.vibDelay + 0.12) { p.setValueAtTime(0, tt + o.vibDelay); p.linearRampToValueAtTime(o.vibCents, tt + o.vibDelay + 0.3); }
          },
        };
      }
      const lead = chipLead({ duty: 0.25, volume: -7.5, cutoff: 4200, rate: 5.6, vibDelay: 0.2, vibCents: 22 });
      const lead2 = chipLead({ duty: 0.125, volume: -8, cutoff: 4800, rate: 6.1, vibDelay: 0.22, vibCents: 16 });
      const lp1 = pan(lead.out, -0.06), lp2 = pan(lead2.out, 0.16);
      I.send(ctx, lp1, room, -15); I.send(ctx, lp1, echo, -19); I.send(ctx, lp2, room, -15); I.send(ctx, lp2, echo, -17);

      // Chip arpeggio: one channel cycling the chord at triplet-32nds (the classic way to imply harmony).
      const arpG = G(-6.5 - 15);
      const arpLp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12 })).connect(arpG);
      const arpS = ctx.keep(new Tone.Synth({ oscillator: { type: "custom", partials: pulse(0.25, 16) }, envelope: { attack: 0.003, decay: 0.25, sustain: 0.75, release: 0.05 } })).connect(arpLp);
      const arpSafe = I.monotonic(arpG);
      const step = 60 / bpm / 12;
      const ap = pan(arpG, -0.45);
      I.send(ctx, ap, echo, -14); I.send(ctx, ap, room, -16);

      // Triangle bass with a hint of 2nd harmonic so it reads on small speakers.
      const bassG = G(-12 - 4);
      const bassLp = ctx.keep(new Tone.Filter({ frequency: 1600, type: "lowpass", rolloff: -12 })).connect(bassG);
      const bassS = ctx.keep(new Tone.Synth({ oscillator: { type: "custom", partials: [1, 0.22, -0.111, 0.06, 0.04, 0, -0.02, 0, 0.012] }, envelope: { attack: 0.006, decay: 0.15, sustain: 0.8, release: 0.06 } })).connect(bassLp);
      const bassSafe = I.monotonic(bassG);
      bassG.connect(out);

      // Soft square pad (a chip "organ"), only in the minor street and the bridge.
      const padG = G(-4.6 - 13);
      const padLp = ctx.keep(new Tone.Filter({ frequency: 1500, type: "lowpass", rolloff: -12 })).connect(padG);
      const padS = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 12, options: { oscillator: { type: "custom", partials: pulse(0.5, 12) }, envelope: { attack: 0.07, decay: 0.5, sustain: 0.6, release: 0.5 } } })).connect(padLp);
      const pp = pan(padG, 0.05);
      I.send(ctx, pp, room, -11);

      // "Sampled" colours
      const glock = I.glock(ctx, { volume: -9, decay: 1.6 });
      const marimba = I.marimba(ctx, { volume: -8, decay: 0.55 });
      const strings = I.strings(ctx, { volume: -10, attack: 0.012, release: 0.16, cutoff: 3200 });
      const gp = I.place(ctx, glock, 0.4, out), mp = I.place(ctx, marimba, 0.22, out), sp = I.place(ctx, strings, -0.25, out);
      I.send(ctx, gp, echo, -8); I.send(ctx, gp, room, -11); I.send(ctx, mp, echo, -15); I.send(ctx, mp, room, -14); I.send(ctx, sp, room, -10);

      // Noise-channel kit: short hats, open hat, snare (noise + triangle body), triangle kick and toms, crash.
      const kitOut = G(0); kitOut.connect(out);
      I.send(ctx, kitOut, room, -18);
      const voice = (node, d, p = 0) => { const g = G(d); node.connect(g); if (p) { const pn = ctx.keep(new Tone.Panner(p)); g.connect(pn); pn.connect(kitOut); } else g.connect(kitOut); return node; };
      const noise = (decay, filters, d, p) => {
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay, sustain: 0, release: 0.02 } }));
        let last = n; filters.forEach(([f, type]) => { const fl = ctx.keep(new Tone.Filter(f, type)); last.connect(fl); last = fl; });
        voice(last, d, p);
        return n;
      };
      const hat = noise(0.03, [[7500, "highpass"]], 1, -0.22);
      const ohat = noise(0.2, [[6500, "highpass"]], -3, -0.22);
      const crash = noise(1.1, [[5000, "highpass"]], -8, 0.25);
      const snN = noise(0.13, [[1000, "highpass"], [8000, "lowpass"]], 1, 0.05);
      const memb = (o) => ctx.keep(new Tone.MembraneSynth({ oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: o.decay, sustain: 0, release: 0.05 }, pitchDecay: o.pd, octaves: o.oct }));
      const snB = voice(memb({ decay: 0.08, pd: 0.02, oct: 2 }), -7);
      const kick = voice(memb({ decay: 0.22, pd: 0.04, oct: 4 }), -6);
      const tom = voice(memb({ decay: 0.2, pd: 0.03, oct: 1.6 }), -8, 0.1);
      const clocks = {};
      const clk = (k) => (clocks[k] ||= I.monotonic(kitOut));
      const KIT = {
        hat: (t, v) => hat.triggerAttackRelease(0.03, clk("hat")(t), v),
        ohat: (t, v) => ohat.triggerAttackRelease(0.15, clk("ohat")(t), v),
        crash: (t, v) => crash.triggerAttackRelease(0.6, clk("crash")(t), v),
        snare: (t, v) => { const tt = clk("snare")(t); snN.triggerAttackRelease(0.1, tt, v); snB.triggerAttackRelease(hz(52), 0.06, tt, v); },
        kick: (t, v) => kick.triggerAttackRelease(hz(34), 0.15, clk("kick")(t), v),
        tom: (t, v, p) => tom.triggerAttackRelease(hz(p ?? 45), 0.15, clk("tom")(t), v),
      };

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.002, vel: 0.03 } },
        lead2: { layer: "melody", play: (t, e, d) => lead2.play(t, e, d), humanize: { timing: 0.002, vel: 0.03 } },
        bells: { layer: "melody", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        arp: {
          layer: "texture", humanize: { timing: 0, vel: 0.02 },
          play(t, e, d) {
            const ns = arr(e.note), tt = arpSafe(t);
            arpS.triggerAttack(hz(ns[0]), tt, e.vel);
            const n = Math.floor(d / step);
            for (let k = 1; k < n; k++) arpS.frequency.setValueAtTime(hz(ns[k % ns.length]), tt + k * step);
            arpS.triggerRelease(tt + d);
          },
        },
        comp: { layer: "harmony", play: (t, e, d) => marimba.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.06 } },
        stabs: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        pad: { layer: "harmony", play: (t, e, d) => padS.triggerAttackRelease(arr(e.note).map(hz), d, t, e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        bass: { layer: "bass", play: (t, e, d) => bassS.triggerAttackRelease(hz(arr(e.note)[0]), d, bassSafe(t), e.vel), humanize: { timing: 0.002, vel: 0.04 } },
        drums: { layer: "drums", play: (t, e) => KIT[e.note](t, e.vel, e.pitch), humanize: { timing: 0.002, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const pos = cycle % ARC.length, arc = Math.floor(cycle / ARC.length);
      const f = ARC[pos], nf = ARC[(pos + 1) % ARC.length];
      const sec = buildSection(f);
      const A = arrange(f, arc);
      const prog = T.progression(progText(sec.ch));
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const spanEnd = (b) => { const h = chordAt(b); return h.bar * BPB + h.beat + h.dur; };
      const keyScale = T.scale(mod12(5 + sec.key), "ionian");
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // ---- melody ----
      const mel = sec.mel.map((n) => ({ ...n, abs: n.bar * BPB + n.beat }));
      const orn = f.pass === 1 ? (arc ? 0.08 : 0) : f.pass === 2 ? 0.14 : f.pass === 3 ? 0.2 : 0.1;
      const ornP = orn ? Math.min(0.3, orn + 0.03 * Math.min(arc, 3)) : 0;
      const velOf = (n) => {
        const on = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
        let v = on ? (n.beat % 2 === 0 ? 0.78 : 0.72) : 0.64;
        if (n.dur >= 1.5) v += 0.04;
        return v;
      };
      // a closing pickup belongs to whichever channel sings the next section
      const nextLead = arrange(nf, pos === ARC.length - 1 ? arc + 1 : arc).lead;
      const isPickup = (n) => n.bar === 7 && n.beat >= 3 && n.dur <= 0.5;
      let ornBar = -1; // at most one ornament per bar
      mel.forEach((n, i) => {
        const last = i === mel.length - 1 || n.bar === ornBar;
        const v = velOf(n);
        const art = n.dur <= 0.5 ? n.dur * 0.86 : n.dur - 0.08;
        // ornaments on returns: a slide up into long notes, or a quick upper-neighbour mordent
        if (ornP && !last && n.dur >= 1.5 && r.chance(ornP)) { ornBar = n.bar; push(A.lead, n.abs, art, n.note, v, { bend: r.chance(0.7) ? 1 : 2 }); return; }
        if (ornP && !last && n.dur >= 1 && n.dur < 1.5 && r.chance(ornP * 0.6)) {
          ornBar = n.bar;
          const c = T.chord(sym(n.abs)), k = T.step(n.note, 1, keyScale);
          const rub = !c.pcs.includes(mod12(k)) && c.pcs.some((p) => mod12(k - p) === 1 || mod12(p - k) === 1);
          const up = rub || !keyScale.includes(mod12(n.note)) ? T.step(n.note, 1, c.scale) : k; // diatonic unless it rubs (C# under A7)
          push(A.lead, n.abs, 0.22, n.note, v); push(A.lead, n.abs + 0.25, 0.22, up, v - 0.08); push(A.lead, n.abs + 0.5, n.dur - 0.58, n.note, v - 0.04);
          return;
        }
        push(isPickup(n) ? nextLead : A.lead, n.abs, art, n.note, isPickup(n) ? 0.66 : v);
      });
      // two-channel harmony: the other pulse a third (or fourth/sixth) below, same rhythm
      if (A.harm) {
        const pickup = (n) => (n.bar === 3 || n.bar === 7) && n.beat >= 3 && n.dur <= 0.5; // pickups stay solo
        mel.filter((n) => n.bar >= A.harm[0] && n.bar < A.harm[1] && !pickup(n)).forEach((n) => {
          const h = below(n.note, sym(n.abs), keyScale, Math.abs(n.beat - Math.round(n.beat)) < 1e-6, n.dur >= 1.5);
          push(A.other, n.abs, n.dur <= 0.5 ? n.dur * 0.86 : n.dur - 0.1, h, velOf(n) * 0.8);
        });
      }
      // bells
      if (A.bells === "preview") phrase(INTRO_BELLS).forEach((n) => push("bells", n.bar * BPB + n.beat, Math.max(0.5, n.dur), n.note + 12, 0.3 + (n.beat === 0 ? 0.06 : 0)));
      if (A.bells === "sparkle") mel.filter((n) => n.dur >= 1.5).forEach((n) => push("bells", n.abs, 1.5, n.note + 12, 0.36));
      if (A.bells === "double") {
        const [b0, b1] = f.id === "A" && f.pass === 3 ? [4, 8] : f.id === "A" ? [0, 4] : [0, 8];
        mel.filter((n) => n.bar >= b0 && n.bar < b1).forEach((n) => push("bells", n.abs, Math.max(0.5, n.dur), n.note + 12, n.dur >= 1 ? 0.34 : 0.27));
      }

      // ---- chordal parts, each voice-led from its own previous voicing ----
      function voicer(key, opts) {
        const cache = new Map();
        return (b) => {
          const h = chordAt(b), id = h.bar * BPB + h.beat;
          if (!cache.has(id)) {
            // omitBass drops a slash chord's bass after the voice count is fixed, so ask for one more voice
            const c = T.chord(h.chord), n = opts.n + (c.bass !== c.root && c.pcs.includes(c.bass) ? 1 : 0);
            let v = T.voice(h.chord, { ...opts, n, prev: state[key], rng: r, omitBass: true });
            if (opts.close) v = closeUp(v, state[key], opts.lo, opts.hi);
            state[key] = v; cache.set(id, v);
          }
          return cache.get(id);
        };
      }
      const barChords = (bar) => prog.filter((h) => h.bar === bar);
      if (A.comp) {
        const vc = voicer("vComp", { lo: 55, hi: 71, n: 3, top: [64, 71] });
        for (let bar = 0; bar < 8; bar++) {
          if (A.comp === "pahLate" && bar < 4) continue; // intro: marimba joins at bar 5
          const many = barChords(bar).length >= 3;
          const pat = many ? barChords(bar).map((h) => [h.beat, 0.45, 0.48]) : COMP[A.comp === "pahLate" ? "pah" : A.comp];
          pat.forEach(([b, d, v]) => {
            const at = bar * BPB + b, end = spanEnd(at);
            push("comp", at, Math.min(d, end - at - 0.05), vc(at), v + r.range(-0.03, 0.03));
          });
        }
      }
      if (A.stabs) {
        const vs = voicer("vStab", { lo: 58, hi: 76, n: 4, top: [69, 76] });
        const hits = f.id === "C2" ? [[7, 0], [7, 1.5], [7, 3]] : STABS_A.concat(barChords(7).map((h) => [7, h.beat]));
        hits.forEach(([bar, b]) => { const at = bar * BPB + b; push("stabs", at, 0.3, vs(at), (b === 0 ? 0.5 : 0.44) + r.range(-0.03, 0.03)); });
      }
      if (A.pad) {
        const vp = voicer("vPad", { lo: 53, hi: 70, n: 4, top: [64, 70] });
        prog.forEach((h) => { const at = h.bar * BPB + h.beat; push("pad", at, h.dur - 0.08, vp(at), f.id === "C1" ? 0.5 : 0.44); });
      }
      if (A.arp) {
        const va = voicer("vArp", { lo: 60, hi: 76, n: 3, top: [68, 76], close: true });
        for (let bar = A.arpFrom; bar < 8; bar++) {
          TRESILLO.forEach(([b, d, v]) => {
            const at = bar * BPB + b, end = spanEnd(at);
            const dd = Math.min(d, end - at - 0.08);
            if (dd < 0.3) return;
            push("arp", at, dd, va(at).slice().sort((x, y) => x - y), v * (f.id === "intro" && bar < 4 ? 0.85 : 1));
          });
        }
      }

      // ---- triangle bass ----
      let last = state.bassLast ?? 41;
      const nextPc = FIRST_BASS(nf);
      const bassHi = A.bass === "bounce" ? 47 : 50;
      // approach the next root from the side the line is already travelling (A2 C3 D3, D3 A2 G2)
      const approach = (from, pc) => {
        const t = T.nearest(from, [pc], 33, bassHi);
        const lo = [[t - 1, 3], [T.step(t, -1, keyScale), 3]], hi = [[t + 1, 3], [T.step(t, 1, keyScale), 3]];
        const side = t > from ? lo.concat(hi.map(([m, w]) => [m, w / 6])) : t < from ? hi.concat(lo.map(([m, w]) => [m, w / 6])) : lo.concat(hi);
        const c = side.filter(([m]) => m !== from && m >= 33 && m <= 53);
        return c.length ? r.weighted(c) : t;
      };
      prog.forEach((h, i) => {
        const s = h.bar * BPB + h.beat, d = h.dur, c = T.chord(h.chord);
        const nxt = i + 1 < prog.length ? T.chord(prog[i + 1].chord).bass : nextPc;
        const R = T.nearest(last, [c.bass], 33, bassHi);
        const fifthPc = mod12(c.root + (c.intervals.find((x) => x >= 6 && x <= 8) ?? 7));
        // fifth above from low roots, fifth below from high ones; over an inversion, the next chord tone up
        const F5 = c.bass === c.root ? (R >= 45 ? T.nearest(R - 5, [fifthPc], 31, 55) : T.nearest(R + 7, [fifthPc], 31, 55)) : T.nearest(R + 3, c.pcs, 33, 55);
        const oct = R + 12 <= 59 ? R + 12 : R - 12;
        const add = (b, n, dur, v) => push("bass", s + b, dur, n, v);
        let end = R;
        const style = A.bass === "pedal" ? (h.bar < 4 ? "pedal" : "two") : A.bass === "climb" ? (h.bar < 4 ? "long" : "two") : A.bass;
        if (style === "pedal") {
          for (let b = 0; b < d; b += 0.5) {
            if (h.bar === 3 && b === 3.5) { end = approach(R, nxt); add(b, end, 0.4, 0.6); } // step off the pedal
            else add(b, b % 1 ? oct : R, 0.4, b % 1 ? 0.5 : 0.7);
          }
        } else if (style === "long") {
          add(0, R, d >= 4 ? 2.9 : d - 0.1, 0.66);
          if (d >= 4) { end = approach(R, nxt); add(3, end, 0.9, 0.52); }
        } else if (style === "lament") {
          // when the bass line already moves by step (D C Bb A, B Bb), just let it sing
          const stepwise = Math.abs(T.nearest(R, [nxt], R - 6, R + 6) - R) <= 2;
          if (d >= 4 && stepwise) add(0, R, 3.85, 0.76);
          else if (d >= 4) {
            add(0, R, 2.9, 0.76);
            if (r.chance(0.6)) { add(3, R, 0.45, 0.5); end = approach(R, nxt); add(3.5, end, 0.45, 0.55); }
            else add(3, F5, 0.9, 0.55);
          } else add(0, R, d - 0.1, 0.74);
        } else if (style === "bounce") { // quarter-note pulse with an octave pop on beat 2
          if (d >= 4) {
            add(0, R, 0.7, 0.8); add(1, oct, 0.4, 0.6); add(2, F5, 0.7, 0.72);
            if (r.chance(0.7)) { add(3, R, 0.4, 0.6); end = approach(R, nxt); add(3.5, end, 0.4, 0.56); }
            else { add(3, R, 0.9, 0.62); }
          } else if (d >= 2) {
            add(0, R, 0.7, 0.8);
            if (r.chance(0.6)) add(1, oct, 0.4, 0.58); else add(1, F5, 0.7, 0.62);
          } else add(0, R, 0.8, 0.76);
        } else { // "two": root and fifth, with an 8th-note approach into the next chord
          if (d >= 4) {
            add(0, R, 0.9, 0.8);
            if (r.chance(0.55)) { add(2, F5, 1.3, 0.68); end = approach(F5, nxt); add(3.5, end, 0.4, 0.56); }
            else { add(2, F5, 0.9, 0.68); end = F5; }
          } else if (d >= 2) {
            add(0, R, 0.9, 0.78);
            if (r.chance(0.35)) { end = approach(R, nxt); add(1.5, end, 0.4, 0.54); }
          } else add(0, R, 0.8, 0.74);
        }
        last = Math.max(33, Math.min(52, end));
      });
      state.bassLast = last;

      // ---- noise kit ----
      const D = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      const fillAt = A.fill ? r.pick([2, 2.5, 3]) : 9;
      for (let bar = 0; bar < 8; bar++) {
        const B0 = bar * BPB, fillBar = bar === 7 && A.fill;
        const st = A.drums === "intro" ? (bar < 4 ? "hats" : "light") : A.drums === "build" ? (bar < 4 ? "soft" : bar < 6 ? "drive" : "roll") : A.drums;
        for (let e8 = 0; e8 < 8; e8++) {
          const b = e8 / 2, off = e8 % 2 === 1;
          if (fillBar && b >= fillAt) break;
          const ohat = (st === "groove" || st === "full") && bar % 4 === 3 && e8 === 7;
          if (st === "hats" || st === "soft" || st === "easy") { if (off) D(B0 + b, "hat", st === "soft" ? 0.2 : st === "easy" ? 0.32 : 0.26); }
          else if (st !== "roll") D(B0 + b, ohat ? "ohat" : "hat", ohat ? 0.3 : off ? (st === "half" ? 0.26 : 0.36) : (st === "half" ? 0.17 : 0.22));
        }
        const k = (b, v) => { if (!(fillBar && b >= fillAt)) D(B0 + b, "kick", v); };
        const sn = (b, v) => { if (!(fillBar && b >= fillAt)) D(B0 + b, "snare", v); };
        if (st === "soft") k(0, 0.45);
        if (st === "light") { k(0, 0.6); k(2, 0.45); }
        if (st === "easy") { k(0, 0.68); k(2, 0.52); sn(3, 0.46); if (bar % 2 === 1) k(2.5, 0.34); }
        if (st === "groove" || st === "full") {
          k(0, 0.78); k(2, 0.62); sn(1, 0.58); sn(3, 0.62);
          if (bar % 2 === 1) k(2.5, 0.4);
          if (st === "full" && bar % 2 === 0) k(1.5, 0.42);
          if (st === "full" && r.chance(0.25)) sn(3.75, 0.18); // ghost
        }
        if (st === "half") { k(0, 0.7); if (r.chance(0.5)) k(1.5, 0.38); sn(2, 0.56); }
        if (st === "drive") { [0, 1, 2, 3].forEach((b) => k(b, 0.55 + (b === 0 ? 0.1 : 0))); sn(1, 0.45); sn(3, 0.5); }
        if (st === "roll") {
          if (bar === 6) for (let i = 0; i < 8; i++) { D(B0 + i / 2, "snare", 0.24 + i * 0.045); if (i % 2 === 0) D(B0 + i / 2, "kick", 0.5); }
          else {
            for (let i = 0; i < 12; i++) D(B0 + i / 4, "snare", 0.36 + i * 0.035, { straight: true });
            [[3, 50], [3.5, 45]].forEach(([b, p]) => D(B0 + b, "tom", 0.7, { pitch: p }));
            D(B0, "kick", 0.6);
          }
        }
        if (fillBar && st !== "roll") {
          const pitches = [52, 50, 47, 45, 43, 40];
          const hits = [];
          for (let b = fillAt; b < 4 - 1e-6; b += 0.5) hits.push(b);
          if (r.chance(0.4) && hits.length >= 2) hits.splice(hits.length - 1, 0, hits[hits.length - 1] - 0.25); // a 16th pickup
          hits.sort((a, b) => a - b).forEach((b, i) => D(B0 + b, i === hits.length - 1 && r.chance(0.5) ? "snare" : "tom", 0.5 + i * 0.06, { pitch: pitches[Math.min(i + 6 - hits.length, 5)], straight: b % 0.5 !== 0 }));
        }
      }
      if (A.crash) D(0, "crash", 0.42);

      return { events: ev, harmony: prog, section: label(f, arc), state };
    },
  });
})();
