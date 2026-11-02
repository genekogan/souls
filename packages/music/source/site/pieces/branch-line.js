// Branch Line: a window seat on a slow country train. G major, 106 bpm, for an eight-voice sound chip.
//
// The pulse is the rails: a low thump on one and three, a swung pair of brushed clacks leading into each
// thump ("ta-ka DUM, ta-ka DUM"), a shaker that rides the eighths, a woodblock rail-joint every other bar.
// Nothing on the kit is ever a backbeat. The scenery changes the orchestration, never the tune: strings
// under the plains, a flute and a water-pluck over the river, muted brass in the tunnel with the lead
// answering across the echo, and when the train comes out of the tunnel the whole thing is a whole step
// higher (A major) with bells on the downbeats. The coda's D7 is both IV of A and V of G, so the lap
// closes by itself and the next one starts back in G without a seam.
//
// ---- fixed by hand (the generator never changes a pitch or a rhythm; it arranges, fills, ornaments) ----
//
// THE TUNE (A, 8 bars, G). The cell is 5 1 2 3 on a lilting rhythm (1 · 1½ · ½ · 1): up a fourth to the
// root, then two steps. Bar 2 answers in falling thirds onto the third of iii. Bars 3-4 are the cell a
// step up (from the third of IV) and the same fall onto the third of V. The second phrase descends
// through vi, climbs out of IV, leans on the 11th of ii and settles on the fifth of V, open.
//   | Gadd9       | Bm7        | C69           | D6         | Em7            | Cmaj9      | Am11         | D7sus4 D7  |
//   | D5 G5 A5 B5 | A5 F#5 D5  | E5 A5 B5 C6   | B5 A5 F#5  | G5 F#5 E5 D5 B4 | C5 D5 E5 G5 | A5 G5 E5 D5 | C5 B4 A4   |
//   Counter (half notes, muted brass, from lap 2): B4 A4 | F#4 D4 | G4 A4 | F#4 A4 | G4 E4 | E4 G4 | C5 A4 | G4 F#4
//
// THE RIVER (B, 8 bars): the lift to IV, back down through I in first inversion, then the tender vi.
//   | Cmaj7         | D7/C          | G/B         | G69        | Em9          | Em7/D     | Cmaj7        | D7sus4 D7     |
//   | G5 E5 G5 B5   | A5 B5 A5 F#5  | G5 D5 B4 D5 | E5 D5 ·    | B4 E5 G5 F#5 | E5 D5 B4  | C5 E5 G5 A5  | A5 G5 F#5 D5  |
//
// THE TUNNEL (8 bars, muted brass; E minor, the relative, until the harmony pivots to the new key):
//   | Em9          | Em9        | Cmaj7#11      | Cmaj7#11    | Am11          | F#m7b5     | Bm7           | E7sus4 E7     |
//   | B4 E5 F#5 G5 | F#5 D5 B4  | (lead answers, inverted, in the echo) | A4 D5 E5 G5 | F#5 E5 C5 | D5 F#5 A5 B5 | B5 A5 G#5 (swell) |
//   The cell in minor, twice; F#ø7 → Bm7 is iiø–v in E minor until E7 says it was ii–V of A all along.
//
// OUT OF THE TUNNEL: the tune and the river again, a whole step up (A major), bells and the pluck added.
// CODA (4 bars, A): | A | D/A | A | D7sus4 D7 |   C#5 B4 A4 (the tune's tail) · a bell · the flute's echo · D7 → G.
//
// FORM (one lap = 14 cycles of 4 bars, 56 bars ≈ 2:07): depart 4 · plains A 8 · plains A2 8 · river B 8 ·
// tunnel 8 · A3 (A major) 8 · B2 (A major) 8 · coda 4. Three arrangement plans rotate over laps: who carries
// the tune (lead, flute, or handed between them mid-phrase), whether the counter-line plays, pluck patterns,
// fills, bells. Modules: Sim.phrasing (the lead's slurs, scoops, late vibrato), Sim.spc (voice budget, lo-fi
// stage, echo), Sim.dialogue (handoffs, the tunnel's answers, the counter kept below the tune), Sim.groove
// (the rails' swing templates, rubato for the lead, ghost taps, fill crescendi).
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing, D = Sim.dialogue, G = Sim.groove, S = Sim.spc;
  const BPB = 4, BPM = 106, CB = 4, VOICES = 8;
  const { mod12 } = T;

  // ---------- harmony ----------
  /** Transpose every root / bass letter in a progression string by k semitones. */
  const tr = (text, k) => (k ? text.replace(/[A-G][#b]?/g, (m) => T.NAMES[mod12(T.PC[m] + k)]) : text);
  const PROG = {
    depart: "| G | G | Gadd9 | Gadd9 |",
    A: "| Gadd9 | Bm7 | C69 | D6 | Em7 | Cmaj9 | Am11 | D7sus4:2 D7:2 |",
    B: "| Cmaj7 | D7/C | G/B | G69 | Em9 | Em7/D | Cmaj7 | D7sus4:2 D7:2 |",
    tunnel: "| Em9 | Em9 | Cmaj7#11 | Cmaj7#11 | Am11 | F#m7b5 | Bm7 | E7sus4:2 E7:2 |",
    coda: "| A | D/A | A | D7sus4:2 D7:2 |",
  };
  // one lap: section id, bars, which progression, transposition (A3 / B2 are the tune a whole step up)
  const LAP = [
    { id: "depart", bars: 4, prog: "depart", k: 0 },
    { id: "A", bars: 8, prog: "A", k: 0 },
    { id: "A2", bars: 8, prog: "A", k: 0 },
    { id: "B", bars: 8, prog: "B", k: 0 },
    { id: "tunnel", bars: 8, prog: "tunnel", k: 0 },
    { id: "A3", bars: 8, prog: "A", k: 2 },
    { id: "B2", bars: 8, prog: "B", k: 2 },
    { id: "coda", bars: 4, prog: "coda", k: 0 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    const f = LAP[i];
    return { lap, i, f, off: bar, first: bar === 0, last: bar + CB >= f.bars, next: LAP[(i + 1) % LAP.length] };
  }

  // ---------- the tunes (Sim.phrasing notation: Note/beats + marks; ~ slur, ^n scoop, v vibrato, s swell) ----------
  const TUNE_A = [
    "D5/1 G5/1.5^1 A5/0.5~ B5/1v",
    "A5/1 F#5/1~ D5/2v",
    "E5/1 A5/1.5^1 B5/0.5~ C6/1v",
    "B5/1 A5/1~ F#5/2v",
    "G5/1 F#5/0.5~ E5/0.5~ D5/1 B4/1",
    "C5/1 D5/0.5~ E5/0.5~ G5/2v",
    "A5/1.5 G5/0.5~ E5/1 D5/1",
    "C5/1.5 B4/0.5~ A4/2v",
  ];
  const TUNE_B = [
    "G5/1.5 E5/0.5~ G5/1 B5/1^1",
    "A5/1.5 B5/0.5~ A5/1 F#5/1",
    "G5/1 D5/1~ B4/1~ D5/1",
    "E5/0.5 D5/2.5v r/1",
    "B4/1 E5/1 G5/1 F#5/1",
    "E5/1 D5/1~ B4/2v",
    "C5/1 E5/1 G5/1.5 A5/0.5",
    "A5/1.5 G5/0.5~ F#5/1 D5/1",
  ];
  const TUNNEL_BRASS = [
    "B4/1 E5/1.5 F#5/0.5~ G5/1v",
    "F#5/1 D5/1~ B4/2v",
    "r/4", "r/4",
    "A4/1 D5/1.5 E5/0.5~ G5/1v",
    "F#5/1 E5/1~ C5/2v",
    "D5/1 F#5/1.5 A5/0.5~ B5/1",
    "B5/1.5 A5/0.5~ G#5/2vs",
  ];
  const CODA_LEAD = ["C#5/1 B4/1~ A4/2v", "r/4", "r/4", "r/4"];
  const CODA_FLUTE = ["r/4", "r/4", "E6/1 D6/1~ C#6/2v", "r/4"];
  // the counter-line under the tune (half notes), written in G; Sim.dialogue.separate keeps it below the tune
  const COUNTER_A = [["B4", "A4"], ["F#4", "D4"], ["G4", "A4"], ["F#4", "A4"], ["G4", "E4"], ["E4", "G4"], ["C5", "A4"], ["G4", "F#4"]];
  const MARKS_8 = [{ from: 0, to: 16, dyn: "arch" }, { from: 16, to: 32, dyn: "arch" }];
  const MARKS_TUNNEL = [{ from: 0, to: 8, dyn: "arch" }, { from: 16, to: 24, dyn: "arch" }, { from: 24, to: 32, dyn: "<" }];

  // ranges for the dialogue router
  const RANGE = { lead: [55, 88], flute: [67, 96], brass: [52, 79] };
  const VOICE = {
    lead: { track: "lead", range: RANGE.lead, weight: 1.1 },
    flute: { track: "flute", range: RANGE.flute, gain: 0.92 },
  };
  // who keeps a hardware voice when all eight are busy (the lead is a wrapped synth through the chip's output
  // stage, budgeted at top priority; the kit is a sampled loop outside the budget)
  const PRIORITY = { lead: 7, flute: 6, brass: 6, bass: 5, bell: 4, pad: 3, pluck: 2 };

  /** Translate phrasing marks the chip voices can realize: a scoop becomes the voice's pitch envelope. */
  const chipPlay = (voice) => (t, e, d) => {
    if (e.scoop) e = { ...e, bend: { cents: -Math.min(4, e.scoop) * 100, time: 0.08 } };
    voice.play(t, e, d);
  };

  Sim.register({
    id: "branch-line",
    title: "Branch Line",
    genre: "Overworld, 16-bit",
    about: "A window seat on a slow country train, through an eight-voice sound chip at 106. The rails are the rhythm (a low thump, a swung pair of brushed clacks, a shaker), and a hand-written tune in G crosses the plains on a soft pulse lead, lifts to IV over the river on a flute with a water-pluck, goes dark in a tunnel of muted brass and echo, and comes out a whole step higher in A major with bells. Sim.phrasing, Sim.spc, Sim.dialogue and Sim.groove.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["explore", "hangout"], energy: 0.45,

    instruments(ctx) {
      const { I } = ctx;
      const chip = S.chip(ctx, {
        voices: VOICES, volume: -6, rate: 32000, bits: 8, crush: 0.35, tone: 7200,
        echo: { time: 0.144, feedback: 0.42, tone: 2500, level: -9 }, // 9 × 16 ms: a sixteenth at 106
      });
      // --- patch 1: the lead. A one-third-duty pulse loop with a soft resonant filter, phrased (slurs, small
      // scoops, late vibrato), sent into the chip's bus and echo so it shares the DAC with the chip voices ---
      const leadSyn = ctx.keep(new Tone.MonoSynth({
        oscillator: { type: "custom", partials: [1, 0.5, 0, 0.25, 0.2, 0, 0.14, 0.12, 0, 0.1] },
        filter: { type: "lowpass", rolloff: -12, Q: 1.1 },
        envelope: { attack: 0.012, decay: 0.15, sustain: 0.72, release: 0.14 },
        filterEnvelope: { attack: 0.01, decay: 0.22, sustain: 0.5, release: 0.14, baseFrequency: 700, octaves: 2 },
      }));
      const lead = P.wrap(ctx, leadSyn, {
        volume: -8, glide: 0.045, scoopTime: 0.07, release: 0.14, accentBright: 0.4,
        vibrato: { rate: 5.0, depth: 0.06, delay: 0.38, rise: 0.4, deepen: 1.2 },
      });
      const leadPan = ctx.keep(new Tone.Panner(0.08)).connect(chip.bus);
      lead.out.connect(leadPan);
      const leadEcho = ctx.keep(new Tone.Gain(0.45)).connect(chip.echo);
      leadPan.connect(leadEcho);
      // --- patch 2: the string section on the chip: three voices of a saw loop with a slow bow and a slow vibrato ---
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.35, pan: -0.18, volume: -5, wave: "saw", cutoff: 2100, attack: 0.32, decay: 0.6, sustain: 0.85, release: 0.35, vibrato: { rate: 4.4, depth: 0.03, delay: 0.5 } });
      // --- patch 3: the muted brass: the reed loop under a low filter with a little grit, nasal and small ---
      const brass = chip.voice("brass", { priority: PRIORITY.brass, echo: 0.3, pan: -0.3, volume: -5, cutoff: 1500, attack: 0.03, decay: 0.2, sustain: 0.65, grit: 7, gritWet: 0.2 });
      const flute = chip.voice("flute", { priority: PRIORITY.flute, echo: 0.5, pan: 0.18, volume: -1 });
      const pluck = chip.voice("pluck", { poly: 2, priority: PRIORITY.pluck, echo: 0.55, pan: 0.32, volume: -6 });
      const bell = chip.voice("bell", { poly: 2, priority: PRIORITY.bell, echo: 0.6, pan: 0.4, volume: -9 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.1, pan: 0, volume: -2, cutoff: 170, octaves: 2.2 });
      // the rails: the library kit (brushes, a shaker, a soft kick, a woodblock) played through the chip's lo-fi stage
      const kit = I.kit(ctx, { volume: -3, kickNote: 36, preload: ["softKick", "brushTap", "shaker", "woodblock", "brushSweep"] });
      const kitLp = ctx.keep(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 })).connect(chip.bus);
      const kp = I.place(ctx, kit, 0.05, kitLp);
      const kitEcho = ctx.keep(new Tone.Gain(0.12)).connect(chip.echo);
      kp.connect(kitEcho);
      const chipHum = { timing: 0.002, vel: 0.04 };
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d), humanize: { timing: 0.006, vel: 0.04 } },
        flute: { layer: "melody", play: chipPlay(flute), humanize: chipHum },
        brass: { layer: "melody", play: chipPlay(brass), humanize: chipHum },
        pad: { layer: "harmony", play: chipPlay(pad), humanize: chipHum },
        pluck: { layer: "texture", play: pluck.play, humanize: chipHum },
        bell: { layer: "texture", play: bell.play, humanize: chipHum },
        bass: { layer: "bass", play: bass.play, humanize: chipHum },
        drums: { layer: "drums", humanize: { timing: 0.005, vel: 0.1 }, play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep, pitch: e.pitch }) },
      };
    },

    compose({ cycle, rng: r, state }) {
      const L = locate(cycle);
      const { f, lap, off } = L;
      const plan = lap % 3;
      if (L.first || !state.plan || state.plan.key !== `${f.id}:${lap}`) state.plan = planSection(f, lap, plan, r.fork(11 + lap));
      const Pn = state.plan;
      if (state.bassLast == null) Object.assign(state, { bassLast: 43, padV: null, stolen: 0, dropped: 0 });
      const offB = off * BPB, endB = offB + CB * BPB;
      let ev = [];
      /** push by beat within the SECTION; events outside this cycle's window are dropped */
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - offB;
        if (abs < -1e-6 || abs >= CB * BPB - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---- the hand-written material for this cycle ----
      for (const n of D.toEvents(D.window(Pn.notes, offB, endB), { bpb: BPB, offset: offB })) {
        const { at, idx, voice, shift, entrance, phrase, handoff, join, ...e } = n;
        ev.push(e);
      }
      const sung = Pn.notes;
      const sungIn = (s0, s1) => sung.filter((n) => n.at < s1 - 1e-6 && n.at + n.dur > s0 + 1e-6).map((n) => n.note);
      // the pad sits under the tune; a brass counter-line may share its register (clear() keeps the rubs out)
      const melodyLow = (s0, s1) => { const m = sung.filter((n) => n.at < s1 - 1e-6 && n.at + n.dur > s0 + 1e-6 && !(Pn.counter && n.track === "brass")).map((n) => n.note); return m.length ? Math.min(...m) : 99; };
      const melodyIn = (s0, s1) => sungIn(s0, s1).length > 0;

      // ---- harmony ----
      const prog = Pn.prog;
      const chordAt = T.chordAtFactory(prog, BPB);
      const spans = prog.map((c) => ({ ...c, s: c.bar * BPB + c.beat })).filter((c) => c.s >= offB && c.s < endB);
      const harmony = spans.map((c) => ({ bar: c.bar - off, beat: c.beat, dur: c.dur, chord: c.chord }));
      const id = f.id;
      const plains = id === "A" || id === "A2" || id === "A3", river = id === "B" || id === "B2", tunnel = id === "tunnel";
      const high = f.k > 0; // the A-major half of the lap

      // ---- pad: the string section, one bow per chord, under whatever is being sung ----
      /** Drop (or lower) voicing tones a semitone / minor ninth from what is sung over them. */
      const clear = (v, over, lo) => {
        const rub = (m) => over.some((x) => mod12(Math.abs(x - m)) === 1 && Math.abs(x - m) <= 13);
        const out = [];
        for (let m of v) {
          if (rub(m) && m - 12 >= lo && !rub(m - 12) && !v.some((z) => Math.abs(z - (m - 12)) <= 2)) m -= 12;
          if (!rub(m) && !out.includes(m)) out.push(m);
        }
        return out.sort((a, b) => a - b);
      };
      /** No semitone pairs inside a voicing: lift the upper note an octave, else drop the lower one. */
      const tidy = (v, hi) => {
        for (let guard = 0; guard < 3; guard++) {
          const i = v.findIndex((m, k) => k > 0 && m - v[k - 1] === 1);
          if (i < 0) break;
          if (v[i] + 12 <= hi && !v.includes(v[i] + 12)) v[i] += 12; else v.splice(i - 1, 1);
          v.sort((a, b) => a - b);
        }
        return v;
      };
      // the strings play the plain chord (triads, plain sevenths); the colours belong to the tune and the bells
      const plain = (s) => s.replace(/maj7#11/, "maj7").replace(/add9|69/, "").replace(/maj9/, "maj7").replace(/m11|m9/, "m7").replace(/^([A-G][#b]?)6$/, "$1");
      {
        for (const c of spans) {
          if (id === "depart" && lap === 0 && c.bar < 2) continue; // the first departure: the pad enters in the third bar
          const cc = T.chord(plain(c.chord));
          const low = melodyLow(c.s, c.s + c.dur);
          const hi = Math.min(tunnel ? 66 : 71, low - 3), lo = tunnel ? 50 : 53;
          if (hi - lo < 7) continue;
          const n = tunnel ? 2 : 3;
          let v = T.voice(cc, { lo, hi, n, prev: state.padV, rng: r, rootless: tunnel, omitBass: true, spread: "close", top: [hi - 7, hi] });
          v = clear(tidy(v, hi), sungIn(c.s, c.s + c.dur), lo);
          if (v.length < 2) continue;
          state.padV = v;
          const vel = tunnel ? 0.36 : river ? 0.4 : id === "depart" || id === "coda" ? 0.38 : high ? 0.47 : 0.43;
          // in the plains the bow is re-taken on beat 3 of long chords now and then; the river holds
          if (plains && c.dur >= 4 && r.chance(0.3)) { push("pad", c.s, 1.85, v, vel); push("pad", c.s + 2, c.dur - 2.25, v, vel * 0.9); }
          else push("pad", c.s, c.dur - 0.25, v, vel);
        }
      }

      // ---- bass: a two-feel that never hurries ----
      const bassRoot = (b) => T.nearest(state.bassLast, [T.chord(chordAt(b).chord).bass], 36, 50);
      spans.forEach((c, i) => {
        const cc = T.chord(c.chord);
        const root = (state.bassLast = bassRoot(c.s));
        const fifth = T.nearest(root + 7, [mod12(cc.root + 7)], 38, 52);
        let nextSym;
        if (i + 1 < spans.length) nextSym = spans[i + 1].chord;
        else { const own = prog.find((x) => x.bar * BPB + x.beat === c.s + c.dur); nextSym = own ? own.chord : tr(PROG[L.next.prog], L.next.k).split("|").map((s) => s.trim()).filter(Boolean)[0].split(/\s+/)[0].split(":")[0]; }
        const nextRoot = T.nearest(root, [T.chord(nextSym).bass], 36, 50);
        const nextScale = T.chord(nextSym).scale;
        /** A step of the coming chord's scale into its root, unless that note rubs a tone of the chord still sounding. */
        const approach = () => {
          if (nextRoot === root) return fifth;
          const a = T.step(nextRoot, nextRoot > root ? -1 : 1, nextScale);
          return cc.pcs.some((pc) => [1, 11].includes(mod12(a - pc))) ? fifth : a;
        };
        if (id === "depart") { if (c.bar >= 1 || lap > 0) { push("bass", c.s, 1.7, root, 0.7); push("bass", c.s + 2, 1.4, root, 0.6); } return; }
        if (tunnel) { // a pedal on E through the dark, the roots only when the harmony pivots
          const ped = c.bar < 6;
          push("bass", c.s, Math.min(1.6, c.dur - 0.4), ped ? 40 : root, 0.7);
          if (c.dur >= 4) push("bass", c.s + 2, 1.4, ped ? 40 : root, 0.6);
          if (c.bar === 7 && c.beat > 0) push("bass", c.s + 1.5, 0.45, nextRoot > root ? nextRoot - 1 : nextRoot + 1, 0.6); // the leading tone into A
          return;
        }
        if (c.dur < 4) { push("bass", c.s, c.dur - 0.3, root, 0.7); return; }
        const v = 0.74;
        if (river) { // long roots; the octave on the and of two in the even bars
          push("bass", c.s, 3.4, root, v);
          if (c.bar % 2 === 1 && r.chance(0.6)) push("bass", c.s + 2.5, 0.6, root + 12 <= 52 ? root + 12 : fifth, 0.5);
          return;
        }
        const cell = r.weighted([["two", 3], ["fifth", 2], ["hold", 1.2], ["walk", id === "coda" ? 2 : 0.9]]);
        if (cell === "hold") push("bass", c.s, 3.5, root, v);
        else if (cell === "two") { push("bass", c.s, 1.7, root, v); push("bass", c.s + 2, 1.5, root, 0.62); }
        else if (cell === "fifth") { push("bass", c.s, 1.7, root, v); push("bass", c.s + 2, 1.2, fifth, 0.6); }
        else { push("bass", c.s, 1.7, root, v); push("bass", c.s + 2, 0.9, fifth, 0.58); push("bass", c.s + 3, 0.9, approach(), 0.6); }
        if (cell !== "walk" && nextRoot !== root && r.chance(0.35)) push("bass", c.s + 3.5, 0.45, approach(), 0.52);
      });

      // ---- pluck: water over the river, the fragment in the depart, answers in the even bars after the tunnel ----
      const arpBar = (bar, o = {}) => {
        const B = bar * BPB, tones0 = (b) => T.notesIn(T.chord(chordAt(b).chord).pcs, o.lo ?? 60, o.hi ?? 76);
        for (let s = 0; s < 8; s++) {
          if (o.off && s % 2 === 0) continue;
          const b = B + s * 0.5, tones = tones0(b), L2 = tones.length;
          const k = o.bounce ? (s % (2 * L2 - 2) < L2 ? s % (2 * L2 - 2) : 2 * L2 - 2 - (s % (2 * L2 - 2))) : s % L2;
          const seq = o.down ? tones.slice().reverse() : tones;
          const m = seq[k];
          if (sungIn(b, b + 0.5).some((x) => Math.abs(x - m) % 12 === 1)) continue; // never a semitone against the tune
          push("pluck", b, 0.4, m, (o.vel ?? 0.42) * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.86 : 0.74));
        }
      };
      if (id === "depart") {
        const k = 0, hd = [[2 * BPB + 2.5, 74], [2 * BPB + 3, 79], [3 * BPB + 2, 74], [3 * BPB + 2.5, 79], [3 * BPB + 3, 81], [3 * BPB + 3.5, 83]];
        hd.forEach(([b, m], i) => push("pluck", b, 0.45, m + k, 0.4 + 0.02 * i));
      } else if (river) {
        for (let bar = off; bar < off + CB; bar++) arpBar(bar, { off: Pn.pluck === "off", down: bar % 2 === 1, bounce: Pn.pluck === "bounce", vel: (high ? 0.42 : 0.38) * (Pn.pluck === "bounce" ? 0.85 : 1), lo: high ? 62 : 60, hi: high ? 78 : 76 });
      } else if (id === "A3" && Pn.pluck !== "none") {
        for (let bar = off; bar < off + CB; bar++) if (bar % 2 === 1) arpBar(bar, { off: true, down: true, vel: 0.36, lo: 62, hi: 78 });
      }

      // ---- bells: the downbeats after the tunnel, the station bell in the coda, the signal at a new lap ----
      const bellOn = (b, pcs, target, vel) => push("bell", b, 1.2, T.nearest(target, pcs, 83, 96), vel);
      if (id === "A3" || id === "B2") {
        for (const c of spans) {
          if (c.dur < 4) continue;
          const cc = T.chord(c.chord);
          const even = c.bar % 2 === 0;
          if (id === "A3" ? even : c.bar % 4 === 0) bellOn(c.s, [mod12(cc.root + 7), cc.root], 88, 0.4);
          else if (id === "A3" && Pn.bells && r.chance(0.5)) bellOn(c.s + 2, [cc.guide[0]], 86, 0.3);
        }
      } else if (id === "coda") {
        if (off === 0) { push("bell", BPB, 2, 88, 0.42); push("bell", BPB + 1, 2, 85, 0.34); }
      } else if (id === "depart" && lap > 0 && off === 0) push("bell", 0, 2, 86, 0.36);

      // ---- the rails ----
      const level = id === "depart" ? 0 : tunnel ? -1 : id === "A" || id === "coda" ? 1 : river && !high ? 1 : 2;
      for (let b = 0; b < CB; b++) {
        const bar = off + b, B = bar * BPB;
        const last = L.last && b === CB - 1;
        const fill = last && (id === "A2" || id === "B" || id === "B2") && r.chance(0.6);
        const arrive = bar === 0 && (id === "A3" || id === "B" || id === "A");
        if (arrive) push("drums", B, 0.1, "brushSweep", id === "A3" ? 0.3 : 0.22, { sweep: 0.6 });
        if (id === "depart" && lap === 0) {
          // the train pulls out: clacks alone, then the thump, then the shaker (later laps keep rolling)
          if (bar >= 0) { push("drums", B + 1.5, 0.1, "brushTap", 0.2); push("drums", B + 1.75, 0.1, "brushTap", 0.26); push("drums", B + 3.5, 0.1, "brushTap", 0.2); push("drums", B + 3.75, 0.1, "brushTap", 0.26); }
          if (bar >= 1) { push("drums", B, 0.1, "softKick", 0.3); push("drums", B + 2, 0.1, "softKick", 0.26); }
          if (bar >= 2) for (let e = 0; e < 8; e++) push("drums", B + e * 0.5, 0.1, "shaker", e % 2 ? 0.22 : 0.15);
          if (bar === 3) push("drums", B + 3.75, 0.1, "woodblock", 0.22, { pitch: 79 });
          continue;
        }
        if (tunnel) {
          // in the dark only the thump and the rail joints are heard; the brushes come back with the light
          push("drums", B, 0.1, "softKick", 0.32); push("drums", B + 2, 0.1, "softKick", 0.26);
          push("drums", B + 1.75, 0.1, "woodblock", 0.2, { pitch: 77 }); push("drums", B + 3.75, 0.1, "woodblock", 0.22, { pitch: 77 });
          if (bar >= 6) { push("drums", B + 1.5, 0.1, "brushTap", 0.14 + 0.04 * (bar - 6)); push("drums", B + 3.5, 0.1, "brushTap", 0.16 + 0.04 * (bar - 6)); }
          if (bar === 7) [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75].forEach((p, k) => push("drums", B + p, 0.1, "brushTap", 0.14 + 0.03 * k));
          continue;
        }
        // the thump on one and three
        push("drums", B, 0.1, "softKick", level >= 2 ? 0.34 : 0.3);
        push("drums", B + 2, 0.1, "softKick", level >= 2 ? 0.3 : 0.26);
        if (fill) {
          [1.5, 1.75].forEach((p) => push("drums", B + p, 0.1, "brushTap", 0.24));
          [2.5, 2.75, 3, 3.25, 3.5, 3.75].forEach((p, k) => push("drums", B + p, 0.1, "brushTap", 0.16 + 0.03 * k));
          for (let e = 0; e < 5; e++) push("drums", B + e * 0.5, 0.1, "shaker", e % 2 ? 0.24 : 0.16);
          continue;
        }
        // the clack pairs leading into each thump
        [[1.5, 0.2], [1.75, 0.27], [3.5, 0.2], [3.75, 0.28]].forEach(([p, v]) => push("drums", B + p, 0.1, "brushTap", v + (level >= 2 ? 0.03 : 0)));
        // the shaker rides the eighths, offbeats a little louder; the river takes it down a notch
        for (let e = 0; e < 8; e++) push("drums", B + e * 0.5, 0.1, "shaker", (e % 2 ? 0.25 : 0.16) * (river ? 0.8 : 1));
        if (level >= 2 && r.chance(0.3)) push("drums", B + r.pick([0.75, 2.75]), 0.1, "brushTap", 0.16, { ghost: true });
        if (bar % 2 === 1) push("drums", B + 3.75, 0.1, "woodblock", 0.2, { pitch: 79 }); // the rail joint
        if (level >= 2 && bar % 4 === 3 && r.chance(0.4)) push("drums", B + 1, 0.1, "brushSweep", 0.14, { sweep: 0.4 });
      }

      // ---- the chip, then the feel ----
      const forBudget = ev.map((e) => (e.track === "lead" ? { ...e, dur: Math.max(0.05, e.dur - 0.06) } : e));
      const bud = S.budget(forBudget.filter((e) => e.track !== "drums"), { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      const leadEvents = ev.filter((e) => e.track === "lead"), drumEvents = ev.filter((e) => e.track === "drums");
      ev = bud.events.filter((e) => e.track !== "lead").concat(leadEvents, drumEvents);
      ev = G.ghosts(ev, { track: "drums", vel: 0.14, dur: 0.08 });
      ev = G.apply(ev, {
        bpm: BPM, bpb: BPB, cycle,
        tracks: {
          drums: { voices: { softKick: "straight", brushTap: { template: "mpc58", late: 7 }, shaker: { template: "mpc58", late: -3 }, woodblock: { template: "mpc58", late: 4 }, brushSweep: "straight" } },
          bass: { template: "mpc58", late: 3, amount: 0.8 },
          pluck: { template: "mpc58", late: 0 },
          pad: { template: "straight", late: 14, vels: false },
          bell: { template: "straight", late: 10, vels: false },
          brass: { template: "straight", late: 6, vels: false },
          flute: { template: "straight", late: 4, vels: false },
          lead: { template: "straight", late: Pn.rubato ? 0 : 5, vels: false },
        },
      });
      if (Pn.rubato) ev = G.rubato(ev, { track: Pn.rubato, bpm: BPM, bpb: BPB, amount: river ? 0.5 : 0.4, linger: "high", lingerMs: 40, leapMs: 12, rng: r, legato: true });
      if (tunnel && L.last) ev = G.crescendo(ev, { tracks: ["drums", "pad"], from: 12, to: 16, v0: 0.85, v1: 1.15, bpb: BPB, curve: 1.3 });

      const part = f.bars > CB ? ` (${off / CB + 1}/${f.bars / CB})` : "";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${Pn.label}${part}`, state };
    },
  });

  // ---------- everything hand-written for one section of one lap, routed to tracks ----------
  function planSection(f, lap, plan, r) {
    const prog = T.progression(tr(PROG[f.prog], f.k), BPB);
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.max(0, Math.min(b, f.bars * BPB - 0.01))).chord).scale;
    const key = `${f.id}:${lap}`;
    const id = f.id;
    let notes = [], label = "", rubato = null, pluck = "off", bells = false, counter = false;
    /** A notated line, transposed, shaped and articulated; returned as dialogue notes (at, dur, note, ...). */
    const raw = (bars, track, o = {}) => {
      const line = P.line(bars, { beatsPerBar: BPB, track, vel: 0.7 });
      line.forEach((e) => {
        e.note += f.k + (o.up || 0);
        e.vel = (o.vel ?? 0.7) + (e.note - 79) / 130 + (e.dur >= 2 ? 0.04 : 0) + r.gauss(0.01);
      });
      return line;
    };
    const sing = (bars, marks, track, o = {}) => {
      const out = P.articulate(raw(bars, track, o), marks, { beatsPerBar: BPB, scale: scaleAt, lengthen: 1.06, breathLate: 0.03, breathGap: 0.15, overlap: 0.04 });
      return D.norm(out, BPB);
    };
    const voices = (...names) => names.map((n) => VOICE[n]);
    const handoff = (line, o = {}) => D.distribute(line, { voices: voices("lead", "flute"), mode: "handoff", bpb: BPB, rng: r, handoffDur: 1.5, minNotes: 3, stay: 0.3, join: o.join || "extend", overlap: 0.2 });
    const byPhrase = (line, order) => D.distribute(line, { voices: voices("lead", "flute"), mode: "phrase", bpb: BPB, order, rng: r, phrases: [[0, 8], [8, 16], [16, 24], [24, 32]] });
    const counterLine = (tune) => {
      counter = true;
      const cnt = COUNTER_A.flatMap(([a, b], bar) => [{ at: bar * BPB, dur: 1.9, note: T.midi(a) + f.k, vel: 0.4 }, { at: bar * BPB + 2, dur: 1.9, note: T.midi(b) + f.k, vel: 0.36 }]);
      return D.separate(tune, cnt, { range: RANGE.brass, prefer: "below", min: 3, bpb: BPB }).map((n) => ({ ...n, track: "brass" }));
    };

    if (id === "depart") {
      label = lap === 0 ? "departure · the rails, the pluck tries the head" : "the next valley · back in G";
    } else if (id === "A") {
      const tune = sing(TUNE_A, MARKS_8, "lead");
      if (plan === 0) { notes = tune; rubato = "lead"; label = "the plains · the tune on the lead"; }
      else if (plan === 1) { notes = tune.map((n) => ({ ...n, track: "flute", vel: n.vel * 0.92 })); rubato = "flute"; label = "the plains · the tune on the flute"; }
      else { notes = byPhrase(tune, ["lead", "lead", "flute", "lead"]); label = "the plains · a phrase each"; }
    } else if (id === "A2") {
      const tune = sing(TUNE_A, MARKS_8, plan === 1 ? "lead" : "flute", { vel: 0.66 });
      if (plan === 0) { notes = handoff(tune); label = "the plains · the tune changes hands on its long notes"; }
      else if (plan === 1) { notes = tune.concat(counterLine(tune)); rubato = "lead"; label = "the plains · lead, the muted brass under it"; }
      else { notes = handoff(tune, { join: "double" }).concat(counterLine(tune)); label = "the plains · handed off, doubled at the joins, brass counter"; }
    } else if (id === "B") {
      const tune = sing(TUNE_B, MARKS_8, "flute");
      pluck = plan === 2 ? "bounce" : "off";
      if (plan === 0) { notes = tune; rubato = "flute"; label = "the river · flute, the water-pluck"; }
      else if (plan === 1) { notes = handoff(tune); label = "the river · flute and lead, handed off"; }
      else { notes = tune.map((n) => ({ ...n, track: "lead" })); rubato = "lead"; label = "the river · the lead takes the river"; }
    } else if (id === "tunnel") {
      const plainCall = D.norm(raw(TUNNEL_BRASS, "brass", { vel: 0.62 }), BPB);
      notes = sing(TUNNEL_BRASS, MARKS_TUNNEL, "brass", { vel: 0.62 });
      // the lead answers the first call across the echo, inverted, while the brass rests (bars 3-4); the answer
      // is derived from the un-articulated call so it starts on the grid
      const who = plan === 1 ? "flute" : "lead";
      const ans = D.respond(plainCall, { track: who, bpb: BPB, minGap: 2, end: 16, gap: 0.5, breath: 0.5, transform: plan === 2 ? [{ invert: true }, { steps: 1 }] : [{ invert: true }], scaleAt, range: who === "flute" ? [69, 91] : [62, 86], vel: 0.56 });
      notes = notes.concat(ans.map((n) => ({ ...n, vel: Math.min(0.6, n.vel ?? 0.56) })));
      label = `the tunnel · muted brass, the ${who} answers in the echo · E minor pivots`;
    } else if (id === "A3") {
      const tune = sing(TUNE_A, MARKS_8, "lead", { vel: 0.74 });
      bells = true;
      if (plan === 0) { notes = handoff(tune, { join: "double" }); pluck = "on"; label = "out of the tunnel · A major · lead and flute, bells"; }
      else if (plan === 1) { notes = byPhrase(tune, ["flute", "lead", "flute", "lead"]); pluck = "none"; label = "out of the tunnel · A major · a phrase each, bells"; }
      else { notes = tune.concat(counterLine(tune)); rubato = "lead"; pluck = "on"; label = "out of the tunnel · A major · lead, brass counter, bells"; }
    } else if (id === "B2") {
      const tune = sing(TUNE_B, MARKS_8, "flute", { vel: 0.72 });
      pluck = plan === 1 ? "bounce" : "off";
      if (plan === 1) { notes = tune.map((n) => ({ ...n, track: "lead" })); rubato = "lead"; label = "the river again, higher · the lead"; }
      else { notes = handoff(tune); label = "the river again, higher · flute and lead"; }
    } else if (id === "coda") {
      notes = sing(CODA_LEAD, [{ from: 0, to: 4, dyn: ">" }], "lead").concat(sing(CODA_FLUTE, [{ from: 8, to: 12, dyn: ">" }], "flute", { vel: 0.6 }));
      label = "between stations · the tail, a bell, D7 turns the train home";
    }
    notes = notes.map((n) => (n.track ? n : { ...n, track: "lead" })).sort((a, b) => a.at - b.at);
    return { key, prog, notes, label, rubato, pluck, bells, counter };
  }
})();
