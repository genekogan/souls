// Node-only authoring/build interface. The game imports its generated playlist, never this module or the studio.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MUSIC_SOURCE = fileURLToPath(new URL('../source/', import.meta.url));

/** Current owned inputs, not an external-revision lock. Local source edits change the fingerprint. */
export function fingerprintMusicSource(root = MUSIC_SOURCE) {
  const files: { path: string; sha256: string; bytes: number }[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // The opt-in studio may write ignored local renders; they are not authored build inputs.
      if (dir === root && ['renders', 'node_modules', '.DS_Store'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const name = relative(root, path).replaceAll('\\', '/');
        // Import history is evidence, not an input to composition or an edit prohibition.
        if (name === 'PROVENANCE.json') continue;
        const bytes = readFileSync(path);
        files.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      } else throw new Error(`unsupported music source entry: ${path}`);
    }
  }
  walk(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}
