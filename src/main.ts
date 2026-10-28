// Must run before any import that touches prismarine-nbt (evaluated in order).
import './schem/nodeShims.js';
import { initViewer } from './ui/viewer.js';
import { assetFilesFromFiles, assetFilesFromZip, AssetError } from './textures/assets.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const viewer = initViewer(canvas, status, demoUrl);

// Deep-link: ?file=<naam>.schem (relative to base), ?guide=1, ?step=N.
// Same-origin only — the value is joined against document.baseURI and may
// not escape it.
const params = new URLSearchParams(location.search);
const deepFile = params.get('file');
if (deepFile && !deepFile.includes('..') && deepFile.endsWith('.schem')) {
  void (async () => {
    try {
      const bytes = new Uint8Array(await (await fetch(new URL(deepFile, document.baseURI))).arrayBuffer());
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
  await viewer.setAssets(await assetFilesFromFiles(files), `${files.length} bestanden`);
  dirInput.value = '';
});

zipInput.addEventListener('change', async () => {
  const file = zipInput.files?.[0];
  if (!file) return;
  try {
    await viewer.setAssets(await assetFilesFromZip(new Uint8Array(await file.arrayBuffer())), file.name);
  } catch (err) {
    const detail = err instanceof AssetError ? err.message : String(err);
    viewer.setStatus(`Zip niet gelezen: ${detail}`, true);
  }
  zipInput.value = '';
});
