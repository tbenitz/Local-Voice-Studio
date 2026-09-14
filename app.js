const VOXSHOT_URL = 'https://cdn.jsdelivr.net/npm/voxshot@0.3.0/dist/index.js';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
const DB_NAME = 'local-voice-studio-meta';
const VOICE_DB = 'local-voice-studio-voices';
const SETTINGS_KEY = 'lvs-settings-v1';
const MODEL_READY_KEY = 'lvs-model-ready-v1';
const PACKAGE_VERSION = 1;

const $ = (id) => document.getElementById(id);
const state = {
  vox: null, tts: null, worker: null, workerEngine: null, voiceStore: null,
  ready: false, loading: false, activeVoice: '', playback: null, abortController: null,
  renderCount: 0, lastAudio: null, lastAudioUrl: '', selectedPcm: null, selectedFile: null,
  deferredInstall: null,
  settings: loadSettings(),
};

const els = Object.fromEntries([
  'offlinePill','offlineLabel','installAppBtn','setupCard','installAiBtn','modelProgressWrap','modelProgress','modelProgressText',
  'releaseMemoryBtn','voiceSelect','refreshVoicesBtn','ttsText','charCount','clearTextBtn','speedRange','speedOut','expressionRange','expressionOut',
  'speakBtn','stopBtn','generateBtn','outputEmpty','outputReady','outputAudio','outputDuration','outputVoice','outputTime','downloadWavBtn',
  'diagEngine','diagBackend','diagStorage','diagRenders','dropZone','referenceFile','chooseAudioBtn','referenceDetails','referenceName','referenceDuration','referenceAudio',
  'sampleRange','sampleQuality','sampleAudio','waveMini','cloneName','consentCheck','previewCheck','createCloneBtn','importVoiceFile','importVoiceBtn','voiceLibrary',
  'backendSelect','chunkSelect','autoRecoverCheck','autoRecycleCheck','recycleSelect','saveSettingsBtn','storageBar','storageText','persistStorageBtn','reloadAiBtn','clearModelCacheBtn',
  'diagnostics','copyDiagBtn','runCheckBtn','busyOverlay','busyTitle','busyText','busyProgressWrap','busyProgress','busyProgressText','cancelBusyBtn','toastHost'
].map(k=>[k,$(k)]));

init();

async function init(){
  wireUi();
  applySettingsToUi();
  await registerServiceWorker();
  await requestPersistentStorage(false);
  updateOnlineStatus();
  await refreshStorage();
  await runDiagnostics();
  await refreshVoiceLibrary(false);
  const modelKnown = localStorage.getItem(MODEL_READY_KEY)==='1';
  if(modelKnown){
    els.installAiBtn.textContent='Load Offline AI';
    els.setupCard.querySelector('h2').textContent='Offline AI is installed';
    els.setupCard.querySelector('p').textContent='The model was successfully loaded before. You can load it from local browser storage, including while offline.';
  }
}

function wireUi(){
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  addEventListener('online',updateOnlineStatus); addEventListener('offline',updateOnlineStatus);
  addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); state.deferredInstall=e; els.installAppBtn.classList.remove('hidden'); });
  els.installAppBtn.addEventListener('click',installPwa);
  els.installAiBtn.addEventListener('click',()=>initEngine().catch(showError));
  els.releaseMemoryBtn.addEventListener('click',()=>disposeEngine(true).catch(showError));
  els.reloadAiBtn.addEventListener('click',()=>recycleEngine('Manual reload').catch(showError));
  els.refreshVoicesBtn.addEventListener('click',()=>refreshVoiceLibrary().catch(showError));
  els.voiceSelect.addEventListener('change',()=>selectVoice(els.voiceSelect.value).catch(showError));
  els.ttsText.addEventListener('input',()=>els.charCount.textContent=`${els.ttsText.value.length} / 8000`);
  els.clearTextBtn.addEventListener('click',()=>{els.ttsText.value='';els.ttsText.dispatchEvent(new Event('input'));});
  els.speedRange.addEventListener('input',()=>els.speedOut.value=`${Number(els.speedRange.value).toFixed(2)}×`);
  els.expressionRange.addEventListener('input',()=>els.expressionOut.value=Number(els.expressionRange.value).toFixed(2));
  els.speakBtn.addEventListener('click',()=>streamSpeak().catch(showError));
  els.stopBtn.addEventListener('click',stopPlayback);
  els.generateBtn.addEventListener('click',()=>generateWav().catch(showError));
  els.downloadWavBtn.addEventListener('click',downloadLastWav);
  els.chooseAudioBtn.addEventListener('click',e=>{e.preventDefault();els.referenceFile.click();});
  els.referenceFile.addEventListener('change',()=>{const f=els.referenceFile.files?.[0];if(f) loadReference(f).catch(showError);});
  for(const ev of ['dragenter','dragover']) els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.add('drag');});
  for(const ev of ['dragleave','drop']) els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.remove('drag');});
  els.dropZone.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f) loadReference(f).catch(showError);});
  els.consentCheck.addEventListener('change',updateCloneButton); els.cloneName.addEventListener('input',updateCloneButton);
  els.createCloneBtn.addEventListener('click',()=>createClone().catch(showError));
  els.importVoiceBtn.addEventListener('click',()=>els.importVoiceFile.click());
  els.importVoiceFile.addEventListener('change',()=>{const f=els.importVoiceFile.files?.[0];if(f) importVoice(f).catch(showError);els.importVoiceFile.value='';});
  els.saveSettingsBtn.addEventListener('click',saveSettingsFromUi);
  els.persistStorageBtn.addEventListener('click',()=>requestPersistentStorage(true));
  els.clearModelCacheBtn.addEventListener('click',()=>clearModelCaches().catch(showError));
  els.runCheckBtn.addEventListener('click',()=>runDiagnostics().catch(showError));
  els.copyDiagBtn.addEventListener('click',copyDiagnostics);
  els.cancelBusyBtn.addEventListener('click',()=>state.abortController?.abort());
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.dataset.panel===name));
}

