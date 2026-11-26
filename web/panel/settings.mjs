import { mapAppearance, readSetting, saveSetting } from './appearance.mjs';
import { downloads } from './downloads.mjs';
import { trainSound } from './horn.mjs';

export function settingGroup(title, ...controls) {
  const section = document.createElement('section'),
    heading = document.createElement('h3'),
    row = document.createElement('div');
  section.className = 'settings-group';
  heading.textContent = title;
  row.className = 'settings-row';
  row.append(...controls);
  section.append(heading, row);
  return section;
}
export function panelSettings({
  id,
  name,
  toolbar,
  status,
  map,
  initialTheme,
  applyTheme,
  appControls,
  credits,
  installHelp,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'transport-settings';
  dialog.setAttribute('aria-labelledby', 'transport-settings-title');
  dialog.innerHTML =
    '<header><div><small></small><h2 id="transport-settings-title">Settings</h2></div><button type="button" class="settings-done">Done</button></header><nav role="tablist" aria-label="Settings"></nav><div class="settings-content"></div>';
  document.body.append(dialog);
  dialog.querySelector('header small').textContent = name;
  const nav = dialog.querySelector('nav'),
    content = dialog.querySelector('.settings-content');
  const pages = {},
    tabs = {};
  let checkDownloads;
  function visit(title) {
    for (const key of Object.keys(pages)) {
      const active = key === title;
      pages[key].hidden = !active;
      tabs[key].setAttribute('aria-selected', active);
      tabs[key].tabIndex = active ? 0 : -1;
    }
    content.scrollTop = 0;
    if (title === 'Downloads') checkDownloads();
  }
  for (const title of ['App', 'Downloads', 'Sound', 'Display', 'Wi-Fi', 'About']) {
    const tab = document.createElement('button'),
      page = document.createElement('div');
    const key = title.toLowerCase();
    tab.type = 'button';
    tab.textContent = title;
    tab.id = 'tab-' + key;
    page.id = 'settings-' + key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', page.id);
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', tab.id);
    page.hidden = true;
    tab.onclick = () => visit(title);
    tabs[title] = tab;
    pages[title] = page;
    nav.append(tab);
    content.append(page);
  }
  nav.onkeydown = (e) => {
    const items = Object.values(tabs),
      index = items.indexOf(e.target);
    if (index < 0) return;
    const to = {
      ArrowRight: (index + 1) % items.length,
      ArrowLeft: (index + items.length - 1) % items.length,
      Home: 0,
      End: items.length - 1,
    }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[to].click();
      items[to].focus();
    }
  };
  pages.App.append(...appControls);
  checkDownloads = downloads(pages.Downloads, globalThis.transportApp?.id || id);
  if (installHelp) pages.Downloads.append(installHelp);

  function choices(page, title, options, change) {
    const buttons = [];
    for (const [value, caption] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = caption;
      b.value = value;
      b.onclick = () => change(value);
      buttons.push(b);
    }
    page.append(settingGroup(title, ...buttons));
    return (value) => buttons.forEach((b) => b.setAttribute('aria-pressed', b.value === value));
  }
  function slider(page, label, min, value, update) {
    const range = document.createElement('input'),
      out = document.createElement('output');
    range.type = 'range';
    range.min = min;
    range.max = 100;
    range.value = value;
    range.setAttribute('aria-label', label);
    out.textContent = range.value + '%';
    range.oninput = () => {
      out.textContent = range.value + '%';
      update(Number(range.value));
    };
    page.append(settingGroup(label, range, out));
  }
  const sound = trainSound();
  const soundChoice = choices(
    pages.Sound,
    'Train horn',
    [
      ['off', 'Off'],
      ['stops', id === 'hemel' ? 'Stopping at Hemel' : 'Stopping trains'],
      ['all', 'All trains'],
    ],
    (v) => {
      sound.select(v);
      soundChoice(v);
    },
  );
  soundChoice(sound.mode);
  slider(pages.Sound, 'Volume', 0, sound.volume, (value) => sound.level(value));

  toolbar.classList.add('transport-toolbar');
  const gear = document.createElement('button'),
    theme = document.createElement('button'),
    middle = document.createElement('div');
  gear.type = theme.type = 'button';
  gear.className = theme.className = 'transport-icon';
  gear.id = 'open-settings';
  gear.setAttribute('aria-label', 'Settings');
  gear.title = 'Settings';
  gear.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3 .6-1h4.8l.6 2.5 2 .9 2.3-.8 2.3 4-1.7 1.8v2.5l1.7 1.9-2.3 4-2.4-.8-2 .9-.5 2.5H9.6l-.6-2.5-2-.9-2.3.8-2.3-4 1.7-1.9v-2.5L2.4 8.6l2.3-4 2.4.8 2-.9Z"/><circle cx="12" cy="11.8" r="3.1"/></svg>';
  middle.className = 'transport-caption';
  const caption = document.createElement('strong');
  caption.textContent = name;
  middle.append(caption, status);
  toolbar.replaceChildren(gear, middle, theme);
  function close() {
    if (dialog.open) dialog.close();
  }
  gear.onclick = () => {
    visit('App');
    dialog.showModal();
    tabs.App.focus();
  };
  dialog.querySelector('.settings-done').onclick = close;
  dialog.onclick = (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        close();
    }
  };
  const themeChoice = choices(
    pages.Display,
    'Map appearance',
    [
      ['light', 'Light'],
      ['dark', 'Dark'],
      ['auto', 'Sunrise / sunset'],
    ],
    (value) => chooseTheme(value),
  );
  const times = document.createElement('p');
  pages.Display.append(times);
  const chooseTheme = mapAppearance(
    id,
    initialTheme,
    (value) => {
      applyTheme(value);
      toolbar.dataset.theme = dialog.dataset.theme = value;
      const dark = value === 'dark';
      theme.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
      theme.title = theme.getAttribute('aria-label');
      theme.innerHTML = dark
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2 2m10.2 10.2 2 2m0-14.2-2 2M6.9 17.1l-2 2"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 14.1A9 9 0 0 1 9.9 3.4a9 9 0 1 0 10.7 10.7Z"/></svg>';
    },
    (value, message) => {
      themeChoice(value);
      times.textContent = message;
      times.hidden = !message;
    },
  );
  theme.id = 'map-theme';
  theme.onclick = () => chooseTheme('toggle');
  const brightness = Math.max(10, Math.min(100, Number(readSetting('brightness', 100)) || 100));
  const dim = (n) => {
    map.style.filter = n === 100 ? '' : 'brightness(' + n + '%)';
  };
  slider(pages.Display, 'Map brightness', 10, brightness, (n) => {
    saveSetting('brightness', n);
    dim(n);
  });
  dim(brightness);

  if (document.fullscreenEnabled) {
    const screen = document.createElement('button');
    screen.type = 'button';
    const sync = () => {
      screen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    };
    screen.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        screen.textContent = 'Full screen unavailable';
      }
    };
    document.addEventListener('fullscreenchange', sync);
    sync();
    pages.Display.append(settingGroup('Browser display', screen));
  }
  if (id === 'lakes') {
    const orientation = window.screen.orientation;
    const state = document.createElement('p');
    let locked = false;
    function describeOrientation() {
      const landscape = matchMedia('(orientation: landscape)').matches;
      state.textContent =
        (landscape ? 'Landscape' : 'Portrait') + (locked ? ' · locked' : ' · follows your screen');
    }
    describeOrientation();
    matchMedia('(orientation: landscape)').addEventListener('change', describeOrientation);
    const row = settingGroup('Map orientation', state);
    pages.App.append(row);
    if (orientation?.lock && document.fullscreenEnabled && matchMedia('(pointer:coarse)').matches) {
      for (const [value, title] of [
        ['portrait', 'Portrait'],
        ['landscape', 'Landscape'],
        ['auto', 'Automatic'],
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = title;
        b.onclick = async () => {
          try {
            if (value === 'auto') {
              orientation.unlock();
              locked = false;
            } else {
              if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
              await orientation.lock(value);
              locked = true;
            }
            describeOrientation();
          } catch {
            state.textContent = 'Rotate your device to change the map orientation.';
          }
        };
        row.lastElementChild.append(b);
      }
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
          locked = false;
          describeOrientation();
        }
      });
    }
  }
  const network = document.createElement('strong'),
    hint = document.createElement('p');
  hint.textContent = 'Choose a network in your device settings. Saved recordings work offline.';
  const online = () => {
    network.textContent = navigator.onLine ? 'Browser online' : 'Browser offline';
  };
  online();
  window.addEventListener('online', online);
  window.addEventListener('offline', online);
  pages['Wi-Fi'].append(settingGroup('Connection', network), hint);
  const version = document.createElement('p'),
    credit = document.createElement('p');
  version.textContent =
    name + (globalThis.transportApp?.versionName ? ' · v' + transportApp.versionName : '');
  credit.textContent = globalThis.transportApp?.manifest?.credits || credits;
  const made = document.createElement('a');
  made.href = 'https://github.com/rjp44/trains';
  made.textContent = 'Made for Jack with love from @rjp44';
  const solar = document.createElement('a');
  solar.href = 'https://open-meteo.com/';
  solar.textContent = 'Sunrise and sunset from Open-Meteo';
  pages.About.append(version, made, settingGroup('Data sources', credit), solar);
  return { close, sound };
}
