// TDP1 records are ordered, little endian and length-prefixed. The same schema
// validates author JSON and decodes the binary in the browser.
const u8 = 'u8',
  u16 = 'u16',
  u32 = 'u32',
  str = 'string';
const list = (row, max) => ({ row, max });
const sections = [
  ['manifest', { app: str, version: str, capability: str, credits: str }],
  [
    'scene',
    {
      station: { id: str, name: str, x: u16 },
      tracks: list({ id: str, name: str, direction: str, y: u16 }, 2),
      berths: list({ id: str, track: str, offsetX: 'i16', stage: str, context: str }, 32),
      card: { x: u16, y: u16, width: u16, height: u16 },
    },
  ],
  [
    'replay',
    {
      service: { id: str, head: str, route: str, booked: str },
      frames: list({ at: u32, berth: str, matched: u8, timing: str }, 128),
    },
  ],
];
export const maxBytes = 65536;
const header = 4 + 4 * 12;
const enc = new TextEncoder(),
  dec = new TextDecoder('ascii');
function check(ok, message) {
  if (!ok) throw Error(message);
}
function walk(type, value, io) {
  if (typeof type === 'string') return io(type, value);
  if (type.row) {
    if (value !== undefined) check(Array.isArray(value), 'Expected a table');
    const n = io('u8', value?.length);
    check(n >= 1 && n <= type.max, 'Invalid table length');
    return Array.from({ length: n }, (_, i) => walk(type.row, value?.[i], io));
  }
  if (value !== undefined)
    check(
      Object.keys(value).length === Object.keys(type).length &&
        Object.keys(type).every((k) => Object.hasOwn(value, k)),
      'Missing or unknown field',
    );
  return Object.fromEntries(Object.entries(type).map(([k, t]) => [k, walk(t, value?.[k], io)]));
}
function validate({ manifest, scene: { station, tracks, berths, card }, replay: { service, frames } }) {
  check(manifest.capability === 'station-pair-replay/1', 'Unsupported player capability');
  const id = (s) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s);
  check(
    id(manifest.app) &&
      id(manifest.version) &&
      id(station.id) &&
      id(service.id) &&
      /^[0-9][A-Z][0-9]{2}$/.test(service.head) &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(service.booked),
    'Invalid identity or booked call',
  );
  const unique = (rows) => new Set(rows.map((r) => r.id)).size === rows.length && rows.every((r) => id(r.id));
  check(tracks.length === 2 && unique(tracks) && unique(berths), 'Invalid track pair or duplicate ID');
  check(
    station.x >= 90 &&
      station.x <= 920 &&
      card.width >= 240 &&
      card.height >= 58 &&
      card.x + card.width <= 1024 &&
      card.y + card.height <= 600,
    'Layout outside viewport',
  );
  for (const t of tracks)
    check(
      ['down', 'up'].includes(t.direction) &&
        t.y >= 80 &&
        t.y <= 560 &&
        berths.filter((b) => b.track === t.id && b.stage === 'station').length === 1,
      'Invalid station track',
    );
  check(tracks[0].direction !== tracks[1].direction, 'Expected opposing tracks');
  for (const b of berths)
    check(
      tracks.some((t) => t.id === b.track) &&
        ['approach', 'station', 'exit'].includes(b.stage) &&
        (b.stage !== 'station' || b.offsetX === 0) &&
        station.x + b.offsetX >= 120 &&
        station.x + b.offsetX <= 990,
      'Invalid berth or position',
    );
  check(
    frames[0].at === 0 &&
      frames.every(
        (f, i) =>
          (!i || f.at > frames[i - 1].at) &&
          f.at <= 86400000 &&
          f.matched <= 1 &&
          (!f.berth || berths.some((b) => b.id === f.berth)),
      ),
    'Invalid replay clock or berth reference',
  );
}
function crc32(bytes) {
  let v = -1;
  for (const b of bytes) {
    v ^= b;
    for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
  }
  return ~v >>> 0;
}
export function encode(source, licence) {
  check(
    Object.keys(source).length === 3 && sections.every(([k]) => Object.hasOwn(source, k)),
    'Invalid sections',
  );
  const parts = sections.map(([k, type]) => {
    const bytes = [];
    walk(type, source[k], (t, v) => {
      if (t === str) {
        check(typeof v === 'string' && /^[ -~]{0,250}$/.test(v), 'Expected printable ASCII text (max 250)');
        bytes.push(v.length, ...enc.encode(v));
      } else {
        const size = { u8: 1, u16: 2, i16: 2, u32: 4 }[t];
        check(
          Number.isInteger(v) &&
            v >= (t === 'i16' ? -32768 : 0) &&
            v < (t === 'i16' ? 32768 : 2 ** (8 * size)),
          'Integer out of range',
        );
        for (let i = 0; i < size; i++) bytes.push((v >>> (8 * i)) & 255);
      }
      return v;
    });
    return Uint8Array.from(bytes);
  });
  validate(source);
  parts.push(licence);
  const size = header + parts.reduce((n, p) => n + p.length, 0);
  check(licence.length && size <= maxBytes, 'Invalid package size');
  const out = new Uint8Array(size),
    dv = new DataView(out.buffer);
  out.set(enc.encode('TDP1'));
  let pos = header;
  parts.forEach((p, i) => {
    [pos, p.length, crc32(p)].forEach((v, j) => dv.setUint32(4 + 12 * i + 4 * j, v, true));
    out.set(p, pos);
    pos += p.length;
  });
  return out;
}
export function decode(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(
    bytes.length >= header && bytes.length <= maxBytes && dec.decode(bytes.subarray(0, 4)) === 'TDP1',
    'Unsupported or truncated package',
  );
  let next = header;
  const pkg = {};
  for (let i = 0; i < 4; i++) {
    const field = (j) => dv.getUint32(4 + i * 12 + j * 4, true);
    const pos = field(0),
      n = field(1),
      end = pos + n;
    check(
      pos === next && n && end <= bytes.length && crc32(bytes.subarray(pos, end)) === field(2),
      'Invalid section directory or checksum',
    );
    next = end;
    if (i === 3) {
      pkg.licence = new TextDecoder().decode(bytes.subarray(pos, end));
      continue;
    }
    let p = pos;
    function read(t) {
      if (t === str) {
        const len = read(u8);
        check(len <= 250 && p + len <= end, 'Truncated text');
        const s = dec.decode(bytes.subarray(p, p + len));
        check(/^[ -~]*$/.test(s), 'Invalid text');
        p += len;
        return s;
      }
      const [method, width] = {
        u8: ['getUint8', 1],
        u16: ['getUint16', 2],
        i16: ['getInt16', 2],
        u32: ['getUint32', 4],
      }[t];
      check(p + width <= end, 'Truncated field');
      const v = dv[method](p, true);
      p += width;
      return v;
    }
    pkg[sections[i][0]] = walk(sections[i][1], undefined, read);
    check(p === end, 'Unexpected section data');
  }
  check(next === bytes.length, 'Trailing data');
  validate(pkg);
  return pkg;
}