async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller){
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,1500);
        navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
      });
    }
  } catch(e){ console.warn('Service worker unavailable',e); }
}

async function installPwa(){
  if(!state.deferredInstall) return;
  state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall=null; els.installAppBtn.classList.add('hidden');
}

function updateOnlineStatus(){
  const modelKnown=localStorage.getItem(MODEL_READY_KEY)==='1';
  els.offlinePill.className='status-pill '+(state.ready?'good':(!navigator.onLine&&modelKnown?'good':navigator.onLine?'muted':'warn'));
  els.offlineLabel.textContent=state.ready?`AI ready • ${state.tts?.device||'local'}`:(!navigator.onLine?(modelKnown?'Offline • model cached':'Offline • setup needed'):'Online • local AI');
}

function progressHandler(p){
  const status=p?.status||'';
  if(status==='progress_total' && Number.isFinite(p.loaded) && Number.isFinite(p.total) && p.total>0){
    const pct=Math.max(0,Math.min(100,p.loaded/p.total*100));
    setModelProgress(pct,`Downloading model… ${pct.toFixed(0)}%`);
    setBusyProgress(pct,`Model download ${pct.toFixed(0)}%`);
  } else if(status==='load-start'){
    setModelProgress(2,`Loading ${p.plan||'AI model'}…`); setBusyProgress(2,`Loading ${p.plan||'AI model'}…`);
  } else if(status==='load-compiling'){
    setModelProgress(96,'Compiling model for this Chromebook…'); setBusyProgress(96,'Compiling WebGPU sessions…');
  } else if(status==='load-fallback'){
    toast(`Trying a compatibility fallback: ${p.reason||p.plan||''}`,'warn');
  } else if(status==='load-ready' || status==='ready'){
    setModelProgress(100,'AI ready'); setBusyProgress(100,'AI ready');
  }
}

async function loadVoxshot(){
  if(state.vox) return state.vox;
  state.vox=await import(VOXSHOT_URL);
  return state.vox;
}

