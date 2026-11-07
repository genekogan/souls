import test from 'node:test';import assert from 'node:assert/strict';
import {intentAdapter} from './intent-adapter.ts';import {intentResponse,intentLookupResponse} from './intent-response.ts';
import {intentRequestV2Schema} from '@souls/protocol';
test('private membership authority keeps recorded owner separate and refuses foreign current-account projections',()=>{
 const scope={worldId:'w',soulId:'s_old',ownerId:'did:privy:current'},control={worldId:'w',soulId:'s_old',ownerId:'dev:recorded',accountOwnerId:scope.ownerId,intentContract:'soul-intent/2'};
 assert.equal(intentAdapter(200,{status:{},control},scope,false).kind,'candidate');assert.equal(intentAdapter(200,{status:{},control:{...control,accountOwnerId:'did:privy:other'}},scope,false).kind,'unavailable');assert.equal(intentAdapter(200,{status:{},control:{...control,accountOwnerId:undefined}},scope,false).kind,'unavailable');
 const request=intentRequestV2Schema.parse({contract:'soul-intent/2',requestId:'request-one',op:'upsert',words:'rest'}),source={kind:'owner',channel:'web',ownerId:'dev:recorded',principalId:scope.ownerId};
 const receipt={contract:'soul-intent/2',requestId:request.requestId,phase:'refused',code:'state-blocked.fixture',reason:'Fixture refusal',scope:{worldId:'w',soulId:'s_old',entityId:'h_old',source}};
 const caller={worldId:'w',soulId:'s_old',ownerId:source.ownerId,principalId:scope.ownerId,entityId:'h_old',request};assert.equal(intentResponse(200,receipt,caller).kind,'recorded');assert.equal(intentLookupResponse(200,receipt,{...caller,requestId:request.requestId}).kind,'recorded');assert.equal(intentResponse(200,receipt,{...caller,principalId:'did:privy:other'}).kind,'unconfirmed');assert.equal(intentResponse(200,receipt,{...caller,ownerId:'dev:other'}).kind,'unconfirmed');assert.equal(receipt.scope.source.ownerId,'dev:recorded');
});
