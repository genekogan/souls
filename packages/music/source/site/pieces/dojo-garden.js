// Dojo Garden: the calm of a master's garden. Raked gravel, a bonsai, a stream, a bell somewhere.
//
// The shakuhachi carries a composed honkyoku-like theme: long breathed tones that bend up into pitch
// (meri-kari: a grace a step below glides into the note), quick upper flicks, phrases that droop off at
// the end, and rests for breath. The koto answers in the shakuhachi's rests (glissandi, tremolo, an echo
// of the last phrase an octave down) and otherwise plucks slow arpeggios; a bass koto (jushichigen) and
// a faint sub drone hold the centre; a glass pad breathes underneath. Water runs through the whole
// piece (a band-passed noise stream with drips) and wind swells come and go, setting off tuned chimes.
//
// Scales: the in scale (miyako-bushi: 1 b2 4 5 b6, E F A B C) and the yo scale (1 2 4 5 6, G A C D E).
// Each centre is exactly the pitch set of one chord, so the chord display names it:
//   E in = Fmaj7#11/E    yo on G = C69/G    yo on C = F69/C    A in = Bbmaj7#11/A
// and the harmony moves by changing the bass under the same five notes (E -> A -> C in the garden).
// Melodies are written in scale degrees, so the same theme sounds in any centre.
//
// Arc (cycles of 8 bars; one round = 9 cycles, about 4 minutes):
//   Garden (E in, 66 BPM): theme, then its answer; the taiko heartbeat enters
//   Stream (yo on G): koto arpeggios flow, shime ticks in, the shakuhachi wanders; pivot to yo on C
//   Kata (76 BPM): koto ostinato, bass koto, o-daiko "don doko", shime ji-uchi, kachi on the rim;
//     the kata theme in yo on C, then in A in, then a climax that ends in an oroshi roll and a silence
//   Return (E in, 66 BPM): the theme with ornaments, the heartbeat only
//   Stillness (60 BPM): pad, water, koto tremolo, chimes and a last distant fragment
// Odd rounds are transposed up a fourth (A in, yo on C, yo on F, D in), so the round's end in A in falls
// naturally back to E in.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- centres ----------
  const IN = [0, 1, 5, 7, 8], YO = [0, 2, 5, 7, 9];
  // sym: the chord whose pitch classes are exactly the scale (root offset from the centre)
  const KIND = { in: { iv: IN, symRoot: 1, q: "maj7#11" }, yo: { iv: YO, symRoot: 5, q: "69" } };
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  function centre(kind, pc) {
    const k = KIND[kind];
    const base = [62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73].find((m) => mod12(m) === mod12(pc)); // melody degree 0
    return { kind, pc: mod12(pc), iv: k.iv, pcs: k.iv.map((i) => mod12(pc + i)), symBase: FLAT[mod12(pc + k.symRoot)] + k.q, base };
  }
  /** Degree d (any integer) of a centre, relative to midi `base` (degree 0). */
  function deg(c, d, base = c.base) {
    const o = Math.floor(d / 5), i = d - o * 5;
    return base + 12 * o + c.iv[i];
  }
  const symOf = (c, bassDeg) => `${c.symBase}/${FLAT[mod12(c.pc + c.iv[((bassDeg % 5) + 5) % 5])]}`;

  // ---------- notation in degrees: "3~/2.5" (bend up into it), "2'/1" (upper flick), "0v/2" (droop off) ----------
  function bars(list) {
    const out = [];
    list.forEach((s, i) => {
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const m = /^(r|-?\d+)([~'v]*)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`dojo-garden: bad token "${tok}"`);
        const dur = Number(m[3]);
        if (m[1] !== "r") out.push({ beat: i * BPB + b, dur, d: Number(m[1]), bend: m[2].includes("~"), flick: m[2].includes("'"), droop: m[2].includes("v") });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`dojo-garden: bar sums to ${b}: ${s}`);
    });
    return out;
  }
  // The theme (in scale): E up to a bent B, the b6-5 and b2-1 sighs; the answer starts on the 4th.
  const THEME_A = bars([
    "0/1 3~/2.5 r/0.5",
    "4/1.5 3/0.5 2/1 1/1",
    "0v/3 r/1",
    "r/1 2/1 3/1 4/1",
    "5~/2.5 6/0.5 5/1",
    "4/1.5 3/0.5 2'/2",
    "3/1 1/1 0v/2",
    "r/4",
  ]);
  const THEME_B = bars([
    "2/1 4~/2 3/1",
    "2/1.5 1/0.5 0v/2",
    "r/1 5/1 6/1 5/0.5 4/0.5",
    "3~/3 r/1",
    "2/1 3/0.5 4/0.5 5'/2",
    "6/1 5/1 4/1 3/1",
    "2/1 1/1 0~/2",
    "r/4",
  ]);
  // The kata theme: rhythmic, for the practice section (works in yo and in)
  const KATA = bars([
    "0/0.5 2/0.5 3/1 4/0.5 3/0.5 2/1",
    "3/1.5 2/0.5 0/2",
    "0/0.5 2/0.5 3/1 5/0.5 4/0.5 3/1",
    "4~/3 r/1",
    "5/0.5 4/0.5 3/1 4/0.5 5/0.5 6/1",
    "5/1.5 4/0.5 3/2",
    "2/0.5 3/0.5 2/0.5 0/0.5 -1/1 0/1",
    "0v/3 r/1",
  ]);

  /** A free phrase (no bar lines): "0/1 3~/2.5" -> notes from beat 0, plus its length. */
  function phrase(str) {
    let b = 0;
    const notes = [];
    for (const tok of str.trim().split(/\s+/)) {
      const m = /^(r|-?\d+)([~'v]*)\/([\d.]+)$/.exec(tok);
      if (!m) throw new Error(`dojo-garden: bad token "${tok}"`);
      const dur = Number(m[3]);
      if (m[1] !== "r") notes.push({ beat: b, dur, d: Number(m[1]), bend: m[2].includes("~"), flick: m[2].includes("'"), droop: m[2].includes("v") });
      b += dur;
    }
    return { notes, len: b };
  }
  // Cells of the theme, for the wandering passages: sequenced, inverted, slowed down, never quite repeated.
  const BANK = [
    "0/1 3~/2.5", "4/1.5 3/0.5 2/1 1/1 0v/2", "2/1 3/1 4/1 5~/2.5", "4/1.5 3/0.5 2'/2 3/1 1/1 0v/2",
    "2/1 4~/2 3/1 2/1.5 1/0.5 0v/2", "5/1 6/1 5/0.5 4/0.5 3~/3", "3/1 2/0.5 3/0.5 5'/2.5", "1/1 2/1 0~/3",
  ].map(phrase);
  const KATA_BANK = [
    "0/0.5 2/0.5 3/1 4/0.5 3/0.5 2/1 3/1.5 2/0.5 0/2", "0/0.5 2/0.5 3/1 5/0.5 4/0.5 3/1 4~/3",
    "5/0.5 4/0.5 3/1 4/0.5 5/0.5 6/1 5/1.5 4/0.5 3/2", "2/0.5 3/0.5 2/0.5 0/0.5 -1/1 0/1 2~/2",
  ].map(phrase);

  // ---------- form ----------
  // units: four 2-bar harmony units per cycle, each { c: centre key, d: bass degree }
  const SECTIONS = [
    { id: "garden1", c: ["in", 4], units: [0, 0, 2, 0], mel: "A", perc: 0, bpm: 66, label: "Garden · shakuhachi theme in E in" },
    { id: "garden2", c: ["in", 4], units: [2, 0, 4, 0], mel: "B", perc: 1, label: "Garden · the answer, a heartbeat" },
    { id: "stream1", c: ["yo", 7], units: [0, 2, 3, 0], mel: "gen", perc: 2, label: "Stream · yo on G, koto flowing" },
    { id: "stream2", c: ["yo", 7], units: [2, 0, 3, [["yo", 0], 0]], mel: "gen2", perc: 2, label: "Stream · koto alone, then on to yo on C" },
    { id: "kata1", c: ["yo", 0], units: [0, 2, 0, 3], mel: "kata", perc: 3, bpm: 76, label: "Kata · ostinato and drums, yo on C" },
    { id: "kata2", c: ["in", 9], units: [0, 2, 0, 4], mel: "kata", perc: 4, label: "Kata · the form in A in" },
    { id: "kata3", c: ["in", 9], units: [0, 2, 0, 0], mel: "genHi", perc: 5, label: "Kata · climax, oroshi, silence" },
    { id: "return", c: ["in", 4], units: [0, 2, 0, 0], mel: "A2", perc: 1, bpm: 66, label: "Return · the theme with ornaments" },
    { id: "still", c: ["in", 4], units: [0, 0, 2, 0], mel: "frag", perc: 0, bpm: 60, label: "Stillness · water, chimes, tremolo" },
  ];
  function planAt(cycle) {
    const round = Math.floor(cycle / SECTIONS.length), s = SECTIONS[cycle % SECTIONS.length];
    const tr = round % 2 ? 5 : 0;
    const mk = ([kind, pc]) => centre(kind, pc + tr);
    const units = s.units.map((u) => (Array.isArray(u) ? { c: mk(u[0]), d: u[1] } : { c: mk(s.c), d: u }));
    let bpm = s.bpm;
    if (cycle === 0) bpm = null; // the piece's own tempo
    else if (s.id === "garden1") bpm = 66;
    return { ...s, round, tr, centre: mk(s.c), units, bpm };
  }

  // ---------- koto figures (degrees relative to the unit's bass degree, koto octave) ----------
  const CELLS = [ // one bar, [beat, dur, degree]
    [[0, 1.5, 0], [1.5, 0.5, 2], [2, 2, 4]],
    [[0, 1, 0], [1, 1, 3], [2, 1, 5], [3, 1, 4]],
    [[0, 2, 2], [2, 1, 4], [3, 1, 5]],
    [[0.5, 1, 3], [1.5, 0.5, 4], [2, 2, 2]],
  ];
  const FLOW = [ // stream: flowing eighths, one bar
    [0, 3, 5, 7, 6, 5, 3, 2], [0, 2, 4, 5, 7, 5, 4, 2], [5, 4, 3, 2, 3, 5, 7, 5], [2, 4, 5, 4, 3, 2, 0, 2],
  ];
  const OSTINATO = [[0, 0, 3, 2, 0, 4, 3, 2], [0, 0, 3, 2, 5, 4, 3, 2]]; // kata

  // ---------- custom instruments: water, wind ----------
  function water(ctx, dest, I) {
    const bus = ctx.keep(new Tone.Gain(db(-14))).connect(dest);
    const stream = ctx.keep(new Tone.Gain(0)).connect(bus);
    const af = ctx.keep(new Tone.AutoFilter({ frequency: 0.17, baseFrequency: 500, octaves: 2.6, filter: { type: "bandpass", rolloff: -12, Q: 1.1 } }).start()).connect(stream);
    const af2 = ctx.keep(new Tone.AutoFilter({ frequency: 2.3, baseFrequency: 1300, octaves: 1.2, depth: 0.5, filter: { type: "bandpass", rolloff: -12, Q: 2 } }).start()).connect(stream);
    const hp = ctx.keep(new Tone.Filter({ frequency: 260, type: "highpass" }));
    hp.connect(af); hp.connect(af2);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(hp);
    const dripPan = ctx.keep(new Tone.Panner(0)).connect(bus);
    const drip = ctx.keep(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.04 } })).connect(dripPan);
    drip.volume.value = -4;
    const mono = I.monotonic(drip);
    return {
      out: bus,
      play(t, e, d) {
        if (e.note === "stream") {
          const lvl = Math.max(0, Math.min(1, e.vel)) * 0.5;
          stream.gain.cancelAndHoldAtTime(t);
          stream.gain.linearRampToValueAtTime(lvl, t + Math.min(6, d));
          return;
        }
        const f = Number.isFinite(e.freq) ? e.freq : 900;
        const tt = mono(t);
        dripPan.pan.setValueAtTime(Math.max(-1, Math.min(1, e.pan || 0)), tt);
        drip.frequency.cancelScheduledValues(tt);
        drip.triggerAttackRelease(f, 0.05, tt, e.vel);
        drip.frequency.exponentialRampToValueAtTime(f * 2.1, tt + 0.045);
      },
    };
  }
  function wind(ctx, dest) {
    const g = ctx.keep(new Tone.Gain(0)).connect(dest);
    const pan = ctx.keep(new Tone.AutoPanner({ frequency: 0.07, depth: 0.6 }).start()).connect(g);
    const bp = ctx.keep(new Tone.Filter({ frequency: 600, type: "bandpass", Q: 2.2 })).connect(pan);
    const lfo = ctx.keep(new Tone.LFO({ frequency: 0.11, min: 350, max: 1100 }).start());
    lfo.connect(bp.frequency);
    ctx.keep(new Tone.Noise({ type: "brown" }).start()).connect(bp);
    return {
      out: g,
      play(t, e, d) { // a gust: swell and fall over the event
        const lvl = db(-15) * Math.max(0, Math.min(1, e.vel));
        g.gain.cancelAndHoldAtTime(t);
        g.gain.linearRampToValueAtTime(lvl, t + d * 0.4);
        g.gain.linearRampToValueAtTime(lvl * 0.6, t + d * 0.7);
        g.gain.linearRampToValueAtTime(0, t + d);
      },
    };
  }

  Sim.register({
    id: "dojo-garden",
    title: "Dojo Garden",
    genre: "Zen garden",
    about: "A shakuhachi theme with bends and breath over koto in the in and yo scales, water, wind and chimes; a taiko heartbeat grows into a faster kata of koto ostinato, o-daiko, shime and kachi, then settles back into stillness.",
    situations: ["campfire", "work", "sleep"],
    energy: 0.25,
    bpm: 66, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.04, lowcut: 300, highcut: 6500 });
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 200, highcut: 6000 });
      const echo = I.delay(ctx, out, { time: "4n.", feedback: 0.32, highcut: 3200, pingPong: true });

      const shaku = I.shakuhachi(ctx, { volume: 0, glide: 0.11, vibratoDepth: 0.055, breath: -14 });
      const koto = I.koto(ctx, { volume: -6, resonance: 0.968 });
      const bassKoto = I.koto(ctx, { volume: -7, dampening: 2600, resonance: 0.985, voices: 4 });
      const sub = I.sub(ctx, { volume: -17, attack: 1.5, release: 3 });
      const glass = I.glassPad(ctx, { volume: -13, attack: 3, release: 5 });
      const strings = I.strings(ctx, { volume: -17, cutoff: 1500, attack: 1.4, release: 2.5 });
      const chimes = I.bell(ctx, { volume: -21, decay: 4 });
      const kit = I.kit(ctx, { volume: -4, preload: ["taiko", "shime", "kachi"] });
      const wat = water(ctx, out, I), air = wind(ctx, out);

      const sp = I.place(ctx, shaku, 0.08, out), kp = I.place(ctx, koto, -0.3, out), bk = I.place(ctx, bassKoto, 0.1, out);
      I.place(ctx, sub, 0, out);
      const gp = I.place(ctx, glass, 0.2, out), stp = I.place(ctx, strings, -0.15, out), cp = I.place(ctx, chimes, 0.45, out);
      const dp = I.place(ctx, kit, 0, out);
      I.send(ctx, sp, hall, -7); I.send(ctx, sp, echo, -20);
      I.send(ctx, kp, hall, -11); I.send(ctx, kp, echo, -22); I.send(ctx, bk, hall, -14);
      I.send(ctx, gp, hall, -6); I.send(ctx, stp, hall, -8); I.send(ctx, cp, hall, -3); I.send(ctx, cp, echo, -12);
      I.send(ctx, dp, room, -10); I.send(ctx, dp, hall, -16);
      I.send(ctx, wat.out, hall, -14); I.send(ctx, air.out, hall, -10);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        shakuhachi: { layer: "melody", play: pl(shaku), humanize: { timing: 0.012, vel: 0.05 } },
        koto: { layer: "harmony", play: pl(koto), humanize: { timing: 0.01, vel: 0.08 } },
        pad: { layer: "harmony", play: pl(glass), humanize: { timing: 0, vel: 0 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0, vel: 0 } },
        bassKoto: { layer: "bass", play: pl(bassKoto), humanize: { timing: 0.008, vel: 0.06 } },
        drone: { layer: "bass", play: pl(sub), humanize: { timing: 0, vel: 0 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.08 } },
        chimes: { layer: "texture", play: pl(chimes), humanize: { timing: 0.03, vel: 0.15 } },
        water: { layer: "texture", play: (t, e, d) => wat.play(t, e, d), humanize: { timing: 0.02, vel: 0.2 } },
        wind: { layer: "texture", play: (t, e, d) => air.play(t, e, d), humanize: { timing: 0, vel: 0.1 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const units = plan.units;
      const unitAt = (b) => units[Math.min(3, Math.max(0, Math.floor(b / 8)))];
      const harmony = units.map((u, i) => ({ bar: i * 2, beat: 0, dur: 8, chord: symOf(u.c, u.d) }));
      const symAt = (b) => harmony[Math.min(3, Math.max(0, Math.floor(b / 8)))].chord;
      const kata = plan.id.startsWith("kata");
      const P = plan.perc;

      // ================= shakuhachi =================
      /** Expand ornaments into grace notes (each grace ends exactly when its note begins: legato glide). */
      const melody = [];
      let lastMain = null;
      const sing = (n, note, vel, c) => {
        const sc = T.notesIn(c.pcs, note - 4, note + 4);
        let below = sc.filter((m) => m < note).pop() ?? note - 1, above = sc.find((m) => m > note) ?? note + 2;
        if (note - below > 2) below = note - 1; // a droop or bend is a slide of a step at most
        if (above > 86) above = note; // no flick above the instrument's top
        let b = n.beat, d = n.dur;
        if (n.bend && d > 0.6) {
          const from = below;
          melody.push({ beat: b, dur: 0.25, note: from, vel: vel * 0.8, grace: true });
          b += 0.25; d -= 0.25;
        } else if (n.flick && d > 0.5 && above !== note && above !== lastMain) {
          melody.push({ beat: b, dur: 0.16, note: above, vel: vel * 0.75, grace: true });
          b += 0.16; d -= 0.16;
        }
        if (n.droop && d > 1) {
          melody.push({ beat: b, dur: d - 0.25, note, vel });
          melody.push({ beat: b + d - 0.25, dur: 0.24, note: below, vel: vel * 0.45, grace: true });
        } else melody.push({ beat: b, dur: d, note, vel });
        lastMain = note;
      };
      const fromDegrees = (notes, velBase, ornament = 0, rr = r) => notes.forEach((n) => {
        const u = unitAt(n.beat), c = u.c;
        const x = { ...n };
        if (ornament && !x.bend && !x.flick && !x.droop && x.dur >= 1 && rr.chance(ornament)) x[rr.pick(["bend", "flick", "bend"])] = true;
        const inBar = n.beat % BPB;
        sing(x, deg(c, n.d), velBase + (inBar === 0 ? 0.05 : 0) + (n.dur >= 2 ? 0.04 : 0), c);
      });
      /** Wander: cells from a bank, each sequenced (degree shift), sometimes inverted or slowed, with breaths between. */
      const develop = (start, end, bank, o) => {
        const rr = r.fork(40 + start);
        let t = start + (o.lead ?? 0);
        let lastCell = state.lastCell ?? -1;
        while (t < end - 2) {
          let ci = rr.int(0, bank.length - 1);
          if (ci === lastCell) ci = (ci + 1) % bank.length;
          lastCell = ci;
          const cell = bank[ci], aug = rr.chance(o.aug ?? 0) ? 1.5 : 1;
          if (t + cell.len * aug > end + 0.01) break;
          const shift = rr.pick(o.shifts || [0, 0, 1, 2, -1]), inv = rr.chance(o.invert ?? 0.2);
          let ds = cell.notes.map((n) => (inv ? 6 - n.d : n.d) + shift);
          const c = unitAt(t).c, lo = Math.max(57, c.base - 3 + (o.lift ?? 0)), hi = Math.min(o.top ?? 86, c.base + 16 + (o.lift ?? 0));
          const ms = ds.map((d) => deg(c, d));
          if (Math.max(...ms) > hi) ds = ds.map((d) => d - 5);
          else if (Math.min(...ms) < lo && Math.max(...ds.map((d) => deg(c, d + 5))) <= hi) ds = ds.map((d) => d + 5);
          const notes = cell.notes.map((n, i) => ({ ...n, beat: t + n.beat * aug, dur: n.dur * aug, d: ds[i] }));
          fromDegrees(notes, o.vel ?? 0.6, o.ornament ?? 0.2, rr);
          t += cell.len * aug + rr.pick(o.rests || [1, 1.5, 2, 3]);
          t = Math.round(t * 2) / 2;
        }
        state.lastCell = lastCell;
      };
      if (plan.mel === "A") fromDegrees(THEME_A, 0.62);
      else if (plan.mel === "B") fromDegrees(THEME_B, 0.62);
      else if (plan.mel === "A2") { // the theme returns ornamented (alternately the answer, from round to round)
        const which = plan.round % 2 ? THEME_B : THEME_A;
        fromDegrees(which, 0.6, 0.45, r.fork(9));
      }
      else if (plan.mel === "gen") develop(0, 31, BANK, { lead: 1, aug: 0.3 });
      else if (plan.mel === "gen2") develop(16, 31, BANK, { lead: 0.5, aug: 0.2, shifts: [1, 2, 3] });
      else if (plan.mel === "kata" && plan.id === "kata1") fromDegrees(KATA.filter((n) => n.beat < 24).map((n) => ({ ...n, beat: n.beat + 8 })), 0.64); // enters after the ostinato, ends open
      else if (plan.mel === "kata") fromDegrees(KATA, 0.66, 0.25, r.fork(8));
      else if (plan.mel === "genHi") { develop(0, 23, KATA_BANK, { shifts: [2, 3, 4], lift: 5, top: 88, invert: 0.15, rests: [0.5, 1], vel: 0.66, ornament: 0.3 }); fromDegrees([{ beat: 24, dur: 5.5, d: 6, bend: true }], 0.72); }
      else if (plan.mel === "frag") fromDegrees(THEME_A.filter((n) => n.beat >= 8 && n.beat < 12).map((n) => ({ ...n, beat: n.beat + 8 })).concat(THEME_A.filter((n) => n.beat < 8).map((n) => ({ ...n, beat: n.beat + 8 }))), 0.46);
      melody.sort((a, b) => a.beat - b.beat).forEach((n, i, all) => {
        const nx = all[i + 1], slur = nx && nx.grace && Math.abs(nx.beat - (n.beat + n.dur)) < 1e-6; // slide straight into a fall-off
        push("shakuhachi", n.beat, n.dur * (n.grace ? 0.97 : slur ? 0.99 : 0.94), n.note, n.vel);
      });
      // when is the shakuhachi resting? (koto answers there)
      const busy = new Array(64).fill(false);
      melody.forEach((n) => { for (let h = Math.floor(n.beat * 2); h < Math.ceil((n.beat + n.dur) * 2) && h < 64; h++) busy[h] = true; });
      const restIn = (b0, b1) => { for (let h = b0 * 2; h < b1 * 2; h++) if (busy[h]) return false; return true; };

      // ================= koto =================
      const kotoBase = (c) => c.base - 12;
      const kd = (u, d, top = 99) => { let m = deg(u.c, u.d + d, kotoBase(u.c)); while (m > top) m -= 12; return m; }; // top: keep under the flute
      const koto = (abs, dur, note, vel) => push("koto", abs, dur, note, vel);
      const tremolo = (abs, len, note, vel) => { // a koto tremolo: 32nd-ish repeated plucks, swelling then dying
        const n = Math.round(len / 0.125);
        for (let i = 0; i < n; i++) { const u = i / (n - 1 || 1); koto(abs + i * 0.125, 0.2, note, vel * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.3)))); }
      };
      const gliss = (abs, u, from, to, vel) => { // sararin: a sweep over the strings
        const step = from < to ? 1 : -1, cnt = Math.abs(to - from) + 1;
        for (let i = 0; i < cnt; i++) koto(abs + i * 0.11, 0.5, kd(u, from + i * step), vel * (0.6 + 0.4 * (i / cnt)));
      };
      if (kata) {
        const pat = OSTINATO[plan.id === "kata1" ? 0 : 1];
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, u = unitAt(B);
          const silent = plan.id === "kata3" && bar === 7 && false;
          if (silent) continue;
          if (plan.id === "kata1" && bar < 1) { // the ostinato enters alone for a bar
            pat.forEach((d, i) => koto(B + i * 0.5, 0.45, kd(u, d), i % 2 ? 0.45 : 0.55));
            continue;
          }
          if (plan.id === "kata3" && bar === 7) { koto(B, 2, [kd(u, 0), kd(u, 5)], 0.75); continue; } // last chord, then the silence
          pat.forEach((d, i) => koto(B + i * 0.5, 0.45, kd(u, d), (i % 4 === 0 ? 0.62 : i % 2 ? 0.44 : 0.52)));
          if (plan.id !== "kata1" && bar % 4 === 3) koto(B + 3.5, 0.5, [kd(u, 5), kd(u, 7)], 0.5);
        }
      } else {
        const flowing = plan.id.startsWith("stream");
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, u = unitAt(B);
          if (plan.id === "stream2" && bar < 4) { // koto alone: flowing line ending in a tremolo
            if (bar < 3) FLOW[(bar + plan.round) % FLOW.length].forEach((d, i) => koto(B + i * 0.5, 0.6, kd(u, d, u.c.base + 9), 0.48 + (i % 2 ? -0.06 : 0.04)));
            else { gliss(B, u, 0, 6, 0.5); tremolo(B + 1, 2.5, kd(u, 5), 0.5); }
            continue;
          }
          if (restIn(B, B + 4) && plan.mel !== "frag") { // an answer in the shakuhachi's rest
            const last = melody.filter((n) => n.beat < B && !n.grace).slice(-3);
            if (last.length === 3 && r.chance(0.55)) last.forEach((n, i) => koto(B + 0.5 + i * 0.75, 1, n.note - 12, 0.5 - i * 0.04));
            else { gliss(B + 0.5, u, r.pick([0, 2]), 7, 0.48); koto(B + 2.5, 1.5, [kd(u, 0), kd(u, 5)], 0.5); }
            continue;
          }
          if (plan.mel === "frag" || plan.id === "still") {
            if (bar % 2 === 0) tremolo(B + 2, 1.75, kd(u, r.pick([3, 4, 5])), 0.32);
            if (bar === 0 || bar === 4) koto(B, 2, [kd(u, 0), kd(u, 5)], 0.4);
            continue;
          }
          if (flowing) FLOW[(bar + (plan.id === "stream2" ? 2 : 0)) % FLOW.length].forEach((d, i) => koto(B + i * 0.5, 0.55, kd(u, d, u.c.base + 7), (i % 4 === 0 ? 0.48 : 0.38) - (restIn(B, B + 4) ? 0 : 0.04)));
          else {
            const cell = CELLS[(bar + plan.round + (plan.id === "garden2" ? 1 : 0)) % CELLS.length];
            cell.forEach(([b, d, x]) => koto(B + b, d, kd(u, x, u.c.base + 4), 0.42 + (b === 0 ? 0.05 : 0)));
          }
        }
      }

      // ================= bass koto, drone, pad =================
      units.forEach((u, i) => {
        const B = i * 8;
        const bn = T.nearest(41, [u.c.pcs[((u.d % 5) + 5) % 5]], 36, 47);
        const fifth = T.nearest(bn + 7, u.c.pcs, bn + 5, bn + 9); // the fifth, or the scale's nearest tone to it
        push("drone", B, 7.9, bn, plan.id === "still" ? 0.45 : 0.55);
        if (kata) {
          for (let bar = 0; bar < 2; bar++) {
            const b0 = B + bar * 4;
            if (plan.id === "kata3" && i === 3 && bar === 1) { push("bassKoto", b0, 2, [bn, fifth], 0.75); continue; }
            push("bassKoto", b0, 1.4, bn, 0.7); push("bassKoto", b0 + 1.5, 0.9, bn, 0.5); push("bassKoto", b0 + 2.5, 1.2, fifth, 0.55);
          }
        } else {
          push("bassKoto", B, 3.5, [bn, bn + 12], 0.55);
          if (plan.id.startsWith("stream") || plan.id === "garden2") push("bassKoto", B + 6, 1.8, fifth, 0.42);
        }
        // pad: every other degree of the scale stacked (4ths and 3rds), voice-led
        let best = null, bestS = Infinity;
        const same = state.padKey === symOf(u.c, u.d) && state.padV;
        for (let d0 = -3; d0 <= 6 && !same; d0++) {
          const v = [d0, d0 + 2, d0 + 4].map((d) => deg(u.c, d, u.c.base - 12));
          if (v[0] < 55 || v[2] > 77) continue;
          const pv = state.padV || [60, 65, 69];
          const moved = v.reduce((a, m, j) => a + Math.abs(m - pv[j]), 0);
          const s = moved + (moved === 0 ? 8 : 0) + (mod12(v[0]) === mod12(bn) ? -1 : 0) + r() * 1.5;
          if (s < bestS) { bestS = s; best = v; }
        }
        if (same) best = state.padV;
        state.padV = best; state.padKey = symOf(u.c, u.d);
        const padVel = plan.id === "still" ? 0.4 : kata ? 0.3 : 0.38;
        push("pad", B, 7.9, best, padVel);
        if (kata || plan.id.startsWith("stream")) push("strings", B, 7.9, best.map((m) => m - 12).filter((m) => m >= 50), kata ? 0.42 : 0.32);
      });

      // ================= percussion =================
      const hit = (abs, voice, vel, pitch) => push("drums", abs, 0.25, voice, vel, pitch != null ? { pitch } : {});
      const taikoPitch = 36 + (mod12(plan.centre.pc - 0) % 6); // tuned near the centre, between C2 and F2
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        if (P === 1 && bar % 2 === 0) { hit(B, "taiko", 0.34, taikoPitch); hit(B + 0.4, "taiko", 0.22, taikoPitch); } // heartbeat
        if (P === 2) {
          hit(B, "taiko", 0.32, taikoPitch); hit(B + 0.4, "taiko", 0.2, taikoPitch);
          if (bar >= 2) [1, 2.5, 3].forEach((b) => hit(B + b, "shime", 0.2 + (b === 1 ? 0.05 : 0)));
          if (bar % 4 === 3) hit(B + 3.5, "kachi", 0.3);
        }
        if (P >= 3) {
          // shime ji-uchi: steady eighths, accented on the beat
          const shimeFrom = plan.id === "kata1" ? 1 : 0;
          if (bar >= shimeFrom && !(plan.id === "kata3" && bar === 7)) for (let b = 0; b < 4; b += 0.5) hit(B + b, "shime", b % 1 ? 0.22 : 0.32 + (b === 0 ? 0.06 : 0));
          // o-daiko: don . . doko don . don .
          const tb = plan.id === "kata1" && bar < 2 ? [[0, 0.62]] : [[0, 0.7], [1.5, 0.42], [1.75, 0.38], [2, 0.62], [3, 0.48]];
          if (!(plan.id === "kata3" && bar >= 6)) tb.forEach(([b, v]) => hit(B + b, "taiko", v, taikoPitch));
          if (P >= 4 && bar % 4 === 1 && !(plan.id === "kata3" && bar >= 6)) hit(B + 3.5, "taiko", 0.4, taikoPitch + 7); // a higher chu-daiko answer
          // kachi on the rim: the "ka" offbeats
          if (bar >= (plan.id === "kata1" ? 2 : 0) && !(plan.id === "kata3" && bar >= 6)) [0.5, 2.5].forEach((b) => hit(B + b, "kachi", 0.34));
          if (P >= 4 && bar % 4 === 3 && !(plan.id === "kata3" && bar >= 6)) [3, 3.25, 3.5, 3.75].forEach((b, i) => hit(B + b, "taiko", 0.36 + i * 0.07, taikoPitch + 5)); // doko-doko into the next phrase
        }
      }
      if (plan.id === "kata3") { // oroshi: strokes accelerating from quarters to a roll, one great stroke, then silence
        let t = 24, gap = 1;
        while (t < 30.8) { hit(t, "taiko", Math.min(0.85, 0.38 + (t - 24) * 0.07), taikoPitch); t += gap; gap = Math.max(0.125, gap * 0.8); }
        hit(31 - 0.0, "taiko", 0.95, taikoPitch); hit(31, "kachi", 0.6);
      }
      if (P === 0 && plan.id === "garden1" && plan.round === 0) hit(0, "kachi", 0.35); // one clap of the hyoshigi to open

      // ================= texture: water, wind, chimes =================
      push("water", 0, 30, "stream", plan.id === "still" ? 0.9 : kata ? 0.45 : 0.75);
      const drips = kata ? 2 : plan.id === "still" ? 7 : 4;
      for (let i = 0; i < drips; i++) push("water", r.range(0, 31) , 0.25, "drip", r.range(0.15, 0.35), { freq: r.range(700, 1400), pan: r.range(-0.7, 0.7) });
      const gusts = plan.id === "still" ? 2 : kata ? 0 : 1;
      for (let g = 0; g < gusts; g++) {
        const at = Math.round(r.range(g * 14, g * 14 + 10) * 2) / 2, len = r.range(10, 16);
        push("wind", at, len, "gust", r.range(0.5, 0.9));
        // the gust sets the chimes off near its peak
        const peak = at + len * 0.4, c = unitAt(Math.min(31, peak)).c, pool = T.notesIn(c.pcs, 84, 98);
        const n = r.int(3, 6);
        for (let j = 0; j < n; j++) { const b = peak + r.range(-1.5, 2.5); if (b < 31.5) push("chimes", b, 2, r.pick(pool), r.range(0.15, 0.35)); }
      }
      if (!kata && r.chance(0.6)) { // a stray glint
        const b = r.range(2, 30), c = unitAt(b).c;
        push("chimes", b, 2, r.pick(T.notesIn(c.pcs, 86, 96)), r.range(0.12, 0.25));
      }

      const out = { events: ev.filter((e) => e.bar * BPB + e.beat < 32), harmony, section: plan.label, state };
      if (plan.bpm) out.tempo = { bpm: plan.bpm, rampBeats: plan.id === "still" ? 12 : 8 };
      return out;
    },
  });
})();
