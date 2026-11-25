import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Corridor } from './rail.mjs';
import { hemelBerths, hemelTrains, cardRotation, schedulePath, hemelCall, callText } from './public/hemel.mjs';

const layout = JSON.parse(readFileSync(new URL('./public/data/corridor.json', import.meta.url)));
const berths = hemelBerths(layout);

test('Hemel uses the four platform berths and the immediately inbound berth on each track', () => {
  assert.deepEqual(berths.map((b) => [b.track, b.station, b.approach]), [
    ['Down fast', 'R13143', 'R13139'], ['Up fast', 'R13144', 'R13146'],
    ['Down slow', 'R15145', 'R19880'], ['Up slow', 'R15146', 'R15148'],
  ]);
  const board = new Corridor(layout);
  board.values = { R13143: '1A80', R13146: '1B22', R15145: 'ITEM', R15148: '2K60', R15147: '2K65' };
  let groups = hemelTrains(berths, board);
  assert.deepEqual(groups.fast.map((t) => t.head), ['1A80']);
  assert.deepEqual(groups.slow.map((t) => [t.head, t.stage]), [['2K60', 'approach']]);
  board.values.R13143 = '';
  board.values.R13139 = '1A44';
  board.values.R15145 = '2K65';
  board.values.R15146 = '2K64';
  groups = hemelTrains(berths, board);
  assert.deepEqual(groups.fast.map((t) => t.head), ['1A44', '1B22']);
  assert.deepEqual(groups.slow.map((t) => [t.head, t.stage]), [['2K65', 'station'], ['2K64', 'station']]);
});

test('opposing trains rotate independently of feed updates, with immediate handover when a berth clears', () => {
  const rotate = cardRotation();
  const trains = [{ head: '2K65', track: 'Down slow' }, { head: '2K60', track: 'Up slow' }];
  assert.equal(rotate(trains, 1800).head, '2K65');
  assert.equal(rotate(trains, 6799).head, '2K65');
  assert.equal(rotate(trains.map((t) => ({ ...t, call: { booked: '21:55' } })), 6800).head, '2K60');
  assert.equal(rotate(trains, 11800).head, '2K65');
  assert.equal(rotate(trains.slice(1), 11801).head, '2K60');
  assert.equal(rotate([], 11802), undefined);
});

test('schedule lookups use the service origin date in London, including summer midnight', () => {
  const service = { uid: 'W70438', startTime: Date.parse('2026-06-24T23:15:00Z') };
  assert.equal(schedulePath(service), '/api/hemel-schedule/W70438/25/06/26');
  assert.equal(schedulePath({ uid: 'W70438' }), null);
  const legacy = { uid: 'W70438', id: '722K65M731' };
  assert.equal(schedulePath(legacy, Date.parse('2026-04-01T00:30:00+01:00')), '/api/hemel-schedule/W70438/31/03/26');
  assert.equal(schedulePath(legacy, Date.parse('2026-04-02T12:00:00Z')), null);
  assert.equal(schedulePath({ ...service, uid: '../bad' }), null);
});

const origin = { location: 'EUSTON', activity: 'Train begins.' };
const end = { location: 'MKNSCEN', activity: 'Train finishes.' };
const emptyTime = { working: '', public: '', actual: '' };
const hemel = { location: 'HEMLHMP', activity: '', pass: '', arrival: emptyTime, departure: emptyTime };
test('a verified complete schedule distinguishes passing, stopping and missing Hemel times', () => {
  const call = (row) => hemelCall([origin, row, end]);
  assert.deepEqual(hemelCall([origin, end]), { passing: true });
  assert.deepEqual(call({ ...hemel, pass: '21:55½' }), { passing: true });
  assert.equal(hemelCall([origin]), null);
  assert.equal(call(hemel), null);
  const arrival = { working: '23:58½', public: '23:59', actual: '23:59 On time' };
  const departure = { working: '23:59½', public: '23:59', actual: '00:01½ 2 Late' };
  assert.deepEqual(call({ ...hemel, arrival, departure }), { booked: '23:59', delay: 2.5 });
  assert.deepEqual(call({ ...hemel, arrival }), { booked: '23:59', delay: 0 });
  assert.deepEqual(call({ ...hemel, departure: { ...departure, actual: 'Exp. 00:02' } }), { booked: '23:59' });
  assert.equal(callText({ booked: '23:59' }, -1), 'Booked 23:59 · Est. 1 min early');
  assert.equal(callText({ booked: '23:59', delay: 2.5 }, -1), 'Booked 23:59 · 2.5 min late');
  assert.equal(callText(null, 0), 'Timetable unavailable');
});

test('the Hemel pilot reproduces the passing and stopping trains offline at the replay cursor', () => {
  const replay = JSON.parse(readFileSync(new URL('./public/data/hemel-replay.json', import.meta.url)));
  const board = new Corridor(layout);
  for (const frame of replay.frames) {
    if (frame.time > replay.frames[0].time + 90000) break;
    board.apply(frame);
  }
  const { fast, slow } = hemelTrains(berths, board);
  const label = (t) => callText(replay.hemelCalls[t.service.id], t.service.delay);
  assert.deepEqual([fast[0].head, label(fast[0])], ['1A80', 'Passing']);
  assert.deepEqual([slow[0].head, label(slow[0])], ['2K65', 'Booked 21:55 · Est. on time']);
});
