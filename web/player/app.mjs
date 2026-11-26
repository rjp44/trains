import { decode, maxBytes } from './format.mjs';
import { seek, draw } from './replay.mjs';
const $ = (id) => document.getElementById(id);
const ctx = document.querySelector('canvas').getContext('2d');
const painter = {
  rect(x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  },
  text(x, y, s, fill, w) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, 23);
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.font = '17px system-ui';
    ctx.textBaseline = 'top';
    ctx.fillText(s, x, y + 3);
    ctx.restore();
  },
};
let pkg,
  cursor = 90000,
  running = false,
  start,
  request = 0;
const clock = (ms) => Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
function render(ms) {
  if (!pkg) return;
  cursor = Math.max(0, Math.min(Math.floor(ms), pkg.replay.frames.at(-1).at));
  const s = seek(pkg, cursor);
  draw(pkg, s, painter);
  $('time').value = cursor;
  $('clock').textContent = clock(cursor);
  $('berth').textContent = s.berth ? s.berth.id + ' · ' + s.track.name : 'Off diagram';
  $('card').textContent = s.card
    ? [
        pkg.replay.service.head,
        s.berth.context,
        s.frame.matched ? pkg.replay.service.route : 'Service details unavailable',
        s.frame.timing,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No eligible service';
  $('event').textContent = s.entry
    ? [clock(s.entry.at), s.entry.direction, s.entry.booked ? 'booked stop' : 'unconfirmed stop'].join(' · ')
    : 'No station entry yet';
  $('step').disabled = !pkg.replay.frames.some((f) => f.at > cursor);
}
function stop() {
  running = false;
  cancelAnimationFrame(request);
  $('play').textContent = 'Play';
}
function animate(t) {
  if (!running) return;
  render(t - start);
  if (cursor === pkg.replay.frames.at(-1).at) stop();
  else request = requestAnimationFrame(animate);
}
$('play').onclick = () => {
  if (!pkg || running) return stop();
  if (cursor === pkg.replay.frames.at(-1).at) render(0);
  start = performance.now() - cursor;
  running = true;
  $('play').textContent = 'Pause';
  request = requestAnimationFrame(animate);
};
$('time').oninput = () => {
  stop();
  render(Number($('time').value));
};
$('step').onclick = () => {
  stop();
  if (pkg) render(pkg.replay.frames.find((f) => f.at > cursor)?.at ?? cursor);
};
let generation = 0;
async function load(file) {
  const gen = ++generation;
  try {
    let bytes;
    if (file) {
      if (file.size > maxBytes) throw Error('Package exceeds 64 KiB');
      bytes = await file.arrayBuffer();
    } else {
      const res = await fetch('/hemel.tdp');
      if (!res.ok) throw Error(await res.text());
      bytes = await res.arrayBuffer();
    }
    const next = decode(new Uint8Array(bytes));
    if (gen !== generation) return;
    stop();
    pkg = next;
    $('time').max = pkg.replay.frames.at(-1).at;
    $('station').textContent = pkg.scene.station.name;
    $('version').textContent = pkg.manifest.app + ' / ' + pkg.manifest.version;
    $('credits').textContent = pkg.manifest.credits;
    $('licence').textContent = pkg.licence;
    $('status').textContent =
      (file?.name || 'hemel.tdp') + ' · ' + bytes.byteLength.toLocaleString() + ' bytes';
    render(cursor);
  } catch (e) {
    if (gen === generation) $('status').textContent = 'Load failed. ' + e.message;
  }
}
$('reload').onclick = () => load();
$('file').onchange = () => {
  const f = $('file').files[0];
  if (f) load(f);
  $('file').value = '';
};
load();
