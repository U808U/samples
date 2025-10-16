const CACHE_NAME = 'groovebox-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/src/audio.js',
  '/src/state.js',
  '/src/ui.js',
  '/manifest.json',
  'https://cdn.skypack.dev/zustand',
  'https://cdn.skypack.dev/zustand/middleware',
  'https://esm.sh/@twind/core@1',
  'https://esm.sh/@twind/preset-autoprefix@1',
  'https://esm.sh/@twind/preset-tailwind@1',
  'https://unpkg.com/htm/preact/standalone.module.js?module'
];

const sampleURLs = [
  'https://raw.githubusercontent.com/U808U/UoGB/master/kick.wav',
  'https://raw.githubusercontent.com/U808U/UoGB/master/snare.wav',
  'https://raw.githubusercontent.com/U808U/UoGB/master/openhat.wav',
  'https://raw.githubusercontent.com/U808U/UoGB/master/hihat.wav'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        const localCachePromise = cache.addAll(urlsToCache);
        
        const remoteCachePromises = sampleURLs.map(url => {
          return fetch(url, { mode: 'cors' })
            .then(response => {
              if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
              }
              return cache.put(url, response);
            })
            .catch(err => console.error(`Failed to cache ${url}:`, err));
        });

        return Promise.all([localCachePromise, ...remoteCachePromises]);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
