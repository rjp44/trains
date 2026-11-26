import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
const [privateDir, release, port = '8443'] = process.argv.slice(2);
if (!privateDir || !release) throw Error('Usage: serve.mjs PRIVATE RELEASE [PORT]');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pem': 'application/x-pem-file',
};
https
  .createServer(
    {
      key: fs.readFileSync(path.join(privateDir, 'server.key')),
      cert: fs.readFileSync(path.join(privateDir, 'server.pem')),
      minVersion: 'TLSv1.2',
    },
    async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405).end();
          return;
        }
        const url = new URL(req.url, 'https://localhost'),
          p = url.pathname;
        let upstream;
        if (p === '/api/vehicles') upstream = 'https://lakes-transit.netlify.app/api/vehicles';
        if (p === '/api/abbey-lookup') upstream = 'https://api.railinfo.uk/services/lookup' + url.search;
        if (/^\/api\/hemel-schedule\/[a-zA-Z0-9]+\/\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(p))
          upstream = 'https://openrail.railcam.uk/rail/livetrain/' + p.split('/').slice(3).join('/');
        if (upstream) {
          const r = await fetch(upstream, { redirect: 'error', signal: AbortSignal.timeout(15000) });
          res.writeHead(r.status, {
            'content-type': r.headers.get('content-type') || 'application/json',
            'cache-control': 'no-store',
          });
          if (req.method === 'HEAD') res.end();
          else
            Readable.fromWeb(r.body)
              .on('error', () => res.destroy())
              .pipe(res);
          return;
        }
        if (!/^\/[A-Za-z0-9/._-]*$/.test(p) || p.split('/').some((x) => x.startsWith('.'))) {
          res.writeHead(404).end();
          return;
        }
        const artifact = /^\/artifacts\/[0-9a-f]{64}\.(tda|bin)$/.test(p);
        const file = path.join(release, artifact ? '' : 'current', p.endsWith('/') ? p + 'index.html' : p);
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) throw Error('not found');
        res.writeHead(200, {
          'content-length': stat.size,
          'content-type': types[path.extname(file)] || 'application/octet-stream',
          'cache-control': artifact ? 'public,max-age=31536000,immutable' : 'no-cache',
        });
        if (req.method === 'HEAD') res.end();
        else
          fs.createReadStream(file)
            .on('error', () => res.destroy())
            .pipe(res);
      } catch (e) {
        if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 502);
        res.end();
      }
    },
  )
  .listen(Number(port), '0.0.0.0', () => console.log('Local HTTPS release server on port ' + port));
