// Draw the same package geometry and physical marker indices as the CrowPanel.
const ns = 'http://www.w3.org/2000/svg';
const keys = ['sector', 'hemel', 'watford'];
const inks = ['var(--bg)', 'var(--fg)', 'var(--muted)', 'var(--rail)', 'var(--fg)'];
inks[8] = 'var(--edge)';
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
export function lineBoard(container, layout, tables, open) {
  const stations = new Map(layout.tracks.map((t) => [t.name, t]));
  const byId = new Map(layout.tracks.flatMap((t) => t.berths.map((b) => [b.id, { t, b }])));
  const offsets = [0, 0, 0];
  const nav = document.createElement('label'),
    select = document.createElement('select');
  nav.className = 'jump';
  nav.append('Location ', select);
  document.querySelector('.board-heading').append(nav);
  container.className = 'line-board';
  container.tabIndex = 0;
  container.setAttribute('aria-label', 'Scrollable track diagram');
  const drawing = svg(container, 'svg', { role: 'group', 'aria-label': layout.name });
  let view = -1,
    points = [],
    locations = [],
    scale = 1,
    width;
  function stationAt(x) {
    return locations.findLast((s) => s[2] <= x) || locations[0];
  }
  function sync() {
    if (!locations.length) return;
    const atEnd =
      container.scrollLeft > 0 && container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;
    select.value = (atEnd ? locations.at(-1) : stationAt((container.scrollLeft + 2) / scale))[0];
  }
  select.onchange = () => {
    const stop = locations.find((s) => s[0] === select.value);
    if (stop) container.scrollLeft = stop[2] * scale;
    sync();
  };
  container.addEventListener('scroll', sync, { passive: true });
  container.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'End') container.scrollLeft = container.scrollWidth;
    else if (e.key === 'Home') container.scrollLeft = 0;
    else container.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * container.clientWidth * 0.65 });
  });
  function resize() {
    if (!width) return;
    const position = container.scrollLeft / scale;
    scale = Math.max(0.72, Math.min(1.2, (innerHeight - container.getBoundingClientRect().top - 22) / 570));
    drawing.style.width = width * scale + 'px';
    drawing.style.height = 570 * scale + 'px';
    container.scrollLeft = position * scale;
    sync();
  }
  function paint(next, anchor) {
    if (view >= 0) offsets[view] = container.scrollLeft / scale;
    view = next;
    const key = keys[view];
    width = tables[key + 'Width'];
    locations = tables[key + 'Stations'];
    select.replaceChildren(...locations.map(([id, name]) => new Option(name, id)));
    drawing.replaceChildren();
    drawing.setAttribute('viewBox', '0 0 ' + width + ' 570');
    for (const [x1, y1, x2, y2, ink, weight] of tables[key + 'Lines'])
      svg(drawing, 'line', { x1, y1, x2, y2, stroke: inks[ink], 'stroke-width': weight });
    for (const [x, y, , size, ink, , text, preset] of tables[key + 'Labels']) {
      const el = svg(
        drawing,
        'text',
        { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size, fill: inks[ink] },
        text,
      );
      if (preset) {
        const station = stations.get(text);
        el.classList.add('station');
        action(el, 'Berth register for ' + text, () => open(station));
      }
    }
    points = tables[key + 'Markers'].map(([index, x, y, sy, r]) => {
      const { t, b } = byId.get(tables.markerInfo[index][0]);
      const berth = svg(drawing, 'g', { 'data-berth': b.id, class: 'berth' });
      action(berth, 'Berth ' + b.id, () => open(t, b));
      svg(berth, 'rect', { x: x - 31, y: y - 11, width: 62, height: 22, rx: 3 });
      const head = svg(berth, 'text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      svg(berth, 'rect', {
        x: x - 36,
        y: y + 10,
        width: 72,
        height: 18,
        fill: 'transparent',
        class: 'tap-area',
      });
      let signal;
      if (r) {
        signal = svg(drawing, 'g', { class: 'signal', 'data-signal': b.signal });
        action(signal, b.signal, () => open(t, b, true));
        svg(signal, 'circle', { cx: x, cy: sy, r: 9, fill: 'transparent' });
        svg(signal, 'circle', { cx: x, cy: sy, r, class: 'lamp' });
      }
      return { index, berth, head, signal };
    });
    resize();
    const target = locations.find((s) => s[0] === anchor);
    container.scrollLeft = (target ? target[2] : offsets[next]) * scale;
    sync();
  }
  function update(rows) {
    for (const { index, berth, head, signal } of points) {
      const [aspect, kind, text] = rows[index];
      if (head.textContent !== text) head.textContent = text;
      berth.classList.toggle('head', !!kind);
      berth.classList.toggle('stale', kind === 3);
      if (signal) signal.dataset.value = ['unknown', 'on', 'off'][aspect];
    }
  }
  return {
    paint,
    update,
    resize,
    station(x) {
      return stationAt((container.scrollLeft + x - container.getBoundingClientRect().left) / scale)?.[0];
    },
  };
}
