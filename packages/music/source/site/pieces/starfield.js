// Starfield: ambient country for a night sky over the desert. Pedal steel swells and slides, a
// slow tremolo guitar, warm pads and open-fifth drones at 60 BPM, in D major with sus chords and
// borrowed colour (the minor iv, a flat-six major seventh, a flat-seven over the tonic pedal).
//
// The pedal steel is two things here. A lead voice plays composed, long-breathed phrases behind a
// volume pedal (every swelled note starts from almost nothing), sliding into notes and resolving
// 4-3 by gliding. A three-string "chord" voice swells triads and moves one string with a pedal
// (the fifth rising to the sixth and falling back), the sound the instrument is loved for.
// Wind and a few high glints of celesta (stars) are synthesized or drawn from the orchestra.
//
// One round (8 cycles of 8 bars, about 4.3 minutes):
//   Horizon (pedal steel chords over the drone) -> Horizon (the steel sings) -> Open sky (Gm6, B♭maj7)
//   -> Night drive (a sparse brushed groove and a fretless bass appear) -> Night drive (shaker, a
//   fuller pocket) -> Open sky (the groove thins to brush sweeps) -> Return (drums gone, B♭maj7 over
//   the D pedal) -> Stillness (drone and glass, then the subdominant of the next key).
// Rounds alternate D and F, each Stillness turning toward the next round's key.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4, BARS = 8;
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const db = (x) => Math.pow(10, x / 20);
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const trName = (n, k) => FLAT[mod(T.PC[n] + k, 12)];
  const trSym = (sym, k) => (k === 0 ? sym : sym.replace(/^([A-G][#b]?)/, (_, n) => trName(n, k)).replace(/\/([A-G][#b]?)$/, (_, n) => "/" + trName(n, k)));
  const KEYS = [0, 3]; // D, then F

  // ---------- sections (written in D) ----------
  const SECS = {
    A1: { prog: "| Dsus2 | % | Gmaj7/D | % | Dsus2 | % | Cadd9/D | % |", label: "Horizon · drones and steel swells", steelChords: true },
    A2: { prog: "| Dadd9 | % | Gmaj7/D | % | Bm7 | % | Asus4 | A |", label: "Horizon · the steel sings" },
    B: { prog: "| Gmaj7 | % | Gm6 | % | Dadd9/F# | % | Bbmaj7 | Asus4 A |", label: "Open sky · borrowed chords", steelChords: true, glass: true },
    C1: { prog: "| Dmaj7 | Em9 | Gmaj7 | Asus4 | Bm7 | Gmaj9 | Em7 | A7sus4 |", label: "Night drive · brushes and fretless bass", groove: 1 },
    C2: { prog: "| Dmaj7 | Em9 | Gmaj7 | Gm6 | F#m7 | Bm7 | Em9 | Asus4 A |", label: "Night drive · shaker, a fuller pocket", groove: 2 },
    B2: { prog: "| Gmaj7 | % | Gm6 | % | Bbmaj7 | % | Cadd9 | Asus4 |", label: "Open sky · the groove thins out", steelChords: true, glass: true, groove: 3 },
    A3: { prog: "| Dsus2 | % | Gmaj7/D | % | Dadd9 | % | Bbmaj7/D | % |", label: "Return · drums gone", steelChords: true },
    D: { prog: "| Dsus2 | % | % | % | X | % | % | % |", label: "Stillness", steelChords: true, glass: true },
  };
  const ORDER = ["A1", "A2", "B", "C1", "C2", "B2", "A3", "D"];

  // ---------- the pedal steel's phrases: unit = 1 beat; "<" swell, "/" slide in from the previous note, "^" slide up a tone ----------
  function phrase(str) {
    const out = [];
    str.split("|").map((s) => s.trim()).filter(Boolean).forEach((bar, bi) => {
      let t = 0;
      for (const tok of bar.split(/\s+/)) {
        const m = /^([<\/^]*)([A-G][#b]?-?\d|-)(?::(\d+))?$/.exec(tok);
        if (!m) throw new Error(`starfield: bad token ${tok}`);
        const d = m[3] ? Number(m[3]) : 1;
        if (m[2] !== "-") out.push({ abs: bi * BPB + t, d, m: T.midi(m[2]), swell: m[1].includes("<"), slide: m[1].includes("/"), grace: m[1].includes("^") });
        t += d;
      }
      if (t !== BPB) throw new Error(`starfield: bar ${bi + 1} lasts ${t} beats: ${bar}`);
    });
    return out;
  }
  const STEEL = {
    A1: phrase("-:4 | -:4 | -:1 <A4:3 | /B4:2 -:2 | -:4 | -:4 | -:1 <E5:3 | /D5:3 -:1"),
    A2: phrase("-:1 <A4:3 | ^B4:2 A4 F#4 | <D5:4 | /E5:2 F#5:2 | <D5:3 B4 | /C#5:2 A4:2 | <D5:4 | /C#5:3 -:1"),
    B: phrase("-:4 | -:2 <B4:2 | /Bb4:4 | -:1 <D5:3 | <A4:3 /B4 | /A4:2 F#4:2 | <D5:4 | /E5:2 /C#5:2"),
    C1: phrase("<F#5:2 E5 C#5 | /D5:2 B4:2 | <D5:3 B4 | /E5:2 D5:2 | <F#5:3 A5 | /F#5:2 D5:2 | <G5:3 E5 | D5:4"),
    C2: phrase("<F#5:2 E5 C#5 | /D5:2 B4:2 | <D5:3 B4 | <Bb4:4 | /A4:2 C#5:2 | /D5:3 F#5 | <G5:2 F#5:2 | /E5:2 C#5:2"),
    B2: phrase("-:2 <D5:2 | /E5:4 | <D5:2 /Bb4:2 | -:4 | <F5:4 | /D5:4 | <E5:3 /D5 | E5:4"),
    A3: phrase("-:2 <E5:2 | /D5:4 | <B4:3 /A4 | <F#5:4 | <E5:4 | /D5:2 A4:2 | <F5:4 | /D5:4"),
    D: phrase("-:4 | -:4 | -:2 <A4:2 | /B4:4 | -:4 | -:4 | -:4 | -:4"),
  };

  // ---------- custom sounds ----------
  /** A level-controlled bed: each event fades it to vel over a few seconds and holds it for its length. */
  function bedPlay(g, base) {
    return (t, e, d) => {
      const lvl = base * clamp(e.vel || 0, 0, 1);
      g.gain.cancelAndHoldAtTime(t);
      g.gain.linearRampToValueAtTime(lvl, t + Math.min(6, d * 0.25));
      g.gain.setValueAtTime(lvl, t + d + 0.5); // the next event cancels this fade; muted, the bed dies away
      g.gain.linearRampToValueAtTime(0, t + d + 4);
    };
  }
  /** Desert wind: pink noise through two slowly wandering band-passes, drifting across the stereo field. */
  function wind(ctx, dest) {
    const bus = ctx.keep(new Tone.Gain(0)).connect(dest);
    const pan = ctx.keep(new Tone.AutoPanner({ frequency: 0.031, depth: 0.7 }).start()).connect(bus);
    const g1 = ctx.keep(new Tone.Gain(0)).connect(pan);
    const bp1 = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 500, Q: 1.3 })).connect(g1);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(bp1);
    ctx.keep(new Tone.LFO({ frequency: 0.037, min: 260, max: 880 }).start()).connect(bp1.frequency);
    ctx.keep(new Tone.LFO({ frequency: 0.061, min: 0.15, max: 1 }).start()).connect(g1.gain);
    const g2 = ctx.keep(new Tone.Gain(0)).connect(pan);
    const bp2 = ctx.keep(new Tone.Filter({ type: "bandpass", frequency: 1700, Q: 4 })).connect(g2);
    ctx.keep(new Tone.Noise({ type: "pink" }).start()).connect(bp2);
    ctx.keep(new Tone.LFO({ frequency: 0.023, min: 1200, max: 2500 }).start()).connect(bp2.frequency);
    ctx.keep(new Tone.LFO({ frequency: 0.047, min: 0, max: 0.35 }).start()).connect(g2.gain);
    return { out: bus, play: bedPlay(bus, db(-27)) };
  }
  /** Pedal steel voices behind one volume pedal: a swelled note starts from almost nothing. */
  function steelRig(ctx, voices, opts) {
    const { I } = ctx;
    const pedal = ctx.keep(new Tone.Gain(1));
    const vs = Array.from({ length: voices }, () => { const s = I.pedalSteel(ctx, opts); s.out.connect(pedal); return s; });
    const clock = I.monotonic(pedal);
    return {
      out: pedal,
      swell(t, d, frac) {
        const tt = clock(t);
        pedal.gain.cancelAndHoldAtTime(tt);
        pedal.gain.linearRampToValueAtTime(0.06, tt + 0.03);
        pedal.gain.linearRampToValueAtTime(1, tt + 0.03 + clamp(d * frac, 0.4, 3));
      },
      play(i, t, note, d, vel) { vs[i % voices].play(t, note, d, vel); },
    };
  }

  /** A voicing with no adjacent semitones, trying open spreads first. */
  function smooth(sym, opts) {
    let v = null;
    for (const spread of ["open", "drop2", "any", "close"]) {
      v = T.voice(sym, { ...opts, spread });
      if (!v.some((m, i) => i > 0 && m - v[i - 1] === 1)) return v;
    }
    return T.voice(sym, { ...opts, n: 3 });
  }

  Sim.register({
    id: "starfield",
    title: "Starfield",
    genre: "Ambient country",
    about: "Ambient country at 60 BPM for a night sky over the desert: pedal steel swells and slides over open-fifth drones, a slow tremolo guitar and warm pads in D with borrowed chords, and a brushed groove that drifts in for the middle of the night and out again.",
    situations: ["campfire", "sleep", "explore"],
    energy: 0.15,
    bpm: 60, beatsPerBar: BPB, swing: 0.5, cycleBars: BARS, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 7.5, preDelay: 0.05, lowcut: 300, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.015, lowcut: 250, highcut: 6000 });
      const echo = I.delay(ctx, out, { time: 0.75, feedback: 0.38, highcut: 2600, pingPong: true });

      const lead = steelRig(ctx, 1, { volume: -1, glide: 0.22, vibratoDepth: 0.02 });
      const chords = steelRig(ctx, 3, { volume: -9, glide: 0.38, vibratoDepth: 0.015, cutoff: 2200 });
      const gtr = I.guitar(ctx, { kind: "clean", volume: -8, chorus: true, voices: 10 });
      const trem = ctx.keep(new Tone.Tremolo({ frequency: 3, depth: 0.7, spread: 0 }).start());
      gtr.out.connect(trem);
      const pad = I.pad(ctx, { volume: -12, cutoff: 950, attack: 3.5, release: 6, breath: 0.05, detune: 14 });
      const glass = I.glassPad(ctx, { volume: -17, attack: 4, release: 7 });
      const drone = I.pad(ctx, { volume: -9, cutoff: 520, attack: 5, release: 8, breath: 0.03, detune: 9, wave: "fattriangle" });
      const bass = I.ebass(ctx, { volume: -6, fretless: true });
      const stars = I.glock(ctx, { volume: -16, celesta: true, decay: 3 });
      const kit = I.kit(ctx, { volume: 1, kickNote: 31, preload: ["brushSweep", "brushTap", "softKick", "shaker"] });

      const lp = I.place(ctx, lead, 0.12, out), cp = I.place(ctx, chords, -0.25, out), tp = I.place(ctx, { out: trem }, -0.42, out);
      const pp = I.place(ctx, pad, 0.05, out), gp = I.place(ctx, glass, 0.3, out), sp = I.place(ctx, stars, 0.5, out);
      const dp = I.place(ctx, drone, 0, out), kp = I.place(ctx, kit, 0.08, out);
      I.place(ctx, bass, 0, out);
      I.send(ctx, lp, hall, -5); I.send(ctx, lp, echo, -15);
      I.send(ctx, cp, hall, -6);
      I.send(ctx, tp, hall, -8); I.send(ctx, tp, echo, -12);
      I.send(ctx, pp, hall, -12); I.send(ctx, gp, hall, -6); I.send(ctx, dp, hall, -16);
      I.send(ctx, sp, hall, -4); I.send(ctx, sp, echo, -6);
      I.send(ctx, kp, room, -12); I.send(ctx, kp, hall, -20); I.send(ctx, bass.out, hall, -22);
      const air = wind(ctx, out);
      I.send(ctx, air.out, hall, -10);

      const pl = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      return {
        steel: {
          layer: "melody",
          play: (t, e, d) => { if (e.swell) lead.swell(t, d, e.swell); lead.play(0, t, e.note, d, e.vel); },
          humanize: { timing: 0.012, vel: 0.04 },
        },
        steelChord: {
          layer: "harmony",
          play: (t, e, d) => {
            if (Array.isArray(e.note)) { chords.swell(t, d, 0.4); e.note.forEach((m, i) => chords.play(i, t, m, d, e.vel)); }
            else chords.play(e.v || 0, t, e.note, d, e.vel);
          },
          humanize: { timing: 0, vel: 0.03 },
        },
        trem: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.06 } },
        pad: { layer: "harmony", play: pl(pad), humanize: { timing: 0, vel: 0 } },
        glass: { layer: "harmony", play: pl(glass), humanize: { timing: 0, vel: 0 } },
        drone: { layer: "bass", play: pl(drone), humanize: { timing: 0, vel: 0 } },
        bass: { layer: "bass", play: pl(bass), humanize: { timing: 0.01, vel: 0.05 } },
        brushes: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep }), humanize: { timing: 0.012, vel: 0.12 } },
        stars: { layer: "texture", play: pl(stars), humanize: { timing: 0.02, vel: 0.1 } },
        wind: { layer: "texture", play: air.play, humanize: { timing: 0, vel: 0 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const round = Math.floor(cycle / ORDER.length), k = cycle % ORDER.length, id = ORDER[k], S = SECS[id];
      const K = KEYS[round % 2], nextK = KEYS[(round + 1) % 2];
      let text = S.prog;
      if (id === "D") text = text.replace("X", FLAT[mod(2 + nextK + 5 - K, 12)] + "maj7"); // IV of the next round's key
      const prog = T.progression(text, BPB).map((h) => ({ ...h, chord: trSym(h.chord, K) }));
      const start = (h) => h.bar * BPB + h.beat;
      const at = (b) => { let cur = prog[0]; for (const h of prog) { if (start(h) <= b + 1e-6) cur = h; else break; } return cur; };
      const sym = (b) => at(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: abs - bar * BPB, dur, note, vel: clamp(vel, 0.05, 1), ...extra });
      };
      const tonic = mod(2 + K, 12);
      const groove = S.groove || 0;
      const first = cycle === 0;

      // ================= pedal steel lead =================
      let notes = STEEL[id];
      const top = Math.max(0, ...notes.map((n) => n.m));
      const shift = top + K > 84 ? K - 12 : K; // keep the steel below D6
      notes = notes.map((n) => ({ ...n, m: n.m + shift }));
      // later rounds: more slides up into swelled notes, where the note a tone below sits well over the chord
      const graceOk = (n) => { const c = T.chord(sym(n.abs)), g = mod(n.m - 2, 12); return c.scale.includes(g) && !c.pcs.some((q) => mod(g - q, 12) === 1 || mod(q - g, 12) === 1); };
      notes = notes.map((n) => (n.grace && !graceOk(n) ? { ...n, grace: false } : n));
      if (round > 0) notes = notes.map((n) => (n.swell && !n.grace && n.d >= 3 && graceOk(n) && r.chance(0.3) ? { ...n, grace: true } : n));
      const lv = { A1: 0.55, A2: 0.62, B: 0.58, C1: 0.66, C2: 0.68, B2: 0.6, A3: 0.6, D: 0.5 }[id];
      notes.forEach((n, i) => {
        const next = notes[i + 1];
        let dur = n.d * 0.94;
        if (next && next.slide && next.abs - (n.abs + n.d) < 0.01) dur = n.d + 0.12; // hold through, so the next note slides
        const v = lv + (n.swell ? 0.04 : 0) + r.range(-0.03, 0.03);
        if (n.grace) {
          push("steel", n.abs, 0.36, n.m - 2, v * 0.85, { swell: n.swell ? 0.5 : 0 });
          push("steel", n.abs + 0.3, Math.max(0.5, dur - 0.3), n.m, v);
        } else push("steel", n.abs, dur, n.m, v, { swell: n.swell ? 0.45 : 0 });
      });

      // ================= pedal steel chords: swell a triad, move a string with a pedal =================
      if (S.steelChords) {
        prog.forEach((h, i) => {
          const s0 = start(h), len = (i + 1 < prog.length ? start(prog[i + 1]) : BARS * BPB) - s0;
          if (len < 4) return;
          if (id === "D" && s0 > 0 && s0 < 16) return;
          const c = T.chord(h.chord);
          // the steel's strings give plain triads (or sus); colour comes from the pedal
          const third = c.intervals.includes(3) ? "m" : c.intervals.includes(4) ? "" : c.intervals.includes(2) ? "sus2" : "sus4";
          const v = T.voice(FLAT[c.root] + third, { lo: 50, hi: 69, n: 3, rootless: false, prev: state.steelV, spread: "close", rng: r, avoidRootOnTop: false });
          state.steelV = v;
          const vel = 0.5 + r.range(-0.04, 0.04);
          push("steelChord", s0, len - 0.3, v, vel);
          // the A pedal: the fifth rises a tone to the sixth, then falls back
          const fi = v.findIndex((m) => mod(m - c.root, 12) === 7);
          const six = fi >= 0 ? v[fi] + 2 : null;
          if (six != null && len >= 8 && c.scale.includes(mod(six, 12)) && !v.some((m) => Math.abs(m - six) === 1)) {
            push("steelChord", s0 + 3, 2.6, six, vel * 0.9, { v: fi }); // held into the release, so the string glides back
            push("steelChord", s0 + 5.5, len - 5.8, v[fi], vel * 0.85, { v: fi });
          }
        });
      }

      // ================= tremolo guitar =================
      prog.forEach((h, i) => {
        const s0 = start(h), len = (i + 1 < prog.length ? start(prog[i + 1]) : BARS * BPB) - s0;
        const v = T.voice(h.chord, { lo: 60, hi: 79, n: 4, rootless: false, prev: state.gtrV, spread: "open", rng: r });
        state.gtrV = v;
        let hits;
        if (groove === 1 || groove === 2) hits = len >= 4 ? [[0, 0], [1.5, 2], [3, 1]] : [[0, 0], [1.5, 2]];
        else if (id === "A1") hits = first && s0 < 8 ? [] : [[0, 1], [2, 2], [5, 3]];
        else if (id === "D") hits = [[0, 3], [6, 2]];
        else hits = [[0, 0], [2, 1], [4, 2], [6, 3]];
        const up = r.chance(0.5);
        hits.forEach(([b, j]) => {
          if (b >= len) return;
          const note = v[up ? j % v.length : (v.length - 1 - (j % v.length))];
          push("trem", s0 + b, Math.min(4, len - b), note, 0.42 + (b === 0 ? 0.05 : 0) + r.range(-0.03, 0.03));
        });
      });

      // ================= pads =================
      if (!(id === "D")) prog.forEach((h, i) => {
        const s0 = start(h), len = (i + 1 < prog.length ? start(prog[i + 1]) : BARS * BPB) - s0;
        const v = smooth(h.chord, { lo: 55, hi: 76, n: 4, rootless: true, prev: state.padV, rng: r });
        state.padV = v;
        push("pad", s0, len - 0.1, v, (groove ? 0.36 : 0.42) * (first && i === 0 ? 0.8 : 1));
      });
      if (S.glass) prog.forEach((h, i) => {
        const s0 = start(h), len = (i + 1 < prog.length ? start(prog[i + 1]) : BARS * BPB) - s0;
        const c = T.chord(h.chord);
        const pcs = c.colors.length ? c.colors.concat([mod(c.root + 7, 12)]) : [mod(c.root + 7, 12), c.root];
        const hi = T.notesIn(pcs, 74, 88);
        const pick = [hi[hi.length - 1], hi[Math.max(0, hi.length - 3)]].filter((m, j, a) => m != null && a.indexOf(m) === j);
        if (pick.length) push("glass", s0, len - 0.1, pick, 0.4);
      });

      // ================= drone (or the fretless bass in the groove) =================
      if (groove === 1 || groove === 2) {
        let last = state.bassLast ?? 38 + K;
        for (let bar = 0; bar < BARS; bar++) {
          const b0 = bar * BPB, h = at(b0), c = T.chord(h.chord);
          const root = T.nearest(last, [c.bass], 36, 50);
          push("bass", b0, groove === 1 ? 3.6 : 2.7, root, 0.62);
          if (groove === 2) {
            const fifth = c.intervals.includes(7) ? T.nearest(root + 7, [mod(c.root + 7, 12)], 38, 55) : root + 12;
            push("bass", b0 + 3, 0.9, r.chance(0.6) ? fifth : root, 0.5);
          }
          const hn = at(b0 + BPB);
          if (bar < BARS - 1 && hn !== h && r.chance(0.3)) {
            const nr = T.nearest(root, [T.chord(hn.chord).bass], 36, 50);
            if (Math.abs(nr - root) > 2) push("bass", b0 + 3.5, 0.45, T.step(nr, nr > root ? -1 : 1, T.scale(tonic, "ionian")), 0.4);
          }
          last = root;
        }
        state.bassLast = last;
      } else {
        // open fifth on the tonic while the chord allows it, otherwise the chord's own bass and fifth
        const drones = prog.map((h) => {
          const c = T.chord(h.chord);
          const rub = (p) => c.pcs.some((q) => mod(p - q, 12) === 1 || mod(q - p, 12) === 1) && !c.pcs.includes(p);
          const base = !rub(tonic) && (c.bass === tonic || c.pcs.includes(tonic)) ? tonic : c.bass;
          const notes = [36 + mod(base, 12) + (mod(base, 12) < 2 ? 12 : 0)]; // D2..C#3
          if (!rub(mod(base + 7, 12))) notes.push(notes[0] + 7);
          return { s: start(h), notes };
        });
        drones.forEach((d, i) => {
          const prev = drones[i - 1];
          if (prev && prev.notes.join() === d.notes.join()) return;
          let j = i + 1;
          while (j < drones.length && drones[j].notes.join() === d.notes.join()) j++;
          const end = j < drones.length ? drones[j].s : BARS * BPB;
          push("drone", d.s, end - d.s - 0.1, d.notes, 0.5);
        });
      }

      // ================= brushes =================
      if (groove) {
        for (let bar = 0; bar < BARS; bar++) {
          const b0 = bar * BPB, lastBar = bar === BARS - 1;
          for (let b = 0; b < 4; b++) {
            if (groove === 3 && bar >= 6) break; // thinning out
            push("brushes", b0 + b, 1, "brushSweep", (groove === 3 ? 0.26 - bar * 0.025 : 0.3) + (b % 2) * 0.04, { sweep: 0.85 });
          }
          if (groove === 1) {
            if (bar > 0 || !first) push("brushes", b0, 0.2, "softKick", 0.42);
            push("brushes", b0 + 2, 0.2, "brushTap", 0.46);
            if (r.chance(0.3)) push("brushes", b0 + 3.5, 0.2, "brushTap", 0.22);
          } else if (groove === 2) {
            push("brushes", b0, 0.2, "softKick", 0.48);
            if (r.chance(0.5)) push("brushes", b0 + 1.5, 0.2, "softKick", 0.3);
            push("brushes", b0 + 1, 0.2, "brushTap", 0.5); push("brushes", b0 + 3, 0.2, "brushTap", 0.54);
            if (r.chance(0.4)) push("brushes", b0 + 2.75, 0.2, "brushTap", 0.2);
            for (let e = 0; e < 8; e++) push("brushes", b0 + e * 0.5, 0.2, "shaker", e % 2 ? 0.24 : 0.14);
            if (lastBar) [3, 3.25, 3.5, 3.75].forEach((b, i) => push("brushes", b0 + b, 0.2, "brushTap", 0.26 + i * 0.06));
          } else if (groove === 3 && bar < 4) {
            for (let e = 0; e < 8; e++) push("brushes", b0 + e * 0.5, 0.2, "shaker", (e % 2 ? 0.2 : 0.11) * (1 - bar * 0.18));
            if (bar < 2) push("brushes", b0 + 3, 0.2, "brushTap", 0.36 - bar * 0.1);
          }
        }
      }

      // ================= stars and wind =================
      const n = { A1: 3, A2: 2, B: 3, C1: 1, C2: 1, B2: 2, A3: 3, D: 4 }[id];
      const spots = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, n).sort((a, b) => a - b);
      spots.forEach((bar) => {
        const b = bar * BPB + r.pick([0.5, 1, 1.5, 2]), h = at(b), c = T.chord(h.chord);
        const room = (prog[prog.indexOf(h) + 1] ? start(prog[prog.indexOf(h) + 1]) : BARS * BPB) - b;
        const pcs = c.colors.length ? c.colors.concat(c.guide) : c.pcs;
        const m = r.pick(T.notesIn(pcs, 86, 98));
        push("stars", b, Math.min(1, room), m, 0.28 + r.range(0, 0.12));
        const b2 = r.pick([0.5, 0.75, 1]);
        if (room - b2 >= 1 && r.chance(0.4)) push("stars", b + b2, 1, r.pick(T.notesIn(c.pcs, 84, 96)), 0.22);
      });
      push("wind", 0, BARS * BPB, "bed", { A1: 0.95, A2: 0.75, B: 0.65, C1: 0.45, C2: 0.4, B2: 0.55, A3: 0.75, D: 1 }[id]);

      const keyName = FLAT[tonic];
      return { events: ev, harmony: prog.map(({ bar, beat, dur, chord }) => ({ bar, beat, dur, chord })), section: `${S.label} · ${keyName}`, state };
    },
  });
})();
