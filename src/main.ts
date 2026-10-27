// Must run before any import that touches prismarine-nbt (evaluated in order).
import './schem/nodeShims.js';
import { initViewer } from './ui/viewer.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;
initViewer(canvas, status, demoUrl);
