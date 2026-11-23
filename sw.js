const CACHE_VERSION = 'aeronav-haho-v2026-11-22-14';
// La cache dei tasselli mappa ha nome fisso: NON viene cancellata agli aggiornamenti dell'app
const TILE_CACHE = 'aeronav-tiles-v1';
const MAX_TILES = 5000; // oltre questo numero vengono eliminati i tasselli piu' vecchi

const EMPTY_TILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './nav.html',
        './mgrs-core.js',
        './team-client.js',
        './manifest.json',
        './icon-192.svg',
        './icon-512.svg'
      ]).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Restituisce l'URL canonico del tassello (stesso tassello = stessa chiave), oppure null se non e' un tassello mappa
function tileKeyFor(url) {
  if (/^([abc]\.)?tile\.openstreetmap\.org$/.test(url.hostname)) {
    return 'https://tile.openstreetmap.org' + url.pathname;
  }
  if (url.hostname === 'server.arcgisonline.com' && url.pathname.includes('/World_Imagery/MapServer/tile/')) {
    return url.origin + url.pathname;
  }
  return null;
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  // Elimina i piu' vecchi (ordine di inserimento) lasciando un po' di margine
  const toDelete = keys.length - MAX_TILES + 200;
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(keys[i]);
  }
}

async function handleTile(event, key) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit) return hit;

  try {
    // Richiesta CORS fatta dal service worker: la risposta e' leggibile e salvabile (non opaca)
    const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
    if (res && res.ok) {
      event.waitUntil(
        cache.put(key, res.clone()).then(() => {
          if (Math.random() < 0.02) return trimTiles(cache);
        }).catch(() => {})
      );
    }
    return res;
  } catch (err) {
    // CORS non concesso o rete assente: provo la richiesta originale (non salvata)
    try {
      return await fetch(event.request);
    } catch (err2) {
      return new Response(EMPTY_TILE_SVG, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
    }
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  const tileKey = tileKeyFor(url);
  if (tileKey) {
    event.respondWith(handleTile(event, tileKey));
    return;
  }

  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
