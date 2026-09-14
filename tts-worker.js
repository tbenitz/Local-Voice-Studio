const VOXSHOT_URL = 'https://cdn.jsdelivr.net/npm/voxshot@0.3.0/dist/index.js';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

const vox = await import(VOXSHOT_URL);
let bridge;
const engine = new vox.ChatterboxEngine({
  stallTimeoutMs: 300000,
  onProgress: (progress) => bridge?.emitProgress(progress),
  loadModule: async () => import(TRANSFORMERS_URL),
});
bridge = vox.exposeEngine(engine, self);
