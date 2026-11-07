// Shell-shape repairs for the god CLI's argv (harvest P0 #15). Builders drive the CLI from shell loops, and two
// shapes broke hundreds of calls although the intent is unambiguous:
//  1. several options in ONE argument: "--param a=1 --param b=2", "--wall left", "--scale 1.4" (a quoted string or a
//     variable the shell did not split) — read as separate words;
//  2. a row of values in one unsplit variable: `--at "12,4 bench-3" --name` (zsh does not split unquoted $vars, so the
//     name lands inside --at and --name arrives empty) — when the spare words exactly fill the empty options, by type,
//     they are moved there.
// Everything else is left alone for checkArgs to refuse. Every repair is reported (`notes`) so the builder sees how the
// command was read.

/** Options whose values are free text: never split, never a source of spilled words. */
const FREE = new Set(['title', 'brief', 'say', 'note', 'asks', 'steps', 'mass', 'event', 'views', 'state', 'path', 'area', 'label', 'text', 'description', 'license', 'source']);
/** Options whose values are one word (a point, number, name, ref or compass word): a space inside one is a spill. */
const WORD = new Set(['at', 'near', 'along', 't', 'side', 'facing', 'name', 'scale', 'yaw', 'dir', 'dist', 'offset', 'by', 'step', 'inside', 'on', 'against', 'wall', 'corner', 'count', 'row', 'gap', 'spacing', 'from', 'to', 'radius', 'size', 'setback', 'around', 'via']);
/** Commands whose one positional word is a def or a thing (never free text). */
const REF_POS = new Set(['place', 'terrain', 'move', 'set', 'clone', 'describe', 'where', 'clear', 'furnish']);
const POINT = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
const kindOf = (w) => (POINT.test(w) ? 'point' : w !== '' && Number.isFinite(Number(w)) ? 'num' : 'word');
const accepts = (k, numeric) => (numeric.has(k) ? ['num'] : k === 'by' || k === 'step' ? ['point'] : k === 'offset' ? ['point', 'num'] : ['name', 'facing', 'dir', 'wall', 'corner', 'side'].includes(k) ? ['word'] : ['point', 'word']);
const isOpt = (a) => typeof a === 'string' && a.startsWith('--') && a.length > 2;

function* permutations(n) {
  const a = [...Array(n).keys()];
  const rec = function* (i) { if (i === n) { yield [...a]; return; } for (let j = i; j < n; j++) { [a[i], a[j]] = [a[j], a[i]]; yield* rec(i + 1); [a[i], a[j]] = [a[j], a[i]]; } };
  yield* rec(0);
}

/**
 * normalizeArgv(cmd, argv, { bools, numeric, needsValue }) → { argv, notes, hint }.
 * bools: options that never take a value; numeric: options that take a number (for this command);
 * needsValue(k): false for options that may stand alone (e.g. look --inside).
 * `hint` explains an unsplit variable when no safe repair exists (checkArgs still refuses).
 */
export function normalizeArgv(cmd, argv, { bools = new Set(), numeric = new Set(), needsValue = () => true } = {}) {
  const notes = [];
  // 1. several options in one argument
  let out = [];
  for (const a of argv) {
    const m = typeof a === 'string' ? /^--([a-z][\w-]*)\s+\S/i.exec(a) : null;
    if (m && !FREE.has(m[1]) && !/["'{}[\]]/.test(a)) { const parts = a.trim().split(/\s+/); out.push(...parts); notes.push(`read "${a}" as ${parts.length} words: ${parts.join(' ')}`); }
    else out.push(a);
  }
  // 2. the shape of the words: options with their value index, positionals
  const opts = [], pos = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (!isOpt(a)) { pos.push(i); continue; }
    if (a.includes('=')) continue;
    const k = a.slice(2);
    if (k === 'between') { i += 2; continue; }
    if (bools.has(k)) continue;
    if (out[i + 1] !== undefined && !isOpt(out[i + 1])) { opts.push({ k, at: i, value: i + 1 }); i++; }
    else opts.push({ k, at: i, value: null });
  }
  const empties = opts.filter((o) => o.value === null && needsValue(o.k));
  const spaced = (s) => typeof s === 'string' && /\S\s+\S/.test(s.trim()) && !/^\s*[[{]/.test(s);
  const sources = [
    ...opts.filter((o) => o.value !== null && WORD.has(o.k) && spaced(out[o.value])).map((o) => ({ idx: o.value, pos: false })),
    ...(REF_POS.has(cmd) && pos.length && spaced(out[pos[0]]) ? [{ idx: pos[0], pos: true }] : []),
  ].sort((a, b) => a.idx - b.idx);
  if (!sources.length) return { argv: out, notes, hint: null };
  const hint = `a value with spaces (${sources.map((s) => JSON.stringify(out[s.idx])).join(', ')}) usually means the shell did not split a variable (zsh never splits unquoted $vars): give each value its own word, e.g. use \${=row} in zsh or an array, or run the loop in bash`;
  if (!empties.length) return { argv: out, notes, hint };
  // the spare words of each source, in order
  const extras = [];
  for (const s of sources) {
    const words = out[s.idx].trim().split(/\s+/);
    // `place ${row}@1` with row = "kid-blue -24,0": the version belongs to the def, the first word. When the last word is
    // itself a def ("tier1-roots roots@1": a name and a def?), the order is a guess: leave it to the refusal.
    if (s.pos && (cmd === 'place' || cmd === 'terrain') && !words[0].includes('@')) {
      const last = words[words.length - 1], v = /@\d+$/.exec(last);
      if (v) { if (kindOf(last.slice(0, v.index)) === 'word') return { argv: out, notes, hint }; words[words.length - 1] = last.slice(0, v.index); words[0] += v[0]; }
    }
    s.first = words[0];
    extras.push(...words.slice(1).map((w) => ({ w, src: s.idx })));
  }
  if (extras.length !== empties.length || extras.length > 6) return { argv: out, notes, hint };
  const fits = (perm) => perm.every((e, j) => accepts(empties[j].k, numeric).includes(kindOf(extras[e].w)));
  let pick = null;
  const identity = extras.map((_, j) => j);
  if (fits(identity)) pick = identity;
  else { const ok = [...permutations(extras.length)].filter(fits); if (ok.length === 1) pick = ok[0]; }
  if (!pick) return { argv: out, notes, hint };
  const fill = new Map(empties.map((o, j) => [o.at, extras[pick[j]].w]));
  const firsts = new Map(sources.map((s) => [s.idx, s.first]));
  const next = [];
  out.forEach((a, i) => { next.push(firsts.has(i) ? firsts.get(i) : a); if (fill.has(i)) next.push(fill.get(i)); });
  notes.push(`a variable arrived unsplit; read as: ${cmd} ${next.map((w) => (/\s/.test(w) || w === '' ? JSON.stringify(w) : w)).join(' ')}`);
  return { argv: next, notes, hint: null };
}
