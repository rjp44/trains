import {panelSettings, settingGroup} from './panel/settings.mjs';
import {mapGestures} from './panel/gestures.mjs';
import {readSetting, saveSetting} from './panel/appearance.mjs';
import {
  routes,
  order,
  project,
  railBearing,
  railTransitions,
  confirmedRailStop,
  visibleFixes,
  londonTime,
  freshMs,
} from './model.mjs';
import { Timetable, hhmm, stopTitle, serviceSeconds, journeySummary } from './timetable.mjs';
import { BusPaths, vehicleView, placeVehicles } from './bus-layout.mjs';

const $ = (id) => document.getElementById(id);
const svg = $('map'),
  ns = 'http://www.w3.org/2000/svg';
function shape(tag, attrs, parent, label) {
  const el = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (label != null) el.textContent = label;
  parent.append(el);
  return el;
}
function text(tag, value, cls) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (cls) el.className = cls;
  return el;
}
async function get(url) {
  if (globalThis.transportApp && url.startsWith('/data/')) return transportApp.json(url);
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw Error('Unavailable');
  return res.json();
}
const [data, { lines: railways }, schedule] = await Promise.all([
  get('/data/map.json'),
  get('/data/rail.json'),
  get('/data/timetable.json').catch(() => null),
]);
const timetable = schedule && new Timetable(schedule);
const { frame } = data;
const busPaths = new BusPaths(timetable, point => project(point, frame));
const routeMatches = new WeakMap();
const [W, H] = [frame.width, frame.height];
const positions = [
  ['Keswick', -3.139, 54.601, 0, -9, 1],
  ['Pooley Bridge', -2.821, 54.612, 8, -4],
  ['Glenridding', -2.952, 54.544, 7, -4],
  ['Patterdale', -2.935, 54.534, 8, 8],
  ['Dungeon Ghyll', -3.102, 54.445, -4, -8],
  ['Grasmere', -3.023, 54.458, 0, -9],
  ['Ambleside', -2.963, 54.431, 8, 3, 1],
  ['Hawkshead', -3.0, 54.375, -7, -4],
  ['Coniston', -3.074, 54.369, -6, -2],
  ['Bowness', -2.922, 54.365, -7, 5],
  ['Workington', -3.546, 54.644, 6, -8, 1],
  ['Cockermouth', -3.366, 54.664, 0, -9],
  ['Bassenthwaite', -3.2, 54.679, 0, -9],
];
const path = (points) => 'M' + points.map((p) => p.join(',')).join('L');
const multi = (lines) => lines.map(path).join('');
let fitOnResize = true,
  zoom = globalThis.transportApp?.manifest?.defaultZoom ?? 1,
  cx = W / 2,
  cy = H / 2,
  selection = null,
  selectedStop = null, expandedGap = -1;
// An empty set represents the All chip. The first route chip starts a custom selection.
const selectedRoutes = new Set();
const routeVisible = (id) => !selectedRoutes.size || selectedRoutes.has(id);
const stopVisible = (id) => [...timetable.routesAt[id]].some(routeVisible);
let mode = 'live',
  snapshot = null,
  replay = null,
  frameIndex = 0,
  playing = false,
  generation = 0,
  polling = null,
  replayTimer = null;
let previewing = false;
const recorded = () => mode === 'replay' || previewing;
let fixes = [],
  fetchFailed = false;

const bleedX = frame.bleedX ?? frame.bleed,
  bleedY = frame.bleedY ?? frame.bleed;
