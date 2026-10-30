// Must run before any import that touches prismarine-nbt (evaluated in order).
import './schem/nodeShims.js';
import { assetFilesFromFiles, assetFilesFromZip, AssetError } from './textures/assets.js';
import type { Viewer } from './ui/viewer.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;

// The viewer (three.js + nbt parser) lives in a lazy chunk: the empty page
// paints from the entry alone and the module loads at first use — or at
// idle, whichever comes first — so it never blocks the first render.
let viewerPromise: Promise<Viewer> | null = null;
function loadViewer(): Promise<Viewer> {
  viewerPromise ??= import('./ui/viewer.js').then((m) => m.initViewer(canvas, status));
  return viewerPromise;
}
const whenIdle: (cb: () => void) => number =
  window.requestIdleCallback?.bind(window) ?? ((cb: () => void) => window.setTimeout(cb, 250));
whenIdle(() => void loadViewer());

async function openFile(file: File): Promise<void> {
  const viewer = await loadViewer();
  await viewer.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function loadDemo(): Promise<void> {
  const viewer = await loadViewer();
  await viewer.loadDemo(demoUrl, 'demo-huisje.schem');
}

// Drag & drop: the canvas is the primary target; the window handlers only
// act when no more specific handler took the event (defaultPrevented), so
// drops anywhere still land and the browser never navigates to the file.
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});
window.addEventListener('dragover', (e) => {
  if (!e.defaultPrevented) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

// Deep-link: ?file=<naam>.schem (relative to base), ?guide=1, ?step=N.
// Same-origin only — the value is joined against document.baseURI and may
// not escape it.
const params = new URLSearchParams(location.search);
const deepFile = params.get('file');
if (deepFile && !deepFile.includes('..') && deepFile.endsWith('.schem')) {
  void (async () => {
    try {
      const bytes = new Uint8Array(await (await fetch(new URL(deepFile, document.baseURI))).arrayBuffer());
      const viewer = await loadViewer();
      await viewer.loadFile(bytes, deepFile);
      if (params.get('guide') === '1') viewer.setGuideMode(true);
      const dir = params.get('dir');
      if (dir === 'x' || dir === 'z' || dir === 'xz') {
        viewer.setGuideDir({
          dirX: dir === 'x' || dir === 'xz' ? -1 : 1,
          dirZ: dir === 'z' || dir === 'xz' ? -1 : 1,
        });
      }
      const cap = params.get('cap');
      if (cap === 'per-block' || cap === 'row' || (cap && /^\d+$/.test(cap))) {
        viewer.setGuideCap(cap === 'per-block' || cap === 'row' ? cap : Number(cap) as never);
      }
      const step = Number(params.get('step'));
      if (Number.isInteger(step) && step >= 0) {
        if (params.get('guide') === '1') viewer.setGuideStep(step);
        else viewer.setStep(step);
      }
    } catch (err) {
      const viewer = await loadViewer();
      viewer.setStatus(err instanceof Error ? err.message : String(err), true);
    }
  })();
}

// Phase 4a: the user points at their own assets (directory or pack zip).
// Everything is read client-side in memory; nothing is uploaded.
const dirInput = document.getElementById('assets-dir') as HTMLInputElement;
const zipInput = document.getElementById('assets-zip') as HTMLInputElement;
document.getElementById('assets-dir-btn')?.addEventListener('click', () => dirInput.click());
document.getElementById('assets-zip-btn')?.addEventListener('click', () => zipInput.click());

dirInput.addEventListener('change', async () => {
  const files = dirInput.files;
  if (!files || files.length === 0) return;
  const viewer = await loadViewer();
  await viewer.setAssets(await assetFilesFromFiles(files), `${files.length} bestanden`);
  dirInput.value = '';
});

zipInput.addEventListener('change', async () => {
  const file = zipInput.files?.[0];
  if (!file) return;
  try {
    const viewer = await loadViewer();
    await viewer.setAssets(await assetFilesFromZip(new Uint8Array(await file.arrayBuffer())), file.name);
  } catch (err) {
    const detail = err instanceof AssetError ? err.message : String(err);
    const viewer = await loadViewer();
    viewer.setStatus(`Zip niet gelezen: ${detail}`, true);
  }
  zipInput.value = '';
});

// Demo button (topbar; the intro overlay and empty state reuse loadDemo).
document.getElementById('demo-btn')?.addEventListener('click', () => void loadDemo());
