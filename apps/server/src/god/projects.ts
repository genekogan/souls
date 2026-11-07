// PC17 (#696): a project is one site of a procedure: where it is, which real thing is each part, who has agreed to what.
// It stores no progress: `packages/engine-mars/src/project/project.ts` reads that from the world on every read. It holds no
// body and starts nothing by itself: an agreement here (`volunteer`) only answers an invitation someone else makes, through
// the ordinary `accept`, on the Soul's own receipt. Behind the shared-carry flag; off, this class is never made.
import {randomUUID} from 'node:crypto';
import {PROCEDURES, bindStock, inSite, maneuversOf, offerFor, progressOf, spotAt, standAt, type Blueprint, type Bound, type Maneuver, type ManeuverState, type Procedure, type Progress, type Site, type Stock} from '@souls/engine-mars';
import type {Db} from '../db.ts';
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {Invite, Prepared} from '../edge/ledger/together.ts';
import type {EdgeCapability, EdgeSoul} from '../edge/contract.ts';
import {resolvePlaceForVerb} from '../edge/boot/world-places.ts';

type V2 = [number, number];
type Ent = {id: string; kind?: string; tags?: string[]; pose: {p: number[]; yaw?: number}; phase?: string; reservedBy?: string; connections?: unknown[]; support?: {kind?: string}};
/** Bounded advance consent: one section, one revision, so many maneuvers, until a tick. */
type Consent = {name: string; section: string; revision: number; left: number; expiresTick: number};
export type ProjectRow = {id: string; procedure: string; site: {place: string; name: string; origin: V2; yaw: number}; bound: Bound; revision: number; changed?: string;
  organizer: {soulId: string; name: string}; invited: string[]; consents: Record<string, Consent>};
type Refusal = {code: string; reason: string};
type Tag = {kind: 'project'; op: 'organize' | 'volunteer' | 'leave' | 'revise'; procedure?: string; project?: string};
type Plans = Map<string, {label: string; steps: {verb: string; params: Record<string, unknown>}[]; seconds?: boolean}>;
export type ProjectsPort = {db: Db; host: WorldHost; edge: EdgeLedger; world(): {tick: number; entities: Record<string, Ent>}; defOf(id: string): string | undefined};

/** A Soul this near a site sees it; `here` and the menu say nothing of one farther away (unless it agreed or was asked). */
export const PROJECT_SIGHT = 30;
/** Stock this near a Soul is what brings `organize` to its menu. */
const STOCK_SIGHT = 25;
/** How far from what a part is wanted for loose stock counts. */
const STOCK_RADIUS = 14;
const CONSENT_SECONDS = 1800, CONSENT_SECONDS_MIN = 60, CONSENT_SECONDS_MAX = 7200, MANEUVERS_MAX = 64;
const READY_LISTED = 8, MISSING_LISTED = 6;

