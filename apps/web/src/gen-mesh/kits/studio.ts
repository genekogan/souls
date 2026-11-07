// The gallery studio (L4): renders library defs with the real mesh halves (kit/2, creature rigs and
// gaits, any registered builder) into one contact sheet — one WebGL canvas, one viewport per def,
// no world, no terrain — so the sheet is cheap to photograph even on a loaded machine.
// Bundled by tools/god-skill/scripts/gallery.mjs (esbuild) together with every *.mesh.ts.
import * as THREE from 'three';
import { GENERATORS, type Value } from '@souls/generators';
import { WorldModel, type StoredDef } from '@souls/world-compiler';
import { meshFor, type MeshCtx } from '../registry.ts';
import { MaterialLib } from '../materials.ts';
import { gait, type Rig } from '../motion.ts';

type Cell = { def: StoredDef; label: string; sub: string; walk?: boolean; phase?: number };
declare global { interface Window { studio: { render(defs: StoredDef[], o?: { cols?: number; cw?: number; ch?: number; walk?: boolean; frames?: number }): Promise<{ cells: number; tris: number[]; errors: string[] }> } } }

export function ctxFor(def: StoredDef, model: WorldModel, lib: MaterialLib): MeshCtx {
  const gen = def.make.kind === 'gen' ? GENERATORS[def.make.gen] : undefined;
  const params: Record<string, Value> = {};
  for (const [k, f] of Object.entries({ ...(gen?.params ?? {}), ...def.params })) if ((f as { default?: Value }).default !== undefined) params[k] = (f as { default: Value }).default;
  if (def.tags.includes('creature')) params.behavior = 'idle';
  const entity = { id: 'e_studio' + def.name.length, def: def.ref, in: { parent: 'world' }, p: [0, 0], by: 'studio', born: 0, v: 1, seed: 7, params } as never;
  return {
    def, entity, params, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {},
    baked: model.bake(def, params, 7), model, materials: lib,
    tint: (key, fallback) => { if (!key) return fallback; const v = params[key]; return typeof v === 'string' && /^#/.test(v) ? v : def.palette?.[key] ?? fallback; },
  };
}

window.studio = {
  async render(defs, o = {}) {
    const cols = o.cols ?? 8, cw = o.cw ?? 220, ch = o.ch ?? 180, labelH = 30;
    const cells: Cell[] = [];
    for (const d of defs) {
      cells.push({ def: d, label: d.name.replace(/^core-/, ''), sub: d.tags.slice(0, 3).join(' · ') });
      const gaitName = String((d.make as { args?: { gait?: string } }).args?.gait ?? '');
      if (o.frames && d.tags.includes('creature')) for (let k = 0; k < o.frames; k++) cells.push({ def: d, label: `${d.name.replace(/^core-/, '')} ${k + 1}/${o.frames}`, sub: gaitName, walk: true, phase: k / o.frames });
      else if (o.walk && d.tags.includes('creature')) cells.push({ def: d, label: d.name.replace(/^core-/, '') + ' (stride)', sub: gaitName, walk: true, phase: 0.25 });
    }
    const rows = Math.ceil(cells.length / cols), W = cols * cw, H = rows * (ch + labelH);
    const root = document.getElementById('sheet')!; root.style.width = W + 'px'; root.style.height = H + 'px';
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`; root.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setScissorTest(true); renderer.setClearColor('#efe9dc');
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const model = new WorldModel({ constants: { ground: 'land', extent: 400 }, seed: 'studio' });
    const lib = new MaterialLib();
    const tris: number[] = [], errors: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], col = i % cols, row = Math.floor(i / cols);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#fffaf0', '#8c8270', 1.6));
      const sun = new THREE.DirectionalLight('#fff3e0', 2.4); sun.castShadow = true; sun.shadow.mapSize.set(512, 512); scene.add(sun, sun.target);
      let obj: THREE.Object3D | null = null;
      try { const b = meshFor(c.def); obj = b ? b.build(ctxFor(c.def, model, lib)) : null; } catch (e) { errors.push(`${c.def.name}: ${String(e)}`); }
      const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.style.cssText = `left:${col * cw}px;top:${row * (ch + labelH) + ch}px;width:${cw}px;height:${labelH}px`;
      lbl.innerHTML = `<b>${c.label}</b><i>${c.sub}</i>`; root.appendChild(lbl);
      if (!obj) { errors.push(`${c.def.name}: no mesh`); continue; }
      const yaw0 = c.def.tags.includes('creature') ? 1.05 : 0.5; obj.rotation.y = yaw0;
      const rig = (obj.userData as { rig?: Rig }).rig;
      if (rig) gait(obj, rig, { x: 0, z: 0, yaw: yaw0, speed: c.walk ? rig.speed : 0, dist: c.walk ? Math.max(0.1, 4 * rig.hip * Math.sin(rig.gait === 'quadruped-walk' ? (rig.hip > 0.6 ? 0.34 : 0.42) : 0.5)) * (c.phase ?? 0.25) : 0, rest: c.walk ? 0 : 1, activity: c.walk ? (rig.gait === 'bird-fly' ? 'fly' : 'walk') : 'look', alt: 0, u: 0.5 }, 0, 1, 0);
      obj.rotation.y = yaw0;
      scene.add(obj); obj.updateMatrixWorld(true);
      let n = 0; obj.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) { n += (mm.geometry.index ? mm.geometry.index.count : mm.geometry.attributes.position.count) / 3; mm.castShadow = true; mm.receiveShadow = true; } }); tris.push(Math.round(n));
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
      const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(size.x, size.z) * 1.6 + 0.4, 28), new THREE.MeshStandardMaterial({ color: '#d8d0bd', roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = Math.min(0, box.min.y) - 0.002; ground.receiveShadow = true; scene.add(ground);
      const span = Math.max(size.x, size.y * 1.15, size.z, 0.2), radius = size.length() / 2;
      const cam = new THREE.PerspectiveCamera(26, cw / ch, 0.01, 500);
      const dist = radius / Math.sin((26 * Math.PI) / 360) * 0.92;
      cam.position.set(centre.x + dist * 0.1, centre.y + dist * 0.3, centre.z + dist * 0.95); cam.lookAt(centre);
      sun.position.set(centre.x + span * 2, centre.y + span * 4, centre.z + span * 3); sun.target.position.copy(centre);
      const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = sc.bottom = -span * 1.5; sc.right = sc.top = span * 1.5; sc.near = 0.01; sc.far = span * 12; sc.updateProjectionMatrix();
      const y = H - (row + 1) * (ch + labelH) + labelH;
      renderer.setViewport(col * cw, y, cw, ch); renderer.setScissor(col * cw, y, cw, ch);
      renderer.render(scene, cam);
    }
    return { cells: cells.length, tris, errors };
  },
};
