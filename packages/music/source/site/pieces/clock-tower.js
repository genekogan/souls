// Clock Tower: inside the tower, among the gears. 96 BPM in 5/4 (counted 3+2, strong beats 1 and 4), C minor
// with the E-flat chords heard lydian (the A natural is the bright tooth in the minor), written for an eight-voice
// sound chip (Sim.spc). The clock itself is the ostinato and it never stops: a woodblock-like chip-noise tick on
// every eighth, and an "escapement" pluck on the quarters that alternates two notes a fifth apart, C4 and G3. Five
// is odd, so the pluck that falls on the downbeat changes every bar: C on one, G on four in one bar, then G on one,
// C on four in the next. The pallet swings. Everything else sits in the room with the clock: a tune in long
// values that rarely insists, a bass that plays only on beats 1 and 4, a snare that arrives late and is nothing
// but a backbeat on 4, and a chromatic bell that strikes the hour between sections.
//
// ---- fixed by hand (the generator never changes a pitch or a rhythm; it arranges, voices, fills, ornaments) ----
//
// THE TUNE (A, 8 bars of 5/4, C minor; values in beats, bars of 3+2). It winds up and unwinds: the first phrase
// climbs 5-7-9-1 and sinks back through the lydian A to the third held for a whole bar; the second phrase leaps
// a sixth to the top and settles, and the last note is the first note, so the hands come round to where they were.
//   | Cm9        G4(3) Bb4(2)        the fifth held for the 3, up to the seventh for the 2
//   | Cm9        D5(3) C5(2)         leans on the ninth, settles on the root
//   | Ebmaj7#11  Bb4(3) A4(2)        the fifth of E-flat, then the raised fourth: the bright tooth
//   | Ebmaj7#11  G4(5)               the third, held a whole bar: the tune does not insist
//   | Abmaj9     Eb5(3) C5(2)        the leap of a sixth: the top of the tune, down to the third of A-flat
//   | Fm9        G4(3) Ab4(1) Bb4(1) the ninth of F minor, then two steps climbing out
//   | Fm69/D     C5(3) Ab4(2)        the half-diminished (F minor six over D): its seventh, down to its flat fifth
//   | G7sus4     F4(2) G4(2) .       the seventh resolves up to G: the note the tune began on; a breath
//
// THE SECOND STRAIN (B, 8 bars, E-flat major, the relative; lydian where the A natural shows). The same gesture
// in the major (5-7, 9-1), then a fall through G minor, a bar that is the tune's own first bar over C minor, a
// climb to the piece's highest note over the darkest chord (G5, the raised fourth of D-flat), and down.
//   | Ebmaj9     Bb4(3) D5(2)        | Ebmaj9     F5(3) Eb5(2)
//   | Gm9        D5(2) Bb4(1) A4(2)  | Cm9        G4(3) Bb4(2)         (the tune's first bar, inside the strain)
//   | Abmaj9     C5(3) Eb5(2)        | Dbmaj7#11  F5(3) G5(2)          (bVII of E-flat: the ostinato's C and G
//   | Fm9        Eb5(3) C5(2)        | Bb13sus4   Ab4(3) F4(1) G4(1)    are its seventh and raised fourth)
//
// THE CHIME: a chromatic descent, one bell per beat, five semitones for the five beats of a bar: G6 F#6 F6 E6 Eb6.
// That is the quarter. The hour continues it down to C: ... D6 Db6 C6, and then the big bell strikes C4 on beats
// 1 and 4, the number of strikes changing lap by lap. The chime voice has a pitch envelope (each strike starts
// sharp and settles) and a flat twelfth of sheen; it rings through the chip's echo over the bare ostinato.
//
// THE SLIP: the ostinato shifts to a 7/8 feel inside the same 5/4 by accenting eighths in 2+2+3. Ten eighths a
// bar against a seven-eighth pattern: the accents realign only every seven bars, so for the eight bars of the
// section the gears are out of mesh. The bass keeps 1 and 4 (the floor does not slip), a hat marks the 3-group,
// and the chime strikes the hour to reseat the mechanism.
//
// ---- form: one lap = 11 cycles of 4 bars (about 2:20 with the ritardando), then it restarts at tempo ----
//   TICK  the clock alone: ticks, then the escapement, then the bass; the quarter chime announces the tune
//   A A   the tune; the pad enters for the second half; (later laps: ornaments, the snare in the second half)
//   B B   the second strain in E-flat; the snare enters late, a backbeat on 4; the quarter chime at the end
//   SLIP  no tune: the gears slip (2+2+3 accents, hat, planing Cm9 / Dbmaj7#11), the bass holding the floor
//   CHIME the hour: the chromatic descent to C, then the big bell on beats 1 and 4; nothing but the clock under it
//   OCT   the tune in octaves (lead + an organ voice below where the chip has a voice), the pad held to dyads
//   WIND  the mechanism winds down: a ritardando over the cycle, parts leaving one by one, one last strike
// Per cycle the generator chooses only: tick velocities, pad width and restrikes, the bass's beat-4 note, snare
// ghosts, lead ornaments, hat opens, strike counts, fills. The notes above are never regenerated.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose, I = Sim.instruments;
  const BPB = 5, BPM = 96, VOICES = 8, CYC = 4; // 4 bars of 5/4 per cycle
  const db = (x) => Math.pow(10, x / 20);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fin = (x, d) => (Number.isFinite(x) ? x : d);

  // ---------- notation: "G4/3 Bb4/2 | ..." bars of 5 beats; r = rest; trailing _ ties into the next note ----------
  function mel(text) {
    const out = [];
    text.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let pos = 0;
      bar.split(/\s+/).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(_?)$/.exec(tok);
        if (!m) throw new Error(`clock-tower: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), tie: m[3] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`clock-tower: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; }
      else merged.push({ ...n });
    }
    return merged.filter((n) => n.note != null);
  }

  // ---------- the tunes ----------
  const TUNE = mel("G4/3 Bb4/2 | D5/3 C5/2 | Bb4/3 A4/2 | G4/5 | Eb5/3 C5/2 | G4/3 Ab4/1 Bb4/1 | C5/3 Ab4/2 | F4/2 G4/2 r/1");
  const STRAIN = mel("Bb4/3 D5/2 | F5/3 Eb5/2 | D5/2 Bb4/1 A4/2 | G4/3 Bb4/2 | C5/3 Eb5/2 | F5/3 G5/2 | Eb5/3 C5/2 | Ab4/3 F4/1 G4/1");
  const QUARTER = [91, 90, 89, 88, 87]; // G6 F#6 F6 E6 Eb6
  const HOUR = [91, 90, 89, 88, 87, 86, 85, 84]; // ... D6 Db6 C6
  const BIG = 60; // the big bell, C4
  const ESC = [60, 55]; // the escapement: C4 on even beats, G3 on odd (absolute beats; five is odd, so it swaps every bar)
  /** Half a tune (bars 0-3 or 4-7) rebased to a cycle. */
  const half = (notes, h) => notes.filter((n) => n.beat >= h * 20 && n.beat < h * 20 + 20).map((n) => ({ ...n, beat: n.beat - h * 20 }));

  // ---------- harmony ----------
  const PROG = {
    TICK: "| Cm9 | Cm9 | Cm9 | Cm9 |",
    A: "| Cm9 | Cm9 | Ebmaj7#11 | Ebmaj7#11 | Abmaj9 | Fm9 | Fm69/D | G7sus4 |", // Fm69/D: the half-diminished with the ostinato's G as its ninth
    B: "| Ebmaj9 | Ebmaj9 | Gm9 | Cm9 | Abmaj9 | Dbmaj7#11 | Fm9 | Bb13sus4 |",
    SLIP: "| Cm9 | Cm9 | Dbmaj7#11 | Dbmaj7#11 | Cm9 | Cm9 | Abmaj9 | G7sus4 |", // the gear a half step up
    CHIME: "| Cm9 | Cm9 | Cm9 | Cm9 |",
    WIND: "| Cm9 | Cm9 | Abmaj9 | G7sus4 |", // a half close; the restart at tempo is the resolution
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const LAP = [
    { s: "TICK" }, { s: "A", h: 0 }, { s: "A", h: 1 }, { s: "B", h: 0 }, { s: "B", h: 1 },
    { s: "SLIP", h: 0 }, { s: "SLIP", h: 1 }, { s: "CHIME" }, { s: "OCT", h: 0 }, { s: "OCT", h: 1 }, { s: "WIND" },
  ];
  // who keeps a hardware voice when eight are busy: the bell outranks everything, the clock (tick, escapement,
  // bass) outranks the pad, the snare steals the hat and the octave double before it touches the pad
  const PRIORITY = { chime: 7, lead: 6, bass: 5, tick: 5, esc: 5, snare: 4, pad: 3, low: 2, hat: 1 };

  Sim.register({
    id: "clock-tower",
    title: "Clock Tower",
    genre: "16-bit clockwork",
    about: "Inside the tower, among the gears: a 5/4 ostinato that is the clock itself (a chip-noise tick on every eighth, an escapement pluck alternating C and G that swaps sides every bar because five is odd), a C minor tune in long values that rarely insists and ends on the note it began on, a second strain in the relative major with a lydian tooth, a section where the gears slip into 2+2+3 against the bar, and a chromatic bell with a pitch envelope that strikes the hour between sections. The bass plays only on 1 and 4, the snare arrives late and only on 4, and the lap winds down in a ritardando before the clock restarts at tempo. Eight chip voices, a lo-fi output and the SPC echo at a sixteenth.",
    bpm: BPM, beatsPerBar: BPB, strongBeats: [0, 3], swing: 0.5, cycleBars: CYC, gainDb: 0,
    situations: ["mystery", "explore", "work"],
    energy: 0.4,

    instruments(ctx) {
      const chip = Sim.spc.chip(ctx, {
        voices: VOICES, volume: -8, rate: 32000, bits: 8, crush: 0.4, tone: 6800,
        echo: { time: 0.16, feedback: 0.4, tone: 2000, level: -8 }, // 160 ms: a sixteenth at 96, the tower's reflection
      });
      const send = (node, amt) => { const g = ctx.keep(new Tone.Gain(clamp(amt, 0, 1))); node.connect(g); g.connect(chip.echo); };
      const bend = (src, t, cents, secs) => { src.detune.cancelScheduledValues(t); src.detune.setValueAtTime(cents, t); src.detune.linearRampToValueAtTime(0, t + secs); };

      // THE TICK: a knock (a tiny tuned membrane) with a burst of band-passed noise. Two sides, tick and tock,
      // a brighter and a darker band, and a soft "tooth" for the offbeat eighths. Outside the chip's allocator,
      // but through its lo-fi stage and its echo, so each tick leaves a sixteenth-note reflection.
      function tickPatch() {
        const out = ctx.keep(new Tone.Gain(db(-4)));
        const pan = ctx.keep(new Tone.Panner(-0.18)).connect(chip.bus);
        out.connect(pan);
        send(out, 0.16);
        const bp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 2.4 })).connect(out);
        const noise = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.028, sustain: 0, release: 0.01 } })).connect(bp);
        const knock = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 1.2, envelope: { attack: 0.0005, decay: 0.045, sustain: 0, release: 0.01 } })).connect(out);
        knock.volume.value = -5;
        const clock = I.monotonic(out);
        const SIDES = { tick: [2300, 1720, 1], tock: [1350, 1150, 1], tooth: [3000, 2500, 0.45] }; // noise band, knock Hz, knock level
        return {
          play(time, ev) {
            const t = clock(time), [f, k, kl] = SIDES[ev.side] || SIDES.tooth, v = clamp(fin(ev.vel, 0.6), 0.05, 1);
            bp.frequency.cancelScheduledValues(t); bp.frequency.setValueAtTime(f, t);
            noise.triggerAttackRelease(0.02, t, v);
            knock.triggerAttackRelease(k, 0.04, t, v * kl);
          },
        };
      }
      // THE ESCAPEMENT: a thin 25%-pulse pluck with a fast decay, a little pitch drop on the attack and some BRR grit.
      function escPatch() {
        const out = ctx.keep(new Tone.Gain(db(-10)));
        const pan = ctx.keep(new Tone.Panner(0.2)).connect(chip.bus);
        out.connect(pan);
        send(out, 0.3);
        const grit = ctx.keep(new Tone.BitCrusher({ bits: 6, wet: 0.25 })).connect(out);
        const lp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 })).connect(grit);
        const s = ctx.keep(new Tone.Synth({ oscillator: { type: "custom", partials: Sim.spc.WAVES.pulse }, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 } })).connect(lp);
        const clock = I.monotonic(out);
        return {
          play(time, ev) {
            if (!Number.isFinite(ev.note)) return;
            const t = clock(time);
            bend(s, t, 70, 0.014);
            s.triggerAttackRelease(T.hz(ev.note), 0.25, t, clamp(fin(ev.vel, 0.6), 0.05, 1));
          },
        };
      }
      // THE CHIME: two round-robin bells, each a bell-partial loop with a pitch envelope (the strike starts sharp
      // and settles) and a sine a flat twelfth above for the inharmonic sheen a real bell has. `big` is the hour bell.
      function chimePatch() {
        const out = ctx.keep(new Tone.Gain(db(-9)));
        const pan = ctx.keep(new Tone.Panner(0.05)).connect(chip.bus);
        out.connect(pan);
        send(out, 0.6);
        const units = [0, 1].map(() => {
          const g = ctx.keep(new Tone.Gain(1)).connect(out);
          const bell = ctx.keep(new Tone.Synth({ oscillator: { type: "custom", partials: [1, 0, 0.35, 0, 0, 0.3, 0, 0, 0, 0.14, 0, 0, 0.07] }, envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 0.5 } })).connect(g);
          const sheen = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 } })).connect(g);
          sheen.volume.value = -9;
          return { bell, sheen, clock: I.monotonic(g) };
        });
        let rr = 0;
        return {
          play(time, ev) {
            if (!Number.isFinite(ev.note)) return;
            const u = units[rr++ % units.length], t = u.clock(time), big = !!ev.big, v = clamp(fin(ev.vel, 0.7), 0.05, 1);
            u.bell.envelope.decay = big ? 3.2 : 1.6;
            bend(u.bell, t, big ? 140 : 300, big ? 0.07 : 0.035);
            bend(u.sheen, t, 300, 0.03);
            u.bell.triggerAttackRelease(T.hz(ev.note), big ? 3 : 1.4, t, v);
            u.sheen.triggerAttackRelease(T.hz(ev.note + 19) * 0.985, 0.3, t, v * (big ? 0.5 : 0.8));
          },
        };
      }

      const tick = tickPatch(), esc = escPatch(), chime = chimePatch();
      const lead = chip.voice("clarinet", { priority: PRIORITY.lead, echo: 0.45, pan: -0.08, volume: 0, cutoff: 3200, vibrato: { rate: 4.6, depth: 0.07, delay: 0.5 } });
      const low = chip.voice("organ", { priority: PRIORITY.low, echo: 0.3, pan: 0.25, volume: -5, cutoff: 2600 });
      const pad = chip.voice("pad", { poly: 3, priority: PRIORITY.pad, echo: 0.3, pan: 0.12, volume: -6, cutoff: 2800 });
      const bass = chip.voice("bass", { priority: PRIORITY.bass, echo: 0.15, pan: 0, volume: -1, cutoff: 150 });
      const snare = chip.voice("snare", { priority: PRIORITY.snare, echo: 0.35, pan: 0.06, volume: 0, decay: 0.14, tone: 2200 });
      const hat = chip.voice("hat", { priority: PRIORITY.hat, pan: -0.3, volume: -2 });
      const chipHum = { timing: 0.002, vel: 0.03 }; // a clock does not breathe
      return {
        lead: { layer: "melody", play: lead.play, humanize: chipHum },
        low: { layer: "melody", play: low.play, humanize: chipHum },
        chime: { layer: "melody", play: chime.play, humanize: chipHum },
        pad: { layer: "harmony", play: pad.play, humanize: chipHum },
        bass: { layer: "bass", play: bass.play, humanize: chipHum },
        esc: { layer: "texture", play: esc.play, humanize: { timing: 0.001, vel: 0.02 } },
        tick: { layer: "drums", play: tick.play, humanize: { timing: 0.001, vel: 0.02 } },
        snare: { layer: "drums", play: snare.play, humanize: chipHum },
        hat: { layer: "drums", play: hat.play, humanize: chipHum },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % LAP.length, lap = Math.floor(cycle / LAP.length);
      const { s: S, h = 0 } = LAP[idx];
      const key = S === "OCT" ? "A" : S;
      const prog = PROGS[key].filter((e) => e.bar >= h * CYC && e.bar < h * CYC + CYC).map((e) => ({ ...e, bar: e.bar - h * CYC }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ch = (b) => T.chord(sym(b));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      if (state.bass == null) Object.assign(state, { bass: 36, pv: null, stolen: 0, dropped: 0 });
      const nextIdx = (idx + 1) % LAP.length, nx = LAP[nextIdx];
      const nextProg = PROGS[nx.s === "OCT" ? "A" : nx.s];
      const nextFirst = T.chord(nextProg.find((e) => e.bar === (nx.h || 0) * CYC).chord);

      // ================= the clock =================
      /** Ticks on every eighth: tick / tock on the quarters (the side follows the escapement), a soft tooth between. */
      const ticks = (bar, o = {}) => {
        const B = bar * BPB, scale = o.scale ?? 1;
        for (let e = 0; e < 2 * BPB; e++) {
          const b = e / 2, abs = B + b;
          if (b % 1 === 0) push("tick", abs, 0.25, "tick", (b === 0 ? 0.92 : b === 3 ? 0.82 : 0.6) * scale, { side: abs % 2 === 0 ? "tick" : "tock" });
          else if (o.teeth !== false) push("tick", abs, 0.25, "tick", (0.3 + 0.08 * r()) * scale, { side: "tooth" });
        }
      };
      /** The escapement on the quarters: C4 on even absolute beats, G3 on odd. */
      const escapement = (bar, o = {}) => {
        const B = bar * BPB, scale = o.scale ?? 1;
        for (let b = 0; b < BPB; b++) push("esc", B + b, 0.45, ESC[(B + b) % 2], (b === 0 || b === 3 ? 0.72 : 0.58) * scale);
      };
      /** The slip: accents in 2+2+3 eighths across the bar (ticks, escapement on the accents, hat on the 3-group).
       *  `e0` is the section-local eighth index at the start of this bar, so the pattern carries across cycles. */
      const slipBar = (bar, e0, o = {}) => {
        const B = bar * BPB;
        for (let e = 0; e < 2 * BPB; e++) {
          const acc = (e0 + e) % 7, abs = B + e / 2, nAcc = Math.floor((e0 + e) / 7) * 3 + (acc >= 4 ? 2 : acc / 2);
          if (acc === 0 || acc === 2 || acc === 4) {
            push("tick", abs, 0.25, "tick", acc === 4 ? 0.88 : 0.8, { side: nAcc % 2 === 0 ? "tick" : "tock" });
            push("esc", abs, 0.45, ESC[nAcc % 2], acc === 4 ? 0.72 : 0.62);
            if (o.hat) push("hat", abs, acc === 4 ? 0.5 : 0.25, "hat", acc === 4 ? 0.5 : 0.36, acc === 4 ? { open: true } : {});
            if (o.snare && acc === 4) push("snare", abs, 0.25, "snare", 0.5);
          } else push("tick", abs, 0.25, "tick", 0.3 + 0.08 * r(), { side: "tooth" });
        }
      };

      // ================= bass: beats 1 and 4 only =================
      const near = (pc, from = state.bass, lo = 36, hi = 47) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 41); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const bassBar = (bar, o = {}) => {
        const B = bar * BPB, c = ch(B), R = near(c.bass);
        const nextRoot = bar < CYC - 1 ? near(ch(B + BPB).bass, R) : near(nextFirst.bass, R);
        const fifth = R - 5 >= 36 ? R - 5 : R + 7;
        // beat 4: the root again, the fifth, or (last bar of a cycle) a chord tone of this chord next to the coming root
        const approach = bar === CYC - 1 && nextRoot !== R ? T.nearest(nextRoot, c.pcs, 36, 47) : R;
        const four = o.four === "root" ? R : o.four === "fifth" ? fifth : r.weighted([[R, 3], [fifth, 2], [approach !== nextRoot ? approach : R, 1.5]]);
        push("bass", B, 2.7, R, 0.88 * (o.scale ?? 1));
        if (!o.oneOnly) push("bass", B + 3, 1.7, four, (four === R ? 0.74 : 0.8) * (o.scale ?? 1));
        state.bass = R;
      };

      // ================= pad =================
      const plain = (s) => s.replace(/maj9/, "maj7").replace(/m9/, "m7").replace(/13sus4/, "7sus4").replace(/#11/, "");
      const voicing = (b, n, hi = 72) => {
        const v = T.voice(plain(sym(b)), { lo: hi - 14, hi, n, rootless: true, prev: state.pv, spread: "close", top: [hi - 9, hi], omitBass: true });
        state.pv = v;
        return v;
      };
      /** The chord held for the bar (or re-struck on beat 4), n voices wide, a gap before each change. */
      const padBar = (bar, n, vel, o = {}) => prog.filter((e) => e.bar === bar).forEach((e) => {
        const B = bar * BPB + e.beat;
        if (o.restrike && e.dur >= BPB) { push("pad", B, 2.7, voicing(B, n, o.hi), vel); push("pad", B + 3, 1.7, voicing(B, n, o.hi), vel * 0.9); }
        else push("pad", B, Math.min(e.dur - 0.3, o.until ?? 99), voicing(B, n, o.hi), vel);
      });

      // ================= melodies =================
      const playTune = (track, notes, o = {}) => {
        notes.forEach((n, i) => {
          const inBar = n.beat % BPB, long = n.dur >= 3;
          const vel = (o.vel ?? 0.78) + (inBar === 0 ? 0.04 : 0) + (long ? 0.03 : 0) + (n.dur <= 1 ? -0.05 : 0);
          push(track, n.beat, Math.max(0.3, n.dur - (long ? 0.25 : 0.12)), n.note + (o.shift || 0), vel);
          // ornament (later laps): a quick upper-neighbour grace into a long downbeat note
          const up = T.step(n.note, 1, ch(n.beat).scale);
          if (o.grace && long && inBar === 0 && up !== (notes[i - 1] || {}).note && r.chance(0.3)) push(track, n.beat - 0.25, 0.2, up, vel - 0.18);
        });
      };
      /** After everything else is written: is one hardware voice free for the whole of [abs, abs+dur]? */
      const roomFor = () => {
        const L = Sim.spc.ledger(ev, { voices: VOICES, bpb: BPB });
        return (abs, dur) => [abs + 0.01, abs + dur / 2, abs + dur - 0.05].every((t) => L.free(t) >= 1);
      };
      const bells = (abs0, notes, vel = 0.7, step = 1) => notes.forEach((m, i) => push("chime", abs0 + i * step, 1, m, vel - 0.02 * i));
      const strike = (abs, vel = 0.85) => push("chime", abs, 2, BIG, vel, { big: true });

      // ================= drums =================
      const backbeat = (bar, vel, o = {}) => {
        const B = bar * BPB;
        push("snare", B + 3, 0.25, "snare", vel);
        if (o.ghost && r.chance(0.35)) push("snare", B + r.pick([1.5, 4.5]), 0.25, "snare", 0.22);
      };

      // ================= sections =================
      let label = "", tempo = null;
      if (S === "TICK") {
        tempo = { bpm: BPM, rampBeats: 0 }; // the clock restarts at tempo
        for (let bar = 0; bar < CYC; bar++) {
          ticks(bar, { teeth: lap > 0 || bar > 0 });
          if (bar >= 2 || lap > 0) escapement(bar); // the first note of the escapement is C4 on a downbeat
          if (bar >= 3 - Math.min(lap, 1)) bassBar(bar, { four: "root" });
        }
        bells(3 * BPB, QUARTER, 0.62); // the quarter: the bell announces the tune
        label = lap === 0 ? "The clock alone · ticks, escapement, the quarter" : `Lap ${lap + 1} · the clock restarts at tempo`;
      } else if (S === "A") {
        playTune("lead", half(TUNE, h), { vel: 0.78, grace: lap > 0 });
        for (let bar = 0; bar < CYC; bar++) {
          ticks(bar); escapement(bar);
          bassBar(bar, { four: lap === 0 && h === 0 ? "root" : undefined });
          if (h === 1 || lap > 0) padBar(bar, h === 1 && lap > 0 ? 3 : 2, 0.46);
          if (h === 1 && lap > 0 && bar >= 2) backbeat(bar, 0.5);
        }
        label = h === 0 ? `Lap ${lap + 1} · the tune unwinds over the clock` : "The tune · second phrase, the pad enters";
      } else if (S === "B") {
        playTune("lead", half(STRAIN, h), { vel: 0.8, grace: lap > 0 });
        for (let bar = 0; bar < CYC; bar++) {
          ticks(bar); escapement(bar);
          bassBar(bar);
          padBar(bar, 3, 0.48, { restrike: h === 1 && bar < CYC - 1 && r.chance(0.5), until: h === 1 && bar === CYC - 1 ? 0.8 : undefined }); // the room goes quiet for the bell
          if (h === 1 ? bar >= (lap === 0 ? 2 : 0) : lap > 0) backbeat(bar, 0.56, { ghost: lap > 0 }); // lap 1: enters late in the strain; later laps: it stays once it has entered
        }
        if (h === 1) bells(3 * BPB, QUARTER, 0.6); // the quarter, over the last bar of the strain
        label = h === 0 ? "Second strain · the relative major" : "Second strain · the snare arrives, a backbeat on 4";
      } else if (S === "SLIP") {
        for (let bar = 0; bar < CYC; bar++) {
          const e0 = (h * CYC + bar) * 2 * BPB;
          slipBar(bar, e0, { hat: true, snare: h === 1 || lap > 0 });
          bassBar(bar, { four: "root" }); // the floor keeps 1 and 4
          padBar(bar, 2, 0.42);
        }
        label = h === 0 ? "The gears slip · 2+2+3 against the bar" : "The gears slip · still out of mesh";
      } else if (S === "CHIME") {
        for (let bar = 0; bar < CYC; bar++) { ticks(bar); escapement(bar); bassBar(bar, { four: "root" }); }
        bells(0, HOUR, 0.72); // the hour: eight bells, one a beat, G6 down to C6
        const strikes = 2 + (lap % 3);
        [[2, 0], [2, 3], [3, 0], [3, 3]].slice(0, strikes).forEach(([bar, b], i) => strike(bar * BPB + b, 0.86 - 0.04 * i));
        label = `The hour · ${strikes} strikes of the big bell`;
      } else if (S === "OCT") {
        const tune = half(TUNE, h);
        playTune("lead", tune, { vel: 0.82, grace: lap > 0 });
        for (let bar = 0; bar < CYC; bar++) {
          ticks(bar); escapement(bar);
          bassBar(bar, { four: bar === CYC - 1 ? undefined : "fifth" });
          padBar(bar, 2, 0.46, { restrike: bar % 2 === 1, hi: 76 }); // dyads (the octave double needs the voice), voiced above the organ
          backbeat(bar, 0.6, { ghost: true });
          if (h === 1 && bar === CYC - 1) [4, 4.5].forEach((b, i) => push("snare", bar * BPB + b, 0.25, "snare", 0.4 + 0.15 * i));
        }
        const room = roomFor();
        tune.forEach((n) => { const d = Math.max(0.3, n.dur - 0.2); if (room(n.beat, d)) push("low", n.beat, d, n.note - 12, 0.6); });
        label = h === 0 ? "The tune in octaves · the organ a voice below" : "The tune in octaves · second phrase";
      } else { // WIND
        tempo = { bpm: 54, rampBeats: CYC * BPB }; // the mechanism winds down over the whole cycle
        playTune("lead", half(TUNE, 0).filter((n) => n.beat < 2 * BPB), { vel: 0.72 }); // the first two bars, once more, slowing
        for (let bar = 0; bar < CYC; bar++) {
          const scale = 1 - 0.14 * bar;
          ticks(bar, { scale, teeth: bar < 3 });
          escapement(bar, { scale });
          if (bar < 3) bassBar(bar, { four: "root", oneOnly: bar === 2, scale });
          if (bar < 2) padBar(bar, 2, 0.4);
        }
        strike(3 * BPB + 3, 0.8); // one last strike on the last beat 4, ringing into the restart
        label = "Winding down · ritardando, one last strike";
      }

      // the chip: eight voices, stolen by priority; the score shows what survived
      const bud = Sim.spc.budget(ev, { voices: VOICES, bpb: BPB, priority: PRIORITY });
      state.stolen += bud.stolen; state.dropped += bud.dropped;
      const res = { events: bud.events, harmony: prog, section: label, state };
      if (tempo) res.tempo = tempo;
      return res;
    },
  });
})();
