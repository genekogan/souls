import { setImmediate } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { Db } from '../src/db.ts';
import { WorldHost } from '../src/world.ts';
import { LifecycleJournal } from '../src/lifecycle-journal.ts';
import { LifecycleRunner } from '../src/lifecycle-runner.ts';
export const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true}),seed='native-durable-lifecycle',worldId='candidate-native';
export const scope={worldId,soulId:'s_A',entityId:'h_A',owner:'owner'},requestId='lc_'+'a'.repeat(32),retireId='lc_'+'b'.repeat(32);
export const input={name:'Alice',description:'native local fixture',native:false};
export function fixture(path=':memory:',f=factory){
  const db=new Db(path);db.upsertUser({id:'owner',email:null,wallet:null,role:'user'});db.setInvited('owner','local-admin');
  const host=new WorldHost(db,f,seed,1e9,worldId);host.boot();host.drainInputs();
  const journal=new LifecycleJournal(db),runner=new LifecycleRunner(host,journal,op=>!!db.user(op.scope.owner)?.invited_by);
  return {db,host,journal,runner};
}
export async function settle(f:ReturnType<typeof fixture>,rounds=5){
  for(let i=0;i<rounds;i++){f.runner.pump();f.host.drainInputs();await setImmediate();}
}
