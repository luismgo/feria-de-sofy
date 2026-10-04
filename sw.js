const CACHE_NAME = 'sofy-feria-v1.0.0';

const STATIC_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'js/app.js',
  'js/auth.js',
  'js/catalogos.js',
  'js/config.js',
  'js/connection.js',
  'js/ferias.js',
  'js/ideas.js',
  'js/insumos.js',
  'js/inventario.js',
  'js/nav.js',
  'js/pwa-update.js',
  'js/reporte-general.js',
  'js/reportes.js',
  'js/supabaseClient.js',
  'js/ui.js',
  'js/vender.js'
];

self.addEventListener('install', (event) => {
  // Pre-cachea el app shell. No llamamos skipWaiting() acá para no interrumpir
  // una venta en curso; esperamos la confirmación de la usuaria en el popup.
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] No se pudo pre-cachear ${url}:`, err);
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  // Limpia cachés de versiones viejas y reclama clientes
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Ignorar métodos que no sean GET
  if (event.request.method !== 'GET') return;

  // 2. Nunca cachear ni interceptar llamadas a Supabase (auth, RPCs, realtime, Postgres REST)
  if (url.hostname.includes('supabase.co')) return;

  // 3. Estrategia Network-First con fallback a Cache para la app shell
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors')
        ) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./') || caches.match('index.html');
          }
          return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
