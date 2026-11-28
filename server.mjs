import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { createLiveFeed } from './live.mjs';
import { serviceLookup } from './abbey.mjs';

const { values: options } = parseArgs({
  options: {
    port: { type: 'string', default: '8174' },
    record: { type: 'string' },
    replay: { type: 'string' },
  },
});
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Choose a port from 1 to 65535');
const root = new URL('./public/', import.meta.url);
const layout = JSON.parse(await readFile(new URL('data/corridor.json', root)));
let customReplay;
if (options.replay) {
  const lines = (await readFile(options.replay, 'utf8')).trim().split(/\r?\n/);
  const frames = lines.map((line) => JSON.parse(line));
  if (
    !frames.some((f) => f.full) ||
    !frames.every((f) => Number.isFinite(f.time) && (f.values || f.services || f.abbey))
  ) {
    throw Error('Expected a corridor recording beginning with a full snapshot');
  }
  customReplay = JSON.stringify({ source: 'Signal Maps public relay', frames });
}
const recording = options.record ? createWriteStream(options.record, { flags: 'wx' }) : null;
if (recording) await once(recording, 'open');
const feed = createLiveFeed(layout, {
  onFrame: recording ? (frame) => recording.write(JSON.stringify(frame) + '\n') : undefined,
});

const files = {
  ...Object.fromEntries(['settings.mjs','settings.css','appearance.mjs','downloads.mjs','gestures.mjs','horn.mjs','watch.mjs'].map(name =>
    ['/panel/'+name, ['../web/panel/'+name, name.endsWith('.css') ? 'text/css' : 'text/javascript']])),
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/hemel.mjs': ['hemel.mjs', 'text/javascript'],
  '/train-label.mjs': ['train-label.mjs', 'text/javascript'],
  '/station-codes.mjs': ['station-codes.mjs', 'text/javascript'],
  '/rail-monitor.mjs': ['rail-monitor.mjs','text/javascript'],
  '/rail-watch.mjs': ['rail-watch.mjs', 'text/javascript'],
  '/rail-spacing.mjs': ['rail-spacing.mjs', 'text/javascript'],
  '/rail-symbols.mjs': ['rail-symbols.mjs', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icons/rail-192.png': ['icons/rail-192.png', 'image/png'],
  '/icons/rail-512.png': ['icons/rail-512.png', 'image/png'],
  '/live.mjs': ['../live.mjs', 'text/javascript'],
  '/abbey.mjs': ['../abbey.mjs', 'text/javascript'],
  '/rail.mjs': ['../rail.mjs', 'text/javascript'],
  '/data/corridor.json': ['data/corridor.json', 'application/json'],
  '/data/watford-replay.json': ['data/watford-replay.json', 'application/json'],
  '/data/hemel-replay.json': ['data/hemel-replay.json', 'application/json'],
  '/data/replay.json': ['data/replay.json', 'application/json'],
  '/data/EASM-LICENSE.txt': ['data/EASM-LICENSE.txt', 'text/plain'],
};
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const schedule = /^\/api\/hemel-schedule\/([A-Z0-9]\d{5}\/\d{2}\/\d{2}\/\d{2})$/.exec(path);
  if (req.method !== 'GET' || (path !== '/api/live' && path !== '/api/abbey-lookup' && !schedule && !Object.hasOwn(files, path))) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (path === '/api/live') {
      feed.start();
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(feed.snapshot()));
    } else if (schedule) {
      const response = await fetch('https://openrail.railcam.uk/rail/livetrain/' + schedule[1], {
        signal: AbortSignal.timeout(8000),
      });
      res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(await response.text());
    } else if (path === '/api/abbey-lookup') {
      // Local equivalent of the fixed-destination Netlify rewrite.
      const url = new URL(serviceLookup);
      url.search = new URL(req.url, 'http://localhost').search;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await response.text();
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
    } else if (path === '/data/replay.json' && customReplay) {
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(customReplay);
    } else {
      const [name, mime] = files[path];
      const bytes = await readFile(new URL(name, root));
      const contentType = mime === 'image/png' ? mime : mime + '; charset=utf-8';
      res
        .writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })
        .end(bytes);
    }
  } catch {
    res.writeHead(503).end('File unavailable');
  }
});
server.on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log('Hemel Hempstead rail monitor at http://127.0.0.1:' + port);
  if (recording) feed.start();
});
function stop() {
  feed.stop();
  recording?.end();
  server.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
