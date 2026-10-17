// Service worker: offline support and instant updates.
// Bump CACHE on every release, together with core.js?v= in index.html.
const CACHE = 'solitaire-v1';
const SHELL = ['./', 'index.html', 'core.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))   // skip the phone's 10-minute copy
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('solitaire-')).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first, so GitHub is always asked. Give it 4 seconds, then use the saved copy.
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        // a navigation request can't be copied with new options, so fetch its URL instead
        const net = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
        const r = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch {
        return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
      }
    })());
    return;
  }
  if (FONTS.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
  }
});
