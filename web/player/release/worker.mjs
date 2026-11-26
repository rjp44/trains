import { descriptor, verifyApp } from './verify.mjs';
import { hex } from './archive.mjs';
import { id, revision, files, checksums, artifact } from './offline.mjs';
const prefix = 'transport-' + id + '-',
  key = prefix + revision;
const base = new URL('./', self.location);
const local = (path) => new URL(path, base).href;
const assets = new Set([...files.map(local), local(artifact)]);
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(key);
      try {
        await cache.addAll([...assets].map((url) => new Request(url, { cache: 'reload' })));
        for (const file of files) {
          const response = await cache.match(local(file));
          const hash = hex(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())),
          );
          if (hash !== checksums[file]) throw Error('Shell changed while updating ' + file);
        }
        const entry = await descriptor(await (await cache.match(local('release.json'))).json(), id);
        await verifyApp(new Uint8Array(await (await cache.match(local(artifact))).arrayBuffer()), entry, id);
      } catch (error) {
        await caches.delete(key);
        throw error;
      }
    })(),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const old of await caches.keys())
        if (old.startsWith(prefix) && key !== old) await caches.delete(old);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== base.origin) return;
  const target = req.mode === 'navigate' && url.pathname === base.pathname ? local('index.html') : req.url;
  if (assets.has(target))
    event.respondWith(caches.open(key).then(async (c) => (await c.match(target)) || fetch(req)));
});
