import {
  Corridor,
  locateTrain,
  corridorTracks,
  withStationReports,
  berthDiagram,
  fitStationNames,
  junctionPathSlots,
} from '/rail.mjs';

const $ = (id) => document.getElementById(id);
const panel = document.querySelector('.panel');
const themeButton = $('diagram-theme');
const themeKey = 'traintimes.diagramTheme';
function setTheme(light) {
  panel.dataset.theme = light ? 'light' : 'dark';
  themeButton.title = light ? 'Switch to dark diagram' : 'Switch to light diagram';
  themeButton.setAttribute('aria-label', themeButton.title);
}
try {
  setTheme(localStorage.getItem(themeKey) === 'light');
} catch {
  setTheme(false);
}
themeButton.addEventListener('click', () => {
  setTheme(panel.dataset.theme !== 'light');
  try {
    localStorage.setItem(themeKey, panel.dataset.theme);
  } catch {
    // Keep this choice for the current page.
  }
});
window.addEventListener('storage', (e) => {
  if (e.key === themeKey || e.key === null) setTheme(e.newValue === 'light');
});
const viewLink = $('diagram-view');
function readDisplayMode() {
  const url = new URL(location.href);
  const only = url.searchParams.get('display') === 'diagram';
  document.documentElement.classList.toggle('diagram-only', only);
  if (only) url.searchParams.delete('display');
  else url.searchParams.set('display', 'diagram');
  viewLink.href = url.href;
  viewLink.title = only ? 'Return to dashboard' : 'Open diagram-only view';
  viewLink.setAttribute('aria-label', viewLink.title);
  return only;
}
let diagramOnly = readDisplayMode();
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const svgNS = 'http://www.w3.org/2000/svg';
let mode = 'live',
  playing = true,
  recording,
  replayBoard,
  index = 0,
  cursor = 0,
  rate = 1;
const slotWidth = 64;
const plotHalfWidth = 504;
const baseWidth = 1140;
let mapWidth = baseWidth,
  verticalScale = 1;
const slotPitch = () => (slotWidth * zoom * (mapWidth - 132)) / (2 * plotHalfWidth);
let inspectedSignal = false;
let trainSelection = null;
let zoom = 1,
  centre,
  selection = 'R103:7',
  dragging = null,
  moved = false;
let live = { values: {}, events: [], status: 'Connecting' },
  fetchFault = false,
  lastDraw = '';
