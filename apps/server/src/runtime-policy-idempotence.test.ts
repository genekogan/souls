import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';
import {Db} from './db.ts';import {WorldHost} from './world.ts';import {marsFactory,GREEN_FIELD_WORLD} from '@souls/engine-mars';
// The release gate compares tests by title: this keeps the 403 title, now also covering the occupied-link routing and
// concurrent link egress policies (continuity, 3f99ee356 / a126b2101) and a restart from the pre-activation snapshot.
test('prospective courtesy/fixture/rest policies preserve exact head/hash after snapshot and genesis restart',async()=>{
 const db=new Db(':memory:'),factory=await marsFactory(GREEN_FIELD_WORLD),hosts:WorldHost[]=[];
 async function install(host:WorldHost){for(const work of [()=>host.enableQuietLandingCourtesyV1(),()=>host.enableGroundFixtureGoalsV1(),()=>host.enableHumanRestNeedsV1(),()=>host.enableOccupiedLinkRoutingV1(),()=>host.enableConcurrentLinkEgressV1()]){const p=work();host.drainInputs();await p;await setImmediate();}}
 try{let host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);host.boot();host.saveSnapshot(true);await install(host);
  const expected={tick:host.engine.world.tick,head:host.seq,hash:host.engine.stateHash()};await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);
  host.stop();host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);assert.equal(host.boot().from,'snapshot');assert.equal(host.engine.stateHash(),expected.hash,'pre-activation snapshot replays the logged policy tail');await install(host);assert.equal(host.seq,expected.head);
  host.saveSnapshot(true);host.stop();host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);assert.equal(host.boot().from,'snapshot');await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);
  db.db.exec('DELETE FROM snapshots');host.stop();host=new WorldHost(db,factory,'policy-idempotence',1e9,'fixture-policy-world');hosts.push(host);assert.equal(host.boot().from,'genesis');await install(host);assert.equal(host.seq,expected.head);assert.equal(host.engine.stateHash(),expected.hash);assert.equal(host.engine.world.tick,expected.tick);
 }finally{for(const host of hosts)host.stop();db.close();}
});
