// Shared by fixture authoring and the runner. Only semantic blocks and human batch labels are omitted.
// Physical ops retain order, parameters, parentage and poses. Failed/different fixture files cannot spend inference.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './hash.mjs';
import {assertDestinationBindings} from './destination-choice.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export function physicalGenesisSha256(genesis) {
  const physical = structuredClone(genesis);
  if (physical.state) delete physical.state.about;
  const ops = (physical.batches ?? []).flatMap(batch => batch.ops ?? []).flatMap(op => {
    delete op.about;
    if (op.op === 'world' && op.state) { delete op.state.about; if (!Object.keys(op.state).length) return []; }
    if (op.op === 'set' && Object.keys(op).every(k => ['op','id'].includes(k))) return [];
    return [op];
  });
  return sha256(JSON.stringify(canonical({schema:physical.schema,constants:physical.constants,state:physical.state,ops})));
}
export function assertFrozenGenesis(scenario, serverRoot) {
  if (!scenario.freeze) return null;
  if (!scenario.world?.genesis) throw Error('frozen measurement requires an explicit genesis file');
  const path = resolve(serverRoot,scenario.world.genesis);
  const actual = physicalGenesisSha256(JSON.parse(readFileSync(path,'utf8')));
  if (actual !== scenario.freeze.physicalSha256) throw Error(`frozen physical fixture mismatch: ${path}; expected ${scenario.freeze.physicalSha256}, got ${actual}`);
  if (scenario.world.snapshot) {
    const snapshotPath=resolve(serverRoot,scenario.world.snapshot), bytes=readFileSync(snapshotPath);
    const snapshot=JSON.parse(bytes), physical=physicalSnapshotSha256(snapshot);
    if (sha256(bytes)!==scenario.freeze.snapshotSha256 || physical!==scenario.freeze.physicalSnapshotSha256) throw Error(`frozen snapshot fixture mismatch: ${snapshotPath}`);
    assertDestinationBindings(scenario,snapshot);
    return {path,physicalSha256:actual,snapshotPath,snapshotSha256:sha256(bytes),physicalSnapshotSha256:physical};
  }
  if(scenario.director?.script?.some(e=>e.expect?.journey?.firstDestinationChoices?.length)){
    const sources=scenario.freeze.destinationSources;
    if(!sources?.control||!sources?.treatment)throw Error('first destination credit requires both frozen materialization proofs');
    for(const source of Object.values(sources)){const bytes=readFileSync(resolve(serverRoot,source.path));if(sha256(bytes)!==source.sha256)throw Error('frozen destination materialization proof changed');assertDestinationBindings(scenario,JSON.parse(bytes));}
  }
  return {path,physicalSha256:actual};
}

/** Only compiler model fields enter an isolated seed DB. Public transport metadata is not state. */
export function compilerSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.entities) || !Array.isArray(snapshot.defs) || !snapshot.ground || !snapshot.constants || typeof snapshot.seed !== 'string') throw Error('invalid compiler snapshot fixture');
  if (snapshot.entities.some(e=>typeof e.id!=='string'||e.id.startsWith('h_')||/humanoid|soul-body/.test(e.def??''))) throw Error('snapshot fixture must contain no Soul bodies');
  if (snapshot.state?.layers?.wallets && Object.keys(snapshot.state.layers.wallets).length) throw Error('snapshot fixture must contain no private layer wallets');
  const seq=snapshot.contract==='world/1'?snapshot.counter:snapshot.seq;
  if (!Number.isSafeInteger(seq)||seq<0) throw Error('snapshot fixture has invalid entity counter');
  return structuredClone({constants:snapshot.constants,state:snapshot.state,seed:snapshot.seed,seq,editSeq:0,defs:snapshot.defs,defRefs:snapshot.defRefs,entities:snapshot.entities,ground:snapshot.ground});
}
/**
 * physicalSnapshotSha256 for comparing a seeded fixture with the world it booted (arena/provision.mjs): Soul-body defs
 * (humanoid, soul-body) that no entity uses are left out on both sides, because boot drops such a def (#883). Every
 * other def, entity, ground and state difference still counts. Frozen pins keep physicalSnapshotSha256.
 */
export function bootPhysicalSha256(snapshot) {
  const s = structuredClone(snapshot), used = new Set((s.entities ?? []).map(e => e.def).filter(Boolean));
  const alias = r => [r, r.startsWith('core-') ? 'core/' + r.slice(5) : r.startsWith('core/') ? 'core-' + r.slice(5) : r];
  const unusedSoul = r => SOUL_DEF.test(r) && !alias(r).some(x => used.has(x));
  if (Array.isArray(s.defs)) s.defs = s.defs.filter(d => !unusedSoul(String(d.ref ?? '')));
  if (s.defRefs) s.defRefs = Object.fromEntries(Object.entries(s.defRefs).filter(([r]) => !unusedSoul(r)));
  return physicalSnapshotSha256(s);
}
const SOUL_DEF = /humanoid|soul-body/;
export function physicalSnapshotSha256(snapshot) {
  const s=compilerSnapshot(snapshot); delete s.seq;delete s.editSeq;delete s.seed;
  if(!s.defRefs){s.defRefs={};for(const d of s.defs){s.defRefs[d.ref]=d.hash;if(d.ref.startsWith('core-'))s.defRefs['core/'+d.ref.slice(5)]=d.hash;}}
  if(s.state)delete s.state.about;
  s.entities=s.entities.map(e=>{for(const k of ['about','by','born','v'])delete e[k];return e;}).sort((a,b)=>a.id.localeCompare(b.id));
  s.defs=s.defs.map(d=>{delete d.by;return d;}).sort((a,b)=>a.hash.localeCompare(b.hash));
  return sha256(JSON.stringify(canonical(s)));
}
