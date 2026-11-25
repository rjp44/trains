import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as settle } from 'node:timers/promises';
import { createLiveFeed } from './live.mjs';

const layout = JSON.parse(readFileSync(new URL('./public/data/corridor.json', import.meta.url)));
const now = Date.parse('2026-11-24T22:54:00Z');

function simulate(t, options) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
  const sockets = [];
  const original = globalThis.WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  globalThis.WebSocket = function () {
    const socket = {
      close: t.mock.fn(),
      send: t.mock.fn(),
      message(type, payload, area, messageID) {
        this.onmessage({ data: JSON.stringify({ Message: {
          type, message: payload, area, messageID, timestamp: Date.now(),
        } }) });
      },
    };
    sockets.push(socket);
    return socket;
  };
  const feed = createLiveFeed(layout, options);
  t.after(() => feed.stop());
  feed.start();
  return { feed, sockets };
}

test('a sequence gap reconnects once and each area needs its own fresh snapshot', (t) => {
  const { feed, sockets } = simulate(t);
  const first = sockets[0];
  first.onopen();
  assert.deepEqual(JSON.parse(first.send.mock.calls[0].arguments[0]).Message.areas, layout.areas);
  first.message('TD_ALL', { R15145: '2K65' }, 'R1', 1);
  first.message('TD_UPDATE', { 'R103:7': '1' }, 'R1', 2);
  assert.equal(feed.snapshot().areaStatus.R1, 'Live');
  first.message('TD_UPDATE', { R15145: 'lost' }, 'R1', 4);
  assert.equal(feed.snapshot().status, 'Stale');
  assert.equal(feed.snapshot().values.R15145, '2K65');
  feed.start();
  t.mock.timers.tick(2000);
  assert.equal(sockets.length, 2);
  const second = sockets[1];
  first.onclose();
  first.message('TD_ALL', { R15145: 'old' }, 'R1', 5);
  second.message('TD_UPDATE', { R15145: 'early' }, 'R1', 1);
  second.message('TD_ALL', {}, 'WJ', 2);
  assert.equal(feed.snapshot().areaStatus.R1, 'Stale');
  assert.equal(feed.snapshot().values.R15145, '2K65');
  second.message('TD_ALL', {}, 'R1', 3);
  second.message('TD_UPDATE', { R15147: '2K65' }, 'R1', 4);
  assert.equal(feed.snapshot().areaStatus.R1, 'Live');
  assert.equal(feed.snapshot().values.R15145, undefined);
  assert.equal(feed.snapshot().values.R15147, '2K65');
  t.mock.timers.tick(50000);
  assert.equal(second.close.mock.callCount(), 1);
  feed.stop();
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 2);
});

test('a delta arriving after sleep cannot make a stale area current before resynchronisation', (t) => {
  const { feed, sockets } = simulate(t);
  const socket = sockets[0];
  socket.message('TD_ALL', { R15145: '2K65' }, 'R1');
  socket.message('TD_UPDATE', { 'R103:7': '1' }, 'R1');
  // Jump the wall clock while the watchdog is suspended, as on a sleeping phone.
  t.mock.timers.setTime(now + 60000);
  socket.message('TD_UPDATE', { R15145: 'missed' }, 'R1');
  assert.equal(feed.snapshot().values.R15145, '2K65');
  assert.equal(feed.snapshot().status, 'Stale');
  assert.equal(socket.close.mock.callCount(), 1);
});

test('an Abbey lookup from a suspended session cannot replace a newer report or restart polling', async (t) => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve) => {
    pending.push({ url, signal: options.signal, resolve });
  }));
  const endpoint = 'https://panel.example/api/abbey-lookup';
  const { feed, sockets } = simulate(t, { abbeyEndpoint: endpoint });
  const id = '712F39M824';
  const services = {
    [id]: { ti: id, st: now, ol: 'WATFORD JUNCTION', dl: 'ST ALBANS ABBEY', od: '2254' },
  };
  const respond = (index, station) => pending[index].resolve({
    ok: true, json: async () => ({ summary: { dep: '22:54' }, calls: [
      { crs: 'WFJ', status: 'departed' }, { crs: station, status: 'arrived' }, { crs: 'SAA' },
    ] }),
  });
  sockets[0].message('TRUST_ALL', services);
  assert.equal(pending[0].url.href, endpoint + '?crs=WFJ&dep=2254&date=2026-11-24');
  feed.stop();
  assert.equal(pending[0].signal.aborted, true);
  feed.start();
  sockets[1].message('TRUST_ALL', services);
  respond(1, 'GSN');
  await settle();
  respond(0, 'WFN');
  await settle();
  assert.equal(feed.snapshot().abbey.reports[0].station, 'GSN');
  feed.stop();
  assert.equal(feed.snapshot().abbey.available, false);
  assert.equal(feed.snapshot().abbey.reports[0].station, 'GSN');
  t.mock.timers.tick(60000);
  assert.equal(pending.length, 2);
});
