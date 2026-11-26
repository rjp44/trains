// Distances are map units. At this map's latitude one unit is about 108 metres.
const halfWindow = 4;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function makePath(points) {
  const path = [];
  let distance = 0;
  for (const [x, y] of points) {
    const last = path.at(-1);
    if (last) {
      const step = Math.hypot(x - last.x, y - last.y);
      if (!step) continue;
      distance += step;
    }
    path.push({ x, y, distance });
  }
  return path;
}

function pointAt(path, distance) {
  let lo = 0,
    hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].distance < distance) lo = mid;
    else hi = mid;
  }
  const a = path[lo],
    b = path[hi];
  const t = clamp((distance - a.distance) / (b.distance - a.distance), 0, 1);
  return [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)];
}

export function routeBearing(path, distance) {
  const a = pointAt(path, distance - halfWindow);
  let b = pointAt(path, distance + halfWindow);
  // On a tight turnback the two ends of the window can coincide.
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) b = pointAt(path, distance);
  return ((Math.atan2(b[0] - a[0], a[1] - b[1]) * 180) / Math.PI + 360) % 360;
}

function nearest(path, x, y, expected) {
  let best = Infinity,
    distance = 0;
  for (let i = 1; i < path.length; ++i) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const span = b.distance - a.distance;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const along = a.distance + t * span;
    // Only break near-ties on returning/shared stretches with scheduled journey progress.
    const error =
      Math.hypot(x - a.x - t * dx, y - a.y - t * dy) +
      (expected == null ? 0 : 0.35 * Math.abs(along / path.at(-1).distance - expected));
    if (error < best) {
      best = error;
      distance = along;
    }
  }
  return { distance, error: best };
}

export class BusPaths {
  constructor(timetable, project) {
    this.paths = (timetable?.paths || []).map((points) => makePath(points.map(project)));
    this.variants = new Map();
    const seen = new Set();
    for (const trip of timetable?.trips || []) {
      if (!this.paths[trip.path]) continue;
      const calls = timetable.patterns[trip.pattern];
      const origin = calls[0][0],
        terminus = calls.at(-1)[0];
      const key = [trip.route, trip.path, origin, terminus].join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.variants.has(trip.route)) this.variants.set(trip.route, []);
      this.variants.get(trip.route).push({ path: trip.path, origin, terminus });
    }
  }
  locate(bus, x, y, trip, expected) {
    let bestRank = -1,
      bestError = Infinity,
      result = null;
    const variants = trip && this.paths[trip.path] ? [trip] : this.variants.get(bus.route) || [];
    for (const variant of variants) {
      const path = this.paths[variant.path];
      if (path.length < 2) continue;
      const rank =
        Number(!!bus.origin && variant.origin === bus.origin) +
        Number(!!bus.terminus && variant.terminus === bus.terminus);
      if (rank < bestRank) continue;
      const { distance, error } = nearest(path, x, y, expected);
      const bearing = routeBearing(path, distance);
      // With no journey identity, use GPS only to choose between parallel directional traces.
      const penalty =
        !trip && !rank && Number.isFinite(bus.bearing)
          ? 0.6 * (1 - Math.cos(((bearing - bus.bearing) * Math.PI) / 180))
          : 0;
      if (rank > bestRank || error + penalty < bestError) {
        bestRank = rank;
        bestError = error + penalty;
        result = { path, distance, bearing, pathId: variant.path };
      }
    }
    return result;
  }
}

export function busView(bearing) {
  if (!Number.isFinite(bearing) || bearing < 0 || bearing > 360) return 'front';
  // Measured from east/west, this angle repeats every half turn.
  const tilt = Math.abs((bearing % 180) - 90);
  if (tilt <= 22.5) return 'side';
  if (tilt >= 67.5) return 'roof';
  return 'oblique';
}

// Include the white outline and nose chevron of the rotated sprite in its footprint.
function footprint(x, y, bearing, unit, bus) {
  const a = ((bearing ?? 90) * Math.PI) / 180;
  const s = Math.abs(Math.sin(a)),
    c = Math.abs(Math.cos(a));
  const halfHeight = bus && busView(bearing) === 'roof' ? 7.3 : 10.5;
  const halfLength = bus ? 18.3 : 18;
  if (bus) {
    x += 2.5 * Math.sin(a) * unit;
    y -= 2.5 * Math.cos(a) * unit;
  }
  const w = (halfLength * s + halfHeight * c + 1) * unit,
    h = (halfLength * c + halfHeight * s + 1) * unit;
  return [x - w, y - h, 2 * w, 2 * h];
}
function overlap(a, b) {
  return (
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))
  );
}

export function placeVehicles(markers, unit, inside) {
  // Locate fixed rail estimates first. Stable bus ordering makes repeated snapshots identical.
  const ordered = markers
    .slice()
    .sort(
      (a, b) =>
        Number(!!a.path) - Number(!!b.path) ||
        (a.pathId ?? -1) - (b.pathId ?? -1) ||
        a.distance - b.distance ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const origins = new Map(ordered.map((m) => [m, [m.x, m.y, m.bearing]]));
  // At overview scale an entire short service can fit under a few full-size icons.
  for (const busSize of [1, 0.82, 0.66, 0.52, 0.4]) {
    let crowded = false;
    const occupied = [];
    for (const m of ordered) {
      [m.x, m.y, m.bearing] = origins.get(m);
      m.size = m.path ? busSize : 1;
      const iconUnit = unit * m.size;
      m.drawDistance = m.distance;
      m.box = footprint(m.x, m.y, m.bearing, iconUnit, !!m.path);
      const cost = (box) => occupied.reduce((sum, other) => sum + overlap(box, other), 0);
      let best = cost(m.box);
      if (best && m.path) {
        const length = m.path.at(-1).distance;
        const keepVisible = inside(m.x, m.y);
        const step = 3 * iconUnit;
        const limit = Math.max(m.distance, length - m.distance);
        for (let delta = 0; delta < limit + step && best > 0; delta += step) {
          for (const sign of delta ? [-1, 1] : [1]) {
            const target = m.distance + sign * delta;
            if (target <= -step || target >= length + step) continue;
            const d = clamp(target, 0, length);
            const [x, y] = pointAt(m.path, d);
            if (keepVisible && !inside(x, y)) continue;
            const bearing = routeBearing(m.path, d),
              box = footprint(x, y, bearing, iconUnit, true);
            const score = cost(box);
            if (score >= best) continue;
            Object.assign(m, { x, y, bearing, box, drawDistance: d });
            best = score;
            if (!best) break;
          }
        }
      }
      crowded ||= !!m.path && best > 0;
      occupied.push(m.box);
    }
    if (!crowded) break;
  }
  // Two close buses can find free spaces on opposite sides. Give those spaces back
  // in journey order, keeping each route's footprints and all fixed rail positions.
  for (let first = 0; first < ordered.length; ) {
    let end = first + 1;
    while (end < ordered.length && ordered[end].path === ordered[first].path) ++end;
    if (ordered[first].path && end - first > 1) {
      const slots = ordered
        .slice(first, end)
        .map(({ x, y, bearing, box, drawDistance }) => ({ x, y, bearing, box, drawDistance }))
        .sort((a, b) => a.drawDistance - b.drawDistance);
      slots.forEach((slot, i) => Object.assign(ordered[first + i], slot));
    }
    first = end;
  }
  return markers;
}
