import {panelSettings, settingGroup, trainLabelControl} from './panel/settings.mjs';
import {mapGestures} from './panel/gestures.mjs';
import {readSetting, saveSetting} from './panel/appearance.mjs';
import {trainLabel} from './train-label.mjs';
import {drawHeadcode, drawSignalLamp, showHeadcode, showSignalAspect, trainWidth} from './rail-symbols.mjs';
import {
  Corridor,
  locateTrain,
  corridorTracks,
  withStationReports,
  berthDiagram,
  fitStationNames,
  junctionPathSlots,
} from '/rail.mjs';
import { createLiveFeed } from '/live.mjs';
import { stationArrivals, isTrainCode, hemelBerths, hemelTrains, cardCandidates, cardRotation, schedulePath, readHemelSchedule, describeCard, stationName, operators } from '/hemel.mjs';

const $ = (id) => document.getElementById(id);
const panel = document.querySelector('.panel');
const viewLink = $('diagram-view');
const defaultDisplay = 'diagram';
function readDisplayMode() {
  const url = new URL(location.href);
  const only = (url.searchParams.get('display') ?? defaultDisplay) === 'diagram';
  document.documentElement.classList.toggle('diagram-only', only);
  const next = only ? 'dashboard' : 'diagram';
  if (next === defaultDisplay) url.searchParams.delete('display');
  else url.searchParams.set('display', next);
  viewLink.href = url.href;
  viewLink.textContent = only ? 'Show dashboard' : 'Expand map';
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
  replayStart,
  replayBoard,
  index = 0,
  cursor = 0,
  rate = 1;
const slotWidth = 64;
const plotHalfWidth = 504;
const baseWidth = 1140;
let mapWidth = baseWidth,
  verticalScale = 1;
let cardSpace, cardFrame;
const slotPitch = () => (slotWidth * zoom * (mapWidth - 132)) / (2 * plotHalfWidth);
let inspectedSignal = false;
let trainSelection = null;
let zoom = 1,
  centre,
  selection = 'R103:7';
let lastDraw = '';
const request = async (path) => {
  if (globalThis.transportApp && path.startsWith('/data/')) return transportApp.json(path);
  const response = await fetch(path, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw Error('Unavailable');
  return response.json();
};
const layout = await request('/data/corridor.json');
const arrivals = stationArrivals(layout);
const feed = createLiveFeed(layout, { onFrame: arrivals.accept, onReset: arrivals.reset, abbeyEndpoint: new URL('/api/abbey-lookup', location.origin) });
let live = feed.snapshot();
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
const hemel = hemelBerths(layout);
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
  saveSetting('hemel.view', {zoom, centre});
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
    (document.querySelector('.marker[data-key="' + CSS.escape(key ?? '') + '"]') ?? $('open-settings')).focus({
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
  inspectedSignal = diagramOnly && !(inspectedSignal && selection === key);
  selection = key;
  closeTrain();
  render(true);
}
$('close-train').onclick = () => closeTrain(true);
function closeSignal(restoreFocus = false) {
  inspectedSignal = false;
  $('signal-readout').hidden = true;
  if (restoreFocus)
    (drawing.querySelector('.marker[data-key="' + CSS.escape(selection) + '"]') ?? $('open-settings')).focus({
      preventScroll: true,
    });
}
$('close-signal').onclick = () => closeSignal(true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (popout.open || inspectedSignal)) {
    e.preventDefault();
    if (popout.open) closeTrain(true);
    else closeSignal(true);
  }
});
document.addEventListener('click', (e) => {
  if (
    (popout.open || inspectedSignal) &&
    !popout.contains(e.target) &&
    !e
      .composedPath()
      .some(
        (n) =>
          n.classList?.contains('marker') ||
          n.classList?.contains('trainrow') ||
          n.classList?.contains('diagram-tools') ||
          n.id === 'signal-readout' ||
          n.id === 'replaybar' ||
          n.classList?.contains('zoom'),
      )
  ) {
    closeTrain();
    if (inspectedSignal) closeSignal();
  }
});
function fresh(area) {
  if (area === 'AB') {
    const report = (mode !== 'live' ? replayBoard : live).abbey;
    return Boolean(report?.available && (mode !== 'live' || Date.now() - report.checked < 90000));
  }
  return mode !== 'live'
    ? Boolean(replayBoard.areaTimes[area])
    : live.areaStatus[area] === 'Live';
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
  el.addEventListener('click', () => select(key, el, shownHead));
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
    showSignalAspect(drawSignalLamp(shape, signal, 0, 0, small), indication);
    if (!small && !m.platform && (zoom >= 3 || selected))
      shape(
        plot,
        'text',
        { x, y: y + 22, 'text-anchor': 'middle', fill: 'var(--board-muted)', 'font-size': 10 },
        m.signal,
      );
  }
}
function drawTrains(trainsLayer, occupied, values, services) {
  occupied.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [i, { m, x, y }] of occupied.entries()) {
    const prev = occupied[i - 1],
      next = occupied[i + 1];
    const left = prev?.y === y && prev.x < x ? x - prev.x : Infinity;
    const right = next?.y === y && next.x > x ? next.x - x : Infinity;
    const width = Math.min(trainWidth, left - 2, right - 2);
    const stale = !fresh(m.id.slice(0, 2)),
      head = values[m.id];
    const train = activate(
      trainsLayer,
      'translate(' + x + ' ' + y + ')',
      m.id,
      head + ' · ' + m.track.name + ' · ' + markerLocation(m),
      head,
    );
    const selected = trainSelection?.head === head && trainSelection?.berth === m.id;
    const friendly = labels.friendly ? trainLabel(services[m.id.slice(0, 2) + '/' + head]) : '';
    showHeadcode(drawHeadcode(shape, train, 0, 0, width, selected), head, stale ? 3 : 1, friendly);
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
function stationLabels(plot, stations, y, rowOffset) {
  const items = stations
    .map((station) => {
      const column = diagram.columns.get(station.code);
      return { station, column, x: position(column) };
    })
    .filter((s) => inView(s.x));
  const bounds = { top: Infinity, bottom: 0 };
  for (const item of fitStationNames(items, 105, mapWidth - 4, measureLabel)) {
    const baseline = y + item.row * rowOffset;
    stationLabel(plot, item, baseline);
    bounds.top = Math.min(bounds.top, baseline - item.size);
    bounds.bottom = Math.max(bounds.bottom, baseline + 5);
  }
  return bounds;
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
  button.addEventListener('click', visit);
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      visit();
    }
  });
  shape(button, 'rect', { x: labelX - width / 2, y: y - size, width, height: size + 5, rx: 3 });
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
    stationLabels(labels, named, top, Math.max(22, (isDC ? 89 : 556) * verticalScale - top));
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
    if (isTrainCode(values[marker.id])) occupied.push({ m: marker, x, y });
  }
  plot.append(labels);
}
function drawMap(values, services) {
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
      // On phones, give names and train badges more of the available width.
      const designWidth = w < 600 ? (zoom === minZoom ? 590 : 460) : 840;
      const scale = Math.min(w / designWidth, h / (naturalHeight * 0.82), 1.5);
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
  const upperLabels = [], wcmlLabels = [];
  for (const s of stations) {
    const column = diagram.columns.get(s.code);
    const atJunction = merged && s.code === watford.code;
    const sharedDC = merged && dc.stations.some((stop) => stop.code === s.code);
    if (merged && !atJunction && !sharedDC) wcmlLabels.push(s);
    else upperLabels.push(s);
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
  const upperNames = stationLabels(plot, upperLabels, 20 * verticalScale, Math.max(22, 21 * verticalScale));
  // Keep both label rows above the Down Fast signal hit targets. A crowded
  // second row grows away from the track, even on a short display.
  const signalHitTop = mainY(0) - (zoom < 0.6 ? 22 : 30);
  const wcmlNames = stationLabels(plot, wcmlLabels, signalHitTop - 9, -22);
  // These are empty regions in the existing track geometry, in SVG units.
  // Cards use the right of the junction fan whenever that part of the map is visible.
  const fanEnd = position(junction + 1);
  const besideFan = merged && fanEnd < mapWidth - 160;
  cardSpace = {
    centre: inView(position(home)) ? position(home) : mapWidth / 2,
    left: besideFan ? Math.max(8, fanEnd + 10) : 8,
    fast: {
      top: upperNames.bottom + 4,
      bottom: Math.min(wcmlNames.top, signalHitTop) - 5,
      aboveNames: merged ? null : upperNames.top,
    },
    slow: {
      top: mainY(3) + (zoom >= 3 || inspectedSignal ? 26 : 15),
      bottom: merged ? laneY(10) - 13 : height - 5,
    },
  };
  queueCardPosition();
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
      if (isTrainCode(values[m.id])) occupied.push({ m, x, y });
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
  drawTrains(shape(plot, 'g', {}), occupied, values, services);
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
    mode !== 'live' && !reports
      ? 'Abbey station reports were not captured in this recording.'
      : !fresh('AB')
        ? 'Abbey station reports unavailable · showing any last-known reports.'
        : reports?.reports.length
          ? 'Abbey markers show the last reported station call.'
          : 'Awaiting the next Abbey station report.';
  $('zoomin').disabled = zoom === 4;
  $('zoomout').disabled = zoom === minZoom;
  for (const [id, selected] of [['sector',zoom === minZoom],['home',centre === home && zoom === 1],['junction',centre === junction && zoom === 2]])
    $(id).setAttribute('aria-pressed',String(selected));
  const target = new URL(viewLink.href);
  if (centre === home && zoom === 1) target.searchParams.set('view', 'hemel');
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
  title.append(
    node(
      'strong',
      service
        ? stationName(service.origin) + ' → ' + stationName(service.destination)
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
const activeSchedules = new Map();
const rotateCard = { fast: cardRotation(), slow: cardRotation() };

function queueCardPosition() {
  if (cardFrame) return;
  cardFrame = requestAnimationFrame(() => {
    cardFrame = null;
    if (!cardSpace) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const unit = matrix.a;
    const bounds = drawing.getBoundingClientRect();
    const offsetX = matrix.e - bounds.left, offsetY = matrix.f - bounds.top;
    const left = offsetX + cardSpace.left * unit;
    const available = drawing.clientWidth - left - 4;
    if (available <= 0 || !unit) return;
    for (const line of ['fast', 'slow']) {
      const card = $('hemel-' + line);
      if (card.hidden) continue;
      const slot = cardSpace[line];
      let top = offsetY + slot.top * unit, bottom = offsetY + slot.bottom * unit;
      // A narrow dashboard can have spare space above the close-up's station names.
      if (Number.isFinite(slot.aboveNames) && offsetY + slot.aboveNames * unit - 8 > bottom - top) {
        top = 4;
        bottom = offsetY + slot.aboveNames * unit - 4;
      }
      const compact = bottom - top < 56;
      card.classList.toggle('compact', compact);
      card.style.maxWidth = (compact ? Math.max(370, Math.min(455, available)) : Math.max(275, Math.min(330, available))) + 'px';
      const w = card.offsetWidth, h = card.offsetHeight;
      const scale = Math.min(1, available / w, (bottom - top) / h);
      const centre = offsetX + cardSpace.centre * unit;
      const x = Math.max(left, Math.min(drawing.clientWidth - w * scale - 4, centre - w * scale / 2));
      card.style.left = x + 'px';
      card.style.top = (line === 'fast' ? bottom - h * scale : top) + 'px';
      card.style.transform = 'scale(' + scale + ')';
    }
  });
}

function scheduleFor(service, canRequest) {
  if (!service) return null;
  if (mode !== 'live' && recording.hemelCalls) {
    const archived = recording.hemelCalls[service.id];
    return archived?.uid === service.uid ? archived : null;
  }
  const path = schedulePath(service, mode !== 'live' ? cursor : undefined);
  if (!path) return null;
  const key = mode + '/' + service.id + path;
  let entry = activeSchedules.get(key);
  if (!entry) {
    if (!canRequest) return null;
    entry = { call: null, retryAt: 0 };
    activeSchedules.set(key, entry);
  }
  entry.lastUsed = Date.now();
  if (canRequest && !document.hidden && entry.lastUsed >= entry.retryAt) {
    entry.retryAt = Infinity;
    const replay = mode !== 'live';
    fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(9000) })
      .then(async (response) => response.ok ? readHemelSchedule(await response.text(), service, path) : null)
      .then((call) => {
        if (call) entry.call = replay && call.booked ? { booked: call.booked } : call;
      })
      .catch(() => {})
      .finally(() => {
        if (!entry.call || (!replay && entry.call.booked && !Number.isFinite(entry.call.delay))) {
          entry.retryAt = Date.now() + 45000;
        }
        if (activeSchedules.get(key) === entry && !document.hidden) updateHemelCards(state());
      });
  }
  return entry.call ?? (entry.retryAt === Infinity ? { pending: true } : null);
}

function updateHemelCards(board) {
  const groups = fresh('R1') ? hemelTrains(hemel, board, fresh) : { fast: [], slow: [] };
  for (const [line, trains] of Object.entries(groups)) {
    const card = $('hemel-' + line);
    const train = rotateCard[line](cardCandidates(trains, scheduleFor), performance.now());
    card.hidden = !train;
    if (!train) continue;
    const { head, route, company, context, timing } = describeCard(train);
    const signature = JSON.stringify([head, route, company, context, timing]);
    if (card.dataset.signature === signature) continue;
    card.dataset.signature = signature;
    const heading = node('div', undefined, 'card-heading');
    heading.append(node('b', head, 'headcode'), node('span', context, 'context'));
    const running = node('div', undefined, 'card-running');
    if (company) running.append(company + ' · ');
    running.append(node('b', timing));
    card.replaceChildren(heading, node('strong', route, 'card-route'), running);
    queueCardPosition();
  }
  const expiry = Date.now() - 15 * 60000;
  for (const [key, entry] of activeSchedules) if (entry.lastUsed < expiry) activeSchedules.delete(key);
}
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
    stale = mode === 'live' && !['Live', 'Partial'].includes(board.status);
  updateHemelCards(board);
  if (mode === 'live') {
    const incoming = arrivals.take(fresh('R1'), Date.now(), head => scheduleFor(board.services['R1/' + head], false)?.booked);
    for (const d of incoming) settings.sound.play(d.toUpperCase() === 'D', d === d.toLowerCase());
  }
  const label = mode === 'preview' ? (navigator.onLine ? 'Replay · awaiting live' : 'Offline replay')
    : mode === 'replay' ? 'Recorded replay' : board.status;
  $('status').textContent = label;
  $('indicator').className = mode !== 'live' ? 'replay' : label === 'Live' ? 'live' : '';
  const shownTime = mode !== 'live' ? cursor : board.observed;
  $('asof').textContent = shownTime
    ? (mode !== 'live' ? day.format(shownTime) + ' · ' : '') + clock.format(shownTime)
    : '';
  $('areas').textContent = layout.areas
    .map(
      (area) =>
        area +
        ' ' +
        (mode !== 'live'
          ? board.areaTimes[area]
            ? 'recorded'
            : 'unrecorded'
          : board.areaStatus[area]),
    )
    .join(' · ');
  $('notice').textContent =
    mode === 'live' && stale
      ? board.observed
        ? 'Waiting for fresh sector observations. Any train labels show the last known position.'
        : 'Waiting for the public feed. You can also open the recorded replay.'
      : mode === 'live' && board.status === 'Partial'
        ? 'Partial live coverage · check feed status for each area.'
        : mode !== 'live' && (zoom < 1 || centre !== home) && !board.areaTimes.WJ
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
  drawMap(board.values, board.services);
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
    $('signal-readout').hidden = !inspectedSignal;
    if (inspectedSignal)
      $('signal-indication').textContent = m.signal + ' · ' + m.track.name + ' · ' + indication;
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
function syncLiveFeed() {
  if (mode !== 'replay' && !document.hidden && navigator.onLine) feed.start();
  else feed.stop();
  live = feed.snapshot();
  if (mode === 'live') render();
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
  $('scrub').value = cursor - replayStart;
  const seconds = Math.floor(Number($('scrub').value) / 1000);
  $('elapsed').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  render();
}
const recordings = new Map();
let modeRequest = 0;
async function switchMode(next, fitRecording = false) {
  const requestId = ++modeRequest;
  if (next !== 'live') {
    const sample = $('sample').value;
    try {
      if (!recordings.has(sample)) recordings.set(sample, await request(sample));
    } catch {
      if (requestId === modeRequest) $('notice').textContent = 'The recorded sample could not be loaded.';
      return;
    }
    if (requestId !== modeRequest) return;
    recording = recordings.get(sample);
    replayStart = recording.startTime ?? recording.frames[0].time;
    if (fitRecording) {
      const watfordSample = sample.includes('watford'), hemelSample = sample.includes('/hemel-');
      centre = watfordSample ? junction : hemelSample ? home : overview;
      zoom = watfordSample ? 2 : hemelSample ? 1 : minZoom;
      saveSetting('hemel.view', {zoom, centre});
    }
  }
  if (requestId !== modeRequest) return;
  mode = next;
  inspectedSignal = false;
  if (popout.open) popout.close();
  trainSelection = null;
  selection = 'R103:7';
  for (const name of ['live', 'replay']) $(name).setAttribute('aria-pressed', String(name === (mode === 'replay' ? 'replay' : 'live')));
  $('replaybar').hidden = mode !== 'replay';
  if (mode !== 'live') {
    $('scrub').max = recording.frames.at(-1).time - replayStart;
    replayBoard = null;
    playing = true;
    $('run').textContent = 'Pause';
    seek(replayStart);
  }
  syncLiveFeed();
  render(true);
}
$('live').onclick = () => switchMode('live');
$('replay').onclick = () => switchMode('replay');
$('sample').onchange = () => switchMode('replay', true);
$('run').onclick = () => {
  if (cursor >= recording.frames.at(-1).time) seek(replayStart);
  playing = !playing;
  $('run').textContent = playing ? 'Pause' : 'Play';
};
$('scrub').oninput = (e) => seek(replayStart + Number(e.target.value));
$('speed').onchange = (e) => {
  rate = Number(e.target.value);
};
let previous = performance.now();
setInterval(() => {
  const now = performance.now(),
    dt = now - previous;
  previous = now;
  if (mode === 'live' || !playing) return;
  const end = recording.frames.at(-1).time;
  seek(Math.min(end, cursor + dt * rate));
  if (cursor >= end) {
    if (mode === 'preview') seek(replayStart);
    else {playing = false; $('run').textContent = 'Play again';}
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

let stepped = false;
mapGestures(svg, {
  drag(from, to) {
    if (zoom === minZoom) return;
    centre -= (to.x - from.x) / svg.getScreenCTM().a / slotPitch();
    clampCentre(); render(true);
  },
  pinch(from, to) {
    const ratio = to.span / from.span;
    if (stepped || Math.abs(to.span - from.span) < 18 || (ratio < 1.25 && ratio > .8)) return false;
    stepped = true;
    if (to.span < from.span) $('sector').click();
    else if (zoom === minZoom) {
      const x = new DOMPoint(from.x,from.y).matrixTransform(svg.getScreenCTM().inverse()).x;
      $(Math.abs(x-position(home)) <= Math.abs(x-position(junction)) ? 'home' : 'junction').click();
    }
    return true;
  },
  finish() { stepped = false; saveSetting('hemel.view',{zoom,centre}); }
});
function updateDisplay() {
  diagramOnly = readDisplayMode();
  if (!diagramOnly && document.fullscreenElement === document.documentElement)
    document.exitFullscreen().catch(() => {});
  closeSignal();
  render(true);
}
viewLink.addEventListener('click', (event) => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (
    !diagramOnly &&
    document.fullscreenEnabled &&
    matchMedia('(display-mode: browser) and (pointer: coarse)').matches
  ) {
    // Browsers require a user gesture. The diagram view also works if they decline.
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  history.pushState(null, '', viewLink.href);
  settings.close();
  updateDisplay();
});
window.addEventListener('popstate', updateDisplay);
let initialTheme = 'dark';
try { if (localStorage.getItem('traintimes.diagramTheme') === 'light') initialTheme = 'light'; } catch {}
const labels = trainLabelControl(() => render(true));
const settings = panelSettings({
  id:'hemel', name:'Hemel rail monitor', toolbar:document.querySelector('.diagram-tools'),
  status:document.querySelector('.source-status'), map:drawing, initialTheme,
  applyTheme(value) { panel.dataset.theme = value; },
  appControls:[
    settingGroup('Diagram view', $('sector'), $('home'), $('junction')),
    labels.group,
    settingGroup('Zoom', $('zoomout'), $('zoomin')),
    settingGroup('Data source', $('live'), $('replay')), $('replaybar'),
    settingGroup('Layout', viewLink), $('areas'), $('notice'), $('branch-status')
  ],
  installHelp:document.querySelector('.mobile-install'),
  credits:'Network Rail via Signal Maps; schedules from Open Rail, Abbey reports from Railinfo, mappings from EASMData and station codes from the Office of Rail and Road.'
});
document.querySelector('.zoom').remove();
document.querySelector('.modebox').remove();
new ResizeObserver(() => {
  if (diagramOnly) render(true);
  else {
    positionPopout();
    queueCardPosition();
  }
}).observe(drawing);
new ResizeObserver(positionPopout).observe(popout);
const initialView = new URLSearchParams(location.search).get('view') ?? globalThis.transportApp?.manifest?.defaultView ?? 'sector';
if (initialView === 'sector') {
  centre = overview;
  zoom = minZoom;
} else if (initialView === 'watford') {
  centre = junction;
  zoom = 2;
}
const saved = readSetting('hemel.view');
if (!new URLSearchParams(location.search).has('view') && Number.isFinite(saved?.centre) && Number.isFinite(saved.zoom)) {
  centre = saved.centre; zoom = Math.max(minZoom,Math.min(4,saved.zoom)); clampCentre();
}
if (initialView === 'watford') $('sample').value = '/data/watford-replay.json';
if (initialView === 'hemel') $('sample').value = '/data/hemel-replay.json';
document.addEventListener('visibilitychange', syncLiveFeed);
window.addEventListener('offline', syncLiveFeed);
window.addEventListener('online', syncLiveFeed);
window.addEventListener('pagehide', feed.stop);
window.addEventListener('pageshow', syncLiveFeed);
syncLiveFeed();
switchMode('preview');
setInterval(() => {
  if (mode !== 'replay' && !document.hidden) {
    live = feed.snapshot();
    if (mode === 'preview' && ['Live','Partial'].includes(live.status)) switchMode('live');
    else render();
  } else if (mode !== 'live' && !playing && !document.hidden) updateHemelCards(replayBoard);
}, 1000);
