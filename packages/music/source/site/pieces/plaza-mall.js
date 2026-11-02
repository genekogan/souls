// Plaza Mall: mallsoft. An imagined 1983 smooth-jazz muzak cassette ("Escalator / Fountain Court / Skylight",
// originally in Eb) heard slowed and pitched down to Db at 72 BPM, through wobbling tape and a reverb the size
// of an atrium, under the murmur of shoppers, a fountain and a distant PA chime.
//
// The "sample": three 8-bar source sections are composed ONCE per performance and never changed, exactly like a
// sample, then edited per cycle the way a vaporwave producer edits a loop: played straight, looped, stuck on a
// bar, stuttered (a half- or quarter-beat slice repeated, notes held across the slice re-triggered), cut
// mid-note and thrown back to the top of the phrase, or shrunk (8 bars, 4, 2, 1, half a beat...). The harmony
// timeline is edited with it, so the chord display follows the chops.
//   escalator  | Gbmaj9 Fm7 Ebm9 Dbmaj9 | Gbmaj9 Fm7 Ebm9 Ab13sus4 |  the falling IV-iii-ii-I of every food court
//   fountain   | Bbm9 Gbmaj9 Ebm9 Ab13sus4 | Bbm9 Gbmaj9 Ebm9 Ab13 Dbmaj9 |  vi-IV-ii-V, flute and congas
//   skylight   | Amaj9 Gbmaj9 Amaj9 Gbmaj9 | Emaj9 Ebm9 Dmaj9#11 Ab13sus4 |  chromatic mediants; the sax holds
//              one note while the floor changes under it (G# = Ab, D# = Eb, C# = Db): the uncanny part.
// Form: Side A (Db, 72 BPM) lobby loop -> concourse (sax) -> the loop sticks -> fountain court (flute) ->
//   skipping + PA chime -> skylight (no drums) -> concourse chopped -> run-out (the loop shrinks to nothing).
//   Then the tape slows: Side B is the same sample a semitone lower and 6% slower (a whole step on alternate
//   plays), and finally the deck speeds back up for the next side A.
// Out of the sample (never chopped): mall murmur (pink noise in four formant bands with syllable-rate
// flicker), a fountain, PA chimes, and shoppers walking past the speaker (the whole sample ducks and dulls).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4, CYCLE = 8, CB = CYCLE * BPB;

  const PROGS = {
    escalator: "| Gbmaj9 | Fm7 | Ebm9 | Dbmaj9 | Gbmaj9 | Fm7 | Ebm9 | Ab13sus4 |",
    fountain: "| Bbm9 | Gbmaj9 | Ebm9 | Ab13sus4 | Bbm9 | Gbmaj9 | Ebm9 Ab13 | Dbmaj9 |",
    skylight: "| Amaj9 | Gbmaj9 | Amaj9 | Gbmaj9 | Emaj9 | Ebm9 | Dmaj9#11 | Ab13sus4 |",
  };

  // ---------- tunes of the "original" (in Db): [beat, dur, midi] ----------
  // Concourse (alto sax, heard low): a lazy three-note pickup figure sequenced down a step, then up to the 7th
  // of Fm7 and down to the 7th of the sus chord, which leans back into the next loop's F.
  const THEME = [
    [0.5, 0.5, 65], [1, 0.5, 68], [1.5, 1.75, 70], [3.5, 0.5, 73],
    [4, 1.5, 72], [5.5, 0.5, 70], [6, 2, 68],
    [8.5, 0.5, 63], [9, 0.5, 66], [9.5, 1.75, 68], [11.5, 0.5, 70],
    [12, 1.5, 72], [13.5, 0.5, 68], [14, 2, 65],
    [16.5, 0.5, 65], [17, 0.5, 68], [17.5, 0.5, 70], [18, 1.5, 73], [19.5, 0.5, 77],
    [20, 2, 75], [22, 0.5, 72], [22.5, 1.5, 68],
    [24.5, 0.5, 66], [25, 0.5, 65], [25.5, 0.5, 63], [26, 1.5, 61], [27.5, 0.5, 63],
    [28, 1, 65], [29, 2.75, 66],
  ];
  // Fountain court (flute): falling four-note figures answered by rising arpeggios.
  const FOUNTAIN = [
    [0, 1.5, 77], [1.5, 0.5, 75], [2, 0.5, 73], [2.5, 1.5, 72],
    [4.5, 0.5, 70], [5, 0.5, 73], [5.5, 2.5, 77],
    [8, 1.5, 78], [9.5, 0.5, 77], [10, 0.5, 75], [10.5, 1.5, 73],
    [12.5, 0.5, 70], [13, 0.5, 73], [13.5, 2.5, 75],
    [16, 1.5, 80], [17.5, 0.5, 77], [18, 0.5, 73], [18.5, 1.5, 72],
    [20.5, 0.5, 70], [21, 0.5, 73], [21.5, 0.5, 77], [22, 2, 80],
    [24, 1, 78], [25, 1, 77], [26, 1, 75], [27, 1, 72],
    [28, 1.5, 77], [29.5, 2.5, 72],
  ];
  // Skylight (sax, long tones): each held note is a common tone that the next chord re-spells.
  const SKYLIGHT = [
    [0.5, 0.5, 64], [1, 7, 68],
    [8, 1, 71], [9, 1, 73], [10, 2, 76],
    [12, 3.5, 77],
    [16.5, 7.5, 75],
    [24, 2, 76], [26, 5.75, 73],
  ];

  const SECTIONS = {
    lobby: { prog: "escalator", drums: "soft", marimba: true, rhodes: "comp", keys: { lo: 50, hi: 72, top: [63, 70] } },
    theme: { prog: "escalator", mel: "sax", tune: THEME, drums: "full", rhodes: "comp", keys: { lo: 48, hi: 68, top: [59, 66] } },
    fountain: { prog: "fountain", mel: "flute", tune: FOUNTAIN, drums: "conga", rhodes: "sparse", strings: true, keys: { lo: 50, hi: 70, top: [61, 68] } },
    skylight: { prog: "skylight", mel: "sax", tune: SKYLIGHT, drums: "none", rhodes: "arp", strings: true, bass: "long", keys: { lo: 52, hi: 74, top: [64, 71] } },
  };

  // ---------- the cassette: 12 cycles, then the next play ----------
  const PLAN = [
    { src: "lobby", edit: "loop", murmur: 1, water: 0.4, label: "Lobby · the escalator loop" },
    { src: "theme", edit: "straight", murmur: 0.8, water: 0.35, label: "Concourse · sax" },
    { src: "theme", edit: "stuck", murmur: 0.85, water: 0.35, label: "Concourse · the loop sticks" },
    { src: "fountain", edit: "straight", murmur: 0.8, water: 1, label: "Fountain court · flute" },
    { src: "fountain", edit: "stutter", murmur: 0.9, water: 1, chime: true, label: "Fountain court · skipping" },
    { src: "skylight", edit: "straight", murmur: 0.45, water: 0.5, label: "Skylight · no drums" },
    { src: "theme", edit: "chopEnd", murmur: 0.8, water: 0.35, label: "Concourse · cut and thrown back" },
    { src: "lobby", edit: "shrink", murmur: 0.9, water: 0.4, label: "Run-out · the loop shrinks" },
    { src: "theme", edit: "straight", side: 1, murmur: 0.6, water: 0.3, label: "Concourse" },
    { src: "fountain", edit: "stuck", side: 1, murmur: 0.6, water: 0.9, chime: true, label: "Fountain court · stuck" },
    { src: "skylight", edit: "loop", side: 1, murmur: 0.3, water: 0.45, label: "Skylight · after hours" },
    { src: "lobby", edit: "shrink", side: 1, murmur: 0.5, water: 0.35, label: "Run-out · closing time" },
  ];
  function planAt(cycle) {
    const play = Math.floor(cycle / PLAN.length), i = cycle % PLAN.length;
    const p = { ...PLAN[i], play, i };
    p.k = p.side ? (play % 2 ? -2 : -1) : 0;
    return p;
  }

  // ---------- spelling ----------
  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  const keyName = (k) => ({ 0: "D♭", "-1": "C", "-2": "B" })[k];

  // T.voice, but no adjacent semitones, no minor 9ths, no seconds below G3 and nothing muddy below E3.
  const rough = (v) => v.some((a, i) => i > 0 && (a - v[i - 1] === 1 || (v[i - 1] < 55 && a - v[i - 1] <= 2) || (v[i - 1] < 52 && a - v[i - 1] < 3))) ||
    v.some((a, i) => v.some((b, j) => j > i && b - a === 13));
  function voiceClean(sym, o) {
    const n = o.n ?? 4;
    const tries = [o, { ...o, spread: "close" }, { ...o, spread: "drop2" }, { ...o, lo: o.lo + 2 }, { ...o, n: n - 1 }, { ...o, n: n - 1, spread: "close" }, { ...o, lo: o.lo - 2, hi: o.hi + 3 }, { ...o, n: n - 1, lo: o.lo + 3 }];
    let first = null;
    for (const t of tries) { const v = T.voice(sym, t); first = first || v; if (!rough(v)) return v; }
    return first;
  }

  // ---------- source parts ----------
  // Rhodes comping per chord span: [beat, dur, velMul]
  const COMP4 = [
    [[[0, 2.8, 1], [3, 0.7, 0.75]], 3], [[[0, 1.4, 1], [1.75, 0.25, 0.7], [2.5, 1.3, 0.85]], 3],
    [[[0, 3.7, 1]], 2], [[[0, 0.7, 1], [1.5, 2.2, 0.85]], 2], [[[0, 1.7, 1], [2.75, 0.25, 0.65], [3, 0.8, 0.8]], 1.5],
  ];
  const COMP2 = [[[[0, 1.8, 1]], 3], [[[0, 0.7, 1], [1, 0.85, 0.8]], 2]];
  const SPARSE4 = [[[[0, 3.7, 1]], 3], [[[0, 1.6, 1], [2.5, 1.2, 0.8]], 2]];
  // fretless: [beat, dur, role, vel]; R root, O octave, F fifth, S seventh, A approach to the next root
  const BASS4 = [
    [[0, 1.6, "R", 0.85], [1.75, 0.25, "R", 0.45], [2, 1.4, "F", 0.7], [3.5, 0.45, "A", 0.6]],
    [[0, 2.2, "R", 0.85], [2.5, 0.45, "O", 0.62], [3, 0.45, "F", 0.58], [3.5, 0.45, "A", 0.6]],
    [[0, 0.7, "R", 0.85], [0.75, 1.1, "R", 0.58], [2, 1, "F", 0.7], [3, 0.9, "S", 0.6]],
  ];
  const BASS2 = [[[0, 1.4, "R", 0.85], [1.5, 0.45, "A", 0.6]], [[0, 0.9, "R", 0.85], [1, 0.9, "F", 0.65]]];

  function buildSource(name, r) {
    const S = SECTIONS[name];
    const harmony = T.progression(PROGS[S.prog]).map((h) => ({ start: h.bar * BPB + h.beat, dur: h.dur, chord: h.chord }));
    const ev = [];
    const E = (track, beat, dur, note, vel, extra) => ev.push({ track, beat, dur, note, vel, ...extra });

    // melody
    if (S.tune) {
      S.tune.forEach(([b, d, m], i) => {
        const phraseStart = i === 0 || b - (S.tune[i - 1][0] + S.tune[i - 1][1]) > 0.3;
        E(S.mel, b, d, m, (S.mel === "flute" ? 0.62 : 0.6) + (phraseStart ? 0.06 : 0) + (d >= 1.5 ? 0.04 : 0) + r.gauss(0.02));
      });
    }

    // Rhodes
    let pv = null;
    const voicings = harmony.map((h) => (pv = voiceClean(h.chord, { ...S.keys, n: 4, prev: pv, rng: r })));
    harmony.forEach((h, hi) => {
      const v = voicings[hi];
      if (S.rhodes === "arp") { // slow broken chords, ringing
        for (let b = 0; b < h.dur; b += 1) {
          const idx = ((h.start / BPB) % 2 ? [3, 1, 2, 0] : [0, 1, 2, 3])[b] % v.length;
          E("rhodes", h.start + b, Math.min(1.9, h.dur - b - 0.05), v[idx], (b === 0 ? 0.4 : 0.32) + r.gauss(0.02));
        }
      } else {
        const lib = S.rhodes === "sparse" ? (h.dur >= 4 ? SPARSE4 : COMP2) : h.dur >= 4 ? COMP4 : COMP2;
        r.weighted(lib).forEach(([b, d, vm]) => E("rhodes", h.start + b, d, v, 0.44 * vm + r.gauss(0.015)));
      }
    });

    // string machine (fountain, skylight): three voices under the melody
    if (S.strings) {
      let sv = null;
      harmony.forEach((h) => {
        const v = voiceClean(h.chord, { lo: 53, hi: 70, n: 3, prev: sv, top: [64, 69] });
        sv = v;
        E("strings", h.start, h.dur - 0.05, v, 0.42);
      });
    }

    // DX marimba ostinato (lobby only): a 16th-note figure through each chord's colours, high and soft
    if (S.marimba) {
      let last = 75;
      harmony.forEach((h) => {
        const c = T.chord(h.chord);
        const pcs = [...new Set(c.guide.concat(c.colors, [mod12(c.root + 7)]))];
        const pool = T.notesIn(pcs, 70, 84);
        const center = T.nearest(last, pcs, 72, 80);
        const near = pool.filter((m) => Math.abs(m - center) <= 7).slice(0, 4);
        const fig = h.start % 8 === 0 ? [[0, 0], [0.75, 2], [1.5, 1], [2, 3], [2.75, 2], [3.5, 1]] : [[0, 3], [0.75, 1], [1.5, 2], [2.5, 0], [3, 1]];
        fig.forEach(([b, i]) => { if (b < h.dur) E("marimba", h.start + b, 0.6, near[i % near.length], (b === 0 ? 0.46 : 0.36) + r.gauss(0.02)); });
        last = near[near.length - 1] ?? last;
      });
    }

    // fretless bass
    let lastRoot = 38;
    const keyPcs = S.prog === "skylight" ? null : T.scale(1, "ionian"); // Db major
    harmony.forEach((h, i) => {
      const c = T.chord(h.chord), v = voicings[i];
      const root = T.nearest(lastRoot, [c.bass], 31, 45);
      lastRoot = root;
      const nc = T.chord(harmony[(i + 1) % harmony.length].chord), nroot = T.nearest(root, [nc.bass], 31, 45);
      if (S.bass === "long") { E("bass", h.start, h.dur - 0.08, root, 0.72); return; }
      const fifth = root + (c.intervals.find((x) => x === 7 || x === 6 || x === 8) ?? 7);
      const sev = root + (c.intervals.includes(10) ? 10 : c.sus ? 5 : 4); // a maj7 in the bass is wrong here: the 3rd
      // approach: a step either side of the next root, in the chord scale and the key, not rubbing a Rhodes note
      const sc = new Set(c.scale.concat(c.pcs));
      const okApp = (m) => sc.has(mod12(m)) && (!keyPcs || keyPcs.includes(mod12(m)) || c.pcs.includes(mod12(m))) &&
        (c.pcs.includes(mod12(m)) || !v.some((x) => Math.abs(mod12(x - m)) === 1 || Math.abs(mod12(x - m)) === 11)) && m >= 30;
      const app = nc.bass === c.bass ? fifth : [nroot - 1, nroot + 1, nroot - 2, nroot + 2].find(okApp) ?? fifth;
      const role = { R: root, O: root + 12, F: fifth, S: sev, A: app };
      r.pick(h.dur >= 4 ? BASS4 : BASS2).forEach(([b, d, ro, vel]) => E("bass", h.start + b, d, role[ro], vel));
    });

    // the drum machine (soft, LinnDrum-ish): part of the sample, so it gets chopped too
    const D = (b, v, vel, extra) => E("drums", b, 0.1, v, vel, extra);
    for (let bar = 0; bar < CYCLE; bar++) {
      const s = bar * BPB, last = bar === CYCLE - 1, type = S.drums;
      if (type === "none") { // the skylight: nothing, then a shaker and a rim click bring the floor back
        if (bar >= 6) for (let q = 0; q < 8; q++) D(s + q / 2, "shaker", (q % 2 ? 0.16 : 0.24) + (bar - 6) * 0.04);
        if (last) { D(s + 3, "rim", 0.34); D(s + 3.5, "kick", 0.4); }
        continue;
      }
      const kicks = type === "soft" ? [0, 2.5] : bar % 2 ? [0, 1.75, 2.5] : [0, 2.5];
      kicks.forEach((b) => D(s + b, "kick", b === 0 ? 0.64 : 0.5));
      const fill = last && type !== "soft";
      if (type === "soft") { D(s + 1, "rim", 0.4); D(s + 3, "rim", 0.44); }
      else { D(s + 1, "snare", 0.5); if (!fill) D(s + 3, "snare", 0.54); if (r.chance(0.2)) D(s + 2.75, "rim", 0.2); }
      if (type !== "soft") for (let h = 0; h < 4; h += 0.5) if (!(fill && h >= 3)) D(s + h, "hatClosed", h % 1 ? 0.17 : 0.25);
      for (let q = 0; q < 16; q++) D(s + q / 4, "shaker", q % 4 === 0 ? 0.3 : q % 2 === 0 ? 0.24 : 0.15);
      if (type === "conga") {
        D(s + 1.5, "conga", 0.36, { pitch: 62 }); D(s + 1.75, "conga", 0.28, { pitch: 62 });
        D(s + 3, "congaLow", 0.42, { pitch: 55 }); D(s + 3.5, "congaLow", 0.34, { pitch: 55 });
        if (bar % 2) D(s + 2.75, "conga", 0.3, { pitch: 64 });
      }
      if (fill) [[3, 52], [3.25, 50], [3.5, 47], [3.75, 43]].forEach(([b, p], j) => D(s + b, "tom", 0.36 + j * 0.04, { pitch: p }));
      if (bar === 0 && type !== "soft") D(s, "crash", 0.22);
    }
    return { events: ev, harmony };
  }

  // ---------- the edits: lists of [srcStart, srcEnd) segments that always add up to 32 output beats ----------
  function editFor(kind, r) {
    switch (kind) {
      case "straight": return [[0, 32]];
      case "loop": return [[0, 16], [0, 16]];
      case "stuck": return r.chance(0.5) ? [[0, 16], [8, 16], [8, 16]] : [[0, 24], [16, 24]];
      case "stutter": { // a slice repeated (2 beats' worth), then the phrase carries on and is cut short
        const s = r.pick([12, 20, 28]), q = r.pick([0.5, 0.5, 0.25]);
        return [[0, s], ...Array.from({ length: 2 / q }, () => [s, s + q]), [s, 30]];
      }
      case "chopEnd": return [[0, 24], [24, 27], [24, 27], [24, 26]];
      case "shrink": return [[0, 24], [24, 28], [24, 26], [24, 25], [24, 24.5], [24, 24.5]];
      default: return [[0, 32]];
    }
  }

  /** Lay the source out along the edit: events starting inside a segment keep their offset (and are cut at its
   *  end); pitched notes still sounding at a segment's start are re-triggered softly, like a chop into a tail. */
  function render(src, segs, k) {
    const ev = [], harm = [], cuts = [];
    let pos = 0;
    segs.forEach(([a, b], si) => {
      for (const e of src.events) {
        const end = e.beat + e.dur;
        let beat, dur, vel = e.vel;
        if (e.beat >= a - 1e-9 && e.beat < b - 1e-9) { beat = pos + e.beat - a; dur = Math.min(end, b) - e.beat; }
        else if (e.track !== "drums" && e.beat < a - 1e-9 && end > a + 0.2) { beat = pos; dur = Math.min(end, b) - a; vel *= 0.55; }
        else continue;
        if (dur < 0.06) continue;
        const note = e.track === "drums" ? e.note : Array.isArray(e.note) ? e.note.map((m) => m + k) : e.note + k;
        ev.push({ ...e, beat, dur: e.track === "drums" ? e.dur : dur, vel, note });
      }
      for (const h of src.harmony) {
        const hs = Math.max(h.start, a), he = Math.min(h.start + h.dur, b);
        if (he - hs < 1e-6) continue;
        const sym = tsym(h.chord, k), last = harm[harm.length - 1];
        if (last && b - a < 1 && last.chord === sym && Math.abs(last.start + last.dur - (pos + hs - a)) < 1e-6) last.dur += he - hs; // a stutter
        else harm.push({ start: pos + hs - a, dur: he - hs, chord: sym });
      }
      const jump = si > 0 && Math.abs(segs[si - 1][1] - a) > 1e-6;
      const firstOfRun = si === 0 || segs[si - 1][0] !== a || segs[si - 1][1] !== b;
      if (jump && (b - a >= 1 || firstOfRun)) cuts.push(pos);
      pos += b - a;
    });
    return { ev, harm, cuts };
  }

  Sim.register({
    id: "plaza-mall",
    title: "Plaza Mall",
    genre: "Mallsoft",
    about: "A lost 1983 smooth-jazz muzak tape slowed to D♭ at 72 BPM on wobbling tape in an atrium-sized reverb: Rhodes, a low sax and a flute over fretless bass and a soft drum machine, looped, stuck, stuttered and cut mid-note, under shoppers' murmur, a fountain and a distant PA chime.",
    situations: ["shopping", "hangout", "sleep"],
    energy: 0.3,
    bpm: 72, beatsPerBar: BPB, swing: 0.56, swingUnit: 0.25, cycleBars: CYCLE, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const K = (n) => ctx.keep(n);
      const db = (x) => Math.pow(10, x / 20);
      const fin = (x, d) => (Number.isFinite(x) ? x : d);

      // ---- the sample bus: drag delay -> tape -> glitch gain -> mix; mix -> duck (lowpass + gain) -> out ----
      const duckGain = K(new Tone.Gain(1)).connect(out);
      const duckLP = K(new Tone.Filter({ frequency: 16000, type: "lowpass", rolloff: -12 })).connect(duckGain);
      const mix = K(new Tone.Gain(1)).connect(duckLP);
      const hall = I.reverb(ctx, duckLP, { decay: 9, preDelay: 0.07, lowcut: 220, highcut: 4800 });
      I.send(ctx, mix, hall, -5);
      const glitchGain = K(new Tone.Gain(1)).connect(mix);
      const tapeIn = I.tape(ctx, glitchGain, { wow: 0.9, wowRate: 0.33, flutter: 0.07, cutoff: 4200, drive: 0.12 });
      const drag = K(new Tone.Delay({ delayTime: 0.014, maxDelay: 0.2 })).connect(tapeIn);
      const sample = K(new Tone.Gain(1)).connect(drag);

      const rhodes = I.rhodes(ctx, { volume: -6, cutoff: 2600, tremolo: 3.0, tremoloDepth: 0.34, bark: 1.8, tine: -16 });
      const sax = I.sax(ctx, { volume: -1, cutoff: 2300, base: 600, vibratoDepth: 0.06, vibrato: 5.0, breath: -26 });
      const flute = I.flute(ctx, { volume: 0, cutoff: 3000, vibratoDepth: 0.05 });
      const strings = I.stringMachine(ctx, { volume: -12, cutoff: 1900, attack: 0.9, release: 2.2 });
      const marimba = I.marimba(ctx, { volume: -13, cutoff: 3200, hardness: 1.1, decay: 0.9 });
      const bass = I.ebass(ctx, { volume: -4, fretless: true, base: 120 });
      const kit = I.kit(ctx, { volume: -3, kickNote: 30, preload: ["kick", "snare", "rim", "hatClosed", "shaker"] });
      I.place(ctx, rhodes, -0.3, sample); I.place(ctx, sax, 0.08, sample); I.place(ctx, flute, 0.12, sample);
      I.place(ctx, strings, 0, sample); I.place(ctx, marimba, 0.4, sample); I.place(ctx, bass, 0, sample);
      const drumLP = K(new Tone.Filter({ frequency: 5200, type: "lowpass", rolloff: -12 })).connect(sample);
      I.place(ctx, kit, 0.04, drumLP);

      // ---- the mall (not on the tape) ----
      const atrium = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.05, lowcut: 300, highcut: 5000 });
      // murmur: pink noise in four voice-formant bands, each flickering at a syllable rate and swelling slowly
      const murGain = K(new Tone.Gain(0)).connect(out);
      I.send(ctx, murGain, atrium, -4);
      const murLP = K(new Tone.Filter({ frequency: 2600, type: "lowpass" })).connect(murGain);
      const pink = K(new Tone.Noise({ type: "pink" }).start());
      [[330, 3.1, 0.07, -0.45], [720, 4.4, 0.11, 0.3], [1300, 5.3, 0.05, -0.1], [2200, 3.7, 0.09, 0.55]].forEach(([f, syl, swell, pan]) => {
        const bp = K(new Tone.Filter({ frequency: f, type: "bandpass", Q: 1.6 }));
        const g1 = K(new Tone.Gain(0)), g2 = K(new Tone.Gain(0.5)), p = K(new Tone.Panner(pan));
        pink.connect(bp); bp.connect(g1); g1.connect(g2); g2.connect(p); p.connect(murLP);
        K(new Tone.LFO({ frequency: syl, min: 0.15, max: 1 }).start()).connect(g1.gain);
        K(new Tone.LFO({ frequency: swell, min: 0.25, max: 1, phase: f % 360 }).start()).connect(g2.gain);
      });
      // fountain: bright white noise, slowly surging, off to one side
      const waterGain = K(new Tone.Gain(0)).connect(out);
      I.send(ctx, waterGain, atrium, -8);
      const waterPan = K(new Tone.Panner(0.6)).connect(waterGain);
      const surge = K(new Tone.Gain(0.7)).connect(waterPan);
      K(new Tone.LFO({ frequency: 0.09, min: 0.55, max: 1 }).start()).connect(surge.gain);
      const waterLP = K(new Tone.Filter({ frequency: 6500, type: "lowpass" })).connect(surge);
      const waterHP = K(new Tone.Filter({ frequency: 1700, type: "highpass" })).connect(waterLP);
      K(new Tone.Noise({ type: "white" }).start()).connect(waterHP);
      // PA chime: a vibraphone through a ceiling speaker, far away
      const chime = I.vibes(ctx, { volume: -12, motorDepth: 0, decay: 2.8 });
      const paHP = K(new Tone.Filter({ frequency: 520, type: "highpass" }));
      const paLP = K(new Tone.Filter({ frequency: 2800, type: "lowpass" })).connect(paHP);
      const paPan = K(new Tone.Panner(-0.5)); paHP.connect(paPan); paPan.connect(out);
      chime.out.connect(paLP);
      I.send(ctx, paPan, atrium, 0);

      const clk = { mur: I.monotonic(murGain), water: I.monotonic(waterGain), duck: I.monotonic(duckGain), glitch: I.monotonic(glitchGain), drag: I.monotonic(drag) };

      return {
        sax: { layer: "melody", humanize: { timing: 0.012, vel: 0.05 }, play: (t, e, d) => sax.play(t, e.note, d, e.vel) },
        flute: { layer: "melody", humanize: { timing: 0.012, vel: 0.05 }, play: (t, e, d) => flute.play(t, e.note, d, e.vel) },
        rhodes: { layer: "harmony", humanize: { timing: 0.01, vel: 0.06 }, play: (t, e, d) => rhodes.play(t, e.note, d, e.vel) },
        strings: { layer: "harmony", humanize: { timing: 0.02, vel: 0.03 }, play: (t, e, d) => strings.play(t, e.note, d, e.vel) },
        marimba: { layer: "melody", humanize: { timing: 0.006, vel: 0.06 }, play: (t, e, d) => marimba.play(t, e.note, d, e.vel) },
        bass: { layer: "bass", humanize: { timing: 0.006, vel: 0.05 }, play: (t, e, d) => bass.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", humanize: { timing: 0.004, vel: 0.08 }, play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }) },
        chime: { layer: "texture", humanize: { timing: 0, vel: 0.03 }, play: (t, e, d) => chime.play(t, e.note, d, e.vel) },
        mall: { layer: "texture", humanize: { timing: 0, vel: 0 }, play: (t, e, d) => {
          const lvl = fin(e.lvl, 0.5), len = fin(d, 1);
          if (e.note === "murmur") { const tt = clk.mur(t), g = murGain.gain; g.cancelScheduledValues(tt); g.setTargetAtTime(db(-13) * lvl, tt, 2.5); }
          else if (e.note === "water") { const tt = clk.water(t), g = waterGain.gain; g.cancelScheduledValues(tt); g.setTargetAtTime(db(-29) * lvl, tt, 3); }
          else if (e.note === "pass") { // someone walks between you and the speaker
            const tt = clk.duck(t), g = duckGain.gain, f = duckLP.frequency;
            g.cancelScheduledValues(tt); f.cancelScheduledValues(tt);
            g.setTargetAtTime(0.4 + 0.25 * (1 - lvl), tt, 0.35); g.setTargetAtTime(1, tt + len, 0.6);
            f.setTargetAtTime(1500 + 1500 * (1 - lvl), tt, 0.3); f.setTargetAtTime(16000, tt + len, 0.8);
          } else if (e.note === "glitch") { // the edit point: a 30 ms hole in the tape
            const tt = clk.glitch(t), g = glitchGain.gain;
            g.cancelScheduledValues(tt); g.setTargetAtTime(0.25, tt, 0.004); g.setTargetAtTime(1, tt + 0.03, 0.012);
          } else if (e.note === "slow" || e.note === "speed") { // the deck changes speed: the pitch sags (or rises)
            const tt = clk.drag(t), p = drag.delayTime;
            p.cancelScheduledValues(tt);
            p.setTargetAtTime(e.note === "slow" ? 0.014 + 0.05 * lvl : 0.014, tt, len / 2.5);
          }
        } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const P = planAt(cycle);
      state.src ||= {};
      if (!state.src[P.src]) state.src[P.src] = buildSource(P.src, r.fork(1000 + Object.keys(state.src).length));
      const segs = editFor(P.edit, r);
      const { ev: raw, harm, cuts } = render(state.src[P.src], segs, P.k);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      raw.forEach((e) => { const { track, beat, dur, note, vel, pitch } = e; push(track, beat, dur, note, vel, pitch != null ? { pitch } : undefined); });
      const harmony = harm.map((h) => { const p = C.at(h.start, BPB); return { bar: p.bar, beat: p.beat, dur: h.dur, chord: h.chord }; });
      const chordAt = (b) => { let cur = harm[0]; for (const h of harm) if (h.start <= b + 1e-6) cur = h; return cur.chord; };

      // ---- the mall ----
      push("mall", 0, 1, "murmur", 0.6, { lvl: P.murmur });
      push("mall", 0, 1, "water", 0.6, { lvl: P.water });
      cuts.forEach((at) => push("mall", at, 0.1, "glitch", 0.6));
      const passes = P.src === "skylight" ? r.weighted([[0, 3], [1, 1]]) : r.weighted([[0, 2], [1, 4], [2, 1.5]]);
      for (let i = 0, from = 1; i < passes && from < 26; i++) {
        const at = r.int(from, Math.min(27, from + 12)) + r.pick([0, 0.5]);
        push("mall", at, r.range(1.8, 3.6), "pass", 0.6, { lvl: r.range(0.3, 1) });
        from = at + 5;
      }
      // PA chime: three rising tones of the tonic triad (in the sample's key), only over chords that hold them
      if (P.chime || r.chance(0.18)) {
        const triad = [73, 77, 80].map((m) => m + P.k), pcs = triad.map(mod12);
        const fits = (b) => { const c = T.chord(chordAt(b)), set = new Set(c.pcs.concat(c.scale)); return pcs.every((p) => c.pcs.includes(p) || (set.has(p) && !c.pcs.includes(mod12(p - 1)) && !c.pcs.includes(mod12(p + 1)))); };
        const bars = r.shuffle([1, 2, 3, 4, 5, 6]).filter((bar) => [0.5, 2, 3.25, 4.25].every((x) => fits(bar * BPB + x)));
        if (bars.length) {
          const at = bars[0] * BPB + 0.5;
          triad.forEach((m, j) => push("chime", at + j * 0.75, 3, m, 0.5 - j * 0.04));
        }
      }
      // ---- the deck changes speed between sides ----
      let tempo;
      if (P.i === 7) push("mall", 30, 2, "slow", 0.6, { lvl: 1 }); // the tape sags into side B and stays slow
      if (P.i === 8) tempo = { bpm: Math.round(72 * Math.pow(2, P.k / 12)), rampBeats: 3 };
      if (P.i === 0 && cycle > 0) { tempo = { bpm: 72, rampBeats: 2 }; push("mall", 0, 1.5, "speed", 0.6, { lvl: 1 }); }

      const side = P.side ? `Side B · ${keyName(P.k)}, slowed` : "Side A";
      return { events: ev, harmony, section: `${side} · ${P.label}`, state, tempo };
    },
  });
})();
