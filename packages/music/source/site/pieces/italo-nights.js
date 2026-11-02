// Italo Nights: 1983 Italo disco at 120 BPM, neon and wistful.
//
// Key plan: the verse sits in B minor (Bm7 Gmaj7 Em7 F#m7, turning on a harmonic-minor F#). The
// chorus re-harmonizes the same hook a diatonic third up, in the relative major (D Bm G A), so the
// melancholy tune suddenly sounds bright. The breakdown swaps the last F# for A -> B major, the
// dominant of E, and the last two choruses lift a whole step into E major; the final bar's F#7 is
// both V/V in E and V in B minor, so the round folds back home through an arpeggiator interlude.
//
// Call and response is the identity: a square-wave lead states a two-bar hook, a vocoder-like choir
// answers in parallel triads. Underneath: an octave-bouncing 8th-note synth bass, a 16th-note pluck
// arpeggio whose lowpass sweeps open and shut with the form, and a Solina-style string machine.
// Drums are an 808/LinnDrum kit: four-on-the-floor kick, snare and handclaps on 2 and 4, 16th hats
// with accents, a two-bar 808 cowbell figure, tambourine and open hats in the chorus, Syndrum "pew"
// accents, a snare roll and noise riser into the chorus, and a Simmons tom fill out of the breakdown.
//
// Round (cycles of 8 bars, ~2.4 min; the intro plays once):
//   intro -> verse 1 -> verse 2 (+cowbell) -> pre-chorus (rising bass, filter sweep, roll) ->
//   chorus (D) -> chorus (glock doubles) -> breakdown (drums out, Simmons fill) ->
//   chorus in E -> chorus in E (turns to F#7) -> interlude (arp feature, lead solo) -> repeat.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4;

  // ---------- harmony ----------
  const PROG_TEXT = {
    VERSE: "| Bm7 | Gmaj7 | Em7 | F#m7 | Bm7 | Gmaj7 | Em7 | F# |",
    PRE: "| G | A | F#m7 | Bm | Em7 | F#m7 | G | Asus4:2 A:2 |",
    CHORUS: "| D | Bm | G | A | D | Bm | G | Asus4:2 A:2 |",
    BREAK: "| Bm7 | Gmaj7 | Em7 | F#m7 | Bm7 | Gmaj7 | A | B |",
    CHORUS_E: "| E | C#m | A | B | E | C#m | A | Bsus4:2 B:2 |",
    CHORUS_E_OUT: "| E | C#m | A | B | E | C#m | A | F#7 |",
  };
  const PROGS = Object.fromEntries(Object.entries(PROG_TEXT).map(([k, v]) => [k, T.progression(v, BPB)]));

  // ---------- melody notation: one string per bar, "note/beats", r = rest ----------
  function bars(list, startBar = 0) {
    const out = [];
    list.forEach((s, i) => {
      let b = 0;
      for (const tok of s.trim().split(/\s+/)) {
        const [n, d] = tok.split("/");
        const dur = Number(d);
        if (!(dur > 0)) throw new Error(`italo-nights: bad duration in "${tok}"`);
        if (n !== "r") out.push({ beat: (startBar + i) * BPB + b, dur, note: T.midi(n) });
        b += dur;
      }
      if (Math.abs(b - BPB) > 1e-6) throw new Error(`italo-nights: bar sums to ${b}: ${s}`);
    });
    return out;
  }

  // The hook (lead), written in B minor. Every strong note is a tone of both the verse chord and the
  // chorus chord a third above it (Bm7/D, Gmaj7/Bm, Em7/G, F#m7/A), so it survives re-harmonization.
  const CALL1 = bars(["r/0.5 F#5/0.5 F#5/0.5 E5/0.5 F#5/1 A5/1", "D5/1.5 E5/0.5 D5/1 B4/1"], 0);
  const CALL2 = bars(["r/0.5 F#5/0.5 F#5/0.5 E5/0.5 F#5/0.5 E5/0.5 D5/1", "B4/1.5 A4/0.5 B4/1 D5/1"], 4);
  // The vocoder's answers (choir), a fourth or so below.
  const ANS1 = bars(["r/0.5 B4/0.5 B4/0.5 A4/0.5 G4/1.5 B4/0.5", "A4/1.5 C#5/0.5 A4/2"], 2);
  const ANS2 = bars(["r/0.5 D5/0.5 D5/0.5 E5/0.5 D5/1 B4/1"], 6);
  // Last bar of the answer: up the dominant arpeggio (F# A# C#), or in the chorus the same rhythm
  // rising to the major third (E A C# over A, transposed to the bar's root).
  const END_DOM = bars(["F#4/1.5 A#4/0.5 C#5/2"], 7);
  const END_MAJ = bars(["E4/1.5 A4/0.5 C#5/2"], 7);
  // Pre-chorus: the vocoder takes a long-breathed rising line over the climbing bass.
  const PRE_MEL = bars(["D5/2 B4/2", "C#5/2 E5/2", "F#5/3 E5/1", "D5/4", "E5/2 D5/1 B4/1", "C#5/2 A4/2", "B4/2 D5/2", "E5/4"], 0);

  // ---------- arpeggio shapes: indices into the chord-tone ladder, 16 steps ----------
  const ARP_PATS = [
    [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 2],
    [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 3],
    [0, 0, 3, 0, 1, 0, 4, 0, 2, 0, 3, 0, 5, 0, 4, 2], // pedal arpeggio, Moroder style
  ];

  // ---------- form ----------
  const SECTIONS = {
    intro: { prog: "VERSE", kind: "intro", dyn: 0.9, cut: [260, 2200], label: "Intro · LinnDrum, octave bass, the arpeggiator opens" },
    verse1: { prog: "VERSE", kind: "verse", n: 1, dyn: 0.95, cut: [1300, 1600], label: "Verse 1 · square-wave hook, vocoder answers" },
    verse2: { prog: "VERSE", kind: "verse", n: 2, dyn: 1, cut: [1600, 2100], label: "Verse 2 · 808 cowbell and string machine" },
    pre: { prog: "PRE", kind: "pre", dyn: 1, cut: [1100, 6000], label: "Pre-chorus · rising bass, filter sweep, snare roll" },
    chorus1: { prog: "CHORUS", kind: "chorus", n: 1, tr: 0, dyn: 1.05, cut: [3200, 3000], label: "Chorus · the hook in D major" },
    chorus2: { prog: "CHORUS", kind: "chorus", n: 2, tr: 0, dyn: 1.05, cut: [3000, 2400], label: "Chorus · glockenspiel doubles the hook" },
    brk: { prog: "BREAK", kind: "break", dyn: 0.9, cut: [330, 5200], label: "Breakdown · strings and vocoder, Simmons fill" },
    chorusE1: { prog: "CHORUS_E", kind: "chorus", n: 3, tr: 2, dyn: 1.1, cut: [3600, 3300], label: "Last chorus · up a step to E major" },
    chorusE2: { prog: "CHORUS_E_OUT", kind: "chorus", n: 4, tr: 2, dyn: 1.1, cut: [3300, 2600], label: "Last chorus · E major, turning back to B minor" },
    solo: { prog: "VERSE", kind: "solo", dyn: 1, cut: [2400, 5200], label: "Interlude · arpeggiator feature, lead solo" },
  };
  const ROUND = ["verse1", "verse2", "pre", "chorus1", "chorus2", "brk", "chorusE1", "chorusE2", "solo"];
  function planAt(cycle) {
    if (cycle === 0) return { id: "intro", round: 0, ...SECTIONS.intro };
    const k = cycle - 1, round = Math.floor(k / ROUND.length), id = ROUND[k % ROUND.length];
    return { id, round, ...SECTIONS[id] };
  }

  // ---------- drums ----------
  const KICK = 30; // the 808 kick settles on F#1, the fifth of the home key
  const COW = [[[0.5, 0.44], [1.5, 0.3], [2.5, 0.4], [3.25, 0.3]], [[0.75, 0.32], [1.5, 0.4], [2.5, 0.3], [3.5, 0.42]]];
  /** One bar of Italo drum machine. f: { kick, snare, clap, hat, hatV, open, cowbell, tamb, crash, pew, fill }. */
  function drumBar(push, bar, f) {
    const B = bar * BPB;
    const hit = (b, voice, vel, x = {}) => push("drums", B + b, 0.25, voice, vel, x);
    const fillAt = { simmons: 2, simmonsBar: 0, roll: 4, snare: 3, snare8: 4, stop: 3 }[f.fill] ?? 4;
    if (f.kick) for (let q = 0; q < 4; q++) if (q < fillAt || f.fill === "roll" || f.fill === "snare8" || f.fill === "simmons" || f.fill === "snare") hit(q, "kick808", (q === 0 ? 0.92 : 0.84) * f.kick, { pitch: KICK });
    [1, 3].forEach((q) => {
      if (q >= fillAt) return;
      if (f.snare) hit(q, "snare808", 0.58 * f.snare);
      if (f.clap) hit(q, "clap", 0.6 * f.clap);
    });
    if (f.hat) {
      for (let i = 0; i < 16; i++) {
        const b = i * 0.25;
        if (b >= fillAt) break;
        if (f.open && i % 4 === 2) continue; // the open hat chokes the closed one
        if (f.hat === 8 && i % 2) continue;
        hit(b, "hat808", [0.46, 0.2, 0.34, 0.24][i % 4] * (f.hatV ?? 1));
      }
    }
    if (f.open) [0.5, 1.5, 2.5, 3.5].forEach((b) => { if (b < fillAt) hit(b, "hat808Open", 0.32 * f.open, { hd: 0.2 }); });
    if (f.cowbell) COW[bar % 2].forEach(([b, v]) => { if (b < fillAt) hit(b, "cowbell", v * f.cowbell); });
    if (f.tamb === 16) for (let i = 0; i < 16; i++) hit(i * 0.25, "tambourine", (i % 2 ? 0.16 : 0.26) * (0.6 + 0.4 * i / 15));
    else if (f.tamb) { [1, 3].forEach((q) => { if (q < fillAt) hit(q, "tambourine", 0.42 * f.tamb); }); [0.5, 2.5].forEach((b) => { if (b < fillAt) hit(b, "tambourine", 0.2 * f.tamb); }); }
    if (f.crash) hit(0, "crash", 0.52 * f.crash);
    if (f.pew) hit(3.5, "simmons", 0.4, { pitch: 64 });
    if (f.fill === "simmons") [69, 69, 64, 64, 59, 59, 55, 52].forEach((p, i) => hit(2 + i * 0.25, "simmons", 0.38 + i * 0.05, { pitch: p }));
    if (f.fill === "simmonsBar") {
      const P = [71, 71, 67, 67, 64, 64, 60, 60, 57, 57, 53, 53, 50, 50, 47, 45];
      P.forEach((p, i) => hit(i * 0.25, "simmons", 0.3 + 0.36 * i / 15 + (i % 2 ? 0 : 0.06), { pitch: p }));
    }
    if (f.fill === "roll") for (let i = 0; i < 16; i++) hit(i * 0.25, "snare808", 0.18 + 0.5 * i / 15);
    if (f.fill === "snare8") for (let i = 0; i < 8; i++) hit(i * 0.5, "snare808", 0.24 + 0.2 * i / 7);
    if (f.fill === "snare") [3, 3.25, 3.5, 3.75].forEach((b, i) => { hit(b, "snare808", 0.4 + i * 0.08); if (i === 0) hit(b, "clap", 0.5); });
    if (f.fill === "stop") hit(3, "clap", 0.66);
  }

  // ---------- a noise sweep (risers into choruses, whooshes after the crash) ----------
  function noiseSweep(ctx) {
    const env = ctx.keep(new Tone.Gain(0));
    const bp = ctx.keep(new Tone.Filter({ frequency: 800, type: "bandpass", Q: 1.8 })).connect(env);
    ctx.keep(new Tone.Noise({ type: "white" }).start()).connect(bp);
    const level = Math.pow(10, -19 / 20);
    const fin = (x, d) => (Number.isFinite(x) && x > 40 ? Math.min(x, 12000) : d);
    return {
      out: env,
      play(t, e, d) {
        const f0 = fin(e.f0, 400), f1 = fin(e.f1, 4000), v = Math.max(0, Math.min(1, e.vel || 0)) * level, len = Math.max(0.1, d);
        env.gain.cancelAndHoldAtTime(t); bp.frequency.cancelAndHoldAtTime(t);
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(f1, t + len);
        env.gain.setValueAtTime(e.up ? 0 : v, t);
        if (e.up) { env.gain.linearRampToValueAtTime(v, t + len * 0.96); env.gain.linearRampToValueAtTime(0, t + len + 0.04); }
        else env.gain.linearRampToValueAtTime(0, t + len);
      },
    };
  }

  Sim.register({
    id: "italo-nights",
    title: "Italo Nights",
    genre: "Italo disco",
    about: "1983 Italo disco in B minor: a square-wave hook answered by a vocoder choir, octave-bouncing synth bass, 808 cowbell and handclaps, a sweeping arpeggiator, and a chorus that re-harmonizes the same hook in the relative major before lifting a step to E.",
    situations: ["party", "romance"],
    energy: 0.75,
    bpm: 120, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 300, highcut: 7000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.008, lowcut: 350, highcut: 8000 });
      const echo = I.delay(ctx, out, { pingPong: true, time: "8n.", feedback: 0.32, highcut: 3800 });

      const lead = I.lead(ctx, { volume: -1, wave: "fatsquare", detune: 7, glide: 0.035, base: 850, octaves: 2.4, resonance: 1.2, sustain: 0.7, release: 0.18, vibrato: 5.6, vibratoDepth: 0.06, vibratoDelay: 0.3 });
      const choir = I.choir(ctx, { volume: -6, vowel: "o", attack: 0.05, release: 0.45 });
      const strings = I.stringMachine(ctx, { volume: -9, cutoff: 2800, attack: 0.28, release: 1.0 });
      const arp = I.pluck(ctx, { volume: -8, wave: "sawtooth", cutoff: 600, octaves: 3, decay: 0.2, filterDecay: 0.14, resonance: 2.5, release: 0.12 });
      const arpLp = ctx.keep(new Tone.Filter({ frequency: 1200, type: "lowpass", rolloff: -24, Q: 3.5 }));
      arp.out.connect(arpLp);
      const bass = I.analog(ctx, { volume: -4, wave: "sawtooth", resonance: 3, base: 170, octaves: 2.7, attack: 0.003, decay: 0.14, sustain: 0.35, release: 0.08, filterDecay: 0.12 });
      const glock = I.glock(ctx, { volume: -14, decay: 1.6 });
      const kit = I.kit(ctx, { volume: -1, boom: 0.42, preload: ["kick808", "snare808", "clap", "hat808", "hat808Open", "cowbell", "tambourine", "crash", "simmons"] });
      const sweep = noiseSweep(ctx);

      const lp = I.place(ctx, lead, 0.05, out), cp = I.place(ctx, choir, -0.22, out), sp = I.place(ctx, strings, 0.2, out);
      const ap = I.place(ctx, { out: arpLp }, -0.35, out), gp = I.place(ctx, glock, 0.4, out), kp = I.place(ctx, kit, 0, out);
      I.place(ctx, bass, 0, out);
      const wp = I.place(ctx, sweep, 0.1, out);
      I.send(ctx, lp, echo, -11); I.send(ctx, lp, hall, -15);
      I.send(ctx, cp, hall, -8); I.send(ctx, cp, echo, -20); I.send(ctx, sp, hall, -10);
      I.send(ctx, ap, echo, -14); I.send(ctx, ap, hall, -18);
      I.send(ctx, gp, hall, -8); I.send(ctx, gp, echo, -12);
      I.send(ctx, kp, room, -15); I.send(ctx, wp, hall, -6);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        lead: { layer: "melody", play: pl(lead), humanize: { timing: 0.004, vel: 0.04 } },
        choir: { layer: "melody", play: pl(choir), humanize: { timing: 0.006, vel: 0.04 } },
        glock: { layer: "melody", play: pl(glock), humanize: { timing: 0.004, vel: 0.06 } },
        strings: { layer: "harmony", play: pl(strings), humanize: { timing: 0.01, vel: 0.03 } },
        arp: {
          layer: "texture", humanize: { timing: 0.002, vel: 0.04 },
          play: (t, e, d) => {
            if (Number.isFinite(e.cut)) arpLp.frequency.linearRampToValueAtTime(Math.max(150, Math.min(9000, e.cut)), t);
            arp.play(t, e.note, d, e.vel);
          },
        },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.003, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.hd }), humanize: { timing: 0.003, vel: 0.06 } },
        sweep: { layer: "texture", play: (t, e, d) => sweep.play(t, e, d), humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const prog = PROGS[plan.prog];
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(b).chord;
      const spans = prog.map((h) => ({ sym: h.chord, start: h.bar * BPB + h.beat, dur: h.dur }));
      const nextFirst = PROGS[next.prog][0].chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const kind = plan.kind, D = plan.dyn;
      if (state.round !== plan.round) { state.round = plan.round; state.arpPat = plan.round === 0 ? 0 : (state.arpPat + 1 + r.int(0, 1)) % ARP_PATS.length; }

      // ================= melody helpers =================
      /** Fit a written note to the bar it lands in: strong or long notes become chord tones, others stay in the chord scale. */
      const fit = (n) => {
        const c = T.chord(symAt(n.beat)), pc = mod12(n.note);
        const strong = Math.abs(n.beat - Math.round(n.beat)) < 1e-6 || n.dur >= 1;
        if (strong && !c.pcs.includes(pc)) return T.nearest(n.note, c.pcs);
        if (!strong && !c.scale.includes(pc) && !c.pcs.includes(pc)) return T.nearest(n.note, c.scale);
        return n.note;
      };
      const accent = (n) => {
        const inBar = n.beat % BPB, onBeat = Math.abs(inBar - Math.round(inBar)) < 1e-6;
        return (inBar === 0 ? 0.78 : onBeat ? 0.72 : 0.64) + (n.dur >= 1 ? 0.03 : 0);
      };
      /**
       * Vocoder voicing: a chord tone gets two chord tones under it (close, no seconds); a passing note
       * moves alone over whatever lower voices it can keep from the previous chord (oblique motion).
       */
      let lastVoc = null;
      const vocode = (note, beat) => {
        const c = T.chord(symAt(beat));
        const core = c.intervals.filter((iv) => iv < 12).map((iv) => mod12(c.root + iv));
        let v;
        if (!core.includes(mod12(note))) {
          v = [note];
          (lastVoc || []).slice(0, -1).forEach((m) => { if (m < note && note - m >= 3 && c.scale.concat(c.pcs).includes(mod12(m))) v.push(m); });
        } else {
          v = [note];
          for (const m of T.notesIn(core, note - 9, note - 3).reverse()) { if (v.length >= 3) break; if (v.every((x) => Math.abs(x - m) >= 3)) v.push(m); }
        }
        v.sort((a, b) => a - b);
        lastVoc = v;
        return v.length > 1 ? v : note;
      };
      const tr = plan.tr || 0;
      const leadNotes = (list, shift = 0) => list.map((n) => ({ beat: n.beat, dur: n.dur, note: n.note + tr + shift })).map((n) => ({ ...n, note: fit(n) }));
      /** The answer's last bar, chosen for the chord it lands on. */
      const ending = () => {
        const c = T.chord(symAt(7 * BPB));
        if (c.root === 6) return END_DOM.map((n) => ({ ...n })); // F#: the dominant arpeggio
        const off = ((mod12(c.root - 9) + 5) % 12) - 5; // END_MAJ is written over A
        return END_MAJ.map((n) => ({ ...n, note: n.note + off }));
      };
      const sing = (list, vel, durMul = 1) => list.forEach((n) => {
        const note = fit(n);
        push("choir", n.beat, n.dur * durMul, vocode(note, n.beat), vel * (n.dur >= 1.5 ? 1.05 : 1));
      });
      const playLead = (list, velMul, glock) => list.forEach((n) => {
        push("lead", n.beat, n.dur * 0.94, n.note, accent(n) * velMul);
        if (glock) push("glock", n.beat, Math.max(0.5, n.dur), n.note + 12, (n.beat % BPB === 0 ? 0.36 : 0.3));
      });

      // ================= melody =================
      if (kind === "verse" && plan.n === 1 && plan.round % 2 === 1) {
        // odd rounds: the roles swap, the vocoder sings the hook and the square lead answers
        sing(CALL1, 0.48 * D);
        sing(CALL2, 0.48 * D);
        playLead(leadNotes(ANS1), 0.92 * D, false);
        playLead(leadNotes(ANS2), 0.92 * D, false);
        playLead(ending(), 0.92 * D, false);
      } else if (kind === "verse" || kind === "chorus") {
        const glock = kind === "chorus" && (plan.n === 2 || plan.n === 4);
        playLead(leadNotes(CALL1), D, glock);
        playLead(leadNotes(CALL2), D * 0.97, glock);
        const ansVel = (kind === "chorus" ? 0.56 : 0.5) * D;
        sing(ANS1.map((n) => ({ ...n, note: n.note + tr })), ansVel);
        sing(ANS2.map((n) => ({ ...n, note: n.note + tr })), ansVel);
        sing(ending(), ansVel * 1.05);
      } else if (kind === "intro") {
        sing(ANS2, 0.42); sing(ending(), 0.46); // the vocoder previews the answer
      } else if (kind === "pre") {
        sing(PRE_MEL, 0.5 * D);
      } else if (kind === "break") {
        // bars 1-4: the vocoder holds the harmony; bars 5-6: the hook, an octave down; 7-8: the answer
        spans.filter((s) => s.start < 16).forEach((s) => {
          const c = T.chord(s.sym), top = T.nearest(state.brkTop ?? 71, c.pcs, 66, 74);
          state.brkTop = top;
          push("choir", s.start, s.dur - 0.2, vocode(top, s.start), 0.36);
        });
        playLead(CALL1.map((n) => ({ beat: n.beat + 16, dur: n.dur, note: n.note - 12 })).map((n) => ({ ...n, note: fit(n) })), 0.8, false);
        sing(ANS2, 0.46); sing(ending(), 0.5);
      } else if (kind === "solo") {
        if (!state.soloMotif) {
          const rhythm = CALL1.map((n) => ({ off: n.beat, dur: n.dur }));
          state.soloMotif = { len: 8, rhythm, steps: CALL1.map((n, i) => (i ? Math.sign(n.note - CALL1[i - 1].note) * Math.min(4, Math.abs(n.note - CALL1[i - 1].note) / 1.6) : 0)) };
        }
        const m = C.line({ start: 0, end: 30, chordAt: symAt, lo: 66, hi: 84, rng: r.fork(11), density: 0.42, phrase: [4, 7], rest: [1, 2], motif: state.soloMotif, motifProb: 0.6, chromatic: 0.08, register: 0.6, prev: 78, lead: 0.5, upbeatStart: 0.5 });
        m.notes.forEach((n) => push("lead", n.beat, n.dur, n.note, (n.strong ? 0.74 : 0.64) * D));
        spans.filter((s) => s.start >= 16).forEach((s) => push("choir", s.start, s.dur - 0.2, vocode(T.nearest(state.brkTop ?? 69, T.chord(s.sym).pcs, 64, 71), s.start), 0.3));
      }

      // ================= string machine =================
      {
        const o = kind === "chorus" ? { lo: 55, hi: 76, n: 4, top: [70, 76], vel: 0.44 }
          : kind === "pre" ? { lo: 52, hi: 74, n: 4, top: [62, 70], vel: 0.4 }
          : kind === "break" ? { lo: 54, hi: 79, n: 4, top: [71, 78], vel: 0.42 }
          : kind === "verse" && plan.n === 2 ? { lo: 52, hi: 69, n: 4, top: [62, 69], vel: 0.38 }
          : { lo: 52, hi: 69, n: 3, top: [62, 69], vel: 0.34 };
        spans.forEach((s, si) => {
          if (kind === "intro" && s.start < 16) return;
          let top = o.top;
          if (kind === "pre") top = [o.top[0] + si * 0.6, o.top[1] + si * 0.6]; // the top voice climbs with the bass
          const fresh = si === 0 && (kind === "chorus" || kind === "break"); // a new section re-voices from the top
          let v = T.voice(s.sym, { lo: o.lo, hi: o.hi, n: o.n, prev: fresh ? null : state.strV, top, rng: r });
          state.strV = v;
          // a triad in the chorus or breakdown: double the top an octave down for a full section spread
          if ((kind === "chorus" || kind === "break") && v.length === 3 && v[2] - 12 >= 52 && v[2] - 12 < v[0]) v = [v[2] - 12, ...v];
          s.strV = v;
          const vel = o.vel * (kind === "pre" ? 0.85 + 0.25 * (s.start / 32) : 1);
          push("strings", s.start, s.dur - 0.06, v, vel);
        });
      }

      // ================= arpeggiator =================
      {
        const pat = ARP_PATS[state.arpPat || 0];
        const [c0, c1] = plan.cut;
        const ladderFor = (sym) => {
          const c = T.chord(sym);
          const core = c.intervals.filter((iv) => iv < 12).map((iv) => mod12(c.root + iv));
          return T.notesIn(core, 54, 84).slice(0, 7);
        };
        const feature = kind === "solo";
        for (let s = 0; s < 128; s++) {
          const b = s * 0.25;
          if (kind === "break" && b >= 28) break; // the Simmons fill has the last bar
          const lad = ladderFor(symAt(b));
          const note = lad[Math.min(pat[s % 16], lad.length - 1)] + (feature && s % 16 >= 12 && pat[s % 16] < 3 ? 12 : 0);
          const u = b / 32;
          const glob = cycle * 32 + b;
          const cut = Math.round(c0 * Math.pow(c1 / c0, u) * (1 + 0.15 * Math.sin((2 * Math.PI * glob) / 64)));
          const vel = (s % 4 === 0 ? 0.62 : s % 2 === 0 ? 0.48 : 0.4) * (feature ? 1.1 : 1) * (kind === "intro" && b < 8 ? 0.85 : 1);
          push("arp", b, 0.22, note, vel, { cut, straight: true });
        }
      }

      // ================= octave bass =================
      {
        let last = state.bassLast ?? 35;
        spans.forEach((s, si) => {
          const c = T.chord(s.sym);
          const root = T.nearest(last, [c.bass], 33, 45);
          const nextSym = si + 1 < spans.length ? spans[si + 1].sym : nextFirst;
          const nextC = T.chord(nextSym);
          for (let b = s.start; b < s.start + s.dur - 1e-6; b += 0.5) {
            const bar = Math.floor(b / BPB);
            if (kind === "intro" && bar < 2) continue;
            if (kind === "break") {
              if (bar >= 4 && bar <= 6 && b === s.start) push("bass", b, s.dur - 0.2, root, 0.56);
              continue;
            }
            const i = Math.round((b - s.start) * 2);
            let note = i % 2 ? root + 12 : root;
            const lastEighth = b + 0.5 >= s.start + s.dur - 1e-6;
            if (lastEighth && nextC.bass !== c.bass && r.chance(0.4)) { // push into the next chord, unless it rubs against the strings
              const nr = T.nearest(root, [nextC.bass], 33, 45), push8 = nr + 12 <= root + 17 ? nr + 12 : nr;
              if (!(s.strV || []).some((m) => Math.abs(m - push8) % 12 === 1 || Math.abs(m - push8) % 12 === 11)) note = push8;
            }
            const inBar = b % BPB;
            const vel = (inBar === 0 ? 0.88 : i % 2 ? 0.6 : 0.78) * (kind === "chorus" ? 1.04 : 1);
            push("bass", b, 0.4, note, vel);
          }
          last = root;
        });
        state.bassLast = last;
      }

      // ================= drums =================
      for (let b = 0; b < 8; b++) {
        let f = {};
        if (kind === "intro") f = { kick: 1, hat: 1, hatV: b < 2 ? 0.7 : 1, snare: b >= 4 ? 1 : 0, clap: b >= 4 ? 1 : 0, fill: b === 7 ? "snare" : null };
        else if (kind === "verse") f = { kick: 1, snare: 1, clap: 1, hat: plan.n === 1 ? 8 : 16, cowbell: plan.n === 2 ? 1 : 0, pew: b === 3 || (b === 7 && plan.n === 1), fill: b === 7 && plan.n === 2 ? "simmons" : null };
        else if (kind === "pre") f = { kick: 1, snare: b < 6 ? 1 : 0, clap: b < 6 ? 1 : 0, hat: 1, tamb: b >= 4 ? 16 : 0, fill: b === 6 ? "snare8" : b === 7 ? "roll" : null };
        else if (kind === "chorus") f = { kick: 1, snare: 1, clap: 1, hat: 1, hatV: 0.7, open: 1, cowbell: 1, tamb: 1, crash: b === 0 ? 1 : 0, fill: b === 7 ? (plan.n === 2 ? "stop" : plan.n === 4 ? "simmons" : "snare") : null };
        else if (kind === "break") f = b < 4 ? {} : b < 6 ? { clap: 0.8 } : b === 6 ? { clap: 1, hat: 1, hatV: 0.55 } : { fill: "simmonsBar" };
        else if (kind === "solo") f = { kick: 1, snare: 1, clap: 1, hat: 1, cowbell: 1, open: b >= 4 ? 0.8 : 0, crash: b === 0 ? 1 : 0, pew: b === 3, fill: b === 7 ? "simmons" : null };
        drumBar(push, b, f);
      }

      // ================= sweeps =================
      if (kind === "pre") push("sweep", 16, 16, "rise", 0.62, { f0: 300, f1: 7500, up: true });
      if (kind === "chorus" && (plan.n === 1 || plan.n === 3)) push("sweep", 0, 6, "whoosh", 0.5, { f0: 8000, f1: 260 });
      if (kind === "break") { push("sweep", 0, 8, "whoosh", 0.45, { f0: 6000, f1: 200 }); push("sweep", 16, 15, "rise", 0.5, { f0: 250, f1: 6500, up: true }); }
      if (kind === "intro") push("sweep", 20, 12, "rise", 0.32, { f0: 400, f1: 5000, up: true });

      const swap = kind === "verse" && plan.n === 1 && plan.round % 2 === 1;
      const label = `${swap ? "Verse 1 · the vocoder takes the hook, the lead answers" : plan.label}${plan.round > 0 ? ` · round ${plan.round + 1}` : ""}`;
      return { events: ev, harmony: prog, section: label, state };
    },
  });
})();
