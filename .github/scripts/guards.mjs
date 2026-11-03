#!/usr/bin/env node
// Repository hygiene guards for a public repo (run by .github/workflows/security.yml, and by hand before a push).
//
//   node .github/scripts/guards.mjs paths                      every tracked file: no databases, client state files,
//                                                              .env files, or binary media outside the allowlist
//   node .github/scripts/guards.mjs staged                     both guards over what `git commit` would record now
//                                                              (the pre-commit hook, .github/hooks/pre-commit)
//   node .github/scripts/guards.mjs scrub --base <ref> [--head <ref>]
//                                                              lines added since <base>: no home paths, private
//                                                              workspace paths, non-documentation IPs, private host
//                                                              names or personal emails
//
// The patterns are deliberately generic. A line that must keep a match (say, a test fixture) can carry the marker
// `scrub-guard: allow`; reviewers see it in the diff.
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

// ── paths ───────────────────────────────────────────────────────────────────────────────────────────────────────
const FORBIDDEN = [
  [/\.(sqlite3?|db)(-wal|-shm|-journal)?$/i, 'database file'],
  [/(^|\/)\.eden-(agent|god)\.json$/, 'client state file (holds a live token)'],
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, '.env file (only .env.example may be committed)'],
  [/(^|\/)\.dev\.vars(\.[^/]+)?$/, 'wrangler .dev.vars file'],
  [/(^|\/)\.wrangler\//, 'wrangler local state'],
];
export const MEDIA = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|glb|ktx2|basis|hdr|exr|bin|blend|fbx|usdz|mp3|wav|ogg|oga|opus|flac|m4a|aac|mp4|m4v|webm|mov|mkv|avi|zip|7z|tar|gz|tgz|xz|pdf|woff2?|ttf|otf)$/i;

export function readAllowlist(text) {
  return new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
}

/** `isBinary(path)` reports content; injected in tests. */
export function checkPaths(files, allow, isBinary = () => false) {
  const problems = [];
  for (const file of files) {
    const hit = FORBIDDEN.find(([re]) => re.test(file));
    if (hit) { problems.push(`${file}: ${hit[1]}`); continue; }
    if (allow.has(file)) continue;
    if (MEDIA.test(file)) problems.push(`${file}: binary media outside .github/guards/media-allowlist.txt (pull it from the CDN instead)`);
    else if (isBinary(file)) problems.push(`${file}: binary file outside .github/guards/media-allowlist.txt`);
  }
  return problems;
}

