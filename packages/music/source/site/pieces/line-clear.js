// Line Clear: falling-block puzzle music for a handheld console, four sound-chip channels and nothing else.
//
// The channels, as on the hardware: pulse 1 (the tune), pulse 2 (echo, chip-chord arpeggios, a
// countermelody or the plain tune under a variation), the wave channel (a triangle bass) and the noise
// channel (short bursts = hats, long = snare, longest = crash), plus a square-wave "kick" whose pitch dives
// like the pulse channel's hardware sweep (pitched higher, it plays the toms in fills). Each channel is
// monophonic, so chords only exist as arpeggios. Duty cycles change with the section: 25% for the tune,
// 50% (a round square) for the minuet and the plain tune, 12.5% (thin, nasal) for echoes and the
// level-up variation.
//
// Music: G harmonic minor, a folk-dance tune with a dotted hook (tonic, leading-tone neighbour, a broken
// chord down and back) that is sequenced up a fourth onto iv and down a third onto VI; i-iv-i-V and
// i-VI-V-i, a zig-zag of diminished fourths and augmented seconds over the dominant. B is a minuet in
// B-flat (the relative major) over a stepwise falling bass, with a trill on the dominant on its way home.
// The level-up variation divides the tune into running sixteenths (turns, broken chords, octave flips,
// scale runs) while pulse 2 plays the plain tune an octave down.
//
// A game (13 cycles of 8 bars, about 2.7 minutes): six levels of two cycles each, every level a few
// BPM faster (138 -> 176), every level ending in a "line clear" fanfare (an arpeggio sweep and a trill
// over a noise roll and sweep-toms), the last level lifted up a step (or a semitone, alternate games),
// then a game-over jingle that drops back to the starting tempo and a "new game" fanfare. Drums build
// across a game: polka oom-pah, a half-time minuet, sixteenth hats, a four-on-the-floor stomp, a frantic
// peak with ghost snares. Ornaments, divisions and fills are re-drawn every game, and alternate games
// swap some channel roles.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 4;
  const mod12 = T.mod12;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation: "G5/.75 F#5/.25 r/1 | ..." one bar per |, durations in beats ----------
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`line-clear: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`line-clear: bar ${bi + 1} has ${pos} beats: ${bar}`);
    });
    return out;
  }

  // ---------- the tunes ----------
  const A_HEAD = [
    "G5/.75 F#5/.25 G5/.5 D5/.5 Bb4/.5 D5/.5 G5/1", //         the hook
    "C6/.75 B5/.25 C6/.5 G5/.5 Eb5/.5 G5/.5 C6/1", //          sequenced up a fourth, onto iv
    "Bb5/.5 A5/.5 G5/.5 F#5/.5 G5/.5 A5/.5 Bb5/.5 G5/.5", //   running eighths
    "A5/.75 Bb5/.25 A5/.5 F#5/.5 D5/1 r/.5 D5/.5", //          half cadence, breath, pickup
  ];
  const A_TAIL = [
    "G5/.75 F#5/.25 G5/.5 D5/.5 Bb4/.5 D5/.5 G5/.5 A5/.5",
    "Bb5/.75 A5/.25 Bb5/.5 G5/.5 Eb5/.5 G5/.5 Bb5/1", //      the hook a third down, onto VI
    "C6/.5 A5/.5 Bb5/.5 F#5/.5 A5/.5 Eb5/.5 F#5/.5 D5/.5", //  zig-zag over the dominant
    "G5/1 D5/.5 Bb4/.5 G4/1 r/.5 D5/.5",
  ];
  const A2_TAIL = [
    "D6/.75 C6/.25 Bb5/.5 G5/.5 D5/.5 G5/.5 Bb5/.5 C6/.5", //  the hook turned downward from the top
    "Eb6/.75 D6/.25 Eb6/.5 Bb5/.5 G5/.5 Bb5/.5 Eb6/1", //      and sequenced on VI, an octave up
    A_TAIL[2],
    "G5/1 D5/.5 Bb4/.5 G4/1 r/.5 D5/.5",
  ];
  const SEC = {
    A: { harm: "| Gm | Cm | Gm | D7 | Gm | Eb | D7b9 | Gm |", mel: A_HEAD.concat(A_TAIL) },
    A2: { harm: "| Gm | Cm | Gm | D7 | Gm | Eb | D7b9 | Gm |", mel: A_HEAD.concat(A2_TAIL) },
    B1: {
      harm: "| Bb | F/A | Gm | Dm/F | Eb | Bb/D | Cm7 F7 | Bb |",
      mel: [
        "D6/1 Bb5/.5 C6/.5 D6/.5 Eb6/.5 D6/.5 C6/.5",
        "C6/1 A5/.5 Bb5/.5 C6/.5 D6/.5 C6/.5 Bb5/.5",
        "Bb5/1 G5/.5 A5/.5 Bb5/.5 C6/.5 Bb5/.5 A5/.5",
        "A5/1 F5/.5 G5/.5 A5/1 D5/1",
        "G5/.5 Bb5/.5 Eb6/1.5 D6/.25 C6/.25 Bb5/.5 G5/.5",
        "F5/.5 D5/.5 F5/.5 Bb5/1 A5/.25 G5/.25 F5/1",
        "G5/.5 C6/.5 Eb6/.5 D6/.25 C6/.25 A5/.25 Bb5/.25 A5/.25 G5/.25 F5/.5 A5/.5",
        "Bb5/1.5 F5/.5 D5/1 r/1",
      ],
    },
    B2: {
      harm: "| Eb | Cm7 | Am7b5 | D7 | Gm | Cm | D7 | Gm |",
      mel: [
        "G5/1 Bb5/.5 G5/.5 Eb5/.5 F5/.5 G5/.5 Bb5/.5",
        "C6/1 Eb6/.5 C6/.5 G5/.5 A5/.5 Bb5/.5 C6/.5",
        "C6/1 A5/.5 G5/.5 Eb5/.5 G5/.5 A5/.5 C6/.5",
        "A5/.25 Bb5/.25 A5/.25 Bb5/.25 A5/.5 F#5/.5 D5/.5 Eb5/.5 F#5/.5 A5/.5", // trill on the dominant
        "Bb5/1 G5/.5 Bb5/.5 D6/1.5 C6/.5",
        "Eb6/1 C6/.5 G5/.5 Eb5/.5 F5/.5 G5/.5 Eb5/.5",
        "F#5/.5 G5/.5 A5/.5 Bb5/.5 C6/.5 Bb5/.5 A5/.5 F#5/.5",
        "G5/2 D5/1 r/1",
      ],
    },
    // game over (bars 1-4) and new game (bars 5-8)
    OVER: {
      harm: "| Ebmaj7 | Am7b5 D7 | Gm | Gm | Gm | Cm D7 | Gm | D7 |",
      mel: [
        "D6/1.5 Bb5/.5 G5/1 D5/1",
        "C5/1 Eb5/1 D5/.5 C5/.5 A4/1",
        "Bb4/1 A4/.5 F#4/.5 G4/2",
        "r/4",
        "G4/.25 Bb4/.25 D5/.25 G5/.25 Bb5/.5 G5/.5 D6/1 r/1",
        "C6/.5 G5/.5 Eb5/.5 C6/.5 A5/.5 F#5/.5 D5/.5 A5/.5",
        "G5/1.5 D5/.5 G5/1 r/1",
        "r/3.5 D5/.5",
      ],
      bass: "Eb2/4 | A2/2 D2/2 | G2/4 | r/4 | G2/1 D3/1 G2/1 D3/1 | C3/1 G2/1 D2/1 A2/1 | G2/1 D3/1 G2/1 Bb2/1 | D2/1 F#2/1 A2/1 C3/1",
    },
  };
  // the "line clear" bar that replaces bar 8 at the end of every level (G minor)
  const FAN_LEAD = line("G5/.5 r/.5 Bb4/.25 D5/.25 G5/.25 Bb5/.25 D6/.25 G6/.25 F#6/.125 G6/.125 F#6/.125 G6/.125 G6/1");
  const FAN_P2 = line("D5/.5 r/.5 G4/.25 Bb4/.25 D5/.25 G5/.25 Bb5/.25 D6/.25 D6/.125 Eb6/.125 D6/.125 Eb6/.125 D6/1");
  for (const s of Object.values(SEC)) {
    s.prog = T.progression(s.harm, BPB);
    s.notes = line(s.mel.join(" | "));
    if (s.bass) s.bassNotes = line(s.bass);
  }
  const HM = T.scale(7, "harmonicMinor"); // G A Bb C D Eb F#

  function transSym(sym, k) {
    if (!k) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const tr = (n) => T.NAMES[mod12(T.PC[n] + k)];
    return tr(m[1]) + m[2] + (m[3] ? "/" + tr(m[3]) : "");
  }

  // ---------- the game ----------
  const LEVEL_BPM = [138, 138, 144, 150, 158, 166, 176]; // by level; 0 = game over
  const PLAN = [
    { lvl: 1, sec: "A", role: "pah", bass: "oompah", drums: "L1", duty: 25 },
    { lvl: 1, sec: "A2", role: "echo16", bass: "oompah", drums: "L1b", duty: 25, fanfare: true },
    { lvl: 2, sec: "B1", role: "counter", bass: "walk", drums: "half", duty: 50 },
    { lvl: 2, sec: "B2", role: "counter", bass: "walk", drums: "half+", duty: 50, fanfare: true },
    { lvl: 3, sec: "A", role: "arp16", bass: "octave", drums: "L3", duty: 25, orn: 0.35 },
    { lvl: 3, sec: "A2", role: "echo8", bass: "octave", drums: "L3", duty: 25, orn: 0.45, fanfare: true },
    { lvl: 4, sec: "A", divide: true, role: "plain", bass: "gallop", drums: "stomp", duty: 12 },
    { lvl: 4, sec: "A2", divide: true, role: "plain", bass: "gallop", drums: "stomp", duty: 12, fanfare: true },
    { lvl: 5, sec: "B1", role: "arp32", bass: "walk8", drums: "L3", duty: 25, orn: 0.3 },
    { lvl: 5, sec: "B2", role: "echo16", bass: "walk8", drums: "L3", duty: 25, orn: 0.5, fanfare: true },
    { lvl: 6, sec: "A", role: "arp32", bass: "gallop", drums: "frantic", duty: 25, orn: 0.5, peak: true },
    { lvl: 6, sec: "A2", divide: true, role: "plain", bass: "gallop", drums: "frantic", duty: 12, peak: true, fanfare: true },
    { lvl: 0, sec: "OVER" },
  ];
  // alternate games: some channel roles trade places
  const ALT = { 0: { role: "echo16" }, 1: { role: "pah" }, 2: { role: "echo16" }, 4: { role: "echo8" }, 5: { role: "arp16" }, 8: { role: "echo16", duty: 50 }, 9: { role: "arp32" } };
  const ROLE_NAME = { pah: "oom-pah chip chords", echo16: "echo channel", echo8: "eighth-note echo", counter: "countermelody", arp16: "rolling arpeggios", arp32: "chip-chord arpeggios", plain: "plain tune below" };

  // ---------- custom sound: the sweep kick (square wave diving in pitch, a little crushed) ----------
  function sweepKick(ctx, o = {}) {
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 15)));
    const crush = ctx.keep(new Tone.BitCrusher({ bits: 6 })).connect(out);
    const s = ctx.keep(new Tone.MembraneSynth({ oscillator: { type: "square" }, pitchDecay: 0.03, octaves: 3.2, envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.02 } })).connect(crush);
    const mono = ctx.I.monotonic(s);
    return { out, hit(time, vel, pitch = 36) { s.triggerAttackRelease(T.hz(Number.isFinite(pitch) ? pitch : 36), 0.07, mono(time), vel); } };
  }
  const NOISE_LEN = { hat: 0.028, ghost: 0.05, ohat: 0.11, roll: 0.045, snare: 0.17, crash: 0.3 };

  Sim.register({
    id: "line-clear",
    title: "Line Clear",
    genre: "Puzzle chiptune",
    about: "Falling-block puzzle music on four handheld sound-chip channels: a G-minor folk-dance tune with a minuet in B♭, echo-channel tricks, chip-chord arpeggios and a driving noise kit, faster every level up to a key-lifted frantic peak, then a game-over jingle and a fresh start.",
    situations: ["work", "training"],
    energy: 0.65,
    bpm: 138, beatsPerBar: BPB, swing: 0.5, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 0.9, preDelay: 0.01, lowcut: 300, highcut: 6000 });
      const mk = (o) => I.pulse(ctx, { release: 0.02, ...o });
      // pulse 1 (left of centre) and pulse 2 (right), one instrument per duty cycle
      const p1 = { 25: mk({ width: 0.5, volume: 0 }), 50: mk({ width: 0, volume: -2 }), 12: mk({ width: 0.75, volume: 0 }) };
      const p2 = { 25: mk({ width: 0.5, volume: -5 }), 50: mk({ width: 0, volume: -6 }), 12: mk({ width: 0.75, volume: -5 }) };
      const wave = I.pulse(ctx, { wave: "triangle", volume: 3, decay: 0.2, sustain: 0.8, release: 0.03 });
      const kit = I.kit(ctx, { volume: 1, preload: ["chipNoise"] });
      const kick = sweepKick(ctx, { volume: 0 });
      for (const v of Object.values(p1)) I.send(ctx, I.place(ctx, v, -0.3, out), room, -22);
      for (const v of Object.values(p2)) I.send(ctx, I.place(ctx, v, 0.35, out), room, -20);
      I.place(ctx, wave, 0, out);
      I.send(ctx, I.place(ctx, kit, 0.05, out), room, -26);
      kick.out.connect(out);
      const chip = { timing: 0.001, vel: 0.02 };
      return {
        lead: { layer: "melody", play: (t, e, d) => (p1[e.duty] || p1[25]).play(t, e.note, d, e.vel), humanize: chip },
        p2: { layer: "harmony", play: (t, e, d) => (p2[e.duty] || p2[12]).play(t, e.note, d, e.vel), humanize: chip },
        wave: { layer: "bass", play: (t, e, d) => wave.play(t, e.note, d, e.vel), humanize: chip },
        noise: { layer: "drums", play: (t, e) => kit.hit("chipNoise", t, e.vel, { dur: NOISE_LEN[e.note] ?? 0.03 }), humanize: { timing: 0.001, vel: 0.05 } },
        kick: { layer: "drums", play: (t, e) => kick.hit(t, e.vel, e.p), humanize: chip },
      };
    },

    compose({ cycle, rng: r, state }) {
      const g = Math.floor(cycle / PLAN.length), idx = cycle % PLAN.length;
      const alt = g % 2 === 1;
      const S = { ...PLAN[idx], ...(alt ? ALT[idx] || {} : {}) };
      const prevLvl = PLAN[(idx + PLAN.length - 1) % PLAN.length].lvl;
      const levelStart = S.lvl !== prevLvl;
      const shift = S.peak ? (alt ? 1 : 2) : 0;
      const sec = SEC[S.sec];
      const prog = sec.prog.map((h) => ({ ...h, chord: transSym(h.chord, shift) }));
      const chordAt = T.chordAtFactory(prog, BPB);
      const symAt = (b) => chordAt(b).chord;
      const key = HM.map((p) => mod12(p + shift));
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const p = C.at(abs, BPB);
        ev.push({ track, bar: p.bar, beat: +p.beat.toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      if (state.g !== g) { state.g = g; state.div = {}; }

      // ================= game over / new game =================
      if (S.sec === "OVER") {
        const strong = (b) => Math.abs(b - Math.round(b)) < 1e-6;
        sec.notes.forEach((n) => {
          push("lead", n.beat, n.dur * 0.92, n.note, n.beat < 16 ? 0.62 : strong(n.beat) ? 0.74 : 0.64, { duty: n.beat < 16 ? 50 : 25 });
          if (n.beat < 12) push("p2", n.beat + 0.5, n.dur * 0.8, n.note - 12, 0.32, { duty: 12 }); // a sagging echo an octave down
          else if (n.beat >= 16 && n.beat < 28 && n.dur >= 0.5) { // new game: a third or sixth below
            const c = T.chord(symAt(n.beat));
            const below = T.notesIn(c.pcs, n.note - 9, n.note - 3).filter((m) => [3, 4, 8, 9].includes(n.note - m));
            if (below.length) push("p2", n.beat, n.dur * 0.9, below[below.length - 1], 0.42, { duty: 25 });
          }
        });
        // the blocks pile up: a falling harmonic-minor run in thirty-seconds in the silent bar
        let m = 79;
        for (let i = 0; i < 16; i++) { push("p2", 12 + i * 0.125, 0.11, m, 0.36 - i * 0.012, { duty: 12 }); m = T.step(m, -1, HM); }
        sec.bassNotes.forEach((n) => push("wave", n.beat, n.dur * (n.dur >= 2 ? 0.97 : 0.85), n.note, 0.78));
        // drums: a thud for game over, then a count back in
        push("kick", 0, 0.1, "kick", 0.9, { p: 36 }); push("noise", 0, 0.5, "crash", 0.8);
        push("kick", 8, 0.1, "kick", 0.55, { p: 33 }); push("kick", 10, 0.1, "kick", 0.45, { p: 31 });
        for (let bar = 4; bar < 7; bar++) drumBar(bar, "L1", bar === 4);
        for (let i = 0; i < 16; i++) push("noise", 28 + i * 0.25, 0.1, i % 4 === 0 ? "snare" : "roll", 0.3 + i * 0.035);
        [[28, 36], [29, 36], [30, 36], [31, 48], [31.25, 45], [31.5, 41], [31.75, 38]].forEach(([b, p], i) => push("kick", b, 0.1, "kick", 0.6 + i * 0.04, { p }));
        state.bassPrev = 43;
        return { events: ev, harmony: prog, section: `Game over · new game · ${LEVEL_BPM[1]} BPM`, tempo: { bpm: LEVEL_BPM[1], rampBeats: 0 }, state };
      }

      // ================= pulse 1: the tune =================
      let tune = sec.notes.map((n) => ({ ...n, note: n.note + shift }));
      if (S.fanfare) tune = tune.filter((n) => n.beat < 28).concat(FAN_LEAD.map((n) => ({ ...n, beat: n.beat + 28, note: n.note + shift, fan: true })));
      const plain = tune;
      if (S.divide) {
        const k = `${S.sec}:${shift}`;
        if (!state.div[k]) state.div[k] = divide(tune, chordAt, key, r.fork(77 + idx));
        tune = state.div[k];
      }
      const leadEvents = [];
      const strongAt = (b) => Math.abs(b - Math.round(b)) < 1e-6;
      tune.forEach((n, i) => {
        const base = S.divide ? 0.66 : 0.64;
        const vel = base + (strongAt(n.beat) ? 0.08 : 0) + (n.dur === 0.75 ? 0.04 : 0) + (n.fan ? 0.06 : 0);
        const prev = tune[i - 1];
        // ornaments on long notes: a trill, a slide up from a semitone below, or a mordent
        if (S.orn && !n.fan && n.dur >= 1 && n.beat > 0 && r.chance(S.orn)) {
          const up = T.step(n.note, 1, key), dn = T.step(n.note, -1, key);
          const kind = r.weighted([["trill", 2], ["slide", prev && prev.note < n.note ? 2.5 : 1], ["mordent", 1.2]]);
          const fig = kind === "trill" ? [n.note, up, n.note, up] : kind === "slide" ? [n.note - 1] : [n.note, dn];
          fig.forEach((m, j) => leadEvents.push({ beat: n.beat + j * 0.125, dur: 0.12, note: m, vel: vel - (j ? 0.08 : 0) }));
          const restAt = n.beat + fig.length * 0.125;
          leadEvents.push({ beat: restAt, dur: n.dur - fig.length * 0.125, note: n.note, vel: vel - 0.04 });
          return;
        }
        leadEvents.push({ beat: n.beat, dur: n.dur, note: n.note, vel });
      });
      const gate = S.duty === 50 ? 0.88 : 0.92;
      leadEvents.forEach((n) => push("lead", n.beat, Math.max(0.1, n.dur * (n.dur <= 0.13 ? 0.95 : gate)), n.note, n.vel, { duty: S.duty }));

      // ================= pulse 2 =================
      if (S.role === "echo16" || S.role === "echo8") {
        const d = S.role === "echo16" ? 0.25 : 0.5;
        leadEvents.forEach((n) => {
          const at = n.beat + d;
          if (at >= (S.fanfare ? 28 : 32) - 1e-6) return;
          if (symAt(at) !== symAt(n.beat) && !T.chord(symAt(at)).pcs.includes(mod12(n.note))) return; // don't smear across a change
          push("p2", at, Math.max(0.1, n.dur * 0.85), n.note - (S.role === "echo8" ? 12 : 0), n.vel * 0.55, { duty: S.duty === 12 ? 25 : 12 });
        });
      } else if (S.role === "plain") {
        plain.forEach((n) => { if (!n.fan) push("p2", n.beat, n.dur * 0.9, n.note - 12, strongAt(n.beat) ? 0.5 : 0.44, { duty: 50 }); });
      } else if (S.role === "counter") {
        counterLine();
      } else if (S.role === "pah" || S.role === "arp16" || S.role === "arp32") {
        arps(S.role);
      }
      if (S.fanfare) FAN_P2.forEach((n) => push("p2", 28 + n.beat, Math.max(0.1, n.dur * 0.9), n.note + shift, 0.5, { duty: 12 }));

      // ================= wave: bass =================
      bassLine(S.bass);

      // ================= noise + kick =================
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        if (bar === 7 && S.fanfare) { fanfareDrums(B); continue; }
        const fill = bar === 7 ? "end" : bar === 3 && S.sec.startsWith("A") ? "phrase" : null;
        drumBar(bar, S.drums, bar === 0 && (levelStart || cycle === 0), fill);
      }

      const name = S.sec.startsWith("A") ? (S.divide ? "level-up variation" : S.sec === "A" ? "A theme" : "A theme, high answer") : S.sec === "B1" ? "B minuet in B♭" : "B minuet, home to G minor";
      const keyName = shift ? ` · up ${shift === 2 ? "a step" : "a semitone"}` : "";
      const label = `Game ${g + 1} · Level ${S.lvl} · ${name} · ${ROLE_NAME[S.role]}${keyName}${S.fanfare ? " · line clear!" : ""} · ${LEVEL_BPM[S.lvl]} BPM`;
      const res = { events: ev, harmony: prog, section: label, state };
      if (levelStart || cycle === 0) res.tempo = { bpm: LEVEL_BPM[S.lvl], rampBeats: 0 };
      return res;

      // ---------------------------------------------------------------- helpers (closures)
      function counterLine() {
        // quarter-note counter a third or sixth under the tune, tying repeated notes into longer values
        let prev = state.counterPrev ?? 62, held = null;
        const flush = () => { if (held) push("p2", held.b, held.d - 0.08, held.m, 0.44, { duty: 12 }); held = null; };
        for (let b = 0; b < 32; b++) {
          if (S.fanfare && b >= 28) break;
          const c = T.chord(symAt(b));
          const ln = tune.find((n) => n.beat <= b + 1e-6 && n.beat + n.dur > b + 1e-6) || tune.find((n) => n.beat > b && n.beat < b + 1);
          if (!ln) { flush(); continue; }
          let best = null, bs = Infinity;
          for (const m of T.notesIn(c.pcs, 55, 79)) {
            const iv = ln.note - m;
            if (iv < 3 || iv > 21 || (iv >= 11 && iv <= 14)) continue;
            let s = [3, 4, 8, 9, 15, 16].includes(iv) ? 0 : 2.5;
            s += Math.abs(m - prev) * 0.5 + (m === prev ? -1.2 : 0) + r() * 0.8;
            if (s < bs) { bs = s; best = m; }
          }
          if (best == null) { flush(); continue; }
          const chordStart = chordAt(b).bar * BPB + chordAt(b).beat === b;
          if (held && held.m === best && !chordStart && held.d < 3) held.d += 1;
          else { flush(); held = { b, d: 1, m: best }; }
          prev = best;
        }
        flush();
        state.counterPrev = prev;
      }

      function arps(kind) {
        prog.forEach((h) => {
          const c = T.chord(h.chord);
          const third = c.intervals.find((i) => i === 3 || i === 4) ?? 5;
          const fifth = c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
          const seventh = c.intervals.find((i) => i === 10 || i === 11);
          const lo = kind === "arp32" ? 50 : 55;
          const root = T.nearest(lo + 3, [c.root], lo, lo + 11);
          const tones = [root, root + third, root + fifth];
          if (seventh != null && kind !== "pah") tones.push(root + seventh);
          const s0 = h.bar * BPB + h.beat;
          for (let b = 0; b < h.dur - 1e-6; b += 1) {
            const at = s0 + b;
            if (S.fanfare && at >= 28) return;
            if (kind === "pah") {
              if (Math.round(at) % 2 === 0) continue; // the "pah" on beats 2 and 4
              [tones[0], tones[1], tones[2], tones[0] + 12].forEach((m, j) => push("p2", at + j * 0.125, 0.11, m, 0.4 - j * 0.03, { duty: 25 }));
            } else if (kind === "arp16") {
              const up = Math.floor(at / BPB) % 2 === 0;
              const seq = up ? [tones[0], tones[1], tones[2], tones[1]] : [tones[2], tones[1], tones[0], tones[1]];
              seq.forEach((m, j) => push("p2", at + j * 0.25, 0.22, m, j === 0 ? 0.4 : 0.32, { duty: 12 }));
            } else {
              for (let j = 0; j < 8; j++) {
                const step = Math.round((at - s0) * 8) + j; // the cycle keeps running across beats
                push("p2", at + j * 0.125, 0.115, tones[step % tones.length], j === 0 ? 0.36 : 0.3, { duty: 12 });
              }
            }
          }
        });
      }

      function bassLine(style) {
        let last = state.bassPrev ?? 43;
        prog.forEach((h, hi) => {
          const c = T.chord(h.chord);
          const s0 = h.bar * BPB + h.beat;
          let low = null, bs = Infinity;
          for (const m of T.notesIn([c.bass], 34, 46)) { const s = Math.abs(m - last) + 0.3 * Math.abs(m - 41); if (s < bs) { bs = s; low = m; } }
          const fifthIv = c.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
          const fifth = low + mod12(c.root + fifthIv - c.bass);
          // the chord's other tones stacked above its bass (so an inversion walks up through its own chord)
          const above = [...new Set(c.pcs.slice(0, 4).map((p) => mod12(p - c.bass)).filter((x) => x > 0))].sort((a, b) => a - b).map((x) => low + x);
          const third = above[0], fifthUp = above[1] ?? fifth;
          const nextH = prog[hi + 1];
          const nextLow = nextH ? T.nearest(low, [T.chord(nextH.chord).bass], 34, 46) : null;
          for (let b = 0; b < h.dur - 1e-6; b += style === "walk" || style === "oompah" ? 1 : 0.5) {
            const at = s0 + b;
            if (S.fanfare && at >= 28) continue;
            const lastOfSpan = b + (style === "walk" || style === "oompah" ? 1 : 0.5) >= h.dur - 1e-6;
            let m, d = 0.45, v = 0.8;
            const i = Math.round(b * 2);
            if (style === "oompah") { m = b % 2 === 0 ? low : fifth; d = 0.8; v = b % 2 === 0 ? 0.85 : 0.7; }
            else if (style === "walk") { m = h.dur <= 2 ? (b === 0 ? low : fifth) : [low, third, fifthUp, third][b % 4]; d = 0.88; v = 0.78; }
            else if (style === "walk8") { m = h.dur <= 2 ? [low, fifth, low + 12, fifth][i % 4] : [low, low + 12, third, low + 12, fifthUp, low + 12, third, low + 12][i % 8]; v = i % 2 ? 0.66 : 0.8; }
            else if (style === "octave") { m = i % 2 ? low + 12 : low; v = i % 2 ? 0.66 : 0.82; }
            else { m = [low, low + 12, fifth, low + 12][i % 4]; v = i % 2 ? 0.68 : 0.84; } // gallop
            // last eighth before a change of root: step into the next root (from the key, or chromatically)
            if (lastOfSpan && nextLow != null && nextLow !== low && style !== "oompah" && style !== "walk" && r.chance(0.7)) {
              const below = T.step(nextLow, -1, key), above = T.step(nextLow, 1, key);
              m = Math.abs(below - m) <= Math.abs(above - m) ? below : above;
              if (Math.abs(m - nextLow) > 2) m = nextLow - 1;
            }
            push("wave", at, d, m, v);
          }
          last = low;
        });
        if (S.fanfare) { // under the line-clear sweep: the cadence note, a sixteenth arpeggio, then a held root
          const g2 = T.nearest(last, [mod12(7 + shift)], 36, 46);
          push("wave", 28, 0.45, g2, 0.85);
          [g2, g2 + 3, g2 + 7, g2 + 12].forEach((m, j) => push("wave", 29 + j * 0.25, 0.22, m, 0.72 + j * 0.03));
          push("wave", 31, 0.9, g2, 0.85);
          last = g2;
        }
        state.bassPrev = last;
      }

      function drumBar(bar, style, crash, fill) {
        const B = bar * BPB;
        const N = (b, kind, v) => push("noise", B + b, 0.1, kind, v);
        const K = (b, v, p = 36) => push("kick", B + b, 0.1, "kick", v, { p });
        const fillFrom = fill === "end" ? 2 : fill === "phrase" ? 3 : 4;
        const odd = bar % 2 === 1;
        // kicks
        let kicks;
        if (style === "L1" || style === "L1b") kicks = [0, 2];
        else if (style === "half") kicks = [0, 2.5];
        else if (style === "half+") kicks = bar >= 6 ? [0, 1, 2, 3] : [0, 1.75, 2.5];
        else if (style === "L3") kicks = odd ? [0, 2, 2.5] : [0, 2];
        else if (style === "stomp") kicks = [0, 1, 2, 3];
        else kicks = r.chance(0.5) ? [0, 1, 2, 2.75, 3] : [0, 0.75, 1, 2, 3]; // frantic
        kicks.filter((b) => b < fillFrom || fill === "phrase").forEach((b) => K(b, b === 0 ? 0.92 : b % 1 ? 0.62 : 0.8));
        // noise: build the bar on a sixteenth grid
        for (let s = 0; s < 16; s++) {
          const b = s / 4;
          if (b >= fillFrom) break;
          const eighth = s % 2 === 0, beat = s % 4 === 0;
          let hit = null;
          if (b === 0 && crash) hit = ["crash", 0.8];
          else if (style === "L1" || style === "L1b") {
            if (b === 1 || b === 3) hit = ["snare", 0.7];
            else if (eighth) hit = ["hat", beat ? 0.34 : 0.5];
            else if (style === "L1b" && (s === 3 || s === 11) && bar >= 4) hit = ["hat", 0.22];
          } else if (style === "half" || style === "half+") {
            if (b === 2) hit = ["snare", 0.72];
            else if (b === 3.5) hit = ["ohat", 0.4];
            else if (eighth) hit = ["hat", beat ? 0.42 : 0.3];
            else if (style === "half+" && s === 15) hit = ["ghost", 0.26];
            else if (style === "half+" && bar >= 6 && (b === 1 || b === 3)) hit = ["snare", 0.62];
          } else {
            const frantic = style === "frantic";
            if (b === 1 || b === 3) hit = ["snare", frantic ? 0.8 : 0.74];
            else if (frantic && (s === 7 || s === 13)) hit = ["ghost", 0.3];
            else if (b === 3.5 && odd && !frantic) hit = ["ohat", 0.42];
            else if (b === 1.5 && frantic && odd) hit = ["ohat", 0.45];
            else if (eighth) hit = ["hat", beat ? 0.4 : 0.48];
            else hit = ["hat", style === "stomp" || frantic ? 0.26 : 0.2];
          }
          if (hit) N(b, hit[0], hit[1]);
        }
        if (fill === "phrase") { // a short pickup roll into the second phrase
          const n = style === "L1" || style === "half" ? [3.5, 3.75] : [3, 3.25, 3.5, 3.75];
          n.forEach((b, i) => N(b, "snare", 0.48 + i * 0.07));
        } else if (fill === "end") { // sixteenth snares, sweep-toms tumbling down
          for (let s = 8; s < 16; s++) N(s / 4, s % 2 ? "roll" : "snare", 0.42 + (s - 8) * 0.05);
          K(2, 0.7); [[3, 50], [3.25, 47], [3.5, 43], [3.75, 40]].forEach(([b, p], i) => K(b, 0.62 + i * 0.05, p));
        }
      }

      function fanfareDrums(B) {
        push("kick", B, 0.1, "kick", 0.95, { p: 36 });
        push("noise", B, 0.1, "snare", 0.75);
        for (let i = 0; i < 24; i++) push("noise", B + 1 + i * 0.125, 0.1, "roll", 0.28 + i * 0.024);
        [[3, 52], [3.25, 48], [3.5, 45], [3.75, 40]].forEach(([b, p], i) => push("kick", B + b, 0.1, "kick", 0.66 + i * 0.07, { p }));
      }
    },
  });

  /**
   * The level-up variation: divide the tune into running sixteenths. Strong notes keep their pitch; the
   * dotted hook keeps its rhythm; quarters become turns, broken chords, octave flips or runs to the next note.
   */
  function divide(tune, chordAt, key, r) {
    const out = [];
    tune.forEach((n, i) => {
      if (n.fan) { out.push(n); return; }
      const nx = tune[i + 1];
      const k = Math.round(n.dur / 0.25);
      const exact = Math.abs(k * 0.25 - n.dur) < 1e-6;
      if (!exact || k < 2 || n.dur === 0.75 || n.dur === 0.25) { out.push(n); return; }
      const c = T.chord(chordAt(n.beat).chord);
      const up = (m, s) => T.step(m, s, key);
      const ctAbove = (m, j) => T.step(m, j, c.pcs);
      const target = nx && nx.beat === n.beat + n.dur ? nx.note : null;
      let seq;
      if (k === 2) {
        // a leap: step toward the next note; stepwise motion: the neighbour on the far side (a zig-zag)
        const dir = target != null ? Math.sign(target - n.note) : 0;
        const second = target != null && Math.abs(target - n.note) > 2 ? up(n.note, dir) : up(n.note, dir ? -dir : 1);
        const opts = [[[n.note, second], 3]];
        if (n.note + 12 <= 84) opts.push([[n.note, n.note + 12], 0.6]);
        if (c.pcs.includes(mod12(n.note))) opts.push([[n.note, n.note], 0.4]);
        seq = r.weighted(opts);
      } else if (k === 4) {
        const opts = [
          [[n.note, up(n.note, 1), n.note, up(n.note, -1)], 2],
          [[n.note, ctAbove(n.note, 1), ctAbove(n.note, 2), ctAbove(n.note, 1)], 2],
          [[n.note, ctAbove(n.note, -1), ctAbove(n.note, -2), ctAbove(n.note, -1)], 1.2],
        ];
        if (n.note + 12 <= 84) opts.push([[n.note, n.note + 12, n.note, n.note + 12], 1.3]);
        if (target != null && Math.abs(target - n.note) >= 4) {
          const dir = Math.sign(target - n.note);
          opts.push([[n.note, up(n.note, dir), up(n.note, 2 * dir), up(n.note, 3 * dir)], 2.5]);
        }
        const fits = opts.filter(([q]) => Math.max(...q) <= 88);
        seq = r.weighted(fits.length ? fits : opts.slice(2, 3));
      } else if (k === 8) {
        seq = [0, 1, 2, 3, 2, 1, 0, -1].map((j) => (j >= 0 ? ctAbove(n.note, j) : up(n.note, -1)));
        if (j0(seq) > 91) seq = seq.map((m) => m - 12);
      } else { out.push(n); return; }
      seq.forEach((m, j) => out.push({ beat: n.beat + j * 0.25, dur: 0.25, note: Math.min(91, m) }));
    });
    return out;
    function j0(s) { return Math.max(...s); }
  }
})();
