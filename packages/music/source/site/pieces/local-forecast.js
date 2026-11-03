// Local Forecast: early-90s smooth jazz for the local weather on the eights.
//
// The piece is a run of "segments", one per city, each 16 bars (two cycles) in its own key:
//   A  the soprano-sax theme over  Imaj9 – vi11 – IVmaj9 – V13sus4 | iii11 – VI7b13 – ii11 – iv9/bVII
//      (the backdoor iv9/bVII lands deceptively on bVImaj9 to open B)
//   B  bVImaj9 – ii11 V13 – IVmaj9 – iv9 bVII13 – iii11 – bIIImaj9#11, then two pivot bars, ii11 – V13sus4 V13
//      of the NEXT city's key, under a sax solo, a DX-piano solo, or (once a round) a "radar loop" of just
//      slap bass, drum machine and bell pings.
// The keys move alternately up a minor third and down a major third (Db E C Eb B D Bb, then home to Db), so
// every pivot is a chromatic-mediant hop smoothed by its own ii–V, and every arrival gets a little bell sting:
// a pickup arpeggio on the V13 and a rolled maj9 chime on the new downbeat.
// Band: soprano-ish sax (theme, tasteful fills, solos), bright DX-style Rhodes comping maj9/m11/13sus voicings
// with 16th pushes, a clean chorus guitar when the keys solo, a soft analog pad, fretless bass on one city
// and slap on the next, and a quiet drum machine: soft kick, cross-stick on 2 and 4 under the theme, snare
// and clap under the solos, 16th hats and shaker, congas that come and go, a triangle on each new city.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony (written in C) ----------
  const PROG_A = "| Cmaj9 | Am11 | Fmaj9 | G13sus4 | Em11 | A7b13 | Dm11 | Fm9/Bb |";
  const PROG_B = "| Abmaj9 | Gm11 C13 | Fmaj9 | Fm9 Bb13 | Em11 | Ebmaj9#11 |";
  const KEYS = [1, 4, 0, 3, 11, 2, 10]; // Db E C Eb B D Bb (then Db again)
  const CITIES = ["Boise", "Savannah", "Duluth", "Tucson", "Spokane", "Wichita", "Albany", "Tampa", "Fargo", "Reno", "Mobile", "Eugene", "Macon", "Billings"];
  const WEATHER = ["partly cloudy", "scattered showers", "clear skies", "patchy fog", "breezy", "high of 74", "humid", "light drizzle", "sunny and mild", "a few clouds", "winds out of the west", "dew point 58"];

  // ---------- tunes (in C) [bar, beat, dur, note] ----------
  // Four phrases with room between them for fills: up to the 9th, down to the sus, a climb to the 5th of iii
  // and a b13 → 5 → 3 sigh over VI7, then home to the 9th of the backdoor chord.
  const THEME = [
    [0, 1, 0.5, "G4"], [0, 1.5, 0.5, "C5"], [0, 2, 0.5, "D5"], [0, 2.5, 1.5, "E5"],
    [1, 0.25, 0.25, "D5"], [1, 0.5, 0.25, "E5"], [1, 0.75, 1.75, "G5"],
    [2, 0, 0.75, "A5"], [2, 0.75, 0.25, "G5"], [2, 1, 0.5, "E5"], [2, 1.5, 1, "C5"], [2, 2.5, 0.5, "D5"], [2, 3, 1, "E5"],
    [3, 0, 1.5, "D5"],
    [4, 0.5, 0.5, "E5"], [4, 1, 0.5, "G5"], [4, 1.5, 0.5, "A5"], [4, 2, 2, "B5"],
    [5, 0, 0.5, "A5"], [5, 0.5, 0.5, "G5"], [5, 1, 1.25, "F5"], [5, 2.25, 0.25, "E5"], [5, 2.5, 1, "C#5"],
    [6, 0, 1, "D5"], [6, 1, 0.5, "E5"], [6, 1.5, 0.5, "F5"], [6, 2, 0.5, "A5"], [6, 2.5, 1.5, "G5"],
    [7, 0, 0.75, "F5"], [7, 0.75, 0.25, "Eb5"], [7, 1, 2, "G5"],
  ];
  const GAPS = [[1, 2.75, 3.75], [3, 2, 3.75]]; // [bar, from, to] in the theme where fills go
  const THEME_MOTIF = { len: 3, rhythm: [{ off: 0, dur: 0.5 }, { off: 0.5, dur: 0.5 }, { off: 1, dur: 0.5 }, { off: 1.5, dur: 1.5 }], steps: [0, 2.5, 1.2, 1.2] };

  // ---------- rhythm tables ----------
  // Rhodes comping per chord span: [beat, dur]; -0.25 = a 16th push into the chord
  const COMP4 = [
    [[[0, 1.6], [2.5, 1.3]], 3], [[[0, 3.6]], 2], [[[-0.25, 1.4], [1.75, 0.6], [2.75, 1.1]], 2],
    [[[0, 0.6], [1.5, 2.2]], 2], [[[-0.25, 2.1], [2.75, 1]], 1.5], [[[0.5, 1], [2.25, 1.6]], 1],
  ];
  const COMP2 = [[[[0, 1.8]], 3], [[[-0.25, 2]], 2], [[[0, 0.6], [1.25, 0.7]], 1.2]];
  const GTR4 = [[[[1, 0.2], [2.75, 0.4]], 2], [[[0.75, 0.2], [1.5, 0.2], [3, 0.5]], 1.5], [[[1.5, 0.3], [3.25, 0.3]], 1.5]];
  const GTR2 = [[[[1, 0.25]], 2], [[[0.75, 0.2], [1.5, 0.3]], 1]];
  // Fretless: [beat, dur, role]; roles R root, F fifth, O octave, T tenth, S seventh, A approach (legato)
  const FRET4 = [
    [[[0, 2.75, "R"], [3, 0.5, "F"], [3.5, 0.5, "A"]], 3],
    [[[0, 1.5, "R"], [1.5, 1, "T"], [2.5, 1, "F"], [3.5, 0.5, "A"]], 2],
    [[[0, 0.75, "R"], [0.75, 1.75, "R"], [2.5, 0.75, "O"], [3.25, 0.75, "A"]], 2],
    [[[0, 3.25, "R"], [3.25, 0.75, "A"]], 1.5],
  ];
  const FRET2 = [[[[0, 1.5, "R"], [1.5, 0.5, "A"]], 3], [[[0, 0.75, "R"], [0.75, 1.25, "F"]], 1.5], [[[0, 2, "R"]], 1]];
  // Slap: [beat, dur, role, art]
  const SLAP4 = [
    [[[0, 0.5, "R", "thumb"], [0.75, 0.2, "R", "ghost"], [1, 0.25, "O", "pop"], [1.5, 0.5, "R", "thumb"], [2.25, 0.2, "R", "ghost"], [2.5, 0.25, "O", "pop"], [3, 0.4, "F", "thumb"], [3.5, 0.2, "O", "pop"], [3.75, 0.25, "A", "thumb"]], 3],
    [[[0, 0.75, "R", "thumb"], [1, 0.25, "O", "pop"], [1.25, 0.2, "R", "ghost"], [1.5, 0.5, "R", "thumb"], [2.5, 0.5, "F", "thumb"], [3, 0.25, "O", "pop"], [3.5, 0.5, "A", "thumb"]], 2],
    [[[0, 1, "R", "thumb"], [1.5, 0.25, "O", "pop"], [1.75, 0.2, "R", "ghost"], [2, 0.5, "R", "thumb"], [2.75, 0.25, "S", "pop"], [3.25, 0.2, "R", "ghost"], [3.5, 0.5, "A", "thumb"]], 2],
  ];
  const SLAP2 = [
    [[[0, 0.5, "R", "thumb"], [0.75, 0.2, "R", "ghost"], [1, 0.25, "O", "pop"], [1.5, 0.5, "A", "thumb"]], 2],
    [[[0, 0.75, "R", "thumb"], [1, 0.25, "O", "pop"], [1.25, 0.2, "R", "ghost"], [1.5, 0.5, "F", "thumb"]], 1.5],
  ];
  const KICKS = [[0, 2.5], [0, 0.75, 2.5], [0, 2.5, 2.75], [0, 1.75, 2.5], [0, 1.5, 2.5, 3.75]];
  // short fills: [offset, dur, scale steps above a target chord tone]
  const LICKS = [
    [[0, 0.25, 3], [0.25, 0.25, 2], [0.5, 0.25, 1], [0.75, 0.6, 0]],
    [[0, 0.25, -1], [0.25, 0.25, 0], [0.5, 0.25, 2], [0.75, 0.6, 1]],
    [[0, 0.5, 2], [0.5, 0.25, 1], [0.75, 0.6, 0]],
    [[0, 0.25, 4], [0.25, 0.25, 3], [0.5, 0.25, 1], [0.75, 0.25, 2], [1, 0.5, 0]],
  ];

  // ---------- spelling & transposition ----------
  const FLAT = T.NAMES, SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SHARP_KEYS = new Set([7, 2, 9, 4, 11]);
  function spell(pc, tonic) {
    pc = mod12(pc);
    if (![1, 3, 6, 8, 10].includes(pc) || !SHARP_KEYS.has(tonic)) return FLAT[pc];
    return [1, 3, 8, 10].includes(mod12(pc - tonic)) ? FLAT[pc] : SHARP[pc];
  }
  function trChord(sym, t, tonic) {
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    return spell(T.PC[m[1]] + t, tonic) + m[2] + (m[3] ? "/" + spell(T.PC[m[3]] + t, tonic) : "");
  }
  function trProg(text, t, tonic) {
    return text.split(/\s+/).map((tok) => (tok === "|" || tok === "" ? tok : trChord(tok, t, tonic))).join(" ");
  }
  const progCache = new Map();
  function harmonyFor(part, seg) {
    const key = KEYS[seg], next = KEYS[(seg + 1) % KEYS.length];
    const id = `${part}|${seg}`;
    if (!progCache.has(id)) {
      let text;
      if (part === "A") text = trProg(PROG_A, key, key);
      else text = trProg(PROG_B, key, key) + ` ${spell(next + 2, next)}m11 | ${spell(next + 7, next)}13sus4 ${spell(next + 7, next)}13 |`;
      progCache.set(id, T.progression(text));
    }
    return progCache.get(id);
  }
  const keyName = (pc) => spell(pc, pc).replace("b", "♭").replace("#", "♯");
  const melShift = (t) => (t > 4 ? t - 12 : t);

  // Voicing search: every arrangement of the chord's n most characteristic tones (guide tones, colours,
  // then the fifth; rootless) inside [lo, hi], with no semitone or seconds low down, no minor 9ths, no
  // gaps wider than a sixth, scored on voice leading from `prev` and on where the top voice sits.
  function voiceKeys(sym, prev, o) {
    const c = T.chord(sym);
    let pri = [...new Set(c.guide.concat(c.colors, c.intervals.filter((i) => i >= 6 && i <= 8).map((i) => mod12(c.root + i))))];
    if (c.bass !== c.root) pri = pri.filter((p) => p !== c.bass);
    if (pri.length < o.n) for (const p of c.pcs) if (!pri.includes(p) && p !== c.bass && pri.length < o.n) pri.push(p);
    let best = null, bs = Infinity;
    for (const n of [o.n, o.n - 1]) {
      const set = pri.slice(0, n);
      const opts = set.map((pc) => T.notesIn([pc], o.lo, o.hi));
      const walk = (i, acc) => {
        if (i === opts.length) {
          const v = acc.slice().sort((a, b) => a - b);
          for (let k = 1; k < v.length; k++) {
            const g = v[k] - v[k - 1];
            if (g === 1) return;
            if (v[k - 1] < 55 && g < 3) return;
            if (g > 9) return;
          }
          if (v.some((a, x) => v.some((b, y) => y > x && b - a === 13))) return;
          let sc = n < o.n ? 12 : 0;
          const t = v[v.length - 1];
          if (t > o.top[1]) sc += (t - o.top[1]) * 1.6;
          if (t < o.top[0]) sc += (o.top[0] - t) * 1.6;
          if (prev && prev.length) {
            const b = prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
            for (let k = 0; k < m; k++) sc += Math.abs(v[v.length - 1 - k] - b[b.length - 1 - k]) * 0.8;
          } else sc += Math.abs((v[0] + t) / 2 - (o.lo + o.hi) / 2) * 0.4;
          if (sc < bs) { bs = sc; best = v; }
          return;
        }
        for (const m of opts[i]) walk(i + 1, acc.concat([m]));
      };
      walk(0, []);
    }
    return best || T.voice(sym, { lo: o.lo, hi: o.hi, n: 3, prev, omitBass: true });
  }

  /** Chord scale without the avoid note: the natural 11 over chords with a major third. */
  function soloScale(sym) {
    const c = T.chord(sym);
    return c.intervals.includes(4) ? c.scale.filter((p) => p !== mod12(c.root + 5)) : c.scale;
  }

  Sim.register({
    id: "local-forecast",
    title: "Local Forecast",
    genre: "Smooth jazz",
    about: "Early-90s weather-channel smooth jazz: a soprano-ish sax over DX Rhodes maj9 and 13sus chords, fretless or slap bass and a soft drum machine, moving to a new key for every city's forecast with a little bell sting at each pivot.",
    situations: ["presentation", "shopping", "hangout"],
    energy: 0.4,
    bpm: 96, beatsPerBar: 4, swing: 0.54, swingUnit: 0.25, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.9, preDelay: 0.015, lowcut: 300, highcut: 7500 });
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.035, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.26, pingPong: true, highcut: 3200 });

      const sax = I.sax(ctx, { volume: 0, cutoff: 3600, vibratoDepth: 0.045, glide: 0.035 });
      const keys = I.rhodes(ctx, { volume: -6, cutoff: 5200, bark: 3, tine: -8, tremolo: 2.6, tremoloDepth: 0.14 });
      const soloKeys = I.rhodes(ctx, { volume: -1, cutoff: 5600, bark: 3.2, tine: -7, tremolo: 0.01, tremoloDepth: 0 });
      const gtr = I.guitar(ctx, { kind: "clean", chorus: true, volume: -9, dampening: 4200, resonance: 0.9 });
      const pad = I.pad(ctx, { volume: -18, cutoff: 1500, attack: 1.4, release: 2.6, detune: 14, breath: 0.05 });
      const fretless = I.ebass(ctx, { volume: -4, fretless: true, base: 125 });
      const slap = I.slapBass(ctx, { volume: -6 });
      const bell = I.bell(ctx, { volume: -11, decay: 3.2 });
      const cel = I.glock(ctx, { volume: -15, celesta: true, decay: 1.6 });
      const kit = I.kit(ctx, { volume: -4, kickNote: 33, preload: ["kick", "rim", "snare", "clap", "hatClosed", "hatOpen", "shaker", "conga", "congaLow", "triangle"] });

      const sxp = I.place(ctx, sax, 0.08, out), kp = I.place(ctx, keys, -0.3, out), skp = I.place(ctx, soloKeys, -0.12, out);
      const gp = I.place(ctx, gtr, 0.38, out), pp = I.place(ctx, pad, 0.15, out);
      I.place(ctx, fretless, 0, out); I.place(ctx, slap, 0, out);
      const bp = I.place(ctx, bell, 0.25, out), cp = I.place(ctx, cel, -0.3, out);
      const dp = I.place(ctx, kit, 0, out);
      I.send(ctx, sxp, hall, -10); I.send(ctx, sxp, echo, -16);
      I.send(ctx, kp, room, -12); I.send(ctx, kp, hall, -18); I.send(ctx, skp, hall, -14); I.send(ctx, skp, echo, -18);
      I.send(ctx, gp, room, -10); I.send(ctx, gp, echo, -15); I.send(ctx, pp, hall, -9);
      I.send(ctx, bp, hall, -6); I.send(ctx, bp, echo, -11); I.send(ctx, cp, hall, -7); I.send(ctx, cp, echo, -12);
      I.send(ctx, dp, room, -16); I.send(ctx, fretless.out, room, -24);

      return {
        sax: { layer: "melody", play: (t, e, d) => sax.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        solo: { layer: "melody", play: (t, e, d) => soloKeys.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        fill: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.08 } },
        gtr: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.006, vel: 0.07 } },
        pad: { layer: "texture", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        fretless: { layer: "bass", play: (t, e, d) => fretless.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        slap: { layer: "bass", play: (t, e, d) => slap.play(t, e.note, d, e.vel, e.art || "thumb"), humanize: { timing: 0.003, vel: 0.06 } },
        bell: { layer: "texture", play: (t, e, d) => { bell.play(t, e.note, d, e.vel); if (e.cel) cel.play(t, e.note, d, e.vel * 0.9); }, humanize: { timing: 0.002, vel: 0.04 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.ring }), humanize: { timing: 0.004, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const perRound = KEYS.length * 2;
      const round = Math.floor(cycle / perRound), pos = cycle % perRound;
      const seg = Math.floor(pos / 2), part = pos % 2 === 0 ? "A" : "B";
      const key = KEYS[seg], next = KEYS[(seg + 1) % KEYS.length];
      const prog = harmonyFor(part, seg);
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const spans = prog.map((c) => ({ ...c, s0: c.bar * 4 + c.beat, e: c.bar * 4 + c.beat + c.dur }));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };
      const ms = melShift(key);
      const pent = [0, 2, 4, 7, 9].map((x) => mod12(key + x));

      // per-segment choices, made on the segment's A cycle
      if (part === "A" || state.segFor !== `${round}|${seg}`) {
        state.segFor = `${round}|${seg}`;
        state.city = CITIES[(seg + KEYS.length * round) % CITIES.length];
        state.weather = r.pick(WEATHER);
        state.slap = (seg + round) % 2 === 1;
        state.bType = seg === 4 ? "radar" : (seg + round) % 2 === 0 ? "sax" : "keys";
        state.kicks = [r.int(0, 2), r.int(1, KICKS.length - 1)];
        state.congas = r.chance(0.5);
        state.fillBy = r.pick(["keys", "sax", "both"]);
      }
      const B = part === "B", bType = state.bType;
      const radar = B && bType === "radar";
      const ornate = round > 0 || seg % 2 === 1;

      // ---------- melody ----------
      const melBusy = []; // [from, to] spans where the lead is playing
      const mark = (a, b) => melBusy.push([a, b]);
      const busyAt = (a, b) => melBusy.some(([x, y]) => x < b && y > a);
      const lick = (track, from, to, lo, hi, vel) => {
        const c = T.chord(sym(from)), sc = c.scale;
        let pcs = pent.filter((p) => sc.includes(p));
        if (pcs.length < 4) pcs = sc;
        const shape = r.pick(LICKS.filter((l) => l[l.length - 1][0] + 0.5 <= to - from));
        if (!shape) return;
        const end = to - shape[shape.length - 1][0] - shape[shape.length - 1][1];
        const start = Math.max(from, Math.round(end * 4) / 4);
        const goal = c.guide.concat(c.colors).filter((p) => pcs.includes(p));
        let target = T.nearest(r.int(lo + 2, hi - 2), goal.length ? goal : c.pcs, lo, hi);
        const shapeNotes = (tg) => shape.map(([, , s]) => (s ? T.step(tg, s, pcs) : tg));
        if (Math.max(...shapeNotes(target)) > hi + 2) target = T.nearest(target - 7, goal.length ? goal : c.pcs, lo - 3, target - 1);
        const ns = shapeNotes(target);
        shape.forEach(([o, d, s], j) => {
          const at = start + o;
          push(track, at, Math.min(d, to - at), ns[j], vel + (s === 0 ? 0.05 : 0) + r.range(-0.03, 0.03));
        });
        mark(start, to);
      };
      if (!B) {
        const notes = THEME.map(([b, x, d, n]) => ({ at: b * 4 + x, dur: d, note: T.midi(n) + ms }));
        notes.forEach((n, i) => {
          const long = n.dur >= 1;
          const vel = 0.62 + (long ? 0.06 : 0) + (n.dur <= 0.25 ? -0.06 : 0) + r.gauss(0.025);
          const prevN = i > 0 ? notes[i - 1] : null;
          if (ornate && long && prevN && Math.abs(prevN.note - n.note) > 1 && r.chance(0.35)) { // scoop from below
            push("sax", n.at, 0.12, n.note - 1, vel * 0.7);
            push("sax", n.at, n.dur - 0.05, n.note, vel, { delay: 0.045 });
          } else push("sax", n.at, n.dur >= 0.5 ? n.dur - 0.04 : n.dur * 0.92, n.note, vel);
          mark(n.at, n.at + n.dur);
        });
        // fills in the theme's gaps: the Rhodes answers, or the sax answers itself
        GAPS.forEach(([bar, a, b], gi) => {
          const who = state.fillBy === "both" ? (gi ? "sax" : "fill") : state.fillBy === "sax" ? "sax" : "fill";
          if (!r.chance(ornate ? 0.85 : 0.6)) return;
          if (who === "sax") lick("sax", bar * 4 + a, bar * 4 + b, Math.min(70 + ms, 72), Math.min(82 + ms, 83), 0.54);
          else lick("fill", bar * 4 + a, bar * 4 + b, 74, 86, 0.44);
        });
      } else if (bType === "sax" || bType === "keys") {
        const isSax = bType === "sax";
        const m = C.line({
          start: 0, end: 29.5, chordAt: sym, lo: isSax ? 64 : 67, hi: isSax ? 84 : 88, rng: r.fork(11), density: isSax ? 0.42 : 0.55,
          phrase: [3, 7], rest: [1, 2.5], motif: state.soloMotif || THEME_MOTIF, motifProb: 0.35, chromatic: isSax ? 0.2 : 0.3,
          register: 0.55, prev: state.soloLast ?? 76, upbeatStart: 0.5, lead: r.pick([0.5, 1]),
          scaleFor: (s) => { const sc = soloScale(s); const p = pent.filter((x) => sc.includes(x)); return r.chance(0.3) && p.length >= 4 ? p : sc; },
        });
        state.soloMotif = m.motif; state.soloLast = m.last;
        m.notes.forEach((n) => {
          const long = n.dur >= 1;
          const vel = (isSax ? 0.6 : 0.5) + (n.strong ? 0.06 : 0) + r.gauss(0.03);
          if (isSax && long && r.chance(0.3)) { push("sax", n.beat, 0.12, n.note - 1, vel * 0.7); push("sax", n.beat, n.dur, n.note, vel, { delay: 0.045 }); }
          else push(isSax ? "sax" : "solo", n.beat, n.dur, n.note, vel);
          mark(n.beat, n.beat + n.dur);
        });
      } else if (radar) {
        // radar loop: bell pings for four bars, then the sax drifts back in with fills
        let lastPing = null;
        for (let bar = 0; bar < 4; bar++) {
          [r.pick([0.5, 0.75]), r.pick([2, 2.75]), 3.5].forEach((p, j) => {
            if (j === 2 && !r.chance(0.5)) return;
            const c = T.chord(sym(bar * 4 + p));
            const cands = T.notesIn(c.guide.concat(c.colors, [mod12(c.root + 7)]), 76, 91).filter((m) => m !== lastPing);
            lastPing = r.pick(cands);
            push("bell", bar * 4 + p, 1.5, lastPing, 0.28 + r.range(0, 0.08));
          });
        }
        lick("sax", 18, 19.75, 69, 82, 0.52);
        lick("sax", 22, 23.75, 69, 82, 0.55);
        const m = C.line({ start: 24, end: 29.5, chordAt: sym, lo: 66, hi: 82, rng: r.fork(13), density: 0.35, phrase: [3, 5], rest: [1, 1.5], motif: THEME_MOTIF, motifProb: 0.6, register: 0.5, prev: 74 });
        m.notes.forEach((n) => { push("sax", n.beat, n.dur, n.note, 0.58 + r.gauss(0.03)); mark(n.beat, n.beat + n.dur); });
      }

      // ---------- bell sting into the next city ----------
      if (B) {
        // pickup arpeggio on the V13 of the new key: 5, 9, 3, 6 — all tones of that V13
        const stingPcs = [7, 9, 2, 4].map((x) => mod12(next + x)); // 5 6 9 3, rising
        const arp = [];
        stingPcs.forEach((pc, j) => arp.push(j ? T.nearest(arp[j - 1] + 1, [pc], arp[j - 1] + 1, arp[j - 1] + 12) : T.nearest(75, [pc], 70, 81)));
        arp.forEach((m, j) => push("bell", 30 + j * 0.25, 1.75 - j * 0.25, m, 0.36 + j * 0.03, { cel: true }));
      }
      if (!B) {
        // arrival chime: the new key's maj9, rolled upward
        const pcs = [4, 7, 11, 14].map((x) => mod12(key + x));
        const arp = [];
        pcs.forEach((pc, j) => arp.push(j ? T.nearest(arp[j - 1] + 1, [pc], arp[j - 1] + 1, arp[j - 1] + 12) : T.nearest(75, [pc], 70, 81)));
        arp.forEach((m, j) => push("bell", 0, 2.5, m, 0.34, { delay: j * 0.035, cel: j >= 2 }));
      }

      // ---------- Rhodes comping (or guitar when the keys solo) ----------
      const keysSolo = B && bType === "keys";
      const hits = [];
      spans.forEach((c, i) => {
        if (radar && c.s0 < 16) return;
        const v = voiceKeys(c.chord, state.kv, { lo: 52, hi: 74, n: 4, top: [64, 71] });
        state.kv = v;
        if (keysSolo) {
          const gv = voiceKeys(c.chord, state.gv, { lo: 62, hi: 79, n: 3, top: [72, 78], noSemi: true });
          state.gv = gv;
          const pat = r.weighted(c.dur >= 4 ? GTR4 : GTR2);
          pat.forEach(([b, d]) => { if (c.s0 + b < c.e - 0.1) push("gtr", c.s0 + b, d, gv, 0.42 + r.range(-0.04, 0.04), { strum: r.chance(0.5) ? 0.008 : -0.007 }); });
          return;
        }
        let pats = c.dur >= 4 ? COMP4 : COMP2;
        if (c.s0 === 0 || (radar && c.s0 === 16)) pats = pats.filter(([p]) => p[0][0] >= 0);
        const pat = r.weighted(pats);
        hits.push(pat.map(([b, d]) => ({ at: c.s0 + b, d, v, first: b === pat[0][0] })));
      });
      hits.forEach((hs, i) => {
        const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((h) => h.at)) : 32;
        hs.filter((h) => h.at < nextStart - 0.2).forEach((h) => {
          if (B && h.at >= 30) return; // leave the sting alone
          let d = Math.min(h.d, nextStart - h.at - 0.05);
          if (B && h.at < 30 && h.at + d > 30) d = 30 - h.at - 0.05;
          const quieter = busyAt(h.at, h.at + d) ? 0.92 : 1;
          push("keys", h.at, Math.max(0.2, d), h.v, (0.44 + (h.first ? 0.05 : 0) + r.range(-0.03, 0.04)) * quieter);
        });
      });
      if (B) { const last = spans[spans.length - 1]; push("keys", 30, 1.9, voiceKeys(last.chord, state.kv, { lo: 52, hi: 74, n: 4, top: [64, 71] }), 0.36); }

      // ---------- pad ----------
      spans.forEach((c) => {
        if (radar && c.s0 < 16) return;
        const v = voiceKeys(c.chord, state.pv, { lo: 60, hi: 79, n: 3, top: [71, 77], noSemi: true });
        state.pv = v;
        push("pad", c.s0, c.dur - 0.08, v, B ? 0.36 : 0.3);
      });

      // ---------- bass ----------
      const bassTrack = state.slap || radar ? "slap" : "fretless";
      const slapOn = bassTrack === "slap";
      let root = state.bassRoot ?? 37;
      let lastNote = state.bassLast ?? root;
      const rootOf = (pc, near) => T.nearest(near, [pc], 31, 45);
      const nextFirst = B ? harmonyFor("A", (seg + 1) % KEYS.length)[0].chord : harmonyFor("B", seg)[0].chord;
      if (!state.bassPick || part === "A") state.bassPick = { f4: r.weighted(FRET4), f2: r.weighted(FRET2), s4: r.weighted(SLAP4), s2: r.weighted(SLAP2) };
      // chords sharing a bass note (V13sus4 → V13) are one span for the bass
      const bspans = [];
      spans.forEach((c) => {
        const prev = bspans[bspans.length - 1];
        if (prev && T.chord(prev.chord).bass === T.chord(c.chord).bass) prev.e = c.e;
        else bspans.push({ s0: c.s0, e: c.e, chord: c.chord });
      });
      bspans.forEach((sp, i) => {
        const ch = T.chord(sp.chord), len = sp.e - sp.s0;
        root = rootOf(ch.bass, root);
        const nextSym = i + 1 < bspans.length ? bspans[i + 1].chord : nextFirst;
        const nextRoot = rootOf(T.chord(nextSym).bass, root);
        const fifth = root + (ch.intervals.find((x) => x >= 6 && x <= 8) ?? (ch.intervals.includes(10) ? 10 : 7)); // no fifth (7b13): the b7
        const third = ch.intervals.includes(4) ? 4 : ch.intervals.includes(3) ? 3 : 5;
        const sev = ch.intervals.includes(10) ? 10 : ch.intervals.includes(11) ? 7 : 12;
        let cell;
        if (slapOn) cell = len >= 4 ? (r.chance(0.2) ? r.weighted(SLAP4) : state.bassPick.s4) : (r.chance(0.25) ? r.weighted(SLAP2) : state.bassPick.s2);
        else cell = len >= 4 ? (r.chance(0.25) ? r.weighted(FRET4) : state.bassPick.f4) : state.bassPick.f2;
        if (radar && sp.s0 < 16 && len >= 4 && r.chance(0.3)) cell = r.weighted(SLAP4);
        cell.forEach(([pos, dur, role, art]) => {
          if (pos >= len - 0.01) return;
          if (B && sp.s0 + pos >= 30 && role !== "R") return;
          let n;
          if (role === "R") n = root;
          else if (role === "O") n = root + 12;
          else if (role === "F") n = fifth > 45 ? fifth - 12 : fifth;
          else if (role === "T") n = root + third + 12 <= 50 ? root + third + 12 : root + third;
          else if (role === "S") n = root + sev;
          else { // approach the next root: a half step below, a scale step above, or the fifth
            // chord tones within a fourth of the target, or a chromatic lower neighbour that is in the chord's scale
            const below = nextRoot - 1;
            const opts = T.notesIn(ch.pcs, nextRoot - 4, nextRoot + 4).filter((x) => x !== nextRoot && x !== lastNote).map((x) => [x, 3 - Math.abs(x - nextRoot) * 0.5 + (x < nextRoot ? 0.5 : 0)]);
            if (ch.scale.includes(mod12(below)) || (slapOn && dur <= 0.25)) opts.push([below, 2.5]);
            n = nextRoot === root ? fifth > 45 ? fifth - 12 : fifth : r.weighted(opts.length ? opts : [[nextRoot - 1, 1]]);
            if (!slapOn) dur = len - pos; // legato, so the fretless glides
          }
          const at = sp.s0 + pos;
          let d = Math.min(dur, len - pos);
          if (B && at < 30 && at + d > 30.5) d = 30.5 - at;
          const vel = art === "ghost" ? 0.5 : role === "A" ? 0.66 : pos === 0 ? 0.86 : 0.74;
          const top = slapOn && role === "O" ? 57 : 52;
          while (n > top) n -= 12;
          while (n < 28) n += 12;
          push(bassTrack, at, d, n, vel, slapOn ? { art: art || "thumb" } : undefined);
          lastNote = n;
        });
      });
      state.bassRoot = root; state.bassLast = lastNote;

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      const HAT = [0.36, 0.14, 0.26, 0.17], SHK = [0.24, 0.1, 0.18, 0.12];
      for (let bar = 0; bar < 8; bar++) {
        const Bb = bar * 4, last = bar === 7;
        const sparse = radar && bar < 4;
        const stop = B && last ? 2 : 4; // the band drops out under the bell sting
        const kicks = KICKS[state.kicks[bar % 2]];
        kicks.forEach((b) => { if (b < stop) D(Bb + b, "kick", b === 0 ? 0.72 : 0.56); });
        if (B && !sparse) {
          [1, 3].filter((b) => b < stop).forEach((b) => { D(Bb + b, "snare", 0.48); D(Bb + b, "clap", 0.2); });
          [1.75, 3.25].forEach((b) => { if (b < stop && r.chance(0.35)) D(Bb + b, "snare", 0.12, { delay: 0.01 }); });
        } else [1, 3].filter((b) => b < stop).forEach((b) => D(Bb + b, "rim", sparse ? 0.4 : 0.46));
        // hats & shaker
        const fillFrom = !B && last ? 3.25 : 4;
        for (let s = 0; s < 16; s++) {
          const b = s / 4;
          if (b >= stop || b >= fillFrom) break;
          if (!sparse) {
            if (B && bar % 2 === 1 && s === 14) { D(Bb + b, "hatOpen", 0.24); continue; }
            if (B && bar % 2 === 1 && s === 15) continue;
            if (!B && s % 4 === 1 && r.chance(0.3)) continue;
            D(Bb + b, "hatClosed", HAT[s % 4] + r.range(-0.02, 0.02));
          }
          if (B || bar >= 4) D(Bb + b, "shaker", SHK[s % 4] * (sparse ? 1.25 : 1) + r.range(-0.02, 0.02));
        }
        // congas come and go
        const congaOn = (B && bType === "sax") || (!B && state.congas && bar >= 4) || (radar && bar >= 4);
        if (congaOn && !last) {
          D(Bb + 1.5, "conga", 0.26, { pitch: 63 }); D(Bb + 1.75, "conga", 0.2, { pitch: 63 });
          D(Bb + 3.5, "congaLow", 0.3, { pitch: 56 });
          if (bar % 2 === 1) D(Bb + 2.75, "conga", 0.18, { pitch: 63 });
        }
        if (fillFrom < 4) {
          if (r.chance(0.5)) [[3.25, 0.18], [3.5, 0.26], [3.75, 0.34]].forEach(([b, v]) => D(Bb + b, "snare", v, { delay: 0.008 }));
          else { D(Bb + 3.25, "conga", 0.3, { pitch: 65 }); D(Bb + 3.5, "conga", 0.32, { pitch: 61 }); D(Bb + 3.75, "congaLow", 0.36, { pitch: 55 }); }
        }
      }
      if (!B) { D(0, "triangle", 0.34, { ring: 1.4 }); D(0, "crash", 0.18); }

      const nameKey = keyName(key);
      const what = !B ? `${state.weather}` : bType === "sax" ? "sax solo" : bType === "keys" ? "keys solo" : "radar loop · bass and drums";
      const label = `${part === "A" ? "Local on the 8s" : "Extended outlook"} · ${state.city} · ${nameKey} · ${what}${B ? ` → ${keyName(next)}` : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
