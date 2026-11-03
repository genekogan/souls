// Arena: a stadium anthem at 100 BPM, for the walk-out, the training montage and the win.
//
// The idea everything grows from is one crowd rhythm in eighths, grouped 3+3+2:
// stomp-stomp-clap, stomp-stomp-clap, clap-clap. The walk-out is that and nothing else (low taiko and
// kick for the stomps, a stage clap doubled by a crowd of claps); the stadium organ enters with a riff on
// the same 3+3+2 (a pedal E5 struck on eighths 1, 4 and 7 with chord tones between), and when the band
// kicks in the drummer keeps the stomps in the kick and the taiko. The brass stabs and the lead hook
// also start with that dotted-eighth, dotted-eighth, eighth.
//
// Harmony is rock-anthem plain, coloured by the borrowed chords that make it sound big: I bVII IV I,
// then bVI bVII I (the "Aeolian" lift), and a riff on I bIII bVII IV. The crowd's chant is long "oh"
// lines in octaves with "hey!" shouts at the phrase ends; synth brass and stabs answer it.
//
// Form (one round = 9 cycles of 8 bars, about 2.9 minutes):
//   Walk-out (stomps alone, then organ riff, bass, guitar palm mutes) ->
//   The chant (crowd + stomps, power chords) -> the chant again (full kit, brass answers, tambourine) ->
//   The big riff (lead hook over brass stabs) -> the riff again (synth brass take the hook, the lead
//   doubles it an octave up, choir pad) -> Breakdown (drums and the crowd clapping, then the crowd sings
//   the chant a cappella over the stomps while the snare builds) -> Finale: up a whole step, the chant
//   with everyone and a descant -> the riff, everyone -> Victory lap (half-time, lead solo, three stop
//   hits and one last "hey!").
// Alternate rounds start a minor third higher (A, then C), so the finale lands in B or D.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;

  function trSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m) throw new Error(`arena: bad chord ${sym}`);
    const nm = (p) => T.NAMES[mod12(T.PC[p] + k)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }
  const progOf = (text, k = 0) => T.progression(text.replace(/[A-G][#b]?[^\s|]*/g, (tok) => trSym(tok, k)), BPB);
  const PROG = {
    WALK: "| A5 | % | % | % | A | % | F | G |",
    CHANT: "| A | G | D | A | F | G | A | % |",
    RIFF: "| A | C | G | D | A | C | G | E |",
    BREAK: "| A5 | % | % | % | A | G | D | A |",
  };

  // ---------- notation (bars of "note/beats", r = rest) ----------
  function bars(list, k = 0) {
    const out = [];
    list.forEach((s, i) => {
      if (s == null) return;
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`arena: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: i * BPB + b, dur, note: T.midi(m[1]) + k });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`arena: bar ${i + 1} sums to ${b}: ${s}`);
    });
    return out;
  }
  // The crowd's chant over CHANT: long "oh" lines, a breath (and a "hey!") at the end of each four bars.
  const CHANT_OH = [
    "E4/1.5 E4/0.5 C#4/1 E4/1",
    "D4/1.5 D4/0.5 B3/2",
    "A3/1 D4/1 F#4/1.5 E4/0.5",
    "E4/3 r/1",
    "C4/1.5 C4/0.5 A3/1 C4/1",
    "D4/1.5 D4/0.5 B3/1 D4/1",
    "E4/1.5 E4/0.5 F#4/1 E4/1",
    "C#4/3 r/1",
  ];
  // The hook over RIFF, opening with the 3+3+2 (dotted eighth, dotted eighth, eighth).
  const HOOK = [
    "A4/0.75 C#5/0.75 E5/0.5 A5/1 F#5/0.5 E5/0.5",
    "G5/0.75 E5/0.75 C5/0.5 D5/1 E5/1",
    "B4/0.75 D5/0.75 G5/1 F#5/0.5 D5/1",
    "F#5/1.5 E5/0.5 D5/1 A4/1",
    "A4/0.75 C#5/0.75 E5/0.5 A5/1 F#5/0.5 E5/0.5",
    "G5/0.75 E5/0.75 C5/0.5 D5/1 E5/1",
    "B4/0.75 D5/0.75 G5/0.5 A5/1 B5/1",
    "G#5/1.5 F#5/0.5 E5/1 B4/1",
  ];
  // A descant for the finale chant (lead, high and long), written in A.
  const DESCANT = ["A5/4", "B5/4", "A5/2 F#5/2", "E5/4", "F5/2 E5/2", "D5/4", "C#5/2 E5/2", "A5/3 r/1"];

  // ---------- form ----------
  const S = {
    walk: { prog: "WALK", kind: "walk", label: "Walk-out · stomp, stomp, clap" },
    chantA: { prog: "CHANT", kind: "chant", pass: 1, label: "The chant · the crowd sings" },
    chantB: { prog: "CHANT", kind: "chant", pass: 2, label: "The chant · the band kicks in" },
    riffA: { prog: "RIFF", kind: "riff", pass: 1, label: "The big riff · lead hook" },
    riffB: { prog: "RIFF", kind: "riff", pass: 2, label: "The big riff · the brass take it" },
    brk: { prog: "BREAK", kind: "break", label: "Breakdown · drums and the crowd clapping" },
    finChant: { prog: "CHANT", kind: "chant", pass: 3, up: 2, label: "Finale · up a step, everyone sings" },
    finRiff: { prog: "RIFF", kind: "riff", pass: 3, up: 2, label: "Finale · the riff, everyone" },
    outro: { prog: "CHANT", kind: "outro", up: 2, label: "Victory lap · half-time, lead solo" },
  };
  const ROUND = ["walk", "chantA", "chantB", "riffA", "riffB", "brk", "finChant", "finRiff", "outro"];
  const BASE = [0, 3]; // A, then C
  function planAt(cycle) {
    const round = Math.floor(cycle / ROUND.length), id = ROUND[cycle % ROUND.length];
    const p = { id, round, ...S[id] };
    p.key = BASE[round % 2] + (p.up || 0);
    return p;
  }
  const KEYNAME = (k) => T.NAMES[mod12(9 + k)];

  Sim.register({
    id: "arena",
    title: "Arena",
    genre: "Stadium anthem",
    about: "Sports-arena rock at 100 BPM built on one crowd rhythm, stomp-stomp-clap in 3+3+2: a stadium organ riff, a crowd chant with \"hey!\" shouts, power chords, brass stabs and a lead hook, a breakdown of drums and clapping where the crowd sings alone, and a finale a whole step up.",
    situations: ["training", "celebrate", "fight"],
    energy: 0.9,
    bpm: 100, beatsPerBar: BPB, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const arena = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.035, lowcut: 300, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.3, preDelay: 0.008, lowcut: 200, highcut: 8000 });
      const slap = I.delay(ctx, out, { time: "8n", feedback: 0.18, highcut: 3500, pingPong: true });

      const lead = I.lead(ctx, { volume: -1, wave: "fatsawtooth", detune: 14, glide: 0.035, base: 700, octaves: 3, vibratoDepth: 0.07, vibratoDelay: 0.3 });
      const brass = I.synthBrass(ctx, { volume: -3, attack: 0.03, swell: 0.12, base: 380, octaves: 3.2, release: 0.6 });
      const stabs = I.brassStab(ctx, { volume: -5 });
      const oh = I.choir(ctx, { volume: -2, vowel: "o", attack: 0.22, release: 1.1 });
      const hey = I.choir(ctx, { volume: 0, vowel: "e", attack: 0.012, release: 0.18 });
      const organ = I.organ(ctx, { volume: -9 });
      const gtr = I.distGuitar(ctx, { volume: -8, drive: 0.8, cutoff: 3600 });
      const bass = I.ebass(ctx, { volume: -3 });
      const kit = I.kit(ctx, { volume: 0, kickNote: 33, preload: ["kick", "rockSnare", "snare", "clap", "taiko", "tom", "hatClosed", "hatOpen", "crash", "ride", "tambourine"] });
      const crowd = I.kit(ctx, { volume: -4, preload: ["clap", "snap"] });

      const lp = I.place(ctx, lead, 0.05, out), bp = I.place(ctx, brass, -0.12, out), sp = I.place(ctx, stabs, 0.18, out);
      const op = I.place(ctx, oh, -0.05, out), hp = I.place(ctx, hey, 0, out), orp = I.place(ctx, organ, -0.35, out);
      const gp = I.place(ctx, gtr, 0.4, out), kp = I.place(ctx, kit, 0, out), cp = I.place(ctx, crowd, 0, out);
      I.place(ctx, bass, 0, out);
      // a second, darker guitar on the other side (double-tracked rhythm guitar)
      const gtr2 = I.distGuitar(ctx, { volume: -10, drive: 0.7, cutoff: 2900 });
      const gp2 = I.place(ctx, gtr2, -0.42, out);
      I.send(ctx, lp, arena, -12); I.send(ctx, lp, slap, -18); I.send(ctx, bp, arena, -10); I.send(ctx, sp, arena, -12);
      I.send(ctx, op, arena, -5); I.send(ctx, hp, arena, -6); I.send(ctx, orp, arena, -12);
      I.send(ctx, gp, room, -16); I.send(ctx, gp2, room, -16); I.send(ctx, kp, arena, -16); I.send(ctx, kp, room, -12);
      I.send(ctx, cp, arena, -4); I.send(ctx, bass.out, room, -24);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        lead: { layer: "melody", play: pl(lead), humanize: { timing: 0.006, vel: 0.04 } },
        brass: { layer: "melody", play: pl(brass), humanize: { timing: 0.006, vel: 0.04 } },
        oh: { layer: "melody", play: pl(oh), humanize: { timing: 0.012, vel: 0.05 } },
        hey: { layer: "texture", play: pl(hey), humanize: { timing: 0.01, vel: 0.06 } },
        stabs: { layer: "harmony", play: pl(stabs), humanize: { timing: 0.005, vel: 0.05 } },
        organ: { layer: "harmony", play: pl(organ), humanize: { timing: 0.004, vel: 0.04 } },
        gtr: {
          layer: "harmony", humanize: { timing: 0.004, vel: 0.06 },
          play(t, e, d) { gtr.play(t, e.note, d, e.vel); gtr2.play(t + 0.009, e.note, d, e.vel * 0.9); },
        },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.004, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.004, vel: 0.07 } },
        crowd: {
          layer: "drums", humanize: { timing: 0.006, vel: 0.12 },
          // a crowd clap is several people a few milliseconds apart
          play(t, e) {
            const n = e.many ?? 3;
            for (let i = 0; i < n; i++) crowd.hit(i % 3 === 2 ? "snap" : "clap", t + i * 0.011 + (i % 2) * 0.004, e.vel * (1 - i * 0.18));
          },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const K = plan.key, kind = plan.kind, pass = plan.pass || 0;
      const prog = progOf(PROG[plan.prog], K);
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(Math.max(0, b)).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const drum = (abs, voice, vel, pitch) => push("drums", abs, 0.25, voice, vel, pitch != null ? { pitch } : {});
      const clap = (abs, vel, many) => push("crowd", abs, 0.25, "clap", vel, { many: many ?? 3 });
      const tonic = mod12(9 + K);
      const tp = T.nearest(36, [tonic], 33, 44); // taiko on the tonic
      const big = pass === 3;

      // ================= drums =================
      const STOMPS = [0, 0.5, 1.5, 2], CLAPS = [1, 2.5, 3, 3.5]; // stomp-stomp-clap, stomp-stomp-clap, clap-clap
      const stomp = (bar, lvl = 1) => {
        const B = bar * BPB;
        STOMPS.forEach((b, i) => { drum(B + b, "taiko", (i % 2 ? 0.62 : 0.78) * lvl, tp); drum(B + b, "kick", (i % 2 ? 0.5 : 0.62) * lvl); });
        CLAPS.forEach((b, i) => { drum(B + b, "clap", (i === 0 ? 0.72 : 0.62) * lvl); clap(B + b, (i === 0 ? 0.6 : 0.5) * lvl); });
      };
      const TOMS = [50, 50, 47, 47, 43, 43, 40, 40];
      const tomFill = (bar, from = 2) => {
        TOMS.slice(0, (4 - from) * 4).forEach((p, i) => drum(bar * BPB + from + i * ((4 - from) / 8), "tom", 0.55 + 0.05 * i, p));
        drum(bar * BPB + 3.5, "kick", 0.7);
      };
      const rock = (bar, o = {}) => {
        const B = bar * BPB, fill = o.fill;
        [[0, 0.85], [0.5, 0.68], [2, 0.8], [2.75, 0.58]].forEach(([b, v]) => { if (!fill || b < 2) drum(B + b, "kick", v); });
        if (o.taiko) [0, 0.5].concat(fill ? [] : [2]).forEach((b, i) => drum(B + b, "taiko", i === 1 ? 0.5 : 0.62, tp));
        drum(B + 1, "rockSnare", 0.82); clap(B + 1, 0.4, 2);
        if (!fill) { drum(B + 3, "rockSnare", 0.85); clap(B + 3, 0.45, 2); }
        if (!fill && r.chance(0.35)) drum(B + 3.75, "snare", 0.16);
        const cym = o.ride ? "ride" : "hatClosed";
        for (let i = 0; i < 8; i++) {
          const b = i * 0.5;
          if (fill && b >= 2) break;
          if (o.open && b === 3.5) { drum(B + b, "hatOpen", 0.4); continue; }
          drum(B + b, cym, cym === "ride" ? (i % 2 ? 0.5 : 0.62) : (i % 2 ? 0.24 : 0.36));
        }
        if (o.tamb) for (let i = 0; i < (o.tamb === 16 ? 16 : 8); i++) {
          const b = i * (o.tamb === 16 ? 0.25 : 0.5);
          if (fill && b >= 2) break;
          drum(B + b, "tambourine", (b === 1 || b === 3) ? 0.42 : i % 2 ? 0.18 : 0.26);
        }
        if (fill) tomFill(bar);
      };
      const halftime = (bar, o = {}) => {
        const B = bar * BPB;
        drum(B, "kick", 0.85); drum(B + 1.5, "kick", 0.6); drum(B + 2.75, "kick", 0.5);
        drum(B, "taiko", 0.6, tp);
        drum(B + 2, "rockSnare", 0.88); clap(B + 2, 0.55);
        for (let i = 0; i < 8; i++) drum(B + i * 0.5, "ride", i % 2 ? 0.45 : 0.58);
        if (o.fill) [3, 3.25, 3.5, 3.75].forEach((b, i) => drum(B + b, "tom", 0.6 + 0.06 * i, [47, 47, 43, 40][i]));
      };

      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB, last = bar === 7;
        if (kind === "walk") {
          stomp(bar, 0.85 + 0.03 * bar);
          if (last) for (let i = 0; i < 8; i++) drum(B + 2 + i * 0.25, "snare", 0.25 + 0.07 * i);
        } else if (kind === "chant" && pass === 1) {
          stomp(bar, 1);
          if (bar >= 4) for (let i = 0; i < 8; i++) drum(B + i * 0.5, "hatClosed", i % 2 ? 0.18 : 0.28);
          if (last) tomFill(bar, 3);
        } else if (kind === "chant") {
          rock(bar, { taiko: true, tamb: big ? 16 : 8, open: bar % 2 === 1, fill: last });
        } else if (kind === "riff") {
          rock(bar, { taiko: big || bar % 4 === 0, ride: pass === 2 && bar < 4, open: bar % 2 === 1, tamb: pass >= 2 ? (big ? 16 : 8) : 0, fill: last && next.kind !== "break" });
          if (last && next.kind === "break") { drum(B + 2, "crash", 0.6); drum(B + 2, "taiko", 0.85, tp); drum(B + 2, "kick", 0.85); } // the band cuts on beat 3
        } else if (kind === "break") {
          // taiko and floor toms; the crowd claps on 2 and 4, then eighths; the snare builds into the finale
          if (bar < 6) {
            [0, 0.5, 2, 2.5].forEach((b, i) => drum(B + b, "taiko", i % 2 ? 0.55 : 0.72, tp));
            [1.5, 3.5, 3.75].forEach((b, i) => drum(B + b, "tom", i === 2 ? 0.35 : 0.5, i === 0 ? 43 : 40));
            if (bar >= 2) [0, 2].forEach((b) => drum(B + b, "kick", 0.55));
          }
          const claps = bar < 2 ? [1, 3] : bar < 4 ? [1, 3, 3.5] : bar < 6 ? [1, 2.5, 3, 3.5] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
          claps.forEach((b) => clap(B + b, (b === 1 || b === 3 ? 0.7 : 0.5) * (bar < 2 ? 0.85 : 1), 4));
          if (bar === 6) { for (let i = 0; i < 8; i++) drum(B + i * 0.5, "snare", 0.18 + 0.03 * i); drum(B, "taiko", 0.7, tp); drum(B + 2, "taiko", 0.7, tp); }
          if (last) { for (let i = 0; i < 8; i++) drum(B + i * 0.25, "snare", 0.42 + 0.04 * i); tomFill(bar); drum(B + 3.5, "taiko", 0.85, tp); }
        } else if (kind === "outro") {
          if (last) { // three stop hits on the 3+3+2, then the last "hey!"
            [0, 0.75, 1.5].forEach((b) => { drum(B + b, "kick", 0.9); drum(B + b, "taiko", 0.85, tp); drum(B + b, "rockSnare", 0.8); });
            drum(B, "crash", 0.8); drum(B + 1.5, "crash", 0.7);
            clap(B + 3, 0.7, 4);
          } else halftime(bar, { fill: bar === 3 || bar === 6 });
        }
        // crashes on arrivals
        if (bar === 0 && kind !== "walk" && !(kind === "chant" && pass === 1) && kind !== "break") drum(B, "crash", big ? 0.85 : 0.75);
        if (bar === 4 && (kind === "riff" || big)) drum(B, "crash", 0.6);
        if (bar === 0 && kind === "chant" && pass === 1) drum(B, "crash", 0.55);
      }

      // ================= bass =================
      const nextFirst = progOf(PROG[next.prog], next.key)[0].chord;
      let bassLast = state.bassLast ?? 38;
      const bassRoot = (sym) => T.nearest(bassLast, [T.chord(sym).root], 33, 45);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB, sym = symAt(B), rt = bassRoot(sym);
        bassLast = rt;
        const nextSym = bar === 7 ? nextFirst : symAt(B + 4);
        if (kind === "walk" && bar < 4) continue;
        if (kind === "break") continue;
        if (kind === "outro") {
          if (bar === 7) { [0, 0.75, 1.5].forEach((b) => push("bass", B + b, b === 1.5 ? 1.2 : 0.5, rt, 0.9)); continue; }
          push("bass", B, 1.4, rt, 0.85); push("bass", B + 1.5, 0.45, rt, 0.6); push("bass", B + 2, 1.9, rt + 12 <= 52 ? rt + 12 : rt, 0.7);
          continue;
        }
        if (kind === "chant" && pass === 1) { // quarters, a pickup into the next chord
          [0, 1, 2, 3].forEach((b) => push("bass", B + b, 0.9, rt, b === 0 ? 0.88 : 0.68));
          if (nextSym !== sym && bar < 7) { ev[ev.length - 1].dur = 0.45; push("bass", B + 3.5, 0.45, T.nearest(rt, [mod12(T.chord(nextSym).root - 1), mod12(T.chord(nextSym).root + 2)], 31, 47), 0.6); }
          continue;
        }
        if (kind === "riff" && bar === 7 && next.kind === "break") { push("bass", B, 1.9, rt, 0.9); push("bass", B + 2, 0.5, rt, 0.9); continue; }
        // eighths, the 3+3+2 accented; an octave pop on the last eighth
        for (let i = 0; i < 8; i++) {
          const b = i * 0.5;
          if (kind !== "walk" && (bar === 7 && b >= 2) && next.kind !== "break" && (kind === "chant" || kind === "riff")) {
            // under the drum fill: walk up to the next root
            // under the drum fill: 5, 5, 6, 7 walking up to the next root
            const tgt = T.nearest(rt, [T.chord(nextSym).root], 38, 45);
            push("bass", B + b, 0.45, [tgt - 5, tgt - 5, tgt - 3, tgt - 1][i - 4], i === 4 ? 0.8 : 0.7);
            bassLast = tgt;
            continue;
          }
          const acc = i === 0 || i === 3 || i === 6;
          const n = i === 7 && kind === "riff" ? (rt + 12 <= 50 ? rt + 12 : rt + 7) : rt; // an octave (or fifth) pop
          push("bass", B + b, 0.42, n, acc ? 0.86 : 0.62);
        }
      }
      state.bassLast = bassLast;

      // ================= guitars (power chords, double-tracked) =================
      const power = (sym) => { const c = T.chord(sym); const rt = T.nearest(43, [c.root], 40, 48); return [rt, rt + 7, rt + 12]; };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB, sym = symAt(B), pc = power(sym), mute = pc.slice(0, 2);
        if (kind === "walk") {
          if (bar >= 6) for (let i = 0; i < 8; i++) push("gtr", B + i * 0.5, 0.2, mute, 0.3 + 0.03 * i + (bar - 6) * 0.1);
          continue;
        }
        if (kind === "break") continue;
        if (kind === "outro") {
          if (bar === 7) [0, 0.75, 1.5].forEach((b) => push("gtr", B + b, b === 1.5 ? 1.5 : 0.5, pc, 0.8));
          else push("gtr", B, 3.9, pc, 0.7);
          continue;
        }
        if (kind === "chant" && pass === 1) { // ring the chord, then palm-mute the second half
          push("gtr", B, 1.9, pc, 0.66);
          for (let i = 4; i < 8; i++) push("gtr", B + i * 0.5, 0.2, mute, 0.34 + (i === 7 ? 0.06 : 0));
          continue;
        }
        if (kind === "riff" && bar === 7 && next.kind === "break") { push("gtr", B, 1.9, pc, 0.75); push("gtr", B + 2, 1.5, pc, 0.85); continue; }
        if (kind === "riff") { // a wall: ring the bar, re-strike on the "2" of the 3+3+2 (leave the fill alone)
          push("gtr", B, 1.4, pc, 0.7); push("gtr", B + 1.5, bar === 7 ? 0.45 : 1.4, pc, 0.6); if (bar !== 7) push("gtr", B + 3, 0.9, pc, 0.62);
          continue;
        }
        // chant with the band: 3+3+2 accents over palm mutes
        for (let i = 0; i < 8; i++) {
          if (bar === 7 && i >= 4) break;
          const acc = i === 0 || i === 3 || i === 6;
          push("gtr", B + i * 0.5, acc ? 0.45 : 0.2, acc ? pc : mute, acc ? 0.66 : 0.32);
        }
      }

      // ================= organ =================
      const P = (() => { let p = 76 + K; while (p > 80) p -= 12; return p; })(); // the pedal top note: E5 in A
      const organRiff = (bar, lvl = 1, o = {}) => {
        const B = bar * BPB, c = T.chord(symAt(B));
        const below = T.notesIn(c.pcs, P - 9, P - 1).filter((m) => mod12(m) !== mod12(P)).reverse(); // chord tones under the pedal
        const L1 = below[0] ?? P - 5, L2 = below[1] ?? L1 - 3;
        const seq = [P, L1, L2, P, L1, L2, P, L1];
        seq.forEach((m, i) => { if (i < (o.upTo ?? 8)) push("organ", B + i * 0.5, 0.42, m, (i === 0 || i === 3 || i === 6 ? 0.6 : 0.42) * lvl); });
      };
      const organChord = (bar, len = 4) => {
        const B = bar * BPB, sym = symAt(B);
        const v = T.voice(sym, { lo: 57, hi: 76, n: 3, spread: "close", prev: state.orgV, top: [69, 76], rng: r, rootless: false });
        state.orgV = v;
        push("organ", B, len - 0.1, v, 0.45);
      };
      for (let bar = 0; bar < 8; bar++) {
        if (kind === "walk" && bar >= 4) organRiff(bar, bar === 4 ? 0.85 : 1);
        if (kind === "chant") organChord(bar);
        if (kind === "riff" && !(bar === 7 && next.kind === "break")) organRiff(bar, pass === 1 ? 0.85 : 1, { upTo: bar === 7 ? 4 : 8 });
        if (kind === "outro" && bar < 7) organChord(bar);
      }

      // ================= the crowd: "oh" chant and "hey!" shouts =================
      let chT = K; // keep the crowd in a singable register
      const chant = bars(CHANT_OH, 0);
      const maxN = Math.max(...chant.map((n) => n.note));
      let upper = false;
      if (maxN + chT > 69) { chT -= 12; upper = true; }
      const ohNote = (m) => (upper ? [m, m + 12] : [m - 12, m]);
      const singChant = (from, to, shift, vel, harmony) => {
        chant.forEach((n) => {
          if (n.beat < from || n.beat >= to) return;
          const m = n.note + chT, at = n.beat + shift;
          let note = ohNote(m);
          if (harmony && n.dur >= 1.5) { // a third (or fourth) above on the long notes, from the chord
            const c = T.chord(symAt(at)), h = [3, 4, 5].map((i) => m + i).find((x) => c.pcs.includes(mod12(x)));
            if (h) note = note.concat([h]);
          }
          push("oh", at, n.dur * 0.95, note, (at % BPB === 0 ? 0.62 : 0.54) * vel);
        });
      };
      const heyAt = (abs, vel = 0.8, fifth = false) => { // fifth: over the bass's walk-up, shout the fifth
        const c = T.chord(symAt(abs));
        const m = T.nearest(62 + (upper ? -12 : 0), fifth ? [mod12(c.root + 7)] : [c.root, mod12(c.root + 7)], 55, 66);
        push("hey", abs, 0.3, [m - 12, m], vel);
      };
      if (kind === "chant") {
        singChant(0, 32, 0, pass === 1 ? 0.95 : 1.05, big);
        heyAt(3 * BPB + 3.5); heyAt(7 * BPB + 3, 0.75); heyAt(7 * BPB + 3.5, 0.85, true);
      }
      if (kind === "walk") { heyAt(3 * BPB + 3, 0.6); heyAt(3 * BPB + 3.5, 0.7); }
      if (kind === "break") {
        heyAt(1 * BPB + 3.5, 0.7); heyAt(3 * BPB + 3, 0.7); heyAt(3 * BPB + 3.5, 0.8);
        singChant(0, 16, 16, 1, false); // the crowd sings the first half alone
        heyAt(7 * BPB + 3.5, 0.9);
      }
      if (kind === "riff") {
        if (pass >= 2) { // choir "oh" pad
          for (let bar = 0; bar < 8; bar++) {
            if (bar === 7 && next.kind === "break") break;
            const sym = symAt(bar * BPB);
            const v = T.voice(sym, { lo: 55, hi: 72, n: 3, spread: "close", prev: state.ohV, top: [64, 71], rng: r, rootless: false });
            state.ohV = v;
            push("oh", bar * BPB, 3.9, v, 0.36);
          }
        }
        if (next.kind === "break") heyAt(7 * BPB + 3, 0.85); else heyAt(7 * BPB + 3.5, 0.8);
      }
      if (kind === "outro") {
        for (let bar = 0; bar < 7; bar++) {
          const v = T.voice(symAt(bar * BPB), { lo: 55, hi: 72, n: 3, spread: "close", prev: state.ohV, top: [64, 71], rng: r, rootless: false });
          state.ohV = v;
          push("oh", bar * BPB, 3.9, v, 0.34);
        }
        heyAt(7 * BPB + 3, 1);
      }

      // ================= brass =================
      const stabV = (sym) => { const v = T.voice(sym, { lo: 55, hi: 74, n: 4, spread: "close", prev: state.stabV, top: [66, 72], rng: r, rootless: false }); state.stabV = v; return v; };
      if (kind === "chant" && pass >= 2) { // answers in the gaps of the chant
        [[1, [2.5, 3, 3.5]], [3, [3, 3.5]], [5, [2.5, 3, 3.5]], [6, [3.5]]].forEach(([bar, beats]) => {
          const at0 = bar * BPB + beats[0], v = stabV(symAt(at0));
          beats.forEach((b, i) => push("stabs", bar * BPB + b, i === beats.length - 1 ? 0.45 : 0.22, v, i === beats.length - 1 ? 0.72 : 0.6));
        });
        if (big) for (let bar = 0; bar < 8; bar++) { // synth brass sustain under the finale chant
          const v = T.voice(symAt(bar * BPB), { lo: 52, hi: 69, n: 3, spread: "close", prev: state.padV, top: [62, 69], rng: r, rootless: false });
          state.padV = v;
          push("brass", bar * BPB, bar === 7 ? 2.9 : 3.9, v, 0.4);
        }
      }
      const hook = bars(HOOK, K);
      const hookOct = hook.some((n) => n.note > 88) ? -12 : 0;
      const brassOct = hook.some((n) => n.note + hookOct > 84) ? -12 : 0; // synth brass stay below C6
      if (kind === "riff") {
        const cut = next.kind === "break";
        if (pass === 1 || pass === 3) {
          hook.forEach((n) => { if (cut && n.beat >= 30) return; push("lead", n.beat, n.dur * 0.93, n.note + hookOct, n.beat % BPB === 0 ? 0.8 : 0.72); });
        }
        if (pass >= 2) { // the brass take the hook, in octaves
          hook.forEach((n) => { if (cut && n.beat >= 30) return; const m = n.note + hookOct + brassOct; push("brass", n.beat, n.dur * 0.93, [m - 12, m], n.beat % BPB === 0 ? 0.68 : 0.6); });
          if (pass === 2) hook.filter((n) => n.beat >= 16 && !(cut && n.beat >= 30)).forEach((n) => push("lead", n.beat, n.dur * 0.93, n.note + hookOct, 0.66)); // the lead joins for the second half
        }
        if (pass !== 2) { // stabs on the 3+3+2 under the lead
          for (let bar = 0; bar < 8; bar++) {
            if (cut && bar === 7) break;
            const v = stabV(symAt(bar * BPB));
            [0, 0.75, 1.5].forEach((b, i) => push("stabs", bar * BPB + b, 0.3, v, i === 0 ? 0.7 : 0.58));
          }
        }
        if (cut) { const v = stabV(symAt(28)); push("stabs", 30, 1, v, 0.85); push("brass", 30, 1.5, v.map((x) => x - 12), 0.7); }
      }
      if (kind === "chant" && big) { // descant
        bars(DESCANT, K).forEach((n) => push("lead", n.beat, n.dur * 0.96, n.note + hookOct, 0.6));
      }
      if (kind === "outro") {
        for (let bar = 0; bar < 7; bar++) {
          const v = T.voice(symAt(bar * BPB), { lo: 52, hi: 69, n: 3, spread: "close", prev: state.padV, top: [62, 69], rng: r, rootless: false });
          state.padV = v;
          push("brass", bar * BPB, 3.9, v, 0.36);
        }
        // the lead solo: the hook's opening, then a line developed from its motif, landing on the tonic
        const first = hook.filter((n) => n.beat < 4);
        const sym0 = symAt(0), c0 = T.chord(sym0);
        first.forEach((n) => { const m = T.nearest(n.note + hookOct, c0.scale.concat(c0.pcs)); push("lead", n.beat, n.dur * 0.93, m, 0.74); });
        if (!state.hookMotif) state.hookMotif = { len: 4, rhythm: [{ off: 0, dur: 0.75 }, { off: 0.75, dur: 0.75 }, { off: 1.5, dur: 0.5 }, { off: 2, dur: 1 }, { off: 3, dur: 1 }], steps: [0, 2, 2, 3, -1] };
        const solo = C.line({ start: 4, end: 26, chordAt: symAt, lo: 69 + (K > 3 ? 2 : 0), hi: 88, rng: r.fork(3), density: 0.5, phrase: [4, 7], rest: [0.5, 1.5], motif: state.hookMotif, motifProb: 0.5, chromatic: 0.05, scaleFor: (s) => T.scale(T.chord(s).root, "majorPent"), register: 0.6, prev: first[first.length - 1]?.note, upbeatStart: 0.4 });
        solo.notes.forEach((n) => push("lead", n.beat, n.dur, n.note, 0.6 + (n.vel - 0.6) * 1.2));
        const endN = T.nearest(solo.last ?? 76, [tonic], 69, 86);
        push("lead", 26, 2, endN, 0.78);
        // the stop hits
        const v = stabV(symAt(28));
        [0, 0.75, 1.5].forEach((b) => push("stabs", 28 + b, b === 1.5 ? 1.2 : 0.3, v, 0.85));
        [0, 0.75, 1.5].forEach((b) => push("brass", 28 + b, b === 1.5 ? 1.4 : 0.35, v.map((x) => x - 12), 0.7));
        push("lead", 29.5, 1.6, endN, 0.8);
      }

      const label = `${plan.label} · ${KEYNAME(K)}${plan.round > 0 ? ` · round ${plan.round + 1}` : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
