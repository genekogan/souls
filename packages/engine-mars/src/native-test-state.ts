import assert from 'node:assert/strict';
import type {Engine} from '@souls/engine-contract';
import type {Entity as NativeEntity} from '../../../mars/viewer/engine/world/types.ts';
import {MarsEngine} from './engine.ts';

/** These tests inspect native food/hold/posture state beyond the portable engine DTO. */
export function nativeEntity(engine:Engine,id:string):NativeEntity {
 assert.ok(engine instanceof MarsEngine,'native state requires the actual Mars adapter');
 const entity=engine.world.entities[id];assert.ok(entity,'native entity must exist');
 // MarsEngine.world is the native Runtime.world exposed through the portable contract.
 return entity as NativeEntity;
}
