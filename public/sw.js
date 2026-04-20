// JeetoPlay Service Worker — Cache-First for instant reopens
const CACHE_NAME = 'jeetoplay-v7';
const PRECACHE_URLS = [
    '/app.html',
    '/css/app.css?v=3',
    '/js/firebase-init.js?v=3',
    '/js/utils.js?v=5',
    '/js/auth.js?v=5',
    '/js/home.js?v=5'
];

// Install: Precache critical assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// Activate: Clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: Stale-While-Revalidate for app files, Cache-First for static assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests and Firebase/external API calls
    if (event.request.method !== 'GET') return;
    if (url.hostname.includes('firebaseio.com')) return;
    if (url.hostname.includes('googleapis.com') && url.pathname.includes('/v1')) return;
    if (url.hostname.includes('cloudfunctions.net')) return;
    if (url.hostname.includes('msg91.com')) return;
    if (url.hostname.includes('phone91.com')) return;
    if (url.hostname.includes('googletagmanager.com')) return;
    // Skip Firebase Storage — game icons, slider banners, user uploads must always load fresh
    if (url.hostname.includes('firebasestorage.googleapis.com')) return;
    if (url.hostname.includes('firebasestorage.app')) return;

    // Cache-First for static assets (JS, CSS, fonts, icons, images)
    if (url.pathname.match(/\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|svg|webp|ico|gif)(\?.*)?$/)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) {
                    // Return cache immediately, update in background
                    fetch(event.request).then(response => {
                        if (response.ok) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                        }
                    }).catch(() => {});
                    return cached;
                }
                // Not cached — fetch and cache
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Network-First for HTML pages (always get latest)
    if (event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request) || caches.match('/app.html'))
        );
        return;
    }

    // Cache-First for external CDN resources (fonts, icons)
    if (url.hostname.includes('gstatic.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('cdnjs.cloudflare.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }
});
