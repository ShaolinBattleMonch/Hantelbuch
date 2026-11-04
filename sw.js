/* Hantelbuch – Service Worker: macht die App offline nutzbar.
   Bei einem Update der App-Dateien VERSION hochzählen, dann laden alle Geräte die neue Version. */
const VERSION = 'hantelbuch-v13';
const FONTS = 'hantelbuch-fonts';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './flamme-a.webp', './flamme-b.webp', './flamme-c.webp', './flamme-woche.webp',
  './flamme-hero-a.webp', './flamme-hero-b.webp', './flamme-hero-c.webp', './flamme-hero-woche.webp'
];

self.addEventListener('install', event => {
  // cache: 'reload' umgeht den Browser-Zwischenspeicher, damit wirklich die neuen Dateien geladen werden
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Schriften: einmal laden, danach aus dem Speicher
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch (e) { return new Response('', { status: 504 }); }
    }));
    return;
  }

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
