// Campfire: friends around a fire with a steel-string guitar, a second guitar capo'd high, a
// harmonica and a cajon. Crickets and a crackling fire are synthesized in this file.
//
// The song is composed, not generated: a verse tune, a singalong chorus and a bridge in the
// relative minor, written below in a compact note syntax (in G; a capo moves everything).
// What the code does is what the players do with it: travis picking in the verses (alternating
// thumb bass, pinches and treble picks), boom-chuck strumming with bass walk-ups in the choruses,
// harmonica ornaments and bends that change on every pass, a cajon that comes in after the first
// verse and builds to handclaps and tambourine in the big chorus.
//
// One round (11 cycles of 8 bars, about 3.7 minutes at 96 BPM):
//   intro: guitar, crickets and the fire, then a harmonica tag
//   verse 1 (16 bars): guitar and harmonica only (in odd rounds the capo'd guitar takes the tune)
//   chorus 1: strumming, the cajon groove and shaker enter, high guitar arpeggios
//   verse 2: fingerpicking again over a lighter cajon, finger snaps, high guitar chimes
//   chorus 2, then a bridge in E minor (half-time cajon) that ends on B7
//   big chorus twice: handclaps and tambourine, the second time up a whole step with two harmonicas
//   a quiet last verse with just the guitar (playing the tune in its chord shapes) and the crickets
// Rounds alternate G and A, so the round after a last verse in A starts in A; the next one, after
// a last verse in B, drops a major third back to G.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BARS = 8, BPM = 96;
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const db = (x) => Math.pow(10, x / 20);
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const trName = (n, k) => SHARP[mod(T.PC[n] + k, 12)];
  const trSym = (sym, k) => (k === 0 ? sym : sym.replace(/^([A-G][#b]?)/, (_, n) => trName(n, k)).replace(/\/([A-G][#b]?)$/, (_, n) => "/" + trName(n, k)));

  // ---------- guitar 1: open-position shapes in G (the capo transposes them) ----------
  // b: thumb strings [root, alternate, second alternate]; t: treble strings [G, B, high E]; s: strum, low to high
  const GV = {
    G: { b: [43, 50, 47], t: [55, 62, 67], s: [43, 47, 50, 55, 62, 67] },
    Cadd9: { b: [48, 52, 43], t: [55, 62, 67], s: [48, 52, 55, 62, 67] },
    Em7: { b: [40, 52, 47], t: [55, 62, 67], s: [40, 47, 52, 55, 62, 67] },
    Em: { b: [40, 52, 47], t: [55, 59, 64], s: [40, 47, 52, 55, 59, 64] },
    D: { b: [50, 45, 42], t: [57, 62, 66], s: [50, 57, 62, 66] },
    Dsus4: { b: [50, 45, 45], t: [57, 62, 67], s: [50, 57, 62, 67] },
    "D/F#": { b: [42, 50, 45], t: [57, 62, 66], s: [42, 50, 57, 62, 66] },
    Am7: { b: [45, 52, 40], t: [55, 60, 64], s: [45, 52, 55, 60, 64] },
    "G/B": { b: [47, 50, 47], t: [55, 62, 67], s: [47, 50, 55, 62, 67] },
    Cmaj7: { b: [48, 52, 43], t: [55, 59, 64], s: [48, 52, 55, 59, 64] },
    B7: { b: [47, 51, 42], t: [57, 59, 66], s: [47, 51, 57, 59, 66] },
    A7sus4: { b: [45, 52, 40], t: [57, 62, 64], s: [45, 52, 57, 62, 64] },
    A7: { b: [45, 52, 40], t: [57, 61, 64], s: [45, 52, 57, 61, 64] },
  };

  const P = (s) => T.progression(s, BPB);
  const PROG = {
    intro: P("| G | Cadd9 | G | Cadd9 | Em7 | Cadd9 | G | Dsus4 D |"),
    verseA: P("| G | Cadd9 | Em7 | Dsus4 D | G | Cadd9 | Am7 | Dsus4 D |"),
    verseB: P("| G | Cadd9 | Em7 | Dsus4 D | Cadd9 | G/B | Am7 | Dsus4 D |"),
    chorus: P("| Cadd9 | G/B | Em7 | D | Cadd9 | G/B | Am7 D/F# | G |"),
    lift: P("| Cadd9 | G/B | Em7 | D | Cadd9 | G/B | Am7 D/F# | G:2 A7sus4:1 A7:1 |"),
    bridge: P("| Em | Cmaj7 | G/B | D | Em | Cmaj7 | Am7 | B7 |"),
    last: P("| G | Cadd9 | Em7 | Dsus4 D | G | Cadd9 | Am7 Dsus4 | G |"),
  };

  // ---------- the tunes: "B4:2" = B4 for two eighths, "-" rest, "^" bend up into the note (a semitone; "^^" a tone) ----------
  function tune(str) {
    const out = [];
    str.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let t = 0;
      for (const tok of bar.split(/\s+/)) {
        const m = /^(\^{0,2})([A-G][#b]?-?\d|-)(?::(\d+))?$/.exec(tok);
        if (!m) throw new Error(`campfire: bad token ${tok}`);
        const d = (m[3] ? Number(m[3]) : 1) * 0.5;
        if (m[2] !== "-") out.push({ abs: bi * BPB + t, d, m: T.midi(m[2]), bend: m[1].length });
        t += d;
      }
      if (Math.abs(t - BPB) > 1e-6) throw new Error(`campfire: bar ${bi + 1} lasts ${t} beats: ${bar}`);
    });
    return out;
  }
  const LINE1 = "-:2 B4:2 B4 A4 G4:2 | E4:2 D4 E4 G4:4 | -:2 B4:2 B4 D5 E5:2 | D5:3 C5 A4:4";
  const CHORUS7 = "G5:3 E5 D5:2 E5:2 | D5:3 B4 B4:4 | -:1 B4 D5 E5 G5:3 E5 | F#5:4 E5 D5 A4:2 | G5:3 A5 G5:2 E5:2 | D5:3 B4 D5:2 G5:2 | A5:2 G5 E5 F#5:3 D5";
  const TUNES = {
    intro: tune("-:8 | -:8 | -:8 | -:8 | G5:3 E5 D5:2 B4:2 | C5:2 D5:2 ^E5:4 | D5:3 B4 G4:4 | A4:6 -:2"),
    verseA: tune(LINE1 + " | -:2 B4:2 B4 A4 G4 A4 | C5:2 B4 A4 G4:4 | C5:2 B4 A4 E4:2 G4 A4 | G4:4 F#4:4"),
    verseB: tune(LINE1 + " | -:2 E5:2 E5 D5 C5 D5 | D5:2 B4 G4 B4:4 | C5:2 B4 A4 G4:2 E4 G4 | A4:6 -:2"),
    chorus: tune(CHORUS7 + " | B4:6 -:2"),
    lift: tune(CHORUS7 + " | B4:3 D5 E5:2 C#5:2"),
    bridge: tune("E4:2 G4 A4 ^B4:4 | -:2 C5 B4 G4:4 | D5:3 C5 B4:2 A4 G4 | ^^A4:6 -:2 | E5:2 D5 B4 E5:2 G5:2 | E5:3 D5 B4:4 | C5:3 B4 A4:2 C5:2 | B4:2 A4 D#5 F#5:4"),
    last: tune(LINE1 + " | -:2 B4:2 B4 A4 G4 A4 | C5:2 B4 A4 G4:4 | C5:2 B4 A4 D5:3 C5 | B4:2 A4:2 G4:4"),
  };

  // ---------- form ----------
  const FORM = [
    { id: "intro", prog: "intro", tune: "intro", label: "Intro · guitar by the fire" },
    { id: "v1a", prog: "verseA", tune: "verseA", label: "Verse 1" },
    { id: "v1b", prog: "verseB", tune: "verseB", label: "Verse 1" },
    { id: "ch1", prog: "chorus", tune: "chorus", label: "Chorus · the cajon comes in" },
    { id: "v2a", prog: "verseA", tune: "verseA", label: "Verse 2 · finger snaps" },
    { id: "v2b", prog: "verseB", tune: "verseB", label: "Verse 2 · finger snaps" },
    { id: "ch2", prog: "chorus", tune: "chorus", label: "Chorus 2" },
    { id: "br", prog: "bridge", tune: "bridge", label: "Bridge · E minor, half time" },
    { id: "bc1", prog: "lift", tune: "lift", label: "Big chorus · handclaps" },
    { id: "bc2", prog: "chorus", tune: "chorus", up: 2, label: "Big chorus · up a step, two harmonicas" },
    { id: "last", prog: "last", tune: "last", up: 2, label: "Last verse · guitar and crickets" },
  ];
  function plan(cycle) {
    const round = Math.floor(cycle / FORM.length), k = cycle % FORM.length;
    const sec = FORM[k];
    return { ...sec, round, k, odd: round % 2 === 1, key: (round % 2) * 2 + (sec.up || 0), next: FORM[(k + 1) % FORM.length] };
  }
  const DYN = { intro: 0.52, v1a: 0.55, v1b: 0.57, ch1: 0.72, v2a: 0.6, v2b: 0.62, ch2: 0.76, br: 0.62, bc1: 0.82, bc2: 0.88, last: 0.46 };

  // Travis patterns: [beat, string]; "T" root, "t" alternate, "u" second alternate, 0-2 treble strings.
  const TRAVIS = [
    [[[0, "T"], [0, 2], [1, "t"], [1.5, 1], [2, "T"], [2.5, 2], [3, "t"], [3.5, 0]], 3],
    [[[0, "T"], [0, 2], [1, "t"], [1.5, 1], [2, "u"], [2.5, 0], [3, "t"], [3.5, 1]], 2],
    [[[0, "T"], [0.5, 1], [1, "t"], [1.5, 2], [2, "T"], [2.5, 1], [3, "t"], [3.5, 0]], 2],
    [[[0, "T"], [0, 2], [1, "t"], [1.5, 0], [2, "T"], [2, 1], [2.5, 2], [3, "t"], [3.5, 1]], 1.5],
  ];
  // the bridge: a rolling let-ring arpeggio instead
  const ROLL = [[0, "T"], [0.5, 0], [1, 1], [1.5, 2], [2, "t"], [2.5, 1], [3, 2], [3.5, 0]];
  // strums: [beat, D/U, velocity]
  const STRUMS = [
    [[[0, "D", 0.72], [1, "D", 0.55], [1.5, "U", 0.4], [2.5, "U", 0.45], [3, "D", 0.58], [3.5, "U", 0.42]], 3],
    [[[0, "D", 0.72], [1, "D", 0.55], [1.5, "U", 0.38], [2, "D", 0.62], [2.5, "U", 0.42], [3, "D", 0.56], [3.5, "U", 0.42]], 2],
    [[[0, "D", 0.72], [1, "D", 0.58], [2, "D", 0.62], [2.5, "U", 0.42], [3, "D", 0.55], [3.5, "U", 0.45]], 1.5],
  ];

  // ---------- nature, synthesized ----------
  /** A level-controlled bed: each event fades it to vel over a few seconds and holds it for its length. */
  function bedPlay(g, base) {
    return (t, e, d) => {
      const lvl = base * clamp(e.vel || 0, 0, 1);
      g.gain.cancelAndHoldAtTime(t);
      g.gain.linearRampToValueAtTime(lvl, t + Math.min(4, d * 0.25));
      g.gain.setValueAtTime(lvl, t + d + 0.5); // the next event cancels this fade; if the layer is muted, the bed dies away
      g.gain.linearRampToValueAtTime(0, t + d + 3);
    };
  }
  /** Crickets: sine carriers, pulsed at ~30 Hz, gated into chirps by two square LFOs (a 25% duty gate). */
  function crickets(ctx, dest) {
    const bus = ctx.keep(new Tone.Gain(0)).connect(dest);
    const hp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "highpass" })).connect(bus);
    const specs = [
      { f: 4650, pulse: 31, chirp: 1.42, pan: -0.62, lvl: -2 },
      { f: 4170, pulse: 27, chirp: 1.13, pan: 0.58, lvl: -5 },
      { f: 2930, pulse: 46, swell: 0.043, pan: 0.18, lvl: -11 }, // a distant tree cricket, trilling
    ];
    for (const s of specs) {
      const out = ctx.keep(new Tone.Gain(db(s.lvl))).connect(hp);
      const pan = ctx.keep(new Tone.Panner(s.pan)).connect(out);
      const gate = ctx.keep(new Tone.Gain(0));
      const pulse = ctx.keep(new Tone.Gain(0)).connect(gate);
      ctx.keep(new Tone.Oscillator({ frequency: s.f, type: "sine" }).start()).connect(pulse);
      ctx.keep(new Tone.LFO({ frequency: s.pulse, min: 0, max: 1 }).start()).connect(pulse.gain);
      if (s.swell) {
        gate.connect(pan);
        ctx.keep(new Tone.LFO({ frequency: s.swell, min: 0, max: 1 }).start()).connect(gate.gain);
      } else {
        // gate = square(f) x square(2f): on for the first quarter of each period
        const gate2 = ctx.keep(new Tone.Gain(0)).connect(pan);
        gate.connect(gate2);
        for (const [f, param] of [[s.chirp, gate.gain], [s.chirp * 2, gate2.gain]]) {
          const lp = ctx.keep(new Tone.Filter({ frequency: 30, type: "lowpass" }));
          ctx.keep(new Tone.LFO({ frequency: f, type: "square", min: 0, max: 1 }).start()).connect(lp);
          lp.connect(param);
        }
      }
    }
    return { out: bus, play: bedPlay(bus, db(-26)) };
  }
  /** Fire: a brown-noise roar that breathes, a hiss, and crackles from a generated loop played at two speeds. */
  function campfire(ctx, dest) {
    const bus = ctx.keep(new Tone.Gain(0)).connect(dest);
    const roarLp = ctx.keep(new Tone.Filter({ frequency: 380, type: "lowpass", rolloff: -24 }));
    const roarG = ctx.keep(new Tone.Gain(0)).connect(ctx.keep(new Tone.Gain(db(-9))).connect(bus));
    roarLp.connect(roarG);
    ctx.keep(new Tone.Noise({ type: "brown" }).start()).connect(roarLp);
    ctx.keep(new Tone.LFO({ frequency: 0.11, min: 0.35, max: 1 }).start()).connect(roarG.gain);
    const hissBp = ctx.keep(new Tone.Filter({ frequency: 1500, type: "bandpass", Q: 0.6 }));
    const hissG = ctx.keep(new Tone.Gain(0)).connect(ctx.keep(new Tone.Gain(db(-24))).connect(bus));
    hissBp.connect(hissG);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(hissBp);
    ctx.keep(new Tone.LFO({ frequency: 0.29, min: 0, max: 1 }).start()).connect(hissG.gain);

    const sr = Tone.getContext().sampleRate, secs = 6.7, n = Math.max(1, Math.floor(sr * secs));
    const L = new Float32Array(n), R = new Float32Array(n);
    let x = 20260 >>> 0;
    const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
    let t = 0;
    while (t < secs) {
      t += -Math.log(1 - rnd() * 0.999) / 3.2; // clusters arrive about three times a second
      const k = 1 + Math.floor(Math.pow(rnd(), 2.2) * 7);
      let o = 0;
      for (let i = 0; i < k; i++) {
        const big = rnd() < 0.07, amp = big ? 0.75 + 0.25 * rnd() : 0.08 + 0.45 * Math.pow(rnd(), 1.8);
        const len = Math.floor(sr * (big ? 0.014 : 0.0025 + rnd() * 0.003)), f = 1400 + rnd() * 3800, at = Math.floor((t + o) * sr);
        const pl = rnd(), gl = 1 - 0.7 * pl, gr = 0.3 + 0.7 * pl;
        for (let j = 0; j < len * 4 && at + j < n; j++) {
          const v = amp * Math.exp(-j / Math.max(1, len)) * (0.55 * Math.sin((2 * Math.PI * f * j) / sr) + 0.45 * (rnd() * 2 - 1));
          L[at + j] += v * gl; R[at + j] += v * gr;
        }
        o += 0.004 + rnd() * 0.035;
      }
    }
    const buf = Tone.ToneAudioBuffer.fromArray([L, R]);
    const crackHp = ctx.keep(new Tone.Filter({ frequency: 700, type: "highpass" })).connect(ctx.keep(new Tone.Gain(db(-3))).connect(bus));
    for (const [rate, pan] of [[1, -0.25], [0.77, 0.3]]) {
      const p = ctx.keep(new Tone.Panner(pan)).connect(crackHp);
      const pl = ctx.keep(new Tone.Player({ url: buf, loop: true, playbackRate: rate })).connect(p);
      pl.start();
    }
    return { out: bus, play: bedPlay(bus, db(-22)) };
  }
  /** Cajon slap: a short mid thump and the snare wires behind the playing surface. Bass tones use the kit's cajon. */
  function cajonSlap(ctx, dest) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db(-1))).connect(dest);
    const bodyG = ctx.keep(new Tone.Gain(db(-11))).connect(out);
    const body = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 1.6, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 } })).connect(bodyG);
    const wireBp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "bandpass", Q: 0.7 })).connect(ctx.keep(new Tone.Gain(db(-2))).connect(out));
    const wires = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 } })).connect(wireBp);
    const mono = I.monotonic(out);
    return (t, vel) => {
      const tt = mono(t), ghost = vel < 0.25;
      body.triggerAttackRelease(T.hz(53), 0.05, tt, ghost ? vel * 0.35 : vel);
      wires.triggerAttackRelease(0.09, tt, vel);
    };
  }

  Sim.register({
    id: "campfire",
    title: "Campfire",
    genre: "Campfire folk",
    about: "A campfire song in G: travis-picked steel-string verses, a strummed singalong chorus on harmonica with bends, a cajon that joins after the first verse, a bridge in E minor, handclaps and a lift up a step in the big chorus, then a last verse for just the guitar and the crickets.",
    situations: ["campfire", "hangout"],
    energy: 0.4,
    bpm: BPM, beatsPerBar: BPB, swing: 0.55, cycleBars: BARS, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const air = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.012, lowcut: 260, highcut: 6500 }); // open air: a short, soft space
      const night = I.reverb(ctx, out, { decay: 3.8, preDelay: 0.05, lowcut: 500, highcut: 7000 });
      const trees = I.delay(ctx, out, { time: 0.19, feedback: 0.18, highcut: 3000 }); // slapback off the treeline

      const g1 = I.guitar(ctx, { kind: "steel", volume: -3, voices: 22 });
      const g2 = I.guitar(ctx, { kind: "steel", volume: -9, voices: 12, dampening: 6200, resonance: 0.97 });
      const harp = I.harmonica(ctx, { volume: -2, glide: 0.055 });
      const harp2 = I.harmonica(ctx, { volume: -8, glide: 0.055, breath: -32 });
      const kit = I.kit(ctx, { volume: -6, preload: ["cajon", "snap", "shaker", "tambourine", "clap"] });
      const slap = cajonSlap(ctx, kit.out);

      const p1 = I.place(ctx, g1, -0.18, out), p2 = I.place(ctx, g2, 0.42, out);
      const hp1 = I.place(ctx, harp, 0.06, out), hp2 = I.place(ctx, harp2, -0.3, out), kp = I.place(ctx, kit, 0.08, out);
      I.send(ctx, p1, air, -15); I.send(ctx, p2, air, -11); I.send(ctx, p2, trees, -22);
      I.send(ctx, hp1, air, -12); I.send(ctx, hp1, trees, -24); I.send(ctx, hp1, night, -22); I.send(ctx, hp2, air, -12);
      I.send(ctx, kp, air, -16);

      const bugs = crickets(ctx, out), fire = campfire(ctx, out);
      I.send(ctx, bugs.out, night, -6);
      I.send(ctx, fire.out, air, -14);

      const gtr = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel, e.strum || 0);
      return {
        harmonica: { layer: "melody", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        harmonica2: { layer: "melody", play: (t, e, d) => harp2.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.05 } },
        capoLead: { layer: "melody", play: gtr(g2), humanize: { timing: 0.008, vel: 0.06 } },
        tuneGtr: { layer: "melody", play: gtr(g1), humanize: { timing: 0.01, vel: 0.05 } },
        pick: { layer: "harmony", play: gtr(g1), humanize: { timing: 0.007, vel: 0.08 } },
        capo: { layer: "harmony", play: gtr(g2), humanize: { timing: 0.008, vel: 0.08 } },
        thumb: { layer: "bass", play: gtr(g1), humanize: { timing: 0.005, vel: 0.06 } },
        perc: {
          layer: "drums",
          play: (t, e) => (e.note === "slap" ? slap(t, e.vel) : kit.hit(e.note, t, e.vel)),
          humanize: { timing: 0.006, vel: 0.1 },
        },
        crickets: { layer: "texture", play: bugs.play, humanize: { timing: 0, vel: 0 } },
        fire: { layer: "texture", play: fire.play, humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const S = plan(cycle), K = S.key, id = S.id, dyn = DYN[id];
      const prog = PROG[S.prog].map((h) => ({ ...h, chord: trSym(h.chord, K), g: h.chord }));
      const at = (b) => { let cur = prog[0]; for (const h of prog) { if (h.bar * BPB + h.beat <= b + 1e-6) cur = h; else break; } return cur; };
      const start = (h) => h.bar * BPB + h.beat;
      const sym = (b) => at(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: abs - bar * BPB, dur, note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      // melody notes are remembered so the capo'd guitar can keep out of their way
      const melSpans = [];
      const pushMel = (track, abs, dur, note, vel, extra) => { melSpans.push({ a: abs, b: abs + dur, m: note }); push(track, abs, dur, note, vel, extra); };
      const pushCapo = (abs, dur, note, vel) => {
        const pcs = T.chord(sym(abs)).pcs, ct = (m) => pcs.includes(mod(m, 12));
        const keep = (Array.isArray(note) ? note : [note]).filter((m) => !melSpans.some((x) => {
          const d = Math.abs(x.m - m);
          return Math.min(x.b, abs + dur) - Math.max(x.a, abs) >= 0.2 && d % 12 === 1 && d < 26 && !(ct(x.m) && ct(m));
        }));
        if (keep.length) push("capo", abs, dur, keep.length === 1 ? keep[0] : keep, vel);
      };
      const strumSec = S.prog === "chorus" || S.prog === "lift";
      const big = id === "bc1" || id === "bc2";

      // ================= the tune for this section (ornamented afresh each pass) =================
      let notes = TUNES[S.tune].map((n) => ({ ...n, m: n.m + K }));
      const pass = id === "v2a" || id === "v2b" || id === "ch2" || big ? 1 : 0;
      if (pass) notes = ornament(notes, big ? 0.45 : 0.3, r, sym);

      // ================= melody =================
      const harpOn = id === "intro" ? true : id === "last" ? false : id === "v1a" || id === "v1b" ? !S.odd : true;
      const hv = id === "intro" ? 0.6 : S.prog.startsWith("verse") ? 0.56 : id === "br" ? 0.62 : big ? 0.8 : 0.72;
      if (id === "br" && S.odd) {
        // odd rounds: the harmonica improvises over the bridge
        const m = C.line({ start: 0, end: 30, chordAt: sym, lo: 62 + K, hi: 81 + K, rng: r.fork(7), density: 0.32, phrase: [4, 7], rest: [1, 2.5], motif: state.soloMotif, motifProb: 0.45, chromatic: 0.12, register: 0.45, prev: state.soloLast, upbeatStart: 0.5 });
        state.soloMotif = m.motif; state.soloLast = m.last;
        const solo = m.notes.map((n) => ({ abs: n.beat, d: n.dur, m: n.note, bend: n.dur >= 1 && r.chance(0.35) ? (r.chance(0.7) ? 1 : 2) : 0 }));
        playLine(pushMel, "harmonica", solo, hv, r);
      } else if (harpOn) playLine(pushMel, "harmonica", notes, hv, r);
      if (id === "bc2") playLine(pushMel, "harmonica2", harmonize(notes, sym, T.scale(mod(7 + K, 12), "ionian")), hv * 0.85, r);
      if ((id === "v1a" || id === "v1b") && S.odd) {
        // the capo'd guitar plays the tune
        notes.forEach((n) => pushMel("capoLead", n.abs, Math.min(n.d + 0.3, 2.5), n.m, 0.58 + (Number.isInteger(n.abs) ? 0.06 : 0)));
      }

      // ================= guitar 1 =================
      const chordEnd = (h) => { const i = prog.indexOf(h); return i + 1 < prog.length ? start(prog[i + 1]) : BARS * BPB; };
      if (strumSec) {
        if (!state.strum || id === "ch1" || id === "bc1") state.strum = r.weighted(STRUMS);
        const scale = T.scale(mod(7 + K, 12), "ionian");
        for (let bar = 0; bar < BARS; bar++) {
          const pat = r.chance(0.2) ? r.weighted(STRUMS) : state.strum;
          const b0 = bar * BPB;
          // boom: thumb on 1 and 3 (the new chord's root when the chord changes on 3)
          const h0 = at(b0), h2 = at(b0 + 2), sh0 = GV[h0.g], sh2 = GV[h2.g];
          push("thumb", b0, id === "bc2" && bar === BARS - 1 ? 3.5 : 0.95, sh0.b[0] + K, 0.82 * dyn + 0.1);
          if (!(id === "bc2" && bar === BARS - 1)) push("thumb", b0 + 2, 0.95, (h2 === h0 ? sh0.b[1] : sh2.b[0]) + K, 0.74 * dyn + 0.08);
          // walk-up into the next bar's chord
          const hn = bar < BARS - 1 ? at(b0 + BPB) : null;
          if (hn && hn !== at(b0 + 3.5) && r.chance(big ? 0.55 : 0.3) && !(id === "bc2" && bar === BARS - 1)) {
            const from = (h2 === h0 ? sh0 : sh2).b[0] + K, to = GV[hn.g].b[0] + K;
            const pcs = T.chord((h2 === h0 ? h0 : h2).chord).pcs;
            const rub = (m) => !pcs.includes(mod(m, 12)) && pcs.some((p) => mod(m - p, 12) === 1 || mod(p - m, 12) === 1);
            const path = Math.abs(to - from) <= 7 && to !== from ? walk(from, to, scale).filter((m) => !rub(m)) : [];
            path.slice(-3).forEach((m, i, a) => push("thumb", b0 + 4 - 0.5 * (a.length - i), 0.45, m, (0.6 + 0.06 * i) * dyn + 0.08));
          }
          // chuck: the strums
          pat.forEach(([b, dir, v], i) => {
            const abs = b0 + b, h = at(abs), sh = GV[h.g];
            const nextB = i + 1 < pat.length ? pat[i + 1][0] : BPB;
            const first = Math.abs(abs - start(h)) < 1e-6;
            let ns = first || b === 0 ? sh.s.slice(1) : dir === "D" ? sh.s.slice(Math.max(1, sh.s.length - 4)) : sh.s.slice(-3);
            ns = ns.map((m) => m + K);
            const last = id === "bc2" && bar === BARS - 1;
            if (last && b > 0) return; // the big chorus stops dead on the last downbeat
            push("pick", abs, last ? 3.5 : Math.min(nextB - b, chordEnd(h) - abs) + 0.02, ns, v * (0.5 + 0.4 * dyn), { strum: dir === "D" ? (last ? 0.03 : 0.011) : -0.008 });
          });
        }
      } else {
        // fingerpicking: travis in the verses and the intro, a rolling arpeggio in the bridge
        if (!state.travis || id === "intro" || id === "v1a") state.travis = r.weighted(TRAVIS);
        const mel = id === "last" ? notes : null; // the last verse: the guitar plays the tune on top of the pattern
        for (let bar = 0; bar < BARS; bar++) {
          const b0 = bar * BPB;
          if (id === "last" && bar === BARS - 1) {
            // a final, slowly rolled chord
            const sh = GV[at(b0).g];
            push("thumb", b0, 3.8, sh.s[0] + K, 0.5);
            push("pick", b0 + 0.02, 3.8, sh.s.slice(1).map((m) => m + K), 0.42, { strum: 0.05 });
            continue;
          }
          const pat = id === "br" ? ROLL : r.chance(0.25) ? r.weighted(TRAVIS) : state.travis;
          for (const [b, w] of pat) {
            const abs = b0 + b, h = at(abs), sh = GV[h.g];
            if (typeof w === "string") {
              const idx = Math.abs(abs - start(h)) < 1e-6 ? 0 : { T: 0, t: 1, u: 2 }[w];
              push("thumb", abs, id === "br" ? 1.9 : 0.9, sh.b[idx] + K, (b % 2 === 0 ? 0.62 : 0.54) * (0.6 + 0.6 * dyn));
            } else {
              const m = sh.t[w] + K;
              if (mel) {
                const on = mel.find((n) => n.abs <= abs + 1e-6 && abs < n.abs + n.d - 1e-6);
                if (on && m >= on.m - 2) continue; // keep the picking under the tune
              }
              const ring = Math.min(id === "br" ? 2.4 : 1.6, chordEnd(h) - abs + 0.05);
              push("pick", abs, ring, m, (b === 0 ? 0.5 : 0.42) * (0.6 + 0.6 * dyn) + r.range(-0.03, 0.03));
            }
          }
        }
        if (mel) mel.forEach((n) => push("tuneGtr", n.abs, Math.min(n.d + (at(n.abs + n.d + 0.3) === at(n.abs) ? 0.3 : 0), 2.5), n.m, 0.6 + (Number.isInteger(n.abs) ? 0.05 : 0)));
      }

      // ================= guitar 2, capo'd high =================
      const role = { ch1: "arp", ch2: "arp", bc1: "arp", bc2: "arp8", v2a: "chime", v2b: "chime", br: "ring", intro: S.round > 0 ? "chime" : null }[id];
      if (role) {
        prog.forEach((h) => {
          const v = T.voice(h.chord, { lo: 62, hi: 79, n: 4, rootless: false, prev: state.high, top: [71, 77], spread: "close", rng: r });
          if (v.length < 4) { const d = v[v.length - 1] - 12; v.push(d >= 60 && !v.includes(d) ? d : v[0] + 12); v.sort((x, y) => x - y); } // triads: double a note
          state.high = v;
          const s0 = start(h), len = chordEnd(h) - s0, vel = role === "chime" ? 0.36 : 0.4;
          if (role === "arp") {
            const order = [0, 2, 1, 3];
            for (let b = 0; b < len - 1e-6; b++) pushCapo(s0 + b, Math.min(1.8, len - b + 0.1), v[order[b % 4]], vel + (b === 0 ? 0.06 : 0));
            if (len >= 4 && r.chance(0.35)) pushCapo(s0 + 3.5, 0.5, v[2], vel - 0.08);
          } else if (role === "arp8") {
            const order = [0, 1, 2, 3, 2, 1, 3, 1];
            for (let b = 0; b < len - 1e-6; b += 0.5) pushCapo(s0 + b, Math.min(1, len - b + 0.05), v[order[(b * 2) % 8]], vel - 0.04 + (b % 1 === 0 ? 0.05 : 0));
          } else if (role === "chime") {
            if (id === "intro" && h.bar < 4) return;
            pushCapo(s0, Math.min(2.6, len), [v[2], v[3]], vel);
            if (len >= 4) pushCapo(s0 + 2.5, 1.4, v[1], vel - 0.06);
          } else {
            pushCapo(s0, Math.min(3.8, len), [v[1], v[3]], vel);
            if (len >= 4) pushCapo(s0 + 2, 1.8, v[2], vel - 0.08);
          }
        });
      }

      // ================= cajon, shaker, tambourine, snaps, claps =================
      const perc = (abs, voice, vel, extra) => push("perc", abs, 0.25, voice, vel, extra);
      const style = { ch1: "groove", v2a: "light", v2b: "light", ch2: "groove", br: "half", bc1: "full", bc2: "full" }[id];
      for (let bar = 0; bar < BARS; bar++) {
        const b0 = bar * BPB, lastBar = bar === BARS - 1;
        if (style) {
          if (lastBar && id === "bc2") { perc(b0, "cajon", 0.9); perc(b0, "slap", 0.8); perc(b0, "tambourine", 0.6); }
          else if (lastBar && id === "ch2") { cajonBar(perc, b0, "groove", r, dyn, 2); perc(b0 + 2.5, "slap", 0.6); }
          else cajonBar(perc, b0, style, r, dyn, lastBar ? (id === "br" ? 1.5 : 2.5) : 4);
        }
        // fills that mark the form
        if (lastBar) {
          const F = {
            v1b: [[3, "slap", 0.4], [3.5, "slap", 0.55], [3.75, "slap", 0.7]],
            ch1: [[2.5, "cajon", 0.6], [3, "slap", 0.6], [3.5, "slap", 0.7]],
            v2b: [[2.5, "slap", 0.5], [3, "cajon", 0.7], [3.25, "slap", 0.5], [3.5, "slap", 0.65], [3.75, "slap", 0.8]],
            br: [[1.5, "slap", 0.32], [2, "slap", 0.38], [2.25, "slap", 0.42], [2.5, "slap", 0.48], [2.75, "slap", 0.54], [3, "cajon", 0.75], [3.25, "slap", 0.62], [3.5, "slap", 0.72], [3.75, "slap", 0.85]],
            bc1: [[2.5, "slap", 0.7], [2.75, "cajon", 0.6], [3, "slap", 0.75], [3.25, "slap", 0.6], [3.5, "cajon", 0.8], [3.75, "slap", 0.9]],
          }[id];
          if (F) F.forEach(([b, v, x]) => perc(b0 + b, v, x * (0.75 + 0.3 * dyn)));
        }
        // shaker: eighths, leaning on the offbeats
        const shk = { ch1: 1, v2a: 0.75, v2b: 0.8, ch2: 1 }[id];
        if (shk) for (let e = 0; e < 8; e++) perc(b0 + e * 0.5, "shaker", (e % 2 ? 0.34 : 0.2) * shk + (e === 6 ? 0.05 : 0));
        if (id === "bc2" && !lastBar) for (let e = 0; e < 16; e++) perc(b0 + e * 0.25, "shaker", e % 4 === 2 ? 0.3 : e % 2 ? 0.13 : 0.19); // sixteenths for the last chorus
        if (id === "br" && bar >= 6) for (let e = 0; e < 8; e++) perc(b0 + e * 0.5, "shaker", 0.12 + 0.025 * (e + (bar - 6) * 8));
        // tambourine: backbeat in the choruses, eighths in the big chorus
        if ((id === "ch1" || id === "ch2") && !(lastBar && id === "ch2")) {
          [1, 3].forEach((b) => perc(b0 + b, "tambourine", 0.42));
          if (id === "ch2" && bar >= 4) [0.5, 1.5, 2.5, 3.5].forEach((b) => perc(b0 + b, "tambourine", 0.2));
        }
        if (big && !(lastBar && id === "bc2")) for (let e = 0; e < 8; e++) perc(b0 + e * 0.5, "tambourine", e === 2 || e === 6 ? 0.52 : e % 2 ? 0.26 : 0.18);
        // finger snaps in verse 2
        if ((id === "v2a" || id === "v2b") && !(lastBar && id === "v2b")) [1, 3].forEach((b) => perc(b0 + b, "snap", 0.42 + r.range(-0.04, 0.04)));
        // handclaps: three or four people, never quite together
        if (big && !(lastBar && id === "bc2")) {
          const beats = id === "bc2" && bar % 2 === 1 ? [1, 3, 3.5] : [1, 3];
          beats.forEach((b) => {
            const v = b === 3.5 ? 0.5 : 0.72;
            perc(b0 + b, "clap", v);
            perc(b0 + b, "clap", v * 0.8, { delay: 0.009 + r.range(0, 0.006) });
            perc(b0 + b, "snap", v * 0.7, { delay: 0.004 + r.range(0, 0.012) });
            if (id === "bc2") perc(b0 + b, "clap", v * 0.7, { delay: 0.019 + r.range(0, 0.008) });
          });
        }
      }

      // ================= crickets and the fire =================
      const bugs = { intro: 0.95, v1a: 0.85, v1b: 0.8, ch1: 0.5, v2a: 0.6, v2b: 0.6, ch2: 0.45, br: 0.7, bc1: 0.35, bc2: 0.3, last: 1 }[id];
      const fire = { intro: 1, v1a: 0.85, v1b: 0.8, ch1: 0.6, v2a: 0.7, v2b: 0.7, ch2: 0.55, br: 0.75, bc1: 0.5, bc2: 0.5, last: 0.95 }[id];
      push("crickets", 0, BARS * BPB, "bed", bugs);
      push("fire", 0, BARS * BPB, "bed", fire);

      // a touch slower for the last verse, back up for the next song
      const tempo = id === "last" ? { bpm: 90, rampBeats: 8 } : id === "intro" && cycle > 0 ? { bpm: BPM, rampBeats: 2 } : undefined;
      const harmony = prog.map(({ bar, beat, dur, chord }) => ({ bar, beat, dur, chord }));
      const keyName = SHARP[mod(7 + K, 12)];
      const label = `${S.label}${(id === "v1a" || id === "v1b") && S.odd ? " · the capo'd guitar takes the tune" : ""}${id === "br" && S.odd ? " · harmonica solo" : ""} · ${keyName}`;
      return { events: ev, harmony, section: label, state, tempo };
    },
  });

  // ---------- helpers ----------
  /** Harmonica phrasing: slurs between close notes, scooped bends, accents on the beat. */
  function playLine(push, track, notes, base, r) {
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const touching = next && next.abs - (n.abs + n.d) < 0.01;
      let dur = n.d * (n.d >= 2 ? 0.96 : 0.88);
      if (touching && Math.abs(next.m - n.m) <= 4 && r.chance(0.45)) dur = n.d + 0.04; // slur into the next note
      const strong = Math.abs(n.abs - Math.round(n.abs)) < 1e-6 && mod(Math.round(n.abs), 2) === 0;
      const v = base + (strong ? 0.06 : 0) + (n.d >= 2 ? 0.03 : 0) - (!next || next.abs - (n.abs + n.d) > 0.9 ? 0.05 : 0);
      if (n.bend) {
        const g = Math.min(0.2, n.d * 0.3); // a quick scoop; the glide does the rest
        push(track, n.abs, g + 0.03, n.m - n.bend, v * 0.85);
        push(track, n.abs + g, Math.max(0.2, dur - g), n.m, v);
      } else push(track, n.abs, dur, n.m, v);
    });
  }
  /** Variation on a repeat: passing tones between quarter notes a third apart, scoops on long notes. */
  function ornament(notes, p, r, sym) {
    const out = [];
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const gap = next ? Math.abs(next.m - n.m) : 0;
      if (n.d === 1 && next && next.abs === n.abs + 1 && gap >= 3 && gap <= 4 && r.chance(p)) {
        const mid = T.step(n.m, Math.sign(next.m - n.m), T.chord(sym(n.abs + 0.5)).scale);
        out.push({ ...n, d: 0.5 }, { abs: n.abs + 0.5, d: 0.5, m: mid, bend: 0 });
        return;
      }
      out.push(n.d >= 1.5 && !n.bend && r.chance(p * 0.45) ? { ...n, bend: 1 } : n);
    });
    return out;
  }
  /** A second harmonica a third or sixth below: chord tones on the beat, diatonic thirds in between. */
  function harmonize(notes, sym, keyScale) {
    return notes.map((n) => {
      const c = T.chord(sym(n.abs));
      const onBeat = Math.abs(n.abs - Math.round(n.abs)) < 1e-6;
      const cands = T.notesIn(c.pcs, n.m - 9, n.m - 3);
      const chordTone = cands.length ? cands[cands.length - 1] : T.step(n.m, -2, keyScale);
      let h = T.step(n.m, -2, keyScale);
      const rub = !c.pcs.includes(mod(h, 12)) && c.pcs.some((p) => mod(h - p, 12) === 1 || mod(p - h, 12) === 1);
      if (onBeat || n.d >= 1 || rub) h = chordTone;
      return { abs: n.abs, d: n.d, m: h, bend: 0 };
    });
  }
  /** Bass walk between two roots along a scale (exclusive of both). */
  function walk(from, to, pcs) {
    const dir = Math.sign(to - from), out = [];
    let m = from;
    for (let i = 0; i < 4; i++) { m = T.step(m, dir, pcs); if ((dir > 0 && m >= to) || (dir < 0 && m <= to)) break; out.push(m); }
    return out;
  }
  /** One bar of cajon. `until` cuts the bar short for a fill. */
  function cajonBar(perc, b0, style, r, dyn, until) {
    const B = (b, v) => { if (b < until) perc(b0 + b, "cajon", v * (0.7 + 0.35 * dyn)); };
    const Sl = (b, v) => { if (b < until) perc(b0 + b, "slap", v * (0.7 + 0.35 * dyn)); };
    const g = (b) => { if (b < until) perc(b0 + b, "slap", r.range(0.1, 0.18)); };
    if (style === "light") {
      B(0, 0.75); Sl(1, 0.5); if (r.chance(0.6)) B(2.5, 0.55); else B(2, 0.6); Sl(3, 0.55);
      if (r.chance(0.4)) g(1.5); if (r.chance(0.4)) g(3.5);
    } else if (style === "groove") {
      B(0, 0.85); g(0.5); Sl(1, 0.72); if (r.chance(0.45)) g(1.75); B(2, 0.6); if (r.chance(0.55)) B(2.5, 0.48); Sl(3, 0.78); g(3.5); if (r.chance(0.3)) g(3.75);
    } else if (style === "full") {
      B(0, 0.92); g(0.5); if (r.chance(0.4)) g(0.75); Sl(1, 0.82); g(1.5); if (r.chance(0.5)) B(1.75, 0.45);
      B(2, 0.68); if (r.chance(0.6)) B(2.5, 0.55); Sl(3, 0.88); g(3.5); if (r.chance(0.45)) g(3.75);
    } else if (style === "half") {
      B(0, 0.78); if (r.chance(0.45)) g(1); Sl(2, 0.66); g(3); if (r.chance(0.45)) B(3.5, 0.45);
    }
  }
})();
