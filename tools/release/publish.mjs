import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, sign } from 'node:crypto';
import { writeAppShell } from './shell.mjs';
import { directory, openArchive } from '../../packages/app-format/archive.mjs';
const [privateDir, output, ...args] = process.argv.slice(2);
if (!privateDir || !output || !args.length)
  throw Error('Usage: publish.mjs PRIVATE OUTPUT APP.tda ... [CORE.bin VERSION]');
const coreIndex = args.findIndex((f) => f.endsWith('.bin'));
if (coreIndex >= 0 && (coreIndex !== args.length - 2 || !/^[1-9]\d*$/.test(args.at(-1))))
  throw Error('Expected CORE.bin VERSION after app packages');
const ver = coreIndex < 0 ? null : args.at(-1);
const files = coreIndex < 0 ? args : args.slice(0, -1);
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
for (const file of files) {
  const firmware = file.endsWith('.bin');
  const b = fs.readFileSync(file);
  const app = firmware ? null : await openArchive(b);
  const id = firmware ? 'core' : app.manifest.id;
  if (!firmware && (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || id === 'core'))
    throw Error('Invalid application ID');
  if (Object.hasOwn(entries, id)) throw Error('Duplicate release entry ' + id);
  const sha256 = digest(b),
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
    const m = app.manifest;
    version = m.version;
    minCore = m.minCore ?? 1;
    if (
      m.id !== id ||
      !['hemel-corridor/1', 'lakes-map/1'].includes(m.adapter) ||
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
  if (app) {
    const { name, description, adapter } = app.manifest;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      Buffer.byteLength(name) > 96 ||
      typeof description !== 'string' ||
      !description.trim() ||
      Buffer.byteLength(description) > 512
    )
      throw Error('Missing or oversized app name or description: ' + id);
    Object.assign(entries[id], { name, description, adapter });
  }
  const dest = path.join(artifactDir, sha256 + ext);
  if (!fs.existsSync(dest)) {
    const tmp = dest + '.' + process.pid;
    fs.writeFileSync(tmp, b);
    fs.renameSync(tmp, dest);
  }
  if (id === 'core') continue;
  const oldApp = path.join(current, 'apps', id, 'release.json');
  const unchanged = JSON.stringify(oldEntries[id]) === JSON.stringify(entries[id]) && fs.existsSync(oldApp);
  writeAppShell(
    dir,
    id,
    entries[id],
    unchanged ? fs.readFileSync(oldApp, 'utf8') : signCatalog({ [id]: entries[id] }),
    publicKey,
  );
}
// Publishing a subset updates only those entries. Previously published apps stay discoverable.
for (const [id, entry] of Object.entries(oldEntries)) {
  if (Object.hasOwn(entries, id)) continue;
  if (id !== 'core') {
    if (!entry.name || !entry.description || !entry.adapter)
      throw Error('Resupply legacy package ' + id + ' to add directory metadata');
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw Error('Invalid prior app ID');
    const record = fs.readFileSync(path.join(current, 'apps', id, 'release.json'), 'utf8');
    writeAppShell(dir, id, entry, record, publicKey);
  }
  entries[id] = entry;
}

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
