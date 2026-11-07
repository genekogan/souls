// Compile-time geometry supplements for shipped mesh assets. Content-addressed
// inputs cover pinned live defs as well as freshly placed catalogue revisions.
// Authored surfaces always win at their height; unsupported roofs/tables do not
// become floors just because the mesh has upward-facing triangles.
import type {Surface, Link} from '@souls/generators';
import packed from './mesh-floor-runtime.json' with {type: 'json'};
type Entry = [number, number, number[], number[]];
const records = packed.assets as unknown as {[hash: string]: Entry};
const surfaces: Surface[] = packed.surfaces.map(([level,y,x0,z0,x1,z1,tag]) => {
  const [prefix,...suffix]=String(tag).split(':');
  return {level:Number(level),y:Number(y),polygon:[[Number(x0),Number(z0)],[Number(x1),Number(z0)],[Number(x1),Number(z1)],[Number(x0),Number(z1)]],tag:`${packed.tags[Number(prefix)]}:${suffix.join(':')}`};
});
const links: Link[] = packed.links.map(([id,from,to,x0,z0,x1,z1,width,y0,y1]) => ({id:String(id),kind:'stairs',from:Number(from),to:Number(to),path:[[Number(x0),Number(z0)],[Number(x1),Number(z1)]],width:Number(width),y0:Number(y0),y1:Number(y1)}));
export function meshFloors(asset: string, box: readonly number[], authored: readonly Surface[] = []): Surface[] {
  const entry = records[asset];
  // The viewer fits uniformly on the mesh's largest axis. Other box dimensions
  // can differ on older pinned definitions without changing that rendered fit.
  if (!entry || Math.abs(box[entry[0]] - entry[1]) > .002) return [];
  return entry[2].map(i => surfaces[i]).filter(s => !authored.some(a => Math.abs(a.y - s.y) < .02)).map(s => ({...s, polygon: s.polygon.map(p => [...p] as [number, number])}));
}

export function meshFloorLinks(asset: string, box: readonly number[], authored: readonly Link[] = []): Link[] {
  const entry = records[asset];
  if (!entry || Math.abs(box[entry[0]] - entry[1]) > .002 || authored.length) return [];
  return entry[3].map(i => links[i]).map(l => ({...l, path: l.path.map(p => [...p] as [number, number])}));
}
