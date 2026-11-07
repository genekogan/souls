#!/usr/bin/env node
// Issue #872: summarise route-corpus outputs (corpus.ts) per world and per cause class.
//   node tools/test-harness/route-corpus/report.mjs .local/872/<world>.json [...]
// Cause classes are read from each refusal's own experiments (see corpus.ts):
//   window-crop     PLAN refusal, oracle reachable, the planner's own last hop fails on its tile window and passes on the
//                   window grown by one tile (tiled.ts pagedRoute/groundRoute hop, rectOf 12 m margin)
//   pocket-goal     PLAN refusal, the chosen standing point is in a small separate area (<= 50 m2) while the place it belongs
//                   to has a walkable offer from the same start (a sibling `walk:<place>/...` or the place itself)
//   walled-area     PLAN refusal, the target lies in a larger separate area (> 50 m2: a fenced court)
//   furniture-room  MENU refusal (GodNav roomGoal): standing room inside, none of it connected, no closed door involved
//   roof-cut        MENU refusal (GodNav offerWalk `cut`): an upper-floor goal the oracle calls disconnected
//   upstairs-too-far  ground.too-far from an upper floor: the paged planner plans nothing farther than 72 m from upstairs
//   spread-hides-reason  route.region-full from a region spread whose every candidate failed for another reason
//   other
import { readFileSync } from 'node:fs';
const ROUTE = /^route\.(unreachable|goal-blocked|start-blocked|link-unusable|unknown-level)$/, RELATED = /^(route\.region-full|ground\.)/;
const classify = (r, okSet, j) => {
  if (r.code === 'ground.too-far') return j.starts[r.s].at.level > 0 ? 'upstairs-too-far' : 'too-far';
  if (r.code === 'route.region-full') return j.starts[r.s].at.level > 0 ? 'spread-hides-reason (upstairs)' : 'region-full';
  const e = r.exp ?? {}, fail = e.hopReplay?.replay?.find(h => !h.ok);
  if (r.menuBlocked) {
    if (/up where no stair/.test(r.act?.reason ?? '') || (!e.room?.samples && r.oracle?.navGoal && !r.oracle.navGoal.ok)) return 'roof-cut';
    if (e.room?.samples && e.room.connected === 0 && e.room.standable > 0) return 'furniture-room';
    return 'other-menu';
  }
  if (r.label === 'FALSE' && fail && /^ok/.test(fail.grownRect ?? '')) return 'window-crop';
  const pocket = r.oracle?.target?.pocket;
  if (r.oracle?.target && !r.oracle.target.ok && pocket !== undefined) {
    const top = r.cap.slice(5).split('/')[0];
    const sibling = [...okSet].some(k => k.startsWith(`${r.s} walk:${top}`));
    if (pocket <= 50 && (sibling || e.near?.walk === 'ok')) return 'pocket-goal';
    return pocket > 50 ? 'walled-area' : 'pocket-goal-no-sibling';
  }
  return 'other';
};
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8')), s = j.summary, okSet = new Set(j.ok.map(([a, b]) => `${a} ${b}`));
  const route = j.refusals.filter(r => ROUTE.test(String(r.code)));
  const by = (xs, k) => xs.reduce((m, x) => { const v = k(x); m[v] = (m[v] ?? 0) + 1; return m; }, {});
  const related = j.refusals.filter(r => RELATED.test(String(r.code)));
  const cls = [...route, ...related].map(r => ({ r, c: classify(r, okSet, j) }));
  const strictFalse = route.filter(r => r.label === 'FALSE').length, pocket = cls.filter(x => x.c === 'pocket-goal').length;
  console.log(`\n== ${s.world}: starts ${s.starts} (${by(j.starts, x => x.at.level === 0 ? 'L0' : 'upstairs').L0 ?? 0} on the ground), walk checks ${s.checks}, refusals ${s.refusals} ${JSON.stringify(s.byCode)}`);
  console.log(`   route.* refusals ${route.length}: ${JSON.stringify(by(route, r => r.label))}; menu-level ${route.filter(r => r.menuBlocked).length}, plan-level ${route.filter(r => !r.menuBlocked).length}`);
  console.log(`   related refusals ${related.length}: ${JSON.stringify(by(related, r => `${r.code} ${r.label}`))}`);
  console.log(`   false-unreachable rate (strict FALSE / checks) ${(strictFalse / s.checks * 100).toFixed(3)} %; incl. pocket goals ${((strictFalse + pocket) / s.checks * 100).toFixed(3)} %`);
  console.log(`   act path on plan-level refusals: ${JSON.stringify(by(route.filter(r => !r.menuBlocked && r.act), r => r.act.accepted ? (r.act.approach ? 'accepted: closest approach' : r.act.door ? 'accepted: door passage' : 'accepted') : 'refused ' + r.act.code))}`);
  console.log(`   causes: ${JSON.stringify(by(cls, x => `${x.c} [${x.r.label}]`))}`);
  for (const [c, xs] of Object.entries(Object.groupBy(cls, x => x.c))) {
    const ex = [...new Map(xs.map(x => [x.r.cap, x.r])).values()].slice(0, 3);
    console.log(`   - ${c}: ${xs.length} (${new Set(xs.map(x => x.r.cap)).size} destinations)`);
    for (const r of ex) { const st = j.starts[r.s].at; console.log(`       s${r.s} (${st.x}, ${st.z}, L${st.level}) ${r.cap}: ${r.message ?? r.act?.reason ?? r.code}`); }
  }
}
