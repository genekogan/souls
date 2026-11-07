// God mode: the world owner's edge agent edits the world through the compiler
// (spec <eden4>/28 §6–§7). This service owns the entity model for one
// world process, persists commits, hands out god tokens by the same pairing
// pattern Souls use, keeps undo/redo, routes prayers, and publishes diffs to
// viewers (hub) and to gods (SSE).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TILE_M, tileOf } from '@souls/ground';
import { WorldModel, correctKitDefines, type PlanOptions, creationInputFailure, definitionRefs, coreLibrary, libraryRef, applyBatch, padResettle, plan, batchSchema, hashOf, type Batch, type Diff, type Entity, type Failure, type Op, type Result, type StoredDef, type UsesHook, type ResidentMove } from '@souls/world-compiler';
import { hashToken } from '../auth.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { WorldStore, GOD_EDIT_OUTCOME_BYTES, type EditRow, type JournalWho, type PrayerRow } from './store.ts';
import { HelperTokens, HELPER_LIMITS, helperFailure, helperMintSchema, helperScopeFailure } from './helpers.ts';
import { accountKey, cobuilderFailure, cobuilderOf, cobuilderOpFailure, COBUILDER_PREFIX, whose } from './cobuilders.ts';
import { AssetStore, defaultAssetDir } from './assets.ts';
import { deferredOp } from './layers.ts';
import { godFeature } from '../../../../tools/god-skill/lib/features.mjs';
import { submissionSchema, type Expectations } from './submission.ts';
import { GodBuilds, buildFieldSchema, type BuildBody, type BuildField, type BuildCaller, type BuildNotice, type BuildEcho, type Identity, type SiteDelta, type WorldBuildMessage } from './builds.ts';
import { Parts } from './parts.ts';
import { GodDistricts } from './districts.ts'; // Y3 districts
import { buildReceipt } from './build-integrity.ts';
import { definitionUseClosure } from './unused-defs.ts';
import { rewindChanges, rewindDependents } from './rewind.ts';
import { GodTrace } from './trace.ts';
import { repairBatch, tagPlaces, untagPlaces, type Repair } from './buildsafe.ts';
export type { WorldBuildMessage } from './builds.ts';
const previewBatchSchema = batchSchema.extend({ build: buildFieldSchema.optional() });

const PAIR_TTL = 15 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const humanCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
export const newGodToken = (worldId: string) => `god_${worldId}_${randomBytes(24).toString('base64url')}`;

type Pairing = { code: string; poll: string; agent: string; expires: number; token?: string };
type Preview = { viewKeyHash: string; at: number; baseEditSeq: number; expect: Expectations; expectWorldAbout?: string; subtrees: Record<string, string[]>; affected: string[]; diff: Diff; ops: Batch; build?: BuildField; failures?: Failure[] };
export type WorldDiffMessage = { type: 'edge'; kind: 'world-diff'; seq: number; tick: number; at: number; now: number; builds?: SiteDelta[]; diff: Diff; by: 'god' | 'undo' | 'redo' | 'engine'; ground?: ReturnType<WorldModel['ground']>; /** every def the upserts reference (viewers only hold defs in use) */ defs: ReturnType<typeof publicDef>[] };
/** Called for every committed batch, in order, synchronously, before viewers hear of it (Stage B: the engine patches its Spatial here). */
export type CommitListener = (c: { seq: number; diff: Diff; kind: 'edit' | 'undo' | 'redo'; by: string; group?: string }) => void;
export type GodEvent = { id: number; event: 'diff' | 'prayer' | 'soul' | 'build'; data: unknown };

export type GodOptions = {
  worldId: string;
  /** Who may approve god pairing when the world has no owner yet (DEV_AUTH 'dev:admin' in local runs). */
  ownerId: string | null;
  tick: () => number;
  /** Viewer broadcast (the hub). */
  emit: (m: WorldDiffMessage | WorldBuildMessage) => void;
  now?: () => number;
  buildPauseMs?: number;
  buildClosureMs?: number;
  /** CE8 trailing attention publish; default an unref'd setTimeout (tests and replays inject a fake clock). */
  schedule?: (fn: () => void, ms: number) => void;
  constants?: Partial<WorldModel['constants']>;
  seed?: string;
  /** A genesis/1 template applied once when the world is first created (worlds/templates/*.json). */
  genesis?: Genesis;
  /** Content-addressed asset files (default $ASSET_DIR or <DATA_DIR>/../assets), shared by every world on the box. */
  assetDir?: string;
  /** The shared def library (default: the process's core library; null = none, for tests of a bare world). */
  library?: import('@souls/world-compiler').DefLibrary | null;
  /** Y4b co-builder tokens (`cobuilder:<account>:…`). Gene 2026-10-16: one god per world; the code stays for later but is off
   *  unless the world runs with SIM_COBUILDERS=1. Off: such tokens (and their helpers) are not god tokens at all. */
  cobuilders?: boolean;
};

/** genesis/1: constants, state and ordered batches that build a world from nothing (spec 29 §4.5). */
export type Genesis = { schema: 'genesis/1'; name?: string; description?: string; constants?: Partial<WorldModel['constants']>; state?: Record<string, unknown>; batches: { note?: string; group?: string; ops: unknown[] }[] };

/** G1: the god's line for a resident its edit walked out of the way (the resident's own reason, quoted). */
const movedWarning = (m: ResidentMove) => m.how === 'stopped' ? `body.stopped: ${m.name} stopped on the way to what the edit changes (at (${m.to.join(', ')})); told "${m.reason}"`
  : `body.${m.how === 'walked' ? 'walked-out' : 'relocated'}: ${m.name} ${m.how === 'walked' ? 'walked' : 'was moved (no walking route)'} to (${m.to.join(', ')}${m.level ? `, floor level ${m.level}` : ''}); told "${m.reason}"`;
/** G1: who an edit would walk out, for a dry run or preview (nobody is moved). */
const wouldMove = (moved: ResidentMove[]) => moved.map(m => ({ name: m.name, soulId: m.soulId, how: m.how, to: m.to, ...(m.level ? { level: m.level } : {}), reason: m.reason }));
/** G1: what the walk-out planner made of an accepted edit: who moves, warnings (no clear ground; a thing set down
 *  instead of put into a resident's hands) and the would-be world's entities it rewrote. */
export type WalkoutPrep = { moved: ResidentMove[]; warnings: string[]; touched: string[] };
/** R8: what the committed god request was, for the residents' map-change notice (map-notices.ts). */
export type ApplyContext = { kind: 'edit' | 'undo' | 'redo'; note?: string; build?: string };
const NO_WALKOUTS: WalkoutPrep = { moved: [], warnings: [], touched: [] };

export class GodMode {
  readonly store: WorldStore;
  readonly assets: AssetStore;
  readonly builds: GodBuilds;
  readonly districts: GodDistricts; // Y3 districts
  readonly parts: Parts;
  readonly helpers: HelperTokens;
  /** RL7: bounded in-memory ring of god request metadata (routes.ts records; `trace` and `build show` read). */
  readonly trace: GodTrace = new GodTrace({ now: () => this.now() });
  private caller: BuildCaller = {};
  /** Journal label for edits made without a token (genesis import); 'server' otherwise. */
  private system: string | null = null;
  private buildListeners: ((e: BuildNotice) => void)[] = [];
  onBuild(fn: (e: BuildNotice) => void): () => void { this.buildListeners.push(fn); return () => { this.buildListeners = this.buildListeners.filter(f => f !== fn); }; }
  as<T>(caller: BuildCaller, fn: () => T): T { const previous = this.caller; this.caller = caller; try { return fn(); } finally { this.caller = previous; } }
  now(): number { return (this.opts.now ?? Date.now)(); }
  model: WorldModel;
  owner: string | null;
  private pairings = new Map<string, Pairing>();
  private commitListeners: CommitListener[] = [];
  /** Name of the genesis template this world was created from (null = empty plain). */
  template: string | null = null;
  private previews = new Map<string, Preview>();
  /** Subscribe to committed batches (ordered, synchronous). Returns an unsubscribe. */
  /** Body-aware edits (installed by the engine bridge). `uses`/`refuse` refuse only edits of a resident's body itself;
   *  G1 "god rules": `prepare` plans, on the would-be world, the residents an accepted edit/undo/redo walks out of its
   *  way (listed as `moved` in the durable receipt), and `apply` moves them after the SQL commit in the same request.
   *  Null in worlds without the engine. */
  bodies: { uses: UsesHook; lifted?: (ids: string[], after?: WorldModel) => string[]; refuse?: (after: WorldModel, diff: Diff, ops: Op[], o?: { undo?: boolean }) => Failure | null; prepare?: (before: WorldModel, after: WorldModel, diff: Diff, ops: Op[], o?: { dry?: boolean }) => WalkoutPrep; apply?: (moved: ResidentMove[], o?: ApplyContext) => string[] | void; arrivalNote?: (diff: Diff) => string[]; navNote?: (diff: Diff, said?: string[]) => string[] } | null = null;
  /** Bridge admission/decoration must run before the accepted receipt is persisted, and never on replay. */
  actGuard: ((batch: unknown) => Result | null) | null = null;
  finalizeAct: ((result: Result, after: WorldModel) => Result) | null = null;
  onCommit(fn: CommitListener): () => void { this.commitListeners.push(fn); return () => { this.commitListeners = this.commitListeners.filter((f) => f !== fn); }; }
  private subscribers = new Set<(e: GodEvent) => void>();
  private ring: GodEvent[] = [];
  private eventSeq = 0;

