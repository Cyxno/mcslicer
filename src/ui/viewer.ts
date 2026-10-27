/**
 * three.js viewer + slicer mode.
 *
 * Rendering model: one InstancedMesh per (block type × slice). Slice
 * isolation is done with materials, not visibility: the current slice's
 * meshes get the bright per-type material, everything else a dimmed variant
 * of the same hue. Chosen over hiding so the build stays spatially
 * navigable (Shulkr-style) — documented in the README.
 *
 * This module touches the DOM and three.js on purpose — rendering itself is
 * verified visually, not by unit tests. All ordering/progress/material logic
 * lives in src/slicer and src/render and is tested there.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseSchem } from '../schem/parse.js';
import type { Schematic } from '../schem/types.js';
import {
  buildSlicerModel,
  currentSlice,
  initialState,
  jumpTo,
  nextStep,
  prevStep,
  progressLabel,
  type Axis,
  type SlicerModel,
  type SlicerState,
} from '../slicer/steps.js';
import { materialTable, sortRows, type MaterialRow, type SortDir, type SortKey } from '../slicer/materials.js';
import { colorForBlock } from '../render/colors.js';

const BLOCK = new BoxGeometry(1, 1, 1);
const DIM_FACTOR = 0.28;

interface SliceMesh {
  mesh: InstancedMesh;
  sliceCoord: number;
  typeIndex: number;
}

export class Viewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly status: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly matBody: HTMLElement;
  private readonly matSliceLabel: HTMLElement;

  private meshes: InstancedMesh[] = [];
  private sliceMeshes: SliceMesh[] = [];
  private brightMats: MeshLambertMaterial[] = [];
  private dimMats: MeshLambertMaterial[] = [];

  private schem: Schematic | null = null;
  private model: SlicerModel | null = null;
  private state: SlicerState = initialState();
  private sliceCoord = -1;
  private sortKey: SortKey = 'total';
  private sortDir: SortDir = 'desc';

  constructor(canvas: HTMLCanvasElement, els: {
    status: HTMLElement;
    progress: HTMLElement;
    slider: HTMLInputElement;
    matBody: HTMLElement;
    matSliceLabel: HTMLElement;
  }) {
    this.status = els.status;
    this.progress = els.progress;
    this.slider = els.slider;
    this.matBody = els.matBody;
    this.matSliceLabel = els.matSliceLabel;

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.camera = new OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 4000);
    this.camera.position.set(30, 30, 30);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.background = new Color(0x1b1e24);
    this.scene.add(new AmbientLight(0xffffff, 1.1));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 0.7);
    this.scene.add(sun);

    this.resize();
    window.addEventListener('resize', () => this.resize());

    const loop = (): void => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = Math.max(canvas.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const zoom = this.camera.zoom;
    const halfH = 10 / zoom;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('error', isError);
  }

  private showError(err: unknown, label: string): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.setStatus(`Could not load ${label}: ${detail}`, true);
  }

  private clearModel(): void {
    for (const mesh of [...this.meshes, ...this.sliceMeshes.map((s) => s.mesh)]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.sliceMeshes = [];
    this.brightMats = [];
    this.dimMats = [];
  }

  /** Frame the model and set the group transform used by both modes. */
  private frameModel(scale: number, size: Schematic['size']): void {
    this.controls.target.set(0, (size.y * scale) / 2, 0);
    const fit = 14 / Math.max(size.x, size.y, size.z);
    this.camera.zoom = Math.min(Math.max(fit, 0.05), 20);
    this.camera.position.set(1, 0.8, 1).normalize().multiplyScalar(1000 / this.camera.zoom);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Parse bytes and display in slicer mode; all failures are visible. */
  async loadFile(bytes: Uint8Array, label: string, axis: Axis = 'y'): Promise<void> {
    this.setStatus(`Parsing ${label}…`);
    try {
      const schem = await parseSchem(bytes);
      this.showSlicer(schem, axis);
    } catch (err) {
      this.clearModel();
      this.showError(err, label);
    }
  }

  /** Fetch the demo asset and display; fetch failures are visible too. */
  async loadDemo(url: string, label: string, axis: Axis = 'y'): Promise<void> {
    this.setStatus(`Loading ${label}…`);
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await this.loadFile(bytes, label, axis);
    } catch (err) {
      this.clearModel();
      this.showError(err, label);
    }
  }

  /** Enter (or re-enter) slicer mode for a schematic on the given axis. */
  showSlicer(schem: Schematic, axis: Axis): void {
    this.clearModel();
    this.schem = schem;
    this.model = buildSlicerModel(schem, axis);
    this.state = initialState();
    this.sliceCoord = -1;

    const centerX = schem.size.x / 2;
    const centerZ = schem.size.z / 2;
    const scale = 16 / Math.max(schem.size.x, schem.size.y, schem.size.z);
    const group = new Matrix4();
    group.makeScale(scale, scale, scale);
    group.setPosition(-centerX * scale, 0, -centerZ * scale);

    // Group steps by (slice, type); one InstancedMesh per group.
    const groups = new Map<string, { typeIndex: number; sliceCoord: number; coords: number[][] }>();
    const typeColors = new Map<number, number>();
    for (const step of this.model.steps) {
      const key = `${step.slice}|${step.paletteIndex}`;
      let g = groups.get(key);
      if (!g) {
        g = { typeIndex: step.paletteIndex, sliceCoord: step.slice, coords: [] };
        groups.set(key, g);
      }
      g.coords.push([step.x + 0.5, step.y + 0.5, step.z + 0.5]);
      typeColors.set(step.paletteIndex, colorOf(step.paletteIndex, schem));
    }
    // Build per-type material pairs once, in palette order.
    const paletteIndices = [...typeColors.keys()].sort((a, b) => a - b);
    const typeToSlot = new Map<number, number>();
    for (const p of paletteIndices) {
      const color = typeColors.get(p)!;
      const bright = new MeshLambertMaterial({ color });
      const dimColor = new Color(color).multiplyScalar(DIM_FACTOR);
      const dim = new MeshLambertMaterial({ color: dimColor });
      typeToSlot.set(p, this.brightMats.length);
      this.brightMats.push(bright);
      this.dimMats.push(dim);
    }

    const placement = new Matrix4();
    for (const g of groups.values()) {
      const mesh = new InstancedMesh(BLOCK, this.dimMats[typeToSlot.get(g.typeIndex)!]!, g.coords.length);
      for (let i = 0; i < g.coords.length; i++) {
        const c = g.coords[i]!;
        placement.makeTranslation(c[0]!, c[1]!, c[2]!);
        mesh.setMatrixAt(i, placement);
      }
      mesh.applyMatrix4(group);
      this.scene.add(mesh);
      this.sliceMeshes.push({ mesh, sliceCoord: g.sliceCoord, typeIndex: typeToSlot.get(g.typeIndex)! });
    }

    const slices = this.model.slices;
    this.slider.min = '0';
    this.slider.max = String(Math.max(slices.length - 1, 0));
    this.slider.value = '0';
    this.slider.disabled = slices.length <= 1;

    this.frameModel(scale, schem.size);
    this.setStep(this.model.total > 0 ? 0 : -1);
    const axisNames = { x: 'X', y: 'Y', z: 'Z' } as const;
    this.setStatus(
      `${schem.size.x}×${schem.size.y}×${schem.size.z} — ${this.model.total} blocks, ` +
      `${paletteIndices.length} types, ${slices.length} lagen langs ${axisNames[axis]}`,
    );
  }

  private sliceIndex(coord: number): number {
    if (!this.model) return 0;
    return Math.max(this.model.slices.findIndex((s) => s.coord === coord), 0);
  }

  setSliceCoord(coord: number): void {
    this.sliceCoord = coord;
    for (const entry of this.sliceMeshes) {
      entry.mesh.material =
        entry.sliceCoord === coord ? this.brightMats[entry.typeIndex]! : this.dimMats[entry.typeIndex]!;
    }
    this.slider.value = String(this.sliceIndex(coord));
    this.refreshMaterials();
  }

  /** Slider input: land on the first step of the chosen slice index. */
  setSliceIndex(index: number): void {
    if (!this.model || this.model.slices.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), this.model.slices.length - 1);
    this.setStep(this.model.slices[clamped]!.firstStep);
  }

  setStep(step: number): void {
    if (!this.model || this.model.total === 0) {
      this.progress.textContent = 'geen blocks';
      this.refreshMaterials();
      return;
    }
    this.state = jumpTo(this.model, this.state, step);
    const slice = currentSlice(this.model, this.state);
    if (slice && slice.coord !== this.sliceCoord) this.setSliceCoord(slice.coord);
    this.progress.textContent = progressLabel(this.model, this.state);
    this.refreshMaterials();
  }

  stepNext(): void { if (this.model) this.setStep(nextStep(this.model, this.state).step); }
  stepPrev(): void { if (this.model) this.setStep(prevStep(this.model, this.state).step); }

  sliceShift(delta: number): void {
    if (!this.model || this.model.slices.length === 0) return;
    const idx = Math.min(Math.max(this.sliceIndex(this.sliceCoord) + delta, 0), this.model.slices.length - 1);
    const target = this.model.slices[idx]!;
    // Land on the first step of the target slice (Shulkr behaviour).
    this.setStep(target.firstStep);
  }

  /** As-kiezer: rebuild the model on the new axis, keep position roughly. */
  setAxis(axis: Axis): void {
    if (!this.schem) return;
    this.showSlicer(this.schem, axis);
  }

  refreshMaterials(): void {
    if (!this.schem || !this.model) return;
    let rows: MaterialRow[] = [];
    if (this.sliceCoord >= 0) {
      rows = materialTable(this.schem, this.model.axis, this.sliceCoord);
    }
    if (this.sortKey === 'inSlice') rows = sortRows(rows, 'inSlice', this.sortDir);
    else if (this.sortKey === 'block') rows = sortRows(rows, 'block', this.sortDir);
    else rows = sortRows(rows, 'total', this.sortDir);

    this.matSliceLabel.textContent = this.sliceCoord >= 0 ? `(laag ${this.model.axis}=${this.sliceCoord})` : '';
    const html: string[] = [];
    for (const row of rows) {
      const color = colorForBlock(row.block);
      // 0-waardes verborgen: inSlice 0 renders as a muted dash, not a zero.
      const inSlice = row.inSlice === 0
        ? '<span class="zero">–</span>'
        : String(row.inSlice);
      const name = row.block.startsWith('minecraft:')
        ? row.block.slice('minecraft:'.length)
        : row.block;
      html.push(
        `<tr><td class="swatch"><span class="sw" style="background:#${color.toString(16).padStart(6, '0')}"></span></td>` +
        `<td class="blockname" title="${row.block}">${escapeHtml(name)}</td>` +
        `<td class="num">${row.total}</td><td class="num">${inSlice}</td></tr>`,
      );
    }
    this.matBody.innerHTML = html.join('');
  }

  setSort(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      this.sortKey = key;
      this.sortDir = key === 'block' ? 'asc' : 'desc';
    }
    this.refreshMaterials();
  }
}