async function initEngine({silent=false}={}){
  if(state.ready) return state.tts;
  if(state.loading) throw new Error('The AI engine is already loading.');
  state.loading=true;
  if(!silent) showBusy('Loading offline AI','First load downloads the model. Later loads use the local browser cache.',true);
  els.modelProgressWrap.classList.remove('hidden');
  try{
    await requestPersistentStorage(false);
    const vox=await loadVoxshot();
    state.voiceStore ||= new vox.IndexedDbVoiceStore({databaseName:VOICE_DB});
    // Keep inference in a dedicated worker so the interface stays responsive.
    const worker=new Worker('./tts-worker.js',{type:'module'});
    const workerEngine=new vox.WorkerSynthesisEngine(worker,{name:'chatterbox',sampleRate:24000,onProgress:progressHandler,timeoutMs:0});
    const tts=await vox.VoxShot.create({
      device:state.settings.backend,
      engine:workerEngine,
      voiceStore:state.voiceStore,
      maxChunkLength:Number(state.settings.chunkLength),
      minChunkLength:20,
      synthesisCache:null,
    });
    state.worker=worker; state.workerEngine=workerEngine; state.tts=tts; state.ready=true; state.renderCount=0;
    localStorage.setItem(MODEL_READY_KEY,'1');
    els.diagEngine.textContent='Chatterbox ONNX'; els.diagBackend.textContent=tts.device; els.diagRenders.textContent='0';
    els.setupCard.querySelector('h2').textContent='Offline AI is installed';
    els.setupCard.querySelector('p').textContent='The model has loaded successfully and is stored by the browser for offline use. You can disconnect from the internet after setup.';
    els.installAiBtn.textContent='AI Ready'; els.installAiBtn.disabled=true;
    setModelProgress(100,`Ready on ${tts.device}`); updateOnlineStatus(); await refreshVoiceLibrary(false); await refreshStorage();
    if(state.activeVoice) await state.tts.useVoice(state.activeVoice).catch(()=>{});
    toast(`AI ready on ${tts.device}.`,'success');
    return tts;
  } catch(e){
    state.ready=false;
    state.worker?.terminate(); state.worker=null; state.workerEngine=null; state.tts=null;
    els.installAiBtn.disabled=false; els.installAiBtn.textContent='Try loading AI again'; updateOnlineStatus();
    throw explainLoadError(e);
  } finally { state.loading=false; hideBusy(); }
}

function explainLoadError(e){
  const m=String(e?.message||e);
  if(!navigator.onLine){
    return new Error(localStorage.getItem(MODEL_READY_KEY)==='1'
      ? 'Offline AI could not load from browser storage. Chrome may have evicted part of the model/runtime cache. Reconnect once and press “Install / Load Offline AI” to repair the offline copy.'
      : 'The model has not been installed yet. Connect once, press “Install / Load Offline AI”, let it finish, then offline mode will work.');
  }
  if(/WebGPU|GPU|device/i.test(m)) return new Error(`${m}\n\nTry Settings → Preferred backend → WASM if this Chromebook’s WebGPU driver cannot load the model.`);
  return e instanceof Error?e:new Error(m);
}

async function disposeEngine(notify=false){
  stopPlayback();
  try{await state.tts?.dispose();}catch{}
  try{state.workerEngine?.disconnect?.();}catch{}
  try{state.worker?.terminate();}catch{}
  state.tts=null;state.worker=null;state.workerEngine=null;state.ready=false;state.renderCount=0;
  els.diagEngine.textContent='Not loaded';els.diagBackend.textContent='—';els.diagRenders.textContent='0';
  els.installAiBtn.disabled=false;els.installAiBtn.textContent='Load Offline AI';updateOnlineStatus();
  if(notify) toast('AI memory released. Your model cache and saved voices were kept.','success');
}

async function recycleEngine(reason='Memory protection'){
  const voice=state.activeVoice;
  showBusy('Refreshing AI memory',`${reason}. Saved voices and model files stay on the Chromebook.`);
  await disposeEngine(false);
  await new Promise(r=>setTimeout(r,250));
  await initEngine({silent:true});
  if(voice){await state.tts.useVoice(voice);state.activeVoice=voice;}
  hideBusy();
  toast('AI session refreshed.','success');
}

function isRecoverableError(e){return /device.?lost|GPUBuffer|mapAsync|unmapped|OrtRun|session|disposed|webgpu/i.test(String(e?.message||e));}
async function withRecovery(label,fn){
  try{return await fn();}
  catch(e){
    if(state.settings.autoRecover && isRecoverableError(e)){
      toast(`${label} hit a WebGPU/session error. Rebuilding once…`,'warn');
      await recycleEngine('Automatic GPU recovery');
      return await fn();
    }
    throw e;
  }
}

async function ensureReadyVoice(){
  await initEngine({silent:true});
  const voice=els.voiceSelect.value||state.activeVoice;
  if(!voice) throw new Error('Create or import a voice first, then select it.');
  if(state.activeVoice!==voice){await state.tts.useVoice(voice);state.activeVoice=voice;}
  return voice;
}

async function selectVoice(name){
  state.activeVoice=name||'';
  if(!name) return;
  if(state.ready) await state.tts.useVoice(name);
  await setMeta('lastVoice',name);
  renderVoiceLibrarySelection();
}

async function streamSpeak(){
  const text=els.ttsText.value.trim(); if(!text) throw new Error('Type something to speak first.');
  const voice=await ensureReadyVoice();
  stopPlayback();
  const options={speed:Number(els.speedRange.value),expressiveness:Number(els.expressionRange.value),volume:1};
  els.speakBtn.disabled=true;els.stopBtn.disabled=false;
  try{
    await withRecovery('Speech playback',async()=>{
      state.playback=state.tts.play(text,options);
      await state.playback.done;
    });
    countRender();
  } finally {els.speakBtn.disabled=false;els.stopBtn.disabled=true;state.playback=null;}
  await maybeRecycle();
}