  readonly db: Db; readonly opts: GodOptions;
  // Existing diff-only embedders remain source compatible; new consumers can explicitly accept both feeds.
  constructor(db: Db, opts: Omit<GodOptions, 'emit'> & { emit: (m: WorldDiffMessage) => void });
  constructor(db: Db, opts: GodOptions);
  constructor(db: Db, opts: GodOptions | (Omit<GodOptions, 'emit'> & { emit: (m: WorldDiffMessage) => void })) {
    this.db = db; this.opts = opts as GodOptions;
    this.store = new WorldStore(db, opts.worldId);
    this.assets = new AssetStore({ dir: opts.assetDir ?? defaultAssetDir(), db, worldId: opts.worldId });
    // CATRUN (engine fix i): the core kit is one shared, content-addressed library per process, referenced by version
    // (libraryRef), never copied into a world. A world stores only the defs it uses, adopted (pinned by hash) the first
    // time something is placed from them; its own stored hashes always win, so old worlds resolve exactly as before and
    // new core types appear in every world at zero cost.
    const meta = this.store.meta(), owner = meta ? meta.owner : opts.ownerId;
    const library = opts.library === undefined ? coreLibrary() : opts.library;
    const loaded = this.store.load(this.assets.lookup, library);
    if (loaded) { this.model = loaded.model; this.owner = loaded.owner; }
    else {
      this.model = new WorldModel({ constants: { ground: 'land', extent: 1000, ...opts.constants, ...opts.genesis?.constants } as never, seed: opts.seed ?? `${opts.worldId}:genesis`, assets: this.assets.lookup });
      this.model.library = library;
      this.owner = opts.ownerId;
      this.store.init(this.model, this.owner);
    }
    this.builds = new GodBuilds(this.store, { model: () => this.model, now: () => this.now(), pauseMs: opts.buildPauseMs, closureMs: opts.buildClosureMs,
      emit: m => { try { this.opts.emit(m); } catch { /* viewers are best effort */ } },
      receipt: (id, body) => this.checkBuild(id, body)?.receipt, schedule: opts.schedule,
      notice: e => { this.push('build', e); for (const fn of this.buildListeners) { try { fn(e); } catch { /* listeners must not turn a committed edit into a refusal */ } } },
    });
    // Y3 districts: private plans built as chapter builds; a chapter start takes site and massing from its plots.
    this.districts = new GodDistricts({ store: this.store, model: () => this.model, now: () => this.now(), builds: () => this.builds });
    this.builds.districtStart = raw => this.districts.expand(raw);
    this.onBuild(e => { if (e.kind === 'done' || e.kind === 'abandoned') this.districts.onClosed(e.id); }); // Y3: closed chapters outlive the build-row prune
    this.parts = new Parts(this.store, { model: () => this.model, now: () => this.now() });
    this.helpers = new HelperTokens(db, opts.worldId);
    this.onBuild(e => { if (e.kind === 'done') this.parts.onDone(e.id); });
    this.parts.backfill();
    if (!loaded && opts.genesis) this.applyGenesis(opts.genesis);
    if (loaded) this.regraded = this.regradePads();
  }
  /** pad/2 and pad/2b at boot (lanes RT, PADFIX): ids of standing things whose foundation was re-cut this boot. */
  regraded: string[] = [];
  /**
   * pad/2 (lane RT, 2026-10-20): a foundation pad stored before pad/2 (no `grade`: a 1.5 m smoothstep blend that can cut an
   * unwalkable bank across a door on a slope) is re-cut once, at boot, as a graded pad with door landings.
   * pad/2b (lane PADFIX, 2026-10-21): pad/2 banks folded one after another, so the 3.59.1 re-cut let a later building's
   * bank (up to 16 m) cut the ground under a neighbour's flat (the alpine mountain station hung 6.6 m in the air) and a
   * re-cut that found a neighbour's bank within the skirt dropped its pad. Every pad cut now is pad/2b ("flats win",
   * ground height.ts padsFlatsWin), and once, at boot, the pads whose flat is off its level, the pad-less buildings left
   * off their pose, and every older pad whose bank or flat reaches them (world-compiler padResettle) are re-cut in place
   * under pad/2b, so each building's flat is back at its own level and nothing standing on it moves.
   * Both are a trusted engine move of each thing to its own pose (compile.ts `move` in place: clear the old pad, re-admit
   * the stored pose, a pad at its own level), journaled by 'engine' like any other engine edit, so the new ground is a
   * durable recorded fact (the GroundHost built next logs it as a new groundV1) and earlier history replays unchanged
   * (pad/1 and pad/2 pads fold exactly as before). Idempotent: a pad/2b pad is never re-cut. A refused move leaves that
   * thing as it was.
   */
  private regradePads(): string[] {
    const ungraded = this.model.ground().landforms
      .filter((lf) => lf.kind === 'pad' && (lf as { grade?: number }).grade === undefined && lf.id.endsWith(':pad'))
      .map((lf) => lf.id.slice(0, -':pad'.length)).filter((id) => this.model.entities.has(id));
    const ids = [...new Set([...ungraded, ...padResettle(this.model, new Set(this.store.engineMoveIds('pad/2: re-cut')))])];
    if (!ids.length) return [];
    const note = ungraded.length === ids.length ? 'pad/2b: re-cut an old foundation pad as graded banks with door landings, flats win (lanes RT, PADFIX)'
      : 'pad/2b: re-cut foundation pads in place so no bank cuts a neighbour\'s flat and every building stands at its own level (lane PADFIX)';
    if (this.engineAct(ids.map((id): Op => ({ op: 'move', id, mode: 'strict' })), note).accepted) return ids;
    return ids.filter((id) => this.engineAct([{ op: 'move', id, mode: 'strict' }], note).accepted);
  }

  // ---------- authority ----------

  /** The owner is the first approving user when the world has none yet; afterwards only that user (or an admin). */
  canApprove(user: { id: string; role: string }): boolean { return user.role === 'admin' || !this.owner || this.owner === user.id; }
  claim(user: { id: string }) {
    if (!this.owner) {
      this.owner = user.id; this.store.setOwner(this.model, this.owner);
    }
  }
  godIdentity(token: string | undefined): Identity | null {
    if (!token?.startsWith('god_')) return null;
    // Y4b: a co-builder token (label `cobuilder:<account>:…`, set by the launcher) and its helpers carry their account.
    const scoped = (identity: Identity, rootLabel: string | null) => { const account = cobuilderOf(rootLabel); return account === null ? identity : { ...identity, cobuilder: account }; };
    const hash = hashToken(token); let identity: Identity | null = null;
    if (this.store.hasToken(hash)) { const label = this.store.tokenLabel(hash); identity = scoped({ hash, label: label ?? 'an agent' }, label); }
    else { const helper = this.helpers.scope(hash, this.now(), (b, c) => this.builds.claimState(b, c), parent => this.store.hasTokenRow(parent)); identity = helper ? scoped({ hash, label: helper.label, child: helper.scope }, helper.scope.parentLabel) : null; }
    // Gene 2026-10-16: one god per world. With co-builders off, a co-builder token (or its helper) is no god token anywhere.
    return identity?.cobuilder !== undefined && !this.opts.cobuilders ? null : identity;
  }
  /** Why a co-builder token is refused while co-builders are off (one god per world); null for any other token. */
  cobuilderRefusal(token: string | undefined): string | null {
    if (this.opts.cobuilders || !token?.startsWith('god_')) return null;
    const hash = hashToken(token);
    const label = this.store.hasToken(hash) ? this.store.tokenLabel(hash) : this.helpers.scope(hash, this.now(), (b, c) => this.builds.claimState(b, c), parent => this.store.hasTokenRow(parent))?.scope.parentLabel;
    return cobuilderOf(label) === null ? null : 'Co-builders are turned off on this site: each world has one god, its owner. Ask the world owner to build this, or to hand the world over.';
  }
  /** Why a helper token is refused (expired, claim no longer held, lead token gone); null for any other token. */
  helperRefusal(token: string | undefined): string | null {
    if (!token?.startsWith('god_')) return null;
    return this.helpers.refusal(hashToken(token), this.now(), (b, c) => this.builds.claimState(b, c), parent => this.store.hasTokenRow(parent));
  }
  /** WD7 slice 3: a root token mints a helper token for a claim it holds. The lead's token is never echoed. */
  mintHelper(build: string, claim: string, raw: unknown, caller: Identity) {
    if (caller.child) return { ok: false as const, failures: [helperFailure('helper.scope', 'Helper tokens cannot mint tokens.')] };
    if (caller.cobuilder !== undefined) return { ok: false as const, failures: [cobuilderFailure('Co-builder tokens cannot mint tokens; give a sub-agent EDEN_GOD_CLAIM instead, or ask the world owner.')] };
    const p = helperMintSchema.safeParse(raw ?? {});
    if (!p.success) return { ok: false as const, failures: p.error.issues.map(i => ({ op: -1, code: 'schema', field: i.path.join('.'), detail: i.message, fix: `{ label?: 1..60 chars, ttlMs?: ${HELPER_LIMITS.minTtlMs}..${HELPER_LIMITS.maxTtlMs}, verify?: 0..${HELPER_LIMITS.maxVerifyBudget} }` })) };
    this.builds.sweep();
    const held = this.builds.heldClaim(build, claim, caller); if ('failure' in held) return { ok: false as const, failures: [held.failure] };
    const token = newGodToken(this.opts.worldId), hash = hashToken(token), label = (p.data.label ?? `${caller.label.slice(0, 30)}/helper:${held.claim.part}`).slice(0, 60);
    const ttlMs = p.data.ttlMs ?? HELPER_LIMITS.defaultTtlMs, verify = p.data.verify ?? HELPER_LIMITS.verifyBudget;
    const minted = this.helpers.mint({ tokenHash: hash, parent: { hash: caller.hash, label: caller.label }, label, build, claim, part: held.claim.part, ttlMs, verify }, this.now(), (b, c) => this.builds.claimState(b, c));
    if ('code' in minted) return { ok: false as const, failures: [minted] };
    return { ok: true as const, token, helper: { label, hash8: hash.slice(0, 8), build, claim, part: held.claim.part, expiresAt: minted.expiresAt, verifyBudget: verify, pooledWith: caller.hash.slice(0, 8), ends: 'when the claim is released, done or taken, when the build closes, or at expiresAt' } };
  }
  /** A helper caller always edits through its claim: fill the field when absent; admission refuses any other field. */
  private callerField(explicit?: BuildField): BuildField | undefined {
    const child = this.caller.identity?.child;
    return explicit ?? this.caller.build ?? (child ? { id: child.build, claim: child.claim } : undefined);
  }
  /** Helper (and Y4b co-builder) authorisation runs before any other admission rule, so its refusal is the same on every path. */
  private helperGate(field: BuildField | undefined, ops: readonly Op[]): Failure | null {
    const id = this.caller.identity, child = id?.child;
    return (child ? helperScopeFailure(child, field, ops) : null) ?? (id?.cobuilder !== undefined ? cobuilderOpFailure(ops) : null);
  }
  /** WD7 slice 2: every journal row names the token (hash8 + label) or the system that made it; Y4b adds the co-builder account. */
  private who(): JournalWho { const id = this.caller.identity; return id ? { hash8: id.hash.slice(0, 8), label: id.label, acct: accountKey(id.cobuilder) } : { hash8: null, label: this.system ?? 'server' }; }
  /** Helpers undo and redo only their own journal rows inside their own claim group. */
  private foreignEdit(targets: EditRow[]) {
    const id = this.caller.identity, child = id?.child;
    // Y4b: a co-builder undoes and redoes only its own account's rows (never the owner's, another co-builder's or the system's).
    if (id?.cobuilder !== undefined) {
      // Rows written before accounts were journaled still count as its own when its own token made them.
      const mine = accountKey(id.cobuilder), other = targets.find(t => (t.acct ?? null) !== mine && t.hash8 !== id.hash.slice(0, 8));
      if (other) return cobuilderFailure(`Edit ${other.seq} is ${whose(other.acct ?? null)} work (by ${other.label ? `${other.label}${other.hash8 ? '#' + other.hash8 : ''}` : 'an earlier agent'}); a co-builder undoes and redoes only its own account's edits.`, { measured: { seq: other.seq } });
    }
    if (!child) return null;
    const group = `${child.build}/${child.part}`;
    const foreign = targets.find(t => t.hash8 !== id.hash.slice(0, 8) || t.grp !== group);
    return foreign ? helperFailure('helper.scope', `Edit ${foreign.seq} was made by ${foreign.label ? `${foreign.label}${foreign.hash8 ? '#' + foreign.hash8 : ''}` : 'another agent'}${foreign.grp !== group ? ` in group ${foreign.grp ?? '(none)'}` : ''}; helper tokens undo only their own edits in ${group}.`, { measured: { seq: foreign.seq } }) : null;
  }
  godFromToken(token: string | undefined): boolean { return this.godIdentity(token) !== null; }

