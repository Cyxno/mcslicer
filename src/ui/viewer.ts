/**
 * three.js viewer: one InstancedMesh per block type, orthographic camera,
 * orbit controls, drag-drop + demo loading.
 *
 * This module touches the DOM and three.js on purpose — rendering itself is
 * verified visually, not by unit tests. All data logic lives in src/render
 * and src/schem and is tested there.
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
import { schemToSceneData } from '../render/scene.js';

const BLOCK = new BoxGeometry(1, 1, 1);

export class Viewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly status: HTMLElement;
  private meshes: InstancedMesh[] = [];

  constructor(canvas: HTMLCanvasElement, statusEl: HTMLElement) {
    this.status = statusEl;
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

  clearModel(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
  }

  showSchematic(schem: Schematic): void {
    this.clearModel();

    const { size } = schem;
    const centerX = size.x / 2;
    const centerZ = size.z / 2;
    const scale = 16 / Math.max(size.x, size.y, size.z);

    const group = new Matrix4();
    const placement = new Matrix4();
    group.makeScale(scale, scale, scale);
    group.setPosition(-centerX * scale, 0, -centerZ * scale);

    const sceneData = schemToSceneData(schem);
    for (const type of sceneData) {
      const mesh = new InstancedMesh(
        BLOCK,
        new MeshLambertMaterial({ color: type.color }),
        type.count,
      );
      for (let i = 0; i < type.count; i++) {
        placement.makeTranslation(
          type.positions[i * 3]!,
          type.positions[i * 3 + 1]!,
          type.positions[i * 3 + 2]!,
        );
        mesh.setMatrixAt(i, placement);
      }
      mesh.applyMatrix4(group);
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }

    // Frame the model: target its center, zoom to fit.
    this.controls.target.set(0, (size.y * scale) / 2, 0);
    const fit = 14 / Math.max(size.x, size.y, size.z);
    this.camera.zoom = Math.min(Math.max(fit, 0.05), 20);
    this.camera.position.set(1, 0.8, 1).normalize().multiplyScalar(1000 / this.camera.zoom);
    this.camera.updateProjectionMatrix();
    this.controls.update();

    const types = sceneData.length;
    this.setStatus(
      `${schem.size.x}×${schem.size.y}×${schem.size.z} — ` +
      `${sceneData.reduce((s, t) => s + t.count, 0)} blocks, ${types} types`,
    );
  }

  /** Parse bytes and display; all failures become a visible page message. */
  async loadFile(bytes: Uint8Array, label: string): Promise<void> {
    this.setStatus(`Parsing ${label}…`);
    try {
      const schem = await parseSchem(bytes);
      this.showSchematic(schem);
    } catch (err) {
      this.clearModel();
      this.showError(err, label);
    }
  }

  /** Fetch the demo asset and display; fetch failures are visible too. */
  async loadDemo(url: string, label: string): Promise<void> {
    this.setStatus(`Loading ${label}…`);
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await this.loadFile(bytes, label);
    } catch (err) {
      this.clearModel();
      this.showError(err, label);
    }
  }

  private showError(err: unknown, label: string): void {
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
    this.setStatus(`Could not load ${label}: ${detail}`, true);
  }
}

/** Wire drag-drop + demo button. No server calls: everything stays client-side. */
export function initViewer(canvas: HTMLCanvasElement, statusEl: HTMLElement, demoUrl?: string): Viewer {
  const viewer = new Viewer(canvas, statusEl);
  viewer.setStatus('Drop a .schem file here');

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    viewer.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
  });

  const demoButton = document.getElementById('demo-btn');
  if (demoButton && demoUrl) {
    demoButton.addEventListener('click', () => {
      // demoUrl comes from the Vite ?url import: an http path in dev, a
      // hashed asset URL in build. Never a local-filesystem URL or
      // absolute FS path.
      viewer.loadDemo(demoUrl, 'demo-huisje.schem');
    });
  }

  return viewer;
}