function stopPlayback(){
  try{state.playback?.stop?.();}catch{}
  try{els.outputAudio.pause();}catch{}
  state.abortController?.abort();state.abortController=null;state.playback=null;els.stopBtn.disabled=true;els.speakBtn.disabled=false;
}

async function generateWav(){
  const text=els.ttsText.value.trim();if(!text) throw new Error('Type something to generate first.');
  if(text.length>5000 && !confirm('This is a long render for an 8 GB Chromebook. Continue?')) return;
  const voice=await ensureReadyVoice();
  showBusy('Generating WAV',`Rendering with “${voice}” in memory-safe chunks.`,false,true);
  state.abortController=new AbortController();els.cancelBusyBtn.classList.remove('hidden');
  try{
    const audio=await withRecovery('WAV generation',()=>state.tts.speak(text,{speed:Number(els.speedRange.value),expressiveness:Number(els.expressionRange.value),signal:state.abortController.signal}));
    state.lastAudio=audio;
    const blob=audio.toBlob();
    if(state.lastAudioUrl) URL.revokeObjectURL(state.lastAudioUrl);
    state.lastAudioUrl=URL.createObjectURL(blob);els.outputAudio.src=state.lastAudioUrl;
    els.outputDuration.textContent=`${audio.duration.toFixed(1)} sec`;els.outputVoice.textContent=voice;els.outputTime.textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    els.outputEmpty.classList.add('hidden');els.outputReady.classList.remove('hidden');
    countRender(); toast('WAV generated locally.','success');
  } finally {state.abortController=null;els.cancelBusyBtn.classList.add('hidden');hideBusy();}
  await maybeRecycle();
}

function downloadLastWav(){
  if(!state.lastAudio) return;
  const blob=state.lastAudio.toBlob();downloadBlob(blob,`${safeName(state.activeVoice||'voice')}-${timestamp()}.wav`);
}

function countRender(){state.renderCount++;els.diagRenders.textContent=String(state.renderCount);}
async function maybeRecycle(){
  if(!state.settings.autoRecycle || state.renderCount<Number(state.settings.recycleAfter)) return;
  await recycleEngine(`Chromebook memory protection after ${state.renderCount} renders`);
}

async function loadReference(file){
  if(!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|flac|ogg|opus|webm)$/i.test(file.name)) throw new Error('Choose an audio file.');
  showBusy('Analyzing reference audio','Finding a clean speech-heavy section locally.');
  try{
    const array=await file.arrayBuffer();
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const buffer=await ctx.decodeAudioData(array.slice(0));
    await ctx.close();
    if(buffer.duration<1) throw new Error('Reference audio must be at least 1 second long.');
    if(buffer.duration>600.5) throw new Error('Reference audio must be 10 minutes or shorter.');
    const mono=downmix(buffer);
    const chosen=chooseReferenceWindow(mono,buffer.sampleRate,buffer.duration);
    state.selectedPcm={samples:chosen.samples,sampleRate:buffer.sampleRate};state.selectedFile=file;
    els.referenceDetails.classList.remove('hidden');els.referenceName.textContent=file.name;els.referenceDuration.textContent=formatTime(buffer.duration);
    revokeAudio(els.referenceAudio);els.referenceAudio.src=URL.createObjectURL(file);
    els.sampleRange.textContent=`${formatTime(chosen.start)} – ${formatTime(chosen.end)}`;
    els.sampleQuality.textContent=chosen.label;
    const sampleBlob=pcmToWavBlob(chosen.samples,buffer.sampleRate);revokeAudio(els.sampleAudio);els.sampleAudio.src=URL.createObjectURL(sampleBlob);
    drawWave(chosen.samples); updateCloneButton();
    if(!els.cloneName.value) els.cloneName.value=file.name.replace(/\.[^.]+$/,'').slice(0,60);
    updateCloneButton();
  } finally {hideBusy();}
}

function downmix(buffer){
  const len=buffer.length,out=new Float32Array(len),channels=buffer.numberOfChannels;
  for(let c=0;c<channels;c++){const d=buffer.getChannelData(c);for(let i=0;i<len;i++)out[i]+=d[i]/channels;}
  return out;
}

