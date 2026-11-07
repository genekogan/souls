/** Shared Wave's weight comes from recorded activity time, including an early stop.
 * Unknown pre-take onset retains the historical full-weight pose. */
export const WAVE_BLEND_SECONDS=2;
const smooth=(x:number)=>{const k=Math.max(0,Math.min(1,x));return k*k*(3-2*k);};
export function waveWeight(age:number|undefined,released?:number,duration?:number){
 const attained=age===undefined?1:smooth(age/WAVE_BLEND_SECONDS);
 return released===undefined?attained:(duration===undefined?1:smooth(duration/WAVE_BLEND_SECONDS))*(1-smooth(released/WAVE_BLEND_SECONDS));
}

/** The authored Wave raises and drops the whole arm very quickly. Its middle
 * band (.36–.72 of either shared rig's clip) keeps the hand raised and waving.
 * Traverse that band continuously, with zero speed at either end; no wrap cut. */
export function waveClipTime(worldSeconds:number,duration:number){
 return duration*(.54-.18*Math.cos(worldSeconds*2*Math.PI/3));
}

export type WaveSample={age?:number;released?:number;duration?:number};
/** Independent recorded wave tails overlap during rapid re-entry. Taking the
 * strongest envelope preserves its speed bound; weighted authored phase avoids
 * switching poses abruptly when the incoming wave becomes the stronger one. */
export function wavePose(samples:readonly WaveSample[],worldSeconds:number){
 let weight=0,total=0,phase=0,sine=0;
 for(const s of samples){
  const w=waveWeight(s.age,s.released,s.duration);if(w<=0)continue;
  const clock=worldSeconds-(s.released??0);
  weight=Math.max(weight,w);total+=w;phase+=w*waveClipTime(clock,1);sine+=w*Math.sin(clock*7);
 }
 return {weight,phase:total?phase/total:0,fallbackTime:total?Math.asin(Math.max(-1,Math.min(1,sine/total)))/7:0};
}
