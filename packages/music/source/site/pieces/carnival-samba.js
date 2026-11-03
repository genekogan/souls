// Carnaval: a samba school's bateria parading down the avenue, with the horns and cavaquinho of the
// samba-enredo riding on top.
//
// Meter: 2/4 (two quarter-note beats per bar), thought in sixteenths. Every bateria part is written on the
// 16th grid: 8 sixteenths per bar, patterns usually two bars long.
//   surdo de primeira (lowest): muted press on 1, the big open stroke on 2 (the heartbeat of the samba)
//   surdo de segunda: open on 1, muted on 2, answering the primeira
//   surdo de terceira / cortador (highest): syncopated cuts that change with the section
//   caixas: continuous 16ths, accented on the 1 and the "a", rolls into breaks
//   tamborins: teleco-teco under the singing, carreteiro (1, &, a of every beat) in the batucadas, and
//              unison 3-3-2 "viradas" that flip the band into a new section
//   agogô: a two-bell figure; chocalhos: 16ths leaning on the e and the a
//   repinique: its own groove, and the chamadas (calls) that cue every entrance, stop and break
//   apito: the mestre's whistle, signalling breaks and re-entries
// Horns (brassStab) carry the samba-enredo melody; a second horn harmonises a third or sixth below; the
// cavaquinho strums the partido-alto chop and anticipates the next chord on the last 16th; a 7-string
// guitar plays the bass with baixarias (runs) into new chords; the ala (wordless choir) joins the refrão.
//
// Harmony: the verse in D minor (Dm  Dm/C  Bb7  A7 ... with Bb7 as a tritone-side approach to A7, a sequence
// up a step into the relative major and a D7 swing to Gm), the refrão in the parallel major (D  B7  Em7  A7,
// a borrowed Gm6 in the middle, the hook returning three times). The third refrão of each round goes up a
// whole step to E, cued by a lone cavaquinho B7 at the end of the bossa.
//
// Form (cycles of 16 bars of 2/4, about 19 s at 100 BPM):
//   Esquenta (once: repinique chamada and apito, then the whole bateria) ->
//   [ Verse 1 (breque: the band stops on the last bar, cavaquinho and horns alone lead in) -> Refrão 1 ->
//     Paradinha (all percussion: call and response between the repinique and each section, a tutti
//     answer, a dead stop with only the whistle, and the return) -> Verse 2 -> Refrão 2 (the ala sings) ->
//     Bossa (all percussion: a four-bar unison convenção, the surdos alone, staggered re-entry) ->
//     Refrão 3 up a step -> Batucada final (accelerating to 106, closing on a breque) ] repeat,
// with cortador, agogô and tamborim figures varying from round to round.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const BPB = 2, BARS = 16, Q = 0.25;
  const mod12 = T.mod12;

  // ---------- notation: "r:2 A4:1 D5:2 | ..." in sixteenths, 8 per bar ----------
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?\d):(\d+)$/.exec(tok);
        if (!m) throw new Error(`carnival-samba: bad token ${tok}`);
        const len = Number(m[2]);
        if (m[1] !== "r") out.push({ s: bi * 8 + pos, len, note: T.midi(m[1]) });
        pos += len;
      });
      if (pos !== 8) throw new Error(`carnival-samba: bar ${bi + 1} of a line has ${pos} sixteenths`);
    });
    return out;
  }
  const pat = (s) => s.replace(/\|/g, "").split("");

  // ---------- the samba-enredo ----------
  const VERSE_H = "| Dm | Dm/C | Bb7 | A7 | Dm | Gm7 | C7 | Fmaj7 | Bbmaj7 | Em7b5 | A7b9b13 | Dm D7 | Gm7 | A7 | Dm | A7 |";
  const VERSE_M = line(
    "r:2 A4:1 D5:2 E5:1 F5:2 | F5:1 E5:2 D5:1 A4:4 | r:1 Bb4:1 D5:1 F5:2 Ab5:3 | G5:3 E5:1 C#5:4 | " +
    "r:2 A4:1 D5:2 E5:1 F5:2 | G5:1 F5:2 E5:1 D5:4 | r:1 C5:1 E5:1 G5:2 Bb5:3 | A5:3 G5:1 F5:4 | " +
    "D5:3 F5:1 A5:4 | G5:1 Bb5:2 G5:1 E5:4 | r:1 E5:1 G5:1 F5:2 E5:1 C#5:2 | D5:4 F#5:1 A5:1 C6:2 | " +
    "Bb5:3 A5:1 G5:2 D5:2 | A5:3 G5:1 E5:2 C#5:2 | D5:3 E5:1 F5:4 | r:2 A4:1 C#5:1 E5:1 G5:1 A5:2");
  const REFRAO_H = "| D | B7 | Em7 | A7 | D | D7 | Gmaj7 | Gm6 | F#m7 | B7 | Em7 | A7 | D | B7 | Em7 A7 | D |";
  const REFRAO_M = line(
    "r:1 F#5:1 A5:2 F#5:1 A5:1 B5:2 | A5:3 F#5:1 D#5:4 | r:1 E5:1 G5:2 E5:1 G5:1 A5:2 | G5:3 E5:1 C#5:4 | " +
    "r:1 F#5:1 A5:2 F#5:1 A5:1 D6:2 | C6:3 A5:1 F#5:4 | r:1 B5:1 D6:2 B5:1 A5:1 F#5:2 | G5:3 E5:1 Bb5:4 | " +
    "A5:3 F#5:1 E5:4 | r:1 D#5:1 F#5:1 A5:2 B5:1 A5:2 | G5:4 F#5:1 E5:1 D5:2 | E5:2 F#5:1 G5:1 A5:4 | " +
    "r:1 F#5:1 A5:2 F#5:1 A5:1 B5:2 | A5:3 F#5:1 D#5:4 | E5:2 G5:1 B5:1 C#6:2 B5:1 G5:1 | F#5:3 E5:1 D5:4");
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const trName = (n, k) => SHARP[mod12(T.PC[n] + k)];
  const trSym = (sym, k) => (k ? sym.replace(/^([A-G][#b]?)/, (x) => trName(x, k)).replace(/\/([A-G][#b]?)$/, (x, n) => "/" + trName(n, k)) : sym);
  const progOf = (text, k) => T.progression(text, BPB).map((h) => ({ ...h, chord: trSym(h.chord, k) }));

  // ---------- bateria patterns (16ths; two bars unless noted) ----------
  // cortador: O open accent, o open, m muted
  const CORT = [
    pat("O..o..o.|..o.O..."), pat("O..O..m.|o.o.O.m."), pat("..O..O..|O.m.o..."), pat("O.mo..O.|m.oo.O.."),
    pat("O..o.O..|O..o.Om."),
  ];
  const TELECO = [pat("x.xx.x.x|.xx.x.x."), pat("x.xx.x.x|.x.x.xx.")];
  const VIRADA = pat("x..x..x.|x..x..x."); // tamborins in unison, 3-3-2
  // agogô: H high bell, L low bell
  const AGOGO = [pat("H.L.H.LH|.L.HL.H."), pat("H.HL.L.H|.H.LH.L."), pat("L.H.L.HH|.H.LH.L.")];
  // repinique groove: H/h high (slap) accent/soft, L/l open low
  const REP = [pat("H.lL.lH.|l.H.lH.l"), pat("H.hl.hL.|h.H.lhL.")];
  // chamadas (one bar each, the band enters on the next downbeat)
  const CHAMADA = [pat("H.HH.H.H"), pat("HHH.HHH."), pat("H..H..HH"), pat("HhHhH.H.")];
  // the bossa: a four-bar convenção played in unison by the whole bateria (X = accent, x = hit)
  const BOSSA = [pat("X..X..X.|..X.X...|X.x.X.xX|X......."), pat("X.X..X.X|..X..X..|X..X..X.|X.X.X..."), pat("x.xX.x.X|...X.X..|X..X.x.X|X......."), pat("X..X..X.|X..X..X.|X.X.X.X.|X.......")];
  // paradinha answers, one bar each
  const ANS = { surdos: pat("O.O.O..O"), small: pat("x..x..x."), bells: pat("x.xx.x.x"), tutti: pat("X.X.XX.X") };

  const P1 = 35, P2 = 40, P3 = 45; // surdo tunings: primeira lowest, then segunda, then terceira
  const ROUND = ["verse", "refrao", "parada", "verse", "refrao", "bossa", "refraoUp", "final"];
  function planAt(cycle) {
    if (cycle === 0) return { kind: "intro", round: 0, idx: -1 };
    const k = cycle - 1;
    return { kind: ROUND[k % 8], round: Math.floor(k / 8), idx: k % 8 };
  }
  const NAME = { intro: "Esquenta · bateria", verse: "Samba-enredo · verse (D minor)", refrao: "Refrão (D major)", parada: "Paradinha · call and response", bossa: "Bossa · breque", refraoUp: "Refrão up a step (E)", final: "Batucada final" };

  Sim.register({
    id: "carnival-samba",
    title: "Carnaval",
    genre: "Samba batucada",
    about: "A full samba-school bateria in 2/4 (three surdos, caixas, tamborins, agogô, chocalhos, a repinique calling the breaks and the mestre's whistle) under a D-minor samba-enredo for horns and cavaquinho, with paradinhas, a bossa and a last refrão a step up.",
    situations: ["party", "celebrate"],
    energy: 0.95,
    bpm: 100, beatsPerBar: BPB, cycleBars: BARS, swing: 0.5, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const street = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 300, highcut: 7000 });
      const avenue = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.03, lowcut: 400, highcut: 6000 });

      const horns = I.brassStab(ctx, { volume: -1, base: 650, octaves: 3.2 });
      const bones = I.brassStab(ctx, { volume: -6, base: 420, octaves: 2.6 });
      const ala = I.choir(ctx, { volume: -9, vowel: "a", attack: 0.05, release: 0.5 });
      const cav = I.guitar(ctx, { kind: "steel", volume: -6, dampening: 6500, voices: 12 });
      const seven = I.nylon(ctx, { volume: -3, cutoff: 2600, voices: 4 });
      const apito = I.whistle(ctx, { volume: -12, vibratoDepth: 0.02, glide: 0.012, attack: 0.008, release: 0.05 });

      const kit = (vol, pan, preload) => { const k = I.kit(ctx, { volume: vol, preload }); I.place(ctx, k, pan, out); return k; };
      const s1 = kit(1, 0, ["surdo"]), s2 = kit(-1, -0.18, ["surdo"]), s3 = kit(-3, 0.22, ["surdo"]);
      const cxL = kit(-6, -0.45, ["caixa"]), cxR = kit(-7, 0.4, ["caixa"]);
      const tmL = kit(-3, 0.5, ["tamborim"]), tmR = kit(-4, -0.3, ["tamborim"]);
      const ago = kit(-9, 0.62, ["agogo"]);
      const chL = kit(-10, -0.6, ["shaker"]), chR = kit(-11, 0.65, ["shaker"]);
      const rep = kit(-3, -0.12, ["timbale"]);

      const hp = I.place(ctx, horns, 0.12, out), bp = I.place(ctx, bones, -0.2, out), ap = I.place(ctx, ala, 0, out);
      const cp = I.place(ctx, cav, 0.35, out), sp = I.place(ctx, seven, -0.15, out), wp = I.place(ctx, apito, -0.05, out);
      I.send(ctx, hp, avenue, -12); I.send(ctx, hp, street, -10); I.send(ctx, bp, street, -11); I.send(ctx, ap, avenue, -6);
      I.send(ctx, cp, street, -14); I.send(ctx, sp, street, -20); I.send(ctx, wp, avenue, -8);
      [cxL, cxR, tmL, tmR, ago, rep].forEach((k) => I.send(ctx, k.out, street, -14));
      [s1, s2, s3].forEach((k) => I.send(ctx, k.out, street, -20));

      const one = (k) => (t, e) => k.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.sd });
      const pair = (a, b, lag) => (t, e) => { a.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.sd }); b.hit(e.note, t + lag, e.vel * 0.85, { pitch: e.pitch, dur: e.sd }); };
      return {
        horns: { layer: "melody", play: (t, e, d) => horns.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        bones: { layer: "melody", play: (t, e, d) => bones.play(t, e.note, d, e.vel), humanize: { timing: 0.007, vel: 0.05 } },
        ala: { layer: "melody", play: (t, e, d) => ala.play(t, e.note, d, e.vel), humanize: { timing: 0.012, vel: 0.05 } },
        cav: { layer: "harmony", play: (t, e, d) => cav.play(t, e.note, d, e.vel, e.strum || 0), humanize: { timing: 0.004, vel: 0.08 } },
        seven: { layer: "bass", play: (t, e, d) => seven.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        surdo1: { layer: "drums", play: one(s1), humanize: { timing: 0.004, vel: 0.05 } },
        surdo2: { layer: "drums", play: one(s2), humanize: { timing: 0.005, vel: 0.05 } },
        surdo3: { layer: "drums", play: one(s3), humanize: { timing: 0.006, vel: 0.08 } },
        caixa: { layer: "drums", play: pair(cxL, cxR, 0.006), humanize: { timing: 0.003, vel: 0.1 } },
        tamborim: { layer: "drums", play: pair(tmL, tmR, 0.005), humanize: { timing: 0.003, vel: 0.08 } },
        agogo: { layer: "drums", play: one(ago), humanize: { timing: 0.004, vel: 0.08 } },
        chocalho: { layer: "drums", play: pair(chL, chR, 0.009), humanize: { timing: 0.004, vel: 0.12 } },
        repique: { layer: "drums", play: one(rep), humanize: { timing: 0.004, vel: 0.08 } },
        apito: { layer: "texture", play: (t, e, d) => apito.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const plan = planAt(cycle), next = planAt(cycle + 1);
      const { kind, round, idx } = plan;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, BPB); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      // samba micro-timing: the e of each beat a hair late, the a a hair early
      const feel = (s) => (s % 4 === 1 ? 0.007 : s % 4 === 3 ? -0.005 : 0);
      const hit = (track, bar, s, voice, vel, x = {}) => {
        if (vel <= 0.02) return;
        const si = Math.round(s * 2) / 2;
        push(track, bar * BPB + s * Q, 0.1, voice, Math.min(1, vel), { delay: Number.isInteger(si) ? feel(si) : 0, ...x });
      };
      const surdo = (track, pitch, bar, s, open, vel) => hit(track, bar, s, "surdo", vel, { pitch, sd: open ? 0.6 : 0.1 });
      const allSurdos = (bar, s, vel) => { surdo("surdo1", P1, bar, s, true, vel); surdo("surdo2", P2, bar, s, true, vel * 0.95); surdo("surdo3", P3, bar, s, true, vel * 0.9); };

      // ---- per-round choices ----
      const rr = T.rng(9173 + round * 31);
      if (state.round !== round) {
        state.round = round;
        state.cort = [rr.int(0, CORT.length - 1), rr.int(0, CORT.length - 1), rr.int(0, CORT.length - 1)];
        state.ago = rr.int(0, AGOGO.length - 1);
        state.tel = rr.int(0, TELECO.length - 1);
        state.rep = rr.int(0, REP.length - 1);
        state.bossa = round % BOSSA.length;
      }

      // ---- the groove, one bar ----
      // g: {s1,s2,s3,cx,tam:"teleco"|"carreteiro",tamV,ago,choc,rep,cort} levels 0..1
      function groove(bar, g) {
        const h = bar % 2; // which half of a two-bar pattern
        if (g.s1) { surdo("surdo1", P1, bar, 0, false, 0.34 * g.s1); surdo("surdo1", P1, bar, 4, true, 0.95 * g.s1); }
        if (g.s2) { surdo("surdo2", P2, bar, 0, true, 0.86 * g.s2); surdo("surdo2", P2, bar, 4, false, 0.3 * g.s2); }
        if (g.s3) {
          const cp = CORT[g.cort ?? 0];
          for (let s = 0; s < 8; s++) {
            const c = cp[h * 8 + s];
            if (c === "O") surdo("surdo3", P3, bar, s, true, 0.82 * g.s3);
            else if (c === "o") surdo("surdo3", P3, bar, s, true, 0.6 * g.s3);
            else if (c === "m") surdo("surdo3", P3, bar, s, false, 0.45 * g.s3);
          }
        }
        if (g.cx) {
          const acc = [0.62, 0.26, 0.34, 0.8];
          for (let s = 0; s < 8; s++) hit("caixa", bar, s, "caixa", acc[s % 4] * g.cx * (1 + r.gauss(0.04)));
          if (g.roll) for (let s = 4.5; s < 8; s += 1) hit("caixa", bar, s, "caixa", (0.3 + 0.08 * s) * g.cx); // 32nd fill into the next bar
        }
        if (g.tam === "teleco") {
          const tp = TELECO[state.tel];
          for (let s = 0; s < 8; s++) if (tp[h * 8 + s] === "x") hit("tamborim", bar, s, "tamborim", (s === 0 || s === 3 ? 0.7 : 0.55) * (g.tamV ?? 1));
        } else if (g.tam === "carreteiro") {
          for (let s = 0; s < 8; s++) if (s % 4 !== 1) hit("tamborim", bar, s, "tamborim", (s % 4 === 3 ? 0.72 : s % 4 === 0 ? 0.6 : 0.42) * (g.tamV ?? 1));
        } else if (g.tam === "virada") {
          for (let s = 0; s < 8; s++) if (VIRADA[h * 8 + s] === "x") hit("tamborim", bar, s, "tamborim", 0.85 * (g.tamV ?? 1));
        }
        if (g.ago) {
          const ap = AGOGO[state.ago];
          for (let s = 0; s < 8; s++) { const c = ap[h * 8 + s]; if (c !== ".") hit("agogo", bar, s, "agogo", (c === "H" ? 0.62 : 0.55) * g.ago, { pitch: c === "H" ? 86 : 81 }); }
        }
        if (g.choc) { const acc = [0.34, 0.5, 0.36, 0.56]; for (let s = 0; s < 8; s++) hit("chocalho", bar, s, "shaker", acc[s % 4] * g.choc); }
        if (g.rep) {
          const rp = REP[state.rep];
          for (let s = 0; s < 8; s++) {
            const c = rp[h * 8 + s];
            if (c === ".") continue;
            const hi = c === "H" || c === "h";
            hit("repique", bar, s, "timbale", (c === c.toUpperCase() ? 0.66 : 0.38) * g.rep, { pitch: hi ? 76 : 69 });
          }
          if (r.chance(0.12)) hit("repique", bar, 6.5, "timbale", 0.35 * g.rep, { pitch: 76 }); // a flourish
        }
      }
      const chamada = (bar, which, vel = 0.85) => CHAMADA[which].forEach((c, s) => { if (c !== ".") hit("repique", bar, s, "timbale", c === "H" ? vel : vel * 0.55, { pitch: c === "H" ? 76 : 71 }); });
      // a unison figure for any set of sections (X accent, x hit, O open surdo)
      const tutti = (bar, p8, who, vel = 0.85) => p8.forEach((c, s) => {
        if (c === ".") return;
        const v = (c === "X" || c === "O" ? 1 : 0.72) * vel;
        if (who.surdos) allSurdos(bar, s, v);
        if (who.caixa) hit("caixa", bar, s, "caixa", v);
        if (who.tam) hit("tamborim", bar, s, "tamborim", v);
        if (who.rep) hit("repique", bar, s, "timbale", v * 0.9, { pitch: 76 });
        if (who.ago) hit("agogo", bar, s, "agogo", v * 0.7, { pitch: s % 2 ? 81 : 86 });
        if (who.choc) hit("chocalho", bar, s, "shaker", v * 0.8);
      });
      const ALL = { surdos: 1, caixa: 1, tam: 1, rep: 1, ago: 1, choc: 1 };
      const stopHit = (bar, vel = 0.95, rep = 1) => tutti(bar, pat("X......."), { ...ALL, rep }, vel);
      // the whistle sits on the tonic and fifth of whatever key the band is in (E for the last refrão and the final)
      const wk = kind === "refraoUp" || kind === "final" ? 2 : 0;
      const whistle = (bar, s, notes, vel = 0.7) => notes.forEach(([o, len, m]) => push("apito", bar * BPB + (s + o) * Q, len * Q, m + wk, vel));
      const tri = [[0, 0.8, 93], [1, 0.8, 93], [2, 2.5, 98]]; // fiu fiu fiuuu
      const twoShort = [[0, 0.7, 98], [2, 0.7, 98]];

      const FULL = { s1: 1, s2: 1, s3: 1, cx: 1, tam: "carreteiro", ago: 0.8, choc: 1, rep: 0.8, cort: state.cort[0] };
      const harmony = [];
      let section = NAME[kind];
      let tempo = null;
      const lastRound = state.prevKind === "final";

      // ---------- melodic sections ----------
      if (kind === "verse" || kind === "refrao" || kind === "refraoUp") {
        const isVerse = kind === "verse", up = kind === "refraoUp" ? 2 : 0;
        const nth = isVerse ? (idx === 0 ? 1 : 2) : idx === 1 ? 1 : idx === 4 ? 2 : 3;
        const prog = progOf(isVerse ? VERSE_H : REFRAO_H, up);
        prog.forEach((h) => harmony.push(h));
        const chordAt = T.chordAtFactory(prog, BPB);
        const sym = (b) => chordAt(b).chord;
        const mel = isVerse ? VERSE_M : REFRAO_M;
        section = `${NAME[kind]} ${isVerse ? nth : nth === 3 ? "" : nth}`.trim();
        if (lastRound && isVerse) tempo = { bpm: 100, rampBeats: 0 };
        const breque = isVerse; // the band stops on the verse's last bar
        const ornate = round % 2 === 1 || nth === 2;

        state.bonesLast = null;
        // horns: the tune, a harmony a third or sixth below (from verse 2 / refrão 1 on), and an octave below in verse 1
        mel.forEach((n, i) => {
          const b = n.s * Q, m = n.note + up;
          const dur = n.len * Q * (n.len >= 2 ? 0.9 : 0.72);
          const vel = 0.7 + (n.s % 4 === 3 ? 0.1 : 0) + (n.len >= 4 ? 0.04 : 0) + r.gauss(0.03);
          if (ornate && n.len >= 3 && i > 0 && r.chance(0.3)) { // a quick upper-neighbour grace into long notes
            const g = T.step(m, 1, T.chord(sym(b)).scale);
            if (b - 0.125 >= 0) push("horns", b - 0.125, 0.11, g, vel * 0.7);
          }
          push("horns", b, dur, m, vel);
          if (isVerse && nth === 1) push("bones", b, dur, m - 12, vel * 0.85);
          else { const u = under(m, sym(b), state.bonesLast, n.len >= 4); state.bonesLast = u; push("bones", b, dur, u, vel * 0.85); }
          if ((!isVerse && nth >= 2) || (!isVerse && round % 2 === 1)) push("ala", b, Math.max(dur, 0.4), m - 12, 0.55 + (n.len >= 4 ? 0.05 : 0));
        });

        // cavaquinho: partido-alto chop, anticipating the next chord on the last 16th
        const CAV = [[[0, 0.72, 1], [2, 0.5, -1], [3, 0.68, 1], [5, 0.52, -1], [6, 0.7, 1]], [[1, 0.55, -1], [2, 0.7, 1], [4, 0.62, 1], [5, 0.5, -1], [7, 0.7, 1]]];
        for (let bar = 0; bar < BARS; bar++) {
          if (breque && bar === BARS - 1) {
            const v = voiceFor(sym(bar * BPB));
            push("cav", bar * BPB, 1.6, v, 0.72, { strum: 0.016 });
            continue;
          }
          CAV[bar % 2].forEach(([s, vel, dir]) => {
            const b = bar * BPB + s * Q;
            let at = sym(b);
            if (s === 7 && bar < BARS - 1) at = sym(b + Q);
            push("cav", b, s === 7 ? 0.24 : 0.2, voiceFor(at), vel * (isVerse ? 0.9 : 1), { strum: dir * 0.007 });
          });
        }

        // 7-string bass: root on 1, a ghost on the a, the fifth below on 2 (with the primeira); baixarias into new chords
        let last = state.bassLast ?? 50;
        for (let bar = 0; bar < BARS; bar++) {
          const here = prog.filter((h) => h.bar === bar);
          const nextSym = bar < BARS - 1 ? sym((bar + 1) * BPB) : (next.kind === "refrao" || next.kind === "refraoUp" ? trSym("D", next.kind === "refraoUp" ? 2 : 0) : "Dm");
          if (breque && bar === BARS - 1) { const c = T.chord(sym(bar * BPB)); push("seven", bar * BPB, 1.5, T.nearest(last, [c.bass], 40, 52), 0.72); continue; }
          if (here.length > 1) {
            here.forEach((h) => { const c = T.chord(h.chord); const n = T.nearest(last, [c.bass], 40, 53); push("seven", bar * BPB + h.beat, 0.85, n, 0.75); last = n; });
            continue;
          }
          const c = T.chord(sym(bar * BPB));
          const root = T.nearest(last, [c.bass], 40, 53);
          push("seven", bar * BPB, 0.68, root, 0.78);
          push("seven", bar * BPB + 0.75, 0.2, root, 0.36);
          const changes = nextSym !== c.sym;
          if (changes && (bar % 4 === 3 || r.chance(0.35))) {
            const target = T.nearest(root, [T.chord(nextSym).bass], 40, 53);
            const down = target <= root ? r.chance(0.75) : r.chance(0.25);
            for (let k = 0; k < 4; k++) {
              const n = k === 3 && r.chance(0.4) ? target + (down ? 1 : -1) : T.step(target, (down ? 1 : -1) * (4 - k), c.scale);
              push("seven", bar * BPB + 1 + k * Q, 0.22, Math.max(38, Math.min(57, n)), 0.6 + k * 0.04);
            }
            last = target;
          } else {
            const fifthPc = mod12(c.root + (c.intervals.find((x) => x === 6 || x === 7 || x === 8) ?? 7));
            const f = T.nearest(root - 5, [fifthPc], 38, 55);
            push("seven", bar * BPB + 1, 0.85, f, 0.8);
            last = root;
          }
        }
        state.bassLast = last;

        // the bateria under the singing
        for (let bar = 0; bar < BARS; bar++) {
          const g = isVerse
            ? { s1: 1, s2: 0.95, s3: 0.85, cx: nth === 1 ? 0.78 : 0.88, tam: "teleco", tamV: 0.85, ago: nth === 1 ? 0 : 0.5, choc: 0.9, rep: 0.45, cort: state.cort[1] }
            : { s1: 1, s2: 1, s3: 1, cx: 0.95, tam: bar >= 8 && nth >= 2 ? "carreteiro" : "teleco", ago: 0.75, choc: 1, rep: 0.55, cort: state.cort[2] };
          if (breque && bar === BARS - 1) { stopHit(bar, 0.9); continue; }
          if (breque && bar === BARS - 2) { g.roll = true; g.rep = 0; groove(bar, g); continue; }
          if (bar === BARS - 1) { g.tam = "virada"; g.roll = next.kind === "parada" || next.kind === "bossa" || next.kind === "final"; }
          if (bar === 0 && !isVerse) whistle(bar, 0, twoShort, 0.5); // the mestre urges the refrão on
          groove(bar, g);
        }
        if (breque) chamada(BARS - 2, 1, 0.75);
      }

      // ---------- all-percussion sections ----------
      else if (kind === "intro") {
        harmony.push({ bar: 0, beat: 0, dur: BARS * BPB, chord: "Dm" });
        whistle(0, 0, [[0, 3.5, 98], [5, 0.8, 93], [6, 1.5, 98]], 0.75);
        chamada(0, 0, 0.8); chamada(1, 1, 0.9);
        // the bateria enters in waves: surdos, then caixas and chocalhos, then tamborins and agogôs
        for (let bar = 2; bar < BARS; bar++) {
          const g = { ...FULL, cort: bar >= 10 ? state.cort[1] : state.cort[0] };
          if (bar < 4) Object.assign(g, { cx: 0, choc: 0, tam: null, ago: 0, rep: 0.6 });
          else if (bar < 6) Object.assign(g, { tam: null, ago: 0, rep: 0.6 });
          else if (bar < 8) g.ago = 0;
          if (bar === 5) g.roll = true;
          if (bar === 9 || bar === BARS - 1) { g.tam = "virada"; g.roll = bar === BARS - 1; }
          groove(bar, g);
        }
        whistle(6, 0, twoShort, 0.55);
        surdo("surdo3", P3, 1, 6, true, 0.7); surdo("surdo2", P2, 1, 7, true, 0.75); // surdos pick up into the entry
      } else if (kind === "parada") {
        harmony.push({ bar: 0, beat: 0, dur: BARS * BPB, chord: "D" });
        const ch = round % CHAMADA.length;
        for (let bar = 0; bar < 4; bar++) groove(bar, { ...FULL, ago: 1, tam: bar === 3 ? "virada" : "carreteiro", roll: bar === 3 });
        whistle(3, 0, tri, 0.75);
        // call and response: the repinique asks, each section answers
        stopHit(4, 0.95, 0); chamada(4, ch, 0.85);
        ANS.surdos.forEach((c, s) => { if (c === "O") { const v = 0.85; surdo("surdo3", P3, 5, s, true, v * 0.8); if (s >= 2) surdo("surdo2", P2, 5, s, true, v * 0.85); if (s >= 4) surdo("surdo1", P1, 5, s, true, v); } });
        chamada(6, (ch + 1) % CHAMADA.length, 0.8);
        tutti(7, ANS.small, { caixa: 1, tam: 1 }, 0.8);
        chamada(8, (ch + 2) % CHAMADA.length, 0.8);
        tutti(9, ANS.bells, { ago: 1, choc: 1 }, 0.85);
        chamada(10, (ch + 3) % CHAMADA.length, 0.9);
        tutti(11, ANS.tutti, ALL, 0.95);
        whistle(12, 0, [[0, 5, 98]], 0.8); // a dead stop: only the whistle
        for (let s = 5; s < 8; s++) hit("repique", 12, s, "timbale", 0.55 + s * 0.05, { pitch: 76 });
        for (let bar = 13; bar < BARS; bar++) {
          const g = { ...FULL, ago: 0.9, cort: state.cort[1] };
          if (bar === 13) { g.s1 = 1.05; }
          if (bar === 14) { g.rep = 0; chamada(bar, 0, 0.85); }
          if (bar === BARS - 1) { g.tam = "virada"; g.roll = true; }
          groove(bar, g);
        }
      } else if (kind === "bossa") {
        harmony.push({ bar: 0, beat: 0, dur: (BARS - 1) * BPB, chord: "D" });
        harmony.push({ bar: BARS - 1, beat: 0, dur: BPB, chord: "B7" }); // the cavaquinho's cue up a step
        for (let bar = 0; bar < 3; bar++) groove(bar, { ...FULL, cort: state.cort[2], tam: "teleco" });
        chamada(3, 2, 0.85);
        groove(3, { ...FULL, rep: 0, s3: 0, roll: true });
        // the bossa: a four-bar convenção in unison, chocalhos keep the time underneath
        const B = BOSSA[state.bossa];
        for (let bar = 4; bar < 8; bar++) {
          tutti(bar, B.slice((bar - 4) * 8, (bar - 3) * 8), { surdos: 1, caixa: 1, tam: 1, rep: 1, ago: 1 }, 0.9);
          groove(bar, { choc: 0.55 });
        }
        whistle(7, 4, twoShort, 0.6);
        // the surdos alone, then staggered re-entry
        groove(8, { s1: 1, s2: 1, s3: 1.1, cort: 3 });
        groove(9, { s1: 1, s2: 1, s3: 1.1, cort: 3, choc: 0.8 });
        groove(10, { s1: 1, s2: 1, s3: 1, cort: 3, choc: 0.9, cx: 0.9 });
        groove(11, { s1: 1, s2: 1, s3: 1, cort: 3, choc: 1, cx: 0.95, tam: "carreteiro", rep: 0.6 });
        for (let bar = 12; bar < 14; bar++) groove(bar, { ...FULL, ago: 1 });
        chamada(14, 1, 0.9); groove(14, { ...FULL, rep: 0, roll: true });
        stopHit(15, 0.95);
        if (next.kind === "refraoUp") push("cav", 15 * BPB, 1.7, voiceFor("B7"), 0.75, { strum: 0.018 });
        for (let s = 5; s < 8; s++) hit("repique", 15, s, "timbale", 0.5 + s * 0.05, { pitch: 76 });
      } else if (kind === "final") {
        harmony.push({ bar: 0, beat: 0, dur: BARS * BPB, chord: "E" });
        tempo = { bpm: 106, rampBeats: 24 };
        for (let bar = 0; bar < 12; bar++) {
          const g = { ...FULL, ago: 1, cort: (state.cort[0] + (bar >= 8 ? 1 : 0)) % CORT.length, rep: 0.9 };
          if (bar % 4 === 3) g.tam = "virada";
          groove(bar, g);
          if (bar % 4 === 0) whistle(bar, 0, twoShort, 0.55);
        }
        tutti(12, ANS.tutti, ALL, 0.95);
        tutti(13, pat("X..X..X."), ALL, 0.9);
        chamada(14, 3, 0.9); groove(14, { s1: 1, s2: 1, choc: 1, cx: 0.9, roll: true });
        stopHit(15, 1);
        whistle(15, 2, [[0, 0.7, 93], [1.5, 3, 98]], 0.75);
      }

      state.prevKind = kind;
      return { events: ev, harmony, section, state, tempo };

      // cavaquinho voicing: close, high, voice-led
      function voiceFor(symb) {
        const v = T.voice(symb.replace("b9b13", "b9"), { lo: 62, hi: 81, n: 4, rootless: false, prev: state.cavV, top: [72, 80], spread: "close" });
        state.cavV = v;
        return v;
      }
    },
  });

  /** A horn harmony a third or sixth under the tune, from the chord (or its scale for passing notes). */
  function under(m, sym, prev, long) {
    const c = T.chord(sym);
    const pref = { 3: 0, 4: 0, 8: 1.2, 9: 1, 5: 3, 7: 2.5, 6: 3.5 };
    let best = null, bs = Infinity;
    for (let d = 3; d <= 9; d++) {
      const x = m - d, pc = mod12(x);
      const tone = c.pcs.includes(pc);
      if (!tone && !c.scale.includes(pc)) continue;
      const s = pref[d] + (tone ? 0 : long ? 5 : 2.5) + (prev != null ? Math.abs(x - prev) * 0.4 : 0);
      if (s < bs) { bs = s; best = x; }
    }
    return best ?? m - 12;
  }
})();
