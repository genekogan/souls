// Public Works: a city under construction, seen from above. Pulse minimalism after Reich and Glass.
//
// One "day" is a cycle of ten chords (204 bars, about nine minutes). Every chord is a bass note under a
// pentatonic collection played by the mallets; the collection moves around the circle of fifths by one
// semitone at a time (D -> A -> E -> D -> G -> C -> G -> D pentatonic), so the light changes slowly while
// the bass walks D D B G A F# E C Bb A and cadences home.
//
// Processes:
//   * Rhythmic construction: marimba 1 assembles its 12-eighth pattern note by note out of silence; marimba 2
//     then builds the same pattern one eighth behind it; the vibes build "resultant" figures they hear in the
//     composite.
//   * Phasing: marimba 2 slips one eighth later every so often. It lingers on alignments where the two
//     patterns interlock into continuous eighths and hurries past those that double, arriving back in
//     unison over the dominant at the end of the day.
//   * Substitution: each new day, marimba 1 turns yesterday's pattern into today's one position per bar.
//   * Additive process: the piano plays Glass-style figures 1-2, 1-2-3, ... up to ten notes and back down.
//   * Breath waves: strings pulse the chord in quarters and the bass clarinet its bass note in eighths, each
//     swelling and fading over about two bars. Their wave periods differ, so the swells drift against each other.
//   * Long tones in flute or clarinet pick notes out of the pattern and hold them.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 6, EB = 12, CB = 4; // quarter beats per bar, eighths per bar, bars per cycle

  // slots: the five mallet pitches (pentatonic, low to high). fig: the piano's additive figure.
  // str: strings pulse voicing. bass: bass clarinet / pedal pitch.
  const SEC = [
    { sym: "D69", bars: 16, bass: 38, slots: [69, 71, 74, 76, 78], fig: [50, 57, 64, 66, 69, 71], str: [66, 71, 76, 81], name: "Survey" },
    { sym: "Dmaj13", bars: 20, bass: 38, slots: [69, 71, 73, 76, 78], fig: [50, 57, 61, 64, 66, 69], str: [66, 73, 76, 81], name: "Foundations" },
    { sym: "B9sus4", bars: 20, bass: 35, slots: [69, 71, 73, 76, 78], fig: [47, 54, 61, 64, 66, 69], str: [64, 69, 73, 78], name: "Rebar" },
    { sym: "Gmaj13#11", bars: 24, bass: 43, slots: [69, 71, 73, 76, 78], fig: [43, 50, 57, 61, 66, 71], str: [69, 73, 78, 83], name: "Steel" },
    { sym: "Amaj13", bars: 24, bass: 45, slots: [68, 71, 73, 76, 78], fig: [45, 52, 56, 61, 66, 71], str: [68, 73, 78, 83], name: "Glazing" },
    { sym: "F#9sus4", bars: 20, bass: 42, slots: [68, 71, 73, 76, 78], fig: [42, 49, 56, 59, 64, 68], str: [68, 73, 76, 83], name: "Cranes" },
    { sym: "E9sus4", bars: 20, bass: 40, slots: [69, 71, 74, 76, 78], fig: [40, 47, 54, 57, 62, 66], str: [69, 74, 78, 83], name: "Wiring" },
    { sym: "Cmaj13", bars: 20, bass: 36, slots: [69, 71, 74, 76, 79], fig: [48, 55, 62, 64, 69, 71], str: [69, 74, 76, 83], name: "Overcast" },
    { sym: "Bbmaj13#11", bars: 24, bass: 34, slots: [69, 72, 74, 76, 79], fig: [46, 53, 57, 62, 64, 67], str: [69, 74, 76, 84], name: "Floodlights" },
    { sym: "A9sus4", bars: 16, bass: 33, slots: [69, 71, 74, 76, 79], fig: [45, 52, 59, 62, 64, 67], str: [67, 74, 76, 83], name: "Topping out" },
  ];
  const START = []; let DAY = 0;
  SEC.forEach((s) => { START.push(DAY); DAY += s.bars; });
  const DYN = [0.8, 0.85, 0.9, 0.97, 1, 0.95, 0.9, 0.82, 0.95, 0.9];
  const secAt = (dayBar) => { let i = 0; while (i + 1 < SEC.length && START[i + 1] <= dayBar) i++; return i; };

  // Marimba patterns: onsets within 12 eighths and slot indices. A and C share a rhythm whose odd
  // rotations interlock into unbroken eighths; B's rhythm interlocks at 1, 6 and 11.
  const PATS = [
    { on: [0, 2, 4, 5, 6, 8, 9, 10], idx: [1, 3, 4, 2, 1, 4, 2, 0] }, // B . E . F# D B . F# D A .
    { on: [0, 1, 3, 4, 5, 7, 8, 10], idx: [0, 2, 3, 1, 4, 2, 0, 1] }, // A D . E B F# . D A . B .
    { on: [0, 2, 4, 5, 6, 8, 9, 10], idx: [0, 2, 4, 1, 3, 4, 1, 2] }, // A . D . F# B E . F# B D .
  ];
  const BUILD = [0, 4, 6, 2, 5, 1, 7, 3]; // order in which pattern notes appear during construction
  const SUBST = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11]; // order in which positions are substituted
  /** Pattern as a 12-slot grid of slot indices (-1 = rest), keeping only the first `count` notes of BUILD. */
  function grid(p, count = 8) {
    const g = new Array(EB).fill(-1);
    BUILD.slice(0, count).forEach((n) => { g[p.on[n]] = p.idx[n]; });
    return g;
  }
  const rotate = (g, k) => g.map((_, i) => g[(i - k + EB * 2) % EB]);

  // Phase plan: marimba 2 holds +1 until bar 40, then moves +2 .. +11, then unison (0) for the last section.
  // Bars per position are proportional to how well the two parts interlock there.
  const PHASE_FROM = 40, PHASE_TO = START[9] + 8;
  const PLANS = PATS.map((p) => {
    const g = grid(p), w = [];
    for (let k = 2; k <= 11; k++) {
      const h = rotate(g, k);
      let cov = 0, uni = 0;
      for (let i = 0; i < EB; i++) { if (g[i] >= 0 || h[i] >= 0) cov++; if (g[i] >= 0 && g[i] === h[i]) uni++; }
      w.push(Math.max(1, (cov - 8) * 2 - uni * 3) ** 1.5);
    }
    const units = (PHASE_TO - PHASE_FROM) / 2, sum = w.reduce((a, x) => a + x, 0);
    const u = w.map((x) => Math.max(1, Math.round((x / sum) * units)));
    let diff = units - u.reduce((a, x) => a + x, 0);
    while (diff !== 0) { // settle rounding on the longest (diff > 0) or longest-but-shrinkable positions
      const order = u.map((x, i) => i).sort((a, b) => u[b] - u[a]);
      const i = order.find((j) => diff > 0 || u[j] > 1);
      u[i] += Math.sign(diff); diff -= Math.sign(diff);
    }
    const plan = []; let at = PHASE_FROM;
    u.forEach((n, j) => { plan.push({ from: at, k: j + 2 }); at += n * 2; });
    return plan;
  });
  function phaseAt(day, dayBar) {
    if (dayBar < PHASE_FROM) return 1;
    if (dayBar >= PHASE_TO) return 0;
    const plan = PLANS[day % PATS.length];
    let k = plan[0].k;
    for (const s of plan) if (s.from <= dayBar) k = s.k;
    return k;
  }

  // Orchestration by section, two alternating day plans. vib: resultant mode ("up" = upper notes of the
  // composite, "low" = lower notes), "build-" = constructed note by note. pno: additive piano.
  const ORCH = [
    [{ str: 1 }, { str: 1 }, { str: 1, vib: "build-up" }, { str: 1, vib: "up", pno: 1, shk: 1 }, { str: 1, vib: "up", pno: 1, shk: 1, fl: 1 },
      { str: 1, pno: 1, cl: 1 }, { str: 1, vib: "build-low", cl: 1 }, { vib: "low" }, { str: 1, vib: "up", pno: 1, fl: 1 }, { str: 1, vib: "up" }],
    [{ str: 1 }, { pno: 1 }, { str: 1, pno: 1, vib: "build-low" }, { str: 1, pno: 1, vib: "low", cl: 1 }, { str: 1, vib: "build-up", fl: 1, shk: 1 },
      { str: 1, vib: "up", fl: 1, shk: 1 }, { pno: 1, cl: 1 }, { str: 1, pno: 1, vib: "build-up" }, { str: 1, vib: "up", fl: 1, shk: 1 }, { str: 1, pno: 1 }],
  ];
  /** Everything about an absolute bar: day, section, flags (with the opening's special entries). */
  function where(absBar) {
    const day = Math.floor(absBar / DAY), dayBar = absBar - day * DAY, si = secAt(dayBar);
    const o = { ...ORCH[day % 2][si], bcl: 1, sub: 1 };
    if (day === 0 && si === 0) { o.str = 0; o.bcl = dayBar >= 8; o.sub = dayBar >= 4; }
    return { day, dayBar, si, sec: SEC[si], barInSec: dayBar - START[si], o };
  }

  // Additive piano: cell lengths up and back down, with repetitions keeping each stage about 14-20 eighths.
  const ADD = [2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3];
  const REPS = { 2: 7, 3: 5, 4: 4, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2 };
  const LINES = [[2, 3, 4, 5, 4, 3, 2, 1, 0, 1], [2, 3, 4, 3, 4, 5, 4, 2, 1, 0]]; // cells start mid-register; the bass arrives only in the long cells

  // Breath waves: [period, length, offset] in eighths.
  const WAVES = { str: [30, 22, 0], bcl: [26, 18, 9] };
  const swell = (u) => Math.pow(Math.sin(Math.PI * u), 1.6);

  Sim.register({
    id: "public-works",
    title: "Public Works",
    genre: "Minimalism",
    about: "Pulse minimalism over a ten-chord day: two marimbas build and phase a twelve-eighth pattern, vibes pick out its resultants, a piano grows Glass-style additive figures, and strings and bass clarinet breathe in waves.",
    bpm: 132, beatsPerBar: BPB, cycleBars: CB, gainDb: 5.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.8, preDelay: 0.012, lowcut: 250, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 5, preDelay: 0.03, lowcut: 300, highcut: 6500 });
      const mar1 = I.marimba(ctx, { volume: -5, decay: 0.7, hardness: 1.5, cutoff: 4600 });
      const mar2 = I.marimba(ctx, { volume: -5, decay: 0.75, hardness: 1.3, cutoff: 4200 });
      const vib = I.vibes(ctx, { volume: -7, decay: 2.4, release: 1, motor: 4.2, motorDepth: 0.14 });
      const pno = I.softPiano(ctx, { volume: -8, decay: 2.6, release: 0.6, cutoff: 2300 });
      const str = I.strings(ctx, { volume: -13, attack: 0.07, release: 0.28, cutoff: 2600 });
      const bcl = I.clarinet(ctx, { volume: -5, cutoff: 1300, base: 260, octaves: 2.2, breath: -34, vibratoDepth: 0.008, attack: 0.04, release: 0.12 });
      const sub = I.sub(ctx, { volume: -12, attack: 1.2, release: 1.5 });
      const fl = I.flute(ctx, { volume: -4, attack: 0.25, release: 0.6, vibratoDepth: 0.05 });
      const cl = I.clarinet(ctx, { volume: -5, attack: 0.2, release: 0.5 });
      const kit = I.kit(ctx, { volume: -9, preload: ["shaker"] });
      const m1p = I.place(ctx, mar1, -0.45, out), m2p = I.place(ctx, mar2, 0.45, out), vp = I.place(ctx, vib, 0.18, out);
      const pp = I.place(ctx, pno, -0.18, out), sp = I.place(ctx, str, 0, out), bp = I.place(ctx, bcl, -0.05, out);
      I.place(ctx, sub, 0, out);
      const fp = I.place(ctx, fl, 0.22, out), cp = I.place(ctx, cl, -0.28, out), kp = I.place(ctx, kit, 0.3, out);
      I.send(ctx, m1p, room, -12); I.send(ctx, m2p, room, -12); I.send(ctx, m1p, hall, -19); I.send(ctx, m2p, hall, -19);
      I.send(ctx, vp, hall, -12); I.send(ctx, pp, hall, -14); I.send(ctx, sp, hall, -8); I.send(ctx, bp, hall, -18);
      I.send(ctx, fp, hall, -9); I.send(ctx, cp, hall, -10); I.send(ctx, kp, room, -14);
      const mallet = { timing: 0.003, vel: 0.03 };
      return {
        mar1: { layer: "texture", play: (t, e, d) => mar1.play(t, e.note, d, e.vel), humanize: mallet },
        mar2: { layer: "texture", play: (t, e, d) => mar2.play(t, e.note, d, e.vel), humanize: mallet },
        vibes: { layer: "melody", play: (t, e, d) => vib.play(t, e.note, d, e.vel), humanize: mallet },
        flute: { layer: "melody", play: (t, e, d) => fl.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.05 } },
        clarinet: { layer: "melody", play: (t, e, d) => cl.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.05 } },
        piano: { layer: "harmony", play: (t, e, d) => pno.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        strings: { layer: "harmony", play: (t, e, d) => str.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        bassClar: { layer: "bass", play: (t, e, d) => bcl.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.06 } },
        pedal: { layer: "bass", play: (t, e, d) => sub.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        shaker: { layer: "drums", play: (t, e) => kit.hit("shaker", t, e.vel), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const ev = [];
      const push = (track, bar, beat, dur, note, vel) => ev.push({ track, bar, beat, dur, note, vel: Math.max(0.05, Math.min(1, vel)) });
      const absBar0 = cycle * CB, W = where(absBar0);
      const { day, si, sec, o } = W, dyn = DYN[si];
      const pat = PATS[day % PATS.length];

      // ---- marimba grids, bar by bar ----
      const bars = [];
      for (let b = 0; b < CB; b++) {
        const w = where(absBar0 + b);
        let m1;
        if (w.si === 0 && w.day === 0) m1 = grid(pat, Math.min(8, w.barInSec + 1));
        else if (w.si === 0) { // substitution: yesterday's pattern becomes today's, one position per bar
          const prev = grid(PATS[(w.day - 1) % PATS.length]), next = grid(pat);
          const diff = SUBST.filter((i) => prev[i] !== next[i]);
          const n = Math.min(diff.length, w.barInSec);
          m1 = prev.slice(); diff.slice(0, n).forEach((i) => { m1[i] = next[i]; });
        } else m1 = grid(pat);
        let m2 = new Array(EB).fill(-1), k = null;
        if (w.si >= 1) { k = phaseAt(w.day, w.dayBar); m2 = rotate(grid(pat, w.si === 1 ? Math.min(8, w.barInSec + 1) : 8), k); }
        bars.push({ w, m1, m2, k });
      }

      bars.forEach(({ w, m1, m2, k }, b) => {
        const S = w.sec.slots, d = DYN[w.si];
        const acc1 = w.si === 0 && w.day > 0 ? -1 : pat.on[0], acc2 = k == null ? -1 : (pat.on[0] + k) % EB;
        for (let i = 0; i < EB; i++) {
          if (m1[i] >= 0) push("mar1", b, i / 2, 0.45, S[m1[i]], (0.52 + (i === acc1 ? 0.08 : 0)) * d + r.gauss(0.015));
          if (m2[i] >= 0) push("mar2", b, i / 2, 0.45, S[m2[i]], (0.5 + (i === acc2 ? 0.07 : 0)) * d * (k === 0 ? 0.7 : 1) + r.gauss(0.015));
        }

        // ---- vibes: resultant patterns heard in the composite ----
        const vm = w.o.vib;
        if (vm) {
          const up = vm.endsWith("up"), res = [];
          for (let i = 0; i < EB; i++) {
            const ns = [m1[i], m2[i]].filter((x) => x >= 0);
            if (!ns.length) continue;
            const s = up ? Math.max(...ns) : Math.min(...ns);
            if (up ? s >= 3 : s <= 1) res.push({ i, s });
          }
          // a resultant is a figure, not a doubling: at most five notes, the most extreme pitches first
          const ext = (x) => (up ? 4 - x.s : x.s) * EB + x.i;
          let keep = res.length > 5 ? res.filter((x) => res.slice().sort((a, b2) => ext(a) - ext(b2)).slice(0, 5).includes(x)) : res;
          if (vm.startsWith("build")) {
            const c = Math.max(0, w.barInSec - 1);
            const chosen = new Set(keep.slice().sort((a, b2) => ext(a) - ext(b2)).slice(0, c).map((x) => x.i));
            keep = keep.filter((x) => chosen.has(x.i));
          }
          keep.forEach((x, j) => {
            const gap = (j + 1 < keep.length ? keep[j + 1].i : EB + (keep[0] ? keep[0].i : 0)) - x.i;
            push("vibes", b, x.i / 2, Math.min(1.5, gap * 0.5) * 0.95, S[x.s], 0.46 * d + r.gauss(0.02));
          });
        }

        // ---- additive piano ----
        if (w.o.pno) {
          if (!state.add) state.add = { st: 0, rep: 0, j: 0 };
          const A = state.add, line = LINES[w.day % 2], F = w.sec.fig;
          for (let i = 0; i < EB; i++) {
            const n = ADD[A.st], fi = line[A.j];
            const vel = (A.j === 0 ? 0.5 : 0.35) + (fi === 5 ? 0.05 : 0);
            push("piano", b, i / 2, 0.45, F[fi], vel * d + r.gauss(0.015));
            if (++A.j >= n) { A.j = 0; if (++A.rep >= REPS[n]) { A.rep = 0; A.st = (A.st + 1) % ADD.length; } }
          }
        } else state.add = null;

        // ---- breath waves: strings pulse the chord, the bass clarinet its bass note ----
        for (const [track, [P, L, off]] of Object.entries(WAVES)) {
          for (let i = 0; i < EB; i++) {
            const e = (absBar0 + b) * EB + i, n = Math.floor((e - off) / P), s0 = off + n * P;
            if (s0 < 0 || e - s0 >= L) continue;
            const ws = where(Math.floor(s0 / EB)); // a wave belongs to the section where it began
            if (!ws.o[track]) continue;
            const u = (e - s0 + 0.5) / L, dd = DYN[ws.si];
            if (track === "str") { if (i % 2 === 0) push("strings", b, i / 2, 0.9, w.sec.str, (0.06 + 0.42 * swell(u)) * dd); } // quarter-note breaths
            else push("bassClar", b, i / 2, 0.4, w.sec.bass, (0.12 + 0.55 * swell(u)) * dd);
          }
        }

        // ---- maracas-style shaker in the brightest sections ----
        if (w.o.shk) {
          const left = w.sec.bars - w.barInSec;
          for (let i = 0; i < EB; i++) {
            const fade = Math.min(1, (w.barInSec + i / EB + 0.5) / 4, (left - i / EB) / 2);
            push("shaker", b, i / 2, 0.1, "shaker", (i === 0 ? 0.32 : i % 2 === 0 ? 0.22 : 0.14) * fade * d);
          }
        }

        // ---- pedal ----
        const pedalFrom = w.day === 0 && w.si === 0 ? 4 : 0;
        if (w.barInSec === pedalFrom) push("pedal", b, 0, (w.sec.bars - pedalFrom) * BPB - 0.5, w.sec.bass, 0.55);
      });

      // ---- long tones drawn out of the pattern: flute above, clarinet below ----
      const cycInSec = W.barInSec / CB;
      const tones = (track, shift, lo, hi, key, skip) => {
        if (cycInSec % 3 === skip) return;
        const st = (state[key] ||= { s: Math.round((lo + hi) / 2), dir: -1 });
        let prevEnd = null;
        for (const b0 of [0, 2]) {
          const step = r.weighted([[st.dir, 0.55], [0, 0.15], [-st.dir, 0.3]]);
          let s = st.s + step;
          if (s < lo || s > hi) s = st.s - step; // bounce off the edge of the range
          st.s = s;
          if (s === hi) st.dir = -1; else if (s === lo) st.dir = 1;
          const g = bars[b0], hit = [...Array(EB).keys()].find((i) => g.m1[i] === s || g.m2[i] === s);
          const start = b0 * BPB + (hit ?? 0) / 2;
          if (prevEnd) prevEnd.dur = Math.max(1, start - prevEnd.start - 0.5);
          const e = { track, bar: 0, beat: start, dur: CB * BPB - start - r.pick([1, 1.5, 2]), note: sec.slots[s] + shift, vel: (0.5 + r.range(0, 0.08)) * dyn, start };
          ev.push(e); prevEnd = e;
        }
      };
      if (o.fl) tones("flute", 12, 0, 3, "fl", 2);
      if (o.cl) tones("clarinet", -12, 0, 4, "cl", 1);
      ev.forEach((e) => { if (e.start != null) { const p = Sim.compose.at(e.beat, BPB); e.bar = p.bar; e.beat = p.beat; delete e.start; } });

      // ---- labels ----
      const k = bars[0].k, parts = [];
      if (si === 0) parts.push(day === 0 ? (W.barInSec < 8 ? "marimba assembles" : "one marimba") : "pattern substitution");
      else if (si === 1) parts.push(W.barInSec < 8 ? "second marimba builds, +1" : "canon at +1");
      else parts.push(k === 0 ? "unison" : `phase +${k}`);
      if (o.pno) parts.push("additive piano");
      if (o.vib) parts.push(o.vib.startsWith("build") ? "vibes find a resultant" : "vibes resultant");
      if (o.fl) parts.push("flute"); else if (o.cl) parts.push("clarinet");
      return { events: ev, harmony: [{ bar: 0, beat: 0, dur: CB * BPB, chord: sec.sym }], section: `${sec.name} · ${parts.join(" · ")}`, state };
    },
  });
})();
