// BALLOON-BODY (Soul tranche, Gene 2026-10-23): a god's balloon that is a ride (def carrier + tag balloon; server god/rides.ts
// installs a native Core carrier `hot-air-balloon` under the same name) keeps its own envelope, but its basket is Core's:
// the hollow 1.5 x 1.2 m wicker cabin with the door gap in the back wall (Core local -x), corner posts, valance and burner
// frame from WorldBalloonRide. The kit's solid basket block (and its ropes/burner, which would stand inside the cabin) is
// dropped, so riders stand visibly on the floor and walk in through the door instead of through a solid crate. The cabin is
// built at Core's size whatever the thing's scale, in Core's frame (+x forward; the entity layer turns the thing to Core's yaw
// while the ride twin exists, WorldEntityLayer.poseOverride).
import { isRideBalloonDef } from './ride-balloon.ts';
import * as THREE from 'three';
import { kitArgs } from '@souls/generators';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh } from '../registry.ts';
import { bindMotionModel } from '../motion.ts';
import { buildBalloon } from '../../WorldBalloonRide.ts';

/** Kit shapes that belong to the basket: the solid block, its rim, the rim-to-mouth ropes and the burner. */
const BASKET_TINTS = new Set(['basket', 'rim', 'rope', 'burner']);
type Shape = { kind?: string; tint?: string; at?: number[] };
export function envelopeShapes<T extends Shape>(shapes: readonly T[]): T[] { return shapes.filter((s) => !BASKET_TINTS.has(s.tint ?? '')); }
/** The envelope mouth height (thing-local): the lowest lathe's base, else 3.2. */
export function mouthOf(shapes: readonly Shape[]): number {
  const ys = shapes.filter((s) => s.kind === 'lathe' && Array.isArray(s.at)).map((s) => s.at![1]);
  return ys.length ? Math.min(...ys) : 3.2;
}
let cabinMat: THREE.Material | null = null;

registerMesh({
  gen: 'tag:balloon',
  build(ctx) {
    bindMotionModel(ctx.model);
    const parsed = kitArgs.safeParse(ctx.args); if (!parsed.success) return null;
    if (!isRideBalloonDef(ctx.def)) return buildKit(parsed.data, ctx);
    const shapes = parsed.data.shapes as unknown as Shape[];
    const root = buildKit({ ...parsed.data, shapes: envelopeShapes(shapes) as typeof parsed.data.shapes }, ctx);
    const s = ctx.entity.s ?? 1;
    cabinMat ??= new THREE.MeshStandardMaterial({ name: 'balloon cabin', vertexColors: true, roughness: .78, side: THREE.DoubleSide });
    const cabin = new THREE.Mesh(buildBalloon({ basketOnly: true, mouthY: mouthOf(shapes) * s }), cabinMat);
    cabin.name = 'balloon cabin'; cabin.scale.setScalar(1 / s); cabin.castShadow = true;
    root.add(cabin);
    return root;
  },
  instanceKey: () => null,
});
