// Sim.compose: reusable composition helpers (pure, Node-safe).
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const T = Sim.theory;
  const { mod12 } = T;

  const SPARSE = [[[1], 3], [[2], 3], [[1.5, 0.5], 3], [[0.5, 0.5, 1], 2], [[1, 1], 2], [[3], 1], [[0.5, 1.5], 1.5]];
  const DENSE = [[[0.5, 0.5], 4], [[0.5, 0.5, 0.5, 0.5], 3], [[0.5, 1, 0.5], 2], [[1, 0.5, 0.5], 2], [[1.5, 0.5], 1]];

  /** Rhythm for one phrase: [{off, dur}] spanning about `len` beats. */
  function phraseRhythm(r, len, density) {
    const out = [];
    let pos = 0;
    while (pos < len - 0.25) {
      if (pos > 0 && r.chance((1 - density) * 0.18)) { pos += r.pick([0.5, 1]); continue; }
      const cell = r.weighted(r.chance(density) ? DENSE : SPARSE);
      for (const d of cell) { if (pos >= len - 0.25) break; out.push({ off: pos, dur: Math.min(d, len - pos) }); pos += d; }
    }
    return out;
  }

  /**
   * An improvised or composed-sounding melodic line over changing harmony.
   * opts:
   *   start, end        absolute beats
   *   chordAt(b)        -> chord symbol string at absolute beat b
   *   lo, hi            midi range
   *   rng               Sim.theory.rng instance
   *   density 0..1      how busy (0.2 lyrical, 0.7 bebop-ish)
   *   phrase [a,b]      phrase length range in beats; rest [a,b] gap range in beats
   *   motif             { rhythm, steps } from a previous call, reused with prob motifProb
   *   chromatic 0..1    chance of chromatic approach into strong notes
   *   register 0..1     center of the contour within [lo, hi]
   *   prev              previous midi note for continuity
   *   scaleFor(sym)     optional override for chord-scale pitch classes
   *   upbeatStart       chance a phrase starts on an offbeat
   * returns { notes: [{beat, dur, note, vel, strong}], motif, last }
   */
  function line(opts) {
    const r = opts.rng, lo = opts.lo, hi = opts.hi;
    const density = opts.density ?? 0.4, chromatic = opts.chromatic ?? 0.15;
    const [pa, pb] = opts.phrase || [4, 8], [ra, rb] = opts.rest || [1, 3];
    const scaleFor = opts.scaleFor || ((s) => T.chord(s).scale);
    const notes = [];
    let motif = opts.motif || null, prev = opts.prev ?? Math.round(lo + (hi - lo) * (opts.register ?? 0.5));
    let t = opts.start + (opts.lead ?? 0);
    let first = true;
    while (t < opts.end - 1) {
      const room = opts.end - t;
      let len = Math.min(room, r.int(pa, pb));
      const useMotif = motif && !first && r.chance(opts.motifProb ?? 0.5) && motif.len <= room + 0.01;
      let rhythm;
      if (useMotif) { rhythm = motif.rhythm; len = motif.len; }
      else {
        rhythm = phraseRhythm(r, len, density);
        if (r.chance(opts.upbeatStart ?? 0.35) && rhythm.length > 2) { // start the phrase on an offbeat
          if (rhythm[0].dur >= 1) rhythm = [{ off: rhythm[0].off + 0.5, dur: rhythm[0].dur - 0.5 }, ...rhythm.slice(1)];
          else rhythm = rhythm.slice(1);
        }
      }
      if (!rhythm.length) { t += len; continue; }
      const center = lo + (hi - lo) * (opts.register ?? 0.5) + r.gauss(2);
      const amp = (hi - lo) * 0.22;
      const shape = r.pick(["arch", "arch", "fall", "rise", "wave"]);
      const contour = (u) => center + amp * (shape === "arch" ? Math.sin(Math.PI * u) - 0.4 : shape === "fall" ? 0.6 - 1.1 * u : shape === "rise" ? -0.5 + u : 0.5 * Math.sin(2 * Math.PI * u));
      const ph = rhythm.map((x, i) => {
        const beat = t + x.off;
        const onBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
        return { beat, dur: x.dur, strong: i === 0 || i === rhythm.length - 1 || (onBeat && (x.dur >= 1 || mod(beat, 2) < 1e-6)) || x.dur >= 1.5, u: rhythm.length > 1 ? i / (rhythm.length - 1) : 0.5 };
      });
      // pass 1: anchors on strong notes
      let a = prev;
      const steps = useMotif ? motif.steps : null;
      ph.forEach((n, i) => {
        if (!n.strong) return;
        const sym = opts.chordAt(n.beat), c = T.chord(sym);
        const tones = c.guide.concat(c.colors).concat(c.colors).concat([mod12(c.root + 7), c.root]);
        const cands = T.notesIn(tones, lo, hi);
        const target = contour(n.u);
        let pick = null, best = Infinity;
        for (const m of cands) {
          const leap = Math.abs(m - a);
          let s = Math.abs(m - target) * 0.5 + (leap > 7 ? (leap - 7) * 1.2 : 0) + (leap === 0 ? 2.5 : 0);
          if (m % 12 === c.root && i === ph.length - 1) s += 2.5; // end phrases on color, not root
          if (steps && i > 0) { const want = a + steps[i] * 1.6; s = s * 0.5 + Math.abs(m - want) * 0.8; }
          s += r() * 2.2;
          if (s < best) { best = s; pick = m; }
        }
        n.note = pick ?? T.nearest(Math.round(target), c.pcs, lo, hi);
        a = n.note;
      });
      // pass 2: weak notes walk between anchors
      let lastNote = prev;
      for (let i = 0; i < ph.length; i++) {
        const n = ph[i];
        if (n.strong) { lastNote = n.note; continue; }
        let j = i; while (j < ph.length && !ph[j].strong) j++;
        const next = j < ph.length ? ph[j].note : lastNote;
        const sc = scaleFor(opts.chordAt(n.beat));
        const isLastBeforeAnchor = j === i + 1 && j < ph.length;
        if (isLastBeforeAnchor && r.chance(chromatic)) n.note = next + (r.chance(0.6) ? -1 : 1);
        else if (isLastBeforeAnchor && Math.abs(next - lastNote) <= 2) n.note = T.step(next, r.chance(0.5) ? 1 : -1, sc); // neighbour
        else { const dir = Math.sign(next - lastNote) || (r.chance(0.5) ? 1 : -1); n.note = T.step(lastNote, dir * (r.chance(0.8) ? 1 : 2), sc); }
        n.note = Math.max(lo, Math.min(hi, n.note));
        lastNote = n.note;
      }
      ph.forEach((n, i) => {
        const end = i === ph.length - 1;
        notes.push({ beat: n.beat, dur: n.dur * (end ? 1 : 0.92), note: n.note, vel: 0.6 + (n.strong ? 0.1 : 0) + (end ? -0.05 : 0) + r.gauss(0.04), strong: n.strong });
      });
      if (!useMotif) {
        motif = { len, rhythm, steps: ph.map((n, i) => (i ? Math.sign(n.note - ph[i - 1].note) * Math.min(4, Math.abs(n.note - ph[i - 1].note) / 1.6) : 0)) };
      }
      prev = ph[ph.length - 1].note;
      first = false;
      t += len + r.range(ra, rb);
      t = Math.round(t * 2) / 2;
    }
    return { notes, motif, last: prev };
  }
  const mod = (x, m) => ((x % m) + m) % m;

  /** Events in one cycle -> relative bar/beat helper. */
  function at(absBeat, beatsPerBar) { const bar = Math.floor(absBeat / beatsPerBar + 1e-9); return { bar, beat: absBeat - bar * beatsPerBar }; }

  Sim.compose = { line, phraseRhythm, at };
})(typeof window !== "undefined" ? window : globalThis);
