import {DEFAULT_SETTINGS,loadSettings,saveSettings,type SoundSettings} from './gen-mesh/sound-plan.ts';
import {musicStation} from './music-stations.ts';
type AudioSettings=SoundSettings&{station:string};
const listeners=new Set<()=>void>();
const store=()=>{try{return localStorage;}catch{return null;}};
let settings:AudioSettings|null=null;
export function audioSettings():AudioSettings{if(!settings){const storage=store();settings={...loadSettings(storage),station:musicStation(storage?.getItem('sim.music.station'))};}return settings;}
const serverSettings:AudioSettings={...DEFAULT_SETTINGS,station:'all'};
export const serverAudioSettings=()=>serverSettings;
export function subscribeAudioSettings(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function setAudioSettings(next:Partial<AudioSettings>){settings={...audioSettings(),...next};saveSettings(store(),settings);try{store()?.setItem('sim.music.station',settings.station);}catch{}for(const fn of listeners)fn();}