shape(
  'image',
  {
    href: globalThis.transportApp ? await transportApp.asset('/data/relief.webp', 'image/webp') : '/data/relief.webp',
    x: -bleedX,
    y: -bleedY,
    width: W + 2 * bleedX,
    height: H + 2 * bleedY,
    class: 'relief',
  },
  svg,
);
shape(
  'path',
  { d: data.lakes.map((rings) => rings.map((r) => path(r) + 'Z').join('')).join(''), class: 'lake' },
  svg,
);
shape('path', { d: multi(data.roads), class: 'road', 'stroke-width': 0.65 }, svg);
const paths = new Map(),
  group = shape(
    'g',
    { class: 'route-lines', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    svg,
  );
for (const key of order) {
  const railway = railways[key];
  const tunnelStart = key === 'coast' ? railway.stations.find((s) => s.code === 'CKL').vertex : null;
  const d = railway
    ? path(tunnelStart === null ? railway.track : railway.track.slice(0, tunnelStart + 1))
    : multi(data.routes[key]);
  const g = shape('g', { 'data-route-line': key }, group);
  shape('path', { d, stroke: 'var(--halo)', 'stroke-width': railway ? 4.2 : 3.8 }, g);
  shape('path', { d, stroke: routes[key].colour, 'stroke-width': railway ? 2.7 : 2.2 }, g);
  if (railway) shape('path', { d, stroke: '#fff', 'stroke-width': 1.1, 'stroke-dasharray': '3 4' }, g);
  if (tunnelStart !== null) {
    const tunnel = shape(
      'path',
      {
        d: path(railway.track.slice(tunnelStart)),
        stroke: routes[key].colour,
        'stroke-width': 2.1,
        'stroke-dasharray': '2 4',
      },
      g,
    );
    shape('title', {}, tunnel, 'Bransty Tunnel · rail services suspended in the November 2026 edition');
  }
  paths.set(key, g);
}
// Alternate colours on road links shared by several routes at the overview scale.
const linkSet = new Map();
for (const [route, links] of Object.entries(data.routes)) {
  for (const link of links) {
    const d = path(link),
      ids = linkSet.get(d) || [];
    ids.push(route);
    linkSet.set(d, ids);
  }
}
const shared = shape(
  'g',
  { class: 'route-lines', 'pointer-events': 'none', fill: 'none', 'stroke-width': 2.5 },
  svg,
);
const common = new Map();
for (const [d, ids] of linkSet) {
  if (ids.length < 2) continue;
  const key = ids.join(',');
  common.set(key, (common.get(key) || '') + d);
}
function drawSharedLinks() {
  shared.replaceChildren();
  for (const [key, d] of common) {
    const ids = key.split(',').filter(routeVisible);
    if (ids.length < 2) continue;
    ids.forEach((id, i) =>
      shape(
        'path',
        {
          d,
          stroke: routes[id].colour,
          'stroke-dasharray': '4 ' + 4 * (ids.length - 1),
          'stroke-dashoffset': -4 * i,
        },
        shared,
      ),
    );
  }
}
drawSharedLinks();
const places = shape('g', { 'pointer-events': 'none' }, svg),
  stopsLayer = shape('g', { 'aria-label': 'Bus stops' }, svg),
  markers = shape('g', { 'aria-label': 'Vehicles' }, svg);
const stops =
  timetable?.groups
    .map((g, id) => {
      const points = g.refs.map((ref) => project(timetable.stops[ref].point, frame));
      const point = [0, 1].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
      return { id, name: stopTitle(g), point, weight: timetable.boards[id].length };
    })
    .sort((a, b) => b.weight - a.weight) || [];

function fillStopPicker() {
  const picker = $('stop-picker');
  picker.length = 1;
  picker.disabled =
    !timetable || (selectedRoutes.size > 0 && [...selectedRoutes].every((key) => railways[key]));
  if (!timetable) picker.options[0].text = 'Timetable unavailable';
  for (const s of stops.filter((s) => stopVisible(s.id)).sort((a, b) => a.name.localeCompare(b.name)))
    picker.add(new Option(s.name, s.id));
  if (selectedStop !== null) picker.value = String(selectedStop);
}
function openStop(id, centre) {
  selection = null;
  selectedStop = id;
  if (recorded()) runReplay(false);
  $('stop-picker').value = String(id);
  if (centre) {
    fitOnResize = false;
    [cx, cy] = stops.find((s) => s.id === id).point;
    zoom = Math.max(zoom, 6);
  }
  viewport();
  detail();
  $('vehicle-info').focus({ preventScroll: true });
}
$('stop-picker').onchange = (e) => {
  if (e.target.value !== '') { settings.close(); openStop(Number(e.target.value), true); saveView(); }
  else $('close').click();
};
fillStopPicker();

function drawStops(unit) {
  const active = document.activeElement?.dataset?.stop;
  stopsLayer.replaceChildren();
  const visible = [];
  const halfWidth = (svg.clientWidth / 2 + 5) * unit,
    halfHeight = (svg.clientHeight / 2 + 5) * unit;
  const ordered =
    selectedStop === null
      ? stops
      : [stops.find((s) => s.id === selectedStop), ...stops.filter((s) => s.id !== selectedStop)];
  for (const s of ordered) {
    if (!stopVisible(s.id)) continue;
    const [x, y] = s.point;
    if (Math.abs(cx - x) > halfWidth || Math.abs(cy - y) > halfHeight) continue;
    if (visible.some(([px, py]) => Math.hypot(px - x, py - y) < 22 * unit)) continue;
    visible.push(s.point);
    const g = shape(
      'g',
      {
        role: 'button',
        tabindex: 0,
        'data-stop': s.id,
        'aria-label': 'Departures from ' + s.name,
        transform: 'translate(' + x + ' ' + y + ') scale(' + unit + ')',
      },
      stopsLayer,
    );
    shape('title', {}, g, s.name + ' · Scheduled departures');
    shape('circle', { r: 12, fill: 'transparent' }, g);
    shape(
      'circle',
      {
        r: selectedStop === s.id ? 5 : 3.4,
        fill: 'var(--card)',
        stroke: selectedStop === s.id ? '#ce731d' : 'var(--town)',
        'stroke-width': 1.45,
      },
      g,
    );
    g.onclick = () => openStop(s.id, false);
    g.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openStop(s.id, false);
      }
    };
    if (active === String(s.id)) g.focus({ preventScroll: true });
  }
}
const dots = shape('g', { class: 'place-points' }, places),
  labels = shape('g', {}, places);
const townLabels = [];
let labelBoxes = [];
const collides = (a, b) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
function place(name, point, dx, dy, major = false, station = false, railRoute = null, minZoom = 1) {
  const [x, y] = point;
  const dot = shape(
    station ? 'rect' : 'circle',
    station
      ? {
          x: x - 2.3,
          y: y - 2.3,
          width: 4.6,
          height: 4.6,
          rx: 0.8,
          fill: 'var(--halo)',
          stroke: 'var(--town)',
          'stroke-width': 1.3,
        }
      : { cx: x, cy: y, r: 1.9, fill: 'var(--town)', stroke: 'var(--halo)', 'stroke-width': 0.8 },
    dots,
  );
  const label = shape(
    'text',
    {
      x: x + dx,
      y: y + dy,
      'text-anchor': dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle',
      class: station && !major ? 'station-label' : 'place' + (major ? ' major' : ''),
    },
    labels,
    name,
  );
  townLabels.push({ label, dot, x, y, dx, dy, major, railRoute, minZoom });
}
for (const [name, lon, lat, dx, dy, major] of positions)
  place(name, project([lon, lat], frame), dx, dy, major);
