// Build-time only. The device consumes const geometry and timestamped marker changes.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Corridor,
  berthDiagram,
  corridorTracks,
  fitStationNames,
  junctionPathSlots,
  withStationReports,
} from '../rail.mjs';
import { cardCandidates, describeCard, hemelBerths, hemelTrains, isTrainCode } from '../public/hemel.mjs';

const [width, height] = process.argv.slice(2, 4).map(Number);
if (![width, height].every(Number.isInteger) || width < 480 || height < 272 || width > 4096 || height > 2160)
  throw Error('Choose a width of 480–4096 and a height of 272–2160 pixels.');
const data = (file) => JSON.parse(readFileSync(new URL('../public/data/' + file + '.json', import.meta.url)));
const layout = data('corridor'),
  diagram = berthDiagram(layout);
const home = diagram.columns.get('HML'),
  round = Math.round;
const markers = corridorTracks(layout).flatMap((track) => track.berths.map((b) => ({ ...b, track })));
const stationBerths = hemelBerths(layout);
const out = ['// Generated from corridor.json, the panel stylesheet and bundled recordings.'];
const c = (value) => (Array.isArray(value) ? '{' + value.map(c).join(', ') + '}' : JSON.stringify(value));
function array(type, name, rows) {
  out.push(
    'static constexpr ' +
      type +
      ' ' +
      name +
      '[] = {\n' +
      rows.map((row) => '  ' + c(row)).join(',\n') +
      '\n};',
  );
}
out.push(
  'static constexpr int panelWidth = ' +
    width +
    ', panelHeight = ' +
    height +
    ', markerCount = ' +
    markers.length +
    ';',
);
const colours = [
  'board',
  'board-text',
  'board-muted',
  'rail',
  'platform',
  'route-dc',
  'route-abbey',
  'route-bay',
  'station-band',
  'hemel-band',
  'junction-band',
  'control-edge',
  'hemel-edge',
  'signal-on',
  'signal-off',
  'signal-unknown',
  'train-fill',
  'train-text',
  'other-description',
  'stale-description',
];
const colour = (name) => {
  const index = colours.indexOf(name);
  if (index < 0) throw Error('Unknown colour ' + name);
  return index;
};
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
for (const [name, selector] of [
  ['dark', '.panel {'],
  ['light', ".panel[data-theme='light'] {"],
]) {
  const rules = css.split(selector)[1].split('}')[0];
  const values = colours.map((k) => '0x' + rules.match(new RegExp('--' + k + ': #([a-f0-9]{6})'))[1]);
  out.push('static constexpr uint32_t ' + name + 'Palette[] = {' + values.join(', ') + '};');
}