function sniffBinary(file) {
  let fd;
  try {
    fd = openSync(resolve(ROOT, file), 'r');
    const buf = Buffer.alloc(8000), n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

// ── scrub ───────────────────────────────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER_USERS = /^(you|me|user|username|name|example|runner|someone|\$USER|<[^>]+>|\.\.\.)$/i;
const SKIP_FILES = new Set(['.github/scripts/guards.mjs', '.github/scripts/guards.test.mjs', '.gitleaks.toml']);
const ALLOWED_EMAIL = /(@(users\.)?noreply\.github\.com|@example\.(com|org|net)|\.(invalid|test|example|localhost)$|^noreply@|^git@github\.com$)/i;

// Public resolvers and conventional placeholder addresses that tests use as obviously fake values.
const WELL_KNOWN_FAKE = new Set(['1.2.3.4', '5.6.7.8', '8.8.8.8', '8.8.4.4', '1.0.0.1', '9.9.9.9']);
function publicIPv4(ip) {
  const o = ip.split('.').map(Number);
  if (o.some(n => n > 255) || ip.split('.').some(p => p.length > 1 && p.startsWith('0'))) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false; // RFC 5737
  if (o[3] === 0 || o.every(n => n === a) || WELL_KNOWN_FAKE.has(ip)) return false; // network/version-like, test values
  return true; // includes 100.64.0.0/10 (carrier-grade NAT, used by overlay VPNs)
}

export const SCRUB_RULES = [
  // Personal home directories (macOS, Windows). Linux service users such as /home/<service> are deployment config.
  ['home path', line => [...line.matchAll(/(?:^|[^\w.])(?:\/Users|[A-Z]:\\Users)[\\/]([^\\/\s'"`)]+)/g)].some(m => !PLACEHOLDER_USERS.test(m[1]))],
  ['private workspace path', line => /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]|\/Eden\/team\b/i.test(line)],
  ['public IP address', line => [...line.matchAll(/(?<![\w.@-])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g)].some(m => publicIPv4(m[1]))],
  ['private host name', line => /\.ts\.net\b|\.(?:sslip|nip)\.io\b|\b[\w-]*macbook[\w-]*\b/i.test(line)],
  ['ssh target', line => [...line.matchAll(/\b(?:root|ubuntu|admin|deploy)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)/g)].some(m => !ALLOWED_EMAIL.test(m[0]))],
  // Not URL userinfo (`user:pw@host`), systemd instance units (`name@instance.service`) or matrix products (`a@np.dot(`).
  ['email address', line => [...line.matchAll(/(?<![\w.%+:\/-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]{2,}(?:\.[A-Za-z0-9-]+)*\.(?!(?:service|socket|timer|target|mount|path)\b)[A-Za-z]{2,}\b(?![(\[.])/g)].some(m => !ALLOWED_EMAIL.test(m[0]))],
];

export function scrubLine(line) {
  if (line.includes('scrub-guard: allow')) return [];
  return SCRUB_RULES.filter(([, test]) => test(line)).map(([name]) => name);
}

/** Added lines of a unified diff (`git diff -U0`), as {file, line, text}. */
export function addedLines(diff) {
  const out = []; let file = null, n = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw === '+++ /dev/null' ? null : raw.slice(6); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) { n = Number(hunk[1]); continue; }
    if (file && raw.startsWith('+')) out.push({ file, line: n++, text: raw.slice(1) });
  }
  return out;
}

export function checkScrub(lines) {
  return lines.filter(l => !SKIP_FILES.has(l.file)).flatMap(l => scrubLine(l.text).map(rule => `${l.file}:${l.line}: ${rule}`));
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────
function main([mode, ...argv]) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  let problems;
  if (mode === 'paths') {
    const files = git('ls-files', '-z').split('\0').filter(Boolean);
    const allow = readAllowlist(readFileSync(resolve(ROOT, '.github/guards/media-allowlist.txt'), 'utf8'));
    problems = checkPaths(files, allow, sniffBinary);
    console.log(`path guard: ${files.length} tracked files, ${problems.length} problem(s)`);
  } else if (mode === 'scrub') {
    const base = opt('--base'), head = opt('--head') || 'HEAD';
    if (!base || /^0+$/.test(base)) { console.log('scrub guard: no base to diff against; nothing to check'); return 0; }
    const lines = addedLines(git('diff', '-U0', '--no-color', '--no-ext-diff', `${base}...${head}`));
    problems = checkScrub(lines);
    console.log(`scrub guard: ${lines.length} added line(s) since ${base}, ${problems.length} problem(s)`);
  } else if (mode === 'staged') {
    const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
    const allow = readAllowlist(readFileSync(resolve(ROOT, '.github/guards/media-allowlist.txt'), 'utf8'));
    const lines = addedLines(git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff'));
    problems = [...checkPaths(files, allow, sniffBinary), ...checkScrub(lines)];
    console.log(`guards (staged): ${files.length} file(s), ${lines.length} added line(s), ${problems.length} problem(s)`);
  } else {
    console.error('usage: guards.mjs paths | staged | scrub --base <ref> [--head <ref>]');
    return 2;
  }
  for (const p of problems) console.log(process.env.GITHUB_ACTIONS ? `::error::${p}` : `  ${p}`);
  if (problems.length && mode !== 'paths') console.log('Replace private values with env vars, config or neutral wording (or mark a deliberate fixture line with `scrub-guard: allow`).');
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
