// Rice Terraces: Javanese gamelan for a terraced-farming civilization.
//
// Two original gendhing alternate, the way a klenèngan moves between tunings:
//   Ketawang Sengkedan (sléndro manyura, 16-beat gongan): bonang or gendèr buka, then irama tanggung
//     (loud: saron, demung, peking 2x, bonang mipil 2x / 4x), the kendang slows the ensemble into irama
//     dadi (soft: slenthem, gendèr 8x, suling), sometimes on into irama wiled (gendèr 16x), back through
//     dadi with the ngelik, a seseg into loud tanggung, and a suwuk that drags the last gatra into the gong.
//   Lancaran Panen (pélog nem, 16-beat nibani gongan): fast irama lancar with bonang gembyang nyegat,
//     a slowing into irama tanggung with interlocking bonang imbal and sekaran flourishes, seseg, suwuk.
//
// Time: the balungan beat is the unit of musical time. Each gongan has its own list of beat durations
// (engine beats), so the kendang's slowings and speedings are real tempo curves; the elaborating parts
// are written as subdivisions of the balungan beat, so when the beat stretches they double their density
// (peking strokes per balungan beat: lancar 1, tanggung 2, dadi 4, wiled 8). Music is generated a gongan
// at a time into a queue; compose() hands the conductor whatever falls inside its 4-bar window.
//
// Tuning: instruments are struck with frequencies computed from sléndro / pélog tables (stretched
// 1206-cent octaves; pélog shares its 6 with sléndro, "tumbuk nem"). Every metallophone and gong is a
// pengumbang/pengisep pair: a twin tuned a few Hz sharp, panned apart, so each stroke beats (ombak).
// The `note` field carries the nearest 12-TET midi only for the linter, score and UI.
(function () {
  "use strict";
  const BPB = 4, BARS = 4, WIN = BPB * BARS;
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dbg = (db) => Math.pow(10, db / 20);

  // ---------- tuning ----------
  // Degree index k: 0..4 = 1 2 3 5 6 of the saron's middle octave; k-5 one octave down, k+5 up.
  const OCT = 1206;
  const SL = {
    name: "sléndro", cents: [0, 228, 474, 711, 963], f1: 295, midi0: 62, off: [0, 2, 5, 7, 10], // ≈ D E G A C
    chord: ["C6add9/D", "C6add9/E", "C6add9/G", "C6add9/A", "C6add9"],
  };
  const PL = {
    name: "pélog", cents: [0, 120, 290, 690, 790], midi0: 64, off: [0, 1, 3, 7, 8], // ≈ E F G B C (1 2 3 5 6)
    chord: ["Cmaj7add11/E", "Cmaj7add11/F", "Cmaj7add11/G", "Cmaj7add11/B", "Cmaj7add11"],
  };
  const freqOf = (L, k) => L.f1 * Math.pow(2, (Math.floor(k / 5) * OCT + L.cents[mod(k, 5)]) / 1200);
  PL.f1 = freqOf(SL, 4) / Math.pow(2, PL.cents[4] / 1200); // tumbuk nem
  const midiOf = (L, k) => L.midi0 + 12 * Math.floor(k / 5) + L.off[mod(k, 5)];
  const fmOf = (L, k) => 69 + 12 * Math.log2(freqOf(L, k) / 440); // exact pitch as fractional midi
  const fold = (k, lo, hi) => { while (k > hi) k -= 5; while (k < lo) k += 5; return k; };
  const GONG_K = 1 - 15; // sléndro 2, three octaves down (~42 Hz): the gong ageng

  // ---------- the gendhing ----------
  // Balungan: one token per beat; 1 2 3 5 6, "_" an octave down, "^" up, "." a pin (rest).
  const DEG = { 1: 0, 2: 1, 3: 2, 5: 3, 6: 4 };
  const parse = (s) => s.trim().split(/\s+/).map((t) => (t === "." ? null : DEG[t[0]] + (t[1] === "_" ? -5 : t[1] === "^" ? 5 : 0)));
  const FORMS = {
    ketawang: { N: 16, kenong: [8, 16], kempul: [12], kethuk: [2, 6, 10, 14], kempyang: [1, 3, 5, 7, 9, 11, 13, 15] },
    lancaran: { N: 16, kenong: [4, 8, 12, 16], kempul: [6, 10, 14], kethuk: [1, 3, 5, 7, 9, 11, 13, 15], kempyang: [] },
  };
  const GD = {
    ketawang: {
      title: "Ketawang Sengkedan", L: SL, form: "ketawang",
      // umpak: a slow wave stepping down the terraces to the gong on low 6
      A: parse("3 5 6 5  2 1 2 3  5 6 3 2  3 2 1 6_"),
      // ngelik: hangs on 6, climbs to the top terrace, falls to gong 2
      B: parse("6 6 . .  3 5 6 1^  6 5 3 5  6 5 3 2"),
      buka: parse(". 5 6 1^  6 5 3 2  . 1 . 6_"),
      bukaD: 1.12, suwuk: [1.0, 1.28, 1.7, 2.4],
    },
    lancaran: {
      title: "Lancaran Panen", L: PL, form: "lancaran",
      A: parse(". 2 . 3  . 2 . 1  . 2 . 3  . 5 . 6"), // up the terraces
      B: parse(". 5 . 6  . 5 . 3  . 2 . 1  . 2 . 6_"), // and down
      buka: parse(". 5 . 3  . 2 . 1  . 2 . 6_"),
      bukaD: 0.56, suwuk: [1.25, 1.65, 2.25, 3.3],
    },
  };
  const IRAMA = ["lancar", "tanggung", "dadi", "wiled"];

  // ---------- kendang ----------
  // Strokes: D dhung (big head), d light dhung, t tak (slap), n tung (small head open), k ket (damped),
  // H dhang (dhung + tak). One string per gatra; its length / 4 = strokes per balungan beat, and the
  // last character of each beat-group falls on the beat.
  const KEN = {
    k0: [".t.d.t.D", "kt.d.t.d", ".t.dkt.D"], k0end: ".t.dt.dH",
    k1: ["...t..kd...t.d.D", "...n.t.d...t..kd", ".k.t...d.t.t...d"], k1kenong: "...t.k.d.t.d...H", k1gong: ".t.t...d.t.t.d.H",
    k2: [".k.t.d.t.k.d.t.d", "...t.d.n...d.t.D", ".k.n...t.d.t.k.d"], k2kenong: ".k.t...d.t.d.t.H", k2gong: "...t.d.t.k.d.t.H",
    k3: [".k.t.k.d...t.d.d", "...n.k.d.k.t...D", ".k.t...d.t.n.k.d"], k3kenong: ".k.t...d.t.t.d.H", k3gong: "...t.d.k.t.k.d.H",
    slow: "..tdt.D...tdt.DH", fast: "t.tD.t.D.ttD.t.H", suwuk: "...t...d.t.d...H",
    slow0: "t.tdt.DH", fast0: "ttD.ttDH",
    buka1: "...t.t.d...t.d.H", buka0: ".t.t.d.H", imbal: ["...t.d.t.k.d.t.D", ".k.t.t.d...t.k.d"],
  };
  const STROKE = { D: "DHUNG", d: "dhung", t: "tak", n: "tung", k: "ket", H: "DHANG" };
  const KVEL = { D: 0.8, d: 0.5, t: 0.6, n: 0.5, k: 0.26, H: 0.86 };

  // ---------- gendèr cells (scale steps relative to the cell's last note) ----------
  const CELLS = [[1, 2, 1, 0], [-1, -2, -1, 0], [3, 2, 1, 0], [-3, -2, -1, 0], [0, 1, -1, 0], [1, 0, 1, 0],
    [-1, 0, -1, 0], [2, 1, -1, 0], [-2, -1, 1, 0], [0, -1, 1, 0], [1, -1, 1, 0], [2, 1, 2, 0]];
  // bonang sekaran: 8 strokes over two beats onto the seleh
  const SEKAR = [[3, 2, 1, 2, 3, 2, 1, 0], [1, 2, 3, 2, 1, 0, 1, 0], [-1, 0, 1, 2, 1, 0, -1, 0], [2, 3, 2, 1, 2, 1, -1, 0], [0, 1, 0, -1, 1, 2, 1, 0]];

  // ---------- performance plans ----------
  function planKetawang(r, set, L) {
    const genderBuka = set % 2 === 1;
    const wiled = r.chance(set === 0 ? 0.55 : 0.7);
    const p = [{ type: "buka", gd: "ketawang", inst: genderBuka ? "gender" : "bonang" }];
    const style1 = genderBuka ? "soft" : "loud";
    p[0].L = L;
    const G = (sec, lv, o = {}) => p.push({ type: "gongan", gd: "ketawang", L, sec, lv, lv2: o.lv2 ?? lv, D: o.D ?? [0, 1, 2, 4][lv], style: o.style ?? (lv >= 2 ? "soft" : style1), ...o });
    G("A", 1, { D0: 1.08, dyn: [0.8, 0.86] });
    if (r.chance(0.5)) G("A", 1, { dyn: [0.86, 0.9] });
    G("A", 1, { ramp: [8, 2], switchAt: 12, lv2: 2, signal: "slow", dyn: [0.9, 0.6] });
    G("A", 2, { dyn: [0.6, 0.64] });
    G("B", 2, { dyn: [0.66, 0.78] });
    if (wiled) {
      G("A", 2, { ramp: [8, 4], switchAt: 12, lv2: 3, signal: "slow", dyn: [0.74, 0.58] });
      G("B", 3, { dyn: [0.58, 0.68] });
      G("A", 3, { ramp: [8, 2], switchAt: 12, lv2: 2, signal: "fast", dyn: [0.66, 0.66] });
      G("B", 2, { dyn: [0.68, 0.8] });
    } else {
      G("A", 2, { dyn: [0.72, 0.64] });
      G("B", 2, { dyn: [0.66, 0.8] });
    }
    G("A", 2, { ramp: [8, 1], switchAt: 12, lv2: 1, signal: "fast", dyn: [0.78, 0.95], style: "loud" });
    G("A", 1, { dyn: [0.97, 1.0], style: "loud" });
    if (r.chance(0.4)) G("B", 1, { dyn: [1.0, 0.95], style: "loud" });
    G("A", 1, { suwuk: true, dyn: [0.95, 0.82], style: "loud" });
    p.push({ type: "gap", beats: 11 });
    return p;
  }
  function planLancaran(r, L) {
    const p = [{ type: "buka", gd: "lancaran", inst: "bonang", L }];
    const G = (sec, lv, o = {}) => p.push({ type: "gongan", gd: "lancaran", L, sec, lv, lv2: o.lv2 ?? lv, D: o.D ?? [0.5, 1][lv], style: lv ? "imbal" : "nyegat", ...o });
    G("A", 0, { dyn: [0.82, 0.88] }); G("B", 0, { dyn: [0.88, 0.9] });
    G("A", 0, { dyn: [0.9, 0.9] }); G("B", 0, { ramp: [8, 1], switchAt: 12, lv2: 1, signal: "slow", dyn: [0.9, 0.78] });
    const n = r.pick([4, 6]);
    for (let i = 0; i < n; i++) G(i % 2 ? "B" : "A", 1, { dyn: i === n - 1 ? [0.84, 0.92] : [0.78 + 0.03 * i, 0.82 + 0.03 * i] });
    G("A", 1, { ramp: [8, 0.5], switchAt: 12, lv2: 0, signal: "fast", dyn: [0.92, 0.95] });
    G("B", 0, { dyn: [0.95, 0.95] }); G("A", 0, { dyn: [0.95, 0.92] });
    G("B", 0, { suwuk: true, dyn: [0.92, 0.8] });
    p.push({ type: "gap", beats: 10 });
    return p;
  }

  // ---------- generation ----------
  function generateNext(st, r) {
    if (!st.plan.length) {
      // every new piece changes laras (pindah laras): ketawang sl, lancaran pl, ketawang pl, lancaran sl, ...
      const n = st.set, L = Math.floor(n / 2) % 2 === 0 ? (n % 2 ? PL : SL) : (n % 2 ? SL : PL);
      st.plan = n % 2 === 0 ? planKetawang(r, n / 2, L) : planLancaran(r, L);
      st.set++;
    }
    const g = st.plan.shift();
    if (g.type === "gap") { st.t += g.beats; st.tGen = st.t; return; }
    genGongan(st, r, g);
  }

  function genGongan(st, r, g) {
    const gd = GD[g.gd], L = g.L || gd.L, buka = g.type === "buka";
    const bal = buka ? gd.buka : gd[g.sec];
    const N = bal.length, F = FORMS[gd.form];
    // ---- tempo: duration (engine beats) of the interval leading to each balungan beat ----
    const D = buka ? gd.bukaD : g.D;
    const Ds = Array.from({ length: N }, () => D);
    if (buka) for (let i = 0; i < N; i++) Ds[i] = D * (i >= N - 2 ? 1.06 + 0.06 * (i - N + 3) : 1);
    if (g.D0) for (let i = 0; i < 4; i++) Ds[i] = g.D0 + (D - g.D0) * (i / 4);
    if (g.ramp) { const [a, D1] = g.ramp; for (let i = a; i < N; i++) Ds[i] = D * Math.pow(D1 / D, (i - a + 1) / (N - a)); }
    if (g.suwuk) {
      for (let i = 0; i < N - 4; i++) Ds[i] = D * (1 - 0.12 * Math.min(1, (i + 1) / 8));
      for (let i = 0; i < 4; i++) Ds[N - 4 + i] = D * gd.suwuk[i];
    }
    // Snap: every gongan lasts a whole number of bars, so steady irama sits on the grid and each gong
    // falls on a downbeat; the buka is an anacrusis that starts wherever it must to land its gong there.
    const total = Ds.reduce((a, x) => a + x, 0);
    if (buka) st.t = Math.ceil((st.t + total) / BPB - 1e-9) * BPB - total;
    else {
      // stretch only the beats that are already off the steady tempo (ramps, settling, the suwuk)
      const want = Math.max(BPB, Math.round(total / BPB) * BPB);
      const loose = Ds.map((x) => Math.abs(x - D) > 1e-9);
      const lsum = Ds.reduce((a, x, i) => a + (loose[i] ? x : 0), 0);
      if (lsum > 0) for (let i = 0; i < N; i++) { if (loose[i]) Ds[i] *= (want - (total - lsum)) / lsum; }
      else for (let i = 0; i < N; i++) Ds[i] *= want / total;
    }
    const P = [st.t];
    for (let i = 0; i < N; i++) P.push(P[i] + Ds[i]);
    const tm = (x) => { const i = clamp(Math.floor(x), 0, N - 1); return P[i] + (x - i) * Ds[i]; };
    const lvAt = (beat) => (buka ? 1 : beat > (g.switchAt ?? N) ? g.lv2 : g.lv);
    const styleAt = (beat) => {
      if (buka) return "buka";
      const lv = lvAt(beat);
      if (g.gd === "lancaran") return lv ? "imbal" : "nyegat";
      if (lv >= 2) return "soft";
      return beat > (g.switchAt ?? N) ? "loud" : g.style;
    };
    const dyn0 = g.dyn ? g.dyn[0] : 0.8, dyn1 = g.dyn ? g.dyn[1] : 0.8;
    const dyn = (x) => dyn0 + (dyn1 - dyn0) * clamp(x / N, 0, 1);
    const ev = (track, x, dur, k, vel, extra) => st.queue.push({ track, at: tm(x), dur, note: k == null ? STROKE[extra.stroke] : Array.isArray(k) ? k.map((m) => midiOf(L, m)) : midiOf(L, k), ks: k, L: L === SL ? "sl" : "pl", vel: clamp(vel, 0.05, 1), ...extra });
    const durTo = (x0, x1) => tm(x1) - tm(x0);

    // ---- balungan helpers ----
    const note = (i) => (i >= 1 && i <= N ? bal[i - 1] : null);
    const held = (i) => { for (let j = Math.min(i, N); j >= 1; j--) if (note(j) != null) return note(j); return st.last ?? bal.find((x) => x != null); };
    const nextSounding = (i) => { for (let j = i + 1; j <= N; j++) if (note(j) != null) return j; return null; };
    const pairs = [];
    for (let p = 1; p < N; p += 2) {
      let a = note(p), b = note(p + 1);
      if (b == null) b = a ?? held(p);
      if (a == null) a = b;
      pairs.push({ p, a, b });
    }

    // ---- harmony / section labels (one per gatra, named by its seleh) ----
    const secName = buka ? `buka · ${g.inst === "gender" ? "gendèr" : "bonang"}` : g.suwuk ? "suwuk" : g.gd === "ketawang" ? (g.sec === "A" ? "umpak" : "ngelik") : `gongan ${g.sec}`;
    for (let q = 0; q < N / 4; q++) st.hq.push({ at: P[q * 4], chord: L.chord[mod(held(q * 4 + 4), 5)] });
    const iramaLabel = buka ? "" : g.lv2 !== g.lv ? ` · irama ${IRAMA[g.lv]} → ${IRAMA[g.lv2]}` : ` · irama ${IRAMA[g.lv]}`;
    st.sq.push({ at: P[0], label: `${gd.title}, ${L.name}${iramaLabel} · ${secName}` });

    // ---- balungan: saron, demung (loud) or slenthem (soft) ----
    for (let i = 1; i <= N; i++) {
      const k = note(i);
      if (k == null) continue;
      const nx = nextSounding(i), ring = nx ? durTo(i, nx) : Ds[N - 1] * 2;
      const style = styleAt(i), x = i, d = dyn(i);
      const ks = fold(k, -1, 5);
      if (buka && i < N) continue; // the soloist owns the buka; everyone lands on its gong
      const soft = style === "soft";
      const kenongBeat = F.kenong.includes(i);
      ev("saron", x, ring + 0.06, ks, (soft ? 0.42 : 0.76) * d * (kenongBeat ? 1.08 : 1));
      if (!soft) ev("demung", x, ring + 0.1, ks - 5, 0.68 * d * (i % 2 === 0 ? 1.05 : 0.95));
      if (soft || buka) ev("slenthem", x, ring + 0.5, ks - 10, 0.6 * d);
    }

    // ---- peking: a a b b, anticipating each pair ----
    if (!buka) for (const { p, a: a0, b } of pairs) {
      const lv = lvAt(p + 1), m = Math.pow(2, lv), soft = styleAt(p + 1) === "soft";
      // nibani: at 2x and above, the pin is filled with the last note (prev prev b b); at 1x it anticipates b
      const a = m > 1 && note(p) == null && note(p + 1) != null ? held(p - 1) : a0;
      if (g.suwuk && p >= N - 1) { ev("peking", N, 1.5, fold(b, -1, 5) + 5, 0.5 * dyn(N)); continue; }
      for (let s = 1; s <= 2 * m; s++) {
        const x = p - 1 + s / m;
        const k = m === 1 ? (s === 1 ? a : b) : Math.floor((s - 1) / 2) % 2 === 0 ? a : b;
        const onBeat = Math.abs(x - Math.round(x)) < 1e-9;
        ev("peking", x, durTo(x, x + 1 / m) + 0.04, fold(k, -1, 5) + 5, (soft ? 0.38 : 0.5) * dyn(x) * (onBeat ? 1.12 : 0.92));
      }
    }

    // ---- bonang ----
    if (buka && g.inst === "bonang") bonangBuka();
    if (!buka) for (const { p, a, b } of pairs) {
      const style = styleAt(p + 1), x0 = p - 1;
      const gatraEnd = (p + 1) % 4 === 0, structural = F.kenong.includes(p + 1);
      if (style === "loud") {
        const bB = fold(b, -1, 5), aB = nearestOct(a, bB);
        const lastGatra = g.suwuk && p + 1 > N - 4;
        if ((gatraEnd && structural && r.chance(0.5)) || lastGatra || a === b && note(p) == null) {
          // nggembyang: octaves on the beats
          const dy = bB - 5 >= -5 ? [bB - 5, bB] : [bB, bB + 5];
          ev("bonang", p, durTo(p, p + 1) * 0.9, dy, 0.62 * dyn(p));
          ev("bonang", p + 1, 1.2, dy, 0.7 * dyn(p + 1));
          if (!lastGatra) ev("bonang", p + 0.5, durTo(p, p + 0.5), bB, 0.45 * dyn(p));
        } else {
          [[x0 + 0.5, aB], [p, bB], [p + 0.5, aB], [p + 1, bB]].forEach(([x, k], i) =>
            ev("bonang", x, durTo(x, x + 0.5) + 0.25, k, (i % 2 ? 0.64 : 0.54) * dyn(x)));
        }
        // panerus: the same pair at double speed an octave up
        if (!lastGatra) for (let s = 1; s <= 8; s++) {
          const x = x0 + s / 4, k = (s % 2 ? aB : bB) + 5;
          ev("panerus", x, durTo(x, x + 0.25) + 0.12, k, (s % 2 ? 0.36 : 0.44) * dyn(x));
        } else ev("panerus", p + 1, 1.2, bB + 5, 0.45 * dyn(p + 1));
      } else if (style === "nyegat") {
        // lancar: bonang barung octaves on the pin, anticipating the coming note; panerus on every off-beat
        const bB = fold(b, -1, 5);
        const dy = bB - 5 >= -5 ? [bB - 5, bB] : [bB, bB + 5];
        ev("bonang", p, durTo(p, p + 1) + 0.15, dy, 0.6 * dyn(p));
        if (g.suwuk && p + 1 === N) ev("bonang", N, 2, dy, 0.66 * dyn(N));
        [p - 0.5, p + 0.5].forEach((x) => ev("panerus", x, durTo(x, x + 0.5) + 0.05, bB + 5, 0.4 * dyn(x)));
      } else if (style === "imbal") {
        const q = (p + 1) / 4;
        const sek = gatraEnd && !(g.switchAt && p + 1 === g.switchAt) && r.chance(q === N / 4 ? 0.9 : q === 2 ? 0.45 : 0.12);
        imbalPair(p, b, sek);
      }
    }

    // ---- gendèr ----
    if (buka && g.inst === "gender") genderPairs(pairs, () => 4, 0.5);
    else if (!buka) genderPairs(pairs.filter(({ p }) => styleAt(p + 1) === "soft"), (p) => Math.pow(2, lvAt(p + 1) + 1), 0.42);

    // ---- suling ----
    if (!buka && g.gd === "ketawang") suling();

    // ---- colotomy ----
    if (!buka) {
      for (const i of F.kethuk) {
        const s = styleAt(i), soft = s === "soft";
        ev("kethuk", i, 0.4, -4, (soft ? 0.42 : 0.56) * dyn(i));
      }
      for (const i of F.kempyang) {
        const lv = lvAt(i), soft = styleAt(i) === "soft";
        if (g.suwuk && i > N - 4) continue;
        ev("kempyang", i, 0.5, 9, (soft ? 0.3 : 0.4) * dyn(i));
        if (lv >= 2) ev("kempyang", i - 0.5, 0.5, 9, (soft ? 0.24 : 0.32) * dyn(i));
      }
      for (const i of F.kempul) {
        if (g.suwuk && i > N - 4) continue;
        ev("kempul", i, g.gd === "lancaran" ? 5 : 8, fold(held(i), -10, -6), (styleAt(i) === "soft" ? 0.58 : 0.72) * dyn(i));
      }
      for (const i of F.kenong) ev("kenong", i, 6, fold(held(i), -1, 3), (styleAt(i) === "soft" ? 0.5 : 0.66) * dyn(i) * (i === N ? 1.08 : 1));
    }
    // gong: ageng for the ketawang and every ending; a smaller pitched suwukan in the running lancaran
    const finalGong = buka || g.suwuk || g.gd === "ketawang";
    const gongK = g.gd === "lancaran" && !finalGong ? fold(held(N), -11, -7) : GONG_K;
    if (finalGong) // the gong ageng belongs to both sets: always sounded in sléndro tuning
      st.queue.push({ track: "gong", at: tm(N), dur: 22, note: midiOf(SL, GONG_K), ks: GONG_K, L: "sl", vel: 0.84 * (buka ? 0.85 : dyn(N)) });
    else ev("gong", N, 10, gongK, 0.62 * dyn(N));
    if (buka) { // everyone lands on the buka's gong
      const kN = fold(bal[N - 1], -1, 5);
      ev("kenong", N, 6, fold(bal[N - 1], -1, 3), 0.62);
      ev("peking", N, 1.2, kN + 5, 0.42);
    }

    // ---- kendang ----
    for (let q = 0; q < N / 4; q++) {
      const end = q * 4 + 4, lv = lvAt(end);
      let pat;
      if (buka) { if (q < N / 4 - 1) continue; pat = g.gd === "lancaran" ? KEN.buka0 : KEN.buka1; }
      else if (g.suwuk && q === N / 4 - 1) pat = g.gd === "lancaran" ? KEN.k0end : KEN.suwuk;
      else if (g.suwuk && q === 1) pat = lv === 0 ? KEN.fast0 : KEN.fast;
      else if (g.signal && q === 1) pat = KEN[g.signal + (lv === 0 ? "0" : "")];
      else if (styleAt(end) === "imbal") pat = q === N / 4 - 1 ? KEN.k1gong : r.pick(KEN.imbal);
      else if (lv === 0) pat = q === N / 4 - 1 ? KEN.k0end : r.pick(KEN.k0);
      else if (end === N) pat = KEN[`k${lv}gong`];
      else if (F.kenong.includes(end) && g.gd === "ketawang") pat = KEN[`k${lv}kenong`];
      else pat = KEN[`k${lv}`][(st.kenIdx++) % 3];
      const res = pat.length / 4, soft = styleAt(end) === "soft";
      for (let j = 0; j < pat.length; j++) {
        const c = pat[j];
        if (c === ".") continue;
        const x = q * 4 + (j + 1) / res;
        ev("kendang", x, 0.3, null, KVEL[c] * (soft ? 0.72 : 1) * (0.85 + 0.15 * dyn(x)) * (r.chance(0.2) ? 0.9 : 1), { stroke: c });
      }
    }

    st.last = held(N);
    st.t = P[N];
    st.tGen = P[N];

    // ===== local helpers (closures over this gongan) =====
    function nearestOct(k, ref) { let best = k, bd = 1e9; for (let o = -3; o <= 3; o++) { const c = k + 5 * o; if (Math.abs(c - ref) < bd && c >= -5 && c <= 7) { bd = Math.abs(c - ref); best = c; } } return best; }

    function bonangBuka() {
      // single strokes on the buka line, a pickup into each gatra's last note, octaves on gatra ends
      for (let i = 1; i <= N; i++) {
        const k = note(i);
        if (k == null) continue;
        const kb = fold(k, -1, 5), end = i % 4 === 0;
        const nx = nextSounding(i), ring = nx ? durTo(i, nx) : 2;
        if (end) {
          if (i < N) ev("bonang", i - 0.5, durTo(i - 0.5, i), kb, 0.5);
          const dy = kb - 5 >= -5 ? [kb - 5, kb] : [kb, kb + 5];
          ev("bonang", i, i === N ? 2 : ring + 0.2, dy, i === N ? 0.72 : 0.66);
        } else ev("bonang", i, ring + 0.2, kb, 0.6 + (i % 2 === 0 ? 0.06 : 0));
      }
    }

    function imbalPair(p, b, sekaran) {
      // barung on the 1st and 3rd quarters, panerus on the 2nd and 4th: one continuous 4x stream
      // barung 2 3 / panerus 6 5 (the composite circles 2 6 3 5); gongan B lifts it to 3 5 / 1' 6
      const [IB, IP] = g.sec === "B" ? [[2, 3], [5, 4]] : [[1, 2], [4, 3]];
      const bB = fold(b, 0, 5);
      for (let s = 1; s <= 8; s++) {
        const x = p - 1 + s / 4, odd = s % 2 === 1;
        const lastGatra = g.suwuk && p + 1 > N - 4;
        if (sekaran && !odd) { // panerus answers the seleh while barung flourishes
          if (s % 4 === 0) ev("panerus", x, durTo(x, x + 0.5) + 0.1, bB + 5, 0.42 * dyn(x));
          continue;
        }
        if (sekaran) continue;
        if (lastGatra) continue;
        if (odd) ev("bonang", x, durTo(x, x + 0.5) + 0.1, IB[(s >> 1) % 2], 0.5 * dyn(x));
        else ev("panerus", x, durTo(x, x + 0.5) + 0.05, IP[(s >> 1) % 2 === 1 ? 0 : 1], 0.42 * dyn(x));
      }
      if (sekaran) {
        const sk = r.pick(SEKAR);
        sk.forEach((d, i) => { const x = p - 1 + (i + 1) / 4; ev("bonang", x, durTo(x, x + 0.25) + 0.15, clamp(bB + d, -2, 7), (0.5 + (i === 7 ? 0.14 : 0)) * dyn(x)); });
      }
      if (g.suwuk && p + 1 > N - 4) {
        const dy = bB - 5 >= -5 ? [bB - 5, bB] : [bB, bB + 5];
        ev("bonang", p, durTo(p, p + 1), dy, 0.58 * dyn(p)); ev("bonang", p + 1, 1.5, dy, 0.64 * dyn(p + 1));
      }
    }

    function genderPairs(list, mOf, base) {
      // right hand: cells of four strokes chained through waypoints onto each pair's seleh;
      // left hand: one stroke per cell end, octave (gembyang) on the seleh, kempyung or octave between
      const RH = [0, 7], LH = [-6, 1];
      for (const { p, b } of list) {
        const m = mOf(p), n = 2 * m, c = n / 4;
        let prev = st.gR ?? 3;
        const tgt = nearestIn(b, prev, RH[0] + 1, RH[1] - 1);
        // a player's stock cengkok: the same approach to the same seleh comes back, now and then varied
        const ckey = `${prev}>${tgt}:${m}`;
        const stock = st.cengkok[ckey];
        if (stock && r.chance(0.8)) { playGender(p, m, stock, base); st.gR = tgt; continue; }
        const w = [];
        for (let i = 1; i <= c; i++) {
          if (i === c) { w.push(tgt); break; }
          let x = Math.round(prev + (tgt - prev) * (i / c));
          if (Math.abs(tgt - prev) <= 1) x = tgt + r.pick([1, -1, 2, 1, -1, 0]);
          else if (r.chance(0.3)) x += r.pick([1, -1]);
          if (i === c - 1 && x === tgt) x = tgt + (r.chance(0.6) ? 1 : -1);
          w.push(clamp(x, RH[0] + 1, RH[1] - 1));
        }
        let last = prev, lastCell = -1;
        const notes = [];
        w.forEach((e, ci) => {
          const opts = CELLS.map((t, idx) => ({ t, idx })).filter(({ t }) => t.every((d) => e + d >= RH[0] && e + d <= RH[1]));
          const scored = opts.map(({ t, idx }) => {
            const gap = Math.abs(e + t[0] - last);
            const wgt = (gap === 1 ? 3 : gap === 2 ? 2 : gap === 0 ? 0.6 : gap === 3 ? 0.4 : 0.05) * (idx === lastCell ? 0.3 : 1);
            return [{ t, idx }, wgt];
          });
          const pick = r.weighted(scored);
          lastCell = pick.idx;
          pick.t.forEach((d) => notes.push(e + d));
          last = e;
        });
        st.cengkok[ckey] = notes;
        playGender(p, m, notes, base);
        st.gR = tgt;
      }
    }
    function playGender(p, m, notes, base) {
      const LH = [-6, 1], n = notes.length;
      notes.forEach((k, s) => {
        const x = p - 1 + (s + 1) / m;
        const cellEnd = s % 4 === 3, onBeat = Math.abs(x - Math.round(x)) < 1e-9;
        ev("gender", x, durTo(x, x + 1 / m) * 2.2, k, base * dyn(x) * (onBeat ? 1.12 : cellEnd ? 1.04 : 0.9 + 0.06 * (s % 2)));
        if (cellEnd) {
          const ci = (s + 1) / 4, isSeleh = s === n - 1;
          let kl = isSeleh || ci % 2 === 0 ? k - 5 : k - 3;
          while (kl > LH[1]) kl -= 5;
          while (kl < LH[0]) kl += 5;
          if (k - kl < 3) kl -= 5;
          if (kl < LH[0] - 1) kl += 5;
          ev("genderL", x, durTo(x, x + 4 / m) + 0.15, kl, base * 0.85 * dyn(x) * (isSeleh ? 1.1 : 1));
        }
      });
    }

    function suling() {
      const targets = [];
      for (let q = 1; q <= N / 4; q++) {
        const x = q * 4, lv = lvAt(x), style = styleAt(x);
        if (style !== "soft") continue;
        const taken = targets.includes(x - 4);
        const prob = lv === 3 ? 0.7 : lv === 2 ? (x === N ? 0.85 : x === 8 ? 0.75 : x === 12 && !taken ? 0.6 : 0) : (x === 8 || x === N ? 0.3 : 0);
        if (prob && r.chance(prob)) targets.push(x);
      }
      let floor = Math.max(st.sulEnd ?? -1e9, P[0] + 0.5);
      for (const x of targets) {
        const E = tm(x) + r.range(0.05, 0.35);
        const budget = Math.min(10, E - floor - 1.5);
        if (budget < 3) continue;
        const key = `${g.gd}:${g.sec}:${x}`;
        let ph = st.sulMem[key];
        if (!ph || r.chance(0.3)) { ph = sulingPhrase(held(x)); st.sulMem[key] = ph; }
        else ph = ph.map((n, i) => (i < ph.length - 1 && r.chance(0.15) ? { ...n, dur: n.dur * r.pick([0.75, 1.5]) } : n));
        // trim from the front to fit; if that would leave a fragment, let the space be
        let notes = ph.slice();
        while (notes.length > 2 && notes.slice(0, -1).reduce((a, n) => a + n.dur, 0) > budget) notes = notes.slice(1);
        if (notes.length < Math.min(4, ph.length)) continue;
        const pre = notes.slice(0, -1).reduce((a, n) => a + n.dur, 0);
        let t = E - pre;
        notes.forEach((n, i) => {
          const lastN = i === notes.length - 1;
          const vel = (0.5 + 0.12 * Math.sin(Math.PI * (i + 0.5) / notes.length) + (lastN ? 0.04 : 0)) * (0.8 + 0.25 * dyn(x));
          st.queue.push({ track: "suling", at: t, dur: lastN ? n.dur : n.dur * 0.96, note: midiOf(L, n.k), fm: fmOf(L, n.k), vel });
          t += n.dur;
        });
        st.sulEnd = t; st.sulLast = notes[notes.length - 1].k;
        floor = t;
      }
    }

    function sulingPhrase(seleh) {
      // three gestures a suling player leans on: a long fall onto the seleh, an arch that rises out of
      // the last tone and falls back, and a hover that circles the seleh before settling
      const tR = nearestIn(seleh, st.sulLast ?? 7, 5, 10);
      const shape = r.weighted([["fall", 3], ["arch", 2], ["hover", 1.5]]);
      let ks;
      if (shape === "fall") {
        const top = Math.min(12, tR + r.pick([3, 3, 4]));
        ks = [top];
        for (let k = top - 1; k > tR; k--) { ks.push(k); if (r.chance(0.25) && k - 1 > tR) ks.push(k + 1, k); }
        if (r.chance(0.5) && tR - 1 >= 5) ks.push(tR - 1); // dip below, then rise onto the seleh
      } else if (shape === "arch") {
        const lo = Math.max(5, tR - r.pick([1, 2])), peak = Math.min(12, tR + r.pick([2, 3]));
        ks = [];
        for (let k = lo; k <= peak; k++) ks.push(k);
        for (let k = peak - 1; k > tR; k--) ks.push(k);
      } else {
        ks = [tR + 1, tR, tR + 2, tR + 1].filter((k) => k <= 12);
        if (r.chance(0.5)) ks.push(tR - 1, tR + 1);
      }
      if (ks.length > 7) ks = ks.slice(ks.length - 7);
      ks.push(tR);
      // rhythm: a long head tone, ornamental groups in the middle, a short luk, then the long seleh
      const durs = [];
      const GROUPS = [[0.5, 0.5], [0.75, 0.25], [1], [0.25, 0.25, 0.5], [1.5], [0.5, 1]];
      while (durs.length < ks.length - 2) durs.push(...r.pick(GROUPS));
      durs.length = Math.max(0, ks.length - 2);
      return ks.map((k, i) => ({
        k, dur: i === 0 ? r.pick([1.5, 2, 2.5]) : i === ks.length - 1 ? r.pick([2.5, 3, 3.5]) : i === ks.length - 2 ? r.pick([0.25, 0.5, 0.5]) : durs[i - 1],
      }));
    }
  }
  function nearestIn(k, ref, lo, hi) {
    let best = null, bd = 1e9;
    for (let o = -4; o <= 4; o++) { const c = k + 5 * o; if (c >= lo && c <= hi && Math.abs(c - ref) < bd) { bd = Math.abs(c - ref); best = c; } }
    return best ?? fold(k, lo, lo + 4);
  }

  // ---------- instruments ----------
  /**
   * A paired-tuned bronze instrument: each partial is a sine PolySynth; on the strong partials the
   * pengisep twin is `ombak` Hz sharp (scaled by sqrt(f / fRef)) and panned apart from the pengumbang.
   * partials: [ratio, gainDb, decay s, brightness, twin = true] (brightness: the partial grows with
   * velocity as vel^brightness). Weak upper partials are single voices (at +5 dB) to save CPU.
   */
  function bronze(ctx, dest, o) {
    const out = ctx.keep(new Tone.Gain(dbg((o.volume ?? 0) - 21))).connect(dest);
    const pans = [-1, 0, 1].map((sd) => ctx.keep(new Tone.Panner(clamp((o.pan ?? 0) + sd * (o.spread ?? 0.12), -1, 1))).connect(out));
    const mk = (gainDb, decay, pan) => {
      const s = ctx.keep(new Tone.PolySynth({
        voice: Tone.Synth, maxPolyphony: o.poly ?? 8,
        options: { oscillator: { type: "sine" }, envelope: { attack: o.attack ?? 0.0015, decay, sustain: 0, release: o.release ?? 0.09 } },
      }));
      s.volume.value = gainDb;
      s.connect(pan);
      return s;
    };
    const twin = (pt) => pt[4] !== false;
    const sides = [
      o.partials.map((pt) => mk(pt[1] + (twin(pt) ? 0 : 5), pt[2], twin(pt) ? pans[0] : pans[1])),
      o.partials.map((pt) => (twin(pt) ? mk(pt[1], pt[2], pans[2]) : null)),
    ];
    return {
      out,
      strike(time, freqs, dur, vel) {
        for (const f of freqs) {
          if (!(f > 0)) continue;
          const beat = (o.ombak ?? 3) * Math.sqrt(f / o.fRef);
          o.partials.forEach(([ratio, , , bright = 0], i) => {
            if (f * ratio > 16000) return;
            const v = vel * Math.pow(vel, bright);
            const d = Math.min(dur, o.maxDur ?? 4); // never hold a voice long after the bar has died away
            sides[0][i].triggerAttackRelease(f * ratio, d, time, v);
            if (sides[1][i]) sides[1][i].triggerAttackRelease((f + beat) * ratio, d, time, v);
          });
        }
      },
    };
  }

  function kendang(ctx, dest, volume) {
    const out = ctx.keep(new Tone.Gain(dbg(volume - 13))).connect(dest);
    const dl = ctx.keep(new Tone.Filter(900, "lowpass")).connect(out);
    const dhung = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.06, octaves: 1.3, oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.55, sustain: 0, release: 0.2 } })).connect(dl);
    const tung = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.018, octaves: 0.7, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.08 } })).connect(out);
    const ket = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 0.5, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 } })).connect(out);
    const bp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "bandpass", Q: 0.9 })).connect(out);
    const slap = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 } })).connect(bp);
    const slapBody = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.004, octaves: 0.6, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } })).connect(out);
    tung.volume.value = -4; ket.volume.value = -6; slap.volume.value = -3; slapBody.volume.value = -8;
    const mono = (n) => Sim.instruments.monotonic(n);
    const c = { dhung: mono(dhung), tung: mono(tung), ket: mono(ket), slap: mono(slap), slapBody: mono(slapBody) };
    const D = (t, v) => dhung.triggerAttackRelease(74, 0.35, c.dhung(t), v);
    const tak = (t, v) => { slap.triggerAttackRelease(0.04, c.slap(t), v); slapBody.triggerAttackRelease(420, 0.05, c.slapBody(t), v); };
    return {
      out,
      hit(stroke, t, v) {
        if (stroke === "D") D(t, v);
        else if (stroke === "d") D(t, v * 0.75);
        else if (stroke === "t") tak(t, v);
        else if (stroke === "n") tung.triggerAttackRelease(205, 0.2, c.tung(t), v);
        else if (stroke === "k") ket.triggerAttackRelease(290, 0.04, c.ket(t), v);
        else if (stroke === "H") { D(t, v); tak(t, v * 0.8); }
      },
    };
  }

  Sim.register({
    id: "rice-terraces",
    title: "Rice Terraces",
    genre: "Gamelan",
    meter: "16-beat gongan",
    about: "Javanese gamelan in true sléndro and pélog with paired, beating bronze: a ketawang that the kendang slows from irama tanggung into dadi and wiled and back, alternating with a pélog lancaran of interlocking bonang.",
    bpm: 72, beatsPerBar: BPB, cycleBars: BARS, swing: 0.5, gainDb: 9.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.025, lowcut: 180, highcut: 6500 });
      const B = (o) => { const b = bronze(ctx, out, o); I.send(ctx, b.out, hall, o.send ?? -11); return b; };
      const saron = B({ maxDur: 3.5, volume: -3, pan: -0.12, spread: 0.1, fRef: 380, ombak: 4, poly: 6, partials: [[1, 0, 2.4], [2.71, -8, 0.8, 0.5], [5.36, -16, 0.25, 1, false]] });
      const demung = B({ maxDur: 4.5, volume: -6, pan: -0.32, spread: 0.08, fRef: 190, ombak: 3, poly: 6, partials: [[1, 0, 3.2], [2.68, -9, 1.0, 0.5], [5.3, -17, 0.3, 1, false]] });
      const slenthem = B({ maxDur: 7, volume: -3, pan: -0.25, spread: 0.06, fRef: 95, ombak: 1.4, poly: 6, attack: 0.004, release: 0.3, partials: [[1, 0, 5], [2.74, -14, 1.4, 0.6, false]] });
      const peking = B({ maxDur: 2, volume: -10, pan: 0.3, spread: 0.1, fRef: 760, ombak: 5, poly: 8, partials: [[1, 0, 1.4], [2.74, -8, 0.5, 0.5, false], [5.4, -15, 0.15, 1, false]] });
      const bonang = B({ maxDur: 2.5, volume: -7, pan: -0.42, spread: 0.1, fRef: 380, ombak: 3.5, poly: 10, release: 0.25, partials: [[1, 0, 1.6], [2.31, -10, 0.5, 0.5], [3.83, -18, 0.18, 1, false]] });
      const panerus = B({ maxDur: 2, volume: -12, pan: 0.45, spread: 0.1, fRef: 760, ombak: 5, poly: 10, release: 0.2, partials: [[1, 0, 1.2], [2.31, -10, 0.4, 0.5, false]] });
      const gender = B({ maxDur: 4, volume: -6, pan: 0.12, spread: 0.18, fRef: 400, ombak: 2.5, poly: 12, attack: 0.003, release: 0.25, send: -9, partials: [[1, 0, 3.4], [2.76, -13, 0.9, 0.6, false]] });
      const kenong = B({ maxDur: 5, volume: -7, pan: 0.35, spread: 0.06, fRef: 330, ombak: 2.2, poly: 6, release: 1, partials: [[1, 0, 3.5], [2.24, -12, 1.2, 0.5, false], [3.72, -20, 0.5, 1, false]] });
      const kempul = B({ maxDur: 7, volume: -4, pan: 0.2, spread: 0.05, fRef: 100, ombak: 1.6, poly: 6, attack: 0.012, release: 1.5, partials: [[1, 0, 6.5], [2.02, -9, 3], [2.95, -15, 1.6, 0.5, false], [4.4, -22, 0.6, 1, false]] });
      const gong = B({ maxDur: 18, volume: 0, pan: 0.05, spread: 0.04, fRef: 42, ombak: 1.1, poly: 3, attack: 0.03, release: 2.5, send: -14, partials: [[1, 0, 15], [2.03, -7, 9], [2.92, -13, 5, 0.5, false], [4.12, -19, 2.5, 1, false], [5.7, -26, 1.2, 1, false]] });
      const kethuk = B({ maxDur: 0.4, volume: -9, pan: -0.3, spread: 0.04, fRef: 170, ombak: 1.5, poly: 3, partials: [[1, 0, 0.18], [2.3, -10, 0.06, 0, false]] });
      const kempyang = B({ maxDur: 1, volume: -16, pan: -0.4, spread: 0.04, fRef: 1000, ombak: 4, poly: 3, partials: [[1, 0, 0.6], [2.6, -9, 0.2, 0.5, false], [4.2, -16, 0.07, 1, false]] });
      const kd = kendang(ctx, out, -4);
      I.send(ctx, kd.out, hall, -17);
      const suling = I.flute(ctx, { volume: -8, vibratoDepth: 0.045, vibrato: 4.8, breath: -17, glide: 0.04, attack: 0.08 });
      const sp = I.place(ctx, suling, 0.05, out);
      I.send(ctx, sp, hall, -7);

      const hzs = (e) => { const L = e.L === "pl" ? PL : SL; return (Array.isArray(e.ks) ? e.ks : [e.ks]).map((k) => freqOf(L, k)); };
      const bar = (inst, hum) => ({ play: (t, e, d) => inst.strike(t, hzs(e), d, e.vel), humanize: hum });
      const tight = { timing: 0.004, vel: 0.06 };
      return {
        saron: { layer: "melody", ...bar(saron, { timing: 0.006, vel: 0.05 }) },
        demung: { layer: "melody", ...bar(demung, { timing: 0.006, vel: 0.05 }) },
        suling: { layer: "melody", play: (t, e, d) => suling.play(t, e.fm ?? e.note, d, e.vel), humanize: { timing: 0.015, vel: 0.05 } },
        bonang: { layer: "harmony", ...bar(bonang, tight) },
        gender: { layer: "harmony", ...bar(gender, { timing: 0.005, vel: 0.08 }) },
        genderL: { layer: "harmony", ...bar(gender, { timing: 0.005, vel: 0.06 }) },
        peking: { layer: "texture", ...bar(peking, tight) },
        panerus: { layer: "texture", ...bar(panerus, tight) },
        slenthem: { layer: "bass", ...bar(slenthem, { timing: 0.006, vel: 0.04 }) },
        kempul: { layer: "bass", ...bar(kempul, { timing: 0.004, vel: 0.04 }) },
        gong: { layer: "bass", ...bar(gong, { timing: 0, vel: 0.03 }) },
        kenong: { layer: "bass", ...bar(kenong, { timing: 0.004, vel: 0.04 }) },
        kethuk: { layer: "drums", ...bar(kethuk, { timing: 0.004, vel: 0.06 }) },
        kempyang: { layer: "drums", ...bar(kempyang, { timing: 0.004, vel: 0.06 }) },
        kendang: { layer: "drums", play: (t, e) => kd.hit(e.stroke, t, e.vel), humanize: { timing: 0.004, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state: st }) {
      if (!st.init) Object.assign(st, { init: true, t: 1, tGen: 1, queue: [], hq: [], sq: [], plan: [], set: 0, kenIdx: 0, sulMem: {}, cengkok: {} });
      const w0 = cycle * WIN, w1 = w0 + WIN;
      while (st.tGen < w1 + 2) generateNext(st, r);
      const events = [], later = [];
      for (const e of st.queue) (e.at < w1 - 1e-6 ? events : later).push(e);
      st.queue = later;
      const out = events.map(({ at, ks, L, ...e }) => {
        const rel = Math.max(0, at - w0), bar = Math.floor(rel / BPB + 1e-9);
        return { ...e, ks, L, bar, beat: rel - bar * BPB };
      });
      // harmony: entries starting in this window, each lasting until the next entry
      st.hq.sort((a, b) => a.at - b.at);
      const harmony = [];
      st.hq.forEach((h, i) => {
        if (h.at < w0 - 1e-6 || h.at >= w1 - 1e-6) return;
        const nxt = st.hq[i + 1], rel = h.at - w0, bar = Math.floor(rel / BPB + 1e-9);
        harmony.push({ bar, beat: rel - bar * BPB, dur: nxt ? nxt.at - h.at : 8, chord: h.chord });
      });
      if (cycle === 0 && (!harmony.length || harmony[0].bar * BPB + harmony[0].beat > 0)) harmony.unshift({ bar: 0, beat: 0, dur: 1, chord: st.hq[0].chord });
      st.hq = st.hq.filter((h) => h.at >= w0 - 64);
      const cur = [...st.sq].reverse().find((s) => s.at <= w0 + 4) || st.sq[0];
      st.sq = st.sq.filter((s) => s.at >= w0 - 256);
      return { events: out, harmony, section: cur ? cur.label : "", state: st };
    },
  });
})();
