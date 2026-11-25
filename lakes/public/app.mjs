import { routes, order, project, visibleFixes, ageLabel, londonTime, freshMs } from './model.mjs';

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
const data = await get('/data/map.json'),
  { frame } = data;
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
let zoom = 1,
  cx = W / 2,
  cy = H / 2,
  focus = null,
  selection = null;
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

const bleed = frame.bleed;
shape(
  'image',
  {
    href: '/data/relief.webp',
    x: -bleed,
    y: -bleed,
    width: W + 2 * bleed,
    height: H + 2 * bleed,
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
  group = shape('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
for (const key of ['555', '505', '516', '599', '508', 'rail']) {
  const d = key === 'rail' ? path(data.rail) : multi(data.routes[key]);
  const g = shape('g', {}, group);
  const casing = shape('path', { d, stroke: 'var(--halo)', 'stroke-width': key === 'rail' ? 4.2 : 3.8 }, g);
  const stroke = shape(
    'path',
    { d, stroke: routes[key].colour, 'stroke-width': key === 'rail' ? 2.7 : 2.2 },
    g,
  );
  if (key === 'rail')
    shape('path', { d, stroke: '#fff', 'stroke-width': 1.1, 'stroke-dasharray': '3 4' }, g);
  paths.set(key, { g, casing, stroke });
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
const shared = shape('g', { 'pointer-events': 'none', fill: 'none', 'stroke-width': 2.5 }, svg);
const common = new Map();
for (const [d, ids] of linkSet) {
  if (ids.length < 2) continue;
  const key = ids.join(',');
  common.set(key, (common.get(key) || '') + d);
}
for (const [key, d] of common) {
  const ids = key.split(',');
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
const places = shape('g', {}, svg),
  markers = shape('g', { 'aria-label': 'Vehicles' }, svg);
const dots = shape('g', {}, places),
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
  const r = routes[key],
    b = text('button', '', 'route');
  b.dataset.route = key;
  b.style.setProperty('--accent', r.colour);
  b.setAttribute('aria-pressed', 'false');
  b.title = 'Focus on ' + (key === 'rail' ? 'the Lakes Line' : 'route ' + key);
  b.append(
    text('span', key === 'rail' ? 'Rail' : key, 'badge'),
    text('span', r.name, 'route-name'),
    text('small', r.via),
  );
  b.onclick = () => selectRoute(focus === key ? null : key);
  $('routes').append(b);
}
function selectRoute(key) {
  focus = key;
  selection = null;
  shared.style.display = key ? 'none' : '';
  for (const b of $('routes').children) b.setAttribute('aria-pressed', String(b.dataset.route === key));
  $('show-all').hidden = !key;
  for (const [id, { g }] of paths) g.setAttribute('opacity', !key || id === key ? '1' : '.14');
  if (key) {
    const { g } = paths.get(key);
    group.append(g);
    const b = g.getBBox();
    zoom = Math.max(1, Math.min(3.8, Math.min(W / (b.width + 74), H / (b.height + 95))));
    cx = b.x + b.width / 2;
    cy = b.y + b.height / 2;
  } else {
    zoom = 1;
    cx = W / 2;
    cy = H / 2;
  }
  viewport();
  render();
}
$('show-all').onclick = () => selectRoute(null);
function viewport() {
  const w = W / zoom,
    h = H / zoom;
  cx = Math.min(W - w / 2, Math.max(w / 2, cx));
  cy = Math.min(H - h / 2, Math.max(h / 2, cy));
  svg.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].join(' '));
  $('plus').disabled = zoom >= 5;
  $('minus').disabled = zoom <= 1;
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const km = zoom >= 3 ? 2 : 5;
    $('scale').style.width = ((km * frame.units) / 111.2) * matrix.a + 'px';
    $('scale').textContent = km + ' km';
  }
  for (const e of labels.children) {
    const cls = e.getAttribute('class');
    const base = cls.includes('major') ? 16 : cls.includes('station-label') ? 10 : 12;
    e.style.fontSize = base / Math.sqrt(zoom) + 'px';
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
      label.setAttribute('x', x + ox / Math.sqrt(zoom));
      label.setAttribute('y', y + oy / Math.sqrt(zoom));
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
  drawMarkers();
}
function changeZoom(factor, anchor = [cx, cy]) {
  const next = Math.max(1, Math.min(5, zoom * factor)),
    ratio = zoom / next;
  cx = anchor[0] + (cx - anchor[0]) * ratio;
  cy = anchor[1] + (cy - anchor[1]) * ratio;
  zoom = next;
  viewport();
}
$('plus').onclick = () => changeZoom(1.5);
$('minus').onclick = () => changeZoom(1 / 1.5);
$('reset').onclick = () => selectRoute(null);
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
  if (e.target.closest('[data-vehicle]') || zoom === 1) return;
  drag = { x: e.clientX, y: e.clientY, cx, cy };
  svg.setPointerCapture(e.pointerId);
};
svg.onpointermove = (e) => {
  if (!drag) return;
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
  drawMarkers();
  detail();
}
function detail() {
  const v = fixes.find((v) => v.id === selection),
    box = $('vehicle');
  box.hidden = !v;
  if (!v) return;
  box.style.setProperty('--accent', routes[v.route].colour);
  const body = $('vehicle-info'),
    now = mode === 'replay' ? snapshot.time : Date.now();
  body.replaceChildren(
    text('span', v.route === 'rail' ? v.agency + ' · Lakes Line' : v.agency + ' · ' + v.route),
    text('strong', v.route === 'rail' ? v.label : 'To ' + (v.destination || 'unknown destination')),
  );
  if (v.route === 'rail')
    body.append(
      text(
        'div',
        'Last reported ' + v.last + ' ' + v.lastTime + ' · Next ' + v.next + ' ' + (v.nextTime || ''),
      ),
    );
  else body.append(text('div', v.label));
  body.append(
    text(
      'small',
      (mode === 'replay' ? 'Recorded · ' : '') +
        v.precision +
        ' · ' +
        ageLabel(now - v.time) +
        (v.stale ? ' · stale' : ''),
    ),
  );
  body.append(
    text(
      'small',
      v.route === 'rail' ? 'Source: Railinfo running feed' : 'Source: DfT Bus Open Data Service',
    ),
  );
}
$('close').onclick = () => {
  selection = null;
  detail();
  drawMarkers();
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
    occupied.push([x - 4 * unit, y - 4 * unit, 8 * unit, 8 * unit]);
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
      [17, -3],
      [-44, -3],
    ];
    const options = candidates.map(([dx, dy]) => [x + dx * unit, y + dy * unit, w, h]);
    const b = options.find((b) => !occupied.some((r) => collides(b, r)));
    shape('circle', { cx: x, cy: y, r: 3.6 * unit, fill, stroke: '#fff', 'stroke-width': 1.1 * unit }, g);
    shape('circle', { cx: x, cy: y, r: 7 * unit, fill: 'transparent' }, g);
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
  fixes = vehicles.filter((v) => !focus || v.route === focus);
  if (!fixes.some((v) => v.id === selection)) selection = null;
  drawMarkers();
  detail();
  for (const kind of ['bus', 'rail']) {
    const feed = snapshot?.[kind],
      relevant = vehicles.filter((v) => (v.route === 'rail') === (kind === 'rail'));
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
  $('status').textContent = problems
    ? 'Feed unavailable. Recent retained positions are dimmed.'
    : focus && !fixes.length
      ? 'No current ' + (focus === 'rail' ? 'branch estimate.' : 'fix for route ' + focus + '.')
      : '';
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
  if (!document.hidden && mode === 'live' && snapshot) render();
}, 10_000);
new ResizeObserver(viewport).observe(svg);
viewport();
setMode('live');
