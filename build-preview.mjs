import { cp, copyFile, readFile, writeFile } from 'node:fs/promises';

const dist = new URL('./dist/', import.meta.url);
await cp(new URL('./public/', import.meta.url), dist, { recursive: true });
for (const name of ['rail.mjs', 'live.mjs', 'abbey.mjs'])
  await copyFile(new URL(name, import.meta.url), new URL(name, dist));
const index = new URL('index.html', dist);
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace('<html ', '<html class="diagram-only" '));
