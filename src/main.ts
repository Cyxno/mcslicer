import { initViewer } from './ui/viewer.js';
import demoUrl from './assets/demo-huisje.schem?url';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const status = document.getElementById('status')!;
initViewer(canvas, status, demoUrl);
