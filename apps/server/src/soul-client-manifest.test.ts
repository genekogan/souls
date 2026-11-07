import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {soulClientManifest, SOUL_CLIENT_MIN} from './soul-client-manifest.ts';

test('the manifest describes the file served, and follows it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'soul-client-')), file = join(dir, 'eden.mjs'); t.after(() => rmSync(dir, {recursive: true, force: true}));
  assert.equal(soulClientManifest(undefined), undefined); assert.equal(soulClientManifest(file), undefined);
  const text = 'const VERSION = "3.1.0";\n'; writeFileSync(file, text);
  assert.deepEqual(soulClientManifest(file), {contract: 'eden-edge/1', version: '3.1.0', bytes: text.length, sha256: createHash('sha256').update(text).digest('hex'), minVersion: SOUL_CLIENT_MIN});
  writeFileSync(file, 'no version here, a little longer');
  assert.equal(soulClientManifest(file), undefined, 'a file that names no version describes nothing');
});

test('the shipping CLI is described', () => {
  const file = fileURLToPath(new URL('../../../tools/world-launcher/soul/eden.mjs', import.meta.url));
  assert.equal(soulClientManifest(file)!.version, /const VERSION = "([0-9.]+)"/.exec(readFileSync(file, 'utf8'))![1]);
});
