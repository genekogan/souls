// Soul Actions family #428, books and notebooks. Frozen core-lectern@1 bytes stay intact (vocab-w3.json):
// core-lectern@2 is a revision whose `book` names a book of the published library catalogue (its id), so reading at it
// reads that book's passages in any world; '' (the default) keeps @1's reading. core-notebook-stand@1 is the same
// lectern holding an open notebook: Souls write one signed line each by hand and others read the lines later. It is the
// pinboard's faculty (entry 19: signed lines, author-only cross-out, read on purpose) with data only: the tags, the
// limits below and the line layout on the sloped page.
import vocabW3 from './vocab-w3.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';
import { LECTERN_BOOKS, NOTEBOOK_LINES_MAX, NOTEBOOK_PER_SOUL, NOTEBOOK_TEXT_MAX, NOTEBOOK_TILT } from './books-layout.ts';

const lecternV1 = (vocabW3 as unknown as DefInput[]).find(d => d.name === 'core-lectern')!;
const lectern: DefInput = { ...structuredClone(lecternV1), version: 2,
  description: `${lecternV1.description} A god can set the book it holds (one of the library catalogue's books); a Soul reading at it reads that book, a passage at a time.`,
  params: { ...structuredClone(lecternV1.params), book: { type: 'enum', values: [...LECTERN_BOOKS], default: '', doc: "the library book open on it (a catalogue id); '' = no particular book" } } };

const notebookMake = structuredClone(lecternV1.make) as unknown as { args: { shapes: unknown[]; faces?: unknown[] } };
// the page's top surface: 0.015 m above the page box's centre along its normal (pitch 0.3: [0, cos, sin]), plus 2 mm
notebookMake.args.faces = [{ at: [0, 1.177, 0.005], w: 0.4, h: 0.28, pitch: -NOTEBOOK_TILT, bg: '#f4eedc', ink: '#23305c' }];
const notebookStand: DefInput = { ...structuredClone(lecternV1), name: 'core-notebook-stand', version: 1,
  description: `A wooden lectern holding an open notebook. Souls write in it by hand, one signed line each (up to ${NOTEBOOK_LINES_MAX} lines, ${NOTEBOOK_PER_SOUL} per Soul), and anyone nearby can read what is written; only a line's writer crosses it out.`,
  tags: [...(lecternV1.tags ?? []), 'signage', 'hand-writable', 'pinboard', 'notebook'],
  make: notebookMake as unknown as DefInput['make'],
  state: { text: { type: 'string', max: NOTEBOOK_LINES_MAX * (NOTEBOOK_TEXT_MAX + 44), default: '' }, textBy: { type: 'string', max: NOTEBOOK_LINES_MAX * 41, default: '' } } as DefInput['state'],
  components: { sign: { lines: [] } } as DefInput['components'],
  synonyms: ['notebook', 'guest book', 'visitors book', 'logbook', 'journal'],
  actions: [
    { name: 'pin', label: 'Write a line in the notebook', params: { text: { type: 'string', max: NOTEBOOK_TEXT_MAX, doc: `your line: up to ${NOTEBOOK_TEXT_MAX} characters; it is signed with your name` } },
      then: [{ op: 'set', field: 'text', value: { param: 'text' } }, { op: 'set', field: 'textBy', value: '' }] },
    { name: 'unpin', label: 'Cross out your line in the notebook', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
  ] as NonNullable<DefInput['actions']> } as DefInput;

export const BOOK_DEFS: DefInput[] = [lectern, notebookStand];
