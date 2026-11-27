import { lineBoard } from './line-board.mjs';
import { Corridor } from './rail.mjs';
import { createLiveFeed } from './live.mjs';
import { regionalRows, locationArrivals, slots } from './regional.mjs';
import { panelSettings, settingGroup } from './panel/settings.mjs';
import { readSetting, saveSetting } from './panel/appearance.mjs';
import { mapGestures } from './panel/gestures.mjs';
const { id, manifest, json } = globalThis.transportApp;
const [layout, recording] = await Promise.all(['corridor', 'replay'].map((n) => json('data/' + n + '.json')));
const $ = (s) => document.querySelector(s);
const tracks = $('#tracks'),
  dialog = $('#detail'),
  status = document.createElement('span');
const directional = layout.diagram === 'directional';
const tables = directional ? await json('native/tables.json') : null;
const board = directional
  ? lineBoard(tracks, layout, tables, (t, b, signal) => show(t, '', signal ? b : null, b))
  : null;
const physical = new Map(layout.tracks.flatMap((t) => t.berths).map((b, i) => [b.id, i]));
const focus = layout.tracks.findIndex((t) => t.id === layout.focus);
const arrivals = locationArrivals(layout),
  feed = createLiveFeed(layout, { onFrame: arrivals.accept, onReset: arrivals.reset });
const replay = new Corridor(layout);
let frame = 0,
  started = 0,
  recorded = false,
  last = '',
  view = Number(readSetting(id + '.view', 0)),
  state,
  selected = null;
