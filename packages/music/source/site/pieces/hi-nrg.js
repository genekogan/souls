// Pulse Club: early-80s Hi-NRG (the San Francisco / New York sound) at 130 BPM in A minor.
//
// The engine is the bass: an analog saw galloping in 16ths between the kicks, the octave always on the
// offbeat. Over it: a 909 four-on-the-floor, claps on 2 and 4, 808 hats, Simmons tom rolls and a crash
// into each section, a square-wave sequencer arp low in the mix, string machine and supersaw chords,
// Fairlight orchestra hits, and a minor-key mono-synth hook that leaps a fourth on the downbeat.
//
// One "night" is sixteen 8-bar phrases (about four minutes):
//   intro · verse · verse · pre · chorus · chorus · breakdown (bass and claps) · build (filter sweep) ·
//   chorus · chorus · bridge (Neapolitan Bbmaj7 → E7, cowbell, orch-hit dialogue) · pivot pre (G → A) ·
//   chorus ×2 up a whole step in B minor (the octave double joins) · tag (ad-lib) · drop
// The drop ends on Gmaj7, which is VII of A minor, so the next night's intro falls home naturally.
// Harmony is i–VI–III–VII in the chorus, a tonic pedal in the verse, a rising iv–v–VI–VII pre.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- harmony (written in A minor; lifted sections are transposed) ----------
  const FORM = {
    intro: "| Am | Am | Am | Am | Am | Fmaj7 | G | E7sus4 E7 |",
    verse: "| Am | Am | Fmaj7 | G | Am | Am | Dm7 | E7sus4 E7 |",
    pre: "| Dm9 | Em7 | Fmaj7 | G | Dm9 | Em7 | Fmaj7 | Gsus4 G |",
    pivot: "| Dm9 | Em7 | Fmaj7 | G | Dm9 | Em7 | Fmaj7 | G A |",
    chorus: "| Am | Fmaj7 | C | G | Am | Fmaj7 | Dm7 | E7sus4 E7 |",
    chorus2: "| Am | Fmaj7 | C | G | Am | Fmaj7 | Dm7 | G |",
    brk: "| Am | Am | Am | Am | Fmaj7 | Fmaj7 | G | E7sus4 E7 |",
    build: "| Am | Fmaj7 | C | G | Am | Fmaj7 | Dm7 | E7sus4 E7 |",
    bridge: "| Fmaj7 | Dm7 | Bbmaj7 | C | Fmaj7 | Dm7 | Bbmaj7 | E7sus4 E7 |",
    tag: "| Am | Am | Fmaj7 | G | Am | Am | Fmaj7 | G |",
    drop: "| Am | Am | Am | Am | Fmaj7 | Fmaj7 | Fmaj7 | Fmaj7 |",
  };

  // ---------- the night: 16 phrases ----------
  const PLAN = [
    { sec: "intro", key: 0, d: "Intro" },
    { sec: "verse", key: 0, lead: "verse", d: "Verse" },
    { sec: "verse", key: 0, lead: "verse2", d: "Verse 2" },
    { sec: "pre", key: 0, d: "Pre-chorus · strings climb" },
    { sec: "chorus", key: 0, lead: "hook", d: "Chorus · the hook" },
    { sec: "chorus2", key: 0, lead: "hook2", d: "Chorus" },
    { sec: "brk", key: 0, d: "Breakdown · bass and claps" },
    { sec: "build", key: 0, lead: "tease", d: "Build · filter opening" },
    { sec: "chorus", key: 0, lead: "hook", d: "Chorus · the hook" },
    { sec: "chorus2", key: 0, lead: "hook2", d: "Chorus" },
    { sec: "bridge", key: 0, lead: "bridge", d: "Bridge · Neapolitan, cowbell" },
    { sec: "pivot", key: 0, d: "Pre-chorus · pivot up" },
    { sec: "chorus", key: 2, lead: "hook", d: "Chorus · up a step, B minor" },
    { sec: "chorus", key: 2, lead: "hook", dbl: 1, d: "Chorus · B minor, doubled" },
    { sec: "tag", key: 2, lead: "adlib", d: "Tag · ad-lib" },
    { sec: "drop", key: 2, d: "Drop · drums and bass" },
  ];

  // ---------- tunes (A minor) [bar, beat, dur, note] ----------
  const HOOK_HEAD = [
    [0, 0, 0.75, "E5"], [0, 0.75, 0.75, "A5"], [0, 1.5, 0.5, "G5"], [0, 2, 0.5, "E5"], [0, 2.5, 1.4, "C5"],
    [1, 0.5, 0.5, "C5"], [1, 1, 0.5, "D5"], [1, 1.5, 2.4, "E5"], // the major 7th of Fmaj7, held
    [2, 0, 0.75, "E5"], [2, 0.75, 0.75, "G5"], [2, 1.5, 0.5, "F5"], [2, 2, 0.5, "E5"], [2, 2.5, 1.4, "C5"],
    [3, 0.5, 0.5, "B4"], [3, 1, 0.5, "C5"], [3, 1.5, 2.4, "D5"],
    [4, 0, 0.75, "E5"], [4, 0.75, 0.75, "A5"], [4, 1.5, 0.5, "G5"], [4, 2, 0.5, "E5"], [4, 2.5, 1.4, "C5"],
    [5, 0.5, 0.5, "C5"], [5, 1, 0.5, "E5"], [5, 1.5, 0.5, "G5"], [5, 2, 2, "A5"], // climbs to the peak
  ];
  const HOOK_TAIL = [ // Dm7 | E7sus4 E7: falls through the 9th, leading tone, pickup back into the hook
    [6, 0.5, 0.5, "G5"], [6, 1, 0.5, "F5"], [6, 1.5, 0.5, "E5"], [6, 2, 1, "F5"], [6, 3, 1, "D5"],
    [7, 0, 1.5, "E5"], [7, 2, 0.5, "D5"], [7, 2.5, 0.5, "B4"], [7, 3, 0.5, "G#4"], [7, 3.5, 0.5, "B4"],
  ];
  const HOOK_TAIL2 = [ // Dm7 | G: comes to rest on the 5th of VII, open-ended
    [6, 0.5, 0.5, "G5"], [6, 1, 0.5, "F5"], [6, 1.5, 0.5, "E5"], [6, 2, 1, "F5"], [6, 3, 1, "E5"],
    [7, 0, 3.4, "D5"],
  ];
  const VERSE_A = [
    [0, 0.5, 0.5, "A4"], [0, 1, 0.5, "C5"], [0, 1.5, 0.5, "C5"], [0, 2, 0.5, "B4"], [0, 2.5, 1, "C5"], [0, 3.5, 0.5, "D5"],
    [1, 0, 2, "E5"], [1, 2.5, 0.5, "D5"], [1, 3, 1, "C5"],
    [2, 0.5, 0.5, "A4"], [2, 1, 0.5, "C5"], [2, 1.5, 0.5, "C5"], [2, 2, 0.5, "A4"], [2, 2.5, 1, "C5"], [2, 3.5, 0.5, "E5"],
    [3, 0, 2, "D5"], [3, 2.5, 0.5, "B4"], [3, 3, 1, "G4"],
    [4, 0.5, 0.5, "A4"], [4, 1, 0.5, "C5"], [4, 1.5, 0.5, "C5"], [4, 2, 0.5, "B4"], [4, 2.5, 1, "C5"], [4, 3.5, 0.5, "D5"],
  ];
  const VERSE_T1 = [
    [5, 0, 1, "E5"], [5, 1, 0.5, "G5"], [5, 1.5, 1.5, "E5"], [5, 3, 0.5, "D5"], [5, 3.5, 0.5, "C5"],
    [6, 0, 1, "F5"], [6, 1, 0.5, "E5"], [6, 1.5, 0.5, "D5"], [6, 2, 1, "C5"], [6, 3, 1, "A4"],
    [7, 0, 1.5, "B4"], [7, 2, 0.5, "B4"], [7, 2.5, 0.5, "D5"], [7, 3, 1, "G#4"],
  ];
  const VERSE_T2 = [ // second verse reaches a third higher and hangs on the sus
    [5, 0, 1, "E5"], [5, 1, 0.5, "A5"], [5, 1.5, 1.5, "G5"], [5, 3, 0.5, "E5"], [5, 3.5, 0.5, "D5"],
    [6, 0, 1.5, "F5"], [6, 1.5, 0.5, "E5"], [6, 2, 0.5, "D5"], [6, 2.5, 1.5, "A4"],
    [7, 0, 2, "B4"], [7, 2, 1.8, "G#4"],
  ];
  const BRIDGE = [ // long tones over the Neapolitan turn; the orchestra hits answer in the gaps
    [0, 0, 2.75, "A5"], [0, 3, 0.5, "G5"], [0, 3.5, 0.5, "A5"],
    [1, 0, 2, "F5"], [1, 2, 1, "E5"], [1, 3, 1, "D5"],
    [2, 0, 2.75, "D5"], [2, 3, 0.5, "C5"], [2, 3.5, 0.5, "D5"],
    [3, 0, 2, "E5"], [3, 2, 1, "G5"], [3, 3, 1, "C6"],
    [4, 0, 2.75, "A5"], [4, 3, 0.5, "G5"], [4, 3.5, 0.5, "A5"],
    [5, 0, 2, "C6"], [5, 2, 1, "A5"], [5, 3, 1, "F5"],
    [6, 0, 2, "F5"], [6, 2, 1, "D5"], [6, 3, 1, "Bb4"],
    [7, 0, 2, "A4"], [7, 2, 1.8, "G#4"],
  ];
  // the hook's first bar as a C.line motif, so the ad-lib quotes it
  const HOOK_MOTIF = { len: 4, rhythm: [{ off: 0, dur: 0.75 }, { off: 0.75, dur: 0.75 }, { off: 1.5, dur: 0.5 }, { off: 2, dur: 0.5 }, { off: 2.5, dur: 1.4 }], steps: [0, 3, -1.2, -1.9, -2.5] };

  // ---------- sequencer arp patterns (indices into root-3rd-5th-octave), 16 steps ----------
  const ARPS = [
    [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
    [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 3, 1],
    [0, 3, 1, 3, 2, 3, 1, 3, 0, 3, 1, 3, 2, 3, 1, 3],
    [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1],
  ];
  const ARP_VEL = [0.5, 0.3, 0.4, 0.32];

  // ---------- spelling & transposition ----------
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const nm = (pc, k) => (k === 2 ? SHARP : T.NAMES)[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k, k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k, k));
  }
  const progCache = new Map();
  function prog(sec, k) {
    const key = sec + "|" + k;
    if (!progCache.has(key)) progCache.set(key, T.progression(FORM[sec]).map((h) => ({ ...h, chord: tsym(h.chord, k) })));
    return progCache.get(key);
  }
  const keyName = (k) => (k === 2 ? "B minor" : "A minor");

  /** Close chords in the mid register; reject seconds below G3 and semitones between adjacent voices. */
  const rough = (v) => v.some((m, i) => i > 0 && (m - v[i - 1] === 1 || (v[i - 1] < 55 && m - v[i - 1] <= 2)));
  function voiceClean(sym, opts) {
    const tries = [opts, { ...opts, spread: "close" }, { ...opts, lo: opts.lo + 2 }, { ...opts, n: 3 }, { ...opts, n: 3, spread: "close" }];
    let first = null;
    for (const o of tries) { const v = T.voice(sym, o); first = first || v; if (!rough(v)) return v; }
    // every try rubs: hang a voicing from a chord tone near the preferred top instead
    const ref = opts.top ? Math.round((opts.top[0] + opts.top[1]) / 2) : first[first.length - 1];
    for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      if (!T.chord(sym).pcs.includes(mod12(ref + d))) continue;
      const v = topVoicing(sym, ref + d, opts.n ?? 4);
      if (v.length >= 3 && !rough(v)) return v;
    }
    return first;
  }
  const num = (x, d) => (Number.isFinite(x) ? x : d);
  /** Voicing hung from a chosen top note: chord tones stacked downward, no semitones, nothing close below G3. */
  function topVoicing(sym, target, n = 4) {
    const c = T.chord(sym);
    const fifth = c.intervals.find((i) => i >= 6 && i <= 8);
    const pref = [c.root].concat(c.guide, fifth != null ? [mod12(c.root + fifth)] : [], c.colors);
    const top = T.nearest(target, c.pcs, target - 2, target + 2);
    const out = [top];
    let cur = top;
    while (out.length < n) {
      let pick = null, best = Infinity;
      for (let m = cur - 2; m >= cur - 9; m--) {
        const rank = pref.indexOf(mod12(m));
        if (rank < 0 || cur - m === 1 || out.some((x) => mod12(x) === mod12(m)) || (m < 55 && cur - m <= 2)) continue;
        const sc = rank + (cur - m) * 0.25;
        if (sc < best) { best = sc; pick = m; }
      }
      if (pick == null) break;
      out.push(pick); cur = pick;
    }
    return out.sort((a, b) => a - b);
  }
  /** Root-position-friendly triad for the arp: root, 3rd (or the sus note), 5th. */
  function triadOf(c) {
    const third = c.intervals.includes(3) ? 3 : c.intervals.includes(4) ? 4 : c.intervals.includes(17) ? 5 : 2;
    const fifth = c.intervals.find((i) => i >= 6 && i <= 8) ?? 7;
    return [c.root, mod12(c.root + third), mod12(c.root + fifth)];
  }
  const PRE_TOPS = [69, 71, 72, 74, 72, 74, 76, 77];

  Sim.register({
    id: "hi-nrg",
    title: "Pulse Club",
    genre: "Hi-NRG",
    about: "Early-80s Hi-NRG at 130 in A minor: a galloping octave saw bass between 909 kicks, claps and Simmons rolls, sequencer arps, string machine and supersaw sweeps, orchestra hits, and a minor-key synth hook that breaks down to bass and claps and comes back a whole step higher.",
    bpm: 130, beatsPerBar: 4, swing: 0.5, cycleBars: 8, gainDb: 0,
    situations: ["party", "training"],
    energy: 0.9,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.6, preDelay: 0.02, lowcut: 350, highcut: 7000 });
      const room = I.reverb(ctx, out, { decay: 1.2, preDelay: 0.008, lowcut: 400, highcut: 8000 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.3, pingPong: true, highcut: 3600 });

      const lead = I.lead(ctx, { volume: -1, wave: "fatsawtooth", detune: 14, base: 900, octaves: 2.6, glide: 0.025, vibratoDepth: 0.06, vibratoDelay: 0.3, release: 0.16 });
      const lead2 = I.lead(ctx, { volume: -10, wave: "fatsquare", detune: 8, base: 700, octaves: 2.2, glide: 0.02, vibratoDepth: 0.04, release: 0.14 });
      const bass = I.analog(ctx, { volume: -4, wave: "sawtooth", resonance: 2.4, base: 210, octaves: 3.1, decay: 0.16, sustain: 0.22, release: 0.05, filterDecay: 0.11 });
      const arp = I.pluck(ctx, { volume: -13, wave: "square", cutoff: 700, decay: 0.16, filterDecay: 0.09, octaves: 3, resonance: 3 });
      const strings = I.stringMachine(ctx, { volume: -9, attack: 0.3, release: 0.9 });
      const saw = I.supersaw(ctx, { volume: -11, cutoff: 3600, attack: 0.04, release: 0.5, detune: 30 });
      const orch = I.orchHit(ctx, { volume: -7 });
      const kit = I.kit(ctx, { volume: -1, preload: ["kick909", "clap", "snare808", "hat808", "hat808Open", "crash", "simmons", "tambourine", "cowbell"] });

      const lp = I.place(ctx, lead, 0.06, out), l2 = I.place(ctx, lead2, -0.12, out);
      I.place(ctx, bass, 0, out);
      const ap = I.place(ctx, arp, 0.38, out), sp = I.place(ctx, strings, -0.2, out), wp = I.place(ctx, saw, 0.12, out);
      const op = I.place(ctx, orch, -0.05, out), kp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -13); I.send(ctx, lp, echo, -15); I.send(ctx, l2, hall, -14);
      I.send(ctx, ap, echo, -12); I.send(ctx, sp, hall, -9); I.send(ctx, wp, hall, -11);
      I.send(ctx, op, hall, -8); I.send(ctx, kp, room, -18);

      // supersaw filter: each chord event carries from/to cutoffs (a static value when equal)
      const sawClock = I.monotonic(saw.filter);
      const playSaw = (t, e, d) => {
        const tt = sawClock(t), a = Math.max(120, num(e.from, 3600)), b = Math.max(120, num(e.to, a));
        const f = saw.filter.frequency;
        f.cancelScheduledValues(tt);
        f.setValueAtTime(a, tt);
        if (Math.abs(b - a) > 1) f.exponentialRampToValueAtTime(b, tt + Math.max(0.05, d));
        saw.play(tt, e.note, d, e.vel);
      };
      const melo = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        lead: { layer: "melody", play: melo(lead), humanize: { timing: 0.004, vel: 0.04 } },
        lead2: { layer: "melody", play: melo(lead2), humanize: { timing: 0.004, vel: 0.04 } },
        arp: { layer: "texture", play: melo(arp), humanize: { timing: 0.002, vel: 0.05 } },
        strings: { layer: "harmony", play: melo(strings), humanize: { timing: 0.006, vel: 0.03 } },
        saw: { layer: "harmony", play: playSaw, humanize: { timing: 0, vel: 0.03 } },
        orch: { layer: "harmony", play: melo(orch), humanize: { timing: 0.002, vel: 0.04 } },
        bass: { layer: "bass", play: melo(bass), humanize: { timing: 0.002, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.gate }), humanize: { timing: 0.002, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const idx = cycle % 16, round = Math.floor(cycle / 16);
      const plan = PLAN[idx], nextPlan = PLAN[(idx + 1) % 16];
      const sec = plan.sec, k = plan.key;
      const harmony = prog(sec, k);
      const chordAt = T.chordAtFactory(harmony);
      const sym = (b) => chordAt(b).chord;
      const nextFirst = prog(nextPlan.sec, nextPlan.key)[0].chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const isChorus = sec === "chorus" || sec === "chorus2";
      if (idx === 0 || state.arpPat == null) state.arpPat = (round + (state.arpSeed ?? (state.arpSeed = r.int(0, 3)))) % ARPS.length;

      // ---------- which layers play in each bar ----------
      // kick, clap, hats ("16" | "open" | "8" | null), tamb, cowbell, bass mode, arp, pad ("str" | "saw" | "both" | null)
      const L = [];
      for (let bar = 0; bar < 8; bar++) {
        const x = { kick: true, clap: true, hats: "16", tamb: null, cow: false, bass: "gallop", arp: true, pad: "str", fill: null, crash: false };
        switch (sec) {
          case "intro":
            if (round === 0) {
              x.clap = bar >= 2; x.arp = bar >= 4; x.pad = bar >= 4 ? "str" : null; x.hats = bar < 2 ? "8" : "16";
            } else { x.pad = bar >= 2 ? "str" : null; }
            if (bar === 4) x.crash = true;
            if (bar === 7) x.fill = "toms";
            break;
          case "verse":
            x.bass = round % 2 ? "full" : "gallop";
            if (bar === 0) x.crash = true;
            if (bar === 7) x.fill = plan.lead === "verse2" ? "toms" : "flick";
            break;
          case "pre": case "pivot":
            x.hats = "open"; x.pad = bar < 4 ? "str" : "both"; x.bass = bar >= 6 ? "full" : "gallop";
            if (bar === 0) x.crash = true;
            if (bar === 6) x.fill = "roll8";
            if (bar === 7) x.fill = "rollToms";
            break;
          case "chorus": case "chorus2":
            x.hats = "open"; x.tamb = plan.dbl ? "16" : "8"; x.pad = "saw"; x.bass = "full";
            if (bar === 0 || (bar === 4 && plan.key)) x.crash = true;
            if (bar === 7) x.fill = sec === "chorus2" ? "bigToms" : r.chance(0.5) ? "toms" : "flick";
            break;
          case "brk":
            x.kick = false; x.hats = bar >= 6 ? "8" : null; x.arp = bar >= 4; x.pad = bar >= 4 ? "saw" : null;
            x.bass = "full";
            if (bar === 7) x.fill = "roll16";
            break;
          case "build":
            x.hats = bar < 4 ? "16" : "open"; x.pad = "saw"; x.tamb = bar >= 4 ? "8" : null;
            if (bar === 0) x.crash = true;
            if (bar === 6) x.fill = "roll8";
            if (bar === 7) x.fill = "rollToms";
            break;
          case "bridge":
            x.cow = true; x.hats = "16"; x.bass = "full"; x.pad = "str";
            if (bar === 0) x.crash = true;
            if (bar === 7) x.fill = "toms";
            break;
          case "tag":
            x.hats = "open"; x.tamb = "8"; x.pad = "both"; x.bass = "full";
            if (bar === 0) x.crash = true;
            if (bar === 7) x.fill = "bigToms";
            break;
          case "drop":
            x.arp = bar >= 2; x.pad = bar >= 4 ? "str" : null; x.hats = bar < 4 ? "16" : "open"; x.cow = bar >= 4;
            if (bar === 0) x.crash = true;
            if (bar === 7) x.fill = "toms";
            break;
        }
        L.push(x);
      }

      // ---------- lead ----------
      const melody = [];
      const toMidi = (n) => (typeof n === "number" ? n : T.midi(n)) + k;
      const addTune = (src, shift = 0) => src.forEach(([b, x, d, n]) => melody.push({ at: b * 4 + x, dur: d, note: toMidi(n) + shift }));
      switch (plan.lead) {
        case "verse": addTune(VERSE_A.concat(VERSE_T1)); break;
        case "verse2": addTune(VERSE_A.concat(VERSE_T2)); break;
        case "hook": addTune(HOOK_HEAD.concat(HOOK_TAIL)); break;
        case "hook2": addTune(HOOK_HEAD.concat(HOOK_TAIL2)); break;
        case "bridge": addTune(BRIDGE); break;
        case "tease": addTune(HOOK_HEAD.filter(([b]) => b === 0 || b === 1 || b === 4 || b === 5), -12); break;
        case "adlib": {
          const m = C.line({ start: 0, end: 28, chordAt: sym, lo: 69 + k, hi: 84 + k, rng: r.fork(11), density: 0.42, phrase: [4, 7], rest: [1, 2], motif: state.adlibMotif || HOOK_MOTIF, motifProb: 0.7, chromatic: 0.1, register: 0.55, prev: state.leadLast ?? 76 + k, upbeatStart: 0.3 });
          state.adlibMotif = m.motif;
          m.notes.forEach((n) => melody.push({ at: n.beat, dur: n.dur, note: n.note }));
          break;
        }
      }
      // later nights ornament the hook's long notes with a 16th upper-neighbour turn
      if (round > 0 && (plan.lead === "hook" || plan.lead === "hook2")) {
        for (let i = melody.length - 1; i >= 0; i--) {
          const n = melody[i];
          if (n.dur < 1.4 || !r.chance(0.35)) continue;
          const up = T.step(n.note, 1, T.chord(sym(n.at + n.dur - 0.5)).scale);
          if (up - n.note > 2) continue;
          melody.splice(i, 1, { at: n.at, dur: n.dur - 0.5, note: n.note }, { at: n.at + n.dur - 0.5, dur: 0.25, note: up }, { at: n.at + n.dur - 0.25, dur: 0.25, note: n.note });
        }
      }
      melody.sort((a, b) => a.at - b.at);
      const leadVel = plan.lead === "tease" ? 0.52 : plan.lead === "verse" || plan.lead === "verse2" ? 0.68 : 0.76;
      melody.forEach((n, i) => {
        const nx = melody[i + 1];
        const dur = Math.max(0.1, Math.min(n.dur, nx ? nx.at - n.at - 0.02 : 31.95 - n.at));
        const onBeat = Math.abs(n.at - Math.round(n.at)) < 1e-6;
        const vel = leadVel + (n.dur >= 1 ? 0.04 : 0) + (onBeat ? 0.03 : -0.02) + r.gauss(0.02);
        push("lead", n.at, dur, n.note, vel);
        if (plan.dbl) push("lead2", n.at, dur, n.note - 12, vel * 0.9);
      });
      if (melody.length) state.leadLast = melody[melody.length - 1].note;
      const melOnset = (b, before, after) => melody.some((n) => n.at > b - before && n.at < b + after);

      // ---------- pads: string machine and supersaw ----------
      harmony.forEach((h, hi) => {
        const bar = h.bar, x = L[bar];
        if (!x.pad) return;
        const s0 = bar * 4 + h.beat;
        if (x.pad === "str" || x.pad === "both") {
          // in the pre-chorus the top voice climbs A B C D, then C D E G, while the bass rises underneath
          const climb = sec === "pre" || sec === "pivot";
          const v = climb ? topVoicing(h.chord, PRE_TOPS[bar] + k, 4) : voiceClean(h.chord, { lo: 57 + k, hi: 74 + k, n: 4, rootless: false, prev: state.sv, top: [65 + k, 72 + k], rng: r });
          state.sv = v;
          push("strings", s0, h.dur - 0.05, v, x.pad === "both" ? 0.4 : 0.46);
        }
        if (x.pad === "saw" || x.pad === "both") {
          const v = voiceClean(h.chord, { lo: 60, hi: 80, n: 4, rootless: false, prev: state.wv, top: [72, 78], rng: r });
          state.wv = v;
          // cutoff: sweeps through the build sections, steady in the choruses
          let from = 3400, to = 3400;
          const span = (a, b, lo, hi) => { const f = (t) => lo * Math.pow(hi / lo, Math.min(1, Math.max(0, (t - a) / (b - a)))); return [f(s0), f(s0 + h.dur)]; };
          if (sec === "build") [from, to] = span(0, 30, 380, 4800);
          else if (sec === "brk") [from, to] = span(16, 32, 250, 1600);
          else if (sec === "pre" || sec === "pivot" || sec === "tag") [from, to] = span(16, 32, 500, 4200);
          else if (plan.key) { from = to = 4200; }
          const vel = sec === "brk" ? 0.38 : isChorus ? 0.5 : 0.42;
          push("saw", s0, h.dur - 0.05, v, vel, { from, to });
        }
      });

      // ---------- orchestra hits ----------
      const orchAt = (abs, vel) => {
        const v = voiceClean(sym(abs), { lo: 60, hi: 75, n: 3, rootless: false, prev: state.ov, top: [67, 75], spread: "close" });
        state.ov = v;
        push("orch", abs, 0.5, v, vel);
      };
      if (isChorus || sec === "tag") {
        orchAt(0, 0.7);
        if (!melOnset(14.5, 0.1, 0.6)) orchAt(14.5, 0.55); // the "and" of 4 in bar 4, into the second half
        if (sec === "tag") [8, 16, 24].forEach((b) => orchAt(b, 0.58));
      } else if (sec === "bridge") {
        // dialogue: the hits answer the lead's long tones
        [[3, 0.6], [11, 0.55], [11.5, 0.6], [19, 0.6], [27, 0.55], [27.5, 0.62]].forEach(([b, v]) => { if (!melOnset(b, 0.05, 0.3)) orchAt(b, v); });
      } else if (sec === "brk") {
        orchAt(0, 0.62); orchAt(8, 0.5);
      } else if (sec === "intro" && L[4].crash) {
        orchAt(16, 0.62);
      } else if (sec === "drop") {
        orchAt(0, 0.66); orchAt(6.5, 0.5); orchAt(8, 0.58);
      } else if (sec === "verse" && plan.lead === "verse") {
        orchAt(0, 0.6);
      }

      // ---------- sequencer arp ----------
      const pat = sec === "bridge" ? ARPS[(state.arpPat + 2) % ARPS.length] : ARPS[state.arpPat];
      for (let bar = 0; bar < 8; bar++) {
        if (!L[bar].arp) continue;
        for (let s = 0; s < 16; s++) {
          const abs = bar * 4 + s / 4;
          const c = T.chord(sym(abs));
          const tones = T.notesIn(triadOf(c), 57 + k, 70 + k).slice(0, 3);
          tones.push(tones[0] + 12);
          const quiet = isChorus ? 0.82 : sec === "brk" ? 0.75 : 1;
          push("arp", abs, 0.2, tones[pat[s] % tones.length], ARP_VEL[s % 4] * quiet);
        }
      }

      // ---------- bass: the octave gallop ----------
      let low = state.bassLow ?? 33 + k;
      const lowOf = (pc, ref) => T.nearest(ref, [pc], 31, 43);
      for (let bar = 0; bar < 8; bar++) {
        const mode = L[bar].bass;
        for (let beat = 0; beat < 4; beat++) {
          const abs = bar * 4 + beat;
          const c = T.chord(sym(abs));
          low = lowOf(c.bass, low);
          const nextB = abs + 1;
          const nextSym = nextB < 32 ? sym(nextB) : nextFirst;
          const changing = nextSym !== sym(abs) && T.chord(nextSym).bass !== c.bass;
          const nextLow = lowOf(T.chord(nextSym).bass, low);
          const cells = mode === "full" ? [[0, "L", 0.72], [0.25, "L", 0.55], [0.5, "H", 0.86], [0.75, "L", 0.58]] : [[0.25, "L", 0.6], [0.5, "H", 0.84], [0.75, "L", 0.6]];
          for (const [o, role, v] of cells) {
            let n = role === "H" ? low + 12 : low;
            if (o === 0.75 && changing && (bar === 7 && beat === 3 ? true : r.chance(0.6))) n = nextLow; // the change lands a 16th early
            push("bass", abs + o, 0.2, n, v);
          }
        }
      }
      state.bassLow = low;

      // ---------- drums ----------
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel), extra);
      for (let bar = 0; bar < 8; bar++) {
        const x = L[bar], B = bar * 4;
        const fill = x.fill;
        const cut = fill === "toms" ? 3 : fill === "bigToms" ? 2 : fill === "rollToms" ? 3 : 4; // groove stops where the toms take over
        if (x.crash) D(B, "crash", isChorus ? 0.62 : 0.5);
        for (let beat = 0; beat < 4; beat++) {
          const b = B + beat;
          if (x.kick && (beat < cut || fill === "rollToms" || fill === "toms")) D(b, "kick909", beat === 0 ? 0.95 : 0.88);
          if (x.clap && beat % 2 === 1 && beat < cut) { D(b, "clap", 0.78); D(b, "snare808", 0.4); }
        }
        // hats
        if (x.hats) {
          for (let s = 0; s < 16; s++) {
            const p = s / 4;
            if (p >= cut) break;
            const q = s % 4;
            if (x.hats === "8" && q % 2) continue;
            if (x.hats === "open" && q === 2) { D(B + p, "hat808Open", 0.36, { gate: 0.18 }); continue; }
            const v = x.hats === "8" ? (q === 0 ? 0.36 : 0.46) : [0.4, 0.2, 0.34, 0.22][q];
            D(B + p, "hat808", v + r.range(-0.03, 0.03));
          }
        }
        if (x.tamb) for (let s = 0; s < 16; s++) {
          const p = s / 4; if (p >= cut) break;
          if (x.tamb === "8" && s % 4 !== 2) continue; // offbeat 8ths, or 16ths with the offbeat leaning
          D(B + p, "tambourine", s % 4 === 2 ? 0.42 : s % 2 ? 0.2 : 0.26);
        }
        if (x.cow) [0.5, 1.5, 2.5, 3.5].filter((p) => p < cut).forEach((p, i) => D(B + p, "cowbell", i % 2 ? 0.34 : 0.42));
        if (x.clap && !fill && r.chance(0.22)) D(B + 3.75, "snare808", 0.24); // a ghost pickup into the next bar
        // fills
        if (fill === "flick") { D(B + 3.5, "snare808", 0.42); D(B + 3.75, "snare808", 0.56); }
        else if (fill === "toms") [[3, 64], [3.25, 61], [3.5, 56], [3.75, 52]].forEach(([p, pt], i) => D(B + p, "simmons", 0.62 + i * 0.06, { pitch: pt }));
        else if (fill === "bigToms") [[2, 67], [2.25, 67], [2.5, 62], [2.75, 62], [3, 57], [3.25, 57], [3.5, 52], [3.75, 48]].forEach(([p, pt], i) => D(B + p, "simmons", 0.55 + i * 0.05, { pitch: pt }));
        else if (fill === "roll8") for (let s = 0; s < 8; s++) D(B + s / 2, "snare808", 0.28 + s * 0.04);
        else if (fill === "roll16") for (let s = 0; s < 16; s++) D(B + s / 4, "snare808", 0.2 + s * 0.04);
        else if (fill === "rollToms") {
          for (let s = 0; s < 12; s++) D(B + s / 4, "snare808", 0.42 + s * 0.035);
          [[3, 62], [3.25, 57], [3.5, 52], [3.75, 47]].forEach(([p, pt], i) => D(B + p, "simmons", 0.72 + i * 0.05, { pitch: pt }));
        }
      }

      const label = `${plan.d}${plan.key ? "" : round > 0 && idx === 0 ? " · again" : ""}`;
      return { events: ev, harmony, section: `${label} · ${keyName(k)}`, state };
    },
  });
})();
