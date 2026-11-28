import { isTrainCode } from './hemel.mjs';
import { drawHeadcode, drawSignalLamp, showHeadcode, showSignalAspect, trainWidth } from './rail-symbols.mjs';
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
  const minZoom = 0.65, maxZoom = 3, step = 1.25;
  const savedZoom = readSetting(id + '.zoom', 1);
  container.className = 'line-board';
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Scrollable track diagram');
  const legend = svg(container, 'svg', {
    class: 'track-legend',
    role: 'group',
    'aria-label': 'Running lines',
  });
  const drawing = svg(container, 'svg', { role: 'group', 'aria-label': layout.name, preserveAspectRatio: 'none' });
  let view = -1,
    points = [],
    locations = [],
    legendRows = [],
    stationPaint = [],
    legendWidth = 0,
    scale = 1,
    zoom = Number.isFinite(savedZoom) ? Math.max(minZoom, Math.min(maxZoom, savedZoom)) : 1,
    saveTimer,
    width;
  function stationAt(x) {
    return locations.findLast((s) => s[2] <= x) || locations[0];
  }
  function centre(x) {
    container.scrollLeft = x * scale * zoom - (container.clientWidth - legendWidth * scale) / 2;
  }
  function jump(id) {
    const stop = locations.find((s) => s[0] === id);
    if (stop) centre(stop[3]);
    return !!stop;
  }
  function sync() {
    if (!locations.length) return;
    const left = container.scrollLeft / (scale * zoom);
    for (const { el, intervals } of legendRows) {
      const title = intervals.find(([from, to]) => from <= left && left < to)?.[3] || '';
      if (el.textContent !== title) el.textContent = title;
    }
    const atEnd =
      container.scrollLeft > 0 && container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;
    select.value = (
      atEnd ? locations.at(-1) : stationAt(left + (container.clientWidth / scale - legendWidth) / (2 * zoom))
    )[0];
  }
  select.onchange = () => {
    const stop = locations.find((s) => s[0] === select.value);
    if (stop) jump(stop[0]);
    sync();
  };
  container.addEventListener('scroll', sync, { passive: true });
  function sizeDiagram() {
    drawing.style.width = width * scale * zoom + 'px';
    drawing.style.height = 570 * scale + 'px';
    drawing.style.setProperty('--symbol-scale', 1 / zoom);
    drawing.style.setProperty('--label-scale', 1 / Math.max(1, zoom));
    legend.style.width = legendWidth * scale + 'px';
    legend.style.height = drawing.style.height;
    outButton.disabled = zoom <= minZoom;
    inButton.disabled = zoom >= maxZoom;
    resetButton.textContent = Math.round(zoom * 100) + '%';
    resetButton.setAttribute('aria-label', 'Reset map zoom (' + resetButton.textContent + ')');
  }
  function saveZoom() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saveSetting(id + '.zoom', zoom);
  }
  window.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) saveZoom();
  });
  function zoomAt(next, from, to = from) {
    const rect = container.getBoundingClientRect();
    const railLeft = rect.left + legendWidth * scale;
    const offset = (x) => x == null ? (container.clientWidth - legendWidth * scale) / 2 : Math.max(0, x - railLeft);
    const world = (container.scrollLeft + offset(from)) / (scale * zoom);
    zoom = Math.max(minZoom, Math.min(maxZoom, next));
    sizeDiagram();
    container.scrollLeft = world * scale * zoom - offset(to);
    sync();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveZoom, 150);
  }
  outButton.onclick = () => zoomAt(zoom / step);
  inButton.onclick = () => zoomAt(zoom * step);
  resetButton.onclick = () => zoomAt(1);
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientHeight : 1;
    zoomAt(zoom * Math.exp(-e.deltaY * unit * 0.006), e.clientX);
  }, { passive: false });
  container.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['+', '=', '-', '0'].includes(e.key)) {
      e.preventDefault();
      zoomAt(e.key === '0' ? 1 : e.key === '-' ? zoom / step : zoom * step);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'End') container.scrollLeft = container.scrollWidth;
    else if (e.key === 'Home') container.scrollLeft = 0;
    else container.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * container.clientWidth * 0.65 });
  });
  function resize() {
    if (!width) return;
    const position = container.scrollLeft / (scale * zoom);
    scale = Math.max(0.72, Math.min(1.2, (innerHeight - container.getBoundingClientRect().top - 22) / 570));
    sizeDiagram();
    container.scrollLeft = position * scale * zoom;
    sync();
  }
  function paint(next, anchor) {
    if (view >= 0) offsets[view] = container.scrollLeft / (scale * zoom);
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
    drawing.setAttribute('viewBox', '0 0 ' + width + ' 570');
    stationPaint = [];
    for (const [x1, y1, x2, y2, ink, weight, station] of tables[key + 'Lines']) {
      const line = svg(drawing, 'line', { x1, y1, x2, y2, stroke: inks[ink], 'stroke-width': weight });
      if (station) {
        const id = tables.watchStations[station - 1][0];
        line.dataset.stationBand = id;
        stationPaint.push({ id, band: line, ink });
      }
    }
    for (const [x, y, width, size, ink, background, text, preset] of tables[key + 'Labels']) {
      const anchor = svg(drawing, 'g', { transform: 'translate(' + x + ' ' + y + ')' });
      const label = svg(anchor, 'g', { class: 'map-label' });
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
      if (preset) {
        const station = stations.get(text);
        el.classList.add('station');
        el.dataset.station = station.id;
        stationPaint.push({ id: station.id, box, label: el });
        action(el, 'Berth register for ' + text, () => open(station));
      }
    }
    points = tables[key + 'Markers'].map(([index, x, y, sy, r]) => {
      const { t, b } = byId.get(tables.markerInfo[index][0]);
      const berth = svg(drawing, 'g', { 'data-berth': b.id, class: 'berth' });
      action(berth, 'Train', () => open(t, b));
      const unitScale = tables[key + 'Space'][2] / trainWidth;
      const centre = svg(berth, 'g', {
        transform: 'translate(' + x + ' ' + y + ') scale(' + unitScale + ')',
      });
      const head = drawHeadcode(svg, svg(centre, 'g', { class: 'train-symbol' }), 0, 0, trainWidth);
      let signal, lamp;
      if (r) {
        signal = svg(drawing, 'g', { class: 'signal', 'data-signal': b.signal, transform: 'translate(' + x + ' ' + sy + ')' });
        action(signal, b.signal, () => open(t, b, true));
        const symbol = svg(signal, 'g', { class: 'signal-symbol' });
        svg(symbol, 'circle', { r: 9, fill: 'transparent' });
        lamp = drawSignalLamp(svg, symbol, 0, 0, r < 4);
        lamp.setAttribute('r', r);
      }
      return { index, x, y, berth, head, signal, lamp };
    });
    resize();
    const target = locations.find((s) => s[0] === anchor);
    if (target || offsets[next] == null) jump((target || locations[0])[0]);
    else container.scrollLeft = offsets[next] * scale * zoom;
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
    let previous;
    const badgeWidth = tables[keys[view] + 'Space'][2];
    for (const point of points) {
      const { index, berth, head, signal, lamp } = point;
      const [aspect, kind, text] = rows[index];
      const visible = !!kind && isTrainCode(text);
      if (visible) {
        // Sorted by track and x. Neighbours only limit a badge while occupied.
        const gap = previous?.y === point.y ? (point.x - previous.x - 2) / badgeWidth : Infinity;
        const fit = Math.max(0.05, gap);
        if (previous) previous.berth.style.setProperty('--badge-fit', Math.min(previous.fit, fit));
        point.fit = Math.min(1, fit);
        previous = point;
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
    if (previous) previous.berth.style.setProperty('--badge-fit', previous.fit);
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
      zoomAt(zoom * b.span / a.span, a.x, b.x);
      return true;
    },
  };
}
