import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, sign } from 'node:crypto';
import { root } from '../../packages/compiler/app.mjs';
import { directory, openArchive } from '../../packages/app-format/archive.mjs';
const [privateDir, output, hemel, lakes, core, ver] = process.argv.slice(2);
if (!privateDir || !output || !hemel || !lakes || (core && !/^[1-9]\d*$/.test(ver)))
  throw Error('Usage: publish.mjs PRIVATE OUTPUT HEMEL.tda LAKES.tda [CORE.bin VERSION]');
const out = path.resolve(output);
fs.mkdirSync(path.join(out, 'editions'), { recursive: true });
const lock = path.join(out, '.publishing');
fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
process.on('exit', () => fs.rmSync(lock, { force: true }));
const dir = fs.mkdtempSync(path.join(out, 'editions', 'edition-'));
const artifactDir = path.join(out, 'artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
const privateKey = fs.readFileSync(path.join(privateDir, 'signing.key')),
  publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
const digest = (b) => createHash('sha256').update(b).digest('hex');
const entries = {};
const signCatalog = (artifacts) => {
  const body = Buffer.from(JSON.stringify({ schema: 2, board: 'crowpanel-p4-v1.2-rev1', artifacts }));
  return JSON.stringify({
    payload: body.toString('base64'),
    signature: sign('sha256', body, privateKey).toString('base64'),
  });
};
const current = path.join(out, 'current');
const oldEntries = fs.existsSync(current)
  ? JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(path.join(current, 'catalog.json'))).payload, 'base64'))
      .artifacts
  : {};
for (const [id, file] of Object.entries({ hemel, lakes, ...(core ? { core } : {}) })) {
  const b = fs.readFileSync(file),
    sha256 = digest(b),
    ext = id === 'core' ? '.bin' : '.tda';
  let version = Number(ver),
    minCore = 1;
  if (id === 'core') {
    if (
      b.length < 112 ||
      b.length > 0x300000 ||
      b[0] !== 0xe9 ||
      b.readUInt16LE(12) !== 18 ||
      b.readUInt32LE(32) !== 0xabcd5432 ||
      b.subarray(48, 80).toString().split('\0')[0] !== ver ||
      b.subarray(80, 112).toString().split('\0')[0] !== 'transport_display'
    )
      throw Error('Incompatible board image, project or core version');
  } else {
    const app = await openArchive(b);
    const m = app.manifest;
    version = m.version;
    minCore = m.minCore ?? 1;
    if (
      m.id !== id ||
      m.adapter !== { hemel: 'hemel-corridor/1', lakes: 'lakes-map/1' }[id] ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > 0x7ffffffe ||
      !Number.isSafeInteger(minCore) ||
      minCore < 1 ||
      minCore > 0x7ffffffe
    )
      throw Error('Wrong app or incompatible release metadata');
    for (const section of directory(b).keys()) await app.read(section);
  }
  if (
    oldEntries[id] &&
    (version < oldEntries[id].version ||
      (version === oldEntries[id].version && sha256 !== oldEntries[id].sha256))
  )
    throw Error('Version already assigned: ' + id);
  entries[id] = { version, minCore, bytes: b.length, sha256 };
  const dest = path.join(artifactDir, sha256 + ext);
  if (!fs.existsSync(dest)) {
    const tmp = dest + '.' + process.pid;
    fs.writeFileSync(tmp, b);
    fs.renameSync(tmp, dest);
  }
  if (id === 'core') continue;
  const appDir = path.join(dir, 'apps', id),
    src = path.join(root, id === 'hemel' ? 'public' : 'lakes/public');
  fs.mkdirSync(appDir, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === 'data' || name.startsWith('_')) continue;
    fs.cpSync(path.join(src, name), path.join(appDir, name), { recursive: true });
  }
  const write = (file, data) => fs.writeFileSync(path.join(appDir, file), data);
  const read = (name) => fs.readFileSync(path.join(appDir, name), 'utf8');
  if (id === 'hemel') {
    for (const n of ['rail.mjs', 'live.mjs', 'abbey.mjs'])
      fs.copyFileSync(path.join(root, n), path.join(appDir, n));
    write('app.js', read('app.js').replaceAll("from '/", "from './"));
  } else
    write(
      'install.mjs',
      read('install.mjs').replace(
        "if ('serviceWorker' in navigator)",
        "if (!globalThis.transportApp && 'serviceWorker' in navigator)",
      ),
    );
  const manifest = JSON.parse(read('manifest.webmanifest'));
  manifest.id = manifest.scope = manifest.start_url = '/apps/' + id + '/';
  for (const icon of manifest.icons) icon.src = '.' + icon.src;
  write('manifest.webmanifest', JSON.stringify(manifest));
  const html = read('index.html')
    .replaceAll('href="/icons/', 'href="./icons/')
    .replace('href="/style.css"', 'href="./style.css"')
    .replace('href="/manifest.webmanifest"', 'href="./manifest.webmanifest"')
    .replace(/<script type="module" src="\/(?:app\.js|app\.mjs|install\.mjs)"><\/script>/g, '')
    .replace('</body>', '<script type="module" src="./boot.mjs"></script></body>');
  write('index.html', html);
  for (const name of ['boot.mjs', 'verify.mjs', 'worker.mjs'])
    fs.copyFileSync(path.join(root, 'web/player/release', name), path.join(appDir, name));
  fs.copyFileSync(path.join(root, 'packages/app-format/archive.mjs'), path.join(appDir, 'archive.mjs'));
  write('trust.mjs', 'export const publicKey=' + JSON.stringify(publicKey) + ';\n');
  // Reuse the previous signature for an unchanged app so updating its neighbour does not replace its worker.
  const oldApp = path.join(current, 'apps', id, 'release.json');
  write(
    'release.json',
    oldEntries[id]?.sha256 === sha256 && fs.existsSync(oldApp)
      ? fs.readFileSync(oldApp)
      : signCatalog({ [id]: entries[id] }),
  );
  const files = fs
    .readdirSync(appDir, { recursive: true })
    .filter((n) => fs.statSync(path.join(appDir, n)).isFile())
    .sort();
  const revision = digest(
    Buffer.concat(
      files.map((n) => Buffer.concat([Buffer.from(n + '\0'), fs.readFileSync(path.join(appDir, n))])),
    ),
  );
  const checksums = Object.fromEntries(
    files.map((name) => [name, digest(fs.readFileSync(path.join(appDir, name)))]),
  );
  write(
    'offline.mjs',
    'export const ' +
      Object.entries({ id, revision, files, checksums, artifact: '/artifacts/' + sha256 + ext })
        .map(([k, v]) => k + '=' + JSON.stringify(v))
        .join(',') +
      ';\n',
  );
  write('sw.js', '// ' + revision + '\nimport "./worker.mjs";\n');
}
if (!entries.core && oldEntries.core) entries.core = oldEntries.core;
fs.copyFileSync(path.join(privateDir, 'ca.pem'), path.join(dir, 'local-ca.pem'));
fs.writeFileSync(path.join(dir, 'catalog.json'), signCatalog(entries));
fs.writeFileSync(
  path.join(dir, 'index.html'),
  '<!doctype html><meta name="viewport" content="width=device-width"><title>Transport Display</title><h1>Transport Display</h1><p><a href="/apps/hemel/">Hemel rail monitor</a></p><p><a href="/apps/lakes/">Lakes Transit</a></p>',
);
const link = path.join(out, '.current-' + process.pid);
fs.symlinkSync(path.relative(out, dir), link);
fs.renameSync(link, current);
console.log(JSON.stringify(entries, null, 2));
