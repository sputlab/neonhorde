// =====================================================================
// sw.js — Service Worker di NEON HORDE
//
// Strategia: "stale-while-revalidate" per l'app shell (HTML/CSS/JS/
// icone): risponde subito dalla cache se disponibile, poi aggiorna la
// cache in background dalla rete per la prossima visita. Le chiamate
// API (qualunque URL che contiene "/api/") NON vengono mai messe in
// cache: autenticazione, classifica, negozio, missioni e punteggi
// devono restare sempre aggiornati in tempo reale.
//
// IMPORTANTE: aggiorna CACHE_NAME ad ogni release (fallo coincidere con
// APP_VERSION in js/config.js) per invalidare automaticamente la cache
// della versione precedente sui dispositivi degli utenti.
// =====================================================================

const CACHE_NAME = 'neon-horde-v1.37.1';

const APP_SHELL = [
  // NOTA: niente './' qui — la root ora serve la landing page
  // (index.html, pagina separata non installabile), non il gioco.
  // Il gioco vive esplicitamente in game.html.
  './game.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/audio.js',
  './js/entities.js',
  './js/spawner.js',
  './js/boss.js',
  './js/weapons.js',
  './js/upgrades.js',
  './js/api.js',
  './js/ui.js',
  './js/game.js',
  './js/settings.js',
  './js/i18n.js',
  './js/sensors.js',
  './js/music.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-16x16.png',
  './icons/favicon-32x32.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[sw] precache fallito (non bloccante):', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Mai in cache: le API devono restare sempre fresche.
  if (url.pathname.includes('/api/')) return;

  // Cacheable solo richieste GET http/https (esclude es. chrome-extension://).
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => cached); // offline: fallback alla cache se la rete fallisce

      return cached || networkFetch;
    })
  );
});
