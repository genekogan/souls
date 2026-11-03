// Grand Opening: a New Orleans brass band leading a second line down the street from the ribbon-cutting.
//
// The band: lead trumpet (open, a little vibrato) on the tune, a trumpet section stacking it in three-part
// harmony, trombones on counter-lines, smears and answers, a tenor sax for the solos and the obbligato over
// the last head, and a sousaphone (a buzzy low mono synth with a brassy filter) locking with the bass drum.
// The drums are two street drummers: a snare with ghost notes and press (buzz) rolls into the downbeats,
// and a bass drummer with a cymbal mounted on top (kick on 1, the & of 2 and 4; cymbal on 2 and 4, a crash
// on arrivals), plus tambourine, and the crowd clapping in the breakdown. Swung eighths (swing 0.6).
//
// Harmony: the tune is a 16-bar strain in Bb (I  I  I7  IV  IV  #ivdim7  I/F  V7 | I  I  I7  IV  ivm6
// I/F VI7  II7 V7  I), with the IV-#ivdim-I6/4 and the minor-iv blue note that the style lives on. The bridge is
// a 16-bar minor blues in Bb minor (Bbm7  Ebm7  Gb7  F7#9 ...) carried low by the trombones, the trumpets
// answering with offbeat stabs. The shout chorus is a riff vamp on Bb7-Eb7-F7, trumpets calling and
// trombones answering two bars at a time.
//
// Form (cycles of 8 bars; one round = 17 cycles, about 5.2 minutes):
//   Intro (a snare press roll, bass drum and sousaphone, then the horns riff on the vamp) ->
//   Head (trumpet lead, trombone counter) -> Head (three-part trumpets, tambourine in) ->
//   Bridge (minor blues, trombones lead) -> Solo chorus (sax; trumpet on alternate rounds) ->
//   Stop-time chorus (the band hits on the ones, the sax fills the holes, the band roars back halfway) ->
//   Breakdown (drums alone: the second-line groove, tambourine and the crowd clapping) ->
//   Sousaphone rejoins -> Shout chorus (riff call and response) -> Last head (stacked trumpets, sax
//   obbligato) and a held Bb6 with a roll and a crash; then the next round starts from the drums again.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, E8 = 0.5;
  const mod12 = T.mod12;

  // ---------- notation: "r/1 F4/1 Bb4/1 D5/2 F5/3 | ..." in eighths, 8 per bar ----------
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?\d)\/(\d+)$/.exec(tok);
        if (!m) throw new Error(`second-line: bad token ${tok}`);
        const len = Number(m[2]);
        if (m[1] !== "r") out.push({ beat: (bi * 8 + pos) * E8, len, note: T.midi(m[1]) });
        pos += len;
      });
      if (pos !== 8) throw new Error(`second-line: bar ${bi + 1} of a line has ${pos} eighths`);
    });
    return out;
  }
  const pat = (s) => s.replace(/\|/g, "").split("");

  // ---------- the book ----------
  const A_H = "| Bb | Bb | Bb7 | Eb | Eb | Edim7 | Bb/F | F7 | Bb | Bb | Bb7 | Eb | Ebm6 | Bb/F G7 | C7 F7 | Bb F7 |";
  const A_M = line(
    "r/1 F4/1 Bb4/1 D5/2 F5/3 | G5/2 F5/1 D5/1 F5/4 | r/1 F5/1 Ab5/2 G5/1 F5/1 D5/2 | Eb5/3 G5/1 Bb5/4 | " +
    "r/2 G5/1 F5/1 Eb5/1 C5/1 Eb5/2 | G5/3 E5/1 Db5/4 | r/1 D5/1 F5/1 Bb5/2 A5/1 G5/2 | F5/2 Eb5/1 C5/1 A4/4 | " +
    "r/1 F4/1 Bb4/1 D5/2 F5/3 | G5/2 F5/1 D5/1 Bb4/4 | r/1 Bb4/1 D5/1 F5/2 Ab5/3 | G5/3 Eb5/1 Bb4/4 | " +
    "Gb5/3 Eb5/1 C5/4 | D5/2 F5/2 B4/1 D5/1 F5/2 | E5/2 G5/1 Bb5/1 A5/2 F5/1 Eb5/1 | D5/4 r/4");
  const B_H = "| Bbm7 | Bbm7 | Ebm7 | Bbm7 | Gb7 | F7 | Bbm7 | F7#9 | Bbm7 | Bbm7/Ab | Gb7 | F7 | Bbm7 | Ebm7 | Gb7 F7 | Bbm7 F7 |";
  const B_M = line(
    "r/2 Bb3/1 Db4/1 F4/4 | Eb4/2 Db4/1 Bb3/1 Db4/4 | r/1 Eb4/1 Gb4/1 Bb4/2 Ab4/1 Gb4/2 | F4/6 r/2 | " +
    "r/1 Bb3/1 Db4/1 E4/3 Db4/2 | C4/3 A3/1 Eb4/4 | Db4/3 F4/1 Ab4/4 | Ab4/2 F4/1 Eb4/1 C4/2 A3/2 | " +
    "r/2 Bb3/1 Db4/1 F4/4 | Eb4/2 Db4/1 Bb3/1 Ab3/4 | r/1 Bb3/1 Db4/1 E4/2 Db4/1 Bb3/2 | A3/3 C4/1 Eb4/4 | " +
    "Db4/3 Bb3/1 F4/4 | Gb4/3 Eb4/1 Db4/4 | Bb3/2 Db4/2 C4/2 A3/2 | Bb3/4 r/2 C4/1 Eb4/1");
  const VAMP_H = "| Bb7 | Bb7 | Eb7 | Eb7 | Bb7 | Bb7 | F7 | F7 |";
  const SHOUT_H = "| Bb7 | Bb7 | Eb7 | Eb7 | Bb7 | Bb7 | F7 | F7 | Bb7 | Bb7 | Eb7 | Edim7 | Bb7/F | G7 | C7 F7 | Bb7 F7 |";
  const PROG = { A: T.progression(A_H), B: T.progression(B_H), V: T.progression(VAMP_H), S: T.progression(SHOUT_H) };
  const half = (prog, h) => prog.filter((e) => e.bar >= 8 * h && e.bar < 8 * h + 8).map((e) => ({ ...e, bar: e.bar - 8 * h }));
  const halfNotes = (notes, h) => notes.filter((n) => n.beat >= 32 * h - 1e-6 && n.beat < 32 * h + 32 - 1e-6).map((n) => ({ ...n, beat: n.beat - 32 * h }));

  // riffs: [eighth position within two bars, length in eighths, semitones above the chord root]
  const CALLS = [
    [[1, 1, 4], [2, 1, 7], [3, 2, 9], [5, 1, 7], [6, 2, 4]],
    [[0, 1, 10], [1, 1, 9], [2, 2, 7], [4, 1, 3], [5, 1, 4], [6, 2, 0]],
    [[0, 2, 7], [3, 1, 7], [4, 1, 9], [5, 2, 10], [7, 1, 9], [8, 4, 7]],
    [[1, 1, 12], [2, 1, 12], [3, 1, 10], [4, 2, 12], [6, 2, 7]],
  ];
  const ANSWERS = [
    [[0, 3, 0], [3, 1, 4], [4, 2, 7], [6, 2, 10]],
    [[1, 1, 7], [2, 1, 10], [3, 1, 12], [4, 4, 10]],
    [[0, 1, 4], [1, 1, 3], [2, 2, 0], [4, 2, -2], [6, 2, 0]],
  ];

  // ---------- drums (eighths, two bars) ----------
  const BD = [pat("X..x..x.|X.x..x.."), pat("X..x..X.|x..x.x.x"), pat("X..x.x..|X..x..x.")];
  // snare: A accent, a medium, g ghost, r press roll through that eighth
  const SN = [pat("g.Ag.aAg|gaA.ggrr"), pat("gaAg.gAa|g.Aga.rr"), pat("g.Aga.Ag|.gAg.grr")];
  const FILL = [pat("A.AgA.rr"), pat("AAgAArrr"), pat("rrrrA.Ar"), pat("AgAgAgrr")];

  const ROUND = ["intro", "A1", "A2", "A1h", "A2h", "B1", "B2", "S1", "S2", "ST1", "ST2", "drums", "tuba", "shout1", "shout2", "F1", "F2"];
  const planAt = (cycle) => ({ kind: ROUND[cycle % ROUND.length], round: Math.floor(cycle / ROUND.length) });
  const NAME = {
    intro: "Intro · the band strikes up", A1: "Head · trumpet lead", A2: "Head · trumpet lead", A1h: "Head · trumpets in harmony", A2h: "Head · trumpets in harmony",
    B1: "Bridge · minor blues, trombones", B2: "Bridge · minor blues, trombones", S1: "Solo chorus", S2: "Solo chorus", ST1: "Stop-time chorus · sax", ST2: "Stop-time chorus · band back in",
    drums: "Breakdown · drums alone", tuba: "Breakdown · sousaphone rejoins", shout1: "Shout chorus · call and response", shout2: "Shout chorus · call and response", F1: "Last head · sax obbligato", F2: "Last head · tag",
  };

  Sim.register({
    id: "second-line",
    title: "Grand Opening",
    genre: "Brass band",
    about: "A New Orleans second line in B♭: street snare with press rolls, bass drum with a cymbal on top, sousaphone, a trumpet tune stacked in three parts, a minor-blues bridge for trombones, a sax solo, a stop-time chorus, a drums-only breakdown and a riffing shout chorus.",
    situations: ["celebrate", "party"],
    energy: 0.8,
    bpm: 104, beatsPerBar: BPB, cycleBars: 8, swing: 0.6, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const street = I.reverb(ctx, out, { decay: 1.8, preDelay: 0.014, lowcut: 260, highcut: 6500 });
      const block = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.035, lowcut: 400, highcut: 5500 });

      const trumpet = I.mutedTrumpet(ctx, { volume: 0, cutoff: 4400, base: 1300, octaves: 2.2, breath: -32, vibratoDepth: 0.035, attack: 0.025 });
      const section = I.brassStab(ctx, { volume: -6, base: 600, octaves: 2.8 });
      const bones = I.synthBrass(ctx, { volume: -5, attack: 0.04, swell: 0.12, base: 240, octaves: 2.8, release: 0.35 });
      const sax = I.sax(ctx, { volume: -1, cutoff: 3000 });
      const sousa = I.analog(ctx, { volume: -2, wave: "sawtooth", base: 110, octaves: 2.6, resonance: 1.4, attack: 0.018, decay: 0.3, sustain: 0.55, release: 0.1, filterDecay: 0.22 });
      const sousaLp = ctx.keep(new Tone.Filter({ frequency: 1300, type: "lowpass", rolloff: -12 }));
      sousa.out.connect(sousaLp);

      const bd = I.kit(ctx, { volume: 0, kickNote: 30, preload: ["kick", "ride", "crash"] });
      const sn = I.kit(ctx, { volume: -3, preload: ["snare"] });
      const tb = I.kit(ctx, { volume: -9, preload: ["tambourine"] });
      const cl = I.kit(ctx, { volume: -8, preload: ["clap"] });

      const tp = I.place(ctx, trumpet, 0.08, out), sp = I.place(ctx, section, 0.3, out), bp = I.place(ctx, bones, -0.32, out);
      const xp = I.place(ctx, sax, -0.12, out);
      const up = ctx.keep(new Tone.Panner(0)); sousaLp.connect(up); up.connect(out);
      const dp = I.place(ctx, bd, 0.05, out), np = I.place(ctx, sn, -0.1, out), ap = I.place(ctx, tb, 0.45, out), cp = I.place(ctx, cl, -0.2, out);
      I.send(ctx, tp, street, -10); I.send(ctx, tp, block, -16); I.send(ctx, sp, street, -11); I.send(ctx, bp, street, -10); I.send(ctx, bp, block, -18);
      I.send(ctx, xp, street, -10); I.send(ctx, xp, block, -15); I.send(ctx, up, street, -22);
      I.send(ctx, dp, street, -16); I.send(ctx, np, street, -12); I.send(ctx, ap, street, -14); I.send(ctx, cp, block, -8);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      const k = (kit) => (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.sd });
      return {
        trumpet: { layer: "melody", play: pl(trumpet), humanize: { timing: 0.008, vel: 0.05 } },
        sax: { layer: "melody", play: pl(sax), humanize: { timing: 0.01, vel: 0.06 } },
        section: { layer: "harmony", play: pl(section), humanize: { timing: 0.007, vel: 0.05 } },
        bones: { layer: "harmony", play: pl(bones), humanize: { timing: 0.01, vel: 0.05 } },
        sousa: { layer: "bass", play: pl(sousa), humanize: { timing: 0.006, vel: 0.06 } },
        bassdrum: { layer: "drums", play: k(bd), humanize: { timing: 0.005, vel: 0.06 } },
        snare: { layer: "drums", play: k(sn), humanize: { timing: 0.004, vel: 0.1 } },
        tamb: { layer: "drums", play: k(tb), humanize: { timing: 0.006, vel: 0.12 } },
        claps: { layer: "drums", play: k(cl), humanize: { timing: 0.012, vel: 0.15 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const { kind, round } = planAt(cycle), next = planAt(cycle + 1);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const drum = (track, abs, voice, vel, x) => { if (vel > 0.02) push(track, abs, 0.1, voice, Math.min(1, vel), x); };

      // ---- harmony for this cycle ----
      const h = /2/.test(kind) ? 1 : 0;
      let prog;
      if (/^(A|S|ST|F)\d/.test(kind) || kind === "A1h" || kind === "A2h") prog = half(PROG.A, h);
      else if (/^B\d/.test(kind)) prog = half(PROG.B, h);
      else if (/^shout/.test(kind)) prog = half(PROG.S, h);
      else prog = PROG.V;
      const ending = kind === "F2";
      if (ending) prog = prog.filter((e) => e.bar < 7).concat([{ bar: 7, beat: 0, dur: 4, chord: "Bb6" }]);
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(Math.max(0, Math.min(31.99, b))).chord;
      const nextFirst = (() => { const nk = next.kind; if (/^B/.test(nk)) return "Bbm7"; return "Bb7"; })();

      const solo = kind === "S1" || kind === "S2" || kind === "ST1" || kind === "ST2";
      const trumpetSolo = round % 2 === 1 && (kind === "S1" || kind === "S2");
      const stop = kind === "ST1" ? 8 : kind === "ST2" ? 4 : 0; // bars of stop-time in this cycle
      const head = ["A1", "A2", "A1h", "A2h", "F1", "F2"].includes(kind);
      const stacked = ["A1h", "A2h", "F1", "F2"].includes(kind);

      // ---------- the tune ----------
      if (head) {
        const mel = halfNotes(A_M, h);
        mel.forEach((n, i) => {
          let dur = n.len * E8 * (n.len >= 3 ? 0.94 : 0.8), vel = 0.72 + (n.len >= 3 ? 0.05 : 0) + ((n.beat * 2) % 2 === 1 ? 0.05 : 0) + r.gauss(0.03);
          let note = n.note;
          if (ending && n.beat >= 28) { note = T.midi("D5"); dur = 3.6; vel = 0.82; }
          // second time through, the lead adds a scoop (a quick grace from below) into some long notes
          if ((kind === "A1h" || kind === "A2h" || kind === "F1") && n.len >= 3 && i > 0 && r.chance(0.35)) push("trumpet", Sim.swingBeat(n.beat, 0.6, 0.5) - 0.12, 0.1, note - 1, vel * 0.6, { straight: true });
          push("trumpet", n.beat, dur, note, vel);
          if (stacked && !(ending && n.beat >= 28)) push("section", n.beat, dur, trio(note, sym(n.beat)), vel * 0.8);
        });
        if (ending) { // the held Bb6, a fall-off on top
          push("section", 28, 3.6, [T.midi("G4"), T.midi("Bb4")], 0.75);
          push("bones", 28, 3.6, [T.midi("F3"), T.midi("D4")], 0.75);
        }
        // trombone counter: guide tones in long, swelling shapes, out of the trumpet's way
        {
          const BONE = [[[0, 1.4]], [[0, 0.9], [1.5, 1.3]], [[0, 0.4], [0.5, 1.8]], [[1.5, 0.4], [2, 1.8]], [[0, 2.8]], [[2.5, 1.4]], [[0, 0.4], [1, 0.4], [2.5, 1.2]]];
          prog.forEach((c, i) => {
            if (ending && c.bar === 7) return;
            const s0 = c.bar * 4 + c.beat;
            const v = T.voice(c.chord, { lo: 53, hi: 64, n: 2, prev: state.bonesV, rng: r });
            state.bonesV = v;
            const cands = c.dur >= 4 ? BONE : [[[0, 1.4]], [[0, 0.4], [1, 0.9]]];
            const p = r.pick(cands);
            const nextStart = i + 1 < prog.length ? prog[i + 1].bar * 4 + prog[i + 1].beat : 32;
            p.forEach(([b, d]) => { if (s0 + b < nextStart - 0.4) push("bones", s0 + b, Math.min(d, nextStart - s0 - b - 0.1), v, 0.55 + r.range(-0.04, 0.06)); });
          });
        }
        if (kind === "F1" || kind === "F2") { // sax obbligato, high and sparse
          const m = C.line({ start: 0.5, end: ending ? 27 : 31, chordAt: sym, lo: 67, hi: 82, rng: r.fork(7), density: 0.35, phrase: [3, 6], rest: [2, 4], motif: state.oblMotif, motifProb: 0.5, chromatic: 0.25, register: 0.65, prev: state.oblLast, upbeatStart: 0.7, scaleFor: bluesy });
          state.oblMotif = m.motif; state.oblLast = m.last;
          m.notes.forEach((n) => { if (!collides(n)) push("sax", n.beat, n.dur, n.note, 0.48 + (n.vel - 0.6)); });
        }
      }

      // ---------- the bridge: minor blues, trombones on the tune ----------
      if (kind === "B1" || kind === "B2") {
        const mel = halfNotes(B_M, h);
        const saxLead = round % 2 === 1;
        mel.forEach((n) => {
          const dur = n.len * E8 * (n.len >= 3 ? 0.95 : 0.82), vel = 0.7 + (n.len >= 4 ? 0.06 : 0) + r.gauss(0.03);
          const harm = underBone(n.note, sym(n.beat));
          push("bones", n.beat, dur, [harm, n.note], vel);
          if (saxLead) push("sax", n.beat, dur, n.note + 12, vel * 0.9);
        });
        // trumpets answer with offbeat stabs
        for (let bar = 0; bar < 8; bar++) {
          const v = T.voice(sym(bar * 4).replace("#9", ""), { lo: 63, hi: 77, n: 3, prev: state.stabV, top: [70, 77], rng: r });
          state.stabV = v;
          const pats = [[1.5, 3.5], [1.5, 2.5], [3.5], [0.5, 1.5, 3.5]];
          const p = bar % 2 === 1 ? r.pick(pats) : [1.5, 3.5];
          p.forEach((b) => { if (sym(b + bar * 4) === sym(bar * 4)) push("section", bar * 4 + b, 0.35, v, 0.55); });
        }
      }

      // ---------- solos and the stop-time chorus ----------
      if (solo) {
        const n = { S1: 0, S2: 1, ST1: 2, ST2: 3 }[kind];
        if (kind === "S1") { state.soloMotif = null; state.soloLast = null; }
        const inst = trumpetSolo ? "trumpet" : "sax";
        const lo = trumpetSolo ? 62 : 58, hi = trumpetSolo ? 84 : 80;
        const m = C.line({
          start: kind === "S1" ? 0.5 : 0, end: 31.5, chordAt: sym, lo, hi, rng: r,
          density: [0.38, 0.5, 0.56, 0.66][n], phrase: [3, 8], rest: n >= 2 ? [0.5, 1.5] : [1, 2.5],
          motif: state.soloMotif, motifProb: 0.45, chromatic: 0.3, register: [0.4, 0.55, 0.6, 0.72][n],
          prev: state.soloLast, upbeatStart: 0.6, scaleFor: bluesy,
        });
        state.soloMotif = m.motif; state.soloLast = m.last;
        m.notes.forEach((x) => push(inst, x.beat, x.dur, x.note, 0.6 + (x.vel - 0.6) * 1.3 + n * 0.03));
        // a blue-note shake at the climax of the second solo chorus
        if (kind === "ST2" && !trumpetSolo) { const top = T.nearest(76, [mod12(T.chord(sym(28)).root + 3), mod12(T.chord(sym(28)).root + 4)], 70, 79); [0, 0.25, 0.5, 0.75].forEach((o, i) => push("sax", 28 + o, 0.24, i % 2 ? top - 2 : top, 0.75, { straight: true })); }
      }

      // trombone pads under the solo: one soft guide-tone dyad per chord
      if (kind === "S1" || kind === "S2") {
        prog.forEach((c) => {
          const v = T.voice(c.chord, { lo: 50, hi: 61, n: 2, prev: state.bonesV, rng: r });
          state.bonesV = v;
          push("bones", c.bar * 4 + c.beat, c.dur - 0.2, v, 0.42);
        });
      }

      // stop-time hits: the whole band on the one (and on the & of 2 in every other bar)
      if (stop) {
        for (let bar = 0; bar < stop; bar++) {
          const hits = bar % 2 === 1 ? [0, 1.5] : [0];
          if (bar === stop - 1 && kind === "ST2") hits.push(2.5, 3.5);
          hits.forEach((b) => {
            const at = bar * 4 + b, c = T.chord(sym(at));
            const v = T.voice(c.sym, { lo: 62, hi: 77, n: 3, prev: state.stabV, top: [70, 77], rng: r });
            state.stabV = v;
            push("section", at, 0.4, v, 0.8);
            push("bones", at, 0.4, T.voice(c.sym, { lo: 53, hi: 64, n: 2, prev: state.bonesV }), 0.75);
            push("sousa", at, 0.45, T.nearest(state.tubaLast ?? 41, [c.bass], 34, 46), 0.85);
            drum("bassdrum", at, "kick", 0.9); drum("bassdrum", at, "crash", b === 0 ? 0.5 : 0.35);
            drum("snare", at, "snare", 0.75);
          });
        }
      }

      // horn backgrounds behind the soloist (second half of each solo chorus, and when the band comes back)
      if (kind === "S2" || kind === "ST2") {
        for (let bar = 4; bar < 8; bar += 2) {
          const c = T.chord(sym(bar * 4));
          const call = CALLS[(round + bar / 2) % CALLS.length];
          riff("section", call, bar * 4, c, 65, 79, 0.5, true);
        }
      }

      // ---------- intro, breakdown, sousaphone, shout ----------
      if (kind === "intro" || kind === "shout1" || kind === "shout2" || kind === "tuba") {
        const calls = kind === "intro" ? [2, 3] : kind === "tuba" ? [3] : [0, 1, 2, 3];
        for (const k2 of calls) { // two-bar units: trumpets call on the first bar, trombones answer on the second
          const at = k2 * 8;
          const c = T.chord(sym(at));
          const ci = (round * 3 + k2 + (kind === "shout2" ? 2 : 0)) % CALLS.length;
          riff("section", CALLS[ci].filter(([p]) => p < 8), at, c, 66, 81, 0.78, true);
          {
            const c2 = T.chord(sym(at + 4));
            riff("bones", ANSWERS[(ci + k2) % ANSWERS.length], at + 4, c2, 50, 65, 0.72, false);
            if (kind !== "tuba") {
              // under the call the trombones punch the one; under the answer the trumpets hold a chord
              const bv = T.voice(c.sym, { lo: 53, hi: 64, n: 2, prev: state.bonesV });
              state.bonesV = bv;
              push("bones", at, 0.4, bv, 0.62);
              const sv = T.voice(c2.sym, { lo: 65, hi: 79, n: 3, prev: state.stabV, top: [72, 79], rng: r });
              state.stabV = sv;
              push("section", at + 4, 3.3, sv, 0.46);
            }
          }
        }
        if (kind === "shout2") { // the trumpet screams over the last four bars
          [[16.5, 0.4, 82], [17, 1.4, 82], [19, 0.9, 79], [20.5, 0.4, 82], [21, 2.5, 84], [24.5, 0.4, 82], [25, 0.9, 81], [26, 0.9, 79], [27, 1.8, 77]].forEach(([b, d, m]) => {
            const c = T.chord(sym(b));
            push("trumpet", b, d, T.nearest(m, c.pcs, 72, 86), 0.82);
          });
        }
      }

      // ---------- sousaphone ----------
      const tubaOn = kind !== "drums" && kind !== "ST1" && kind !== "ST2";
      if (tubaOn) {
        let last = state.tubaLast ?? 41;
        const startBar = kind === "intro" ? 2 : 0;
        for (let bar = startBar; bar < 8; bar++) {
          if (ending && bar === 7) { push("sousa", 28, 3.6, 34, 0.85); last = 34; continue; }
          const here = prog.filter((e) => e.bar === bar);
          const nextSym = bar < 7 ? sym((bar + 1) * 4) : nextFirst;
          const target = (s, near) => T.nearest(near, [T.chord(s).bass], 33, 47);
          const app = (from, to) => (r.chance(0.55) ? to + (to > from ? -1 : 1) : T.step(to, to > from ? -1 : 1, T.chord(sym(bar * 4 + 3)).scale));
          if (here.length > 1) {
            const a = target(here[0].chord, last), b = target(here[1].chord, a);
            push("sousa", bar * 4, 1.4, a, 0.85); push("sousa", bar * 4 + 1.5, 0.4, a, 0.6);
            push("sousa", bar * 4 + 2, 1.4, b, 0.82);
            const tn = target(nextSym, b);
            push("sousa", bar * 4 + 3.5, 0.4, app(b, tn), 0.66);
            last = b;
            continue;
          }
          const c = T.chord(here[0] ? here[0].chord : sym(bar * 4));
          const R = target(c.sym, last);
          const third = R + (c.intervals.includes(3) ? 3 : 4);
          const fifth = c.intervals.includes(6) ? R + 6 : R + 7;
          const fifthDown = fifth - 12 >= 33 ? fifth - 12 : fifth;
          const tn = target(nextSym, R);
          const style = r.weighted([["street", 4], ["walk", 2], ["bounce", 2]]);
          if (style === "street") {
            push("sousa", bar * 4, 1.4, R, 0.88); push("sousa", bar * 4 + 1.5, 0.4, R, 0.62);
            push("sousa", bar * 4 + 2, 0.9, fifthDown, 0.8); push("sousa", bar * 4 + 3, 0.9, app(fifthDown, tn), 0.7);
          } else if (style === "walk") {
            [R, third, fifth, app(fifth, tn)].forEach((m, i) => push("sousa", bar * 4 + i, 0.9, m, i === 0 ? 0.88 : 0.72));
          } else {
            push("sousa", bar * 4, 1.4, R, 0.88); push("sousa", bar * 4 + 1.5, 0.9, fifthDown, 0.72);
            push("sousa", bar * 4 + 2.5, 0.4, R, 0.6); push("sousa", bar * 4 + 3, 0.4, third, 0.66); push("sousa", bar * 4 + 3.5, 0.4, app(third, tn), 0.66);
          }
          last = R;
        }
        state.tubaLast = last;
      }
      // the sousaphone fills the stop-time holes' way out: back in for the second half of ST2
      if (kind === "ST2") {
        let last = state.tubaLast ?? 41;
        for (let bar = 4; bar < 8; bar++) {
          const c = T.chord(sym(bar * 4));
          const R = T.nearest(last, [c.bass], 33, 47);
          push("sousa", bar * 4, 1.4, R, 0.88); push("sousa", bar * 4 + 1.5, 0.4, R, 0.62);
          push("sousa", bar * 4 + 2, 0.9, R + 7 - 12 >= 33 ? R - 5 : R + 7, 0.8);
          const nx = T.nearest(R, [T.chord(bar < 7 ? sym((bar + 1) * 4) : nextFirst).bass], 33, 47);
          push("sousa", bar * 4 + 3, 0.9, nx + (nx > R ? -1 : 1), 0.7);
          last = R;
        }
        state.tubaLast = last;
      }

      // ---------- drums ----------
      const groove = {
        intro: { from: 0 }, A1: {}, A2: {}, A1h: { tamb: 1 }, A2h: { tamb: 1 }, B1: { tamb: 0.6, light: true }, B2: { tamb: 0.6, light: true },
        S1: { tamb: 0.8 }, S2: { tamb: 1 }, ST1: { off: true }, ST2: { from: 4, tamb: 1 }, drums: { tamb: 1, claps: 1 }, tuba: { tamb: 1, claps: 0.8 },
        shout1: { tamb: 1, claps: 0.7, ride4: true }, shout2: { tamb: 1, claps: 0.8, ride4: true }, F1: { tamb: 1, ride4: true }, F2: { tamb: 1, ride4: true },
      }[kind];
      let bdp = BD[(round + (kind === "drums" ? 1 : 0)) % BD.length];
      let snp = SN[(round * 2 + (/h$|^S|^shout/.test(kind) ? 1 : 0)) % SN.length];
      if (!groove.off) {
        for (let bar = groove.from ?? 0; bar < 8; bar++) {
          const half2 = bar % 2;
          if (kind === "drums" && bar === 4) { bdp = BD[(round + 2) % BD.length]; snp = SN[(round * 2 + 2) % SN.length]; } // the drummers trade figures
          const last = bar === 7;
          if (ending && last) { // the tag: a roll to the end, one crash
            for (let k2 = 0; k2 < 24; k2++) drum("snare", 28 + k2 / 8, "snare", 0.25 + k2 * 0.02, { straight: true });
            drum("bassdrum", 28, "kick", 1); drum("bassdrum", 28, "crash", 0.9);
            continue;
          }
          // bass drum and its cymbal
          for (let p = 0; p < 8; p++) {
            const c = bdp[half2 * 8 + p];
            const b = bar * 4 + p * E8;
            if (c === "X") drum("bassdrum", b, "kick", groove.light ? 0.72 : 0.9);
            else if (c === "x") drum("bassdrum", b, "kick", groove.light ? 0.5 : 0.66);
            if (p === 2 || p === 6) drum("bassdrum", b, "ride", groove.light ? 0.45 : 0.62);
            else if (groove.ride4 && (p === 0 || p === 4)) drum("bassdrum", b, "ride", 0.42);
          }
          if (bar === (groove.from ?? 0) && kind !== "drums" && kind !== "intro") drum("bassdrum", bar * 4, "crash", 0.6);
          // snare: the second-line pattern, press rolls into downbeats, a fill at the phrase end
          let sp = snp.slice(half2 * 8, half2 * 8 + 8);
          if (half2 === 1 && bar % 4 === 1 && r.chance(0.6)) sp = sp.slice(0, 6).concat([".", "a"]); // not every phrase ends in a roll
          if (last && kind !== "ST1" && (next.kind !== "ST1")) sp = FILL[(round + cycle) % FILL.length];
          if (kind === "intro" && bar === 0) sp = pat("rrrrrrrr");
          const prevRoll = state.snRoll;
          sp.forEach((c, p) => {
            const b = bar * 4 + p * E8;
            let ch = c;
            if (p === 0 && prevRoll && (ch === "g" || ch === ".")) ch = "A";
            if (ch === "A") drum("snare", b, "snare", groove.light ? 0.62 : 0.8);
            else if (ch === "a") drum("snare", b, "snare", 0.45);
            else if (ch === "g") drum("snare", b, "snare", groove.light ? 0.14 : 0.2);
            else if (ch === "r") {
              const base = kind === "intro" && bar === 0 ? 0.15 + p * 0.06 : 0.22 + (p / 8) * 0.25;
              for (let k2 = 0; k2 < 4; k2++) drum("snare", bar * 4 + p * E8 + k2 / 8, "snare", base + k2 * 0.03, { straight: true });
            }
          });
          state.snRoll = sp[7] === "r";
          // tambourine: eighths, slapped on 2 and 4
          if (groove.tamb) for (let p = 0; p < 8; p++) drum("tamb", bar * 4 + p * E8, "tambourine", (p === 2 || p === 6 ? 0.62 : p % 2 ? 0.26 : 0.36) * groove.tamb);
          // the crowd claps on 2 and 4
          if (groove.claps) { drum("claps", bar * 4 + 1, "clap", 0.6 * groove.claps); drum("claps", bar * 4 + 3, "clap", 0.66 * groove.claps); }
        }
      } else state.snRoll = false;
      // stop-time: the snare keeps a whisper of time under the sax
      if (kind === "ST1" || kind === "ST2") {
        for (let bar = 0; bar < stop; bar++) [1, 3].forEach((b) => drum("snare", bar * 4 + b, "snare", 0.12));
        if (kind === "ST2") for (let k2 = 0; k2 < 8; k2++) drum("snare", 14 + k2 / 4, "snare", 0.3 + k2 * 0.06, { straight: true }); // the roll that brings the band back
      }

      tidy();
      let section = NAME[kind];
      if (kind === "S1" || kind === "S2") section += trumpetSolo ? " · trumpet" : " · sax";
      if (kind === "B1" || kind === "B2") section = round % 2 === 1 ? "Bridge · minor blues, sax and trombones" : section;
      return { events: ev, harmony: prog, section, state };

      // ---- helpers that need this cycle's harmony ----
      /** Place a riff over chord c: semitone offsets from the root, snapped into the chord scale at each note. */
      function riff(track, notes, at, c, lo, hi, vel, chordal) {
        const base = T.nearest(Math.round((lo + hi) / 2) - 5, [c.root], lo - 6, hi);
        notes.forEach(([p, len, off]) => {
          const b = at + p * E8;
          if (b >= 32) return;
          const cs = T.chord(sym(b));
          let m = base + off;
          if (!cs.scale.includes(mod12(m)) && !cs.pcs.includes(mod12(m))) m = T.nearest(m, cs.pcs, lo - 6, hi + 2);
          const d = len * E8 * 0.85;
          if (chordal) {
            push(track, b, d, trio(m, cs.sym).concat([m]), vel + (p % 2 ? 0.05 : 0));
          } else push(track, b, d, m, vel + (p % 2 ? 0.05 : 0));
        });
      }
      /**
       * The band listens: a sax (or soloing trumpet) or section note that rubs a semitone against another
       * part's sustained note, without being a chord tone, moves to the nearest chord tone; a sousaphone
       * passing note that rubs is clipped short.
       */
      function tidy() {
        const abs = (e) => e.bar * BPB + e.beat;
        const pitched = ev.filter((e) => typeof e.note === "number" || Array.isArray(e.note));
        const movable = (e) => e.track === "sax" || e.track === "section" || e.track === "sousa" || (e.track === "trumpet" && trumpetSolo);
        const toneAt = (m, t) => { const c = T.chord(sym(t)); return c.pcs.includes(mod12(m)) || c.bass === mod12(m); };
        for (const e of pitched) {
          if (!movable(e)) continue;
          const a = abs(e);
          const ns = Array.isArray(e.note) ? e.note.slice() : [e.note];
          let changed = false;
          ns.forEach((m, i) => {
            for (const o of pitched) {
              if (o === e || o.track === e.track) continue;
              const oa = abs(o), t0 = Math.max(a, oa);
              if (Math.min(a + e.dur, oa + o.dur) - t0 < 0.25) continue;
              const rub = (Array.isArray(o.note) ? o.note : [o.note]).find((x) => Math.abs(x - ns[i]) % 12 === 1 && Math.abs(x - ns[i]) < 26);
              if (rub == null || (toneAt(ns[i], t0) && toneAt(rub, t0))) continue;
              if (e.track === "sousa") { e.dur = Math.min(e.dur, Math.max(0.2, t0 - a + 0.2)); return; }
              if (t0 > a + 0.2) { e.dur = Math.max(0.2, t0 - a - 0.05); return; } // let go at the change
              if (toneAt(ns[i], t0)) continue; // the other part is the passing note: leave it to them
              const c = T.chord(sym(a));
              let nm = T.nearest(ns[i], c.pcs);
              if (ns.includes(nm)) nm = T.nearest(ns[i] + (nm > ns[i] ? -2 : 2), c.pcs);
              ns[i] = nm; changed = true;
            }
          });
          if (changed) e.note = Array.isArray(e.note) ? [...new Set(ns)].sort((x, y) => x - y) : ns[0];
        }
      }
      /** Is a note on top of a trumpet note of the tune (same eighth, within a step)? Used to keep the obbligato clear. */
      function collides(n) { return ev.some((e) => e.track === "trumpet" && Math.abs(e.beat + e.bar * 4 - n.beat) < 0.3 && Math.abs(e.note - n.note) <= 2); }
    },
  });

  /**
   * The trumpet trio: the two chord tones directly under the lead, in close position (a 6th in the lead
   * over a major triad makes a 6th chord); a passing note in the lead gets diatonic thirds and fifths under it.
   */
  function trio(m, sym) {
    const c = T.chord(sym);
    const pcs = c.pcs.slice();
    const sixth = c.kind === "major" && mod12(m) === mod12(c.root + 9); // a 6th in the lead stacks a 6th chord
    if (!sixth && !pcs.includes(mod12(m))) return [T.step(m, -4, c.scale), T.step(m, -2, c.scale)];
    const out = [];
    for (let x = m - 2; x > m - 12 && out.length < 2; x--) if (pcs.includes(mod12(x)) && (out.length === 0 || out[out.length - 1] - x >= 2)) out.push(x);
    return out.reverse();
  }
  /** The second trombone in the bridge: a chord tone a sixth (or a tenth) under, never muddy. */
  function underBone(m, sym) {
    const c = T.chord(sym);
    for (const d of [8, 9, 7, 5, 4, 3]) { const x = m - d; if (c.pcs.includes(mod12(x)) && (x >= 52 || m - x >= 7)) return x; }
    return m - 12;
  }
  /** Chord scale with the blue third added over major and dominant chords. */
  function bluesy(sym) {
    const c = T.chord(sym);
    const sc = c.scale.slice();
    if (c.intervals.includes(4) && (c.kind === "dominant" || c.kind === "major" || c.kind === "major6")) sc.push(mod12(c.root + 3));
    return sc;
  }
})();