const request = async (path) => {
  const response = await fetch(path, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw Error('Unavailable');
  return response.json();
};
const layout = await request('/data/corridor.json');
const watford = layout.stations.find((s) => s.code === layout.junction.code);
const dc = layout.branches.find((b) => b.id === 'dc'),
  abbey = layout.branches.find((b) => b.id === 'abbey');
const diagram = berthDiagram(layout);
const home = diagram.columns.get('HML');
const junction = diagram.columns.get(watford.code);
const overview = (diagram.start + diagram.end) / 2;
const minZoom = (2 * plotHalfWidth) / ((diagram.end - diagram.start) * slotWidth);
centre = home;
const markers = corridorTracks(layout).flatMap((track) =>
  track.berths.map((berth) => ({
    ...berth,
    track,
    x: diagram.positions.get(berth.id),
  })),
);
const byBit = new Map(markers.filter((m) => m.bit).map((m) => [m.bit, m]));
const byBerth = new Map(markers.map((m) => [m.id, m]));
const isTrainCode = (head) => /^(?:[0-9][A-Z][0-9]{2}|[A-Z][0-9]{3})$/.test(head);
const state = () => withStationReports(mode === 'live' ? live : replayBoard);
const showBranches = () =>
  !(centre === home && zoom >= 1) && centre - plotHalfWidth / (slotWidth * zoom) <= diagram.abbeyEnd + 0.5;
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function shape(parent, tag, attrs, text) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  parent.append(el);
  return el;
}
function position(x) {
  return 111 + (mapWidth - 132) / 2 + (x - centre) * slotPitch();
}
const inView = (x) => x >= 109 && x <= mapWidth - 19;
function clampCentre() {
  const half = plotHalfWidth / (slotWidth * zoom);
  centre = zoom === minZoom ? overview : Math.max(diagram.start + half, Math.min(diagram.end - half, centre));
}
function setZoom(value) {
  zoom = Math.max(minZoom, Math.min(4, value));
  clampCentre();
  render(true);
}
const popout = $('train-popout');
const drawing = $('drawing');
function positionPopout() {
  if (!popout.open || !trainSelection) return;
  const bounds = drawing.getBoundingClientRect();
  const marker = $('map').querySelector('[data-key="' + CSS.escape(trainSelection.berth) + '"]');
  const anchor = marker?.getBoundingClientRect();
  const cx = anchor ? anchor.left + anchor.width / 2 - bounds.left : bounds.width / 2;
  const cy = anchor ? anchor.top + anchor.height / 2 - bounds.top : bounds.height / 2;
  const dx = (anchor?.width ?? 0) / 2 + 8,
    dy = (anchor?.height ?? 0) / 2 + 8;
  const width = popout.offsetWidth,
    height = popout.offsetHeight,
    inset = 8;
  const right = cx + dx,
    left = cx - dx - width;
  let x = cx - width / 2,
    y = cy - height / 2;
  if (right + width <= bounds.width - inset) x = right;
  else if (left >= inset) x = left;
  else y = cy + dy + height <= bounds.height - inset ? cy + dy : cy - dy - height;
  popout.style.left = Math.max(inset, Math.min(bounds.width - width - inset, x)) + 'px';
  popout.style.top = Math.max(inset, Math.min(bounds.height - height - inset, y)) + 'px';
}
function closeTrain(restoreFocus = false) {
  if (!trainSelection && !popout.open) return;
  const key = trainSelection?.berth;
  trainSelection = null;
  if (popout.open) popout.close();
  render(true);
  if (restoreFocus)
    (document.querySelector('.marker[data-key="' + CSS.escape(key ?? '') + '"]') ?? $('sector')).focus({
      preventScroll: true,
    });
}
function select(key, trigger, shownHead) {
  const head = shownHead ?? state().values[key];
  if (byBerth.has(key) && head) {
    inspectedSignal = false;
    trainSelection = { head, berth: key, area: key.slice(0, 2) };
    if (!popout.open) popout.show();
    render(true);
    if (trigger.classList.contains('trainrow'))
      popout.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('close-train').focus({ preventScroll: true });
    return;
  }
  if (!byBit.has(key)) return;
  selection = key;
  inspectedSignal = true;
  closeTrain();
  render(true);
}
$('close-train').onclick = () => closeTrain(true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popout.open) {
    e.preventDefault();
    closeTrain(true);
  }
});
document.addEventListener('click', (e) => {
  if (
    popout.open &&
    !popout.contains(e.target) &&
    !e
      .composedPath()
      .some(
        (n) =>
          n.classList?.contains('marker') ||
          n.classList?.contains('trainrow') ||
          n.classList?.contains('diagram-tools') ||
          n.id === 'replaybar' ||
          n.classList?.contains('zoom'),
      )
  )
    closeTrain();
});
function fresh(area) {
  if (area === 'AB') {
    const report = (mode === 'replay' ? replayBoard : live).abbey;
    return Boolean(
      report?.available && (mode === 'replay' || (!fetchFault && Date.now() - report.checked < 90000)),
    );
  }
  return mode === 'replay'
    ? Boolean(replayBoard.areaTimes[area])
    : !fetchFault && live.areaStatus?.[area] === 'Live';
}
function visible(m) {
  if (m.track?.branch) return showBranches() && inView(position(m.x));
  return (zoom < 1 || centre !== home || m.pilot) && inView(position(m.x));
}
function activate(parent, xy, key, label, shownHead) {
  const el = shape(parent, 'g', {
    transform: xy,
    class: 'marker',
    tabindex: 0,
    role: 'button',
    'aria-label': label,
    'data-key': key,
  });
  shape(el, 'title', {}, label);
  el.addEventListener('click', () => {
    if (!moved) select(key, el, shownHead);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(key, el, shownHead);
    }
  });
  return el;
}
function markerLocation(m) {
  if (m.kind === 'station-report') return m.location;
  return (m.platform ? 'Platform ' + m.platform + ' · ' : '') + 'berth ' + m.id.slice(2);
}
function drawSignal(plot, m, x, y, values, small) {
  const indication = !fresh(m.id.slice(0, 2)) ? null : values[m.bit];
  const sy = y - (small ? 15 : 17);
  if (m.bit) {
    const signal = activate(
      plot,
      'translate(' + x + ' ' + sy + ')',
      m.bit,
      m.signal + ' · ' + m.track.name + ' · ' + (indication || 'unknown'),
    );
    const selected = selection === m.bit || selection === m.id;
    shape(signal, 'rect', {
      x: small ? -4 : -13,
      y: small ? -7 : -13,
      width: small ? 8 : 26,
      height: small ? 14 : 26,
      fill: 'transparent',
      class: 'ring',
      rx: 4,
      stroke: selected && !small ? 'var(--selection)' : 'transparent',
      'stroke-dasharray': selected ? '3 2' : '',
    });
    const colour =
      indication === 'on'
        ? 'var(--signal-on)'
        : indication === 'off'
          ? 'var(--signal-off)'
          : 'var(--signal-unknown)';
    shape(signal, 'circle', {
      cx: 0,
      cy: 0,
      r: small ? 2.7 : 5.3,
      fill: indication === 'on' ? colour : 'var(--board)',
      stroke: colour,
      'stroke-width': small ? 1.2 : 2,
      'stroke-dasharray': indication ? '' : '2 2',
    });
    if (!small && !m.platform && (zoom >= 3 || selected))
      shape(
        plot,
        'text',
        { x, y: y + 22, 'text-anchor': 'middle', fill: 'var(--board-muted)', 'font-size': 10 },
        m.signal,
      );
  }
}
function drawTrains(trainsLayer, occupied, values) {
  occupied.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [i, { m, x, y }] of occupied.entries()) {
    const prev = occupied[i - 1],
      next = occupied[i + 1];
    const left = prev?.y === y && prev.x < x ? x - prev.x : Infinity;
    const right = next?.y === y && next.x > x ? next.x - x : Infinity;
    const width = Math.min(50, left - 2, right - 2);
    const stale = !fresh(m.id.slice(0, 2)),
      head = values[m.id];
    const train = activate(
      trainsLayer,
      'translate(' + x + ' ' + y + ')',
      m.id,
      head + ' · ' + m.track.name + ' · ' + markerLocation(m),
      head,
    );
    shape(train, 'rect', {
      x: -width / 2,
      y: -10.5,
      width,
      height: 21,
      rx: 3,
      fill: stale
        ? 'var(--stale-description)'
        : isTrainCode(head)
          ? 'var(--train-fill)'
          : 'var(--other-description)',
      stroke:
        trainSelection?.head === head && trainSelection?.berth === m.id ? 'var(--marker-focus)' : 'none',
      'stroke-width': 2,
      class: 'ring',
    });
    shape(
      train,
      'text',
      {
        x: 0,
        y: 0,
        'dominant-baseline': 'central',
        'text-anchor': 'middle',
        fill: 'var(--train-text)',
        'font-size': Math.min(13, width / 2.85),
        'font-weight': 700,
      },
      head,
    );
  }
}

