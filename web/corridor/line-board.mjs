import { corridorSpacing } from './spacing.mjs';
import { isTrainCode } from './hemel.mjs';
import { drawHeadcode, drawSignalLamp, showHeadcode, showSignalAspect, trainHeight, trainWidth } from './rail-symbols.mjs';
import { readSetting, saveSetting } from './panel/appearance.mjs';

// Draw the same package geometry and physical marker indices as the CrowPanel.
const ns = 'http://www.w3.org/2000/svg';
const keys = ['sector', 'hemel', 'watford'];
// The package contains the same two Hemel palettes used by the LCD.
function installPalette(container, tables) {
  const inks = tables.darkPalette.map((_, i) => 'var(--diagram-' + i + ')');
  const rules = (palette) =>
    palette.map((colour, i) => '--diagram-' + i + ':#' + colour.toString(16).padStart(6, '0')).join(';');
  const style = document.createElement('style');
  style.textContent =
    '#tracks.line-board{' +
    rules(tables.darkPalette) +
    '} :root[data-theme="light"] #tracks.line-board{' +
    rules(tables.lightPalette) +
    '}';
  container.append(style);
  return inks;
}
function svg(parent, tag, attributes, value) {
  const el = document.createElementNS(ns, tag);
  for (const [key, v] of Object.entries(attributes)) el.setAttribute(key, v);
  if (value !== undefined) el.textContent = value;
  parent.append(el);
  return el;
}
function translate(el, x, y) {
  el.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
}
function action(el, description, callback) {
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', description);
  el.setAttribute('tabindex', 0);
  el.addEventListener('click', callback);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      callback();
    }
  });
}
export function lineBoard(container, layout, tables, id, open) {
  const inks = installPalette(container, tables);
  const stations = new Map(layout.tracks.map((t) => [t.name, t]));
  const byId = new Map(layout.tracks.flatMap((t) => t.berths.map((b) => [b.id, { t, b }])));
  const offsets = [];
  const controls = document.querySelector('.map-controls');
  controls.hidden = false;
  const select = controls.querySelector('select');
  const [outButton, resetButton, inButton] = controls.querySelectorAll('.map-zoom button');
  const maxZoom = 3, step = 1.25;
  const savedZoom = readSetting(id + '.zoom', 1);
  container.className = 'line-board';
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Scrollable track diagram');
  const legend = svg(container, 'svg', {
    class: 'track-legend',
    role: 'group',
    'aria-label': 'Running lines',
  });
  const drawing = svg(container, 'svg', { role: 'group', 'aria-label': layout.name });
  let view = -1,
    points = [],
    locations = [],
    legendRows = [],
    stationPaint = [],
    legendWidth = 0,
    scale = 1,
    requestedZoom = Number.isFinite(savedZoom) ? Math.max(0, Math.min(maxZoom, savedZoom)) : 1,
    spacing, axis, selectedJump,
    rails = [], labels = [], spans = [],
    saveTimer,
    width;
  function stationAt(x) {
    return locations.findLast((s) => s[2] <= x) || locations[0];
  }
  function centre(x) {
    container.scrollLeft = axis.project(x) * scale - (container.clientWidth - legendWidth * scale) / 2;
  }
  function jump(id) {
    const stop = locations.find((s) => s[0] === id);
    if (stop) {
      centre(stop[3]);
      selectedJump = { id, left: container.scrollLeft };
      select.value = id;
    }
    return !!stop;
  }
  function sync() {
    if (!locations.length) return;
    const left = axis.unproject(container.scrollLeft / scale);
    for (const { el, intervals } of legendRows) {
      const title = intervals.find(([from, to]) => from <= left && left < to)?.[3] || '';
      if (el.textContent !== title) el.textContent = title;
    }
    if (selectedJump && Math.abs(container.scrollLeft - selectedJump.left) < 1) {
      select.value = selectedJump.id;
      return;
    }
    selectedJump = null;
    const atEnd =
      container.scrollLeft > 0 && container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;
    select.value = (
      container.scrollLeft < 1 ? locations[0] : atEnd ? locations.at(-1)
        : stationAt(axis.unproject((container.scrollLeft + mapHalfWidth()) / scale))
    )[0];
  }
  select.onchange = () => {
    const stop = locations.find((s) => s[0] === select.value);
    if (stop) jump(stop[0]);
    sync();
  };
  container.addEventListener('scroll', sync, { passive: true });
  function mapHalfWidth() {
    return (container.clientWidth - legendWidth * scale) / 2;
  }
  function sizeDiagram() {
    // The SVG viewport and viewBox always have the same aspect ratio.
    drawing.setAttribute('viewBox', '0 0 ' + axis.width + ' 570');
    drawing.style.width = axis.width * scale + 'px';
    drawing.style.height = 570 * scale + 'px';
    legend.style.width = legendWidth * scale + 'px';
    legend.style.height = drawing.style.height;
    outButton.disabled = axis.zoom <= spacing.minZoom;
    inButton.disabled = axis.zoom >= maxZoom;
    resetButton.textContent = Math.round(axis.zoom * 100) + '%';
    resetButton.setAttribute('aria-label', 'Reset map zoom (' + resetButton.textContent + ')');
  }
  function place() {
    axis = spacing.at(requestedZoom);
    for (const { line, x1, x2, platform } of rails) {
      if (platform) {
        const middle = axis.project((x1 + x2) / 2), half = (x2 - x1) / 2;
        line.setAttribute('x1', middle - half);
        line.setAttribute('x2', middle + half);
      } else {
        line.setAttribute('x1', axis.project(x1));
        line.setAttribute('x2', axis.project(x2));
      }
    }
    for (const { group, x, y } of labels) translate(group, axis.project(x), y);
    for (const p of points) {
      const x = axis.project(p.x);
      translate(p.berth, x, p.y);
      if (p.signal) translate(p.signal, x + p.signalOffset, p.sy);
    }
    sizeDiagram();
  }
  function reflow() {
    const jumpId = selectedJump && Math.abs(container.scrollLeft - selectedJump.left) < 1
      ? selectedJump.id : null;
    const centre = axis?.unproject((container.scrollLeft + mapHalfWidth()) / scale);
    const boxes = labels.map(l => l.bounds);
    const clearanceSpans = spans.slice();
    for (const p of points) {
      if (!p.occupied) continue;
      const w = p.badgeWidth / 2 + 2, h = p.badgeHeight / 2 + 2;
      boxes.push({ x: p.x, left: -w, right: w, top: p.y - h, bottom: p.y + h });
      if (p.track) {
        clearanceSpans.push([p.track.x1, p.x, w + 3], [p.x, p.track.x2, w + 3]);
      }
    }
    for (const p of points) {
      if (!p.signal) continue;
      const radius = 9, top = p.sy - radius, bottom = p.sy + radius;
      // In a station fan a signal and a badge on the next road can share an
      // exact column. Give the lamp a clear spot beside that column.
      let dx = 0;
      for (const box of boxes) {
        if (box.x === p.x && box.top < bottom && box.bottom > top &&
            box.left < dx + radius + 4 && box.right > dx - radius - 4)
          dx = Math.max(dx, box.right + radius + 4);
      }
      p.signalOffset = dx;
      boxes.push({ x: p.x, left: dx - radius, right: dx + radius, top, bottom });
    }
    spacing = corridorSpacing(width, boxes, clearanceSpans);
    place();
    if (jumpId) jump(jumpId);
    else if (centre !== undefined) container.scrollLeft = axis.project(centre) * scale - mapHalfWidth();
    sync();
  }
  function saveZoom() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saveSetting(id + '.zoom', requestedZoom);
  }
  window.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) saveZoom();
  });
  function zoomAt(next, from, to = from) {
    const rect = container.getBoundingClientRect();
    const railLeft = rect.left + legendWidth * scale;
    const offset = (x) => x == null ? (container.clientWidth - legendWidth * scale) / 2 : Math.max(0, x - railLeft);
    const world = axis.unproject((container.scrollLeft + offset(from)) / scale);
    // Zero remembers the tightest layout, including when live occupancy changes.
    const request = next <= spacing.minZoom ? 0 : Math.min(maxZoom, next);
    if (requestedZoom !== request) {
      requestedZoom = request;
      place();
    }
    container.scrollLeft = axis.project(world) * scale - offset(to);
    sync();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveZoom, 150);
  }
  outButton.onclick = () => zoomAt(axis.zoom / step);
  inButton.onclick = () => zoomAt(axis.zoom * step);
  resetButton.onclick = () => zoomAt(1);
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientHeight : 1;
    zoomAt(axis.zoom * Math.exp(-e.deltaY * unit * 0.006), e.clientX);
  }, { passive: false });
  container.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['+', '=', '-', '0'].includes(e.key)) {
      e.preventDefault();
      zoomAt(e.key === '0' ? 1 : e.key === '-' ? axis.zoom / step : axis.zoom * step);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'End') container.scrollLeft = container.scrollWidth;
    else if (e.key === 'Home') container.scrollLeft = 0;
    else container.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * container.clientWidth * 0.65 });
  });
  function resize() {
    if (!axis) return;
    const position = container.scrollLeft / scale;
    scale = Math.max(0.72, Math.min(1.2, (innerHeight - container.getBoundingClientRect().top - 22) / 570));
    sizeDiagram();
    container.scrollLeft = position * scale;
    sync();
  }
  function paint(next, anchor) {
    if (axis) offsets[view] = axis.unproject(container.scrollLeft / scale);
    axis = null;
    selectedJump = null;
    view = next;
    const key = keys[view];
    width = tables[key + 'Width'];
    locations = tables[key + 'Stations'].map((s) => [
      ...s,
      tables[key + 'Labels'].find((l) => l[7] && l[6] === s[1])?.[0] ?? s[2],
    ]);
    legendWidth = tables[key + 'LegendWidth'] || 0;
    const intervals = tables[key + 'Legend'] || [];
    legend.replaceChildren();
    legend.style.display = legendWidth ? 'block' : 'none';
    if (legendWidth) legend.setAttribute('viewBox', '0 0 ' + legendWidth + ' 570');
    legendRows = [...new Set(intervals.map((r) => r[2]))]
      .sort((a, b) => a - b)
      .map((y) => ({
        el: svg(legend, 'text', {
          x: legendWidth / 2,
          y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-size': 12,
          fill: inks[1],
        }),
        intervals: intervals.filter((r) => r[2] === y),
      }));
    select.replaceChildren(...locations.map(([id, name]) => new Option(name, id)));
    drawing.replaceChildren();
    stationPaint = [];
    rails = [];
    labels = [];
    // Station bands on the same rails need separation even when their names
    // occupy staggered label rows above the track.
    spans = locations.slice(1).map((s, i) => [locations[i][3], s[3], 44]);
    for (const [x1, y1, x2, y2, ink, weight, station] of tables[key + 'Lines']) {
      const line = svg(drawing, 'line', { x1, y1, x2, y2, stroke: inks[ink], 'stroke-width': weight });
      const platform = ink === 4 && y1 === y2 && x2 > x1;
      rails.push({ line, x1, x2, y1, y2, ink, platform });
      if (platform) {
        const half = (x2 - x1) / 2;
        spans.push([x1, x1 + half, half], [x1 + half, x2, half]);
      } else if (x1 < x2) {
        // Leave a readable run for a turnout and a short length of open rail.
        spans.push([x1, x2, Math.min(x2 - x1, y1 === y2 ? 14 : 14 + Math.abs(y2 - y1) * 0.32)]);
      }
      if (station) {
        const id = tables.watchStations[station - 1][0];
        line.dataset.stationBand = id;
        stationPaint.push({ id, band: line, ink });
      }
    }
    for (const [x, y, width, size, ink, background, text, preset] of tables[key + 'Labels']) {
      const label = svg(drawing, 'g', { class: 'map-label' });
      let box;
      if (background >= 0)
        box = svg(label, 'rect', {
          x: -width / 2,
          y: -size / 2 - 3,
          width,
          height: size + 6,
          rx: 3,
          fill: inks[background],
          stroke: inks[background === 9 ? 12 : 11],
          'pointer-events': 'none',
        });
      const el = svg(
        label,
        'text',
        { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size, fill: inks[ink] },
        text,
      );
      labels.push({ group: label, el, box, x, y });
      if (preset) {
        const station = stations.get(text);
        el.classList.add('station');
        el.dataset.station = station.id;
        stationPaint.push({ id: station.id, box, label: el });
        action(el, 'Berth register for ' + text, () => open(station));
      }
    }
    // Measure in SVG units after the station font has been applied. Station
    // plates take their width from the name, including padding on both sides.
    const sizes = labels.map(l => l.el.getBBox());
    labels.forEach((l, i) => {
      const b = sizes[i];
      const half = Math.max(-b.x, b.x + b.width) + (l.box ? 8 : 0);
      if (l.box) {
        l.box.setAttribute('x', -half);
        l.box.setAttribute('width', 2 * half);
      }
      const h = l.box ? Number(l.box.getAttribute('height')) / 2 : 0;
      l.bounds = { x: l.x, left: -half, right: half,
        top: l.y + Math.min(-h, b.y), bottom: l.y + Math.max(h, b.y + b.height) };
    });
    const badgeWidth = tables[key + 'Space'][2], unit = badgeWidth / trainWidth;
    points = tables[key + 'Markers'].map(([index, x, y, sy, r]) => {
      const { t, b } = byId.get(tables.markerInfo[index][0]);
      const berth = svg(drawing, 'g', { 'data-berth': b.id, class: 'berth' });
      action(berth, 'Train', () => open(t, b));
      const symbol = svg(berth, 'g', { transform: 'scale(' + unit + ')' });
      const head = drawHeadcode(svg, symbol, 0, 0, trainWidth);
      let signal, lamp;
      if (r) {
        signal = svg(drawing, 'g', { class: 'signal', 'data-signal': b.signal });
        action(signal, b.signal, () => open(t, b, true));
        svg(signal, 'circle', { r: 9, fill: 'transparent' });
        lamp = drawSignalLamp(svg, signal, 0, 0, r < 4);
        lamp.setAttribute('r', r);
      }
      const track = rails.find(l => l.ink === 3 && l.y1 === y && l.y2 === y && l.x1 <= x && l.x2 >= x);
      return { index, x, y, sy, berth, head, signal, lamp, track, badgeWidth,
        badgeHeight: trainHeight * unit, occupied: false };
    });
    reflow();
    resize();
    const target = locations.find((s) => s[0] === anchor);
    if (target || offsets[next] == null) jump((target || locations[0])[0]);
    else container.scrollLeft = axis.project(offsets[next]) * scale;
    sync();
  }
  function update(rows, friendly, watchedStation, followedBerth) {
    for (const { id, band, ink, box, label } of stationPaint) {
      const watched = id === watchedStation;
      if (band) band.setAttribute('stroke', inks[watched ? 9 : ink]);
      if (box) {
        box.setAttribute('fill', inks[watched ? 9 : 0]);
        box.setAttribute('stroke', inks[watched ? 12 : 11]);
      }
      if (label)
        label.setAttribute(
          'aria-label',
          'Berth register for ' + label.textContent + (watched ? ' · Watching' : ''),
        );
    }
    let occupancyChanged = false;
    for (const point of points) {
      const { index, berth, head, signal, lamp } = point;
      const [aspect, kind, text] = rows[index];
      const visible = !!kind && isTrainCode(text);
      if (visible !== point.occupied) {
        point.occupied = visible;
        occupancyChanged = true;
      }
      berth.style.display = visible ? '' : 'none';
      const followed = visible && followedBerth === berth.dataset.berth;
      berth.classList.toggle('followed', followed);
      if (visible) berth.setAttribute('aria-label', 'Train ' + text + (followed ? ' · Following' : ''));
      showHeadcode(head, visible ? text : '', visible ? kind : 0, visible && friendly ? rows[index][6] : '');
      berth.classList.toggle('head', visible);
      berth.classList.toggle('stale', kind === 3);
      if (signal) {
        const value = ['unknown', 'on', 'off'][aspect];
        if (signal.dataset.value !== value) {
          signal.dataset.value = value;
          showSignalAspect(lamp, value);
        }
      }
    }
    if (occupancyChanged) reflow();
  }
  return {
    jump,
    focus(id) {
      const marker = points.find((p) => tables.markerInfo[p.index][0] === id);
      if (marker) centre(marker.x);
      return !!marker;
    },
    paint,
    update,
    resize,
    pinch(a, b) {
      if (b.span <= 0) return false;
      zoomAt(axis.zoom * b.span / a.span, a.x, b.x);
      return true;
    },
  };
}
