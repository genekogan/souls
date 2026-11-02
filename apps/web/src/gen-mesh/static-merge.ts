// Lane PERF: fewer draws for static imported models. Exported campus pieces and vehicles arrive as hundreds of nodes,
// each with its own material (core-mars-tool-camp: 198 meshes, 193 materials), so mars-two drew ~2,100 calls a frame
// (plus the shadow pass) and spent ~6.5 ms of CPU per frame in renderer.render on an M3 Max.
//
// Once per loaded file (gltf-assets.ts `prepare`), a model with no animation, skinning or morph targets is rebuilt as
// a few merged meshes:
//   - untextured opaque standard materials share ONE material per (side, roughness, metalness, emissive, flat) with the
//     material colour baked into vertex colours (a multiply, in linear space, exactly what the shader did);
//   - textured or otherwise special materials merge only meshes that already share that material object;
//   - a `roof` group (Mars campus cut, hidden in the interior view) stays a group of its own; a model with `role:` nodes
//     (vocab state pivots) is left alone.
// The picture is the same: transforms are baked into positions and normals (mirrored nodes flip winding), and the
// merged meshes keep shadows on. `?merge=0` turns this off for A/B measurement.
import * as THREE from 'three';
import { bakeColors, computeBounds, copyComponents, transformNormals, transformPoints } from './fast-geometry.ts';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('merge') === '0';
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'displacementMap', 'envMap'] as const;

type Item = { mesh: THREE.Mesh; mat: THREE.Material; matrix: THREE.Matrix4; group: number };
type Bucket = { key: string; plain: boolean; mat: THREE.Material; items: Item[] };

const plainOf = (m: THREE.Material): m is THREE.MeshStandardMaterial =>
  (m.type === 'MeshStandardMaterial') && !m.transparent && m.opacity >= 1 && (!m.alphaTest || !m.vertexColors) && !(m as THREE.MeshStandardMaterial).wireframe && MAPS.every((k) => !(m as unknown as Record<string, unknown>)[k]);
const r2 = (x: number) => Math.round(x * 20) / 20;

/** Merge a static model's meshes in place (scene children replaced). Returns the draw count before and after, or null when skipped. */
export function mergeStatic(root: THREE.Object3D, animated: boolean): { before: number; after: number } | null {
  if (OFF || animated) return null;
  let ok = true, meshes = 0;
  root.traverse((o) => {
    if (o.name.startsWith('role:') || (o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) ok = false;
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    meshes++;
    if (Object.keys(m.geometry.morphAttributes).length || !m.geometry.attributes.position) ok = false;
  });
  if (!ok || meshes < 3) return null;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: { roof: boolean; buckets: Map<string, Bucket> }[] = [{ roof: false, buckets: new Map() }, { roof: true, buckets: new Map() }];
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return;
    let roof = false; for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name === 'roof') roof = true;
    const matrix = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = Array.isArray(m.material) && m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    groups.forEach((g, gi) => {
      const mat = mats[g.materialIndex ?? 0]; if (!mat) return;
      const plain = plainOf(mat), s = mat as THREE.MeshStandardMaterial;
      const key = plain ? `plain|${s.side}|${r2(s.roughness)}|${r2(s.metalness)}|${s.emissive.getHexString()}|${r2(s.emissiveIntensity)}|${s.flatShading}|${s.polygonOffset}` : `mat|${mat.uuid}`;
      const b = parts[roof ? 1 : 0].buckets;
      let bucket = b.get(key); if (!bucket) b.set(key, bucket = { key, plain, mat, items: [] });
      bucket.items.push({ mesh: m, mat, matrix, group: Array.isArray(m.material) ? gi : -1 });
    });
  });
  const out: THREE.Object3D[] = [];
  let after = 0;
  for (const part of parts) {
    const holder = part.roof ? new THREE.Group() : null; if (holder) holder.name = 'roof';
    for (const bucket of part.buckets.values()) {
      const made = build(bucket);
      for (const mesh of made) { (holder ?? root).add(mesh); after++; }
      if (!holder) out.push(...made);
    }
    if (holder && holder.children.length) out.push(holder);
  }
  // replace the original hierarchy
  for (const c of [...root.children]) if (!out.includes(c)) root.remove(c);
  for (const c of out) if (c.parent !== root) root.add(c);
  return { before: meshes, after };
}

// Lane PERF-MATERIALS: the merged material is shared across files. A plain bucket's material is a function of a few
// numbers (the colour went into the vertices), so two models with the same values draw with one material object: Mars
// campus and pack models mostly share (side, 0.8–1, 0, black): one material and one program for all of them. Nothing
// writes to a merged material (per-object edits take material-variants.ts); it lives for the page like a library material.
const mergedMaterials = new Map<string, THREE.MeshStandardMaterial>();
function mergedMaterial(s: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const key = `${s.side}|${s.roughness}|${s.metalness}|${s.emissive.getHexString()}|${s.emissiveIntensity}|${s.flatShading}|${s.polygonOffset}|${s.polygonOffsetFactor}|${s.polygonOffsetUnits}`;
  let mat = mergedMaterials.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: s.roughness, metalness: s.metalness, emissive: s.emissive, emissiveIntensity: s.emissiveIntensity, side: s.side, flatShading: s.flatShading, polygonOffset: s.polygonOffset, polygonOffsetFactor: s.polygonOffsetFactor, polygonOffsetUnits: s.polygonOffsetUnits });
    mat.userData.edenAsset = true; mat.name = 'merged';
    mergedMaterials.set(key, mat);
  }
  return mat;
}
/** Merged materials made so far (tests and probes). */
export const mergedMaterialCount = () => mergedMaterials.size;

