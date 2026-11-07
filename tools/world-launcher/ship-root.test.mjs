// ship.sh: the root-only release command, run against a fake host. The git repository, the receipts and the verdicts are
// real. ssh runs the remote block for real under an empty environment, on a host made of temp files with a fake systemctl
// and curl. Build, browser and activation tools are stubs that log. Nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activationProblems, backupReceipt, receiptProblems } from './deploy/ship/root-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP = join(HERE, 'deploy/ship.sh');
const HOST = 'fake-release-host';
const PREV = 'we-000000000000';
const sha256 = s => createHash('sha256').update(s).digest('hex');
const script = (file, body) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`); chmodSync(file, 0o755); };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.test' } }).trim();

function setup() {
  const t = mkdtempSync(join(tmpdir(), 'ship-root-'));
  const log = join(t, 'calls.log'), root = join(t, 'host/root'), data = join(t, 'host/data'), conf = join(t, 'host/production.conf'), fakebin = join(t, 'fakebin'), repo = join(t, 'repo');
  writeFileSync(log, '');
  // the release repo: real git, with origin/main
  // git init -b needs git 2.28; the CI hosts include older ones (#1162)
  execFileSync('git', ['init', '-q', '--bare', join(t, 'origin.git')]); git(join(t, 'origin.git'), 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main'); writeFileSync(join(repo, 'a'), '1'); git(repo, 'add', 'a'); git(repo, 'commit', '-qm', 'one');
  git(repo, 'remote', 'add', 'origin', join(t, 'origin.git')); git(repo, 'push', '-q', 'origin', 'main'); git(repo, 'fetch', '-q', 'origin');
  const sha = git(repo, 'rev-parse', 'HEAD'), build = `we-${sha.slice(0, 12)}`;
  // receipts
  const receipts = join(t, 'receipts'), writeReceipts = (gate = {}, ship = {}) => {
    const g = JSON.stringify({ refs: { candidate: { sha } }, scope: { resolved: 'full' }, status: 'pass', blockers: [], newFailures: [], unexpectedSkips: [], removed: [], ...gate });
    writeFileSync(join(receipts, 'receipt.json'), g);
    writeFileSync(join(receipts, 'ship-receipt.json'), JSON.stringify({ candidate: sha, status: 'pass', blockers: [], newFailures: 0, gate: { sha256: sha256(g) }, ...ship }));
  };
  mkdirSync(receipts); writeReceipts();
  // the fake host: a previous release, the keeper's record, four databases including body-collections.sqlite
  const keeperSource = 'keeper\n', activate = `printf 'activate\\t%s\\n' "$*" >> ${log}\n[ ! -e ${t}/fail-before-link ] || [ "$2" = ${root}/releases/${PREV} ] || exit 1\n[ ! -e ${t}/stray-link ] || { ln -sfn /elsewhere ${root}/production; exit 1; }\nln -sfn "$2" ${root}/production\n[ ! -e ${t}/fail-activate ] || [ "$2" = ${root}/releases/${PREV} ] || exit 1\n[ ! -e ${t}/fail-rollback ] || [ "$2" != ${root}/releases/${PREV} ] || exit 1`;
  const release = name => { mkdirSync(join(root, 'releases', name, 'tools/world-launcher/deploy'), { recursive: true }); writeFileSync(join(root, 'releases', name, 'tools/world-launcher/keeper.mjs'), keeperSource); script(join(root, 'releases', name, 'tools/world-launcher/deploy/activate.sh'), activate); };
  release(PREV); symlinkSync(join(root, 'releases', PREV), join(root, 'production'));
  for (const f of ['worlds/eden/sim.db', 'worlds/mars/sim.db', 'accounts.sqlite', 'body-collections.sqlite']) { mkdirSync(dirname(join(data, f)), { recursive: true }); writeFileSync(join(data, f), ''); }
  writeFileSync(join(data, 'worlds.json'), JSON.stringify({ worlds: [{ slug: 'eden' }, { slug: 'mars' }] }));
  writeFileSync(join(data, 'keeper.json'), JSON.stringify({ keeper: { pid: 4242, sha: sha256(keeperSource) }, active: { build: PREV } }));
  writeFileSync(conf, 'PORT=1\n');
  script(join(fakebin, 'systemctl'), 'echo 4242');
  script(join(fakebin, 'curl'), `[ ! -e ${t}/fail-health ] || exit 1\nprintf '{"ok":true,"hostOk":true,"auth":"clerk","maxWorlds":100,"maxRunning":16,"worlds":2,"build":"%s"}' "$(basename "$(readlink ${root}/production)")"`);
  if (spawnSync('sh', ['-c', 'command -v sha256sum']).status !== 0) script(join(fakebin, 'sha256sum'), 'exec shasum -a 256 "$@"');
  // ssh and scp: an empty environment on the far side, proving the remote block needs nothing from the operator
  script(join(t, 'stubs/ssh'), `printf 'ssh\\t%s\\n' "$*" >> ${log}\nwhile [ "\${1:-}" = -o ]; do shift 2; done; shift\ncase "$*" in true) exit 0;; *" verify "*) cat > /dev/null; echo ok; exit 0;; "bash -s --"*) [ ! -e ${t}/ssh-drop ] || { cat > /dev/null; exit 255; }; [ ! -e ${t}/tamper-manifest ] || echo tampered >> ${root}/releases/${build}/RELEASE-MANIFEST.json; [ ! -e ${t}/tamper-keeper ] || echo '{"keeper":{"pid":1}}' > ${data}/keeper.json;; esac\nexec env -i PATH="${fakebin}:$PATH" HOME=/nonexistent bash -c "$*"`);
  script(join(t, 'stubs/scp'), `printf 'scp\\t%s\\n' "$*" >> ${log}\ndest="\${@: -1}"; dest="\${dest#*:}"\ncase "$dest" in\n*compact-backup.sh) cat > "$dest" <<'BK'\n#!/usr/bin/env bash\nB=$(mktemp -d ${t}/host/$1-$2-XXXXXX)\nfor f in worlds/eden/sim.db worlds/mars/sim.db accounts.sqlite body-collections.sqlite; do mkdir -p "$(dirname "$B/$f")"; : > "$B/$f"; echo '{"dropped":{}}'; done\necho "$B"\nBK\n;;\n*sim-quick-check.mjs) echo 'for (const f of process.argv.slice(2)) console.log("ok " + f);' > "$dest";;\n*) : > "$dest";;\nesac`);
  // build, browser and manifest tools
  script(join(t, 'stubs/node'), `printf 'node\\t%s\\n' "$*" >> ${log}\nif [ -n "\${STUB_FAIL:-}" ] && [[ "$*" == *"$STUB_FAIL"* ]]; then exit 1; fi\ncase "$1" in *release-probe.mjs)\n  while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done\n  mkdir -p "$out"; touch "$out/ready"\n  for i in $(seq 1 600); do { [ -e "$out/released" ] || [ -e "$out/stop" ]; } && break; sleep 0.05; done\n  exit "\${STUB_PROBE_RC:-0}";;\nesac\nexit 0`);
  script(join(t, 'stubs/python'), `printf 'python\\t%s\\n' "$*" >> ${log}`);
  script(join(t, 'stubs/release'), `printf 'release\\t%s base=%s\\n' "$*" "$SIM_WORLDS_BASE" >> ${log}\nmkdir -p ${t}/lane/${build} ${root}/releases/${build}/tools/world-launcher/deploy\necho manifest > ${t}/lane/${build}/RELEASE-MANIFEST.json\necho manifest > ${root}/releases/${build}/RELEASE-MANIFEST.json\nprintf '${keeperSource}' > ${root}/releases/${build}/tools/world-launcher/keeper.mjs\ncp ${root}/releases/${PREV}/tools/world-launcher/deploy/activate.sh ${root}/releases/${build}/tools/world-launcher/deploy/activate.sh`);
  // browsers: a folder that holds Chromium
  script(join(t, 'browsers/chromium-1/chrome-linux/chrome'), '');
  script(join(t, 'no-chromium/firefox-1/firefox/firefox'), '');
  mkdirSync(join(t, 'god'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SIM_DEPLOY_ENV: '/nonexistent', SIM_DEPLOY_HOST: HOST, SIM_DEPLOY_USER: 'root', SHIP_ROOT: repo, SHIP_RECEIPTS: receipts,
    SHIP_PROBE_CLI: join(t, 'god'), PLAYWRIGHT_BROWSERS_PATH: join(t, 'browsers'), SHIP_ORIGIN: 'https://soul.test', SHIP_OUT_ROOT: join(t, 'out'), SHIP_RELEASE_DIR: join(t, 'lane'),
    SHIP_HOST_ROOT: root, SHIP_HOST_DATA: data, SHIP_HOST_CONF: conf, SHIP_HOST_TMP: join(t, 'host'), SHIP_SSH: join(t, 'stubs/ssh'), SHIP_SCP: join(t, 'stubs/scp'), SHIP_NODE: join(t, 'stubs/node'),
    SHIP_PYTHON: join(t, 'stubs/python'), SHIP_RELEASE_SH: join(t, 'stubs/release'), SHIP_CURL: join(fakebin, 'curl'), SHIP_WALK_SLUGS: 'eden mars' };
  const run = (args, more = {}) => spawnSync('bash', [SHIP, ...args], { env: { ...env, ...more }, encoding: 'utf8', timeout: 60_000 });
  return { t, repo, sha, build, env, run, writeReceipts, root, out: join(t, 'out/4.16'), calls: () => readFileSync(log, 'utf8'), base: ['--label', '4.16', '--sha', sha] };
}

