// Night Drive: outrun synthwave in F# minor at 100 BPM, a neon highway at 2 a.m.
//
// One drive is thirteen 8-bar phrases (about 4 minutes):
//   intro · verse · verse · pre-chorus · chorus · chorus · breakdown · bridge (sax) · bridge (sax) ·
//   pre-chorus (pivot) · LAST CHORUS up a whole step (G# minor) ×2 · outro
// The outro stays in G# minor and settles on Eadd9, which is the VII of F# minor, so the next intro's
// F#m9 arrives as a cadence rather than a drop.
//
// Harmony: the chorus is the i – VI – III – VII loop (F#m D A E) that the genre runs on; the second chorus
// swaps its last two bars for Bm9 and a harmonic-minor C#7 that falls deceptively into the breakdown. The
// bridge leaves the key: Dmaj9 drops a major third to Bbmaj9 (a chromatic mediant), back, then Fmaj9 moves to
// C#7 by another major third, sharing the E#/F; C#7 resolves deceptively to the pre-chorus's Dmaj9. The pivot
// pre-chorus swaps its cadence for Emaj9 – F# (VI – VII of the new key) and lands in G# minor.
// Tunes: a yearning verse line (C# E F#, held), a pre-chorus of long notes climbing a step every bar, and a
// stepwise falling hook (C# B A G#) that climbs to its peak in the second half. A mono saw lead with delayed
// vibrato sings them; the alto sax takes a two-phrase solo in the bridge that quotes the hook's rhythm.
// Groove: 8th-note saw bass, 16th pluck arpeggios (up, up-down, the 3-over-4 "trip" figure) through a
// ping-pong echo, side-chained supersaw pads, a big kick and a gated snare (claps on the chorus), Simmons tom
// fills, crashes on arrivals, tambourine and shaker as the auxiliary layer, and a breakdown of just pads and
// arp before the drums come back in with a fill.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony (written in F# minor) ----------
  const PROG_TXT = {
    intro: "| F#m9 | Dmaj9 | A | Esus4 E | F#m9 | Dmaj9 | A | Esus4 E |",
    verse: "| F#m9 | F#m9 | Dmaj9 | Dmaj9 | Bm9 | Bm9 | Dmaj9 | Esus4 E |",
    pre: "| Dmaj9 | E | C#m7 | F#m9 | Dmaj9 | E | Bm9 | C#7sus4 C#7 |",
    premod: "| Dmaj9 | E | C#m7 | F#m9 | Dmaj9 | E | Emaj9 | F#sus4 F# |",
    chorusA: "| F#m9 | Dmaj9 | Amaj9 | E | F#m9 | Dmaj9 | Amaj9 | E |",
    chorusB: "| F#m9 | Dmaj9 | Amaj9 | E | F#m9 | Dmaj9 | Bm9 | C#7sus4 C#7 |",
    brk: "| F#m9 | Dmaj9 | A | E | F#m9 | Dmaj9 | Bm9 | C#7sus4 |",
    bridge: "| Dmaj9 | Dmaj9 | Bbmaj9 | Bbmaj9 | Dmaj9 | Dmaj9 | Fmaj9 | C#7sus4 C#7 |",
    outro: "| G#m9 | Emaj9 | B | F#sus4 F# | G#m9 | Emaj9 | Eadd9 | Eadd9 |",
  };

  // ---------- tunes (in F# minor) [bar, beat, dur, note] ----------
  const VERSE = [
    [0, 0.5, 0.5, "C#5"], [0, 1, 0.5, "E5"], [0, 1.5, 2, "F#5"], [0, 3.5, 0.5, "E5"], [1, 0, 1, "C#5"], [1, 1, 0.5, "B4"], [1, 1.5, 2, "C#5"],
    [2, 0.5, 0.5, "A4"], [2, 1, 0.5, "C#5"], [2, 1.5, 2, "E5"], [2, 3.5, 0.5, "F#5"], [3, 0, 1, "E5"], [3, 1, 0.5, "C#5"], [3, 1.5, 2, "A4"],
    [4, 0.5, 0.5, "B4"], [4, 1, 0.5, "D5"], [4, 1.5, 2, "F#5"], [4, 3.5, 0.5, "A5"], [5, 0, 1.5, "F#5"], [5, 1.5, 0.5, "E5"], [5, 2, 1.75, "C#5"],
    [6, 0.5, 0.5, "D5"], [6, 1, 0.5, "E5"], [6, 1.5, 1.5, "F#5"], [6, 3, 1, "A5"], [7, 0, 1.5, "B5"], [7, 1.5, 0.5, "A5"], [7, 2, 1.75, "G#5"],
  ];
  // the verse's second time: the last phrase reaches up to C#6 instead
  const VERSE_TAIL2 = [[6, 0.5, 0.5, "D5"], [6, 1, 0.5, "F#5"], [6, 1.5, 1.5, "A5"], [6, 3, 1, "C#6"], [7, 0, 1.5, "B5"], [7, 1.5, 0.5, "A5"], [7, 2, 1.75, "G#5"]];
  const PRE = [
    [0, 0, 3, "F#5"], [0, 3, 1, "E5"], [1, 0, 3, "G#5"], [1, 3, 1, "F#5"], [2, 0, 3, "G#5"], [2, 3, 1, "B5"], [3, 0, 3.75, "A5"],
    [4, 0, 3, "A5"], [4, 3, 1, "B5"], [5, 0, 3, "B5"], [5, 3, 1, "C#6"],
  ];
  const PRE_TAIL = [[6, 0, 3, "D6"], [6, 3, 1, "C#6"], [7, 0, 2, "B5"], [7, 2, 1.75, "G#5"]];
  const PREMOD_TAIL = [[6, 0, 3, "D#6"], [6, 3, 1, "C#6"], [7, 0, 2, "B5"], [7, 2, 1.75, "A#5"]];
  const HOOK = [
    [0, 0, 1.5, "C#6"], [0, 1.5, 0.5, "B5"], [0, 2, 1, "A5"], [0, 3, 1, "G#5"],
    [1, 0, 3, "A5"], [1, 3, 0.5, "F#5"], [1, 3.5, 0.5, "A5"],
    [2, 0, 1.5, "B5"], [2, 1.5, 0.5, "A5"], [2, 2, 1, "G#5"], [2, 3, 1, "E5"],
    [3, 0, 2, "G#5"], [3, 2, 1, "F#5"], [3, 3, 1, "E5"],
    [4, 0, 1.5, "C#6"], [4, 1.5, 0.5, "B5"], [4, 2, 1, "A5"], [4, 3, 1, "C#6"],
    [5, 0, 2, "D6"], [5, 2, 1, "C#6"], [5, 3, 1, "A5"],
  ];
  const HOOK_END_A = [[6, 0, 1.5, "E6"], [6, 1.5, 0.5, "C#6"], [6, 2, 1, "B5"], [6, 3, 1, "A5"], [7, 0, 2.5, "B5"], [7, 2.5, 0.5, "G#5"], [7, 3, 0.75, "F#5"]];
  const HOOK_END_B = [[6, 0, 1.5, "D6"], [6, 1.5, 0.5, "C#6"], [6, 2, 1, "B5"], [6, 3, 1, "F#5"], [7, 0, 2, "F#5"], [7, 2, 1.75, "E#5"]];
  const OUTRO_TAG = [[0, 0, 1.5, "D#6"], [0, 1.5, 0.5, "C#6"], [0, 2, 1, "B5"], [0, 3, 1, "A#5"], [1, 0, 3.5, "B5"], [4, 0, 1.5, "D#6"], [4, 1.5, 0.5, "C#6"], [4, 2, 2, "B5"], [5, 0, 4, "G#5"]];
  // the hook's opening cell as a C.line motif for the sax
  const HOOK_MOTIF = { len: 4, rhythm: [{ off: 0, dur: 1.5 }, { off: 1.5, dur: 0.5 }, { off: 2, dur: 1 }, { off: 3, dur: 1 }], steps: [0, -1.25, -1.25, -0.6] };

  // ---------- form ----------
  const PHRASES = ["intro", "v1", "v2", "pre", "c1", "c2", "brk", "br1", "br2", "premod", "mc1", "mc2", "outro"];
  const PLAN = {
    intro: { prog: "intro", t: 0, drums: "intro", bass: "8", arp: "trip", arpLo: 57, pad: 1, fill: "toms", d: "the engine turns over" },
    v1: { prog: "verse", t: 0, drums: "verse", bass: "8", arp: "up", arpLo: 54, pad: 1, lead: "verse", fill: "toms", d: "lead" },
    v2: { prog: "verse", t: 0, drums: "verse", bass: "8oct", arp: "broken", arpLo: 54, pad: 1, lead: "verse2", vary: 1, aux: "shaker", fill: "toms", d: "shaker in" },
    pre: { prog: "pre", t: 0, drums: "pre", bass: "8oct", arp: "updown", arpLo: 57, pad: "rise", lead: "pre", fill: "roll", d: "climbing" },
    c1: { prog: "chorusA", t: 0, drums: "chorus", crash: 1, bass: "drive", arp: "trip", arpLo: 57, pad: "pump", lead: "chorusA", aux: "tamb", fill: "toms", d: "the hook" },
    c2: { prog: "chorusB", t: 0, drums: "chorus", bass: "drive", arp: "broken", arpLo: 57, pad: "pump", lead: "chorusB", aux: "tamb", fill: "stop", d: "the hook again" },
    brk: { prog: "brk", t: 0, drums: "none", arp: "trip", arpLo: 61, pad: 1, fill: "return", d: "breakdown: pads and arp" },
    br1: { prog: "bridge", t: 0, drums: "half", crash: 1, bass: "long", arp: "up8", arpLo: 57, pad: 1, sax: 1, fill: "toms", d: "sax solo, half time" },
    br2: { prog: "bridge", t: 0, drums: "chorus", crash: 1, bass: "drive", arp: "updown", arpLo: 57, pad: "pump", sax: 2, aux: "tamb", fill: "roll", d: "sax solo, full band" },
    premod: { prog: "premod", t: 0, drums: "pre", bass: "8oct", arp: "updown", arpLo: 57, pad: "rise", lead: "premod", fill: "roll", d: "the pivot" },
    mc1: { prog: "chorusA", t: 2, drums: "chorus", crash: 1, bass: "drive", arp: "trip", arpLo: 57, pad: "pump", lead: "chorusA", double: 1, aux: "tamb", fill: "toms", d: "up a step" },
    mc2: { prog: "chorusA", t: 2, drums: "chorus", crash: 1, bass: "drive", arp: "broken", arpLo: 57, pad: "pump", lead: "chorusA", double: 1, vary: 1, saxFills: 1, aux: "tamb", fill: "toms", d: "up a step, sax answering" },
    outro: { prog: "outro", t: 0, drums: "outro", crash: 1, bass: "outro", arp: "trip", arpLo: 59, pad: 1, lead: "tag", d: "exit ramp" },
  };

  // arp figures over an ascending chord-tone list: indices per 16th
  const ARP = {
    up: [0, 1, 2, 3, 4, 5, 6, 7], updown: [0, 1, 2, 3, 4, 3, 2, 1], trip: [0, 1, 2, 0, 1, 2, 0, 1], broken: [0, 2, 1, 3, 2, 4, 3, 5], up8: [0, 1, 2, 3, 4, 5, 6, 7],
  };

  // ---------- transposition (sharp spelling: F# minor and G# minor) ----------
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function trChord(sym, t) {
    if (!t) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)$/.exec(sym);
    return SHARP[mod12(T.PC[m[1]] + t)] + m[2];
  }
  const progCache = new Map();
  function progFor(name, t) {
    const k = `${name}|${t}`;
    if (!progCache.has(k)) {
      const text = PROG_TXT[name].split(/\s+/).map((tok) => (tok === "|" || tok === "" ? tok : trChord(tok.split(":")[0], t) + (tok.includes(":") ? ":" + tok.split(":")[1] : ""))).join(" ");
      progCache.set(k, T.progression(text));
    }
    return progCache.get(k);
  }
  function tuneFor(lead) {
    switch (lead) {
      case "verse": return VERSE;
      case "verse2": return VERSE.filter(([b]) => b < 6).concat(VERSE_TAIL2);
      case "pre": return PRE.concat(PRE_TAIL);
      case "premod": return PRE.concat(PREMOD_TAIL);
      case "chorusA": return HOOK.concat(HOOK_END_A);
      case "chorusB": return HOOK.concat(HOOK_END_B);
      case "tag": return OUTRO_TAG;
      default: return null;
    }
  }

  // voicings: reject low seconds/thirds (mud) and any adjacent semitone
  const rough = (v) => v.some((a, i) => i > 0 && ((v[i - 1] < 55 && a - v[i - 1] < 3) || a - v[i - 1] === 1));
  function voiceClean(sym, opts) {
    const n = opts.n ?? 4;
    const tries = [opts, { ...opts, spread: "drop2" }, { ...opts, spread: "close" }, { ...opts, spread: "open" }, { ...opts, lo: opts.lo + 3 }, { ...opts, rootless: false },
      { ...opts, rootless: false, spread: "drop2" }, { ...opts, n: n - 1 }, { ...opts, n: n - 1, lo: opts.lo + 3 }, { ...opts, n: n - 1, rootless: false }];
    let first = null;
    for (const o of tries) { const v = T.voice(sym, o); first = first || v; if (!rough(v)) return v; }
    return first;
  }

  /** Arp notes for a chord from its lowest root at or above lo-4: R 3 5 (8) for the trip figure; R 3 5 7 with the
   *  9th only from C4 up for the others (a 9th low in the arp is a cluster). */
  const arpCache = new Map();
  function arpTones(sym, lo, triad) {
    const k = `${sym}|${lo}|${triad}`;
    if (arpCache.has(k)) return arpCache.get(k);
    const c = T.chord(sym);
    const base = T.nearest(lo, [c.root], lo - 4, lo + 8);
    const fifth = mod12(c.root + (c.intervals.find((x) => x >= 6 && x <= 8) ?? 7));
    const third = c.guide[0];
    let out;
    if (triad) out = [base, T.nearest(base + 4, [third], base + 2, base + 6), T.nearest(base + 7, [fifth], base + 5, base + 8), base + 12];
    else {
      const core = [c.root, third, fifth, ...(c.guide[1] != null ? [c.guide[1]] : [])];
      out = T.notesIn(core, base, base + 20).filter((m) => m >= base);
      T.notesIn(c.colors, Math.max(60, base), base + 20).forEach((m) => { if (!out.some((x) => Math.abs(x - m) < 2)) out.push(m); });
      out.sort((a, b) => a - b);
    }
    arpCache.set(k, out);
    return out;
  }

  /** Lydian over the major-ninth chords (no 4th rubbing on the 3rd), the chord scale elsewhere. */
  const saxScale = (sym) => { const c = T.chord(sym); return c.kind === "major7" ? T.scale(c.root, "lydian") : c.scale; };

  Sim.register({
    id: "night-drive",
    title: "Night Drive",
    genre: "Synthwave",
    about: "Outrun synthwave in F# minor at 100 BPM: driving saw bass, pluck arpeggios, wide supersaw pads and a soaring lead over a gated-snare beat, a breakdown, a sax solo across chromatic-mediant chords and a last chorus a whole step up.",
    situations: ["chase", "romance", "hangout"],
    energy: 0.7,
    bpm: 100, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out, bpm } = ctx;
      const spb = 60 / bpm;
      const hall = I.reverb(ctx, out, { decay: 4.2, preDelay: 0.035, lowcut: 350, highcut: 7000 });
      const plate = I.reverb(ctx, out, { decay: 1.8, preDelay: 0.012, lowcut: 400, highcut: 8000 });
      const echo = I.delay(ctx, out, { time: 0.75 * spb, feedback: 0.34, pingPong: true, highcut: 3600 });
      const gverb = I.gatedReverb(ctx, out, { decay: 1.6, threshold: -36 });
      I.send(ctx, echo, hall, -10);
      const pump = I.pump(ctx, out, { depth: 0.45, release: 0.2 });

      // melody: saw lead (delayed vibrato), an octave-down supersaw double for the last chorus, alto sax
      const lead = I.lead(ctx, { volume: -1, vibrato: 5.3, vibratoDepth: 0.1, vibratoDelay: 0.32, glide: 0.04, base: 900, octaves: 2.6, detune: 14, release: 0.35 });
      const lp = I.place(ctx, lead, 0.06, out);
      I.send(ctx, lp, hall, -11); I.send(ctx, lp, echo, -13);
      const dbl = I.supersaw(ctx, { volume: -13, attack: 0.02, release: 0.35, cutoff: 2600, detune: 24 });
      const dp = I.place(ctx, dbl, -0.08, out);
      I.send(ctx, dp, hall, -12);
      const sax = I.sax(ctx, { volume: -1, cutoff: 3600, vibratoDepth: 0.045 });
      const sp = I.place(ctx, sax, 0.12, out);
      I.send(ctx, sp, hall, -9); I.send(ctx, sp, echo, -17);

      // harmony: wide supersaw pads (side-chained), pluck arps into the ping-pong
      const pad = I.supersaw(ctx, { volume: -9, attack: 0.4, release: 1.8, cutoff: 3000, detune: 38 });
      const padWide = ctx.keep(new Tone.Chorus({ frequency: 0.45, delayTime: 3.5, depth: 0.6, spread: 180, wet: 0.55 }).start());
      pad.out.connect(padWide); padWide.connect(pump.input);
      I.send(ctx, padWide, hall, -12);
      const arp = I.pluck(ctx, { volume: -9, cutoff: 500, octaves: 3.6, decay: 0.22, filterDecay: 0.14, resonance: 3 });
      const ap = ctx.keep(new Tone.Panner(-0.18));
      arp.out.connect(ap); ap.connect(pump.input);
      I.send(ctx, ap, echo, -9); I.send(ctx, ap, hall, -16);

      // bass: saw mono with a sine under it
      const bass = I.analog(ctx, { volume: -4, wave: "sawtooth", resonance: 2.2, base: 150, octaves: 2.8, attack: 0.003, decay: 0.16, sustain: 0.4, release: 0.07, filterDecay: 0.13 });
      const sub = I.sub(ctx, { volume: -11, attack: 0.005, release: 0.08 });
      I.place(ctx, bass, 0, out); I.place(ctx, sub, 0, out);

      // drums
      const kit = I.kit(ctx, { volume: -1, preload: ["kick909", "gatedSnare", "clap", "hatClosed", "hatOpen", "simmons", "crash", "tambourine", "shaker"] });
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, kp, plate, -18); I.send(ctx, kp, gverb, -14);

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        double: { layer: "melody", play: (t, e, d) => dbl.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.03 } },
        sax: { layer: "melody", play: (t, e, d) => sax.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        pad: {
          layer: "harmony",
          play(t, e, d) {
            if (e.sw) { const f = pad.filter.frequency; f.cancelScheduledValues(t); f.setValueAtTime(e.sw[0], t); f.exponentialRampToValueAtTime(e.sw[1], t + e.swDur * spb); }
            pad.play(t, e.note, d, e.vel);
          },
          humanize: { timing: 0, vel: 0 },
        },
        arp: { layer: "harmony", play: (t, e, d) => arp.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.05 } },
        bass: {
          layer: "bass",
          play(t, e, d) { bass.play(t, e.note, d, e.vel); sub.play(t, e.note, d, e.vel * 0.85); },
          humanize: { timing: 0.002, vel: 0.04 },
        },
        drums: {
          layer: "drums",
          play(t, e) {
            if (e.duck) pump.duck(t);
            kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.gate });
          },
          humanize: { timing: 0.003, vel: 0.06 },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const drive = Math.floor(cycle / PHRASES.length), pos = cycle % PHRASES.length;
      const name = PHRASES[pos], plan = PLAN[name];
      const nextName = PHRASES[(pos + 1) % PHRASES.length], nextPlan = PLAN[nextName];
      const prog = progFor(plan.prog, plan.t);
      const nextFirst = progFor(nextPlan.prog, nextPlan.t)[0].chord;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const hAbs = prog.map((h) => ({ chord: h.chord, start: h.bar * 4 + h.beat, end: h.bar * 4 + h.beat + h.dur }));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const pumped = plan.pad === "pump";

      // ---------- lead ----------
      const src = tuneFor(plan.lead);
      if (src) {
        let notes = src.map(([bar, beat, dur, n]) => ({ at: bar * 4 + beat, dur, note: T.midi(n) + plan.t }));
        // later drives and second verses: scoops into long notes (the glide makes them bends) and a fall-off now and then
        if (plan.vary || drive > 0) {
          const outN = [];
          notes.forEach((n, i) => {
            const prevEnd = i ? notes[i - 1].at + notes[i - 1].dur : -9;
            if (n.dur >= 1.5 && n.at - prevEnd >= 0.24 && n.at >= 0.25 && r.chance(0.3)) {
              const sc = T.chord(sym(n.at)).scale, g = T.step(n.note, -1, sc);
              if (n.note - g <= 2) outN.push({ at: n.at - 0.25, dur: 0.25, note: g, grace: true });
            }
            outN.push(n);
          });
          notes = outN;
        }
        notes.forEach((n, i) => {
          if (i + 1 < notes.length) n.dur = Math.min(n.dur, notes[i + 1].at - n.at - 0.03);
          n.dur = Math.min(n.dur, 31.9 - n.at);
          const vel = (n.grace ? 0.55 : n.dur >= 1.5 ? 0.78 : 0.7) + r.gauss(0.02);
          if (n.dur > 0.1) push("lead", n.at, n.dur, n.note, vel);
          if (plan.double && !n.grace && n.dur > 0.1) push("double", n.at, n.dur, n.note - 12, 0.55);
        });
        state.leadLast = notes[notes.length - 1].note;
      }

      // ---------- sax solo ----------
      if (plan.sax) {
        const second = plan.sax === 2;
        const m = C.line({
          start: second ? 0 : 0.5, end: 31, chordAt: sym, lo: second ? 64 : 61, hi: second ? 82 : 79, rng: r.fork(11 + plan.sax),
          density: (second ? 0.52 : 0.32) + 0.05 * (drive % 2), phrase: second ? [3, 7] : [4, 8], rest: second ? [0.5, 1.5] : [1, 2.5],
          motif: state.saxMotif || HOOK_MOTIF, motifProb: second ? 0.45 : 0.6, chromatic: second ? 0.14 : 0.08,
          register: second ? 0.62 : 0.48, prev: state.saxLast ?? 68, upbeatStart: 0.5, scaleFor: saxScale,
        });
        state.saxMotif = m.motif; state.saxLast = m.last;
        m.notes.forEach((n) => push("sax", n.beat, Math.max(0.2, n.dur), n.note, 0.6 + (n.vel - 0.6) * 1.3 + (second ? 0.05 : 0)));
        if (second) state.saxMotif = null;
      }

      // sax answers in the last chorus: short fills under the lead's held notes
      if (plan.saxFills) {
        [[4.5, 7], [12.25, 14.5], [20.5, 23], [28.5, 31]].forEach(([a, b], k) => {
          if (!r.chance(k === 3 ? 0.9 : 0.7)) return;
          const m = C.line({ start: a, end: b + 1, chordAt: sym, lo: 62, hi: 75, rng: r.fork(31 + k), density: 0.6, phrase: [b - a, b - a], rest: [4, 4],
            motif: null, chromatic: 0.1, register: 0.55, prev: state.saxLast ?? 68, upbeatStart: 0.8, scaleFor: saxScale });
          m.notes.filter((n) => n.beat < b).forEach((n) => push("sax", n.beat, Math.min(n.dur, b - n.beat), n.note, 0.5 + (n.vel - 0.6)));
          state.saxLast = m.last;
        });
      }

      // ---------- pads ----------
      if (plan.pad) {
        hAbs.forEach((h, i) => {
          if (i > 0 && hAbs[i - 1].chord.replace(/sus4$/, "") === h.chord) { /* sus resolving: keep it a fresh attack */ }
          const v = voiceClean(h.chord, { lo: 50, hi: 76, n: 4, prev: state.padV, top: [66, 74], rng: r });
          state.padV = v;
          const extra = plan.pad === "rise" ? { sw: [900 + 2600 * (h.start / 32), 900 + 2600 * (h.end / 32)], swDur: h.end - h.start } : name === "brk" && i === 0 ? { sw: [1200, 3000], swDur: 32 } : i === 0 ? { sw: [3000, 3000], swDur: 1 } : undefined;
          push("pad", h.start, h.end - h.start - 0.05, v, name === "brk" ? 0.5 : 0.44, extra);
        });
      }

      // ---------- arpeggio ----------
      if (plan.arp) {
        const ROT = { up: "broken", broken: "updown", updown: "up", trip: "trip", up8: "up8" };
        const pat = ARP[drive % 2 ? ROT[plan.arp] : plan.arp], eighths = plan.arp === "up8";
        const step = eighths ? 0.5 : 0.25;
        const lo = plan.arpLo;
        for (let b = 0; b < 32 - 1e-9; b += step) {
          if (name === "c2" && b >= 30) break; // the stop before the breakdown
          const c = T.chord(sym(b));
          const tones = arpTones(sym(b), lo, plan.arp === "trip");
          const k = Math.round(b / step);
          const idx = pat[k % 8] + (plan.arp === "trip" ? 0 : Math.floor(k / 8) % 2 ? 1 : 0);
          const note = tones[idx % tones.length];
          const accent = Math.abs(b - Math.round(b)) < 1e-6 ? 0.1 : 0;
          const fade = name === "brk" ? 0.4 + 0.25 * (b / 32) : 0.55;
          push("arp", b, step * 0.9, note, fade + accent + r.gauss(0.02));
        }
      }

      // ---------- bass ----------
      if (plan.bass) {
        const rootOf = (s) => T.nearest(36, [T.chord(s).bass], 30, 41);
        let last = state.bassLast ?? 30;
        hAbs.forEach((h, i) => {
          const root = rootOf(h.chord), nextSym = i + 1 < hAbs.length ? hAbs[i + 1].chord : nextFirst, nr = rootOf(nextSym);
          const c = T.chord(h.chord), fifth = root + (c.intervals.find((x) => x >= 6 && x <= 8) ?? 7);
          for (let b = h.start; b < h.end - 1e-9; b += 0.5) {
            const k = Math.round((b - h.start) * 2), lastEighth = b + 0.5 >= h.end - 1e-9;
            if (name === "c2" && b >= 30) break;
            if (plan.bass === "long") {
              if (k === 0) { push("bass", b, Math.min(2.9, h.end - b - 0.1), root, 0.85); last = root; }
              else if (k === 4 && h.end - h.start >= 4) { push("bass", b, 1.4, fifth, 0.7); last = fifth; }
              else if (lastEighth && h.end - h.start >= 4) { // a scale step into the next root (the fifth when the chord repeats)
                const sc = T.chord(h.chord).scale;
                const a = nr === root ? fifth - 12 >= 30 ? fifth - 12 : fifth : [nr - 2, nr - 1, nr + 1, nr + 2].find((x) => x >= 30 && sc.includes(mod12(x))) ?? fifth;
                push("bass", b, 0.4, a, 0.6); last = a;
              }
              continue;
            }
            if (plan.bass === "outro" && h.start >= 16) { if (k === 0) push("bass", b, h.end - b - 0.1, root, 0.72); continue; }
            let n = root, vel = [0.9, 0.58, 0.72, 0.6, 0.84, 0.58, 0.72, 0.62][k % 8];
            if (plan.bass === "8oct" && (k % 8 === 3 || k % 8 === 7)) n = root + 12 <= 47 ? root + 12 : root;
            if (plan.bass === "drive") {
              if (k % 8 === 2 || k % 8 === 6) n = root + 12;
              if (lastEighth && nr !== root && r.chance(0.7)) n = fifth - 12 >= 30 && Math.abs(fifth - 12 - nr) < Math.abs(fifth - nr) ? fifth - 12 : fifth;
            }
            push("bass", b, 0.42, n, vel);
            last = n;
          }
        });
        state.bassLast = last;
      }

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, vel, extra);
      const KICK = (abs, vel) => D(abs, "kick909", vel, pumped ? { duck: 1, pitch: 33 } : { pitch: 33 });
      const SNARE = (abs, vel, gate = 0.3) => D(abs, "gatedSnare", vel, { gate });
      const mode = plan.drums;
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        const fill = bar === 7 ? plan.fill : bar === 3 && (mode === "chorus" || mode === "verse") && r.chance(0.25) ? "lick" : null;
        const stopAt = fill === "toms" ? 3 : fill === "roll" ? 2 : fill === "stop" ? 2 : fill === "lick" ? 3.5 : 4;
        let m = mode;
        if (m === "intro") m = bar < 4 ? "kickhat" : "verse";
        if (m === "outro") m = bar < 4 ? "chorus" : bar < 6 ? "kickhat" : "none";
        if (m === "none") {
          if (fill === "return") { // the drums come back: a snare roll and a Simmons run
            [2, 2.25, 2.5, 2.75].forEach((p, i) => SNARE(B + p, 0.4 + 0.08 * i, 0.12));
            [[3, 59], [3.25, 55], [3.5, 50], [3.75, 45]].forEach(([p, pitch], i) => D(B + p, "simmons", 0.6 + 0.06 * i, { pitch }));
          }
          continue;
        }
        // kick
        if (m === "kickhat") [0, 1, 2, 3].forEach((p) => KICK(B + p, p % 2 ? 0.78 : 0.9));
        else if (m === "verse") { KICK(B, 0.92); KICK(B + 2, 0.88); if (r.chance(0.45)) KICK(B + 2.5, 0.62); if (bar % 2 === 1 && r.chance(0.35)) KICK(B + 3.5, 0.55); }
        else if (m === "pre" || m === "chorus") [0, 1, 2, 3].forEach((p) => { if (p < stopAt) KICK(B + p, p % 2 ? 0.82 : 0.94); });
        else if (m === "half") { KICK(B, 0.92); if (r.chance(0.5)) KICK(B + 1.5, 0.6); }
        // snare (gated) and claps
        if (m === "verse" || m === "pre" || m === "chorus") {
          if (1 < stopAt) SNARE(B + 1, 0.82);
          if (3 < stopAt) SNARE(B + 3, 0.86);
          if (m === "chorus") { if (1 < stopAt) D(B + 1, "clap", 0.45); if (3 < stopAt) D(B + 3, "clap", 0.48); }
        } else if (m === "half") SNARE(B + 2, 0.86, 0.42);
        // hats
        for (let s = 0; s < 16; s++) {
          const p = s / 4, q = s % 4;
          if (p >= stopAt) break;
          if (m === "kickhat" || m === "half") { if (q === 2) D(B + p, "hatClosed", 0.3 + r.gauss(0.02)); else if (q === 0 && m === "kickhat") D(B + p, "hatClosed", 0.16); }
          else if (m === "verse") { if (q === 0 || q === 2) D(B + p, "hatClosed", q ? 0.3 : 0.22); else if (r.chance(0.2)) D(B + p, "hatClosed", 0.1); }
          else if (m === "pre") D(B + p, "hatClosed", [0.24, 0.12, 0.3, 0.14][q] + r.gauss(0.015));
          else if (m === "chorus") { if (q === 2) D(B + p, "hatOpen", 0.24 + r.gauss(0.015)); else D(B + p, "hatClosed", [0.2, 0.12, 0, 0.14][q] + r.gauss(0.015)); }
        }
        if (m === "verse" && bar % 4 === 3 && stopAt >= 4) D(B + 3.5, "hatOpen", 0.26);
        // auxiliary: tambourine on the choruses, shaker on the second verse
        if (plan.aux === "tamb" && m === "chorus") for (let s = 0; s < 16; s++) { const p = s / 4; if (p >= stopAt) break; if (s % 4 === 2) D(B + p, "tambourine", 0.26); else if (s === 4 || s === 12) D(B + p, "tambourine", 0.32); else if (s === 15 && bar % 2 === 1) D(B + p, "tambourine", 0.16); }
        if (plan.aux === "shaker") for (let s = 0; s < 16; s++) { const p = s / 4; if (p >= stopAt) break; D(B + p, "shaker", [0.12, 0.07, 0.17, 0.08][s % 4]); }
        // crashes on arrivals
        if (bar === 0 && plan.crash) D(B, "crash", 0.62);
        if (bar === 4 && m === "chorus" && plan.crash) D(B, "crash", 0.42);
        // fills
        if (fill === "toms") [[3, 62, 0.62], [3.25, 57, 0.64], [3.5, 52, 0.68], [3.75, 47, 0.74]].forEach(([p, pitch, v]) => D(B + p, "simmons", v, { pitch }));
        else if (fill === "lick") { D(B + 3.5, "simmons", 0.55, { pitch: 55 }); D(B + 3.75, "simmons", 0.6, { pitch: 48 }); }
        else if (fill === "roll") {
          [2, 2.5, 3, 3.25, 3.5, 3.75].forEach((p, i) => SNARE(B + p, 0.5 + 0.07 * i, 0.12));
          KICK(B + 2, 0.85); KICK(B + 3, 0.85);
        } else if (fill === "stop") { SNARE(B + 2, 0.9, 0.42); D(B + 2, "crash", 0.5); }
      }

      const key = plan.t ? "G♯ minor" : plan.prog === "outro" ? "G♯ minor" : plan.prog === "bridge" ? "away from home" : "F♯ minor";
      const label = [name === "mc1" || name === "mc2" ? "Last chorus" : plan.d.charAt(0).toUpperCase() + plan.d.slice(1), key, drive > 0 ? `drive ${drive + 1}` : null].filter(Boolean).join(" · ");
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
