// Filter House: late-90s French touch at 124 BPM, F minor (dorian), for the dancefloor.
// The "record" is a two-bar disco loop (Rhodes chops, a string section, horn stabs) that lives behind one
// lowpass filter and a phaser, and everything except the drums breathes against a 909 kick through a
// sidechain pump. The arc is 20 blocks of 8 bars (about 5 minutes): the filter opens over a 24-bar build,
// grooves on two chops of the record with a talkbox hook, drops the kick for a filtered-down breakdown,
// rides a riser back into the drop, strips to drums and bass, and on the second riser lifts the whole
// record a whole step (the DJ's pitch fader) to G minor for the peak before falling back into the build.
(function () {
  "use strict";
  const T = Sim.theory;
  const { mod12 } = T;

  // ---------- the record (written in F minor; transposed by the block's key) ----------
  const LOOP = {
    A: "| Fm9 | Bb13 |",                        // the main chop: dorian vamp
    B: "| Dbmaj9 | Eb13sus4 Eb13 |",            // the other side of the record
    D: "| Dbmaj9 | Cm11 | Bbm9 | Eb13sus4 |",   // breakdown: the bass line falls by steps
    R: "| Dbmaj9 | Eb13sus4 | Dbmaj9 | Eb13sus4 | Bbm9 | Cm11 | Dbmaj9 |", // riser, then TURN in the next key
  };
  const TURN = "| C7#9 |";

  // Chop patterns over 8 beats (two bars of the loop): [beat, dur].
  const CHOPS = {
    stutter: [[0, 1.4], [1.5, 0.4], [2, 1.4], [3.5, 0.4], [4, 1.4], [5.5, 0.4], [6, 0.65], [6.75, 0.2], [7, 0.2], [7.25, 0.2], [7.5, 0.45]],
    disco: [[0, 0.6], [0.75, 0.6], [1.5, 0.45], [2.5, 0.6], [3.25, 0.6], [4, 0.6], [4.75, 0.6], [5.5, 0.45], [6.5, 0.4], [7, 0.4], [7.5, 0.45]],
    offbeat: [[0.5, 0.42], [1.5, 0.42], [2.5, 0.42], [3.5, 0.42], [4.5, 0.42], [5.5, 0.42], [6.5, 0.42], [7.25, 0.2], [7.5, 0.45]],
    held: [[0, 3.9], [4, 3.9]],
    eighths: Array.from({ length: 16 }, (_, i) => [i * 0.5, 0.4]),
    sixteenths: Array.from({ length: 32 }, (_, i) => [i * 0.25, 0.2]),
  };
  const GROOVE_CHOPS = ["stutter", "disco", "offbeat"];
  // Horn stabs over the same 8 beats: answers at the loop's turn.
  const BRASS = [[3.5, 0.3], [6.5, 0.22], [7, 0.22], [7.5, 0.45]];

  // ---------- the talkbox hook (F minor) [bar, beat, dur, note] ----------
  const HOOK_A = [ // call: climbs to the flat third and lands on Bb13's major third (the dorian lift)
    [0, 0.5, 0.5, "Ab4"], [0, 1, 0.75, "C5"], [0, 1.75, 0.25, "Eb5"], [0, 2, 1.25, "F5"], [0, 3.5, 0.5, "Eb5"],
    [1, 0, 0.75, "D5"], [1, 0.75, 0.25, "C5"], [1, 1, 0.5, "Bb4"], [1, 1.5, 1.75, "Ab4"],
    [2, 0.5, 0.5, "Ab4"], [2, 1, 0.75, "C5"], [2, 1.75, 0.25, "Eb5"], [2, 2, 0.75, "F5"], [2, 2.75, 0.25, "G5"], [2, 3, 1, "Ab5"],
    [3, 0, 0.5, "G5"], [3, 0.5, 0.5, "F5"], [3, 1, 2.5, "D5"],
  ];
  const HOOK_A2 = [ // response: same opening, then falls home to the root
    [0, 0.5, 0.5, "Ab4"], [0, 1, 0.75, "C5"], [0, 1.75, 0.25, "Eb5"], [0, 2, 1.25, "F5"], [0, 3.5, 0.5, "Eb5"],
    [1, 0, 0.75, "D5"], [1, 0.75, 0.25, "C5"], [1, 1, 0.5, "Bb4"], [1, 1.5, 1.75, "Ab4"],
    [2, 0.5, 0.5, "Ab4"], [2, 1, 0.75, "C5"], [2, 1.75, 0.25, "Eb5"], [2, 2, 1, "C5"], [2, 3, 0.5, "Bb4"], [2, 3.5, 0.5, "Ab4"],
    [3, 0, 0.75, "G4"], [3, 0.75, 0.75, "Ab4"], [3, 1.5, 2, "Bb4"],
  ];
  const HOOK_B = [ // over the B side: long notes, the sus resolving up to Eb13's third
    [0, 0, 1.25, "F5"], [0, 1.5, 0.5, "Eb5"], [0, 2, 1, "C5"], [0, 3, 0.5, "Ab4"], [0, 3.5, 0.5, "C5"],
    [1, 0, 0.75, "Db5"], [1, 0.75, 0.75, "Eb5"], [1, 1.5, 0.5, "F5"], [1, 2, 1.75, "G5"],
    [2, 0, 0.75, "Ab5"], [2, 0.75, 0.75, "F5"], [2, 1.5, 1.25, "Eb5"], [2, 3, 0.5, "C5"], [2, 3.5, 0.5, "Db5"],
    [3, 0, 0.75, "F5"], [3, 0.75, 0.75, "Eb5"], [3, 1.5, 0.5, "Db5"], [3, 2, 1.75, "Bb4"],
  ];
  const HOOK_D = [ // breakdown: the hook's opening cell, floated over the falling bass
    [0, 0.5, 0.5, "Ab4"], [0, 1, 0.75, "C5"], [0, 1.75, 0.25, "Eb5"], [0, 2, 2, "F5"],
    [1, 1.5, 0.5, "Eb5"], [1, 2, 0.5, "D5"], [1, 2.5, 1.5, "Bb4"],
    [2, 0.5, 0.5, "Ab4"], [2, 1, 0.75, "C5"], [2, 1.75, 0.25, "Db5"], [2, 2, 2, "F5"],
    [3, 1, 0.5, "Eb5"], [3, 1.5, 0.5, "Db5"], [3, 2, 1.75, "Bb4"],
  ];
  const HOOK_D2 = HOOK_D.slice(0, 11).concat([[3, 0, 0.5, "C5"], [3, 0.5, 0.5, "Db5"], [3, 1, 2.75, "F5"]]);
  const HOOKS = { A: [HOOK_A, HOOK_A2], B: [HOOK_B, HOOK_B], D: [HOOK_D, HOOK_D2] };

  // Bass cells for a 4-beat span: [beat, dur, role]  L = low root, H = octave up.
  const BASS = {
    oct: [[0, 0.3, "L"], [0.5, 0.3, "H"], [1, 0.3, "L"], [1.5, 0.3, "H"], [2, 0.3, "L"], [2.5, 0.3, "H"], [3, 0.3, "L"], [3.5, 0.3, "H"]],
    bounce: [[0, 0.3, "L"], [0.5, 0.22, "H"], [0.75, 0.2, "H"], [1.5, 0.3, "H"], [2, 0.3, "L"], [2.5, 0.3, "H"], [3, 0.2, "L"], [3.25, 0.2, "L"], [3.5, 0.3, "H"]],
    gallop: [[0, 0.3, "L"], [0.5, 0.3, "H"], [0.75, 0.2, "L"], [1, 0.3, "L"], [1.5, 0.3, "H"], [2, 0.3, "L"], [2.5, 0.3, "H"], [2.75, 0.2, "L"], [3, 0.3, "L"], [3.5, 0.3, "H"]],
    pulse: [[0.5, 0.3, "L"], [1.5, 0.3, "L"], [2.5, 0.3, "L"], [3.5, 0.3, "L"]],
    long: [[0, 3.6, "L"]],
  };

  const exp8 = (a, b, curve = 1) => Array.from({ length: 8 }, (_, i) => Math.round(a * Math.pow(b / a, Math.pow((i + 1) / 8, curve))));
  const flat = (v) => Array(8).fill(v);
  const OPEN = 7200;

  // ---------- the arc: 20 blocks of 8 bars ----------
  // cut: lowpass target at the end of each bar; from: jump there at the block's start. q: resonance.
  // drums: kick, clap ("late" = from bar 5), oh offbeat open hats, ch closed 16ths, shk shaker, tamb, conga.
  const PLAN = [
    { name: "Intro", d: "the record, muffled", loop: "A", chop: "stutter", cut: exp8(380, 950), q: 2.4, kick: 1, clap: "late", oh: 1, bass: "intro", fill: "clap" },
    { name: "Build", d: "the filter opens", loop: "A", cut: exp8(950, 2300), q: 2.8, kick: 1, clap: 1, oh: 1, shk: 1, bass: "oct", fill: "flam" },
    { name: "Build", d: "almost there", loop: "A", cut: exp8(2300, OPEN, 0.8), q: 2.2, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "oct", strings: 1, fill: "stop" },
    { name: "Groove", d: "wide open", loop: "A", cut: flat(OPEN), q: 1.1, crash: 1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, bass: "bounce", strings: 1, fill: "clap" },
    { name: "Groove", d: "talkbox", loop: "A", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "bounce", strings: 1, hook: "A", fill: "flam" },
    { name: "B side", d: "talkbox", loop: "B", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, conga: 1, bass: "oct", strings: 1, hook: "B", fill: "toms" },
    { name: "Groove", d: "the DJ rides the filter", loop: "A", cut: [OPEN, OPEN, 5200, 2400, 1000, 700, 1900, OPEN], q: 3.2, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, bass: "bounce", fill: "clap" },
    { name: "B side", d: "horns", loop: "B", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "gallop", strings: 1, brass: 1, fill: "stop" },
    { name: "Breakdown", d: "kick out, filter down", loop: "D", chop: "held", from: 1400, cut: exp8(1400, 330), q: 6.5, shkLate: 1, bass: "breakdown", strings: 2, hook: "D", soft: 1, fill: "swell" },
    { name: "Riser", d: "here it comes", loop: "R", from: 330, cut: exp8(330, OPEN, 1.6), q: 1.4, roll: 1, riser: 1, bass: "riser", strings: 1, fill: "gasp" },
    { name: "Drop", d: "everything", loop: "A", rechop: 1, cut: flat(OPEN), q: 1.1, crash: 1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "gallop", strings: 1, hook: "A", brass: 1, fill: "clap" },
    { name: "Groove", d: "talkbox again", loop: "A", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "bounce", strings: 1, hook: "A", vary: 1, fill: "flam" },
    { name: "B side", d: "talkbox", loop: "B", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, conga: 1, bass: "oct", strings: 1, hook: "B", fill: "toms" },
    { name: "Drums & bass", d: "the record lifts off", loop: "A", from: 420, cut: [420, 420, 420, 420, 520, 750, 1100, 1700], q: 4.5, keysFrom: 4, crash: 1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, conga: 1, bass: "gallop", fill: "clap" },
    { name: "Groove", d: "filter back up", loop: "A", cut: exp8(1700, OPEN, 0.7), q: 2.2, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, bass: "bounce", strings: 1, hook: "A", vary: 1, fill: "flam" },
    { name: "B side", d: "horns", loop: "B", cut: flat(OPEN), q: 1.1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, conga: 1, bass: "gallop", strings: 1, brass: 1, fill: "stop" },
    { name: "Breakdown", d: "under water", loop: "D", chop: "held", from: 1100, cut: exp8(1100, 300), q: 7, shkLate: 1, bass: "breakdown", strings: 2, hook: "D", soft: 1, vary: 1, fill: "swell" },
    { name: "Riser", d: "pitch fader up", loop: "R", from: 300, cut: exp8(300, OPEN, 1.6), q: 1.4, roll: 1, riser: 1, bass: "riser", strings: 1, fill: "gasp" },
    { name: "Peak", d: "up a step, G minor", loop: "A", key: 2, rechop: 1, cut: flat(OPEN), q: 1.1, crash: 1, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, conga: 1, bass: "gallop", strings: 1, hook: "A", brass: 1, fill: "flam" },
    { name: "Peak", d: "G minor", loop: "B", key: 2, cut: [OPEN, OPEN, OPEN, OPEN, OPEN, 4200, 2200, 1300], q: 2.6, kick: 1, clap: 1, oh: 1, ch: 1, shk: 1, tamb: 1, conga: 1, bass: "oct", strings: 1, hook: "B", brass: 1, fill: "clap" },
  ];

  const VOW = { a: [760, 1250], o: [520, 900], u: [380, 760], e: [480, 1750] };
  const nm = (pc) => T.NAMES[mod12(pc)];
  const tsym = (sym, k) => (!k ? sym : sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)));
  const prog = (text, k, barOffset = 0) => T.progression(text).map((h) => ({ bar: h.bar + barOffset, beat: h.beat, dur: h.dur, chord: tsym(h.chord, k) }));
  const lowRoot = (pc) => 32 + mod12(pc - 8); // Ab1 .. G2
  /** No semitones anywhere and no seconds low down: a sampled chord has to sound clean through a filter. */
  const rough = (v) => new Set(v).size < v.length || v.some((m, i) => i > 0 && (m - v[i - 1] === 1 || (v[i - 1] < 58 && m - v[i - 1] <= 2)));
  function cleanVoice(sym, { lo, hi, n, prev, top }) {
    let best = null, bestS = Infinity;
    // T.voice returns only its favourite, so steer it through every register to see all the candidates
    for (const spread of ["close", "drop2", "open"]) for (let tt = lo + 6; tt <= hi; tt += 2) for (const nn of [n, n - 1]) {
      if (nn < 3) continue;
      const v = T.voice(sym, { lo, hi, n: nn, top: [tt, tt + 2], spread });
      if (rough(v)) continue;
      let s = nn < n ? 2.5 : 0;
      if (prev && prev.length) {
        const b = prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2) * 0.5;
      const t = v[v.length - 1];
      if (t > top[1]) s += (t - top[1]) * 1.5;
      if (t < top[0]) s += (top[0] - t) * 1.5;
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo, hi, n, prev, top });
  }

  Sim.register({
    id: "filter-house",
    title: "Filter House",
    genre: "French house",
    about: "French touch at 124 BPM in F minor: a chopped disco loop of Rhodes, strings and horns behind a sweeping lowpass and phaser, pumping against a 909 kick under a talkbox hook, with a kick-less breakdown, a riser, and a last drop pitched up a step.",
    situations: ["party"],
    energy: 0.9,
    bpm: 124, swing: 0.5, beatsPerBar: 4, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      // sidechain pumps, all keyed from the kick
      const pumpRec = I.pump(ctx, out, { depth: 0.62, release: 0.27 });
      const pumpBass = I.pump(ctx, out, { depth: 0.4, release: 0.17 });
      const pumpVox = I.pump(ctx, out, { depth: 0.3, release: 0.22 });
      const room = I.reverb(ctx, out, { decay: 1.4, preDelay: 0.01, lowcut: 350, highcut: 7500 });
      const hall = I.reverb(ctx, pumpRec.input, { decay: 3.2, preDelay: 0.025, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, pumpVox.input, { time: "8n.", feedback: 0.32, highcut: 3000, pingPong: true });

      // the record: everything sampled sits behind one lowpass and a phaser
      const phaser = ctx.keep(new Tone.Phaser({ frequency: 0.18, octaves: 3, baseFrequency: 450, Q: 3, wet: 0.38 })).connect(pumpRec.input);
      const lp = ctx.keep(new Tone.Filter({ frequency: 380, type: "lowpass", rolloff: -24, Q: 2.4 })).connect(phaser);
      I.send(ctx, phaser, hall, -17);
      const keys = I.rhodes(ctx, { volume: -5, cutoff: 5200, tremolo: 0.01, tremoloDepth: 0, bark: 2.6, tine: -11 });
      const strings = I.strings(ctx, { volume: -11, cutoff: 5000, attack: 0.2, release: 0.6 });
      const brass = I.brassStab(ctx, { volume: -9 });
      I.place(ctx, keys, -0.12, lp); I.place(ctx, strings, 0.18, lp); I.place(ctx, brass, 0.08, lp);

      // talkbox: a detuned saw lead through two moving formant filters
      const lead = I.lead(ctx, { volume: 0, wave: "fatsawtooth", detune: 8, glide: 0.035, vibratoDepth: 0.035, base: 900, octaves: 2.2, release: 0.12 });
      const voxSum = ctx.keep(new Tone.Gain(1));
      const voxPan = ctx.keep(new Tone.Panner(0.04)).connect(pumpVox.input);
      voxSum.connect(voxPan);
      const F1 = ctx.keep(new Tone.Filter({ frequency: 760, type: "bandpass", Q: 4.5 }));
      const F2 = ctx.keep(new Tone.Filter({ frequency: 1250, type: "bandpass", Q: 6 }));
      const body = ctx.keep(new Tone.Filter({ frequency: 520, type: "lowpass", rolloff: -12 }));
      const g1 = ctx.keep(new Tone.Gain(3.2)), g2 = ctx.keep(new Tone.Gain(2.2)), g3 = ctx.keep(new Tone.Gain(0.55));
      lead.out.connect(F1); lead.out.connect(F2); lead.out.connect(body);
      F1.connect(g1); F2.connect(g2); body.connect(g3);
      g1.connect(voxSum); g2.connect(voxSum); g3.connect(voxSum);
      I.send(ctx, voxPan, hall, -14); I.send(ctx, voxPan, echo, -15);

      const bass = I.analog(ctx, { volume: -4, wave: "sawtooth", resonance: 2.2, base: 180, octaves: 2.6, filterDecay: 0.16, decay: 0.2, sustain: 0.45, release: 0.08 });
      I.place(ctx, bass, 0, pumpBass.input);

      const kit = I.kit(ctx, { volume: -1, preload: ["kick909", "clap", "hatOpen", "hatClosed", "shaker", "tambourine", "crash", "snare808", "conga", "congaLow", "tom"] });
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, kp, room, -17);

      // riser: running noise through a band-pass that climbs, behind a swelling gain
      const rGain = ctx.keep(new Tone.Gain(0));
      const rPan = ctx.keep(new Tone.AutoPanner({ frequency: 0.5, depth: 0.6 }).start()).connect(out);
      rGain.connect(rPan);
      const rBp = ctx.keep(new Tone.Filter({ frequency: 300, type: "bandpass", Q: 2.5 })).connect(rGain);
      ctx.keep(new Tone.Noise({ type: "white" }).start()).connect(rBp);
      I.send(ctx, rPan, hall, -10);
      const rClock = I.monotonic(rGain);

      const duck = (t) => { pumpRec.duck(t); pumpBass.duck(t); pumpVox.duck(t); };
      return {
        hook: {
          layer: "melody", humanize: { timing: 0.008, vel: 0.05 },
          play(t, e, d) {
            const [f1, f2] = VOW[e.vowel] || VOW.a;
            if (e.wah) { // talkbox "wow": start closed, open into the vowel
              F1.frequency.setValueAtTime(VOW.u[0], t); F2.frequency.setValueAtTime(VOW.u[1], t);
              F1.frequency.setTargetAtTime(f1, t + 0.02, 0.06); F2.frequency.setTargetAtTime(f2, t + 0.02, 0.06);
            } else { F1.frequency.setTargetAtTime(f1, t, 0.015); F2.frequency.setTargetAtTime(f2, t, 0.015); }
            lead.play(t, e.note, d, e.vel);
          },
        },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0.02 } },
        strings: { layer: "harmony", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        brass: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        filter: { // the DJ's hand on the lowpass
          layer: "harmony", humanize: { timing: 0, vel: 0 },
          play(t, e, d) {
            const f = lp.frequency, q = lp.Q;
            f.cancelAndHoldAtTime(t);
            if (e.from) f.setValueAtTime(e.from, t);
            f.exponentialRampToValueAtTime(Math.max(60, e.cut || 1000), t + d);
            if (e.q) { q.cancelAndHoldAtTime(t); q.linearRampToValueAtTime(e.q, t + Math.min(d, 1.5)); }
          },
        },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        drums: {
          layer: "drums", humanize: { timing: 0.003, vel: 0.06 },
          play(t, e) { kit.hit(e.note, t, e.vel, { pitch: e.pitch }); if (e.note === "kick909") duck(t); },
        },
        riser: {
          layer: "texture", humanize: { timing: 0, vel: 0 },
          play(t, e, d) {
            const tt = rClock(t);
            rGain.gain.cancelAndHoldAtTime(tt);
            rGain.gain.setValueAtTime(0, tt);
            rGain.gain.linearRampToValueAtTime(0.32 * e.vel, tt + d);
            rGain.gain.linearRampToValueAtTime(0, tt + d + 0.04);
            rBp.frequency.cancelAndHoldAtTime(tt);
            rBp.frequency.setValueAtTime(260, tt);
            rBp.frequency.exponentialRampToValueAtTime(9000, tt + d);
          },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const N = PLAN.length;
      const idx = cycle < N ? cycle : 1 + ((cycle - N) % (N - 1));
      const round = cycle < N ? 0 : 1 + Math.floor((cycle - N) / (N - 1));
      const P = PLAN[idx], k = P.key || 0;
      const nk = PLAN[idx + 1 < N ? idx + 1 : 1].key || 0;

      // ---- harmony ----
      let harmony = [];
      if (P.loop === "R") harmony = prog(LOOP.R, k).concat(prog(TURN, nk, 7));
      else {
        const len = T.progression(LOOP[P.loop]).reduce((a, h) => Math.max(a, h.bar + 1), 0);
        for (let o = 0; o < 8; o += len) harmony = harmony.concat(prog(LOOP[P.loop], k, o));
      }
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * 4 + h.beat, end: h.bar * 4 + h.beat + h.dur }));
      const spanAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };

      const ev = [];
      const stop = P.fill === "stop" ? 31 : P.fill === "gasp" ? 30.5 : 32; // the band cuts out here
      const push = (track, abs, dur, note, vel, extra) => {
        if (abs >= stop - 1e-6) return;
        dur = Math.min(dur, stop - abs - 0.04);
        if (dur <= 0.02) return;
        const bar = Math.floor(abs / 4 + 1e-9);
        ev.push({ track, bar, beat: abs - bar * 4, dur, note, vel, ...extra });
      };

      // ---- the filter ----
      P.cut.forEach((c, bar) => {
        const extra = bar === 0 ? { cut: c, q: P.q, ...(P.from ? { from: P.from } : {}) } : { cut: c };
        ev.push({ track: "filter", bar, beat: 0, dur: 4, note: `lp${c}`, vel: 1, ...extra });
      });

      // ---- the record: Rhodes chops, strings, horn stabs ----
      if (!state.chops || P.rechop) {
        const pick = (avoid) => { let c = r.pick(GROOVE_CHOPS); for (let i = 0; i < 4 && c === avoid; i++) c = r.pick(GROOVE_CHOPS); return c; };
        const a = pick(state.chops?.A);
        state.chops = { A: a, B: pick(a) };
      }
      // Voicings are fixed per chord in a block (no chaining across blocks), so the record sounds the same
      // every time it comes back.
      const voicings = {};
      let prevV = null, prevS = null, prevB = null;
      for (const h of hAbs) {
        if (voicings[h.chord]) continue;
        const kv = cleanVoice(h.chord, { lo: 56, hi: 77, n: 4, prev: prevV, top: [67, 74] });
        const sv = cleanVoice(h.chord, { lo: 63, hi: 86, n: 3, prev: prevS, top: [74, 82] });
        const bv = cleanVoice(h.chord, { lo: 62, hi: 82, n: 4, prev: prevB, top: [74, 80] });
        voicings[h.chord] = { kv, sv, bv };
        prevV = kv; prevS = sv; prevB = bv;
      }

      const keysFrom = (P.keysFrom || 0) * 4;
      for (let unit = 0; unit < 4; unit++) { // four 2-bar units
        const u0 = unit * 8;
        if (u0 + 8 <= keysFrom) continue;
        let chop;
        if (P.loop === "R") chop = ["held", "held", "eighths", "sixteenths"][unit];
        else chop = P.chop || state.chops[P.loop === "B" ? "B" : "A"];
        const hits = CHOPS[chop].map(([b, d]) => ({ at: u0 + b, d }));
        // a chord change under a held chop gets its own hit
        hAbs.filter((h) => h.start > u0 && h.start < u0 + 8 && !hits.some((x) => Math.abs(x.at - h.start) < 1e-6)).forEach((h) => {
          const prev = hits.filter((x) => x.at < h.start).pop();
          if (prev && prev.at + prev.d > h.start + 0.25) hits.push({ at: h.start, d: prev.at + prev.d - h.start });
        });
        hits.sort((a, b) => a.at - b.at);
        const rise = P.loop === "R" ? 0.85 + unit * 0.07 : 1;
        hits.forEach((x) => {
          if (x.at < keysFrom) return;
          const h = spanAt(x.at);
          const d = Math.min(x.d, h.end - x.at - 0.04);
          const accent = Math.abs(x.at - Math.round(x.at / 4) * 4) < 1e-6 ? 0.06 : 0;
          push("keys", x.at, d, voicings[h.chord].kv, (0.56 + accent) * rise);
        });
        if (P.brass) BRASS.forEach(([b, d]) => {
          const at = u0 + b, h = spanAt(at);
          push("brass", at, Math.min(d, h.end - at - 0.04), voicings[h.chord].bv, b === 7.5 ? 0.62 : 0.52);
        });
      }
      if (P.strings) {
        const sv = P.strings === 2 ? 0.46 : 0.3;
        hAbs.forEach((h) => { if (h.start >= keysFrom) push("strings", h.start, h.dur - 0.08, voicings[h.chord].sv, sv); });
      }

      // ---- talkbox hook ----
      if (P.hook) {
        const [first, second] = HOOKS[P.hook];
        const vary = P.vary || round > 0;
        const shift = vary && P.hook !== "D" && r.chance(0.5) ? 0.5 : 0;
        const notes = [];
        [first, second].forEach((src, half) => src.forEach(([bar, beat, dur, n]) => {
          let at = half * 16 + bar * 4 + beat;
          if (shift && bar === 0) at += shift; // push the opening cell an eighth late
          notes.push({ at, dur, note: T.midi(n) + k });
        }));
        notes.sort((a, b) => a.at - b.at);
        notes.forEach((n, i) => { if (i + 1 < notes.length) n.dur = Math.min(n.dur, notes[i + 1].at - n.at - 0.04); });
        const base = P.soft ? 0.52 : 0.64;
        let vi = 0;
        notes.forEach((n, i) => {
          const long = n.dur >= 1;
          const vowel = long ? "a" : n.dur >= 0.5 ? (vi++ % 2 ? "o" : "a") : vi++ % 2 ? "e" : "u";
          let note = n.note;
          if (vary && !long && i > 0 && r.chance(0.08)) { // a grace from below on short notes
            push("hook", n.at, 0.1, note - (mod12(note - k) === 0 ? 1 : 2), base * 0.7, { vowel: "u" });
            push("hook", n.at, n.dur, note, base, { vowel, delay: 0.045 });
            return;
          }
          push("hook", n.at, n.dur, note, base + (long ? 0.05 : 0) + r.gauss(0.02), { vowel, wah: long || (n.dur >= 0.5 && r.chance(0.4)) });
        });
      }

      // ---- bass ----
      const spans = [];
      hAbs.forEach((h) => {
        const prev = spans[spans.length - 1];
        if (prev && T.chord(prev.chord).bass === T.chord(h.chord).bass && Math.floor(prev.start / 4) === Math.floor(h.start / 4)) prev.end = h.end;
        else spans.push({ start: h.start, end: h.end, chord: h.chord });
      });
      spans.forEach((sp, si) => {
        const bar = Math.floor(sp.start / 4);
        let mode = P.bass;
        if (mode === "intro") mode = bar < 2 ? null : "oct";
        else if (mode === "breakdown") mode = bar < 4 ? null : "long";
        else if (mode === "riser") mode = bar < 4 ? null : bar < 7 ? "pulse" : "oct";
        if (!mode) return;
        const cell = BASS[mode];
        const len = sp.end - sp.start;
        const low = lowRoot(T.chord(sp.chord).bass);
        const nextSym = si + 1 < spans.length ? spans[si + 1].chord : null;
        const nextLow = nextSym ? lowRoot(T.chord(nextSym).bass) : null;
        cell.forEach(([pos, dur, role], ci) => {
          if (pos >= len - 0.01) return;
          let n = role === "H" ? low + 12 : low;
          const lastSlot = ci === cell.length - 1 || cell[ci + 1][0] >= len - 0.01;
          // walk into the next chord on the last eighth now and then
          if (lastSlot && nextLow != null && nextLow !== low && mode !== "long" && r.chance(0.45)) {
            // a chord tone that points at the next root: the fifth, or the seventh just above or below it
            const c = T.chord(sp.chord), fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
            const sev = c.intervals.find((x) => x === 10 || x === 11);
            const opts = [[low + fifth, 3]];
            if (sev != null) opts.push([low + sev, 2]);
            n = r.weighted(opts);
          }
          const vel = mode === "long" ? 0.55 : role === "H" ? 0.68 : pos === 0 ? 0.84 : 0.76;
          push("bass", sp.start + pos, Math.min(dur, len - pos - 0.05), n, vel);
        });
      });

      // ---- drums ----
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4, last = bar === 7;
        const fill = last ? P.fill : null;
        const fillFrom = fill === "toms" || fill === "flam" ? 3 : 4; // regular pattern yields from here
        if (P.crash && bar === 0) D(0, "crash", 0.62);
        if (P.kick) for (let q = 0; q < 4; q++) D(B + q, "kick909", q === 0 ? 0.95 : 0.88);
        if (P.clap === 1 || (P.clap === "late" && bar >= 4)) {
          D(B + 1, "clap", 0.68 + r.gauss(0.02));
          if (fillFrom > 3) D(B + 3, "clap", 0.72 + r.gauss(0.02));
          if (P.tamb) { D(B + 1, "tambourine", 0.34); D(B + 3, "tambourine", 0.36); }
        }
        if (P.oh) for (let q = 0; q < 4; q++) if (q + 0.5 < fillFrom) D(B + q + 0.5, "hatOpen", 0.36 + (q % 2) * 0.04 + r.gauss(0.02));
        if (P.ch) for (let s = 0; s < 16; s++) {
          if (s % 2 === 0 || s / 4 >= fillFrom) continue;
          if (r.chance(0.12)) continue;
          D(B + s / 4, "hatClosed", (s % 4 === 3 ? 0.22 : 0.16) + r.gauss(0.02));
        }
        const shk = P.shk || (P.shkLate && bar >= 4);
        if (shk) for (let s = 0; s < 16; s++) D(B + s / 4, "shaker", ([0.2, 0.1, 0.27, 0.12][s % 4] + r.gauss(0.015)) * (P.shkLate ? 0.7 : 1));
        if (P.conga) {
          const pat = bar % 2 === 0 ? [[0.75, "conga", 0.36, 64], [1.5, "congaLow", 0.42, 57], [2.75, "conga", 0.4, 64], [3.5, "congaLow", 0.38, 55]]
            : [[0.75, "conga", 0.36, 64], [1.25, "conga", 0.26, 64], [2.5, "congaLow", 0.42, 57], [3.25, "conga", 0.34, 64], [3.75, "conga", 0.3, 64]];
          pat.forEach(([p, v, vel, pitch]) => { if (p < fillFrom) D(B + p, v, vel, { pitch }); });
        }
        // the riser's snare roll: halves, quarters, eighths, sixteenths
        if (P.roll) {
          const step = bar < 2 ? 2 : bar < 4 ? 1 : bar < 6 ? 0.5 : 0.25;
          for (let p = bar < 2 ? 1 : 0; p < 4; p += step) {
            const u = (B + p) / 32;
            D(B + p, "snare808", 0.22 + 0.62 * u * u);
          }
          if (bar >= 6) for (let q = 0; q < 4; q++) D(B + q, "kick909", 0.7 + (bar - 6) * 0.1);
        }
        if (P.riser && bar === 0) push("riser", 0, 30.4, "noise", 0.9);
        // fills that mark the form
        if (fill === "clap") { D(B + 3.5, "clap", 0.5); D(B + 3.75, "clap", 0.62); }
        else if (fill === "flam") { D(B + 3, "snare808", 0.4); D(B + 3.25, "snare808", 0.3); D(B + 3.5, "snare808", 0.5); D(B + 3.75, "snare808", 0.66); D(B + 3, "clap", 0.6); }
        else if (fill === "toms") { [[3, 52, 0.55], [3.25, 50, 0.5], [3.5, 45, 0.6], [3.75, 41, 0.66]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch })); D(B + 3, "clap", 0.62); }
        else if (fill === "swell") { D(B + 2, "snare808", 0.3); D(B + 2.5, "snare808", 0.36); D(B + 3, "snare808", 0.44); D(B + 3.5, "snare808", 0.52); D(B + 3.75, "snare808", 0.6); }
      }
      // the lone clap in the hole of a "stop" bar
      if (P.fill === "stop") ev.push({ track: "drums", bar: 7, beat: 3.5, dur: 0.1, note: "clap", vel: 0.78 });

      return { events: ev, harmony, section: `${P.name} · ${P.d}`, state };
    },
  });
})();
