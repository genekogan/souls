// The hello a Connection sends (lane W1): one definition for packages/client and for the web page's entry script, which
// opens the world's socket at page entry with the anonymous form (apps/web/src/snapshot-prefetch.ts). Key order matters:
// the page adopts its entry socket only when this exact string is what the Connection would have sent.
import { COLUMNS_V1, PROTO, TAKE_BOUNDARY_WIRE_V1, TAKE_ENTITIES_WIRE_V1, TAKE_ENTITIES_JOIN_V1, TAKE_CHUNKS_WIRE_V1, type ClientMsg, type StationLiveContract } from '@souls/protocol';

export function helloMessage(o: { token?: string | null; since?: number; epoch?: string | null; stationContracts?: readonly StationLiveContract[]; takeBoundaryTransport?: boolean }): ClientMsg {
  return { t: 'hello', proto: PROTO, ...(o.token ? { token: o.token } : {}), ...(o.since !== undefined && o.epoch ? { since: o.since, epoch: o.epoch } : {}),
    ...(o.stationContracts ? { stationContracts: o.stationContracts.slice() } : {}),
    ...(o.takeBoundaryTransport ? { takeTransport: TAKE_BOUNDARY_WIRE_V1, takeEntities: TAKE_ENTITIES_WIRE_V1, takeChunks: TAKE_CHUNKS_WIRE_V1, takeEntitiesJoin: TAKE_ENTITIES_JOIN_V1, snapshotColumns: COLUMNS_V1 } : {}) } as ClientMsg;
}

/** The serialised hello of a signed-out viewer with no replica yet and no station offer. */
export const anonymousHello = (takeBoundaryTransport: boolean) => JSON.stringify(helloMessage({ takeBoundaryTransport }));
