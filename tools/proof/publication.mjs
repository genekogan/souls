#!/usr/bin/env node
// Check exact outgoing text/JSON before a GitHub write or proof upload. Never print matched values.
// node tools/proof/publication.mjs <body.md> <proof.json> ...
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRUB_RULES, privateIPv4 } from '../../.github/scripts/guards.mjs';

const PLACEHOLDER = /^(you|me|user|username|name|example|someone|runner|<[^>]+>|\$\{?USER\}?)$/i;
// Hosts that only make sense as placeholders or package dist-tags (`pkg@latest`), never as a device.
const NOT_A_HOST = /^(?:host|hostname|server|remote|machine|example|latest|next|beta|alpha|canary|rc|stable|lts|main|master|dev|workspace|npm|types|version)$/i;
const rules = [
  ...SCRUB_RULES,
  ['home workspace path', s => /(?:^|[\s`"'=(:])~(?![\s/\\])([A-Za-z_][\w.-]*)[/\\]/.test(s) && [...s.matchAll(/(?:^|[\s`"'=(:])~([A-Za-z_][\w.-]*)[/\\]/g)].some(m => !PLACEHOLDER.test(m[1]))],
  ['Linux home path', s => [...s.matchAll(/(?:^|[\s`"'=(:])\/home\/([^/\s`"')]+)/g)].some(m => !PLACEHOLDER.test(m[1]))],
  // Device-local roots: the superuser home, mounted volumes, macOS per-user temp/cache and agent scratch directories.
  ['device-local path', s => /(?:^|[\s`"'=(:])\/(?:root|Volumes\/[^/\s`"')]+|private\/(?:tmp|var)|var\/folders)(?=[/\s`"')]|$)/.test(s)
    || /(?:^|[\s`"'=(:])\/tmp\/[A-Za-z][\w.]*-\d+(?=[/\s`"')]|$)/.test(s)],
  ['private network address', s => [...s.matchAll(/(?<![\w.@-])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g)].some(m => privateIPv4(m[1]))],
  ['local service URL', s => /\b(?:https?|wss?):\/\/(?:localhost|[^/\s:]+\.local)(?=[:/\s]|$)/i.test(s)
    // Bare or schemeless forms: localhost:<port>, 0.0.0.0, the Docker host alias and mDNS/LAN/internal names.
    || /(?<![\w.-])localhost:\d{2,5}\b|(?<![\w.])0\.0\.0\.0(?![\w.])|\bhost\.docker\.internal\b/i.test(s)
    || /(?<![\w.-])[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\.(?:local|lan|internal|localdomain|home\.arpa)(?![\w-])(?:(?!\/)|(?=:\d{2,5}\b))/i.test(s)
    // A single-label host behind a scheme (`http://name:port/`), unless it is a placeholder.
    || [...s.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z][\w-]*)(?::\d{1,5})?(?=[/\s?#)\]>"'`]|$)/gi)].some(m => !NOT_A_HOST.test(m[1]))],
  // `user@host` with a single-label host: an SSH target, not an email address (those carry a dotted domain).
  ['ssh target', s => [...s.matchAll(/(?<![\w.%+:/@-])([A-Za-z_][\w.-]*)@([A-Za-z][\w-]*)(?![\w.@-])/g)].some(m => !PLACEHOLDER.test(m[1]) && !NOT_A_HOST.test(m[2]))],
  // Unique-local (fc00::/7) and link-local (fe80::/10) literals, bracketed or not, and the bracketed loopback. A
  // bracket that follows a name, `]` or `)` is an index or slice (`xs[::1]`, `s[a:f]`), never an address.
  ['private IPv6 address', s => /(?<![\w])(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):[\da-f:]+|(?<![\w\])])\[::1\]/i.test(s)],
  ['local process identifier', s => [...s.matchAll(/\bPID[\s:=#]*(\d+)\b/gi)].some(m => Number(m[1]) > 1)],
  ['operational app identifier', s => /\bap-[A-Za-z0-9]{16,}\b/.test(s)],
];

// Machine names, nicknames and usernames no pattern can know: an optional private denylist, one term per line
// ('#' comments). Read from $PUBLICATION_DENYLIST or the ignored .local/publication-denylist.txt; never tracked.
const DEFAULT_DENYLIST = fileURLToPath(new URL('../../.local/publication-denylist.txt', import.meta.url));
export function loadDenylist(file = process.env.PUBLICATION_DENYLIST || DEFAULT_DENYLIST, read = readFileSync) {
  if (!file || !existsSync(file)) return [];
  return read(file, 'utf8').split(/\r?\n/).map(l => l.replace(/#.*/, '').trim().toLowerCase()).filter(t => t.length >= 3);
}
let cachedDenylist;
const defaultDenylist = () => (cachedDenylist ??= loadDenylist());

/** Keys and strings are checked after JSON decoding, including escaped paths. No fixture bypass in public text. */
export function publicationFindings(value, { denylist = defaultDenylist() } = {}) {
  const findings = new Set();
  const visit = v => {
    if (typeof v === 'string') {
      // Decode valid escape runs independently: a prose percent sign must not hide an encoded path later on.
      let decoded = v;
      for (let pass = 0; pass < 2; pass++) decoded = decoded.replace(/(?:%[\da-f]{2})+/gi, part => {
        try { return decodeURIComponent(part); } catch { return part; }
      });
      for (const [rule, test] of rules) if (test(v) || test(decoded)) findings.add(rule);
      const lower = decoded.toLowerCase();
      if (denylist.some(term => lower.includes(term))) findings.add('private denylist term');
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
