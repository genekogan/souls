// Ridge Road: a string band on a mountain road at morning. Bluegrass, G major, cut time at 116 (a beat is a half
// note, every eighth is 0.25 of a beat), no drum kit: the band is the rhythm. Built on Sim.phrasing: the fiddle is a
// sawtooth through a formant chain whose scoops, slides and shuffle accents are written into the tune; a Scruggs
// banjo (PluckSynth) takes the second break with the rolls written out as eighth-note string patterns.
//
// THE TUNE ("Ridge Road", an original reel in two strains, AABB; the generator never changes a pitch or a rhythm)
// Marks: ^ scoop in from below   ~ slide in from the previous note   > shuffle-bow accent (the "and" of 2 and 4)
//        _ tenuto   v vibrato   s swell.  Pickups are two eighths at the end of the previous bar.
//
// A (the climb)            pickup: D4 E4
//   1 |G    | G4 A4 B4 D5> E5 D5 B4 A4>     the road: up the G scale skipping the fourth, over the top on the sixth
//   2 |G    | B4(q)^ G4 A4 B4 A4 G4 E4>     the scooped quarter and the turn down to the low E
//   3 |C    | E4 G4 C5 E5> D5 C5 B4 A4>     the climb again through the C arpeggio, from the bottom of the A string
//   4 |D    | B4(q)~ A4 F#4 D4(q)_ D4 E4    slide into B, down to the open D; half cadence; the pickup again
//   5-6 = 1-2
//   7 |C D  | E4 G4 C5 E5> D5 B4 A4 F#4>   the C arpeggio up and the D arpeggio down
//   8 |G    | G4(q)> B4 A4 G4(q)_ [pickup] the cadence, shared by both strains
// B (the view from the ridge)   pickup: A4 B4
//   1 |G    | D5(q)^ B4 D5 G5(q)^ F#5 G5>   two scooped quarters: the shuffle figure (long short short) twice
//   2 |G    | A5> G5 F#5 G5 E5 D5 B4 D5>    the roll down from the top
//   3 |F    | F5(q)^ E5 D5 C5(q) A4 C5>     the mountain note: F natural over the bVII chord
//   4 |C    | E5(q)~ C5 E5 G5(q) E5 D5>     slide into the third of C
//   5 = 1    6 |G| A5> G5 F#5 G5 E5 D5 B4 A4>
//   7 |C D  | C5 E5 G5 E5> D5 B4 A4 F#4>   the same figure as A bar 7, an octave up in the first half
//   8 |G    | G4(q)> B4 A4 G4(q)_ [pickup]
// TAG (4 bars, played in the lifted key): the climb, a C-then-D arpeggio that leads F#5 up to a held G5, a breath,
//   and the pickup D4 E4 back into the top of the tune in G.
//
// FORM (one lap, 23 cycles of 4 bars, 1:35; a 4-bar count-in before the first lap only):
//   fiddle AABB · banjo break AABB (rolls through the melody notes, 5th string on the off-eighths) ·
//   low break: B an octave down on the fiddle's low strings under a high mandolin tremolo, the chop drops out
//   (the A strain dips to D4, an octave down it would leave the fiddle, so the low break is the B strain) ·
//   lift AB up a whole step to A for the last fiddle chorus · tag.
// Per lap the generator changes which strains get the double-stop drones, which banjo rolls and fills, whether the
// fiddle plays long-bow double stops under the banjo, where the bass walks, and the dynamics. Never the tune.
(function () {
  "use strict";
  const T = Sim.theory, P = Sim.phrasing;
  const BPB = 2, BPM = 116, CYC = 4, E8 = 0.25;
  const db = (x) => Math.pow(10, x / 20);
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const trSym = (sym, k) => (k ? sym.replace(/^([A-G][#b]?)/, (_, n) => SHARP[mod(T.PC[n] + k, 12)]) : sym);

  // ---------- the tune ----------
  const A_LINE = [
    "G4/0.25 A4/0.25 B4/0.25 D5/0.25> E5/0.25 D5/0.25 B4/0.25 A4/0.25>",
    "B4/0.5^ G4/0.25 A4/0.25 B4/0.25 A4/0.25 G4/0.25 E4/0.25>",
    "E4/0.25 G4/0.25 C5/0.25 E5/0.25> D5/0.25 C5/0.25 B4/0.25 A4/0.25>",
    "B4/0.5~ A4/0.25 F#4/0.25 D4/0.5_ D4/0.25 E4/0.25",
    "G4/0.25 A4/0.25 B4/0.25 D5/0.25> E5/0.25 D5/0.25 B4/0.25 A4/0.25>",
    "B4/0.5^ G4/0.25 A4/0.25 B4/0.25 A4/0.25 G4/0.25 E4/0.25>",
    "E4/0.25 G4/0.25 C5/0.25 E5/0.25> D5/0.25 B4/0.25 A4/0.25 F#4/0.25>",
    "G4/0.5> B4/0.25 A4/0.25 G4/0.5_ r/0.5",
  ];
  const B_LINE = [
    "D5/0.5^ B4/0.25 D5/0.25 G5/0.5^ F#5/0.25 G5/0.25>",
    "A5/0.25> G5/0.25 F#5/0.25 G5/0.25 E5/0.25 D5/0.25 B4/0.25 D5/0.25>",
    "F5/0.5^ E5/0.25 D5/0.25 C5/0.5 A4/0.25 C5/0.25>",
    "E5/0.5~ C5/0.25 E5/0.25 G5/0.5 E5/0.25 D5/0.25>",
    "D5/0.5^ B4/0.25 D5/0.25 G5/0.5^ F#5/0.25 G5/0.25>",
    "A5/0.25> G5/0.25 F#5/0.25 G5/0.25 E5/0.25 D5/0.25 B4/0.25 A4/0.25>",
    "C5/0.25 E5/0.25 G5/0.25 E5/0.25> D5/0.25 B4/0.25 A4/0.25 F#4/0.25>",
    "G4/0.5> B4/0.25 A4/0.25 G4/0.5_ r/0.5",
  ];
  const TAG_LINE = [
    "G4/0.25 A4/0.25 B4/0.25 D5/0.25> E5/0.25 D5/0.25 B4/0.25 A4/0.25>",
    "G4/0.25 C5/0.25 E5/0.25 G5/0.25> A5/0.25 F#5/0.25 D5/0.25 F#5/0.25>",
    "G5/2_v",
    "r/2",
  ];
  // descant: the mandolin's held note per bar (two in bar 7) tremoloed over the low break; it only plays the B strain
  const STRAIN = {
    A: { chords: "| G | G | C | D | G | G | C D | G |", line: A_LINE, pick: [62, 64] },
    B: { chords: "| G | G | F | C | G | G | C D | G |", line: B_LINE, pick: [69, 71], descant: [[86], [83], [84], [88], [86], [83], [84, 81], [79]] },
    tag: { chords: "| G | C D | G | G |", line: TAG_LINE, pick: [62, 64] },
    intro: { chords: "| G | G | C | D |", line: null },
  };
  const PROG = Object.fromEntries(Object.entries(STRAIN).map(([k, v]) => [k, T.progression(v.chords, BPB).map((c) => ({ ...c, start: c.bar * BPB + c.beat }))]));
  const PHR8 = [0, 4, 8, 12].map((f) => ({ from: f, to: f + 4, dyn: "arch" }));
  const PHR = { A: PHR8, B: PHR8, tag: [{ from: 0, to: 8, dyn: "<" }] };
  // chord functions relative to the key (G: 7 = I, 0 = IV, 2 = V, 5 = bVII)
  const FN = { 7: "I", 0: "IV", 2: "V", 5: "bVII" };
  // the fiddle's open-string drone under each strain (the lower note of the double stop), in G
  const DRONE = { A: { I: 62, IV: 67, V: 62 }, B: { I: 62, IV: 67, V: 69 } };
  // long-bow double stops the fiddle holds under the banjo break, in G
  const LONG = { I: [62, 71], IV: [67, 76], V: [69, 74], bVII: [69, 72] };
  // banjo: open G (D3 G3 B3 D4) fretted up to the chord, the fifth string a G4 above
  const OPEN = [50, 55, 59, 62];
  const FIFTH = 67;
  const ROLLS = { // strings per eighth: 1 = high D, 2 = B, 3 = G, 4 = low D, 5 = the drone string
    forward: [3, 2, 1, 5, 2, 1, 5, 1], backward: [1, 2, 5, 1, 2, 5, 1, 2], fwdRev: [3, 2, 1, 5, 1, 2, 3, 1],
    altThumb: [3, 2, 5, 1, 4, 2, 5, 1], square: [3, 5, 2, 5, 1, 5, 2, 5], vamp: [0, 0, 31, 0, 0, 0, 31, 0],
  };
  const ROLL_STYLES = {
    classic: [["forward", 4], ["backward", 2], ["fwdRev", 2], ["altThumb", 1.5], ["square", 1]],
    busy: [["forward", 3], ["fwdRev", 3], ["square", 2.5], ["altThumb", 2], ["backward", 1]],
    open: [["altThumb", 3], ["backward", 2], ["forward", 2], ["vamp", 2.5], ["square", 1]],
  };

  // ---------- form ----------
  const SECTIONS = [
    { id: "fA1", strain: "A", lead: "fiddle", key: 0, oct: 0, gain: 0.9, orn: 0 }, { id: "fA2", strain: "A", lead: "fiddle", key: 0, oct: 0, gain: 0.95, orn: 0.35 },
    { id: "fB1", strain: "B", lead: "fiddle", key: 0, oct: 0, gain: 1, orn: 0.15 }, { id: "fB2", strain: "B", lead: "fiddle", key: 0, oct: 0, gain: 1, orn: 0.4 },
    { id: "bA1", strain: "A", lead: "banjo", key: 0, oct: -12, gain: 0.95 }, { id: "bA2", strain: "A", lead: "banjo", key: 0, oct: -12, gain: 0.97 },
    { id: "bB1", strain: "B", lead: "banjo", key: 0, oct: -12, gain: 1 }, { id: "bB2", strain: "B", lead: "banjo", key: 0, oct: -12, gain: 1 },
    { id: "lowB", strain: "B", lead: "fiddle", key: 0, oct: -12, gain: 0.82, orn: 0.1 },
    { id: "liftA", strain: "A", lead: "fiddle", key: 2, oct: 0, gain: 1.04, orn: 0.45 }, { id: "liftB", strain: "B", lead: "fiddle", key: 2, oct: 0, gain: 1.08, orn: 0.5 },
    { id: "tag", strain: "tag", lead: "fiddle", key: 2, oct: 0, gain: 1.05 },
  ];
  const INTRO = { id: "intro", strain: "intro", lead: null, key: 0, oct: 0, gain: 0.85 };
  const barsOf = (strain) => (strain === "A" || strain === "B" ? 8 : 4);
  const CYCLES = [];
  SECTIONS.forEach((s) => { const n = barsOf(s.strain) / CYC; for (let h = 0; h < n; h++) CYCLES.push({ s, half: h, last: h === n - 1 }); });
  const NAMES = {
    intro: "Count-in", fA1: "Fiddle · A", fA2: "Fiddle · A again", fB1: "Fiddle · B, the ridge", fB2: "Fiddle · B again",
    bA1: "Banjo break · A", bA2: "Banjo break · A again", bB1: "Banjo break · B", bB2: "Banjo break · B again",
    lowB: "Low break · B on the low strings", liftA: "Lift to A · A", liftB: "Lift to A · B", tag: "Tag",
  };
  // per-lap arrangement plans
  const PLANS = [
    { stops: ["fA2", "liftB"], longBow: ["bB2"], rolls: "classic", walk: 0.45, fill: 0.5, chopSkip: 0.06, lowBanjo: true },
    { stops: ["fB2", "liftA", "liftB"], longBow: ["bA2", "bB2"], rolls: "busy", walk: 0.65, fill: 0.7, chopSkip: 0.03, lowBanjo: false },
    { stops: ["fA2", "fB2"], longBow: [], rolls: "open", walk: 0.35, fill: 0.4, chopSkip: 0.1, lowBanjo: true },
  ];

  // ---------- the palette ----------
  /** Round-robin pool of plucked voices, each behind its own velocity gain (the library's pool is not exported). */
  function pool(ctx, I, make, size, dest) {
    const voices = Array.from({ length: size }, () => {
      const g = ctx.keep(new Tone.Gain(1)).connect(dest);
      const v = ctx.keep(make()); v.connect(g);
      return { v, g, mono: I.monotonic(g) };
    });
    let i = 0;
    return (time, hz, dur, vel) => {
      const { v, g, mono } = voices[i++ % size];
      const t = mono(time);
      g.gain.setValueAtTime(clamp(Number.isFinite(vel) ? vel : 0.5, 0.02, 1), t);
      v.triggerAttackRelease(hz, Math.max(0.03, dur), t);
    };
  }
  /** Fiddle: a sawtooth with a slow filter bite (the bow), then a body: a 450 Hz hump and the 2.7 kHz bridge hill. */
  function fiddleSource(ctx, dest) {
    // `out` is the highpass: P.wrap chains it into its own vibrato/tremolo/gain, so it connects to `dest` only when given
    // (the lint's Tone mock accepted connect(undefined); real Tone throws "Cannot connect to undefined node")
    const hp = ctx.keep(new Tone.Filter({ frequency: 170, type: "highpass", rolloff: -12 }));
    if (dest) hp.connect(dest);
    const hill = ctx.keep(new Tone.Filter({ frequency: 2700, type: "peaking", Q: 1.8, gain: 7 })).connect(hp);
    const body = ctx.keep(new Tone.Filter({ frequency: 450, type: "peaking", Q: 1.2, gain: 3 })).connect(hill);
    const synth = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", rolloff: -24, Q: 1 },
      envelope: { attack: 0.04, decay: 0.15, sustain: 0.82, release: 0.1 },
      filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.12, baseFrequency: 900, octaves: 1.6 },
    })).connect(body);
    return { synth, out: hp };
  }
  /** Banjo: Karplus-Strong with a hard attack, a tight head resonance and a bright ring. */
  function banjo(ctx, I, dest, o = {}) {
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? 0))).connect(dest);
    const hp = ctx.keep(new Tone.Filter({ frequency: 140, type: "highpass", rolloff: -12 })).connect(out);
    const ring = ctx.keep(new Tone.Filter({ frequency: 2600, type: "peaking", Q: 1.5, gain: 5 })).connect(hp);
    const head = ctx.keep(new Tone.Filter({ frequency: 380, type: "peaking", Q: 2, gain: 2 })).connect(ring);
    const trig = pool(ctx, I, () => new Tone.PluckSynth({ attackNoise: 3, dampening: 7000, resonance: 0.88, release: 0.6 }), 10, head);
    return { out, play(time, notes, dur, vel = 0.7) { (Array.isArray(notes) ? notes : [notes]).forEach((m, i) => trig(time + i * 0.006, T.hz(m), dur, vel)); } };
  }
  /** Mandolin: paired courses (two plucks a few cents apart); chop = muted, trem = ringing. */
  function mandolin(ctx, I, dest, o = {}) {
    const out = ctx.keep(new Tone.Gain(db(o.volume ?? 0))).connect(dest);
    const eq = ctx.keep(new Tone.Filter({ frequency: 3200, type: "peaking", Q: 1.2, gain: 4 })).connect(out);
    const hp = ctx.keep(new Tone.Filter({ frequency: 220, type: "highpass", rolloff: -12 })).connect(eq);
    const chop = pool(ctx, I, () => new Tone.PluckSynth({ attackNoise: 2.4, dampening: 3200, resonance: 0.55, release: 0.1 }), 8, hp);
    const ring = pool(ctx, I, () => new Tone.PluckSynth({ attackNoise: 1.8, dampening: 6500, resonance: 0.93, release: 0.8 }), 12, hp);
    const course = (trig, time, m, dur, vel) => { trig(time, T.hz(m), dur, vel); trig(time + 0.004, T.hz(m) * 1.004, dur, vel * 0.85); };
    return {
      out,
      chop(time, notes, dur, vel = 0.6) { (Array.isArray(notes) ? notes : [notes]).forEach((m, i) => course(chop, time + i * 0.003, m, dur, vel * (1 - i * 0.05))); },
      ring(time, notes, dur, vel = 0.6, strum = 0) { (Array.isArray(notes) ? notes : [notes]).forEach((m, i) => course(ring, time + i * strum, m, dur, vel)); },
    };
  }

  Sim.register({
    id: "ridge-road",
    title: "Ridge Road",
    genre: "Bluegrass",
    about: "A string band on a mountain road at morning. One hand-written reel in G, two strains AABB in cut time at 116, no drums: the band is the rhythm. The fiddle (a sawtooth through a formant body, built on the phrasing engine) plays it with scoops, slides, open-string double-stop drones and shuffle-bow accents; a Scruggs banjo takes the second break, rolling through the melody notes with the fifth string on the off-eighths; mandolin chop on 2 and 4, upright bass in two with walkups at the changes. A low break puts the fiddle on the G string under a high mandolin tremolo, the last chorus lifts a whole step to A, and a tag lands before the pickup back into the top. Rolls, fills, double stops, walkups and dynamics change every lap; the tune never does.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.54, swingUnit: E8, cycleBars: CYC, gainDb: 0,
    situations: ["explore", "campfire", "hangout"],
    energy: 0.55,

    instruments(ctx) {
      const { I, out } = ctx;
      const porch = I.reverb(ctx, out, { decay: 1.2, preDelay: 0.01, lowcut: 250, highcut: 6500 });
      const fid = P.wrap(ctx, fiddleSource(ctx), { volume: -3, glide: 0.06, scoopTime: 0.08, fallTime: 0.2, release: 0.1, staccatoRelease: 0.04, accentBright: 0.5,
        vibrato: { rate: 5, depth: 0.1, delay: 0.22, rise: 0.35, deepen: 1.2 } });
      const fid2 = P.wrap(ctx, fiddleSource(ctx), { volume: -10, glide: 0.06, scoopTime: 0.08, release: 0.1, vibrato: { rate: 4.8, depth: 0.05, delay: 0.3 } });
      const bjo = banjo(ctx, I, out, { volume: -5 });
      const mdo = mandolin(ctx, I, out, { volume: -9 });
      const bass = I.upright(ctx, { volume: -4, base: 150 });
      const fP = I.place(ctx, fid, -0.15, out), f2P = I.place(ctx, fid2, -0.2, out);
      const bjP = I.place(ctx, bjo, 0.32, out), mdP = I.place(ctx, mdo, -0.38, out), bsP = I.place(ctx, bass, 0.05, out);
      I.send(ctx, fP, porch, -14); I.send(ctx, f2P, porch, -16); I.send(ctx, bjP, porch, -18); I.send(ctx, mdP, porch, -15); I.send(ctx, bsP, porch, -30);
      return {
        fiddle: { layer: "melody", play: (t, e, d) => fid.play(t, e, d), humanize: { timing: 0.008, vel: 0.05 } },
        fiddle2: { layer: "melody", play: (t, e, d) => fid2.play(t, e, d), humanize: { timing: 0.01, vel: 0.06 } },
        longbow: { layer: "harmony", play: (t, e, d) => { const n = Array.isArray(e.note) ? e.note : [e.note, e.note]; fid2.play(t, { ...e, note: n[0] }, d); fid.play(t, { ...e, note: n[n.length - 1] }, d); }, humanize: { timing: 0.012, vel: 0.05 } },
        banjo: { layer: "melody", play: (t, e, d) => bjo.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.08 } },
        banjoRoll: { layer: "harmony", play: (t, e, d) => bjo.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.1 } },
        mando: { layer: "harmony", play: (t, e, d) => (e.ring ? mdo.ring(t, e.note, d, e.vel, e.strum || 0) : mdo.chop(t, e.note, d, e.vel)), humanize: { timing: 0.005, vel: 0.08 } },
        mandoTrem: { layer: "texture", play: (t, e, d) => mdo.ring(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.12 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.007, vel: 0.05 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const n = CYCLES.length;
      let lap, cur, nxt;
      if (cycle === 0) { lap = 0; cur = { s: INTRO, half: 0, last: true }; nxt = CYCLES[0]; }
      else { const c = cycle - 1; lap = Math.floor(c / n); cur = CYCLES[c % n]; nxt = CYCLES[(c + 1) % n]; }
      const { s, half } = cur;
      const plan = PLANS[lap % PLANS.length];
      const key = s.key, gain = s.gain;
      const bars = barsOf(s.strain);
      const prog = PROG[s.strain].map((c) => ({ ...c, chord: trSym(c.chord, key) }));
      const h0 = half * CYC * BPB;
      const spans = prog.filter((c) => c.start >= h0 && c.start < h0 + CYC * BPB);
      const chordAt = (b) => { let c0 = prog[0]; for (const c of prog) { if (c.start <= b + 1e-6) c0 = c; else break; } return c0.chord; };
      const fn = (sym) => FN[mod(T.chord(sym).root - key, 12)] || "I";
      const scaleAt = (b) => T.chord(chordAt(b)).scale;
      const ev = [];
      const push = (track, secBeat, dur, note, vel, extra = {}) => {
        const abs = secBeat - h0;
        if (abs < -1e-6 || abs >= CYC * BPB - 1e-6) return;
        const bar = Math.floor(abs / BPB + 1e-9), beat = +(abs - bar * BPB).toFixed(4);
        ev.push({ track, bar, beat, dur: Math.max(0.05, dur), note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      const rr = r.fork(3 + half);

      // ---------- the lead line, built once per section ----------
      const lineKey = `${cycle - half}`;
      if (!state.line || state.line.key !== lineKey) {
        const L = { key: lineKey, fiddle: null, raw: null };
        if (STRAIN[s.strain].line) {
          const raw = P.line(STRAIN[s.strain].line, { beatsPerBar: BPB, track: s.lead });
          const orn = s.orn ?? 0, ro = r.fork(21);
          raw.forEach((e) => {
            e.note += key + s.oct;
            e.vel = (0.7 + (e.note - key - s.oct - 71) / 90) * gain;
            // later passes ornament the quarter notes: a grace a scale step below (a hammer-on), never on a scoop or slide
            const a = P.parseArt(e.art || "");
            if (s.lead === "fiddle" && e.dur >= 0.5 && e.dur < 2 && !a.scoop && !a.legato && ro.chance(orn)) e.grace = "step";
          });
          L.raw = raw.map((e) => ({ ...e }));
          if (s.lead === "fiddle") L.fiddle = P.articulate(raw, PHR[s.strain], { beatsPerBar: BPB, scale: scaleAt, lengthen: 1, breathLate: 0.012, breathGap: 0.06, accent: 0.14, overlap: 0.04 });
        }
        state.line = L;
      }
      const L = state.line;
      if (L.fiddle) for (const e of L.fiddle) { const { bar, beat, dur, note, vel, track: _t, ...x } = e; push("fiddle", bar * BPB + beat, dur, note, vel, x); }

      // ---------- the pickup into the next section (two eighths at the end of this one) ----------
      let pickWho = null;
      if (cur.last && STRAIN[nxt.s.strain].pick) {
        const ns = nxt.s;
        const notes = STRAIN[ns.strain].pick.map((m) => m + ns.key + ns.oct);
        pickWho = ns.lead === "banjo" || notes[0] < 55 ? "banjo" : "fiddle"; // the banjo announces its own break
        const g = ns.gain;
        notes.forEach((m, i) => push(pickWho, bars * BPB - 0.5 + i * E8, pickWho === "banjo" ? 0.3 : E8, m, (pickWho === "banjo" ? 0.7 : 0.66 + i * 0.06) * g));
      }

      // ---------- the fiddle's double-stop drones (the open string under the tune, shuffle-bowed) ----------
      const stops = s.lead === "fiddle" && s.strain !== "tag" && s.oct === 0 && plan.stops.includes(s.id);
      if (stops) {
        for (const c of spans) {
          const d = DRONE[s.strain][fn(c.chord)];
          if (!d) continue;
          const pat = [[0, 0.5, 0.46], [0.5, 0.25, 0.36], [0.75, 0.25, 0.42], [1, 0.5, 0.46], [1.5, 0.25, 0.36], [1.75, 0.25, 0.42]];
          for (const [at, dur, v] of pat) if (at < c.dur - 1e-6) push("fiddle2", c.start + at, dur - 0.03, d + key, v * gain, at % 1 === 0.75 ? { accent: true } : {});
        }
      }
      // long-bow double stops under the banjo break
      if (s.lead === "banjo" && plan.longBow.includes(s.id)) {
        for (const c of spans) push("longbow", c.start, c.dur - 0.08, LONG[fn(c.chord)].map((m) => m + key), 0.3 * gain, c.beat === 0 && c.bar % 2 === 0 ? { swell: 0.6 } : {});
      }
      if (s.strain === "intro") { // the fiddle tunes up on the last two bars: a swelling long bow into the pickup
        push("longbow", 4, 1.9, LONG.IV, 0.3, { swell: 1 });
        push("longbow", 6, 1.4, LONG.V, 0.36, { swell: 0.5 });
      }

      // ---------- banjo ----------
      const shape = (sym) => { // each open string fretted up to the nearest chord tone, strings kept in ascending order (no unisons)
        const pcs = T.chord(sym).pcs;
        let prev = -1;
        return OPEN.map((p) => { for (let m = Math.max(p, prev + 1); m <= p + 6; m++) if (pcs.includes(mod(m, 12))) { prev = m; return m; } prev = p; return p; });
      };
      const fifth = FIFTH + key;
      const stringNote = (sh, st) => (st === 5 ? fifth : st === 31 ? [sh[1], sh[3]] : sh[4 - st]);
      const reserved = (bar) => (pickWho === "banjo" && bar === bars - 1 ? [6, 7] : []);
      if (s.lead === "banjo") banjoBreak({ L, bars, half, chordAt, scaleAt, shape, fifth, reserved, push, gain, r: rr });
      else banjoBackup({ s, bars, half, chordAt, fn, shape, stringNote, reserved, push, gain, plan, state, r: rr, key });

      // ---------- mandolin: chop on 2 and 4, tremolo descant in the low break, a strum on the tag ----------
      if (s.oct === -12 && s.lead === "fiddle") {
        const desc = STRAIN[s.strain].descant;
        for (let bar = half * CYC; bar < half * CYC + CYC; bar++) {
          const notes = desc[bar];
          notes.forEach((m, i) => {
            const from = i * (BPB / notes.length), len = BPB / notes.length, steps = Math.round(len * 12);
            for (let k = 0; k < steps; k++) {
              const x = k / steps;
              push("mandoTrem", bar * BPB + from + k / 12, 0.1, m + key, (0.34 + 0.16 * Math.sin(Math.PI * Math.min(1, x * 1.2))) * gain, { straight: true });
            }
          });
        }
      } else {
        for (let bar = half * CYC; bar < half * CYC + CYC; bar++) {
          if (s.strain === "tag" && bar >= 2) {
            if (bar === 2) { const v = T.voice(chordAt(4), { lo: 62, hi: 83, n: 4, rng: rr }); push("mando", 4, 1.5, v, 0.7 * gain, { ring: true, strum: 0.018 }); }
            continue;
          }
          for (const at of [0.5, 1.5]) {
            const sym = chordAt(bar * BPB + at);
            const v = T.voice(sym, { lo: 64, hi: 81, n: 3, prev: state.mandoV, rng: rr });
            state.mandoV = v;
            if (at === 1.5 && rr.chance(plan.chopSkip)) continue;
            push("mando", bar * BPB + at, 0.12, v, (0.58 + (at === 1.5 ? 0.03 : 0)) * gain);
            if (at === 1.5 && (s.strain === "B" || key === 2) && rr.chance(0.22)) push("mando", bar * BPB + 1.25, 0.1, v, 0.3 * gain);
          }
        }
      }

      // ---------- bass in two, walkups at the changes ----------
      bassPart({ s, prog, bars, half, chordAt, fn, push, gain, plan, r: r.fork(9), key, nxt });

      const harmony = spans.map((c) => ({ bar: c.bar - half * CYC, beat: c.beat, dur: c.dur, chord: c.chord }));
      const extras = [stops ? "double stops" : "", s.lead === "banjo" && plan.longBow.includes(s.id) ? "fiddle long bow" : "", s.lead !== "banjo" && s.strain !== "intro" ? `${plan.rolls} rolls` : ""].filter(Boolean).join(" · ");
      return { events: ev, harmony, section: `${cycle === 0 ? "" : `Lap ${lap + 1} · `}${NAMES[s.id]}${extras ? " · " + extras : ""}`, state };
    },
  });

  // ---------- the banjo break: the melody notes on their eighths, the roll filling the rest ----------
  function banjoBreak({ L, bars, half, chordAt, scaleAt, shape, fifth, reserved, push, gain, r }) {
    const byBar = {};
    for (const e of L.raw) (byBar[e.bar] ||= []).push(e);
    for (let bar = half * CYC; bar < half * CYC + CYC; bar++) {
      const slots = Array(8).fill(null);
      for (const e of byBar[bar] || []) slots[Math.round(e.beat / E8)] = e;
      const skip = reserved(bar);
      let sounding = null;
      for (let k = 0; k < 8; k++) {
        if (skip.includes(k)) continue;
        const at = bar * BPB + k * E8;
        const e = slots[k];
        if (e) {
          const a = P.parseArt(e.art || "");
          // slides and scoops become a hammer-on: a grace a scale step below, then the note
          if ((a.legato || a.scoop) && e.dur >= 0.5 && r.chance(0.8)) push("banjo", at - 0.09, 0.09, T.step(e.note, -1, scaleAt(at)), 0.5 * gain);
          push("banjo", at, Math.min(e.dur, 0.6), e.note, (0.74 + (a.accent ? 0.1 : 0) + (e.dur >= 0.5 ? 0.04 : 0)) * gain);
          sounding = e;
        } else if (k % 2 === 1) push("banjo", at, 0.3, fifth, 0.42 * gain);
        else {
          const sh = shape(chordAt(at));
          const ref = sounding ? sounding.note : sh[2];
          const below = sh.filter((m) => m < ref - 1).pop() ?? sh[0];
          push("banjo", at, 0.3, below, 0.48 * gain);
        }
      }
    }
  }

  // ---------- banjo backup: rolls under the fiddle, a fill into the next strain, a pinch on the tag ----------
  function banjoBackup({ s, bars, half, chordAt, fn, shape, stringNote, reserved, push, gain, plan, state, r, key }) {
    const soft = s.oct === -12;
    if (soft && !plan.lowBanjo) return; // the low break opens the texture: some laps the banjo sits out
    const entering = s.id === "fA1"; // the first time through, the banjo rolls lightly; it fills out from the second A
    for (let bar = half * CYC; bar < half * CYC + CYC; bar++) {
      if (s.strain === "intro" && bar < 2) continue;
      if (s.strain === "tag" && bar >= 2) {
        if (bar === 2) { const sh = shape(chordAt(4)); push("banjoRoll", 4, 0.6, [sh[1], sh[3], FIFTH + key], 0.75 * gain); }
        continue;
      }
      const skip = reserved(bar);
      const fill = bar === bars - 1 && s.strain !== "tag" && s.strain !== "intro" && !soft && r.chance(plan.fill);
      // the roll: usually the same as last bar, otherwise drawn from the lap's vocabulary
      let roll = state.roll;
      if (!roll || !r.chance(0.6)) roll = r.weighted(ROLL_STYLES[soft || entering ? "open" : plan.rolls]);
      state.roll = roll;
      const pat = ROLLS[roll];
      for (let k = 0; k < 8; k++) {
        if (skip.includes(k)) continue;
        const at = bar * BPB + k * E8;
        if (fill && k >= 4) { // a run up to the next downbeat: A B D E (in G)
          const run = [57, 59, 62, 64][k - 4] + key;
          push("banjoRoll", at, 0.3, run, (0.5 + (k - 4) * 0.06) * gain);
          continue;
        }
        let st = pat[k];
        if (!st) continue;
        const sh = shape(chordAt(at));
        if (st === 5 && k >= 4 && fn(chordAt(at)) === "V") st = 1; // on the back half of a V bar the open fifth string yields to the fretted first (the bass walks under it)
        const note = stringNote(sh, st);
        const v = st === 5 ? 0.34 : st === 31 ? 0.5 : st >= 3 ? 0.46 : 0.4;
        push("banjoRoll", at, st === 31 ? 0.12 : 0.3, note, v * (soft ? 0.7 : entering ? 0.8 : 1) * gain);
      }
    }
  }

  // ---------- upright bass: root on 1, fifth on 3; walkups into the changes; the tag stops dead ----------
  function bassPart({ s, prog, bars, half, chordAt, fn, push, gain, plan, r, key, nxt }) {
    const rootOf = (sym) => { const c = T.chord(sym); return T.nearest(41, [c.bass], 36, 47); };
    const fifthOf = (root, sym) => { const c = T.chord(sym); const pc = mod(c.root + 7, 12); return root >= 40 ? T.nearest(root - 5, [pc], 28, 47) : T.nearest(root + 7, [pc], 28, 50); };
    const walkTo = (root, next) => { // two quarter notes on 3 and 4 leading into the next root, by step
      const d = next - root;
      if (d === 2) return [root, root + 1]; // C C# D
      if (d === 7) return [next - 5, next - 3]; // C D E G (no F# under the banjo's G strings)
      if (d > 0 || d === -2) return [next - 3, next - 1]; // G A B C, D E F# G, G D E F
      return [next + 4, next + 2]; // G E D C, A F# E D
    };
    const vb = 0.8 * Math.min(1, gain), soft = s.oct === -12;
    const walkP = plan.walk * (soft ? 0.5 : s.lead === "banjo" || key === 2 ? 1.25 : 1);
    for (let bar = half * CYC; bar < half * CYC + CYC; bar++) {
      const b0 = bar * BPB;
      if (s.strain === "tag") {
        if (bar === 0) { const rt = rootOf(chordAt(0)); push("bass", 0, 0.9, rt, vb); push("bass", 1, 0.9, fifthOf(rt, chordAt(0)), vb - 0.06); }
        else if (bar === 1) { const c1 = rootOf(chordAt(2)), c2 = rootOf(chordAt(3)); push("bass", 2, 0.9, c1, vb); push("bass", 3, 0.45, c2, vb); push("bass", 3.5, 0.45, rootOf(chordAt(4)) - 1, vb - 0.1); }
        else if (bar === 2) push("bass", 4, 1.8, rootOf(chordAt(4)), vb + 0.05);
        continue;
      }
      const here = prog.filter((c) => c.bar === bar);
      // the chord at the next downbeat: within this section, or the next section's first chord
      const after = bar + 1 < bars ? chordAt((bar + 1) * BPB) : trSym(PROG[nxt.s.strain][0].chord, nxt.s.key);
      if (here.length === 1) {
        const rt = rootOf(here[0].chord), nr = rootOf(after);
        push("bass", b0, 0.9, rt, vb);
        if (nr !== rt && fn(here[0].chord) !== "bVII" && r.chance(walkP)) { // the bVII bar stays root-fifth: a walk out of it rubs the band
          const [w1, w2] = walkTo(rt, nr);
          push("bass", b0 + 1, 0.45, w1, vb - 0.08); push("bass", b0 + 1.5, 0.45, w2, vb - 0.06);
        } else if (r.chance(0.12)) push("bass", b0 + 1, 0.9, rt, vb - 0.1); // a repeated root now and then
        else push("bass", b0 + 1, 0.9, fifthOf(rt, here[0].chord), vb - 0.06);
      } else { // two chords in the bar (C D): roots on 1 and 3, a leading tone on 4 into the next bar
        const r1 = rootOf(here[0].chord), r2 = rootOf(here[1].chord), nr = rootOf(after);
        const lead = r.chance(walkP);
        push("bass", b0, 0.9, r1, vb); push("bass", b0 + 1, lead ? 0.45 : 0.9, r2, vb);
        if (lead) push("bass", b0 + 1.5, 0.45, nr - 1, vb - 0.08);
      }
    }
  }
})();
