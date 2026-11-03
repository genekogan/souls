// Exact source/artifact inventory for safe same-build upload reuse. Installed dependencies are excluded.
// Match release.sh's exact .DS_Store upload exclusion at every depth; other dotfiles remain inventoried.
import {readdirSync, lstatSync, readFileSync, readlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function manifest(root) {
  const rows = [];
  const visit = (relative = '') => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (name === 'node_modules' || name === '.DS_Store' || (!relative && name === 'RELEASE-MANIFEST.json')) continue;
      const path = relative ? relative + '/' + name : name, full = join(root, path), stat = lstatSync(full);
      if (stat.isSymbolicLink()) rows.push({path, link: readlinkSync(full)});
      else if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) rows.push({path, mode: stat.mode & 0o777, sha256: createHash('sha256').update(readFileSync(full)).digest('hex')});
      else throw Error('Unsupported release entry: ' + path);
    }
  };
  visit(); return rows;
}
if (process.argv[2] === 'snapshot') process.stdout.write(JSON.stringify(manifest(process.argv[3])) + '\n');
else if (process.argv[2] === 'verify') {
  const expected = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  if (JSON.stringify(manifest(process.argv[3])) !== JSON.stringify(expected)) throw Error('Existing release differs from its exact manifest; retained without upload or deletion. Use a new build.');
  console.log('Existing release exactly matches manifest; retained and reused.');
}
