// The catalogue signs the complete TDA2 archive. Section hashes cover stored bytes.
export const magic = 'TDA2',
  entrySize = 96,
  maxArchive = 0x270000,
  maxDecoded = 5 * 1024 * 1024;
export const text = new TextDecoder('utf-8', { fatal: true });
export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export function directory(bytes) {
  if (bytes.length < 8 || bytes.length > maxArchive || text.decode(bytes.subarray(0, 4)) !== magic)
    throw Error('Invalid application package');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    n = v.getUint32(4, true);
  let end = 8 + n * entrySize;
  if (!n || n > 32 || end > bytes.length) throw Error('Invalid package directory');
  const entries = new Map();
  for (let i = 0; i < n; i++) {
    const p = 8 + i * entrySize,
      key = bytes.subarray(p, p + 48),
      at = key.indexOf(0);
    if (at < 1 || key.subarray(at).some((b) => b)) throw Error('Invalid section name');
    const name = text.decode(key.subarray(0, at)),
      offset = v.getUint32(p + 48, true),
      size = v.getUint32(p + 52, true),
      raw = v.getUint32(p + 56, true),
      codec = v.getUint32(p + 60, true);
    if (
      !/^[a-z0-9][a-z0-9./-]*$/.test(name) ||
      name.includes('..') ||
      entries.has(name) ||
      offset !== end ||
      !size ||
      !raw ||
      raw > maxDecoded ||
      offset + size > bytes.length ||
      codec > 1 ||
      (!codec && raw !== size)
    )
      throw Error('Invalid section ' + name);
    entries.set(name, { offset, size, raw, codec, hash: hex(bytes.subarray(p + 64, p + 96)) });
    end += size;
  }
  if (end !== bytes.length) throw Error('Trailing package data');
  return entries;
}
export async function openArchive(bytes) {
  const entries = directory(bytes);
  async function read(name) {
    const e = entries.get(name);
    if (!e) throw Error('Missing section ' + name);
    const data = bytes.subarray(e.offset, e.offset + e.size);
    if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))) !== e.hash)
      throw Error('Damaged ' + name);
    if (!e.codec) return data;
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const out = new Uint8Array(e.raw);
    let used = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > out.length - used) {
        await reader.cancel();
        throw Error('Oversize ' + name);
      }
      out.set(value, used);
      used += value.length;
    }
    if (used !== out.length) throw Error('Truncated ' + name);
    return out;
  }
  const json = async (name) => JSON.parse(text.decode(await read(name)));
  return { read, json, manifest: await json('manifest.json') };
}
