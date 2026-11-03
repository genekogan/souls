// Riverboat: New Orleans trad jazz on a paddle steamer. Bb major, 130 bpm, a flat-four two-beat feel (swing 0.6).
//
// A six-piece saloon band: cornet (lead), clarinet (obbligato above), trombone (tailgate: smears into chord tones
// on the "and of 4", answers, one half-chorus of its own), tenor banjo four to the bar, tuba in two, brushes with
// the snare on 2 and 4 and a woodblock for the stop-time. The tune is never played by one instrument alone:
// collective counterpoint in chorus 1, a clarinet chorus with the cornet and trombone answering in the rests
// (Sim.dialogue.respond), a stop-time chorus where the front line hockets the tune note by note over band hits
// on 1 (Sim.dialogue.distribute "hocket"), a trombone half-chorus with a smeared break that pivots the band up a
// fourth, and an out-chorus in Eb with everyone, then a two-bar "ba-da-DUM" tag. The generator chooses who starts
// each phrase, the hocket pattern, the answerers, the smears, banjo accents and drum fills; the tune and the
// obbligato never change.
//
// THE TUNE (fixed by hand; beats from the start of the 16-bar strain; the cornet's line, concert pitch)
//   | Bb6 | Bb6 | Bb7 | Eb6 Edim7 | Bb/F G7 | C7 F7 | Bb6 Ebm6 | F7 (break) |
//   | Bb6 | D7 | Gm | G7 | C7 | F7 | Bb6 G7 | C7 F7 |            (out-chorus: | Bb6 Ebm6 | Bb/F F7 |, up a fourth)
//     bar 1  F4 Bb4 D5 . F5 D5          the steamboat whistle: up the chord, a bounce to F5 on the "and of 3"
//     bar 2  Bb4 . C5 D5 C5 Bb4 G4      settles, turns around the 9th
//     bar 3  Ab4 F4 Ab4 Bb4 C5 D5       the blue 7th over Bb7, climbing to
//     bar 4  Eb5 Bb4 . .                the IV, then two beats of air over the #ivdim7 (the clarinet fills, or an answer)
//     bar 5  D5 F5 D5 B4 D5 F5          the leading tone of G7 in the tune
//     bar 6  E5 C5 Eb5 C5 A4            II7 and V7 by their thirds and sevenths
//     bar 7  Bb4 D5 Gb5 Eb5 C5          the minor-iv blue note, Gb
//     bar 8  A4 . C5 F5 Eb5 C5 A4       the break: the band hits 1 and stops, the lead alone
//     bar 9  Bb4 D5 F5 G5 F5 D5         the whistle again, a sixth higher
//     bar 10 F#5 D5 C5 A4 F#4 A4        III7: the F# surprise
//     bar 11 Bb4 D5 G5 F5 D5            vi
//     bar 12 B4 D5 F5 . .               VI7 by its third; two beats of air
//     bar 13 C5 E5 G5 E5 C5 Bb4         II7 arpeggiated
//     bar 14 A4 F5 Eb5 C5 A4 G4         V7
//     bar 15 Bb4 D5 B4 D5               I VI7
//     bar 16 E5 G5 E5 . .               II7, two beats of air over V7 (a fill, a roll, or the band turns around)
//   THE OBBLIGATO (clarinet, fixed): a second line above the tune, moving when the tune holds and holding when
//   it moves, in thirds and sixths at the cadences, running the holes (bars 4, 12, 16); it rests in the break.
//   TAG (2 bars, in the out-key): | I VI7 | II7:1 V7:1 I:2 |  cornet F5 G5 F5 D5 B4 D5 F5 | E5 G5 Eb5 C5 D5 —
//   the band hits 1, 2 and 3 of the last bar under the chromatic E Eb D.
//   One lap: intro 2 · chorus 1 (ensemble) 16 · chorus 2 (clarinet, answered) 16 · chorus 3 (stop-time hocket 8 +
//   trombone 8, pivot break) 16 · out-chorus in Eb 16 · tag 2 = 68 bars ≈ 2:05.
(function () {
  "use strict";
  const T = Sim.theory, D = Sim.dialogue;
  const { mod12 } = T;
  const BPB = 4, CB = 2;
  const N = (s) => T.midi(s);

  // ---------- notation: phrases of "Note at dur, ..." (at in beats from the section start) ----------
  function line(phraseTexts, k = 0) {
    const out = [];
    phraseTexts.forEach((txt, pi) => {
      if (!txt) return;
      txt.split(",").forEach((tok) => { const [n, b, d] = tok.trim().split(/\s+/); out.push({ at: +b, dur: +d, note: N(n) + k, phrase: pi }); });
    });
    return out;
  }
  const tsym = (sym, k) => (k ? sym.replace(/[A-G](?:#|b)?/g, (n) => T.NAMES[mod12(T.PC[n] + k)]) : sym);
  const up = (xs, k) => (k ? xs.map((n) => ({ ...n, note: n.note + k })) : xs);
  const tr = (xs, track) => xs.map((n) => ({ ...n, track }));
  const vel = (xs, v) => xs.map((n) => ({ ...n, vel: n.vel ?? v }));

  // ---------- the score (Bb; the out-chorus and tag are transposed up a fourth) ----------
  const HEAD_A = "| Bb6 | Bb6 | Bb7 | Eb6 Edim7 | Bb/F G7 | C7 F7 | Bb6 Ebm6 | F7 | Bb6 | D7 | Gm | G7 | C7 | F7 |";
  const CH = {
    intro: "| Bb6 | F7 |",
    head: HEAD_A + " Bb6 G7 | C7 F7 |",
    pivot: HEAD_A + " Bb6 G7 | Bb7 |", // the trombone's break on V7 of the new key
    out: HEAD_A + " Bb6 Ebm6 | Bb/F F7 |",
    tag: "| Bb6 G7 | C7:1 F7:1 Bb6:2 |",
  };
  const P0 = "F4 0 .5, Bb4 .5 .5, D5 1 1.5, F5 2.5 1, D5 3.5 .5, Bb4 4 1.5, C5 5.5 .5, D5 6 .5, C5 6.5 .5, Bb4 7 .5, G4 7.5 .5, Ab4 8 1, F4 9 .5, Ab4 9.5 1, Bb4 10.5 .5, C5 11 .5, D5 11.5 .5, Eb5 12 1.5, Bb4 13.5 .5";
  const P1 = "D5 16 1, F5 17 .5, D5 17.5 .5, B4 18 1, D5 19 .5, F5 19.5 .5, E5 20 1.5, C5 21.5 .5, Eb5 22 1, C5 23 .5, A4 23.5 .5, Bb4 24 1.5, D5 25.5 .5, Gb5 26 1, Eb5 27 .5, C5 27.5 .5, A4 28 1.5, C5 29.5 .5, F5 30 .5, Eb5 30.5 .5, C5 31 .5, A4 31.5 .5";
  const P2 = "Bb4 32 .5, D5 32.5 .5, F5 33 1.5, G5 34.5 .5, F5 35 .5, D5 35.5 .5, F#5 36 1.5, D5 37.5 .5, C5 38 .5, A4 38.5 .5, F#4 39 .5, A4 39.5 .5, Bb4 40 1.5, D5 41.5 .5, G5 42 1, F5 43 .5, D5 43.5 .5, B4 44 1, D5 45 .5, F5 45.5 .5";
  const P3A = "C5 48 1, E5 49 .5, G5 49.5 1, E5 50.5 .5, C5 51 .5, Bb4 51.5 .5, A4 52 1, F5 53 .5, Eb5 53.5 .5, C5 54 1, A4 55 .5, G4 55.5 .5, Bb4 56 1.5, D5 57.5 .5, ";
  const TUNE = line([P0, P1, P2, P3A + "B4 58 1, D5 59 1, E5 60 1, G5 61 .5, E5 61.5 .5"]);
  const TUNE_OUT = line([P0, P1, P2, P3A + "Gb5 58 1, Eb5 59 .5, C5 59.5 .5, D5 60 1, Bb4 61 1, A4 62 .5, C5 62.5 .5, Eb5 63 .5, F5 63.5 .5"]);
  const O0 = "F5 1 .5, G5 1.5 .5, F5 2 .5, Bb5 2.5 1, F5 3.5 .5, D5 4 .5, F5 4.5 .5, G5 5 .5, F5 5.5 .5, G5 6 1.5, F5 7.5 .5, F5 8 1, D5 9 .5, F5 9.5 1, Ab5 10.5 1, F5 11.5 .5, G5 12 .5, Bb5 12.5 .5, G5 13 .5, Eb5 13.5 .5, E5 14 .5, G5 14.5 .5, Bb5 15 .5, G5 15.5 .5";
  const O1 = "F5 16 .5, Bb5 16.5 .5, D6 17 1, F5 18 1, G5 19 1, G5 20 .5, Bb5 20.5 .5, G5 21 1, A5 22 .5, G5 22.5 .5, F5 23 .5, Eb5 23.5 .5, D5 24 .5, F5 24.5 .5, Bb5 25 1, Bb5 26 1, Gb5 27 .5, Eb5 27.5 .5";
  const O2 = "D6 33 1, Bb5 34 1, G5 35.5 .5, A5 36 1, C6 37 .5, A5 37.5 .5, F#5 38 1, D5 39 .5, C5 39.5 .5, D5 40 .5, G5 40.5 .5, Bb5 41 1, D6 42 1, Bb5 43 .5, G5 43.5 .5, F5 44 1, G5 45 .5, B5 45.5 .5, D6 46 .5, B5 46.5 .5, G5 47 .5, F5 47.5 .5";
  const O3A = "E5 48 .5, G5 48.5 .5, Bb5 49 1, C6 50 .5, Bb5 50.5 .5, G5 51 .5, E5 51.5 .5, C6 52 1, A5 53 .5, C6 53.5 .5, A5 54 1, F5 55 .5, Eb5 55.5 .5, D5 56 .5, F5 56.5 .5, Bb5 57 1, ";
  const OBB = line([O0, O1, O2, O3A + "F5 58 1, G5 59 .5, F5 59.5 .5, G5 60 .5, Bb5 60.5 .5, C6 61 .5, Bb5 61.5 .5, A5 62 .5, G5 62.5 .5, F5 63 .5, Eb5 63.5 .5"]);
  const OBB_OUT = line([O0, O1, O2, O3A + "Bb5 58 1, Gb5 59 .5, Eb5 59.5 .5, F5 60 2, C6 62 .5, A5 62.5 .5, G5 63 .5, A5 63.5 .5"]);
  // the trombone's break on Bb7 (bar 16 of chorus 3): a tailgate climb into the new key
  const TBONE_BREAK = line(["F3 60 1, Ab3 61 .5, Bb3 61.5 .5, D4 62 1, F4 63 1"]).map((n, i) => ({ ...n, from: [4, 0, 0, 3, 6][i], slide: [0.5, 0, 0, 0.4, 0.7][i] }));
  const TAG_TUNE = line(["F5 0 .5, G5 .5 .5, F5 1 .5, D5 1.5 .5, B4 2 1, D5 3 .5, F5 3.5 .5", "E5 4 .5, G5 4.5 .5, Eb5 5 .5, C5 5.5 .5, D5 6 1.5"]);
  const TAG_OBB = line(["D6 0 1, Bb5 1 .5, F5 1.5 .5, F5 2 1, G5 3 .5, B5 3.5 .5", "C6 4 .5, Bb5 4.5 .5, A5 5 .5, G5 5.5 .5, F5 6 1.5"]);
  const TAG_TBONE = line(["Bb3 0 1, B3 2 1.5", "C3 4 .8, F2 5 .8, Bb2 6 2"]).map((n, i) => ({ ...n, from: [4, 3, 0, 0, 5][i], slide: 0.4 }));

  const LAP = [
    { id: "intro", bars: 2 },
    { id: "head", bars: 16, how: "ensemble" },
    { id: "head", bars: 16, how: "clarinet" },
    { id: "head", bars: 16, how: "stop" },
    { id: "head", bars: 16, how: "out", key: 5 },
    { id: "tag", bars: 2, key: 5 },
  ];
  const LAP_BARS = LAP.reduce((a, s) => a + s.bars, 0), LAP_CYCLES = LAP_BARS / CB;
  function locate(cycle) {
    const lap = Math.floor(cycle / LAP_CYCLES);
    let bar = (cycle % LAP_CYCLES) * CB, i = 0;
    while (bar >= LAP[i].bars) { bar -= LAP[i].bars; i++; }
    return { lap, i, f: LAP[i], off: bar };
  }
  const chordText = (f) => (f.id === "intro" ? CH.intro : f.id === "tag" ? CH.tag : f.how === "stop" ? CH.pivot : f.how === "out" ? CH.out : CH.head);
  const isBreak = (f, bar) => f.id === "head" && (bar === 7 || (f.how === "stop" && bar === 15));
  const isStop = (f, bar) => f.id === "head" && f.how === "stop" && bar < 8;

  const RANGE = { cornet: [60, 84], clarinet: [58, 92], trombone: [40, 70] };
  const withBar = (n) => { const bar = Math.floor(n.at / BPB + 1e-9); return { ...n, bar, beat: +(n.at - bar * BPB).toFixed(4) }; };
  const endOf = (n) => n.at + n.dur;
  /** Drop candidates that rub (semitone or minor ninth, overlapping a quarter beat or more) against, or double, any note of `against`. */
  function unrubbed(cands, against, chordAt) {
    const comp = (n) => { if (!chordAt) return true; const c = T.chord(chordAt(n.at).chord), pc = mod12(n.note); return c.pcs.includes(pc) || !c.pcs.some((p) => Math.abs(mod12(pc - p) - 6) === 5); };
    return cands.filter((c) => comp(c) && !against.some((a) => a.track !== c.track && Math.max(a.at, c.at) < Math.min(endOf(a), endOf(c)) - 0.25 && (Math.abs(a.note - c.note) % 12 === 1 || a.note === c.note)));
  }
  /** Trombone tailgate: on a chord change, a slide up into a chord tone (root, fifth or third), arriving on the beat or anticipating it. */
  function smears(prog, bars, density, r, mem, o = {}) {
    const out = [];
    let prev = mem.v ?? 55, lastSym = null;
    for (const h of prog) {
      if (h.bar < bars[0] || h.bar >= bars[1] || (o.skip && o.skip.includes(h.bar))) continue;
      const s = h.bar * BPB + h.beat, same = h.chord === lastSym;
      lastSym = h.chord;
      if (s < 1 || !r.chance(same ? density * 0.4 : density)) continue;
      const c = T.chord(h.chord);
      const fifth = c.intervals.find((i) => i === 7 || i === 6 || i === 8) ?? 7;
      const pc = r.weighted([[c.bass, 3], [mod12(c.root + fifth), 2.2], [mod12(c.root + (c.intervals.includes(3) ? 3 : 4)), 1.2]]);
      const m = T.nearest(prev + r.int(-4, 4), [pc], 46, 65);
      prev = m;
      const early = r.chance(0.5) ? 0.5 : 0; // anticipate on the "and of 4" or arrive on the beat and slide in
      const hold = Math.min(h.dur - 0.5, r.pick([1, 1, 1.5]));
      out.push({ at: s - early, dur: early + hold, note: m, vel: o.vel ?? 0.58, track: "trombone", from: r.int(3, 6), slide: early ? 0.5 : 0.3, fall: !early && r.chance(0.25) });
    }
    mem.v = prev;
    return out;
  }

  /** Everything hand-written (and the trombone's smears) for one section of one lap, routed to tracks. */
  function planSection(f, lap, r) {
    const k = f.key || 0;
    const prog = T.progression(chordText(f), BPB).map((h) => ({ ...h, chord: tsym(h.chord, k) }));
    const chordAt = T.chordAtFactory(prog, BPB);
    const scaleAt = (b) => T.chord(chordAt(Math.max(0, b)).chord).scale;
    const L = lap % 3;
    const tb = { v: 55 };
    let notes = [], label = "";
    if (f.id === "intro") {
      const who = ["cornet", "clarinet", "trombone"][L];
      notes.push({ at: 4, dur: 2.6, note: N(who === "trombone" ? "F4" : "F5"), vel: 0.7, track: who, scoop: who === "trombone" ? 0 : 2, from: who === "trombone" ? 7 : 0, slide: 1, shake: 1 });
      label = `the whistle (${who})`;
    } else if (f.how === "ensemble") {
      notes.push(...tr(vel(TUNE, 0.78), "cornet"));
      notes.push(...tr(vel(L === 1 ? OBB.filter((n) => n.at >= 16) : OBB, 0.58), "clarinet"));
      notes.push(...unrubbed(smears(prog, [0, 16], L === 0 ? 0.45 : 0.6, r, tb, { skip: [7] }), notes));
      label = `chorus 1 · the tune: cornet lead, clarinet ${L === 1 ? "in from bar 5" : "above"}, trombone tailgate`;
    } else if (f.how === "clarinet") {
      notes.push(...tr(vel(up(TUNE, 12), 0.72), "clarinet"));
      const who = [["cornet", "cornet", "cornet"], ["cornet", "trombone", "trombone"], ["trombone", "cornet", "trombone"]][L];
      const pick = (i) => who[i === 0 ? 0 : i - 1]; // phrases 0, 2 and 3 have a rest after them
      const TF = [{ tail: 4, even: 0.5 }, { tail: 4, even: 0.5, steps: -2 }, { tail: 4, even: 0.5, invert: true }, { tail: 4, even: 0.5, retrograde: true }];
      const ans = D.respond(TUNE, { track: pick, transform: (i) => TF[(i + lap) % 4], range: (i) => (pick(i) === "cornet" ? [62, 80] : [46, 65]), minGap: 1.5, end: 64, breath: 0.25, scaleAt, vel: 0.6 });
      notes.push(...unrubbed(ans.map((n) => ({ ...n, vel: n.track === "trombone" ? 0.6 : 0.62, from: n.track === "trombone" && n.dur >= 0.5 ? 3 : 0, slide: 0.3 })), notes, chordAt));
      if (L > 0) notes.push(...unrubbed(tr(vel(up(OBB.filter((n) => n.at >= 32 && n.at < 62 && !(n.at >= 46 && n.at < 48)), -12), 0.44), "cornet"), notes));
      notes.push(...unrubbed(smears(prog, [0, 16], 0.3, r, tb, { skip: [7], vel: 0.52 }), notes));
      label = `chorus 2 · clarinet up top, answered by ${[...new Set(who)].join(" and ")}${L > 0 ? ", the cornet under the second half" : ""}`;
    } else if (f.how === "stop") {
      const first = TUNE.filter((n) => n.at < 32), second = TUNE.filter((n) => n.at >= 32 && n.at < 60);
      const V = { cornet: { track: "cornet", range: RANGE.cornet }, clarinet: { track: "clarinet", range: RANGE.clarinet }, trombone: { track: "trombone", range: [52, 82], octaves: false } };
      const hock = L === 0 ? { voices: [V.cornet, V.clarinet], group: 1 } : L === 1 ? { voices: [V.cornet, V.clarinet, V.trombone], group: 1 } : { voices: [V.clarinet, V.cornet], group: 2 };
      notes.push(...D.distribute(vel(first, 0.74), { ...hock, mode: "hocket", rotate: true, rng: r }).map((n) => (n.track === "trombone" && n.note > 70 ? { ...n, note: n.note - 12 } : n)));
      if (L !== 1) { // the trombone smears into each band hit
        let prev = 50;
        for (let b = 0; b < 8; b++) {
          const c = T.chord(chordAt(b * BPB).chord);
          prev = T.nearest(prev + r.int(-3, 3), [r.chance(0.65) ? c.bass : mod12(c.root + 7)], 46, 60);
          notes.push({ at: b * BPB, dur: r.pick([1, 1.3]), note: prev, vel: 0.62, track: "trombone", from: r.int(4, 7), slide: 0.35 });
        }
      }
      // the trombone half-chorus: the tune down an octave with scoops, then its own break into the new key
      notes.push(...tr(vel(up(second, -12), 0.7), "trombone").map((n) => (n.dur >= 1 && r.chance(0.6) ? { ...n, from: 3, slide: 0.35 } : n)));
      notes.push(...tr(vel(TBONE_BREAK, 0.74), "trombone"));
      if (L !== 1) { // a soft two-horn background ("doo-wah" on the and of 2) behind the trombone
        const bg = [];
        let pc = 72;
        for (const h of prog) {
          if (h.bar < 8 || h.bar > 14) continue;
          const s = h.bar * BPB + h.beat, c = T.chord(h.chord), at = s + (h.dur >= 4 ? 1.5 : 0.5), dur = Math.min(1.4, h.dur - (at - s) - 0.1);
          pc = T.nearest(pc + r.int(-2, 2), c.pcs.filter((p) => p !== c.root || c.pcs.length < 3), 67, 77);
          const above = T.nearest(pc + 5, c.pcs.filter((p) => p !== mod12(pc)), pc + 3, pc + 9);
          if (L === 0) bg.push({ at, dur, note: pc, vel: 0.36, track: "cornet" });
          bg.push({ at, dur, note: above, vel: 0.34, track: "clarinet" });
        }
        notes.push(...unrubbed(bg, notes, chordAt));
      }
      label = `chorus 3 · stop-time: ${hock.voices.map((v) => v.track).join("/")} hocket the tune${hock.group > 1 ? " two notes at a time" : ""} · then the trombone, and its break up a fourth`;
    } else if (f.how === "out") {
      notes.push(...tr(vel(up(TUNE_OUT, 5), 0.82), "cornet"));
      notes.push(...tr(vel(up(OBB_OUT, 5), 0.62), "clarinet"));
      const ans = D.respond(up(TUNE_OUT, 5), { track: "trombone", transform: (i) => (i === 0 ? { tail: 4, even: 0.5 } : { tail: 4, even: 0.5, steps: -2 }), range: [46, 65], minGap: 1.5, end: 64, breath: 0.25, scaleAt, vel: 0.6 });
      notes.push(...unrubbed(ans.map((n, i) => ({ ...n, from: i === 0 ? 4 : 0, slide: 0.3 })), notes, chordAt));
      notes.push(...unrubbed(smears(prog, [0, 16], 0.7, r, tb, { skip: [7], vel: 0.62 }), notes));
      label = "out-chorus in Eb · everyone: cornet lead, clarinet above, trombone smearing and answering";
    } else {
      notes.push(...tr(vel(up(TAG_TUNE, 5), 0.8), "cornet"), ...tr(vel(up(TAG_OBB, 5), 0.62), "clarinet"), ...tr(vel(up(TAG_TBONE, 5), 0.66), "trombone"));
      notes = notes.map((n) => (n.at >= 6 ? { ...n, shake: 1 } : n));
      label = "tag · ba-da-DUM";
    }
    // a monophonic player cannot hold two notes: keep the first of any overlapping pair on the same track
    const kept = [];
    for (const n of notes.sort((a, b) => a.at - b.at)) {
      if (kept.some((m) => m.track === n.track && n.at < endOf(m) - 0.1 && n.at > m.at - 1e-6)) continue;
      kept.push(n);
    }
    return { prog, notes: kept.map(withBar), label };
  }

  // ---------- drums ----------
  const FILLS = [
    [[3, "brushSweep", 0.4, { len: 0.45 }], [3.25, "snare", 0.16, { straight: true }], [3.5, "snare", 0.22, { straight: true }], [3.75, "snare", 0.3, { straight: true }]],
    [[2.5, "snare", 0.34], [3, "snare", 0.38], [3.5, "tom", 0.5, { pitch: 50 }], [3.75, "tom", 0.56, { pitch: 45, straight: true }]],
    [[2, "woodblock", 0.4], [2.5, "woodblock", 0.34], [3, "woodblock", 0.46], [3.5, "snare", 0.36]],
    [[3, "rim", 0.42], [3.5, "rim", 0.46], [3.75, "snare", 0.3, { straight: true }]],
    [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75].map((b, i) => [b, "snare", 0.12 + i * 0.035, { straight: true }]), // the long press roll
  ];

  Sim.register({
    id: "riverboat",
    title: "Riverboat",
    genre: "Trad jazz",
    about: "New Orleans trad jazz on a paddle steamer: a hand-written 16-bar strain in Bb (I VI7 II7 V7 turnarounds, a IV #ivdim7 move, a minor-iv blue note, a stop-time break) that is never played by one instrument alone. Cornet lead with a half-valve bend, a clarinet obbligato written as a second line, a tailgate trombone smearing into chord tones on the and of 4, tenor banjo four to the bar, tuba in two, brushes. One lap: the ensemble chorus, a clarinet chorus answered in the rests, a stop-time chorus hocketed note by note, a trombone half-chorus whose break lifts the band up a fourth, the out-chorus in Eb and a two-bar tag. Built on Sim.dialogue.",
    situations: ["celebrate", "hangout", "party"],
    energy: 0.65,
    bpm: 130, beatsPerBar: BPB, swing: 0.6, cycleBars: CB, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hz = T.hz, spb = 60 / ctx.bpm;
      const arr = (n) => (Array.isArray(n) ? n : [n]);
      const G = (d) => ctx.keep(new Tone.Gain(Math.pow(10, d / 20)));
      const pan = (node, p) => { const pn = ctx.keep(new Tone.Panner(p)); node.connect(pn); pn.connect(out); return pn; };
      const saloon = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.016, lowcut: 280, highcut: 6500 });
      const deck = I.reverb(ctx, out, { decay: 0.9, preDelay: 0.008, lowcut: 300, highcut: 7500 });

      /** A monophonic horn: a MonoSynth (custom spectrum or FM) through a formant peak and a lowpass, late vibrato, scoops, slides, falls and a shake. */
      function horn(o) {
        const g = G(o.volume);
        const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff, type: "lowpass", rolloff: -12, Q: 0.6 })).connect(g);
        const fm = ctx.keep(new Tone.Filter({ frequency: o.formant, type: "peaking", Q: o.formantQ ?? 1.4, gain: o.formantGain ?? 5 })).connect(lp);
        const s = ctx.keep(o.fm
          ? new Tone.FMSynth({ harmonicity: 2, modulationIndex: o.fm, portamento: 0.01, oscillator: { type: "sine" }, modulation: { type: "sine" },
              envelope: { attack: o.attack, decay: 0.1, sustain: 0.82, release: 0.12 }, modulationEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.55, release: 0.1 } })
          : new Tone.MonoSynth({ portamento: 0, oscillator: { type: "custom", partials: o.partials }, filter: { type: "lowpass", rolloff: -12, Q: 0.9 },
              envelope: { attack: o.attack, decay: 0.14, sustain: 0.85, release: o.release ?? 0.13 },
              filterEnvelope: { attack: o.attack * 1.1, decay: 0.2, sustain: 0.55, release: 0.16, baseFrequency: o.base, octaves: o.octaves ?? 2.3 } })).connect(fm);
        let breath = null, safeB = null;
        if (o.breath != null) {
          const bp = ctx.keep(new Tone.Filter({ frequency: o.breathFreq, type: "bandpass", Q: 1 })).connect(lp);
          breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.01, decay: 0.08, sustain: 0.04, release: 0.1 } })).connect(bp);
          breath.volume.value = o.breath;
          safeB = I.monotonic(g);
        }
        const lfo = ctx.keep(new Tone.LFO({ frequency: o.vibRate, min: -1, max: 1 }).start());
        const depth = ctx.keep(new Tone.Gain(0)); // cents
        lfo.connect(depth); depth.connect(s.detune);
        const safe = I.monotonic(g);
        return {
          out: g,
          play(t, e, d) {
            const m = arr(e.note)[0];
            if (typeof m !== "number" || !Number.isFinite(m)) return;
            const tt = safe(t), f = hz(m);
            s.triggerAttackRelease(f, d, tt, e.vel);
            const from = Number(e.from) || 0, scoop = Number(e.scoop) || 0;
            if (from > 0) { // the tailgate slide: start below, arrive during the first part of the note
              const sl = Math.max(0.04, Math.min(d * 0.7, (Number(e.slide) || 0.4) * spb));
              s.frequency.setValueAtTime(hz(m - from), tt + 0.001); s.frequency.exponentialRampToValueAtTime(f, tt + 0.001 + sl);
            } else if (scoop > 0) { // the half-valve bend: a short lip up into the note
              s.frequency.setValueAtTime(hz(m - scoop), tt + 0.001); s.frequency.exponentialRampToValueAtTime(f, tt + 0.08 + 0.05 * scoop);
            }
            if (e.fall && d > 0.45) { s.frequency.setValueAtTime(f, tt + d - 0.14); s.frequency.exponentialRampToValueAtTime(hz(m - 4), tt + d); }
            if (breath) breath.triggerAttackRelease(Math.min(0.12, d), safeB(t), e.vel * (e.entrance ? 0.8 : 0.5));
            const p = depth.gain, delay = e.shake ? 0.25 : o.vibDelay, cents = e.shake ? o.vibCents * 2.2 : o.vibCents * (e.vib ?? 1);
            p.cancelScheduledValues(tt); p.setValueAtTime(0, tt);
            if (d > delay + 0.15) { p.setValueAtTime(0, tt + delay); p.linearRampToValueAtTime(cents, tt + delay + 0.35); }
          },
        };
      }
      // cornet: a brassy spectrum, a bright formant, a fast bwah from the filter envelope
      const cornet = horn({ volume: -12, cutoff: 3600, formant: 1250, formantGain: 5, partials: [1, 0.95, 0.82, 0.7, 0.56, 0.45, 0.36, 0.28, 0.2, 0.14, 0.1, 0.07], attack: 0.016, base: 420, octaves: 2.4, vibRate: 5.3, vibDelay: 0.32, vibCents: 11 });
      // clarinet: 2:1 FM (odd harmonics, a hollow square-ish tone), a little breath
      const clarinet = horn({ volume: -11, cutoff: 4300, formant: 2700, formantQ: 1.1, formantGain: 3, fm: 1.6, attack: 0.03, breath: -32, breathFreq: 3000, vibRate: 5.5, vibDelay: 0.3, vibCents: 12 });
      // trombone: darker saw-ish spectrum, the bell formant lower, a slower attack, portamento by hand
      const trombone = horn({ volume: -12, cutoff: 2700, formant: 640, formantQ: 1.2, formantGain: 4, partials: [1, 0.8, 0.62, 0.5, 0.4, 0.3, 0.22, 0.15, 0.1, 0.07, 0.05], attack: 0.034, base: 260, octaves: 2.2, release: 0.16, vibRate: 4.9, vibDelay: 0.4, vibCents: 10 });

      /** Tenor banjo: short bright Karplus-Strong strings through a head resonance, strummed low to high. */
      const banjoG = G(-9);
      const banjoHead = ctx.keep(new Tone.Filter({ frequency: 2400, type: "peaking", Q: 1.1, gain: 4 })).connect(banjoG);
      const banjoHp = ctx.keep(new Tone.Filter({ frequency: 210, type: "highpass", rolloff: -12 })).connect(banjoHead);
      const strings = Array.from({ length: 8 }, () => {
        const sg = ctx.keep(new Tone.Gain(1)).connect(banjoHp);
        const s = ctx.keep(new Tone.PluckSynth({ attackNoise: 2.2, dampening: 6500, resonance: 0.9, release: 0.5 })).connect(sg);
        return { s, sg, clock: I.monotonic(sg) };
      });
      let sk = 0;
      const banjo = {
        out: banjoG,
        play(t, e, d) {
          const ns = arr(e.note).filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
          const strum = Number(e.strum) || 0.012;
          ns.forEach((m, i) => { const v = strings[sk++ % strings.length]; const tt = v.clock(t + i * strum); v.sg.gain.setValueAtTime(Math.max(0.02, e.vel * (1 - i * 0.05)), tt); v.s.triggerAttackRelease(hz(m), Math.min(d, 0.6), tt); });
        },
      };

      /** Tuba: a round low spectrum, a soft filter bump on each oom. */
      const tubaG = G(-6);
      const tubaLp = ctx.keep(new Tone.Filter({ frequency: 1300, type: "lowpass", rolloff: -12, Q: 0.7 })).connect(tubaG);
      const tubaS = ctx.keep(new Tone.MonoSynth({ oscillator: { type: "custom", partials: [1, 0.7, 0.45, 0.28, 0.16, 0.09, 0.05] }, filter: { type: "lowpass", rolloff: -12, Q: 1 },
        envelope: { attack: 0.025, decay: 0.2, sustain: 0.55, release: 0.12 }, filterEnvelope: { attack: 0.02, decay: 0.18, sustain: 0.35, release: 0.15, baseFrequency: 110, octaves: 2.2 } })).connect(tubaLp);
      const tubaSafe = I.monotonic(tubaG);
      const tuba = { out: tubaG, play(t, e, d) { const m = arr(e.note)[0]; if (Number.isFinite(m)) tubaS.triggerAttackRelease(hz(m), d, tubaSafe(t), e.vel); } };

      const kit = I.kit(ctx, { volume: -2, kickNote: 36, preload: ["softKick", "kick", "snare", "rim", "brushTap", "brushSweep", "hatPedal", "woodblock", "tom", "crash", "ride"] });

      const cp = pan(cornet.out, -0.1), kp = pan(clarinet.out, 0.28), tp = pan(trombone.out, -0.32), bp = pan(banjo.out, 0.36);
      I.send(ctx, cp, saloon, -13); I.send(ctx, kp, saloon, -13); I.send(ctx, tp, saloon, -12); I.send(ctx, bp, deck, -15);
      I.place(ctx, tuba, 0.04, out); const dp = I.place(ctx, kit, -0.06, out);
      I.send(ctx, dp, deck, -14); I.send(ctx, tuba.out, deck, -24);

      const mono = (inst) => (t, e, d) => inst.play(t, e, d);
      return {
        cornet: { layer: "melody", play: mono(cornet), humanize: { timing: 0.008, vel: 0.05 } },
        clarinet: { layer: "melody", play: mono(clarinet), humanize: { timing: 0.009, vel: 0.05 } },
        trombone: { layer: "melody", play: mono(trombone), humanize: { timing: 0.012, vel: 0.05 } },
        banjo: { layer: "harmony", play: mono(banjo), humanize: { timing: 0.006, vel: 0.08 } },
        tuba: { layer: "bass", play: mono(tuba), humanize: { timing: 0.005, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.005, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const W = locate(cycle);
      const { lap, f, off } = W;
      const L = lap % 3;
      const key = `${lap}:${W.i}`;
      if (!state.plan || state.plan.key !== key) state.plan = { key, ...planSection(f, lap, r.fork(11)) };
      const { prog, notes } = state.plan;
      const s0 = off * BPB, s1 = s0 + CB * BPB;
      const ev = [];
      const push = (track, abs, dur, note, v, extra) => { // abs: beats from this cycle's start
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur: Math.max(0.05, dur), note, vel: Math.max(0.05, Math.min(1, v)), ...extra });
      };
      const chordAt = T.chordAtFactory(prog, BPB);
      const style = f.id === "intro" ? "intro" : f.id === "tag" ? "tag" : f.how === "clarinet" ? "light" : f.how === "out" ? "full" : "two";

      // ---------- the front line (hand-written, routed) ----------
      for (const n of notes) {
        if (n.at < s0 - 1e-6 || n.at >= s1 - 1e-6) continue;
        const { at, bar, beat, idx, phrase, voice, shift, track, ...extra } = n;
        let dur = n.dur;
        if (track === "cornet") { if (!extra.scoop && !extra.from && n.dur >= 1.5 && r.chance(0.3)) extra.scoop = r.pick([0.7, 1, 1.5]); extra.vib = n.dur >= 1.5 ? 1 : 0.4; dur -= 0.08; }
        else if (track === "clarinet") { if (!extra.scoop && n.dur >= 1 && r.chance(0.18)) extra.scoop = 0.6; extra.vib = n.dur >= 1 ? 1 : 0.3; dur -= 0.08; }
        else if (track === "trombone") { extra.vib = n.dur >= 1.5 ? 1 : 0.3; dur -= 0.05; }
        push(track, at - s0, dur, n.note, n.vel, extra);
      }
      const busy = (track, a, b) => notes.some((n) => n.track === track && n.at < b && endOf(n) > a + 0.05);

      // ---------- rhythm section ----------
      const Dr = (b, voice, v, extra) => push("drums", b, 0.1, voice, v, extra);
      let last = state.tubaLast ?? 46;
      for (let i = 0; i < CB; i++) {
        const bar = off + i, B0 = i * BPB, S = bar * BPB;
        const brk = isBreak(f, bar), stop = isStop(f, bar), tagEnd = f.id === "tag" && bar === 1;
        const chords = prog.filter((h) => h.bar === bar);
        const lastOfPhrase = f.id === "head" && bar % 4 === 3 && !brk;
        const nextChord = (b) => chordAt(Math.min(b, f.bars * BPB - 0.01));

        // banjo: four to the bar, accents on 2 and 4; hits only in the stop-time, the breaks and the tag's last bar
        const hiV = style === "full" || style === "tag";
        const voicing = (sym) => { const v = T.voice(sym, { lo: hiV ? 58 : 55, hi: hiV ? 77 : 74, n: 4, rootless: false, prev: state.banjoPrev, rng: r, top: hiV ? [67, 77] : [62, 74] }); state.banjoPrev = v; return v; };
        if (brk || stop || tagEnd) {
          if (tagEnd) chords.forEach((h) => push("banjo", B0 + h.beat, 0.6, voicing(h.chord), 0.8, { strum: 0.016 }));
          else push("banjo", B0, 0.6, voicing(chords[0].chord), stop ? 0.8 : 0.76, { strum: 0.016 });
        } else if (!(style === "intro" && L === 0 && bar === 0)) {
          const acc = style === "light" ? [0.4, 0.5, 0.4, 0.5] : style === "full" ? [0.56, 0.68, 0.56, 0.7] : [0.48, 0.6, 0.48, 0.62];
          const push4 = style === "full" ? 0.4 : style === "light" ? 0.1 : 0.22;
          for (let b = 0; b < 4; b++) {
            const h = chordAt(S + b);
            push("banjo", B0 + b, b % 2 ? 0.3 : 0.38, voicing(h.chord), acc[b] + (r.chance(0.3) ? 0.04 : 0), { strum: b % 2 ? 0.016 : 0.011 });
          }
          const hornsOut = !["cornet", "clarinet", "trombone"].some((t) => busy(t, S + 3.5, S + 4));
          if (hornsOut && r.chance(push4)) { const h = nextChord(S + 4); if (h.chord !== chordAt(S + 3).chord) push("banjo", B0 + 3.5, 0.3, voicing(h.chord), 0.5, { strum: 0.014 }); }
        }

        // tuba in two: roots and fifths, chromatic walkups into the next root, four to the bar now and then in the out-chorus
        const root = (sym) => { const c = T.chord(sym); const m = T.nearest(last, [c.bass], 38, 51); last = m; return m; };
        if (brk || stop) push("tuba", B0, 0.9, root(chords[0].chord), 0.84);
        else if (tagEnd) chords.forEach((h, j) => push("tuba", B0 + h.beat, j === 2 ? 2 : 0.8, root(h.chord), 0.84));
        else if (!(style === "intro" && L === 0 && bar === 0)) {
          chords.forEach((h, j) => {
            const s = h.bar * BPB + h.beat, c = T.chord(h.chord), R = root(h.chord);
            const fifthPc = mod12(c.bass + 7), fifth = R >= 42 ? T.nearest(R - 5, [fifthPc], 38, 51) : T.nearest(R + 7, [fifthPc], 38, 51);
            const nh = j + 1 < chords.length ? chords[j + 1] : nextChord(s + h.dur);
            const tgt = T.nearest(R, [T.chord(nh.chord).bass], 38, 51);
            const walkOk = !busy("trombone", s + h.dur - 1.5, s + h.dur) && tgt !== R;
            // an approach note: chromatic when that step is a tone of the current chord's scale, otherwise a whole step
            const dir = tgt > R ? -1 : 1;
            // an approach note is a chord tone, or a scale tone that does not sit a semitone from one (the banjo is playing them)
            const clean = (m) => c.pcs.includes(mod12(m)) || (c.scale.includes(mod12(m)) && !c.pcs.some((p) => Math.abs(mod12(m - p) - 6) === 5));
            const lead = [tgt + dir, tgt + 2 * dir].find(clean) ?? fifth;
            const lead2 = [T.step(tgt, 2 * dir, c.scale), T.step(tgt, 3 * dir, c.scale)].find((m) => clean(m) && Math.abs(m - tgt) <= 5) ?? fifth;
            const vA = style === "light" ? 0.72 : 0.8;
            push("tuba", B0 + h.beat, 0.8, R, vA);
            if (h.dur >= 4) {
              const walk = walkOk && r.chance(style === "full" ? 0.5 : style === "light" ? 0.25 : 0.38);
              if (style === "full" && walkOk && r.chance(0.3)) { // four to the bar
                push("tuba", B0 + 1, 0.5, T.nearest(R + 3, [mod12(c.root + (c.intervals.includes(3) ? 3 : 4))], 38, 51), 0.6);
                push("tuba", B0 + 2, 0.5, fifth, 0.68); push("tuba", B0 + 3, 0.45, lead, 0.6);
              } else if (walk) { push("tuba", B0 + 2, 0.5, lead2, 0.62); push("tuba", B0 + 3, 0.45, lead, 0.62); }
              else { push("tuba", B0 + 2, 0.8, r.chance(0.2) ? R : fifth, vA - 0.12); }
            } else if (h.dur === 2 && walkOk && r.chance(0.2) && Math.abs(tgt - R) > 2) push("tuba", B0 + h.beat + 1, 0.45, lead, 0.56);
          });
        }

        // drums
        const fillP = style === "full" ? 0.7 : style === "light" ? 0.3 : 0.5;
        const sectionEnd = bar === f.bars - 1 && f.id === "head" && !(f.how === "stop" && bar === 15);
        let fill = null;
        if (f.how === "stop" && bar === 7 && r.chance(0.6)) fill = 4; // the long roll under the hocketed break
        else if (!brk && !stop && f.id === "head" && (sectionEnd || (lastOfPhrase && r.chance(fillP)))) fill = sectionEnd ? r.weighted([[4, 1], [1, 1.5], [0, 1.5], [2, style === "full" ? 1.5 : 0.6]]) : r.weighted([[0, 2], [3, 1.5], [2, 1], [1, 1]]);
        const cut = fill != null ? FILLS[fill][0][0] : 9;
        const ok = (b) => b < cut;
        if (stop) { // the band hits 1 only; a woodblock marks it
          Dr(B0, "softKick", 0.6); Dr(B0, "woodblock", 0.62); if (lap > 0) Dr(B0, "snare", 0.26);
          if (L === 2 && bar >= 4) Dr(B0 + 3.5, "woodblock", 0.3);
        } else if (brk) {
          Dr(B0, "softKick", 0.6); Dr(B0, "snare", 0.4); if (f.how === "stop") Dr(B0, "woodblock", 0.5);
          if (bar === 15 || r.chance(0.5)) Dr(B0 + 3.5, "brushSweep", 0.36, { len: 0.4 });
        } else if (tagEnd) {
          [0, 1, 2].forEach((b) => { Dr(B0 + b, "kick", 0.62 + b * 0.05); Dr(B0 + b, "snare", 0.5 + b * 0.08); });
          Dr(B0 + 2, "crash", 0.55); Dr(B0 + 2, "woodblock", 0.5);
        } else if (style === "intro" && L === 0 && bar === 0) {
          FILLS[4].forEach(([b, voice, v, extra]) => Dr(B0 + b, voice, v + 0.1, extra)); // the drummer counts the band in with a press roll
        } else if (!(style === "intro" && L === 2 && bar === 0)) {
          const soft = style === "light", full = style === "full";
          for (let e = 0; e < 8; e++) { const b = e / 2; if (ok(b)) Dr(B0 + b, "brushTap", (e % 2 ? 0.14 : 0.24) * (soft ? 0.75 : full ? 1.15 : 1)); }
          if (ok(0)) Dr(B0, full ? "kick" : "softKick", full ? 0.62 : soft ? 0.44 : 0.55);
          if (ok(2) && !soft) Dr(B0 + 2, full ? "kick" : "softKick", full ? 0.5 : 0.42);
          [1, 3].forEach((b) => { if (ok(b)) { Dr(B0 + b, b === 3 && !full && r.chance(0.2) ? "rim" : "snare", full ? 0.46 : soft ? 0.26 : 0.34); Dr(B0 + b, "hatPedal", 0.28); } });
          if (full) { if (ok(0)) Dr(B0, "ride", 0.22); if (ok(2)) Dr(B0 + 2, "ride", 0.17); }
          if (!soft && bar % 2 === 1 && ok(3.5) && r.chance(0.3)) Dr(B0 + 3.5, full ? "kick" : "softKick", 0.36); // a push into the next bar
          if (!soft && r.chance(0.15) && ok(3.5)) Dr(B0 + 3.5, "snare", 0.14); // a ghost
          if (bar % 4 === 3 && fill == null && r.chance(soft ? 0.3 : 0.5)) Dr(B0 + 3.5, "brushSweep", 0.3, { len: 0.35 }); // a press into the downbeat
          if (fill != null) FILLS[fill].forEach(([b, voice, v, extra]) => Dr(B0 + b, voice, v, extra));
        }
        if (bar === 0 && f.how === "out") Dr(B0, "crash", 0.5);
        if (bar === 0 && f.how === "ensemble" && lap > 0) Dr(B0, "crash", 0.38);
      }
      state.tubaLast = last;

      const harmony = prog.filter((h) => h.bar >= off && h.bar < off + CB).map((h) => ({ ...h, bar: h.bar - off }));
      return { events: ev, harmony, section: `Lap ${lap + 1} · ${state.plan.label}`, state };
    },
  });
})();
