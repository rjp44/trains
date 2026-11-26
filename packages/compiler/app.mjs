import fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { directory, magic, entrySize, maxDecoded } from '../app-format/archive.mjs';
import { versionCode } from '../app-format/version.mjs';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const sha = (b) => createHash('sha256').update(b).digest();
export function archive(parts) {
  const head = Buffer.alloc(8 + entrySize * parts.size);
  head.write(magic);
  head.writeUInt32LE(parts.size, 4);
  const chunks = [head];
  let off = head.length,
    i = 0;
  for (const [key, input] of parts) {
    if (key.length >= 48 || !input.length || input.length > maxDecoded) throw Error('Invalid section ' + key);
    const packed = deflateSync(input, { level: 6 }),
      compress = packed.length + 32 < input.length && !key.endsWith('.tiles');
    const data = compress ? packed : input,
      p = 8 + entrySize * i++;
    head.write(key, p);
    [off, data.length, input.length, Number(compress)].forEach((n, j) =>
      head.writeUInt32LE(n, p + 48 + j * 4),
    );
    sha(data).copy(head, p + 64);
    chunks.push(data);
    off += data.length;
  }
  const bytes = Buffer.concat(chunks);
  directory(bytes);
  return bytes;
}
export function buildApp(id) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || id === 'core') throw Error('Unknown transport app');
  const manifest = JSON.parse(fs.readFileSync(join(root, 'apps', id, 'app.json')));
  if (
    manifest.id !== id ||
    !['hemel-corridor/1', 'lakes-map/1'].includes(manifest.adapter)
  )
    throw Error('Invalid app definition');
  manifest.versionName = manifest.version;
  manifest.version = versionCode(manifest.versionName);
  const parts = new Map([['manifest.json', Buffer.from(JSON.stringify(manifest))]]);
  const inputs = join(root, manifest.adapter === 'hemel-corridor/1' ? 'public/data' : 'lakes/public/data');
  for (const name of manifest.data) {
    if (!/^[a-zA-Z0-9-]+\.(json|txt|webp)$/.test(name)) throw Error('Invalid data asset');
    parts.set('data/' + name.toLowerCase(), fs.readFileSync(join(inputs, name)));
  }
  parts.set('license.txt', fs.readFileSync(join(root, 'LICENSE')));
  parts.set('credits.md', fs.readFileSync(join(root, 'apps', id, 'credits.md')));
  const temp = fs.mkdtempSync(join(tmpdir(), 'transport-tables-')),
    table = join(temp, 'tables.json');
  try {
    if (manifest.adapter === 'hemel-corridor/1')
      execFileSync(process.execPath, ['esp32/pack.mjs', '1024', '600', table, '--tables'], { cwd: root });
    else {
      execFileSync(process.execPath, ['lakes/esp32/pack.mjs', table], { cwd: root });
      execFileSync(process.env.ART_PYTHON || 'python3', ['lakes/esp32/pack-art.py', '--output-dir', temp], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      const tiles = join(temp, 'terrain.tiles');
      execFileSync('python3', ['lakes/esp32/terrain-tiles.py', '--assets', temp, '--output', tiles], { cwd: root });
      parts.set('native/atlas.bin', fs.readFileSync(join(temp, 'atlas.bin')));
      parts.set('native/terrain.tiles', fs.readFileSync(tiles));
    }
    parts.set('native/tables.json', fs.readFileSync(table));
    return archive(parts);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [id, out] = process.argv.slice(2);
  if (!out) throw Error('Usage: node packages/compiler/app.mjs hemel|lakes OUTPUT.tda');
  fs.mkdirSync(dirname(out), { recursive: true });
  fs.writeFileSync(out, buildApp(id));
}
