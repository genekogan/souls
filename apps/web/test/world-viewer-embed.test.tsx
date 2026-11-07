import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveWorld } from '../src/LiveWorld.tsx';
import type { Souls } from '../src/useSouls.ts';

// Real component structure, no graphics/provider/server needed. This does not
// execute effects or qualify GPU controls; App's mounted consumer remains next.
const sim = { conn: { welcome: null, heartbeat: null, stats: { state: 'closed' },
  replica: { souls: new Map() } }, plays: [], takes: null } as unknown as Souls;

test('actual LiveWorld embedded layout exposes stable selectors without raw camera/history controls', () => {
  const html = renderToStaticMarkup(createElement(LiveWorld, { sim, selected: null, onSelect() {}, embedded: true, hideControls: true }));
  assert.match(html, /class="wide world-viewer" data-world-viewer="1"/);
  assert.match(html, /class="world-viewport"/);
  assert.match(html, /class="world-canvas-host"/);
  assert.match(html, /height:100%/);
  assert.doesNotMatch(html, /height:540px/);
  assert.doesNotMatch(html, /<button|type="range"|Drag to look around/);
});

test('existing standalone component keeps its default height and debugging controls', () => {
  const html = renderToStaticMarkup(createElement(LiveWorld, { sim, selected: null, onSelect() {} }));
  assert.match(html, /height:540px/);
  assert.match(html, /Broadcast<\/button>/);
  assert.match(html, /Look back over the last hour/);
});


test('hideSoulInfo removes only the duplicate selected Soul panel without removing stable viewport', () => {
  const selectedSim = { ...sim, conn: { ...sim.conn, replica: { ...sim.conn.replica,
    souls: new Map([['soul-1', {id:'soul-1',entityId:'body-1',name:'Fixture Soul',description:'Public description',doing:'idle'}]]) } } } as unknown as Souls;
  const render = (hideSoulInfo: boolean) => renderToStaticMarkup(createElement(LiveWorld,{sim:selectedSim,selected:'soul-1',onSelect(){},hideSoulInfo,hideControls:true,embedded:true}));
  assert.match(render(false),/world-selection-info world-soul-info/);
  assert.match(render(false),/Public description/);
  assert.doesNotMatch(render(true),/world-soul-info|Public description/);
  assert.match(render(true),/world-viewport/);
});
