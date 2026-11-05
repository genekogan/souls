// PM-R057: agents name things naturally (walk:pond, walk:library, "hang out at the deck"). An exact capability id
// always wins. Otherwise an unambiguous alias is accepted (reported back as `resolved`), and anything else is
// refused capability.unknown with `did_you_mean`: the closest capabilities actually offered. Pure and deterministic.
import type {EdgeCapability} from '../contract.ts';
import {inPoly} from './places.ts';
import {SPOT_ACTIVITIES, SPOT_REACH} from './activities.ts';

export type VocabTarget = {
  /** Extra names a capability answers to: its target place's name, a Soul's name. */
  names: string[];
  /** For an object/fixture target: the place it stands in (id + name). Weaker than the target's own names. */
  around: string[];
  /** Target position [x, z], when known. */
  at: [number, number] | null;
};
export type VocabPlace = {id: string; ref?:string; name: string; center: [number, number];
  /** Declared place aliases, distinct from descriptive words and fuzzy matching. */
  aliases?: readonly string[]; genericAliases?: readonly string[];
  /** Optional richer facts (live ledger): parent id, kind, description words and whether a walk reaches it natively. */
  parent?: string | null; kind?: string; description?: string; walkable?: boolean; polygon?: [number,number][]; level?: number};
export type VocabContext = {
  caps: EdgeCapability[];
  target(cap: EdgeCapability): VocabTarget;
  /** Every known place (including ones with no capability yet), and the root's id/name tokens to ignore. */
  places: VocabPlace[];
  /** knowledge/1: the names (as tokens, space-joined) of places withheld from this Soul (secret, not yet known). Words that
   *  name one name nothing: never swapped for another place by synonym or description (a name never confirms one). */
  withheld?: string[];
  root: string[];
  me: [number, number] | null;
  /** Body yaw in world radians, facing (cos yaw, sin yaw); absence is unknown. */
  yaw?: number;
  /** Ids of the places the Soul is standing in (innermost first), when known: a stroll named for one of them is in place. */
  here?: string[];
  /** r3 quality (cases 23/29): where the nearest thing for a spot-based verb (swing, fish, cycle = a bicycle dock…) is anywhere in
   *  this world, ignoring offer reach. `null`: none exists in this world (the refusal is terminal); `undefined`: not spot-based. */
  elsewhere?: (verb: string) => {label: string; place?: string; placeId?: string; distance: number; by?: string} | null | undefined;
  /** ROUTE-RECHECK: whether a place (or a place inside it) has a spot for this verb anywhere in the world (a reading spot),
   *  offered or not; unset: unknown (every named place counts). */
  hasSpot?: (verb: string, placeId: string) => boolean;
};
export type VocabResult =
  | {kind: 'exact'; cap: EdgeCapability}
  | {kind: 'alias'; cap: EdgeCapability; note: string; params?: Record<string, unknown>;
    /** RESOLVE (2026-10-21): the target words named no offered thing by its own name, only a place whose description lists
     *  them ("go to the horse": a lawn "with ... a horse"): a host may offer a walk to the nearest thing so named instead. */
    seek?: string[];
    /** F6: the words named a place with no offer of its own (a far building's room), so the walk to the place containing
     *  it was chosen; the named place (a host may offer its own walk on demand and resolve again). */
    inside?: string}
  | {kind: 'unknown'; reason: string; didYouMean: {id: string; label: string}[]; seek?: string[];
    /** Refusal code when it is not capability.unknown (place.unreachable: a named place exists but cannot be reached). */
    code?: string; discovery?: Record<string,unknown>;
    /** place.unreachable: the named place (a host may offer a walk to it on demand and resolve again). gait.unavailable:
     *  the named place with no faster-gait offer (a host may offer that gait on demand: lane RT, run to a building's door). */
    place?: string;
    /** place.unreachable: the verb asked and every place the words name, best name first (a host may build that verb's
     *  offers for them on demand: read:<place> beyond the nearest reading places). */
    verb?: string; places?: string[]};

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'by', 'on', 'into', 'near', 'with', 'my', 'some', 'through', 'thru', 'around', 'across', 'over', 'back', 'please', 'little', 'bit', 'for', 'while', 'and', 'then', 'there']);
const VERBS: Record<string, string> = {go: 'walk', goto: 'walk', 'go-to': 'walk', 'walk-to': 'walk', visit: 'walk', 'go-inside': 'walk', 'go-into': 'walk', 'go-in': 'walk', enter: 'walk', 'step-inside': 'walk', 'step-into': 'walk', 'walk-into': 'walk', 'walk-inside': 'walk', move: 'walk', head: 'walk', travel: 'walk', 'come-back': 'walk', return: 'walk', 'go-back': 'walk', 'head-back': 'walk', 'walk-back': 'walk', running: 'run', sprint: 'run', sprinting: 'run', hurry: 'run', jogging: 'jog', 'go-over': 'walk',
  hangout: 'hang-out', 'hang-around': 'hang-out', linger: 'hang-out', 'go-near': 'go-near', approach: 'go-near', join: 'go-near',
  'sit-on': 'sit', 'sit-at': 'sit', 'sit-down': 'sit', 'take-a-seat': 'sit', 'have-a-seat': 'sit', 'take-seat': 'sit', 'be-seated': 'sit', seat: 'sit', relax: 'rest',
  stroll: 'stroll', 'take-a-walk': 'stroll', 'take-a-stroll': 'stroll', 'go-for-a-walk': 'stroll', 'go-for-a-stroll': 'stroll', 'walk-through': 'stroll', 'stroll-through': 'stroll', wander: 'stroll', ramble: 'stroll', meander: 'stroll', explore: 'stroll',
  // R2 stroll (longrun 2026-10-16): "walk around the Green field", "tour the field" are strolls, not a walk to its centre
  'walk-around': 'stroll', 'walk-about': 'stroll', 'walk-round': 'stroll', tour: 'stroll', 'take-a-tour': 'stroll',
  'warm': 'warm-by-fire', 'warm-up': 'warm-by-fire', fire: 'warm-by-fire',
  'sit-ups': 'situps', situp: 'situps', 'sit-up': 'situps', 'push-ups': 'pushups', pushup: 'pushups', 'push-up': 'pushups', 'press-ups': 'pushups', 'star-jumps': 'jumping-jacks', 'jumping-jack': 'jumping-jacks', 'do-yoga': 'yoga', boogie: 'dance', hop: 'jump',
  'lie-down': 'lie', 'lay-down': 'lie', 'have-a-nap': 'nap', 'take-a-nap': 'nap', snooze: 'nap', doze: 'nap', sleep: 'nap',
  'stand-up': 'stand', 'get-up': 'stand', rise: 'stand', stop: 'stand', greet: 'wave', 'wave-to': 'wave', 'say-hi': 'wave', 'turn-to': 'face', 'look-at': 'face',
  // together/1 (core-next4)
  'walk-with': 'follow', 'go-with': 'follow', accompany: 'follow', 'hi-five': 'high-five', highfive: 'high-five', 'high-5': 'high-five', 'shake-hands': 'handshake', 'shake-hands-with': 'handshake',
  embrace: 'hug', applaud: 'clap', 'pick-up': 'pick-up', grab: 'pick-up', drop: 'put-down', 'put-down': 'put-down', 'set-down': 'put-down', 'hand-to': 'give', 'dance-with': 'dance-with'};
/** Everyday words for places, tried only when the word itself names nothing (walk:lake → the pond, walk:forest → the woodland). */
const SYNONYMS: Record<string, string[]> = {
  woods: ['woodland', 'wood', 'forest', 'grove'], wood: ['woodland', 'woods', 'forest'], forest: ['woodland', 'woods', 'grove'], trees: ['woodland', 'grove', 'orchard'], grove: ['woodland', 'orchard'],
  campfire: ['fire'], bonfire: ['fire', 'campfire'], fireplace: ['fire'], fire: ['campfire'], firepit: ['fire'], 'fire-pit': ['fire'],
  lake: ['pond'], pool: ['pond'], water: ['pond'], swim: ['pond'],
  meadow: ['lawn', 'field', 'green', 'commons'], park: ['green', 'commons', 'lawn', 'field', 'meadow', 'gardens'], field: ['commons', 'lawn', 'green'], lawn: ['commons', 'green'], green: ['lawn', 'commons'], grass: ['lawn', 'commons', 'green'],
  square: ['plaza', 'quad', 'green', 'commons'], plaza: ['square'], centre: ['commons'], center: ['commons'], middle: ['commons'],
  market: ['kiosks', 'market'], shops: ['kiosks', 'market'], shop: ['kiosks', 'market'], stalls: ['kiosks'],
  stage: ['deck', 'bandstand'], gazebo: ['bandstand', 'pavilion'], bandstand: ['gazebo'], garden: ['gardens'], gardens: ['garden'],
  dinner: ['dining'], food: ['dining', 'kitchen'], eat: ['dining', 'kitchen'], cafe: ['tea', 'café'], tea: ['café'], playground: ['playground'],
};
/** VOCAB-MECH: everyday words for god things' actuator actions (only used when such an action is offered). */
const ACT_ALIASES: Record<string, string> = {'turn-on': 'switch-on', 'turn-off': 'switch-off', shut: 'close', 'shut-off': 'switch-off', extinguish: 'put-out', 'blow-out': 'put-out', ignite: 'light', kindle: 'light', 'light-up': 'light', 'fill-up': 'fill', drain: 'empty', wipe: 'erase', 'wipe-off': 'erase', clean: 'erase', 'take-down': 'unpin', remove: 'unpin', 'put-up': 'pin', 'sign-up': 'sign', 'cross-off': 'unsign', 'cross-out': 'unsign', 'strike-off': 'unsign', answer: 'reply', 'reply-to': 'reply', 'write-back': 'reply', claim: 'take-on', 'take-up': 'take-on', 'put-up-poster': 'pin',
  // entry 37: a radio's station (only when a change-station action is offered)
  'change-the-station': 'change-station', 'change-the-radio-station': 'change-station', 'change-radio-station': 'change-station', 'switch-the-station': 'change-station', 'switch-station': 'change-station', 'next-station': 'change-station', tune: 'change-station', retune: 'change-station', 'tune-the-radio': 'change-station'};
