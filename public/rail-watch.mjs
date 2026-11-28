import { isTrainCode, stationName, operators } from './hemel.mjs';

const hemelLocations = {
  HRW: 'HROW',
  BSH: 'BUSHEY',
  WFJ: 'WATFDJ',
  KGL: 'KLGL',
  APS: 'APSLEY',
  HML: 'HEMLHMP',
  BKM: 'BERKHMD',
  TRI: 'TRING',
  CED: 'CHDNGTN',
  WFH: 'WATFDHS',
  CPK: 'CRPNDPK',
  HTE: 'HTCHEND',
  HDL: 'HEDSTNL',
  KNT: 'KTON',
  WFN: 'WATFDN',
  GSN: 'GRSTH',
  BWO: 'BCWD',
  HWW: 'HOWWOOD',
  PKT: 'PKST',
  SAA: 'STALBNA',
};

export function watchStations(layout) {
  if (layout.profile === 'regional')
    return layout.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      location: t.id,
      berths: t.berths.map((b) => [b.id, b.direction === 'down' ? 1 : b.direction === 'up' ? -1 : 0]),
    }));
  const stations = new Map();
  for (const route of [layout, ...layout.branches]) {
    const coordinate = route === layout ? 'mile' : 'distance';
    for (const s of route.stations) {
      if (!stations.has(s.code))
        stations.set(s.code, { id: s.code, name: s.name, location: hemelLocations[s.code], berths: [] });
      const entries = stations.get(s.code).berths;
      for (const t of route.tracks) {
        const dir = t.direction || (t.id === 'down' ? 1 : t.id === 'up' ? -1 : 0);
        const measured = t.berths.filter((b) => Number.isFinite(b[coordinate]));
        const direct = measured.filter((b) => b.station === s.code || b[coordinate] === s[coordinate]);
        const nearest = measured.reduce(
          (best, b) =>
            !best || Math.abs(b[coordinate] - s[coordinate]) < Math.abs(best[coordinate] - s[coordinate])
              ? b
              : best,
          null,
        );
        // A station can lie between signals. Only use the nearest report on this road
        // if it is close to this station and belongs to no closer station.
        const distance = nearest ? Math.abs(nearest[coordinate] - s[coordinate]) : Infinity;
        const nearby =
          nearest &&
          distance <= 0.7 &&
          route.stations.every((other) => Math.abs(other[coordinate] - nearest[coordinate]) >= distance);
        for (const b of direct.length ? direct : nearby ? [nearest] : []) entries.push([b.id, dir]);
      }
    }
  }
  for (const t of layout.junction.tracks)
    for (const b of t.berths) stations.get(layout.junction.code).berths.push([b.id, 0]);
  return [...stations.values()];
}

export function atStation(station, board, fresh) {
  const trains = new Map();
  for (const [berth, direction] of station?.berths || []) {
    const area = berth.slice(0, 2),
      head = board.values[berth];
    if (!fresh(area) || !isTrainCode(head)) continue;
    const service = board.services[area + '/' + head];
    const key = service?.id || area + '/' + head;
    if (!trains.has(key)) trains.set(key, { berth, head, service, direction });
  }
  return [...trains.values()];
}

// A snapshot seeds occupancy silently on entry, reconnect, watch changes and resuming after Follow.
export function watchArrivals() {
  const previous = new Map();
  return {
    reset() {
      previous.clear();
    },
    sample(trains, station, fresh, sound) {
      const areas = new Set(station?.berths.map(([id]) => id.slice(0, 2)));
      for (const area of areas) {
        if (!fresh(area)) {
          previous.delete(area);
          continue;
        }
        const before = previous.get(area),
          next = new Set();
        for (const train of trains.filter((t) => t.berth.startsWith(area))) {
          next.add(train.head);
          if (before && !before.has(train.head)) sound(train);
        }
        previous.set(area, next);
      }
    },
  };
}

export function locateFollow(target, ids, board) {
  const candidates = [];
  for (const berth of ids) {
    if (board.values[berth] !== target.head) continue;
    const service = board.services[berth.slice(0, 2) + '/' + target.head];
    if (target.service && target.service !== service?.id && (service?.id || berth !== target.berth)) continue;
    candidates.push({ berth, head: target.head, service });
  }
  const exact = candidates.filter((t) => target.service && t.service?.id === target.service);
  const matches = exact.length
    ? exact
    : candidates.filter((t) => t.berth.slice(0, 2) === target.berth.slice(0, 2));
  const chosen =
    matches.find((t) => t.berth === target.berth) ||
    (matches.length === 1 || exact.length ? matches[0] : null);
  if (chosen) {
    target.berth = chosen.berth;
    target.service ||= chosen.service?.id;
  }
  return chosen;
}

export function trainSummary(train, place, call) {
  const s = train.service;
  return {
    head: train.head,
    context: place,
    route: s?.destination
      ? [s.origin && stationName(s.origin), stationName(s.destination)].filter(Boolean).join(' → ')
      : 'Service details unavailable',
    running: [
      operators[s?.operator] || s?.operator,
      call?.booked ? 'Booked ' + call.booked : call?.passing ? 'Passing' : '',
      Number.isFinite(s?.delay)
        ? s.delay === 0
          ? 'On time'
          : Math.abs(s.delay) + ' min ' + (s.delay > 0 ? 'late' : 'early')
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}
