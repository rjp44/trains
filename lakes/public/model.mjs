import railLiveries from './rail-liveries.json' with { type: 'json' };

export const routes = {
  505: { icon: 'single', name: 'Coniston', via: 'Kendal · Windermere · Hawkshead', colour: '#ad4936' },
  555: {
    icon: 'closed-decker',
    name: 'Keswick – Kendal',
    via: 'Grasmere · Ambleside · Windermere',
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
  X4: {
    icon: 'closed-decker',
    name: 'Workington – Penrith',
    via: 'Cockermouth · Keswick',
    colour: '#176e68',
  },
  X5: {
    icon: 'closed-decker',
    name: 'Workington – Penrith',
    via: 'Cockermouth · Keswick',
    colour: '#9c3d63',
  },
  X6: { icon: 'single', name: 'Kendal – Barrow', via: 'Grange-over-Sands · Ulverston', colour: '#565fa0' },
  wcml: { chip: 'WCML', name: 'West Coast Main Line', via: 'Lancaster – Oxenholme – Penrith – Carlisle', colour: '#88324f' },
  coast: {
    chip: 'Coast',
    name: 'Furness & Cumbrian Coast lines',
    via: 'Lancaster – Barrow – Whitehaven',
    colour: '#824828',
  },
  rail: { chip: 'Lakes', name: 'Lakes Line', via: 'Oxenholme – Windermere', colour: '#273e53' },
};
export const order = ['505', '555', '599', '516', '508', 'X4', 'X5', 'X6', 'rail', 'coast', 'wcml'];
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

export function nearestRailSegment(point, line, start = 0, end = line.length - 1, forward) {
  let best = { distance: Infinity };
  let bestScore = Infinity;
  for (let i = start + 1; i <= end; i++) {
    const [x, y] = line[i - 1],
      dx = line[i][0] - x,
      dy = line[i][1] - y;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((point[0] - x) * dx + (point[1] - y) * dy) / length2));
    const distance = Math.hypot(point[0] - x - t * dx, point[1] - y - t * dy);
    // Some coastal track traces double back over the same rails near stations.
    // Within a quarter map unit (~27 m), favour the trace advancing along this leg.
    const againstLeg = forward && dx * forward[0] + dy * forward[1] < 0;
    const score = distance + (againstLeg ? 0.25 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { distance, vertex: i - 1 + t, bearing: (Math.atan2(dx, -dy) * 180) / Math.PI };
    }
  }
  return best;
}

export function railBearing(fix, point, line, stations) {
  const stationIndex = (code, name) =>
    stations.findIndex((s) => (code ? s.code === code : s.name === name));
  const last = stationIndex(fix.lastCode, fix.last),
    next = stationIndex(fix.nextCode, fix.next);
  const known = last >= 0 && next >= 0 && last !== next;
  const direction = fix.direction || (known ? Math.sign(next - last) : null);
  if (!direction) return null;
  const start = known ? stations[Math.min(last, next)].vertex : undefined;
  const end = known ? stations[Math.max(last, next)].vertex : undefined;
  const firstPoint = known && (stations[Math.min(last, next)].point ?? line[start]);
  const lastPoint = known && (stations[Math.max(last, next)].point ?? line[end]);
  const forward = firstPoint && lastPoint && [lastPoint[0] - firstPoint[0], lastPoint[1] - firstPoint[1]];
  const { bearing } = nearestRailSegment(point, line, start, end, forward);
  return Number.isFinite(bearing) ? (bearing + (direction > 0 ? 360 : 540)) % 360 : null;
}
export function visibleFixes(snapshot, now) {
  return ['bus', 'rail'].flatMap((type) =>
    (snapshot?.[type]?.vehicles || [])
      .filter((v) => now - v.time >= -60_000 && now - v.time < expireMs)
      .map((v) => ({ ...v, stale: !snapshot[type].ok || now - v.time >= freshMs })),
  );
}

// A later estimate on the same rail leg is not a new station report.
export function railTransitions(previous, current, now) {
  if (!previous?.ok || !current?.ok) return [];
  return current.vehicles.filter(train => {
    const old = previous.vehicles.find(v => v.id === train.id && v.route === train.route);
    return old && train.direction && (train.lastCode || train.last) &&
      (old.lastCode || old.last) !== (train.lastCode || train.last) &&
      train.time > old.time && train.time - old.time < freshMs &&
      now - train.time < freshMs && train.time <= now + 5000;
  });
}
export function confirmedRailStop(fix, reports) {
  return reports.some(({id, last}) => 'rail-' + id === fix.id && last?.stop === true &&
    last.crs === fix.lastCode && last.name === fix.last && last.time === fix.lastTime);
}

// The feed identifies the operator, not the diagrammed rolling-stock class.
const liveriesByAgency = new Map(railLiveries.flatMap(livery =>
  [livery.name, ...livery.aliases].map(agency => [agency, livery])
));

export function railOperatorName(agency) {
  return liveriesByAgency.get(agency)?.name ?? agency;
}

export function railIcon(agency, view) {
  const id = liveriesByAgency.get(agency)?.id ?? 'northern';
  return id + '-carriage' + (view === 'side' ? '' : '-' + view);
}
