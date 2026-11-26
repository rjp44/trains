import { readSetting, saveSetting } from './appearance.mjs';
const format = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MiB' : Math.ceil(n / 1024) + ' KiB');
const scope = (id) => new URL('/apps/' + id + '/', location.origin).href;
const cacheId = (name) => /^transport-([a-z][a-z0-9-]*)-[a-f0-9]{64}$/.exec(name)?.[1];
const workerAPI = () => 'serviceWorker' in navigator && 'caches' in window;
async function registrations() {
  if (!workerAPI()) return new Map();
  return new Map((await navigator.serviceWorker.getRegistrations()).map((r) => [r.scope, r]));
}
function waitFor(worker, goal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(Error('Download timed out.')), 120000);
    function done(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', check);
      error ? reject(error) : resolve();
    }
    function check() {
      if (worker.state === 'redundant') done(Error('Download interrupted. Try again.'));
      else if (worker.state === 'activated' || worker.state === goal) done();
    }
    worker.addEventListener('statechange', check);
    check();
  });
}
export function downloads(page, currentId) {
  page.innerHTML =
    '<div class="settings-group"><label for="library-search">Find an app</label><input type="search" id="library-search" placeholder="Name or description"></div><div class="settings-row"><button type="button" data-refresh>Refresh</button><a href="/apps/">App directory</a></div><p data-space></p><p data-notice role="status"></p><div data-list></div>';
  const list = page.querySelector('[data-list]'),
    notice = page.querySelector('[data-notice]');
  const search = page.querySelector('input'),
    refresh = page.querySelector('[data-refresh]');
  let catalogue = readSetting('directory', []),
    saved = new Map(),
    regs = new Map(),
    checking = false;
  let acting = false,
    confirmId = '';
  const standaloneSite =
    !globalThis.transportApp &&
    !['transport.pickering.org', 'trains-panel.netlify.app'].includes(location.hostname);
  if (!Array.isArray(catalogue)) catalogue = [];
  if (standaloneSite) page.querySelector('a').href = 'https://transport.pickering.org/apps/';
  function render() {
    list.replaceChildren();
    const apps = new Map([...saved, ...catalogue.map((a) => [a.id, a])]);
    const query = search.value.trim().toLowerCase();
    for (const [id, app] of apps) {
      if (!(app.name + ' ' + app.description + ' ' + id).toLowerCase().includes(query)) continue;
      const section = document.createElement('section');
      section.className = 'download-item';
      const name = document.createElement('h3'),
        desc = document.createElement('p'),
        meta = document.createElement('small');
      name.textContent = app.name;
      desc.textContent = app.description;
      const installed = saved.get(id);
      const reg = regs.get(scope(id));
      meta.textContent =
        'v' +
        (app.versionName || app.version) +
        ' · ' +
        format(app.bytes) +
        ' package' +
        (installed ? ' · Saved offline v' + (installed.versionName || installed.version) : '');
      const controls = document.createElement('div');
      controls.className = 'settings-row';
      function action(title, operation) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = title;
        b.disabled = acting || checking;
        b.onclick = () => operate(operation);
        controls.append(b);
      }
      if (id !== currentId || !globalThis.transportApp) {
        const a = document.createElement('a');
        a.href = standaloneSite ? 'https://transport.pickering.org/apps/' + id + '/' : scope(id);
        a.textContent = 'Open';
        controls.append(a);
      }
      if (workerAPI() && !standaloneSite) {
        if (confirmId === id) {
          action('Remove offline copy', async () => {
            if (reg) await reg.unregister();
            for (const key of await caches.keys()) if (cacheId(key) === id) await caches.delete(key);
            confirmId = '';
          });
          action('Cancel', () => {
            confirmId = '';
          });
        } else {
          if (!installed || installed.version < app.version || reg?.waiting)
            action(installed ? 'Update' : 'Save offline', async () => {
              const next =
                reg ||
                (await navigator.serviceWorker.register(scope(id) + 'sw.js', {
                  type: 'module',
                  updateViaCache: 'none',
                }));
              if (reg) await reg.update();
              const installing = next.installing;
              if (installing) await waitFor(installing, 'installed');
              const pending = next.waiting;
              if (pending) {
                pending.postMessage('activate-update');
                await waitFor(pending, 'activated');
              } else if (next.active || installing) await waitFor(next.active || installing, 'activated');
              if (id === currentId && reg) location.reload();
            });
          if (installed)
            action('Remove', () => {
              confirmId = id;
            });
        }
      }
      section.append(name, desc, meta, controls);
      list.append(section);
    }
    if (!list.childElementCount && !checking)
      list.textContent = query ? 'No matching apps.' : 'No saved apps on this browser.';
  }
  async function local() {
    regs = await registrations();
    const found = new Map();
    if (workerAPI()) {
      for (const key of await caches.keys()) {
        const id = cacheId(key);
        if (!id || !regs.get(scope(id))?.active) continue;
        const response = await caches.match(scope(id) + 'release.json', {cacheName:key});
        if (!response) continue;
        const envelope = await response.json();
        const body = Uint8Array.from(atob(envelope.payload), (c) => c.charCodeAt(0));
        const entry = JSON.parse(new TextDecoder().decode(body)).artifacts[id];
        // A waiting worker can have a second verified copy. Report the running edition.
        if (entry && (!found.has(id) || found.get(id).version > entry.version))
          found.set(id, { id, ...entry });
      }
    }
    saved = found;
    const storage = await navigator.storage?.estimate?.();
    page.querySelector('[data-space]').textContent = storage?.quota
      ? 'Browser storage · ' + format(Math.max(0, storage.quota - storage.usage)) + ' available'
      : '';
    render();
  }
  async function operate(task) {
    if (acting || checking) return;
    acting = true;
    refresh.disabled = true;
    notice.textContent = 'Updating downloads…';
    render();
    try {
      await task();
      await local();
      notice.textContent = '';
    } catch (err) {
      notice.textContent = err.message || 'Could not change this download.';
    } finally {
      acting = false;
      refresh.disabled = checking;
      render();
    }
  }
  async function check() {
    if (checking || acting) return;
    checking = true;
    refresh.disabled = true;
    notice.textContent = 'Checking downloads…';
    try {
      await local();
      const response = await fetch(
        standaloneSite ? 'https://transport.pickering.org/directory.json' : '/directory.json',
        { cache: 'no-store', signal: AbortSignal.timeout(9000) },
      );
      if (!response.ok) throw Error();
      const { applications } = await response.json();
      if (!Array.isArray(applications)) throw Error();
      catalogue = applications.filter(
        (a) => /^[a-z][a-z0-9-]*$/.test(a.id) && a.app === '/apps/' + a.id + '/',
      );
      saveSetting('directory', catalogue);
      await Promise.allSettled(
        [...regs]
          .filter(([url]) => catalogue.some((a) => scope(a.id) === url))
          .map(async ([, reg]) => {
            await reg.update();
            if (reg.installing) await waitFor(reg.installing, 'installed');
          }),
      );
      await local();
      notice.textContent = '';
    } catch {
      notice.textContent = 'Directory unavailable. Showing saved information.';
    } finally {
      checking = false;
      refresh.disabled = acting;
      render();
    }
  }
  refresh.onclick = check;
  search.oninput = render;
  return check;
}
