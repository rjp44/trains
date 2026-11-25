export const routes = {
  505: { icon: 'single', name: 'Coniston', via: 'Kendal · Windermere · Hawkshead', colour: '#ad4936' },
  555: {
    icon: 'closed-decker',
    name: 'Keswick – Lancaster',
    via: 'Grasmere · Windermere · Kendal',
    colour: '#82538d',
  },
  599: {
    icon: 'open-decker',
    name: 'Grasmere – Bowness',
    via: 'Ambleside · Windermere',
    colour: '#357044',
  },
  516: {
    icon: 'single',
    name: 'Great Langdale',
    via: 'Kendal · Ambleside · Dungeon Ghyll',
    colour: '#a6640f',
  },
  508: {
    icon: 'single',
    name: 'Penrith – Patterdale',
    via: 'Pooley Bridge · Glenridding',
    colour: '#20689b',
  },
  rail: { name: 'Lakes Line', via: 'Oxenholme – Windermere', colour: '#273e53' },
};
export const order = ['505', '555', '599', '516', '508', 'rail'];
export const branch = ['WDM', 'SVL', 'BUD', 'KEN', 'OXN'];
export const freshMs = 120_000;
export const expireMs = 600_000;
export const londonTime = (t) =>
  new Date(t).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export const project = ([lon, lat], frame) => [
  (lon - frame.west) * frame.units * frame.aspect,
  (frame.north - lat) * frame.units,
];
export function ageLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ago';
}

function localPoint(point) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every(Number.isFinite) &&
    point[0] >= -3.34 &&
    point[0] <= -2.54 &&
    point[1] >= 53.98 &&
    point[1] <= 54.71
  );
}
export function busFixes(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid BODS response');
  const fixes = new Map();
  for (const row of rows) {
    const route = row.route,
      time = Date.parse(row.time),
      point = [Number(row.lon), Number(row.lat)];
    if (
      !order.includes(route) ||
      route === 'rail' ||
      !localPoint(point) ||
      !Number.isFinite(time) ||
      !row.id
    )
      continue;
    const id = 'bus-' + row.id;
    if (fixes.has(id) && fixes.get(id).time >= time) continue;
    const bearing = row.bearing == null || String(row.bearing).trim() === '' ? NaN : Number(row.bearing);
    fixes.set(id, {
      id,
      route,
      point,
      time,
      label: 'Vehicle ' + row.id,
      destination: row.destination || '',
      bearing: Number.isFinite(bearing) && bearing >= 0 && bearing <= 360 ? bearing % 360 : null,
      origin: row.origin,
      terminus: row.terminus,
      departure: row.departure,
      serviceDate: row.serviceDate,
      agency: 'Stagecoach',
      precision: 'Vehicle GPS',
    });
  }
  return [...fixes.values()];
}
export function railFixes(data) {
  if (!Array.isArray(data.trains) || !Number.isFinite(Date.parse(data.generated_at)))
    throw Error('Invalid rail response');
  const fixes = [];
  for (const t of data.trains) {
    if (
      t.cancelled ||
      !branch.includes(t.last?.crs) ||
      !branch.includes(t.next?.crs) ||
      t.last.crs === t.next.crs
    )
      continue;
    const point = [t.lon, t.lat];
    if (!localPoint(point) || !t.id) continue;
    fixes.push({
      id: 'rail-' + t.id,
      route: 'rail',
      point,
      time: Date.parse(data.generated_at),
      label: (t.origin || t.last.name) + ' → ' + (t.destination || t.next.name),
      destination: t.destination,
      agency: t.operator || 'Rail',
      precision: 'Estimated between stations',
      last: t.last.name,
      lastCode: t.last.crs,
      lastTime: t.last.time,
      next: t.next.name,
      nextCode: t.next.crs,
      nextTime: t.next.est,
    });
  }
  return fixes;
}
// The branch polyline and station list both run from Windermere to Oxenholme.
export function railBearing(fix, point, line, stations) {
  const stationIndex = (code, name) =>
    stations.findIndex((s) => (code ? s.code === code : s.name === name));
  const last = stationIndex(fix.lastCode, fix.last),
    next = stationIndex(fix.nextCode, fix.next);
  if (last < 0 || next < 0 || last === next) return null;
  let closest = Infinity,
    bearing = null;
  for (let i = 1; i < line.length; i++) {
    const [x, y] = line[i - 1],
      dx = line[i][0] - x,
      dy = line[i][1] - y;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((point[0] - x) * dx + (point[1] - y) * dy) / length2));
    const distance = (point[0] - x - t * dx) ** 2 + (point[1] - y - t * dy) ** 2;
    if (distance < closest) {
      closest = distance;
      bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + (last < next ? 360 : 540)) % 360;
    }
  }
  return bearing;
}
export function visibleFixes(snapshot, now) {
  return ['bus', 'rail'].flatMap((type) =>
    (snapshot?.[type]?.vehicles || [])
      .filter((v) => now - v.time >= -60_000 && now - v.time < expireMs)
      .map((v) => ({ ...v, stale: !snapshot[type].ok || now - v.time >= freshMs })),
  );
}
