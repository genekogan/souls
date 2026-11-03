// Final Round: an early-90s arcade fighting-game stage theme (the CPS-1 / Mega Drive sound).
//
// The band: a slap bass ostinato with octave pops and dead-note ghosts (an FM "solid bass" takes over on
// alternate rounds), brass stabs and Fairlight orchestra hits on syncopated accents, palm-muted power-chord
// chugs that open up on the 3-3-2 accents, a string machine under the chorus and bridge, and a heroic mono
// lead with glide and late vibrato. In round 2 a distorted guitar takes the tune and the synth lead
// harmonizes it a third below in the chorus. The kit: 909 kick, fat rock snare through a gated room, hats
// with sixteenth ghosts and open-hat lifts, crashes on every arrival, tom and Simmons fills, cowbell
// in the pre-chorus and tambourine in the chorus.
//
// Harmony: C minor with i-VI-VII (Cm Ab Bb) and a harmonic-minor V (G, G7b9 with a diminished run);
// a pre-chorus whose VI-VII climb lands on a bright C major and slides a semitone to B7, so the chorus
// arrives in E minor, a chromatic mediant away; a half-time bridge in E minor's relative colours
// (Cmaj7 D6 Bm7 Em9) that swerves through Eb and F; a drums-and-bass build on VI-VII-V of the new key
// with an accelerando; then ROUND 2, everything a whole step up (a semitone in alternate matches) and a
// few BPM faster; and a K.O. tag that turns back through Ab-Bb-G7 to C minor for the next match.
//
// One match = 14 cycles of 8 bars (about 3 minutes): intro (FIGHT! hits, then the groove), A, A2, B
// (pre-chorus), C, C2 (chorus), half-time bridge, build, round 2 (A A2 B C C2), K.O.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;

  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`final-round: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`final-round: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    return out;
  }
  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SHARP_KEYS = [1, 4, 6, 8, 9, 11]; // minor keys spelled with sharps
  function transSym(sym, k, keyPc = 0) {
    if (!k) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const names = SHARP_KEYS.includes(mod12(keyPc)) ? SHARPS : T.NAMES;
    const tr = (n) => names[mod12(T.PC[n] + k)];
    return tr(m[1]) + m[2] + (m[3] ? "/" + tr(m[3]) : "");
  }

  // ---------- the score ----------
  // key: tonic pc of the section's (minor) key, for harmonies and bass approach notes
  const SEC = {
    INTRO: { key: 0, harm: "| Cm | Cm | Ab | Bb | Cm | Cm | Ab | Bb |",
      mel: "r/4 | r/4 | r/4 | r/4 | r/4 | r/4 | r/4 | r/2 Bb4/.25 C5/.25 D5/.25 Eb5/.25 F5/.25 G5/.25 F5/.25 D5/.25" },
    A: { key: 0, harm: "| Cm | Cm | Ab | Bb | Cm | Cm | Ab | Bb |",
      mel: [
        "C5/.75 G5/.75 F5/.5 Eb5/.75 F5/.75 G5/.5", //  the hook: 3-3-2 against the beat
        "G5/1.5 Bb5/.5 G5/.5 F5/.5 Eb5/.5 F5/.5",
        "Eb5/.75 C5/.75 Ab4/.5 C5/.75 Eb5/.75 Ab5/.5", // the same rhythm, down the VI chord and back
        "F5/1.5 D5/.5 Bb4/1 C5/.5 D5/.5",
        "C5/.75 G5/.75 F5/.5 Eb5/.75 F5/.75 G5/.5",
        "C6/1.5 Bb5/.5 G5/.5 Bb5/.5 C6/.5 D6/.5", //     the answer climbs an octave
        "Eb6/1.5 C6/.5 Ab5/1 Bb5/.5 C6/.5",
        "D6/1.5 C6/.25 Bb5/.25 F5/1 r/1",
      ].join(" | ") },
    A2: { key: 0, harm: "| Ab | Bb | Cm | Cm | Ab | Bb | G | G7b9 |",
      mel: [
        "C6/.75 Bb5/.75 Ab5/.5 Eb5/1 C5/1",
        "D5/.75 F5/.75 Bb5/.5 D6/1.5 C6/.5",
        "Eb6/.75 D6/.75 C6/.5 G5/1 Eb5/.5 F5/.5",
        "G5/3 r/1",
        "Ab5/.75 G5/.75 F5/.5 Eb5/.75 F5/.75 Ab5/.5",
        "Bb5/.75 F5/.75 D5/.5 F5/.75 Bb5/.75 D6/.5",
        "B5/1.5 G5/.5 D5/1 B4/1", //                       the harmonic-minor V
        "D5/.5 F5/.5 Ab5/.5 B5/.5 D6/1 r/1", //             a diminished run up the G7b9
      ].join(" | ") },
    B: { key: 0, harm: "| Ab | Bb | Ab | Bb | Ab | Bb | C | B7 |",
      mel: [
        "Eb4/.5 Ab4/.5 C5/1.5 Bb4/.5 Ab4/1", //            low and tense, a sequence that climbs
        "F4/.5 Bb4/.5 D5/1.5 C5/.5 Bb4/1",
        "Ab4/.5 C5/.5 Eb5/1.5 D5/.5 C5/1",
        "Bb4/.5 D5/.5 F5/1.5 Eb5/.5 D5/1",
        "C5/2 Eb5/2",
        "D5/2 F5/2",
        "E5/1.5 D5/.5 C5/1 G4/1", //                      C major, then a semitone slip
        "F#4/.5 A4/.5 B4/.5 D#5/.5 F#5/1 r/1", //         to B7: the chorus arrives in E minor
      ].join(" | ") },
    C: { key: 4, harm: "| Em | C | D | Em | Em | C | D | B7 |",
      mel: [
        "B4/.5 E5/.5 G5/.5 B5/1 A5/.5 G5/.5 F#5/.5",
        "G5/.5 E5/1 C6/1 B5/.5 G5/.5 E5/.5",
        "F#5/.5 D5/.5 A5/1.5 F#5/.5 D5/.5 E5/.5",
        "E5/2 B4/.5 E5/.5 G5/.5 A5/.5",
        "B5/.5 D6/.5 E6/1 B5/1 G5/.5 A5/.5",
        "G5/.5 C6/.5 E6/1 C6/1 G5/.5 A5/.5",
        "F#5/.5 A5/.5 D6/1.5 E6/.5 D6/1",
        "D#6/.5 B5/.5 F#5/.5 A5/.5 B5/1 r/1",
      ].join(" | ") },
    C2: { key: 4, harm: "| C | D | Bm | Em | C | D | B7 | Em |",
      mel: [
        "E6/1.5 D6/.5 C6/1 G5/1",
        "D6/1.5 C6/.5 A5/1 F#5/1",
        "B5/.5 D6/.5 F#5/.5 B5/.5 D6/1 B5/1",
        "E6/2 B5/1 G5/1",
        "E6/.5 C6/.5 G5/.5 E5/.5 G5/.5 C6/.5 E6/.5 C6/.5",
        "D6/.5 A5/.5 F#5/.5 D5/.5 F#5/.5 A5/.5 D6/.5 A5/.5",
        "B5/.5 F#5/.5 D#5/.5 F#5/.5 A5/.5 B5/.5 D#6/1",
        "E6/2 r/2",
      ].join(" | ") },
    BRIDGE: { key: 4, harm: "| Cmaj7 | D6 | Bm7 | Em9 | Cmaj7 | D | Eb | F |",
      mel: "B5/3 G5/1 | A5/2 F#5/1 B5/1 | D6/3 A5/1 | G5/2 F#5/2 | E6/3 D6/.5 C6/.5 | D6/2 A5/1 F#5/1 | G5/2 Bb5/2 | A5/2 C6/2" },
    BUILD: { key: 0, harm: "| Ab | Bb | Ab | Bb | Ab | Bb | G7 | G7 |", // transposed into the round-2 key
      mel: "r/4 | r/4 | r/4 | r/4 | r/4 | r/4 | r/4 | r/2 G4/.25 Ab4/.25 B4/.25 C5/.25 D5/.25 Eb5/.25 F5/.25 G5/.25" },
    KO: { key: 4, harm: "| C | D | Em | Em |", // the first half in the chorus key; the second half turns home
      harm2: "| Ab | Bb | G7 | G7 |",
      mel: "E5/1 G5/1 C6/2 | F#5/1 A5/1 D6/2 | G5/1 B5/1 E6/2 | E6/4", mel2: "Eb5/2 Ab5/2 | F5/2 Bb5/2 | B5/2 D6/2 | G5/2 r/2" },
  };
  for (const s of Object.values(SEC)) {
    s.notes = line(s.mel);
    if (s.mel2) s.notes2 = line(s.mel2);
  }

  // slap ostinatos: 16 sixteenths per bar. degree r root, o octave, 5 fifth, 3 third, d scale step below,
  // n approach into the next bar's root; articulation t thumb, p pop, g ghost, f finger; "-" holds, "." rests
  const RIFF = {
    main: "rt . op rg | rt rg op . | rt . op rg | rt op 5t nt",
    push: "rt . op . | rt . op rt | . rt op . | rt . op 3p",
    drive: "rt rg op rg | rt rg op rg | rt rg op rg | rt op 5p nt",
    half: "rf - - - | - - - - | op . rg rt | 5f - nt -",
  };
  const parseRiff = (s) => s.replace(/\|/g, " ").trim().split(/\s+/);
  for (const k of Object.keys(RIFF)) RIFF[k] = parseRiff(RIFF[k]);

  const MATCH = [
    { sec: "INTRO", label: "Intro · FIGHT!" },
    { sec: "A", label: "A" }, { sec: "A2", label: "A answer" }, { sec: "B", label: "pre-chorus · VI-VII-I, then B7" },
    { sec: "C", label: "chorus in E minor" }, { sec: "C2", label: "chorus" },
    { sec: "BRIDGE", label: "half-time bridge" }, { sec: "BUILD", label: "build · drums and bass", r2key: true },
    { sec: "A", label: "A", r2: true }, { sec: "A2", label: "A answer", r2: true }, { sec: "B", label: "pre-chorus", r2: true },
    { sec: "C", label: "chorus", r2: true }, { sec: "C2", label: "chorus", r2: true }, { sec: "KO", label: "K.O.", r2: true },
  ];
  const BPM1 = 150, BPM2 = 156;
  // band hits (orchestra, brass, bass, kick and crash together) in the intro and the K.O.
  const HITS = { INTRO: [[0, 0.75, 1.5], [0, 2.5], [0, 0.75, 1.5], [0]], KO: [[0, 0.75, 1.5, 3], [0, 0.75, 1.5, 3], [0, 0.75, 1.5, 3], [0]] };

  Sim.register({
    id: "final-round",
    title: "Final Round",
    genre: "Fighting game",
    about: "An early-90s arcade fighting-game stage in C minor: slap-bass octave ostinato, brass stabs and orchestra hits on the 3-3-2 accents, a hooky heroic lead, a chorus a chromatic mediant away in E minor, a half-time bridge and a ROUND 2 that goes up a step with a guitar lead in harmony.",
    situations: ["fight", "training"],
    energy: 0.95,
    bpm: BPM1, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 350, highcut: 7000 });
      const gated = I.gatedReverb(ctx, out, { decay: 1.6 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.22, highcut: 3200 });
      const lead = I.lead(ctx, { volume: 0, wave: "fatsawtooth", glide: 0.025, vibratoDepth: 0.1, vibratoDelay: 0.3, base: 900, octaves: 2.6 });
      const lead2 = I.lead(ctx, { volume: -6, wave: "fatsquare", glide: 0.02, vibratoDepth: 0.06, base: 700, octaves: 2.2 });
      const gtr = I.distGuitar(ctx, { volume: -1, drive: 0.8, cutoff: 3600 });
      const chug = I.distGuitar(ctx, { volume: -9, drive: 0.7, cutoff: 2600 });
      const brass = I.brassStab(ctx, { volume: -5 });
      const orch = I.orchHit(ctx, { volume: -6 });
      const pad = I.stringMachine(ctx, { volume: -13, cutoff: 2600 });
      const slap = I.slapBass(ctx, { volume: -3 });
      const fm = I.fmBass(ctx, { volume: -4, bite: 5 });
      const kit = I.kit(ctx, { volume: 2, preload: ["kick909", "rockSnare", "hatClosed", "hatOpen", "crash", "tom", "simmons"] });
      const lp = I.place(ctx, lead, 0.05, out), l2 = I.place(ctx, lead2, -0.25, out), gp = I.place(ctx, gtr, -0.12, out);
      const cp = I.place(ctx, chug, 0.4, out), bp = I.place(ctx, brass, 0.25, out), op = I.place(ctx, orch, -0.05, out);
      const pp = I.place(ctx, pad, -0.3, out);
      I.place(ctx, slap, 0, out); I.place(ctx, fm, 0, out);
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -14); I.send(ctx, lp, echo, -17); I.send(ctx, l2, hall, -15); I.send(ctx, gp, hall, -16); I.send(ctx, gp, echo, -19);
      I.send(ctx, bp, hall, -12); I.send(ctx, op, hall, -10); I.send(ctx, pp, hall, -10); I.send(ctx, cp, hall, -22);
      I.send(ctx, kp, gated, -12); I.send(ctx, kp, hall, -24);
      const tight = { timing: 0.003, vel: 0.05 };
      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: tight },
        gtr: { layer: "melody", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.05 } },
        lead2: { layer: "harmony", play: (t, e, d) => lead2.play(t, e.note, d, e.vel), humanize: tight },
        brass: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: tight },
        orch: { layer: "harmony", play: (t, e, d) => orch.play(t, e.note, d, e.vel), humanize: { timing: 0.001, vel: 0.02 } },
        chug: { layer: "harmony", play: (t, e, d) => chug.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.06 } },
        pad: { layer: "texture", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.03 } },
        bass: { layer: "bass", play: (t, e, d) => (e.fm ? fm.play(t, e.note, d, e.vel) : slap.play(t, e.note, d, e.vel, e.art || "thumb")), humanize: { timing: 0.003, vel: 0.06 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.p, dur: e.len }), humanize: { timing: 0.003, vel: 0.08 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const m = Math.floor(cycle / MATCH.length), idx = cycle % MATCH.length;
      const S = MATCH[idx];
      const odd = m % 2 === 1;
      const up = odd ? 1 : 2; // round 2: up a step (a semitone in alternate matches)
      const sec = SEC[S.sec];
      const shift = S.r2 || S.r2key ? up : 0;
      const round2 = !!S.r2;
      // harmony (the K.O. turns home halfway through)
      let prog = T.progression(sec.harm, BPB).map((h) => ({ ...h, chord: transSym(h.chord, shift, sec.key + shift) }));
      if (sec.harm2) prog = prog.concat(T.progression(sec.harm2, BPB).map((h) => ({ ...h, bar: h.bar + 4 })));
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(Math.max(0, Math.min(31.99, b))).chord;
      const keyPc = mod12(sec.key + shift);
      const keyAt = (b) => (S.sec === "KO" && b >= 16 ? 0 : keyPc);
      const scaleAt = (b) => { const c = T.chord(symAt(b)); return c.kind === "dominant" || (c.kind === "major" && mod12(c.root - keyAt(b)) === 7) ? T.scale(keyAt(b), "harmonicMinor") : T.scale(keyAt(b), "aeolian"); };
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const slapRound = round2 ? odd : !odd; // slap in round 1, FM in round 2 (swapped in alternate matches)
      const sid = S.sec;

      // ================= the tune =================
      let tune = sec.notes.map((n) => ({ ...n, note: n.note + shift }));
      if (sec.notes2) tune = tune.concat(sec.notes2.map((n) => ({ ...n, beat: n.beat + 16 })));
      const onBeat = (b) => Math.abs(b - Math.round(b)) < 1e-6;
      const leadTrack = round2 ? "gtr" : "lead";
      tune.forEach((n, i) => {
        const nx = tune[i + 1];
        const legato = nx && Math.abs(nx.beat - (n.beat + n.dur)) < 1e-6;
        let vel = 0.7 + (onBeat(n.beat) ? 0.04 : 0) + (n.dur === 0.75 ? 0.06 : 0) + (n.dur >= 2 ? 0.04 : 0);
        if (sid === "B" && n.beat < 16) vel -= 0.06;
        const dur = n.dur * (n.dur <= 0.5 ? (legato ? 0.9 : 0.7) : 0.95);
        // a grace slide (a scale step below) into long notes that arrive by leap, in round 2's guitar
        const prev = tune[i - 1];
        if (round2 && n.dur >= 1.5 && prev && Math.abs(n.note - prev.note) >= 3 && r.chance(0.5)) {
          push(leadTrack, n.beat, 0.12, T.step(n.note, -1, scaleAt(n.beat)), vel - 0.1);
          push(leadTrack, n.beat + 0.125, dur - 0.125, n.note, vel);
        } else push(leadTrack, n.beat, dur, n.note, vel);
        // round 2 chorus: the synth lead harmonizes a third below; elsewhere in round 2 it doubles an octave up on long notes
        if (round2 && (sid === "C" || sid === "C2")) {
          // twin lead: the next chord tone below a chord tone, a diatonic third below a passing note
          const c = T.chord(symAt(n.beat));
          const h = c.pcs.includes(mod12(n.note)) ? T.step(n.note, -1, c.pcs.slice(0, 3)) : T.step(n.note, -2, scaleAt(n.beat));
          push("lead2", n.beat, dur, h, vel * 0.85);
        } else if (round2 && sid !== "KO" && n.dur >= 1.5 && n.note + 12 <= 90) {
          push("lead2", n.beat, dur, n.note + 12, 0.45);
        }
      });
      if (sid === "KO") push("lead2", 12, 3.8, 76 + shift, 0.5); // the held victory note, doubled

      // ================= bass ostinato =================
      const riffName = sid === "INTRO" ? "intro" : sid === "BRIDGE" ? "half" : sid === "C" || sid === "C2" ? "drive" : sid === "B" ? "push" : sid === "KO" ? "hits" : "main";
      // the next section's first chord, so the last bar's approach note leads into it
      const NS = MATCH[(idx + 1) % MATCH.length], nsShift = NS.r2 || NS.r2key ? up : 0;
      const nextFirst = transSym(T.progression(SEC[NS.sec].harm, BPB)[0].chord, nsShift, SEC[NS.sec].key + nsShift);
      const lowOf = (b) => { const c = T.chord(b >= 32 - 1e-6 ? nextFirst : symAt(b)); return T.nearest(38, [c.bass], 33, 44); };
      for (let bar = 0; bar < 8; bar++) {
        let rf = RIFF[riffName] || RIFF.main;
        if (HITS[sid] && bar < 4) { // on the band hits the bass hits too: root, root, octave pop
          const hs = HITS[sid][bar];
          hs.forEach((b, i) => {
            const at = bar * BPB + b, low = lowOf(at), pop = i === 2;
            const len = i + 1 < hs.length ? hs[i + 1] - b : bar === 3 ? 1.9 : 0.7;
            if (slapRound) push("bass", at, pop ? 0.22 : Math.min(0.7, len * 0.85), pop ? low + 12 : low, pop ? 0.85 : 0.9, { art: pop ? "pop" : "thumb" });
            else push("bass", at, Math.min(1.9, len * 0.85), pop ? low + 12 : low, 0.9, { fm: true });
          });
          continue;
        }
        if (sid === "INTRO") rf = RIFF.main;
        if (sid === "KO" && bar >= 4) rf = RIFF.drive;
        if (sid === "A2" && bar === 7) rf = RIFF.push;
        // the fill bar of a section: the ostinato drops out under the drum fill
        const fillBar = bar === 7 && ["A", "A2", "C", "B"].includes(sid) && !(sid === "A2" && round2);
        for (let s = 0; s < 16; s++) {
          const tok = rf[s];
          if (tok === "." || tok === "-") continue;
          if (fillBar && s >= 8 && sid !== "B") break;
          const at = bar * BPB + s / 4;
          const c = T.chord(symAt(at));
          const low = lowOf(at);
          const deg = tok[0], art = { t: "thumb", p: "pop", g: "ghost", f: "finger" }[tok[1]] || "thumb";
          const fifth = low + mod12(c.root + (c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7) - c.bass);
          const third = low + mod12(c.root + (c.intervals.find((i) => i === 3 || i === 4) ?? 5) - c.bass);
          let note;
          if (deg === "r") note = low;
          else if (deg === "o") note = low + 12;
          else if (deg === "5") note = fifth;
          else if (deg === "3") note = third + 12;
          else if (deg === "d") note = T.step(low, -1, scaleAt(at));
          else { // n: approach the next bar's root from a step below (or a semitone, if the scale step is far)
            const nextLow = lowOf((bar + 1) * BPB);
            const below = T.step(nextLow, -1, scaleAt(at));
            note = nextLow === low ? T.step(low, -1, scaleAt(at)) : nextLow - below <= 2 ? below : nextLow - 1;
            if (note === fifth) note = nextLow - 1 === fifth ? nextLow + 1 : nextLow - 1; // never restate the fifth
          }
          // duration: up to the next onset (holds extend), shorter for pops and ghosts
          let len = 0.25;
          for (let j = s + 1; j < 16 && rf[j] === "-"; j++) len += 0.25;
          const dur = art === "ghost" ? 0.06 : art === "pop" ? Math.min(len, 0.22) : Math.max(0.2, len * 0.85);
          const vel = art === "ghost" ? 0.5 : art === "pop" ? 0.82 : s % 4 === 0 ? 0.88 : 0.78;
          if (slapRound) push("bass", at, dur, note, vel, { art });
          else if (art !== "ghost") push("bass", at, art === "pop" ? 0.2 : dur, note, vel * 0.95, { fm: true });
        }
        if (fillBar && sid !== "B") push("bass", bar * BPB + 2, 0.3, lowOf(bar * BPB), 0.85, slapRound ? { art: "thumb" } : { fm: true });
      }

      // ================= stabs, hits, chugs, pad =================
      let brassVoice = state.brassVoice || null;
      const stab = (abs, dur, vel = 0.72, track = "brass") => {
        const sym = symAt(abs);
        if (track === "orch") { push("orch", abs, Math.min(dur, 0.4), T.voice(sym, { lo: 55, hi: 72, n: 3, rootless: false, spread: "close" }), vel); return; }
        const v = T.voice(sym, { lo: 60, hi: 81, n: 3, prev: brassVoice, top: [72, 81], rootless: false, spread: "close" });
        brassVoice = v;
        push("brass", abs, dur, v, vel);
      };
      const hits332 = (bar, track, vel) => [0, 0.75, 1.5].forEach((b, i) => stab(bar * BPB + b, i === 2 ? 0.45 : 0.3, vel + (i === 2 ? 0.05 : 0), track));
      const B_ = (bar, beat) => bar * BPB + beat;
      if (sid === "INTRO") {
        // FIGHT!: four bars of hits with the whole band, then the groove
        [[0, 0], [0, 0.75], [0, 1.5], [1, 0], [1, 2.5], [2, 0], [2, 0.75], [2, 1.5], [3, 0]].forEach(([bar, b]) => { stab(B_(bar, b), 0.35, 0.85, "orch"); stab(B_(bar, b), 0.3, 0.75); });
        hits332(4, "brass", 0.62); hits332(6, "brass", 0.66);
        stab(B_(5, 2.5), 0.3, 0.6); stab(B_(5, 3.5), 0.3, 0.64);
      } else if (sid === "A") {
        [[1, 2.5], [1, 3.5], [3, 1.5], [3, 3], [5, 2.5], [5, 3.5]].forEach(([bar, b]) => stab(B_(bar, b), 0.28, 0.62));
        stab(B_(7, 3), 0.3, 0.7); stab(B_(7, 3.5), 0.4, 0.76);
        stab(0, 0.4, 0.8, "orch");
      } else if (sid === "A2") {
        [[0, 3.5], [1, 2.5], [4, 3.5], [5, 2.5]].forEach(([bar, b]) => stab(B_(bar, b), 0.28, 0.62));
        hits332(6, "brass", 0.72); hits332(6, "orch", 0.72);
        stab(B_(7, 3), 0.3, 0.72); stab(B_(7, 3.5), 0.45, 0.78);
      } else if (sid === "B") {
        for (let bar = 0; bar < 4; bar++) { stab(B_(bar, 0), 0.9, 0.6); stab(B_(bar, 3.5), 0.3, 0.58); }
        hits332(4, "brass", 0.72); hits332(4, "orch", 0.75); stab(B_(4, 3), 0.3, 0.66);
        hits332(5, "brass", 0.74); hits332(5, "orch", 0.78); stab(B_(5, 3), 0.3, 0.68);
        stab(B_(6, 0), 1, 0.78); stab(B_(6, 0), 0.4, 0.82, "orch"); stab(B_(6, 1.5), 0.3, 0.7); stab(B_(6, 3), 0.3, 0.72);
        hits332(7, "brass", 0.8); stab(B_(7, 0), 0.4, 0.85, "orch");
      } else if (sid === "C" || sid === "C2") {
        stab(0, 0.4, 0.88, "orch"); stab(B_(4, 0), 0.4, 0.8, "orch");
        for (const bar of [0, 2, 4, 6]) stab(B_(bar, 0), 0.5, 0.7);
        for (const bar of [1, 3, 5]) { stab(B_(bar, 2.5), 0.28, 0.64); stab(B_(bar, 3), 0.4, 0.68); }
        if (sid === "C") { stab(B_(7, 2), 0.3, 0.7); stab(B_(7, 2.75), 0.3, 0.72); stab(B_(7, 3.5), 0.4, 0.78); }
        else { hits332(7, "orch", 0.9); hits332(7, "brass", 0.82); }
      } else if (sid === "BRIDGE") {
        stab(B_(6, 0), 0.4, 0.78, "orch"); stab(B_(7, 0), 0.4, 0.8, "orch");
        stab(B_(6, 0), 1.5, 0.6); stab(B_(7, 0), 1.5, 0.64); stab(B_(7, 2.5), 0.3, 0.66); stab(B_(7, 3.5), 0.4, 0.7);
      } else if (sid === "BUILD") {
        hits332(4, "brass", 0.6); hits332(5, "brass", 0.68);
        hits332(6, "orch", 0.82); hits332(6, "brass", 0.76); stab(B_(6, 3), 0.3, 0.74); stab(B_(6, 3.5), 0.3, 0.78);
        [0, 0.75, 1.5].forEach((b) => stab(B_(7, b), 0.3, 0.9, "orch"));
      } else if (sid === "KO") {
        for (let bar = 0; bar < 3; bar++) { hits332(bar, "orch", 0.85); hits332(bar, "brass", 0.75); stab(B_(bar, 3), 0.4, 0.78); stab(B_(bar, 3), 0.4, 0.8, "orch"); }
        stab(B_(3, 0), 2, 0.7); stab(B_(3, 0), 0.4, 0.9, "orch");
        for (const bar of [4, 5]) { stab(B_(bar, 0), 1.2, 0.68); stab(B_(bar, 1.5), 0.3, 0.64); stab(B_(bar, 2.5), 0.3, 0.66); }
        hits332(6, "orch", 0.85); hits332(6, "brass", 0.8); stab(B_(7, 0), 0.4, 0.88, "orch"); stab(B_(7, 0), 1.5, 0.7);
      }
      state.brassVoice = brassVoice;

      // power-chord guitar: palm-muted eighths, opened up on the 3-3-2 accents (beats 0, 1.5, 3)
      const chugOn = { INTRO: [4, 8], A: round2 ? [0, 8] : [4, 8], A2: [0, 8], B: [6, 8], C: [0, 8], C2: [0, 8], BUILD: [4, 8], KO: [4, 8] }[sid];
      const power = (b) => { const c = T.chord(symAt(b)); const rt = T.nearest(45, [c.bass], 40, 51); return [rt, rt + 7, rt + 12]; };
      if (chugOn) for (let bar = chugOn[0]; bar < chugOn[1]; bar++) {
        const fill = bar === 7 && ["A", "C", "B"].includes(sid);
        for (let e8 = 0; e8 < 8; e8++) {
          const b = e8 / 2, at = bar * BPB + b;
          if (fill && b >= 2) break;
          const accent = b === 0 || b === 1.5 || b === 3;
          push("chug", at, accent ? 0.45 : 0.16, power(at), accent ? 0.72 : 0.4);
        }
      }
      if (sid === "B") for (let bar = 0; bar < 6; bar++) push("chug", bar * BPB, 3.6, power(bar * BPB), 0.5); // ringing chords under the climb

      // string machine under the chorus, the bridge and the K.O.
      if (["C", "C2", "BRIDGE", "KO"].includes(sid)) {
        let pv = state.padVoice || null;
        prog.forEach((h) => {
          let v = T.voice(h.chord, { lo: 55, hi: 76, n: 4, prev: pv, top: [67, 76] });
          const rub = (x) => x.some((q, i) => i && q - x[i - 1] <= 1);
          if (rub(v)) { const w = T.voice(h.chord, { lo: 50, hi: 79, n: 4, prev: pv, top: [67, 79], spread: "drop2" }); if (!rub(w)) v = w; }
          pv = v;
          push("pad", h.bar * BPB + h.beat, h.dur - 0.1, v, sid === "BRIDGE" ? 0.55 : 0.42);
        });
        state.padVoice = pv;
      }

      // ================= drums =================
      const K = (abs, v = 0.9) => push("drums", abs, 0.1, "kick909", v);
      const D = (abs, voice, v, extra) => push("drums", abs, 0.1, voice, v, extra);
      for (let bar = 0; bar < 8; bar++) {
        const B0 = bar * BPB;
        let style = HITS[sid] && bar < 4 ? "hits" : { INTRO: "rock", A: "rock", A2: "rock", B: "rock", C: "chorus", C2: "chorus", BRIDGE: "half", BUILD: "build", KO: "chorus" }[sid];
        const lastBar = bar === 7;
        const fill = lastBar && sid !== "BUILD" && sid !== "INTRO" ? (round2 || r.chance(0.5) ? "simmons" : "toms") : null;
        const arrive = bar === 0 && sid !== "INTRO" || (sid === "INTRO" && bar === 4) || (sid === "KO" && bar === 4) || (sid === "C" || sid === "C2") && bar === 4;
        if (arrive) { D(B0, "crash", 0.85); }
        if (style === "hits") {
          // intro hits: kick + crash in unison with the orchestra, snare pickups between them
          const hitsAt = HITS[sid][bar];
          hitsAt.forEach((b) => { K(B0 + b, 0.95); if (!(arrive && b === 0)) D(B0 + b, "crash", b === 0 ? 0.85 : 0.7); });
          if (sid === "KO" && bar < 3) { [2.25, 2.5, 2.75].forEach((b, i) => D(B0 + b, "rockSnare", 0.5 + i * 0.12)); D(B0 + 3.5, "hatOpen", 0.5); }
          else if (bar === 1) [3, 3.25, 3.5, 3.75].forEach((b, i) => D(B0 + b, "rockSnare", 0.5 + i * 0.1));
          if (bar === 3) [[1, 52], [1.5, 50], [2, 47], [2.5, 45], [3, 43], [3.25, 41], [3.5, 40], [3.75, 38]].forEach(([b, p], i) => D(B0 + b, i % 2 ? "simmons" : "tom", 0.62 + i * 0.04, { p: p + (i % 2 ? 7 : 0) }));
          if (sid === "INTRO" && (bar === 0 || bar === 2)) [2.5, 3, 3.5].forEach((b, i) => D(B0 + b, "rockSnare", 0.42 + i * 0.12));
          continue;
        }
        const fillFrom = fill ? 2 : 4;
        for (let s = 0; s < 16; s++) {
          const b = s / 4, at = B0 + b;
          if (b >= fillFrom) break;
          const eighth = s % 2 === 0;
          if (style === "half") {
            if (s === 0 || s === 10) K(at, s === 0 ? 0.9 : 0.75);
            if (s === 8) { D(at, "rockSnare", 0.85); D(at, "clap", 0.5); }
            if (eighth) D(at, "ride", s % 4 === 0 ? 0.55 : 0.42);
            if (s === 14 && bar % 2 === 1) D(at, "rockSnare", 0.22);
            continue;
          }
          if (style === "build") {
            if (s % 4 === 0 && bar < 7) K(at, 0.88);
            if (bar < 4) { D(at, "hatClosed", eighth ? 0.5 : 0.3); if (s === 12 && bar % 2 === 1) D(at, "simmons", 0.5, { p: 52 }); }
            else if (bar < 6) { if (eighth) D(at, "rockSnare", 0.3 + (bar - 4) * 0.2 + s * 0.012); D(at, "hatClosed", 0.32); }
            else if (bar === 6) D(at, "rockSnare", 0.4 + s * 0.035);
            else if (s < 8) { if (s % 4 === 0 || s === 3 || s === 6) K(at, 0.95); D(at, "rockSnare", 0.75 + s * 0.02); }
            else { const p = [57, 55, 52, 50, 47, 45, 43, 40][s - 8]; D(at, "simmons", 0.7 + (s - 8) * 0.03, { p }); if (s % 4 === 0) K(at, 0.8); }
            continue;
          }
          // rock / chorus
          const chorus = style === "chorus";
          const kicks = chorus ? [0, 6, 8, 11] : (bar % 2 === 0 ? [0, 6, 8] : [0, 3, 8, 10]);
          if (kicks.includes(s)) K(at, s === 0 ? 0.95 : 0.82);
          if (s === 4 || s === 12) D(at, "rockSnare", 0.86);
          else if ((s === 7 || s === 15) && r.chance(chorus ? 0.25 : 0.35)) D(at, "rockSnare", 0.2);
          if (s === 14 && (chorus || bar % 2 === 1)) D(at, "hatOpen", 0.5);
          else if (!(arrive && s === 0)) D(at, "hatClosed", eighth ? (s % 4 === 0 ? 0.55 : 0.48) : 0.24);
          // auxiliary layer: cowbell quarters in the pre-chorus, tambourine in the chorus and round 2
          if (sid === "B" && s % 4 === 0 && bar < 6) D(at, "cowbell", s === 0 ? 0.5 : 0.38);
          if (chorus && (s === 4 || s === 12)) D(at, "tambourine", 0.6);
          else if (chorus && !eighth) D(at, "tambourine", 0.28);
          if (round2 && !chorus && sid !== "B" && (s === 2 || s === 6 || s === 10 || s === 14)) D(at, "tambourine", 0.36);
        }
        if (fill) {
          D(B0 + 2, "rockSnare", 0.8); K(B0 + 2, 0.85);
          const pitches = fill === "toms" ? [52, 52, 48, 48, 45, 45, 41, 40] : [59, 57, 55, 52, 50, 47, 45, 43];
          pitches.forEach((p, i) => {
            const at = B0 + 2 + i * 0.25;
            if (i === 0) return;
            D(at, fill === "toms" ? "tom" : "simmons", 0.66 + i * 0.04, { p });
            if (i % 2 === 0) K(at, 0.7);
          });
        }
      }

      // ================= label, tempo =================
      const who = round2 ? "guitar lead" : "synth lead";
      let label = `Match ${m + 1} · ${round2 ? "ROUND 2 · " : sid === "KO" ? "" : "Round 1 · "}${S.label}`;
      if (["A", "A2", "B", "C", "C2", "BRIDGE"].includes(sid)) label += ` · ${who}${round2 && (sid === "C" || sid === "C2") ? " + harmony a third below" : ""}`;
      if (round2 && sid === "A") label += ` · up ${up === 2 ? "a whole step" : "a semitone"}`;
      label += slapRound ? " · slap bass" : " · FM bass";
      const res = { events: ev, harmony: prog, section: label, state };
      if (idx === 0) res.tempo = { bpm: BPM1, rampBeats: 0 };
      if (sid === "BUILD") res.tempo = { bpm: BPM2, rampBeats: 32 }; // the build pushes the tempo into round 2
      if (sid === "KO") res.tempo = { bpm: BPM1, rampBeats: 16 }; // and the K.O. settles it back
      return res;
    },
  });
})();
