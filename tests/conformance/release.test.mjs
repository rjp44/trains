import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { archive } from '../../packages/compiler/app.mjs';
import { directory, openArchive } from '../../packages/app-format/archive.mjs';

function app(id, version, note = 'fixture') {
  const adapter = id === 'hemel' ? 'hemel-corridor/1' : 'lakes-map/1';
  return archive(
    new Map([
      [
        'manifest.json',
        Buffer.from(JSON.stringify({ id, name: id, description: 'Test recording', version, adapter })),
      ],
      ['data/replay.json', Buffer.from(JSON.stringify({ note, frames: Array(80).fill([1, 2, 3]) }))],
    ]),
  );
}
test('TDA2 rejects truncated, overlapping, damaged and oversized sections', async () => {
  const good = app('hemel', 1),
    entries = directory(good),
    row = entries.get('data/replay.json');
  assert.equal((await (await openArchive(good)).json('data/replay.json')).frames.length, 80);
  assert.throws(() => directory(good.subarray(0, -1)));
  for (const [position, value] of [
    [8 + 48, 0],
    [8 + 56, 0xffffffff],
    [8 + 60, 7],
  ]) {
    const bad = Buffer.from(good);
    bad.writeUInt32LE(value, position);
    assert.throws(() => directory(bad));
  }
  const bad = Buffer.from(good);
  bad[row.offset] ^= 0xff;
  await assert.rejects((await openArchive(bad)).read('data/replay.json'), /Damaged/);
  const inflated = Buffer.from(good);
  inflated.writeUInt32LE(8, 8 + 96 + 56);
  await assert.rejects((await openArchive(inflated)).read('data/replay.json'), /Oversize/);
});
test('a release preserves the other app, rejects a mismatched image and verifies with the browser key', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'transport-release-test-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  writeFileSync(join(d, 'signing.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(d, 'ca.pem'), 'test CA');
  const out = join(d, 'release'),
    h = join(d, 'h.tda'),
    l = join(d, 'l.tda'),
    core = join(d, 'wrong.bin');
  writeFileSync(h, app('hemel', 1));
  writeFileSync(l, app('lakes', 1));
  const publish = (...extra) =>
    spawnSync(process.execPath, ['tools/release/publish.mjs', d, out, h, l, ...extra], { encoding: 'utf8' });
  assert.equal(publish().status, 0);
  const current = join(out, 'current'),
    read = (file) => readFileSync(join(current, file), 'utf8');
  const first = readlinkSync(current),
    lake = read('apps/lakes/sw.js');
  const envelope = JSON.parse(read('catalog.json'));
  assert.ok(
    verify(
      'sha256',
      Buffer.from(envelope.payload, 'base64'),
      publicKey,
      Buffer.from(envelope.signature, 'base64'),
    ),
  );
  const browser = await import(pathToFileURL(join(current, 'apps/hemel/verify.mjs')));
  const entry = await browser.descriptor(envelope, 'hemel');
  assert.equal((await browser.verifyApp(readFileSync(h), entry, 'hemel')).manifest.version, 1);
  await assert.rejects(browser.verifyApp(readFileSync(l), entry, 'hemel'));
  await assert.rejects(
    browser.descriptor({ ...envelope, payload: Buffer.from('{}').toString('base64') }, 'hemel'),
  );
  writeFileSync(core, Buffer.alloc(200));
  assert.notEqual(publish(core, '2').status, 0);
  writeFileSync(h, app('hemel', 1, 'different bytes'));
  assert.notEqual(publish().status, 0);
  assert.equal(readlinkSync(current), first);
  writeFileSync(h, app('hemel', 2));
  assert.equal(publish().status, 0);
  assert.equal(read('apps/lakes/sw.js'), lake);
  assert.notEqual(readlinkSync(current), first);
  writeFileSync(h, app('hemel', 1));
  assert.notEqual(publish().status, 0);
});

test('publishing a third app retains existing packages and public exports contain only release data', async (t) => {
  const { exportRelease, buildPublicSite } = await import('../../tools/release/public.mjs');
  const d = mkdtempSync(join(tmpdir(), 'transport-directory-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  writeFileSync(join(d, 'signing.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(d, 'signing.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(d, 'ca.pem'), 'private rollout CA');
  const out = join(d, 'local'),
    root = join(d, 'release'),
    dest = join(d, 'site');
  function publish(ids) {
    const files = ids.map((id) => {
      let f = join(d, id + '.tda');
      writeFileSync(f, app(id, 1));
      return f;
    });
    const p = spawnSync(process.execPath, ['tools/release/publish.mjs', d, out, ...files], {
      encoding: 'utf8',
    });
    assert.equal(p.status, 0, p.stderr);
  }
  publish(['hemel', 'lakes']);
  publish(['lakes-winter']);
  exportRelease(out, join(d, 'signing.pem'), root);
  buildPublicSite(root, dest);
  const data = JSON.parse(readFileSync(join(dest, 'directory.json')));
  assert.deepEqual(
    data.applications.map((e) => e.id),
    ['hemel', 'lakes', 'lakes-winter'],
  );
  for (const a of data.applications) {
    assert.equal(a.description, 'Test recording');
    assert.equal(a.storageBytes, 4096);
    assert.equal(JSON.parse(readFileSync(join(dest, a.app, 'manifest.webmanifest'))).scope, a.app);
  }
  assert.throws(() => readFileSync(join(dest, 'signing.key')));
  assert.throws(() => readFileSync(join(dest, 'local-ca.pem')));
  const record = data.applications[2];
  writeFileSync(join(root, record.download), 'corrupt');
  assert.throws(() => buildPublicSite(root, dest), /checksum/);
});
