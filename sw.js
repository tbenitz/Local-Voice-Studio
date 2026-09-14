const APP_CACHE = 'local-voice-studio-v2-fixed';
const VENDOR_CACHE = 'local-voice-studio-vendor-v2-fixed';
const SHELL = ['./','./index.html','./styles.css','./app.js','./tts-worker.js','./local-tts.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keep = new Set([APP_CACHE,VENDOR_CACHE]);
    for (const key of await caches.keys()) if (!keep.has(key) && key.startsWith('local-voice-studio-')) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const vendor = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'esm.sh' || url.hostname.endsWith('.esm.sh');
  // Do not wrap Hugging Face model files. Transformers.js handles those itself;
  // caching partial/range model responses here can create 206 Cache API failures.
  if (!same && !vendor) return;
  if (same) {
    event.respondWith((async()=>{
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(APP_CACHE)).put(req,res.clone()).catch(()=>{});
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        throw err;
      }
    })());
    return;
  }
  if (vendor) {
    event.respondWith((async()=>{
      const cache = await caches.open(VENDOR_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req,res.clone()).catch(()=>{});
      return res;
    })());
  }
});
