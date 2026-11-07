import type {EdgeLedger} from '../ledger/ledger.ts';
import {hashOf} from '@souls/engine-contract';
import {parsePlatformFloors,platformFloorOffset} from '../../../../../mars/viewer/lib/platform-floor.ts';

/** Current live declaration; recorded takes consume their own immutable scene capture instead. */
export function livePlatforms(ledger:EdgeLedger){
 // a read worker (split/read-host.ts): main's answer as its pump shipped it; null = main has no render fact
 const shipped=(ledger.host as any).livePlatformsV1?.();
 if(shipped)return shipped;
 if(shipped===null)return {platforms:parsePlatformFloors(ledger.spots.platforms),source:'current-live-activities' as const,active:true};
 const meta=ledger.host.engine.renderPlatformsV1?.(),world=ledger.host.engine.world;
 if(meta){const active=meta.navHash===hashOf((world as any).navV1??null)&&meta.baseStaticHash===world.base.staticHash;return {platforms:active?meta.platforms:[],provenance:meta,source:'accepted-render-fact' as const,active};}
 return {platforms:parsePlatformFloors(ledger.spots.platforms),source:'current-live-activities' as const,active:true};
}
export function visualFloorOffset(ledger:EdgeLedger,body:{pose:{p:number[];yaw?:number};human?:Record<string,any>}){
 const h=body.human;if(!h||(h.level??0)!==0||h.on||h.riding||h.carrier||h.grip||h.hands?.left||h.hands?.right||h.boatPassenger||h.boatTransit||h.shore||/boat|ride|drive|board|disembark/.test(String(h.activity??'')))return 0;
 const [x,y,z]=body.pose.p;return platformFloorOffset(livePlatforms(ledger).platforms,x,z,y);
}
