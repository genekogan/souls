// Midway: a carousel two-step for a band organ, playing to itself at the edge of the park.
//
// Why 6/8 and not a waltz: the showcase already has a waltz with a pizzicato oom-pah-pah (Build Mode),
// and the merry-go-round's other great genre is the 6/8 two-step march. Its long-short lilt
// (quarter, eighth) is the gallop of the painted horses; the bass pipes sound the two dotted-quarter
// beats of the bar (6/8 written as 3 quarter-beats: beats 0 and 1.5) and the accompaniment pipes
// answer on the afterbeats (the 3rd and 6th eighths: beats 1 and 2.5).
//
// The machine: flute pipes (I.organ with soft flute partials) carry the tune, a piccolo rank doubles
// it an octave up on repeats, reed "trombone" pipes play the countermelodies, a steam calliope whistle
// (breathy, scooping into each note, its pitch drifting on two slow incommensurate wobbles) takes the
// tune in the soft passes, glockenspiel bells double its structural notes, and a drum that plays itself:
// bass drum on the downbeat, mechanical snare rolls into each new strain, a cymbal crash on the big
// entrances. Pipes have no touch, so dynamics come from registration (which ranks are drawn), not from
// velocity, exactly as on a real band organ.
//
// The book (one "turn" = 18 cycles of 8 bars, about 2.7 minutes), in C with the trio in F:
//   Intro (4-bar fanfare over a German-sixth Ab7 -> G7, then 4 bars vamp-till-ready)
//   A A (a chromatic lower-neighbour motif E-D#-E, V/ii, a V/IV barbershop C7 and a wistful borrowed Fm6)
//   B B (a circle of barbershop sevenths E7-A7-D7-G7 with a sighing appoggiatura sequenced three times,
//        then C-C#dim7-Dm7-G7 and the A motif recalled)
//   Break strain in A minor over a chromatic lament bass (A G# G F# F E), turning to F through Gm7-C7
//   Trio in F, twice (sweet, lyrical; IV-#ivdim7-I6/4, a 4-3 suspension in the counter line)
//   Vamp back to C (calliope and bells in dialogue over F-F#dim7-C/G-A7-Dm7-D7-G7)
//   A da capo, full organ; Tag with a last iv (Fm6), and a stinger.
// Every strain is played plain first, then with octaves and a countermelody (the trio: calliope first).
// Three registrations rotate turn by turn (standard; calliope-led with the counters moved; a quieter
// "dusk" turn with bells on the calliope), so the full arc is about eight minutes; from the second turn on,
// the flutes add crushed grace notes. Bass walk-ups lead into every new strain. The afterbeat chords stay a
// minor third under the tune and drop any tone a semitone from a passing note; the bass picks its second
// beat (fifth, leading tone, third...) to avoid exposed parallels with the tune and the counter.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 3;
  const mod12 = T.mod12;
  const arr = (n) => (Array.isArray(n) ? n : [n]);
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation ----------
  // "E5/1 D#5/.5s | r/3" -> [{beat, dur, note|null, art}]. Bars must add up to 3 beats (6/8 in quarters).
  // Flags: s staccato, t tenuto; a trailing _ ties the note into the next one of the same pitch.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)([st]?)(_?)$/.exec(tok);
        if (!m) throw new Error(`midway: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), art: m[3], tie: m[4] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`midway: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; p.art = "t"; }
      else merged.push({ ...n });
    }
    return merged;
  }

  // ---------- the book ----------
  const SRC = {
    intro: {
      harm: "| C | Ab7 | G7 | G7 | C | C | G7 | G7 |",
      mel: "G4/.5 C5/.5 E5/.5 G5/1 E5/.5 | C6/1.5 Ab5/1 Gb5/.5 | F5/1 D5/.5 B4/1 D5/.5 | G5/1.5 r/1.5 | r/3 | r/3 | r/3 | r/3",
      glock: "r/3 | r/3 | r/3 | r/3 | C7/1.5 r/1.5 | r/1.5 G6/.5 E6/.5 C6/.5 | B6/1.5 r/1.5 | r/3",
    },
    A: {
      pickup: "G4",
      harm: "| C | C | A7 | Dm | G7 | G7 | D7 | G | C | C7 | F | Fm6 | C/G | G7 | C | C |",
      mel: "E5/1 D#5/.5 E5/1 G5/.5 | C6/2 B5/.5 A5/.5 | G5/1 E5/.5 C#5/1 E5/.5 | D5/1.5 r/1 A4/.5 | " +
        "B4/1 A#4/.5 B4/1 D5/.5 | G5/2 F5/.5 E5/.5 | D5/1 F#5/.5 A5/1 C6/.5 | B5/1.5 r/1 G4/.5 | " +
        "E5/1 D#5/.5 E5/1 G5/.5 | C6/2 Bb5/.5 A5/.5 | C6/1 A5/.5 F5/1 A5/.5 | Ab5/2 G5/.5 F5/.5 | " +
        "E5/1.5 G5/1 C6/.5 | B5/1 A5/.5 G5/1 F5/.5 | E5/1 D5/.5 C5/1.5 | r/3",
      counter: "C4/3 | E4/1 G4/.5 E4/1 C4/.5 | A3/1.5 E4/1.5 | F4/2 E4/.5 D4/.5 | F4/3 | D4/1 F4/.5 B3/1.5 | A3/3 | B3/1.5 D4/1.5 | " +
        "C4/3 | E4/1 G4/.5 C4/1.5 | A3/3 | C4/1.5 D4/1.5 | C4/1.5 E4/1.5 | F4/1.5 D4/1.5 | C4/1.5 E4/1.5 | C4/1.5 r/1.5",
    },
    B: {
      harm: "| E7 | E7 | A7 | A7 | D7 | D7 | G7 | G7 | C | C#dim7 | Dm7 | G7 | C | A7 | Dm7:1.5 G7:1.5 | C |",
      mel: "D6/1 C6/.5 B5/1 G#5/.5 | A5/1.5 G#5/1 E5/.5 | G5/1 F5/.5 E5/1 C#5/.5 | D5/1.5 C#5/1 E5/.5 | " +
        "C6/1 Bb5/.5 A5/1 F#5/.5 | G5/1.5 F#5/1 D5/.5 | B4/1 C5/.5 D5/1 F5/.5 | G5/1.5 F5/1 D5/.5 | " +
        "E5/1 G5/.5 C6/1.5 | Bb5/1 G5/.5 E5/1 C#5/.5 | D5/1 F5/.5 A5/1 C6/.5 | B5/2 A5/.5 G5/.5 | " +
        "E5/1 D#5/.5 E5/1 A5/.5 | C#6/2 B5/.5 A5/.5 | D6/1 C6/.5 B5/1 G5/.5 | C6/1.5 r/1.5",
      counter: "G#4/3 | E4/1.5 D4/1.5 | C#4/1.5 G4/1.5_ | G4/3 | F#4/3 | D4/1.5 C4/1.5 | D4/1.5 B3/1.5 | F4/1.5 D4/1.5 | " +
        "C4/1.5 E4/1.5 | G4/3 | F4/3 | F4/1 D4/.5 B3/1 D4/.5 | C4/3 | G4/1 E4/.5 C#4/1 E4/.5 | F4/1.5 D4/1.5 | E4/1.5 r/1.5",
    },
    brk: {
      harm: "| Am | E7/G# | Am/G | D7/F# | Dm/F | E7 | Gm7 | C7 |",
      mel: "A5/1 E5/.5 A5/1 C6/.5 | B5/1.5 G#5/1 E5/.5 | C6/1 B5/.5 A5/1 E5/.5 | F#5/1.5 A5/1 C6/.5 | " +
        "D6/1 C6/.5 A5/1 F5/.5 | G#5/1.5 B5/1 D6/.5 | Bb5/1 A5/.5 G5/1 F5/.5 | E5/1.5 r/1.5",
    },
    T: {
      pickup: "C5",
      harm: "| F | F6 | C7 | C7 | Gm7 | C7 | F:1.5 F7:1.5 | F7 | Bb | Bdim7 | F/C | D7 | Gm7 | C7 | F | F |",
      mel: "F5/1 G5/.5 A5/1.5 | D6/2 C6/.5 A5/.5 | G5/1 A5/.5 Bb5/1.5 | C6/2 Bb5/.5 G5/.5 | " +
        "Bb5/1 A5/.5 G5/1.5 | E5/1 F5/.5 G5/1.5 | A5/3t | r/1.5 C5/.5 D5/.5 Eb5/.5 | " +
        "D5/1 Eb5/.5 F5/1.5 | Ab5/2 G5/.5 F5/.5 | A5/1 Bb5/.5 C6/1.5 | D6/2 C6/.5 A5/.5 | " +
        "Bb5/1 A5/.5 G5/1.5 | E5/1 F5/.5 G5/1 Bb5/.5 | A5/1 G5/.5 F5/1.5 | r/3",
      counter: "A3/1.5 C4/1 D4/.5 | F4/1 D4/.5 C4/1.5 | E4/3 | G4/1 E4/.5 C4/1 E4/.5 | F4/1.5 D4/1 Bb3/.5_ | Bb3/1.5 C4/1 E4/.5 | F4/1 C4/.5 Eb4/1.5_ | Eb4/1.5 A3/1.5 | " +
        "Bb3/1.5 D4/1.5 | B3/1 D4/.5 F4/1 D4/.5 | C4/1.5 F4/1.5 | F#4/1 D4/.5 C4/1.5_ | C4/1.5 Bb3/1 D4/.5 | G4/1.5 E4/1.5 | F4/1.5 C4/1.5 | A3/1.5 r/1.5",
    },
    vamp: {
      harm: "| F | F#dim7 | C/G | A7 | Dm7 | D7 | G7 | G7 |",
      cal: "A5/1 G#5/.5 A5/1 C6/.5 | Eb6/1.5 C6/1 A5/.5 | G5/1.5 r/1.5 | r/3 | F5/1 E5/.5 F5/1 A5/.5 | C6/1.5 A5/1 F#5/.5 | G5/1.5 r/1.5 | r/3",
      glock: "r/3 | r/3 | G6/1 F#6/.5 G6/1 C7/.5 | C#7/1.5 A6/1 G6/.5 | r/3 | r/3 | r/1.5 D7/.5 B6/.5 G6/.5 | r/3",
    },
    tag: {
      harm: "| F | Fm6 | C/G | A7 | Dm7 | G7 | C | C |",
      mel: "C6/1.5 A5/1 F5/.5 | Ab5/2 G5/.5 F5/.5 | E5/1 D#5/.5 E5/1 G5/.5 | C#6/1.5 A5/1 G5/.5 | " +
        "F5/1 A5/.5 D6/1.5 | B5/1 A5/.5 G5/1 F5/.5 | E5/3t | r/3",
    },
  };
  const PH = {};
  for (const [k, s] of Object.entries(SRC)) {
    const p = { prog: T.progression(s.harm, BPB) };
    for (const f of ["mel", "counter", "cal", "glock"]) if (s[f]) p[f] = line(s[f]);
    if (s.pickup) p.pickup = T.midi(s.pickup);
    p.bars = p.prog.reduce((a, e) => Math.max(a, e.bar + 1), 0);
    PH[k] = p;
  }
  const halfProg = (prog, h) => prog.filter((e) => e.bar >= 8 * h && e.bar < 8 * h + 8).map((e) => ({ ...e, bar: e.bar - 8 * h }));
  const halfNotes = (notes, h) => (notes || []).filter((n) => n.beat >= 24 * h - 1e-6 && n.beat < 24 * h + 24 - 1e-6).map((n) => ({ ...n, beat: n.beat - 24 * h }));

  // One turn of the book: 18 cycles of 8 bars.
  const TURN = [
    { s: "intro", reg: "intro" },
    { s: "A", h: 0, reg: "A1" }, { s: "A", h: 1, reg: "A1" },
    { s: "A", h: 0, reg: "A2" }, { s: "A", h: 1, reg: "A2" },
    { s: "B", h: 0, reg: "B1" }, { s: "B", h: 1, reg: "B1" },
    { s: "B", h: 0, reg: "B2" }, { s: "B", h: 1, reg: "B2" },
    { s: "brk", reg: "brk" },
    { s: "T", h: 0, reg: "T1" }, { s: "T", h: 1, reg: "T1" },
    { s: "T", h: 0, reg: "T2" }, { s: "T", h: 1, reg: "T2" },
    { s: "vamp", reg: "vamp" },
    { s: "A", h: 0, reg: "A3" }, { s: "A", h: 1, reg: "A3" },
    { s: "tag", reg: "tag" },
  ];
  // Registration: lead rank (flute pipes or calliope), piccolo octave, trombone counter, bells, drum level.
  const REG = [
    { // turns 1, 4, …
      intro: { lead: "flute", pic: true, drums: 2, crash: true },
      A1: { lead: "flute", drums: 1 },
      A2: { lead: "flute", pic: true, counter: true, drums: 2, crash: true },
      B1: { lead: "flute", glock: true, drums: 1 },
      B2: { lead: "flute", pic: true, counter: true, drums: 2, crash: true },
      brk: { lead: "flute", pic: true, drums: 3, crash: true },
      T1: { lead: "cal", drums: 0, soft: true },
      T2: { lead: "flute", pic: true, counter: true, glock: true, drums: 3, crash: true },
      vamp: { lead: "cal", drums: 1 },
      A3: { lead: "flute", pic: true, counter: true, glock: true, drums: 2, crash: true },
      tag: { lead: "flute", pic: true, drums: 1 },
    },
    { // turns 2, 5, …: the calliope leads where the flutes did, the counters move
      intro: { lead: "cal", drums: 1 },
      A1: { lead: "cal", drums: 0, soft: true },
      A2: { lead: "flute", counter: true, drums: 1 },
      B1: { lead: "cal", glock: true, drums: 1 },
      B2: { lead: "flute", pic: true, counter: true, drums: 2, crash: true },
      brk: { lead: "flute", pic: true, drums: 3, crash: true },
      T1: { lead: "flute", counter: true, drums: 1 },
      T2: { lead: "cal", counter: true, glock: true, drums: 2, crash: true },
      vamp: { lead: "cal", drums: 1 },
      A3: { lead: "flute", pic: true, counter: true, glock: true, drums: 3, crash: true },
      tag: { lead: "flute", pic: true, drums: 1 },
    },
    { // turns 3, 6, …: dusk on the midway, fewer drums, bells on the calliope
      intro: { lead: "flute", drums: 1 },
      A1: { lead: "flute", drums: 0, soft: true },
      A2: { lead: "cal", counter: true, drums: 1 },
      B1: { lead: "flute", glock: true, drums: 1 },
      B2: { lead: "flute", pic: true, counter: true, drums: 2, crash: true },
      brk: { lead: "flute", pic: true, drums: 2, crash: true },
      T1: { lead: "cal", glock: true, drums: 0, soft: true },
      T2: { lead: "flute", pic: true, counter: true, glock: true, drums: 3, crash: true },
      vamp: { lead: "cal", drums: 1 },
      A3: { lead: "flute", pic: true, counter: true, drums: 2, crash: true },
      tag: { lead: "flute", drums: 1 },
    },
  ];
  const SCALE_C = T.scale(0, "ionian"), SCALE_F = T.scale(5, "ionian");
  const NAME = { intro: "Intro", A: "A strain", B: "B strain", brk: "Break strain · A minor", T: "Trio in F", vamp: "Vamp", tag: "Tag" };

  // ---------- custom instruments ----------
  /** Wooden bass pipes: round, a little hooty, detached. */
  function bassPipes(ctx, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 10)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 950, type: "lowpass", rolloff: -12 })).connect(out);
    const s = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 6, options: {
      oscillator: { type: "custom", partials: [1, 0.55, 0.25, 0.12, 0.05] },
      envelope: { attack: 0.025, decay: 0.12, sustain: 0.82, release: 0.1 },
    } })).connect(lp);
    return { out, play(time, notes, dur, vel = 0.7) { s.triggerAttackRelease(arr(notes).map(T.hz), dur, time, vel); } };
  }

  /**
   * Steam calliope: a near-pure whistle with breath, scooping up into each note as the steam pressure
   * builds, with a quick vibrato and two slow, incommensurate pitch wobbles (unsteady pressure).
   */
  function calliope(ctx, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 12)));
    const wob1 = ctx.keep(new Tone.Vibrato({ frequency: 0.37, depth: 0.14, maxDelay: 0.04 })).connect(out); // ~11 cents
    const wob2 = ctx.keep(new Tone.Vibrato({ frequency: 0.23, depth: 0.12, maxDelay: 0.04 })).connect(wob1); // ~6 cents
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 5.7, depth: 0.08 })).connect(wob2);
    const lp = ctx.keep(new Tone.Filter({ frequency: 4200, type: "lowpass", rolloff: -12 })).connect(vib);
    const s = ctx.keep(new Tone.MonoSynth({
      portamento: 0.01,
      oscillator: { type: "custom", partials: [1, 0.28, 0.14, 0.06, 0.03] },
      filter: { type: "lowpass", rolloff: -12, Q: 0.6 },
      envelope: { attack: 0.03, decay: 0.12, sustain: 0.85, release: 0.08 },
      filterEnvelope: { attack: 0.02, decay: 0.25, sustain: 0.75, release: 0.1, baseFrequency: 1400, octaves: 1.6 },
    })).connect(lp);
    const bp = ctx.keep(new Tone.Filter({ frequency: 2800, type: "bandpass", Q: 1 })).connect(lp);
    const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.012, decay: 0.09, sustain: 0.22, release: 0.08 } })).connect(bp);
    breath.volume.value = -19;
    const mono = ctx.I.monotonic(s);
    return {
      out,
      play(time, note, dur, vel = 0.7, cents = 0, scoop = -20) {
        const t = mono(time - 0.042); // the two wobble delay lines add ~42 ms; start early to stay in time
        const c = Number.isFinite(cents) ? cents : 0, sc = Number.isFinite(scoop) ? scoop : -20;
        s.detune.setValueAtTime(c + sc, t);
        s.detune.linearRampToValueAtTime(c, t + 0.07);
        s.triggerAttackRelease(T.hz(arr(note)[0]), dur, t, vel);
        breath.triggerAttackRelease(Math.max(0.05, dur * 0.85), t, vel * 0.9);
      },
    };
  }

  /** The band organ's own drums: felt bass drum, a beater snare (single taps and rolls), a small cymbal. */
  function percussion(ctx, o = {}) {
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? 0)));
    const bdOut = ctx.keep(new Tone.Gain(db(-7))).connect(out);
    const bdLp = ctx.keep(new Tone.Filter({ frequency: 380, type: "lowpass" })).connect(bdOut);
    const bd = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.07, octaves: 2.4, oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.55, sustain: 0, release: 0.25 } })).connect(bdLp);
    const snOut = ctx.keep(new Tone.Gain(db(-9))).connect(out);
    const snBp = ctx.keep(new Tone.Filter({ frequency: 2400, type: "bandpass", Q: 0.6 })).connect(snOut);
    const sn = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.04 } })).connect(snBp);
    const body = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.012, octaves: 1.4, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 } })).connect(snOut);
    body.volume.value = -12;
    const roll = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.055, sustain: 0, release: 0.02 } })).connect(snBp);
    roll.volume.value = -3;
    const cymOut = ctx.keep(new Tone.Gain(db(-6))).connect(out);
    const cymHp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "highpass" })).connect(cymOut);
    const cym = ctx.keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.1, release: 0.5 }, harmonicity: 5.1, modulationIndex: 26, resonance: 5200, octaves: 1.3 })).connect(cymHp);
    cym.volume.value = -18;
    const M = ctx.I.monotonic;
    const at = { bd: M(bd), sn: M(sn), body: M(body), roll: M(roll), cym: M(cym) };
    return {
      out,
      hit(name, time, vel = 0.6) {
        if (name === "bd") bd.triggerAttackRelease(T.hz(31), 0.3, at.bd(time), vel);
        else if (name === "sn") { sn.triggerAttackRelease(0.1, at.sn(time), vel); body.triggerAttackRelease(T.hz(53), 0.06, at.body(time), vel); }
        else if (name === "roll") roll.triggerAttackRelease(0.04, at.roll(time), vel);
        else if (name === "cym") cym.triggerAttackRelease(300, 0.6, at.cym(time), vel);
      },
    };
  }

  Sim.register({
    id: "midway",
    title: "Midway",
    genre: "Fairground",
    about: "A carousel two-step in 6/8 on a band organ: flute and reed pipes, a wobbly steam calliope, bells and a drum that plays itself. Intro, A A B B (a circle of barbershop sevenths), a break strain on a lament bass, a trio in F, a vamp and the A strain da capo, with octaves and countermelodies on every repeat.",
    bpm: 162, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: -1.5, strongBeats: [0, 1.5],

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.012, lowcut: 220, highcut: 6500 });
      const air = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.035, lowcut: 450, highcut: 5000 });
      const slap = I.delay(ctx, out, { time: 0.13, feedback: 0.1, highcut: 2600 }); // the midway's facades
      const flute = I.organ(ctx, { volume: 0, partials: [1, 0.38, 0.16, 0.07, 0.03] });
      const pic = I.organ(ctx, { volume: -11, partials: [1, 0.12, 0.04] });
      const counter = I.organ(ctx, { volume: -5, partials: [0.75, 1, 0.75, 0.55, 0.4, 0.26, 0.16, 0.09] });
      const chords = I.organ(ctx, { volume: -9, partials: [1, 0.55, 0.38, 0.22, 0.12, 0.07] });
      const bass = bassPipes(ctx, { volume: -3 });
      const cal = calliope(ctx, { volume: -1 });
      const glock = I.glock(ctx, { volume: -9, decay: 1.8 });
      const perc = percussion(ctx, { volume: 0 });

      const fp = I.place(ctx, flute, 0, out), pp = I.place(ctx, pic, 0.12, out), cp = I.place(ctx, counter, -0.3, out);
      const hp = I.place(ctx, chords, 0.22, out), bp = I.place(ctx, bass, -0.05, out), clp = I.place(ctx, cal, 0.15, out);
      const gp = I.place(ctx, glock, 0.38, out), dp = I.place(ctx, perc, -0.12, out);
      I.send(ctx, fp, room, -11); I.send(ctx, fp, air, -19); I.send(ctx, fp, slap, -22);
      I.send(ctx, pp, room, -12); I.send(ctx, pp, air, -18);
      I.send(ctx, clp, room, -10); I.send(ctx, clp, air, -15); I.send(ctx, clp, slap, -19);
      I.send(ctx, cp, room, -12); I.send(ctx, hp, room, -13); I.send(ctx, bp, room, -22);
      I.send(ctx, gp, air, -10); I.send(ctx, dp, room, -14); I.send(ctx, dp, slap, -24);

      const pipes = { timing: 0.002, vel: 0.01 }; // a machine: tight time, no touch
      return {
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: pipes },
        pic: { layer: "melody", play: (t, e, d) => pic.play(t, e.note, d, e.vel), humanize: pipes },
        cal: { layer: "melody", play: (t, e, d) => cal.play(t, e.note, d, e.vel, e.cents, e.scoop), humanize: { timing: 0.006, vel: 0.03 } },
        counter: { layer: "harmony", play: (t, e, d) => counter.play(t, e.note, d, e.vel), humanize: pipes },
        chords: { layer: "harmony", play: (t, e, d) => chords.play(t, e.note, d, e.vel), humanize: pipes },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: pipes },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        drums: { layer: "drums", play: (t, e) => perc.hit(e.note, t, e.vel), humanize: { timing: 0.002, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bass == null) Object.assign(state, { bass: 43, cv: null, bassTarget: null });
      const turn = Math.floor(cycle / TURN.length), idx = cycle % TURN.length;
      const S = TURN[idx], N = TURN[(idx + 1) % TURN.length];
      const reg = REG[turn % 3][S.reg];
      const P = PH[S.s], h = S.h || 0;
      const prog = P.bars === 16 ? halfProg(P.prog, h) : P.prog;
      const lastCycle = P.bars === 8 || h === 1; // this cycle ends the section
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const pass = S.reg.endsWith("2") ? 2 : S.reg.endsWith("3") ? 3 : 1;
      const ev = [];
      const lines = []; // sounding pitched notes (for the accompaniment's clash check): {start, end, note, lead}
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };

      // ---------- tune, octaves, counter, bells ----------
      const artOf = (n) => n.art === "s" ? 0.5 : n.art === "t" ? 0.97 : n.dur <= 0.5 ? 0.72 : n.dur <= 1 ? 0.86 : 0.92;
      function play(track, notes, o = {}) {
        const shift = o.shift || 0;
        let prevNote = o.prev ?? null, restBefore = true;
        notes.forEach((n) => {
          if (n.note == null) { restBefore = true; return; }
          const note = n.note + shift;
          const dur = n.dur * artOf(n);
          const extra = {};
          if (track === "cal") { // steam: a scoop into notes after a rest or a leap, a little drift on every note
            const leap = prevNote == null ? 12 : Math.abs(n.note - prevNote);
            extra.cents = Math.max(-10, Math.min(10, r.gauss(4)));
            extra.scoop = restBefore || leap >= 3 ? -(18 + r() * 22) : -(4 + r() * 6);
          }
          const strong = Math.abs(n.beat % 1.5) < 1e-6;
          // crushed grace note (a semitone below) into a leapt-to long note on a strong beat
          if (o.orn && strong && n.beat > 0 && n.dur >= 1 && prevNote != null && Math.abs(n.note - prevNote) >= 3 && r.chance(0.22)) {
            push(track, n.beat - 0.12, 0.1, note - 1, (o.vel ?? 0.7) * 0.8, { straight: true });
          }
          push(track, n.beat, dur, note, (o.vel ?? 0.7) + (strong ? 0.02 : 0), extra);
          lines.push({ start: n.beat, end: n.beat + dur, note, lead: !!o.lead, track });
          prevNote = n.note; restBefore = false;
        });
      }
      const leadVel = reg.lead === "cal" ? (reg.soft ? 0.62 : 0.7) : (reg.soft ? 0.62 : 0.72);
      const orn = turn >= 1 && pass >= 2 && reg.lead === "flute";
      let mel = P.mel ? (P.bars === 16 ? halfNotes(P.mel, h) : P.mel) : [];
      if (P.pickup && h === 0 && cycle > 0) mel = [{ beat: -0.5, dur: 0.5, note: P.pickup, art: "" }, ...mel];
      if (mel.length) {
        if (S.s === "intro" && reg.lead === "cal") play("cal", mel, { vel: 0.66, lead: true });
        else play(reg.lead, mel, { vel: leadVel, lead: true, orn });
        if (reg.pic) play("pic", mel, { vel: S.s === "tag" ? 0.42 : 0.5, shift: 12 });
        if (reg.glock) mel.filter((n) => n.note != null && n.beat >= 0 && n.dur >= 1 && Math.abs(n.beat % 1.5) < 1e-6)
          .forEach((n) => { push("glock", n.beat, Math.min(n.dur, 1.5), n.note + 12, 0.4); lines.push({ start: n.beat, end: n.beat + 0.4, note: n.note + 12 }); });
      }
      if (reg.counter && P.counter) play("counter", P.bars === 16 ? halfNotes(P.counter, h) : P.counter, { vel: 0.56 });
      if (P.cal) play("cal", P.cal, { vel: 0.68, lead: true });
      if (P.glock) P.glock.filter((n) => n.note != null).forEach((n) => { push("glock", n.beat, n.dur, n.note, 0.42); lines.push({ start: n.beat, end: n.beat + Math.min(n.dur, 0.5), note: n.note }); });

      // the lowest tune note around abs: the afterbeat chords must stay at least a minor third below it
      function ceilingAt(abs) {
        const lead = lines.filter((l) => l.lead && l.start <= abs + 0.01 && l.end > abs + 0.01).map((l) => l.note);
        const near = lead.length ? lead : lines.filter((l) => l.lead && Math.abs(l.start - abs) <= 1.01).map((l) => l.note);
        return Math.min(71, (near.length ? Math.min(...near) : 74) - 3);
      }
      const semitone = (a, b) => [1, 11].includes(mod12(a - b));

      // ---------- bass pipes: oom on the two dotted beats, walk-ups into every new strain ----------
      const targetOf = (key) => T.chord(PH[key].prog[0].chord);
      const nextKey = N.s, walkScale = nextKey === "T" || nextKey === "vamp" ? SCALE_F : SCALE_C;
      const walk = lastCycle && S.s !== "tag";
      /** The chord that follows bar `bar` of this cycle (looking into the strain's next half or the next section). */
      function chordAfter(bar) {
        const inCycle = prog.find((x) => x.bar === bar + 1);
        if (inCycle) return inCycle;
        if (bar === 7 && P.bars === 16 && h === 0) return P.prog.find((x) => x.bar === 8);
        if (bar === 7) return PH[nextKey].prog[0];
        return null;
      }
      function pickBass(pc, from, lo = 36, hi = 52) {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.35 * Math.abs(m - 44); if (s < bs) { bs = s; best = m; } }
        return best;
      }
      const bassAt = (abs, n, dur, vel) => { push("bass", abs, dur, n, vel); state.bass = n; };
      const firstBass = (pc) => { // the note a walk-up promised, else the nearest
        const t = state.bassTarget; state.bassTarget = null;
        return t != null && mod12(t) === pc ? t : pickBass(pc, state.bass);
      };
      const fifthOf = (c) => mod12(c.root + (c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7));
      const fanfare = S.s === "intro" ? 4 : 0;
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        const here = prog.filter((e) => e.bar === bar);
        if (bar < fanfare) { // fanfare: held pedal notes
          const n = bar === 0 ? firstBass(T.chord(here[0].chord).bass) : pickBass(T.chord(here[0].chord).bass, state.bass);
          bassAt(B, n, bar === 3 ? 1.4 : 2.85, 0.72);
          continue;
        }
        if (S.s === "tag" && bar >= 6) { // tonic held, then the stinger
          const n = pickBass(0, state.bass, 36, 43);
          if (bar === 6) bassAt(B, n, 2.85, 0.72); else push("bass", B, 0.4, [n, n + 12], 0.78);
          continue;
        }
        const isLastBar = bar === 7 && walk;
        here.forEach((e, k) => {
          const c = T.chord(e.chord), s0 = B + e.beat;
          if (e.dur < 3) { // two chords in the bar: each gets its bass (the fifth, if the bass would repeat)
            const prevE = k > 0 ? T.chord(here[k - 1].chord) : null;
            const pc = prevE && prevE.bass === c.bass ? fifthOf(c) : c.bass;
            bassAt(s0, bar === 0 && k === 0 ? firstBass(pc) : pickBass(pc, state.bass), 0.9, 0.7);
            return;
          }
          if (isLastBar) {
            // three eighths stepping up into the next strain's first bass note
            const tpc = targetOf(nextKey).bass;
            let bestT = null, bs = Infinity;
            for (const t of T.notesIn([tpc], 38, 52)) {
              const x1 = T.step(t, -3, walkScale);
              const sc = Math.abs(t - state.bass) + 0.35 * Math.abs(t - 44);
              if (x1 >= 35 && sc < bs) { bs = sc; bestT = t; }
            }
            const x1 = T.step(bestT, -3, walkScale);
            bassAt(s0, bar === 0 ? firstBass(c.bass) : pickBass(c.bass, x1), 1.4, 0.72);
            [3, 2, 1].forEach((k2, i) => bassAt(s0 + 1.5 + 0.5 * i, T.step(bestT, -k2, walkScale), 0.42, 0.66 + 0.03 * i));
            state.bassTarget = bestT;
            return;
          }
          const n0 = bar === 0 ? firstBass(c.bass) : pickBass(c.bass, state.bass);
          bassAt(s0, n0, 0.9, bar % 2 === 0 ? 0.74 : 0.7);
          // second dotted beat: the fifth; on a dominant resolving up a fourth, its third (a leading tone);
          // under a cadential 6-4 or a diminished chord the bass holds; under an inverted chord, the root's fifth
          const nx = chordAfter(bar), nc = nx ? T.chord(nx.chord) : null;
          const thirdPc = c.intervals.includes(4) ? mod12(c.root + 4) : null;
          const lastOfChord = !nx || nx.chord !== e.chord;
          // candidates, by preference; then penalties for exposed parallels with the tune or the counter
          const cands = [];
          const add = (m, pref) => { if (m != null && m >= 36 && m <= 52) cands.push({ m, pref }); };
          const slash = c.bass !== c.root, sixFour = slash && mod12(c.bass - c.root) === 7;
          if (nc && lastOfChord && thirdPc != null && !slash && mod12(nc.bass - c.root) === 5 && (c.kind === "dominant" || c.kind === "major") && nc.bass === nc.root) add(pickBass(nc.bass, n0) - 1, 0);
          if (c.kind === "dim7" || c.kind === "dim" || sixFour) add(n0, 0.3);
          T.notesIn([fifthOf(c)], 36, 52).filter((m) => m !== n0 && Math.abs(m - n0) <= 9).forEach((m) => add(m, sixFour ? 9 : 0.5 + 0.04 * Math.abs(m - 43)));
          const third = c.intervals.includes(4) ? 4 : c.intervals.includes(3) ? 3 : null;
          if (third != null && c.kind !== "dim7") T.notesIn([mod12(c.root + third)], 36, 52).filter((m) => m !== n0 && Math.abs(m - n0) <= 9).forEach((m) => add(m, 1.8));
          if (slash) T.notesIn([c.root], 36, 52).filter((m) => Math.abs(m - n0) <= 9).forEach((m) => add(m, 1.5));
          else add(n0 + 12 <= 52 ? n0 + 12 : n0 - 12, 2.2);
          const isLead = (x) => x.lead, isCounter = (x) => x.track === "counter";
          const ahead = s0 + 3 >= 24 && P.bars === 16 && h === 0; // look into the strain's second half
          const voiceAt = (pred, t) => {
            if (t >= 24) {
              if (!ahead) return null;
              const src = pred === isLead ? P.mel : reg.counter ? P.counter : null;
              const n = src && src.find((x) => x.note != null && x.beat <= t + 0.01 && x.beat + x.dur > t + 0.01);
              return n ? n.note : null;
            }
            const l = lines.find((x) => pred(x) && x.start <= t + 0.01 && x.end > t + 0.01);
            return l ? l.note : null;
          };
          const nbBar = nc && (s0 + 3 < 24 || ahead) ? pickBass(nc.bass, n0) : null;
          const parallel = (v0, b0, v1, b1) => v0 != null && v1 != null && b0 != null && b1 != null && v0 !== v1 && b0 !== b1 &&
            Math.sign(v1 - v0) === Math.sign(b1 - b0) && mod12(v0 - b0) === mod12(v1 - b1) && [0, 7].includes(mod12(v0 - b0));
          let n1 = n0, best = Infinity;
          for (const { m, pref } of cands) {
            let sc = pref;
            for (const pred of [isLead, isCounter]) {
              const v0 = voiceAt(pred, s0), v1 = voiceAt(pred, s0 + 1.5), v2 = nbBar != null ? voiceAt(pred, s0 + 3) : null;
              if (parallel(v0, n0, v1, m)) sc += 6;
              if (parallel(v1, m, v2, nbBar)) sc += 6;
              if (pred === isLead && thirdPc != null && mod12(m) === thirdPc && v1 != null && mod12(v1) === thirdPc) sc += 3; // doubled leading tone
            }
            if (sc < best) { best = sc; n1 = m; }
          }
          bassAt(s0 + 1.5, n1, 0.9, 0.64);
        });
      }

      // ---------- afterbeat chords ----------
      const chordVel = reg.soft ? 0.38 : 0.46;
      function hitChord(abs, dur, vel, n = 3, sus = false) {
        const s = sym(abs), ceil = sus ? 70 : ceilingAt(abs);
        const c = T.chord(s);
        let v = T.voice(s, { lo: 53, hi: ceil, n, prev: state.cv, top: [ceil - 6, ceil], omitBass: true, rootless: c.bass === c.root });
        state.cv = v;
        const sounding = lines.filter((l) => l.start <= abs + 0.01 && l.end > abs + 0.01 && l.end - l.start > 0.2).map((l) => l.note);
        const ok = (m) => !sounding.some((x) => semitone(x, m));
        const removed = v.filter((m) => !ok(m));
        v = v.filter(ok);
        // a passing tone in the tune thinned the chord: refill from the other chord tones (even the bass's)
        while (v.length < 2 && removed.length) {
          const want = removed.shift();
          const fill = T.notesIn(c.pcs, 53, ceil).filter((m) => ok(m) && !v.includes(m)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
          if (fill != null) v = [...v, fill].sort((a, b) => a - b);
        }
        if (v.length) push("chords", abs, dur, v, vel);
      }
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        if (bar < fanfare) { hitChord(B, bar === 3 ? 1.4 : 2.85, 0.5, 4, true); continue; }
        if (S.s === "tag" && bar === 6) { hitChord(B, 2.85, 0.44, 4, true); continue; }
        if (S.s === "tag" && bar === 7) { push("chords", B, 0.4, [55, 60, 64, 67], 0.55); continue; }
        hitChord(B + 1, 0.42, chordVel + 0.03);
        if (!(bar === 7 && walk)) hitChord(B + 2.5, 0.42, chordVel);
      }
      if (S.s === "tag") { push("flute", 7 * BPB, 0.4, [72, 76, 79, 84], 0.68); push("pic", 7 * BPB, 0.4, 96, 0.45); }

      // ---------- the drum ----------
      const lvl = reg.drums;
      const roll = (from, to, v0, v1) => { for (let t = from; t < to - 1e-6; t += 0.125) push("drums", t, 0.1, "roll", v0 + (v1 - v0) * (t - from) / (to - from), { straight: true }); };
      const startsSection = h === 0;
      if (reg.crash && startsSection && (pass >= 2 || S.s === "brk" || S.s === "intro")) push("drums", 0, 0.5, "cym", 0.55);
      if (S.s === "T" && pass === 2 && h === 1 && lvl >= 2) push("drums", 0, 0.5, "cym", 0.42); // the Bb arrival
      if (S.s === "brk") push("drums", 4 * BPB, 0.5, "cym", 0.42);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        if (S.s === "tag" && bar === 7) { push("drums", B, 0.3, "bd", 0.8); push("drums", B, 0.5, "cym", 0.5); continue; }
        if (S.s === "tag" && bar === 6) { push("drums", B, 0.3, "bd", 0.5); continue; }
        let rollKind = null;
        if (bar === 7 && lastCycle && S.s !== "tag") rollKind = "long";
        else if (S.s === "intro" && bar === 3) rollKind = "long";
        else if (S.s === "brk" && (bar === 1 || bar === 5)) rollKind = "short";
        else if (bar === 7 && lvl >= 2) rollKind = "short"; // half cadence in the middle of a strain
        const accent = bar === 0 && startsSection ? 0.1 : 0;
        if (lvl === 0) push("drums", B, 0.3, "bd", 0.4 + accent);
        else push("drums", B, 0.3, "bd", 0.6 + accent + (bar % 2 === 0 ? 0.04 : 0));
        if (lvl >= 2) push("drums", B + 1.5, 0.3, "bd", 0.42);
        if (lvl >= 2 && !rollKind) {
          if (lvl >= 3) push("drums", B + 1, 0.1, "sn", 0.16);
          push("drums", B + 2.5, 0.1, "sn", 0.21);
          if (lvl >= 3 && r.chance(0.15)) push("drums", B + 2, 0.1, "sn", 0.11);
        }
        if (rollKind === "long") roll(B + 1.5, B + 3, lvl === 0 ? 0.1 : 0.14, lvl === 0 ? 0.3 : 0.48);
        else if (rollKind === "short") roll(B + 2, B + 3, 0.14, 0.38);
      }

      // ---------- label ----------
      const who = reg.lead === "cal" ? "steam calliope" : "flute pipes";
      let label;
      if (S.s === "intro") label = `Intro · fanfare${reg.lead === "cal" ? " on the calliope" : " in octaves"}, then vamp till ready`;
      else if (S.s === "vamp") label = "Vamp · calliope and bells, walking home to C";
      else if (S.s === "tag") label = "Tag · a last wistful iv, and the stinger";
      else if (S.s === "brk") label = "Break strain · A minor over a lament bass · snare rolls";
      else {
        const time = S.s === "A" && pass === 3 ? "da capo" : pass === 2 ? "2nd time" : "1st time";
        const parts = [who + (reg.pic ? " in octaves" : "")];
        if (reg.counter && P.counter) parts.push("trombone counter");
        if (reg.glock) parts.push("bells");
        label = `${NAME[S.s]} · ${time} · ${parts.join(" + ")}`;
      }
      return { events: ev, harmony: prog, section: `Turn ${turn + 1} · ${label}`, state };
    },
  });
})();