// L3 (server reliability): a resolve tokenises every place's and offer's names on every call; the same few thousand names
// repeat, so their tokens are kept (bounded; callers get their own copy, so an in-place sort never reaches the memo)
const TOKEN_MEMO = new Map<string, string[]>(), TOKEN_MEMO_MAX = 50_000;
export const tokens = (s: string): string[] => {
  const hit = TOKEN_MEMO.get(s); if (hit) return hit.slice();
  const t = s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
  if (TOKEN_MEMO.size >= TOKEN_MEMO_MAX) TOKEN_MEMO.clear(); TOKEN_MEMO.set(s, t); return t.slice();
};
// (L3 b: norm is asked for every offer's and place's names on every resolve; same bounded memo as tokens)
const NORM_MEMO = new Map<string, string>();
const norm = (s: string): string => {let n = NORM_MEMO.get(s); if (n === undefined) {if (NORM_MEMO.size >= TOKEN_MEMO_MAX) NORM_MEMO.clear(); n = tokens(s).join(' '); NORM_MEMO.set(s, n);} return n;};
// D3b (cloud fix-r3 basics-1 pip-010: "walk to the kitchen in eden-house-2" walked to eden-house-1/kitchen-chair-2, its
// "chair-2" holding the 2): a number names the word right before it ("house 2", "house two"). A name that numbers that word
// only otherwise ("house 1") is not what the words say; a name without such a number is unaffected.
const NUMBER_WORDS: Record<string, string> = {one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12'};
const numbered = (ts: string[]) => ts.flatMap((t, i) => i && /^\d+$/.test(t) && !/^\d+$/.test(ts[i - 1]!) ? [[ts[i - 1]!, Number(t)] as const] : []);
/** The words number a word ("house 2") that this name (its token streams) numbers only differently ("house 1"). */
export function numberConflict(words: string[], names: string[][]): boolean {
  const want = numbered(words); if (!want.length) return false;
  const have = names.flatMap(numbered);
  return want.some(([w, n]) => have.some(([x, m]) => x === w && m !== n) && !have.some(([x, m]) => x === w && m === n));
}
/** "house two" is "house 2" where a name here numbers that word (a number word after any other word stays a word). */
export function numberWords(words: string[], names: () => string[][]): string[] {
  if (!words.some((w, i) => i && NUMBER_WORDS[w])) return words;
  const counted = new Set(names().flatMap(numbered).map(([w]) => w));
  return words.map((w, i) => i && NUMBER_WORDS[w] && counted.has(words[i - 1]!) ? NUMBER_WORDS[w]! : w);
}
// A word names a token when equal, or one is the other with a short ending (garden/gardens, librar-/library); CN5: never a
// different word that merely starts with it ("watermill" is not "water").
export const tokenHit = (q: string, set: string[]) => set.some(t => t === q || (q.length >= 4 && t.length >= 4 && Math.abs(q.length - t.length) <= 3 && (t.startsWith(q) || q.startsWith(t))));
const bigrams = (s: string) => {const x = s.replace(/\s+/g, ''), out: string[] = []; for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out;};
function dice(a: string, b: string) {const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return 0; const m = new Map<string, number>(); for (const g of A) m.set(g, (m.get(g) ?? 0) + 1); let hit = 0; for (const g of B) {const n = m.get(g) ?? 0; if (n) {hit++; m.set(g, n - 1);}} return 2 * hit / (A.length + B.length);}
const dist = (a: [number, number] | null, b: [number, number] | null) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;

/** Whole-sentence intents (activities/1): "find somewhere to read a book" → read, "lie down on the grass" → lie. The first
 *  matching rule whose verb is offered wins; its words are removed from the target text. */
const INTENTS: [RegExp, string, ('keep')?][] = [
  [/\b(?:post|send|mail)\b.*\b(?:letter|card|postcard)\b|\bpost (?:a |the )?letter\b|\bmailbox\b/, 'post-letter'],
  // CN5: computers, the gym, park games, stages and audiences
  [/\b(?:computer|computers|laptop|pc|online|internet|e-?mails?|browse the web|surf the web|typing)\b/, 'use-computer'],
  [/\bbench[- ]?press(?:es|ing)?\b/, 'bench-press'], [/\b(?:pull|chin)[- ]?ups?\b/, 'pull-ups'], [/\b(?:tricep )?dips\b|\bdip bars?\b/, 'dips'],
  [/\b(?:lift(?:ing)? weights|weight ?lifting|weights|dumbbells?|bicep curls?|curls|free weights|pump(?:ing)? iron)\b/, 'lift-weights'],
  [/\b(?:p[eé]tanque|boules|bocce)\b/, 'play-petanque'], [/\bfrisbee\b/, 'play-frisbee'], [/\b(?:beach )?volley ?ball\b/, 'play-volleyball'],
  // R5 group life: storytelling, a book club, cooking together, dancing on the bandstand, a yoga class, giving a concert
  [/\b(?:tell|telling|share|sharing) (?:a |some |the )?(?:stor(?:y|ies)|tales?)\b|\bstory ?tell\w*/, 'tell-story'],
  [/\b(?:listen to|hear|join) (?:a |the |some )?(?:story ?(?:circle|time)|storyteller|stor(?:y|ies))\b|\bstory ?(?:circle|time)\b/, 'hear-story'],
  [/\bbook ?club\b|\bread(?:ing)? (?:together|with (?:others|friends|the group))\b/, 'book-club'],
  [/\bcook(?:ing)? (?:together|with (?:others|friends|everyone|the group))\b|\b(?:communal|group) cooking\b|\bcooking (?:class|club)\b/, 'cook-together'],
  [/\bbandstand\b.*\bdanc\w*|\bdanc\w*\b.*\bbandstand\b|\b(?:barn|social|square|line|ballroom) danc\w*|\bdance (?:party|together)\b/, 'social-dance'],
  [/\byoga (?:class|session|together|group)\b|\b(?:lead|teach|join|take) (?:a |the )?yoga(?: (?:class|session|group))?\b/, 'yoga-class'],
  [/\b(?:give|play|perform|put on|hold) (?:a |the )?(?:concert|gig)\b|\bjam session\b|\bperform (?:on|at) (?:the )?stage\b/, 'play-music'],
  [/\b(?:sing|singing|karaoke|open mic|microphone)\b/, 'sing'],
  [/\b(?:listen|listening|concert|audience|watch (?:the )?(?:show|band|performance|concert|musicians?))\b/, 'listen'],
  [/\b(?:drums?|drum kit|guitar|bass|violin|viola|cello|keyboard|keys)\b/, 'play-music', 'keep'],
  [/\bjumping[- ]?jacks?\b|\bstar[- ]?jumps?\b/, 'jumping-jacks'], [/\bpush[- ]?ups?\b|\bpress[- ]?ups?\b/, 'pushups'], [/\bsit[- ]?ups?\b|\bcrunches\b/, 'situps'],
  [/\bfeed(?:ing)? (?:the |some |a few )?(?:koi|fish|carp)\b|\b(?:throw|toss|scatter) (?:some |the )?(?:bread|crumbs|food) (?:to|for|into|in) (?:the )?(?:koi|fish|pond)\b|\bfeed (?:the )?pond\b/, 'feed'],
  [/\b(?:fishing|angling)\b|\b(?:go|to|let'?s) fish\b|^fish\b|\bcast (?:a |my |the )?(?:line|rod)\b|\bcatch (?:a |some )?fish\b/, 'fish'],
  // leisure: the playground, the hammocks, a picnic blanket, the night sky ("swing by" is a visit, not a swing; a picnic table is for eating)
  [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/, 'seesaw'], [/\b(?:swing|swings|swinging)\b(?!\s+by\b)/, 'swing'], [/\bhammocks?\b/, 'hammock'],
  [/\bpicnic(?:king)?\b(?!\s+tables?\b)/, 'picnic'],
  [/\bstar[- ]?gaz\w*|\b(?:watch|look at|see|count) (?:the )?(?:stars|night sky)\b/, 'stargaze'],
  [/^(?:please\s+)?garden\b|\b(?:gardening|weed(?:ing)?|(?:tend|tending|water|watering|plant|planting) (?:the |some |my )?(?:garden )?(?:beds?|seeds?|flowers?|vegetables?|plots?|plants?|crops?))\b/, 'garden'],
  [/\byoga\b/, 'yoga'], [/\bstretch(?:es|ing)?\b/, 'stretch'], [/\bdanc(?:e|es|ing)\b|\bboogie\b/, 'dance'], [/\bjump(?:s|ing)?\b|\bhop\b/, 'jump'],
  [/\b(?:read|reading|reads)\b/, 'read'], [/\b(?:write|writing)\b/, 'write'],
  [/\bpiano\b/, 'play-piano'], [/\b(?:paint|painting|easel)\b/, 'paint'], [/\b(?:cook|cooking|bake|baking)\b/, 'cook'],
  [/\b(?:music|instrument|sing|singing)\b/, 'play-music'], [/\b(?:craft|crafts|carve|carving|woodwork|pottery|weave|weaving|whittle)\b/, 'craft'],
  [/\b(?:game|games|cards|board game|play a game)\b/, 'play-game'],
  [/\b(?:eat|eating|meal|lunch|dinner|breakfast|snack)\b/, 'eat'], [/\b(?:drink|coffee|tea)\b/, 'drink'],
  [/\b(?:nap|snooze|doze|sleep|sleeping|siesta|rest my eyes)\b/, 'nap'], [/\b(?:lie|lay|lying|laying)\b/, 'lie'],
  [/\bsit\b.*\b(?:ground|grass|floor|lawn|sand)\b/, 'sit-ground'], [/\b(?:sit|seat|seated)\b/, 'sit'],
  [/\b(?:stroll|wander|ramble|meander|explore|tour|take a walk|go for a walk|walk (?:around|through|about))\b/, 'stroll'],
  [/\b(?:stand up|get up|stand)\b/, 'stand'], [/\b(?:swim|dip|bathe)\b/, 'swim'], [/\b(?:warm up|warm)\b/, 'warm-by-fire'],
  [/\b(?:go|walk|head|come|return|visit|travel)\b/, 'walk'],
];
/** RESOLVE: "find X", "look for X", "search for X" (X is then walked to; see resolveWords). */
const FIND = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:(?:go|come|try to|try and)\s+)?(?:find|look for|look around for|search for|hunt for|seek out|locate)\s+(?:me\s+)?(.+?)[.!?]*$/i;
/** Words that only carry the intent, never the target ("find somewhere quiet to read a book" names no place). */
const FILLER = new Set(['find', 'somewhere', 'someplace', 'place', 'spot', 'quiet', 'nice', 'good', 'cozy', 'cosy', 'comfy', 'book', 'books', 'novel', 'down', 'up', 'read', 'reading',
  'nap', 'snooze', 'doze', 'sleep', 'sleeping', 'siesta', 'lie', 'lay', 'lying', 'laying', 'sit', 'seat', 'seated', 'piano', 'play', 'paint', 'painting', 'easel', 'cook', 'cooking', 'bake',
  'music', 'instrument', 'craft', 'crafts', 'game', 'games', 'cards', 'eat', 'meal', 'lunch', 'dinner', 'breakfast', 'snack', 'drink', 'coffee', 'tea', 'post', 'send', 'mail',
  'letter', 'card', 'write', 'writing', 'stroll', 'wander', 'walk', 'tour', 'explore', 'go', 'take', 'have', 'let', 'lets', 'me', 'i', 'want', 'like', 'would', 'could', 'can', 'you', 'we', 'he', 'she', 'they',
  'him', 'her', 'them', 'just', 'now', 'something', 'thing', 'do', 'get', 'grab', 'head', 'come', 'return', 'visit', 'travel', 'around', 'about', 'quick', 'short', 'long', 'while',
  'use', 'using', 'check', 'work', 'join', 'game', 'round', 'throw', 'toss', 'catch', 'sing', 'song', 'songs', 'listen', 'watch', 'show', 'set', 'reps', 'exercise', 'exercises', 'workout', 'concert', 'performance', 'audience', 'band']);

/** "go for a X", "take a X", "have a X": X decides the verb (a swim is a swim, a balloon ride is the ride, never a stroll). */
const GO_FOR = /^(?:let'?s\s+|i\s+want\s+to\s+|please\s+)?(?:go|going|take|have|do|try)\s+(?:for\s+|on\s+|in\s+)?(?:a|an|some|the)\s+(.+)$/i;
const GO_FOR_X: [RegExp, string][] = [[/^(?:sit[- ]?ups?|crunches)\b/, 'situps'], [/^(?:push[- ]?ups?|press[- ]?ups?)\b/, 'pushups'], [/^(?:jumping[- ]?jacks?|star[- ]?jumps?)\b/, 'jumping-jacks'], [/^yoga\b/, 'yoga'], [/^(?:swim|dip|bathe|paddle)\b/, 'swim'], [/^(?:walk|stroll|wander|ramble|tour|wee walk|little walk|short walk|long walk)\b/, 'stroll'], [/^(?:nap|snooze|doze|sleep|siesta|lie[- ]down)\b/, 'nap'],
  [/^(?:seat|sit)\b/, 'sit'], [/^(?:dance|boogie)\b/, 'dance'], [/^(?:stretch)\b/, 'stretch'], [/^(?:read|book)\b/, 'read'], [/^(?:look|wander around)\b/, 'stroll'], [/^(?:rest|break|breather)\b/, 'rest'], [/^(?:drink|coffee|tea|cuppa)\b/, 'drink'], [/^(?:meal|bite|snack|lunch|dinner|breakfast)\b/, 'eat']];
/** R5 group activities whose phrase decides even after a plain verb ("dance on the bandstand" is the bandstand dance). */
const GROUP_VERBS = new Set(['tell-story', 'hear-story', 'book-club', 'cook-together', 'social-dance', 'yoga-class']);
/** leisure: a posture or play word followed by a playground or lawn thing (the thing decides what is done there). */
const LEISURE_LEAD = /^(?:please\s+)?(?:sit|lie|lay|rest|relax|nap|snooze|doze|play|ride|get|hop|go|have a go)\b/i;
const LEISURE_OBJECTS: [RegExp, string][] = [[/\bhammocks?\b/, 'hammock'], [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/, 'seesaw'], [/\bswings?\b(?!\s+by\b)/, 'swing'], [/\bpicnic (?:blanket|rug)\b/, 'picnic']];
/** Rides: the balloon (and any later carrier) is an object you join. */
export const RIDE_WORDS = /\b(?:ride|rides|balloon|fly|flight|flying|go up|up in the air|hot[- ]air|row|rowing|punt|boat|boating)\b/i;
/** Things bodies cannot do yet: refused honestly (never resolved to something else). */
export const NOT_YET: [RegExp, string, string[], string?][] = [
  [/\b(?:kiss|kisses|kissing|snog)\b/i, 'Kissing is not a gesture here; hug, shake hands, high-five, bow or wave instead (hugs and handshakes ask the other Soul first).', ['hug', 'handshake', 'high-five', 'wave']],
  [/\b(?:climb|jump over|vault|cartwheel|somersault|backflip)\b/i, 'Climbing and acrobatics are not possible yet.', ['jump', 'stretch', 'dance']],
  // CN5 (acceptance: "go fishing" walked to the playground): things nobody can do here yet are refused, never swapped. The
  // optional fourth item is the verb that, when the world offers it, makes the activity real (then it is not refused).
  [/\b(?:fishing|go fish|to fish|catch (?:a |some )?fish)\b/i, 'There is nowhere to fish from here right now: fishing is offered only at a marked pond bank.', ['swim', 'stroll', 'sit'], 'fish'],
  [/\b(?:sailing|canoeing|kayaking)\b/i, 'Sailing, canoes and kayaks are not possible yet; an offered punt can be rowed.', ['swim', 'stroll', 'sit']],
  [/\b(?:swinging|on the swings?|go on (?:a |the )?swing)\b/i, 'There is no swing offered here right now.', ['stroll', 'sit', 'dance'], 'swing'],
  [/\bsee[- ]?saw\b|\bteeter[- ]?totter\b/i, 'There is no see-saw offered here right now.', ['stroll', 'sit'], 'seesaw'],
  [/\bhammocks?\b/i, 'There is no hammock offered here right now.', ['lie', 'nap', 'sit'], 'hammock'],
  [/\b(?:ferris wheel|big wheel|carousel|merry[- ]go[- ]round)\b/i, 'The Ferris wheel and the carousel at the seaside resort are scenery for now: the resort cannot be walked to yet, so they cannot be ridden. Nothing else was chosen.', ['swing', 'seesaw', 'stroll'], 'ride-attraction'],
  [/\b(?:have|having|go for|go on|for) (?:a |some )?picnic\b|^picnic\b|\bpicnicking\b/i, 'There is no picnic blanket laid out here right now; eat at a table or sit on the grass instead.', ['eat', 'sit-ground', 'sit'], 'picnic'],
  [/\bstar[- ]?gaz\w*|\b(?:watch|look at|count) (?:the )?stars\b/i, 'Stargazing needs open grass and a world with nights.', ['lie', 'sit-ground'], 'stargaze'],
  [/\bfeed(?:ing)? (?:the |some )?(?:ducks?|geese|goose|swans?|birds?|pigeons?|gulls?)\b/i, 'There are no ducks or birds to feed here; the ponds have koi, which can be fed from a marked bank.', ['feed', 'stroll', 'sit'], 'feed-birds'],
  [/\b(?:feed(?:ing)? (?:the |some )?(?:fish|koi|carp))\b/i, 'There is nowhere to feed the koi from here right now: it is offered at a marked pond bank.', ['stroll', 'sit'], 'feed'],
  [/\b(?:skateboard\w*|cycling|ride (?:a |my |the )?(?:bike|bicycle))\b/i, 'That is not possible here yet.', ['stroll', 'sit', 'dance'], 'cycle'],
];
/** Quality cases 22/29/30: a NOT_YET refusal is terminal. Agents walked off to look for swings or ducks after it. */
export const NOWHERE = ' Nothing like it exists anywhere in this world, so walking somewhere else to look for it will not help: tell your owner plainly it is not possible here (the suggestions are other things to do).';
/** CN5: "go <doing>" names an activity, not a place: these mean something here; any other is refused (never a walk). */
const GO_ING: Record<string, string> = {swimming: 'swim', walking: 'stroll', fishing: 'fish', gardening: 'garden', weeding: 'garden', swinging: 'swing', stargazing: 'stargaze', picnicking: 'picnic', strolling: 'stroll', hiking: 'stroll', exploring: 'stroll', wandering: 'stroll', rambling: 'stroll', sightseeing: 'stroll',
  dancing: 'dance', reading: 'read', painting: 'paint', napping: 'nap', sitting: 'sit', exercising: 'stretch', stretching: 'stretch', singing: 'sing', shopping: 'walk market'};

/** srv-act-words: the plain words an act may resolve on a focused build (`EdgeLedger.wordsFocused`): one walk to a named
 *  place, standing up, a wave, a wander. (Rotation 2: sits and dances went back to the words menu. Their launch admission
 *  reads the engine's paged clearance, whose answer near a body depends on the windows the last menu queries opened: after
 *  a focused build 4 of 15 dances were refused pose.no-room that the whole menu's build admitted, the world identical;
 *  oracle --gap 20, k=230.) Other shapes read offers beyond their own verbs
 *  (chains, finding, gaits, bikes, rides and steering, "go <doing>", behind / nearest, floors, the refusal table, social
 *  phrasing) and resolve on the whole menu, as before. */
const WORDS_FOCUS_SHAPE = /^(?:please\s+)?(?:(?:go|walk|head)(?:\s+over|\s+back)?\s+(?:to|into|inside|towards?)\s+[a-z0-9' -]+|stand(?:\s+up)?|get\s+up|wave|wander)[.!]?$/;
const WORDS_FOCUS_NOT = /\b(?:then|and|jog\w*|run|running|sprint\w*|hurry|cycl\w*|bik\w*|bicycl\w*|board\w*|embark|aboard|row\w*|boat\w*|ride|rides|riding|fly\w*|flight|leave|disembark|alight|start|depart|carousel|merry|ferris|balloon|punt|basket|behind|nearest|closest|nearby|anywhere|somewhere|upstairs|downstairs|floor|storey|story|top|level|find|seek|search|look)\b/;
/** srv-act-words: the verbs plain words of a focus shape can read while they resolve (resolveWords), or null (the whole
 *  menu): every verb parseCapability tests for these words (leading-word candidates and their VERBS synonyms, the INTENTS
 *  and leisure verbs that match, ACT_ALIASES both ways), the offers the sit / stroll rules read (rest, sit-ground,
 *  warm-by-fire; wander and stroll) and object offers (a god-built thing's
 *  actions are verbs too). The offers of these verbs are the whole menu's (bindFocus), so the words resolve the same. */
export function wordsFocusVerbsV1(input: string): Set<string> | null {
  const raw = input.trim(), text = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!raw || raw.length > 160 || raw.includes(':') || !WORDS_FOCUS_SHAPE.test(text) || WORDS_FOCUS_NOT.test(text) || GO_FOR.test(raw) || FIND.test(raw)) return null;
  if (NOT_YET.some(([re]) => re.test(text))) return null;
  const out = new Set<string>(['object']), words = raw.split(/\s+/);
  for (let n = 1; n <= Math.min(4, words.length); n++) {const k = words.slice(0, n).join('-').toLowerCase().trim().replace(/[\s_]+/g, '-'); out.add(k); if (VERBS[k]) out.add(VERBS[k]);}
  for (const [re, v] of INTENTS) if (re.test(text)) out.add(v);
  if (LEISURE_LEAD.test(raw)) for (const [re, v] of LEISURE_OBJECTS) if (re.test(text)) out.add(v);
  for (const v of [...out]) {if (ACT_ALIASES[v]) out.add(ACT_ALIASES[v]); for (const [k, a] of Object.entries(ACT_ALIASES)) if (a === v) out.add(k);}
  if (out.has('stroll') || out.has('wander')) {out.add('stroll'); out.add('wander');}
  if (out.has('sit')) {out.add('rest'); out.add('sit-ground'); out.add('warm-by-fire');}
  if (/\b(?:fire|campfire|warm)\b/.test(text)) out.add('warm-by-fire');
  return out;
}
/** Split "verb:target" (or free text such as "hang out at the deck") into a canonical verb and the target words. */
export function parseCapability(input: string, verbs: Set<string>): {verb: string; rest: string} {
  const raw = input.trim(), i = raw.indexOf(':');
  const canon = (v: string) => {const k = v.toLowerCase().trim().replace(/[\s_]+/g, '-'); return verbs.has(k) ? k : VERBS[k] ?? k;};
  if (i >= 0) return {verb: canon(raw.slice(0, i)), rest: raw.slice(i + 1)};
  const gf = GO_FOR.exec(raw);
  if (gf) {const x = gf[1].toLowerCase().trim(); for (const [re, v] of GO_FOR_X) if (re.test(x)) {if (verbs.has(v) || v === 'stroll') return {verb: v, rest: x.replace(re, ' ').trim()}; break;}}
  const words = raw.split(/\s+/);
  // leisure: "sit on the swing", "lie in the hammock", "play on the see-saw": the named thing decides, not the posture word
  // R5: "dance on the bandstand", "yoga class", "read with friends": the group phrase wins over its leading verb
  {const low = raw.toLowerCase(); for (const [re, v] of INTENTS) if (GROUP_VERBS.has(v) && verbs.has(v) && re.test(low)) return {verb: v, rest: low.replace(re, ' ').split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};}
  if (LEISURE_LEAD.test(raw)) for (const [re, v] of LEISURE_OBJECTS) if (verbs.has(v) && re.test(raw.toLowerCase())) return {verb: v, rest: raw.toLowerCase().replace(re, ' ').replace(LEISURE_LEAD, ' ').split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const v = canon(words.slice(0, n).join('-')), rest = words.slice(n).join(' ');
    if (!verbs.has(v)) continue;
    // "sit on the grass" is sitting on the ground, not on a seat called grass.
    if (v === 'sit' && verbs.has('sit-ground') && /\b(?:ground|grass|floor|lawn|sand)\b/i.test(rest)) return {verb: 'sit-ground', rest: ''};
    return {verb: v, rest};
  }
  // A whole sentence: the first offered intent, its words removed from the target text.
  const text = raw.toLowerCase();
  for (const [re, verb, keep] of INTENTS) if (verbs.has(verb) && re.test(text)) return {verb, rest: (keep ? text : text.replace(re, ' ')).split(/[^a-z0-9.-]+/).filter(w => w && !FILLER.has(w) && !STOP.has(w)).join(' ')};
  return {verb: canon(words[0] ?? ''), rest: words.slice(1).join(' ')};
}

/** Verbs whose target is a place (natural place names and the places map apply). */
const PLACE_VERBS = new Set(['walk', 'jog', 'run', 'jog-around', 'run-around', 'cycle', 'cycle-around', 'hang-out', 'gather', 'stroll', 'read']);
/** Place verbs done at a spot in the place (a reading spot), not on its ground: the best-named place first. */
const SPOT_PLACE_VERBS = new Set(['read']);
const GAIT_VERBS = new Set(['jog', 'run', 'jog-around', 'run-around', 'cycle', 'cycle-around']);

export function resolveCapability(input: string, ctx: VocabContext): VocabResult {
  const r = resolveWords(input, ctx);
  // R2 stroll (longrun 2026-10-16: nobody moved for 70 minutes): a stroll named for the place the Soul is already in, whose
  // own loop is closed right now (a construction site covers one of its stops), is a wander right where it stands; never a
  // refusal that leaves it standing. An exact id, a different place and a via chain keep their own answer.
  if (r.kind !== 'alias' || r.params || r.cap.available || r.cap.verb !== 'stroll' || r.cap.target?.kind !== 'place' || !ctx.here?.includes(r.cap.target.id)) return r;
  const wander = ctx.caps.find(c => c.id === 'wander:here' && c.available); if (!wander) return r;
  const name = ctx.places.find(p => p.id === r.cap.target!.id)?.name ?? r.cap.target.id;
  return {kind: 'alias', cap: wander, note: `${input}: you are in ${name} already and its loop (${r.cap.id}) is closed right now (${(r.cap.blocked?.reason ?? 'unavailable').replace(/[.\s]+$/, '')}); wandering around where you are instead (${wander.id}).`};
}
// VEHICLE-STEER (Gene 2026-10-23, #12): a seated rider's words to its ride. Only when a steer is offered to this Soul now
// (it is aboard); otherwise the words fall through ("fly the balloon" from the ground is still the join).
const STEER_DIRS = 'north|northeast|north-east|east|southeast|south-east|south|southwest|south-west|west|northwest|north-west|n|ne|e|se|s|sw|w|nw';
const STEER_VEHICLE = String.raw`(?:(?:the|our|this|my)\s+)?(?:hot[- ]air\s+|red\s+|rowing\s+)?(?:balloon|punt|boat|basket|ride|it|us)`;
const STEER_GO = String.raw`(?:fly|flying|steer|drive|sail|float|row|rowing|pilot|navigate|head|take|move|go|bring)`;
function steerWords(input: string, ctx: VocabContext): VocabResult | null {
  const caps = ctx.caps.filter(c => c.verb === 'object' && c.action === 'steer' && c.available); if (!caps.length) return null;
  const t = input.toLowerCase().replace(/^(?:please\s+|let'?s\s+|now\s+|ok(?:ay)?,?\s+)+/, '').replace(/[.!?\s]+$/, '').trim(); if (!t || t.includes(':')) return null;
  const water = /\b(?:row|rowing|punt|boat|ashore|bank)\b/.test(t), air = /\b(?:fly|flying|balloon|basket|hover)\b/.test(t);
  const cap = caps.find(c => water ? /punt|boat|rowing/i.test(c.id) : air ? /balloon/i.test(c.id) : true) ?? caps[0];
  const say = (params: Record<string, unknown>, what: string): VocabResult => ({kind: 'alias', cap, params, note: `${input} is ${cap.id} (${what}).`});
  if (new RegExp(String.raw`^(?:land|touch\s+down|set\s+(?:${STEER_VEHICLE}\s+)?down|bring\s+${STEER_VEHICLE}\s+down|go\s+down|descend|come\s+down|row\s+(?:${STEER_VEHICLE}\s+)?(?:back|ashore|home)|go\s+back\s+to\s+(?:the\s+|its\s+)?(?:bank|shore))(?:\s+${STEER_VEHICLE})?(?:\s+(?:here|now|please))?$`).test(t)) return say({land: true}, 'land');
  if (new RegExp(String.raw`^(?:(?:stop|halt|hold)\s+${STEER_VEHICLE}(?:\s+(?:here|still|there))?|(?:stop|hold)\s+(?:here|still)|hover(?:\s+here)?|hold\s+position)$`).test(t)) return say({stop: true}, 'stop and hold');
  const dir = new RegExp(String.raw`^${STEER_GO}(?:\s+${STEER_VEHICLE})?\s+(?:(\d+)\s*(?:m|metres|meters)\s+)?(${STEER_DIRS})(?:wards?)?(?:\s+(?:for\s+)?(\d+)\s*(?:m|metres|meters))?(\s*(?:,\s*)?(?:and|then|,)\s+land(?:\s+there)?)?$`).exec(t);
  if (dir) return say({direction: dir[2].replace('-', ''), distance: Math.min(1000, Math.max(5, Number(dir[1] ?? dir[3] ?? 100))), ...(dir[4] ? {land: true} : {})}, `steer ${dir[2]}`);
  const to = new RegExp(String.raw`^${STEER_GO}(?:\s+${STEER_VEHICLE})?\s+(?:over\s+)?(?:to(?:wards?)?|toward|over)\s+(.+?)(\s*(?:,\s*)?(?:and|then|,)\s+(?:then\s+)?land(?:\s+(?:there|it))?)?$`).exec(t);
  // "go to X" / "take me to X" without a vehicle word stays a walk (refused aloft with its own reason)
  if (to && (/^(?:fly|flying|steer|drive|sail|float|row|rowing|pilot|navigate)\b/.test(t) || new RegExp(String.raw`^\w+\s+${STEER_VEHICLE}\b`).test(t))) {
    const place = to[1].replace(/^(?:the\s+)/, '').trim(); if (place) return say({to: place, ...(to[2] ? {land: true} : {})}, `steer toward ${place}${to[2] ? ', land there' : ''}`);
  }
  return null;
}
// #439 W093: a checkers move named by its two squares ("move c3 to d4", "jump from c3 to e5", "c3 to d4", "c3-d4") is the
// move with those squares on the board where it can be played. Only while a checkers move is offered; the board's rules judge
// it. A Soul with a game in progress plays it there: its other boards refuse a second game (`game.elsewhere`), so its own
// board is the one available, or, out of turn, the one that says whose turn it is (`game.turn`). With no game in progress and
// several boards that would take the move, the words name no board: they are refused with the choice, never a new game on
// the nearest one.
const CHECKERS_MOVE = /^(?:(?:please\s+)?(?:move|jump|play|take|capture|go)\s+)?(?:(?:the|my)\s+(?:piece|man|king|checker)\s+)?(?:(?:on|at|from)\s+)?([a-h][1-8])\s*(?:-|x|to|onto|over\s+to|and\s+jump\s+to|jumping\s+to|\s)\s*([a-h][1-8])(?:\s+on\s+the\s+(?:checkers\s+|game\s+)?board)?$/;
function checkersWords(input: string, ctx: VocabContext): VocabResult | null {
  const caps = ctx.caps.filter(c => c.verb === 'object' && c.action === 'move' && /checkers/i.test(c.label)); if (!caps.length) return null;
  const m = CHECKERS_MOVE.exec(input.toLowerCase().replace(/[.!?\s]+$/, '').trim()); if (!m) return null;
  const open = caps.filter(c => c.available);
  if (open.length > 1) {
    const named = [...open].sort((a, b) => dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id));
    const which = named.map(c => /\(([^()]*)\)$/.exec(c.label)?.[1] ?? c.id);
    return {kind: 'unknown', code: 'game.which-board', reason: `${named.length} checkers boards here would start a game with ${m[1]} to ${m[2]}: ${which.join(', ')}. Say which: act on that board's move with from ${m[1]} and to ${m[2]}.`, didYouMean: named.map(c => ({id: c.id, label: c.label}))};
  }
  const rank = (c: EdgeCapability) => (c.available ? 0 : c.blocked?.code === 'game.turn' ? 1 : c.blocked?.code === 'game.elsewhere' ? 3 : 2);
  const cap = [...caps].sort((a, b) => rank(a) - rank(b) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0]!;
  return {kind: 'alias', cap, params: {from: m[1], to: m[2]}, note: `${input} is ${cap.id} (${cap.label}: ${m[1]} to ${m[2]}).`};
}
// Soul Actions entry 42: "put the bowl in the drawer" is put-in:<container>; "take the bowl out of the chest" is that
// bowl's take from inside it. A shut container's contents are never offered: its words name its open offer instead.
const STOW = /^(?:please\s+)?(?:put|place|stow|store|keep|leave|set|pop|tuck|slip)\s+(?:away\s+)?(.+?)\s+(?:in|into|inside|in\s+to|away\s+in)\s+(.+?)[.!]?$/;
const UNSTOW = /^(?:please\s+)?(?:take|get|fetch|remove|grab|lift|pull|pick\s+up|pick)\s+(.+?)\s+(?:out\s+of|out\s+from|from\s+inside|from\s+in|from)\s+(.+?)[.!]?$/;
function storeWords(input: string, text: string, ctx: VocabContext): VocabResult | null {
  const put = STOW.exec(text), take = put ? null : UNSTOW.exec(text), m = put ?? take; if (!m) return null;
  const verb = put ? 'put-in' : 'pick-up', pool = ctx.caps.filter(c => c.verb === verb); if (!pool.length && put) return null;
  const words = (x: string) => tokens(x).filter(w => !['the', 'a', 'an', 'my', 'your', 'it', 'its', 'of', 'top'].includes(w));
  const thing = words(m[1]), box = words(m[2]), hits = (c: EdgeCapability, ws: string[]) => {const t = ctx.target(c), all = tokens([c.id, c.label, ...t.names].join(' ')); return ws.every(w => tokenHit(w, all) || (SYNONYMS[w] ?? []).some(s => tokenHit(s, all)));};
  // a take from inside names its container (the label says "out of chest (drawer)"); a put names the container it goes in
  const named = pool.filter(c => hits(c, box) && (put || hits(c, thing))).sort((a, b) => Number(b.available) - Number(a.available) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id));
  if (named[0] && (put || / out of /.test(named[0].label))) return {kind: 'alias', cap: named[0], note: `${input} is ${named[0].id} (${named[0].label}).`};
  if (put) return null;
  // nothing offered to take from there: a shut container named by these words says so (what is inside stays unseen)
  const shut = ctx.caps.filter(c => c.verb === 'object' && c.action === 'open' && c.available && /^e_/.test(c.object ?? '') && hits(c, box));
  if (shut[0]) return {kind: 'unknown', code: 'container.closed', reason: `${shut[0].label.replace(/^Open /, '').replace(/^the /i, 'The ')} is shut, so nothing inside it can be seen or taken; open it first (${shut[0].id}).`, didYouMean: [{id: shut[0].id, label: shut[0].label}]};
  return null;
}
function resolveWords(input: string, ctx: VocabContext): VocabResult {
  const exact = ctx.caps.find(c => c.id === input); if (exact) return {kind: 'exact', cap: exact};
  const steered = steerWords(input, ctx); if (steered) return steered;
  const checkers = checkersWords(input, ctx); if (checkers) return checkers;
  // CN5 (acceptance): "A, then B" is two things. Walks and strolls chain (the earlier ones become `via` legs of the last);
  // anything else does the first and says to act again for the rest (never a mix-up of the two).
  // r3 quality case 35: "pick up a book and give it to X" is two steps too (the give is offered only once holding it).
  const clauses = input.includes(':') ? [input] : input.split(/\s*(?:,|;)?\s+(?:and\s+)?then\s+|\s*;\s*|\s*,\s*and\s+then\s+|\s*,?\s+and\s+(?=(?:give|hand|pass|offer|bring)\s)/i).map(x => x.trim()).filter(Boolean);
  if (clauses.length > 1) {
    const parts = clauses.map(c => resolveCapability(c, ctx)), moves = ['walk', 'stroll'];
    if (parts[0].kind === 'unknown') return parts[0];
    if (parts.every(r => r.kind !== 'unknown' && moves.includes(r.cap.verb) && r.cap.target)) {
      const last = parts.at(-1) as Exclude<VocabResult, {kind: 'unknown'}>, via = parts.slice(0, -1).map(r => (r as Exclude<VocabResult, {kind: 'unknown'}>).cap.id);
      if (via.length <= 4) return {kind: 'alias', cap: last.cap, params: {via}, note: `${input} is ${via.join(', then ')}, then ${last.cap.id} (one act: via ${via.join(', ')}).`};
    }
    const first = parts[0] as Exclude<VocabResult, {kind: 'unknown'}>;
    // #439: the first part keeps its own params ("jump c3 to e5, then e5 to g7" moves c3 to e5 now)
    return {kind: 'alias', cap: first.cap, ...(first.kind === 'alias' && first.params ? {params: first.params} : {}), note: `${'note' in first ? first.note : `${clauses[0]} is ${first.cap.id}.`} Doing the first part now; act again for "${clauses.slice(1).join(', then ')}" when its receipt completes.`};
  }
  const text = input.toLowerCase(), colon = text.indexOf(':'), head = colon >= 0 ? text.slice(0, colon) : '';
  const stow = colon < 0 ? storeWords(input, text, ctx) : null; if (stow) return stow;
  // RESOLVE (SOULSIM-E "find a boat": no "find" capability): find / look for / search for X is a walk to the nearest X you
  // can reach, unless the words name an activity offered here ("find somewhere quiet to read", "find a seat" keep theirs)
  const find = colon < 0 ? FIND.exec(text.trim()) : null;
  if (find) {
    const x = find[1].trim(), offered = new Set(ctx.caps.map(c => c.verb));
    if (x && !INTENTS.some(([re, v]) => v !== 'walk' && v !== 'stroll' && offered.has(v) && re.test(x))) {
      const r = resolveCapability(`walk to ${x}`, ctx);
      if (r.kind === 'exact') return {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
      if (r.kind === 'alias') return {...r, note: `${input}: ${r.note}`};
      return r.code ? r : {...r, reason: `Nothing called "${x.replace(/^(?:a|an|the|some)\s+/, '')}" is anywhere you can walk to from here; nothing else was chosen in its place.`};
    }
  }
  // Gaits are distinct offers: never quietly turn a run into walking. A recreational jog is a loop.
  const motion = /\b(jog(?:ging)?|run(?:ning)?|sprint(?:ing)?|hurry)\b/.exec(text);
  if (motion) {
    const gait = /^jog/.test(motion[1]) ? 'jog' : 'run';
    const loop = /\b(?:around|round|loop)\b/.test(text) || /\b(?:go for|take|have) (?:a |an )?(?:jog|run)\b/.test(text);
    if (head !== gait && head !== gait + '-around') {
      const target = text.replace(motion[0], ' ').replace(/^(?:let'?s\s+|i want to\s+|please\s+)?(?:go|take|have|do)?\s*(?:for\s+)?/, '').replace(/\b(?:around|round|loop|to|a|an|the|please|go|for)\b/g, ' ').replace(/[:.!]/g, ' ').trim().replace(/\s+/g, ' ');
      const r = resolveCapability(`${gait}${loop ? '-around' : ''}:${target || 'here'}`, ctx);
      return r.kind === 'unknown' ? r : {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
    }
  }
  // todo (leisure): a bicycle from a dock: "ride a bike to the harbour", "go cycling", "go for a bike ride around the park"
  const bike = colon < 0 ? /\b(?:cycl(?:e|es|ing)|bik(?:e|es|ing)|bicycl(?:e|es|ing)|bike ride)\b/.exec(text) : null;
  if (bike && !/\b(?:skateboard\w*|motor ?bike|motorcycle|exercise bike)\b/.test(text)) {
    const offered = ctx.caps.filter(c => c.verb === 'cycle' || c.verb === 'cycle-around');
    if (!offered.length) return {kind: 'unknown', code: 'bike.no-dock', reason: elsewhereReason('cycle', ctx, 'No bicycle is offered here: a ride starts from a bicycle dock within 120 m; nothing else was chosen.', 'There are no bicycles anywhere in this world; nothing else was chosen.'), didYouMean: []};
    const loop = /\b(?:around|round|loop)\b/.test(text);
    const target = text.replace(/\b(?:let'?s|i want to|please|go|going|take|have|do|for|a|an|the|my|ride|riding|on|cycle|cycles|cycling|bike|bikes|biking|bicycle|bicycles|bicycling|around|round|loop|to|and|back|from|dock|rack)\b/g, ' ').replace(/[:.!,]/g, ' ').trim().replace(/\s+/g, ' ');
    if (!target) {
      const near = offered.filter(c => c.verb === 'cycle-around' && c.available).sort((a, b) => dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0] ?? offered.find(c => c.verb === 'cycle-around');
      if (near) return {kind: 'alias', cap: near, note: `${input} is ${near.id} (${near.label}).`};
    }
    const r = resolveCapability(`${loop || !target ? 'cycle-around' : 'cycle'}:${target || 'here'}`, ctx);
    return r.kind === 'unknown' ? r : {kind: 'alias', cap: r.cap, note: `${input} is ${r.cap.id} (${r.cap.label}).`};
  }
  // RIDE-EXIT (A, Gene's review): "get inside the hot air balloon", "board the punt", "climb into the boat" are the join too.
  const boardWords = /\b(?:board|boarding|embark|(?:get|getting|climb|climbing|hop|step|jump)\s+(?:in|into|inside|aboard|onto|on\s+board))\b/.test(text);
  const rideIntent = boardWords || /\b(?:row|rowing|boating|ride|rides|fly|flight|flying|leave|disembark|alight|start|depart)\b/.test(text) || /^(?:punt|boat|balloon)(?::|$)/.test(text);
  // SOUL2: attractions use the same join/leave actions as carriers, but must never resolve to a nearby balloon.
  const attraction = /\b(?:carousel|merry[- ]go[- ]round)\b/.test(text) ? 'carousel'
    : /\b(?:ferris[- ]wheel|big wheel)\b/.test(text) ? 'ferris' : null;
  if (rideIntent && attraction && ctx.caps.some(c => c.verb === 'object' && /ferris|carousel/i.test(c.id)) && (colon < 0 || ['ride', 'board', 'leave', 'start'].includes(head))) {
    const action = /\b(?:leave|disembark|alight)\b/.test(text) ? 'leave' : /\b(?:start|depart)\b/.test(text) ? 'start' : 'join';
    const words = tokens(text.replace(/\bmerry[- ]go[- ]round\b/g, 'carousel').replace(/\bbig wheel\b/g, 'ferris wheel'))
      .filter(w => !/^(?:please|ride|rides|board|boarding|embark|leave|disembark|alight|start|depart|get|getting|climb|climbing|hop|step|jump|in|into|inside|aboard|onto|on|the|a|an)$/.test(w));
    const rides = ctx.caps.filter(c => c.verb === 'object' && c.action === action && c.id.includes(attraction));
    const pick = rides.filter(c => {const t = ctx.target(c); return words.every(w => tokenHit(w, tokens([c.id, c.label, ...t.names, ...t.around].join(' '))));})
      .sort((a, b) => Number(b.available) - Number(a.available) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0];
    if (pick) return {kind: 'alias', cap: pick, note: `${input} is ${pick.id} (${pick.label}).`};
    return {kind: 'unknown', code: 'ride.unavailable', reason: 'No matching attraction ride is offered here; nothing else was chosen.', didYouMean: []};
  }
  // Rowing always means a punt, and an explicit balloon always means a balloon.
  if ((colon < 0 || ['ride', 'fly', 'balloon', 'row', 'punt', 'boat'].includes(head)) && rideIntent && RIDE_WORDS.test(text) && !/\b(?:bike|bicycle|horse|see[- ]?saw|teeter[- ]?totter|swings?|ferris|big wheel|carousel|merry[- ]go[- ]round)\b/.test(text)) {
    const water = /\b(?:row|rowing|punt|boat|boating)\b/.test(text), air = /\b(?:balloon|fly|flight|flying|hot[- ]air)\b/.test(text);
    const action = /\b(?:leave|disembark|alight)\b/.test(text) ? 'leave' : /\b(?:start|depart)\b/.test(text) ? 'start' : 'join';
    // the vehicle is told by the ride's id (ride-eden-punt, ride-eden-balloon), never by the join label, which reads the same
    // for every ride ("…punt receipt includes disembarkation"): "row a boat" took Eden 2026's balloon (quality case 22)
    const rides = ctx.caps.filter(c => c.verb === 'object' && c.action === action && (water ? /punt|rowing|boat|canoe|kayak/i.test(c.id) && !/balloon/i.test(c.id) : air ? /balloon/i.test(c.id) : /ride|balloon|carrier|punt/i.test(c.id + ' ' + c.label)));
    const target = text.replace(/\b(?:let|lets|s|go|for|take|have|a|an|the|ride|rides|row|rowing|boat|boating|punt|balloon|fly|flight|flying|in|on|at|around|start|leave|disembark|depart|out|of|to|loop|together|board|boarding|embark|get|getting|climb|climbing|hop|step|jump|into|inside|aboard|onto|hot|air)\b/g, ' ').replace(/[:.!]/g, ' ').trim();
    const words = tokens(target), named = words.length ? rides.filter(c => {const t = ctx.target(c); return words.every(w => tokenHit(w, tokens([c.id, c.label, ...t.names, ...t.around].join(' '))));}) : rides;
    // A named body of water anchors the nearest matching ride, even when blocked. Generic 'go rowing'
    // can prefer availability; 'row on the pond' must not silently choose another pond or lake.
    const pick = named.sort((a, b) => (words.length ? 0 : Number(b.available) - Number(a.available)) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0];
    // VERBS2: explain the requested ride's refusal and offer the working alternative without acting on it.
    const other = pick && !pick.available ? rides.filter(c => c.available).sort((a, b) => dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id))[0] : undefined;
    if (pick && other) {
      const why = pick.blocked?.reason ? ` (${pick.blocked.reason.replace(/[.\s]+$/, '')})` : '';
      return {kind: 'unknown', code: 'ride.blocked', reason: `${pick.id} cannot be boarded right now${why}. ${other.id} (${other.label}) can; nothing else was chosen.`, didYouMean: [{id: other.id, label: other.label}]};
    }
    if (pick) return {kind: 'alias', cap: pick, note: `${input} is ${pick.id} (${pick.label}).`};
    // E-life (Eden 2026 quality case 22): with no punt anywhere in this world the refusal is terminal (the agent walked off to look)
    const punts = water ? ctx.elsewhere?.('punt') : undefined;
    return {kind: 'unknown', code: water ? 'ride.no-water-route' : 'ride.unavailable', reason: water ? (punts === null ? 'There is no rowing boat or punt to row in this world.' + NOWHERE : 'No rowing punt is offered on that water. It needs water large enough for a safe loop and a reachable bank; nothing else was chosen.') : 'No matching ride is offered here; nothing else was chosen.', didYouMean: []};
  }
  // CN5: "go fishing", "go swimming": the doing word decides; an unknown one is refused, never taken as a place
  const going = colon < 0 ? /^(?:let'?s\s+|i\s+want\s+to\s+)?(?:go|going|went)\s+([a-z]+ing)\b(.*)$/.exec(text) : null;
  // E-life: two refusals give way to what a god world really offers: ducks to feed (a feed bank by ducks or swans) and a
  // ride on the ferris wheel or carousel (their ride objects); old worlds keep them
  const offeredVerbs = new Set(ctx.caps.map(c => c.verb));
  if (ctx.caps.some(c => c.verb === 'feed' && /\b(?:ducks?|swans?|geese|birds?)\b/i.test(c.label))) offeredVerbs.add('feed-birds');
  if (ctx.caps.some(c => c.verb === 'object' && /ferris|carousel/i.test(c.id))) offeredVerbs.add('ride-attraction');
  const notYet = NOT_YET.filter(([, , , v]) => !v || !offeredVerbs.has(v));
  if (going && !notYet.some(([re]) => re.test(text))) {
    const [verb, ...more] = (GO_ING[going[1]] ?? '').split(' ');
    if (!verb) return {kind: 'unknown', reason: `"${going[1]}" is not something bodies can do here yet; nothing else was chosen in its place.${NOWHERE}`, didYouMean: suggest(input, 'stroll', '', ctx, ctx.caps.filter(c => c.id.endsWith(':here') && c.available).slice(0, 5))};
    const sub = resolveCapability(`${verb} ${[...more, going[2].trim()].join(' ')}`.trim(), ctx);
    return sub.kind === 'unknown' || sub.cap.verb === verb || (verb === 'stroll' && sub.cap.verb === 'wander') ? sub : {kind: 'unknown', reason: `Nothing to ${verb} is offered here right now; nothing else was chosen in its place.`, didYouMean: suggest(input, verb, '', ctx)};
  }
  // Unsupported motions are refused honestly, with the nearest real things to do.
  // Quality 22/29/30: a refusal for something that exists nowhere is terminal (NOWHERE); one whose verb a world can
  // offer (fish, swing, picnic…) may exist elsewhere, so it keeps todo's place-specific wording.
  if (colon < 0 || !ctx.caps.some(c => c.verb === head)) for (const [re, reason, prefer, offer] of notYet) if (re.test(colon < 0 ? text : head)) return {kind: 'unknown', reason: offer === 'feed-birds' ? feedBirdsReason(ctx, reason) : offer ? elsewhereReason(offer, ctx, offer === 'ride-attraction' && ctx.elsewhere?.(offer) ? 'No Ferris wheel or carousel ride is offered from here.' : reason) : reason + NOWHERE, didYouMean: suggest(input, prefer[0], '', ctx, ctx.caps.filter(c => prefer.includes(c.verb) && c.available).slice(0, 5))};
  const verbs = new Set(ctx.caps.map(c => c.verb));
  // VOCAB-MECH: a god-built thing's actuator actions (object caps on `e_…` entities) answer to their own names as verbs:
  // "open the blue door", "put out the fire", "switch off the lamp" (+ everyday aliases). Other objects are unchanged.
  const acts = ctx.caps.filter(c => c.verb === 'object' && c.action && /^e_/.test(c.object ?? ''));
  for (const c of acts) verbs.add(c.action!);
  for (const [k, v] of Object.entries(ACT_ALIASES)) if (verbs.has(v) && !verbs.has(k)) verbs.add(k);
  // Entry 43: a kettle's and a cup's everyday words, only where such an action is offered: "put the kettle on" (or switch /
  // turn it on, boil it) is the kettle's `boil`; "make a cup of tea" is the nearest offered cup's `brew` (an available one first)
  if (colon < 0) {
    const want = /^(?:please\s+)?(?:(?:put|switch|turn)\s+(?:the\s+|my\s+)?kettle\s+on|(?:switch|turn)\s+on\s+(?:the\s+)?kettle|boil\s+(?:the\s+)?(?:kettle|water))[.!]?$/.test(text) ? 'boil'
      : /^(?:please\s+)?(?:make|brew)\s+(?:me\s+|us\s+)?(?:a\s+|some\s+|another\s+)?(?:(?:cup|mug)\s+of\s+)?tea[.!]?$/.test(text) ? 'brew'
      // entry 44: "drink the tea" (drink it, finish the tea, drink up); "have a sip"; "wash the cup" (wash up, rinse the mug)
      : /^(?:please\s+)?(?:(?:drink|finish)\s+(?:up\s+)?(?:(?:the|my|your|this|that)\s+)?(?:(?:cup|mug)\s+of\s+tea|tea|cup|mug|it)?|drink\s+up)[.!]?$/.test(text) ? 'drink'
      : /^(?:please\s+)?(?:(?:have|take)\s+(?:a\s+)?sip(?:\s+of\s+(?:(?:the|my|your)\s+)?(?:tea|it))?|sip\s+(?:(?:the|my|your)\s+)?(?:tea|it))[.!]?$/.test(text) ? 'sip'
      : /^(?:please\s+)?(?:(?:wash|rinse|clean)\s+(?:up|out)?\s*(?:(?:the|my|your|this|that)\s+)?(?:(?:tea\s*)?cup|mug|it)?(?:\s+(?:up|out))?|do\s+the\s+washing[- ]up|wash\s+up)[.!]?$/.test(text) ? 'wash' : null;
    const pool = want ? acts.filter(c => c.action === want).sort((a, b) => Number(b.available) - Number(a.available) || dist(ctx.target(a).at, ctx.me) - dist(ctx.target(b).at, ctx.me) || a.id.localeCompare(b.id)) : [];
    // entry 44: a bare "drink" or "wash up" near a mug nobody can use now keeps its old meaning; naming the tea or the cup
    // gets the mug's own answer (pick it up first, drink it first)
    if (pool.length && (want === 'drink' || want === 'sip' || want === 'wash') && !pool[0].available && !/\b(?:tea|cup|mug)\b/.test(text)) pool.length = 0;
    if (pool.length) return {kind: 'alias', cap: pool[0], note: `${input} is ${pool[0].id} (${pool[0].label}).`};
    // entry 44: "offer Ben the tea", "give the cup of tea to Ben": the hand-over of the held mug to that Soul (entry 41's
    // give:<soul>, offered only while a world thing is held and the Soul is in sight)
    const serve = /^(?:please\s+)?(?:offer|give|hand|pass|serve|bring)\s+(?:(?!the\b|my\b|this\b|that\b|your\b)([a-z][\w' -]*?)\s+(?:(?:the|my|this|that|your|a)\s+)?(?:(?:cup|mug)\s+of\s+tea|tea|cup|mug|it)|(?:(?:the|my|this|that|your|a)\s+)?(?:(?:cup|mug)\s+of\s+tea|tea|cup|mug|it)\s+to\s+([a-z][\w' -]*?))[.!]?$/.exec(text);
    const to = serve ? (serve[1] ?? serve[2]).trim() : '';
    const give = to ? ctx.caps.filter(c => c.verb === 'give' && c.id.startsWith('give:') && c.label.toLowerCase().startsWith(`give ${to} `)) : [];
    if (give.length) return {kind: 'alias', cap: give[0], note: `${input} is ${give[0].id} (${give[0].label}).`};
    // "put the cup on the table", "set it down on the counter": while something is held, that is put-on <the surface>
    const put = /^(?:please\s+)?(?:put|set|place|stand)\s+(?:(?:the|my|this|that|your)\s+)?(?:it|[a-z][a-z-]*(?:\s+of\s+tea)?)\s+(?:down\s+|back\s+)?(?:on|onto)\s+(?:to\s+)?(.+?)[.!]?$/.exec(text);
    if (put && ctx.caps.some(c => c.verb === 'put-on')) return resolveCapability(`put-on ${put[1]}`, ctx);
  }
  let {verb, rest} = parseCapability(input, verbs);
  const nearestRequested = /\b(?:nearest|closest|nearby|anywhere|somewhere)\b|^(?:find|look for|search for)\b|\b(?:a|an)\s/.test(input.toLowerCase());
  const nearestBuilding=verb==='walk'&&/\b(?:nearest|closest)\b/i.test(rest)&&norm(rest.replace(/\bbehind(?:\s+(?:you|me|us))?\b/ig,' ').replace(/\b(?:nearest|closest)\b/ig,' '))==='building';
  const behind = /\bbehind(?:\s+(?:you|me|us))?\b/i.test(rest);
  if (behind) {
    if (!ctx.me || !Number.isFinite(ctx.yaw)) return {kind:'unknown',code:'place.position-unknown',reason:'Your position or heading is unknown; behind cannot be resolved.',didYouMean:[]};
    const me = ctx.me, yaw = ctx.yaw!;
    const buildings = /\bbuilding\b/i.test(rest);
    const allowed = new Set(ctx.caps.filter(c => {
      const p = ctx.places.find(p => p.id === c.target?.id), at = ctx.target(c).at;
      if (buildings && p?.kind !== 'building' && !/\bbuilding\b/i.test(c.label)) return false;
      return !!at && (at[0]-me[0])*Math.cos(yaw)+(at[1]-me[1])*Math.sin(yaw) < -0.05;
    }).map(c => c.id));
    ctx = {...ctx,caps:ctx.caps.filter(c=>allowed.has(c.id)),places:ctx.places.filter(p=>(p.center[0]-me[0])*Math.cos(yaw)+(p.center[1]-me[1])*Math.sin(yaw)<-0.05 && (!buildings||p.kind==='building'))};
    rest = rest.replace(/\bbehind(?:\s+(?:you|me|us))?\b/ig,' ').replace(/\b(?:nearest|closest)\b/ig,' ').trim();
    if (!ctx.caps.some(c=>c.verb===verb) && !nearestBuilding) return {kind:'unknown',code:'place.unreachable',reason:'No eligible destination is offered behind your current heading; nothing in front was substituted.',didYouMean:[]};
  } else if (nearestRequested) rest = rest.replace(/\b(?:nearest|closest)\b/ig,' ').trim();
  // An explicit nearest structural class is a geometric request, not a search for
  // the class noun in authored names ("West Rack Building" must not beat Chiba).
  // Rank known physical buildings before offer-list limits; exact admission still
  // decides whether that nearest building can be entered, including a closed door.
  if(nearestBuilding){
    if(!ctx.me)return {kind:'unknown',code:'place.position-unknown',reason:'Your position is unknown; the nearest building cannot be ranked.',didYouMean:[]};
    const here=ctx.me,place=ctx.places.filter(p=>p.kind==='building').sort((a,b)=>placeEdgeDistance(a,here)-placeEdgeDistance(b,here)||a.id.localeCompare(b.id))[0];
    if(!place)return {kind:'unknown',code:'place.unreachable',reason:'No known building satisfies the requested direction; nothing else was substituted.',didYouMean:[]};
    const offered=ctx.caps.find(c=>c.verb==='walk'&&c.target?.kind==='place'&&c.target.id===place.id);
    if(offered)return {kind:'alias',cap:offered,note:`${input} is ${offered.id} (${place.name}), the nearest building by its edge within the requested direction.`};
    return {kind:'unknown',code:'place.unreachable',place:place.id,verb:'walk',places:[place.id],reason:`The nearest building is ${place.name}; its exact entry must be checked on demand. No farther building was substituted.`,didYouMean:[]};
  }
  if (ACT_ALIASES[verb] && !ctx.caps.some(c => c.verb === verb)) verb = ACT_ALIASES[verb];
  // A real fire is a qualifier of the existing fire request, not a new seat name.
  // Keep explicit/named IDs intact and require an offered actual fire before dropping it.
  const realFire = colon < 0 && ['sit', 'warm-by-fire'].includes(verb) ? /^(?:by|near|beside)\s+(?:a|the)\s+real\s+(fire|campfire)[.!]?$/i.exec(rest) : null;
  if (realFire && ctx.caps.some(c => c.verb === 'warm-by-fire' && c.target?.kind === 'object')) rest = 'fire';
  // "stroll" with nothing named is a stroll right here.
  if (verb === 'stroll' && !tokens(rest).length && !ctx.caps.some(c => c.id === 'stroll:here')) {const w = ctx.caps.find(c => c.id === 'wander:here'); if (w) return {kind: 'alias', cap: w, note: `${input} is ${w.id}.`};}
  if (verb === 'stroll' && !verbs.has('stroll') && verbs.has('wander')) verb = 'wander';
  // Resolve a named gait destination before looking through capability labels.
  // A park mentioning a pond, or a Library annex, must never replace a named
  // place that has no faster-gait offer of its own.
  if (GAIT_VERBS.has(verb)) {
    const words = tokens(rest), queries = [words, words.filter(t => !ctx.root.includes(t))];
    for (const query of queries) {
      const q = query.join(' '); if (!q) continue;
      const tiers = [
        ctx.places.filter(p => norm(p.id) === q),
        ctx.places.filter(p => norm(p.name) === q),
        ctx.places.filter(p => p.aliases?.some(alias => !p.genericAliases?.includes(alias) && norm(alias) === q)),
      ];
      const named = tiers.find(matches => matches.length); if (!named) continue;
      if (named.length > 1) return {kind:'unknown',code:'place.ambiguous',reason:`Several places have that name; use an exact offered ${verb} capability. Nothing else was chosen.`,didYouMean:ctx.caps.filter(c => c.verb === verb && named.some(p => p.id === c.target?.id)).map(c => ({id:c.id,label:c.label}))};
      const place = named[0], offered = ctx.caps.filter(c => c.verb === verb && c.target?.id === place.id).sort((a,b) => Number(b.available)-Number(a.available) || a.id.localeCompare(b.id));
      if (offered[0]) return {kind:'alias',cap:offered[0],note:`${input} is ${offered[0].id} (${offered[0].label}).`};
      const bank = verb.endsWith('-around') && place.kind === 'water';
      return {kind:'unknown',code:bank?'gait.no-bank-loop':'gait.unavailable',reason:bank?`${place.name} has no full loop on reachable dry ground; nothing else was chosen.`:`No ${verb} capability is offered for ${place.name}; nothing else was chosen in its place.`,didYouMean:[],...(bank?{}:{place:place.id})};
    }
  }
  // A named pond means its bank loop, never an unrelated park that mentions ponds in its description.
  if (verb === 'jog-around' || verb === 'run-around') {
    const q = tokens(rest).filter(t => !ctx.root.includes(t)), water = ctx.places.filter(p => p.kind === 'water' && q.length && q.every(t => tokenHit(t, tokens(p.id + ' ' + p.name)) || (SYNONYMS[t] ?? []).some(s => tokenHit(s, tokens(p.id + ' ' + p.name)))));
    if (water.length && q.some(t => ['pond','lake','water','pool'].includes(t))) {
      const offered = ctx.caps.filter(c => c.verb === verb && water.some(p => p.id === c.target?.id)).sort((a,b) => dist(ctx.target(a).at,ctx.me)-dist(ctx.target(b).at,ctx.me));
      if (offered[0]) return {kind:'alias',cap:offered[0],note:`${input} is ${offered[0].id} (${offered[0].label}).`};
      return {kind:'unknown',code:'gait.no-bank-loop',reason:'That pond has no full loop on reachable dry ground; nothing else was chosen.',didYouMean:[]};
    }
  }
  // A specifically offered water-centre journey is never the default generic swim.
  const explicitMiddle=verb==='swim'&&/\b(?:middle|cent(?:er|re))\s+of\b|\b(?:middle|cent(?:er|re))\s*$/i.test(rest);
  const middleParents=new Set(ctx.caps.filter(c=>c.verb==='swim'&&c.id.endsWith('/middle')).map(c=>c.id.slice(0,-7)));
  const pool = ctx.caps.filter(c => (c.verb === verb || (c.verb === 'object' && c.action === verb && /^e_/.test(c.object ?? ''))) && !(verb==='swim'&&(explicitMiddle?middleParents.has(c.id):c.id.endsWith('/middle'))));
  // RESOLVE: a world-engine label's ", by <neighbours> (16 m)" names the neighbours, not the thing ("go to the pond" was a tree
  // by the pond reeds): step 3 tries the names before it first (strict), then the whole label ("the bench by the pond")
  const info = new Map(pool.map(c => {const raw=ctx.target(c), t={...raw,names:[...raw.names,...(c.aliases??[])]}, own = [c.target?.id ?? '', c.id.slice(c.id.indexOf(':') + 1), c.label, ...t.names].filter(Boolean);
    // D2 (playtest 2026-10-25: "go inside house 2, into the kitchen" went to House 1's kitchen chair): a number in the words
    // names a number in a name ("house 2", "chair-2"), never a count or distance in the label ("2 rooms", "(2 m)")
    const label = c.label.replace(/\b\d+(?:\.\d+)?\s*(?:m|s|rooms?|seats?|stops?)\b/g, ' ');
    return [c.id, {t, own, ownTokens: [own[0], own[1], label, ...t.names].filter(Boolean).flatMap(tokens), ownNames: [own[0], own[1], label, ...t.names].filter(Boolean).map(tokens), strictTokens: [own[0], own[1], label.replace(/,\s*by\s.*$/, ''), ...t.names].filter(Boolean).flatMap(tokens)}];}));
  const unknown = (reason: string, prefer: EdgeCapability[] = []) => ({kind: 'unknown' as const, reason, didYouMean: suggest(input, verb, rest, ctx, prefer)});
  const dme = (c: EdgeCapability) => { const p=ctx.places.find(p=>p.id===c.target?.id); return p?.polygon && ctx.me ? placeEdgeDistance(p,ctx.me) : dist(info.get(c.id)?.t.at ?? null, ctx.me); };
  const placeOf = (c: EdgeCapability) => ctx.places.find(p => p.id === c.target?.id);
  // Several fit: the free ones; a place that contains the others (the park, not its gazebo); then the nearest.
  // RESOLVE (SOULSIM-E "go to the bakery" went into its storeroom, 5 m, not in at the shop front): the place a match stands in
  const placeIdOf = (c: EdgeCapability) => c.target?.kind === 'place' ? c.target.id : info.get(c.id)?.t.around[0];
  const one0 = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {
    cs=[...new Map(cs.map(c=>[c.id,c])).values()];
    if (!cs.length) return null;
    const live = cs.filter(c => c.available), list = live.length ? live : cs;
    if (list.length === 1) return {kind: 'alias', cap: list[0], note: note(list[0])};
    const outer = list.filter(c => {const p = placeOf(c); return !!p && list.every(o => o === c || isAncestor(ctx, p.id, o.target?.id));});
    if (outer.length === 1) return {kind: 'alias', cap: outer[0], note: note(outer[0]) + ` (it contains ${list.length - 1} more specific match${list.length > 2 ? 'es' : ''})`};
    const ranked = [...list].sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
    // ... the nearest match inside a building (or room) that matches too is that building: in at its front door, not the
    // back room or the bookcase nearest the Soul (the outermost such, up to the building)
    const n = ranked[0], np = placeIdOf(n);
    if (PLACE_VERBS.has(verb) && np) {
      const enclosing = list.filter(c => c !== n && c.target?.kind === 'place' && ['building', 'room'].includes(placeOf(c)?.kind ?? '') && (c.target.id === np ? n.target?.kind !== 'place' : isAncestor(ctx, c.target.id, np)));
      const outer = enclosing.find(c => placeOf(c)?.kind === 'building') ?? enclosing.find(c => !enclosing.some(o => o !== c && isAncestor(ctx, o.target!.id, c.target!.id)));
      if (outer) return {kind: 'alias', cap: outer, note: note(outer) + ` (the nearest match, ${n.id}, is in it; ${list.length} matched)`};
    }
    // An unnamed kind request ("the library stair") can use the nearest instance
    // of that kind. Actual names and place destinations keep explicit ambiguity.
    const kindWords=tokens(rest),genericObjectKind=verb==='walk'&&kindWords.length>0&&list.every(c=>{
      const kind=kindOf(c),words=kind?tokens(kind):[];
      return c.target?.kind==='object'&&words.length>0&&kindWords.every(w=>tokenHit(w,words))&&kindWords.some(w=>tokenHit(w,words.slice(-1)));
    });
    const genericPlaceKind=verb==='walk'&&kindWords.length>0&&list.every(c=>{const p=placeOf(c);return p?.genericAliases?.some(a=>norm(a)===kindWords.join(' '));});
    if (!nearestRequested && verb !== 'sit' && !genericObjectKind && !genericPlaceKind) return {kind:'unknown',code:'place.ambiguous',reason:`Several destinations match; choose a candidate by its exact capability ID.`,didYouMean:ranked.slice(0,5).map(c=>({id:c.id,label:c.label}))};
    if (!Number.isFinite(dme(n))) return {kind:'unknown',code:'place.position-unknown',reason:'The destination distances are unknown; choose an exact candidate.',didYouMean:ranked.slice(0,5).map(c=>({id:c.id,label:c.label}))};
    return {kind: 'alias', cap: n, note: note(n) + ` (the nearest of ${list.length}; also ${ranked.slice(1, 4).map(c => c.id).join(', ')})`};
  };
  const one = one0;
  // RESOLVE (Ada "go to the pond" went to twinkle lights "lights-pond-2", Wren "go to the market" to string lights by the
  // kiosks): of the walk targets whose names hold the words, those that are what the words say (", a pond") come first;
  // else the places, before the things named after the place they stand in
  const kindOf = (c: EdgeCapability) => /,\s+an?\s+([^,:(]+?)(?=\s*[,:(]|\s+(?:by|in|of)\s|$)/.exec(c.label)?.[1] ?? /^Go into (.+?) of /.exec(c.label)?.[1];
  // B9 (ACCEPT3, live 3.87: "go to the library" walked to eden-house-3-roof-stairs, "a mars-tool-library-stair", and ended on
  // the south lawn): a word found only as a modifier of an offer's kind, not its head ("stair") nor any of its own names,
  // does not name that offer; the words go to what they do name (the library, offered on demand when far)
  const modifierOnly = (c: EdgeCapability, words: string[]) => {
    const k = kindOf(c), kt = k ? tokens(k) : [];
    if (!k || kt.length < 2 || words.some(w => tokenHit(w, kt.slice(-1)))) return false;
    const i = info.get(c.id)!, rest = [i.own[0], i.own[1], c.label.replace(k, ' '), ...i.t.names].filter(Boolean).flatMap(tokens);
    return words.some(w => tokenHit(w, kt) && !tokenHit(w, rest));
  };
  const ownFirst = (cs: EdgeCapability[], words: string[]) => {
    if (cs.length < 2 || !PLACE_VERBS.has(verb)) return cs;
    const kinded = cs.filter(c => {const k = kindOf(c); return !!k && words.every(w => tokenHit(w, tokens(k)));});
    // ... with the building a matching room is in, when the building matches too (the cafe: in at its front door)
    if (kinded.length) return cs.filter(c => kinded.includes(c) || (c.target?.kind === 'place' && kinded.some(k => isAncestor(ctx, c.target!.id, k.target?.id))));
    const places = cs.filter(c => c.target?.kind === 'place');
    return places.length ? places : cs;
  };
  if (pool.length) {
    const rawQ=tokens(rest),identity=PLACE_VERBS.has(verb)&&ctx.places.some(p=>[p.id,p.ref??'',p.name,...(p.aliases??[])].some(n=>norm(n)===rawQ.join(' ')));
    const q = numberWords(identity?rawQ:rawQ.filter(t => !FILLER.has(t) || !PLACE_VERBS.has(verb) ? true : false), () => [...[...info.values()].flatMap(i => i.ownNames), ...ctx.places.map(p => tokens(p.name))]), qs = q.join(' ');
    const byOwn = (want:string) => {
      const matches=pool.filter(c=>info.get(c.id)!.own.some(n=>norm(n)===want));
      if(!PLACE_VERBS.has(verb))return matches;
      // Stable refs/IDs outrank inherited part aliases and generic definition tags
      // (a cup tagged kitchen must not compete with walk:kitchen). Keep unavailable
      // exact targets so a blocked named entrance is not replaced by a free alias.
      const exact=matches.filter(c=>norm(c.id.slice(c.id.indexOf(':')+1))===want||norm(c.target?.id??'')===want);
      if(exact.length)return exact;
      const named=new Set(ctx.places.filter(p=>norm(p.name)===want).map(p=>p.id));
      const titles=matches.filter(c=>c.target?.kind==='place'&&named.has(c.target.id));
      const preferred=placeMatchTier(tokens(want),ctx.places,ctx.withheld).found;
      const placeAliases=matches.filter(c=>c.target?.kind==='place'&&preferred.some(p=>p.id===c.target!.id));
      return titles.length?titles:placeAliases.length?placeAliases:preferred.length?[]:matches;
    };
    const here = pool.find(c => c.id === `${verb}:here`);
    // 0. Verbs with a single non-targeted (or "here") capability: rest:anything, swim:pond, wander:around.
    if (pool.length === 1 && (!q.length || (!['sit','swim'].includes(verb) && (!pool[0].target || pool[0].id.endsWith(':here'))))) return {kind: 'alias', cap: pool[0], note: `${input} is ${pool[0].id}.`};
    // An ordinary sit means a durable fixture seat when one is offered nearby; named seats never become ground poses.
    if (verb === 'sit' && (!q.length || ['down','nearby','nearest','somewhere'].includes(qs))) {
      const seats=pool.filter(c=>c.available && c.id!=='sit:here' && c.target && dme(c)<=8).sort((a,b)=>dme(a)-dme(b)||a.id.localeCompare(b.id));
      if (seats.length) return {kind:'alias',cap:seats[0],note:`${input} means the nearest available fixture seat, ${seats[0].id} (${seats[0].label}).`};
    }
    // Nothing named, or "here"/"down"/"nearby": the verb's own :here capability (sit down → sit:here).
    if (here && (!q.length || ['here', 'nearby', 'near', 'anywhere', 'somewhere', 'down', 'now', 'nearest'].includes(qs))) return {kind: 'alias', cap: here, note: `${input} is ${here.id} (${here.label}).`};
    // CN5: an activity at spots with nothing named: the nearest free one (use a computer, play the drums, sing, play pétanque)
    const unnamedActivity=!q.filter(t=>!FILLER.has(t)).length||INTENTS.some(([re,v,keep])=>!keep&&v===verb&&re.test(text)&&!tokens(text.replace(re,' ')).filter(t=>!FILLER.has(t)).length);
    if (unnamedActivity && pool.every(c => c.target?.kind === 'spot')) {
      const available=pool.filter(c=>c.available);
      const near = (available.length?available:pool).sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
      if (near.length) return {kind: 'alias', cap: near[0], note: `${input} is the nearest ${available.length?'available':'matching unavailable'} one, ${near[0].id} (${near[0].label}, ${Math.round(dme(near[0]))} m).`};
    }
    // ROUTE-RECHECK ("go for a swim" in the park pond was "Say which"): a swim with no water named is in the water the Soul
    // is in, else the nearest it can swim in
    if (verb === 'swim' && (!q.length || q.every(w=>['water','lake','pond','pool','body','nearest','nearby'].includes(w)))) {
      const relation=(c:EdgeCapability)=>ctx.here?.includes(c.target?.id??'')?0:ctx.here?.some(id=>{const p=ctx.places.find(p=>p.id===id);return p?.kind==='shore'&&p.parent===c.target?.id;})?1:2;
      const near=pool.filter(c=>c.available).sort((a,b)=>relation(a)-relation(b)||dme(a)-dme(b)||a.id.localeCompare(b.id));
      if(near.length && (relation(near[0])<2 || Number.isFinite(dme(near[0])))) return {kind:'alias',cap:near[0],note:`${input} is ${relation(near[0])===0?'the water you are in':relation(near[0])===1?'the water beside this bank':'the nearest water by its edge'}, ${near[0].id} (${near[0].label}).`};
      return {kind:'unknown',code:'place.position-unknown',reason:'No water can be ranked from a known position; choose a named water.',didYouMean:near.slice(0,5).map(c=>({id:c.id,label:c.label}))};
    }
    if (!q.length) return unknown(`Say which: "${verb}:<target>".`, pool);
    // "here" without a :here capability: the nearest free one within reach (30 m for seats).
    if (qs === 'here' || qs === 'nearby' || qs === 'nearest') {
      const reach = verb === 'sit' ? 30 : pool.every(c => c.target?.kind === 'spot') ? 150 : 6;
      const near = pool.filter(c => c.available && dme(c) <= reach).sort((a, b) => dme(a) - dme(b) || a.id.localeCompare(b.id));
      if (near.length) return {kind: 'alias', cap: near[0], note: `${input} is the nearest free one, ${near[0].id} (${near[0].label}).`};
      const rest_ = ctx.caps.find(c => c.id === 'rest:here');
      if (verb === 'sit' && rest_) return {kind: 'alias', cap: rest_, note: `No free seat within ${reach} m; resting where you stand instead (${rest_.id}).`};
      return unknown(`Nothing free to ${verb} within a few metres of you; the nearest are in did_you_mean.`, pool.filter(c => c.available).sort((a, b) => dme(a) - dme(b)).slice(0, 5));
    }
    const passes = [q, q.filter(t => !ctx.root.includes(t))].filter((p, i, all) => p.length && (i === 0 || p.length !== all[0].length));
    for (const words of passes) {
      const s = words.join(' ');
      // CN5: a place elsewhere whose own name is exactly these words, and that this resolution does not reach, is named in the note.
      const also = (r: VocabResult | null): VocabResult | null => {
        if (!r || r.kind !== 'alias' || !PLACE_VERBS.has(verb)) return r;
        const t = r.cap.target?.id, other = ctx.places.filter(p => norm(p.name) === s && p.id !== t && !isAncestor(ctx, p.id, t) && !(t && isAncestor(ctx, t, p.id)));
        return other.length ? {...r, note: `${r.note} ("${other[0].name}" also names ${other[0].id}${other[0].walkable ? '' : ', which cannot be reached yet'}.)`} : r;
      };
      // An exact known place whose offer is omitted for distance still names that
      // place. Let 3b request its on-demand admission instead of accepting an object
      // tagged with its alias (a library book is not the distant library).
      const placeIdentity=PLACE_VERBS.has(verb)?placeMatchTier(words,ctx.places,ctx.withheld):null;
      if(SPOT_PLACE_VERBS.has(verb)&&placeIdentity?.found.length)break;
      if(placeIdentity?.tier===0&&placeIdentity.found.length&&!pool.some(c=>norm(c.id.slice(c.id.indexOf(':')+1))===s||norm(c.target?.id??'')===s)
        && !pool.some(c=>c.target?.kind==='place'&&placeIdentity.found.some(p=>p.id===c.target!.id)))break;
      // 1. Same name as the target, its label or its place name.
      const r1 = also(one(byOwn(s), c => `${input} is ${c.id} (${c.label}).`)); if (r1) return r1;
      // 2. The place an object stands in (sit:commons-deck, warm-by-fire:social-eden-fire-circle).
      const r2 = also(one(pool.filter(c => info.get(c.id)!.t.around.some(n => norm(n) === s)), c => `${input}: ${c.id} (${c.label}) is there.`)); if (r2) return r2;
      // 3. Every word appears in the target's own names (walk:pond → the pond).
      const named = (c: EdgeCapability) => (!PLACE_VERBS.has(verb) || !modifierOnly(c, words)) && !numberConflict(words, info.get(c.id)!.ownNames);
      const strict = pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.strictTokens)) && named(c));
      const named3 = strict.length ? strict : pool.filter(c => words.every(w => tokenHit(w, info.get(c.id)!.ownTokens)) && named(c));
      // ROUTE-RECHECK: a spot verb's places ("read a book in the library") are chosen by 3b below, best name first and offered
      // on demand when far, not as the nearest offer whose name has the word (the library annex next to the quad)
      // ... and a place verb's words that only an offer's "by <neighbours>" names ("go to the south lawn": the quad lawn "by
      // land-campus-south-gate") go to the place whose own name has them (the south lawn, offered on demand when far)
      const byPlace3 = (SPOT_PLACE_VERBS.has(verb) && named3.some(c => c.target?.kind === 'place') && placeMatch(words, ctx.places, ctx.withheld).length > 0)
        || (PLACE_VERBS.has(verb) && [0, 1].includes(placeMatchTier(words, ctx.places, ctx.withheld).tier));
      // Full public labels now include purpose prose. A field mentioning its
      // pavilion must not beat the pavilion's own name, even when it encloses it.
      // Keep all named qualifiers rather than trying a weaker root-stripped pass.
      if(byPlace3)break;
      const r3 = also(one(ownFirst(named3, words), c => `${input} is ${c.id} (${c.label}).`)); if (r3) return r3;
    }
    // 3c (SOULSIM-E): a thing's everyday synonyms, after its exact words fail, for verbs at things (places have 3b): Mars's
    // "sit by the campfire" was capability.unknown while "sit by the fire" sat on a fire bench (its benches are "Fire
    // bench", the place "Fire circle"). By the thing's own names, else by the place it stands in.
    if (!PLACE_VERBS.has(verb)) for (const words of passes) {
      const syn = (w: string, set: string[]) => tokenHit(w, set) || (SYNONYMS[w] ?? []).some(x => tokenHit(x, set));
      if (!words.some(w => SYNONYMS[w])) continue;
      const r = one(pool.filter(c => words.every(w => syn(w, info.get(c.id)!.ownTokens))), c => `${input} is ${c.id} (${c.label}).`)
        ?? one(pool.filter(c => {const a = info.get(c.id)!.t.around.flatMap(tokens); return a.length > 0 && words.every(w => syn(w, a));}), c => `${input}: ${c.id} (${c.label}) is there.`);
      if (r) return r;
    }
    // 3d (Soul Actions entry 38): a thing's action whose words also say what is written ("put up a poster for the concert at
    // the bandstand tonight", "reply to Ben's note on the wanted board"): the one offered thing whose own names hold the most
    // of the words, when exactly one holds the most and it holds at least one. Thing actions only (never places or walks).
    if (!PLACE_VERBS.has(verb) && pool.length >= 1 && pool.every(c => c.verb === 'object' && /^e_/.test(c.object ?? ''))) {
      const score = (c: EdgeCapability) => q.filter(w => tokenHit(w, info.get(c.id)!.strictTokens)).length, scored = pool.map(c => ({c, n: score(c)})).sort((a, b) => b.n - a.n);
      const top = scored.filter(x => x.n === scored[0].n && x.n > 0);
      if (top.length && new Set(top.map(x => x.c.object)).size === 1) {const r = one(top.map(x => x.c), c => `${input} is ${c.id} (${c.label}; ${top[0].n} of the words name it).`); if (r) return r;}
    }
    // 3b. Places by name/description words and everyday synonyms (the park, the woods, the lake, the campfire).
    // CN5 (Gene: "walk to the harbour" went to the park): a named place resolves only to itself, a place inside it, or the
    // place that contains it. A named place that cannot be reached is refused honestly (place.unreachable), never swapped
    // for an unrelated place; the nearest places you can reach are offered in did_you_mean.
    if (PLACE_VERBS.has(verb)) for (const words of passes) {
      const m = placeMatchTier(words, ctx.places, ctx.withheld);
      if (!m.found.length) continue;
      // ROUTE-RECHECK ("read a book in the library" read in the campus library annex): for a spot verb, the place called just
      // these words (the Library) comes before one whose name says more (the library annex); nearest among equals
      const extra = (p: VocabPlace) => new Set(tokens(p.name).filter(t => !words.includes(t) && !ctx.root.includes(t) && !/^\d+$/.test(t))).size;
      const spotted = SPOT_PLACE_VERBS.has(verb) && ctx.hasSpot ? m.found.filter(p => ctx.hasSpot!(verb, p.id)) : [];
      // Resolve a partial type name against known physical kinds before offer-list
      // limits. An omitted/blocked pond still outranks its named reedbed; its normal
      // on-demand admission must run instead of silently selecting the reeds.
      const kinded=m.tier>0?m.found.filter(p=>words.every(w=>{const kinds=[p.kind??'',...(SYNONYMS[p.kind??'']??[])].flatMap(tokens);return tokenHit(w,kinds)||(SYNONYMS[w]??[]).some(x=>tokenHit(x,kinds));})):[];
      const found = SPOT_PLACE_VERBS.has(verb) ? [...(spotted.length ? spotted : m.found)].sort((a, b) => extra(a) - extra(b)) : kinded.length?kinded:m.found;
      // RESOLVE: matched by a place's description only (a lawn "with ... a horse"): the words name a thing in it
      const seek = m.tier === 3 ? words : undefined;
      const one = (cs: EdgeCapability[], note: (c: EdgeCapability) => string): VocabResult | null => {const r = one0(cs, note); return r && seek && r.kind === 'alias' ? {...r, seek} : r;};
      const capOf = new Map(pool.filter(c => c.target).map(c => [c.target!.id, c]));
      const reach = found.filter(p => capOf.has(p.id));
      // (the best-named place with a spot but no offer from here is refused below, and its host offers it on demand)
      const best = SPOT_PLACE_VERBS.has(verb) && spotted.length ? reach.filter(p => extra(p) === extra(found[0])) : SPOT_PLACE_VERBS.has(verb) && reach.length ? reach.filter(p => extra(p) === extra(reach[0])) : reach;
      // At the same partial-name tier, keep the existing actual-kind preference:
      // a pond is the pond, not the nearer reedbed named after it. Exact identities stay stronger.
      if (best.length) {const candidates=best.map(p => capOf.get(p.id)!);const r = one(m.tier===0?candidates:ownFirst(candidates,words), c => `${input} is ${c.id} (${c.label}).`); if (r) return r;}
      const place = found[0], inner = pool.filter(c => c.available && c.target && isAncestor(ctx, place.id, c.target.id));
      if (inner.length) {const r = one(inner, c => `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) is in it.`); if (r) return r.kind==='unknown'&&r.code==='place.ambiguous'&&found.length===1?{...r,code:'place.unreachable',place:place.id,verb,places:[place.id],reason:`${place.name} has no direct ${verb} offer; choose one of its reachable parts. No part was selected.`}:r;}
      // the nearest containing place this verb reaches (the harbour for its lighthouse), never the world root
      const byId = new Map(ctx.places.map(p => [p.id, p]));
      for (let q = place.parent ? byId.get(place.parent) : undefined, n = 0; q && n < 20; q = q.parent ? byId.get(q.parent) : undefined, n++) {
        const c = capOf.get(q.id);
        if (c?.available) return {kind: 'alias', cap: c, inside: place.id, ...(seek ? {seek} : {}), note: `${place.name} itself is not a ${verb} target; ${c.id} (${c.label}) contains it.`};
      }
      const reachable = pool.filter(c => c.available && info.get(c.id)!.t.at), wholes = reachable.filter(c => c.target?.kind === 'place');
      const ranked = (wholes.length ? wholes : reachable).map(c => ({c, d: dist(info.get(c.id)!.t.at, place.center)})).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id));
      const why = verb === 'read' ? `there is nowhere to read in ${place.name}` : `${place.name} is not walkable ground yet`;
      return {kind: 'unknown', code: 'place.unreachable', place: place.id, verb, places: found.map(p => p.id), ...(seek ? {seek} : {}), reason: `${input}: ${why}${ranked.length ? ` (the nearest place you can ${verb} to is ${ranked[0].c.id}, ${Math.round(ranked[0].d)} m from it)` : ''}; nothing else was chosen in its place.`,
        didYouMean: ranked.slice(0, 3).map(r => ({id: r.c.id, label: r.c.label}))};
    }
  }
  // VERBS (accept2 brief 10): "lift weights at the gym" away from the gym parsed as the verb "lift" (the whole-sentence rule
  // only wins when its verb is offered here). A spot activity offered elsewhere says where the nearest one is.
  if (!pool.length && colon < 0) for (const [re, v] of INTENTS) if (!verbs.has(v) && v in SPOT_ACTIVITIES && re.test(text)) {
    const e = ctx.elsewhere?.(v); if (e === undefined) break;
    // within offer reach but not offered: every such spot is taken (another body is at the gym's dumbbells)
    if (e && e.distance <= SPOT_REACH && v === 'sing' && e.by) return unknown(`${e.by} is already singing at the nearest microphone, ${e.label}${e.place && !e.label.endsWith(` in ${e.place}`) ? ` in ${e.place}` : ''} (about ${Math.round(e.distance)} m away), and a microphone takes one singer at a time. Ask again when ${e.by} has finished; nothing else was chosen.`);
    if (e && e.distance <= SPOT_REACH) return unknown(`${SPOT_ACTIVITIES[v].label} is not free right now: the nearest, ${e.label}${e.place && !e.label.endsWith(` in ${e.place}`) ? ` in ${e.place}` : ''} (about ${Math.round(e.distance)} m away), is in use by someone. Ask again in a minute or two; nothing else was chosen.`);
    return unknown(elsewhereReason(v, ctx, `${SPOT_ACTIVITIES[v].label} is not offered within reach of where you are.`));
  }
  if (!pool.length) return unknown(`No "${verb}" capability is offered to this Soul right now. Things you can do: ${ctx.caps.filter(c => c.id.endsWith(':here')).map(c => c.id).slice(0, 12).join(', ')} (and walk:<place>, stroll:<place>, read:<place>); read capabilities again.`, ctx.caps.filter(c => c.id.endsWith(':here')));
  const left = tokens(rest).filter(t => !FILLER.has(t) && !ctx.root.includes(t));
  // knowledge/1: words that name a place this Soul does not know seek nothing (the secret grove is no thing to walk to either)
  return {...unknown(`Nothing offered matches "${input}"; read capabilities again.`), ...(PLACE_VERBS.has(verb) && left.length && !ctx.withheld?.includes(left.join(' ')) ? {seek: left} : {})};
}

// srv-act-words: the places by id, once per places listing (vocabPlaces keeps the listing; isAncestor is asked for every
// pair of a pool's offers: a Map per call was 2-3 ms of every walk resolved in words)
const PLACES_BY_ID = new WeakMap<VocabContext['places'], Map<string, VocabContext['places'][number]>>();
function isAncestor(ctx: VocabContext, ancestor: string, id: string | undefined): boolean {
  let byId = PLACES_BY_ID.get(ctx.places); if (!byId) {byId = new Map(ctx.places.map(p => [p.id, p])); PLACES_BY_ID.set(ctx.places, byId);}
  for (let p = id ? byId.get(id) : undefined, n = 0; p && n < 20; p = p.parent ? byId.get(p.parent) : undefined, n++) if (p.parent === ancestor) return true;
  return false;
}
/** srv-act-words (D): for a focused walk to these destination words, a test passing every walk offer the words could choose
 *  (resolveWords' walk pool rules), so a focused build may skip building the rest (their route goals): an offer is kept
 *  when any destination word (or its everyday synonym) is one of its own words (target id, id, label, target names, the
 *  place it stands in, aliases), or its target is a place any such word names (name, id, aliases, kind, description: every
 *  placeMatch tier and pass, leniently) or one inside or around such a place (3b: the place itself, its inner offers, the
 *  containing place). Every rule that chooses a walk reads only offers like these; the rest are read by unknown answers,
 *  which go to the words menu. Null (build every walk) for words other rules read whole: no word left after filler, here
 *  / now words, numbers (numberWords), and a word the typo fallback could re-read (one no place spells exactly: typoFix
 *  reads the offers' words). */
const KEEP_WHOLE = new Set(['here', 'nearby', 'near', 'anywhere', 'somewhere', 'down', 'now', 'nearest']);
const PLACE_TOKENS = new WeakMap<readonly VocabPlace[], Set<string>>();
export function walkKeepV1(dest: string, places: VocabPlace[], target: VocabContext['target']): ((c: Pick<EdgeCapability, 'id' | 'verb' | 'label' | 'aliases' | 'target'>) => boolean) | null {
  const q = tokens(dest);
  if (!q.some(w => !FILLER.has(w)) || q.some(w => KEEP_WHOLE.has(w) || /\d/.test(w) || w in NUMBER_WORDS)) return null;
  let exact = PLACE_TOKENS.get(places);
  if (!exact) {exact = new Set(); for (const p of places) for (const s of [p.name, p.id, p.description ?? '', ...(p.aliases ?? [])]) for (const t of tokens(s)) exact.add(t); PLACE_TOKENS.set(places, exact);}
  if (q.some(w => w.length >= 4 && !FILLER.has(w) && !exact!.has(w))) return null;
  const Q = [...new Set([...q, ...q.flatMap(w => SYNONYMS[w] ?? [])])], qs = q.join(' ');
  const named = new Set(places.filter(p => {const W = placeWords(p); return W.ids.includes(qs) || W.name === qs || W.aliases.includes(qs) || Q.some(w => tokenHit(w, W.nameT) || tokenHit(w, W.kindT) || tokenHit(w, W.descT));}).map(p => p.id));
  // ... with every place around (isAncestor's chain) and inside them
  let byId = PLACES_BY_ID.get(places); if (!byId) {byId = new Map(places.map(p => [p.id, p])); PLACES_BY_ID.set(places, byId);}
  const near = new Set(named);
  for (const p of places) {
    const chain: string[] = [];
    for (let x: VocabPlace | undefined = p, n = 0; x && n < 21; x = x.parent ? byId.get(x.parent) : undefined, n++) chain.push(x.id);
    if (chain.slice(1).some(id => named.has(id))) near.add(p.id);
    if (named.has(p.id)) for (const id of chain) near.add(id);
  }
  return c => {
    const id = c.target?.id; if (id && near.has(id)) return true;
    const t = target(c as EdgeCapability), own = [id ?? '', c.id.slice(c.id.indexOf(':') + 1), c.label, ...t.names, ...t.around, ...(c.aliases ?? [])].flatMap(tokens);
    return Q.some(w => tokenHit(w, own));
  };
}
/** Places named by these words: own name/id first, then everyday synonyms, then description words; the most
 *  obvious first (by name over description, walkable, outermost, larger). */
/** VERBS (accept2 brief 10): "feed the ducks" away from a duck bank said "There are no ducks or birds to feed here" although
 *  Eden 2026 has two duck banks: name the nearest (or that it is taken); the old wording stays only where none exists. */
function feedBirdsReason(ctx: VocabContext, none: string): string {
  const e = ctx.elsewhere?.('feed-birds');
  if (e === undefined) return none + NOWHERE;
  if (e === null) return none + NOWHERE;
  const where = e.place && !e.label.endsWith(` in ${e.place}`) ? ` in ${e.place}` : '';
  if (e.distance <= SPOT_REACH) return `Feeding the ducks is not free right now: the nearest place for it, ${e.label}${where} (about ${Math.round(e.distance)} m away), is in use by someone. Ask again in a minute or two; nothing else was chosen.`;
  return `No duck feeding is offered within reach of where you are. The nearest is ${e.label}${where}, about ${Math.round(e.distance)} m away: walk there first${e.placeId ? ` (walk:${e.placeId})` : ''}, then ask again.`;
}
/** A refusal for a spot-based thing (a swing, a bicycle) that is not offered from here: say where the nearest one is, or that
 *  none exists in this world at all (terminal, NOWHERE). Without world knowledge the place-specific wording stays. */
function elsewhereReason(verb: string, ctx: VocabContext, here: string, none?: string): string {
  const e = ctx.elsewhere?.(verb);
  if (e === undefined) return here;
  if (e === null) return (none ?? here) + NOWHERE;
  const where = e.place && !e.label.endsWith(` in ${e.place}`) ? ` in ${e.place}` : '', go = e.placeId ? ` (walk:${e.placeId})` : '';
  return `${here.replace(/[.\s]+$/, '')}. The nearest is ${e.label}${where}, about ${Math.round(e.distance)} m away: walk there first${go}, then ask again.`;
}
export function placeMatch(words: string[], places: VocabPlace[], withheld: readonly string[] = []): VocabPlace[] {return placeMatchTier(words, places, withheld).found;}
/** placeMatch, and which tier matched: 0 own name exactly, 1 own name/id words, 2 everyday synonyms, 3 description words. */
/** L3 (b): what placeMatchTier reads of a place, derived once per VocabPlace object (vocabularyOf keeps them while the
 *  places, their aliases and what this Soul knows do not change). VocabPlaces are never written after they are built. */
type PlaceWords = {ids: string[]; name: string; aliases: string[]; nameT: string[]; kindT: string[]; descT: string[]; numberNames: string[][]};
const PLACE_WORDS = new WeakMap<VocabPlace, PlaceWords>();
function placeWords(p: VocabPlace): PlaceWords {
  let w = PLACE_WORDS.get(p); if (w) return w;
  const aliases = (p.aliases ?? []).filter(a => !p.genericAliases?.includes(a));
  w = {ids: [norm(p.id), ...(p.ref ? [norm(p.ref)] : [])], name: norm(p.name), aliases: aliases.map(norm),
    nameT: [...tokens(p.name), ...tokens(p.id), ...aliases.flatMap(tokens)], kindT: [...tokens(p.kind ?? ''), ...(p.genericAliases ?? []).flatMap(tokens)],
    descT: tokens(p.description ?? ''), numberNames: [tokens(p.name), tokens(p.id)]};
  PLACE_WORDS.set(p, w); return w;
}
export function placeMatchTier(words: string[], places: VocabPlace[], withheld: readonly string[] = []): {found: VocabPlace[]; tier: number} {
  if (!words.length) return {found: [], tier: -1};
  const q=words.join(' ');
  const W = placeWords;
  for(const found of [places.filter(p=>W(p).ids.includes(q)),places.filter(p=>W(p).name===q),places.filter(p=>W(p).aliases.includes(q))])if(found.length)return {found,tier:0};
  const hitAll = (w: string, a: string[], b: string[]) => tokenHit(w, a) || tokenHit(w, b) || (SYNONYMS[w] ?? []).some(s => tokenHit(s, a) || tokenHit(s, b));
  const noConflict = (p: VocabPlace) => !numberConflict(words, W(p).numberNames);
  const tiers = [
    places.filter(p => W(p).name === q || W(p).aliases.includes(q)),
    places.filter(p => words.every(w => tokenHit(w, W(p).nameT)) && noConflict(p)),
    places.filter(p => words.every(w => hitAll(w, W(p).nameT, W(p).kindT)) && noConflict(p)),
    places.filter(p => words.every(w => hitAll(w, W(p).nameT, W(p).descT)) && noConflict(p)),
  ];
  // knowledge/1: a withheld place's own name is not an everyday word for some other place (the grove is not the orchard)
  if (!tiers[0].length && !tiers[1].length && withheld.includes(words.join(' '))) return {found: [], tier: -1};
  const tier = tiers.findIndex(t => t.length), found = tiers[tier] ?? [];
  if (found.length < 2) return {tier, found: [...found]};
  // (the parent chain within `places`, as places.find walked it: the first place with each id)
  const byId = new Map<string, VocabPlace>(); for (const x of places) if (!byId.has(x.id)) byId.set(x.id, x);
  const depthOf = new Map<VocabPlace, number>(), depth = (p: VocabPlace) => {let d = depthOf.get(p); if (d !== undefined) return d; d = 0; const seen=new Set<string>(); for (let q: VocabPlace | undefined = p; q?.parent && !seen.has(q.id); q = byId.get(q.parent)) {seen.add(q.id);d++;} depthOf.set(p, d); return d;};
  return {tier, found: [...found].sort((a, b) => Number(!!b.walkable) - Number(!!a.walkable) || Number(a.kind === 'water') - Number(b.kind === 'water') || depth(a) - depth(b) || a.id.localeCompare(b.id))};
}

/** The closest offered capabilities: same verb first, then word overlap, string likeness, availability, distance. */
export function suggest(input: string, verb: string, rest: string, ctx: VocabContext, prefer: EdgeCapability[] = [], limit = 5): {id: string; label: string}[] {
  const q = tokens(rest || input), qs = q.join(' '), first = new Set(prefer.map(c => c.id));
  const scored = ctx.caps.map(c => {
    const t = ctx.target(c), words = [...tokens(c.id), ...tokens(c.label), ...t.names.flatMap(tokens), ...t.around.flatMap(tokens)];
    const overlap = q.reduce((n, w) => n + (words.includes(w) ? 1 : tokenHit(w, words) ? 0.6 : 0), 0), like = Math.max(dice(qs, norm(c.id.slice(c.id.indexOf(':') + 1))), dice(qs, norm(c.label)), ...t.names.map(n => dice(qs, norm(n))));
    return {c, score: (first.has(c.id) ? 100 : 0) + (c.verb === verb ? 20 : 0) + overlap * 10 + like * 8 + (c.available ? 1 : 0), d: dist(t.at, ctx.me)};
  });
  return scored.sort((a, b) => b.score - a.score || a.d - b.d || a.c.id.localeCompare(b.c.id)).slice(0, limit).map(({c}) => ({id: c.id, label: c.label}));
}

/** RESOLVE (SOULSIM-E: "go to the lighthuose", "walk to the cotage" were capability.unknown): a misspelt target word read as
 *  the closest word this world knows (a place's or offered thing's names and description, `extra` names), by optimal
 *  string alignment distance: at most 2 edits for words of 5+ letters, 1 for 4 letters; 3-letter words are never changed
 *  ("dog" is not "log"). A fallback only, after the words as written resolve to nothing; ties go to the commoner word.
 *  Null when no word needs (or has) a reading. */
export function typoFix(input: string, ctx: VocabContext, extra: Iterable<string> = []): {text: string; fixes: [string, string][]} | null {
  if (input.includes(':')) return null;
  const verbs = new Set(ctx.caps.map(c => c.verb)), {verb, rest} = parseCapability(input, verbs);
  if (!verbs.has(verb)) return null;
  const plain = (w: string) => STOP.has(w) || FILLER.has(w) || w in VERBS || /\d/.test(w) || w.length < 4;
  const ask = [...new Set(rest.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !plain(w) && !LEXICON.has(w)))];
  if (!ask.length) return null;
  const known = knownWords(ctx, extra);
  const fixes: [string, string][] = [];
  for (const w of ask) {
    if (known.has(w)) continue;
    const max = w.length >= 5 ? 2 : 1;
    let best: {k: string; d: number; n: number} | null = null;
    const rank = (x: {k: string; d: number; n: number}) => [x.d, Number(x.k[0] !== w[0]), Number(x.k.length !== w.length), -x.n];
    const before = (x: {k: string; d: number; n: number}, y: {k: string; d: number; n: number}) => {const a = rank(x), b = rank(y), i = a.findIndex((v, j) => v !== b[j]); return i >= 0 ? a[i] < b[i] : x.k < y.k;};
    for (const [k, n] of known) {
      if (Math.abs(k.length - w.length) > max || STOP.has(k)) continue;
      // two edits only keep the first letter (typos rarely change it: "couch" is not "south")
      const d = osa(w, k, max); if (d > max || (d === 2 && k[0] !== w[0])) continue;
      // ties: the same first letter, the same length (a swap: "hrose" is "horse", not "rose"), the commoner word
      const c = {k, d, n}; if (!best || before(c, best)) best = c;
    }
    // a real word nearer than any of this world's ("hrose" is a horse, and Mars has none): no reading, an honest refusal
    if (best && ![...LEXICON].some(x => !known.has(x) && Math.abs(x.length - w.length) < best!.d && osa(w, x, best!.d - 1) < best!.d)) fixes.push([w, best.k]);
  }
  if (!fixes.length) return null;
  let text = input;
  for (const [w, k] of fixes) text = text.replace(new RegExp(`\\b${w}\\b`, 'gi'), k);
  return {text, fixes};
}
/** The words this world knows for typoFix, with how often each occurs. Rebuilt only when the offered ids, the known places or
 *  the extra names change (a dry run reads it once per refusal; building it each time was most of a refusal's cost). */
let knownMemo: {key: string; extra: unknown; known: Map<string, number>} | null = null;
let synonymWords: [string, number][] | null = null;
function knownWords(ctx: VocabContext, extra: Iterable<string>): Map<string, number> {
  const key = ctx.caps.map(c => c.id).join('\n') + '\0' + ctx.places.map(p => `${p.id}|${p.name}|${p.description?.length ?? 0}|${p.aliases?.length ?? 0}`).join('\n');
  const same = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) && !a.length && !b.length);
  if (knownMemo && knownMemo.key === key && Array.isArray(extra) && same(knownMemo.extra, extra)) return knownMemo.known;
  const count = (into: Map<string, number>, s: string | undefined) => {if (s) for (const t of tokens(s)) if (t.length >= 3 && !/\d/.test(t)) into.set(t, (into.get(t) ?? 0) + 1);};
  if (!synonymWords) {const m = new Map<string, number>(); for (const [k, v] of Object.entries(SYNONYMS)) {count(m, k); for (const x of v) count(m, x);} synonymWords = [...m];}
  const known = new Map<string, number>(synonymWords), add = (s: string | undefined) => count(known, s);
  for (const c of ctx.caps) {add(c.id.slice(c.id.indexOf(':') + 1)); add(c.label.replace(/,\s*by\s.*$/, ''));}
  for (const p of ctx.places) {add(p.name); add(p.id); add(p.description); for (const a of p.aliases ?? []) add(a);}
  for (const w of extra) add(w);
  knownMemo = {key, extra, known};
  return known;
}
/** Everyday words for things and places that are spelt right: never read as another word (Mars has no horse: "go to the
 *  horse" is not the bunk house; "stable" is not a table, "couch" not the south). Only guards the typo fallback. */
const LEXICON = new Set(('horse horses pony donkey cow cows sheep goat goats pig pigs chicken chickens hen duck ducks goose swan bird birds dog dogs cat cats ' +
  'rabbit deer fox fish frog bear lion tiger monkey dragon unicorn cattle animal animals boat boats ship ships canoe kayak yacht car cars bus train tram plane ' +
  'airport station taxi bike bicycle house houses home cottage castle tower church chapel temple school college shop shops store market beach sea ocean lake ' +
  'river stream pond pool forest woods tree trees park garden farm barn stable stables field fields meadow mountain hill hills cave bridge road street lane ' +
  'lighthouse harbour harbor pier dock jetty hotel cafe coffee restaurant bar pub bakery library museum gallery theatre theater cinema hospital clinic office ' +
  'bank post kitchen bedroom bathroom toilet bed beds chair chairs couch sofa table tables bench benches desk door window stairs roof attic cellar basement ' +
  'fire campfire fountain statue well gate wall fence tent hut cabin shed palace island volcano desert jungle zoo playground swing slide gym stadium court ' +
  'south north east west centre center middle upstairs downstairs outside inside nearby somewhere').split(' '));
/** Optimal string alignment distance (a swap of two neighbours is one edit), cut off past `max`. */
function osa(a: string, b: string, max: number): number {
  const m = a.length, n = b.length; let p2: number[] = [], p1 = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let low = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < low) low = v;
    }
    if (low > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[n];
}

/** D3c (laptop trio-r1 rook-003: "have a little rest, then come back to the balloon" was closed Done by a wave): an
 *  owner message's steps in order, each the verbs its words name (whole-sentence intents and plain verbs, a vague one
 *  widened: a rest is any way of resting, coming back any way of getting there). Steps naming no verb are left out; a
 *  message naming none has no steps (nothing to judge an act by).
 *  D3d (fix-d3c-c trio-r1 rook-003: a walk to a bench closed "…then come back to the balloon"): each step also has its
 *  target, what its other words name through `resolve` (the ledger's resolver: places, things, Souls by id). Words that
 *  name nothing to resolve ("a comfy spot", "me") leave `target: null`; words the resolver cannot place leave
 *  `target: null, unresolved: true`. Without `resolve` no target is judged. */
export type StepTarget = {places: string[]; things: string[]; souls: string[]};
export type MessageStep = {verbs: string[]; target: StepTarget | null; unresolved?: true; words?: string};
const STEP_SPLIT = /[.!?;,]+|\b(?:and )?then\b|\bafter(?:wards| that)\b/;
const STEP_WIDEN: Record<string, string[]> = {rest: ['sit', 'sit-ground', 'lie', 'nap', 'hammock'], nap: ['lie'], lie: ['nap'], sit: ['sit-ground'],
  walk: ['run', 'jog', 'go-near', 'stroll'], 'go-near': ['walk'], ride: ['join']};
/** Words of a step that carry its act or its manner, never its target. */
const STEP_FILLER = new Set(['meet', 'say', 'hi', 'hello', 'hey', 'rest', 'relax', 'break', 'breather', 'wait', 'us', 'again', 'look', 'bit', 'moment', 'first', 'okay', 'ok', 'well', 'done', 'aww', 'thanks', 'thank', 'yes', 'sure', 'stay', 'staying']);
let stepVerbs: Set<string> | null = null;
export function messageSteps(text: string, resolve?: (words: string[]) => StepTarget | null): MessageStep[] {
  stepVerbs ??= new Set([...Object.values(VERBS), ...INTENTS.map(i => i[1]), ...GO_FOR_X.map(i => i[1])]);
  const out: MessageStep[] = [];
  for (const part of text.toLowerCase().split(STEP_SPLIT)) {
    const words = part.split(/[^a-z0-9]+/).filter(Boolean), v = new Set<string>();
    for (const [re, verb] of INTENTS) if (re.test(part)) v.add(verb);
    for (let i = 0; i < words.length; i++) for (let n = 3; n >= 1; n--) {const k = words.slice(i, i + n).join('-'); const c = VERBS[k] ?? (stepVerbs.has(k) ? k : null); if (c) v.add(c);}
    if (/\b(?:rest|relax|break|breather)\b/.test(part)) v.add('rest');
    if (RIDE_WORDS.test(part)) v.add('ride');
    for (const x of [...v]) for (const w of STEP_WIDEN[x] ?? []) v.add(w);
    if (!v.size) continue;
    const named = resolve ? tokens(part).filter(w => !FILLER.has(w) && !STEP_FILLER.has(w) && !VERBS[w] && !stepVerbs!.has(w)) : [];
    const target = named.length ? resolve!(named) : null;
    out.push({verbs: [...v], target, ...(named.length ? {words: named.join(' '), ...(target ? {} : {unresolved: true as const})} : {})});
  }
  return out;
}

/** Distance to the actual boundary, zero inside; no centroid bias for a long lake. */
export function placeEdgeDistance(place: Pick<VocabPlace,'polygon'|'center'>, at:[number,number]):number {
  const poly=place.polygon;if(!poly?.length)return dist(place.center,at);if(inPoly(at[0],at[1],poly))return 0;
  let best=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((at[0]-a[0])*dx+(at[1]-a[1])*dz)/l)):0;best=Math.min(best,Math.hypot(at[0]-a[0]-t*dx,at[1]-a[1]-t*dz));}return best;
}
