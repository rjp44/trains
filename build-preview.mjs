import { cp, copyFile, readFile, writeFile } from 'node:fs/promises';

const dist = new URL('./dist/', import.meta.url);
await cp(new URL('./public/', import.meta.url), dist, { recursive: true });
await copyFile(new URL('./rail.mjs', import.meta.url), new URL('rail.mjs', dist));
const index = new URL('index.html', dist);
const html = await readFile(index, 'utf8');
await writeFile(index, html.replace('<html ', '<html data-recorded-preview '));
