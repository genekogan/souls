import {useSyncExternalStore} from 'react';
import {NavbarMenu} from './NavbarMenu.tsx';
import {audioSettings,serverAudioSettings,setAudioSettings,subscribeAudioSettings} from './audio-settings.ts';
import {MUSIC_STATIONS} from './music-stations.ts';
export function AudioMenu(){
 const settings=useSyncExternalStore(subscribeAudioSettings,audioSettings,serverAudioSettings);
 return <NavbarMenu label="Audio" className="navbar-audio" trigger={<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>}>
  <button type="button" role="switch" aria-checked={!settings.muted} onClick={()=>setAudioSettings({muted:!settings.muted})}>Sound effects <b>{settings.muted?'Off':'On'}</b></button>
  <button type="button" role="switch" aria-checked={settings.music} onClick={()=>setAudioSettings({music:!settings.music})}>Music <b>{settings.music?'On':'Off'}</b></button>
  <label>Radio station<select aria-label="Radio station" value={settings.station} onChange={e=>setAudioSettings({station:e.target.value})}>{MUSIC_STATIONS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
 </NavbarMenu>;
}
