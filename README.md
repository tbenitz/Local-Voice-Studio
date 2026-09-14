# Local Voice Studio — Chromebook Offline Voice Cloning

A static installable PWA designed for an 8 GB Chromebook. It uses Chatterbox ONNX in the browser through VoxShot + Transformers.js, with WebGPU first and WASM fallback.

## What it does

- Real zero-shot voice cloning from local audio.
- Accepts browser-decodable audio from 1 second to 10 minutes.
- For long recordings, selects a ~12 second speech-heavy section before cloning.
- Saves cloned voice tensors in IndexedDB across sessions.
- Portable `.voiceclone` export/import.
- Streaming text-to-speech for lower peak RAM.
- Full WAV generation/download.
- WebGPU → WASM fallback.
- Automatic recovery for common Chromebook GPU/session failures.
- Periodic AI-session recycling to limit memory buildup on 8 GB systems.
- PWA shell works offline after setup.

## Easiest Chromebook installation

Because WebGPU, Service Workers and installable PWAs require a secure web origin, do **not** double-click `index.html` from the Files app.

### GitHub Pages (recommended)

1. Create a GitHub repository.
2. Upload everything in this folder to the repository root.
3. In the repository, open **Settings → Pages**.
4. Choose **Deploy from a branch**, your main branch, and `/ (root)`.
5. Open the Pages URL in Chrome on the Chromebook.
6. Press **Install / Load Offline AI** while connected to Wi‑Fi.
7. Let the model fully download and compile.
8. Use Chrome's install-app button (or the app's **Install app** button when shown).
9. Open the installed app once more, then disconnect Wi‑Fi and test it.

The initial model download is large (roughly around the 1–2 GB class depending on the selected model files/fallback). Keep several GB of free Chromebook storage.

## Offline model behavior

The app shell is cached by `sw.js`. VoxShot/Transformers.js runtime modules are cached by the Service Worker as they load. Hugging Face model files are deliberately **not** intercepted by this Service Worker because ONNX/model downloads may use partial/range responses; Transformers.js manages its own browser model cache.

The app requests persistent browser storage so Chrome is less likely to evict model/voice data under storage pressure.

## Voice clone files

`.voiceclone` files are compressed JSON packages containing the Chatterbox speaker conditioning tensors and optional preview audio. They do **not** need the original reference MP3/WAV to be imported later.

Voice embeddings are engine-specific. This build rejects clone packages made by a different engine instead of silently producing bad audio.

## Important limitations

- Current browser Chatterbox path is English-first.
- WASM can work when WebGPU cannot, but is substantially slower.
- ChromeOS GPU drivers vary. If WebGPU fails repeatedly, choose **Settings → Preferred backend → WASM** and reload the AI engine.
- The first model installation requires internet. After successful installation/caching, generation itself is local.

## Privacy / responsible use

Reference audio and generated speech stay in the browser in this design. Only clone voices you own or have permission to use. Do not use voice cloning to impersonate people deceptively or bypass identity/authentication systems.

## Main files

- `index.html` — UI
- `styles.css` — responsive styling
- `app.js` — IndexedDB, cloning flow, TTS, export/import, recovery
- `tts-worker.js` — Chatterbox inference worker
- `sw.js` — PWA/offline application shell cache
- `manifest.webmanifest` — install metadata
