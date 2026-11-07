// brief.mjs: what a Soul knows about here and now, in a few lines, put in front of the mind by `serve`. Pure: it is handed
// what memory.mjs looked up, and it makes no request and no model call. Design: docs/design/soul-context.md section 3.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file.

/** The default budget. The brief never exceeds what it is given, whatever the log holds. An owner sets `briefBytes` in config.json. */
export const BRIEF_BYTES = 1500;
const LINE_MAX = 240, PEOPLE_MAX = 5, OPEN_MAX = 4, SELF_MAX = 5, EPISODES = 2;

const line = (v) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > LINE_MAX ? `${t.slice(0, LINE_MAX - 1).trimEnd()}…` : t; };
const size = (v) => Buffer.byteLength(v);
const times = (n) => (n === 1 ? "once" : `${n} times`);
const when = (w) => [w?.world, w?.worldDay === null || w?.worldDay === undefined ? null : `day ${w.worldDay}`].filter(Boolean).join(", ");

/** `facts`: {people, place, goals, schedule, recent, self}, each maybe empty. An empty memory is an empty brief. */
export function buildBrief(facts, { bytes = BRIEF_BYTES } = {}) {
  const person = (p) => `${p.name}: ${p.met ? `met ${times(p.met)}` : "only heard from"}${p.last ? `, last ${[when(p.last), p.last.place].filter(Boolean).join(" at ")}` : ""}.${p.note ? ` My note: ${p.note}` : ""}${p.open ? ` Open: ${p.open}` : ""}`;
  const place = (p) => `${p.name}: ${p.visits > 1 ? `been here ${times(p.visits)}` : "first time here"}.${p.note ? ` My note: ${p.note}` : ""}`;
  const goal = (g) => `${g.note}${g.next ? ` Next: ${g.next}` : ""}`;
  const sections = [
    ["Known people here", (facts.people ?? []).slice(0, PEOPLE_MAX).map(person)],
    ["This place", facts.place ? [place(facts.place)] : []],
    ["Open commitments", [...(facts.goals ?? []).map(goal), ...(facts.schedule ?? [])].slice(0, OPEN_MAX)],
    ["Last episode", (facts.recent ?? []).slice(-EPISODES).map((e) => `${e.summary}${e.untrusted ? " [untrusted]" : ""}`)],
    ["Self", (facts.self ?? []).slice(0, SELF_MAX)],
  ];
  const out = [];
  let used = 0;
  for (const [head, lines] of sections) {
    let opened = false;
    for (const raw of lines) {
      const text = `- ${line(raw)}`, cost = size(text) + 1 + (opened ? 0 : size(head) + 2);
      if (used + cost > bytes) continue;
      if (!opened) { out.push(`${head}:`); opened = true; }
      out.push(text);
      used += cost;
    }
  }
  return out.join("\n");
}
