import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionalMarkers, regionalRows, locationArrivals, slots } from './public/regional.mjs';
import { directionalScene, laneName } from './esp32/directional-scene.mjs';
import { railIcon, railOperatorName } from './lakes/public/model.mjs';

for (const id of ['crewe-birmingham', 'preston-crewe']) {
  const layout = JSON.parse(readFileSync(new URL('./apps/' + id + '/data/corridor.json', import.meta.url)));
  test(
    id +
      ' maps individual berths, reports ambiguous platforms conservatively and ages each area independently',
    () => {
      const [station] = layout.tracks;
      const b = station.berths.find((b) => b.platform),
        area = b.id.slice(0, 2);
      const state = { values: { [b.id]: '1A01' }, areaStatus: { [area]: 'Live' }, services: {} };
      const markers = regionalMarkers(layout);
      assert.equal(new Set(markers.map((b) => b.id)).size, markers.length);
      const i = markers.findIndex((m) => m.id === b.id),
        rows = regionalRows(layout, state, true);
      assert.equal(rows.length, markers.length);
      assert.equal(rows[i][2], '1A01');
      assert.match(rows[i][5], new RegExp(b.id));
      assert.equal(rows.filter((row) => row[2] === '1A01').length, 1);
      assert.deepEqual(
        markers.map((m) => m.id),
        layout.tracks.flatMap((t) => t.berths.map((b) => b.id)),
      );
      state.areaStatus[area] = 'Stale';
      assert.equal(regionalRows(layout, state, true)[i][1], 3);
      const legacy = { ...layout, diagram: undefined };
      const oldRows = regionalRows(legacy, state, true);
      assert.equal(oldRows[0][2], '1A01');
      assert.equal(oldRows[slots + station.berths.indexOf(b)][2], '1A01');
    },
  );
  test(id + ' draws verified berths on their track and retains every address in the register', () => {
    const markers = regionalMarkers(layout);
    const full = directionalScene(layout, markers, 0);
    for (const view of [0, 1, 2]) {
      const scene = directionalScene(layout, markers, view);
      const ids = scene.Markers.map(([i]) => markers[i].id);
      const stops = new Set(scene.Stations.map(([id]) => id));
      const expected = full.Markers.map(([i]) => markers[i]).filter((m) => stops.has(m.track.id)).map((m) => m.id);
      assert.deepEqual(ids.sort(), expected.sort());
      assert.equal(new Set(ids).size, ids.length);
      for (const row of [...scene.Labels, ...scene.Lines, ...scene.Markers, ...scene.Legend])
        assert.ok(row.every((v) => typeof v !== 'number' || Number.isInteger(v)), 'native table coordinates');
      assert.ok(scene.Width > 1024 && scene.Width < 32768);
      assert.equal(scene.Stations[0][2], 0);
      assert.ok(scene.Markers.every(([, x]) => x > 0 && x < scene.Width));
      // Addresses belong in the station register, never in the track labels.
      assert.ok(!scene.Labels.some((l) => ids.includes(l[6].split(' ')[0])));
      for (const [i, , , , radius] of scene.Markers) {
        assert.equal(radius > 0, Boolean(markers[i].bit));
      }
    }
    const onMap = new Map(full.Markers.map(([i,x,y]) => [markers[i].id, [x,y]]));
    assert.ok(markers.length > onMap.size);
    assert.ok(!full.Labels.some(l => /berth reports/i.test(l[6])));
    assert.equal(onMap.get('CE0116')[1], onMap.get('CEA139')[1]); // Both at Crewe P11.
    assert.notEqual(onMap.get('CE0116')[1], onMap.get('CE0112')[1]); // P12 is a different road.
    assert.ok(!onMap.has('CE9030') && markers.some(m => m.id === 'CE9030'));
    // The approach roads have distinct geometry from the platforms they feed.
    assert.equal(onMap.get('CE0105')[1], 140); // Down Slow at Crewe South.
    assert.equal(onMap.get('CE0107')[1], 198); // Down Fast.
    assert.notEqual(onMap.get('CE0535')[1], onMap.get('CE0537')[1]);
    assert.ok(onMap.get('CE0107')[0] > onMap.get('CE0124')[0]);
    if (id === 'preston-crewe') {
      assert.equal(onMap.get('WA0181')[1], 140);
      assert.equal(onMap.get('WA0182')[1], 198);
    }
    if (id === 'crewe-birmingham') {
      for (const [west, east, above, below] of [
        ['NS7321', 'NS8241', 'NS5105', 'NS5106'],
        ['NS7322', 'NS8442', 'NS5107', 'NS5108'],
        ['NS7323', 'NS8843', 'NS5109', 'NS5110'],
      ]) {
        const [x,y] = onMap.get(west);
        assert.equal(y, onMap.get(east)[1]);
        assert.ok(x < onMap.get(east)[0] && onMap.get(above)[1] < y && y < onMap.get(below)[1]);
      }
      for (const berth of ['NS3503','NS3506','NS4141','NS4182','NS4187','NS4929','NS9145','NS9185',
        'NS9931','PJ0149','PJ4604','PJ4608','PJ4609','PJ4092','PJ4097','PJ4115'])
        assert.ok(onMap.has(berth), berth);
      assert.equal(onMap.get('NS5101')[1], onMap.get('NS6201')[1]);
      assert.notEqual(onMap.get('NS5101')[1], onMap.get('NS5102')[1]);
    }
    if (id === 'preston-crewe') {
      const leyland = layout.tracks.find((t) => t.id === 'LEYLAND');
      const scene = directionalScene(layout, markers, 0);
      const positions = new Map(scene.Markers.map(([i, x, y]) => [markers[i].id, { x, y }]));
      const lines = ['PX0041', 'PX0039', 'PX0043', 'PX0042'].map((id) => {
        const berth = leyland.berths.find((b) => b.id === id);
        return [berth.direction, laneName(leyland, berth), berth.platform];
      });
      assert.deepEqual(lines, [
        ['up', 'Fast', '4'],
        ['up', 'Slow', '2'],
        ['down', 'Fast', '3'],
        ['down', 'Slow', '1'],
      ]);
      assert.equal(
        new Set(['PX0041', 'PX0039', 'PX0043', 'PX0042'].map((id) => positions.get(id).y)).size,
        4,
      );
      for (const [a, b, dir] of leyland.steps) {
        assert.ok(
          dir === 'up' ? positions.get(a).x < positions.get(b).x : positions.get(a).x > positions.get(b).x,
        );
      }
    }
  });
  test(id + ' follows the same continuous railway through every station and both sectional cuts', () => {
    const markers = regionalMarkers(layout);
    const full = directionalScene(layout, markers, 0);
    for (const view of [0, 1, 2]) {
      const s = directionalScene(layout, markers, view);
      const start = full.Stations.find(([id]) => id === s.Stations[0][0])[2];
      const rails = s.Lines.filter(([, , , , ink]) => ink === 3);
      assert.ok(s.LegendWidth > 0);
      assert.ok(!s.Labels.some((l) => /(?:Down|Up) (?:fast|slow|main)/.test(l[6])));
      for (const x of new Set(s.Legend.flatMap(([a, b]) => [a, b - 1]))) {
        const titles = s.Legend.filter(([a, b]) => a <= x && x < b);
        const levels = rails.filter(([a, y, b, z]) => y === z && a <= x && x < b).map((l) => l[1]);
        assert.deepEqual(titles.map((l) => l[2]).sort(), levels.sort());
        assert.equal(new Set(titles.map(l => l[2])).size, titles.length);
      }
      for (const [i, x, y] of s.Markers) {
        const original = full.Markers.find(([n]) => n === i);
        assert.deepEqual([x + start, y], original.slice(1, 3));
        assert.ok(
            rails.some(([a, h, b, j]) => h === y && j === y && a <= x && b >= x),
            markers[i].id,
          );
      }
      const joins = rails.filter(([a, y, b, z]) => y !== z && a > 0 && b < s.Width);
      assert.ok(view !== 0 || joins.length >= 2);
      for (const [x, y] of joins.map(([a, b]) => [a, b])) {
        const onRail = rails.some(([a, h, b, j]) => h === y && j === y && a <= x && b >= x);
        const inThroat = s.Lines.some(([a,h,b,j,ink]) => ink === 8 && a === x && b === x && h <= y && y <= j);
        assert.ok(onRail || inThroat);
      }
    }
    if (id === 'preston-crewe') {
      const four = full.Stations.find(([name]) => name === 'LEYLAND')[2] + 100;
      const two = full.Stations.find(([name]) => name === 'WIGANNW')[2] - 15;
      const count = (x) =>
        full.Lines.filter(([a, h, b, j, ink]) => ink === 3 && h === j && a <= x && b >= x).length;
      assert.equal(count(four), 4);
      assert.equal(count(two), 2);
    }
  });
  test(id + ' uses the signal bit independently of the train description and clears stale aspects', () => {
    const markers = regionalMarkers(layout);
    const i = markers.findIndex((b) => b.id === 'CE0116');
    const b = markers[i];
    assert.deepEqual([b.signal, b.bit], ['CE116', 'CE2D:7']);
    const state = { values: { [b.bit]: 'off' }, areaStatus: { CE: 'Live' }, services: {} };
    assert.deepEqual(regionalRows(layout, state, true)[i].slice(0, 3), [2, 0, '']);
    state.values[b.id] = '1A01';
    state.values[b.bit] = 'on';
    assert.deepEqual(regionalRows(layout, state, true)[i].slice(0, 3), [1, 1, '1A01']);
    state.areaStatus.CE = 'Stale';
    assert.deepEqual(regionalRows(layout, state, true)[i].slice(0, 3), [0, 3, '1A01']);
    const replay = JSON.parse(readFileSync(new URL('./apps/' + id + '/data/replay.json', import.meta.url)));
    const creweSignals = markers.filter((b) => b.bit?.startsWith('CE'));
    const snapshot = replay.frames.find((f) => f.full && f.area === 'CE');
    assert.ok(
      creweSignals.length >= 33 && creweSignals.every((b) => ['on', 'off'].includes(snapshot.values[b.bit])),
    );
    assert.ok(replay.frames.some((f) => !f.full && creweSignals.some((b) => f.values?.[b.bit])));
  });
  test(id + ' uses observed movements into the focus station for directional arrival sounds', () => {
    const arrivals = locationArrivals(layout),
      index = layout.tracks.findIndex((t) => t.id === layout.focus);
    const a = layout.tracks[index - 1].berths[0].id,
      b = layout.tracks[index].berths.find((b) => b.platform).id;
    arrivals.accept({ full: true, time: 100000, area: b.slice(0, 2), values: { [b]: '' } });
    arrivals.accept({ full: true, time: 100000, area: a.slice(0, 2), values: { [a]: '1A01' } });
    assert.equal(arrivals.take(true, 100000), '');
    arrivals.accept({ time: 120000, area: b.slice(0, 2), values: { [b]: '1A01' } });
    assert.equal(arrivals.take(true, 120000), 'U');
    arrivals.reset();
    arrivals.accept({ time: 125000, area: b.slice(0, 2), values: { [b]: '1A01' } });
    assert.equal(arrivals.take(true, 125000), '');
  });
}
test('Lakes selects an operator livery in every elevation', () => {
  for (const [agency, operator] of [
    ['VT', 'avanti'],
    ['Avanti West Coast', 'avanti'],
    ['TP', 'tpe'],
    ['TransPennine Express', 'tpe'],
    ['LF', 'lumo'],
    ['LD', 'lumo'],
    ['Lumo West Coast', 'lumo'],
    ['Lumo', 'lumo'],
    ['Northern', 'northern'],
  ])
    for (const view of ['side', 'roof', 'oblique', 'front'])
      assert.equal(railIcon(agency, view), operator + '-carriage' + (view === 'side' ? '' : '-' + view));
});

test('the recorded Euston to Stirling service has the Lumo livery and operator label', () => {
  const replay = JSON.parse(readFileSync(new URL('./lakes/public/data/replay.json', import.meta.url)));
  const train = replay.frames
    .flatMap((f) => f.rail.vehicles)
    .find((v) => v.route === 'wcml' && v.agency === 'LF');
  assert.equal(train.destination, 'Stirling');
  assert.equal(railIcon(train.agency, 'roof'), 'lumo-carriage-roof');
  assert.equal(railOperatorName(train.agency), 'Lumo');
  assert.equal(railOperatorName('Northern'), 'Northern');
});
