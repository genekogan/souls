// Build Mode: a sly chamber-pop waltz in F, for choosing wallpaper and nudging sofas a tile to the left.
//
// Why 3/4: a waltz lets the pizzicato do "oom-pah-pah" (stride-lite) and the piano a six-eighth Alberti,
// and it gives the tune a courtly gait that the jazz harmony then gently mocks. Light swing (0.55) on the
// eighths keeps it from sounding like a music box until the interlude, where it *is* a music box.
//
// Form, in 8-bar phrases (one per cycle), alternating two kinds of round:
//   even rounds: Intro  A(ant) A(cons)  A A  B1 B2  A' (cons ends on a deceptive bVI)  Tag
//   odd rounds:         A A          C  B1 B2  A'                                 Tag
// The A theme is composed once, by hand: the clarinet asks (a chromatic creep 3->#4->5, then an arpeggio
// that tumbles down and bounces back), the oboe answers with the creep inverted. Both questions end on
// the same Db hanging over the borrowed iv (Bbm6). The theme is recalled with new orchestration on every
// return (piano, swapped winds, glock winks, Alberti vs. pizz oom-pah vs. piano stride, guide-tone
// countermelodies, strings under the consequent). Development: the creep is sequenced in the consequent
// (on IV) and in the tag (on ii and V, in stretto between the winds); inverted in the music-box
// interlude in Db (bVI); augmented into a string line cliche (Dm, Bb/D, Dm6, Dm9: A-Bb-B-C, the theme's
// own pitches) in the D-minor bridge, whose tonic pivots to ii of C; the second half of the bridge
// restates the antecedent a fourth lower in C (the dominant) and swerves, at the cadence, into Gm7-C7
// of home. The tag closes with a plagal iv-I "amen" (Bbm6 -> F6) in parallel thirds.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 3;
  const mod12 = T.mod12;

  // ---------- notation ----------
  // "A4/1 Bb4/.5s | r/3" -> [{beat, dur, note|null, art}], beats from the phrase start. Bars must add to 3.
  // Articulation flags: s staccato, t tenuto, none = detached-legato.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)([st]?)$/.exec(tok);
        if (!m) throw new Error(`build-mode: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), art: m[3] });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`build-mode: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }
  const shift = (notes, bars) => notes.map((n) => ({ ...n, beat: n.beat + bars * BPB }));

  // ---------- the score ----------
  const A_CONS_Q = "A4/1 Bb4/.5s B4/.5s C5/1 | Eb5/.5s D5/.5s C5/.5s A4/.5s C5/1 | D5/1 Eb5/.5s E5/.5s F5/1 | Db5/2t r/1";
  const A_CONS_A = "C5/1 E5/1 G5/1 | A5/1.5t G5/.5 F#5/.5 Eb5/.5 | D5/1 F5/1 E5/1 | F5/2t r/1";
  const SRC = {
    intro: {
      harm: "| F6 | D7/F# | Gm7 | C7 | F6 | D7/F# | Gm7:2 C7:1 | C7sus4:1 C7:2 |",
      cel: "r/3 | r/3 | r/3 | r/3 | A5/1 Bb5/1s B5/1s | C6/3t | r/3 | G6/.5s F6/.5s E6/1 r/1",
    },
    // antecedent: half cadence (C7sus4 -> C7)
    Aa: {
      harm: "| F6 | D7/F# | Gm7 | Bbm6 | Am7 | Abdim7 | Gm7:2 C7:1 | C7sus4:1 C7:2 |",
      q: "A4/1 Bb4/.5s B4/.5s C5/1 | D5/.5s C5/.5s A4/.5s F#4/.5s A4/1 | Bb4/2t D5/1 | Db5/2t r/1",
      a: "E5/1 Eb5/.5s D5/.5s C5/1 | D5/.5s F5/.5s Ab5/1t G5/1 | F5/1 D5/1 E5/1 | G5/.5s F5/.5s E5/1 r/1",
    },
    // consequent: perfect cadence
    Ab: { harm: "| Fmaj7 | F7/A | Bbmaj7 | Bbm6 | Am7 | D7b9 | Gm7:2 C7:1 | F6 |", q: A_CONS_Q, a: A_CONS_A },
    // consequent of the recapitulation: the same tune lands on a deceptive bVI
    Ab_dec: { harm: "| Fmaj7 | F7/A | Bbmaj7 | Bbm6 | Am7 | D7b9 | Gm7:2 C7:1 | Dbmaj7 |", q: A_CONS_Q, a: A_CONS_A },
    // bridge 1: relative minor; the strings hold the line cliche A-Bb-B-C (the motif's pitches, augmented)
    B1: {
      harm: "| Dm | Bb/D | Dm6 | Dm9 | Gm9 | Em7b5 | A7b9b13 | Dm9:2 G13:1 |",
      tune: "A5/2t G5/1 | F5/2t D5/1 | D5/1.5 E5/.5 F5/1 | E5/3t | D5/1 F5/1 A5/1 | G5/2t F5/1 | G5/.5s F5/.5s E5/1 C#5/1 | D5/2t E5/1",
      strings: [[57, 62, 65], [58, 62, 65], [59, 62, 65], [60, 65, 69], [58, 65, 69], [58, 62, 67], [58, 61, 67], [57, 62, 65]],
    },
    // bridge 2: the antecedent sequenced a fourth lower, in C (the dominant); the cadence swerves home
    B2: {
      harm: "| Cmaj7 | A7/C# | Dm7 | Fm6 | Em7 | Ebdim7 | Dm7:2 G7:1 | Gm7:2 C7:1 |",
      q: "E4/1 F4/.5s F#4/.5s G4/1 | A4/.5s G4/.5s E4/.5s C#4/.5s E4/1 | F4/2t A4/1 | Ab4/2t r/1",
      a: "B4/1 Bb4/.5s A4/.5s G4/1 | A4/.5s C5/.5s Eb5/1t D5/1 | C5/1 A4/1 B4/1 | D5/1 Bb4/1 G4/.5s Bb4/.5s",
    },
    // interlude: music box in Db (bVI), the motif inverted on celesta; C7 at the end resolves deceptively to Dm
    C: {
      harm: "| Dbmaj7 | Bbm7 | Ebm9 | Ab13 | Dbmaj7 | Bbm6 | Gm9 | C7sus4:1 C7:2 |",
      cel: "Ab5/1 G5/.5s Gb5/.5s F5/1 | Db5/.5s Eb5/.5s F5/1 Ab5/1 | Bb5/2t Gb5/1 | F5/2t Eb5/1 | Ab5/1 G5/.5s Gb5/.5s F5/1 | Db5/.5s F5/.5s G5/1 Bb5/1 | A5/2t F5/1 | G5/.5s F5/.5s E5/1 r/1",
    },
    // tag: the creep in stretto (clarinet on ii, oboe on V), then a plagal iv-I in parallel thirds
    tag: {
      harm: "| Gm7 | C7 | Am7:2 D7b9:1 | Gm7:2 C7:1 | Bbmaj7 | Bbm6 | F6 | F6 |",
      clar: "D5/1 Eb5/.5s E5/.5s F5/1 | r/3 | G5/.5s F5/.5s E5/1 C5/1 | r/3 | Bb4/2t A4/1 | Bb4/3t | A4/3t | r/3",
      oboe: "r/3 | E5/1 F5/.5s F#5/.5s G5/1 | r/3 | F5/.5s D5/.5s Bb4/1 G4/1 | D5/2t C5/1 | Db5/3t | C5/3t | r/3",
    },
  };
  const PH = {};
  for (const [k, s] of Object.entries(SRC)) {
    const p = { prog: T.progression(s.harm, BPB) };
    if (s.q) { p.q = line(s.q); p.a = shift(line(s.a), 4); }
    for (const f of ["cel", "tune", "clar", "oboe"]) if (s[f]) p[f] = line(s[f]);
    if (s.strings) p.strings = s.strings;
    PH[k] = p;
  }

  const ROUNDS = [
    ["intro", "Aa", "Ab", "Aa", "Ab", "B1", "B2", "Aa", "Ab_dec", "tag"],
    ["Aa", "Ab", "C", "B1", "B2", "Aa", "Ab_dec", "tag"],
  ];
  // Orchestration of each pass through A (antecedent + consequent).
  //   q/a: who asks/answers; acc: oompah (pizz bass + pizz chords), alberti (pizz bass + piano),
  //   stride (pizz bass + piano chords); counter: the asker holds guide tones under the answer;
  //   strings: sustained strings under the consequent; glockHead: glock doubles the motif two octaves up.
  const V = {
    e0: { q: "clar", a: "oboe", acc: "oompah", perc: 1, spr: "celesta" },
    e1: { q: "clar", a: "oboe", acc: "alberti", counter: true, perc: 1, spr: "glock", orn: true },
    rec: { q: "oboe", a: "clar", acc: "stride", glockHead: true, strings: true, perc: 2, spr: "celesta", orn: true },
    o0: { q: "piano", a: "oboe", acc: "oompah", perc: 0, spr: "celesta", orn: true },
    recb: { q: "clar", a: "oboe", acc: "alberti", glockHead: true, strings: true, perc: 2, spr: "glock", orn: true },
    e0b: { q: "oboe", a: "clar", acc: "alberti", perc: 1, spr: "celesta", orn: true },
    e1b: { q: "clar", a: "piano", acc: "stride", strings: true, perc: 2, spr: "glock", orn: true },
    o0b: { q: "clar", a: "oboe", acc: "stride", counter: true, perc: 1, spr: "glock", orn: true },
  };
  const TABLE = [["e0", "e1", "rec"], ["o0", "recb"], ["e0b", "e1b", "rec"], ["o0b", "recb"]];
  const WHO = { clar: "clarinet", oboe: "oboe", piano: "piano" };
  const INTENSITY = [1, 0.94, 1.04, 0.96];

  function locate(cycle) {
    let i = cycle, round = 0;
    while (i >= ROUNDS[round % 2].length) { i -= ROUNDS[round % 2].length; round++; }
    const pat = ROUNDS[round % 2], name = pat[i];
    let pass = -1;
    for (let j = 0; j <= i; j++) if (pat[j] === "Aa") pass++;
    const next = i + 1 < pat.length ? pat[i + 1] : ROUNDS[(round + 1) % 2][0];
    return { round, name, i, pass, next, recap: name === "Ab_dec" || (name === "Aa" && pat[i + 1] === "Ab_dec") };
  }

  /** Upper-structure voicing that leaves a slash chord's bass note to the bass. */
  function upper(sym, opts) {
    const c = T.chord(sym);
    if (c.bass === c.root) return T.voice(c, opts);
    const keep = (p) => p !== c.bass;
    return T.voice({ ...c, guide: c.guide.filter(keep), colors: c.colors.filter(keep) }, { ...opts, rootless: false });
  }
  const isDissonant = (a, b) => [1, 11].includes(mod12(a - b));

  Sim.register({
    id: "build-mode",
    title: "Build Mode",
    genre: "Chamber pop",
    about: "A sly waltz in F: clarinet asks, oboe answers, pizzicato oom-pah, Alberti piano and celesta sprinkles; a D-minor bridge on a string line cliché, a music-box interlude in D♭, and a deceptive ♭VI before the tag.",
    bpm: 126, beatsPerBar: BPB, swing: 0.55, swingUnit: 0.5, cycleBars: 8, gainDb: 2.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.8, preDelay: 0.015, lowcut: 250, highcut: 7500 });
      const hall = I.reverb(ctx, out, { decay: 3.6, preDelay: 0.03, lowcut: 350, highcut: 6000 });
      const clar = I.clarinet(ctx, { volume: 0, vibratoDepth: 0.015 });
      const oboe = I.oboe(ctx, { volume: -1.5, cutoff: 3200 });
      const pianoMel = I.softPiano(ctx, { volume: -2, decay: 3.2, cutoff: 3000 });
      const piano = I.softPiano(ctx, { volume: -5, decay: 2.4, cutoff: 2100 });
      const pizzHi = I.pizz(ctx, { volume: -5, cutoff: 3000, decay: 0.24 });
      const pizzLo = I.pizz(ctx, { volume: -3, cutoff: 1300, decay: 0.55 });
      const strings = I.strings(ctx, { volume: -8, attack: 0.7, release: 1.6, cutoff: 1900 });
      const celesta = I.glock(ctx, { celesta: true, volume: -8, decay: 1.8 });
      const glock = I.glock(ctx, { volume: -15, decay: 2.2 });
      const kit = I.kit(ctx, { volume: 1, preload: ["brushTap", "brushSweep", "woodblock", "softKick", "rim"] });

      const cp = I.place(ctx, clar, -0.28, out), op = I.place(ctx, oboe, 0.3, out);
      const pmp = I.place(ctx, pianoMel, 0.05, out), pp = I.place(ctx, piano, -0.14, out);
      const zp = I.place(ctx, pizzHi, 0.38, out), bp = I.place(ctx, pizzLo, -0.04, out);
      const sp = I.place(ctx, strings, 0, out), celp = I.place(ctx, celesta, 0.45, out), gp = I.place(ctx, glock, -0.42, out);
      const kp = I.place(ctx, kit, 0.08, out);
      I.send(ctx, cp, room, -10); I.send(ctx, cp, hall, -17);
      I.send(ctx, op, room, -10); I.send(ctx, op, hall, -17);
      I.send(ctx, pmp, room, -11); I.send(ctx, pp, room, -13);
      I.send(ctx, zp, room, -12); I.send(ctx, bp, room, -20);
      I.send(ctx, sp, hall, -9);
      I.send(ctx, celp, hall, -10); I.send(ctx, gp, hall, -9);
      I.send(ctx, kp, room, -14);

      const wind = { timing: 0.009, vel: 0.05 };
      return {
        clar: { layer: "melody", play: (t, e, d) => clar.play(t, e.note, d, e.vel), humanize: wind },
        oboe: { layer: "melody", play: (t, e, d) => oboe.play(t, e.note, d, e.vel), humanize: wind },
        pianoMel: { layer: "melody", play: (t, e, d) => pianoMel.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        celMel: { layer: "melody", play: (t, e, d) => celesta.play(t, e.note, d, e.vel), humanize: { timing: 0.005 } },
        alberti: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.06 } },
        stride: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        pah: { layer: "harmony", play: (t, e, d) => pizzHi.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => pizzLo.play(t, e.note, d, e.vel), humanize: { timing: 0.005 } },
        celesta: { layer: "texture", play: (t, e, d) => celesta.play(t, e.note, d, e.vel) },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel) },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep, pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bass == null) Object.assign(state, { bass: 41, pv: null, zv: null, sv: null });
      const L = locate(cycle);
      const { name, round } = L;
      const P = PH[name];
      const prog = P.prog;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const inten = INTENSITY[round % 4];
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const isA = name === "Aa" || name === "Ab" || name === "Ab_dec";
      const v = isA ? V[TABLE[round % 4][L.pass]] : null; // the last entry of each row is the recapitulation

      // ---------- melody ----------
      // vel rises gently with pitch inside a phrase; downbeats lean; staccato is lighter.
      function play(track, notes, o = {}) {
        const pitched = notes.filter((n) => n.note != null);
        if (!pitched.length) return;
        const lo = Math.min(...pitched.map((n) => n.note)), span = Math.max(1, Math.max(...pitched.map((n) => n.note)) - lo);
        const base = o.vel ?? 0.64;
        const octave = track === "pianoMel" && Math.max(...pitched.map((n) => n.note)) < 78;
        notes.forEach((n, i) => {
          if (n.note == null) return;
          const next = notes[i + 1];
          let vel = (base + 0.1 * (n.note - lo) / span + (n.beat % BPB === 0 ? 0.03 : 0) - (n.art === "s" ? 0.05 : 0)) * inten;
          const art = n.art === "s" ? 0.45 : n.art === "t" ? 0.96 : 0.84;
          const segs = [{ beat: n.beat, dur: n.dur, note: n.note, art }];
          if (o.orn) {
            // a passing tone fills a held note on its last eighth
            if (n.dur === 2 && next && next.note != null && Math.abs(next.beat - n.beat - 2) < 1e-6 && Math.abs(next.note - n.note) >= 3 && r.chance(0.3)) {
              const p = T.step(n.note, Math.sign(next.note - n.note), T.chord(sym(n.beat + 1.5)).scale);
              segs[0].dur = 1.5; segs[0].art = 0.9;
              segs.push({ beat: n.beat + 1.5, dur: 0.5, note: p, art: 0.5 });
            }
            // a crushed grace note into a downbeat
            const before = notes[i - 1];
            if (before && before.note != null && Math.abs(before.note - n.note) >= 3 && n.beat % BPB === 0 && n.dur >= 1 && r.chance(0.2)) {
              const g = r.chance(0.6) ? n.note - 1 : T.step(n.note, 1, T.chord(sym(n.beat)).scale);
              push(track, n.beat - 0.14, 0.12, octave ? [g, g + 12] : g, vel * 0.7, { straight: true });
            }
          }
          segs.forEach((s) => push(track, s.beat, s.dur * s.art, octave ? [s.note, s.note + 12] : s.note, vel * (s === segs[0] ? 1 : 0.85)));
        });
      }
      const VEL = { clar: 0.66, oboe: 0.62, pianoMel: 0.52, celMel: 0.66 };
      const T_OF = { clar: "clar", oboe: "oboe", piano: "pianoMel" };

      // guide-tone countermelody (3rds/7ths) under another line, never above it or a semitone from it
      function counter(track, fromBar, toBar, against, prev, lo, hi) {
        let last = prev, held = null;
        prog.filter((e) => e.bar >= fromBar && e.bar < toBar).forEach((e) => {
          const s0 = e.bar * BPB + e.beat, s1 = s0 + e.dur;
          const over = against.filter((m) => m.note != null && m.beat < s1 - 1e-6 && m.beat + m.dur > s0 + 1e-6).map((m) => m.note);
          const cands = T.notesIn(T.chord(e.chord).guide, lo, hi).sort((a, b) => Math.abs(a - last) - Math.abs(b - last));
          const pick = cands.find((c) => over.every((m) => m - c > 2 && !isDissonant(m, c)));
          if (pick == null) { held = null; return; }
          if (held && held.note === pick) held.dur += e.dur; // common tone: tie it over
          else { push(track, s0, e.dur - 0.1, pick, 0.36 * inten); held = ev[ev.length - 1]; }
          last = pick;
        });
      }

      // ---------- glock / celesta sprinkles in the melody's rests ----------
      // The figure arpeggiates the current chord and its last note leans, by step, into the next chord.
      const symAhead = (b) => (b >= 8 * BPB - 1e-6 ? PH[L.next].prog[0].chord : sym(b));
      function sprinkle(track, at, len, count) {
        const c = T.chord(sym(at)), nc = T.chord(symAhead(at + len));
        const [lo, hi] = track === "glock" ? [86, 100] : [81, 96];
        const pool = T.notesIn(c.pcs, lo, hi);
        const n = Math.min(count, Math.floor(len * 2), pool.length);
        if (pool.length < 3 || n < 2) return;
        const up = r.chance(0.5);
        const start = up ? r.int(0, pool.length - n) : r.int(n - 1, pool.length - 1);
        let prev = null;
        for (let k = 0; k < n; k++) {
          let note = pool[up ? start + k : start - k];
          if (k === n - 1 && prev != null && !nc.pcs.includes(mod12(note))) { // resolve into the coming harmony
            const step = T.notesIn(nc.pcs, prev - 3, prev + 3).filter((m) => m !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
            if (step != null) note = step;
          }
          push(track, at + k * 0.5, k === n - 1 ? 1.4 : 0.6, note, (0.34 + 0.03 * k) * inten);
          prev = note;
        }
      }
      const gapsOf = (notes) => notes.filter((n) => n.note == null && n.dur >= 1);

      // ---------- accompaniment ----------
      const bassNotes = prog.map((e) => (state.bass = T.nearest(state.bass, [T.chord(e.chord).bass], 38, 52)));
      function bass(o = {}) {
        prog.forEach((e, k) => {
          const s0 = e.bar * BPB + e.beat;
          if (e.beat > 0 && bassNotes[k] === bassNotes[k - 1]) return; // C7sus4 -> C7: let the pluck ring
          push("bass", s0, Math.min(e.dur, 1.5), bassNotes[k], (e.beat === 0 ? 0.64 : 0.54) * inten);
          const nb = bassNotes[k + 1];
          if (o.walk && e.dur === 3 && nb != null && Math.abs(nb - bassNotes[k]) >= 2 && r.chance(o.walk)) {
            push("bass", s0 + 2.5, 0.4, nb + (nb > bassNotes[k] ? -1 : 1), 0.4 * inten); // chromatic approach
          }
        });
      }
      function pahs(track, range, from = 0, to = 8) {
        for (let bar = from; bar < to; bar++) {
          for (const b of [1, 2]) {
            const at = bar * BPB + b, s = sym(at);
            const key = track === "pah" ? "zv" : "pv";
            const vo = upper(s, { lo: range[0], hi: range[1], n: 3, prev: state[key], top: [range[1] - 6, range[1]] });
            state[key] = vo;
            push(track, at, 0.45, vo, (b === 1 ? 0.36 : 0.3) * inten);
          }
        }
      }
      function alberti(range = [55, 67]) {
        prog.forEach((e) => {
          const s0 = e.bar * BPB + e.beat;
          const vo = upper(e.chord, { lo: range[0], hi: range[1], n: 3, prev: state.pv, top: [range[1] - 5, range[1]] });
          state.pv = vo;
          const [l, m, h] = vo.slice().sort((x, y) => x - y);
          // a one-beat chord gets two eighths: the bottom, then its 3rd (or sus 4th) so the colour is heard
          const g = T.chord(e.chord).guide[0], ch = [m, h].find((x) => mod12(x) === g) ?? h;
          for (let k = 0; k < e.dur * 2; k++) {
            const at = s0 + k * 0.5;
            const note = k === 0 ? l : e.dur === 1 ? ch : k % 2 ? h : m;
            push("alberti", at, 0.7, note, (k === 0 ? 0.3 : at % 1 === 0 ? 0.25 : 0.2) * inten);
          }
        });
      }
      function strings(from, to, vel = 0.3, range = [55, 69]) {
        prog.filter((e) => e.bar >= from && e.bar < to).forEach((e) => {
          const vo = upper(e.chord, { lo: range[0], hi: range[1], n: 3, prev: state.sv, top: [range[1] - 5, range[1]] });
          state.sv = vo;
          push("strings", e.bar * BPB + e.beat, e.dur - 0.08, vo, vel * inten);
        });
      }

      // ---------- light percussion ----------
      function perc(level, o = {}) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (o.fill && bar === 7) {
            [1, 1.5, 2, 2.5].forEach((p, k) => push("drums", B + p, 0.1, "brushTap", 0.18 + 0.06 * k));
            push("drums", B, 0.1, "brushSweep", 0.2, { sweep: 0.5 });
            continue;
          }
          if (o.clock) { // tick-tock
            push("drums", B + 1, 0.1, "woodblock", 0.24, { pitch: 84 });
            push("drums", B + 2, 0.1, "woodblock", 0.19, { pitch: 79 });
          }
          if (level >= 1) push("drums", B, 0.1, "brushSweep", 0.22, { sweep: 0.55 });
          if (level >= 0 && !o.clock) {
            push("drums", B + 1, 0.1, "brushTap", (level ? 0.27 : 0.15) * inten);
            push("drums", B + 2, 0.1, "brushTap", (level ? 0.23 : 0.12) * inten);
          }
          if (level >= 1 && r.chance(0.12)) push("drums", B + 2.5, 0.1, "brushTap", 0.14);
          if (level >= 2) push("drums", B, 0.1, "softKick", 0.22 * inten);
        }
      }

      let label;
      const fillOut = ["B1", "C"].includes(L.next) && name === "Ab"; // mark the turn away from A

      if (name === "intro") {
        // pizz alone, then the celesta peeks at the creep (A-Bb-B-C) and the cadence figure
        bass();
        if (round === 0) pahs("pah", [55, 68]); else alberti();
        if (round === 0) { for (let bar = 4; bar < 8; bar++) { push("drums", bar * BPB + 1, 0.1, "woodblock", 0.22, { pitch: 84 }); push("drums", bar * BPB + 2, 0.1, "woodblock", 0.17, { pitch: 79 }); } }
        else perc(0, { clock: true });
        play("celesta", P.cel, { vel: 0.4 });
        label = "Intro · pizzicato and a ticking clock";
      } else if (isA) {
        const first = name === "Aa";
        const qT = T_OF[v.q], aT = T_OF[v.a];
        play(qT, P.q, { vel: VEL[qT], orn: v.orn && (round > 0 || L.pass > 0) });
        play(aT, P.a, { vel: VEL[aT], orn: v.orn && (round > 0 || L.pass > 0) });
        if (v.counter && qT !== "pianoMel") counter(qT, 4, 8, P.a, P.q[P.q.length - 2].note, 64, 70);
        if (v.glockHead) P.q.filter((n) => n.beat < BPB && n.note != null).forEach((n) => push("glock", n.beat, n.dur * 0.8, n.note + 24, 0.3 * inten));
        gapsOf(P.q.concat(P.a)).forEach((g) => sprinkle(v.spr, g.beat, g.dur, r.chance(0.5) ? 2 : 3));
        bass({ walk: v.perc >= 1 ? 0.22 : 0 });
        if (v.acc === "oompah") pahs("pah", [55, 68]);
        else if (v.acc === "stride") pahs("stride", [55, 68]);
        else alberti(v.counter ? [53, 65] : [55, 67]);
        if (v.strings && !first) strings(0, 8, 0.26, [57, 71]);
        perc(v.perc, { fill: fillOut });
        if (v.perc >= 2) push("glock", 4 * BPB, 2, T.nearest(96, T.chord(sym(4 * BPB)).pcs), 0.2 * inten); // a triangle-like ping as the answer enters
        if (name === "Ab_dec") push("drums", 7 * BPB + 1.5, 0.1, "rim", 0.3); // the wink after the bVI
        const half = first ? "antecedent" : "consequent";
        label = `${name === "Ab_dec" ? "A′ · " : L.recap ? "A′ · " : `A${L.pass ? "²" : ""} · `}${WHO[v.q]} asks, ${WHO[v.a]} answers · ${half}${v.acc === "alberti" ? " · Alberti piano" : v.acc === "stride" ? " · piano stride" : " · pizz oom-pah"}${name === "Ab_dec" ? " · deceptive ♭VI" : ""}`;
      } else if (name === "B1") {
        // relative minor; the strings carry the line cliche, the oboe (or clarinet on odd rounds) the tune
        const who = round % 2 ? "clar" : "oboe";
        play(who, P.tune, { vel: who === "oboe" ? 0.6 : 0.64, orn: round > 0 });
        P.strings.forEach((vo, bar) => push("strings", bar * BPB, 2.92, vo, (0.36 + 0.02 * Math.min(bar, 3)) * inten));
        state.sv = P.strings[7];
        bass();
        for (let bar = 0; bar < 8; bar++) push("drums", bar * BPB, 0.1, "brushSweep", 0.17, { sweep: 1.1 });
        if (round % 2) for (let bar = 4; bar < 8; bar++) push("alberti", bar * BPB + 1, 1.6, upper(sym(bar * BPB + 1), { lo: 50, hi: 64, n: 3, prev: state.pv }), 0.2);
        label = `Bridge · D minor · strings climb A–B♭–B–C under the ${WHO[who]}`;
      } else if (name === "B2") {
        // the antecedent a fourth lower in C; violins pizz above the low clarinet, violas below the oboe
        play("clar", P.q, { vel: 0.68, orn: round > 0 });
        play("oboe", P.a, { vel: 0.62, orn: round > 0 });
        gapsOf(P.q).forEach((g) => sprinkle("celesta", g.beat, g.dur, 2));
        bass({ walk: 0.2 });
        pahs("pah", [69, 81], 0, 4);
        state.zv = null;
        pahs("pah", [53, 65], 4, 8);
        perc(1, { clock: true, fill: true });
        label = "Bridge · sequence in C (the dominant) · and a swerve home";
      } else if (name === "C") {
        // music box in Db: celesta has the inverted motif, piano Alberti, the clock ticks, winds rest
        play("celMel", P.cel, { vel: VEL.celMel });
        gapsOf(P.cel).forEach((g) => sprinkle("glock", g.beat, g.dur, 2));
        bass();
        alberti();
        perc(-1, { clock: true });
        label = "Interlude · music box in D♭ (♭VI)";
      } else {
        // tag
        play("clar", P.clar, { vel: 0.64 });
        play("oboe", P.oboe, { vel: 0.6 });
        bass({ walk: 0.25 });
        pahs("pah", [55, 68], 0, 4);
        strings(4, 7, 0.3);
        for (let bar = 4; bar < 7; bar++) push("stride", bar * BPB + 1, 1.8, upper(sym(bar * BPB + 1), { lo: 53, hi: 67, n: 3, prev: state.pv }), 0.24 * inten);
        push("stride", 7 * BPB, 2.8, [65, 69, 72, 74], 0.22 * inten); // a soft closing F6 under the celesta
        sprinkle("celesta", 7 * BPB + 0.5, 2, 4);
        for (let bar = 0; bar < 4; bar++) { push("drums", bar * BPB, 0.1, "brushSweep", 0.2, { sweep: 0.55 }); push("drums", bar * BPB + 1, 0.1, "brushTap", 0.24); push("drums", bar * BPB + 2, 0.1, "brushTap", 0.2); }
        for (let bar = 4; bar < 7; bar++) push("drums", bar * BPB, 0.1, "brushSweep", 0.16, { sweep: 1.1 });
        push("drums", 7 * BPB + 2, 0.1, "woodblock", 0.2, { pitch: 79 }); // tock.
        label = "Tag · stretto on ii and V · plagal amen";
      }

      // the bass of the last bar of the tag rests after its downbeat: a breath before the next round
      return { events: ev, harmony: prog, section: `Round ${round + 1} · ${label}`, state };
    },
  });
})();
