// CW4 (#738): the Prometheus text exposition (version 0.0.4) that metrics.mjs writes, parsed back into samples.
// Pure. Only what metrics.mjs emits needs to round-trip; anything unparseable is skipped and counted, never guessed.

/** text → {samples: [{key, name, family, labels, value}], types: {family: type}, skipped} */
export function parsePrometheus(text) {
  const types = {}, samples = []; let skipped = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('#')) { const m = /^# TYPE (\S+) (\S+)/.exec(line); if (m) types[m[1]] = m[2]; continue; }
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(\s+\d+)?$/.exec(line);
    if (!m) { skipped++; continue; }
    const value = Number(m[4]); if (!Number.isFinite(value)) { skipped++; continue; }
    const labels = {}, body = m[3] ?? '';
    for (const lm of body.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]] = lm[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const name = m[1], family = familyOf(name, types);
    samples.push({ key: keyOf(name, labels), name, family, labels, value });
  }
  return { samples, types, skipped };
}

/** The family a sample belongs to (a summary/histogram's _sum, _count and _bucket rows belong to their base name). */
export function familyOf(name, types = {}) {
  if (types[name]) return name;
  for (const sfx of ['_bucket', '_sum', '_count']) if (name.endsWith(sfx) && types[name.slice(0, -sfx.length)]) return name.slice(0, -sfx.length);
  return name;
}
/** A canonical series key: name{a="x",b="y"} with labels sorted. */
export function keyOf(name, labels = {}) {
  const ks = Object.keys(labels).sort();
  return ks.length ? `${name}{${ks.map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}` : name;
}
/** The labels of a canonical key (inverse of keyOf). */
export function labelsOf(key) {
  const i = key.indexOf('{'); if (i < 0) return { name: key, labels: {} };
  const labels = {}; for (const lm of key.slice(i + 1, -1).matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]] = lm[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return { name: key.slice(0, i), labels };
}

/** How a series is reduced over time. counter: increases (reset-aware); quantile: max only (a p99 is never averaged);
 *  gauge: min/mean/max/last. */
export function kindOf(name, labels, types = {}) {
  const fam = familyOf(name, types), t = types[fam];
  if (t === 'counter' || name.endsWith('_total') || name.endsWith('_bucket') || ((t === 'summary' || t === 'histogram') && (name.endsWith('_sum') || name.endsWith('_count')))) return 'counter';
  if ('quantile' in labels || /_p\d\d(_|$)/.test(name)) return 'quantile';
  return 'gauge';
}
