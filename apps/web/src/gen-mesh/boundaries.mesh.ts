// wall/1, fence/1, hedge/1, power-line/1 mesh halves, and nothing for the landform generators
// (cliff, terrace, channel, brush: the terrain itself is the picture). Owner: L3.
// Walls follow the ground with coursed stone / brick tones, a chamfered cap, pillars and a timber or
// iron gate leaf at each gate; fences are picket / rail / iron / wire; hedges are rounded, lumpy,
// optionally in flower; power lines droop between poles with crossarms and insulators.
import { gatesOf, smoothPath } from '@souls/generators';
import { registerMesh, type MeshCtx } from './registry.ts';
import { Soup, h01, rgb, scale, soupMesh, type RGB, type V3 } from './soup.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pathOf = (ctx: MeshCtx) => (ctx.entity.shape && 'path' in ctx.entity.shape ? (ctx.entity.shape.path as [number, number][]) : null);
type Run = { a: [number, number]; b: [number, number]; s0: number };
/** Polyline split into ~step m pieces with their arc-length start. */
function pieces(path: [number, number][], step: number): Run[] {
  const out: Run[] = []; let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push({ a: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], b: [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n], s0: s + (len * k) / n });
    s += len;
  }
  return out;
}
const inGate = (gates: { at: number; width: number }[], q: number, pad = 0) => gates.some((g) => q > g.at - g.width / 2 - pad && q < g.at + g.width / 2 + pad);
function gatePoints(path: [number, number][], gates: { at: number; width: number }[]) {
  return gates.map((g) => { let s = 0; for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (s + len >= g.at || i === path.length - 1) { const t = len ? (g.at - s) / len : 0, dx = (b[0] - a[0]) / (len || 1), dz = (b[1] - a[1]) / (len || 1); return { c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number], d: [dx, dz] as [number, number], w: g.width }; } s += len; } return { c: path[0], d: [1, 0] as [number, number], w: g.width }; });
}

