// Undercover: a 60s spy / surf crossover in E minor at 150 BPM, for sneaking about and then running for it.
//
// The band: a clean guitar drenched in a spring tank (a 29 ms metallic flutter feeding a dark, splashy
// tail) plus a slapback, a palm-muted rhythm guitar, a Farfisa-ish combo organ with vibrato, a brass
// section, a picked electric bass, and a surf kit (rock snare, three toms, ride, crash, tambourine) with
// bongos and a shaker for the sneaking verses.
//
// The riff is harmonic minor, low on the strings, grouped 3+3+2 against the bar: E E B | E E C | B G
// over i, then F# F# A | B B C | D# C over V7b9 (the C and the D# are the harmonic-minor tell).
//
// A round (10 cycles of 8 bars, about 2 min 8 s):
//   Intro    the riff alone over tribal toms, the bass doubling it, a minor-major-ninth brass stab and a hush
//   Sneak A  half-time: bongos, a walking bass full of chromatic runs, a staccato tiptoe line on the organ
//            (on the guitar in alternate rounds) that creeps down by semitones; i - iv(maj7) - VI - V
//   Sneak B  the riff returns in octaves (guitar and bass), rim click on 3, shaker, organ chords underneath
//   Chase A  double time: the guitar tremolo-picks the tune, ride and backbeat, muted chugs, a Neapolitan bar (F)
//   Chase B  floor toms take over the time, tambourine, organ offbeats, brass answers the tune
//   Reveal   brass soli in block voicings over E minor-major 9 and C maj7#11, tom thunder, crashes
//   Break    drums and bass alone, the guitar rejoins, then a snare roll on C7 ...
//   Chase A/B and Reveal again a semitone higher, in F minor, the tune in octaves; the last reveal slides
//            C7b9 -> B7b9 and drops home to E minor for the next round.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;
  const BPB = 4;
  const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  // ---------- notation ----------
  // "E5/2~ D#5/1 r/1 | ..." -> [{beat, dur, note|null, trem, stac, acc}]. Bars add up to 4 beats.
  // Flags after the duration: ~ tremolo-picked, s staccato, > accent.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)([~s>]*)$/.exec(tok);
        if (!m) throw new Error(`spy-surf: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]), trem: m[3].includes("~"), stac: m[3].includes("s"), acc: m[3].includes(">") });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`spy-surf: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }
  function trSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    return NAMES[mod12(T.PC[m[1]] + k)] + m[2] + (m[3] ? "/" + NAMES[mod12(T.PC[m[3]] + k)] : "");
  }

  // ---------- the book (written in E minor) ----------
  const HARM = {
    intro: "| Em | B7b9 | Em | B7b9 | Em | B7b9 | Em | EmMaj9 |",
    sneakA: "| Em | Em | AmMaj7 | Am | Cmaj7#11 | C7 | B7b9 | B7b9 |",
    sneakB: "| Em | B7b9 | Em | B7b9 | Am | E7b9 | Cmaj7#11 | B7b9 |",
    chaseA: "| Em | Em | Cmaj7#11 | B7b9 | Em | Em | F | B7b9 |",
    chaseB: "| Am | Am6 | Em | Em | C7 | B7 | Em | B7b9 |",
    reveal: "| EmMaj9 | EmMaj9 | Cmaj7#11 | Cmaj7#11 | Am9 | F13#11 | B7b9 | B7b9 |",
    brk: "| Em | B7b9 | Em | B7b9 | Em | B7b9 | C7 | C7 |",
  };
  const PROG = Object.fromEntries(Object.entries(HARM).map(([k, v]) => [k, T.progression(v)]));

  // the riff, one bar per chord function (3+3+2)
  const RIFF = {
    i: line("E2/.5> E2/.5 B2/.5 E2/.5> E2/.5 C3/.5 B2/.5> G2/.5"),
    V: line("F#2/.5> F#2/.5 A2/.5 B2/.5> B2/.5 C3/.5 D#3/.5> C3/.5"),
    VI: line("C3/.5> C3/.5 G2/.5 C3/.5> C3/.5 B2/.5 G2/.5> E2/.5"),
  };
  // the chase tune, tremolo-picked on the long notes
  const MEL = {
    chaseA: line("E5/2~ D#5/1~ E5/1~ | G5/1.5~ F#5/.5 E5/1~ B4/1~ | C5/2~ F#5/2~ | D#5/1.5~ C5/.5 B4/2~ | " +
      "E5/2~ D#5/1~ E5/1~ | B5/1.5~ A5/.5 G5/1~ E5/1~ | F5/1.5~ E5/.5 C5/1~ A4/1~ | B4/2~ r/2"),
    chaseB: line("A4/1.5~ C5/.5 E5/2~ | F#5/1.5~ E5/.5 C5/2~ | G5/1~ F#5/1~ E5/1~ B4/1~ | E5/3~ r/1 | " +
      "Bb4/1.5~ C5/.5 E5/1~ G5/1~ | F#5/1.5~ D#5/.5 A5/2~ | G5/1~ E5/1~ B4/1~ G4/1~ | A4/1> C5/1> D#5/1> F#5/1>"),
  };
  // the tiptoe: staccato offbeats creeping down by semitones, then arpeggios
  const TIPTOE = line("r/.5 E5/.5s r/.5 D#5/.5s r/.5 D5/.5s r/.5 C#5/.5s | C5/1.5 B4/.5s r/2 | " +
    "r/.5 A4/.5s r/.5 C5/.5s r/.5 E5/.5s r/.5 G#5/.5s | A5/1.5 E5/.5s r/2 | " +
    "r/.5 G5/.5s r/.5 F#5/.5s r/.5 E5/.5s r/.5 B4/.5s | Bb4/1.5 G4/.5s r/2 | " +
    "r/.5 F#4/.5s r/.5 A4/.5s r/.5 C5/.5s r/.5 D#5/.5s | F#5/1 r/3");
  // brass: [beat, dur, top note] per bar; voiced in close block position under the top
  const REVEAL = [
    [[0, 0.45, "F#5"], [1.5, 2.2, "D#5"]],
    [[2.5, 0.4, "E5"], [3, 0.9, "F#5"]],
    [[0, 0.45, "F#5"], [1.5, 2.2, "E5"]],
    [[2.5, 0.4, "B4"], [3, 0.9, "E5"]],
    [[0, 0.45, "C5"], [1.5, 2.2, "B4"]],
    [[0, 0.45, "Eb5"], [1.5, 2.2, "D5"]],
    [[0, 0.4, "C5"], [1, 0.4, "C5"], [2, 0.4, "D#5"], [3, 0.4, "D#5"]],
    [[0, 1.8, "F#5"]],
  ];
  const REVEAL_ALT = [
    [[0, 0.3, "B4"], [0.5, 0.3, "D#5"], [1, 2, "F#5"]],
    [[3, 0.4, "G5"], [3.5, 0.45, "F#5"]],
    [[0, 0.3, "G4"], [0.5, 0.3, "B4"], [1, 2, "E5"]],
    [[3, 0.4, "F#5"], [3.5, 0.45, "E5"]],
    [[0, 0.3, "A4"], [0.5, 0.3, "C5"], [1, 2, "E5"]],
    [[0, 0.3, "A4"], [0.5, 0.3, "C5"], [1, 2, "Eb5"]],
    [[0, 0.4, "D#5"], [1, 0.4, "C5"], [2, 0.4, "A4"], [3, 0.4, "C5"]],
    [[0, 1.8, "D#5"]],
  ];
  const STABS = { // brass answering the tune in the chase
    chaseA: { 3: [[2.5, 0.3, "A4"], [3.5, 0.3, "A4"]], 7: [[2.5, 0.35, "D#5"], [3, 0.8, "F#5"]] },
    chaseB: { 3: [[3, 0.35, "G5"], [3.5, 0.5, "E5"]], 5: [[3, 0.3, "F#4"]] },
  };

  const ROUND = [
    { s: "intro", k: 0 }, { s: "sneakA", k: 0 }, { s: "sneakB", k: 0 },
    { s: "chaseA", k: 0 }, { s: "chaseB", k: 0 }, { s: "reveal", k: 0 },
    { s: "brk", k: 0 },
    { s: "chaseA", k: 1, pass: 2 }, { s: "chaseB", k: 1, pass: 2 }, { s: "reveal", k: 1, pass: 2, home: true },
  ];
  const TOM = { hi: 52, mid: 47, lo: 41 };

  /** Close block voicing for the brass with `top` as the lead: chord tones stacked down, no seconds. */
  function blockUnder(top, sym, n = 4, floor = 55) {
    const c = T.chord(sym), v = [top];
    const used = new Set([mod12(top)]);
    let cur = top;
    for (let m = top - 1; m >= floor && v.length < n; m--) {
      if (!c.pcs.includes(mod12(m)) || used.has(mod12(m)) || cur - m < 3) continue;
      v.push(m); used.add(mod12(m)); cur = m;
    }
    return v.sort((a, b) => a - b);
  }
  const near = (pc, from, lo, hi) => {
    let best = null, bs = Infinity;
    for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from); if (s < bs) { bs = s; best = m; } }
    return best;
  };
  /** The plain triad under a chord symbol (the organ holds these under the brass soli). */
  const triadOf = (sym) => {
    const c = T.chord(sym);
    const q = ["minor", "minor7", "minor6", "minorMajor"].includes(c.kind) ? "m" : ["halfDim", "dim", "dim7"].includes(c.kind) ? "dim" : "";
    return NAMES[c.root] + q;
  };
  const fifthOf = (c) => c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;

  /**
   * Walking bass with chromatic runs: each chord's root on its downbeat, chord tones in between, and
   * when it fits, a run of 2-4 steps (whole steps first, then semitones) into the next chord's root.
   */
  function walk(prog, total, nextPc, last, r, lo, hi) {
    const out = [];
    const starts = prog.map((e) => e.bar * BPB + e.beat);
    prog.forEach((e, i) => {
      const s = starts[i], end = i + 1 < prog.length ? starts[i + 1] : total;
      const c = T.chord(e.chord);
      const nPc = i + 1 < prog.length ? T.chord(prog[i + 1].chord).bass : nextPc;
      const root = near(c.bass, last, lo, hi);
      out.push({ beat: s, note: root }); last = root;
      const L = end - s;
      if (L <= 1) return;
      let run = null;
      for (const m of r.shuffle([2, 3, 4, 4])) {
        if (m > L) continue;
        const xs = m === L ? [root] : r.shuffle(T.notesIn(c.pcs.slice(0, 3), lo, hi).filter((x) => x !== last && Math.abs(x - last) <= 7));
        for (const x of xs) {
          // the run ends on a semitone when it can (d < 2m), else in whole steps
          const fits = (strict) => T.notesIn([nPc], lo, hi).filter((t) => { const d = Math.abs(t - x); return d >= m && (strict ? d < 2 * m : d <= 2 * m); });
          const ts = fits(true).length ? fits(true) : fits(false);
          if (ts.length) { run = { m, x, t: r.pick(ts) }; break; }
        }
        if (run) break;
      }
      const runStart = run ? end - run.m : end - 1;
      for (let b = s + 1; b < runStart; b++) {
        const pool = T.notesIn(c.pcs.slice(0, 4), lo, hi).filter((m) => m !== last && Math.abs(m - last) <= 7 && !(run && b === runStart - 1 && m === run.x));
        const n = pool.length ? r.pick(pool) : last + (r.chance(0.5) ? 1 : -1);
        out.push({ beat: b, note: n }); last = n;
      }
      if (run) {
        const dir = Math.sign(run.t - run.x), w = Math.abs(run.t - run.x) - run.m;
        let n = run.x;
        for (let j = 0; j < run.m; j++) {
          if (runStart + j !== s) { out.push({ beat: runStart + j, note: n }); }
          last = n;
          n += dir * (j < w ? 2 : 1);
        }
      } else if (runStart > s) {
        const t = near(nPc, last, lo, hi);
        const a = r.chance(0.5) ? t + 1 : t - 1;
        out.push({ beat: runStart, note: Math.max(lo, Math.min(hi, a)) }); last = a;
      }
    });
    return { notes: out, last };
  }

  Sim.register({
    id: "spy-surf",
    title: "Undercover",
    genre: "Spy surf",
    about: "A 60s spy/surf caper in E minor: a harmonic-minor riff on a spring-drenched guitar, tremolo-picked chase tunes, minor-major-ninth brass, bongos for the sneaking and tom-tom thunder for the getaway, with a second chase a semitone up in F minor.",
    situations: ["mystery", "chase"],
    energy: 0.7,
    bpm: 150, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.01, lowcut: 250, highcut: 7000 });
      // spring tank: a short metallic flutter feeding a dark, splashy tail
      const tail = I.reverb(ctx, out, { decay: 2.6, preDelay: 0.022, lowcut: 450, highcut: 4500 });
      const spring = ctx.keep(new Tone.Gain(1));
      const drip = ctx.keep(new Tone.FeedbackDelay({ delayTime: 0.029, feedback: 0.55, wet: 1 }));
      const dripBp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "bandpass", Q: 0.7 }));
      const dripLvl = ctx.keep(new Tone.Gain(0.5));
      spring.connect(drip); drip.connect(dripBp); dripBp.connect(dripLvl); dripLvl.connect(tail);
      spring.connect(tail);
      const slap = I.delay(ctx, out, { time: 0.112, feedback: 0.14, highcut: 3400 });

      const gtr = I.guitar(ctx, { kind: "clean", volume: -1, dampening: 4800, resonance: 0.965 });
      const twang = ctx.keep(new Tone.EQ3({ low: -2, mid: -1, high: 4, lowFrequency: 220, highFrequency: 2300 }));
      const gp = ctx.keep(new Tone.Panner(-0.12));
      gtr.out.connect(twang); twang.connect(gp); gp.connect(out);
      I.send(ctx, gp, spring, -5); I.send(ctx, gp, slap, -10);

      const rhy = I.guitar(ctx, { kind: "muted", volume: -12 });
      const rp = I.place(ctx, rhy, 0.4, out); I.send(ctx, rp, room, -14);

      const organ = I.organ(ctx, { volume: -10, partials: [1, 0.15, 0.6, 0.08, 0.42, 0.04, 0.28, 0.02, 0.16] });
      const vib = ctx.keep(new Tone.Vibrato({ frequency: 6.3, depth: 0.07 }));
      const orgLp = ctx.keep(new Tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -12 }));
      const op = ctx.keep(new Tone.Panner(-0.38));
      organ.out.connect(vib); vib.connect(orgLp); orgLp.connect(op); op.connect(out);
      I.send(ctx, op, room, -11); I.send(ctx, op, spring, -18);

      const brass = I.brassStab(ctx, { volume: -5 });
      const bp = I.place(ctx, brass, 0.28, out); I.send(ctx, bp, room, -9); I.send(ctx, bp, tail, -17);

      const bass = I.ebass(ctx, { volume: -3, base: 170 });
      const bsp = I.place(ctx, bass, 0, out); I.send(ctx, bsp, room, -24);

      const kit = I.kit(ctx, { volume: -1, kickNote: 32, preload: ["kick", "rockSnare", "tom", "ride", "crash", "bongo", "hatPedal"] });
      const kp = I.place(ctx, kit, 0.04, out); I.send(ctx, kp, room, -13); I.send(ctx, kp, tail, -21);

      return {
        guitar: { layer: "melody", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.06 } },
        organ: { layer: "melody", play: (t, e, d) => organ.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.03 } },
        brass: { layer: "melody", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        stabs: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        comp: { layer: "harmony", play: (t, e, d) => organ.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.03 } },
        rhythm: { layer: "harmony", play: (t, e, d) => rhy.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.08 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bassLast == null) Object.assign(state, { bassLast: 33, comp: null });
      const round = Math.floor(cycle / ROUND.length), S = ROUND[cycle % ROUND.length];
      const N = ROUND[(cycle + 1) % ROUND.length];
      const pass = S.pass || 1;
      const kb = (bar) => (S.home && bar === 7 ? 0 : S.k); // the last reveal's final bar slides home to B7b9
      const prog = PROG[S.s].map((e) => ({ ...e, chord: trSym(e.chord, kb(e.bar)) }));
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, vel, extra);
      const tom = (abs, w, vel) => D(abs, "tom", vel, { pitch: TOM[w] });

      // ---------------------------------------------------------------- pitched parts
      const trem = (track, abs, dur, note, vel, cresc = 0) => {
        const n = Math.max(1, Math.round(dur / 0.25));
        for (let i = 0; i < n; i++) {
          const v = vel * (i % 2 ? 0.8 : 1) * (1 + cresc * (i / n));
          push(track, abs + i * 0.25, i === n - 1 ? 0.45 : 0.3, note, v);
        }
      };
      const riff = (bar, kind, shift, withGuitar, withBass, vel = 0.66) => {
        RIFF[kind].forEach((n) => {
          const at = bar * BPB + n.beat, v = vel + (n.acc ? 0.12 : 0);
          if (withGuitar) push("guitar", at, 0.42, n.note + shift, v);
          if (withBass) push("bass", at, 0.4, n.note + shift - 12, v + 0.1);
        });
      };
      const brassLine = (track, bars, k, vel) => {
        Object.entries(bars).forEach(([bar, hits]) => {
          bar = +bar;
          hits.forEach(([b, d, top]) => {
            const kk = track === "brass" ? kb(bar) : k;
            const s = sym(bar * BPB + b);
            push(track, bar * BPB + b, d, blockUnder(T.midi(top) + kk, s, 4), vel + (d < 0.5 ? 0.06 : 0));
          });
        });
      };
      const heldChords = (lo, hi, n, vel, from = 0, to = 8, triads = false) => {
        prog.filter((e) => e.bar >= from && e.bar < to).forEach((e, i, a) => {
          const end = i + 1 < a.length ? a[i + 1].bar * BPB + a[i + 1].beat : to * BPB;
          const v = T.voice(triads ? triadOf(e.chord) : e.chord, { lo, hi, n, prev: state.comp, rng: r, rootless: !triads });
          state.comp = v;
          push("comp", e.bar * BPB + e.beat, end - e.bar * BPB - e.beat - 0.15, v, vel);
        });
      };

      const s = S.s;
      if (s === "intro") {
        for (let bar = 0; bar < 7; bar++) riff(bar, bar % 2 ? "V" : "i", 0, true, bar >= 2, bar < 2 ? 0.6 : 0.66);
        push("brass", 28, 3.2, blockUnder(T.midi("F#5"), "EmMaj9", 4), 0.62);
        trem("guitar", 28, 4, 40, 0.62, -0.5);
        push("bass", 28, 3.6, 28, 0.85);
      } else if (s === "sneakA") {
        const lead = round % 2 === 1 ? "guitar" : "organ";
        TIPTOE.forEach((n) => {
          const note = lead === "guitar" ? n.note - 12 : n.note;
          if (lead === "guitar" && n.beat >= 28) return; // the guitar saves itself for the tremolo
          push(lead, n.beat, n.stac ? 0.3 : n.dur * 0.9, note, n.stac ? 0.5 : 0.56);
        });
        trem("guitar", 28, 4, 47, 0.42, 0.8); // B2, swelling into the riff
        const w = walk(prog, 32, 4, 33, r, 28, 47);
        w.notes.forEach((n) => push("bass", n.beat, 0.88, n.note, n.beat % 2 === 0 ? 0.74 : 0.64));
        state.bassLast = w.last;
      } else if (s === "sneakB") {
        const plan = [["i", 0], ["V", 0], ["i", 0], ["V", 0], ["i", 5], ["V", 5], ["VI", 0], ["V", 0]];
        plan.forEach(([kind, sh], bar) => riff(bar, kind, sh, true, true, 0.6));
        heldChords(52, 67, 3, 0.28);
      } else if (s === "chaseA" || s === "chaseB") {
        const k = S.k;
        MEL[s].forEach((n) => {
          const note = n.note + k;
          const notes = pass === 2 ? [note - 12, note] : note;
          if (n.trem) {
            // a slide up into the long notes on strong beats, from the second round on
            if (round >= 1 && n.dur >= 2 && n.beat % 4 === 0 && r.chance(0.5)) push("guitar", n.beat - 0.25, 0.25, pass === 2 ? [note - 13, note - 1] : note - 1, 0.5);
            trem("guitar", n.beat, n.dur, notes, 0.66, n.dur >= 2 ? 0.25 : 0);
          } else push("guitar", n.beat, n.dur * 0.9, notes, n.acc ? 0.76 : 0.66);
        });
        brassLine("stabs", STABS[s], k, 0.6);
        // muted chugs: root and fifth in eighths
        for (let bar = 0; bar < 8; bar++) {
          const c = T.chord(sym(bar * BPB)), R = near(c.bass, 44, 40, 51);
          for (let i = 0; i < 8; i++) {
            if (s === "chaseA" && bar === 7 && i >= 4) break; // leave the brass alone
            push("rhythm", bar * BPB + i * 0.5, 0.3, [R, R + fifthOf(c)], i % 2 ? 0.42 : 0.56 + (i === 0 ? 0.08 : 0));
          }
        }
        // organ offbeats
        if (s === "chaseB" || pass === 2) {
          for (let bar = 0; bar < 8; bar++) {
            const v = T.voice(sym(bar * BPB), { lo: 55, hi: 67, n: 3, prev: state.comp, rng: r });
            state.comp = v;
            for (let b = 0; b < 4; b++) if (!(bar === 7 && b >= 2)) push("comp", bar * BPB + b + 0.5, 0.28, v, 0.36 + (b === 3 ? 0.04 : 0));
          }
        }
        // bass: driving eighths, an approach note into each new root
        for (let bar = 0; bar < 8; bar++) {
          const c = T.chord(sym(bar * BPB)), R = near(c.bass, 34, 28, 40);
          const nxt = bar < 7 ? T.chord(sym(bar * BPB + 4)) : T.chord(trSym(PROG[N.s][0].chord, N.k));
          const nr = near(nxt.bass, 34, 28, 40);
          const app = nxt.bass === c.bass ? R + fifthOf(c) : nr + (nr > R ? -1 : 1);
          const pat = [[0, R, 0.86], [0.5, R, 0.6], [1, R + 12, 0.7], [1.5, R, 0.6], [2, R, 0.8], [2.5, R + fifthOf(c), 0.62], [3, R + 12, 0.7], [3.5, app, 0.66]];
          pat.forEach(([b, n, v]) => push("bass", bar * BPB + b, 0.42, n, v));
          state.bassLast = R;
        }
      } else if (s === "reveal") {
        brassLine("brass", Object.fromEntries((round % 2 ? REVEAL_ALT : REVEAL).map((h, i) => [i, h])), S.k, 0.66);
        // guitar: tremolo on the low root, swelling across each two-bar span
        for (let bar = 0; bar < 8; bar++) {
          const c = T.chord(sym(bar * BPB)), R = near(c.root, 44, 40, 51);
          trem("guitar", bar * BPB, bar === 7 ? 2 : 4, R, 0.46 + (bar % 2) * 0.1, 0.3);
        }
        heldChords(52, 67, 3, 0.34, 0, 8, true);
        for (let bar = 0; bar < 8; bar++) {
          const c = T.chord(sym(bar * BPB)), R = near(c.bass, 34, 28, 40);
          if (bar === 7) { push("bass", bar * BPB, 1.8, R, 0.86); push("bass", bar * BPB + 2, 0.4, R + 12, 0.7); push("bass", bar * BPB + 3, 0.4, R + 10, 0.7); push("bass", bar * BPB + 3.5, 0.4, R + 5, 0.72); }
          else [[0, R, 0.86, 0.9], [1, R + 12, 0.62, 0.45], [1.5, R, 0.66, 0.9], [2.5, R + 12, 0.62, 0.45], [3, R + fifthOf(c), 0.66, 0.9]].forEach(([b, n, v, d]) => push("bass", bar * BPB + b, d, n, v));
          state.bassLast = R;
        }
      } else if (s === "brk") {
        for (let bar = 0; bar < 6; bar++) riff(bar, bar % 2 ? "V" : "i", 0, bar >= 4, true, 0.64);
        trem("guitar", 24, 8, 48, 0.4, 0.9); // C3, swelling over the dominant
        push("comp", 24, 7.8, T.voice("C7", { lo: 52, hi: 67, n: 3, prev: state.comp }), 0.3);
        [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((b) => push("bass", 24 + b, 0.4, b % 1 ? 48 : 36, 0.66 + b * 0.02));
        [[0, 36], [1, 34], [2, 31], [3, 28]].forEach(([b, n]) => push("bass", 28 + b, 0.9, n, 0.78)); // C Bb G E -> F
        state.bassLast = 29;
      }

      // ---------------------------------------------------------------- drums
      const crash = (abs, v = 0.62) => { D(abs, "crash", v); D(abs, "kick", 0.9); };
      const FILLS = [
        [[2, "sn", 0.5], [2.25, "sn", 0.42], [2.5, "sn", 0.56], [2.75, "sn", 0.48], [3, "hi", 0.66], [3.25, "hi", 0.6], [3.5, "mid", 0.7], [3.75, "lo", 0.78]],
        [[3, "sn", 0.62], [3.25, "sn", 0.55], [3.5, "mid", 0.7], [3.75, "lo", 0.8]],
        [[2, "lo", 0.7], [2.5, "lo", 0.5], [2.75, "lo", 0.6], [3, "mid", 0.7], [3.25, "mid", 0.6], [3.5, "hi", 0.72], [3.75, "hi", 0.66]],
      ];
      const fill = (bar, pat) => {
        pat.forEach(([b, w, v]) => (w === "sn" ? D(bar * BPB + b, "rockSnare", v) : tom(bar * BPB + b, w, v)));
        return pat[0][0];
      };
      const tribal = (B, v = 1) => { // floor and mid toms, a jungle-ish sixteenth pattern
        [[0, "lo", 0.8], [0.5, "lo", 0.42], [0.75, "lo", 0.55], [1, "mid", 0.62], [1.5, "lo", 0.7], [2, "lo", 0.78], [2.5, "lo", 0.42],
          [2.75, "lo", 0.55], [3, "mid", 0.66], [3.25, "mid", 0.45], [3.5, "hi", 0.6], [3.75, "hi", 0.5]].forEach(([b, w, vv]) => tom(B + b, w, vv * v));
      };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        const last = bar === 7;
        if (s === "intro") {
          if (bar < 7) {
            tribal(B, bar < 2 ? 0.75 : 0.9);
            D(B, "kick", 0.8); D(B + 2, "kick", 0.66);
            if (bar >= 4) D(B + 3, "rockSnare", 0.36);
            if (bar === 6) fill(bar, FILLS[1]);
          } else crash(B, 0.66);
        } else if (s === "sneakA" || s === "sneakB") {
          // bongos (martillo-ish), pedal hat on 2 and 4, a feathered kick
          [[0, 67, 0.55], [0.5, 74, 0.32], [1, 74, 0.46], [1.5, 74, 0.3], [2, 67, 0.52], [2.5, 74, 0.32], [3, 74, 0.46], [3.5, 67, 0.4]]
            .forEach(([b, p, v]) => D(B + b, "bongo", v, { pitch: p }));
          if (r.chance(0.3)) D(B + r.pick([1.75, 3.25, 3.75]), "bongo", 0.24, { pitch: 74 });
          D(B + 1, "hatPedal", 0.4); D(B + 3, "hatPedal", 0.42);
          D(B, "kick", s === "sneakB" ? 0.55 : 0.4);
          if (s === "sneakB") {
            D(B + 2.5, "kick", 0.42);
            D(B + 2, "rim", 0.55);
            for (let i = 0; i < 8; i++) D(B + i * 0.5, "shaker", i % 2 ? 0.3 : 0.4);
            if (last) fill(bar, FILLS[r.int(0, 2)]);
          } else if (bar === 3 || bar === 7) D(B + 3.5, "rim", 0.4);
        } else if (s === "chaseA") {
          if (bar === 0) crash(B, pass === 2 ? 0.7 : 0.6);
          else if (bar === 4) D(B, "crash", 0.42); // the tune's second phrase
          const fs = last ? fill(bar, FILLS[r.int(0, 2)]) : 4;
          if (!(bar === 0)) D(B, "kick", 0.86);
          D(B + 2, "kick", 0.78);
          if (r.chance(0.45)) D(B + r.pick([1.5, 2.5, 3.5]), "kick", 0.55);
          if (fs > 1) D(B + 1, "rockSnare", 0.74);
          if (fs > 3) D(B + 3, "rockSnare", 0.8);
          for (let i = 0; i < 8; i++) if (i * 0.5 < fs && !(bar === 0 && i === 0)) D(B + i * 0.5, pass === 2 ? "hatClosed" : "ride", i % 2 ? 0.36 : 0.52);
          if (pass === 2 && fs > 3.5) D(B + 3.5, "hatOpen", 0.38);
          D(B + 1, "hatPedal", 0.35); D(B + 3, "hatPedal", 0.35);
          if (r.chance(0.25) && fs > 3.25) D(B + 3.25, "rockSnare", 0.2);
        } else if (s === "chaseB") {
          if (bar === 0) D(B, "crash", 0.6);
          const fs = last ? fill(bar, FILLS[r.int(0, 2)]) : 4;
          [0.78, 0.4, 0.56, 0.4, 0.72, 0.42, 0.56, 0.46].forEach((v, i) => { if (i * 0.5 < fs) tom(B + i * 0.5, "lo", v); });
          D(B, "kick", 0.88); D(B + 2, "kick", 0.78);
          if (fs > 1) D(B + 1, "rockSnare", 0.76);
          if (fs > 3) D(B + 3, "rockSnare", 0.82);
          for (let i = 0; i < 8; i++) if (i * 0.5 < fs) D(B + i * 0.5, "tambourine", i % 2 ? 0.46 : 0.3);
        } else if (s === "reveal") {
          if (bar % 2 === 0) crash(B, 0.64);
          else D(B, "kick", 0.84);
          const fs = last ? fill(bar, FILLS[0]) : 4;
          if (fs === 4) tribal(B, 0.7);
          if (fs > 2) D(B + 2, "rockSnare", 0.8);
          D(B + 1.5, "kick", 0.66); D(B + 3, "kick", 0.62);
        } else if (s === "brk") {
          if (bar < 6) {
            tribal(B, 0.85);
            D(B, "kick", 0.84); D(B + 1.5, "kick", 0.6); D(B + 2, "kick", 0.74);
            if (bar >= 4) { D(B + 1, "rockSnare", 0.5); D(B + 3, "rockSnare", 0.56); }
          } else {
            // snare roll swelling over the dominant, sixteenths then a final flurry of toms
            for (let i = 0; i < 16; i++) {
              const t = B + i * 0.25, u = ((bar - 6) * 16 + i) / 32;
              if (bar === 7 && i >= 12) tom(t, ["hi", "mid", "lo", "lo"][i - 12], 0.8);
              else D(t, "rockSnare", 0.22 + 0.5 * u);
            }
            D(B, "kick", 0.7);
          }
        }
      }

      // ---------------------------------------------------------------- clean-up
      // the chord parts (organ comp, muted chugs) drop any tone a semitone (or minor ninth) from a sounding
      // line note (the tune, the bass's approach notes, the brass), unless both are tones of the chord
      const absOf = (e) => e.bar * BPB + e.beat;
      const lines = ev.filter((e) => e.track !== "drums" && e.track !== "comp" && e.track !== "rhythm");
      for (let i = ev.length - 1; i >= 0; i--) {
        const e = ev[i];
        if (e.track !== "comp" && e.track !== "rhythm") continue;
        const a = absOf(e), b = a + e.dur, c = T.chord(sym(Math.max(0, a)));
        const ct = (m) => c.pcs.includes(mod12(m)) || c.bass === mod12(m);
        const others = lines.filter((o) => Math.min(b, absOf(o) + o.dur) - Math.max(a, absOf(o)) >= 0.2).flatMap((o) => [].concat(o.note));
        const bad = (m) => others.some((x) => { const d = Math.abs(x - m); return d % 12 === 1 && d < 26 && !(ct(x) && ct(m)); });
        const keep = [].concat(e.note).filter((m) => !bad(m));
        if (keep.length === [].concat(e.note).length) continue;
        if (e.track === "rhythm" || keep.length < 2) ev.splice(i, 1);
        else e.note = keep;
      }

      // ---------------------------------------------------------------- label
      const key = S.k ? "F minor" : "E minor";
      const L = {
        intro: "Intro · the riff over tribal toms",
        sneakA: `The sneak · bongos, a walking bass and a tiptoe on the ${round % 2 ? "guitar" : "organ"}`,
        sneakB: "The sneak · the riff in octaves, rim click on 3",
        chaseA: `The chase · tremolo tune${pass === 2 ? " in octaves" : ""}, ride and backbeat`,
        chaseB: "The chase · floor toms, tambourine, brass answers",
        reveal: S.home ? "The reveal · brass soli, sliding home to E" : "The reveal · brass soli in minor-major ninths",
        brk: "Break · drums and bass, a snare roll on C7",
      }[s];
      return { events: ev, harmony: prog, section: `Round ${round + 1} · ${L} · ${key}`, state };
    },
  });
})();
