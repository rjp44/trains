// Rebuild the two station schematics from Network Rail SMART movement triggers.
// Supply a directory of cached VailData location responses to rebuild offline.
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/', import.meta.url));
const routes = {
  'crewe-birmingham': {
    name: 'Crewe to Birmingham International',
    sections: ['Crewe to Wolverhampton', 'Wolverhampton to International'],
    focus: 'WVRMPTN',
    places:
      'CREWE MADELEY NTNB STAFFRD PNKRDG FRASL BSBYJN WVRMPTN COSELEY TIPTON DUDLPT SNDWDUD GALTILL SMTHKRS BHAMNWS ADERLYP STECHFD LEAHALL MRSTNGR BHAMINT',
  },
  'preston-crewe': {
    name: 'Preston to Crewe',
    sections: ['Preston to Warrington', 'Warrington to Crewe'],
    focus: 'WRGTNBQ',
    places:
      'PRST LEYLAND EUXT WIGANNW BMFRLNJ GOLBRNJ WINWCKJ WRGTNBQ ACGJN WEAVERJ ACBG HARTFD WNSFD CREWECY CREWE',
  },
};
const names = {
  EUXT: 'Euxton Balshaw Lane',
  GALTILL: 'Smethwick Galton Bridge',
  WRGTNBQ: 'Warrington Bank Quay',
};
for (const [id, route] of Object.entries(routes)) {
  const tracks = [],
    owners = new Map(),
    evidence = new Map();
  for (const code of route.places.split(' ')) {
    const source = process.argv[2]
      ? JSON.parse(await fs.readFile(join(process.argv[2], code + '.json')))
      : await fetch('https://vaildata.uk/api/bplan/loc/' + code).then((r) => {
          if (!r.ok) throw Error(code + ' ' + r.status);
          return r.json();
        });
    const track = { id: code, name: names[code] || source.location_name, berths: [], steps: [] };
    tracks.push(track);
    // An arrival steps into the station berth. A departure steps out of it.
    // Other end-points still locate a train on the approach. Prefer the station
    // end when neighbouring reporting points refer to the same physical berth.
    for (const s of source.smart) {
      if (s.STEPTYPE !== 'B' || !/^[ABCD]$/.test(s.EVENT) || !/^[A-Z0-9]{2}$/.test(s.TD)) continue;
      // SMART A/B are Up arrival/departure, C/D are Down arrival/departure.
      const direction = 'AB'.includes(s.EVENT) ? 'up' : 'down';
      const arrival = 'AC'.includes(s.EVENT);
      const from = s.TD + s.FROMBERTH,
        to = s.TD + s.TOBERTH;
      if ([from, to].every((key) => /^[A-Z0-9]{6}$/.test(key)) && from !== to) {
        if (!track.steps.some((step) => step[0] === from && step[1] === to && step[2] === direction))
          track.steps.push([from, to, direction]);
      }
      for (const [key, primary, line] of [
        [from, !arrival, s.FROMLINE],
        [to, arrival, s.TOLINE],
      ]) {
        if (!/^[A-Z0-9]{6}$/.test(key)) continue;
        if (!evidence.has(key)) evidence.set(key, new Set());
        evidence.get(key).add(direction);
        const rank = primary ? 2 : 1;
        let owner = owners.get(key);
        if (!owner || (owner.track !== track && rank > owner.rank)) {
          owner = { track, rank, platforms: new Set(), lines: new Set() };
          owners.set(key, owner);
        }
        if (owner.track !== track) continue;
        owner.rank = Math.max(rank, owner.rank);
        if (primary && s.PLATFORM.trim()) owner.platforms.add(s.PLATFORM.trim());
        if (line.trim()) owner.lines.add(line.trim());
      }
    }
  }
  const signals = new Map();
  if (id === 'crewe-birmingham') {
    const diagram = process.argv[2]
      ? JSON.parse(await fs.readFile(join(process.argv[2], 'newstreet.json')))
      : await fetch(
          'https://raw.githubusercontent.com/Shwam3/EASMData/76ad5669ce8e351716a1b5b79e8c12fad60dd89b/data/newstreet.json',
        ).then((r) => r.json());
    for (const b of diagram.berths) {
      if (b.i.length !== 1 || !/^[A-Z]{2}\d{4}$/.test(b.i[0])) continue;
      const key = b.i[0],
        number = Number(key.slice(2));
      const exact = diagram.signals.filter(
        (s) =>
          ['LEFT', 'RIGHT'].includes(s.t) &&
          !s.iBa &&
          /^[A-Z0-9]{2}[A-F0-9]{2}:[1-8]$/.test(s.i) &&
          s.i.startsWith(key.slice(0, 2)) &&
          Number(/^[A-Z]+(\d+)$/.exec(s.d)?.[1]) === number &&
          Math.abs(s.x - b.x) < 95 &&
          Math.abs(s.y - b.y) <= 20,
      );
      if (exact.length === 1) signals.set(key, { signal: exact[0].d, bit: exact[0].i });
    }
  }
  for (const [key, { track, platforms, lines }] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    const directions = evidence.get(key);
    const berth = {
      id: key,
      direction: directions.size === 2 ? 'both' : [...directions][0],
      ...signals.get(key),
    };
    if (lines.size) berth.lines = [...lines].sort();
    if (platforms.size === 1) berth.platform = [...platforms][0];
    track.berths.push(berth);
  }
  if (tracks.some((t) => !t.berths.length))
    throw Error('No mapped berths at ' + tracks.find((t) => !t.berths.length).name);
  const layout = {
    profile: 'regional',
    diagram: 'directional',
    name: route.name,
    views: [route.name, ...route.sections],
    focus: route.focus,
    areas: [...new Set([...owners.keys()].map((id) => id.slice(0, 2)))].sort(),
    tracks,
    branches: [],
  };
  const dir = join(root, id, 'data');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'corridor.json'), JSON.stringify(layout) + '\n');
  console.log(id, tracks.length, 'locations,', owners.size, 'berths,', layout.areas.join(' '));
}
