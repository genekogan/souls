// Home Movies: tape nostalgia for a 1970s educational film about how a city works, found in a box.
// D major that will not quite say so: maj7 chords with no third (Dmaj7sus2), slow I–iii oscillations,
// the minor iv (Gm6) under a childlike music-box tune, i–bVI in the relative minor for the "aerial footage".
// Form: one "film" is 16 cycles of 8 bars (about 5½ minutes) in three reels:
//   Reel 1 (D)   leader tape -> title card (music box alone) -> drums in -> aerial view (detuned lead)
//                -> the tune an octave down on the lead with the box answering -> run-out (tune at half speed)
//   Reel 2       the tape drags and the memory drops a major third, to Bb (pivot: the held common tone).
//                The tune again, then a lament over a falling bass with the tune inverted on the lead,
//                the head motif sequenced, a worn copy. Every second film sinks a further third, to Gb.
//   Reel 3 (D)   back home (via the common tone D); the tune doubled in octaves, a bridge with a bVI
//                flash, a minor-tonic flicker as the film wears thin, the head motif at half speed, silence.
// Texture: everything melodic is "printed" to a tape bus: a pitch-drag delay, flutter and wow (two
// vibratos whose rate and depth are themselves wandering LFOs), a tape-head lowpass and a little
// saturation. Drums are a separate lo-fi chain: lowpassed, partly bit-crushed, saturated. A pink
// hiss bed breathes per section; occasional tape dropouts dip the level and dull the highs.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4, CYCLE = 8, CB = CYCLE * BPB;

  // ---------- harmony, written in D (transposed per reel) ----------
  const PROGS = {
    leader: "| Dmaj7sus2 | % | F#m7 | % | Dmaj7sus2 | % | F#m7 | % |",
    runout: "| Dmaj7sus2 | % | F#m7 | % | Dmaj7sus2 | % | Dadd9 | % |",           // the third arrives, then the drop
    theme: "| Dmaj7sus2 | F#m7 | Dmaj7sus2 | F#m7 | Gmaj9 | Gm6 | F#m7 | A9sus4 |",
    themeB: "| Dmaj7sus2 | F#m7 | Dmadd9 | Bbmaj7 | Gmaj9 | Gm6 | F#m7 | Em9 A9sus4 |", // minor flicker, bVI
    bridge: "| Bm9 | % | Gmaj7 | % | Bm9 | % | Gmaj9 | A9sus4 |",                    // i–bVI in B minor
    bridgeB: "| Bm9 | % | Gmaj7 | % | Bm9 | Em9 | Bbmaj7 | A9sus4 |",                 // with the bVI flash
    lament: "| Bmadd9 | Bm/A | Gmaj7#11 | Em9 | Bmadd9 | Bm/A | Gmaj9 | A9sus4 |",  // falling bass B A G E
  };

  // ---------- the tune (music box, in D): [beat, dur, midi] ----------
  // a: ti-sol-re | mi-sol    a': ti-sol-la-ti | re'-ti-sol    b: la-sol-mi-do | (minor iv) re-fa-le    c: sol-mi | la-sol-re
  const TUNE = [
    [0, 1, 85], [1, 1, 81], [2, 2, 76],
    [5, 1, 78], [6, 2, 81],
    [8, 1, 85], [9, 0.5, 81], [9.5, 0.5, 83], [10, 2, 85],
    [12, 1.5, 88], [13.5, 0.5, 85], [14, 2, 81],
    [16, 1.5, 83], [17.5, 0.5, 81], [18, 1, 78], [19, 1, 74],
    [20, 1, 76], [21, 1, 79], [22, 2, 82],
    [24, 2.5, 81], [26.5, 1.5, 78],
    [28, 1, 83], [29, 1, 81], [30, 2, 76],
  ].map(([beat, dur, note]) => ({ beat, dur, note }));
  // Second verse: same antecedent, a new consequent that sinks to the sus4 instead of echoing the opening.
  const TUNE_B = TUNE.filter((n) => n.beat < 16).concat([
    [16, 1, 86], [17, 1, 83], [18, 2, 81],
    [20, 1.5, 82], [21.5, 0.5, 81], [22, 2, 79],
    [24, 1, 78], [25, 1, 76], [26, 2, 73],
    [28.5, 1.5, 76], [30, 2, 74],
  ].map(([beat, dur, note]) => ({ beat, dur, note })));
  // Lead counter-line for the aerial view (bridge): long sighs, one octave under the box.
  const COUNTER = [
    [0.5, 2.5, 74], [3, 1, 73], [4, 2, 71], [6, 1, 69], [7, 1, 66],
    [8.5, 2.5, 71], [11, 1, 74], [12, 3, 78], [15, 1, 76],
    [16.5, 2.5, 74], [19, 1, 73], [20, 1.5, 71], [21.5, 0.5, 73], [22, 2, 69],
    [24.5, 1.5, 69], [26, 2, 71], [28, 3, 76], [31, 1, 74],
  ].map(([beat, dur, note]) => ({ beat, dur, note }));
  // bridgeB has Em9 in bar 6 and Bbmaj7 in bar 7: its own ending (the bVI catches the line on its 3rd).
  const COUNTER_B = COUNTER.slice(0, 11).concat([
    [20, 1.5, 71], [21.5, 0.5, 73], [22, 2, 67],
    [24.5, 1.5, 69], [26, 2, 74], [28, 3, 76], [31, 1, 74],
  ].map(([beat, dur, note]) => ({ beat, dur, note })));

  // ---------- the film: 16 cycles ----------
  // drums: none | full | half | thin. box/lead name a treatment of the tune (see compose).
  const PLAN = [
    { prog: "leader", key: 0, drums: "none", box: "glints", arp: 1, bass: "none", hiss: 1, label: "Reel 1 · leader tape" },
    { prog: "theme", key: 0, drums: "none", box: "tune", bass: "long", hiss: 0.85, label: "Reel 1 · title card" },
    { prog: "theme", key: 0, drums: "full", box: "tune", tune: "B", bass: "groove", hiss: 0.6, label: "Reel 1 · how the city wakes" },
    { prog: "bridge", key: 0, drums: "full", lead: "counter", box: "glints", arp: 1, bass: "groove", hiss: 0.6, label: "Reel 1 · aerial view" },
    { prog: "theme", key: 0, drums: "full", lead: "low", box: "answers", bass: "groove", hiss: 0.6, label: "Reel 1 · the narrator, lower" },
    { prog: "runout", key: 0, drums: "none", box: "augment", bass: "long", hiss: 0.9, label: "Reel 1 · run-out" },
    { prog: "theme", key: -4, drums: "none", box: "tune", bass: "long", hiss: 0.85, label: "Reel 2 · B♭ · another summer" },
    { prog: "lament", key: -4, drums: "half", lead: "invert", box: "glints", bass: "half", hiss: 0.7, label: "Reel 2 · B♭ · the long afternoon" },
    { prog: "lament", key: -4, drums: "full", box: "fragment", arp: 1, bass: "groove", hiss: 0.6, label: "Reel 2 · B♭ · traffic, from above" },
    { prog: "theme", key: -4, drums: "full", lead: "low", box: "worn", bass: "groove", hiss: 0.65, label: "Reel 2 · B♭ · the tune, worn" },
    { prog: "runout", key: -4, drums: "none", box: "augment", bass: "long", hiss: 0.95, label: "Reel 2 · B♭ · fading" },
    { prog: "theme", key: 0, drums: "none", box: "tune", bass: "long", hiss: 0.8, label: "Reel 3 · home again" },
    { prog: "theme", key: 0, drums: "full", lead: "double", box: "tune", tune: "B", bass: "groove", hiss: 0.55, label: "Reel 3 · the tune, doubled" },
    { prog: "bridgeB", key: 0, drums: "full", lead: "counter", box: "glints", arp: 1, bass: "groove", hiss: 0.6, label: "Reel 3 · aerial view, B♭ flash" },
    { prog: "themeB", key: 0, drums: "thin", box: "worn", bass: "thin", hiss: 0.75, label: "Reel 3 · the film wears thin" },
    { prog: "leader", key: 0, drums: "none", box: "headSlow", bass: "long", hiss: 1, label: "Reel 3 · end of reel" },
  ];
  /** Plan entry for a cycle: the first film plays all 16; later films skip the leader. Every second film
   *  (film 2, 4, ...) sinks a second major third, Bb -> Gb, and Gb -> D is then a third drop that lands home. */
  function planAt(cycle) {
    const film = cycle < 16 ? 0 : 1 + Math.floor((cycle - 16) / 15);
    const idx = cycle < 16 ? cycle : 1 + ((cycle - 16) % 15);
    const p = { ...PLAN[idx], idx, film };
    if (film % 2 === 1) {
      if (idx === 9 || idx === 10) { p.key = -8; p.label = p.label.replace("B♭", "G♭"); }
      if (idx === 3) { p.prog = "bridgeB"; p.label += ", B♭ flash"; }
    }
    if (film > 0 && idx === 12) { p.lead = film % 2 ? "counterTune" : "double"; }
    return p;
  }

  // ---------- helpers ----------
  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  const PROG_CACHE = {};
  function progIn(name, k) {
    const key = name + k;
    if (!PROG_CACHE[key]) PROG_CACHE[key] = T.progression(PROGS[name]).map((h) => ({ ...h, chord: tsym(h.chord, k) }));
    return PROG_CACHE[key];
  }
  /** Register shift for the box in a key: stay high (Gb goes up a third rather than down a sixth). */
  const boxShift = (k) => (k === -8 ? 4 : k);
  const isStrong = (n) => Math.abs(n.beat % 2) < 1e-6 || n.dur >= 1.5;
  /**
   * Weak-beat pitch set: the chord scale, kept inside the reel's key (D, Bb or Gb major) except for the
   * chord's own tones (so Gm6 lends its Bb but not its C), without avoid notes (a semitone above a chord tone).
   */
  function weakSet(sym, keyPcs) {
    const c = T.chord(sym);
    return c.scale.filter((p) => c.pcs.includes(p) || (keyPcs.includes(p) && !c.pcs.includes(mod12(p - 1))));
  }
  /**
   * Fit a line to (new) harmony: strong notes to chord tones, weak notes to the chord scale minus
   * avoid notes, keeping the contour (direction of motion) and penalising leaps over a fifth.
   */
  function refit(notes, symAt, lo, hi, keyPcs) {
    const out = [];
    let prevIn = null, prevOut = null;
    for (const n of notes) {
      const sym = symAt(n.beat), c = T.chord(sym);
      const pool = isStrong(n) ? c.pcs : weakSet(sym, keyPcs);
      let note = n.note;
      const dirWanted = prevIn == null ? 0 : Math.sign(n.note - prevIn);
      const fits = pool.includes(mod12(note)) && note >= lo && note <= hi;
      const dirOk = (m) => prevOut == null || dirWanted === 0 || Math.sign(m - prevOut) === dirWanted;
      if (!fits || !dirOk(note)) {
        let best = null, bs = Infinity;
        for (const m of T.notesIn(pool, lo, hi)) {
          let s = Math.abs(m - n.note);
          if (prevOut != null) {
            const leap = Math.abs(m - prevOut);
            if (leap > 7) s += (leap - 7) * 1.2;
            if (leap === 6) s += 2;
            if (!dirOk(m)) s += 2.5;
            if (m === prevOut && dirWanted !== 0) s += 1.5;
          }
          if (s < bs) { bs = s; best = m; }
        }
        note = best ?? note;
      }
      out.push({ ...n, note });
      prevIn = n.note; prevOut = note;
    }
    return out;
  }
  /** No adjacent semitones, no seconds or minor thirds below A3, nothing below E3, no doubled pitch. */
  const clean = (v) => v[0] >= 52 && v.every((m, i) => i === 0 || (m - v[i - 1] >= 2 && (v[i - 1] >= 57 || m - v[i - 1] >= 4)));
  /** Chord tones by priority (guide tones, colours, fifth, root); a slash chord's bass is left to the bass. */
  function tonesFor(sym) {
    const c = T.chord(sym);
    const fifth = c.intervals.find((i) => i === 6 || i === 7 || i === 8);
    const pri = [...new Set([...c.guide, ...c.colors, ...(fifth != null ? [mod12(c.root + fifth)] : []), c.root])];
    return c.bass !== c.root ? pri.filter((p) => p !== c.bass) : pri;
  }
  /** Enumerate every placement of the chord's top 4 (or 3) tones in [lo, hi]; keep the smoothest clean one. */
  function cleanVoice(sym, prev, { lo, hi, top, maxSpan = 24 }) {
    const pri = tonesFor(sym);
    let best = null, bs = Infinity;
    const four = pri.slice(0, 4), sets = [four];
    if (four.length >= 3) four.forEach((_, i) => sets.push(four.filter((__, j) => j !== i)));
    for (const set of sets) {
      const opts = set.map((pc) => T.notesIn([pc], lo, hi));
      const walk = (i, acc) => {
        if (i === set.length) {
          const v = acc.slice().sort((x, y) => x - y);
          if (!clean(v) || v[v.length - 1] - v[0] > maxSpan) return;
          let sc = set.length < Math.min(4, pri.length) ? 2.5 : 0;
          const span = v[v.length - 1] - v[0];
          if (span > 21) sc += span - 21;
          if (span < 9) sc += (9 - span) * 0.5;
          if (prev && prev.length) {
            const m = Math.min(v.length, prev.length);
            for (let j = 0; j < m; j++) sc += Math.abs(v[v.length - 1 - j] - prev[prev.length - 1 - j]);
          } else sc += Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2);
          const t = v[v.length - 1];
          if (t < top[0]) sc += (top[0] - t) * 1.5;
          if (t > top[1]) sc += (t - top[1]) * 1.5;
          if (sc < bs) { bs = sc; best = v; }
          return;
        }
        for (const m of opts[i]) { acc.push(m); walk(i + 1, acc); acc.pop(); }
      };
      walk(0, []);
    }
    return best || T.voice(sym, { lo, hi, n: 4, prev, top });
  }
  const shift = (notes, k) => notes.map((n) => ({ ...n, note: n.note + k }));
  /** Lead phrasing: tie each note to the next onset (legato), up to `max` beats, leaving a breath. */
  function legato(notes, max = 3) {
    return notes.map((n, i) => {
      const next = notes[i + 1];
      const gap = next ? next.beat - n.beat : n.dur;
      return { ...n, dur: Math.min(max, Math.max(n.dur, gap - 0.08)) };
    });
  }

  // ---------- drums & bass grooves: [beat, vel] / [beat, dur, role] ----------
  const GROOVES = [
    { kick: [[0, 0.86], [2.5, 0.7]], bass: [[0, 2.3, "R"], [2.5, 1.3, "R"]] },
    { kick: [[0, 0.86], [1.5, 0.5], [2.5, 0.72]], bass: [[0, 1.35, "R"], [1.5, 0.9, "R"], [2.5, 1.3, "R"]] },
    { kick: [[0, 0.86], [2, 0.5], [2.5, 0.68]], bass: [[0, 1.85, "R"], [2, 0.4, "O"], [2.5, 1.3, "F"]] },
    { kick: [[0, 0.86], [0.5, 0.42], [2.5, 0.7]], bass: [[0, 0.4, "R"], [0.5, 1.8, "R"], [2.5, 1.3, "R"]] },
  ];
  const LOOPS = [[0, 1], [0, 2], [3, 1], [0, 0, 0, 2], [3, 0, 1, 2]];

  Sim.register({
    id: "home-movies",
    title: "Home Movies",
    genre: "Tape nostalgia",
    about: "Hauntological electronica in D: thirdless maj7 chords and slow I–iii oscillations on wobbling tape, a childlike music-box tune that keeps returning altered (inverted, at half speed, worn), dusty lo-fi drums that come and go, and a memory that drops a major third and finds its way home.",
    bpm: 90, beatsPerBar: BPB, swing: 0.57, swingUnit: 0.5, cycleBars: CYCLE, gainDb: -3.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const K = (n) => ctx.keep(n);
      const db = (x) => Math.pow(10, x / 20);

      // ---- the tape: drag delay -> flutter -> wow -> head lowpass -> saturation -> dropout gain ----
      const dropGain = K(new Tone.Gain(1)).connect(out);
      const tapeHP = K(new Tone.Filter({ frequency: 30, type: "highpass" })).connect(dropGain);
      const sat = K(new Tone.Distortion({ distortion: 0.08, oversample: "2x", wet: 0.22 })).connect(tapeHP);
      const head = K(new Tone.Filter({ frequency: 6200, type: "lowpass", rolloff: -12, Q: 0.5 })).connect(sat);
      const wow = K(new Tone.Vibrato({ frequency: 0.55, depth: 0.45, maxDelay: 0.005, type: "sine" })).connect(head);
      // irregular wow: its rate and depth wander on slow, incommensurate LFOs (about 2-14 cents)
      K(new Tone.LFO({ frequency: 0.031, min: 0.3, max: 0.8 }).start()).connect(wow.frequency);
      K(new Tone.LFO({ frequency: 0.019, min: 0.25, max: 0.65, phase: 90 }).start()).connect(wow.depth);
      const flutter = K(new Tone.Vibrato({ frequency: 6.1, depth: 0.016, maxDelay: 0.005 })).connect(wow);
      const drag = K(new Tone.Delay({ delayTime: 0.004, maxDelay: 0.1 })).connect(flutter);
      const tape = K(new Tone.Gain(1)).connect(drag);

      // returns (printed onto the tape too, so the reverb wobbles with everything else)
      const hall = I.reverb(ctx, tape, { decay: 7.5, preDelay: 0.06, lowcut: 280, highcut: 4200 });
      const echo = I.delay(ctx, tape, { time: "4n.", feedback: 0.3, highcut: 2400 });
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.01, lowcut: 300, highcut: 4800 });

      // ---- music box: toy glockenspiel with an inharmonic comb-tine layer ----
      const boxBus = K(new Tone.Gain(1));
      const boxLP = K(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 })).connect(boxBus);
      const glock = I.glock(ctx, { volume: 0, decay: 1.9 });
      const tine = I.kalimba(ctx, { volume: -12, decay: 0.8, bright: 0.8 });
      glock.out.connect(boxLP); tine.out.connect(boxLP);
      const boxPan = K(new Tone.Panner(0.22)); boxBus.connect(boxPan); boxPan.connect(tape);
      I.send(ctx, boxPan, hall, -6); I.send(ctx, boxPan, echo, -15);

      // ---- detuned analog lead (three detuned saws, dark filter, slow glide) ----
      const lead = I.analog(ctx, { wave: "fatsawtooth", glide: 0.07, resonance: 0.8, attack: 0.1, decay: 0.9, sustain: 0.7, release: 1.0, filterDecay: 1.0, base: 420, octaves: 2.2, volume: 2 });
      const leadPan = I.place(ctx, lead, -0.2, tape);
      I.send(ctx, leadPan, hall, -9); I.send(ctx, leadPan, echo, -18);

      // ---- pads: detuned saws, closed filter, slow breath ----
      const pad = I.pad(ctx, { volume: -8, cutoff: 950, detune: 26, attack: 1.4, release: 4.5, breath: 0.045 });
      const padPan = I.place(ctx, pad, 0.04, tape);
      I.send(ctx, padPan, hall, -8);

      // ---- soft broken chords (felt keys, very dark) ----
      const keys = I.softPiano(ctx, { volume: -12, cutoff: 1500, decay: 3.5, release: 2 });
      const keysPan = I.place(ctx, keys, -0.38, tape);
      I.send(ctx, keysPan, hall, -7);

      // ---- bass: round filtered triangle, on the tape as well ----
      const bass = I.analog(ctx, { wave: "triangle", glide: 0.02, resonance: 0.7, base: 230, octaves: 1.8, attack: 0.012, decay: 0.8, sustain: 0.6, release: 0.35, filterDecay: 0.25, volume: -3 });
      I.place(ctx, bass, 0, tape);

      // ---- lo-fi drums: lowpassed, partly bit-crushed, saturated; hats on a brighter branch ----
      const drumOut = K(new Tone.Filter({ frequency: 9000, type: "lowpass", rolloff: -12 }));
      const drumPan = K(new Tone.Panner(0.03)); drumOut.connect(drumPan); drumPan.connect(out);
      const dsat = K(new Tone.Distortion({ distortion: 0.2, oversample: "2x", wet: 0.35 })).connect(drumOut);
      const crush = K(new Tone.BitCrusher({ bits: 8 })).connect(dsat);
      crush.wet.value = 0.35;
      const loLP = K(new Tone.Filter({ frequency: 2900, type: "lowpass", rolloff: -24 })).connect(crush);
      const hiLP = K(new Tone.Filter({ frequency: 7500, type: "lowpass", rolloff: -12 })).connect(crush);
      const kitLo = I.kit(ctx, { volume: -1, kickNote: 33, preload: ["kick", "snare", "rim"] });
      const kitHi = I.kit(ctx, { volume: -7, preload: ["hatClosed", "hatOpen"] });
      kitLo.out.connect(loLP); kitHi.out.connect(hiLP);
      I.send(ctx, drumPan, room, -14); I.send(ctx, drumPan, hall, -26);
      const HI = new Set(["hatClosed", "hatOpen", "hatPedal", "shaker"]);

      // ---- hiss bed: pink noise, band-limited; its level is set per section by events ----
      const hissGain = K(new Tone.Gain(0)).connect(out);
      const hissLP = K(new Tone.Filter({ frequency: 7000, type: "lowpass" })).connect(hissGain);
      const hissHP = K(new Tone.Filter({ frequency: 1500, type: "highpass" })).connect(hissLP);
      K(new Tone.Noise({ type: "pink" }).start()).connect(hissHP);
      const hissClock = I.monotonic(hissGain), tapeClock = I.monotonic(dropGain);
      const fin = (x, d) => (Number.isFinite(x) ? x : d);

      return {
        box: { layer: "melody", humanize: { timing: 0.012, vel: 0.08 }, play: (t, e, d) => {
          glock.play(t, e.note, d, e.vel); tine.play(t, e.note, Math.min(d, 0.6), e.vel * 0.8);
        } },
        lead: { layer: "melody", humanize: { timing: 0.016, vel: 0.06 }, play: (t, e, d) => lead.play(t, e.note, d, e.vel) },
        pad: { layer: "harmony", humanize: { timing: 0.03, vel: 0.05 }, play: (t, e, d) => pad.play(t, e.note, d, e.vel) },
        keys: { layer: "harmony", humanize: { timing: 0.014, vel: 0.1 }, play: (t, e, d) => keys.play(t, e.note, d, e.vel) },
        bass: { layer: "bass", humanize: { timing: 0.006, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.007, vel: 0.1 }, play: (t, e) => (HI.has(e.note) ? kitHi : kitLo).hit(e.note, t, e.vel) },
        hiss: { layer: "texture", humanize: { timing: 0, vel: 0 }, play: (t, e, d) => {
          const tt = hissClock(t), g = hissGain.gain, lvl = db(-27) * fin(e.vel, 0.7);
          g.cancelScheduledValues(tt);
          g.setTargetAtTime(lvl, tt, 1.5);
          g.setTargetAtTime(0, tt + d, 2.5);
        } },
        tape: { layer: "texture", humanize: { timing: 0, vel: 0 }, play: (t, e, d) => {
          const tt = tapeClock(t), len = Math.max(0.05, fin(d, 0.2));
          if (e.note === "drag") { // the tape slows (pitch sags ~40 cents), then creeps back up to speed
            const p = drag.delayTime;
            p.cancelScheduledValues(tt);
            p.setTargetAtTime(0.004 + 0.009 * fin(e.vel, 1), tt, 0.4);
            p.setTargetAtTime(0.004, tt + len, 2.4);
          } else { // dropout: a level dip that loses its top end
            const g = dropGain.gain, f = head.frequency, depth = 0.35 + 0.3 * (1 - fin(e.vel, 0.5));
            g.cancelScheduledValues(tt); f.cancelScheduledValues(tt);
            g.setTargetAtTime(depth, tt, 0.012); g.setTargetAtTime(1, tt + len, 0.07);
            f.setTargetAtTime(2200, tt, 0.015); f.setTargetAtTime(6200, tt + len, 0.12);
          }
        } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = planAt(cycle), k = P.key;
      const prev = cycle > 0 ? planAt(cycle - 1) : null, next = planAt(cycle + 1);
      const prog = progIn(P.prog, k);
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const bs = boxShift(k), kp = T.scale(mod12(2 + k), "ionian");
      const drums = P.drums !== "none";

      // ---------- music box ----------
      const tuneHere = (src) => refit(shift(src, bs), sym, 66, 93, kp);
      const boxNotes = (notes, velMul = 1) => notes.forEach((n, i) => {
        const phraseStart = i === 0 || n.beat - notes[i - 1].beat - notes[i - 1].dur > 0.4 || n.beat % 8 === 0;
        push("box", n.beat, Math.max(1.2, n.dur * 1.5), n.note, ((phraseStart ? 0.66 : 0.56) + (n.dur >= 2 ? 0.04 : 0) + r.gauss(0.03)) * velMul);
      });
      const tune = P.tune === "B" ? TUNE_B : TUNE;
      if (P.box === "tune") boxNotes(tuneHere(tune), k === -8 ? 0.85 : 1);
      else if (P.box === "worn") { // a worn copy: notes missing, some late, phrase ends hang on
        const worn = [];
        TUNE.forEach((n, i) => {
          const end = i === TUNE.length - 1 || TUNE[i + 1].beat - n.beat >= 2;
          if (!end && i > 0 && r.chance(0.14)) return;
          let beat = n.beat, dur = n.dur;
          const nextBeat = i + 1 < TUNE.length ? TUNE[i + 1].beat : CB;
          if (!end && n.dur >= 1 && Number.isInteger(n.beat) && r.chance(0.2) && nextBeat - beat >= 1) { beat += 0.5; dur -= 0.5; }
          worn.push({ beat, dur: end ? Math.min(nextBeat - beat, dur + 1) : dur, note: n.note });
        });
        boxNotes(tuneHere(worn), k === -8 ? 0.8 : 0.92);
      } else if (P.box === "answers") { // the lead has the tune an octave down; the box echoes each long note a beat later
        const ans = TUNE.filter((n) => n.dur >= 2).map((n) => ({ beat: n.beat + 1, dur: n.dur - 1, note: n.note }));
        refit(shift(ans, bs), sym, 66, 93, kp).forEach((n) => push("box", n.beat, 2, n.note, 0.48 + r.gauss(0.03)));
      } else if (P.box === "augment" || P.box === "headSlow") { // the first half of the tune at half speed
        const src = TUNE.filter((n) => n.beat < (P.box === "augment" ? 16 : 6)).map((n) => ({ beat: n.beat * 2, dur: n.dur * 2, note: n.note }));
        refit(shift(src, bs), sym, 66, 93, kp).forEach((n) => push("box", n.beat, Math.min(4, n.dur * 1.2), n.note, 0.5 + r.gauss(0.03)));
      } else if (P.box === "fragment") { // the head motif sequenced down through the lament
        const head = TUNE.slice(0, 3);
        [0, 8, 16, 24].forEach((b, i) => {
          const frag = head.map((n) => ({ beat: b + n.beat + (i % 2 ? 0.5 : 0), dur: n.dur, note: n.note + [0, -2, 2, -3][i] }));
          refit(shift(frag, bs), sym, 66, 93, kp).forEach((n, j) => push("box", n.beat, Math.max(1.2, n.dur * 1.4), n.note, (j ? 0.5 : 0.58) - i * 0.02 + r.gauss(0.03)));
        });
      } else if (P.box === "glints" && !(P.arp && P.lead)) { // a few high chord colours, like light catching the lens
        const bars = r.shuffle([1, 2, 3, 4, 5, 6, 7]).slice(0, r.int(3, 4)).sort((a, b) => a - b);
        let last = null;
        bars.forEach((bar) => {
          const at = bar * BPB + r.pick([0.5, 1, 1.5, 2.5]);
          const c = T.chord(sym(at));
          const pcs = c.colors.concat(c.guide, c.colors);
          const cands = T.notesIn(pcs, 79, 91).filter((m) => m !== last && (last == null || Math.abs(m - last) <= 9));
          const n = cands.length ? r.pick(cands) : T.nearest(84, c.pcs, 79, 91);
          push("box", at, 3, n, 0.36 + r.gauss(0.03));
          last = n;
        });
      }

      // Before a key drop the box's last note becomes a tone common to this chord and the next key's
      // first chord, so the memory pivots on one held note (A for D -> Bb, D for Bb -> D, F for Bb -> Gb).
      if (next.key !== k) {
        const boxEv = ev.filter((e) => e.track === "box");
        const lastEv = boxEv[boxEv.length - 1];
        if (lastEv) {
          const here = T.chord(sym(CB - 1)).pcs, there = T.chord(progIn(next.prog, next.key)[0].chord).pcs;
          const common = here.filter((p) => there.includes(p));
          if (common.length) lastEv.note = T.nearest(lastEv.note, common, 66, 93);
        }
      }

      // ---------- lead ----------
      const LLO = 55, LHI = 79;
      let leadNotes = null, leadVel = 0.55;
      const lk = k === -8 ? -8 : k - 12;
      if (P.lead === "counter") leadNotes = refit(shift(P.prog === "bridgeB" ? COUNTER_B : COUNTER, k === -8 ? 4 : k), sym, LLO, LHI, kp);
      else if (P.lead === "low" || P.lead === "double") { leadNotes = refit(shift(tune, lk), sym, LLO, LHI, kp); leadVel = P.lead === "double" ? 0.5 : 0.58; }
      else if (P.lead === "counterTune") leadNotes = refit(shift(COUNTER, k), sym, LLO, LHI, kp).filter((n) => n.beat < 16).concat(refit(shift(tune.filter((n) => n.beat >= 16), lk), sym, LLO, LHI, kp));
      else if (P.lead === "invert") { // the tune upside down (mirrored around its first note), low and slow-breathing
        const axis = TUNE[0].note;
        const inv = TUNE.map((n) => ({ ...n, note: 2 * axis - n.note - 12 + bs }));
        leadNotes = refit(inv, sym, 62, 81, kp);
        leadVel = 0.52;
      }
      if (leadNotes) legato(leadNotes).forEach((n, i) => push("lead", n.beat, n.dur, n.note, leadVel + (n.dur >= 2 ? 0.05 : 0) + (i === 0 ? 0.04 : 0) + r.gauss(0.025)));

      // ---------- pad: one sustained voicing per chord, voice-led ----------
      prog.forEach((h) => {
        const v = cleanVoice(h.chord, state.padV, leadNotes ? { lo: 52, hi: 72, top: [62, 70] } : { lo: 52, hi: 74, top: [64, 72] });
        state.padV = v;
        const abs = h.bar * BPB + h.beat;
        const lift = P.drums === "none" ? 0.04 : 0;
        push("pad", abs, h.dur - 0.05, v, 0.5 + lift + r.gauss(0.02));
      });

      // ---------- felt keys: slow broken chords ----------
      if (P.arp) {
        for (let bar = 0; bar < CYCLE; bar++) {
          const s0 = bar * BPB;
          // above the lead when it plays (the box then rests), otherwise in the middle under the box
          const reg = leadNotes ? "hi" : "mid";
          const v = cleanVoice(sym(s0), state["keys" + reg], reg === "hi" ? { lo: 67, hi: 86, top: [79, 84], maxSpan: 14 } : { lo: 57, hi: 76, top: [69, 76], maxSpan: 14 });
          state["keys" + reg] = v;
          const order = bar % 2 ? [3, 1, 2, 1] : [0, 1, 2, 3];
          const pos = r.chance(0.3) ? [0, 1, 1.5, 3] : [0, 1, 2, 3];
          pos.forEach((b, i) => push("keys", s0 + b, 1.6, v[order[i] % v.length], (i === 0 ? 0.42 : 0.32) + r.gauss(0.03)));
        }
      }

      // ---------- bass ----------
      const bassNote = (b, role) => {
        const c = T.chord(sym(b));
        let n = 36 + mod12(c.bass); // roots live in C2..B2, so the lament's bass really falls
        if (role === "O") n += 12;
        else if (role === "F") n = T.nearest(n + 7, [c.root + 7], n + 2, n + 9);
        return n;
      };
      const setBass = (b, d, role, vel) => push("bass", b, d, bassNote(b, role), vel);
      if (P.bass === "long") prog.forEach((h) => setBass(h.bar * BPB + h.beat, h.dur - 0.1, "R", 0.5));
      if (P.bass === "half") for (let bar = 0; bar < CYCLE; bar++) { setBass(bar * BPB, 2.3, "R", 0.66); setBass(bar * BPB + 2.5, 1.3, "R", 0.5); }
      if (P.bass === "thin") for (let bar = 0; bar < CYCLE; bar++) setBass(bar * BPB, 3.3, "R", 0.55);

      // ---------- drums ----------
      if (!state.loopFor || state.loopFor !== P.idx + "/" + P.film) { state.loop = r.pick(LOOPS); state.loopFor = P.idx + "/" + P.film; }
      const loop = state.loop;
      const exitNext = drums && next.drums === "none";
      const enterNow = drums && (!prev || prev.drums === "none");
      for (let bar = 0; bar < CYCLE && drums; bar++) {
        const s0 = bar * BPB, last = bar === CYCLE - 1;
        if (P.drums === "full") {
          const g = GROOVES[loop[bar % loop.length]];
          const fill = last && !exitNext && r.chance(0.6);
          g.kick.forEach(([b, v]) => push("drums", s0 + b, 0.2, "kick", v));
          if (P.bass === "groove") g.bass.forEach(([b, d, role]) => setBass(s0 + b, d, role, role === "R" ? (b === 0 ? 0.72 : 0.6) : 0.52));
          push("drums", s0 + 1, 0.2, "snare", 0.7, { delay: 0.018 });
          if (!(last && exitNext)) push("drums", s0 + 3, 0.2, "snare", 0.74, { delay: 0.018 });
          if (!fill && !last && r.chance(0.14)) push("drums", s0 + r.pick([2.5, 3.5]), 0.1, "snare", 0.17, { delay: 0.012 });
          const hatsFrom = enterNow && bar === 0 ? 2 : 0; // the hats come in after the downbeat
          for (let h = hatsFrom; h < 4; h += 0.5) {
            if (last && exitNext && h >= 3) break;
            if (fill && h === 3.5) { push("drums", s0 + h, 0.3, "hatOpen", 0.3); continue; }
            if (h % 1 && r.chance(0.12)) continue;
            push("drums", s0 + h, 0.1, "hatClosed", (h % 1 ? 0.2 : 0.3) + (h === 1 || h === 3 ? 0.03 : 0));
          }
          if (fill && r.chance(0.5)) { push("drums", s0 + 3.5, 0.1, "snare", 0.24, { delay: 0.01 }); }
          if (last && exitNext) push("drums", s0 + 3.5, 0.3, "hatOpen", 0.26); // last breath before the drums leave
        } else if (P.drums === "half") { // half time: kick 1, snare 3, quarter hats
          push("drums", s0, 0.2, "kick", 0.82);
          if (bar % 2) push("drums", s0 + 1.5, 0.2, "kick", 0.45);
          push("drums", s0 + 2, 0.2, "snare", 0.72, { delay: 0.022 });
          for (let h = 0; h < 4; h++) push("drums", s0 + h, 0.1, "hatClosed", h % 2 ? 0.26 : 0.2);
          if (last && !exitNext) push("drums", s0 + 3.5, 0.1, "snare", 0.22);
        } else if (P.drums === "thin") { // just a kick and a rim click, the beat remembered
          push("drums", s0, 0.2, "kick", 0.7);
          if (bar % 2 === 0) push("drums", s0 + 2.5, 0.2, "kick", 0.5);
          push("drums", s0 + 1, 0.1, "rim", 0.42, { delay: 0.015 });
          push("drums", s0 + 3, 0.1, "rim", 0.46, { delay: 0.015 });
        }
      }

      // ---------- tape texture ----------
      push("hiss", 0, CB + 1, null, P.hiss);
      if (next.key !== k) push("tape", CB - 2, 2.2, "drag", 1);  // the tape drags into the new key
      if (prev && prev.key !== k) push("tape", 0, 0.28, "dropout", 0.3);
      else if (cycle > 0 && r.chance(0.3)) push("tape", r.int(1, 7) * BPB + r.pick([0.5, 1.5, 2, 3]), r.range(0.08, 0.22), "dropout", r.range(0.4, 1));

      return { events: ev, harmony: prog, section: P.label + (P.film ? ` (film ${P.film + 1})` : ""), state };
    },
  });
})();
