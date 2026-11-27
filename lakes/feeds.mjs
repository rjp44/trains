import busCoverage from './bus-coverage.json' with { type: 'json' };
import railMap from './public/data/rail.json' with { type: 'json' };
import { project, nearestRailSegment } from './public/model.mjs';

export function busFixes(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid BODS response');
  const fixes = new Map();
  for (const row of rows) {
    const route = row.route,
      time = Date.parse(row.time),
      point = [Number(row.lon), Number(row.lat)];
    if (!Object.hasOwn(busCoverage, route) || !Number.isFinite(time) || !row.id) continue;
    const {
      bounds: [west, south, east, north],
      endpoints,
    } = busCoverage[route];
    if (
      !point.every(Number.isFinite) ||
      point[0] < west ||
      point[0] > east ||
      point[1] < south ||
      point[1] > north
    )
      continue;
    if (endpoints && [row.origin, row.terminus].some((ref) => ref && !endpoints.includes(ref))) continue;
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

// Railinfo reports both stations and passing points. Order runs north on the WCML.
const wcmlReports = [
  ['LAN'], ['Morecambe South Junction'], ['Hest Bank'], ['North Junction', 'Carnforth North Junction'],
  ['Milnthorpe'], ['OXN'], ['Lambrigg'], ['Grayrigg'], ['Tebay'], ['Shap Summit'],
  ['Shap'], ['Shap Harrisons Sidings'], ['Eden Valley'], ['PNR'], ['Plumpton'],
  ['Southwaite'], ['Upperby Bridge Junction'], ['Upperby Junction'], ['CAR'],
];
const reportOrder = new Map(wcmlReports.flatMap((names, index) => names.map(name => [name.toLowerCase(), index])));

function wcmlLeg(train, point) {
  const rank = call => reportOrder.get((call.crs || call.name || '').toLowerCase());
  const last = rank(train.last), next = rank(train.next);
  if (last == null || next == null || last === next) return null;
  // Coastal, Morecambe and Leeds trains also use the southern approach to Carnforth.
  if (Math.max(last, next) <= rank({name:'North Junction'})) {
    const mainLine = /Glasgow|Edinburgh|Stirling|Euston|Oxenholme|Penrith|Carlisle|Windermere/i;
    if (![train.origin, train.destination].some(place => mainLine.test(place || ''))) return null;
  }
  const near = nearestRailSegment(point, railMap.lines.wcml.track);
  // Running estimates can cut across a curve between widely spaced reports.
  if (near.distance > 35) return null;
  return {route: 'wcml', direction: Math.sign(next - last)};
}

function railLeg(train, point) {
  for (const [route, { stations, track }] of Object.entries(railMap.lines)) {
    if (route === 'wcml') continue;
    const find = (crs) => stations.findIndex((s) => s.code === crs);
    const last = find(train.last.crs),
      next = find(train.next.crs);
    if ((train.last.crs && last < 0) || (train.next.crs && next < 0)) continue;
    if (last >= 0 && next >= 0 && last !== next && (route !== 'coast' || Math.max(last, next) > 1))
      return { route, direction: Math.sign(next - last) };
    if (route !== 'coast') continue;
    // A coastal terminus distinguishes through workings when Railinfo reports a junction
    // without a station code, or a leg on the shared approach from Lancaster.
    const terminus = (name) => stations.findIndex((s) => s.name.toLowerCase() === name?.toLowerCase());
    const origin = terminus(train.origin),
      destination = terminus(train.destination);
    if (Math.max(origin, destination) < 2) continue;
    if (last >= 0 && next >= 0) {
      if (last !== next) return { route, direction: Math.sign(next - last) };
      continue;
    }
    const near = nearestRailSegment(point, track);
    if (near.distance > 4.7) continue; // roughly 500 m from the mapped railway
    // A named station beyond a terminus (e.g. Parton) was excluded above. At the
    // ends require a reported station in the sector to avoid pulling in the next leg.
    if ((near.vertex === 0 || near.vertex === track.length - 1) && last < 0 && next < 0) continue;
    const aim = next >= 0 ? next : destination;
    const from = last >= 0 ? last : origin;
    const direction =
      aim >= 0 && from >= 0 && aim !== from
        ? Math.sign(aim - from)
        : aim >= 0
          ? Math.sign(stations[aim].vertex - near.vertex)
          : from >= 0
            ? Math.sign(near.vertex - stations[from].vertex)
            : null;
    if (direction) return { route, direction };
  }
  return wcmlLeg(train, point);
}

export function railFixes(data) {
  if (!Array.isArray(data.trains) || !Number.isFinite(Date.parse(data.generated_at)))
    throw Error('Invalid rail response');
  const fixes = [];
  for (const t of data.trains) {
    if (!t.id || t.cancelled || !t.last || !t.next || ![t.lon, t.lat].every(Number.isFinite)) continue;
    const point = [t.lon, t.lat],
      xy = project(point, railMap.frame);
    if (xy[0] < 0 || xy[0] > railMap.frame.width || xy[1] < 0 || xy[1] > railMap.frame.height) continue;
    const leg = railLeg(t, xy);
    if (!leg) continue;
    const { route, direction } = leg;
    fixes.push({
      id: 'rail-' + t.id,
      route,
      direction,
      point,
      time: Date.parse(data.generated_at),
      label: (t.origin || t.last.name) + ' → ' + (t.destination || t.next.name),
      destination: t.destination,
      agency: t.operator || 'Rail',
      precision:
        t.last.crs && t.next.crs ? 'Estimated between stations' : 'Estimated between reporting points',
      last: t.last.name,
      lastCode: t.last.crs,
      lastTime: t.last.time,
      lastStop: typeof t.last.stop === 'boolean' ? t.last.stop : undefined,
      next: t.next.name,
      nextCode: t.next.crs,
      nextTime: t.next.est,
    });
  }
  return fixes;
}

export function createVehicleFeed(readBusArchive) {
  const sources = {
    bus: {
      url: 'https://data.bus-data.dft.gov.uk/avl/download/bulk_archive',
      interval: 60_000,
      async decode(res) {
        const data = await readBusArchive(await res.arrayBuffer());
        return { generated: Date.parse(data.updated), vehicles: busFixes(data.rows) };
      },
    },
    rail: {
      url: 'https://api.railinfo.uk/map/trains',
      interval: 30_000,
      async decode(res) {
        const data = await res.json();
        return { generated: Date.parse(data.generated_at), vehicles: railFixes(data) };
      },
    },
  };
  const cache = new Map();
  async function live(type) {
    const old = cache.get(type);
    if (old?.pending) return old.pending;
    if (old && Date.now() - old.value.checked < sources[type].interval) return old.value;
    const entry = { value: old?.value };
    const { url, decode } = sources[type];
    entry.pending = (async () => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'LakesTransitMap/0.1 (rjp44/trains)' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw Error('HTTP ' + res.status);
        entry.value = { ...(await decode(res)), ok: true, checked: Date.now() };
      } catch (error) {
        entry.value = {
          ...entry.value,
          ok: false,
          checked: Date.now(),
          vehicles: entry.value?.vehicles || [],
        };
        console.warn(type + ' feed unavailable', error.message);
      } finally {
        entry.pending = null;
      }
      return entry.value;
    })();
    cache.set(type, entry);
    return entry.pending;
  }
  return async () => {
    const [bus, rail] = await Promise.all([live('bus'), live('rail')]);
    return { time: Date.now(), bus, rail };
  };
}
