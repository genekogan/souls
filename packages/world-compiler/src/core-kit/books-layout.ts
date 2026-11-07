// #428 books and notebooks: the constants the server and the viewer share, without the library data (books.ts holds
// the defs; keeping this module data-free keeps the def JSON out of the web bundle).
/** The library catalogue's book ids (apps/server/src/edge/content/eden-library-catalogue.ts; a server test keeps
 *  them equal). '' = no particular book. */
export const LECTERN_BOOKS = ['', 'book:gardens-guide', 'book:library-window', 'book:commons-map', 'book:bench-pause',
  'book:one-speaker', 'book:four-tables', 'book:ember-colour', 'book:long-table', 'book:bank-sketch', 'book:pond-mirror',
  'book:chalk-question', 'book:south-lawn', 'book:stone-gate', 'book:teal-roof', 'book:striped-stalls', 'book:crate-label',
  'book:tea-cup', 'book:mosaic-circle', 'book:bunting-letter', 'book:three-steps', 'book:stage-lamp', 'book:woods-margin',
  'book:park-ring', 'book:white-gazebo', 'book:playground-scale', 'book:harbour-lines', 'book:boardwalk-echo',
  'book:west-pier-knot', 'book:east-pier-distance', 'book:beach-colours', 'book:village-mural', 'book:painted-spheres',
  'book:old-town-water'] as const;

/** A notebook's lines: how many fit on the page, per Soul, and how long one is. */
export const NOTEBOOK_LINES_MAX = 8, NOTEBOOK_PER_SOUL = 2, NOTEBOOK_TEXT_MAX = 60;
/** The page's slope from vertical (the lectern top is pitched 0.3 rad from horizontal toward the reader). */
export const NOTEBOOK_TILT = Math.PI / 2 - 0.3;
/** Where line i sits on the page (face-local metres, x right, y up the page, away from the writer), first line first.
 *  The lines fill the near half of the page, under its printed heading, so every line is within an easy reach of a
 *  body standing clear of the lectern (0.40-0.51 m out). Shared by the viewer's handwriting and the writing hand. */
export const notebookLine = (i: number): [number, number] => [0, -0.01 - i * 0.016];