function chooseReferenceWindow(samples,sr,duration){
  const target=Math.min(duration,12);const win=Math.max(1,Math.floor(target*sr));
  if(samples.length<=win) return {samples:Float32Array.from(samples),start:0,end:duration,label:'Using the full recording — short, focused references are ideal.'};
  const step=Math.max(1,Math.floor(1.5*sr));let best={score:-Infinity,start:0};
  for(let s=0;s+win<=samples.length;s+=step){
    let sum=0,active=0,clip=0,dc=0;const stride=Math.max(1,Math.floor(sr/8000));let n=0;
    for(let i=s;i<s+win;i+=stride){const v=samples[i];sum+=v*v;dc+=v;if(Math.abs(v)>.012)active++;if(Math.abs(v)>.985)clip++;n++;}
    const rms=Math.sqrt(sum/n),speech=active/n,clipRatio=clip/n,dcAbs=Math.abs(dc/n);
    const score=Math.log10(rms+1e-5)*1.1 + speech*2.7 - clipRatio*18 - dcAbs*2;
    if(score>best.score) best={score,start:s};
  }
  const out=Float32Array.from(samples.subarray(best.start,best.start+win));const start=best.start/sr,end=(best.start+win)/sr;
  const peak=maxAbs(out),rms=Math.sqrt(out.reduce((a,v)=>a+v*v,0)/out.length);
  let label='Good candidate: active speech level with limited clipping.';
  if(peak>.99) label='Usable, but this section is close to clipping. A quieter recording may clone better.';
  else if(rms<.02) label='This reference is fairly quiet. A closer/louder recording may clone better.';
  return {samples:out,start,end,label};
}
function maxAbs(a){let m=0;for(const v of a)m=Math.max(m,Math.abs(v));return m;}
function drawWave(samples){
  els.waveMini.innerHTML='';const bars=60,chunk=Math.max(1,Math.floor(samples.length/bars));
  for(let b=0;b<bars;b++){let m=0;for(let i=b*chunk;i<Math.min(samples.length,(b+1)*chunk);i+=8)m=Math.max(m,Math.abs(samples[i]));const bar=document.createElement('i');bar.style.height=`${Math.max(5,Math.min(100,m*130))}%`;els.waveMini.appendChild(bar);}
}

function updateCloneButton(){els.createCloneBtn.disabled=!(state.selectedPcm&&els.cloneName.value.trim()&&els.consentCheck.checked);}

async function createClone(){
  if(!state.selectedPcm) throw new Error('Choose reference audio first.');
  if(!els.consentCheck.checked) throw new Error('Confirm that you have permission to clone this voice.');
  const name=els.cloneName.value.trim(); if(!name) throw new Error('Give the voice a name.');
  await initEngine({silent:true});
  showBusy('Creating voice clone','Running the speech encoder locally. Nothing is uploaded.');
  try{
    await withRecovery('Voice cloning',()=>state.tts.cloneVoice(state.selectedPcm));
    await state.tts.saveVoice(name); state.activeVoice=name; await setMeta('lastVoice',name);
    let previewBlob=null;
    if(els.previewCheck.checked){
      setBusyText('Voice created. Generating a short local preview…');
      const preview=await withRecovery('Preview generation',()=>state.tts.speak('Hello. This is a preview of my locally cloned voice.',{expressiveness:.5,speed:1}));
      previewBlob=preview.toBlob();countRender();
    }
    await putVoiceMeta(name,{name,createdAt:Date.now(),referenceSeconds:state.selectedPcm.samples.length/state.selectedPcm.sampleRate,preview:previewBlob,sourceName:state.selectedFile?.name||'',engine:'chatterbox'});
    await refreshVoiceLibrary(false); els.voiceSelect.value=name;toast(`Saved “${name}” to this Chromebook.`,'success');switchTab('tts');
  } finally {hideBusy();}
  await maybeRecycle();
}

async function refreshVoiceLibrary(selectLast=true){
  try{
    if(!state.voiceStore){
      const vox=await loadVoxshot();state.voiceStore=new vox.IndexedDbVoiceStore({databaseName:VOICE_DB});
    }
    const names=await state.voiceStore.list();
    const last=selectLast?(await getMeta('lastVoice')):state.activeVoice;
    els.voiceSelect.innerHTML='';
    if(!names.length){const o=new Option('No saved voices yet','');els.voiceSelect.add(o);state.activeVoice='';}
    else names.forEach(n=>els.voiceSelect.add(new Option(n,n)));
    if(names.includes(last)){els.voiceSelect.value=last;state.activeVoice=last;}else if(names.length){els.voiceSelect.value=names[0];state.activeVoice=names[0];}
    els.voiceLibrary.innerHTML='';
    if(!names.length){els.voiceLibrary.innerHTML='<div class="empty-state"><div class="empty-icon">◌</div><h3>No voices yet</h3><p>Create a local clone or import one.</p></div>';return;}
    for(const name of names){els.voiceLibrary.appendChild(await buildVoiceCard(name));}
  } catch(e){console.warn(e);}
}

