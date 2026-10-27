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
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  GridHelper,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  NearestFilter,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  Vector3,
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
import { resolveBlockstate } from '../textures/atlas.js';
import { boxFaceUVs } from '../textures/faces.js';
import { buildAtlas, type AtlasResult } from '../textures/loader.js';
import { treeFromAssetFiles, type AssetFiles } from '../textures/assets.js';
import { tintForBlock } from '../textures/tint.js';

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
  /** Geometries cloned per textured type; disposed with the model. */
  private texturedGeoms: BufferGeometry[] = [];
  /** Subtle ground grid under the model (Shulkr-style), rebuilt per model. */
  private grid: GridHelper | null = null;
  private cameraMode: 'orbit' | 'plan' = 'orbit';
  /** Current group transform (scale + centering), reused by framing. */
  private groupTransform: Matrix4 | null = null;
  private modelScale = 1;

  // Texture pipeline (phase 4a): when the user supplies assets, block
  // types with resolvable textures render UV-mapped against one shared
  // atlas; all other types keep color rendering. Both material kinds mix
  // in one scene — documented in the README.
  private assets: AssetFiles | null = null;
  private atlas: AtlasResult | null = null;
  private atlasTexture: CanvasTexture | null = null;
  private lastTextureReport = '';

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
    for (const geom of this.texturedGeoms) geom.dispose();
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
      this.grid = null;
    }
    this.meshes = [];
    this.sliceMeshes = [];
    this.brightMats = [];
    this.dimMats = [];
    this.texturedGeoms = [];
  }

  /**
   * Supply user assets (from a picked directory or pack zip) and rebuild.
   * The atlas is built from exactly the textures the current schematic's
   * palette resolves to; failures surface in the status line, never
   * silently. All processing is client-side.
   */
  async setAssets(files: AssetFiles, label: string): Promise<void> {
    this.setStatus(`Textures indexeren (${label})…`);
    try {
      const tree = treeFromAssetFiles(files);
      if (tree.size === 0) {
        throw new Error('geen assets/ met blockstates of textures gevonden in deze bron');
      }
      this.assets = files;
      this.assetTree = tree;
      this.atlasPaletteKey = ''; // force rebuild against this source
    } catch (err) {
      this.assets = null;
      this.assetTree = null;
      this.atlas = null;
      this.lastTextureReport = '';
      const detail = err instanceof Error ? err.message : String(err);
      this.setStatus(`Textures niet geladen: ${detail}`, true);
      return;
    }
    if (this.schem) {
      await this.ensureAtlas(this.schem);
      this.showSlicer(this.schem, this.model?.axis ?? 'y');
    } else {
      this.setStatus(`Textures geladen (${label}) — laad of wissel een .schem om te renderen`);
    }
  }

  /** Build/rebuild the atlas when the palette's texture set changed. */
  private async ensureAtlas(schem: Schematic): Promise<void> {
    if (!this.assets || !this.assetTree) return;
    const paths = new Set<string>();
    let resolvedCount = 0;
    let unresolvedCount = 0;
    for (const entry of schem.palette) {
      const r = resolveBlockstate(entry, this.assetTree);
      if (!r) {
        unresolvedCount++;
        continue;
      }
      resolvedCount++;
      for (const face of [r.faces.px, r.faces.nx, r.faces.py, r.faces.ny, r.faces.pz, r.faces.nz]) {
        if (face) paths.add(face);
      }
      if (r.texturePath) paths.add(r.texturePath);
    }
    const key = [...paths].sort().join('|');
    if (key === this.atlasPaletteKey && this.atlas) return;

    this.atlasTexture?.dispose();
    this.atlas = await buildAtlas(this.assets, [...paths].sort());
    this.atlasTexture = new CanvasTexture(this.atlas.canvas);
    this.atlasTexture.magFilter = NearestFilter;
    this.atlasTexture.minFilter = NearestFilter;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.colorSpace = 'srgb';
    this.atlasPaletteKey = key;

    const problems =
      this.atlas.missing.length + this.atlas.broken.length > 0
        ? `, ${this.atlas.missing.length + this.atlas.broken.length} textures → kleur-fallback`
        : '';
    this.lastTextureReport = `${resolvedCount} types met texture` +
      (unresolvedCount > 0 ? `, ${unresolvedCount} zonder blockstate` : '') + problems;
  }

  private assetTree: ReadonlyMap<string, unknown> | null = null;
  private atlasPaletteKey = '';

  /** Frame the model and set the group transform used by both modes. */
  private frameModel(scale: number, size: Schematic['size']): void {
    const center = new Vector3(
      0,
      (size.y * scale) / 2,
      0,
    );
    this.controls.target.copy(center);
    const fit = 14 / Math.max(size.x, size.y, size.z);
    this.camera.zoom = Math.min(Math.max(fit, 0.05), 20);
    if (this.cameraMode === 'plan') {
      // Top-down orthographic: straight down on the model center,
      // north (−z) up. Rotation disabled so plan stays plan.
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(0, 1000 / this.camera.zoom, 0);
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(1, 0.8, 1).normalize().multiplyScalar(1000 / this.camera.zoom);
    }
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.enableRotate = this.cameraMode === 'orbit';
    this.controls.update();
  }

  /** Orbit (perspective-ish orbit) or Plan (top-down ortho) view. */
  setCameraMode(mode: 'orbit' | 'plan'): void {
    this.cameraMode = mode;
    if (this.schem) {
      this.frameModel(this.modelScale, this.schem.size);
    }
  }

  /** Parse bytes and display in slicer mode; all failures are visible. */
  async loadFile(bytes: Uint8Array, label: string, axis: Axis = 'y'): Promise<void> {
    this.setStatus(`Parsing ${label}…`);
    try {
      const schem = await parseSchem(bytes);
      this.schem = schem; // available for ensureAtlas before showSlicer
      await this.ensureAtlas(schem);
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
    this.modelScale = scale;
    const group = new Matrix4();
    group.makeScale(scale, scale, scale);
    group.setPosition(-centerX * scale, 0, -centerZ * scale);
    this.groupTransform = group.clone();

    // Subtle ground grid under the build; 8-block cells, snapped to a
    // multiple of the cell so the grid extends evenly around the model.
    const cell = 8;
    const span = Math.ceil(Math.max(schem.size.x, schem.size.z) / cell) * cell + cell * 2;
    this.grid = new GridHelper(span, span / cell, 0x2a2f3a, 0x1f242e);
    this.grid.position.y = -0.01;
    this.scene.add(this.grid);

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
    // Build per-type material pairs once, in palette order. Types with a
    // resolvable texture get UV-mapped geometry against the shared atlas;
    // all other types keep color rendering (documented mix, README).
    const paletteIndices = [...typeColors.keys()].sort((a, b) => a - b);
    const typeToSlot = new Map<number, number>();
    const typeGeometry = new Map<number, BufferGeometry>();
    let texturedTypes = 0;
    for (const p of paletteIndices) {
      const block = schem.palette[p]!;
      const color = typeColors.get(p)!;
      const resolved = this.assetTree && this.atlas && this.atlasTexture
        ? resolveBlockstate(block, this.assetTree)
        : null;
      const rects = resolved && this.atlas
        ? {
            px: this.atlas.uvRects.get(resolved.faces.px ?? '') ?? null,
            nx: this.atlas.uvRects.get(resolved.faces.nx ?? '') ?? null,
            py: this.atlas.uvRects.get(resolved.faces.py ?? '') ?? null,
            ny: this.atlas.uvRects.get(resolved.faces.ny ?? '') ?? null,
            pz: this.atlas.uvRects.get(resolved.faces.pz ?? '') ?? null,
            nz: this.atlas.uvRects.get(resolved.faces.nz ?? '') ?? null,
          }
        : null;
      const fallbackRect = resolved
        ? (this.atlas!.uvRects.get(resolved.texturePath ?? '') ?? null)
        : null;
      const uvs = rects ? boxFaceUVs(rects, fallbackRect) : null;
      if (uvs && this.atlasTexture) {
        const geom = BLOCK.clone();
        geom.setAttribute('uv', new BufferAttribute(uvs, 2));
        this.texturedGeoms.push(geom);
        typeGeometry.set(p, geom);
        typeToSlot.set(p, this.brightMats.length);
        // Fixed biome tint (plains) on grayscale-tinted types; white keeps
        // the raw texture. Dimming multiplies the same tint.
        const tint = tintForBlock(block);
        this.brightMats.push(new MeshLambertMaterial({ map: this.atlasTexture, color: tint ?? 0xffffff }));
        this.dimMats.push(
          new MeshLambertMaterial({ map: this.atlasTexture, color: new Color(tint ?? 0xffffff).multiplyScalar(DIM_FACTOR) }),
        );
        texturedTypes++;
      } else {
        const bright = new MeshLambertMaterial({ color });
        const dimColor = new Color(color).multiplyScalar(DIM_FACTOR);
        const dim = new MeshLambertMaterial({ color: dimColor });
        typeToSlot.set(p, this.brightMats.length);
        this.brightMats.push(bright);
        this.dimMats.push(dim);
      }
    }

    const placement = new Matrix4();
    for (const g of groups.values()) {
      const geom = typeGeometry.get(g.typeIndex) ?? BLOCK;
      const mesh = new InstancedMesh(geom, this.dimMats[typeToSlot.get(g.typeIndex)!]!, g.coords.length);
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
      `${paletteIndices.length} types, ${slices.length} lagen langs ${axisNames[axis]}` +
      (texturedTypes > 0 && this.lastTextureReport ? ` · textures: ${this.lastTextureReport}` : ''),
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

  // Camera mode: Orbit (free orbit) / Plan (top-down orthographic).
  const setCam = (mode: 'orbit' | 'plan'): void => {
    viewer.setCameraMode(mode);
    document.getElementById('cam-orbit')?.classList.toggle('active', mode === 'orbit');
    document.getElementById('cam-plan')?.classList.toggle('active', mode === 'plan');
  };
  document.getElementById('cam-orbit')?.addEventListener('click', () => setCam('orbit'));
  document.getElementById('cam-plan')?.addEventListener('click', () => setCam('plan'));

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
