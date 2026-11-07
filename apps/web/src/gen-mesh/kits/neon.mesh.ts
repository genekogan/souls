// Soul Actions entry 33: neon signs (defs tagged `neon`): the kit/2 body (posts, board, switch box) plus the glass tube
// lettering of fx/neon.ts on the face listed in make.args.faces ({neon: true, at, w, h}). The words are entity state
// `text` (the owner's), else the def's default. A sign this viewer saw off and then lit strikes and stutters; one
// already lit when the viewer arrives is steady at once.
import { kitArgs } from '@souls/generators';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh } from '../registry.ts';
import { bindMotionModel, nightOf } from '../motion.ts';
import { mountNeon, type NeonFace } from '../../fx/neon.ts';

const wasOff = new Map<string, boolean>();
registerMesh({
  gen: 'tag:neon',
  build(ctx) {
    bindMotionModel(ctx.model);
    const parsed = kitArgs.safeParse(ctx.args); if (!parsed.success) return null;
    const root = buildKit(parsed.data, ctx);
    if (typeof document === 'undefined') return root;
    const face = ((ctx.args.faces ?? []) as (NeonFace & { neon?: boolean })[]).find((f) => f.neon); if (!face) return root;
    const st = ctx.entity.state ?? {}, lit = st.on === true, id = ctx.entity.id;
    const warm = lit && wasOff.get(id) === true; wasOff.set(id, !lit);
    const text = typeof st.text === 'string' ? st.text : (ctx.def.state as { text?: { default?: unknown } } | undefined)?.text?.default;
    mountNeon(root, { id, text, tube: ctx.tint('tube', '#ff3d8e'), border: ctx.tint('border', '#2fd6ff'), face, lit, warm, night: () => nightOf(ctx.model) });
    return root;
  },
});
