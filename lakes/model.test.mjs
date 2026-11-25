import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { busFixes, railFixes, visibleFixes, project, order } from './public/model.mjs';

const read = (name) => JSON.parse(readFileSync(new URL('./public/data/' + name, import.meta.url)));
const now = Date.parse('2026-11-25T12:05:54Z');
test('bus GPS is geofenced and newer observations win for the same vehicle', () => {
  const fix = { id: '37103', route: '516', lon: '-2.742', lat: '54.332', time: '2026-11-25T12:05:38Z' };
  const results = busFixes([
    fix,
    { ...fix, time: '2026-11-25T12:04:38Z' },
    { ...fix, route: 'X6', id: 'x' },
    { ...fix, lat: '', id: 'y' },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].time, Date.parse(fix.time));
  assert.equal(results[0].precision, 'Vehicle GPS');
});
test('main-line traffic at Oxenholme is excluded while a branch leg gets an estimated position', () => {
  const train = {
    id: 'X',
    lat: 54.32,
    lon: -2.73,
    last: { crs: 'KEN', time: '12:02' },
    next: { crs: 'OXN', est: '12:06' },
  };
  const data = {
    generated_at: new Date(now).toISOString(),
    trains: [
      train,
      { ...train, id: 'main', last: { crs: 'LAN' } },
      { ...train, id: 'terminating', next: null },
    ],
  };
  const results = railFixes(data);
  assert.equal(results.length, 1);
  assert.equal(results[0].precision, 'Estimated between stations');
});
test('captured fixes retain their time through errors and expire', () => {
  const vehicles = [
    { time: now - 1000, route: '505', id: 'a' },
    { time: now - 150_000, route: '508', id: 'b' },
    { time: now - 700_000, route: '516', id: 'c' },
  ];
  const snapshot = { bus: { ok: true, vehicles } };
  assert.deepEqual(
    visibleFixes(snapshot, now).map((v) => v.stale),
    [false, true],
  );
  snapshot.bus.ok = false;
  assert.deepEqual(
    visibleFixes(snapshot, now).map((v) => v.stale),
    [true, true],
  );
});
test('recorded winter geography and observations cover every requested service', () => {
  const map = read('map.json'),
    first = read('replay.json').frames[0];
  assert.deepEqual(new Set(visibleFixes(first, first.time).map((v) => v.route)), new Set(order));
  assert.equal(map.stations.length, 5);
  assert.ok(map.rail.length > 30);
  for (const id of order.filter((id) => id !== 'rail')) assert.ok(map.routes[id].length > 10);
  for (const v of visibleFixes(first, first.time)) {
    const [x, y] = project(v.point, map.frame);
    assert.ok(x >= 0 && x <= map.frame.width && y >= 0 && y <= map.frame.height);
  }
  // The winter 508 remains north of Kirkstone Pass and Windermere.
  for (const link of map.routes['508'])
    for (const [, y] of link) assert.ok(y < (map.frame.north - 54.51) * map.frame.units);
});
