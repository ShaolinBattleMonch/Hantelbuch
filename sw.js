/* Hantelbuch – Service Worker: macht die App offline nutzbar.
   Bei einem Update der App-Dateien VERSION hochzählen, dann laden alle Geräte die neue Version. */
const VERSION = 'built-v34';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './vendor/supabase-2.118.0.js', './vendor/qrcode-generator-2.0.4.js', './vendor/jsqr-1.4.0.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './flammen/flamme-a.webp', './flammen/flamme-b.webp', './flammen/flamme-c.webp', './flammen/flamme-d.webp', './flammen/flamme-e.webp', './flammen/flamme-f.webp', './flammen/flamme-woche.webp',
  './flammen/flamme-hero-a.webp', './flammen/flamme-hero-b.webp', './flammen/flamme-hero-c.webp', './flammen/flamme-hero-d.webp', './flammen/flamme-hero-e.webp', './flammen/flamme-hero-f.webp', './flammen/flamme-hero-woche.webp',
  './fonts/unbounded.woff2', './fonts/geist.woff2', './fonts/geist-mono.woff2'
];

self.addEventListener('install', event => {
  // cache: 'reload' umgeht den Browser-Zwischenspeicher, damit wirklich die neuen Dateien geladen werden
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return; // Google-Sync nie zwischenspeichern

  // App-Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren
  event.respondWith(caches.open(VERSION).then(async c => {
    const key = req.mode === 'navigate' ? './index.html' : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(net); return hit; }
    const res = await net;
    return res || new Response('Offline', { status: 503 });
  }));
});