async function buildVoiceCard(name){
  const meta=await getVoiceMeta(name);const card=document.createElement('div');card.className='voice-card'+(name===state.activeVoice?' selected':'');card.dataset.voice=name;
  const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('');
  card.innerHTML=`<div class="voice-top"><div class="voice-title"><div class="voice-avatar">${escapeHtml(initials||'V')}</div><div><h3>${escapeHtml(name)}</h3><p>${meta?.createdAt?new Date(meta.createdAt).toLocaleDateString():'Saved locally'} • Chatterbox</p></div></div></div><div class="voice-actions"><button class="secondary use">Use</button><button class="secondary export">Export</button><button class="danger delete">Delete</button></div>`;
  if(meta?.preview instanceof Blob){const a=document.createElement('audio');a.controls=true;a.src=URL.createObjectURL(meta.preview);card.appendChild(a);}
  card.querySelector('.use').onclick=async()=>{els.voiceSelect.value=name;await selectVoice(name);switchTab('tts');toast(`Using “${name}”.`,'success');};
  card.querySelector('.export').onclick=()=>exportVoice(name).catch(showError);
  card.querySelector('.delete').onclick=()=>deleteVoice(name).catch(showError);
  return card;
}
function renderVoiceLibrarySelection(){document.querySelectorAll('.voice-card').forEach(c=>c.classList.toggle('selected',c.dataset.voice===state.activeVoice));}

async function exportVoice(name){
  const embedding=await state.voiceStore.load(name);if(!embedding) throw new Error('Voice not found.');
  const meta=await getVoiceMeta(name);
  showBusy('Exporting voice','Packing the cloned voice tensors into a portable local file.');
  try{
    const payload={format:'local-voice-studio-clone',version:PACKAGE_VERSION,name,exportedAt:Date.now(),embedding:serializeEmbedding(embedding),meta:await serializeMeta(meta)};
    const raw=new TextEncoder().encode(JSON.stringify(payload));let blob;
    if('CompressionStream' in globalThis){const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));blob=await new Response(stream).blob();}
    else blob=new Blob([raw],{type:'application/json'});
    downloadBlob(blob,`${safeName(name)}.voiceclone`);toast(`Exported “${name}”.`,'success');
  } finally{hideBusy();}
}

async function importVoice(file){
  showBusy('Importing voice','Checking and saving the clone to IndexedDB.');
  try{
    let bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes[0]===0x1f&&bytes[1]===0x8b){if(!('DecompressionStream' in globalThis))throw new Error('This browser cannot unpack the compressed clone file.');const ds=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));bytes=new Uint8Array(await new Response(ds).arrayBuffer());}
    const pkg=JSON.parse(new TextDecoder().decode(bytes));
    if(pkg?.format!=='local-voice-studio-clone'||pkg.version!==PACKAGE_VERSION) throw new Error('This is not a compatible Local Voice Studio clone file.');
    const embedding=deserializeEmbedding(pkg.embedding);if(embedding.engine&&embedding.engine!=='chatterbox')throw new Error(`This clone was made by “${embedding.engine}”, not Chatterbox.`);
    if(!state.voiceStore){const vox=await loadVoxshot();state.voiceStore=new vox.IndexedDbVoiceStore({databaseName:VOICE_DB});}
    let name=String(pkg.name||'Imported Voice').slice(0,60);const existing=await state.voiceStore.list();if(existing.includes(name)) name=`${name} (imported)`;
    await state.voiceStore.save(name,embedding);if(pkg.meta) await putVoiceMeta(name,{...(await deserializeMeta(pkg.meta)),name});
    await setMeta('lastVoice',name);state.activeVoice=name;await refreshVoiceLibrary(false);els.voiceSelect.value=name;toast(`Imported “${name}”.`,'success');
  } finally{hideBusy();}
}

async function deleteVoice(name){
  if(!confirm(`Delete “${name}” from this Chromebook?`)) return;
  await state.voiceStore.delete(name);await deleteVoiceMeta(name);if(state.activeVoice===name)state.activeVoice='';await refreshVoiceLibrary(false);toast(`Deleted “${name}”.`,'success');
}

