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
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseSchem } from '../schem/parse.js';
import type { Schematic } from '../schem/types.js';
import {
  buildSlicerModel,
  currentSlice,
  currentStep,
  initialState,
  jumpTo,
  nextStep,
  prevStep,
  progressLabel,
  sliceVisible,
  type Axis,
  type SliceMode,
  type SlicerModel,
  type SlicerState,
} from '../slicer/steps.js';
import { layerOpacity } from '../slicer/layer-opacity.js';
import { baseTypeName, materialTable, sortRows, type MaterialRow, type SortDir, type SortKey } from '../slicer/materials.js';
import { colorForBlock } from '../render/colors.js';
import { framingForStep } from '../render/framing.js';
import { blockCenterLocal, fitScale, gridSpan, modelMatrix, worldToBlock } from '../render/transform.js';
import { blockInfo, pointerToNdc, toggleValue } from '../render/picking.js';
import { resolveBlockstate } from '../textures/atlas.js';
import { boxFaceUVs } from '../textures/faces.js';
import { buildAtlas, type AtlasResult } from '../textures/loader.js';
import { treeFromAssetFiles, type AssetFiles } from '../textures/assets.js';
import { tintForBlock } from '../textures/tint.js';
import { chooseSource, resolveForRender, atlasReportLine, sourceStatusLine, type TextureSourceKind } from '../textures/sources.js';
import { pendingPaths, treeFromRemote, createRemoteSource, wantedPathsForPalette, type RemoteSource } from '../textures/remote.js';

const BLOCK = new BoxGeometry(1, 1, 1);

interface SliceMesh {
  mesh: InstancedMesh;
  sliceCoord: number;
  typeIndex: number;
  paletteIndex: number;
  /** Untinted base color of this type; dim factors multiply onto the mesh's own material. */
  base: Color;
}

interface Pick {
  paletteIndex: number;
  x: number;
  y: number;
  z: number;
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
  private readonly infoPanel: HTMLElement | null;

  private meshes: InstancedMesh[] = [];
  private sliceMeshes: SliceMesh[] = [];
  private brightMats: MeshLambertMaterial[] = [];
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
  private sliceMode: SliceMode = 'cumulative';
  private sortKey: SortKey = 'total';
  private sortDir: SortDir = 'desc';

