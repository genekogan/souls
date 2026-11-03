// Sim.theory: pitch, chord symbols, chord scales, voice leading, seeded randomness.
// Pure functions only (no Tone), so pieces' compose() can be linted in Node.
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});

  // ---------- randomness ----------
  function rng(seed) {
    let s = seed >>> 0;
    const r = function () { // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.chance = (p) => r() < p;
    r.pick = (xs) => xs[Math.floor(r() * xs.length)];
    r.int = (a, b) => a + Math.floor(r() * (b - a + 1)); // inclusive
    r.range = (a, b) => a + r() * (b - a);
    r.weighted = (pairs) => { // [[value, weight], ...]
      const total = pairs.reduce((a, p) => a + p[1], 0);
      let x = r() * total;
      for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
      return pairs[pairs.length - 1][0];
    };
    r.gauss = (sd = 1) => { // Box-Muller
      const u = 1 - r(), v = r();
      return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    r.shuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    r.fork = (salt) => rng((s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
    return r;
  }

  // ---------- pitch ----------
  const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11, "B#": 0 };
  const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const mod12 = (x) => ((x % 12) + 12) % 12;
  /** "Eb4" -> 63 */
  function midi(name) {
    if (typeof name === "number") return name;
    const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
    if (!m) throw new Error(`bad note name: ${name}`);
    // Cb and B# belong to the neighbouring octave: Cb5 is B4, B#3 is C4.
    const shift = m[1] === "Cb" ? -12 : m[1] === "B#" ? 12 : 0;
    return PC[m[1]] + 12 * (Number(m[2]) + 1) + shift;
  }
  const noteName = (m) => NAMES[mod12(m)] + (Math.floor(m / 12) - 1);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- scales ----------
  const SCALES = {
    ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10], melodicMinor: [0, 2, 3, 5, 7, 9, 11], harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
    lydianDominant: [0, 2, 4, 6, 7, 9, 10], mixolydianb6: [0, 2, 4, 5, 7, 8, 10], locrianNat2: [0, 2, 3, 5, 6, 8, 10],
    altered: [0, 1, 3, 4, 6, 8, 10], phrygianDominant: [0, 1, 4, 5, 7, 8, 10], halfWhole: [0, 1, 3, 4, 6, 7, 9, 10],
    wholeHalf: [0, 2, 3, 5, 6, 8, 9, 11], wholeTone: [0, 2, 4, 6, 8, 10], majorPent: [0, 2, 4, 7, 9], minorPent: [0, 3, 5, 7, 10],
    sus: [0, 2, 5, 7, 9, 10], blues: [0, 3, 5, 6, 7, 10], lydianAug: [0, 2, 4, 6, 8, 9, 11],
  };
  /** Pitch classes of a scale built on root (pc or name). */
  function scale(rootPc, name) {
    const r = typeof rootPc === "string" ? PC[rootPc] : rootPc;
    const iv = SCALES[name];
    if (!iv) throw new Error(`unknown scale ${name}`);
    return iv.map((i) => mod12(r + i));
  }
  /** Midi notes of a pitch-class set within [lo, hi], ascending. */
  function notesIn(pcs, lo, hi) {
    const set = new Set(pcs.map(mod12)), out = [];
    for (let m = lo; m <= hi; m++) if (set.has(mod12(m))) out.push(m);
    return out;
  }
  /** Move `steps` scale steps from midi `from` within pitch-class set (from need not be in set). */
  function step(from, steps, pcs) {
    const set = new Set(pcs.map(mod12));
    let m = from, n = Math.abs(steps), dir = Math.sign(steps);
    if (dir === 0 || set.size === 0) return m; // an empty set would loop forever
    while (n > 0) { m += dir; if (set.has(mod12(m))) n--; }
    return m;
  }
  /** Nearest midi to `target` whose pitch class is in pcs (ties go up). */
  function nearest(target, pcs, lo = -Infinity, hi = Infinity) {
    const set = new Set(pcs.map(mod12));
    for (let d = 0; d <= 36; d++) {
      for (const m of [target + d, target - d]) if (m >= lo && m <= hi && set.has(mod12(m))) return m;
    }
    // nothing in range: the member closest to the range (never a pitch outside pcs)
    const c = Math.min(hi, Math.max(lo, target));
    for (let d = 0; d <= 12; d++) for (const m of [c + d, c - d]) if (set.has(mod12(m))) return m;
    return c;
  }

  // ---------- chord symbols ----------
  // Supported: C Cm C7 Cmaj7 Cmaj9 Cmaj13 Cmaj7#11 C6 C69 Cm6 Cm69 Cm7 Cm9 Cm11 Cm13 CmMaj7 CmMaj9
  // Cm7b5 Cdim Cdim7 C9 C11 C13 C7sus4 C9sus4 C13sus4 Csus2 Csus4 Cadd9 C5, alterations b9 #9 #11 b13 #5 b5 alt,
  // and slash bass: C9/E, Fmaj7/A.
  const chordCache = new Map();
  function chord(sym) {
    if (chordCache.has(sym)) return chordCache.get(sym);
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    if (!m) throw new Error(`bad chord symbol: ${sym}`);
    const root = PC[m[1]];
    let q = m[2];
    const bass = m[3] != null ? PC[m[3]] : root;
    let third = 4, fifth = 7, seventh = null, sixth = false;
    const ext = new Set(); // 14=9 17=11 21=13 (relative intervals)
    let kind = "major";
    const take = (re) => { const mm = re.exec(q); if (mm) q = q.slice(mm[0].length); return mm; };
    let mm;
    if (take(/^(mMaj|mM|minMaj)/)) { kind = "minorMajor"; third = 3; seventh = 11; mm = take(/^(7|9|11|13)/); addExt(mm ? +mm[1] : 7); }
    else if (take(/^(maj|M|Δ)/)) { kind = "major7"; seventh = 11; mm = take(/^(7|9|11|13)/); addExt(mm ? +mm[1] : 7); }
    else if (take(/^(m7b5|ø7?|min7b5)/)) { kind = "halfDim"; third = 3; fifth = 6; seventh = 10; mm = take(/^(9|11)/); if (mm) addExt(+mm[1]); }
    else if (take(/^(dim7|o7)/)) { kind = "dim7"; third = 3; fifth = 6; seventh = 9; }
    else if (take(/^(dim|o)/)) { kind = "dim"; third = 3; fifth = 6; }
    else if (take(/^(m|min|-)(?!aj)/)) {
      kind = "minor"; third = 3;
      if (take(/^69/)) { sixth = true; ext.add(14); kind = "minor6"; }
      else if (take(/^6/)) { sixth = true; kind = "minor6"; }
      else { mm = take(/^(7|9|11|13)/); if (mm) { seventh = 10; kind = "minor7"; addExt(+mm[1]); } }
    } else if (take(/^69/)) { sixth = true; ext.add(14); kind = "major6"; }
    else if (take(/^6/)) { sixth = true; kind = "major6"; }
    else if (take(/^5/)) { third = null; kind = "power"; }
    else { mm = take(/^(7|9|11|13)/); if (mm) { seventh = 10; kind = "dominant"; addExt(+mm[1], true); } }
    function addExt(n, dominant) {
      if (n >= 9) ext.add(14);
      if (n >= 11 && !(dominant && n === 13) && kind !== "major7") ext.add(17);
      if (n >= 13) ext.add(21);
    }
    const alts = new Set();
    let rest = q;
    const tokens = /(sus4|sus2|sus|add9|add11|alt|b9|#9|#11|b13|#5|b5|\+)/g;
    let tm;
    while ((tm = tokens.exec(rest))) alts.add(tm[1]);
    if (alts.has("sus4") || alts.has("sus")) { third = null; ext.add(17); }
    if (alts.has("sus2")) { third = null; ext.add(14); }
    if (alts.has("add9")) ext.add(14);
    if (alts.has("add11")) ext.add(17);
    if (alts.has("alt")) { alts.add("b9"); alts.add("#9"); alts.add("b13"); fifth = null; }
    if (alts.has("b9")) { ext.delete(14); ext.add(13); }
    if (alts.has("#9")) { ext.delete(14); ext.add(15); }
    if (alts.has("#11")) { ext.delete(17); ext.add(18); }
    if (alts.has("b13")) { ext.delete(21); ext.add(20); if (fifth === 7 && kind === "dominant") fifth = null; }
    if (alts.has("#5") || alts.has("+")) fifth = 8;
    if (alts.has("b5")) fifth = 6;
    const sus = third == null && kind !== "power";

    const iv = [0];
    if (third != null) iv.push(third);
    if (fifth != null) iv.push(fifth);
    if (sixth) iv.push(9);
    if (seventh != null) iv.push(seventh);
    [...ext].sort((a, b) => a - b).forEach((e) => iv.push(e));
    const pcs = [...new Set(iv.map((i) => mod12(root + i)))];
    // guide tones: 3rd (or 4th when sus) and 7th (or 6th)
    const guide = [];
    if (third != null) guide.push(mod12(root + third)); else if (ext.has(17)) guide.push(mod12(root + 5)); else if (ext.has(14)) guide.push(mod12(root + 2));
    if (seventh != null) guide.push(mod12(root + seventh)); else if (sixth) guide.push(mod12(root + 9));
    const colors = [...ext].map((e) => mod12(root + e));
    if (sixth && !guide.includes(mod12(root + 9))) colors.push(mod12(root + 9));

    // chord scale
    let sc;
    const has = (a) => alts.has(a);
    if (kind === "major7" || kind === "major6" || (kind === "major" && !sus)) sc = has("#11") ? "lydian" : has("#5") ? "lydianAug" : "ionian";
    else if (kind === "minor7" || kind === "minor") sc = (has("b13") || ext.has(20)) ? "aeolian" : has("b9") ? "phrygian" : "dorian";
    else if (kind === "minor6" || kind === "minorMajor") sc = "melodicMinor";
    else if (kind === "halfDim") sc = ext.has(14) ? "locrianNat2" : "locrian";
    else if (kind === "dim7" || kind === "dim") sc = "wholeHalf";
    else if (kind === "dominant") {
      if (sus) sc = "sus";
      else if (has("alt") || (has("#9") && (has("b13") || has("#5")))) sc = "altered";
      else if (has("#5") && !has("b9")) sc = "wholeTone";
      else if (has("b9") && has("b13")) sc = "phrygianDominant";
      else if (has("b9") || has("#9")) sc = "halfWhole";
      else if (has("#11")) sc = "lydianDominant";
      else if (has("b13")) sc = "mixolydianb6";
      else sc = "mixolydian";
    } else if (sus) sc = "sus";
    else sc = "ionian";
    const res = { sym, root, bass, kind, intervals: iv, pcs, guide, colors, scaleName: sc, scale: scale(root, sc), sus };
    chordCache.set(sym, res);
    return res;
  }

  // ---------- voicing ----------
  /**
   * Choose a voicing for a chord that leads smoothly from `prev`.
   * opts: lo, hi (midi range for all voices), n (voices), rootless (drop root), prev (midi[]),
   *       top ([lo,hi] preferred range for top voice), spread ('close'|'drop2'|'open'|'any'), rng
   */
  function voice(sym, opts = {}) {
    const c = typeof sym === "string" ? chord(sym) : sym;
    const { lo = 48, hi = 76, rootless = true, prev = null, top = null, spread = "any", rng: r = null, avoidRootOnTop = true, omitBass = false } = opts;
    const want = opts.n ?? 4;
    // omitBass: leave a slash chord's bass note to the bass player (avoids doubling e.g. a leading tone)
    const keep = (p) => !(omitBass && c.bass !== c.root && p === c.bass);
    // Tone set by priority: (root when not rootless), guide tones, colors, 5th, then root and any other chord tone to fill.
    let pri = [];
    if (!rootless) pri.push(c.root);
    c.guide.forEach((p) => pri.push(p));
    c.colors.forEach((p) => pri.push(p));
    const fifth = c.intervals.find((i) => i === 7 || i === 6 || i === 8);
    if (fifth != null) pri.push(mod12(c.root + fifth));
    pri = [...new Set(pri)].filter(keep);
    if (pri.length < want && keep(c.root) && !pri.includes(c.root)) pri.push(c.root);
    for (const p of c.pcs) if (pri.length < want && keep(p) && !pri.includes(p)) pri.push(p);
    const n = Math.min(want, pri.length); // never pad with unisons
    // stack in pitch order above the root, so "close" really is close position
    const tones = pri.slice(0, Math.max(n, 1)).sort((a, b) => mod12(a - c.root) - mod12(b - c.root));

    const cands = [];
    const k = tones.length;
    const perms = rotations(tones);
    for (const order of perms) {
      for (let startOct = 1; startOct <= 7; startOct++) {
        // close stack upward
        const close = [];
        let cur = order[0] + 12 * startOct;
        close.push(cur);
        for (let i = 1; i < k; i++) { let x = order[i] + 12 * Math.floor(cur / 12); while (x <= cur) x += 12; close.push(x); cur = x; }
        const variants = [];
        if (spread === "close" || spread === "any") variants.push(close);
        if ((spread === "drop2" || spread === "any") && k >= 4) { const d = close.slice(); d[k - 2] -= 12; variants.push(d.sort((a, b) => a - b)); }
        if ((spread === "open" || spread === "any") && k >= 4) { const d = close.slice(); d[k - 2] -= 12; d[k - 4] -= 12; variants.push(d.sort((a, b) => a - b)); }
        for (const v of variants) if (v[0] >= lo && v[v.length - 1] <= hi) cands.push(v);
      }
    }
    if (!cands.length) { // fall back: fold everything into range
      const v = tones.map((p) => nearest(Math.round((lo + hi) / 2), [p], lo, hi)).sort((a, b) => a - b);
      return v;
    }
    let best = null, bestScore = Infinity;
    for (const v of cands) {
      let s = 0;
      // muddiness: small intervals low down
      for (let i = 1; i < v.length; i++) {
        const gap = v[i] - v[i - 1];
        if (v[i - 1] < 52 && gap < 5) s += 6;
        if (v[i - 1] < 45 && gap < 7) s += 10;
        if (v[i - 1] < 55 && gap <= 2) s += 5;             // seconds below G3
        if (gap === 1) s += i === v.length - 1 ? 5 : v[i - 1] < 60 ? 6 : 3; // semitones: top, low inner, inner
      }
      if (avoidRootOnTop && mod12(v[v.length - 1]) === c.root && rootless) s += 3;
      if (prev && prev.length) {
        const a = v.slice().sort((x, y) => x - y), b = prev.slice().sort((x, y) => x - y);
        const m = Math.min(a.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(a[a.length - 1 - i] - b[b.length - 1 - i]) * 0.9;
        const ca = (a[0] + a[a.length - 1]) / 2, cb = (b[0] + b[b.length - 1]) / 2;
        s += Math.abs(ca - cb) * 0.6;
      } else {
        s += Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2) * 0.5;
      }
      if (top) { const t = v[v.length - 1]; if (t < top[0]) s += (top[0] - t) * 1.5; if (t > top[1]) s += (t - top[1]) * 1.5; }
      if (r) s += r() * 1.5;
      if (s < bestScore) { bestScore = s; best = v; }
    }
    return best.slice();
  }
  function rotations(xs) { return xs.map((_, i) => xs.slice(i).concat(xs.slice(0, i))); }

  // ---------- harmony timeline ----------
  /**
   * Parse a compact progression: "| Ebmaj9 | Gm9 C13 | ..." -> [{bar, beat, dur, chord}] with
   * chords inside a bar sharing it evenly (or explicit "C13:3" = 3 beats). beatsPerBar default 4.
   */
  function progression(text, beatsPerBar = 4) {
    const bars = text.split("|").map((s) => s.trim()).filter((s) => s.length);
    const out = [];
    bars.forEach((bar, bi) => {
      const toks = bar.split(/\s+/);
      const explicit = toks.map((t) => (t.includes(":") ? Number(t.split(":")[1]) : null));
      const fixed = explicit.reduce((a, x) => a + (x || 0), 0);
      const free = explicit.filter((x) => x == null).length;
      const each = free ? (beatsPerBar - fixed) / free : 0;
      let beat = 0;
      toks.forEach((t, i) => {
        const sym = t.split(":")[0];
        const dur = explicit[i] != null ? explicit[i] : each;
        if (sym !== "%") { chord(sym); out.push({ bar: bi, beat, dur, chord: sym }); }
        else if (out.length) out[out.length - 1].dur += dur;
        beat += dur;
      });
    });
    return out;
  }
  /** Lookup helper over a timeline: returns the chord entry active at absolute beat b. */
  function chordAtFactory(timeline, beatsPerBar = 4) {
    const abs = timeline.map((e) => ({ ...e, start: e.bar * beatsPerBar + e.beat })).sort((a, b) => a.start - b.start);
    return function (b) {
      let cur = abs[0];
      for (const e of abs) { if (e.start <= b + 1e-6) cur = e; else break; }
      return cur;
    };
  }

  Sim.theory = { rng, PC, NAMES, mod12, midi, noteName, hz, SCALES, scale, notesIn, step, nearest, chord, voice, progression, chordAtFactory };
})(typeof window !== "undefined" ? window : globalThis);
