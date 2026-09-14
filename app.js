import { LocalTTS, IndexedDbVoiceStore } from './local-tts.js';
const DB_NAME = 'local-voice-studio-meta';
const VOICE_DB = 'local-voice-studio-voices-v2';
const SETTINGS_KEY = 'lvs-settings-v1';
const MODEL_READY_KEY = 'lvs-model-ready-v2';
const PACKAGE_VERSION = 1;

const $ = (id) => document.getElementById(id);
const state = {
  tts: null, voiceStore: null,
  ready: false, loading: false, activeVoice: '', playback: null, abortController: null,
  renderCount: 0, lastAudio: null, lastAudioUrl: '', selectedPcm: null, selectedFile: null,
  deferredInstall: null,
  settings: loadSettings(),
};