  // Picking state (phase 4b). Highlight = one type forced bright across
  // all slices; hide = type's meshes invisible and its panel row dimmed.
  private readonly raycaster = new Raycaster();
  private readonly pointerNDC = new Vector2();
  /** Overlays (hover, step marker, grid) in model space, under one transform. */
  private readonly modelGroup = new Group();
  private readonly hoverBox: Mesh;
  private readonly stepMarker: Mesh;
  private typeToSlot = new Map<number, number>();
  private totals = new Map<number, number>();
  private hiddenTypes = new Set<number>();
  private highlightedType: number | null = null;
  private lastPick: Pick | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  private lastLabel = '';
  private measureMode = false;
  /** "Volg stap" (4e C): glide the camera to frame the current step. */
  private followStep = false;
  private camAnim: {
    fromT: Vector3; toT: Vector3; fromP: Vector3; toP: Vector3; start: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, els: {
    status: HTMLElement;
    progress: HTMLElement;
    slider: HTMLInputElement;
    matBody: HTMLElement;
    matSliceLabel: HTMLElement;
    infoPanel?: HTMLElement | null;
  }) {
    this.status = els.status;
    this.progress = els.progress;
    this.slider = els.slider;
    this.matBody = els.matBody;
    this.matSliceLabel = els.matSliceLabel;
    this.infoPanel = els.infoPanel ?? null;

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

    // Hover highlight: a translucent shell exactly one block in MODEL
    // space, parented under the model transform group. In world space a
    // 1-unit box spans ~2.6 blocks at typical fit scales (the 4e bug);
    // local sizing keeps it one block at any zoom.
    this.modelGroup.matrixAutoUpdate = false;
    this.scene.add(this.modelGroup);
    this.hoverBox = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.hoverBox.visible = false;
    this.modelGroup.add(this.hoverBox);

    // Current-step marker (4e C): amber shell in the same model-space
    // style as the hover box, distinct color so the step stands out.
    this.stepMarker = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.stepMarker.visible = false;
    this.modelGroup.add(this.stepMarker);

    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    // Leaving the canvas must never leave a stale hover box behind (the 4d
    // "losse grijze blok" report): hide it as soon as the pointer is gone.
    canvas.addEventListener('pointerleave', () => {
      this.hoverBox.visible = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDownAt = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      const down = this.pointerDownAt;
      this.pointerDownAt = null;
      if (!down) return;
      const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      if (moved <= 4) this.onPick(e); // click, not orbit-drag
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());

    const loop = (): void => {
      if (this.camAnim) {
        // Follow-step glide (4e C): shift camera and target by the same
        // delta so zoom and orbit orientation are preserved.
        const a = this.camAnim;
        const t = Math.min((performance.now() - a.start) / 260, 1);
        const e = t * t * (3 - 2 * t); // smoothstep ease
        this.controls.target.lerpVectors(a.fromT, a.toT, e);
        this.camera.position.lerpVectors(a.fromP, a.toP, e);
        this.camera.lookAt(this.controls.target);
        if (t >= 1) {
          this.camAnim = null;
          this.controls.update();
        }
      } else {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  /** Start a short eased glide of camera+target towards a new framing. */
  private glideTo(target: Vector3): void {
    const delta = target.clone().sub(this.controls.target);
    if (delta.lengthSq() < 1e-10) return;
    this.camAnim = {
      fromT: this.controls.target.clone(),
      toT: target,
      fromP: this.camera.position.clone(),
      toP: this.camera.position.clone().add(delta),
      start: performance.now(),
    };
  }

  /** Toggle "volg stap"; enabling frames the current step immediately. */
  setFollowStep(on: boolean): void {
    this.followStep = on;
    if (on && this.model && this.model.total > 0 && this.schem) {
      const step = this.model.steps[this.state.step];
      if (step) this.glideTo(this.stepFraming(step));
    }
  }

  private stepFraming(step: { x: number; y: number; z: number }): Vector3 {
    if (!this.schem) return new Vector3();
    const f = framingForStep(step, this.schem.size);
    return new Vector3(f.x, f.y, f.z);
  }

  /** Place the amber current-step marker on the given step. */
  private updateStepMarker(step: { x: number; y: number; z: number }): void {
    this.stepMarker.position.copy(blockCenterLocal(step));
    this.stepMarker.visible = true;
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
      (mesh.material as MeshLambertMaterial).dispose(); // per-mesh clone (4e B3)
      mesh.dispose();
    }
    for (const geom of this.texturedGeoms) geom.dispose();
    if (this.grid) {
      this.modelGroup.remove(this.grid);
      this.grid.dispose();
      this.grid = null;
    }
    this.meshes = [];
    this.sliceMeshes = [];
    this.brightMats = [];
    this.texturedGeoms = [];
    this.stepMarker.visible = false;
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

  /**
   * Build/rebuild the atlas when the palette's texture set changed.
   * Source order: user assets (map/zip) > same-origin default-assets >
   * color fallback — per type, and the split is reported per source.
   */
  private async ensureAtlas(schem: Schematic): Promise<void> {
    const hasUser = !!this.assets && !!this.assetTree;
    const hasDefault = !!this.defaultSource;
    if (!hasUser && !hasDefault) {
      this.lastTextureReport = sourceStatusLine({ user: 0, default: 0, fallback: 0 });
      return;
    }

    // Warm the default cache: discover wanted paths from what is cached,
    // fetch what the manifest has, repeat until stable (each pass surfaces
    // one more layer: blockstates -> models -> parents -> textures).
    if (this.defaultSource) {
      for (let pass = 0; pass < 8; pass++) {
        const wanted = wantedPathsForPalette(this.defaultSource, schem.palette);
        if (pendingPaths(this.defaultSource, wanted).length === 0) break;
        await this.defaultSource.ensure(wanted);
      }
    }

    // Choose a source per palette entry and collect atlas textures.
    const dtree = hasDefault ? treeFromRemote(this.defaultSource!) : null;
    const defaultUsable = (entry: string): boolean => {
      if (!dtree) return false;
      const r = resolveBlockstate(entry, dtree);
      return !!r && !r.incomplete && !!r.texturePath && !!this.defaultSource?.has(r.texturePath);
    };
    const paths = new Set<string>();
    const counts: Record<TextureSourceKind, number> = { user: 0, default: 0, fallback: 0 };
    let unresolvedCount = 0;
    for (const entry of schem.palette) {
      if (entry === 'minecraft:air') continue;
      const ru = this.userUsable(entry);
      const rd = defaultUsable(entry);
      const kind = chooseSource(ru, rd);
      if (kind === 'fallback') {
        unresolvedCount++;
        continue;
      }
      counts[kind]++;
      const r = kind === 'user'
        ? resolveBlockstate(entry, this.assetTree!)!
        : resolveBlockstate(entry, dtree!)!;
      for (const f of [r.faces.px, r.faces.nx, r.faces.py, r.faces.ny, r.faces.pz, r.faces.nz]) {
        if (f) paths.add(f);
      }
      if (r.texturePath) paths.add(r.texturePath);
    }

    const key = `${hasUser ? 'u' : '-'}${hasDefault ? 'd' : '-'}|${[...paths].sort().join('|')}`;
    if (key !== this.atlasPaletteKey || !this.atlas) {
      const getBytes = (p: string): Uint8Array | undefined =>
        this.assets?.get(p) ?? this.defaultSource?.getBytes(p);
      this.atlasTexture?.dispose();
      this.atlas = await buildAtlas(getBytes, [...paths].sort());
      this.atlasTexture = new CanvasTexture(this.atlas.canvas);
      this.atlasTexture.magFilter = NearestFilter;
      this.atlasTexture.minFilter = NearestFilter;
      this.atlasTexture.generateMipmaps = false;
      this.atlasTexture.colorSpace = 'srgb';
      this.atlasPaletteKey = key;
    }
    counts.fallback += unresolvedCount;
    // Never claim textured rendering without a bound atlas: when the atlas
    // failed to build, say resolution succeeded but rendering is pending.
    this.lastTextureReport = this.atlas
      ? sourceStatusLine(counts)
      : atlasReportLine(null, counts.user + counts.default);
  }

  /** User assets resolve this entry completely (textures present)? */
  private userUsable(entry: string): boolean {
    if (!this.assetTree || !this.assets) return false;
    const r = resolveBlockstate(entry, this.assetTree);
    return !!r && !r.incomplete && !!r.texturePath && this.assets.has(r.texturePath);
  }

  private defaultSource: RemoteSource | null = null;

  /** Install the same-origin default-assets source (manifest fetched). */
  setDefaultSource(source: RemoteSource | null): void {
    this.defaultSource = source;
    this.atlasPaletteKey = '';
    if (this.schem) {
      void this.ensureAtlas(this.schem).then(() => {
        if (this.schem) this.showSlicer(this.schem, this.model?.axis ?? 'y');
      });
    }
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
    this.lastLabel = label;
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
    this.hiddenTypes.clear();
    this.highlightedType = null;
    this.lastPick = null;
    if (this.infoPanel) this.infoPanel.hidden = true;

    // Build-wide totals per palette index (for picking + panel).
    this.totals = new Map<number, number>();
    for (let i = 0; i < schem.blocks.length; i++) {
      const p = schem.blocks[i]!;
      if (schem.palette[p] === 'minecraft:air') continue;
      this.totals.set(p, (this.totals.get(p) ?? 0) + 1);
    }

    const scale = fitScale(schem.size);
    this.modelScale = scale;
    // Single source of truth for the model transform (meshes bake it in,
    // overlays live under it in model space).
    const group = modelMatrix(schem.size);
    this.groupTransform = group.clone();
    this.modelGroup.matrix.copy(group);

    // Subtle ground grid under the build (4e D audit fix): parented under
    // the model transform so its 8-block cells stay block-sized at any fit
    // scale — it used to live in world space with a block-unit span, so
    // cells grew/shrank with the model (same bug class as the hover box).
    const cell = 8;
    const span = gridSpan(schem.size.x, schem.size.z, cell);
    this.grid = new GridHelper(span, span / cell, 0x2a2f3a, 0x1f242e);
    this.grid.position.y = -0.01;
    this.modelGroup.add(this.grid);

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
    // resolveForRender applies the same source order (user > default) that
    // ensureAtlas used for the atlas and the status split, so the meshes
    // can never disagree with the reported texture state.
    const dtree = this.defaultSource ? treeFromRemote(this.defaultSource) : null;
    const paletteIndices = [...typeColors.keys()].sort((a, b) => a - b);
    const typeToSlot = new Map<number, number>();
    this.typeToSlot = typeToSlot;
    const typeGeometry = new Map<number, BufferGeometry>();

    for (const p of paletteIndices) {
      const block = schem.palette[p]!;
      const color = typeColors.get(p)!;
      const resolved = this.atlas && this.atlasTexture
        ? resolveForRender(block, this.assetTree, dtree)
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
        // the raw texture. Dimming multiplies the same tint per layer.
        const tint = tintForBlock(block);
        this.brightMats.push(new MeshLambertMaterial({ map: this.atlasTexture, color: tint ?? 0xffffff }));
      } else {
        typeToSlot.set(p, this.brightMats.length);
        this.brightMats.push(new MeshLambertMaterial({ color }));
      }
    }

    const placement = new Matrix4();
    for (const g of groups.values()) {
      const geom = typeGeometry.get(g.typeIndex) ?? BLOCK;
      // Per-mesh material cloned from the FULL-bright template; the depth
      // gradient (4e B3) multiplies a per-layer factor onto it instead of
      // sharing two fixed bright/dim materials per type.
      const template = this.brightMats[typeToSlot.get(g.typeIndex)!]!;
      const mesh = new InstancedMesh(geom, template.clone(), g.coords.length);
      for (let i = 0; i < g.coords.length; i++) {
        const c = g.coords[i]!;
        placement.makeTranslation(c[0]!, c[1]!, c[2]!);
        mesh.setMatrixAt(i, placement);
      }
      mesh.applyMatrix4(group);
      this.scene.add(mesh);
      this.sliceMeshes.push({
        mesh, sliceCoord: g.sliceCoord, typeIndex: typeToSlot.get(g.typeIndex)!,
        paletteIndex: g.typeIndex, base: template.color.clone(),
      });
    }

    const slices = this.model.slices;
    this.slider.min = '0';
    this.slider.max = String(Math.max(slices.length - 1, 0));
    this.slider.value = '0';
    this.slider.disabled = slices.length <= 1;

    this.frameModel(scale, schem.size);
    this.setStep(this.model.total > 0 ? 0 : -1);
    // HUD + topbar: dimensions, block count, filename.
    const fileName = document.getElementById('file-name');
    if (fileName) fileName.textContent = this.lastLabel;
    const badge = document.getElementById('device-badge');
    if (badge) badge.hidden = false;
    const hud = document.getElementById('hud');
    if (hud) {
      hud.innerHTML = `<b>${schem.size.x}×${schem.size.y}×${schem.size.z}</b> · ` +
        `${this.model.total} blocks · ${paletteIndices.length} types`;
      hud.hidden = false;
    }
    const axisNames = { x: 'X', y: 'Y', z: 'Z' } as const;
    this.setStatus(
      `${schem.size.x}×${schem.size.y}×${schem.size.z} — ${this.model.total} blocks, ` +
      `${paletteIndices.length} types, ${slices.length} lagen langs ${axisNames[axis]}` +
      (this.lastTextureReport ? ` · textures: ${this.lastTextureReport}` : ''),
    );
  }

  private sliceIndex(coord: number): number {
    if (!this.model) return 0;
    return Math.max(this.model.slices.findIndex((s) => s.coord === coord), 0);
  }

  setSliceCoord(coord: number): void {
    this.sliceCoord = coord;
    this.applyTypeMaterials();
    this.slider.value = String(this.sliceIndex(coord));
    const label = document.getElementById('layer-label');
    if (label && this.model) label.textContent = `${this.model.axis}=${coord}`;
    this.updateSliceBanner();
    this.refreshLayerRail();
    this.refreshMaterials();
  }

  /** Persistent slice-banner label: "laag y=N (i van M) · modus" (4e B1). */
  private updateSliceBanner(): void {
    const banner = document.getElementById('slice-banner');
    const bannerText = document.getElementById('slice-banner-text');
    if (!banner || !bannerText || !this.model || this.model.total === 0) return;
    if (this.sliceCoord < 0) {
      banner.hidden = true;
      return;
    }
    const idx = this.sliceIndex(this.sliceCoord);
    const mode = this.sliceMode === 'cumulative' ? 't/m laag' : 'isoleer laag';
    bannerText.innerHTML =
      `laag <b>${this.model.axis}=${this.sliceCoord}</b> ` +
      `(${idx + 1} van ${this.model.slices.length}) · ${mode}`;
    banner.hidden = false;
  }

  /**
   * Tick marks per layer on the rail: one mark per slice with a
   * block-count tooltip ("laag y=3 · 148 blocks"); the active layer is
   * highlighted and clicking a tick jumps to that layer (4e B1).
   */
  private refreshLayerRail(): void {
    const rail = document.getElementById('layer-ticks');
    if (!rail || !this.model) return;
    if (this.model.slices.length === 0) {
      rail.innerHTML = '';
      return;
    }
    const active = this.sliceIndex(this.sliceCoord);
    rail.innerHTML = this.model.slices
      .map((s, i) =>
        `<div class="layer-tick${i === active ? ' active' : ''}" data-index="${i}" ` +
        `title="laag ${this.model!.axis}=${s.coord} · ${s.count} blocks"></div>`)
      .join('');
    for (const tick of rail.querySelectorAll<HTMLDivElement>('.layer-tick')) {
      tick.addEventListener('click', () => this.setSliceIndex(Number(tick.dataset.index)));
    }
    rail.querySelector('.layer-tick.active')?.scrollIntoView({ block: 'nearest' });
  }

  /** "Wis slice": reset navigation, highlight and hidden types. */
  clearSlice(): void {
    this.highlightedType = null;
    this.hiddenTypes.clear();
    this.applyTypeMaterials();
    this.refreshMaterials();
    this.setStep(0);
  }

  /** Ground grid visibility (Display toolbar toggle). */
  setGridVisible(visible: boolean): void {
    if (this.grid) this.grid.visible = visible;
  }

  /** Coordinate readout of the hovered block (Measure toggle). */
  setMeasureMode(on: boolean): void {
    this.measureMode = on;
    const hud = document.getElementById('measure-hud');
    if (hud) {
      hud.style.display = on ? 'block' : 'none';
      if (!on) hud.textContent = '';
    }
    this.hoverBox.visible = false;
  }

  /** Render one frame and download the canvas as PNG. */
  savePhoto(): void {
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) {
        this.setStatus('Screenshot mislukt', true);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.lastLabel.replace(/\.schem$/i, '') || 'mcslicer'}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  /** One-line texture status for the settings popover. */
  textureReport(): string {
    return this.lastTextureReport || 'geen textures geladen — wijs assets aan in Instellingen';
  }

  /** Active slice full, deeper layers follow the depth gradient; a
   * highlighted type is full across all layers; hidden = off. Visibility
   * follows the slice mode: cumulative shows layers up to the current one
   * (build use), isolate shows only the current layer. In isolate mode the
   * active layer gets a subtle emissive lift so it stands out from the
   * dimmed rest without a harsh cut. */
  private applyTypeMaterials(): void {
    for (const entry of this.sliceMeshes) {
      const hidden = this.hiddenTypes.has(entry.paletteIndex);
      entry.mesh.visible = !hidden && sliceVisible(entry.sliceCoord, this.sliceCoord, this.sliceMode);
      const active = entry.sliceCoord === this.sliceCoord;
      const highlighted = entry.paletteIndex === this.highlightedType;
      const factor = active || highlighted ? 1 : layerOpacity(this.sliceCoord - entry.sliceCoord, this.sliceMode);
      const mat = entry.mesh.material as MeshLambertMaterial;
      mat.color.copy(entry.base).multiplyScalar(factor);
      mat.emissive.setHex(this.sliceMode === 'isolate' && active && !highlighted ? 0x1a1a1a : 0x000000);
    }
  }

  /** Slice display semantics: "toon t/m laag N" vs "isoleer laag N". */
  setSliceMode(mode: SliceMode): void {
    this.sliceMode = mode;
    this.applyTypeMaterials();
    const btn = document.getElementById('btn-slice-mode');
    if (btn) {
      btn.textContent = mode === 'cumulative' ? 'Σ' : '1';
      btn.title = mode === 'cumulative'
        ? 'Laagweergave: cumulatief (toon t/m laag N) — klik om te isoleren'
        : 'Laagweergave: isoleer laag N — klik voor cumulatief';
      btn.classList.toggle('active', mode === 'isolate');
    }
    const label = document.getElementById('slice-mode-label');
    if (label) label.textContent = mode === 'cumulative' ? 't/m laag' : 'isoleer laag';
    this.updateSliceBanner(); // banner carries the mode (4e B1)
  }

  toggleSliceMode(): void {
    this.setSliceMode(this.sliceMode === 'cumulative' ? 'isolate' : 'cumulative');
  }

  /** Force one palette type bright across all slices (toggle). */
  setHighlightedType(paletteIndex: number | null): void {
    this.highlightedType = this.highlightedType === paletteIndex ? null : paletteIndex;
    if (this.highlightedType !== null) this.hiddenTypes.delete(this.highlightedType);
    this.applyTypeMaterials();
    this.refreshMaterials();
  }

  /** Hide/show a palette type (toggle) and refresh panel + meshes. */
  toggleHiddenType(paletteIndex: number): void {
    this.hiddenTypes = toggleValue(this.hiddenTypes, paletteIndex).next;
    if (this.highlightedType === paletteIndex && this.hiddenTypes.has(paletteIndex)) {
      this.highlightedType = null;
    }
    this.applyTypeMaterials();
    this.refreshMaterials();
    this.renderInfoPanel(); // button label may flip
  }

  private raycastAt(e: PointerEvent): { mesh: SliceMesh; point: Vector3 } | null {
    if (!this.schem) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    // NDC from CSS pixels; DPR-invariant (see pointerToNdc — the drawingbuffer
    // scale cancels because event and rect share the CSS pixel space).
    const ndc = pointerToNdc(e.clientX, e.clientY, rect, this.renderer.getPixelRatio());
    this.pointerNDC.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const meshes = this.sliceMeshes.filter((s) => s.mesh.visible).map((s) => s.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    const hit = hits[0];
    const sliceMesh = hit && this.sliceMeshes.find((s) => s.mesh === hit.object);
    if (!hit || !sliceMesh || hit.instanceId === undefined) return null;
    // hit.point is world-space (raycaster applies the mesh's group transform);
    // the instance matrix alone is local block coordinates and would place the
    // hover box outside the scaled model (the 4d "losse grijze blok").
    return { mesh: sliceMesh, point: hit.point.clone() };
  }

  /** World-space point -> schematic block coords (inverse group transform). */
  private worldToBlock(p: Vector3): { x: number; y: number; z: number } {
    if (!this.groupTransform) {
      return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    }
    return worldToBlock(this.groupTransform, p);
  }

  private onPointerMove(e: PointerEvent): void {
    const hit = this.raycastAt(e);
    if (hit) {
      // hoverBox is a child of the model transform group: place it at the
      // block center in LOCAL coordinates so it is exactly one block wide
      // (world-space placement made it ~2.6 blocks at fit scale).
      const c = this.worldToBlock(hit.point);
      this.hoverBox.position.copy(blockCenterLocal(c));
      this.hoverBox.visible = true;
      if (this.measureMode) {
        const hud = document.getElementById('measure-hud');
        if (hud && this.schem) {
          const c = this.worldToBlock(hit.point);
          const entry = this.schem.palette[hit.mesh.paletteIndex]!.split('[')[0]!;
          hud.textContent = `${c.x}, ${c.y}, ${c.z} · ${entry.replace('minecraft:', '')}`;
        }
      }
    } else {
      this.hoverBox.visible = false;
      if (this.measureMode) {
        const hud = document.getElementById('measure-hud');
        if (hud) hud.textContent = 'geen blok';
      }
    }
  }

  private onPick(e: PointerEvent): void {
    const hit = this.raycastAt(e);
    if (!hit) {
      this.lastPick = null;
      this.hoverBox.visible = false;
      if (this.infoPanel) this.infoPanel.hidden = true;
      return;
    }
    const c = this.worldToBlock(hit.point);
    this.lastPick = { paletteIndex: hit.mesh.paletteIndex, x: c.x, y: c.y, z: c.z };
    this.renderInfoPanel();
  }

  /** Fill the info panel from the current pick; no-op without panel. */
  private renderInfoPanel(): void {
    const panel = this.infoPanel;
    const pick = this.lastPick;
    if (!panel || !pick || !this.schem) return;
    const entry = this.schem.palette[pick.paletteIndex]!;
    const info = blockInfo(entry, pick, this.totals.get(pick.paletteIndex) ?? 0);
    const hidden = this.hiddenTypes.has(pick.paletteIndex);
    const highlighted = this.highlightedType === pick.paletteIndex;
    const propsHtml = info.props.length
      ? `<table class="props">${info.props
          .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
          .join('')}</table>`
      : '<div class="props-empty">geen properties</div>';
    panel.innerHTML = `
      <div class="info-title">${escapeHtml(info.name)}</div>
      <div class="info-id" title="${escapeHtml(info.id)}">${escapeHtml(info.id)}</div>
      <div class="info-row">positie <b>${info.x}, ${info.y}, ${info.z}</b></div>
      <div class="info-row">in deze build: <b>${info.total}</b></div>
      ${propsHtml}
      <details class="info-raw"><summary>raw</summary><code>${escapeHtml(info.id)}</code></details>
      <div class="info-actions">
        <button data-action="highlight" class="nav-btn ${highlighted ? 'active' : ''}">
          ${highlighted ? 'Highlight uit' : 'Highlight deze'}
        </button>
        <button data-action="hide" class="nav-btn">${hidden ? 'Tonen' : 'Verberg deze'}</button>
      </div>`;
    panel.hidden = false;
    panel.querySelector('[data-action="highlight"]')?.addEventListener('click', () => {
      this.setHighlightedType(pick.paletteIndex);
    });
    panel.querySelector('[data-action="hide"]')?.addEventListener('click', () => {
      this.toggleHiddenType(pick.paletteIndex);
    });
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
    const cur = currentStep(this.model, this.state);
    if (cur) {
      this.updateStepMarker(cur);
      if (this.followStep) this.glideTo(this.stepFraming(cur));
    } else {
      this.stepMarker.visible = false;
    }
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

  /** Close the info panel (Escape). */
  closeInfoPanel(): void {
    if (!this.infoPanel) return;
    this.infoPanel.hidden = true;
    this.lastPick = null;
    this.hoverBox.visible = false;
  }

  /** Hide the currently picked type (H); no-op without a pick. */
  hidePicked(): void {
    if (this.lastPick) this.toggleHiddenType(this.lastPick.paletteIndex);
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
      // Material list shows the base type; full blockstate in the info panel.
      const name = baseTypeName(row.block);
      const paletteIndex = this.schem!.palette.indexOf(row.block);
      const hidden = this.hiddenTypes.has(paletteIndex);
      const highlighted = this.highlightedType === paletteIndex;
      html.push(
        `<tr class="mat-row${hidden ? ' hidden-type' : ''}${highlighted ? ' highlighted-type' : ''}"` +
        ` data-block="${escapeHtml(row.block)}" title="klik = highlight, dubbelklik = verberg/toon">` +
        `<td class="swatch"><span class="sw" style="background:#${color.toString(16).padStart(6, '0')}"></span></td>` +
        `<td class="blockname${hidden ? ' hidden-label' : ''}">${escapeHtml(name)}${hidden ? ' <span class="zero">(verborgen)</span>' : ''}</td>` +
        `<td class="num">${row.total}</td><td class="num">${inSlice}</td></tr>`,
      );
    }
    this.matBody.innerHTML = html.join('');
    // Row interaction: single click toggles highlight (and unhides),
    // double click toggles hidden.
    for (const tr of this.matBody.querySelectorAll<HTMLTableRowElement>('tr[data-block]')) {
      const paletteIndex = this.schem!.palette.indexOf(tr.dataset.block!);
      tr.addEventListener('click', () => {
        if (this.hiddenTypes.has(paletteIndex)) this.toggleHiddenType(paletteIndex);
        this.setHighlightedType(paletteIndex);
      });
      tr.addEventListener('dblclick', () => this.toggleHiddenType(paletteIndex));
    }
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
    infoPanel: $('info-panel'),
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

  // Bottom-center toolbar + settings popover.
  const assetsPop = $('assets-pop');
  const togglePop = (): void => {
    if (!assetsPop) return;
    assetsPop.hidden = !assetsPop.hidden;
    const report = $('texture-report');
    if (report) report.textContent = viewer.textureReport();
  };
  $('settings-btn')?.addEventListener('click', togglePop);
  $('btn-settings')?.addEventListener('click', togglePop);
  $('btn-slice')?.addEventListener('click', () => $('slice-slider')?.focus());
  $('btn-display')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    viewer.setGridVisible(!on); // active = grid uit (werkt als toggle)
  });
  $('btn-photo')?.addEventListener('click', () => viewer.savePhoto());
  $('btn-shortcuts')?.addEventListener('click', () => {
    $('hints')?.classList.toggle('hidden-hints');
  });
  $('btn-measure')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    viewer.setMeasureMode(on);
  });
  // Slice semantics: cumulative (default, build use) vs isolate (default off).
  $('btn-slice-mode')?.addEventListener('click', () => viewer.toggleSliceMode());
  // Follow-step camera: glide to the current step's framing while stepping.
  $('btn-follow')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    viewer.setFollowStep(on);
  });
  $('btn-fullscreen')?.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.getElementById('app')?.requestFullscreen();
  });
  $('slice-banner-clear')?.addEventListener('click', () => {
    viewer.clearSlice();
    const banner = $('slice-banner');
    if (banner) banner.hidden = true;
  });

  // Default-assets: same-origin fetch (no directory picker needed). A
  // missing manifest simply keeps color mode — operator supplies the set
  // via scripts/prepare-default-assets.sh; user assets stay the override.
  void (async () => {
    try {
      const url = new URL('default-assets/manifest.json', document.baseURI);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { files?: unknown };
      if (!Array.isArray(data.files)) return;
      const base = new URL('default-assets/', document.baseURI);
      viewer.setDefaultSource(
        createRemoteSource(data.files as string[], async (p) => {
          const r = await fetch(new URL(p, base));
          if (!r.ok) return undefined;
          return new Uint8Array(await r.arrayBuffer());
        }),
      );
    } catch {
      // no default set available: color mode, never an error to the user
    }
  })();

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
  // The 'input' event fires continuously while dragging AND on focused
  // keyboard arrows, so the slice updates live — never only on release.
  $('slice-slider').addEventListener('input', (e) => {
    viewer.setSliceIndex(Number((e.target as HTMLInputElement).value));
  });

  // Shift+scroll above the canvas = layer step (plain scroll stays zoom).
  // Capture phase so OrbitControls' zoom handler is bypassed; with Shift
  // held, some browsers move the delta to deltaX, so read the dominant axis.
  canvas.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    viewer.sliceShift(delta > 0 ? +1 : -1);
  }, { capture: true, passive: false });

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
      case 'Escape': viewer.closeInfoPanel(); break;
      case 'h': case 'H': viewer.hidePicked(); break;
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
