import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { compile } from '../../packages/compiler/build.mjs';

const source = process.argv[2],
  port = Number(process.env.PORT || 8187);
const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/replay.mjs', ['replay.mjs', 'text/javascript']],
  ['/format.mjs', ['../../packages/app-format/format.mjs', 'text/javascript']],
]);
createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/hemel.tdp') {
      const bytes = compile(source);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(bytes);
    } else if (routes.has(path)) {
      const [file, type] = routes.get(path);
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
    } else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(422, { 'Content-Type': 'text/plain' }).end(e.message);
  }
}).listen(port, '127.0.0.1', () =>
  console.log('Transport Display preview at http://127.0.0.1:' + port + '/'),
);
