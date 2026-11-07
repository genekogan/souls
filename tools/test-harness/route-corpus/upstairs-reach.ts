// Issue #872 verification:
//   node tools/test-harness/route-corpus/upstairs-reach.ts <fixture.db.gz> '[{"name":"x","from":{"level":4,"p":[x,z]},"ground":[x,z],"to":{"level":0,"p":[x,z]}|"region":"<id>"}]'
// From an upper floor, the paged planner refuses any goal > 72 m (ground.too-far) that the same planner walks from the
// ground below, and spreadGoalV1 reports that as route.region-full. Spatial.route takes an explicit start, so no body moves.
import { bootForWalk } from '../../../apps/server/src/god/walk-audit.ts';
import { HUMAN_PROFILE } from '../../../mars/viewer/engine/spatial/types.ts';
const w = await bootForWalk({ db: process.argv[2] });
const E = w.engine as any, S = E.rt.services.spatial;
const go = (from: any, to: any) => { const r = S.route(E.rt.world, HUMAN_PROFILE, from, to, {}); return r.ok ? `ok (${Math.round(r.route.length)} m${r.route.rest ? ', chunked' : ''})` : `${r.diagnostic.code}: ${r.diagnostic.message}`; };
for (const c of JSON.parse(process.argv[3])) {
  const to = c.region ? { level: 0, p: (() => { const poly = E.rt.world.regions[c.region].polygon; return [poly.reduce((s: number, p: number[]) => s + p[0], 0) / poly.length, poly.reduce((s: number, p: number[]) => s + p[1], 0) / poly.length]; })() } : c.to;
  console.log(c.name, 'to', JSON.stringify(to), '\n  from upstairs', JSON.stringify(c.from), '->', go(c.from, to), '\n  from the ground below ->', go({ level: 0, p: c.ground ?? c.from.p }, to));
}
w.stop(); process.exit(0);
