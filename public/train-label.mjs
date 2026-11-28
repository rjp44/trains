import { stations } from './station-codes.mjs';

// Keep the reference as one string in the embedded JavaScript VM. Only destinations
// actually observed on this route need an allocated lookup entry.
const recent = new Map();
const aliases = {
  'WATFORD JUNCTION DC': 'WATFORD JUNCTION',
  'LICHFIELD TRENT VALLEY HL': 'LICHFIELD TRENT VALLEY',
  'LICHFIELD TRENT VALLEY LL': 'LICHFIELD TRENT VALLEY',
  'EDINBURGH WAVERLEY': 'EDINBURGH',
};
function stationCode(destination) {
  const name = destination.trim().toUpperCase();
  if (recent.has(name)) return recent.get(name);
  const key = '\n' + (aliases[name] || name) + '|';
  const at = /[\n\r|]/.test(name) ? -1 : stations.indexOf(key);
  const code = at < 0 ? '' : stations.slice(at + key.length, at + key.length + 3);
  if (recent.size >= 128) recent.clear();
  recent.set(name, code);
  return code;
}

// Packed as CRS followed by the optional two-letter operator code in replay and live packets.
export function trainLabel(service) {
  if (!service?.id || service.ambiguous || typeof service.destination !== 'string') return '';
  const crs = stationCode(service.destination);
  if (!crs) return '';
  const op = service.operator;
  return crs + (op !== 'ZZ' && /^[A-Z]{2}$/.test(op) ? op : '');
}

// Branded short name, tag background and foreground in both map themes.
export const operatorTags = {
  VT: ['AV', 0x183e42, 0xa6ded1],
  NT: ['NT', 0x29395a, 0xd1defd],
  TP: ['TPE', 0x382c5c, 0xe2d5ff],
  LF: ['LU', 0x173d60, 0xc0e6ff],
  LD: ['LU', 0x173d60, 0xc0e6ff],
  LM: ['WM', 0x512e24, 0xffd6be],
  AW: ['TfW', 0x5c2837, 0xffd7df],
  XC: ['XC', 0x512a43, 0xffd8e9],
  EM: ['EMR', 0x48315f, 0xefddff],
  LO: ['LO', 0x482e0e, 0xffdda7],
  SN: ['SN', 0x15483d, 0xb7f1d3],
};