function serializeEmbedding(e){
  const out={vector:packTyped(e.vector),sampleRate:e.sampleRate,createdAt:e.createdAt,engine:e.engine||'',tensors:{}};
  for(const [k,t] of Object.entries(e.tensors||{}))out.tensors[k]={type:t.type,dims:Array.from(t.dims),data:packTyped(t.data)};
  return out;
}
function deserializeEmbedding(e){
  if(!e||!Number.isFinite(e.sampleRate))throw new Error('Clone data is incomplete.');
  const tensors={};for(const [k,t] of Object.entries(e.tensors||{}))tensors[k]={type:t.type,dims:t.dims,data:unpackTyped(t.data,t.type==='int64'?'bigint64':'float32')};
  return {vector:unpackTyped(e.vector,'float32'),sampleRate:e.sampleRate,createdAt:e.createdAt||Date.now(),engine:e.engine||'chatterbox',tensors};
}
function packTyped(a){return {kind:a instanceof BigInt64Array?'bigint64':'float32',bytes:bytesToBase64(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))};}
function unpackTyped(p,kind){const b=base64ToBytes(p.bytes).buffer;return kind==='bigint64'?new BigInt64Array(b):new Float32Array(b);}
function bytesToBase64(bytes){let s='',step=0x8000;for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(s);}
function base64ToBytes(s){const bin=atob(s),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
async function serializeMeta(meta){if(!meta)return null;const out={...meta};if(meta.preview instanceof Blob)out.preview={mime:meta.preview.type||'audio/wav',data:bytesToBase64(new Uint8Array(await meta.preview.arrayBuffer()))};return out;}
async function deserializeMeta(meta){const out={...meta};if(meta.preview?.data)out.preview=new Blob([base64ToBytes(meta.preview.data)],{type:meta.preview.mime||'audio/wav'});return out;}

function saveSettingsFromUi(){
  state.settings={backend:els.backendSelect.value,chunkLength:Number(els.chunkSelect.value),autoRecover:els.autoRecoverCheck.checked,autoRecycle:els.autoRecycleCheck.checked,recycleAfter:Number(els.recycleSelect.value)};
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(state.settings));toast('Settings saved. Reload the AI engine for backend/chunk changes.','success');
}
function loadSettings(){
  const defaults={backend:'auto',chunkLength:110,autoRecover:true,autoRecycle:true,recycleAfter:5};
  try{return {...defaults,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};}catch{return defaults;}
}
function applySettingsToUi(){els.backendSelect.value=state.settings.backend;els.chunkSelect.value=String(state.settings.chunkLength);els.autoRecoverCheck.checked=state.settings.autoRecover;els.autoRecycleCheck.checked=state.settings.autoRecycle;els.recycleSelect.value=String(state.settings.recycleAfter);}

async function requestPersistentStorage(notify=true){
  if(!navigator.storage?.persist){if(notify)toast('Persistent-storage API is not available in this browser.','warn');return false;}
  try{const ok=await navigator.storage.persist();if(notify)toast(ok?'Chrome will protect this app’s offline data when possible.':'Chrome did not grant persistent storage; the app still works, but storage may be evicted under pressure.',ok?'success':'warn');return ok;}catch{return false;}
}

async function refreshStorage(){
  try{const e=await navigator.storage?.estimate?.();if(!e)return;const used=e.usage||0,quota=e.quota||1,pct=Math.min(100,used/quota*100);els.storageBar.style.width=`${pct}%`;els.storageText.textContent=`${formatBytes(used)} used of ${formatBytes(quota)} browser storage`;els.diagStorage.textContent=`${formatBytes(used)} / ${formatBytes(quota)}`;}catch{}
}

async function clearModelCaches(){
  if(!confirm('Clear cached AI/model files? Saved voice clones remain, but you will need internet to download the model again.')) return;
  await disposeEngine(false);
  const keys=await caches.keys();let count=0;
  for(const k of keys){if(!k.startsWith('local-voice-studio-vendor') && /transform|hugging|onnx|model|xet/i.test(k)){if(await caches.delete(k))count++;}}
  // Transformers.js often uses a named browser cache; clear likely names but leave app shell and voice IndexedDB alone.
  for(const k of ['transformers-cache','transformers.js','huggingface']){try{if(await caches.delete(k))count++;}catch{}}
  localStorage.removeItem(MODEL_READY_KEY);els.setupCard.querySelector('h2').textContent='Install the offline AI model';els.installAiBtn.textContent='Install / Load Offline AI';els.installAiBtn.disabled=false;await refreshStorage();toast(`Model cache cleanup completed (${count} cache${count===1?'':'s'} removed).`,'success');
}

