export const corridorTracks = (layout) => [
  ...layout.tracks,
  ...(layout.junction?.tracks ?? []).map((t) => ({ ...t, branch: 'bay' })),
  ...(layout.branches ?? []).flatMap((branch) =>
    branch.tracks.map((track) => ({ ...track, branch: branch.id })),
  ),
];

// Each train-describer area publishes a full snapshot followed by sparse updates.
export class Corridor {
  constructor(layout) {
    this.areas = layout.areas;
    this.meta = new Map();
    for (const track of corridorTracks(layout)) {
      for (const berth of track.berths) {
        if (berth.kind === 'station-report') continue;
        this.meta.set(berth.id, { kind: 'berth', label: berth.id.slice(2), track: track.name });
        if (berth.bit) this.meta.set(berth.bit, { kind: 'signal', label: berth.signal, track: track.name });
      }
    }
    this.values = {};
    this.events = [];
    this.services = {};
    this.observed = null;
    this.received = null;
    this.areaTimes = {};
    this.lastDeltas = {};
    this.catalogue = new Map();
    this.abbey = null;
  }

  newConnection() {
    this.areaTimes = {};
    this.lastDeltas = {};
    this.catalogue.clear();
    this.services = {};
  }

  matchTrains() {
    const matches = {};
    const candidates = new Map();
    for (const [key, value] of Object.entries(this.values)) {
      if (this.meta.get(key)?.kind !== 'berth' || !value) continue;
      const area = key.slice(0, 2);
      if (this.areaTimes[area]) candidates.set(area + '/' + value, []);
    }
    for (const [id, service] of this.catalogue) {
      if (service.f || service.c || !Array.isArray(service.t)) continue;
      const descriptions = new Set([service.ti, service.tic].filter(Boolean).map((t) => t.slice(2, 6)));
      for (const area of service.t) {
        for (const head of descriptions) candidates.get(area + '/' + head)?.push([id, service]);
      }
    }
    for (const [key, list] of candidates) {
      if (list.length > 1) {
        matches[key] = { ambiguous: true };
        continue;
      }
      if (!list.length) continue;
      const [id, s] = list[0];
      matches[key] = {
        id,
        origin: s.ol,
        destination: s.dl,
        departure: s.od,
        arrival: s.da,
        delay: s.cd,
        operator: s.tc,
        uid: s.sk?.slice(0, 6),
        startTime: s.st,
        updated: s.lu,
      };
    }
    return matches;
  }

  accept(message, received) {
    const time = Number(message.timestamp);
    if (!Number.isFinite(time) || time <= 0 || !message.message || typeof message.message !== 'object')
      return;
    const payload = message.message;
    if (['TRUST_ALL', 'TRUST_UPDATE'].includes(message.type)) {
      if (message.type === 'TRUST_ALL') this.catalogue.clear();
      for (const id of message.deleted ?? []) this.catalogue.delete(id);
      for (const [id, s] of Object.entries(payload)) this.catalogue.set(id, s);
      const services = this.matchTrains();
      if (JSON.stringify(services) === JSON.stringify(this.services)) return;
      this.services = services;
      return { time, received, services };
    }
    const area = message.area;
    if (!this.areas.includes(area)) return;
    const full = ['TD_ALL', 'SEND_ALL'].includes(message.type);
    if (
      !full &&
      (!['TD_UPDATE', 'SEND_UPDATE'].includes(message.type) ||
        this.areaTimes[area] == null ||
        time < this.areaTimes[area])
    )
      return;
    const values = {};
    let trainsChanged = full;
    for (const [key, raw] of Object.entries(payload)) {
      const info = this.meta.get(key);
      if (!info || !key.startsWith(area)) continue;
      let value = null;
      if (info.kind === 'signal') {
        if (raw === '0' || raw === 0) value = 'on';
        if (raw === '1' || raw === 1) value = 'off';
      } else if (typeof raw === 'string') value = raw.trim();
      if (full || this.values[key] !== value) {
        values[key] = value;
        if (info.kind === 'berth') trainsChanged = true;
      }
    }
    const frame = { time, received, area, full, values };
    this.apply(frame);
    if (trainsChanged) {
      const services = this.matchTrains();
      if (full || JSON.stringify(services) !== JSON.stringify(this.services)) {
        frame.services = this.services = services;
      }
    }
    if (full || Object.keys(values).length) return frame;
  }

