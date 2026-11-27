import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionalMarkers, regionalRows, locationArrivals, slots } from './public/regional.mjs';
import { railIcon } from './lakes/public/model.mjs';

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
      assert.equal(rows[0][2], '1A01');
      state.areaStatus[area] = 'Stale';
      assert.equal(regionalRows(layout, state, true)[i][1], 3);
      assert.ok(i >= slots);
    },
  );
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
    ['Northern', 'northern'],
  ])
    for (const view of ['side', 'roof', 'oblique', 'front'])
      assert.equal(railIcon(agency, view), operator + '-carriage' + (view === 'side' ? '' : '-' + view));
});