const laneY = (lane) => (64 + lane * 44) * verticalScale;
const routeColours = { dc: 'var(--route-dc)', abbey: 'var(--route-abbey)', bay: 'var(--route-bay)' };
const laneByPlatform = new Map(layout.junction.platforms.map((p, i) => [p.number, i + 1]));
function textAt(parent, x, y, text, attrs = {}) {
  return shape(
    parent,
    'text',
    { x, y, fill: 'var(--board-text)', 'font-size': 12, 'text-anchor': 'middle', ...attrs },
    text,
  );
}
const labelMeasure = document.createElement('canvas').getContext('2d');
const labelFont = getComputedStyle(panel).getPropertyValue('--sans');
const labelWidths = new Map();
function measureLabel(label, size) {
  const key = size + ' ' + label;
  if (!labelWidths.has(key)) {
    labelMeasure.font = '600 ' + size + 'px ' + labelFont;
    labelWidths.set(key, labelMeasure.measureText(label).width);
  }
  return labelWidths.get(key);
}
function stationLabels(plot, stations, y, secondY) {
  const items = stations
    .map((station) => {
      const column = diagram.columns.get(station.code);
      return { station, column, x: position(column) };
    })
    .filter((s) => inView(s.x));
  for (const item of fitStationNames(items, 105, mapWidth - 4, measureLabel)) {
    stationLabel(plot, item, item.row ? Math.max(y + 22, secondY) : y);
  }
}
function stationLabel(plot, { station, column, labelX, width, size, label }, y) {
  const name = station.name;
  const button = shape(plot, 'g', {
    class: 'station-target',
    role: 'button',
    tabindex: 0,
    'aria-label': 'Zoom to ' + name,
    'data-station': station.code,
  });
  shape(button, 'title', {}, name + ' · ' + station.code);
  const visit = () => {
    centre = column;
    setZoom(station.code === 'WFJ' ? 2 : 1.5);
  };
  button.addEventListener('click', () => {
    if (!moved) visit();
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      visit();
    }
  });
  shape(button, 'rect', { x: labelX - width / 2, y: y - size, width, height: size + 4, fill: 'transparent' });
  textAt(button, labelX, y, label, {
    fill: station.code === 'WFJ' ? 'var(--junction-label)' : 'var(--board-text)',
    style: 'font:600 ' + size + 'px var(--sans)',
  });
}
function berthLane(marker) {
  if (marker.platform) return laneByPlatform.get(marker.platform);
  if (marker.track.branch === 'abbey') return 10;
  if (marker.track.id === 'harrow') return 2.5;
  return marker.track.id === 'down' ? 2 : 3;
}
function drawJunction(plot, values, occupied) {
  const wx = position(junction);
  for (const path of layout.junction.paths) {
    const d = junctionPathSlots(diagram, path)
      .map(([slot, lane], i) => (i ? 'L' : 'M') + position(slot) + ' ' + laneY(lane))
      .join(' ');
    const el = shape(plot, 'path', {
      d,
      stroke: routeColours[path.route],
      'stroke-width': 2.3,
      fill: 'none',
      'stroke-linejoin': 'round',
      'data-connection': path.name,
    });
    shape(el, 'title', {}, path.name);
  }
  if (zoom >= 1.35 && inView(wx)) {
    const x = position(junction - 1.7);
    textAt(plot, x, laneY(4.15), 'DC connection to P6', {
      'text-anchor': 'end',
      'font-size': 12,
      fill: routeColours.dc,
    });
    textAt(plot, x, laneY(9) + 13, 'Watford yard access', {
      'text-anchor': 'end',
      'font-size': 12,
      fill: routeColours.abbey,
    });
  }
  const labels = shape(plot, 'g', {});
  for (const branch of [dc, abbey]) {
    const isDC = branch === dc;
    for (const s of branch.stations) {
      if (s.code === 'WFJ') continue;
      const x = position(diagram.columns.get(s.code));
      if (!inView(x)) continue;
      for (const lane of isDC ? [2, 3] : [10]) {
        const y = laneY(lane) + 5;
        shape(plot, 'line', {
          x1: x - 5,
          x2: x + 5,
          y1: y,
          y2: y,
          stroke: routeColours[branch.id],
          'stroke-width': 3,
        });
      }
    }
    const named = branch.stations.filter((s) => !layout.stations.some((main) => main.code === s.code));
    const top = isDC
      ? Math.max(65 * verticalScale, 20 * verticalScale + 44, 41 * verticalScale + 22)
      : Math.max(laneY(10) + 41, 536 * verticalScale);
    stationLabels(labels, named, top, (isDC ? 89 : 556) * verticalScale);
  }
  for (const [p, lane] of laneByPlatform) {
    const y = laneY(lane),
      colour = lane < 5 ? routeColours.dc : lane === 10 ? routeColours.abbey : 'var(--platform)';
    if (!inView(wx)) continue;
    const group = shape(plot, 'g', { 'data-platform': p, 'aria-label': 'Watford Junction platform ' + p });
    shape(group, 'title', {}, 'Watford Junction · platform ' + p);
    shape(group, 'line', {
      x1: position(junction - 0.75),
      x2: position(junction + 0.75),
      y1: y + 6,
      y2: y + 6,
      stroke: colour,
      'stroke-width': 4,
    });
    // The Abbey signal sits directly below P10 at the station centre.
    textAt(group, p === '10' ? wx - 8 : wx, y + 22, 'P' + p, {
      'text-anchor': p === '10' ? 'end' : 'middle',
      'font-size': 15,
      'font-weight': 700,
      fill: colour,
    });
    if (lane <= 4 || p === '10') {
      const end = position(junction + 1);
      shape(group, 'line', { x1: end, x2: end, y1: y - 4, y2: y + 4, stroke: colour, 'stroke-width': 2 });
    }
  }
  const end = position(diagram.abbeyEnd);
  shape(plot, 'line', {
    x1: end,
    x2: end,
    y1: laneY(10) - 4,
    y2: laneY(10) + 4,
    stroke: routeColours.abbey,
    'stroke-width': 2,
  });
  for (const marker of markers) {
    if (!marker.track.branch || !visible(marker)) continue;
    const x = position(marker.x),
      y = laneY(berthLane(marker));
    drawSignal(plot, marker, x, y, values, zoom < 1.7);
    if (values[marker.id]) occupied.push({ m: marker, x, y });
  }
  plot.append(labels);
}
function drawMap(values) {
  const svg = $('map'),
    focusKey = document.activeElement?.dataset.key;
  const merged = showBranches(),
    naturalHeight = merged ? 592 : 368;
  let height = naturalHeight;
  mapWidth = baseWidth;
  if (diagramOnly) {
    const { clientWidth: w, clientHeight: h } = drawing;
    if (w > 0 && h > 0) {
      // Reflow the track coordinates along both axes. A uniform SVG scale
      // keeps the lettering, signal circles and train badges in proportion.
      const scale = Math.min(w / 840, h / (naturalHeight * 0.82), 1.5);
      mapWidth = w / scale;
      height = h / scale;
    }
  }
  verticalScale = height / naturalHeight;
  svg.setAttribute('viewBox', '0 0 ' + mapWidth + ' ' + height);
  svg.replaceChildren();
  const defs = shape(svg, 'defs', {});
  shape(shape(defs, 'clipPath', { id: 'plot' }), 'rect', { x: 103, y: 0, width: mapWidth - 104, height });
  const plot = shape(svg, 'g', { 'clip-path': 'url(#plot)' });
  const stations = layout.stations.filter(
    (s) =>
      inView(position(diagram.columns.get(s.code))) &&
      (zoom < 1 || centre !== home || ['APS', 'HML', 'BKM'].includes(s.code)),
  );
  const occupied = [];
  const mainY = (i) => (merged ? laneY(5 + i) : (97 + i * 66) * verticalScale);
  for (const s of stations) {
    const column = diagram.columns.get(s.code);
    const atJunction = merged && s.code === watford.code;
    const sharedDC = merged && dc.stations.some((stop) => stop.code === s.code);
    const top = atJunction ? 50 * verticalScale : (sharedDC ? laneY(2) : mainY(0)) - 26;
    const bottom = atJunction ? laneY(10) + 24 : mainY(3) + 24;
    const d = 'M' + position(column) + ' ' + top + 'V' + bottom;
    shape(plot, 'path', {
      d,
      fill: 'none',
      stroke: atJunction
        ? 'var(--junction-band)'
        : s.code === 'HML'
          ? 'var(--hemel-band)'
          : 'var(--station-band)',
      'stroke-width': atJunction ? 1.5 * slotPitch() : 24,
      'stroke-linejoin': 'round',
      'pointer-events': 'none',
    });
    shape(plot, 'path', {
      d,
      fill: 'none',
      stroke: atJunction ? 'var(--junction-guide)' : 'var(--station-guide)',
      'stroke-dasharray': '2 6',
      'pointer-events': 'none',
    });
  }
  stationLabels(plot, stations, 20 * verticalScale, 41 * verticalScale);
  for (const [i, t] of layout.tracks.entries()) {
    const y = mainY(i);
    textAt(svg, 17, y - 1, t.name, { 'text-anchor': 'start' });
    textAt(svg, 17, y + 14, t.direction === 1 ? '→ Down' : '← Up', {
      'text-anchor': 'start',
      'font-size': 10,
      fill: 'var(--board-muted)',
    });
    shape(plot, 'line', {
      x1: position(diagram.main[i].start),
      x2: position(diagram.main[i].end),
      y1: y,
      y2: y,
      stroke: 'var(--rail)',
      'stroke-width': 2,
      'data-track': t.name,
    });
    for (const s of stations) {
      if (merged && s.code === 'WFJ') continue;
      const x = position(diagram.columns.get(s.code));
      shape(plot, 'line', {
        x1: x - 11,
        x2: x + 11,
        y1: y + 6,
        y2: y + 6,
        stroke: 'var(--platform)',
        'stroke-width': 3.5,
      });
    }
    for (const berth of t.berths) {
      const m = byBerth.get(berth.id);
      if (!visible(m)) continue;
      const x = position(m.x);
      drawSignal(plot, m, x, y, values, zoom < 0.6);
      if (values[m.id]) occupied.push({ m, x, y });
    }
  }
  if (merged) {
    drawJunction(plot, values, occupied);
    for (const [lane, label, colour] of [
      [1, 'Watford DC', routeColours.dc],
      [2, '→ Down DC', routeColours.dc],
      [3, '← Up DC', routeColours.dc],
      [9, 'Bay', routeColours.bay],
      [10, 'Abbey line', routeColours.abbey],
    ]) {
      textAt(svg, 17, laneY(lane) + 3, label, { 'text-anchor': 'start', fill: colour, 'font-size': 12 });
    }
  }
  drawTrains(shape(plot, 'g', {}), occupied, values);
  const y = height - 13;
  textAt(svg, 109, y, '← LONDON EUSTON', {
    'text-anchor': 'start',
    'font-size': 10,
    fill: 'var(--board-muted)',
  });
  textAt(svg, mapWidth - 15, y, 'MILTON KEYNES →', {
    'text-anchor': 'end',
    'font-size': 10,
    fill: 'var(--board-muted)',
  });
  if (focusKey)
    svg.querySelector('[data-key="' + CSS.escape(focusKey) + '"]')?.focus({ preventScroll: true });
  const reports = (mode === 'live' ? live : replayBoard).abbey;
  $('branch-status').hidden = !merged;
  $('branch-status').textContent =
    mode === 'replay' && !reports
      ? 'Abbey station reports were not captured in this recording.'
      : !fresh('AB')
        ? 'Abbey station reports unavailable · showing any last-known reports.'
        : reports?.reports.length
          ? 'Abbey markers show the last reported station call.'
          : 'Awaiting the next Abbey station report.';
  $('zoomin').disabled = zoom === 4;
  $('zoomout').disabled = zoom === minZoom;
  const target = new URL(viewLink.href);
  if (zoom === minZoom) target.searchParams.set('view', 'sector');
  else if (centre === junction && zoom === 2) target.searchParams.set('view', 'watford');
  else target.searchParams.delete('view');
  viewLink.href = target.href;
  $('extent').textContent =
    zoom === minZoom
      ? '15 rail miles each way · WCML, Watford DC & Abbey line'
      : zoom === 1 && centre === home
        ? 'Apsley to Berkhamsted · Four running lines'
        : Math.abs(centre - junction) < 0.01
          ? 'Watford Junction · DC, main-line and Abbey platforms'
          : 'Hemel sector · WCML';
}

