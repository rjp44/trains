import test from 'node:test';
import assert from 'node:assert/strict';
import { solarDays, dayAt } from '../../web/panel/appearance.mjs';

test('the web display uses the UK calendar date across both clock changes and expires an offline week', () => {
  for (const start of ['2026-03-27', '2026-10-23']) {
    const midnight = Date.parse(start + 'T00:00:00Z');
    const sunrise = Array.from({ length: 7 }, (_, i) => midnight / 1000 + i * 86400 + 7 * 3600);
    const sunset = sunrise.map((r) => r + 11 * 3600);
    const days = solarDays({ sunrise, sunset });
    assert.equal(days.length, 7);
    // The fourth day of each fixture is on the other side of the Sunday clock change.
    const dstAfterChange = start.includes('03');
    const localFourthDay = midnight + 3 * 86400000 - (dstAfterChange ? 3600000 : 0);
    assert.equal(dayAt(days, localFourthDay - 1), days[2]);
    assert.equal(dayAt(days, localFourthDay), days[3]);
    assert.equal(dayAt(days, midnight + 7 * 86400000), undefined);
    assert.deepEqual(solarDays({ sunrise: sunrise.slice(1), sunset }), []);
    assert.deepEqual(solarDays({ sunrise, sunset: sunrise }), []);
  }
});
