import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorSpacing } from '../web/corridor/spacing.mjs';

const badge = (x, y, half = 30) => ({ x, left: -half, right: half, top: y - 10, bottom: y + 10 });

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
