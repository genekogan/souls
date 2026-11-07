// Explicit provider verification; delegated Soul credentials remain independent.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importSPKI, jwtVerify, type CryptoKey } from 'jose';
import {AccountRegistry} from './account-registry.ts';
import {isAbsolute} from 'node:path';
import type { Me } from '@souls/protocol';
import type { Config } from './config.ts';
import type { Db, UserRow } from './db.ts';
import { ownerShort } from './world.ts';

export type VerifiedAccountIdentity={id:string;issuer:string;subject:string;verifiedEmail?:string;emailVerifiedAt?:number;verifiedAt:number;expiresAt:number};
export type AttributionAccountIdentity=VerifiedAccountIdentity&{verifiedEmail:string;emailVerifiedAt:number;attributionFetchedAt:number;attributionProvider:'email'|'google_oauth'};
const attributionProofs=new WeakSet<AttributionAccountIdentity>();
/** In-process provider proof, not serializable caller claims or profile cache. */
export function hasFreshAttributionProof(identity:VerifiedAccountIdentity):identity is AttributionAccountIdentity {const now=Date.now(),proof=identity as AttributionAccountIdentity;return attributionProofs.has(proof)&&identity.expiresAt>now&&proof.attributionFetchedAt<=now&&now-proof.attributionFetchedAt<=300000;}

export class Auth {
  private key: CryptoKey | null = null;
  private clerkKeys:ReturnType<typeof createRemoteJWKSet>|null=null;
  private registry:AccountRegistry|null=null;
  private profileAt = new Map<string, number>();
  private verified=new WeakMap<UserRow,VerifiedAccountIdentity>();
  private profileProof=new Map<string,{email:string|null;at:number}>();
  ready = false;
  /** New (world-engine) worlds under Clerk: the production sign-in, and dev tokens are refused outright.
   * Old worlds (eden/mars/littlemartians) keep main's legacy agent-local projection unchanged. */
  get production(){return this.cfg.authProvider==='clerk'&&this.cfg.worldEngine===true;}
  legacyOwnerAllowed?:(ownerId:string)=>boolean;
  devAuth: boolean;
  cfg: Config; db: Db;
  constructor(cfg: Config, db: Db) {
    // Guard construction too: legacy launchers may omit init when their account
    // flag is false, then enable development fallback. Selected Clerk refuses.
    if(cfg.authProvider==='clerk'&&!cfg.accountAuthRequired)throw Error('Clerk activation requires ACCOUNT_AUTH_REQUIRED=1');
    // New worlds: Clerk is production mode, and production never takes dev identities.
    const newWorldClerk=cfg.authProvider==='clerk'&&cfg.worldEngine===true;
    if(newWorldClerk&&process.env.DEV_AUTH==='1')throw Error('DEV_AUTH=1 with AUTH_PROVIDER=clerk on a world-engine world: refusing to start');
    this.cfg = cfg; this.db = db; this.devAuth = !newWorldClerk && process.env.DEV_AUTH === '1';
    // "Bearer dev:admin" is an admin when dev auth is on. It must never be on for a public site.
    if (this.devAuth && cfg.publicUrl.startsWith('https://')) throw new Error('DEV_AUTH=1 with a public https PUBLIC_URL: refusing to start');
  }

  private basic() { return 'Basic ' + Buffer.from(`${this.cfg.privyAppId}:${this.cfg.privyAppSecret}`).toString('base64'); }

