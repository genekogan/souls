// Keynote: product-launch pop for the walk-on, the live demo and the big reveal.
//
// One "event" is twelve 8-bar cycles (96 bars, about 3⅓ minutes at 116):
//   walk-on · walk-on (the riff) · "one more thing" build · big reveal ×2 · demo bed ×2 ·
//   walk-on reprise · build (up a step) · big reveal in E ×2 · applause
// Harmony (written in D; the last four cycles sit a whole step up in E):
//   walk-on  I–V–vi–IV with the V inverted (D A/C# Bm7 Gmaj9) so the bass walks down by step, then a
//            IV–ii–V7sus4 that resolves its suspension at the very last moment.
//   reveal   the cliché played straight (D A/C# Bm7 G), answered by ii–iii–IVmaj9–V7sus4. The second
//            chorus swaps the V for the bVImaj9–bVII6/9 "triumphant" cadence, which lands on the demo bed.
//   build    IV over a V/IV pedal, then a bass line that climbs E F# G A into the chorus; the modulating
//            build carries on to B, so the climb itself becomes the key change (G A B → E).
//   demo     a tonic pedal under IV and ii, with a borrowed minor iv (Gm6/D) sigh; quiet enough to talk over.
//   applause the outro turns to bVImaj9 and bVII, and bVII quietly becomes the new I (D) via A7sus4.
// Identity: a clean-piano 8th ostinato that keeps the dominant (A, later B) ringing on top of every chord,
// accented 3+3+2. A ukulele-ish riff for the walk-on, a whistled hook for the reveal, gang "whoa-oh"s,
// square-wave plucks in dotted arpeggios through a ping-pong delay, glockenspiel sparkle.
// Percussion: stomps (kick + low tom) and claps from bar one, a kick that builds from 1 to 1+3 to four
// on the floor, finger snaps, shaker, tambourine in the big choruses, a 16th clap/snare build with a noise
// riser that stops dead a beat early ("…one more thing."), crashes on every reveal, a clap-along and
// applause at the end.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  // ---------- harmony ----------
  const PROG_TEXT = {
    walk: "| Dadd9 | Asus4 A/C# | Bm7 | Gmaj9 | Dadd9/F# | Gmaj9 | Em7 | A7sus4 A7 |",
    walkB: "| Dadd9 | Asus4 A/C# | Bm7 | Gmaj9 | Dadd9/F# | Gmaj9 | Em7 F#m7 | Gmaj9 A7sus4 |",
    build: "| Gmaj9 | A/G | F#m7 | Bm7 | Em7 | F#m7 | Gmaj9 | A7sus4 |",
    buildUp: "| Gmaj9 | A/G | F#m7 | Bm7 | Em7 | F#m7 | Gmaj7 Aadd9 | B7sus4 |",
    c1: "| D | A/C# | Bm7 | G | Em7 | F#m7 | Gmaj9 | A7sus4 A7 |",
    c1b: "| D | F#m7 | Bm7 | Gmaj9 | Em7 | F#m7 | Gmaj9 | A7sus4 A7 |",
    c2: "| D | A/C# | Bm7 | G | Em7 | F#m7 | Gmaj9 | Bbmaj9 C69 |",
    demo1: "| Dadd9 | Gmaj9/D | Em7/D | Dadd9 | Dadd9 | Gmaj9/D | Em7/D | Gm6/D |",
    demo2: "| Bm7 | Gmaj9 | Dadd9/F# | Gmaj9 | Bm7 | Gmaj9 | Em11 | A7sus4 A7 |",
    cE1: "| E | B/D# | C#m7 | A | F#m7 | G#m7 | Amaj9 | B7sus4 B7 |",
    cE2: "| E | B/D# | C#m7 | Amaj9 | F#m7 | G#m7 | Amaj9 | F#m7 B7sus4 |",
    outro: "| Eadd9 | B/D# | C#m7 | Amaj9 | Eadd9/G# | Amaj9 | Cmaj9 | Dsus2 A7sus4 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v)]));

  // key: semitones above D for the tunes; end: which hook ending fits the last bar
  const PLAN = [
    { sec: "walk", prog: "walk", key: 0, intro: true, label: "Walk-on" },
    { sec: "walk", prog: "walk", key: 0, riff: true, label: "Walk-on · the riff" },
    { sec: "build", prog: "build", key: 0, label: "One more thing…" },
    { sec: "reveal", prog: "c1", key: 0, end: "a", label: "Big reveal" },
    { sec: "reveal", prog: "c2", key: 0, end: "b", big: true, label: "Big reveal · thinner, lighter, faster" },
    { sec: "demo", prog: "demo1", key: 0, label: "Demo bed" },
    { sec: "demo", prog: "demo2", key: 0, label: "Demo bed · the numbers" },
    { sec: "walk", prog: "walkB", key: 0, riff: true, reprise: true, label: "Walk-on · reprise" },
    { sec: "build", prog: "buildUp", key: 0, up: true, label: "One more thing… (and it's up a step)" },
    { sec: "reveal", prog: "cE1", key: 2, end: "a", big: true, label: "Big reveal · in E" },
    { sec: "reveal", prog: "cE2", key: 2, end: "c", big: true, label: "Big reveal · available today" },
    { sec: "outro", prog: "outro", key: 2, label: "Applause" },
  ];

  // ---------- tunes (in D) [bar, beat, dur, note] ----------
  // Walk-on riff: a rising pickup cell (5-1-2 into a long note) answered by a falling one, sequenced
  // over the progression with the peaks F#, F#, A, G.
  const RIFF = [
    [0, 0.5, 0.5, "A4"], [0, 1, 0.5, "D5"], [0, 1.5, 0.5, "E5"], [0, 2.5, 1, "F#5"], [0, 3.5, 0.5, "E5"],
    [1, 0, 1.5, "D5"], [1, 1.5, 0.5, "E5"], [1, 2, 1.5, "C#5"], [1, 3.5, 0.5, "A4"],
    [2, 0.5, 0.5, "B4"], [2, 1, 0.5, "D5"], [2, 1.5, 0.5, "E5"], [2, 2.5, 1, "F#5"], [2, 3.5, 0.5, "A5"],
    [3, 0, 2, "F#5"], [3, 2, 0.5, "E5"], [3, 2.5, 0.5, "D5"], [3, 3, 1, "A4"],
    [4, 0.5, 0.5, "A4"], [4, 1, 0.5, "D5"], [4, 1.5, 0.5, "E5"], [4, 2.5, 1, "A5"], [4, 3.5, 0.5, "F#5"],
    [5, 0, 1.5, "A5"], [5, 1.5, 0.5, "G5"], [5, 2, 1, "F#5"], [5, 3, 1, "D5"],
    [6, 0.5, 0.5, "B4"], [6, 1, 0.5, "D5"], [6, 1.5, 0.5, "E5"], [6, 2.5, 1, "G5"], [6, 3.5, 0.5, "F#5"],
  ];
  const RIFF_END = { // bar 7 over A7sus4 A7, or (reprise) Gmaj9 A7sus4
    walk: [[7, 0, 1.5, "E5"], [7, 1.5, 0.5, "D5"], [7, 2, 1.75, "C#5"]],
    walkB: [[7, 0, 1.5, "F#5"], [7, 1.5, 0.5, "E5"], [7, 2, 1.75, "D5"]],
  };
  const RIFF_B6 = [[6, 0.5, 0.5, "B4"], [6, 1, 0.5, "D5"], [6, 1.5, 0.5, "E5"], [6, 2.5, 1, "A5"], [6, 3.5, 0.5, "G#5"]]; // Em7 F#m7 bar
  // Reveal hook: a 3-3-2 cell that leaps to its peak (D, then B, then E) and a stepwise answer each time.
  const HOOK = [
    [0, 0, 0.75, "F#5"], [0, 0.75, 0.75, "A5"], [0, 1.5, 1, "D6"], [0, 2.5, 0.5, "C#6"], [0, 3, 1, "A5"],
    [1, 0.5, 0.5, "A5"], [1, 1, 0.5, "B5"], [1, 1.5, 1, "C#6"], [1, 2.5, 1.5, "A5"],
    [2, 0, 0.75, "D5"], [2, 0.75, 0.75, "F#5"], [2, 1.5, 1, "B5"], [2, 2.5, 0.5, "A5"], [2, 3, 1, "F#5"],
    [3, 0.5, 0.5, "F#5"], [3, 1, 0.5, "G5"], [3, 1.5, 1, "A5"], [3, 2.5, 1.5, "B5"],
    [4, 0, 0.75, "G5"], [4, 0.75, 0.75, "B5"], [4, 1.5, 1, "E6"], [4, 2.5, 0.5, "D6"], [4, 3, 1, "B5"],
    [5, 0.5, 0.5, "A5"], [5, 1, 0.5, "B5"], [5, 1.5, 1, "C#6"], [5, 2.5, 1.5, "A5"],
    [6, 0, 1, "B5"], [6, 1, 0.5, "A5"], [6, 1.5, 1, "G5"], [6, 2.5, 1.5, "A5"],
  ];
  const HOOK_END = {
    a: [[7, 0, 2, "D6"], [7, 2, 1.75, "C#6"]],                       // sus4 → 3 over A7sus4 A7
    b: [[7, 0, 1.5, "D6"], [7, 1.5, 0.5, "C6"], [7, 2, 1.75, "E6"]], // over Bbmaj9 C6/9
    c: [[7, 0, 1.5, "B5"], [7, 1.5, 0.5, "A5"], [7, 2, 1.75, "D6"]], // over ii and V7sus4
  };
  // Outro tag (written in E): the hook's first half, then a farewell over bVImaj9 → bVII → V of D.
  const OUTRO_TAG = [
    [4, 0, 1.5, "G#5"], [4, 1.5, 0.5, "F#5"], [4, 2, 1.75, "E5"],
    [5, 0.5, 0.5, "C#6"], [5, 1, 2.5, "B5"],
    [6, 0, 3.5, "B5"],
    [7, 0, 3.6, "A5"],
  ];
  // Build: the choir's top line climbs one chord tone per chord.
  const BUILD_TOPS = { build: [67, 69, 69, 71, 71, 73, 74, 74], buildUp: [67, 69, 69, 71, 71, 73, 74, 76, 76] };

  // ---------- rhythm tables ----------
  const OST = [ // piano 8ths: 0/1 = the two low chord tones, "P" = the ringing pedal on top
    [0, "P", 1, "P", 0, "P", 1, "P"],
    [0, 1, "P", 1, 0, "P", 1, "P"],
    [0, "P", 1, "P", 1, "P", 0, "P"],
  ];
  const STRUM = {
    island: [[0, "D"], [1, "D"], [1.5, "U"], [2.5, "U"], [3, "D"], [3.5, "U"]],
    drive: [[0, "D"], [0.75, "U"], [1, "D"], [1.5, "U"], [2, "D"], [2.5, "U"], [2.75, "U"], [3, "D"], [3.5, "U"]],
    quarters: [[0, "D"], [1, "D"], [2, "D"], [3, "D"]],
    eighths: [[0, "D"], [0.5, "U"], [1, "D"], [1.5, "U"], [2, "D"], [2.5, "U"], [3, "D"], [3.5, "U"]],
  };
  const DOTTED = [0, 0.75, 1.5, 2.25, 3, 3.5]; // 3+3+3+3+2+2 sixteenths
  const FILLS = {
    toms: [[3, "tom", 0.6, 52], [3.25, "tom", 0.62, 48], [3.5, "tom", 0.68, 45], [3.75, "tom", 0.74, 40]],
    claps: [[3, "clap", 0.45], [3.25, "clap", 0.52], [3.5, "clap", 0.62], [3.75, "clap", 0.72]],
    stomps: [[2.5, "tom", 0.55, 40], [3, "tom", 0.62, 40], [3.5, "tom", 0.7, 40], [3.75, "tom", 0.78, 40]],
    snare: [[3, "rockSnare", 0.4], [3.25, "rockSnare", 0.48], [3.5, "rockSnare", 0.58], [3.75, "rockSnare", 0.68]],
  };

  // ---------- helpers ----------
  const keyName = (k) => (k ? "E" : "D");
  /** Two chord tones under the pedal (never a semitone from it), led smoothly from the last pair. */
  function pianoLows(sym, pedal, prev) {
    const c = T.chord(sym), pp = mod12(pedal);
    const bad = new Set([pp, mod12(pp + 1), mod12(pp - 1)]);
    const pcs = c.pcs.filter((p) => !bad.has(p));
    const cand = T.notesIn(pcs, 55, pedal - 2);
    let best = null, bs = Infinity;
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j], gap = b - a;
      if ((gap < 3 && !(gap === 2 && a >= 60)) || gap > 9) continue;
      let s = -2.5 * (c.guide.includes(mod12(a)) + c.guide.includes(mod12(b)));
      if (mod12(a) === c.root) s += 1;
      s += prev ? (Math.abs(a - prev[0]) + Math.abs(b - prev[1])) * 0.8 : Math.abs(b - 64) * 0.3;
      if (s < bs) { bs = s; best = [a, b]; }
    }
    if (best) return best;
    const x = T.nearest(prev ? prev[1] : 64, pcs.length ? pcs : c.pcs, 57, pedal - 3);
    return [x, x];
  }
  /** Close voices under a fixed top note: gaps of 3-7 semitones, no minor 9ths against anything above. */
  function underTop(sym, top, n) {
    const c = T.chord(sym);
    const pref = [...new Set(c.guide.concat(c.colors, [mod12(c.root + 7), c.root], c.pcs))].filter((p) => p !== mod12(top));
    const out = [top];
    let cur = top;
    for (let k = 0; k < n; k++) {
      let pick = null, best = Infinity;
      for (let m = cur - 3; m >= cur - 7; m--) {
        const rank = pref.indexOf(mod12(m));
        if (rank < 0 || out.some((x) => mod12(x) === mod12(m) || Math.abs(x - m) % 12 === 1)) continue;
        const s = rank + (cur - m - 3) * 0.3;
        if (s < best) { best = s; pick = m; }
      }
      if (pick == null) break;
      out.push(pick); cur = pick;
    }
    return out.sort((a, b) => a - b);
  }
  /** Ukulele shape: the plain triad (plus a minor or dominant 7th) in close position, top string doubling. */
  function ukeVoice(sym, prev) {
    const c = T.chord(sym);
    const keepIv = new Set([0, 3, 4, 6, 7, 8, 10]);
    if (c.sus) { keepIv.add(17); keepIv.add(14); }
    let pcs = [...new Set(c.intervals.filter((i) => keepIv.has(i)).map((i) => mod12(c.root + i)))];
    if (c.sus && pcs.length > 4) pcs = pcs.filter((p) => p !== mod12(c.root + 2));
    const order = pcs.slice().sort((a, b) => mod12(a - c.root) - mod12(b - c.root));
    let best = null, bs = Infinity;
    for (let rot = 0; rot < order.length; rot++) {
      const o = order.slice(rot).concat(order.slice(0, rot));
      for (let base = 60; base <= 71; base++) {
        if (mod12(base) !== o[0]) continue;
        const v = [base];
        for (let i = 1; i < o.length; i++) { let x = v[i - 1] + 1; while (mod12(x) !== o[i]) x++; v.push(x); }
        if (v.length === 3 && v[0] + 12 <= 81) v.push(v[0] + 12);
        const top = v[v.length - 1];
        if (top > 81 || v[0] < 62) continue;
        let s = prev ? v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0) : Math.abs(top - 75) * 2;
        if (top < 71) s += (71 - top) * 2;
        if (s < bs) { bs = s; best = v; }
      }
    }
    return best || T.voice(sym, { lo: 62, hi: 79, n: 3, rootless: false });
  }
  /** T.voice without semitones or minor 9ths between voices. */
  // (o.avoid: pitches such as the piano's pedal that no voice may rub against by a semitone or minor 9th)
  const rub = (a, b) => Math.abs(b - a) === 1 || Math.abs(b - a) === 13;
  const rough = (v, avoid = []) => v.some((a, i) => v.some((b, j) => j > i && rub(a, b)) || avoid.some((x) => rub(a, x)));
  function voiceClean(sym, o) {
    const tries = [o, { ...o, spread: "close" }, { ...o, spread: "drop2" }, { ...o, n: (o.n ?? 4) - 1 }, { ...o, n: (o.n ?? 4) - 1, spread: "close" }, { ...o, n: 2 }, { ...o, n: 2, spread: "close" }];
    for (const x of tries) { const v = T.voice(sym, x); if (!rough(v, o.avoid)) return v; }
    const v = T.voice(sym, { ...o, n: 3 });
    return v.filter((m) => !(o.avoid || []).some((x) => rub(m, x)));
  }

  Sim.register({
    id: "keynote",
    title: "Keynote",
    genre: "Tech keynote",
    about: "Walk-on, demo-bed and big-reveal music for a product launch: a clean-piano ostinato with the fifth ringing on top, a ukulele riff, stomps, claps and snaps, a “one more thing” build that stops dead, and a whistled chorus on I–V–vi–IV that finally goes up a step.",
    situations: ["presentation", "work", "celebrate"],
    energy: 0.6,
    bpm: 116, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 300, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.03, lowcut: 350, highcut: 7000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.3, pingPong: true, highcut: 4200 });

      const whistle = I.whistle(ctx, { volume: -1, vibratoDepth: 0.035 });
      const uke = I.guitar(ctx, { kind: "clean", volume: -4, dampening: 6000, resonance: 0.93, attackNoise: 1.3, voices: 12 });
      const piano = I.softPiano(ctx, { volume: -6, cutoff: 5200, decay: 2.4, release: 1 });
      const pluck = I.pluck(ctx, { volume: -13, wave: "square", cutoff: 1100, decay: 0.2, filterDecay: 0.1, octaves: 2.6, resonance: 1 });
      const glock = I.glock(ctx, { volume: -13, decay: 1.7 });
      const choir = I.choir(ctx, { volume: -11, vowel: "o", attack: 0.07, release: 0.7 });
      const saw = I.supersaw(ctx, { volume: -19, cutoff: 2400, attack: 0.3, release: 0.9, detune: 24 });
      const bass = I.ebass(ctx, { volume: -4, base: 210 });
      const kit = I.kit(ctx, { volume: -2, kickNote: 31, preload: ["kick", "tom", "clap", "snap", "shaker", "hatClosed", "hatOpen"] });

      // noise riser for the builds: always-running noise behind a gain and a sweeping band-pass
      const riserG = ctx.keep(new Tone.Gain(0));
      const riserF = ctx.keep(new Tone.Filter({ frequency: 350, type: "bandpass", Q: 1.4 }));
      const riserN = ctx.keep(new Tone.Noise({ type: "white" }).start());
      riserN.connect(riserF); riserF.connect(riserG);
      const riserP = ctx.keep(new Tone.Panner(0)); riserG.connect(riserP); riserP.connect(out);
      const riserT = I.monotonic(riserG);

      // applause: three small clap "crowds" across the stereo field and a pink-noise swell
      const crowd = [-0.55, 0.05, 0.6].map((pan) => { const k = I.kit(ctx, { volume: -15 }); I.place(ctx, k, pan, out); return k; });
      const swellOut = ctx.keep(new Tone.Gain(Math.pow(10, -24 / 20))); swellOut.connect(out);
      const swellF = ctx.keep(new Tone.Filter({ frequency: 2300, type: "bandpass", Q: 0.5 })); swellF.connect(swellOut);
      const swell = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 1.2, decay: 0.2, sustain: 1, release: 1.6 } })); swell.connect(swellF);
      const swellT = I.monotonic(swell);

      const wp = I.place(ctx, whistle, 0.06, out), up = I.place(ctx, uke, 0.32, out), pp = I.place(ctx, piano, -0.22, out);
      const plp = I.place(ctx, pluck, -0.4, out), gp = I.place(ctx, glock, 0.42, out), cp = I.place(ctx, choir, -0.08, out);
      const sp = I.place(ctx, saw, 0, out);
      I.place(ctx, bass, 0, out);
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, wp, hall, -11); I.send(ctx, wp, echo, -17);
      I.send(ctx, up, room, -12); I.send(ctx, pp, room, -11); I.send(ctx, pp, hall, -19);
      I.send(ctx, plp, echo, -9); I.send(ctx, plp, hall, -16);
      I.send(ctx, gp, hall, -9); I.send(ctx, gp, echo, -14);
      I.send(ctx, cp, hall, -8); I.send(ctx, sp, hall, -12);
      I.send(ctx, kp, room, -15); I.send(ctx, riserP, hall, -6);

      return {
        whistle: { layer: "melody", play: (t, e, d) => whistle.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.04 } },
        riff: { layer: "melody", play: (t, e, d) => uke.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.06 } },
        strum: { layer: "harmony", play: (t, e, d) => uke.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.006, vel: 0.07 } },
        piano: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        choir: { layer: "harmony", play: (t, e, d) => choir.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.04 } },
        saw: { layer: "harmony", play: (t, e, d) => saw.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        pluck: { layer: "texture", play: (t, e, d) => pluck.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.05 } },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        riser: {
          layer: "texture",
          play: (t, e, d) => {
            const tt = riserT(t), g = riserG.gain, f = riserF.frequency;
            g.cancelScheduledValues(tt); g.setValueAtTime(0, tt); g.linearRampToValueAtTime(0.22 * e.vel, tt + d); g.linearRampToValueAtTime(0, tt + d + 0.05);
            f.cancelScheduledValues(tt); f.setValueAtTime(350, tt); f.exponentialRampToValueAtTime(7500, tt + d);
          },
          humanize: { timing: 0, vel: 0 },
        },
        crowd: {
          layer: "texture",
          play: (t, e, d) => { if (e.note === "swell") swell.triggerAttackRelease(d, swellT(t), e.vel); else crowd[e.who].hit("clap", t, e.vel); },
          humanize: { timing: 0.01, vel: 0.25 },
        },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.005, vel: 0.07 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const round = Math.floor(cycle / 12), idx = cycle % 12;
      const P = PLAN[idx];
      const progName = P.prog === "c1" && round % 2 === 1 ? "c1b" : P.prog;
      const prog = PROGS[progName];
      const k = P.key, sec = P.sec;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const spans = prog.map((c) => ({ ...c, s0: c.bar * 4 + c.beat }));
      const intro = !!P.intro;
      const stopAt = sec === "build" ? 31 : 32; // "…one more thing." — everything but the riser stops a beat early
      const big = !!P.big;

      // ---------- melody ----------
      const mel = [];
      const toMel = (src, shift) => src.forEach(([b, x, d, n]) => mel.push({ at: b * 4 + x, dur: d, note: T.midi(n) + shift }));
      if (sec === "reveal") {
        toMel(HOOK.concat(HOOK_END[P.end]), k);
        if (round > 0) { // later rounds: an upper-neighbour turn at the end of some long notes
          for (let i = mel.length - 1; i >= 0; i--) {
            const n = mel[i];
            if (n.dur < 1.5 || !r.chance(0.35)) continue;
            const up = T.step(n.note, 1, T.chord(sym(n.at + n.dur - 0.5)).scale);
            if (up - n.note > 2) continue;
            mel.splice(i, 1, { at: n.at, dur: n.dur - 0.5, note: n.note }, { at: n.at + n.dur - 0.5, dur: 0.25, note: up }, { at: n.at + n.dur - 0.25, dur: 0.25, note: n.note });
          }
        }
        mel.forEach((n) => {
          const onBeat = Math.abs(n.at - Math.round(n.at)) < 1e-6;
          push("whistle", n.at, n.dur >= 0.5 ? n.dur - 0.05 : n.dur * 0.9, n.note, 0.7 + (n.dur >= 1 ? 0.05 : 0) + (onBeat ? 0.03 : 0) + r.gauss(0.02));
          if (big && k > 0 && n.dur >= 0.75) push("glock", n.at, n.dur, n.note, 0.3);
        });
      } else if (sec === "outro") {
        toMel(HOOK.filter(([b]) => b < 4), k);
        OUTRO_TAG.forEach(([b, x, d, n]) => mel.push({ at: b * 4 + x, dur: d, note: T.midi(n) }));
        mel.forEach((n) => push("whistle", n.at, n.dur >= 0.5 ? n.dur - 0.05 : n.dur * 0.9, n.note, (0.68 + (n.dur >= 1 ? 0.04 : 0)) * (n.at >= 16 ? 0.9 : 1)));
      } else if (sec === "walk" && (P.riff || intro)) {
        let src = RIFF.concat(RIFF_END[progName]);
        if (progName === "walkB") src = RIFF.filter(([b]) => b < 6).concat(RIFF_B6, RIFF_END.walkB);
        if (intro) src = src.filter(([b]) => b >= 4); // the riff enters halfway through the walk-on
        src.forEach(([b, x, d, n]) => mel.push({ at: b * 4 + x, dur: d, note: T.midi(n) + k }));
        if (round > 0 || P.reprise) { // vary the peaks now and then: neighbouring chord tone on the long notes
          mel.forEach((n) => {
            if (n.dur < 1 || n.at % 4 === 0 || !r.chance(0.3)) return;
            const c = T.chord(sym(n.at)), alt = T.notesIn(c.pcs, n.note - 4, n.note + 4).filter((m) => m !== n.note && m <= 81);
            if (alt.length) n.note = r.pick(alt);
          });
        }
        mel.forEach((n) => {
          const onBeat = Math.abs(n.at - Math.round(n.at)) < 1e-6;
          push("riff", n.at, Math.max(0.3, n.dur - 0.05), n.note, 0.62 + (n.dur >= 1 ? 0.06 : 0) + (onBeat ? 0.03 : 0) + r.gauss(0.03));
          if (P.reprise && n.dur >= 1) push("glock", n.at, n.dur - 0.05, n.note + 12, 0.26);
        });
      }

      // ---------- piano ----------
      const pedal = 69 + k;
      const ostPat = OST[(idx + round) % OST.length];
      const pump = sec === "reveal" || (sec === "outro" && true);
      const demo = sec === "demo";
      spans.forEach((c) => {
        const lows = pianoLows(c.chord, pedal, state.pl);
        state.pl = lows;
        for (let p = 0; p < c.dur - 1e-6; p += 0.5) {
          const at = c.s0 + p;
          if (at >= stopAt - 1e-6) break;
          if (sec === "outro" && at >= 30) break;
          const i8 = Math.round(at * 2) % 8;
          const acc = i8 === 0 || i8 === 3 || i8 === 6;
          let vel, note;
          if (pump && big && sec === "reveal") { // big chorus: only the 3+3+2 accents, held, so the uke and plucks carry the 16ths
            if (!acc) continue;
            push("piano", at, Math.min(i8 === 6 ? 0.95 : 1.45, c.s0 + c.dur - at - 0.05), lows.concat([pedal]).filter((m, j, a) => a.indexOf(m) === j), 0.52 + r.range(-0.02, 0.02));
            continue;
          }
          if (pump) { note = lows.concat([pedal]).filter((m, j, a) => a.indexOf(m) === j); vel = acc ? 0.5 : 0.34; }
          else {
            const slot = ostPat[i8];
            note = slot === "P" ? pedal : lows[slot];
            vel = (acc ? 0.56 : 0.42) * (demo ? 0.8 : 1);
            if (sec === "build") vel *= 0.85 + 0.25 * (at / 32);
          }
          push("piano", at, pump ? 0.42 : 0.5, note, vel + r.range(-0.02, 0.02));
        }
        if (demo || (sec === "walk" && intro)) { // left hand: the bass note an octave up, held
          const lh = T.nearest(50, [T.chord(c.chord).bass], 45, 55);
          push("piano", c.s0, c.dur - 0.1, lh, demo ? 0.4 : 0.34);
        }
      });
      if (sec === "outro") push("piano", 30, 1.9, state.pl.concat([pedal]), 0.4);

      // ---------- ukulele strums ----------
      const strumOn = sec === "reveal" || sec === "build" || sec === "outro";
      if (strumOn) {
        const hits = [];
        for (let bar = 0; bar < 8; bar++) {
          let pat;
          if (sec === "build") pat = bar < 4 ? STRUM.quarters : bar < 7 ? STRUM.eighths : [[0, "D"]];
          else if (sec === "outro") pat = bar < 6 ? STRUM.island : bar === 6 ? STRUM.quarters : [[0, "D"], [2, "D"]];
          else pat = big ? STRUM.drive : STRUM.island;
          pat.forEach(([b, dir]) => hits.push({ at: bar * 4 + b, dir }));
        }
        hits.forEach((h, i) => {
          if (h.at >= stopAt - 1e-6) return;
          const next = i + 1 < hits.length ? hits[i + 1].at : 32;
          const s = sym(h.at);
          const v = ukeVoice(s, state.uv);
          state.uv = v;
          const notes = h.dir === "U" ? v.slice(-3) : v;
          const ce = chordAt(h.at), chordEnd = ce.bar * 4 + ce.beat + ce.dur;
          let dur = Math.min(next, stopAt, chordEnd) - h.at - 0.05;
          if (sec === "build" && h.at >= 28) dur = stopAt - h.at - 0.1;
          const vel = (h.dir === "D" ? 0.5 : 0.36) * (sec === "build" ? 0.75 + 0.35 * (h.at / 32) : 1) + r.range(-0.03, 0.03);
          push("strum", h.at, Math.max(0.2, dur), notes, vel, { strum: h.dir === "D" ? 0.011 : -0.008 });
        });
      }

      // ---------- plucks ----------
      if ((sec === "reveal" && big) || sec === "build" || (sec === "demo" && progName === "demo2")) {
        spans.forEach((c) => {
          const v = voiceClean(c.chord, { lo: 62, hi: 79, n: 4, prev: state.plv, top: [74, 79], omitBass: true, avoid: [pedal] });
          state.plv = v;
          const order = v.concat(v.slice(1, -1).reverse());
          let i = 0;
          if (sec === "build") {
            for (let p = 0; p < c.dur - 1e-6; p += 0.25) {
              const at = c.s0 + p;
              if (at < 16 || at >= stopAt - 1e-6) continue;
              push("pluck", at, 0.2, order[i++ % order.length], 0.3 + 0.35 * ((at - 16) / 16) + (p % 1 === 0 ? 0.06 : 0));
            }
          } else {
            for (let bar = c.bar; bar * 4 < c.s0 + c.dur - 1e-6; bar++) {
              DOTTED.forEach((p) => {
                const at = bar * 4 + p;
                if (at < c.s0 - 1e-6 || at >= c.s0 + c.dur - 1e-6) return;
                push("pluck", at, 0.3, order[i++ % order.length], (demo ? 0.3 : 0.44) + (p === 0 ? 0.08 : 0));
              });
            }
          }
        });
      }

      // ---------- choir ----------
      if (sec === "build") {
        const tops = BUILD_TOPS[progName];
        spans.forEach((c, i) => {
          const top = tops[i] + k;
          const v = underTop(c.chord, top, 3);
          const end = Math.min(c.s0 + c.dur, stopAt) - 0.08;
          push("choir", c.s0, end - c.s0, v, 0.3 + 0.28 * (c.s0 / 32));
        });
      } else if ((sec === "reveal" && big) || sec === "outro") {
        const bars = sec === "outro" ? [0, 1, 2, 3, 5] : [1, 3, 5];
        bars.forEach((bar) => {
          const s = sym(bar * 4 + 2.5);
          const v = voiceClean(s, { lo: 57, hi: 71, n: 3, prev: state.cv, top: [66, 71], omitBass: true, avoid: [pedal] });
          state.cv = v;
          push("choir", bar * 4 + 2.5, 0.45, v, 0.4);
          push("choir", bar * 4 + 3, 0.9, v, 0.5);
        });
      }

      // ---------- supersaw pad ----------
      if (sec === "reveal" || (sec === "outro")) {
        spans.forEach((c) => {
          if (sec === "outro" && c.s0 >= 24) return;
          const v = voiceClean(c.chord, { lo: 55, hi: 74, n: 4, prev: state.sv, top: [67, 74], avoid: [pedal] });
          state.sv = v;
          push("saw", c.s0, c.dur - 0.05, v, big ? 0.42 : 0.34);
        });
      } else if (demo) {
        spans.forEach((c) => {
          const v = voiceClean(c.chord, { lo: 60, hi: 79, n: 3, prev: state.sv, top: [74, 79], avoid: [pedal] });
          state.sv = v;
          push("saw", c.s0, c.dur - 0.05, v, 0.24);
        });
      }

      // ---------- glock sparkle ----------
      const ring = (at) => { const h = chordAt(at); return Math.max(0.25, Math.min(1, h.bar * 4 + h.beat + h.dur - at - 0.05)); };
      if (sec === "walk" || demo || (sec === "reveal" && !(big && k > 0)) || sec === "outro") {
        for (let bar = 0; bar < 8; bar++) {
          const chance = demo ? (bar % 2 ? 0.7 : 0) : sec === "walk" ? (intro && bar < 4 ? 0 : 0.45) : 0.3;
          if (!r.chance(chance)) continue;
          const at = bar * 4 + (demo ? 2.5 : r.pick([1.5, 3.5, 2.5]));
          const c = T.chord(sym(at));
          const tones = T.notesIn(c.guide.concat(c.colors, [mod12(c.root + 7)]), 84, 93);
          if (!tones.length) continue;
          const n = r.pick(tones);
          if (!demo && r.chance(0.3) && at % 4 <= 3) {
            const run = [T.step(n, -2, c.scale), T.step(n, -1, c.scale), n];
            run.forEach((m, j) => push("glock", at + j * 0.25, j === 2 ? ring(at + 0.5) : 0.25, m, 0.3 + j * 0.04));
          } else push("glock", at, ring(at), n, demo ? 0.26 : 0.32);
        }
      }

      // ---------- bass ----------
      let root = state.bassRoot ?? 38 + k;
      const keyScale = T.scale(2 + k, "ionian");
      const rootOf = (pc, near) => T.nearest(near, [pc], 38, 50);
      const nextFirst = PROGS[PLAN[(idx + 1) % 12].prog][0].chord;
      spans.forEach((c, i) => {
        const ch = T.chord(c.chord);
        root = rootOf(ch.bass, demo ? 41 : root);
        const nextSym = i + 1 < spans.length ? spans[i + 1].chord : nextFirst;
        const nextRoot = rootOf(T.chord(nextSym).bass, root);
        // approach the next root by a diatonic step (from the side we are coming from), or by the fifth
        let approach = T.step(nextRoot, nextRoot > root ? -1 : 1, keyScale);
        if (!ch.scale.includes(mod12(approach)) || approach === root || [1, 11].includes(mod12(approach - root))) approach = T.nearest(root + 7, [mod12(ch.root + 7)], 38, 52);
        const doApproach = nextRoot !== root && r.chance(sec === "build" ? 0.8 : 0.55);
        for (let p = 0; p < c.dur - 1e-6; p += 0.5) {
          const at = c.s0 + p;
          if (at >= stopAt - 1e-6) break;
          let mode;
          if (demo) mode = "whole";
          else if (sec === "walk") mode = intro && at < 16 ? null : "eighths";
          else if (sec === "build") mode = at >= 28 ? "hold" : "eighths";
          else if (sec === "outro") mode = at >= 24 ? "whole" : "eighths";
          else mode = big ? "octaves" : "eighths";
          if (!mode) continue;
          const onBeat = p % 1 === 0, lastEighth = p >= c.dur - 0.5 - 1e-6;
          if (mode === "whole") { if (p === 0) push("bass", at, c.dur - 0.15, root, 0.74); continue; }
          if (mode === "hold") { if (at === 28) push("bass", at, stopAt - at - 0.1, root, 0.82); continue; }
          let n = root;
          if (mode === "octaves" && !onBeat) n = root + 12 <= 55 ? root + 12 : root;
          if (lastEighth && doApproach && c.dur >= 2) n = approach;
          const vel = (onBeat ? 0.8 : 0.6) * (sec === "build" ? 0.8 + 0.25 * (at / 32) : 1) * (sec === "walk" ? 0.92 : 1);
          push("bass", at, 0.42, Math.max(36, Math.min(55, n)), vel);
        }
      });
      state.bassRoot = root;

      // ---------- riser ----------
      if (sec === "build") push("riser", 16, 16, null, 0.9);

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      const hats16 = (B, from, to, voice, vels) => { for (let s = 0; s < 16; s++) { const b = s / 4; if (b >= from && b < to) D(B + b, voice, vels[s % 4] + r.range(-0.02, 0.02)); } };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4, last = bar === 7;
        let fill = null;
        if (last) {
          if (sec === "walk") fill = intro ? "stomps" : r.pick(["claps", "toms"]);
          else if (sec === "reveal") fill = P.end === "b" ? "snare" : r.pick(["toms", "snare"]);
          else if (sec === "demo" && progName === "demo2") fill = "claps";
        }
        const cut = fill ? FILLS[fill][0][0] : 4;
        const keep = (b) => b < cut - 1e-6;
        if (sec === "walk") {
          const kicks = intro && round === 0 ? (bar < 2 ? [0] : bar < 4 ? [0, 2] : [0, 1, 2, 3]) : intro ? (bar < 2 ? [0, 2] : [0, 1, 2, 3]) : [0, 1, 2, 3];
          kicks.filter(keep).forEach((b) => D(B + b, "kick", b % 2 ? 0.55 : 0.72));
          [0, 2].filter(keep).forEach((b) => D(B + b, "tom", 0.5, { pitch: 40 }));      // stomps
          [1, 3].filter(keep).forEach((b) => D(B + b, "clap", 0.66));
          if (!intro || bar >= 2) [1, 3].filter(keep).forEach((b) => D(B + b, "snap", 0.42));
          if (!intro || bar >= 4) hats16(B, 0, cut, "shaker", [0.3, 0.13, 0.22, 0.15]);
          else if (bar >= 2) [0.5, 1.5, 2.5, 3.5].filter(keep).forEach((b) => D(B + b, "shaker", 0.24));
          if (P.reprise) [0.5, 1.5, 2.5, 3.5].filter(keep).forEach((b) => D(B + b, "tambourine", 0.3));
          if (!intro && bar % 2 === 1 && keep(3.5) && r.chance(0.4)) D(B + 3.5, "hatOpen", 0.22);
        } else if (sec === "build") {
          if (bar < 7) {
            (bar < 4 ? [0, 1, 2, 3] : bar < 6 ? [0, 1, 2, 3] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]).forEach((b) => D(B + b, "kick", 0.6 + bar * 0.03));
            [0, 2].forEach((b) => D(B + b, "tom", 0.45 + bar * 0.03, { pitch: 40 }));
            (bar < 4 ? [1, 3] : bar < 6 ? [0, 1, 2, 3] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]).forEach((b, j) => D(B + b, "clap", 0.5 + bar * 0.03 + (bar >= 6 ? j * 0.02 : 0)));
            [0.5, 1.5, 2.5, 3.5].forEach((b) => D(B + b, "hatClosed", 0.3 + bar * 0.02));
            if (bar === 0) D(B, "crash", 0.3);
          } else {
            // 16th snare/clap roll, crescendo, then nothing for a beat
            for (let s = 0; s < 12; s++) { const b = s / 4; D(B + b, "rockSnare", 0.35 + s * 0.045); if (s % 2 === 0) D(B + b, "clap", 0.4 + s * 0.03); }
            [0, 1, 2].forEach((b) => D(B + b, "kick", 0.8));
          }
        } else if (sec === "reveal" || (sec === "outro" && bar < 6)) {
          const clapAlong = sec === "outro" && bar >= 4;
          [0, 1, 2, 3].filter(keep).forEach((b) => D(B + b, "kick", 0.84));
          [0, 2].filter(keep).forEach((b) => D(B + b, "tom", 0.42, { pitch: 40 }));
          (clapAlong ? [0, 1, 2, 3] : [1, 3]).filter(keep).forEach((b) => { D(B + b, "clap", b % 2 ? 0.74 : 0.6); if (b % 2) D(B + b, "rockSnare", 0.5); });
          for (let s = 0; s < 8; s++) {
            const b = s / 2;
            if (!keep(b)) continue;
            if (s === 7 && !last) D(B + b, "hatOpen", 0.3);
            else D(B + b, "hatClosed", s % 2 ? 0.4 : 0.28);
          }
          if (big || clapAlong) hats16(B, 0, cut, "tambourine", [0.36, 0.16, 0.26, 0.18]);
          if (bar === 0) D(B, "crash", sec === "outro" ? 0.45 : big ? 0.68 : 0.6);
          if (bar === 4 && big) D(B, "crash", 0.38);
          if (sec === "reveal" && P.end === "b" && last) { D(B + 2, "kick", 0.9); D(B + 2, "crash", 0.42); }
        } else if (sec === "outro") {
          // bars 6-7: stomp-clap with the applause, then out
          (bar === 6 ? [0, 2] : [0]).forEach((b) => { D(B + b, "kick", 0.66); D(B + b, "tom", 0.5, { pitch: 40 }); });
          (bar === 6 ? [1, 3] : [1]).forEach((b) => D(B + b, "clap", 0.62));
        } else if (demo) {
          const soft = progName === "demo1";
          D(B, "kick", soft ? 0.4 : 0.5);
          if (!soft && keep(2.5)) D(B + 2.5, "kick", 0.36);
          if (!soft && keep(2)) D(B + 2, "kick", 0.44);
          [1, 3].filter(keep).forEach((b) => D(B + b, "snap", soft ? 0.4 : 0.48));
          for (let s = 0; s < 8; s++) { const b = s / 2; if (keep(b) && (!soft || s % 2)) D(B + b, "shaker", s % 2 ? 0.2 : 0.13); }
        }
        if (fill) FILLS[fill].forEach(([b, voice, vel, pitch]) => D(B + b, voice, vel, pitch ? { pitch } : undefined));
      }

      // ---------- applause ----------
      if (sec === "outro") {
        push("crowd", 20, 11.5, "swell", 0.7);
        for (let b = 20; b < 31.6; b += 0.125) {
          const dens = Math.min(1, (b - 20) / 3) * (b > 29 ? (31.6 - b) / 2.6 : 1);
          for (let w = 0; w < 3; w++) if (r.chance(0.55 * dens)) push("crowd", b + r.range(0, 0.1), 0.1, "clap", 0.2 + r() * 0.5, { who: w, straight: true });
        }
      }

      const label = `${P.label}${idx === 0 || idx === 9 ? ` · ${keyName(k)} major` : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