function trainDetails(board) {
  const t = trainSelection;
  const { marker: m, current, service, ambiguous } = locateTrain(t, markers, board);
  const identified = Boolean(service) || isTrainCode(t.head);
  $('popout-title').textContent = identified ? 'Train details' : 'Berth description';
  const box = $('train-content');
  box.replaceChildren();
  const title = node('div', undefined, 'servicehead');
  title.append(node('b', t.head, 'traincode'));
  const name = (s) =>
    s
      ?.toLowerCase()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\bDc\b/g, 'DC') || 'Unknown';
  title.append(
    node(
      'strong',
      service
        ? name(service.origin) + ' → ' + name(service.destination)
        : identified
          ? 'Train service'
          : 'Signalling description',
    ),
  );
  box.append(title);
  const hhmm = (s) =>
    s && /^\d{4}H?$/.test(s) ? s.slice(0, 2) + ':' + s.slice(2, 4) + (s.endsWith('H') ? '½' : '') : '—';
  if (service) {
    const delay = Number.isFinite(service.delay)
      ? service.delay === 0
        ? 'On time'
        : Math.abs(service.delay) + ' min ' + (service.delay > 0 ? 'late' : 'early')
      : 'Timing unavailable';
    const details = node('dl', undefined, 'serviceinfo');
    for (const [k, v] of [
      ['Booked times', hhmm(service.departure) + ' → ' + hhmm(service.arrival)],
      ['Reported running', delay],
      ['Operator', operators[service.operator] || service.operator || 'Unknown'],
      ['Schedule UID', service.uid || '—'],
    ]) {
      details.append(node('dt', k), node('dd', v));
    }
    box.append(details);
  } else
    box.append(
      node(
        'p',
        ambiguous
          ? 'Several services share this headcode here.'
          : identified
            ? 'Service details unavailable for this description.'
            : 'Operational code reported by the train describer.',
        'empty',
      ),
    );
  if (service?.action) {
    box.append(
      node(
        'div',
        (fresh('AB') ? 'Last station report' : 'Last known station report') +
          ' · ' +
          (service.action === 'departed' ? 'Departed ' : 'Arrived at ') +
          layout.branches[1].stations.find((s) => s.code === service.station)?.name +
          (service.at ? ' at ' + service.at : ''),
        'detail',
      ),
    );
  } else {
    const condition = !fresh(t.area) ? 'Last known' : current ? 'Current' : 'Last seen';
    box.append(
      node('div', condition + ' · ' + m.track.name + ' · ' + markerLocation(m) + ' · ' + t.area, 'detail'),
    );
  }
}
const operators = {
  VT: 'Avanti West Coast',
  LM: 'WM Trains',
  LO: 'London Overground',
  DB: 'DB Cargo UK',
  GB: 'GB Railfreight',
  FL: 'Freightliner',
};
let markerPressed = false;
document.addEventListener(
  'pointerdown',
  (e) => {
    markerPressed = Boolean(e.target.closest?.('.marker,.trainrow'));
  },
  true,
);
for (const event of ['pointerup', 'pointercancel'])
  window.addEventListener(
    event,
    () => {
      markerPressed = false;
    },
    true,
  );