const stationOffsets = { WDM: [8, -12, 1], SVL: [2, 14], BUD: [6, -2], KEN: [8, 7, 1], OXN: [7, 10] };
const coastalHubs = new Set(['LAN', 'WTH', 'BIF', 'ULV', 'GOS']);
const stationNames = {
  CAR: 'Carlisle',
  OXN: 'Oxenholme',
  BIF: 'Barrow-in-Furness',
  GOS: 'Grange-over-Sands',
  KBF: 'Kirkby-in-Furness',
  CAK: 'Cark & Cartmel',
  RAV: 'Ravenglass',
};
for (const [key, line] of Object.entries(railways)) {
  for (const s of line.stations) {
    if (key === 'wcml' && (s.code === 'LAN' || s.code === 'OXN')) continue;
    const hub = coastalHubs.has(s.code) || ['OXN', 'CAR', 'PNR'].includes(s.code);
    const [dx, dy, major] = stationOffsets[s.code] || [5, -5, hub];
    // Keep interchanges visible on the bus map. Small coastal stations appear on zoom or route selection.
    place(
      stationNames[s.code] || s.name,
      s.point,
      dx,
      dy,
      major,
      true,
      hub ? null : key,
      key === 'coast' && !hub ? 2 : 1,
    );
  }
}
function saveView() {
  saveSetting('lakes.view',{routes:[...selectedRoutes], zoom, cx, cy, fit:fitOnResize});
}
for (const key of order) {
  const r = routes[key];
  const button = text('button', r.chip || key, 'route');
  button.dataset.route = key;
  button.style.setProperty('--accent', r.colour);
  button.setAttribute('aria-pressed', 'false');
  button.ariaLabel = railways[key] ? r.name + ' · ' + r.via : 'Bus ' + key + ' · ' + r.name;
  button.title = button.ariaLabel;
  button.onclick = () => {
    if (selectedRoutes.has(key)) selectedRoutes.delete(key);
    else selectedRoutes.add(key);
    applyRoutes();
  };
  $('routes').append(button);
}
function fitRoutes() {
  fitOnResize = true;
  zoom = 1;
  cx = W / 2;
  cy = H / 2;
  if (selectedRoutes.size) {
    const b = group.getBBox();
    const scale = Math.min(svg.clientWidth / W, svg.clientHeight / H);
    zoom = Math.max(
      1,
      Math.min(
        24,
        svg.clientWidth / (scale * (b.width + 70)),
        svg.clientHeight / (scale * (b.height + 90)),
      ),
    );
    cx = b.x + b.width / 2;
    cy = b.y + b.height / 2;
  }
  viewport();
}
function applyRoutes() {
  for (const [id, g] of paths) g.style.display = routeVisible(id) ? '' : 'none';
  $('show-all').setAttribute('aria-pressed', String(selectedRoutes.size === 0));
  for (const b of $('routes').querySelectorAll('[data-route]')) {
    b.setAttribute('aria-pressed', String(selectedRoutes.has(b.dataset.route)));
  }
  if (selectedStop !== null && !stopVisible(selectedStop)) selectedStop = null;
  fillStopPicker();
  drawSharedLinks();
  fitRoutes();
  saveView();
  render();
}
$('show-all').onclick = () => {
  selectedRoutes.clear();
  applyRoutes();
};
$('view-toggle').onclick = () => {
  const fullMap = document.body.classList.toggle('map-only');
  $('view-toggle').ariaLabel = fullMap ? 'Show dashboard' : 'Expand map';
  $('view-toggle').textContent = $('view-toggle').title = $('view-toggle').ariaLabel;
  settings.close();
  window.scrollTo(0, 0);
  viewport();
};
function viewport() {
  const w = W / zoom,
    h = H / zoom;
  cx = Math.min(W - w / 2, Math.max(w / 2, cx));
  cy = Math.min(H - h / 2, Math.max(h / 2, cy));
  svg.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].join(' '));
  $('plus').disabled = zoom >= 24;
  $('minus').disabled = zoom <= 1;
  const matrix = svg.getScreenCTM();
  const labelScale = zoom / Math.min(1.35, Math.sqrt(zoom));
  dots.style.setProperty('--point-scale', 1 / labelScale);
  if (matrix) {
    const km = zoom >= 12 ? 0.5 : zoom >= 6 ? 1 : zoom >= 3 ? 2 : 5;
    $('scale').style.width = ((km * frame.units) / 111.2) * matrix.a + 'px';
    $('scale').textContent = km + ' km';
  }
  for (const e of labels.children) {
    const cls = e.getAttribute('class');
    const base = cls.includes('major') ? 16 : cls.includes('station-label') ? 10 : 12;
    e.style.fontSize = base / labelScale + 'px';
  }
  labelBoxes = [];
  const matrixScale = matrix?.a || 1;
  for (const { label, dot, x, y, dx, dy, railRoute, minZoom } of [...townLabels].sort(
    (a, b) => Number(b.major) - Number(a.major),
  )) {
    const visible =
      (!railRoute || routeVisible(railRoute)) && (zoom >= minZoom || selectedRoutes.has(railRoute));
    dot.style.display = visible ? '' : 'none';
    if (!visible) {
      label.style.visibility = 'hidden';
      continue;
    }
    const offsets = [
      [dx, dy],
      [-dx, dy],
      [0, -9],
      [0, 15],
      [8, 9],
      [-8, 10],
      [4, -16],
    ];
    label.style.visibility = 'hidden';
    for (const [ox, oy] of offsets) {
      label.setAttribute('x', x + ox / labelScale);
      label.setAttribute('y', y + oy / labelScale);
      label.setAttribute('text-anchor', ox < 0 ? 'end' : ox > 0 ? 'start' : 'middle');
      const b = label.getBBox(),
        pad = 1.5 / matrixScale,
        box = [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad];
      if (labelBoxes.some((r) => collides(box, r))) continue;
      label.style.visibility = 'visible';
      labelBoxes.push(box);
      break;
    }
  }
  drawStops(1 / matrixScale);
  drawMarkers();
  placeDetail();
}
function changeZoom(factor, anchor = [cx, cy]) {
  const next = Math.max(1, Math.min(24, zoom * factor)),
    ratio = zoom / next;
  if (next === zoom) return;
  fitOnResize = false;
  cx = anchor[0] + (cx - anchor[0]) * ratio;
  cy = anchor[1] + (cy - anchor[1]) * ratio;
  zoom = next;
  viewport();
  saveView();
}
$('plus').onclick = () => changeZoom(1.5);
$('minus').onclick = () => changeZoom(1 / 1.5);
$('reset').onclick = () => {fitRoutes(); saveView();};
function world(event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}
svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    changeZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, world(e));
  },
  { passive: false },
);
mapGestures(svg, {
  drag(from,to) {
    if (!$('vehicle').hidden || zoom === 1) return;
    const scale = svg.getScreenCTM().a;
    cx -= (to.x - from.x) / scale; cy -= (to.y - from.y) / scale;
    fitOnResize = false; viewport();
  },
  pinch(from,to) {
    if (Math.abs(to.span - from.span) < 1 && Math.hypot(to.x-from.x,to.y-from.y) < 1) return false;
    if (!$('vehicle').hidden) dismissDetail(false);
    const next = Math.max(1, Math.min(24, zoom * to.span / from.span)), ratio = zoom / next;
    const anchor = world({clientX:from.x, clientY:from.y}), scale = svg.getScreenCTM().a / ratio;
    cx = anchor[0] + (cx - anchor[0])*ratio - (to.x-from.x)/scale;
    cy = anchor[1] + (cy - anchor[1])*ratio - (to.y-from.y)/scale;
    zoom = next; fitOnResize = false; viewport(); return true;
  },
  finish:saveView
});
function inspect(id) {
  const fix = fixes.find((v) => v.id === id);
  const marker = markers.querySelector('[data-vehicle="' + CSS.escape(id) + '"] > use');
  if (fix && marker) {
    const m = marker.getBoundingClientRect(),
      bounds = svg.getBoundingClientRect();
    if (m.right < bounds.left || m.left > bounds.right || m.bottom < bounds.top || m.top > bounds.bottom) {
      [cx, cy] = project(fix.point, frame);
      fitOnResize = false;
    }
  }
  selection = id;
  selectedStop = null;
  $('stop-picker').value = '';
  if (recorded()) runReplay(false);
  viewport();
  detail();
  $('vehicle-info').focus({ preventScroll: true });
}
function drawBoard(body, now) {
  const group = timetable.groups[selectedStop];
  body.append(text('span', 'Bus stop · ' + group.town, 'kicker'), text('strong', group.name));
  const board = timetable.departures(selectedStop, now, selectedRoutes.size ? selectedRoutes : null);
  if (!board.covered) {
    body.append(text('p', 'No timetable published here for this date.'));
    return;
  }
  body.append(
    text(
      'small',
      'Scheduled departures · ' +
        (recorded() ? 'Replay ' : '') +
        londonTime(now).slice(0, 5) +
        ' London · ≈ approximate',
    ),
  );
  const list = text('div', '', 'schedule-list');
  body.append(list);
  const sections = [...board.sections].sort((a, b) => (a[1][0]?.at ?? Infinity) - (b[1][0]?.at ?? Infinity));
  if (!sections.length) list.append(text('p', 'No boarding departures at this stop.'));
  for (const [via, calls] of sections) {
    list.append(text('h3', 'Towards ' + timetable.groups[via].name));
    if (!calls.length)
      list.append(text('small', 'No departures in the next seven days of the published timetable.'));
    for (const call of calls) {
      const row = text('div', '', 'departure-row');
      const badge = text('b', call.trip.route, 'line-number');
      badge.style.backgroundColor = routes[call.trip.route].colour;
      const dest = text('span', call.trip.destination);
      const pole = timetable.stops[call.ref];
      const boarding = [pole.name === group.name ? '' : pole.name, pole.side].filter(Boolean).join(' · ');
      if (boarding) dest.append(text('small', boarding));
      row.append(text('time', (call.exact ? '' : '≈') + call.time), badge, dest);
      list.append(row);
    }
  }
}
function journeyRow(list, name, time, note, secondary = false) {
  const row = text('div', '', 'journey-row' + (secondary ? ' intermediate' : ''));
  const location = text('span', name, 'stop-name');
  if (note) location.append(text('small', note));
  row.append(text('time', time), location);
  list.append(row);
  return row;
}
function drawJourney(body, v, trip, now) {
  if (!trip) {
    body.append(text('p', 'No matching published timetable.'));
    return;
  }
  const calls = timetable.patterns[trip.pattern]
    .filter((c) => c[3] || c[5])
    .map(([ref, arr, dep, pickup, exact]) => {
      const pole = timetable.stops[ref],
        group = timetable.groups[pole.group];
      return {
        name: pole.name,
        town: group.town,
        exact,
        at: trip.start + (pickup ? dep : arr),
        routes: timetable.routesAt[pole.group].size,
      };
    });
  if (!calls.length) {
    body.append(text('p', 'No scheduled passenger calls.'));
    return;
  }
  const seconds = serviceSeconds(now, v.serviceDate || timetable.serviceDay(v.departure));
  const kept = journeySummary(calls, seconds),
    last = calls.length - 1;
  const finished = calls[last].at < seconds;
  body.append(text('h3', finished ? 'Scheduled journey ended' : 'Scheduled stops'));
  const list = text('div', '', 'schedule-list journey-list');
  body.append(list);
  let lastTown;
  function add(i, primary, group) {
    const s = calls[i],
      notes = [];
    if (i === kept[0] && !finished) notes.push('Next scheduled stop');
    if (i === last) notes.push('Terminus');
    else if (s.town && s.town !== lastTown && !s.name.includes(s.town)) notes.push(s.town);
    lastTown = s.town;
    return journeyRow(group, s.name, (s.exact ? '' : '≈') + hhmm(s.at), notes.join(' · '), !primary);
  }
  kept.forEach((i, k) => {
    const row = add(i, true, list);
    if (k === 0 && !finished) row.classList.add('next-call');
    const hidden = (kept[k + 1] ?? i + 1) - i - 1;
    if (!hidden) return;
    const open = expandedGap === i;
    const button = text('button', String(hidden), 'gap-toggle');
    button.dataset.gap = i;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute(
      'aria-label',
      (open ? 'Hide ' : 'Show ') +
        hidden +
        ' intermediate ' +
        (hidden === 1 ? 'stop' : 'stops') +
        ' after ' +
        calls[i].name,
    );
    button.setAttribute('aria-controls', 'gap-' + i);
    button.onclick = () => {
      expandedGap = open ? -1 : i;
      detail();
    };
    row.append(button);
    const group = text('div', '', 'intermediates');
    group.id = 'gap-' + i;
    group.hidden = !open;
    if (open) for (let n = i + 1; n < kept[k + 1]; ++n) add(n, false, group);
    list.append(group);
  });
}
function markerSelector() {
  return selectedStop !== null
    ? '[data-stop="' + selectedStop + '"]'
    : selection
      ? '[data-vehicle="' + CSS.escape(selection) + '"]'
      : null;
}
function placeDetail() {
  const box = $('vehicle'),
    leader = $('detail-leader');
  leader.hidden = true;
  if (box.hidden) return;
  const selector = markerSelector();
  const target = selector && svg.querySelector(selector + (selectedStop !== null ? ' > circle' : ' > use'));
  if (!target) {
    dismissDetail(false);
    return;
  }
  const map = svg.getBoundingClientRect(),
    mark = target.getBoundingClientRect();
  if (mark.right < map.left || mark.left > map.right || mark.bottom < map.top || mark.top > map.bottom) {
    dismissDetail(false);
    return;
  }
  const ax = (mark.left + mark.right) / 2 - map.left,
    ay = (mark.top + mark.bottom) / 2 - map.top;
  const margin = 8, top = margin;
  const bottom = Math.max(top + 80, map.height - margin);
  box.style.maxHeight = Math.min(470, bottom - top) + 'px';
  const w = box.offsetWidth,
    h = box.offsetHeight;
  const dx = mark.width / 2 + 10,
    dy = mark.height / 2 + 10;
  let best;
  for (const [px, py] of [
    [ax + dx, ay - h / 2],
    [ax - dx - w, ay - h / 2],
    [ax - w / 2, ay - dy - h],
    [ax - w / 2, ay + dy],
  ]) {
    const x = Math.max(margin, Math.min(px, map.width - margin - w)),
      y = Math.max(top, Math.min(py, bottom - h));
    const covers = x < ax + dx - 8 && x + w > ax - dx + 8 && y < ay + dy - 8 && y + h > ay - dy + 8;
    const cost = Math.abs(x - px) + Math.abs(y - py) + (covers ? 10000 : 0);
    if (!best || cost < best.cost) best = { x, y, cost };
  }
  box.style.left = best.x + 'px';
  box.style.top = best.y + 'px';
  const ex = Math.max(best.x + 5, Math.min(ax, best.x + w - 5)),
    ey = Math.max(best.y + 5, Math.min(ay, best.y + h - 5));
  const len = Math.hypot(ex - ax, ey - ay),
    inset = Math.min(len, Math.max(4, Math.min(dx, dy) - 10));
  if (len > inset && ax >= 0 && ay >= 0 && ax <= map.width && ay <= map.height) {
    leader.hidden = false;
    leader.style.left = ax + ((ex - ax) * inset) / len + 'px';
    leader.style.top = ay + ((ey - ay) * inset) / len + 'px';
    leader.style.width = len - inset + 'px';
    leader.style.transform = 'rotate(' + Math.atan2(ey - ay, ex - ax) + 'rad)';
    leader.style.background = box.style.getPropertyValue('--accent');
  }
}
function detail() {
  const v = fixes.find((v) => v.id === selection),
    box = $('vehicle'),
    body = $('vehicle-info');
  const key = v ? [v.id, v.route, v.departure, v.terminus].join('/') : 'stop/' + selectedStop;
  const same = body.dataset.key === key;
  const listBefore = body.querySelector('.schedule-list');
  const scroll = same ? listBefore?.scrollTop || 0 : 0;
  const focusGap = same && body.contains(document.activeElement) ? document.activeElement.dataset.gap : null;
  const focusList = listBefore && listBefore === document.activeElement;
  if (!same) expandedGap = -1;
  const now = recorded() ? snapshot?.time : Date.now();
  box.hidden = (!v && selectedStop === null) || !Number.isFinite(now);
  if (box.hidden) {
    delete body.dataset.key;
    $('detail-leader').hidden = true;
    return;
  }
  body.dataset.key = key;
  body.replaceChildren();
  box.style.setProperty('--accent', v ? routes[v.route].colour : 'var(--active)');
  if (!v) drawBoard(body, now);
  else {
    const rail = railways[v.route],
      trip = !rail && timetable?.match(v);
    const pattern = trip && timetable.patterns[trip.pattern];
    const town = pattern && timetable.groups[timetable.stops[pattern.at(-1)[0]].group].town;
    const header = text('div', '', 'card-meta');
    const status = recorded() ? 'Replay' : v.stale ? 'Stale fix' : 'Live';
    header.append(
      text('b', routes[v.route].chip || v.route, 'service-badge'),
      text(
        'span',
        [v.agency, !rail && v.label?.startsWith('Vehicle ') ? v.label.slice(8) : '']
          .filter(Boolean)
          .join(' ') +
          ' · ' +
          status,
      ),
    );
    body.append(header, text('strong', town || v.destination ? 'To ' + (town || v.destination) : v.label));
    if (rail) {
      body.append(text('h3', 'Rail position estimate'));
      const list = text('div', '', 'schedule-list journey-list');
      body.append(list);
      journeyRow(list, v.last || 'Unavailable', v.lastTime || '—', 'Last reported');
      journeyRow(list, v.next || 'Unavailable', v.nextTime || '—', 'Next station');
    } else drawJourney(body, v, trip, now);
  }
  const list = body.querySelector('.schedule-list');
  if (list) {
    list.tabIndex = 0;
    list.setAttribute('aria-label', selectedStop !== null ? 'Scheduled departures' : 'Journey stops');
    list.scrollTop = scroll;
    const focused = focusGap != null && list.querySelector('[data-gap="' + focusGap + '"]');
    if (focused) focused.focus({ preventScroll: true });
    else if (focusList) list.focus({ preventScroll: true });
  }
  placeDetail();
}
function dismissDetail(restoreFocus) {
  if ($('vehicle').hidden) return;
  const selector = markerSelector();
  selection = null;
  selectedStop = null;
  expandedGap = -1;
  $('stop-picker').value = '';
  detail();
  viewport();
  if (restoreFocus && selector) svg.querySelector(selector)?.focus({ preventScroll: true });
}
$('close').onclick = () => dismissDetail(true);
document.addEventListener(
  'click',
  (e) => {
    if ($('vehicle').hidden || $('vehicle').contains(e.target)) return;
    if (svg.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
    dismissDetail(false);
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissDetail(true);
});

function drawMarkers() {
  const currentFocus = document.activeElement?.dataset?.vehicle;
  markers.replaceChildren();
  const unit = 1 / (svg.getScreenCTM()?.a || 1);
  const iconUnit = unit * Math.min(2.4, 1 + 0.35 * Math.log2(zoom));
  const positions = fixes.map(v => {
    const [x, y] = project(v.point, frame), rail = railways[v.route];
    if (rail) return { v, id: v.id, x, y, bearing: railBearing(v, [x, y], rail.track, rail.stations) };
    if (!routeMatches.has(v)) {
      const trip = timetable?.match(v);
      const duration = trip && timetable.patterns[trip.pattern].at(-1)[1];
      const progress = duration > 0 ? Math.max(0, Math.min(1, (v.time - Date.parse(v.departure)) / (1000 * duration))) : null;
      routeMatches.set(v, busPaths.locate(v, x, y, trip, progress));
    }
    return { v, id: v.id, x, y, bearing: null, ...routeMatches.get(v) };
  });
  placeVehicles(positions, iconUnit, (x, y) =>
    Math.abs(x - cx) <= svg.clientWidth * unit / 2 && Math.abs(y - cy) <= svg.clientHeight * unit / 2);
  const occupied = [...labelBoxes, ...positions.map(m => m.box)];
  for (const { v, x, y, bearing, size } of positions) {
    const drawUnit = iconUnit * size;
    const rail = railways[v.route], fill = routes[v.route].colour;
    const g = shape(
      'g',
      {
        role: 'button',
        tabindex: 0,
        'data-vehicle': v.id,
        'aria-label': v.route + ' ' + v.label,
        style: 'cursor:pointer',
        opacity: v.stale ? 0.55 : 1,
      },
      markers,
    );
    shape('title', {}, g, v.label + ' · ' + v.precision);
    const w = (rail ? 35 : 26) * unit,
      h = 13 * unit;
    const candidates = [
      [5, -17],
      [5, 4],
      [-31, -17],
      [-31, 4],
      [6, -31],
      [-31, 18],
      [6, 18],
      [-31, -31],
      [5, 31],
      [-30, 31],
      [21, -3],
      [-48, -3],
    ];
    const options = candidates.map(([dx, dy]) => [x + dx * iconUnit, y + dy * iconUnit, w, h]);
    const b = options.find((b) => !occupied.some((r) => collides(b, r)));
    if (b) {
      occupied.push(b);
      shape(
        'line',
        { x1: x, y1: y, x2: b[0] + w / 2, y2: b[1] + h / 2, stroke: fill, 'stroke-width': 1.2 * unit },
        g,
      );
      shape(
        'rect',
        {
          x: b[0],
          y: b[1],
          width: w,
          height: h,
          rx: 3 * unit,
          fill,
          stroke: v.id === selection ? '#f0ad3b' : 'var(--halo)',
          'stroke-width': unit * (v.id === selection ? 2.2 : 0.8),
        },
        g,
      );
      shape(
        'text',
        {
          x: b[0] + w / 2,
          y: b[1] + h * 0.76,
          fill: 'white',
          'text-anchor': 'middle',
          'font-size': 9.8 * unit,
          'font-weight': 700,
          'font-family': 'ui-monospace, monospace',
        },
        g,
        routes[v.route].chip || v.route,
      );
      shape(
        'rect',
        {
          x: b[0] - 2 * unit,
          y: b[1] - 3 * unit,
          width: w + 4 * unit,
          height: h + 6 * unit,
          fill: 'transparent',
        },
        g,
      );
    }
    const view = vehicleView(bearing);
    const known = Number.isFinite(bearing) && view !== 'front';
    const angle = known ? bearing - 90 : 0;
    const flip = known && view !== 'roof' && bearing > 180 ? -1 : 1;
    const icon = rail
      ? (view === 'side' ? 'northern-carriage' : 'northern-carriage-' + view)
      : routes[v.route].icon + '-' + view;
    const transform = `translate(${x} ${y}) scale(${drawUnit}) rotate(${angle}) scale(1 ${flip})`;
    // The vector body continues to anchor journey cards and receive taps in either theme.
    shape('use', {href: '#' + icon, color: fill, transform, class: 'vehicle-day'}, g);
    const nightWidth = 64 * 44 / 48; // Same map units per pixel as the tablet atlas.
    shape('image', {
      href: './icons/night/' + icon + '.png', transform, class: 'vehicle-night',
      x: -nightWidth / 2, y: -nightWidth / 2, width: nightWidth, height: nightWidth,
      'pointer-events': 'none',
    }, g);
    if (selection === v.id) shape('circle', { cx:x, cy:y, r:21*drawUnit, fill:'none',
      stroke:fill, 'stroke-width':1.6*unit, 'pointer-events':'none' },g);
    shape('circle', { cx: x, cy: y, r: 17 * drawUnit, fill: 'transparent' }, g);
    g.onclick = () => inspect(v.id);
    g.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inspect(v.id);
      }
    };
    if (v.id === currentFocus) g.focus({ preventScroll: true });
  }
}
function render() {
  const now = recorded() ? snapshot?.time : Date.now();
  const vehicles = visibleFixes(snapshot, now).filter(v => Object.hasOwn(routes, v.route));
  fixes = vehicles.filter((v) => routeVisible(v.route));
  if (!fixes.some((v) => v.id === selection)) selection = null;
  drawMarkers();
  detail();
  for (const kind of ['bus', 'rail']) {
    const feed = snapshot?.[kind],
      relevant = fixes.filter((v) => Boolean(railways[v.route]) === (kind === 'rail'));
    const count = relevant.filter((v) => !v.stale).length,
      stale = relevant.length - count;
    let status =
      kind === 'bus'
        ? count + ' fix' + (count === 1 ? '' : 'es')
        : count + ' estimate' + (count === 1 ? '' : 's');
    if (stale) status += ' · ' + stale + ' stale';
    if (feed && now - feed.generated > freshMs) status = 'Delayed feed';
    if (!feed) status = 'Connecting…';
    if (fetchFailed || feed?.ok === false) status = 'Unavailable';
    $(kind + '-status').textContent = status;
  }
  $('observed').textContent = snapshot
    ? (recorded() ? 'Recorded ' : 'Checked ') + londonTime(snapshot.time) + ' London'
    : '';
  const problems = fetchFailed || (snapshot && (!snapshot.bus.ok || !snapshot.rail.ok));
  $('status').textContent = !navigator.onLine
    ? recorded()
      ? 'Offline · showing recorded journeys.'
      : 'Offline · choose Replay to see recorded journeys.'
    : problems
      ? 'Feed unavailable. Recent retained positions are dimmed.'
      : selectedRoutes.size && !fixes.length
        ? 'No vehicles reported for the selected routes.'
        : '';
  const mapState = previewing && navigator.onLine ? 'Replay · awaiting live' :
    recorded()
      ? navigator.onLine
        ? 'Replay'
        : 'Offline replay'
      : !navigator.onLine
        ? 'Offline'
        : problems
          ? 'Feed unavailable'
          : snapshot
            ? 'Live'
            : 'Connecting…';
  $('map-status').textContent = mapState + (snapshot ? ' · ' + londonTime(snapshot.time).slice(0, 5) : '');
  $('count').textContent = '(' + fixes.length + ')';
  const list = $('vehicles');
  list.replaceChildren();
  for (const v of fixes) {
    const b = text(
      'button',
      (routes[v.route].chip || v.route) + ' · ' + (v.destination || v.label) + (v.stale ? ' · stale' : ''),
    );
    b.onclick = () => { settings.close(); inspect(v.id); };
    list.append(b);
  }
}
async function soundReports(token, trains) {
  const unknown = [];
  for (const v of trains) {
    if (settings.sound.mode === 'stops' && typeof v.lastStop !== 'boolean') unknown.push(v);
    else settings.sound.play(v.direction > 0, v.lastStop === true);
  }
  if (!unknown.length) return;
  // Some live feed editions omit the stop flag. Match the same Railinfo report as the tablet.
  try {
    const raw = await get('/api/rail-reports');
    if (token !== generation || !Array.isArray(raw.trains)) return;
    for (const v of unknown) if (routeVisible(v.route) && Date.now() - v.time < freshMs && confirmedRailStop(v, raw.trains))
      settings.sound.play(v.direction > 0, true);
  } catch { /* An unconfirmed report stays silent. */ }
}
async function poll(token) {
  if (token !== generation || document.hidden || mode !== 'live') return;
  try {
    const s = await get('/api/lakes-vehicles');
    if (token !== generation) return;
    if ((!snapshot || previewing) && !s.rail?.ok && !s.bus?.ok) throw Error('Waiting for live reports');
    if (!previewing && !fetchFailed && settings.sound.mode !== 'off')
      soundReports(token, railTransitions(snapshot?.rail, s.rail, Date.now()).filter(v => routeVisible(v.route)));
    previewing = false;
    snapshot = s;
    fetchFailed = false;
  } catch {
    if (token !== generation) return;
    fetchFailed = true;
    if (snapshot && !previewing)
      snapshot = {
        ...snapshot,
        bus: { ...snapshot.bus, ok: false },
        rail: { ...snapshot.rail, ok: false },
      };
  }
  render();
  polling = setTimeout(() => poll(token), 30_000);
}
function showFrame(index) {
  frameIndex = index;
  snapshot = replay.frames[index];
  $('frame').value = index;
  $('record-time').textContent =
    new Date(snapshot.time).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/London',
    }) +
    ' · ' +
    londonTime(snapshot.time);
  render();
}
function runReplay(on) {
  clearInterval(replayTimer);
  playing = on;
  $('play').textContent = on ? 'Pause' : 'Play';
  $('play').ariaLabel = on ? 'Pause replay' : 'Play replay';
  if (on) replayTimer = setInterval(() => showFrame((frameIndex + 1) % replay.frames.length), 5000);
}
async function setMode(next) {
  clearTimeout(polling);
  runReplay(false);
  const token = ++generation;
  mode = next;
  previewing = false;
  selectedStop = null;
  $('stop-picker').value = '';
  viewport();
  snapshot = null;
  selection = null;
  fetchFailed = false;
  for (const key of ['live', 'replay']) $(key).setAttribute('aria-pressed', String(key === next));
  $('playback').hidden = next !== 'replay';
  render();
  if (next === 'live') poll(token);
  try {
    replay ??= await get('/data/replay.json');
    if (next !== mode || (next === 'live' ? snapshot !== null : token !== generation)) return;
    previewing = next === 'live';
    $('frame').max = replay.frames.length - 1;
    showFrame(0);
    if (!previewing) runReplay(true);
  } catch {
    if (token === generation) $('status').textContent = 'Recording unavailable.';
  }
}
$('frame').oninput = (e) => {
  runReplay(false);
  showFrame(Number(e.target.value));
};
$('play').onclick = () => {
  if (replay) runReplay(!playing);
};
$('live').onclick = () => setMode('live');
$('replay').onclick = () => setMode('replay');
document.addEventListener('visibilitychange', () => {
  if (mode === 'live') {
    clearTimeout(polling);
    const token = ++generation;
    if (!document.hidden) poll(token);
  }
});
setInterval(() => {
  if (!document.hidden && mode === 'live' && (snapshot || selectedStop !== null)) render();
}, 10_000);
let initialTheme = 'light';
try { if (localStorage.getItem('lakes.theme') === 'dark') initialTheme = 'dark'; } catch {}
const nextFrame = document.createElement('button'); nextFrame.textContent = 'Next frame';
nextFrame.onclick = () => { if (replay) { runReplay(false); showFrame((frameIndex+1)%replay.frames.length); } };
$('play').after(nextFrame);
const settings = panelSettings({
  id:'lakes', name:'Lakes Transit', toolbar:$('lakes-toolbar'), status:$('map-status'), map:document.querySelector('.lakes-surface'),
  initialTheme, applyTheme(value) {
    document.documentElement.dataset.theme = value;
    document.querySelector('meta[name=theme-color]').content = value === 'dark' ? '#182822' : '#f6f7f1';
  },
  appControls:[settingGroup('Data source',$('live'),$('replay')), $('playback'),
    settingGroup('Map zoom',$('minus'),$('plus'),$('reset')), settingGroup('Routes',$('routes')),
    document.querySelector('.stop-finder'), settingGroup('Layout',$('view-toggle'))],
  installHelp:$('install-help'), credits:'OpenStreetMap, OpenFreeMap, OpenMapTiles, Mapzen, Stagecoach, BODS, NaPTAN and Railinfo.'
});
document.querySelector('.map-bar').remove();
document.querySelector('.mast-tools').remove();
const saved = readSetting('lakes.view');
if (Array.isArray(saved?.routes)) {
  for (const r of saved.routes) if (order.includes(r)) selectedRoutes.add(r);
  applyRoutes();
  if (!saved.fit && [saved.zoom,saved.cx,saved.cy].every(Number.isFinite)) {
    zoom = Math.max(1,Math.min(24,saved.zoom)); cx = saved.cx; cy = saved.cy; fitOnResize = false;
    viewport(); saveView();
  }
}
new ResizeObserver(() => (fitOnResize ? fitRoutes() : viewport())).observe(svg);
viewport();
window.addEventListener('offline', render);
window.addEventListener('online', () => {
  render();
  if (mode === 'live') {
    clearTimeout(polling);
    poll(++generation);
  }
});
setMode('live');
