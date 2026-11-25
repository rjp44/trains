import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timetable, hhmm, serviceSeconds } from './public/timetable.mjs';
const read = (file) => JSON.parse(readFileSync(new URL('./public/data/' + file, import.meta.url)));
const replay = read('replay.json');
const schedule = new Timetable(read('timetable.json'));
const frame = replay.frames[0];
test('all recorded buses match an active timetable with the same endpoints and booked departure', () => {
  for (const f of replay.frames)
    for (const bus of f.bus.vehicles) {
      const trip = schedule.match(bus);
      assert.ok(trip, bus.id);
      const calls = schedule.patterns[trip.pattern];
      assert.equal(calls[0][0], bus.origin);
      assert.equal(calls.at(-1)[0], bus.terminus);
      assert.ok(Number.isFinite(bus.bearing));
    }
  const bus = frame.bus.vehicles[0];
  assert.equal(schedule.match({ ...bus, terminus: 'different' }), null);
  assert.equal(schedule.match({ ...bus, departure: null }), null);
  const data = read('timetable.json'),
    trip = schedule.match(bus);
  const variant = structuredClone(data.patterns[trip.pattern]);
  variant[1][2] += 60;
  data.trips.push({ ...trip, pattern: data.patterns.push(variant) - 1 });
  assert.equal(new Timetable(data).match(bus), null);
});
test('the Ambleside board combines opposite poles, shows upcoming buses in both directions and respects route filters', () => {
  const i = schedule.groups.findIndex((g) => g.name === 'Hayes Garden Centre' && g.town === 'Ambleside');
  const { sections } = schedule.departures(i, frame.time);
  const boards = [...sections.values()].sort((a, b) => a[0].at - b[0].at);
  assert.deepEqual(
    boards.map((list) => [list[0].trip.route, list[0].time, list.length]),
    [
      ['505', '12:07', 3],
      ['555', '12:26', 3],
    ],
  );
  assert.notEqual(boards[0][0].ref, boards[1][0].ref);
  assert.ok(
    [...schedule.departures(i, frame.time, '505').sections.values()]
      .flat()
      .every((c) => c.trip.route === '505'),
  );
  const late = schedule.departures(i, Date.parse('2026-12-24T23:58:00Z'));
  assert.ok(
    [...late.sections.values()]
      .flat()
      .every((c) => c.time.includes('26 Dec') || c.time.includes('27 Dec') || c.time.includes('28 Dec')),
  );
  assert.equal(schedule.departures(i, Date.parse('2027-03-22T12:00:00Z')).covered, false);
});
test('London time handles summer midnight and a service day continuing past 24:00', () => {
  const instant = Date.parse('2026-07-12T23:15:00Z');
  assert.equal(serviceSeconds(instant, '2026-07-12'), 87300);
  assert.equal(hhmm(87300), '00:15');
  const data = {
    start: '2026-07-12',
    end: '2026-07-13',
    calendars: { A: '10' },
    groups: [{ refs: ['a'] }, { refs: ['b'] }, { refs: ['c'] }],
    stops: { a: { group: 0 }, b: { group: 1 }, c: { group: 2 } },
    patterns: [
      [
        ['a', 0, 0, 1, 1, 0],
        ['b', 900, 900, 0, 1, 1],
        ['c', 1800, 1800, 0, 1, 1],
      ],
    ],
    trips: [{ route: '555', service: 'A', start: 87300, pattern: 0 }],
  };
  const timetable = new Timetable(data);
  const v = {
    route: '555',
    origin: 'a',
    terminus: 'c',
    departure: '2026-07-13T00:15:00+01:00',
    serviceDate: '2026-07-12',
  };
  assert.equal(timetable.match(v), data.trips[0]);
  assert.equal(timetable.departures(0, instant - 60_000).sections.get(1)[0].time, '00:15');
  assert.equal(timetable.departures(1, instant).sections.size, 0);
  assert.equal(timetable.departures(2, instant).sections.size, 0);
});
