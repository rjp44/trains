import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { busFixes, railFixes } from './public/model.mjs';

const port = Number(process.env.PORT || 8186);
const root = fileURLToPath(new URL('./public/', import.meta.url));
function readBusArchive(bytes) {
  const script = fileURLToPath(new URL('./tools/read-buses.py', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [script], { stdio: ['pipe', 'pipe', 'ignore'], timeout: 15_000 });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(Error('Unable to read BODS archive'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(Buffer.from(bytes));
  });
}
const sources = {
  bus: {
    url: 'https://data.bus-data.dft.gov.uk/avl/download/bulk_archive',
    interval: 60_000,
    async decode(res) {
      const data = await readBusArchive(await res.arrayBuffer());
      return { generated: Date.parse(data.updated), vehicles: busFixes(data.rows) };
    },
  },
  rail: {
    url: 'https://api.railinfo.uk/map/trains',
    interval: 30_000,
    async decode(res) {
      const data = await res.json();
      return { generated: Date.parse(data.generated_at), vehicles: railFixes(data) };
    },
  },
};
const cache = new Map();
async function live(type) {
  const old = cache.get(type);
  if (old?.pending) return old.pending;
  if (old && Date.now() - old.value.checked < sources[type].interval) return old.value;
  const entry = { value: old?.value };
  const { url, decode } = sources[type];
  entry.pending = (async () => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LakesTransitMap/0.1 (rjp44/trains)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw Error('HTTP ' + res.status);
      entry.value = { ...(await decode(res)), ok: true, checked: Date.now() };
    } catch (error) {
      entry.value = {
        ...entry.value,
        ok: false,
        checked: Date.now(),
        vehicles: entry.value?.vehicles || [],
      };
      console.warn(type + ' feed unavailable', error.message);
    } finally {
      entry.pending = null;
    }
    return entry.value;
  })();
  cache.set(type, entry);
  return entry.pending;
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webp': 'image/webp',
};
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/vehicles') {
      const [bus, rail] = await Promise.all([live('bus'), live('rail')]);
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ time: Date.now(), bus, rail }));
      return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!file.startsWith(resolve(root) + sep) || !mime[extname(file)]) {
      res.writeHead(404).end();
      return;
    }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log('Lake District map at http://127.0.0.1:' + port + '/'));
