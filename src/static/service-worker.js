const CACHE_NAME = 'my-pwa-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/templates/landing.html',
  '/templates/menu.html',
  '/templates/about.html',
  '/templates/terminal.html',
  '/static/style.css',
  '/static/main.js',
  '/static/pages/menu.js',
  '/static/pages/landing.js',
  '/static/pages/terminal.js',
  '/static/scripts/authenticate.js',
  '/static/menus/dashboard.js',
  '/static/menus/deploy.js',
  '/static/menus/account.js',
  '/static/menus/resources.js',
  '/static/menus/domain.js',
  '/static/menus/billing.js',
  '/static/menus/firewall.js',
  '/static/menus/site.js',
  '/static/menus/backup.js',
  '/static/menus/subscription.js',
  '/static/menus/machine.js',
  '/static/icon.png',
  '/static/manifest.json',
  '/static/service-worker.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Only handle requests for same-origin resources.
  // This prevents the service worker from interfering with API calls to other domains.
  if (new URL(event.request.url).origin !== self.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
}); 