// CW7 (#741): stable distant inventory for the slopes bench. Pure and deterministic: no I/O, no clock, no Math.random.
// A template's own small placed objects (furniture, lamps, trees, the kinds a lived-in world accumulates) are copied
// into an empty corner of the world, so the placed count reaches an exact total while the authored neighbourhood,
// where the Souls stand and act, is unchanged. Copies keep def, params, rotation, scale and state; they drop the
// authored name, batch-local ref (`tmp`) and container (`in`), so each stands alone on open ground.

export const SLOPES_INVENTORY = 'cw7-distant/1';
// Kinds copied (each common in eden-2026, each under about 3 m across). Terrain, buildings, paths and trees are not
// copied: they are not stable clutter and could overlap at the grid's spacing.
export const COPY_DEFS = Object.freeze(['core/floor-lamp@1', 'core/rug@1', 'core/chair@1', 'core/wardrobe@1', 'core/lamp-post@1', 'core/stool@1', 'core/bowl@1', 'core/dresser@1']);
const BATCH_OPS = 256;   // a god batch holds at most 256 ops
export const CLEARANCE_M = 100;   // the region's distance from every authored object's edge: beyond sight (30 m) and go-near (60 m)

const places = (t) => t.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place'));
const reach = (o) => Number(o.params?.radius ?? (o.params?.w ? Math.max(o.params.w, o.params.d ?? 0) / 2 : 2)) || 2;

/** The largest empty square (10 m grid, sides 400 → 60 m) inside the world (±extent/2, 25 m in from the edge) whose
 *  edge is at least `clearance` from every authored placed object's reach. Deterministic: the first in x, then y. */
export function emptySquare(t, clearance = CLEARANCE_M) {
  const ps = places(t).filter((o) => Array.isArray(o.p)).map((o) => [o.p[0], o.p[1], reach(o)]), half = Number(t.constants?.extent ?? 1000) / 2 - 25;
  for (let side = 400; side >= 60; side -= 20) for (let x = -half; x + side <= half; x += 10) for (let y = -half; y + side <= half; y += 10) {
    let ok = true;
    for (const [px, py, r] of ps) { if (Math.hypot(Math.max(x - px, 0, px - x - side), Math.max(y - py, 0, py - y - side)) - r < clearance) { ok = false; break; } }
    if (ok) return { x, y, side };
  }
  return null;
}

/** A copy of template `t` whose placed count is exactly `total` (≥ the template's own). The copies fill a square grid
 *  in emptySquare(t). → {template, added, own, region} */
export function withDistantInventory(t, total, { clearance = CLEARANCE_M } = {}) {
  const own = places(t), add = total - own.length;
  if (!Number.isInteger(total) || add < 0) throw new Error(`inventory ${total}: below the template's own ${own.length} placed objects`);
  if (!add) return { template: t, added: 0, own: own.length, region: null };
  const src = own.filter((o) => COPY_DEFS.includes(o.def)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!src.length) throw new Error('inventory: the template has none of the copied kinds');
  const sq = emptySquare(t, clearance); if (!sq) throw new Error(`inventory: no empty square ${clearance} m from the authored objects`);
  const cols = Math.ceil(Math.sqrt(add)), step = sq.side / cols, ops = [];
  for (let i = 0; i < add; i++) {
    const { tmp: _t, in: _i, name: _n, p: _p, ...keep } = src[i % src.length];
    ops.push({ ...keep, name: `slopes-far-${i}`, p: [+(sq.x + (i % cols + 0.5) * step).toFixed(2), +(sq.y + (Math.floor(i / cols) + 0.5) * step).toFixed(2)] });
  }
  const batches = []; for (let i = 0; i < ops.length; i += BATCH_OPS) batches.push({ note: `CW7 slopes: distant copies ${i}–${Math.min(ops.length, i + BATCH_OPS) - 1} of ${add} (${SLOPES_INVENTORY})`, group: 'slopes', ops: ops.slice(i, i + BATCH_OPS) });
  return { template: { ...t, batches: [...t.batches, ...batches] }, added: add, own: own.length,
    region: { ...sq, stepM: +step.toFixed(2), clearanceM: clearance } };
}
