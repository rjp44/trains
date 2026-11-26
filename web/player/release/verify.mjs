import { hex, openArchive } from './archive.mjs';
import { publicKey } from './trust.mjs';
const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// Web Crypto uses two fixed-width P-256 integers. The catalogue uses ASN.1 DER.
function signature(bytes) {
  if (bytes[0] !== 48 || bytes[1] !== bytes.length - 2) throw Error('Invalid signature');
  let p = 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 2; i++) {
    if (bytes[p++] !== 2) throw Error('Invalid signature integer');
    const n = bytes[p++];
    if (!n || n > 33 || p + n > bytes.length) throw Error('Invalid signature length');
    const integer = bytes.subarray(p, p + n);
    p += n;
    if ((n === 33 && integer[0] !== 0) || integer[0] & 128) throw Error('Invalid signature value');
    const value = integer.subarray(Math.max(0, n - 32));
    out.set(value, i * 32 + 32 - value.length);
  }
  if (p !== bytes.length) throw Error('Invalid signature tail');
  return out;
}
export async function descriptor(envelope, id) {
  const key = await crypto.subtle.importKey(
    'spki',
    decode(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const data = decode(envelope.payload);
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature(decode(envelope.signature)),
      data,
    ))
  )
    throw Error('Release signature verification failed');
  const catalog = JSON.parse(new TextDecoder().decode(data)),
    entry = catalog.artifacts?.[id];
  if (
    catalog.schema !== 2 ||
    !entry ||
    !Number.isSafeInteger(entry.minCore) ||
    entry.minCore < 1 ||
    !/^[0-9a-f]{64}$/.test(entry.sha256) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 1 ||
    entry.bytes > 0x270000
  )
    throw Error('Incompatible app release');
  return entry;
}
export async function verifyApp(bytes, entry, id) {
  if (
    bytes.length !== entry.bytes ||
    hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) !== entry.sha256
  )
    throw Error('Incomplete or damaged app download');
  const app = await openArchive(bytes);
  if (
    app.manifest.id !== id ||
    app.manifest.version !== entry.version ||
    app.manifest.adapter !== { hemel: 'hemel-corridor/1', lakes: 'lakes-map/1' }[id]
  )
    throw Error('Incompatible app package');
  return app;
}
