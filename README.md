# Local Voice Studio — Chromebook Offline Voice Cloning

A static installable PWA designed for an 8 GB Chromebook. Speech generation runs locally after the first model download.

This fixed build uses Chatterbox ONNX through `@huggingface/transformers` in the browser (WebGPU first, WASM fallback). The older VoxShot wrapper is gone so the app no longer sits on **Loading** before model files start downloading.

## What changed

- Added `local-tts.js` (was missing from the previous repo snapshot)
- `tts-worker.js` talks to Transformers.js directly
- `app.js` uses `LocalTTS` + IndexedDB voice store instead of VoxShot
- Service worker cache bumped to `local-voice-studio-v2-fixed` and now includes `local-tts.js`
- Removed leftover `icons/test.txt`

## Chromebook setup

Do **not** open `index.html` from the Files app. Use a secure origin (GitHub Pages).

1. Repo **Settings → Pages** → Deploy from branch `main`, `/ (root)`.
2. Open the Pages URL in Chrome.
3. Hard-reload once so the new service worker activates.
4. Settings → Diagnostics: confirm WebGPU, or switch backend to WASM.
5. Press **Install / Load Offline AI** while online.
6. Wait until the UI says **AI ready**, then clone a voice and test TTS.

First setup needs internet for the JS runtime and Hugging Face model. After that, generation is local if Chrome keeps the cache.

## If WebGPU fails

Settings → Preferred backend → WASM → save → **Reload AI**.

## Main files

- `index.html` — UI
- `styles.css`
- `app.js` — cloning flow, TTS, export/import
- `local-tts.js` — TTS client + IndexedDB voice store
- `tts-worker.js` — Chatterbox inference worker
- `sw.js` — PWA shell cache
- `manifest.webmanifest`
