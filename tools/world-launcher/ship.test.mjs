// ship.sh (deploy/ship.sh): the one release command. Every eden2/build/browser command is a stub (SHIP_TEST=1 + SHIP_SSH,
// SHIP_SCP, SHIP_NODE, SHIP_PYTHON, SHIP_RELEASE_SH) that logs its argv, so these tests check the step order, that a
// failure stops the run with the live state + rollback + the --from to resume, and --from itself. Nothing leaves the
// machine. Plus unit tests for the step verdicts (ship/checks.mjs) and the walk's wheel-zoom rule (ship/walk.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPoster, checkQuickCheck, checkStall, checkWalks } from './deploy/ship/checks.mjs';
import { NOTCH_FACTOR, zoomStep } from './deploy/ship/walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP = join(HERE, 'deploy/ship.sh');
const BUILD = 'we-0123456789ab';

// One stub per command: logs "<name>\t<argv>" to $STUB_LOG; exits 1 when "<name> <argv>" contains $STUB_FAIL.
// ssh answers the stage-link read and the backups' last line; node plays the release probe (ready, then waits for
// released or stop, exits $STUB_PROBE_RC).
const STUB = (name) => `#!/usr/bin/env bash
printf '%s\\t%s\\n' ${name} "$*" >> "$STUB_LOG"
if [ -n "\${STUB_FAIL:-}" ] && [[ "${name} $*" == *"$STUB_FAIL"* ]]; then echo "stub ${name}: failing on purpose"; exit 1; fi
case ${name} in
  ssh)
    case "$*" in
      *readlink*) printf '%s\\n' /srv/sim-worlds/releases/we-prevprod0000 /srv/sim-worlds/releases/we-older000000 /srv/sim-old/releases/we-prevprod0000-root /srv/sim-old/releases/we-older000000-root;;
      *compact-backup.sh*) [[ "$*" =~ compact-backup\\.sh\\ (pre-r[^ ]+)\\ (production|legacy) ]] && { echo "12K x"; echo "/srv/sim-worlds-data/release-backups/\${BASH_REMATCH[1]}-\${BASH_REMATCH[2]}-20261020-000000"; };;
      *sim-quick-check*) echo "ok /x/sim.db";;
    esac;;
  node)
    case "$1" in *release-probe.mjs)
      out=""; while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done
      mkdir -p "$out"; touch "$out/ready"
      for i in $(seq 1 600); do [ -e "$out/released" ] || [ -e "$out/stop" ] && break; sleep 0.05; done
      exit "\${STUB_PROBE_RC:-0}";;
    esac;;
esac
exit 0
`;