  apply(frame) {
    if (frame.abbey) this.abbey = frame.abbey;
    const { time, full, values, received, services, area = 'R1' } = frame;
    if (services) this.services = services;
    if (!values) return;
    if (full) {
      for (const key of Object.keys(this.values)) if (key.startsWith(area)) delete this.values[key];
      this.events = this.events.filter((e) => !e.key.startsWith(area));
      delete this.lastDeltas[area];
    }
    for (const [key, value] of Object.entries(values)) {
      const info = this.meta.get(key);
      if (!info) continue;
      const before = this.values[key];
      if (!full && before !== value)
        this.events.unshift({ time, key, ...info, before: before ?? null, value });
      this.values[key] = value;
    }
    this.events.length = Math.min(40, this.events.length);
    this.areaTimes[area] = time;
    this.observed = Math.max(this.observed ?? 0, time);
    this.received = received ?? null;
    if (!full) this.lastDeltas[area] = time;
  }
}

// A headcode can be reused. Once the user has selected an identified service,
// only move the selection to another berth when the service identity agrees.
export function locateTrain(selection, markers, board) {
  const previous = markers.find((marker) => marker.id === selection.berth);
  const serviceAt = (marker) => board.services?.[marker.id.slice(0, 2) + '/' + selection.head];
  const occupied = markers.filter((marker) => board.values[marker.id] === selection.head);
  const compatible = occupied.filter((marker) => {
    const candidate = serviceAt(marker);
    if (selection.service?.id) {
      return candidate?.id === selection.service.id || (marker.id === selection.berth && !candidate?.id);
    }
    return marker.id.slice(0, 2) === selection.area;
  });
  const current =
    compatible.find((marker) => marker.id === selection.berth) ??
    (compatible.length === 1 ? compatible[0] : null);
  if (!current) return { marker: previous, current: false, service: selection.service };
  const candidate = serviceAt(current);
  selection.berth = current.id;
  selection.area = current.id.slice(0, 2);
  if (candidate?.id) selection.service = candidate;
  return {
    marker: current,
    current: true,
    service: candidate?.id ? candidate : null,
    ambiguous: Boolean(candidate?.ambiguous),
  };
}

// Keep station reports separate from TD berths in the recording and in the UI.
// A confirmed report may supersede a lingering platform description for the same shuttle.
export function withStationReports(board) {
  const values = { ...board.values };
  const services = { ...board.services };
  for (const service of board.abbey?.reports ?? []) {
    const platformMatch = services['WJ/' + service.head];
    if (values.WJ0856 === service.head && (!platformMatch || platformMatch.id === service.id)) {
      if (service.station === 'WFJ') {
        services['WJ/' + service.head] = service;
        continue;
      }
      delete values.WJ0856;
    }
    values['AB' + service.station] = service.head;
    services['AB/' + service.head] = service;
  }
  return { ...board, values, services };
}

// The horizontal coordinate of every route is measured in rail miles, with
// Watford as the common origin of the local branches.
export function routeMile(point, route, junctionMile) {
  if (!route) return point.mile;
  return junctionMile + (point.offset ?? (route === 'dc' ? -point.distance : point.distance));
}

