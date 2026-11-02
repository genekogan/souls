// Marina District: 1980s city pop / jazz-fusion instrumental for a coastal boulevard at golden hour.
//
// Form: one "drive" is twelve 8-bar phrases (96 bars, about 3½ minutes at 112):
//   intro · verse · verse · pre-chorus · chorus · chorus · break · break · pre-chorus (pivot) · LIFTED chorus ×2 · outro
// Drives alternate: A is home in F and lifts a whole step to G for the last chorus; B is home in E and lifts a
// half step to F. Each outro ends on its new tonic, which is a fourth (G → C) or a major third (F → Db) away from
// the next intro's opening bVImaj9#11, so the reset sounds like the next track on the record, not a drop.
//
// Harmony (all written in F and transposed):
//   chorus  the IVmaj7 – III7 – vi – v I7 loop (Bbmaj9 A7b13 Dm9 Cm9 F13) with a chromatic Dm9 – Db13#11 – Cm9 slide.
//           It never touches Imaj7: the second chorus ends on C13sus4, which goes deceptively to the break's IV,
//           and only the final chorus resolves, into the outro's Fmaj9 (I – bVII lydian, then a minor-plagal Bbm9 sigh).
//   verse   a chain of chromatic ii–Vs (Ebm9 Ab13 → Dbmaj9#11, Abm9 Db13 → Gbmaj9#11) and a backdoor Bbm9 Eb13 → F.
//   pre     a rising bass G A Bb C D Eb under falling 7-5-3 arpeggios whose top notes climb F G A Bb C;
//           the pivot version moves its last two bars up by the lift (the cadence itself is the modulation),
//           arriving at the new key's "v I7" and a band kime with the brass harmonising the lead.
//   break   lydian planing (Bbmaj9#11 Am9 Abmaj9#11) for a solo by whoever did not sing the verses: a gliding
//           Lyricon-ish synth on drive A, the soprano-sax-like lead on drive B; both quote the hook's rhythm.
// Groove: straight 16ths with a hair of push (swing 0.54 on 16ths), slap-style bass with octave pops and ghosts,
// DX-ish Rhodes stabs with 16th anticipations shared with the bass, brass answering the hook in its gaps, strings
// as glue, crash and fills marking the form, four-on-the-floor with open hats on the "and"s in the chorus.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;

  // ---------- form ----------
  const PHRASES = ["intro", "v1", "v2", "pre", "c1", "c2", "brk1", "brk2", "premod", "mc1", "mc2", "outro"];
  const LIFTED = new Set(["mc1", "mc2", "outro"]);
  const DRIVES = [{ home: 0, lift: 2 }, { home: -1, lift: 1 }]; // semitones relative to F
  const STYLE = { intro: "intro", v1: "verse", v2: "verse", pre: "pre", c1: "chorus", c2: "chorus", brk1: "break", brk2: "break", premod: "pre", mc1: "chorus", mc2: "chorus", outro: "outro" };

  const PROG_F = {
    intro: "| Dbmaj9#11 | Cm9 F13 | Bbmaj9 | Am9 | Dbmaj9#11 | Cm9 F13 | Bbmaj9 | Gm9 C13sus4 |",
    v1: "| Fmaj9 | Ebm9 Ab13 | Dbmaj9#11 | Gm9 C13 | Fmaj9 | Am9 D13 | Gm9 | Bbm9 Eb13 |",
    v2: "| Fmaj9 | Ebm9 Ab13 | Dbmaj9#11 | Gm9 C13 | Am9 | Abm9 Db13 | Gbmaj9#11 | Am7 D7#9 |",
    pre: "| Gm9 | Am9 | Bbmaj9#11 | C13sus4 | Dm9 | Ebmaj9#11 | Dm9 G7#9 | Cm9 F13 |",
    premod2: "| Gm9 | Am9 | Bbmaj9#11 | C13sus4 | Dm9 | Ebmaj9#11 | Em9 A7#9 | Dm9 G13 |",
    premod1: "| Gm9 | Am9 | Bbmaj9#11 | C13sus4 | Dm9 | Ebmaj9#11 | Ebm9 Ab7#9 | Dbm9 Gb13 |",
    c1: "| Bbmaj9 | A7b13 | Dm9 | Cm9 F13 | Bbmaj9 | A7#9 | Dm9 Db13#11 | Cm9 F13 |",
    c2: "| Bbmaj9 | A7b13 | Dm9 | Cm9 F13 | Bbmaj9 | A7#9 | Dm9 G13 | Gm9 C13sus4 |",
    brk1: "| Bbmaj9#11 | Bbmaj9#11 | Am9 | Am9 | Abmaj9#11 | Abmaj9#11 | Gm9 | C13sus4 C7#9 |",
    brk2: "| Fmaj9 | Ebmaj9#11 | Dbmaj9#11 | Cm9 F13 | Bbmaj9 | Bbm9 Eb13 | Am9 | D7#9 |",
    outro: "| Fmaj9 | Ebmaj9#11 | Fmaj9 | Ebmaj9#11 | Dbmaj9#11 | Cm9 F13 | Bbmaj9 Bbm9 | Fmaj9 |",
  };

  // ---------- tunes (in F) [bar, beat, dur, note] ----------
  // Hook: a three-times-sequenced cell (16th pickup, long note, falling chord shape) over IV, III7, vi, then a
  // rising answer that lands on the 9th of F13. The guide line under it is A – G – F – Eb – D.
  const HOOK_PICKUP = [[-1, 3.5, 0.25, "F5"], [-1, 3.75, 0.25, "G5"]];
  const HOOK_HEAD = [
    [0, 0, 0.75, "A5"], [0, 0.75, 0.25, "G5"], [0, 1, 0.5, "F5"], [0, 1.5, 1, "D5"], [0, 3.5, 0.25, "E5"], [0, 3.75, 0.25, "F5"],
    [1, 0, 0.75, "G5"], [1, 0.75, 0.25, "F5"], [1, 1, 0.5, "C#5"], [1, 1.5, 1, "A4"], [1, 3.5, 0.25, "G5"], [1, 3.75, 0.25, "A5"],
    [2, 0, 0.75, "C6"], [2, 0.75, 0.25, "A5"], [2, 1, 0.5, "G5"], [2, 1.5, 1, "E5"],
    [3, 0.5, 0.25, "C5"], [3, 0.75, 0.25, "Eb5"], [3, 1, 0.5, "G5"], [3, 1.5, 0.25, "Bb5"], [3, 1.75, 0.25, "A5"], [3, 2, 1.25, "G5"], [3, 3.5, 0.25, "F5"], [3, 3.75, 0.25, "G5"],
    [4, 0, 0.75, "A5"], [4, 0.75, 0.25, "G5"], [4, 1, 0.5, "F5"], [4, 1.5, 1, "D5"], [4, 3.5, 0.25, "E5"], [4, 3.75, 0.25, "F5"],
    // over A7#9 the cell bends: #9 to 3
    [5, 0, 0.75, "G5"], [5, 0.75, 0.25, "E5"], [5, 1, 0.5, "C5"], [5, 1.5, 1, "C#5"], [5, 3.5, 0.25, "D5"], [5, 3.75, 0.25, "E5"],
  ];
  const HOOK_TAIL_A = [ // Dm9 Db13#11 | Cm9 F13 — the #11 on the slide, then home to the pickup
    [6, 0, 0.75, "F5"], [6, 0.75, 0.25, "E5"], [6, 1, 0.5, "D5"], [6, 1.5, 0.5, "F5"], [6, 2, 0.75, "G5"], [6, 2.75, 0.25, "F5"], [6, 3, 1, "Eb5"],
    [7, 0.5, 0.25, "Bb4"], [7, 0.75, 0.25, "C5"], [7, 1, 0.5, "D5"], [7, 1.5, 0.5, "Eb5"], [7, 2, 1.25, "D5"], [7, 3.5, 0.25, "F5"], [7, 3.75, 0.25, "G5"],
  ];
  const HOOK_TAIL_B = [ // Dm9 G13 | Gm9 C13sus4 — B (3rd of G13) to Bb, up the Gm9 arpeggio, rest on the sus
    [6, 0, 0.75, "F5"], [6, 0.75, 0.25, "E5"], [6, 1, 0.5, "D5"], [6, 1.5, 0.5, "F5"], [6, 2, 0.75, "E5"], [6, 2.75, 0.25, "D5"], [6, 3, 1, "B4"],
    [7, 0, 0.5, "Bb4"], [7, 0.5, 0.5, "D5"], [7, 1, 0.5, "F5"], [7, 1.5, 0.5, "A5"], [7, 2, 1.75, "G5"],
  ];
  const HOOK_A = HOOK_PICKUP.concat(HOOK_HEAD, HOOK_TAIL_A);
  const HOOK_B = HOOK_HEAD.concat(HOOK_TAIL_B);

  // Verse: one rising-arpeggio cell (3-5-7 from the "a" of 1) sequenced down the chromatic ii–Vs.
  const VERSE_HEAD = [
    [0, 0.75, 0.25, "A4"], [0, 1, 0.5, "C5"], [0, 1.5, 0.75, "E5"], [0, 2.25, 0.25, "D5"], [0, 2.5, 1, "C5"],
    [1, 0.75, 0.25, "Bb4"], [1, 1, 0.5, "Db5"], [1, 1.5, 0.75, "F5"], [1, 2.25, 0.25, "Eb5"], [1, 2.5, 1, "C5"],
    [2, 0.75, 0.25, "Ab4"], [2, 1, 0.5, "C5"], [2, 1.5, 1, "G5"], [2, 2.5, 0.5, "F5"], [2, 3, 0.75, "Eb5"],
    [3, 0, 0.5, "D5"], [3, 0.5, 0.5, "Bb4"], [3, 1, 1, "A4"], [3, 2.5, 0.25, "Bb4"], [3, 2.75, 0.25, "D5"], [3, 3, 0.75, "E5"],
  ];
  const VERSE_TAIL_1 = [
    [4, 0.75, 0.25, "A4"], [4, 1, 0.5, "C5"], [4, 1.5, 0.5, "E5"], [4, 2, 1, "G5"],
    [5, 0.5, 0.25, "G5"], [5, 0.75, 0.25, "E5"], [5, 1, 0.5, "C5"], [5, 1.5, 0.5, "E5"], [5, 2, 0.75, "F#5"], [5, 2.75, 0.25, "E5"], [5, 3, 0.75, "C5"],
    [6, 0, 1.25, "Bb4"], [6, 1.5, 0.25, "D5"], [6, 1.75, 0.25, "F5"], [6, 2, 1, "A5"], [6, 3, 0.5, "G5"], [6, 3.5, 0.5, "F5"],
    [7, 0, 0.75, "Db5"], [7, 0.75, 0.25, "C5"], [7, 1, 1, "Ab4"], [7, 2.5, 0.25, "Bb4"], [7, 2.75, 0.25, "Db5"], [7, 3, 0.75, "C5"],
  ];
  const VERSE_TAIL_2 = [ // the cell planes down a half step (Am9 → Abm9), then climbs a Gbmaj9#11 to its #11
    [4, 0.75, 0.25, "C5"], [4, 1, 0.5, "E5"], [4, 1.5, 0.75, "G5"], [4, 2.25, 0.25, "E5"], [4, 2.5, 1, "B4"],
    [5, 0.75, 0.25, "B4"], [5, 1, 0.5, "Eb5"], [5, 1.5, 0.75, "Gb5"], [5, 2.25, 0.25, "F5"], [5, 2.5, 1, "Eb5"],
    [6, 0.75, 0.25, "Bb4"], [6, 1, 0.5, "Db5"], [6, 1.5, 0.5, "F5"], [6, 2, 0.5, "Ab5"], [6, 2.5, 1.25, "C6"],
    [7, 0, 0.5, "A5"], [7, 0.5, 0.5, "G5"], [7, 1, 0.5, "E5"], [7, 1.5, 0.5, "C5"], [7, 2, 0.5, "F5"], [7, 2.5, 1, "F#5"],
  ];
  // Pre-chorus: falling 7-5-3 in dotted quarters while the top climbs F G A Bb → C; #11 held over Ebmaj9#11.
  const PRE_HEAD = [
    [0, 0, 1.25, "F5"], [0, 1.5, 1.25, "D5"], [0, 3, 0.75, "Bb4"],
    [1, 0, 1.25, "G5"], [1, 1.5, 1.25, "E5"], [1, 3, 0.75, "C5"],
    [2, 0, 1.25, "A5"], [2, 1.5, 1.25, "F5"], [2, 3, 0.75, "E5"],
    [3, 0, 1.25, "Bb5"], [3, 1.5, 0.5, "A5"], [3, 2, 0.5, "G5"], [3, 2.5, 0.5, "F5"], [3, 3, 0.5, "G5"], [3, 3.5, 0.5, "A5"],
    [4, 0, 1.5, "C6"], [4, 1.5, 0.5, "A5"], [4, 2, 0.5, "F5"], [4, 2.5, 1.25, "E5"],
    [5, 0.5, 0.25, "G5"], [5, 0.75, 0.25, "Bb5"], [5, 1, 2, "A5"], [5, 3, 0.5, "G5"], [5, 3.5, 0.5, "F5"],
  ];
  const PRE_TAIL = [ // #9 → 3 over G7#9, then up Cm9 to the 7th of F13 (leaves room for the hook pickup)
    [6, 0, 1, "E5"], [6, 1, 0.5, "F5"], [6, 1.5, 0.5, "D5"], [6, 2, 0.5, "F5"], [6, 2.5, 0.5, "Bb4"], [6, 3, 0.75, "B4"],
    [7, 0, 0.5, "C5"], [7, 0.5, 0.5, "Eb5"], [7, 1, 0.75, "G5"], [7, 1.75, 0.25, "F5"], [7, 2, 1.25, "Eb5"],
  ];
  const INTRO_TEASE = [[5, 3.5, 0.25, "F5"], [5, 3.75, 0.25, "G5"], [6, 0, 0.75, "A5"], [6, 0.75, 0.25, "G5"], [6, 1, 0.5, "F5"], [6, 1.5, 1.75, "D5"]];
  const OUTRO = [
    [0, 0, 1.75, "A5"], [0, 2.5, 0.25, "G5"], [0, 2.75, 0.75, "E5"],
    [1, 0.5, 0.25, "F5"], [1, 0.75, 0.25, "G5"], [1, 1, 1.5, "A5"], [1, 3, 0.5, "G5"],
    [2, 0.5, 0.25, "G5"], [2, 0.75, 0.25, "A5"], [2, 1, 1, "C6"], [2, 2, 0.5, "A5"], [2, 2.5, 1, "G5"],
    [3, 0, 1, "F5"], [3, 1, 0.5, "D5"], [3, 1.5, 1.5, "Bb4"],
    [4, 0.5, 0.25, "C5"], [4, 0.75, 0.25, "Eb5"], [4, 1, 1.5, "G5"], [4, 2.5, 0.5, "F5"], [4, 3, 0.5, "Eb5"],
    [5, 0, 0.75, "D5"], [5, 0.75, 0.25, "Eb5"], [5, 1, 1, "G5"], [5, 2, 0.75, "A5"], [5, 2.75, 0.25, "G5"], [5, 3, 0.75, "Eb5"],
    [6, 0, 1.75, "D5"], [6, 2, 1.5, "Db5"],
    [7, 0, 3.5, "C5"],
  ];
  // The hook's opening cell as a C.line motif, so the solos quote it now and then.
  const HOOK_MOTIF = { len: 4, rhythm: [{ off: 0, dur: 0.75 }, { off: 0.75, dur: 0.25 }, { off: 1, dur: 0.5 }, { off: 1.5, dur: 1 }], steps: [0, -1.25, -1.25, -1.9] };

  // ---------- comping rhythms: [beat, dur] per chord span (negative = 16th anticipation) ----------
  const K4 = {
    sparse: [[[[0, 1.6], [2.5, 1.2]], 3], [[[0, 0.6], [1.5, 2]], 2], [[[0.5, 0.4], [2.75, 1]], 1.5]],
    mid: [[[[0, 0.6], [1.5, 0.25], [2.75, 0.75]], 3], [[[0.5, 0.25], [1, 0.5], [2.5, 1]], 2], [[[-0.25, 0.9], [1.5, 0.25], [2.5, 0.5]], 2], [[[0, 0.25], [0.75, 0.75], [2.5, 0.25], [3, 0.6]], 1.5]],
    busy: [[[[0, 0.25], [0.75, 0.5], [1.5, 0.25], [2.5, 0.25], [3, 0.5]], 2], [[[-0.25, 0.5], [0.5, 0.25], [1.5, 0.5], [2.75, 0.5]], 2.5], [[[0, 0.5], [1, 0.25], [1.75, 0.5], [2.75, 0.25], [3.25, 0.5]], 1.5], [[[-0.25, 0.75], [1.25, 0.25], [1.5, 0.5], [3, 0.5]], 1.5]],
    sus: [[[[0, 1.4], [1.5, 0.25], [2.5, 1.2]], 2], [[[0, 3.6]], 1.5], [[[0, 1.75], [2, 1.6]], 2]],
  };
  const K2 = {
    sparse: [[[[0, 1.6]], 3], [[[0.5, 1.2]], 1]],
    mid: [[[[0, 0.75], [1.5, 0.25]], 3], [[[-0.25, 0.75], [1, 0.3]], 2], [[[0, 0.25], [0.75, 0.75]], 2]],
    busy: [[[[0, 0.25], [0.75, 0.5], [1.5, 0.25]], 2], [[[-0.25, 0.5], [0.5, 0.25], [1.25, 0.5]], 2.5], [[[0, 0.5], [1, 0.25], [1.5, 0.25]], 1.5]],
    sus: [[[[0, 1.75]], 2], [[[0, 0.75], [1, 0.75]], 1]],
  };
  const KEYS_DENSITY = { intro: "sparse", verse: "mid", pre: "sus", chorus: "mid", break: "sparse", outro: "sparse" };
  const PUSH_OK = { intro: false, verse: true, pre: false, chorus: true, break: true, outro: false };

  // ---------- bass: [beat, role, dur, vel]; R root, O octave pop, F fifth, S seventh, G ghost, A approach ----------
  const B4 = {
    finger: [
      [[0, "R", 0.7, 0.85], [0.75, "R", 0.2, 0.6], [1.5, "O", 0.25, 0.8], [2, "R", 0.45, 0.75], [2.75, "F", 0.25, 0.65], [3.5, "O", 0.2, 0.7], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 1.2, 0.85], [1.5, "F", 0.25, 0.7], [1.75, "O", 0.25, 0.75], [2.5, "R", 0.45, 0.75], [3.25, "G", 0.08, 0.3], [3.5, "S", 0.2, 0.7], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.4, 0.85], [0.5, "G", 0.08, 0.3], [0.75, "R", 0.25, 0.7], [1.5, "R", 0.7, 0.75], [2.5, "F", 0.25, 0.7], [2.75, "O", 0.45, 0.75], [3.5, "S", 0.2, 0.65], [3.75, "A", 0.2, 0.7]],
    ],
    slap: [
      [[0, "R", 0.4, 0.9], [0.75, "R", 0.2, 0.65], [1, "O", 0.2, 0.9], [1.5, "G", 0.08, 0.35], [1.75, "R", 0.2, 0.7], [2.5, "O", 0.2, 0.9], [3, "R", 0.25, 0.75], [3.5, "O", 0.2, 0.85], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.3, 0.9], [0.5, "O", 0.2, 0.85], [0.75, "R", 0.2, 0.6], [1.5, "O", 0.2, 0.9], [2, "R", 0.3, 0.8], [2.25, "G", 0.08, 0.3], [2.5, "F", 0.2, 0.7], [2.75, "O", 0.2, 0.85], [3.5, "S", 0.2, 0.75], [3.75, "A", 0.2, 0.7]],
      [[0, "R", 0.6, 0.9], [1, "O", 0.2, 0.9], [1.25, "G", 0.08, 0.3], [1.5, "R", 0.2, 0.7], [2, "F", 0.3, 0.75], [2.5, "O", 0.2, 0.9], [3, "R", 0.2, 0.7], [3.25, "O", 0.2, 0.85], [3.75, "A", 0.2, 0.7]],
    ],
    pump: [[[0, "R", 0.4, 0.85], [0.5, "R", 0.3, 0.6], [1, "R", 0.4, 0.75], [1.5, "O", 0.25, 0.8], [2, "R", 0.4, 0.8], [2.5, "R", 0.3, 0.6], [3, "R", 0.4, 0.75], [3.5, "O", 0.25, 0.8]]],
    sparse: [[[0, "R", 1.4, 0.85], [1.5, "O", 0.25, 0.7], [2.5, "R", 0.9, 0.75], [3.5, "F", 0.2, 0.6], [3.75, "A", 0.2, 0.65]], [[0, "R", 2.4, 0.85], [2.5, "F", 0.4, 0.7], [3.25, "O", 0.25, 0.65], [3.75, "A", 0.2, 0.6]]],
  };
  const B2 = {
    finger: [[[0, "R", 0.5, 0.85], [0.75, "R", 0.2, 0.6], [1.25, "O", 0.2, 0.75], [1.75, "A", 0.2, 0.7]], [[0, "R", 0.9, 0.85], [1, "F", 0.25, 0.7], [1.5, "O", 0.2, 0.75], [1.75, "A", 0.2, 0.7]]],
    slap: [[[0, "R", 0.3, 0.9], [0.5, "O", 0.2, 0.85], [0.75, "R", 0.2, 0.6], [1.25, "O", 0.2, 0.85], [1.75, "A", 0.2, 0.7]], [[0, "R", 0.4, 0.9], [1, "O", 0.2, 0.9], [1.25, "G", 0.08, 0.3], [1.5, "F", 0.2, 0.7], [1.75, "A", 0.2, 0.7]]],
    pump: [[[0, "R", 0.4, 0.85], [0.5, "R", 0.3, 0.6], [1, "R", 0.4, 0.75], [1.5, "O", 0.25, 0.8]]],
    sparse: [[[0, "R", 1.4, 0.85], [1.5, "O", 0.25, 0.7]]],
  };
  const BASS_STYLE = { intro: "sparse", verse: "finger", pre: "pump", chorus: "slap", break: "slap", outro: "finger" };

  // Brass answers in the hook's gaps, per chorus bar: [beat, dur]. Anything that would cover a melody onset is dropped.
  const BRASS_CHORUS = { 0: [[2.75, 0.35]], 1: [[2.5, 0.2], [3, 0.4]], 2: [[2.75, 0.25], [3.25, 0.5]], 3: [[0, 0.35]], 4: [[2.75, 0.35]], 5: [[2.5, 0.2], [3, 0.4]] };

  // ---------- spelling & transposition ----------
  const FLAT = T.NAMES, SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function spell(pc, tonic) {
    pc = mod12(pc);
    const sharpKey = [7, 2, 9, 4, 11].includes(tonic);
    if (!sharpKey) return FLAT[pc];
    if (pc === 6 || pc === 1) return SHARP[pc];
    if (pc === 8 && [4, 9, 11].includes(tonic)) return SHARP[pc];
    if (pc === 3 && [4, 11].includes(tonic)) return SHARP[pc];
    return FLAT[pc];
  }
  function trChord(sym, t) {
    if (!t) return sym;
    const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
    const tonic = mod12(5 + t);
    return spell(T.PC[m[1]] + t, tonic) + m[2] + (m[3] ? "/" + spell(T.PC[m[3]] + t, tonic) : "");
  }
  const progCache = new Map();
  function progFor(name, D) {
    const t = D.home + (LIFTED.has(name) ? D.lift : 0);
    const src = name === "premod" ? `premod${D.lift}` : name === "mc1" ? "c1" : name === "mc2" ? "c2" : name;
    const k = `${src}|${t}`;
    if (!progCache.has(k)) {
      const text = PROG_F[src].split(/\s+/).map((tok) => (tok === "|" || tok === "" || tok === "%" ? tok : trChord(tok.split(":")[0], t) + (tok.includes(":") ? ":" + tok.split(":")[1] : ""))).join(" ");
      progCache.set(k, T.progression(text));
    }
    return { prog: progCache.get(k), t };
  }
  const keyName = (t) => FLAT[mod12(5 + t)].replace("Gb", "F♯").replace("b", "♭");

  function melodyFor(name, D) {
    switch (name) {
      case "intro": return INTRO_TEASE;
      case "v1": return VERSE_HEAD.concat(VERSE_TAIL_1);
      case "v2": return VERSE_HEAD.concat(VERSE_TAIL_2);
      case "pre": return PRE_HEAD.concat(PRE_TAIL);
      case "premod": return PRE_HEAD.concat(PRE_TAIL.map(([b, x, d, n]) => [b, x, d, T.midi(n) + D.lift]));
      case "c1": case "mc1": return HOOK_A;
      case "c2": case "mc2": return HOOK_B;
      case "outro": return OUTRO;
      default: return null;
    }
  }

  // Four close voices with the melody note on top (brass soli under the lead).
  function soli(top, sym) {
    const c = T.chord(sym);
    const pref = c.guide.concat(c.colors, [mod12(c.root + 7), c.root]);
    const out = [top];
    let cur = top;
    for (let k = 0; k < 3; k++) {
      let pick = null, best = Infinity;
      for (let m = cur - 2; m >= cur - 5 && m > top - 12; m--) {
        const rank = pref.indexOf(mod12(m));
        if (rank < 0 || out.some((x) => mod12(x) === mod12(m))) continue;
        if (rank < best) { best = rank; pick = m; }
      }
      if (pick == null) break;
      out.push(pick); cur = pick;
    }
    return out.sort((a, b) => a - b);
  }

  // T.voice, but reject minor 9ths between any two voices, any adjacent semitone, and seconds below G3.
  const rough = (v) => v.some((a, i) => v.some((b, j) => j > i && Math.abs(b - a) === 13)) ||
    v.some((a, i) => i > 0 && (a - v[i - 1] === 1 || (v[i - 1] < 55 && a - v[i - 1] <= 2)));
  function voiceClean(sym, opts) {
    const n = opts.n ?? 4, wide = { ...opts, lo: opts.lo - 2, hi: opts.hi + 3 };
    const tries = [opts, { ...opts, spread: "close" }, { ...opts, spread: "drop2" }, { ...opts, lo: opts.lo + 2 }, { ...opts, n: n - 1 }, { ...opts, n: n - 1, spread: "close" }, wide, { ...wide, n: n - 1 }, { ...wide, n: n - 1, lo: opts.lo + 1 }];
    let first = null;
    for (const o of tries) {
      const v = T.voice(sym, o);
      first = first || v;
      if (!rough(v)) return v;
    }
    return first;
  }

  Sim.register({
    id: "marina-district",
    title: "Marina District",
    genre: "City pop",
    about: "Golden-hour city pop and fusion: slap bass, DX Rhodes and brass stabs under a soprano-sax-like hook on the IVmaj7–III7–vi loop. Each 3½-minute drive runs intro, verses, pre-chorus, chorus, a solo break and a final chorus lifted a whole or half step.",
    bpm: 112, beatsPerBar: 4, swing: 0.54, swingUnit: 0.25, cycleBars: 8, gainDb: -2,

    instruments(ctx) {
      const { I, out } = ctx;
      const plate = I.reverb(ctx, out, { decay: 1.7, preDelay: 0.012, lowcut: 350, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.03, lowcut: 400, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.24, pingPong: true, highcut: 3200 });

      const lead = I.oboe(ctx, { volume: 0, cutoff: 5200, base: 1150, octaves: 2, vibrato: 5.4, vibratoDepth: 0.04, attack: 0.03, glide: 0.03, breath: -28, breathFreq: 2600 });
      const synth = I.analog(ctx, { volume: -3, wave: "sawtooth", resonance: 1.6, base: 850, octaves: 2.4, attack: 0.012, decay: 0.45, sustain: 0.65, release: 0.18, glide: 0.045, filterDecay: 0.35 });
      const keys = I.rhodes(ctx, { volume: -6, cutoff: 5200, bark: 2.7, tine: -9, tremolo: 4.2, tremoloDepth: 0.16 });
      const brass = I.synthBrass(ctx, { volume: -8, attack: 0.012, swell: 0.05, release: 0.22, base: 650, octaves: 3 });
      const strings = I.strings(ctx, { volume: -15, attack: 0.7, release: 1.6, cutoff: 3200 });
      const glock = I.glock(ctx, { volume: -17, decay: 1.6 });
      const bass = I.ebass(ctx, { volume: -4, base: 230 });
      const kit = I.kit(ctx, { volume: -1, kickNote: 31, preload: ["kick", "snare", "hatClosed", "hatOpen", "tom", "snap", "rim"] });

      // crash: white noise through a highpass, long decay
      const crashOut = ctx.keep(new Tone.Gain(Math.pow(10, -10 / 20)));
      const crashPan = ctx.keep(new Tone.Panner(0.28));
      crashOut.connect(crashPan); crashPan.connect(out);
      const crashHp = ctx.keep(new Tone.Filter({ frequency: 4200, type: "highpass" }));
      crashHp.connect(crashOut);
      const crash = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 1.7, sustain: 0, release: 0.4 } }));
      crash.connect(crashHp);
      const crashT = I.monotonic(crash);
      I.send(ctx, crashOut, plate, -14);

      const lp = I.place(ctx, lead, 0.04, out), sp = I.place(ctx, synth, -0.1, out);
      const kp = I.place(ctx, keys, -0.3, out), bp = I.place(ctx, brass, 0.3, out);
      const stp = I.place(ctx, strings, 0, out), gp = I.place(ctx, glock, 0.4, out);
      I.place(ctx, bass, 0, out); const dp = I.place(ctx, kit, 0, out);
      I.send(ctx, lp, hall, -14); I.send(ctx, lp, echo, -19);
      I.send(ctx, sp, hall, -15); I.send(ctx, sp, echo, -14);
      I.send(ctx, kp, plate, -13); I.send(ctx, bp, hall, -11); I.send(ctx, bp, plate, -14);
      I.send(ctx, stp, hall, -8); I.send(ctx, gp, hall, -10); I.send(ctx, gp, echo, -15);
      I.send(ctx, dp, plate, -17);

      return {
        lead: { layer: "melody", play: (t, e, d) => lead.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        synth: { layer: "melody", play: (t, e, d) => synth.play(t, e.note, d, e.vel), humanize: { timing: 0.006, vel: 0.05 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.005, vel: 0.06 } },
        brass: { layer: "harmony", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.04 } },
        strings: { layer: "texture", play: (t, e, d) => strings.play(t, e.note, d, e.vel), humanize: { timing: 0.01, vel: 0.03 } },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        drums: {
          layer: "drums",
          play: (t, e) => { if (e.note === "crash") crash.triggerAttackRelease(1.4, crashT(t), e.vel); else kit.hit(e.note, t, e.vel, { pitch: e.pitch }); },
          humanize: { timing: 0.004, vel: 0.08 },
        },
      };
    },

    compose({ cycle, rng: r, state }) {
      const drive = Math.floor(cycle / 12), pos = cycle % 12;
      const name = PHRASES[pos], style = STYLE[name];
      const D = DRIVES[drive % 2];
      const firstDrive = drive === 0;
      const { prog, t: key } = progFor(name, D);
      const nextName = PHRASES[(pos + 1) % 12];
      const nextD = pos === 11 ? DRIVES[(drive + 1) % 2] : D;
      const nextFirst = progFor(nextName, nextD).prog[0].chord;
      const chordAt = T.chordAtFactory(prog);
      const sym = (b) => chordAt(b).chord;
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => { const p = C.at(abs, 4); ev.push({ track, bar: p.bar, beat: p.beat, dur, note, vel, ...extra }); };
      const lifted = LIFTED.has(name);
      const kime = name === "premod" || name === "brk2" ? 28 : null; // bar 7 is a band hit

      // ---------- melody ----------
      const mel = []; // {beat, dur, note, vel}
      const src = melodyFor(name, D);
      const melInst = style === "verse" && drive % 2 === 1 ? "synth" : "lead"; // drive B: the synth sings the verses
      if (src) {
        for (const [b, x, d, n] of src) {
          const note = (typeof n === "number" ? n : T.midi(n)) + key;
          mel.push({ beat: b * 4 + x, dur: d, note });
        }
        // later drives ornament long notes with a 16th upper-neighbour turn
        const amt = drive === 0 ? 0 : style === "verse" ? 0.22 : name === "mc1" || name === "mc2" ? 0.15 : style === "pre" ? 0.1 : 0;
        if (amt) {
          for (let i = mel.length - 1; i >= 0; i--) {
            const n = mel[i];
            if (n.dur < 1 || n.beat < 0 || !r.chance(amt)) continue;
            const up = T.step(n.note, 1, T.chord(sym(n.beat + n.dur - 0.5)).scale);
            if (up - n.note > 2) continue;
            mel.splice(i, 1, { beat: n.beat, dur: n.dur - 0.5, note: n.note }, { beat: n.beat + n.dur - 0.5, dur: 0.25, note: up }, { beat: n.beat + n.dur - 0.25, dur: 0.25, note: n.note });
          }
        }
        const fade = name === "outro" ? (b) => 1 - 0.035 * Math.floor(b / 4) : () => 1;
        const base = style === "verse" ? 0.68 : style === "chorus" ? 0.78 : style === "pre" ? 0.72 : 0.7;
        mel.forEach((n) => {
          const onBar = mod(n.beat, 4) < 1e-6;
          n.vel = (base + (n.dur >= 1 ? 0.05 : n.dur <= 0.25 ? -0.08 : 0) + (onBar ? 0.04 : 0)) * fade(Math.max(0, n.beat));
          push(melInst, n.beat, n.dur >= 0.5 ? n.dur - 0.04 : n.dur, n.note, n.vel * (melInst === "synth" ? 0.92 : 1));
          if (lifted && name !== "outro" && n.dur >= 0.75) push("glock", n.beat, 1, n.note + 12, 0.32);
        });
      } else if (style === "break") {
        // solo: synth on drive A, sax on drive B (whoever did not sing the verses)
        const inst = drive % 2 === 0 ? "synth" : "lead";
        const end = name === "brk2" ? 27.5 : 31.5;
        const m = C.line({
          start: 0, end, chordAt: sym, lo: 67, hi: 86, rng: r.fork(7), density: inst === "lead" ? 0.5 : 0.6,
          phrase: [4, 8], rest: [1, 2.5], motif: state.soloMotif || HOOK_MOTIF, motifProb: 0.35, chromatic: 0.3,
          register: 0.6, prev: name === "brk1" ? 79 + key : state.soloLast, upbeatStart: 0.5, lead: name === "brk1" ? 0.5 : 0,
        });
        state.soloMotif = m.motif; state.soloLast = m.last;
        const notes = m.notes;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i], nx = notes[i + 1];
          // fusion flavour: some 8ths become two 16ths with a chromatic approach into the next note
          if (!n.strong && nx && Math.abs(n.dur - 0.46) < 0.05 && Math.abs(nx.beat - n.beat - 0.5) < 1e-6 && r.chance(inst === "synth" ? 0.3 : 0.18)) {
            const app = nx.note + (r.chance(0.6) ? -1 : 1);
            mel.push({ beat: n.beat, dur: 0.25, note: n.note }, { beat: n.beat + 0.25, dur: 0.25, note: app === n.note ? n.note + 2 : app });
          } else mel.push({ beat: n.beat, dur: n.dur, note: n.note });
        }
        mel.forEach((n) => push(inst, n.beat, n.dur, n.note, 0.62 + (n.dur >= 1 ? 0.08 : 0) + (mod(n.beat, 1) < 1e-6 ? 0.04 : 0) + r.gauss(0.03)));
      }
      const melAt = (b) => { const n = mel.find((x) => x.beat <= b + 1e-6 && x.beat + x.dur > b + 1e-6); return n ? n.note : null; };
      const onsetNear = (b, before, after) => mel.some((x) => x.beat > b - before && x.beat < b + after);

      // ---------- keys (Rhodes) ----------
      const dens = KEYS_DENSITY[style];
      const pushed = prog.map(() => false);
      const keyRange = style === "chorus" ? { lo: 52, hi: 72, top: [62, 69] } : style === "verse" ? { lo: 50, hi: 67, top: [58, 64], n: 3 } : { lo: 52, hi: 73, top: [62, 70] };
      const voicings = prog.map((c) => {
        const v = voiceClean(c.chord, { lo: keyRange.lo, hi: keyRange.hi, n: keyRange.n ?? 4, prev: state.kv, top: keyRange.top, rng: r });
        state.kv = v;
        return v;
      });
      const keysHits = prog.map((c, i) => {
        const s0 = c.bar * 4 + c.beat;
        const set = (c.dur >= 4 ? K4 : K2)[dens];
        let pats = set;
        if (s0 === 0 || !PUSH_OK[style] || (kime != null && s0 >= kime)) pats = set.filter(([p]) => p[0][0] >= 0);
        const pat = r.weighted(pats);
        if (pat[0][0] < 0) pushed[i] = true;
        return pat.map(([b, d]) => ({ at: s0 + b, d }));
      });
      const firstIntro = name === "intro" && firstDrive;
      keysHits.forEach((hs, i) => {
        const nextStart = i + 1 < keysHits.length ? Math.min(...keysHits[i + 1].map((h) => h.at)) : 32;
        for (const h of hs) {
          if (h.at >= nextStart - 0.2) continue;
          if (kime != null && h.at >= kime) continue;
          if (name === "outro" && h.at >= 28) continue;
          const vel = (style === "chorus" ? 0.52 : style === "verse" ? 0.46 : 0.44) + (h === hs[0] ? 0.05 : 0) + r.range(-0.04, 0.04);
          push("keys", h.at, Math.max(0.15, Math.min(h.d, nextStart - h.at - 0.05)), voicings[i], vel * (firstIntro && h.at < 8 ? 0.85 : 1));
        }
      });
      if (name === "outro") push("keys", 28, 3.8, voicings[voicings.length - 1], 0.42);

      // ---------- bass ----------
      const bassEv = [];
      let lastRoot = state.bassRoot ?? 34;
      const rootOf = (pc, near) => T.nearest(near, [pc], 28, 40);
      prog.forEach((c, i) => {
        const ch = T.chord(c.chord), s0 = c.bar * 4 + c.beat;
        const root = rootOf(ch.bass, lastRoot);
        lastRoot = root;
        const nextSym = i + 1 < prog.length ? prog[i + 1].chord : nextFirst;
        const nc = T.chord(nextSym), nextRoot = rootOf(nc.bass, root);
        const fifthIv = ch.intervals.find((x) => x === 7 || x === 6 || x === 8);
        const fifth = root + (fifthIv ?? 10);
        const sevIv = ch.intervals.find((x) => x === 10 || x === 11) ?? (ch.intervals.includes(9) ? 9 : 12);
        const seventh = root + (sevIv === 11 ? 7 : sevIv); // a major 7th in the bass sounds wrong here: use the 5th
        let app;
        if (nc.bass === ch.bass) app = fifth;
        else {
          const below = nextRoot - 1, above = nextRoot + 1, sc = new Set(ch.scale);
          app = sc.has(mod12(below)) ? below : sc.has(mod12(above)) ? above : below;
        }
        const roleNote = { R: root, O: root + 12, F: fifth, S: seventh, G: root, A: app };
        let bstyle = BASS_STYLE[style];
        if (style === "intro" && c.bar >= 4 && !firstDrive) bstyle = "finger";
        if (style === "outro" && c.bar >= 5) bstyle = "sparse";
        if (style === "pre" && c.bar < 2) bstyle = "finger";
        if (name === "brk1") bstyle = "finger";
        if (!state.groove || state.grooveFor !== cycle) { state.groove = {}; state.grooveFor = cycle; }
        const gkey = `${bstyle}${c.dur >= 4 ? 4 : 2}`;
        const lib = (c.dur >= 4 ? B4 : B2)[bstyle];
        if (state.groove[gkey] == null) state.groove[gkey] = r.int(0, lib.length - 1);
        const tpl = r.chance(0.22) ? r.pick(lib) : lib[state.groove[gkey]];
        for (const [b, role, d, v] of tpl) {
          if (b >= c.dur) continue;
          bassEv.push({ at: s0 + b, dur: d, note: roleNote[role], vel: v * (role === "G" ? 1 : style === "verse" || style === "intro" ? 0.92 : 1), chord: i, pos: b });
        }
      });
      state.bassRoot = lastRoot;
      // shared anticipations: a pushed chord's root lands on the last 16th of the previous chord and ties over
      prog.forEach((c, i) => {
        if (!pushed[i]) return;
        const s0 = c.bar * 4 + c.beat;
        for (let k = bassEv.length - 1; k >= 0; k--) {
          const e = bassEv[k];
          if ((e.chord === i - 1 && e.at >= s0 - 0.25 - 1e-6) || (e.chord === i && e.pos === 0)) bassEv.splice(k, 1);
        }
        const first = bassEv.find((e) => e.chord === i);
        const root = rootOf(T.chord(c.chord).bass, first ? first.note : lastRoot);
        bassEv.push({ at: s0 - 0.25, dur: 0.75, note: root, vel: 0.88, chord: i, pos: -0.25 });
      });
      const bassOn = !firstIntro;
      for (const e of bassEv) {
        if (!bassOn && e.at < 8) continue;
        if (kime != null && e.at >= kime) continue;
        if (name === "outro" && e.at >= 28) continue;
        push("bass", e.at, e.dur, Math.max(28, Math.min(52, e.note)), e.vel);
      }
      if (name === "outro") push("bass", 28, 3.6, rootOf(T.chord(prog[prog.length - 1].chord).bass, 34), 0.8);

      // ---------- kime (band hits) ----------
      const kimeHits = name === "premod" ? [[0, 0.45], [1, 0.6], [1.75, 0.22], [2, 0.9]] : [[0, 0.4], [0.75, 0.4], [1.5, 0.35], [2.5, 0.6]];
      if (kime != null) {
        kimeHits.forEach(([b, d]) => {
          const at = kime + b, s = sym(at), ch = T.chord(s);
          push("bass", at, d, rootOf(ch.bass, 36), 0.92);
          const v = voiceClean(s, { lo: 52, hi: 74, n: 4, prev: state.kv, top: [64, 72] });
          state.kv = v;
          push("keys", at, d, v, 0.58);
          if (name === "brk2") {
            const bv = voiceClean(s, { lo: 60, hi: 81, n: 4, prev: state.bv, top: [74, 81] });
            state.bv = bv;
            push("brass", at, d, bv, 0.62);
          }
        });
      }

      // ---------- brass ----------
      if (style === "chorus") {
        for (let bar = 0; bar < 8; bar++) {
          const figs = (BRASS_CHORUS[bar] || []).slice();
          if (bar === 7 && (name === "c1" || name === "mc1")) figs.push([0, 0.35]);
          if (bar === 7 && (name === "c2" || name === "mc2")) figs.push([2, 0.6]);
          for (const [b, d] of figs) {
            const at = bar * 4 + b;
            if (onsetNear(at, 0.05, 0.25) && !(bar === 7 && b === 2)) continue;
            const m = melAt(at);
            const hi = m != null ? Math.min(81, m - 1) : 79;
            const s = sym(at);
            const v = m != null && bar === 7 && b === 2 ? soli(m, s).slice(0, -1).concat([m]) : voiceClean(s, { lo: Math.min(58, hi - 14), hi, n: 4, prev: state.bv, top: [hi - 5, hi] });
            state.bv = v;
            push("brass", at, d, v, (lifted ? 0.66 : 0.6) + (b === 0 ? 0.04 : 0));
          }
        }
      } else if (style === "pre") {
        // tutti: the brass harmonises the lead in close position for the closing bars
        const from = name === "premod" ? 24 : 28;
        mel.filter((n) => n.beat >= from && (n.dur >= 0.5 || n.beat >= 28)).forEach((n) => {
          const v = soli(n.note, sym(n.beat));
          state.bv = v;
          push("brass", n.beat, Math.min(n.dur, 1.2) - 0.05, v, n.beat >= 28 ? 0.66 : 0.56);
        });
      } else if (name === "v2") {
        push("brass", 14, 0.3, voiceClean(sym(14), { lo: 58, hi: 76, n: 4, top: [72, 76] }), 0.5);
      } else if (name === "intro" && !firstDrive) {
        const v1 = voiceClean(sym(16), { lo: 58, hi: 79, n: 4, top: [74, 79] });
        push("brass", 16, 1.2, v1, 0.5);
        const v2 = voiceClean(sym(30), { lo: 58, hi: 77, n: 4, prev: v1, top: [72, 77] });
        push("brass", 30, 0.25, v2, 0.55); push("brass", 30.75, 0.6, v2, 0.6);
        state.bv = v2;
      }

      // ---------- strings (glue) ----------
      const strOn = style === "pre" || style === "chorus" || name === "brk2" || (name === "outro");
      if (strOn) {
        prog.forEach((c) => {
          const s0 = c.bar * 4 + c.beat;
          if (name === "brk2" && s0 >= 28) return;
          const v = T.voice(c.chord, { lo: 55, hi: 72, n: 2, prev: state.sv, top: [62, 70] });
          state.sv = v;
          const vel = (style === "chorus" ? 0.4 : 0.32) * (name === "outro" ? 0.9 : 1);
          push("strings", s0, c.dur + 0.1, v, vel);
          if (lifted && name !== "outro") push("strings", s0, c.dur + 0.1, [v[v.length - 1] + 12], vel * 0.7);
        });
      }

      // ---------- drums ----------
      const D_ = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, vel, extra);
      const hats = (bar, mode, openAts = []) => {
        for (let s = 0; s < 16; s++) {
          const b = s / 4, at = bar * 4 + b;
          if (openAts.some((o) => Math.abs(o - b) < 1e-6)) { D_(at, "hatOpen", 0.36); continue; }
          if (mode === "8" && s % 2) continue;
          const v = s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.42 : 0.24;
          D_(at, "hatClosed", v + r.range(-0.03, 0.03));
        }
      };
      const fill = (bar, big, after = 0) => {
        const F = big ? r.pick([
          [[2, "snare", 0.62], [2.5, "tom", 0.74, 57], [2.75, "tom", 0.68, 57], [3, "tom", 0.75, 52], [3.25, "tom", 0.7, 52], [3.5, "tom", 0.8, 47], [3.75, "tom", 0.76, 43]],
          [[2.5, "snare", 0.6], [2.75, "snare", 0.7], [3, "tom", 0.8, 55], [3.5, "tom", 0.82, 50], [3.75, "snare", 0.85]],
          [[3, "snare", 0.6], [3.25, "snare", 0.7], [3.5, "tom", 0.8, 52], [3.75, "tom", 0.85, 45]],
        ].filter((f) => f[0][0] > after)) : [[3.5, "snare", 0.45], [3.75, "snare", 0.6]];
        const from = F[0][0];
        F.forEach(([b, v, vel, p]) => D_(bar * 4 + b, v, vel, p ? { pitch: p } : undefined));
        return from;
      };
      const bigFillInto = { intro: true, v2: true, c2: true, brk1: true, outro: false };
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * 4;
        if (kime != null && bar === 7) {
          kimeHits.forEach(([b], k) => { D_(B + b, "kick", 0.85); if (k > 0) D_(B + b, "snare", 0.7); });
          if (name === "premod") D_(B, "crash", 0.38);
          fill(bar, true, kimeHits[kimeHits.length - 1][0]);
          continue;
        }
        const last = bar === 7;
        let cut = 4; // beats from which a fill replaces the groove
        if (last && name !== "outro" && name !== "pre") cut = bigFillInto[name] ? fill(bar, true) : (r.chance(0.6) ? fill(bar, false) : 4);
        const keep = (b) => b < cut - 1e-6;
        if (style === "chorus") {
          [0, 1, 2, 3].filter(keep).forEach((b) => D_(B + b, "kick", 0.82));
          [1, 3].filter(keep).forEach((b) => { D_(B + b, "snare", 0.78); D_(B + b, "snap", 0.4); });
          if (keep(3.75) && r.chance(0.35)) D_(B + 3.75, "snare", 0.18);
          for (let s = 0; s < 16; s++) {
            const b = s / 4; if (!keep(b)) continue;
            if (s % 4 === 2) D_(B + b, "hatOpen", 0.34);
            else if (s % 4 === 0) D_(B + b, "hatClosed", 0.44);
            else if (s % 4 === 1) D_(B + b, "hatClosed", 0.22 + r.range(-0.03, 0.03)); // the open hat rings through the "a"
          }
          if (bar === 0) D_(B, "crash", name === "c1" || name === "mc1" ? 0.6 : 0.42);
          if (bar === 4 && lifted) D_(B, "crash", 0.32);
        } else if (style === "verse" || style === "break" || (style === "intro" && bar >= 4) || (style === "outro" && bar < 4)) {
          const kicks = style === "break" ? (bar % 2 ? [0, 1.5, 2.75] : [0, 0.75, 2.25, 2.5]) : bar % 4 === 3 ? [0, 0.75, 1.75, 2.5] : [0, 0.75, 2.5];
          kicks.filter(keep).forEach((b) => D_(B + b, "kick", b === 0 ? 0.82 : 0.66));
          [1, 3].filter(keep).forEach((b) => D_(B + b, "snare", style === "outro" ? 0.6 : 0.74));
          [1.75, 3.25].filter(keep).forEach((b) => { if (r.chance(style === "break" ? 0.5 : 0.3)) D_(B + b, "snare", 0.15); });
          if (cut >= 4) hats(bar, "16", bar % 2 ? [3.5] : style === "break" ? [1.5] : []);
          else for (let s = 0; s < 16 && keep(s / 4); s++) D_(B + s / 4, "hatClosed", s % 2 ? 0.24 : 0.44);
          if (bar === 0 && (name === "v1" || name === "brk1")) D_(B, "crash", 0.46);
        } else if (style === "pre") {
          const four = bar >= 4;
          (four ? [0, 1, 2, 3] : bar % 2 ? [0, 0.75, 2.5] : [0, 2.5]).forEach((b) => D_(B + b, "kick", 0.76));
          if (last) {
            // build: 8ths then 16ths, crescendo, into the chorus crash
            [0, 1, 2, 2.5, 3, 3.25, 3.5, 3.75].forEach((b, k) => D_(B + b, "snare", 0.4 + k * 0.06));
          } else {
            [1, 3].forEach((b) => D_(B + b, "snare", 0.72));
            hats(bar, four ? "16" : "8", four ? [0.5, 1.5, 2.5, 3.5] : bar === 3 ? [3.5] : []);
          }
          if (bar === 0 && name === "premod") D_(B, "crash", 0.44);
        } else if (style === "intro") {
          if (firstDrive && bar < 2) continue;
          hats(bar, firstDrive ? "8" : "16");
          if (!firstDrive || bar >= 2) { D_(B, "kick", 0.62); D_(B + 2.5, "kick", 0.5); D_(B + 1, "rim", 0.42); D_(B + 3, "rim", 0.42); }
        } else if (style === "outro") {
          if (bar < 7) {
            hats(bar, "8");
            if (bar < 6) { D_(B, "kick", 0.55); D_(B + 1, "rim", 0.36); D_(B + 3, "rim", 0.36); }
          } else D_(B, "crash", 0.2);
        }
        if (last && name === "pre") { /* the build above leads in */ }
      }

      // ---------- label ----------
      const label = {
        intro: "Intro", v1: drive % 2 ? "Verse · synth" : "Verse", v2: drive % 2 ? "Verse · synth, the cell planes down" : "Verse · the cell planes down", pre: "Pre-chorus",
        c1: "Chorus · the hook", c2: "Chorus · sus, no resolution", brk1: drive % 2 === 0 ? "Break · synth solo" : "Break · sax solo",
        brk2: drive % 2 === 0 ? "Break · synth solo, band hits" : "Break · sax solo, band hits",
        premod: `Pre-chorus · pivot to ${keyName(D.home + D.lift)}`, mc1: "Last chorus · lifted", mc2: "Last chorus · home at last", outro: "Outro · Imaj9 to bVII",
      }[name];
      return { events: ev, harmony: prog, section: `Drive ${drive + 1} · ${keyName(key)} · ${label}`, state };
    },
  });
  function mod(x, m) { return ((x % m) + m) % m; }
})();
