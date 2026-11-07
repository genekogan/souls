/** Released core body revisions (#795 A1, D027). A core preset id names one immutable, content-addressed definition.
 *  This ledger is append-only: a released entry's asset never changes, and no entry is removed or renumbered. A changed
 *  preset is a new entry with a new id, `<family>-<n>`, shown as `<family>@<n>`; the old id keeps its in-tree source
 *  and stays selectable and servable, so selections (stored as `model: body_<sha>`) never need a migration.
 *  edge-body-core-revisions.test.ts holds the released entries and fails if one changes. */
export type CoreRevision={readonly id:string;readonly family:string;readonly n:number;readonly asset:string};
export const CORE_REVISIONS:readonly CoreRevision[]=Object.freeze([
 {id:'pip',family:'pip',n:1,asset:'body_0ac8dd17fab38e64b9367357232b819847bad25254252b5a47921ff1afa23b0f'},
 {id:'monster',family:'monster',n:1,asset:'body_e7f634a0d090b71d85229a737bbf8bb9274ffadee38d4107a79b0db599c52b77'},
 {id:'ghost',family:'ghost',n:1,asset:'body_8111f1c4504c9c3b585fcc36d2590af26c3371aa7ce3390d8b7e7549f0e1a2bd'},
 {id:'centaur',family:'centaur',n:1,asset:'body_955a6445d2d048035674ace76795b2a7403be127a6a33ad5bedfcb178c749b32'},
].map(r=>Object.freeze(r)));

const FAMILY=/^[a-z][a-z0-9]{0,30}$/,ASSET=/^body_[a-f0-9]{64}$/,VERSION=/^([a-z][a-z0-9]{0,30})@([1-9][0-9]{0,5})$/;
export const versionOf=(r:CoreRevision)=>`${r.family}@${r.n}`;
/** The ledger's rules; [] when it is well formed. Each family counts 1, 2, 3... and revision n>1 has the id `<family>-<n>`. */
export function revisionProblems(list:readonly CoreRevision[]):string[]{
 const out:string[]=[],ids=new Set<string>(),assets=new Set<string>(),next=new Map<string,number>();
 for(const r of list){const v=versionOf(r);
  if(!FAMILY.test(r.family))out.push(`${v}: family must be lowercase letters and digits`);
  if(!ASSET.test(r.asset))out.push(`${v}: asset must be body_<sha256>`);
  if(r.id!==(r.n===1?r.family:`${r.family}-${r.n}`))out.push(`${v}: id must be ${r.n===1?r.family:`${r.family}-${r.n}`}`);
  if(r.n!==(next.get(r.family)??1))out.push(`${v}: expected ${r.family}@${next.get(r.family)??1}`);
  if(ids.has(r.id))out.push(`${v}: id ${r.id} is already released`);
  if(assets.has(r.asset))out.push(`${v}: asset is already released as another revision`);
  ids.add(r.id);assets.add(r.asset);next.set(r.family,r.n+1);}
 return out;
}
/** The revision named by a preset id (`pip`, `pip-2`) or a version (`pip@1`); undefined for anything else. */
export function coreRevision(ref:string,list:readonly CoreRevision[]=CORE_REVISIONS){
 const m=VERSION.exec(ref);return m?list.find(r=>r.family===m[1]&&r.n===Number(m[2])):list.find(r=>r.id===ref);
}
export const coreAsset=(id:string)=>{const r=CORE_REVISIONS.find(r=>r.id===id);if(!r)throw Error('No released core revision '+id);return r.asset;};
