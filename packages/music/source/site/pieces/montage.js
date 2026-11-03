// Montage: an 80s synth-rock training-montage anthem. Sweat, stairs, sunrise, one more rep.
//
// The sound: 909 kick and a gated snare (big room, cut dead) doubled by a Linn-ish clap in the choruses,
// Simmons tom fills that mark every section change, crashes on arrivals, tambourine eighths that come in
// for the second verse and the choruses. A double-tracked overdriven guitar (palm-muted eighths in the
// verses, ringing power chords with pushes in the choruses), a DX-style FM bass driving straight eighths,
// a CS-80 brass section for stabs and swells, a Solina string machine underneath, and a bright saw lead
// that "sings" the tune: syllabic repeated notes and pickups in the verse, long held notes and leaps in
// the chorus. The bridge hands over to a second lead run through a distortion pedal: a guitar-style solo
// with bends (the synth's pitch slides up a step into the note without re-attacking).
//
// Harmony: D major, uplifting through the rock mixolydian moves: I-bVII-IV-I (D C G D) for the riff and
// chorus, a D pedal under C/D and G/D in the verse, a suspended pre-chorus (Gmaj7 / Asus4 rocking, then
// Em7 F#m7 Gsus2 Asus4-A) over a snare roll that builds from eighths to sixteenths into a Simmons fill.
// The bridge goes to the relative minor (Bm G D A ... F#7), breaks down to half-time drums and toms, then
// climbs G A C D: C and D are bVI and bVII of E, so the last chorus lands a whole step up in E. The outro
// riff in E ends on C (bVI of E = bVII of D), which is exactly the chord that leads back to D for the
// next round.
//
// Form (cycles of 8 bars at 120 BPM = 16 s; one round = 17 cycles, about 4.5 minutes):
//   Intro riff | Verse (A: D pedal, B: Bm G D A) | Pre-chorus | Chorus (A + B) | Riff |
//   Verse 2 (tambourine, brass answers) | Pre-chorus | Chorus | Solo | Breakdown + climb |
//   Chorus in E (harmony line, octave brass) | Outro riff in E -> back to D
// Later rounds open with drums and bass alone, vary the verse tune, and improvise a fresh solo.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;
  const arr = (n) => (Array.isArray(n) ? n : [n]);

  // ---------- notation: one string per bar, "note/beats", r = rest, a trailing ~ bends up into the note ----------
  function bars(list) {
    const out = [];
    list.forEach((s, i) => {
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const m = /^(r|[A-G][#b]?\d)(~?)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`montage: bad token "${tok}"`);
        const dur = Number(m[3]);
        if (m[1] !== "r") out.push({ beat: i * BPB + b, dur, note: T.midi(m[1]), bend: m[2] === "~" });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`montage: bar sums to ${b}: ${s}`);
    });
    return out;
  }

  // ---------- harmony (written in D; the last chorus and outro are transposed up a whole step) ----------
  const PROG_TEXT = {
    RIFF: "| D | C | G | D | D | C | G | G:2 A:2 |",
    VA: "| D | Dsus4 | C/D | G/D | D | Dsus4 | C/D | G/D |",
    VB: "| Bm | G | D | A | Bm | G | Em7 | Asus4:2 A:2 |",
    PRE: "| Gmaj7 | Asus4 | Gmaj7 | Asus4 | Em7 | F#m7 | Gsus2 | Asus4:2 A:2 |",
    CA: "| D | C | G | D | D | C | G | A |",
    CB: "| Bm7 | G | D/F# | G | Em7 | G | Asus4 | A |",
    SOLO: "| Bm | G | D | A | Bm | G | Em7 | F#7 |",
    BREAK: "| Bm | G | D | A | G | A | C | D |",
    OUTRO: "| D | C | G | D | D | C | Bb | Bb |", // +2: E D A E E D C C
  };
  const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  function trSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    const nm = (x) => NAMES[mod12(T.PC[x] + k)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }
  const progCache = {};
  function progOf(name, k) {
    const key = name + k;
    if (!progCache[key]) progCache[key] = T.progression(PROG_TEXT[name], BPB).map((h) => ({ ...h, chord: trSym(h.chord, k) }));
    return progCache[key];
  }

  // ---------- the tune (lead), in D ----------
  const MEL = {
    // the riff hook: 5-3-5-6-5-3-2, answered a fourth up over G
    RIFF: bars([
      "A5/0.5 F#5/0.5 A5/0.5 B5/1 A5/0.5 F#5/0.5 E5/0.5",
      "G5/1.5 E5/0.5 G5/1 C6/1",
      "B5/0.5 G5/0.5 B5/0.5 D6/1 B5/0.5 A5/0.5 G5/0.5",
      "A5/3 r/1",
      "A5/0.5 F#5/0.5 A5/0.5 B5/1 A5/0.5 F#5/0.5 E5/0.5",
      "G5/1.5 E5/0.5 C6/1 B5/0.5 G5/0.5",
      "D6/1.5 B5/0.5 G5/1 B5/1",
      "B5/1 A5/1 r/2",
    ]),
    // outro bars 7-8 over C (bVI of E, written Bb in D): rise to the top and hang there
    OUTRO_TAIL: bars(["F5/0.5 Bb5/0.5 D6/1.5 C6/0.5 Bb5/1", "D6/3 r/1"]),
    // verse: syllabic, repeated notes and pickups, low in the voice
    VA: bars([
      "r/0.5 F#4/0.5 A4/0.5 A4/0.5 B4/1 A4/1",
      "G4/1.5 F#4/0.5 G4/1 r/1",
      "r/0.5 E4/0.5 G4/0.5 G4/0.5 C5/1 B4/0.5 A4/0.5",
      "B4/2 r/2",
      "r/0.5 F#4/0.5 A4/0.5 A4/0.5 D5/1 C#5/0.5 B4/0.5",
      "A4/1.5 G4/0.5 A4/1 r/1",
      "r/0.5 G4/0.5 C5/0.5 C5/0.5 E5/1 D5/0.5 C5/0.5",
      "D5/2 B4/1 r/1",
    ]),
    VB: bars([
      "r/0.5 B4/0.5 B4/0.5 C#5/0.5 D5/1 B4/1",
      "D5/1.5 B4/0.5 G4/1 r/1",
      "r/0.5 A4/0.5 A4/0.5 B4/0.5 A4/1 F#4/1",
      "E4/2 r/1 E4/0.5 F#4/0.5",
      "F#4/1 B4/1 D5/1 C#5/0.5 B4/0.5",
      "D5/1.5 E5/0.5 D5/1 B4/1",
      "G4/1 B4/0.5 D5/0.5 E5/1 D5/1",
      "D5/2 C#5/1 r/1",
    ]),
    // pre-chorus: long notes climbing in sequence, the sus4 resolving at the top
    PRE: bars([
      "B4/1.5 A4/0.5 B4/1 D5/1",
      "E5/3 r/1",
      "B4/1.5 A4/0.5 B4/1 F#5/1",
      "E5/2 D5/1 r/1",
      "G5/1.5 F#5/0.5 E5/1 B4/1",
      "C#5/1.5 E5/0.5 F#5/1 A5/1",
      "A5/2 G5/1 A5/1",
      "D6/1.5 C#6/0.5 r/2",
    ]),
    // chorus: the anthem. A ends open on V, B climbs to the sus4 and its resolution
    CA: bars([
      "A5/1.5 F#5/0.5 D5/1 E5/0.5 F#5/0.5",
      "G5/1.5 E5/0.5 C5/1 r/0.5 G5/0.5",
      "B5/1.5 A5/0.5 G5/1 D5/0.5 E5/0.5",
      "F#5/2.5 r/0.5 E5/0.5 F#5/0.5",
      "A5/1.5 F#5/0.5 D5/1 E5/0.5 F#5/0.5",
      "C6/1.5 B5/0.5 G5/1 E5/1",
      "D6/1.5 B5/0.5 G5/1 B5/1",
      "A5/2.5 r/1 E5/0.5",
    ]),
    CB: bars([
      "F#5/1.5 D5/0.5 B4/1 C#5/0.5 D5/0.5",
      "G5/1.5 F#5/0.5 E5/1 D5/1",
      "F#5/1.5 E5/0.5 D5/1 A4/1",
      "B4/1 D5/1 G5/1.5 F#5/0.5",
      "E5/1.5 G5/0.5 B5/1 A5/0.5 G5/0.5",
      "B5/1.5 D6/0.5 D6/1 B5/1",
      "D6/2 B5/1 A5/1",
      "C#6/3 r/1",
    ]),
    // the end of the breakdown: arpeggio up to the top, bend into the bVII, and the key change
    CLIMB: bars(["C5/0.5 E5/0.5 G5/0.5 C6/0.5 E6/2", "A5/1 D6~/3"]),
  };

  // ---------- form ----------
  const S = (id, prog, kind, label, x = {}) => ({ id, prog, kind, label, ...x });
  const ROUND = [
    S("intro", "RIFF", "riff", "Intro · the riff"),
    S("va1", "VA", "verse", "Verse 1 · D pedal, palm mutes", { mel: "VA" }),
    S("vb1", "VB", "verse", "Verse 1 · relative minor", { mel: "VB" }),
    S("pre1", "PRE", "pre", "Pre-chorus · suspended, snare roll"),
    S("ca1", "CA", "chorus", "Chorus · I–♭VII–IV–I", { mel: "CA" }),
    S("cb1", "CB", "chorus", "Chorus · the climb", { mel: "CB" }),
    S("riff", "RIFF", "riff", "Riff · brass and guitar"),
    S("va2", "VA", "verse", "Verse 2 · tambourine, brass answers", { mel: "VA", v2: true }),
    S("vb2", "VB", "verse", "Verse 2 · relative minor", { mel: "VB", v2: true }),
    S("pre2", "PRE", "pre", "Pre-chorus · suspended, snare roll", { v2: true }),
    S("ca2", "CA", "chorus", "Chorus 2", { mel: "CA", v2: true }),
    S("cb2", "CB", "chorus", "Chorus 2 · harmony line", { mel: "CB", v2: true, harm: true }),
    S("solo", "SOLO", "solo", "Bridge · guitar solo"),
    S("break", "BREAK", "break", "Breakdown · toms, then the climb to E"),
    S("ca3", "CA", "chorus", "Last chorus · up a step to E", { mel: "CA", k: 2, last: true, harm: true }),
    S("cb3", "CB", "chorus", "Last chorus · E major", { mel: "CB", k: 2, last: true, harm: true }),
    S("outro", "OUTRO", "riff", "Outro · riff in E, ♭VI back home", { k: 2, outro: true }),
  ];
  function planAt(cycle) {
    const round = Math.floor(cycle / ROUND.length), s = ROUND[cycle % ROUND.length];
    const p = { round, k: 0, ...s };
    if (p.id === "intro" && round > 0) { p.kind = "intro2"; p.label = "Intro · drums and bass, the band piles in"; }
    return p;
  }

  // ---------- voicing helpers ----------
  /** Power chord on the chord's root (or the slash chord's upper root): root, fifth, octave. Root in E2..Eb3. */
  function power(sym, three = true) {
    const c = T.chord(sym);
    const r = T.nearest(45, [c.root], 40, 51);
    return three ? [r, r + 7, r + 12] : [r, r + 7];
  }
  /** Triad-ish voicing for brass/strings: chord tones only, root kept, voice-led. */
  function block(sym, o) {
    const c = T.chord(sym);
    const core = { ...c, guide: c.guide.filter((p) => c.pcs.includes(p)), colors: c.kind === "major7" || c.kind === "minor7" || c.kind === "dominant" ? c.colors.slice(0, 0) : c.colors };
    return T.voice(core, { rootless: false, avoidRootOnTop: false, omitBass: true, ...o });
  }

  // ---------- custom: a distortion pedal for the solo lead ----------
  function soloVoice(ctx, I) {
    const lead = I.lead(ctx, { volume: -9, wave: "sawtooth", glide: 0.012, resonance: 2.2, base: 900, octaves: 2.6, attack: 0.004, sustain: 0.9, release: 0.3, vibrato: 5.6, vibratoDepth: 0.14, vibratoDelay: 0.28 });
    const drive = ctx.keep(new Tone.Distortion({ distortion: 0.62, oversample: "2x", wet: 0.85 }));
    const cab = ctx.keep(new Tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -24 }));
    const hp = ctx.keep(new Tone.Filter({ frequency: 220, type: "highpass" }));
    lead.out.connect(hp); hp.connect(drive); drive.connect(cab);
    return {
      out: cab,
      play(t, e, d) {
        if (!Number.isFinite(e.note)) return;
        if (e.bend) {
          const from = e.note - (e.bendBy || 2);
          lead.play(t, from, d, e.vel);
          const s = lead.synth;
          s.portamento = Math.min(0.16, d * 0.35);
          s.setNote(T.hz(e.note), t + 0.05);
          s.portamento = 0.012;
        } else lead.play(t, e.note, d, e.vel);
      },
    };
  }

  // ---------- drums ----------
  const SIM_HI = 62, SIM_MID = 55, SIM_LO = 48, SIM_FLOOR = 43;
  const FILLS = [
    [[3, SIM_HI], [3.25, SIM_MID], [3.5, SIM_LO], [3.75, SIM_FLOOR]],
    [[2, "snare"], [2.5, "snare"], [3, SIM_HI], [3.25, SIM_HI], [3.5, SIM_MID], [3.75, SIM_LO]],
    [[2, SIM_HI], [2.333, SIM_HI], [2.667, SIM_MID], [3, SIM_MID], [3.333, SIM_LO], [3.667, SIM_FLOOR]],
    [[2.5, SIM_MID], [3, SIM_HI], [3.5, SIM_LO], [3.75, SIM_FLOOR]],
  ];

  Sim.register({
    id: "montage",
    title: "Montage",
    genre: "80s synth rock",
    about: "A training-montage anthem in D: gated snare and Simmons fills, palm-muted guitar and FM bass eighths, a singing saw lead over I–♭VII–IV–I, a suspended pre-chorus over a snare roll, a bent-note guitar solo, and a last chorus up a step in E.",
    situations: ["training", "celebrate"],
    energy: 0.85,
    bpm: 120, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.8, preDelay: 0.03, lowcut: 300, highcut: 7000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.008, lowcut: 250, highcut: 8000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.28, highcut: 4200, pingPong: true });

      const lead = I.lead(ctx, { volume: -1, wave: "fatsawtooth", detune: 14, glide: 0.035, base: 800, octaves: 3, resonance: 1.4, vibrato: 5.4, vibratoDepth: 0.09, vibratoDelay: 0.32, release: 0.22 });
      const harm = I.lead(ctx, { volume: -10, wave: "fatsquare", detune: 10, glide: 0.035, base: 600, octaves: 2.6, vibratoDepth: 0.06, release: 0.2 });
      const solo = soloVoice(ctx, I);
      const gtrL = I.distGuitar(ctx, { volume: -11, drive: 0.82, cutoff: 3200 });
      const gtrR = I.distGuitar(ctx, { volume: -11, drive: 0.78, cutoff: 3000 });
      const bass = I.fmBass(ctx, { volume: -4, bite: 5 });
      const brass = I.synthBrass(ctx, { volume: -9, swell: 0.22, attack: 0.05 });
      const strings = I.stringMachine(ctx, { volume: -12, cutoff: 2800 });
      const kit = I.kit(ctx, { volume: -2, preload: ["kick909", "gatedSnare", "rockSnare", "hatClosed", "hatOpen", "crash", "simmons", "tambourine", "clap"] });

      const lp = I.place(ctx, lead, 0.04, out), hp = I.place(ctx, harm, -0.18, out);
      const spn = ctx.keep(new Tone.Panner(0.1)); solo.out.connect(spn); spn.connect(out);
      const gl = I.place(ctx, gtrL, -0.62, out), gr = I.place(ctx, gtrR, 0.62, out);
      I.place(ctx, bass, 0, out);
      const bp = I.place(ctx, brass, -0.25, out), sp = I.place(ctx, strings, 0.3, out);
      const kp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -11); I.send(ctx, lp, echo, -19); I.send(ctx, hp, hall, -10);
      I.send(ctx, spn, hall, -10); I.send(ctx, spn, echo, -15);
      I.send(ctx, gl, room, -16); I.send(ctx, gr, room, -16);
      I.send(ctx, bp, hall, -7); I.send(ctx, sp, hall, -6);
      I.send(ctx, kp, room, -13); I.send(ctx, kp, hall, -24);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        lead: { layer: "melody", play: pl(lead), humanize: { timing: 0.006, vel: 0.05 } },
        harm: { layer: "melody", play: pl(harm), humanize: { timing: 0.008, vel: 0.05 } },
        solo: { layer: "melody", play: (t, e, d) => solo.play(t, e, d), humanize: { timing: 0.008, vel: 0.06 } },
        guitar: { layer: "harmony", play: (t, e, d) => { gtrL.play(t, e.note, d, e.vel); gtrR.play(t + 0.011, e.note, d * 0.97, e.vel * 0.95); }, humanize: { timing: 0.004, vel: 0.05 } },
        brass: { layer: "harmony", play: pl(brass), humanize: { timing: 0.006, vel: 0.05 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0, vel: 0.03 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.003, vel: 0.06 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.gate }), humanize: { timing: 0.003, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1), prev = cycle > 0 ? planAt(cycle - 1) : null;
      const k = plan.k, prog = progOf(plan.prog, k);
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const keyScale = T.scale(mod12(2 + k), "ionian");
      const kind = plan.kind;
      const v2 = !!plan.v2 || plan.round > 0;

      // ================= melody =================
      const sing = (notes, track = "lead", base = 0.66) => {
        notes.forEach((n, i) => {
          const nx = notes[i + 1];
          const gap = nx ? nx.beat - (n.beat + n.dur) : 1;
          const legato = gap < 0.01 && n.dur <= 0.5; // runs of eighths are slurred, longer notes breathe
          const inBar = n.beat % BPB;
          const accent = inBar === 0 ? 0.08 : inBar === 2 ? 0.04 : n.dur < 0.75 && inBar % 1 ? -0.06 : 0;
          const hi = Math.max(0, (n.note - 76) * 0.006);
          push(track, n.beat, n.dur * (legato ? 0.98 : 0.9), n.note + k, base + accent + hi, n.bend ? { bend: true } : {});
        });
      };
      /** Variation on return: offbeat passing notes move to a neighbour, a few repeated notes become a turn. */
      const vary = (notes, amt, rr) => notes.map((n, i) => {
        const inBar = n.beat % BPB, sc = T.chord(symAt(n.beat)).scale;
        if (inBar % 1 && n.dur <= 0.5 && rr.chance(amt)) {
          const nb = T.step(n.note, rr.chance(0.5) ? 1 : -1, keyScale.filter((p) => sc.includes(p)));
          const prevN = notes[i - 1], nextN = notes[i + 1];
          if ((!prevN || Math.abs(nb - prevN.note) <= 4) && (!nextN || Math.abs(nb - nextN.note) <= 4)) return { ...n, note: nb };
        }
        return n;
      });

      if (plan.mel) {
        let notes = MEL[plan.mel];
        if (kind === "verse" && v2) notes = vary(notes, 0.35, r.fork(11 + plan.round));
        sing(notes, "lead", kind === "verse" ? 0.6 : 0.7);
        if (plan.harm) { // a diatonic third below, chorus B of chorus 2 and all of the last chorus
          const hn = notes.map((n) => {
            const c = T.chord(symAt(n.beat));
            let h = T.step(n.note, -2, c.scale.map((p) => mod12(p - k)));
            // a strong-beat harmony note should sit in the chord: try a fourth/sixth below instead
            if (n.beat % 1 === 0 && !c.pcs.includes(mod12(h + k))) { const alt = T.nearest(n.note - 5, c.pcs.map((p) => mod12(p - k)), n.note - 9, n.note - 3); h = alt; }
            return { ...n, note: h, bend: false };
          });
          sing(hn, "harm", 0.5);
        }
      } else if (kind === "riff") {
        if (plan.outro) {
          sing(MEL.RIFF.filter((n) => n.beat < 24));
          sing(MEL.OUTRO_TAIL.map((n) => ({ ...n, beat: n.beat + 24 })));
        } else sing(MEL.RIFF, "lead", plan.id === "intro" && plan.round === 0 ? 0.7 : 0.66);
      } else if (kind === "pre") {
        sing(MEL.PRE, "lead", 0.64);
      } else if (kind === "solo" || kind === "break") {
        const scaleFor = (s) => { const c = T.chord(s); const keyS = keyScale; return c.scale.filter((p) => keyS.includes(p) || c.pcs.includes(p)); };
        const parts = kind === "solo"
          ? [{ start: 0, end: 15.5, density: 0.6, register: 0.5 }, { start: 16, end: 31.5, density: 0.8, register: 0.62 }]
          : [{ start: 0.5, end: 15.5, density: 0.3, register: 0.55, phrase: [4, 8] }, { start: 16, end: 23.5, density: 0.72, register: 0.7 }];
        let last = state.soloLast ?? 74, motif = kind === "solo" ? null : state.soloMotif;
        const lineNotes = [];
        parts.forEach((pt, i) => {
          const m = C.line({ start: pt.start, end: pt.end, chordAt: symAt, lo: 64, hi: 86, rng: r.fork(30 + i), density: pt.density, phrase: pt.phrase || [3, 6], rest: [0.5, 1.5], motif, motifProb: 0.55, chromatic: 0.12, register: pt.register, prev: last, scaleFor, upbeatStart: 0.45 });
          motif = m.motif; last = m.last;
          lineNotes.push(...m.notes);
        });
        state.soloMotif = motif; state.soloLast = last;
        let all = kind === "break" ? lineNotes.filter((n) => n.beat < 24).concat(MEL.CLIMB.map((n) => ({ ...n, beat: n.beat + 24, strong: true, vel: 0.72 }))) : lineNotes;
        // guitar licks: a gap before a phrase is filled with a sixteenth-note pentatonic run falling into it
        const pent = [2, 4, 6, 9, 11];
        const runs = [];
        all.forEach((n, i) => {
          const p = all[i - 1];
          if (!p || n.beat - (p.beat + p.dur) < 1 || n.beat >= 24 && kind === "break" || !r.chance(kind === "solo" ? 0.55 : 0.35)) return;
          const sc = T.chord(symAt(n.beat - 1)).scale, ok = pent.filter((x) => sc.includes(x));
          if (ok.length < 4) return;
          let m = n.note;
          const run = [];
          for (let j = 0; j < 4; j++) { m = T.step(m, 1, ok); run.unshift(m); }
          run.forEach((x, j) => runs.push({ beat: n.beat - 1 + j * 0.25, dur: 0.25, note: Math.min(88, x), strong: false, run: true }));
        });
        all = all.concat(runs).sort((a, b) => a.beat - b.beat);
        all.forEach((n, i) => {
          const sc = scaleFor(symAt(n.beat));
          let bend = n.bend || false, bendBy = 2;
          if (!bend && n.dur >= 0.9 && n.strong && r.chance(0.45)) bend = true;
          if (bend) { const below = T.step(n.note, -1, sc); bendBy = Math.max(1, Math.min(2, n.note - below)); }
          const inBar = n.beat % BPB;
          const vel = 0.62 + (inBar === 0 ? 0.08 : 0) + (n.dur >= 1 ? 0.05 : 0) + r.gauss(0.03);
          const nx = all[i + 1];
          const dur = nx && nx.beat - (n.beat + n.dur) < 0.01 ? n.dur * 0.97 : n.dur * 0.88;
          push("solo", n.beat, dur, n.note + k, vel, bend ? { bend: true, bendBy } : {});
          // a quick hammer-on/pull-off flourish into some phrase endings
        });
      }

      // ================= harmony: guitar, brass, strings =================
      const spans = prog.map((h) => ({ sym: h.chord, start: h.bar * BPB + h.beat, dur: h.dur }));
      const gtr = (abs, dur, notes, vel) => push("guitar", abs, dur, notes, vel);
      const chordStartsAt = (b) => spans.find((s) => Math.abs(s.start - b) < 1e-6);
      const nextFirstSym = progOf(next.prog, next.k)[0].chord;

      if (kind === "verse" || kind === "intro2") {
        for (let b = 0; b < 32; b += 0.5) {
          if (kind === "intro2" && b < 16) continue;
          const sym = symAt(b), inBar = b % BPB, bar = Math.floor(b / BPB);
          const ring = plan.mel === "VB" && (bar === 3 || bar === 7) && inBar >= 2;
          if (ring) { if (inBar === 2) gtr(b, 1.9, power(sym), 0.5); continue; }
          gtr(b, 0.3, power(sym, false), inBar === 0 ? 0.5 : inBar % 1 ? 0.36 : 0.42);
        }
      } else if (kind === "pre") {
        for (let bar = 0; bar < 8; bar++) {
          if (bar < 6) {
            const s0 = spans.find((s) => s.start === bar * BPB);
            gtr(bar * BPB, 2.4, power(s0.sym), 0.55);
            gtr(bar * BPB + 2.5, 1.4, power(s0.sym), 0.46);
          } else for (let b = 0; b < 4; b += 0.5) { const B = bar * BPB + b; gtr(B, 0.28, power(symAt(B), false), 0.36 + (bar - 6) * 0.1 + b * 0.02); }
        }
      } else if (kind === "chorus" || kind === "solo" || kind === "riff") {
        const PAT = kind === "riff" ? [[0, 1.4, 0.62], [1.5, 0.9, 0.55], [2.5, 0.45, 0.5], [3, 0.45, 0.52]]
          : [[0, 1.4, 0.62], [1.5, 0.4, 0.46], [2, 0.9, 0.56], [3, 0.4, 0.46], [3.5, 0.4, 0.5]];
        for (let bar = 0; bar < 8; bar++) {
          for (const [b, d, v] of PAT) {
            const B = bar * BPB + b;
            // push: on 4-and, anticipate the next bar's chord when it changes (the eighth ties over)
            const nextSym = bar < 7 ? symAt((bar + 1) * BPB) : null;
            if (b === 3.5 && nextSym && nextSym !== symAt(B) && kind !== "riff") { gtr(B, 0.9, power(nextSym), 0.6); continue; }
            if (b === 0 && bar > 0 && kind !== "riff" && symAt(B) !== symAt(B - 1) && ev.some((e) => e.track === "guitar" && Math.abs(e.bar * BPB + e.beat - (B - 0.5)) < 1e-6 && e.dur > 0.6)) continue;
            gtr(B, d, power(symAt(B)), v);
          }
        }
        if (plan.outro) { ev.splice(0, ev.length, ...ev.filter((e) => !(e.track === "guitar" && e.bar >= 6))); gtr(24, 3.8, power(symAt(24)), 0.62); gtr(28, 3.6, power(symAt(28)), 0.58); }
      } else if (kind === "break") {
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB;
          if (bar < 4) gtr(B, 3.6, power(symAt(B)), 0.44);
          else for (let b = 0; b < 4; b += 0.5) gtr(B + b, 0.28, power(symAt(B + b), false), 0.4 + (bar - 4) * 0.06);
        }
      }

      // brass and strings
      const bOpts = (o) => ({ prev: state.brassV, rng: r, ...o });
      const brassAt = (abs, dur, sym, vel, o = {}) => { const v = block(sym, bOpts({ lo: 58, hi: 76, n: 3, top: [67, 76], ...o })); state.brassV = v; push("brass", abs, dur, v, vel); };
      const stringsAt = (abs, dur, sym, vel) => { const v = block(sym, { lo: 55, hi: 74, n: 4, prev: state.strV, top: [66, 74], rng: r }); state.strV = v; push("strings", abs, dur, v, vel); };

      if (kind === "riff" || kind === "intro2") {
        for (let bar = (kind === "intro2" ? 4 : 0); bar < 8; bar++) {
          const B = bar * BPB, sym = symAt(B);
          if (kind === "intro2") { if (bar === 4) brassAt(B, 15.5, sym, 0.42); continue; }
          if (bar % 4 === 3 || (plan.outro && bar >= 6)) { brassAt(B, plan.outro && bar === 7 ? 3.6 : 3.4, sym, 0.55); continue; }
          brassAt(B, 1.2, sym, 0.6); brassAt(B + 1.5, 0.4, sym, 0.5); brassAt(B + 2.5, 1.2, symAt(B + 2.5), 0.55);
        }
        if (kind === "riff") spans.forEach((s) => stringsAt(s.start, s.dur - 0.1, s.sym, 0.38));
      } else if (kind === "verse") {
        if (v2) [3, 7].forEach((bar) => { const B = bar * BPB; brassAt(B + 2, 0.45, symAt(B + 2), 0.5); brassAt(B + 2.5, 1.3, symAt(B + 2.5), 0.52); });
        if (plan.mel === "VB") spans.forEach((s) => stringsAt(s.start, s.dur - 0.1, s.sym, 0.3));
      } else if (kind === "pre") {
        spans.forEach((s) => stringsAt(s.start, s.dur - 0.05, s.sym, 0.36 + s.start * 0.004));
        spans.filter((s) => s.start >= 16).forEach((s) => brassAt(s.start, s.dur - 0.1, s.sym, 0.42 + (s.start - 16) * 0.012));
      } else if (kind === "chorus") {
        // the pad gets out of the way of the band's pushes on 4-and
        spans.forEach((s, i) => stringsAt(s.start, s.dur - (i < spans.length - 1 ? 0.6 : 0.05), s.sym, 0.4));
        for (let bar = 0; bar < 8; bar++) {
          const B = bar * BPB, sym = symAt(B);
          if (bar % 4 === 3) brassAt(B, 3.6, sym, 0.5, plan.last ? { n: 4, hi: 79 } : {});
          else if (bar % 2 === 1) { brassAt(B, 1.3, sym, 0.52, plan.last ? { n: 4, hi: 79 } : {}); }
          else if (plan.last) brassAt(B, 1.3, sym, 0.48, { n: 4, hi: 79 });
        }
      } else if (kind === "solo") {
        spans.forEach((s, i) => stringsAt(s.start, s.dur - (i < spans.length - 1 ? 0.6 : 0.05), s.sym, 0.36));
        [3, 7].forEach((bar) => brassAt(bar * BPB, 3.6, symAt(bar * BPB), 0.46));
      } else if (kind === "break") {
        spans.forEach((s) => stringsAt(s.start, s.dur - 0.05, s.sym, s.start < 16 ? 0.3 : 0.4));
        spans.filter((s) => s.start >= 16).forEach((s) => brassAt(s.start, s.dur - 0.1, s.sym, 0.42 + (s.start - 16) * 0.015));
      }

      // ================= bass: FM bass eighths =================
      let bl = state.bassLast ?? 38;
      const rootNote = (sym) => { const c = T.chord(sym); return T.nearest(bl, [c.bass], 35, 46); };
      for (let b = 0; b < 32; b += 0.5) {
        const sym = symAt(b), inBar = b % BPB, bar = Math.floor(b / BPB);
        const cs = chordStartsAt(b);
        let n = rootNote(sym);
        if (kind === "break" && bar < 4) { if (inBar === 0) push("bass", b, 3.7, n, 0.72); bl = n; continue; }
        if (kind === "intro2" && bar < 2 && inBar >= 2) continue; // let the drums speak first
        let vel = inBar === 0 ? 0.8 : inBar % 1 ? 0.6 : 0.7;
        // the last eighth of a bar walks into the next chord (a step or the fifth below)
        const nextB = b + 0.5, nextSym = nextB < 32 ? symAt(nextB) : nextFirstSym;
        const lastOfBar = inBar === 3.5;
        if (lastOfBar && nextSym !== sym) {
          const target = T.nearest(n, [T.chord(nextSym).bass], 35, 46);
          if ((kind === "chorus" || kind === "solo") && bar < 7) n = target; // the whole band pushes the change
          else if (kind !== "verse" || plan.mel === "VB") {
            // walk through a tone of the current chord that sits next to the target (never a chromatic rub)
            const c = T.chord(sym);
            const walk = T.notesIn(c.pcs, 33, 47).filter((m) => m !== target && Math.abs(m - target) <= 4 && mod12(m) !== c.root);
            n = walk.length && r.chance(0.75) ? r.pick(walk) : n;
          }
        } else if (kind === "chorus" || kind === "riff" || kind === "solo") {
          if (inBar === 1.5 || (inBar === 3 && r.chance(0.5))) n += 12; // octave pops
        } else if (kind === "pre" && bar >= 6 && inBar % 1) n += 12;
        if (cs && inBar === 0) vel += 0.05;
        push("bass", b, 0.42, n, vel);
        bl = mod12(n) === mod12(rootNote(sym)) ? rootNote(sym) : bl;
      }
      if (plan.outro) { ev.splice(0, ev.length, ...ev.filter((e) => !(e.track === "bass" && e.bar >= 7))); [36, 36, 36, 36, 33, 35, 36, 37].forEach((m, i) => push("bass", 28 + i * 0.5, 0.42, m, 0.7 + i * 0.02)); } // C ... A B C C# -> D
      state.bassLast = bl;

      // ================= drums =================
      const hit = (abs, voice, vel, x = {}) => push("drums", abs, 0.25, voice, vel, x);
      const snare = (abs, vel, gate = 0.3) => hit(abs, "gatedSnare", vel, { gate });
      const big = kind === "chorus" || kind === "riff" || kind === "solo" || (kind === "break");
      const fillBar = (bar, style) => {
        const B = bar * BPB, f = FILLS[style % FILLS.length];
        f.forEach(([b, p], i) => { if (p === "snare") snare(B + b, 0.6 + i * 0.04, 0.2); else hit(B + b, "simmons", 0.55 + i * 0.06, { pitch: p + k }); });
        return f[0][0];
      };
      const sectionChange = next.kind !== plan.kind || next.prog !== plan.prog || next.k !== plan.k;
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        let fillFrom = 4;
        const preBuild = kind === "pre" && bar >= 6;
        const breakHalf = kind === "break" && bar < 4, breakBuild = kind === "break" && bar >= 4;
        if (bar === 7 && sectionChange && kind !== "pre" && kind !== "break") fillFrom = fillBar(bar, r.int(0, 3));
        else if (bar === 3 && big && r.chance(0.35)) { hit(B + 3.5, "simmons", 0.5, { pitch: SIM_MID + k }); hit(B + 3.75, "simmons", 0.55, { pitch: SIM_LO + k }); fillFrom = 3.5; }
        // crash on arrivals
        if (bar === 0 && (prev ? prev.kind !== plan.kind || prev.k !== plan.k || kind === "chorus" : true) && kind !== "verse" && kind !== "intro2") hit(B, "crash", 0.62);
        if (bar === 0 && kind === "verse" && !plan.v2 && plan.mel === "VA") hit(B, "crash", 0.5);
        if (bar === 4 && (kind === "chorus" || kind === "solo")) hit(B, "crash", 0.5);
        if (kind === "intro2" && bar === 4) hit(B, "crash", 0.6);

        if (breakHalf) { // half-time: kick, snare on 3 with a long gate, tribal Simmons toms on the offbeats
          hit(B, "kick909", 0.8); hit(B + 2.5, "kick909", 0.55);
          snare(B + 2, 0.72, 0.42);
          [[0.5, SIM_LO], [1.5, SIM_MID], [3, SIM_FLOOR], [3.5, SIM_LO]].forEach(([b, p]) => { if (bar < 3 || b < 3.5) hit(B + b, "simmons", 0.42, { pitch: p + k }); });
          hit(B + 1, "hatPedal", 0.35); hit(B + 3, "hatPedal", 0.35);
          if (bar === 3) { hit(B + 3.5, "simmons", 0.55, { pitch: SIM_HI + k }); hit(B + 3.75, "simmons", 0.6, { pitch: SIM_MID + k }); }
          continue;
        }
        if (preBuild || breakBuild) { // four on the floor, snare roll building eighths -> sixteenths
          const roll = kind === "pre" ? (bar === 6 ? 0.5 : 0.25) : (bar < 6 ? 0.5 : 0.25);
          const rel = kind === "pre" ? bar - 6 : (bar - 4) / 2;
          for (let b = 0; b < 4; b++) hit(B + b, "kick909", 0.78);
          const end = bar === 7 ? 3 : 4;
          for (let b = 0; b < end; b += roll) hit(B + b, "rockSnare", 0.32 + rel * 0.22 + (b / 4) * 0.22);
          if (bar === 7) [[3, SIM_HI], [3.25, SIM_MID], [3.5, SIM_LO], [3.75, SIM_FLOOR]].forEach(([b, p], i) => hit(B + b, "simmons", 0.62 + i * 0.07, { pitch: p + k }));
          if (bar === 4 && kind === "break") hit(B, "crash", 0.55);
          continue;
        }
        if (kind === "pre" && bar < 6) { // the lift: half-time first, then four on the floor
          if (bar < 4) {
            hit(B, "kick909", 0.8); hit(B + 2.5, "kick909", 0.6);
            snare(B + 2, 0.74, 0.4);
            for (let b = 0; b < 4; b++) hit(B + b, "hatClosed", b % 2 ? 0.34 : 0.44);
            if (bar === 3) { hit(B + 3, "simmons", 0.5, { pitch: SIM_MID }); hit(B + 3.5, "simmons", 0.55, { pitch: SIM_LO }); }
          } else {
            for (let b = 0; b < 4; b++) hit(B + b, "kick909", 0.78);
            [1, 3].forEach((b) => snare(B + b, 0.74, 0.3));
            for (let b = 0; b < 4; b += 0.5) hit(B + b, b % 1 ? "hatOpen" : "hatClosed", b % 1 ? 0.24 : 0.42);
          }
          continue;
        }
        if (kind === "intro2" && bar < 2) { // drums alone: kick, snare, hats
          [0, 2, 2.5].forEach((b) => hit(B + b, "kick909", 0.8));
          [1, 3].forEach((b) => snare(B + b, 0.7));
          for (let b = 0; b < 4; b += 0.5) hit(B + b, "hatClosed", b % 1 ? 0.3 : 0.45);
          continue;
        }

        // the groove
        const kicks = big ? (bar % 2 ? [0, 2, 2.5] : [0, 1.5, 2]) : (bar % 4 === 3 ? [0, 2, 2.5, 3.5] : [0, 2, 2.5]);
        kicks.forEach((b) => { if (b < fillFrom) hit(B + b, "kick909", b === 0 ? 0.85 : 0.72); });
        [1, 3].forEach((b) => {
          if (b >= fillFrom) return;
          snare(B + b, big ? 0.82 : 0.7, big ? 0.34 : 0.26);
          if (kind === "chorus" || (kind === "riff" && plan.round + bar > 0)) hit(B + b, "clap", 0.42);
        });
        // ghost on the snare between backbeats, verses only
        if (!big && r.chance(0.3) && fillFrom > 3.75) hit(B + r.pick([1.75, 3.75]), "rockSnare", 0.16);
        for (let b = 0; b < 4; b += 0.5) {
          if (b >= fillFrom) break;
          const openHat = b === 3.5 && (bar % 2 === 1 || big) && fillFrom === 4;
          if (openHat) hit(B + b, "hatOpen", 0.32);
          else hit(B + b, "hatClosed", (b % 1 ? 0.28 : 0.44) + (b === 0 ? 0.06 : 0) + (big ? 0.04 : 0));
        }
        // tambourine eighths: second verse, choruses, the solo
        if ((kind === "verse" && v2) || kind === "chorus" || kind === "solo" || (plan.outro && bar < 7)) {
          for (let b = 0; b < Math.min(4, fillFrom); b += 0.5) hit(B + b, "tambourine", b === 1 || b === 3 ? 0.42 : b % 1 ? 0.3 : 0.22);
        }
      }
      if (plan.outro) { // last bar: band hits on 1 and 3, a tom run back into the top
        const filtered = ev.filter((e) => !(e.track === "drums" && e.bar === 7));
        ev.length = 0; ev.push(...filtered);
        hit(28, "crash", 0.65); hit(28, "kick909", 0.85); snare(28, 0.8, 0.38);
        hit(30, "kick909", 0.8); snare(30, 0.8, 0.38);
        [[31, SIM_HI], [31.25, SIM_MID], [31.5, SIM_LO], [31.75, SIM_FLOOR]].forEach(([b, p], i) => hit(b, "simmons", 0.6 + i * 0.06, { pitch: p }));
      }

      return { events: ev, harmony: prog, section: plan.label, state };
    },
  });
})();
