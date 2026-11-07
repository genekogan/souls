import {decodeSnapshot,type RuntimeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {NATIVE_SLEEP_SNAPSHOT_V1} from '../../../mars/viewer/engine/activities/sleep.ts';
import type {Engine,EngineFactory,EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine} from './engine.ts';
/** Outermost reader: origin remains the actual resource/physical history reader. */
export function nativeSleepSnapshotFactoryV1(origin:EngineFactory):EngineFactory{
 const bare=(v:string)=>v.replace(/\+ss\/1$/,''),install=(e:Engine,active=false)=>{if(!(e instanceof MarsEngine))throw Error('sleep-snapshot.native-required');e.enableNativeSleepSnapshotReaderV1(active);return e;};
 return {rulesVersion:origin.rulesVersion,genesis:origin.genesis,create:w=>install(origin.create(w)),canReplayHistory:v=>origin.canReplayHistory?.(bare(v))===true,canRestoreSnapshot:v=>origin.canRestoreSnapshot?.(bare(v))===true,
  restore(raw:EngineSnapshot){const s=structuredClone(raw) as EngineSnapshot&{nativeSleepSnapshotV1?:boolean;sleepSnapshotBaseStateHash?:string};const active=s.nativeSleepSnapshotV1===true,marker=decodeSnapshot((raw as EngineSnapshot&{mars:RuntimeSnapshot}).mars).services.nativeSleepSnapshotV1;if(active?marker!==NATIVE_SLEEP_SNAPSHOT_V1:marker!==undefined)throw Error('sleep-snapshot.runtime-policy-invalid');if(s.nativeSleepSnapshotV1!==undefined&&!active||active&&!/^[a-f0-9]{64}$/.test(s.sleepSnapshotBaseStateHash??'')||!active&&s.sleepSnapshotBaseStateHash!==undefined)throw Error('sleep-snapshot.policy-invalid');if(active)s.stateHash=s.sleepSnapshotBaseStateHash!;delete s.nativeSleepSnapshotV1;delete s.sleepSnapshotBaseStateHash;const e=install(origin.restore(s),active);if(e.stateHash()!==raw.stateHash)throw Error('sleep-snapshot.state');return e;},
  validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||origin.canReplayHistory?.(bare(recorded))!==true)throw Error('sleep-snapshot.history-head');},
 };
}