async function runDiagnostics(){
  const rows=[];const ua=navigator.userAgent;
  rows.push(['Browser',/Chrome\/(\d+)/.exec(ua)?.[0]||navigator.userAgentData?.brands?.map(x=>x.brand+' '+x.version).join(', ')||'Unknown']);
  rows.push(['WebGPU',navigator.gpu?'Available':'Not available']);
  let adapterText='Not checked';
  if(navigator.gpu){try{const a=await navigator.gpu.requestAdapter();adapterText=a?`Available${a.features?.has?.('shader-f16')?' • shader-f16':''}`:'No adapter';}catch(e){adapterText='Probe failed';}}
  rows.push(['GPU adapter',adapterText]);rows.push(['WASM fallback','Available']);rows.push(['IndexedDB','indexedDB' in globalThis?'Available':'Unavailable']);rows.push(['Service Worker','serviceWorker' in navigator?'Available':'Unavailable']);
  rows.push(['Connection',navigator.onLine?'Online':'Offline']);rows.push(['Model previously installed',localStorage.getItem(MODEL_READY_KEY)==='1'?'Yes':'No']);
  rows.push(['Preferred backend',state.settings.backend]);rows.push(['Active backend',state.ready?(state.tts?.device||'Unknown'):'AI not loaded']);
  if(navigator.storage?.persisted){try{rows.push(['Persistent storage',(await navigator.storage.persisted())?'Granted':'Not granted']);}catch{}}
  els.diagnostics.innerHTML='';for(const [k,v] of rows){const d=document.createElement('div');d.className='diag-item';d.innerHTML=`<span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b>`;els.diagnostics.appendChild(d);}await refreshStorage();
}
function copyDiagnostics(){const text=[...els.diagnostics.querySelectorAll('.diag-item')].map(x=>`${x.querySelector('span').textContent}: ${x.querySelector('b').textContent}`).join('\n');navigator.clipboard?.writeText(text).then(()=>toast('Diagnostics copied.','success')).catch(()=>toast('Could not copy diagnostics.','error'));}

async function openMetaDb(){return await new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv');if(!db.objectStoreNames.contains('voices'))db.createObjectStore('voices',{keyPath:'name'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function idbReq(store,mode,fn){const db=await openMetaDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),req=fn(tx.objectStore(store));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});}
const setMeta=(k,v)=>idbReq('kv','readwrite',s=>s.put(v,k));const getMeta=k=>idbReq('kv','readonly',s=>s.get(k));
const putVoiceMeta=(name,v)=>idbReq('voices','readwrite',s=>s.put({...v,name}));const getVoiceMeta=name=>idbReq('voices','readonly',s=>s.get(name));const deleteVoiceMeta=name=>idbReq('voices','readwrite',s=>s.delete(name));

function showBusy(title,text,progress=false,cancellable=false){els.busyTitle.textContent=title;els.busyText.textContent=text;els.busyOverlay.classList.remove('hidden');els.busyProgressWrap.classList.toggle('hidden',!progress);els.cancelBusyBtn.classList.toggle('hidden',!cancellable);if(progress)setBusyProgress(0,'Preparing…');}
function setBusyText(t){els.busyText.textContent=t;}function hideBusy(){els.busyOverlay.classList.add('hidden');els.cancelBusyBtn.classList.add('hidden');}
function setBusyProgress(p,t){els.busyProgressWrap.classList.remove('hidden');els.busyProgress.style.width=`${p}%`;els.busyProgressText.textContent=t||'';}
function setModelProgress(p,t){els.modelProgressWrap.classList.remove('hidden');els.modelProgress.style.width=`${p}%`;els.modelProgressText.textContent=t||'';}
function toast(msg,type=''){const d=document.createElement('div');d.className=`toast ${type}`;d.textContent=msg;els.toastHost.appendChild(d);setTimeout(()=>d.remove(),5200);}
function showError(e){hideBusy();console.error(e);toast(String(e?.message||e),'error');}
function downloadBlob(blob,name){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function pcmToWavBlob(samples,sr){const buf=new ArrayBuffer(44+samples.length*2),v=new DataView(buf);const w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');v.setUint32(4,36+samples.length*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true);}return new Blob([buf],{type:'audio/wav'});}
function revokeAudio(el){if(el.src?.startsWith('blob:'))URL.revokeObjectURL(el.src);}
function formatTime(sec){const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,'0')}`;}
function formatBytes(n){const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${n.toFixed(i>1?1:0)} ${u[i]}`;}
function safeName(s){return String(s).replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,70)||'voice';}
function timestamp(){const d=new Date();return d.toISOString().replace(/[:.]/g,'-').slice(0,19);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
