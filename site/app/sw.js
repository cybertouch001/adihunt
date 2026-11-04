// AdiHunt service worker: caches the app shell so the PWA opens fast; API + map tiles always go to the network.
const V = 'adihunt-shell-1.0.0'; const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'art.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok && SHELL.some(s => u.pathname.endsWith(s.replace('./', '')) )) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html')))); });
