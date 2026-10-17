/* ==========================================================================
   sw.js — Service Worker | أكاديمية الجزار - Elgazzar Institutes
   ========================================================================== */

const CACHE_NAME    = 'elgazzar-cache-v4';
const STATIC_ASSETS = [
  './index.html',
  './db.js',
  './app.js',
  './styles.css',
  './manifest.json',
  './logo.jpg',
];

/* ---------- Install: cache الملفات الأساسية ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.warn('[SW] فشل التخزين المؤقت:', err))
  );
  self.skipWaiting();
});

/* ---------- Activate: حذف الـ Caches القديمة ---------- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ---------- Fetch: استراتيجية Network-First ---------- */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  /* طلبات Supabase و CDN: دايماً من الشبكة */
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    e.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  /* الملفات المحلية: Network-First ثم Cache كـ fallback */
  e.respondWith(
    fetch(request)
      .then(response => {
        /* تحديث الـ Cache بالنسخة الجديدة */
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || caches.match('./index.html')
        )
      )
  );
});
