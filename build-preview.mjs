import { cp, copyFile } from 'node:fs/promises';

const dist = new URL('./dist/', import.meta.url);
await cp(new URL('./public/', import.meta.url), dist, { recursive: true });
await cp(new URL('./web/panel/', import.meta.url), new URL('panel/', dist), { recursive:true });
for (const name of ['rail.mjs', 'live.mjs', 'abbey.mjs'])
  await copyFile(new URL(name, import.meta.url), new URL(name, dist));
const { buildPublicSite } = await import('./tools/release/public.mjs');
const { fileURLToPath } = await import('node:url');
buildPublicSite(fileURLToPath(new URL('./releases/', import.meta.url)), fileURLToPath(dist));
