import { descriptor, verifyApp } from './verify.mjs';
const id = new URL('.', import.meta.url).pathname.split('/').filter(Boolean).pop();
async function start() {
  const release = await descriptor(await (await fetch('./release.json')).json(), id);
  const bytes = new Uint8Array(await (await fetch('/artifacts/' + release.sha256 + '.tda')).arrayBuffer());
  const app = await verifyApp(bytes, release, id);
  const urls = new Map();
  globalThis.transportApp = {
    id,
    version: release.version,
    manifest: app.manifest,
    json: (path) => app.json(path.replace(/^\//, '').toLowerCase()),
    async asset(path, type) {
      const key = path.replace(/^\//, '').toLowerCase();
      if (!urls.has(key)) urls.set(key, URL.createObjectURL(new Blob([await app.read(key)], { type })));
      return urls.get(key);
    },
  };
  if (app.manifest.adapter === 'hemel-corridor/1') {
    document.querySelector('a[href="/data/EASM-LICENSE.txt"]').href = await transportApp.asset(
      'data/easm-license.txt',
      'text/plain',
    );
    await import('./app.js');
  } else {
    await import('./install.mjs');
    await import('./app.mjs');
  }
}
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' }).catch(console.warn);
start().catch((err) => {
  const p = document.createElement('p');
  p.setAttribute('role', 'alert');
  p.textContent = 'Could not open this transport app. ' + err.message;
  document.body.prepend(p);
});
