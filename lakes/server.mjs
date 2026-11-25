import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createVehicleFeed } from './feeds.mjs';
import { offlineWorker } from './pwa-worker.mjs';

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
const snapshot = createVehicleFeed(readBusArchive);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript',
};
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/sw.js') {
      res
        .writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' })
        .end(await offlineWorker());
      return;
    }
    if (path === '/api/vehicles') {
      const data = await snapshot();
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(data));
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
