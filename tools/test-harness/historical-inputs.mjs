// Transport only immutable producer paths explicitly used by frozen fixtures.
// Include commit/tree objects so `git show <original SHA>:<path>` works, without
// shipping ancestor history, other historical blobs, working files or local data.
// The SHAs are the public-history ids of the original producer commits (git filter-repo
// commit-map: f7536a6→4ecb87d, e1139e8→8748afe, d0b08ff→ad8c2c4); the pinned blobs are byte-identical.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [ref, out] = process.argv.slice(2);
if (!ref || !out) throw Error('usage: historical-inputs.mjs <candidate-ref> <out.pack>');
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const json = path => JSON.parse(git('show', `${ref}:${path}`).toString());
const specs = [
  ['4ecb87dc96133f180e03dc5bc336e6d9deba64c5', json('apps/server/test/fixtures/recorded-scene/codec-input.v1.json').files.map(f => f.path)],
  ['8748afe468211a59598822e92ae15ac37f9e9547', Object.keys(json('apps/server/test/fixtures/station-era/native-station-era.v1.json').producer)],
  ['ad8c2c4df48e43e767688392ec55964aa3c7bd7c', Object.keys(json('apps/server/test/fixtures/station/native-station.v1.json').producer.authoredSourceSha256)],
  // The release-driver fixture verifies only the original collector's narrowly pinned recovery exception.
  ['5dc672b8d53607e79f8d16eb9ec24c616f238e37', ['tools/test-harness/modal_suite.py']],
];
const objects = new Set();
for (const [commit, paths] of specs) {
  objects.add(git('rev-parse', `${commit}^{commit}`).toString().trim());
  objects.add(git('rev-parse', `${commit}^{tree}`).toString().trim());
  for (const row of git('ls-tree', '-r', '-t', commit).toString().split('\n')) {
    const match = row.match(/^\d+ tree ([a-f0-9]+)\t/);
    if (match) objects.add(match[1]);
  }
  for (const path of paths) objects.add(git('rev-parse', `${commit}:${path}`).toString().trim());
}
const pack = execFileSync('git', ['pack-objects', '--stdout'], {
  input: [...objects].join('\n') + '\n', maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(resolve(out), pack);
writeFileSync(resolve(out) + '.json', JSON.stringify({ candidate: git('rev-parse', ref).toString().trim(), specs, objects: objects.size, bytes: pack.length }, null, 2) + '\n');
console.log(`historical fixture inputs: ${objects.size} objects, ${pack.length} bytes`);
