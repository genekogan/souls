// Print a piece as a text score: node tools/score.mjs <pieceId> [--cycles N] [--from C] [--tracks a,b]
// One block per bar: the chord(s), then each pitched track's notes as name@beat(+dur), drums as voice@beat.
import { Sim, loadPieces } from "./load.mjs";
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const cycles = Number(opt("--cycles", 2)), from = Number(opt("--from", 0));
const tracksWanted = opt("--tracks", null)?.split(",");
const errs = loadPieces([id]);
if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
const p = Sim.pieces.find((x) => x.id === id);
if (!p) { console.log(`no piece ${id}`); process.exit(1); }
const T = Sim.theory, rng = T.rng(Number(opt("--seed", 12345))), bpb = p.beatsPerBar;
let state = {};
const fmt = (x) => +x.toFixed(2);
for (let c = 0; c < from + cycles; c++) {
  const res = p.compose({ cycle: c, rng: rng.fork(c), state, T }) || {};
  if (res.state) state = res.state;
  if (c < from) continue;
  console.log(`\n=== cycle ${c}  ${res.section || ""} ===`);
  for (let bar = -1; bar < p.cycleBars; bar++) {
    const chords = (res.harmony || []).filter((h) => h.bar === bar).map((h) => `${h.chord}${h.beat ? "@" + fmt(h.beat) : ""}`).join("  ");
    if (bar < 0 && !(res.events || []).some((e) => Math.floor(e.bar + e.beat / bpb + 1e-9) < 0)) continue;
    console.log(bar < 0 ? `pickup  |` : `bar ${String(c * p.cycleBars + bar + 1).padStart(3)} | ${chords}`);
    const byTrack = {};
    for (const e of res.events || []) {
      const b = Math.floor(e.bar + e.beat / bpb + 1e-9);
      if (b !== bar) continue;
      if (tracksWanted && !tracksWanted.includes(e.track)) continue;
      const beat = fmt(e.beat - (b - e.bar) * bpb + 1);
      const n = typeof e.note === "number" ? T.noteName(e.note) : Array.isArray(e.note) ? `[${e.note.map(T.noteName).join(" ")}]` : String(e.note);
      (byTrack[e.track] ||= []).push(`${n}@${beat}${e.dur >= 1 ? "+" + fmt(e.dur) : ""}`);
    }
    for (const [t, xs] of Object.entries(byTrack)) console.log(`        ${t.padEnd(10)} ${xs.join(" ")}`);
  }
}