// Build shared station columns from the number of berth steps each line needs.
// The line with the most berth steps sets the minimum span and the others stretch over that span.
export function berthDiagram(layout) {
  const junction = layout.stations.find((s) => s.code === layout.junction.code);
  const dc = layout.branches.find((b) => b.id === 'dc');
  const abbey = layout.branches.find((b) => b.id === 'abbey');
  const terminal = dc.tracks.find((t) => t.id === 'terminal');
  const incoming = new Map();
  const positions = new Map(),
    columns = new Map();

  function indexLine(berths, stations, route, id) {
    const mile = (point) => routeMile(point, route, junction.mile);
    const ordered = berths.slice().sort((a, b) => mile(a) - mile(b));
    const anchors = stations
      .slice()
      .sort((a, b) => mile(a) - mile(b))
      .map((s) => {
        // Watford has two successive platform descriptions on each through line.
        // Elsewhere the local diagram uses the nearest mapped berth as the
        // schematic station anchor when there is no explicit station assignment.
        const matches = ordered
          .map((b, i) => (b.station === s.code || (s.code === junction.code && b.platform) ? i : -1))
          .filter((i) => i >= 0);
        const nearest = ordered.reduce(
          (best, b, i) => (Math.abs(mile(b) - mile(s)) < Math.abs(mile(ordered[best]) - mile(s)) ? i : best),
          0,
        );
        const first = matches[0] ?? nearest,
          last = matches.at(-1) ?? nearest;
        return { code: s.code, first, last, centre: (first + last) / 2 };
      });
    for (const [i, anchor] of anchors.entries()) {
      if (!incoming.has(anchor.code)) incoming.set(anchor.code, new Map());
      if (!i) continue;
      const prev = anchors[i - 1],
        constraints = incoming.get(anchor.code);
      constraints.set(prev.code, Math.max(constraints.get(prev.code) ?? 0, anchor.centre - prev.centre));
    }
    return { id, ordered, anchors };
  }
  const mainLines = layout.tracks.map((t) => indexLine(t.berths, layout.stations, null, t.id));
  const dcRunning = dc.tracks
    .filter((t) => t.id === 'down' || t.id === 'up')
    .map((t) => {
      const platform = t.id === 'down' ? '2' : '3';
      return indexLine(
        t.berths.concat(terminal.berths.filter((b) => b.platform === platform)),
        dc.stations,
        'dc',
        t.id,
      );
    });
  // Shared interchanges constrain both routes, even when one passes through
  // additional stations between them (e.g. Bushey to Watford via High Street).
  function stationColumn(code) {
    if (!columns.has(code)) {
      let x = 0;
      for (const [prev, steps] of incoming.get(code)) x = Math.max(x, stationColumn(prev) + steps);
      columns.set(code, x);
    }
    return columns.get(code);
  }
  for (const code of incoming.keys()) stationColumn(code);
  const origin = columns.get(junction.code);
  for (const [code, x] of columns) columns.set(code, x - origin);

  function placeLine({ id, ordered, anchors }) {
    const knots = [];
    for (const { code, first, last, centre } of anchors) {
      const x = columns.get(code);
      knots.push({ rank: first, x: x + first - centre });
      if (last !== first) knots.push({ rank: last, x: x + last - centre });
    }
    const start = knots[0].x - knots[0].rank - 0.5;
    const end = knots.at(-1).x + ordered.length - 0.5 - knots.at(-1).rank;
    knots.unshift({ rank: -0.5, x: start });
    knots.push({ rank: ordered.length - 0.5, x: end });
    for (let j = 1; j < knots.length; j++) {
      const a = knots[j - 1],
        b = knots[j];
      for (let i = Math.ceil(a.rank); i < b.rank; i++) {
        positions.set(ordered[i].id, a.x + ((b.x - a.x) * (i - a.rank)) / (b.rank - a.rank));
      }
    }
    return { id, start, end };
  }
  const main = mainLines.map(placeLine),
    dcLines = dcRunning.map(placeLine);
  for (const berth of [...terminal.berths, ...layout.junction.tracks.flatMap((t) => t.berths)]) {
    positions.set(berth.id, berth.offset < 0 ? -0.5 : 0.5);
  }
  const harrow = columns.get('HRW');
  for (const berth of dc.tracks.find((t) => t.id === 'harrow').berths) positions.set(berth.id, harrow + 0.75);
  abbey.stations.forEach((s, i) => columns.set(s.code, i));
  for (const berth of abbey.tracks[0].berths)
    positions.set(berth.id, columns.get(berth.station ?? junction.code));
  return {
    positions,
    main,
    dcLines,
    columns,
    harrow,
    abbeyEnd: abbey.stations.length - 1,
    start: Math.min(...[...main, ...dcLines].map((l) => l.start)),
    end: Math.max(abbey.stations.length - 1, ...main.map((l) => l.end)),
  };
}

