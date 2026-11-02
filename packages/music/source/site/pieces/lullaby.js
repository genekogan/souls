// Night Light: a music-box lullaby for a sim who has finally gone to sleep.
//
// Rocking 3/4 at 56 BPM. One 16-bar tune in G, written by hand: an antecedent of two rising
// arpeggio cells (the second a step higher, onto the sus dominant) answered by falling sighs that
// half-close on D7, and a consequent whose fourth bar darkens to the borrowed iv (Cm6, the tune's
// only Eb) before sliding chromatically down to Bm7 and cadencing through E7 and Am9.
//
// The tune comes back in variations, one per 8-bar cycle: on the music box (celesta), an octave lower
// on felt piano with the music box answering its long notes, harmonised in diatonic thirds, doubled by
// the two together, and as a little minor dream (the antecedent in G minor over Ebmaj7, Cm9, Am7b5 and
// D7b9, which returns to major through the shared Cm6). Every 16 cycles (about 7 minutes) there is a
// goodnight coda; at cycles 7 and 15 (every 3.5 minutes) the music box winds down: the tempo eases from
// 56 to 50, the heartbeat stops, the pad thins to nothing and a few stars are left before it is wound up
// again. Alternate rounds sit a whole step lower, in F, so the second time through is sleepier.
//
// Percussion: a heartbeat on a filtered soft kick (lub-dub, once a bar, twice in the fuller variations,
// on the dotted-quarter cradle pulse), brush sweeps at phrase ends and a rare brush tap. Nothing loud,
// nothing above C6 in the music box.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;
  const BPB = 3;
  const BPM = 56;

  // "D5/1 G5/1 | r/3" -> [{beat, dur, note}] (rests dropped); every bar must add up to 3 beats.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`lullaby: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`lullaby: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }

  // ---------- the tune (in G) ----------
  const MEL = {
    intro: line("r/3 | r/3 | r/3 | r/3 | B5/2 G5/1 | E5/1 A5/1 B5/1 | C6/2 A5/1 | A5/3"),
    ant: line("D5/1 G5/1 A5/1 | B5/2 G5/1 | E5/1 A5/1 B5/1 | C6/2 A5/1 | B5/1.5 A5/.5 G5/1 | F#5/1.5 E5/.5 D5/1 | E5/1.5 F#5/.5 G5/1 | A5/2 F#5/1"),
    cons: line("D5/1 G5/1 A5/1 | B5/2 G5/1 | E5/1 A5/1 B5/1 | C6/1.5 G5/.5 Eb5/1 | D5/1 F#5/1 A5/1 | B5/2 G#5/1 | C6/1 B5/1 A5/1 | G5/3"),
    minor: line("D5/1 G5/1 A5/1 | Bb5/2 G5/1 | Eb5/1 G5/1 Bb5/1 | C6/2 A5/1 | Bb5/1.5 A5/.5 G5/1 | F5/1.5 Eb5/.5 D5/1 | Eb5/1.5 F5/.5 G5/1 | A5/2 F#5/1"),
    coda: line("D5/1 F#5/1 A5/1 | B5/2 G#5/1 | C6/1 B5/1 A5/1 | G5/3 | C5/1 Eb5/1 G5/1 | F#5/2 D5/1 | Eb5/3 | D5/3"),
  };
  MEL.consR = MEL.cons;

  const H = {
    intro: "| Gmaj9 | Cmaj9/G | Gmaj9 | Cmaj9/G | Em9 | Cmaj13 | Am9 | D9sus4 |",
    ant: "| Gmaj9 | Em9 | Cmaj13 | D9sus4 | Gmaj7 | Bm7 | Cmaj7#11 | Am7:2 D7:1 |",
    cons: "| Gmaj9 | Em9 | Cmaj13 | Cm6 | Bm7 | E7 | Am9:2 D7:1 | G6 |",
    consR: "| Gmaj9 | Em9 | Am9 | Cm6 | Bm7 | E7b9 | Am9:2 D7:1 | G6 |", // reharmonised return
    minor: "| Gm9 | Ebmaj7 | Cm9 | D9sus4:2 D7b9:1 | Gm9 | Ebmaj9 | Am7b5 | D7b9 |",
    coda: "| Bm7 | E7 | Am9:2 D7:1 | Gmaj9 | Cm6/G | Gmaj9 | Cm6/G | Gmaj9 |",
    thin: "| Gmaj9 | Cmaj9/G | Gmaj9 | Cmaj9/G | Gmaj9 | Cm6/G | Gmaj9 | Gmaj9 |",
  };

  // ---------- the arc: 16 cycles of 8 bars (~6.9 minutes at 56 BPM) ----------
  // mel: glock (music box) | low (felt piano, an octave down) | thirds (music box in thirds) | both
  // acc: rock (bass + leaning chords) | arp (rocking broken chords) | low (bass on the cradle pulse)
  //      | late (pad alone, then rock) | sparse (a bass note now and then)
  // heart: 1 = once a bar, 2 = on the dotted-quarter pulse, late = from bar 5, fade = dies away
  const PLAN = [
    { sec: "intro", mel: "glock", acc: "rock", heart: "late", e: 0.7, d: "the night light on" },
    { sec: "ant", mel: "glock", acc: "rock", heart: 1, e: 0.85, d: "music box" },
    { sec: "cons", mel: "glock", acc: "rock", heart: 1, brush: 1, e: 0.9, d: "music box" },
    { sec: "ant", mel: "low", acc: "low", heart: 2, e: 0.85, d: "an octave lower, felt piano" },
    { sec: "cons", mel: "low", acc: "low", heart: 2, brush: 1, e: 0.88, d: "felt piano" },
    { sec: "minor", mel: "glock", acc: "arp", heart: 2, e: 0.85, d: "a little minor dream" },
    { sec: "cons", mel: "thirds", acc: "arp", heart: 2, brush: 1, e: 0.92, d: "in thirds" },
    { sec: "thin", acc: "sparse", heart: "fade", e: 0.6, slow: 1, d: "the music box winds down" },
    { sec: "ant", mel: "glock", acc: "late", heart: "late", e: 0.72, d: "wound up again" },
    { sec: "consR", mel: "thirds", acc: "rock", heart: 1, brush: 1, e: 0.85, d: "in thirds" },
    { sec: "minor", mel: "low", acc: "low", heart: 2, e: 0.8, d: "the minor dream, felt piano" },
    { sec: "cons", mel: "both", acc: "low", heart: 2, brush: 1, e: 0.9, d: "music box and piano together" },
    { sec: "ant", mel: "thirds", acc: "arp", heart: 2, e: 0.85, d: "in thirds" },
    { sec: "consR", mel: "low", acc: "low", heart: 1, brush: 1, e: 0.8, d: "felt piano" },
    { sec: "coda", mel: "glock", acc: "rock", heart: 1, e: 0.7, d: "goodnight" },
    { sec: "thin", acc: "sparse", heart: "fade", e: 0.5, slow: 1, d: "almost silence" },
  ];
  const SEC_NAME = { intro: "Intro", ant: "Tune", cons: "Answer", consR: "Answer", minor: "Minor", coda: "Coda", thin: "Lights low" };

  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  function prog(text, k) {
    return T.progression(text, BPB).map((h) => ({ bar: h.bar, beat: h.beat, dur: h.dur, chord: tsym(h.chord, k) }));
  }
  /**
   * The smoothest clean voicing: n tones (the 3rd always, then the 7th, colours, 5th) placed within
   * [lo, hi] with no semitones and no close intervals low down; the slash bass is left to the left hand.
   */
  function voiceClean(sym, prev, { lo, hi, n, top }) {
    const c = T.chord(sym);
    const fifth = c.intervals.find((x) => x >= 6 && x <= 8);
    let pri = [...new Set([...c.guide, ...c.colors, fifth != null ? mod12(c.root + fifth) : c.root, c.root])];
    if (c.bass !== c.root) pri = pri.filter((x) => x !== c.bass);
    const pool = pri.slice(0, n + 1);
    let best = null, bestS = Infinity;
    const place = (pcs, i, acc) => {
      if (i === pcs.length) { consider(acc.slice().sort((x, y) => x - y), pcs); return; }
      for (const m of T.notesIn([pcs[i]], lo, hi)) { acc.push(m); place(pcs, i + 1, acc); acc.pop(); }
    };
    const consider = (v, pcs) => {
      if (new Set(v).size < v.length) return;
      if (v.some((m, i) => i > 0 && (m - v[i - 1] === 1 || (v[i - 1] < 57 && m - v[i - 1] < 3) || (v[i - 1] < 50 && m - v[i - 1] < 5)))) return;
      let s = pcs.reduce((a, pc) => a + pri.indexOf(pc), 0) * 0.6;
      if (prev && prev.length) {
        const b = prev.slice().sort((x, y) => x - y), k2 = Math.min(v.length, b.length);
        let d = 0;
        for (let i = 0; i < k2; i++) d += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
        s += (d / k2) * 2;
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2) * 0.5;
      const t = v[v.length - 1];
      if (t > top[1]) s += (t - top[1]) * 1.5;
      if (t < top[0]) s += (top[0] - t) * 1.5;
      if (mod12(t) === c.root) s += 2;
      if (v.length < n) s += 6;
      if (s < bestS) { bestS = s; best = v; }
    };
    for (const nn of [n, n - 1]) {
      const combos = (arr, kk, start = 0, acc = [], out = []) => { if (acc.length === kk) out.push(acc.slice()); else for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, kk, i + 1, acc, out); acc.pop(); } return out; };
      for (const pcs of combos(pool, Math.min(nn, pool.length))) if (!c.guide.length || pcs.includes(c.guide[0])) place(pcs, 0, []);
      if (best) break;
    }
    return best || T.voice(sym, { lo, hi, n, prev, omitBass: true });
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  Sim.register({
    id: "lullaby",
    title: "Night Light",
    genre: "Lullaby",
    about: "A music-box lullaby in rocking 3/4: a celesta tune over felt piano, a warm low pad and a heartbeat, returning an octave lower, in thirds and as a little minor dream, and every few minutes winding down almost to silence before it is wound up again.",
    situations: ["sleep"],
    energy: 0.05,
    bpm: BPM, beatsPerBar: BPB, swing: 0.53, swingUnit: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const nursery = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.02, lowcut: 250, highcut: 6000 });
      const sky = I.reverb(ctx, out, { decay: 7, preDelay: 0.05, lowcut: 400, highcut: 4800 });
      const box = I.glock(ctx, { celesta: true, volume: -1, decay: 2.8 });
      const stars = I.glock(ctx, { celesta: true, volume: -11, decay: 3.2 });
      const pianoMel = I.softPiano(ctx, { volume: -2, decay: 5, cutoff: 2100 });
      const piano = I.softPiano(ctx, { volume: -10, decay: 4.2, cutoff: 1500 });
      const pad = I.pad(ctx, { volume: -16, cutoff: 620, attack: 2.6, release: 4.5, detune: 12, breath: 0.05 });
      const kit = I.kit(ctx, { volume: -5, kickNote: 31, preload: ["softKick", "brushSweep", "brushTap"] });

      // the music box: soften the very top so nothing pings
      const boxTone = ctx.keep(new Tone.Filter({ frequency: 4200, type: "lowpass", rolloff: -12 }));
      box.out.connect(boxTone);
      const bxp = ctx.keep(new Tone.Panner(0.16)); boxTone.connect(bxp); bxp.connect(out);
      const stp = I.place(ctx, stars, -0.4, out);
      const pmp = I.place(ctx, pianoMel, -0.06, out), pp = I.place(ctx, piano, -0.18, out);
      const padp = I.place(ctx, pad, 0.1, out), kp = I.place(ctx, kit, 0, out);
      I.send(ctx, bxp, nursery, -9); I.send(ctx, bxp, sky, -15);
      I.send(ctx, stp, sky, -6);
      I.send(ctx, pmp, nursery, -10); I.send(ctx, pmp, sky, -18);
      I.send(ctx, pp, nursery, -12);
      I.send(ctx, padp, sky, -12);
      I.send(ctx, kp, nursery, -16);

      const gentle = { timing: 0.01, vel: 0.05 };
      return {
        box: { layer: "melody", play: (t, e, d) => box.play(t, e.note, d, e.vel), humanize: gentle },
        pianoMel: { layer: "melody", play: (t, e, d) => pianoMel.play(t, e.note, d, e.vel), humanize: gentle },
        rh: { layer: "harmony", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.014, vel: 0.06 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        lh: { layer: "bass", play: (t, e, d) => piano.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.04 } },
        stars: { layer: "texture", play: (t, e, d) => stars.play(t, e.note, d, e.vel), humanize: { timing: 0.02, vel: 0.1 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep }), humanize: { timing: 0.006, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % 16, round = Math.floor(cycle / 16);
      const plan = PLAN[idx];
      const prevPlan = cycle > 0 ? PLAN[(idx + 15) % 16] : null;
      const k = round % 2 ? -2 : 0;
      const e = plan.e;

      const harmony = prog(H[plan.sec], k);
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * BPB + h.beat, end: h.bar * BPB + h.beat + h.dur }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };

      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: abs - bar * BPB, dur, note, vel, ...extra });
      };

      // ---- melody ----
      const longNotes = []; // where the low piano holds, the music box may answer
      if (plan.mel && MEL[plan.sec]) {
        const notes = MEL[plan.sec].map((n) => ({ ...n, note: n.note + k }));
        const ornament = round > 0 || idx >= 8;
        notes.forEach((n, i) => {
          const h = chordAt(n.beat), c = T.chord(h.chord);
          const strong = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
          const last = i === notes.length - 1 || notes[i + 1].beat - (n.beat + n.dur) > 0.01;
          // a gentle arch over each 4-bar phrase, never loud
          const u = (n.beat % 12) / 12;
          let vel = 0.36 + 0.07 * Math.sin(Math.PI * u) + (strong ? 0.03 : -0.02) + (n.dur >= 2 ? 0.02 : 0) - (last ? 0.03 : 0);
          if (plan.sec === "coda" && n.beat >= 12) vel -= 0.06 * (n.beat - 12) / 12 + 0.04;
          vel = clamp(vel * (0.85 + e * 0.2) + r.gauss(0.015), 0.18, 0.46);
          const dur = Math.min(n.dur * 0.97, 23.9 - n.beat);
          const low = n.note - 12;
          if (plan.mel === "glock" || plan.mel === "both" || plan.mel === "thirds") {
            // an occasional grace note from a step above into a long note (later passes only)
            if (ornament && plan.mel !== "thirds" && n.dur >= 2 && strong && r.chance(0.3)) {
              const g = T.step(n.note, 1, c.scale);
              if (g <= 84 + k) push("box", n.beat, 0.15, g, vel * 0.55, { delay: -0.07 });
            }
            let note = n.note;
            if (plan.mel === "thirds") {
              // a third below if it is a chord tone, else a fourth or a sixth, else the diatonic third
              const iv = [3, 4, 5, 8, 9].find((x) => c.pcs.includes(mod12(n.note - x)));
              note = [iv ? n.note - iv : T.step(n.note, -2, c.scale), n.note];
            }
            push("box", n.beat, dur, note, vel);
          }
          if (plan.mel === "low" || plan.mel === "both") {
            push("pianoMel", n.beat, dur, low, clamp(vel * (plan.mel === "both" ? 0.78 : 1.05), 0.16, 0.44));
            if (plan.mel === "low" && n.dur >= 2 && strong) longNotes.push({ at: n.beat, note: low });
          }
        });
      }

      // ---- music box answers the low piano's long notes; stars over the thin sections ----
      const top = 86 + k;
      longNotes.forEach(({ at, note }, i) => {
        if (!r.chance(i % 2 ? 0.75 : 0.5)) return;
        const c = T.chord(chordAt(at + 1).chord);
        const pool = T.notesIn(c.pcs, 76 + k, top).filter((m) => mod12(m) !== mod12(note) || m > note + 12);
        if (pool.length < 2) return;
        const hi = pool[pool.length - 1 - r.int(0, Math.min(1, pool.length - 2))];
        const lo = pool[pool.indexOf(hi) - 1];
        const end = chordAt(at + 1).end, at2 = at + 1.5 + (r.chance(0.5) ? 0.5 : 0);
        push("stars", at + 1, Math.min(1.2, end - at - 1.05), hi, 0.24 + r.range(0, 0.04));
        if (at2 < end - 0.3) push("stars", at2, Math.min(1.5, end - at2 - 0.05), lo, 0.2 + r.range(0, 0.04));
      });
      if (plan.sec === "thin") {
        const n = r.int(3, 5), used = new Set();
        for (let i = 0; i < n; i++) {
          const bar = r.int(0, 6), beat = r.pick([0, 1, 1.5, 2]);
          const at = bar * BPB + beat;
          if (used.has(bar)) continue;
          used.add(bar);
          const c = T.chord(chordAt(at).chord);
          const pool = T.notesIn(c.pcs, 74 + k, top);
          push("stars", at, 2.5, r.pick(pool), 0.18 + r.range(0, 0.06) - bar * 0.01);
        }
      }

      // ---- pad: a warm, low bed ----
      hAbs.forEach((h) => {
        if (plan.sec === "thin" && h.bar >= 6) return;
        const v = voiceClean(h.chord, state.padV, { lo: 52, hi: 69, n: 3, top: [62, 68] });
        state.padV = v;
        let vel = 0.3 * (0.8 + e * 0.3);
        if (plan.sec === "thin") vel *= 1 - h.bar * 0.12;
        push("pad", h.start, h.dur - 0.08, v, vel);
      });

      // ---- felt piano: left-hand bass and rocking right hand ----
      let lh = state.lh ?? 43 + k;
      const lhNote = (sym) => (lh = T.nearest(lh, [T.chord(sym).bass], 40, 52));
      const rhCache = new Map();
      const rhV = (h) => {
        if (!rhCache.has(h.start)) {
          const v = voiceClean(h.chord, state.rhV, { lo: 59, hi: 72, n: 3, top: [67, 72] });
          state.rhV = v; rhCache.set(h.start, v);
        }
        return rhCache.get(h.start);
      };
      const spansIn = (bar) => hAbs.filter((h) => h.bar === bar);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        let mode = plan.acc;
        if (mode === "late") mode = bar < 4 ? null : "rock";
        if (mode === "sparse") mode = bar % 2 === 0 && bar < 6 ? "sparse" : null;
        if (!mode) continue;
        const ve = 0.8 + e * 0.3;
        if (mode === "sparse") { push("lh", B, 2.9, lhNote(chordAt(B).chord), (0.27 - bar * 0.02) * ve); continue; }
        spansIn(bar).forEach((sp, si, all) => {
          if (si > 0 && T.chord(all[si - 1].chord).bass === T.chord(sp.chord).bass) return; // D9sus4 -> D7b9: one bass note
          if (si + 1 < all.length && T.chord(all[si + 1].chord).bass === T.chord(sp.chord).bass) sp = { ...sp, end: all[si + 1].end, dur: all[si + 1].end - sp.start };
          const n = lhNote(sp.chord);
          if (mode === "low") {
            push("lh", sp.start, Math.min(1.45, sp.dur - 0.05), n, 0.3 * ve);
            if (sp.start <= B + 1.5 - 1e-6 && sp.end >= B + 2.5 - 1e-6) {
              const c = T.chord(sp.chord);
              const fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
              push("lh", B + 1.5, Math.min(1.45, sp.end - B - 1.55), n + fifth, 0.22 * ve);
            }
          } else push("lh", sp.start, sp.dur - 0.1, n, 0.3 * ve);
        });
        if (mode === "rock" && !(plan.sec === "coda" && bar >= 5)) {
          [1, 2].forEach((bt) => {
            const v = rhV(chordAt(B + bt));
            const thin = bt === 2 && r.chance(0.4);
            push("rh", B + bt, 0.9, thin ? v.slice(1) : v, (bt === 1 ? 0.2 : 0.17) * ve);
          });
        } else if (mode === "arp") {
          const ORDER = r.chance(0.7) ? [0, 1, 2, 1, 0] : [0, 2, 1, 2, 1];
          [0.5, 1, 1.5, 2, 2.5].forEach((bt, i) => {
            const h = chordAt(B + bt), v = rhV(h);
            const m = v[Math.min(v.length - 1, ORDER[i])];
            push("rh", B + bt, Math.min(1.1, h.end - B - bt - 0.05), m, (bt === 1.5 ? 0.22 : 0.17) * ve + r.range(-0.015, 0.015));
          });
        }
      }
      state.lh = lh;

      // ---- heartbeat and brushes ----
      const beat = (at, vel) => {
        push("drums", at, 0.1, "softKick", vel, { straight: true });
        push("drums", at + 0.3, 0.1, "softKick", vel * 0.62, { straight: true });
      };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        const h = plan.heart;
        const base = 0.24 * (0.8 + e * 0.3);
        if (h === 1 || h === 2 || (h === "late" && bar >= 4)) {
          beat(B, base);
          if (h === 2) beat(B + 1.5, base * 0.7);
        } else if (h === "fade" && bar < 4) beat(B, base * (1 - bar * 0.18));
      }
      if (plan.sec !== "thin") {
        const swish = (bar, vel) => push("drums", bar * BPB, 2, "brushSweep", vel, { sweep: 1.6 });
        if (plan.brush) { swish(3, 0.2); swish(7, 0.22); }
        else if (r.chance(0.55)) swish(7, 0.18);
        if (plan.brush && r.chance(0.5)) push("drums", 7 * BPB + 2.5, 0.1, "brushTap", 0.12);
        if (plan.heart === 2 && r.chance(0.35)) push("drums", r.pick([1, 5]) * BPB + 2, 0.1, "brushTap", 0.1);
      } else push("drums", 0, 2, "brushSweep", 0.16, { sweep: 2.2 });

      // ---- tempo: the music box runs down, and is wound up again ----
      let tempo;
      if (plan.slow) tempo = { bpm: 50, rampBeats: 8 * BPB };
      else if (prevPlan && prevPlan.slow) tempo = { bpm: BPM, rampBeats: 2 * BPB };

      const label = [SEC_NAME[plan.sec], plan.d, k ? "in F" : null].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: label, state, tempo };
    },
  });
})();