  async init() {
    if(!['clerk','privy','none'].includes(this.cfg.authProvider))throw Error('Unknown AUTH_PROVIDER');
    if(this.cfg.authProvider==='none')return;
    if(this.cfg.authProvider==='clerk'){
      if(!this.cfg.accountAuthRequired)throw Error('Clerk activation requires ACCOUNT_AUTH_REQUIRED=1');
      const issuer=new URL(this.cfg.clerkIssuer),pk=this.cfg.clerkPublishableKey;
      let domain='';try{domain=Buffer.from(pk.split('_').slice(2).join('_'),'base64').toString().replace(/\$$/,'');}catch{}
      if(issuer.protocol!=='https:'||issuer.origin!==this.cfg.clerkIssuer||domain!==issuer.hostname||!pk.startsWith('pk_live_'))throw Error('Clerk requires the exact production issuer and matching live publishable key');
      if(!isAbsolute(this.cfg.accountRegistryPath)||!this.cfg.clerkAuthorizedParties.length||!this.cfg.clerkAuthorizedParties.includes(new URL(this.cfg.publicUrl).origin))throw Error('Clerk requires an absolute shared account registry and explicit authorized application origin');
      for(const party of this.cfg.clerkAuthorizedParties){const u=new URL(party);if(u.origin!==party||u.username||u.password||!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Invalid Clerk authorized party');}
      this.registry=new AccountRegistry(this.cfg.accountRegistryPath);
      this.clerkKeys=createRemoteJWKSet(new URL('/.well-known/jwks.json',issuer));
      this.devAuth=false;this.ready=true;return;
    }
    if (!this.cfg.privyAppId || !this.cfg.privyAppSecret) { console.warn('[auth] Privy not configured; logins disabled'); return; }
    const res = await fetch(`https://auth.privy.io/api/v1/apps/${this.cfg.privyAppId}`, { headers: { Authorization: this.basic(), 'privy-app-id': this.cfg.privyAppId } });
    if (!res.ok) throw new Error(`privy app config ${res.status}`);
    const app = (await res.json()) as { verification_key: string; name: string };
    const b64 = app.verification_key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
    this.key = await importSPKI(pem, 'ES256');
    this.ready = true;
    console.log(`[auth] Privy app "${app.name}" verification key loaded`);
  }

  /** Verify a Privy access token and return the user (creating the row on first sight). */
  async userFromToken(token: string | undefined | null): Promise<UserRow | null> {
    if (!token) return null;
    // New-world production (Clerk): no `dev:` identity of any shape, legacy agent-local ones included.
    if(this.production&&token.startsWith('dev:'))return null;
    if(token.startsWith('dev:')&&this.cfg.accountAuthRequired){
      // Existing high-entropy agent-local legacy credentials retain their own
      // startup projection. They are not verified human account identities.
      if(!/^dev:agent-[0-9a-f]{24}$/.test(token))return null;
      const row=this.db.user(token);return row&&(this.legacyOwnerAllowed?this.legacyOwnerAllowed(row.id):this.db.soulsOf(row.id).some(s=>s.world_id===this.cfg.worldId&&s.token_hash))?row:null;
    }
    if (this.devAuth && token.startsWith('dev:')) {
      // Public exposure (EDGE_PUBLIC=1): only self-generated agent identities; never admin or chosen names.
      if (process.env.EDGE_PUBLIC === '1' && !/^dev:agent-[0-9a-f]{24}$/.test(token)) return null;
      const id = `dev:${token.slice(4, 40)}`;
      if (!this.db.user(id)) this.db.upsertUser({ id, email: `${token.slice(4)}@dev.local`, wallet: null, role: token === 'dev:admin' ? 'admin' : 'user' });
      return this.db.user(id)!;
    }
    if(this.cfg.authProvider==='clerk')return this.clerkUser(token);
    if(this.cfg.authProvider==='none'||!this.key)return null;
    let did: string,expiresAt:number;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'privy.io', audience: this.cfg.privyAppId });
      if(typeof payload.sub!=='string'||!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(payload.sub)||typeof payload.exp!=='number'||!Number.isFinite(payload.exp))return null;
      did=payload.sub;expiresAt=payload.exp*1000;
    } catch { return null; }
    let u = this.db.user(did);
    // (re)fetch the profile on first sight, or hourly, so a wallet created later shows up on the debug page
    const fetched = this.profileAt.get(did) ?? 0;
    if (!u || Date.now() - fetched > 3600_000) {
      const prof = await this.fetchProfile(did).catch(() => null);
      if(prof){this.profileAt.set(did,Date.now());this.profileProof.set(did,{email:prof.email,at:Date.now()});}
      const email = prof?.email ?? u?.email ?? null;
      const role = email && this.cfg.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
      this.db.upsertUser({ id: did, email, wallet: prof?.wallet ?? u?.wallet ?? null, role });
      u = this.db.user(did)!;
    } else {
      // the admin list is read on every request, so removing someone takes effect at once
      const role = u.email && this.cfg.adminEmails.includes(u.email.toLowerCase()) ? 'admin' : 'user';
      if (role !== u.role) { this.db.upsertUser({ id: did, email: u.email, wallet: u.wallet, role }); u = this.db.user(did)!; } else this.db.touchUser(did);
    }
    const proof=this.profileProof.get(did);this.verified.set(u!,{id:did,issuer:'privy.io/'+this.cfg.privyAppId,subject:did,expiresAt:expiresAt!,verifiedAt:Date.now(),...(proof?.email?{verifiedEmail:proof.email.toLowerCase(),emailVerifiedAt:proof.at}: {})});
    return u;
  }

  /** Only validated provider JWTs establish account authority. Caller emails,
   * public Soul IDs and legacy dev identities never satisfy this predicate. */
  async accountFromToken(token:string|undefined|null){const user=await this.userFromToken(token),identity=user?this.verified.get(user):undefined;return user&&identity&&identity.expiresAt>Date.now()?{user,identity}:null;}

  /** Use only from a normal authenticated browser request and a trusted manifest
   * email. This fresh read neither updates profile cache nor changes roles. */
  async freshAttributionAccountFromToken(token:string|undefined|null,expectedEmail:string){
    if(this.cfg.authProvider!=='privy')return null;
    const account=await this.accountFromToken(token);if(!account||typeof expectedEmail!=='string'||expectedEmail.length>254)return null;
    const expected=expectedEmail.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected))return null;
    try{
      const response=await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(account.identity.subject)}`,{headers:{Authorization:this.basic(),'privy-app-id':this.cfg.privyAppId},signal:AbortSignal.timeout(8000)});
      if(!response.ok)return null;const user=await response.json() as {id?:unknown;linked_accounts?:unknown};const now=Date.now();
      if(user.id!==account.identity.subject||!Array.isArray(user.linked_accounts)||account.identity.expiresAt<=now)return null;
      const timestamp=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value*1000<=now;
      const link=user.linked_accounts.find((value:unknown)=>{if(!value||typeof value!=='object')return false;const a=value as Record<string,unknown>,email=a.type==='email'?a.address:a.type==='google_oauth'?a.email:null;
        // REST user metadata documents last verification; imported/unverified
        // null timestamps and first-link metadata alone are not sufficient.
        return typeof email==='string'&&email.trim().toLowerCase()===expected&&(timestamp(a.latest_verified_at)||timestamp(a.verified_at));
      }) as {type:'email'|'google_oauth';latest_verified_at?:number;verified_at?:number}|undefined;
      if(!link)return null;const identity:AttributionAccountIdentity=Object.freeze({...account.identity,verifiedEmail:expected,emailVerifiedAt:(timestamp(link.latest_verified_at)?link.latest_verified_at!:link.verified_at!)*1000,attributionFetchedAt:now,attributionProvider:link.type});attributionProofs.add(identity);return {user:account.user,identity};
    }catch{return null;}
  }

  private async fetchProfile(did: string): Promise<{ email: string | null; wallet: string | null }> {
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, { headers: { Authorization: this.basic(), 'privy-app-id': this.cfg.privyAppId } });
    if (!res.ok) throw new Error(`privy user ${res.status}`);
    const u = (await res.json()) as { linked_accounts?: any[] };
    let email: string | null = null, wallet: string | null = null;
    for (const a of u.linked_accounts ?? []) {
      if (a.type === 'email' && a.address) email = email ?? a.address;
      if (a.type === 'google_oauth' && a.email) email = email ?? a.email;
      if (a.type === 'wallet' && a.address) wallet = wallet ?? a.address;
    }
    return { email, wallet };
  }

  private async clerkUser(token:string):Promise<UserRow|null>{
    if(!this.clerkKeys||!this.registry)return null;
    let subject:string,expiresAt:number;
    try{
      const {payload}=await jwtVerify(token,this.clerkKeys,{issuer:this.cfg.clerkIssuer,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nbf','sid','azp']});
      if(typeof payload.sub!=='string'||!/^user_[A-Za-z0-9]{1,128}$/.test(payload.sub)||typeof payload.sid!=='string'||!/^sess_[A-Za-z0-9]{1,128}$/.test(payload.sid)||typeof payload.azp!=='string'||!this.cfg.clerkAuthorizedParties.includes(payload.azp)||typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp))return null;
      subject=payload.sub;expiresAt=payload.exp*1000;
    }catch{return null;}
    const id=this.registry.bind(this.cfg.clerkIssuer,subject);
    if(!this.db.user(id))this.db.upsertUser({id,email:null,wallet:null,role:'user'});
    const user=this.db.user(id)!;this.db.touchUser(id);
    this.verified.set(user,{id,issuer:this.cfg.clerkIssuer,subject,verifiedAt:Date.now(),expiresAt});return user;
  }

  me(u: UserRow): Me {
    return { userId: u.id, short: ownerShort(u.id), email: u.email, wallet: this.cfg.accountAuthRequired?null:u.wallet, role: u.role, souls: this.db.soulsOf(u.id).map((s) => s.id), invited: !this.cfg.inviteRequired || u.role === 'admin' || !!u.invited_by };
  }
  close(){this.registry?.close();this.registry=null;this.clerkKeys=null;this.key=null;this.ready=false;}
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
export const newSoulToken = (soulId: string) => `sim_${soulId}_${randomBytes(24).toString('base64url')}`;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Tiny sliding-window rate limiter. */
export class RateLimit {
  private hits = new Map<string, number[]>(); private calls = 0;
  allow(key: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { this.hits.set(key, arr); return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) }; }
    arr.push(now); this.hits.set(key, arr);
    // forget keys nobody has used for over an hour (the longest window), so the map does not grow with every address seen
    if (++this.calls % 2000 === 0) for (const [k, a] of this.hits) if (!a.length || now - a[a.length - 1] > 3600_000) this.hits.delete(k);
    return { ok: true };
  }
}
