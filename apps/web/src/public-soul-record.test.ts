// CTX-8 (#1141): the web reads the public timeline as data: bounded, its fields checked, nothing else let through.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPublicRecord} from './public-soul-record.ts';

const base={contract:'eden-edge/1',soul:{id:'s_a',name:'Ana'},receipts:[],events:[]};
const entry={kind:'produced',when:{real:'2026-11-07T10:00:00.000Z',tick:12,worldDay:3,time:'09:15'},place:{id:'hall',name:'Main Hall'},title:'Dawn'};

test('A2: an entry reads back with both clocks, its place and title', () => {
 const r=readPublicRecord({...base,timeline:[entry]});
 assert.deepEqual(r?.timeline,[{kind:'produced',real:'2026-11-07T10:00:00.000Z',worldDay:3,time:'09:15',place:'Main Hall',title:'Dawn',world:undefined}]);
});
test('A2: nothing or nonsense is an empty story, and at most 20 are read', () => {
 assert.deepEqual(readPublicRecord(base)?.timeline,[]);
 assert.deepEqual(readPublicRecord({...base,timeline:'x'})?.timeline,[]);
 assert.deepEqual(readPublicRecord({...base,timeline:[null,{},{kind:1}]})?.timeline,[]);
 assert.equal(readPublicRecord({...base,timeline:Array.from({length:40},()=>entry)})?.timeline.length,20);
});