function colorOf(paletteIndex: number, schem: Schematic): number {
  return colorForBlock(schem.palette[paletteIndex]!);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Wire drag-drop, demo button and all slicer controls. No server calls. */
export function initViewer(canvas: HTMLCanvasElement, statusEl: HTMLElement, demoUrl?: string): Viewer {
  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const viewer = new Viewer(canvas, {
    status: statusEl,
    progress: $('progress'),
    slider: $('slice-slider') as HTMLInputElement,
    matBody: $('materials-body'),
    matSliceLabel: $('mat-slice-label'),
  });
  viewer.setStatus('Sleep een .schem hierheen');

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    await viewer.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
  });

  const demoButton = $('demo-btn');
  if (demoButton && demoUrl) {
    demoButton.addEventListener('click', () => {
      viewer.loadDemo(demoUrl, 'demo-huisje.schem');
    });
  }

  // Axis buttons
  let currentAxis: Axis = 'y';
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.axis-btn')) {
    btn.addEventListener('click', () => {
      currentAxis = btn.dataset.axis as Axis;
      for (const b of document.querySelectorAll('.axis-btn')) b.classList.toggle('active', b === btn);
      try {
        viewer.setAxis(currentAxis);
      } catch (err) {
        viewer.setStatus(err instanceof Error ? `${err.name}: ${err.message}` : String(err), true);
      }
    });
  }

  // Slice slider (native arrows work when focused; PgUp/PgDn work globally).
  $('slice-slider').addEventListener('input', (e) => {
    viewer.setSliceIndex(Number((e.target as HTMLInputElement).value));
  });

  // Step buttons
  $('first-btn').addEventListener('click', () => viewer.setStep(0));
  $('last-btn').addEventListener('click', () => viewer.setStep(Number.MAX_SAFE_INTEGER));
  $('prev-btn').addEventListener('click', () => viewer.stepPrev());
  $('next-btn').addEventListener('click', () => viewer.stepNext());

  // Material sort headers
  for (const th of document.querySelectorAll<HTMLTableCellElement>('#materials th[data-sort]')) {
    th.addEventListener('click', () => viewer.setSort(th.dataset.sort as SortKey));
  }

  // Keyboard shortcuts (skip when typing into the slider so native keys win).
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); viewer.stepPrev(); break;
      case 'ArrowRight': e.preventDefault(); viewer.stepNext(); break;
      case 'PageUp': e.preventDefault(); viewer.sliceShift(+1); break;
      case 'PageDown': e.preventDefault(); viewer.sliceShift(-1); break;
      case 'Home': e.preventDefault(); viewer.setStep(0); break;
      case 'End': e.preventDefault(); viewer.setStep(Number.MAX_SAFE_INTEGER); break;
    }
  });

  return viewer;
}
