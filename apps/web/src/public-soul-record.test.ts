// #1234: a record with its secret place taken out reads and renders as a record with less in it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPublicRecord} from './public-soul-record.ts';

const base={contract:'eden-edge/1',soul:{soulId:'s_a',name:'Ana'},fade:null,now:{at:3},lastAcceptedAt:1,receipts:[],events:[]};
test('no place, no receipts, a `now` with no words: read, not refused', () => {
 const r=readPublicRecord({...base,self:{state:'idle',activity:'idle',placePath:[]}});
 assert.ok(r);assert.deepEqual(r.receipts,[]);assert.deepEqual(r.self?.placePath,[]);assert.equal(r.now,null);
 assert.ok(readPublicRecord({...base,self:null}));
});
