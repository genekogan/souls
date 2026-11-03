// Nightside Pass: space synth for the slow half of an orbit, the pass over a planet's dark side.
// Berlin School in its most patient register: 86 BPM, a 16th-grid sequence that rests more than it plays, a
// PWM pad that is the main character, a CS-80-ish theme that appears once a lap in long notes, a sub pedal,
// and percussion that is mostly absent (a soft electronic kick and a shaker, never a kit). Keys move by major
// thirds, E -> C -> Ab -> E, and each modulation takes a full minute to arrive: the pedal lifts to IV, the
// third darkens, the bass sinks to the Neapolitan, the old tonic turns minor, and the plagal arrival on the
// new key lands exactly on the next lap's downbeat, marked by a bell. The dawn line, reached slowly.
//
// THE SEQUENCE (hand-written; the generator thins it by density, breathes its filter and never reorders it).
// Two bars of 16ths over a five-note set, written in E over E3; "." is a rest, "!" an accent:
//   bar 1 | E3! . E3 .  | B3 . G#3 E3 | E4! . B3 . | C#4 B3 . . |
//   bar 2 | E3! . . B3  | . G#3 E3 .  | F#3! . B3 . | E4 . F#4 . |
// The set is what gives way across the lap, one or two notes at a time, while the sequence keeps its shape:
//   bright  E F# G# B C#   (laps' first half: I, IV, vi, V13sus4)
//   dusk    E F# G  B C    (the third darkens: Am13, iv of E)
//   ember   E G  A  B C    (F in the bass: Fmaj9#11, the Neapolitan)
//   night   E G  A  B D    (Em11, the old tonic as a minor chord; Fmaj9#11 again; then C arrives)
// A single glass note announces each note the set gains (G, A, D), and the bell the new tonic.
//
// THE THEME (CS-80 voice, long notes, hand-written in E; Sim.phrasing marks: ^ scoop, ~ slur, v vibrato, s swell, f fall)
//   | Emaj9          | Emaj9              | C#m11   | Amaj9#11         | Emaj9         | B13sus4 | Amaj9#11       | Amaj9#11       |
//   | . B4 ^ v (3)   | D#5 ~ v (2.5) C#5 ~ | B4 ~ v (4) | . G#5 ^ s (3) | F#5 ~ v E5 ~  | C#5 ~ v (4) | E5 ^ v D#5 ~ | B4 ~ v f (3) . |
//   Phrase 1 hangs on the fifth, glides up to the major seventh and back down to B, now the seventh of C#m11.
//   Phrase 2 leaps to G#5 (the major seventh of A, swelling), falls through the ninth to the root, rests on the
//   ninth of the sus chord, scoops to E over A and sighs through the sharp eleventh home to B, which falls away.
//   The head (bars 1-3) greets each new key on the arrival downbeat; the full theme is heard once per lap.
//
// FORM (one lap = 12 cycles of 4 bars = 48 bars = 2:14 at 86; written in E, transposed by lap):
//   0 nightside (pad, sub; lap > 0: the arrival, bell and theme head)      | Emaj9 x4
//   1 the sequence wakes (lap 0: theme head)                               | Emaj9 x2 | Amaj9#11/E x2
//   2 the pad turns, shaker fades in                                       | C#m11 x2 | Amaj9#11 x2
//   3 lift, the kick arrives                                               | Emaj9 x2 | B13sus4 x2
//   4 theme                                                                | Emaj9 x2 | C#m11 | Amaj9#11
//   5 theme, answer                                                        | Emaj9 | B13sus4 | Amaj9#11 x2
//   6 the pedal lifts to IV, percussion leaves                             | Amaj9 x4
//   7 the third darkens (set: dusk)                                        | Am13 x4
//   8 F under everything (set: ember), shaker returns                      | Fmaj9#11 x4
//   9 the old key, minor (set: night from bar 3)                           | Fmaj9#11 x2 | Em11 x2
//  10 approach                                                             | Em11 x2 | Fmaj9#11 x2
//  11 the dawn line, the sequence thins, the pad swells                    | Fmaj9#11 x4   -> next lap in C
// Across laps only the dress changes: odd laps have no kick and double the theme an octave below with a mellow
// FM voice; the pad's filter, the sequence's density and the shaker's weight shift a little each time.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, G = Sim.groove;
  const { mod12 } = T;
  const BPB = 4, BPM = 86, LAP = 12, CYC = 16; // beats per cycle
  const db = (x) => Math.pow(10, x / 20);
  const fin = (x, d) => (Number.isFinite(x) ? x : d);
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const nameOf = (pc, key) => (key === 4 ? SHARP : T.NAMES)[mod12(pc)];

  // ---------- harmony per cycle in the lap: [semitones above the tonic, quality, beats, bass offset?] ----------
  const PROG = [
    [[0, "maj9", 16]],
    [[0, "maj9", 8], [5, "maj9#11", 8, 0]],
    [[9, "m11", 8], [5, "maj9#11", 8]],
    [[0, "maj9", 8], [7, "13sus4", 8]],
    [[0, "maj9", 8], [9, "m11", 4], [5, "maj9#11", 4]],
    [[0, "maj9", 4], [7, "13sus4", 4], [5, "maj9#11", 8]],
    [[5, "maj9", 16]],
    [[5, "m13", 16]],
    [[1, "maj9#11", 16]],
    [[1, "maj9#11", 8], [0, "m11", 8]],
    [[0, "m11", 8], [1, "maj9#11", 8]],
    [[1, "maj9#11", 16]],
  ];
  const LABEL = ["nightside", "the sequence wakes", "the pad turns", "lift", "theme", "theme · answer", "the pedal lifts",
    "the third darkens", "F under everything", "the old key, minor", "approach", "the dawn line"];

  // ---------- the sequence ----------
  const SEQ = [0, null, 0, null, 3, null, 2, 0, 5, null, 3, null, 4, 3, null, null,
    0, null, null, 3, null, 2, 0, null, 1, null, 3, null, 5, null, 6, null];
  const ACC = new Set([0, 8, 16, 24]);
  // steps in order of importance: the density parameter keeps the first round(d * 17)
  const KEEP = [0, 16, 8, 24, 4, 28, 19, 12, 26, 2, 10, 21, 6, 30, 22, 7, 13];
  const SETS = { bright: [0, 2, 4, 7, 9], dusk: [0, 2, 3, 7, 8], ember: [0, 3, 5, 7, 8], night: [0, 3, 5, 7, 10] };
  const setAt = (pos, bar) => (pos < 7 ? "bright" : pos < 8 ? "dusk" : pos < 9 || (pos === 9 && bar < 2) ? "ember" : "night");

  // ---------- the theme ----------
  const THEME = [
    "r/1 B4/3^v",
    "D#5/2.5~v C#5/1.5~",
    "B4/4~v",
    "r/1 G#5/3^s",
    "F#5/2~v E5/2~",
    "C#5/4~v",
    "E5/2^v D#5/2~",
    "B4/3~vf r/1",
  ];
  const HEAD = THEME.slice(0, 3).concat(["r/4"]);
  const PHR = [{ from: 0, to: 12.5, dyn: "arch", legato: true }, { from: 13, to: 32, dyn: "arch", legato: true }];
  const PHR_HEAD = [{ from: 0, to: 12.5, dyn: "arch", legato: true }];

  // ---------- the plan: pad { vel, cut }, seq { d: density, cut, v, from }, drums, glass ----------
  // glass: [beat, semitones above the tonic]; kick: beats within each bar by bar index; shaker: [fromBar, toBar, shape]
  const PLAN = [
    { pad: { vel: 0.36, cut: [480, 540] }, seq: { d: [0.1, 0.35], cut: [250, 320], v: 0.8, from: 8 }, glass: [0.5, 2] },
    { pad: { vel: 0.38, cut: [540, 600] }, seq: { d: [0.35, 0.65], cut: [320, 420], v: 0.85 } },
    { pad: { vel: 0.4, cut: [600, 660] }, seq: { d: [0.65, 0.8], cut: [420, 520], v: 0.9 }, shaker: [2, 4, "in"] },
    { pad: { vel: 0.41, cut: [660, 720] }, seq: { d: [0.8, 0.9], cut: [520, 640], v: 0.95 }, shaker: [0, 4], kick: (b) => (b >= 2 ? [0] : []) },
    { pad: { vel: 0.4, cut: [720, 760] }, seq: { d: [0.9, 1], cut: [640, 720], v: 1 }, shaker: [0, 4], kick: (b) => (b % 2 ? [0, 2.5] : [0]) },
    { pad: { vel: 0.4, cut: [760, 780] }, seq: { d: [1, 1], cut: [720, 760], v: 1 }, shaker: [0, 4], kick: (b) => (b % 2 ? [0, 2.5] : [0]) },
    { pad: { vel: 0.42, cut: [720, 640] }, seq: { d: [0.9, 0.75], cut: [700, 560], v: 0.95 }, shaker: [0, 4, "out"], kick: (b) => (b < 2 ? [0] : []) },
    { pad: { vel: 0.4, cut: [560, 540] }, seq: { d: [0.6, 0.6], cut: [440, 420], v: 0.85 }, glass: [0, 3] },
    { pad: { vel: 0.4, cut: [560, 600] }, seq: { d: [0.7, 0.8], cut: [460, 540], v: 0.9 }, shaker: [2, 4, "in"], glass: [0, 5] },
    { pad: { vel: 0.41, cut: [600, 640] }, seq: { d: [0.8, 0.85], cut: [540, 600], v: 0.9 }, shaker: [0, 4], kick: (b) => (b % 2 === 0 ? [0] : []), glass: [8, 10] },
    { pad: { vel: 0.42, cut: [620, 580] }, seq: { d: [0.8, 0.65], cut: [560, 440], v: 0.88 }, shaker: [0, 4, "out"], kick: (b) => (b === 0 ? [0] : []) },
    { pad: { vel: 0.44, cut: [560, 620], swell: 0.08 }, seq: { d: [0.6, 0.15], cut: [400, 260], v: 0.8 } },
  ];

  Sim.register({
    id: "nightside-pass",
    title: "Nightside Pass",
    genre: "Space synth",
    about: "The slow half of an orbit, over the dark side. Berlin School at 86 BPM: a hand-written 16th sequence that rests more than it plays, over a PWM pad that voice-leads one voice at a time; a CS-80-ish theme once a lap in long notes with scoops, slurs and late vibrato; a sub pedal; a soft kick and a shaker that come and go. The key moves down a major third every lap (E, C, Ab), and each modulation takes a full minute: the pedal lifts to IV, the third darkens, the bass sinks to the Neapolitan, the old tonic turns minor, and the sequence's five notes give way one at a time until the new key arrives on a bell.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 4, gainDb: 0,
    strongBeats: [0, 2],
    situations: ["explore", "sleep", "work"],
    energy: 0.33,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 9, preDelay: 0.05, lowcut: 240, highcut: 5500 });
      const room = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.02, lowcut: 300, highcut: 6500 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.42, highcut: 2400 });

      // 1. the pad: pulse-width-modulated poly through a slow chorus and a lowpass that opens over the lap
      const padOut = I._lib.outGain(ctx, -8, "pad");
      const padCh = ctx.keep(new Tone.Chorus({ frequency: 0.22, delayTime: 5.5, depth: 0.55, spread: 180, wet: 0.5 }).start()).connect(padOut);
      const padLp = ctx.keep(new Tone.Filter({ frequency: 560, type: "lowpass", rolloff: -24, Q: 0.7 })).connect(padCh);
      const padHp = ctx.keep(new Tone.Filter({ frequency: 150, type: "highpass" })).connect(padLp);
      const padSyn = ctx.keep(new Tone.PolySynth({
        voice: Tone.Synth, maxPolyphony: 16,
        options: { oscillator: { type: "pwm", modulationFrequency: 0.16 }, envelope: { attack: 2.2, decay: 1.5, sustain: 0.8, release: 4.5 } },
      })).connect(padHp);
      const padP = I.place(ctx, { out: padOut }, 0, out);
      I.send(ctx, padP, hall, -9);

      // 2. the sequencer: a narrow pulse, resonant lowpass set per step, dotted-8th ping-pong
      const seqOut = I._lib.outGain(ctx, -11, "analog");
      const seqSyn = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "pulse", width: 0.32 },
        filter: { type: "lowpass", rolloff: -24, Q: 2.6 },
        envelope: { attack: 0.004, decay: 0.24, sustain: 0.25, release: 0.2 },
        filterEnvelope: { attack: 0.003, decay: 0.2, sustain: 0.1, release: 0.25, baseFrequency: 320, octaves: 2.3 },
      })).connect(seqOut);
      const seqMono = I.monotonic(seqOut);
      const seqP = I.place(ctx, { out: seqOut }, -0.14, out);
      I.send(ctx, seqP, echo, -7); I.send(ctx, seqP, hall, -16);

      // 3. the theme voice: two saws a few cents apart, a slow filter attack, glide and late vibrato from the wrapper
      const leadSyn = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "fatsawtooth", count: 2, spread: 9 },
        filter: { type: "lowpass", rolloff: -24, Q: 1.1 },
        envelope: { attack: 0.09, decay: 0.5, sustain: 0.85, release: 0.7 },
        filterEnvelope: { attack: 0.3, decay: 0.8, sustain: 0.55, release: 0.6, baseFrequency: 330, octaves: 2.4 },
      }));
      const lead = P.wrap(ctx, leadSyn, {
        volume: -6, glide: 0.13, scoopTime: 0.16, fallTime: 0.4, bendTime: 0.8, release: 0.7,
        vibrato: { rate: 4.7, depth: 0.08, delay: 0.55, rise: 0.7, deepen: 1.3 },
      });
      const leadCh = ctx.keep(new Tone.Chorus({ frequency: 0.4, delayTime: 4, depth: 0.3, spread: 90, wet: 0.3 }).start());
      lead.out.connect(leadCh);
      const leadP = ctx.keep(new Tone.Panner(0.06)).connect(out);
      leadCh.connect(leadP);
      I.send(ctx, leadP, hall, -8); I.send(ctx, leadP, echo, -16);
      const mellow = P.wrap(ctx, ctx.keep(new Tone.FMSynth({
        harmonicity: 1, modulationIndex: 1.1, oscillator: { type: "sine" }, modulation: { type: "triangle" },
        envelope: { attack: 0.12, decay: 0.5, sustain: 0.8, release: 0.6 },
        modulationEnvelope: { attack: 0.1, decay: 0.8, sustain: 0.4, release: 0.5 },
      })), { volume: -17, glide: 0.13, release: 0.6, vibrato: { rate: 4.4, depth: 0.04, delay: 0.6 } });
      const melP = I.place(ctx, mellow, -0.2, out);
      I.send(ctx, melP, hall, -12);

      // 4. the rest of the room
      const sub = I.sub(ctx, { volume: -4, attack: 0.8, release: 2.5 });
      I.place(ctx, sub, 0, out);
      const glass = I.glassPad(ctx, { volume: -17, attack: 1.2, release: 5 });
      const glP = I.place(ctx, glass, 0.38, out);
      I.send(ctx, glP, hall, -4); I.send(ctx, glP, echo, -14);
      const bell = I.bell(ctx, { volume: -15, decay: 9 });
      const blP = I.place(ctx, bell, -0.25, out);
      I.send(ctx, blP, hall, -3);
      const kit = I.kit(ctx, { volume: -5, kickNote: 34, preload: ["softKick", "shaker"] });
      const kP = I.place(ctx, kit, 0.04, out);
      I.send(ctx, kP, room, -12); I.send(ctx, kP, hall, -18);

      const one = (n) => (Array.isArray(n) ? n[0] : n);
      return {
        pad: {
          layer: "harmony", humanize: { timing: 0.02, vel: 0.02 },
          play: (t, e, d) => {
            padLp.frequency.setTargetAtTime(fin(e.cut, 560), t, 1.5);
            padSyn.triggerAttackRelease(T.hz(one(e.note)), d, t, e.vel);
          },
        },
        seq: {
          layer: "texture", humanize: { timing: 0.0015, vel: 0.03 },
          play: (t, e, d) => {
            seqSyn.filterEnvelope.baseFrequency = fin(e.cut, 320);
            seqSyn.filterEnvelope.octaves = e.acc ? 2.9 : 2.3;
            seqSyn.triggerAttackRelease(T.hz(one(e.note)), d, seqMono(t), e.vel);
          },
        },
        lead: { layer: "melody", humanize: { timing: 0.006, vel: 0.03 }, play: (t, e, d) => lead.play(t, e, d) },
        mellow: { layer: "melody", humanize: { timing: 0.009, vel: 0.04 }, play: (t, e, d) => mellow.play(t, e, d) },
        sub: { layer: "bass", humanize: { timing: 0.002, vel: 0 }, play: (t, e, d) => sub.play(t, e.note, d, e.vel) },
        glass: { layer: "texture", humanize: { timing: 0.02, vel: 0.05 }, play: (t, e, d) => glass.play(t, e.note, d, e.vel) },
        bell: { layer: "texture", play: (t, e, d) => bell.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.004, vel: 0.08 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }) },
      };
    },

    compose({ cycle, rng: r, state }) {
      const lap = Math.floor(cycle / LAP), pos = cycle % LAP;
      const key = mod12(4 - 4 * lap);                      // E, C, Ab, E ...
      const shift = ((key - 4 + 18) % 12) - 6;             // the theme is written in E: 0, -4, +4
      const plan = PLAN[pos];
      const odd = lap % 2 === 1;
      const ev = [];
      const push = (track, b, dur, note, vel, extra = {}) => {
        if (b < -1e-6 || b >= CYC - 1e-6) return;
        const bar = Math.floor(b / BPB + 1e-9), beat = +(b - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---------- harmony ----------
      const symOf = (off, q, bassOff) => nameOf(key + off, key) + q + (bassOff != null ? "/" + nameOf(key + bassOff, key) : "");
      const spans = [];
      let at = 0;
      for (const [off, q, beats, bassOff] of PROG[pos]) {
        const chord = symOf(off, q, bassOff);
        spans.push({ chord, c: T.chord(chord), s: at, e: at + beats, dur: beats, bar: Math.floor(at / BPB), beat: at % BPB });
        at += beats;
      }
      const harmony = spans.map(({ bar, beat, dur, chord }) => ({ bar, beat, dur, chord }));
      const spanAt = (b) => { let cur = spans[0]; for (const sp of spans) { if (sp.s <= b + 1e-6) cur = sp; else break; } return cur; };
      // the next cycle's first chord (for pad notes that may linger across the boundary)
      const nPos = (pos + 1) % LAP, nKey = nPos === 0 ? mod12(key - 4) : key;
      const [nOff, nQ, , nBass] = PROG[nPos][0];
      const nextPcs = new Set(T.chord(nameOf(nKey + nOff, nKey) + nQ + (nBass != null ? "/" + nameOf(nKey + nBass, nKey) : "")).pcs);

      // ---------- the theme (built once per lap, windowed per cycle) ----------
      if (!state.theme || state.theme.lap !== lap) {
        const rr = r.fork(11 + lap);
        const scaleAt = () => T.scale(key, "ionian");
        const build = (bars, phr, head) => {
          const line = P.line(bars, { beatsPerBar: BPB, track: "lead" });
          line.forEach((e, i) => {
            e.note += shift;
            const a = P.parseArt(e.art || "");
            e.vel = 0.6 + (e.dur >= 3 ? 0.03 : 0) + (a.swell ? 0.05 : 0) + rr.gauss(0.01);
            if (i === line.length - 1) e.vel -= 0.04;
            if (a.scoop && i > 0) e.legato = false;      // a scooped note re-attacks instead of gliding
            // later laps: the phrase-1 cadence sometimes falls away; the head's last note sometimes swells
            if (lap > 0 && !head && i === 3 && rr.chance(0.4)) e.fall = 2;
            if (lap > 1 && head && i === 3 && rr.chance(0.5)) e.swell = 1;
          });
          return P.articulate(line, phr, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.08, breathLate: 0.05, breathGap: 0.2, breathFirst: true, overlap: 0.15 });
        };
        state.theme = { lap, full: build(THEME, PHR, false), head: build(HEAD, PHR_HEAD, true) };
      }
      const leadNotes = [];
      const emitLine = (line, b0, bars) => {
        for (const e of line) {
          if (e.bar < b0 || e.bar >= b0 + bars) continue;
          const { bar, beat, track: _t, note: _n, dur: _d, vel: _v, ...rest } = e;
          const b = (bar - b0) * BPB + beat;
          push("lead", b, e.dur, e.note, e.vel, rest);
          leadNotes.push({ b, e: b + e.dur, n: e.note });
          if (odd) {
            const { breath, phraseStart, delay, ...m } = rest;
            push("mellow", b, e.dur, e.note - 12, e.vel * 0.75, m);
            leadNotes.push({ b, e: b + e.dur, n: e.note - 12 });
          }
        }
      };
      if (pos === 4) emitLine(state.theme.full, 0, 4);
      else if (pos === 5) emitLine(state.theme.full, 4, 4);
      else if ((pos === 0 && lap > 0) || (pos === 1 && lap === 0)) emitLine(state.theme.head, 0, 4);

      // ---------- the pad: one voice moves at a time ----------
      padPart({ spans, leadNotes, nextPcs, plan: plan.pad, r, state, push, pos });

      // ---------- sub pedal ----------
      const subs = [];
      for (const sp of spans) {
        const pc = sp.c.bass, last = subs[subs.length - 1];
        if (last && mod12(last.note) === pc) last.dur += sp.dur;
        else { const m = T.nearest(state.subLast ?? 38, [pc], 31, 43); subs.push({ at: sp.s, dur: sp.dur, note: m }); state.subLast = m; }
      }
      subs.forEach((s) => push("sub", s.at, s.dur - 0.2, s.note, pos === 4 || pos === 5 ? 0.66 : 0.6));

      // ---------- glass and bell ----------
      if (plan.glass) {
        const [b, off] = plan.glass;
        push("glass", b, 6, T.nearest(85, [mod12(key + off)], 79, 91), 0.42);
      }
      if (pos === 0 && lap > 0) push("bell", 0, 8, T.nearest(64, [key], 60, 71), 0.36);

      // ---------- the sequence ----------
      {
        const q = plan.seq;
        const base = T.nearest(49, [key], 44, 55);
        const ladders = {};
        const ladder = (name) => (ladders[name] ||= [0, 1, 2].flatMap((o) => SETS[name].map((iv) => base + 12 * o + iv)));
        const vScale = q.v * (odd ? 0.92 : 1);
        for (let s = 0; s < CYC * 4; s++) {
          const step = s % 32, idx = SEQ[step];
          if (idx == null) continue;
          const b = s * 0.25, bar = Math.floor(b / BPB);
          if (q.from != null && b < q.from) continue;
          const u = b / CYC;
          const dens = q.d[0] + (q.d[1] - q.d[0]) * u;
          if (KEEP.indexOf(step) >= Math.round(dens * KEEP.length)) continue;
          const note = ladder(setAt(pos, bar))[idx];
          const glob = cycle * CYC + b;
          const breath = Math.sin((2 * Math.PI * glob) / 32);
          const cut = Math.round((q.cut[0] + (q.cut[1] - q.cut[0]) * u) * (1 + 0.18 * breath));
          const acc = ACC.has(step);
          const vel = (acc ? 0.78 : 0.52 + (step % 4 === 0 ? 0.04 : 0)) * (1 + 0.1 * breath) * vScale;
          const nextRest = SEQ[(step + 1) % 32] == null;
          push("seq", b, nextRest ? 0.4 : acc ? 0.24 : 0.2, note, vel, { cut, acc, straight: true });
        }
      }

      // ---------- percussion: a shaker that fades in and out, a soft kick ----------
      if (plan.shaker) {
        const [from, to, shape] = plan.shaker;
        const weight = lap === 0 ? 1 : odd ? 0.85 : 1.1;
        for (let bar = from; bar < to; bar++) {
          const f = shape === "in" ? (bar - from + 1) / (to - from + 1) : shape === "out" ? 1 - (bar - from) / (to - from) : 1;
          const thin = shape === "out" || pos === 10;
          for (let k = 0; k < 8; k++) {
            const v = (k % 2 === 0 ? 0.27 : 0.2) * f * weight;
            push("drums", bar * BPB + k * 0.5, 0.1, "shaker", v);
          }
          if (!thin) { push("drums", bar * BPB + 1.75, 0.1, "shaker", 0.11 * f * weight); push("drums", bar * BPB + 3.75, 0.1, "shaker", 0.11 * f * weight); }
        }
      }
      if (plan.kick && !odd) {
        for (let bar = 0; bar < 4; bar++) for (const k of plan.kick(bar)) push("drums", bar * BPB + k, 0.3, "softKick", k === 0 ? 0.38 : 0.26);
      }

      // ---------- feel ----------
      let events = G.apply(ev, { bpm: BPM, bpb: BPB, tracks: { drums: { voices: { shaker: { template: "pushed", vels: false } } } } });
      events = G.rubato(events, { track: "lead", bpm: BPM, bpb: BPB, amount: 0.45, linger: "high", lingerMs: 60, legato: true, rng: r });

      const where = pos === 0 && lap > 0 ? `dawn line · arrival in ${nameOf(key, key)}` : LABEL[pos];
      return { events, harmony, section: `Lap ${lap + 1} · ${nameOf(key, key)} · ${where}`, state };
    },
  });

  // ---------- pad voice streams ----------
  /** No semitone pairs inside the pad: lift the upper note an octave, drop the lower, or lose the non-guide tone. */
  function splitSemitones(v, c, lo, hi) {
    for (let guard = 0; guard < 4; guard++) {
      v.sort((a, b) => a - b);
      const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
      if (i < 0) return v;
      const ok = (m) => !v.some((z) => Math.abs(z - m) <= 1);
      if (v[i] + 12 <= hi && ok(v[i] + 12)) v[i] += 12;
      else if (v[i - 1] - 12 >= lo && ok(v[i - 1] - 12)) v[i - 1] -= 12;
      else v.splice(c.guide.includes(mod12(v[i])) ? i - 1 : i, 1);
    }
    return v.sort((a, b) => a - b);
  }
  /** Voices a minor 2nd or 9th from a held theme note move down an octave or leave; then refill to `want`
   *  voices from the fifth, root, colours and guide tones, never a semitone from anything sounding. */
  function clearAgainst(v, c, held, lo, hi, want) {
    const bad = (y) => held.some((n) => [1, 13].includes(Math.abs(n - y)));
    const out = [];
    for (let x of v) {
      if (bad(x) && x - 12 >= lo && !bad(x - 12) && !v.some((z) => Math.abs(z - (x - 12)) <= 2)) x -= 12;
      if (!bad(x) && !out.includes(x)) out.push(x);
    }
    const fill = [mod12(c.root + 7), c.root, ...c.colors, ...c.guide].filter((pc) => c.pcs.includes(pc) && !(c.bass !== c.root && pc === c.bass));
    for (const pc of fill) {
      if (out.length >= want) break;
      if (out.some((m) => mod12(m) === pc)) continue;
      const mid = out.length ? (Math.min(...out) + Math.max(...out)) / 2 : (lo + hi) / 2;
      const cand = T.notesIn([pc], lo, hi).filter((m) => !bad(m) && out.every((z) => Math.abs(z - m) >= 2 && Math.abs(z - m) !== 13));
      if (cand.length) out.push(cand.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x)));
    }
    return out.length ? out.sort((a, b) => a - b) : v;
  }
  function padPart({ spans, leadNotes, nextPcs, plan, r, state, push, pos }) {
    const open = new Map(); // note -> segment
    const segs = [];
    let prev = (state.padLast || []).slice();
    const rub = (a, b) => [1, 13].includes(Math.abs(a - b));
    spans.forEach((sp, i) => {
      const over = leadNotes.filter((x) => x.b < sp.e && x.e > sp.s);
      const themeOn = over.length > 0;
      const lowTop = themeOn ? Math.min(...over.map((x) => x.n)) : 99;
      const lo = 55, hi = themeOn ? Math.max(62, Math.min(70, lowTop - 3)) : 73;
      const n = themeOn && hi > 66 ? 3 : 4; // a low theme (the C lap) gets a fuller pad beneath it
      let v = T.voice(sp.c, { lo, hi, n, prev: state.padV, top: themeOn ? [hi - 5, hi] : [66, 73], rng: r, rootless: !sp.c.sus, omitBass: true });
      v = splitSemitones(v, sp.c, lo, hi);
      v = clearAgainst(v, sp.c, over.map((x) => x.n), lo, hi, n);
      state.padV = v;
      const entering = r.shuffle(v.filter((m) => !prev.includes(m)));
      const leaving = prev.filter((m) => !v.includes(m));
      for (const m of v) {
        if (open.has(m)) open.get(m).end = sp.e;
        // a voice carried over from the last cycle re-attacks on the downbeat (its old note lingers under it)
        else if (i === 0 && prev.includes(m)) open.set(m, { note: m, start: 0, end: sp.e });
      }
      // entries bloom one voice at a time: the first on the change, the next a beat later, and so on
      const starts = new Map();
      entering.forEach((m, k) => {
        const st = sp.s + Math.min(k, Math.max(0, sp.dur - 2));
        starts.set(m, st);
        open.set(m, { note: m, start: st, end: sp.e });
      });
      // a leaving voice holds until its replacement has arrived, unless it would rub against the new chord or the theme
      for (const m of leaving) {
        const seg = open.get(m);
        if (!seg) continue;
        const rep = entering.length ? entering.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a)) : null;
        const until = rep != null ? starts.get(rep) + 0.4 : sp.s + 0.5;
        const clash = v.some((z) => rub(z, m) && (starts.get(z) ?? sp.s) < until) || over.some((x) => x.b < until && rub(x.n, m))
          || [1, 11].includes(mod12(m - sp.c.bass)); // never a flat or sharp ninth over the new bass
        seg.end = clash ? sp.s - 0.05 : Math.min(until, sp.e);
        open.delete(m);
        segs.push(seg);
      }
      prev = v;
    });
    for (const seg of open.values()) { seg.end = CYC + (nextPcs.has(mod12(seg.note)) ? 2 : -0.1); segs.push(seg); }
    state.padLast = prev;
    for (const seg of segs) {
      const u = seg.start / CYC;
      const vel = plan.vel + (plan.swell || 0) * u + r.range(-0.02, 0.02);
      const cut = Math.round(plan.cut[0] + (plan.cut[1] - plan.cut[0]) * u);
      push("pad", seg.start, Math.max(0.5, seg.end - seg.start), seg.note, vel, { cut });
    }
  }
})();