const WALL: Record<string, string> = { stone: '#b8ae9c', brick: '#a65a43', plaster: '#efe6d4', wood: '#8f6a45', hedge: '#3f6b35', glass: '#bcd8e6' };
registerMesh({
  gen: 'wall/1', world: true,
  build(ctx) {
    const path = pathOf(ctx); if (!path) return null;
    const h = num(ctx.params.height, 1.8), t = num(ctx.params.thickness, 0.3), mat = String(ctx.params.material ?? 'stone');
    const base = rgb(typeof ctx.params.color === 'string' && ctx.params.color !== '#c9c1b2' ? ctx.params.color : WALL[mat] ?? WALL.stone), gates = gatesOf(ctx.params.gates);
    const g = (x: number, z: number) => ctx.model.terrain.sample(x, z), soup = new Soup(), course = mat === 'brick' ? 0.3 : 0.45;
    for (const r of pieces(path, mat === 'brick' ? 0.9 : 1.2)) {
      const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), q = r.s0 + len / 2; if (inGate(gates, q)) continue;
      const y0 = Math.min(g(r.a[0], r.a[1]), g(r.b[0], r.b[1])) - 0.15;
      const yTop = Math.max(g(r.a[0], r.a[1]), g(r.b[0], r.b[1])) + h;
      // coursed blocks: rows of stones of slightly varying tone (and a stagger)
      const rows = Math.max(1, Math.round((yTop - y0) / course));
      for (let k = 0; k < rows; k++) {
        const ya = y0 + ((yTop - y0) * k) / rows, yb = y0 + ((yTop - y0) * (k + 1)) / rows;
        const c = mat === 'plaster' || mat === 'glass' ? base : scale(base, 0.84 + h01(Math.round(r.s0 * 10), k, 3) * 0.26);
        soup.beam([r.a[0], ya, r.a[1]], [r.b[0], ya, r.b[1]], t, yb - ya - (mat === 'plaster' ? 0 : 0.015), c, k === rows - 1 ? 0 : 0.015);
      }
      if (ctx.params.cap !== false) soup.beam([r.a[0], yTop, r.a[1]], [r.b[0], yTop, r.b[1]], t + 0.1, 0.1, mat === 'plaster' ? rgb('#c9bda5') : scale(base, 1.1), 0.04);
    }
    // gates: two pillars with caps and a leaf (timber planks for stone/brick, iron bars for plaster)
    for (const gp of gatePoints(path, gates)) for (const side of [-1, 1]) {
      const x = gp.c[0] + gp.d[0] * side * (gp.w / 2 + 0.25), z = gp.c[1] + gp.d[1] * side * (gp.w / 2 + 0.25), y = g(x, z) - 0.1;
      soup.box([x, y + (h + 0.4) / 2, z], [0.5, h + 0.4, 0.5], Math.atan2(-gp.d[1], gp.d[0]), scale(base, 0.95), 0.04);
      soup.box([x, y + h + 0.45, z], [0.62, 0.12, 0.62], Math.atan2(-gp.d[1], gp.d[0]), scale(base, 1.12), 0.04);
      soup.blob([x, y + h + 0.62, z], [0.16, 0.14, 0.16], scale(base, 1.15), 0, 0.05, 3);
    }
    gatePoints(path, gates).forEach((gp, gi) => {
      const leaf = mat === 'plaster' ? rgb('#2b2e31') : rgb('#7a5636'), y = g(gp.c[0], gp.c[1]);
      const a: [number, number] = [gp.c[0] - gp.d[0] * gp.w / 2, gp.c[1] - gp.d[1] * gp.w / 2];
      // the leaf stands ajar, hinged at one pillar (an open gap, the default); a gate set `state: 'closed'` is shut across it
      const ang = gates[gi].state === 'closed' ? 0 : 0.6, dx = Math.cos(ang) * gp.d[0] - Math.sin(ang) * gp.d[1], dz = Math.sin(ang) * gp.d[0] + Math.cos(ang) * gp.d[1];
      const b: [number, number] = [a[0] + dx * gp.w * 0.95, a[1] + dz * gp.w * 0.95];
      const n = Math.max(3, Math.round(gp.w / 0.18));
      for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; soup.box([x, y + 0.65, z], [0.06, 1.1, 0.06], Math.atan2(-dz, dx), leaf, 0.01); }
      for (const yy of [0.25, 1.1]) soup.beam([a[0], y + yy, a[1]], [b[0], y + yy, b[1]], 0.08, 0.08, leaf);
    });
    return soupMesh(soup, `wall ${ctx.entity.name ?? ctx.entity.id}`);
  },
});

