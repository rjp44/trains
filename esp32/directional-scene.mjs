// Positions are schematic. The links are reported SMART berth steps, including
// crossovers when both ends are visible in the same part of a station.
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
const directions = ['up', 'both', 'down'];
const levels = { up: [82, 132, 182, 232], both: [282, 332], down: [389, 439, 489, 539] };
function laneOrder([a], [b]) {
  const priority = (value) => ({ Fast: 0, Slow: 1, '': 4 })[value] ?? (value.startsWith('P') ? 2 : 3);
  return priority(a) - priority(b) || a.localeCompare(b, 'en', { numeric: true });
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
function bands(station) {
  const ranks = stepRanks(station);
  const groups = { up: new Map(), down: new Map(), both: new Map() };
  for (const b of station.berths) {
    const name = laneName(station, b),
      group = groups[b.direction];
    if (!group.has(name)) group.set(name, []);
    group.get(name).push(b);
  }
  const pages = {};
  for (const dir of directions) {
    const lanes = [...groups[dir]].sort(laneOrder);
    for (const [, berths] of lanes)
      berths.sort((a, b) => ranks.get(a.id).rank - ranks.get(b.id).rank || a.id.localeCompare(b.id));
    const capacity = levels[dir].length;
    const parts = [];
    for (let i = 0; i < lanes.length; i += capacity) {
      const batch = lanes.slice(i, i + capacity);
      const longest = Math.max(...batch.map(([, berths]) => berths.length));
      for (let j = 0; j < longest; j += 7)
        parts.push(batch.map(([name, berths]) => [name, berths.slice(j, j + 7)]));
    }
    pages[dir] = parts;
  }
  return { pages, ranks };
}
export function directionalScene(layout, markers, view) {
  const focus = layout.tracks.findIndex((t) => t.id === layout.focus);
  const stations = [layout.tracks, layout.tracks.slice(0, focus + 1), layout.tracks.slice(focus)][view];
  const ids = new Map(markers.map((b, i) => [b.id, i]));
  const Lines = [],
    Labels = [],
    Markers = [],
    Stations = [];
  const line = (x1, y1, x2, y2, ink, width = 1) => Lines.push([x1, y1, x2, y2, ink, width]);
  const label = (x, y, w, size, ink, title, preset = 0, bg = -1) =>
    Labels.push([x, y, w, size, ink, bg, title, preset]);
  let left = 0;
  for (const station of stations) {
    const { pages, ranks } = bands(station);
    const count = Math.max(...directions.map((d) => pages[d].length));
    Stations.push([station.id, station.name, left]);
    for (let page = 0; page < count; page++) {
      const positions = new Map(),
        tracks = [];
      const columns = new Map();
      let longest = 0;
      for (const dir of directions) {
        const rows = pages[dir][page] || [];
        const widths = new Map();
        const lanes = rows.map(([, berths]) => {
          const counts = new Map();
          return berths.map((b) => {
            const rank = ranks.get(b.id).rank,
              n = counts.get(rank) || 0;
            counts.set(rank, n + 1);
            widths.set(rank, Math.max(widths.get(rank) || 0, n + 1));
            return [b, rank, n];
          });
        });
        const offsets = new Map();
        let column = 0;
        for (const rank of [...widths.keys()].sort((a, b) => a - b)) {
          offsets.set(rank, column);
          column += widths.get(rank);
        }
        longest = Math.max(longest, column);
        for (const lane of lanes) for (const [b, rank, n] of lane) columns.set(b.id, offsets.get(rank) + n);
      }
      const width = Math.max(292, 128 + longest * 78),
        right = left + width;
      const heading = station.name;
      line(left + 1, 8, left + 1, 565, 8);
      label(left + width / 2, 23, width - 24, 16, 1, heading, layout.tracks.indexOf(station) < focus ? 1 : 2);
      if (count > 1) label(left + width / 2, 43, 160, 12, 2, page + 1 + ' / ' + count);
      for (const dir of directions) {
        (pages[dir][page] || []).forEach(([name, berths], row) => {
          if (!berths.length) return;
          const y = levels[dir][row];
          const title = dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : 'Up / Down';
          const arrow = dir === 'up' ? '>' : dir === 'down' ? '<' : '<>';
          tracks.push({ y, dir, title: [title, name, arrow].filter(Boolean).join(' ') });
          for (const b of berths) {
            const x = left + 128 + columns.get(b.id) * 78;
            positions.set(b.id, { x, y });
            Markers.push([ids.get(b.id), x, y, y - 14, b.bit ? 5 : 0]);
            label(x, y + 17, 78, 12, 2, b.id + (b.platform ? ' P' + b.platform : ''));
            line(x, y - 4, x, y + 4, 4, 2);
          }
        });
      }
      // Thin guides identify the lane; heavier links show actual adjacent steps.
      for (const { y, dir, title } of tracks) {
        const start = left + 92,
          end = right - 8;
        line(start, y, end, y, 8);
        label(left + 47, y, 89, 14, 1, title);
        for (const [a, dx] of dir === 'up'
          ? [[end, 1]]
          : dir === 'down'
            ? [[start, -1]]
            : [
                [start, -1],
                [end, 1],
              ]) {
          line(a - dx * 5, y - 3, a, y, 3, 2);
          line(a - dx * 5, y + 3, a, y, 3, 2);
        }
      }
      for (const [from, to] of station.steps) {
        const a = positions.get(from),
          b = positions.get(to);
        if (!a || !b) continue;
        // Parallel vertical stems cannot describe the physical crossover geometry.
        // Only depict a connection with horizontal space for both end berths.
        if (a.x === b.x) continue;
        line(a.x, a.y, b.x, b.y, a.y === b.y ? 3 : 8, a.y === b.y ? 3 : 1);
      }
      left = right;
    }
  }
  return {
    Lines,
    Labels,
    Markers: Markers.sort((a, b) => a[2] - b[2] || a[1] - b[1]),
    Width: Math.max(1024, left),
    Stations,
    Space: [[0, 0, 0, 0], [0, 0, 0, 0], 58, 20],
  };
}