function render(force = false) {
  if (markerPressed && !force) return;
  const board = state(),
    stale = mode === 'live' && (fetchFault || !['Live', 'Partial'].includes(board.status));
  const label = mode === 'replay' ? 'Recorded replay' : fetchFault ? 'Local server offline' : board.status;
  $('status').textContent = label;
  $('indicator').className = mode === 'replay' ? 'replay' : label === 'Live' ? 'live' : '';
  const shownTime = mode === 'replay' ? cursor : board.observed;
  $('asof').textContent = shownTime
    ? (mode === 'replay' ? day.format(shownTime) + ' · ' : '') + clock.format(shownTime)
    : '';
  $('areas').textContent = layout.areas
    .map(
      (area) =>
        area +
        ' ' +
        (mode === 'replay'
          ? board.areaTimes[area]
            ? 'recorded'
            : 'unrecorded'
          : fetchFault
            ? 'offline'
            : (board.areaStatus?.[area] ?? 'connecting')),
    )
    .join(' · ');
  $('notice').textContent =
    mode === 'live' && stale
      ? board.observed
        ? 'Waiting for fresh sector observations. Any train labels show the last known position.'
        : 'Waiting for the public feed. You can also open the recorded replay.'
      : mode === 'live' && board.status === 'Partial'
        ? 'Partial live coverage · check feed status for each area.'
        : mode === 'replay' && (zoom < 1 || centre !== home) && !board.areaTimes.WJ
          ? 'Recorded coverage is Rugby R1. Watford WJ has no observations in this sample.'
          : '';
  const signature = JSON.stringify([
    board.values,
    board.events[0],
    selection,
    trainSelection?.head,
    board.services,
    mode,
    stale,
    board.areaStatus,
    board.abbey,
  ]);
  if (!force && signature === lastDraw) return;
  lastDraw = signature;
  if (trainSelection) trainDetails(board);
  drawMap(board.values);
  positionPopout();
  {
    const m = byBit.get(selection) || byBerth.get(selection);
    const status = !fresh(m.id.slice(0, 2)) ? 'unknown' : (board.values[m.bit] ?? 'unknown');
    const indication =
      status === 'off'
        ? 'off (less restrictive)'
        : status === 'on'
          ? 'on (most restrictive)'
          : 'indication unknown';
    const showReadout = diagramOnly && inspectedSignal;
    $('signal-readout').hidden = !showReadout;
    $('diagram-hint').hidden = showReadout;
    if (showReadout) $('signal-readout').textContent = m.signal + ' · ' + m.track.name + ' · ' + indication;
    $('inspection').replaceChildren(
      node('strong', m.signal + ' · ' + m.track.name),
      ' — ',
      indication,
      node('div', 'Berth ' + m.id.slice(2) + '  /  Signal bit ' + m.bit, 'detail'),
    );
  }
  const active = markers.filter((b) => board.values[b.id] && visible(b));
  const reports = active.filter((m) => m.kind === 'station-report').length;
  const berths = active.length - reports;
  $('count').textContent =
    berths +
    ' occupied ' +
    (berths === 1 ? 'berth' : 'berths') +
    (reports ? ' · ' + reports + ' station ' + (reports === 1 ? 'report' : 'reports') : '');
  const list = $('trains');
  list.replaceChildren();
  if (!active.length)
    list.append(
      node('p', stale ? 'Awaiting current positions.' : 'No descriptions in the mapped berths.', 'empty'),
    );
  for (const b of active) {
    const row = node('button', undefined, 'trainrow');
    row.append(
      node('span', board.values[b.id], 'traincode'),
      node('span', b.track.name),
      node('span', markerLocation(b), 'detail'),
    );
    row.onclick = () => select(b.id, row, board.values[b.id]);
    list.append(row);
  }
  const log = $('events');
  log.replaceChildren();
  const localEvents = board.events.filter((e) => {
    const m = byBit.get(e.key) || byBerth.get(e.key);
    return m && visible(m);
  });
  if (!localEvents.length) log.append(node('li', 'Waiting for the next change.', 'empty'));
  for (const event of localEvents.slice(0, 18)) {
    const row = node('li', undefined, 'eventrow');
    let summary = event.label + ' · ' + (event.value ?? 'unknown');
    if (event.kind === 'berth')
      summary = event.value
        ? event.value + ' entered ' + event.label
        : (event.before || 'Description') + ' left ' + event.label;
    row.append(
      node('time', clock.format(event.time), 'time'),
      node('span', summary),
      node('span', event.track, 'detail'),
    );
    log.append(row);
  }
}
async function poll() {
  try {
    live = await request('/api/live');
    fetchFault = false;
  } catch {
    fetchFault = true;
  }
  if (mode === 'live') render();
  setTimeout(poll, 1000);
}
function seek(time) {
  if (!replayBoard || time < cursor) {
    replayBoard = new Corridor(layout);
    index = 0;
    if (trainSelection) {
      if (popout.open) popout.close();
      trainSelection = null;
      selection = 'R103:7';
    }
  }
  cursor = time;
  while (index < recording.frames.length && recording.frames[index].time <= cursor)
    replayBoard.apply(recording.frames[index++]);
  $('scrub').value = cursor - recording.frames[0].time;
  const seconds = Math.floor(Number($('scrub').value) / 1000);
  $('elapsed').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  render();
}
const recordings = new Map();
let modeRequest = 0;
async function switchMode(next, fitRecording = true) {
  const requestId = ++modeRequest;
  if (next === 'replay') {
    const sample = $('sample').value;
    try {
      if (!recordings.has(sample)) recordings.set(sample, await request(sample));
    } catch {
      if (requestId === modeRequest) $('notice').textContent = 'The recorded sample could not be loaded.';
      return;
    }
    if (requestId !== modeRequest) return;
    recording = recordings.get(sample);
    if (fitRecording && sample.includes('watford')) {
      centre = overview;
      zoom = minZoom;
    }
  }
  if (requestId !== modeRequest) return;
  mode = next;
  inspectedSignal = false;
  if (popout.open) popout.close();
  trainSelection = null;
  selection = 'R103:7';
  for (const name of ['live', 'replay']) $(name).setAttribute('aria-pressed', String(name === mode));
  $('replaybar').hidden = mode !== 'replay';
  if (mode === 'replay') {
    $('scrub').max = recording.frames.at(-1).time - recording.frames[0].time;
    replayBoard = null;
    playing = true;
    $('run').textContent = 'Pause';
    seek(recording.frames[0].time);
  }
  render(true);
}
$('live').onclick = () => switchMode('live');
$('replay').onclick = () => switchMode('replay');
$('sample').onchange = () => switchMode('replay');
$('run').onclick = () => {
  if (cursor >= recording.frames.at(-1).time) seek(recording.frames[0].time);
  playing = !playing;
  $('run').textContent = playing ? 'Pause' : 'Play';
};
$('scrub').oninput = (e) => seek(recording.frames[0].time + Number(e.target.value));
$('speed').onchange = (e) => {
  rate = Number(e.target.value);
};
let previous = performance.now();
setInterval(() => {
  const now = performance.now(),
    dt = now - previous;
  previous = now;
  if (mode !== 'replay' || !playing) return;
  const end = recording.frames.at(-1).time;
  seek(Math.min(end, cursor + dt * rate));
  if (cursor >= end) {
    playing = false;
    $('run').textContent = 'Play again';
  }
}, 250);
$('sector').onclick = () => {
  centre = overview;
  setZoom(minZoom);
};
$('junction').onclick = () => {
  centre = junction;
  setZoom(2);
};
$('zoomin').onclick = () => setZoom(zoom * 1.5);
$('zoomout').onclick = () => setZoom(zoom / 1.5);
$('home').onclick = () => {
  centre = home;
  setZoom(1);
};
const svg = $('map');

