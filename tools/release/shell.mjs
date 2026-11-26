import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from '../../packages/compiler/app.mjs';
const digest = (b) => createHash('sha256').update(b).digest('hex');
export function writeAppShell(dir, id, entry, signedEntry, publicKey) {
  const appDir = path.join(dir, 'apps', id),
    src = path.join(root, entry.adapter === 'hemel-corridor/1' ? 'public' : 'lakes/public');
  fs.mkdirSync(appDir, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === 'data' || name.startsWith('_')) continue;
    fs.cpSync(path.join(src, name), path.join(appDir, name), { recursive: true });
  }
  fs.cpSync(path.join(root, 'web/panel'), path.join(appDir, 'panel'), {recursive:true});
  const write = (file, data) => fs.writeFileSync(path.join(appDir, file), data);
  const read = (name) => fs.readFileSync(path.join(appDir, name), 'utf8');
  if (entry.adapter === 'hemel-corridor/1') {
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
  manifest.name = entry.name;
  manifest.short_name = entry.name;
  manifest.description = entry.description;
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
  write('release.json', signedEntry);
  // The offline manifest and worker entry point are generated from the asset hashes below.
  const files = fs
    .readdirSync(appDir, { recursive: true })
    .filter((n) => n !== 'offline.mjs' && n !== 'sw.js' && fs.statSync(path.join(appDir, n)).isFile())
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
      Object.entries({ id, revision, files, checksums, artifact: '/artifacts/' + entry.sha256 + '.tda' })
        .map(([k, v]) => k + '=' + JSON.stringify(v))
        .join(',') +
      ';\n',
  );
  write('sw.js', '// ' + revision + '\nimport "./worker.mjs";\n');
}
