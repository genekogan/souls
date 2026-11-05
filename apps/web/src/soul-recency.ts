/** Selection history is presentation only; current server ownership always filters it. */
export function orderedSoulIds(ids:readonly string[],recent:readonly string[]){
 const owned=new Set(ids);return [...new Set([...recent.filter(id=>owned.has(id)),...ids])];
}
export function selectedSoulIds(id:string,recent:readonly string[],owned:readonly string[]){return orderedSoulIds(owned,[id,...recent]);}
export function readSoulRecency(key:string):string[]{try{const value=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'))].slice(0,24):[];}catch{return [];}}
