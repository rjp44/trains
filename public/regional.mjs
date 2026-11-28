// Marker order is shared by live packets, recorded frames and the native scene.
// Older station-overview packages also reserve summary positions at each stop.
import { isTrainCode, operators, stationName } from './hemel.mjs';
import { trainLabel } from './train-label.mjs';
export const slots = 8;
export function regionalMarkers(layout) {
  return layout.tracks.flatMap((track) => [
    ...(layout.diagram === 'directional'
      ? []
      : Array.from({ length: slots }, (_, i) => ({ id: track.id + '-' + (i + 1), track }))),
    ...track.berths.map((b) => ({ ...b, track })),
  ]);
}
export function regionalRows(layout, state, live = false) {
  const fresh = (id) =>
    live ? state.areaStatus?.[id.slice(0, 2)] === 'Live' : Boolean(state.areaTimes[id.slice(0, 2)]);
  const clock = (v) => (/^\d{4}H?$/.test(v) ? v.slice(0, 2) + ':' + v.slice(2, 4) : '');
  function describe(train) {
    const { b, head, service: s } = train;
    const route =
      s?.origin && s.destination
        ? stationName(s.origin) + ' to ' + stationName(s.destination)
        : 'Service details unavailable';
    const timing = [clock(s?.departure), clock(s?.arrival)].filter(Boolean).join('-');
    const delay = !Number.isFinite(s?.delay)
      ? ''
      : s.delay === 0
        ? 'On time'
        : Math.abs(s.delay) + ' min ' + (s.delay > 0 ? 'late' : 'early');
    const info = [b.platform && 'P' + b.platform, b.id, operators[s?.operator] || s?.operator, timing, delay]
      .filter(Boolean)
      .join(' | ');
    return [0, train.fresh ? 1 : 3, head, s?.id || '', route, info, trainLabel(s)];
  }
  function overviewRows(track) {
    const occupied = new Map();
    for (const b of track.berths) {
      const head = state.values[b.id];
      if (!head || !isTrainCode(head)) continue;
      const service = state.services[b.id.slice(0, 2) + '/' + head];
      const key = service?.id || b.id.slice(0, 2) + '/' + head;
      const previous = occupied.get(key);
      if (
        !previous ||
        (!previous.fresh && fresh(b.id)) ||
        (!previous.b.platform && b.platform && previous.fresh === fresh(b.id))
      )
        occupied.set(key, { head, b, service, fresh: fresh(b.id) });
    }
    const trains = [...occupied.values()].sort(
      (a, b) => Number(b.fresh) - Number(a.fresh) || a.head.localeCompare(b.head),
    );
    return Array.from({ length: slots }, (_, i) => {
      const train = trains[i];
      if (!train) return [0, 0, '', '', '', ''];
      if (i === slots - 1 && trains.length > slots) {
        const extra = trains.slice(i);
        return [0, 2, '+' + extra.length, '', 'Also at ' + track.name, extra.map((t) => t.head).join(' ')];
      }
      return describe(train);
    });
  }
  return layout.tracks.flatMap((track) => {
    const rows = layout.diagram === 'directional' ? [] : overviewRows(track);
    for (const b of track.berths) {
      const head = state.values[b.id];
      const row = head
        ? describe({ b, head, service: state.services[b.id.slice(0, 2) + '/' + head], fresh: fresh(b.id) })
        : [0, 0, '', '', '', ''];
      if (head && !isTrainCode(head)) row[1] = fresh(b.id) ? 2 : 3;
      row[0] = b.bit && fresh(b.id) ? { on: 1, off: 2 }[state.values[b.bit]] || 0 : 0;
      rows.push(row);
    }
    return rows;
  });
}

export function locationArrivals(layout) {
  const index = layout.tracks.findIndex((t) => t.id === layout.focus);
  const locations = new Map(layout.tracks.flatMap((t, i) => t.berths.map((b) => [b.id, i])));
  const platforms = new Set(layout.tracks[index].berths.filter((b) => b.platform).map((b) => b.id));
  const last = new Map(),
    seeded = new Set(),
    heard = new Map();
  let pending = [];
  function reset() {
    last.clear();
    seeded.clear();
    heard.clear();
    pending = [];
  }
  function accept(frame) {
    if (!frame.values) return;
    if (frame.full) seeded.add(frame.area);
    for (const [id, head] of Object.entries(frame.values)) {
      const place = locations.get(id);
      if (place == null || !isTrainCode(head)) continue;
      const previous = last.get(head);
      if (
        !frame.full &&
        seeded.has(frame.area) &&
        platforms.has(id) &&
        previous &&
        previous.place !== index &&
        frame.time - previous.time < 10 * 60000 &&
        frame.time - (heard.get(head) || 0) > 90000
      ) {
        pending.push({ time: frame.time, direction: previous.place < index ? 'U' : 'D' });
        heard.set(head, frame.time);
      }
      last.set(head, { place, time: frame.time });
    }
    for (const [key, record] of last) if (frame.time - record.time > 10 * 60000) last.delete(key);
    for (const [key, time] of heard) if (frame.time - time > 90000) heard.delete(key);
  }
  function take(active, now = Date.now()) {
    const directions = active
      ? pending
          .filter((e) => Math.abs(now - e.time) < 6500)
          .slice(-4)
          .map((e) => e.direction)
          .join('')
      : '';
    pending = [];
    return directions;
  }
  return { accept, reset, take };
}
