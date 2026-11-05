// H-i (#371): which server code a run measured. One `git status --porcelain=v2 --branch` call gives the server root's
// HEAD (branch.oid) and whether its tree is dirty (any entry line; ignored files never count). The path is never recorded.
import { execFileSync } from 'node:child_process';

const runGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });

/** serverRootState(root, {git?}) → {head, dirty} ({head: null, dirty: null} outside a checkout). git(args) → stdout (tests). */
export function serverRootState(root, { git = runGit } = {}) {
  try {
    const lines = String(git(['-C', root, 'status', '--porcelain=v2', '--branch'])).split('\n').filter(Boolean);
    const oid = lines.find((l) => l.startsWith('# branch.oid '))?.slice('# branch.oid '.length).trim() ?? null;
    return { head: oid && /^[0-9a-f]{7,64}$/.test(oid) ? oid : null, dirty: lines.some((l) => !l.startsWith('#')) };
  } catch { return { head: null, dirty: null }; }
}
