// SOUL3 publication: the launcher's pinned Soul files (tools/world-launcher/soul, SOURCES.json) are served byte for byte,
// and the rendered instructions capture gets this world's approved URL, name and requested window code per request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture} from '../test/native-owner-fixture.ts';
import {CAPTURE, fillInstructions} from './accounts/instructions.ts';

const dir = new URL('../../../tools/world-launcher/soul/', import.meta.url).pathname;
const sources = JSON.parse(readFileSync(dir + 'SOURCES.json', 'utf8'));
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const capture = readFileSync(dir + 'instructions.md', 'utf8');

// Keep the historical test identity for release-gate comparison; this release publishes polite + continuity controller 2.18.0 (2.7.0 on R4 plus R5's slowed sentence and lifecycle-pending create wait; 2.8.0 prints refusal alternatives, #824; 2.8.1 prints `failed` for a failed or replaced receipt, #373; 2.8.2 ends a wait once a sit, lie or ride holds its pose, #378; 2.9.0 sends offered ids only, #1093; 2.11.0 adds inspect, #1094; 2.12.0 adds the resident client, #1096; 2.13.0 adds durable plans, #1100; 2.14.0 wakes on addressed speech, #476).
test('SOURCES.json pins every published Soul file by sha: the 2.2.1 controller and guides (soul fix round 1 release candidate), and the retained 1.9 CLI', () => {
  for (const k of ['controllerCli', 'cli', 'skill', 'instructions']) assert.equal(sha(readFileSync(dir + sources[k].file)), sources[k].sha256, k);
  assert.equal(sources.controllerCli.file, 'eden.mjs'); assert.equal(sources.controllerCli.version, '2.18.0');
  assert.match(readFileSync(dir + 'eden.mjs', 'utf8'), /const VERSION = "2\.18\.0";/);
  assert.equal(sources.cli.file, 'eden-agent.mjs'); assert.equal(sources.cli.version, '1.9', 'the legacy CLI keeps its version');
  assert.deepEqual(sources.instructions.capture, CAPTURE, 'the server recognises exactly the recorded capture');
  assert.ok(sources.legacy.skill.sha256 && sources.legacy.instructions.sha256, 'the 1.9 guide provenance is kept');
});

test('the capture gets the world URL, name and a valid window code; no code or a bad one drops the flag and the window claim', () => {
  assert.ok(capture.includes(CAPTURE.base) && capture.includes(` --for ${CAPTURE.code}`), 'the published file is the capture');
  const worlds = [['https://sim.example.test/worlds/w/bench-hamlet', 'Bench Hamlet', 'K7QX-M2PA'], ['http://127.0.0.1:4956/w/mars', 'Mars', 'ZZ22-HJ9P']];
  for (const [base, world, code] of worlds) {
    const out = fillInstructions(capture, 'https://spoofed.test/w/x', world, code, base);
    assert.ok(out.startsWith(`# Create a Soul in ${world}\n\nWorld: ${base} (the world's name is **${world}**;`));
    assert.equal(out.split(`${base}/eden.mjs`).length - 1, 1); assert.equal(out.split(`register ${base}\n`).length - 1, 1);
    assert.equal(out.split(` --for ${code}`).length - 1, 2); assert.match(out, /open Sim window/);
    for (const gone of [CAPTURE.code, 'eden-2026', 'Eden 2026', 'spoofed.test']) assert.ok(!out.includes(gone), gone);
    assert.ok(out.includes('`pair <soulId> --for <CODE>`'), 'the generic pairing placeholder is not a captured code');
  }
  for (const bad of [null, undefined, '', 'k7qx-m2pa', 'K7QX-M2PA`; rm -rf /', '<script>', CAPTURE.code + 'X']) {
    const out = fillInstructions(capture, 'https://x.test/w/a', 'A', bad, 'https://sim.example.test/worlds/w/a');
    assert.match(out, /node eden\.mjs create "<Name>"\n/); assert.match(out, /`create "<new name>"` and a new background/);
    assert.ok(!/--for (?!<CODE>)/.test(out) && !/rm -rf|script|GL7R|open Sim window/.test(out), String(bad));
    assert.match(out, /printed `approvalURL` as a raw clickable link/);
  }
  const lookalike = capture.replace('# Create a Soul in Eden 2026', '# Create a Soul in  Eden 2026');
  assert.equal(fillInstructions(lookalike, 'b', 'w', 'K7QX-M2PA', 'a'), lookalike, 'only the exact capture is rewritten');
});

test('HTTP: the real published files are served by hash; the guide uses configuration, never the request host', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  Object.assign(f.souls.cfg, {cliFile: dir + 'eden-agent.mjs', controllerCliFile: dir + 'eden.mjs', skillFile: dir + 'skill.md', instructionsFile: dir + 'instructions.md', publicUrl: 'https://sim.example.test'});
  assert.equal(sha(Buffer.from(await (await f.request('/eden.mjs')).arrayBuffer())), sources.controllerCli.sha256);
  assert.equal(sha(Buffer.from(await (await f.request('/eden-agent.mjs')).arrayBuffer())), sources.cli.sha256);
  assert.equal(sha(await (await f.request('/skill.md')).text()), sources.skill.sha256, 'the 2.1 skill has no templates');
  assert.equal(sha(readFileSync(dir + 'schema-notes.md')), sources.schemaNotes.sha256, 'the reference\'s notes are pinned too');
  // CTRL-7 (#1099): a short core; the reference is its notes plus the generated schema, cacheable by ETag
  const core = await (await f.request('/skill.md')).text();
  assert.ok(Buffer.byteLength(core) <= 3072, 'core skill ' + Buffer.byteLength(core));
  assert.doesNotMatch(core, /\b(cannot|can't|must not)\b/i, 'the offers say what is possible');
  const ref = await f.request('/schema.md'), refText = await ref.text(), etag = ref.headers.get('etag')!;
  assert.match(refText, /\| walk \| via \|/); assert.match(refText, /When things go wrong/);
  assert.doesNotMatch(refText, /structured intent/, 'a strict act takes offered ids only');
  assert.equal((await f.app.request('/schema.md', {headers: {'if-none-match': etag}})).status, 304);
  const get = (q: string) => f.app.request('/instructions.md' + q, {headers: {host: 'evil.test', 'x-forwarded-host': 'evil.test'}});
  const mine = await get('?for=K7QX-M2PA'), text = await mine.text();
  assert.equal(mine.status, 200); assert.equal(mine.headers.get('cache-control'), 'no-store');
  assert.ok(text.startsWith('# Create a Soul in Eden\n\nWorld: https://sim.example.test/w/eden ('));
  assert.match(text, /create "<Name>" --for K7QX-M2PA/); assert.ok(!/evil|GL7R|eden-2026/.test(text));
  const plain = await get(''), shared = await plain.text();
  assert.equal(plain.headers.get('cache-control'), 'public, max-age=60'); assert.ok(!/--for (?!<CODE>)|GL7R/.test(shared));
});
