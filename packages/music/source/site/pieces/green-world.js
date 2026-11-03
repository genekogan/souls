// Green World: an instrumental from an imaginary art-pop record of the mid-seventies, after the song-era Eno
// of Another Green World and Before and After Science. A cheap rhythm box, a fretless bass that sings,
// treated guitar, an organ drone and small odd synthesizer figures, at 100 BPM in D.
//
// Rhythm box: four "presets" (a pop beat, a bossa, a beguine, a slow rock) written as 16-step patterns for
// rim, soft kick, 808 hat, woodblock, conga and shaker. The box mutates as it runs, as if someone were
// idly pressing buttons: a ghost note appears, the woodblock slips a sixteenth, an accent moves. Every
// few mutations the oldest is undone, and a section change presses a new preset. Fills on the congas and
// woodblock mark the ends of sections; an open hat and a kick mark arrivals.
//
// Harmony: I-bVII-IV over a D pedal (Dadd9, C6/9 over D, Gmaj7 over D) with the organ holding D and A
// underneath; the A section's last bar is Ebmaj7#11, a half-step slide back home (D and A are tones of
// every chord in the section, so the drone never moves). The B section turns to G and A, then slides
// Bbmaj7#11 - C6/9 (bVI-bVII) back towards D. After a percussion-only interlude the band reappears a
// major third lower (Bb) or a minor third higher (F), and slides back into D from there.
//
// The motif: an eight-bar tune, first on a little square-wave synth. It returns in the new key on
// vibraphone, then back home on a sustained, gliding "treated guitar" lead; the colours rotate each round.
// Oblique form: the second B removes something (the box, the bass, or the guitar and organ), and the coda
// adds something strange (the motif upside down on a thin pulse wave, a frequency-shifted kalimba, or
// the box dropping out for four bars).
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, CB = 8 * BPB;
  const mod12 = T.mod12;

  // ---------- harmony (D-relative; C sections are transposed) ----------
  const PROG_TEXT = {
    intro: "| Dadd9 | C69/D | Gmaj7/D | Dadd9 | Dadd9 | C69/D | Gmaj7/D | Ebmaj7#11 |",
    A: "| Dadd9 | C69/D | Gmaj7/D | Dadd9 | Bm9 | Gmaj9 | Em9 | Ebmaj7#11 |",
    B: "| Gmaj9 | A6 | F#m7 | Bm9 | Gmaj9 | A9sus4 | Bbmaj7#11 | C69 |",
    C1: "| Dadd9 | C69/D | Gmaj7/D | Dadd9 | Bm9 | Gmaj9 | Em9 | A9sus4 |",
    C2: "| Dadd9 | C69/D | Gmaj7/D | Dadd9 | Bm9 | Gmaj9 | Cmaj9 | Gmaj7#11 |",
    perc: "| Dadd9 | % | % | % | % | % | % | % |",
  };
  const NAMES = T.NAMES;
  function trSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const n = (x) => NAMES[mod12(T.PC[x] + k)];
    return n(m[1]) + m[2] + (m[3] ? "/" + n(m[3]) : "");
  }
  const progFor = (name, k = 0) => T.progression(PROG_TEXT[name], BPB).map((h) => ({ ...h, chord: trSym(h.chord, k) }));

  // ---------- melody notation: one string per bar, "note/beats", r = rest ----------
  function bars(list) {
    const out = [];
    list.forEach((s, i) => {
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const [n, d] = tok.split("/");
        const dur = Number(d);
        if (!(dur > 0)) throw new Error(`green-world: bad duration in "${tok}"`);
        if (n !== "r") out.push({ beat: i * BPB + b, dur, note: T.midi(n) });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`green-world: bar sums to ${b}: ${s}`);
    });
    return out;
  }
  // The motif. Bars 1-4 over the pedal: a little upward flick to A, the bVII answer falling to D, then the
  // IV arpeggio that lands on A. Bars 5-8 sing down from F# and step through the #11 of the Eb slide.
  const MOTIF = bars([
    "E5/0.75 F#5/0.25 A5/0.5 F#5/0.5 E5/1 r/1",
    "G5/0.75 E5/0.25 D5/0.5 C5/0.5 D5/1.5 r/0.5",
    "B4/0.5 D5/0.5 F#5/0.5 E5/0.5 D5/1 B4/1",
    "A4/2.5 r/1.5",
    "F#5/1 E5/0.5 D5/0.5 C#5/1 D5/1",
    "B4/1.5 A4/0.5 B4/1 D5/1",
    "F#5/0.75 G5/0.25 F#5/0.5 E5/0.5 B4/2",
    "Bb4/1 A4/1 G4/2",
  ]);
  // C2's own last two bars (D-relative over Cmaj9 | Gmaj7#11)
  const C2_TAIL = bars(["G5/1.5 E5/0.5 D5/1 B4/1", "C#5/1 D5/1 B4/2"]).map((n) => ({ ...n, beat: n.beat + 6 * BPB }));

  // ---------- rhythm box presets: 16 steps; X accent, x normal, o ghost ----------
  const PRESETS = [
    { name: "pop", v: {
      softKick: "X.....x.X.......", rim: "....X.......X..o", hat808: "X.x.X.x.X.x.X.x.",
      shaker: "o.xoo.xoo.xoo.xo", woodblock: "................", conga: "...........x.x.." } },
    { name: "bossa", v: {
      softKick: "X..xX..xX..xX..x", rim: "x..x..x...x..x..", hat808: "x.x.x.x.x.x.x.x.",
      shaker: "xoxoxoxoxoxoxoxo", woodblock: "................", conga: "......x.......x." } },
    { name: "beguine", v: {
      softKick: "X.......X.......", rim: "...........x....", hat808: "..x...x...x...x.",
      shaker: "x.o.x.o.x.o.x.o.", woodblock: "x..x..x...x.x...", conga: "....X.xx....X.x." } },
    { name: "slow rock", v: {
      softKick: "X.........X.x...", rim: "........X.......", hat808: "x.x.x.x.x.x.x.x.",
      shaker: "..x...x...x...x.", woodblock: "...............x", conga: "..............o." } },
  ];
  const VEL = { X: 0.85, x: 0.62, o: 0.34 };
  const BOX_VOICES = ["softKick", "rim", "hat808", "shaker", "woodblock", "conga"];
  const BOX_LEVEL = { softKick: 0.95, rim: 0.7, hat808: 0.55, shaker: 0.5, woodblock: 0.6, conga: 0.75 };

  // ---------- form ----------
  // One round: (intro) A1 A2 B1 B2 perc C1 C2 A3 A4. Rounds after the first start at A1.
  const FORM = ["intro", "A1", "A2", "B1", "B2", "perc", "C1", "C2", "A3", "A4"];
  const REMOVE = ["box", "bass", "comp"];         // B2: what goes missing
  const ADD = ["invert", "stranger", "hole"];     // A4: what strange thing arrives
  const COLOURS = ["synth", "vibes", "lead"];      // motif colours for A1/A2, C2, A3 (rotated each round)

  /**
   * A passing note into the next chord's bass `tgt` from root R of chord c: a step or half-step away from the
   * target that sits well against what is sounding (a chord tone, or a scale tone with no chord tone a
   * semitone away), so it never rubs against the organ or the guitar.
   */
  /** Chord tones plus the scale tones that have no chord tone a semitone away (the notes that never rub). */
  const safeScale = (c) => c.scale.filter((p) => c.pcs.includes(p) || !c.pcs.some((q) => mod12(p - q) === 1 || mod12(q - p) === 1));
  function approach(c, tgt, R) {
    const dir = tgt > R ? -1 : 1;
    const safe = safeScale(c);
    const ok = (m) => safe.includes(mod12(m));
    for (const d of [1, 2, -1, -2]) { const m = tgt + dir * d; if (m !== R && ok(m)) return m; }
    return T.nearest(R + 7, c.pcs, 33, 55);
  }

  Sim.register({
    id: "green-world",
    title: "Green World",
    genre: "Art pop instrumental",
    about: "A mid-seventies art-pop instrumental in D: a mutating rhythm box, a singing fretless bass, treated guitar and an organ drone under I-bVII-IV and half-step slides, with a motif that comes back in new colours, sections that suddenly lose an element or gain a strange one, and a percussion-only interlude before a jump to a new key.",
    bpm: 100, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["hangout", "explore"],
    energy: 0.45,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 250, highcut: 7000 });
      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 300, highcut: 6000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.38, highcut: 3000, pingPong: true });
      const longEcho = I.delay(ctx, hall, { time: "4n", feedback: 0.45, highcut: 2400 });

      const kit = I.kit(ctx, { volume: -1, kickNote: 36, preload: ["softKick", "rim", "hat808", "shaker", "woodblock", "conga", "congaLow", "hat808Open"] });
      const bass = I.ebass(ctx, { volume: -3, fretless: true, base: 120 });
      const guitar = I.guitar(ctx, { kind: "clean", chorus: true, volume: -8 });
      const organ = I.organ(ctx, { volume: -11, partials: [1, 0.5, 0.3, 0.12, 0, 0.06] });
      const swell = I.pad(ctx, { volume: -12, wave: "fatsawtooth", cutoff: 1500, attack: 1.5, release: 0.25, detune: 14 });
      const synth = I.analog(ctx, { volume: -5, wave: "square", resonance: 3, base: 700, octaves: 2.2, decay: 0.3, sustain: 0.35, release: 0.15, glide: 0.015 });
      const vibes = I.vibes(ctx, { volume: -2, decay: 2.6, motor: 4.2 });
      const lead = I.lead(ctx, { volume: -8, wave: "fatsawtooth", glide: 0.07, attack: 0.04, sustain: 0.8, base: 500, octaves: 2.2, vibratoDepth: 0.05, vibratoDelay: 0.5, release: 0.4 });
      const blip = I.pulse(ctx, { volume: -15, width: 0.75, decay: 0.08, sustain: 0.3, release: 0.05 });
      const stranger = I.kalimba(ctx, { volume: -7, decay: 2 });
      const shift = ctx.keep(new Tone.FrequencyShifter({ frequency: 7, wet: 0.55 }));
      stranger.out.connect(shift);

      const kp = I.place(ctx, kit, 0, out); I.send(ctx, kp, room, -15);
      I.place(ctx, bass, 0, out); I.send(ctx, bass.out, room, -22);
      const gp = I.place(ctx, guitar, -0.35, out); I.send(ctx, gp, echo, -7); I.send(ctx, gp, hall, -13);
      const op = I.place(ctx, organ, 0.15, out); I.send(ctx, op, hall, -14);
      const wp = I.place(ctx, swell, 0.3, out); I.send(ctx, wp, hall, -8);
      const sp = I.place(ctx, synth, 0.25, out); I.send(ctx, sp, echo, -10); I.send(ctx, sp, room, -12);
      const vp = I.place(ctx, vibes, 0.3, out); I.send(ctx, vp, room, -9); I.send(ctx, vp, echo, -16);
      const lp = I.place(ctx, lead, -0.1, out); I.send(ctx, lp, hall, -7); I.send(ctx, lp, longEcho, -11);
      const bp = I.place(ctx, blip, 0.55, out); I.send(ctx, bp, echo, -5);
      const xp = ctx.keep(new Tone.Panner(-0.5)); shift.connect(xp); xp.connect(out); I.send(ctx, xp, hall, -6); I.send(ctx, xp, longEcho, -10);

      const box = (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.hold });
      return {
        box: { layer: "drums", play: box, humanize: { timing: 0.002, vel: 0.04 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.06 } },
        guitar: { layer: "harmony", play: (t, e, d) => guitar.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.006 } },
        organ: { layer: "harmony", play: (t, e, d) => organ.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        swell: { layer: "harmony", play: (t, e, d) => swell.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        synth: { layer: "melody", play: (t, e, d) => synth.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        vibes: { layer: "melody", play: (t, e, d) => vibes.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
        blip: { layer: "texture", play: (t, e, d) => blip.play(t, e.note, d, e.vel), humanize: { timing: 0.003 } },
        stranger: { layer: "texture", play: (t, e, d) => stranger.play(t, e.note, d, e.vel), humanize: { timing: 0.01 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      // ---------- where are we ----------
      if (cycle === 0 || state.pos == null) {
        state.pos = 0; state.round = 0;
        state.removes = r.shuffle(REMOVE); state.adds = r.shuffle(ADD);
        state.keys = r.chance(0.5) ? [-4, 3] : [3, -4]; // C sections: Bb (a major 3rd down) or F (a minor 3rd up)
        state.presetOrder = r.shuffle([0, 1, 2, 3]);
        state.mut = [];
      }
      const name = FORM[state.pos];
      const round = state.round;
      const next = FORM[state.pos + 1 >= FORM.length ? 1 : state.pos + 1];
      const removal = state.removes[round % REMOVE.length];
      const addition = state.adds[round % ADD.length];
      const key = name === "C1" || name === "C2" ? state.keys[round % 2] : 0;
      const colour = (slot) => COLOURS[(slot + round) % COLOURS.length]; // slot 0: A1/A2, 1: C2, 2: A3
      const kind = name.replace(/\d/, "");
      const progName = name === "intro" ? "intro" : kind === "A" ? "A" : kind === "B" ? "B" : name === "C1" ? "C1" : name === "C2" ? "C2" : "perc";
      const prog = progFor(progName, key);
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(Math.max(0, Math.min(CB - 0.01, b))).chord;

      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        if (abs < -BPB || abs >= CB) return;
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra });
      };

      // ---------- what plays ----------
      const on = { box: true, bass: true, guitar: true, organ: true, swell: false, motif: null, blip: false, stranger: false };
      if (name === "intro") { on.motif = "teaser"; }
      if (kind === "A") on.motif = name === "A1" ? "half" : "full";
      if (kind === "B") { on.swell = true; on.blip = name === "B1"; }
      if (name === "B2") {
        if (removal === "box") on.box = "thin";
        if (removal === "bass") on.bass = false;
        if (removal === "comp") { on.guitar = false; on.organ = false; on.swell = false; on.blip = true; }
      }
      if (name === "perc") { on.bass = on.guitar = on.organ = false; }
      if (name === "C1") { on.stranger = true; on.swell = true; }
      if (name === "C2") { on.motif = "full"; }
      if (name === "A4") {
        on.motif = addition === "invert" ? "invert" : null;
        if (addition === "stranger") on.stranger = true;
        if (addition === "hole") on.box = "hole";
      }
      const motifTrack = name === "C2" ? colour(1) : name === "A3" ? colour(2) : name === "A4" ? "blip" : colour(0);

      // ---------- rhythm box ----------
      const presetIdx = { intro: 0, A1: 0, A2: 0, B1: 3, B2: 3, perc: 2, C1: 1, C2: 1, A3: 0, A4: 0 }[name];
      const pIdx = state.presetOrder[(presetIdx + round) % 4];
      const fresh = state.lastPreset !== pIdx;
      if (fresh) { state.lastPreset = pIdx; state.mut = state.mut.slice(-1); }
      const pat = Object.fromEntries(BOX_VOICES.map((v) => [v, PRESETS[pIdx].v[v].split("")]));
      // mutate: someone pressing buttons on the box
      if (!fresh && r.chance(0.7)) {
        const v = r.pick(["rim", "hat808", "woodblock", "conga", "shaker", "softKick"]);
        const op = v === "woodblock" && pat.woodblock.some((c) => c !== ".") ? "slip" : r.pick(["ghost", "ghost", "accent", "drop"]);
        state.mut.push({ v, op, i: r.int(0, 15) });
        if (state.mut.length > 3) state.mut.shift();
      }
      for (const m of state.mut) {
        const row = pat[m.v];
        if (m.op === "slip") pat[m.v] = row.slice(15).concat(row.slice(0, 15));
        else if (m.op === "ghost" && row[m.i] === "." && (m.v !== "softKick" || m.i % 2 === 0)) row[m.i] = m.v === "softKick" ? "x" : "o";
        else if (m.op === "accent" && row[m.i] === "x") row[m.i] = "X";
        else if (m.op === "drop" && row[m.i] !== "." && m.i % 4 !== 0) row[m.i] = ".";
      }
      const shakerIn = name !== "intro" && name !== "A1" && name !== "A3"; // the shaker comes and goes with the form
      const dropAfter = next === "B2" && removal === "box" || next === "perc";
      const boxBar = (bar, gate) => {
        const B0 = bar * BPB;
        const last = bar === 7, fill = last && !dropAfter;
        for (const v of BOX_VOICES) {
          if (v === "shaker" && !shakerIn && name !== "perc") continue;
          if (gate === "thin" && !(v === "shaker" || v === "conga" || v === "rim")) continue;
          if (name === "perc" && bar < 2 && (v === "hat808" || v === "rim")) continue; // the interlude starts from hand drums
          pat[v].forEach((c, i) => {
            if (c === ".") return;
            if (fill && i >= 8 && v !== "hat808" && v !== "shaker") return;
            if (last && dropAfter && i >= 12) return; // leave a hole before the box drops out
            let vel = VEL[c] * BOX_LEVEL[v] * (gate === "thin" ? 0.8 : 1);
            if (v === "hat808" && i % 4 === 2) vel *= 0.8;
            const pitch = v === "conga" ? (c === "X" ? 67 : 62) : v === "woodblock" ? (i % 8 < 4 ? 84 : 79) : undefined;
            push("box", B0 + i * 0.25, 0.2, v === "conga" && c === "o" ? "congaLow" : v, vel, pitch != null ? { pitch } : {});
          });
        }
        if (fill) {
          const f = r.pick([
            [[2, "conga", 67], [2.5, "conga", 62], [3, "congaLow", 55], [3.25, "conga", 62], [3.5, "congaLow", 55], [3.75, "softKick"]],
            [[2, "woodblock", 84], [2.25, "woodblock", 84], [2.5, "woodblock", 79], [3, "conga", 67], [3.5, "conga", 62], [3.75, "congaLow", 55]],
            [[2.5, "conga", 62], [2.75, "conga", 62], [3, "congaLow", 55], [3.25, "congaLow", 55], [3.5, "rim"], [3.75, "rim"]],
          ]);
          f.forEach(([b, v, p], i) => push("box", B0 + b, 0.2, v, 0.45 + i * 0.07, p != null ? { pitch: p } : {}));
        }
      };
      if (on.box) {
        for (let bar = 0; bar < 8; bar++) {
          if (on.box === "hole" && bar < 4) { if (bar === 3) [[3, "conga", 62], [3.25, "conga", 62], [3.5, "congaLow", 55], [3.75, "softKick"]].forEach(([b, v, p], i) => push("box", bar * BPB + b, 0.2, v, 0.4 + i * 0.1, p ? { pitch: p } : {})); continue; }
          boxBar(bar, on.box === "thin" ? "thin" : null);
        }
        // arrivals: an open hat and a firm kick on the downbeat of a new section
        if (["A1", "B1", "C1", "A3"].includes(name) || (name === "A4" && on.box === "hole")) {
          const at = on.box === "hole" ? 4 * BPB : 0;
          for (let i = ev.length - 1; i >= 0; i--) { // the open hat replaces the closed one; the kick is accented
            const e = ev[i];
            if (e.track === "box" && e.bar * BPB + e.beat === at && e.note === "hat808") ev.splice(i, 1);
            else if (e.track === "box" && e.bar * BPB + e.beat === at && e.note === "softKick") e.vel = 0.95;
          }
          push("box", at, 0.5, "hat808Open", 0.5, { hold: 0.4 });
          if (on.box === "hole") push("box", at, 0.2, "softKick", 0.95);
        }
      }
      if (name === "perc") { // the hand drums improvise over the box
        for (let bar = 0; bar < 8; bar++) {
          const B0 = bar * BPB;
          const lick = r.pick([[[1.5, 67], [1.75, 62]], [[2.75, 62], [3, 67]], [[0.75, 62], [1, 62], [1.25, 67]], [[3.25, 67], [3.5, 62], [3.75, 62]]]);
          if (bar % 2 === 1 || r.chance(0.4)) lick.forEach(([b, p], i) => push("box", B0 + b, 0.2, "conga", 0.5 + 0.08 * i, { pitch: p }));
          if (bar >= 4 && r.chance(0.5)) push("box", B0 + r.pick([1.75, 2.25, 3.25]), 0.2, "woodblock", 0.5, { pitch: 84 });
        }
      }

      // ---------- organ drone / chords ----------
      const tonic = mod12(2 + key);
      if (on.organ) {
        if (kind === "A" || name === "intro" || name === "C1" || name === "C2") {
          const root = T.nearest(key === 3 ? 53 : 50, [tonic], 45, 53), drone = [root, root + 7];
          const until = name === "C2" ? 6 * BPB : CB; // C2's last two bars leave the pedal behind
          push("organ", 0, until / 2 - 0.1, drone, name === "intro" ? 0.38 : 0.45);
          push("organ", until / 2, until / 2 - 0.1, drone, 0.45);
          if (name === "C2") {
            let v = state.organV;
            prog.filter((h) => h.bar >= 6).forEach((h) => { v = T.voice(h.chord, { lo: 52, hi: 72, n: 4, prev: v }); push("organ", h.bar * BPB + h.beat, h.dur - 0.1, v, 0.42); });
            state.organV = v;
          }
        } else if (kind === "B") {
          let v = state.organV;
          prog.forEach((h) => { v = T.voice(h.chord, { lo: 52, hi: 72, n: 4, prev: v, top: [66, 72] }); push("organ", h.bar * BPB + h.beat, h.dur - 0.1, v, 0.4); });
          state.organV = v;
        }
      }

      // ---------- swells: slow-attack chords that bloom and are cut off, like reversed guitar ----------
      if (on.swell) {
        let v = state.swellV;
        prog.forEach((h, i) => {
          if (i % 2 === 1 && !(name === "B2")) return;
          v = T.voice(h.chord, { lo: 60, hi: 81, n: 3, prev: v, top: [74, 81], omitBass: true });
          push("swell", h.bar * BPB + h.beat, Math.min(h.dur, 4) - 0.3, v, 0.5);
        });
        state.swellV = v;
      }

      // ---------- treated guitar: chiming arpeggios through the dotted-eighth echo; strums in C ----------
      if (on.guitar) {
        const ARP = [
          [[0, 0, 1], [0.75, 2, 0.75], [1.5, 1, 1], [2.5, 3, 0.75], [3, 2, 1]],
          [[0, 1, 0.75], [0.5, 3, 0.75], [1.5, 2, 1], [2, 0, 0.75], [3, 3, 1]],
          [[0.5, 2, 1], [1.5, 3, 1], [2.25, 1, 0.75], [3, 0, 1]],
        ];
        let v = ["A1", "A3", "B1", "C1"].includes(name) ? null : state.guitarV; // re-centre at big arrivals
        const start = name === "intro" ? 2 : 0;
        prog.forEach((h) => {
          if (h.bar < start) return;
          const strum = name === "C1" || name === "C2";
          v = T.voice(h.chord, { lo: strum ? 55 : 59, hi: 79, n: 4, prev: v, top: [69, 79], omitBass: true });
          const s0 = h.bar * BPB + h.beat;
          if (kind === "B") {
            // in B the guitar steps back: two chimes a bar, high, leaving the middle to the organ and swells
            push("guitar", s0, 1.5, v[v.length - 1], 0.44);
            if (h.dur >= 4) push("guitar", s0 + 2.5, 1.5, v[v.length - 2], 0.36);
          } else if (strum) {
            // I-bVII-IV strums on the offbeats, ringing into the echo
            push("guitar", s0, 1.4, v, 0.5, { strum: 0.014 });
            if (h.dur >= 4) { push("guitar", s0 + 1.5, 0.9, v.slice(-3), 0.36, { strum: -0.01 }); push("guitar", s0 + 2.5, 1.4, v, 0.42, { strum: 0.012 }); }
          } else {
            const pat = ARP[(h.bar + round + (kind === "B" ? 1 : 0)) % ARP.length];
            pat.forEach(([b, i, d]) => { if (b < h.dur) push("guitar", s0 + b, d, v[i % v.length], 0.42 + (b === 0 ? 0.08 : 0)); });
          }
        });
        state.guitarV = v;
      }

      // ---------- fretless bass ----------
      if (on.bass) {
        const PATS = {
          A: [
            [[0, "R", 1.25, 0.82], [1.5, "R", 0.4, 0.5], [2, "5", 0.75, 0.66], [2.75, "8", 0.4, 0.55], [3.5, "app", 0.45, 0.6]],
            [[0, "R", 0.75, 0.82], [0.75, "R", 0.25, 0.42], [1.5, "5", 0.5, 0.6], [2, "8", 1, 0.66], [3, "3", 0.5, 0.6], [3.5, "app", 0.5, 0.58]],
            [[0, "R", 0.5, 0.82], [0.75, "R", 0.5, 0.5], [1.5, "7", 0.5, 0.58], [2.5, "5", 0.5, 0.6], [3, "R", 0.5, 0.65], [3.5, "app", 0.5, 0.58]],
          ],
          B: [
            [[0, "R", 2.5, 0.8], [2.5, "5", 0.5, 0.6], [3, "9", 1, 0.62]],
            [[0, "R", 1.5, 0.8], [1.5, "3", 1, 0.62], [2.5, "5", 1, 0.6], [3.5, "app", 0.5, 0.58]],
          ],
        };
        const style = kind === "B" ? "B" : "A";
        let last = state.bassLast ?? 38;
        const lo = 33, hi = 52;
        prog.forEach((h, hi_) => {
          const c = T.chord(h.chord), s0 = h.bar * BPB + h.beat;
          const nextH = prog[hi_ + 1];
          const nextBass = nextH ? T.chord(nextH.chord).bass : (next.startsWith("A") || next === "B1" ? 2 : c.bass);
          const R = T.nearest(Math.min(44, last), [c.bass], 35, 47);
          const tone = (target) => T.nearest(target, c.pcs.concat([c.bass]), lo, 62);
          // lyric bars: the fretless leaves the groove and sings a phrase of its own over a held root
          const lyric = h.dur >= 4 && ((name === "A1" && h.bar >= 4) || (name === "B2" && h.bar % 2 === 0));
          if (lyric) {
            push("bass", s0, 1.4, R, 0.8);
            const ln = C.line({ start: s0 + 1.5, end: s0 + h.dur, chordAt: sym, lo: 45, hi: 60, rng: r.fork(100 + hi_), density: 0.4, phrase: [2, 3], rest: [0.5, 1],
              motif: state.bassMotif, motifProb: 0.5, chromatic: 0, register: 0.55, prev: R + 12, upbeatStart: 0.5, scaleFor: (x) => safeScale(T.chord(x)) });
            state.bassMotif = ln.motif;
            ln.notes.forEach((n) => push("bass", n.beat, Math.min(n.dur, s0 + h.dur - n.beat - 0.05), n.note, 0.62 + (n.strong ? 0.06 : 0)));
            last = ln.notes.length ? ln.last : R;
            return;
          }
          const singing = (h.bar === 3 || h.bar === 7) && h.dur >= 4 && r.chance(kind === "B" ? 0.8 : 0.6) && !(name === "B2" && removal === "box");
          const pats = PATS[style];
          const pat = h.dur >= 4 ? pats[(h.bar + (r.chance(0.3) ? 1 : 0) + round) % pats.length] : [[0, "R", h.dur - 0.5, 0.8], [h.dur - 0.5, "app", 0.45, 0.58]];
          for (const [b, role, d, vel] of pat) {
            if (singing && b >= 1.5) break;
            let n;
            if (role === "R") n = R;
            else if (role === "5") n = tone(R + 7);
            else if (role === "8") n = R + 12 <= 55 ? R + 12 : tone(R + 7);
            else if (role === "3") n = tone(R + 4);
            else if (role === "7") n = tone(R + 10);
            else if (role === "9") n = T.nearest(R + 14, safeScale(c), lo, 58);
            else if (role === "app") {
              const tgt = T.nearest(R, [nextBass], lo, 47);
              n = tgt === R ? tone(R + 7) : approach(c, tgt, R);
            }
            push("bass", s0 + b, singing ? Math.min(d, 1.4) : d, n, vel);
            last = n;
          }
          if (singing) {
            // the fretless sings: a short climb into a high chord tone, held, gliding
            const top = T.nearest(R + r.pick([12, 14, 16, 19]), c.pcs, 50, 59);
            const steps = r.pick([[1.5, 2, 2.5], [1.5, 2.5], [2, 2.75]]);
            const path = T.notesIn(c.pcs, tone(R + 7), top - 1).slice(-(steps.length - 1));
            while (path.length < steps.length - 1) steps.shift();
            let m;
            steps.forEach((b, i) => {
              m = i === steps.length - 1 ? top : path[i];
              push("bass", s0 + b, i === steps.length - 1 ? s0 + 4 - (s0 + b) - 0.1 : 0.45, m, 0.66);
            });
            last = top;
          }
          last = Math.max(lo, Math.min(52, last));
        });
        state.bassLast = last;
      }

      // ---------- the motif ----------
      if (on.motif) {
        let notes = MOTIF;
        if (on.motif === "half") notes = MOTIF.filter((n) => n.beat < 4 * BPB);
        if (on.motif === "teaser") notes = MOTIF.filter((n) => n.beat < 2 * BPB).map((n) => ({ ...n, beat: n.beat + 4 * BPB }));
        if (name === "C2") notes = MOTIF.filter((n) => n.beat < 6 * BPB).concat(C2_TAIL).map((n) => ({ ...n, note: n.note + (key < 0 ? key + 12 : key) })) // above the strums;
        if (on.motif === "invert") {
          // upside down around D5, each note pulled to the nearest tone of its chord (scale tone when short)
          let prevOut = null;
          notes = MOTIF.map((n, i) => {
            const c = T.chord(sym(n.beat)), m = 2 * 74 - n.note + 12;
            const set = n.dur >= 0.75 ? c.pcs : safeScale(c);
            let x = T.nearest(m, set, 72, 93);
            const moved = i > 0 && MOTIF[i - 1].note !== n.note;
            if (moved && x === prevOut) x = T.step(x, MOTIF[i - 1].note > n.note ? 1 : -1, safeScale(c)); // keep the (inverted) motion
            prevOut = x;
            return { ...n, note: x, dur: Math.min(n.dur, 0.5) };
          });
        }
        const tr = name === "A4" ? "blip" : motifTrack;
        const legato = tr === "lead";
        const disp = name === "A2" && round % 2 === 1 ? 0.5 : 0; // second time round, the tune arrives an eighth late
        notes.forEach((n, i) => {
          let dur = n.dur;
          if (legato) { const nx = notes[i + 1]; if (nx && nx.beat - n.beat <= 1.5) dur = nx.beat - n.beat + 0.05; }
          if (tr === "synth") dur = Math.min(dur, 0.9);
          const b = n.beat + disp;
          if (b + dur > CB) dur = CB - b - 0.05;
          const lineVel = (tr === "synth" ? 0.6 : tr === "lead" ? 0.62 : tr === "blip" ? 0.5 : 0.66) + (n.beat % 4 === 0 ? 0.06 : 0);
          push(tr, b, dur, n.note, lineVel);
        });
      }

      // ---------- small odd synth figures, answering the bass in B ----------
      if (on.blip && name !== "A4") {
        for (let bar = 1; bar < 8; bar += 2) {
          const h = chordAt(bar * BPB), c = T.chord(h.chord);
          const base = T.nearest(r.int(79, 86), c.pcs, 76, 91);
          const fig = r.pick([[0, 1, 0], [0, -1, 1], [0, 1, 2], [0, 2, 1, 0]]);
          const at = bar * BPB + r.pick([1.5, 2.5, 2.75]);
          fig.forEach((s, i) => push("blip", at + i * 0.25, 0.2, T.step(base, s, c.pcs), 0.5 - i * 0.04));
        }
      }

      // ---------- the stranger: a frequency-shifted kalimba, slightly out of this world ----------
      if (on.stranger) {
        const spots = name === "C1" ? [1, 3, 5] : [2, 5];
        spots.forEach((bar) => {
          const h = chordAt(bar * BPB), c = T.chord(h.chord);
          let m = T.nearest(r.int(74, 81), c.pcs, 72, 86);
          const fig = r.pick([[[0, 0], [0.5, 1], [1.5, -1]], [[0, 0], [0.75, -1], [1.5, -2], [2, 0]], [[0.5, 0], [1, 2]]]);
          fig.forEach(([b, s], i) => push("stranger", bar * BPB + b, 1.5, T.step(m, s, c.pcs), 0.55 - i * 0.05));
        });
      }

      // ---------- the box never strikes one voice twice at the same instant (keep the louder) ----------
      const seen = new Map();
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.track !== "box") continue;
        const k = `${e.note}@${e.bar * BPB + e.beat}`;
        if (seen.has(k)) { const j = seen.get(k); if (e.vel > ev[j].vel) ev[j].vel = e.vel; ev[i] = null; } else seen.set(k, i);
      }
      const events = ev.filter(Boolean);

      // ---------- advance ----------
      state.pos++;
      if (state.pos >= FORM.length) { state.pos = 1; state.round++; }
      const KEYNAME = { 0: "D", [-4]: "B♭", 3: "F" };
      const LABEL = {
        intro: "Intro · the rhythm box and a pedal",
        A1: `A · motif on ${colour(0)}`,
        A2: `A · motif on ${colour(0)}${name === "A2" && round % 2 === 1 ? ", an eighth late" : ""}`,
        B1: "B · organ, swells and blips",
        B2: `B again · ${removal === "box" ? "the rhythm box thins to hand percussion" : removal === "bass" ? "without the bass" : "without guitar and organ"}`,
        perc: "Interlude · percussion only",
        C1: `Elsewhere · ${KEYNAME[key] || ""} · a stranger on kalimba`,
        C2: `Elsewhere · ${KEYNAME[key] || ""} · the motif on ${colour(1)}`,
        A3: `A · home, the motif on ${colour(2)}`,
        A4: `Coda · ${addition === "invert" ? "the motif upside down" : addition === "stranger" ? "the stranger follows us home" : "a hole in the box"}`,
      };
      const label = `${LABEL[name]} · ${PRESETS[pIdx].name} box${round ? ` · round ${round + 1}` : ""}`;
      return { events, harmony: prog, section: label, state };
    },
  });
})();