// Match the browser's diagram-only coordinate system. Fonts are quantised to the
// native sizes; the shared label fitter still prefers the full station names.
function compileView(view) {
  const merged = view !== 'hemel',
    natural = merged ? 592 : 368;
  const scale = Math.min(width / 840, height / (natural * 0.82), 1.5);
  const mapWidth = width / scale,
    vertical = height / natural;
  const zoom = view === 'sector' ? 1008 / ((diagram.end - diagram.start) * 64) : view === 'hemel' ? 1 : 2;
  const centre = view === 'sector' ? (diagram.start + diagram.end) / 2 : view === 'hemel' ? home : 0;
  const pitch = (64 * zoom * (mapWidth - 132)) / 1008;
  const x = (slot) => (111 + (mapWidth - 132) / 2 + (slot - centre) * pitch) * scale;
  const left = 103 * scale,
    right = width - scale;
  const visible = (at) => at >= 109 * scale && at <= width - 19 * scale;
  const lane = (n) => (64 + 44 * n) * vertical;
  const mainY = (i) => (merged ? lane(5 + i) : (97 + i * 66) * vertical);
  const segments = [],
    labels = [],
    placed = [];
  function line(x1, y1, x2, y2, ink, weight = 2) {
    // Clip diagonals and horizontal tracks at the reserved track-name margin.
    if (x1 > x2) return line(x2, y2, x1, y1, ink, weight);
    if (x2 < left || x1 > right) return;
    const slope = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);
    if (x1 < left) {
      y1 += (left - x1) * slope;
      x1 = left;
    }
    if (x2 > right) {
      y2 -= (x2 - right) * slope;
      x2 = right;
    }
    segments.push([
      round(x1),
      round(y1),
      round(x2),
      round(y2),
      colour(ink),
      Math.max(1, round(weight * scale)),
    ]);
  }
  function label(cx, cy, text, pixels, boxWidth, fg = 'board-text', bg = null) {
    const font = Math.min(16, Math.max(8, round(pixels / 2) * 2));
    labels.push([round(cx), round(cy), round(boxWidth), font, colour(fg), bg ? colour(bg) : -1, text]);
  }
  function names(stations, y, rowStep) {
    let top = y;
    const items = stations
      .map((station) => ({ station, x: x(diagram.columns.get(station.code)) / scale }))
      .filter((s) => visible(s.x * scale));
    const measure = (text, size) => (text.length * Math.max(8, round((size * scale) / 2) * 2) * 0.63) / scale;
    for (const item of fitStationNames(items, 105, mapWidth - 4, measure)) {
      const cy = y + rowStep * item.row - (item.size * scale) / 2;
      const bg = item.station.code === 'HML' ? 'hemel-band' : 'board';
      label(item.labelX * scale, cy, item.label, item.size * scale, item.width * scale, 'board-text', bg);
      top = Math.min(top, cy - ((item.size + 4) * scale) / 2);
    }
    return top;
  }
  const topStations = [],
    mainStations = [],
    [dc, abbey] = layout.branches;
  const stations = layout.stations.filter(
    (s) => visible(x(diagram.columns.get(s.code))) && (merged || ['APS', 'HML', 'BKM'].includes(s.code)),
  );
  for (const s of stations) {
    const at = x(diagram.columns.get(s.code)),
      junction = merged && s.code === 'WFJ';
    const shared = merged && dc.stations.some((stop) => stop.code === s.code);
    (merged && !shared ? mainStations : topStations).push(s);
    line(
      at,
      junction ? 50 * vertical : (shared ? lane(2) : mainY(0)) - 26 * scale,
      at,
      (junction ? lane(10) : mainY(3)) + 24 * scale,
      junction ? 'junction-band' : s.code === 'HML' ? 'hemel-band' : 'station-band',
      junction ? 1.5 * pitch : 24,
    );
  }
  names(topStations, 20 * vertical, Math.max(22 * scale, 21 * vertical));
  const fastBottom = names(mainStations, mainY(0) - (zoom < 0.6 ? 31 : 39) * scale, -22 * scale);
  for (const [i, t] of layout.tracks.entries()) {
    const y = mainY(i);
    line(x(diagram.main[i].start), y, x(diagram.main[i].end), y, 'rail');
    label(47 * scale, y, t.name, 12 * scale, 90 * scale);
    for (const s of stations) {
      if (merged && s.code === 'WFJ') continue;
      const at = x(diagram.columns.get(s.code));
      line(at - 11 * scale, y + 6 * scale, at + 11 * scale, y + 6 * scale, 'platform', 3.5);
    }
  }
  if (merged) {
    for (const path of layout.junction.paths) {
      const points = junctionPathSlots(diagram, path);
      for (let i = 1; i < points.length; i++) {
        const [a, b] = points[i - 1],
          [d, e] = points[i];
        line(x(a), lane(b), x(d), lane(e), 'route-' + path.route, 2.3);
      }
    }
    for (const branch of [dc, abbey]) {
      const isDC = branch.id === 'dc',
        ink = 'route-' + branch.id;
      for (const s of branch.stations.filter((s) => s.code !== 'WFJ')) {
        const at = x(diagram.columns.get(s.code));
        for (const n of isDC ? [2, 3] : [10])
          line(at - 5 * scale, lane(n) + 5 * scale, at + 5 * scale, lane(n) + 5 * scale, ink, 3);
      }
      const labels = branch.stations.filter((s) => !layout.stations.some((m) => m.code === s.code));
      const y = isDC
        ? Math.max(65 * vertical, 20 * vertical + 44 * scale, 41 * vertical + 22 * scale)
        : Math.max(lane(10) + 41 * scale, 536 * vertical);
      names(labels, y, Math.max(22 * scale, (isDC ? 89 : 556) * vertical - y));
    }
    layout.junction.platforms.forEach((p, i) => {
      if (!visible(x(0))) return;
      const y = lane(i + 1),
        ink = i < 4 ? 'route-dc' : i === 9 ? 'route-abbey' : 'platform';
      line(x(-0.75), y + 6 * scale, x(0.75), y + 6 * scale, ink, 4);
      label(x(0), y + 18 * scale, 'P' + p.number, 11 * scale, 35 * scale, ink);
      if (i < 4 || p.number === '10') line(x(1), y - 4 * scale, x(1), y + 4 * scale, ink);
    });
    for (const [n, t, ink] of [
      [1, 'Watford DC', 'route-dc'],
      [2, '> Down DC', 'route-dc'],
      [3, '< Up DC', 'route-dc'],
      [9, 'Bay', 'route-bay'],
      [10, 'Abbey line', 'route-abbey'],
    ])
      label(48 * scale, lane(n), t, 12 * scale, 93 * scale, ink);
  }
  label(left + 55 * scale, height - 13 * scale, '< LONDON EUSTON', 10 * scale, 115 * scale, 'board-muted');
  label(width - 70 * scale, height - 13 * scale, 'MILTON KEYNES >', 10 * scale, 134 * scale, 'board-muted');
  for (const [index, b] of markers.entries()) {
    const at = x(diagram.positions.get(b.id)),
      branch = b.track.branch;
    if (!visible(at) || (!merged && (branch || !b.pilot))) continue;
    const n = b.platform
      ? layout.junction.platforms.findIndex((p) => p.number === b.platform) + 1
      : branch === 'abbey'
        ? 10
        : b.track.id === 'harrow'
          ? 2.5
          : b.track.id === 'down'
            ? 2
            : 3;
    const y = branch ? lane(n) : mainY(layout.tracks.findIndex((t) => t.id === b.track.id));
    const small = zoom < (branch ? 1.7 : 0.6);
    placed.push([
      index,
      round(at),
      round(y),
      round(y - (small ? 15 : 17) * scale),
      b.bit ? Math.max(2, round((small ? 2.7 : 5.3) * scale)) : 0,
    ]);
  }
  placed.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  array('Segment', view + 'Lines', segments);
  array('Label', view + 'Labels', labels);
  array('Marker', view + 'Markers', placed);
  const anchor = visible(x(home)) ? x(home) : width / 2;
  out.push(
    'static constexpr Scene ' +
      view +
      'Scene = {list(' +
      view +
      'Lines), list(' +
      view +
      'Labels), list(' +
      view +
      'Markers), ' +
      [
        anchor,
        merged ? Math.max(4, Math.min(x(1) + 8, width - 280)) : 4,
        fastBottom - 6,
        mainY(3) + 15 * scale,
        merged ? lane(10) - 13 * scale : height - 5,
        50 * scale,
        21 * scale,
      ]
        .map(round)
        .join(', ') +
      '};',
  );
}
for (const view of ['sector', 'hemel', 'watford']) compileView(view);