registerMesh({
  gen: 'fence/1', world: true,
  build(ctx) {
    const path = pathOf(ctx); if (!path) return null;
    const h = num(ctx.params.height, 1.1), style = String(ctx.params.style ?? 'picket'), spacing = num(ctx.params.postSpacing, 2), gates = gatesOf(ctx.params.gates);
    const col = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : '#e9e2d0'), iron = rgb('#2b2e31');
    const c = style === 'iron' ? iron : style === 'wire' ? rgb('#7a5a3a') : col;
    const g = (x: number, z: number) => ctx.model.terrain.sample(x, z), soup = new Soup();
    const runs = pieces(path, spacing);
    for (const r of runs) {
      const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
      if (!inGate(gates, r.s0 + 0.01, 0.05)) { const y = g(r.a[0], r.a[1]); soup.box([r.a[0], y + (h + 0.1) / 2 - 0.05, r.a[1]], [0.11, h + 0.1, 0.11], Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]), scale(c, 0.9), 0.02); if (style !== 'iron') soup.cone([r.a[0], y + h + 0.05, r.a[1]], 0.08, 0.08, scale(c, 0.9), 4); }
      if (inGate(gates, r.s0 + len / 2)) continue;
      const ya = g(r.a[0], r.a[1]), yb = g(r.b[0], r.b[1]);
      const rails = style === 'rail' ? [0.35, 0.7, h - 0.05] : style === 'wire' ? [0.3, 0.6, 0.9].filter((v) => v < h) : style === 'iron' ? [0.12, h - 0.08] : [0.3, h - 0.25];
      for (const yy of rails) soup.beam([r.a[0], ya + yy, r.a[1]], [r.b[0], yb + yy, r.b[1]], style === 'wire' ? 0.012 : 0.05, style === 'wire' ? 0.012 : 0.07, c);
      if (style === 'picket' || style === 'iron') {
        const n = Math.max(1, Math.round(len / (style === 'iron' ? 0.14 : 0.16)));
        for (let k = 1; k < n; k++) {
          const x = r.a[0] + ((r.b[0] - r.a[0]) * k) / n, z = r.a[1] + ((r.b[1] - r.a[1]) * k) / n, y = g(x, z);
          if (style === 'picket') { soup.box([x, y + (h - 0.12) / 2 + 0.02, z], [0.08, h - 0.12, 0.025], Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]), scale(c, 0.96 + h01(k, 2) * 0.06)); soup.tri([x - 0.04 * Math.cos(0), y + h - 0.1, z], [x, y + h + 0.02, z], [x + 0.04, y + h - 0.1, z], c); }
          else { soup.cyl([x, y, z], 0.012, h, iron, 4); soup.cone([x, y + h, z], 0.025, 0.07, iron, 4); }
        }
      }
    }
    // a fence gate is an open gap; one set `state: 'closed'` gets a shut leaf (two rails and staves) across it
    gatePoints(path, gates.filter((x) => x.state === 'closed')).forEach((gp) => {
      const a: V3 = [gp.c[0] - gp.d[0] * gp.w / 2, 0, gp.c[1] - gp.d[1] * gp.w / 2], b: V3 = [gp.c[0] + gp.d[0] * gp.w / 2, 0, gp.c[1] + gp.d[1] * gp.w / 2];
      const y = g(gp.c[0], gp.c[1]), n = Math.max(3, Math.round(gp.w / 0.16));
      for (const yy of [0.3, h - 0.25]) soup.beam([a[0], y + yy, a[2]], [b[0], y + yy, b[2]], 0.05, 0.07, c);
      for (let k = 0; k <= n; k++) soup.box([a[0] + (b[0] - a[0]) * k / n, y + (h - 0.12) / 2 + 0.02, a[2] + (b[2] - a[2]) * k / n], [0.07, h - 0.12, 0.03], Math.atan2(-gp.d[1], gp.d[0]), scale(c, 0.94));
    });
    return soupMesh(soup, `fence ${ctx.entity.name ?? ctx.entity.id}`);
  },
});

registerMesh({
  gen: 'hedge/1', world: true,
  build(ctx) {
    const path = pathOf(ctx); if (!path) return null;
    const h = num(ctx.params.height, 1.2), w = num(ctx.params.width, 0.8), gates = gatesOf(ctx.params.gates);
    const base = rgb(typeof ctx.params.color === 'string' ? ctx.params.color : '#3f6b35'), flowers = ctx.params.flowers === true;
    const g = (x: number, z: number) => ctx.model.terrain.sample(x, z), soup = new Soup(), pal: RGB[] = [rgb('#f2f0e6'), rgb('#e88aa8'), rgb('#e8c547')];
    const runs = pieces(smoothPath(path, 1.1, 400), 1.1);
    runs.forEach((r, i) => {
      const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]); if (inGate(gates, r.s0 + len / 2, 0.2)) return;
      const x = (r.a[0] + r.b[0]) / 2, z = (r.a[1] + r.b[1]) / 2, y = g(x, z), jit = 0.9 + h01(i, 1) * 0.2;
      const yaw = Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]), co = Math.cos(yaw), si = Math.sin(yaw);
      // a squashed blob per 0.7 m, overlapping, so the hedge reads rounded and lumpy, never boxed
      soup.blob([x, y + h * 0.5, z], [len * 0.85 * Math.abs(co) + w * 0.55 * Math.abs(si), h * 0.55 * jit, len * 0.85 * Math.abs(si) + w * 0.55 * Math.abs(co)], scale(base, 0.9 + h01(i, 2) * 0.18), 1, 0.08, i);
      if (flowers) for (let k = 0; k < 2; k++) { const a = h01(i, k, 5) * 6.28, px = x + Math.cos(a) * w * 0.45, pz = z + Math.sin(a) * w * 0.45; soup.blob([px, y + h * (0.4 + h01(i, k, 6) * 0.55), pz], [0.07, 0.06, 0.07], pal[k % 3], 0, 0, i * 3 + k, false); }
    });
    return soupMesh(soup, `hedge ${ctx.entity.name ?? ctx.entity.id}`);
  },
});

