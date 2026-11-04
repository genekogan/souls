// Issue #872 verification: does a destination the planner refuses open up for a thinner body (planning radius = body radius
// + 0.06 m), and where is the pinch (the lowest-clearance point of the thin body's route, with the obstacles beside it)?
// A case without "from" starts at the nearest connected (main-area) point within 8 m of "to" on the same level.
//   node tools/test-harness/route-corpus/radius-sweep.ts <fixture.db.gz> '[{"name":"x","from":{"p":[x,z],"level":0},"to":{"p":[x,z],"level":0}}]'
import { bootForWalk } from '../../../apps/server/src/god/walk-audit.ts';
import { findRoute } from '../../../mars/viewer/engine/spatial/path.ts';
import { rectOf } from '../../../mars/viewer/engine/spatial/tiled.ts';
import { cellOf } from '../../../mars/viewer/engine/spatial/grid.ts';
const route = findRoute as (...a: unknown[]) => any;
const w = await bootForWalk({ db: process.argv[2] });
const E = w.engine as any, S = E.rt.services.spatial; E.connectivityV1();
const prof = (radius: number) => ({ id: 'probe', radius, height: 1.8, speed: 1.3, turnRate: 4, stepHeight: 0.22 });
function run(from: any, to: any, radius: number, name = false) {
  S.sync(E.rt.world); const rect = rectOf([from.p, to.p], 48), grids = S.ground.gridsOver(rect, S.scene);
  const r = route(grids, { ...S.scene, bounds: [rect[0] * 64, rect[1] * 64, (rect[2] + 1) * 64, (rect[3] + 1) * 64] }, prof(radius), from, to, name ? { nameObstacles: () => true } : {});
  return r.ok ? `ok ${Math.round(r.route.length * 10) / 10} m` : `${r.diagnostic.code}${name && r.diagnostic.subjects ? ' walled by ' + r.diagnostic.subjects.slice(0, 8).join(',') : ''}`;
}
const connectedNear = (g: any, R = 8) => { const pts: any[] = []; for (let dz = -R; dz <= R; dz += 0.5) for (let dx = -R; dx <= R; dx += 0.5) pts.push({ id: `${dx},${dz}`, p: [g.p[0] + dx, g.p[1] + dz], level: g.level, tol: 0.05 });
  const v = E.navCheckV1(pts); let best: any = null, bd = 1e9; v.forEach((x: any, i: number) => { if (x.ok) { const d = Math.hypot(pts[i].p[0] - g.p[0], pts[i].p[1] - g.p[1]); if (d < bd) { bd = d; best = pts[i]; } } }); return best ? { p: best.p, level: g.level, d: Math.round(bd * 100) / 100 } : null; };
const cases = JSON.parse(process.argv[3]);
for (const c of cases) {
  const from = c.from ?? connectedNear(c.to);
  if (!from) { console.log(c.name, 'no connected point near'); continue; }
  const out: Record<string, string> = {};
  for (const r of [0.28, 0.25, 0.22, 0.2, 0.15, 0.1]) out[`r${r}`] = run({ p: from.p, level: from.level ?? 0 }, c.to, r);
  // the pinch: the lowest-clearance point of the r=0.15 route, and the obstacles within 0.8 m of it
  { S.sync(E.rt.world); const rect = rectOf([from.p, c.to.p], 48), grids = S.ground.gridsOver(rect, S.scene), r = route(grids, { ...S.scene, bounds: [rect[0] * 64, rect[1] * 64, (rect[2] + 1) * 64, (rect[3] + 1) * 64] }, prof(0.15), { p: from.p, level: from.level ?? 0 }, c.to, {});
    if (r.ok) { let best: any = null; for (const leg of r.route.legs) if (leg.kind === 'walk') { const g = grids.levels.get(leg.level); for (let i = 1; i < leg.points.length; i++) { const a = leg.points[i - 1], b = leg.points[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05)); for (let k = 0; k <= n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; const ce = cellOf(g, q as any); const cl = ce >= 0 ? g.clearance[ce] : 99; if (best === null || cl < best.cl) best = { cl, q: q.map((v: number) => Math.round(v * 100) / 100), level: leg.level }; } } }
      const near = S.scene.obstacles.filter((o: any) => { const dx = Math.abs(o.obb.c[0] - best.q[0]) - o.obb.half[0], dz = Math.abs(o.obb.c[1] - best.q[1]) - o.obb.half[1]; return Math.max(dx, dz) < 0.8 && Math.min(Math.abs(o.obb.c[0] - best.q[0]), Math.abs(o.obb.c[1] - best.q[1])) < 6; })
        .slice(0, 10).map((o: any) => { const id = o.id.split('#')[0], e = (w.god as any).model.entities.get(id); return `${o.id}(${e?.def ?? o.kind ?? '?'}${e ? ' ' + (w.god as any).model.pathOf(id) : ''})`; });
      console.log(c.name, 'pinch clearance', Math.round(best.cl * 100) / 100, 'at', JSON.stringify(best.q), 'L' + best.level, 'near:', near.join(' ')); } }
  console.log(c.name, 'from', JSON.stringify(from), 'to', JSON.stringify(c.to), JSON.stringify(out));
}
w.stop(); process.exit(0);
