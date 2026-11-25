import {
  routes,
  order,
  project,
  railBearing,
  visibleFixes,
  ageLabel,
  londonTime,
  freshMs,
} from './model.mjs';
import { Timetable, hhmm, stopTitle, serviceSeconds } from './timetable.mjs';

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
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw Error('Unavailable');
  return res.json();
}
const [data, schedule] = await Promise.all([
  get('/data/map.json'),
  get('/data/timetable.json').catch(() => null),
]);
const timetable = schedule && new Timetable(schedule);
const { frame } = data;
const [W, H] = [frame.width, frame.height];
const positions = [
  ['Penrith', -2.757, 54.663, 0, -9, 1],
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
  ['Milnthorpe', -2.774, 54.227, 8, 0],
  ['Carnforth', -2.769, 54.13, 6, -4],
  ['Lancaster', -2.804, 54.051, 0, 17, 1],
];
const waterNames = [
  ['Ullswater', -2.9, 54.583, -32],
  ['Windermere', -2.953, 54.311, -76],
  ['Coniston Water', -3.093, 54.319, -71],
  ['Derwentwater', -3.153, 54.568, 0],
];
const path = (points) => 'M' + points.map((p) => p.join(',')).join('L');
const multi = (lines) => lines.map(path).join('');
let fitOnResize = true,
  zoom = 1,
  cx = W / 2,
  cy = H / 2,
  selection = null,
  selectedStop = null;
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
let fixes = [],
  fetchFailed = false;

const bleedX = frame.bleedX ?? frame.bleed,
  bleedY = frame.bleedY ?? frame.bleed;
