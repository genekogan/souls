/** Stations curate the existing score recordings; no new audio assets or synthesis path. */
export const MUSIC_STATIONS=[
 {id:'all',label:'All music',pieces:[]},
 {id:'quiet',label:'Quiet & ambient',pieces:['skylight-rain','harbour-mouth','branch-line','hydroponics-deck','headland','under-glass']},
 {id:'electronic',label:'Electronic',pieces:['nightside-pass','velour','halogen','night-approach','neon-shibuya','night-drive']},
 {id:'upbeat',label:'Upbeat',pieces:['downtown-rush','mirror-ball','grand-prix','magic-orbit','montage','night-patrol']},
] as const;
export const musicStation=(value:unknown)=>MUSIC_STATIONS.find(s=>s.id===value)?.id??'all';
export function stationPlaylist(playlist:readonly string[],station:string):readonly string[]{const chosen=MUSIC_STATIONS.find(s=>s.id===station);if(!chosen?.pieces.length)return playlist;const ids:readonly string[]=chosen.pieces;const filtered=playlist.filter(id=>ids.includes(id));return filtered.length?filtered:playlist;}
