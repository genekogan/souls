import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PublicSoul} from '@souls/protocol';
import {exploreSoulRoster} from '../src/explore-data.ts';
const soul=(id:string,name:string):PublicSoul=>({id,name,entityId:'h_'+id,description:'public profile',owner:'fixture',intent:null,intentText:'',mood:'',energy:'',doing:'',native:true});
void test('empty camera room retains the actual known world roster and global name search',()=>{
 const souls=new Map([['gene',soul('gene','Gene')],['drake',soul('drake','Drake Mallard')]]),presence=new Map();
 assert.deepEqual(exploreSoulRoster(souls,presence,'',{soulIds:[]}).souls.map(s=>s.name),['Drake Mallard','Gene']);
 assert.deepEqual(exploreSoulRoster(souls,presence,'Gene',{soulIds:[]}).souls.map(s=>s.name),['Gene']);assert.equal(exploreSoulRoster(souls,presence,'',{soulIds:[]}).inRoom.size,0);
});
void test('room membership annotates global presence ordering without fabricating unknown rows or changing scope with a query',()=>{
 const souls=new Map([['a',soul('a','Active elsewhere')],['b',soul('b','Unknown here')],['c',soul('c','Away elsewhere')]]),presence=new Map([['a','active' as const],['c','departed' as const]]),room={soulIds:['b','not-in-replica']};
 const all=exploreSoulRoster(souls,presence,'',room);assert.deepEqual(all.souls.map(s=>s.id),['a','b','c']);assert.deepEqual([...all.inRoom],['b']);
 const query=exploreSoulRoster(souls,presence,'Active',room);assert.deepEqual(query.souls.map(s=>s.id),['a']);assert.deepEqual([...query.inRoom],['b']);assert.equal(presence.has('b'),false,'standing or room membership never invents agent presence');
});
