// Must run before any import that touches prismarine-nbt (evaluated in order).
import './schem/nodeShims.js';
import { assetFilesFromFiles, assetFilesFromZip, AssetError } from './textures/assets.js';
import { introSeen, isIntroDismissKey, markIntroSeen } from './ui/intro.js';
import { formatLoadError } from './ui/errors.js';
import type { Viewer } from './ui/viewer.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const emptyState = document.getElementById('empty-state');

// The viewer (three.js + nbt parser) lives in a lazy chunk: the empty page
// paints from the entry alone and the module loads at first use — or at
// idle, whichever comes first — so it never blocks the first render.
let viewerPromise: Promise<Viewer> | null = null;
function loadViewer(): Promise<Viewer> {
  viewerPromise ??= import('./ui/viewer.js').then((m) => {
    const v = m.initViewer(canvas, status);
    v.onLoadError(showLoadError);
    return v;
  });
  return viewerPromise;
}

// ---- Load-error card: human message + retry, never a stack trace ----
const loadErrorCard = document.getElementById('load-error');

function showLoadError(err: unknown, label: string): void {
  if (!loadErrorCard) return;
  const view = formatLoadError(err, label);
  loadErrorCard.querySelector('.err-title')!.textContent = view.title;
  loadErrorCard.querySelector('.err-detail')!.textContent = view.detail;
  loadErrorCard.hidden = false;
  loadErrorCard.querySelector<HTMLElement>('#err-retry')?.focus();
}

function hideLoadError(): void {
  if (loadErrorCard) loadErrorCard.hidden = true;
}
document.getElementById('err-retry')?.addEventListener('click', () => {
  hideLoadError();
  (document.getElementById('schem-file') as HTMLInputElement | null)?.click();
});
document.getElementById('err-close')?.addEventListener('click', hideLoadError);
const whenIdle: (cb: () => void) => number =
  window.requestIdleCallback?.bind(window) ?? ((cb: () => void) => window.setTimeout(cb, 250));
whenIdle(() => void loadViewer());

async function openFile(file: File): Promise<void> {
  hideLoadError();
  const viewer = await loadViewer();
  const ok = await viewer.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
  if (emptyState) emptyState.hidden = ok;
}

async function loadDemo(): Promise<void> {
  hideLoadError();
  const viewer = await loadViewer();
  const ok = await viewer.loadDemo(demoUrl, 'demo-huisje.schem');
  if (emptyState) emptyState.hidden = ok;
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
      const ok = await viewer.loadFile(bytes, deepFile);
      if (emptyState) emptyState.hidden = ok;
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
document.getElementById('empty-demo')?.addEventListener('click', () => void loadDemo());

// ---- Empty state: dropzone + file picker before any schematic is loaded ----
const dropzone = document.getElementById('dropzone');
const schemInput = document.getElementById('schem-file') as HTMLInputElement;
// Click = file picker (the mobile path, where drag-and-drop is unavailable).
dropzone?.addEventListener('click', () => schemInput.click());
dropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone?.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});
schemInput.addEventListener('change', async () => {
  const file = schemInput.files?.[0];
  if (file) await openFile(file);
  schemInput.value = '';
});

// ---- Intro overlay (first visit only, keyboard operable) ----
const intro = document.getElementById('intro');
let introOpen = false;
let introReturnFocus: HTMLElement | null = null;

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )];
}

function showIntro(): void {
  if (!intro || introOpen) return;
  introOpen = true;
  intro.hidden = false;
  document.getElementById('app')?.setAttribute('inert', '');
  introReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  focusablesIn(intro)[0]?.focus();
}

function closeIntro(): void {
  if (!intro || !introOpen) return;
  introOpen = false;
  intro.hidden = true;
  document.getElementById('app')?.removeAttribute('inert');
  markIntroSeen(window.localStorage);
  introReturnFocus?.focus();
  introReturnFocus = null;
}

intro?.addEventListener('keydown', (e) => {
  if (isIntroDismissKey(e.key)) {
    e.preventDefault();
    closeIntro();
    return;
  }
  if (e.key !== 'Tab' || !introOpen || !intro) return;
  // Focus trap: Tab cycles inside the dialog; if focus somehow landed
  // outside, pull it back in.
  const f = focusablesIn(intro);
  if (f.length === 0) return;
  const first = f[0]!;
  const last = f[f.length - 1]!;
  const active = document.activeElement;
  const escaped = active !== null && !intro.contains(active);
  if (e.shiftKey && (active === first || escaped)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || escaped)) {
    e.preventDefault();
    first.focus();
  }
});
document.getElementById('intro-start')?.addEventListener('click', () => closeIntro());
document.getElementById('intro-demo')?.addEventListener('click', () => {
  closeIntro();
  void loadDemo();
});
if (!introSeen(window.localStorage)) showIntro();
