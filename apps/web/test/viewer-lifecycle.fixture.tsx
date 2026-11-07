// Test-only browser entry; bundled into ignored dist/assets by the proof runner.
// Mount the real viewer/useSouls against the isolated fake server, no engine mocks.
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveWorld } from '../src/LiveWorld.tsx';
import { useSouls } from '../src/useSouls.ts';
import type { WorldViewerHandle, WorldViewerState } from '../src/WorldViewer.ts';
const token = async () => null;
const audit: { states: WorldViewerState[]; handles: boolean[]; handle: WorldViewerHandle | null } = { states: [], handles: [], handle: null };
function Probe() {
  const sim = useSouls(token, false);
  const [selected, select] = useState<string | null>(null);
  const handle = useCallback((h: WorldViewerHandle | null) => { audit.handles.push(!!h); audit.handle = h; }, []);
  const state = useCallback((s: WorldViewerState) => { audit.states.push(s); }, []);
  return <LiveWorld sim={sim} selected={selected} onSelect={select} onViewerHandle={handle} onViewerState={state} embedded hideControls />;
}
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:100;background:white';
document.body.append(host);
const root = createRoot(host);
Object.assign(window, { __viewerProbe: { audit, unmount: () => { root.unmount(); host.remove(); } } });
root.render(<Probe />);
