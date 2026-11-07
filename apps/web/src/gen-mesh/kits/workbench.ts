// W1: one scene, four orthographic views, no world connection or writes.
import * as THREE from 'three';
import '../index.ts';
import { WorldModel, type StoredDef } from '@souls/world-compiler';
import { MaterialLib } from '../materials.ts';
import { meshFor } from '../registry.ts';
import { ctxFor } from './studio.ts';
import { whenAssetsSettled, assetFailed } from '../gltf-assets.ts';
import { tiltedColliderWarning } from './workbench-data.ts';

type Payload = { def: StoredDef; beside?: StoredDef; defs: StoredDef[]; warnings?: string[]; hour?: string; width?: number; height?: number };
declare global { interface Window { workbench: { render(p: Payload): Promise<{ data: string; warnings: string[]; views: string[]; colliders: number; seats: number }> } } }

window.workbench = { async render(p) {
  const cw = p.width ?? 640, ch = p.height ?? 420, labelH = 36, headerH = 90;
  const W = cw * 2, H = headerH + (ch + labelH) * 2 + 72;
  document.getElementById('intro')?.remove(); document.querySelectorAll('canvas').forEach(c => c.remove());
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#e8e4da'); renderer.setScissorTest(true);
  const model = new WorldModel({ constants: { ground: 'land', extent: 400 }, seed: 'kit-workbench' });
  for (const d of p.defs) { model.defs.set(d.ref, d); model.defs.set('sha:' + d.hash, d); }
  const lib = new MaterialLib(), scene = new THREE.Scene(), subjects = new THREE.Group(); scene.add(subjects);
  const hour = p.hour ? Number(p.hour.split(':')[0]) + Number(p.hour.split(':')[1] ?? 0) / 60 : 12;
  const day = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  scene.add(new THREE.HemisphereLight(day > 0 ? '#fff7e5' : '#90a0cf', '#7b776d', .35 + 1.1 * day));
  const sun = new THREE.DirectionalLight(day > 0 ? '#fff0d5' : '#93a6dc', .2 + 2.1 * day); sun.position.set(8, 12, 6); scene.add(sun);
  let colliders = 0, seats = 0;
  const contexts: ReturnType<typeof ctxFor>[] = [];
  const add = (def: StoredDef, x: number, diagnostics: boolean) => {
    const ctx = ctxFor(def, model, lib), builder = meshFor(def);
    if (!builder) throw Error(`No studio mesh for ${def.ref}`);
    const obj = builder.build(ctx); if (!obj) throw Error(`No studio object for ${def.ref}`);
    obj.position.x = x; subjects.add(obj); contexts.push(ctx);
    if (diagnostics) {
      for (const c of ctx.baked.colliders) {
        const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(c.half[0] * 2, Math.max(.005, c.y1 - c.y0), c.half[1] * 2));
        const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#087c9a', depthTest: false, transparent: true, opacity: .75 }));
        line.position.set(x + c.c[0], (c.y0 + c.y1) / 2, c.c[1]); line.rotation.y = c.yaw; line.renderOrder = 10; subjects.add(line); colliders++;
      }
      for (const slot of ctx.baked.slots.filter(s => s.kind === 'seat')) {
        const marker = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .025, 5, 20), new THREE.MeshBasicMaterial({ color: '#b72983', depthTest: false }));
        ring.rotation.x = Math.PI / 2; marker.add(ring);
        marker.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), .5, '#b72983', .16, .1));
        marker.position.set(x + slot.p[0], slot.p[1] + .025, slot.p[2]); marker.rotation.y = slot.yaw; marker.renderOrder = 11; subjects.add(marker); seats++;
      }
    }
    const light = def.components.light;
    if (light?.on && day < .5) {
      const point = new THREE.PointLight(light.color ?? '#ffc97b', 2, light.range ?? 8, 2);
      point.position.set(x, ctx.baked.box[1] * .7, 0); scene.add(point);
    }
  };
  try {
    add(p.def, 0, true); await whenAssetsSettled();
    let bounds = new THREE.Box3().setFromObject(subjects), size = bounds.getSize(new THREE.Vector3());
    if (p.beside) {
      const offset = bounds.min.x - p.beside.size.box[0] / 2 - Math.max(.8, size.x * .12);
      add(p.beside, offset, false); await whenAssetsSettled(); bounds = new THREE.Box3().setFromObject(subjects);
    }
    for (const d of [p.def, p.beside]) if (d?.make.kind === 'mesh' && assetFailed(d.make.asset)) throw Error(`Studio asset unavailable for ${d.ref}`);
    // 1.8 m human scale figure: head + torso + arms + legs, grounded at y=0.
    const figure = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: '#59684f', roughness: 1 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 7), mat); head.position.y = 1.68; figure.add(head);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.15, .36, 3, 8), mat); torso.position.y = 1.22; figure.add(torso);
    for (const sign of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .65, 3, 7), mat); leg.position.set(sign * .09, .395, 0); figure.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.045, .46, 3, 7), mat); arm.position.set(sign * .24, 1.16, 0); arm.rotation.z = sign * .12; figure.add(arm);
    }
    figure.position.x = bounds.max.x + Math.max(.6, size.x * .08); subjects.add(figure);
    bounds = new THREE.Box3().setFromObject(subjects); size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3()), span = Math.max(size.x, size.y, size.z, 2);
    const grid = new THREE.GridHelper(span * 3, 30, '#b7b1a3', '#d3cec2'); grid.position.y = -.015; scene.add(grid);
    scene.add(new THREE.AxesHelper(Math.max(.6, Math.min(span / 3, 3))));
    const warnings = [...(p.warnings ?? []), ...tiltedColliderWarning(p.def, contexts[0].params)];
    const views = [{ label: 'Front · +Z', dir: [0, 0, 1] }, { label: 'Side · +X', dir: [1, 0, 0] }, { label: 'Top · +Y', dir: [0, 1, .0001] }, { label: '¾ · +X +Z', dir: [1, .7, 1] }];
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z).sub(centre));
    for (const [i, view] of views.entries()) {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, span * 8 + 100);
      camera.position.copy(centre).add(new THREE.Vector3(...view.dir as [number, number, number]).normalize().multiplyScalar(span * 3 + 10));
      if (i === 2) camera.up.set(0, 0, -1); camera.lookAt(centre); camera.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const halfY = Math.max(.5, ...corners.map(c => Math.abs(c.dot(up))), ...corners.map(c => Math.abs(c.dot(right)) / (cw / ch))) * 1.18;
      camera.left = -halfY * cw / ch; camera.right = halfY * cw / ch; camera.top = halfY; camera.bottom = -halfY; camera.updateProjectionMatrix();
      const x = (i % 2) * cw, y = H - headerH - Math.floor(i / 2) * (ch + labelH) - ch;
      renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch); renderer.render(scene, camera);
    }
    const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
    const ctx = sheet.getContext('2d')!; ctx.fillStyle = '#f3efe5'; ctx.fillRect(0, 0, W, H); ctx.drawImage(canvas, 0, 0);
    const text = (t: string, x: number, y: number, font = '16px system-ui', color = '#302e2a') => { ctx.font = font; ctx.fillStyle = color; ctx.fillText(t, x, y, W - x - 20); };
    ctx.fillStyle = '#f3efe5'; ctx.fillRect(0, 0, W, headerH); ctx.fillRect(0, H - 72, W, 72);
    text(p.def.name, 20, 32, '600 24px system-ui');
    text(`Kit workbench · ${contexts[0].baked.box.map(n => n.toFixed(2)).join(' × ')} m · ${p.hour ?? '12:00'}${p.beside ? ` · beside ${p.beside.ref}` : ''}`, 20, 58);
    text('Cyan: collider wireframes   Magenta: seat slots   Figure: 1.8 m   Axes: X red · Y green · Z blue', 20, 80, '13px system-ui');
    for (const [i, view] of views.entries()) {
      const x = i % 2 * cw, y = headerH + Math.floor(i / 2) * (ch + labelH) + ch;
      ctx.fillStyle = '#f3efe5'; ctx.fillRect(x, y, cw, labelH); text(view.label, x + 14, y + 25, '600 17px system-ui');
    }
    text(`${colliders} colliders · ${seats} seat slots · world unchanged`, 20, H - 44);
    text(warnings.join(' · ') || 'Dry-run admitted. No trial entity or definition was added to the world.', 20, H - 18, '14px system-ui', warnings.length ? '#9d4b0b' : '#5c6152');
    canvas.replaceWith(sheet);
    return { data: sheet.toDataURL('image/png'), warnings, views: views.map(v => v.label), colliders, seats };
  } finally { renderer.dispose(); }
} };
