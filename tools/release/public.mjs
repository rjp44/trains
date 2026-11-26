// Only signed public release records and content-addressed images enter the Netlify build.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAppShell } from './shell.mjs';
import { versionName } from '../../packages/app-format/version.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const board = 'crowpanel-p4-v1.2-rev1';
function signed(bytes, key) {
  const env = JSON.parse(bytes),
    body = Buffer.from(env.payload, 'base64');
  if (!verify('sha256', body, key, Buffer.from(env.signature, 'base64')))
    throw Error('Invalid release signature');
  const doc = JSON.parse(body);
  if (doc.schema !== 2 || doc.board !== board || !doc.artifacts) throw Error('Wrong release target');
  return doc.artifacts;
}
function copy(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}
function readRelease(src, key) {
  const catalogue = fs.readFileSync(path.join(src, 'catalog.json'));
  const artifacts = signed(catalogue, key);
  for (const [id, e] of Object.entries(artifacts)) {
    if (
      !/^[a-z][a-z0-9-]{0,39}$/.test(id) ||
      !/^[0-9a-f]{64}$/.test(e.sha256) ||
      !Number.isSafeInteger(e.bytes) ||
      e.bytes < 1 ||
      !Number.isSafeInteger(e.version) ||
      e.version < 1
    )
      throw Error('Invalid release entry ' + id);
    if (id !== 'core' && (!e.name || !e.description || !e.adapter))
      throw Error('Missing directory metadata for ' + id);
  }
  return { catalogue, artifacts };
}
function entryName(id, e) {
  return e.sha256 + (id === 'core' ? '.bin' : '.tda');
}
function verifiedCopy(file, dest, hash, bytes) {
  const raw = fs.readFileSync(file);
  if (raw.length !== bytes || createHash('sha256').update(raw).digest('hex') !== hash)
    throw Error('Artifact checksum failed: ' + file);
  copy(file, dest);
}
function appRecord(src, id, entry, key) {
  const record = fs.readFileSync(path.join(src, 'apps', id, 'release.json'), 'utf8');
  const entries = signed(record, key);
  if (Object.keys(entries).length !== 1 || JSON.stringify(entries[id]) !== JSON.stringify(entry))
    throw Error('Mismatched app descriptor ' + id);
  return record;
}
export function exportRelease(local, publicKeyFile, dest) {
  const current = fs.realpathSync(path.join(local, 'current'));
  const key = createPublicKey(fs.readFileSync(publicKeyFile));
  const { catalogue, artifacts } = readRelease(current, key);
  if (fs.existsSync(path.join(dest, 'catalog.json'))) {
    const previous = readRelease(dest, key).artifacts;
    for (const [id, old] of Object.entries(previous)) {
      const next = artifacts[id];
      if (!next || next.version < old.version || (next.version === old.version && next.sha256 !== old.sha256))
        throw Error('Existing public release must be retained or advanced: ' + id);
    }
  }
  for (const [id, e] of Object.entries(artifacts)) {
    const name = entryName(id, e);
    verifiedCopy(path.join(local, 'artifacts', name), path.join(dest, 'artifacts', name), e.sha256, e.bytes);
    if (id !== 'core') {
      const file = path.join(dest, 'apps', id, 'release.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, appRecord(current, id, e, key));
    }
  }
  fs.writeFileSync(path.join(dest, 'signing.pem'), key.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(path.join(dest, 'catalog.json'), catalogue);
}
export function buildPublicSite(src, dest) {
  const key = createPublicKey(fs.readFileSync(path.join(src, 'signing.pem')));
  const { catalogue, artifacts } = readRelease(src, key);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'catalog.json'), catalogue);
  copy(path.join(repo, 'LICENSE'), path.join(dest, 'LICENSE.txt'));
  const applications = [];
  for (const [id, e] of Object.entries(artifacts)) {
    const name = entryName(id, e);
    verifiedCopy(path.join(src, 'artifacts', name), path.join(dest, 'artifacts', name), e.sha256, e.bytes);
    if (id === 'core') continue;
    applications.push({
      id,
      ...e,
      minCoreName: versionName(e.minCore),
      storageBytes: Math.ceil(e.bytes / 4096) * 4096,
      app: '/apps/' + id + '/',
      download: '/artifacts/' + name,
    });
    writeAppShell(
      dest,
      id,
      e,
      appRecord(src, id, e, key),
      key.export({ format: 'der', type: 'spki' }).toString('base64'),
    );
  }
  // Keep immutable URLs from earlier public releases usable by existing service workers.
  for (const name of fs.readdirSync(path.join(src, 'artifacts'))) {
    if (!/^[0-9a-f]{64}\.(tda|bin)$/.test(name)) throw Error('Unexpected public artifact ' + name);
    if (!fs.existsSync(path.join(dest, 'artifacts', name)))
      verifiedCopy(
        path.join(src, 'artifacts', name),
        path.join(dest, 'artifacts', name),
        name.slice(0, 64),
        fs.statSync(path.join(src, 'artifacts', name)).size,
      );
  }
  applications.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(
    path.join(dest, 'directory.json'),
    JSON.stringify({
      schema: 1,
      applications,
      firmware: artifacts.core
        ? { ...artifacts.core, download: '/artifacts/' + entryName('core', artifacts.core) }
        : null,
    }),
  );
  fs.cpSync(path.join(repo, 'web/directory'), path.join(dest, 'apps'), { recursive: true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [local, key, dest] = process.argv.slice(2);
  if (!dest) throw Error('Usage: public.mjs LOCAL_RELEASE SIGNING_PUBLIC_PEM PUBLIC_OUTPUT');
  exportRelease(local, key, dest);
}
