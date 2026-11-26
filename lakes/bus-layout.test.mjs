import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BusPaths, vehicleView, makePath, placeVehicles, routeBearing } from './public/bus-layout.mjs';
import { project, railBearing, visibleFixes } from './public/model.mjs';
import { Timetable } from './public/timetable.mjs';

const read = (name) => JSON.parse(readFileSync(new URL('./public/data/' + name + '.json', import.meta.url)));
const inside = () => true;
function overlaps(a, b) {
  return (
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.0001 &&
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.0001
  );
}
function checkSpacing(markers) {
  for (const [i, a] of markers.entries())
    for (const b of markers.slice(0, i))
      if (a.path || b.path) assert.ok(!overlaps(a.box, b.box), a.id + ' overlaps ' + b.id);
}

test('journey direction survives a local zigzag and conflicting or absent GPS reports', () => {
  const outbound = [
    [0, 12],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
    [0, -12],
  ];
  const trips = [
    { route: '599', pattern: 0, path: 0 },
    { route: '599', pattern: 1, path: 1 },
  ];
  const routes = new BusPaths(
    {
      paths: [outbound, outbound.toReversed()],
      patterns: [
        [['A'], ['B']],
        [['B'], ['A']],
      ],
      trips,
    },
    (p) => p,
  );
  for (const bearing of [0, 90, 180, 270, null]) {
    const v = { route: '599', origin: 'A', terminus: 'B', bearing };
    for (const trip of [trips[0], null]) {
      const m = routes.locate(v, 1, 0.5, trip, null);
      assert.equal(m.bearing, 0);
    }
    assert.equal(routes.locate({ ...v, origin: 'B', terminus: 'A' }, 1, 0.5, null, null).bearing, 180);
  }
});

test('vehicle elevations agree in all four quadrants with a three-quarter view on each diagonal', () => {
  for (const northSouth of [0, 180])
    for (const sign of [-1, 1])
      for (const [offset, view] of [[0, 'roof'], [22.5, 'roof'], [22.51, 'oblique'], [45, 'oblique'],
        [67.49, 'oblique'], [67.5, 'side'], [90, 'side']])
        assert.equal(vehicleView((360 + northSouth + sign * offset) % 360), view);
  assert.equal(vehicleView(360), 'roof');
  for (const unknown of [null, undefined, NaN, Infinity, -1, 361]) assert.equal(vehicleView(unknown), 'front');
});

test('coastal trains keep their elevation and reverse their cab on the return working', () => {
  const { track, stations } = read('rail').lines.coast;
  for (const [lastCode, nextCode, view] of [
    ['BOC', 'RAV', 'roof'], ['DRI', 'SSC', 'oblique'], ['KBK', 'CAK', 'side'],
  ]) {
    const vertex = code => stations.find(s => s.code === code).vertex;
    const i = Math.floor((vertex(lastCode) + vertex(nextCode)) / 2);
    const point = track[i].map((v, j) => (v + track[i + 1][j]) / 2);
    const heading = (from, to) => railBearing({lastCode: from, nextCode: to}, point, track, stations);
    const out = heading(lastCode, nextCode), back = heading(nextCode, lastCode);
    assert.equal(vehicleView(out), view);
    assert.equal(vehicleView(back), view);
    assert.ok(Math.abs((360 + back - out) % 360 - 180) < 0.00001);
    assert.equal(vehicleView(railBearing({}, point, track, stations)), 'front');
  }
});

test('the overlapping Drigg trace faces Seascale on both map and tablet coordinates', () => {
  const { track, stations } = read('rail').lines.coast;
  const packed = track.map(point => point.map(x => Math.round(x * 8) / 8));
  for (const line of [track, packed])
    for (const [lastCode, nextCode, expected] of [['DRI', 'SSC', 319], ['SSC', 'DRI', 139]]) {
      const heading = railBearing({lastCode, nextCode}, [156.08, 380.93], line, stations);
      assert.ok(Math.abs(heading - expected) < 5);
    }
});

test('buses line up on their own paths at a rail crossing and keep trip order and IDs', () => {
  const east = makePath([
      [0, 100],
      [270, 100],
    ]),
    north = makePath([
      [135, 250],
      [135, 0],
    ]);
  const markers = [
    { id: 'train', x: 135, y: 100, bearing: 90 },
    ...[0, 1, 2].map((i) => ({
      id: 'east' + i,
      x: 134 + i,
      y: 100,
      path: east,
      pathId: 0,
      distance: 134 + i,
      bearing: 90,
    })),
    { id: 'north', x: 135, y: 101, path: north, pathId: 1, distance: 149, bearing: 0 },
  ];
  const place = (input) =>
    placeVehicles(
      input.map((v) => ({ ...v })),
      1,
      inside,
    ).sort((a, b) => a.id.localeCompare(b.id));
  const result = place(markers);
  assert.deepEqual(result, place(markers.toReversed()));
  checkSpacing(result);
  const eastbound = result.filter((m) => m.path === east);
  assert.deepEqual(
    eastbound.map((m) => m.y),
    [100, 100, 100],
  );
  assert.ok(eastbound[0].x < eastbound[1].x && eastbound[1].x < eastbound[2].x);
  assert.equal(result.find((m) => m.id === 'north').x, 135);
  const train = result.find((m) => m.id === 'train');
  assert.deepEqual([train.x, train.y, train.size], [135, 100, 1]);
});

test('all recorded bus journeys fit beside other vehicles at tablet and phone overview scales', () => {
  const frame = read('map').frame,
    tt = new Timetable(read('timetable')),
    rail = read('rail').lines;
  const paths = new BusPaths(tt, (p) => project(p, frame));
  for (const snapshot of read('replay').frames) {
    for (const unit of [0.25, 1, 1.75]) {
      const raw = visibleFixes(snapshot, snapshot.time).map((v) => {
        const [x, y] = project(v.point, frame);
        if (rail[v.route])
          return {
            id: v.id,
            x,
            y,
            bearing: railBearing(v, [x, y], rail[v.route].track, rail[v.route].stations),
          };
        const trip = tt.match(v);
        assert.ok(trip);
        const duration = tt.patterns[trip.pattern].at(-1)[1];
        const expected = Math.max(0, Math.min(1, (v.time - Date.parse(v.departure)) / (1000 * duration)));
        const result = paths.locate(v, x, y, trip, expected);
        assert.ok(result && Number.isFinite(result.bearing));
        return { id: v.id, x, y, ...result };
      });
      const markers = placeVehicles(
        raw.map((m) => ({ ...m })),
        unit,
        inside,
      );
      checkSpacing(markers);
      for (const [i, m] of markers.entries()) {
        if (!m.path) assert.deepEqual([m.x, m.y], [raw[i].x, raw[i].y]);
        else assert.equal(m.bearing, routeBearing(m.path, m.drawDistance));
      }
    }
  }
});
