import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorSpacing, placeRailSigns, railViewProjection } from '../public/rail-spacing.mjs';
import { placeStationLabels, stationLabelSpans } from '../web/corridor/station-labels.mjs';

const badge = (x, y, half = 30) => ({ x, left: -half, right: half, top: y - 10, bottom: y + 10 });

test('only colliding station names change rows, and zooming in restores the shared row', () => {
  const names = [120, 180, 305, 650].map(x => ({ kind: 'station', x, left: -50, right: 50 }));
  const identity = { width: 1000, project: x => x };
  const rows = placeStationLabels(identity, names);
  assert.notEqual(rows.get(names[0]), rows.get(names[1]));
  assert.equal(rows.get(names[0]), rows.get(names[2]));
  assert.equal(rows.get(names[0]), rows.get(names[3]));
  assert.equal(new Set(placeStationLabels({ width: 2000, project: x => 2 * x }, names).values()).size, 1);
  const tight = corridorSpacing(1000, [], stationLabelSpans(1000, names)).at(0);
  assert.equal(placeStationLabels(tight, names).size, names.length);
});

test('a junction caption that cannot fit hides all junction names, including reporting junctions', () => {
  const names = ['station', 'junction', 'approach', 'approach', 'section'].map((kind, i) => ({
    kind, x: [90, 200, 320, 340, 720][i], left: -25, right: 25,
  }));
  assert.deepEqual([...placeStationLabels({ width: 900, project: x => x }, names).keys()], [names[0]]);
  assert.equal(placeStationLabels({ width: 2700, project: x => 3 * x }, names).size, names.length);
  assert.deepEqual(stationLabelSpans(900, names), stationLabelSpans(900, [names[0]]));
});

test('optional branch signs yield both rows to required signs and return as track space opens', () => {
  const signs = [
    {name: 'Watford North', x: 115, width: 100, optional: true},
    {name: 'Garston', x: 125, width: 80, optional: true},
    {name: 'St Albans Abbey', x: 140, width: 110},
    {name: 'Far stop', x: 260, width: 70, optional: true},
  ];
  const compact = placeRailSigns(signs, 350);
  assert.deepEqual(compact.map(s => s.name), ['Watford North', 'St Albans Abbey', 'Far stop']);
  assert.notEqual(compact[0].row, compact[1].row);
  assert.equal(compact[2].row, 0);
  const expanded = placeRailSigns(signs.map((s,i) => ({...s, x: 80 + 130*i})), 600);
  assert.equal(expanded.length, signs.length);
  assert.ok(expanded.every(s => s.row === 0));
});

test('sector fits both endpoints even when fixed symbols need more space than the viewport', () => {
  const plan = corridorSpacing(1200, [badge(100, 20, 100), badge(200, 20, 100), badge(300, 20, 100)], []);
  const margin = 107;
  for (const viewport of [350, 600, 840, 1140]) {
    const fit = railViewProjection(plan, 0, viewport, margin, true);
    assert.ok(Math.abs((fit.axis.width + margin) * fit.scale - viewport) < 1e-6);
    assert.equal(fit.axis.project(0), 0);
    assert.equal(fit.axis.project(1200), fit.axis.width);
    const detail = railViewProjection(plan, 1, viewport, margin, true);
    assert.equal(detail.scale, 1);
    assert.equal(detail.axis.width, plan.normalWidth);
  }
  const closeup = railViewProjection(plan, 0, 350, margin, false);
  assert.equal(closeup.scale, 1);
  assert.ok(closeup.axis.width + margin > 350);
});

test('tight spacing is set by occupied rows, including the outer edges', () => {
  const features = [badge(100, 20), badge(140, 20), badge(510, 100, 72)];
  const plan = corridorSpacing(1000, features, []);
  const tight = plan.at(0);
  // The long name can use the same columns as trains on a different row.
  assert.ok(tight.width < 180);
  assert.ok(tight.project(140) - tight.project(100) >= 64);
  assert.ok(tight.project(510) >= 76 && tight.width - tight.project(510) >= 76);
  assert.equal(plan.at(plan.minZoom / 2).width, tight.width);
  const occupied = corridorSpacing(1000, [...features, badge(400, 100, 72)], []);
  assert.ok(occupied.at(0).width >= 300);
});

test('zoom releases empty track first and preserves junctions, furniture and the camera anchor', () => {
  const plan = corridorSpacing(1000, [badge(60, 20), badge(100, 20)], [[380, 420, 40]]);
  const normal = plan.at(1), tight = plan.at(0);
  assert.ok(tight.project(100) - tight.project(60) >= 64);
  assert.ok(tight.project(420) - tight.project(380) >= 40);
  assert.ok(normal.project(900) - normal.project(500) > 3 * (tight.project(900) - tight.project(500)));
  for (const z of [0, 0.65, 1, 1.25, 3]) {
    const axis = plan.at(z);
    for (let x = 0; x <= 1000; x += 2.5)
      assert.ok(Math.abs(axis.unproject(axis.project(x)) - x) < 1e-8);
    assert.equal(axis.project(0), 0);
    assert.equal(axis.project(1000), axis.width);
  }
});
