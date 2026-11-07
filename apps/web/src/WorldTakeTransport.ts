import {hydrateTakeBoundaryWireV1,TAKE_BOUNDARY_WIRE_V1} from '@souls/protocol';
import {validChunks,MAX_PAST_CHUNKS} from './WorldGeometry.ts';
/** Opt-in HTTP history uses the same synchronous, lossless decoder as the live connection.
 * Old raw replies are unchanged; a malformed envelope throws before existing replay can observe a ref. */
export function historyTakePath(from:number,to:number,limit:number){return `/v1/takes?from=${Math.floor(from)}&to=${Math.ceil(to)}&limit=${Math.min(MAX_PAST_CHUNKS,limit)}&takeTransport=${encodeURIComponent(TAKE_BOUNDARY_WIRE_V1)}`;}
export function historyTakePage(raw:unknown){
 const body=hydrateTakeBoundaryWireV1(raw) as {chunks?:unknown;next?:unknown};
 return{chunks:validChunks(body.chunks),next:body.next};
}
