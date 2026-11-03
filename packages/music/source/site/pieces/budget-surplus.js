// Budget Surplus: a sunny, slightly wistful bossa nova in A for a city whose books finally balanced.
// AABA, 32 bars, in 4/4 at 126 counting eighths (one 4/4 bar here = one 2/4 bar of the Brazilian
// notation, so the batida's sixteenths are our eighths). Nylon guitar plays a real batida from fixed,
// playable grips (written as fret strings so a guitarist can read them); the thumb keeps 1 and 3,
// root then fifth. An upright doubles that pulse an octave down, the way US bossa sessions did, which
// lets the synthesized guitar stay light. Flute states a tune composed once (by hand) and recalled
// with small variations; alternate choruses go to muted trumpet, then vibes, which improvise over the
// changes and bring the tune back on the last A. Every third block is a quiet vamp interlude.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const M = T.midi;

  // ---------- harmony ----------
  // The A section's bass walks down the low E string: A G F# F E (I, bVII, vi, subV/V, V).
  const FORM = {
    A1: "| Amaj9 | Gmaj9#11 | F#m9 | F13#11 | E9sus4 | E7b9 | C#m9 Cdim7 | Bm9 E13 |",
    A2: "| Amaj9 | Gmaj9#11 | F#m9 | F13#11 | E9sus4 | E7b9 | Amaj9 | Em9 A13 |",
    // bridge: IV, minor iv and ii-V into bIII, up a half step into a minor ii-V of ii, iv to iii, turnaround
    B: "| Dmaj9 | Dm9 G13 | Cmaj9 | C#m7b5 F#7b9 | Bm9 | Dm6 | C#m9 F#7b9 | Bm9 E7b9 |",
    A3: "| Amaj9 | Gmaj9#11 | F#m9 | F13#11 | E9sus4 | E7b9 | Amaj9 Cdim7 | Bm9 E13sus4 |",
    // intro and interlude vamp: I to bVII, IV to minor iv, ii-V
    V: "| Amaj9 | Gmaj9#11 | Amaj9 | Gmaj9#11 | Dmaj9 | Dm6 | Bm9 | E13sus4 E7b9 |",
  };
  const ORDER = ["A1", "A2", "B", "A3"];
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));

  // ---------- guitar grips: low E string first, x = muted; alt = the thumb's beat-3 note ----------
  const OPEN = [40, 45, 50, 55, 59, 64];
  const GRIP_SRC = {
    "Amaj9": ["x02424", "E2"], "Gmaj9#11": ["3x4425", null], "F#m9": ["2x2222", "C#3"], "F13#11": ["1x1233", null],
    "E9sus4": ["0x0202", "B2"], "E7b9": ["0x0101", "B2"], "E13": ["0x0122", "B2"], "E13sus4": ["0x0222", "B2"],
    "C#m9": ["x42444", null], "Cdim7": ["x31212", null], "Bm9": ["x20222", "F#2"], "Em9": ["0x2032", "B2"],
    "A13": ["x02022", "E2"], "Dmaj9": ["x54220", "A2"], "Dm9": ["x53210", "A2"], "G13": ["3x345x", "D3"],
    "Cmaj9": ["x32433", "G2"], "C#m7b5": ["x4x453", null], "F#7b9": ["2x2323", "C#3"], "Dm6": ["xx0201", "A2"],
  };
  const GRIPS = {};
  for (const [sym, [frets, alt]] of Object.entries(GRIP_SRC)) {
    const ns = [];
    [...frets].forEach((f, i) => { if (f !== "x") ns.push(OPEN[i] + Number(f)); });
    GRIPS[sym] = { bass: ns[0], fingers: ns.slice(1), alt: alt ? M(alt) : ns[0] };
  }

  // ---------- the tune: [beat, dur, note] within the 8-bar section (negative = pickup) ----------
  const HEAD_A = [ // bars 1-6, shared by every A
    [0.5, 0.5, "B4"], [1, 0.5, "C#5"], [1.5, 1, "E5"], [2.5, 1, "C#5"], [3.5, 2.5, "C#5"], // 3rd becomes #11
    [6, 0.5, "B4"], [6.5, 1, "A4"],
    [8.5, 0.5, "G#4"], [9, 0.5, "A4"], [9.5, 1, "C#5"], [10.5, 1, "A4"], [11.5, 2.5, "A4"], // b3 becomes 3rd
    [14.5, 0.5, "B4"], [15, 0.5, "D5"], [15.5, 2.5, "F#5"],
    [18, 0.5, "E5"], [18.5, 1, "D5"], [19.5, 2.5, "F5"], // 9 sinks to b9
  ];
  const END = {
    A1: [[22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "B4"], [23.5, 2.5, "E5"], [26, 1.5, "Eb5"], [27.5, 2.5, "D5"], [30, 1.5, "C#5"]], // chromatic guide line
    A2: [[22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "B4"], [23.5, 3, "C#5"], [26.5, 0.5, "B4"], [27, 0.5, "C#5"], [27.5, 2, "F#5"], [29.5, 0.5, "G5"], [30, 1, "F#5"]],
    A3: [[22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "B4"], [23.5, 2.5, "C#5"], [26.5, 0.5, "A4"], [27, 0.5, "C5"], [27.5, 2, "D5"], [29.5, 2, "C#5"]],
  };
  const HEAD_B = [ // rises through maj9 arpeggios, then reharmonizes the A section's bar-6 sigh over Dm6
    [-0.5, 1.5, "E5"], [1, 0.5, "F#5"], [1.5, 1, "A5"], [2.5, 1.5, "C#6"], [4, 1.5, "C6"], [5.5, 2, "A5"],
    [7.5, 1.5, "D5"], [9, 0.5, "E5"], [9.5, 1, "G5"], [10.5, 2.5, "B5"], [13, 0.5, "A5"], [13.5, 1.5, "G5"], [15, 0.5, "E5"],
    [15.5, 1.5, "D5"], [17, 0.5, "E5"], [17.5, 2, "F#5"], [19.5, 2.5, "F5"], [22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 0.5, "B4"],
    [23.5, 2.5, "E5"], [26, 0.5, "C#5"], [26.5, 1, "A#4"], [27.5, 1.5, "D5"], [29, 0.5, "C#5"], [29.5, 1, "B4"], [30.5, 1, "G#4"],
  ];
  const VAMP_CALL = [[16.5, 0.5, "E5"], [17, 0.5, "F#5"], [17.5, 1, "A5"], [18.5, 1, "F#5"], [19.5, 2.5, "F5"], [22, 0.5, "E5"], [22.5, 0.5, "D5"], [23, 2, "B4"]];
  const toNotes = (xs) => xs.map(([beat, dur, n]) => ({ beat, dur, note: M(n), vel: 0.56 + Math.min(0.12, dur * 0.04) }));
  const tune = (name) => name === "B" ? toNotes(HEAD_B) : toNotes(HEAD_A.concat(END[name]));

  // ---------- batida: finger strokes over two bars (beats 0-8) ----------
  const BATIDA = {
    clave: [0, 1.5, 3, 5, 6.5],                  // the bossa clave itself
    classic: [0, 1.5, 3, 4.5, 6],                // "1, and-of-2, 4 | and-of-1, 3"
    joao: [0, 1, 2.5, 3.5, 4.5, 5, 6, 7],        // tamborim-derived, busier, for the solo choruses
    sparse: [0, 1.5, 4.5, 6.5],                  // intro and interlude
  };
  const SHAKER = [0.34, 0.17, 0.27, 0.22, 0.31, 0.17, 0.27, 0.25]; // eighths, push on the "a"
  const CLAVE = [[0, 1.5, 3], [1, 2.5]];

  /** Which block a cycle belongs to. Cycle 0 is the intro; then [head chorus, solo chorus, interlude] repeating. */
  function plan(cycle) {
    if (cycle === 0) return { kind: "intro", name: "V", round: 0 };
    const k = cycle - 1, p = k % 9, round = Math.floor(k / 9);
    if (p < 4) return { kind: "head", name: ORDER[p], round, chorus: round * 2 + 1 };
    if (p < 8) return { kind: "solo", name: ORDER[p - 4], round, chorus: round * 2 + 2, soloist: round % 2 === 0 ? "trumpet" : "vibes" };
    return { kind: "interlude", name: "V", round };
  }

  Sim.register({
    id: "budget-surplus",
    title: "Budget Surplus",
    genre: "Bossa nova",
    about: "AABA bossa in A: nylon-guitar batida on real grips, a flute tune that returns on every A, muted trumpet and vibes taking alternate choruses, shaker and cross-stick clave.",
    bpm: 126, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 3.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.9, preDelay: 0.015, lowcut: 220, highcut: 7500 });
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.035, lowcut: 380, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "4n.", feedback: 0.22, highcut: 2800 });
      const gtr = I.nylon(ctx, { volume: -5, cutoff: 3600, dampening: 3400, voices: 12 });
      const thumb = I.nylon(ctx, { volume: -6, cutoff: 1800, dampening: 2200, resonance: 0.95, voices: 3 });
      const flute = I.flute(ctx, { volume: -1, vibratoDepth: 0.05, vibrato: 4.8, attack: 0.07 });
      const tpt = I.mutedTrumpet(ctx, { volume: -2, cutoff: 2200 });
      const vibes = I.vibes(ctx, { volume: -4, decay: 2.6, motor: 4.2, motorDepth: 0.22 });
      const bass = I.upright(ctx, { volume: -5, base: 140 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 33, preload: ["shaker", "rim", "softKick", "hatPedal", "conga", "congaLow", "brushSweep", "brushTap"] });
      const gp = I.place(ctx, gtr, -0.22, out), tp = I.place(ctx, thumb, -0.14, out);
      const fp = I.place(ctx, flute, 0.12, out), mp = I.place(ctx, tpt, 0.18, out), vp = I.place(ctx, vibes, 0.3, out);
      I.place(ctx, bass, 0, out); const kp = I.place(ctx, kit, 0.08, out);
      I.send(ctx, gp, room, -11); I.send(ctx, tp, room, -16);
      I.send(ctx, fp, hall, -11); I.send(ctx, fp, echo, -24);
      I.send(ctx, mp, room, -10); I.send(ctx, mp, hall, -18);
      I.send(ctx, vp, room, -10); I.send(ctx, vp, hall, -16);
      I.send(ctx, kp, room, -15); I.send(ctx, bass.out, room, -26);
      return {
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        trumpet: { layer: "melody", play: (t, e, d) => tpt.play(t, e.note, d, e.vel), humanize: { timing: 0.014, vel: 0.06 } },
        vibes: { layer: "melody", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
        guitar: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, e.strum ?? 0.01), humanize: { timing: 0.008, vel: 0.08 } },
        thumb: { layer: "harmony", play: (t, e, d) => thumb.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        glow: { layer: "texture", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.02 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep, pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = plan(cycle), next = plan(cycle + 1);
      const prog = PROG[P.name], nextProg = PROG[next.name];
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const round = P.round, vamp = P.kind === "intro" || P.kind === "interlude";

      // ================= melody =================
      if (P.kind === "head") {
        // first statement is exactly as written; returns vary a little more each round
        const amt = P.name === "A1" && round === 0 ? 0 : Math.min(0.5, 0.14 + 0.12 * round + (P.name === "A3" ? 0.06 : 0));
        const notes = vary(tune(P.name), r.fork(7), amt, sym, cycle > 0);
        const lift = P.name === "B" ? 0.05 : 0;
        notes.forEach((n) => push("flute", n.beat, n.dur * 0.96, n.note, n.vel + lift, { delay: 0.012 }));
      } else if (P.kind === "solo") {
        const inst = P.soloist;
        const [lo, hi] = inst === "trumpet" ? [67, 82] : [67, 86];
        if (P.name !== "B") { // A sections: paraphrase the tune's long tones with new connecting figures; the last A comes home
          const notes = P.name === "A3" ? vary(tune("A3"), r.fork(11), 0.6, sym, true) : paraphrase(tune(P.name), r.fork(12), sym, lo, hi, P.name === "A1" ? 0.55 : 0.8);
          notes.forEach((n) => push(inst, n.beat, inst === "vibes" ? Math.max(0.6, n.dur) : n.dur * 0.94, n.note, n.vel * (inst === "vibes" ? 0.95 : 0.9), { delay: 0.015 }));
        } else { // the bridge is where the soloist really leaves the tune
          // improvise; the head's opening rhythm is offered as the motif so the solo talks about the tune
          const motif = state.soloMotif || { len: 6, rhythm: [{ off: 0.5, dur: 0.5 }, { off: 1, dur: 0.5 }, { off: 1.5, dur: 1 }, { off: 2.5, dur: 1 }, { off: 3.5, dur: 2.5 }], steps: [0, 1.25, 1.9, -1.9, 0] };
          const dens = 0.4;
          const m = C.line({ start: 0, end: 30.5, chordAt: sym, lo, hi, rng: r.fork(13), density: dens, phrase: [4, 8], rest: [1, 3], motif, motifProb: 0.5, chromatic: 0.15, register: 0.6, prev: state.soloLast, lead: r.pick([0.5, 1, 1.5]), upbeatStart: 0.6 });
          state.soloMotif = m.motif; state.soloLast = m.last;
          // lengthen phrase-final notes: bossa phrasing leans on held tones
          m.notes.forEach((n, i) => {
            const nx = m.notes[i + 1];
            const gap = nx ? nx.beat - (n.beat + n.dur) : 2;
            const dur = gap >= 0.75 ? n.dur + Math.min(1, gap - 0.25) : n.dur;
            push(inst, n.beat, inst === "vibes" ? Math.max(0.6, dur) : dur, n.note, 0.5 + (n.vel - 0.6) * 1.2 + (n.strong ? 0.04 : 0), { delay: 0.015 });
          });
        }
      } else if (P.kind === "interlude") { // a quiet call from the bridge, alternating voices
        const who = round % 2 === 0 ? "flute" : "vibes";
        toNotes(VAMP_CALL).forEach((n) => push(who, n.beat, who === "vibes" ? Math.max(0.6, n.dur) : n.dur * 0.95, n.note, n.vel * 0.85, { delay: 0.015 }));
      }

      // ================= guitar =================
      // one batida per section (a guitarist keeps it steady), varied only at the phrase end
      let pat;
      if (vamp) pat = "sparse";
      else if (P.kind === "solo") pat = r.weighted([["joao", 3], ["clave", 1]]);
      else pat = r.weighted([["clave", 3], ["classic", 2]]);
      const starts = new Set(prog.map((c) => c.bar * 4 + c.beat));
      const chordEnd = 32;
      const strokes = [];
      for (let two = 0; two < 4; two++) {
        let ps = BATIDA[pat];
        if (vamp && cycle === 0 && two === 0) ps = [0, 4.5]; // the very first bars: almost nothing
        else if (two === 3 && r.chance(0.45)) ps = BATIDA[r.pick(Object.keys(BATIDA).filter((k) => k !== pat && k !== "joao"))];
        ps.forEach((p) => strokes.push(two * 8 + p));
      }
      // every chord gets a stroke at (or an eighth before) its arrival
      for (const s of starts) {
        if (s === 0) continue;
        if (!strokes.some((x) => x >= s - 0.5 - 1e-6 && x <= s + 0.5 + 1e-6)) strokes.push(r.chance(0.65) ? s - 0.5 : s);
      }
      // comp with the tune: where the melody anticipates a chord with a long note, so does the guitar
      const mel = ev.filter((e) => e.track !== "glow").map((e) => ({ at: e.bar * 4 + e.beat, dur: e.dur }));
      for (const s of starts) {
        if (s > 0 && mel.some((m) => Math.abs(m.at - (s - 0.5)) < 1e-6 && m.dur >= 1.3)) strokes.push(s - 0.5);
      }
      // anticipate the next section's first chord on the last "and" (always under the bridge's pickup)
      const nextFirst = nextProg[0].chord;
      if (r.chance(vamp ? 0.4 : 0.6) || (next.kind === "head" && next.name === "B")) strokes.push(31.5);
      if (state.antNext) strokes.splice(0, strokes.length, ...strokes.filter((x) => x !== 0)); // tied over from last cycle
      strokes.sort((a, b) => a - b);
      let uniq = strokes.filter((x, i) => i === 0 || x - strokes[i - 1] > 1e-6);
      const isAnt = (x) => Math.abs(x - Math.round(x)) > 1e-6 && (starts.has(x + 0.5) || x + 0.5 === 32);
      uniq = uniq.filter((x) => !uniq.some((y) => isAnt(y) && Math.abs(y + 0.5 - x) < 1e-6)); // an anticipation ties over its downbeat
      state.antNext = uniq.includes(31.5);
      uniq.forEach((x, i) => {
        if (x >= chordEnd) return;
        const offbeat = Math.abs(x - Math.round(x)) > 1e-6;
        const ant = isAnt(x);
        const s = x + 0.5 === 32 && ant ? nextFirst : ant ? sym(x + 0.5) : sym(x);
        const g = GRIPS[s];
        let notes = g.fingers.slice();
        const nextX = uniq[i + 1] ?? 32.5;
        // weak strokes sometimes drop the lowest finger, for lightness
        if (offbeat && !ant && notes.length > 3 && r.chance(0.3)) notes = notes.slice(1);
        const dur = Math.max(0.3, Math.min(ant ? 1.6 : vamp ? 2 : 1.25, nextX - x - 0.06));
        const beatInBar = x % 4;
        const vel = (ant ? 0.56 : beatInBar === 0 ? 0.5 : 0.44) + r.range(-0.03, 0.04) + (P.kind === "solo" ? 0.03 : 0) - (vamp ? 0.04 : 0);
        push("guitar", x, dur, notes, vel, { strum: ant ? 0.014 : offbeat ? 0.007 : 0.011 });
      });
      // thumb: 1 and 3, root then fifth (or the next chord's root)
      for (let bar = 0; bar < 8; bar++) {
        for (const b of [0, 2]) {
          const at = bar * 4 + b, s = sym(at), g = GRIPS[s];
          const fresh = starts.has(at) || at === 0;
          const n = fresh ? g.bass : g.alt;
          push("thumb", at, 1.8, n, b === 0 ? 0.62 : 0.54);
        }
      }

      // ================= upright: root and fifth under the thumb, an octave down, with the dotted bossa pickups =================
      const low = (m) => (m - 12 < 28 ? m : m - 12);
      const uprightAt = (at) => {
        const s = sym(at), c = T.chord(s), root = low(GRIPS[s].bass);
        if (starts.has(at) || at % 32 === 0) return root;
        return c.intervals.includes(7) ? T.nearest(root - 5, [T.mod12(c.root + 7)], 28, 45) : root; // the fifth, usually just below
      };
      for (let bar = 0; bar < 8; bar++) {
        if (cycle === 0 && bar < 4) continue;
        if (P.kind === "interlude" && bar < 4) continue;
        for (const b of [0, 2]) {
          const at = bar * 4 + b, n = uprightAt(at);
          push("bass", at, 1.45, n, b === 0 ? 0.74 : 0.64);
          if (!vamp && b === 0 && r.chance(0.28)) push("bass", at + 1.5, 0.4, uprightAt(at + 2), 0.46); // dotted pickup into beat 3
          if (!vamp && b === 2 && bar < 7 && r.chance(0.18)) { // chromatic approach into the next bar
            const tgt = uprightAt(at + 2);
            const ap = tgt - 1 < 28 || r.chance(0.5) ? tgt + 1 : tgt - 1;
            if (ap !== n) push("bass", at + 1.5, 0.4, ap, 0.45);
          }
        }
      }

      // ================= glow: soft, high vibes guide tones on later heads and interludes =================
      if ((P.kind === "head" && round >= 1 && P.name === "A3") || (P.kind === "interlude" && round % 2 === 0)) {
        prog.forEach((c) => { // a halo above the tune, not inside it; in the interlude it clears the way for the call
          if (P.kind === "interlude" && c.bar >= 4) return;
          const v = T.voice(c.chord, { lo: 80, hi: 89, n: 2, prev: state.glow, top: [84, 88] });
          state.glow = v;
          push("glow", c.bar * 4 + c.beat, Math.min(c.dur, 3.5), v, 0.18, { delay: 0.03 });
        });
      }

      // ================= percussion =================
      const mode = (round % 3);
      const useBrush = P.kind === "head" && mode === 1 && P.name !== "B";
      const kickOn = !vamp && !(P.kind === "head" && round === 0 && P.name === "A1");
      const congaOn = P.kind === "solo" || (mode === 2 && P.kind === "head");
      const swell = (bar) => 0.9 + 0.12 * Math.sin((bar + 1) / 8 * Math.PI);
      for (let bar = 0; bar < 8; bar++) {
        const B0 = bar * 4;
        const intro = cycle === 0;
        if (intro && bar < 4) continue;
        const sw = swell(bar);
        // shaker or brushed eighths
        for (let i = 0; i < 8; i++) {
          const v = SHAKER[i] * sw * (vamp ? 0.8 : 1);
          if (useBrush) {
            if (i % 4 === 0) push("drums", B0 + i / 2, 0.8, "brushSweep", 0.26, { sweep: 0.75 });
            push("drums", B0 + i / 2, 0.1, "brushTap", v * 0.8);
          } else push("drums", B0 + i / 2, 0.1, "shaker", v);
        }
        // cross-stick bossa clave, two-bar
        if (!(intro && bar < 6)) CLAVE[bar % 2].forEach((p) => push("drums", B0 + p, 0.1, "rim", (vamp ? 0.24 : 0.32) + (p === 0 ? 0.04 : 0)));
        if (kickOn) {
          [[0, 0.46], [1.5, 0.22], [2, 0.36], [3.5, 0.2]].forEach(([p, v]) => push("drums", B0 + p, 0.1, "softKick", v));
          push("drums", B0 + 1, 0.1, "hatPedal", 0.3); push("drums", B0 + 3, 0.1, "hatPedal", 0.34);
        }
        if (congaOn && bar % 2 === 1) {
          push("drums", B0 + 1.5, 0.1, "conga", 0.2, { pitch: 64 });
          push("drums", B0 + 3, 0.1, "congaLow", 0.28, { pitch: 57 });
          push("drums", B0 + 3.5, 0.1, "congaLow", 0.22, { pitch: 57 });
        } else if (congaOn && r.chance(0.3)) push("drums", B0 + 2.5, 0.1, "conga", 0.16, { pitch: 64 });
      }
      // form marks, sparing: a little conga figure out of the bridge, a rim pickup out of the chorus
      if (P.name === "B" && r.chance(0.6)) [[30.5, 64, 0.22], [31, 64, 0.28], [31.5, 57, 0.32]].forEach(([p, pitch, v]) => push("drums", p, 0.1, pitch > 60 ? "conga" : "congaLow", v, { pitch }));
      if (P.name === "A3" && r.chance(0.5)) push("drums", 31.5, 0.1, "rim", 0.36);

      const label = P.kind === "intro" ? "Intro · guitar alone"
        : P.kind === "interlude" ? "Interlude · vamp"
          : `Chorus ${P.chorus} · ${P.name === "B" ? "bridge" : P.name} · ${P.kind === "head" ? "flute" : P.soloist === "trumpet" ? "muted trumpet" : "vibes"}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });

  /**
   * A soloist's paraphrase: keep the tune's long tones (its skeleton), sometimes nudged an eighth
   * early or late, and replace what lies between them with new figures that run or arpeggiate into
   * the next long tone. `freedom` 0..1 is how much of the original connective tissue is replaced.
   */
  function paraphrase(notes, r, sym, lo, hi, freedom) {
    const sc = (b) => T.chord(sym(Math.max(0, b))).scale;
    const skel = notes.filter((n) => n.dur >= 1.5).map((n) => ({ ...n }));
    const out = [];
    let prevEnd = 0, prevNote = skel.length ? skel[0].note : 72;
    skel.forEach((k, i) => {
      const fits = (b) => sc(b).includes(T.mod12(k.note));
      if (r.chance(0.25) && k.beat - 0.5 >= prevEnd + 0.5 && fits(k.beat - 0.5)) { k.beat -= 0.5; k.dur += 0.5; }
      else if (r.chance(0.2) && fits(k.beat + 0.5)) { k.beat += 0.5; k.dur -= 0.5; }
      const gapStart = prevEnd, gapEnd = k.beat;
      const orig = notes.filter((n) => n.dur < 1.5 && n.beat >= gapStart - 1e-6 && n.beat + n.dur <= gapEnd + 1e-6);
      if (!r.chance(freedom) && orig.length) orig.forEach((n) => out.push({ ...n }));
      else if (gapEnd - gapStart >= 1) {
        const room = Math.floor((gapEnd - gapStart) * 2) / 2;
        const len = Math.min(room, r.pick([1, 1.5, 2, 2, 2.5, 3]));
        const cnt = Math.round(len * 2);
        const mode = r.chance(0.6) ? "run" : "arp";
        const fig = [];
        let cur = k.note;
        for (let j = 0; j < cnt; j++) { // build backwards from the target
          const at = gapEnd - 0.5 * (j + 1), scale = sc(at);
          if (j === 0) cur = r.chance(0.6) ? T.step(k.note, 1, scale) : k.note - 1;
          else if (mode === "run") cur = T.step(cur, k.note > prevNote ? -1 : 1, scale);
          else cur = T.step(cur, k.note > prevNote ? -1 : 1, T.chord(sym(at)).pcs);
          if (cur > hi || cur < lo) cur = T.step(fig.length ? fig[0].note : k.note, cur > hi ? -2 : 2, scale); // fold back, staying in the scale
          fig.unshift({ beat: at, dur: 0.5, note: cur, vel: 0.5 + 0.04 * (cnt - j) / cnt });
        }
        fig[fig.length - 1].dur = 0.45;
        fig.forEach((n) => out.push(n));
      }
      out.push(k);
      prevEnd = k.beat + k.dur; prevNote = k.note;
      if (i === skel.length - 1) notes.filter((n) => n.beat >= prevEnd - 1e-6).forEach((n) => out.push({ ...n }));
    });
    return out.sort((a, b) => a.beat - b.beat);
  }

  /**
   * Recall a melody with small, idiomatic changes: anticipate a downbeat, lay a long note back a
   * sixteenth, slip a neighbour into a repeated note, approach a long note from a step away.
   */
  function vary(notes, r, amt, sym, allowPickup) {
    if (!amt) return notes.slice();
    const sc = (b) => T.chord(sym(Math.max(0, b))).scale;
    const out = [];
    notes.forEach((n0, i) => {
      const n = { ...n0 };
      const prev = out[out.length - 1];
      const prevEnd = prev ? prev.beat + prev.dur : -Infinity;
      const onBeat = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
      if (onBeat && n.dur >= 1 && n.beat - prevEnd >= 0.5 && (n.beat > 0 || allowPickup) && sc(n.beat - 0.5).includes(T.mod12(n.note)) && r.chance(amt * 0.45)) { n.beat -= 0.5; n.dur += 0.5; }
      else if (n.dur >= 1.5 && r.chance(amt * 0.3)) { n.beat += 0.25; n.dur -= 0.25; }
      if (i > 0 && notes[i - 1].note === n.note && n.dur <= 1 && r.chance(amt * 0.5)) n.note = T.step(n.note, 1, sc(n.beat));
      if (n.dur >= 2 && n.beat - prevEnd >= 0.5 && n.beat - 0.5 >= 0 && r.chance(amt * 0.35)) {
        const up = r.chance(0.6);
        out.push({ beat: n.beat - 0.5, dur: 0.45, note: up ? T.step(n.note, 1, sc(n.beat)) : n.note - 1, vel: n.vel * 0.85 });
      }
      if (n.dur >= 2.5 && r.chance(amt * 0.3)) { // a lazy turn at the tail of a long note
        out.push({ ...n, dur: n.dur - 1 });
        out.push({ beat: n.beat + n.dur - 1, dur: 0.5, note: T.step(n.note, -1, sc(n.beat + n.dur - 1)), vel: n.vel * 0.8 });
        out.push({ beat: n.beat + n.dur - 0.5, dur: 0.5, note: n.note, vel: n.vel * 0.85 });
        return;
      }
      out.push(n);
    });
    return out;
  }
})();
