import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { busFixes, railFixes } from './feeds.mjs';
import { railBearing, visibleFixes, project, order } from './public/model.mjs';

const read = (name) => JSON.parse(readFileSync(new URL('./public/data/' + name, import.meta.url)));
const now = Date.parse('2026-11-25T12:05:54Z');
test('bus GPS is geofenced and newer observations win for the same vehicle', () => {
  const fix = { id: '37103', route: '516', lon: '-2.742', lat: '54.332', time: '2026-11-25T12:05:38Z' };
  const results = busFixes([
    fix,
    { ...fix, time: '2026-11-25T12:04:38Z' },
    { ...fix, route: '999', id: 'x' },
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
    last: { crs: 'KEN', time: '12:02', stop: true },
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
  assert.equal(results[0].lastStop, true);
  train.last.stop = false;
  assert.equal(railFixes(data)[0].lastStop, false);
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
  const { lines } = read('rail.json');
  assert.equal(lines.rail.stations.length, 5);
  assert.equal(lines.coast.stations.length, 27);
  for (const line of Object.values(lines)) {
    let previous = -1;
    for (const station of line.stations) {
      assert.ok(station.vertex > previous, station.name);
      const [x, y] = line.track[station.vertex];
      assert.ok(Math.hypot(x - station.point[0], y - station.point[1]) <= 1.06, station.name);
      previous = station.vertex;
    }
  }
  for (const id of order.filter((id) => !lines[id])) assert.ok(map.routes[id].length > 10);
  for (const v of visibleFixes(first, first.time)) {
    const [x, y] = project(v.point, map.frame);
    assert.ok(x >= 0 && x <= map.frame.width && y >= 0 && y <= map.frame.height);
  }
  // The winter 508 remains north of Kirkstone Pass and Windermere.
  for (const link of map.routes['508'])
    for (const [, y] of link) assert.ok(y < (map.frame.north - 54.51) * map.frame.units);
});

test('GPS bearings preserve due north and distinguish a missing or invalid heading', () => {
  const base = { id: '1', route: '555', lon: -2.78, lat: 54.34, time: new Date(now).toISOString() };
  for (const [value, want] of [
    ['0', 0],
    ['360', 0],
    ['256', 256],
    [null, null],
    ['', null],
    ['-1', null],
    [361, null],
  ]) {
    assert.equal(busFixes([{ ...base, bearing: value }])[0].bearing, want);
  }
});

test('a train cab follows the local rail segment in either direction, including older recorded fixes', () => {
  const stations = [
    { code: 'A', name: 'First' },
    { code: 'B', name: 'Last' },
  ];
  const line = [
    [0, 0],
    [0, 10],
    [10, 10],
  ];
  assert.equal(railBearing({ lastCode: 'A', nextCode: 'B' }, [8, 11], line, stations), 90);
  assert.equal(railBearing({ last: 'Last', next: 'First' }, [8, 11], line, stations), 270);
  assert.equal(railBearing({ last: 'First', next: 'Last' }, [1, 4], line, stations), 180);
});

test('coastal estimates include skipped stations and junctions and exclude unrelated shared-track and out-of-sector trains', () => {
  const train = {
    id: 'through',
    last: { crs: 'CNF' },
    next: { crs: 'GOS' },
    origin: 'Manchester Airport',
    destination: 'Barrow-In-Furness',
    lon: -2.81,
    lat: 54.175,
  };
  const fixes = railFixes({
    generated_at: new Date(now).toISOString(),
    trains: [
      train,
      {
        ...train,
        id: 'junction',
        last: { crs: 'ASK' },
        next: { name: 'Park South' },
        origin: 'Corkickle',
        destination: 'Barrow-In-Furness',
        lon: -3.20216,
        lat: 54.18119,
      },
      { ...train, id: 'shared', last: { crs: 'LAN' }, next: { crs: 'CNF' } },
      { ...train, id: 'leeds', last: { crs: 'LAN' }, next: { crs: 'CNF' }, destination: 'Leeds' },
      { ...train, id: 'north', last: { crs: 'WTH' }, next: { crs: 'PRN' } },
      { ...train, id: 'cancelled', cancelled: true },
    ],
  });
  assert.deepEqual(
    fixes.map((v) => [v.id, v.route, v.direction]),
    [
      ['rail-through', 'coast', 1],
      ['rail-junction', 'coast', -1],
      ['rail-shared', 'coast', 1],
    ],
  );
});

test('555 workings south of Kendal and Lancaster X4 workings stay off the map', () => {
  const bus = {
    id: 'at-kendal',
    route: '555',
    lon: -2.743,
    lat: 54.33,
    time: new Date(now).toISOString(),
    origin: '090079360111',
    terminus: '090002372828',
  };
  assert.deepEqual(
    busFixes([
      bus,
      { ...bus, id: 'south', terminus: '250020314' },
      { ...bus, id: 'holme', origin: '090079331275' },
      { ...bus, id: 'x4', route: 'X4', lon: -2.8, lat: 54.05 },
    ]).map((v) => v.id),
    ['bus-at-kendal'],
  );
  const data = read('map.json');
  const latitudes = (id) => data.routes[id].flat().map(([, y]) => data.frame.north - y / data.frame.units);
  assert.ok(Math.min(...latitudes('555')) > 54.325);
  for (const id of ['X4', 'X5'])
    assert.ok(
      data.routes[id].flat().some(([x]) => x < project([-3.53, 54.64], data.frame)[0]),
      id,
    );
});

test('rail horns require a fresh change of reporting point and match a confirmed stop exactly', async () => {
  const {railTransitions, confirmedRailStop} = await import('./public/model.mjs');
  const now = Date.now();
  const from = {id:'rail-42',route:'rail',direction:1,lastCode:'WDM',time:now-30000};
  const to = {...from,lastCode:'STV',last:'Staveley',lastTime:'15:42',time:now};
  const before = {ok:true, vehicles:[from]};
  const feed = vehicles => ({ok:true,vehicles});
  assert.deepEqual(railTransitions(before,feed([to]),now),[to]);
  assert.deepEqual(railTransitions(before,feed([{...from,time:now}]),now),[]);
  assert.deepEqual(railTransitions({ ...before,ok:false },feed([to]),now),[]);
  assert.deepEqual(railTransitions(before,feed([to]),now+120000),[]);
  const report = {id:'42',last:{crs:'STV',name:'Staveley',time:'15:42',stop:true}};
  assert.equal(confirmedRailStop(to,[report]),true);
  assert.equal(confirmedRailStop({...to,lastTime:'15:43'},[report]),false);
});
