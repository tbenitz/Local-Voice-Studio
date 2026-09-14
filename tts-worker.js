/* Local Voice Studio worker — report immediately so the UI is never stuck on Preparing. */
self.postMessage({ type: 'progress', data: { status: 'phase', phase: 'boot', text: 'Starting AI worker…' } });

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.web.min.js';
const MODEL_ID = 'onnx-community/chatterbox-ONNX';

let hf = null, model = null, processor = null;
const speakerCache = new Map();

function progress(data) {
  self.postMessage({ type: 'progress', data });
}

async function checkWebGPU() {
  if (!navigator.gpu) return { available: false, reason: 'WebGPU is not supported' };
  try {
    const adapter = await Promise.race([
      navigator.gpu.requestAdapter(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('WebGPU adapter probe timed out')), 8000)),
    ]);
    return adapter ? { available: true } : { available: false, reason: 'No WebGPU adapter' };
  } catch (e) {
    return { available: false, reason: e.message || String(e) };
  }
}

const DTYPE = {
  wasm: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4', conditional_decoder: 'fp32' },
  webgpu: { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4f16', conditional_decoder: 'fp32' },
};

async function load(data) {
  progress({ status: 'phase', phase: 'runtime', text: 'Downloading Transformers.js runtime…' });
  if (!hf) {
    hf = await import(TRANSFORMERS_URL);
    if (hf.env) {
      hf.env.allowLocalModels = false;
      hf.env.useBrowserCache = true;
    }
  }
  if (!hf.ChatterboxModel) {
    throw new Error('This Transformers.js build does not include ChatterboxModel. Need v4+.');
  }
  progress({ status: 'phase', phase: 'webgpu', text: 'Checking WebGPU…' });
  const webgpu = await checkWebGPU();
  let device = data.device || 'auto';
  if (device === 'auto') device = webgpu.available ? 'webgpu' : 'wasm';
  if (device === 'webgpu' && !webgpu.available) {
    progress({ status: 'load-fallback', reason: webgpu.reason || 'WebGPU unavailable' });
    device = 'wasm';
  }
  progress({ status: 'phase', phase: 'processor', text: 'Loading Chatterbox processor / tokenizer…' });
  processor = await hf.AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: (p) => progress({ ...p, part: 'processor' }),
  });
  progress({ status: 'phase', phase: 'model', text: `Loading Chatterbox ${device === 'webgpu' ? 'Q4F16' : 'Q4'} model…` });
  model = await hf.ChatterboxModel.from_pretrained(MODEL_ID, {
    device,
    dtype: DTYPE[device] || DTYPE.wasm,
    progress_callback: (p) => progress({ ...p, part: 'model' }),
  });
  progress({ status: 'load-compiling', text: 'Model files loaded. Compiling sessions…' });
  return { device, webgpu: webgpu.available };
}

async function encodeSpeaker(data) {
  if (!model) throw new Error('Model is not loaded.');
  const audio = new Float32Array(data.audioData);
  progress({ status: 'phase', phase: 'speaker', text: 'Encoding voice reference…' });
  const tensor = new hf.Tensor('float32', audio, [1, audio.length]);
  const result = await model.encode_speech(tensor);
  speakerCache.set(data.speakerId, result);
  return { speakerId: data.speakerId };
}

async function generate(data) {
  if (!model || !processor) throw new Error('Model is not loaded.');
  const speaker = speakerCache.get(data.speakerId);
  if (!speaker) throw new Error('Voice reference is not encoded in this AI session.');
  const inputs = await processor._call(data.text);
  const waveform = await model.generate({
    ...inputs,
    ...speaker,
    exaggeration: Number(data.exaggeration ?? 0.5),
    max_new_tokens: 256,
  });
  const arr = waveform.data;
  const buffer = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
  return { waveform: buffer };
}

self.onmessage = async (e) => {
  const { id, type, data } = e.data || {};
  try {
    let result;
    if (type === 'load') result = await load(data || {});
    else if (type === 'encode_speaker') result = await encodeSpeaker(data || {});
    else if (type === 'generate') result = await generate(data || {});
    else if (type === 'check_webgpu') result = await checkWebGPU();
    else if (type === 'ping') result = { ok: true };
    else throw new Error(`Unknown worker command: ${type}`);
    const transfer = result?.waveform ? [result.waveform] : [];
    self.postMessage({ id, type: 'complete', data: result }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err?.message || String(err), stack: err?.stack || '' });
  }
};
