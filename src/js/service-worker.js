const CACHE_NAME = 'servercult-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/config.js',
  '/js/main.js',
  '/js/service-worker.js',
  '/js/pages/menu.js',
  '/js/pages/landing.js',
  '/js/pages/terminal.js',
  '/js/pages/prompt.js',
  '/js/scripts/authenticate.js',
  '/js/menus/dashboard.js',
  '/js/menus/deploy.js',
  '/js/menus/account.js',
  '/js/menus/resources.js',
  '/js/menus/domain.js',
  '/js/menus/site.js',
  '/js/menus/backup.js',
  '/js/menus/subscription.js',
  '/js/menus/machine.js',
  '/js/menus/usage.js',
  '/build/sdk.bundle.js',
  '/build/sdk.bundle.css',
  '/templates/menu.html',
  '/templates/about.html',
  '/templates/privacy.html',
  '/templates/tos.html',
  '/images/icon-grey.png',
  '/images/icon-white.png',
  '/images/instagram.svg',
  '/images/play.gif',
  '/images/pause.gif',
  '/images/spikeball.gif',
  '/images/happy-cat.gif',
  '/images/cat-illustration.gif',
  '/images/briefcase.gif'
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