function build(bucket: Bucket): THREE.Mesh[] {
  // attribute set: plain → position, normal, color; others → what the first geometry has (all must match, else unmerged)
  const attrs = (g: THREE.BufferGeometry) => Object.keys(g.attributes).filter((k) => k !== 'normal').sort().join();
  const names = bucket.plain ? ['position', 'normal', 'color'] : [...new Set(['position', 'normal', ...Object.keys(bucket.items[0].mesh.geometry.attributes)])];
  if (!bucket.plain && (names.includes('tangent') || bucket.items.some((it) => attrs(it.mesh.geometry) !== attrs(bucket.items[0].mesh.geometry) || it.group >= 0))) {
    // cannot merge safely: keep each mesh as it was (re-parented with its baked transform)
    return bucket.items.map((it) => {
      let g = it.mesh.geometry; if (it.group >= 0) { const gr = g.groups[it.group]; g = g.clone(); g.clearGroups(); g.setDrawRange(gr.start, gr.count); }
      const m = new THREE.Mesh(g, it.mat); m.name = it.mesh.name; m.castShadow = it.mesh.castShadow; m.receiveShadow = it.mesh.receiveShadow;
      it.matrix.decompose(m.position, m.quaternion, m.scale); return m;
    });
  }
  let vcount = 0, icount = 0;
  const tris = bucket.items.map((it) => {
    const g = it.mesh.geometry, idx = g.index, n = g.attributes.position.count;
    let start = 0, count = idx ? idx.count : n;
    if (it.group >= 0) { const gr = g.groups[it.group]; start = gr.start; count = Math.min(gr.count, (idx ? idx.count : n) - gr.start); }
    vcount += n; icount += count;
    return { start, count };
  });
  const sizes: Record<string, number> = {};
  for (const nm of names) sizes[nm] = nm === 'color' && bucket.plain ? 3 : nm === 'normal' || nm === 'position' ? 3 : bucket.items[0].mesh.geometry.attributes[nm].itemSize;
  const arrays: Record<string, Float32Array> = {}; for (const nm of names) arrays[nm] = new Float32Array(vcount * sizes[nm]);
  const index = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
  const v = new THREE.Vector3(), nrm = new THREE.Matrix3(), col = new THREE.Color();
  let vo = 0, io = 0;
  bucket.items.forEach((it, k) => {
    const g = it.mesh.geometry, n = g.attributes.position.count;
    let normal = g.attributes.normal as THREE.BufferAttribute | undefined;
    if (!normal) { const c = g.clone(); c.computeVertexNormals(); normal = c.attributes.normal as THREE.BufferAttribute; }
    nrm.getNormalMatrix(it.matrix);
    const flip = it.matrix.determinant() < 0;
    const pos = g.attributes.position;
    // fast-geometry.ts: the same arithmetic on the typed arrays (bit-identical); three's per-vertex path otherwise
    if (!transformPoints(pos, it.matrix, arrays.position, vo * 3)) for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(it.matrix); arrays.position.set([v.x, v.y, v.z], (vo + i) * 3); }
    if (!transformNormals(normal, nrm, arrays.normal, vo * 3)) for (let i = 0; i < n; i++) { v.fromBufferAttribute(normal, i).applyMatrix3(nrm).normalize(); arrays.normal.set([v.x, v.y, v.z], (vo + i) * 3); }
    if (bucket.plain) {
      const base = (it.mat as THREE.MeshStandardMaterial).color, vc = (it.mat as THREE.MeshStandardMaterial).vertexColors ? g.attributes.color : undefined;
      if (!bakeColors(base, vc, n, arrays.color, vo)) for (let i = 0; i < n; i++) {
        col.copy(base); if (vc) { col.r *= vc.getX(i); col.g *= vc.getY(i); col.b *= vc.getZ(i); }
        arrays.color.set([col.r, col.g, col.b], (vo + i) * 3);
      }
    } else {
      for (const nm of names) {
        if (nm === 'position' || nm === 'normal') continue;
        const a = g.attributes[nm], s = sizes[nm], dst = arrays[nm];
        if (!copyComponents(a, s, dst, vo)) for (let i = 0; i < n; i++) { const o = (vo + i) * s; dst[o] = a.getX(i); if (s > 1) dst[o + 1] = a.getY(i); if (s > 2) dst[o + 2] = a.getZ(i); if (s > 3) dst[o + 3] = a.getW(i); }
      }
    }
    const { start, count } = tris[k], idx = g.index, ia = idx && !(idx as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !idx.normalized ? idx.array : null;
    if (ia) for (let t = 0; t < count; t += 3) {
      const a = ia[start + t], b = ia[start + t + 1], c = ia[start + t + 2];
      index[io++] = vo + a; index[io++] = vo + (flip ? c : b); index[io++] = vo + (flip ? b : c);
    } else for (let t = 0; t < count; t += 3) {
      const a = idx ? idx.getX(start + t) : start + t, b = idx ? idx.getX(start + t + 1) : start + t + 1, c = idx ? idx.getX(start + t + 2) : start + t + 2;
      index[io++] = vo + a; index[io++] = vo + (flip ? c : b); index[io++] = vo + (flip ? b : c);
    }
    vo += n;
  });
  const geo = new THREE.BufferGeometry();
  for (const nm of names) geo.setAttribute(nm, new THREE.BufferAttribute(arrays[nm], sizes[nm]));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if (!computeBounds(geo)) { geo.computeBoundingBox(); geo.computeBoundingSphere(); }
  const mat = bucket.plain ? mergedMaterial(bucket.mat as THREE.MeshStandardMaterial) : bucket.mat;
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'merged'; mesh.castShadow = true; mesh.receiveShadow = true;
  return [mesh];
}
