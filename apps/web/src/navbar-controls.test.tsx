import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MySouls} from './MySouls.tsx';
import {orderedSoulIds,selectedSoulIds} from './soul-recency.ts';
import {MUSIC_STATIONS,stationPlaylist} from './music-stations.ts';
import {audioSettings,setAudioSettings,subscribeAudioSettings} from './audio-settings.ts';
import {AudioMenu} from './AudioMenu.tsx';
import {PLAYLIST} from './score/playlist/order.mjs';

test('0–3 available owned Souls stay inline with creation; four collapse the entire group into a pile',()=>{
 for(const n of [0,1,2,3,4,7]){
  const ids=Array.from({length:n},(_,i)=>`s_${i}`),souls=new Map(ids.map(id=>[id,{id,name:id,entityId:id}]));
  const html=renderToStaticMarkup(<MySouls ids={ids} souls={souls as never} select={()=>{}} newSoul={<button>New Soul</button>}/>);
  if(n<4){assert.equal((html.match(/aria-label="Open /g)??[]).length,n);assert.match(html,/New Soul/);assert.doesNotMatch(html,/Your Souls|soul-avatar-pile/);}
  else{assert.match(html,/aria-label="Your Souls"/);assert.equal((html.match(/data-soul-id=/g)??[]).length,3);assert.doesNotMatch(html,/New Soul|aria-label="Open |\+[0-9]|away/);}
 }
 const html=renderToStaticMarkup(<MySouls ids={['missing','a']} souls={new Map([['a',{id:'a',name:'Here',entityId:'e'}]]) as never} select={()=>{}} newSoul={<button>New Soul</button>}/>);
 assert.match(html,/Open Here/);assert.doesNotMatch(html,/missing|away|soul-avatar-pile/);
});
test('recency is distinct, stable, and filtered through server ownership, including deletion and account changes',()=>{
 const ids=['a','b','c','d'];let recent:string[]=[];
 for(const id of ['b','c','b','d'])recent=selectedSoulIds(id,recent,ids);
 assert.deepEqual(orderedSoulIds(ids,recent),['d','b','c','a']);
 assert.deepEqual(orderedSoulIds(['a','c'],recent),['c','a']);
 assert.deepEqual(orderedSoulIds(['x','y'],recent),['x','y']);
 assert.deepEqual(orderedSoulIds(ids,[]),ids);
});
test('each station has actual existing pieces and All restores the complete playlist',()=>{
 for(const station of MUSIC_STATIONS){const list=stationPlaylist(PLAYLIST,station.id);assert.ok(list.length>0);assert.ok(list.every(id=>PLAYLIST.includes(id)));if(station.id!=='all')assert.equal(list.length,station.pieces.length);}
 assert.equal(stationPlaylist(PLAYLIST,'all'),PLAYLIST);assert.equal(stationPlaylist(PLAYLIST,'bad'),PLAYLIST);
});
test('effects, music and station preferences are independent, persisted and observable',()=>{
 const data=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)}});
 let updates=0;const off=subscribeAudioSettings(()=>updates++);
 setAudioSettings({music:false,muted:false});setAudioSettings({station:'quiet'});
 assert.equal(audioSettings().music,false);assert.equal(audioSettings().muted,false);assert.equal(data.get('sim.music.station'),'quiet');
 setAudioSettings({muted:true});assert.equal(audioSettings().music,false);setAudioSettings({music:true});assert.equal(audioSettings().muted,true);
 assert.equal(JSON.parse(data.get('sim.sound.v1')!).music,true);assert.equal(updates,4);off();
 const html=renderToStaticMarkup(<AudioMenu/>);assert.match(html,/aria-label="Audio"/);assert.doesNotMatch(html,/eden-sound-toggle/);
 Reflect.deleteProperty(globalThis,'localStorage');
});
