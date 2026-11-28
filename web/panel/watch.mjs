import { readSetting, saveSetting } from './appearance.mjs';
import { settingGroup } from './settings.mjs';

export function watchPanel(app, stations, fallback, host, change) {
  const key = app + '.watch';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Watch station');
  select.append(new Option('Off', ''), ...stations.map((s) => new Option(s.name, s.id)));
  const saved = readSetting(key, fallback);
  select.value = saved === '' || stations.some((s) => s.id === saved) ? saved : fallback;
  function watch(id) {
    select.value = id;
    saveSetting(key, id);
    change();
  }
  select.onchange = () => watch(select.value);
  const card = document.createElement('aside');
  card.className = 'transport-watch-card';
  card.hidden = true;
  const caption = document.createElement('small'),
    heading = document.createElement('strong'),
    running = document.createElement('span');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Stop following';
  card.append(caption, heading, running, cancel);
  host.append(card);
  function show(info, stop) {
    card.hidden = !info;
    if (!info) return;
    for (const [el, value] of [
      [caption, info.context],
      [heading, [info.head, info.route].filter(Boolean).join(' · ')],
      [running, info.running || ''],
    ])
      if (el.textContent !== value) el.textContent = value;
    cancel.hidden = !stop;
    cancel.onclick = stop || null;
  }
  return {
    get station() {
      return stations.find((s) => s.id === select.value);
    },
    watch,
    show,
    group: settingGroup('Watch station', select),
  };
}

export function watchAction(caption, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'watch-action';
  b.textContent = caption;
  b.onclick = action;
  return b;
}

export function stationPrompt(name, watch, zoom) {
  const dialog = document.createElement('dialog'),
    title = document.createElement('strong');
  dialog.className = 'station-prompt';
  title.textContent = name;
  const run = (fn) => () => {
    dialog.close();
    fn?.();
  };
  dialog.append(title, watchAction('Watch', run(watch)));
  if (zoom) dialog.append(watchAction('Zoom here', run(zoom)));
  dialog.append(watchAction('Close', run()));
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
}
