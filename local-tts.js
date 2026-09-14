const VOICE_DB_VERSION = 1;
const MODEL_SAMPLE_RATE = 24000;

function openVoiceDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, VOICE_DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('voices')) db.createObjectStore('voices', { keyPath: 'name' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IndexedDbVoiceStore {
  constructor({ databaseName = 'local-voice-studio-voices' } = {}) { this.databaseName = databaseName; }
  async _run(mode, fn) {
    const db = await openVoiceDb(this.databaseName);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('voices', mode);
        const req = fn(tx.objectStore('voices'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }
  async list() { const rows = await this._run('readonly', s => s.getAllKeys()); return rows.map(String).sort((a,b)=>a.localeCompare(b)); }
  async save(name, profile) {
    const samples = profile.samples instanceof Float32Array ? profile.samples : new Float32Array(profile.samples || []);
    const copy = samples.slice().buffer;
    return this._run('readwrite', s => s.put({ name, sampleRate: profile.sampleRate || MODEL_SAMPLE_RATE, audioBuffer: copy, createdAt: profile.createdAt || Date.now() }));
  }
  async load(name) {
    const row = await this._run('readonly', s => s.get(name));
    if (!row) return null;
    return { samples: new Float32Array(row.audioBuffer), sampleRate: row.sampleRate || MODEL_SAMPLE_RATE, createdAt: row.createdAt || Date.now(), engine: 'chatterbox-reference' };
  }
  async delete(name) { return this._run('readwrite', s => s.delete(name)); }
}

class WorkerClient {
  constructor(url, onProgress) {
    this.worker = new Worker(url, { type: 'module' });
    this.seq = 0; this.pending = new Map(); this.onProgress = onProgress;
    this.worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') { this.onProgress?.(msg.data || {}); return; }
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'error') p.reject(new Error(msg.error || 'Worker error'));
      else p.resolve(msg.data);
      this.pending.delete(msg.id);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'AI worker crashed while loading.');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }
  call(type, data = {}, transfer = []) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, data }, transfer);
    });
  }
  terminate() { this.worker.terminate(); this.pending.clear(); }
}

export class LocalTTS {
  static async create({ device = 'auto', voiceStore, maxChunkLength = 110, onProgress } = {}) {
    const t = new LocalTTS({ voiceStore, maxChunkLength, onProgress });
    await t._load(device);
    return t;
  }
  constructor({ voiceStore, maxChunkLength, onProgress }) {
    this.voiceStore = voiceStore;
    this.maxChunkLength = Number(maxChunkLength) || 110;
    this.onProgress = onProgress;
    this.client = new WorkerClient(new URL('./tts-worker.js', import.meta.url), onProgress);
    this.device = 'loading'; this.activeVoice = ''; this.pendingProfile = null;
  }
  async _load(device) {
    this.onProgress?.({ status: 'load-start', plan: 'Chatterbox Q4' });
    const r = await this.client.call('load', { device });
    this.device = r.device;
    this.onProgress?.({ status: 'load-ready', device: r.device });
  }
  async cloneVoice(pcm) {
    const samples = resampleMono(pcm.samples, pcm.sampleRate, MODEL_SAMPLE_RATE);
    this.pendingProfile = { samples, sampleRate: MODEL_SAMPLE_RATE, createdAt: Date.now(), engine: 'chatterbox-reference' };
    const copy = samples.slice();
    await this.client.call('encode_speaker', { speakerId: '__pending__', audioData: copy.buffer }, [copy.buffer]);
    this.activeVoice = '__pending__';
    return this.pendingProfile;
  }
  async saveVoice(name) {
    if (!this.pendingProfile) throw new Error('Create a clone from reference audio first.');
    await this.voiceStore.save(name, this.pendingProfile);
    this.activeVoice = name;
    const copy = this.pendingProfile.samples.slice();
    await this.client.call('encode_speaker', { speakerId: name, audioData: copy.buffer }, [copy.buffer]);
  }
  async useVoice(name) {
    if (this.activeVoice === name) return;
    const p = await this.voiceStore.load(name);
    if (!p) throw new Error(`Saved voice “${name}” was not found.`);
    const copy = p.samples.slice();
    await this.client.call('encode_speaker', { speakerId: name, audioData: copy.buffer }, [copy.buffer]);
    this.activeVoice = name;
  }
  async speak(text, options = {}) {
    if (!this.activeVoice) throw new Error('Select a cloned voice first.');
    const chunks = splitText(text, this.maxChunkLength);
    const pieces = [];
    let done = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (options.signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
      this.onProgress?.({ status: 'synth-progress', index: i + 1, count: chunks.length });
      const r = await this.client.call('generate', { text: chunks[i], speakerId: this.activeVoice, exaggeration: Number(options.expressiveness ?? 0.5) });
      let wave = new Float32Array(r.waveform);
      if (Number(options.speed) && Math.abs(Number(options.speed) - 1) > 0.01) wave = changeSpeed(wave, Number(options.speed));
      pieces.push(wave); done += wave.length;
      if (i < chunks.length - 1) { const silence = new Float32Array(Math.floor(MODEL_SAMPLE_RATE * 0.08)); pieces.push(silence); done += silence.length; }
    }
    const all = new Float32Array(done); let off = 0;
    for (const p of pieces) { all.set(p, off); off += p.length; }
    return new LocalAudio(all, MODEL_SAMPLE_RATE);
  }
  play(text, options = {}) {
    let stopped = false, audioEl = null;
    const done = (async () => {
      const audio = await this.speak(text, options);
      if (stopped) return;
      const url = URL.createObjectURL(audio.toBlob());
      audioEl = new Audio(url);
      await audioEl.play();
      await new Promise((resolve, reject) => { audioEl.onended = resolve; audioEl.onerror = () => reject(new Error('Browser audio playback failed.')); });
      URL.revokeObjectURL(url);
    })();
    return { done, stop() { stopped = true; try { audioEl?.pause(); } catch {} } };
  }
  async dispose() { this.client?.terminate(); this.client = null; this.activeVoice = ''; }
}

class LocalAudio {
  constructor(samples, sampleRate) { this.samples = samples; this.sampleRate = sampleRate; this.duration = samples.length / sampleRate; }
  toBlob() { return pcmToWavBlob(this.samples, this.sampleRate); }
}

function splitText(text, maxLen) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const out = [];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length <= maxLen) { out.push(s); continue; }
    const words = s.split(/\s+/); let cur = '';
    for (const w of words) {
      if (cur && (cur.length + 1 + w.length) > maxLen) { out.push(cur); cur = w; }
      else cur += (cur ? ' ' : '') + w;
    }
    if (cur) out.push(cur);
  }
  return out;
}

function resampleMono(samples, fromRate, toRate) {
  if (fromRate === toRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate, len = Math.max(1, Math.round(samples.length / ratio)), out = new Float32Array(len);
  for (let i = 0; i < len; i++) { const p = i * ratio, a = Math.floor(p), b = Math.min(samples.length - 1, a + 1), f = p - a; out[i] = samples[a] * (1 - f) + samples[b] * f; }
  return out;
}
function changeSpeed(samples, speed) {
  speed = Math.max(0.5, Math.min(2, speed)); const len = Math.max(1, Math.round(samples.length / speed)), out = new Float32Array(len);
  for (let i=0;i<len;i++){const p=i*speed,a=Math.floor(p),b=Math.min(samples.length-1,a+1),f=p-a;out[i]=samples[a]*(1-f)+samples[b]*f;} return out;
}
function pcmToWavBlob(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf), w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF');v.setUint32(4,36+samples.length*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);} return new Blob([buf],{type:'audio/wav'});
}
