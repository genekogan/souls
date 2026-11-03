#!/usr/bin/env node
// Check exact outgoing text/JSON before a GitHub write or proof upload. Never print matched values.
// node tools/proof/publication.mjs <body.md> <proof.json> ...
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRUB_RULES } from '../../.github/scripts/guards.mjs';

const PLACEHOLDER = /^(you|user|username|example|someone|<[^>]+>|\$\{?USER\}?)$/i;
const rules = [
  ...SCRUB_RULES,
  ['home workspace path', s => /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]/i.test(s)],
  ['Linux home path', s => [...s.matchAll(/(?:^|[\s`"'=(:])\/home\/([^/\s`"')]+)/g)].some(m => !PLACEHOLDER.test(m[1]))],
  ['private network address', s => [...s.matchAll(/(?<![\w.@-])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g)].some(m => {
    const [a, b, c, d] = m[1].split('.').map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  })],
  ['local service URL', s => /\b(?:https?|wss?):\/\/(?:localhost|[^/\s:]+\.local)(?=[:/\s]|$)/i.test(s)],
  ['private IPv6 address', s => /(?<![\w])(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):[\da-f:]+|\[(?:::1|[\da-f]*:[\da-f:]+)\]/i.test(s)],
  ['local process identifier', s => [...s.matchAll(/\bPID[\s:=#]*(\d+)\b/gi)].some(m => Number(m[1]) > 1)],
  ['operational app identifier', s => /\bap-[A-Za-z0-9]{16,}\b/.test(s)],
];

/** Keys and strings are checked after JSON decoding, including escaped paths. No fixture bypass in public text. */
export function publicationFindings(value) {
  const findings = new Set();
  const visit = v => {
    if (typeof v === 'string') {
      // Decode valid escape runs independently: a prose percent sign must not hide an encoded path later on.
      let decoded = v;
      for (let pass = 0; pass < 2; pass++) decoded = decoded.replace(/(?:%[\da-f]{2})+/gi, part => {
        try { return decodeURIComponent(part); } catch { return part; }
      });
      for (const [rule, test] of rules) if (test(v) || test(decoded)) findings.add(rule);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [key, item] of Object.entries(v)) { visit(key); visit(item); }
  };
  visit(value);
  return [...findings];
}

export function assertPublishable(value) {
  const problems = publicationFindings(value);
  if (problems.length) throw new Error(`Publication blocked: ${problems.join(', ')}. Replace device details with repository-relative paths or neutral placeholders; keep operational mappings private.`);
}

export function readPublication(file, read = readFileSync, { json = false } = {}) {
  const text = read(file, 'utf8');
  if (json || /\.json$/i.test(file)) return JSON.parse(text);
  if (/\.(jsonl|ndjson)$/i.test(file)) return text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: publication.mjs <outgoing.md> <proof.json> ...'); process.exitCode = 2; }
  else {
    for (let i = 0; i < files.length; i++) {
      try { assertPublishable(readPublication(files[i])); }
      catch (e) { console.error(`Payload ${i + 1}: ${e instanceof SyntaxError ? 'invalid JSON' : e.message.startsWith('Publication blocked:') ? e.message : 'could not read payload'}`); process.exitCode = 1; }
    }
    if (!process.exitCode) console.log(`Publication check: ${files.length} payload(s) passed. Media pixels, audio and binary metadata require separate inspection.`);
  }
}
