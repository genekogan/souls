import {DEFAULT_SETTINGS,loadSettings,saveSettings,type SoundSettings} from './gen-mesh/sound-plan.ts';
import {musicStation} from './music-stations.ts';
type AudioSettings=SoundSettings&{station:string};
const listeners=new Set<()=>void>();
const store=()=>{try{return localStorage;}catch{return null;}};
let settings:AudioSettings|null=null;
export function loadAudioSettings(storage:Parameters<typeof loadSettings>[0]):AudioSettings{
 const saved=loadSettings(storage);
 try{return {...saved,music:saved.muted&&storage?.getItem('sim.audio.independent')!=='1'?false:saved.music,station:musicStation(storage?.getItem('sim.music.station'))};}
 catch{return {...saved,station:'all'};}
}
export function audioSettings():AudioSettings{return settings??(settings=loadAudioSettings(store()));}
const serverSettings:AudioSettings={...DEFAULT_SETTINGS,station:'all'};
export const serverAudioSettings=()=>serverSettings;
export function subscribeAudioSettings(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function setAudioSettings(next:Partial<AudioSettings>){
 settings={...audioSettings(),...next};saveSettings(store(),settings);
 try{store()?.setItem('sim.music.station',settings.station);store()?.setItem('sim.audio.independent','1');}catch{}
 for(const fn of listeners)fn();
}