svg.addEventListener('pointerdown', (e) => {
  moved = false;
  dragging = { x: e.clientX, centre };
});
svg.addEventListener('pointermove', (e) => {
  if (!dragging || zoom === minZoom) return;
  const dx = e.clientX - dragging.x;
  if (Math.abs(dx) > 5) {
    moved = true;
    svg.setPointerCapture(e.pointerId);
    centre = dragging.centre - dx / svg.getScreenCTM().a / slotPitch();
    clampCentre();
    render(true);
  }
});
window.addEventListener('pointerup', () => {
  dragging = null;
});
svg.addEventListener('pointercancel', () => {
  dragging = null;
});
function updateDisplay() {
  diagramOnly = readDisplayMode();
  render(true);
}
viewLink.addEventListener('click', (event) => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState(null, '', viewLink.href);
  updateDisplay();
});
window.addEventListener('popstate', updateDisplay);
new ResizeObserver(() => {
  if (diagramOnly) render(true);
  else positionPopout();
}).observe(drawing);
new ResizeObserver(positionPopout).observe(popout);
const initialView = new URLSearchParams(location.search).get('view');
if (initialView === 'sector') {
  centre = overview;
  zoom = minZoom;
} else if (initialView === 'watford') {
  centre = junction;
  zoom = 2;
}
if (document.documentElement.hasAttribute('data-recorded-preview')) {
  $('live').disabled = true;
  $('live').title = 'Live feed is available with the local Node server';
  $('live').setAttribute('aria-pressed', 'false');
  if (initialView === 'watford' || initialView === 'sector') $('sample').value = '/data/watford-replay.json';
  await switchMode('replay', false);
} else {
  render(true);
  poll();
}
