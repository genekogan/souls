// Tribal Stage: a village dance around a fire at dusk, in E dorian over a drone.
//
// Meter: 4/4 with a 12/8 feel. Every beat holds three triplet "pulses" (12 per bar, written here as
// pulse numbers 0..11; beat = pulse / 3). The four beats are the dancers' steps; everything else is
// laid against them:
//   bell    the standard bell timeline x.x.xx.x.x.x (7 strokes over 12), low bell on 1, high after;
//   4-feel  shaker (beats accented, lilting triplets) and the low log drum (bass ostinato);
//   3-feel  the slit drum on pulses 0, 4, 8 (three notes against four steps) and the bongo on 2, 6, 10,
//           so slit + bongo together make the 6-feel (quarter notes of 12/8) that the bell implies;
//   conga   answers the bell, open tones in the bell's gaps.
// The dance builds by accumulation (bell, then shaker and log drum, then conga, then bongo), so the
// listener hears the four-against-three appear rather than being handed it.
//
// Harmony is a drone (E2 B2 E3) with modal colour over it: Em11 (pentatonic home), D/E (bVII over the
// pedal) and A/E, the dorian IV whose C# is the brightest note in the piece and is saved for the calls
// and the peak.
//
// Song: a breathy ocarina leads, a chorus answers. Calls vary; the chorus refrain is fixed and always
// cadences "G A E", the hook (foreshadowed by the ocarina's invocation and the humming). The chorus
// sings in organum: parallel fourths below the tune (fifths where a fourth would leave the chord),
// and at the peaks a third voice an octave below the tune.
//
// Form (round 1 = 13 cycles of 8 bars, about 3.9 min; later rounds skip the kindling, 11 cycles):
// kindling -> invocation -> the dance gathers x3 -> call & response x2 -> peak -> break (bell alone,
// then the lead drum's signal) -> the dance again (drum talk, new calls, the whole circle) -> embers.
(function () {
  "use strict";
  const T = Sim.theory;
  const PB = 12; // pulses per bar
  const db = (x) => Math.pow(10, x / 20);
  const clamp = (v) => Math.max(0.05, Math.min(1, v));
  const E_DOR = T.scale(4, "dorian"), E_PENT = T.scale(4, "minorPent");

  // ---------- notation: "note/pulses" per bar (12 pulses), r = rest, ~ = scoop from below ----------
  function parse(bars) {
    const out = [];
    bars.forEach((s, bi) => {
      let p = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const [n, ds] = tok.split("/"), d = Number(ds);
        if (!(d > 0)) throw new Error(`tribal-stage: bad token ${tok}`);
        if (n !== "r") { const grace = n.endsWith("~"); out.push({ p: bi * PB + p, d, note: T.midi(grace ? n.slice(0, -1) : n), grace }); }
        p += d;
      }
      if (p !== PB) throw new Error(`tribal-stage: bar sums to ${p}: ${s}`);
    });
    return out;
  }
  const phrase = (h, bars) => ({ h, n: parse(bars) });

  // Calls (ocarina, two bars each, ending with a breath so the chorus can come in).
  const CALLS = {
    K1: phrase(["Em11", "Em11"], ["E5/2 D5/1 B4/3 r/1 A4/1 B4/1 D5/3", "E5~/4 D5/2 B4/1 A4/2 r/3"]),
    K2: phrase(["Em11", "Em11"], ["B4/2 A4/1 G4/3 r/1 E4/1 G4/1 A4/3", "B4~/2 D5/1 B4/3 A4/3 r/3"]),
    K3: phrase(["Em11", "A/E"], ["E4/1 G4/1 A4/1 B4/3 D5/2 B4/1 A4/3", "C#5~/4 B4/2 A4/3 r/3"]), // the dorian IV
    K4: phrase(["Em11", "Em11"], ["E5/1 G5/2 A5~/3 G5/2 E5/1 D5/3", "E5/6 r/1 D5/1 B4/1 A4/3"]), //   the high cry
    K5: phrase(["D/E", "Em11"], ["F#5/2 E5/1 D5/3 A4/2 B4/1 D5/3", "E5~/4 D5/2 B4/3 r/3"]),
    K6: phrase(["A/E", "Em11"], ["A4/2 B4/1 C#5/3 E5/2 C#5/1 A4/3", "B4/2 A4/1 B4~/6 r/3"]),
    K7: phrase(["Em11", "Em11"], ["B3/3 D4/2 E4/1 G4~/4 E4/2", "D4/2 E4/1 B3/6 r/3"]), //           low and dark
    K8: phrase(["Em11", "D/E"], ["G4/2 A4/1 B4/3 D5/2 E5/1 F#5/3", "F#5/2 E5/1 D5/3 A4/3 r/3"]),
  };
  // Chorus refrains (top voice); all three cadence G A E.
  const RESP = {
    R1: phrase(["Em11", "Em11"], ["G4/2 A4/1 B4/3 A4/2 G4/1 E4/3", "G4/2 A4/1 E4/6 r/3"]),
    R2: phrase(["D/E", "Em11"], ["F#4/2 A4/1 D5/3 A4/2 F#4/1 D4/3", "G4/2 A4/1 E4/6 r/3"]),
    R3: phrase(["A/E", "Em11"], ["A4/2 C#5/1 E5/3 C#5/2 B4/1 A4/3", "G4/2 A4/1 E4/6 r/3"]),
  };
  // The lone voice before the dance, and again as the fire dies (it hints at the refrain's G A E).
  const INVOKE = parse(["r/12", "r/3 B4/9", "A4/2 B4/1 D5/3 E5/6", "D5/2 C#5/1 B4/9", "r/6 G4/3 A4/3", "B4/4 D5/2 B4/3 A4/3", "G4/2 A4/1 E4~/9", "r/12"]);
  const EMBERS = parse(["r/12", "r/12", "r/6 B4/6", "D5/2 C#5/1 B4/3 A4/6", "G4/2 A4/1 E4/9", "r/12", "r/6 B3/3 D4/3", "E4/12"]);

  // Which pitch classes the chorus's lower voice may use on each chord (chord tones plus the pedal E, B).
  const ALLOWED = { Em11: [4, 6, 7, 9, 11, 2], "D/E": [2, 6, 9, 4, 11], "A/E": [9, 1, 4, 11, 6] };
  const organum = (top, sym) => {
    const ok = ALLOWED[sym] || ALLOWED.Em11;
    for (const d of [5, 7, 4, 3]) if (ok.includes(T.mod12(top - d)) && E_DOR.includes(T.mod12(top - d))) return top - d;
    return top - 5;
  };

  // ---------- rhythm patterns: 12 characters per bar, one per pulse ----------
  const pat = (s) => [...s].map((c, p) => [p, c]).filter(([, c]) => c !== ".");
  const BELL = "X.x.xx.x.x.x";
  const SHAKER = { beats: "X..X..X..X..", full: "X.xX.xX.xX.x" };
  const CONGA = { A: "..oo.m..oo.m", B: "b..o.mb.oo.s" };
  const BONGO = "..h...l...h.";
  const HAND = { o: ["conga", 64, 0.5], m: ["conga", 64, 0.17], s: ["conga", 69, 0.62], b: ["congaLow", 52, 0.55], h: ["bongo", 71, 0.4], l: ["bongo", 66, 0.34] };
  const LEAD = { S: ["conga", 69, 0.7], O: ["conga", 64, 0.55], B: ["congaLow", 52, 0.64], L: ["tom", 47, 0.62], g: ["conga", 64, 0.2] };
  const FILLS = ["B..S.SB..SSS", "S.SS.SS.SS.S", "L..L..S.SL.L", "g.gS.gS.gSSS", "B.SS.SB.S.SS"];
  const HALF_FILLS = ["......S.SS.S", "......B.SSSS", "......L.LS.S", "......g.SB.S"];
  const TALK = ["S..S.SB..B..", "B.SS.SB.S...", "S.S.S.S.SB.B", "L..L..L..SSS", "S.SS..B.SB.."];
  const SIGNAL = ["S..S..S..S..", "S.SS.SS.S.SS"];
  const ANSWER = { S: "o", O: "o", B: "b", L: "b", g: "m" };

  // Pitched ostinati: "note@pulse:weight", two bars per chord.
  const W = { X: 1, x: 0.78, g: 0.48 };
  const tok = (s) => s.trim().split(/\s+/).map((t) => { const [n, rest] = t.split("@"), [p, w] = rest.split(":"); return { note: T.midi(n), p: Number(p), w: W[w] }; });
  const two = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.map(tok)]));
  const SLIT = two({
    Em11: ["E4@0:X B3@4:x D4@8:x", "E4@0:X G4@4:x D4@8:x B3@11:g"],
    "D/E": ["D4@0:X A3@4:x F#4@8:x", "D4@0:X A4@4:x F#4@8:x A3@11:g"],
    "A/E": ["C#4@0:X A3@4:x E4@8:x", "C#4@0:X E4@4:x A4@8:x E4@11:g"],
  });
  const SLIT2 = two({ // the dance again: the same 3-feel, turned the other way
    Em11: ["G4@0:X D4@4:x E4@8:x", "A4@0:X E4@4:x D4@8:x B3@11:g"],
    "D/E": ["F#4@0:X D4@4:x A3@8:x", "A4@0:X F#4@4:x D4@8:x A3@11:g"],
    "A/E": ["E4@0:X C#4@4:x A3@8:x", "A4@0:X E4@4:x C#4@8:x B3@11:g"],
  });
  const BASS = two({
    Em11: ["E2@0:X E2@5:g B2@6:x A2@9:x G2@11:g", "E2@0:X D3@6:x B2@8:g A2@9:x B2@11:g"],
    "D/E": ["E2@0:X F#2@5:g A2@6:x D3@9:x A2@11:g", "E2@0:X A2@6:x F#2@8:g D3@9:x A2@11:g"],
    "A/E": ["E2@0:X E2@5:g A2@6:x C#3@9:x B2@11:g", "E2@0:X A2@6:x E2@8:g C#3@9:x B2@11:g"],
  });
  const BASS2 = two({ Em11: ["E2@0:X B2@3:g E2@6:x G2@8:g A2@9:x", "E2@0:X D3@3:g B2@6:x A2@9:x G2@11:g"] });
  const BASS_SPARSE = two({ Em11: ["E2@0:x", "E2@0:x B2@6:g"] });
  // Last bar of a section: the slit drum climbs and the log drum walks up into the next downbeat.
  const SLIT_TURN = tok("E4@0:X G4@4:x A4@8:x B4@11:g"), BASS_TURN = tok("E2@0:X B2@6:x B2@8:g D3@9:x E3@11:g");

  // ---------- form ----------
  const R0 = ["fire", "invoke", "gather1", "gather2", "gather3", "call1", "call2", "peak", "break", "talk", "call3", "peak2", "embers"];
  const RN = ["invoke", "gather2", "gather3", "call1", "call2", "peak", "break", "talk", "call3", "peak2", "embers"];
  const locate = (c) => (c < R0.length ? { round: 0, id: R0[c] } : { round: 1 + Math.floor((c - R0.length) / RN.length), id: RN[(c - R0.length) % RN.length] });
  const LABEL = {
    fire: "Kindling · the fire is lit", invoke: "Kindling · a voice in the dark",
    gather1: "The dance gathers · bell & shaker", gather2: "The dance gathers · the drums answer", gather3: "The dance gathers · four against three",
    call1: "Call & response", call2: "Call & response · the IV opens", peak: "Call & response · everyone sings",
    break: "Break · only the bell", talk: "The dance again · the drums talk", call3: "The dance again · new calls",
    peak2: "The dance again · the whole circle", embers: "Embers",
  };
  // Round 1 is composed; later rounds shuffle the calls (K4, the high cry, always opens a peak).
  const PLAN0 = { call1: [["K1", "R1"], ["K2", "R1"]], call2: [["K3", "R1"], ["K5", "R2"]], peak: [["K4", "R3"], ["K8", "R1"]], call3: [["K7", "R2"], ["K6", "R1"]], peak2: [["K4", "R3"], ["K1", "R2"]] };
  function planFor(r) {
    const bank = r.shuffle(["K1", "K2", "K3", "K5", "K6", "K7", "K8"]);
    const resp = (k) => (CALLS[k].h[1] === "D/E" ? "R2" : r.pick(["R1", "R1", "R2"]));
    const pairOf = (k) => [k, resp(k)];
    return { call1: [pairOf(bank[0]), pairOf(bank[1])], call2: [pairOf(bank[2]), pairOf(bank[3])], peak: [["K4", "R3"], pairOf(bank[4])], call3: [pairOf(bank[5]), pairOf(bank[6])], peak2: [["K4", "R3"], pairOf(bank[r.int(0, 3)])] };
  }

  /** Later rounds: the leader ornaments. A long note may end on a passing neighbour, or be scooped into. */
  function vary(notes, r, amt, symAt = () => "Em11") {
    const out = [];
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const lands = next && Math.abs(next.p - (n.p + n.d)) < 1e-6 && (n.p + n.d) % 3 === 0;
      if (n.d >= 3 && lands && r.chance(amt)) {
        const dir = Math.sign(next.note - n.note) || 1;
        let nb = T.step(n.note, dir, E_DOR);
        if (nb === next.note) nb = T.step(n.note, -dir, E_DOR); // an escape tone instead
        const c = T.chord(symAt(n.p + n.d - 1)), fits = c.pcs.includes(T.mod12(nb)) || c.scale.includes(T.mod12(nb));
        if (fits && T.mod12(nb) !== 1 && Math.abs(nb - next.note) <= 4) { out.push({ ...n, d: n.d - 1, grace: n.grace }, { p: n.p + n.d - 1, d: 1, note: nb, grace: false }); return; }
      }
      out.push({ ...n, grace: n.grace || (n.d >= 4 && r.chance(amt * 0.5)) });
    });
    return out;
  }

  Sim.register({
    id: "tribal-stage",
    title: "Tribal Stage",
    genre: "Pastoral world",
    about: "A village dance around a fire at dusk, in E dorian over a drone. A standard bell pattern anchors an ensemble of log drums, slit drum and hand drums that builds four-against-three by accumulation. A breathy ocarina calls and a chorus answers in parallel fourths. After the peak the bell plays alone, the lead drum signals, and the dance returns changed.",
    bpm: 108, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 2.5,
    strongBeats: [0, 1, 2, 3],

    instruments(ctx) {
      const { I, out } = ctx;
      const night = I.reverb(ctx, out, { decay: 2.6, preDelay: 0.02, lowcut: 300, highcut: 6500 });
      const valley = I.reverb(ctx, out, { decay: 5.5, preDelay: 0.05, lowcut: 350, highcut: 5000 });
      const echo = I.delay(ctx, out, { time: "4n", feedback: 0.26, highcut: 2400 }); // one beat: an echo off the trees
      const bus = (volDb, pan) => { const g = ctx.keep(new Tone.Gain(db(volDb))); const p = ctx.keep(new Tone.Panner(pan)); g.connect(p); p.connect(out); return { g, p }; };

      // Ocarina: near-sine with a weak third harmonic, heavy breath noise and a tongued chiff.
      const oca = bus(-12, 0.06);
      const ocaVib = ctx.keep(new Tone.Vibrato({ frequency: 4.7, depth: 0.045 })).connect(oca.g);
      const ocaLp = ctx.keep(new Tone.Filter({ frequency: 2400, type: "lowpass", rolloff: -12 })).connect(ocaVib);
      const ocaSyn = ctx.keep(new Tone.MonoSynth({
        portamento: 0.035,
        oscillator: { type: "custom", partials: [1, 0.05, 0.12, 0.02, 0.04] },
        filter: { type: "lowpass", rolloff: -12, Q: 0.5 },
        envelope: { attack: 0.07, decay: 0.3, sustain: 0.82, release: 0.22 },
        filterEnvelope: { attack: 0.08, decay: 0.4, sustain: 0.7, release: 0.3, baseFrequency: 600, octaves: 2 },
      })).connect(ocaLp);
      const breathBp = ctx.keep(new Tone.Filter({ frequency: 1500, type: "bandpass", Q: 0.8 })).connect(ocaLp);
      const breath = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.03, decay: 0.15, sustain: 0.4, release: 0.25 } })).connect(breathBp);
      breath.volume.value = -13;
      const chiffBp = ctx.keep(new Tone.Filter({ frequency: 2800, type: "bandpass", Q: 1.5 })).connect(oca.g);
      const chiff = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02 } })).connect(chiffBp);
      chiff.volume.value = -26;
      const ocaClock = I.monotonic(ocaSyn);
      const ocarina = (t, m, dur, vel, tongue) => {
        const tt = ocaClock(t);
        ocaSyn.triggerAttackRelease(T.hz(m), dur, tt, vel);
        breath.triggerAttackRelease(Math.max(0.05, dur * 0.95), tt, vel);
        if (tongue) chiff.triggerAttackRelease(0.03, tt, vel);
      };

      // Chorus: detuned saws through three vowel formants, a little vibrato, ensemble chorus.
      const cho = bus(0, -0.04);
      const ens = ctx.keep(new Tone.Chorus({ frequency: 0.7, delayTime: 4, depth: 0.45, spread: 160, wet: 0.55 }).start()).connect(cho.g);
      const sum = ctx.keep(new Tone.Gain(1)).connect(ens);
      const VOWEL = { ah: [700, 1150, 2600], oh: [480, 830, 2600], mm: [290, 950, 2400] };
      const formants = [[2.5, 1], [4, 0.5], [6, 0.16]].map(([Q, gain], i) => {
        const g = ctx.keep(new Tone.Gain(gain)).connect(sum);
        return ctx.keep(new Tone.Filter({ type: "bandpass", frequency: VOWEL.oh[i], Q })).connect(g);
      });
      const bodyG = ctx.keep(new Tone.Gain(0.45)).connect(sum);
      const body = ctx.keep(new Tone.Filter({ type: "lowpass", frequency: 520, rolloff: -24 })).connect(bodyG);
      const choVib = ctx.keep(new Tone.Vibrato({ frequency: 5.1, depth: 0.035 }));
      formants.forEach((f) => choVib.connect(f)); choVib.connect(body);
      const choSyn = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 16, options: {
        oscillator: { type: "fatsawtooth", count: 2, spread: 16 },
        envelope: { attack: 0.14, decay: 0.4, sustain: 0.8, release: 0.5 },
      } })).connect(choVib);
      let vowelNow = "oh";
      const setVowel = (t, v) => { if (!VOWEL[v] || v === vowelNow) return; vowelNow = v; formants.forEach((f, i) => f.frequency.rampTo(VOWEL[v][i], 0.25, t)); };

      // Slit drum: FM with a quick bright knock decaying into a hollow sine.
      const sl = bus(3, -0.38);
      const slLp = ctx.keep(new Tone.Filter({ frequency: 3200, type: "lowpass" })).connect(sl.g);
      const slit = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 12, options: {
        harmonicity: 2, modulationIndex: 3.2, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.15 },
        modulationEnvelope: { attack: 0.001, decay: 0.028, sustain: 0, release: 0.02 },
      } })).connect(slLp);

      // Low log drum: a membrane "dung" (pitch falls into the note) plus a short wooden knock.
      const lb = bus(-6.5, 0);
      const lbLp = ctx.keep(new Tone.Filter({ frequency: 1800, type: "lowpass" })).connect(lb.g);
      const logs = [0, 1, 2].map(() => {
        const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 0.7, oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.55, sustain: 0, release: 0.2 } })).connect(lbLp);
        return { s, clock: I.monotonic(s) };
      });
      const knock = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 6, options: {
        harmonicity: 3.3, modulationIndex: 6, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 },
        modulationEnvelope: { attack: 0.001, decay: 0.015, sustain: 0, release: 0.01 },
      } })).connect(lbLp);
      knock.volume.value = -12;
      let logI = 0;

      // Iron bell (gankogui-like): inharmonic FM clank, short ring.
      const bl = bus(-5.5, 0.42);
      const blHp = ctx.keep(new Tone.Filter({ frequency: 500, type: "highpass" })).connect(bl.g);
      const bell = ctx.keep(new Tone.PolySynth({ voice: Tone.FMSynth, maxPolyphony: 6, options: {
        harmonicity: 1.41, modulationIndex: 5, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 },
      } })).connect(blHp);
      const BELL_PITCH = { lo: T.midi("B5"), hi: T.midi("E6") };

      // Hand drums (the ensemble) and the lead drummer, on separate kits so they never steal voices.
      const hands = I.kit(ctx, { volume: -6, preload: ["shaker", "conga", "congaLow", "bongo"] });
      const lead = I.kit(ctx, { volume: -5, preload: ["conga", "congaLow", "tom"] });
      const hp = I.place(ctx, hands, 0.16, out), ldp = I.place(ctx, lead, -0.2, out);

      // Drone: three slow sawtooth voices (retriggered every cycle without a dip) under a breathing lowpass.
      const dr = bus(-28, 0);
      const drLp = ctx.keep(new Tone.Filter({ frequency: 520, type: "lowpass", rolloff: -24, Q: 0.7 })).connect(dr.g);
      const drLfo = ctx.keep(new Tone.LFO({ frequency: 0.045, min: 340, max: 700 }).start());
      drLfo.connect(drLp.frequency);
      const drones = [0, 1, 2].map(() => {
        const s = ctx.keep(new Tone.MonoSynth({
          oscillator: { type: "fatsawtooth", count: 3, spread: 14 },
          filter: { type: "lowpass", Q: 0, rolloff: -12 },
          filterEnvelope: { baseFrequency: 2000, octaves: 0, attack: 0.01, decay: 0.01, sustain: 1, release: 1 },
          envelope: { attack: 4, decay: 0.1, sustain: 1, release: 6 },
        })).connect(drLp);
        return { s, clock: I.monotonic(s) };
      });

      // Fire: crackling pops (random colour and place) and a low brown-noise roar.
      const fr = bus(-10, 0);
      const popPan = ctx.keep(new Tone.Panner(0)).connect(fr.g);
      const popBp = ctx.keep(new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 1.5 })).connect(popPan);
      const pop = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.006, sustain: 0, release: 0.004 } })).connect(popBp);
      const popClock = I.monotonic(pop);
      const roarG = ctx.keep(new Tone.Gain(db(-8))).connect(fr.g);
      const roarLp = ctx.keep(new Tone.Filter({ frequency: 280, type: "lowpass", rolloff: -24 })).connect(roarG);
      const roar = ctx.keep(new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 3, decay: 0.1, sustain: 1, release: 3 } })).connect(roarLp);
      const roarClock = I.monotonic(roar);

      I.send(ctx, oca.p, valley, -9); I.send(ctx, oca.p, echo, -19);
      I.send(ctx, cho.p, valley, -7); I.send(ctx, sl.p, night, -12); I.send(ctx, bl.p, night, -14);
      I.send(ctx, hp, night, -16); I.send(ctx, ldp, night, -13); I.send(ctx, lb.p, night, -24);
      I.send(ctx, dr.p, valley, -16); I.send(ctx, fr.p, night, -14);

      const num = (x, d) => (Number.isFinite(x) ? x : d);
      return {
        ocarina: { layer: "melody", play: (t, e, d) => ocarina(t, e.note, d, e.vel, e.tongue !== false), humanize: { timing: 0.01, vel: 0.05 } },
        chorus: { layer: "harmony", play: (t, e, d) => { setVowel(t, e.vowel); choSyn.triggerAttackRelease(e.note.map(T.hz), d, t, e.vel); }, humanize: { timing: 0.014, vel: 0.05 } },
        slit: { layer: "harmony", play: (t, e, d) => slit.triggerAttackRelease(T.hz(e.note), Math.min(d, 0.5), t, e.vel), humanize: { timing: 0.006, vel: 0.1 } },
        logBass: {
          layer: "bass", humanize: { timing: 0.005, vel: 0.08 },
          play: (t, e, d) => { const v = logs[logI++ % logs.length]; v.s.triggerAttackRelease(T.hz(e.note), Math.min(d, 0.6), v.clock(t), e.vel); knock.triggerAttackRelease(T.hz(e.note), 0.06, t, e.vel); },
        },
        bell: { layer: "drums", play: (t, e) => bell.triggerAttackRelease(T.hz(BELL_PITCH[e.note] || BELL_PITCH.hi), 0.1, t, e.vel), humanize: { timing: 0.003, vel: 0.06 } },
        hands: { layer: "drums", play: (t, e) => hands.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.12 } },
        lead: { layer: "drums", play: (t, e) => lead.hit(e.note, t, e.vel, { pitch: e.pitch }), humanize: { timing: 0.007, vel: 0.1 } },
        drone: { layer: "texture", play: (t, e, d) => e.note.forEach((m, i) => { const v = drones[i]; if (v) v.s.triggerAttackRelease(T.hz(m), d, v.clock(t), e.vel); }) },
        fire: {
          layer: "texture", humanize: { timing: 0, vel: 0.2 },
          play: (t, e, d) => {
            if (e.note === "roar") { roar.triggerAttackRelease(d, roarClock(t), e.vel); return; }
            const tt = popClock(t);
            popBp.frequency.setValueAtTime(num(e.freq, 3000), tt);
            popPan.pan.setValueAtTime(num(e.pan, 0), tt);
            pop.triggerAttackRelease(0.006, tt, e.vel);
          },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const { round, id } = locate(cycle);
      const ev = [];
      const push = (track, pulse, durP, note, vel, extra) => {
        const bar = Math.floor(pulse / PB + 1e-9);
        ev.push({ track, bar, beat: (pulse - bar * PB) / 3, dur: Math.max(0.05, durP / 3), note, vel: clamp(vel), ...extra });
      };
      const harm = Array(8).fill("Em11");
      if (state.planRound !== round) { state.planRound = round; state.plan = round === 0 ? PLAN0 : planFor(r.fork(99)); }
      const plan = state.plan;

      // ---- voices ----
      const sing = (notes, start, o = {}) => {
        let lastEv = null;
        notes.forEach((n, i) => {
          const prev = notes[i - 1], next = notes[i + 1];
          const phraseEnd = !next || next.p > n.p + n.d + 0.01;
          const onBeat = n.p % 3 === 0;
          const vel = (o.vel ?? 0.66) + (onBeat ? 0.05 : -0.03) + (n.d >= 6 ? 0.03 : 0) - (phraseEnd ? 0.05 : 0);
          const gn = T.step(n.note, -1, E_PENT);
          const afterRest = !prev || prev.p + prev.d < n.p - 0.01;
          const scoop = n.grace && r.chance(o.graceP ?? 0.75) && (afterRest || (prev.note < n.note && prev.note !== gn));
          if (scoop) {
            // the ocarina is monophonic: end the previous note before the scoop, or its release would cut it
            if (lastEv && !afterRest) lastEv.dur = Math.min(lastEv.dur, (prev.d - 0.45) / 3);
            push("ocarina", start + n.p - 0.375, 0.34, gn, vel * 0.7);
          }
          push("ocarina", start + n.p, phraseEnd ? n.d : n.d - 0.1, n.note, vel, { tongue: !scoop });
          lastEv = ev[ev.length - 1];
        });
      };
      const choir = (notes, start, o = {}) => {
        notes.forEach((n, i) => {
          const next = notes[i + 1];
          const phraseEnd = !next || next.p > n.p + n.d + 0.01;
          const sym = harm[Math.floor((start + n.p) / PB)] || "Em11";
          const chord = [organum(n.note, sym), n.note];
          if (o.voices === 3) chord.unshift(n.note - 12);
          const vel = (o.vel ?? 0.5) + (n.p % 3 === 0 ? 0.05 : -0.02);
          push("chorus", start + n.p, phraseEnd ? n.d + 0.5 : n.d, chord, vel, { vowel: o.vowel || "oh" });
        });
      };
      const leadPhrase = (bar, s, map = LEAD, track = "lead", gain = 1) => pat(s).forEach(([p, c]) => {
        const [voice, pitch, vel] = map[c];
        push(track, bar * PB + p, 0.3, voice, vel * gain * (p === 0 ? 1.06 : 1), { pitch });
      });
      const pair = (bar0, [k, rk], o = {}) => {
        const call = CALLS[k], resp = RESP[rk];
        harm[bar0] = call.h[0]; harm[bar0 + 1] = call.h[1]; harm[bar0 + 2] = resp.h[0]; harm[bar0 + 3] = resp.h[1];
        let notes = o.vary ? vary(call.n, r, o.vary, (p) => call.h[Math.floor(p / PB)] || "Em11") : call.n;
        if (o.pickup) { // the leader comes in over the chorus's held E
          const first = notes[0].note, dir = first >= T.midi("B4") ? -1 : 1; // from below to a high call, from above to a low one
          const a = T.step(first, 2 * dir, E_PENT), b = T.step(first, dir, E_PENT);
          notes = [{ p: -6, d: 3, note: a, grace: false }, { p: -3, d: 3, note: b, grace: false }, ...notes];
        }
        sing(notes, bar0 * PB, { vel: o.vel });
        return () => choir(resp.n, (bar0 + 2) * PB, { voices: o.voices ?? 2, vowel: o.vowel, vel: o.cvel });
      };

      // ---- groove: one bar of the ensemble, from flags ----
      const grooveBar = (b, f) => {
        const s = b * PB, sym = harm[b], par = b % 2;
        if (f.bell) pat(BELL).forEach(([p, c]) => push("bell", s + p, 0.3, p === 0 ? "lo" : "hi", (c === "X" ? 0.66 : p === 7 ? 0.52 : 0.44) * f.bell));
        if (f.shaker) pat(SHAKER[f.shaker]).forEach(([p, c]) => push("hands", s + p, 0.3, "shaker", (c === "X" ? 0.32 : 0.16) * (f.shakerGain ?? 1)));
        if (f.conga) pat(CONGA[f.conga]).forEach(([p, c]) => { const [v, pitch, vel] = HAND[c]; push("hands", s + p, 0.3, v, vel * (f.congaGain ?? 1), { pitch }); });
        if (f.bongo) pat(BONGO).forEach(([p, c]) => { const [v, pitch, vel] = HAND[c]; push("hands", s + p, 0.3, v, vel, { pitch }); });
        if (f.slit) {
          const set = f.slit[sym] || f.slit.Em11;
          (f.turn && sym === "Em11" ? SLIT_TURN : set[par]).forEach((n) => { if (!f.slitMask || f.slitMask.includes(n.p)) push("slit", s + n.p, 3, n.note, 0.6 * n.w * (f.slitVel ?? 1)); });
        }
        if (f.bass) {
          const src = f.bass === "sparse" ? BASS_SPARSE.Em11 : f.bass === "alt" && BASS2[sym] ? BASS2[sym] : BASS[sym] || BASS.Em11;
          const ns = f.turn && sym === "Em11" && f.bass !== "sparse" ? BASS_TURN : src[par];
          const nextC = T.chord(harm[b + 1] || nextFirst);
          ns.forEach((n, i) => {
            const nxt = ns[i + 1] ? ns[i + 1].p : PB;
            // a pickup into a new chord borrows that chord's tone (G2 would rub against A/E's C#)
            const note = n.p === 11 && !nextC.scale.includes(T.mod12(n.note)) ? T.nearest(n.note, nextC.pcs, 40, 52) : n.note;
            push("logBass", s + n.p, Math.min(4, nxt - n.p), note, 0.82 * n.w * (f.bassVel ?? 1));
          });
        }
      };
      const drone = (vel) => push("drone", 0, 8 * PB - 0.3, [T.midi("E2"), T.midi("B2"), T.midi("E3")], vel);
      const fire = (density, roar) => {
        if (roar) push("fire", 0, 8 * PB - 0.3, "roar", roar);
        const bursts = Math.round(density * r.range(7, 11));
        for (let i = 0; i < bursts; i++) {
          let p = r.range(0, 8 * PB - 3);
          const n = r.weighted([[1, 3], [2, 3], [3, 2], [5, 1]]);
          for (let k = 0; k < n; k++) { push("fire", p, 0.1, "pop", r.range(0.12, 0.5) * (k ? 0.8 : 1), { freq: r.range(1400, 5600), pan: r.range(-0.6, 0.6) }); p += r.range(0.12, 0.8); }
        }
      };

      // ---- sections ----
      const bars = (f) => { for (let b = 0; b < 8; b++) { const x = f(b); if (x) grooveBar(b, x); } };
      const full = { bell: 1, shaker: "full", conga: "A", bass: "full", slit: SLIT };
      const again = { bell: 1, shaker: "full", conga: "B", bongo: true, bass: "alt", slit: SLIT2 };
      const later = round > 0;
      const nextId = locate(cycle + 1).id;
      // a turnaround in the last bar, unless the leader is about to come in over it
      const nextFirst = plan[nextId] ? CALLS[plan[nextId][0][0]].h[0] : "Em11";
      const turn = (b) => b === 7 && !nextId.startsWith("peak") && r.chance(0.6);
      switch (id) {
        case "fire": {
          drone(0.38); fire(1.2, 0.5);
          bars((b) => ({ slit: b >= 2 ? SLIT : null, slitMask: b < 4 ? [0] : b < 6 ? [0, 8] : null, slitVel: 0.55 + b * 0.03, bass: b >= 4 ? "sparse" : null, bassVel: 0.6 }));
          break;
        }
        case "invoke": {
          drone(0.48); fire(later ? 0.9 : 0.8, 0.42);
          sing(later ? vary(INVOKE, r, 0.3) : INVOKE, 0, { vel: 0.52 });
          bars((b) => ({ slit: SLIT, slitVel: 0.68, bass: "sparse", bassVel: 0.7 }));
          leadPhrase(7, "L.....L..L.L", LEAD, "lead", 0.85); // the drummer calls the village
          break;
        }
        case "gather1":
          drone(0.52); fire(0.5, 0.32);
          bars((b) => ({ bell: 1, shaker: b >= 4 ? "full" : b >= 2 ? "beats" : null, slit: SLIT, slitVel: 0.85, bass: b >= 4 ? "sparse" : null }));
          break;
        case "gather2":
          drone(0.55); fire(0.45, 0.3);
          bars((b) => ({ ...full, shaker: later && b < 2 ? "beats" : "full", bass: b < 2 ? "sparse" : "full", congaGain: b < 2 ? 0.8 : 1, turn: turn(b) }));
          leadPhrase(7, r.pick(HALF_FILLS));
          break;
        case "gather3": {
          drone(0.58); fire(0.4, 0.3);
          harm[6] = "D/E";
          bars((b) => ({ ...full, bongo: true, turn: turn(b) }));
          choir(RESP.R1.n, 4 * PB, { vowel: "mm", vel: 0.3 });
          choir(RESP.R2.n, 6 * PB, { vowel: "mm", vel: 0.32 });
          leadPhrase(7, r.pick(HALF_FILLS));
          break;
        }
        case "call1": case "call2": case "peak": case "call3": case "peak2": {
          const peak = id === "peak" || id === "peak2", dance = id === "call3" || id === "peak2";
          const amt = (later ? 0.25 : 0) + (dance ? 0.2 : 0) + (peak && later ? 0.1 : 0);
          const vowel = id === "call1" ? "oh" : "ah";
          const pp = plan[id];
          const voices2 = peak ? 3 : id === "call3" ? [2, 3] : [2, 2];
          const a = pair(0, pp[0], { vary: amt, pickup: peak, voices: Array.isArray(voices2) ? voices2[0] : voices2, vowel, cvel: peak ? 0.52 : 0.48, vel: peak ? 0.7 : 0.66 });
          const c = pair(4, pp[1], { vary: amt, pickup: peak, voices: Array.isArray(voices2) ? voices2[1] : voices2, vowel, cvel: peak ? 0.54 : 0.5, vel: peak ? 0.7 : 0.66 });
          a(); c(); // the choir reads the harmony that both calls have now written
          drone(peak ? 0.62 : 0.58); fire(0.3, 0.28);
          const base = dance ? again : full;
          bars((b) => ({ ...base, bongo: id !== "call1", bell: peak ? 1.08 : 0.92, slitVel: b % 4 < 2 ? 0.72 : 0.85, conga: dance ? "B" : "A", turn: turn(b) }));
          if (peak) { leadPhrase(3, r.pick(HALF_FILLS)); leadPhrase(7, r.pick(FILLS)); }
          else leadPhrase(7, r.pick(HALF_FILLS), LEAD, "lead", 0.85);
          break;
        }
        case "break":
          fire(0.95, 0.46);
          bars(() => ({ bell: 1.05 }));
          leadPhrase(6, SIGNAL[0]); leadPhrase(7, SIGNAL[1]);
          break;
        case "talk": {
          drone(0.55); fire(0.35, 0.28);
          harm[2] = "D/E"; harm[6] = "D/E";
          bars((b) => ({ ...again, conga: null, turn: turn(b) }));
          const calls = r.shuffle(TALK);
          for (let k = 0; k < 4; k++) {
            leadPhrase(2 * k, calls[k]);
            const ans = [...calls[k]].map((c) => (c === "." ? "." : ANSWER[c])).join("");
            leadPhrase(2 * k + 1, ans, HAND, "hands", 0.95);
          }
          choir(RESP.R1.n, 4 * PB, { vowel: "mm", vel: 0.28 });
          choir(RESP.R2.n, 6 * PB, { vowel: "mm", vel: 0.3 });
          break;
        }
        case "embers": {
          drone(0.5); fire(0.9, 0.44);
          sing(later ? vary(EMBERS, r, 0.25) : EMBERS, 0, { vel: 0.52 });
          bars((b) => b < 2 ? { ...full, bongo: b === 0, conga: "A", congaGain: 1 - b * 0.2 }
            : b < 4 ? { bell: 0.9, shaker: "full", shakerGain: 0.85, bass: "sparse", slit: SLIT, slitVel: 0.8 }
            : b < 6 ? { bell: b === 4 ? 0.8 : 0.65, shaker: "beats", shakerGain: 0.7, slit: SLIT, slitVel: 0.65 }
            : { slit: SLIT, slitMask: [0], slitVel: 0.5 });
          push("chorus", 6 * PB, 24, [T.midi("E3"), T.midi("B3")], 0.24, { vowel: "mm" });
          break;
        }
      }

      const harmony = [];
      harm.forEach((c, i) => { const last = harmony[harmony.length - 1]; if (last && last.chord === c) last.dur += 4; else harmony.push({ bar: i, beat: 0, dur: 4, chord: c }); });
      const label = later && (id === "invoke") ? `${LABEL[id]} · round ${round + 1}` : LABEL[id];
      return { events: ev, harmony, section: label, state };
    },
  });
})();
