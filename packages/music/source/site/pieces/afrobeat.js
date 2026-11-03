// Lagos Junction: Afrobeat in D dorian at 110 BPM, built the Africa 70 way: by accumulation.
//
// Rhythm section (16th-note grid, a slight 16th lilt):
//   kit      a Tony Allen groove: busy closed hats with open-hat lifts on the "&"s, a kick that avoids
//            the obvious (1, 2&, 3& and its displacements), backbeat snare buried in ghost strokes;
//   bell     the gankogui timeline x..x.x.x.x..x.x. (the 12/8 standard pattern squeezed into 16 pulses),
//            low bell on 1, never stops, not even in the breakdown;
//   perc     shekere on the offbeats, congas answering the snare (slaps on 2 and 4, open tones after);
//   guitars  two muted guitars that interlock: a rhythm guitar chanking two-shape chords on 16th
//            offbeats (left) and a tenor guitar picking a two-bar single-note ostinato (right);
//   bass     a one-chord riff, two bars long, that only changes when the harmony does;
//   organ    drawbar comping: short punches and long swells.
// Harmony is a vamp: Dm9 alone while the groove assembles, then Dm9 / G13 (the dorian i-IV) two bars
// each. The slam after the breakdown lands a whole step up (alternate rounds a minor third up), and
// an interlude pivots home through bVI-bVII of the new key and then bVI-bVII of D.
//
// Form (cycles of 8 bars, about 17 s each; round 1 = 13 cycles, about 3.8 min, later rounds 11):
//   groove assembles x3 (drums & bell -> bass -> guitars & congas -> organ) -> horn theme x2 ->
//   tenor solo x3 (low, climbing over horn pads, peak with stabs and honks) -> breakdown (drums &
//   bell) -> slam (up a step, shout chorus) -> horn theme in the new key -> interlude (the pivot home) ->
//   stripped vamp -> (organ re-enters, next round; odd rounds the organ takes the solo).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, Q = 0.25; // one 16th
  const NM = (pc) => T.NAMES[T.mod12(pc)];
  const xp = (sym, k) => { const m = /^([A-G][b#]?)(.*)$/.exec(sym); return NM(T.PC[m[1]] + k) + m[2]; };

  // ---------- harmony ----------
  const PROG = {
    A: (k) => `| ${xp("Dm9", k)} | % | % | % | % | % | % | % |`,
    B: (k) => `| ${xp("Dm9", k)} | % | ${xp("G13", k)} | % | ${xp("Dm9", k)} | % | ${xp("G13", k)} | % |`,
    // from the slam key k back to D: bVI maj9, bVII 9sus4 of the new key, then Bbmaj9#11, C13sus4 of D
    I: (k) => `| ${NM(2 + k + 8)}maj9 | % | ${NM(2 + k + 10)}9sus4 | % | Bbmaj9#11 | % | C13sus4 | % |`,
  };

  // ---------- patterns: 16 characters per bar ----------
  const pat = (s) => [...s.replace(/\s+/g, "")].map((c, i) => [i, c]).filter(([, c]) => c !== ".");
  const KICKS = [["x.....x...x.....", 4], ["x.....x....x....", 3], ["x..x..x...x.....", 2], ["x.....x.x...x...", 2], ["x.....x...x..x..", 1.5]];
  const BELL = pat("L..h.h.h.H..h.h.");
  const SHEKERE = pat("g.X.g.Xgg.X.g.Xg");
  const CONGA = { A: pat("m...s.oom...s.ob"), B: pat("m.m.s.o.m.mbs.oo"), C: pat("..m.s.oo..mbs.ob") };
  const HAND = { o: ["conga", 62, 0.5], s: ["conga", 67, 0.6], m: ["conga", 62, 0.16], b: ["congaLow", 55, 0.52] };
  const CHANK = [pat("..x..xx...x..x.x"), pat("..x..x.x..x..xx.")];

  // Notes as [16th position, midi (in D), 16ths].
  const N = (s) => s.trim().split(/\s+/).map((t) => { const [n, p, d] = t.split(/[@+]/); return [Number(p), T.midi(n), Number(d || 1)]; });
  // Tenor guitar: a two-bar ostinato per chord.
  const PICK = {
    D: [N("A4@0 C5@2 A4@3 G4@5 A4@6 D5@8 C5@10 A4@11 G4@13 F4@15"), N("A4@0 C5@2 D5@3 C5@5 A4@6 F4@8 G4@10 A4@11 C5@12 A4@14")],
    G: [N("B4@0 D5@2 B4@3 A4@5 B4@6 E5@8 D5@10 B4@11 A4@13 G4@15"), N("B4@0 D5@2 E5@3 D5@5 B4@6 G4@8 A4@10 B4@11 D5@12 B4@14")],
  };
  // Rhythm guitar shapes (two per chord, alternated by bar).
  const SHAPES = { D: [[60, 64, 69], [62, 65, 69]], G: [[59, 65, 69], [62, 65, 71]] };
  // Bass: the riff, bar 1 and bar 2 (its last 16th is an approach chosen from the next chord).
  const RIFF = {
    D: [N("D2@0+2 D2@3 F2@6 G2@8+2 A2@11 C3@12 A2@14+2"), N("D2@0+2 D3@3 C3@6 A2@8 G2@10+2 F2@13 G2@14")],
    G: [N("G2@0+2 G2@3 B2@6 D3@8+2 E3@11 F3@12 E3@14+2"), N("G2@0+2 G3@3 F3@6 D3@8 B2@10+2 A2@13 G2@14")],
  };
  const RIFF2 = { // a second riff for later rounds: busier, same skeleton
    D: [N("D2@0 D2@2 D3@3 D2@5 A2@6+2 C3@10 D3@11 A2@12+2 G2@14"), N("D2@0+2 F2@3 G2@6 A2@8 C3@9 A2@10+2 G2@13 F2@14")],
    G: [N("G2@0 G2@2 G3@3 G2@5 D3@6+2 F3@10 G3@11 D3@12+2 B2@14"), N("G2@0+2 B2@3 C3@6 D3@8 F3@9 D3@10+2 C3@13 B2@14")],
  };

  // Horn themes: [beat in bar, beats, midi in D (trumpet register)], 4 bars over Dm9 Dm9 G13 G13.
  const H = (rows) => rows.map((row) => row.trim().split(/\s+/).map((t) => { const [n, b, d] = t.split(/[@+]/); return [Number(b), Number(d), T.midi(n)]; }));
  const THEME = {
    a: H(["A4@0.5+0.5 C5@1+0.5 D5@1.5+1.25 C5@2.75+0.25 A4@3+0.5 G4@3.5+0.5", "A4@0+1.5 F4@2+0.5 G4@2.5+0.25 A4@2.75+1",
      "D5@0.5+0.5 D5@1.25+0.5 C5@1.75+0.25 D5@2+0.5 F5@2.5+0.5 E5@3+0.5 D5@3.5+0.5", "B4@0+1.75 D5@2.5+0.25 B4@2.75+0.25 A4@3+0.5 G4@3.5+0.5"]),
    b: H(["A4@0.5+0.5 C5@1+0.5 D5@1.5+1.25 C5@2.75+0.25 A4@3+0.5 G4@3.5+0.5", "A4@0+1.5 F4@2+0.5 G4@2.5+0.25 A4@2.75+1",
      "G5@0+0.5 F5@0.5+0.25 D5@0.75+0.75 E5@1.75+0.25 F5@2+1 D5@3.25+0.75", "B4@0+0.5 A4@0.75+0.25 G4@1+0.5 A4@1.5+0.5 D5@2+1.75"]),
    shout: H(["D5@0+0.25 D5@0.75+0.25 C5@1.5+0.5 D5@2+0.25 F5@2.5+0.5 D5@3.25+0.75", "C5@0+0.25 A4@0.25+0.25 C5@0.5+1 A4@2+0.25 G4@2.25+0.25 F4@2.5+0.25 G4@2.75+0.75",
      "D5@0+0.25 D5@0.75+0.25 E5@1.5+0.5 F5@2+0.25 G5@2.5+0.5 F5@3.25+0.75", "E5@0+1.5 D5@2+0.25 B4@2.25+0.25 D5@2.5+0.5 B4@3+0.75"]),
  };
  // Stab rhythms for one bar: [beat, beats].
  const STABS = [[[1.5, 0.25], [1.75, 0.5]], [[0.75, 0.25], [3, 0.5]], [[2.5, 0.25], [3.25, 0.5]], [[0, 0.25], [1.5, 0.5]], [[3, 0.25], [3.5, 0.4]]];
  const ORGAN = [[[[0, 6], [8, 1], [11, 3]], 3], [[[3, 1], [6, 6], [14, 2]], 2.5], [[[0, 15]], 1.5], [[[2, 1], [6, 1], [10, 4]], 2], [[[0, 2], [7, 7]], 2]];

  // ---------- form ----------
  const progFor = (id, round) => {
    const slamK = round % 2 === 1 ? 3 : 2;
    if (id === "IN") return PROG.I(slamK);
    if (["A1", "A2", "A3", "BR", "OUT"].includes(id)) return PROG.A(0);
    return PROG.B(id === "SL" || id === "SH" ? slamK : 0);
  };
  const R0 = ["A1", "A2", "A3", "H1", "H2", "S1", "S2", "S3", "BR", "SL", "SH", "IN", "OUT"];
  const RN = ["A3", "H1", "H2", "S1", "S2", "S3", "BR", "SL", "SH", "IN", "OUT"];
  const locate = (c) => (c < R0.length ? { round: 0, id: R0[c] } : { round: 1 + Math.floor((c - R0.length) / RN.length), id: RN[(c - R0.length) % RN.length] });

  Sim.register({
    id: "afrobeat",
    title: "Lagos Junction",
    genre: "Afrobeat",
    situations: ["party", "hangout"],
    energy: 0.8,
    about: "Afrobeat in D dorian that assembles itself part by part over a Tony Allen kit and a bell timeline: interlocking muted guitars, a one-chord bass riff, drawbar organ, unison horn themes and a long tenor solo, then a breakdown to drums and bell and a slam back a step higher.",
    bpm: 110, beatsPerBar: BPB, swing: 0.54, swingUnit: 0.25, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.012, lowcut: 300, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 400, highcut: 5500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.22, highcut: 2600 });

      const kit = I.kit(ctx, { volume: 1, kickNote: 34, preload: ["kick", "snare", "hatClosed", "hatOpen", "tom", "crash"] });
      const perc = I.kit(ctx, { volume: -2, preload: ["gankogui", "shekere", "conga", "congaLow"] });
      const bass = I.ebass(ctx, { volume: -3, base: 120 });
      const chank = I.guitar(ctx, { kind: "muted", volume: -9 });
      const pick = I.guitar(ctx, { kind: "muted", volume: -10, dampening: 2600 });
      const organ = I.organ(ctx, { volume: -12, partials: [1, 0.75, 0.5, 0.15, 0, 0.3, 0, 0.15] });
      const organLead = I.organ(ctx, { volume: -5, partials: [1, 0.9, 0.7, 0.25, 0.1, 0.4, 0, 0.3, 0.12] });
      const tp = I.brassStab(ctx, { volume: -8, base: 650 });
      const hsax = I.sax(ctx, { volume: -6, vibratoDepth: 0.02 });
      const tenor = I.sax(ctx, { volume: -1, vibrato: 5.1, vibratoDepth: 0.045, cutoff: 3000 });

      const kp = I.place(ctx, kit, 0, out), pp = I.place(ctx, perc, 0.25, out);
      I.place(ctx, bass, 0, out);
      const cp = I.place(ctx, chank, -0.5, out), gp = I.place(ctx, pick, 0.5, out);
      const op = I.place(ctx, organ, -0.2, out), olp = I.place(ctx, organLead, 0.1, out);
      const tpp = I.place(ctx, tp, 0.22, out), hsp = I.place(ctx, hsax, 0.12, out), tnp = I.place(ctx, tenor, -0.05, out);
      I.send(ctx, kp, room, -16); I.send(ctx, pp, room, -11); I.send(ctx, cp, room, -14); I.send(ctx, gp, room, -12);
      I.send(ctx, op, room, -10); I.send(ctx, olp, room, -10); I.send(ctx, tpp, hall, -12); I.send(ctx, hsp, hall, -13);
      I.send(ctx, tnp, hall, -14); I.send(ctx, tnp, echo, -22); I.send(ctx, bass.out, room, -26);

      const drum = (k) => (t, e) => k.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len });
      return {
        tenor: { layer: "melody", play: (t, e, d) => tenor.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        organLead: { layer: "melody", play: (t, e, d) => organLead.play(t, e.note, d, e.vel), humanize: { timing: 0.006 } },
        hornSax: { layer: "melody", play: (t, e, d) => hsax.play(t, e.note, d, e.vel), humanize: { timing: 0.006 } },
        trumpets: { layer: "melody", play: (t, e, d) => tp.play(t, e.note, d, e.vel), humanize: { timing: 0.005 } },
        stabs: { layer: "harmony", play: (t, e, d) => tp.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        organ: { layer: "harmony", play: (t, e, d) => organ.play(t, e.note, d, e.vel), humanize: { timing: 0.006 } },
        chank: { layer: "harmony", play: (t, e, d) => chank.play(t, e.note, d, e.vel, 0.006), humanize: { timing: 0.005, vel: 0.12 } },
        pick: { layer: "texture", play: (t, e, d) => pick.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.1 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        kit: { layer: "drums", play: drum(kit), humanize: { timing: 0.005, vel: 0.1 } },
        perc: { layer: "drums", play: drum(perc), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const { round, id } = locate(cycle);
      const odd = round % 2 === 1;
      const slamK = odd ? 3 : 2;
      const k = id === "SL" || id === "SH" ? slamK : 0; // transposition of this cycle's vamp
      const progText = progFor(id, round);
      const prog = T.progression(progText, BPB);
      const nextL = locate(cycle + 1), nextFirst = T.progression(progFor(nextL.id, nextL.round), BPB)[0].chord;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const fam = (b) => (T.chord(sym(b)).kind === "dominant" ? "G" : "D"); // which riff family
      const rel = (bar) => bar - chordAt(bar * BPB).bar; // bars since this chord began
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra }); };

      // ---------- what plays ----------
      const solo = id === "S1" || id === "S2" || id === "S3";
      const soloist = odd ? "organLead" : "tenor";
      const P = {
        bassFrom: id === "A1" ? 2 : 0,
        pickFrom: id === "A1" ? 4 : 0,
        chankFrom: id === "A1" ? 99 : 0,
        congaFrom: id === "A1" ? 99 : id === "A2" ? 4 : id === "BR" ? 4 : 0,
        shekFrom: id === "A1" ? 4 : 0,
        organ: !["A1", "A2", "BR"].includes(id) && !(solo && odd),
        pitched: id !== "BR",
      };

      // ---------- drums ----------
      const sectionEndFill = { A1: "short", A2: "short", A3: "long", H1: r.chance(0.5) ? "short" : null, H2: "long", S1: r.chance(0.4) ? "short" : null, S2: "short", S3: "long", BR: "big", SL: "short", SH: "long", IN: "long", OUT: "short" }[id];
      const crashAt0 = ["A3", "H1", "S1", "SL", "IN"].includes(id) && cycle > 0;
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        const last = bar === 7;
        let fill = last ? sectionEndFill : null;
        if (!fill && bar === 3 && ["H1", "S3", "SL", "SH"].includes(id) && r.chance(0.35)) fill = "tiny";
        let o;
        if (id === "BR") o = bar < 4 ? { kick: 0.7, hats: "sparse", snare: "rim", ghosts: 0.2, lvl: 0.85 } : { kick: 0.85, hats: bar < 6 ? "closed" : "open", snare: "full", ghosts: 0.25 + 0.15 * (bar - 4), lvl: 0.85 + 0.04 * (bar - 4) };
        else if (id === "A1") o = { kick: 1, hats: bar < 2 ? "closed" : "open", snare: bar < 2 ? "rim" : "full", ghosts: bar < 2 ? 0.25 : 0.5, lvl: 0.9 };
        else if (id === "OUT") o = { kick: 0.9, hats: "closed", snare: "full", ghosts: 0.45, lvl: 0.85 };
        else if (solo) o = { kick: 1, hats: id === "S3" ? "lift" : "open", snare: "full", ghosts: 0.45 + 0.15 * (id === "S3"), lvl: 0.92 + 0.04 * (id === "S3") };
        else if (id === "IN") o = { kick: 0.9, hats: "open", snare: "full", ghosts: 0.4, lvl: 0.95 };
        else o = { kick: 1, hats: ["SL", "SH"].includes(id) ? "lift" : "open", snare: "full", ghosts: 0.55, lvl: 1 };
        kitBar(push, B, r, { ...o, fill, crash: bar === 0 && crashAt0 });
        if (id === "BR" && bar === 0) push("kit", 0, 1, "crash", 0.5);

        // bell: always; it is the clock
        BELL.forEach(([p, c]) => push("perc", B + p * Q, 0.25, "gankogui", c === "L" ? 0.6 : c === "H" ? 0.5 : 0.4 + r.range(-0.04, 0.04), { pitch: c === "L" ? 77 : 84 }));
        // shekere
        if (bar >= P.shekFrom && !(id === "BR" && bar < 2)) SHEKERE.forEach(([p, c]) => { if (c === "g" && r.chance(0.35)) return; push("perc", B + p * Q, 0.25, "shekere", c === "X" ? 0.42 : 0.18); });
        // congas
        if (bar >= P.congaFrom) {
          const cp = id === "S3" || id === "SL" ? (bar % 2 ? CONGA.B : CONGA.C) : bar % 4 === 3 ? CONGA.B : CONGA.A;
          const fillFrom = fill === "long" || fill === "big" ? 8 : fill ? 12 : 16;
          cp.forEach(([p, c]) => { if (p >= fillFrom) return; const [v, pitch, vel] = HAND[c]; push("perc", B + p * Q, 0.25, v, vel + r.range(-0.05, 0.05), { pitch }); });
        }
      }

      // ---------- bass ----------
      if (P.pitched) {
        const riffs = round > 0 && (solo || id === "OUT") ? RIFF2 : RIFF;
        for (let bar = P.bassFrom; bar < 8; bar++) {
          const B = bar * BPB, s = sym(B), c = T.chord(s);
          if (id === "IN") { // generic riff on the chord root
            const root = T.nearest(36, [c.root], 34, 45);
            const cells = bar % 2 === 0 ? [[0, 0, 2], [3, 0, 1], [6, 7, 1], [8, 12, 2], [11, 14, 1], [12, 12, 1], [14, 7, 2]] : [[0, 0, 2], [3, 12, 1], [6, 10, 1], [8, 7, 2], [11, 5, 1], [12, 7, 1], [14, 12, 1]];
            cells.forEach(([p, iv, d]) => {
              let n = root + iv;
              if (!c.pcs.includes(T.mod12(n)) && !c.scale.includes(T.mod12(n))) n = T.nearest(n, c.pcs);
              push("bass", B + p * Q, d * Q * 0.85, n, p === 0 ? 0.9 : 0.72);
            });
            if (bar % 2 === 1) { const nx = T.chord(sym(B + 4)); push("bass", B + 15 * Q, Q * 0.8, T.nearest(T.nearest(40, [nx.root], 34, 45) - 1, c.scale, 33, 50), 0.6); }
            continue;
          }
          const f = fam(B), two = riffs[f];
          const second = rel(bar) % 2 === 1;
          let notes = two[second ? 1 : 0].map(([p, n, d]) => [p, n + k, d]); // riffs are written in D / G
          const endOfCycle = bar === 7, nextSym = endOfCycle ? nextFirst : sym(B + 4);
          if (second || endOfCycle) {
            // approach the next downbeat on the last 16th
            const nx = T.chord(nextSym), tgt = T.nearest(38 + k, [nx.root], 33, 47);
            let appr = r.chance(0.5) ? tgt - 1 : T.step(tgt, -1, c.scale);
            if (notes.length && notes[notes.length - 1][1] === appr) appr = tgt - 1;
            if (!(endOfCycle && ["H2", "S3", "BR", "IN"].includes(id))) notes.push([15, appr, 1]);
          }
          if (endOfCycle && ["A3", "H2", "S3", "SH"].includes(id)) {
            // a run down the mode into the next section
            const sc = c.scale; let n = T.nearest(50 + k, c.pcs, 45, 53);
            notes = notes.filter(([p]) => p < 8);
            for (let p = 8; p < 16; p++) { if (p % 2 === 1 && p < 14 && r.chance(0.3)) continue; notes.push([p, n, 1]); n = T.step(n, -1, sc); }
          }
          notes.forEach(([p, n, d]) => push("bass", B + p * Q, d * Q * (d > 1 ? 0.9 : 0.75), Math.max(31, Math.min(57, n)), p === 0 ? 0.92 : p % 4 === 0 ? 0.8 : 0.68 + r.range(-0.04, 0.04)));
        }
      }

      // ---------- guitars ----------
      if (P.pitched) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, s = sym(B), c = T.chord(s);
          const f = fam(B);
          // rhythm guitar
          if (bar >= P.chankFrom) {
            let shapes;
            if (id === "IN") { const v = T.voice(s, { lo: 57, hi: 72, n: 3, prev: state.chankV, rng: r }); state.chankV = v; shapes = [v, v]; }
            else shapes = SHAPES[f].map((v) => v.map((m) => m + k));
            const rh = CHANK[bar % 2];
            const thin = id === "OUT" && bar >= 6;
            rh.forEach(([p], i) => {
              if (thin && i % 2) return;
              const v = shapes[(i + bar) % 2];
              push("chank", B + p * Q, 0.16, v, (p === 2 || p === 10 ? 0.62 : 0.48) + r.range(-0.05, 0.05));
            });
          }
          // tenor guitar ostinato
          if (bar >= P.pickFrom) {
            let cell;
            if (id === "IN") {
              const tones = T.notesIn(c.pcs, 65, 79);
              const idx = [0, 2, 1, 3, 2, 4, 3, 2, 1, 3];
              cell = [0, 2, 3, 5, 6, 8, 10, 11, 13, 15].map((p, i) => [p, tones[Math.min(tones.length - 1, idx[i] + (bar % 2))], 1]);
            } else cell = PICK[f][rel(bar) % 2].map(([p, n, d]) => [p, n + k, d]);
            const sparse = id === "A1" && bar < 6;
            cell.forEach(([p, n], i) => {
              if (sparse && p % 4 !== 0 && i % 3 === 1) return;
              push("pick", B + p * Q, 0.22, n, (p % 4 === 0 ? 0.6 : 0.46) + r.range(-0.05, 0.05));
            });
          }
        }
      }

      // ---------- organ ----------
      if (P.organ) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, s = sym(B);
          const v = T.voice(s, { lo: 50, hi: 74, n: 4, prev: state.organV, top: Math.floor(bar / 2) % 2 ? [68, 74] : [62, 69], rng: r });
          state.organV = v;
          const held = solo || id === "IN" || id === "OUT";
          const pats = held ? [[[[0, 15]], 3], [[[0, 6], [7, 9]], 1.5], [[[2, 14]], 1]] : ORGAN;
          let pt = r.weighted(pats);
          if (id === "A3" && bar === 0) pt = [[0, 15]];
          pt.forEach(([p, d]) => push("organ", B + p * Q, d * Q * 0.95, v, (held ? 0.42 : 0.52) + r.range(-0.04, 0.04)));
        }
      }

      // ---------- horns ----------
      const theme = (name, startBar, harm) => {
        THEME[name].forEach((row, i) => row.forEach(([b, d, n]) => {
          const B = (startBar + i) * BPB + b, m = n + k;
          const vel = (d <= 0.25 ? 0.6 : 0.72) + r.range(-0.04, 0.04);
          push("trumpets", B, d * 0.92, harm ? [m, harmBelow(m, sym(B))] : m, vel);
          push("hornSax", B, d * 0.92, m - 12, vel);
        }));
      };
      const stab = (bar, which, vel = 0.62) => {
        const B = bar * BPB, s = sym(B);
        const v = T.voice(s, { lo: 62, hi: 79, n: 3, rootless: false, prev: state.stabV, top: [72, 79] });
        state.stabV = v;
        (which ?? r.pick(STABS)).forEach(([b, d]) => push("stabs", B + b, d, v, vel + r.range(-0.04, 0.04)));
      };
      if (id === "A3") { stab(6, STABS[0], 0.5); stab(7, STABS[2], 0.58); }
      if (id === "H1") { theme("a", 0, false); theme("b", 4, false); }
      if (id === "H2") { theme("a", 0, round > 0); theme("b", 4, true); }
      if (id === "S2") for (let bar = 4; bar < 8; bar += 2) { // horn pads behind the solo
        const B = bar * BPB, v = T.voice(sym(B), { lo: 60, hi: 76, n: 2, prev: state.padV, top: [69, 76] });
        state.padV = v;
        push("stabs", B, 6.5, v, 0.38);
        push("hornSax", B + 0.5, 6, v[0] - 12, 0.32);
      }
      if (id === "S3") for (let bar = 0; bar < 8; bar++) if (bar % 2 === 1 || bar >= 6) stab(bar);
      if (id === "SL") { theme("shout", 0, false); theme("shout", 4, true); }
      if (id === "SH") { theme("b", 0, true); theme("a", 4, true); }
      if (id === "IN") { // a long lyrical line over the pivot chords, the tenor sax a third below
        const m = C.line({ start: 0, end: 31, chordAt: sym, lo: 67, hi: 82, rng: r.fork(900 + round), density: 0.22, phrase: [5, 8], rest: [1, 2], motif: state.inMotif, motifProb: 0.7, chromatic: 0.05, register: 0.6, upbeatStart: 0.6 });
        state.inMotif = m.motif;
        m.notes.forEach((n) => {
          const d = Math.max(0.45, n.dur), vel = 0.6 + (n.strong ? 0.06 : 0);
          push("trumpets", n.beat, d, n.note, vel);
          push("hornSax", n.beat, d, harmBelow(n.note, sym(n.beat)) - 12, vel * 0.92);
        });
      }

      // ---------- solo ----------
      if (solo) {
        const i = ["S1", "S2", "S3"].indexOf(id);
        const sc = (s) => T.chord(s).scale;
        const lo = soloist === "tenor" ? 55 : 62, hi = soloist === "tenor" ? 80 : 86;
        const end = i === 2 ? 19.5 : 31;
        const m = C.line({ start: 0, end, chordAt: sym, lo, hi, rng: r.fork(70 + cycle), density: [0.3, 0.45, 0.6][i], phrase: [3, 7], rest: [[1.5, 3], [1, 2], [0.5, 1.5]][i], motif: state.soloMotif, motifProb: 0.45, chromatic: 0.15 + 0.08 * i, register: 0.32 + 0.16 * i, prev: state.soloLast, upbeatStart: 0.55, lead: i === 0 ? 1 : 0, scaleFor: sc });
        state.soloMotif = m.motif; state.soloLast = m.last;
        m.notes.forEach((n) => {
          const v = 0.62 + (n.vel - 0.6) * 1.1 + 0.04 * i;
          // a 16th-note turn on some weak eighths
          if (!n.strong && n.dur >= 0.45 && n.dur <= 0.55 && r.chance(0.12 + 0.08 * i)) {
            const nb = T.step(n.note, r.chance(0.5) ? 1 : -1, sc(sym(n.beat)));
            push(soloist, n.beat, 0.22, n.note, v); push(soloist, n.beat + 0.25, 0.22, nb, v * 0.9);
          } else push(soloist, n.beat, n.dur, n.note, v);
        });
        if (i === 2) { // the peak: a riff hammered three times, then the scream
          for (let bar = 5; bar < 8; bar++) {
            const B = bar * BPB, c = T.chord(sym(B)), s = c.scale;
            const top = T.nearest(hi - 5 + (bar === 7 ? 3 : 0), c.guide.concat(c.colors), lo, hi);
            const lower = T.step(top, -2, s), upper = T.step(top, 1, s);
            if (soloist === "organLead") { // chordal: right-hand clusters hammered on 16ths
              const v = T.voice(sym(B), { lo: 66, hi: 86, n: 3, rootless: false, top: [top - 1, top + 1] });
              [0, 0.75, 1.5, 2, 2.75].forEach((b, j) => push("organLead", B + b, bar === 7 && j === 4 ? 1.1 : 0.3, v, 0.66 + 0.03 * j));
              continue;
            }
            if (bar < 7) {
              [[0, 0.5, top], [0.75, 0.25, lower], [1, 0.75, top], [2, 0.25, upper], [2.25, 0.25, top], [2.5, 1, lower]].forEach(([b, d, n]) => push("tenor", B + b, d, n, 0.74 + (b === 0 ? 0.06 : 0)));
            } else {
              [[0, 0.25, lower], [0.25, 0.25, top], [0.5, 0.25, upper], [0.75, 1.75, T.step(upper, 1, s)]].forEach(([b, d, n]) => push("tenor", B + b, d, n, 0.8));
            }
          }
        }
      }

      const LABEL = {
        A1: "The groove assembles · drums & bell, bass, tenor guitar", A2: "The groove assembles · rhythm guitar & congas",
        A3: round ? "Organ · the vamp again" : "The groove assembles · organ", H1: "Horns · the theme", H2: "Horns · the theme in harmony",
        S1: `${odd ? "Organ" : "Tenor"} solo · low`, S2: `${odd ? "Organ" : "Tenor"} solo · climbing, horn pads`, S3: `${odd ? "Organ" : "Tenor"} solo · peak, horn stabs`,
        BR: "Breakdown · drums & bell", SL: `Slam · up ${slamK === 2 ? "a step" : "a minor third"}, shout chorus`, SH: "Horns · the theme in the new key",
        IN: "Interlude · the long way home", OUT: "Vamp · guitars & drums",
      };
      return { events: ev, harmony: prog, section: LABEL[id], state };
    },
  });

  /** A diatonic third (or fourth) below `m` that belongs to the chord, for horn harmony. */
  function harmBelow(m, sym) {
    const c = T.chord(sym);
    for (const d of [3, 4, 5]) if (c.pcs.includes(T.mod12(m - d))) return m - d;
    return T.step(m, -2, c.scale);
  }

  /** One bar of kit. o: { kick, hats: closed|open|lift|sparse, snare: full|rim, ghosts, lvl, fill, crash } */
  function kitBar(push, B, r, o) {
    const L = o.lvl ?? 1;
    const fillFrom = o.fill === "big" ? 8 : o.fill === "long" ? 8 : o.fill === "short" ? 12 : o.fill === "tiny" ? 14 : 16;
    const hit = (p, voice, vel, extra) => push("kit", B + p * 0.25, 0.25, voice, vel * L, extra);
    // kick
    const kp = pat(r.weighted(KICKS));
    kp.forEach(([p]) => { if (p < fillFrom || p === 0) hit(p, "kick", (p === 0 ? 0.85 : 0.68) * o.kick); });
    if (r.chance(0.25) && fillFrom > 15) hit(15, "kick", 0.4 * o.kick);
    if (o.crash) hit(0, "crash", 0.62);
    // hats
    const opens = new Set();
    if (o.hats === "open" && r.chance(0.7)) opens.add(14);
    if (o.hats === "lift") { opens.add(6); opens.add(14); if (r.chance(0.3)) opens.add(10); }
    for (let p = 0; p < Math.min(16, fillFrom); p++) {
      if (o.hats === "sparse" && p % 2) continue;
      if (opens.has(p)) { hit(p, "hatOpen", 0.36, { len: 0.2 }); continue; }
      if (opens.has(p - 1) && r.chance(0.6)) continue;
      const v = p % 4 === 0 ? 0.5 : p % 2 === 0 ? 0.42 : 0.24;
      if (p % 2 === 1 && r.chance(0.12)) continue;
      hit(p, "hatClosed", v + r.range(-0.04, 0.04));
    }
    // snare
    const acc = [4, 12];
    const late = o.snare !== "rim" && r.chance(0.15) && fillFrom > 15; // a displaced backbeat on the "a" of 4
    if (o.snare === "rim") acc.forEach((p) => hit(p, "rim", 0.45));
    else {
      acc.forEach((p) => { if (p < fillFrom && !(late && p === 12)) hit(p, "snare", 0.7); });
      if (late) hit(15, "snare", 0.62);
    }
    [1, 3, 6, 7, 9, 11, 13, 14, 15].forEach((p) => { if (p < fillFrom && !(late && p === 15) && r.chance(o.ghosts * (p % 2 ? 0.6 : 0.4))) hit(p, "snare", 0.1 + r.range(0, 0.08)); });
    // fills
    if (fillFrom < 16) {
      const seqs = {
        tiny: [["snare", 0.42], ["snare", 0.56]],
        short: [["snare", 0.4], ["snare", 0.46], ["tom", 0.55, 50], ["snare", 0.5], ["tom", 0.6, 45], ["tom", 0.58, 45], ["snare", 0.7], ["kick", 0.6]].slice(0, 4),
        long: [["snare", 0.32], ["snare", 0.22], ["snare", 0.42], ["tom", 0.5, 52], ["snare", 0.48], ["tom", 0.55, 52], ["tom", 0.56, 47], ["snare", 0.6]],
        big: [["snare", 0.3], ["snare", 0.36], ["snare", 0.42], ["snare", 0.48], ["tom", 0.55, 52], ["tom", 0.58, 52], ["tom", 0.62, 47], ["tom", 0.64, 47]],
      }[o.fill];
      seqs.forEach(([v, vel, pitch], i) => hit(fillFrom + i, v, vel, pitch ? { pitch } : undefined));
      if (o.fill === "big" || o.fill === "long") hit(15, "kick", 0.55);
    }
  }
})();
