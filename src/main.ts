// Must run before any import that touches prismarine-nbt (evaluated in order).
import './schem/nodeShims.js';
import { initViewer } from './ui/viewer.js';
import { assetFilesFromFiles, assetFilesFromZip, AssetError } from './textures/assets.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const viewer = initViewer(canvas, status, demoUrl);

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