if (![0, 1, 2].includes(view)) view = 0;
function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
function options(title, labels, act) {
  const buttons = labels.map((s, i) => button(s, () => act(i)));
  return {
    group: settingGroup(title, ...buttons),
    mark(i) {
      buttons.forEach((b, n) => b.setAttribute('aria-pressed', n === i));
    },
  };
}
function setView(i, anchor) {
  view = i;
  saveSetting(id + '.view', i);
  views.mark(i);
  board?.paint(i, anchor);
  last = '';
  draw();
}
const views = options('View', layout.views, setView);
const sources = options('Data source', ['Live', 'Recorded movements'], (i) => {
  recorded = !!i;
  sources.mark(i);
  arrivals.reset();
  frame = 0;
  started = Date.now();
  last = '';
  if (recorded) feed.stop();
  else feed.start();
  draw();
});
const ui = panelSettings({
  id,
  name: manifest.name,
  toolbar: $('#toolbar'),
  status,
  map: $('main'),
  initialTheme: 'dark',
  applyTheme: (v) => (document.documentElement.dataset.theme = v),
  appControls: [views.group, sources.group],
});
views.mark(view);
board?.paint(view);
sources.mark(0);
document.title = manifest.name + ' · WCML';
function rowDetails(title, location, lines) {
  dialog.querySelector('small').textContent = location;
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('div').replaceChildren(
    ...lines.filter(Boolean).map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }),
  );
}
function show(t, head = '', signal = null, berth = null) {
  selected = { t, head, signal, berth };
  details();
  if (!dialog.open) dialog.showModal();
}
function details() {
  if (!selected || !state) return;
  let { t, head, signal } = selected;
  const fresh = (b) => recorded || state.areaStatus?.[b.id.slice(0, 2)] === 'Live';
  if (signal) {
    const aspect = fresh(signal) ? state.values[signal.bit] : null;
    rowDetails(signal.signal, t.name, [
      aspect === 'on'
        ? 'On · most restrictive'
        : aspect === 'off'
          ? 'Off · less restrictive'
          : 'Indication unknown',
      signal.bit,
    ]);
    return;
  }
  if (selected.berth) {
    const b = selected.berth,
      index = physical.get(b.id),
      row = regionalRows(layout, state, !recorded)[index];
    const moves = t.steps.filter(([a, z]) => a === b.id || z === b.id);
    rowDetails(row[2] || b.id, t.name, [
      tables.markerInfo[index][3],
      'Berth ' + b.id + (b.lines?.length ? ' · Line code ' + b.lines.join('/') : ''),
      row[2] ? row[4] : 'Berth clear',
      row[2] ? row[5] : '',
      !fresh(b) ? 'Last known position' : '',
      ...moves.map(([a, z, dir]) => (dir === 'up' ? 'Up' : 'Down') + ' · ' + a + ' → ' + z),
    ]);
    return;
  }
  const rows = regionalRows({ ...layout, tracks: [t] }, state, !recorded).slice(0, slots);
  if (head) {
    const row = rows.find((r) => r[2] === head);
    rowDetails(
      head,
      t.name,
      row
        ? [row[4], row[5], row[1] === 3 ? 'Last known position' : '']
        : ['No longer reported at this location'],
    );
    return;
  }
  const items = t.berths.filter(
    (b) => state.values[b.id] && /^[0-9][A-Z][0-9]{2}$|^[A-Z][0-9]{3}$/.test(state.values[b.id]),
  );
  rowDetails(t.name, 'Reporting location', [
    items.length ? 'Occupied berths' : 'No train currently reported',
    ...t.berths.map((b) =>
      [
        b.id,
        directional && (b.direction === 'both' ? 'Up / Down' : b.direction === 'up' ? 'Up' : 'Down'),
        b.platform && 'P' + b.platform,
        state.values[b.id] || '—',
        b.signal && b.signal + ' ' + (fresh(b) ? state.values[b.bit] || 'unknown' : 'unknown'),
        !fresh(b) && 'Last known',
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  ]);
}
dialog.querySelector('button').onclick = () => dialog.close();
dialog.onclose = () => (selected = null);
dialog.onclick = (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  }
};
function draw() {
  if (recorded) {
    const end = recording.frames.at(-1).time - recording.startTime;
    if (Date.now() - started >= end) {
      frame = 0;
      started = Date.now();
    }
    const until = recording.startTime + Date.now() - started;
    while (frame < recording.frames.length && recording.frames[frame].time <= until)
      replay.apply(recording.frames[frame++]);
    state = replay;
  } else state = feed.snapshot();
  status.textContent = recorded ? 'Replay' : state.status;
  if (!recorded)
    for (const direction of arrivals.take(['Live', 'Partial'].includes(state.status)))
      ui.sound.play(direction === 'D', false);
  const visible = [layout.tracks, layout.tracks.slice(0, focus + 1), layout.tracks.slice(focus)][view];
  const rows = regionalRows(directional ? layout : { ...layout, tracks: visible }, state, !recorded);
  const key = JSON.stringify([view, rows]);
  $('h1').textContent = layout.views[view];
  $('#readout').textContent =
    visible.length +
    ' reporting locations' +
    (state.observed
      ? ' · ' + new Date(state.observed).toLocaleTimeString('en-GB', { timeZone: 'Europe/London' }) + ' UK'
      : '');
  if (key === last) return;
  last = key;
  if (board) {
    board.update(rows);
    details();
    return;
  }
  let lane,
    offset = 0;
  const columns =
    window.innerWidth < 600 ? 1 : Math.max(1, Math.min(4, Math.floor(tracks.clientWidth / 245)));
  const per = Math.ceil(visible.length / columns);
  tracks.replaceChildren();
  visible.forEach((t, i) => {
    if (i % per === 0) {
      lane = document.createElement('div');
      lane.className = 'lane';
      tracks.append(lane);
    }
    const location = document.createElement('section');
    location.className = 'location';
    const station = button(t.name, () => show(t));
    station.className = 'station';
    location.append(station);
    const heads = document.createElement('div');
    heads.className = 'heads';
    for (const row of rows.slice(offset, offset + slots))
      if (row[1]) {
        const b = button(row[2], () => show(t, row[2].startsWith('+') ? '' : row[2]));
        b.className = 'head' + (row[1] === 3 ? ' stale' : '');
        heads.append(b);
      }
    location.append(heads);
    offset += slots;
    const signs = t.berths.filter((b) => b.bit);
    if (signs.length) {
      const signals = document.createElement('div');
      signals.className = 'signals';
      signs.slice(0, view ? 5 : 3).forEach((b, n) => {
        const signal = button(b.signal, () => show(t, '', b));
        signal.className = 'signal';
        signal.dataset.value = ['unknown', 'on', 'off'][rows[offset + t.berths.indexOf(b)][0]];
        signals.append(signal);
      });
      location.append(signals);
    }
    offset += t.berths.length;
    lane.append(location);
  });
  details();
}
mapGestures(tracks, {
  drag(a, b) {
    if (board) tracks.scrollLeft += a.x - b.x;
  },
  pinch(a, b) {
    const ratio = b.span / a.span;
    if (ratio > 1.25 && view === 0) {
      if (board) {
        const station = board.station(b.x);
        setView(layout.tracks.findIndex((t) => t.id === station) < focus ? 1 : 2, station);
        return true;
      }
      const at = document
        .elementFromPoint(b.x, b.y)
        ?.closest('.location')
        ?.querySelector('.station')?.textContent;
      setView(layout.tracks.findIndex((t) => t.name === at) < focus ? 1 : 2);
      return true;
    }
    if (ratio < 0.8 && view) {
      setView(0, board?.station(b.x));
      return true;
    }
    return false;
  },
});
window.addEventListener('resize', () => {
  board?.resize();
  last = '';
  draw();
});
feed.start();
draw();
setInterval(draw, 800);
