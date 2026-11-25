import { cp, writeFile } from 'node:fs/promises';
import { offlineWorker, publicDir } from './pwa-worker.mjs';

const dist = new URL('./dist/', import.meta.url);
await cp(publicDir, dist, { recursive: true });
await writeFile(new URL('sw.js', dist), await offlineWorker());
