// Persist an explicitly frozen compiler snapshot before boot using the normal world store.
// Never copy a production DB, accounts, credentials or Souls, and never repair a running world.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Db } from '../../../apps/server/src/db.ts';
import { WorldStore } from '../../../apps/server/src/god/store.ts';
import { WorldModel } from '../../../packages/world-compiler/src/model.ts';
import { bootPhysicalSha256, compilerSnapshot, physicalSnapshotSha256 } from '../lib/physical-fixture.mjs';
import { sha256 } from '../lib/hash.mjs';

export async function seedSnapshot({ snapshotPath, dataDir, worldId }) {
  const path=resolve(snapshotPath), bytes=readFileSync(path), source=JSON.parse(bytes);
  const snapshot=compilerSnapshot(source), dbPath=join(dataDir,'sim.db');
  if(existsSync(dbPath))throw Error('snapshot seed refuses an existing database');
  const model=WorldModel.fromSnapshot(snapshot), db=new Db(dbPath);
  try {
    const store=new WorldStore(db,worldId);
    store.init(model,null);model.editSeq=1;
    const result=store.commit(model,null,{defs:[],upserts:[...model.entities.values()],removes:[],answers:[],tiles:[]},
      {seq:1,by:'fixture',at:0,note:`Frozen isolated playtest snapshot ${sha256(bytes)}`,ops:[],inverse:[],kind:'engine'});
    if(result)throw Error(`snapshot seed refused: ${JSON.stringify(result)}`);
    if(physicalSnapshotSha256(store.load().model.snapshot())!==physicalSnapshotSha256(source))throw Error('snapshot seed round-trip changed physical state');
    return {path,snapshotSha256:sha256(bytes),physicalSnapshotSha256:physicalSnapshotSha256(source),bootPhysicalSha256:bootPhysicalSha256(source),entities:model.entities.size,worldId,method:'WorldModel.fromSnapshot + WorldStore.init/commit before boot; owner null; no account/Soul/token rows copied'};
  } finally {db.db.close();}
}