shape(
  'image',
  {
    href: '/data/relief.webp',
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
for (const key of ['555', '505', '516', '599', '508', 'rail']) {
  const d = key === 'rail' ? path(data.rail) : multi(data.routes[key]);
  const g = shape('g', { 'data-route-line': key }, group);
  shape('path', { d, stroke: 'var(--halo)', 'stroke-width': key === 'rail' ? 4.2 : 3.8 }, g);
  shape('path', { d, stroke: routes[key].colour, 'stroke-width': key === 'rail' ? 2.7 : 2.2 }, g);
  if (key === 'rail')
    shape('path', { d, stroke: '#fff', 'stroke-width': 1.1, 'stroke-dasharray': '3 4' }, g);
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
  picker.disabled = !timetable || (selectedRoutes.size === 1 && selectedRoutes.has('rail'));
  if (!timetable) picker.options[0].text = 'Timetable unavailable';
  for (const s of stops.filter((s) => stopVisible(s.id)).sort((a, b) => a.name.localeCompare(b.name)))
    picker.add(new Option(s.name, s.id));
  if (selectedStop !== null) picker.value = String(selectedStop);
}
function openStop(id, centre) {
  selection = null;
  selectedStop = id;
  if (mode === 'replay') runReplay(false);
  $('stop-picker').value = String(id);
  if (centre) {
    fitOnResize = false;
    [cx, cy] = stops.find((s) => s.id === id).point;
    zoom = Math.max(zoom, 6);
    cy += (H * 0.19) / zoom;
  }
  viewport();
  detail();
  $('vehicle-info').focus({ preventScroll: true });
}
$('stop-picker').onchange = (e) => {
  if (e.target.value !== '') openStop(Number(e.target.value), true);
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
function place(name, point, dx, dy, major = false, station = false) {
  const [x, y] = point;
  shape(
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
  townLabels.push({ label, x, y, dx, dy, major });
}
for (const [name, lon, lat, dx, dy, major] of positions)
  place(name, project([lon, lat], frame), dx, dy, major);
const stationOffsets = { WDM: [8, -12, 1], SVL: [2, 14], BUD: [6, -2], KEN: [8, 7, 1], OXN: [7, 10] };
for (const s of data.stations) {
  const [dx, dy, large] = stationOffsets[s.code];
  place(s.code === 'OXN' ? 'Oxenholme' : s.name, s.point, dx, dy, large, true);
}
for (const [name, lon, lat, angle] of waterNames) {
  const [x, y] = project([lon, lat], frame);
  shape(
    'text',
    {
      transform: 'translate(' + x + ' ' + y + ') rotate(' + angle + ')',
      class: 'water-name',
      'text-anchor': 'middle',
    },
    labels,
    name,
  );
}
function theme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme').textContent = dark ? '☀' : '☾';
  $('theme').ariaLabel = dark ? 'Use light theme' : 'Use dark theme';
  $('theme').title = $('theme').ariaLabel;
  document.querySelector('meta[name=theme-color]').content = dark ? '#182822' : '#f6f7f1';
}
try {
  theme(localStorage.getItem('lakes.theme') === 'dark');
} catch {
  theme(false);
}
$('theme').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  theme(dark);
  try {
    localStorage.setItem('lakes.theme', dark ? 'dark' : 'light');
  } catch {}
};

for (const key of order) {
  const r = routes[key];
  const button = text('button', key === 'rail' ? 'Rail' : key, 'route');
  button.dataset.route = key;
  button.style.setProperty('--accent', r.colour);
  button.setAttribute('aria-pressed', 'false');
  button.ariaLabel = key === 'rail' ? r.name : 'Bus ' + key + ' · ' + r.name;
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
  render();
}
$('show-all').onclick = () => {
  selectedRoutes.clear();
  applyRoutes();
};
$('view-toggle').onclick = () => {
  const fullMap = document.body.classList.toggle('map-only');
  $('view-toggle').ariaLabel = fullMap ? 'Show dashboard' : 'Expand map';
  $('view-toggle').title = $('view-toggle').ariaLabel;
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
  for (const { label, x, y, dx, dy } of [...townLabels].sort((a, b) => Number(b.major) - Number(a.major))) {
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
  // Water names are rotated, so convert their screen rectangles back to the map.
  for (const label of labels.querySelectorAll('.water-name')) {
    const b = label.getBoundingClientRect(),
      matrix = svg.getScreenCTM();
    if (matrix)
      labelBoxes.push([
        (b.left - matrix.e) / matrix.a,
        (b.top - matrix.f) / matrix.d,
        b.width / matrix.a,
        b.height / matrix.d,
      ]);
  }
  drawStops(1 / matrixScale);
  drawMarkers();
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
}
$('plus').onclick = () => changeZoom(1.5);
$('minus').onclick = () => changeZoom(1 / 1.5);
$('reset').onclick = fitRoutes;
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
let drag;
svg.onpointerdown = (e) => {
  if (e.target.closest('[data-vehicle], [data-stop]') || zoom === 1) return;
  drag = { x: e.clientX, y: e.clientY, cx, cy };
  svg.setPointerCapture(e.pointerId);
};
svg.onpointermove = (e) => {
  if (!drag) return;
  fitOnResize = false;
  const unit = svg.getScreenCTM().a;
  cx = drag.cx - (e.clientX - drag.x) / unit;
  cy = drag.cy - (e.clientY - drag.y) / unit;
  viewport();
};
svg.onpointerup = svg.onpointercancel = () => {
  drag = null;
};

function inspect(id) {
  selection = id;
  selectedStop = null;
  $('stop-picker').value = '';
  if (mode === 'replay') runReplay(false);
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
        (mode === 'replay' ? 'Replay ' : '') +
        londonTime(now).slice(0, 5) +
        ' London · ≈ approximate',
    ),
  );
  const list = text('div', '', 'schedule-list');
  body.append(list);
  const sections = [...board.sections].sort(
    (a, b) => (a[1][0]?.at ?? Infinity) - (b[1][0]?.at ?? Infinity),
  );
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
function drawJourney(body, v, now) {
  const trip = timetable?.match(v);
  if (!trip) {
    body.append(text('p', 'No matching published timetable for this journey.'));
    return;
  }
  const calls = timetable.patterns[trip.pattern];
  const seconds = serviceSeconds(now, v.serviceDate);
  const list = text('div', '', 'schedule-list');
  const first = timetable.stops[calls[0][0]];
  body.append(
    text('h3', 'Scheduled stops · from ' + timetable.groups[first.group].town),
    text('small', 'London time · ≈ approximate'),
    list,
  );
  let marked = false;
  for (const [ref, arrival, departure, pickup, exact, dropoff] of calls) {
    if (!pickup && !dropoff) continue;
    const pole = timetable.stops[ref],
      group = timetable.groups[pole.group];
    const time = trip.start + (pickup ? departure : arrival);
    const row = text('div', '', 'call-row');
    const location = text('span', pole.name);
    location.append(text('small', group.town + (pole.side ? ' · ' + pole.side : '')));
    if (!marked && time >= seconds) {
      marked = true;
      row.classList.add('next-call');
      location.append(text('small', 'Next by timetable', 'next-note'));
    }
    row.append(text('time', (exact ? '' : '≈') + hhmm(time)), location);
    list.append(row);
  }
}
function detail() {
  const v = fixes.find((v) => v.id === selection),
    box = $('vehicle'),
    body = $('vehicle-info');
  box.hidden = !v && selectedStop === null;
  const key = v ? [v.id, v.route, v.departure].join('/') : 'stop/' + selectedStop;
  const previousList = body.querySelector('.schedule-list');
  const restoreFocus = previousList && previousList === document.activeElement;
  const previous = body.dataset.key === key ? previousList?.scrollTop : null;
  if (box.hidden) {
    delete body.dataset.key;
    return;
  }
  body.dataset.key = key;
  const now = mode === 'replay' ? snapshot?.time : Date.now();
  if (!Number.isFinite(now)) {
    box.hidden = true;
    return;
  }
  body.replaceChildren();
  box.style.setProperty('--accent', v ? routes[v.route].colour : 'var(--active)');
  if (selectedStop !== null) drawBoard(body, now);
  else {
    body.append(
      text('span', v.agency + ' · ' + (v.route === 'rail' ? 'Lakes Line' : v.route), 'kicker'),
      text('strong', v.route === 'rail' ? v.label : 'To ' + (v.destination || 'unknown destination')),
    );
    if (v.route === 'rail')
      body.append(
        text(
          'div',
          'Last reported ' + v.last + ' ' + v.lastTime + ' · Next ' + v.next + ' ' + (v.nextTime || ''),
        ),
      );
    else
      body.append(
        text(
          'div',
          v.label +
            ' · ' +
            (Number.isFinite(v.bearing) ? 'Heading ' + v.bearing + '°' : 'Heading unavailable'),
        ),
      );
    body.append(
      text(
        'small',
        (mode === 'replay' ? 'Recorded · ' : '') +
          v.precision +
          ' · ' +
          ageLabel(now - v.time) +
          (v.stale ? ' · stale' : '') +
          ' · ' +
          (v.route === 'rail' ? 'Railinfo' : 'DfT BODS'),
      ),
    );
    if (v.route !== 'rail') drawJourney(body, v, now);
  }
  const list = body.querySelector('.schedule-list');
  if (list) {
    list.tabIndex = 0;
    list.setAttribute('aria-label', selectedStop !== null ? 'Scheduled departures' : 'Scheduled stops');
    const next = list.querySelector('.next-call');
    list.scrollTop = previous ?? (next ? next.offsetTop - list.offsetTop : 0);
    if (restoreFocus) list.focus({ preventScroll: true });
  }
}
$('close').onclick = () => {
  if ($('vehicle').hidden) return;
  const selector =
    selectedStop !== null
      ? '[data-stop="' + selectedStop + '"]'
      : '[data-vehicle="' + CSS.escape(selection) + '"]';
  selection = null;
  selectedStop = null;
  $('stop-picker').value = '';
  detail();
  viewport();
  svg.querySelector(selector)?.focus({ preventScroll: true });
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('close').click();
});

function drawMarkers() {
  const currentFocus = document.activeElement?.dataset?.vehicle;
  markers.replaceChildren();
  const unit = 1 / (svg.getScreenCTM()?.a || 1);
  const occupied = [...labelBoxes];
  for (const vehicle of fixes) {
    const [x, y] = project(vehicle.point, frame);
    const radius = vehicle.route === 'rail' ? 18 : 16;
    occupied.push([x - radius * unit, y - radius * unit, 2 * radius * unit, 2 * radius * unit]);
  }
  for (const v of fixes) {
    const [x, y] = project(v.point, frame),
      rail = v.route === 'rail',
      fill = routes[v.route].colour;
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
    const w = (rail ? 27 : 26) * unit,
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
    const options = candidates.map(([dx, dy]) => [x + dx * unit, y + dy * unit, w, h]);
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
        rail ? 'Rail' : v.route,
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
    const bearing = rail ? railBearing(v, [x, y], data.rail, data.stations) : v.bearing;
    const known = Number.isFinite(bearing);
    const angle = known ? bearing - 90 : 0;
    const flip = known && bearing > 180 ? -1 : 1;
    const icon = rail ? '#northern-carriage' : '#' + routes[v.route].icon + (known ? '-side' : '-front');
    shape(
      'use',
      {
        href: icon,
        color: fill,
        transform:
          'translate(' + x + ' ' + y + ') scale(' + unit + ') rotate(' + angle + ') scale(1 ' + flip + ')',
      },
      g,
    );
    shape('circle', { cx: x, cy: y, r: 17 * unit, fill: 'transparent' }, g);
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
  const now = mode === 'replay' ? snapshot?.time : Date.now();
  const vehicles = visibleFixes(snapshot, now);
  fixes = vehicles.filter((v) => routeVisible(v.route));
  if (!fixes.some((v) => v.id === selection)) selection = null;
  drawMarkers();
  detail();
  for (const kind of ['bus', 'rail']) {
    const feed = snapshot?.[kind],
      relevant = fixes.filter((v) => (v.route === 'rail') === (kind === 'rail'));
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
    ? (mode === 'replay' ? 'Recorded ' : 'Checked ') + londonTime(snapshot.time) + ' London'
    : '';
  const problems = fetchFailed || (snapshot && (!snapshot.bus.ok || !snapshot.rail.ok));
  $('status').textContent = !navigator.onLine
    ? mode === 'replay'
      ? 'Offline · showing recorded journeys.'
      : 'Offline · choose Replay to see recorded journeys.'
    : problems
      ? 'Feed unavailable. Recent retained positions are dimmed.'
      : selectedRoutes.size && !fixes.length
        ? 'No vehicles reported for the selected routes.'
        : '';
  const mapState =
    mode === 'replay'
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
      (v.route === 'rail' ? 'Rail' : v.route) +
        ' · ' +
        (v.destination || v.label) +
        (v.stale ? ' · stale' : ''),
    );
    b.onclick = () => inspect(v.id);
    list.append(b);
  }
}
async function poll(token) {
  if (token !== generation || document.hidden || mode !== 'live') return;
  try {
    const s = await get('/api/vehicles');
    if (token !== generation) return;
    snapshot = s;
    fetchFailed = false;
  } catch {
    if (token !== generation) return;
    fetchFailed = true;
    if (snapshot)
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
  selectedStop = null;
  $('stop-picker').value = '';
  viewport();
  snapshot = null;
  selection = null;
  fetchFailed = false;
  for (const key of ['live', 'replay']) $(key).setAttribute('aria-pressed', String(key === next));
  $('playback').hidden = next !== 'replay';
  render();
  if (next === 'live') {
    poll(token);
    return;
  }
  try {
    replay ??= await get('/data/replay.json');
    if (token !== generation) return;
    $('frame').max = replay.frames.length - 1;
    showFrame(0);
    runReplay(true);
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
setMode(navigator.onLine ? 'live' : 'replay');
