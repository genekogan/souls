// Hill Farm: a session set of Celtic dance tunes for a settlement in the green hills.
//
// Meter: 6/8 written in quarter-note beats (beatsPerBar 3, bpm 171), so the dotted-quarter jig
// pulse (0, 1.5) runs at 114 and every eighth is 0.5. The jig lilt (long-short-medium eighths) is
// played as tiny per-event delays, never by moving notes off the grid.
//
// The tunes are composed, not generated: three original 32-bar AABB jigs and a slow air, written
// below in a compact note syntax. What the code does is what session players do with a tune:
// melodic variation on repeats (filling quarter-eighth figures, smoothing runs), whistle
// ornamentation (cuts, taps, long and short rolls, triplets) chosen afresh each time through,
// bouzouki strumming with open-fifth drone voicings, a guitar thumb on the pulse, a bodhrán with
// low open tones, tipped strokes and rim clicks, and a fiddle that doubles at the octave or
// harmonises in thirds.
//
// One set (26 cycles of 8 bars, about 3.6 minutes):
//   tune 1 twice (AABB AABB): whistle alone over a pipe drone, then bouzouki and guitar, bodhrán
//     on the B part, fiddle doubling and then harmonising on the second time through
//   change of tune with a "hup": tune 2 (A dorian) twice, everyone in, a breakdown on the second time
//   slow air in E dorian over drones and harp, rubato, the fiddle or flute adding a second voice
//   tune 1 once more, and the set ends on a held tonic.
// Sets alternate: Hill Farm (G) / The Barley Rig (A dorian) / air on flute, then
// The Turf Stack (D mixolydian) / The Barley Rig / air on fiddle.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 3, BPM = 171, SPB = 60 / BPM, CYCLE = 24;
  const LILT = [0, 0.06, 0.02]; // beats added to the 1st/2nd/3rd eighth of each dotted quarter
  const GL = 0.07, GD = 0.055; // grace-note lead time and length (beats): about 24 and 19 ms
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const db = (x) => Math.pow(10, x / 20);
  const arr = (n) => (Array.isArray(n) ? n : [n]);
  const lilt = (b) => { const e = b * 2; return Math.abs(e - Math.round(e)) > 1e-6 ? 0 : LILT[mod(Math.round(e), 3)]; };

  // ---------- note syntax: "G4:2 A4 B4:2 D5 | ..." (durations in units; "*" pickup slot, "-" rest) ----------
  function parse(str, unit, barBeats) {
    return str.split("|").map((s) => s.trim()).filter(Boolean).map((bar, bi) => {
      let t = 0;
      const out = [];
      for (const tok of bar.split(/\s+/)) {
        const [name, n] = tok.split(":");
        const d = (n ? Number(n) : 1) * unit;
        if (name === "*") out.push({ t, d, m: null, slot: true });
        else if (name !== "-") out.push({ t, d, m: T.midi(name) });
        t += d;
      }
      if (barBeats && Math.abs(t - barBeats) > 1e-6) throw new Error(`hill-farm: bar ${bi + 1} lasts ${t} beats: ${bar}`);
      return out;
    });
  }

  // ---------- the tunes (written pitch; the whistle sounds an octave higher) ----------
  // Bouzouki voicings: open fifths and octaves with a drone string, after GDAD tuning.
  const VO_G = { G: [50, 55, 62, 67], C: [48, 55, 60, 67], Am: [52, 57, 64, 69], D: [50, 57, 62, 66], Em: [52, 59, 64, 67] };
  const VO_A = { Am: [52, 57, 64, 69], G: [50, 55, 62, 69], D: [50, 57, 62, 66], Em: [52, 59, 64, 69], C: [48, 55, 60, 64] };
  const VO_D = { D: [50, 57, 62, 69], C: [48, 55, 60, 67], G: [50, 55, 62, 67], Am: [52, 57, 64, 69], Em: [52, 59, 64, 67] };
  // Guitar thumb: roots in the DADGAD bass register.
  const ROOT = { G: 43, C: 48, Am: 45, A: 45, D: 38, Em: 40, Bm: 47 };

  const TUNES = {
    hill: {
      name: "Hill Farm", key: "G", scale: T.scale("G", "ionian"), tonic: "G", vo: VO_G, drone: [43, 50],
      final: "G4:6",
      A: {
        pickup: "D4",
        notes: "G4:2 A4 B4:2 D5 | E5:2 G5 D5 B4 G4 | A4:2 B4 D5 C5 A4 | B4:2 G4 A4:3 | G4:2 A4 B4:2 D5 | E5:2 G5 A5:2 G5 | E5 D5 B4 A4:2 F#4 | G4:3 G4:2 *",
        chords: "| G | C G | Am D | G D | G | C Am | Em D | G |",
      },
      B: {
        pickup: "D5",
        notes: "G5:2 A5 B5:2 G5 | A5:2 F#5 D5:2 F#5 | E5:2 G5 D5 B4 G4 | A4 C5 E5 D5:3 | G5:2 A5 B5:2 G5 | A5:2 F#5 G5:2 E5 | D5 B4 G4 A4:2 F#4 | G4:3 G4:2 *",
        chords: "| G | D | C G | Am D | G | D C | G D | G |",
      },
    },
    barley: {
      name: "The Barley Rig", key: "A dorian", scale: T.scale("A", "dorian"), tonic: "Am", vo: VO_A, drone: [45, 52], lead: "Em",
      final: "A4:6",
      A: {
        pickup: "E4",
        notes: "A4:2 B4 C5 B4 A4 | G4:2 A4 B4 A4 G4 | A4 B4 C5 D5:2 E5 | G5:2 E5 D5 B4 G4 | A4:2 B4 C5 B4 A4 | G4:2 A4 B4 C5 D5 | E5 C5 A4 B4 G4 E4 | A4:3 A4:2 *",
        chords: "| Am | G | Am D | Em G | Am | G | C Em | Am |",
      },
      B: {
        pickup: "E5",
        notes: "A5:2 B5 A5 G5 E5 | G5:2 A5 G5 E5 D5 | E5 G5 E5 D5 F#5 D5 | G5 E5 B4 D5:3 | A5:2 B5 A5 G5 E5 | G5:2 A5 F#5 E5 D5 | E5 C5 A4 B4 G4 E4 | A4:3 A4:2 *",
        chords: "| Am | G | C D | Em D | Am | G D | C Em | Am |",
      },
    },
    turf: {
      name: "The Turf Stack", key: "D mixolydian", scale: T.scale("D", "mixolydian"), tonic: "D", vo: VO_D, drone: [38, 45],
      final: "D5:6",
      A: {
        pickup: "F#4",
        notes: "A4:2 D5 F#5 E5 D5 | E5:2 C5 G4 C5 E5 | F#5 E5 D5 A4 D5 F#5 | G5:2 E5 C5:3 | A4:2 D5 F#5 E5 D5 | E5:2 C5 G4 C5 E5 | G5 F#5 G5 E5 C5 A4 | D5:3 D5:2 *",
        chords: "| D | C | D | G C | D | C | G C | D |",
      },
      B: {
        pickup: "E5",
        notes: "F#5:2 A5 A5 F#5 D5 | G5:2 E5 C5 E5 G5 | A5:2 F#5 E5 C5 A4 | B4 G4 B4 C5:3 | F#5:2 A5 A5 F#5 D5 | G5:2 E5 G5 A5 B5 | G5 F#5 G5 E5 C5 A4 | D5:3 D5:2 *",
        chords: "| D | C | D Am | G C | D | C Em | G C | D |",
      },
    },
  };
  for (const tune of Object.values(TUNES)) {
    for (const s of ["A", "B"]) {
      const st = tune[s];
      st.bars = parse(st.notes, 0.5, BPB);
      st.prog = T.progression(st.chords, BPB);
      st.pick = T.midi(st.pickup);
    }
    tune.finalBar = parse(tune.final, 0.5, BPB)[0];
  }

  // The slow air, "The Upper Field", in E dorian. Unit = 1.5 beats (an air "eighth"), so an air bar
  // of 3/4 lasts 9 beats (three jig bars) and its quarter note moves at about 57.
  const AIR = {
    notes: "-:1 E5:3 B4:2 | D5:3 E5:1 G5:2 | A5:4 F#5:2 | E5:6 | E5:2 G5:2 B5:2 | C#6:4 B5:1 A5:1 | B5:3 A5:1 G5:2 | F#5:6 | " +
      "G5:2 B5:2 D6:2 | E6:4 C#6:2 | D6:3 C#6:1 B5:2 | B5:4 A5:1 G5:1 | G5:3 F#5:1 E5:2 | F#5:2 D5:2 B4:2 | F#5:3 E5:1 D5:2 | E5:6",
    chords: ["Em", "G", "D", "Em", "Em", "A", "G", "D", "G", "A", "Bm", "G", "Em", "Bm", "D", "Em"],
    scale: T.scale("E", "dorian"),
  };
  AIR.bars = parse(AIR.notes, 1.5, 9);
  AIR.flat = [];
  AIR.bars.forEach((bar, bi) => bar.forEach((n) => AIR.flat.push({ abs: bi * 9 + n.t, d: n.d, m: n.m, bar: bi })));
  // Harp: low root plus a voicing that stays clear of the E3/B3 drone and below the melody.
  const HARP = { Em: [40, 55, 59, 64], G: [43, 55, 59, 62, 67], D: [38, 45, 57, 62, 66], A: [45, 57, 61, 64, 69], Bm: [47, 59, 62, 66, 71] };
  const AIR_DRONE = [52, 59];

  // ---------- form ----------
  const ROUND = 26;
  const ROUNDS = [{ t1: "hill", t2: "barley", air: "flute" }, { t1: "turf", t2: "barley", air: "fiddle" }];
  function plan(cycle) {
    const round = Math.floor(cycle / ROUND), k = cycle % ROUND, R = ROUNDS[round % 2];
    let p;
    if (k < 8) p = { seg: "t1", tune: R.t1, s: k };
    else if (k < 16) p = { seg: "t2", tune: R.t2, s: k - 8 };
    else if (k < 22) p = { seg: "air", a: k - 16 };
    else p = { seg: "ret", tune: R.t1, s: k - 22 };
    p.round = round; p.R = R;
    if (p.seg !== "air") {
      p.strain = p.s % 4 < 2 ? "A" : "B";
      p.pass = Math.floor(p.s / 4);
      p.last = (p.seg === "ret" && p.s === 3) || (p.seg !== "ret" && p.s === 7);
    }
    return p;
  }
  // energy: 0 whistle alone, 1 strings enter, 2 bodhrán, 3 full, 4 driving
  function arrangement(P) {
    const odd = P.round % 2 === 1, s = P.s;
    if (P.seg === "t1") return [
      { e: 0, fid: "off", orn: 0.25, vary: 0, drone: true, desc: "whistle alone over the drone" },
      { e: 1, fid: "off", orn: 0.4, vary: 0.12, desc: "bouzouki and guitar join" },
      { e: 2, fid: odd ? "double" : "off", orn: 0.45, vary: 0.12, enter: true, desc: odd ? "bodhrán and fiddle join" : "bodhrán joins" },
      { e: 2, fid: odd ? "harm" : "off", orn: 0.5, vary: 0.16, desc: odd ? "fiddle in thirds" : "full session" },
      { e: 2, fid: "double", orn: 0.6, vary: 0.2, desc: "fiddle doubles at the octave" },
      { e: 3, fid: "double", orn: 0.7, vary: 0.25, desc: "ornaments thicken" },
      { e: 3, fid: "harm", orn: 0.65, vary: 0.2, desc: "fiddle in thirds" },
      { e: 3, fid: "harm", orn: 0.75, vary: 0.25, desc: "into the next tune" },
    ][s];
    if (P.seg === "t2") return [
      { e: 4, fid: "double", orn: 0.5, vary: 0.1, desc: "the lift: everyone in" },
      { e: 4, fid: "double", orn: 0.6, vary: 0.18, desc: "whistle and fiddle together" },
      { e: 4, fid: "harm", orn: 0.6, vary: 0.15, desc: "fiddle in thirds" },
      { e: 4, fid: "harm", orn: 0.7, vary: 0.2, desc: "fiddle in thirds" },
      { e: 4, fid: "double", orn: 0.75, vary: 0.22, breakdown: true, desc: "breakdown, then back in" },
      { e: 4, fid: "double", orn: 0.85, vary: 0.28, desc: "whistle and fiddle together" },
      { e: 4, fid: "harm", orn: 0.75, vary: 0.22, desc: "fiddle in thirds" },
      { e: 4, fid: "harm", orn: 0.85, vary: 0.28, desc: "last time" },
    ][s];
    return [
      { e: 3, fid: "off", orn: 0.55, vary: 0.15, desc: "the first tune comes back" },
      { e: 3, fid: "double", orn: 0.7, vary: 0.22, desc: "fiddle doubles" },
      { e: 4, fid: "harm", orn: 0.7, vary: 0.2, desc: "fiddle in thirds" },
      { e: 4, fid: "harm", orn: 0.8, vary: 0.25, desc: "the set ends" },
    ][s];
  }

  // ---------- melodic variation (shared by whistle and fiddle) ----------
  function vary(notes, p, r, scale, lo) {
    if (p <= 0) return notes.slice();
    const out = [];
    let i = 0;
    while (i < notes.length) {
      const n = notes[i];
      if (!(n.abs >= 0 && n.abs < 21 - 1e-6 && mod(n.abs, 1.5) < 1e-6)) { out.push(n); i++; continue; }
      const grp = [];
      let j = i;
      while (j < notes.length && notes[j].abs < n.abs + 1.5 - 1e-6) grp.push(notes[j++]);
      const next = notes[j];
      const shape = grp.map((g) => g.d).join(",");
      let rep = null;
      if (shape === "1,0.5" && r.chance(p)) { // quarter-eighth -> three eighths
        const X = grp[0].m, Y = grp[1].m, diff = Y - X;
        let Z;
        if (diff === 0) Z = T.step(X, 1, scale);
        else if (Math.abs(diff) <= 2) Z = T.step(X, -Math.sign(diff), scale); // escape tone
        else if (Math.abs(diff) <= 4) Z = T.step(X, Math.sign(diff), scale);  // passing tone
        else Z = X;                                                           // repeated note (gets a cut)
        rep = [{ ...grp[0], d: 0.5 }, { abs: n.abs + 0.5, d: 0.5, m: Z }, grp[1]];
      } else if (shape === "0.5,0.5,0.5" && r.chance(p * 0.6)) { // smooth a stepwise run into quarter-eighth
        const [a, b, c] = grp.map((g) => g.m);
        if (Math.abs(a - b) <= 2 && Math.abs(b - c) <= 2 && Math.sign(b - a) === Math.sign(c - b) && a !== b) rep = [{ ...grp[0], d: 1 }, grp[2]];
      } else if (shape === "1.5" && n.abs !== 10.5 && next && next.m != null && next.m !== grp[0].m && r.chance(p * 0.4)) { // anticipate the next note
        const X = grp[0].m, Nn = T.step(next.m, -Math.sign(next.m - X), scale);
        if (Nn !== X) rep = [{ ...grp[0], d: 1 }, { abs: n.abs + 1, d: 0.5, m: Nn }];
      }
      if (rep && rep.every((x) => x.m >= lo)) out.push(...rep); else out.push(...grp);
      i = j;
    }
    return out;
  }

  // ---------- ornamentation and performance ----------
  const upper = (m, sc) => { const u = T.step(m, 1, sc); return u - m === 1 ? T.step(m, 2, sc) : u; };
  const lower = (m, sc) => T.step(m, -1, sc);
  const POSVEL = [0.8, 0.6, 0.66, 0.74, 0.6, 0.66];
  /**
   * Turn notes [{abs, d, m}] into performed parts with grace notes, lilt and safe legato.
   * o: { r, level, scale, inst: "whistle" | "fiddle" | "harm", lo, end, vel, late }
   * returns [{abs, shift (beats), dur, m, vel, grace}]
   */
  function perform(notes, o) {
    const r = o.r, sc = o.scale, parts = [];
    // micro-timing: the lilt plus a small, seeded push or drag per note (a grace moves with its note)
    const jit = new Map();
    const feel = (abs) => { const k = Math.round(abs * 1000); if (!jit.has(k)) jit.set(k, clamp(r.gauss(0.008), -0.018, 0.018)); return lilt(abs) + jit.get(k); };
    const main = (abs, d, m, vel) => parts.push({ abs, d, m, vel, shift: feel(abs) });
    const grace = (mainAbs, m, vel, dir = 1) => {
      const last = parts[parts.length - 1];
      if (last && !last.grace && last.m === m) m = T.step(m, dir, sc); // a cut must differ from the note before it
      if (m > (o.top ?? 99)) return;
      parts.push({ abs: mainAbs - GL, d: GD, m, vel, shift: feel(mainAbs), grace: true });
    };
    notes.forEach((n, i) => {
      const prev = notes[i - 1], next = notes[i + 1];
      const e = Math.round(mod(n.abs, 3) * 2);
      const onGrid = Math.abs(mod(n.abs, 3) * 2 - e) < 1e-6;
      const v = (onGrid ? POSVEL[e % 6] : 0.62) * (o.vel ?? 1);
      const pulse = onGrid && e % 3 === 0;
      const L = o.avoid && o.avoid.has(n.abs) ? 0 : o.level, m = n.m;
      const canRoll = m > o.lo && m <= (o.rollTop ?? 99) && o.inst !== "harm";
      if (o.inst === "whistle") {
        if (prev && prev.m === m && Math.abs(prev.abs + prev.d - n.abs) < 1e-6 && r.chance(0.85)) { grace(n.abs, upper(m, sc), 0.5); main(n.abs, n.d, m, v); return; }
        if (n.d === 1.5 && canRoll && pulse && r.chance(0.55 * L)) { // long roll
          main(n.abs, 0.5, m, v);
          grace(n.abs + 0.5, upper(m, sc), 0.48); main(n.abs + 0.5, 0.5, m, v * 0.85);
          grace(n.abs + 1, lower(m, sc), 0.45, -1); main(n.abs + 1, 0.5, m, v * 0.88);
          return;
        }
        if (n.d === 1 && pulse) {
          if (canRoll && r.chance(0.28 * L)) { // short roll
            grace(n.abs, upper(m, sc), 0.5); main(n.abs, 0.5, m, v);
            grace(n.abs + 0.5, lower(m, sc), 0.45, -1); main(n.abs + 0.5, 0.5, m, v * 0.85);
            return;
          }
          if (next && r.chance(0.2 * L)) { // triplet turn in the quarter's time
            const u = upper(m, sc);
            main(n.abs, 1 / 3, m, v); main(n.abs + 1 / 3, 1 / 3, u, v * 0.82); main(n.abs + 2 / 3, 1 / 3, m, v * 0.85);
            return;
          }
          if (r.chance(0.3 * L)) grace(n.abs, upper(m, sc), 0.5);
        } else if (pulse && r.chance(0.18 * L)) grace(n.abs, upper(m, sc), 0.5);
        else if (n.d >= 3 && r.chance(0.6)) grace(n.abs, upper(m, sc), 0.5);
        main(n.abs, n.d, m, v);
      } else if (o.inst === "fiddle") {
        if (n.d === 1.5 && canRoll && pulse && r.chance(0.22 * L)) {
          main(n.abs, 0.5, m, v);
          grace(n.abs + 0.5, upper(m, sc), 0.42); main(n.abs + 0.5, 0.5, m, v * 0.85);
          grace(n.abs + 1, lower(m, sc), 0.4, -1); main(n.abs + 1, 0.5, m, v * 0.85);
          return;
        }
        if (n.d === 1 && pulse && r.chance(0.14 * L)) { // bowed treble
          main(n.abs, 1 / 6, m, v); main(n.abs + 1 / 6, 1 / 6, m, v * 0.7); main(n.abs + 1 / 3, 1 / 6, m, v * 0.75); main(n.abs + 0.5, 0.5, m, v * 0.85);
          return;
        }
        main(n.abs, n.d, m, v);
      } else main(n.abs, n.d, m, v);
    });
    parts.sort((a, b) => a.abs - b.abs);
    if (o.marks) notes.forEach((n) => { if (parts.some((p) => p.abs > n.abs - 0.1 && p.abs < n.abs + n.d - 1e-6 && (p.grace || p.m !== n.m))) o.marks.add(n.abs); });
    const late = o.late ?? 0;
    parts.forEach((p, i) => {
      const on = p.abs + p.shift + late;
      const nx = parts[i + 1];
      const limit = nx ? nx.abs + nx.shift + late - 0.03 : o.end - 0.12;
      const art = p.grace ? 1 : p.d >= 3 ? 0.97 : p.d >= 1.5 ? 0.93 : 0.9;
      p.dur = Math.max(0.04, Math.min(p.d * art, limit - on));
      p.shift += late;
    });
    return parts;
  }

  // fiddle harmony: a diatonic third below (an octave under the whistle). On the pulse it must be a
  // chord tone, or a soft added tone (6th or 9th, or 11th on a minor chord); cadence bars are strict.
  function harmonise(notes, scale, chordAt) {
    let prevH = null;
    return notes.map((n) => {
      let h = T.step(n.m, -2, scale);
      if (mod(n.abs, 1.5) < 1e-6) {
        const c = T.chord(chordAt(n.abs)), strict = n.abs >= 21 || n.d >= 3;
        const iv = mod(h - c.root, 12), minor = c.intervals.includes(3);
        const soft = !strict && (iv === 2 || iv === 9 || (minor && iv === 5));
        if (!c.pcs.includes(mod(h, 12))) {
          const score = (x) => Math.abs(x - h) + (prevH != null ? Math.abs(x - prevH) * 0.6 : 0);
          let best = soft ? h : null, bestS = soft ? 4 + score(h) : Infinity;
          for (let x = n.m - 9; x <= n.m - 3; x++) {
            if (!c.pcs.includes(mod(x, 12)) || n.m - x === 5) continue; // no bare fourths under the tune
            if (score(x) < bestS) { bestS = score(x); best = x; }
          }
          if (best != null) h = best;
        }
      }
      h = Math.max(55, h);
      prevH = h;
      return { ...n, m: h };
    });
  }

  // ---------- accompaniment patterns (eighth positions 0..5 within a bar) ----------
  const STRUM = {
    1: [[[0, "D", 0.6], [3, "D", 0.5], [5, "u", 0.32]]],
    2: [[[0, "D", 0.66], [2, "u", 0.38], [3, "D", 0.56], [5, "u", 0.4]]],
    3: [[[0, "D", 0.68], [2, "u", 0.38], [3, "D", 0.58], [5, "u", 0.42]], [[0, "D", 0.68], [1, "u", 0.3], [2, "d", 0.42], [3, "D", 0.58], [5, "u", 0.42]]],
    4: [[[0, "D", 0.7], [2, "u", 0.42], [3, "D", 0.6], [4, "u", 0.3], [5, "d", 0.46]], [[0, "D", 0.7], [1, "u", 0.3], [2, "d", 0.44], [3, "D", 0.6], [5, "u", 0.44]]],
  };
  // bodhrán: L low open tone, M pressed (higher, damped), t tipped stroke, r rim click
  const BOD = {
    sparse: [[0, "L", 0.8], [3, "L", 0.6], [5, "t", 0.4]],
    basic: [[0, "L", 0.85], [1, "t", 0.3], [2, "t", 0.45], [3, "M", 0.65], [4, "t", 0.3], [5, "t", 0.5]],
    basic2: [[0, "L", 0.85], [1, "t", 0.3], [2, "t", 0.45], [3, "L", 0.7], [4, "t", 0.3], [5, "r", 0.5]],
    lift: [[0, "L", 0.9], [1, "t", 0.3], [2, "r", 0.55], [3, "M", 0.7], [4, "t", 0.32], [5, "t", 0.6]],
    drive: [[0, "L", 0.95], [1, "t", 0.38], [2, "t", 0.55], [3, "L", 0.8], [4, "t", 0.38], [5, "r", 0.62]],
  };
  const FILLS = [
    [[0, "L", 0.9], [1, "t", 0.35], [2, "t", 0.5], [3, "L", 0.8], [4, "t", 0.4], [4 + 1 / 3, "t", 0.45], [4 + 2 / 3, "t", 0.5], [5, "M", 0.75]],
    [[0, "L", 0.9], [1, "t", 0.35], [2, "t", 0.45], [2 + 1 / 3, "t", 0.5], [2 + 2 / 3, "t", 0.55], [3, "L", 0.85], [4, "r", 0.55], [5, "r", 0.65]],
    [[0, "L", 0.9], [2, "t", 0.5], [3, "L", 0.85], [3 + 1 / 3, "t", 0.4], [3 + 2 / 3, "t", 0.45], [4, "M", 0.7], [5, "M", 0.8]],
  ];
  const HUP = [[0, "L", 0.95], [1, "t", 0.4], [2, "t", 0.55], [3, "L", 0.9], [4, "r", 0.6], [4 + 1 / 3, "r", 0.65], [4 + 2 / 3, "r", 0.7], [5, "L", 0.95]];
  const BUILD = [[3, "t", 0.32], [3 + 1 / 3, "t", 0.36], [3 + 2 / 3, "t", 0.4], [4, "t", 0.45], [4 + 1 / 3, "t", 0.5], [4 + 2 / 3, "t", 0.55], [5, "M", 0.78]];

  // ---------- custom instruments ----------
  function makeFiddle(ctx, I, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 10)));
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 5.6, depth: 0.03 })).connect(out);
    const body = ctx.keep(new Tone.EQ3({ low: -5, mid: 2, high: -4, lowFrequency: 280, highFrequency: 3600 })).connect(vib);
    const lp = ctx.keep(new Tone.Filter({ frequency: 4500, type: "lowpass", rolloff: -12 })).connect(body);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: 0.01, oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -12, Q: 1.3 },
      envelope: { attack: 0.03, decay: 0.15, sustain: 0.85, release: 0.09 },
      filterEnvelope: { attack: 0.04, decay: 0.25, sustain: 0.55, release: 0.15, baseFrequency: 750, octaves: 2.5 },
    })).connect(lp);
    const nbp = ctx.keep(new Tone.Filter({ frequency: 3200, type: "bandpass", Q: 0.7 })).connect(lp);
    const bow = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.01, decay: 0.08, sustain: 0.3, release: 0.08 } })).connect(nbp);
    bow.volume.value = -30;
    const mono = I.monotonic(s);
    return {
      out,
      play(time, note, dur, vel, e = {}) {
        const t = mono(time), m = arr(note)[0];
        const attack = Number.isFinite(e.attack) ? e.attack : 0.03, depth = Number.isFinite(e.vib) ? e.vib : 0.03;
        s.envelope.attack = attack;
        vib.depth.setValueAtTime(depth, t);
        s.triggerAttackRelease(T.hz(m), dur, t, vel);
        bow.triggerAttackRelease(Math.max(0.04, dur * 0.9), t, vel * 0.6);
      },
    };
  }
  function makeBodhran(ctx, I, volume) {
    const out = ctx.keep(new Tone.Gain(db(volume)));
    const lowLp = ctx.keep(new Tone.Filter({ frequency: 900, type: "lowpass", rolloff: -24 })).connect(ctx.keep(new Tone.Gain(db(-8))).connect(out));
    const low = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 2.4, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.15 } })).connect(lowLp);
    const mid = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.8, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.08 } })).connect(ctx.keep(new Tone.Gain(db(-10))).connect(out));
    const tipLp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass" })).connect(ctx.keep(new Tone.Gain(db(-11))).connect(out));
    const tip = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 1.3, oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 } })).connect(tipLp);
    const skinBp = ctx.keep(new Tone.Filter({ frequency: 1500, type: "bandpass", Q: 0.9 })).connect(ctx.keep(new Tone.Gain(db(-12))).connect(out));
    const skin = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 } })).connect(skinBp);
    const rimBp = ctx.keep(new Tone.Filter({ frequency: 1900, type: "bandpass", Q: 2.5 })).connect(ctx.keep(new Tone.Gain(db(4))).connect(out));
    const rim = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.002, octaves: 0.6, envelope: { attack: 0.0005, decay: 0.04, sustain: 0, release: 0.02 } })).connect(rimBp);
    const cl = { L: I.monotonic(low), M: I.monotonic(mid), t: I.monotonic(tip), s: I.monotonic(skin), r: I.monotonic(rim) };
    return {
      out,
      hit(type, time, vel, pitch = 40) {
        const v = clamp(vel, 0.05, 1);
        if (type === "L") low.triggerAttackRelease(T.hz(pitch), 0.3, cl.L(time), v);
        else if (type === "M") mid.triggerAttackRelease(T.hz(pitch + 5), 0.15, cl.M(time), v);
        else if (type === "t") tip.triggerAttackRelease(T.hz(57), 0.06, cl.t(time), v);
        else if (type === "r") { rim.triggerAttackRelease(T.hz(86), 0.03, cl.r(time), v); tip.triggerAttackRelease(T.hz(57), 0.05, cl.t(time), v * 0.4); }
        skin.triggerAttackRelease(0.03, cl.s(time), v * (type === "t" ? 0.7 : 0.5));
      },
    };
  }
  function makeDrone(ctx, volume) {
    const out = ctx.keep(new Tone.Gain(db(volume - 13)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 1100, type: "lowpass", rolloff: -12 })).connect(out);
    const s = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 6, options: {
      oscillator: { type: "custom", partials: [1, 0.55, 0.4, 0.28, 0.2, 0.14, 0.1, 0.07] },
      envelope: { attack: 1.6, decay: 0.4, sustain: 0.9, release: 3 },
    } })).connect(lp);
    return { out, play(time, notes, dur, vel) { s.triggerAttackRelease(arr(notes).map(T.hz), dur, time, vel); } };
  }

  Sim.register({
    id: "hill-farm",
    title: "Hill Farm",
    genre: "Celtic folk",
    about: "A session set in 6/8: two original jigs played AABB, a change of tune with a lift, a slow air over drones and harp, then the first tune again. Tin whistle with cuts, rolls and triplets that change every time through, a bouzouki strumming open-fifth drones, guitar on the pulse, a bodhrán with tip and rim, and a fiddle that doubles or harmonises in thirds.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0, strongBeats: [0, 1.5],

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.015, lowcut: 250, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 3.8, preDelay: 0.03, lowcut: 300, highcut: 6000 });
      const whistle = I.whistle(ctx, { volume: -3, cutoff: 7500, base: 2400, octaves: 1.2, breath: -22, breathFreq: 4200, vibrato: 5.4, vibratoDepth: 0.012, glide: 0.004, attack: 0.012, release: 0.07 });
      const flute = I.flute(ctx, { volume: -3, vibrato: 4.8, vibratoDepth: 0.05, attack: 0.07, release: 0.35, glide: 0.012 });
      const fiddle = makeFiddle(ctx, I, { volume: -6 });
      const bouz = I.nylon(ctx, { volume: 0, cutoff: 6000, dampening: 5200, resonance: 0.955, attackNoise: 1.1, voices: 16 });
      const gtr = I.nylon(ctx, { volume: 3, cutoff: 2000, dampening: 2400, resonance: 0.95, voices: 4 });
      const bod = makeBodhran(ctx, I, -4.5);
      const drone = makeDrone(ctx, -8);
      const harp = I.harp(ctx, { volume: 3, dampening: 4200, resonance: 0.97 });
      const wp = I.place(ctx, whistle, 0.12, out), fp = I.place(ctx, flute, 0.15, out), vp = I.place(ctx, fiddle, -0.28, out);
      const bp = I.place(ctx, bouz, 0.42, out), gp = I.place(ctx, gtr, -0.1, out), dp = I.place(ctx, bod, -0.08, out);
      const np = I.place(ctx, drone, 0, out), hp = I.place(ctx, harp, -0.35, out);
      I.send(ctx, wp, room, -11); I.send(ctx, wp, hall, -21); I.send(ctx, fp, room, -12); I.send(ctx, fp, hall, -11);
      I.send(ctx, vp, room, -11); I.send(ctx, vp, hall, -17); I.send(ctx, bp, room, -13); I.send(ctx, gp, room, -18);
      I.send(ctx, dp, room, -15); I.send(ctx, np, hall, -12); I.send(ctx, hp, hall, -9);
      return {
        whistle: { layer: "melody", play: (t, e, d) => whistle.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0.04 } },
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0.04 } },
        fiddle: { layer: "melody", play: (t, e, d) => fiddle.play(t, e.note, d, e.vel, e), humanize: { timing: 0, vel: 0.05 } },
        bouzouki: {
          layer: "harmony", humanize: { timing: 0.005, vel: 0.08 },
          play: (t, e, d) => {
            const s = Number.isFinite(e.strum) ? e.strum : 0.01;
            bouz.play(t, e.note, d, e.vel, s);
            if (e.course) bouz.play(t + 0.007, [arr(e.note)[0] + 12], d, e.vel * 0.35, 0); // octave course
          },
        },
        bass: { layer: "bass", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.06 } },
        bodhran: { layer: "drums", play: (t, e) => bod.hit(e.note, t, e.vel, e.pitch), humanize: { timing: 0.004, vel: 0.1 } },
        drone: { layer: "texture", play: (t, e, d) => drone.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        harp: { layer: "texture", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = plan(cycle), N = plan(cycle + 1);
      const ev = [], harmony = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      const section = P.seg === "air" ? composeAir(P, N, r, push, harmony) : composeJig(P, N, r, push, harmony);
      return { events: ev, harmony, section, state };
    },
  });

  // ---------- a strain of a jig ----------
  function composeJig(P, N, r, push, harmony) {
    const tune = TUNES[P.tune], st = tune[P.strain], A = { ...arrangement(P) };
    const warm = 1 + 0.1 * Math.min(2, Math.floor(P.round / 2)); // players loosen up over the evening
    A.orn = Math.min(1, A.orn * warm); A.vary = Math.min(0.35, A.vary * warm);
    const toNewTune = P.seg === "t1" && P.last && N.seg === "t2";
    const final = P.last && !toNewTune;
    const lo = 62; // whistle bottom D (written D4)

    // harmony, with the last bar opening onto the next tune's pickup chord at a change
    st.prog.forEach((h) => harmony.push({ ...h }));
    if (toNewTune) {
      const lastH = harmony.filter((h) => h.bar === 7);
      lastH.forEach((h) => harmony.splice(harmony.indexOf(h), 1));
      harmony.push({ bar: 7, beat: 0, dur: 1.5, chord: tune.tonic }, { bar: 7, beat: 1.5, dur: 1.5, chord: TUNES[N.tune].lead });
    }
    const chordAt = T.chordAtFactory(harmony, BPB);
    const sym = (b) => chordAt(b).chord;

    // the notes of this strain, with its ending
    let pickup = null;
    if (toNewTune) pickup = TUNES[N.tune].A.pick;
    else if (!final) pickup = tune[N.strain].pick;
    const notes = [];
    st.bars.forEach((bar, bi) => {
      const src = bi === 7 && final ? tune.finalBar : bar;
      src.forEach((n) => {
        if (n.slot) { if (pickup != null) notes.push({ abs: bi * 3 + n.t, d: n.d, m: pickup }); }
        else notes.push({ abs: bi * 3 + n.t, d: n.d, m: n.m });
      });
    });
    const tune2 = vary(notes, A.vary, r.fork(1), tune.scale, lo);

    // whistle
    const marks = new Set();
    const wl = perform(tune2, { marks, r: r.fork(2), level: A.orn * (0.85 + 0.3 * r()), scale: tune.scale, inst: "whistle", lo, top: 86, rollTop: 81, end: final ? 30 : CYCLE });
    wl.forEach((p) => push("whistle", p.abs, p.dur, p.m + 12, p.vel * (p.grace ? 1 : 0.95), { delay: p.shift * SPB }));

    // fiddle: octave doubling or thirds
    if (A.fid !== "off") {
      const src = A.fid === "harm" ? harmonise(tune2, tune.scale, sym) : tune2;
      const fl = perform(src, { r: r.fork(3), level: A.fid === "harm" ? 0.2 : A.orn * 0.7, scale: tune.scale, inst: A.fid === "harm" ? "harm" : "fiddle", avoid: marks, lo: 62, end: final ? 30 : CYCLE, vel: A.fid === "harm" ? 0.7 : 0.75, late: 0.012 });
      fl.forEach((p) => push("fiddle", p.abs, p.dur, p.m, p.vel, { delay: p.shift * SPB, vib: p.dur > 1.2 ? 0.05 : 0.025 }));
    }

    // drone under the opening whistle
    if (A.drone) push("drone", 0, CYCLE - 1, tune.drone, 0.5);

    // bouzouki
    const E = A.e;
    if (E >= 1) {
      const strokes = [];
      for (let bar = 0; bar < 8; bar++) {
        let pat;
        if (bar === 7 && final) pat = [[0, "D", 0.75]];
        else if (bar === 7 && toNewTune) pat = [[0, "D", 0.7], [3, "D", 0.78]];
        else if (A.breakdown && bar < 3) pat = [[0, "D", 0.5]];
        else if (A.breakdown && bar === 3) pat = [[0, "D", 0.5], [3, "D", 0.55], [4, "u", 0.4], [5, "d", 0.5]];
        else { const opts = STRUM[E]; pat = opts[(bar % 2 === 1 && opts.length > 1 && r.chance(0.6)) ? 1 : 0]; }
        pat.forEach(([pos, kind, vel]) => strokes.push({ abs: bar * 3 + pos * 0.5, kind, vel }));
      }
      strokes.forEach((s, i) => {
        const nx = strokes[i + 1];
        const vo = tune.vo[sym(s.abs)] || T.voice(sym(s.abs), { lo: 48, hi: 69, n: 4 });
        const notes = s.kind === "D" ? vo : s.kind === "d" ? vo.slice(1) : vo.slice(-2);
        const dur = nx ? nx.abs - s.abs + 0.15 : final ? 4 : CYCLE - s.abs + 0.1;
        const strum = s.kind === "u" ? -0.007 : s.kind === "d" ? 0.008 : 0.011;
        const accent = s.abs === 0 ? 1.06 : mod(s.abs, 12) === 0 ? 1.03 : 1;
        push("bouzouki", s.abs, dur, notes.slice(), s.vel * accent, { strum, course: s.kind === "D", delay: lilt(s.abs) * SPB });
      });
    }

    // guitar thumb
    if (E >= 1) {
      const sc = tune.scale;
      for (let bar = 0; bar < 8; bar++) {
        if (A.breakdown && bar < 3) continue;
        const b0 = bar * 3, b1 = b0 + 1.5;
        const c0 = sym(b0), c1 = sym(b1);
        const root0 = ROOT[c0] ?? T.nearest(43, [T.chord(c0).root], 38, 50);
        const root1 = ROOT[c1] ?? T.nearest(43, [T.chord(c1).root], 38, 50);
        if (bar === 7 && final) { push("bass", b0, 4, root0, 0.8); continue; }
        if (A.breakdown && bar === 3) { push("bass", b1, 1.4, root1, 0.7); continue; }
        push("bass", b0, E === 1 && c0 === c1 ? 2.8 : 1.4, root0, 0.8);
        const nextC = bar < 7 ? sym(b0 + 3) : null;
        const walk = E >= 3 && (bar === 3 || (bar === 7 && !toNewTune)) && r.chance(0.5);
        if (walk) {
          const nextSym = bar === 7 ? tune[N.strain] && tune[N.strain].prog[0].chord : nextC;
          const target = ROOT[nextSym] ?? root0;
          let dir = target >= root1 ? 1 : -1, e4, e5;
          if (Math.abs(target - root1) <= 2) { e4 = root1 + 7 <= 52 ? root1 + 7 : root1 - 5; e5 = T.step(target, e4 > target ? 1 : -1, sc); } // via the fifth
          else {
            if (T.step(target, -2 * dir, sc) < 38) dir = -1; // approach from above when the bottom string runs out
            e5 = T.step(target, -dir, sc); e4 = T.step(e5, -dir, sc);
          }
          push("bass", b1, 0.45, root1, 0.72); push("bass", b1 + 0.5, 0.45, e4, 0.6, { delay: lilt(b1 + 0.5) * SPB }); push("bass", b1 + 1, 0.45, e5, 0.66, { delay: lilt(b1 + 1) * SPB });
        } else if (c1 !== c0) push("bass", b1, 1.4, root1, 0.74);
        else if (E >= 2) {
          const fifth = T.nearest(root0 + 7, [mod(T.chord(c0).root + 7, 12)], 38, 52);
          push("bass", b1, 1.4, fifth > 50 ? fifth - 12 : fifth, 0.68);
        }
      }
    }

    // bodhrán
    if (E >= 2) {
      const pitchL = P.strain === "B" ? 42 : 40;
      let lastTrip = false;
      for (let bar = 0; bar < 8; bar++) {
        let pat;
        if (A.breakdown && bar < 3) continue;
        if (A.breakdown && bar === 3) pat = BUILD;
        else if (bar === 7 && final) pat = [[0, "L", 1]];
        else if (bar === 7 && toNewTune) pat = HUP;
        else if (bar === 7 && r.chance(E >= 3 ? 0.75 : 0.5)) pat = r.pick(FILLS);
        else if (bar === 3 && r.chance(0.25)) pat = FILLS[0];
        else if (A.enter && bar < 4) pat = BOD.sparse;
        else if (E === 2) pat = bar % 2 ? BOD.basic2 : BOD.basic;
        else if (E === 3) pat = bar % 2 ? BOD.lift : BOD.basic;
        else pat = bar % 2 ? BOD.lift : BOD.drive;
        let hits = pat.map((x) => x.slice());
        if (pat === BOD.basic || pat === BOD.basic2 || pat === BOD.lift || pat === BOD.drive) {
          if (r.chance(0.15)) hits = hits.filter((h) => h[0] !== 4); // breathe
          if (!lastTrip && r.chance(0.05 * E)) { // a triplet on the third eighth
            const i = hits.findIndex((h) => h[0] === 2);
            if (i >= 0) { hits.splice(i, 1, [2, "t", 0.45], [2 + 1 / 3, "t", 0.4], [2 + 2 / 3, "t", 0.48]); lastTrip = true; }
          } else lastTrip = false;
        }
        hits.forEach(([pos, type, vel]) => {
          const abs = bar * 3 + pos * 0.5;
          push("bodhran", abs, 0.25, type, vel * (E === 2 ? 0.9 : 1), { pitch: pitchL, delay: lilt(abs) * SPB });
        });
      }
    }

    const passName = P.seg === "ret" ? "once more" : P.pass ? "second time" : "first time";
    return `${tune.name} (jig in ${tune.key}) · ${P.strain} part, ${passName} · ${A.desc}`;
  }

  // ---------- the slow air ----------
  function composeAir(P, N, r, push, harmony) {
    const lead = P.R.air, second = lead === "flute" ? "fiddle" : "flute";
    const start = P.a * CYCLE, end = start + CYCLE;
    const ret = TUNES[N.tune] || TUNES.hill;
    const leadInAt = 138; // air beat where the jig lead-in starts (last cycle, bar 7)
    const lastCycle = P.a === 5;
    // rubato: a phrase (4 air bars) leans back as it goes; the last phrase most of all
    const rubato = (b) => {
      const u = mod(b, 36) / 36, last = b >= 108;
      return (last ? 0.24 : 0.15) * u * u; // seconds
    };
    const local = (b) => b - start;

    // harmony timeline
    AIR.chords.forEach((c, i) => {
      const s = i * 9, e = Math.min(s + 9, leadInAt);
      if (e <= start || s >= end) return;
      const a = Math.max(s, start), bEnd = Math.min(e, end);
      const p = C.at(local(a), BPB);
      harmony.push({ bar: p.bar, beat: p.beat, dur: bEnd - a, chord: c });
    });
    if (lastCycle) harmony.push({ bar: 6, beat: 0, dur: 6, chord: ret.tonic });

    // lead melody
    const notes = AIR.flat.filter((n) => n.abs >= start && n.abs < end);
    const isFlute = lead === "flute";
    const lvl = 0.5 + 0.15 * Math.min(2, Math.floor(P.round / 2));
    notes.forEach((n) => {
      const idx = AIR.flat.indexOf(n), prev = AIR.flat[idx - 1], next = AIR.flat[idx + 1];
      const delay = rubato(n.abs);
      const nextOn = next ? next.abs + rubato(next.abs) / SPB : n.abs + n.d;
      let d = n.d;
      if (!next) d = leadInAt - n.abs + 1.5; // the last note gives way to the lead-in
      const dur = Math.max(0.3, Math.min(d * 0.97, nextOn - (n.abs + delay / SPB) - 0.22)); // room for a grace
      const peak = AIR.flat.slice(Math.max(0, idx - 3), idx + 4).every((x) => x.m <= n.m);
      const vel = (n.d >= 4.5 ? 0.66 : 0.6) + (peak ? 0.08 : 0) + (n.abs % 9 === 0 ? 0.04 : 0);
      const leap = prev && n.m - prev.m >= 4;
      // ornaments: a cut or a slide into long notes, a slow roll in the middle of the longest
      if (isFlute && n.d >= 4.5 && r.chance(0.45 * lvl)) push("flute", local(n.abs) - GL, GD, upper(n.m, AIR.scale), 0.45, { delay });
      else if (leap && r.chance(0.5)) push(lead, local(n.abs) - 0.16, 0.13, lower(n.m, AIR.scale), 0.4, { delay, attack: 0.03, vib: 0 });
      if (n.d >= 9 && next && r.chance(0.35 * lvl) && isFlute) {
        const half = Math.round(dur / 2 / 1.5) * 1.5;
        push(lead, local(n.abs), half - 0.1, n.m, vel, { delay });
        push(lead, local(n.abs) + half - GL, GD, upper(n.m, AIR.scale), 0.42, { delay });
        push(lead, local(n.abs) + half, dur - half, n.m, vel * 0.9, { delay });
      } else push(lead, local(n.abs), dur, n.m, vel, { delay, attack: 0.12, vib: 0.07 });
    });

    // second voice on the second half: long chord tones a third or sixth below
    if (start >= 72) {
      let prevH = null;
      const longs = AIR.flat.filter((n) => n.abs >= 72 && n.d >= 3);
      longs.forEach((n, i) => {
        if (n.abs < start || n.abs >= end) return;
        const nx = longs[i + 1];
        const pcs = T.chord(AIR.chords[n.bar]).pcs;
        const cands = [];
        for (let x = n.m - 9; x <= n.m - 3; x++) if (pcs.includes(mod(x, 12)) && n.m - x !== 5) cands.push(x);
        if (!cands.length) return;
        const pref = (x) => { const iv = n.m - x; return (iv === 3 || iv === 4 ? 0 : iv === 8 || iv === 9 ? 1.5 : 3) + (prevH != null ? Math.abs(x - prevH) * 0.4 : 0); };
        const h = cands.sort((a, b) => pref(a) - pref(b))[0];
        prevH = h;
        let until = nx ? nx.abs : leadInAt + 1;
        const rub = AIR.flat.find((x) => x.abs > n.abs && x.abs < until && [1, 2, 10, 11].includes(mod(x.m - h, 12)));
        if (rub) until = rub.abs;
        const delay = rubato(n.abs);
        const dur = Math.max(0.5, until - n.abs - 0.15 + (nx ? rubato(nx.abs) - delay : 0) / SPB);
        push(second, local(n.abs), dur, h, second === "fiddle" ? 0.42 : 0.48, { delay: delay + 0.04, attack: 0.25, vib: 0.05 });
      });
    }

    // harp: a rolled chord on each air bar, and now and then a note in the middle of the bar
    AIR.chords.forEach((c, i) => {
      const s = i * 9;
      if (s < start || s >= end || s >= leadInAt) return;
      const v = HARP[c], delay = rubato(s);
      v.forEach((m, k) => push("harp", local(s) + k * 0.13, 7, m, (k === 0 ? 0.5 : 0.42 - k * 0.02), { delay }));
    });
    AIR.chords.forEach((c, i) => { // the mid-bar note may fall in the next cycle
      const s = i * 9 + 4.5, v = HARP[c];
      if (i === 15 || s < start || s >= end || !r.chance(0.55)) return;
      const m = v[v.length - 2] + 12 <= 74 ? v[v.length - 2] + 12 : v[v.length - 2];
      push("harp", local(s), 4, m, 0.3, { delay: rubato(s) });
    });

    // drone through the whole air
    if (P.a === 0) push("drone", 0, leadInAt - 1.5, AIR_DRONE, 0.42);

    // lead-in to the returning jig: two bars of bouzouki and guitar, tipped bodhrán, the whistle's pickup
    if (lastCycle) {
      const vo = ret.vo[ret.tonic];
      [[6, 0, "D", 0.55], [6, 3, "D", 0.48], [6, 5, "u", 0.36], [7, 0, "D", 0.6], [7, 2, "u", 0.38], [7, 3, "D", 0.55], [7, 5, "u", 0.42]].forEach(([bar, pos, kind, vel], i, all) => {
        const abs = bar * 3 + pos * 0.5, nx = all[i + 1];
        const dur = nx ? nx[0] * 3 + nx[1] * 0.5 - abs + 0.15 : CYCLE - abs + 0.1;
        push("bouzouki", abs, dur, kind === "D" ? vo.slice() : vo.slice(-2), vel, { strum: kind === "u" ? -0.007 : 0.011, course: kind === "D", delay: lilt(abs) * SPB });
      });
      const root = ROOT[ret.tonic];
      push("bass", 18, 2.8, root, 0.72); push("bass", 21, 1.4, root, 0.75);
      push("bodhran", 21, 0.25, "L", 0.6, { pitch: 40 });
      [[22, "t", 0.3], [22.5, "t", 0.38], [23, "t", 0.42], [23.5, "M", 0.62]].forEach(([b, type, vel]) => push("bodhran", b, 0.25, type, vel, { pitch: 40, delay: lilt(b) * SPB }));
      push("whistle", 23.5, 0.34, ret.A.pick + 12, 0.66, { delay: lilt(23.5) * SPB });
    }

    const half = start < 72 ? "first strain" : "second strain";
    const who = lead === "flute" ? "flute" : "fiddle";
    return `Slow air · The Upper Field (E dorian) · ${who}, ${half}${start >= 72 ? `, ${second} below` : ""}${lastCycle ? " · the jig returns" : ""}`;
  }
})();
