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
      assert.deepEqual(markers.map((m) => m.id), layout.tracks.flatMap((t) => t.berths.map((b) => b.id)));
      state.areaStatus[area] = 'Stale';
      assert.equal(regionalRows(layout, state, true)[i][1], 3);
      const legacy = { ...layout, diagram: undefined };
      const oldRows = regionalRows(legacy, state, true);
      assert.equal(oldRows[0][2], '1A01');
      assert.equal(oldRows[slots + station.berths.indexOf(b)][2], '1A01');
    },
  );
  test(id + ' puts each physical berth on its diagram once across all three views', () => {
    const markers = regionalMarkers(layout);
    for (const view of [0, 1, 2]) {
      const scene = directionalScene(layout, markers, view);
      const ids = scene.Markers.map(([i]) => markers[i].id);
      const stops = new Set(scene.Stations.map(([id]) => id));
      const expected = markers.filter((m) => stops.has(m.track.id)).map((m) => m.id);
      assert.deepEqual(ids.sort(), expected.sort());
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(scene.Width > 1024 && scene.Width < 32768);
      assert.equal(scene.Stations[0][2], 0);
      assert.ok(scene.Markers.every(([, x]) => x > 0 && x < scene.Width));
    }
    if (id === 'preston-crewe') {
      const leyland = layout.tracks.find((t) => t.id === 'LEYLAND');
      const scene = directionalScene(layout, markers, 0);
      const positions = new Map(scene.Markers.map(([i,x,y]) => [markers[i].id, {x,y}]));
      const lines = ['PX0041', 'PX0039', 'PX0043', 'PX0042'].map((id) => {
        const berth = leyland.berths.find((b) => b.id === id);
        return [berth.direction, laneName(leyland, berth), berth.platform];
      });
      assert.deepEqual(lines, [['up','Fast','4'], ['up','Slow','2'], ['down','Fast','3'], ['down','Slow','1']]);
      assert.equal(new Set(['PX0041','PX0039','PX0043','PX0042'].map((id) => positions.get(id).y)).size, 4);
      for (const [a,b,dir] of leyland.steps) {
        assert.ok(dir === 'up' ? positions.get(a).x < positions.get(b).x : positions.get(a).x > positions.get(b).x);
      }
    }
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
  const train = replay.frames.flatMap(f => f.rail.vehicles).find(v => v.route === 'wcml' && v.agency === 'LF');
  assert.equal(train.destination, 'Stirling');
  assert.equal(railIcon(train.agency, 'roof'), 'lumo-carriage-roof');
  assert.equal(railOperatorName(train.agency), 'Lumo');
  assert.equal(railOperatorName('Northern'), 'Northern');
});
