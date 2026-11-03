// Frost Fair: a quick waltz in E minor for a four-channel sound chip, written as a tune in two over a bass in three.
//
// THE TUNE (fixed by hand before any code; the generator never touches these notes, only the arrangement).
//
//   The hook is a two-beat figure laid across 3/4 bars: a rising step and a drop of a sixth onto a bell note that
//   never moves while the figure walks down above it —  B C | E . | A B | E . | G A | E .  (over a bass pumping E-B-B).
//   Three statements take two bars, so the tune is in 2 and the bass is in 3; they meet again every two bars.
//   Then the answer agrees with the bar: a straight harmonic-minor descent C B A G F# D# B to a half close, with the
//   raised seventh appearing exactly once, on the dominant. Phrase 2 is the hook a fourth lower, landing on B.
//   Phrase 3 lifts: three rising fourths filled in by scale, G A B C | A B C D | B C D E, bVI–bVII–III, and a tumble
//   down the dominant D# B F#. Phrase 4 is the hook again and the tumble as a cadence, A F# D# | E.
//
//   The second voice is the tune itself one bar later and an octave down: the hardware "echo channel" trick taken
//   seriously, as a canon. The harmony was chosen so the echo fits (the one sour note, C against B7 in bar 4, is a
//   b9 the chord is labelled with); where it would not, the second voice is written by hand (see canonFix), and in
//   the lift it leaves the canon for thirds below with contrary motion onto the landings (a pure canon of a rising
//   sequence is parallel ninths).  B is a chain of thirds in the relative major, G B | A C | B D | E D C B,
//   over a bass that goes into two while the tune stays in three; its dominant then slides to B-flat instead of
//   home (the same chain a minor third up, in sixths and thirds with the second voice, with the one G6 of the
//   piece), and E-flat pivots on its own root to B7 to bring E minor back.
//
// FORM (one lap, 72 bars ≈ 85 s): A alone · A in canon · B (G, then B♭) · A full · an eight-bar tag (a coda arpeggio
// in octaves, four bars of bass and noise alone, a run back in). Density grows across the lap, the tempo never changes.
// The generator varies only arrangement per lap: which echo trick, bass pattern, hat density, ornaments, fills.
//
// PALETTE (built here, not the stock orchestra): pulse 1 at 25% duty with a duty sweep on the attack and vibrato
// that arrives after it; pulse 2 at 12.5%, thin and dry; a 4-bit triangle wave for the bass; a noise channel in
// two widths (a white hiss for hats, a comb-filtered metallic "clank" for the snare) and a triangle thud for the kick.
(function () {
  "use strict";
  const T = Sim.theory;
  const I = Sim.instruments;
  const BPB = 3;
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation: "B5/.5 C6/.5 E5/1 | ..." one bar per entry, durations in beats, bars must sum to 3 ----------
  function line(bars) {
    const out = [];
    bars.forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`frost-fair: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`frost-fair: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    return out;
  }

  // ---------- the music ----------
  const A = {
    harm: ["Em", "Em", "Am", "B7b9", "Em", "Em", "B7b9", "Em", "C", "D7", "G", "B7b9", "Em", "Am", "B7", "Em"],
    lead: [
      "B5/.5 C6/.5 E5/1 A5/.5 B5/.5", //  the hook: three statements across two bars
      "E5/1 G5/.5 A5/.5 E5/1",
      "C6/1 B5/.5 A5/.5 G5/1", //          the answer: a straight descent
      "F#5/1 D#5/1 B4/1", //               to a half close; the raised seventh, once
      "E5/.5 F#5/.5 B4/1 D5/.5 E5/.5", //  the hook a fourth lower
      "B4/1 C5/.5 D5/.5 B4/1",
      "D#5/1 F#5/.5 E5/.5 D#5/1",
      "E5/2 r/1",
      "G5/1 A5/.5 B5/.5 C6/1", //          the lift: rising fourths
      "A5/1 B5/.5 C6/.5 D6/1",
      "B5/1 C6/.5 D6/.5 E6/1",
      "D#6/1 B5/1 F#5/1", //               the tumble down the dominant
      "B5/.5 C6/.5 E5/1 A5/.5 B5/.5", //  the hook
      "E5/1 G5/.5 A5/.5 E5/1",
      "A5/1 F#5/1 D#5/1", //               the tumble as a cadence
      "E5/2 r/1",
    ],
    // the second voice in phrase 3 when it leaves the canon: thirds below, contrary motion onto the landings
    thirds3: ["E5/1 F#5/.5 G5/.5 E5/1", "F#5/1 G5/.5 A5/.5 F#5/1", "G5/1 A5/.5 B5/.5 G5/1", "B5/1 F#5/1 D#5/1"],
    // the canon takes a singer's licence: D# under the tonic becomes D, and four bars are written by hand (the
    // descent ends on F# instead of G against B7; the tumble; the cadence; the last bar, where the echoed tumble
    // resolves to E instead of hanging on D#). In the lift (bars 9-12) a pure canon gives parallel ninths, so
    // the second voice plays thirds3 there instead.
    canonFix: { 3: "C5/1 B4/.5 A4/.5 F#4/1", 11: "B4/1 C5/.5 D#5/.5 B4/1", 14: "E4/1 F#4/.5 A4/.5 F#4/1", 15: "A4/1 F#4/1 E4/1" },
  };
  const B = {
    harm: ["G", "D7/F#", "Em", "C", "Am", "G/B", "D7", "D7", "Bb", "F7/A", "Gm", "Eb", "Cm", "Gm", "Eb", "B7"],
    lead: [
      "G5/2 B5/1", "A5/2 C6/1", "B5/2 D6/1", "E6/1 D6/.5 C6/.5 B5/1", //  a chain of thirds, climbing
      "C6/2 A5/1", "B5/2 G5/1", "A5/2 F#5/1", "G5/1 F#5/1 D5/1", //        and falling to the dominant...
      "Bb5/2 D6/1", "C6/2 Eb6/1", "D6/2 F6/1", "G6/1 F6/.5 Eb6/.5 D6/1", // ...which goes to B-flat instead
      "Eb6/2 C6/1", "D6/2 Bb5/1", "Bb5/1 G5/1 Eb5/1", "Eb5/2 F#5/1", //    E-flat pivots on its root to B7
    ],
    thirds: [ // second voice for the B-flat half: sixths and thirds below
      "G5/2 Bb5/1", "A5/2 C6/1", "Bb5/2 D6/1", "Eb6/1 D6/.5 C6/.5 Bb5/1",
      "C6/2 G5/1", "Bb5/2 G5/1", "G5/1 Eb5/1 Bb4/1", "B4/2 D#5/1",
    ],
  };
  const TAG = {
    harm: ["Am", "B7", "Em", "Em", "Em", "Em", "Em", "B7b9"],
    lead: ["A5/1 C6/1 E6/1", "D#6/1 B5/1 F#5/1", "E5/2 r/1", "r/3", "r/3", "r/3", "r/3", "r/1 D#5/.5 F#5/.5 A5/.5 C6/.5"],
    low: ["A4/1 C5/1 E5/1", "D#5/1 B4/1 F#4/1", "E4/2 r/1"],
  };
  for (const s of [A, B, TAG]) {
    s.notes = line(s.lead);
    if (s.thirds) s.thirdsNotes = line(s.thirds);
    if (s.thirds3) s.thirds3Notes = line(s.thirds3);
    if (s.low) s.lowNotes = line(s.low);
    if (s.canonFix) s.canonFixNotes = Object.fromEntries(Object.entries(s.canonFix).map(([k, v]) => [k, line([v])]));
  }
  const KEY = T.scale(4, "harmonicMinor"); // E F# G A B C D#
  const KEY_NAT = T.scale(4, "aeolian"); // E F# G A B C D

  // the lap: 9 cycles of 8 bars
  const LAP = [
    { sec: "A", half: 0, kind: "alone" }, { sec: "A", half: 1, kind: "alone" },
    { sec: "A", half: 0, kind: "canon" }, { sec: "A", half: 1, kind: "canon" },
    { sec: "B", half: 0, kind: "B1" }, { sec: "B", half: 1, kind: "B2" },
    { sec: "A", half: 0, kind: "full" }, { sec: "A", half: 1, kind: "full" },
    { sec: "TAG", half: 0, kind: "tag" },
  ];

  // ---------- the chip ----------
  function pulseVoice(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 7000, type: "lowpass", rolloff: -12 })).connect(out);
    const vib = ctx.keep(new Tone.Vibrato({ frequency: o.vibRate ?? 6, depth: 0 })).connect(lp);
    const s = ctx.keep(new Tone.Synth({
      oscillator: { type: "pulse", width: o.width },
      envelope: { attack: 0.002, decay: o.decay ?? 0.06, sustain: o.sustain ?? 0.72, release: 0.015 },
    })).connect(vib);
    const mono = I.monotonic(out);
    const vibDepth = o.vibDepth ?? 0, vibDelay = o.vibDelay ?? 0.22, sweep = o.sweep ?? 0;
    return {
      out,
      play(time, note, dur, vel) {
        const t = mono(time);
        const d = Math.max(0.03, dur - 0.012);
        s.triggerAttackRelease(T.hz(note), d, t, vel);
        if (sweep) { // duty sweep on the attack: thin to full
          s.oscillator.width.cancelScheduledValues(t);
          s.oscillator.width.setValueAtTime(Math.min(0.9, o.width + sweep), t);
          s.oscillator.width.linearRampToValueAtTime(o.width, t + 0.045);
        }
        if (vibDepth) { // vibrato arrives after the attack, only on notes long enough to carry it
          vib.depth.cancelScheduledValues(t);
          vib.depth.setValueAtTime(0, t);
          if (d > vibDelay + 0.08) vib.depth.linearRampToValueAtTime(vibDepth, t + vibDelay + 0.12);
        }
      },
    };
  }
  function waveBass(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "lowpass", rolloff: -12 })).connect(out);
    const crush = ctx.keep(new Tone.BitCrusher({ bits: 4 })).connect(lp);
    const s = ctx.keep(new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.003, decay: 0.08, sustain: 0.85, release: 0.02 } })).connect(crush);
    const mono = I.monotonic(out);
    return { out, play(time, note, dur, vel) { s.triggerAttackRelease(T.hz(note), Math.max(0.03, dur - 0.015), mono(time), vel); } };
  }
  function noiseKit(ctx, o) {
    const out = ctx.keep(new Tone.Gain(db(o.volume)));
    const mk = (gainDb, chain, synth) => {
      const g = ctx.keep(new Tone.Gain(db(gainDb)));
      let node = g;
      for (const n of chain) { node.connect(n); node = n; }
      node.connect(out);
      synth.connect(g);
      return { synth, mono: I.monotonic(out) };
    };
    // hiss: the long-period white noise, very short (hats)
    const hiss = mk(-2, [ctx.keep(new Tone.BitCrusher({ bits: 3 })), ctx.keep(new Tone.Filter({ frequency: 5500, type: "highpass" }))],
      ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } })));
    // clank: the short-period noise, which rings at a pitch (snare / accents)
    const clank = mk(1, [ctx.keep(new Tone.FeedbackCombFilter({ delayTime: 0.0011, resonance: 0.5 })), ctx.keep(new Tone.BitCrusher({ bits: 4 })), ctx.keep(new Tone.Filter({ frequency: 700, type: "highpass" }))],
      ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 } })));
    // thud: a triangle wave diving in pitch (kick)
    const thud = mk(4, [ctx.keep(new Tone.BitCrusher({ bits: 4 })), ctx.keep(new Tone.Filter({ frequency: 900, type: "lowpass" }))],
      ctx.keep(new Tone.MembraneSynth({ oscillator: { type: "triangle" }, pitchDecay: 0.025, octaves: 2.6, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 } })));
    return {
      out,
      hit(voice, time, vel, dur) {
        if (voice === "hiss") { hiss.synth.envelope.decay = dur >= 0.3 ? 0.09 : 0.03; hiss.synth.triggerAttackRelease(0.02, hiss.mono(time), vel); }
        else if (voice === "clank") { clank.synth.envelope.decay = dur >= 0.6 ? 0.16 : 0.1; clank.synth.triggerAttackRelease(0.02, clank.mono(time), vel); }
        else if (voice === "thud") thud.synth.triggerAttackRelease(T.hz(43), 0.06, thud.mono(time), vel);
      },
    };
  }

  Sim.register({
    id: "frost-fair",
    title: "Frost Fair",
    genre: "Chip waltz",
    about: "A quick waltz in E minor on four chip channels: a two-beat hook laid across 3/4 bars, answered by its own echo one bar later as a canon; a B section that climbs in thirds through G major and slides to B♭ before E♭ pivots home; a tag of bass and noise alone. The tune never changes; the arrangement grows denser every lap.",
    situations: ["work", "training"],
    energy: 0.7,
    bpm: 152, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { out } = ctx;
      const room = I.reverb(ctx, out, { decay: 0.8, preDelay: 0.008, lowcut: 400, highcut: 5000 });
      const p1 = pulseVoice(ctx, { width: 0.5, volume: -15, vibDepth: 0.08, vibRate: 6.2, sweep: 0.3, cutoff: 7500 });
      const p2 = pulseVoice(ctx, { width: 0.75, volume: -20, decay: 0.04, sustain: 0.7, cutoff: 6000 });
      const wave = waveBass(ctx, { volume: -17 });
      const kit = noiseKit(ctx, { volume: -16 });
      const a = I.place(ctx, p1, -0.22, out), b = I.place(ctx, p2, 0.3, out);
      I.place(ctx, wave, 0, out); const k = I.place(ctx, kit, 0.08, out);
      I.send(ctx, a, room, -20); I.send(ctx, b, room, -18); I.send(ctx, k, room, -26);
      const chip = { timing: 0.001, vel: 0.02 };
      return {
        lead: { layer: "melody", play: (t, e, d) => p1.play(t, e.note, d, e.vel), humanize: chip },
        echo: { layer: "harmony", play: (t, e, d) => p2.play(t, e.note, d, e.vel), humanize: chip },
        wave: { layer: "bass", play: (t, e, d) => wave.play(t, e.note, d, e.vel), humanize: chip },
        noise: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, e.dur), humanize: { timing: 0.001, vel: 0.04 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const lap = Math.floor(cycle / LAP.length), idx = cycle % LAP.length;
      const S = LAP[idx];
      const sec = S.sec === "A" ? A : S.sec === "B" ? B : TAG;
      const off = S.half * 8 * BPB; // first beat of this cycle within the section
      const nbars = 8;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { // abs: beat within the section
        const b = abs - off;
        if (b < 0 || b >= nbars * BPB - 1e-6) return;
        const bar = Math.floor(b / BPB + 1e-9);
        ev.push({ track, bar, beat: +(b - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const harmBars = sec.harm.slice(S.half * 8, S.half * 8 + 8);
      const harmony = harmBars.map((chord, bar) => ({ bar, beat: 0, dur: BPB, chord }));
      const symAt = (abs) => sec.harm[Math.max(0, Math.min(sec.harm.length - 1, Math.floor(abs / BPB)))];
      const strong = (abs) => Math.abs(abs - Math.round(abs)) < 1e-6;

      // ---- the lap's plan: arrangement choices only, drawn once per lap ----
      if (idx === 0 || !state.plan) {
        state.plan = {
          lap,
          drumsEnter: lap === 0 ? 8 : r.pick([0, 4, 8]), //            bar of A1 where the hats start
          aloneEcho: lap > 0 && r.chance(0.55), //                      A1 on later laps: a quiet one-beat echo
          canonBass: r.pick(["waltz", "waltzOct"]),
          fullBass: r.pick(["octaves", "rootFifth"]),
          ornaments: lap === 0 ? 0.2 : r.range(0.3, 0.55),
          b1Echo: r.pick([1, 1, 2]), //                                 echo delay in beats for the G-major half
          b1Hats: r.chance(0.5),
          fullHats: r.pick(["eighths", "swung"]),
          tagRun: lap === 0 ? true : r.chance(0.8),
        };
      }
      const P = state.plan;

      // ================= pulse 1: the tune =================
      const ornament = S.kind === "full" || (S.kind === "canon" && lap > 0);
      sec.notes.forEach((n) => {
        if (n.beat < off - 1e-6 || n.beat >= off + nbars * BPB) return;
        const landing = n.dur >= 1 && n.beat % BPB !== 0; // the bell notes of the hook land off the bar's downbeat
        let vel = 0.64 + (landing ? 0.12 : n.beat % BPB === 0 ? 0.08 : 0) + (n.dur >= 1 ? 0.03 : 0);
        if (S.kind === "alone") vel -= 0.03;
        // ornaments on long notes: a mordent on the attack or a turn into the next note
        if (ornament && n.dur >= 2 && r.chance(P.ornaments)) {
          const up = T.step(n.note, 1, KEY), dn = T.step(n.note, -1, KEY_NAT);
          const kind = r.weighted([["mordent", 2], ["turn", 1.5], ["trill", 1]]);
          const fig = kind === "mordent" ? [n.note, up, n.note] : kind === "turn" ? [n.note, up, n.note, dn] : [n.note, up, n.note, up, n.note, up];
          const step = kind === "trill" ? 0.125 : 0.1667;
          fig.forEach((m, j) => push("lead", n.beat + j * step, step * 0.9, m, vel - 0.06 - (j ? 0.04 : 0)));
          push("lead", n.beat + fig.length * step, n.dur - fig.length * step, n.note, vel - 0.02);
          return;
        }
        push("lead", n.beat, n.dur, n.note, vel);
      });

      // ================= pulse 2: echo / canon / thirds =================
      const echoAt = (delay, octave, gain) => {
        sec.notes.forEach((n) => {
          const at = n.beat + delay, end = at + n.dur * 0.9, m = n.note + octave;
          if (at >= sec.harm.length * BPB - 1e-6) return; // nothing spills past the section
          if (symAt(at) !== symAt(n.beat) && !T.chord(symAt(at)).pcs.includes(mod12(m))) return; // don't smear across a change
          // the echo never sits a second away from what the tune plays meanwhile: it stops short of such a note,
          // or stays silent when they would start together
          let dur = end - at;
          for (const o of sec.notes) {
            const d = Math.abs(o.note - m);
            if (![1, 2].includes(d % 12) || d >= 15) continue;
            if (o.beat <= at + 1e-6 && o.beat + o.dur > at + 1e-6) dur = 0;
            else if (o.beat > at + 1e-6 && o.beat < at + dur - 1e-6) dur = Math.min(dur, o.beat - at - 0.05);
          }
          if (dur >= 0.3) push("echo", at, dur, m, gain * (n.dur >= 1 ? 1 : 0.9));
        });
      };
      if (S.kind === "alone" && P.aloneEcho) echoAt(1, 0, 0.3);
      if (S.kind === "canon" || S.kind === "full") {
        const g = S.kind === "full" ? 0.5 : 0.46;
        sec.notes.forEach((n) => {
          const at = n.beat + BPB;
          const bar = Math.floor(at / BPB);
          if (bar >= 16 || A.canonFixNotes[bar] || (bar >= 8 && bar < 12)) return;
          let m = n.note - 12;
          if (sec.harm[bar] === "Em" && mod12(m) === 3) m -= 1; // D# under the tonic becomes D
          // a passing tone in the tune a semitone (or a ninth) off the echo note cuts the echo short: staccato, not a rub
          let dur = n.dur * 0.92;
          for (const o of sec.notes) {
            const d = Math.abs(o.note - m);
            if (d % 12 !== 1 || d >= 15) continue;
            if (o.beat <= at + 1e-6 && o.beat + o.dur > at + 1e-6) dur = 0; // together on the attack: the echo breathes
            else if (o.beat > at + 1e-6 && o.beat < at + dur - 1e-6) dur = Math.min(dur, o.beat - at - 0.05);
          }
          if (dur >= 0.3) push("echo", at, dur, m, g);
        });
        for (const [k, notes] of Object.entries(A.canonFixNotes)) notes.forEach((n) => push("echo", Number(k) * BPB + n.beat, n.dur * 0.92, n.note, g));
        A.thirds3Notes.forEach((n) => push("echo", 24 + n.beat, n.dur * 0.92, n.note, g));
      }
      if (S.kind === "B1") echoAt(P.b1Echo, 0, 0.3);
      if (S.kind === "B2") B.thirdsNotes.forEach((n) => push("echo", 24 + n.beat, n.dur * 0.92, n.note, 0.52));
      if (S.kind === "tag") TAG.lowNotes.forEach((n) => push("echo", n.beat, n.dur * 0.92, n.note, 0.5));

      // ================= wave: the bass =================
      const bassPattern = S.kind === "alone" ? "waltz" : S.kind === "canon" ? P.canonBass : S.kind === "B1" ? "inTwo" : S.kind === "B2" ? "waltzOct" : S.kind === "full" ? P.fullBass : "tag";
      for (let bar = S.half * 8; bar < S.half * 8 + 8; bar++) {
        const c = T.chord(sec.harm[bar]);
        const root = T.nearest(40, [c.bass], 36, 47); // the chord's bass note, E2..B2
        const alt = c.bass !== c.root ? T.nearest(root + 5, [c.root], root + 1, root + 11) : root + 7; // fifth, or the root over a slash bass
        const oct = root + 12 <= 57 ? root + 12 : alt;
        const b0 = bar * BPB;
        const vb = 0.8;
        if (S.kind === "tag") {
          if (bar < 3) { push("wave", b0, 1, root, 0.86); push("wave", b0 + 1, 1, alt, 0.72); push("wave", b0 + 2, 1, oct, 0.72); }
          else if (bar === 3) { push("wave", b0, 2.9, root, 0.78); }
          else if (bar < 7) { push("wave", b0, 0.5, root, 0.84); push("wave", b0 + 1, 0.5, alt, 0.68); push("wave", b0 + 1.5, 0.5, oct, 0.6); push("wave", b0 + 2, 0.5, alt, 0.68); }
          else { for (let i = 0; i < 6; i++) push("wave", b0 + i * 0.5, 0.5, i % 2 ? oct : root, 0.7 + i * 0.03); }
          continue;
        }
        if (bassPattern === "waltz") { push("wave", b0, 1, root, vb + 0.06); push("wave", b0 + 1, 1, alt, vb - 0.1); push("wave", b0 + 2, 1, alt, vb - 0.12); }
        else if (bassPattern === "waltzOct") { push("wave", b0, 1, root, vb + 0.06); push("wave", b0 + 1, 1, alt, vb - 0.1); push("wave", b0 + 2, 1, oct, vb - 0.1); }
        else if (bassPattern === "inTwo") { push("wave", b0, 1.5, root, vb + 0.06); push("wave", b0 + 1.5, 1.5, alt, vb - 0.08); }
        else if (bassPattern === "octaves") { // octave pump, fifths on the beats
          [root, oct, alt, oct, alt, oct].forEach((m, i) => push("wave", b0 + i * 0.5, 0.5, m, i === 0 ? vb + 0.06 : i % 2 ? vb - 0.16 : vb - 0.08));
        } else if (bassPattern === "rootFifth") { // the pumping root-fifth alternation
          [root, alt, root, alt, root, alt].forEach((m, i) => push("wave", b0 + i * 0.5, 0.5, m, i === 0 ? vb + 0.06 : i % 2 ? vb - 0.14 : vb - 0.06));
        }
      }

      // ================= noise: hats, snare, kick =================
      for (let bar = S.half * 8; bar < S.half * 8 + 8; bar++) {
        const b0 = bar * BPB, last = bar === 15 || (S.kind === "tag" && bar === 7);
        const hit = (at, voice, vel, dur) => push("noise", at, dur ?? 0.1, voice, vel);
        if (S.kind === "alone") {
          if (bar < P.drumsEnter) continue;
          hit(b0 + 1, "hiss", 0.4); hit(b0 + 2, "hiss", 0.34);
          if (bar >= 12) hit(b0, "thud", 0.5);
          if (last) { hit(b0 + 2, "clank", 0.4); hit(b0 + 2.5, "clank", 0.5); }
        } else if (S.kind === "canon") {
          hit(b0, "thud", 0.7); hit(b0 + 1, "hiss", 0.5); hit(b0 + 2, "hiss", 0.42);
          if (bar % 2 === 1) hit(b0 + 2, "clank", 0.45);
          if (bar % 4 === 3) hit(b0 + 2.5, "hiss", 0.3);
          if (last) { hit(b0 + 1.5, "clank", 0.4); hit(b0 + 2, "clank", 0.5); hit(b0 + 2.5, "clank", 0.6); }
        } else if (S.kind === "B1") {
          // the rhythm section in two with the bass
          hit(b0, "thud", 0.7); hit(b0 + 1.5, "thud", 0.5);
          hit(b0 + 0.75, "hiss", 0.4); hit(b0 + 2.25, "hiss", 0.4);
          if (P.b1Hats) { hit(b0 + 1.5, "hiss", 0.3); hit(b0 + 3 - 0.75, "clank", 0.3); }
          if (bar === 7) { hit(b0 + 2, "clank", 0.5); hit(b0 + 2.5, "clank", 0.6); }
        } else if (S.kind === "B2") {
          hit(b0, "thud", 0.75); hit(b0 + 1, "clank", 0.5); hit(b0 + 2, "clank", 0.46);
          for (let i = 0; i < 6; i++) hit(b0 + i * 0.5, "hiss", i % 2 ? 0.28 : 0.4);
          if (last) { for (let i = 0; i < 4; i++) hit(b0 + 2 + i * 0.25, "clank", 0.4 + i * 0.1); }
          else if (bar === 11 || bar === 13) hit(b0 + 2.5, "clank", 0.4);
        } else if (S.kind === "full") {
          hit(b0, "thud", 0.8); hit(b0 + 1, "clank", 0.55); hit(b0 + 2, "clank", 0.5);
          if (P.fullHats === "eighths") for (let i = 0; i < 6; i++) hit(b0 + i * 0.5, "hiss", i % 2 ? 0.3 : 0.42);
          else { hit(b0 + 0.5, "hiss", 0.4); hit(b0 + 1.5, "hiss", 0.4); hit(b0 + 2.25, "hiss", 0.3); hit(b0 + 2.5, "hiss", 0.36); }
          if (bar % 4 === 3 && r.chance(0.6)) hit(b0 + 1.5, "thud", 0.5);
          if (bar === 7 || last) { for (let i = 0; i < 4; i++) hit(b0 + 2 + i * 0.25, "clank", 0.42 + i * 0.1); }
          if (bar === 11) { hit(b0 + 2.5, "hiss", 0.5, 0.3); }
        } else if (S.kind === "tag") {
          if (bar < 2) { hit(b0, "thud", 0.8); hit(b0 + 1, "clank", 0.5); hit(b0 + 2, "clank", 0.5); }
          else if (bar === 2) { hit(b0, "thud", 0.85); hit(b0, "clank", 0.6); hit(b0, "hiss", 0.5, 0.4); }
          else if (bar === 3) { /* a bar of nothing */ }
          else if (bar < 7) { hit(b0, "thud", 0.7); hit(b0 + 1, "hiss", 0.45); hit(b0 + 1.5, "hiss", 0.3); hit(b0 + 2, "hiss", 0.45); if (bar === 6) hit(b0 + 2, "clank", 0.4); }
          else { hit(b0, "thud", 0.7); for (let i = 0; i < 8; i++) hit(b0 + 1 + i * 0.25, "clank", 0.3 + i * 0.07); }
        }
      }
      // the tag's run back in is optional on later laps; without it the lead keeps silent until the lap starts
      if (S.kind === "tag" && !P.tagRun) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].track === "lead" && ev[i].bar === 7) ev.splice(i, 1); }

      const name = S.kind === "alone" ? "A · the tune alone" : S.kind === "canon" ? "A · in canon" : S.kind === "B1" ? "B · G major, bass in two" : S.kind === "B2" ? "B · lifted to B♭, in thirds" : S.kind === "full" ? "A · full" : "tag · bass and noise";
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${name}${S.sec !== "TAG" ? ` (${S.half ? "bars 9–16" : "bars 1–8"})` : ""}`, state };
    },
  });
})();
