// Read-only root topology contract. No account credentials or world mutations.
import { pathToFileURL } from 'node:url';

export const ROOT_WORLDS = [
  ['eden', 'eden-2026'],
  ['mars-college-2026', 'my-mars-college-2026-3'],
  ['mars-college-2027', 'mars-2027'],
];

export async function checkRootHealth(origin, build, request = fetch) {
  const checks = [];
  const check = (name, ok) => { checks.push({ name, ok }); if (!ok) throw Error(name); };
  const get = (path) => request(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const json = async path => {
    const r = await get(path);
    check(`${path}: HTTP 200 without redirect`, r.status === 200);
    return r.json();
  };
  try {
    check('expected immutable build id', /^we-[0-9a-f]{12}$/.test(build));
    const h = await json('/__sim/healthz');
    check('launcher health names exact build', h.ok === true && h.build === build && h.hostOk !== false);
    check('launcher contains canonical worlds', Number.isInteger(h.worlds) && h.worlds >= ROOT_WORLDS.length);
    for (const [slug, old] of ROOT_WORLDS) {
      const c = await json(`/w/${slug}/v1/config`);
      check(`${slug}: build, identity and canonical path`, c.build === build && c.worldKey === slug
        && c.worldPath === `/w/${slug}` && typeof c.worldId === 'string' && c.worldId.length > 0);
      for (const base of ['', '/worlds']) {
        const a = await json(`${base}/w/${old}/v1/config`);
        check(`${base}/w/${old}: same world`, a.build === build && a.worldId === c.worldId && a.worldKey === slug);
        const p = await get(`${base}/w/${old}/?release-check=1`);
        check(`${base}/w/${old}: permanent same-origin canonical page`, p.status === 308
          && new URL(p.headers.get('location') || '', origin).href === new URL(`/w/${slug}/?release-check=1`, origin).href);
      }
    }
    return { schema: 'root-release-health/1', status: 'pass', origin, build, checks };
  } catch (error) {
    return { schema: 'root-release-health/1', status: 'fail', origin, build, checks, error: error.message };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkRootHealth(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
