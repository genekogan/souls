// Terraform: space synth in the Oxygène / Équinoxe manner, for watching a grey planet turn green.
// The contrast to Orbital Survey (minor, vast, a mutating Berlin sequencer, CS-80 brass) is deliberate:
// this one is major, bouncy and tuneful, built on a preset rhythm box, a gliding analog lead that
// whistles a hand-written theme, a 16th-note arpeggio that changes its figure on every chord, phasing
// string-machine pads, and wind and sea made of filtered noise.
//
// One "season" (about 3.5-4 minutes), cycles of 8 bars:
//   I1 dawn wind (pads over a tonic pedal, I-bVII-IV-I, sea and wind)
//   I2 first light (vi7 IVmaj7 ii7 V9sus4, a high triangle arp drips in, a wind whoosh)
//   M  the rhythm box starts on its Bossa Nova button; two bars later bass and arpeggio (filter opening)
//   A1 theme A: I bVII IV I | I bVII IV Vsus4-V      (half cadence through the sus4)
//   A2 answer:  I bVII IV I | ii7 IV iv6 I            (plagal close through the borrowed minor iv)
//   B1 theme B on the "Rock 1" button: IV V vi iii | IV V vi vi7  (IV-V-vi twice, the deceptive lean)
//   B2 ii7 iii7 IV V | bVI(add9) bVII Isus4 I           (mixture climb, sus4 suspense before A returns)
//  (AR theme A's answer again, with a string line, in later seasons)
//   BD1 breakdown: arps and weather only, vi IV ii7 V, the filter shut and slowly opening
//   BD2 vi IV ii bVII, then Vsus4-V of the key a whole step up (ii of the old key is i of the new: mixture)
//   X1, X2 theme A a whole step higher, string machine harmonizing the lead in thirds and sixths
//   O  green horizon: the theme's opening as a farewell, the box stops, wind returns
// Seasons alternate D major (lifting to E) and C major (lifting back to D). Every season re-deals the
// arpeggio figures; the lead ornaments its returns (scoops from a step below, turns on held notes).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony: [semitones above tonic, quality, beats, bass offset?] ----------
  const PROG = {
    I1: [[0, "add9", 8], [10, "add9", 8, 0], [5, "add9", 8, 0], [0, "add9", 8]],
    I2: [[9, "m7", 8], [5, "maj7", 8], [2, "m7", 8], [7, "9sus4", 8]],
    M: [[0, "", 4], [10, "", 4], [5, "", 4], [0, "", 4], [0, "", 4], [10, "", 4], [5, "", 4], [7, "sus4", 2], [7, "", 2]],
    A1: [[0, "", 4], [10, "", 4], [5, "", 4], [0, "", 4], [0, "", 4], [10, "", 4], [5, "", 4], [7, "sus4", 2], [7, "", 2]],
    A2: [[0, "", 4], [10, "", 4], [5, "", 4], [0, "", 4], [2, "m7", 4], [5, "", 4], [5, "m6", 4], [0, "", 4]],
    B1: [[5, "", 4], [7, "", 4], [9, "m", 4], [4, "m", 4], [5, "", 4], [7, "", 4], [9, "m", 4], [9, "m7", 4]],
    B2: [[2, "m7", 4], [4, "m7", 4], [5, "", 4], [7, "", 4], [8, "add9", 4], [10, "", 4], [0, "sus4", 4], [0, "", 4]],
    BD1: [[9, "m", 8], [5, "", 8], [2, "m7", 8], [7, "", 8]],
    BD2: [[9, "m", 8], [5, "", 8], [2, "m", 4], [10, "", 4], [9, "sus4", 4], [9, "", 4]],
    O: [[0, "", 4], [10, "", 4], [5, "", 4], [0, "", 4], [0, "", 4], [10, "add9", 4], [5, "add9", 4], [0, "add9", 4]],
  };

  // ---------- the lead, written in D major: [beat in cycle, dur, midi] ----------
  const LEAD = {
    // 3+3+2 bounce: A F# A | G E G | B G D | A ... then the answer climbs to the sus4 (D over A, falling to C#)
    A1: [[0, 1.5, 81], [1.5, 1.5, 78], [3, 1, 81], [4, 1.5, 79], [5.5, 1.5, 76], [7, 1, 79],
      [8, 1.5, 83], [9.5, 1.5, 79], [11, 1, 86], [12, 3, 81], [15.5, 0.5, 78],
      [16, 1.5, 81], [17.5, 1.5, 78], [19, 1, 86], [20, 1.5, 84], [21.5, 1.5, 79], [23, 1, 84],
      [24, 1.5, 83], [25.5, 1.5, 79], [27, 0.5, 83], [27.5, 0.5, 84], [28, 2, 86], [30, 1.5, 85]],
    // same opening, then down through ii7, up through IV, and the borrowed Bb of iv6 sinking to A
    A2: [[0, 1.5, 81], [1.5, 1.5, 78], [3, 1, 81], [4, 1.5, 79], [5.5, 1.5, 76], [7, 1, 79],
      [8, 1.5, 83], [9.5, 1.5, 86], [11, 1, 83], [12, 2.5, 81], [14.5, 1.5, 86],
      [16, 1.5, 83], [17.5, 1.5, 79], [19, 1, 76], [20, 1.5, 79], [21.5, 1.5, 83], [23, 1, 86],
      [24, 1.5, 86], [25.5, 2.5, 82], [28, 3.5, 81]],
    // stepwise rises that climb a step each time (G A B | C# B A | B C# D), then E at the top
    B1: [[0, 1, 79], [1, 1, 81], [2, 2, 83], [4, 1.5, 85], [5.5, 0.5, 83], [6, 2, 81],
      [8, 1, 83], [9, 1, 85], [10, 2, 86], [12, 3, 85], [15, 1, 81],
      [16, 1, 79], [17, 1, 81], [18, 1.5, 83], [19.5, 0.5, 86], [20, 2, 88], [22, 1, 85], [23, 1, 81],
      [24, 1.5, 86], [25.5, 0.5, 85], [26, 4, 83], [31, 0.5, 81], [31.5, 0.5, 78]],
    B2: [[0, 1, 79], [1, 1, 81], [2, 2, 83], [4, 1.5, 85], [5.5, 0.5, 83], [6, 2, 81],
      [8, 1, 83], [9, 1, 85], [10, 2, 86], [12, 2, 88], [14, 2, 85],
      [16, 2, 86], [18, 1, 84], [19, 1, 82], [20, 1, 84], [21, 1, 86], [22, 2, 88],
      [24, 1, 81], [25, 6.5, 86]],
    // farewell: the opening once more, then two distant notes
    O: [[0, 1.5, 81], [1.5, 1.5, 78], [3, 1, 81], [4, 1.5, 79], [5.5, 1.5, 76], [7, 1, 79],
      [8, 1.5, 83], [9.5, 1.5, 79], [11, 1, 86], [12, 4, 81], [21, 3, 86], [28, 3.5, 81]],
  };

  // ---------- form ----------
  // box: rhythm-box preset; arp: {from, cut [start, end], low, thin}; arp2: {from, sparse}
  const SEC = {
    I1: { label: "dawn wind", prog: "I1", pad: 0.36, sub: [0, 32], sea: [0, 32, 0.42], wind: [4, 32, 0.34] },
    I2: { label: "first light", prog: "I2", pad: 0.4, sub: [0, 32], wind: [0, 20, 0.28], arp2: { from: 16, sparse: true, cut: [700, 1100] } },
    M: { label: "the rhythm box starts", prog: "M", pad: 0.34, box: "bossa", bass: 8, arp: { from: 8, cut: [260, 950] } },
    A1: { label: "theme A", prog: "A1", lead: "A1", pad: 0.36, box: "bossa", bass: 0, arp: { cut: [950, 1150] } },
    A2: { label: "theme A · answer", prog: "A2", lead: "A2", pad: 0.36, box: "bossa", bass: 0, fill: true, arp: { cut: [1150, 1000] } },
    B1: { label: "theme B", prog: "B1", lead: "B1", pad: 0.38, box: "rock", bass: 0, arp: { cut: [1000, 1300] } },
    B2: { label: "theme B · borrowed light", prog: "B2", lead: "B2", pad: 0.4, box: "rock", bass: 0, fill: true, arp: { cut: [1300, 1600] } },
    AR: { label: "theme A returns", prog: "A2", lead: "A2", pad: 0.36, box: "bossa", bass: 0, fill: true, line: true, arp: { cut: [1200, 1000] } },
    BD1: { label: "breakdown · arps and weather", prog: "BD1", arp: { cut: [230, 600], low: true }, arp2: { from: 16, cut: [600, 900] }, sea: [0, 32, 0.5], wind: [6, 32, 0.32] },
    BD2: { label: "breakdown · the lift", prog: "BD2", arp: { cut: [600, 1800], low: true }, arp2: { from: 0, cut: [900, 1500] }, sea: [0, 16, 0.4], wind: [0, 20, 0.3] },
    X1: { label: "theme A, a whole step higher", prog: "A1", lead: "A1", lift: true, pad: 0.4, box: "bossa", busy: true, bass: 0, line: true, arp: { cut: [1400, 1500] } },
    X2: { label: "theme A · answer, higher", prog: "A2", lead: "A2", lift: true, pad: 0.4, box: "bossa", busy: true, bass: 0, line: true, fill: true, arp: { cut: [1500, 1300] } },
    O: { label: "green horizon", prog: "O", lead: "O", lift: true, pad: 0.36, box: "bossa", boxTo: 16, bass: 0, bassTo: 16, sub: [16, 32], arp: { cut: [1200, 380], to: 24, thin: 16 }, arp2: { from: 16, cut: [1000, 600] }, sea: [14, 32, 0.4], wind: [8, 32, 0.3] },
  };
  function makePlan(season, r) {
    const p = ["I1"];
    if (season === 0 || r.chance(0.6)) p.push("I2");
    p.push("M", "A1", "A2", "B1", "B2");
    if (season > 0 && r.chance(0.65)) p.push("AR");
    p.push("BD1", "BD2", "X1", "X2", "O");
    return p;
  }

  // ---------- rhythm box presets: [voice, beat, vel] per bar (two-bar patterns) ----------
  const PRESETS = {
    bossa: {
      name: "Bossa Nova", hat: [0.2, 0.32],
      bars: [
        [["softKick", 0, 0.56], ["softKick", 1.5, 0.34], ["softKick", 2, 0.44], ["softKick", 3.5, 0.34], ["rim", 0, 0.46], ["rim", 1.5, 0.4], ["rim", 3, 0.44]],
        [["softKick", 0, 0.52], ["softKick", 1.5, 0.34], ["softKick", 2, 0.44], ["softKick", 3.5, 0.34], ["rim", 1, 0.42], ["rim", 2.5, 0.46]],
      ],
      extra: [["conga", 2.5, 0.26, 64], ["congaLow", 3, 0.3, 57]],
    },
    rock: {
      name: "Rock 1", hat: [0.3, 0.2],
      bars: [
        [["softKick", 0, 0.58], ["softKick", 2.5, 0.4], ["snare", 1, 0.24], ["snare", 3, 0.28]],
        [["softKick", 0, 0.55], ["softKick", 2, 0.42], ["softKick", 2.5, 0.34], ["snare", 1, 0.24], ["snare", 3, 0.28], ["hatOpen", 3.5, 0.14]],
      ],
      extra: [["bongo", 1.75, 0.22, 74], ["bongo", 3.25, 0.24, 71]],
    },
  };
  const FILL = [["bongo", 2, 0.34, 74], ["bongo", 2.5, 0.36, 71], ["conga", 3, 0.4, 64], ["conga", 3.25, 0.4, 62], ["congaLow", 3.5, 0.46, 57], ["congaLow", 3.75, 0.5, 55]];

  // ---------- arpeggio figures over a chord-tone ladder (null = rest), restarted on every chord ----------
  const ARPS = [
    [0, 1, 2, 3, 4, 3, 2, 1],        // up and down
    [0, 2, 3, 0, 2, 3, 4, 2],        // 3+3+2 bounce
    [0, 3, 1, 3, 2, 3, 1, 3],        // pedal on the octave
    [0, 1, 2, 3, 1, 2, 3, 4],        // rolling climb
    [4, 3, 2, 1, 3, 2, 1, 0],        // cascade
    [0, 2, 1, 3, 2, 4, 3, 2],        // broken thirds
    [0, null, 3, 2, 0, null, 4, 3],  // skipping gallop
    [0, 3, 2, 4, 0, 3, 2, 5],        // wide bounce
  ];
  const ARP2 = [0, 2, 4, 1, 3, 5, 4, 2]; // eighths, accents 3+3+2

  const SHARP = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  const nameOf = (pc, key) => ([0, 5, 10].includes(key) ? T.NAMES : SHARP)[mod12(pc)];

  Sim.register({
    id: "terraform",
    title: "Terraform",
    genre: "Space synth",
    about: "Major-key space synth after Oxygène and Équinoxe: a preset rhythm box (Bossa Nova, Rock 1), a bouncing arpeggio that changes figure with every chord, phasing string-machine pads, a gliding analog lead with a hand-written theme, borrowed ♭VII, ♭VI and minor iv, sus4 suspense before each return, a breakdown of arps and noise weather, and a lift up a whole step for the last statement.",
    bpm: 116, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: -1.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 260, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 300, highcut: 8000 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.36, highcut: 3200 });

      // lead: a whistling sine with breath, doubled by a soft square body, both gliding
      const whistle = I.whistle(ctx, { volume: -1.5, glide: 0.065, vibrato: 5.3, vibratoDepth: 0.06, breath: -30, attack: 0.045, release: 0.32 });
      const body = I.analog(ctx, { volume: -11, wave: "square", glide: 0.065, resonance: 1, base: 700, octaves: 1.6, attack: 0.03, decay: 0.5, sustain: 0.55, release: 0.3, filterDecay: 0.5 });
      const bodyVib = ctx.keep(new Tone.Vibrato({ frequency: 5.1, depth: 0.05 }));
      body.out.connect(bodyVib);
      const wp = I.place(ctx, whistle, 0.04, out), bdp = I.place(ctx, { out: bodyVib }, 0.04, out);
      I.send(ctx, wp, hall, -10); I.send(ctx, wp, echo, -15); I.send(ctx, bdp, hall, -14); I.send(ctx, bdp, echo, -19);

      // string machine: detuned saws through a slow phaser
      const strings = I.strings(ctx, { volume: -8, attack: 0.9, release: 2.4, cutoff: 3400 });
      const phaser = ctx.keep(new Tone.Phaser({ frequency: 0.11, octaves: 3, baseFrequency: 320, Q: 4, wet: 0.65 }));
      strings.out.connect(phaser);
      const pp = I.place(ctx, { out: phaser }, -0.08, out);
      I.send(ctx, pp, hall, -9);
      const line = I.strings(ctx, { volume: -12, attack: 0.16, release: 1.1, cutoff: 3000 });
      const lph = ctx.keep(new Tone.Phaser({ frequency: 0.17, octaves: 2.5, baseFrequency: 450, Q: 3, wet: 0.5 }));
      line.out.connect(lph);
      const lnp = I.place(ctx, { out: lph }, 0.3, out);
      I.send(ctx, lnp, hall, -9);

      const arp = I.analog(ctx, { volume: -10, wave: "square", resonance: 3, base: 400, octaves: 2.6, attack: 0.002, decay: 0.14, sustain: 0.15, release: 0.1, filterDecay: 0.12 });
      const ap = I.place(ctx, arp, -0.22, out);
      I.send(ctx, ap, echo, -9); I.send(ctx, ap, hall, -17);
      const arp2 = I.analog(ctx, { volume: -15, wave: "triangle", resonance: 1, base: 1400, octaves: 1.5, attack: 0.003, decay: 0.3, sustain: 0.1, release: 0.3, filterDecay: 0.2 });
      const a2p = I.place(ctx, arp2, 0.38, out);
      I.send(ctx, a2p, echo, -5); I.send(ctx, a2p, hall, -9);

      const bass = I.analog(ctx, { volume: -5, wave: "sawtooth", resonance: 2.5, base: 140, octaves: 2.6, attack: 0.004, decay: 0.3, sustain: 0.35, release: 0.12, filterDecay: 0.18 });
      const bsp = I.place(ctx, bass, 0, out);
      I.send(ctx, bsp, room, -20);
      const sub = I.sub(ctx, { volume: -9, attack: 0.9, release: 2.2 });
      I.place(ctx, sub, 0, out);

      const kit = I.kit(ctx, { volume: -3, kickNote: 33, preload: ["softKick", "rim", "hatClosed", "snare", "bongo", "conga", "congaLow", "hatOpen"] });
      const kp = I.place(ctx, kit, 0.02, out);
      I.send(ctx, kp, room, -11); I.send(ctx, kp, hall, -22);

      // weather: pools of filtered noise, each event a swell with a filter sweep and a stereo drift
      const weather = (type, filterType, Q, rolloff, vol, n) => {
        const bus = ctx.keep(new Tone.Gain(1));
        bus.connect(out);
        I.send(ctx, bus, hall, -7);
        const voices = Array.from({ length: n }, () => {
          const src = ctx.keep(new Tone.Noise({ type, volume: vol }));
          const f = ctx.keep(new Tone.Filter({ type: filterType, frequency: 500, Q, rolloff }));
          const g = ctx.keep(new Tone.Gain(0));
          const p = ctx.keep(new Tone.Panner(0));
          src.chain(f, g, p, bus);
          src.start();
          return { f, g, p, end: 0 };
        });
        const num = (x, d) => (Number.isFinite(x) ? x : d);
        return (t, e, d) => {
          const v = voices.reduce((a, b) => (b.end < a.end ? b : a)); // the voice that frees up first
          v.end = t + d + 0.05;
          const pk = e.rise ? 0.88 : 0.5;
          const f1 = num(e.f1, 400), f2 = num(e.f2, 1500), f3 = num(e.f3, f1);
          v.g.gain.cancelScheduledValues(t);
          v.g.gain.setValueAtTime(0, t);
          v.g.gain.linearRampToValueAtTime(Math.max(0.0001, num(e.vel, 0.3)), t + d * pk);
          v.g.gain.linearRampToValueAtTime(0, t + d);
          v.f.frequency.cancelScheduledValues(t);
          v.f.frequency.setValueAtTime(f1, t);
          v.f.frequency.exponentialRampToValueAtTime(f2, t + d * pk);
          v.f.frequency.exponentialRampToValueAtTime(f3, t + d);
          v.p.pan.cancelScheduledValues(t);
          v.p.pan.setValueAtTime(num(e.pan, 0), t);
          v.p.pan.linearRampToValueAtTime(num(e.pan2, 0), t + d);
        };
      };
      const wind = weather("pink", "bandpass", 3, -12, 2, 5);
      const sea = weather("pink", "lowpass", 0.6, -24, -9, 4);

      return {
        lead: { layer: "melody", humanize: { timing: 0.008, vel: 0.04 }, play: (t, e, d) => { whistle.play(t, e.note, d, e.vel); body.play(t, e.note, d, e.vel * 0.9); } },
        line: { layer: "harmony", humanize: { timing: 0.012, vel: 0.04 }, play: (t, e, d) => line.play(t, e.note, d, e.vel) },
        pad: { layer: "harmony", humanize: { timing: 0.015, vel: 0.03 }, play: (t, e, d) => strings.play(t, e.note, d, e.vel) },
        arp: {
          layer: "texture", humanize: { timing: 0.001, vel: 0.03 },
          play: (t, e, d) => { arp.filterEnvelope.baseFrequency = e.cut || 600; arp.play(t, e.note, d, e.vel); },
        },
        arp2: {
          layer: "texture", humanize: { timing: 0.001, vel: 0.04 },
          play: (t, e, d) => { arp2.filterEnvelope.baseFrequency = e.cut || 1000; arp2.play(t, e.note, d, e.vel); },
        },
        bass: { layer: "bass", humanize: { timing: 0.002, vel: 0.04 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        sub: { layer: "bass", humanize: { timing: 0, vel: 0 }, play: (t, e, d) => sub.play(t, e.note, d, e.vel) },
        box: { layer: "drums", humanize: { timing: 0.002, vel: 0.04 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }) },
        wind: { layer: "texture", humanize: { timing: 0.03, vel: 0.08 }, play: wind },
        sea: { layer: "texture", humanize: { timing: 0.03, vel: 0.08 }, play: sea },
      };
    },

    compose({ cycle, rng: r, state }) {
      // ---- form ----
      if (!state.plan || state.pos >= state.plan.length) {
        state.season = state.season == null ? 0 : state.season + 1;
        state.key = state.season % 2 === 0 ? 2 : 0;          // D (lifting to E), then C (lifting to D)
        state.plan = makePlan(state.season, r.fork(7));
        state.pos = 0; state.arpMap = {}; state.seen = {};
      }
      const name = state.plan[state.pos++], sec = SEC[name];
      const next = state.pos < state.plan.length ? state.plan[state.pos] : "I1";
      const key = mod12(state.key + (sec.lift ? 2 : 0));
      const shift = ((key - 2 + 18) % 12) - 6;                 // lead is written in D

      // ---- harmony ----
      const harmony = [];
      let at = 0;
      PROG[sec.prog].forEach(([off, q, dur, bassOff], idx) => {
        const sym = nameOf(key + off, key) + q + (bassOff != null ? "/" + nameOf(key + bassOff, key) : "");
        T.chord(sym);
        const p = C.at(at, 4);
        harmony.push({ bar: p.bar, beat: p.beat, dur, chord: sym, start: at, idx });
        at += dur;
      });
      const hAt = (b) => { let cur = harmony[0]; for (const h of harmony) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // ---- lead (first, so everything else can make room) ----
      let lead = [];
      if (sec.lead) {
        const seen = state.seen[sec.lead] || 0;
        state.seen[sec.lead] = seen + 1;
        const level = seen + (state.season > 0 ? 1 : 0) + (sec.lift ? 1 : 0);
        lead = perform(LEAD[sec.lead], shift, level, r.fork(3), (b) => { const c = T.chord(hAt(b).chord); return { sc: keyScale(c, key), pcs: c.pcs }; });
        const lift = sec.lift ? 0.04 : 0, fade = name === "O";
        lead.forEach((n, i) => {
          let vel = n.grace ? 0.46 : n.d >= 1.5 ? 0.72 : 0.62;
          if (i === lead.length - 1) vel -= 0.05;
          if (fade) vel *= 1 - Math.min(0.35, n.b / 60);
          push("lead", n.b, n.grace ? 0.24 : n.d * 0.96, n.m, vel + lift + r.range(-0.02, 0.02));
        });
      }

      // ---- string line: harmonizes the lead's held notes a third or sixth below, with chord tones ----
      const line = [];
      if (sec.line || (name === "B2" && state.season > 0)) {
        let prevL = null;
        lead.filter((n) => !n.grace && n.d >= 1.5).forEach((n) => {
          const h = hAt(n.b), c = T.chord(h.chord);
          const d = Math.min(n.d, h.start + h.dur - n.b);
          if (d < 1) return;
          const cands = T.notesIn(c.pcs, n.m - 9, n.m - 3);
          if (!cands.length) return;
          const cost = (m) => { const iv = n.m - m; return ([3, 4].includes(iv) ? 0 : [8, 9].includes(iv) ? 0.8 : 2.5) + (prevL != null ? Math.abs(m - prevL) * 0.08 : 0); };
          const m = cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
          line.push({ b: n.b, d, m });
          prevL = m;
        });
        line.forEach((n) => push("line", n.b, n.d * 0.95, n.m, 0.42 + r.range(-0.02, 0.03)));
      }

      // ---- string-machine pads: one chord per change, under the lead ----
      if (sec.pad) {
        const groups = [];
        for (const h of harmony) {
          const g = groups[groups.length - 1];
          if (g && g.chord === h.chord) g.dur += h.dur; else groups.push({ chord: h.chord, start: h.start, dur: h.dur });
        }
        for (const g of groups) {
          const s0 = g.start, s1 = s0 + g.dur;
          const over = lead.concat(line).filter((n) => n.b < s1 && n.b + n.d > s0).map((n) => n.m);
          const hi = over.length ? Math.min(74, Math.min(...over) - 3) : 74;
          const lo = 52;
          const c = T.chord(g.chord);
          const v = T.voice(c, { lo, hi, n: over.length ? 3 : 4, prev: state.padV, top: over.length ? [hi - 10, hi] : [hi - 7, hi], rng: r, rootless: false, omitBass: c.bass !== c.root });
          splitSemitones(v, c, lo, hi);
          state.padV = v;
          const swell = name === "B2" && s0 >= 16 && s0 < 24 ? 0.05 : 0;
          push("pad", s0, g.dur - 0.12, v.length > 1 ? v : v[0], sec.pad + swell + r.range(-0.02, 0.02));
        }
      }

      // ---- sub pedal ----
      if (sec.sub) {
        const subs = [];
        for (const h of harmony) {
          if (h.start < sec.sub[0] || h.start >= sec.sub[1]) continue;
          const pc = T.chord(h.chord).bass, last = subs[subs.length - 1];
          if (last && mod12(last.note) === pc) last.dur += h.dur;
          else { const m = T.nearest(state.subLast ?? 38, [pc], 31, 43); subs.push({ at: h.start, dur: h.dur, note: m }); state.subLast = m; }
        }
        subs.forEach((s) => push("sub", s.at, s.dur - 0.2, s.note, 0.62));
      }

      // ---- bass: bossa root-fifth or octave bounce, with approach notes into chord changes ----
      if (sec.bass != null) {
        const pat = sec.box === "rock"
          ? [[0, "R", 0.9, 0.8], [1.5, "O", 0.4, 0.55], [2, "R", 0.9, 0.7], [3, "5", 0.45, 0.6], [3.5, "O", 0.4, 0.5]]
          : [[0, "R", 1.4, 0.8], [1.5, "5", 0.4, 0.55], [2, "5", 1.4, 0.7], [3.5, "R", 0.4, 0.55]];
        const to = sec.bassTo ?? 32;
        const rootOf = (h) => { if (!h.bassRoot) h.bassRoot = T.nearest(state.bassRoot ?? 38, [T.chord(h.chord).bass], 33, 47); state.bassRoot = h.bassRoot; return h.bassRoot; };
        for (let bar = 0; bar < 8; bar++) {
          for (const [pos, role, dur, vel] of pat) {
            const b = bar * 4 + pos;
            if (b < sec.bass || b >= to) continue;
            const h = hAt(b), c = T.chord(h.chord), root = rootOf(h);
            const chordEnd = h.start + h.dur;
            let note = role === "R" ? root : role === "O" ? (root + 12 <= 55 ? root + 12 : root) : (root + 7 <= 50 ? root + 7 : root - 5);
            if (role === "5" && !c.intervals.includes(7)) note = root + 12;
            const nh = chordEnd < 32 ? harmony.find((x) => x.start === chordEnd) : null;
            const lastBefore = b + dur + 0.2 >= chordEnd && pos >= 1.5;
            const nc = nh ? T.chord(nh.chord) : null;
            if (lastBefore && nc && nc.bass !== c.bass && b < to - 1 && r.chance(0.55)) {
              // approach the next bass by step: a diatonic neighbour from the current chord's scale, or a
              // chromatic lower neighbour when it doesn't rub a semitone against the chord being held
              const target = T.nearest(root, [nc.bass], 33, 47);
              const rubs = (m) => c.pcs.some((pc) => [1, 11].includes(mod12(m - pc)));
              const sc = keyScale(c, key);
              const opts = [T.step(target, 1, sc), T.step(target, -1, sc)].filter((m) => !rubs(m) && Math.abs(m - target) <= 2);
              if (!rubs(target - 1)) opts.push(target - 1, target - 1);
              if (opts.length) note = r.pick(opts);
            }
            push("bass", b, Math.min(dur, chordEnd - b - 0.05), note, vel + (bar % 2 ? -0.03 : 0));
          }
        }
      }

      // ---- arpeggio: a different figure on every chord, the same figure whenever that chord returns ----
      if (sec.arp) {
        const a = sec.arp, from = a.from ?? 0, to = a.to ?? 32;
        const glob = cycle * 32;
        for (const h of harmony) {
          const mk = `${sec.prog}:${h.idx}`;
          if (state.arpMap[mk] == null) {
            const prevPat = state.arpMap[`${sec.prog}:${h.idx - 1}`];
            state.arpMap[mk] = r.pick([...ARPS.keys()].filter((i) => i !== prevPat));
          }
          const pat = ARPS[state.arpMap[mk]];
          const c = T.chord(h.chord);
          const target = Math.round(((state.arpBase ?? 55) + (a.low ? 50 : 55)) / 2);
          const base = a.low ? T.nearest(target, [c.bass], 45, 56) : T.nearest(target, [c.bass], 47, 62);
          state.arpBase = base;
          const lad = T.notesIn(c.pcs, base, base + 30);
          const cap = sec.lead ? 76 + Math.max(-2, Math.min(2, shift)) : 81;
          const steps = Math.round(h.dur / 0.25);
          for (let k = 0; k < steps; k++) {
            const b = h.start + k * 0.25;
            if (b < from || b >= to) continue;
            let idx = pat[k % pat.length];
            if (idx == null) continue;
            if (h.dur >= 8 && k >= 16 && !sec.lead) idx += 1; // a long chord's second bar climbs a chord tone
            const acc = [0, 3, 6].includes(k % 8);
            if (a.thin != null && b >= a.thin && !acc && r.chance(Math.min(0.9, (b - a.thin) / (to - a.thin) + 0.25))) continue;
            let note = lad[Math.min(idx, lad.length - 1)];
            if (note > cap) note -= 12;
            const u = b / 32;
            const cut = Math.round((a.cut[0] + (a.cut[1] - a.cut[0]) * u) * (1 + 0.15 * Math.sin((2 * Math.PI * (glob + b)) / 64)));
            const nextRest = pat[(k + 1) % pat.length] == null;
            const vel = (acc ? 0.72 : 0.5) + (k === 0 ? 0.05 : 0) + r.range(-0.02, 0.02);
            push("arp", b, nextRest ? 0.45 : 0.2, note, vel, { cut, straight: true });
          }
        }
      }
      // ---- high triangle arp: eighths in 3+3+2 ----
      if (sec.arp2) {
        const a = sec.arp2;
        for (let k = 0; k < 64; k++) {
          const b = k * 0.5;
          if (b < a.from) continue;
          const acc = [0, 3, 6].includes(k % 8);
          if (a.sparse && !acc) continue;
          const h = hAt(b), c = T.chord(h.chord);
          const base = T.nearest(66, [c.root], 61, 72);
          const lad = T.notesIn(c.pcs, base, base + 24);
          let note = lad[Math.min(ARP2[k % 8], lad.length - 1)];
          if (note > 88) note -= 12;
          const u = b / 32;
          push("arp2", b, acc ? 0.4 : 0.25, note, (acc ? 0.5 : 0.36) + r.range(-0.03, 0.03), { cut: Math.round(a.cut[0] + (a.cut[1] - a.cut[0]) * u), straight: true });
        }
      }

      // ---- rhythm box ----
      if (sec.box) {
        const pr = PRESETS[sec.box], to = sec.boxTo ?? 32;
        for (let bar = 0; bar < 8; bar++) {
          const fill = sec.fill && bar === 7;
          const pb = bar * 4;
          if (pb >= to) break;
          for (const [v, pos, vel] of pr.bars[bar % 2]) if (!(fill && pos >= 2)) push("box", pb + pos, 0.25, v, vel);
          // clicky hats: eighths, sixteenths when busy (3+3+2 accents)
          const step = sec.busy ? 0.25 : 0.5;
          for (let x = 0; x < 4 - 1e-6; x += step) {
            if (fill && x >= 2) break;
            if (sec.box === "rock" && bar % 2 === 1 && x === 3.5) continue; // the open hat
            let vel;
            if (sec.busy) vel = [0, 0.75, 1.5, 2, 2.75, 3.5].includes(x % 4) ? 0.3 : 0.15;
            else vel = x % 1 === 0 ? pr.hat[0] : pr.hat[1];
            push("box", pb + x, 0.25, "hatClosed", vel);
          }
          if (sec.busy && !fill && bar % 2 === 1) pr.extra.forEach(([v, pos, vel, pitch]) => push("box", pb + pos, 0.25, v, vel, { pitch }));
          if (fill) FILL.forEach(([v, pos, vel, pitch]) => push("box", pb + pos, 0.25, v, vel, { pitch }));
        }
        if (sec.boxTo != null) { push("box", sec.boxTo, 0.25, "softKick", 0.5); push("box", sec.boxTo, 0.5, "hatOpen", 0.2); }
      }

      // ---- weather ----
      const weatherRun = (track, [from, to, level], dr, f) => {
        let t = from + r.pick([0, 0.5, 1, 2]);
        while (t < to - 3) {
          const d = r.range(dr[0], dr[1]);
          push(track, t, d, track, level * r.range(0.8, 1.1), f());
          t = Math.round((t + d * r.range(0.55, 0.8)) * 2) / 2;
        }
      };
      if (sec.sea) weatherRun("sea", sec.sea, [10, 14], () => ({ f1: r.range(240, 340), f2: r.range(1100, 1900), f3: r.range(240, 340), pan: r.range(-0.5, 0.5), pan2: r.range(-0.5, 0.5) }));
      if (sec.wind) weatherRun("wind", sec.wind, [7, 12], () => { const s = r.chance(0.5) ? 1 : -1; return { f1: r.range(500, 800), f2: r.range(1400, 2600), f3: r.range(450, 750), pan: -0.6 * s, pan2: 0.6 * s }; });
      // a rising whoosh into the next section, a sea swell where the floor drops away
      if (["M", "BD1", "X1"].includes(next) && name !== "BD1") push("wind", 24, 8, "wind", 0.42, { f1: 320, f2: 4200, f3: 2400, rise: true, pan: -0.5, pan2: 0.5 });
      if (name === "BD1") push("sea", 0, 14, "sea", 0.55, { f1: 1800, f2: 600, f3: 260, pan: 0, pan2: -0.3 });

      const keyName = nameOf(key, key);
      const preset = sec.box ? ` · rhythm box: ${PRESETS[sec.box].name}` : "";
      return { events: ev, harmony: harmony.map(({ bar, beat, dur, chord }) => ({ bar, beat, dur, chord })), section: `Season ${state.season + 1} · ${keyName} major · ${sec.label}${preset}`, state };
    },
  });

  /** The written lead, transposed, with ornaments on later statements: scoops and turns. */
  function perform(phrase, shift, level, r, scaleAt) {
    const notes = phrase.map(([b, d, m]) => ({ b, d, m: m + shift }));
    if (level < 1) return notes;
    const out = [];
    notes.forEach((n, i) => {
      const prev = out[out.length - 1];
      // scoop: a 16th from the scale step below, stolen from the previous note's tail; glide does the rest.
      // Skipped when the grace would rub a semitone against the chord it sounds over.
      const grace = T.step(n.m, -1, scaleAt(n.b).sc), under = scaleAt(n.b - 0.25).pcs;
      const rubs = under.some((pc) => [1, 11].includes(mod12(grace - pc)));
      if (n.d >= 1.5 && !rubs && prev && !prev.grace && Math.abs(prev.b + prev.d - n.b) < 1e-6 && prev.d >= 1 && r.chance(0.3 + 0.1 * Math.min(level, 2))) {
        prev.d -= 0.25;
        out.push({ b: n.b - 0.25, d: 0.25, m: grace, grace: true });
      }
      // turn at the end of a long note: upper neighbour and back
      const nextN = notes[i + 1];
      if (n.d >= 2.5 && r.chance(0.3) && (!nextN || nextN.b >= n.b + n.d - 1e-6)) {
        const sc2 = scaleAt(n.b + n.d - 0.5).sc;
        const up = T.step(n.m, 1, sc2);
        out.push({ b: n.b, d: n.d - 0.5, m: n.m });
        out.push({ b: n.b + n.d - 0.5, d: 0.25, m: up, grace: true });
        out.push({ b: n.b + n.d - 0.25, d: 0.25, m: n.m, grace: true });
        return;
      }
      out.push({ ...n });
    });
    return out;
  }

  /** The key's major scale, with a borrowed chord's altered tones replacing their naturals (C over D major
   *  gives D mixolydian; Gm6 gives the Bb). Keeps steps, scoops and turns diatonic to the moment. */
  function keyScale(c, key) {
    const sc = T.scale(key, "ionian");
    for (const pc of c.pcs) {
      if (sc.includes(pc)) continue;
      const nat = sc.includes(mod12(pc + 1)) ? mod12(pc + 1) : mod12(pc - 1);
      const i = sc.indexOf(nat);
      if (i >= 0) sc.splice(i, 1);
      sc.push(pc);
    }
    return sc;
  }

  /** No semitone rubs inside the string machine: move a note of a minor-2nd pair an octave. */
  function splitSemitones(v, c, lo, hi) {
    for (let guard = 0; guard < 4; guard++) {
      v.sort((a, b) => a - b);
      const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
      if (i < 0) return;
      const ok = (m) => !v.some((z) => Math.abs(z - m) <= 1);
      if (v[i] + 12 <= hi && ok(v[i] + 12)) v[i] += 12;
      else if (v[i - 1] - 12 >= lo && ok(v[i - 1] - 12)) v[i - 1] -= 12;
      else v.splice(c.guide.includes(mod12(v[i])) ? i - 1 : i, 1);
    }
    v.sort((a, b) => a - b);
  }
})();
