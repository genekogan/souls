// W1 scenery places flagged `starting` (e.g. region-*) are never a reclaim landing spot; only admitted native ground is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {derivePlaceData} from './edge/ledger/places.ts';
test('reclaim landing ignores starting places that are not native ground',{timeout:120000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const data=derivePlaceData(f.host.engine.world as NativeWorld) as any,root=data.places[0];
 root.polygon=[[-900,-900],[900,-900],[900,900],[-900,900]];
 data.places[1].starting=true;
 data.places.push({id:'region-harbour',name:'Harbour',kind:'outdoor',parent:root.id,polygon:[[800,800],[850,800],[850,850],[800,850]],level:0,enclosed:false,capacity:null,starting:true});
 const ledger=new EdgeLedger(f.host,f.db,data) as any;
 for(let i=0;i<40;i++){const [x]=ledger.startingPoint('soul-'+i);assert.ok(x<700,'landed in scenery for soul-'+i);}
});
