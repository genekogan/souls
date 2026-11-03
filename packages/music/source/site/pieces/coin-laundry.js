// Coin Laundry: a laundromat at two in the morning. 92 BPM, F major with its shadows. Fluorescent light,
// warm machines, one person waiting and humming. Everything grows out of the machines' rhythm.
//
// ---- the ideas, fixed before any code (these never change; the generator only arranges) ----
//
// THE PATTERN. Three machines, three periods, one bar of 4/4 that none of them agrees with.
//   The dryer turns once every 3 beats. A wet towel lands at the top of each turn, a zipper taps the drum
//   on the way round, and the towel lifts just before it drops again:
//        beat   0      .75    1.5   1.75   2.5
//               THUMP  tick   tick  tick   thud(lift)       ... period 3
//   The washer agitates in 2: a stroke to the left on the beat, a stroke to the right on the next, with
//   the slosh of the return on the offbeats:
//        beat   0      .5     1     1.5
//               SWISH  slosh  swish slosh                   ... period 2 (left / right alternate)
//   The harmony changes every 4 beats (the bar). So 3 against 4 against 2: the thump drifts through the
//   bar (beat 1, beat 4, beat 3, beat 2) and lands back on the downbeat every 12 beats, every 3 bars.
//   That realignment is the groove's breath. Twice per 6-bar cycle.
//
// THE HOOK (24 beats = 6 bars, F). It is hummed. Every onset falls on a dryer accent (0, 1.5, 1.75, 2.5
// of each 3-beat turn), so the tune is in 3 while the chords are in 4: each cell lands on a different part
// of the bar, and the same motif sits on different chord tones each time. The cell: a long note, a quick
// lower turn, and a leap. Cells 4 and 8 break it and hold.
//   turn 1  A4~~  G4 A4  C5          (3rd of F; the turn; the leap to the 5th)
//   turn 2  D5~~  C5 A4  G4          (the answer falls; F becomes Dm under it)
//   turn 3  F4~~  E4 F4  A4          (lower; A over Bb is its maj7: the colour)
//   turn 4  C5 ~~~~~~~   A4          (lands on the 9th of Bb and holds; a 4th up into...)
//   turn 5  D5~~  C5 D5  F5          (the cell a 4th up, over Gm: the sequence)
//   turn 6  G5~~  F5 D5  C5          (the top; Eb arrives under it, D is its maj7)
//   turn 7  Bb4~~ Ab4 Bb4 G4         (the shadow: Ab, the only note outside F major)
//   turn 8  G4 ~~~~~~~   E4          (holds on the 5th of Csus; E leads a 4th up to A4 again)
// Harmony: | Fmaj9 | Dm9 | Bbmaj9 | Gm9 | Ebmaj9 | C9sus4 |   (ii, bVII, Vsus: the Eb is the shadow)
//
// THE BASS plays only on the thumps, one note per turn (8 notes a cycle), each chosen to be a tone of the
// chord it starts under AND the chord that arrives while it is still ringing: a chain of pivots.
//   F2 A2 | D2 Bb1 | G2 Bb2 | Eb2 C2    (A: 3rd of F, 5th of Dm. D: root of Dm, 3rd of Bb. Bb: 3rd of Gm,
//   5th of Eb. Eb: root, then the dark 3rd under Csus for one beat. C: V, home.)
//   On the towel's lift (2.5) it may play an approach note into the next thump, the same moment the hum leaps.
//
// THE B TUNE (the spin cycle, F minor mixture): the cell with its turn inverted (upper neighbour, falling leap).
//   C5~~ Db5 C5 Ab4 | G4~~ F4 G4 Eb4 | F4~~ Eb4 F4 Ab4 | Bb4~~~~~~ Db5 | F5~~ Gb5 F5 Db5 | C5~~ Bb4 C5 Ab4 |
//   Bb4~~ Ab4 Bb4 Ab4 | G4~~~~~~ E4
// Harmony: | Fm9 | Abmaj9 | Dbmaj7#11 | Bbm9 | Gbmaj7#11 | C7b9 |   bass F2 Ab2 Eb2 Db2 | Bb1 Db2 Gb2 C2
//
// ---- form: one lap = 5 cycles of 6 bars (about 1:18), after a one-time intro ----
//   INTRO  a coin drops, the dryer starts, the washer joins, the ticks, one chord, the hum tries its turn
//   A1     the hook, hummed alone over the machines, bass on the thumps, the keys on downbeats
//   A2     the hook again; a second voice hums under it in sixths; the keys answer on the and-of-two
//   B      the spin cycle: a whir rises through the whole section, the lid bangs, F minor, the B tune
//   A3     the hook, both voices, the keys syncopated, the coin tray rattles: as full as a laundromat gets
//   TAG    the buzzer; the dryer stops; washer, keys and a fragment of the hum; a coin, and the dryer again
// Per cycle the generator chooses only: thump weights, tick ghosts, bass approach notes, keys restrikes,
// rattle, grace notes, which voice carries the B tune. The tunes above are never regenerated.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4, BPM = 92, CB = 6; // 6 bars = 24 beats = two dryer cycles
  const dB = (x) => Math.pow(10, x / 20);

  // ---------- notation: "A4/1.5 G4/.25 ..." in 3-beat turns; r = rest ----------
  function tune(text) {
    const out = [];
    text.split("|").map((s) => s.trim()).filter(Boolean).forEach((cell, ci) => {
      let pos = 0;
      cell.split(/\s+/).forEach((tok) => {
        const m = /^(r|[A-G][#b]?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`coin-laundry: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: ci * 3 + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - 3) > 1e-6) throw new Error(`coin-laundry: turn ${ci + 1} has ${pos} beats: ${cell}`);
    });
    return out;
  }
  const HOOK = tune("A4/1.5 G4/.25 A4/.75 C5/.5 | D5/1.5 C5/.25 A4/.75 G4/.5 | F4/1.5 E4/.25 F4/.75 A4/.5 | C5/2.5 A4/.5 | " +
    "D5/1.5 C5/.25 D5/.75 F5/.5 | G5/1.5 F5/.25 D5/.75 C5/.5 | Bb4/1.5 Ab4/.25 Bb4/.75 G4/.5 | G4/2.5 E4/.5");
  const BTUNE = tune("C5/1.5 Db5/.25 C5/.75 Ab4/.5 | G4/1.5 F4/.25 G4/.75 Eb4/.5 | F4/1.5 Eb4/.25 F4/.75 Ab4/.5 | Bb4/2.5 Db5/.5 | " +
    "F5/1.5 Gb5/.25 F5/.75 Db5/.5 | C5/1.5 Bb4/.25 C5/.75 Ab4/.5 | Bb4/1.5 Ab4/.25 Bb4/.75 Ab4/.5 | G4/2.5 E4/.5");
  // the intro's try: just the turn, twice, as if finding the note
  const TRY = tune("r/1.5 G4/.25 A4/.75 r/.5 | r/1.5 G4/.25 A4/.75 C5/.5");
  // the tag's fragment: the first turn, alone, an octave down, landing nowhere
  const FRAG = tune("A3/1.5 G3/.25 A3/.75 C4/.5 | D4/2.5 r/.5");

  // bass: one note per thump (midi), and the approach note that may precede it on the lift
  const BASS = {
    A: [[41, 40], [45, 43], [38, 40], [34, 36], [43, 41], [46, 45], [39, 41], [36, 38]],
    B: [[41, 40], [44, 43], [39, 41], [37, 39], [34, 36], [37, 36], [42, 41], [36, 38]],
  };
  // keys: hand-voiced upper structures, one per bar, voice-led across the whole lap
  const KEYS = {
    INTRO: { prog: "| Fmaj9 | Fmaj9 | Fmaj9 | Fmaj9 | Fmaj9 | Fmaj9 |", v: [[57, 64, 67], [57, 64, 67], [57, 64, 67], [57, 64, 67], [57, 64, 67], [57, 64, 67]] },
    A: { prog: "| Fmaj9 | Dm9 | Bbmaj9 | Gm9 | Ebmaj9 | C9sus4:3 C9:1 |", v: [[57, 64, 67], [57, 60, 65], [57, 60, 62], [58, 62, 65], [55, 58, 62], [58, 62, 65]], res: [62, 64] },
    B: { prog: "| Fm9 | Abmaj9 | Dbmaj7#11 | Bbm9 | Gbmaj7#11 | C7b9 |", v: [[56, 63, 67], [58, 60, 67], [60, 65, 67], [60, 65, 68], [60, 65, 70], [58, 61, 64]] },
    TAG: { prog: "| Fmaj9 | Dm9 | Bbmaj9 | Gm9 | Bbm6 | C9sus4:3 C9:1 |", v: [[57, 64, 67], [57, 60, 65], [57, 60, 62], [58, 62, 65], [58, 61, 65], [58, 62, 65]], res: [62, 64] },
  };
  for (const k of Object.keys(KEYS)) KEYS[k].timeline = T.progression(KEYS[k].prog, BPB);
  const LAP = ["A1", "A2", "B", "A3", "TAG"];

  Sim.register({
    id: "coin-laundry",
    title: "Coin Laundry, 2 a.m.",
    genre: "Machine-room lullaby",
    about: "A laundromat at two in the morning, in F major with its shadows. The dryer thumps once every 3 beats, the washer agitates in 2, the chords change in 4, and the three line up every 12 beats. A hummed hook whose every note falls on a dryer accent, a bass that plays only on the thumps through a chain of pivot tones, a spin-cycle whir that lifts a section into F minor, a buzzer, a coin, and the dryer again.",
    bpm: BPM, beatsPerBar: BPB, swing: 0.5, cycleBars: CB, gainDb: 0,
    situations: ["work", "hangout", "presentation"],
    energy: 0.35,

    instruments(ctx) {
      const { I, out } = ctx;
      // the room: a tiled box with a low ceiling (short, bright early reflections), and a long dull tail for the hum
      const bus = ctx.keep(new Tone.Gain(1)).connect(out);
      const tile = I.reverb(ctx, bus, { decay: 0.7, preDelay: 0.006, lowcut: 500, highcut: 7000 });
      const hall = I.reverb(ctx, bus, { decay: 2.6, preDelay: 0.03, lowcut: 250, highcut: 3200 });
      const mono = I.monotonic;

      // ---- the dryer: a slack low drum with a long pitch fall, plus the towel's dull weight (lowpassed noise) ----
      const dryOut = ctx.keep(new Tone.Gain(dB(-8)));
      const dryBody = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.09, octaves: 2.2, oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.42, sustain: 0, release: 0.12 } })).connect(dryOut);
      const towelLp = ctx.keep(new Tone.Filter({ frequency: 240, type: "lowpass", rolloff: -24 })).connect(dryOut);
      const towel = ctx.keep(new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.05 } })).connect(towelLp);
      towel.volume.value = 6;
      const drySafe = mono(dryOut);
      const thump = (time, vel, lift) => {
        const t = drySafe(time);
        dryBody.triggerAttackRelease(T.hz(lift ? 41 : 36), lift ? 0.12 : 0.3, t, vel * (lift ? 0.6 : 1));
        towel.triggerAttackRelease(lift ? 0.05 : 0.11, t, vel * (lift ? 0.5 : 0.9));
      };

      // ---- the zipper: a tiny metal tap against the drum, two of them panned a little apart ----
      const tickOut = ctx.keep(new Tone.Gain(dB(4)));
      const tickBp = ctx.keep(new Tone.Filter({ frequency: 3400, type: "bandpass", Q: 2.5 })).connect(tickOut);
      const tickSyn = ctx.keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.045, release: 0.02 }, harmonicity: 3.1, modulationIndex: 24, resonance: 3600, octaves: 0.8 })).connect(tickBp);
      const tickSafe = mono(tickOut);
      const tick = (time, vel, hi) => tickSyn.triggerAttackRelease(hi ? 620 : 470, 0.03, tickSafe(time), vel);

      // ---- the washer: pink-noise strokes through a resonant mid filter, left stroke and right stroke ----
      const mkStroke = (pan, freq) => {
        const g = ctx.keep(new Tone.Gain(dB(-14)));
        const p = ctx.keep(new Tone.Panner(pan)).connect(bus);
        const lvl = ctx.keep(new Tone.Gain(dB(12))).connect(p);
        const bp = ctx.keep(new Tone.Filter({ frequency: freq, type: "bandpass", Q: 1.4 })).connect(lvl);
        const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.035, decay: 0.19, sustain: 0.05, release: 0.08 } })).connect(bp);
        lvl.connect(g); g.connect(tile);
        return { n, safe: mono(p) };
      };
      const swL = mkStroke(-0.45, 1150), swR = mkStroke(0.45, 1350);
      const swish = (time, vel, side, slosh) => {
        const s = side === "L" ? swL : swR;
        s.n.triggerAttackRelease(slosh ? 0.08 : 0.16, s.safe(time), vel * (slosh ? 0.55 : 1));
      };

      // ---- the coin tray rattle: a short dry shaker of small metal ----
      const ratOut = ctx.keep(new Tone.Gain(dB(2)));
      const ratBp = ctx.keep(new Tone.Filter({ frequency: 5200, type: "bandpass", Q: 1.1 })).connect(ratOut);
      const ratSyn = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.006, decay: 0.04, sustain: 0, release: 0.02 } })).connect(ratBp);
      const ratSafe = mono(ratOut);

      // ---- the coin: a bright ping that bounces twice; the lid: a bigger, longer clang ----
      const coinOut = ctx.keep(new Tone.Gain(dB(-1)));
      const coinSyn = ctx.keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.3, release: 0.1 }, harmonicity: 5.7, modulationIndex: 30, resonance: 5200, octaves: 1.2 })).connect(coinOut);
      const coinSafe = mono(coinOut);
      const coin = (time, vel) => { [0, 0.11, 0.19, 0.245].forEach((d, i) => coinSyn.triggerAttackRelease(1900 + 70 * i, 0.08, coinSafe(time + d), vel * [1, 0.7, 0.5, 0.35][i])); };
      const lidOut = ctx.keep(new Tone.Gain(dB(-14)));
      const lidSyn = ctx.keep(new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.4, release: 0.6 }, harmonicity: 2.6, modulationIndex: 40, resonance: 1400, octaves: 1.6 })).connect(lidOut);
      const lidSafe = mono(lidOut);

      // ---- the spin cycle: a noise whir whose resonance climbs through a section, and falls when it stops ----
      const whirOut = ctx.keep(new Tone.Gain(0));
      const whirBp = ctx.keep(new Tone.Filter({ frequency: 300, type: "bandpass", Q: 3.5 })).connect(whirOut);
      const whirNoise = ctx.keep(new Tone.Noise({ type: "brown" })).connect(whirBp);
      whirNoise.volume.value = 8;
      whirNoise.start();
      const whirSafe = mono(whirOut);
      const whir = (time, durSec, vel, mode) => {
        const t = whirSafe(time);
        const g = whirOut.gain, f = whirBp.frequency;
        g.cancelAndHoldAtTime(t); f.cancelAndHoldAtTime(t);
        const lvl = dB(-7) * vel;
        if (mode === "down") { // the spin ends: the pitch sinks and the level fades over the whole event
          g.setValueAtTime(lvl, t); f.setValueAtTime(1500, t);
          f.exponentialRampToValueAtTime(220, t + durSec);
          g.linearRampToValueAtTime(0, t + durSec);
        } else if (mode === "hold") { // full speed: a steady whir that settles a little
          g.setValueAtTime(lvl, t); f.setValueAtTime(1800, t);
          f.linearRampToValueAtTime(1500, t + durSec);
        } else { // the spin starts: level in over a bar, pitch climbing all the way to the end
          g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(lvl, t + Math.min(2.6, durSec * 0.25));
          f.setValueAtTime(260, t); f.exponentialRampToValueAtTime(1800, t + durSec);
        }
      };

      // ---- the buzzer: the dryer's end-of-cycle rasp, a nasal square through a narrow band ----
      const buzzOut = ctx.keep(new Tone.Gain(dB(0)));
      const buzzTrem = ctx.keep(new Tone.Tremolo({ frequency: 31, depth: 0.7 })).start();
      const buzzBp = ctx.keep(new Tone.Filter({ frequency: 1300, type: "bandpass", Q: 2 }));
      const buzzSyn = ctx.keep(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.03 } }));
      buzzSyn.chain(buzzBp, buzzTrem, buzzOut);
      const buzzSafe = mono(buzzOut);

      // ---- the hum: a near-sine with a chest formant, a little breath, a slow late-ish vibrato; two of them ----
      const mkHum = (pan, formant, vibHz, vol) => {
        const o = ctx.keep(new Tone.Gain(dB(vol)));
        const syn = ctx.keep(new Tone.MonoSynth({
          portamento: 0.035,
          oscillator: { type: "custom", partials: [1, 0.32, 0.12, 0.05, 0.02] },
          filter: { type: "lowpass", rolloff: -12, Q: 0.9 },
          envelope: { attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.18 },
          filterEnvelope: { attack: 0.09, decay: 0.3, sustain: 0.6, release: 0.2, baseFrequency: 420, octaves: 1.6 },
        }));
        const form = ctx.keep(new Tone.Filter({ frequency: formant, type: "peaking", Q: 1.8, gain: 7 }));
        const vib = ctx.keep(new Tone.Vibrato({ frequency: vibHz, depth: 0.018 }));
        syn.chain(form, vib, o);
        const breathBp = ctx.keep(new Tone.Filter({ frequency: 1600, type: "bandpass", Q: 0.8 })).connect(o);
        const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.02, decay: 0.12, sustain: 0.04, release: 0.1 } })).connect(breathBp);
        breath.volume.value = -26;
        const p = ctx.keep(new Tone.Panner(pan)).connect(bus);
        o.connect(p);
        I.send(ctx, p, hall, -11); I.send(ctx, p, tile, -20);
        const safe = mono(o);
        return (time, note, dur, vel) => { const t = safe(time); syn.triggerAttackRelease(T.hz(note), dur, t, vel); breath.triggerAttackRelease(Math.min(0.3, dur), t, vel * 0.6); };
      };
      const hum = mkHum(-0.08, 640, 5.1, -17);
      const hum2 = mkHum(0.22, 520, 4.6, -16.5);

      // ---- the keys: a cheap FM electric piano with the fluorescent flicker (a fast, shallow tremolo) ----
      const keysOut = ctx.keep(new Tone.Gain(dB(-1)));
      const keysSyn = ctx.keep(new Tone.PolySynth({
        voice: Tone.FMSynth, maxPolyphony: 12,
        options: {
          harmonicity: 1, modulationIndex: 2.2, oscillator: { type: "sine" }, modulation: { type: "triangle" },
          envelope: { attack: 0.004, decay: 1.4, sustain: 0.25, release: 0.6 },
          modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.3 },
        },
      }));
      const keysLp = ctx.keep(new Tone.Filter({ frequency: 2600, type: "lowpass", rolloff: -12 }));
      const flicker = ctx.keep(new Tone.Tremolo({ frequency: 7.3, depth: 0.14, spread: 60 })).start();
      keysSyn.chain(keysLp, flicker, keysOut);
      const kp = ctx.keep(new Tone.Panner(0.12)).connect(bus);
      keysOut.connect(kp);
      I.send(ctx, kp, tile, -16); I.send(ctx, kp, hall, -18);

      // ---- the bass: a round sine-triangle with a soft click, kept under the dryer ----
      const bassOut = ctx.keep(new Tone.Gain(dB(-15)));
      const bassSyn = ctx.keep(new Tone.MonoSynth({
        portamento: 0,
        oscillator: { type: "triangle" },
        filter: { type: "lowpass", rolloff: -24, Q: 1 },
        envelope: { attack: 0.008, decay: 0.3, sustain: 0.7, release: 0.15 },
        filterEnvelope: { attack: 0.004, decay: 0.12, sustain: 0.25, release: 0.1, baseFrequency: 90, octaves: 2.6 },
      }));
      bassSyn.connect(bassOut);
      bassOut.connect(bus);
      const bassSafe = mono(bassOut);

      // routing of the percussion outs
      dryOut.connect(bus); I.send(ctx, dryOut, tile, -22);
      tickOut.connect(ctx.keep(new Tone.Panner(-0.2)).connect(bus)); I.send(ctx, tickOut, tile, -14);
      ratOut.connect(ctx.keep(new Tone.Panner(0.5)).connect(bus));
      coinOut.connect(ctx.keep(new Tone.Panner(0.35)).connect(bus)); I.send(ctx, coinOut, tile, -8); I.send(ctx, coinOut, hall, -16);
      lidOut.connect(ctx.keep(new Tone.Panner(-0.3)).connect(bus)); I.send(ctx, lidOut, tile, -6); I.send(ctx, lidOut, hall, -12);
      whirOut.connect(ctx.keep(new Tone.Panner(0.3)).connect(bus));
      buzzOut.connect(ctx.keep(new Tone.Panner(-0.15)).connect(bus)); I.send(ctx, buzzOut, tile, -10);

      const arr = (n) => (Array.isArray(n) ? n : [n]);
      return {
        hum: { layer: "melody", play: (t, e, d) => hum(t, e.note, d, e.vel), humanize: { timing: 0.014, vel: 0.06 } },
        hum2: { layer: "melody", play: (t, e, d) => hum2(t, e.note, d, e.vel), humanize: { timing: 0.018, vel: 0.07 } },
        keys: { layer: "harmony", play: (t, e, d) => keysSyn.triggerAttackRelease(arr(e.note).map(T.hz), d, t, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        bass: { layer: "bass", play: (t, e, d) => bassSyn.triggerAttackRelease(T.hz(e.note), d, bassSafe(t), e.vel), humanize: { timing: 0.003, vel: 0.04 } },
        dryer: { layer: "drums", play: (t, e) => thump(t, e.vel, e.note === "lift"), humanize: { timing: 0.004, vel: 0.05 } },
        tick: { layer: "drums", play: (t, e) => tick(t, e.vel, e.note === "hi"), humanize: { timing: 0.003, vel: 0.08 } },
        washer: { layer: "drums", play: (t, e) => swish(t, e.vel, e.note, e.slosh), humanize: { timing: 0.004, vel: 0.05 } },
        rattle: { layer: "drums", play: (t, e) => ratSyn.triggerAttackRelease(0.03, ratSafe(t), e.vel), humanize: { timing: 0.004, vel: 0.1 } },
        coin: { layer: "drums", play: (t, e) => coin(t, e.vel), humanize: { timing: 0.002, vel: 0.03 } },
        lid: { layer: "drums", play: (t, e) => lidSyn.triggerAttackRelease(190, 0.5, lidSafe(t), e.vel), humanize: { timing: 0.002, vel: 0.03 } },
        whir: { layer: "texture", play: (t, e, d) => whir(t, d, e.vel, e.note), humanize: { timing: 0, vel: 0 } },
        buzzer: { layer: "texture", play: (t, e, d) => buzzSyn.triggerAttackRelease(T.hz(60), d, buzzSafe(t), e.vel), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const intro = cycle === 0;
      const idx = intro ? -1 : (cycle - 1) % LAP.length, lap = intro ? 0 : Math.floor((cycle - 1) / LAP.length);
      const S = intro ? "INTRO" : LAP[idx];
      const isA = S[0] === "A";
      const K = KEYS[intro ? "INTRO" : isA ? "A" : S];
      const prog = K.timeline;
      const chordAt = T.chordAtFactory(prog, BPB);
      const ch = (b) => T.chord(chordAt(b).chord);
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      if (state.laps == null) Object.assign(state, { laps: 0, lastB: null });
      const TURNS = 8; // 3-beat dryer turns per cycle

      // ================= the machines =================
      /** The dryer: thump, ticks, lift, for turns [from, to). */
      const dryer = (from, to, o = {}) => {
        for (let k = from; k < to; k++) {
          const B = k * 3;
          // the towel never lands twice the same: heaviest where it meets the bar line (turns 0 and 4)
          const w = k % 4 === 0 ? 0.95 : 0.8 + 0.07 * r();
          push("dryer", B, 0.5, "thump", w * (o.vel ?? 1));
          if (o.ticks !== false) {
            if (r.chance(o.ghost ?? 0.6)) push("tick", B + 0.75, 0.1, "lo", 0.3);
            push("tick", B + 1.5, 0.1, "hi", 0.58);
            push("tick", B + 1.75, 0.1, "lo", 0.44);
            if (o.dense && r.chance(0.5)) push("tick", B + 2.25, 0.1, "lo", 0.26);
          }
          if (o.lift !== false) push("dryer", B + 2.5, 0.25, "lift", 0.45);
        }
      };
      /** The washer: strokes in 2 for beats [from, to). */
      const washer = (from, to, o = {}) => {
        for (let b = from; b < to - 1e-6; b += 0.5) {
          const q = ((b % 2) + 2) % 2; // position in the 2-beat agitation
          const side = q < 1 ? "L" : "R";
          const slosh = q % 1 !== 0;
          const vel = (q === 0 ? 0.74 : q === 1 ? 0.62 : 0.4) * (o.vel ?? 1);
          if (slosh && !(o.slosh ?? true)) continue;
          push("washer", b, 0.25, side, vel, slosh ? { slosh: true } : {});
        }
      };
      /** Coin-tray rattle: 16ths with a 3-beat accent, for beats [from, to). */
      const rattle = (from, to) => {
        for (let b = from; b < to - 1e-6; b += 0.25) {
          const inTurn = ((b % 3) + 3) % 3;
          const v = inTurn === 0 ? 0.6 : inTurn % 1 === 0 ? 0.42 : inTurn % 0.5 === 0 ? 0.34 : 0.24;
          if (inTurn % 1 === 0.25 && r.chance(0.35)) continue;
          push("rattle", b, 0.12, "r", v);
        }
      };

      // ================= bass =================
      /** One note per thump, for turns [from, to); approach notes on the lift with probability p. */
      const bassLine = (line, from, to, p = 0.5, o = {}) => {
        for (let k = from; k < to; k++) {
          const B = k * 3;
          const [note] = line[k];
          const approach = r.chance(p) && k < TURNS;
          const ghost = o.ghost && k % 2 === 1 && r.chance(0.7); // a short re-touch of the note on the zipper's tick
          push("bass", B, ghost ? 1.4 : approach ? 2.3 : 2.75, note, 0.82 + (k % 4 === 0 ? 0.08 : 0));
          if (ghost) push("bass", B + 1.5, approach ? 0.9 : 1.2, note, 0.5);
          if (approach) push("bass", B + 2.5, 0.42, line[(k + 1) % TURNS][1], 0.6);
        }
      };

      // ================= keys =================
      const keysBar = (bar, pattern, vel = 0.5) => {
        const v = K.v[bar], B = bar * BPB;
        const hits = { down: [[0, 3.6]], answer: [[0, 2.2], [2.5, 1.3]], sync: [[0, 1.3], [1.5, 0.8], [2.5, 1.2]], hold: [[0, 3.9]], late: [[0, 1.4], [3.5, 0.45]] }[pattern];
        const last = K.res && bar === CB - 1; // the sus resolves in the last beat: the keys lift, then (if they are active) say "major"
        hits.forEach(([b, d], i) => { if (b >= 3) return; push("keys", B + b, last ? Math.min(d, 3 - b) : d, i === 0 ? v : v.slice(1), vel * (i === 0 ? 1 : 0.74)); });
        if (last && pattern !== "hold" && pattern !== "down") push("keys", B + 3.5, 0.45, K.res, vel * 0.7);
      };

      // ================= the tunes =================
      const sing = (track, notes, o = {}) => {
        notes.forEach((n) => {
          const inTurn = n.beat % 3;
          const long = n.dur >= 1.5;
          const vel = (o.vel ?? 0.78) + (long ? 0.04 : 0) + (inTurn === 1.5 ? -0.08 : 0) + (inTurn === 2.5 ? 0.02 : 0);
          const note = n.note + (o.shift || 0);
          // ornament: before a long note, a grace from a scale step below, now and then
          if (long && o.grace && r.chance(0.22)) push(track, n.beat - 0.18, 0.16, T.step(note, -1, ch(n.beat).scale), vel - 0.25);
          push(track, n.beat, long ? n.dur * 0.96 : n.dur * 0.9, note, vel);
        });
      };
      /** The second voice: a sixth (or third) below, always a chord tone where one is near, resting on the turns. */
      const under = (notes, o = {}) => {
        const prefs = o.third ? [4, 3, 5, 7] : [9, 8, 7, 5];
        notes.forEach((n) => {
          if (n.dur < 0.5 && !o.all) return;
          const c = ch(n.beat);
          const pick = (test) => prefs.map((d) => n.note - d).find((m) => test(T.mod12(m)));
          const m = pick((pc) => c.pcs.includes(pc)) ?? pick((pc) => c.scale.includes(pc));
          if (m == null) return;
          push("hum2", n.beat, n.dur * 0.94, m, (o.vel ?? 0.6) + (n.dur >= 1.5 ? 0.03 : 0));
        });
      };

      // ================= sections =================
      let label = "";
      if (intro) {
        push("coin", 0, 0.5, "c", 0.8);
        dryer(0, 4, { ticks: false, lift: false, vel: 0.9 });
        dryer(4, TURNS, { ghost: 0.3 });
        washer(4, 12, { slosh: false });
        washer(12, 24);
        push("keys", 12, 7.6, K.v[3], 0.42);
        bassLine(BASS.A.map(() => [41, 40]), 4, TURNS, 0);
        sing("hum", TRY.map((n) => ({ ...n, beat: n.beat + 18 })), { vel: 0.62 });
        label = "Intro · a coin, the dryer, the washer, one chord";
      } else if (isA) {
        const v = Number(S[1]);
        const even = lap % 2 === 0;
        dryer(0, TURNS, { ghost: v === 1 ? 0.35 : 0.65, dense: v === 3 });
        washer(0, 24, { vel: v === 3 ? 0.95 : 0.85 });
        if (v === 3) { push("lid", 0, 0.5, "l", 0.7); push("whir", 0, 24, "hold", 0.55); rattle(0, 24); }
        if (v === 2 && r.chance(0.7)) rattle(12 + (even ? 0 : 6), 24);
        bassLine(BASS.A, 0, TURNS, v === 1 ? 0.3 : v === 2 ? 0.5 : 0.7, { ghost: v === 3 });
        for (let bar = 0; bar < CB; bar++) {
          const pat = v === 1 ? (lap === 0 ? "hold" : "down") : v === 2 ? (bar % 2 === 1 || !even ? "answer" : "down") : bar === 5 ? "late" : "sync";
          keysBar(bar, pat, v === 1 ? 0.42 : v === 2 ? 0.48 : 0.52);
        }
        if (v === 1) {
          sing(even ? "hum" : "hum2", HOOK, { vel: even ? 0.78 : 0.7, grace: lap > 0 });
          // every third lap the keys shadow the long notes an octave below, like someone picking the tune out
          if (lap % 3 === 2) HOOK.filter((n) => n.dur >= 1.5).forEach((n) => push("keys", n.beat, n.dur * 0.9, [n.note - 12], 0.4));
        }
        else if (v === 2) { sing("hum", HOOK, { vel: 0.8, grace: true }); under(HOOK.filter((n) => n.beat >= 12 || !even), { vel: 0.5 }); }
        else { sing("hum", HOOK, { vel: 0.84, grace: true }); under(HOOK, { vel: 0.58, third: !even, all: !even }); }
        label = ["", `Lap ${lap + 1} · the hook, hummed over the machines`, "The hook again · a second voice in sixths, the keys answer", "The hook, full · both voices, the keys in syncopation, the coin tray"][v];
      } else if (S === "B") {
        push("lid", 0, 0.5, "l", 0.85);
        push("whir", 0, 23.5, "up", 0.9);
        dryer(0, TURNS, { ghost: 0.7, dense: true });
        washer(0, 24, { vel: 0.9 });
        bassLine(BASS.B, 0, TURNS, 0.6);
        for (let bar = 0; bar < CB; bar++) keysBar(bar, bar < 3 ? "answer" : "sync", 0.5);
        const who = r.chance(0.5) && state.lastB !== "hum2" ? "hum2" : "hum";
        state.lastB = who;
        sing(who, BTUNE, { vel: who === "hum" ? 0.8 : 0.74, grace: true });
        if (who === "hum") under(BTUNE.filter((n) => n.beat >= 12), { vel: 0.46 });
        label = "Spin cycle · the whir climbs, F minor, the turn inverted";
      } else { // TAG
        push("buzzer", 0, 1.1, "b", 0.8);
        push("whir", 0, 8, "down", 0.8);
        washer(0, 24, { vel: 0.95 });
        // the dryer is off: no thumps, no bass. the ticks keep a ghost of the turn on 1.5 only, fading
        for (let k = 1; k < 5; k++) push("tick", k * 3 + 1.5, 0.1, "hi", 0.5 - 0.08 * k);
        for (let bar = 0; bar < CB; bar++) keysBar(bar, bar === 2 ? "answer" : "hold", 0.46);
        sing(lap % 2 === 0 ? "hum" : "hum2", FRAG.map((n) => ({ ...n, beat: n.beat + 9 })), { vel: 0.6 });
        if (r.chance(0.6)) sing("hum", FRAG.map((n) => ({ ...n, beat: n.beat + 21, note: n.note + 12 })).filter((n) => n.beat < 24), { vel: 0.5 }); // an octave up, straight into the hook
        push("coin", 22.5, 0.5, "c", 0.8);
        push("dryer", 23.5, 0.25, "lift", 0.4);
        state.laps = lap + 1;
        label = "Tag · the buzzer, the dryer stops; washer and keys; a coin";
      }

      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
