// Actual native physical fixture with fake body/Soul associations. No owner DB,
// station policy, cue, route, model, browser or server bootstrap installation.
import { fileURLToPath } from 'node:url';
import { marsFactory } from '@souls/engine-mars';
export async function generateNativeGatheringObservation() {
  const factory=await marsFactory(),engine=factory.create(factory.genesis('native-gathering-public-fixture'));
  for(const id of ['a','b'])engine.spawnHuman({id,label:`Fake ${id}`,soul:`fake-soul-${id}`});
  const samples=[{phase:'idle',observation:engine.gatheringObservation!()}];
  const group=engine.submit('campfire_circle',{actors:['a','b'],fire:'fire'});
  if(group.status!=='executing')throw new Error('native gathering refused');
  samples.push({phase:'admitted',observation:engine.gatheringObservation!()});
  for(let n=0;n<1200&&group.phase!=='gathered';n++)engine.step();
  if(group.phase!=='gathered'||engine.runtime.violations.length)throw new Error('native gathering did not settle cleanly');
  const settled=engine.gatheringObservation!(),snapshot=engine.snapshot();
  samples.push({phase:'settled',observation:settled});
  const restored=factory.restore(JSON.parse(JSON.stringify(snapshot))),reconstructed=restored.gatheringObservation!();
  if(JSON.stringify(reconstructed)!==JSON.stringify(settled)||restored.stateHash()!==engine.stateHash())throw new Error('native gathering restoration differs');
  const stand=engine.submit('stand',{actor:'a'});
  for(let n=0;n<40&&stand.status!=='completed'&&stand.status!=='failed';n++)engine.step();
  if(stand.status!=='completed')throw new Error('native gathering member departure did not complete');
  samples.push({phase:'member-left',observation:engine.gatheringObservation!()});
  engine.cancel(group.id);samples.push({phase:'cancelled',observation:engine.gatheringObservation!()});
  return {contract:'native-gathering-fixture/1',stage:'candidate-observation',
    scope:'actual native physical fixture with fake bodies; no owner-admission or station proof',samples,
    reconstruction:{kind:'native-snapshot',observation:reconstructed,stateHash:snapshot.stateHash},
    unresolved:['station-policy-disposition','durable-cue-clock','anonymous-HTTP-WS','recorded-cue-lookup','two-listener-audio']};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateNativeGatheringObservation(),null,2)+'\n');
