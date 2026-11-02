// Halogen: a night run under sodium lamps. 146 BPM, Bb lydian-dominant, written for an eight-voice
// imagination of a 1990 game console: one clipped-brass lead, one brass section, one FM bass, one pulse
// arpeggio, one kit, and a short dark echo that everything leans on.
//
// ---- the ideas, fixed before any code (these never change; the generator only arranges) ----
//
// THE HOOK (A, 8 bars, Bb). Rhythm of the cell: ♪ ♪ ♩ ♩. ♪ | ♪. ♪. 𝅗𝅥 — a rising arpeggio that leans on
// the raised fourth, then falls through the flat seventh and lands on the root off the beat.
//   bar 1  F4 Bb4 D5 E5~ D5        (5 1 3 #4 3 over Bb: the #4 is the strange note)
//   bar 2  C5 Ab4 Bb4~~             (2 b7 1: the mixolydian answer, 3+3+2 in eighths)
//   bar 3  G4 C5 E5 F#5~ E5        (the cell a step up, over C7#11: II7 is the surprise)
//   bar 4  D5 Bb4 C5~~
//   bar 5  Bb4 Eb5 G5 A5~ G5       (a third time, up to Eb lydian: the top of the arc)
//   bar 6  F5 E5 Eb5 D5 Db5 C5     (the pattern breaks: a chromatic fall over Ab7, the hinge)
//   bar 7  D5~~ C5 Bb4 A4          (hangs on the fifth of Gm7, slides to the third of F7)
//   bar 8  A4~ · Eb5 C5 A4 F4 Eb4  (the F7 arpeggio falls back into the pickup F4)
// Harmony: | Bb7#11 | Bb7#11 | C7#11 | C7#11 | Ebmaj7#11 | Ab7 | Gm7 | F7sus4 F7 |
//
// THE B THEME (G minor, 8 bars): the same cell turned upside down and reframed in the relative minor,
// the leaning note now a half step BELOW (the leading tone), harmony moving every two beats.
//   D6 Bb5 G5 F#5~ G5 | Eb5 C5 D5~~ | C6 G5 Eb5 D5~ Eb5 | F5 Eb5 D5 C5 Bb4 A4 |
//   Bb4 D5 G5 A5~ G5 | C6 A5 Bb5~~ | G5 Bb5 D6 Eb6~ D6 | C6~ Bb5 A5 F5 Eb5 C5 |
// Harmony: | Gm D7/F# | Cm7 | Ebmaj7 | D7 D7b9 | Gm Gm/F | Ebmaj7#11 | Abmaj7#11 | Gb7#11 F7 |
//
// THE BASS RIFF: straight eighths in octaves (root, octave, root, octave...) whose last two beats crawl
// chromatically up into the next root (F F# G Ab | Bb); on the pedal bars the flat seventh kicks under the
// octave (Bb Bb Ab Bb). In the breakdown the bass plays the hook's first two bars itself, in Db and E: the
// hook was a bass line all along.
//
// ---- form: one lap = 7 cycles of 8 bars (about 1:32), after a one-time 8-bar intro ----
//   A1  hook, lead alone over the riff               A2  hook, the brass colours the leaning notes; turns to G minor
//   B   the B theme, ride cymbal, brass pads          A3  the hook back in octaves (lead + brass an octave down),
//                                                        the bass joins the chromatic hinge in unison
//   BRK breakdown: kick and hats only, the bass sings the hook in Db and E (chromatic mediants), the lead
//       creeps in on long thirds, a snare build        A4  the lift: the hook a minor third up in Db, harmonised in
//                                                        sixths, sixteenth hats, tambourine
//   TAG the hook's first bars as a tag in Db over Db Gb Ab7, then four bars of breath on the Bb pedal
//       (the pulse ostinato, or a drum-and-bass break on alternate laps) and the pickup fill into A1
// Per cycle the generator chooses only: kick figures, hat density, fills, stab placement, ghost notes,
// bass walk shapes, grace notes and velocities. The melodies above are never regenerated.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BPM = 146;
  const mod12 = T.mod12;
  const dB = (x) => Math.pow(10, x / 20);

  // ---------- notation: "F4/.5 Bb4/.5 | ..." bars of 4 beats; r = rest; trailing _ ties into the next note ----------
  function mel(text) {
    const out = [];
    text.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let pos = 0;
      bar.split(/\s+/).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)(_?)$/.exec(tok);
        if (!m) throw new Error(`halogen: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        out.push({ beat: bi * BPB + pos, dur, note: m[1] === "r" ? null : T.midi(m[1]), tie: m[3] === "_" });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`halogen: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    const merged = [];
    for (const n of out) {
      const p = merged[merged.length - 1];
      if (p && p.tie && p.note === n.note && Math.abs(p.beat + p.dur - n.beat) < 1e-6) { p.dur += n.dur; p.tie = n.tie; }
      else merged.push({ ...n });
    }
    return merged.filter((n) => n.note != null);
  }
  /** Transpose a chord symbol by n semitones (flat spellings: the piece lives in Bb and Db). */
  function tx(sym, n) {
    if (!n) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    const nm = (p) => T.NAMES[mod12(T.PC[p] + n)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }

  // ---------- the tunes (home key) ----------
  const HOOK7 = "F4/.5 Bb4/.5 D5/1 E5/1.5 D5/.5 | C5/.75 Ab4/.75 Bb4/2 r/.5 | G4/.5 C5/.5 E5/1 F#5/1.5 E5/.5 | D5/.75 Bb4/.75 C5/2 r/.5 | " +
    "Bb4/.5 Eb5/.5 G5/1 A5/1.5 G5/.5 | F5/.75 E5/.75 Eb5/.5 D5/.5 Db5/.5 C5/1 | D5/2.5 C5/.5 Bb4/.5 A4/.5_ | ";
  const HOOK = {
    down: mel(HOOK7 + "A4/1 r/.5 Eb5/.5 C5/.5 A4/.5 F4/.5 Eb4/.5"),  // F7 falls back into the pickup
    toB: mel(HOOK7 + "A4/1 r/.5 F#4/.5 A4/.5 C5/.5 Eb5/.5 F#5/.5"), // D7b9 climbs into the B theme
  };
  const BTUNE = mel("D6/.5 Bb5/.5 G5/1 F#5/1.5 G5/.5 | Eb5/.75 C5/.75 D5/2 r/.5 | C6/.5 G5/.5 Eb5/1 D5/1.5 Eb5/.5 | F5/.75 Eb5/.75 D5/.5 C5/.5 Bb4/.5 A4/1 | " +
    "Bb4/.5 D5/.5 G5/1 A5/1.5 G5/.5 | C6/.75 A5/.75 Bb5/2 r/.5 | G5/.5 Bb5/.5 D6/1 Eb6/1.5 D6/.5 | C6/1.5 Bb5/.5 A5/.5 F5/.5 Eb5/.5 C5/.5");
  // the tag: the cell twice, the second time landing on Ab (V of Db, and bVII of home)
  const TAG = mel("F4/.5 Bb4/.5 D5/1 E5/1.5 D5/.5 | C5/.75 Ab4/.75 Bb4/2 r/.5 | F4/.5 Bb4/.5 D5/1 E5/1.5 D5/.5 | C5/.75 A4/.75 F4/2 r/.5"); // played +3
  // the bass's own statement of the cell (breakdown), degrees relative to the chord root in the bass register
  const BASS_CELL = [[0, 0.5, -5], [0.5, 0.5, 0], [1, 1, 4], [2, 1.5, 6], [3.5, 0.5, 4], [4, 0.75, 2], [4.75, 0.75, -2], [5.5, 2, 0]];

  // ---------- harmony ----------
  const PROG = {
    INTRO: "| Bb7#11 | Bb7#11 | Bb7#11 | Bb7#11 | Bb7#11 | C7#11 | Ebmaj7#11 | Ab7:2 F7:2 |",
    A: "| Bb7#11 | Bb7#11 | C7#11 | C7#11 | Ebmaj7#11 | Ab7 | Gm7 | F7sus4:2 F7:2 |",
    AtoB: "| Bb7#11 | Bb7#11 | C7#11 | C7#11 | Ebmaj7#11 | Ab7 | Gm7 | D7b9 |",
    B: "| Gm:2 D7/F#:2 | Cm7 | Ebmaj7 | D7:2 D7b9:2 | Gm:2 Gm/F:2 | Ebmaj7#11 | Abmaj7#11 | Gb7#11:2 F7:2 |",
    BRK: "| Dbmaj7#11 | Dbmaj7#11 | Emaj7#11 | Emaj7#11 | Dbmaj7#11 | Emaj7#11 | Gb7#11 | F7 |",
    TAG: "| Db7#11 | Db7#11 | Db7#11 | Ab7 | Bb7#11 | Bb7#11 | Bb7#11 | Bb7#11 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG).map(([k, v]) => [k, T.progression(v, BPB)]));
  const LAP = ["A1", "A2", "B", "A3", "BRK", "A4", "TAG"];

  Sim.register({
    id: "halogen",
    title: "Halogen",
    genre: "Night-run fusion",
    about: "A 146 BPM night run in B♭ lydian-dominant for an imagined eight-voice console: a clipped-brass hook that leans on the raised fourth, an octave bass that crawls chromatically into every change, a B theme that turns the cell upside down in G minor, a breakdown where the bass sings the hook in D♭ and E, and a last return lifted a minor third.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["chase", "training"],
    energy: 0.85,

    instruments(ctx) {
      const { I, out } = ctx;
      // the console's output stage: a gentle top-end roll-off, as if everything came through a 32 kHz DAC
      const bus = ctx.keep(new Tone.Filter({ frequency: 9500, type: "lowpass", rolloff: -12 })).connect(out);
      // the SPC-ish echo: one eighth-note delay with a darkening filter inside the feedback loop,
      // so every repeat is duller than the last
      const echoIn = ctx.keep(new Tone.Gain(1));
      const echoD = ctx.keep(new Tone.Delay({ delayTime: 60 / BPM / 2, maxDelay: 1 }));
      const echoLp = ctx.keep(new Tone.Filter({ frequency: 2300, type: "lowpass", rolloff: -12 }));
      const echoFb = ctx.keep(new Tone.Gain(0.4));
      const echoOut = ctx.keep(new Tone.Gain(1)).connect(bus);
      echoIn.connect(echoD); echoD.connect(echoLp); echoLp.connect(echoFb); echoFb.connect(echoD); echoLp.connect(echoOut);
      const room = I.reverb(ctx, bus, { decay: 0.9, preDelay: 0.008, lowcut: 300, highcut: 6000 });

      // the lead: two detuned saws through a resonant filter, clipped, then rolled off (a brass patch with teeth)
      const leadSyn = ctx.keep(new Tone.MonoSynth({
        portamento: 0.012,
        oscillator: { type: "fatsawtooth", count: 2, spread: 7 },
        filter: { type: "lowpass", rolloff: -24, Q: 1.8 },
        envelope: { attack: 0.006, decay: 0.16, sustain: 0.72, release: 0.1 },
        filterEnvelope: { attack: 0.004, decay: 0.2, sustain: 0.38, release: 0.15, baseFrequency: 520, octaves: 2.7 },
      }));
      const leadClip = ctx.keep(new Tone.Distortion({ distortion: 0.3, oversample: "2x" }));
      const leadTone = ctx.keep(new Tone.Filter({ frequency: 4800, type: "lowpass", rolloff: -12 }));
      const leadVib = ctx.keep(new Tone.Vibrato({ frequency: 5.2, depth: 0.03 }));
      const leadOut = ctx.keep(new Tone.Gain(dB(-9)));
      leadSyn.chain(leadClip, leadTone, leadVib, leadOut);
      const leadSafe = I.monotonic(leadOut);

      // the brass section: the same recipe, polyphonic, shorter, more clipped
      const brassSyn = ctx.keep(new Tone.PolySynth({
        voice: Tone.MonoSynth, maxPolyphony: 10,
        options: {
          oscillator: { type: "fatsawtooth", count: 2, spread: 9 },
          filter: { type: "lowpass", rolloff: -24, Q: 1.2 },
          envelope: { attack: 0.01, decay: 0.12, sustain: 0.55, release: 0.08 },
          filterEnvelope: { attack: 0.008, decay: 0.16, sustain: 0.3, release: 0.12, baseFrequency: 420, octaves: 2.4 },
        },
      }));
      const brassClip = ctx.keep(new Tone.Distortion({ distortion: 0.4, oversample: "2x" }));
      const brassTone = ctx.keep(new Tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -12 }));
      const brassOut = ctx.keep(new Tone.Gain(dB(-12)));
      brassSyn.chain(brassClip, brassTone, brassOut);

      // the gated snare: band-passed noise plus a short body, crushed to seven bits, inside a room that is cut off dead
      const snOut = ctx.keep(new Tone.Gain(dB(-7)));
      const snGate = ctx.keep(new Tone.Gain(0)).connect(snOut);
      const snVerb = ctx.keep(new Tone.Reverb({ decay: 1.1, preDelay: 0.003, wet: 0.45 })).connect(snGate);
      const snCrush = ctx.keep(new Tone.BitCrusher({ bits: 7 })).connect(snVerb);
      const snBp = ctx.keep(new Tone.Filter({ frequency: 1900, type: "bandpass", Q: 0.6 })).connect(snCrush);
      const snNoise = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0.2, release: 0.05 } })).connect(snBp);
      const snBody = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.4, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.04 } })).connect(snVerb);
      snBody.volume.value = -4;
      const snSafe = I.monotonic(snGate);
      const snare = (time, vel, gate = 0.16) => {
        const t = snSafe(time);
        snGate.gain.cancelAndHoldAtTime(t);
        snGate.gain.setValueAtTime(1, t);
        snGate.gain.setValueAtTime(1, t + gate);
        snGate.gain.linearRampToValueAtTime(0, t + gate + 0.015);
        snNoise.triggerAttackRelease(gate * 0.8, t, vel);
        snBody.triggerAttackRelease(T.hz(50), 0.08, t, vel);
      };

      const bass = I.fmBass(ctx, { volume: -2, bite: 5 });
      const arp = I.pulse(ctx, { volume: -8, width: 0.5, decay: 0.07, sustain: 0.3, release: 0.03 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 34, preload: ["kick", "hatClosed", "hatOpen", "ride", "crash", "tom", "simmons", "tambourine"] });

      const lp = I.place(ctx, { out: leadOut }, 0.04, bus), bp = I.place(ctx, { out: brassOut }, -0.3, bus);
      const sp = I.place(ctx, { out: snOut }, 0.03, bus), ap = I.place(ctx, arp, 0.34, bus);
      I.place(ctx, bass, 0, bus);
      const kp = I.place(ctx, kit, 0, bus);
      I.send(ctx, lp, echoIn, -10); I.send(ctx, ap, echoIn, -7); I.send(ctx, sp, echoIn, -15); I.send(ctx, bp, echoIn, -19);
      I.send(ctx, bp, room, -13); I.send(ctx, kp, room, -17);

      return {
        lead: { layer: "melody", play: (t, e, d) => leadSyn.triggerAttackRelease(T.hz(e.note), d, leadSafe(t), e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        brass: { layer: "harmony", play: (t, e, d) => brassSyn.triggerAttackRelease((Array.isArray(e.note) ? e.note : [e.note]).map(T.hz), d, t, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.002, vel: 0.05 } },
        arp: { layer: "texture", play: (t, e, d) => arp.play(t, e.note, d, e.vel), humanize: { timing: 0.001, vel: 0.05 } },
        snare: { layer: "drums", play: (t, e) => snare(t, e.vel, e.gate), humanize: { timing: 0.002, vel: 0.06 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.002, vel: 0.07 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const intro = cycle === 0;
      const idx = intro ? -1 : (cycle - 1) % LAP.length, lap = intro ? 0 : Math.floor((cycle - 1) / LAP.length);
      const S = intro ? "INTRO" : LAP[idx];
      const isA = S[0] === "A";
      const key = S === "A4" ? 3 : 0; // the lift: a minor third up
      const progName = S === "A2" ? "AtoB" : isA ? "A" : S;
      const prog = PROGS[progName].map((e) => ({ ...e, chord: tx(e.chord, key) }));
      // the tag's first four bars live in Db: transpose them, leave the Bb pedal alone
      if (S === "TAG") prog.forEach((e) => { if (e.bar >= 4) e.chord = PROG.TAG.split("|")[e.bar + 1].trim(); });
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const ch = (b) => T.chord(sym(b));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const drum = (abs, voice, vel, extra) => push("drums", abs, 0.25, voice, vel, extra);
      const sn = (abs, vel, gate) => push("snare", abs, 0.25, "snare", vel, gate ? { gate } : {});
      if (state.bass == null) Object.assign(state, { bass: 34, bv: null, lastFill: null });
      const walkFrom = Array(8).fill(4); // beat within each bar where the bass starts its chromatic walk
      const nextSection = intro ? "A1" : LAP[(idx + 1) % LAP.length];
      const nextKey = nextSection === "A4" ? 3 : 0;
      const nextFirst = T.chord(tx(PROGS[nextSection === "A2" ? "AtoB" : nextSection[0] === "A" ? "A" : nextSection][0].chord, nextKey));

      // ================= lead =================
      const leadAttacks = [];
      const playTune = (notes, o = {}) => {
        const shift = (o.shift || 0) + key;
        notes.forEach((n) => {
          const note = n.note + shift;
          const inBar = n.beat % BPB;
          const vel = (o.vel ?? 0.8) + (inBar === 0 ? 0.05 : 0) + (n.dur >= 1.5 ? 0.04 : 0) + (n.dur <= 0.5 ? -0.03 : 0);
          push("lead", n.beat, Math.max(0.2, n.dur * (n.dur <= 0.5 ? 0.82 : 0.95)), note, vel);
          leadAttacks.push(n.beat);
        });
      };

      // ================= brass =================
      const triad = (b, lo = 56, hi = 76) => {
        const c = ch(b);
        const base = sym(b).split("/")[0].replace(/(maj7#11|7#11|maj7|7b9|7sus4|m7|7)$/, (m) => (m === "m7" ? "m" : m === "7sus4" ? "sus4" : ""));
        const v = T.voice(base, { lo, hi, n: 3, rootless: false, prev: state.bv, spread: "close", top: [64, 76] });
        state.bv = v;
        return v;
      };
      const stab = (abs, dur, vel, o = {}) => {
        if (!o.force && leadAttacks.some((x) => Math.abs(x - abs) < 0.3)) return; // answer the tune, never sit on it
        push("brass", abs, dur, triad(abs), vel);
      };
      const STABS = [[[1.5, 3.5], 3], [[1.5, 3], 2], [[2.5], 2], [[0.5, 2.5], 1.5], [[3.5], 1]];
      const stabBar = (bar, vel, until = 4) => {
        const B = bar * BPB, end = Math.min(until, walkFrom[bar]);
        r.weighted(STABS).filter((p) => p < end - 0.2).forEach((p) => stab(B + p, 0.3, vel + (p % 1 === 0.5 ? 0.03 : 0)));
      };
      /** The hook rhythm on brass alone (the intro's shadow of the tune). */
      const shadow = (bar, vel) => {
        const B = bar * BPB;
        const cell = bar % 2 === 0 ? [[0, 0.4], [0.5, 0.4], [1, 0.8], [2, 1.4], [3.5, 0.4]] : [[0, 0.6], [0.75, 0.6], [1.5, 1.8]];
        cell.forEach(([b, d]) => stab(B + b, d, vel + (d >= 1 ? 0.04 : 0), { force: true }));
      };

      // ================= arpeggio =================
      const arpBar = (bar, vel, o = {}) => {
        const B = bar * BPB;
        for (let s = 0; s < 16; s++) {
          const b = B + s * 0.25, c = ch(b);
          // the cell itself, 5 1 3 #4 rising from the fifth below the root, once per beat
          // (the chord's own colour where it has no #4); the last beat of odd bars turns it over
          const colour = c.scale.includes(mod12(c.root + 6)) ? 6 : c.intervals.includes(10) ? 10 : 11;
          const root = T.nearest(70, [c.root], 65, 76);
          const cell = [root - 5, root, root + (c.intervals.includes(3) ? 3 : 4), root + colour];
          const k = bar % 2 === 1 && s >= 12 ? 3 - (s % 4) : s % 4;
          const octave = o.high && s >= 8 && cell[k] + 12 <= 91 ? 12 : 0;
          push("arp", b, 0.2, cell[k] + octave, vel * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.8 : 0.68));
        }
      };

      // ================= bass =================
      const near = (pc, from = state.bass, lo = 33, hi = 45) => {
        let best = null, bs = Infinity;
        for (const m of T.notesIn([pc], lo, hi)) { const s = Math.abs(m - from) + 0.3 * Math.abs(m - 39); if (s < bs) { bs = s; best = m; } }
        return best;
      };
      const bassAt = (b) => near(ch(b).bass);
      const rootAfter = (bar) => (bar < 7 ? near(ch((bar + 1) * BPB).bass) : near(nextFirst.bass));
      /** The riff: octave eighths, the last beats crawling into the next root. */
      const riffBar = (bar, o = {}) => {
        const B = bar * BPB;
        const R = bassAt(B), N = rootAfter(bar);
        const changes = N !== R;
        const pedal = !changes && mod12(R) === ch(B).root && o.b7 !== false;
        // walk length: 4 eighths when the root moves, 2 when it does not and the dice say so
        const walk = changes ? (o.longWalk ?? r.chance(0.55) ? 4 : 2) : 0;
        walkFrom[bar] = 4 - walk / 2;
        for (let p = 0; p < 8; p++) {
          const b = B + p * 0.5;
          const pc = ch(b).bass;
          const rootHere = mod12(R) === pc ? R : near(pc, R);
          const vel = p === 0 ? 0.92 : p % 2 === 0 ? 0.8 : 0.7;
          if (walk && p >= 8 - walk) { // chromatic crawl: N-walk .. N-1 (or down from above when that would dig too low)
            const k = walk - (8 - p);
            push("bass", b, 0.42, N - walk >= 31 ? N - walk + k : N + walk - k, 0.74 + 0.03 * k);
          } else if (pedal && p === 6) push("bass", b, 0.42, rootHere + 10, 0.76); // the b7 kick under the octave
          else if (p % 2 === 1) push("bass", b, 0.4, rootHere + 12, vel);
          else push("bass", b, 0.44, rootHere, vel);
          if (o.ghosts && p % 2 === 0 && p < 7 - walk && r.chance(0.3)) push("bass", b + 0.25, 0.1, rootHere, 0.3);
        }
        state.bass = R;
      };
      /** B section: a syncopated fusion figure, two chords a bar. */
      const bBar = (bar) => {
        const B = bar * BPB, N = rootAfter(bar);
        const R1 = bassAt(B), R2 = near(ch(B + 2).bass, R1);
        const fig = r.weighted([[[[0, R1], [0.75, R1], [1.5, R1 + 12], [2, R2], [2.5, R2 + 12], [3, R2], [3.5, N - 1]], 3],
          [[[0, R1], [0.5, R1 + 12], [1.5, R1], [2, R2], [2.75, R2], [3.5, N > R2 ? N - 1 : N + 1]], 2],
          [[[0, R1], [1, R1 + 7], [1.5, R1 + 12], [2, R2], [3, R2 + 12], [3.5, N - 2]], 1.5]]);
        fig.forEach(([b, n], i) => push("bass", B + b, b % 1 === 0 ? 0.48 : 0.4, n, i === 0 ? 0.9 : b >= 2 && b % 1 === 0 ? 0.84 : 0.72));
        walkFrom[bar] = 3.5;
        state.bass = R2;
      };
      /** The bass sings the hook's first two bars over this bar and the next. */
      const bassCell = (bar, callOnly = false) => {
        const B = bar * BPB, c = ch(B);
        const R = near(c.root, state.bass, 33, 41);
        BASS_CELL.filter(([b]) => !callOnly || b < 4).forEach(([b, d, deg]) => push("bass", B + b, d * 0.92, R + deg, 0.78 + (d >= 1 ? 0.08 : 0) + (b % 4 === 0 ? 0.06 : 0)));
        state.bass = R;
      };
      /** The hinge: the bass plays the melody's chromatic fall in unison, an octave below the octave below. */
      const hingeBar = (bar) => {
        const B = bar * BPB;
        const top = near(mod12(T.midi("F4") + key), state.bass, 36, 46);
        [[0, 0.75, 0], [0.75, 0.75, -1], [1.5, 0.5, -2], [2, 0.5, -3], [2.5, 0.5, -4], [3, 1, -5]].forEach(([b, d, k]) => push("bass", B + b, d * 0.9, top + k, 0.86 - 0.01 * k));
        state.bass = top - 5;
      };

      // ================= drums =================
      const KICKS = [[[0, 1.5, 2.5], 3], [[0, 2.5], 2.5], [[0, 2.5, 3.5], 2], [[0, 1.5, 3.5], 1.5], [[0, 2.5, 3.75], 1], [[0, 0.75, 2.5], 1]];
      const crash = (abs, v = 0.7) => drum(abs, "crash", v);
      const hats = (bar, mode, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        if (mode === "ride") { for (let b = 0; b < until - 1e-6; b += 0.5) drum(B + b, "ride", b % 1 === 0 ? 0.52 : 0.38); return; }
        const step = mode === "16" ? 0.25 : 0.5;
        for (let b = 0; b < until - 1e-6; b += step) {
          if (o.open && b === 3.5) { drum(B + b, "hatOpen", 0.4, { len: 0.2 }); continue; }
          const v = b % 1 === 0 ? 0.6 : b % 0.5 === 0 ? 0.4 : 0.26;
          drum(B + b, "hatClosed", v * (o.vel ?? 1));
        }
      };
      const groove = (bar, o = {}) => {
        const B = bar * BPB, until = o.until ?? 4;
        const kicks = o.kicks || r.weighted(KICKS);
        kicks.filter((k) => k < until).forEach((k, i) => drum(B + k, "kick", i === 0 ? 0.95 : k % 1 === 0.75 ? 0.6 : 0.82));
        [1, 3].filter((b) => b < until).forEach((b) => sn(B + b, 0.9, o.gate));
        if (o.ghosts) [1.75, 2.25, 3.75].forEach((b) => { if (b < until && r.chance(0.3)) sn(B + b, 0.16, 0.06); });
        hats(bar, o.hats || "8", { open: o.open, until, vel: o.hatVel });
        if (o.tamb) for (let b = 0.5; b < until; b += 1) drum(B + b, "tambourine", 0.38);
      };
      /** A fill from `from` to the end of the bar. */
      const fill = (bar, from, kind) => {
        const B = bar * BPB;
        if (kind === "snare") for (let b = from; b < 4 - 1e-6; b += 0.25) sn(B + b, 0.4 + 0.5 * ((b - from) / (4 - from)), 0.07);
        else if (kind === "toms" || kind === "simmons") {
          const P = kind === "toms" ? [64, 60, 57, 52, 48, 45, 45, 40] : [70, 66, 62, 58, 54, 50, 46, 46];
          const steps = Math.round((4 - from) * 4);
          for (let i = 0; i < steps; i++) {
            const b = from + i * 0.25, k = Math.floor((i * 8) / steps);
            if (i === 0) sn(B + b, 0.7); else drum(B + b, kind === "toms" ? "tom" : "simmons", 0.62 + 0.03 * i, { pitch: P[Math.min(7, k)] });
          }
          drum(B + from, "kick", 0.8);
        } else { // band hits: kick, snare and brass together on the last three eighths
          [2.5, 3, 3.5].filter((b) => b >= from).forEach((b) => { drum(B + b, "kick", 0.92); sn(B + b, 0.86); stab(B + b, 0.28, 0.72, { force: true }); });
        }
      };
      const pickFill = (opts) => { const k = r.pick(opts.filter((x) => x !== state.lastFill)); state.lastFill = k; return k; };

      // ================= sections =================
      let label = "";
      if (intro) {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          arpBar(bar, 0.5, { high: bar >= 4 });
          if (bar < 2) { for (let b = 0; b < 4; b += 0.5) drum(B + b, "hatClosed", b % 1 === 0 ? 0.42 : 0.28); drum(B, "kick", 0.7); drum(B + 2, "kick", 0.6); }
          else if (bar < 4) { riffBar(bar, { b7: true }); drum(B, "kick", 0.85); drum(B + 2.5, "kick", 0.75); hats(bar, "8"); if (bar === 3) sn(B + 3, 0.6), sn(B + 3.5, 0.75); }
          else {
            if (bar === 4) crash(B, 0.6);
            groove(bar, { until: bar === 7 ? 2 : 4, kicks: [0, 2.5] });
            riffBar(bar);
            shadow(bar, 0.42);
            if (bar === 7) fill(bar, 2, "toms");
          }
        }
        label = "Intro · the pulse, the riff, a shadow of the hook";
      } else if (isA) {
        const v = Number(S[1]); // 1..4
        const ret = v >= 3; // the returns after B and after the breakdown
        playTune(HOOK[v === 2 ? "toB" : "down"], { vel: 0.8 + 0.02 * (v - 1) });
        // the brass: colours the leaning notes (A2), the whole tune an octave down (A3), sixths below (A4)
        if (v === 2) HOOK.toB.filter((n) => n.dur >= 1.5 && n.beat % BPB !== 0).forEach((n) => push("brass", n.beat, n.dur * 0.9, [T.step(n.note, -2, ch(n.beat).scale)], 0.5));
        if (v === 3) HOOK.down.forEach((n) => push("brass", n.beat, Math.max(0.2, n.dur * 0.9), [n.note - 12], 0.55));
        if (v === 4) HOOK.down.forEach((n) => push("brass", n.beat, Math.max(0.2, n.dur * 0.9), [Math.floor(n.beat / BPB) === 5 ? n.note + key - 12 : T.step(n.note + key, -5, ch(n.beat).scale)], 0.5));
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          const last = bar === 7;
          const fillKind = last ? pickFill(v === 2 ? ["snare", "toms", "hits"] : v === 4 ? ["simmons", "hits", "snare"] : ["snare", "toms", "simmons"]) : null;
          const from = fillKind === "hits" ? 2.5 : fillKind ? r.pick([2, 3]) : 4;
          if (bar === 0) crash(B, v === 1 ? 0.55 : 0.72);
          if (v === 4 && bar === 4) crash(B, 0.55);
          groove(bar, { hats: ret ? "16" : "8", open: !ret && bar % 2 === 1, ghosts: v >= 2, tamb: v === 4, until: from, hatVel: ret ? 0.85 : 1, gate: ret ? 0.2 : 0.16 });
          if (fillKind) fill(bar, from, fillKind);
          if (bar === 5 && ret) hingeBar(bar); else riffBar(bar, { ghosts: ret, longWalk: bar === 7 ? true : undefined });
          if (v === 1 ? bar >= (lap ? 2 : 4) : v === 3 ? bar === 7 : true) stabBar(bar, v === 4 ? 0.5 : 0.52, from);
        }
        label = ["", "Lap " + (lap + 1) + " · the hook", "The hook again · brass on the leaning notes, turning minor", "Return · the hook in octaves, the bass joins the hinge", "Lift · the hook a minor third up, in sixths"][v];
      } else if (S === "B") {
        playTune(BTUNE, { vel: 0.78 });
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          const last = bar === 7;
          if (bar === 0) crash(B, 0.65);
          groove(bar, { hats: bar < 6 && lap % 2 === 0 ? "ride" : "8", open: lap % 2 === 1 && bar % 2 === 1, kicks: r.weighted([[[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 1.5, 3.5], 1]]), ghosts: true, until: last ? 2 : 4 });
          if (last) fill(bar, 2, pickFill(["toms", "snare"]));
          bBar(bar);
          // pads: the brass holds each chord under the long line, answering the tune's rests with a stab
          prog.filter((e) => e.bar === bar).forEach((e) => push("brass", B + e.beat, Math.min(e.dur - 0.15, 3.3 - e.beat), triad(B + e.beat, 53, 71), 0.36));
          if (bar % 2 === 1) stab(B + 3, 0.25, 0.5);
        }
        label = "B theme · G minor, the cell upside down";
      } else if (S === "BRK") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          // kick and hats only; the bass carries the hook in Db, then E; the snare returns with a build
          if (bar < 7) {
            (bar < 4 ? [0, 2.5] : bar < 6 ? [0, 2.5, 3.5] : [0, 1.5, 2.5, 3.5]).forEach((k) => drum(B + k, "kick", k === 0 ? 0.88 : 0.7));
            hats(bar, bar < 4 ? "8" : "16", { vel: bar < 4 ? 0.8 : 0.9 });
            if (bar === 6) { sn(B + 1, 0.6); sn(B + 3, 0.75); }
          }
          if (bar < 4 ? bar % 2 === 0 : bar < 6) bassCell(bar, bar >= 4);
          if (bar >= 6) riffBar(bar, { longWalk: true });
          if (bar === 7) { groove(bar, { kicks: [0, 1, 2, 3], until: 2, hats: "16" }); fill(bar, 2, "snare"); }
          arpBar(bar, bar < 4 ? 0.36 : 0.44, { high: bar >= 4 });
          if (bar >= 4) { // the lead creeps in on the thirds of the mediants: F, G#, Bb, A
            const c = ch(B);
            const third = T.nearest(77, [mod12(c.root + 4)], 72, 83);
            push("lead", B, bar === 7 ? 3.5 : 3.8, third, 0.62 + 0.04 * (bar - 4));
            leadAttacks.push(B);
          }
          if (bar >= 6) stab(B + 1.5, 0.3, 0.5, { force: true });
        }
        label = "Breakdown · the bass sings the hook in D♭ and E";
      } else { // TAG
        playTune(TAG, { vel: 0.82, shift: 3 });
        const breath = lap % 2 === 0 ? "pulse" : "break";
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar < 4) {
            if (bar === 0) crash(B, 0.7);
            groove(bar, { hats: "16", ghosts: true, hatVel: 0.85, until: bar === 3 ? 3 : 4, gate: 0.2 });
            if (bar === 3) fill(bar, 3, "snare");
            riffBar(bar, { ghosts: true });
            if (bar === 3) stab(B + 1.5, 0.3, 0.6, { force: true }); else stabBar(bar, 0.56);
          } else if (breath === "pulse") {
            arpBar(bar, 0.48, { high: bar >= 6 });
            for (let b = 0; b < 4; b += 0.5) drum(B + b, "hatClosed", b % 1 === 0 ? 0.42 : 0.28);
            drum(B, "kick", 0.75); drum(B + 2.5, "kick", 0.6);
            if (bar >= 6) riffBar(bar, { b7: true });
            if (bar === 7) { sn(B + 3, 0.6); sn(B + 3.5, 0.78); }
          } else {
            groove(bar, { hats: "8", ghosts: true, until: bar === 7 ? 2 : 4, kicks: r.weighted([[[0, 1.5, 2.5], 2], [[0, 2.5, 3.5], 2], [[0, 0.75, 2.5, 3.5], 1]]) });
            riffBar(bar, { ghosts: true, b7: true });
            if (bar === 7) fill(bar, 2, pickFill(["toms", "simmons"]));
            if (bar === 5 && r.chance(0.6)) stab(B + 3.5, 0.25, 0.55, { force: true });
          }
        }
        label = `Tag · D♭ turns home${breath === "pulse" ? ", the pulse breathes" : ", drums and bass"}`;
      }

      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