const near = (a: V2, b: V2, r: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;
const siteOf = (p: ProjectRow): Site => ({origin: p.site.origin, yaw: p.site.yaw});
const centroid = (poly: [number, number][]): V2 => {let x = 0, z = 0; for (const q of poly) {x += q[0]; z += q[1];} return [x / poly.length, z / poly.length];};

export class Projects {
  private p: ProjectsPort;
  private rows = new Map<string, ProjectRow>();
  private asking = new Set<string>();   // `<invite>:<soul>`: an accept under way
  constructor(port: ProjectsPort) {
    this.p = port;
    port.db.db.exec('CREATE TABLE IF NOT EXISTS edge_projects_v1 (world_id TEXT NOT NULL, project_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, project_id))');
    for (const r of port.db.db.prepare('SELECT body FROM edge_projects_v1 WHERE world_id=?').all(port.host.worldId) as {body: string}[]) {const row = JSON.parse(r.body) as ProjectRow; if (PROCEDURES[row.procedure]) this.rows.set(row.id, row);}
  }
  private save(row: ProjectRow) {
    this.rows.set(row.id, row);
    this.p.db.db.prepare('INSERT INTO edge_projects_v1 (world_id,project_id,body) VALUES (?,?,?) ON CONFLICT (world_id,project_id) DO UPDATE SET body=excluded.body').run(this.p.host.worldId, row.id, JSON.stringify(row));
    this.p.edge.together.touch();
  }
  private of(row: ProjectRow): {procedure: Procedure; blueprint: Blueprint} {return PROCEDURES[row.procedure]!;}
  private here(soul: EdgeSoul): V2 | null {const e = this.p.world().entities[soul.entityId]; return e ? [e.pose.p[0]!, e.pose.p[2]!] : null;}
  private knows(row: ProjectRow, soul: EdgeSoul): boolean {const at = this.here(soul); return !!row.consents[soul.soulId] || row.invited.includes(soul.soulId) || row.organizer.soulId === soul.soulId || (!!at && near(at, row.site.origin, PROJECT_SIGHT));}
  private progress(row: ProjectRow, without?: string): Progress {
    const {blueprint, procedure} = this.of(row), running = this.p.edge.together.sharedLoads(); if (without) running.delete(without);
    return progressOf(blueprint, procedure, this.p.world() as never, siteOf(row), row.bound, running, this.p.edge.together.sharedCarrying());
  }
  /** Loose things a project could still use. */
  private stock(): Stock[] {
    const taken = new Set([...this.rows.values()].flatMap(r => Object.values(r.bound))), out: Stock[] = [];
    for (const e of Object.values(this.p.world().entities)) {
      if (!e.tags?.includes('entity-world') || taken.has(e.id) || e.phase !== 'staged' || e.reservedBy || e.connections?.length || e.support?.kind !== 'ground') continue;
      const def = this.p.defOf(e.id); if (def) out.push({id: e.id, def, at: [e.pose.p[0]!, e.pose.p[2]!]});
    }
    return out;
  }
  /** Something built or standing inside the ground the site needs, other than its own parts. */
  private siteBlocker(procedure: Procedure, site: Site, own: ReadonlySet<string>, except?: string): string | null {
    for (const e of Object.values(this.p.world().entities)) if (e.tags?.includes('entity-world') && !own.has(e.id) && inSite(procedure, site, [e.pose.p[0]!, e.pose.p[2]!])) return e.id;
    for (const r of this.rows.values()) if (!except || r.id !== except) if (near(site.origin, r.site.origin, 2 * Math.hypot(...procedure.siteClear))) return `the site of ${this.of(r).procedure.label} at ${r.site.name}`;
    return null;
  }
  private named(id: string) {return this.p.edge.thingName?.(id) ?? id;}

  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans) {
    const at = this.here(soul); if (!at) return;
    const add = (c: EdgeCapability, label: string, tag: Tag) => {caps.push(c); plans.set(c.id, {label, steps: [], together: tag} as never);};
    for (const [key, {procedure, blueprint}] of Object.entries(PROCEDURES)) {
      const defs = new Set(Object.values(blueprint.parts).flatMap(x => x.def));
      if (!this.stock().some(s => defs.has(s.def) && near(s.at, at, STOCK_SIGHT))) continue;
      const label = `Organize: ${procedure.label} (at: a place; yaw: which way it faces, radians; with: Souls to tell; binds loose stock near it, moves nobody)`;
      add({id: `organize:${key}`, verb: 'organize', label, available: true, params: {at: {type: 'string', maxLength: 100, description: 'the place the site is at'}, yaw: {type: 'number', optional: true, min: -7, max: 7}, with: {type: 'string', optional: true, maxLength: 300, description: 'Souls to tell of it'}}}, label, {kind: 'project', op: 'organize', procedure: key});
    }
    for (const row of this.rows.values()) {
      if (!this.knows(row, soul)) continue;
      const {procedure} = this.of(row), mine = row.consents[soul.soulId], target = {id: row.id, kind: 'project'};
      const volunteer = `Volunteer for ${procedure.label} at ${row.site.name} (revision ${row.revision}): invitations for its ready maneuvers are accepted for you, up to a number you state, in one section, until it expires`;
      add({id: `volunteer:${row.id}`, verb: 'volunteer', label: volunteer, target, available: true, params: {revision: {type: 'integer', min: 1, description: `the project revision you agree to (now ${row.revision})`}, section: {type: 'string', optional: true, enum: procedure.sections.map(s => s.key), description: 'the section (default: the one open now)'}, maneuvers: {type: 'integer', optional: true, min: 1, max: MANEUVERS_MAX, description: 'how many maneuvers at most (default: what is left of the section)'}, expires: {type: 'integer', optional: true, min: CONSENT_SECONDS_MIN, max: CONSENT_SECONDS_MAX, default: CONSENT_SECONDS, description: 'seconds it holds'}}}, 'Volunteer', {kind: 'project', op: 'volunteer', project: row.id});
      if (mine || row.invited.includes(soul.soulId)) add({id: `leave-project:${row.id}`, verb: 'leave-project', label: `Take back your agreement to ${procedure.label} at ${row.site.name}`, target, available: true}, 'Leave the project', {kind: 'project', op: 'leave', project: row.id});
      if (row.organizer.soulId === soul.soulId) add({id: `revise-project:${row.id}`, verb: 'revise-project', label: `Revise ${procedure.label}: move the site or rebind a part (a material change asks everyone again)`, target, available: true, params: {at: {type: 'string', optional: true, maxLength: 100}, yaw: {type: 'number', optional: true, min: -7, max: 7}, part: {type: 'string', optional: true, maxLength: 60}, entity: {type: 'string', optional: true, maxLength: 80}}}, 'Revise the project', {kind: 'project', op: 'revise', project: row.id});
    }
  }

  prepare(soul: EdgeSoul, tag: Tag, params: Record<string, unknown>): Refusal | Prepared {
    if (tag.op === 'organize') return this.organize(soul, tag.procedure ?? '', params);
    const row = this.rows.get(tag.project ?? ''); if (!row) return {code: 'project.unknown', reason: 'That project is not here.'};
    return tag.op === 'volunteer' ? this.volunteer(soul, row, params) : tag.op === 'leave' ? this.leave(soul, row) : this.revise(soul, row, params);
  }
  private placeAt(soul: EdgeSoul, raw: unknown): Refusal | {place: string; name: string; origin: V2} {
    if (typeof raw !== 'string' || !raw.trim()) return {code: 'capability.params', reason: 'Choose the place the site is at (at).'};
    const dest = resolvePlaceForVerb(this.p.edge, soul, raw); if (!dest.ok) return {code: 'project.unknown-place', reason: dest.reason};
    const place = this.p.edge.places.byId.get(dest.chosen.place);
    if (!place?.polygon?.length || place.level !== 0) return {code: 'project.unknown-place', reason: 'Choose a place on level-zero ground.'};
    // a project is named to whoever sees it, so a place the world keeps secret can't be one's site
    if (this.p.edge.knowledge.isSecret(place.id)) return {code: 'project.unknown-place', reason: 'Choose a place everyone here can know of.'};
    return {place: place.id, name: place.name, origin: centroid(place.polygon as [number, number][])};
  }
  private organize(soul: EdgeSoul, key: string, params: Record<string, unknown>): Refusal | Prepared {
    const shipped = PROCEDURES[key]; if (!shipped) return {code: 'project.unknown', reason: 'That procedure is not known here.'};
    const {procedure, blueprint} = shipped, at = this.placeAt(soul, params.at); if ('code' in at) return at;
    const yaw = params.yaw === undefined ? 0 : Number(params.yaw), site: Site = {origin: at.origin, yaw};
    const told = params.with === undefined ? {ok: true as const, souls: []} : this.p.edge.together.soulsNamed(soul, params.with); if (!told.ok) return {code: told.code, reason: told.reason};
    const found = bindStock(blueprint, procedure, site, this.stock(), STOCK_RADIUS);
    if ('short' in found) return {code: 'project.stock-short', reason: `Not enough loose stock at ${at.name}: ${found.short.map(s => `${s.need} of ${s.def} wanted, ${s.have} free`).join('; ')}. Nobody was asked.`};
    const blocker = this.siteBlocker(procedure, site, new Set(Object.values(found.bound)));
    if (blocker) return {code: 'project.site-blocked', reason: `${this.named(blocker)} is on the ground the site needs at ${at.name}. Nobody was asked.`};
    const id = 'pj_' + randomUUID().slice(0, 12);
    return {steps: [], noBody: true, label: `Organize ${procedure.label} at ${at.name}`, result: {project: id, revision: 1, inspect: id}, commit: () => {
      this.save({id, procedure: key, site: {...at, yaw}, bound: found.bound, revision: 1, organizer: {soulId: soul.soulId, name: soul.name}, invited: told.souls.map(s => s.soulId), consents: {}});
      for (const s of told.souls) this.p.edge.together.tell(s.soulId, `${soul.name} organized ${procedure.label} at ${at.name}. To read it: inspect ${id}. To agree in advance: volunteer:${id} {"revision": 1}.`);
    }};
  }
  private volunteer(soul: EdgeSoul, row: ProjectRow, params: Record<string, unknown>): Refusal | Prepared {
    const {procedure} = this.of(row);
    if (!Number.isInteger(params.revision)) return {code: 'capability.params', reason: `Say which revision you agree to: {"revision": ${row.revision}}.`};
    if (params.revision !== row.revision) return {code: 'project.revision-changed', reason: `The project changed: it is now revision ${row.revision}${row.changed ? ` (${row.changed})` : ''}. Volunteer for {"revision": ${row.revision}} if you still agree.`};
    const now = this.progress(row), section = typeof params.section === 'string' ? params.section : now.section;
    if (!section) return {code: 'project.complete', reason: 'It is finished; there is nothing left to agree to.'};
    if (!procedure.sections.some(s => s.key === section)) return {code: 'capability.params', reason: `Choose a section: ${procedure.sections.map(s => s.key).join(', ')}.`};
    const left = params.maneuvers === undefined ? Math.max(1, now.maneuvers.filter(m => m.section === section && m.state !== 'done').length) : params.maneuvers as number;
    const seconds = params.expires === undefined ? CONSENT_SECONDS : params.expires as number, tick = this.p.world().tick;
    // the bound is the point of it: not left to a strict client's checks
    if (!Number.isInteger(left) || left < 1 || left > MANEUVERS_MAX) return {code: 'capability.params', reason: `maneuvers must be 1 to ${MANEUVERS_MAX}.`};
    if (!Number.isInteger(seconds) || seconds < CONSENT_SECONDS_MIN || seconds > CONSENT_SECONDS_MAX) return {code: 'capability.params', reason: `expires must be ${CONSENT_SECONDS_MIN} to ${CONSENT_SECONDS_MAX} seconds.`};
    return {steps: [], noBody: true, label: `Volunteer for ${section}`, result: {project: row.id, section, maneuvers: left, expiresInSeconds: seconds}, commit: () => {
      this.save({...row, consents: {...row.consents, [soul.soulId]: {name: soul.name, section, revision: row.revision, left, expiresTick: tick + seconds * 20}}});
    }};
  }
  private leave(soul: EdgeSoul, row: ProjectRow): Prepared {
    return {steps: [], noBody: true, label: 'Leave the project', commit: () => {const {[soul.soulId]: _, ...consents} = row.consents; this.save({...row, consents, invited: row.invited.filter(s => s !== soul.soulId)});}};
  }
  private revise(soul: EdgeSoul, row: ProjectRow, params: Record<string, unknown>): Refusal | Prepared {
    if (row.organizer.soulId !== soul.soulId) return {code: 'project.not-yours', reason: `${row.organizer.name} organized this; ask them.`};
    const {procedure, blueprint} = this.of(row), w = this.p.world(), changes: string[] = [], next: ProjectRow = {...row, site: {...row.site}, bound: {...row.bound}};
    let material = false;
    if (params.at !== undefined || params.yaw !== undefined) {
      if (Object.values(row.bound).some(id => w.entities[id]?.phase === 'installed')) return {code: 'project.site-built', reason: 'Part of it is built where it stands; the site cannot move.'};
      if (params.at !== undefined) {const at = this.placeAt(soul, params.at); if ('code' in at) return at; Object.assign(next.site, at);}
      if (params.yaw !== undefined) next.site.yaw = Number(params.yaw);
      const blocker = this.siteBlocker(procedure, siteOf(next), new Set(Object.values(row.bound)), row.id);
      if (blocker) return {code: 'project.site-blocked', reason: `${this.named(blocker)} is on the ground the site needs.`};
      material = true; changes.push(`the site moved to ${next.site.name}, facing ${next.site.yaw.toFixed(2)}`);
    }
    if (params.part !== undefined || params.entity !== undefined) {
      const part = typeof params.part === 'string' ? blueprint.parts[params.part] : undefined, entity = typeof params.entity === 'string' ? params.entity : '';
      if (!part) return {code: 'capability.params', reason: `Choose a part of the blueprint (part): ${Object.keys(blueprint.parts).join(', ')}.`};
      const def = this.p.defOf(entity); if (!def || !this.stock().some(s => s.id === entity)) return {code: 'project.part-unfit', reason: `${this.named(entity)} is not loose stock free to use.`};
      if (!part.def.includes(def)) return {code: 'project.part-unfit', reason: `${params.part} may be ${part.def.join(' or ')}, not ${def}.`};
      const was = row.bound[params.part as string];
      if (!was || this.p.defOf(was) !== def) {material = true; changes.push(`${params.part} is now ${def}`);}
      next.bound[params.part as string] = entity;
    }
    if (!changes.length && !material && params.part === undefined) return {code: 'capability.params', reason: 'Say what changes: at, yaw, or part and entity.'};
    return {steps: [], noBody: true, label: 'Revise the project', result: {project: row.id, revision: material ? row.revision + 1 : row.revision, material}, commit: () => {
      if (!material) {this.save(next); return;}
      const said = changes.join('; ');
      for (const [soulId] of Object.entries(row.consents)) this.p.edge.together.tell(soulId, `${row.organizer.name} changed ${procedure.label}: ${said}. Your agreement has lapsed; volunteer:${row.id} {"revision": ${row.revision + 1}} if you still agree.`);
      // whoever had agreed keeps the way back, however far off they are now
      this.save({...next, revision: row.revision + 1, changed: said, consents: {}, invited: [...new Set([...row.invited, ...Object.keys(row.consents)])]});
    }};
  }

  /** The load's own spot in that project, as a shared carry's destination. */
  spotFor(project: string, load: string) {
    const row = this.rows.get(project); if (!row) return null;
    const part = Object.entries(row.bound).find(([, id]) => id === load)?.[0], m = maneuversOf(this.of(row).procedure).find(x => x.part === part && x.template === 'carry' && x.spot);
    return m ? {id: '', name: `its spot at ${row.site.name}`, spot: spotAt(siteOf(row), m.spot!), project} : null;
  }
  /** Where this frame's base stands in that project. */
  baseFor(project: string, load: string): V2 | null {
    const row = this.rows.get(project), part = row && Object.entries(row.bound).find(([, id]) => id === load)?.[0];
    return row && part ? standAt(this.of(row).blueprint, siteOf(row), part) as V2 | null : null;
  }

  /** The ready maneuver of this consent's section that this invitation is, or null: a load off the plan, a maneuver not
   *  ready, another section. The world decides what is ready; the proposal must be the one the plan calls for. */
  private onPlan(row: ProjectRow, inv: Invite, section: string): Maneuver | null {
    const s = inv.shared!, part = Object.entries(row.bound).find(([, id]) => id === s.load.entity)?.[0]; if (!part) return null;
    const {procedure, blueprint} = this.of(row), m = maneuversOf(procedure).find(x => x.part === part && x.template === s.template.id); if (!m || m.section !== section) return null;
    if (this.progress(row, s.load.entity).maneuvers.find(x => x.key === m.key)?.state !== 'ready') return null;
    if (m.template === 'carry') {
      const spot = this.spotFor(row.id, s.load.entity)?.spot, went = s.destination.spot, turn = spot && went ? Math.abs(Math.sin(spot.yaw - went.yaw)) : 1;   // a load lies the same either way round
      return s.destination.project === row.id && !!spot && !!went && near([spot.x, spot.z], [went.x, went.z], 0.01) && turn < 0.01 ? m : null;
    }
    if (m.template === 'raise-hold') {const b = this.baseFor(row.id, s.load.entity); return b && s.base && near(b, s.base, 0.01) ? m : null;}
    const offer = offerFor(blueprint, this.p.world() as never, siteOf(row), row.bound, m, row.id), seats = s.beam?.seats ?? s.seat?.params.seats ?? s.seat?.params.seat;
    const hosts = (s.beam ? [s.beam.a, s.beam.b] : (s.seat?.params.beams ?? s.seat?.params.joists ?? [s.seat?.params.beam])) as string[], same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
    return offer && (offer.seats === undefined || JSON.stringify(offer.seats) === JSON.stringify(seats)) && (!offer.hosts || same(offer.hosts, hosts)) ? m : null;
  }
  /** Lapse what expired, and answer the invitations a standing agreement covers. Nothing here moves a body: `accept` is the
   *  Soul's own act, and one who is busy or far off is left with an open invitation. */
  sweep() {
    if (![...this.rows.values()].some(r => Object.keys(r.consents).length)) return;
    const tick = this.p.world().tick, together = this.p.edge.together;
    for (const row of this.rows.values()) {
      const gone = Object.entries(row.consents).filter(([, c]) => c.expiresTick <= tick);
      if (gone.length) {
        const consents = {...row.consents}; for (const [soulId] of gone) {delete consents[soulId]; together.tell(soulId, `Your agreement to ${this.of(row).procedure.label} has expired.`);}
        this.save({...row, consents});
      }
    }
    for (const inv of together.openShared()) for (const g of inv.guests) {
      const key = `${inv.id}:${g.soulId}`; if (inv.responses[g.soulId] || this.asking.has(key)) continue;
      const row = [...this.rows.values()].find(r => r.consents[g.soulId] && Object.values(r.bound).includes(inv.shared!.load.entity)), consent = row?.consents[g.soulId];
      if (!row || !consent || consent.left < 1 || consent.revision !== row.revision) continue;
      const m = this.onPlan(row, inv, consent.section), mind = this.p.host.minds.get(g.soulId); if (!m || !mind) continue;
      const soul: EdgeSoul = {soulId: mind.soulId, entityId: mind.entityId, name: mind.name, owner: mind.owner};
      if (this.p.edge.faded.has(g.soulId) || this.p.edge.openReceipts(g.soulId).length || together.sharedAcceptProblem(soul, inv)) continue;
      this.asking.add(key);
      void this.p.edge.act(soul, {capability: 'accept:' + inv.id, params: {revision: inv.shared!.revision}}).then(r => {
        const now = this.rows.get(row.id), c = now?.consents[g.soulId]; if (!r.accepted || !now || !c) return;
        const left = c.left - 1, {[g.soulId]: _, ...others} = now.consents;
        this.save({...now, consents: left > 0 ? {...now.consents, [g.soulId]: {...c, left}} : others});
        together.tell(g.soulId, `Your agreement answered ${inv.host.name}: ${inv.label} (${m.key}; ${left} left in ${c.section}).${left > 0 ? '' : ` It is spent; volunteer:${row.id} again if you want to go on.`}`);
      }).catch(e => console.error('[projects] accept', e instanceof Error ? e.message : e)).finally(() => this.asking.delete(key));
    }
  }

  /** One line per project this Soul can see or has agreed to; none otherwise. */
  hereLines(soul: EdgeSoul): string[] {
    return [...this.rows.values()].filter(r => this.knows(r, soul)).map(r => {const g = this.progress(r); return `${this.of(r).procedure.label} at ${r.site.name}: ${g.complete ? 'finished' : `${g.done} of ${g.total} maneuvers done, ${g.section ?? 'last checks'} open`} (inspect ${r.id})`;});
  }
  private readyOffers(row: ProjectRow, ready: ManeuverState[]) {
    const {blueprint} = this.of(row), w = this.p.world();
    return ready.map(m => {
      const load = row.bound[m.part] ?? '', hold = m.template === 'release' ? this.p.edge.together.holdOn(load) : null;
      const o = hold ? {offer: `stop-carry:${hold}`, params: {}} : offerFor(blueprint, w as never, siteOf(row), row.bound, m, row.id);
      return {maneuver: m.key, part: m.part, crew: m.crew, ...(o ? {offer: o.offer, params: o.params} : {offer: null, why: 'the world does not offer it here yet'})};
    });
  }
  /** `inspect <project>`: everything a Soul needs to take part, read from the world now. */
  view(id: string, soul: EdgeSoul) {
    const row = this.rows.get(id); if (!row || !this.knows(row, soul)) return null;
    const {procedure, blueprint} = this.of(row), g = this.progress(row), ready = g.maneuvers.filter(m => m.state === 'ready'), tick = this.p.world().tick;
    const missing = [...g.problems, ...g.maneuvers.filter(m => m.state === 'waiting' && m.section === g.section).map(m => `${m.key} waits for ${(m.waitsFor ?? []).join(', ')}`)];
    return {id, kind: 'project', name: `${procedure.label} at ${row.site.name}`,
      state: {blueprint: `${blueprint.id}@${blueprint.revision}`, procedure: row.procedure, revision: row.revision, ...(row.changed ? {changed: row.changed} : {}), organizer: row.organizer.name,
        section: g.section, checkpoint: g.checkpoint, maneuvers: {done: g.done, total: g.total, running: g.maneuvers.filter(m => m.state === 'running').map(m => m.key).slice(0, READY_LISTED)}, parts: g.parts, joints: g.joints,
        floor: g.floor, stairs: g.stairs, nobodyHolds: g.nobodyHolds, complete: g.complete, ready: this.readyOffers(row, ready.slice(0, READY_LISTED)), ...(ready.length > READY_LISTED ? {moreReady: ready.length - READY_LISTED} : {}),
        missing: missing.slice(0, MISSING_LISTED), ...(missing.length > MISSING_LISTED ? {moreMissing: missing.length - MISSING_LISTED} : {})},
      members: Object.entries(row.consents).map(([soulId, c]) => ({soulId, name: c.name, role: `volunteer: ${c.section}, ${c.left} left, ${Math.max(0, Math.round((c.expiresTick - tick) / 20))} s`, slot: null, accepted: true}))};
  }
}