export function junctionPathSlots(diagram, path) {
  const origin = path.origin === 'HRW' ? diagram.harrow : 0;
  const ends = { SAA: diagram.abbeyEnd };
  for (const line of diagram.dcLines) ends[line.id + 'Edge'] = line.start;
  return path.slots.map(([slot, lane]) => [typeof slot === 'number' ? origin + slot : ends[slot], lane]);
}

// Fit labels independently in each horizontal band of the diagram. The station
// marker always stays under its label, including at the edge of the viewport.
export function fitStationNames(items, left, right, measure) {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  function forms(station) {
    const words = station.name.split(' ');
    const prefix = (w, n) => (w.length > n + 1 ? w.slice(0, n) + '.' : w);
    const shorten = (n) => [words[0], ...words.slice(1).map((w) => prefix(w, n))].join(' ');
    const shorter =
      words.length > 1
        ? [
            [...words.slice(0, -1), prefix(words.at(-1), 3)].join(' '),
            shorten(3),
            shorten(1),
            words[0] +
              ' ' +
              words
                .slice(1)
                .map((w) => w[0])
                .join(''),
          ]
        : [prefix(words[0], 5), prefix(words[0], 3)];
    return [...new Set([station.name, ...shorter, station.code])];
  }
  function pack(row, size, abbreviate, centred = false) {
    const gap = 6;
    let states = [{ end: left - gap, cost: 0 }];
    for (const item of row) {
      const next = [];
      const names = abbreviate ? forms(item.station) : [item.station.name];
      for (const [rank, label] of names.entries()) {
        // Pack the whole sign, including four units of padding on each side.
        const width = measure(label, size) + 8;
        const inset = Math.min(width / 2, 3);
        const preferred = Math.max(left, Math.min(right - width, item.x - width / 2));
        const slack = centred ? 3 : width / 2;
        const earliest = Math.max(left, item.x - width + inset, preferred - slack);
        const latest = Math.min(right - width, item.x - inset, preferred + slack);
        for (const prev of states) {
          const start = Math.max(earliest, prev.end + gap);
          if (start > latest) continue;
          // Exhaust readable names before using a CRS code. Among names,
          // favour keeping more of them completely spelled out.
          const cost = prev.cost + (rank ? 1000 + rank + (label === item.station.code ? 50000 : 0) : 0);
          next.push({ end: start + width, cost, prev, item, label, width, size, earliest, latest });
        }
      }
      // Only keep alternatives that save width or improve the spelling.
      let bestCost = Infinity;
      states = next
        .sort((a, b) => a.end - b.end || a.cost - b.cost)
        .filter((candidate) => {
          if (candidate.cost >= bestCost) return false;
          bestCost = candidate.cost;
          return true;
        });
      if (!states.length) return null;
    }
    const chosen = [];
    let limit = right;
    for (let s = states.at(-1); s.prev; s = s.prev) {
      const latest = Math.min(s.latest, limit - s.width);
      chosen.unshift({ ...s.item, label: s.label, width: s.width, size, earliest: s.earliest, latest });
      limit = latest - gap;
    }
    let end = left - gap;
    return chosen.map((s) => {
      const start = Math.max(end + gap, s.earliest, Math.min(s.latest, s.x - s.width / 2));
      end = start + s.width;
      return { ...s, labelX: start + s.width / 2 };
    });
  }
  const single = pack(sorted, 15, false, true) ?? pack(sorted, 13, false, true);
  if (single) return single.map((s) => ({ ...s, row: 0 }));
  return [0, 1].flatMap((row) => {
    const entries = sorted.filter((s, i) => i % 2 === row);
    const placed =
      pack(entries, 13, false) ??
      pack(entries, 12, false) ??
      pack(entries, 11, true) ??
      pack(entries, 10, true);
    return (placed ?? []).map((s) => ({ ...s, row }));
  });
}
