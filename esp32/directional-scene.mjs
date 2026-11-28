import { trainWidth, trainHeight, signalRadius } from '../public/rail-symbols.mjs';
import { stationApproaches, approachRoadName, mainY as ordinates } from './station-approaches.mjs';
import { platformScene } from './station-roads.mjs';

// Network Rail running lines determine the schematic. SMART locates reports on it.
const fastSlowLocations = new Set(
  'PRST LEYLAND BMFRLNJ GOLBRNJ WINWCKJ WRGTNBQ ACBG HARTFD WNSFD CREWECY CREWE MADELEY NTNB STAFFRD'.split(
    ' ',
  ),
);
export function laneName(station, berth) {
  const codes = berth.lines ?? [];
  if (codes.length === 1 && fastSlowLocations.has(station.id)) {
    if (codes[0] === 'F') return 'Fast';
    if (codes[0] === 'S') return 'Slow';
  }
  if (berth.platform) return 'P' + berth.platform;
  return codes.length ? 'Line ' + codes.join('/') : '';
}
// Order each one-direction berth along the recorded steps. Down moves progress
// to the left. Never manufacture a connection across an unmapped gap.
function stepRanks(station) {
  const nodes = new Map(station.berths.map((b) => [b.id, { b, rank: 0, incoming: 0, after: new Set() }]));
  for (const [from, to, dir] of station.steps) {
    const first = nodes.get(dir === 'up' ? from : to),
      last = nodes.get(dir === 'up' ? to : from);
    if (!first || !last || first.b.direction !== dir || last.b.direction !== dir || first.after.has(last))
      continue;
    first.after.add(last);
    last.incoming++;
  }
  const queue = [...nodes.values()].filter((n) => !n.incoming);
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (const after of n.after) {
      after.rank = Math.max(after.rank, n.rank + 1);
      if (!--after.incoming) queue.push(after);
    }
  }
  return nodes;
}
// Single platforms along these open-line sections have one through road in
// each direction. Junctions and terminal throats need explicit evidence.
const plainStops = new Set(
  'HARTFD PNKRDG FRASL COSELEY TIPTON DUDLPT SNDWDUD GALTILL SMTHKRS ADERLYP LEAHALL MRSTNGR'.split(' '),
);
const platformRoads = {
  LEYLAND: ['DS', 'US', 'DF', 'UF'],
  EUXT: ['US', 'DS'],
  ACBG: ['US', 'UF', 'DF'],
  WNSFD: ['UF', 'DF'],
  WRGTNBQ: ['US', 'UF', 'DF', 'DS'],
  STECHFD: ['DF', 'UF'],
};
// Junction exit berths identified by the named road of the SMART step.
// Several approach berths may reach the same exit. Place the exit only.
const junctionExits = {
  BMFRLNJ: { WA0122: 'UF', WA0123: 'US' },
  GOLBRNJ: { WA0144: 'DF', WA0146: 'UF', WA0147: 'UF', WA0151: 'UF' },
  WINWCKJ: { WA0163: 'UF', WA0153: 'DF' },
  ACGJN: { WA0231: 'DF' },
  WEAVERJ: { WD0162: 'UF', WD0168: 'UF', WD0160: 'UF', WD0169: 'DF' },
  ACBG: { WD0150: 'UF', WD0252: 'US', WD0165: 'DF' },
  WNSFD: { WD0096: 'UF', WD0149: 'DF' },
  CREWECY: { CE0144: 'UF', CE0146: 'US' },
  BSBYJN: { WO4309: 'DF' },
  STECHFD: { PJ4120: 'UF', PJ4127: 'DF' },
};
const linearApproaches = new Set(['LEYLAND', 'EUXT', 'MADELEY']);
const approachWidth = 366;
const directionCode = { up: 'U', down: 'D' };
const slot = 68;
function roadAssignments(station) {
  const result = new Map();
  for (const berth of station.berths) {
    const dir = directionCode[berth.direction];
    if (!dir) continue;
    const platform = platformRoads[station.id]?.[Number(berth.platform) - 1];
    let road;
    if (platform?.startsWith(dir)) road = platform;
    else if (laneName(station, berth) === 'Fast') road = dir + 'F';
    else if (laneName(station, berth) === 'Slow') road = dir + 'S';
    else if (
      plainStops.has(station.id) &&
      (!berth.lines || berth.platform || berth.lines.every((l) => ['1', '2'].includes(l)))
    )
      road = dir + 'F';
    road = junctionExits[station.id]?.[berth.id] ?? road;
    if (road) result.set(berth.id, road);
  }
  // On a straight, single-path approach, the last berth in a reported step
  // often has an empty line field. Carry its identified road to that end only
  // when all its neighbours have the same known road and travel direction.
  if (linearApproaches.has(station.id)) {
    for (const b of station.berths) {
      if (result.has(b.id) || b.lines?.length || b.direction === 'both') continue;
      const adjacent = station.steps
        .filter(([a, z, d]) => d === b.direction && (a === b.id || z === b.id))
        .map(([a, z]) => result.get(a === b.id ? z : a));
      if (adjacent.length && adjacent[0] && adjacent.every((road) => road === adjacent[0]))
        result.set(b.id, adjacent[0]);
    }
  }
  return result;
}
// Only berths with an identified track appear on the schematic. All raw
// descriptions remain available through the station register.
function stationGeometry(station, activeRoads) {
  const roads = roadAssignments(station),
    ranks = stepRanks(station);
  const lanes = new Map();
  for (const b of station.berths) {
    const road = roads.get(b.id);
    if (!activeRoads.has(road)) continue;
    if (!lanes.has(road)) lanes.set(road, []);
    lanes.get(road).push(b);
  }
  const points = [];
  let leftSlots = 0,
    rightSlots = 0;
  for (const [road, list] of lanes) {
    list.sort((a, b) => ranks.get(a.id).rank - ranks.get(b.id).rank || a.id.localeCompare(b.id));
    const stops = list.map((b, i) => (b.platform ? i : -1)).filter((i) => i >= 0);
    const centre = stops.length === 1 ? stops[0] : Math.floor((list.length - 1) / 2);
    leftSlots = Math.max(leftSlots, centre);
    rightSlots = Math.max(rightSlots, list.length - centre - 1);
    list.forEach((berth, i) => points.push({ berth, dx: (i - centre) * slot, y: ordinates[road] }));
  }
  const width = Math.max(260, (leftSlots + rightSlots) * slot + 158);
  const centre = Math.round((width + (leftSlots - rightSlots) * slot) / 2);
  const platforms = [...new Set(points.filter((p) => p.berth.platform).map((p) => p.y))];
  return { station, width, centre, points, platforms };
}
export function directionalScene(layout, markers, view) {
  const ids = new Map(markers.map((b, i) => [b.id, i]));
  const stopIndex = new Map(layout.tracks.map((s, i) => [s.id, i]));
  // First resolve the route in station order. The two section views are crops
  // of this same railway, including a slow line which began outside the crop.
  function anchor(key) {
    if (key === 'start') return { i: 0, position: 'start', order: -1 };
    if (key === 'end') return { i: layout.tracks.length - 1, position: 'end', order: layout.tracks.length };
    const [id, position] = key.split(':'),
      i = stopIndex.get(id);
    if (i === undefined || !['entry', 'centre', 'exit'].includes(position))
      throw Error('Unknown road anchor ' + key);
    return { i, position, order: i + { entry: -0.4, centre: 0, exit: 0.4 }[position] };
  }
  const scale = 1024 / 840; // Same panel and diagram viewport as Hemel.
  const sections = layout.slowSections.map((s) => ({ ...s, a: anchor(s.from), z: anchor(s.to) }));
  let total = 0;
  const stations = layout.tracks.map((s, i) => {
    const roads = new Set(['DF', 'UF']);
    for (const section of sections)
      if (i >= section.a.order && i <= section.z.order)
        for (const dir of section.directions) roads.add(directionCode[dir] + 'S');
    const zones = stationApproaches(s.id);
    const core = { ...s, berths: s.berths.filter((b) => !approachRoadName(s.id, b.id)) };
    const plan = platformScene(core) || stationGeometry(core, roads);
    plan.station = s;
    plan.zones = zones;
    plan.coreStart = zones.before ? approachWidth : 0;
    plan.coreEnd = plan.coreStart + plan.width;
    plan.centre += plan.coreStart;
    plan.width = plan.coreEnd + (zones.after ? approachWidth : 0);
    plan.approach = [...roads].map((r) => ordinates[r]);
    plan.left = total;
    total += plan.width + 112;
    return plan;
  });
  total -= 112;
  function world({ i, position }) {
    if (position === 'start') return 0;
    if (position === 'end') return total;
    const p = stations[i];
    return p.left + { entry: -56, centre: p.centre, exit: p.width + 56 }[position];
  }
  const focus = stopIndex.get(layout.focus);
  const visible = [stations, stations.slice(0, focus + 1), stations.slice(focus)][view];
  const left = visible[0].left,
    last = visible.at(-1),
    right = last.left + last.width,
    Width = right - left;
  const Lines = [],
    Labels = [],
    Legend = [],
    Markers = [],
    Stations = [];
  // Clip the world before writing native int16 coordinates. Endpoints on
  // either side of a station remain exactly coincident in every named view.
  function line(x1, y1, x2, y2, ink, weight = 2) {
    if (x1 > x2) return line(x2, y2, x1, y1, ink, weight);
    if (x2 < left || x1 > right) return;
    const slope = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);
    const a = Math.max(left, x1),
      z = Math.min(right, x2);
    Lines.push([
      a - left,
      Math.round(y1 + (a - x1) * slope),
      z - left,
      Math.round(y2 - (x2 - z) * slope),
      ink,
      weight,
    ]);
  }
  function label(x, y, width, size, ink, title, preset = 0, bg = -1) {
    if (x >= left && x <= right) Labels.push([x - left, y, width, size, ink, bg, title, preset]);
  }
  // Station stripes sit behind the uninterrupted rails, as in the Hemel panel.
  for (const p of visible) {
    const x = p.left + p.centre,
      emphasis = p.station.id === layout.focus;
    line(x, 110, x, p.rows ? p.rows.at(-1).y + 18 : 342, emphasis ? 9 : 8, emphasis ? 38 : 24);
    Stations.push([p.station.id, p.station.name, p.left - left]);
    label(
      x,
      p.rows ? 65 : 88,
      Math.max(130, Math.min(256, p.station.name.length * 9 + 20)),
      16,
      1,
      p.station.name,
      stopIndex.get(p.station.id) < focus ? 1 : 2,
      emphasis ? 9 : 0,
    );
  }
  // Across a large station the actual platform and passing roads replace
  // the approach tracks. A shaded throat groups connections whose individual
  // pointwork is outside the scale of this panel.
  const throats = visible.filter((p) => p.rows).map((p) => [p.left + p.coreStart + 46, p.left + p.coreEnd - 46]);
  function outsideStations(a, z, emit) {
    for (const [start, end] of throats) {
      if (start >= z) break;
      if (end <= a) continue;
      if (start > a) emit(a, start);
      a = Math.max(a, end);
    }
    if (a < z) emit(a, z);
  }
  function runningRail(from, y, to) {
    outsideStations(from, to, (a, z) => line(a, y, z, y, 3, 3));
  }
  for (const y of [ordinates.DF, ordinates.UF]) runningRail(0, y, total);
  // Legend intervals share the exact endpoints of the visible parallel rails.
  const slowRuns = { up: [], down: [] };
  for (const section of sections) {
    const start = world(section.a),
      end = world(section.z);
    const enter = section.from === 'start' ? 0 : 42,
      leave = section.to === 'end' ? 0 : 42;
    for (const dir of section.directions) {
      const code = directionCode[dir],
        y = ordinates[code + 'S'],
        main = ordinates[code + 'F'];
      if (enter) line(start - enter, main, start + enter, y, 3, 3);
      runningRail(start + enter, y, end - leave);
      const from = Math.max(start + enter, left) - left;
      const to = Math.min(end - leave, right) - left;
      if (from < to) slowRuns[dir].push([from, to]);
      // At Stafford the selected route turns onto the Wolverhampton line.
      // A short outward stub marks the WCML continuation at the route boundary.
      if (leave)
        line(end - leave, y, end + leave, section.diverges ? y + (dir === 'down' ? -18 : 18) : main, 3, 3);
    }
    if (section.entry) label(start, 42, 190, 12, 2, section.entry);
    if (section.exit) label(end, 42, 190, 12, 2, section.exit);
  }
  for (const [dir, runs] of Object.entries(slowRuns)) {
    const code = directionCode[dir],
      main = ordinates[code + 'F'],
      slow = ordinates[code + 'S'];
    const name = (road) => (dir === 'down' ? '< Down ' + road : 'Up ' + road + ' >');
    let previous = 0;
    for (const [from, to] of runs.sort((a, b) => a[0] - b[0])) {
      if (previous < from) Legend.push([previous, from, main, name('main')]);
      Legend.push([from, to, main, name('fast')], [from, to, slow, name('slow')]);
      previous = to;
    }
    if (previous < Width) Legend.push([previous, Width, main, name('main')]);
  }
  const roadNames = Legend.splice(0);
  for (const [from, to, y, name] of roadNames) {
    outsideStations(left + from, left + to, (a, z) => Legend.push([a - left, z - left, y, name]));
  }
  for (const p of visible) {
    if (p.rows) {
      const entry = p.left + p.coreStart + 46, exit = p.left + p.coreEnd - 46;
      const upper = Math.min(...p.approach), lower = Math.max(...p.approach);
      for (const x of [entry, exit]) {
        line(x, upper - 9, x, lower + 9, 8, 15);
      }
      function throatPositions(end) {
        const through = p.rows.filter((row) => row[end]);
        return new Map(through.map((row, i) => [
          row, Math.round(upper + (lower - upper) * i / Math.max(1, through.length - 1)),
        ]));
      }
      const north = throatPositions('north'), south = throatPositions('south');
      for (const row of p.rows) {
        const rowX = p.points.filter((m) => m.y === row.y).map((m) => p.left + p.centre + m.dx);
        const a = row.north ? entry + 86 : Math.min(p.left + p.centre, ...rowX) - 40;
        const z = row.south ? exit - 86 : Math.max(p.left + p.centre, ...rowX) + 40;
        // Each fan ends at a shared throat. The platform connections are
        // schematic and do not attribute a particular crossover to a berth.
        if (row.north) line(entry, north.get(row), a, row.y, 3, 3);
        if (row.south) line(z, row.y, exit, south.get(row), 3, 3);
        line(a, row.y, z, row.y, 3, 3);
        const name = row.siding ? 'Siding ' + row.key.slice(1)
          : row.key === 'DF' ? '< Down fast' : row.key === 'UF' ? 'Up fast >' : 'P' + row.key;
        Legend.push([a - left, z - left, row.y, name]);
        // Stubs end at a buffer stop. Through roads meet both station throats.
        if (row.siding) {
          const [west, east] = row.siding.map((key) => p.rows.find((r) => r.key === key).y);
          line(a - 30, west, a, row.y, 3, 3);
          line(z, row.y, z + 30, east, 3, 3);
          // The third siding also connects to platform 10.
          if (row.key === 'S3') line(z - 42, row.y, z - 12, p.rows.find((r) => r.key === '10').y, 3, 3);
        } else {
          if (!row.north) line(a, row.y - 5, a, row.y + 5, 4, 3);
          if (!row.south) line(z, row.y - 5, z, row.y + 5, 4, 3);
        }
        if (/^\d/.test(row.key)) {
          const middle = rowX.length ? (Math.min(...rowX) + Math.max(...rowX)) / 2 : p.left + p.centre;
          line(Math.max(a+6,middle-55),row.y+10,Math.min(z-6,middle+55),row.y+10,4,4);
          if (row.north) label(a + 18, row.y - 12, 36, 11, 4, name);
          else label(a - 24, row.y, 36, 11, 4, name);
        }
      }
    }
    for (const [side, zone] of Object.entries(p.zones)) {
      const before = side === 'before';
      const start = before ? p.left : p.left + p.coreEnd;
      const near = before ? start + approachWidth + 46 : start - 46;
      const far = before ? start + 12 : start + approachWidth - 12;
      const sign = before ? -1 : 1;
      const byId = new Map(p.station.berths.map((b) => [b.id, b]));
      function place(addresses, y, railStart, railEnd) {
        addresses.forEach((id, index) => {
          const berth = byId.get(id);
          if (!berth) return; // An adjoining reporting location can own the same approach.
          const x = Math.round(railStart + (railEnd - railStart) * (index + 1) / (addresses.length + 1));
          p.points.push({ berth, dx: x - p.left - p.centre, y });
        });
      }
      label(start + approachWidth / 2, 94, 274, 14, 1, zone.name);
      for (const [road, addresses] of Object.entries(zone.main ?? {}))
        place(addresses, ordinates[road], start + 45, start + approachWidth - 45);
      (zone.branches ?? []).forEach(([name, addresses, end], i, branches) => {
        const y = 368 + i * 37;
        const turn = near + sign * 110;
        const a = Math.min(turn, far), z = Math.max(turn, far);
        // Join the shared station throat, without specifying an unverified crossover.
        const port = Math.max(...p.approach) - 8 * (branches.length - 1 - i);
        line(near, port, turn, y, 3, 3);
        line(a, y, z, y, 3, 3);
        Legend.push([a - left, z - left, y, name]);
        if (end === 'buffer') line(far, y - 5, far, y + 5, 4, 3);
        label(far - sign * 78, y + 12, 146, 11, 2, name);
        place(addresses, y, a, z);
      });
    }
    for (const y of p.platforms ?? []) {
      const x = p.left + p.centre;
      line(x - 26, y + 10, x + 26, y + 10, 4, 4);
    }
    for (const { berth: b, dx, y } of p.points) {
      const x = p.left + p.centre + dx;
      Markers.push([ids.get(b.id), x - left, y, y - Math.round(17 * scale), b.bit ? Math.round(signalRadius(false) * scale) : 0]);
    }
  }
  return {
    Lines,
    Labels,
    Legend,
    LegendWidth: 90,
    Markers: Markers.sort((a, b) => a[2] - b[2] || a[1] - b[1]),
    Width,
    Stations,
    Space: [[0, 0, 0, 0], [0, 0, 0, 0], Math.round(trainWidth * scale), Math.round(trainHeight * scale)],
  };
}