function setup() {
  const t = mkdtempSync(join(tmpdir(), 'ship-test-'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SHIP_TEST: '1', SHIP_BUILD: BUILD, STUB_LOG: join(t, 'calls.log'),
    SIM_WORLDS_HOST: 'root@stub-host', SHIP_ORIGIN: 'https://sim.stub', SHIP_PROBE_CLI: join(t, 'god'), SHIP_LEGACY_RELEASE_FILE: join(t, 'bin/LEGACY-RELEASE'),
    SHIP_DEPLOY_LOCK: join(t, 'no-lock'), SHIP_OUT_ROOT: join(t, 'out'), MARS_WEB_SRC: join(t, 'mars-web') };
  for (const d of ['god', 'bin', 'mars-web', 'stubs']) mkdirSync(join(t, d));
  for (const [k, name] of [['SHIP_SSH', 'ssh'], ['SHIP_SCP', 'scp'], ['SHIP_NODE', 'node'], ['SHIP_PYTHON', 'python'], ['SHIP_RELEASE_SH', 'release']]) {
    const f = join(t, 'stubs', name); writeFileSync(f, STUB(name)); chmodSync(f, 0o755); env[k] = f;
  }
  writeFileSync(env.STUB_LOG, '');
  const run = (args, extra = {}) => {
    const r = spawnSync('bash', [SHIP, '--topology', 'dual-prefix', '--label', '999', ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status, out: r.stdout + r.stderr, calls: readFileSync(env.STUB_LOG, 'utf8').split('\n').filter(Boolean) };
  };
  return { t, env, run, out: join(t, 'out/999') };
}

// a short name per stub call, in the order the run made them
const key = (line) => {
  const [name, args] = line.split('\t');
  const m = args.match(/(release-probe|walk|poster|stall|cdn-walk|checks)\.(mjs|py)( \S+)?/) ?? args.match(/(poster-count)\.py/);
  if (m) return m[1] + (m[1] === 'checks' ? ' ' + args.split(' ')[1] : m[1] === 'walk' ? (args.includes('walk-phone') ? ' phone' : ' desktop') : '');
  if (name === 'release') return `release ${args}`;
  if (name === 'scp') return `scp ${args.match(/(?:ship|old-worlds)\/(\S+)/)[1]}`;
  for (const [re, k] of [[/readlink/, 'read links'], [/compact-backup\.sh pre-r999 production/, 'backup production'], [/compact-backup\.sh pre-r999 legacy/, 'backup legacy'],
    [/sim-quick-check/, 'quick-check'], [/sha256sum -c FILES\.sha256/, 'sha256 legacy'], [/activate\.sh legacy/, 'activate legacy']]) if (re.test(args)) return k;
  return `${name} ${args}`;
};
const FULL = ['read links', 'scp compact-backup.sh', 'scp compact-copy.py', 'scp quick-check.mjs', 'backup production', 'backup legacy', 'quick-check', 'checks quick-check',
  'release legacy', 'release-probe', 'release production --reload', 'sha256 legacy', 'activate legacy',
  'walk desktop', 'walk phone', 'checks walks', 'poster', 'poster-count', 'checks poster', 'stall', 'checks stall', 'cdn-walk'];
const STEPS = ['preflight', 'backup', 'legacy-upload', 'probe-start', 'release', 'legacy-activate', 'released', 'probe-check', 'walks', 'poster', 'stall', 'cdn-walk'];

test('ship.sh --dry-run prints the 12 steps in order and runs nothing', () => {
  const s = setup(), r = s.run(['--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([...r.out.matchAll(/^== \[(\d+)\/12\] ([a-z-]+):/gm)].map((m) => `${m[1]} ${m[2]}`), STEPS.map((n, i) => `${i + 1} ${n}`));
  assert.deepEqual(r.calls, [], 'no stub is called in a dry run');
  assert.match(r.out, /\+ \S+release production --reload/);
  assert.match(r.out, /activate\.sh\\ legacy\\ \/srv\/sim-old\/releases\/we-0123456789ab-root\\ --reload/);
  assert.match(r.out, /DRY RUN complete: 12 steps printed, nothing ran\./);
  assert.ok(!existsSync(s.out), 'a dry run writes no outputs');
  assert.ok(!existsSync(s.env.SHIP_LEGACY_RELEASE_FILE));
});

test('ship.sh --dry-run exits 1 when preflight would stop a real run', () => {
  const s = setup(), r = s.run(['--dry-run'], { MARS_WEB_SRC: join(s.t, 'nope') });
  assert.equal(r.code, 1);
  assert.match(r.out, /PREFLIGHT WOULD STOP: no Mars web assets/);
  assert.match(r.out, /PREFLIGHT: 1 problem\(s\)/);
});

test('a missing dedicated probe stops before any remote or release command', () => {
  const s = setup(), r = s.run([], { SHIP_PROBE_CLI: join(s.t, 'missing-probe') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /STOPPED at step preflight: no probe god folder/);
  assert.deepEqual(r.calls, []);
  assert.ok(!existsSync(s.env.SHIP_LEGACY_RELEASE_FILE));
});

test('ship.sh runs every step in the proven order and records it', () => {
  const s = setup(), r = s.run([]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls.map(key), FULL);
  assert.equal(readFileSync(s.env.SHIP_LEGACY_RELEASE_FILE, 'utf8').trim(), `${BUILD}-root`);
  assert.ok(existsSync(join(s.out, 'probe/released')), 'the probe was told the release ended');
  assert.equal(readFileSync(join(s.out, 'probe/exit-code'), 'utf8').trim(), '0');
  const steps = readFileSync(join(s.out, 'STEPS.txt'), 'utf8');
  assert.deepEqual([...steps.matchAll(/^(\S+) ok /gm)].map((m) => m[1]), STEPS);
  assert.match(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), /activate\.sh production \/srv\/sim-worlds\/releases\/we-prevprod0000 --reload/);
  assert.match(r.out, /SHIPPED we-0123456789ab \+ we-0123456789ab-root/);
  assert.match(readFileSync(join(s.out, 'ship.log'), 'utf8'), /\[12\/12\] cdn-walk/);
  // the walks: desktop pick on /w/eden + PICK2, the phone at dpr 3
  const walks = r.calls.filter((l) => l.includes('walk.mjs'));
  assert.match(walks[0], /https:\/\/sim\.stub\/w\/eden\/=Nemo Owen .*little-martians-arium\/$/);
  assert.match(walks[1], /walk-phone https:\/\/sim\.stub\/w\/eden\/ /);
});

test('ship.sh refuses to reuse an output folder without --from', () => {
  const s = setup(); assert.equal(s.run([]).code, 0);
  const r = s.run([]);
  assert.equal(r.code, 1);
  assert.match(r.out, /already holds a run: resume it with --from/);
});

test('a failed production release stops before legacy, stops the probe, prints rollback and --from release', () => {
  const s = setup(), r = s.run([], { STUB_FAIL: 'release production' });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.calls.map(key), FULL.slice(0, FULL.indexOf('release production --reload') + 1));
  assert.match(r.out, /STOPPED at step release: release\.sh production failed/);
  assert.match(r.out, /live now: release\.sh production failed: activate\.sh hands back to we-prevprod0000/);
  assert.match(r.out, /rollback \(only if you decide to/);
  assert.match(r.out, /legacy: +\S+ root@stub-host bash \/srv\/sim-old\/releases\/we-prevprod0000-root\/tools\/world-launcher\/deploy\/activate\.sh legacy/);
  assert.match(r.out, /after fixing: \S+ship\.sh --label 999 --topology dual-prefix --out \S+ --from release$/m);
  assert.ok(existsSync(join(s.out, 'probe/stop')), 'the probe was stopped');
  assert.ok(!existsSync(s.env.SHIP_LEGACY_RELEASE_FILE), 'LEGACY-RELEASE untouched');
  assert.match(readFileSync(join(s.out, 'STEPS.txt'), 'utf8'), /^release STOPPED /m);
});

test('a failed backup stops before anything is built, nothing live changed', () => {
  const s = setup(), r = s.run([], { STUB_FAIL: 'pre-r999 legacy' });
  assert.equal(r.code, 1);
  assert.deepEqual(r.calls.map(key), FULL.slice(0, FULL.indexOf('backup legacy') + 1));
  assert.match(r.out, /live now: nothing on eden2 has changed yet/);
  assert.match(r.out, /--from backup$/m);
});

for (const [rc, msg] of [['1', /probe FAIL \(exit 1\).*the release IS live/], ['3', /probe exit 3: the release rolled back/]]) {
  test(`probe exit ${rc} stops before the walks`, () => {
    const s = setup(), r = s.run([], { STUB_PROBE_RC: rc });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, msg);
    assert.match(r.out, /--from probe-check$/m);
    assert.deepEqual(r.calls.map(key), FULL.slice(0, FULL.indexOf('activate legacy') + 1), 'legacy activated, no walk');
    if (rc === '3') assert.match(r.out, /live now: the release ROLLED BACK/);
  });
}

test('the walks missing their bar stop the run with --from walks', () => {
  const s = setup(), r = s.run([], { STUB_FAIL: 'checks.mjs walks' });
  assert.equal(r.code, 1);
  assert.equal(r.calls.map(key).at(-1), 'checks walks');
  assert.match(r.out, /live now: production \+ legacy LIVE on we-0123456789ab/);
  assert.match(r.out, /--from walks$/m);
});

test('--from walks resumes: earlier steps are skipped, nothing on eden2 is touched', () => {
  const s = setup(), r = s.run(['--from', 'walks']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls.map(key), FULL.slice(FULL.indexOf('walk desktop')));
  assert.equal((r.out.match(/: skipped \(--from walks\)/g) ?? []).length, 8);
  assert.ok(!existsSync(s.env.SHIP_LEGACY_RELEASE_FILE));
});

test('--no-probe runs without the probe; a bad --from or --label is refused', () => {
  const s = setup(), r = s.run(['--no-probe']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls.map(key), FULL.filter((k) => k !== 'release-probe'));
  assert.match(r.out, /probe-check: off \(--no-probe\)/);
  assert.equal(s.run(['--from', 'nope']).code, 2);
  assert.equal(spawnSync('bash', [SHIP, '--label', '3.53', '--dry-run'], { env: s.env, encoding: 'utf8' }).status, 2);
});

test('checks.mjs quick-check: every db ok', () => {
  assert.equal(checkQuickCheck('ok /a/sim.db\nok /b/accounts.sqlite\n').ok, true);
  const bad = checkQuickCheck('ok /a/sim.db\n*** in database main ***\n');
  assert.equal(bad.ok, false);
  assert.equal(checkQuickCheck('').problems[0], 'no database was checked');
});

test('checks.mjs walks: arrivals, errors, resync, picks and the entry count', () => {
  const good = { slug: 'eden', dpr: 1, arrivalMs: 900, errors: [], resync: 0, picks: [{ pick: 'Nemo Owen', ok: true }], orbit: { in: 2, out: 0, end: { d: 30, h: 15 }, open: true } };
  assert.equal(checkWalks([{ name: 'walk', entries: [good, { ...good, dpr: 2 }] }], 2).ok, true);
  const r = checkWalks([{ name: 'walk', entries: [{ ...good, arrivalMs: null }, { ...good, errors: ['boom'] }, { ...good, resync: 1 }, { ...good, picks: [{ pick: 'x', ok: false }] }] }], 5);
  assert.equal(r.problems.length, 5, r.problems.join('\n'));
  assert.match(r.lines[0], /orbit 2in\/0out d=30 h=15/);
  // PF2: a slow arrival is noted with the laptop's load at the walk (busy -> re-walk), never a problem
  const slow = checkWalks([{ name: 'walk-phone', entries: [{ ...good, arrivalMs: 21300, load1: 27.4 }, { ...good, arrivalMs: 9000, load1: 4.1 }, { ...good, load1: 30 }] }], 3);
  assert.equal(slow.ok, true); assert.match(slow.lines[0], / load 27.4 /);
  assert.deepEqual(slow.notes, ['walk-phone eden dpr 1: arrival 21.3 s at laptop load 27.4: the laptop was busy; re-walk it when load1 < 10', 'walk-phone eden dpr 1: arrival 9.0 s at laptop load 4.1: slow at normal load: look at it']);
});

test('checks.mjs poster: a world frame every run, never blank after it', () => {
  const log = [1, 2, 3].map((k) => JSON.stringify({ k, marks: ['early-poster 100'], errs: [] })).join('\n');
  const count = [1, 2, 3].map((k) => `${k} firstWorld 1200 frames 40 blank-after-world 0`).join('\n');
  assert.equal(checkPoster(log, count, 3).ok, true);
  const bad = checkPoster(log, `1 firstWorld None frames 40 blank-after-world 0\n2 firstWorld 900 frames 40 blank-after-world [12, 13]`, 3);
  assert.deepEqual(bad.problems, ['poster run 1: never drew a world frame', 'poster run 2: blank after the first world frame [12, 13]', '2 poster runs counted, expected 3']);
});

test('checks.mjs stall: no frame gap over 1 s, every run reported', () => {
  const run = (k, gaps = []) => JSON.stringify({ k, card: 500, frames: 300, maxGap: gaps.length ? 1400 : 80, gapsOver1s: gaps, errs: [] });
  assert.equal(checkStall([1, 2, 3, 4].map((k) => run(k)).join('\n'), 4).ok, true);
  const bad = checkStall([run(1), run(2, [1400])].join('\n'), 4);
  assert.deepEqual(bad.problems, ['stall run 2: 1 frame gap(s) over 1 s (max 1400 ms)', '2 stall runs reported, expected 4']);
});

test('walk.mjs zoomStep keeps the orbit eye in open space', () => {
  assert.ok(Math.abs(NOTCH_FACTOR - 0.75) < 0.01);
  assert.equal(zoomStep(13.3, 2.4, 0), 'out', 'the /w/eden broadcast arrival (close, low) zooms out');
  assert.equal(zoomStep(26, 5, 0), 'out', 'far enough but too low');
  assert.equal(zoomStep(60, 30, 0), 'in', 'room for a notch in');
  assert.equal(zoomStep(30, 20, 0), null, 'one more notch would pass 25 m: stop');
  assert.equal(zoomStep(200, 100, 5), null, 'at most five notches in');
  assert.equal(zoomStep(40, null, 0), 'in', 'unknown ground: distance alone');
  // a whole loop from the bad arrival ends open
  let d = 13.3, h = 2.4, zin = 0, out = 0;
  for (let s; (s = zoomStep(d, h, zin)) && out < 8;) { if (s === 'in') { zin++; d *= NOTCH_FACTOR; h *= NOTCH_FACTOR; } else { out++; d /= NOTCH_FACTOR; h /= NOTCH_FACTOR; } }
  assert.ok(d >= 25 && h >= 10, `ended d=${d.toFixed(1)} h=${h.toFixed(1)} after ${out} out`);
});

// Scope exclusions must be visible and cannot quietly weaken the expected arrival count.
test('explicit excluded world is absent from both arrival walks and adjusts the bar', () => {
  const s = setup(), r = s.run(['--dry-run', '--exclude-world', 'little-martians-arium']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Explicit arrival-walk exclusion: little-martians-arium/);
  assert.match(r.out, /desktop 6 worlds dpr 1\+2, phone 2 worlds; 14 arrivals/);
  assert.doesNotMatch(r.out, /https:\/\/sim\.stub\/worlds\/w\/little-martians-arium/);
  assert.match(r.out, /checks\.mjs walks 14 /);
  assert.deepEqual(r.calls, []);
});
test('unknown or duplicate arrival exclusions fail before any release action', () => {
  for (const exclusions of [['not-a-world'], ['little-martians-arium', 'little-martians-arium']]) {
    const s = setup(), r = s.run(exclusions.flatMap(x => ['--exclude-world', x]));
    assert.equal(r.code, 2, r.out); assert.deepEqual(r.calls, []);
  }
});

const ROOT_STEPS = ['preflight', 'backup', 'probe-start', 'release', 'released', 'probe-check', 'health', 'walks', 'poster', 'stall', 'cdn-walk'];
const rootArgs = ['--topology', 'root-only'];

test('topology must be explicit; conflicting build base fails before any commands', () => {
  const s = setup();
  const omitted = spawnSync('bash', [SHIP, '--label', '999', '--dry-run'], { env: s.env, encoding: 'utf8' });
  assert.equal(omitted.status, 2);
  assert.match(omitted.stdout, /no implicit legacy deployment/);
  for (const [args, extra] of [[rootArgs, { SIM_WORLDS_BASE: '/worlds' }], [[], { SIM_WORLDS_BASE: '/' }], [['--topology', 'typo'], {}]]) {
    const r = s.run(args, extra); assert.equal(r.code, 2, r.out); assert.deepEqual(r.calls, []);
  }
});

test('root-only dry run contains no legacy operations and covers canonical URLs', () => {
  const s = setup(), r = s.run([...rootArgs, '--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([...r.out.matchAll(/^== \[\d+\/11\] ([a-z-]+):/gm)].map(m => m[1]), ROOT_STEPS);
  assert.doesNotMatch(r.out, /legacy|sim-old|\/worlds\/w\//);
  assert.match(r.out, /web base \/; health https:\/\/sim.stub\/__sim\/healthz/);
  assert.match(r.out, /desktop 3 worlds dpr 1\+2, phone 3 worlds; 9 arrivals/);
  for (const slug of ['eden', 'mars-college-2026', 'mars-college-2027']) assert.match(r.out, new RegExp(`/w/${slug}/`));
  assert.deepEqual(r.calls, []); assert.ok(!existsSync(s.out));
});

test('root-only executes production only, with root health and a production-only rollback', () => {
  const s = setup(), r = s.run(rootArgs);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.calls.join('\n'), /legacy|sim-old|\/worlds\/w\//);
  assert.ok(r.calls.some(c => c.startsWith('release\tproduction --reload')));
  assert.ok(r.calls.some(c => /health.mjs https:\/\/sim.stub we-0123456789ab/.test(c)));
  assert.match(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), /^production:/);
  assert.doesNotMatch(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), /legacy/);
  assert.ok(!existsSync(s.env.SHIP_LEGACY_RELEASE_FILE));
  assert.deepEqual([...readFileSync(join(s.out, 'STEPS.txt'), 'utf8').matchAll(/^(\S+) ok /gm)].map(m => m[1]), ROOT_STEPS);
  assert.match(r.out, /SHIPPED we-0123456789ab: every root-only step passed/);
});

test('root-only backup and activation failures stop without a legacy action or false shipped result', () => {
  for (const failure of ['pre-r999 production', 'release production']) {
    const s = setup(), r = s.run([...rootArgs, '--no-probe'], { STUB_FAIL: failure });
    assert.equal(r.code, 1, r.out); assert.doesNotMatch(r.out, /SHIPPED/);
    assert.doesNotMatch(r.calls.join('\n'), /legacy|sim-old/);
    assert.doesNotMatch(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), /legacy/);
    const skip = s.run([...rootArgs, '--no-probe', '--from', 'walks']);
    assert.equal(skip.code, 2, skip.out); assert.match(skip.out, /resume refused: prerequisite/);
  }
});

test('root-only failed health retains live-state report and resumes without reactivation', () => {
  const s = setup(), failed = s.run([...rootArgs, '--no-probe'], { STUB_FAIL: 'health.mjs' });
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /live now: production LIVE on we-0123456789ab/);
  assert.match(failed.out, /--topology root-only --out \S+ --from health --no-probe/);
  writeFileSync(s.env.STUB_LOG, '');
  const resumed = s.run([...rootArgs, '--no-probe', '--from', 'health']);
  assert.equal(resumed.code, 0, resumed.out);
  assert.ok(resumed.calls[0].includes('health.mjs'));
  assert.ok(resumed.calls.every(c => !/^(ssh|scp|release)\t/.test(c)), 'verification-only resume has no remote mutations');
});

test('root-only resume refuses a missing run and changes of build, target, origin, or coverage', () => {
  const s = setup();
  assert.equal(s.run([...rootArgs, '--from', 'walks']).code, 2);
  assert.equal(s.run([...rootArgs, '--no-probe']).code, 0);
  for (const extra of [{ SHIP_BUILD: 'we-111111111111' }, { SIM_WORLDS_HOST: 'other@stub-host' }, { SHIP_ORIGIN: 'https://another.stub' }]) {
    writeFileSync(s.env.STUB_LOG, '');
    const r = s.run([...rootArgs, '--no-probe', '--from', 'walks'], extra);
    assert.equal(r.code, 2, r.out); assert.match(r.out, /mismatched RUN.identity/); assert.deepEqual(r.calls, []);
  }
  writeFileSync(s.env.STUB_LOG, '');
  const r = s.run([...rootArgs, '--no-probe', '--from', 'walks', '--exclude-world', 'eden']);
  assert.equal(r.code, 2, r.out); assert.deepEqual(r.calls, []);
});

test('root-only resume requires the latest prerequisite verdict and refreshes health', () => {
  const s = setup(); assert.equal(s.run([...rootArgs, '--no-probe']).code, 0);
  writeFileSync(s.env.STUB_LOG, '');
  const badHealth = s.run([...rootArgs, '--no-probe', '--from', 'walks'], { STUB_FAIL: 'health.mjs' });
  assert.equal(badHealth.code, 1, badHealth.out);
  assert.equal(badHealth.calls.length, 1); assert.match(badHealth.calls[0], /health.mjs/);
  assert.doesNotMatch(badHealth.out, /SHIPPED/);
  writeFileSync(s.env.STUB_LOG, '');
  const oldPass = s.run([...rootArgs, '--no-probe', '--from', 'walks']);
  assert.equal(oldPass.code, 2, oldPass.out);
  assert.match(oldPass.out, /prerequisite health has not passed/);
  assert.deepEqual(oldPass.calls, []);
});
