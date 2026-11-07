// What a world says about the Soul CLI it serves, read with /v1/config: a Souls home records it and checks a world's needs
// against it, and `upgrade` verifies the bundle it fetches. Computed from the served file, once per change of that file.
import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {EDGE_CONTRACT} from './edge/contract.ts';

/** The oldest CLI this server's edge contract still serves. Raise it only when an older client would misread the world. */
export const SOUL_CLIENT_MIN = '2.0.0';
export type SoulClientManifest = {contract: string; version: string; bytes: number; sha256: string; minVersion: string};
let held: {file: string; mtimeMs: number; size: number; manifest: SoulClientManifest} | null = null;
export function soulClientManifest(file: string | undefined): SoulClientManifest | undefined {
  if (!file) return undefined;
  try {
    const {mtimeMs, size} = statSync(file);
    if (held?.file === file && held.mtimeMs === mtimeMs && held.size === size) return held.manifest;
    const bytes = readFileSync(file), version = /const VERSION = "([0-9.]+)"/.exec(bytes.toString('utf8'))?.[1];
    if (!version) return undefined;
    const manifest = {contract: EDGE_CONTRACT, version, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), minVersion: SOUL_CLIENT_MIN};
    held = {file, mtimeMs, size, manifest};
    return manifest;
  } catch { return undefined; }
}