  pairStart(agent: string | undefined, base: string) {
    const code = humanCode(), poll = randomBytes(24).toString('base64url');
    // Y4b: `cobuilder:` labels come only from the launcher's co-builder pairing, never from an agent naming itself.
    const name = agent?.startsWith(COBUILDER_PREFIX) ? `agent-${agent.slice(COBUILDER_PREFIX.length)}` : agent;
    this.pairings.set(code, { code, poll, agent: name?.slice(0, 60) || 'an agent', expires: Date.now() + PAIR_TTL });
    return { user_code: code, approve_url: `${base}/#godpair/${code}`, poll_token: poll, interval_s: 3, expires_in: PAIR_TTL / 1000, tell_your_human: `Open ${base}/#godpair/${code} , sign in as this world's owner, and approve me as its god.` };
  }
  pairInfo(codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    return { code: p.code, agent: p.agent, approved: !!p.token, world: this.opts.worldId, owner: this.owner };
  }
  pairApprove(user: { id: string; role: string }, codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    if (p.token) throw new ApiError(409, 'pair-done', 'already approved');
    if (!this.canApprove(user)) throw new ApiError(403, 'forbidden', 'only this world\'s owner may approve a god');
    this.claim(user);
    p.token = newGodToken(this.opts.worldId);
    this.store.addToken(hashToken(p.token), p.agent);
  }
  /** Requests waiting for the owner's approval (shown on the world page). */
  pendingPairings() { const now = Date.now(); return [...this.pairings.values()].filter((p) => !p.token && p.expires > now).map((p) => ({ code: p.code, agent: p.agent, expiresIn: Math.round((p.expires - now) / 1000) })); }
  /** The authored onboarding text for this world's owner (served as markdown and shown on the page). */
  welcome(base: string, worldName: string) {
    return `# You are the god of ${worldName}

Your agent (Claude Code, Codex, any always-on agent) builds this world through **god mode**:
it reads the whole world as structure, proposes edits, and the world validates them against
physics (support, no interpenetration, size, extent). Souls are mortal; they pray to you.

## Pair your agent (once)

Paste this to your agent:

\`\`\`
Read ${base}/SKILL.md and follow its God mode section: you are the god of this world.
\`\`\`

That one skill installs the god CLI and pairs it: approve the code that appears on this page. By hand:

\`\`\`
mkdir ${worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-god && cd $_
curl -sO ${base}/god/eden-god.mjs
node eden-god.mjs register ${base}
node eden-god.mjs pair        # prints a code; approve it on this page (or open the link it prints)
\`\`\`

Then talk to your agent: *"put mountains in the east and a lake in the west"*, *"a cottage on the
knoll, door facing the lake"*, *"undo that"*. Friends join as Souls with this page's **New Soul**.

${godFeature('flags') ? `## Reference points

Press **⚑ flag** on this page, click the ground, name it. Your agent refers to it as \`flag:<name>\`
(\`place cottage --at flag:camp --offset 8,0\`). \`node eden-god.mjs flags\` lists them.

` : ''}## What the world keeps

Every accepted edit is journaled with its inverse (undo/redo). The world runs while you are away.
Prayers from Souls queue for you: \`node eden-god.mjs prayers\`, \`answer <id> <text>\`.
`;
  }
  pairPoll(poll: string) {
    const p = [...this.pairings.values()].find((x) => x.poll === poll);
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'unknown or expired pairing; start again');
    if (!p.token) return { status: 'pending' as const };
    this.pairings.delete(p.code);
    return { status: 'approved' as const, token: p.token, world: this.opts.worldId };
  }
  /** Local convenience: the owner (or admin) mints a token directly, e.g. `eden world create` against a dev server. */
  mintFor(user: { id: string; role: string }, label: string) {
    if (!this.canApprove(user)) throw new ApiError(403, 'forbidden', 'only this world\'s owner may hold god mode');
    this.claim(user);
    const token = newGodToken(this.opts.worldId);
    this.store.addToken(hashToken(token), label.slice(0, 60));
    return token;
  }

  // ---------- edits ----------

  // W1: history is durable even after undo/removal; compiler checks live dependencies too.
  private retirementFailure(ops: readonly Op[]): Failure | null {
    if (!ops.some(op => op.op === 'undefine')) return null;
    const used = definitionUseClosure(this.model, this.store.placedDefRefs());
    for (const [i, op] of ops.entries()) if (op.op === 'undefine') {
      const ref = this.model.def(op.ref)?.ref;
      if (ref && used.has(ref)) return { op: i, code: 'def.in-use', field: 'ref', detail: `${ref} has been placed before; cleanup only retires never-placed trials.` };
    }
    return null;
  }
  dryrun(batch: unknown) {
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { accepted: false as const, failures: [inputFailure] };
    const kit = correctKitDefines(batch); batch = kit.batch; // harvest fix kitlenient
    const parsed = previewBatchSchema.safeParse(batch); if (!parsed.success) return { accepted: false as const, failures: parsed.error.issues.map(i => ({ op: -1, code: 'schema', field: i.path.join('.'), detail: i.message })) };
    const gate = this.helperGate(this.callerField(parsed.data.build), parsed.data.ops); if (gate) return { accepted: false as const, failures: [gate] };
    const retirement = this.retirementFailure(parsed.data.ops); if (retirement) return { accepted: false as const, failures: [retirement] };
    const off = deferredOp(parsed.data); if (off) return { accepted: false as const, failures: [off] };
    const admission = this.builds.admit(this.callerField(parsed.data.build), parsed.data, this.caller.identity); if (admission.failures) return { accepted: false as const, failures: admission.failures };
    // buildsafe/1: a dry run answers as the commit would (the same repair ops, lines and diff; a sealed room repaired or named)
    const safe = this.applySafe({ ...parsed.data, group: admission.group } as Batch, this.opts.tick(), false, this.dryOpts(admission), []);
    if (!safe.r.result.accepted) return { accepted: false as const, failures: safe.r.result.failures };
    const diff = safe.r.diff!;
    const moving = this.bodies?.prepare?.(this.model, safe.next, diff, safe.batch.ops as Op[], { dry: true }) ?? NO_WALKOUTS;
    return { accepted: true as const, ids: safe.r.result.ids, warnings: [...kit.warnings, ...safe.r.result.warnings, ...(safe.repair?.lines ?? []), ...moving.warnings], diff: summarize(diff), ...(moving.moved.length ? { wouldMove: wouldMove(moving.moved) } : {}) };
  }
  /** Plan options of a dry run or preview: the bridge's refusals and build admission, as a commit checks them. */
  private dryOpts(admission: ReturnType<GodBuilds['admit']>): PlanOptions {
    return { uses: this.bodies?.uses, refuse: (after, diff, ops) => { const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused; const check = this.builds.check(admission, this.model, after, diff, ops); return 'failure' in check ? check.failure : null; } };
  }
  act(batch: unknown, note?: string): Result {
    const result = this.commitBatch(batch, note);
    if (!result.accepted) {
      const input = batch as { build?: BuildField; preview?: string } | null;
      this.builds.recordRefusal(input?.build ?? (input?.preview ? this.getPreview(input.preview)?.build : this.caller.build), result.failures);
    }
    return result;
  }
  /** Only server-owned genesis import can request trusted library adoption; request JSON cannot enable it. */
  private commitBatch(batch: unknown, note?: string, trusted = false): Result {
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { accepted: false, failures: [inputFailure] };
    const kit = correctKitDefines(batch); batch = kit.batch; // harvest fix kitlenient: the corrected ops are the ones stored
    const parsed = submissionSchema.safeParse(batch);
    if (!parsed.success) return { accepted: false, failures: parsed.error.issues.map((i) => ({ op: typeof i.path[1] === 'number' ? i.path[1] : -1, code: 'schema', field: i.path.join('.'), detail: i.message, fix: 'Use the operation shape in GET /v1/god/schema.' })) };
    const input = parsed.data;
    // This canonical envelope survives preview expiry/restart. payloadHash below additionally binds the sealed ops.
    const requestHash = hashOf({ batch: input, note: note ?? input.note ?? null });
    if (input.clientRef !== undefined) { const saved = this.store.retry(input.clientRef, requestHash); if (saved) return saved; }
    let normalized: Batch;
    let preview: Preview | null = null;
    if (input.preview !== undefined) {
      preview = this.getPreview(input.preview);
      if (!preview) return { accepted: false, failures: [{ op: -1, code: 'revision.stale', field: 'preview', detail: `Preview ${input.preview} expired or is unknown.`, fix: 'Create a new preview and commit its id.' }] };
      if (preview.failures) return { accepted: false, failures: structuredClone(preview.failures) };
      if ((input.ops && hashOf(input.ops) !== hashOf(preview.ops.ops)) || (input.group !== undefined && input.group !== preview.ops.group) || (input.note !== undefined && input.note !== preview.ops.note) || (input.build !== undefined && hashOf(input.build) !== hashOf(preview.build ?? null))) return { accepted: false, failures: [{ op: -1, code: 'schema', field: 'preview', detail: 'The submitted operations or batch metadata differ from the sealed preview.', fix: 'Commit with {preview, clientRef}, or create a new preview for the changed batch.' }] };
      normalized = { ...preview.ops, clientRef: input.clientRef };
    } else normalized = batchSchema.parse(input);
    const field = preview ? preview.build : this.callerField(input.build);
    const gate = this.helperGate(field, normalized.ops); if (gate) return { accepted: false, failures: [gate] };
    const retirement = this.retirementFailure(normalized.ops); if (retirement) return { accepted: false, failures: [retirement] };
    const stale = [...this.stale(preview?.expect ?? {}), ...this.staleSubtrees(preview), ...this.stale(input.expect ?? {})];
    for (const expected of [input.expectWorldAbout, preview?.expectWorldAbout]) if (expected !== undefined && expected !== hashOf(this.model.state.about ?? null)) stale.push({ op: -1, code: 'revision.stale', field: 'expectWorldAbout', detail: 'World meaning changed since it was read. Read it again before replacing it.' });
    if (stale.length) return { accepted: false, failures: [...new Map(stale.map(f => [f.entity, f])).values()] };
    for (const [i, op] of normalized.ops.entries()) if (op.op === 'answer' && !this.store.prayer(op.prayer)) return { accepted: false, failures: [{ op: i, code: 'params.invalid', field: 'prayer', detail: `Unknown prayer ${op.prayer}.`, fix: 'Use an id from GET /v1/god/prayers.' }] };
    const admission = this.builds.admit(field, normalized, this.caller.identity); if (admission.failures) return { accepted: false, failures: admission.failures };
    normalized.group = admission.group;
    const journalNote = note ?? normalized.note;
    const payloadHash = hashOf({ batch: normalized, build: field ?? null, expect: input.expect, expectWorldAbout: input.expectWorldAbout, preview: input.preview, note: journalNote ?? null });
    const guard = this.actGuard?.(normalized); if (guard) return guard;
    const off = deferredOp(normalized); if (off) return { accepted: false, failures: [off] } as Result;
    const tick = this.opts.tick();
    // Keep public state untouched until SQL succeeds. No SQL write lock is held while planning or baking.
    let next = this.model.fork();
    const lifted: string[] = [];
    let made: string[] = [];
    const planOpts = { trusted, uses: this.bodies?.uses, refuse: (after: WorldModel, diff: Diff, ops: Op[]) => {
      const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused;
      const check = this.builds.check(admission, this.model, after, diff, ops); if ('failure' in check) return check.failure; made = check.made;
      // Warning geometry uses the same typed bake boundary as admission, before any live/SQL mutation.
      if (this.bodies?.lifted) lifted.push(...this.bodies.lifted(diff.upserts.map(e => e.id), after));
      return null;
    } };
    // buildsafe/1 (lane BS2): what the edit newly cuts off at ground level is repaired in this same batch (a piece nudged
    // clear, a gate opened in a wall built round something); a god edit is never refused for it (nor for sealing a
    // room: that is repaired or named too); what is left is one line each to the god.
    const safe = this.applySafe(normalized, tick, trusted, planOpts, lifted);
    const r = safe.r; normalized = safe.batch; next = safe.next; const repair = safe.repair;
    if (preview && r.result.accepted) {
      const affected = new Set(preview.affected);
      const added = [...new Set([...r.diff!.upserts.map(e => e.id), ...r.diff!.removes])].filter(id => this.model.entities.has(id) && !affected.has(id));
      if (added.length) return { accepted: false, failures: added.map(id => ({ op: -1, code: 'revision.stale', entity: id, field: 'preview.affected', detail: `${this.model.pathOf(id)} would now be changed by this batch but was absent from the preview.`, measured: { id, v: this.model.entities.get(id)!.v }, fix: 'Create a new preview including the newly affected entities.' })) };
    }
    if (r.result.accepted) r.result.warnings.push(...lifted, ...(repair?.lines ?? []));
    const result = this.finalizeAct?.(r.result, next) ?? r.result;
    if (!result.accepted) return result;
    const walkouts = this.bodies?.prepare?.(this.model, next, r.diff!, normalized.ops) ?? NO_WALKOUTS, moved = walkouts.moved;
    if (moved.length) result.moved = moved;
    result.warnings.push(...moved.map(movedWarning), ...walkouts.warnings);
    const at = this.now(), roots = this.builds.rootsDelta(this.model, next, r.diff!, 'edit', field);
    const updates = this.builds.writes(admission, roots, result.seq, at, this.caller.identity, undefined, false, made, journalNote);
    if (updates.failures) return { accepted: false, failures: updates.failures };
    for (const w of updates.writes) if (w.status === 'done' && w.next.done) {
      const pending: EditRow = { seq: result.seq, by: 'god', at, note: journalNote ?? null, grp: normalized.group ?? null, ops: normalized.ops, inverse: r.inverse!, kind: 'edit', undone: 0, undo_of: null, ...this.who() };
      const targets = [pending, ...this.store.groupEditsUnder(w.id, false, 2_147_483_647)], undo = this.preflightUndo(targets, next, false);
      w.next.done.receipt = buildReceipt(next.fork(), { ...this.builds.body(w.id)!, ...w.next }, targets, undo.ok ? { ok: true, baseline: undo.model } : undo, at); w.receipt = w.next.done.receipt;
      const durable = structuredClone(w.next); delete durable.done!.receipt; w.body = JSON.stringify(durable);
    }
    result.warnings.push(...kit.warnings, ...admission.warnings, ...roots.warnings, ...updates.warnings);
    result.warnings.push(...this.parts.warnings(normalized.ops));
    if (normalized.ops.some(o => o.op === 'world' && ['sky', 'time', 'weather'].some(k => Object.hasOwn(o.state, k)))) {
      result.warnings.push(...this.sharedClockWarnings(this.caller.identity));
    }
    if (updates.echo) (result as typeof result & { build: BuildEcho }).build = updates.echo;
    // SQL fills in the real revision. Reserve its widest safe integer representation before admission.
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8') + (updates.echo ? String(Number.MAX_SAFE_INTEGER).length - 1 : 0);
    if (normalized.clientRef !== undefined && bytes > GOD_EDIT_OUTCOME_BYTES) return { accepted: false, failures: [{ op: -1, code: 'request.budget', field: 'result', detail: `Accepted result would require ${bytes} bytes; receipt limit is ${GOD_EDIT_OUTCOME_BYTES}.`, measured: bytes, limit: GOD_EDIT_OUTCOME_BYTES, fix: 'Submit a smaller batch using a fresh clientRef.' }] };
    const { ops, group, clientRef } = normalized;
    const concurrent = this.store.commit(next, this.owner, r.diff!, { seq: result.seq, by: 'god', at, note: journalNote, group, ops, inverse: r.inverse!, kind: 'edit', builds: updates.writes, origins: this.parts.origins(ops, next, this.caller.identity), who: this.who() }, clientRef === undefined ? undefined : { clientRef, requestHash, payloadHash, result });
    if (concurrent) return concurrent;
    // A resident the engine could not land where planned is named in the receipt too (best effort: never unsends it).
    const late = this.bodies?.apply?.(moved, { kind: 'edit', note: journalNote ?? undefined, build: field?.id ?? group?.split('/')[0] }) ?? [];
    if (late.length) { result.warnings.push(...late); if (clientRef !== undefined) this.store.amendReceipt(clientRef, result); }
    if (updates.echo) updates.echo.rev = updates.writes.find(w => w.echo)!.rev!;
    Object.assign(this.model, next); // preserve bridge/nav references and WeakMap keys
    const deltas = this.builds.accepted(updates.writes);
    this.notify(result.seq, r.diff!, 'edit', group);
    this.publish(result.seq, tick, r.diff!, 'god', deltas);
    this.builds.announceCommitted(updates.writes);
    for (const a of r.diff!.answers) { const row = this.store.prayer(a.prayer); if (row) this.push('prayer', row); }
    // arrival-search/1: an edit that blocks (or keeps blocking, differently) the arrival point says where new Souls will arrive.
    const arrival = this.bodies?.arrivalNote?.(r.diff!) ?? [];
    // nav-connect/1 (lane NAV): an edit that cuts Souls off from the walkable world steps them to open ground (logged);
    // things it leaves with no walk to them are named in one line
    const nav = this.bodies?.navNote?.(r.diff!, repair?.named) ?? [];
    if (arrival.length || nav.length) { result.warnings.push(...arrival, ...nav); if (clientRef !== undefined) this.store.amendReceipt(clientRef, result); }
    return result;
  }
  /** buildsafe/1: apply a god batch, repair what it newly cuts off (buildsafe.ts) as extra ops of the same batch, and
   *  turn a sealed-room refusal into a repair or one line. Trusted (genesis) batches apply as before. */
  private applySafe<B extends Batch>(batch: B, tick: number, trusted: boolean, opts: PlanOptions, lifted: string[]): { r: ReturnType<typeof applyBatch>; next: WorldModel; batch: B; repair: Repair | null } {
    const go = (ops: B['ops'], o: PlanOptions) => { const next = this.model.fork(); lifted.length = 0; return { next, r: applyBatch(next, { ...batch, ops }, 'god', tick, o) }; };
    if (trusted) { const a = go(batch.ops, opts); return { ...a, batch, repair: null }; }
    const tagged = tagPlaces(batch.ops);
    const asSent = () => ({ ...go(batch.ops, opts), batch, repair: null });   // a refusal, as sent (no tmp tags)
    let first = go(tagged, opts), refused = false;
    if (!first.r.result.accepted) {
      const f = first.r.result.failures;
      if (!f.length || f.some(x => x.code !== 'architecture.sealed')) return { ...first, batch, repair: null };
      // a sealed room is accepted only once the repair has opened it again: else the refusal stands (a building
      // left with no way in is worse than an edit refused with its fix; walk fuzz pair-townhouse, 2026-10-21)
      first = go(tagged, { ...opts, sealed: false });
      if (!first.r.result.accepted) return asSent();
      refused = true;
    }
    let repair: Repair | null = null;
    try { repair = repairBatch(this.model, first.next, first.r.diff!, first.r.result.ids ?? {}); } catch { repair = null; }
    const finish = (a: { next: WorldModel; r: ReturnType<typeof applyBatch> }, ops: B['ops'], rep: Repair | null) => {
      const lines = rep?.lines ?? [];
      const ids = a.r.result.accepted ? a.r.result.ids : undefined; if (ids) for (const k of Object.keys(ids)) if (k.startsWith('$bs-')) delete ids[k];
      return { ...a, batch: { ...batch, ops }, repair: rep ? { ops: rep?.ops ?? [], lines, named: rep?.named ?? [], ms: rep?.ms ?? 0 } : null };
    };
    if (repair?.ops.length) {
      const ops = [...untagPlaces(tagged, repair.ops), ...repair.ops] as B['ops'];
      const again = go(ops, opts);
      if (again.r.result.accepted) return finish(again, ops, repair);
      if (refused) return asSent();
      repair = { ...repair, ops: [], lines: repair.lines.filter(l => !l.startsWith('Kept a way open')) };
      // the repaired batch did not apply (it never should): the batch as sent stands, re-applied so its hooks' results are its own
      return finish(go(batch.ops, opts), batch.ops, repair);
    }
    if (refused) return asSent();
    // nothing to repair: the first application stands; the journal keeps the ops as sent (the tags change nothing)
    return finish(first, batch.ops, repair);
  }
  undo(): Result & { reverted?: number } {
    const target = this.store.undoable();
    if (!target) return { accepted: false, failures: [{ op: -1, code: 'undo.conflict', detail: 'nothing to undo' }] };
    return this.revert(target, 'undo');
  }
  redo(): Result & { reverted?: number } {
    const target = this.store.redoable();
    if (!target) return { accepted: false, failures: [{ op: -1, code: 'undo.conflict', detail: 'nothing to redo' }] };
    return this.revert(target, 'redo');
  }
  private revert(target: EditRow, kind: 'undo' | 'redo'): Result & { reverted?: number } {
    this.builds.sweep();
    const foreign = this.foreignEdit([target]); if (foreign) return { accepted: false, failures: [foreign] };
    const field = this.callerField();
    // Undo keeps the journal's original group. Only a supplied build needs admission; ordinary undo remains legal.
    const admission = this.builds.admit(field, {}, this.caller.identity);
    if (admission.failures) return { accepted: false, failures: admission.failures };
    const tick = this.opts.tick();
    const next = this.model.fork();
    let made: string[] = [];
    const r = applyBatch(next, { ops: target.inverse }, 'god', tick, { trusted: true, uses: this.bodies?.uses, refuse: (after, diff, ops) => {
      const refused = this.bodies?.refuse?.(after, diff, ops, { undo: true }); if (refused) return refused;
      const check = this.builds.check(admission, this.model, after, diff, ops, true); if ('failure' in check) return check.failure; made = check.made; return null;
    } });
    if (!r.result.accepted) return { ...r.result, failures: r.result.failures.map((f) => ({ ...f, code: f.code.endsWith('.by-body') || f.code.startsWith('body.') || f.code.startsWith('build.') ? f.code : 'undo.conflict' })) };
    const walkouts = this.bodies?.prepare?.(this.model, next, r.diff!, target.inverse) ?? NO_WALKOUTS, moved = walkouts.moved;
    if (moved.length) r.result.moved = moved;
    r.result.warnings.push(...moved.map(movedWarning), ...walkouts.warnings);
    const at = this.now(), roots = this.builds.rootsDelta(this.model, next, r.diff!, kind, field), updates = this.builds.writes(admission, roots, r.result.seq, at, this.caller.identity, target.grp ?? undefined, true, made);
    if (updates.failures) return { accepted: false, failures: updates.failures };
    r.result.warnings.push(...roots.warnings, ...updates.warnings);
    if (updates.echo) (r.result as typeof r.result & { build: BuildEcho }).build = updates.echo;
    const refused = this.store.commit(next, this.owner, r.diff!, { seq: r.result.seq, by: 'god', at, note: `${kind} of ${target.seq}`, group: target.grp ?? undefined, ops: target.inverse, inverse: r.inverse!, kind, undoOf: target.seq, builds: updates.writes, who: this.who() });
    if (refused) return refused;
    r.result.warnings.push(...this.bodies?.apply?.(moved, { kind }) ?? []);
    Object.assign(this.model, next);
    if (updates.echo) updates.echo.rev = updates.writes.find(w => w.echo)!.rev!;
    const deltas = this.builds.accepted(updates.writes);
    this.notify(r.result.seq, r.diff!, kind, target.grp ?? undefined);
    this.publish(r.result.seq, tick, r.diff!, kind, deltas);
    this.builds.announceCommitted(updates.writes);
    return { ...r.result, reverted: target.seq };
  }

  /** A trusted edit the engine made (a Soul moved a thing, a body was born or retired): journaled by 'engine',
   *  never the god's to undo (and it does not clear the redo stack), published to viewers. Ordinary engine edits
   *  skip onCommit; an atomic painting participant also notifies context/perception before receipt observers. */
  engineAct(ops: Op[], note: string, complete?: () => void, durable?: () => void): Result {
    const tick = this.opts.tick();
    const next = this.model.fork();
    const r = applyBatch(next, { ops }, 'engine', tick, { trusted: true });
    if (!r.result.accepted) return r.result;
    const roots = this.builds.rootsDelta(this.model, next, r.diff!, 'engine'), updates = this.builds.writes({ warnings: [] }, roots, r.result.seq, this.now());
    if (updates.failures) return { accepted: false, failures: updates.failures };
    let notify: (() => void) | undefined;
    const refused = this.store.commit(next, this.owner, r.diff!, { seq: r.result.seq, by: 'engine', at: this.now(), note, ops, inverse: [], kind: 'engine', builds: updates.writes, who: { hash8: null, label: 'engine' } }, undefined,
      complete ? { apply: complete, deferNotifications: flush => { notify = flush; } } : undefined);
    if (refused) return refused;
    Object.assign(this.model, next);
    try {
      // The internal participant's witness runs after COMMIT, before any world
      // or receipt observer. Media cleanup must distinguish committed throws.
      durable?.();
      const deltas = this.builds.accepted(updates.writes);
      this.publish(r.result.seq, tick, r.diff!, 'engine', deltas);
      if (complete) this.notify(r.result.seq, r.diff!, 'edit', undefined, 'engine');
      this.builds.announceCommitted(updates.writes);
    } finally { notify?.(); }
    return r.result;
  }

  /** Shared inverse-chain preflight for atomic undo and checked build receipts. No live writes or events. */
  preflightUndo(targets: EditRow[], source = this.model, withCaller = true, releaseClaims?: string) {
    let model = source.fork(), rev = this.store.buildsRev();
    const builds = this.builds.fork(() => model, releaseClaims), entries = [];
    const field = withCaller ? this.callerField() : undefined, tick = this.opts.tick(), at = this.now();
    for (const target of targets) {
      const admission = builds.admit(field, {}, this.caller.identity);
      if (admission.failures) return { ok: false as const, failed: target.seq, failures: admission.failures };
      const next = model.fork(); let made: string[] = [];
      const r = applyBatch(next, { ops: target.inverse }, 'god', tick, { trusted: true, uses: this.bodies?.uses, refuse: (after, diff, ops) => {
        const refused = this.bodies?.refuse?.(after, diff, ops, { undo: true }); if (refused) return refused;
        const check = builds.check(admission, model, after, diff, ops, true);
        if ('failure' in check) return check.failure; made = check.made; return null;
      } });
      if (!r.result.accepted) return { ok: false as const, failed: target.seq, failures: r.result.failures.map(f => ({ ...f, code: f.code.endsWith('.by-body') || f.code.startsWith('body.') || f.code.startsWith('build.') ? f.code : 'undo.conflict' })) };
      const roots = builds.rootsDelta(model, next, r.diff!, 'undo', field);
      const updates = builds.writes(admission, roots, r.result.seq, at, this.caller.identity, target.grp ?? undefined, true, made);
      if (updates.failures) return { ok: false as const, failed: target.seq, failures: updates.failures };
      // Mirror SQL's global revision sequence so each later planned row expects the preceding write.
      for (const w of updates.writes) w.rev = ++rev;
      r.result.warnings.push(...roots.warnings, ...updates.warnings);
      entries.push({ model: next, diff: r.diff!, edit: { seq: r.result.seq, by: 'god', at, note: `undo of ${target.seq}`, group: target.grp ?? undefined, ops: target.inverse, inverse: r.inverse!, kind: 'undo' as const, undoOf: target.seq, builds: updates.writes, who: this.who() }, updates, tick });
      model = next; builds.accepted(updates.writes);
    }
    return { ok: true as const, entries, model };
  }
  checkBuild(id: string, override?: BuildBody) {
    const status = this.builds.status(id), saved = this.builds.body(id), body = saved && override ? { ...saved, ...override } : saved; if (!status || !body) return null;
    const targets = this.store.groupEditsUnder(id, false, 2_147_483_647), undo = this.preflightUndo(targets, this.model, false, override && !override.claims.some(c => c.status === 'held') ? id : undefined);
    const receipt = buildReceipt(this.model.fork(), body, targets, undo.ok ? { ok: true, baseline: undo.model } : undo, this.now());
    return { ...status, receipt };
  }
  private undoTargets(targets: EditRow[], emptyOK: boolean, releaseClaims?: string) {
    const foreign = this.foreignEdit(targets); if (foreign) return { accepted: false, reverted: [] as number[], notReverted: targets.map(e => e.seq), failures: [foreign] };
    const notReverted = targets.map(e => e.seq), preflight = this.preflightUndo(targets, this.model, true, releaseClaims);
    if (!preflight.ok) return { accepted: false, reverted: [] as number[], notReverted, failed: preflight.failed, failures: preflight.failures };
    if (!targets.length && !emptyOK) return { accepted: false, reverted: [], notReverted, failures: [{ op: -1, code: 'undo.conflict', detail: 'no edits in group' }] };
    return this.commitUndo(preflight, notReverted);
  }
  /** Commit a clean preflight in one SQL transaction, then install and notify (observers never see a half chain). */
  private commitUndo(preflight: Extract<ReturnType<GodMode['preflightUndo']>, { ok: true }>, notReverted: number[]) {
    // Clear residents once for the complete inverse chain, after every conflict check has passed.
    const combined: Diff = { upserts: [...new Set(preflight.entries.flatMap(e => e.diff.upserts.map(x => x.id)))].flatMap(id => preflight.model.entities.has(id) ? [preflight.model.entities.get(id)!] : []), removes: [...new Set(preflight.entries.flatMap(e => e.diff.removes))].filter(id => !preflight.model.entities.has(id)), defs: [], tiles: [...new Set(preflight.entries.flatMap(e => e.diff.tiles))], answers: [] };
    const walkouts = this.bodies?.prepare?.(this.model, preflight.model, combined, preflight.entries.flatMap(e => e.edit.ops)) ?? NO_WALKOUTS, moved = walkouts.moved;
    // What the planner set down in the would-be world (released by a walk-out, or kept out of a resident's hands) is
    // journaled with the chain's last entry.
    const last = preflight.entries.at(-1);
    if (last) for (const id of new Set([...moved.flatMap(m => m.released), ...walkouts.touched])) {
      const e = preflight.model.entities.get(id); if (!e || e.in.parent !== 'world') continue;
      const i = last.diff.upserts.findIndex(x => x.id === id); if (i >= 0) last.diff.upserts[i] = e; else last.diff.upserts.push(e);
    }
    const refusal = this.store.commitSequence(this.owner, preflight.entries);
    if (refusal) return { accepted: false, reverted: [] as number[], notReverted, ...(!refusal.accepted ? { failures: refusal.failures } : {}) };
    const late = this.bodies?.apply?.(moved, { kind: 'undo' }) ?? [];
    // Make the complete result visible before invoking observers; an observer cannot expose a half-reverted world.
    const frames = preflight.entries.map(entry => ({ entry, deltas: this.builds.accepted(entry.updates.writes) }));
    if (preflight.entries.length) Object.assign(this.model, preflight.model);
    const warnings: string[] = [];
    for (const { entry, deltas } of frames) {
      try { this.notify(entry.edit.seq, entry.diff, 'undo', entry.edit.group); } catch (error) { warnings.push(`Undo committed; observer failed: ${String(error).slice(0, 200)}`); }
      this.publish(entry.edit.seq, entry.tick, entry.diff, 'undo', deltas, entry.model);
      this.builds.announceCommitted(entry.updates.writes);
    }
    const echoed = [...preflight.entries].reverse().find(e => e.updates.echo), echo = echoed?.updates.echo;
    if (echo) echo.rev = echoed!.updates.writes.find(w => w.echo)!.rev!;
    warnings.unshift(...moved.map(movedWarning), ...walkouts.warnings, ...late);
    return { accepted: true, reverted: notReverted, notReverted: [] as number[], ...(moved.length ? { moved } : {}), ...(echo ? { build: echo } : {}), ...(warnings.length ? { warnings } : {}) };
  }
  undoGroup(group: string) {
    // A build owns its lead group and every claim/subgroup, including after finish.
    const build = this.store.build(group);
    // Y5 panel semantics: undoing an OPEN build's whole group keeps it open and rewinds it to the start (rewind --to 0),
    // rather than closing it as abandoned-with-undo. Undo stays reversible (redo re-adds the parts into a still-open
    // site whose roots and closure protect them; a closed record cannot be reopened), a live lead keeps its lease instead
    // of meeting build.closed mid-batch, and Abandon remains the owner's explicit end. The record moves back with the
    // world (step 1, no step history, closure re-armed), so the card never shows "towers 4/5" over an empty site, and
    // the same dependency check refuses rather than destroys later work outside the build. Finished builds are unchanged.
    if (build && (build.status === 'active' || build.status === 'paused')) {
      const r = this.rewind(group, { to: 0 });
      if (!r.ok) return { accepted: false, reverted: [] as number[], notReverted: 'edits' in r ? r.edits ?? [] : [], failures: r.failures, ...('failed' in r ? { failed: r.failed } : {}) };
      return { accepted: true, reverted: r.rewind.edits, notReverted: [] as number[], rewound: { ...r.rewind, step: { n: r.build.step.n, label: r.build.step.label } }, ...('echo' in r && r.echo ? { build: r.echo } : {}), ...('warnings' in r && r.warnings?.length ? { warnings: r.warnings } : {}) };
    }
    return build ? this.undoGroupUnder(group) : this.undoTargets(this.store.groupEdits(group), false);
  }
  /** Y5 (CE3): rewind an open build to after step k. Every live edit of the build (lead and claim subgroups) recorded
   *  after step k is reverted by one atomic R1 chain; later live edits that depend on them refuse the whole rewind.
   *  The build stays open at step k with closure re-armed; `dry` returns the same summary and changes nothing. */
  rewind(id: string, raw: unknown) {
    // Y4/Y4b: rewind is a build-wide undo. Helpers never rewind (not even through `undo --group <build>`); a co-builder
    // rewinds only builds its account leads, and only when every edit to revert is its account's own.
    if (this.caller.identity?.child) return { ok: false as const, failures: [helperFailure('helper.scope', `Helper tokens cannot rewind build ${id}; ask the lead.`)] };
    const foreignBuild = this.builds.foreignTo(this.caller.identity, id, undefined, 'rewind'); if (foreignBuild) return { ok: false as const, failures: [foreignBuild] };
    const plan = this.builds.rewindPlan(id, raw, this.store.groupEditsUnder(id, true, 2_147_483_647));
    if (!plan.ok) return plan;
    const { targets, to, force } = plan, edits = targets.map(t => t.seq), at = this.now(), from = plan.row.body.step.n;
    const foreign = this.foreignEdit(targets); if (foreign) return { ok: false as const, failures: [foreign], edits };
    const preflight = this.preflightUndo(targets, this.model, true, force ? id : undefined);
    if (!preflight.ok) return { ok: false as const, failures: preflight.failures, failed: preflight.failed, edits };
    const dependents = targets.length ? rewindDependents(id, to, this.model, preflight.model, preflight.entries, targets, this.store.liveEditsAfter(Math.min(...edits))) : [];
    if (dependents.length) return { ok: false as const, failures: dependents, edits };
    const rewind = { to, from, edits, steps: plan.steps, ...rewindChanges(this.model, preflight.model, preflight.entries) };
    const lead = this.builds.leadLive(id), warnings = lead?.live && lead.tokenHash !== this.caller.identity?.hash ? [`lead ${lead.label} is live; it should run build resume ${id} before its next edit`] : [];
    if (plan.dry || plan.unchanged) return { ok: true as const, ...(plan.dry ? { dry: true } : { replayed: true }), build: this.builds.status(id)!.build, rewind, ...(warnings.length ? { warnings } : {}) };
    const info = { from, edits: edits.length, removed: rewind.removes.count };
    if (!preflight.entries.length) {
      const saved = this.builds.saveRewound(id, to, at, this.caller.identity, force, info);
      return saved.ok ? { ok: true as const, build: saved.build, rewind, ...(warnings.length ? { warnings } : {}) } : { ...saved, edits };
    }
    // The record moves back in the chain's final build write: same SQL transaction, same revision sequence.
    const write = preflight.entries.at(-1)!.updates.writes.find(w => w.id === id)!;
    const { body, lead: byLead } = this.builds.rewoundBody(write.next, to, at, this.caller.identity, force, info);
    Object.assign(write, { next: body, body: JSON.stringify(body), kind: 'rewound' as const, ...(byLead ? { status: 'active' as const, lastAt: at } : {}) });
    const committed = this.commitUndo(preflight, edits);
    if (!committed.accepted) return { ok: false as const, failures: ('failures' in committed ? committed.failures : undefined) ?? [{ op: -1, code: 'revision.stale', detail: 'The world changed while the rewind was planned; nothing was changed.', fix: 'Retry the rewind.' }], edits };
    const echo = 'build' in committed ? committed.build : undefined;
    warnings.push(...('warnings' in committed ? committed.warnings ?? [] : []));
    return { ok: true as const, build: this.builds.status(id)!.build, rewind, ...(echo ? { echo } : {}), ...(warnings.length ? { warnings } : {}) };
  }
  /** No 200/500-entry truncation, and no prefix collision with a neighbouring build/chapter. */
  undoGroupUnder(group: string, force = false) { return this.undoTargets(this.store.groupEditsUnder(group, false, 2_147_483_647), true, force ? group : undefined); }
  sharedClockWarnings(identity?: Identity): string[] {
    return identity && this.store.builds(true).some(row => (JSON.parse(row.body) as { lead: { tokenHash: string } }).lead.tokenHash === identity.hash)
      ? ["env.shared-clock: this changes the world's clock for everyone; for a picture use look --hour"] : [];
  }
  /** Dry-run a batch and keep its would-be diff for a ghost preview (?preview=<id>), 10 minutes. */
  preview(batch: unknown) {
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { id: null, accepted: false as const, failures: [inputFailure] };
    const kit = correctKitDefines(batch); batch = kit.batch; // harvest fix kitlenient
    const parsed = previewBatchSchema.safeParse(batch);
    if (!parsed.success) return { id: null, accepted: false as const, failures: [{ op: -1, code: 'schema', field: parsed.error.issues[0]?.path.join('.'), detail: parsed.error.issues.map(i => i.message).join('; '), fix: 'Use a valid edit batch from GET /v1/god/schema.' }] };
    const gate = this.helperGate(this.callerField(parsed.data.build), parsed.data.ops); if (gate) return { id: null, accepted: false as const, failures: [gate] };
    const retirement = this.retirementFailure(parsed.data.ops); if (retirement) return { id: null, accepted: false as const, failures: [retirement] };
    const off = deferredOp(parsed.data); if (off) return { id: null, accepted: false as const, failures: [off] };
    const build = this.callerField(parsed.data.build), admission = this.builds.admit(build, parsed.data, this.caller.identity);
    if (admission.failures) return { id: null, accepted: false as const, failures: admission.failures };
    // buildsafe/1: the preview shows the batch as the commit will apply it (repairs included); its ops stay as sent
    const safe = this.applySafe({ ...parsed.data, group: admission.group } as Batch, this.opts.tick(), false, this.dryOpts(admission), []);
    const p = safe.r.result.accepted ? { ok: true as const, diff: safe.r.diff! } : { ok: false as const, failures: safe.r.result.failures };
    const id = 'pv_' + randomBytes(6).toString('hex'), viewKey = randomBytes(32).toString('base64url');
    for (const [k, v] of this.previews) if (this.now() - v.at >= 600_000) this.previews.delete(k);
    while (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value!);
    const baseEditSeq = this.model.editSeq;
    const diff: Diff = p.ok ? p.diff : { upserts: [], removes: [], defs: [], tiles: [], answers: [] };
    const { expect, subtrees } = this.captureRevisions(parsed.data, diff);
    const affected = [...new Set([...diff.upserts.map(e => e.id), ...diff.removes])].filter(id => this.model.entities.has(id));
    const expectWorldAbout = parsed.data.ops.some(op => op.op === 'world' && Object.hasOwn(op.state, 'about')) ? hashOf(this.model.state.about ?? null) : undefined;
    this.previews.set(id, { viewKeyHash: hashToken(viewKey), at: this.now(), baseEditSeq, expect, expectWorldAbout, subtrees, affected, diff, ops: batchSchema.parse(parsed.data), build: structuredClone(build), ...(!p.ok ? { failures: p.failures } : {}) });
    if (!p.ok) return { id, accepted: false as const, failures: p.failures };
    const moving = this.bodies?.prepare?.(this.model, safe.next, p.diff, safe.batch.ops as Op[], { dry: true }) ?? NO_WALKOUTS;
    const warnings = [...kit.warnings, ...(safe.repair?.lines ?? [])];
    return { id, accepted: true as const, baseEditSeq, expect, subtrees, summary: summarize(p.diff), viewKey, expiresAt: this.now() + 600_000, url: `?preview=${id}#previewKey=${viewKey}`, ...(warnings.length ? { warnings } : {}), ...(moving.moved.length ? { wouldMove: wouldMove(moving.moved) } : {}) };
  }
  getPreview(id: string) { const v = this.previews.get(id); if (!v || this.now() - v.at >= 600_000) return null; return v; }
  /** A read-only capability for exactly one retained preview; expires with its payload. */
  canViewPreview(id: string, key?: string): boolean {
    const v = this.getPreview(id);
    return !!v && !!key && key.length <= 128 && timingSafeEqual(Buffer.from(v.viewKeyHash, 'hex'), Buffer.from(hashToken(key), 'hex'));
  }
  /** Revision guards check only referenced/touched entities, never the world's global edit sequence. */
  private stale(expect: Expectations): Failure[] {
    return Object.entries(expect).flatMap(([ref, expected]) => {
      const current = this.model.get(ref);
      return current?.id === expected.id && current.v === expected.v ? [] : [{ op: -1, code: 'revision.stale', entity: expected.id, field: `expect.${ref}`, detail: `${ref} changed: expected ${expected.id} v${expected.v}; now ${current ? `${current.id} v${current.v}` : 'missing'}.`, measured: current ? { id: current.id, v: current.v } : null, limit: expected, fix: 'Read the current entity and create a fresh preview.' }];
    });
  }
  private staleSubtrees(preview: Preview | null): Failure[] {
    return Object.entries(preview?.subtrees ?? {}).flatMap(([id, expected]) => {
      const current = this.model.entities.has(id) ? this.model.subtree(id).sort() : [];
      if (hashOf(current) === hashOf(expected)) return [];
      const before = new Set(expected), after = new Set(current);
      return [{ op: -1, code: 'revision.stale', entity: id, field: `preview.subtrees.${id}`, detail: `${this.model.pathOf(id) || id}: subtree membership changed since preview.`, measured: { added: current.filter(x => !before.has(x)), removed: expected.filter(x => !after.has(x)) }, fix: 'Create a fresh preview that includes the current subtree.' }];
    });
  }
  private captureRevisions(batch: Batch, diff: Diff): { expect: Expectations; subtrees: Record<string, string[]> } {
    const expect: Expectations = {}, subtrees: Record<string, string[]> = {};
    const add = (ref: string | undefined) => {
      if (!ref || ref === 'world' || ref.startsWith('$')) return;
      const e = this.model.get(ref); if (!e) return;
      expect[ref] = { id: e.id, v: e.v };
      for (const id of this.model.ancestors(e.id)) { const parent = this.model.entities.get(id)!; expect[id] = { id, v: parent.v }; }
    };
    const constraints = (e: Pick<Entity, 'constraints'>) => { for (const c of e.constraints ?? []) if ('ref' in c) add(c.ref); };
    for (const op of batch.ops) {
      if ('id' in op) {
        add(op.id);
        const e = this.model.get(op.id); if (e) {
          constraints(e);
          if (op.op === 'clone' || op.op === 'remove' || op.op === 'move' || (op.op === 'set' && op.params)) {
            subtrees[e.id] = this.model.subtree(e.id).sort();
            for (const id of subtrees[e.id]) { add(id); constraints(this.model.entities.get(id)!); }
          }
        }
      }
      if ('in' in op) add(op.in?.parent);
      if ('constraints' in op) constraints(op);
      if (op.op === 'relate') for (const ref of [op.a, op.b]) if (ref.startsWith('thing:')) add(ref.slice(6));
      if (op.op === 'place' || op.op === 'set') {
        const e = op.op === 'set' ? this.model.get(op.id) : undefined;
        const def = this.model.resolvedDef(op.op === 'place' ? op.def : e?.def ?? '');
        for (const kind of ['params', 'state'] as const) for (const [key, value] of Object.entries(op[kind] ?? {})) if (def?.[kind][key]?.type === 'ref' && typeof value === 'string') add(value);
      }
    }
    for (const e of diff.upserts) if (this.model.entities.has(e.id)) { add(e.id); constraints(e); }
    for (const id of diff.removes) add(id);
    return { expect, subtrees };
  }
  /** The god's recent previews, newest first (the panel lists them to show as ghosts). */
  listPreviews() { const now = this.now(); return [...this.previews].filter(([, v]) => now - v.at < 600_000).sort((a, b) => b[1].at - a[1].at).slice(0, 20).map(([id, v]) => ({ id, at: v.at, accepted: !v.failures, summary: v.failures ? null : summarize(v.diff) })); }
  private notify(seq: number, diff: Diff, kind: 'edit' | 'undo' | 'redo', group?: string, by: 'god' | 'engine' = 'god') {
    for (const fn of this.commitListeners) fn({ seq, diff, kind, by, group });
  }
  private publish(seq: number, tick: number, diff: Diff, by: WorldDiffMessage['by'], builds: SiteDelta[] = [], source = this.model) {
    const referenced = new Map<string, StoredDef>();
    for (const e of diff.upserts) for (let ref: string | undefined = e.def; ref; ref = referenced.get(ref)?.extends) { const d = source.def(ref); if (!d || referenced.has(ref)) break; referenced.set(ref, d); }
    const now = this.now();
    const m: WorldDiffMessage = { type: 'edge', kind: 'world-diff', seq, tick, at: now, now, diff, by, defs: [...referenced.values()].map(publicDef), ...(builds.length ? { builds } : {}), ...(diff.tiles.length || diff.constants ? { ground: source.ground() } : {}) };
    try { this.opts.emit(m); } catch { /* viewers are best-effort */ }
    this.push('diff', m);
  }

  /** Apply a template's batches through the compiler (each atomic, journaled like a god edit). Throws on the first refusal. */
  applyGenesis(g: Genesis) {
    if (g.schema !== 'genesis/1') throw new Error('genesis: schema must be genesis/1');
    const previous = this.system; this.system = 'genesis';
    try { this.genesisBatches(g); } finally { this.system = previous; }
    this.template = g.name ?? 'custom';
  }
  private genesisBatches(g: Genesis) {
    if (g.state) { const r = this.act({ ops: [{ op: 'world', state: g.state }], group: 'genesis' }, 'genesis: state'); if (!r.accepted) throw new Error(`genesis state refused: ${JSON.stringify(r.failures)}`); }
    for (const [i, b] of g.batches.entries()) {
      const r = this.commitBatch({ ops: b.ops, group: b.group ?? 'genesis' }, `genesis ${i + 1}/${g.batches.length}${b.note ? ': ' + b.note : ''}`, true);
      if (!r.accepted) throw new Error(`genesis batch ${i + 1} (${b.note ?? ''}) refused: ${JSON.stringify(r.failures).slice(0, 600)}`);
    }
  }

  // ---------- reads ----------

  /** What a viewer (or anyone) may read: constants, state, every entity, the defs in use, the ground recipe. */
  publicSnapshot() {
    const builds = this.builds.publicList();
    const s = this.model.snapshot();
    // G2 row cache: the refs an entity's params or a def name, and a def's public form and asset hashes, are remembered per
    // object (edits replace entities, defs are stored by content): an act's mirror reads this snapshot at Eden 2026 size
    const used = new Set<string>(), pending: string[] = [];
    for (const e of s.entities) { pending.push(e.def); for (const r of memo(entityRefs, e, () => definitionRefs(e.params))) pending.push(r); }
    while (pending.length) {
      const d = this.model.def(pending.pop()!); if (!d || used.has(d.hash)) continue; used.add(d.hash);
      for (const r of memo(defRefs, d, () => definitionRefs({extends:d.extends,make:d.make,contents:d.contents,params:d.params,components:d.components}))) pending.push(r);
    }
    const defs = s.defs.filter(d => used.has(d.hash));
    // byte size of every GLB these defs load (from the asset index), so a viewer's loading bar knows the total up front
    const assetBytes: Record<string, number> = {};
    for (const d of defs) for (const sha of memo(defShas, d, () => JSON.stringify(d.make ?? null).match(/[0-9a-f]{64}/g) ?? [])) { const m = this.assets.info(sha); if (m?.ext === 'glb' && m.bytes > 0) assetBytes[sha] = this.assets.rendition(sha)?.bytes ?? m.bytes; }  // W3b: what /assets sends
    // LAYERS: wallets are private (the god's GET /v1/god/layers and each Soul's /v1/world/layers/me have them)
    const state = s.state.layers ? { ...s.state, layers: { ...s.state.layers, wallets: {} } } : s.state;
    return { contract: 'world/1', worldId: this.opts.worldId, seq: s.editSeq, counter: s.seq, seed: s.seed, tick: this.opts.tick(), constants: s.constants, state, ground: s.ground, defs: defs.map(publicDef), entities: s.entities, assetBytes, builds: builds.builds, buildsRev: builds.rev, now: builds.now };
  }
  /** Demand logging: keep only a bounded set of `find` misses in this world's DB. */
  recordFindMiss(query: string) {
    this.db.db.exec('CREATE TABLE IF NOT EXISTS god_find_misses_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, query TEXT NOT NULL, PRIMARY KEY(world_id, at, query)) WITHOUT ROWID');
    this.db.db.prepare('INSERT OR IGNORE INTO god_find_misses_v1 VALUES (?,?,?)').run(this.opts.worldId, Date.now(), query.slice(0, 400));
    this.db.db.prepare('DELETE FROM god_find_misses_v1 WHERE world_id=? AND (at,query) NOT IN (SELECT at,query FROM god_find_misses_v1 WHERE world_id=? ORDER BY at DESC,query LIMIT 1000)').run(this.opts.worldId, this.opts.worldId);
  }
  /** God sees the same plus the whole library, prayers waiting, tokens and the edit journal head. */
  godSnapshot() { const s = this.godSnapshotOf(true); return { ...s, library: s.library! }; }
  /** G2: the god snapshot without the library (the CLI mirror sends it only when its hash changed). */
  godSnapshotOf(library: boolean) {
    const pub = this.publicSnapshot();
    return { ...pub, ...(library ? { library: this.model.allDefs().map(publicDef) } : {}), libraryRef: this.model.library ? libraryRef(this.model.library) : null,
      owner: this.owner, prayers: this.store.prayers({ unanswered: true, limit: 50 }), undoable: this.store.undoable()?.seq ?? null, redoable: this.store.redoable()?.seq ?? null, tokens: this.store.tokens().length };
  }
  tileHashes(): Record<string, string> {
    const bb = this.model.ground().extent;   // GOD-ENV: the world's bounds (a rectangle once extended)
    const [a, b] = tileOf(bb[0], bb[1]), [c, d] = tileOf(bb[2] - 1e-6, bb[3] - 1e-6);
    const out: Record<string, string> = {};
    for (let tz = b; tz <= d; tz++) for (let tx = a; tx <= c; tx++) out[`${tx},${tz}`] = this.model.terrain.hash(tx, tz);
    return out;
  }
  tile(tx: number, tz: number): Float32Array | null {
    const bb = this.model.ground().extent;
    if (tx * TILE_M >= bb[2] || (tx + 1) * TILE_M <= bb[0] || tz * TILE_M >= bb[3] || (tz + 1) * TILE_M <= bb[1]) return null;
    return this.model.terrain.tile(tx, tz);
  }

  // ---------- prayers ----------

  pray(soul: { id: string; name: string }, text: string): PrayerRow {
    const recent = this.store.prayers({ soulId: soul.id, limit: 5 }).filter((p) => Date.now() - p.at < 60_000);
    if (recent.length >= 3) throw new ApiError(429, 'rate-limited', 'at most three prayers a minute');
    const p: PrayerRow = { id: 'p_' + randomBytes(5).toString('hex'), soul_id: soul.id, soul_name: soul.name, text: text.slice(0, 2000), at: Date.now(), answer: null, answered_at: null };
    this.store.addPrayer(p);
    this.push('prayer', p);
    return p;
  }
  answer(id: string, text: string): PrayerRow | null {
    const p = this.store.answerPrayer(id, text);
    if (p) this.push('prayer', p);
    return p;
  }
  prayersFor(soulId: string) { return this.store.prayers({ soulId, limit: 20 }); }

  // ---------- god stream ----------

  private push(event: GodEvent['event'], data: unknown) {
    const e: GodEvent = { id: ++this.eventSeq, event, data };
    this.ring.push(e); if (this.ring.length > 500) this.ring.shift();
    for (const s of this.subscribers) { try { s(e); } catch { /* dropped */ } }
  }
  subscribe(after: number, fn: (e: GodEvent) => void): () => void {
    this.builds.sweep();
    for (const e of this.ring) if (e.id > after) fn(e);
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
  get head(): number { return this.eventSeq; }
}

const entityRefs = new WeakMap<object, readonly string[]>(), defRefs = new WeakMap<object, readonly string[]>(), defShas = new WeakMap<object, readonly string[]>();
const publicDefs = new WeakMap<StoredDef, Omit<StoredDef, 'by'>>();
function memo<K extends object, V>(m: WeakMap<K, V>, k: K, f: () => V): V { let v = m.get(k); if (v === undefined) { v = f(); m.set(k, v); } return v; }
/** A def as anyone may read it (no author). The same object for the same stored def (the mirror reuses its hash). */
function publicDef(d: StoredDef) {
  return memo(publicDefs, d, () => { const { by: _by, ...rest } = d; return rest; });
}
function summarize(d: Diff) {
  return { upserts: d.upserts.length, removes: d.removes.length, defs: d.defs.map((x) => x.ref), tiles: d.tiles.length, world: d.world ? Object.keys(d.world) : [], answers: d.answers.length };
}
