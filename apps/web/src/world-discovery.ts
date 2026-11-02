const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class WorldBootstrapError extends Error {readonly unavailable=true;}
/** A served HTML fallback is not an API, and one world's config cannot grant
 * entry/control under another namespace. No identity is inferred from the URL. */
/** `expectedPath`: this build's world path. Old worlds (root build) leave it at `/w/<key>`, main's rule exactly; a
 * prefixed launcher build passes its own `<BASE>/w/<key>` (world-path.ts worldPath). */
export async function readWorldBootstrap(response:Response,key:string,expectedPath=`/w/${key}`){
 if(!response.ok){if(response.status===404)throw new WorldBootstrapError('This world is not connected to this site.');throw Error(`the server answered ${response.status}`);}
 if(!response.headers.get('content-type')?.includes('application/json'))throw new WorldBootstrapError('This world has no runtime connected to this site.');
 const cfg:unknown=await response.json();
 if(!object(cfg)||cfg.worldKey!==key||typeof cfg.worldId!=='string'||!cfg.worldId||cfg.worldPath!==expectedPath)throw new WorldBootstrapError('The runtime does not match the selected world.');
 return cfg;
}
