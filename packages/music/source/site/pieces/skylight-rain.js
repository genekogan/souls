// Rain on the Skylight: the weather turned and everyone is indoors; the game goes on. F major at 66,
// straight, for a felt piano, a clarinet-ish chip voice, and the rain.
//
// The band: a soft piano (the voice: a few repeating cells in the right hand, suspended voicings in the
// left), a hollow clarinet-like mono voice with scoops, slurs and breaths (Sim.phrasing) that is run through
// the SNES chip's output stage and its short dark echo (Sim.spc) so it sits a room away, pitched drips on the
// chip's glass pluck through the same echo, the rain itself (pink noise through moving filters whose level
// follows the weather, plus two hundred tiny noise bursts a minute on the window), an upright bass that
// moves in whole notes, a glass pad under the heavier rain, and brushes on 2 and 4 that are often absent
// (Sim.groove, laid back). One tune shared between piano and clarinet: Sim.dialogue hands the long phrase
// between them, alternates the cells, and lets the clarinet answer in the rests.
//
// THE CELLS (A, 8 bars; fixed by hand, the generator never changes a pitch or a rhythm). One shape: a rest,
// a note, a third down, a step down and hold. It falls like a drop and lands on the colour of each chord.
//   | Fadd9 | Fadd9 | Bbmaj9 | Bbsus2 | Dm9 | Dm9 | Gm11 | C9sus4 |
//   | . C5 A4 G4~~ | . A4 G4 F4 . | . C5 A4 G4~~ | . C5 G4 F4 . | . F5 D5 C5~~ | . E5 C5 A4 . | . D5 Bb4 A4~~ | . Bb4 G4 F4 . |
//   bar 1 lands on the 9th; bar 2 on the root; bar 3 the same cell over IV (A is its 7th); bar 4 the third
//   leaves (sus2) and the cell loosens to a fourth; bars 5-6 the cell a fourth up over vi; bar 7 lands on the
//   9th of ii; bar 8 the sus 4 held into the next downbeat, where it is the root again.
// THE LONG PHRASE (B, 8 bars; arrives every other lap, when the rain is heaviest):
//   | Bbmaj9 | Bbm6 | Fmaj9/A | Dm9 | Gm11 | Ebmaj9 | C9sus4 | C9sus4 |
//   | . D5 F5 A5 | G5~~ F5 Db5 | C5~ D5 E5 | F5~~ E5 D5 | . D5 F5 G5~~ | G5~ Eb5 D5~~ | . Bb4 G4 F4~~ | . C5 A4 G4~~ |
//   bar 1 climbs the IV triad to its 7th; bar 2 the borrowed iv (Bbm6) darkens: the 6th held, Db the rain
//   getting heavier; bar 3 resolves Db to C over I/3 and climbs; bar 4 the top; bar 5 the cell mirrored
//   (rising); bar 6 the cell over the borrowed bVII (Ebmaj9); bars 7-8 the cells come home on the sus chord.
// ONE LAP = A 8 · A′ 8 · B 8 · A″ 8 = 32 bars ≈ 1:56 (a 4-bar intro once). Even laps bring the long phrase;
// on odd laps the middle eight is the rain alone over the same borrowed chords, and the cells insist less.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove;
  const { mod12 } = T;
  const BPB = 4, CB = 4, BPM = 66;
  const db = (x) => Math.pow(10, x / 20);
  const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

  // ---------- harmony ----------
  const PROG = {
    intro: "| Fadd9 | Fadd9 | Bbsus2 | Bbsus2 |",
    A: "| Fadd9 | Fadd9 | Bbmaj9 | Bbsus2 | Dm9 | Dm9 | Gm11 | C9sus4 |",
    B: "| Bbmaj9 | Bbm6 | Fmaj9/A | Dm9 | Gm11 | Ebmaj9 | C9sus4 | C9sus4 |",
  };
  const TL = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  // left-hand voicings, by hand: suspended 2nds and 4ths, the root mostly left to the bass
  const LH = {
    Fadd9: [[53, 55, 60], [48, 55, 57]],
    Bbmaj9: [[50, 57, 60], [53, 57, 62]],
    Bbsus2: [[53, 58, 60], [48, 53, 58]],
    Dm9: [[48, 53, 57], [50, 57, 60]],
    Gm11: [[50, 53, 60], [53, 58, 60]],
    C9sus4: [[53, 58, 62], [50, 55, 58]],
    Bbm6: [[53, 55, 61], [49, 55, 58]],
    "Fmaj9/A": [[55, 60, 64], [52, 57, 60]],
    Ebmaj9: [[50, 55, 58], [53, 58, 62]],
  };

  // ---------- the tune (Sim.phrasing notation: Note/beats + marks; ^ scoop, ~ slur, v vibrato, _ tenuto) ----------
  const CELLS = [
    "r/0.5 C5/1 A4/0.5~ G4/2~",
    "r/0.5 A4/1 G4/0.5~ F4/1~ r/1",
    "r/0.5 C5/1 A4/0.5~ G4/2~",
    "r/0.5 C5/1 G4/0.5~ F4/1~ r/1",
    "r/0.5 F5/1 D5/0.5~ C5/2~",
    "r/0.5 E5/1 C5/0.5~ A4/1~ r/1",
    "r/0.5 D5/1 Bb4/0.5~ A4/2~v",
    "r/0.5 Bb4/1 G4/0.5~ F4/1~ r/1",
  ];
  const LONG = [
    "r/1 D5/1^ F5/1~ A5/1~",
    "G5/2.5~v F5/0.5~ Db5/1~",
    "C5/2~ D5/1~ E5/1~",
    "F5/2.5~v E5/0.5~ D5/1~",
    "r/0.5 D5/1^ F5/0.5~ G5/2~v",
    "G5/1.5_ Eb5/0.5~ D5/2~v",
    "r/0.5 Bb4/1 G4/0.5~ F4/2~",
    "r/0.5 C5/1 A4/0.5~ G4/2~v",
  ];
  const PHR = {
    A: [{ from: 0, to: 7, dyn: "arch", legato: true }, { from: 8, to: 15, dyn: "arch", legato: true }, { from: 16, to: 23, dyn: "arch", legato: true }, { from: 24, to: 31, dyn: ">", legato: true }],
    B: [{ from: 0, to: 16, dyn: "arch", legato: true }, { from: 16, to: 24, dyn: "arch", legato: true }, { from: 24, to: 32, dyn: ">", legato: true }],
  };

  // ---------- form ----------
  // cycle 0 is the intro; then laps of 8 cycles: A A A2 A2 B B A3 A3
  const SECS = ["A", "A", "A2", "A2", "B", "B", "A3", "A3"];
  function where(cycle) {
    if (cycle === 0) return { lap: 0, pos: -1, sec: "intro", half: 0 };
    const c = cycle - 1;
    return { lap: Math.floor(c / 8), pos: c % 8, sec: SECS[c % 8], half: c % 2 };
  }
  // who: piano | clar | handoff | alternate | long (rotates) | none. respond: the clarinet answers in the rests.
  // rain: [level at the section's first half, at its second]. drips: expected pitched drips per bar.
  // lh: hold | broken | arp. brushes: null | "light". pad: the glass bed. drop: chance a 2-bar cell is left out.
  const PLAN = [
    { // even laps: the long phrase arrives
      A: { who: "piano", drop: 0, rain: [0.3, 0.35], drips: 0.45, brushes: null, lh: "hold" },
      A2: { who: "piano", respond: true, rain: [0.4, 0.5], drips: 0.6, brushes: "light", lh: "broken" },
      B: { who: "long", rain: [0.8, 0.9], drips: 1.1, brushes: "light", lh: "arp", pad: true },
      A3: { who: "alternate", rain: [0.55, 0.25], drips: 0.5, brushes: "light", lh: "broken", gutter: true },
    },
    { // odd laps: the rain has the middle
      A: { who: "piano", drop: 0.25, rain: [0.25, 0.3], drips: 0.35, brushes: null, lh: "hold" },
      A2: { who: "clar", rain: [0.35, 0.5], drips: 0.6, brushes: null, lh: "broken" },
      B: { who: "none", rain: [0.9, 0.95], drips: 1.6, brushes: null, lh: "arp", pad: true },
      A3: { who: "piano", respond: true, drop: 0.15, rain: [0.5, 0.25], drips: 0.5, brushes: "light", lh: "broken" },
    },
  ];
  const INTRO = { who: "none", rain: [0.3, 0.3], drips: 0.5, brushes: null, lh: "hold" };
  const NAMES = { intro: "intro · the rain starts", A: "A · the cells", A2: "A′ · the cells", B: "B · the long phrase, the rain heavier", A3: "A″ · the cells, the rain easing" };
  const WHO = { piano: "piano", clar: "clarinet", handoff: "piano and clarinet pass it", alternate: "piano and clarinet alternate", none: "no tune" };

  // ---------- a clarinet-ish voice: odd harmonics, a hollow filter, late vibrato ----------
  function clarinetSynth(ctx) {
    return ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.03, 0.5, 0.03, 0.26, 0.02, 0.11, 0.01, 0.04] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.8 },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.28 },
      filterEnvelope: { attack: 0.06, decay: 0.3, sustain: 0.7, release: 0.3, baseFrequency: 520, octaves: 1.9 },
    }));
  }

  Sim.register({
    id: "skylight-rain",
    title: "Rain on the Skylight",
    genre: "Rainy day",
    about: "The weather turned and everyone is indoors. A felt piano plays a few falling cells over suspended voicings while the rain (filtered noise whose level follows the weather, hundreds of tiny drops on the window, pitched drips through the SNES chip's echo) comes and goes; a clarinet-like voice a room away answers in the rests and, every other lap, shares one longer phrase with the piano over borrowed chords as the rain gets heavier. Upright bass in whole notes, a glass pad under the downpour, brushes that are mostly absent. F major at 66.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["work", "sleep", "hangout"],
    energy: 0.3,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 300, highcut: 6000 });
      const hall = I.reverb(ctx, out, { decay: 5.2, preDelay: 0.04, lowcut: 400, highcut: 4500 });

      // the piano
      const piano = I.softPiano(ctx, { volume: 0, cutoff: 2400, decay: 5, release: 2.5 });
      const pP = I.place(ctx, piano, -0.08, out);
      I.send(ctx, pP, room, -12); I.send(ctx, pP, hall, -20);

      // the chip: the drips and the clarinet go through its lo-fi stage and its short dark echo
      const chip = Sim.spc.chip(ctx, { voices: 4, bits: 10, crush: 0.3, rate: 32000, tone: 6500, volume: 0, echo: { time: 0.176, feedback: 0.5, tone: 2600, level: -7 } });
      I.send(ctx, chip.out, hall, -14);
      const dripR = chip.voice("pluck", { poly: 2, priority: 2, echo: 0.8, pan: 0.42, volume: -9, wave: "glass", cutoff: 7000, decay: 0.32, release: 0.08, bend: { cents: -140, time: 0.035 } });
      const dripL = chip.voice("pluck", { poly: 2, priority: 2, echo: 0.7, pan: -0.45, volume: -10, wave: "glass", cutoff: 6000, decay: 0.28, release: 0.08, bend: { cents: -90, time: 0.03 } });
      const clar = P.wrap(ctx, clarinetSynth(ctx), {
        volume: -12, glide: 0.07, scoopTime: 0.1, fallTime: 0.25, release: 0.28,
        vibrato: { rate: 4.9, depth: 0.05, delay: 0.45, rise: 0.5, deepen: 1.2 },
        breath: P.breath(ctx, chip.bus, { level: -34, freq: 1800, length: 0.12 }),
      });
      const clarPan = ctx.keep(new Tone.Panner(0.18)).connect(chip.bus);
      clar.out.connect(clarPan);
      const clarEcho = ctx.keep(new Tone.Gain(0.45));
      clarPan.connect(clarEcho); clarEcho.connect(chip.echo);

      // the rain: a pink-noise bed through a highpass (opens as the rain gets heavier) and a slowly wandering lowpass
      const RAIN_DB = -22;
      const bedNoise = ctx.keep(new Tone.Noise({ type: "pink" }).start());
      const bedHp = ctx.keep(new Tone.Filter({ frequency: 800, type: "highpass", rolloff: -12 }));
      const bedLp = ctx.keep(new Tone.Filter({ frequency: 2200, type: "lowpass", rolloff: -12, Q: 0.4 }));
      const bedGain = ctx.keep(new Tone.Gain(0));
      const bedOut = ctx.keep(new Tone.Panner(0.05)).connect(out);
      bedNoise.chain(bedHp, bedLp, bedGain, bedOut);
      const bedLfo = ctx.keep(new Tone.LFO({ frequency: 0.045, min: 1500, max: 2900 }).start());
      bedLfo.connect(bedLp.frequency);
      I.send(ctx, bedOut, room, -16);
      // drops on the window: two short noise bursts, left and right, each a monophonic source
      const mkPat = (pan, freq, level) => {
        const g = ctx.keep(new Tone.Gain(db(level)));
        const bp = ctx.keep(new Tone.Filter({ frequency: freq, type: "bandpass", Q: 1.6 }));
        const p = ctx.keep(new Tone.Panner(pan)).connect(out);
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.02 } }));
        n.chain(bp, g, p);
        I.send(ctx, p, room, -10);
        return { n, safe: I.monotonic(g) };
      };
      const patL = mkPat(-0.55, 3200, -20), patR = mkPat(0.5, 4300, -21);

      const pad = I.glassPad(ctx, { volume: -20, attack: 2.5, release: 4 });
      const padP = I.place(ctx, pad, -0.2, out);
      I.send(ctx, padP, hall, -8);
      const bass = I.upright(ctx, { volume: -7, base: 140 });
      const bP = I.place(ctx, bass, 0, out);
      I.send(ctx, bP, room, -24);
      const kit = I.kit(ctx, { volume: -8, kickNote: 34, preload: ["brushSweep", "brushTap", "hatPedal", "softKick"] });
      const kP = I.place(ctx, kit, 0.1, out);
      I.send(ctx, kP, room, -14);

      return {
        piano: { layer: "melody", humanize: { timing: 0.012, vel: 0.05 }, play: (t, e, d) => piano.play(t, e.note, d, e.vel) },
        clar: { layer: "melody", humanize: { timing: 0.008, vel: 0.04 }, play: (t, e, d) => clar.play(t, e, d) },
        pianoLH: { layer: "harmony", humanize: { timing: 0.016, vel: 0.06 }, play: (t, e, d) => piano.play(t, e.note, d, e.vel) },
        pad: { layer: "harmony", humanize: { timing: 0.02, vel: 0.03 }, play: (t, e, d) => pad.play(t, e.note, d, e.vel) },
        bass: { layer: "bass", humanize: { timing: 0.006, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.008, vel: 0.1 }, play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.len }) },
        rain: {
          layer: "texture", humanize: { timing: 0, vel: 0 },
          play: (t, e) => {
            const lv = clamp01(e.level), secs = Math.max(0.5, Number.isFinite(e.secs) ? e.secs : 6);
            const target = lv <= 0 ? 0 : db(RAIN_DB - (1 - lv) * 9);
            bedGain.gain.cancelScheduledValues(t);
            bedGain.gain.linearRampTo(target, secs, t);
            bedHp.frequency.cancelScheduledValues(t);
            bedHp.frequency.linearRampTo(950 - lv * 500, secs, t);
          },
        },
        patter: { layer: "texture", humanize: { timing: 0.03, vel: 0.2 }, play: (t, e) => { const p = e.side < 0 ? patL : patR; p.n.triggerAttackRelease(0.03, p.safe(t), clamp01(e.vel)); } },
        dripL: { layer: "texture", humanize: { timing: 0.01, vel: 0.1 }, play: (t, e, d) => dripL.play(t, e, d) },
        dripR: { layer: "texture", humanize: { timing: 0.01, vel: 0.1 }, play: (t, e, d) => dripR.play(t, e, d) },
      };
    },

    compose({ cycle, rng: r, state }) {
      const { lap, pos, sec, half } = where(cycle);
      const intro = sec === "intro";
      const plan = intro ? INTRO : PLAN[lap % 2][sec];
      const progName = intro ? "intro" : sec === "B" ? "B" : "A";
      const prog = TL[progName];
      const secBars = intro ? 4 : 8, secStart = half * 16, secEnd = secBars * BPB;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(Math.max(0, Math.min(b, secEnd - 0.001))).chord;
      const scaleAt = (b) => T.chord(sym(b)).scale;
      const lastHalf = secStart + 16 >= secEnd;
      let ev = [];
      // push by beat within the SECTION; events outside this cycle's window are dropped
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - secStart;
        if (abs < -1e-6 || abs >= 16 - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: clamp01(vel), ...extra });
      };

      // ---------- the tune: built once per section and lap, then shared by both halves ----------
      let who = plan.who;
      if (who === "long") who = ["piano", "handoff", "clar", "alternate"][Math.floor(lap / 2) % 4];
      const key = `${sec}:${lap}`;
      if (!state.line || state.line.key !== key) {
        const rr = r.fork(31 + lap);
        const L = { key, notes: [], who };
        if (!intro && who !== "none") {
          const text = sec === "B" ? LONG : CELLS;
          let line = P.line(text, { beatsPerBar: BPB, track: "piano" });
          // on the quieter laps some cells are left out: the hook insists less
          if (plan.drop) {
            const keep = [0, 1, 2, 3].map(() => !rr.chance(plan.drop));
            if (keep.every((k) => !k)) keep[rr.int(0, 3)] = true;
            line = line.filter((e) => keep[Math.floor(e.bar / 2)]);
          }
          line.forEach((e) => {
            const base = sec === "B" ? 0.56 : 0.5;
            e.vel = base + (e.note - 67) / 140 + (e.dur >= 2 ? 0.02 : 0) + rr.gauss(0.012);
          });
          const shaped = P.articulate(line, PHR[sec === "B" ? "B" : "A"], { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.05, breathLate: 0.03, breathGap: 0.12 });
          const notes = shaped.map((e) => ({ ...e, at: e.bar * BPB + e.beat }));
          const VP = { track: "piano", range: [53, 88] }, VC = { track: "clar", range: [55, 84], gain: 0.9 };
          const marks = PHR[sec === "B" ? "B" : "A"];
          const windows = marks.map((p, i) => [p.from, i + 1 < marks.length ? marks[i + 1].from : secEnd]);
          let dist;
          if (who === "piano") dist = notes.map((n) => ({ ...n, track: "piano" }));
          else if (who === "clar") dist = notes.map((n) => ({ ...n, track: "clar", vel: n.vel * 0.9 }));
          else if (who === "handoff") dist = D.distribute(notes, { voices: [VP, VC], mode: "handoff", rng: rr, bpb: BPB, phrases: windows, handoffDur: 2.4, minNotes: 3, handoffChance: 0.7, stay: 0.5, join: "extend", overlap: 0.2 });
          else dist = D.distribute(notes, { voices: [VP, VC], mode: "phrase", order: lap % 4 === 0 ? ["piano", "clar"] : ["clar", "piano"], rng: rr, bpb: BPB, phrases: windows });
          if (plan.respond) {
            const calls = dist.filter((n) => n.track === "piano");
            const ans = D.respond(calls, {
              track: "clar", transform: (i) => ({ tail: 2, even: 0.5, steps: i % 2 ? -1 : -2 }), scaleAt, range: [57, 79], vel: 0.42,
              minGap: 1, end: secEnd, bpb: BPB, breath: 0.4,
              gap: (i, ph) => { const e = Math.max(...ph.map((n) => n.at + n.dur)); return Math.round(e * 2) / 2 - e; },
            });
            const skip = new Set();
            for (const n of ans) { const b = Math.floor(n.at / BPB); if (!skip.has(b) && rr.chance(0.3)) skip.add(b); }
            dist = dist.concat(ans.filter((n) => !skip.has(Math.floor(n.at / BPB)) || skip.has(-1)));
          }
          // a piano cannot scoop or slur: strip the clarinet's articulation from its notes
          dist = dist.map((n) => (n.track === "clar" ? n : { ...n, scoop: undefined, fall: undefined, bend: undefined, vib: undefined, breath: undefined, legato: undefined, delay: n.delay && n.entrance ? n.delay : undefined }));
          // the left hand's thumb reaches down to double a held note an octave below, now and then
          const extra = [];
          for (const n of dist) if (n.track === "piano" && n.dur >= 2 && n.note - 12 >= 65 && rr.chance(0.35)) extra.push({ ...n, note: n.note - 12, vel: n.vel * 0.7, track: "piano", delay: undefined });
          L.notes = dist.concat(extra);
        }
        state.line = L;
      }
      const tune = state.line.notes;
      for (const n of tune) {
        const { at, bar, beat, dur, note, vel, track, idx, phrase, voice, shift, entrance, handoff, join, answer, art, ...extra } = n;
        push(track, at, dur, note, vel, extra);
      }
      // notes the accompaniment must not rub against (held, in this window)
      const held = tune.filter((n) => n.dur >= 0.9 && n.at < secStart + 16 && n.at + n.dur > secStart);
      const rub = (m, y) => [1, 13].includes(Math.abs(m - y));
      const rubsIn = (v, s0, s1) => {
        const hs = held.filter((n) => n.at < s1 - 0.3 && n.at + n.dur > s0 + 0.3).map((n) => n.note);
        return v.filter((m) => hs.some((h) => rub(m, h)));
      };

      // ---------- harmony: the left hand, the glass pad ----------
      // spans: adjacent bars of the same chord merged (a two-bar Fadd9 is one span), clipped to this window
      const merged = [];
      for (const c of prog) {
        const s = c.bar * BPB + c.beat, last = merged[merged.length - 1];
        if (last && last.chord === c.chord && Math.abs(last.s + last.dur - s) < 1e-6) last.dur += c.dur;
        else merged.push({ chord: c.chord, s, dur: c.dur });
      }
      const spans = merged.filter((c) => c.s < secStart + 16 && c.s + c.dur > secStart).map((c) => {
        const s = Math.max(c.s, secStart), e = Math.min(c.s + c.dur, secStart + 16);
        return { chord: c.chord, s, dur: e - s, cut: s > c.s };
      });
      spans.forEach((c) => {
        const ch = T.chord(c.chord);
        const opts = LH[c.chord];
        if (!opts) throw new Error(`skylight-rain: no left-hand voicing for ${c.chord}`);
        // prefer the voicing nearest the last one; drop a voice that rubs a held tune note
        const dist = (v) => (state.lhPrev ? v.reduce((a, m, i) => a + Math.abs(m - (state.lhPrev[i] ?? m)), 0) : 0);
        let v = opts.slice().sort((a, b) => dist(a) - dist(b) + r.range(-2, 2))[0];
        const bad = rubsIn(v, c.s, c.s + c.dur);
        if (bad.length) { const alt = opts.find((o) => !rubsIn(o, c.s, c.s + c.dur).length); v = alt || v.filter((m) => !bad.includes(m)); }
        state.lhPrev = v;
        const vel = (intro ? 0.42 : sec === "B" ? 0.42 : 0.38) + r.range(-0.02, 0.02);
        const bars = Math.round(c.dur / BPB);
        for (let b = 0; b < bars; b++) {
          const s = c.s + b * BPB, second = b > 0;
          if (plan.lh === "hold") {
            // one chord per span, or struck again on the second bar
            if (b === 0) { const again = bars > 1 && r.chance(0.7); push("pianoLH", s, (again ? BPB : c.dur) - 0.3, v, vel); if (!again) break; }
            else push("pianoLH", s, BPB * (bars - b) - 0.3, v, vel - 0.06);
          } else if (plan.lh === "broken") {
            push("pianoLH", s, 3.7, v[0], vel + 0.02);
            const at = r.pick(second ? [1.5, 2.5] : [1.5, 2]);
            push("pianoLH", s + at, 4 - at - 0.2, v.slice(1), vel - 0.06);
          } else { // arp: the chord rolled upward and left ringing
            const vs = r.chance(0.4) && v.length > 2 ? [v[0], v[1], v[2], v[1]] : v;
            vs.forEach((m, i) => push("pianoLH", s + i * 0.5, 3.8 - i * 0.5, m, vel - 0.02 - i * 0.03));
          }
        }
        if (plan.pad) {
          let pv = T.voice(c.chord, { lo: 62, hi: 79, n: 3, prev: state.pV, rng: r, omitBass: true, top: [69, 79] });
          state.pV = pv;
          const bad = rubsIn(pv, c.s, c.s + c.dur);
          pv = pv.filter((m) => !bad.includes(m) && !v.some((x) => rub(x, m)));
          for (let i = pv.length - 1; i > 0; i--) if (pv[i] - pv[i - 1] === 1) pv.splice(ch.guide.includes(mod12(pv[i])) ? i - 1 : i, 1);
          if (pv.length) push("pad", c.s, c.dur - 0.5, pv.length > 1 ? pv : pv[0], 0.3 + (sec === "B" && lap % 2 ? 0.04 : 0));
        }
      });

      // ---------- bass: whole notes, the root; now and then the fifth or a step into the next root ----------
      {
        const lo = 36, hi = 50;
        let last = state.bLast ?? 41;
        spans.forEach((c, i) => {
          const ch = T.chord(c.chord);
          const root = T.nearest(41, [ch.bass], lo, hi);
          const vr = (sec === "B" ? 0.62 : 0.56) + r.range(-0.02, 0.02);
          const bars = Math.round(c.dur / BPB);
          const nextSym = i + 1 < spans.length ? spans[i + 1].chord : merged.find((x) => x.s >= c.s + c.dur)?.chord || (sec === "B" || intro ? TL.A : TL[SECS[(pos + 1) % 8] === "B" ? "B" : "A"])[0].chord;
          const nextRoot = T.nearest(root, [T.chord(nextSym).bass], lo, hi);
          const finalBar = lastHalf && c.s + c.dur >= secEnd;
          if (bars === 1) {
            // a step into the next root, from the side away from where we are
            const above = T.step(nextRoot, 1, ch.scale), below = T.step(nextRoot, -1, ch.scale);
            let app = nextRoot < root ? above : below;
            if (app === root) app = app === above ? below : above;
            if (finalBar && nextRoot !== root && app !== root && app >= lo && app <= hi && r.chance(0.45)) {
              push("bass", c.s, 2.6, root, vr);
              push("bass", c.s + 3, 0.9, app, vr - 0.14);
            } else push("bass", c.s, BPB - 0.4, root, vr);
          } else {
            const figure = r.weighted([["hold", 3], ["restrike", 2], ["fifth", 1.2]]);
            if (figure === "hold") push("bass", c.s, c.dur - 0.5, root, vr);
            else if (figure === "restrike") { push("bass", c.s, BPB - 0.4, root, vr); push("bass", c.s + BPB, BPB - 0.5, root, vr - 0.1); }
            else {
              push("bass", c.s, BPB + 1.6, root, vr);
              const fifthPc = mod12(ch.root + 7);
              const fifth = T.nearest(root > 43 ? root - 5 : root + 7, [fifthPc], lo, hi);
              push("bass", c.s + BPB + 2, 1.6, fifth, vr - 0.12);
            }
          }
          last = root;
        });
        state.bLast = last;
      }

      // ---------- brushes: a soft pulse on 2 and 4, often absent ----------
      if (plan.brushes) {
        const hit = (b, voice, vel, extra) => push("drums", b, 0.1, voice, vel, extra);
        for (let bar = 0; bar < 4; bar++) {
          const s = secStart + bar * BPB;
          // the rain eases out: the last two bars of A″ have no brushes
          if (plan.gutter && lastHalf && bar >= 2) continue;
          hit(s + 1, "brushSweep", 0.2 + r.range(0, 0.03), { len: 0.36 });
          hit(s + 3, "brushSweep", 0.19 + r.range(0, 0.03), { len: 0.36 });
          if (r.chance(0.6)) { hit(s + 1, "hatPedal", 0.1); hit(s + 3, "hatPedal", 0.1); }
          [0.5, 1.5, 2.5, 3.5].forEach((o) => { if (r.chance(0.2)) hit(s + o, "brushTap", 0.1 + r.range(0, 0.04)); });
          if (r.chance(0.3)) hit(s, "softKick", 0.18);
        }
      }

      // ---------- the rain ----------
      {
        const level = plan.rain[intro ? 0 : half];
        push("rain", secStart, 0.1, "bed", 0.5, { level, secs: intro ? 9 : 7 });
        // drops on the window
        for (let bar = 0; bar < 4; bar++) {
          const n = Math.round((2 + level * 15) * r.range(0.75, 1.25));
          for (let k = 0; k < n; k++) {
            const at = Math.round(r() * 32) / 8;
            push("patter", secStart + bar * BPB + Math.min(at, 3.875), 0.1, "drop", 0.22 + r() * 0.45, { side: r.chance(0.5) ? -1 : 1 });
          }
        }
        // pitched drips through the chip's echo: chord colours high up, never the same note twice running
        const e = plan.drips;
        const drip = (at, note, vel) => push(r.chance(0.5) ? "dripL" : "dripR", at, 0.5, note, vel);
        for (let bar = 0; bar < 4; bar++) {
          let n = Math.floor(e) + (r.chance(e - Math.floor(e)) ? 1 : 0);
          while (n-- > 0) {
            const at = secStart + bar * BPB + r.pick([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) + (r.chance(0.5) ? 0.25 : 0);
            const ch = T.chord(sym(at));
            const cand = [...ch.colors, mod12(ch.root + 7)].filter((pc) => ch.pcs.includes(pc));
            let lad = T.notesIn(cand.length ? cand : ch.pcs, 82, 96).filter((x) => x !== state.dripLast);
            if (!lad.length) lad = T.notesIn(ch.pcs, 82, 96).filter((x) => x !== state.dripLast);
            const target = 84 + r.int(0, 11);
            const m = lad.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
            state.dripLast = m;
            drip(at, m, 0.3 + r() * 0.25);
          }
        }
        // the gutter overflows: three drips down the sus chord into the next lap
        if (plan.gutter && lastHalf && r.chance(0.7)) {
          const ch = T.chord(sym(secEnd - 1));
          const lad = T.notesIn(ch.pcs, 82, 96).reverse();
          const start = r.int(0, Math.max(0, lad.length - 4));
          [2, 2.5, 3].forEach((o, i) => { if (lad[start + i] != null) drip(secEnd - 4 + o, lad[start + i], 0.42 - i * 0.05); });
        }
      }

      // ---------- feel ----------
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { brushSweep: "laidback", brushTap: "pushed", hatPedal: "pushed", softKick: "straight" } },
          pianoLH: { template: "straight", late: 10, vels: false },
          piano: { template: "straight", late: 5, vels: false },
          bass: { template: "straight", late: 6, vels: false },
        },
      });
      ev = G.rubato(ev, { track: "clar", bpm: BPM, bpb: BPB, amount: 0.5, gap: 0.4, linger: "high", legato: true, rng: r.fork(3) });
      ev = G.rubato(ev, { track: "piano", bpm: BPM, bpb: BPB, amount: 0.3, gap: 0.4, linger: "high", rng: r.fork(4) });

      const harmony = prog.filter((c) => c.bar >= half * 4 && c.bar < half * 4 + 4).map((c) => ({ ...c, bar: c.bar - half * 4 }));
      const level = plan.rain[intro ? 0 : half];
      const extras = [intro ? "" : WHO[who], plan.respond ? "clarinet answers" : "", plan.pad ? "glass pad" : "", plan.brushes ? "brushes" : "", `rain ${Math.round(level * 10)}/10`].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${NAMES[sec]} · ${extras}`, state };
    },
  });
})();