const cards = [['', '', '', '', 0]],
  cardIds = new Map(),
  identities = new Map();
function cardId(t) {
  const d = describeCard(t),
    key = [t.track, t.head, t.service?.id, t.stage].join('/');
  if (!identities.has(key)) identities.set(key, identities.size + 1);
  const ascii = (s) => s.replaceAll(' → ', ' to ').replaceAll(' · ', '  |  ').replaceAll('½', '.5');
  const row = [
    d.head,
    ascii(d.context),
    ascii(d.route),
    ascii([d.company, d.timing].filter(Boolean).join(' · ')),
    identities.get(key),
  ];
  const signature = c(row);
  if (!cardIds.has(signature)) {
    cardIds.set(signature, cards.length);
    cards.push(row);
  }
  return cardIds.get(signature);
}
for (const [name, file] of [
  ['sector', 'replay'],
  ['hemel', 'hemel-replay'],
  ['watford', 'watford-replay'],
]) {
  const recording = data(file),
    board = new Corridor(layout);
  const start = recording.startTime ?? recording.frames[0].time;
  const changes = [],
    frames = [],
    previous = markers.map(() => [0, 0, '']);
  let previousCards = '';
  for (const frame of recording.frames) {
    board.apply(frame);
    const state = withStationReports(board);
    const fresh = (a) => (a === 'AB' ? !!state.abbey?.available : !!state.areaTimes[a]);
    const oldEnd = changes.length;
    for (const [i, b] of markers.entries()) {
      const head = state.values[b.id] || '',
        current = fresh(b.id.slice(0, 2));
      const aspect = current ? ({ on: 1, off: 2 }[state.values[b.bit]] ?? 0) : 0;
      const kind = !head ? 0 : !current ? 3 : isTrainCode(head) ? 1 : 2;
      const old = previous[i];
      if (aspect === old[0] && kind === old[1] && head === old[2]) continue;
      previous[i] = [aspect, kind, head];
      changes.push([i, aspect, kind, head]);
    }
    const groups = fresh('R1') ? hemelTrains(stationBerths, state, fresh) : { fast: [], slow: [] };
    const ids = Object.values(groups).flatMap((trains) => {
      const matches = cardCandidates(trains, (svc) =>
        svc && recording.hemelCalls?.[svc.id]?.uid === svc.uid ? recording.hemelCalls[svc.id] : null,
      );
      return [matches[0] ? cardId(matches[0]) : 0, matches[1] ? cardId(matches[1]) : 0];
    });
    if (!frames.length || changes.length !== oldEnd || ids.join() !== previousCards)
      frames.push([Math.max(0, frame.time - start), changes.length, ids]);
    previousCards = ids.join();
  }
  array('Change', name + 'Changes', changes);
  array('Frame', name + 'Frames', frames);
  out.push(
    'static constexpr Recording ' +
      name +
      'Recording = {list(' +
      name +
      'Changes), list(' +
      name +
      'Frames), ' +
      (recording.frames.at(-1).time - start) +
      '};',
  );
}
array('Card', 'cards', cards);
writeFileSync(process.argv[4], out.join('\n') + '\n');