test('--dry-run prints every step, touches nothing remote, writes nothing and never prints the host', () => {
  const s = setup(), r = s.run([...s.base, '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const names = [...r.stdout.matchAll(/^== \[(\d+)\/12\] ([a-z-]+):/gm)].map(m => m[2]);
  assert.deepEqual(names, ['preflight', 'snapshot', 'stage', 'backup', 'probe-start', 'activate', 'probe-check', 'healthz', 'walks', 'poster', 'stall', 'cdn-walk']);
  assert.equal(s.calls(), '');
  assert.ok(!existsSync(s.out));
  assert.ok(!r.stdout.includes(HOST));
  assert.match(r.stdout, /--no-activate/);
});

test('--dry-run reports what would stop a real run, and exits 1', () => {
  const s = setup(); writeFileSync(join(s.repo, 'a'), 'dirty');
  const r = s.run([...s.base, '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PREFLIGHT WOULD STOP: uncommitted changes/);
  assert.equal(s.calls(), '');
});

test('every guard refuses before anything remote', () => {
  const cases = [
    ['a dirty tree', s => writeFileSync(join(s.repo, 'a'), 'dirty'), {}, /uncommitted changes/],
    ['--sha is not HEAD', s => { writeFileSync(join(s.repo, 'b'), '1'); git(s.repo, 'add', 'b'); git(s.repo, 'commit', '-qm', 'two'); }, {}, /not --sha/],
    ['no host in the environment', () => {}, { SIM_DEPLOY_HOST: '' }, /SIM_DEPLOY_HOST is not set/],
    ['no receipts folder', () => {}, { SHIP_RECEIPTS: '' }, /SHIP_RECEIPTS is not set/],
    ['a gate receipt for another commit', s => s.writeReceipts({ refs: { candidate: { sha: 'f'.repeat(40) } } }), {}, /receipts are not clean/],
    ['a gate with new failures', s => s.writeReceipts({ newFailures: [{ id: 'x' }] }), {}, /receipts are not clean/],
    ['a scoped gate', s => s.writeReceipts({ scope: { resolved: 'auto' } }), {}, /receipts are not clean/],
    ['a ship receipt for another gate', s => s.writeReceipts({}, { gate: { sha256: 'x' } }), {}, /receipts are not clean/],
    ['no probe god folder', () => {}, { SHIP_PROBE_CLI: '/nonexistent' }, /SHIP_PROBE_CLI/],
    ['a browsers path without Chromium', s => {}, 'no-chromium', /holds no Chromium/],
  ];
  for (const [name, arrange, more, want] of cases) {
    const s = setup(); arrange(s);
    const r = s.run(s.base, more === 'no-chromium' ? { PLAYWRIGHT_BROWSERS_PATH: join(s.t, 'no-chromium') } : more);
    assert.equal(r.status, 1, name);
    assert.match(r.stdout, want, name);
    assert.doesNotMatch(s.calls(), /ssh|scp|release/, name);
  }
});

test('a commit that is not on origin/main is refused', () => {
  const s = setup(); writeFileSync(join(s.repo, 'b'), '1'); git(s.repo, 'add', 'b'); git(s.repo, 'commit', '-qm', 'local only');
  const sha = git(s.repo, 'rev-parse', 'HEAD'); s.writeReceipts({ refs: { candidate: { sha } } }, { candidate: sha });
  const r = s.run(['--label', '4.16', '--sha', sha]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not an ancestor of origin\/main/);
  assert.equal(s.calls(), '');
});

test('there is no host option, and --sha must be the full commit', () => {
  const s = setup();
  assert.equal(s.run([...s.base, '--host', 'x']).status, 2);
  assert.equal(s.run(['--label', '4.16', '--sha', s.sha.slice(0, 12)]).status, 2);
  assert.equal(s.calls(), '');
});

test('a full run on the fake host: every step in order, the host block under an empty environment, ship never names the host', () => {
  const s = setup(), r = s.run(s.base);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readlinkSync(join(s.root, 'production')), join(s.root, 'releases', s.build));
  const steps = readFileSync(join(s.out, 'STEPS.txt'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(' ')[0]);
  assert.deepEqual(steps, ['snapshot', 'stage', 'backup', 'probe-start', 'activate', 'probe-check', 'healthz', 'walks', 'poster', 'stall', 'cdn-walk']);
  const calls = s.calls();
  assert.match(calls, /release\tproduction --no-activate base=\//);
  assert.equal(calls.match(/^activate\t/gm).length, 1);
  assert.ok(calls.indexOf('compact-backup.sh pre-r416 production') < calls.indexOf('activate\t'));
  assert.ok(calls.indexOf('release-probe.mjs') < calls.indexOf('activate\t'));
  const snapshot = JSON.parse(readFileSync(join(s.out, 'snapshot.json'), 'utf8'));
  assert.ok(snapshot.remote.databasePaths.includes('body-collections.sqlite'));
  assert.equal(JSON.parse(readFileSync(join(s.out, 'backup-receipt.json'), 'utf8')).databases, 4);
  assert.match(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), new RegExp(`releases/${PREV}/tools/world-launcher/deploy/activate.sh production`));
  assert.equal(JSON.parse(readFileSync(join(s.out, 'ship-result.json'), 'utf8')).status, 'live');
  for (const f of ['ship.log', 'ROLLBACK.txt', 'snapshot.json', 'ship-result.json']) assert.ok(!readFileSync(join(s.out, f), 'utf8').includes(HOST), f);
  assert.ok(!r.stdout.includes(HOST));
});

test('the host scripts read no operator variable', () => {
  for (const f of ['host-activate.sh', 'host-snapshot.py']) assert.doesNotMatch(readFileSync(join(HERE, 'deploy/ship', f), 'utf8'), /SIM_DEPLOY|SHIP_|PLAYWRIGHT|\$\{?HOST\b/, f);
});

test('a failed activation rolls code back on the host, stops the run and the probe, and starts no walk', () => {
  const s = setup(); writeFileSync(join(s.t, 'fail-activate'), '');
  const r = s.run(s.base);
  assert.equal(r.status, 1);
  assert.equal(readlinkSync(join(s.root, 'production')), join(s.root, 'releases', PREV));
  assert.equal(s.calls().match(/^activate\t/gm).length, 2);
  assert.match(r.stdout, /STOPPED at step activate/);
  assert.ok(existsSync(join(s.out, 'probe/stop')));
  assert.doesNotMatch(s.calls(), /walk\.mjs/);
  assert.equal(JSON.parse(readFileSync(join(s.out, 'ship-result.json'), 'utf8')).status, 'stopped');
});

test('the activation stop says what the host reported, and only a finished rollback is called one', () => {
  const ROLLED = /host rolled code back/;
  const cases = [
    ['a guard: the manifest', ['tamper-manifest'], /refused the activation \(exit 80\); nothing changed/, /live now: we-0+: nothing changed/, 'exit 80', 0],
    ['a guard: the keeper record', ['tamper-keeper'], /refused the activation \(exit 80\); nothing changed/, /live now: we-0+: nothing changed/, 'exit 80', 0],
    ['the rollback ran', ['fail-activate'], /failed \(exit 81\); the host rolled code back to we-0+/, /live now: we-0+, by the host's rollback/, 'exit 81', 2],
    ['no link moved', ['fail-before-link'], /failed \(exit 82\); the stage link is on we-0+/, /live now: we-0+, by the stage link/, 'exit 82', 1],
    ['the rollback failed', ['fail-activate', 'fail-rollback'], /ROLLBACK FAILED \(exit 90\)/, /live now: UNKNOWN: the rollback failed/, 'exit 90', 2],
    ['a stray link', ['stray-link'], /unexpected \(exit 91\); the host made no further change/, /live now: UNKNOWN: the stage link is neither/, 'exit 91', 1],
    ['the connection dropped', ['ssh-drop'], /outcome is unknown \(exit 255\)/, /live now: UNKNOWN: read the stage link/, 'exit 255', 0],
  ];
  for (const [name, flags, stop, live, detail, activations] of cases) {
    const s = setup(); for (const f of flags) writeFileSync(join(s.t, f), '');
    const r = s.run(s.base);
    assert.equal(r.status, 1, name);
    assert.match(r.stdout, stop, name);
    assert.match(r.stdout, live, name);
    assert.equal(name === 'the rollback ran', ROLLED.test(r.stdout), name + ': the word rollback is earned');
    assert.equal((s.calls().match(/^activate\t/gm) ?? []).length, activations, name);
    assert.doesNotMatch(s.calls(), /walk\.mjs/, name);
    assert.ok(existsSync(join(s.out, 'probe/stop')), name);
    assert.equal(JSON.parse(readFileSync(join(s.out, 'ship-result.json'), 'utf8')).detail, `activate ${detail}`, name);
  }
});

test('--from snapshot works after a stop: the old snapshot is kept, and a commit already live is refused', () => {
  const s = setup(), drop = join(s.t, 'ssh-drop'); writeFileSync(drop, '');
  assert.equal(s.run(s.base).status, 1);
  const first = readFileSync(join(s.out, 'snapshot.json'), 'utf8');
  rmSync(drop);
  const r = s.run([...s.base, '--from', 'snapshot']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const asides = readdirSync(s.out).filter(f => /^snapshot\.json\.\d+$/.test(f));
  assert.equal(asides.length, 1);
  assert.equal(readFileSync(join(s.out, asides[0]), 'utf8'), first);
  assert.equal(readlinkSync(join(s.root, 'production')), join(s.root, 'releases', s.build));
  // now the candidate is live: a further snapshot must not rename it "previous", or overwrite the rollback
  const before = readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), snap = readFileSync(join(s.out, 'snapshot.json'), 'utf8');
  const again = s.run([...s.base, '--from', 'snapshot']);
  assert.equal(again.status, 1);
  assert.match(again.stdout, /already live/);
  assert.equal(readFileSync(join(s.out, 'ROLLBACK.txt'), 'utf8'), before);
  assert.equal(readFileSync(join(s.out, 'snapshot.json'), 'utf8'), snap);
});

test('a failed post-live verdict is recorded and the later evidence still runs', () => {
  const s = setup(), r = s.run(s.base, { STUB_FAIL: 'checks.mjs poster' });
  assert.equal(r.status, 1);
  const calls = s.calls();
  assert.ok(calls.indexOf('stall.mjs') > calls.indexOf('checks.mjs poster'));
  assert.match(calls, /cdn-walk\.mjs/);
  assert.match(readFileSync(join(s.out, 'POSTLIVE.txt'), 'utf8'), /^poster-verdict 1$/m);
  const result = JSON.parse(readFileSync(join(s.out, 'ship-result.json'), 'utf8'));
  assert.equal(result.status, 'live-with-failures');
  assert.equal(result.detail, 'poster-verdict');
  assert.match(r.stdout, /is LIVE, with failed checks: poster-verdict/);
});

test('the probe: a missed visitor bar is recorded and the run goes on; a rollback stops it', () => {
  let s = setup(), r = s.run(s.base, { STUB_PROBE_RC: '1' });
  assert.equal(r.status, 1);
  assert.match(s.calls(), /cdn-walk\.mjs/);
  assert.equal(JSON.parse(readFileSync(join(s.out, 'ship-result.json'), 'utf8')).detail, 'probe');
  s = setup(); r = s.run(s.base, { STUB_PROBE_RC: '3' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /STOPPED at step probe-check: probe exit 3/);
  assert.doesNotMatch(s.calls(), /walk\.mjs/);
});

test('--from: activation can only follow a fresh probe; resuming at the walks still runs every guard', () => {
  let s = setup();
  assert.equal(s.run([...s.base, '--from', 'activate']).status, 2);
  s = setup(); assert.equal(s.run(s.base).status, 0);
  const before = s.calls().length; writeFileSync(join(s.repo, 'a'), 'dirty');
  assert.equal(s.run([...s.base, '--from', 'walks']).status, 1);
  assert.equal(s.calls().length, before);
  git(s.repo, 'checkout', '-q', 'a');
  const r = s.run([...s.base, '--from', 'walks']);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(s.calls().slice(before).match(/^activate\t/gm), null);
  assert.match(s.calls().slice(before), /walk\.mjs/);
});

test('a second run into the same output folder is refused', () => {
  const s = setup(); assert.equal(s.run(s.base).status, 0);
  const r = s.run(s.base);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /already holds a run/);
});

test('verdicts: receipts, a backup that dropped rows or missed a database, stale activation inputs', () => {
  assert.deepEqual(receiptProblems(null, null, 'a', 'b').length > 0, true);
  const snapshot = { candidate: 'a', at: new Date().toISOString(), remote: { databases: 2, databasePaths: ['accounts.sqlite', 'body-collections.sqlite'] } };
  const log = rows => [...rows, '/b/pre-r416-production-x'].join('\n');
  const ok = '{"dropped":{}}', quick = 'ok /b/pre-r416-production-x/accounts.sqlite\nok /b/pre-r416-production-x/body-collections.sqlite\n';
  assert.equal(backupReceipt(log([ok, ok]), quick, snapshot, 's', '416').databases, 2);
  assert.throws(() => backupReceipt(log([ok, '{"dropped":{"events":1}}']), quick, snapshot, 's', '416'), /dropped rows/);
  assert.throws(() => backupReceipt(log([ok, ok]), 'ok /b/pre-r416-production-x/accounts.sqlite\nok /b/pre-r416-production-x/other.db\n', snapshot, 's', '416'), /filenames differ/);
  assert.throws(() => backupReceipt('nothing', quick, snapshot, 's', '416'), /did not name its folder/);
  const backup = { at: snapshot.at, status: 'pass', snapshotSha256: 's', databases: 2, quickChecks: 2 }, upload = { sha: 'a', manifestSha256: 'm' };
  assert.deepEqual(activationProblems(snapshot, 's', backup, upload, 'm'), []);
  assert.ok(activationProblems(snapshot, 's', backup, upload, 'm', Date.now() + 2 * 3_600_000).length >= 2);
  assert.ok(activationProblems(snapshot, 'other', backup, upload, 'm').length);
  assert.ok(activationProblems(snapshot, 's', backup, { ...upload, manifestSha256: 'x' }, 'm').length);
});
