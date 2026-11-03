// Zoning Board: lounge jazz in Eb for a city that is quietly doing fine.
// AABA, 32 bars. Head choruses: vibraphone states a melody composed once per performance and
// recalled on every A. Solo choruses: the Rhodes takes a right-hand solo while the vibes lay out.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;

  const FORM = {
    A1: "| Ebmaj9 | Abmaj9#11 | Gm9 | C13b9 | Fm11 | Bb13 | Gm7 C7#5 | Fm9 Bb13sus4 |",
    A2: "| Ebmaj9 | Abmaj9#11 | Gm9 | C13b9 | Fm11 | Bb13 | Ebmaj9 | Bbm9 Eb13 |",
    B: "| Abmaj9 | Dbmaj9#11 | Gm9 | Cm9 F13 | Fm9 | Bb13 | Gm9 C7alt | Fm9 Bb7b9 |",
    A3: "| Ebmaj9 | Abmaj9#11 | Gm9 | C13b9 | Fm11 | Bb13 | Ebmaj9:2 C7#5:2 | Fm9 Bb13sus4 |",
  };
  const ORDER = ["A1", "A2", "B", "A3"];
  const PROG = Object.fromEntries(Object.entries(FORM).map(([k, v]) => [k, T.progression(v)]));

  // Comping rhythms for a 4-beat chord span: [beat, duration] (negative = anticipation).
  const COMP4 = [
    [[[0, 2.6]], 2], [[[0, 0.9], [1.5, 1.8]], 3], [[[1.5, 0.45], [3, 0.9]], 2], [[[0, 0.45], [2.5, 1.3]], 2],
    [[[-0.5, 2]], 2], [[[1, 0.45], [2.5, 1.4]], 1.5], [[[0, 1.2], [2, 0.45], [3.5, 0.45]], 1],
  ];
  const COMP2 = [[[[0, 1.4]], 3], [[[-0.5, 1.5]], 2], [[[0.5, 0.45], [1.5, 0.45]], 1], [[[0, 0.45], [1, 0.9]], 1.5]];
  const SHELL4 = [[[[0, 1.8]], 3], [[[1.5, 1.5]], 2], [[[-0.5, 1.6]], 1.5], [[[0, 0.5], [2.5, 1.2]], 1]];

  Sim.register({
    id: "zoning-board",
    title: "Zoning Board",
    genre: "Lounge jazz",
    about: "AABA in E♭ with a vibraphone head that returns on every A, walking upright, brushes, and a Rhodes solo on alternate choruses.",
    bpm: 108, swing: 0.62, beatsPerBar: 4, cycleBars: 8, gainDb: -0.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.2, preDelay: 0.018, lowcut: 250, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 4.5, preDelay: 0.03, lowcut: 400, highcut: 6000 });
      const vibes = I.vibes(ctx, { volume: -1, decay: 3.4 });
      const rhodes = I.rhodes(ctx, { volume: -6, cutoff: 3600, tremolo: 3.2 });
      const solo = I.rhodes(ctx, { volume: -1, cutoff: 4200, tremolo: 0.01, tremoloDepth: 0, tine: -12 });
      const bass = I.upright(ctx, { volume: -5 });
      const kit = I.kit(ctx, { volume: 5, kickNote: 33, preload: ["brushSweep", "brushTap", "hatPedal", "softKick", "ride"] });
      const vp = I.place(ctx, vibes, 0.32, out), rp = I.place(ctx, rhodes, -0.28, out), sp = I.place(ctx, solo, 0.12, out);
      I.place(ctx, bass, 0, out); const kp = I.place(ctx, kit, 0.05, out);
      I.send(ctx, vp, room, -9); I.send(ctx, vp, hall, -16); I.send(ctx, rp, room, -12); I.send(ctx, sp, room, -10);
      I.send(ctx, kp, room, -14); I.send(ctx, bass.out, room, -24);
      return {
        vibes: { layer: "melody", play: (t, e, d) => vibes.play(t, e.note, d, e.vel) },
        solo: { layer: "melody", play: (t, e, d) => solo.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
        comp: { layer: "harmony", play: (t, e, d) => rhodes.play(t, e.note, d, e.vel), humanize: { timing: 0.012 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const name = ORDER[cycle % 4], chorus = Math.floor(cycle / 4);
      const prog = PROG[name];
      const head = chorus % 2 === 0;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, absBeat, dur, note, vel, extra) => { const p = C.at(absBeat, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };

      // ---- melody ----
      if (head) {
        if (!state.headA) { // compose the tune once: 6 bars of A that every A section shares
          const m = C.line({ start: 0, end: 24, chordAt: sym, lo: 67, hi: 84, rng: r.fork(1), density: 0.28, phrase: [4, 7], rest: [1, 2], motifProb: 0.75, chromatic: 0.2, register: 0.45, upbeatStart: 0.5 });
          state.headA = m.notes; state.headMotif = m.motif;
        }
        let notes;
        if (name === "B") {
          if (!state.headB) state.headB = C.line({ start: 0, end: 30, chordAt: sym, lo: 67, hi: 86, rng: r.fork(2), density: 0.32, phrase: [4, 8], rest: [1, 2], motif: state.headMotif, motifProb: 0.6, chromatic: 0.2, register: 0.6 }).notes;
          notes = state.headB;
        } else {
          const tail = C.line({ start: 24, end: 31, chordAt: sym, lo: 65, hi: 82, rng: r.fork(3 + cycle), density: 0.3, phrase: [3, 5], rest: [1, 1], motif: state.headMotif, motifProb: 0.5, register: 0.4, prev: state.headA[state.headA.length - 1]?.note });
          notes = state.headA.concat(tail.notes);
        }
        const embellish = chorus > 0;
        notes.forEach((n) => {
          let note = n.note;
          if (embellish && !n.strong && r.chance(0.12)) note = T.step(note, r.chance(0.5) ? 1 : -1, T.chord(sym(n.beat)).scale);
          push("vibes", n.beat, Math.max(0.4, n.dur), note, n.vel * 0.95);
        });
      } else {
        const m = C.line({ start: 0, end: 31.5, chordAt: sym, lo: 62, hi: 86, rng: r, density: 0.62 + 0.1 * (chorus % 3 === 1 ? 1 : 0), phrase: [3, 8], rest: [0.5, 2], motif: state.soloMotif, motifProb: 0.35, chromatic: 0.35, register: 0.55, prev: state.soloLast, lead: r.pick([0, 0.5, 1]) });
        state.soloMotif = m.motif; state.soloLast = m.last;
        m.notes.forEach((n) => push("solo", n.beat, n.dur, n.note, 0.55 + (n.vel - 0.6) * 1.2));
      }

      // ---- comping (Rhodes): rootless voicings with voice leading ----
      // Each chord's hits end where the next chord's first hit (possibly an anticipation) begins.
      const hits = prog.map((c) => {
        const s0 = c.bar * 4 + c.beat;
        const pats = head ? (c.dur >= 4 ? COMP4 : COMP2) : (c.dur >= 4 ? SHELL4 : COMP2);
        const v = T.voice(c.chord, head ? { lo: 50, hi: 75, n: 4, prev: state.voicing, top: [64, 74], rng: r } : { lo: 46, hi: 66, n: 3, prev: state.voicing, top: [57, 65], rng: r });
        state.voicing = v;
        const pat = r.weighted(s0 === 0 ? pats.filter(([p]) => p[0][0] >= 0) : pats); // no anticipation across sections
        return pat.map(([b, d]) => ({ at: s0 + b, d, v }));
      });
      hits.forEach((hs, i) => {
        const nextStart = i + 1 < hits.length && hits[i + 1].length ? Math.min(...hits[i + 1].map((h) => h.at)) : 32;
        hs.filter((h) => h.at < nextStart - 0.25).forEach((h) => push("comp", h.at, Math.min(h.d, nextStart - h.at - 0.05), h.v, (head ? 0.5 : 0.42) + r.range(-0.05, 0.08)));
      });

      // ---- walking bass ----
      const twoFeel = chorus === 0 && name === "A1";
      let last = state.bassLast ?? 39;
      for (let b = 0; b < 32; b += twoFeel ? 2 : 1) {
        const c = T.chord(sym(b)), nextC = T.chord(sym(b + (twoFeel ? 2 : 1)));
        const changing = sym(b + (twoFeel ? 2 : 1)) !== sym(b) || (b + 1) % 4 === 0;
        const chordStart = chordAt(b).bar * 4 + chordAt(b).beat === b;
        let n;
        if (chordStart) n = r.chance(0.85) ? T.nearest(last, [c.bass], 33, 50) : T.nearest(last, [mod(c.root + (c.intervals.includes(3) ? 3 : 4))], 33, 50);
        else if (changing && !twoFeel) {
          const target = T.nearest(last, [nextC.bass], 33, 50);
          n = r.weighted([[target + 1, 3], [target - 1, 3], [T.nearest(target + 7, [mod(nextC.root + 7)], 31, 52), 1.5], [T.step(target, r.chance(0.5) ? 1 : -1, c.scale), 2]]);
        } else if (twoFeel) n = T.nearest(last, [mod(c.root + (c.intervals.find((i) => i >= 6 && i <= 8) ?? 7))], 33, 50);
        else {
          const pool = T.notesIn(c.pcs.slice(0, 4), 31, 52).filter((m) => Math.abs(m - last) <= 7 && m !== last);
          n = pool.length ? r.pick(pool) : T.step(last, r.chance(0.5) ? 1 : -1, c.scale);
        }
        n = Math.max(28, Math.min(52, n));
        push("bass", b, twoFeel ? 1.9 : 0.94, n, b % 2 === 0 ? 0.85 : 0.74);
        if (!twoFeel && r.chance(0.06) && b % 4 === 1) push("bass", b + 2 / 3, 0.25, n, 0.35, { straight: true }); // skip note
        last = n;
      }
      state.bassLast = last;

      // ---- brushes / ride ----
      const ride = !head;
      for (let bar = 0; bar < 8; bar++) {
        const fill = bar === 7 && r.chance(name === "B" ? 0.9 : 0.55);
        for (let beat = 0; beat < 4; beat++) {
          const B = bar * 4 + beat;
          push("drums", B, 1, "brushSweep", 0.32 + (beat % 2) * 0.05, { sweep: 0.42 });
          if (beat % 2 === 1) push("drums", B, 0.1, "hatPedal", 0.42);
          push("drums", B, 0.1, "softKick", 0.16);
          const tap = ride ? "ride" : "brushTap";
          if (!fill || beat < 2) {
            push("drums", B, 0.1, tap, beat % 2 ? 0.55 : 0.42);
            if (beat % 2 === 1) push("drums", B + 0.5, 0.1, tap, 0.3);
          }
          if (!fill && r.chance(0.07)) push("drums", B + 0.5, 0.1, "brushTap", 0.38); // comping drop
        }
        if (fill) {
          const pos = r.pick([[2, 2.5, 3, 3.5], [2.5, 3, 3.5], [3, 3.333, 3.667]]);
          pos.forEach((p, i) => push("drums", bar * 4 + p, 0.1, "brushTap", 0.45 + i * 0.07, { straight: p % 0.5 !== 0 }));
          push("drums", bar * 4 + 3.5, 0.1, "softKick", 0.4);
        }
      }

      const label = `Chorus ${chorus + 1} · ${name === "B" ? "bridge" : name}${head ? " · vibes head" : " · Rhodes solo"}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
  function mod(x) { return ((x % 12) + 12) % 12; }
})();