registerMesh({
  gen: 'power-line/1', world: true,
  build(ctx) {
    const path = pathOf(ctx); if (!path) return null;
    const spacing = num(ctx.params.spacing, 30), h = num(ctx.params.height, 8), nw = Math.round(num(ctx.params.wires, 3)), droop = num(ctx.params.droop, 0.03);
    const g = (x: number, z: number) => ctx.model.terrain.sample(x, z), soup = new Soup(), wood = rgb('#6b5038'), ins = rgb('#d8dde0'), wire = rgb('#2b2b2b');
    // poles along the path every `spacing` m (and at the ends)
    const poles: { p: [number, number]; d: [number, number] }[] = [];
    let s = 0, next = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), d: [number, number] = [(b[0] - a[0]) / (len || 1), (b[1] - a[1]) / (len || 1)];
      while (next <= s + len + 1e-6) { const t = (next - s) / (len || 1); poles.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d }); next += spacing; }
      s += len;
    }
    const last = path[path.length - 1]; if (!poles.length || Math.hypot(poles[poles.length - 1].p[0] - last[0], poles[poles.length - 1].p[1] - last[1]) > spacing * 0.3) poles.push({ p: last, d: poles[poles.length - 1]?.d ?? [1, 0] });
    const tips: V3[][] = poles.map(({ p, d }) => {
      const y = g(p[0], p[1]);
      soup.cyl([p[0], y - 0.3, p[1]], 0.16, h + 0.3, wood, 7, 0.12);
      const nx = -d[1], nz = d[0], arm = 1.1;
      soup.beam([p[0] - nx * arm, y + h - 0.35, p[1] - nz * arm], [p[0] + nx * arm, y + h - 0.35, p[1] + nz * arm], 0.12, 0.12, wood, 0.02);
      return Array.from({ length: nw }, (_, k) => { const o = nw === 1 ? 0 : -arm * 0.85 + (1.7 * arm * k) / (nw - 1); const tp: V3 = [p[0] + nx * o, y + h - 0.23, p[1] + nz * o]; soup.cyl([tp[0], tp[1] - 0.02, tp[2]], 0.05, 0.18, ins, 6, 0.035); return [tp[0], tp[1] + 0.16, tp[2]]; });
    });
    // wires: a catenary-ish parabola between poles
    for (let i = 1; i < tips.length; i++) for (let k = 0; k < nw; k++) {
      const a = tips[i - 1][k], b = tips[i][k], span = Math.hypot(b[0] - a[0], b[2] - a[2]), sag = span * droop, N = 8;
      for (let j = 0; j < N; j++) {
        const t0 = j / N, t1 = (j + 1) / N, P = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
        soup.rod(P(t0), P(t1), 0.018, wire, 3);
      }
    }
    return soupMesh(soup, `power line ${ctx.entity.name ?? ctx.entity.id}`);
  },
});

for (const gen of ['cliff/1', 'terrace/1', 'channel/1', 'brush/1']) registerMesh({ gen, world: true, build: () => null });
